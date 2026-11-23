import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrumEngine, Ladder, ToneEngine, kneeClip } from './toneDsp';
import { loopCurve } from '../sounds/kit';
import { TONES } from './tones';
import { DRUM_KITS } from './kits';
import { EXTRA_SOUNDS, MACHINE_KITS } from '../drumMachine/machineKits';

// The voices use Math.random (analog slop, noise, drift). Against the fixed
// peak thresholds below that made a different kit fail now and then, so
// every test runs on the same seeded sequence.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seeded(0x5eed)); });
afterEach(() => { vi.restoreAllMocks(); });

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

  describe('a latched arp with its echo (the XY pad dressed in Glass arp)', () => {
    const glass = TONES.find((t) => t.id === 'arp.glass')!;
    /** Level of the next `seconds`, starting at `from`. */
    const level = (e: ToneEngine, from: number, seconds: number) => {
      const L = new Float32Array(BLOCK);
      const R = new Float32Array(BLOCK);
      let peak = 0;
      for (let b = 0; b < Math.ceil((seconds * SR) / BLOCK); b++) {
        L.fill(0);
        R.fill(0);
        e.process(L, R, BLOCK, from + (b * BLOCK) / SR);
        for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      }
      return peak;
    };
    /** A drag across the pad: each new note before the last lets go, then the finger lifts. */
    const dragged = () => {
      const e = new ToneEngine(SR);
      e.message({ t: 'tempo', bpm: 120 }, 0);
      e.message({ t: 'patch', patch: glass.patch }, 0);
      e.message({ t: 'on', note: 60, vel: 0.9, at: 0 }, 0);
      e.message({ t: 'on', note: 62, vel: 0.9, at: 0.2 }, 0);
      e.message({ t: 'off', note: 60, at: 0.2 }, 0);
      e.message({ t: 'off', note: 62, at: 0.5 }, 0);
      return e;
    };

    it('plays on after the pad is let go (it is latched)', () => {
      const e = dragged();
      level(e, 0, 2);
      expect(level(e, 2, 1)).toBeGreaterThan(0.02);
    });

    it('stops at once on a panic, and Kill also empties its echo', () => {
      const soft = dragged();
      level(soft, 0, 2);
      soft.message({ t: 'panic' }, 2);
      // A plain panic (Stop) cuts the voices and the run; the echo rings out.
      level(soft, 2, 3);
      expect(level(soft, 5, 1)).toBeLessThan(0.001);
      const kill = dragged();
      level(kill, 0, 2);
      kill.message({ t: 'panic', flush: true }, 2);
      expect(level(kill, 2, 1)).toBe(0);
      expect(kill.busy).toBe(false);
    });

    it('lets go of the latched run when the pad goes away, and its echo dies out', () => {
      const e = dragged();
      level(e, 0, 2);
      e.message({ t: 'release' }, 2);
      level(e, 2, 3);
      expect(level(e, 5, 1)).toBeLessThan(0.001);
      expect(e.busy).toBe(false);
    });
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

describe('saturation', () => {
  it('clips the output with no jump at the knee', () => {
    expect(kneeClip(0.5)).toBe(0.5);
    expect(Math.abs(kneeClip(0.9001) - 0.9001)).toBeLessThan(1e-4);
    expect(kneeClip(-0.9001)).toBeCloseTo(-0.9001, 4);
    expect(kneeClip(10)).toBeLessThanOrEqual(1);
    for (let x = 0; x < 3; x += 0.001) expect(kneeClip(x + 0.001) - kneeClip(x)).toBeLessThanOrEqual(0.00101);
  });

  it('keeps a feedback loop at or under unity gain', () => {
    const c = loopCurve(1.6);
    const step = 2 / (c.length - 1);
    for (let i = 1; i < c.length; i++) expect((c[i] - c[i - 1]) / step).toBeLessThanOrEqual(1.0001);
  });
});
