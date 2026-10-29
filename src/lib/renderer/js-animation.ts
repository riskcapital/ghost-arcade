/**
 * JavaScript Animation Renderer
 * Handles rendering of AI-generated or custom Three.js and p5.js animations
 * by creating iframes from HTML code and capturing to texture
 */

import * as THREE from 'three';
import type { JSAnimationSource } from '../types';
import { singlePlayableDocument, type SketchPlace } from '../p5sketch/wrapSketch';
import { getVisualAudioSnapshot, type VisualAudioState } from '../audio/visualAudio';

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
 *    via a regex against the source. A remote p5 tag in the page goes, so
 *    only one global-mode sketch starts, and a p5.sound tag loads our copy
 *    of the add-on instead.
 *
 * 3) devicePixelRatio = 1 — the iframe canvas is sampled by the host
 *    at 1x regardless of physical DPR, so any iframe that calls
 *    `renderer.setPixelRatio(window.devicePixelRatio)` (the typical
 *    Three.js boilerplate) over-allocates 4x GPU memory on a Retina
 *    display for nothing. Forcing the global to 1 before the user's
 *    code reads it cuts that waste without requiring the LLM to know.
 *
 * 4) Error capture — uncaught errors are kept on the page, so the sketch
 *    editor can show them with the file and line the author wrote.
 *
 * 5) window.ghostAudio — the show's audio, all 0 until the layer plays and
 *    the first analysis arrives (see pageAudioFrom).
 *
 * Shims are inserted as early as possible — first inside <head> if it
 * exists, else first inside <body>, else prepended to the document.
 * This guarantees ordering: shims run before any user <script>.
 */
