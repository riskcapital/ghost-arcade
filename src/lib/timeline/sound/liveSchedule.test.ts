import { describe, expect, it } from 'vitest';
import { createTempoMap } from '../../show/tempoMap';
import {
  fireLead,
  LIVE_Q_BAR,
  LIVE_Q_NONE,
  LIVE_Q_QUARTER,
  LiveClipScheduler,
  liveSchedInputs,
  offGrid,
  resolveLiveSlot,
  resolveLiveTrack,
  SCRIPT_TICK_SECONDS,
  type LiveCommand,
  type LiveEnv,
  type LiveSchedBlock,
  type LiveSchedRow,
} from './liveSchedule';
import { defaultSoundRow, type SoundRow } from './soundModel';

/** 120 BPM, 4/4 from 0: a beat is 0.5 s, a bar 2 s. */
const tempo = createTempoMap(120, 0);
const env = (protocol = 5, extra: Partial<LiveEnv> = {}): LiveEnv => ({ tempo, setQuantize: 4, numerator: 4, denominator: 4, protocol, ...extra });
const row = (rowId: string, track: number, extra: Partial<LiveSchedRow> = {}): LiveSchedRow => ({ rowId, track, launch: 'beat', latency: 0.02, audible: true, ...extra });
const blk = (id: string, rowId: string, start: number, end: number, slot: number | null = 0): LiveSchedBlock => ({ id, rowId, start, end, slot });

/** Play from `from` to `to` at 60 frames a second; commands with the show time they went out. */
function run(s: LiveClipScheduler, out: Array<{ t: number; cmd: LiveCommand }>, from: number, to: number, seek = 0, record = (t: number) => (cur = t)) {
  for (let t = from; t <= to + 1e-9; t += 1 / 60) {
    record(t);
    clock += 1000 / 60;
    s.tick(t, true, seek);
  }
}
let cur = 0;
/** The wall clock the scheduler sees (ms): runs with the frames. */
let clock = 0;
function scheduler(e = env()) {
  const out: Array<{ t: number; cmd: LiveCommand }> = [];
  const s = new LiveClipScheduler({ send: (cmd) => out.push({ t: cur, cmd }), now: () => clock });
  s.setEnv(e);
  return { s, out };
}

