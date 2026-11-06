/**
 * JavaScript Animation Renderer
 * Handles rendering of AI-generated or custom Three.js and p5.js animations
 * by creating iframes from HTML code and capturing to texture
 *
 * Two kinds of page play here:
 *
 * - p5.js pages, which include every imported sketch, play sandboxed: the
 *   iframe has `sandbox="allow-scripts"` and no `allow-same-origin`, so its
 *   code runs in an origin of its own and cannot reach the app's window, its
 *   storage or its desktop bridge. p5 and p5.sound are written into the page
 *   (a sandboxed page cannot load the app's files), and the page sends its
 *   canvas up as an ImageBitmap when asked; errors, controls and the show's
 *   audio travel by postMessage too.
 * - Other pages (three.js) keep the same-origin iframe whose canvas the
 *   texture samples directly.
 */

import * as THREE from 'three';
import type { JSAnimationSource } from '../types';
import { singlePlayableDocument, type SketchPlace } from '../p5sketch/wrapSketch';
import { getVisualAudioSnapshot, type VisualAudioState } from '../audio/visualAudio';

type PageParams = Record<string, number | boolean | number[] | string>;

const wantsP5 = (html: string) => /p5\.(min\.)?js|new\s+p5\s*\(/i.test(html);

/**
 * True for a page that plays sandboxed: a p5.js sketch or any page that uses
 * p5.js. These are the pages imported from other people.
 */
export function playsSandboxed(jsAnimation: Pick<JSAnimationSource, 'animationType' | 'htmlCode' | 'sketch'>): boolean {
  return !!jsAnimation.sketch || jsAnimation.animationType === 'p5js' || wantsP5(jsAnimation.htmlCode ?? '');
}

// ---------------------------------------------------------------------------
// The libraries a sandboxed page carries

interface PageLibraries {
  p5: string;
  sound: string;
}

let pageLibraries: PageLibraries | null = null;
let pageLibrariesLoading: Promise<PageLibraries> | null = null;

/**
 * p5 and p5.sound as text, loaded on first use. A sandboxed page cannot load
 * the app's own files, so they are written into the page.
 */
export function loadPageLibraries(): Promise<PageLibraries> {
  pageLibrariesLoading ??= Promise.all([
    import('p5/lib/p5.min.js?raw'),
    import('p5/lib/addons/p5.sound.min.js?raw'),
  ]).then(([core, sound]) => {
    pageLibraries = { p5: core.default, sound: sound.default };
    return pageLibraries;
  });
  return pageLibrariesLoading;
}

/** Script text that is safe inside a <script> element. */
function inlineScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

const P5_SOUND_TAG = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\bp5\.sound(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi;
const REMOTE_P5_TAG = /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']*\/p5(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi;

/**
 * Inject runtime shims into user-supplied Three.js / p5.js HTML before
 * loading it into the offscreen iframe.
 *
 * 1) Local bundled Three.js — an importmap pointing `three` at the copy
 *    we ship in /public/lib/ (same-origin pages). Otherwise every layer's
 *    first frame stalls 100–500ms while it fetches three from a public CDN,
 *    and the app refuses to work offline at all.
 *
 * 2) Bundled p5.js (sandboxed pages), written into the page. A remote p5
 *    tag in the page goes, so only one global-mode sketch starts, and a
 *    p5.sound tag gives way to the bundled add-on. A tag that goes keeps its
 *    line breaks, so the lines after it keep their numbers for error reports.
 *
 * 3) devicePixelRatio = 1 — the iframe canvas is sampled by the host
 *    at 1x regardless of physical DPR, so any iframe that calls
 *    `renderer.setPixelRatio(window.devicePixelRatio)` (the typical
 *    Three.js boilerplate) over-allocates 4x GPU memory on a Retina
 *    display for nothing. Forcing the global to 1 before the user's
 *    code reads it cuts that waste without requiring the LLM to know.
 *
 * 4) Error capture — uncaught errors are kept on the page (and sent up from
 *    a sandboxed one), so they can be shown with the file and line the
 *    author wrote.
 *
 * 5) window.ghostAudio — the show's audio, all 0 until the layer plays and
 *    the first analysis arrives (see pageAudioFrom).
 *
 * 6) Silence — a page is a picture: what it plays through Web Audio or a
 *    media element is muted, in layers and in hidden previews alike.
 *
 * Shims are inserted as early as possible — first inside <head> if it
 * exists, else first inside <body>, else prepended to the document.
 * This guarantees ordering: shims run before any user <script>.
 */
function injectIframeRuntimeShims(html: string, sandboxed: boolean): { html: string; layout: ShimLayout } {
  // Absolute URLs based on the editor window's origin. Blob iframes
  // inherit the creator's origin, so same-origin fetches against the
  // app's /lib/ assets bypass CORS regardless of dev (http://localhost)
  // vs prod (file:///).
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = typeof window !== 'undefined'
    ? window.location.pathname.replace(/\/[^/]*$/, '/')
    : '/';
  const threeUrl = origin + base + 'lib/three.module.min.js';

  let wantsSound = false;
  if (sandboxed) {
    if (!pageLibraries) throw new Error('The p5.js library is not loaded yet (loadPageLibraries).');
    const breaks = (tag: string) => tag.replace(/[^\n]/g, '');
    wantsSound = new RegExp(P5_SOUND_TAG.source, 'i').test(html);
    html = html.replace(REMOTE_P5_TAG, breaks).replace(P5_SOUND_TAG, breaks);
  }

  // Build the shim block. Importmap MUST come before any <script type="module">
  // that imports 'three', so injecting at the very start of <head> is correct.
  const shims = [
    ERROR_CAPTURE_SHIM,
    `<script>(function(){try{Object.defineProperty(window,"devicePixelRatio",{value:1,configurable:true});}catch(e){}window.ghostAudio=${JSON.stringify(SILENT_PAGE_AUDIO)};})();</script>`,
    MUTE_SHIM,
    ...(sandboxed
      ? [
        SANDBOX_BRIDGE_SHIM,
        `<script data-ghost-lib="p5">${inlineScript(pageLibraries!.p5)}</script>`,
        wantsSound ? `<script data-ghost-lib="p5.sound">${inlineScript(pageLibraries!.sound)}</script>` : '',
      ]
      : [`<script type="importmap">{"imports":{"three":"${threeUrl}","three/":"${threeUrl.replace(/three\.module\.min\.js$/, '')}"}}</script>`]),
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

/** The show's audio analysis as a page hears it, every value but bpm from 0 to 1. */
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

/**
 * Keeps the page's uncaught errors on `window.__ghostSketchErrors` and sends
 * them to the app a few times a second at most.
 */
const ERROR_CAPTURE_SHIM = '<script>(function(){var list=window.__ghostSketchErrors=[];var due=0;'
  + 'function send(){due=0;try{parent.postMessage({ghost:"errors",errors:list.slice()},"*");}catch(x){}}'
  + 'addEventListener("error",function(e){var m=String(e.message||"Error");'
  + 'var line=typeof e.filename==="string"&&e.filename.indexOf("blob:")===0?e.lineno:null;'
  + 'var known=false;for(var i=0;i<list.length;i++){if(list[i].message===m&&list[i].line===line){list[i].count++;known=true;break;}}'
  + 'if(!known&&list.length<12)list.push({message:m,line:line,count:1});'
  + 'if(!due)due=setTimeout(send,known?250:0);});})();</script>';

/** Web Audio reaches the speakers through a silent gain; media elements stay muted. */
const MUTE_SHIM = '<script>(function(){try{'
  + 'var connect=AudioNode.prototype.connect,silent=new WeakMap();'
  + 'AudioNode.prototype.connect=function(target){'
  + 'if(typeof AudioDestinationNode!=="undefined"&&target instanceof AudioDestinationNode){'
  + 'var g=silent.get(target);if(!g){g=target.context.createGain();g.gain.value=0;connect.call(g,target);silent.set(target,g);}'
  + 'var args=Array.prototype.slice.call(arguments);args[0]=g;return connect.apply(this,args);}'
  + 'return connect.apply(this,arguments);};'
  + 'var M=HTMLMediaElement.prototype,d=Object.getOwnPropertyDescriptor(M,"muted"),play=M.play;'
  + 'if(d&&d.set&&d.configurable)Object.defineProperty(M,"muted",{configurable:true,enumerable:d.enumerable,get:d.get,set:function(){d.set.call(this,true);}});'
  + 'M.play=function(){if(d&&d.set)d.set.call(this,true);return play.apply(this,arguments);};'
  + 'document.addEventListener("play",function(e){if(e.target instanceof HTMLMediaElement&&d&&d.set)d.set.call(e.target,true);},true);'
  + '}catch(e){}})();</script>';

/**
 * The sandboxed page's side of the conversation. When the app asks for a
 * frame, the canvas is sent after the last animation callback of the next
 * frame has drawn (or after a moment, for a page that stopped looping).
 * Controls and the show's audio arrive from the app.
 */
const SANDBOX_BRIDGE_SHIM = '<script>(function(){'
  + 'var wanted=false,busy=false,timer=0,outstanding=0,remaining=0,frameAt=-1,live={};'
  + 'function pick(){return document.querySelector("canvas[data-ghost-canvas]")||document.querySelector("canvas");}'
  + 'function capture(){if(!wanted||busy)return;var c=pick();if(!c||!(c.width>0)||!(c.height>0))return;'
  + 'wanted=false;busy=true;clearTimeout(timer);var made;try{made=createImageBitmap(c);}catch(e){busy=false;wanted=true;return;}'
  + 'made.then(function(b){busy=false;parent.postMessage({ghost:"frame",bitmap:b},"*",[b]);},function(){busy=false;wanted=true;});}'
  + 'var raf=window.requestAnimationFrame,caf=window.cancelAnimationFrame;'
  + 'window.requestAnimationFrame=function(cb){outstanding++;var id=raf.call(window,function(t){delete live[id];'
  + 'if(t!==frameAt){frameAt=t;remaining=outstanding;}outstanding--;remaining--;'
  + 'try{cb(t);}finally{if(remaining<=0)capture();}});live[id]=1;return id;};'
  + 'window.cancelAnimationFrame=function(id){if(live[id]){delete live[id];outstanding--;}return caf.call(window,id);};'
  + 'addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(!d||typeof d!=="object")return;'
  + 'if(d.ghost==="frame"){wanted=true;clearTimeout(timer);timer=setTimeout(function later(){capture();if(wanted)timer=setTimeout(later,100);},100);}'
  + 'else if(d.ghost==="params"){if(window.shaderParams&&d.params&&typeof d.params==="object")Object.assign(window.shaderParams,d.params);}'
  + 'else if(d.ghost==="audio"&&d.audio&&typeof d.audio==="object"){window.ghostAudio=Object.freeze(d.audio);}});'
  + '})();</script>';

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
  /** True when the page plays in a sandboxed iframe (see playsSandboxed). */
  sandboxed: boolean;
  /** The file and line behind a line of `html`, or null for an added line. */
  place(line: number | null): SketchPlace | null;
}

/**
 * The page for a source. A sandboxed page needs the libraries loaded first
 * (loadPageLibraries); every caller in the app waits for them.
 */
export function iframePage(jsAnimation: JSAnimationSource): IframePage {
  const sandboxed = playsSandboxed(jsAnimation);
  // A sandboxed page shares the app's process: a loop of its own that never
  // ends is stopped after half a second (p5sketch/loopGuard.ts).
  const document = singlePlayableDocument(jsAnimation, { guardLoops: sandboxed });
  const { html, layout } = injectIframeRuntimeShims(document.html, sandboxed);
  return {
    html,
    sandboxed,
    place(line) {
      const written = writtenLine(layout, line);
      return written === null ? null : document.place(written);
    },
  };
}

function asSource(page: string | JSAnimationSource): JSAnimationSource {
  return typeof page === 'string' ? { animationType: 'threejs', htmlCode: page } : page;
}

/** The document an iframe plays for a source (or a page's HTML), with the bundled libraries. */
export function jsAnimationIframeHtml(page: string | JSAnimationSource): string {
  return iframePage(asSource(page)).html;
}

export interface JSAnimationPageError {
  message: string;
  /** The sketch file it happened in (`sketch.js`, `index.html`), or null inside a library such as p5. */
  file: string | null;
  /** Line of that file as written, or null when unknown. */
  line: number | null;
  count: number;
}

interface RawPageError {
  message: string;
  line: number | null;
  count: number;
}

/** Errors as a page sent them, kept to what can be shown. */
function cleanErrors(value: unknown): RawPageError[] {
  if (!Array.isArray(value)) return [];
  const out: RawPageError[] = [];
  for (const item of value.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const { message, line, count } = item as Record<string, unknown>;
    out.push({
      message: String(message ?? 'Error').slice(0, 1000),
      line: typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : null,
      count: typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
    });
  }
  return out;
}

function placedErrors(page: IframePage, raw: RawPageError[]): JSAnimationPageError[] {
  return raw.map((e) => {
    const place = page.place(e.line);
    return { message: e.message, file: place?.file ?? null, line: place?.line ?? null, count: e.count };
  });
}

// ---------------------------------------------------------------------------
// Sandboxed pages talk to the app by postMessage

type PageMessageHandler = (data: Record<string, unknown>) => void;
const pageHandlers = new Map<MessageEventSource, PageMessageHandler>();
let listening = false;

function listenToPage(iframe: HTMLIFrameElement, handler: PageMessageHandler): () => void {
  const pageWindow = iframe.contentWindow;
  if (!pageWindow || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  if (!listening) {
    listening = true;
    window.addEventListener('message', (event: MessageEvent) => {
      const handle = event.source ? pageHandlers.get(event.source) : undefined;
      const data = event.data;
      if (handle && data && typeof data === 'object') handle(data as Record<string, unknown>);
    });
  }
  pageHandlers.set(pageWindow, handler);
  return () => {
    if (pageHandlers.get(pageWindow) === handler) pageHandlers.delete(pageWindow);
  };
}

function postToPage(iframe: HTMLIFrameElement, message: Record<string, unknown>): void {
  try {
    iframe.contentWindow?.postMessage(message, '*');
  } catch {
    // The page is gone or not loaded yet.
  }
}

function isImageBitmap(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
}

/**
 * Where a page's iframe sits. A sandboxed page counts as cross-origin, and
 * the browser stops drawing cross-origin frames that lie outside the
 * window, so it stays in the window, transparent and out of the way.
 */
function iframeStyle(sandboxed: boolean, width: number, height: number): string {
  return sandboxed
    ? `position: fixed; left: 0; top: 0; width: ${width}px; height: ${height}px; border: none; opacity: 0; pointer-events: none; z-index: -1;`
    : `position: fixed; left: -9999px; top: -9999px; width: ${width}px; height: ${height}px; border: none; pointer-events: none;`;
}

function prepareIframe(iframe: HTMLIFrameElement, sandboxed: boolean, width: number, height: number): void {
  iframe.style.cssText = iframeStyle(sandboxed, width, height);
  if (sandboxed) {
    // Scripts only: no same origin, no popups, no navigating the app.
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
  } else {
    iframe.removeAttribute('sandbox');
  }
}

export interface JSAnimationContext {
  id: string;
  iframe: HTMLIFrameElement;
  /** Stable HTMLCanvasElement reference. Starts as a 1×1 placeholder
   *  and is hot-swapped to the iframe's WebGL canvas (or, for a sandboxed
   *  page, to the canvas its frames are drawn on) the first time
   *  `updateTexture()` finds it. The texture's `.image` property is
   *  rebound at the same time so consumers that grabbed `texture`
   *  early keep a valid reference throughout. */
  canvas: HTMLCanvasElement;
  /** Stable CanvasTexture. Source canvas swaps from placeholder to
   *  the live canvas inside `updateTexture()`. */
  texture: THREE.CanvasTexture;
  animationType: 'threejs' | 'p5js';
  updateTexture: () => void;
  updateParams: (params: PageParams) => void;
  /**
   * Plays new code in the same iframe, so the texture, the iframe element
   * and everything holding them stay valid while the page restarts.
   */
  restart: (jsAnimation: JSAnimationSource) => void;
  /**
   * Restarts the page when `jsAnimation` holds other code than it runs. A
   * source keeps its id when its code changes (an edited sketch, undo and
   * redo), so whatever plays it calls this with the code it holds now.
   */
  follow: (jsAnimation: JSAnimationSource) => void;
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

  // Hidden iframe — runs the JS animation HTML in its own WebGL context.
  const iframe = document.createElement('iframe');
  let sandboxed = playsSandboxed(jsAnimation);
  prepareIframe(iframe, sandboxed, width, height);

  // Inject local bundled libs + a pixel-ratio clamp BEFORE the user's
  // script runs. This is the difference between "every layer stalls for
  // 100–500ms fetching its library from a CDN" and "loads instantly even
  // offline" — plus the iframe stops over-allocating GPU on Retina
  // displays since the host samples its canvas at 1x anyway.
  // A sketch kept as files plays here as one document built from them.
  let page: IframePage | null = null;
  let runningHtml = jsAnimation.htmlCode;
  let blobUrl = '';
  let loadedUrl = '';
  let disposed = false;
  let stopListening = () => {};
  let lastParams: PageParams = {};
  let rawErrors: RawPageError[] = [];
  let frameRequested = false;
  let pendingFrame: ImageBitmap | null = null;
  let frameCanvas: HTMLCanvasElement | null = null;

  iframe.addEventListener('load', () => {
    loadedUrl = iframe.src;
    frameRequested = false;
    if (sandboxed && Object.keys(lastParams).length > 0) postToPage(iframe, { ghost: 'params', params: lastParams });
  });

  const onPageMessage: PageMessageHandler = (data) => {
    if (data.ghost === 'frame' && isImageBitmap(data.bitmap)) {
      pendingFrame?.close();
      pendingFrame = data.bitmap;
      frameRequested = false;
    } else if (data.ghost === 'errors') {
      rawErrors = cleanErrors(data.errors);
    }
  };

  /** Navigates the iframe to the page for `next`; a sandboxed page waits for its libraries. */
  const navigate = (next: JSAnimationSource) => {
    const wantsSandbox = playsSandboxed(next);
    if (wantsSandbox && !pageLibraries) {
      void loadPageLibraries().then(() => {
        if (!disposed && runningHtml === next.htmlCode) navigate(next);
      });
      return;
    }
    page = iframePage(next);
    if (wantsSandbox !== sandboxed) {
      sandboxed = wantsSandbox;
      prepareIframe(iframe, sandboxed, width, height);
    }
    rawErrors = [];
    frameRequested = false;
    const previousUrl = blobUrl;
    blobUrl = URL.createObjectURL(new Blob([page.html], { type: 'text/html' }));
    loadedUrl = '';
    iframe.src = blobUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  };

  document.body.appendChild(iframe);
  stopListening = listenToPage(iframe, onPageMessage);
  navigate(jsAnimation);

  // Stable placeholder canvas — 1×1 black pixel. Sampling this gives
  // a black layer until the iframe loads, which is fine (it would
  // have been black anyway). Once `updateTexture()` finds the real
  // canvas, we point `texture.image` at it. The texture object
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

  const bindCanvas = (canvasEl: HTMLCanvasElement) => {
    // First frame OR a new canvas. Repoint the texture at it.
    // CanvasTexture is happy to source from any HTMLCanvasElement,
    // including one belonging to a different WebGL context — the browser
    // handles the GPU-side blit on `texImage2D` upload, which is
    // hardware-accelerated and avoids the GPU→CPU→GPU round trip the old
    // `drawImage` version paid every single frame.
    texture.image = canvasEl;
    context.canvas = canvasEl;
    lastBoundIframeCanvas = canvasEl;
  };

  /** Sandboxed pages: draws the latest frame the page sent, and asks for the next. */
  const updateSandboxedTexture = () => {
    const pageWindow = iframe.contentWindow;
    if (pageWindow && loadedUrl === blobUrl) {
      const audio = currentPageAudio(performance.now());
      if (lastAudio?.page !== pageWindow || lastAudio.value !== audio) {
        postToPage(iframe, { ghost: 'audio', audio: { ...audio } });
        lastAudio = { page: pageWindow, value: audio };
      }
      if (!frameRequested && !pendingFrame) {
        frameRequested = true;
        postToPage(iframe, { ghost: 'frame' });
      }
    }
    const frame = pendingFrame;
    if (!frame) return;
    pendingFrame = null;
    try {
      if (!frameCanvas || frameCanvas.width !== frame.width || frameCanvas.height !== frame.height) {
        // A new size needs a new texture allocation.
        frameCanvas = document.createElement('canvas');
        frameCanvas.width = frame.width;
        frameCanvas.height = frame.height;
        texture.dispose();
        bindCanvas(frameCanvas);
      }
      const ctx = frameCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
        ctx.drawImage(frame, 0, 0);
        texture.needsUpdate = true;
      }
    } finally {
      frame.close();
    }
    if (!frameRequested && loadedUrl === blobUrl) {
      frameRequested = true;
      postToPage(iframe, { ghost: 'frame' });
    }
  };

  const updateTexture = () => {
    if (sandboxed) {
      updateSandboxedTexture();
      return;
    }
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

      if (lastBoundIframeCanvas !== iframeCanvas) bindCanvas(iframeCanvas);

      texture.needsUpdate = true;
    } catch {
      // Cross-origin or not ready yet — ignore.
    }
  };

  const updateParams = (params: PageParams) => {
    lastParams = { ...lastParams, ...params };
    if (sandboxed) {
      postToPage(iframe, { ghost: 'params', params });
      return;
    }
    try {
      const iframeWindow = iframe.contentWindow as Window & { shaderParams?: Record<string, unknown> };
      if (iframeWindow?.shaderParams) {
        Object.assign(iframeWindow.shaderParams, params);
      }
    } catch {
      // Cross-origin — ignore.
    }
  };

  const restart = (next: JSAnimationSource) => {
    runningHtml = next.htmlCode;
    context.animationType = next.animationType;
    navigate(next);
  };

  const follow = (next: JSAnimationSource) => {
    if (next.htmlCode !== runningHtml) restart(next);
  };

  const runs = (htmlCode: string) => htmlCode === runningHtml && !!blobUrl && loadedUrl === blobUrl;

  const readErrors = (): JSAnimationPageError[] => {
    if (!page) return [];
    if (sandboxed) return placedErrors(page, rawErrors);
    try {
      const pageWindow = iframe.contentWindow as (Window & { __ghostSketchErrors?: RawPageError[] }) | null;
      return placedErrors(page, cleanErrors(pageWindow?.__ghostSketchErrors));
    } catch {
      return [];
    }
  };

  // Safe to call more than once; only drops the cache entry if it is
  // still this context (the id may have been reused since).
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopListening();
    pendingFrame?.close();
    pendingFrame = null;
    texture.dispose();
    iframe.remove();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
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
    follow,
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

/**
 * Update parameters for a specific animation
 */
export function updateJSAnimationParams(id: string, params: PageParams): void {
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

// ---------------------------------------------------------------------------
// Pages played for a moment: thumbnails and trial runs

interface BriefPage {
  page: IframePage;
  iframe: HTMLIFrameElement;
  /** Errors the page has thrown so far. */
  errors(): JSAnimationPageError[];
  /** The page's canvas now, or null when it shows none in time. */
  frame(timeoutMs: number): Promise<CanvasImageSource | null>;
  close(): void;
}

async function openBriefPage(source: JSAnimationSource, width: number, height: number): Promise<BriefPage> {
  if (playsSandboxed(source)) await loadPageLibraries();
  const page = iframePage(source);
  const iframe = document.createElement('iframe');
  prepareIframe(iframe, page.sandboxed, width, height);
  const url = URL.createObjectURL(new Blob([page.html], { type: 'text/html' }));
  iframe.src = url;
  document.body.appendChild(iframe);
  let rawErrors: RawPageError[] = [];
  let waiting: ((bitmap: ImageBitmap) => void) | null = null;
  const stop = page.sandboxed
    ? listenToPage(iframe, (data) => {
      if (data.ghost === 'errors') rawErrors = cleanErrors(data.errors);
      else if (data.ghost === 'frame' && isImageBitmap(data.bitmap)) {
        if (waiting) waiting(data.bitmap);
        else data.bitmap.close();
      }
    })
    : () => {};
  let closed = false;
  return {
    page,
    iframe,
    errors() {
      if (page.sandboxed) return placedErrors(page, rawErrors);
      try {
        const pageWindow = iframe.contentWindow as (Window & { __ghostSketchErrors?: RawPageError[] }) | null;
        return placedErrors(page, cleanErrors(pageWindow?.__ghostSketchErrors));
      } catch {
        return [];
      }
    },
    frame(timeoutMs) {
      if (!page.sandboxed) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          const canvasEl = doc?.querySelector('canvas') as HTMLCanvasElement | null;
          return Promise.resolve(canvasEl && canvasEl.width > 0 ? canvasEl : null);
        } catch {
          return Promise.resolve(null);
        }
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => { waiting = null; resolve(null); }, timeoutMs);
        waiting = (bitmap) => { clearTimeout(timer); waiting = null; resolve(bitmap); };
        postToPage(iframe, { ghost: 'frame' });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
      iframe.remove();
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * Plays a page in a hidden iframe for a moment and keeps a picture of its
 * canvas as a JPEG data URL. For tray thumbnails and import previews; gives
 * up quietly when the page draws nothing in time.
 */
export async function captureJSAnimationThumbnail(
  page: string | JSAnimationSource,
  options: { width?: number; height?: number; waitMs?: number } = {},
): Promise<string | undefined> {
  const { width = 160, height = 90, waitMs = 2000 } = options;
  let brief: BriefPage;
  try {
    brief = await openBriefPage(asSource(page), width * 2, height * 2);
  } catch {
    return undefined;
  }
  // Most Three.js / p5 sketches paint within 100ms; raymarchers can take
  // longer. Capped so an import doesn't wait on a page that never draws.
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  try {
    const picture = await brief.frame(1000);
    if (!picture) return undefined;
    const thumb = document.createElement('canvas');
    thumb.width = width; thumb.height = height;
    const ctx = thumb.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(picture, 0, 0, thumb.width, thumb.height);
    if (isImageBitmap(picture)) picture.close();
    return thumb.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  } finally {
    brief.close();
  }
}

/**
 * Run a page for a moment in a hidden frame and report the errors it throws
 * while it starts and draws its first frames: what a layer playing it would
 * hit. Used before saving edited code, so code that throws is not saved.
 */
export async function trialRunJSAnimation(jsAnimation: JSAnimationSource, ms = 1500): Promise<JSAnimationPageError[]> {
  let brief: BriefPage;
  try {
    brief = await openBriefPage(jsAnimation, 320, 180);
  } catch (err) {
    return [{ message: err instanceof Error ? err.message : String(err), file: null, line: null, count: 1 }];
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
  // A sandboxed page sends its errors a moment after they happen.
  if (brief.page.sandboxed) await new Promise((resolve) => setTimeout(resolve, 300));
  const errors = brief.errors();
  brief.close();
  return errors;
}
