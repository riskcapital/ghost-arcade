/**
 * The editor side of the offscreen three.js / p5.js page hosts
 * (electron/js-source-host.js).
 *
 * The native sync flush calls `use()` for every visible JavaScript source it
 * cannot turn into a core shader. A host opens the first time its source is
 * used, and closes once nothing has used it for LINGER_MS, so a VJ clip that
 * comes back a few seconds later is still running. While it lingers unused it
 * stops painting (PAUSE_MS after its last use): the page keeps its state and
 * clock, but sends no frames nobody shows. Each host sends its own
 * frames to the core under the source's id; this side only decides which
 * hosts should exist and forwards parameters and audio to them.
 */
import { invoke, isDesktopApp } from '../bridge';
import type { JSAnimationSource } from '../types';
import type { VisualAudioState } from '../audio/visualAudio';
import { ghostAudioCommandFieldsFromVisualAudio } from '../audio/ghostAudioUniform';
import { nativeShaderSourceFromJavascript } from './nativeJsShaderSource';
import { setJSAnimationParamForwarder } from './js-animation';
import { singlePlayablePage } from '../p5sketch/wrapSketch';

const JS_SOURCE_TYPES = new Set(['threejs', 'p5js', 'javascript']);
const LINGER_MS = 20_000;
/** Unused this long, a host stops painting until it is used again. */
const PAUSE_MS = 1_000;
/** How often the singleton sweeps on its own, so hosts are reaped even when
 *  no frame sync runs (an empty scene, a hidden editor). */
const AUTO_SWEEP_MS = 1_000;
const RETRY_MS = 2_000;
const RECONCILE_MS = 2_000;
const AUDIO_PUSH_MS = 33;
const HOST_FPS = 60;
const MAX_HOST_EDGE = 1920;

type ParamValue = number | boolean | number[] | string;
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<any>;

export interface JsCanvasSourceLike {
  id: string;
  type?: string | null;
  jsAnimation?: JSAnimationSource | null;
}

const htmlHashes = new WeakMap<JSAnimationSource, { html: string; hash: string; canvas: boolean }>();

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// Both answers are recomputed only when the page text changes: the flush asks
// several times per layer per frame, and pages can be tens of kilobytes.
function describePage(jsAnimation: JSAnimationSource): { hash: string; canvas: boolean } {
  const html = jsAnimation.htmlCode ?? '';
  const cached = htmlHashes.get(jsAnimation);
  if (cached && cached.html === html) return cached;
  const entry = {
    html,
    hash: fnv1a(html),
    canvas: html.trim().length > 0 && !nativeShaderSourceFromJavascript(jsAnimation),
  };
  htmlHashes.set(jsAnimation, entry);
  return entry;
}

/**
 * A JavaScript source the core cannot render itself. Pages that reduce to a
 * single fragment shader take the faster shader path instead.
 */
export function isNativeJsCanvasSource(src: JsCanvasSourceLike | null | undefined): boolean {
  if (!src?.jsAnimation || !JS_SOURCE_TYPES.has(String(src.type ?? '').toLowerCase())) return false;
  return describePage(src.jsAnimation).canvas;
}

export function nativeJsCanvasUri(src: JsCanvasSourceLike): string {
  const hash = src.jsAnimation ? describePage(src.jsAnimation).hash : '0';
  return `native-js-canvas://${encodeURIComponent(src.id)}/${hash}`;
}

/**
 * The page's viewport. It follows the output's aspect so the page composes
 * for the screen it lands on, and it never exceeds the core's source slot,
 * because the core writes these frames into the slot without resampling.
 */
export function jsCanvasHostSize(outputWidth: number, outputHeight: number, slotSize: number) {
  const aspect = outputWidth > 0 && outputHeight > 0 ? outputWidth / outputHeight : 16 / 9;
  const edge = Math.max(256, Math.min(MAX_HOST_EDGE, Math.floor(slotSize) || MAX_HOST_EDGE));
  const width = aspect >= 1 ? edge : Math.round(edge * aspect);
  const height = aspect >= 1 ? Math.round(edge / aspect) : edge;
  return { width: Math.max(16, width - (width % 2)), height: Math.max(16, height - (height % 2)) };
}

