import { describe, expect, it } from 'vitest';
import {
  addRowFx,
  addSoundRow,
  blockGainAt,
  effectiveFades,
  EMPTY_SOUND_DOC,
  fadeCurve,
  materializeRows,
  moveSoundBlock,
  normalizeSoundDoc,
  removeSoundRow,
  retimeBlock,
  rowAudible,
  setBlockFade,
  setRowFxParam,
  soundRowsFor,
  trimSoundBlock,
  updateSoundRow,
} from './soundModel';

const block = (id: string, startTime: number, duration: number, extra: Record<string, unknown> = {}) => ({
  id, startTime, duration, lane: 0, offset: 0, sourceDuration: 60, ...extra,
});

describe('sound rows: the model', () => {
  it('fills rows for every lane in use, with ids that stay put when one is stored', () => {
    const tracks = [{ lane: 0 }, { lane: 2 }];
    const rows = soundRowsFor(EMPTY_SOUND_DOC, tracks);
    expect(rows.map((r) => r.id)).toEqual(['row-0', 'row-1', 'row-2']);
    expect(rows[0].name).toBe('Song');
    const doc = updateSoundRow(EMPTY_SOUND_DOC, tracks, 'row-1', { volume: 0.5 });
    expect(doc.rows.map((r) => r.id)).toEqual(['row-0', 'row-1', 'row-2']);
    expect(doc.rows[1].volume).toBe(0.5);
    expect(soundRowsFor(doc, tracks)).toBe(doc.rows);
  });

  it('saves and reads back rows, Live clip blocks and builds; junk is dropped', () => {
    let doc = addSoundRow(EMPTY_SOUND_DOC, [], 'live', 'L1', 'Drums');
    doc = updateSoundRow(doc, [], 'L1', { live: { track: 3, trackName: 'Drums', launch: 'bar', latencyMs: 35 } });
    doc = { ...doc, live: [{ id: 'c1', lane: 1, startTime: 2, duration: 4, slot: 2, clipName: 'Beat', color: 0xff8800 }], builds: [{ id: 'b1', lane: 0, startTime: 8, duration: 8, style: 'dub', roll: 'clap', filter: 'lowpass', riser: 0.5, sends: 1, gap: false, impact: 0.6 }] };
    const row = addRowFx(doc.rows[0], 'delay', 'fx1');
    doc = updateSoundRow(doc, [], row.id, { fx: setRowFxParam(row, 'fx1', 'feedback', 0.8).fx });
    const back = normalizeSoundDoc(JSON.parse(JSON.stringify({ ...doc, live: [...doc.live, { nope: true }], builds: [...doc.builds, 7] })));
    expect(back).toEqual(doc);
    expect(normalizeSoundDoc(null)).toBe(EMPTY_SOUND_DOC);
    expect(normalizeSoundDoc({ rows: 'x' })).toBe(EMPTY_SOUND_DOC);
  });

  it('a row effect starts audible: the studio default of mix 0 opens a little', () => {
    const row = addRowFx(soundRowsFor(EMPTY_SOUND_DOC, [])[0], 'reverb', 'r');
    expect(row.fx[0].params.mix.value).toBeGreaterThan(0);
    expect(row.fx[0].type).toBe('reverb');
  });

  it('removing a row removes its blocks and moves the rows below up', () => {
    const tracks = [{ id: 'a', lane: 0 }, { id: 'b', lane: 1 }, { id: 'c', lane: 2 }];
    const doc = { ...materializeRows(EMPTY_SOUND_DOC, tracks), live: [{ id: 'l', lane: 2, startTime: 0, duration: 1, slot: 0, clipName: '', color: 0 }], builds: [] };
    const out = removeSoundRow(doc, tracks, 'row-1');
    expect(out.tracks).toEqual([{ id: 'a', lane: 0 }, { id: 'c', lane: 1 }]);
    expect(out.doc.rows.map((r) => r.id)).toEqual(['row-0', 'row-2']);
    expect(out.doc.live[0].lane).toBe(1);
  });

  it('mute and solo', () => {
    const rows = [{ muted: false, solo: false }, { muted: false, solo: true }, { muted: true, solo: true }];
    expect(rows.map((r) => rowAudible(r, rows))).toEqual([false, true, false]);
    const none = [{ muted: false, solo: false }, { muted: true, solo: false }];
    expect(none.map((r) => rowAudible(r, none))).toEqual([true, false]);
  });
});

describe('sound blocks: fades, crossfades and edits', () => {
  it('fades are equal power and the block is silent outside itself', () => {
    const b = block('a', 10, 8, { fadeIn: 2, fadeOut: 4 });
    expect(blockGainAt(b, 9.99)).toBe(0);
    expect(blockGainAt(b, 10)).toBe(0);
    expect(blockGainAt(b, 11)).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(blockGainAt(b, 12)).toBe(1);
    expect(blockGainAt(b, 16)).toBeCloseTo(fadeCurve(0.5), 6);
    expect(blockGainAt(b, 18)).toBe(0);
  });

  it('an overlap on a row is an equal-power crossfade: the two add up to constant power', () => {
    const a = block('a', 0, 10);
    const b = block('b', 7, 10);
    const row = [a, b];
    const fa = effectiveFades(a, row);
    const fb = effectiveFades(b, row);
    expect(fa).toEqual({ fadeIn: 0, fadeOut: 3 });
    expect(fb).toEqual({ fadeIn: 3, fadeOut: 0 });
    for (let t = 7; t < 10; t += 0.25) {
      const ga = blockGainAt(a, t, fa);
      const gb = blockGainAt(b, t, fb);
      expect(ga * ga + gb * gb).toBeCloseTo(1, 6);
    }
    expect(blockGainAt(a, 6.9, fa)).toBe(1);
    expect(blockGainAt(b, 10, fb)).toBe(1);
  });

  it('fades never add up to more than the block', () => {
    const b = block('a', 0, 4, { fadeIn: 3, fadeOut: 3 });
    const f = effectiveFades(b, [b]);
    expect(f.fadeIn + f.fadeOut).toBeCloseTo(4, 9);
    expect(setBlockFade(block('x', 0, 4, { fadeOut: 3 }), 'in', 5).fadeIn).toBe(1);
  });

  it('moving onto another block is allowed (it crossfades); trimming keeps the sound under the edge', () => {
    const a = block('a', 4, 10, { offset: 2, sourceDuration: 20 });
    expect(moveSoundBlock(a, 3, 2)).toMatchObject({ startTime: 3, lane: 2 });
    const head = trimSoundBlock(a, 'start', 6);
    expect(head).toMatchObject({ startTime: 6, duration: 8, offset: 4 });
    // Not before the start of the file, not past its end.
    expect(trimSoundBlock(a, 'start', 0)).toMatchObject({ startTime: 2, offset: 0, duration: 12 });
    expect(trimSoundBlock(a, 'end', 100).duration).toBe(18);
    expect(trimSoundBlock(block('f', 0, 4, { fadeIn: 1, fadeOut: 3 }), 'end', 2)).toMatchObject({ duration: 2, fadeIn: 1, fadeOut: 1 });
  });

  it('Live and build blocks retime the same way', () => {
    const b = { startTime: 4, duration: 4 };
    expect(retimeBlock(b, 'move', 8)).toEqual({ startTime: 8, duration: 4 });
    expect(retimeBlock(b, 'start', 6)).toEqual({ startTime: 6, duration: 2 });
    expect(retimeBlock(b, 'end', 4.1)).toEqual({ startTime: 4, duration: 0.25 });
  });
});
