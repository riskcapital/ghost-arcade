/**
 * Layer persistence round trip: what a user sets is what reopens.
 *
 * The failure this guards is silent and specific. `_exportLayer` writes an
 * explicit field list, `_importLayer` reads one, and the two are maintained by
 * hand. A field added to the Layer type and wired into a panel will save fine
 * in the autosave (which serializes the live object) and then come back at its
 * default from the .gha, because nobody added the one line to the exporter.
 * Two fields were already in that state when this suite was written:
 * `arcadeContent` (imported, never exported) and `stageTextureFlipV` (set by
 * Stage Designer, in neither list).
 *
 * The guard is a diff of the Layer interface against the exporter's source
 * text, with an explicit allow-list of fields that are runtime-only. Adding a
 * persistent field without exporting it fails here rather than in someone's
 * set.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'svelte/store';

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

describe('VJ clip transition persistence', () => {
  const image = (id: string) => ({ id, type: 'image', name: id, src: `/show/${id}.png` });
  function transitionProject() {
    return {
      version: '2.0.8',
      project: { id: 'transitions', name: 'Transitions', width: 1920, height: 1080, layers: [] },
      vjClipLauncher: {
        numLayers: 1, numColumns: 2, activeBlockId: 'main',
        blocks: [{ id: 'main', name: 'Main', clipGrid: [[image('a'), image('b')]], bankBClipGrid: [[image('c'), image('d')]] }],
        layerStates: [{ opacity: 1, blendMode: 'normal', effects: [], activeColumn: 0, activeClip: image('a') }],
        bankBLayerStates: [{ opacity: 1, blendMode: 'normal', effects: [], activeColumn: 0, activeClip: image('c') }],
      },
    };
  }

  it('saves embedded LUTs in Mapping and both VJ decks without external files', async () => {
    const { parseCubeLut } = await import('../color/cubeLut');
    const { vjClipLauncher } = await import('./vjClipLauncher');
    const lut = parseCubeLut('TITLE "Portable look"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1');
    const effect = { id: 'lut', type: 'cubeLut' as const, enabled: true, params: { cubeLut: lut, lutStrength: .4 } };
    const payload: any = transitionProject();
    payload.project.layers = [{ ...types.createLayer('mapped', 'Mapped', 'media'), effects: [effect] }];
    payload.project.mappingComposition = { enabled: true, effects: [effect] };
    expect(layers.project.importProject(payload)).toBe(true);
    for (const bank of ['A', 'B'] as const) {
      vjClipLauncher.setEffectChain('layer', [effect], 0, bank);
      vjClipLauncher.setEffectChain('clip', [effect], 0, bank);
    }
    vjClipLauncher.setEffectChain('composition', [effect]);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    const project = get(layers.project), vj = get(vjClipLauncher);
    expect(project.layers[0].effects[0].params).toEqual(effect.params);
    expect(project.mappingComposition!.effects[0].params).toEqual(effect.params);
    expect(vj.compositionEffects[0].params).toEqual(effect.params);
    for (const rows of [vj.layerStates, vj.bankBLayerStates]) {
      expect(rows[0].effects[0].params).toEqual(effect.params);
      expect(rows[0].activeClip!.effects![0].params).toEqual(effect.params);
    }
  });

  it('round-trips native clip and layer audio on both decks', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    const payload: any = transitionProject();
    for (const [grid, rows, id] of [['clipGrid', 'layerStates', 'a'], ['bankBClipGrid', 'bankBLayerStates', 'c']]) {
      const video = { id, type: 'video', name: id, src: `/show/${id}.mp4`, durationSeconds: 5, audioPlayback: false, audioVolume: .4, audioPan: -.6, audioMuted: true };
      payload.vjClipLauncher.blocks[0][grid][0][0] = video;
      payload.vjClipLauncher[rows][0].activeClip = video;
    }
    expect(layers.project.importProject(payload)).toBe(true);
    vjClipLauncher.setLayerAudio(0, { audioVolume: .3, audioPan: -.2 }, 'A');
    vjClipLauncher.setLayerAudio(0, { audioVolume: .7, audioPan: .9 }, 'B');
    expect(layers.project.importProject(JSON.parse(JSON.stringify(layers.project.exportProject())))).toBe(true);
    const restored = get(vjClipLauncher);
    expect(restored.layerStates[0]).toMatchObject({ audioVolume: .3, audioPan: -.2 });
    expect(restored.bankBLayerStates[0]).toMatchObject({ audioVolume: .7, audioPan: .9 });
    for (const grid of [restored.clipGrid, restored.bankBClipGrid]) expect(grid[0][0]).toMatchObject({ audioPlayback: false, audioVolume: .4, audioPan: -.6, audioMuted: true });
  });

  it('retains native-only video dimensions and duration across a project round trip', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    const payload = transitionProject();
    const clip = { id: 'portrait-hap', name: 'Portrait HAP', type: 'video', src: '/show/portrait.mov',
      durationSeconds: 12.5, videoWidth: 1080, videoHeight: 1920 };
    (payload.project as any).layers = [{ id: 'portrait-layer', name: 'Portrait layer', type: 'media', source: clip }];
    payload.vjClipLauncher.blocks[0].clipGrid[0][0] = clip;
    payload.vjClipLauncher.layerStates[0].activeClip = clip;
    expect(layers.project.importProject(payload)).toBe(true);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(vjClipLauncher).clipGrid[0][0]).toMatchObject({
      durationSeconds: 12.5, videoWidth: 1080, videoHeight: 1920,
    });
    expect(get(vjClipLauncher).layerStates[0].activeClip).toMatchObject({
      durationSeconds: 12.5, videoWidth: 1080, videoHeight: 1920,
    });
    expect(get(layers.project).layers[0].source).toMatchObject({
      durationSeconds: 12.5, videoWidth: 1080, videoHeight: 1920,
    });
  });

  it('round-trips independent layer defaults and per-clip overrides on both decks', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    expect(layers.project.importProject(transitionProject())).toBe(true);
    vjClipLauncher.setLayerTransition(0, { duration: 1.25, style: 'wipe' }, 'A');
    vjClipLauncher.setLayerTransition(0, { duration: 3, style: 'slide' }, 'B');
    vjClipLauncher.setClipTransition(0, 1, { duration: 0, style: 'glitch' }, 'A');
    vjClipLauncher.setClipTransition(0, 1, { duration: 9.5, style: 'liquid' }, 'B');
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    const restored = get(vjClipLauncher);
    expect(restored.layerStates[0]).toMatchObject({ transitionDuration: 1.25, transitionStyle: 'wipe' });
    expect(restored.bankBLayerStates[0]).toMatchObject({ transitionDuration: 3, transitionStyle: 'slide' });
    expect(restored.clipGrid[0][1]).toMatchObject({ transitionDuration: 0, transitionStyle: 'glitch' });
    expect(restored.bankBClipGrid[0][1]).toMatchObject({ transitionDuration: 9.5, transitionStyle: 'liquid' });
  });

  it('opens old projects as immediate cuts and lets cleared clip overrides inherit again', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    expect(layers.project.importProject(transitionProject())).toBe(true);
    expect(get(vjClipLauncher).layerStates[0]).toMatchObject({ transitionDuration: 0, transitionStyle: 'dissolve' });
    expect(get(vjClipLauncher).bankBLayerStates[0]).toMatchObject({ transitionDuration: 0, transitionStyle: 'dissolve' });
    vjClipLauncher.setLayerTransition(0, { duration: 25, style: 'wipe' });
    vjClipLauncher.setClipTransition(0, 0, { duration: 2, style: 'glitch' });
    vjClipLauncher.setClipTransition(0, 0, { duration: null, style: null });
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(saved.vjClipLauncher.layerStates[0].transitionDuration).toBe(10);
    expect(saved.vjClipLauncher.layerStates[0].activeClip.transitionDuration).toBeUndefined();
    expect(saved.vjClipLauncher.blocks[0].clipGrid[0][0].transitionStyle).toBeUndefined();
    vjClipLauncher.setLayerTransition(0, { duration: null, style: null });
    expect(get(vjClipLauncher).layerStates[0]).toMatchObject({ transitionDuration: 0, transitionStyle: 'dissolve' });
  });

  it('retains outgoing geometry on launch, excludes it from saves, and removes it on stop', async () => {
    const { vjClipLauncher, vjOutputLayers, vjTransitionOutputLayers } = await import('./vjClipLauncher');
    const { vjClipTransitions } = await import('./vjClipTransitions');
    (globalThis as any).dispatchEvent = () => true;
    (globalThis as any).CustomEvent ??= class extends Event { detail: unknown; constructor(name: string, options: any) { super(name); this.detail = options.detail; } };
    const payload = transitionProject();
    Object.assign(payload.vjClipLauncher.layerStates[0].activeClip, { zoom: 0.7, rotation: 15, opacity: 0.6 });
    expect(layers.project.importProject(payload)).toBe(true);
    vjClipLauncher.setLive(true);
    vjClipLauncher.setLayerTransition(0, { duration: 1, style: 'wipe' });
    const before = get(vjOutputLayers)![0];
    vjClipLauncher.triggerClipNow(0, 1);
    expect(get(vjClipTransitions).get('A:0')?.incomingClipId).toBe('b');
    const outgoing = get(vjTransitionOutputLayers)[0].layer;
    expect(outgoing.source?.id).toBe('a');
    expect(outgoing.corners).toEqual(before.corners);
    expect(outgoing.opacity).toBe(before.opacity);
    expect(get(vjOutputLayers)?.map(layer => layer.source?.id)).toEqual(['b']);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(saved.vjClipLauncher.layerStates[0].activeClip.id).toBe('b');
    expect(saved.vjClipLauncher.layerStates[0].outgoingClip).toBeUndefined();
    expect(saved.vjClipLauncher.transitions).toBeUndefined();
    vjClipLauncher.stopLayer(0);
    expect(get(vjClipTransitions).size).toBe(0);
    expect(get(vjTransitionOutputLayers)).toEqual([]);
  });

  it('cancels transitions before muted rows disappear and does not capture hidden retriggers', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    const { vjClipTransitions } = await import('./vjClipTransitions');
    expect(layers.project.importProject(transitionProject())).toBe(true);
    vjClipLauncher.setLive(true);
    vjClipLauncher.setLayerTransition(0, { duration: 1 });
    vjClipLauncher.triggerClipNow(0, 1);
    const fade = get(vjClipTransitions).get('A:0')!;
    vjClipTransitions.markReady('A', 0, fade.token, 100);
    vjClipLauncher.toggleLayerMute(0);
    expect(get(vjClipTransitions).size).toBe(0);
    vjClipLauncher.triggerClipNow(0, 0);
    expect(get(vjClipTransitions).size).toBe(0);
    vjClipLauncher.toggleLayerMute(0);
    vjClipLauncher.triggerClipNow(0, 1);
    expect(get(vjClipTransitions).get('A:0')).toMatchObject({ outgoingClip: { id: 'a' }, incomingClipId: 'b', requiresSnapshot: false });
  });

  it('solo hides only its own deck and inactive Deck B creates no transition resources', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    const { vjClipTransitions } = await import('./vjClipTransitions');
    const payload = transitionProject();
    payload.vjClipLauncher.numLayers = 2;
    payload.vjClipLauncher.blocks[0].clipGrid.push([image('e'), image('f')]);
    payload.vjClipLauncher.layerStates.push({ ...payload.vjClipLauncher.layerStates[0], activeClip: image('e') });
    expect(layers.project.importProject(payload)).toBe(true);
    vjClipLauncher.setLive(true);
    vjClipLauncher.setCrossfaderEnabled(true);
    vjClipLauncher.setLayerTransition(0, { duration: 1 }, 'A');
    vjClipLauncher.setLayerTransition(1, { duration: 1 }, 'A');
    vjClipLauncher.setLayerTransition(0, { duration: 1 }, 'B');
    vjClipLauncher.triggerClipNow(0, 1, 'A');
    vjClipLauncher.triggerClipNow(1, 1, 'A');
    vjClipLauncher.triggerClipNow(0, 1, 'B');
    expect(get(vjClipTransitions).size).toBe(3);
    vjClipLauncher.toggleLayerSolo(0, 'A');
    expect(Array.from(get(vjClipTransitions).keys()).sort()).toEqual(['A:0', 'B:0']);
    vjClipLauncher.triggerClipNow(1, 0, 'A');
    expect(get(vjClipTransitions).has('A:1')).toBe(false);
    vjClipLauncher.setCrossfaderEnabled(false);
    vjClipLauncher.triggerClipNow(0, 0, 'B');
    expect(get(vjClipTransitions).size).toBe(0);
  });
});

/**
 * Fields that legitimately do not belong in a save file.
 *
 * Underscore-prefixed keys are runtime scratch. The rest are recomputed on
 * load or set per-session by the engine; persisting them would restore stale
 * routing rather than user intent. Anything NOT listed here is expected to
 * survive a save.
 */
const RUNTIME_ONLY_LAYER_FIELDS = new Set([
  '_deckMonitorBank',    // set per frame by the deck monitor passes
  '_deckMonitorOpacity',
  'bank',                // assigned by vjOutputLayers when the crossfader is on
  'texture',             // live GPU/DOM object
  'videoElement',        // live DOM element
  'isPlaying',           // transport state, not a setting
  'selectedElementId',   // editor selection
]);

