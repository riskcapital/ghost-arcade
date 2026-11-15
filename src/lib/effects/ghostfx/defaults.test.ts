/**
 * GhostFX Background opacity has one default: the registry (panel and new
 * layers), the native uniform and the browser fallback all use it, so a
 * layer that never set it looks the same before and after the core's first
 * frame. The browser fallback used to fall back to 1.0 (an opaque studio
 * backdrop) while the other two used 0.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GHOSTFX_DEFAULT_BG_ALPHA, GHOSTFX_DEFAULTS, ghostfxFallbackParams } from './defaults';
import type { IntegratedEffectSource } from '../../types';
import { getPluginByEffectType } from '../../plugins/registry';

describe('GhostFX Background opacity default', () => {
  it('is the registry default, for the panel and for new layers', () => {
    const plugin = getPluginByEffectType('ghostfx')!;
    expect(plugin.defaultSourceParams.ghostfxBgAlpha).toBe(GHOSTFX_DEFAULT_BG_ALPHA);
    expect(plugin.paramDefs.find((d) => d.param === 'ghostfxBgAlpha')?.default).toBe(GHOSTFX_DEFAULT_BG_ALPHA);
    expect(GHOSTFX_DEFAULT_BG_ALPHA).toBe(0);
  });

  it('is what the native uniform and the browser fallback use when a layer has none', () => {
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(read('../../renderer/nativePluginGraphs.ts')).toContain('clamp(params.ghostfxBgAlpha, 0, 1, GHOSTFX_DEFAULT_BG_ALPHA)');
    expect(ghostfxFallbackParams({} as IntegratedEffectSource).bgAlpha).toBe(GHOSTFX_DEFAULT_BG_ALPHA);
  });
});

/**
 * Every other parameter the browser fallback sets has one default too. The
 * fallback used to start a layer at Exposure 0.1 and then set 0 every frame,
 * and fell back to 0.992 Liquid damping where new layers and the core use 0.996.
 */
describe('GhostFX browser fallback defaults', () => {
  const plugin = getPluginByEffectType('ghostfx')!;
  const field = (key: string) => `ghostfx${key[0].toUpperCase()}${key.slice(1)}`;

  it('match what a new layer gets from the registry, for every parameter', () => {
    for (const [key, value] of Object.entries(GHOSTFX_DEFAULTS)) {
      const name = field(key);
      const registry = name in plugin.defaultSourceParams
        ? plugin.defaultSourceParams[name]
        : plugin.paramDefs.find((d) => d.param === name)?.default;
      expect(registry, name).not.toBeUndefined();
      expect(value, name).toBe(registry);
    }
    expect(GHOSTFX_DEFAULTS.exposure).toBe(0.1);
    expect(GHOSTFX_DEFAULTS.liquidVelDecay).toBe(0.996);
  });

  it('fill whatever a layer never set and keep what it did', () => {
    expect(ghostfxFallbackParams({} as IntegratedEffectSource)).toEqual(GHOSTFX_DEFAULTS);
    const set = ghostfxFallbackParams({ ghostfxExposure: -0.4, ghostfxLiquidVelDecay: 0.97, ghostfxRibbonBlend: 'glass', ghostfxScenePreset: 'liquid' } as IntegratedEffectSource);
    expect(set).toEqual({ ...GHOSTFX_DEFAULTS, exposure: -0.4, liquidVelDecay: 0.97, ribbonBlend: 'glass', scenePreset: 'liquid' });
    // Zero is a setting, not a missing value.
    expect(ghostfxFallbackParams({ ghostfxExposure: 0, ghostfxBgAlpha: 0 } as IntegratedEffectSource).exposure).toBe(0);
    // Each parameter reads its own field.
    for (const key of Object.keys(GHOSTFX_DEFAULTS)) {
      const marker = typeof (GHOSTFX_DEFAULTS as any)[key] === 'string' ? 'marker' : 12345;
      expect((ghostfxFallbackParams({ [field(key)]: marker } as unknown as IntegratedEffectSource) as any)[key], key).toBe(marker);
    }
  });

  it('is what Canvas hands the fallback, at creation and every frame', () => {
    const canvas = readFileSync(fileURLToPath(new URL('../../components/Canvas.svelte', import.meta.url)), 'utf8');
    expect(canvas.match(/fx\.setParams\(ghostfxFallbackParams\(effectSource\)\)/g)?.length).toBe(2);
    expect(canvas).not.toMatch(/effectSource\.ghostfx\w+\s*\?\?/);
    const visualizer = readFileSync(fileURLToPath(new URL('./ghostfxVisualizer.ts', import.meta.url)), 'utf8');
    expect(visualizer).toContain('const DEFAULT_PARAMS: GhostFXParams = { ...GHOSTFX_DEFAULTS };');
  });
});
