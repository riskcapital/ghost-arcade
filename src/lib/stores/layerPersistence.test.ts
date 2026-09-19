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
});
