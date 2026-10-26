import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioFrame, AudioSourceKind } from './nativeAudio';

// The native side is replaced by a feed the test controls.
const native = vi.hoisted(() => ({
  frame: null as AudioFrame | null,
  acquired: [] as string[],
  released: [] as string[],
}));
vi.mock('./nativeAudio', async original => ({
  ...(await original<typeof import('./nativeAudio')>()),
  hasNativeAudio: () => true,
  acquireNativeAudio: async (source: AudioSourceKind) => {
    native.acquired.push(source);
    return { frame: () => native.frame, release: () => native.released.push(source) };
  },
}));

import { StandaloneAudio, estimateBpm, spectralCentroid } from './standaloneAudio';

afterEach(() => { native.frame = null; native.acquired = []; native.released = []; });

function nativeFrame(bass: number, rest: number, arriving = true): AudioFrame {
  const spectrum = new Uint8Array(new ArrayBuffer(512)).fill(rest);
  spectrum.fill(bass, 0, 5);
  return { sequence: 1, source: 'player', sampleRate: 48000, arriving, spectrum, waveform: new Uint8Array(new ArrayBuffer(1024)).fill(128) };
}

describe('tempo and brightness', () => {
  it('estimates the tempo from steady beats and ignores a stray one', () => {
    const beats = [0, 500, 1000, 1500, 1730, 2000, 2500, 3000];
    expect(estimateBpm(beats, 0)).toBe(120);
    expect(estimateBpm([0, 500, 1000], 0)).toBe(0);
  });
  it('eases small tempo changes and jumps to big ones', () => {
    expect(estimateBpm([0, 480, 960, 1440, 1920], 120)).toBe(121);
    expect(estimateBpm([0, 750, 1500, 2250, 3000], 120)).toBe(80);
  });
  it('measures where the energy sits in the spectrum', () => {
    expect(spectralCentroid(new Uint8Array(512))).toBe(0);
    const high = new Uint8Array(512); high[400] = 255;
    const low = new Uint8Array(512); low[20] = 255;
    expect(spectralCentroid(high)).toBeCloseTo(400 / 512, 3);
    expect(spectralCentroid(low)).toBeLessThan(spectralCentroid(high));
  });
});

describe('StandaloneAudio on the iPhone and iPad app', () => {
  it('drives the uniforms from native frames, with tempo and beat phase', async () => {
    const audio = new StandaloneAudio();
    await audio.startSource('player');
    expect(native.acquired).toEqual(['player']);
    expect(audio.source).toBe('player');
    // A kick every 500 ms (120 BPM) at 60 frames a second for six seconds.
    let sawBeat = false;
    for (let t = 0; t < 6000; t += 1000 / 60) {
      native.frame = nativeFrame(t % 500 < 40 ? 230 : 40, 60);
      audio.update(t);
      if (audio.uniforms.audioBeat > 0.9) sawBeat = true;
    }
    expect(sawBeat).toBe(true);
    expect(audio.arriving).toBe(true);
    expect(audio.uniforms.audioBPM).toBeGreaterThanOrEqual(118);
    expect(audio.uniforms.audioBPM).toBeLessThanOrEqual(122);
    expect(audio.uniforms.audioBeatPhase).toBeGreaterThanOrEqual(0);
    expect(audio.uniforms.audioBeatPhase).toBeLessThan(1);
    expect(audio.uniforms.audioSpectralCentroid).toBeGreaterThan(0);
    expect(audio.uniforms.spectrum?.[0]).toBeGreaterThan(0);
  });

  it('reads a missing frame as silence and says nothing is arriving', async () => {
    const audio = new StandaloneAudio();
    await audio.startSource('phone');
    native.frame = null;
    audio.update(16);
    expect(audio.arriving).toBe(false);
    expect(audio.uniforms.spectrum?.every(v => v === 0)).toBe(true);
    expect(audio.uniforms.waveform?.every(v => v === 128)).toBe(true);
  });

  it('takes the new source before letting the old one go, and stops cleanly', async () => {
    const audio = new StandaloneAudio();
    await audio.start();
    expect(native.acquired).toEqual(['mic']);
    await audio.startSource('player');
    expect(native.acquired).toEqual(['mic', 'player']);
    expect(native.released).toEqual(['mic']);
    await audio.startSource('player');
    expect(native.acquired).toHaveLength(2);
    audio.stop();
    expect(native.released).toEqual(['mic', 'player']);
    expect(audio.source).toBe('off');
    expect(audio.uniforms.audioBPM).toBe(0);
  });

  it('forgets the tempo when the beats stop', async () => {
    const audio = new StandaloneAudio();
    await audio.startSource('mic');
    for (let t = 0; t < 4000; t += 1000 / 60) { native.frame = nativeFrame(t % 500 < 40 ? 230 : 40, 60); audio.update(t); }
    expect(audio.uniforms.audioBPM).toBeGreaterThan(0);
    for (let t = 4000; t < 9000; t += 1000 / 60) { native.frame = nativeFrame(40, 60); audio.update(t); }
    expect(audio.uniforms.audioBPM).toBe(0);
    expect(audio.uniforms.audioBeatPhase).toBe(0);
  });
});
