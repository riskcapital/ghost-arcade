import { describe, expect, it } from 'vitest';
import { createLayer } from '../types';
import {
  buildVJClipTransitionLayers,
  buildVJClipTransitionGraph,
  buildVJClipTransitionUniformUpdate,
  makeVJClipTransitionCarrier,
  vjClipTransitionInputId,
  vjClipTransitionInverse,
  vjClipTransitionSourceId,
  VJ_CLIP_TRANSITION_UNIFORM_BYTES,
  VJ_CLIP_TRANSITION_WGSL,
  type VJClipTransitionGraphOptions,
} from './vjClipTransitionNative';

function layer(id: string, opacity = 1) {
  return { ...createLayer(id, id, 'media'), opacity, source: { id: `src:${id}`, type: 'video' as const, src: `${id}.mp4`, name: id } };
}
function options(): VJClipTransitionGraphOptions {
  return {
    outputSourceId: 'plugin:vj-layer-0:vj-crossfade', sourceAId: 'layer-frame:out', sourceBId: 'layer-frame:in',
    width: 1920, height: 1080, mix: 0.4, transition: 'dissolve', time: 0, frameIndex: 0,
    branchA: { layer: layer('out'), opacity: 0.4, premultiplied: false, uvTransform: [0.1, 0.2, 0.5, 0.6], uvFlags: [2, 1.5, 1, 0] },
    branchB: { layer: layer('in'), opacity: 0.8, premultiplied: true, uvTransform: [0, 0, 1, 1], uvFlags: [0, 1, 0, 0] },
  };
}
const floats = (base64: string) => new Float32Array(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer);

