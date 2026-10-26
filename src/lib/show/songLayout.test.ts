import { describe, expect, it } from 'vitest';
import {
  analyzeSong,
  layoutEvenly,
  layoutOnBoundaries,
  layoutSong,
  SONG_MIN_CLIP_SECONDS,
  type SongLayoutClip,
} from './songLayout';

const presets = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];

/** Every layout covers the song exactly: no gap, no overlap, ends on the song's end. */
function expectCovers(clips: SongLayoutClip[], duration: number) {
  expect(clips.length).toBeGreaterThan(0);
  expect(clips[0].startTime).toBe(0);
  for (let i = 1; i < clips.length; i++) {
    expect(clips[i].startTime).toBeCloseTo(clips[i - 1].startTime + clips[i - 1].duration, 9);
  }
  const last = clips[clips.length - 1];
  expect(last.startTime + last.duration).toBeCloseTo(duration, 9);
  for (const c of clips) expect(c.duration).toBeGreaterThanOrEqual(SONG_MIN_CLIP_SECONDS);
}

describe('song layouts', () => {
  it('keep: no preset clips, the current look stays for the whole song', () => {
    expect(layoutSong('keep', presets, 200)).toEqual([]);
  });

  it('even: equal shares, cut points on the quarter-second grid, ending on the song end', () => {
    const clips = layoutEvenly(presets, 181.37);
    expect(clips.map((c) => c.compositionId)).toEqual(['a', 'b', 'c']);
    expectCovers(clips, 181.37);
    expect(clips[1].startTime % 0.25).toBe(0);
    expect(clips[2].startTime % 0.25).toBe(0);
    expect(Math.abs(clips[0].duration - 181.37 / 3)).toBeLessThan(0.25);
    expect(clips[0].label).toBe('Alpha');
  });

  it('even: one preset takes the whole song', () => {
    const clips = layoutEvenly([presets[0]], 95);
    expect(clips).toEqual([{ compositionId: 'a', startTime: 0, duration: 95, label: 'Alpha' }]);
  });

  it('even: never makes a clip shorter than the show allows', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
    const clips = layoutEvenly(many, 1);
    expectCovers(clips, 1);
    expect(clips.length).toBe(4);
  });

  it('sections: presets cycle over the cut points', () => {
    const clips = layoutOnBoundaries(presets, [30, 60, 90, 120], 150);
    expect(clips.map((c) => [c.compositionId, c.startTime, c.duration])).toEqual([
      ['a', 0, 30], ['b', 30, 30], ['c', 60, 30], ['a', 90, 30], ['b', 120, 30],
    ]);
  });

  it('sections: a single preset is one clip, not five', () => {
    const clips = layoutOnBoundaries([presets[0]], [30, 60, 90, 120], 150);
    expect(clips).toEqual([{ compositionId: 'a', startTime: 0, duration: 150, label: 'Alpha' }]);
  });

  it('sections: drops cut points outside the song, out of order or too close', () => {
    const clips = layoutOnBoundaries(presets, [200, 40, -3, 40.1, 20, 99.9], 100);
    expectCovers(clips, 100);
    expect(clips.map((c) => c.startTime)).toEqual([0, 20, 40]);
  });

  it('nothing to lay out without presets or a song', () => {
    expect(layoutSong('even', [], 100)).toEqual([]);
    expect(layoutSong('sections', presets, 0, [10])).toEqual([]);
  });
});

// ─── Synthetic audio ─────────────────────────────────────────────────────

const RATE = 22050;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
}

/** A decaying kick-like thump at each beat. */
function addClicks(out: Float32Array, from: number, to: number, bpm: number, level: number, phase = 0) {
  const period = 60 / bpm;
  for (let t = from + phase; t < to; t += period) {
    const start = Math.round(t * RATE);
    for (let i = 0; i < 0.06 * RATE && start + i < out.length; i++) {
      out[start + i] += level * Math.exp(-i / (0.012 * RATE)) * Math.sin((2 * Math.PI * 70 * i) / RATE);
    }
  }
}

function addNoise(out: Float32Array, from: number, to: number, level: number, seed = 1) {
  const r = rng(seed);
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE) && i < out.length; i++) out[i] += level * r();
}

function addTone(out: Float32Array, from: number, to: number, freq: number, level: number) {
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE) && i < out.length; i++) {
    out[i] += level * Math.sin((2 * Math.PI * freq * i) / RATE);
  }
}

describe('analyzeSong', () => {
  it('finds the tempo and the beat of a steady kick', () => {
    const song = new Float32Array(30 * RATE);
    addClicks(song, 0, 30, 120, 0.8, 0.1);
    const result = analyzeSong(song, RATE);
    expect(result.tempo).not.toBeNull();
    expect(Math.abs(result.tempo! - 120)).toBeLessThan(2);
    // Beats sit on the kicks: 0.1 s + n * 0.5 s.
    const offsets = result.beats.slice(2, 40).map((b) => {
      const d = (b - 0.1) / 0.5;
      return Math.abs(d - Math.round(d)) * 0.5;
    });
    expect(Math.max(...offsets)).toBeLessThan(0.05);
  });

  it('finds where the music changes, on the beat', () => {
    // Intro: quiet hiss. Drop at 24 s: loud noise and kicks. Break at 48 s: a high tone and kicks.
    const song = new Float32Array(72 * RATE);
    addNoise(song, 0, 24, 0.02, 1);
    addNoise(song, 24, 48, 0.4, 2);
    addTone(song, 48, 72, 4000, 0.3);
    addClicks(song, 0, 72, 120, 0.6);
    const result = analyzeSong(song, RATE, { minSection: 8 });
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    const near = (t: number) => result.sections.some((s) => Math.abs(s - t) <= 1.5);
    expect(near(24)).toBe(true);
    expect(near(48)).toBe(true);
    // Landed on beats (multiples of 0.5 s here).
    for (const s of result.sections) expect(Math.abs(s * 2 - Math.round(s * 2))).toBeLessThan(0.1);
  });

  it('splits a song with no changes into phrases, never too short or too long', () => {
    const song = new Float32Array(150 * RATE);
    addNoise(song, 0, 150, 0.1, 3);
    addClicks(song, 0, 150, 128, 0.6);
    const result = analyzeSong(song, RATE, { minSection: 8, maxSection: 45 });
    const edges = [0, ...result.sections, result.duration];
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < edges.length; i++) {
      const length = edges[i] - edges[i - 1];
      expect(length).toBeGreaterThanOrEqual(7.5);
      expect(length).toBeLessThanOrEqual(65);
    }
  });

  it('copes with silence and very short audio', () => {
    expect(analyzeSong(new Float32Array(10 * RATE), RATE)).toMatchObject({ tempo: null, beats: [] });
    expect(analyzeSong(new Float32Array(100), RATE).sections).toEqual([]);
    expect(analyzeSong(new Float32Array(0), RATE).duration).toBe(0);
  });

  it('feeds straight into the section layout', () => {
    const song = new Float32Array(72 * RATE);
    addNoise(song, 0, 24, 0.02, 1);
    addNoise(song, 24, 48, 0.4, 2);
    addTone(song, 48, 72, 4000, 0.3);
    addClicks(song, 0, 72, 120, 0.6);
    const result = analyzeSong(song, RATE);
    const clips = layoutSong('sections', presets, result.duration, result.sections);
    expectCovers(clips, result.duration);
    expect(clips.length).toBe(result.sections.length + 1);
  });
});