describe('Live clip blocks: when Live is told', () => {
  it('fires inside the grid step before the block, so Live starts it on the beat; stops at the end', () => {
    const { s, out } = scheduler();
    s.setBlocks([row('r', 3)], [blk('a', 'r', 2, 4, 5)]);
    run(s, out, 0, 6);
    expect(out.map((o) => o.cmd)).toEqual([
      { t: 'fire_clip', i: 3, s: 5, q: LIVE_Q_QUARTER },
      { t: 'stop_track', i: 3, q: LIVE_Q_NONE },
    ]);
    const lead = fireLead(0.5, 0.02);
    expect(lead).toBeCloseTo(0.27, 6);
    // Sent within a frame of start − lead: arrives in the beat before 2.0 with a script tick to spare.
    expect(out[0].t).toBeGreaterThanOrEqual(2 - lead - 1e-9);
    expect(out[0].t).toBeLessThan(2 - lead + 1 / 60);
    expect(2 - out[0].t - 0.02).toBeGreaterThan(SCRIPT_TICK_SECONDS);
    expect(2 - out[0].t).toBeLessThan(0.5);
    // The stop lands on the end (latency + half a script tick early).
    expect(out[1].t).toBeCloseTo(4 - 0.07, 1);
  });

  it('a bar row fires half a bar ahead with the bar quantise', () => {
    const { s, out } = scheduler();
    s.setBlocks([row('r', 0, { launch: 'bar' })], [blk('a', 'r', 4, 8)]);
    run(s, out, 0, 5);
    expect(out[0].cmd).toEqual({ t: 'fire_clip', i: 0, s: 0, q: LIVE_Q_BAR });
    expect(out[0].t).toBeCloseTo(4 - 1 - 0.02, 1);
  });

  it('the next block on the row takes over: no stop between touching blocks', () => {
    const { s, out } = scheduler();
    s.setBlocks([row('r', 1)], [blk('a', 'r', 0.5, 2, 0), blk('b', 'r', 2, 4, 1)]);
    run(s, out, 0, 5);
    expect(out.map((o) => o.cmd.t)).toEqual(['fire_clip', 'fire_clip', 'stop_track']);
    expect((out[1].cmd as { s: number }).s).toBe(1);
  });

  it('two Live rows layer two clips; a visual on the same grid lines up', () => {
    const { s, out } = scheduler();
    // Bar 1 (0 s) and bar 3 (4 s).
    s.setBlocks([row('drums', 0), row('bass', 1)], [blk('d', 'drums', 0, 8, 0), blk('b', 'bass', 4, 8, 2)]);
    run(s, out, -0.5, 9);
    const fires = out.filter((o) => o.cmd.t === 'fire_clip');
    expect(fires.map((f) => [(f.cmd as { i: number }).i, (f.cmd as { s: number }).s])).toEqual([[0, 0], [1, 2]]);
    expect(fires[1].t).toBeCloseTo(4 - fireLead(0.5, 0.02), 1);
    expect(out.filter((o) => o.cmd.t === 'stop_track').map((o) => (o.cmd as { i: number }).i).sort()).toEqual([0, 1]);
  });

  it('a seek into the middle of a block fires it on the next beat at the matching place in the clip', () => {
    const { s, out } = scheduler();
    s.setBlocks([row('r', 2)], [blk('a', 'r', 2, 10, 4)]);
    cur = 5.1;
    s.tick(5.1, true, 1);
    expect(out).toHaveLength(1);
    // Earliest Live can make: 5.1 + 0.02 + 0.1 + 0.02 = 5.24 → next beat 5.5 = 7 beats into the block.
    expect(out[0].cmd).toEqual({ t: 'fire_clip', i: 2, s: 4, q: LIVE_Q_QUARTER, pos: 7 });
    // Playing on from there sends nothing more until the end.
    run(s, out, 5.1 + 1 / 60, 10, 1);
    expect(out.slice(1).map((o) => o.cmd.t)).toEqual(['stop_track']);
  });

  it('a seek out of a block stops the track it left playing', () => {
    const { s, out } = scheduler();
    s.setBlocks([row('r', 2)], [blk('a', 'r', 1, 5, 4)]);
    run(s, out, 0, 2);
    out.length = 0;
    cur = 8;
    s.tick(8, true, 2);
    // Live is told once the playhead has rested (a drag would be many seeks).
    expect(out).toHaveLength(0);
    run(s, out, 8 + 1 / 60, 8.3, 2);
    expect(out.map((o) => o.cmd)).toEqual([{ t: 'stop_track', i: 2, q: LIVE_Q_NONE }]);
  });

  it('dragging the playhead while playing sends nothing until it rests, then one fire at the place', () => {
    const { s, out } = scheduler();
    s.setBlocks([row('r', 2)], [blk('a', 'r', 2, 20, 4)]);
    run(s, out, 0, 0.5);
    // A drag: a new seek every frame from 4 s to 9 s.
    let seek = 1;
    for (let t = 4; t < 9; t += 0.1) {
      cur = t;
      clock += 1000 / 60;
      s.tick(t, true, seek++);
    }
    expect(out).toHaveLength(0);
    run(s, out, 9, 9.4, seek - 1);
    expect(out.map((o) => o.cmd)).toEqual([{ t: 'fire_clip', i: 2, s: 4, q: LIVE_Q_QUARTER, pos: expect.any(Number) }]);
    // At the place the playhead rested: the next beat Live can make after the settle.
    const pos = (out[0].cmd as { pos: number }).pos;
    expect(pos).toBeGreaterThan(14);
    expect(pos).toBeLessThan(16);
    expect(Number.isInteger(pos)).toBe(true);
  });

  it('Stop stops everything in Live, once', () => {
    const { s, out } = scheduler();
    s.setBlocks([row('r', 0)], [blk('a', 'r', 1, 5)]);
    run(s, out, 0, 2);
    s.tick(2, false, 0);
    s.tick(2, false, 0);
    expect(out.map((o) => o.cmd.t)).toEqual(['fire_clip', 'stop_all']);
    expect(out[1].cmd).toEqual({ t: 'stop_all', q: LIVE_Q_NONE });
  });

  it('loops: the first block is fired before the wrap for the next pass, and not again after it', () => {
    const { s, out } = scheduler(env(5, { loop: true, duration: 8 }));
    s.setBlocks([row('r', 0)], [blk('a', 'r', 0, 4, 0), blk('b', 'r', 4, 8, 1)]);
    run(s, out, 0, 7.99, 0);
    // Wrap: the show bumps its seek generation.
    run(s, out, 0, 1, 1);
    const fires = out.filter((o) => o.cmd.t === 'fire_clip').map((o) => [(o.cmd as { s: number }).s, Math.round(o.t * 100) / 100]);
    expect(fires.map((f) => f[0])).toEqual([0, 1, 0]);
    expect(fires[2][1]).toBeCloseTo(8 - fireLead(0.5, 0.02), 1);
    // No stop between b and the wrapped a.
    expect(out.filter((o) => o.cmd.t === 'stop_track')).toHaveLength(0);
  });

  it('an old script (protocol 4): no per-launch quantise, the set’s grid, no mid-block entry', () => {
    const { s, out } = scheduler(env(4, { setQuantize: 4 }));
    s.setBlocks([row('r', 0)], [blk('a', 'r', 4, 8)]);
    run(s, out, 0, 9);
    expect(out[0].cmd).toEqual({ t: 'fire_clip', i: 0, s: 0 });
    // The set quantises to a bar: half a bar ahead.
    expect(out[0].t).toBeCloseTo(4 - 1 - 0.02, 1);
    expect(out[1].cmd).toEqual({ t: 'stop_track', i: 0 });
    out.length = 0;
    cur = 5;
    s.tick(5, true, 9);
    run(s, out, 5, 5.5, 9);
    expect(out.filter((o) => o.cmd.t === 'fire_clip')).toHaveLength(0);
  });

  it('missing clips and muted rows fire nothing', () => {
    const { s, out } = scheduler();
    s.setBlocks([row('r', 0), row('m', 1, { audible: false })], [blk('a', 'r', 1, 3, null), blk('b', 'm', 1, 3, 0)]);
    run(s, out, 0, 4);
    expect(out).toHaveLength(0);
  });

  it('flags blocks that are not on the grid', () => {
    expect(offGrid(2, 'beat', env())).toBe(false);
    expect(offGrid(2.2, 'beat', env())).toBe(true);
    expect(offGrid(3, 'bar', env())).toBe(true);
    expect(offGrid(4, 'bar', env())).toBe(false);
  });
});