describe('native per-row clip transitions', () => {
  it('keeps stable canonical row IDs while isolating each token and deck helper', () => {
    const a = { ...layer('vj-layer-0-A', 0.8), bank: 'A' as const };
    const b = { ...layer('vj-layer-0-B', 0.3), bank: 'B' as const };
    const expanded = buildVJClipTransitionLayers([a, b], new Map([
      [a.id, { outgoing: layer(a.id, 0.6), progress: 0.2, style: 'wipe', token: 42 }],
      [b.id, { outgoing: layer(b.id, 0.2), progress: 0.7, style: 'slide', token: 43 }],
    ]));
    expect(expanded.filter((l) => /^vj-layer-\d+(?:-[AB])?$/.test(l.id)).map((l) => l.id)).toEqual([a.id, b.id]);
    expect(new Set(expanded.map((l) => l.id)).size).toBe(6);
    expect(expanded.filter((l) => l.id.startsWith('__')).every((l) => l.opacity === 0 && !l.bank && !l._deckMonitorBank)).toBe(true);
    expect(expanded[2].bank).toBe('A');
    expect(expanded[5].bank).toBe('B');
    expect(expanded[2].source?.effectSource?.vjxfadeLayerB).toBe(vjClipTransitionInputId(a.id, 'in', 42));
    expect(vjClipTransitionInputId(a.id, 'in', 43)).not.toBe(vjClipTransitionInputId(a.id, 'in', 42));
    expect(vjClipTransitionSourceId(a.id)).toBe('plugin:vj-layer-0-A:vj-crossfade');
  });

  it('applies each clip geometry and effect chain once and leaves carrier neutral', () => {
    const incoming = layer('vj-layer-2', 0.7);
    incoming.corners.topLeft = { x: 0.25, y: 0.75 };
    incoming.contentFit = 'crop';
    incoming.flipH = true;
    incoming.effects = [{ id: 'fx', type: 'invert', enabled: true, amount: 0.5 } as any];
    const outgoing = layer(incoming.id, 0.2);
    outgoing.contentFit = 'fill';
    const expanded = buildVJClipTransitionLayers([incoming], new Map([[incoming.id, { outgoing, progress: 0.5, style: 'dissolve' }]]));
    expect(expanded[0].contentFit).toBe('fill');
    expect(expanded[1].corners).toBe(incoming.corners);
    expect(expanded[1].effects).toBe(incoming.effects);
    const carrier = expanded[2];
    expect(carrier.corners).toEqual(createLayer('', '', 'media').corners);
    expect(carrier.effects).toEqual([]);
    expect(carrier.flipH).toBe(false);
    expect(carrier.contentFit).toBe('stretch');
    expect(carrier.opacity).toBe(1);
    expect(carrier.source?.effectSource).toMatchObject({ vjxfadeOpacityA: 0.2, vjxfadeOpacityB: 0.7 });
    expect(incoming.opacity).toBe(0.7);
  });

  it('binds interrupted mixed pictures directly, avoiding reapplying outgoing FX/opacity', () => {
    const incoming = layer('vj-layer-0');
    const result = buildVJClipTransitionLayers([incoming], new Map([[incoming.id, {
      outgoing: layer(incoming.id, 0.1), progress: 0, style: 'liquid', token: 9, snapshotSourceId: 'frozen:9',
    }]]));
    expect(result).toHaveLength(2);
    expect(result[1].source?.effectSource).toMatchObject({ vjclipSourceA: 'frozen:9', vjxfadeOpacityA: 1 });
    expect(result.some((l) => l.id.endsWith(':out'))).toBe(false);
    const graph = buildVJClipTransitionGraph({ ...options(), sourceAId: 'frozen:9' });
    expect(graph.config.render_passes[0].bindings[2]).toEqual({ binding: 2, kind: 'source-frame-texture', source_id: 'frozen:9' });
  });

  it('releases branches on completion and leaves ordinary rows untouched', () => {
    const layers = [layer('vj-layer-0'), layer('vj-layer-1')];
    expect(buildVJClipTransitionLayers(layers, new Map())).toBe(layers);
    const done = buildVJClipTransitionLayers(layers, new Map([[layers[0].id, { outgoing: layer('old'), progress: 1, style: 'wipe' }]]));
    expect(done).toEqual(layers);
    expect(done[0]).toBe(layers[0]);
  });

  it('inverts rotated, translated, nonuniform input geometry independently', () => {
    const transformed = layer('out');
    transformed.corners = {
      topLeft: { x: 0.7, y: 0.8 }, topRight: { x: 0.7, y: 0.3 },
      bottomLeft: { x: 0.4, y: 0.8 }, bottomRight: { x: 0.4, y: 0.3 },
    };
    const inverse = vjClipTransitionInverse(transformed);
    const sample = (x: number, y: number) => [inverse.x[0] * x + inverse.x[1] * y + inverse.x[2], inverse.y[0] * x + inverse.y[1] * y + inverse.y[2]];
    expect(sample(0.7, 0.2)[0]).toBeCloseTo(0);
    expect(sample(0.7, 0.2)[1]).toBeCloseTo(0);
    expect(sample(0.4, 0.7)[0]).toBeCloseTo(1);
    expect(sample(0.4, 0.7)[1]).toBeCloseTo(1);
    expect(sample(0.55, 0.45)[0]).toBeCloseTo(0.5);
    expect(sample(0.55, 0.45)[1]).toBeCloseTo(0.5);
    transformed.corners.bottomLeft = transformed.corners.topLeft;
    expect(vjClipTransitionInverse(transformed).valid).toBe(false);
  });

  it('packs independent fit, crop, alpha conventions, readiness and opacity into the core layout', () => {
    const data = floats(buildVJClipTransitionUniformUpdate({ ...options(), branchB: { ...options().branchB, ready: false } }).initialB64);
    expect(data.byteLength).toBe(VJ_CLIP_TRANSITION_UNIFORM_BYTES);
    expect(Array.from(data.slice(6, 8))).toEqual([1, 0]);
    expect(Array.from(data.slice(20, 24))).toEqual([2, 1.5, 1, 0]);
    expect(data[24]).toBeCloseTo(0.4);
    expect(data[25]).toBe(0); // Raw image/video gets premultiplied once.
    expect(data[48]).toBeCloseTo(0.8);
    expect(data[49]).toBe(1); // Nested graph preserves premultiplied coverage.
    expect(Array.from(data.slice(28, 32))).toEqual([0, 0, 1, 1]);
    expect(Array.from(data.slice(52, 56))).toEqual([0, 0, 1, 1]);
  });

  it('updates uniforms for live geometry changes without reinstalling solely for time', () => {
    const base = options();
    const first = buildVJClipTransitionUniformUpdate(base);
    expect(buildVJClipTransitionUniformUpdate({ ...base, time: 99 }).signature).toBe(first.signature);
    const shifted = { ...base.branchA.layer, corners: { ...base.branchA.layer.corners, topLeft: { x: 0.2, y: 1 } } };
    expect(buildVJClipTransitionUniformUpdate({ ...base, branchA: { ...base.branchA, layer: shifted } }).signature).not.toBe(first.signature);
  });

  it('wraps A/B as another neutral alpha-preserving graph with exact blend and bank levels', () => {
    const a = { ...layer('vj-layer-0-A', 0.6), bank: 'A' as const };
    const carrier = makeVJClipTransitionCarrier(a, a.id, 'vj-layer-0-B', 0.35, 'glitch', {
      id: 'vj-xfade-0', opacityA: 0.6, opacityB: 0.4, blendMode: 'screen',
    });
    expect(carrier.id).toBe('vj-xfade-0');
    expect(carrier.effects).toEqual([]);
    expect(carrier.source?.effectSource).toMatchObject({
      vjclipTransition: true, vjxfadeMix: 0.35, vjxfadeBlend: 'screen', vjxfadeOpacityA: 0.6, vjxfadeOpacityB: 0.4,
    });
  });

  it('keeps all ten shared transitions coverage-aware, including channel splits and seam highlights', () => {
    for (let id = 0; id < 10; id++) expect(VJ_CLIP_TRANSITION_WGSL).toContain(`transition == ${id}`);
    expect(VJ_CLIP_TRANSITION_WGSL).toContain('max(max(sampleA(uv + vec2<f32>(-offset, 0.0)).a');
    expect(VJ_CLIP_TRANSITION_WGSL).toContain('max(max(sampleB(uv + vec2<f32>(-offset, 0.0)).a');
    expect(VJ_CLIP_TRANSITION_WGSL).toContain('vec3<f32>(col.a), seam * 0.45');
    expect(VJ_CLIP_TRANSITION_WGSL).toContain('if (u.ready.y < 0.5) { return sampleA(in.uv); }');
    expect(VJ_CLIP_TRANSITION_WGSL).not.toContain('var col = vec4<f32>(0.0, 0.0, 0.0, 1.0)');
  });
});

