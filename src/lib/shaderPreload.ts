/**
 * Shader Preloader — kicks off shader loading immediately at app startup
 * so MediaTray.svelte finds cached data when it mounts (no delay).
 *
 * Populates window.__shaderCache with parsed shader items.
 * MediaTray.svelte checks this cache on mount and skips loading if populated.
 */
import { parseISF } from './isf/parser';
import type { ISFInputDef } from './types';

interface PreloadedShader {
  id: string;
  name: string;
  src: string;
  shaderCode: string;
  inputs: ISFInputDef[];
  values: Record<string, any>;
  imageInputRefs: Record<string, null>;
  description?: string;
  tier?: 'demo' | 'starter' | 'pro';
  category?: string;
}

function getInputDefault(input: ISFInputDef): number | boolean | number[] {
  // DEFAULT is typed as a union including string (per ISF spec), but the runtime
  // shape depends on TYPE — narrow defensively so bad manifests fall back to sane values.
  const d = input.DEFAULT as unknown;
  if (input.TYPE === 'float') return typeof d === 'number' ? d : (input.MIN ?? 0);
  if (input.TYPE === 'bool') return typeof d === 'boolean' ? d : false;
  if (input.TYPE === 'long') return typeof d === 'number' ? d : 0;
  if (input.TYPE === 'color') return Array.isArray(d) ? d : [1, 1, 1, 1];
  if (input.TYPE === 'point2D') return Array.isArray(d) ? d : [0, 0];
  return 0;
}

/**
 * Start preloading shaders immediately. Non-blocking — returns a promise
 * but callers don't need to await it.
 */
export function preloadShaders(): void {
  const _win = window as any;

  // Already cached or already loading
  if (_win.__shaderCache?.shaders || _win.__shaderCache?.loading) return;

  // Initialize cache structure
  if (!_win.__shaderCache) _win.__shaderCache = { shaders: null, loading: false };
  _win.__shaderCache.loading = true;

  console.log('[ShaderPreload] Starting background shader preload...');
  const startTime = performance.now();

  (async () => {
    try {
      const response = await fetch('./ISF/manifest.json');
      const manifest = await response.json();

      const entries: Array<{ file: string; tier?: string; category?: string; defaults?: Record<string, any>; enabled?: boolean }> =
        manifest.version === 2
          ? manifest.shaders.filter((s: any) => s.enabled !== false && s.defaultLoad === true)
          : manifest.shaders.map((f: string) => ({ file: f }));

      const loadedShaders: PreloadedShader[] = [];

      // Load in parallel batches for speed
      const BATCH_SIZE = 10;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(async (entry) => {
          const filename = entry.file;
          const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
          const shaderResponse = await fetch(`./ISF/${encodedPath}`);
          const shaderCode = await shaderResponse.text();
          const parsed = parseISF(shaderCode);

          const shaderItem: PreloadedShader = {
            id: `isf:${filename}`,
            name: filename.replace('.fs', '').replace('DM-', '').replace('SM-', '').replace('AR-', ''),
            src: `./ISF/${encodedPath}`,
            shaderCode,
            inputs: parsed.metadata.INPUTS as ISFInputDef[],
            values: {},
            imageInputRefs: {},
            description: parsed.metadata.DESCRIPTION,
            tier: (entry.tier as 'demo' | 'starter' | 'pro') || 'demo',
            category: entry.category || '',
          };

          for (const input of shaderItem.inputs) {
            if (input.TYPE === 'image') {
              shaderItem.imageInputRefs[input.NAME] = null;
            } else {
              const manifestDefault = entry.defaults?.[input.NAME];
              shaderItem.values[input.NAME] = manifestDefault !== undefined
                ? manifestDefault
                : getInputDefault(input);
            }
          }
          return shaderItem;
        }));

        for (const result of results) {
          if (result.status === 'fulfilled') {
            loadedShaders.push(result.value);
          }
        }
      }

      _win.__shaderCache.shaders = loadedShaders;
      _win.__shaderCache.loading = false;

      const elapsed = (performance.now() - startTime).toFixed(0);
      console.log(`[ShaderPreload] ${loadedShaders.length} shaders preloaded in ${elapsed}ms`);
    } catch (err) {
      console.error('[ShaderPreload] Failed:', err);
      _win.__shaderCache.loading = false;
    }
  })();
}
