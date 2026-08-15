/**
 * The offline render analyses a file audio source at VIRTUAL time so the
 * exported clip contains the right slice of the track for every frame,
 * regardless of how long the capture takes. These tests pin the two things
 * that has to get right: the FFT itself, and the "which samples does frame
 * N see" mapping.
 */

import { describe, expect, it } from 'vitest';
import {
  OfflineFileAudioAnalyzer,
  blackmanWindow,
  fftInPlace,
  offlineFileAudioTime,
  type OfflineFileAudioSession,
} from './offlineFileAudio';

const SR = 48000;

function sineBuffer(seconds: number, hz: number, amplitude = 0.8, from = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const start = Math.round(from * SR);
  for (let i = start; i < out.length; i++) {
    out[i] = Math.sin((2 * Math.PI * hz * i) / SR) * amplitude;
  }
  return out;
}

describe('fftInPlace', () => {
  it('puts a pure tone in the expected bin', () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    // Exactly 8 cycles across the window → all energy in bin 8.
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 8 * i) / n);
    fftInPlace(re, im);

    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    let peak = 0;
    for (let k = 1; k < mags.length; k++) if (mags[k] > mags[peak]) peak = k;
    expect(peak).toBe(8);
    // Neighbours are essentially empty — no smearing from a broken twiddle.
    expect(mags[8]).toBeGreaterThan(mags[7] * 1000);
    expect(mags[8]).toBeGreaterThan(mags[9] * 1000);
  });

  it('rejects non-power-of-two lengths', () => {
    expect(() => fftInPlace(new Float32Array(3), new Float32Array(3))).toThrow();
  });
});

describe('blackmanWindow', () => {
  it('tapers to (near) zero at both ends and peaks in the middle', () => {
    const w = blackmanWindow(64);
    expect(w[0]).toBeCloseTo(0, 6);
    expect(w[63]).toBeCloseTo(0, 6);
    expect(w[32]).toBeGreaterThan(0.9);
  });
});

describe('OfflineFileAudioAnalyzer', () => {
  it('reads the spectrum at the requested time, not at wall time', () => {
    // Silence for the first second, a loud bass tone after.
    const analyzer = new OfflineFileAudioAnalyzer(sineBuffer(3, 100, 0.9, 1.0), SR);

    // Ramp through the silent stretch first so the band smoothing is settled.
    let quiet = analyzer.frameAt(0.1);
    for (let t = 0.2; t < 1.0; t += 0.1) quiet = analyzer.frameAt(t);
    const quietBass = quiet.bands.bass;

    let loud = analyzer.frameAt(1.2);
    for (let t = 1.3; t < 2.0; t += 0.1) loud = analyzer.frameAt(t);

    expect(quietBass).toBeLessThan(0.05);
    expect(loud.bands.bass).toBeGreaterThan(quietBass + 0.3);
  });

  it('places a tone in the band that owns its frequency', () => {
    const bassAnalyzer = new OfflineFileAudioAnalyzer(sineBuffer(1, 120), SR);
    const trebleAnalyzer = new OfflineFileAudioAnalyzer(sineBuffer(1, 6000), SR);

    let bass = bassAnalyzer.frameAt(0.1);
    let treble = trebleAnalyzer.frameAt(0.1);
    for (let t = 0.2; t < 0.9; t += 0.1) {
      bass = bassAnalyzer.frameAt(t);
      treble = trebleAnalyzer.frameAt(t);
    }

    expect(bass.bands.bass).toBeGreaterThan(bass.bands.treble);
    expect(treble.bands.treble).toBeGreaterThan(treble.bands.bass);
  });

  it('is deterministic — the same frame sequence yields the same numbers', () => {
    const pcm = sineBuffer(1, 200);
    const a = new OfflineFileAudioAnalyzer(pcm, SR);
    const b = new OfflineFileAudioAnalyzer(pcm, SR);
    for (let i = 0; i < 20; i++) {
      const fa = a.frameAt(i / 30);
      const fb = b.frameAt(i / 30);
      expect(fa.bands.bass).toBe(fb.bands.bass);
      expect(fa.amplitude).toBe(fb.amplitude);
      expect(fa.spectralCentroid).toBe(fb.spectralCentroid);
    }
  });

  it('reports silence past the end of the track', () => {
    const analyzer = new OfflineFileAudioAnalyzer(sineBuffer(0.5, 200), SR);
    let past = analyzer.frameAt(0.6);
    for (let t = 0.7; t < 1.5; t += 0.1) past = analyzer.frameAt(t);
    expect(past.amplitude).toBeLessThan(0.02);
  });
});

describe('offlineFileAudioTime', () => {
  const session = (over: Partial<OfflineFileAudioSession>): OfflineFileAudioSession => ({
    analyzer: null as unknown as OfflineFileAudioAnalyzer,
    startOffsetSeconds: 0,
    loop: false,
    durationSeconds: 10,
    label: 'test',
    ...over,
  });

  it('offsets by wherever the playhead was parked', () => {
    expect(offlineFileAudioTime(session({ startOffsetSeconds: 4 }), 2)).toBeCloseTo(6);
  });

  it('wraps only when the element loops', () => {
    expect(offlineFileAudioTime(session({ loop: true }), 12)).toBeCloseTo(2);
    expect(offlineFileAudioTime(session({ loop: false }), 12)).toBeCloseTo(12);
  });
});