function layerInterfaceFields(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/lib/types.ts'), 'utf8');
  const match = source.match(/export interface Layer \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('Layer interface not found in types.ts');
  const fields: string[] = [];
  let depth = 0;
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (depth === 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const field = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
      if (field) fields.push(field[1]);
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
  }
  return fields;
}

function exporterSource(): string {
  const source = readFileSync(join(process.cwd(), 'src/lib/stores/layers.ts'), 'utf8');
  const start = source.indexOf('    _exportLayer(layer: Layer)');
  const end = source.indexOf('    async _exportLayerForSave(', start);
  if (start < 0 || end < 0) throw new Error('_exportLayer not found in layers.ts');
  return source.slice(start, end);
}

/**
 * The VJ clip grid is the performer's set. It is exported by the same kind of
 * hand-maintained whitelist as layers, inside exportProject, so it carries the
 * same risk: a clip property added for a new feature is simply absent from the
 * saved show.
 */
function vjClipInterfaceFields(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/lib/stores/vjClipLauncher.ts'), 'utf8');
  const match = source.match(/export interface VJClip \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('VJClip interface not found');
  const fields: string[] = [];
  let depth = 0;
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (depth === 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const field = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
      if (field) fields.push(field[1]);
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
  }
  return fields;
}

function projectExporterSource(): string {
  const source = readFileSync(join(process.cwd(), 'src/lib/stores/layers.ts'), 'utf8');
  const start = source.indexOf('    exportProject()');
  const end = source.indexOf('    async exportProjectForSave(', start);
  if (start < 0 || end < 0) throw new Error('exportProject not found in layers.ts');
  return source.slice(start, end);
}

describe('Screen mask persistence', () => {
  function screenProject(slice: Record<string, unknown>) {
    return {
      version: '2.0.11',
      project: { id: 'screens', name: 'Screens', width: 1920, height: 1080, layers: [], outputSlices: [slice] },
    };
  }
  const baseSlice = {
    id: 'screen-left', name: 'Left', enabled: true, cropX: 0, cropY: 0, cropW: 0.5, cropH: 1,
    spoutName: 'ghostArcade-Left', edgeBlendLeft: 0, edgeBlendRight: 0.1, edgeBlendTop: 0, edgeBlendBottom: 0,
    edgeBlendGamma: 2.2, brightness: 1, contrast: 1, gamma: 1, rotation: 0,
  };

  it('round-trips per-screen masks through a save and reopen', async () => {
    const { settings } = await import('./settings');
    const masks = [
      { id: 'mask-door', name: 'Doorway', enabled: true, invert: true, feather: 0,
        points: [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.6, y: 1 }, { x: 0.4, y: 1 }] },
      { id: 'mask-arch', name: 'Arch', enabled: false, invert: false, feather: 0.3,
        points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }] },
    ];
    expect(layers.project.importProject(screenProject({ ...baseSlice, masks }))).toBe(true);
    expect(get(settings).output.slices[0].masks).toEqual(masks);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(saved.project.outputSlices[0].masks).toEqual(masks);
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(settings).output.slices[0].masks).toEqual(masks);
  });

  it('opens projects saved before masks existed unchanged, with no masks', async () => {
    const { settings } = await import('./settings');
    expect(layers.project.importProject(screenProject(baseSlice))).toBe(true);
    const slice = get(settings).output.slices[0];
    expect(slice.masks).toEqual([]);
    expect(slice).toMatchObject(baseSlice);
    // A damaged list keeps the usable vertices and never throws.
    expect(layers.project.importProject(screenProject({
      ...baseSlice,
      masks: [{ points: [{ x: 0.2, y: 0.2 }, { x: 'x', y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }], feather: 9 }, 'junk'],
    }))).toBe(true);
    const repaired = get(settings).output.slices[0].masks!;
    expect(repaired).toHaveLength(2);
    expect(repaired[0]).toMatchObject({ enabled: true, invert: false, feather: 1, name: 'Mask 1',
      points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }] });
    expect(repaired[0].id).toBeTruthy();
    expect(repaired[1].points).toEqual([]);
  });
});

