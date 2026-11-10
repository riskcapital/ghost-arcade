import { describe, expect, it } from 'vitest';
import { applyParamOverrides, setDotPathClone, type ParamOverrideSet } from './applyParamOverrides';
import type { Layer } from '../types';

/**
 * The override code used to live inline in NativeRendererSync. This is that
 * code as it was, kept here so the shared module is held to the same output.
 */
function legacyApply(layer: any, kf: Record<string, any>): any {
  const next: any = { ...layer };
  let shaderValues: Record<string, any> | null = null;
  let effects: any[] | null = null;
  for (const [key, value] of Object.entries(kf)) {
    if (key === 'layer:opacity') {
      next.opacity = value as number;
    } else if (key.startsWith('shader:') && next.source?.shaderValues) {
      if (shaderValues === null) {
        shaderValues = { ...next.source.shaderValues };
        next.source = { ...next.source, shaderValues };
      }
      shaderValues![key.slice(7)] = value;
    } else if (key.startsWith('fx:') && next.effects?.length) {
      const [, fxId, prop] = key.split(':');
      if (effects === null) {
        effects = next.effects.map((e: any) => ({ ...e, params: { ...e.params } }));
        next.effects = effects;
      }
      const effect = effects!.find((e: any) => e.id === fxId);
      if (effect) {
        if (prop === 'enabled') effect.enabled = !!value;
        else effect.params[prop] = value;
      }
    } else if (key.startsWith('edge:') && next.edgeEffects?.effects?.length) {
      const [, edgeId, path] = key.split(':');
      const edgeIndex = next.edgeEffects.effects.findIndex((e: any) => e.id === edgeId);
      if (edgeIndex >= 0 && path) {
        const list = [...next.edgeEffects.effects];
        const edited = path === 'enabled' ? { ...list[edgeIndex], enabled: !!value } : setDotPathClone(list[edgeIndex], path, value);
        list[edgeIndex] = edited as any;
        next.edgeEffects = { ...next.edgeEffects, effects: list };
      }
    } else if (key.startsWith('splat:') && next.splatContent) {
      next.splatContent = setDotPathClone(next.splatContent, key.slice('splat:'.length), value);
    } else if (key.startsWith('model3d:') && next.model3dContent) {
      next.model3dContent = setDotPathClone(next.model3dContent, key.slice('model3d:'.length), value);
    }
  }
  return next;
}

function sampleLayer(): Layer {
  return {
    id: 'L1',
    name: 'Layer',
    opacity: 1,
    source: { id: 'src', type: 'shader', src: 'x.fs', name: 'x', shaderValues: { speed: 1, color: [1, 0, 0, 1] } },
    effects: [
      { id: 'fx1', type: 'blur', enabled: true, params: { amount: 0.2 } },
      { id: 'fx2', type: 'hue', enabled: true, params: { shift: 0 } },
    ],
    edgeEffects: { effects: [{ id: 'e1', enabled: true, opacity: 1, stroke: { width: 2, color: '#fff' } }] },
    splatContent: { position: { x: 0, y: 0 }, scale: 1 },
    model3dContent: { rotation: { y: 0 } },
  } as unknown as Layer;
}

const cases: Array<[string, ParamOverrideSet]> = [
  ['opacity', { 'layer:opacity': 0.25 }],
  ['shader inputs', { 'shader:speed': 3, 'shader:missing': 1 }],
  ['effect params and enable', { 'fx:fx1:amount': 0.8, 'fx:fx2:enabled': false, 'fx:nope:amount': 1 }],
  ['edge fields', { 'edge:e1:enabled': false, 'edge:e1:stroke.width': 5, 'edge:e1:opacity': 0.5 }],
  ['splat and model paths', { 'splat:position.x': 2, 'model3d:rotation.y': 90 }],
  ['everything at once', { 'layer:opacity': 0.5, 'shader:speed': 2, 'fx:fx1:amount': 1, 'edge:e1:stroke.width': 1, 'splat:scale': 3 }],
];

describe('applyParamOverrides', () => {
  for (const [name, overrides] of cases) {
    it(`matches the previous inline code: ${name}`, () => {
      const layer = sampleLayer();
      const before = JSON.stringify(layer);
      const next = { ...layer };
      applyParamOverrides(next, overrides);
      expect(next).toEqual(legacyApply(layer, overrides));
      // The original layer (the store's object) is never mutated.
      expect(JSON.stringify(layer)).toBe(before);
    });
  }

  it('keeps identity of untouched nested objects and of the source when no shader key applies', () => {
    const layer = sampleLayer();
    const next = { ...layer };
    applyParamOverrides(next, { 'layer:opacity': 0.1 });
    expect(next.source).toBe(layer.source);
    expect(next.effects).toBe(layer.effects);
    const shaded = { ...layer };
    applyParamOverrides(shaded, { 'shader:speed': 9 });
    expect(shaded.source).not.toBe(layer.source);
    expect(shaded.source!.id).toBe('src');
  });

  it('applying a second set on top wins on the same key (show over preset)', () => {
    const layer = sampleLayer();
    const next = { ...layer };
    applyParamOverrides(next, { 'shader:speed': 2, 'fx:fx1:amount': 0.4 });
    applyParamOverrides(next, { 'shader:speed': 7 });
    expect((next.source as any).shaderValues.speed).toBe(7);
    expect((next.effects as any)[0].params.amount).toBe(0.4);
    expect((layer.source as any).shaderValues.speed).toBe(1);
  });
});
