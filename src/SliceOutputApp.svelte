<script lang="ts">
  /**
   * SliceOutputApp — Output window for a single multi-output slice
   * routed to a physical display (`targetType: 'display'` on the slice).
   *
   * Mounted by main.ts when the URL is `?mode=slice-display&sliceId=X`.
   * The window is opened by `output_open_slice_window` in main.js and
   * sized to the assigned display's bounds (borderless fullscreen).
   *
   * Architecture (Phase 3 — zero-copy WebGPU display presentation):
   *
   *   1. <Canvas/> is mounted hidden (visibility:hidden + sized to the
   *      master canvas resolution) so it runs the full state-synced
   *      compositing chain just like the editor.
   *   2. Same-renderer slice windows receive the editor's WebGPU-presented
   *      master frame as a VideoFrame over MessagePort and import it as a
   *      WebGPU external texture. Crop, rotation, color correction, edge
   *      blending, and black-level lift run in one fullscreen shader pass.
   *
   *   Legacy separate-process windows still mount Canvas and use the
   *   Canvas2D fallback below. The display path users hit from Screens
   *   stays zero-copy and shader-correct.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import Canvas from './lib/components/Canvas.svelte';
  import { initStateBroadcast, destroyStateBroadcast } from './lib/sync/stateBroadcast';
  import { initLicense } from './lib/stores/license';
  import { settings, type OutputSlice, masterWarpIsActive } from './lib/stores/settings';
  import { applyEdgeBlending } from './lib/output/outputPostProcess';
  import { startMasterWarpOutput, stopMasterWarpOutput, tickMasterWarpOutput, getMasterWarpCanvas, disposeMasterWarpOutput } from './lib/sync/outputComposite';
  import { ensureWebGPUDevice } from './lib/renderer/webgpuShared';
  import { invoke } from '$lib/bridge';

  const urlParams = new URLSearchParams(window.location.search);
  const sliceId = urlParams.get('sliceId') || '';

  let presentCanvas: HTMLCanvasElement | null = null;
  let presentCtx: CanvasRenderingContext2D | null = null;
  let rafId = 0;
  let mainCanvasEl: HTMLCanvasElement | null = null;
  // Zero-copy slice path: opened via window.open() from the editor,
  // receives the editor's already-warped frames via the SAME MessagePort
  // + VideoFrame transport as the Fullscreen output (see
  // outputSharedTexturePresenter — fan-out to multiple ports). The
  // primary display path imports each received frame as a WebGPU
  // external texture and presents through the slice shader below.
  const zeroCopySliceMode = !!window.opener && !!sliceId;
  // Latest VideoFrame received on the MessagePort. Closed and replaced
  // each frame; the WebGPU path keeps only this one live frame.
  let latestFrame: VideoFrame | null = null;
  let attachedPort: MessagePort | null = null;
  let zeroCopyDiagMsg = 'waiting for editor link…';
  let zeroCopyFramesReceived = 0;
  let latestBitmap: ImageBitmap | null = null;
  let useBitmapFallback = false;
  let bitmapFallbackSeq = 0;
  let zeroCopyLastSourceW = 0;
  let zeroCopyLastSourceH = 0;

  let sliceGpuDevice: any = null;
  let sliceGpuContext: any = null;
  let sliceGpuFormat: any = null;
  let sliceGpuPipeline: any = null;
  let sliceGpuSampler: any = null;
  let sliceGpuBindGroupLayout: any = null;
  let sliceGpuUniformBuffer: any = null;
  let sliceGpuUniformStaging: ArrayBuffer | null = null;
  let sliceGpuUniformF32: Float32Array | null = null;
  let sliceGpuReady = false;
  let sliceGpuFailed = false;

  const SLICE_SHADER_WGSL = /* wgsl */ `
@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_external;

struct SliceUniform {
  crop: vec4<f32>,
  color: vec4<f32>,
  blendW: vec4<f32>,
  blendG: vec4<f32>,
  black: vec4<f32>,
};
@group(0) @binding(2) var<uniform> uSlice: SliceUniform;

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

fn srgbToLinear(c: vec3<f32>) -> vec3<f32> {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3<f32>(2.4)), step(vec3<f32>(0.04045), c));
}

fn linearToSrgb(c: vec3<f32>) -> vec3<f32> {
  return mix(c * 12.92, 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055, step(vec3<f32>(0.0031308), c));
}

fn blendCurve(xIn: f32, pIn: f32) -> f32 {
  let x = clamp(xIn, 0.0, 1.0);
  let p = max(pIn, 0.01);
  if (x < 0.5) {
    return 0.5 * pow(2.0 * x, p);
  }
  return 1.0 - 0.5 * pow(2.0 * (1.0 - x), p);
}

fn edgeFactor(distance: f32, width: f32, gamma: f32) -> f32 {
  if (width <= 0.0) {
    return 1.0;
  }
  return blendCurve(distance / width, gamma);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var uv = in.uv;
  let rotation = uSlice.color.w;
  if (rotation > 0.5 && rotation < 1.5) {
    uv = vec2<f32>(uv.y, 1.0 - uv.x);
  } else if (rotation > 1.5 && rotation < 2.5) {
    uv = vec2<f32>(1.0 - uv.x, 1.0 - uv.y);
  } else if (rotation > 2.5) {
    uv = vec2<f32>(1.0 - uv.y, uv.x);
  }

  let crop = uSlice.crop;
  let srcUv = crop.xy + uv * crop.zw;
  let src = textureSampleBaseClampToEdge(uTexture, uSampler, clamp(srcUv, vec2<f32>(0.0), vec2<f32>(1.0)));
  var col = srgbToLinear(src.rgb);

  col = col * max(uSlice.color.x, 0.0);
  col = (col - 0.5) * max(uSlice.color.y, 0.0) + 0.5;
  col = pow(max(col, vec3<f32>(0.0)), vec3<f32>(1.0 / max(uSlice.color.z, 0.01)));

  let edgeUv = in.uv;
  let aL = edgeFactor(edgeUv.x, uSlice.blendW.x, uSlice.blendG.x);
  let aR = edgeFactor(1.0 - edgeUv.x, uSlice.blendW.y, uSlice.blendG.y);
  let aT = edgeFactor(edgeUv.y, uSlice.blendW.z, uSlice.blendG.z);
  let aB = edgeFactor(1.0 - edgeUv.y, uSlice.blendW.w, uSlice.blendG.w);
  let alpha = aL * aR * aT * aB;

  let liftMix = mix(alpha, smoothstep(0.0, 1.0, alpha), clamp(uSlice.black.w, 0.0, 1.0));
  col = col + max(uSlice.black.rgb, vec3<f32>(0.0)) * liftMix;
  col = col * alpha;

  return vec4<f32>(linearToSrgb(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}
`;

  function looksLikeVideoFrame(data: unknown): data is VideoFrame {
    return !!data
      && typeof data === 'object'
      && typeof (data as any).close === 'function'
      && typeof (data as any).codedWidth === 'number'
      && typeof (data as any).codedHeight === 'number';
  }

  function isSameRealmVideoFrame(data: unknown): boolean {
    return typeof VideoFrame !== 'undefined' && data instanceof VideoFrame;
  }

  function sourceWidth(source: unknown, fallback = 0): number {
    const raw = Number(
      (source as any)?.displayWidth
      ?? (source as any)?.codedWidth
      ?? (source as any)?.videoWidth
      ?? (source as any)?.naturalWidth
      ?? (source as any)?.width
      ?? fallback,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  function sourceHeight(source: unknown, fallback = 0): number {
    const raw = Number(
      (source as any)?.displayHeight
      ?? (source as any)?.codedHeight
      ?? (source as any)?.videoHeight
      ?? (source as any)?.naturalHeight
      ?? (source as any)?.height
      ?? fallback,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  function closeLatestFrame(): void {
    if (!latestFrame) return;
    try { latestFrame.close(); } catch { /* */ }
    latestFrame = null;
  }

  function closeLatestBitmap(): void {
    if (!latestBitmap) return;
    try { latestBitmap.close(); } catch { /* */ }
    latestBitmap = null;
  }

  function queueBitmapFallback(frame: VideoFrame): void {
    const makeBitmap = typeof createImageBitmap === 'function' ? createImageBitmap : null;
    if (!makeBitmap) {
      useBitmapFallback = false;
      closeLatestFrame();
      latestFrame = frame;
      zeroCopyDiagMsg = 'createImageBitmap unavailable; using VideoFrame draw';
      return;
    }

    const seq = ++bitmapFallbackSeq;
    const fw = sourceWidth(frame, zeroCopyLastSourceW || 1920);
    const fh = sourceHeight(frame, zeroCopyLastSourceH || 1080);
    zeroCopyDiagMsg = 'converting VideoFrame to ImageBitmap';
    makeBitmap(frame as any)
      .then((bitmap) => {
        if (seq !== bitmapFallbackSeq) {
          try { bitmap.close(); } catch { /* */ }
          return;
        }
        closeLatestBitmap();
        latestBitmap = bitmap;
        zeroCopyLastSourceW = fw;
        zeroCopyLastSourceH = fh;
        zeroCopyDiagMsg = 'bitmap fallback active';
      })
      .catch((err: any) => {
        if (seq === bitmapFallbackSeq) {
          zeroCopyDiagMsg = `bitmap fallback failed: ${err?.message ?? err}`;
        }
      })
      .finally(() => {
        try { frame.close(); } catch { /* */ }
      });
  }

  function receiveZeroCopyFrame(frame: VideoFrame): void {
    zeroCopyLastSourceW = sourceWidth(frame, $settings.output?.masterCanvasWidth || 1920);
    zeroCopyLastSourceH = sourceHeight(frame, $settings.output?.masterCanvasHeight || 1080);
    zeroCopyFramesReceived++;

    if (useBitmapFallback) {
      queueBitmapFallback(frame);
      return;
    }

    closeLatestFrame();
    closeLatestBitmap();
    latestFrame = frame;
    zeroCopyDiagMsg = 'frame received';
  }

  function enableBitmapFallback(reason: string, frame: VideoFrame): void {
    if (!useBitmapFallback) {
      console.warn('[SliceOutput] drawImage(VideoFrame) failed; switching to ImageBitmap fallback:', reason);
    }
    useBitmapFallback = true;
    zeroCopyDiagMsg = `drawImage fallback: ${reason}`;
    if (latestFrame === frame) latestFrame = null;
    queueBitmapFallback(frame);
  }

  function currentZeroCopySource(): CanvasImageSource | null {
    if (useBitmapFallback) return latestBitmap as any;
    return latestFrame as any;
  }

  function clamp01(value: number, fallback = 0): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  function clampPositive(value: number, fallback = 1, min = 0.001, max = 1): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function rotationIndex(rotation: number | undefined): number {
    if (rotation === 90) return 1;
    if (rotation === 180) return 2;
    if (rotation === 270) return 3;
    return 0;
  }

  function fallbackSlice(): OutputSlice {
    return {
      id: sliceId || 'slice-display-full-frame',
      name: 'Full Frame',
      enabled: true,
      targetType: 'display',
      displayId: null,
      spoutName: 'ghostArcade-FullFrame',
      cropX: 0,
      cropY: 0,
      cropW: 1,
      cropH: 1,
      rotation: 0,
      edgeBlendLeft: 0,
      edgeBlendRight: 0,
      edgeBlendTop: 0,
      edgeBlendBottom: 0,
      edgeBlendGamma: 2.2,
      blackLevelR: 0,
      blackLevelG: 0,
      blackLevelB: 0,
      blackLevelFeather: 0.5,
      brightness: 1,
      gamma: 1,
      contrast: 1,
      warpMode: 'rect',
      effects: [],
      stageEffectId: null,
      outputWarp: { enabled: false, mode: 'corners' },
    } as OutputSlice;
  }

  function configureSliceWebGPU(): void {
    if (!sliceGpuContext || !sliceGpuDevice || !sliceGpuFormat) return;
    sliceGpuContext.configure({
      device: sliceGpuDevice,
      format: sliceGpuFormat,
      alphaMode: 'opaque',
      colorSpace: 'srgb',
    });
  }

  async function initSliceWebGPU(): Promise<boolean> {
    if (!zeroCopySliceMode || !presentCanvas || sliceGpuReady) return sliceGpuReady;
    if (sliceGpuFailed) return false;
    try {
      if (!(navigator as any).gpu) throw new Error('navigator.gpu unavailable');
      const shared = await ensureWebGPUDevice();
      sliceGpuDevice = shared.device;
      sliceGpuFormat = shared.presentFormat;
      sliceGpuContext = presentCanvas.getContext('webgpu');
      if (!sliceGpuContext) throw new Error('getContext("webgpu") returned null');
      configureSliceWebGPU();

      const shaderModule = sliceGpuDevice.createShaderModule({ code: SLICE_SHADER_WGSL });
      sliceGpuBindGroupLayout = sliceGpuDevice.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      const layout = sliceGpuDevice.createPipelineLayout({ bindGroupLayouts: [sliceGpuBindGroupLayout] });
      sliceGpuPipeline = sliceGpuDevice.createRenderPipeline({
        layout,
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: sliceGpuFormat }] },
        primitive: { topology: 'triangle-list' },
      });
      sliceGpuSampler = sliceGpuDevice.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });
      sliceGpuUniformStaging = new ArrayBuffer(5 * 16);
      sliceGpuUniformF32 = new Float32Array(sliceGpuUniformStaging);
      sliceGpuUniformBuffer = sliceGpuDevice.createBuffer({
        size: 5 * 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      sliceGpuReady = true;
      zeroCopyDiagMsg = 'webgpu slice renderer ready';
      console.log('[SliceOutput] WebGPU zero-copy slice renderer ready');
      return true;
    } catch (err: any) {
      sliceGpuFailed = true;
      sliceGpuReady = false;
      zeroCopyDiagMsg = `webgpu unavailable: ${err?.message ?? err}`;
      console.warn('[SliceOutput] WebGPU slice renderer unavailable; falling back to Canvas2D:', err?.message ?? err);
      return false;
    }
  }

  function updateSliceGpuUniform(s: OutputSlice): void {
    if (!sliceGpuDevice || !sliceGpuUniformBuffer || !sliceGpuUniformStaging || !sliceGpuUniformF32) return;
    const cropX = clamp01(s.cropX, 0);
    const cropY = clamp01(s.cropY, 0);
    const cropW = Math.min(clampPositive(s.cropW, 1), 1 - cropX);
    const cropH = Math.min(clampPositive(s.cropH, 1), 1 - cropY);
    const defG = s.edgeBlendGamma ?? 2.2;
    sliceGpuUniformF32[0] = cropX;
    sliceGpuUniformF32[1] = cropY;
    sliceGpuUniformF32[2] = Math.max(0.001, cropW);
    sliceGpuUniformF32[3] = Math.max(0.001, cropH);
    sliceGpuUniformF32[4] = Math.max(0, s.brightness ?? 1);
    sliceGpuUniformF32[5] = Math.max(0, s.contrast ?? 1);
    sliceGpuUniformF32[6] = Math.max(0.01, s.gamma ?? 1);
    sliceGpuUniformF32[7] = rotationIndex(s.rotation);
    sliceGpuUniformF32[8] = clamp01(s.edgeBlendLeft ?? 0);
    sliceGpuUniformF32[9] = clamp01(s.edgeBlendRight ?? 0);
    sliceGpuUniformF32[10] = clamp01(s.edgeBlendTop ?? 0);
    sliceGpuUniformF32[11] = clamp01(s.edgeBlendBottom ?? 0);
    sliceGpuUniformF32[12] = Math.max(0.01, s.edgeBlendLeftGamma ?? defG);
    sliceGpuUniformF32[13] = Math.max(0.01, s.edgeBlendRightGamma ?? defG);
    sliceGpuUniformF32[14] = Math.max(0.01, s.edgeBlendTopGamma ?? defG);
    sliceGpuUniformF32[15] = Math.max(0.01, s.edgeBlendBottomGamma ?? defG);
    sliceGpuUniformF32[16] = Math.max(0, s.blackLevelR ?? 0);
    sliceGpuUniformF32[17] = Math.max(0, s.blackLevelG ?? 0);
    sliceGpuUniformF32[18] = Math.max(0, s.blackLevelB ?? 0);
    sliceGpuUniformF32[19] = clamp01(s.blackLevelFeather ?? 0.5, 0.5);
    sliceGpuDevice.queue.writeBuffer(sliceGpuUniformBuffer, 0, sliceGpuUniformStaging);
  }

  function renderZeroCopyWebGPU(frame: VideoFrame, s: OutputSlice): boolean {
    if (!sliceGpuReady || !sliceGpuDevice || !sliceGpuPipeline || !sliceGpuContext || !sliceGpuBindGroupLayout) return false;
    if (!sliceGpuSampler || !sliceGpuUniformBuffer || !presentCanvas) return false;
    try {
      updateSliceGpuUniform(s);
      const externalTexture = sliceGpuDevice.importExternalTexture({ source: frame as any });
      const bindGroup = sliceGpuDevice.createBindGroup({
        layout: sliceGpuBindGroupLayout,
        entries: [
          { binding: 0, resource: sliceGpuSampler },
          { binding: 1, resource: externalTexture },
          { binding: 2, resource: { buffer: sliceGpuUniformBuffer } },
        ],
      });
      const encoder = sliceGpuDevice.createCommandEncoder();
      const view = sliceGpuContext.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(sliceGpuPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6, 1, 0, 0);
      pass.end();
      sliceGpuDevice.queue.submit([encoder.finish()]);
      zeroCopyDiagMsg = 'webgpu frame presented';
      return true;
    } catch (err: any) {
      zeroCopyDiagMsg = `webgpu present failed: ${err?.message ?? err}`;
      console.warn('[SliceOutput] WebGPU zero-copy present failed:', err?.message ?? err);
      return false;
    }
  }

  function attachZeroCopyPort(port: MessagePort): void {
    if (attachedPort && attachedPort !== port) {
      try { attachedPort.close(); } catch { /* */ }
    }
    attachedPort = port;
    port.onmessage = (event: MessageEvent) => {
      const data = event.data;
      // Detect a VideoFrame WITHOUT `instanceof` — Chromium sometimes
      // puts cross-renderer windows in different processes despite
      // same-origin, which makes `instanceof VideoFrame` return false
      // because the constructor identity differs. The frame is still
      // a VideoFrame (it has codedWidth/codedHeight/close); duck-type
      // it so we don't drop and GC-leak it.
      if (looksLikeVideoFrame(data)) {
        receiveZeroCopyFrame(data);
        if (zeroCopyFramesReceived <= 3) {
          console.log(`[SliceOutput] frame ${zeroCopyFramesReceived} received ${(data as any).codedWidth}x${(data as any).codedHeight} ts=${(data as any).timestamp} instanceof=${isSameRealmVideoFrame(data)}`);
        }
      } else if (data && typeof data === 'object') {
        // Control message (transform/cursor); ignored — slice crop comes
        // from settings.output.slices via the BroadcastChannel state-sync.
      }
    };
    port.start();
    zeroCopyDiagMsg = 'port attached';
    console.log('[SliceOutput] MessagePort attached');
  }

  function handlePortIntake(event: MessageEvent): void {
    if (!event?.data || typeof event.data !== 'object') return;
    const t = event.data.type;
    if (t === 'ghostarcade-editor-attach') {
      signalReadyToOpener();
      return;
    }
    if (t !== 'ghostarcade-output-transport-port') return;
    const incoming = event.ports?.[0];
    if (!incoming) return;
    attachZeroCopyPort(incoming);
  }

  function signalReadyToOpener(): void {
    const opener = (window as any).opener as Window | null;
    if (!opener) {
      zeroCopyDiagMsg = 'no window.opener — open via Open on display';
      return;
    }
    try { opener.postMessage({ type: 'ghostarcade-output-ready' }, '*'); }
    catch (err: any) { zeroCopyDiagMsg = `opener.postMessage failed: ${err?.message ?? err}`; }
  }

  // Register the message listener at script-init so we don't race the
  // editor's port post against our onMount lifecycle.
  if (typeof window !== 'undefined' && zeroCopySliceMode) {
    window.addEventListener('message', handlePortIntake);
  }
  // Visible "ESC to close" hint. Shown on mount, fades after 5s.
  // Critical UX safety net: when a user accidentally opens a slice
  // window on their primary monitor (covering the whole desktop) they
  // need an obvious escape hatch. The hint reuses Esc → IPC close.
  let showEscHint = true;

  // Look up the slice's live config every render. The BroadcastChannel
  // state-sync pushes settings into this window's store automatically,
  // so editing the slice in the editor immediately reflects here.
  $: slice = $settings.output.slices.find(s => s.id === sliceId) || null;
  $: waitingForSlice = !slice;

  let _diagFrameCount = 0;
  function presentOneFrame() {
    rafId = requestAnimationFrame(presentOneFrame);
    _diagFrameCount++;
    if (!presentCanvas) return;

    // The window size = display's bounds (set by main.js). The
    // presentation canvas pixel-buffer matches CSS px because we
    // setSize once on resize.
    const w = presentCanvas.width;
    const h = presentCanvas.height;
    if (w <= 0 || h <= 0) return;

    if (zeroCopySliceMode && sliceGpuReady) {
      if (!latestFrame) return;
      renderZeroCopyWebGPU(latestFrame, slice ?? fallbackSlice());
      return;
    }

    if (!presentCtx) {
      // If we can't paint, log loudly so a totally-black slice window
      // doesn't look identical to a "we painted black on purpose" state.
      if (_diagFrameCount % 60 === 0) {
        console.warn('[SliceOutput] presentOneFrame skipped — presentCtx=', !!presentCtx, 'presentCanvas=', !!presentCanvas, 'webgpu=', sliceGpuReady);
      }
      return;
    }

    const zcSource = zeroCopySliceMode ? currentZeroCopySource() : null;

    // Zero-copy path: source pixels come from VideoFrames sent over the
    // MessagePort by the editor's outputSharedTexturePresenter (master
    // warp already baked into each frame by the editor's WGSL shader).
    if (zeroCopySliceMode) {
      if (!zcSource) {
        presentCtx.fillStyle = '#000';
        presentCtx.fillRect(0, 0, w, h);
        return;
      }
    } else {
      // Legacy IPC path: separate-process slice window with its own
      // Canvas.svelte mount. Find the local .main-canvas once and cache.
      if (!mainCanvasEl) {
        mainCanvasEl = document.querySelector('.main-canvas') as HTMLCanvasElement | null;
        if (!mainCanvasEl) {
          presentCtx.fillStyle = '#000';
          presentCtx.fillRect(0, 0, w, h);
          return;
        }
      }
    }

    // Without a slice config (BroadcastChannel hasn't arrived yet or
    // never will), the projector previously went silent black. In
    // zero-copy mode we have a usable frame from the editor — draw it
    // fullscreen uncropped so the projector shows content while the
    // BroadcastChannel catches up.
    if (!slice) {
      if (zeroCopySliceMode && zcSource) {
        try {
          presentCtx.drawImage(zcSource, 0, 0, w, h);
        } catch (err: any) {
          const drawErr = err?.message ?? String(err);
          if (latestFrame && zcSource === (latestFrame as any) && !useBitmapFallback) {
            enableBitmapFallback(drawErr, latestFrame);
          }
        }
        return;
      }
      presentCtx.fillStyle = '#000';
      presentCtx.fillRect(0, 0, w, h);
      presentCtx.fillStyle = '#fa5';
      presentCtx.font = '24px monospace';
      presentCtx.textBaseline = 'top';
      presentCtx.fillText(`NO SLICE CONFIG sliceId=${sliceId}`, 20, 20);
      presentCtx.fillText(`frames=${zeroCopyFramesReceived} slices=${$settings.output?.slices?.length ?? 0}`, 20, 56);
      return;
    }

    // Pick the slice's source canvas:
    //   - Zero-copy mode → editor's .webgpu-present (warp already baked in)
    //   - Legacy mode → local main-canvas + local warp tick (the path that
    //     historically went black when master warp activated)
    let cropSource: CanvasImageSource;
    let mw0: number;
    let mh0: number;
    if (zeroCopySliceMode && zcSource) {
      cropSource = zcSource;
      mw0 = sourceWidth(cropSource, zeroCopyLastSourceW || $settings.output?.masterCanvasWidth || 1920);
      mh0 = sourceHeight(cropSource, zeroCopyLastSourceH || $settings.output?.masterCanvasHeight || 1080);
    } else {
      mw0 = $settings.output?.masterCanvasWidth ?? mainCanvasEl!.width;
      mh0 = $settings.output?.masterCanvasHeight ?? mainCanvasEl!.height;
      cropSource = mainCanvasEl!;
      if (masterWarpIsActive($settings.output?.masterWarp)) {
        startMasterWarpOutput(
          () => $settings.output?.masterWarp,
          () => ({ w: mw0, h: mh0 }),
        );
        tickMasterWarpOutput(mainCanvasEl!);
        const warped = getMasterWarpCanvas();
        if (warped && warped.width > 0) cropSource = warped;
      } else {
        stopMasterWarpOutput();
      }
    }

    // Slice's crop region in source pixel coords.
    const mw = Math.round(sourceWidth(cropSource, mw0));
    const mh = Math.round(sourceHeight(cropSource, mh0));
    const rawSx = Math.round(slice.cropX * mw);
    const rawSy = Math.round(slice.cropY * mh);
    const rawSw = Math.round(slice.cropW * mw);
    const rawSh = Math.round(slice.cropH * mh);
    if (![mw, mh, rawSx, rawSy, rawSw, rawSh].every(Number.isFinite) || mw <= 0 || mh <= 0 || rawSw <= 0 || rawSh <= 0) {
      presentCtx.fillStyle = '#000';
      presentCtx.fillRect(0, 0, w, h);
      presentCtx.fillStyle = '#fa5';
      presentCtx.font = '18px monospace';
      presentCtx.textBaseline = 'top';
      presentCtx.fillText(`INVALID SLICE CROP sliceId=${sliceId}`, 20, 20);
      presentCtx.fillText(`src=${mw}x${mh} crop=${slice.cropX},${slice.cropY} ${slice.cropW}x${slice.cropH}`, 20, 48);
      return;
    }
    const sx = Math.max(0, Math.min(mw - 1, rawSx));
    const sy = Math.max(0, Math.min(mh - 1, rawSy));
    const sw = Math.max(1, Math.min(mw - sx, rawSw));
    const sh = Math.max(1, Math.min(mh - sy, rawSh));

    presentCtx.clearRect(0, 0, w, h);

    // Apply rotation + crop. drawImage from a hardware-accelerated
    // canvas to a 2D canvas is GPU-fast in Chromium; no readback.
    let drewOK = false;
    let drawErr = '';
    try {
      if (slice.rotation === 0) {
        presentCtx.drawImage(cropSource, sx, sy, sw, sh, 0, 0, w, h);
      } else {
        presentCtx.save();
        try {
          presentCtx.translate(w / 2, h / 2);
          presentCtx.rotate((slice.rotation * Math.PI) / 180);
          // For 90/270 the destination's W and H are swapped relative to
          // the rotated content. We rotate around center, then draw
          // centered on (-W/2, -H/2) or (-H/2, -W/2) accordingly.
          if (slice.rotation === 90 || slice.rotation === 270) {
            presentCtx.drawImage(cropSource, sx, sy, sw, sh, -h / 2, -w / 2, h, w);
          } else {
            presentCtx.drawImage(cropSource, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
          }
        } finally {
          presentCtx.restore();
        }
      }
      drewOK = true;
    } catch (err: any) {
      drewOK = false;
      drawErr = err?.message ?? String(err);
      if (latestFrame && cropSource === (latestFrame as any) && !useBitmapFallback) {
        enableBitmapFallback(drawErr, latestFrame);
      }
    }

    // Apply per-slice color correction via canvas filter. Brightness
    // and contrast are GPU-accelerated; gamma is an approximation
    // (CSS filters don't expose a real gamma curve — same caveat as
    // the editor's preview path. For accurate gamma use a sender
    // slice + the blendRenderer shader pipeline.)
    // Color correction is composited via a SECOND drawImage with
    // the filter set; doing it during the first drawImage would clip
    // at edges. For zero-correction (the common case) skip the cost.
    if (drewOK && (slice.brightness !== 1 || slice.contrast !== 1 || slice.gamma !== 1)) {
      const ratio = Math.pow(0.5, slice.gamma) / 0.5;
      const filter = `brightness(${slice.brightness}) contrast(${slice.contrast}) brightness(${ratio.toFixed(3)})`;
      presentCtx.save();
      presentCtx.filter = filter;
      presentCtx.globalCompositeOperation = 'source-over';
      // No source — filter is applied to existing content via a
      // self-blit. Drawing the canvas onto itself with a filter is
      // the canonical post-process trick.
      presentCtx.drawImage(presentCanvas, 0, 0);
      presentCtx.filter = 'none';
      presentCtx.restore();
    }

    // Edge blending — semi-transparent gradient strips. Same formula
    // as the sender-export 2D fallback. Per-edge gamma supported.
    const hasBlend = slice.edgeBlendLeft > 0 || slice.edgeBlendRight > 0
      || slice.edgeBlendTop > 0 || slice.edgeBlendBottom > 0;
    if (drewOK && hasBlend) {
      applyEdgeBlending(presentCtx, w, h, {
        edgeBlendLeft: slice.edgeBlendLeft,
        edgeBlendRight: slice.edgeBlendRight,
        edgeBlendTop: slice.edgeBlendTop,
        edgeBlendBottom: slice.edgeBlendBottom,
        edgeBlendGamma:
          (((slice.edgeBlendLeftGamma ?? slice.edgeBlendGamma)
            + (slice.edgeBlendRightGamma ?? slice.edgeBlendGamma)
            + (slice.edgeBlendTopGamma ?? slice.edgeBlendGamma)
            + (slice.edgeBlendBottomGamma ?? slice.edgeBlendGamma)) / 4),
      });
    }

  }

  function resizePresentCanvas() {
    if (!presentCanvas) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (presentCanvas.width !== w || presentCanvas.height !== h) {
      presentCanvas.width = w;
      presentCanvas.height = h;
      if (sliceGpuReady) configureSliceWebGPU();
    }
  }

  // Svelte 5's onMount typing rejects an async function whose Promise
  // resolves to a cleanup — the cleanup must be returned synchronously.
  // Setup work that doesn't block the cleanup (license init, the tick()
  // before grabbing the present-canvas context) runs in an inner IIFE
  // so we can return the cleanup right away.
  onMount(() => {
    console.log('[SliceOutput] slice window mounted, sliceId=', sliceId);

    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    initLicense().catch(e => console.warn('[SliceOutput] License init:', e));
    initStateBroadcast('receiver');

    void (async () => {
      // Wait one tick so Canvas (mounted below) has appended its
      // .main-canvas to the DOM before the first frame query.
      await tick();
      if (presentCanvas) {
        resizePresentCanvas();
        if (zeroCopySliceMode && await initSliceWebGPU()) {
          presentCtx = null;
        } else {
          presentCtx = presentCanvas.getContext('2d');
        }
      }
    })();

    const onResize = () => resizePresentCanvas();
    window.addEventListener('resize', onResize);

    const onDblClick = () => {
      invoke('output_toggle_fullscreen').catch(() => {});
    };
    window.addEventListener('dblclick', onDblClick);

    // Escape-to-close. The slice window is opened borderless +
    // fullscreen on a physical display; if the operator misclicks
    // and routes it to their primary monitor they need a reliable
    // way out without quitting the whole app. Esc closes THIS slice
    // window via the same IPC the Screens panel uses.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        invoke('output_close_slice_window', { sliceId }).catch(() => {
          // Fallback: if IPC fails (preload not exposing the channel
          // yet), close the renderer window itself.
          window.close();
        });
      }
    };
    window.addEventListener('keydown', onKey);

    rafId = requestAnimationFrame(presentOneFrame);

    // Zero-copy mode: signal the editor we're ready to receive frames.
    // The editor's attachOutputWindow probe may have already fired before
    // this point; handlePortIntake responds with another ready when it
    // does. Either way we get a port.
    if (zeroCopySliceMode) signalReadyToOpener();

    const hintTimer = setTimeout(() => { showEscHint = false; }, 5000);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keydown', onKey);
      clearTimeout(hintTimer);
    };
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    disposeMasterWarpOutput();
    destroyStateBroadcast();
    if (zeroCopySliceMode) {
      window.removeEventListener('message', handlePortIntake);
      if (attachedPort) { try { attachedPort.close(); } catch { /* */ } attachedPort = null; }
      closeLatestFrame();
      closeLatestBitmap();
      // Tell the editor to detach us so its pump stops fan-out to a dead port.
      try { (window as any).opener?.postMessage({ type: 'ghostarcade-output-bye' }, '*'); } catch { /* */ }
    }
  });
