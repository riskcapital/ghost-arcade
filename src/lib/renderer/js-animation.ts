/**
 * JavaScript Animation Renderer
 * Handles rendering of AI-generated or custom Three.js and p5.js animations
 * by creating iframes from HTML code and capturing to texture
 */

import * as THREE from 'three';
import type { JSAnimationSource } from '../types';

/**
 * Inject runtime shims into user-supplied Three.js / p5.js HTML before
 * loading it into the offscreen iframe.
 *
 * 1) Local bundled Three.js — an importmap pointing `three` at the copy
 *    we ship in /public/lib/. Otherwise every layer's first frame stalls
 *    100–500ms while it fetches three from a public CDN, and the app
 *    refuses to work offline at all.
 *
 * 2) Local bundled p5.js — a <script> tag pointing at our copy. Only
 *    injected when the user HTML actually references p5; cheap detect
 *    via a regex against the source.
 *
 * 3) devicePixelRatio = 1 — the iframe canvas is sampled by the host
 *    at 1x regardless of physical DPR, so any iframe that calls
 *    `renderer.setPixelRatio(window.devicePixelRatio)` (the typical
 *    Three.js boilerplate) over-allocates 4x GPU memory on a Retina
 *    display for nothing. Forcing the global to 1 before the user's
 *    code reads it cuts that waste without requiring the LLM to know.
 *
 * Shims are inserted as early as possible — first inside <head> if it
 * exists, else first inside <body>, else prepended to the document.
 * This guarantees ordering: shims run before any user <script>.
 */
function injectIframeRuntimeShims(html: string): string {
  // Absolute URLs based on the editor window's origin. Blob iframes
  // inherit the creator's origin, so same-origin fetches against the
  // app's /lib/ assets bypass CORS regardless of dev (http://localhost)
  // vs prod (file:///).
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = typeof window !== 'undefined'
    ? window.location.pathname.replace(/\/[^/]*$/, '/')
    : '/';
  const threeUrl = origin + base + 'lib/three.module.min.js';
  const p5Url = origin + base + 'lib/p5.min.js';

  const wantsP5 = /p5\.(min\.)?js|new\s+p5\s*\(/i.test(html);

  // Build the shim block. Importmap MUST come before any <script type="module">
  // that imports 'three', so injecting at the very start of <head> is correct.
  const shims = [
    '<script>(function(){try{Object.defineProperty(window,"devicePixelRatio",{value:1,configurable:true});}catch(e){}})();</script>',
    `<script type="importmap">{"imports":{"three":"${threeUrl}","three/":"${threeUrl.replace(/three\.module\.min\.js$/, '')}"}}</script>`,
    wantsP5 ? `<script src="${p5Url}"></script>` : '',
  ].filter(Boolean).join('\n');

  // Insert position priority: inside <head>, else inside <body>, else prepend.
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, m => m + '\n' + shims);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, m => m + '\n' + shims);
  }
  return shims + '\n' + html;
}

export interface JSAnimationContext {
  id: string;
  iframe: HTMLIFrameElement;
  /** Stable HTMLCanvasElement reference. Starts as a 1×1 placeholder
   *  and is hot-swapped to the iframe's WebGL canvas the first time
   *  `updateTexture()` finds it. The texture's `.image` property is
   *  rebound at the same time so consumers that grabbed `texture`
   *  early keep a valid reference throughout. */
  canvas: HTMLCanvasElement;
  /** Stable CanvasTexture. Source canvas swaps from placeholder to
   *  the live iframe canvas inside `updateTexture()`. */
  texture: THREE.CanvasTexture;
  animationType: 'threejs' | 'p5js';
  updateTexture: () => void;
  updateParams: (params: Record<string, number | boolean | number[]>) => void;
  dispose: () => void;
}

const jsAnimationCache = new Map<string, JSAnimationContext>();

/**
 * Create a JS animation context from HTML code
 */
