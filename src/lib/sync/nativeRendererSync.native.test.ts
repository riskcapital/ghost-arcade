import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GPU_SOURCE_ID } from '../renderer/defaultSourceImage';
import type {
  NativeEffectPassRuntime,
} from './nativeRendererSync';

let effectToNativeDescriptor: (effect: any) => string | null;
let nativeEffectPassFromDescriptor: (descriptor: string | null) => NativeEffectPassRuntime | null;
let missingNativeGraphRouteRequirements: (
  features: Record<string, boolean>,
  instruments: ReadonlySet<string>,
  manifest: ReadonlyMap<string, any>,
) => string[];
let nativeGraphInstrumentIds: (capabilities: any) => string[];
let nativeGraphManifestById: (capabilities: any) => Map<string, any>;
let nativeGraphReadyRouteKinds: (
  features: Record<string, boolean>,
  instruments: ReadonlySet<string>,
  manifest: ReadonlyMap<string, any>,
) => Set<string>;
let nativeGraphRouteRequirements: () => ReadonlyArray<{
  kind: string;
  feature: string;
  instrument: string;
  shaderIds: readonly string[];
}>;
let nativeEffectPassDescriptorIds: (capabilities: any) => string[];
let nativeUnsupportedEffectTypes: (layer: any) => string[];
let nativeUnsupportedSourceReason: (
  layer: any,
  hasNativeGraphRoute?: boolean,
  options?: any,
) => string | null;
let buildNativeSharedTextureSourceFrameCommand: typeof import('./nativeRendererSync').buildNativeSharedTextureSourceFrameCommand;
let NativeRendererSyncCtor: typeof import('./nativeRendererSync').NativeRendererSync;
let nativeLayerMaskState: typeof import('./nativeRendererSync').nativeLayerMaskState;
let nativeLayerEdgeEffectsState: typeof import('./nativeRendererSync').nativeLayerEdgeEffectsState;
let nativeGraphCompositeSourceId: typeof import('./nativeRendererSync').nativeGraphCompositeSourceId;
let nativeGraphInstrumentSourceId: typeof import('./nativeRendererSync').nativeGraphInstrumentSourceId;
let nativeLayerSourceFromMediaSource: typeof import('./nativeRendererSync').nativeLayerSourceFromMediaSource;
let isNativeCoreOwnedGraphKind: typeof import('./nativeRendererSync').isNativeCoreOwnedGraphKind;
let isNativeExternallyQueuedGraphKind: typeof import('./nativeRendererSync').isNativeExternallyQueuedGraphKind;

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
    value: {
      documentElement: {
        style: {
          setProperty: () => {},
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    },
  });
  ({
    effectToNativeDescriptor,
    missingNativeGraphRouteRequirements,
    nativeGraphInstrumentIds,
    nativeGraphManifestById,
    nativeGraphReadyRouteKinds,
    nativeGraphRouteRequirements,
    nativeEffectPassDescriptorIds,
    nativeEffectPassFromDescriptor,
    nativeUnsupportedEffectTypes,
    nativeUnsupportedSourceReason,
    buildNativeSharedTextureSourceFrameCommand,
    NativeRendererSync: NativeRendererSyncCtor,
    nativeLayerMaskState,
    nativeLayerEdgeEffectsState,
    nativeGraphCompositeSourceId,
    nativeGraphInstrumentSourceId,
    nativeLayerSourceFromMediaSource,
    isNativeCoreOwnedGraphKind,
    isNativeExternallyQueuedGraphKind,
  } = await import('./nativeRendererSync'));
});

function graphCapabilities() {
  const graphContract = nativeGraphRouteRequirements();
  return {
    native_graph_instruments: graphContract.map((entry) => entry.instrument),
    native_graph_instrument_manifest: graphContract.map((entry) => ({
      id: entry.instrument,
      source_uri_prefix: `native-graph://${entry.instrument}/`,
      shader_ids: [...entry.shaderIds],
      features: ['compute_graph_host', 'compute_graph_render', 'compute_graph_source_frame_target', entry.feature],
      render_target: 'source_frame',
    })),
    features: Object.fromEntries(graphContract.map((entry) => [entry.feature, true])),
  };
}

describe('native renderer sync graph manifest contract', () => {
  it('routes the VJ crossfade through the native core-owned graph path', () => {
    expect(isNativeCoreOwnedGraphKind('vj-crossfade')).toBe(true);
  });

  it('retains externally queued SVG and Lines graph sources in the compositor', () => {
    expect(isNativeExternallyQueuedGraphKind('svg')).toBe(true);
    expect(isNativeExternallyQueuedGraphKind('lines')).toBe(true);
    expect(isNativeExternallyQueuedGraphKind('planet')).toBe(false);
  });

  it('requires complete shader IDs for each native graph route', () => {
    const complete = graphCapabilities();
    expect(
      missingNativeGraphRouteRequirements(
        complete.features,
        new Set(nativeGraphInstrumentIds(complete)),
        nativeGraphManifestById(complete),
      ),
    ).toEqual([]);

    const missingParticleLines = graphCapabilities();
    missingParticleLines.native_graph_instrument_manifest = missingParticleLines.native_graph_instrument_manifest.map((entry) =>
      entry.id === 'particle-field'
        ? { ...entry, shader_ids: entry.shader_ids.filter((shaderId) => shaderId !== 'particle-field/lines') }
        : entry,
    );
    expect(
      missingNativeGraphRouteRequirements(
        missingParticleLines.features,
        new Set(nativeGraphInstrumentIds(missingParticleLines)),
        nativeGraphManifestById(missingParticleLines),
      ),
    ).toContain('particle-field:shader:particle-field/lines');
    const particleMissingRoutes = nativeGraphReadyRouteKinds(
      missingParticleLines.features,
      new Set(nativeGraphInstrumentIds(missingParticleLines)),
      nativeGraphManifestById(missingParticleLines),
    );
    expect(particleMissingRoutes.has('planet')).toBe(true);
    expect(particleMissingRoutes.has('particle-field')).toBe(false);
    const requirements = nativeGraphRouteRequirements();
    expect(requirements.some((entry) => entry.kind === 'point-cloud-fx')).toBe(true);
    expect(requirements.find((entry) => entry.kind === 'ghostfx')?.shaderIds).toContain(
      'ghostfx/liquid-render',
    );
  });
});

describe('native renderer sync render clock routing', () => {
  it('prefers manual render-clock time for native video playback commands', () => {
    const sync = new NativeRendererSyncCtor() as any;
    const src = {
      videoElement: { currentTime: 12.5 },
    };

    expect(sync.nativeVideoPlaybackTimeSeconds(src, 5000)).toBe(12.5);

    sync.setRenderClock(4.25);
    expect(sync.nativeVideoPlaybackTimeSeconds(src, 5000)).toBe(4.25);

    sync.setRenderClock(null);
    sync.liveClockOriginMs = 1000;
    // A new native video with no decoded/browser time always starts at frame
    // zero. It must never inherit time elapsed since the renderer booted.
    expect(sync.nativeVideoPlaybackTimeSeconds({ videoElement: { currentTime: Number.NaN } }, 2500)).toBe(0);
  });
});

describe('native renderer sync lifecycle ownership', () => {
  it('can dispose a Canvas-scoped sync without clearing the app-level native core', async () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.running = true;
    sync.startupReady = true;
    sync.clearRuntimeCaches = vi.fn();

    await sync.stop({ stopCore: false });

    expect(sync.running).toBe(false);
    expect(sync.startupReady).toBe(false);
    expect(sync.clearRuntimeCaches).not.toHaveBeenCalled();
  });
});

describe('native renderer sync content fit routing', () => {
  it('uses cached native media dimensions for stretch, fill, and contain UV modes', () => {
    const sync = new NativeRendererSyncCtor() as any;
    const source = {
      id: 'wide-video',
      src: 'file:///tmp/wide-video.mp4',
      type: 'video',
    };
    const nativeSource = {
      id: source.id,
      uri: source.src,
      sourceType: 'video',
      source,
      shouldPrefetch: true,
      shouldPreview: true,
    };
    const sourceKey = sync.sourceCacheKey(source.id, source.src);
    sync.nativeVideoDecodeDimensionCache.set(sourceKey, {
      width: 1920,
      height: 1080,
      metadata: true,
    });
    const baseLayer = {
      contentFit: 'stretch',
      corners: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 1, y: 0 },
        bottomRight: { x: 1, y: 1 },
        bottomLeft: { x: 0, y: 1 },
      },
      flipH: false,
      flipV: false,
      cropRegion: null,
    };

    const stretch = sync.nativeLayerUvState(baseLayer, nativeSource, 1000, 1000);
    const fill = sync.nativeLayerUvState(
      { ...baseLayer, contentFit: 'fill' },
      nativeSource,
      1000,
      1000,
    );
    const contain = sync.nativeLayerUvState(
      { ...baseLayer, contentFit: 'crop' },
      nativeSource,
      1000,
      1000,
    );

    expect(stretch.uvFlags).toEqual([0, 1.77778, 0, 0]);
    expect(fill.uvFlags).toEqual([1, 1.77778, 0, 0]);
    expect(contain.uvFlags).toEqual([2, 1.77778, 0, 0]);
  });
});

describe('native renderer sync shared-texture source frames', () => {
  it('uses the dedicated GPU shared-texture command shape', () => {
    const command = buildNativeSharedTextureSourceFrameCommand({
      sourceId: 'source-a',
      width: 1920,
      height: 1080,
      info: {
        available: true,
        platform: 'syphon',
        label: 'Syphon',
        senderName: 'Main Sender',
        format: 'bgra8unorm',
        frame: 42,
        handle: '1234',
        handleEncoding: 'integer',
        handleByteLength: 4,
      },
      seq: 7,
    });

    expect(command).toMatchObject({
      type: 'upload_source_gpu_shared_texture',
      source_id: 'source-a',
      width: 1920,
      height: 1080,
      shared_handle: '1234',
      platform: 'syphon',
      format: 'bgra8unorm',
      handle_encoding: 'integer',
      handle_byte_length: 4,
      frame: 42,
      sender_name: 'Main Sender',
      seq: 7,
    });
    expect((command as any).shared_texture_platform).toBeUndefined();
  });

  it('routes each live source through its explicit native transport', () => {
    const webcam = nativeLayerSourceFromMediaSource({
      id: 'camera-layer',
      type: 'video',
      src: 'live://webcam/camera-session',
      liveSourceType: 'webcam',
      liveSourceSessionId: 'camera-session',
    } as any);
    const ndi = nativeLayerSourceFromMediaSource({
      id: 'ndi-layer',
      type: 'spout',
      src: 'live://ndi/ndi-session',
      liveSourceType: 'ndi',
      ndiSource: { senderName: 'Studio NDI' },
    } as any);
    const syphon = nativeLayerSourceFromMediaSource({
      id: 'syphon-layer',
      type: 'spout',
      src: 'live://spout/syphon-session',
      liveSourceType: 'syphon',
      spoutSource: { senderName: 'Resolume Output' },
    } as any);

    expect(webcam).toMatchObject({
      sourceType: 'live:webcam',
      uri: 'native-live://webcam/camera-session',
      shouldPrefetch: false,
      shouldPreview: true,
    });
    expect(ndi).toMatchObject({
      sourceType: 'live:ndi',
      uri: 'native-live://ndi/Studio%20NDI',
    });
    expect(syphon).toMatchObject({
      sourceType: 'live:syphon',
      uri: 'native-live://syphon/Resolume%20Output',
    });
  });

  it('schedules live shared textures at frame cadence instead of thumbnail cadence', () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeFeatureFlags = { shared_texture_source_frame_upload: true };
    const source = {
      id: 'camera-layer',
      type: 'video',
      src: 'live://webcam/camera-session',
      liveSourceType: 'webcam',
      liveSourceSessionId: 'camera-session',
    };
    const infoKey = sync.sharedTextureInfoKey(source, 'live:webcam');
    sync.sharedTextureInfoCache.set(infoKey, {
      info: {
        available: true,
        platform: 'iosurface',
        width: 1920,
        height: 1080,
        format: 80,
        frame: 1,
        handle: '42',
        handleEncoding: 'integer',
        handleByteLength: 4,
      },
      updatedAt: 1000,
    });

    const commands: any[] = [];
    expect(sync.appendSharedTextureSourceFrameCommand(
      commands,
      source,
      'live:webcam',
      1000,
      false,
      null,
    )).toBe(true);

    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe('upload_source_gpu_shared_texture');
    expect(sync.sourcePreviewNextAt.get(sync.sourceCacheKey(source.id, source.src))).toBe(1016);
  });
});