function initialParams(jsAnimation: JSAnimationSource): Record<string, ParamValue> {
  const values: Record<string, ParamValue> = {};
  for (const param of jsAnimation.params ?? []) values[param.name] = param.default;
  return { ...values, ...(jsAnimation.paramValues ?? {}) };
}

interface HostRecord {
  signature: string;
  lastUsedAt: number;
  ready: boolean;
  opening: boolean;
  failedAt: number;
  /** The control values the page last received (open or setParams). */
  params: string;
  /** Render to video: the render frame that last showed this page. */
  usedFrame: number;
  /** Told to stop painting while it lingers unused. */
  paused: boolean;
}

/** The fields a page reads as window.ghostAudio. */
export function pageAudioFields(visual: VisualAudioState): Record<string, number | boolean> {
  const f = ghostAudioCommandFieldsFromVisualAudio(visual);
  return {
    level: f.level,
    bass: f.bass,
    mid: f.mid,
    treble: f.treble,
    high: f.high,
    beat: f.beat,
    beatPhase: f.beat_phase,
    bpm: f.bpm,
    centroid: f.centroid,
    kick: f.kick,
    snare: f.snare,
    active: f.active,
  };
}

export class NativeJsCanvasHosts {
  private readonly records = new Map<string, HostRecord>();
  private lastAudioAt = 0;
  private lastReconcileAt = 0;
  private reconciling = false;
  /** Render to video: pages are on the render's clock, stepped a frame at a time. */
  private renderClock = false;
  private renderFrame = 0;

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** `autoSweepMs` > 0: sweep on a timer while any host exists, as well as
   *  from the frame sync. Off by default so tests drive the clock. */
  constructor(private readonly call: Invoke, private readonly autoSweepMs = 0) {}

  private armSweepTimer(): void {
    if (this.autoSweepMs <= 0 || this.sweepTimer !== null || this.records.size === 0) return;
    this.sweepTimer = setInterval(() => {
      this.sweep(Date.now());
      if (this.records.size === 0 && this.sweepTimer !== null) {
        clearInterval(this.sweepTimer);
        this.sweepTimer = null;
      }
    }, this.autoSweepMs);
  }

  /** Paint again right away when a lingering host is used. */
  private resume(id: string, record: HostRecord): void {
    if (!record.paused) return;
    record.paused = false;
    void this.call('js_source_paint', { id, paint: true }).catch(() => {});
  }

  /**
   * Keep the host for `src` open this frame. Returns true once the host
   * exists, so its frames can be expected; false while it is still opening.
   */
  use(src: JsCanvasSourceLike, width: number, height: number, now = Date.now()): boolean {
    const jsAnimation = src.jsAnimation;
    if (!jsAnimation?.htmlCode) return false;
    const signature = `${describePage(jsAnimation).hash}:${width}x${height}`;
    const record = this.records.get(src.id);
    if (record) {
      record.lastUsedAt = now;
      record.usedFrame = this.renderFrame;
      if (record.opening) return false;
      if (record.signature === signature) {
        if (record.ready) {
          this.resume(src.id, record);
          // Values that change without an edit in the panel (timeline lines,
          // keyframes) reach an open page here.
          const params = JSON.stringify(jsAnimation.paramValues ?? {});
          if (params !== record.params) {
            record.params = params;
            void this.call('js_source_params', { id: src.id, values: initialParams(jsAnimation) }).catch(() => {});
          }
          return true;
        }
        if (now - record.failedAt < RETRY_MS) return false;
      }
    }
    const next: HostRecord = { signature, lastUsedAt: now, ready: false, opening: true, failedAt: 0, params: JSON.stringify(jsAnimation.paramValues ?? {}), usedFrame: this.renderFrame, paused: false };
    this.records.set(src.id, next);
    this.armSweepTimer();
    this.call('js_source_open', {
      id: src.id,
      // A sketch kept as files plays as one document with its files folded
      // in: the host serves only the page and the bundled libraries.
      html: singlePlayablePage(jsAnimation),
      width,
      height,
      fps: HOST_FPS,
      params: initialParams(jsAnimation),
    })
      .then((result) => {
        next.ready = !!result?.ok;
        if (!next.ready) next.failedAt = Date.now();
      })
      .catch(() => {
        next.failedAt = Date.now();
      })
      .finally(() => {
        next.opening = false;
      });
    return false;
  }

