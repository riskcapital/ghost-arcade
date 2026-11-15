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
import { GHOSTFX_DEFAULT_BG_ALPHA } from './defaults';
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
    const canvas = read('../../components/Canvas.svelte');
    const fallbacks = [...canvas.matchAll(/ghostfxBgAlpha\s*\?\?\s*([\w.]+)/g)].map((m) => m[1]);
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(new Set(fallbacks)).toEqual(new Set(['GHOSTFX_DEFAULT_BG_ALPHA']));
  });
});
