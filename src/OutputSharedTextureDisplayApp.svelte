<script lang="ts">
  /**
   * OutputSharedTextureDisplayApp — receiver for the WebGPU zero-copy
   * output transport. Counterpart to outputSharedTexturePresenter.ts.
   *
   * Mounted by main.ts when the output window loads with
   * `?mode=webgpu-display`. Responsibilities:
   *
   *   1. Initialise WebGPU (device, canvas configuration, render pipeline).
   *   2. Receive the cross-process MessagePort that main.js paired with
   *      the editor renderer (forwarded by preload.cjs as a tagged
   *      window.postMessage).
   *   3. For each VideoFrame received on the port:
   *      a. Build a GPUExternalTexture wrapping it.
   *      b. Execute a fullscreen-quad render pass that samples the
   *         external texture with the current transform uniforms
   *         (rotation, brightness, contrast, gamma, fit policy).
   *      c. videoFrame.close() to release the GPU buffer back to
   *         Chromium's pool.
   *   4. Apply transform deltas received as control messages on the
   *      same port (same channel, discriminated by message type).
   *
   * Per-frame critical path:
   *   port.onmessage → importExternalTexture → write uniforms →
   *     drawIndexed(6) → submit → frame.close()
   * Total: ~0.3-0.8ms on a discrete GPU at 4K. The bulk of the wall
   * clock is the captureStream → MediaStreamTrackProcessor pipeline
   * on the editor side, which paces to vsync.
   *
   * No state-sync, no decoders, no Three.js. Single-renderer
   * architecture: the editor is the only source of pixels.
   *
   * Failure / fallback:
   *   - WebGPU adapter unavailable → renders a "WebGPU required" status
   *     overlay instead of attempting the legacy `<video>` path. The
   *     legacy WebRTC display app still exists at `?mode=webrtc-display`;
   *     if a user lands here without WebGPU it's a misconfiguration on
   *     the main.js mode-selection side.
   *   - MessagePort never arrives → renders "Waiting for editor link"
   *     status. Heartbeat NOT sent because the port is created by main
   *     in response to the open call, not on receiver demand.
   *   - GPU-backed format check (NV12/I420 vs BGRA) drives a small
   *     warning chip in the corner — operator can spot driver-level
   *     CPU fallbacks at a glance from across the room.
   *
   * `?stats=1` URL flag enables a more verbose diagnostics overlay.
   * Toggleable at runtime by pressing `S`.
   */
  import { onMount, onDestroy } from 'svelte';

  const urlParams = new URLSearchParams(window.location.search);
  let showStats = urlParams.get('stats') === '1';

  let canvasEl: HTMLCanvasElement;
  let disposed = false;

  // ── State ────────────────────────────────────────────────────────
  let initStatus: 'init' | 'no-webgpu' | 'no-port' | 'running' | 'error' = 'init';
  let initError = '';
  let connectedFrames = 0;
  let healthFps = 0;             // EMA of presented-frame rate
  let healthLastFrameAt = 0;     // for fps EMA
  let lastFormat = '';
  let formatHistogram: Record<string, number> = {};
  let cpuFallback = false;       // true when format is BGRA-class for >5 consecutive frames
  let cpuFallbackStreak = 0;
  let lastCanvasW = 0;
  let lastCanvasH = 0;
  let lastFrameDim = '';
  let renderTimeUsEMA = 0;       // GPU submit latency (rough)

  // Debug counters — distinguish "port.onmessage never fires" (raw=0)
  // from "fires but data isn't a VideoFrame" (raw>0, frames=0). Visible
  // in stats overlay so we don't need DevTools to triage cross-process
  // transfer issues.
  let rawMessagesReceived = 0;
  let nonVideoFrameMessages = 0;
  let lastMessageTypeName = '';

  // ── Transform state — populated from control messages ────────────
  // Defaults match the legacy renderer's "no transform" identity so
  // the first frame is shown correctly even before the editor sends
  // its first transform snapshot.
  let rotationDeg = 0;
  let brightness = 1;
  let contrast = 1;
  let gamma = 1;
  let fit: 'contain' | 'cover' | 'fill' = 'cover';

  // Output cursor — driven by 'cursor' (position/visibility) and
  // 'cursorStyle' (visual config) messages from the editor renderer.
  // Rendered as a CSS overlay on top of the WebGPU canvas (cheaper +
  // simpler than baking it into the WGSL shader, and the styling
  // surface is much richer with CSS).
  let cursorVisible = false;
  let cursorX = 0.5;            // 0..1 normalized canvas coords
  let cursorY = 0.5;
  let cursorStyle: 'crosshair' | 'circle' | 'dot' | 'reticle' | 'fullscreen' = 'crosshair';
  let cursorSizePx = 28;
  let cursorThicknessPx = 2;
  let cursorColor = '#ffffff';
  let cursorOpacity = 0.85;

  // ── WebGPU resources ─────────────────────────────────────────────
  let gpu: any = null;
  let adapter: any = null;
  let device: any = null;
  let canvasContext: any = null;
  let preferredFormat: any = null;
  let pipeline: any = null;
  let sampler: any = null;
  let uniformBuffer: any = null;
  // Bind group is built per-frame because GPUExternalTexture is single-
  // use (its underlying GpuMemoryBuffer is recycled by Chromium each
  // frame). Cheap to create — no GPU allocations on the hot path.
  let bindGroupLayout: any = null;

  // 5 floats packed at 16-byte alignment (WebGPU std140-ish):
  //   uTransform.xy = rotation cos/sin
  //   uTransform.zw = scale x/y for fit policy
  //   uColor.x      = brightness
  //   uColor.y      = contrast
  //   uColor.z      = gamma
  //   uColor.w      = pad
  // Update each frame; uniform buffer stays the same size.
  const UNIFORM_BYTES = 32;

  // ── Shader: fullscreen quad with transform + color correction ───
  // Vertex stage emits a clip-space triangle fan covering [-1, 1]² and
  // forwards the corresponding [0, 1]² UVs to the fragment stage.
  // Fragment stage:
  //   1. Apply rotation around UV center (0.5, 0.5).
  //   2. Apply scale for fit policy (cover/contain/fill computed CPU
  //      side based on canvas vs video dimensions).
  //   3. Sample the external texture (no manual YUV conversion needed
  //      — Chromium handles it inside textureSampleBaseClampToEdge).
  //   4. Apply brightness and contrast as classical operations.
  //   5. Apply gamma as pow(rgb, 1/gamma). Operates in linear space
  //      because importExternalTexture returns linear values for
  //      most YUV inputs (the de-gamma is implicit in the BT.709 →
  //      RGB conversion that Chromium performs).
  //   6. Discard fragments whose adjusted UV is outside [0, 1] —
  //      fits with letterbox/pillarbox style on `contain`.
  const SHADER_WGSL = /* wgsl */ `
struct Uniforms {
  // xy = (cos, sin); zw = (scaleX, scaleY).
  transform: vec4<f32>,
  // x = brightness, y = contrast, z = gamma, w = pad.
  color: vec4<f32>,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_external;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// Two triangles via vertex_index. No vertex buffer needed.
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  // Triangle strip / list of positions for a fullscreen quad.
  // Indices 0..5 → two triangles covering the viewport.
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

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let cosA = uniforms.transform.x;
  let sinA = uniforms.transform.y;
  let scale = uniforms.transform.zw;

  // Map UV into centered [-0.5, 0.5] then rotate then scale then
  // shift back. Scale > 1 means "video is bigger than canvas in this
  // axis" → we sample a sub-rect (fit:cover); scale < 1 means the
  // opposite (fit:contain), which means parts of the destination
  // map outside [0,1] → discard those for letterbox bars.
  var centered = in.uv - vec2<f32>(0.5, 0.5);
  let rotated = vec2<f32>(
    centered.x * cosA - centered.y * sinA,
    centered.x * sinA + centered.y * cosA,
  );
  let scaled = rotated * scale + vec2<f32>(0.5, 0.5);

  if (scaled.x < 0.0 || scaled.x > 1.0 || scaled.y < 0.0 || scaled.y > 1.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  var rgba = textureSampleBaseClampToEdge(uTexture, uSampler, scaled);

  // Brightness: linear scale on RGB.
  rgba.r = rgba.r * uniforms.color.x;
  rgba.g = rgba.g * uniforms.color.x;
  rgba.b = rgba.b * uniforms.color.x;

  // Contrast: pivot around 0.5 grey.
  rgba.r = (rgba.r - 0.5) * uniforms.color.y + 0.5;
  rgba.g = (rgba.g - 0.5) * uniforms.color.y + 0.5;
  rgba.b = (rgba.b - 0.5) * uniforms.color.y + 0.5;

  // Gamma: per-channel pow with safety clamp to avoid pow(neg).
  let invGamma = 1.0 / max(uniforms.color.z, 0.0001);
  rgba.r = pow(max(rgba.r, 0.0), invGamma);
  rgba.g = pow(max(rgba.g, 0.0), invGamma);
  rgba.b = pow(max(rgba.b, 0.0), invGamma);

  rgba.a = 1.0;
  return rgba;
}
`;

  // ── Lifecycle ────────────────────────────────────────────────────
  async function initWebGPU(): Promise<void> {
    gpu = (navigator as any).gpu;
    if (!gpu) {
      initStatus = 'no-webgpu';
      initError = 'navigator.gpu unavailable in this Electron build';
      console.error('[OutputSharedTexture] ' + initError);
      return;
    }
    try {
      adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        initStatus = 'no-webgpu';
        initError = 'requestAdapter returned null (no compatible GPU)';
        console.error('[OutputSharedTexture] ' + initError);
        return;
      }
      device = await adapter.requestDevice();
      device.lost.then((info: any) => {
        console.error('[OutputSharedTexture] device lost:', info?.message || info);
        if (!disposed) {
          initStatus = 'error';
          initError = `Device lost: ${info?.message || 'unknown'}`;
        }
      });
      canvasContext = canvasEl.getContext('webgpu');
      if (!canvasContext) {
        initStatus = 'no-webgpu';
        initError = 'getContext("webgpu") returned null';
        return;
      }
      preferredFormat = gpu.getPreferredCanvasFormat();
      // alphaMode 'opaque' avoids a pointless premultiplied composite
      // for a fullscreen output where there's no overlay below us.
      canvasContext.configure({
        device,
        format: preferredFormat,
        alphaMode: 'opaque',
        // Output pixels go straight to the projector — no need for the
        // normal sRGB conversion the canvas would apply for a webpage.
        // We do gamma in the shader.
        colorSpace: 'srgb',
      });

      const shaderModule = device.createShaderModule({ code: SHADER_WGSL });
      bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [{ format: preferredFormat }],
        },
        primitive: { topology: 'triangle-list' },
      });

      sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      uniformBuffer = device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // Initial uniforms = identity transform until the first frame
      // arrives (which will recompute scale based on actual frame
      // dimensions).
      writeUniforms(0, 1, 1);

      initStatus = 'no-port';
      console.log('[OutputSharedTexture] WebGPU initialised. Adapter:',
        (adapter as any).info?.description || 'unknown',
        'Preferred format:', preferredFormat);
    } catch (err: any) {
      initStatus = 'error';
      initError = `WebGPU init failed: ${err?.message || err}`;
      console.error('[OutputSharedTexture] ' + initError, err);
    }
  }

  function writeUniforms(rotationRad: number, scaleX: number, scaleY: number): void {
    if (!device || !uniformBuffer) return;
    const data = new Float32Array(UNIFORM_BYTES / 4);
    data[0] = Math.cos(rotationRad);
    data[1] = Math.sin(rotationRad);
    data[2] = scaleX;
    data[3] = scaleY;
    data[4] = brightness;
    data[5] = contrast;
    data[6] = gamma;
    data[7] = 0;
    device.queue.writeBuffer(uniformBuffer, 0, data.buffer);
  }

  function computeFitScale(canvasW: number, canvasH: number, frameW: number, frameH: number): { x: number; y: number } {
    // Returns the scale factors applied to the centered UV in the
    // shader. >1 in an axis means we sample only the central portion
    // of the source texture (cropping); <1 means we map the source
    // into a smaller portion of the canvas (with the rest filled
    // black via the discard).
    if (!frameW || !frameH || !canvasW || !canvasH) return { x: 1, y: 1 };
    const canvasAspect = canvasW / canvasH;
    const frameAspect = frameW / frameH;
    if (fit === 'fill') return { x: 1, y: 1 };
    if (fit === 'cover') {
      // Crop the dimension that's "too big" relative to the canvas.
      if (frameAspect > canvasAspect) {
        // Source is wider — crop horizontally.
        return { x: canvasAspect / frameAspect, y: 1 };
      } else {
        return { x: 1, y: frameAspect / canvasAspect };
      }
    }
    // contain — letterbox. The dimension that's "too small" gets
    // shrunk; black bars fill the rest. Inverse of cover.
    if (frameAspect > canvasAspect) {
      return { x: 1, y: frameAspect / canvasAspect };
    } else {
      return { x: canvasAspect / frameAspect, y: 1 };
    }
  }

  function presentFrame(videoFrame: VideoFrame): void {
    // Ensure the canvas backing store matches the window size at DPR.
    const dpr = window.devicePixelRatio || 1;
    const wantW = Math.round(window.innerWidth * dpr);
    const wantH = Math.round(window.innerHeight * dpr);
    if (canvasEl.width !== wantW || canvasEl.height !== wantH) {
      canvasEl.width = wantW;
      canvasEl.height = wantH;
      lastCanvasW = wantW;
      lastCanvasH = wantH;
    }

    const fw = videoFrame.codedWidth;
    const fh = videoFrame.codedHeight;
    lastFrameDim = `${fw}x${fh}`;
    const scale = computeFitScale(canvasEl.width, canvasEl.height, fw, fh);
    writeUniforms((rotationDeg * Math.PI) / 180, scale.x, scale.y);

    const externalTexture = device.importExternalTexture({ source: videoFrame });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: externalTexture },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const t0 = performance.now();
    const encoder = device.createCommandEncoder();
    const view = canvasContext.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, 1, 0, 0);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const t1 = performance.now();
    const us = (t1 - t0) * 1000;
    renderTimeUsEMA = renderTimeUsEMA === 0 ? us : renderTimeUsEMA * 0.9 + us * 0.1;
  }

  function recordFrameStats(videoFrame: VideoFrame): void {
    connectedFrames++;
    const fmt = (videoFrame.format as string) || 'unknown';
    lastFormat = fmt;
    formatHistogram = { ...formatHistogram, [fmt]: (formatHistogram[fmt] ?? 0) + 1 };
    // BGRA is NOT a reliable CPU-fallback indicator. The format field
    // describes texel layout, not memory location — Chromium's canvas
    // captureStream often produces BGRA-formatted VideoFrames that
    // remain GPU-resident (the underlying GpuMemoryBuffer is in VRAM).
    // importExternalTexture accepts any GPU-backed VideoFrame
    // regardless of format. The reliable signal is render-time:
    // GPU-backed import + draw stays under ~1ms; CPU fallback drives
    // it past several ms.
    //
    // Threshold: presentFrame's renderTimeUsEMA exceeding 4ms (= 4000μs)
    // for >5 consecutive frames marks the link as degraded. This catches
    // both true CPU readback AND any future Chromium quirk that turns
    // importExternalTexture into a per-frame copy.
    if (renderTimeUsEMA > 4000) {
      cpuFallbackStreak++;
      if (cpuFallbackStreak >= 5 && !cpuFallback) {
        cpuFallback = true;
        console.warn('[OutputSharedTexture] degraded path detected: render-time EMA = ' +
          renderTimeUsEMA.toFixed(0) + 'μs (format=' + fmt + ')');
      }
    } else if (renderTimeUsEMA > 0 && renderTimeUsEMA < 2000) {
      cpuFallbackStreak = 0;
      if (cpuFallback) {
        cpuFallback = false;
        console.log('[OutputSharedTexture] render-time recovered to ' +
          renderTimeUsEMA.toFixed(0) + 'μs (format=' + fmt + ')');
      }
    }
    const now = performance.now();
    if (healthLastFrameAt > 0) {
      const dt = now - healthLastFrameAt;
      const inst = 1000 / Math.max(1, dt);
      healthFps = healthFps === 0 ? inst : healthFps * 0.9 + inst * 0.1;
    }
    healthLastFrameAt = now;
  }

  function handleControlMessage(msg: any): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'transform') {
      if (typeof msg.rotation === 'number') rotationDeg = msg.rotation;
      if (typeof msg.brightness === 'number') brightness = msg.brightness;
      if (typeof msg.contrast === 'number') contrast = msg.contrast;
      if (typeof msg.gamma === 'number') gamma = msg.gamma;
      if (msg.fit === 'contain' || msg.fit === 'cover' || msg.fit === 'fill') fit = msg.fit;
      return;
    }
    if (msg.type === 'cursor') {
      if (typeof msg.x === 'number') cursorX = msg.x;
      if (typeof msg.y === 'number') cursorY = msg.y;
      cursorVisible = !!msg.visible;
      return;
    }
    if (msg.type === 'cursorStyle') {
      if (msg.style === 'crosshair' || msg.style === 'circle' || msg.style === 'dot' ||
          msg.style === 'reticle' || msg.style === 'fullscreen') {
        cursorStyle = msg.style;
      }
      if (typeof msg.sizePx === 'number')      cursorSizePx = Math.max(2, Math.min(256, msg.sizePx));
      if (typeof msg.thicknessPx === 'number') cursorThicknessPx = Math.max(1, Math.min(20, msg.thicknessPx));
      if (typeof msg.color === 'string')       cursorColor = msg.color;
      if (typeof msg.opacity === 'number')     cursorOpacity = Math.max(0, Math.min(1, msg.opacity));
      return;
    }
  }

  // ── Port intake (same-renderer-process MessageChannel handshake) ──
  // The output window is opened via window.open() from the editor,
  // putting both windows in the same renderer process. The editor
  // creates a local `new MessageChannel()` and posts port2 to us via
  // `targetWindow.postMessage(..., [port2])` — same-process transfer,
  // GpuMemoryBuffer-backed VideoFrames preserve their handles.
  //
  // Handshake protocol:
  //   1. We register a window 'message' listener at top-of-script
  //      (before any onMount race could lose a message).
  //   2. On mount, after WebGPU initialises, we post 'output-ready'
  //      to window.opener — telling the editor we're ready to bind
  //      a port.
  //   3. We may ALSO receive an 'editor-attach' probe from the editor
  //      (sent on attachOutputWindow) — we respond by re-posting
  //      'output-ready' so the editor knows we're alive.
  //   4. The editor posts the MessageChannel port to us; we attach
  //      it and start receiving frames.
  //
  // The port may arrive BEFORE WebGPU finishes initialising (output
  // is fast to mount, WebGPU adapter probe takes a beat). In that
  // case we buffer the port into `pendingPort` and attach it once
  // initWebGPU completes via tryAttachPendingPort().
  let pendingPort: MessagePort | null = null;
  let attachedPort: MessagePort | null = null;

  function attachPort(port: MessagePort): void {
    if (attachedPort && attachedPort !== port) {
      try { attachedPort.close(); } catch { /* */ }
    }
    attachedPort = port;
    if (initStatus === 'no-port' || initStatus === 'init') initStatus = 'running';
    port.onmessage = (event: MessageEvent) => {
      if (disposed) return;
      rawMessagesReceived++;
      const data = event.data;
      lastMessageTypeName = (data === null || data === undefined)
        ? String(data)
        : (data?.constructor?.name || typeof data);
      if (rawMessagesReceived <= 3) {
        console.log('[OutputSharedTexture] raw message #' + rawMessagesReceived,
          'type=' + lastMessageTypeName,
          'isVideoFrame=' + (data instanceof VideoFrame),
          'data=', data);
      }
      // Discriminate frames vs control messages. VideoFrame is an
      // instance check; control messages are plain objects with
      // `type` field.
      if (data instanceof VideoFrame) {
        try {
          recordFrameStats(data);
          if (pipeline && device && canvasContext) {
            presentFrame(data);
          }
        } catch (err) {
          console.error('[OutputSharedTexture] presentFrame error:', err);
        } finally {
          // ALWAYS close the frame to release the underlying
          // GpuMemoryBuffer back to Chromium's pool. Forgetting this
          // exhausts the pool within ~50 frames and stalls the editor's
          // captureStream.
          try { data.close(); } catch { /* */ }
        }
      } else {
        nonVideoFrameMessages++;
        handleControlMessage(data);
      }
    };
    port.start();
    console.log('[OutputSharedTexture] MessagePort attached, awaiting frames. port=', port);
  }

  function tryAttachPendingPort(): void {
    if (!pendingPort) return;
    if (!device || !pipeline || !canvasContext) return;
    const p = pendingPort;
    pendingPort = null;
    attachPort(p);
  }

  function handlePortIntake(event: MessageEvent): void {
    if (!event?.data || typeof event.data !== 'object') return;
    const t = event.data.type;
    if (t === 'ghostarcade-editor-attach') {
      // Editor probed us. If we're past initWebGPU we can already
      // signal ready; otherwise the post-init readyHandshake will
      // do it. Either way the editor will follow up with the port.
      if (device && pipeline && canvasContext) {
        signalReadyToOpener();
      }
      return;
    }
    if (t !== 'ghostarcade-output-transport-port') return;
    const incoming = event.ports?.[0];
    if (!incoming) return;
    if (device && pipeline && canvasContext) {
      // WebGPU is already initialised — attach immediately.
      attachPort(incoming);
    } else {
      // Buffer until initWebGPU completes.
      console.log('[OutputSharedTexture] port received before WebGPU init — buffering');
      pendingPort = incoming;
    }
  }

  function signalReadyToOpener(): void {
    // window.opener is the editor renderer's Window proxy when this
    // window was created via window.open() from there. If opener is
    // null (output was loaded directly via URL or main.js), we have
    // no editor to talk to and the user will see "no link" badge.
    const opener = (window as any).opener as Window | null;
    if (!opener) {
      console.warn('[OutputSharedTexture] window.opener is null — no editor to signal. ' +
        'Was this window opened via window.open() from the editor renderer?');
      return;
    }
    try {
      opener.postMessage({ type: 'ghostarcade-output-ready' }, '*');
      console.log('[OutputSharedTexture] signalled output-ready to opener');
    } catch (err) {
      console.error('[OutputSharedTexture] postMessage to opener failed:', err);
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 's' || e.key === 'S') {
      showStats = !showStats;
    }
  }

  // Register the port intake listener IMMEDIATELY (top-level script
  // execution = before any onMount). This is what closes the race
  // with preload's window.postMessage.
  if (typeof window !== 'undefined') {
    window.addEventListener('message', handlePortIntake);
  }

  onMount(async () => {
    // Splash hide
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    window.addEventListener('keydown', handleKeydown);

    await initWebGPU();

    // WebGPU is now ready. Tell the editor we can receive frames.
    // If the editor's attachOutputWindow already fired its
    // 'editor-attach' probe before we got here, our listener handled
    // it but couldn't respond yet (device wasn't ready); now we
    // explicitly signal ready. The editor responds by posting the
    // MessageChannel port.
    signalReadyToOpener();

    // If a port arrived between top-level listener registration and
    // initWebGPU finishing, it was buffered into `pendingPort`. Try
    // to attach now that the pipeline is ready.
    tryAttachPendingPort();
  });

  onDestroy(() => {
    disposed = true;
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('message', handlePortIntake);
    if (attachedPort) {
      try { attachedPort.close(); } catch { /* */ }
      attachedPort = null;
    }
    // Tell the editor we're going away so it can tear down its pump
    // without waiting for the next postMessage to fail.
    try {
      const opener = (window as any).opener as Window | null;
      if (opener) {
        opener.postMessage({ type: 'ghostarcade-output-bye' }, '*');
      }
    } catch { /* */ }
    try { device?.destroy?.(); } catch { /* */ }
  });

  // Reactive labels for the overlays
  $: statusText = (() => {
    if (initStatus === 'init') return 'Initialising WebGPU…';
    if (initStatus === 'no-webgpu') return `WebGPU required: ${initError}`;
    if (initStatus === 'no-port') return 'Waiting for editor link…';
    if (initStatus === 'error') return `Error: ${initError}`;
    return '';
  })();
  $: badgeColor = (() => {
    if (initStatus !== 'running') return '#444';
    if (cpuFallback) return '#ff3d00';
    if (healthFps < 30) return '#ff3d00';
    if (healthFps < 50) return '#ffb300';
    return 'rgba(0, 0, 0, 0)';   // invisible when healthy
  })();
  // Pre-v0.6.3 this also fired when `healthFps < 50`, but users
  // running output at lower configured framerates (Settings →
  // Performance) saw it permanently — distracting and non-actionable.
  // Keep the badge for genuine fault states only: init failure or
  // CPU fallback. Press-S stats overlay covers diagnostic need.
  $: badgeShow = initStatus !== 'running' || cpuFallback;
  $: badgeText = (() => {
    if (initStatus !== 'running') return '●  no link';
    if (cpuFallback) return `●  CPU fallback (${lastFormat})`;
    return '';
  })();