describe('native renderer sync graph effect routing', () => {
  it('records native graph route failures after warning suppression kicks in', () => {
    const sync = new NativeRendererSyncCtor() as any;
    const routeState = {
      inFlight: false,
      seq: 0,
      warnings: 0,
      state: null,
      bufferPrefixes: [],
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      for (let i = 0; i < 4; i += 1) {
        sync.recordNativeGraphRouteFailure(
          { kind: 'particle-field', key: 'particle-route' },
          'layer-a',
          new Error(`boom-${i}`),
          routeState,
        );
      }

      expect(warnSpy).toHaveBeenCalledTimes(3);
    } finally {
      warnSpy.mockRestore();
    }

    expect(routeState.warnings).toBe(4);
    expect(sync.nativeGraphRouteFailures).toBe(4);
    expect(sync.nativeGraphRouteSuppressedFailures).toBe(1);
    expect(sync.nativeGraphRouteLastFailure).toBe('particle-field:layer-a:boom-3');

    sync.resetNativeGraphRouteTelemetry();
    expect(sync.nativeGraphRouteFailures).toBe(0);
    expect(sync.nativeGraphRouteSuppressedFailures).toBe(0);
    expect(sync.nativeGraphRouteLastFailure).toBeNull();
  });

  it('only attaches native effect-pass chains to GPU graph routes when descriptors are advertised', () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeComputeGraphSourceFrames = true;
    sync.nativeWgslStdlibWarmed = true;
    sync.nativeGraphReadyKinds = new Set(['planet']);
    sync.nativeFeatureFlags = {
      compute_graph_texture_sampling: true,
      compute_graph_source_frame_target: true,
      native_planet_graph: true,
    };
    sync.nativeEffectPassDescriptorIds = new Set(['invert']);

    const layer = {
      id: 'gpu-layer-a',
      type: 'gpu',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: null,
      gpuLayerContent: {
        shaderId: 'planet',
        params: {},
      },
      effects: [
        {
          id: 'fx-invert',
          type: 'invert',
          enabled: true,
          params: {},
        },
      ],
    };

    const withoutManifest = sync.nativeGraphRouteForLayer(layer);
    expect(withoutManifest?.kind).toBe('planet');
    expect(withoutManifest?.source.id).toBe('gpu:gpu-layer-a:planet');
    expect(withoutManifest?.baseSource).toBeUndefined();
    expect(withoutManifest?.effectPasses).toBeUndefined();

    sync.nativeFeatureFlags.native_effect_pass_manifest = true;
    const withManifest = sync.nativeGraphRouteForLayer(layer);
    expect(withManifest?.kind).toBe('planet');
    expect(withManifest?.baseSource?.id).toBe('gpu:gpu-layer-a:planet');
    expect(withManifest?.source.id).toBe('effect-pass:gpu-layer-a');
    expect(withManifest?.effectPasses?.map((entry: any) => entry.effect)).toEqual(['invert']);
    expect(nativeGraphInstrumentSourceId(withManifest)).toBe('gpu:gpu-layer-a:planet');
    expect(nativeGraphCompositeSourceId(withManifest)).toBe('effect-pass:gpu-layer-a');

    sync.nativeEffectPassDescriptorIds = new Set(['blur']);
    const withoutDescriptor = sync.nativeGraphRouteForLayer(layer);
    expect(withoutDescriptor?.source.id).toBe('gpu:gpu-layer-a:planet');
    expect(withoutDescriptor?.effectPasses).toBeUndefined();
    expect(nativeGraphInstrumentSourceId(withoutDescriptor)).toBe('gpu:gpu-layer-a:planet');
    expect(nativeGraphCompositeSourceId(withoutDescriptor)).toBe('gpu:gpu-layer-a:planet');
  });

  it('keeps core-owned graph effects out of the UI-driven graph queue', async () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeComputeGraphSourceFrames = true;
    sync.nativeWgslStdlibWarmed = true;
    sync.nativeGraphReadyKinds = new Set(['planet']);
    sync.nativeFeatureFlags = {
      compute_graph_texture_sampling: true,
      compute_graph_source_frame_target: true,
      native_planet_graph: true,
      native_effect_pass_manifest: true,
    };
    sync.nativeEffectPassDescriptorIds = new Set(['invert']);

    const layer = {
      id: 'gpu-live-effect',
      type: 'gpu',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: null,
      gpuLayerContent: {
        shaderId: 'planet',
        params: {},
      },
      effects: [{ id: 'fx-invert', type: 'invert', enabled: true, params: {} }],
    };
    const commands = await sync.renderNativeGraphSources(
      [layer],
      160,
      90,
      { type: 'set_render_clock', mode: 'live', time: 1, time_delta: 1 / 30, frame_index: 30 },
      {
        isActive: false,
        bass: 0,
        bassFast: 0,
        treble: 0,
      },
    );

    expect(commands).toEqual([]);
  });

  it('installs plugin graphs once instead of resubmitting them on render ticks', async () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeComputeGraphSourceFrames = true;
    sync.nativeWgslStdlibWarmed = true;
    sync.nativeGraphReadyKinds = new Set(['ghostfx', 'handfx']);

    const pluginLayer = (effectType: 'ghostfx' | 'handfx') => ({
      id: `plugin-${effectType}`,
      type: 'media',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        id: `plugin-${effectType}-source`,
        type: 'effect',
        src: `plugin://${effectType}`,
        name: effectType,
        effectSource: {
          effectType,
          ...(effectType === 'ghostfx'
            ? { ghostfxScenePreset: 'drift' }
            : { handfxMode: 'trails', handfxCameraOn: false }),
        },
      },
    });
    const clock = {
      type: 'set_render_clock',
      mode: 'live',
      time: 1,
      time_delta: 1 / 60,
      frame_index: 60,
    };
    const visual = {
      isActive: false,
      bass: 0,
      bassFast: 0,
      mid: 0,
      treble: 0,
      energy: 0,
      beatPhase: 0,
      beat: 0,
      level: 0,
    };

    const ghostCommands = await sync.renderNativeGraphSources(
      [pluginLayer('ghostfx')],
      160,
      90,
      clock,
      visual,
    );
    expect(ghostCommands).toEqual([]);

    const handCommands = await sync.renderNativeGraphSources(
      [pluginLayer('handfx')],
      160,
      90,
      clock,
      visual,
    );
    expect(handCommands.every((command: any) => command.type === 'update_native_graph_buffer')).toBe(true);
    expect(handCommands.some((command: any) => command.type === 'queue_compute_graph')).toBe(false);
  });

  it('does not treat browser preview elements as native effect-pass input frames', () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeFeatureFlags = {
      native_effect_pass_manifest: true,
      compute_graph_texture_sampling: true,
      compute_graph_source_frame_target: true,
    };
    sync.nativeEffectPassDescriptorIds = new Set(['invert']);

    const layer = {
      id: 'browser-preview-video',
      type: 'media',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        id: 'browser-video-source',
        type: 'video',
        name: 'Browser Video',
        src: 'blob://browser-video-preview',
        videoElement: {
          readyState: 2,
          width: 64,
          height: 64,
          videoWidth: 64,
          videoHeight: 64,
        },
      },
      effects: [
        {
          id: 'fx-invert',
          type: 'invert',
          enabled: true,
          params: {},
        },
      ],
    };

    expect(sync.nativeEffectPassRouteForLayer(layer)).toBeNull();
  });

  // Selecting a source-driven shader used to produce a black frame: with no
  // source bound the route refused to build at all. It now falls back to the
  // built-in demo image so the shader has pixels the moment it is picked.
  function sourceDrivenSync(kind: string) {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeComputeGraphSourceFrames = true;
    sync.nativeWgslStdlibWarmed = true;
    sync.nativeGraphReadyKinds = new Set([kind]);
    return sync;
  }

  function gpuLayer(shaderId: string, params: Record<string, unknown>) {
    return {
      id: `gpu-${shaderId}`,
      type: 'gpu',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: null,
      gpuLayerContent: { shaderId, params },
    };
  }

  // particle-field is deliberately absent: `media` is not in its mode dropdown
  // (galaxy/atomic/swarm/lattice/field/gravity), so nobody can select their way
  // into the black screen this fallback exists to prevent. See the companion
  // test below, which pins that exclusion.
  it.each([
    ['pixel-particles', 'pixel-particles', {}],
    ['flythrough', 'flythrough', {}],
  ])('falls back to the built-in demo source for %s with nothing bound', (kind, shaderId, extraParams) => {
    const sync = sourceDrivenSync(kind);

    const unbound = sync.nativeGraphRouteForLayer(gpuLayer(shaderId, { ...extraParams, source: null }));
    expect(unbound?.kind).toBe(kind);
    expect(unbound?.inputSource?.id).toBe(DEFAULT_GPU_SOURCE_ID);

    // Never bound at all (param absent) behaves the same as explicitly cleared.
    const missing = sync.nativeGraphRouteForLayer(gpuLayer(shaderId, { ...extraParams }));
    expect(missing?.inputSource?.id).toBe(DEFAULT_GPU_SOURCE_ID);
  });

  it('drops the demo fallback the moment a real source is bound, and picks it back up when cleared', () => {
    const sync = sourceDrivenSync('pixel-particles');
    const boundSource = {
      type: 'file',
      name: 'clip.png',
      url: 'file:///tmp/clip.png',
      mime: 'image/png',
    };

    const bound = sync.nativeGraphRouteForLayer(gpuLayer('pixel-particles', { source: boundSource }));
    expect(bound?.kind).toBe('pixel-particles');
    expect(bound?.inputSource?.id).not.toBe(DEFAULT_GPU_SOURCE_ID);
    expect(bound?.inputSource?.uri).toContain('clip.png');

    const cleared = sync.nativeGraphRouteForLayer(gpuLayer('pixel-particles', { source: null }));
    expect(cleared?.inputSource?.id).toBe(DEFAULT_GPU_SOURCE_ID);
  });

  it('leaves particle-field (any mode) and Point Cloud FX without a fallback', () => {
    const particleField = sourceDrivenSync('particle-field');
    // media mode is unreachable from the UI and only exists in legacy projects,
    // which carry their own bound source — so an unbound media-mode layer keeps
    // the pre-existing no-route behaviour rather than gaining a demo image it
    // would render as a thin sliver.
    expect(
      particleField.nativeGraphRouteForLayer(gpuLayer('particle-field', { mode: 'media', source: null })),
    ).toBeNull();
    // Non-media modes are procedural — they never wanted an input source.
    const galaxy = particleField.nativeGraphRouteForLayer(gpuLayer('particle-field', { mode: 'galaxy' }));
    expect(galaxy?.kind).toBe('particle-field');
    expect(galaxy?.inputSource).toBeNull();

    // Point Cloud FX consumes .ply/.splat geometry; an image means nothing to
    // it, so an empty picker still refuses the route.
    const pointCloud = sourceDrivenSync('point-cloud-fx');
    expect(pointCloud.nativeGraphRouteForLayer(gpuLayer('point-cloud-fx', { source: null }))).toBeNull();
  });

  it('uploads the demo source frame exactly once per core session', () => {
    const sync = sourceDrivenSync('pixel-particles');
    sync.nativeFeatureFlags = { source_frame_upload: true };

    const commands: any[] = [];
    sync.appendDefaultGpuSourceUpload(commands);
    sync.appendDefaultGpuSourceUpload(commands);
    sync.appendDefaultGpuSourceUpload(commands);

    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe('upload_source_frame');
    expect(commands[0].source_id).toBe(DEFAULT_GPU_SOURCE_ID);
    expect(commands[0].width).toBe(commands[0].height);
    expect(String(commands[0].rgba_b64).length).toBeGreaterThan(1000);
  });

  it('exposes Point Cloud FX once its buffers and animation are core-owned', () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeComputeGraphSourceFrames = true;
    sync.nativeWgslStdlibWarmed = true;
    sync.nativeGraphReadyKinds = new Set(['point-cloud-fx']);

    const layer = {
      id: 'gpu-point-cloud',
      type: 'gpu',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: null,
      gpuLayerContent: {
        shaderId: 'point-cloud-fx',
        params: {
          source: {
            type: 'file',
            name: 'cloud-a.ply',
            url: '/tmp/cloud-a.ply',
            mime: 'application/octet-stream',
          },
        },
      },
    };

    const route = sync.nativeGraphRouteForLayer(layer);
    expect(route?.kind).toBe('point-cloud-fx');
    expect(route?.inputSource?.sourceType).toBe('point-cloud');
  });

  it('packs active edge styling into the native compositor contract', () => {
    const state = nativeLayerEdgeEffectsState({
      edgeEffects: {
        enabled: true,
        effects: [{
          id: 'edge-a',
          enabled: true,
          opacity: 0.75,
          blendMode: 'add',
          stroke: {
            type: 'snake',
            color: [0.1, 0.8, 1, 1],
            width: 6,
            length: 0.35,
            speed: 1.5,
            tailFade: true,
            headGlow: true,
            bidirectional: false,
            snakeCount: 3,
          },
          fill: { type: 'solid', color: [1, 0.2, 0.4, 0.5] },
          animation: { type: 'breathe', speed: 2, minScale: 0.8, maxScale: 1.2, easing: 'sine' },
        }],
      },
    } as any);

    expect(state.packed).toHaveLength(1);
    expect(state.packed[0][0]).toEqual([1, 0.75, 1, 4]);
    expect(state.packed[0][1]).toEqual([0.1, 0.8, 1, 1]);
    expect(state.packed[0][2]).toEqual([6, 0.35, 1.5, 3]);
    expect(state.packed[0][3][0]).toBe(1);
    expect(state.packed[0][6]).toEqual([2, 2, 0.8, 1.2]);
    expect(state.signature).not.toBe('none');
  });
});

