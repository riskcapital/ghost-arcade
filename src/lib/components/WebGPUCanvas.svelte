<script lang="ts">
  /**
   * WebGPUCanvas — the strategic-default WebGL→WebGPU bridge surface.
   *
   * Mounted by App.svelte AS AN OVERLAY when
   * `experimental.editorWebGPU` is on (default TRUE in the GPU
   * edition) AND the WebGPU capability probe says supported. Sits on
   * top of Canvas.svelte (which is also mounted, in `bridgeMode`,
   * with its WebGL canvas hidden via opacity:0 but still being
   * painted by Chromium).
   *
   * ───────────────────────────────────────────────────────────────
   * THE BRIDGE, IN ONE LOOP:
   *
   *   Canvas.svelte (WebGL) renders the full editor scene to its
   *   hidden <canvas> as before
   *      ↓
   *   withExternalTexture(device, sourceCanvas, (extTex) => {...})
   *      • internally wraps the WebGL canvas in `new VideoFrame()`
   *      • internally calls device.importExternalTexture({...})
   *      • Chromium binds the GpuMemoryBuffer that backs the WebGL
   *        canvas as a sampleable WebGPU texture. Same-process,
   *        GPU-resident, zero CPU readback.
   *      • runs our render callback with the resulting external
   *        texture (fullscreen quad + adv-lightpaint + stroke
   *        particles + per-layer pixel-fx renderers)
   *      • try/finally releases the frame at the end — guaranteed,
   *        even on early return or thrown exception. Without this,
   *        each leaked VideoFrame holds ~8MB at 1080p / ~33MB at 4K.
   *      ↓
   *   The visible WebGPU canvas — what the user sees AND what the
   *   output presenter captureStream's from for cross-window video.
   *
   * Net effect: editor visually identical to the WebGL-only path,
   * but the FINAL present surface is a WebGPU canvas. This unblocks
   * the migration roadmap — per-layer WebGPU renderers (advPaint,
   * strokeParticles, pixelFX) composite over the bridge
   * frame inside the same render pass, and over time more of the
   * scene migrates off WebGL.
   *
   * ───────────────────────────────────────────────────────────────
   * WHY OVERLAY (not nested / not replacement):
   *   - Canvas.svelte's WebGL logic stays untouched (25+ engine call
   *     sites, store subscriptions, mouse handlers, mapping UI).
   *     Only adds two minimal exports (getCanvas, bridgeMode).
   *   - DOM order: Canvas.svelte is in DOM, WebGPUCanvas is on top
   *     (z-index). `pointer-events: none` on the WebGPU layer lets
   *     all interactions fall through to Canvas.svelte's wrapper
   *     (mapping clicks, layer selection, etc.).
   *   - One device for the whole edition: ensureWebGPUDevice() is a
   *     singleton, so the bridge, gpuEffectRunner, advPaint,
   *     strokeParticles, and every pixel-fx renderer share
   *     ONE device — the only way they can share textures without
   *     CPU round-trip.
   *
   * ───────────────────────────────────────────────────────────────
   * RELATED: mid-chain GPU effects (gpuEffectRunner.ts) are now
   * DEMOTED to opt-in via `experimental.allowMidChainGpuEffects`
   * (default OFF). That runner does CPU-readback because it has to
   * bridge mid-WebGL-chain — no public API gives us a zero-copy
   * import at an arbitrary point in a WebGL effect chain. This
   * downstream-compositor bridge runs ONCE per frame AFTER the WebGL
   * chain is fully composited, which is the only spot where
   * `new VideoFrame(canvas)` gets us the GpuMemoryBuffer for free.
   *
   * See docs/WEBGPU_MIGRATION.md for the full roadmap.
   */
  import { onMount, onDestroy } from 'svelte';
  import { isWebGPUSupported, probeWebGPU } from '$lib/renderer/webgpuCapability';
  import {
    stopOutputSharedTexturePresenter,
    setOutputCursor,
    setOutputCursorStyle,
  } from '$lib/sync/outputSharedTexturePresenter';
  import { reconcileMasterWarpOutput, disposeMasterWarpOutput } from '$lib/sync/outputComposite';
  import { settings, outputFrozen, masterWarpIsActive } from '$lib/stores/settings';
  import { WebGPUAdvLightPaint } from '$lib/renderer/webgpuAdvLightPaint';
  import { WebGPUStrokeParticles, collectGPUStrokes } from '$lib/renderer/webgpuStrokeParticles';
  import { setGPUBrushCanvas } from '$lib/lightpainting/gpuBrushBridge';
  import { WebGPUPixelParticles } from '$lib/renderer/webgpuPixelParticles';
  // Dedicated renderer for pixel-fx layers in `flythrough` mode.
  // Routed separately from the standard WebGPUPixelParticles because
  // its camera model (auto-advancing Z accumulator), particle topology
  // (worm strokes / billboard points), and slab-replication draw call
  // are different enough that bolting them into PixelParticles would
  // bloat that class. See `webgpuFlythrough.ts` for the full design
  // notes.
  import { WebGPUFlythrough } from '$lib/renderer/webgpuFlythrough';
  import { ensureWebGPUDevice } from '$lib/renderer/webgpuShared';
  // Zero-copy WebGL→WebGPU primitive. Wraps `new VideoFrame()` +
  // `device.importExternalTexture()` in a try/finally so the
  // GpuMemoryBuffer underlying the frame is always released — a
  // missed `.close()` here would leak ~8MB per frame at 1080p
  // and ~33MB per frame at 4K. Every bridge site in the GPU
  // edition routes through this helper now; see
  // `lib/utils/videoFrameBridge.ts` for the leak counter + the
  // compute-path blit helper.
  import { withExternalTexture, checkVideoFrameLeaks } from '$lib/utils/videoFrameBridge';
  import { mediaLibrary } from '$lib/stores/media';
  import { visualAudio } from '$lib/audio/visualAudio';
  import { project, selectedLayer } from '$lib/stores/layers';
  import { get as getStore } from 'svelte/store';
  import { t } from '$lib/i18n';
  // Cheap synchronous read of the project store from inside the
  // animation frame loop — re-reading is cost-free (stores cache
  // their last value). Used by the GPU stroke particle pass below
  // so progress can advance even when the store didn't change.
  const getProjectSync = () => getStore(project);
  import type { AdvLightPaintingContent } from '$lib/types';

  // Source canvas reference. Set via setSourceCanvas() from App.svelte
  // AFTER both Canvas.svelte and this component have mounted (because
  // Canvas's bind:this getCanvas() doesn't return a non-null value
  // until ITS own onMount completes — a Svelte prop wouldn't propagate
  // that mutation reliably). Imperative setter keeps the timing
  // explicit and race-free.
  let sourceCanvas: HTMLCanvasElement | null = null;

  /** App.svelte calls this AFTER both components mount with the
   *  WebGL canvas DOM element from Canvas.svelte's getCanvas(). The
   *  bridge presenter starts the moment a non-null source is set
   *  (and WebGPU init is done). Idempotent on the same canvas. */
  export function setSourceCanvas(c: HTMLCanvasElement | null): void {
    sourceCanvas = c;
    if (c && (initStatus === 'no-source' || initStatus === 'init')) {
      initStatus = 'running';
    }
    // Source/owner may have just become valid — re-assert registration.
    reconcileOutputRegistration();
  }

  // Register the surface the output transports should capture, via the
  // single reconciler (Canvas.svelte skips registration in bridgeMode so
  // the two never fight). Pick the WebGPU present canvas when WebGPU is
  // actually live; otherwise fall back to the WebGL source canvas — if
  // WebGPU failed to init or hasn't presented yet, presentCanvas is BLANK
  // and registering it would black out the projector. Re-run on settings
  // changes AND when init/source state transitions (those aren't settings
  // events, so the subscription alone wouldn't catch them).
  function reconcileOutputRegistration(): void {
    if (isOutputMode || isOsrMode) return;
    const webgpuLive = initStatus === 'running' || initStatus === 'no-source';
    // When WebGPU is live, the master warp is baked into presentCanvas by
    // the present shader (see updateWarpUniform + SHADER_WGSL), so the
    // transports just capture presentCanvas directly — warpActive=false
    // here (do NOT route through the WebGL blendRenderer/captureStream
    // detour, which is what went black). Only when WebGPU is NOT live do
    // we fall back to the WebGL source canvas + the WebGL warp path.
    const outSource = webgpuLive ? presentCanvas : sourceCanvas;
    if (!outSource) return;
    const s = getStore(settings);
    const _perf = s?.performance;
    reconcileMasterWarpOutput({
      baseSource: outSource,
      // Warp is in-shader on presentCanvas when WebGPU is live; only use
      // the WebGL warp path on the non-WebGPU fallback source.
      warpActive: webgpuLive ? false : masterWarpIsActive(s.output?.masterWarp),
      zeroCopy: !!s.experimental?.outputZeroCopy,
      webrtc: !!s.experimental?.outputWebRTC,
      getWarp: () => getStore(settings).output?.masterWarp,
      getSize: () => ({
        w: getStore(settings).output?.masterCanvasWidth ?? 1920,
        h: getStore(settings).output?.masterCanvasHeight ?? 1080,
      }),
      perf: {
        frameRate: _perf?.outputFrameRate ?? 60,
        maxBitrate: _perf?.outputMaxBitrate,
        degradationPreference: _perf?.outputDegradationPreference,
        codecPreference: _perf?.outputCodecPreference,
      },
    });
  }

  // Match Canvas.svelte's mount-mode flags so behaviour stays
  // consistent. WebGPU bridge only makes sense in editor mode
  // (output / OSR windows have their own WebGPU pipelines).
  const isOutputMode = !!(window as any).__OUTPUT_WINDOW_MODE__;
  const isOsrMode = !!(window as any).__SPOUT_OSR_MODE__;

  // Visible canvas — what the user (and captureStream) sees.
  let presentCanvas: HTMLCanvasElement;
  let wrapperEl: HTMLDivElement;

  // WebGPU resources
  let gpu: any = null;
  let adapter: any = null;
  let device: any = null;
  let canvasContext: any = null;
  let preferredFormat: any = null;
  let pipeline: any = null;
  let sampler: any = null;
  let bindGroupLayout: any = null;
  let configuredPresentW = 0;
  let configuredPresentH = 0;
  // Master-warp uniform buffer + a CPU-side staging ArrayBuffer. Layout:
  //   [0..3]   meta u32 (mode, rows, cols, pad)
  //   [16..47] corners: c0(tl.xy,tr.xy), c1(bl.xy,br.xy)
  //   [48..]   mesh: 128 vec4 (256 xy pairs)
  // 16-byte aligned throughout (vec4 blocks).
  let warpUniformBuffer: any = null;
  let warpStaging: ArrayBuffer | null = null;
  let warpU32: Uint32Array | null = null;
  let warpF32: Float32Array | null = null;
  // Dome/output reprojection uniform. Kept separate from the master-warp
  // block so older warp packing stays untouched.
  //   cfg     = (enabled, mode, pad, pad) [u32×4]
  //   params0 = (fovRad, rotationRad, tiltRad, curvature)
  //   params1 = (offsetX, offsetY, truncation, aspect)
  let domeUniformBuffer: any = null;
  let domeStaging: ArrayBuffer | null = null;
  let domeU32: Uint32Array | null = null;
  let domeF32: Float32Array | null = null;

  let initStatus: 'init' | 'no-webgpu' | 'no-source' | 'running' | 'error' = 'init';
  let initError = '';
  let disposed = false;
  let rafId: number | null = null;

  // Latest snapshot of the audio analyzer bands — kept in module
  // scope so the per-frame flythrough loop can read it synchronously
  // without re-subscribing per layer. Updated from the shared
  // visual-audio bus subscription below.
  // subscription below. Null until the analyzer ticks once.
  let lastAudioBands: { bass: number; mid: number; treble: number } | null = null;

  let audioUnsub: (() => void) | null = null;

  // Phase 3.2 feature: 3D physics-driven WebGPU paint with brush
  // presets (drip / water / smoke / plasma / shader). Renders
  // whenever an `adv-lightpaint` layer exists in the project. When
  // such a layer is SELECTED, mouse drag spawns particles into it.
  let advPaint: WebGPUAdvLightPaint | null = null;
  let advPaintLayerCount = 0;        // count of adv-lightpaint layers in current project
  let advPaintActiveContent: AdvLightPaintingContent | null = null;
  let advPaintSelected = false;      // true when an adv-lightpaint layer is the selectedLayer
  let projectUnsub: (() => void) | null = null;
  let selectedLayerUnsub: (() => void) | null = null;

  // Output freeze (top-toolbar Freeze button + mobile pause pill).
  // Local mirror of the outputFrozen store so the per-frame tick can
  // read it without a store get() each frame. When frozen we skip
  // presentFrame() entirely — that halts the GPU brush compute passes
  // (advPaint + strokeParticles) so they stop advancing, matching the
  // WebGL engine's animate() gate. The present canvas keeps its last
  // composited frame, so output is fully frozen (CPU brushes already
  // froze via the engine; this brings GPU brushes in line).
  let frozen = false;
  let frozenUnsub: (() => void) | null = null;

  // Light Painting GPU brushes — spiral / firefly / sap-flow.
  // Reads strokes from Light Painting layers in the project, runs a
  // compute pass per frame, renders particles additively over the
  // bridge frame. setStrokes() is hash-keyed so re-uploads only
  // happen when the user adds/edits/removes a GPU-brush stroke.
  let strokeParticles: WebGPUStrokeParticles | null = null;
  // Offscreen WebGPU canvas the stroke-particle brushes render into.
  // Instead of compositing the brushes over the present (final) frame
  // — which forced them to the top of the z-stack and out of the
  // freeze gate — we render them here, transparent-cleared, and hand
  // this canvas to Canvas.svelte (via gpuBrushBridge) so the engine
  // composites it at the light-paint layer's real z-position. See
  // gpuBrushBridge.ts for the full rationale.
  let brushCanvas: HTMLCanvasElement | null = null;
  let brushCtx: any = null;
  let configuredBrushW = 0;
  let configuredBrushH = 0;
  // Per-layer pixel-fx renderers, keyed by layer id. Each pixel-fx
  // layer gets its own WebGPUPixelParticles instance so they don't
  // step on each other's source textures or particle buffers.
  // Layers are torn down when their layer is removed; new ones
  // created lazily on first reference each frame.
  const pixelFXRenderers = new Map<string, WebGPUPixelParticles>();
  // Parallel map for layers whose mode is `flythrough` — routes to
  // the dedicated WebGPUFlythrough renderer. We keep a separate map
  // (rather than a single Map<string, any>) so the per-renderer
  // setter API stays statically typed and the GC behaviour of the
  // two renderer families stays predictable.
  const flythroughRenderers = new Map<string, WebGPUFlythrough>();
  // Tracks which layer the flythrough renderer's source was last
  // loaded from, so we don't re-decode the source image / re-bind
  // the video element every frame when nothing changed.
  const flythroughLoadedSourceKey = new Map<string, string | null>();
  // Tracks which sourceUrl we last loaded per layer so we can detect
  // changes and re-import the texture without re-doing it every frame.
  const pixelFXLoadedSourceUrl = new Map<string, string | null>();
  // Per-layer cached <video> element. Videos can't load via Image()
  // — we hold our own muted+looped+playsInline element and pump
  // frames into the GPU texture each render. Reused across source
  // changes so we don't churn video decoders.
  const pixelFXVideoEl = new Map<string, HTMLVideoElement>();
  // Per-layer last src loaded into our cached video element. Lets
  // us avoid re-setting src (which restarts playback) when nothing
  // changed.
  const pixelFXVideoSrc = new Map<string, string>();

  /** Get-or-create the cached <video> element for a pixel-fx layer.
   *  Configures it for autoplay+loop+muted (Chromium needs muted to
   *  honour autoplay without user gesture). The returned element
   *  may not yet have a frame; callers should let updateSourceFromVideo
   *  no-op until readyState >= 2. */
  function ensurePixelFXVideo(layerId: string, src: string): HTMLVideoElement {
    let v = pixelFXVideoEl.get(layerId);
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.autoplay = true;
      v.crossOrigin = /^https?:/i.test(src) ? 'anonymous' : null;
      pixelFXVideoEl.set(layerId, v);
    }
    if (pixelFXVideoSrc.get(layerId) !== src) {
      v.src = src;
      pixelFXVideoSrc.set(layerId, src);
      // Best-effort play. If the user hasn't gestured yet some
      // browsers reject the play() promise — we ignore because the
      // muted+autoplay combo is allowed to start anyway.
      v.play().catch(() => {
        /* will start when playback policy allows */
      });
    }
    return v;
  }
  // Output cursor: when settings.output.outputShowCursor is on, the
  // mouse position over the editor canvas is forwarded to the output
  // window via the existing MessagePort, where it renders as a CSS
  // crosshair overlay. Subscribed in onMount; updated by mousemove.
  let outputShowCursor = false;
  let settingsUnsub: (() => void) | null = null;
  // Spawn position is in normalized canvas coordinates 0..1. Updated
  // by window mousemove handlers below — we listen on window rather
  // than the wrapper so the pointer-events: none doesn't block us.
  let mouseSpawnU = 0.5;
  let mouseSpawnV = 0.5;
  let mouseDown = false;

  // Stats
  let framesPresented = 0;
  let framesSkipped = 0;
  let lastFrameAt = 0;
  let fpsEMA = 0;
  let renderTimeUsEMA = 0;
  let lastFrameDim = '';
  let frameLoopErrorCount = 0;

  // Pass-through WGSL shader. No transform / colour correction here
  // — those are still done by Canvas.svelte's WebGL composite. The
  // bridge job is "show this canvas exactly as it is" so the output
  // is visually identical to the WebGL-only path. Phase 3.x will
  // add a real compositor with WGSL blend modes; THIS shader is
  // intentionally trivial so it doesn't introduce visual diffs vs
  // the WebGL path.
  const SHADER_WGSL = /* wgsl */ `
@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_external;

// Master warp uniform. mode: 0 = off (passthrough), 1 = corners (+optional
// mesh). Corners are destination positions in 0..1 (where content lands);
// we inverse-bilinear to find the source uv. Mesh (rows/cols ≥ 2) deforms
// WITHIN the corner quad — same forward model as the WebGL blendRenderer.
const MAXM: u32 = 16u;           // max mesh points per side (16×16 cap)
// All-vec4 layout to avoid vec2 std140 alignment traps. JS packs to match:
//   cfg  = (mode, rows, cols, pad)  [u32×4]   (was "meta" — WGSL reserved word)
//   c0   = (tl.x, tl.y, tr.x, tr.y)
//   c1   = (bl.x, bl.y, br.x, br.y)
//   mesh = 128 × vec4 = 256 xy pairs (row-major; pair idx = ri*cols+ci)
struct Warp {
  cfg: vec4<u32>,
  c0: vec4<f32>,
  c1: vec4<f32>,
  mesh: array<vec4<f32>, 128>,
};
@group(0) @binding(2) var<uniform> uWarp: Warp;
// Dome reprojection. mode: 0 = angular/equidistant fisheye,
// 1 = stereographic, 2 = orthographic, 3 = equirectangular panorama.
struct Dome {
  cfg: vec4<u32>,
  params0: vec4<f32>,
  params1: vec4<f32>,
};
@group(0) @binding(3) var<uniform> uDome: Dome;
fn corner_tl() -> vec2<f32> { return uWarp.c0.xy; }
fn corner_tr() -> vec2<f32> { return uWarp.c0.zw; }
fn corner_bl() -> vec2<f32> { return uWarp.c1.xy; }
fn corner_br() -> vec2<f32> { return uWarp.c1.zw; }

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );
  var out: VSOut;
  out.clip = vec4<f32>(positions[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

fn cross2(a: vec2<f32>, b: vec2<f32>) -> f32 { return a.x * b.y - a.y * b.x; }

// Inverse bilinear (Inigo Quilez). Quad winding a=TL,b=TR,c=BR,d=BL.
// Returns (-1,-1) when p is outside the quad.
fn invBilinear(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>) -> vec2<f32> {
  let e = b - a;
  let f = d - a;
  let g = a - b + c - d;
  let h = p - a;
  let k2 = cross2(g, f);
  let k1 = cross2(e, f) + cross2(h, g);
  let k0 = cross2(h, e);
  var u: f32;
  var v: f32;
  if (abs(k2) < 0.0001) {
    if (abs(k1) < 0.0001) { return vec2<f32>(-1.0, -1.0); }
    v = -k0 / k1;
    let denom = e.x + g.x * v;
    if (abs(denom) > 0.0001) { u = (h.x - f.x * v) / denom; }
    else { u = (h.y - f.y * v) / (e.y + g.y * v); }
  } else {
    let w = k1 * k1 - 4.0 * k0 * k2;
    if (w < 0.0) { return vec2<f32>(-1.0, -1.0); }
    let sw = sqrt(w);
    let v1 = (-k1 - sw) / (2.0 * k2);
    let v2 = (-k1 + sw) / (2.0 * k2);
    if (v1 >= 0.0 && v1 <= 1.0) { v = v1; } else { v = v2; }
    let denom = e.x + g.x * v;
    if (abs(denom) > 0.0001) { u = (h.x - f.x * v) / denom; }
    else { u = (h.y - f.y * v) / (e.y + g.y * v); }
  }
  return vec2<f32>(u, v);
}

fn meshPt(idx: u32) -> vec2<f32> {
  let v = uWarp.mesh[idx / 2u];
  if ((idx & 1u) == 0u) { return v.xy; }
  return v.zw;
}

const PI: f32 = 3.141592653589793;

fn rotate2d(p: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn sampleSource(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleBaseClampToEdge(uTexture, uSampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
}

fn sampleWithDome(uv: vec2<f32>) -> vec4<f32> {
  if (uDome.cfg.x == 0u) {
    return sampleSource(uv);
  }

  let mode = uDome.cfg.y;
  let fov = max(uDome.params0.x, 0.001);
  let rotation = uDome.params0.y;
  let tilt = uDome.params0.z;
  let curvature = clamp(uDome.params0.w, 0.0, 1.0);
  let offset = uDome.params1.xy;
  let truncRadius = clamp(uDome.params1.z, 0.001, 2.0);
  let aspect = max(uDome.params1.w, 0.001);

  var p = (uv - vec2<f32>(0.5)) * 2.0;
  // Domemaster reprojection is circular in output space, so compensate
  // non-square master canvases before measuring radius.
  if (aspect > 1.0) {
    p.x = p.x * aspect;
  } else {
    p.y = p.y / aspect;
  }
  p = rotate2d(p - offset, rotation);

  let r = length(p);
  if (r > truncRadius) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  if (mode == 3u) {
    let lon = p.x * PI;
    let lat = p.y * PI * 0.5;
    let texUv = clamp(vec2<f32>(
      lon / PI * 0.5 + 0.5,
      lat / (PI * 0.5) * 0.5 + 0.5,
    ), vec2<f32>(0.0), vec2<f32>(1.0));
    return sampleSource(texUv);
  }

  let halfFov = fov * 0.5;
  var theta: f32;
  if (mode == 1u) {
    theta = 2.0 * atan(r * tan(halfFov * 0.5));
  } else if (mode == 2u) {
    theta = asin(min(r, 1.0)) * halfFov / (PI * 0.5);
  } else {
    theta = r * halfFov;
  }

  let phi = atan2(p.y, p.x);
  let sinTheta = sin(theta);
  let cosTheta = cos(theta);
  var dir = vec3<f32>(
    sinTheta * cos(phi),
    sinTheta * sin(phi),
    cosTheta,
  );

  let ct = cos(tilt);
  let st = sin(tilt);
  dir = vec3<f32>(
    dir.x,
    dir.y * ct - dir.z * st,
    dir.y * st + dir.z * ct,
  );

  let z = max(dir.z, 0.001);
  let domeUv = vec2<f32>(
    dir.x / z * 0.5 + 0.5,
    dir.y / z * 0.5 + 0.5,
  );
  let texUv = clamp(mix(uv, domeUv, curvature), vec2<f32>(0.0), vec2<f32>(1.0));
  let sampled = sampleSource(texUv);
  let edgeFade = 1.0 - smoothstep(max(truncRadius - 0.05, 0.0), truncRadius, r);
  // WGSL forbids swizzle-assignment (color.rgb = ...) — rebuild the vec4
  // from scratch with the faded RGB and forced-opaque alpha.
  return vec4<f32>(sampled.rgb * edgeFade, 1.0);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let mode = uWarp.cfg.x;
  let rows = uWarp.cfg.y;
  let cols = uWarp.cfg.z;
  if (mode == 0u) {
    return sampleWithDome(in.uv);
  }
  // Degenerate-quad guard: if the corner quad has near-zero area (all
  // collapsed, inverted winding, etc.) bail to passthrough rather than
  // produce all-black output. The geometric area of the quad is
  // |cross(TR-TL, BL-TL) + cross(BR-BL, TR-BR)| / 2 (sum of triangles).
  let tl = corner_tl(); let tr = corner_tr(); let bl = corner_bl(); let br = corner_br();
  let tri1 = abs(cross2(tr - tl, bl - tl));
  let tri2 = abs(cross2(br - bl, tr - br));
  let quadArea = (tri1 + tri2) * 0.5;
  if (quadArea < 0.01) {
    return sampleWithDome(in.uv);
  }
  // Forward master warp: invert the corner quad → quad-local q. Outside
  // the quad → black (pulling a corner in crops/keystones).
  let q = invBilinear(in.uv, tl, tr, br, bl);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  var src = q;
  // Mesh: invert the deformation within the quad (per-cell inverse-bilinear).
  if (rows >= 2u && cols >= 2u) {
    var found = false;
    for (var ri: u32 = 0u; ri < MAXM - 1u; ri = ri + 1u) {
      if (ri >= rows - 1u) { break; }
      for (var ci: u32 = 0u; ci < MAXM - 1u; ci = ci + 1u) {
        if (ci >= cols - 1u) { break; }
        if (found) { continue; }
        let a = meshPt(ri * cols + ci);
        let b = meshPt(ri * cols + ci + 1u);
        let c = meshPt((ri + 1u) * cols + ci + 1u);
        let d = meshPt((ri + 1u) * cols + ci);
        let t = invBilinear(q, a, b, c, d);
        if (t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0) {
          let gu = (f32(ci) + t.x) / f32(cols - 1u);
          let gv = (f32(ri) + t.y) / f32(rows - 1u);
          src = vec2<f32>(gu, gv);
          found = true;
        }
      }
    }
    // If no cell contained q, bail to passthrough rather than render black.
    // The mesh search can miss legitimately (degenerate cell from a wild
    // drag, NaN slipped in past the JS sanitize, floating-point boundary
    // miss) — un-warped pixels are strictly better than total blackout,
    // and the user can drag the handle back to recover.
    if (!found) { return sampleWithDome(in.uv); }
  }
  return sampleWithDome(src);
}
`;

  /** API parity with Canvas.svelte for App.svelte's canvasComponent
   *  ref. Phase 3.0: returns null because WebGPUCanvas is OVERLAID
   *  on Canvas.svelte rather than replacing it; downstream callers
   *  that want the engine should keep calling Canvas.svelte's
   *  getEngine() (App.svelte routes to the right component). */
  export function getEngine(): null { return null; }

  export function getContainerRect(): { x: number; y: number; width: number; height: number } {
    if (!presentCanvas || !wrapperEl) return { x: 0, y: 0, width: 0, height: 0 };
    const r = presentCanvas.getBoundingClientRect();
    const wr = wrapperEl.getBoundingClientRect();
    return { x: r.left - wr.left, y: r.top - wr.top, width: r.width, height: r.height };
  }

  function configurePresentCanvasContext(): void {
    if (!canvasContext || !device || !preferredFormat || !presentCanvas) return;
    const w = presentCanvas.width | 0;
    const h = presentCanvas.height | 0;
    if (w <= 0 || h <= 0) return;
    if (configuredPresentW === w && configuredPresentH === h) return;
    canvasContext.configure({
      device,
      format: preferredFormat,
      alphaMode: 'opaque',
      colorSpace: 'srgb',
    });
    configuredPresentW = w;
    configuredPresentH = h;
  }

  function configureBrushCanvasContext(): void {
    if (!brushCtx || !device || !preferredFormat || !brushCanvas) return;
    const w = brushCanvas.width | 0;
    const h = brushCanvas.height | 0;
    if (w <= 0 || h <= 0) return;
    if (configuredBrushW === w && configuredBrushH === h) return;
    brushCtx.configure({
      device,
      format: preferredFormat,
      alphaMode: 'premultiplied',
    });
    configuredBrushW = w;
    configuredBrushH = h;
  }

  async function initWebGPU(): Promise<void> {
    // ── Drop any stale per-layer GPU renderers from a previous
    // device. HMR + device-lost both trigger re-init; per-layer
    // pixel-fx renderers were lazily created against the old device
    // and would silently no-op against it. Clearing forces them to
    // be re-created against the new device on the next frame.
    for (const r of pixelFXRenderers.values()) { try { r.dispose?.(); } catch { /* */ } }
    pixelFXRenderers.clear();
    pixelFXLoadedSourceUrl.clear();
    // Flythrough renderers — same lifecycle as the standard pixel-fx
    // ones above; they reference the device and must die with it.
    for (const r of flythroughRenderers.values()) { try { r.dispose?.(); } catch { /* */ } }
    flythroughRenderers.clear();
    flythroughLoadedSourceKey.clear();
    for (const v of pixelFXVideoEl.values()) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* */ } }
    pixelFXVideoEl.clear();
    pixelFXVideoSrc.clear();

    const supported = await probeWebGPU();
    if (!supported || !isWebGPUSupported()) {
      initStatus = 'no-webgpu';
      initError = $t('gpuTools.webgpu.errors.unavailable');
      console.error('[WebGPUCanvas] ' + initError);
      return;
    }
    gpu = (navigator as any).gpu;
    try {
      // Use the shared WebGPU device so the bridge presenter, the
      // GPU effect runner, and all the other compute renderers
      // (advPaint, strokeParticles, pixel-fx) talk to
      // ONE device. That's the only way they can share textures
      // without going through the CPU.
      const shared = await ensureWebGPUDevice();
      device = shared.device;
      adapter = shared.adapter;
      preferredFormat = shared.presentFormat;
      canvasContext = presentCanvas.getContext('webgpu');
      if (!canvasContext) throw new Error('getContext("webgpu") returned null');
      configuredPresentW = 0;
      configuredPresentH = 0;
      configurePresentCanvasContext();

      const shaderModule = device.createShaderModule({ code: SHADER_WGSL });
      bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      // Master-warp uniform: meta(16B) + c0/c1(32B) + mesh(128×16=2048B).
      const warpBytes = 16 + 32 + 128 * 16; // = 2096
      warpStaging = new ArrayBuffer(warpBytes);
      warpU32 = new Uint32Array(warpStaging);
      warpF32 = new Float32Array(warpStaging);
      warpUniformBuffer = device.createBuffer({
        size: warpBytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const domeBytes = 16 + 16 + 16; // cfg + params0 + params1
      domeStaging = new ArrayBuffer(domeBytes);
      domeU32 = new Uint32Array(domeStaging);
      domeF32 = new Float32Array(domeStaging);
      domeUniformBuffer = device.createBuffer({
        size: domeBytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: preferredFormat }] },
        primitive: { topology: 'triangle-list' },
      });
      sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      // Phase 3.2: 3D adv-lightpaint compute renderer. Same
      // failure semantics — non-fatal, the bridge keeps working.
      try {
        advPaint = await WebGPUAdvLightPaint.create(device, preferredFormat);
      } catch (err: any) {
        console.error('[WebGPUCanvas] adv-lightpaint init failed (non-fatal):', err?.message || err);
        advPaint = null;
      }

      // Light Painting GPU brushes — compute particles bound to
      // user-drawn strokes (spiral/firefly/sap-flow). Failure is
      // non-fatal; the rest of the editor keeps working.
      try {
        strokeParticles = await WebGPUStrokeParticles.create(device, preferredFormat);
        // Offscreen surface the brushes render into. Configured with
        // premultiplied alpha so the transparent-cleared background +
        // additive particles upload cleanly as a THREE.CanvasTexture.
        brushCanvas = document.createElement('canvas');
        brushCanvas.width = 1;
        brushCanvas.height = 1;
        brushCtx = brushCanvas.getContext('webgpu');
        if (brushCtx) {
          configuredBrushW = 0;
          configuredBrushH = 0;
          configureBrushCanvasContext();
          setGPUBrushCanvas(brushCanvas);
        }
      } catch (err: any) {
        console.error('[WebGPUCanvas] stroke particles init failed (non-fatal):', err?.message || err);
        strokeParticles = null;
        brushCanvas = null;
        brushCtx = null;
        setGPUBrushCanvas(null);
      }

      initStatus = sourceCanvas ? 'running' : 'no-source';
      console.log('[WebGPUCanvas] WebGPU initialised. Adapter:', (adapter as any).info?.description || 'unknown');
      // WebGPU is now presenting — switch output capture from the WebGL
      // fallback to the live present canvas.
      reconcileOutputRegistration();
    } catch (err: any) {
      initStatus = 'error';
      initError = $t('gpuTools.webgpu.errors.initFailed', { values: { error: err?.message || err } });
      console.error('[WebGPUCanvas] ' + initError, err);
      // Init failed — make sure the live WebGL source stays registered
      // (presentCanvas would be blank).
      reconcileOutputRegistration();
    }
  }

  // Pack the current master warp into the uniform buffer. Mirrors the
  // WebGL forward-warp model: corners are destination positions (where
  // content lands); mesh deforms within the quad. mode=0 ⇒ passthrough.
  const IDENTITY_C = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };
  let warpUniformLogTick = 0;
  function updateWarpUniform(): void {
    if (!device || !warpUniformBuffer || !warpU32 || !warpF32 || !warpStaging) return;
    const warp = getStore(settings).output?.masterWarp;
    const active = masterWarpIsActive(warp);
    const c = warp?.corners ?? (IDENTITY_C as any);
    const g = warp?.meshGrid;
    const useMesh = active && !!g && g.rows >= 2 && g.cols >= 2 && g.rows <= 16 && g.cols <= 16;
    // cfg (u32 ×4) — was "meta" but that's a WGSL reserved word
    warpU32[0] = active ? 1 : 0;
    warpU32[1] = useMesh ? g!.rows : 0;
    warpU32[2] = useMesh ? g!.cols : 0;
    warpU32[3] = 0;
    // corners — f32 starting at byte 16 → index 4
    warpF32[4] = c.topLeft?.x ?? c.tl?.[0] ?? 0; warpF32[5] = c.topLeft?.y ?? c.tl?.[1] ?? 0;
    warpF32[6] = c.topRight?.x ?? c.tr?.[0] ?? 1; warpF32[7] = c.topRight?.y ?? c.tr?.[1] ?? 0;
    warpF32[8] = c.bottomLeft?.x ?? c.bl?.[0] ?? 0; warpF32[9] = c.bottomLeft?.y ?? c.bl?.[1] ?? 1;
    warpF32[10] = c.bottomRight?.x ?? c.br?.[0] ?? 1; warpF32[11] = c.bottomRight?.y ?? c.br?.[1] ?? 1;
    // mesh xy pairs — f32 starting at byte 48 → index 12. Pair k at 12+2k.
    if (useMesh) {
      for (let r = 0; r < g!.rows; r++) {
        for (let cc = 0; cc < g!.cols; cc++) {
          const k = r * g!.cols + cc;
          const p = g!.points[r]?.[cc];
          warpF32[12 + k * 2] = p?.x ?? 0;
          warpF32[12 + k * 2 + 1] = p?.y ?? 0;
        }
      }
    }
    device.queue.writeBuffer(warpUniformBuffer, 0, warpStaging);
    // Diagnostic: once a second, dump the actual uniform values + the
    // bound source/present dims so we can tell whether the shader is
    // being given degenerate input vs whether the issue is downstream
    // (captureStream / output window). Opt out with __MWARP_DEBUG__=false.
    if (warpUniformLogTick++ % 60 === 0) {
      const dbg = (window as any).__MWARP_DEBUG__;
      if (dbg !== false) {
        // Mesh stats — min/max + NaN count, so we can spot NaN slippage
        // or wildly-out-of-range points that would make the cell search
        // miss all 16 cells.
        let meshMin = Infinity, meshMax = -Infinity, meshNaN = 0;
        const meshLen = useMesh ? g!.rows * g!.cols * 2 : 0;
        for (let i = 0; i < meshLen; i++) {
          const v = warpF32[12 + i];
          if (Number.isNaN(v)) meshNaN++;
          else { if (v < meshMin) meshMin = v; if (v > meshMax) meshMax = v; }
        }
        console.log('[mwarp] wgsl uniform',
          'mode=', warpU32[0], 'rows=', warpU32[1], 'cols=', warpU32[2],
          'TL=', warpF32[4].toFixed(3), warpF32[5].toFixed(3),
          'TR=', warpF32[6].toFixed(3), warpF32[7].toFixed(3),
          'BL=', warpF32[8].toFixed(3), warpF32[9].toFixed(3),
          'BR=', warpF32[10].toFixed(3), warpF32[11].toFixed(3),
          ...(useMesh
            ? ['mesh min=', meshMin.toFixed(3), 'max=', meshMax.toFixed(3), 'NaN=', meshNaN]
            : []),
          'src=', sourceCanvas?.width, 'x', sourceCanvas?.height,
          'present=', presentCanvas?.width, 'x', presentCanvas?.height,
        );
      }
    }
  }

  function domeModeIndex(mode: string | undefined): number {
    if (mode === 'stereographic') return 1;
    if (mode === 'orthographic') return 2;
    if (mode === 'equirectangular') return 3;
    return 0;
  }

  function updateDomeUniform(): void {
    if (!device || !domeUniformBuffer || !domeU32 || !domeF32 || !domeStaging) return;
    const output = getStore(settings).output;
    const fovDeg = output?.domeFOV ?? 180;
    const rotationDeg = output?.domeRotation ?? 0;
    const tiltDeg = output?.domeTilt ?? 0;
    const aspect =
      presentCanvas?.width && presentCanvas?.height
        ? presentCanvas.width / presentCanvas.height
      : sourceCanvas?.width && sourceCanvas?.height
          ? sourceCanvas.width / sourceCanvas.height : 16 / 9;

    domeU32[0] = output?.domeEnabled ? 1 : 0;
    domeU32[1] = domeModeIndex(output?.domeMode);
    domeU32[2] = 0;
    domeU32[3] = 0;

    domeF32[4] = (Math.max(1, fovDeg) * Math.PI) / 180;
    domeF32[5] = (rotationDeg * Math.PI) / 180;
    domeF32[6] = (tiltDeg * Math.PI) / 180;
    domeF32[7] = Math.max(0, Math.min(1, output?.domeCurvature ?? 1));
    domeF32[8] = Math.max(-1, Math.min(1, output?.domeOffsetX ?? 0));
    domeF32[9] = Math.max(-1, Math.min(1, output?.domeOffsetY ?? 0));
    domeF32[10] = Math.max(0.001, Math.min(2, output?.domeTruncation ?? 1));
    domeF32[11] = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;

    device.queue.writeBuffer(domeUniformBuffer, 0, domeStaging);
  }

  function presentFrame(): void {
    if (!sourceCanvas || !device || !pipeline || !canvasContext) {
      framesSkipped++;
      return;
    }
    // Resize the present canvas backing store to match the source
    // canvas dimensions. The source canvas is at project resolution
    // (e.g. 1920x1080) — we present at the same. CSS scales the
    // visible rect to the wrapper's letterboxed size.
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    if (sw > 0 && sh > 0 && (presentCanvas.width !== sw || presentCanvas.height !== sh)) {
      presentCanvas.width = sw;
      presentCanvas.height = sh;
      configurePresentCanvasContext();
      reconcileOutputRegistration();
    }
    configurePresentCanvasContext();
    if (!sw || !sh) {
      framesSkipped++;
      return;
    }
    lastFrameDim = `${sw}x${sh}`;
    updateWarpUniform();
    updateDomeUniform();

    // The whole render pass runs inside withExternalTexture()'s
    // callback so the VideoFrame's lifetime brackets ALL of our GPU
    // work for this frame. The helper handles construction,
    // importExternalTexture, and the try/finally close — see
    // lib/utils/videoFrameBridge.ts for the leak counter wiring.
    // Returns undefined if VideoFrame construction fails (e.g.
    // sourceCanvas became 0×0 mid-frame, context-loss recovery, etc.)
    // — we just skip the frame in that case.
    const t0 = performance.now();
    // Track whether the frame actually made it through to queue.submit
    // — the helper internally returns undefined on a VideoFrame
    // construction failure (silent skip; common during canvas resize
    // + context-loss recovery), and our callback's inner try/catch
    // logs loudly on GPU-encoding errors. Either way `presentSucceeded`
    // ends up false and we bump the skip counter once at the end.
    let presentSucceeded = false;
    withExternalTexture(device, sourceCanvas, (externalTexture) => {
      try {
        const bindGroup = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: externalTexture },
            { binding: 2, resource: { buffer: warpUniformBuffer } },
            { binding: 3, resource: { buffer: domeUniformBuffer } },
          ],
        });
      const encoder = device.createCommandEncoder();
      const view = canvasContext.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
          ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6, 1, 0, 0);
      pass.end();

      // Phase 3.2 adv-lightpaint compute renderer. Active any time
      // an adv-lightpaint layer exists in the project; mouse drives
      // it only when one is SELECTED (so adding a layer + selecting
      // a different layer keeps the existing drips animating without
      // accidental new spawns).
      if (advPaint && advPaintActiveContent && advPaintLayerCount > 0) {
        advPaint.setSpawnPosition(mouseSpawnU, mouseSpawnV, mouseDown && advPaintSelected);
        advPaint.setViewport(presentCanvas.width, presentCanvas.height);
        advPaint.encodeFrame(encoder, view);
      }

      // Light Painting GPU brushes (spiral/firefly/sap-flow) — runs
      // when the project has any Light Painting layer with at least
      // one GPU-brush stroke. Particles are bound to the strokes the
      // user drew via the Light Painting tool; the compute pass
      // animates them per frame. Renders additively over the bridge
      // frame.
      //
      // Per-frame: re-collect strokes (cheap; setStrokes is hash-
      // keyed so it's a no-op when nothing immutable changed) AND
        // push current progress values (for the drawing-head animation
        // — particles "draw on" as the layer's playback timeline runs).
      if (strokeParticles && brushCanvas && brushCtx) {
        const proj = getProjectSync();
        if (proj) {
          const lpLayers = proj.layers
            .filter((l) => l.type === 'lightpainting')
            .map((l) => ({ id: l.id, visible: l.visible, lightPaintingContent: l.lightPaintingContent }));
          const { strokes: gpuStrokes, progresses } = collectGPUStrokes(lpLayers);
          strokeParticles.setStrokes(gpuStrokes);
          strokeParticles.updateProgresses(progresses);
        }
        // Render the brushes into the offscreen brush canvas (NOT the
        // present view). Keep it sized to the present resolution. The
        // engine picks this canvas up via gpuBrushBridge and composites
        // it at the light-paint layer's z — see gpuBrushBridge.ts.
          if (brushCanvas.width !== presentCanvas.width || brushCanvas.height !== presentCanvas.height) {
            brushCanvas.width = presentCanvas.width;
            brushCanvas.height = presentCanvas.height;
            configureBrushCanvasContext();
          }
          configureBrushCanvasContext();
          const brushView = brushCtx.getCurrentTexture().createView();
          // Clear the brush surface transparent first — encodeFrame uses
          // loadOp:'load' (composites additively onto existing content),
          // so without this clear the brushes would accumulate frame over
          // frame into a solid smear.
          const clearPass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: brushView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          clearPass.end();
          strokeParticles.setViewport(brushCanvas.width, brushCanvas.height);
          strokeParticles.encodeFrame(encoder, brushView);
        }

        // ── Pixel-FX layers ──
        // Each pixel-fx layer has its own WebGPUPixelParticles instance,
        // owns its source texture + particle buffer, and renders in
        // layer-stack order over the bridge frame. Per-layer state
        // (mode, knobs, source) is read from the project store each
        // frame and reconciled into the renderer's setters.
      const proj = getProjectSync();
      if (proj && device) {
        // Find/create renderers for visible pixel-fx layers and tear
        // down any whose layers no longer exist.
        const visiblePxLayers = proj.layers.filter(
          (l) => l.type === 'pixel-fx' && l.visible && l.pixelFXContent != null,
        );
        const liveIds = new Set(visiblePxLayers.map((l) => l.id));
        for (const [id, r] of pixelFXRenderers) {
          if (!liveIds.has(id)) {
            try { r.dispose?.(); } catch { /* */ }
            pixelFXRenderers.delete(id);
            pixelFXLoadedSourceUrl.delete(id);
            // Pause + release the cached video so the decoder can be
            // reclaimed.
            const v = pixelFXVideoEl.get(id);
            if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* */ } }
            pixelFXVideoEl.delete(id);
            pixelFXVideoSrc.delete(id);
          }
        }
        // Mirror reap for the flythrough renderer map — same liveIds
        // set drives both. A layer that toggles mode away from
        // flythrough also gets its flythrough renderer reclaimed here
        // (its id will still be in `liveIds`, but the per-layer branch
        // below will skip the flythrough path and the renderer sits
        // idle — we reap it below when the mode-flip is detected).
        for (const [id, r] of flythroughRenderers) {
          if (!liveIds.has(id)) {
            try { r.dispose?.(); } catch { /* */ }
            flythroughRenderers.delete(id);
            flythroughLoadedSourceKey.delete(id);
          }
        }
        for (const layer of visiblePxLayers) {
          const c = layer.pixelFXContent!;

          // ── Flythrough mode early-branch ─────────────────────────
          // Layers in `flythrough` mode are handled by the dedicated
          // WebGPUFlythrough renderer rather than WebGPUPixelParticles.
          // Self-contained: resolves source, creates the renderer if
          // needed, applies params, encodes the frame, then `continue`s
          // past the standard pixel-fx code. Mode-flip handling: if the
          // user switches a layer's mode away from flythrough, the
            // existing flythrough renderer for that layer is disposed
            // here so its GPU resources don't leak. The reverse case
          // (flipping INTO flythrough) is handled by the lazy-create
          // below + the standard-mode renderer being disposed by its
          // own loop (it'll see the mode change next frame).
            if (c.mode === 'flythrough') {
              // Tear down the standard-mode renderer if it exists — the
              // user just flipped this layer into flythrough mode.
              const stale = pixelFXRenderers.get(layer.id);
              if (stale) {
                try {
                  stale.dispose?.();
                } catch {
                  /* */
                }
                pixelFXRenderers.delete(layer.id);
                pixelFXLoadedSourceUrl.delete(layer.id);
              }

              // Lazy-create the flythrough renderer for this layer.
              let fly = flythroughRenderers.get(layer.id);
              if (!fly) {
                try {
                  fly = new WebGPUFlythrough(device, preferredFormat);
                  flythroughRenderers.set(layer.id, fly);
                } catch (err: any) {
                  console.error('[flythrough] init failed for layer', layer.id, err?.message || err);
                  continue;
                }
              }

              // ── Source resolution (mirrors the standard-mode logic
              // immediately below; kept inline so the two paths can
              // evolve independently without one breaking the other).
              const loadImageOnceFly = (src: string, cacheKey: string, label: string) => {
                if (cacheKey === flythroughLoadedSourceKey.get(layer.id)) return;
                flythroughLoadedSourceKey.set(layer.id, cacheKey);
                const img = new Image();
                if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
                img.onload = () => {
                  fly!
                    .setSourceImage(img)
                    .catch((e) => console.warn('[flythrough]', label, 'setSourceImage failed', e));
                };
                img.onerror = (e) => console.warn('[flythrough]', label, 'image load failed for', src, e);
                img.src = src;
              };

              if (c.sourceType === 'media' && c.sourceMediaId) {
                const items = getStore(mediaLibrary);
                const item = items.find((m: any) => m.id === c.sourceMediaId);
                if (item && item.type === 'video') {
                  const vid: HTMLVideoElement | undefined =
                    item.videoElement || (item.src ? ensurePixelFXVideo(layer.id, item.src) : undefined);
                  if (vid) fly.updateSourceFromVideo(vid);
                } else if (item && item.src) {
                  loadImageOnceFly(item.src, `media:${item.id}:${item.src}`, 'media-library');
                }
              } else if (c.sourceType === 'layer' && c.sourceLayerId) {
                const sourceLayer = proj.layers.find((l) => l.id === c.sourceLayerId);
                if (sourceLayer && sourceLayer.source) {
                  const ms = sourceLayer.source;
                  const vid: HTMLVideoElement | undefined =
                    (ms as any).videoElement ||
                    (ms.type === 'video' && ms.src ? ensurePixelFXVideo(layer.id, ms.src) : undefined);
                  if (vid) {
                    fly.updateSourceFromVideo(vid);
                    flythroughLoadedSourceKey.set(layer.id, `layer:${c.sourceLayerId}:video`);
                  } else if (ms.src) {
                    loadImageOnceFly(ms.src, `layer:${c.sourceLayerId}:${ms.src}`, 'layer-source');
                  }
                }
              } else if (c.sourceUrl) {
                const isVideo = c.sourceType === 'video';
                const cacheKey = `file:${c.sourceUrl}`;
                if (isVideo) {
                  const v = ensurePixelFXVideo(layer.id, c.sourceUrl);
                  fly.updateSourceFromVideo(v);
                  flythroughLoadedSourceKey.set(layer.id, cacheKey);
                } else {
                  loadImageOnceFly(c.sourceUrl, cacheKey, 'file');
                }
              }

              // Apply per-frame parameters. The renderer hashes nothing
              // internally — every frame we just set the current values.
              //
              // Audio reactivity (when `flythroughAudioReactive` is on):
              //   bass   → boosts fly speed (kick = forward burst)
              //   treble → boosts flow strength (high freq = swirl chaos)
              // The configured baselines stay the "silence" values; the
              // bands ADD to them rather than replace them, so the layer
              // never goes static when the music drops out. Both bands
              // are 0..1 normalized from the audio analyzer.
              const baseFlySpeed = c.flythroughFlySpeed ?? 0.8;
              const baseFlowStrength = c.flythroughFlowStrength ?? 0.4;
              const reactive = c.flythroughAudioReactive && lastAudioBands;
              const audioFlySpeed = reactive ? baseFlySpeed * (1 + lastAudioBands!.bass * 1.8) : baseFlySpeed;
              const audioFlowStrength = reactive
                ? baseFlowStrength * (1 + lastAudioBands!.treble * 1.5)
                : baseFlowStrength;

              fly.setParams({
                topology: c.flythroughTopology ?? 'strokes',
                depthSource: c.flythroughDepthSource ?? 'luminance',
                flySpeed: audioFlySpeed,
                tunnelDepth: c.flythroughTunnelDepth ?? 2.0,
                slabCount: c.flythroughSlabCount ?? 4,
                flowStrength: audioFlowStrength,
                flowScale: c.flythroughFlowScale ?? 2.0,
                anchorPull: c.flythroughAnchorPull ?? 1.2,
                strokeLength: c.flythroughStrokeLength ?? 0.08,
                strokeWidth: c.flythroughStrokeWidth ?? 0.006,
                depthStrength: c.flythroughDepthStrength ?? 0.5,
                baseSize: c.baseSize ?? 0.005,
                opacity: (c.opacity ?? 1) * (layer.opacity ?? 1),
                fovDeg: c.fovDeg ?? 50,
                cameraYaw: c.cameraYaw ?? 0,
                cameraPitch: c.cameraPitch ?? 0,
                particleCount: c.particleCount ?? 250_000,
              });
              fly.setBlendMode(layer.blendMode || 'add');
              fly.setViewport(presentCanvas.width, presentCanvas.height);
              fly.encodeFrame(encoder, view);
              continue;
            }

            let renderer = pixelFXRenderers.get(layer.id);
            if (!renderer) {
              // Lazy create — first frame for this layer. Failures are
              // non-fatal; the rest of the canvas keeps rendering.
              try {
                renderer = new (WebGPUPixelParticles as any)(device, preferredFormat);
                pixelFXRenderers.set(layer.id, renderer!);
              } catch (err: any) {
                console.error('[pixel-fx] init failed for layer', layer.id, err?.message || err);
                continue;
              }
            }
            renderer = renderer!;
            // ── Source resolution ──
            // Three source paths, in priority order:
            //   sourceType === 'media': pull from a Media Library item
            //     by id. Same items the Media Tray shows. Most common
            //     path — items already loaded into the project library.
            //   sourceType === 'layer': pull from another layer's media
          //     (image src or videoElement). Use when you've
            //     configured trim/playback on a media layer and want
            //     the pixel-fx to inherit it.
            //   else: load from sourceUrl (one-off file picker).
            // Videos are pumped per frame for live playback; images
            // load once per source change (cache-keyed).
            // Helper: load a still image into the renderer (one-time
            // per source change). Images that fail to decode are
            // logged but do not block the rest of the pipeline.
            const loadImageOnce = (src: string, cacheKey: string, label: string) => {
              if (cacheKey === pixelFXLoadedSourceUrl.get(layer.id)) return;
              pixelFXLoadedSourceUrl.set(layer.id, cacheKey);
              const img = new Image();
              if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
              img.onload = () => {
                renderer!
                  .setSourceImage(img)
                  .catch((e) => console.warn('[pixel-fx]', label, 'setSourceImage failed', e));
              };
              img.onerror = (e) => console.warn('[pixel-fx]', label, 'image load failed for', src, e);
              img.src = src;
            };

            if (c.sourceType === 'media' && c.sourceMediaId) {
              const items = getStore(mediaLibrary);
              const item = items.find((m: any) => m.id === c.sourceMediaId);
              if (!item) {
                const cacheKey = `media:${c.sourceMediaId}:not-found`;
                if (cacheKey !== pixelFXLoadedSourceUrl.get(layer.id)) {
                  pixelFXLoadedSourceUrl.set(layer.id, cacheKey);
                  console.warn('[pixel-fx] media library item not found for id', c.sourceMediaId);
                }
              } else if (item.type === 'video') {
                // Prefer the existing videoElement if MediaTray made
                // one; otherwise create our own from the src so the
                // user doesn't need to first place the media on a
              // layer. Pumped per frame.
              const vid: HTMLVideoElement | undefined = item.videoElement || (item.src ? ensurePixelFXVideo(layer.id, item.src) : undefined);
              if (vid) {
                renderer.updateSourceFromVideo(vid);
                if (`media:${item.id}:video` !== pixelFXLoadedSourceUrl.get(layer.id)) {
                  pixelFXLoadedSourceUrl.set(layer.id, `media:${item.id}:video`);
                  console.log('[pixel-fx] source: media library video', item.name, 'src=', item.src?.slice(0, 64));
                }
              }
            } else if (item.src) {
              const cacheKey = `media:${item.id}:${item.src}`;
              if (cacheKey !== pixelFXLoadedSourceUrl.get(layer.id)) {
                console.log('[pixel-fx] source: media library image', item.name, 'src=', item.src.slice(0, 64));
              }
              loadImageOnce(item.src, cacheKey, 'media-library');
            }
          } else if (c.sourceType === 'layer' && c.sourceLayerId) {
            const sourceLayer = proj.layers.find((l) => l.id === c.sourceLayerId);
            if (sourceLayer && sourceLayer.source) {
              const ms = sourceLayer.source;
              const vid: HTMLVideoElement | undefined = (ms as any).videoElement
                || (ms.type === 'video' && ms.src ? ensurePixelFXVideo(layer.id, ms.src) : undefined);
              if (vid) {
                renderer.updateSourceFromVideo(vid);
                pixelFXLoadedSourceUrl.set(layer.id, `layer:${c.sourceLayerId}:video`);
              } else if (ms.src) {
                loadImageOnce(ms.src, `layer:${c.sourceLayerId}:${ms.src}`, 'layer-source');
              }
            }
          } else if (c.sourceUrl) {
            // File / URL source path. Detect video by sourceType OR
            // by file extension/mime hint in the URL — the panel sets
            // sourceType when the user picks via file dialog.
            const isVideo = c.sourceType === 'video';
            const cacheKey = `file:${c.sourceUrl}`;
            if (isVideo) {
              const v = ensurePixelFXVideo(layer.id, c.sourceUrl);
              renderer.updateSourceFromVideo(v);
              if (cacheKey !== pixelFXLoadedSourceUrl.get(layer.id)) {
                console.log('[pixel-fx] source: file video', c.sourceUrl.slice(0, 64));
                pixelFXLoadedSourceUrl.set(layer.id, cacheKey);
              }
            } else {
              if (cacheKey !== pixelFXLoadedSourceUrl.get(layer.id)) {
                console.log('[pixel-fx] source: file image', c.sourceUrl.slice(0, 64));
              }
              loadImageOnce(c.sourceUrl, cacheKey, 'file');
            }
          }
          // Apply per-frame settings (cheap setters; renderer hashes
          // internally to avoid duplicate writes).
          renderer.setMode(c.mode);
          renderer.setKnobs(c.knobs);
          renderer.setBaseSize(c.baseSize);
          renderer.setOpacity(c.opacity * (layer.opacity ?? 1));
          renderer.setAnchorJitter(c.anchorJitter);
          renderer.setCamera(c.fovDeg, c.cameraZ);
          renderer.setOrbit(c.cameraYaw ?? 0, c.cameraPitch ?? 0);
          renderer.setPan(c.panX ?? 0, c.panY ?? 0);
          renderer.setLight(
            c.lightEnabled ?? false,
            c.lightX ?? 1, c.lightY ?? 1, c.lightZ ?? 1.5,
            c.lightIntensity ?? 1.5, c.lightAmbient ?? 0.25, c.lightHeightStrength ?? 1.5,
          );
          renderer.setNoise(c.noiseAmpXY ?? 0, c.noiseAmpZ ?? 0, c.noiseFreq ?? 4, c.noiseSpeed ?? 0.5);
          // Honor the layer's blend mode so pixel-fx composites
            // properly with whatever's behind (the bridge frame, which
          // contains all CPU layers). Default 'add' kept unintended-
          // additive behaviour visible; users will probably want
          // 'normal' or 'screen' for video sources.
          renderer.setBlendMode(layer.blendMode || 'add');
          renderer.setParticleCount(c.particleCount);
          renderer.setViewport(presentCanvas.width, presentCanvas.height);
          renderer.encodeFrame(encoder, view);
        }
      }

        device.queue.submit([encoder.finish()]);
        const us = (performance.now() - t0) * 1000;
        renderTimeUsEMA = renderTimeUsEMA === 0 ? us : renderTimeUsEMA * 0.9 + us * 0.1;

        framesPresented++;
        const now = performance.now();
        if (lastFrameAt > 0) {
          const dt = now - lastFrameAt;
          const inst = 1000 / Math.max(1, dt);
          fpsEMA = fpsEMA === 0 ? inst : fpsEMA * 0.9 + inst * 0.1;
        }
        lastFrameAt = now;
        presentSucceeded = true;
      } catch (err) {
        // Loud diagnostic for GPU-encoding errors. The helper's outer
        // try/finally still closes the VideoFrame regardless.
        console.error('[WebGPUCanvas] presentFrame error:', err);
      }
    });
    if (!presentSucceeded) framesSkipped++;
  }

  function startFrameLoop() {
    if (rafId !== null) return;
    const tick = () => {
      if (disposed) return;
      if (initStatus === 'no-source' && sourceCanvas) initStatus = 'running';
      // Total output freeze: skip presenting so the GPU brush compute
      // passes stop advancing. The canvas retains its last frame. RAF
      // keeps rescheduling so we resume instantly on unfreeze.
      if (initStatus === 'running' && !frozen) {
        try {
          presentFrame();
          frameLoopErrorCount = 0;
        } catch (err) {
          frameLoopErrorCount++;
          framesSkipped++;
          if (frameLoopErrorCount <= 3 || frameLoopErrorCount % 60 === 0) {
            console.error('[WebGPUCanvas] frame loop recovered after present error:', err);
          }
        }
      }
      // Note: in WebGPU mode the master warp is applied IN presentFrame's
      // shader (updateWarpUniform), so no separate WebGL warp tick here —
      // presentCanvas is already warped and is what the transports capture.
      // Dev-mode VideoFrame leak watchdog — early-returns when
      // `window.__VIDEO_FRAME_DEBUG__` is falsy, so this is free
      // in production. When debug is on, warns if >1 frame stays
      // open for >10 consecutive ticks — catches "I added a new
      // bridge site and forgot to use the helper" regressions.
      checkVideoFrameLeaks();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function stopFrameLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // ── Paint drip input handlers ─────────────────────────────────────
  // Mouse position is converted to normalized canvas coords (0..1)
  // based on the wrapper's bounding rect. We listen on window so the
  // overlay's `pointer-events: none` doesn't block us — and so the
  // user can drag-paint anywhere over the editor canvas without
  // breaking the underlying mapping/selection clicks (those still
  // hit Canvas.svelte's wrapper underneath us).
  function onMouseMove(e: MouseEvent): void {
    if (!presentCanvas || !wrapperEl) return;
    const r = presentCanvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    if (inside) {
      mouseSpawnU = u;
      mouseSpawnV = v;
    }
    // Forward to output cursor overlay when enabled in settings.
    // Visible only while the cursor is inside the canvas; goes
    // hidden the moment the user moves off so the cursor doesn't
    // stick at the edge.
    if (outputShowCursor) {
      setOutputCursor(inside ? u : 0, inside ? v : 0, inside);
    }
  }
  function onMouseDown(e: MouseEvent): void {
    // Only spawn on primary button. Right-click / middle-click are
    // reserved for mapping context menus / pan.
    if (e.button !== 0) return;
    onMouseMove(e);
    mouseDown = true;
    // When an adv-lightpaint layer is selected AND the click is over
    // the editor canvas, stop the editor's marquee selection from
    // engaging — the user is painting, not selecting layers. This
    // works because we're in the capture phase (registered above);
    // calling stopPropagation here prevents the bubble-phase marquee
    // handler from running. Don't preventDefault — that would suppress
    // focus changes the OS expects.
    if (advPaintSelected && presentCanvas && wrapperEl) {
      const r = presentCanvas.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        e.stopPropagation();
      }
    }
  }
  function onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    mouseDown = false;
    if (advPaintSelected) {
      // Match mousedown's stopPropagation so the marquee handler
      // doesn't see a stray mouseup and produce a phantom selection.
      e.stopPropagation();
    }
  }
  onMount(async () => {
    await initWebGPU();
    if (initStatus === 'no-source' || initStatus === 'running') {
      startFrameLoop();
    }
    // Subscribe to output settings for cursor — toggle, style, size,
    // thickness, color, opacity. Each settings change pushes a fresh
    // cursorStyle message to the output presenter; the cursor flag
    // gates whether mousemove forwards positions at all.
    //
    // This subscription ALSO owns output registration when the WebGPU
    // pilot is on: presentCanvas is the real present surface, so we
    // register it (or the master-warped derivative) with the transports
    // via the single reconciler. (Canvas.svelte skips registration in
    // bridgeMode so the two don't fight.)
    settingsUnsub = settings.subscribe((s) => {
      reconcileOutputRegistration();
      outputShowCursor = s.output?.outputShowCursor ?? false;
      setOutputCursorStyle({
        style: s.output?.outputCursorStyle ?? 'crosshair',
        sizePx: s.output?.outputCursorSize ?? 28,
        thicknessPx: s.output?.outputCursorThickness ?? 2,
        color: s.output?.outputCursorColor ?? '#ffffff',
        opacity: s.output?.outputCursorOpacity ?? 0.85,
      });
      // If the user just turned the cursor OFF, hide it immediately
      // so it doesn't linger at the last-known position on the
      // output until the next mousemove.
      if (!outputShowCursor) setOutputCursor(0, 0, false);
    });

    // Hook input handlers in the CAPTURE phase. The editor's marquee
    // selection handler (somewhere inside the canvas wrapper) calls
    // stopPropagation on mousedown — bubble-phase listeners on
    // window never get the event. Capture-phase fires from window
    // DOWN to the target before any descendant runs, so we get the
    // event regardless of who later stops it. We don't preventDefault
    // — the editor's handlers still run, the marquee still works,
    // we just see the event too. (When an adv-lightpaint layer is
    // SELECTED, we also stopPropagation on mousedown ourselves so
    // the marquee doesn't appear during paint — see onMouseDown.)
    window.addEventListener('mousemove', onMouseMove, { capture: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mouseup', onMouseUp, { capture: true });

    // Subscribe to the shared visual-audio bus so light painting and
    // flythrough motion inherit the same Milkdrop-style smoothing as the rest of
    // the renderer. Also snapshots the full bass/mid/treble vector into
    // `lastAudioBands` so the per-frame flythrough loop can read
    // it without re-subscribing per layer.
    audioUnsub = visualAudio.subscribe((audio) => {
      const bassEnergy = Math.max(audio.bassFast, audio.kick * 0.85);
      if (advPaint) advPaint.setBassEnergy(bassEnergy);
      lastAudioBands = { bass: bassEnergy, mid: audio.mid, treble: audio.high };
    });

    // Mirror the output-freeze store into a local flag the tick reads.
    frozenUnsub = outputFrozen.subscribe((v) => { frozen = v; });

    // Subscribe to project + selected layer so we know:
    //  - whether ANY adv-lightpaint layer exists (controls render
    //    pass enable)
    //  - whether the SELECTED layer is one (controls mouse routing
    //    + which content drives the brush params)
    projectUnsub = project.subscribe((p) => {
      const advLayers = p.layers.filter((l) => l.type === 'adv-lightpaint');
      advPaintLayerCount = advLayers.length;
      if (advPaintLayerCount > 0 && !advPaintSelected) {
        advPaintActiveContent = advLayers[0].advLightPaintingContent;
      } else if (advPaintLayerCount === 0) {
        advPaintActiveContent = null;
      }
      if (advPaint) advPaint.setContent(advPaintActiveContent);

      // Light Painting GPU brushes — initial setStrokes from the
      // projectUnsub fires only on project change. Per-frame
      // collection happens in presentFrame() so progress can
      // advance with playback time even when the project store
      // is silent. setStrokes is hash-keyed so identical-state
      // ticks here are no-ops.
      if (strokeParticles) {
        const lpLayers = p.layers
          .filter((l) => l.type === 'lightpainting')
          .map((l) => ({ id: l.id, visible: l.visible, lightPaintingContent: l.lightPaintingContent }));
        const collected = collectGPUStrokes(lpLayers);
        strokeParticles.setStrokes(collected.strokes);
      }
    });
    selectedLayerUnsub = selectedLayer.subscribe((sl) => {
      if (sl?.type === 'adv-lightpaint' && sl.advLightPaintingContent) {
        advPaintSelected = true;
        advPaintActiveContent = sl.advLightPaintingContent;
        if (advPaint) advPaint.setContent(advPaintActiveContent);
      } else {
        advPaintSelected = false;
        if (advPaintLayerCount === 0) advPaintActiveContent = null;
      }
    });
  });

  onDestroy(() => {
    disposed = true;
    stopFrameLoop();
    stopOutputSharedTexturePresenter();
    // Owner-scoped: this renderer may have registered presentCanvas (live)
    // or sourceCanvas (WebGPU-init-failed fallback). Only clears/disposes
    // if one of those owns the current registration.
    disposeMasterWarpOutput(presentCanvas, sourceCanvas);
    window.removeEventListener('mousemove', onMouseMove, { capture: true } as any);
    window.removeEventListener('mousedown', onMouseDown, { capture: true } as any);
    window.removeEventListener('mouseup', onMouseUp, { capture: true } as any);
    if (audioUnsub) { try { audioUnsub(); } catch { /* */ } audioUnsub = null; }
    if (frozenUnsub) { try { frozenUnsub(); } catch { /* */ } frozenUnsub = null; }
    setGPUBrushCanvas(null);
    brushCanvas = null; brushCtx = null;
    if (projectUnsub) { try { projectUnsub(); } catch { /* */ } projectUnsub = null; }
    if (selectedLayerUnsub) { try { selectedLayerUnsub(); } catch { /* */ } selectedLayerUnsub = null; }
    if (settingsUnsub) { try { settingsUnsub(); } catch { /* */ } settingsUnsub = null; }
    try { advPaint?.dispose?.(); } catch { /* */ }
    advPaint = null;
    try { strokeParticles?.dispose?.(); } catch { /* */ }
    strokeParticles = null;
    for (const r of pixelFXRenderers.values()) { try { r.dispose?.(); } catch { /* */ } }
    pixelFXRenderers.clear();
    pixelFXLoadedSourceUrl.clear();
    for (const r of flythroughRenderers.values()) { try { r.dispose?.(); } catch { /* */ } }
    flythroughRenderers.clear();
    flythroughLoadedSourceKey.clear();
    try { device?.destroy?.(); } catch { /* */ }
  });
</script>

<div class="webgpu-bridge-overlay" bind:this={wrapperEl}>
  <canvas bind:this={presentCanvas} class="webgpu-present"></canvas>
  {#if initStatus === 'no-webgpu' || initStatus === 'error'}
    <div class="error-overlay">
      <div class="error-title">{$t('gpuTools.webgpu.bridgeError')}</div>
      <div class="error-body">{initError}</div>
      <div class="error-hint">
        {$t('gpuTools.webgpu.errorHint', { values: { flag: 'experimental.editorWebGPU' } })}
      </div>
    </div>
  {/if}
  <!-- (Phase 3 development overlay removed — WebGPU bridge + paint
       systems are stable. Re-enable for diagnostics by setting
       window.__WEBGPU_DEBUG__ = true and reloading.) -->
</div>

<style>
  .webgpu-bridge-overlay {
    /* Overlay: positioned absolutely on top of the underlying
       Canvas.svelte. pointer-events: none lets all clicks /
       drag / mouse events fall through to Canvas's wrapper for
       mapping interactions. */
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .webgpu-present {
    /* Match the underlying canvas's letterboxed display rect —
       Canvas.svelte centers its canvas via flexbox in a fixed-aspect
       container; we mirror that with object-fit on a max-sized
       canvas. */
    display: block;
    background: #000;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  /* Error overlay — only shows when WebGPU init fails. Stays in
     production so users get an actionable message instead of a
     silent black canvas. */
  .error-overlay {
    position: absolute;
    top: 12px;
    left: 12px;
    background: rgba(20, 20, 30, 0.85);
    border: 1px solid rgba(255, 60, 60, 0.5);
    color: var(--text-primary, #ddd);
    padding: 10px 14px;
    border-radius: 4px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.5;
    pointer-events: none;
    max-width: 360px;
  }
  .error-title {
    font-weight: 700;
    font-size: 13px;
    color: #fff;
    margin-bottom: 6px;
  }
  .error-hint {
    font-size: 11px;
    color: var(--text-muted, #888);
    margin-top: 8px;
  }
  code {
    background: rgba(255, 255, 255, 0.08);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 11px;
  }
</style>