export function createJSAnimationContext(
  id: string,
  jsAnimation: JSAnimationSource,
  width = 1920,
  height = 1080
): JSAnimationContext {
  // Check cache first
  const cached = jsAnimationCache.get(id);
  if (cached) {
    return cached;
  }

  // Create hidden iframe — runs the JS animation HTML in its own
  // WebGL context. The iframe is same-origin (blob:) so we can read
  // its DOM and source its canvas directly into a CanvasTexture.
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `
    position: fixed;
    left: -9999px;
    top: -9999px;
    width: ${width}px;
    height: ${height}px;
    border: none;
    pointer-events: none;
  `;

  // Inject local bundled libs + a pixel-ratio clamp BEFORE the user's
  // script runs. This is the difference between "every Three.js layer
  // stalls for 100–500ms fetching three from a CDN" and "loads instantly
  // even offline" — plus the iframe stops over-allocating GPU on Retina
  // displays since the host samples its canvas at 1x anyway.
  const patchedHtml = injectIframeRuntimeShims(jsAnimation.htmlCode);

  const blob = new Blob([patchedHtml], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  iframe.src = blobUrl;
  document.body.appendChild(iframe);

  // Stable placeholder canvas — 1×1 black pixel. Sampling this gives
  // a black layer until the iframe loads, which is fine (it would
  // have been black anyway). Once `updateTexture()` finds the iframe's
  // real canvas, we point `texture.image` at it. The texture object
  // and the `context.canvas`/`context.texture` references stay stable,
  // so consumers that grabbed them at layer setup don't need to
  // re-read.
  const placeholder = document.createElement('canvas');
  placeholder.width = 1;
  placeholder.height = 1;
  const phCtx = placeholder.getContext('2d');
  if (phCtx) { phCtx.fillStyle = '#000'; phCtx.fillRect(0, 0, 1, 1); }

  const texture = new THREE.CanvasTexture(placeholder);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  // Track the iframe canvas we last bound so we can detect when the
  // iframe replaces its canvas (rare — happens on resize in some
  // demos). On change, rebind `texture.image` to the new one.
  let lastBoundIframeCanvas: HTMLCanvasElement | null = null;

  const updateTexture = () => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      const iframeCanvas = iframeDoc.querySelector('canvas') as HTMLCanvasElement | null;
      if (!iframeCanvas || iframeCanvas.width <= 0 || iframeCanvas.height <= 0) return;

      if (lastBoundIframeCanvas !== iframeCanvas) {
        // First frame OR iframe swapped canvases. Repoint the texture
        // at the live iframe canvas. CanvasTexture is happy to source
        // from any HTMLCanvasElement, including one belonging to a
        // different WebGL context — the browser handles the GPU-side
        // blit on `texImage2D` upload, which is hardware-accelerated
        // and avoids the GPU→CPU→GPU round trip the old `drawImage`
        // version paid every single frame.
        texture.image = iframeCanvas;
        context.canvas = iframeCanvas;
        lastBoundIframeCanvas = iframeCanvas;
      }

      texture.needsUpdate = true;
    } catch {
      // Cross-origin or not ready yet — ignore.
    }
  };

  const updateParams = (params: Record<string, number | boolean | number[]>) => {
    try {
      const iframeWindow = iframe.contentWindow as Window & { shaderParams?: Record<string, unknown> };
      if (iframeWindow?.shaderParams) {
        Object.assign(iframeWindow.shaderParams, params);
      }
    } catch {
      // Cross-origin — ignore.
    }
  };

  const dispose = () => {
    texture.dispose();
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
    jsAnimationCache.delete(id);
  };

  const context: JSAnimationContext = {
    id,
    iframe,
    canvas: placeholder,
    texture,
    animationType: jsAnimation.animationType,
    updateTexture,
    updateParams,
    dispose
  };

  jsAnimationCache.set(id, context);
  return context;
}

/**
 * Get an existing JS animation context
 */
export function getJSAnimationContext(id: string): JSAnimationContext | undefined {
  return jsAnimationCache.get(id);
}

/**
 * Dispose a JS animation context
 */
export function disposeJSAnimationContext(id: string): void {
  const context = jsAnimationCache.get(id);
  if (context) {
    context.dispose();
  }
}

/**
 * Update all active JS animation textures
 */
export function updateAllJSAnimationTextures(): void {
  const contexts = Array.from(jsAnimationCache.values());
  for (const context of contexts) {
    context.updateTexture();
  }
}

/**
 * Update parameters for a specific animation
 */
export function updateJSAnimationParams(id: string, params: Record<string, number | boolean | number[]>): void {
  const context = jsAnimationCache.get(id);
  if (context) {
    context.updateParams(params);
  }
}

/**
 * Get all active JS animation IDs
 */
export function getActiveJSAnimationIds(): string[] {
  return Array.from(jsAnimationCache.keys());
}

/**
 * Check if a JS animation context exists
 */
export function hasJSAnimationContext(id: string): boolean {
  return jsAnimationCache.has(id);
}

/**
 * Dispose all JS animation contexts
 */
export function disposeAllJSAnimationContexts(): void {
  const ids = Array.from(jsAnimationCache.keys());
  for (const id of ids) {
    disposeJSAnimationContext(id);
  }
}