describe('VJ clip persistence', () => {
  it('exports every VJClip field that is not runtime scratch', () => {
    const exporter = projectExporterSource();
    // Underscore-prefixed clip fields are native playback bookkeeping, rewritten
    // every frame; saving them would restore a stale playhead.
    const missing = vjClipInterfaceFields()
      .filter((field) => !field.startsWith('_'))
      .filter((field) => !exporter.includes(field));

    expect(
      missing,
      `VJClip fields absent from exportProject — a performer's set would reopen `
      + `without them:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('Layer persistence', () => {
  it('preserves new easing curves through a project save and reopen', async () => {
    const { keyframeTimeline } = await import('./keyframeTimeline');
    const { KEYFRAME_EASINGS } = await import('../keyframes/easing');
    const layer = types.createLayer('easing-layer', 'Animated', 'gpu');
    expect(layers.project.importProject({ version: '2.0.8', project: { id: 'easing', name: 'Easing', width: 1920, height: 1080, layers: [layer] } })).toBe(true);
    const tracks = KEYFRAME_EASINGS.map(({ value }, index) => ({ key: `test:${index}`, label: value, type: 'number' as const,
      keyframes: [{ time: 0, value: 0, easing: value }, { time: 1, value: 1, easing: value }], boolKeyframes: [] }));
    keyframeTimeline.importAll([{ layerId: layer.id, tracks }]);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    keyframeTimeline.importAll([]);
    expect(layers.project.importProject(saved)).toBe(true);
    expect(keyframeTimeline.exportAll().find(item => item.layerId === layer.id)?.tracks).toEqual(tracks);
    keyframeTimeline.importAll([]);
  });

  it('applies complete mapping chains and exports their settings without sharing mutable data', () => {
    const layer = types.createLayer('preset-layer', 'Preset layer', 'gpu');
    expect(layers.project.importProject({ version: '2.0.8', project: { id: 'presets', name: 'Presets', width: 1920, height: 1080, layers: [layer] } })).toBe(true);
    const chain = [{ id: 'saved-blur', type: 'blur' as const, enabled: false, params: { amount: .25 }, opacity: .5 }];
    layers.project.setEffectChain(layer.id, chain);
    layers.project.setEffectChain(null, chain);
    chain[0].params.amount = 9;
    expect(get(layers.project).layers[0].effects[0].params.amount).toBe(.25);
    expect(get(layers.project).mappingComposition?.effects[0].params.amount).toBe(.25);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(layers.project).layers[0].effects[0]).toMatchObject({ enabled: false, opacity: .5, params: { amount: .25 } });
    expect(get(layers.project).mappingComposition?.effects[0].params.amount).toBe(.25);
  });

  it('saves and reopens Bezier mesh tangents, and opens old meshes unchanged', () => {
    const layer = types.createLayer('bezier-mesh', 'Cyclorama', 'gpu');
    const legacy = types.createLayer('legacy-mesh', 'Old mesh', 'gpu');
    legacy.warpMode = 'mesh';
    legacy.meshGrid = types.createMeshGrid(3, 3);
    legacy.meshGrid.points[1][1] = { x: 0.6, y: 0.4 };
    // Exactly what a pre-Bezier project holds: no bezier or tangents keys.
    const legacyJson = JSON.parse(JSON.stringify(legacy));
    expect(layers.project.importProject({ version: '2.0.11', project: { id: 'bezier', name: 'Bezier', width: 1920, height: 1080, layers: [layer, legacyJson] } })).toBe(true);

    layers.project.setWarpMode(layer.id, 'mesh');
    layers.project.setMeshGridSize(layer.id, 4, 4);
    layers.project.setMeshBezier(layer.id, true);
    layers.project.setMeshPointTangents(layer.id, 0, 1, { right: { x: 0.1, y: 0.08 } });
    layers.project.setMeshPointTangents(layer.id, 3, 2, { left: { x: -0.1, y: 0 }, up: { x: 0.02, y: 0.1 } });
    // A point whose handles are all reset drops out of the sparse grid.
    layers.project.setMeshPointTangents(layer.id, 2, 2, { down: { x: 0, y: -0.1 } });
    layers.project.setMeshPointTangents(layer.id, 2, 2, null);

    const live = get(layers.project).layers.find((l) => l.id === layer.id)!.meshGrid!;
    expect(live.bezier).toBe(true);
    expect(live.tangents?.[2][2]).toBeNull();

    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    const reopened = get(layers.project).layers;
    const grid = reopened.find((l) => l.id === layer.id)!.meshGrid!;
    expect(grid.bezier).toBe(true);
    expect(grid.tangents?.[0][1]).toEqual({ right: { x: 0.1, y: 0.08 } });
    expect(grid.tangents?.[3][2]).toEqual({ left: { x: -0.1, y: 0 }, up: { x: 0.02, y: 0.1 } });
    expect(grid.tangents?.[1][1]).toBeNull();

    const old = reopened.find((l) => l.id === legacy.id)!.meshGrid!;
    expect(old).toEqual(legacyJson.meshGrid);
    expect('bezier' in old).toBe(false);
    expect('tangents' in old).toBe(false);

    // Clearing the last tangent removes the field, and Reset Mesh keeps
    // the Bezier toggle but straightens every point.
    layers.project.resetMeshGrid(layer.id);
    const reset = get(layers.project).layers.find((l) => l.id === layer.id)!.meshGrid!;
    expect(reset.bezier).toBe(true);
    expect(reset.tangents).toBeUndefined();
  });

  it('exports every Layer field that is not runtime-only', () => {
    const exporter = exporterSource();
    const missing = layerInterfaceFields()
      .filter((field) => !RUNTIME_ONLY_LAYER_FIELDS.has(field))
      .filter((field) => !exporter.includes(field));

    expect(
      missing,
      `Layer fields absent from _exportLayer — they will reopen at their default.\n`
      + `Add them to the exporter, or to RUNTIME_ONLY_LAYER_FIELDS if they really `
      + `should not persist:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('round-trips the settings a performer actually reaches for', () => {
    const source = { id: 'src-1', type: 'image', src: '/tmp/x.png', name: 'x' };
    const original = {
      ...types.createLayer('layer-1', 'Test', 'gpu'),
      // Per-layer render quality: overrides the global tier for one heavy
      // instrument. An override that silently reverted to "match global" on
      // reload is the kind of thing found mid-set.
      renderQuality: 0.56,
      // A Stage screen saved before 2026-09-11: Y-down corners plus the
      // marker Apply Stage wrote beside them.
      stageTextureFlipV: true,
      corners: {
        topLeft: { x: 0.1, y: 0.2 },
        topRight: { x: 0.9, y: 0.2 },
        bottomLeft: { x: 0.1, y: 0.6 },
        bottomRight: { x: 0.9, y: 0.6 },
      },
      contentFit: 'crop' as const,
      vjLayerIndex: 2,
      source: source as any,
      gpuLayerContent: {
        shaderId: 'flythrough',
        params: {
          // A camera source and its selfie flip.
          source: { type: 'camera', deviceId: 'ABC-123' },
          mirrorX: true,
          topology: 'points',
          particleCount: 40960,
        },
      } as any,
    };

    const exported = layers.project._exportLayer(original as any);
    // Through JSON, because that is what actually happens on the way to disk.
    const restored = layers.project._importLayer(JSON.parse(JSON.stringify(exported)));

    expect(restored.renderQuality).toBe(0.56);
    // Converted on the way in: corners lifted to the canvas Y-up convention
    // and the marker cleared, so re-importing cannot flip them back.
    expect(restored.stageTextureFlipV).toBe(false);
    expect(restored.corners.topLeft).toEqual({ x: 0.1, y: 0.8 });
    expect(restored.corners.topLeft.y).toBeGreaterThan(restored.corners.bottomLeft.y);
    expect(restored.contentFit).toBe('crop');
    expect(restored.vjLayerIndex).toBe(2);
    expect((restored.gpuLayerContent as any)?.shaderId).toBe('flythrough');
    expect((restored.gpuLayerContent as any)?.params?.mirrorX).toBe(true);
    expect((restored.gpuLayerContent as any)?.params?.particleCount).toBe(40960);
    expect((restored.gpuLayerContent as any)?.params?.source).toEqual({
      type: 'camera',
      deviceId: 'ABC-123',
    });
  });
});

/**
 * Per-clip transform survives a save for IMAGE clips, not just video.
 *
 * The transform (zoom / fit / anchor / rotation / opacity / mirrorX) was gated
 * on `type === 'video'` in three separate places — the panel, the store setter,
 * and the clip-to-layer conversion — which is why images appeared to have no
 * size control at all. Those are fixed, but a fourth gate in the save path
 * would produce a subtler version of the same complaint: adjust the image, save,
 * reopen, and it is back to default.
 *
 * exportProject and importClip are both hand-maintained flat whitelists with no
 * type branch today. This drives a real payload through both to prove the round
 * trip is type-agnostic, so that adding such a branch fails here.
 */
describe('image clip transform persistence', () => {
  const TRANSFORM = {
    zoom: 2.4,
    fit: 'contain' as const,
    anchorX: 0.15,
    anchorY: 0.85,
    rotation: 37.5,
    opacity: 0.42,
    mirrorX: true,
  };

  function projectWithClip(type: 'image' | 'video') {
    return {
      version: '2.0.1',
      project: { id: 'p1', name: 'transform round trip', width: 1920, height: 1080, layers: [] },
      vjClipLauncher: {
        numLayers: 1,
        numColumns: 1,
        layerStates: [{
          opacity: 1,
          blendMode: 'normal',
          solo: false,
          mute: false,
          activeColumn: 0,
          activeClip: {
            id: `clip-${type}`,
            type,
            name: `a ${type}`,
            // Not a blob: URL — those are dropped as session-only on save.
            src: `/media/sample.${type === 'image' ? 'png' : 'mp4'}`,
            ...TRANSFORM,
          },
          effects: [],
        }],
      },
    };
  }

  function roundTrip(type: 'image' | 'video'): any {
    expect(layers.project.importProject(projectWithClip(type)), 'import failed').toBe(true);
    // Through JSON, because that is what actually reaches disk.
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    return saved?.vjClipLauncher?.layerStates?.[0]?.activeClip ?? null;
  }

  it('round-trips every transform field on an image clip', () => {
    const clip = roundTrip('image');
    expect(clip, 'image clip did not survive the round trip at all').toBeTruthy();
    expect(clip.type).toBe('image');
    for (const [field, value] of Object.entries(TRANSFORM)) {
      expect(clip[field], `${field} was lost or reset saving an image clip`).toEqual(value);
    }
  });

  it('treats image and video identically', () => {
    // The bug was never that the transform did not persist — it was that
    // images were singled out. Comparing the two is what pins that down.
    const image = roundTrip('image');
    const video = roundTrip('video');
    for (const field of Object.keys(TRANSFORM)) {
      expect(image[field], `${field} differs between image and video`).toEqual(video[field]);
    }
  });
});


describe('quantized VJ columns', () => {
  let launcher: typeof import('./vjClipLauncher').vjClipLauncher;
  let now = 10000;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const image = (id: string) => ({ id, type: 'image', name: id, src: `/show/${id}.png` });
  const activeIds = (deck: 'A' | 'B' = 'A') => (deck === 'A' ? get(launcher).layerStates : get(launcher).bankBLayerStates).map(row => row.activeClip?.id ?? null);
  function tick(time: number) {
    now = time;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
  }
  beforeEach(async () => {
    launcher = (await import('./vjClipLauncher')).vjClipLauncher;
    launcher.reset();
    now = 10000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback); return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const grid = [[image('a0'), image('a1'), null], [image('a2'), image('a3'), null]];
    const bankB = [[image('b0'), image('b1'), null], [image('b2'), image('b3'), null]];
    const row = () => ({ opacity: 1, blendMode: 'normal', effects: [], activeColumn: null, activeClip: null });
    expect(layers.project.importProject({ version: '2.0.8',
      project: { id: 'column-test', name: 'Columns', width: 1920, height: 1080, layers: [] },
      vjClipLauncher: { numLayers: 2, numColumns: 3, activeBlockId: 'main',
        blocks: [{ id: 'main', name: 'Main', clipGrid: grid, bankBClipGrid: bankB },
          { id: 'other', name: 'Other', clipGrid: grid, bankBClipGrid: bankB }],
        layerStates: [row(), row()], bankBLayerStates: [row(), row()] },
    })).toBe(true);
    launcher.setLive(true);
    launcher.setCrossfaderEnabled(true);
    (await import('./audio')).audioStore.setManualBPM(120);
  });
  afterEach(() => {
    launcher.reset();
    tick(now); // Let the old queue driver retire before restoring RAF.
    frames.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('routes composition LFO independently and preserves its range through save/reopen', async () => {
    const { modulationStore, modulationEngine, modKeyCompositionEffect } = await import('../audio/modulation');
    modulationStore.clearAll(); modulationEngine.stop();
    layers.project.setEffectChain(null, [{ id: 'shared-fx', type: 'blur', enabled: true, params: { amount: .5 } }]);
    launcher.setEffectChain('composition', [{ id: 'shared-fx', type: 'blur', enabled: true, params: { amount: .75 } }]);
    const mod = { source: 'lfo-saw' as const, amount: 1, speed: 1, invert: false, bpmSync: false };
    const mappingValue = () => get(layers.project).mappingComposition!.effects[0].params.amount;
    const vjValue = () => get(launcher).compositionEffects[0].params.amount;
    try {
      modulationStore.setCompositionEffectModulation('mapping', 'shared-fx', 'amount', mod, { base: .5, min: 0, max: 1 });
      modulationStore.setCompositionEffectModulation('vj', 'shared-fx', 'amount', { ...mod, amount: .5 }, { base: .75, min: 0, max: 1 });
      tick(10250);
      expect(mappingValue()).toBeCloseTo(.25);
      expect(vjValue()).toBeCloseTo(.625);
      layers.project.setMappingCompositionEnabled(false);
      tick(10500);
      expect(mappingValue()).toBeCloseTo(.25);
      expect(vjValue()).toBeCloseTo(.75);
      const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
      expect(layers.project.importProject(saved)).toBe(true);
      expect(get(modulationStore).get(modKeyCompositionEffect('mapping', 'shared-fx', 'amount'))?.compositionEffect?.base).toBe(.5);
      expect(get(modulationStore).get(modKeyCompositionEffect('vj', 'shared-fx', 'amount'))?.compositionEffect?.base).toBe(.75);
      modulationStore.setCompositionEffectModulation('vj', 'shared-fx', 'amount', { ...mod, source: 'manual' }, { base: .75, min: 0, max: 1 });
      const held = vjValue(); tick(10750);
      expect(vjValue()).toBe(held);
      expect(get(launcher).layerStates[0].effects).toEqual([]);
    } finally { modulationStore.clearAll(); modulationEngine.stop(); }
  });

  it.each(['A', 'B'] as const)('routes clip LFO on deck %s without modulating another clip or bank', async deck => {
    const { modulationStore, modulationEngine, registerEffectParamRange, modKeyClipEffect } = await import('../audio/modulation');
    modulationStore.clearAll(); modulationEngine.stop();
    launcher.triggerClipNow(0, 0, deck);
    launcher.setEffectChain('clip', [{ id: 'local-lfo', type: 'blur', enabled: true, params: { amount: .5 } }], 0, deck);
    const rows = () => deck === 'A' ? get(launcher).layerStates : get(launcher).bankBLayerStates;
    const clip = rows()[0].activeClip!;
    const mod = { source: 'lfo-saw' as const, amount: 1, speed: 1, invert: false, bpmSync: false };
    registerEffectParamRange(0, 'local-lfo', 'amount', 0, 1, clip.id);
    try {
      modulationStore.setClipEffectModulation(clip.id, 'local-lfo', 'amount', mod, deck);
      tick(10250);
      expect(rows()[0].activeClip?.effects?.[0].params.amount).toBeCloseTo(.25);
      expect(rows()[0].effects).toEqual([]);
      launcher.triggerClipNow(0, 1, deck); tick(10500);
      expect(rows()[0].activeClip?.effects ?? []).toEqual([]);
      launcher.setClip(1, 0, (deck === 'A' ? get(launcher).clipGrid : get(launcher).bankBClipGrid)[0][0], deck);
      launcher.triggerClipNow(1, 0, deck); tick(10750);
      expect(rows()[1].activeClip?.effects?.[0].params.amount).toBeCloseTo(.75);
      const other = deck === 'A' ? get(launcher).bankBLayerStates : get(launcher).layerStates;
      expect(other.every(row => !row.activeClip)).toBe(true);
      const key = modKeyClipEffect(clip.id, 'local-lfo', 'amount', deck);
      expect(get(modulationStore).get(key)?.clipEffect).toEqual({ base: .5, min: 0, max: 1 });
      const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
      expect(layers.project.importProject(saved)).toBe(true);
      expect(get(modulationStore).get(key)?.clipEffect).toEqual({ base: .5, min: 0, max: 1 });
      modulationStore.setClipEffectModulation(clip.id, 'local-lfo', 'amount', { ...mod, source: 'manual' }, deck);
      launcher.updateClipEffectParams(1, 0, 'local-lfo', { amount: .8 }, deck);
      modulationStore.setClipEffectModulation(clip.id, 'local-lfo', 'amount', mod, deck);
      tick(11000);
      expect(rows()[1].activeClip?.effects?.[0].params.amount).toBeCloseTo(.3);
    } finally {
      modulationStore.setClipEffectModulation(clip.id, 'local-lfo', 'amount', { ...mod, source: 'manual' }, deck);
      modulationStore.clearAll(); modulationEngine.stop();
    }
  });

  it('drives Mapping composition Auto and holds when the composition is disabled', async () => {
    const engine = await import('../audio/autoEngine');
    engine.stopAutoEngine();
    layers.project.setEffectChain(null, [{ id: 'map-mix', type: 'blur', enabled: true, params: { amount: 0 } }]);
    const config = { phase: 0, mode: 'loop' as const, speedHz: .5, min: 0, max: 1, playing: true };
    layers.project.setMappingCompositionEffectParamAuto('map-mix', 'amount', config);
    const effect = () => get(layers.project).mappingComposition!.effects[0];
    try {
      engine.startAutoEngine(); tick(10000); tick(10100);
      expect(effect().params.amount).toBeCloseTo(.05);
      layers.project.setMappingCompositionEffectParamAuto('map-mix', 'amount', { ...config, timing: 'crossfader' });
      launcher.setCrossfaderValue(.6); tick(10150);
      expect(effect().params.amount).toBe(.6);
      layers.project.setMappingCompositionEnabled(false);
      launcher.setCrossfaderValue(.9); tick(10200);
      expect(effect().params.amount).toBe(.6);
      const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
      expect(layers.project.importProject(saved)).toBe(true);
      expect(effect().paramAuto?.amount.timing).toBe('crossfader');
      layers.project.setMappingCompositionEffectParamAuto('map-mix', 'amount', null);
      expect(effect().paramAuto).toBeUndefined();
    } finally { engine.stopAutoEngine(); }
  });

  it('drives composition effects through Auto ticks and preserves their configuration', async () => {
    const engine = await import('../audio/autoEngine');
    engine.stopAutoEngine();
    launcher.setEffectChain('composition', [{ id: 'mix-blur', type: 'blur', enabled: true, params: { amount: 0 } }]);
    const config = { phase: 0, mode: 'loop' as const, speedHz: .5, min: 0, max: 1, playing: true };
    launcher.setCompositionEffectParamAuto('mix-blur', 'amount', config);
    const effect = () => get(launcher).compositionEffects[0];
    try {
      engine.startAutoEngine();
      tick(10000); tick(10100);
      expect(effect().params.amount).toBeCloseTo(.05);
      launcher.setCompositionEffectParamAuto('mix-blur', 'amount', { ...config, timing: 'crossfader' });
      launcher.setCrossfaderValue(.8);
      tick(10150);
      expect(effect().params.amount).toBe(.8);
      launcher.setCompositionEffectParamAuto('mix-blur', 'amount', { ...config, playing: false });
      tick(10200);
      expect(effect().params.amount).toBe(.8);
      launcher.setCompositionEffectParamAuto('mix-blur', 'amount', { ...config, timing: 'clip' });
      tick(10250);
      expect(effect().params.amount).toBe(.8);
      const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
      expect(layers.project.importProject(saved)).toBe(true);
      expect(effect().paramAuto?.amount.timing).toBe('clip');
      launcher.setCompositionEffectParamAuto('mix-blur', 'amount', null);
      expect(effect().paramAuto).toBeUndefined();
      expect(get(launcher).layerStates[0].effects).toEqual([]);
    } finally { engine.stopAutoEngine(); }
  });

  it.each(['A', 'B'] as const)('stores clip-local Auto on deck %s without changing layer effects', deck => {
    launcher.triggerClipNow(0, 0, deck);
    launcher.setEffectChain('clip', [{ id: 'clip-fx', type: 'blur', enabled: true, params: { amount: 0 } }], 0, deck);
    const auto = { phase: .25, mode: 'loop' as const, speedHz: .2, min: 0, max: 1, playing: true, timing: 'clip' as const };
    launcher.setActiveClipEffectParamAuto(0, 'clip-fx', 'amount', auto, deck);
    const state = get(launcher);
    const rows = deck === 'A' ? state.layerStates : state.bankBLayerStates;
    const block = state.blocks.find(b => b.id === state.activeBlockId)!;
    expect(rows[0].activeClip?.effects?.[0].paramAuto?.amount).toEqual(auto);
    expect((deck === 'A' ? block.clipGrid : block.bankBClipGrid)?.[0][0]?.effects?.[0].paramAuto?.amount).toEqual(auto);
    expect(rows[0].effects).toEqual([]);
    launcher.updateClipEffectParams(0, 0, 'clip-fx', { amount: .75 }, deck);
    launcher.triggerClipNow(0, 1, deck);
    launcher.triggerClipNow(0, 0, deck);
    const active = () => (deck === 'A' ? get(launcher).layerStates : get(launcher).bankBLayerStates)[0].activeClip!;
    expect(active().effects?.[0].params.amount).toBe(.75);
    expect(active().effects?.[0].paramAuto?.amount).toEqual(auto);
    launcher.setActiveClipEffectParamAuto(0, 'clip-fx', 'amount', null, deck);
    expect(active().effects?.[0].paramAuto).toBeUndefined();
  });

  it.each(['A', 'B'] as const)('applies an effect chain atomically and persists the active clip on deck %s', deck => {
    launcher.triggerClipNow(0, 0, deck);
    const chain = [{ id: 'chain-blur', type: 'blur' as const, enabled: true, params: { amount: .25 } }];
    let notifications = 0;
    const stop = launcher.subscribe(() => notifications++);
    notifications = 0;
    launcher.setEffectChain('clip', chain, 0, deck);
    expect(notifications).toBe(1);
    stop();
    chain[0].params.amount = 8;
    const state = get(launcher);
    const grid = deck === 'A' ? state.clipGrid : state.bankBClipGrid;
    const rows = deck === 'A' ? state.layerStates : state.bankBLayerStates;
    const other = deck === 'A' ? state.bankBClipGrid : state.clipGrid;
    const block = state.blocks.find(block => block.id === state.activeBlockId)!;
    expect(rows[0].activeClip?.effects?.[0].params.amount).toBe(.25);
    expect(grid[0][0]?.effects).toEqual(rows[0].activeClip?.effects);
    expect((deck === 'A' ? block.clipGrid : block.bankBClipGrid)?.[0][0]?.effects).toEqual(grid[0][0]?.effects);
    expect(other[0][0]?.effects ?? []).toEqual([]);
    launcher.setEffectChain('layer', chain, 1, deck);
    launcher.setEffectChain('composition', chain);
    expect(get(launcher).compositionEffects).toEqual(chain);
    expect((deck === 'A' ? get(launcher).layerStates : get(launcher).bankBLayerStates)[1].effects).toEqual(chain);
    launcher.setEffectChain('clip', [], 0, deck);
    expect((deck === 'A' ? get(launcher).clipGrid : get(launcher).bankBClipGrid)[0][0]?.effects).toEqual([]);
  });

  it.each(['A', 'B'] as const)('clip column protection overrides the layer and persists on deck %s', deck => {
    launcher.setClipLaunchOptions(0, 0, { ignoreColumnTrigger: true }, deck);
    launcher.triggerColumnNow(0, deck); launcher.triggerColumnNow(2, deck);
    expect(activeIds(deck)[0]).toBe(deck === 'A' ? 'a0' : 'b0');
    launcher.setLayerLaunchProtection(0, { ignoreColumnTrigger: true }, deck);
    launcher.setClipLaunchOptions(0, 0, { ignoreColumnTrigger: false, faderStart: true }, deck);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    const grid = deck === 'A' ? get(launcher).clipGrid : get(launcher).bankBClipGrid;
    expect(grid[0][0]).toMatchObject({ ignoreColumnTrigger: false, faderStart: true });
    launcher.setLive(true); launcher.triggerClipNow(0, 0, deck);
    launcher.triggerColumnNow(1, deck);
    expect(activeIds(deck)[0]).toBe(deck === 'A' ? 'a1' : 'b1');
  });

  it('clip protection cancels queued participation without resurrecting it when switched off', () => {
    launcher.triggerColumnNow(0); launcher.setQuantization('1bar'); launcher.triggerColumn(1);
    const due = get(launcher).pendingTriggers[0].fireAt;
    launcher.setClipLaunchOptions(0, 0, { ignoreColumnTrigger: true });
    launcher.setClipLaunchOptions(0, 0, { ignoreColumnTrigger: null });
    tick(due);
    expect(activeIds()).toEqual(['a0', 'a3']);
  });

  it('clip fader start can disable or enable the layer default', () => {
    installFaderVideo(); launcher.setLayerFaderStart(0, true);
    launcher.setClipLaunchOptions(0, 0, { faderStart: false });
    launcher.setLayerOpacity(0, 1);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackTimeSeconds).toBe(12);
    launcher.setLayerFaderStart(0, false); launcher.setLayerOpacity(0, 0);
    launcher.setClipLaunchOptions(0, 0, { faderStart: true }); launcher.setLayerOpacity(0, 1);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackTimeSeconds).toBe(5);
    expect(get(launcher).layerStates[0].activeClip?.isPlaying).toBe(true);
  });

  it.each(['A', 'B'] as const)('column ignore preserves playing and empty cells on deck %s while manual triggers still work', deck => {
    launcher.triggerColumnNow(0, deck);
    launcher.setLayerLaunchProtection(0, { ignoreColumnTrigger: true }, deck);
    launcher.triggerColumnNow(1, deck);
    expect(activeIds(deck)).toEqual(deck === 'A' ? ['a0', 'a3'] : ['b0', 'b3']);
    launcher.triggerColumnNow(2, deck);
    expect(activeIds(deck)).toEqual(deck === 'A' ? ['a0', null] : ['b0', null]);
    launcher.triggerClipNow(0, 1, deck);
    expect(activeIds(deck)[0]).toBe(deck === 'A' ? 'a1' : 'b1');
  });

  it('does not enroll an ignored row when it is enabled after a column was queued', () => {
    launcher.triggerColumnNow(0);
    launcher.setLayerLaunchProtection(0, { ignoreColumnTrigger: true });
    launcher.setQuantization('1bar');
    launcher.triggerColumn(1);
    const deadline = get(launcher).pendingTriggers[0].fireAt;
    launcher.setLayerLaunchProtection(0, { ignoreColumnTrigger: false });
    tick(deadline + 1);
    expect(activeIds()).toEqual(['a0', 'a3']);
  });

  it('removes a newly protected row from a queue without canceling other rows or reviving it on unlock', () => {
    launcher.triggerColumnNow(0);
    launcher.setQuantization('1bar');
    launcher.triggerColumn(1);
    const deadline = get(launcher).pendingTriggers[0].fireAt;
    launcher.setLayerLaunchProtection(0, { locked: true });
    launcher.setLayerLaunchProtection(0, { locked: false });
    launcher.clearClip(0, 1);
    expect(get(launcher).pendingTriggers).toHaveLength(1);
    tick(deadline + 1);
    expect(activeIds()).toEqual(['a0', 'a3']);
  });

  it('keeps Piano release ownership and individually queued clips on an ignored row', () => {
    launcher.setClipTriggerStyle(0, 0, 'piano');
    launcher.triggerClip(0, 0, 'A', 'key');
    launcher.setLayerLaunchProtection(0, { ignoreColumnTrigger: true });
    launcher.triggerColumnNow(1);
    launcher.releaseClip(0, 0, 'A', 'key');
    expect(activeIds()).toEqual([null, 'a3']);
    launcher.setQuantization('1bar');
    launcher.triggerClip(0, 1);
    launcher.triggerColumn(0);
    expect(get(launcher).pendingTriggers).toHaveLength(2);
    tick(Math.max(...get(launcher).pendingTriggers.map(p => p.fireAt)) + 1);
    expect(activeIds()).toEqual(['a1', 'a2']);
  });

  it('locks manual, forced, transient and column launches plus individual Stop and active-cell deletion', () => {
    launcher.triggerClipNow(0, 0);
    launcher.setLayerLaunchProtection(0, { locked: true });
    const playing = get(launcher).layerStates[0].activeClip;
    launcher.triggerClip(0, 1);
    launcher.triggerClipNow(0, 1);
    launcher.launchTransientClip(0, image('transient') as any);
    launcher.triggerColumnNow(1);
    launcher.stopLayer(0);
    launcher.clearClip(0, 0);
    launcher.setClip(0, 0, image('replacement') as any);
    launcher.removeLayer(0);
    expect(get(launcher).numLayers).toBe(2);
    expect(get(launcher).layerStates[0].activeClip).toBe(playing);
    expect(get(launcher).clipGrid[0][0]?.id).toBe('a0');
    expect(activeIds()[1]).toBe('a3');
    launcher.stopAll();
    expect(activeIds()).toEqual([null, null]);
    expect(get(launcher).stoppedAll).toBe(true);
  });

  it('locking cancels a pending clip and sustains a held Piano clip after its release', () => {
    launcher.setClipTriggerStyle(0, 0, 'piano');
    launcher.triggerClip(0, 0, 'A', 'key');
    launcher.setQuantization('1bar');
    launcher.triggerClip(0, 1);
    launcher.setLayerLaunchProtection(0, { locked: true });
    expect(get(launcher).pendingTriggers).toHaveLength(0);
    launcher.releaseClip(0, 0, 'A', 'key');
    expect(activeIds()[0]).toBe('a0');
    launcher.setLayerOpacity(0, 0.25);
    expect(get(launcher).layerStates[0].opacity).toBe(0.25);
    launcher.setLayerLaunchProtection(0, { locked: false });
    launcher.stopLayer(0);
    expect(activeIds()[0]).toBeNull();
  });

  it('retains Fader Start transport control on a locked layer', () => {
    installFaderVideo();
    launcher.setLayerFaderStart(0, true);
    launcher.setLayerLaunchProtection(0, { locked: true });
    launcher.setLayerOpacity(0, 0.5);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackSeekSeq).toBe(8);
  });

  it('does not queue a column when every row is protected and preserves Stop All', () => {
    launcher.stopAll();
    launcher.setLayerLaunchProtection(0, { locked: true });
    launcher.setLayerLaunchProtection(1, { ignoreColumnTrigger: true });
    launcher.triggerColumnNow(0);
    expect(get(launcher).stoppedAll).toBe(true);
    launcher.setQuantization('1bar');
    launcher.triggerColumn(0);
    expect(get(launcher).pendingTriggers).toHaveLength(0);
  });

  it('round-trips independent layer protection on both decks with legacy defaults off', () => {
    expect(get(launcher).layerStates[0]).toMatchObject({ locked: false, ignoreColumnTrigger: false });
    launcher.setLayerLaunchProtection(0, { locked: true }, 'A');
    launcher.setLayerLaunchProtection(1, { ignoreColumnTrigger: true }, 'B');
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    launcher.reset();
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(launcher).layerStates[0]).toMatchObject({ locked: true, ignoreColumnTrigger: false });
    expect(get(launcher).bankBLayerStates[1]).toMatchObject({ locked: false, ignoreColumnTrigger: true });
  });

  function enableAutopilot(deck: 'A' | 'B' = 'A') {
    launcher.setOpen(true, { fromWorkspace: true });
    launcher.setLayerAutopilot(0, { target: 'next', unit: 'beats', count: 1 }, deck);
    launcher.triggerClipNow(0, 0, deck);
  }

  it.each(['A', 'B'] as const)('Autopilot advances deck %s after a beat and keeps advancing without per-clip configuration', deck => {
    enableAutopilot(deck);
    tick(10499);
    expect(activeIds(deck)[0]).toBe(deck === 'A' ? 'a0' : 'b0');
    tick(10500);
    expect(activeIds(deck)[0]).toBe(deck === 'A' ? 'a1' : 'b1');
    tick(11000);
    expect(activeIds(deck)[0]).toBe(deck === 'A' ? 'a0' : 'b0');
  });

  it.each(['A', 'B'] as const)('quick Autopilot toggle retains rules and cancels advancement on deck %s', deck => {
    enableAutopilot(deck);
    launcher.toggleLayerAutopilot(0, deck);
    tick(11000);
    expect(activeIds(deck)[0]).toBe(deck === 'A' ? 'a0' : 'b0');
    const rows = () => deck === 'A' ? get(launcher).layerStates : get(launcher).bankBLayerStates;
    expect(rows()[0].autopilot).toEqual({ target: 'next', unit: 'beats', count: 1 });
    expect(rows()[0].autopilotPaused).toBe(true);
    launcher.toggleLayerAutopilot(0, deck);
    tick(11500);
    expect(activeIds(deck)[0]).toBe(deck === 'A' ? 'a1' : 'b1');
  });

  it('reverse launch starts at trim-out and Autopilot waits a complete loop', () => {
    installFaderVideo();
    launcher.updateActiveClipVideoProps(0, { playbackRate: -1 });
    launcher.setOpen(true, { fromWorkspace: true });
    launcher.setLayerAutopilot(0, { target:'next', unit:'loops', count:1 });
    launcher.triggerClipNow(0, 0);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackTimeSeconds).toBe(15);
    tick(10001);
    expect(activeIds()[0]).toBe('fader-A');
    tick(19999);
    expect(activeIds()[0]).toBe('fader-A');
    tick(20000);
    expect(activeIds()[0]).toBe('a1');
  });

  it.each([1, -1])('bounce Autopilot waits for the complete round trip at rate %s', rate => {
    installFaderVideo();
    launcher.updateActiveClipVideoProps(0, { playbackRate: rate, playbackMode: 'bounce' });
    launcher.setOpen(true, { fromWorkspace: true });
    launcher.setLayerAutopilot(0, { target: 'next', unit: 'loops', count: 1 });
    launcher.triggerClipNow(0, 0);
    tick(20000);
    expect(activeIds()[0]).toBe('fader-A');
    tick(29999);
    expect(activeIds()[0]).toBe('fader-A');
    tick(30000);
    expect(activeIds()[0]).toBe('a1');
  });

  it('persists Bounce and its launch speed in the saved project', () => {
    installFaderVideo();
    launcher.updateActiveClipVideoProps(0, { playbackMode: 'bounce', playbackRate: -.5 });
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    launcher.reset();
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(launcher).clipGrid[0][0]).toMatchObject({ playbackMode:'bounce', playbackRate:-.5 });
  });

  it('pause/resume from a controller keeps the returning bounce leg', () => {
    installFaderVideo();
    launcher.updateActiveClipVideoProps(0, {playbackMode:'bounce', playbackRate:1});
    launcher.triggerClipNow(0, 0);
    tick(22000); // 10 seconds out, two seconds back: position 13.
    launcher.updateActiveClipVideoProps(0, {isPlaying:false});
    expect(get(launcher).layerStates[0].activeClip).toMatchObject({_nativePlaybackTimeSeconds:13, _nativePlaybackDirection:-1});
    tick(26000);
    launcher.updateActiveClipVideoProps(0, {isPlaying:true});
    expect(get(launcher).layerStates[0].activeClip).toMatchObject({_nativePlaybackTimeSeconds:13, _nativePlaybackDirection:-1});
  });

  it('video-loop Autopilot follows trim length, speed changes and pause/resume', () => {
    installFaderVideo();
    launcher.setOpen(true, { fromWorkspace: true });
    launcher.setLayerAutopilot(0, { target: 'next', unit: 'loops', count: 1 });
    launcher.triggerClipNow(0, 0);
    tick(12000); // 2 of the trimmed 10 seconds.
    launcher.updateActiveClipVideoProps(0, { playbackRate: 2 });
    tick(12500); // 3 seconds total.
    launcher.updateActiveClipVideoProps(0, { isPlaying: false });
    tick(17500);
    expect(activeIds()[0]).toBe('fader-A');
    launcher.updateActiveClipVideoProps(0, { isPlaying: true });
    tick(20999);
    expect(activeIds()[0]).toBe('fader-A');
    tick(21000);
    expect(activeIds()[0]).toBe('a1');
  });

  it('a manual seek cancels an automatic launch waiting for its beat', () => {
    installFaderVideo();
    launcher.setOpen(true, { fromWorkspace: true });
    launcher.setLayerAutopilot(0, { target: 'next', unit: 'beats', count: 1 });
    launcher.triggerClipNow(0, 0);
    launcher.setQuantization('1bar');
    tick(10500);
    expect(get(launcher).pendingTriggers).toHaveLength(1);
    launcher.updateActiveClipVideoProps(0, { _nativePlaybackSeekSeq: 99, _nativePlaybackTimeSeconds: 7, _nativePlaybackUpdatedAtMs: now });
    expect(get(launcher).pendingTriggers).toHaveLength(0);
  });

  it('a manual retrigger restarts the Autopilot count even for an image clip', () => {
    enableAutopilot();
    tick(10400);
    launcher.triggerClipNow(0, 0);
    tick(10500);
    expect(activeIds()[0]).toBe('a0');
    tick(10900);
    expect(activeIds()[0]).toBe('a1');
  });

  it('Autopilot uses beat snapping and disabling it cancels its queued follow action', () => {
    enableAutopilot();
    launcher.setQuantization('1bar');
    tick(10500);
    expect(activeIds()[0]).toBe('a0');
    expect(get(launcher).pendingTriggers).toHaveLength(1);
    const deadline = get(launcher).pendingTriggers[0].fireAt;
    launcher.setLayerAutopilot(0, undefined);
    expect(get(launcher).pendingTriggers).toHaveLength(0);
    tick(deadline + 1);
    expect(activeIds()[0]).toBe('a0');
  });

  it('automatic follow restarts a Toggle target instead of switching it off', () => {
    enableAutopilot();
    launcher.setClipTriggerStyle(0, 0, 'toggle');
    launcher.setLayerAutopilot(0, { target: 'first', unit: 'beats', count: 1 });
    const generation = get(launcher).layerStates[0].activeClip?._launchGeneration;
    tick(10500);
    expect(activeIds()[0]).toBe('a0');
    expect(get(launcher).layerStates[0].activeClip?._launchGeneration).not.toBe(generation);
  });

  it('Autopilot respects manual queues, held Piano controls and layer locks', () => {
    enableAutopilot();
    launcher.setLayerLaunchProtection(0, { locked: true });
    tick(12000);
    expect(activeIds()[0]).toBe('a0');
    launcher.setLayerLaunchProtection(0, { locked: false });
    launcher.setClipTriggerStyle(0, 0, 'piano');
    launcher.triggerClip(0, 0, 'A', 'held');
    tick(14000);
    expect(activeIds()[0]).toBe('a0');
    launcher.releaseClip(0, 0, 'A', 'held');
    expect(activeIds()[0]).toBeNull();
    launcher.triggerClipNow(0, 0);
    launcher.setQuantization('4bar');
    launcher.triggerClip(0, 1);
    const manual = get(launcher).pendingTriggers[0];
    tick(15000);
    expect(get(launcher).pendingTriggers[0]?.id).toBe(manual.id);
    expect(activeIds()[0]).toBe('a0');
  });

  it('mirrored output and simulator windows never run Autopilot', () => {
    vi.stubGlobal('location', { search: '?mode=projection-sim' });
    enableAutopilot();
    tick(20000);
    expect(activeIds()[0]).toBe('a0');
    expect(get(launcher).pendingTriggers).toHaveLength(0);
  });

  it('Stop All and leaving VJ prevent delayed automatic launches', () => {
    enableAutopilot();
    launcher.stopAll();
    tick(20000);
    expect(activeIds()[0]).toBeNull();
    launcher.triggerClipNow(0, 0);
    launcher.setOpen(false, { fromWorkspace: true });
    expect(get(launcher).isLive).toBe(false);
    tick(30000);
    expect(activeIds()[0]).toBe('a0');
  });

  it('does not advance old-block content into a newly browsed block', () => {
    enableAutopilot();
    launcher.update(state => ({ ...state, blocks: state.blocks.map(block => block.id === 'other'
      ? { ...block, clipGrid: [[image('other0'), image('other1'), null], [null, null, null]] as any } : block) }));
    launcher.setActiveBlock('other');
    tick(11000);
    expect(activeIds()[0]).toBe('a0');
  });

  it('persists Autopilot settings on both decks without restoring runtime generations', () => {
    enableAutopilot();
    launcher.setLayerAutopilot(0, { target: 'random-bag', unit: 'beats', count: 8 }, 'B');
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    launcher.reset();
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(launcher).layerStates[0].autopilot).toEqual({ target: 'next', unit: 'beats', count: 1 });
    expect(get(launcher).bankBLayerStates[0].autopilot).toEqual({ target: 'random-bag', unit: 'beats', count: 8 });
    expect(get(launcher).layerStates[0].activeClip?._launchGeneration).toBeUndefined();
  });

  async function installCueVideo(deck: 'A' | 'B' = 'A') {
    const api = await import('../api/native-renderer');
    const submit = vi.spyOn(api, 'submitNativeRendererCommands').mockResolvedValue({} as any);
    installFaderVideo(deck);
    return submit;
  }

  it('aligns synced LFOs to the shared clock while free-running LFOs keep their phase', async () => {
    const { modulationEngine } = await import('../audio/modulation');
    const { audioStore } = await import('./audio');
    const { resyncLaunchClock } = await import('./launchClock');
    const sample = (sync: boolean) => (modulationEngine as any).getSignal('lfo-saw', get(audioStore), 0.7, 1, sync);
    resyncLaunchClock(); now += 125;
    expect(sample(true)).toBeCloseTo(0.25);
    expect(sample(false)).toBeCloseTo(0.7);
    resyncLaunchClock();
    expect(sample(true)).toBe(0);
    expect(sample(false)).toBeCloseTo(0.7);
  });

  it('keeps queued launches on their target beat after tempo changes', async () => {
    const clock = await import('./launchClock');
    clock.resyncLaunchClock();
    launcher.setQuantization('1bar'); launcher.triggerColumn(1);
    expect(get(launcher).pendingTriggers[0].fireAt).toBe(12000);
    tick(10500);
    (await import('./audio')).audioStore.setManualBPM(60);
    tick(11000);
    expect(get(launcher).pendingTriggers[0].fireAt).toBe(13500);
    tick(12000); expect(activeIds()).toEqual([null, null]);
    tick(13500); expect(activeIds()).toEqual(['a1', 'a3']);
  });

  it('applies fine tempo changes without moving the current playhead', async () => {
    installFaderVideo();
    launcher.updateActiveClipVideoProps(0, { playbackSyncBeats: 4 });
    await Promise.resolve(); await Promise.resolve();
    now += 250;
    const { nativeVideoTransportSnapshot } = await import('../media/nativeTransport');
    const before = nativeVideoTransportSnapshot(get(launcher).layerStates[0].activeClip!);
    (await import('./audio')).audioStore.setManualBPM(120.01);
    await Promise.resolve(); await Promise.resolve();
    const clip = get(launcher).layerStates[0].activeClip!;
    expect(clip.playbackRate).toBeCloseTo(5.000416666667, 9);
    expect(nativeVideoTransportSnapshot(clip).timeSeconds).toBeCloseTo(before.timeSeconds, 9);
  });

  it('retains reverse direction when beat fitting responds to tempo changes', async () => {
    installFaderVideo();
    launcher.updateActiveClipVideoProps(0, {playbackRate:-1, playbackSyncBeats:4});
    await Promise.resolve(); await Promise.resolve();
    expect(get(launcher).layerStates[0].activeClip?.playbackRate).toBe(-5);
    (await import('./audio')).audioStore.setManualBPM(60);
    await Promise.resolve(); await Promise.resolve();
    expect(get(launcher).layerStates[0].activeClip?.playbackRate).toBe(-2.5);
    launcher.updateActiveClipVideoProps(0, {playbackMode:'bounce'});
    await Promise.resolve(); await Promise.resolve();
    expect(get(launcher).layerStates[0].activeClip?.playbackRate).toBe(-5);
  });

  it('resync restarts only beat-synced video at trim-in and preserves pause on both decks', async () => {
    const submit = await installCueVideo(); installFaderVideo('B');
    launcher.setOpen(true, { fromWorkspace: true });
    launcher.updateActiveClipVideoProps(0, { playbackSyncBeats: 4 }, 'A');
    launcher.updateActiveClipVideoProps(0, { playbackSyncBeats: 8 }, 'B');
    launcher.setQuantization('1bar'); launcher.triggerColumn(1);
    now += 250;
    (await import('./launchClock')).resyncLaunchClock();
    for (const row of [get(launcher).layerStates[0], get(launcher).bankBLayerStates[0]]) {
      expect(row.activeClip?._nativePlaybackTimeSeconds).toBe(5);
      expect(row.activeClip?.isPlaying).toBe(false);
    }
    expect(submit).toHaveBeenCalled();
    expect(get(launcher).pendingTriggers[0].fireAt).toBe(now + 2000);
  });

  it.each(['A', 'B'] as const)('sets, jumps and clears eight independent cue slots on deck %s', async deck => {
    const submit = await installCueVideo(deck);
    expect(launcher.pressCuePoint(0, 0, deck)).toBe('set');
    const row = () => (deck === 'A' ? get(launcher).layerStates : get(launcher).bankBLayerStates)[0];
    expect(row().activeClip?.cuePoints?.[0]).toBe(12);
    launcher.setActiveClipCuePoint(0, 7, 8.25, deck);
    launcher.setQuantization('4bar');
    expect(launcher.pressCuePoint(0, 7, deck)).toBe('jumped');
    expect(submit.mock.calls.at(-1)?.[0][0]).toMatchObject({ source_id: `fader-${deck}`, time_seconds: 8.25, paused: true });
    expect(row().activeClip).toMatchObject({ isPlaying: false, _nativePlaybackTimeSeconds: 8.25 });
    expect(get(launcher).pendingTriggers).toHaveLength(0);
    launcher.setActiveClipCuePoint(0, 7, null, deck);
    expect(row().activeClip?.cuePoints?.[7]).toBeNull();
    expect(launcher.jumpToCuePoint(0, 7, deck)).toBe(false);
  });

  it('clamps cue jumps to trim boundaries without changing stored cue positions', async () => {
    const submit = await installCueVideo();
    launcher.setActiveClipCuePoint(0, 0, 1);
    launcher.setActiveClipCuePoint(0, 1, 19);
    launcher.jumpToCuePoint(0, 0);
    expect(submit.mock.calls.at(-1)?.[0][0]).toMatchObject({ time_seconds: 5 });
    launcher.jumpToCuePoint(0, 1);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackTimeSeconds).toBeCloseTo(15 - 0.00001, 7);
    expect(get(launcher).layerStates[0].activeClip?.cuePoints?.slice(0, 2)).toEqual([1, 19]);
  });

  it('cue jumps preserve playing state and remain available on a locked layer', async () => {
    const submit = await installCueVideo();
    launcher.updateActiveClipVideoProps(0, { isPlaying: true });
    launcher.setLayerLaunchProtection(0, { locked: true });
    launcher.setActiveClipCuePoint(0, 0, 6);
    expect(launcher.jumpToCuePoint(0, 0)).toBe(true);
    expect(submit.mock.calls.at(-1)?.[0][0]).toMatchObject({ paused: false, time_seconds: 6 });
  });

  it('saves cues to the playing clip in its original block and retains seek generations on return', async () => {
    await installCueVideo();
    launcher.setActiveBlock('other');
    launcher.setActiveClipCuePoint(0, 0, 9);
    launcher.jumpToCuePoint(0, 0);
    const generation = get(launcher).layerStates[0].activeClip?._nativePlaybackSeekSeq;
    expect(get(launcher).clipGrid[0][0]?.cuePoints).toBeUndefined();
    launcher.setActiveBlock('main');
    expect(get(launcher).clipGrid[0][0]?.cuePoints?.[0]).toBe(9);
    expect(get(launcher).clipGrid[0][0]?._nativePlaybackSeekSeq).toBe(generation);
  });

  it('cue seeks revoke an automatic follow action waiting for its beat', async () => {
    await installCueVideo();
    launcher.setOpen(true, { fromWorkspace: true });
    launcher.setLayerAutopilot(0, { target: 'next', unit: 'beats', count: 1 });
    launcher.triggerClipNow(0, 0);
    launcher.setActiveClipCuePoint(0, 0, 7);
    launcher.setQuantization('1bar');
    tick(10500);
    expect(get(launcher).pendingTriggers).toHaveLength(1);
    launcher.jumpToCuePoint(0, 0);
    expect(get(launcher).pendingTriggers).toHaveLength(0);
  });

  it('rejects invalid cue indices/times and non-video targets without native commands', async () => {
    const submit = await installCueVideo();
    for (const index of [-1, 8, 0.5, NaN]) {
      expect(launcher.setActiveClipCuePoint(0, index, 6)).toBe(false);
      expect(launcher.pressCuePoint(0, index)).toBeNull();
    }
    expect(launcher.setActiveClipCuePoint(0, 0, Infinity)).toBe(false);
    expect(launcher.setActiveClipCuePoint(0, 0, -1)).toBe(false);
    launcher.triggerClipNow(0, 1);
    expect(launcher.pressCuePoint(0, 0)).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it('persists cue positions on both decks and sanitizes malformed slots on import', async () => {
    await installCueVideo();
    await installCueVideo('B');
    launcher.setActiveClipCuePoint(0, 0, 6, 'A');
    launcher.setActiveClipCuePoint(0, 7, 9, 'B');
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    launcher.reset();
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(launcher).clipGrid[0][0]?.cuePoints?.[0]).toBe(6);
    expect(get(launcher).bankBClipGrid[0][0]?.cuePoints?.[7]).toBe(9);
    const { normalizeCuePoints } = await import('./vjCuePoints');
    expect(normalizeCuePoints([0, -1, '2', Infinity, NaN, null, 6, 7, 8])).toEqual([0, null, null, null, null, null, 6, 7]);
    expect(normalizeCuePoints([null])).toBeUndefined();
  });

  function installFaderVideo(deck: 'A' | 'B' = 'A') {
    const video = { id: `fader-${deck}`, name: 'Fader video', type: 'video' as const, src: '/show/fader.mp4',
      durationSeconds: 20, trimStart: 0.25, trimEnd: 0.75, isPlaying: false, _nativePlaybackSeekSeq: 7,
      _nativePlaybackTimeSeconds: 12, _nativePlaybackUpdatedAtMs: now };
    launcher.update(state => {
      const gridKey = deck === 'A' ? 'clipGrid' : 'bankBClipGrid';
      const statesKey = deck === 'A' ? 'layerStates' : 'bankBLayerStates';
      const grid = state[gridKey].map(row => [...row]);
      grid[0][0] = video;
      const rows = [...state[statesKey]];
      rows[0] = { ...rows[0], opacity: 0, activeColumn: 0, activeClip: video };
      return { ...state, [gridKey]: grid, [statesKey]: rows,
        blocks: state.blocks.map(block => block.id === state.activeBlockId ? { ...block, [gridKey]: grid } : block) };
    });
    return video;
  }

  it.each(['A', 'B'] as const)('Fader Start restarts deck %s at trim-in once per zero crossing', deck => {
    installFaderVideo(deck);
    launcher.setLayerFaderStart(0, true, deck);
    const row = () => (deck === 'A' ? get(launcher).layerStates : get(launcher).bankBLayerStates)[0];
    launcher.setLayerOpacity(0, 0.1, deck);
    expect(row().activeClip).toMatchObject({ isPlaying: true, _nativePlaybackTimeSeconds: 5, _nativePlaybackSeekSeq: 8 });
    launcher.setLayerOpacity(0, 0.9, deck);
    launcher.setLayerOpacity(0, 0.9, deck);
    expect(row().activeClip?._nativePlaybackSeekSeq).toBe(8);
    launcher.setLayerOpacity(0, 0, deck);
    expect(row().activeClip?.id).toBe(`fader-${deck}`);
    launcher.setLayerOpacity(0, 1 / 127, deck);
    expect(row().activeClip?._nativePlaybackSeekSeq).toBe(9);
    const other = deck === 'A' ? get(launcher).bankBLayerStates : get(launcher).layerStates;
    expect(other[0].activeClip).toBeNull();
  });

  it('publishes the visible fader and restarted playhead in one update, ahead of browser work', () => {
    installFaderVideo();
    launcher.setLayerFaderStart(0, true);
    const observed: Array<[number, number | undefined]> = [];
    const unsubscribe = launcher.subscribe(state => observed.push([state.layerStates[0].opacity, state.layerStates[0].activeClip?._nativePlaybackSeekSeq]));
    observed.length = 0;
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    launcher.setLayerOpacity(0, 0.5);
    expect(observed).toEqual([[0.5, 8]]);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ghost:native-vj-layers-sync',
      detail: expect.objectContaining({ urgent: true, videoSourceIds: ['fader-A'] }) }));
    unsubscribe();
  });

  it('Fader Start bypasses quantization without canceling another queued clip', () => {
    installFaderVideo();
    launcher.setLayerFaderStart(0, true);
    launcher.setQuantization('1bar');
    launcher.triggerClip(0, 1);
    const queued = get(launcher).pendingTriggers;
    launcher.setLayerOpacity(0, 0.5);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackSeekSeq).toBe(8);
    expect(get(launcher).pendingTriggers).toEqual(queued);
  });

  it('restarts the actual playing clip after switching blocks, not the new cell at that column', () => {
    installFaderVideo();
    launcher.setLayerFaderStart(0, true);
    launcher.setActiveBlock('other');
    launcher.setLayerOpacity(0, 0.5);
    expect(get(launcher).layerStates[0].activeClip).toMatchObject({ id: 'fader-A', _nativePlaybackSeekSeq: 8 });
    expect(get(launcher).clipGrid[0][0]?.id).toBe('a0');
    launcher.setActiveBlock('main');
    expect(get(launcher).clipGrid[0][0]?._nativePlaybackSeekSeq).toBe(8);
    launcher.triggerClipNow(0, 0);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackSeekSeq).toBe(9);
  });

  it('preserves Piano release ownership across a fader restart', () => {
    installFaderVideo();
    launcher.setClipTriggerStyle(0, 0, 'piano');
    launcher.setLayerFaderStart(0, true);
    launcher.triggerClip(0, 0, 'A', 'key');
    launcher.setLayerOpacity(0, 0.5);
    launcher.releaseClip(0, 0, 'A', 'key');
    expect(get(launcher).layerStates[0].activeClip).toBeNull();
  });

  it('does not retrigger when disabled, enabled above zero, or stopped', () => {
    installFaderVideo();
    launcher.setLayerOpacity(0, 0.5);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackSeekSeq).toBe(7);
    launcher.setLayerFaderStart(0, true);
    launcher.setLayerOpacity(0, 0.8);
    expect(get(launcher).layerStates[0].activeClip?._nativePlaybackSeekSeq).toBe(7);
    launcher.stopAll();
    launcher.setLayerOpacity(0, 0);
    launcher.setLayerOpacity(0, 1);
    expect(get(launcher).layerStates[0].activeClip).toBeNull();
    expect(get(launcher).stoppedAll).toBe(true);
  });

  it('ignores invalid fader values and row indices', () => {
    installFaderVideo();
    const before = get(launcher);
    launcher.setLayerOpacity(0, NaN);
    launcher.setLayerOpacity(-1, 0.5);
    launcher.setLayerOpacity(999, 0.5);
    launcher.setLayerFaderStart(999, true);
    expect(get(launcher)).toBe(before);
  });

  it('persists Fader Start independently on both decks and defaults legacy layers off', () => {
    expect(get(launcher).layerStates[0].faderStart).toBe(false);
    launcher.setLayerFaderStart(0, true, 'A');
    launcher.setLayerFaderStart(1, true, 'B');
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    launcher.reset();
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(launcher).layerStates.map(row => row.faderStart)).toEqual([true, false]);
    expect(get(launcher).bankBLayerStates.map(row => row.faderStart)).toEqual([false, true]);
  });

  it('toggles an active clip off immediately even with quantization enabled', () => {
    launcher.setClipTriggerStyle(0, 0, 'toggle');
    launcher.triggerClip(0, 0);
    expect(activeIds()[0]).toBe('a0');
    launcher.setQuantization('1bar');
    launcher.triggerClip(0, 0);
    expect(activeIds()[0]).toBeNull();
    expect(get(launcher).pendingTriggers).toHaveLength(0);
  });

  it('keeps Piano playing until the last input releases', () => {
    launcher.setClipTriggerStyle(0, 0, 'piano');
    launcher.triggerClip(0, 0, 'A', 'mouse');
    const first = get(launcher).layerStates[0].activeClip;
    launcher.triggerClip(0, 0, 'A', 'midi');
    expect(get(launcher).layerStates[0].activeClip).toBe(first);
    launcher.releaseClip(0, 0, 'A', 'mouse');
    expect(activeIds()[0]).toBe('a0');
    launcher.releaseClip(0, 0, 'A', 'midi');
    expect(activeIds()[0]).toBeNull();
  });

  it('cancels a Piano launch released before its beat', () => {
    launcher.setClipTriggerStyle(0, 0, 'piano');
    launcher.setQuantization('1bar');
    launcher.triggerClip(0, 0, 'A', 'key');
    const deadline = get(launcher).pendingTriggers[0].fireAt;
    launcher.releaseClip(0, 0, 'A', 'key');
    tick(deadline + 1);
    expect(activeIds()[0]).toBeNull();
    expect(get(launcher).pendingTriggers).toHaveLength(0);
  });

  it('releases a Piano clip after a quantized launch fires', () => {
    launcher.setClipTriggerStyle(0, 0, 'piano');
    launcher.setQuantization('1bar');
    launcher.triggerClip(0, 0, 'A', 'key');
    tick(get(launcher).pendingTriggers[0].fireAt + 1);
    expect(activeIds()[0]).toBe('a0');
    launcher.releaseClip(0, 0, 'A', 'key');
    expect(activeIds()[0]).toBeNull();
  });

  it.each(['column', 'replacement', 'forced'] as const)('ignores stale Piano release after %s launch', action => {
    launcher.setClipTriggerStyle(0, 0, 'piano');
    launcher.triggerClip(0, 0, 'A', 'key');
    if (action === 'column') launcher.triggerColumnNow(0);
    else if (action === 'forced') launcher.triggerClipNow(0, 0);
    else launcher.triggerClip(0, 1);
    launcher.releaseClip(0, 0, 'A', 'key');
    expect(activeIds()[0]).toBe(action === 'replacement' ? 'a1' : 'a0');
  });

  it('persists trigger modes in the project', () => {
    launcher.setClipTriggerStyle(0, 0, 'piano');
    const saved = layers.project.exportProject();
    launcher.reset();
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(launcher).clipGrid[0][0]?.triggerStyle).toBe('piano');
  });

  it('defaults to immediate column launches with no queue', () => {
    expect(get(launcher).quantization).toBe('off');
    launcher.triggerColumn(0);
    expect(activeIds()).toEqual(['a0', 'a2']);
    expect(get(launcher).pendingTriggers).toEqual([]);
  });

  it.each(['1/4', '1/2', '1bar', '2bar', '4bar'] as const)('launches every row in one transaction at %s', grid => {
    launcher.setQuantization(grid);
    const observed: (string | null)[][] = [];
    const unsubscribe = launcher.subscribe(() => observed.push(activeIds()));
    launcher.triggerColumn(1);
    const [queued] = get(launcher).pendingTriggers;
    expect(queued).toMatchObject({ kind: 'column', bank: 'A', columnIndex: 1, clipIds: ['a1', 'a3'] });
    expect(queued.fireAt).toBeGreaterThan(now);
    tick(queued.fireAt - 0.01);
    expect(activeIds()).toEqual([null, null]);
    tick(queued.fireAt);
    expect(activeIds()).toEqual(['a1', 'a3']);
    expect(get(launcher).pendingTriggers).toEqual([]);
    expect(observed.every(ids => ids.every(id => id === null) || ids.join() === 'a1,a3')).toBe(true);
    unsubscribe();
  });

  it.each([7.5, 8, 8.5])('uses continuous Link beats at session beat %s', async beat => {
    const { abletonLink } = await import('../sync/abletonLink');
    const state = { ...get(abletonLink), enabled: true, peers: 1, tempo: 120 };
    vi.spyOn(abletonLink, 'subscribe').mockImplementation(run => { run(state); return () => {}; });
    vi.spyOn(abletonLink, 'beatNow').mockReturnValue(beat);
    vi.spyOn(abletonLink, 'phaseNow').mockReturnValue(beat % 4);
    launcher.setQuantization('2bar'); launcher.triggerColumn(1);
    expect(get(launcher).pendingTriggers[0].fireAt - now).toBe((Math.ceil((beat + 0.001) / 8) * 8 - beat) * 500);
  });

  it('cancels a repeated column and replaces older columns only on that deck', () => {
    launcher.setQuantization('1bar');
    launcher.triggerColumn(0, 'A'); launcher.triggerColumn(0, 'B');
    launcher.triggerColumn(1, 'A');
    expect(get(launcher).pendingTriggers.map(p => `${p.bank}:${p.columnIndex}`).sort()).toEqual(['A:1', 'B:0']);
    launcher.triggerColumn(1, 'A');
    const [remaining] = get(launcher).pendingTriggers;
    expect(remaining.bank).toBe('B');
    tick(remaining.fireAt);
    expect(activeIds()).toEqual([null, null]);
    expect(activeIds('B')).toEqual(['b0', 'b2']);
  });

  it('resolves cell/column conflicts without firing competing clips on the same row', () => {
    launcher.setQuantization('1bar');
    launcher.triggerClip(0, 0); launcher.triggerClip(1, 0);
    launcher.triggerColumn(1);
    expect(get(launcher).pendingTriggers).toHaveLength(1);
    launcher.triggerClip(0, 0);
    expect(get(launcher).pendingTriggers).toHaveLength(1);
    expect(get(launcher).pendingTriggers[0]).toMatchObject({ kind: 'clip', layerIndex: 0 });
    launcher.triggerClip(0, 1);
    expect(get(launcher).pendingTriggers).toHaveLength(1);
    tick(get(launcher).pendingTriggers[0].fireAt);
    expect(activeIds()).toEqual(['a1', null]);
  });

  it.each(['stop', 'layer-stop', 'off', 'exit', 'block', 'replace', 'remove-row', 'remove-column'] as const)('cancels safely on %s', action => {
    launcher.setQuantization('1bar'); launcher.triggerColumn(1);
    const due = get(launcher).pendingTriggers[0].fireAt;
    if (action === 'stop') launcher.stopAll();
    if (action === 'layer-stop') launcher.stopLayer(0);
    if (action === 'off') launcher.setQuantization('off');
    if (action === 'exit') launcher.setLive(false);
    if (action === 'block') { launcher.setActiveBlock('other'); launcher.setActiveBlock('main'); }
    if (action === 'replace') launcher.setClip(0, 1, image('replacement') as any);
    if (action === 'remove-row') launcher.removeLayer(0);
    if (action === 'remove-column') launcher.removeColumn(1);
    expect(get(launcher).pendingTriggers).toEqual([]);
    tick(due + 1);
    expect(activeIds().every(id => id === null)).toBe(true);
  });

  it('keeps the running column until an empty queued column reaches its boundary', () => {
    launcher.triggerColumn(0);
    launcher.setQuantization('1bar'); launcher.triggerColumn(2);
    const due = get(launcher).pendingTriggers[0].fireAt;
    tick(due - 1); expect(activeIds()).toEqual(['a0', 'a2']);
    tick(due); expect(activeIds()).toEqual([null, null]);
  });

  it('starts clip transitions only when the column fires, not when it is queued', async () => {
    const { vjClipTransitions } = await import('./vjClipTransitions');
    launcher.triggerColumn(0);
    launcher.setLayerTransition(0, { duration: 1 });
    launcher.setLayerTransition(1, { duration: 1 });
    launcher.setQuantization('1bar'); launcher.triggerColumn(1);
    expect(get(vjClipTransitions).size).toBe(0);
    tick(get(launcher).pendingTriggers[0].fireAt);
    expect([...get(vjClipTransitions).values()].map(t => t.incomingClipId)).toEqual(['a1', 'a3']);
  });

  it('saves the launch grid but never restores pending columns', () => {
    launcher.setQuantization('1bar'); launcher.triggerColumn(1);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(saved.vjClipLauncher.quantization).toBe('1bar');
    expect(saved.vjClipLauncher.pendingTriggers).toBeUndefined();
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(launcher).quantization).toBe('1bar');
    expect(get(launcher).pendingTriggers).toEqual([]);
  });

  it('ignores invalid column addresses and direct launches supersede a queue', () => {
    launcher.setQuantization('1bar');
    for (const column of [-1, 3, NaN, 0.5]) launcher.triggerColumn(column);
    expect(get(launcher).pendingTriggers).toEqual([]);
    launcher.triggerColumn(1); const due = get(launcher).pendingTriggers[0].fireAt;
    launcher.triggerColumnNow(0);
    tick(due + 1);
    expect(activeIds()).toEqual(['a0', 'a2']);
  });

  it('admits whole prepared columns and falls back if any participating row is unsupported', async () => {
    const { buildNativeQueuedCutPlan, resolveNativeQueuedCutBindings, vjOutputLayers } = await import('./vjClipLauncher');
    const { nativeRendererRuntime } = await import('./nativeRenderer');
    const { keyframeTimeline } = await import('./keyframeTimeline');
    const previousRuntime = get(nativeRendererRuntime);
    keyframeTimeline.reset();
    nativeRendererRuntime.update(value => ({ ...value, running: true }));
    try {
      launcher.setCrossfaderEnabled(false);
      launcher.setOpen(true);
      const base = get(launcher);
      const video = (id: string) => ({ ...image(id), type: 'video', src: `/tmp/${id}.mp4`,
        durationSeconds: 4, videoWidth: 128, videoHeight: 96 }) as any;
      const state = { ...base, isOpen: true, isLive: true, stoppedAll: false,
        clipGrid: [[video('old0'), video('new0'), null], [video('old1'), video('new1'), null]],
        layerStates: base.layerStates.map((row, index) => ({ ...row, activeClip: video(`old${index}`), activeColumn: 0 })) };
      const trigger = { id: 'column-test', kind: 'column', bank: 'A', columnIndex: 1,
        layerIndex: 0, layerIndices: [0, 1], blockId: state.activeBlockId, fireAt: now + 1000 } as any;
      const plan = buildNativeQueuedCutPlan(trigger, state);
      expect(plan?.rows.map(row => row.layerIndex)).toEqual([0, 1]);
      expect(plan?.lane).toBe('vj-column:A');
      const {vjClipTransitions}=await import('./vjClipTransitions');
      const fadeState={...state,layerStates:state.layerStates.map((row,index)=>index===0?{...row,transitionDuration:1}:row)};
      const fadeTrigger={...trigger,kind:'clip',layerIndices:undefined};
      expect(buildNativeQueuedCutPlan(trigger,fadeState)?.rows.map(row=>row.transition.duration)).toEqual([1,0]);
      const allFades={...fadeState,layerStates:fadeState.layerStates.map((row,index)=>({...row,transitionDuration:index+1,transitionStyle:index===0?'wipe' as const:'dissolve' as const}))};
      expect(buildNativeQueuedCutPlan(trigger,allFades)?.rows.map(row=>row.transition))
        .toEqual([{duration:1,style:'wipe'},{duration:2,style:'dissolve'}]);

      const fadePlan=buildNativeQueuedCutPlan(fadeTrigger,fadeState)!;
      expect(fadePlan.rows[0].transition.duration).toBe(1);
      launcher.set(fadeState);
      const prepared={...fadeState.clipGrid[0][1]!,isPlaying:false,_nativePlaybackSeekSeq:1};
      const fade=vjClipTransitions.begin('A',0,fadeState.layerStates[0].activeClip,prepared,1,'dissolve',undefined,trigger.id)!;
      expect(get(launcher).layerStates[0].activeClip?.id).toBe('old0');
      expect(get(vjOutputLayers)?.find(row=>row.id==='vj-layer-0')?.source).toMatchObject({id:'new0',isPlaying:false,_nativeLaunchPreparation:true});
      expect(buildNativeQueuedCutPlan(fadeTrigger,get(launcher))?.signature).toBe(fadePlan.signature);
      vjClipTransitions.cancel('A',0,fade.token);
      expect(get(vjOutputLayers)?.find(row=>row.id==='vj-layer-0')?.source?.id).toBe('old0');
      launcher.set(allFades);
      const columnPlan=buildNativeQueuedCutPlan(trigger,allFades)!;
      const preparedRows=columnPlan.rows.map(row=>vjClipTransitions.begin('A',row.layerIndex,row.outgoing,
        {...row.incoming,isPlaying:false},row.transition.duration,row.transition.style,undefined,trigger.id)!);
      expect(get(launcher).layerStates.map(row=>row.activeClip?.id)).toEqual(['old0','old1']);
      expect(get(vjOutputLayers)?.map(row=>row.source?.id)).toEqual(['new0','new1']);
      expect(buildNativeQueuedCutPlan(trigger,get(launcher))?.signature).toBe(columnPlan.signature);
      for(const entry of preparedRows) vjClipTransitions.cancel('A',entry.layerIndex,entry.token);
      expect(get(vjOutputLayers)?.map(row=>row.source?.id)).toEqual(['old0','old1']);
      launcher.set(state);

      const wrapped=state.layerStates.flatMap((row,index)=>[
        {layer_id:`vj-layer-${index}`,source_id:`plugin:vj-layer-${index}:vj-crossfade`},
        {layer_id:`__vj-clip:vj-layer-${index}:steady:in`,source_id:row.activeClip.id},
      ]);
      wrapped.push({layer_id:'__vj-mix__',source_id:'plugin:__vj-mix__:vj-mix'});
      const mixedPlan=buildNativeQueuedCutPlan(trigger,fadeState)!;
      mixedPlan.rows[0].fadeToken=42;
      const mixedLayers=wrapped.filter(row=>row.layer_id!=='__vj-clip:vj-layer-0:steady:in').concat([
        {layer_id:'__vj-clip:vj-layer-0:42:out',source_id:'old0'},
        {layer_id:'__vj-clip:vj-layer-0:42:in',source_id:'new0'},
      ]);
      expect([...resolveNativeQueuedCutBindings(mixedPlan,mixedLayers)!]).toEqual([
        [0,'__vj-clip:vj-layer-0:42:out'],[1,'__vj-clip:vj-layer-1:steady:in'],
      ]);
      expect(resolveNativeQueuedCutBindings(mixedPlan,mixedLayers.map(row=>row.layer_id.endsWith(':42:in')?{...row,source_id:'wrong'}:row))).toBeNull();

      expect([...resolveNativeQueuedCutBindings(plan!,wrapped)!]).toEqual([
        [0,'__vj-clip:vj-layer-0:steady:in'],[1,'__vj-clip:vj-layer-1:steady:in'],
      ]);
      expect(resolveNativeQueuedCutBindings(plan!,wrapped.filter(row=>row.layer_id!=='__vj-clip:vj-layer-1:steady:in'))).toBeNull();
      expect(resolveNativeQueuedCutBindings(plan!,wrapped.map(row=>row.layer_id==='vj-layer-0'?{...row,source_id:'foreign-graph'}:row))).toBeNull();
      expect(resolveNativeQueuedCutBindings(plan!,[...wrapped,{layer_id:'__vj-clip:vj-layer-0:42:out',source_id:'old0'}])).toBeNull();
      expect([...resolveNativeQueuedCutBindings(plan!,state.layerStates.map((row,index)=>({layer_id:`vj-layer-${index}`,source_id:row.activeClip.id})))!])
        .toEqual([[0,'vj-layer-0'],[1,'vj-layer-1']]);

      const dual = { ...state, crossfaderEnabled: true,
        bankBClipGrid: [[video('b-old0'), video('b-new0'), null], [video('b-old1'), video('b-new1'), null]],
        bankBLayerStates: state.layerStates.map((row,index)=>({...row,activeClip:video(`b-old${index}`)})) };
      const bTrigger = { ...trigger, bank: 'B' } as any;
      expect(buildNativeQueuedCutPlan(bTrigger,dual)?.rows.map(row=>[row.layerId,row.incoming.id]))
        .toEqual([['vj-layer-0-B','b-new0'],['vj-layer-1-B','b-new1']]);
      expect(buildNativeQueuedCutPlan(trigger,dual)?.rows.map(row=>row.layerId)).toEqual(['vj-layer-0-A','vj-layer-1-A']);
      expect(buildNativeQueuedCutPlan(bTrigger,dual)?.lane).toBe('vj-column:B');
      const dualWrapped=['A','B'].flatMap(bank=>[0,1].flatMap(index=>[
        {layer_id:`vj-layer-${index}-${bank}`,source_id:`plugin:vj-layer-${index}-${bank}:vj-crossfade`},
        {layer_id:`__vj-clip:vj-layer-${index}-${bank}:steady:in`,source_id:bank==='B'?`b-old${index}`:`old${index}`},
      ]));
      dualWrapped.push({layer_id:'vj-xfade-0',source_id:'plugin:vj-xfade-0:vj-crossfade'});
      expect([...resolveNativeQueuedCutBindings(buildNativeQueuedCutPlan(bTrigger,dual)!,dualWrapped)!])
        .toEqual([[0,'__vj-clip:vj-layer-0-B:steady:in'],[1,'__vj-clip:vj-layer-1-B:steady:in']]);

      expect(buildNativeQueuedCutPlan(bTrigger,{...dual,crossfaderValue:0.75})?.signature).toBe(buildNativeQueuedCutPlan(bTrigger,dual)?.signature);
      expect(buildNativeQueuedCutPlan(bTrigger,{...dual,crossfaderEnabled:false})).toBeNull();
      expect(buildNativeQueuedCutPlan(bTrigger,{...dual,layerStates:dual.layerStates.map(row=>({...row,solo:true}))})).not.toBeNull();
      expect(buildNativeQueuedCutPlan(bTrigger,{...dual,bankBLayerStates:dual.bankBLayerStates.map(row=>({...row,solo:true}))})).toBeNull();
      expect(buildNativeQueuedCutPlan(trigger,{...dual,bankBLayerStates:[{...dual.bankBLayerStates[0],activeClip:state.layerStates[0].activeClip},dual.bankBLayerStates[1]]})).toBeNull();
      expect(buildNativeQueuedCutPlan(trigger,dual)?.signature).not.toBe(plan?.signature);

      for (const replacement of [null, { ...video('new1'), type: 'image' },
        { ...video('new1'), videoWidth: 256 }, { ...video('new1'), audioPlayback: true }]) {
        expect(buildNativeQueuedCutPlan(trigger, { ...state,
          clipGrid: [state.clipGrid[0], [state.clipGrid[1][0], replacement, null]] })).toBeNull();
      }
      for (const protection of [{ locked: true }, { ignoreColumnTrigger: true }]) {
        const protectedState = { ...state, layerStates: [state.layerStates[0], { ...state.layerStates[1], ...protection }] };
        expect(buildNativeQueuedCutPlan(trigger, protectedState)?.rows.map(row => row.layerIndex)).toEqual([0]);
      }
    } finally {
      nativeRendererRuntime.set(previousRuntime);
    }
  });

});

