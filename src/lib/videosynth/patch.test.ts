import { describe, expect, it } from 'vitest';
import { paramBlock, paramValue, PARAM_FLOATS, SLOT_ASPECT, VIDEOSYNTH_DEFAULTS, VIDEOSYNTH_PARAMS, VIDEOSYNTH_PRESETS } from './patch';
import { buildVideoSynthGraph } from './graph';
import { discoverKeyframeableParams } from '../keyframes/paramDiscovery';
import { applyParamOverrides } from '../keyframes/applyParamOverrides';
import type { Layer } from '../types';

describe('Phosphor controls', () => {
  it('give every control its own slot inside the block', () => {
    const slots = VIDEOSYNTH_PARAMS.map((p) => p.slot);
    expect(new Set(slots).size).toBe(slots.length);
    expect(Math.max(...slots)).toBeLessThan(SLOT_ASPECT);
    expect(SLOT_ASPECT).toBeLessThan(PARAM_FLOATS);
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
});