describe('Live clip blocks: the mirrored set', () => {
  const tracks = [
    { name: 'Drums', color: 0, slots: [{ name: 'Beat A', color: 1, length: 4 }, null, { name: 'Fill', color: 2, length: 1 }] },
    { name: 'Bass', color: 0, slots: [null, { name: 'Sub', color: 3, length: 8 }] },
  ];
  it('finds the track by name first (tracks move), then by index', () => {
    expect(resolveLiveTrack({ track: 0, trackName: 'Bass' }, tracks)).toBe(1);
    expect(resolveLiveTrack({ track: 1, trackName: '' }, tracks)).toBe(1);
    expect(resolveLiveTrack({ track: 0, trackName: 'Gone' }, tracks)).toBeNull();
    expect(resolveLiveTrack(undefined, tracks)).toBeNull();
  });
  it('a clip that moved slot is found by name; an empty slot is a missing clip', () => {
    expect(resolveLiveSlot({ slot: 0, clipName: 'Beat A' }, tracks[0])).toBe(0);
    expect(resolveLiveSlot({ slot: 1, clipName: 'Fill' }, tracks[0])).toBe(2);
    expect(resolveLiveSlot({ slot: 1, clipName: 'Gone' }, tracks[0])).toBeNull();
    expect(resolveLiveSlot({ slot: 0, clipName: 'Renamed' }, tracks[0])).toBe(0);
  });
});

describe('Live clip blocks: from the Timeline and the mirrored set', () => {
  const set = { tracks: [
    { name: 'Drums', color: 0, slots: [{ name: 'Beat A', color: 1, length: 4 }, null] },
    { name: 'Bass', color: 0, slots: [{ name: 'Sub', color: 2, length: 8 }] },
  ] };
  const live = (id: string, track: string, extra: Partial<SoundRow> = {}): SoundRow => ({
    ...defaultSoundRow(0, 'live'), id, name: track, live: { track: -1, trackName: track, launch: 'bar', latencyMs: 30 }, ...extra,
  });

  it('missing clips and tracks: the block stays (drawn as missing) but fires nothing', () => {
    const rows = [live('d', 'Drums'), live('b', 'Bass'), live('g', 'Gone')];
    const sound = { live: [
      { id: 'ok', lane: 0, startTime: 0, duration: 4, slot: 0, clipName: 'Beat A', color: 1 },
      { id: 'empty', lane: 0, startTime: 4, duration: 4, slot: 1, clipName: 'Deleted', color: 1 },
      { id: 'moved', lane: 1, startTime: 0, duration: 4, slot: 3, clipName: 'Sub', color: 2 },
      { id: 'notrack', lane: 2, startTime: 0, duration: 4, slot: 0, clipName: 'X', color: 0 },
    ] };
    const out = liveSchedInputs(sound, rows, set);
    expect(out.rows.map((r) => [r.rowId, r.track, r.launch, r.latency])).toEqual([['d', 0, 'bar', 0.03], ['b', 1, 'bar', 0.03], ['g', null, 'bar', 0.03]]);
    expect(out.blocks.map((b) => [b.id, b.slot])).toEqual([['ok', 0], ['empty', null], ['moved', 0], ['notrack', null]]);
    // Fed to the scheduler: only the clips that exist go out.
    const { s, out: sent } = scheduler();
    s.setBlocks(out.rows, out.blocks);
    run(s, sent, 0, 9);
    expect(sent.filter((o) => o.cmd.t === 'fire_clip').map((o) => [(o.cmd as { i: number }).i, (o.cmd as { s: number }).s])).toEqual([[0, 0], [1, 0]]);
  });

  it('a muted Live row (or one left out by a solo) fires nothing', () => {
    const rows = [live('d', 'Drums', { muted: true }), live('b', 'Bass'), live('x', 'Bass', { solo: true })];
    const out = liveSchedInputs({ live: [] }, rows, set);
    expect(out.rows.map((r) => r.audible)).toEqual([false, false, true]);
  });
});
