/**
 * Live clip blocks: when to tell Live to fire and stop them.
 *
 * Live starts a clip on its own launch grid (its "launch quantise"), sample
 * accurate, aligned with the Timeline when Link is following. The Ghost
 * Arcade script only reads requests about ten times a second, so a request
 * sent right at a block's start would land up to 100 ms late. Instead each
 * fire goes out ahead of the block, inside the grid step before it, and
 * Live starts it on the step: exactly at the block's start when the block
 * sits on the grid (blocks snap to beats).
 *
 * - Script protocol 5 and later take a launch quantise per request (`q`,
 *   Live's own numbering): a row fires on the beat (1/4) or the bar, or uses
 *   the set's setting. Older scripts ignore `q` and Live uses the set's.
 * - Entering a block in the middle (play from there, a seek, a loop wrap)
 *   fires it on the next grid step with `pos`, the beats into the clip it
 *   should be at; protocol 5 jumps the clip there once it plays. Older
 *   scripts cannot, so such a block waits for its next start.
 * - A block ends with stop_track, unless the next block on the row starts
 *   where it ends (that fire takes over the track). Transport stop stops all
 *   clips (`stop_all`).
 * - A phrase landing on a bar (timeline/phrases): `entryPlan` says what to
 *   send ahead of the bar for the place the playhead will land on (each
 *   row's fire inside its own grid step, stops for tracks it leaves); the
 *   caller sends them on time, `primeEntry` says they went out (so the jump
 *   does not fire them again), and `setCut` keeps the playing phrase from
 *   firing or stopping anything past its last bar.
 *
 * Pure apart from its own bookkeeping: time comes in, commands go out.
 */
import { beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';
import type { ShowTempoMap } from '../../types';
import { quantizeBeats } from '../../ableton/abletonLinks';
import { rowAudible, type LiveLaunch, type SoundDoc, type SoundRow } from './soundModel';

/** The script reads requests this often (seconds), worst case. */
export const SCRIPT_TICK_SECONDS = 0.1;
/** Live's launch quantise numbering (Song.clip_trigger_quantization). */
export const LIVE_Q_NONE = 0;
export const LIVE_Q_BAR = 4;
export const LIVE_Q_QUARTER = 7;
/** The script protocol that takes `q` and `pos` on fire_clip and `q` on stops. */
export const LIVE_TIMELINE_PROTOCOL = 5;

export type LiveCommand =
  | { t: 'fire_clip'; i: number; s: number; q?: number; pos?: number }
  | { t: 'stop_track'; i: number; q?: number }
  | { t: 'stop_all'; q?: number };

export interface LiveEnv {
  tempo: ShowTempoMap | null;
  /** The set's launch quantise (Live's numbering). */
  setQuantize: number;
  numerator: number;
  denominator: number;
  /** Script protocol (0 unknown). */
  protocol: number;
  /** The Timeline loops, and how long it is (seconds). */
  loop?: boolean;
  duration?: number;
}

export interface LiveSchedRow {
  rowId: string;
  /** The Live track index, or null when the row is not bound / not found. */
  track: number | null;
  launch: LiveLaunch;
  latency: number;
  /** Mute / solo allow it. */
  audible: boolean;
}

export interface LiveSchedBlock {
  id: string;
  rowId: string;
  start: number;
  end: number;
  /** Null: the clip is missing (nothing to fire). */
  slot: number | null;
}

const DEFAULT_BPM = 120;

function quarterAt(env: LiveEnv, t: number): number {
  return env.tempo ? beatAtSeconds(env.tempo, t) : (t * DEFAULT_BPM) / 60;
}

function secondsAtQuarter(env: LiveEnv, q: number): number {
  return env.tempo ? secondsAtBeat(env.tempo, q) : (q * 60) / DEFAULT_BPM;
}

function barQuarters(env: LiveEnv): number {
  const seg = env.tempo?.segments[0];
  if (seg) return seg.beatsPerBar * (4 / seg.beatUnit);
  return Math.max(1, env.numerator) * (4 / Math.max(1, env.denominator));
}

/** The grid a row's clips start on: quarters per step (0 = none) and the `q` to send. */
export function rowQuantum(launch: LiveLaunch, env: LiveEnv): { quarters: number; q?: number } {
  const perFire = env.protocol >= LIVE_TIMELINE_PROTOCOL;
  if (perFire && launch === 'beat') return { quarters: 1, q: LIVE_Q_QUARTER };
  if (perFire && launch === 'bar') return { quarters: barQuarters(env), q: LIVE_Q_BAR };
  return { quarters: quantizeBeats(env.setQuantize, env.numerator, env.denominator) };
}

/**
 * How early a fire goes out for a block that starts on a grid step of
 * `stepSeconds`: inside the step before it, with room for the script's
 * tick, plus the row's latency. With no grid the request lands within a
 * script tick of the start (centred on it).
 */
export function fireLead(stepSeconds: number, latency: number): number {
  if (!(stepSeconds > 0)) return latency + SCRIPT_TICK_SECONDS / 2;
  const lo = SCRIPT_TICK_SECONDS + 0.03;
  const hi = stepSeconds - 0.02;
  const lead = hi < lo ? stepSeconds * 0.8 : Math.max(lo, Math.min(stepSeconds / 2, hi));
  return latency + lead;
}

/** Seconds of the grid step that ends at `t` for a row (0 when none). */
function stepSecondsAt(env: LiveEnv, quarters: number, t: number): number {
  if (!(quarters > 0)) return 0;
  const q = quarterAt(env, t);
  return t - secondsAtQuarter(env, q - quarters);
}

/** A block start not on the row's grid: Live will start it at the next step. */
export function offGrid(start: number, launch: LiveLaunch, env: LiveEnv): boolean {
  const { quarters } = rowQuantum(launch, env);
  if (!(quarters > 0)) return false;
  const q = quarterAt(env, start) / quarters;
  return Math.abs(q - Math.round(q)) * quarters > 0.02;
}

/** The first grid step at or after `t` (seconds). */
function nextStep(env: LiveEnv, quarters: number, t: number): number {
  if (!(quarters > 0)) return t;
  const q = quarterAt(env, t);
  return secondsAtQuarter(env, Math.ceil(q / quarters - 1e-6) * quarters);
}

export interface LiveSchedulerOptions {
  send: (cmd: LiveCommand) => void;
  /** Wall clock, ms (tests pass their own). */
  now?: () => number;
}

/** A jump while playing waits this long (ms) for the playhead to settle, so
 *  dragging it does not fire a clip in Live on every frame. */
export const SCRUB_SETTLE_MS = 120;

export class LiveClipScheduler {
  private rows = new Map<string, LiveSchedRow>();
  private blocks: LiveSchedBlock[] = [];
  private env: LiveEnv = { tempo: null, setQuantize: 4, numerator: 4, denominator: 4, protocol: 0 };
  private fired = new Set<string>();
  private stopped = new Set<string>();
  /** Fired before a loop wrap for the next pass. */
  private preFired = new Set<string>();
  /** Tracks this Timeline started a clip on (and has not stopped). */
  private owned = new Set<number>();
  private wasPlaying = false;
  private lastSeek = Number.NaN;
  /** A jump waiting for the playhead to settle (wall ms it may run at). */
  private settleAt: number | null = null;
  /** Blocks a phrase landing already fired (see primeEntry). */
  private primed = new Set<string>();
  /** The playing phrase ends here (show seconds): nothing past it fires. */
  private cut: number | null = null;

  constructor(private readonly opts: LiveSchedulerOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  setEnv(env: LiveEnv): void {
    this.env = env;
  }

  setBlocks(rows: readonly LiveSchedRow[], blocks: readonly LiveSchedBlock[]): void {
    this.rows = new Map(rows.map((r) => [r.rowId, r]));
    this.blocks = blocks.slice().sort((a, b) => a.start - b.start);
  }

  /** Commands go out here (recorded by tests). */
  private send(cmd: LiveCommand): void {
    if (cmd.t === 'fire_clip') this.owned.add(cmd.i);
    if (cmd.t === 'stop_track') this.owned.delete(cmd.i);
    if (cmd.t === 'stop_all') this.owned.clear();
    this.opts.send(cmd);
  }

  private quantum(row: LiveSchedRow) {
    return rowQuantum(row.launch, this.env);
  }

  private leadFor(row: LiveSchedRow, start: number): number {
    const { quarters } = this.quantum(row);
    return fireLead(stepSecondsAt(this.env, quarters, start), row.latency);
  }

  private stopLeadFor(row: LiveSchedRow, end: number): number {
    // A stop with q = 0 is immediate; an old script's stop waits for the set's grid.
    if (this.env.protocol >= LIVE_TIMELINE_PROTOCOL) return row.latency + SCRIPT_TICK_SECONDS / 2;
    return this.leadFor(row, end);
  }

  private takesOver(block: LiveSchedBlock): boolean {
    return this.blocks.some((b) => b !== block && b.rowId === block.rowId && b.slot !== null && Math.abs(b.start - block.end) < 1e-3);
  }

  /** The block ends at the loop's end and the row's first block was fired for the next pass. */
  private wrapsInto(block: LiveSchedBlock, loopEnd: number): boolean {
    if (!loopEnd || Math.abs(block.end - loopEnd) > 1e-3) return false;
    return this.blocks.some((b) => b.rowId === block.rowId && b.start < 1e-3 && this.preFired.has(b.id));
  }

  private fire(row: LiveSchedRow, block: LiveSchedBlock, pos?: number): void {
    if (row.track === null || block.slot === null) return;
    const { q } = this.quantum(row);
    const cmd: LiveCommand = { t: 'fire_clip', i: row.track, s: block.slot };
    if (q !== undefined) cmd.q = q;
    if (pos !== undefined && pos > 1e-6) cmd.pos = Math.round(pos * 1000) / 1000;
    this.send(cmd);
  }

  private stopTrack(track: number): void {
    const cmd: LiveCommand = { t: 'stop_track', i: track };
    if (this.env.protocol >= LIVE_TIMELINE_PROTOCOL) cmd.q = LIVE_Q_NONE;
    this.send(cmd);
  }

  /**
   * Enter a block part way through at show time `t`: it starts on the next
   * grid step Live can still make, at the matching place in the clip.
   * Returns false when it cannot (an old script, or the block ends first).
   */
  private enterMidBlock(row: LiveSchedRow, block: LiveSchedBlock, t: number): boolean {
    if (this.env.protocol < LIVE_TIMELINE_PROTOCOL) return false;
    const { quarters } = this.quantum(row);
    const earliest = t + row.latency + SCRIPT_TICK_SECONDS + 0.02;
    const at = nextStep(this.env, quarters, earliest);
    if (at >= block.end - 0.05) return false;
    const pos = quarterAt(this.env, at) - quarterAt(this.env, block.start);
    this.fire(row, block, Math.max(0, pos));
    return true;
  }

  /** Where everything should be at `t` after a jump (play, seek, loop wrap). */
  private resync(t: number): void {
    const keepPre = this.preFired;
    const primed = this.primed;
    this.primed = new Set();
    this.fired.clear();
    this.stopped.clear();
    this.preFired = new Set();
    const activeTracks = new Set<number>();
    for (const row of this.rows.values()) {
      if (row.track === null || !row.audible) continue;
      for (const b of this.blocks) {
        if (b.rowId !== row.rowId) continue;
        if (b.end <= t) {
          this.fired.add(b.id);
          this.stopped.add(b.id);
          continue;
        }
        const lead = this.leadFor(row, b.start);
        if (t < b.start - lead) continue; // still to come: the regular pass fires it
        if (b.slot === null) {
          this.fired.add(b.id);
          continue;
        }
        if (primed.has(b.id)) {
          // A phrase landing fired it ahead of the bar: it is starting now.
          this.fired.add(b.id);
          activeTracks.add(row.track);
          continue;
        }
        if (keepPre.has(b.id) && t < b.start + 0.25) {
          // Fired just before the loop wrapped: it is starting now.
          this.fired.add(b.id);
          activeTracks.add(row.track);
          continue;
        }
        this.fired.add(b.id);
        if (t < b.start) {
          this.fire(row, b);
          activeTracks.add(row.track);
        } else if (this.enterMidBlock(row, b, t)) {
          activeTracks.add(row.track);
        } else {
          this.stopped.add(b.id);
        }
      }
    }
    // Tracks this Timeline left playing that nothing plays now.
    for (const track of [...this.owned]) if (!activeTracks.has(track)) this.stopTrack(track);
  }

  private regular(t: number): void {
    const loopAhead = this.env.loop && (this.env.duration ?? 0) > 0 ? this.env.duration! : 0;
    const cut = this.cut;
    for (const b of this.blocks) {
      const row = this.rows.get(b.rowId);
      if (!row || row.track === null) continue;
      // Past the playing phrase's last bar the next phrase owns the tracks.
      if (cut !== null && b.start >= cut - 1e-3) continue;
      if (cut !== null && b.end > cut + 1e-3 && this.fired.has(b.id)) continue;
      if (!row.audible) {
        if (this.fired.has(b.id) && !this.stopped.has(b.id) && b.end > t && b.start <= t) {
          this.stopped.add(b.id);
          if (this.owned.has(row.track)) this.stopTrack(row.track);
        }
        continue;
      }
      if (loopAhead && !this.preFired.has(b.id) && b.slot !== null && b.start < loopAhead) {
        const lead = this.leadFor(row, b.start);
        if (t >= loopAhead + b.start - lead && t < loopAhead && t > b.end) {
          // The loop wraps into this block: fire it for the next pass.
          this.preFired.add(b.id);
          this.fire(row, b);
          continue;
        }
      }
      if (!this.fired.has(b.id)) {
        const lead = this.leadFor(row, b.start);
        if (t >= b.start - lead && t < b.end) {
          this.fired.add(b.id);
          if (b.slot === null) continue;
          if (t <= b.start) this.fire(row, b);
          else if (!this.enterMidBlock(row, b, t)) this.stopped.add(b.id);
        }
        continue;
      }
      if (!this.stopped.has(b.id) && b.slot !== null) {
        const stopAt = b.end - this.stopLeadFor(row, b.end);
        if (t >= stopAt) {
          this.stopped.add(b.id);
          if (!this.takesOver(b) && !this.wrapsInto(b, loopAhead)) this.stopTrack(row.track);
        }
      }
    }
  }

  /** Every evaluation of the Timeline: `seek` changes on every jump (scrub, loop wrap). */
  tick(t: number, playing: boolean, seek: number): void {
    if (!playing) {
      if (this.wasPlaying) this.stopAll();
      this.wasPlaying = false;
      this.lastSeek = seek;
      return;
    }
    const start = !this.wasPlaying;
    const jump = !start && seek !== this.lastSeek;
    this.wasPlaying = true;
    this.lastSeek = seek;
    if (start) {
      this.settleAt = null;
      this.cut = null;
      this.resync(t);
      return;
    }
    if (jump && this.primed.size) {
      // A phrase landing on its bar: its clips are already on their way.
      this.settleAt = null;
      this.cut = null;
      this.resync(t);
      return;
    }
    if (jump) {
      // Scrubbing while playing: Live keeps what it plays until the playhead rests.
      this.settleAt = this.now() + SCRUB_SETTLE_MS;
      return;
    }
    if (this.settleAt !== null) {
      if (this.now() < this.settleAt) return;
      this.settleAt = null;
      this.resync(t);
      return;
    }
    this.regular(t);
  }

  /** Transport stop: everything in Live stops. */
  stopAll(): void {
    if (this.rows.size === 0 && this.owned.size === 0) return;
    const cmd: LiveCommand = { t: 'stop_all' };
    if (this.env.protocol >= LIVE_TIMELINE_PROTOCOL) cmd.q = LIVE_Q_NONE;
    this.send(cmd);
    this.fired.clear();
    this.stopped.clear();
    this.preFired.clear();
  }

  /**
   * Landing at show time `to` on a grid step (a phrase on its bar): for each
   * audible Live row, the fire for the block there (with `pos` when the
   * block started earlier: protocol 5) and how far ahead of the bar to send
   * it; and the tracks this Timeline leaves playing that nothing at `to`
   * plays, with their stop lead.
   */
  entryPlan(to: number): { fires: Array<{ blockId: string; track: number; lead: number; cmd: LiveCommand }>; stops: Array<{ track: number; lead: number }> } {
    const fires: Array<{ blockId: string; track: number; lead: number; cmd: LiveCommand }> = [];
    const used = new Set<number>();
    let stopLead = SCRIPT_TICK_SECONDS / 2;
    for (const row of this.rows.values()) {
      if (row.track === null || !row.audible) continue;
      stopLead = Math.max(stopLead, this.stopLeadFor(row, to));
      const b = this.blocks.find((x) => x.rowId === row.rowId && x.start <= to + 1e-3 && x.end > to + 0.05);
      if (!b || b.slot === null) continue;
      const pos = Math.max(0, quarterAt(this.env, to) - quarterAt(this.env, b.start));
      if (pos > 0.01 && this.env.protocol < LIVE_TIMELINE_PROTOCOL) continue;
      const { q } = this.quantum(row);
      const cmd: LiveCommand = { t: 'fire_clip', i: row.track, s: b.slot };
      if (q !== undefined) cmd.q = q;
      if (pos > 0.01) cmd.pos = Math.round(pos * 1000) / 1000;
      fires.push({ blockId: b.id, track: row.track, lead: this.leadFor(row, to), cmd });
      used.add(row.track);
    }
    const stops = [...this.owned].filter((track) => !used.has(track)).map((track) => ({ track, lead: stopLead }));
    return { fires, stops };
  }

  /** Send one of entryPlan's commands (the scheduler keeps track of what it owns). */
  sendEntry(cmd: LiveCommand): void {
    this.send(cmd);
  }

  /** Stop a track as part of a landing (unquantised with protocol 5). */
  stopForEntry(track: number): void {
    if (this.owned.has(track)) this.stopTrack(track);
  }

  /** These blocks were fired for a landing: the jump treats them as playing. */
  primeEntry(blockIds: readonly string[]): void {
    this.primed = new Set(blockIds);
    // An empty landing still lands at once (no scrub settle).
    if (!blockIds.length) this.primed.add('\u0000');
  }

  /** The playing phrase ends at `at` (show seconds), or null. */
  setCut(at: number | null): void {
    this.cut = at;
  }

  /** Forget everything (the document changed hands). */
  reset(): void {
    this.primed.clear();
    this.cut = null;
    this.fired.clear();
    this.stopped.clear();
    this.preFired.clear();
    this.owned.clear();
    this.wasPlaying = false;
    this.lastSeek = Number.NaN;
    this.settleAt = null;
  }
}

// ── The mirrored set ───────────────────────────────────────────────────────

export interface LiveClipInfo { name: string; color: number; length: number }
export interface LiveTrackInfo { name: string; color: number; slots: (LiveClipInfo | null)[] }

/** The Live track a row is bound to: by name first (tracks move), then by index. */
export function resolveLiveTrack(binding: { track: number; trackName: string } | undefined, tracks: readonly LiveTrackInfo[]): number | null {
  if (!binding) return null;
  if (binding.trackName) {
    const byName = tracks.findIndex((t) => t.name === binding.trackName);
    if (byName >= 0) return byName;
    return null;
  }
  return binding.track >= 0 && binding.track < tracks.length ? binding.track : null;
}

/** The slot a block plays: its own while the clip is there, else a clip with its name on the track, else null (missing). */
export function resolveLiveSlot(block: { slot: number; clipName: string }, track: LiveTrackInfo | undefined): number | null {
  if (!track) return null;
  const own = track.slots[block.slot];
  if (own && (!block.clipName || own.name === block.clipName)) return block.slot;
  if (block.clipName) {
    const moved = track.slots.findIndex((c) => c?.name === block.clipName);
    if (moved >= 0) return moved;
  }
  return own ? block.slot : null;
}

/** The Live rows and blocks as the scheduler wants them, from the doc and the mirrored set. */
export function liveSchedInputs(sound: Pick<SoundDoc, 'live'>, rows: SoundRow[], bridge: { tracks: readonly LiveTrackInfo[] }, mutes: (row: SoundRow) => boolean = (r) => r.muted): { rows: LiveSchedRow[]; blocks: LiveSchedBlock[] } {
  const schedRows: LiveSchedRow[] = [];
  rows.forEach((row) => {
    if (row.kind !== 'live') return;
    const mute = mutes(row);
    schedRows.push({
      rowId: row.id,
      track: resolveLiveTrack(row.live, bridge.tracks),
      launch: row.live?.launch ?? 'beat',
      latency: (row.live?.latencyMs ?? 20) / 1000,
      audible: rowAudible({ muted: mute, solo: row.solo }, rows),
    });
  });
  const blocks: LiveSchedBlock[] = [];
  for (const b of sound.live) {
    const row = rows[b.lane];
    if (!row || row.kind !== 'live') continue;
    const ti = resolveLiveTrack(row.live, bridge.tracks);
    blocks.push({ id: b.id, rowId: row.id, start: b.startTime, end: b.startTime + b.duration, slot: ti === null ? null : resolveLiveSlot(b, bridge.tracks[ti]) });
  }
  return { rows: schedRows, blocks };
}

