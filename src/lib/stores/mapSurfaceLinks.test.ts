/**
 * Link to existing surface, on the setup from the report: one map, eleven
 * presets made from it, four shared layers. The 4th layer is deleted, made
 * again in one preset and pasted into the others, which leaves every preset
 * with a surface of its own for it. The link puts chosen presets back on one
 * surface without touching anything else.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Composition, Layer, Project } from '../types';

let layers: typeof import('./layers');
let types: typeof import('../types');
let links: typeof import('./mapSurfaceLinks');
let surfaces: typeof import('./mapSurfaces');
let hooks: typeof import('./historyHooks');
let presetStack: typeof import('../renderer/mapPresetLayers');

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
    documentElement: makeEl(), body: makeEl(), head: makeEl(),
    createElement: () => makeEl(), querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).CustomEvent ??= class extends Event {
    detail: unknown;
    constructor(name: string, options: any) { super(name); this.detail = options.detail; }
  };
  (globalThis as any).matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  types = await import('../types');
  links = await import('./mapSurfaceLinks');
  surfaces = await import('./mapSurfaces');
  hooks = await import('./historyHooks');
  presetStack = await import('../renderer/mapPresetLayers');
});

const box = (x0: number, y0: number, x1: number, y1: number) => ({
  topLeft: { x: x0, y: y1 }, topRight: { x: x1, y: y1 },
  bottomLeft: { x: x0, y: y0 }, bottomRight: { x: x1, y: y0 },
});

const MAP_BOXES: Record<string, ReturnType<typeof box>> = {
  l1: box(0.05, 0.1, 0.25, 0.5),
  l2: box(0.3, 0.1, 0.5, 0.5),
  l3: box(0.55, 0.1, 0.75, 0.5),
  l4: box(0.8, 0.1, 0.95, 0.5),
};

function mapLayer(id: string, presetIndex = 0): Layer {
  return {
    ...types.createLayer(id, `Layer ${id.slice(1)}`, 'media'),
    corners: MAP_BOXES[id],
    // Per-preset content: each preset shows its own clip on every layer.
    source: { id: `src-${id}-${presetIndex}`, type: 'image', src: `/show/${id}-p${presetIndex}.png`, name: `${id}-p${presetIndex}` } as any,
    surfaceId: id,
  };
}

const PRESETS = Array.from({ length: 11 }, (_, i) => `P${i + 1}`);

/** A project as 2.1.11 saves it: one map, eleven presets made from it, all
 *  four layers on shared surfaces. */
function project2111() {
  const editor = ['l1', 'l2', 'l3', 'l4'].map((id) => mapLayer(id));
  return {
    version: '2.1.11',
    project: {
      id: 'eleven-presets', name: 'Eleven presets', width: 1920, height: 1080,
      layers: editor,
      mapSurfaces: editor.map((layer) => ({ id: layer.id, name: layer.name, geometry: surfaces.layerSurfaceGeometry(layer) })),
      vjMode: {
        activeCompositionId: null,
        compositions: PRESETS.map((id, i) => ({
          id, name: id, createdAt: i + 1,
          layers: ['l1', 'l2', 'l3', 'l4'].map((layerId) => mapLayer(layerId, i + 1)),
        })),
        decks: [], timeline: { clips: [] },
      },
    },
  };
}

const store = () => get(layers.project);
const preset = (id: string): Composition => store().vjMode!.compositions.find((c) => c.id === id)!;
const fourth = (id: string): Layer => preset(id).layers[3];
const storedCorners = (surfaceId: string) => store().mapSurfaces!.find((s) => s.id === surfaceId)!.geometry.corners;

/** Ctrl+V as App.svelte does it: a new id, " Copy", corners nudged. */
function paste(copied: string): Layer {
  const parsed = JSON.parse(copied);
  const layer: Layer = {
    ...parsed,
    id: types.generateUUID(),
    name: `${parsed.name} Copy`,
    corners: {
      topLeft: { x: parsed.corners.topLeft.x + 0.02, y: parsed.corners.topLeft.y - 0.02 },
      topRight: { x: parsed.corners.topRight.x + 0.02, y: parsed.corners.topRight.y - 0.02 },
      bottomLeft: { x: parsed.corners.bottomLeft.x + 0.02, y: parsed.corners.bottomLeft.y - 0.02 },
      bottomRight: { x: parsed.corners.bottomRight.x + 0.02, y: parsed.corners.bottomRight.y - 0.02 },
    },
  };
  layers.project.update((p) => ({ ...p, layers: [...p.layers, layer] }));
  return layer;
}

