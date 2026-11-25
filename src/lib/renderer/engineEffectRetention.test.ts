import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderEngine } from './engine';

// The GPU effect runner pulls in the settings store, which needs a DOM.
vi.mock('./gpuEffectRunner', () => ({
  GpuEffectRunner: class {},
  isGpuEffect: () => false,
}));

/** An engine with only the maps the effect-material paths touch; no WebGL. */
function engine() {
  const e = Object.create(RenderEngine.prototype) as any;
  e.effectMaterials = new Map();
  e.retiredEffectMaterials = new Map();
  e.effectLiveKeys = new Set();
  e.effectFeedbackTargets = new Map();
  e.effectFeedbackHasPrior = new Map();
  e.temporalEffectLiveKeys = new Set();
  e.temporalMagnificationRunner = { reapStale: vi.fn() };
  e.renderer = { getContext: () => ({}) };
  return e;
}

function draw(e: any, effect: { id: string; type: string }) {
  const material = e.getOrCreateEffectMaterial(effect);
  e.effectLiveKeys.add(effect.id);
  return material;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('RenderEngine effect material retention', () => {
  it('keeps an effect switched off compiled, and switching it back on reuses it', () => {
    const e = engine();
    const effect = { id: 'fx1', type: 'vignette' };
    const first = draw(e, effect);
    e.reapStaleEffectResources();
    // A frame without it: retired, not disposed.
    const dispose = vi.spyOn(first, 'dispose');
    e.reapStaleEffectResources();
    expect(dispose).not.toHaveBeenCalled();
    expect(e.effectMaterials.has('fx1')).toBe(false);
    expect(draw(e, effect)).toBe(first);
    expect(e.retiredEffectMaterials.size).toBe(0);
  });

  it('frees a retired material after the retention time', () => {
    const e = engine();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const material = draw(e, { id: 'fx1', type: 'vignette' });
    const dispose = vi.spyOn(material, 'dispose');
    e.reapStaleEffectResources();
    e.reapStaleEffectResources();
    now += 29_000;
    e.reapStaleEffectResources();
    expect(dispose).not.toHaveBeenCalled();
    now += 2_000;
    e.reapStaleEffectResources();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(e.retiredEffectMaterials.size).toBe(0);
  });

  it('does not revive a retired material for an effect whose type changed', () => {
    const e = engine();
    const old = draw(e, { id: 'fx1', type: 'vignette' });
    const dispose = vi.spyOn(old, 'dispose');
    e.reapStaleEffectResources();
    e.reapStaleEffectResources();
    const next = draw(e, { id: 'fx1', type: 'hue' });
    expect(next).not.toBe(old);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps at most 64 retired materials, freeing the oldest first', () => {
    const e = engine();
    const materials = Array.from({ length: 70 }, (_, i) => draw(e, { id: `fx${i}`, type: 'vignette' }));
    const disposes = materials.map((m) => vi.spyOn(m, 'dispose'));
    e.reapStaleEffectResources();
    e.reapStaleEffectResources();
    expect(e.retiredEffectMaterials.size).toBe(64);
    expect(disposes.slice(0, 6).every((d) => d.mock.calls.length === 1)).toBe(true);
    expect(disposes.slice(6).every((d) => d.mock.calls.length === 0)).toBe(true);
  });

  it('removeEffectMaterial frees a retired material too', () => {
    const e = engine();
    const material = draw(e, { id: 'fx1', type: 'vignette' });
    const dispose = vi.spyOn(material, 'dispose');
    e.reapStaleEffectResources();
    e.reapStaleEffectResources();
    e.removeEffectMaterial('fx1');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(e.retiredEffectMaterials.size).toBe(0);
  });
});
