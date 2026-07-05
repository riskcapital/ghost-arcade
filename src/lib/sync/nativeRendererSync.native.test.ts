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
  });
});