describe('native renderer sync native video pump routing', () => {
  it('arms library videos at their exact trim-in with the initial trigger generation', () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.desiredWidth = 1920;
    sync.desiredHeight = 1080;
    const options = sync.libraryVideoPrefetchOptions({
      id: 'library-video',
      src: '/tmp/library-video.mp4',
      type: 'video',
      videoElement: {
        currentTime: 7.5,
        duration: 12,
        videoWidth: 1920,
        videoHeight: 1080,
        addEventListener: () => {},
      },
      playbackRate: 1.5,
      playbackMode: 'loop',
      trimStart: 0.25,
      trimEnd: 0.9,
    });

    expect(options).toMatchObject({
      timeSeconds: 3,
      seekGeneration: 1,
      seq: 3000,
      playbackRate: 1.5,
      loopEnabled: true,
      durationSeconds: 12,
      trimStart: 0.25,
      trimEnd: 0.9,
    });
  });

  it('keeps CPU and synthetic decode fallbacks disabled even when requested', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sync = new NativeRendererSyncCtor() as any;

      await sync.setDecodeCpuBackupPolicy(true);
      await sync.setDecodeSyntheticFallbackPolicy(true);

      expect(sync.decodeStoreCpuBackupFrames).toBe(false);
      expect(sync.decodeAllowSyntheticFallback).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        '[NativeRendererSync] CPU decode backup frames are disabled in native-engine-only mode',
      );
      expect(warn).toHaveBeenCalledWith(
        '[NativeRendererSync] Synthetic decode fallback is disabled in native-engine-only mode',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('marks native-pump video frames ready and leaves the source unavailable on decode failure', () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeFeatureFlags = {
      native_media_decode: true,
      media_prefetch: true,
      native_video_decode_pump: true,
      native_video_decode_pump_window: true,
      native_video_frame_decode: true,
      native_video_frame_prefetch: true,
      native_media_source_playback_state: true,
    };
    const source = {
      id: 'video-a',
      src: '/tmp/video-a.mp4',
      type: 'video',
    };
    const nativeSource = {
      id: 'video-a',
      uri: '/tmp/video-a.mp4',
      sourceType: 'video',
      source,
      shouldPrefetch: true,
      shouldPreview: true,
    };

    expect(sync.canUseNativeVideoDecodePump(nativeSource, 'video')).toBe(true);
    expect(sync.markNativeVideoDecodePumpFrameReady(source)).toBe(true);
    const sourceKey = sync.sourceCacheKey(source.id, source.src);
    expect(sync.sourcePreviewSig.get(sourceKey)).toBe('native-video-pump:/tmp/video-a.mp4');
    expect(sync.sourcePreviewSeq.get(sourceKey)).toBe(1);

    sync.reconcileNativeVideoDecodes({
      native_video_frame_decode_failures: 1,
      native_video_frame_decodes: 0,
      native_video_frame_decode_last_error: 'decode failed',
    });

    expect(sync.sourcePreviewSig.has(sourceKey)).toBe(false);
    expect(sync.sourcePreviewSeq.has(sourceKey)).toBe(false);
    expect(sync.canUseNativeVideoDecodePump(nativeSource, 'video')).toBe(false);
  });

  it('sends video playback controls once and leaves frame advancement to the core', () => {
    const sync = new NativeRendererSyncCtor() as any;
    const source = {
      id: 'video-native-clock',
      src: '/tmp/video-native-clock.mp4',
      type: 'video',
      isPlaying: true,
      playbackRate: 1.5,
      playbackMode: 'loop',
      trimStart: 0.2,
      trimEnd: 0.8,
    };
    const clock = { type: 'set_render_clock', mode: 'live', time: 10, time_delta: 1 / 60, frame_index: 600 };
    const first = sync.nativeVideoPlaybackCommandIfChanged(source, 'video', 1000, clock);
    expect(first).toMatchObject({
      type: 'set_media_source_playback',
      playback_rate: 1.5,
      paused: false,
      loop_enabled: true,
      trim_start: 0.2,
      trim_end: 0.8,
    });
    expect(sync.nativeVideoPlaybackCommandIfChanged(source, 'video', 1016, clock)).toBeNull();

    source.isPlaying = false;
    const paused = sync.nativeVideoPlaybackCommandIfChanged(source, 'video', 1032, {
      ...clock,
      time: 11,
      frame_index: 660,
    });
    expect(paused?.paused).toBe(true);
    expect(paused?.time_seconds).toBeCloseTo(1.5, 5);
  });

  it('emits explicit native seek commands without requiring a browser video element', () => {
    const sync = new NativeRendererSyncCtor() as any;
    const source = {
      id: 'video-native-seek',
      src: '/tmp/video-native-seek.mp4',
      type: 'video',
      isPlaying: false,
      playbackRate: 1,
      playbackMode: 'loop',
      durationSeconds: 12,
      _nativePlaybackTimeSeconds: 2.25,
      _nativePlaybackUpdatedAtMs: 1000,
      _nativePlaybackSeekSeq: 1,
    };
    const clock = { type: 'set_render_clock', mode: 'live', time: 1, time_delta: 1 / 60, frame_index: 60 };
    expect(sync.nativeVideoPlaybackCommandIfChanged(source, 'video', 1000, clock)?.time_seconds).toBe(2.25);
    expect(sync.nativeVideoPlaybackCommandIfChanged(source, 'video', 1016, clock)).toBeNull();

    source._nativePlaybackTimeSeconds = 8.5;
    source._nativePlaybackSeekSeq += 1;
    expect(sync.nativeVideoPlaybackCommandIfChanged(source, 'video', 1032, clock)?.time_seconds).toBe(8.5);
  });
});