  isOpen(id: string): boolean {
    return this.records.get(id)?.ready === true;
  }

  /** Close hosts nothing has used lately, and notice ones closed on the other side. */
  sweep(now = Date.now()): void {
    for (const [id, record] of this.records) {
      if (record.opening) continue;
      if (now - record.lastUsedAt < LINGER_MS) {
        // A render steps every page it shows; pages it does not show are
        // reloaded when it ends, so only live hosts pause.
        if (record.ready && !record.paused && !this.renderClock && now - record.lastUsedAt >= PAUSE_MS) {
          record.paused = true;
          void this.call('js_source_paint', { id, paint: false }).catch(() => {});
        }
        continue;
      }
      this.records.delete(id);
      void this.call('js_source_close', { id }).catch(() => {});
    }
    if (this.records.size === 0 || this.reconciling || now - this.lastReconcileAt < RECONCILE_MS) return;
    this.lastReconcileAt = now;
    this.reconciling = true;
    this.call('js_source_status')
      .then((status) => {
        const open = new Set<string>((status?.hosts ?? []).map((host: { id: string }) => host.id));
        for (const [id, record] of this.records) {
          // Evicted, crashed, or closed with the core: reopen on next use.
          if (record.ready && !open.has(id)) {
            record.ready = false;
            record.paused = false;
            record.failedAt = 0;
            record.signature = '';
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        this.reconciling = false;
      });
  }

  /** Live audio for the pages, as `window.ghostAudio`, about 30 times a second. */
  pushAudio(visual: VisualAudioState, now = Date.now()): void {
    // In a render each step carries its frame's own analysis.
    if (this.renderClock) return;
    if (this.records.size === 0 || now - this.lastAudioAt < AUDIO_PUSH_MS) return;
    this.lastAudioAt = now;
    void this.call('js_source_audio', { fields: pageAudioFields(visual) }).catch(() => {});
  }

  /**
   * Render to video: put the pages on the render's clock (they load again
   * and start from their beginning) or back on the wall clock. `dateMs` is
   * what Date.now() reads at the render's first frame.
   */
  async setRenderClock(on: boolean, dateMs = Date.now()): Promise<void> {
    this.renderClock = on;
    this.renderFrame = 0;
    // Every page reloads on the new clock and paints again.
    for (const record of this.records.values()) record.paused = false;
    await this.call('js_source_render_clock', { on, dateMs });
  }

  /**
   * One render frame for the pages it shows (the ones the frame's sync used):
   * each moves to `time` (seconds), draws with `audio`, and its frame is in
   * the core when this returns. Throws, naming the page, when one does not
   * answer.
   */
  async stepRender(time: number, audio: Record<string, number | boolean>, nameOf: (id: string) => string = (id) => id): Promise<void> {
    if (!this.renderClock) return;
    const frame = this.renderFrame++;
    const ids = [...this.records].filter(([, r]) => r.usedFrame === frame).map(([id]) => id);
    if (!ids.length) return;
    const result = await this.call('js_source_step', { ids, time, audio });
    if (result?.ok) return;
    const failed = (result?.failed ?? []) as Array<{ id: string; reason: string }>;
    const what = failed.map((f) => `"${nameOf(f.id)}": ${f.reason}`).join('; ') || 'no answer';
    throw new Error(`A three.js / p5.js page could not be rendered frame by frame (${what}). A page can keep its own clock with <meta name="ghost-arcade-clock" content="live">.`);
  }

  setParams(id: string, values: Record<string, ParamValue>): void {
    const record = this.records.get(id);
    if (!record) return;
    record.params = '';
    void this.call('js_source_params', { id, values }).catch(() => {});
  }

  closeAll(): void {
    for (const id of this.records.keys()) void this.call('js_source_close', { id }).catch(() => {});
    this.records.clear();
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

export const nativeJsCanvasHosts = new NativeJsCanvasHosts((command, args) => invoke(command, args), AUTO_SWEEP_MS);

if (isDesktopApp) {
  setJSAnimationParamForwarder((id, params) => nativeJsCanvasHosts.setParams(id, params));
}
