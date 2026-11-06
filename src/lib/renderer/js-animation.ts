/**
 * JavaScript Animation Renderer
 * Plays three.js and p5.js pages inside the editor window (layers when the
 * native core is not drawing them, thumbnails, previews, the check before a
 * sketch is saved), each in a sandboxed iframe that only talks to the editor
 * through messages (see sandboxPage.ts), and turns its pictures into a
 * texture.
 */

import * as THREE from 'three';
import type { JSAnimationSource } from '../types';
import { singlePlayableDocument, type SketchPlace } from '../p5sketch/wrapSketch';
import { getVisualAudioSnapshot, type VisualAudioState } from '../audio/visualAudio';
import { ghostAudioCommandFieldsFromVisualAudio } from '../audio/ghostAudioUniform';
import { invoke, isDesktopApp } from '../bridge';
import {
  createSandboxedFrame,
  inlineScriptText,
  listenToFrame,
  loadPageLibraries,
  newNonce,
  NO_LIBRARIES,
  pageRuntimeScript,
  postToFrame,
  THREE_CORE_SPECIFIER,
  type PageLibraries,
  type PageMessage,
} from './sandboxPage';

/** How a page is put together for a sandboxed iframe. */
export interface IframePageOptions {
  /** The bundled libraries, carried inside the page (an opaque origin cannot fetch the app's files). */
  libraries?: PageLibraries;
  /** Stamped on the page's messages; see sandboxPage.ts. */
  nonce?: string;
  /** No sound: for previews, thumbnails and checks nobody should hear. */
  muted?: boolean;
  /** The page says it is still running every 250 ms. */
  heartbeat?: boolean;
}

/**
 * Inject the runtime into user-supplied Three.js / p5.js HTML before loading
 * it into the sandboxed iframe.
 *
 * 1) The page runtime (sandboxPage.ts): errors, pictures of the canvas, the
 *    show's audio as window.ghostAudio and slider values all go through
 *    messages; devicePixelRatio is 1, since the host samples the canvas at 1x.
 *
 * 2) Bundled p5.js (and p5.sound when the page loads it), inline. A remote
 *    p5 tag in the page goes, so only one global-mode sketch starts.
 *
 * 3) Bundled three.js through an import map, as data: URLs, when the page
 *    imports `three`. Otherwise every layer's first frame stalls while it
 *    fetches three from a public CDN, and the app refuses to work offline.
 *
 * Shims are inserted as early as possible: first inside <head> if it
 * exists, else first inside <body>, else prepended to the document. Tags
 * that go keep their line breaks, so every line of the page keeps its
 * number for error reports.
 */
