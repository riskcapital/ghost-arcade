import { beforeAll, describe, expect, it } from 'vitest';
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
let buildNativeSharedTextureSourceFrameCommand: typeof import('./nativeRendererSync').buildNativeSharedTextureSourceFrameCommand;
let NativeRendererSyncCtor: typeof import('./nativeRendererSync').NativeRendererSync;

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
    buildNativeSharedTextureSourceFrameCommand,
    NativeRendererSync: NativeRendererSyncCtor,
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

    const missingPointSort = graphCapabilities();
    missingPointSort.native_graph_instrument_manifest = missingPointSort.native_graph_instrument_manifest.map((entry) =>
      entry.id === 'point-cloud-fx'
        ? { ...entry, shader_ids: entry.shader_ids.filter((shaderId) => shaderId !== 'point-cloud-fx/sort-step') }
        : entry,
    );
    expect(
      missingNativeGraphRouteRequirements(
        missingPointSort.features,
        new Set(nativeGraphInstrumentIds(missingPointSort)),
        nativeGraphManifestById(missingPointSort),
      ),
    ).toContain('point-cloud-fx:shader:point-cloud-fx/sort-step');
    const pointMissingRoutes = nativeGraphReadyRouteKinds(
      missingPointSort.features,
      new Set(nativeGraphInstrumentIds(missingPointSort)),
      nativeGraphManifestById(missingPointSort),
    );
    expect(pointMissingRoutes.has('smoke-3d')).toBe(true);
    expect(pointMissingRoutes.has('point-cloud-fx')).toBe(false);
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
    expect(sync.nativeVideoPlaybackTimeSeconds({ videoElement: { currentTime: Number.NaN } }, 2500)).toBe(1.5);
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
});

describe('native renderer sync graph effect routing', () => {
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

    sync.nativeEffectPassDescriptorIds = new Set(['blur']);
    const withoutDescriptor = sync.nativeGraphRouteForLayer(layer);
    expect(withoutDescriptor?.source.id).toBe('gpu:gpu-layer-a:planet');
    expect(withoutDescriptor?.effectPasses).toBeUndefined();
  });
});

describe('native renderer sync native video pump routing', () => {
  it('marks native-pump video frames ready and rolls back to preview fallback on decode failure', () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeFeatureFlags = {
      native_video_decode_pump: true,
      native_video_frame_decode: true,
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
});

describe('native renderer sync effect-pass descriptors', () => {
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
    })).toBe('outline:4.0000:0.1000:0.8000:1.0000:1:0.7000:2:0.5000:1');

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
  });
});
