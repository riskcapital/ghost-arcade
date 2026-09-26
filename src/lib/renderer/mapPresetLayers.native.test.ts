// VJ MAP presets over the shared map, checked at the native command payload:
// the upsert_layer commands NativeRendererSync sends the core for the MAP
// output. See renderer/mapPresetLayers.ts and stores/mapSurfaces.ts.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Composition, Layer, MapSurface, Project } from '../types';

let createLayer: typeof import('../types').createLayer;
let buildMapPresetLayers: typeof import('./mapPresetLayers').buildMapPresetLayers;
let mapPresetRows: typeof import('./mapPresetLayers').mapPresetRows;
let migrateMapSurfaces: typeof import('../stores/mapSurfaces').migrateMapSurfaces;
let NativeRendererSyncCtor: typeof import('../sync/nativeRendererSync').NativeRendererSync;
let api: typeof import('../api/native-renderer');

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { style: { setProperty: () => {} } } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 0 });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
  // Preview thumbnails are a browser concern; this node run never loads one.
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class { crossOrigin = ''; onload: unknown = null; onerror: unknown = null; src = ''; naturalWidth = 0; naturalHeight = 0; },
  });
  ({ createLayer } = await import('../types'));
  ({ buildMapPresetLayers, mapPresetRows } = await import('./mapPresetLayers'));
  ({ migrateMapSurfaces } = await import('../stores/mapSurfaces'));
  ({ NativeRendererSync: NativeRendererSyncCtor } = await import('../sync/nativeRendererSync'));
  api = await import('../api/native-renderer');
});

const corners = (x0: number, y0: number, x1: number, y1: number) => ({
  topLeft: { x: x0, y: y1 },
  topRight: { x: x1, y: y1 },
  bottomLeft: { x: x0, y: y0 },
  bottomRight: { x: x1, y: y0 },
});

