import { describe, expect, it } from 'vitest';
import { DrumEngine, Ladder, ToneEngine } from './toneDsp';
import { TONES } from './tones';
import { DRUM_KITS } from './kits';

const SR = 48000;
const BLOCK = 128;

function render(engine: { process(l: Float32Array, r: Float32Array, n: number, now: number): void }, seconds: number, onBlock?: (t: number) => void) {
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  let peak = 0;
  let sumSq = 0;
  let count = 0;
  let finite = true;
  for (let b = 0; b < Math.ceil((seconds * SR) / BLOCK); b++) {
    const now = (b * BLOCK) / SR;
    onBlock?.(now);
    L.fill(0);
    R.fill(0);
    engine.process(L, R, BLOCK, now);
    for (let i = 0; i < BLOCK; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (!Number.isFinite(x)) finite = false;
      peak = Math.max(peak, x);
      sumSq += L[i] * L[i];
      count++;
    }
  }
  return { peak, rms: Math.sqrt(sumSq / count), finite };
}

describe('tone engine', () => {
  for (const tone of TONES) {
    it(`${tone.name} plays a chord cleanly`, () => {
      const e = new ToneEngine(SR);
      e.message({ t: 'patch', patch: tone.patch }, 0);
      const notes = tone.family === 'bass' ? [36] : [60, 64, 67];
      for (const note of notes) e.message({ t: 'on', note, vel: 0.9, at: 0.01 }, 0);
      for (const note of notes) e.message({ t: 'off', note, at: 1.2 }, 0);
      const { peak, rms, finite } = render(e, 1.6);
      expect(finite).toBe(true);
      expect(peak).toBeGreaterThan(0.08);
      expect(peak).toBeLessThan(1.4);
      expect(rms).toBeGreaterThan(0.005);
    });
  }

  it('lets go of every voice after the release', () => {
    const tone = TONES.find((t) => t.id === 'pad.supersaw')!;
    const e = new ToneEngine(SR);
    e.message({ t: 'patch', patch: tone.patch }, 0);
    e.message({ t: 'on', note: 60, vel: 1, at: 0 }, 0);
    e.message({ t: 'off', note: 60, at: 0.2 }, 0);
    render(e, 4);
    expect(e.busy).toBe(false);
  });

  it('steals a voice when every one is busy', () => {
    const tone = TONES.find((t) => t.id === 'pad.ensemble-strings')!;
    const e = new ToneEngine(SR);
    e.message({ t: 'patch', patch: tone.patch }, 0);
    for (let n = 0; n < 14; n++) e.message({ t: 'on', note: 48 + n, vel: 0.8, at: 0 }, 0);
    expect(render(e, 0.3).finite).toBe(true);
  });

  it('keeps the ladder stable at full resonance', () => {
    const f = new Ladder();
    f.set(2000, 1, SR);
    let peak = 0;
    for (let i = 0; i < SR; i++) peak = Math.max(peak, Math.abs(f.process(i === 0 ? 1 : Math.sin(i * 0.05) * 0.5, 2)));
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThan(4);
  });
});

describe('drum kits', () => {
  const tweak = { tune: 0.5, decay: 0.5, tone: 0.5, drive: 0.5, level: 1 };
  for (const kit of DRUM_KITS) {
    it(`${kit.name} plays all eight sounds`, () => {
      for (let slot = 0; slot < 8; slot++) {
        const e = new DrumEngine(SR);
        e.message({ t: 'kit', kit }, 0);
        e.message({ t: 'hit', slot, vel: 1, at: 0, tweak }, 0);
        const { peak, finite } = render(e, 0.5);
        expect(finite).toBe(true);
        expect(peak, `${kit.name} slot ${slot}`).toBeGreaterThan(0.05);
        expect(peak, `${kit.name} slot ${slot}`).toBeLessThan(1.5);
      }
    });
  }

  it('cuts an open hat with a closed one', () => {
    const e = new DrumEngine(SR);
    e.message({ t: 'kit', kit: DRUM_KITS[0] }, 0);
    e.message({ t: 'hit', slot: 4, vel: 1, at: 0, tweak }, 0);
    e.message({ t: 'hit', slot: 3, vel: 1, at: 0.05, tweak }, 0);
    render(e, 0.35);
    expect(e.busy).toBe(false);
  });
});