/** The report, step by step, through the store. Returns the new layer's id
 *  in P1 and the pasted copy's id in every other preset. */
function reproduce(): { rebuilt: string; pasted: Record<string, string> } {
  expect(layers.project.importProject(project2111())).toBe(true);
  // Delete shared layer 4 and make it again in P1.
  layers.project.loadComposition('P1');
  layers.project.removeLayer('l4');
  const rebuilt = { ...types.createLayer(types.generateUUID(), 'Layer 4', 'media'), corners: box(0.78, 0.12, 0.97, 0.55) };
  layers.project.update((p) => ({ ...p, layers: [...p.layers, rebuilt] }));
  layers.project.updateComposition('P1');
  const copied = JSON.stringify(store().layers.find((l) => l.id === rebuilt.id));
  // Paste copies into the other presets in place of their layer 4.
  const pasted: Record<string, string> = {};
  for (const id of PRESETS.slice(1)) {
    layers.project.loadComposition(id);
    layers.project.removeLayer('l4');
    pasted[id] = paste(copied).id;
    layers.project.updateComposition(id);
  }
  return { rebuilt: rebuilt.id, pasted };
}

let steps: Project[] = [];
beforeEach(() => {
  steps = [];
  hooks.setHistoryCallback(() => { steps.push(JSON.parse(JSON.stringify(store()))); });
});
afterEach(() => hooks.setHistoryCallback(() => {}));

describe('surface identity', () => {
  it('a layer is its own surface unless the link was made for it', () => {
    expect(surfaces.surfaceIdOf({ id: 'a' })).toBe('a');
    expect(surfaces.surfaceIdOf({ id: 'a', surfaceId: 'a' })).toBe('a');
    // A copy carrying the surfaceId of the layer it was copied from.
    expect(surfaces.surfaceIdOf({ id: 'copy', surfaceId: 'a' })).toBe('copy');
    expect(surfaces.surfaceIdOf({ id: 'b', surfaceId: 'a', surfaceLinkFor: 'b' })).toBe('a');
    // ...and a copy of a linked layer.
    expect(surfaces.surfaceIdOf({ id: 'copy', surfaceId: 'a', surfaceLinkFor: 'b' })).toBe('copy');
    const tagged = surfaces.tagPresetSurfaces([
      { ...types.createLayer('b', 'b', 'media'), surfaceId: 'a', surfaceLinkFor: 'b' },
      { ...types.createLayer('copy', 'copy', 'media'), surfaceId: 'a', surfaceLinkFor: 'b' },
    ]);
    expect(tagged.map((l) => [l.surfaceId, l.surfaceLinkFor])).toEqual([['a', 'b'], ['copy', undefined]]);
  });
});

