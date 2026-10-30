import { describe, expect, it, vi } from 'vitest';
import { RenderEngine } from './engine';

// The GPU effect runner pulls in the settings store, which needs a DOM.
vi.mock('./gpuEffectRunner', () => ({
  GpuEffectRunner: class {},
  isGpuEffect: () => false,
}));

function fakeTarget() {
  return { dispose: vi.fn(), setSize: vi.fn() };
}

/** An engine with only the maps these paths touch; no WebGL needed. */
function engineWithGroups(groupIds: string[]) {
  const engine = Object.create(RenderEngine.prototype) as any;
  engine.layerObjects = new Map();
  engine.colorTextures = new Map();
  engine.maskMaterials = new Map();
  engine.groupTargets = new Map(groupIds.map((id) => [id, fakeTarget()]));
  return engine;
}

describe('RenderEngine group render targets', () => {
  it('removeLayer frees the removed group target only', () => {
    const engine = engineWithGroups(['g1', 'g2']);
    const g1 = engine.groupTargets.get('g1');
    const g2 = engine.groupTargets.get('g2');
    engine.removeLayer('g1');
    expect(g1.dispose).toHaveBeenCalledTimes(1);
    expect(engine.groupTargets.has('g1')).toBe(false);
    expect(g2.dispose).not.toHaveBeenCalled();
    expect(engine.groupTargets.has('g2')).toBe(true);
  });

  it('resize resizes group targets with the output', () => {
    const engine = engineWithGroups(['g1']);
    engine.renderer = { setPixelRatio: vi.fn(), setSize: vi.fn() };
    for (const key of ['compositeTarget', 'tempTarget', 'effectTargetA', 'effectTargetB', 'effectBlendTarget']) {
      engine[key] = fakeTarget();
    }
    engine.vjCrossfadeTargets = new Map();
    engine.bankATarget = null;
    engine.bankBTarget = null;
    engine.vjMixTarget = null;
    engine.resize(1280, 720);
    expect(engine.groupTargets.get('g1').setSize).toHaveBeenCalledWith(1280, 720);
  });

  it('dispose frees every group target', () => {
    const base = engineWithGroups(['g1', 'g2']);
    const targets = [...base.groupTargets.values()];
    // Every other field dispose() touches reads as an empty disposable map.
    const engine = new Proxy(base, {
      get(target, key, receiver) {
        if (key in target) return Reflect.get(target, key, receiver);
        return Object.assign(new Map(), { dispose: vi.fn(), setSize: vi.fn() });
      },
    });
    engine.dispose();
    for (const target of targets) expect(target.dispose).toHaveBeenCalledTimes(1);
    expect(base.groupTargets.size).toBe(0);
  });
});