describe('macro parameter assignments', () => {
  it('drives multiple scoped effects, transfers ownership, and preserves routes through project save', async () => {
    const { macros } = await import('./macros');
    const { vjClipLauncher } = await import('./vjClipLauncher');
    const originalProject = get(layers.project);
    const originalLauncher = get(vjClipLauncher);
    const originalMacros = get(macros);
    try {
      macros.reset();
      const layer = types.createLayer('Macro target', 'color');
      const fx = { id: 'macro-brightness', type: 'blur' as const, enabled: true, params: { blurRadius: 1 } };
      layer.effects = [fx];
      layers.project.set({ ...originalProject, layers: [layer] });
      vjClipLauncher.set({ ...originalLauncher, compositionEffects: [{ ...fx, id: 'comp-fx' }] });
      const target = { scope: 'mapping-layer' as const, layerId: layer.id, effectId: fx.id, param: 'blurRadius' };
      macros.assignParameter('macro-1', { target, label: 'Mapping brightness', min: 0, max: 2, from: 0, to: 2 });
      macros.assignParameter('macro-1', { target: { scope: 'vj-composition', effectId: 'comp-fx', param: 'blurRadius' }, label: 'VJ brightness', min: 0, max: 2, from: 2, to: 0 });
      macros.setMacroValue('macro-1', 0.25);
      expect(get(layers.project).layers[0].effects[0].params.blurRadius).toBe(0.5);
      expect(get(vjClipLauncher).compositionEffects[0].params.blurRadius).toBe(1.5);
      macros.assignParameter('macro-2', { target, label: 'Transferred', min: 0, max: 2, from: 1, to: 2 });
      expect(get(macros).macros[0].assignments).toHaveLength(1);
      macros.setMacroValue('macro-1', 1);
      expect(get(layers.project).layers[0].effects[0].params.blurRadius).toBe(1);
      const saved = layers.project.exportProject();
      macros.reset();
      expect(layers.project.importProject(JSON.parse(JSON.stringify(saved)))).toBe(true);
      expect(get(macros).macros[1].assignments?.[0].target).toEqual(target);
      macros.setMacroValue('macro-2', 0.5);
      expect(get(layers.project).layers[0].effects[0].params.blurRadius).toBe(1.5);
      macros.unassignParameter(target);
      macros.setMacroValue('macro-2', 0);
      expect(get(layers.project).layers[0].effects[0].params.blurRadius).toBe(1.5);
    } finally {
      layers.project.set(originalProject);
      vjClipLauncher.set(originalLauncher);
      macros.set(originalMacros);
    }
  });
});