describe('Link to existing surface', () => {
  it('reproduces the report: paste gives every preset its own layer 4 surface', () => {
    const { rebuilt, pasted } = reproduce();
    const fourthSurfaces = PRESETS.map((id) => fourth(id).surfaceId);
    expect(fourthSurfaces[0]).toBe(rebuilt);
    expect(new Set(fourthSurfaces).size).toBe(11);
    for (const id of PRESETS.slice(1)) expect(fourth(id)).toMatchObject({ id: pasted[id], surfaceId: pasted[id] });
    // The first three layers are still shared by all eleven.
    for (const id of PRESETS) expect(preset(id).layers.slice(0, 3).map((l) => l.surfaceId)).toEqual(['l1', 'l2', 'l3']);
    // A warp edit in P1 does not reach P2: the broken linkage.
    layers.project.loadComposition('P1');
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === rebuilt ? { ...l, corners: box(0.7, 0.2, 0.9, 0.6) } : l) }));
    layers.project.updateComposition('P1');
    layers.project.loadComposition('P2');
    expect(store().layers.find((l) => l.id === pasted.P2)!.corners).not.toEqual(box(0.7, 0.2, 0.9, 0.6));
  });

  it('repairs the 4th layer in ten selected presets, in one undo step, leaving everything else alone', () => {
    const { rebuilt, pasted } = reproduce();
    layers.project.loadComposition('P1');
    const before = JSON.parse(JSON.stringify(store())) as Project;
    const selected = PRESETS.slice(1, 10); // P2..P10; P11 stays as it is
    const request = {
      surfaceId: rebuilt,
      destinations: selected.map((id) => ({ compositionId: id, target: { kind: 'layer' as const, layerId: pasted[id] } })),
    };
    const plan = links.planSurfaceLink(store(), request);
    expect(plan.ready).toBe(true);
    expect(plan.rows.map((r) => [r.presetName, r.action, r.layerName])).toEqual(
      selected.map((id) => [id, 'relink', 'Layer 4 Copy']));

    steps = [];
    const result = layers.project.linkLayersToSurface(request);
    expect(result.ok).toBe(true);
    expect(steps).toHaveLength(1);

    const shared = storedCorners(rebuilt);
    for (const id of selected) {
      const layer = fourth(id);
      // Layer identity kept, surface identity changed.
      expect(layer.id).toBe(pasted[id]);
      expect(layer.name).toBe('Layer 4 Copy');
      expect(surfaces.surfaceIdOf(layer)).toBe(rebuilt);
      expect(layer.corners).toEqual(shared);
      // Per-preset content untouched.
      const old = before.vjMode!.compositions.find((c) => c.id === id)!.layers[3];
      expect(layer.source).toEqual(old.source);
      expect(preset(id).layers.slice(0, 3)).toEqual(before.vjMode!.compositions.find((c) => c.id === id)!.layers.slice(0, 3));
    }
    // P1 (the source) and P11 (not selected) are exactly as they were.
    expect(preset('P1')).toEqual(before.vjMode!.compositions.find((c) => c.id === 'P1'));
    expect(preset('P11')).toEqual(before.vjMode!.compositions.find((c) => c.id === 'P11'));
    expect(store().layers).toEqual(before.layers);

    // The shared warp now reaches the selected presets: edit it in P1...
    const moved = box(0.7, 0.2, 0.9, 0.6);
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === rebuilt ? { ...l, corners: moved } : l) }));
    layers.project.updateComposition('P1');
    layers.project.loadComposition('P5');
    expect(store().layers.find((l) => l.id === pasted.P5)!.corners).toEqual(moved);
    // ...and from a linked layer in another preset back to P1.
    const again = box(0.72, 0.25, 0.92, 0.66);
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === pasted.P5 ? { ...l, corners: again } : l) }));
    layers.project.updateComposition('P5');
    expect(surfaces.surfaceIdOf(fourth('P5'))).toBe(rebuilt);
    layers.project.loadComposition('P1');
    expect(store().layers.find((l) => l.id === rebuilt)!.corners).toEqual(again);
    // P11 still has its own.
    layers.project.loadComposition('P11');
    expect(store().layers.find((l) => l.id === pasted.P11)!.corners).not.toEqual(again);

    // Undo goes back to the step before the link (the state it started
    // from), which restores every preset.
    layers.project.set(before);
    for (const id of selected) expect(surfaces.surfaceIdOf(fourth(id))).toBe(pasted[id]);
  });

  it('plays linked presets on the shared surface in VJ MAP', () => {
    const { rebuilt, pasted } = reproduce();
    layers.project.linkLayersToSurface({
      surfaceId: rebuilt,
      destinations: [{ compositionId: 'P3', target: { kind: 'layer', layerId: pasted.P3 } }],
    });
    const moved = box(0.6, 0.3, 0.8, 0.7);
    layers.project.loadComposition('P1');
    const editor = store().layers.map((l) => l.id === rebuilt ? { ...l, corners: moved } : l);
    const row = (key: string, id: string) => ({ key, label: key, composition: preset(id), opacity: 1, blendMode: 'normal' as const });
    const out = presetStack.buildMapPresetLayers([row('0', 'P1'), row('1', 'P3'), row('2', 'P4')], {
      liveLayers: editor, surfaces: store().mapSurfaces, cache: new Map(),
    });
    // P3's pasted layer is now drawn on P1's surface, with the warp being dragged.
    expect(out.find((l) => l.id === `mapvj-1::${rebuilt}`)!.corners).toEqual(moved);
    expect(out.find((l) => l.id === `mapvj-0::${rebuilt}`)!.corners).toEqual(moved);
    // P4 was not linked: its own surface, its own warp.
    expect(out.find((l) => l.id === `mapvj-2::${pasted.P4}`)!.corners).not.toEqual(moved);
    // The other shared layers are unchanged.
    expect(out.find((l) => l.id === 'mapvj-1::l2')!.corners).toEqual(MAP_BOXES.l2);
  });

  it('keeps the link through save, reopen and update', () => {
    const { rebuilt, pasted } = reproduce();
    layers.project.linkLayersToSurface({
      surfaceId: rebuilt,
      destinations: PRESETS.slice(1).map((id) => ({ compositionId: id, target: { kind: 'layer' as const, layerId: pasted[id] } })),
    });
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(saved.project.vjMode.compositions[4].layers[3]).toMatchObject({ id: pasted.P5, surfaceId: rebuilt, surfaceLinkFor: pasted.P5 });
    expect(layers.project.importProject(saved)).toBe(true);
    for (const id of PRESETS) expect(surfaces.surfaceIdOf(fourth(id))).toBe(rebuilt);
    // Update a preset from the editor: the link stays.
    layers.project.loadComposition('P7');
    expect(store().layers.find((l) => l.id === pasted.P7)).toMatchObject({ surfaceId: rebuilt, surfaceLinkFor: pasted.P7 });
    layers.project.updateComposition('P7');
    expect(fourth('P7')).toMatchObject({ id: pasted.P7, surfaceId: rebuilt, surfaceLinkFor: pasted.P7 });
    // The Geometry panel counts all eleven.
    expect(links.linkableSurfaces(store()).find((s) => s.id === rebuilt)!.presetIds).toHaveLength(11);
  });

  it('detach and relink keep working on a linked layer', () => {
    const { rebuilt, pasted } = reproduce();
    layers.project.linkLayersToSurface({
      surfaceId: rebuilt,
      destinations: [{ compositionId: 'P2', target: { kind: 'layer', layerId: pasted.P2 } }],
    });
    const sharedBefore = storedCorners(rebuilt);
    layers.project.loadComposition('P2');
    layers.project.setLayerSurfaceSharing(pasted.P2, 'detach');
    const own = box(0.1, 0.6, 0.3, 0.9);
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === pasted.P2 ? { ...l, corners: own } : l) }));
    layers.project.updateComposition('P2');
    expect(storedCorners(rebuilt)).toEqual(sharedBefore);
    expect(fourth('P2')).toMatchObject({ surfaceId: rebuilt, surfaceDetached: true, corners: own });
    // Use shared: back on the link's surface.
    layers.project.setLayerSurfaceSharing(pasted.P2, 'use');
    expect(store().layers.find((l) => l.id === pasted.P2)).toMatchObject({ corners: sharedBefore, surfaceId: rebuilt, surfaceLinkFor: pasted.P2 });
    // Share this: the detached warp becomes the shared one, for P1 too.
    layers.project.setLayerSurfaceSharing(pasted.P2, 'detach');
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === pasted.P2 ? { ...l, corners: own } : l) }));
    layers.project.setLayerSurfaceSharing(pasted.P2, 'share');
    expect(storedCorners(rebuilt)).toEqual(own);
    expect(storedCorners(pasted.P2)).not.toEqual(own);
  });

  it('leaves ordinary paste alone: a copy of a linked layer is a new surface', () => {
    const { rebuilt, pasted } = reproduce();
    layers.project.linkLayersToSurface({
      surfaceId: rebuilt,
      destinations: [{ compositionId: 'P2', target: { kind: 'layer', layerId: pasted.P2 } }],
    });
    layers.project.loadComposition('P2');
    const copy = paste(JSON.stringify(store().layers.find((l) => l.id === pasted.P2)));
    expect(copy.surfaceId).toBe(rebuilt);
    expect(surfaces.surfaceIdOf(copy)).toBe(copy.id);
    layers.project.updateComposition('P2');
    expect(preset('P2').layers.find((l) => l.id === copy.id)).toMatchObject({ surfaceId: copy.id });
    expect(preset('P2').layers.find((l) => l.id === copy.id)!.surfaceLinkFor).toBeUndefined();
    expect(store().mapSurfaces!.some((s) => s.id === copy.id)).toBe(true);
  });

  it('adds the layer to a preset that lacks it, under its own id when free', () => {
    const { rebuilt } = reproduce();
    // P12: made from P1 with layer 4 taken out.
    layers.project.loadComposition('P1');
    layers.project.removeLayer(rebuilt);
    const p12 = layers.project.saveComposition('P12');
    // P13 has a layer under the rebuilt layer's id that is linked to
    // another surface (layer 1's, which P13 has no other layer on).
    layers.project.removeLayer('l1');
    layers.project.update((p) => ({ ...p, layers: [...p.layers, {
      ...types.createLayer(rebuilt, 'Other', 'media'), corners: MAP_BOXES.l1, surfaceId: 'l1', surfaceLinkFor: rebuilt,
    }] }));
    const p13 = layers.project.saveComposition('P13');
    const result = layers.project.linkLayersToSurface({
      surfaceId: rebuilt,
      destinations: [
        { compositionId: p12, target: { kind: 'add' } },
        { compositionId: p13, target: { kind: 'add' } },
      ],
    });
    expect(result.ok).toBe(true);
    const added12 = preset(p12).layers.find((l) => surfaces.surfaceIdOf(l) === rebuilt)!;
    expect(added12.id).toBe(rebuilt);
    expect(preset(p12).layers.indexOf(added12)).toBe(3);
    expect(added12.corners).toEqual(storedCorners(rebuilt));
    const added13 = preset(p13).layers.filter((l) => surfaces.surfaceIdOf(l) === rebuilt);
    expect(added13).toHaveLength(1);
    expect(added13[0].id).not.toBe(rebuilt);
    expect(added13[0].surfaceLinkFor).toBe(added13[0].id);
    // The other layer under that id kept its surface.
    expect(preset(p13).layers.find((l) => l.id === rebuilt)).toMatchObject({ name: 'Other', surfaceId: 'l1' });
    // The editor still shows P1 (saving does not switch presets), which was
    // not a destination: it is left alone.
    expect(store().vjMode!.activeCompositionId).toBe('P1');
    expect(store().layers.some((l) => l.id === added13[0].id)).toBe(false);
    // With P12 loaded, adding there reaches the editor as well.
    layers.project.set(steps[steps.length - 2]);
    layers.project.loadComposition(p12);
    layers.project.linkLayersToSurface({ surfaceId: rebuilt, destinations: [{ compositionId: p12, target: { kind: 'add' } }] });
    expect(store().layers.map((l) => l.id)).toEqual(preset(p12).layers.map((l) => l.id));
  });

  it('shows conflicts for the user to settle and applies nothing until they are', () => {
    const { rebuilt, pasted } = reproduce();
    const untouched = JSON.stringify(store().vjMode!.compositions);
    const plan = (destinations: any[]) => links.planSurfaceLink(store(), { surfaceId: rebuilt, destinations });

    // No choice made, a layer that is gone, and a preset already on the surface.
    const unsettled = plan([
      { compositionId: 'P2', target: null },
      { compositionId: 'P3', target: { kind: 'layer', layerId: 'gone' } },
      { compositionId: 'P1', target: { kind: 'layer', layerId: 'l1' } },
    ]);
    expect(unsettled.ready).toBe(false);
    expect(unsettled.rows.map((r) => r.issues.map((i) => i.kind))).toEqual([['no-choice'], ['layer-missing'], ['already-on-surface']]);
    expect(layers.project.linkLayersToSurface({ surfaceId: rebuilt, destinations: [{ compositionId: 'P2', target: null }] }).ok).toBe(false);
    expect(JSON.stringify(store().vjMode!.compositions)).toBe(untouched);

    // A layer already shared with other presets (layer 1 of P2 is on l1 with
    // ten other presets): moving it must be confirmed.
    const elsewhere = plan([{ compositionId: 'P2', target: { kind: 'layer', layerId: 'l1' } }]);
    expect(elsewhere.rows[0].issues).toEqual([{ kind: 'shared-elsewhere', surfaceName: 'Layer 1', presetNames: PRESETS.filter((id) => id !== 'P2'), resolved: false }]);
    expect(elsewhere.ready).toBe(false);
    expect(plan([{ compositionId: 'P2', target: { kind: 'layer', layerId: 'l1', moveOff: true } }]).ready).toBe(true);
    // Presets moving off the same surface together do not count as left behind.
    const together = plan(PRESETS.slice(1).map((id) => ({ compositionId: id, target: { kind: 'layer', layerId: 'l1' } })));
    expect(together.rows.find((r) => r.compositionId === 'P2')!.issues[0]).toMatchObject({ presetNames: ['P1'] });

    // A detached override: keep its warp or take the shared one.
    layers.project.loadComposition('P4');
    layers.project.setLayerSurfaceSharing(pasted.P4, 'detach');
    const own = box(0.2, 0.7, 0.4, 0.95);
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === pasted.P4 ? { ...l, corners: own } : l) }));
    layers.project.updateComposition('P4');
    expect(plan([{ compositionId: 'P4', target: { kind: 'layer', layerId: pasted.P4 } }]).rows[0].issues).toEqual([{ kind: 'detached', resolved: false }]);
    expect(layers.project.linkLayersToSurface({ surfaceId: rebuilt, destinations: [{ compositionId: 'P4', target: { kind: 'layer', layerId: pasted.P4, warp: 'own' } }] }).ok).toBe(true);
    expect(fourth('P4')).toMatchObject({ surfaceId: rebuilt, surfaceDetached: true, corners: own });
    // The editor shows P4, so its layer follows.
    expect(store().layers.find((l) => l.id === pasted.P4)).toMatchObject({ surfaceId: rebuilt, surfaceDetached: true, corners: own });
    // A missing source surface.
    expect(links.planSurfaceLink(store(), { surfaceId: 'nope', destinations: [{ compositionId: 'P2', target: { kind: 'add' } }] }).rows[0].issues[0].kind).toBe('no-source');
  });
});

