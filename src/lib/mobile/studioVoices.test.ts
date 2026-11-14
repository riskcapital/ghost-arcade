import { describe, expect, it } from 'vitest';
import { VOICE_DRIVEN_INPUTS, VOICE_SOURCE_IDS, VoiceSignals, isVoiceDrivenInput, prepareVoiceSource, spectrumPeaks, voiceSourceAt, type VoiceAudioFrame } from './studioVoices';

const RATE = 48000, BINS = 512, HZ = RATE / (2 * BINS);
/** A byte spectrum with a quiet floor and the given (Hz, byte level, half-width in bins) components. */
function spectrum(parts: [number, number, number?][], floor = 40): Uint8Array {
  const s = new Uint8Array(BINS).fill(floor);
  for (const [hz, level, width = 1] of parts) {
    // A windowed tone falls off as a parabola in dB around its true position between bins.
    const c = hz / HZ;
    for (let i = Math.floor(c - width - 1); i <= Math.ceil(c + width + 1); i++) {
      if (i <= 0 || i >= BINS) continue;
      const d = Math.max(0, Math.abs(i - c) - width);
      s[i] = Math.max(s[i], Math.round(level - 40 * d * d));
    }
  }
  return s;
}
const frame = (s: Uint8Array, bpm = 0, beatPhase = 0): VoiceAudioFrame => ({ spectrum: s, sampleRate: RATE, bpm, beatPhase });
const DT = 1 / 60;

/** Four-on-the-floor at 120 BPM with a held bass: a kick burst at 60 Hz on each beat. */
function playKicks(v: VoiceSignals, seconds: number, onHit?: (t: number) => void) {
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT, phase = (t * 2) % 1;
    const kick = phase < 0.08 ? 230 : 120;
    v.update(frame(spectrum([[60, kick, 2], [220, 150]])), DT);
    if (phase < DT * 2 && phase >= 0) onHit?.(t);
  }
}

