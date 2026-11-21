import { describe, expect, it } from 'vitest';
import { clipHasNotes, duplicateClip, normalizeClip, normalizeSession } from './session';
import { evictions, rateFor } from './sessionAudio';
import { normalizeStationData } from './loopTrack';

const ref = { kind: 'local-file', name: 'Loop.wav', originalPath: '/tmp/Loop.wav' };
const raw = { kind: 'audio', id: 'a1', name: 'Gtr', bars: 4, bpm: 120, src: 'ghost-asset://localhost/tmp/Loop.wav', _assetRef: ref, level: 0.6 };

describe('audio clips in the session', () => {
  it('keep their file reference, length, tempo and level', () => {
    const clip = normalizeClip(raw);
    expect(clip).toMatchObject({ kind: 'audio', bars: 4, bpm: 120, level: 0.6, _assetRef: ref });
    expect(normalizeClip({ ...raw, src: '', _assetRef: undefined })).toBeNull();
    expect(normalizeClip({ ...raw, bars: 999, level: 7 })).toMatchObject({ bars: 64, level: 1 });
    const copy = duplicateClip(clip!, 'a2');
    expect(copy).toMatchObject({ id: 'a2', kind: 'audio', name: 'Gtr copy' });
    expect(clipHasNotes(clip!)).toBe(true);
  });

  it('live on the melodic parts, never the beat track', () => {
    const s = normalizeSession({ beats: [raw], texture: [{ ...raw, id: 'a3' }] })!;
    expect(s.beats[0]).toBeNull();
    expect(s.texture[0]?.kind).toBe('audio');
  });

  it('follow the tempo and keep the decoded cache bounded', () => {
    expect(rateFor(240, 120)).toBe(2);
    expect(rateFor(0, 120)).toBe(1);
    const mb = 1024 * 1024;
    const out = evictions([{ id: 'old', bytes: 200 * mb, used: 1 }, { id: 'playing', bytes: 200 * mb, used: 0 }, { id: 'new', bytes: 10 * mb, used: 5 }], new Set(['playing']), 256 * mb);
    expect(out).toEqual(['old']);
  });
});

describe('audio loop tracks in the project', () => {
  it('keep their saved layers and timing', () => {
    const d = normalizeStationData({ tracks: [null, null, null, null, { kind: 'audio', audio: { bars: 4, beatMs: 500, originBeat: 8, layers: [{ src: 'a.wav', _assetRef: ref }, { junk: 1 }] } }] });
    expect(d.tracks[4].audio).toEqual({ bars: 4, beatMs: 500, originBeat: 8, layers: [{ src: 'a.wav', _assetRef: ref }] });
    expect(normalizeStationData({ tracks: [{ kind: 'midi', audio: { layers: [{ src: 'x' }] } }] }).tracks[0].audio).toBeUndefined();
  });
});