function injectIframeRuntimeShims(html: string, options: IframePageOptions): { html: string; layout: ShimLayout } {
  const libraries = options.libraries ?? NO_LIBRARIES;
  const wantsP5 = /p5\.(min\.)?js|new\s+p5\s*\(/i.test(html);
  let wantsSound = false;
  if (wantsP5) {
    const breaks = (tag: string) => tag.replace(/[^\n]/g, '');
    html = html
      .replace(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']*\/p5(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi, breaks)
      .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*\bp5\.sound(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi, (tag) => {
        wantsSound = true;
        return breaks(tag);
      });
  }
  const wantsThree = /["']three(?:\/[^"']*)?["']/.test(html) && !!libraries.threeModuleUrl;

  // The import map MUST come before any <script type="module"> that imports
  // 'three', so injecting at the very start of <head> is correct.
  const importMap = wantsThree
    ? { imports: { three: libraries.threeModuleUrl, [THREE_CORE_SPECIFIER]: libraries.threeCoreUrl } }
    : null;
  const shims = [
    `<script>${pageRuntimeScript({
      nonce: options.nonce ?? '',
      muted: options.muted,
      heartbeat: options.heartbeat,
      silentAudio: SILENT_PAGE_AUDIO as unknown as Record<string, number | boolean>,
    })}</script>`,
    importMap ? `<script type="importmap">${JSON.stringify(importMap)}</script>` : '',
    wantsP5 ? `<script data-ghost-lib="p5">${inlineScriptText(libraries.p5)}</script>` : '',
    wantsSound ? `<script data-ghost-lib="p5.sound">${inlineScriptText(libraries.p5Sound)}</script>` : '',
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

/**
 * The same reading the offscreen page hosts send on desktop
 * (ghostAudioCommandFieldsFromVisualAudio), so a page hears the same values
 * wherever it plays.
 */
export function pageAudioFrom(audio: VisualAudioState): PageAudio {
  const { beat_phase, ...fields } = ghostAudioCommandFieldsFromVisualAudio(audio);
  return { ...fields, beatPhase: beat_phase };
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

/**
 * The page an iframe plays for a source, its loops guarded (see
 * p5sketch/loopGuard.ts) so a loop that never ends stops with an error
 * instead of keeping the page busy.
 */
export function iframePage(jsAnimation: JSAnimationSource, options: IframePageOptions = {}): IframePage {
  const document = singlePlayableDocument(jsAnimation, { guardLoops: true });
  const { html, layout } = injectIframeRuntimeShims(document.html, options);
  return {
    html,
    place(line) {
      const written = writtenLine(layout, line);
      return written === null ? null : document.place(written);
    },
  };
}

/** The document an iframe plays for a source (or a page's HTML), with the bundled libraries. */
export function jsAnimationIframeHtml(page: string | JSAnimationSource, options: IframePageOptions = {}): string {
  return iframePage(asSource(page), options).html;
}

function asSource(page: string | JSAnimationSource): JSAnimationSource {
  return typeof page === 'string' ? { animationType: 'threejs', htmlCode: page } : page;
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
  /**
   * The page's latest picture, drawn here as it arrives. A stable canvas: a
   * 1×1 black placeholder until the first picture, then the canvas's size.
   */
  readonly canvas: HTMLCanvasElement;
  /** Stable CanvasTexture of `canvas`. */
  texture: THREE.CanvasTexture;
  animationType: 'threejs' | 'p5js';
  updateTexture: () => void;
  updateParams: (params: Record<string, number | boolean | number[] | string>) => void;
  /**
   * Plays new code in the same iframe, so the texture, the iframe element
   * and everything holding them stay valid while the page restarts.
   */
  restart: (jsAnimation: JSAnimationSource) => void;
  /**
   * Restarts the page when `jsAnimation` holds other code than it runs. A
   * source keeps its id when its code changes (the sketch editor, undo and
   * redo), so whatever plays it calls this with the code it holds now.
   */
  follow: (jsAnimation: JSAnimationSource) => void;
  /** True once the page built from `htmlCode` has loaded and is running. */
  runs: (htmlCode: string) => boolean;
  /** Uncaught errors the page has thrown so far. */
  readErrors: () => JSAnimationPageError[];
  dispose: () => void;
}

/** Pictures a layer's page sends at most this often. */
const LAYER_FPS = 60;
/** A page whose pictures nobody has looked at for this long waits before sending the next. */
const IDLE_MS = 1000;
const MAX_ERRORS = 12;

type ParamValue = number | boolean | number[] | string;

/** Uncaught errors as a page reports them, counted, traced through `page`. */
class PageErrors {
  private list: Array<{ message: string; line: number | null; lines: number[]; count: number }> = [];

  add(data: PageMessage): void {
    const message = String(data.message ?? 'Error').slice(0, 1000);
    const line = typeof data.line === 'number' && Number.isFinite(data.line) ? data.line : null;
    const lines = Array.isArray(data.lines)
      ? data.lines.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).slice(0, 10)
      : line !== null ? [line] : [];
    const known = this.list.find((e) => e.message === message && e.line === line);
    if (known) known.count++;
    else if (this.list.length < MAX_ERRORS) this.list.push({ message, line, lines, count: 1 });
  }

  read(page: IframePage | null): JSAnimationPageError[] {
    return this.list.map((e) => {
      // The innermost line of the author's own code: an error raised inside
      // p5 by a call from the sketch points at that call.
      let place: SketchPlace | null = null;
      for (const line of e.lines) {
        place = page?.place(line) ?? null;
        if (place) break;
      }
      return { message: e.message, file: place?.file ?? null, line: place?.line ?? null, count: e.count };
    });
  }
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

  // The page plays in a sandboxed iframe of its own (see sandboxPage.ts)
  // and sends pictures of its canvas, which are drawn into `output`; the
  // texture samples `output`, so it and the canvas stay the same objects
  // however often the page restarts.
  const iframe = createSandboxedFrame(width, height);
  document.body.appendChild(iframe);

  // Stable 1×1 black picture until the page's first one arrives.
  const output = document.createElement('canvas');
  output.width = 1;
  output.height = 1;
  const outputContext = output.getContext('2d');
  if (outputContext) { outputContext.fillStyle = '#000'; outputContext.fillRect(0, 0, 1, 1); }

  const texture = new THREE.CanvasTexture(output);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  let disposed = false;
  let page: IframePage | null = null;
  let runningHtml = jsAnimation.htmlCode;
  let nonce = '';
  let blobUrl = '';
  let loaded = false;
  let errors = new PageErrors();
  let params: Record<string, ParamValue> = { ...(jsAnimation.paramValues ?? {}) };
  let lastAudio: Readonly<PageAudio> | null = null;
  let freshPicture = false;
  let ackOwed = false;
  let lookedAt = performance.now();
  let startSerial = 0;

  const post = (message: PageMessage) => {
    if (nonce) postToFrame(iframe, nonce, message);
  };

  const takeAck = () => {
    if (!ackOwed) return;
    ackOwed = false;
    post({ type: 'ack' });
  };

  const onPicture = (data: PageMessage) => {
    const bitmap = data.bitmap as ImageBitmap | undefined;
    if (!bitmap || typeof bitmap !== 'object') return;
    try {
      if (disposed || !outputContext) return;
      if (output.width !== bitmap.width || output.height !== bitmap.height) {
        output.width = bitmap.width;
        output.height = bitmap.height;
      }
      outputContext.clearRect(0, 0, output.width, output.height);
      outputContext.drawImage(bitmap, 0, 0);
      freshPicture = true;
    } catch {
      /* a picture that cannot be drawn is skipped */
    } finally {
      bitmap.close?.();
    }
    // The next picture comes once this one is taken; nobody looking for a
    // while means the page waits until someone does.
    ackOwed = true;
    if (performance.now() - lookedAt < IDLE_MS) takeAck();
  };

  const stopListening = listenToFrame(iframe, (data) => {
    if (data.ghost !== nonce || disposed) return;
    switch (data.type) {
      case 'hello':
        ackOwed = false;
        lastAudio = null;
        post({ type: 'frames', on: true, fps: LAYER_FPS });
        if (Object.keys(params).length > 0) post({ type: 'params', values: params });
        break;
      case 'loaded':
        loaded = true;
        break;
      case 'error':
        errors.add(data);
        break;
      case 'frame':
        onPicture(data);
        break;
    }
  });

  const start = (next: JSAnimationSource) => {
    const serial = ++startSerial;
    runningHtml = next.htmlCode;
    loaded = false;
    errors = new PageErrors();
    params = { ...(next.paramValues ?? {}), ...params };
    void loadPageLibraries().then((libraries) => {
      if (disposed || serial !== startSerial) return;
      nonce = newNonce();
      try {
        page = iframePage(next, { libraries, nonce });
      } catch (err) {
        page = null;
        errors.add({ type: 'error', message: err instanceof Error ? err.message : String(err), line: null });
        return;
      }
      const previousUrl = blobUrl;
      blobUrl = URL.createObjectURL(new Blob([page.html], { type: 'text/html' }));
      iframe.src = blobUrl;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    });
  };

  const updateTexture = () => {
    lookedAt = performance.now();
    takeAck();
    const audio = currentPageAudio(lookedAt);
    if (audio !== lastAudio) {
      lastAudio = audio;
      post({ type: 'audio', value: audio });
    }
    if (freshPicture) {
      freshPicture = false;
      texture.needsUpdate = true;
    }
  };

  const updateParams = (values: Record<string, ParamValue>) => {
    params = { ...params, ...values };
    post({ type: 'params', values });
  };

  const restart = (next: JSAnimationSource) => {
    start(next);
    context.animationType = next.animationType;
  };

  const follow = (next: JSAnimationSource) => {
    if (next.htmlCode !== runningHtml) restart(next);
  };

  const runs = (htmlCode: string) => htmlCode === runningHtml && loaded;

  const readErrors = (): JSAnimationPageError[] => errors.read(page);

  // Safe to call more than once; only drops the cache entry if it is
  // still this context (the id may have been reused since).
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopListening();
    texture.dispose();
    iframe.remove();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    if (jsAnimationCache.get(id) === context) jsAnimationCache.delete(id);
  };

  const context: JSAnimationContext = {
    id,
    iframe,
    get canvas() {
      // Whoever reads the picture is looking at it.
      lookedAt = performance.now();
      takeAck();
      return output;
    },
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

  start(jsAnimation);
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
 * Plays a page for a moment in a hidden, muted, sandboxed frame and lets
 * `finish` read what it sent. The frame goes when `finish` returns.
 */
async function playBriefly<T>(
  page: string | JSAnimationSource,
  options: { width: number; height: number; heartbeat?: boolean },
  run: (session: {
    page: IframePage;
    iframe: HTMLIFrameElement;
    post: (message: PageMessage) => void;
    onMessage: (listener: (data: PageMessage) => void) => void;
  }) => Promise<T>,
): Promise<T> {
  const libraries = await loadPageLibraries();
  const nonce = newNonce();
  const built = iframePage(asSource(page), { libraries, nonce, muted: true, heartbeat: options.heartbeat });
  const iframe = createSandboxedFrame(options.width, options.height);
  const url = URL.createObjectURL(new Blob([built.html], { type: 'text/html' }));
  const listeners: Array<(data: PageMessage) => void> = [];
  const stop = listenToFrame(iframe, (data) => {
    if (data.ghost !== nonce) return;
    for (const listener of listeners) listener(data);
  });
  iframe.src = url;
  document.body.appendChild(iframe);
  try {
    return await run({
      page: built,
      iframe,
      post: (message) => postToFrame(iframe, nonce, message),
      onMessage: (listener) => listeners.push(listener),
    });
  } finally {
    stop();
    iframe.remove();
    URL.revokeObjectURL(url);
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  return playBriefly(page, { width: width * 2, height: height * 2 }, async ({ post, onMessage }) => {
    // Most Three.js / p5 sketches paint within 100ms; raymarchers can take
    // longer. Capped so an import doesn't wait on a page that never draws.
    let answer: ((bitmap: ImageBitmap | null) => void) | null = null;
    onMessage((data) => {
      if (data.type !== 'still' || !answer) return;
      const bitmap = data.bitmap && typeof data.bitmap === 'object' ? data.bitmap as ImageBitmap : null;
      answer(bitmap);
      answer = null;
    });
    await delay(waitMs);
    const bitmap = await new Promise<ImageBitmap | null>((resolve) => {
      answer = resolve;
      post({ type: 'still', width, height });
      // A page that stopped responding sends nothing.
      setTimeout(() => { answer?.(null); answer = null; }, 1000);
    });
    if (!bitmap) return undefined;
    try {
      const thumb = document.createElement('canvas');
      thumb.width = width; thumb.height = height;
      const ctx = thumb.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(bitmap, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL('image/jpeg', 0.7);
    } catch {
      return undefined;
    } finally {
      bitmap.close?.();
    }
  }).catch(() => undefined);
}

/**
 * A picture of a page for the media library or an import preview. On
 * desktop it is drawn by a short-lived, muted offscreen host outside the
 * editor (electron/js-source-host.js); elsewhere in a sandboxed iframe.
 */
export async function captureJSAnimationPicture(
  page: string | JSAnimationSource,
  options: { width?: number; height?: number; waitMs?: number } = {},
): Promise<string | undefined> {
  if (isDesktopApp) {
    const html = singlePlayableDocument(asSource(page)).html;
    const result = await invoke<{ ok: boolean; data_url?: string }>('js_source_thumbnail', {
      html,
      width: options.width,
      height: options.height,
      settle_ms: options.waitMs,
    }).catch(() => null);
    return result?.ok ? result.data_url : undefined;
  }
  return captureJSAnimationThumbnail(page, options);
}

/** What a trial run says when the page stopped answering. */
export const PAGE_STOPPED_RESPONDING = 'The code stopped responding while it ran: it may be stuck in a loop that never ends.';

/**
 * Run a page for a moment out of sight and report the errors it throws
 * while it starts and draws its first frames: what a layer playing it would
 * hit. Used before saving edited code, so code that throws is not saved.
 *
 * Its loops are guarded, so one that never ends is reported on its line.
 * On desktop it runs in an offscreen host of its own, outside the editor's
 * process; elsewhere in a sandboxed iframe. Either way it is muted, and a
 * page that stops answering is reported too.
 */
export async function trialRunJSAnimation(jsAnimation: JSAnimationSource, ms = 1500): Promise<JSAnimationPageError[]> {
  if (isDesktopApp) {
    const hosted = await trialRunInHost(jsAnimation, ms);
    if (hosted) return hosted;
  }
  return playBriefly(jsAnimation, { width: 320, height: 180, heartbeat: true }, async ({ page, onMessage }) => {
    const errors = new PageErrors();
    let lastHeard = 0;
    onMessage((data) => {
      if (data.type === 'error') errors.add(data);
      lastHeard = performance.now();
    });
    await delay(ms);
    const found = errors.read(page);
    // Quiet for a second: the page is busy and not coming back.
    if (found.length === 0 && performance.now() - lastHeard > 1000) {
      return [{ message: PAGE_STOPPED_RESPONDING, file: null, line: null, count: 1 }];
    }
    return found;
  }).catch((err) => [{ message: err instanceof Error ? err.message : String(err), file: null, line: null, count: 1 }]);
}

interface HostTrialResult {
  ok: boolean;
  errors?: Array<{ message: string; line: number | null; count: number }>;
  responding?: boolean;
}

/** The trial in a desktop host, or null when there is none to run it. */
async function trialRunInHost(jsAnimation: JSAnimationSource, ms: number): Promise<JSAnimationPageError[] | null> {
  let document: ReturnType<typeof singlePlayableDocument>;
  try {
    document = singlePlayableDocument(jsAnimation, { guardLoops: true });
  } catch (err) {
    return [{ message: err instanceof Error ? err.message : String(err), file: null, line: null, count: 1 }];
  }
  const result = await invoke<HostTrialResult>('js_source_trial', { html: document.html, ms }).catch(() => null);
  if (!result?.ok) return null;
  const errors: JSAnimationPageError[] = (result.errors ?? []).map((e) => {
    const place = typeof e.line === 'number' ? document.place(e.line) : null;
    return { message: String(e.message), file: place?.file ?? null, line: place?.line ?? null, count: e.count || 1 };
  });
  if (errors.length === 0 && result.responding === false) {
    errors.push({ message: PAGE_STOPPED_RESPONDING, file: null, line: null, count: 1 });
  }
  return errors;
}