function injectIframeRuntimeShims(html: string): { html: string; layout: ShimLayout } {
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
  const p5SoundUrl = origin + base + 'lib/p5.sound.min.js';

  const wantsP5 = /p5\.(min\.)?js|new\s+p5\s*\(/i.test(html);
  if (wantsP5) {
    // A tag that goes keeps its line breaks, so the lines after it keep
    // their numbers for error reports.
    const breaks = (tag: string) => tag.replace(/[^\n]/g, '');
    html = html
      .replace(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']*\/p5(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi, breaks)
      .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*\bp5\.sound(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi, (tag) => `<script src="${p5SoundUrl}"></script>${breaks(tag)}`);
  }

  // Build the shim block. Importmap MUST come before any <script type="module">
  // that imports 'three', so injecting at the very start of <head> is correct.
  const shims = [
    ERROR_CAPTURE_SHIM,
    `<script>(function(){try{Object.defineProperty(window,"devicePixelRatio",{value:1,configurable:true});}catch(e){}window.ghostAudio=${JSON.stringify(SILENT_PAGE_AUDIO)};})();</script>`,
    `<script type="importmap">{"imports":{"three":"${threeUrl}","three/":"${threeUrl.replace(/three\.module\.min\.js$/, '')}"}}</script>`,
    wantsP5 ? `<script src="${p5Url}"></script>` : '',
  ].filter(Boolean).join('\n');

  // Insert position priority: inside <head>, else inside <body>, else prepend.
  const shimLines = shims.split('\n').length;
  for (const tag of [/<head[^>]*>/i, /<body[^>]*>/i]) {
    const match = tag.exec(html);
    if (!match) continue;
    const at = match.index + match[0].length;
    return {
      html: html.slice(0, at) + '\n' + shims + html.slice(at),
      layout: { afterLine: html.slice(0, at).split('\n').length, shimLines },
    };
  }
  return { html: shims + '\n' + html, layout: { afterLine: 0, shimLines } };
}

/**
 * The show's audio as a page reads it, as `window.ghostAudio`: every value
 * from 0 to 1 except bpm, and all 0 while nothing plays.
 */
export interface PageAudio {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  high: number;
  beat: number;
  beatPhase: number;
  bpm: number;
  centroid: number;
  kick: number;
  snare: number;
  active: boolean;
}

const SILENT_PAGE_AUDIO: PageAudio = {
  level: 0, bass: 0, mid: 0, treble: 0, high: 0, beat: 0, beatPhase: 0, bpm: 0, centroid: 0, kick: 0, snare: 0, active: false,
};

function clampFinite(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

export function pageAudioFrom(audio: VisualAudioState): PageAudio {
  return {
    level: clampFinite(audio.level, 0, 1),
    bass: Math.max(clampFinite(audio.bass, 0, 1), clampFinite(audio.bassFast * 0.9, 0, 1)),
    mid: clampFinite(audio.mid, 0, 1),
    treble: clampFinite(audio.treble, 0, 1),
    high: clampFinite(audio.high, 0, 1),
    beat: clampFinite(audio.beat, 0, 1),
    beatPhase: clampFinite(audio.beatPhase, 0, 1),
    bpm: clampFinite(audio.bpm, 0, 300),
    centroid: clampFinite(audio.centroid, 0, 1),
    kick: clampFinite(audio.kick, 0, 1),
    snare: clampFinite(audio.snare, 0, 1),
    active: !!audio.isActive,
  };
}

/** Pages hear the show about 30 times a second; every page shares one reading. */
const PAGE_AUDIO_MS = 33;
let pageAudio: { at: number; value: Readonly<PageAudio> } | null = null;

function currentPageAudio(now: number): Readonly<PageAudio> {
  if (!pageAudio || now - pageAudio.at >= PAGE_AUDIO_MS) {
    pageAudio = { at: now, value: Object.freeze(pageAudioFrom(getVisualAudioSnapshot())) };
  }
  return pageAudio.value;
}

/** Where the shims went: after line `afterLine` of the page, `shimLines` long. */
interface ShimLayout {
  afterLine: number;
  shimLines: number;
}

const ERROR_CAPTURE_SHIM = '<script>(function(){var list=window.__ghostSketchErrors=[];'
  + 'addEventListener("error",function(e){var m=String(e.message||"Error");'
  + 'var line=typeof e.filename==="string"&&e.filename.indexOf("blob:")===0?e.lineno:null;'
  + 'for(var i=0;i<list.length;i++){if(list[i].message===m&&list[i].line===line){list[i].count++;return;}}'
  + 'if(list.length<12)list.push({message:m,line:line,count:1});});})();</script>';

/** The page's own line for a line of the page with shims, or null inside the shims. */
function writtenLine(layout: ShimLayout, line: number | null): number | null {
  if (line === null || !(line >= 1)) return null;
  if (layout.afterLine === 0) return line > layout.shimLines ? line - layout.shimLines : null;
  if (line <= layout.afterLine) return line;
  if (line === layout.afterLine + layout.shimLines) return layout.afterLine;
  return line < layout.afterLine + layout.shimLines ? null : line - layout.shimLines;
}

/** What an iframe loads for a source: its page as one document, with the runtime shims. */
export interface IframePage {
  html: string;
  /** The file and line behind a line of `html`, or null for an added line. */
  place(line: number | null): SketchPlace | null;
}

export function iframePage(jsAnimation: JSAnimationSource): IframePage {
  const document = singlePlayableDocument(jsAnimation);
  const { html, layout } = injectIframeRuntimeShims(document.html);
  return {
    html,
    place(line) {
      const written = writtenLine(layout, line);
      return written === null ? null : document.place(written);
    },
  };
}

/** The document an iframe plays for a source (or a page's HTML), with the bundled libraries. */
export function jsAnimationIframeHtml(page: string | JSAnimationSource): string {
  const source: JSAnimationSource = typeof page === 'string' ? { animationType: 'threejs', htmlCode: page } : page;
  return iframePage(source).html;
}

export interface JSAnimationPageError {
  message: string;
  /** The sketch file it happened in (`sketch.js`, `index.html`), or null inside a library such as p5. */
  file: string | null;
  /** Line of that file as written, or null when unknown. */
  line: number | null;
  count: number;
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
  updateParams: (params: Record<string, number | boolean | number[] | string>) => void;
  /**
   * Plays new code in the same iframe, so the texture, the iframe element
   * and everything holding them stay valid while the page restarts.
   */
  restart: (jsAnimation: JSAnimationSource) => void;
  /** True once the page built from `htmlCode` has loaded and is running. */
  runs: (htmlCode: string) => boolean;
  /** Uncaught errors the page has thrown so far. */
  readErrors: () => JSAnimationPageError[];
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
  // A sketch kept as files plays here as one document built from them.
  let page = iframePage(jsAnimation);
  let runningHtml = jsAnimation.htmlCode;
  let blobUrl = URL.createObjectURL(new Blob([page.html], { type: 'text/html' }));
  let loadedUrl = '';
  iframe.addEventListener('load', () => { loadedUrl = iframe.src; });
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
  let lastAudio: { page: Window; value: Readonly<PageAudio> } | null = null;

  const updateTexture = () => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      const pageWindow = iframe.contentWindow as (Window & { ghostAudio?: Readonly<PageAudio> }) | null;
      if (pageWindow) {
        const audio = currentPageAudio(performance.now());
        if (lastAudio?.page !== pageWindow || lastAudio.value !== audio) {
          pageWindow.ghostAudio = audio;
          lastAudio = { page: pageWindow, value: audio };
        }
      }

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

  const updateParams = (params: Record<string, number | boolean | number[] | string>) => {
    try {
      const iframeWindow = iframe.contentWindow as Window & { shaderParams?: Record<string, unknown> };
      if (iframeWindow?.shaderParams) {
        Object.assign(iframeWindow.shaderParams, params);
      }
    } catch {
      // Cross-origin — ignore.
    }
  };

  // Safe to call more than once; only drops the cache entry if it is
  // still this context (the id may have been reused since).
  let disposed = false;
  const restart = (next: JSAnimationSource) => {
    page = iframePage(next);
    runningHtml = next.htmlCode;
    const previousUrl = blobUrl;
    blobUrl = URL.createObjectURL(new Blob([page.html], { type: 'text/html' }));
    loadedUrl = '';
    iframe.src = blobUrl;
    URL.revokeObjectURL(previousUrl);
    context.animationType = next.animationType;
  };

  const runs = (htmlCode: string) => htmlCode === runningHtml && loadedUrl === blobUrl;

  const readErrors = (): JSAnimationPageError[] => {
    try {
      const pageWindow = iframe.contentWindow as (Window & { __ghostSketchErrors?: Array<{ message: string; line: number | null; count: number }> }) | null;
      return (pageWindow?.__ghostSketchErrors ?? []).map((e) => {
        const place = page.place(e.line);
        return { message: e.message, file: place?.file ?? null, line: place?.line ?? null, count: e.count };
      });
    } catch {
      return [];
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    texture.dispose();
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
    if (jsAnimationCache.get(id) === context) jsAnimationCache.delete(id);
  };

  const context: JSAnimationContext = {
    id,
    iframe,
    canvas: placeholder,
    texture,
    animationType: jsAnimation.animationType,
    updateTexture,
    updateParams,
    restart,
    runs,
    readErrors,
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
 * Play new code for a source wherever it already runs. Layers and clips keep
 * their texture; a source that is not running yet starts with the new code
 * when it is next shown.
 */
export function restartJSAnimation(id: string, jsAnimation: JSAnimationSource): void {
  jsAnimationCache.get(id)?.restart(jsAnimation);
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

type JSAnimationParamForwarder = (id: string, params: Record<string, number | boolean | number[] | string>) => void;
let paramForwarder: JSAnimationParamForwarder | null = null;

/**
 * Deliver slider changes somewhere besides an editor iframe. The native
 * engine's offscreen page hosts register here, so the Mapping and VJ param
 * controls need no idea which runtime is playing the page.
 */
export function setJSAnimationParamForwarder(forwarder: JSAnimationParamForwarder | null): void {
  paramForwarder = forwarder;
}

/**
 * Update parameters for a specific animation
 */
export function updateJSAnimationParams(id: string, params: Record<string, number | boolean | number[] | string>): void {
  const context = jsAnimationCache.get(id);
  if (context) {
    context.updateParams(params);
  }
  paramForwarder?.(id, params);
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

/**
 * Plays a page in a hidden iframe for a moment and keeps a picture of its
 * canvas as a JPEG data URL. For tray thumbnails and import previews; gives
 * up quietly when the page draws nothing in time.
 */
export function captureJSAnimationThumbnail(
  page: string | JSAnimationSource,
  options: { width?: number; height?: number; waitMs?: number } = {},
): Promise<string | undefined> {
  const { width = 160, height = 90, waitMs = 2000 } = options;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([jsAnimationIframeHtml(page)], { type: 'text/html' }));
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:absolute;left:-9999px;top:-9999px;width:${width * 2}px;height:${height * 2}px;border:none;`;
    iframe.src = url;
    document.body.appendChild(iframe);

    const finish = (out: string | undefined) => {
      try { document.body.removeChild(iframe); } catch { /* already gone */ }
      URL.revokeObjectURL(url);
      resolve(out);
    };

    // Most Three.js / p5 sketches paint within 100ms; raymarchers can take
    // longer. Capped so an import doesn't wait on a page that never draws.
    setTimeout(() => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        const canvasEl = doc?.querySelector('canvas') as HTMLCanvasElement | null;
        if (!canvasEl || canvasEl.width === 0) return finish(undefined);
        const thumb = document.createElement('canvas');
        thumb.width = width; thumb.height = height;
        const ctx = thumb.getContext('2d');
        if (!ctx) return finish(undefined);
        ctx.drawImage(canvasEl, 0, 0, thumb.width, thumb.height);
        finish(thumb.toDataURL('image/jpeg', 0.7));
      } catch {
        finish(undefined);
      }
    }, waitMs);
  });
}
