/**
 * videoFrameBridge — the zero-copy WebGL → WebGPU primitive.
 *
 * The bridge model in one line: wrap a WebGL canvas in a `VideoFrame`,
 * hand it to `device.importExternalTexture()`, and you have a
 * GPU-resident sampleable texture without ever touching CPU memory
 * (in Chromium 130+ with a GPU-accelerated source canvas — Chromium
 * backs the VideoFrame with a `GpuMemoryBuffer` underneath).
 *
 * This file exists because the bridge is the strategic default path
 * for the GPU edition. Every site that hops from WebGL into WebGPU
 * should use the helpers here instead of inlining the pattern, for
 * three reasons:
 *
 *   1. **Leak protection.** Each `VideoFrame` instance holds a GPU
 *      buffer until you call `.close()`. Forgetting `.close()` even
 *      once per second leaks GPU memory hard (the buffer is typically
 *      ~8MB for 1080p, ~33MB for 4K). The `withVideoFrame()` helper
 *      wraps the entire usage in a try/finally so the close call
 *      can't be skipped by an early return or thrown exception.
 *
 *   2. **Dev-mode leak counter.** When `window.__VIDEO_FRAME_DEBUG__`
 *      is truthy, the helper tracks open VideoFrames. If the count
 *      stays elevated for >10 ticks, it warns. Catches "I forgot to
 *      close() in some new bridge site" regressions at dev time
 *      before they ship.
 *
 *   3. **One place to upgrade.** When Chromium ships a future API
 *      that replaces VideoFrame for this use case (e.g. a more
 *      direct OffscreenCanvas → WebGPU transfer), only this file
 *      changes. Callers are insulated.
 *
 * ──────────────────────────────────────────────────────────────────
 * IMPORTANT: `texture_external` is FRAGMENT-SHADER ONLY.
 *
 * The texture returned by `device.importExternalTexture()` has the
 * WGSL type `texture_external`, which can only be sampled in a
 * fragment shader (via `textureSampleBaseClampToEdge` or similar).
 * It CANNOT be:
 *   - Sampled from a vertex shader
 *   - Bound as a storage texture in a compute shader
 *   - Used as a render-pass attachment
 *
 * If you need any of those, use `blitExternalToTexture2D()` below to
 * copy the external texture into a regular `GPUTexture` first, then
 * use the regular texture in your compute / vertex / attachment
 * pipeline. The blit is one fragment pass — cheap, but not free.
 * Required for: compute particles reading WebGL output, ping-pong
 * feedback textures, datamosh, optical flow, anything else with
 * sample patterns more complex than "sample at uv in a fragment
 * shader to draw a fullscreen quad."
 *
 * ──────────────────────────────────────────────────────────────────
 * Health monitoring: every `VideoFrame` carries a `.format` field.
 * On modern Chromium with a GPU-accelerated source canvas you'll
 * typically see `'NV12'` or `'I420'` (= GPU-backed zero-copy). If
 * you see `'BGRA'`, Chromium fell back to CPU readback — a sign
 * the source canvas isn't actually GPU-accelerated, or hardware
 * doesn't expose the SharedImage extension.
 */

// Open VideoFrame instances tracked for the dev-mode leak counter.
// Map preserves insertion order so we can spot the oldest unclosed
// frame if a leak develops.
const _openFrames = new Set<VideoFrame>();
let _consecutiveTicksAboveOne = 0;
const LEAK_TICK_THRESHOLD = 10;

function _isDebugEnabled(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__VIDEO_FRAME_DEBUG__;
}

function _registerOpen(frame: VideoFrame): void {
  if (!_isDebugEnabled()) return;
  _openFrames.add(frame);
}

function _registerClosed(frame: VideoFrame): void {
  if (!_isDebugEnabled()) return;
  _openFrames.delete(frame);
}

/**
 * Periodic leak check — call once per rAF tick from a host loop
 * (typically WebGPUCanvas's frame loop). Cheap when debug is off
 * (early-return on the flag check). When debug IS on and the open
 * count stays > 1 for LEAK_TICK_THRESHOLD consecutive ticks, logs a
 * warning with the count.
 *
 * The threshold of 1 is intentional: in steady-state you should have
 * AT MOST one open VideoFrame at any moment (the one currently being
 * sampled in this frame). Anything above 1 means a previous frame
 * wasn't closed before the next was opened.
 */
export function checkVideoFrameLeaks(): void {
  if (!_isDebugEnabled()) return;
  if (_openFrames.size > 1) {
    _consecutiveTicksAboveOne++;
    if (_consecutiveTicksAboveOne === LEAK_TICK_THRESHOLD) {
      console.warn(
        '[videoFrameBridge] leak suspected:',
        _openFrames.size,
        'open VideoFrames for',
        LEAK_TICK_THRESHOLD,
        'consecutive ticks. Make sure every bridge site uses withVideoFrame() or matching try/finally close.',
      );
    }
  } else {
    _consecutiveTicksAboveOne = 0;
  }
}

export interface VideoFrameOptions {
  /** Override timestamp (microseconds). Defaults to `performance.now() * 1000`. */
  timestamp?: number;
  /** Optional explicit alpha hint. Chromium picks automatically if omitted. */
  alpha?: 'keep' | 'discard';
}