function surfaceLayer(id: string, box: [number, number, number, number], source: Partial<NonNullable<Layer['source']>> = {}): Layer {
  const layer = createLayer(id, `Surface ${id}`, 'media');
  layer.corners = corners(...box);
  layer.source = { id: `src-${id}`, type: 'image', src: `/media/${id}.png`, name: id, ...source } as NonNullable<Layer['source']>;
  return layer;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function preset(id: string, layers: Layer[]): Composition {
  return { id, name: id, createdAt: 0, layers: clone(layers) };
}

function launcher(rows: Array<string | null>, extra: Record<string, unknown> = {}) {
  const row = (presetId: string | null) => ({
    opacity: 1, blendMode: 'normal', solo: false, mute: false, effects: [], activeColumn: 0,
    activeClip: presetId ? { id: `clip-${presetId}`, type: 'preset', presetId, name: presetId, src: '' } : null,
  });
  return {
    layerStates: rows.map(row), bankBLayerStates: rows.map(() => row(null)),
    crossfaderEnabled: false, masterOpacity: 1, ...extra,
  } as any;
}

const sequencer = { isPlaying: false, opacityOverrides: {}, bankBOpacityOverrides: {} } as any;

/** The MAP preset stack exactly as Canvas builds it for the native path. */
function mapOutput(state: any, compositions: Composition[], liveLayers: Layer[], surfaces: MapSurface[] | undefined, cache = new Map()) {
  return buildMapPresetLayers(mapPresetRows(state, compositions, sequencer, null), { liveLayers, surfaces, cache });
}

/** Run one real scene flush and return the upsert_layer payloads by layer id. */
async function flushPayload(sync: any, layers: Layer[]) {
  const submit = vi.mocked(api.submitNativeRendererCommands);
  const batch = vi.mocked(api.submitNativeRendererBatch);
  submit.mockClear();
  batch.mockClear();
  await sync.flushOnce(64, 36, layers);
  const commands = [
    ...submit.mock.calls.flatMap((call) => call[0] as any[]),
    ...batch.mock.calls.flatMap((call) => (call[0] as any).commands as any[]),
  ];
  const upserts = new Map<string, any>();
  for (const command of commands) if (command.type === 'upsert_layer') upserts.set(command.layer_id, command);
  return { commands, upserts };
}

function readySync() {
  vi.spyOn(api, 'submitNativeRendererCommands').mockResolvedValue({ applied: 1, dropped: 0, errors: [] } as any);
  vi.spyOn(api, 'submitNativeRendererBatch').mockResolvedValue({ applied: 1, dropped: 0, errors: [] } as any);
  // No core snapshot: the geometry reconciler stays out of the diff.
  vi.spyOn(api, 'getNativeRendererLayersSnapshot').mockResolvedValue(null as any);
  vi.spyOn(api, 'prefetchNativeRendererMedia').mockResolvedValue(undefined as any);
  const sync = new NativeRendererSyncCtor() as any;
  sync.running = true;
  sync.startupReady = true;
  // A core with the native video pump, as every shipping core has.
  sync.nativeFeatureFlags = Object.fromEntries([
    'native_media_decode', 'media_prefetch', 'native_video_decode_pump', 'native_video_decode_pump_window',
    'native_video_frame_decode', 'native_video_frame_prefetch', 'native_media_source_playback_state',
  ].map((feature) => [feature, true]));
  return sync;
}

/** Geometry-bearing fields of an upsert, without the id and stack position. */
const geometryPayload = (command: any) => {
  const { layer_id: _id, z_index: _z, ...rest } = command;
  return rest;
};

describe('VJ MAP presets on the shared map', () => {
  it('moves two presets that share a surface with one corner edit, the live one included', async () => {
    const shared = surfaceLayer('stage-left', [0.1, 0.1, 0.4, 0.6]);
    const other = surfaceLayer('stage-right', [0.6, 0.1, 0.9, 0.6]);
    const a = preset('A', [shared, other]);
    const b = preset('B', [{ ...shared, source: { ...shared.source!, id: 'src-b', src: '/media/b.png' } }]);
    const project = migrateMapSurfaces({ layers: [shared, other], vjMode: { compositions: [a, b] } } as unknown as Project);
    const comps = project.vjMode!.compositions;
    const state = launcher(['A', 'B']);
    const sync = readySync();
    try {
      const cache = new Map();
      const before = await flushPayload(sync, mapOutput(state, comps, project.layers, project.mapSurfaces, cache));
      expect(before.upserts.get('mapvj-0::stage-left').corners).toEqual(shared.corners);
      expect(before.upserts.get('mapvj-1::stage-left').corners).toEqual(shared.corners);

      // One edit, in the editor, while both presets are playing.
      const moved = corners(0.05, 0.2, 0.45, 0.7);
      const edited = project.layers.map((layer) => (layer.id === 'stage-left' ? { ...layer, corners: moved } : layer));
      const after = await flushPayload(sync, mapOutput(state, comps, edited, project.mapSurfaces, cache));
      expect(after.upserts.get('mapvj-0::stage-left').corners).toEqual(moved);
      expect(after.upserts.get('mapvj-1::stage-left').corners).toEqual(moved);
      // The other surface did not change, so nothing was resent for it.
      expect(after.upserts.has('mapvj-0::stage-right')).toBe(false);
      expect(after.commands.some((command) => command.type === 'remove_layer')).toBe(false);

      // Same when the surface is not in the editor: the stored shared map
      // is the definition.
      const stored = project.mapSurfaces!.map((surface) => surface.id === 'stage-left'
        ? { ...surface, geometry: { ...surface.geometry, corners: corners(0.2, 0.2, 0.3, 0.3) } } : surface);
      const fromStore = mapOutput(state, comps, [], stored, cache);
      expect(fromStore.find((l) => l.id === 'mapvj-0::stage-left')!.corners).toEqual(corners(0.2, 0.2, 0.3, 0.3));
      expect(fromStore.find((l) => l.id === 'mapvj-1::stage-left')!.corners).toEqual(corners(0.2, 0.2, 0.3, 0.3));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps a detached preset surface where it is', () => {
    const shared = surfaceLayer('s', [0.1, 0.1, 0.4, 0.6]);
    const own = { ...clone(shared), corners: corners(0.5, 0.5, 0.9, 0.9), surfaceId: 's', surfaceDetached: true };
    const surfaces: MapSurface[] = [{ id: 's', name: 's', geometry: { ...clone(shared), meshGrid: null, mask: null, cropRegion: null, layerShape: null } as any }];
    const out = mapOutput(launcher(['D']), [{ id: 'D', name: 'D', createdAt: 0, layers: [own] }],
      [{ ...shared, corners: corners(0, 0, 1, 1) }], surfaces);
    expect(out.find((l) => l.id === 'mapvj-0::s')!.corners).toEqual(corners(0.5, 0.5, 0.9, 0.9));
  });

  it('keeps native layer ids and the video binding when a row switches between presets that share a video surface', async () => {
    const video = surfaceLayer('screen', [0, 0, 1, 1], { id: 'shared-video', type: 'video', src: '/media/loop.mov', isPlaying: true });
    const text = surfaceLayer('banner', [0.1, 0.8, 0.9, 0.95]);
    const a = preset('A', [video]);
    const b = preset('B', [text, video]);
    const project = migrateMapSurfaces({ layers: [text, video], vjMode: { compositions: [a, b] } } as unknown as Project);
    const comps = project.vjMode!.compositions;
    const sync = readySync();
    try {
      const cache = new Map();
      const first = await flushPayload(sync, mapOutput(launcher(['A']), comps, project.layers, project.mapSurfaces, cache));
      expect(first.commands.some((c) => c.type === 'bind_media_source' && c.layer_id === 'mapvj-0::screen')).toBe(true);
      const switched = await flushPayload(sync, mapOutput(launcher(['B']), comps, project.layers, project.mapSurfaces, cache));
      // The shared surface is the same native layer showing the same source:
      // no remove, no rebind, so the core keeps its decoder.
      expect(switched.commands.filter((c) => c.layer_id === 'mapvj-0::screen'
        && (c.type === 'remove_layer' || c.type === 'bind_media_source'))).toEqual([]);
      expect(switched.commands.some((c) => c.type === 'bind_media_source' && c.layer_id === 'mapvj-0::banner')).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('renders every preset of an older project exactly as before after migration', async () => {
    // An older project: two presets saved at different times. Preset A agrees
    // with preset C on `left`; B was saved before the left surface was
    // re-warped and has a mesh with Bezier tangents on `right`.
    const left = surfaceLayer('left', [0.1, 0.1, 0.4, 0.6]);
    const right = surfaceLayer('right', [0.6, 0.1, 0.9, 0.6]);
    const oldLeft = { ...clone(left), corners: corners(0.12, 0.08, 0.41, 0.63) };
    const meshRight = { ...clone(right), warpMode: 'mesh' as const, meshGrid: {
      rows: 2, cols: 2,
      points: [[{ x: 0.6, y: 0.6 }, { x: 0.9, y: 0.6 }], [{ x: 0.6, y: 0.1 }, { x: 0.92, y: 0.08 }]],
      tangents: [[null, { in: { x: -0.05, y: 0 }, out: { x: 0.05, y: 0.02 } }], [null, null]],
    } as any, mask: { enabled: true, inverted: false, feather: 0.1, shapes: [{ points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.9 }], closed: true }] } as any,
    layerShape: { type: 'circle' } as any, cropRegion: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } as any };
    const oldProject = {
      layers: [left, right],
      vjMode: { compositions: [preset('A', [left, right]), preset('B', [oldLeft, meshRight]), preset('C', [left])] },
    } as unknown as Project;

    // Reference: the pre-shared-surface MAP builder, verbatim in behaviour.
    // Children were `mapvj-<row>-<clipId>::<layerId>` clones of the saved copy.
    const legacyOutput = (state: any, comps: Composition[]) => state.layerStates.flatMap((row: any, index: number) => {
      const comp = comps.find((c) => c.id === row.activeClip?.presetId);
      if (!comp) return [];
      const groupId = `mapvj-${index}-${row.activeClip.id}`;
      return [
        { ...createLayer(groupId, 'group', 'group'), opacity: row.opacity, blendMode: row.blendMode, source: null },
        ...comp.layers.map((layer) => ({ ...clone(layer), id: `${groupId}::${layer.id}`, parentGroupId: groupId, bank: undefined })),
      ];
    });

    const migrated = migrateMapSurfaces(oldProject);
    // B's copies disagree with the majority, so they became detached overrides.
    const b = migrated.vjMode!.compositions.find((c) => c.id === 'B')!;
    expect(b.layers.map((l) => [l.surfaceId, l.surfaceDetached ?? false])).toEqual([['left', true], ['right', true]]);
    expect(migrated.vjMode!.compositions.find((c) => c.id === 'A')!.layers.every((l) => !l.surfaceDetached)).toBe(true);
    expect(migrated.layers.every((l) => !l.surfaceDetached)).toBe(true);

    for (const rows of [['A', 'B'], ['B', 'C'], ['C', 'A']]) {
      const state = launcher(rows);
      const oldSync = readySync();
      const legacy = await flushPayload(oldSync, legacyOutput(state, oldProject.vjMode!.compositions));
      vi.restoreAllMocks();
      const newSync = readySync();
      const current = await flushPayload(newSync, mapOutput(state, migrated.vjMode!.compositions, migrated.layers, migrated.mapSurfaces));
      vi.restoreAllMocks();
      const byLegacyId = [...legacy.upserts.entries()].map(([id, command]) => [id.replace(/^mapvj-(\d+)-clip-[A-Z]::/, 'mapvj-$1::'), geometryPayload(command)]);
      const byNewId = [...current.upserts.entries()].map(([id, command]) => [id, geometryPayload(command)]);
      expect(byNewId).toEqual(byLegacyId);
      expect(byNewId.length).toBeGreaterThan(0);
    }
  });
});
