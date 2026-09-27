/**
 * One-click Looks: every recipe builds a stack the native core can draw, a
 * Look lands on the target shapes as one undo step, re-picking replaces
 * instead of piling on, and a Look survives a project save and reload.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('../stores/layers');
let types: typeof import('../types');
let looks: typeof import('./edgeLooks');
let catalog: typeof import('./edgeLookCatalog');
let presets: typeof import('../stores/edgeEffectPresets');
let edge: typeof import('../drawing/edgeEffects');
let history: typeof import('../stores/history');
let hooks: typeof import('../stores/historyHooks');

function installDomShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const makeEl = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    load() {}, play: () => Promise.resolve(), pause() {},
  });
  (globalThis as any).document = {
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).CustomEvent ??= class extends Event {
    detail: unknown;
    constructor(name: string, options: any) { super(name); this.detail = options.detail; }
  };
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('../stores/layers');
  types = await import('../types');
  looks = await import('./edgeLooks');
  catalog = await import('./edgeLookCatalog');
  presets = await import('../stores/edgeEffectPresets');
  edge = await import('../drawing/edgeEffects');
  history = await import('../stores/history');
  hooks = await import('../stores/historyHooks');
});

function sixShapes() {
  const shapes = Array.from({ length: 6 }, (_, i) => types.createLayer(`shape-${i}`, `Shape ${i + 1}`, 'media'));
  const group = types.createLayer('group-1', 'Group', 'group');
  shapes[4] = { ...shapes[4], parentGroupId: 'group-1' } as any;
  shapes[5] = { ...shapes[5], parentGroupId: 'group-1' } as any;
  const payload: any = {
    version: '2.0.12',
    project: { id: 'looks', name: 'Looks', width: 1920, height: 1080, layers: [...shapes, group] },
  };
  expect(layers.project.importProject(payload)).toBe(true);
  return shapes.map((shape) => shape.id);
}

const layerById = (id: string) => get(layers.project).layers.find((layer) => layer.id === id)!;

describe('Look recipes', () => {
  it('has around twenty distinct Looks, each with a thumbnail palette', () => {
    expect(catalog.EDGE_LOOKS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(catalog.EDGE_LOOKS.map((look) => look.id)).size).toBe(catalog.EDGE_LOOKS.length);
    for (const look of catalog.EDGE_LOOKS) expect(looks.LOOK_PALETTES.some((p) => p.id === look.palette)).toBe(true);
  });

  it('builds stacks the preset validator and the native packer accept, in every palette', () => {
    for (const look of catalog.EDGE_LOOKS) {
      for (const palette of looks.LOOK_PALETTES) {
        const effects = looks.buildLookEffects(look, palette.id);
        expect(effects.length, look.id).toBeGreaterThan(0);
        expect(effects.length).toBeLessThanOrEqual(edge.EDGE_EFFECT_LIMIT);
        expect(() => presets.parseEdgeEffectPresets(JSON.stringify([{ id: 'p', name: look.name, effects }]))).not.toThrow();
        for (const effect of effects) {
          const packed = edge.packNativeEdgeEffect(effect, {
            outline: { centroid: { x: 50, y: 50 }, bbox: [0, 0, 100, 100] } as any,
            layerCenter: { x: 50, y: 50 }, width: 1920, height: 1080,
          });
          expect(packed).toHaveLength(22);
          expect(packed.flat().every(Number.isFinite), look.id).toBe(true);
        }
      }
    }
  });

  it('every Look moves to the beat or runs a group chase', () => {
    for (const look of catalog.EDGE_LOOKS) {
      const effects = looks.buildLookEffects(look);
      const beatDriven = effects.some((e) => e.react || (e.fill as any).progressMode === 'beat' || (e.stroke as any).beatLock);
      expect(beatDriven || effects.some((e) => e.chaseMode), look.id).toBe(true);
    }
  });

  it('paints with the chosen palette', () => {
    const look = catalog.edgeLook('neon-pulse')!;
    const ice = looks.lookPalette('ice').colors[0];
    expect((looks.buildLookEffects(look, 'ice')[0].stroke as any).color).toEqual(ice);
  });
});

describe('beat reaction packing', () => {
  const effect = (react: any, chaseMode?: any) => ({ ...types.createDefaultEdgeEffect(), react, chaseMode });
  const ctx = (order: number, count: number) => ({ chase: { order, leftToRight: 1 - order, radial: 0 }, count, groupBounds: [0, 0, 1, 1] as any });

  it('leaves effects without a reaction exactly as before', () => {
    expect(edge.packEdgeReact(effect(undefined), ctx(0.5, 3))).toEqual({ chase: [0, 0, 0, 0], react: [0, 0, 0, 0] });
  });

  it('packs the group index, count and chase in the effect chase order', () => {
    const packed = edge.packEdgeReact(effect({ mode: 'step', source: 'kick', amount: 0.8, chaseBeats: 0.25, hueStep: 0.5 }), ctx(0.4, 6));
    expect(packed.react).toEqual([3, 1, 0.8, 1]);
    expect(packed.chase).toEqual([2, 6, 0.25, 0.5]);
    const ltr = edge.packEdgeReact(effect({ mode: 'pulse', source: 'beat', amount: 1 }, 'leftToRight'), ctx(0.4, 6));
    expect(ltr.chase[0]).toBe(3);
  });
});

describe('applying a Look', () => {
  it('dresses all shapes, or just the selection with groups expanded', () => {
    const ids = sixShapes();
    const project = get(layers.project);
    expect(looks.lookTargetLayerIds(project.layers, [], 'all')).toEqual(ids);
    expect(looks.lookTargetLayerIds(project.layers, ['shape-0', 'group-1'], 'selected')).toEqual(['shape-0', 'shape-4', 'shape-5']);
  });

  it('replaces the stack on re-pick and swaps palettes in place', () => {
    const ids = sixShapes();
    layers.project.applyEdgeEffects([ids[0]], [types.createDefaultEdgeEffect()], 'replace');
    expect(layers.project.applyLook(ids, 'comet-chase', 'neon')).toBe(6);
    const first = layerById(ids[0]).edgeEffects!;
    expect(first.look).toEqual({ id: 'comet-chase', paletteId: 'neon' });
    expect(first.effects).toHaveLength(looks.buildLookEffects(catalog.edgeLook('comet-chase')!).length);
    layers.project.applyLook(ids, 'beat-step', 'acid');
    const second = layerById(ids[0]).edgeEffects!;
    expect(second.look).toEqual({ id: 'beat-step', paletteId: 'acid' });
    expect(second.effects).toHaveLength(2);
    // Every layer owns its effects: no shared ids for modulation to cross.
    const allIds = ids.flatMap((id) => layerById(id).edgeEffects!.effects.map((e) => e.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('is one undo step, and clearing a Look is another', () => {
    const ids = sixShapes();
    const record = () => history.history.record(get(layers.project), null, null);
    history.history.init(get(layers.project));
    hooks.setHistoryCallback(record);
    try {
      layers.project.applyLook(ids, 'neon-pulse');
      layers.project.applyLook(ids, 'neon-pulse', 'fire');
      let step = history.history.undo(get(layers.project))!;
      expect(step.project.layers.find((l) => l.id === ids[0])!.edgeEffects!.look).toEqual({ id: 'neon-pulse', paletteId: 'neon' });
      layers.project.set(step.project);
      step = history.history.undo(get(layers.project))!;
      expect(step.project.layers.every((l) => !l.edgeEffects)).toBe(true);
      layers.project.set(step.project);
      layers.project.applyLook(ids, 'kick-strobe');
      expect(layers.project.clearLook([ids[0], ids[1]])).toBe(2);
      expect(layerById(ids[0]).edgeEffects).toBeNull();
      expect(layerById(ids[2]).edgeEffects!.look!.id).toBe('kick-strobe');
    } finally {
      hooks.setHistoryCallback(() => {});
    }
  });

  it('saves and reopens with the project, beat reactions included', () => {
    const ids = sixShapes();
    layers.project.applyLook(ids, 'hue-hop', 'candy');
    const before = layerById(ids[3]).edgeEffects!;
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    layers.project.applyLook(ids, 'zigzag');
    expect(layers.project.importProject(saved)).toBe(true);
    const after = layerById(ids[3]).edgeEffects!;
    expect(after).toEqual(before);
    expect(after.effects[0].react).toMatchObject({ mode: 'pulse', hueStep: 1 / 6 });
  });
});

describe('Screen FX colour chase settings', () => {
  it('records a chase order from selection clicks and saves it with the project', async () => {
    const recorder = await import('../stores/chaseOrderRecorder');
    const ids = sixShapes();
    layers.project.selectLayer(ids[2]);
    layers.project.addMappingStageEffect({ id: 'ring', type: 'chase', enabled: true, opacity: 1, params: { speed: 1, width: 0.2 } });
    recorder.startChaseOrderRecording('mapping', 'ring', (_t, id, order) => layers.project.updateMappingStageEffect(id, { order }));
    // The first click lands on the layer that was already selected.
    for (const id of [ids[2], ids[5], ids[0], ids[5], ids[3]]) layers.project.selectLayer(id);
    recorder.stopChaseOrderRecording(true);
    layers.project.updateMappingStageEffect('ring', { output: 'color', colorStyle: 'two-tone', color: '#ff00aa', color2: '#00ccff' });
    const effect = () => get(layers.project).mappingComposition!.stageEffects.find((e) => e.id === 'ring')!;
    expect(effect().order).toEqual([ids[2], ids[5], ids[0], ids[3]]);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    layers.project.updateMappingStageEffect('ring', { output: undefined, order: undefined });
    expect(layers.project.importProject(saved)).toBe(true);
    expect(effect()).toMatchObject({ output: 'color', colorStyle: 'two-tone', color: '#ff00aa', color2: '#00ccff', order: [ids[2], ids[5], ids[0], ids[3]] });
  });
});
