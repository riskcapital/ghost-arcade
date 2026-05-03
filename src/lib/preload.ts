/**
 * Preload module — loads ISF shader library at startup so the app is
 * 100% ready to use when the splash screen dismisses.
 * Populates window.__shaderCache so MediaTray / VJModePanel / SynthVision
 * get instant access without re-fetching.
 */

import { parseISF, getInputDefault } from './isf/parser';
import type { ISFInputDef, ImageInputRef } from './types';

interface PreloadShaderItem {
  id: string;
  name: string;
  src: string;
  shaderCode: string;
  inputs: ISFInputDef[];
  values: Record<string, number | boolean | number[]>;
  imageInputRefs: Record<string, ImageInputRef | null>;
  description?: string;
  tier?: 'demo' | 'starter' | 'pro';
  category?: string;
}

/**
 * Preload all ISF shaders from the manifest.
 * Fetches every .fs file and parses its metadata so the shader library
 * is ready instantly when the user opens any panel.
 * Thumbnails are NOT generated here (they're slow and not blocking).
 *
 * @param onProgress  Optional callback: (loaded, total) => void
 * @returns The array of loaded shader items
 */
export async function preloadShaderLibrary(
  onProgress?: (loaded: number, total: number) => void
): Promise<PreloadShaderItem[]> {
  const _win = window as any;

  // Already cached — nothing to do
  if (_win.__shaderCache?.shaders) {
    return _win.__shaderCache.shaders;
  }

  // Another caller is already loading — wait for it
  if (_win.__shaderCache?.loading) {
    return new Promise<PreloadShaderItem[]>((resolve) => {
      const check = setInterval(() => {
        if (_win.__shaderCache?.shaders) {
          clearInterval(check);
          resolve(_win.__shaderCache.shaders);
        }
      }, 200);
    });
  }

  // Initialize cache object
  if (!_win.__shaderCache) _win.__shaderCache = { shaders: null, loading: false };
  _win.__shaderCache.loading = true;

  try {
    const response = await fetch('./ISF/manifest.json');
    const manifest = await response.json();
    // Support both v1 (flat array) and v2 (objects with metadata) manifest formats
    const entries: Array<{ file: string; tier?: string; defaults?: Record<string, any>; category?: string }> =
      manifest.version === 2
        ? manifest.shaders.filter((s: any) => s.enabled !== false && s.defaultLoad === true)
        : manifest.shaders.map((f: string) => ({ file: f }));
    const total = entries.length;
    const loaded: PreloadShaderItem[] = [];

    for (let i = 0; i < total; i++) {
      const filename = entries[i].file;
      try {
        const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
        const shaderResponse = await fetch(`./ISF/${encodedPath}`);
        const shaderCode = await shaderResponse.text();
        const parsed = parseISF(shaderCode);

        const item: PreloadShaderItem = {
          id: `isf:${filename}`,
          name: filename.replace('.fs', '').replace('DM-', '').replace('SM-', '').replace('AR-', ''),
          src: `./ISF/${encodedPath}`,
          shaderCode,
          inputs: parsed.metadata.INPUTS as ISFInputDef[],
          values: {},
          imageInputRefs: {},
          description: parsed.metadata.DESCRIPTION,
          tier: (entries[i].tier as 'demo' | 'starter' | 'pro') || 'demo',
          category: entries[i].category || '',
        };

        for (const input of item.inputs) {
          if (input.TYPE === 'image') {
            item.imageInputRefs[input.NAME] = null;
          } else {
            // Apply manifest default overrides if present
            const manifestDefault = entries[i].defaults?.[input.NAME];
            item.values[input.NAME] = manifestDefault !== undefined
              ? manifestDefault
              : getInputDefault(input) as number | boolean | number[];
          }
        }

        loaded.push(item);
      } catch {
        // Skip shaders that fail to load
      }

      if (onProgress) onProgress(i + 1, total);
    }

    // Populate the global cache
    _win.__shaderCache.shaders = loaded;
    _win.__shaderCache.loading = false;

    return loaded;
  } catch (err) {
    console.error('Shader preload failed:', err);
    _win.__shaderCache.loading = false;
    return [];
  }
}
