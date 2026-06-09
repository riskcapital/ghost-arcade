/**
 * gpuLayerRenderer — per-`gpu`-layer orchestrator.
 *
 * For each gpu layer in the project there's one instance owning:
 *   - An OffscreenCanvas (or HTMLCanvasElement) with a webgpu context.
 *   - A `GpuShaderImpl` (planet, particles, etc.) determined by the
 *     layer's content.shaderId. Hot-swappable when the user picks a
 *     different shader from the panel — old impl is disposed, new
 *     one created on the fly.
 *   - Per-frame loop: read params from store, encode work, render
 *     to the canvas. The canvas is exposed to the legacy engine via
 *     `getCanvas()` so the engine treats it like a media layer's
 *     source — gets warp / blend / mesh / per-layer effects for free.
 *
 * One renderer per gpu layer means stateful shaders (e.g. pixel-fx
 * with persistent particle buffers, fluid sim with accumulating
 * fields) keep their state across frames without sharing it across
 * layers.
 */

import type { GpuShaderImpl } from './gpuShaderTypes';
import { getShaderDef } from './gpuShaderCatalog';
import { SpoutCanvasReceiver } from './spoutCanvasReceiver';

// Lightweight context the renderer needs to resolve sources for
// shaders with `needsSource: true`. The caller (Canvas.svelte) hands
// us the project's layer list + the media library snapshot per
// frame so we can look up source layers / media items by id.
export interface SourceContext {
  layers: any[];           // project.layers
  mediaItems: any[];       // mediaLibrary store value
}

/** Audio-bands snapshot for shaders that opt into reactivity (e.g.
 *  flythrough's audio-reactive toggle). Each band is normalized 0..1
 *  from the audio analyzer. Shaders detect support via a duck-typed
 *  `setBands(bass, mid, treble)` method on the impl. */
export interface AudioBandsSnapshot {
  bass: number;
  mid: number;
  treble: number;
}

export type GpuLayerHandoffMode = 'bitmap' | 'canvas';

export class GpuLayerRenderer {
  readonly device: any;
  readonly presentFormat: any;
  /** Output surface — `OffscreenCanvas` so the per-frame handoff to
   *  the host's WebGL2 compositor uses `transferToImageBitmap()` →
   *  `texImage2D(ImageBitmap)` (Path D in
   *  [[zero-copy-texture-paths]]). An HTMLCanvasElement with a WebGPU
   *  context would force Chromium into a Skia readback path
   *  (~14 ms / frame at 4K). Same fix as `arcade/engine/ArcadeRenderer`. */
  readonly canvas: OffscreenCanvas;
  private context: any;
  /** Latest output frame as a GPU-resident ImageBitmap. Created in
   *  `renderFrame()` via `transferToImageBitmap()`. Consumed by
   *  Canvas.svelte each frame; consumer takes ownership and must
   *  close it when done. */
  private latestBitmap: ImageBitmap | null = null;
  private impl: GpuShaderImpl | null = null;
  private currentShaderId: string | null = null;
  private lastFrameTime = performance.now();
  private configuredW = 0;
  private configuredH = 0;
  private handoffMode: GpuLayerHandoffMode;

  // Source-resolution state for shaders that consume external pixels
  // (pixel-particles etc). Cached per-renderer so videos don't have
  // to be re-created when params change but the source stays the same.
  private cachedVideoEl: HTMLVideoElement | null = null;
  private cachedVideoSrc: string = '';
  private lastResolvedSourceKey: string = '';
  private pendingImage: HTMLImageElement | null = null;

  // Camera (getUserMedia) state — one MediaStream per renderer, swapped
  // when the user picks a different deviceId. The stream is wired to
  // the same `cachedVideoEl` we use for file/media-library videos so
  // the shader's `setSource(HTMLVideoElement)` path doesn't have to
  // distinguish.
  private cameraStream: MediaStream | null = null;
  private cameraDeviceId: string = '';

  // Spout / Syphon receiver — owns its own polling loop + raw-bytes
  // frame buffer. Lazily created when the user picks a Spout source;
  // reused across sender changes (the receiver itself swaps its
  // internal sender). lastSpoutFrameId lets us skip GPU uploads when
  // the polling loop hasn't received a new frame since the last render.
  private spoutReceiver: SpoutCanvasReceiver | null = null;
  private lastSpoutFrameId = 0;

