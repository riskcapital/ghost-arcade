import { describe, expect, it } from 'vitest';
import { MODEL_KEY, MORPH_BASE_KEY, MORPH_KEY, morphBase, morphValues, oscillatorOrder, paramBlock, presetValues, signalModel, SIGNAL_MODEL, SLOT_MODEL, SLOT_ORDER, paramValue, PARAM_FLOATS, SLOT_ASPECT, SLOT_LINES, VIDEOSYNTH_DEFAULTS, VIDEOSYNTH_PARAMS, VIDEOSYNTH_PRESETS } from './patch';
import { buildVideoSynthGraph, VIDEOSYNTH_MAX_SIDE, videosynthIdPrefix } from './graph';
import { discoverKeyframeableParams } from '../keyframes/paramDiscovery';
import { applyParamOverrides } from '../keyframes/applyParamOverrides';
import type { Layer } from '../types';

describe('Analog Synth controls', () => {
  it('give every control its own slot inside the block', () => {
    const slots = VIDEOSYNTH_PARAMS.map((p) => p.slot);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots).not.toContain(SLOT_ASPECT);
    expect(slots).not.toContain(SLOT_LINES);
    for (const slot of [SLOT_MODEL, SLOT_ORDER, SLOT_ORDER + 1, SLOT_ORDER + 2]) expect(slots).not.toContain(slot);
    expect(Math.max(...slots)).toBeLessThan(PARAM_FLOATS);
  });

  it('clamp, round choices and turn degrees into radians', () => {
    const rotate = VIDEOSYNTH_PARAMS.find((p) => p.key === 'vsRotate')!;
    const mix = VIDEOSYNTH_PARAMS.find((p) => p.key === 'vsMix')!;
    expect(paramValue({ vsMix: 1.6 }, mix)).toBe(2);
    expect(paramValue({ vsMix: 'x' }, mix)).toBe(mix.default);
    const block = paramBlock({ vsRotate: 900, vsAFreq: -3 }, 16 / 9);
    expect(block[rotate.slot]).toBeCloseTo(Math.PI);
    expect(block[0]).toBe(0);
    expect(block[SLOT_ASPECT]).toBeCloseTo(16 / 9);
  });

  it('presets only name controls that exist', () => {
    for (const preset of VIDEOSYNTH_PRESETS) for (const key of Object.keys(preset.values)) expect(VIDEOSYNTH_DEFAULTS, `${preset.id}.${key}`).toHaveProperty(key);
  });

  it('a control moving only resends the patch, not the graph', () => {
    const a = buildVideoSynthGraph({ params: VIDEOSYNTH_DEFAULTS, sourceId: 's', width: 1920, height: 1080 });
    const b = buildVideoSynthGraph({ params: { ...VIDEOSYNTH_DEFAULTS, vsFeedback: 0.9 }, sourceId: 's', width: 1920, height: 1080 });
    expect(b.topology).toBe(a.topology);
    expect(b.values[0].initial_b64).not.toBe(a.values[0].initial_b64);
  });

  it('Timeline lines find every control and write it back', () => {
    const layer = { id: 'l', source: { type: 'effect', effectSource: { effectType: 'videosynth', ...VIDEOSYNTH_DEFAULTS } }, effects: [] } as unknown as Layer;
    const found = discoverKeyframeableParams(layer).filter((p) => p.key.startsWith('vsynth:'));
    expect(found).toHaveLength(VIDEOSYNTH_PARAMS.length);
    const copy = structuredClone(layer);
    applyParamOverrides(copy, { 'vsynth:vsFeedback': 0.2 });
    expect((copy.source!.effectSource as unknown as Record<string, number>).vsFeedback).toBe(0.2);
  });

  it('the snapshot pad blends the corners, holding empty ones at the current patch', () => {
    const a = { ...VIDEOSYNTH_DEFAULTS, vsFeedback: 0 }, d = { ...VIDEOSYNTH_DEFAULTS, vsFeedback: 1 };
    const current = { ...VIDEOSYNTH_DEFAULTS, vsFeedback: 0.5 };
    expect(morphValues([a, null, null, d], 0, 0, current).vsFeedback).toBe(0);
    expect(morphValues([a, null, null, d], 1, 1, current).vsFeedback).toBe(1);
    expect(morphValues([a, null, null, d], 0.5, 0.5, current).vsFeedback).toBeCloseTo(0.5);
    expect(morphValues([a, null, null, d], 1, 0, current).vsFeedback).toBeCloseTo(0.5);
    // Choices (mixer, sources) are not blended.
    expect(morphValues([a, null, null, d], 0.5, 0.5, current)).not.toHaveProperty('vsMix');
  });

  it('the same point on the pad always gives the same patch', () => {
    const snaps = [{ ...VIDEOSYNTH_DEFAULTS, vsFeedback: 0 }, null, null, null];
    let source: Record<string, unknown> = { ...VIDEOSYNTH_DEFAULTS, vsFeedback: 0.5, vsSnapshots: snaps };
    // One gesture: the base is taken when it starts and every move writes it back.
    const move = (x: number, y: number) => {
      const base = morphBase(source, snaps);
      source = { ...source, ...morphValues(snaps, x, y, base), [MORPH_KEY]: [x, y], [MORPH_BASE_KEY]: base };
      return source.vsFeedback as number;
    };
    const first = move(0.5, 0.5);
    expect(first).toBeCloseTo(0.375);
    // Wander about over several gestures, then come back.
    for (const [x, y] of [[0.1, 0.2], [0.9, 0.1], [0.3, 0.8], [0, 0], [1, 1]]) move(x, y);
    expect(move(0.5, 0.5)).toBe(first);
    expect(move(1, 1)).toBe(0.5);
  });

  it('a knob turned between gestures is what the empty corners hold next', () => {
    const snaps = [{ ...VIDEOSYNTH_DEFAULTS, vsFeedback: 0, vsGlow: 0 }, null, null, null];
    const base0 = morphBase({ ...VIDEOSYNTH_DEFAULTS, vsFeedback: 0.5 }, snaps);
    const at = morphValues(snaps, 0.5, 0, base0);
    // Glow turned by hand after the pad moved.
    const source = { ...VIDEOSYNTH_DEFAULTS, ...at, vsGlow: 0.9, [MORPH_KEY]: [0.5, 0], [MORPH_BASE_KEY]: base0 };
    const base1 = morphBase(source, snaps);
    expect(base1.vsGlow).toBe(0.9);
    expect(base1.vsFeedback).toBe(0.5);
  });

  it('colors blend the short way round the wheel', () => {
    const a = { ...VIDEOSYNTH_DEFAULTS, vsAHue: 0.95 }, b = { ...VIDEOSYNTH_DEFAULTS, vsAHue: 0.05 };
    const mid = morphValues([a, b, null, null], 0.5, 0, VIDEOSYNTH_DEFAULTS).vsAHue;
    expect(Math.min(mid, 1 - mid)).toBeCloseTo(0, 6);
    expect(morphValues([a, b, null, null], 0.25, 0, VIDEOSYNTH_DEFAULTS).vsAHue).toBeCloseTo(0.975, 6);
    // Corners come back exactly.
    expect(morphValues([a, b, null, null], 0, 0, VIDEOSYNTH_DEFAULTS).vsAHue).toBe(0.95);
    // Not a hue: blended straight.
    expect(morphValues([{ ...a, vsFbHue: 0.9 }, { ...b, vsFbHue: 0.1 }, null, null], 0.5, 0, VIDEOSYNTH_DEFAULTS).vsFbHue).toBeCloseTo(0.5);
  });
});

