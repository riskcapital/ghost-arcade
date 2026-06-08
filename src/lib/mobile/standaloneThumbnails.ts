/**
 * Runtime shader-thumbnail generator + localStorage cache.
 *
 * Renders each curated mobile shader offscreen at low resolution, lets
 * it run for ~1.2s to stabilise past its boot state, snapshots the
 * canvas to a WebP data-URL, and persists it under a versioned key in
 * localStorage. The picker reads from the cache so subsequent launches
 * show real shader stills instead of the category-coloured letter
 * placeholders.
 *
 * Generation is amortised — `warmThumbnails()` walks all 30 shaders
 * one at a time, awaiting each so the GPU isn't overloaded with
 * parallel compiles. First launch takes ~45 s in the background
 * (~1.5 s/shader); subsequent launches read from cache (instant).
 *
 * Why runtime instead of build-time:
 *   - No headless-GL build dependency (Puppeteer / canvas-gl), no
 *     extra Vite step
 *   - Same code path as the live renderer — thumbnails always match
 *     what the user sees
 *   - Auto-handles the audio inject patches we just shipped (the
 *     thumbnail uses a non-silent fake audio so audio-reactive
 *     shaders don't render as a black square)
 *
 * Size budget: 30 thumbs × ~5 KB WebP ≈ 150 KB. Comfortably under
 * localStorage's 5–10 MB quota.
 */

import { StandaloneRenderer } from './standaloneRenderer';
import { MOBILE_SHADERS, type MobileShader } from './standaloneShaderList';

/** Bump when the renderer or thumbnail format changes so stale
 *  cached thumbs are discarded. */
const CACHE_VERSION = 1;
const THUMB_SIZE = 160;             // px; small enough to be cheap, big enough that the grid looks right at 1× and 2× DPR
const THUMB_FORMAT = 'image/webp';
const THUMB_QUALITY = 0.7;
/** How long to let the shader run before snapshotting. Most shaders
 *  have a few hundred ms of initial bleed (gradient fade-in, sparse
 *  particle warmup) before they settle into the look users recognise. */
const STABILIZE_MS = 1200;
/** Non-silent fake audio values — so audio-reactive shaders don't
 *  render as a black square or dim non-effect. ~0.35 reads as
 *  "moderate continuous bed of music". */
const FAKE_AUDIO = {
  audioBass: 0.4,
  audioMid: 0.3,
  audioHigh: 0.35,
  audioLevel: 0.35,
  audioBeat: 0.0,
} as const;

function cacheKey(id: string): string {
  return `ga-mobile-thumb:v${CACHE_VERSION}:${id}`;
}

/** Read the cached thumb for a shader, or null if absent / blocked. */
export function getCachedThumb(id: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(cacheKey(id)); } catch { return null; }
}

function setCachedThumb(id: string, dataUrl: string): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(cacheKey(id), dataUrl); } catch { /* quota — accept the miss */ }
}

/** Generate one shader thumbnail. Idempotent: returns the cached
 *  value if present. */
export async function generateThumb(shader: MobileShader): Promise<string | null> {
  const cached = getCachedThumb(shader.id);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  // Offscreen canvas + hidden DOM mount. The renderer's `resize()`
  // reads clientWidth/clientHeight — those are 0 for unmounted
  // canvases, which makes the WebGL viewport 0×0 and nothing draws.
  // Hidden mount with explicit dimensions sidesteps that.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = THUMB_SIZE;
  canvas.style.cssText = `position:fixed; left:-9999px; top:0; width:${THUMB_SIZE}px; height:${THUMB_SIZE}px; pointer-events:none; opacity:0;`;
  document.body.appendChild(canvas);

  let renderer: StandaloneRenderer | null = null;
  try {
    renderer = new StandaloneRenderer(canvas);
    const url = encodeURI(`${import.meta.env.BASE_URL}${shader.path}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${shader.path} → ${res.status}`);
    const source = await res.text();
    await renderer.loadShaderSource(source, shader.audioNative, shader.audioInject);
    renderer.setAudio({ ...FAKE_AUDIO });
    renderer.start();
    await new Promise(r => setTimeout(r, STABILIZE_MS));
    renderer.stop();
    const dataUrl = canvas.toDataURL(THUMB_FORMAT, THUMB_QUALITY);
    setCachedThumb(shader.id, dataUrl);
    return dataUrl;
  } catch (e: any) {
    console.warn('[mobile-thumb] failed for', shader.id, e?.message || e);
    return null;
  } finally {
    try { renderer?.stop(); } catch { /* */ }
    try { (renderer as any)?.destroy?.(); } catch { /* */ }
    try { document.body.removeChild(canvas); } catch { /* */ }
  }
}

/** Generate any missing thumbnails sequentially. Returns the IDs
 *  that were freshly generated this run; cached ones are skipped.
 *  `onProgress` is called after each shader (done/total) so the UI
 *  can show a "warming up" progress hint. */
export async function warmThumbnails(
  onProgress?: (done: number, total: number, lastId: string | null) => void,
): Promise<string[]> {
  const total = MOBILE_SHADERS.length;
  const generated: string[] = [];
  let done = 0;
  for (const s of MOBILE_SHADERS) {
    const before = getCachedThumb(s.id);
    if (!before) {
      const result = await generateThumb(s);
      if (result) generated.push(s.id);
    }
    done++;
    onProgress?.(done, total, s.id);
  }
  return generated;
}

/** Clear all cached thumbnails. Use after a renderer or shader-pool
 *  change where existing thumbnails no longer represent the live
 *  output (e.g. a new universal-patch tuning). */
export function clearThumbnailCache(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const prefix = `ga-mobile-thumb:v${CACHE_VERSION}:`;
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toDelete.push(k);
    }
    for (const k of toDelete) localStorage.removeItem(k);
  } catch { /* */ }
}