describe('older project files', () => {
  it('opens a 2.1.11 project unchanged, and a stale surfaceId on a copy never shares', () => {
    const file = project2111();
    // 2.1.11 left the source's surfaceId on a duplicated editor layer.
    const dup = { ...mapLayer('l1'), id: 'dup', name: 'Layer 1 Copy', corners: box(0.06, 0.12, 0.26, 0.52), surfaceId: 'l1' };
    file.project.layers.push(dup);
    expect(layers.project.importProject(file)).toBe(true);
    const opened = store();
    expect(opened.mapSurfaces!.map((s) => s.id)).toEqual(['l1', 'l2', 'l3', 'l4']);
    for (const id of PRESETS) expect(preset(id).layers.map((l) => surfaces.surfaceIdOf(l))).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(surfaces.surfaceIdOf(opened.layers.find((l) => l.id === 'dup')!)).toBe('dup');
    // Saving it as a preset gives it a surface of its own, as before...
    const id = layers.project.saveComposition('With copy');
    expect(preset(id).layers.find((l) => l.id === 'dup')!.surfaceId).toBe('dup');
    // ...and sharing its warp never overwrites layer 1's.
    layers.project.setLayerSurfaceSharing('dup', 'detach');
    layers.project.setLayerSurfaceSharing('dup', 'share');
    expect(storedCorners('l1')).toEqual(MAP_BOXES.l1);
    expect(storedCorners('dup')).toEqual(box(0.06, 0.12, 0.26, 0.52));
    // A link survives the round trip of an older-shaped save.
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    expect(store().mapSurfaces!.find((s) => s.id === 'l1')!.geometry.corners).toEqual(MAP_BOXES.l1);
  });
});