describe('macro clip identity routing', () => {
  it('updates inactive blocks on the addressed deck without touching matching IDs on the other deck', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    const { macros } = await import('./macros');
    const original = get(vjClipLauncher);
    const originalMacros = get(macros);
    const clip = { id: 'macro-clip', type: 'image', name: 'Target', src: '/test.png', effects: [{ id: 'clip-fx', type: 'blur', enabled: true, params: { blurRadius: 1 } }] } as any;
    try {
      macros.reset();
      vjClipLauncher.set({ ...original, clipGrid: [[clip]], bankBClipGrid: [[null]],
        blocks: [{ id: 'hidden', name: 'Hidden', clipGrid: [[clip]], bankBClipGrid: [[clip]] }],
        layerStates: original.layerStates.map((row, i) => i ? row : { ...row, activeClip: clip }),
        bankBLayerStates: original.bankBLayerStates.map(row => ({ ...row, activeClip: null })),
      });
      macros.assignParameter('macro-1', { target: { scope: 'vj-clip', bank: 'B', clipId: clip.id, effectId: 'clip-fx', param: 'blurRadius' }, label: 'B clip', min: 0, max: 2, from: 0, to: 2 });
      macros.setMacroValue('macro-1', 0.25);
      const state = get(vjClipLauncher);
      expect(state.blocks[0].bankBClipGrid?.[0][0]?.effects?.[0].params.blurRadius).toBe(0.5);
      expect(state.blocks[0].clipGrid[0][0]?.effects?.[0].params.blurRadius).toBe(1);
      expect(state.layerStates[0].activeClip?.effects?.[0].params.blurRadius).toBe(1);
      expect(state.bankBClipGrid[0][0]).toBeNull();
      const { findMacroTargetEffect } = await import('./macroAssignments');
      const target = get(macros).macros[0].assignments![0].target;
      expect(findMacroTargetEffect(target, get(layers.project), state)?.params.blurRadius).toBe(0.5);
      const removed = { ...state, blocks: [] };
      expect(findMacroTargetEffect(target, get(layers.project), removed)).toBeUndefined();
      expect(get(macros).macros[0].assignments).toHaveLength(1);

    } finally { vjClipLauncher.set(original); macros.set(originalMacros); }
  });
});