/**
 * Wrap a `VideoFrame` lifetime around a synchronous callback.
 *
 * The callback receives the imported `GPUExternalTexture` — the
 * caller stays focused on USING it, not managing it. The frame is
 * always closed when the callback returns (or throws). This is the
 * recommended primitive for every WebGL→WebGPU bridge site.
 *
 * Example:
 * ```ts
 * withExternalTexture(device, webglCanvas, (extTex) => {
 *   const bindGroup = device.createBindGroup({
 *     layout: bindGroupLayout,
 *     entries: [
 *       { binding: 0, resource: sampler },
 *       { binding: 1, resource: extTex },
 *     ],
 *   });
 *   pass.setBindGroup(0, bindGroup);
 *   pass.draw(6, 1, 0, 0);
 * });
 * ```
 *
 * Returns the callback's return value (if any). Returns `undefined`
 * and logs a warning if the VideoFrame construction fails (e.g.,
 * source canvas has 0x0 dimensions, browser doesn't support
 * VideoFrame on the source type). Caller should treat undefined as
 * "skip this frame" — typical pattern is to just not draw.
 *
 * Note: `texture_external` is fragment-shader-only. See module header.
 */
export function withExternalTexture<T = void>(
  device: any, // GPUDevice — typed as `any` to match the codebase convention
  source: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement,
  fn: (externalTexture: any) => T, // externalTexture: GPUExternalTexture
  options?: VideoFrameOptions,
): T | undefined {
  // 0×0 sources throw on VideoFrame construction. Caller might have
  // a canvas that hasn't been sized yet — return early.
  const w = (source as any).width ?? (source as any).videoWidth ?? 0;
  const h = (source as any).height ?? (source as any).videoHeight ?? 0;
  if (w === 0 || h === 0) return undefined;

  let videoFrame: VideoFrame | null = null;
  try {
    videoFrame = new VideoFrame(source as any, {
      timestamp: options?.timestamp ?? performance.now() * 1000,
      alpha: options?.alpha,
    });
    _registerOpen(videoFrame);
    const externalTexture = device.importExternalTexture({ source: videoFrame });
    return fn(externalTexture);
  } catch (err: any) {
    // Common failure: VideoFrame constructor throws if the canvas is
    // currently unrenderable (Three.js context lost, OffscreenCanvas
    // detached, etc.). Don't spam logs — just skip the frame.
    if (_isDebugEnabled()) {
      console.warn('[videoFrameBridge] frame skipped:', err?.message ?? err);
    }
    return undefined;
  } finally {
    if (videoFrame) {
      _registerClosed(videoFrame);
      try { videoFrame.close(); } catch { /* */ }
    }
  }
}

/**
 * Copy a `GPUExternalTexture` (fragment-only) into a regular
 * `GPUTexture` (full-featured) via a one-pass fullscreen-quad blit.
 *
 * Use this when your downstream pipeline needs to sample the WebGL
 * output from a compute shader, bind it as storage, or use it as
 * input to a ping-pong feedback chain. Costs one fullscreen fragment
 * pass per call.
 *
 * The destination texture must be created with
 * `GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING`
 * (plus whatever else your downstream stage needs).
 *
 * Pipeline + sampler are cached per device on first call so repeated
 * use of the helper doesn't allocate.
 */
// WeakMap key is the GPUDevice — typed `any` to match the rest of
// the codebase. Values are the cached pipeline + sampler + bind
// group layout for this device's blit pass (one set per device).
const _blitPipelineCache = new WeakMap<any, {
  pipeline: any;
  sampler: any;
  bindGroupLayout: any;
}>();

export function blitExternalToTexture2D(
  device: any, // GPUDevice
  encoder: any, // GPUCommandEncoder
  externalTexture: any, // GPUExternalTexture (fragment-only)
  destination: any, // GPUTexture (must have RENDER_ATTACHMENT + TEXTURE_BINDING)
  destinationFormat: any, // GPUTextureFormat
): void {
  let cached = _blitPipelineCache.get(device);
  if (!cached) {
    const shader = device.createShaderModule({
      code: /* wgsl */ `
        @group(0) @binding(0) var samp:  sampler;
        @group(0) @binding(1) var extTex: texture_external;

        struct VOut {
          @builtin(position) pos: vec4<f32>,
          @location(0)       uv:  vec2<f32>,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) vid: u32) -> VOut {
          // Fullscreen triangle: two triangles' worth of vertices via
          // a single 6-vertex draw. UVs go (0,0) → (1,1).
          var positions = array<vec2<f32>, 6>(
            vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2(-1.0,  1.0),
            vec2(-1.0,  1.0), vec2( 1.0, -1.0), vec2( 1.0,  1.0),
          );
          var uvs = array<vec2<f32>, 6>(
            vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(0.0, 0.0),
            vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(1.0, 0.0),
          );
          var out: VOut;
          out.pos = vec4(positions[vid], 0.0, 1.0);
          out.uv  = uvs[vid];
          return out;
        }

        @fragment
        fn fs_main(in: VOut) -> @location(0) vec4<f32> {
          return textureSampleBaseClampToEdge(extTex, samp, in.uv);
        }
      `,
    });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
      ],
    });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shader, entryPoint: 'vs_main' },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format: destinationFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    cached = { pipeline, sampler, bindGroupLayout };
    _blitPipelineCache.set(device, cached);
  }

  const bindGroup = device.createBindGroup({
    layout: cached.bindGroupLayout,
    entries: [
      { binding: 0, resource: cached.sampler },
      { binding: 1, resource: externalTexture },
    ],
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: destination.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(cached.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6, 1, 0, 0);
  pass.end();
}