</script>

<div class="slice-output">
  {#if waitingForSlice}
    <!-- The slice config takes one BroadcastChannel round-trip to
         arrive from the editor. Show a discrete placeholder so the
         operator knows the window is alive, not frozen. -->
    <div class="slice-waiting">
      Waiting for slice <code>{sliceId}</code> from editor…
    </div>
  {/if}
  {#if showEscHint}
    <!-- 5-second close-hint so the operator always knows the way
         out, even when this slice window lands on their primary
         monitor and covers everything else. -->
    <div class="esc-hint">Press <kbd>Esc</kbd> to close</div>
  {/if}
  <!-- Canvas is mounted but visually hidden — it still runs the
       state-synced render loop, just behind the presentation canvas.
       Set to a fixed 1920×1080 box so it doesn't fight the window
       size; the presentation canvas does the actual crop scaling.
       Skipped entirely in zeroCopySliceMode — we read the editor's
       already-warped .webgpu-present canvas via window.opener instead
       of running our own Three.js scene + warp pipeline. -->
  {#if !zeroCopySliceMode}
    <div class="hidden-canvas">
      <Canvas />
    </div>
  {/if}
  <canvas class="slice-present" bind:this={presentCanvas}></canvas>
</div>

<style>
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #000;
    width: 100vw;
    height: 100vh;
    cursor: none;
  }
  :global(#app) {
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  .slice-output {
    position: fixed;
    inset: 0;
    background: #000;
    overflow: hidden;
  }
  /* The actual rendering canvas is hidden — its pixels are read by
     the presentation canvas every frame via drawImage AND, when the
     master warp is on, as a Three.js CanvasTexture for the warp pass.
     CRITICAL: do NOT use `visibility: hidden` (or `display: none`).
     Chromium stops compositing a canvas under visibility:hidden, and
     uploading it as a WebGL texture returns BLACK frames — which is
     exactly what made the per-display slice window go black when the
     master warp activated. Off-screen positioning + 0.01 opacity
     keeps the canvas in the compositor while remaining invisible. */
  .hidden-canvas {
    position: absolute;
    left: -10000px;
    top: 0;
    width: 1920px;
    height: 1080px;
    opacity: 0.01;
    pointer-events: none;
  }
  .hidden-canvas :global(.canvas-wrapper) {
    background: #000 !important;
    align-items: stretch !important;
    justify-content: stretch !important;
    width: 1920px !important;
    height: 1080px !important;
  }
  .hidden-canvas :global(.canvas-container) {
    max-width: none !important;
    max-height: none !important;
    width: 1920px !important;
    height: 1080px !important;
    aspect-ratio: unset !important;
  }
  .slice-present {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: block;
    background: #000;
    z-index: 1;
  }
  .slice-waiting {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #888);
    font: 14px/1.4 ui-monospace, monospace;
    z-index: 100;
    pointer-events: none;
  }
  .slice-waiting code {
    color: #5fa8ff;
    padding: 0 4px;
  }
  .esc-hint {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 101;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font: 12px/1.3 ui-monospace, monospace;
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    pointer-events: none;
    animation: esc-fade 5s ease-out forwards;
  }
  .esc-hint kbd {
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 3px;
    padding: 1px 6px;
    margin: 0 2px;
    font-family: inherit;
    font-size: 13px;
  }
  @keyframes esc-fade {
    0% { opacity: 0; transform: translateY(-4px); }
    8% { opacity: 1; transform: translateY(0); }
    80% { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
