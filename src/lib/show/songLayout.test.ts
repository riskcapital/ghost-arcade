import { describe, expect, it } from 'vitest';
import { secondsAtBeat, tempoFromAnalysis } from './tempoMap';
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

/** A short burst of a low tone (an off-beat bass note) at each listed beat. */
function addBass(out: Float32Array, beats: number[], bpm: number, level: number) {
  for (const b of beats) {
    const start = Math.round(((b * 60) / bpm) * RATE);
    for (let i = 0; i < 0.2 * RATE && start + i < out.length; i++) {
      const env = Math.min(1, i / (0.005 * RATE)) * Math.exp(-i / (0.12 * RATE));
      out[start + i] += level * env * Math.sin((2 * Math.PI * 55 * i) / RATE);
    }
  }
}

/** Noise bursts (hats, or with a lower cut a snare) at each listed beat. */
function addHits(out: Float32Array, beats: number[], bpm: number, level: number, decay: number, seed: number) {
  const r = rng(seed);
  for (const b of beats) {
    const start = Math.round(((b * 60) / bpm) * RATE);
    let prev = 0;
    for (let i = 0; i < decay * 5 * RATE && start + i < out.length; i++) {
      const n = r();
      out[start + i] += level * Math.exp(-i / (decay * RATE)) * (n - prev);
      prev = n;
    }
  }
}

function addKicks(out: Float32Array, beats: number[], bpm: number, level: number) {
  for (const b of beats) {
    const start = Math.round(((b * 60) / bpm) * RATE);
    for (let i = 0; i < 0.06 * RATE && start + i < out.length; i++) {
      out[start + i] += level * Math.exp(-i / (0.012 * RATE)) * Math.sin((2 * Math.PI * 70 * i) / RATE);
    }
  }
}

/** A kick with a falling pitch (its click reaches the mid band too). */
function addDrumKicks(out: Float32Array, beats: number[], bpm: number, level: number) {
  for (const b of beats) {
    const start = Math.round(((b * 60) / bpm) * RATE);
    for (let i = 0; i < 0.12 * RATE && start + i < out.length; i++) {
      const f = 50 + 60 * Math.exp(-i / (0.02 * RATE));
      out[start + i] += level * Math.exp(-i / (0.04 * RATE)) * Math.sin((2 * Math.PI * f * i) / RATE);
    }
  }
}

/** A snare: a mid tone and noise. */
function addSnares(out: Float32Array, beats: number[], bpm: number, level: number, seed: number) {
  const r = rng(seed);
  for (const b of beats) {
    const start = Math.round(((b * 60) / bpm) * RATE);
    for (let i = 0; i < 0.2 * RATE && start + i < out.length; i++) {
      const env = Math.exp(-i / (0.05 * RATE));
      out[start + i] += level * env * (0.6 * r() + 0.5 * Math.sin((2 * Math.PI * 190 * i) / RATE));
    }
  }
}

/** `hits` (beats in a bar of `beatsPerBar`) repeated for `bars` bars. */
function everyBar(bars: number, beatsPerBar: number, hits: number[]): number[] {
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar++) for (const h of hits) out.push(bar * beatsPerBar + h);
  return out;
}

/** Distance of each beat from the nearest true beat `k * 60 / bpm`, seconds. */
function beatErrors(beats: number[], bpm: number): number[] {
  const period = 60 / bpm;
  return beats.map((b) => {
    const d = b / period;
    return Math.abs(d - Math.round(d)) * period;
  });
}