describe('native renderer sync effect-pass descriptors', () => {
  it('identifies enabled non-native effects so native-only output cannot silently drop them', () => {
    expect(nativeUnsupportedEffectTypes({
      effects: [
        { type: 'invert', enabled: true, params: {} },
        { type: 'phaseLab', enabled: true, params: {} },
        { type: 'gpuFluidSim', enabled: true, params: {} },
      ],
    })).toEqual(['gpuFluidSim']);

    expect(nativeUnsupportedEffectTypes({
      effects: [
        { type: 'invert', enabled: true, params: {} },
        { type: 'rgbShift', enabled: true, params: { amount: 0.25 } },
      ],
    })).toEqual([]);
  });

  it('identifies unsupported layer sources so native-only output cannot use browser preview stand-ins', () => {
    expect(nativeUnsupportedSourceReason({
      id: 'gpu-custom',
      type: 'gpu',
      visible: true,
      source: null,
      gpuLayerContent: {
        shaderId: 'custom-shader',
        params: {},
      },
    })).toBe('gpu-shader:custom-shader:not-native');

    expect(nativeUnsupportedSourceReason({
      id: 'gpu-planet',
      type: 'gpu',
      visible: true,
      source: null,
      gpuLayerContent: {
        shaderId: 'planet',
        params: {},
      },
    })).toBe('gpu-shader:planet:route-unavailable');

    expect(nativeUnsupportedSourceReason({
      id: 'gpu-planet',
      type: 'gpu',
      visible: true,
      source: null,
      gpuLayerContent: {
        shaderId: 'planet',
        params: {},
      },
    }, true)).toBeNull();

    const nativePluginLayer = {
      id: 'plugin-ghostfx',
      type: 'media',
      visible: true,
      source: {
        id: 'plugin-ghostfx-source',
        type: 'effect',
        src: 'plugin://ghostfx',
        name: 'GhostFX',
        effectSource: {
          effectType: 'ghostfx',
          ghostfxScenePreset: 'drift',
        },
      },
    };
    expect(nativeUnsupportedSourceReason(nativePluginLayer, true)).toBeNull();
    expect(nativeUnsupportedSourceReason(nativePluginLayer, false)).toBe('effect:native-ingest-pending');
    expect(nativeUnsupportedSourceReason({
      ...nativePluginLayer,
      source: {
        ...nativePluginLayer.source,
        effectSource: {
          effectType: 'ghostfx',
          ghostfxScenePreset: 'liquid',
        },
      },
    }, false)).toBe('effect:native-ingest-pending');

    expect(nativeUnsupportedSourceReason({
      id: 'gpu-pixel-particles',
      type: 'gpu',
      visible: true,
      source: null,
      gpuLayerContent: {
        shaderId: 'pixel-particles',
        params: {},
      },
    })).toBe('gpu-shader:pixel-particles:source-required');

    // Camera is a supported SOURCE for the two instruments whose ingest is
    // wired, so it is no longer what blocks them -- this fixture has no native
    // graph route, which is what the reason now names.
    expect(nativeUnsupportedSourceReason({
      id: 'gpu-pixel-particles-camera',
      type: 'gpu',
      visible: true,
      source: null,
      gpuLayerContent: {
        shaderId: 'pixel-particles',
        params: {
          source: { type: 'camera', deviceId: 'cam-a' },
        },
      },
    })).toBe('gpu-shader:pixel-particles:route-unavailable');

    // Every other instrument still reports the source as the blocker rather
    // than rendering black on a camera it cannot read.
    expect(nativeUnsupportedSourceReason({
      id: 'gpu-particle-field-camera',
      type: 'gpu',
      visible: true,
      source: null,
      gpuLayerContent: {
        shaderId: 'particle-field',
        params: {
          mode: 'media',
          source: { type: 'camera', deviceId: 'cam-a' },
        },
      },
    })).toBe('gpu-source:camera:native-ingest-pending');

    expect(nativeUnsupportedSourceReason({
      id: 'media-image',
      type: 'media',
      visible: true,
      source: {
        id: 'image-a',
        type: 'image',
        src: '/tmp/image-a.png',
        name: 'Image A',
      },
    })).toBeNull();

    expect(nativeUnsupportedSourceReason({
      id: 'media-isf',
      type: 'media',
      visible: true,
      source: {
        id: 'shader-a',
        type: 'shader',
        src: './ISF/shader-a.fs',
        name: 'Shader A',
        shaderCode: '/*{"ISFVSN":"2","INPUTS":[]}*/ void main(){ gl_FragColor=vec4(1.0); }',
      },
    })).toBeNull();

    expect(nativeUnsupportedSourceReason({
      id: 'media-isf-empty',
      type: 'media',
      visible: true,
      source: {
        id: 'shader-empty',
        type: 'shader',
        src: './ISF/shader-empty.fs',
        name: 'Shader Empty',
        shaderCode: '',
      },
    })).toBe('shader:source-required');

    expect(nativeUnsupportedSourceReason({
      id: 'media-js-shader',
      type: 'media',
      visible: true,
      source: {
        id: 'js-shader-a',
        type: 'threejs',
        src: 'js-animation',
        name: 'Shader-backed JS',
        jsAnimation: {
          animationType: 'threejs',
          htmlCode: '<script>const fs = `void main(){ gl_FragColor = vec4(1.0); }`;</script>',
        },
      },
    })).toBeNull();

    expect(nativeUnsupportedSourceReason({
      id: 'media-js-scene',
      type: 'media',
      visible: true,
      source: {
        id: 'js-scene-a',
        type: 'p5js',
        src: 'js-animation',
        name: 'Canvas JS',
        jsAnimation: {
          animationType: 'p5js',
          htmlCode: '<script>function draw(){ circle(20, 20, 10); }</script>',
        },
      },
    })).toBe('p5js:native-scene-graph-required');

    expect(nativeUnsupportedSourceReason({
      id: 'media-mesh',
      type: 'media',
      visible: true,
      warpMode: 'mesh',
      source: {
        id: 'image-a',
        type: 'image',
        src: '/tmp/image-a.png',
        name: 'Image A',
      },
    })).toBe('warp:mesh:invalid-grid');

    expect(nativeUnsupportedSourceReason({
      id: 'media-mesh-native',
      type: 'media',
      visible: true,
      warpMode: 'mesh',
      meshGrid: {
        rows: 2,
        cols: 2,
        points: [
          [{ x: 0, y: 1 }, { x: 1, y: 1 }],
          [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        ],
      },
      source: {
        id: 'image-a',
        type: 'image',
        src: '/tmp/image-a.png',
        name: 'Image A',
      },
    })).toBeNull();

    expect(nativeUnsupportedSourceReason({
      id: 'media-mask',
      type: 'media',
      visible: true,
      mask: {
        enabled: true,
        inverted: false,
        feather: 0,
        shapes: [],
      },
      source: {
        id: 'image-a',
        type: 'image',
        src: '/tmp/image-a.png',
        name: 'Image A',
      },
    })).toBeNull();

    expect(nativeUnsupportedSourceReason({
      id: 'media-star',
      type: 'media',
      visible: true,
      layerShape: {
        enabled: true,
        type: 'star',
        params: {},
      },
      source: {
        id: 'image-a',
        type: 'image',
        src: '/tmp/image-a.png',
        name: 'Image A',
      },
    })).toBeNull();

    expect(nativeUnsupportedSourceReason({
      id: 'media-polyline',
      type: 'media',
      visible: true,
      layerShape: {
        enabled: true,
        type: 'polyline',
        params: {},
      },
      source: {
        id: 'image-a',
        type: 'image',
        src: '/tmp/image-a.png',
        name: 'Image A',
      },
    })).toBe('layer-shape:polyline:not-native');

    expect(nativeUnsupportedSourceReason({
      id: 'media-inverted-shape',
      type: 'media',
      visible: true,
      layerShape: {
        enabled: true,
        type: 'circle',
        params: { invert: true },
      },
      source: {
        id: 'image-a',
        type: 'image',
        src: '/tmp/image-a.png',
        name: 'Image A',
      },
    })).toBeNull();

    const localVideoLayer = {
      id: 'media-video',
      type: 'media',
      visible: true,
      source: {
        id: 'video-a',
        type: 'video',
        src: '/tmp/video-a.mp4',
        name: 'Video A',
      },
    };
    expect(nativeUnsupportedSourceReason(localVideoLayer)).toBe('video:native-decode-pump-required');
    expect(nativeUnsupportedSourceReason(localVideoLayer, false, {
      nativeVideoDecodePumpReady: true,
    })).toBeNull();

    expect(nativeUnsupportedSourceReason({
      id: 'media-blob',
      type: 'media',
      visible: true,
      source: {
        id: 'image-blob',
        type: 'image',
        src: 'blob:http://localhost/image-blob',
        name: 'Blob Image',
      },
    })).toBe('image:native-readable-uri-required');

    expect(nativeUnsupportedSourceReason({
      id: 'media-assetref',
      type: 'media',
      visible: true,
      source: {
        id: 'image-assetref',
        type: 'image',
        src: 'blob:http://localhost/image-assetref',
        name: 'AssetRef Image',
        _assetRef: {
          kind: 'local-file',
          originalPath: '/tmp/assetref-image.png',
          name: 'assetref-image.png',
        },
      },
    })).toBeNull();

    class FakeCanvas {
      width = 64;
      height = 64;
    }
    Object.defineProperty(globalThis, 'HTMLCanvasElement', {
      configurable: true,
      value: FakeCanvas,
    });
    // Text layers are now native-ready via the text graph route; without a
    // route (core feature missing) the generated preview canvas still may
    // not stand in for a native source frame.
    expect(nativeUnsupportedSourceReason({
      id: 'text-layer',
      type: 'text',
      visible: true,
      source: null,
      _textTexture: {
        canvas: new FakeCanvas(),
      },
    })).toBe('generated-layer:text:not-native-source');
  });

  it('packs closed bezier mask shapes for the native compositor', () => {
    const state = nativeLayerMaskState({
      mask: {
        enabled: true,
        inverted: true,
        feather: 0.08,
        shapes: [
          {
            closed: true,
            points: [
              { x: 0.1, y: 0.1, cpOut: { x: 0.25, y: 0.02 } },
              { x: 0.9, y: 0.1, cpIn: { x: 0.75, y: 0.02 } },
              { x: 0.5, y: 0.9 },
            ],
          },
          {
            closed: true,
            points: [
              { x: 0.2, y: 0.2 },
              { x: 0.35, y: 0.2 },
              { x: 0.25, y: 0.35 },
            ],
          },
        ],
      },
    } as any);

    expect(state.info[0]).toBe(1);
    expect(state.info[1]).toBe(1);
    expect(state.info[2]).toBeCloseTo(0.08);
    expect(state.points.length).toBeGreaterThan(6);
    expect(state.points.length).toBeLessThanOrEqual(64);
    expect(new Set(state.points.map((point) => point[3]))).toEqual(new Set([0, 1]));
    for (const point of state.points) {
      expect(point[2]).toBeGreaterThanOrEqual(0);
      expect(point[2]).toBeLessThan(state.points.length);
    }
  });

  it('converts editor mask y-up coordinates to compositor y-down UVs', () => {
    const state = nativeLayerMaskState({
      mask: {
        enabled: true,
        inverted: false,
        feather: 0,
        shapes: [{
          closed: true,
          points: [
            { x: 0.1, y: 0.8 },
            { x: 0.9, y: 0.8 },
            { x: 0.5, y: 0.2 },
          ],
        }],
      },
    } as any);

    expect(state.points.map((point) => point.slice(0, 2))).toEqual([
      [0.1, 0.2],
      [0.9, 0.2],
      [0.5, 0.8],
    ]);
  });

  it('reads advertised native effect-pass descriptors from capabilities', () => {
    expect(nativeEffectPassDescriptorIds({
      native_effect_pass_descriptors: [
        { id: 'invert', code: 1 },
        { id: 'colorama', code: 40 },
        { id: 'Colorama', code: 40 },
      ],
    })).toEqual(['invert', 'colorama']);
  });

  it('maps color correction UI params to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'exposure',
      params: {
        exposureAmount: 1.25,
        exposureRollOff: 0.4,
        exposureHighlightProtect: 0.6,
      },
    })).toBe('exposure:1.2500:0.4000:0.6000');

    expect(effectToNativeDescriptor({
      type: 'vibrance',
      params: {
        vibranceAmount: 0.8,
        vibranceSkinProtect: 0.25,
        vibranceHighlightProtect: 0.45,
        vibranceCeiling: 1.2,
      },
    })).toBe('vibrance:0.8000:0.2500:0.4500:1.2000');

    expect(effectToNativeDescriptor({
      type: 'temperatureTint',
      params: {
        temperatureAmount: -0.35,
        tintAmount: 0.2,
        temperatureShadow: -0.25,
        temperatureHighlight: 0.4,
        temperatureSplitTone: 0.7,
        temperatureAutoCycle: 0.9,
      },
    })).toBe('temperature-tint:-0.3500:0.2000:-0.2500:0.4000:0.7000:0.9000');

    expect(effectToNativeDescriptor({
      type: 'colorama',
      params: {
        coloramaMix: 0.85,
        coloramaPalette: 8,
        coloramaOffset: 0.15,
        coloramaSpeed: 0.05,
        coloramaContrast: 1.2,
        coloramaBands: 4,
        coloramaAudioReact: 0.35,
        coloramaHueShift: 0.2,
        audio: 0.4,
      },
    })).toBe('colorama:0.8500:8:0.1500:0.0500:1.2000:4.0000:0.3500:0.2000:0.4000');

    expect(effectToNativeDescriptor({
      type: 'colorBalance',
      params: {
        cbMix: 0.9,
        cbShadowR: -0.18,
        cbShadowG: 0.02,
        cbShadowB: 0.24,
        cbPreserveLuma: 0.7,
        cbMidR: 0.08,
        cbMidG: 0,
        cbMidB: -0.05,
        cbHighR: 0.28,
        cbHighG: 0.12,
        cbHighB: -0.08,
      },
    })).toBe('color-balance:0.9000:-0.1800:0.0200:0.2400:0.7000:0.0800:0.0000:-0.0500:0:0.2800:0.1200:-0.0800:0');

    expect(effectToNativeDescriptor({
      type: 'liftGammaGain',
      params: {
        lggMix: 0.85,
        lggLiftR: -0.04,
        lggLiftG: 0.02,
        lggLiftB: 0.12,
        lggLumaOnly: 0,
        lggGammaR: 1.08,
        lggGammaG: 1,
        lggGammaB: 0.94,
        lggGainR: 1.18,
        lggGainG: 1.04,
        lggGainB: 0.9,
      },
    })).toBe('lift-gamma-gain:0.8500:-0.0400:0.0200:0.1200:0.0000:1.0800:1.0000:0.9400:0:1.1800:1.0400:0.9000:0');
  });

  it('rebuilds native effect-pass runtime params from color correction descriptors', () => {
    expect(nativeEffectPassFromDescriptor('exposure:1.2500:0.4000:0.6000')).toMatchObject({
      effect: 'exposure',
      amount: 1.25,
      params: {
        rollOff: 0.4,
        highlightProtect: 0.6,
      },
    });

    expect(nativeEffectPassFromDescriptor('vibrance:0.8000:0.2500:0.4500:1.2000')).toMatchObject({
      effect: 'vibrance',
      amount: 0.8,
      params: {
        skinProtect: 0.25,
        highlightProtect: 0.45,
        ceiling: 1.2,
      },
    });

    expect(nativeEffectPassFromDescriptor('temperature-tint:-0.3500:0.2000:-0.2500:0.4000:0.7000:0.9000')).toMatchObject({
      effect: 'temperature-tint',
      amount: -0.35,
      params: {
        tint: 0.2,
        shadowTemp: -0.25,
        highlightTemp: 0.4,
        splitTone: 0.7,
        autoCycle: 0.9,
      },
    });

    expect(nativeEffectPassFromDescriptor('colorama:0.8500:8:0.1500:0.0500:1.2000:4.0000:0.3500:0.2000:0.4000')).toMatchObject({
      effect: 'colorama',
      amount: 0.85,
      params: {
        coloramaPalette: 8,
        coloramaOffset: 0.15,
        coloramaSpeed: 0.05,
        coloramaContrast: 1.2,
        coloramaBands: 4,
        coloramaAudioReact: 0.35,
        coloramaHueShift: 0.2,
        audio: 0.4,
      },
    });
  });

  it('maps blur and symmetry UI params to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'directionalBlur',
      params: {
        dirBlurAmount: 0.65,
        dirBlurAngle: 45,
        dirBlurSamples: 20,
        dirBlurFalloff: 0.4,
        dirBlurCenterBias: 0.15,
        dirBlurMix: 0.8,
      },
    })).toBe('directional-blur:0.6500:45.0000:20.0000:0.4000:0.1500:0.8000');

    expect(effectToNativeDescriptor({
      type: 'zoomBlur',
      params: {
        amount: 0.7,
        amount2: 0.35,
        centerX: 0.42,
        centerY: 0.58,
        zoomBlurChromatic: 0.25,
      },
    })).toBe('zoom-blur:0.7000:0.4200:0.5800:16.0000:0.3500:0.2500:1.0000');

    expect(effectToNativeDescriptor({
      type: 'kaleidoscope',
      params: {
        kaleidoscopeSegments: 7,
        kaleidoscopeRotation: 90,
        kaleidoscopeZoom: 1.4,
        kaleidoscopeSpiral: 0.6,
        kaleidoscopeMix: 0.75,
      },
    })).toBe('kaleidoscope:0.7500:7:90.0000:0.5000:0.5000:1.4000:0:0.6000:0.0000');

    expect(effectToNativeDescriptor({
      type: 'mirror',
      params: {
        mirrorHorizontal: 1,
        mirrorVertical: 1,
        mirrorPosition: 0.45,
        mirrorOffset: 0.5,
        mirrorMix: 1,
      },
    })).toBe('mirror:1.0000:2:0.4500:0.5000:0');
  });

  it('rebuilds native effect-pass runtime params from blur and symmetry descriptors', () => {
    expect(nativeEffectPassFromDescriptor('directional-blur:0.6500:45.0000:20.0000:0.4000:0.1500:0.8000')).toMatchObject({
      effect: 'directional-blur',
      amount: 0.65,
      params: {
        angle: 45,
        samples: 20,
        falloff: 0.4,
        centerBias: 0.15,
        outputMix: 0.8,
      },
    });

    expect(nativeEffectPassFromDescriptor('radial-blur:0.5000:0.4500:0.5500:18.0000:0.2000:0.1000:0.8500:0.9000')).toMatchObject({
      effect: 'radial-blur',
      amount: 0.5,
      params: {
        centerX: 0.45,
        centerY: 0.55,
        samples: 18,
        falloff: 0.2,
        radiusInner: 0.1,
        radiusOuter: 0.85,
        outputMix: 0.9,
      },
    });

    expect(nativeEffectPassFromDescriptor('mirror:1.0000:2:0.4500:0.5000:0')).toMatchObject({
      effect: 'mirror',
      amount: 1,
      params: {
        mode: 2,
        position: 0.45,
        offset: 0.5,
        flipSide: 0,
      },
    });
  });

  it('maps distortion UI params to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'wave',
      params: {
        waveType: 2,
        waveWaveform: 1,
        waveAmplitude: 18,
        waveFrequency: 12,
        waveSpeed: 1.4,
        wavePhase: 90,
        waveSecondary: 0.4,
        waveChromaSplit: 0.7,
      },
    })).toBe('wave:18.0000:2:1:12.0000:1.4000:90.0000:0.4000:0.7000');

    expect(effectToNativeDescriptor({
      type: 'fisheye',
      params: {
        fisheyeMode: 1,
        fisheyeStrength: 0.65,
        fisheyeRadius: 0.85,
        fisheyeCenterX: 0.62,
        fisheyeCenterY: 0.38,
        fisheyeZoom: 1.1,
        fisheyeChromaEdge: 0.45,
      },
    })).toBe('fisheye:0.6500:0.8500:0.6200:0.3800:1.1000:1:0.4500');

    expect(effectToNativeDescriptor({
      type: 'lensDistortion',
      params: {
        lensDistMode: 3,
        lensDistAmount: 0.7,
        lensDistCenterX: 0.45,
        lensDistCenterY: 0.55,
        lensDistCubic: -0.2,
        lensDistAnamorphicX: 1.7,
        lensDistEdgeFade: 0.8,
        lensDistChromaFringe: 0.3,
      },
    })).toBe('lens-distortion:0.7000:3:0.4500:0.5500:-0.2000:1.7000:0.8000:0.3000');

    expect(effectToNativeDescriptor({
      type: 'twirl',
      params: {
        twirlAngle: 2.5,
        twirlRadius: 0.75,
        twirlCenterX: 0.48,
        twirlCenterY: 0.52,
        twirlFalloff: 1.2,
        twirlAnimSpeed: 0.3,
        twirlMix: 0.9,
      },
    })).toBe('twirl:2.5000:0.7500:0.4800:0.5200:1.2000:0.3000:0.9000');

    expect(effectToNativeDescriptor({
      type: 'pinchBulge',
      params: {
        pinchAmount: -0.55,
        pinchRadius: 0.5,
        pinchCenterX: 0.6,
        pinchCenterY: 0.4,
        pinchFalloff: 1.5,
        pinchChromatic: 0.25,
        pinchMix: 0.8,
      },
    })).toBe('pinch-bulge:-0.5500:0.5000:0.6000:0.4000:1.5000:0.2500:0.8000');
  });

  it('rebuilds native effect-pass runtime params from distortion descriptors', () => {
    expect(nativeEffectPassFromDescriptor('wave:18.0000:2:1:12.0000:1.4000:90.0000:0.4000:0.7000')).toMatchObject({
      effect: 'wave',
      amount: 18,
      params: {
        mode: 2,
        waveform: 1,
        frequency: 12,
        speed: 1.4,
        phase: 90,
        secondary: 0.4,
        chromaSplit: 0.7,
      },
    });

    expect(nativeEffectPassFromDescriptor('fisheye:0.6500:0.8500:0.6200:0.3800:1.1000:1:0.4500')).toMatchObject({
      effect: 'fisheye',
      amount: 0.65,
      params: {
        radius: 0.85,
        centerX: 0.62,
        centerY: 0.38,
        zoom: 1.1,
        mode: 1,
        edgeFalloff: 0.45,
      },
    });

    expect(nativeEffectPassFromDescriptor('lens-distortion:0.7000:3:0.4500:0.5500:-0.2000:1.7000:0.8000:0.3000')).toMatchObject({
      effect: 'lens-distortion',
      amount: 0.7,
      params: {
        mode: 3,
        centerX: 0.45,
        centerY: 0.55,
        cubic: -0.2,
        anamorphicX: 1.7,
        edgeFade: 0.8,
        chromatic: 0.3,
      },
    });

    expect(nativeEffectPassFromDescriptor('twirl:2.5000:0.7500:0.4800:0.5200:1.2000:0.3000:0.9000')).toMatchObject({
      effect: 'twirl',
      amount: 2.5,
      params: {
        radius: 0.75,
        centerX: 0.48,
        centerY: 0.52,
        falloff: 1.2,
        animSpeed: 0.3,
        outputMix: 0.9,
      },
    });

    expect(nativeEffectPassFromDescriptor('pinch-bulge:-0.5500:0.5000:0.6000:0.4000:1.5000:0.2500:0.8000')).toMatchObject({
      effect: 'pinch-bulge',
      amount: -0.55,
      params: {
        radius: 0.5,
        centerX: 0.6,
        centerY: 0.4,
        falloff: 1.5,
        chromatic: 0.25,
        outputMix: 0.8,
      },
    });
  });

  it('maps keying UI params to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'chromaKey',
      params: {
        chromaKeyR: 0,
        chromaKeyG: 0.9,
        chromaKeyB: 0.1,
        chromaKeyTolerance: 0.22,
        chromaKeySoftness: 0.12,
        chromaKeySpill: 0.7,
        chromaKeyMatte: 1,
        chromaKeyMode: 2,
      },
    })).toBe('chroma-key:0.2200:0.0000:0.9000:0.1000:0.1200:0.7000:1:2');

    expect(effectToNativeDescriptor({
      type: 'lumaKey',
      params: {
        lumaKeyLowCut: 0.35,
        lumaKeyHighCut: 0.8,
        lumaKeyInvert: 1,
        lumaKeyGamma: 0.7,
        lumaKeyMatte: 0,
        lumaKeyPremultiply: 1,
      },
    })).toBe('luma-key:0.3500:0.8000:1:0.7000:0:1');

    expect(effectToNativeDescriptor({
      type: 'differenceKey',
      params: {
        diffKeyR: 0.2,
        diffKeyG: 0.3,
        diffKeyB: 0.4,
        diffKeyTolerance: 0.18,
        diffKeySoftness: 0.09,
        diffKeyInvert: 0,
        diffKeyMatte: 1,
        diffKeyMode: 1,
      },
    })).toBe('difference-key:0.1800:0.2000:0.3000:0.4000:0.0900:0:1:1');

    expect(effectToNativeDescriptor({
      type: 'erode',
      params: {
        erodeRadius: 4,
        erodeShape: 2,
        erodeChannel: 4,
        erodeMix: 0.65,
      },
    })).toBe('erode:4.0000:2:4:0.6500');
  });

  it('rebuilds native effect-pass runtime params from keying descriptors', () => {
    expect(nativeEffectPassFromDescriptor('chroma-key:0.2200:0.0000:0.9000:0.1000:0.1200:0.7000:1:2')).toMatchObject({
      effect: 'chroma-key',
      amount: 0.22,
      params: {
        keyR: 0,
        keyG: 0.9,
        keyB: 0.1,
        softness: 0.12,
        spill: 0.7,
        matte: 1,
        mode: 2,
      },
    });

    expect(nativeEffectPassFromDescriptor('luma-key:0.3500:0.8000:1:0.7000:0:1')).toMatchObject({
      effect: 'luma-key',
      amount: 0.35,
      params: {
        highCut: 0.8,
        invert: 1,
        gamma: 0.7,
        matte: 0,
        premultiply: 1,
      },
    });

    expect(nativeEffectPassFromDescriptor('dilate:5.0000:1:0:0.7500')).toMatchObject({
      effect: 'dilate',
      amount: 5,
      params: {
        shape: 1,
        channel: 0,
        outputMix: 0.75,
      },
    });
  });

  it('maps edge detection UI params to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'edgeDetect',
      params: {
        edgeThreshold: 0.18,
        edgeThickness: 2.5,
        edgeMode: 1,
        edgeInvert: 1,
        edgeTintR: 0.1,
        edgeTintG: 0.8,
        edgeTintB: 1,
        edgeTintEdges: 1,
        edgeGlow: 0.6,
        edgeOnlyAlpha: 1,
      },
    })).toBe('edge-detect:0.1800:2.5000:1:3:0.1000:0.8000:1.0000:1.0000:0.6000');
  });

  it('rebuilds native effect-pass runtime params from edge detection descriptors', () => {
    expect(nativeEffectPassFromDescriptor('edge-detect:0.1800:2.5000:1:3:0.1000:0.8000:1.0000:1.0000:0.6000')).toMatchObject({
      effect: 'edge-detect',
      amount: 0.18,
      params: {
        thickness: 2.5,
        mode: 1,
        invert: 1,
        edgeOnlyAlpha: 1,
        edgeTintR: 0.1,
        edgeTintG: 0.8,
        edgeTintB: 1,
        tintEdges: 1,
        edgeGlow: 0.6,
      },
    });
  });

  it('maps film grain UI params to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'filmGrain',
      params: {
        grainAmount: 0.45,
        grainSize: 1.25,
        grainShadow: 0.8,
        grainMid: 1.1,
        grainHigh: 0.6,
        grainMono: 0,
        grainStock: 2,
        grainColorJitter: 0.35,
        grainAnimSpeed: 1.5,
      },
    })).toBe('film-grain:0.4500:1.2500:0.8000:1.1000:0.6000:0:2:0.3500:1.5000');
  });

  it('rebuilds native effect-pass runtime params from film grain descriptors', () => {
    expect(nativeEffectPassFromDescriptor('film-grain:0.4500:1.2500:0.8000:1.1000:0.6000:0:2:0.3500:1.5000')).toMatchObject({
      effect: 'film-grain',
      amount: 0.45,
      params: {
        grainSize: 1.25,
        grainShadow: 0.8,
        grainMid: 1.1,
        grainHigh: 0.6,
        grainMono: 0,
        grainStock: 2,
        grainColorJitter: 0.35,
        grainAnimSpeed: 1.5,
      },
    });
  });

  it('maps filmic tonemap UI params to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'filmicTonemap',
      params: {
        tonemapMix: 0.8,
        tonemapCurve: 4,
        tonemapExposure: 1.35,
        tonemapContrast: 0.45,
      },
    })).toBe('filmic-tonemap:0.8000:4:1.3500:0.4500');
  });

  it('rebuilds native effect-pass runtime params from filmic tonemap descriptors', () => {
    expect(nativeEffectPassFromDescriptor('filmic-tonemap:0.8000:4:1.3500:0.4500')).toMatchObject({
      effect: 'filmic-tonemap',
      amount: 0.8,
      params: {
        tonemapCurve: 4,
        tonemapExposure: 1.35,
        tonemapContrast: 0.45,
      },
    });
  });

  it('maps bloom UI params to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'bloom',
      params: {
        amount: 0.7,
        bloomIntensity: 1.3,
        threshold: 0.55,
        bloomKnee: 0.45,
        bloomRadius: 0.8,
        bloomAnamorphic: 0.25,
        red: 1,
        green: 0.7,
        blue: 0.4,
      },
    })).toBe('bloom:0.7000:1.3000:0.5500:0.4500:0.8000:0.2500:1.0000:0.7000:0.4000');
  });

  it('rebuilds native effect-pass runtime params from bloom descriptors', () => {
    expect(nativeEffectPassFromDescriptor('bloom:0.7000:1.3000:0.5500:0.4500:0.8000:0.2500:1.0000:0.7000:0.4000')).toMatchObject({
      effect: 'bloom',
      amount: 0.7,
      params: {
        bloomIntensity: 1.3,
        threshold: 0.55,
        bloomKnee: 0.45,
        bloomRadius: 0.8,
        bloomAnamorphic: 0.25,
        red: 1,
        green: 0.7,
        blue: 0.4,
      },
    });
  });

  it('maps hero UI effects to native effect-pass descriptors', () => {
    expect(effectToNativeDescriptor({
      type: 'edgeFeather',
      params: {
        featherTop: 0.1,
        featherBottom: 0.2,
        featherLeft: 0.3,
        featherRight: 0.4,
        featherSoftness: 0.6,
        featherGamma: 1.2,
        featherMattePreview: 1,
      },
    })).toBe('edge-feather:1.0000:0.1000:0.2000:0.3000:0.4000:0.6000:1.2000:1');

    expect(effectToNativeDescriptor({
      type: 'outline',
      params: {
        outlineThickness: 4,
        outlineColor: [0.1, 0.8, 1],
        outlineOnly: 1,
        outlineGlow: 0.7,
        outlinePosition: 2,
        outlineCrawl: 0.5,
        outlineAlphaAware: 1,
      },
    })).toBe('outline:4.0000:0.1000:0.8000:1.0000:1:0.7000:2:0.5000:1:1.0000');

    expect(effectToNativeDescriptor({
      type: 'nightVision',
      params: {
        nightVisionIntensity: 1.7,
        nightVisionNoise: 0.25,
        nightVisionVignette: 0.6,
        nightVisionPhosphor: 2,
        nightVisionBloom: 1.1,
        nightVisionScopeMask: 2,
        nightVisionRollingNoise: 0.4,
      },
    })).toBe('night-vision:1.7000:0.2500:0.6000:2:1.1000:2:0.4000');

    expect(effectToNativeDescriptor({
      type: 'tiltShift',
      params: {
        tiltShiftMode: 2,
        tiltShiftFocusY: 0.45,
        tiltShiftFocusX: 0.55,
        tiltShiftFocusBand: 0.18,
        tiltShiftFalloff: 0.32,
        tiltShiftMaxBlur: 0.7,
        tiltShiftAngle: 25,
        tiltShiftSaturation: 1.35,
      },
    })).toBe('tilt-shift:1.0000:2:0.4500:0.5500:0.1800:0.3200:0.7000:25.0000:1.3500');

    expect(effectToNativeDescriptor({
      type: 'halation',
      params: {
        halationAmount: 1.1,
        halationRadius: 18,
        halationThreshold: 0.52,
        halationTintR: 0.95,
        halationTintG: 0.5,
        halationTintB: 0.25,
        halationMode: 1,
        halationMix: 0.8,
      },
    })).toBe('halation:1.1000:18.0000:0.5200:0.9500:0.5000:0.2500:1:0.8000');

    expect(effectToNativeDescriptor({
      type: 'anamorphicStreak',
      params: {
        anaIntensity: 0.9,
        anaLength: 0.42,
        anaThreshold: 0.68,
        anaTintR: 0.65,
        anaTintG: 0.78,
        anaTintB: 1.1,
        anaAngle: 8,
        anaSamples: 40,
        anaMix: 0.75,
      },
    })).toBe('anamorphic-streak:0.9000:0.4200:0.6800:0.6500:0.7800:1.1000:8.0000:40.0000:0.7500');

    expect(effectToNativeDescriptor({
      type: 'heatHaze',
      params: {
        hazeAmount: 0.44,
        hazeScale: 9,
        hazeSpeed: 1.2,
        hazeDirectionY: 0.35,
        hazeTurbulence: 0.55,
        hazeMode: 1,
        hazeFocusY: 0.48,
        hazeFocusBand: 0.37,
      },
    })).toBe('heat-haze:0.4400:9.0000:1.2000:0.3500:0.5500:1:0.4800:0.3700');

    expect(effectToNativeDescriptor({
      type: 'curves',
      params: {
        curvesMix: 0.9,
        curvesContrast: 0.7,
        curvesToe: 0.25,
        curvesShoulder: 0.35,
        curvesBlackCrush: 0.15,
      },
    })).toBe('curves:0.9000:0.7000:0.2500:0.3500:0.1500');

    expect(effectToNativeDescriptor({
      type: 'selectiveColor',
      params: {
        selColorTargetHue: 0.08,
        selColorRange: 0.16,
        selColorFeather: 0.07,
        selColorMode: 1,
        selColorReplaceHue: 0.58,
        selColorSatBoost: 0.4,
      },
    })).toBe('selective-color:1.0000:0.0800:0.1600:0.0700:1:0.5800:0.4000');

    expect(effectToNativeDescriptor({
      type: 'falseColor',
      params: {
        falseColorMode: 2,
        falseColorMix: 0.85,
        falseColorShowOriginal: 0.75,
        falseColorMidpoint: 0.52,
        falseColorRange: 0.1,
      },
    })).toBe('false-color:0.8500:2:0.7500:0.5200:0.1000');

    expect(effectToNativeDescriptor({
      type: 'shadowRecovery',
      params: {
        shadowAmount: 0.6,
        shadowThreshold: 0.42,
        shadowSoftness: 0.33,
        shadowColorRecovery: 0.42,
        shadowHighlightProtect: 0.62,
        shadowMix: 0.9,
      },
    })).toBe('shadow-recovery:0.6000:0.4200:0.3300:0.4200:0.6200:0.9000');

    expect(effectToNativeDescriptor({
      type: 'highlightRolloff',
      params: {
        highRolloffAmount: 0.6,
        highRolloffThreshold: 0.72,
        highRolloffSoftness: 0.21,
        highRolloffPreserveHue: 0.8,
        highRolloffMaxValue: 1.05,
        highRolloffMix: 0.85,
      },
    })).toBe('highlight-rolloff:0.6000:0.7200:0.2100:0.8000:1.0500:0.8500');

    expect(effectToNativeDescriptor({
      type: 'strobeFlash',
      params: {
        strobeIntensity: 0.88,
        strobeRate: 4,
        strobeDuty: 0.52,
        strobeMode: 2,
        strobeTintR: 0.18,
        strobeTintG: 0.85,
        strobeTintB: 1,
      },
    })).toBe('strobe-flash:0.8800:4.0000:0.5200:2:0.1800:0.8500:1.0000');

    expect(effectToNativeDescriptor({
      type: 'fmScanlines',
      params: {
        fmLinesMode: 2,
        fmLinesCount: 180,
        fmLinesWidth: 0.4,
        fmLinesFreq: 0.2,
        fmLinesFmDepth: 0.7,
        fmLinesAmp: 0.8,
        fmLinesSpeed: 1.1,
        fmLinesColorMix: 0.35,
        fmLinesInvert: 1,
      },
    })).toBe('fm-scanlines:1.0000:2:180.0000:0.4000:0.2000:0.7000:0.8000:1.1000:0.3500:1');

    expect(effectToNativeDescriptor({
      type: 'vhs',
      params: {
        vhsTracking: 0.45,
        vhsNoise: 0.2,
        vhsDistortion: 0.3,
        vhsColorBleed: 0.55,
        vhsScanlines: 0.35,
        vhsHeadSwitch: 0.4,
        vhsTapeWobble: 0.25,
        vhsDropout: 0.1,
        vhsChromaDelay: 0.45,
        vhsTrackingJump: 0.1,
        vhsSaturation: 0.7,
      },
    })).toBe('vhs:1.0000:0.4500:0.2000:0.3000:0.5500:0.3500:0.4000:0.2500:0.1000:0.4500:0.1000:0.7000');

    expect(effectToNativeDescriptor({
      type: 'plasma',
      params: {
        plasmaMix: 0.9,
        plasmaScale: 4.5,
        plasmaSpeed: 0.8,
        plasmaPalette: 8,
        plasmaSourceMix: 0.35,
      },
    })).toBe('plasma:0.9000:4.5000:0.8000:8:0.3500:3:0:0:0.4000:0.0000');

    expect(effectToNativeDescriptor({
      type: 'halftone',
      params: {
        halftoneMix: 1,
        halftoneScale: 9,
        halftoneAngle: 24,
        halftoneDotGain: 1.1,
        halftoneColorMode: 0,
      },
    })).toBe('halftone:1.0000:9.0000:24.0000:1.1000:0.0000:0:0:15.0000:75.0000:0.0000:45.0000:0.0000');

    expect(effectToNativeDescriptor({
      type: 'toon',
      params: {
        toonMix: 0.95,
        toonLevels: 3,
        toonEdgeStrength: 1.2,
        toonSaturation: 1.2,
        toonEdgeThreshold: 0.02,
      },
    })).toBe('toon:0.9500:3:1.2000:1.2000:0.0200:0.0000:0.0000');

    expect(effectToNativeDescriptor({
      type: 'kuwahara',
      params: {
        kuwaharaMix: 0.88,
        kuwaharaRadius: 4,
        kuwaharaEdgeSharpness: 0.42,
        kuwaharaColorPunch: 0.35,
      },
    })).toBe('kuwahara:0.8800:4.0000:0.4200:0.3500');

    expect(effectToNativeDescriptor({
      type: 'defocusBokeh',
      params: {
        bokehRadius: 14,
        bokehSamples: 32,
        bokehBrightWeight: 1.1,
        bokehThreshold: 0.62,
        bokehChromaFringe: 0.25,
        bokehShape: 1,
        bokehRotation: 35,
        bokehMix: 0.75,
      },
    })).toBe('defocus-bokeh:14.0000:32.0000:1.1000:0.6200:0.2500:1:35.0000:0.7500');

    expect(effectToNativeDescriptor({
      type: 'godRays',
      params: {
        godRaysIntensity: 0.85,
        godRaysDecay: 0.97,
        godRaysExposure: 0.45,
        godRaysDensity: 0.88,
        godRaysThreshold: 0.55,
        godRaysCenterX: 0.42,
        godRaysCenterY: 0.12,
        godRaysSamples: 96,
        godRaysTintR: 1,
        godRaysTintG: 0.84,
        godRaysTintB: 0.62,
        godRaysMix: 0.9,
      },
    })).toBe('god-rays:0.8500:0.9700:0.4500:0.8800:0.5500:0.4200:0.1200:96.0000:1.0000:0.8400:0.6200:0.9000');

    expect(effectToNativeDescriptor({
      type: 'displacement',
      params: {
        dispAmount: 0.45,
        dispScale: 7.5,
        dispSpeed: 1.25,
        dispMode: 3,
        dispTurbulence: 0.66,
        dispChromatic: 0.4,
      },
    })).toBe('displacement:0.4500:7.5000:1.2500:3:0.6600:0.4000');

    expect(effectToNativeDescriptor({
      type: 'polarTransform',
      params: {
        polarMix: 0.82,
        polarMode: 2,
        polarRotation: 41,
        polarZoom: 1.35,
        polarCenterX: 0.62,
        polarCenterY: 0.47,
      },
    })).toBe('polar-transform:0.8200:2:41.0000:1.3500:0.6200:0.4700');
  });

  it('rebuilds native effect-pass runtime params from hero effect descriptors', () => {
    expect(nativeEffectPassFromDescriptor('dither:0.7500:3:2.0000:4.0000:2:1')).toMatchObject({
      effect: 'dither',
      amount: 0.75,
      params: {
        ditherType: 3,
        ditherScale: 2,
        ditherColorDepth: 4,
        ditherPalette: 2,
        ditherPixelLock: 1,
      },
    });

    expect(nativeEffectPassFromDescriptor('emboss:1.2000:135.0000:0.8000:1.0000:0.9000:0.7000:0.1000:0.2000:0.3000')).toMatchObject({
      effect: 'emboss',
      amount: 1.2,
      params: {
        embossAngle: 135,
        embossHeight: 0.8,
        embossHighlightR: 1,
        embossHighlightG: 0.9,
        embossHighlightB: 0.7,
        embossShadowR: 0.1,
        embossShadowG: 0.2,
        embossShadowB: 0.3,
      },
    });

    expect(nativeEffectPassFromDescriptor('crt:0.6000:720.0000:0.8000:2:0.4000:0.5000:0.7000:0.2000:0.3500')).toMatchObject({
      effect: 'crt',
      amount: 0.6,
      params: {
        crtScanCount: 720,
        crtMask: 0.8,
        crtMaskType: 2,
        crtCurvature: 0.4,
        crtVignette: 0.5,
        crtGlow: 0.7,
        crtRollingBar: 0.2,
        crtChromatic: 0.35,
      },
    });

    expect(nativeEffectPassFromDescriptor('fm-scanlines:1.0000:2:180.0000:0.4000:0.2000:0.7000:0.8000:1.1000:0.3500:1')).toMatchObject({
      effect: 'fm-scanlines',
      amount: 1,
      params: {
        mode: 2,
        count: 180,
        width: 0.4,
        freq: 0.2,
        fmDepth: 0.7,
        amp: 0.8,
        speed: 1.1,
        colorMix: 0.35,
        invert: 1,
      },
    });

    expect(nativeEffectPassFromDescriptor('vhs:1.0000:0.4500:0.2000:0.3000:0.5500:0.3500:0.4000:0.2500:0.1000:0.4500:0.1000:0.7000')).toMatchObject({
      effect: 'vhs',
      amount: 1,
      params: {
        tracking: 0.45,
        noise: 0.2,
        distortion: 0.3,
        colorBleed: 0.55,
        scanlines: 0.35,
        headSwitch: 0.4,
        tapeWobble: 0.25,
        dropout: 0.1,
        chromaDelay: 0.45,
        trackingJump: 0.1,
        saturation: 0.7,
      },
    });

    expect(nativeEffectPassFromDescriptor('plasma:0.9000:4.5000:0.8000:8:0.3500')).toMatchObject({
      effect: 'plasma',
      amount: 0.9,
      params: {
        plasmaScale: 4.5,
        plasmaSpeed: 0.8,
        plasmaPalette: 8,
        plasmaSourceMix: 0.35,
      },
    });

    expect(nativeEffectPassFromDescriptor('halftone:1.0000:9.0000:24.0000:1.1000:0.0000')).toMatchObject({
      effect: 'halftone',
      amount: 1,
      params: {
        halftoneScale: 9,
        halftoneAngle: 24,
        halftoneDotGain: 1.1,
        halftoneColorMode: 0,
      },
    });

    expect(nativeEffectPassFromDescriptor('toon:0.9500:3:1.2000:1.2000:0.0200')).toMatchObject({
      effect: 'toon',
      amount: 0.95,
      params: {
        toonLevels: 3,
        toonEdgeStrength: 1.2,
        toonSaturation: 1.2,
        toonEdgeThreshold: 0.02,
      },
    });

    expect(nativeEffectPassFromDescriptor('kuwahara:0.8800:4.0000:0.4200:0.3500')).toMatchObject({
      effect: 'kuwahara',
      amount: 0.88,
      params: {
        kuwaharaRadius: 4,
        kuwaharaEdgeSharpness: 0.42,
        kuwaharaColorPunch: 0.35,
      },
    });

    expect(nativeEffectPassFromDescriptor('defocus-bokeh:14.0000:32.0000:1.1000:0.6200:0.2500:1:35.0000:0.7500')).toMatchObject({
      effect: 'defocus-bokeh',
      amount: 14,
      params: {
        bokehSamples: 32,
        bokehBrightWeight: 1.1,
        bokehThreshold: 0.62,
        bokehChromaFringe: 0.25,
        bokehShape: 1,
        bokehRotation: 35,
        bokehMix: 0.75,
      },
    });

    expect(nativeEffectPassFromDescriptor('god-rays:0.8500:0.9700:0.4500:0.8800:0.5500:0.4200:0.1200:96.0000:1.0000:0.8400:0.6200:0.9000')).toMatchObject({
      effect: 'god-rays',
      amount: 0.85,
      params: {
        godRaysDecay: 0.97,
        godRaysExposure: 0.45,
        godRaysDensity: 0.88,
        godRaysThreshold: 0.55,
        godRaysCenterX: 0.42,
        godRaysCenterY: 0.12,
        godRaysSamples: 96,
        godRaysTintR: 1,
        godRaysTintG: 0.84,
        godRaysTintB: 0.62,
        godRaysMix: 0.9,
      },
    });

    expect(nativeEffectPassFromDescriptor('displacement:0.4500:7.5000:1.2500:3:0.6600:0.4000')).toMatchObject({
      effect: 'displacement',
      amount: 0.45,
      params: {
        dispScale: 7.5,
        dispSpeed: 1.25,
        dispMode: 3,
        dispTurbulence: 0.66,
        dispChromatic: 0.4,
      },
    });

    expect(nativeEffectPassFromDescriptor('polar-transform:0.8200:2:41.0000:1.3500:0.6200:0.4700')).toMatchObject({
      effect: 'polar-transform',
      amount: 0.82,
      params: {
        polarMode: 2,
        polarRotation: 41,
        polarZoom: 1.35,
        polarCenterX: 0.62,
        polarCenterY: 0.47,
      },
    });

    expect(nativeEffectPassFromDescriptor('thermal:1.4000:3:0.5000:0.2500')).toMatchObject({
      effect: 'thermal',
      amount: 1.4,
      params: {
        thermalPalette: 3,
        thermalShimmer: 0.5,
        thermalSensorNoise: 0.25,
      },
    });

    expect(nativeEffectPassFromDescriptor('tilt-shift:1.0000:2:0.4500:0.5500:0.1800:0.3200:0.7000:25.0000:1.3500')).toMatchObject({
      effect: 'tilt-shift',
      amount: 1,
      params: {
        tiltShiftMode: 2,
        tiltShiftFocusY: 0.45,
        tiltShiftFocusX: 0.55,
        tiltShiftFocusBand: 0.18,
        tiltShiftFalloff: 0.32,
        tiltShiftMaxBlur: 0.7,
        tiltShiftAngle: 25,
        tiltShiftSaturation: 1.35,
      },
    });

    expect(nativeEffectPassFromDescriptor('halation:1.1000:18.0000:0.5200:0.9500:0.5000:0.2500:1:0.8000')).toMatchObject({
      effect: 'halation',
      amount: 1.1,
      params: {
        halationRadius: 18,
        halationThreshold: 0.52,
        halationTintR: 0.95,
        halationTintG: 0.5,
        halationTintB: 0.25,
        halationMode: 1,
        halationMix: 0.8,
      },
    });

    expect(nativeEffectPassFromDescriptor('anamorphic-streak:0.9000:0.4200:0.6800:0.6500:0.7800:1.1000:8.0000:40.0000:0.7500')).toMatchObject({
      effect: 'anamorphic-streak',
      amount: 0.9,
      params: {
        anaLength: 0.42,
        anaThreshold: 0.68,
        anaTintR: 0.65,
        anaTintG: 0.78,
        anaTintB: 1.1,
        anaAngle: 8,
        anaSamples: 40,
        anaMix: 0.75,
      },
    });

    expect(nativeEffectPassFromDescriptor('heat-haze:0.4400:9.0000:1.2000:0.3500:0.5500:1:0.4800:0.3700')).toMatchObject({
      effect: 'heat-haze',
      amount: 0.44,
      params: {
        hazeScale: 9,
        hazeSpeed: 1.2,
        hazeDirectionY: 0.35,
        hazeTurbulence: 0.55,
        hazeMode: 1,
        hazeFocusY: 0.48,
        hazeFocusBand: 0.37,
      },
    });

    expect(nativeEffectPassFromDescriptor('curves:0.9000:0.7000:0.2500:0.3500:0.1500')).toMatchObject({
      effect: 'curves',
      amount: 0.9,
      params: {
        curvesContrast: 0.7,
        curvesToe: 0.25,
        curvesShoulder: 0.35,
        curvesBlackCrush: 0.15,
      },
    });

    expect(nativeEffectPassFromDescriptor('selective-color:1.0000:0.0800:0.1600:0.0700:1:0.5800:0.4000')).toMatchObject({
      effect: 'selective-color',
      amount: 1,
      params: {
        selColorTargetHue: 0.08,
        selColorRange: 0.16,
        selColorFeather: 0.07,
        selColorMode: 1,
        selColorReplaceHue: 0.58,
        selColorSatBoost: 0.4,
      },
    });

    expect(nativeEffectPassFromDescriptor('false-color:0.8500:2:0.7500:0.5200:0.1000')).toMatchObject({
      effect: 'false-color',
      amount: 0.85,
      params: {
        falseColorMode: 2,
        falseColorShowOriginal: 0.75,
        falseColorMidpoint: 0.52,
        falseColorRange: 0.1,
      },
    });

    expect(nativeEffectPassFromDescriptor('shadow-recovery:0.6000:0.4200:0.3300:0.4200:0.6200:0.9000')).toMatchObject({
      effect: 'shadow-recovery',
      amount: 0.6,
      params: {
        shadowThreshold: 0.42,
        shadowSoftness: 0.33,
        shadowColorRecovery: 0.42,
        shadowHighlightProtect: 0.62,
        shadowMix: 0.9,
      },
    });

    expect(nativeEffectPassFromDescriptor('highlight-rolloff:0.6000:0.7200:0.2100:0.8000:1.0500:0.8500')).toMatchObject({
      effect: 'highlight-rolloff',
      amount: 0.6,
      params: {
        highRolloffThreshold: 0.72,
        highRolloffSoftness: 0.21,
        highRolloffPreserveHue: 0.8,
        highRolloffMaxValue: 1.05,
        highRolloffMix: 0.85,
      },
    });

    expect(nativeEffectPassFromDescriptor('color-balance:0.9000:-0.1800:0.0200:0.2400:0.7000:0.0800:0.0000:-0.0500:0:0.2800:0.1200:-0.0800:0')).toMatchObject({
      effect: 'color-balance',
      amount: 0.9,
      params: {
        cbShadowR: -0.18,
        cbShadowG: 0.02,
        cbShadowB: 0.24,
        cbPreserveLuma: 0.7,
        cbMidR: 0.08,
        cbMidG: 0,
        cbMidB: -0.05,
        cbHighR: 0.28,
        cbHighG: 0.12,
        cbHighB: -0.08,
      },
    });

    expect(nativeEffectPassFromDescriptor('lift-gamma-gain:0.8500:-0.0400:0.0200:0.1200:0.0000:1.0800:1.0000:0.9400:0:1.1800:1.0400:0.9000:0')).toMatchObject({
      effect: 'lift-gamma-gain',
      amount: 0.85,
      params: {
        lggLiftR: -0.04,
        lggLiftG: 0.02,
        lggLiftB: 0.12,
        lggLumaOnly: 0,
        lggGammaR: 1.08,
        lggGammaG: 1,
        lggGammaB: 0.94,
        lggGainR: 1.18,
        lggGainG: 1.04,
        lggGainB: 0.9,
      },
    });
    expect(nativeEffectPassFromDescriptor('strobe-flash:0.8800:4.0000:0.5200:2:0.1800:0.8500:1.0000')).toMatchObject({
      effect: 'strobe-flash',
      amount: 0.88,
      params: {
        strobeRate: 4,
        strobeDuty: 0.52,
        strobeMode: 2,
        strobeTintR: 0.18,
        strobeTintG: 0.85,
        strobeTintB: 1,
      },
    });
  });
});