it('persists VJ groups and preserves children when ungrouping', async () => {
  const { vjClipLauncher } = await import('./vjClipLauncher');
  const original = get(vjClipLauncher);
  const originalProject = get(layers.project);
  try {
    vjClipLauncher.set({ ...original, groups: [], numLayers: Math.max(2, original.numLayers) });
    vjClipLauncher.addGroup(0, 1);
    const id = get(vjClipLauncher).groups![0].id;
    vjClipLauncher.updateGroup(id, { name: 'Foreground', opacity: 0.4, blendMode: 'screen' });
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(vjClipLauncher).groups?.[0]).toMatchObject({ id, name: 'Foreground', first: 0, last: 1, opacity: 0.4, blendMode: 'screen' });
    const grid = get(vjClipLauncher).clipGrid;
    vjClipLauncher.removeGroup(id);
    expect(get(vjClipLauncher).groups).toEqual([]);
    expect(get(vjClipLauncher).clipGrid).toBe(grid);
  } finally { vjClipLauncher.set(original); layers.project.set(originalProject); }
});

it('edits group effects independently and round-trips their order, bypass and parameters', async () => {
  const { vjClipLauncher } = await import('./vjClipLauncher');
  const original = get(vjClipLauncher);
  const originalProject = get(layers.project);
  try {
    vjClipLauncher.set({ ...original, groups: [] });
    vjClipLauncher.addGroup(0, 0);
    const id = get(vjClipLauncher).groups![0].id;
    expect(vjClipLauncher.addGroupEffects(id, ['blur', 'invert'])).toBeNull();
    const [blur, invert] = get(vjClipLauncher).groups![0].effects;
    expect(blur.id).not.toBe(invert.id);
    vjClipLauncher.updateGroupEffect(id, blur.id, { params: { blurRadius: 12 }, opacity: 0.3, enabled: false });
    vjClipLauncher.moveGroupEffect(id, invert.id, -1);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    const effects = get(vjClipLauncher).groups![0].effects;
    expect(effects.map(effect => effect.id)).toEqual([invert.id, blur.id]);
    expect(effects[1]).toMatchObject({ params: { blurRadius: 12 }, opacity: 0.3, enabled: false });
    expect(get(vjClipLauncher).compositionEffects).toEqual(original.compositionEffects);
    const before = get(vjClipLauncher).groups![0].effects;
    expect(vjClipLauncher.addGroupEffects(id, Array(16).fill('invert'))).toContain('16');
    expect(get(vjClipLauncher).groups![0].effects).toBe(before);
    vjClipLauncher.removeGroupEffect(id, invert.id);
    expect(get(vjClipLauncher).groups![0].effects.map(effect => effect.id)).toEqual([blur.id]);
    expect(vjClipLauncher.addGroupEffects('missing-group', ['blur'])).toContain('no longer');
  } finally { vjClipLauncher.set(original); layers.project.set(originalProject); }
});