describe('voice signals from the phone’s spectrum', () => {
  it('names the same sources, in the same order, as the desktop', () => {
    expect(VOICE_SOURCE_IDS).toHaveLength(21);
    expect(VOICE_SOURCE_IDS.slice(0, 11)).toEqual(['all', 'kick', 'snare', 'hats', 'perc', 'bass', 'lead', 'chords', 'pad', 'fx', 'played']);
    expect(voiceSourceAt(1)).toBe('kick');
    expect(voiceSourceAt(99)).toBe('all');
    expect(voiceSourceAt('x')).toBe('all');
  });

  it('gives a voice every driven input, all finite and in range', () => {
    const v = new VoiceSignals();
    playKicks(v, 3);
    for (const id of VOICE_SOURCE_IDS) {
      const inputs = v.inputs(id);
      for (const name of VOICE_DRIVEN_INPUTS) {
        expect(Number.isFinite(inputs[name]), `${id}.${name}`).toBe(true);
        expect(inputs[name]).toBeGreaterThanOrEqual(0);
      }
      expect(inputs.vxEnv).toBeLessThanOrEqual(1.25);
      expect(inputs.vxPitch).toBeLessThanOrEqual(1);
      expect(inputs.vxBeat).toBeLessThan(1);
      expect(inputs.vxFlow).toBeLessThan(1000);
    }
  });

  it('hears each kick as one hit: vxHit jumps, then falls away before the next', () => {
    const v = new VoiceSignals();
    playKicks(v, 2);
    const before = v.inputs('kick').vxCount;
    let peak = 0, trough = 1;
    for (let i = 0; i < 60; i++) {
      const phase = (i * DT * 2) % 1;
      v.update(frame(spectrum([[60, phase < 0.08 ? 230 : 120, 2], [220, 150]])), DT);
      const { vxHit } = v.inputs('kick');
      peak = Math.max(peak, vxHit);
      if (phase > 0.8) trough = Math.min(trough, vxHit);
    }
    // One second at 120 BPM is two kicks.
    expect((v.inputs('kick').vxCount - before + 64) % 64).toBe(2);
    expect(peak).toBeGreaterThan(0.4);
    expect(trough).toBeLessThan(0.05);
    // A kick is a drum: its pitch is steady (General MIDI 36).
    expect(v.inputs('kick').vxPitch).toBeCloseTo(36 / 127, 5);
  });

  it('keeps hats and kick apart: hats in the top of the spectrum do not fire the kick', () => {
    const v = new VoiceSignals();
    for (let i = 0; i < 180; i++) {
      const phase = (i * DT * 4) % 1;
      v.update(frame(spectrum([[60, 120, 2], [10000, phase < 0.1 ? 200 : 60, 40]])), DT);
    }
    expect(v.inputs('hats').vxCount).toBeGreaterThan(6);
    expect(v.inputs('kick').vxCount).toBe(0);
  });

  it('follows a held bass with its envelope and a smooth swell, and lets it go in silence', () => {
    const v = new VoiceSignals();
    for (let i = 0; i < 120; i++) v.update(frame(spectrum([[110, 200, 1]])), DT);
    const held = v.inputs('bass');
    expect(held.vxEnv).toBeGreaterThan(0.5);
    expect(held.vxSwell).toBeGreaterThan(0.4);
    for (let i = 0; i < 180; i++) v.update(frame(spectrum([], 20)), DT);
    const gone = v.inputs('bass');
    expect(gone.vxEnv).toBeLessThan(0.05);
    expect(gone.vxSwell).toBeLessThan(held.vxSwell);
  });

  it('hears a chord as up to four notes, strongest first, in MIDI / 127', () => {
    const v = new VoiceSignals();
    // An A minor seventh voiced from A4: 47 Hz bins cannot part notes a semitone apart much lower.
    const notes = [69, 72, 76, 79];
    const parts = notes.map((n, i) => [440 * Math.pow(2, (n - 69) / 12), 210 - i * 8, 0] as [number, number, number]);
    for (let i = 0; i < 90; i++) v.update(frame(spectrum(parts)), DT);
    const inputs = v.inputs('chords');
    const heard = [0, 1, 2, 3].map((i) => Math.round(inputs[`vxNote${i}`] * 127)).filter((n) => n > 0);
    // 47 Hz bins resolve these notes to within a semitone.
    expect(heard.length).toBeGreaterThanOrEqual(3);
    for (const n of heard) expect(notes.some((m) => Math.abs(m - n) <= 1)).toBe(true);
    expect(inputs.vxNoteE0).toBeGreaterThanOrEqual(inputs.vxNoteE1);
    expect(inputs.vxNoteE0).toBeGreaterThan(0.2);
  });

  it('runs the motion clocks forward only, faster while the sound plays', () => {
    const quiet = new VoiceSignals(), loud = new VoiceSignals();
    let last = 0;
    for (let i = 0; i < 120; i++) {
      quiet.update(frame(spectrum([], 20)), DT);
      loud.update(frame(spectrum([[110, 220, 1]])), DT);
      const phase = loud.inputs('bass').vxPhase;
      expect(phase).toBeGreaterThanOrEqual(last);
      last = phase;
    }
    expect(loud.inputs('bass').vxFlow).toBeGreaterThan(quiet.inputs('bass').vxFlow);
    expect(loud.inputs('bass').vxPhase).toBeGreaterThan(quiet.inputs('bass').vxPhase);
  });

  it('locks the bar clock to a detected tempo', () => {
    const v = new VoiceSignals();
    // 128 BPM, beat phase as the analyser reports it.
    for (let i = 0; i < 600; i++) { const t = i * DT; v.update(frame(spectrum([[60, 120, 2]]), 128, (t * 128 / 60) % 1), DT); }
    const t = 600 * DT;
    const want = (t * 128 / 60) % 1;
    const got = v.inputs('all').vxBeat;
    const gap = Math.min(Math.abs(got - want), 1 - Math.abs(got - want));
    expect(gap).toBeLessThan(0.08);
  });

  it('shows a voice all the time, or with "comes and goes" only while its sound plays', () => {
    const v = new VoiceSignals();
    for (let i = 0; i < 60; i++) v.update(frame(spectrum([[110, 220, 1]])), DT);
    expect(v.inputs('bass', false).vxPresence).toBe(1);
    expect(v.inputs('bass', true).vxPresence).toBeGreaterThan(0.9);
    // Hats never played: absent with "comes and goes".
    expect(v.inputs('hats', true).vxPresence).toBeLessThan(0.05);
    for (let i = 0; i < 60 * 12; i++) v.update(frame(spectrum([], 20)), DT);
    expect(v.inputs('bass', true).vxPresence).toBeLessThan(0.1);
  });

  it('scales the amounts, not the clocks, by the layer’s Audio response', () => {
    const v = new VoiceSignals();
    for (let i = 0; i < 60; i++) v.update(frame(spectrum([[110, 220, 1]])), DT);
    const full = v.inputs('bass', false, 1), none = v.inputs('bass', false, 0), double = v.inputs('bass', false, 2);
    expect(none.vxEnv).toBe(0);
    expect(none.vxSwell).toBe(0);
    expect(none.vxPhase).toBe(full.vxPhase);
    expect(double.vxEnv).toBeLessThanOrEqual(1.25);
    expect(double.vxEnv).toBeGreaterThan(full.vxEnv);
  });

  it('plays a quiet groove with no source: hits each bar, a chord, nothing loud', () => {
    const v = new VoiceSignals();
    let maxEnv = 0;
    for (let i = 0; i < 60 * 8; i++) { v.update(null, DT); maxEnv = Math.max(maxEnv, v.inputs('bass').vxEnv); }
    expect(v.live).toBe(false);
    // Eight seconds at 90 BPM: three bars, so three kicks.
    expect(v.inputs('kick').vxCount).toBe(3);
    expect(v.inputs('chords').vxNote0).toBeGreaterThan(0);
    expect(v.inputs('chords').vxNoteE2).toBeGreaterThan(0);
    expect(maxEnv).toBeLessThan(0.6);
    expect(maxEnv).toBeGreaterThan(0.15);
    // A source starting forgets the groove.
    v.update(frame(spectrum([], 20)), DT);
    expect(v.live).toBe(true);
    expect(v.inputs('kick').vxCount).toBe(0);
  });

  it('is steady at any frame rate: long frames are capped, bad ones ignored', () => {
    const v = new VoiceSignals();
    v.update(frame(spectrum([[110, 220, 1]])), 5);
    v.update(frame(spectrum([[110, 220, 1]])), Number.NaN);
    v.update(frame(spectrum([[110, 220, 1]])), -1);
    for (const value of Object.values(v.inputs('bass'))) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('spectral peaks', () => {
  it('finds tones as MIDI notes, strongest first, at least a semitone apart, inside the range', () => {
    const peaks = spectrumPeaks(spectrum([[440, 220, 0], [880, 200, 0], [3000, 250, 0]]), RATE, 200, 2000);
    expect(peaks.map((p) => Math.round(p.midi))).toEqual([69, 81]);
    expect(peaks[0].amp).toBeGreaterThan(peaks[1].amp);
    expect(spectrumPeaks(spectrum([], 40), RATE, 200, 2000)).toEqual([]);
  });
});

describe('voice inputs and code on the phone', () => {
  it('hides the driven signals, the transparent background and lettering, never a look control', () => {
    for (const name of VOICE_DRIVEN_INPUTS) expect(isVoiceDrivenInput(name)).toBe(true);
    expect(isVoiceDrivenInput('vxClear')).toBe(true);
    expect(isVoiceDrivenInput('vxTxt0')).toBe(true);
    expect(isVoiceDrivenInput('vxSource')).toBe(false);
    expect(isVoiceDrivenInput('vxAuto')).toBe(false);
    expect(isVoiceDrivenInput('field')).toBe(false);
  });
  it('gives WebGL 1 a hyperbolic tangent under its own name, after the header, and nothing else', () => {
    const src = '/*{ "INPUTS": [] }*/\nvoid main() { gl_FragColor = vec4(tanh(1.0), tanh (vec3(0.5)) ); }';
    const out = prepareVoiceSource(src);
    expect(out.startsWith('/*{ "INPUTS": [] }*/')).toBe(true);
    expect(out).toContain('float ga_tanh(float x)');
    expect(out).toContain('vec4(ga_tanh(1.0), ga_tanh(vec3(0.5)) )');
    expect(out).not.toMatch(/[^_]tanh\s*\(/);
    const plain = '/*{}*/\nvoid main() { gl_FragColor = vec4(1.0); }';
    expect(prepareVoiceSource(plain)).toBe(plain);
  });
});