describe('generic passthru effect routing', () => {
  it('routes manifest-covered effects without explicit descriptor branches', () => {
    const cases = [
      { type: 'dotMatrix', enabled: true, params: { dotMatrixCellSize: 8 } },
      { type: 'explode3D', enabled: true, params: { amount: 0.5, amount2: 0.2 } },
      { type: 'oilPaint', enabled: true, params: {} },
      { type: 'phaseLab', enabled: true, params: { phaseLabMode: 1, phaseLabIntensity: 2 } },
      { type: 'wormhole', enabled: true, params: { wormholePullStrength: 0.8 } },
      { type: 'motionTrails', enabled: true, params: { motionTrailsLength: 0.6 } },
    ];
    for (const c of cases) {
      const d = effectToNativeDescriptor(c);
      expect(d, c.type).toBeTruthy();
      expect(d, c.type).toContain('passthru:');
      const rt = nativeEffectPassFromDescriptor(d);
      expect(rt, c.type).toBeTruthy();
    }
    const rt = nativeEffectPassFromDescriptor(effectToNativeDescriptor(cases[3]));
    expect(rt?.effect).toBe('phase-lab');
    expect((rt?.params as any)?.phaseLabIntensity).toBe(2);
    expect((rt?.params as any)?.phaseLabMode).toBe(1);
  });

  it('keeps explicit branches for legacy effects and rejects stateful ones', () => {
    expect(effectToNativeDescriptor({ type: 'invert', enabled: true, params: {} }))
      .toBe('invert:1.0000:0:0.5000:4.0000');
    expect(effectToNativeDescriptor({ type: 'gpuFluidSim', enabled: true, params: {} })).toBeNull();
    expect(nativeUnsupportedEffectTypes({ effects: [
      { type: 'dotMatrix', enabled: true, params: {} },
      { type: 'gpuFluidSim', enabled: true, params: {} },
    ] })).toEqual(['gpuFluidSim']);
  });
});