it('launches only group members and keeps disjoint quantized group queues independent', async () => {
  const { vjClipLauncher } = await import('./vjClipLauncher');
  const original = get(vjClipLauncher);
  try {
    const rows = Array.from({ length: 4 }, (_, i) => ({ ...original.layerStates[0], activeClip: null, activeColumn: null, locked: i === 1, ignoreColumnTrigger: false }));
    const grid = rows.map((_, i) => [{ id: `group-launch-${i}`, name: `Clip ${i}`, type: 'image', src: `/group-${i}.png` } as any]);
    vjClipLauncher.set({ ...original, numLayers: 4, numColumns: 1, layerStates: rows, clipGrid: grid, quantization: 'off', pendingTriggers: [], groups: [
      { id: 'g1', name: 'One', first: 0, last: 1, opacity: 1, blendMode: 'normal', effects: [] },
      { id: 'g2', name: 'Two', first: 2, last: 3, opacity: 1, blendMode: 'normal', effects: [] },
    ] });
    vjClipLauncher.triggerColumn(0, 'A', 'g1');
    expect(get(vjClipLauncher).layerStates.map(row => row.activeClip?.id ?? null)).toEqual(['group-launch-0', null, null, null]);
    vjClipLauncher.set({ ...get(vjClipLauncher), quantization: '4bar', pendingTriggers: [] });
    vjClipLauncher.triggerColumn(0, 'A', 'g1');
    vjClipLauncher.triggerColumn(0, 'A', 'g2');
    expect(get(vjClipLauncher).pendingTriggers.map(trigger => trigger.layerIndices)).toEqual([[0], [2, 3]]);
    vjClipLauncher.triggerColumn(0, 'A', 'g1');
    expect(get(vjClipLauncher).pendingTriggers.map(trigger => trigger.groupId)).toEqual(['g2']);
    vjClipLauncher.removeGroup('g2');
    expect(get(vjClipLauncher).pendingTriggers).toEqual([]);
    vjClipLauncher.triggerColumn(0, 'A', 'missing');
    expect(get(vjClipLauncher).pendingTriggers).toEqual([]);
  } finally { vjClipLauncher.set(original); }
});