describe('Analog Synth graph', () => {
  const tex = (g: ReturnType<typeof buildVideoSynthGraph>) => g.config.textures as { id: string; width: number; height: number }[];

  it('draws at the output size, long side at most 1920', () => {
    const small = tex(buildVideoSynthGraph({ params: null, sourceId: 's', width: 1280, height: 720 }));
    expect(small.map((t) => [t.width, t.height])).toEqual([[1280, 720], [1280, 720]]);
    const big = tex(buildVideoSynthGraph({ params: null, sourceId: 's', width: 3840, height: 2160 }));
    expect([big[0].width, big[0].height]).toEqual([VIDEOSYNTH_MAX_SIDE, 1080]);
    const tall = tex(buildVideoSynthGraph({ params: null, sourceId: 's', width: 1080, height: 3840 }));
    expect([tall[0].width, tall[0].height]).toEqual([540, 1920]);
    // An explicit long side still wins.
    const set = tex(buildVideoSynthGraph({ params: null, sourceId: 's', width: 1280, height: 720, maxSide: 960 }));
    expect([set[0].width, set[0].height]).toEqual([960, 540]);
    const empty = tex(buildVideoSynthGraph({ params: null, sourceId: 's', width: 0, height: 0 }));
    expect(empty[0].width).toBeGreaterThan(0);
  });

  it('names every resource under one prefix that tells long ids apart', () => {
    const long = 'layer-'.padEnd(300, 'x');
    const a = buildVideoSynthGraph({ params: null, sourceId: `${long}a`, width: 640, height: 360 });
    const b = buildVideoSynthGraph({ params: null, sourceId: `${long}b`, width: 640, height: 360 });
    const ids = (g: typeof a) => [...tex(g), ...(g.config.buffers as { id: string }[])].map((r) => r.id);
    const pa = videosynthIdPrefix(`${long}a`);
    expect(pa).not.toBe(videosynthIdPrefix(`${long}b`));
    for (const id of ids(a)) expect(id.startsWith(pa)).toBe(true);
    for (const id of ids(b)) expect(id.startsWith(pa)).toBe(false);
    // The core frees a layer's buffers by `:<safe id>:` (its own 160-long spelling).
    const coreToken = `:${`${long}a`.slice(0, 160)}:`;
    for (const id of ids(a)) expect(id).toContain(coreToken);
    expect(videosynthIdPrefix('my layer/1')).toMatch(/^videosynth:my_layer_1:[0-9a-f]{8}:$/);
  });

  it('runs a clock pass and gives every picture pass the running phases', () => {
    const g = buildVideoSynthGraph({ params: VIDEOSYNTH_DEFAULTS, sourceId: 's', width: 640, height: 360 });
    const phases = (g.config.buffers as { id: string; kind: string; persistent?: boolean }[]).find((b) => b.id.endsWith(':phases'))!;
    expect(phases).toMatchObject({ kind: 'storage', persistent: true });
    expect(g.config.passes).toEqual([expect.objectContaining({ shader_id: 'videosynth/clock', entry: 'cs_clock', dispatch: [1, 1, 1] })]);
    for (const pass of g.config.render_passes as { bindings: { binding: number; resource?: string; kind: string }[] }[]) {
      expect(pass.bindings).toContainEqual({ binding: 5, resource: phases.id, kind: 'read-only-storage' });
    }
    // The phases are the GPU's: nothing in the patch moves with the clock.
    const again = buildVideoSynthGraph({ params: VIDEOSYNTH_DEFAULTS, sourceId: 's', width: 640, height: 360 });
    expect(again.values[0].initial_b64).toBe(g.values[0].initial_b64);
  });
});