</script>

<canvas bind:this={canvasEl} class="output-canvas"></canvas>

<!-- Output cursor overlay. Rendered as DOM (not in WGSL) because:
     CSS gives us thickness in subpixel-precise integer px independent
     of canvas resolution, opacity is free, and the user can swap
     style without touching shaders. Sits ABOVE the canvas via
     z-index; pointer-events: none so it never intercepts clicks. -->
{#if cursorVisible}
  {#if cursorStyle === 'fullscreen'}
    <!-- Fullscreen lines span the entire viewport at the cursor's
         row/column. Useful for alignment work where you need to know
         exactly which pixel column/row your cursor is on. -->
    <span class="fs-line fs-h"
          style="top: {cursorY * 100}%; height: {cursorThicknessPx}px;
                 background: {cursorColor}; opacity: {cursorOpacity};"></span>
    <span class="fs-line fs-v"
          style="left: {cursorX * 100}%; width: {cursorThicknessPx}px;
                 background: {cursorColor}; opacity: {cursorOpacity};"></span>
  {:else}
    <div
      class="output-cursor cursor-{cursorStyle}"
      style="
        left: {cursorX * 100}%;
        top: {cursorY * 100}%;
        --csz: {cursorSizePx}px;
        --cth: {cursorThicknessPx}px;
        --ccol: {cursorColor};
        --copa: {cursorOpacity};
      "
    >
      {#if cursorStyle === 'crosshair' || cursorStyle === 'reticle'}
        <span class="seg seg-h"></span>
        <span class="seg seg-v"></span>
      {/if}
      {#if cursorStyle === 'circle' || cursorStyle === 'reticle'}
        <span class="ring"></span>
      {/if}
      {#if cursorStyle === 'dot'}
        <span class="dot"></span>
      {/if}
    </div>
  {/if}
{/if}

<!-- All on-screen status badges removed (status overlay + health
     badge). The output window must stay completely clean for
     projection — even fault states (init failure, CPU fallback)
     no longer paint a pill on top of the projection. Diagnostic
     stats remain available via the opt-in `?stats=1` URL flag or
     pressing `S` on the focused output window. -->

{#if showStats}
  <pre class="stats-overlay">
mode webgpu-display
status {initStatus}
frames {connectedFrames}  fps {healthFps.toFixed(1)}
raw-msgs {rawMessagesReceived}  non-vf {nonVideoFrameMessages}
last-type {lastMessageTypeName}
format {lastFormat}  cpu-fallback {cpuFallback}
canvas {lastCanvasW}x{lastCanvasH}  frame {lastFrameDim}
fit {fit}  rotation {rotationDeg}°
brightness {brightness.toFixed(2)}  contrast {contrast.toFixed(2)}  gamma {gamma.toFixed(2)}
gpu-submit {(renderTimeUsEMA).toFixed(1)}μs (EMA)
adapter {adapter?.info?.description || 'unknown'}
press S to hide</pre>
{/if}

<style>
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    background: #000;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
  }
  .output-canvas {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: #000;
    display: block;
  }
  .stats-overlay {
    position: fixed;
    top: 8px;
    right: 8px;
    color: #0f0;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
    background: rgba(0, 0, 0, 0.7);
    padding: 6px 10px;
    border-radius: 4px;
    pointer-events: none;
    margin: 0;
    white-space: pre;
  }

  /* ── Output cursor overlays ──────────────────────────────────────
     Sized via CSS custom properties set inline so the JS layer can
     drive them per-frame without re-templating. The cursor sits at
     `left: cursorX * 100%; top: cursorY * 100%` and translates by
     -50% to center on that point. */
  .output-cursor {
    position: fixed;
    pointer-events: none;
    z-index: 50;
    width: var(--csz);
    height: var(--csz);
    transform: translate(-50%, -50%);
    opacity: var(--copa);
    color: var(--ccol);
    /* Soft outline for visibility against any background — pure
       coloured cursors disappear into matching content colours. */
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.7));
  }

  /* Crosshair / reticle: + shape made of two segments crossing the
     center, with a small gap left clear so a focal target is visible. */
  .seg {
    position: absolute;
    background: var(--ccol);
    pointer-events: none;
  }
  .seg-h {
    left: 0;
    right: 0;
    top: 50%;
    height: var(--cth);
    transform: translateY(-50%);
    /* Keep a center gap = thickness * 4, so for 1px thickness we
       get a 4px gap; for 4px we get 16px. Visually proportional. */
    background: linear-gradient(
      to right,
      var(--ccol) calc(50% - var(--cth) * 2),
      transparent calc(50% - var(--cth) * 2),
      transparent calc(50% + var(--cth) * 2),
      var(--ccol) calc(50% + var(--cth) * 2)
    );
  }
  .seg-v {
    top: 0;
    bottom: 0;
    left: 50%;
    width: var(--cth);
    transform: translateX(-50%);
    background: linear-gradient(
      to bottom,
      var(--ccol) calc(50% - var(--cth) * 2),
      transparent calc(50% - var(--cth) * 2),
      transparent calc(50% + var(--cth) * 2),
      var(--ccol) calc(50% + var(--cth) * 2)
    );
  }

  /* Hollow ring for circle / reticle styles. */
  .ring {
    position: absolute;
    inset: 0;
    border: var(--cth) solid var(--ccol);
    border-radius: 50%;
    box-sizing: border-box;
  }

  /* Tiny center dot for the dot style — uses thickness as diameter
     so 1px = single pixel. */
  .dot {
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--cth);
    height: var(--cth);
    background: var(--ccol);
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }

  /* Fullscreen alignment crosshair — horizontal + vertical lines
     spanning the entire viewport at the cursor's row / column.
     The position-percent + thickness are inlined per element from
     Svelte; the rule below just centers the line on its anchor and
     drops a soft shadow for visibility. */
  .fs-line {
    position: fixed;
    pointer-events: none;
    z-index: 50;
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.7));
  }
  .fs-h {
    left: 0;
    right: 0;
    transform: translateY(-50%);
  }
  .fs-v {
    top: 0;
    bottom: 0;
    transform: translateX(-50%);
  }
</style>
