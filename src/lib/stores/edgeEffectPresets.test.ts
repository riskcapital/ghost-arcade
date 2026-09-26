import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { EdgeEffect } from '../types';
import { createEdgeEffectPresetLibrary, instantiateEdgeEffects, parseEdgeEffectPresets } from './edgeEffectPresets';

let layers: typeof import('./layers');
let types: typeof import('../types');

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
  layers = await import('./layers');
  types = await import('../types');
});

const stack = (): EdgeEffect[] => [
  {
    id: 'glow', enabled: true, opacity: 0.8, blendMode: 'add',
    stroke: { type: 'glow', color: [0, 1, 0.5, 1], width: 3, glowSize: 15, glowIntensity: 1, pulseSpeed: 1 },
    fill: { type: 'none' }, animation: { type: 'none' },
    paramAuto: { 'stroke.width': { phase: 0.2, timing: 'beat', cycleBeats: 4, easing: 'sine', mode: 'pingpong', speedHz: 1, min: 1, max: 8, playing: true } },
  } as EdgeEffect,
  {
    id: 'half', enabled: false, opacity: 1, blendMode: 'normal',
    stroke: { type: 'half', color: [1, 1, 1, 1], width: 4, speed: 0.3, trimMode: 'drawOn' },
    fill: { type: 'hypnotic', color: [1, 0, 0, 1], color2: [0, 0, 0, 0], band: 12, speed: 0.4 },
    animation: { type: 'flipY', speed: 0.25, perspective: 0.5 },
    customCenter: true, centerX: 0.3, centerY: 0.6, chaseMode: 'order', chaseSpread: 0.5,
  } as EdgeEffect,
];

function storage() {
  let raw: string | null = null;
  return { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
}

describe('edge effect preset library', () => {
  it('saves a whole stack with its corner radius and hands out independent copies', () => {
    const disk = storage();
    const library = createEdgeEffectPresetLibrary(disk);
    const source = stack();
    library.save('  Neon frame  ', source, 12);
    (source[0].stroke as any).width = 99;
    const reopened = get(createEdgeEffectPresetLibrary(disk)).presets[0];
    expect(reopened.name).toBe('Neon frame');
    expect(reopened.cornerRadius).toBe(12);
    expect(reopened.effects).toHaveLength(2);
    expect((reopened.effects[0].stroke as any).width).toBe(3);
    expect(reopened.effects[1]).toMatchObject({ enabled: false, customCenter: true, chaseMode: 'order', fill: { type: 'hypnotic' }, animation: { type: 'flipY' } });
    const a = instantiateEdgeEffects(reopened.effects);
    const b = instantiateEdgeEffects(reopened.effects);
    expect(new Set([...a, ...b, ...reopened.effects].map((e) => e.id)).size).toBe(6);
    a[0].paramAuto!['stroke.width'].phase = 0.9;
    expect(b[0].paramAuto!['stroke.width'].phase).toBe(0.2);
  });

  it('rejects unknown types, bad values and duplicate names, and keeps unreadable libraries', () => {
    const library = createEdgeEffectPresetLibrary(storage());
    expect(() => library.save('Empty', [])).toThrow();
    library.save('One', stack());
    expect(() => library.save(' one ', stack())).toThrow('already saved');
    const bad = (patch: Record<string, unknown>) => JSON.stringify([{ id: 'p', name: 'Bad', effects: [{ ...stack()[0], ...patch }] }]);
    expect(() => parseEdgeEffectPresets(bad({ stroke: { type: 'teleport' } }))).toThrow();
    expect(() => parseEdgeEffectPresets(bad({ opacity: 2 }))).toThrow();
    expect(() => parseEdgeEffectPresets(bad({ chaseMode: 'sideways' }))).toThrow();
    const disk = storage(); disk.setItem('', '{broken');
    const broken = createEdgeEffectPresetLibrary(disk);
    expect(get(broken).error).toContain('preserved');
    expect(() => broken.save('New', stack())).toThrow();
    expect(disk.getItem()).toBe('{broken');
  });

  it('exports and imports libraries, renaming collisions', () => {
    const source = createEdgeEffectPresetLibrary(storage());
    source.save('Frame', stack(), 4);
    const target = createEdgeEffectPresetLibrary(storage());
    target.save('Frame', stack());
    const ids = target.importLibrary(source.exportLibrary());
    expect(ids).toHaveLength(1);
    const names = get(target).presets.map((p) => p.name);
    expect(names).toEqual(['Frame', 'Frame (2)']);
    expect(get(target).presets[1].cornerRadius).toBe(4);
    expect(() => target.importLibrary(JSON.stringify({ format: 'ghost-arcade-effect-chains', version: 1, presets: [] }))).toThrow('edge effect preset file');
  });
});

describe('applying edge effect presets to layers', () => {
  it('applies one stack to several layers in one step and survives a project save and reload', () => {
    const payload: any = {
      version: '2.0.12',
      project: {
        id: 'edges', name: 'Edges', width: 1920, height: 1080,
        layers: ['a', 'b', 'c', 'd'].map((id) => types.createLayer(id, id.toUpperCase(), 'media')),
      },
    };
    expect(layers.project.importProject(payload)).toBe(true);
    const ids = get(layers.project).layers.map((l) => l.id);
    layers.project.applyEdgeEffects(ids.slice(0, 3), stack(), 'replace', 8);
    let project = get(layers.project);
    for (const layer of project.layers.slice(0, 3)) {
      expect(layer.edgeEffects?.enabled).toBe(true);
      expect(layer.edgeEffects?.effects.map((e) => e.stroke.type)).toEqual(['glow', 'half']);
      expect(layer.edgeEffects?.cornerRadius).toBe(8);
    }
    expect(project.layers[3].edgeEffects).toBeNull();
    // Every layer owns its effects: no shared ids between layers.
    const effectIds = project.layers.slice(0, 3).flatMap((l) => l.edgeEffects!.effects.map((e) => e.id));
    expect(new Set(effectIds).size).toBe(6);

    // Append adds after what is there.
    layers.project.applyEdgeEffects([ids[0]], [stack()[0]], 'append');
    expect(get(layers.project).layers[0].edgeEffects!.effects).toHaveLength(3);
    expect(get(layers.project).layers[0].edgeEffects!.cornerRadius).toBe(8);

    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    project = get(layers.project);
    expect(project.layers[0].edgeEffects!.effects).toHaveLength(3);
    expect(project.layers[1].edgeEffects).toMatchObject({ enabled: true, cornerRadius: 8 });
    expect(project.layers[1].edgeEffects!.effects[1]).toMatchObject({
      stroke: { type: 'half', trimMode: 'drawOn' }, fill: { type: 'hypnotic', band: 12 }, animation: { type: 'flipY' },
      customCenter: true, centerX: 0.3, chaseMode: 'order', chaseSpread: 0.5,
    });
    expect(project.layers[0].edgeEffects!.effects[0].paramAuto!['stroke.width'].max).toBe(8);
  });

  it('reorders a stack', () => {
    const layer = get(layers.project).layers[1];
    const [first, second] = layer.edgeEffects!.effects;
    layers.project.moveEdgeEffect(layer.id, second.id, -1);
    expect(get(layers.project).layers[1].edgeEffects!.effects.map((e) => e.id)).toEqual([second.id, first.id]);
    layers.project.moveEdgeEffect(layer.id, second.id, -1);
    expect(get(layers.project).layers[1].edgeEffects!.effects[0].id).toBe(second.id);
  });
});