  constructor(
    device: any,
    presentFormat: any,
    initialW: number = 1920,
    initialH: number = 1080,
    options: { handoffMode?: GpuLayerHandoffMode } = {},
  ) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.handoffMode = options.handoffMode ?? 'bitmap';
    this.canvas = new OffscreenCanvas(initialW, initialH);
    const ctx = this.canvas.getContext('webgpu') as any;
    if (!ctx) throw new Error('webgpu context unavailable on gpu-layer canvas');
    this.context = ctx;
    this.context.configure({
      device: this.device,
      format: this.presentFormat,
      alphaMode: 'premultiplied',
    });
    this.configuredW = initialW;
    this.configuredH = initialH;
  }

  /** Called per frame from Canvas.svelte. Resolves the active shader,
   *  applies params, encodes the frame. Cheap when nothing changes
   *  (impl reuses pipelines + state).
   *
   *  `bands` is the latest audio-analyzer snapshot for shaders that
   *  opt into reactivity. We duck-type-detect a `setBands` method on
   *  the impl so non-reactive shaders aren't burdened with a no-op.
   *  Pumped every frame regardless of the shader's own audioReactive
   *  toggle — the impl decides whether to use it. */
  renderFrame(
    shaderId: string,
    params: Record<string, any>,
    w: number,
    h: number,
    sourceCtx?: SourceContext,
    bands?: AudioBandsSnapshot,
  ): void {
    if (!this.impl || this.currentShaderId !== shaderId) {
      this.swapShader(shaderId);
    }
    if (!this.impl) return;

    if (w !== this.configuredW || h !== this.configuredH) this.resize(w, h);

    // Apply latest params (cheap setter).
    this.impl.setParams(params);
    // Pump audio bands into the impl if it supports them. setBands
    // is intentionally NOT part of the GpuShaderImpl interface so
    // shaders can opt in without bloating the interface; the runner
    // duck-types it here.
    if (bands && typeof (this.impl as any).setBands === 'function') {
      (this.impl as any).setBands(bands.bass, bands.mid, bands.treble);
    }

    // Resolve + feed source if the shader consumes external pixels.
    const def = getShaderDef(shaderId);
    if (def?.needsSource && this.impl.setSource && sourceCtx) {
      this.feedSource(params, sourceCtx);
    }

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    const encoder = this.device.createCommandEncoder();
    try {
      const view = this.context.getCurrentTexture().createView();
      this.impl.encodeFrame(encoder, view, this.presentFormat, this.canvas.width, this.canvas.height, dt);
    } catch (err: any) {
      console.warn('[gpuLayerRenderer] encode failed:', err?.message || err);
      return;
    }
    this.device.queue.submit([encoder.finish()]);

    if (this.handoffMode === 'canvas') {
      if (this.latestBitmap) {
        try { this.latestBitmap.close(); } catch { /* */ }
        this.latestBitmap = null;
      }
      return;
    }

    // Zero-copy bitmap handoff. `transferToImageBitmap()` reparents
    // the OffscreenCanvas's SharedImage backing (IOSurface on macOS)
    // to the new ImageBitmap — no copy. The compositor's
    // `texImage2D(ImageBitmap)` on the next consume call routes via
    // SharedImageInterface, GPU-resident throughout.
    try {
      if (this.latestBitmap) {
        // Caller didn't pick up the last bitmap — close it before
        // replacing so its SharedImage backing isn't leaked.
        try { this.latestBitmap.close(); } catch { /* */ }
      }
      this.latestBitmap = this.canvas.transferToImageBitmap();
    } catch {
      this.latestBitmap = null;
    }
  }

  /** Hand the most recent ImageBitmap to the host compositor and
   *  clear our reference. The caller takes ownership and is
   *  responsible for closing the previous bitmap when a fresh one
   *  arrives. Returns null when no fresh frame is available. */
  consumeOutputBitmap(): ImageBitmap | null {
    const b = this.latestBitmap;
    this.latestBitmap = null;
    return b;
  }

  /** Resolve the source param into an actual element + hand it to
   *  the shader. Source param shape:
   *    { type: 'media' | 'layer' | 'file' | 'camera' | 'spout',
   *      mediaId?, layerId?, url?, mime?, deviceId?, senderName? }
   *  Behaviour mirrors the legacy WebGPUCanvas pixel-fx wiring,
   *  extended to cover live capture sources (webcam + Spout/Syphon). */
  private feedSource(params: Record<string, any>, ctx: SourceContext): void {
    if (!this.impl?.setSource) return;
    const src = params.source;

    // The camera + spout sources are stateful — when the user switches
    // AWAY from one, release its resources so we don't leave a webcam
    // light on or a Spout receiver polling in the background.
    if (this.cameraStream && (!src || src.type !== 'camera')) {
      this.releaseCamera();
    }
    if (this.spoutReceiver && (!src || src.type !== 'spout')) {
      this.spoutReceiver.dispose();
      this.spoutReceiver = null;
      this.lastSpoutFrameId = 0;
    }

    if (!src) return;

    if (src.type === 'media' && src.mediaId) {
      const item = ctx.mediaItems.find((m: any) => m.id === src.mediaId);
      if (!item) return;
      if (item.type === 'video') {
        const vid: HTMLVideoElement | undefined = item.videoElement || (item.src ? this.ensureVideo(item.src) : undefined);
        if (vid) {
          this.impl.setSource(vid);
          this.lastResolvedSourceKey = `media:${item.id}:video`;
        }
      } else if (item.src) {
        const key = `media:${item.id}:${item.src}`;
        if (key !== this.lastResolvedSourceKey) {
          this.lastResolvedSourceKey = key;
          this.loadImage(item.src);
        }
      }
    } else if (src.type === 'layer' && src.layerId) {
      const sourceLayer = ctx.layers.find((l: any) => l.id === src.layerId);
      if (sourceLayer && sourceLayer.source) {
        const ms = sourceLayer.source;
        const vid: HTMLVideoElement | undefined = ms.videoElement
          || (ms.type === 'video' && ms.src ? this.ensureVideo(ms.src) : undefined);
        if (vid) {
          this.impl.setSource(vid);
          this.lastResolvedSourceKey = `layer:${src.layerId}:video`;
        } else if (ms.src) {
          const key = `layer:${src.layerId}:${ms.src}`;
          if (key !== this.lastResolvedSourceKey) {
            this.lastResolvedSourceKey = key;
            this.loadImage(ms.src);
          }
        }
      }
    } else if (src.type === 'file' && src.url) {
      // Browsers turn the user's file pick into a `blob:` URL with no
      // extension (`blob:http://.../uuid`), so URL-based regex can't
      // tell PLY/Splat apart from JPEG. The panel stashes the original
      // filename in `src.name` for this reason — we prefer that, and
      // fall back to URL regex only if name isn't there (e.g. legacy
      // saved source records that pre-date the name field).
      const filename = (src.name as string | undefined) ?? src.url;
      const isVideo = src.mime?.startsWith('video/') || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(filename);
      // Point-cloud / gaussian-splat formats route to a dedicated
      // ArrayBuffer path on shaders that opt in (duck-typed
      // `setSourceBuffer`). The PLY/.splat parsers turn the bytes
      // into vertex data; the standard Image / Video pipeline can't
      // handle them. Mime is `application/octet-stream` from the
      // browser so extension on the filename is what we go by.
      const isPly   = /\.ply(\?|$)/i.test(filename);
      const isSplat = /\.splat(\?|$)/i.test(filename);
      if (isPly || isSplat) {
        const setBuf = (this.impl as any).setSourceBuffer;
        if (typeof setBuf !== 'function') {
          // Loaded a point cloud while the active shader doesn't
          // support it (e.g. user accidentally picked a PLY for
          // Pixel Particles). Surface a soft warning rather than
          // silently doing nothing.
          if (this.lastResolvedSourceKey !== `pcerr:${src.url}`) {
            this.lastResolvedSourceKey = `pcerr:${src.url}`;
            console.warn('[gpuLayerRenderer] active shader does not consume point clouds; pick a different shader (e.g. Point Cloud FX) to use this file.');
          }
        } else {
          const key = `pc:${src.url}`;
          if (key !== this.lastResolvedSourceKey) {
            this.lastResolvedSourceKey = key;
            // One-shot fetch + parse + upload. We hold the impl
            // reference at fetch time so a shader-swap mid-load
            // doesn't accidentally feed bytes into the wrong impl.
            const targetImpl = this.impl;
            void fetch(src.url)
              .then((r) => r.arrayBuffer())
              .then((buf) => {
                if (this.impl !== targetImpl) return;  // shader changed mid-flight
                (targetImpl as any).setSourceBuffer(buf, isSplat ? 'splat' : 'ply', key);
              })
              .catch((err) => console.warn('[gpuLayerRenderer] point cloud fetch failed:', err?.message || err));
          }
        }
      } else if (isVideo) {
        const vid = this.ensureVideo(src.url);
        if (vid) this.impl.setSource(vid);
      } else {
        const key = `file:${src.url}`;
        if (key !== this.lastResolvedSourceKey) {
          this.lastResolvedSourceKey = key;
          this.loadImage(src.url);
        }
      }
    } else if (src.type === 'camera') {
      // getUserMedia is async — kick it off the first time we see this
      // deviceId, and keep feeding the existing video element on every
      // subsequent frame. The shader's setSource handles the case where
      // the video hasn't decoded a frame yet (it just samples whatever
      // is in the buffer, which is the placeholder until ready).
      const deviceId = src.deviceId || '';
      if (!this.cameraStream || this.cameraDeviceId !== deviceId) {
        this.startCamera(deviceId);
      }
      if (this.cachedVideoEl && this.cameraStream) {
        this.impl.setSource(this.cachedVideoEl);
        this.lastResolvedSourceKey = `camera:${deviceId || 'default'}`;
      }
    } else if (src.type === 'spout' && src.senderName) {
      // Lazy-create the receiver. setSender returns immediately if the
      // name matches the active sender, so this is cheap on the hot path.
      if (!this.spoutReceiver) {
        this.spoutReceiver = new SpoutCanvasReceiver();
        this.lastSpoutFrameId = 0;
      }
      if (this.spoutReceiver.senderName !== src.senderName) {
        // Fire-and-forget — first frame lands a tick or two later.
        void this.spoutReceiver.setSender(src.senderName);
        this.lastSpoutFrameId = 0;
      }
      // Zero-extra-copy upload: native side already paid for the
      // GPU→CPU readback, IPC moved the buffer here, and writeTexture
      // pushes the same bytes straight into the WebGPU source texture.
      // No HTMLCanvasElement / ImageBitmap intermediate.
      const frame = this.spoutReceiver.getLatestFrame();
      if (frame && frame.frameId !== this.lastSpoutFrameId && this.impl.setSourceFromBytes) {
        this.impl.setSourceFromBytes(frame.data, frame.width, frame.height);
        this.lastSpoutFrameId = frame.frameId;
        this.lastResolvedSourceKey = `spout:${src.senderName}`;
      }
    }
  }

  /** Open a webcam stream + attach to the shared cachedVideoEl. The
   *  empty deviceId means "default camera" — `getUserMedia` will pick.
   *  Errors are logged and the stream cleared so the panel can offer
   *  a different device. */
  private async startCamera(deviceId: string): Promise<void> {
    // Tear down any prior stream + any file/url video src on the
    // shared element. We don't reuse the file-video cache because
    // mixing stream + src on one element confuses some browsers.
    this.releaseCamera();
    if (this.cachedVideoEl && this.cachedVideoSrc) {
      try {
        this.cachedVideoEl.pause();
        this.cachedVideoEl.removeAttribute('src');
        this.cachedVideoEl.load();
      } catch { /* */ }
      this.cachedVideoSrc = '';
    }
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.cameraStream = stream;
      this.cameraDeviceId = deviceId;
      const v = this.cachedVideoEl ?? document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      // srcObject is the stream-attach path — leave .src empty.
      v.srcObject = stream;
      this.cachedVideoEl = v;
      try { await v.play(); } catch { /* autoplay policy delay; will start when allowed */ }
    } catch (err: any) {
      console.warn('[gpuLayerRenderer] getUserMedia failed:', err?.message || err);
      this.cameraStream = null;
      this.cameraDeviceId = '';
    }
  }

  /** Stop all webcam tracks + detach from the video element. */
  private releaseCamera(): void {
    if (this.cameraStream) {
      try { this.cameraStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      this.cameraStream = null;
    }
    this.cameraDeviceId = '';
    if (this.cachedVideoEl && (this.cachedVideoEl as any).srcObject) {
      try { (this.cachedVideoEl as any).srcObject = null; } catch { /* */ }
    }
  }

  /** Get-or-create a cached <video> element for a video URL. */
  private ensureVideo(url: string): HTMLVideoElement {
    if (this.cachedVideoEl && this.cachedVideoSrc === url) return this.cachedVideoEl;
    if (this.cachedVideoEl && this.cachedVideoSrc !== url) {
      try { this.cachedVideoEl.pause(); this.cachedVideoEl.removeAttribute('src'); this.cachedVideoEl.load(); } catch { /* */ }
    }
    const v = this.cachedVideoEl ?? document.createElement('video');
    v.muted = true; v.playsInline = true; v.loop = true; v.autoplay = true;
    // crossOrigin MUST be set before `src` for any non-same-origin URL,
    // or WebGL throws "SecurityError: video element contains cross-origin
    // data" the moment it tries to upload the frame as a texture. The
    // `ghost-asset://` custom protocol is a different origin from the
    // renderer page (it's served by Electron main), so it needs the
    // anonymous opt-in alongside http(s). Matches the equivalent fix in
    // vjClipLauncher.shouldSkipVideoCors. Without this, GPU shader
    // media sources visually rendered as solid black after save→reload.
    v.crossOrigin = /^(https?:|ghost-asset:)/i.test(url) ? 'anonymous' : null;
    v.src = url;
    this.cachedVideoSrc = url;
    this.cachedVideoEl = v;
    v.play().catch(() => { /* policy delay; will start when allowed */ });
    return v;
  }

  /** Load a still image and feed it to the shader once decoded. */
  private loadImage(url: string): void {
    const img = new Image();
    // Same CORS opt-in story as ensureVideo above — `ghost-asset://`
    // images served via the Electron custom protocol need crossOrigin
    // set so canvas / WebGL can read their pixels.
    if (/^(https?:|ghost-asset:)/i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (this.impl?.setSource) this.impl.setSource(img);
    };
    img.onerror = (e) => console.warn('[gpuLayerRenderer] image load failed', url, e);
    img.src = url;
    this.pendingImage = img;
  }

  /** Hot-swap to a different shader. Disposes the previous instance
   *  and creates the new one. Caller passes the user's params on the
   *  next frame; the new shader will fall back to its defaults until
   *  then via its own setParams handling. */
  private swapShader(shaderId: string): void {
    const def = getShaderDef(shaderId);
    if (!def) {
      console.warn('[gpuLayerRenderer] unknown shader id:', shaderId);
      this.disposeImpl();
      return;
    }
    this.disposeImpl();
    try {
      this.impl = def.create(this.device, this.presentFormat);
      this.currentShaderId = shaderId;
      console.log('[gpuLayerRenderer] active shader:', shaderId);
    } catch (err: any) {
      console.error('[gpuLayerRenderer] failed to create shader', shaderId, err?.message || err);
      this.impl = null;
      this.currentShaderId = null;
    }
  }

  private resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.context.configure({
      device: this.device,
      format: this.presentFormat,
      alphaMode: 'premultiplied',
    });
    this.configuredW = w;
    this.configuredH = h;
    if (this.impl?.resize) this.impl.resize(w, h);
  }

  private disposeImpl(): void {
    if (this.impl) {
      try { this.impl.dispose(); } catch { /* */ }
      this.impl = null;
      this.currentShaderId = null;
    }
  }

  dispose(): void {
    this.disposeImpl();
    this.releaseCamera();
    if (this.spoutReceiver) {
      this.spoutReceiver.dispose();
      this.spoutReceiver = null;
    }
    if (this.cachedVideoEl) {
      try { this.cachedVideoEl.pause(); this.cachedVideoEl.removeAttribute('src'); this.cachedVideoEl.load(); } catch { /* */ }
      this.cachedVideoEl = null;
    }
    if (this.latestBitmap) {
      try { this.latestBitmap.close(); } catch { /* */ }
      this.latestBitmap = null;
    }
  }
}