describe('analyzeSong', () => {
  it('house: the grid sits on the kicks, not the off-beat bass and hats', () => {
    const bpm = 124;
    const song = new Float32Array(40 * RATE);
    const n = Math.floor((40 * bpm) / 60);
    const on = Array.from({ length: n }, (_, i) => i);
    const off = on.map((b) => b + 0.5);
    addKicks(song, on, bpm, 0.9);
    addBass(song, off, bpm, 0.5);
    addHits(song, off, bpm, 0.5, 0.02, 7);
    const result = analyzeSong(song, RATE);
    expect(Math.abs(result.tempo! - bpm)).toBeLessThan(1);
    const errors = beatErrors(result.beats.slice(1, 60), bpm);
    expect(Math.max(...errors)).toBeLessThan(0.04);
  });

  it('half-time breakbeat at 100: the beat, not the dotted-eighth figure (133)', () => {
    const bpm = 100;
    const song = new Float32Array(48 * RATE);
    const kicks: number[] = [];
    const snares: number[] = [];
    for (let bar = 0; bar < 20; bar += 2) {
      const b = bar * 4;
      kicks.push(b, b + 1.5, b + 2.5, b + 4, b + 5.5, b + 6.5, b + 7.25);
      snares.push(b + 2, b + 6);
    }
    addKicks(song, kicks, bpm, 0.9);
    addHits(song, snares, bpm, 0.6, 0.06, 3);
    const result = analyzeSong(song, RATE);
    expect(Math.abs(result.tempo! - bpm)).toBeLessThan(1);
  });

  it('hip-hop at 88: the beat, not the dotted figure (117.3), with the first beat on a kick', () => {
    const bpm = 88;
    const song = new Float32Array(60 * RATE);
    const bars = 24;
    addDrumKicks(song, everyBar(bars, 4, [0, 0.75, 2.25, 2.5]), bpm, 0.9);
    addSnares(song, everyBar(bars, 4, [1, 3]), bpm, 0.7, 3);
    addHits(song, everyBar(bars, 4, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]), bpm, 0.3, 0.015, 5);
    const result = analyzeSong(song, RATE);
    expect(Math.abs(result.tempo! - bpm)).toBeLessThan(0.5);
    expect(Math.max(...beatErrors(result.beats.slice(1, 60), bpm))).toBeLessThan(0.03);
    // Beats 2 and 4 carry the snare: the first beat is 1 or 3.
    const first = Math.round(result.beats[0] / (60 / bpm));
    expect(first % 2).toBe(0);
  });

  it('drum and bass at 174: not half time (87), and the grid on the beat, not the off-beat kick', () => {
    for (const pattern of [[0, 1.5], [0, 2.5, 4, 6.5]]) {
      const bpm = 174;
      const song = new Float32Array(60 * RATE);
      const bars = 46;
      addDrumKicks(song, everyBar(bars, pattern.length > 2 ? 8 : 4, pattern), bpm, 0.9);
      addSnares(song, everyBar(bars * 2, 4, [1, 3]), bpm, 0.8, 3);
      addHits(song, everyBar(bars * 2, 4, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]), bpm, 0.2, 0.01, 5);
      const result = analyzeSong(song, RATE);
      expect(Math.abs(result.tempo! - bpm)).toBeLessThan(0.5);
      expect(Math.max(...beatErrors(result.beats.slice(1, 120), bpm))).toBeLessThan(0.03);
      expect(Math.round(result.beats[0] / (60 / bpm)) % 2).toBe(0);
    }
  });

  it('a detected map stays on a non-integer tempo for a long mix (10 and 20 minutes)', () => {
    for (const [bpm, minutes] of [[91.27, 10], [127.37, 20]]) {
      const seconds = minutes * 60;
      const song = new Float32Array(seconds * RATE);
      addClicks(song, 0, seconds, bpm, 0.8, 0.1);
      const map = tempoFromAnalysis(analyzeSong(song, RATE), { startTime: 0, offset: 0 })!;
      const period = 60 / bpm;
      // The map's beat for the kick k beats after its first, against the kick.
      const k0 = Math.round((map.offset - 0.1) / period);
      for (const k of [10, 300, Math.floor((seconds - 10) / period)]) {
        const truth = 0.1 + k * period;
        expect(Math.abs(secondsAtBeat(map, k - k0) - truth)).toBeLessThan(0.02);
      }
    }
  });

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
