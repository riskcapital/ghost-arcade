import { beforeAll, describe, expect, it } from 'vitest';
import type {
  NativeEffectPassRuntime,
} from './nativeRendererSync';

let effectToNativeDescriptor: (effect: any) => string | null;
let nativeEffectPassFromDescriptor: (descriptor: string | null) => NativeEffectPassRuntime | null;

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
    nativeEffectPassFromDescriptor,
  } = await import('./nativeRendererSync'));
});

describe('native renderer sync effect-pass descriptors', () => {
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
});