describe('Analog Synth signal model', () => {
  it('starts new patches and factory presets on the current model, keeps saved ones on 1', () => {
    expect(VIDEOSYNTH_DEFAULTS[MODEL_KEY]).toBe(SIGNAL_MODEL);
    expect(SIGNAL_MODEL).toBe(2);
    for (const preset of VIDEOSYNTH_PRESETS) expect(signalModel(presetValues(preset.id)), preset.id).toBe(2);
    // Saved before the key existed: every control there, no model.
    const saved: Record<string, unknown> = { ...VIDEOSYNTH_DEFAULTS };
    delete saved[MODEL_KEY];
    expect(signalModel(saved)).toBe(1);
    expect(signalModel(null)).toBe(1);
    expect(signalModel({ [MODEL_KEY]: 'x' })).toBe(1);
    expect(paramBlock(saved, 1)[SLOT_MODEL]).toBe(1);
    expect(paramBlock(VIDEOSYNTH_DEFAULTS, 1)[SLOT_MODEL]).toBe(2);
    // Not a control: Timeline lines and the pad leave it alone.
    expect(VIDEOSYNTH_PARAMS.some((p) => p.key === MODEL_KEY)).toBe(false);
    expect(morphValues([VIDEOSYNTH_DEFAULTS, null, null, null], 0.5, 0.5, VIDEOSYNTH_DEFAULTS)).not.toHaveProperty(MODEL_KEY);
  });

  it('works oscillators out in the order their cables need', () => {
    const order = (p: Record<string, number>) => oscillatorOrder({ ...VIDEOSYNTH_DEFAULTS, vsAModSrc: 0, vsBModSrc: 0, vsCModSrc: 0, vsAFmSrc: 0, vsBFmSrc: 0, vsCFmSrc: 0, ...p });
    // The default patch: A ← feedback, B ← A, C ← B.
    expect(oscillatorOrder(VIDEOSYNTH_DEFAULTS)).toEqual([0, 1, 2]);
    expect(order({})).toEqual([0, 1, 2]);
    // B into A (Mod), C into B (FM): C, then B, then A.
    expect(order({ vsAModSrc: 3, vsBFmSrc: 4 })).toEqual([2, 1, 0]);
    // C into A's level.
    expect(order({ vsALevelSrc: 4 })).toEqual([1, 2, 0]);
    // Listening to itself does not hold it back.
    expect(order({ vsAFmSrc: 2 })).toEqual([0, 1, 2]);
    // A ring (A ← B ← A) opens at A; C hears both, so it goes last.
    expect(order({ vsAModSrc: 3, vsBModSrc: 2, vsCFmSrc: 2, vsCModSrc: 3 })).toEqual([0, 1, 2]);
    // B ← C ← B with A hearing C: the ring opens at B.
    expect(order({ vsBModSrc: 4, vsCModSrc: 3, vsAFmSrc: 4 })).toEqual([1, 2, 0]);
    // The order goes into the block, and is always each oscillator once.
    const block = paramBlock({ ...VIDEOSYNTH_DEFAULTS, vsAModSrc: 3, vsBModSrc: 0, vsBFmSrc: 4, vsCModSrc: 0 }, 1);
    expect(Array.from(block.slice(SLOT_ORDER, SLOT_ORDER + 3))).toEqual([2, 1, 0]);
    for (let mask = 0; mask < 512; mask++) {
      const p: Record<string, number> = {};
      ['vsAModSrc', 'vsBModSrc', 'vsCModSrc'].forEach((k, i) => { p[k] = [0, 2, 3, 4][(mask >> (i * 2)) & 3]; });
      p.vsAFmSrc = [0, 3, 4][mask % 3];
      expect([...order(p)].sort()).toEqual([0, 1, 2]);
    }
  });
});