it('keeps the transformed incoming picture behind the same canonical carrier after completion', () => {
  const incoming = layer('vj-layer-0-A', 0.35);
  incoming.contentFit = 'crop';
  incoming.flipH = true;
  incoming.cropRegion = { x: 0.2, y: 0.1, width: 0.6, height: 0.7 };
  incoming.corners = {
    topLeft: { x: 0.2, y: 0.8 }, topRight: { x: 0.8, y: 0.8 },
    bottomLeft: { x: 0.2, y: 0.2 }, bottomRight: { x: 0.8, y: 0.2 },
  };
  const outgoing = layer(incoming.id, 0.8);
  const active = buildVJClipTransitionLayers([incoming], new Map([[incoming.id, { outgoing, progress: 0.999, style: 'wipe', token: 5 }]]), true);
  const completed = buildVJClipTransitionLayers([incoming], new Map(), true);
  const a = active.find(l => l.id === incoming.id)!;
  const b = completed.find(l => l.id === incoming.id)!;
  expect(a.source?.id).toBe(b.source?.id);
  expect(a.corners).toEqual(b.corners);
  expect(b.opacity).toBe(1);
  expect(b.source?.effectSource).toMatchObject({ vjxfadeMix: 1, vjxfadeOpacityB: 0.35, vjclipTransitionActive: false });
  expect(a.source?.effectSource).toMatchObject({ vjclipTransitionActive: true });
  const activeInput = active.find(l => l.id.endsWith(':in'))!;
  const steadyInput = completed.find(l => l.id.endsWith(':in'))!;
  for (const key of ['corners', 'contentFit', 'cropRegion', 'flipH', 'effects'] as const) expect(steadyInput[key]).toEqual(activeInput[key]);
  expect(completed).toHaveLength(2);
  expect(steadyInput.source).toBe(incoming.source);
});