it('persists a mapped slice group source and switches cleanly back to a layer feed', () => {
  const original = get(layers.project);
  try {
    const screen = types.createLayer('group-screen', 'Stage slice', 'screen');
    layers.project.set({ ...original, layers: [screen] });
    layers.project.setLayerVJGroup(screen.id, 'group-source');
    expect(layers.project.importProject(JSON.parse(JSON.stringify(layers.project.exportProject())))).toBe(true);
    expect(get(layers.project).layers[0]).toMatchObject({ type: 'screen', vjGroupId: 'group-source' });
    layers.project.setLayerVJIndex(screen.id, -1);
    expect(get(layers.project).layers[0].vjGroupId).toBeUndefined();
    expect(get(layers.project).layers[0].vjLayerIndex).toBe(-1);
  } finally { layers.project.set(original); }
});

it('routes MIDI group levels and FX by identity without creating outputs', async () => {
  const { midiRouter } = await import('../midi/midiRouter');
  const { vjClipLauncher } = await import('./vjClipLauncher');
  const original = get(vjClipLauncher);
  try {
    vjClipLauncher.set({ ...original, groups: [{ id: 'midi-group', name: 'Stage', first: 0, last: 0, opacity: 1, blendMode: 'normal', effects: [{ id: 'group-fx', type: 'blur', enabled: true, params: { blurRadius: 1 } }] }] });
    midiRouter.dispatchPath('vj:group:midi-group:level', 0.4);
    midiRouter.dispatchPath('vj-b:group:midi-group:fx:group-fx:param:blurRadius', 12);
    midiRouter.dispatchPath('vj:group:midi-group:fx:group-fx:mix', 0.25);
    expect(get(vjClipLauncher).groups![0]).toMatchObject({ opacity: 0.4, effects: [{ opacity: 0.25, params: { blurRadius: 12 } }] });
    midiRouter.dispatchPath('vj:group:midi-group:fx:group-fx:param:unknown', 9);
    expect((get(vjClipLauncher).groups![0].effects[0].params as any).unknown).toBeUndefined();
    midiRouter.dispatchPath('vj:group:deleted:level', 0);
    expect(get(vjClipLauncher).groups).toHaveLength(1);
  } finally { vjClipLauncher.set(original); }
});
