import { describe, expect, it } from 'vitest';
import { DrumEngine, Ladder, ToneEngine } from './toneDsp';
import { TONES } from './tones';
import { DRUM_KITS } from './kits';
import { EXTRA_SOUNDS, MACHINE_KITS } from '../drumMachine/machineKits';

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

  it('arpeggiates a held chord on the tempo grid and stops when let go', () => {
    const tone = TONES.find((t) => t.id === 'arp.pluck-up')!;
    const e = new ToneEngine(SR);
    e.message({ t: 'tempo', bpm: 120 }, 0);
    e.message({ t: 'patch', patch: { ...tone.patch, fx: undefined } }, 0);
    for (const note of [60, 64, 67]) e.message({ t: 'on', note, vel: 0.9, at: 0 }, 0);
    for (const note of [60, 64, 67]) e.message({ t: 'off', note, at: 1 }, 0);
    // Sixteenths at 120 are 0.125 s apart: count the attacks in the first second.
    const L = new Float32Array(BLOCK);
    const R = new Float32Array(BLOCK);
    const blockLevel: number[] = [];
    for (let b = 0; b < Math.ceil((2 * SR) / BLOCK); b++) {
      L.fill(0);
      R.fill(0);
      e.process(L, R, BLOCK, (b * BLOCK) / SR);
      blockLevel.push(Math.max(...L.map(Math.abs)));
    }
    const perStep = Math.round((0.125 * SR) / BLOCK);
    let attacks = 0;
    for (let k = 0; k < 8; k++) {
      const at = Math.round((k * 0.125 * SR) / BLOCK);
      if (blockLevel[at + 1] > 0.05 && blockLevel[at + 1] > blockLevel[Math.max(0, at - 2)]) attacks++;
    }
    expect(perStep).toBeGreaterThan(10);
    expect(attacks).toBeGreaterThanOrEqual(7);
    expect(e.busy).toBe(false);
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

describe('drum machine kits', () => {
  const tweak = { tune: 0.5, decay: 0.5, tone: 0.5, drive: 0.5, level: 1 };
  it('every library sound sounds, and none clips', () => {
    const kit = { id: 'lib', name: 'Library', blurb: '', sounds: EXTRA_SOUNDS.map((p) => p.sound), gain: 1 };
    for (let slot = 0; slot < EXTRA_SOUNDS.length; slot++) {
      const e = new DrumEngine(SR);
      e.message({ t: 'kit', kit }, 0);
      e.message({ t: 'hit', slot, vel: 1, at: 0, tweak }, 0);
      const { peak, finite } = render(e, 0.8);
      expect(finite).toBe(true);
      expect(peak, EXTRA_SOUNDS[slot].name).toBeGreaterThan(0.03);
      expect(peak, EXTRA_SOUNDS[slot].name).toBeLessThan(1.6);
    }
  });
  for (const mk of MACHINE_KITS) {
    it(`${mk.name}: every pad sounds, and none clips`, () => {
      const kit = { id: mk.id, name: mk.name, blurb: mk.blurb, sounds: mk.pads.map((p) => p.sound), fx: mk.fx, gain: mk.gain };
      for (let slot = 0; slot < mk.pads.length; slot++) {
        const e = new DrumEngine(SR);
        e.message({ t: 'kit', kit }, 0);
        e.message({ t: 'hit', slot, vel: 1, at: 0, tweak }, 0);
        const { peak, finite } = render(e, 0.6);
        expect(finite).toBe(true);
        expect(peak, `${mk.name} ${mk.pads[slot].name}`).toBeGreaterThan(0.03);
        expect(peak, `${mk.name} ${mk.pads[slot].name}`).toBeLessThan(1.6);
      }
    });
  }
});
