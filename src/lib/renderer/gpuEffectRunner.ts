/**
 * gpuEffectRunner — legacy WebGL→WebGPU bridge for mid-chain GPU effects.
 *
 * ──────────────────────────────────────────────────────────────────────
 * STATUS: LEGACY COMPARISON ONLY. Disabled whenever native core is the
 * active renderer.
 *
 * This runner exists for one job: take a Three.js texture sitting in the
 * middle of a WebGL effect chain (warp / blend / colour) and run a
 * WebGPU compute or fragment effect on it, returning a Three.js texture
 * the chain can keep using. To do that it has to bridge ACROSS contexts:
 *
 *   1. Render the input THREE.Texture into an internal WebGL render
 *      target (so we have pixels owned by a context we control).
 *   2. **readRenderTargetPixels()** — pulls the pixels into a Uint8Array
 *      on the CPU. ~1-3ms at 1080p. This is the slow leg.
 *   3. **device.queue.writeTexture()** — pushes that Uint8Array into a
 *      WebGPU texture. ~1ms at 1080p.
 *   4. Run the WebGPU effect.
 *   5. Wrap the WebGPU output canvas as a THREE.CanvasTexture and hand
 *      it back to the WebGL chain.
 *
 * Total bridge cost: ~3ms per affected effect per frame. With two GPU
 * effects in one chain at 1080p you've burned half your 60fps budget on
 * just the round-trip. This is the SINGLE biggest "WebGPU effects feel
 * slow" complaint we've heard from the field.
 *
 * ──────────────────────────────────────────────────────────────────────
 * THE STRATEGIC SHIFT (Phase 3.x → 4.x):
 *
 * Output / compositor-stage WebGPU work now goes through
 * `WebGPUCanvas.svelte` via the `videoFrameBridge` helper — a
 * `new VideoFrame(webglCanvas)` + `device.importExternalTexture()` path
 * that's TRULY zero-copy on Chromium 130+ (the VideoFrame is backed by
 * a GpuMemoryBuffer; no CPU readback). That bridge runs once per frame
 * AFTER the full WebGL effect chain is done, so it stays single-pass
 * and amortises the cost over every WebGL effect upstream.
 *
 * Mid-chain GPU effects (this runner) have NO equivalent escape from
 * the CPU readback because they need WebGL pixels mid-pipeline, before
 * the WebGL chain has finished compositing. There's no public web API
 * to extract a WebGL texture's GpuMemoryBuffer at an arbitrary moment
 * in a chain. Until one ships, this runner can't be made zero-copy.
 *
 * So this path is now restricted to the legacy comparison renderer.
 * When native core is enabled, `runGpuEffect()` early-returns the input
 * texture unchanged. We do not allow this CPU readback bridge to make
 * the in-app WebGL preview appear to support something the native output
 * does not actually render.
 *
 * ──────────────────────────────────────────────────────────────────────
 * CONSTRAINT NOTE: `texture_external` is FRAGMENT-SHADER ONLY.
 *
 * Even if a future API let us do a zero-copy mid-chain WebGL→WebGPU
 * import, the resulting `texture_external` type can only be sampled
 * from a fragment shader — not from a compute shader, not as a storage
 * texture, not as a render attachment. That rules out compute-based
 * effects like the existing `gpuFluidSim` ever going zero-copy without
 * a per-effect blit pass via `blitExternalToTexture2D()`. The
 * downstream-compositor bridge in WebGPUCanvas works because it ONLY
 * does fragment sampling.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Lifecycle: stateful effects (fluid sim) need per-(layer,effect)
 * instances because their internal fields persist between frames.
 * `dispose(layerId, effectId?)` cleans up.
 */

import * as THREE from 'three';
import { get as getStore } from 'svelte/store';
import { ensureWebGPUDevice, getWebGPUDevice, isWebGPUReady } from './webgpuShared';
import { WebGPUFluidSim, type FluidSimParams } from './webgpuFluidSim';
import { settings } from '$lib/stores/settings';
import type { Effect } from '../types';

// One per-layer + per-effect instance. The runner holds onto these
// across frames so stateful effects accumulate properly.
interface EffectInstance {
  type: string;
  // The WebGPU object; kind depends on type. Strongly-typed branches
  // would be ideal but `any` keeps the dispatch-on-type loose.
  impl: any;
  // Per-instance INPUT texture: the source layer's pixels copied
  // here each frame via copyExternalImageToTexture. Compute shaders
  // need a regular texture_2d<f32> binding (importExternalTexture
  // returns texture_external which only works in fragment shaders).
  inputTexture: any;          // GPUTexture
  inputTextureView: any;      // GPUTextureView (cached for the bind group)
  // The output canvas this instance renders into. Persistent so we
  // don't churn OffscreenCanvas + WebGPU context per frame.
  outputCanvas: HTMLCanvasElement;
  outputContext: any;         // GPUCanvasContext
  outputFormat: any;
  // Three.js wrapper that exposes outputCanvas as a Texture.
  outputTexture: THREE.CanvasTexture;
  // Cached width/height the output canvas + texture were configured
  // for. If the engine renders at a different size next frame we
  // reconfigure.
  configuredW: number;
  configuredH: number;
}

export class GpuEffectRunner {
  // Map<`${layerId}::${effectId}`, EffectInstance>
  private instances = new Map<string, EffectInstance>();

  // Snapshot scene/camera/quad reused for every snapshot draw.
  // Renders the layer's input texture into our snapshot render
  // target via the engine's WebGL renderer (so the texture is bound
  // in the SAME WebGL context that owns it — cross-context texture
  // sharing is impossible and was causing black output).
  private snapshotScene = new THREE.Scene();
  private snapshotCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private snapshotMaterial: THREE.ShaderMaterial;
  private snapshotMesh: THREE.Mesh;
  // Reused render target — the engine's renderer draws the input
  // texture into this. Then readRenderTargetPixels gives us the
  // pixel bytes we upload to WebGPU.
  private snapshotRenderTarget: THREE.WebGLRenderTarget | null = null;
  private snapshotPixels: Uint8Array | null = null;

  // Latch: have we tried (and possibly failed) WebGPU init?
  private webgpuAttempted = false;
  private webgpuAvailable = false;
  private device: any = null;
  private presentFormat: any = null;

  constructor() {
    // Identity blit material. Renders the input texture into our
    // snapshot render target, flipping Y so WebGPU (top-down) reads
    // it right-side-up.
    this.snapshotMaterial = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uTexture;
        varying vec2 vUv;
        void main() {
          // Y-flip: WebGL render targets store bottom-up; we want
          // top-down so WebGPU sees the image upright.
          gl_FragColor = texture2D(uTexture, vec2(vUv.x, 1.0 - vUv.y));
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    this.snapshotMesh = new THREE.Mesh(geo, this.snapshotMaterial);
    this.snapshotScene.add(this.snapshotMesh);

    // Kick off WebGPU init in the background. Subsequent calls await
    // through the singleton; the first user pays the cost.
    void this.tryInitWebGPU();
  }

  private async tryInitWebGPU(): Promise<void> {
    if (this.webgpuAttempted) return;
    this.webgpuAttempted = true;
    try {
      const { device, presentFormat } = await ensureWebGPUDevice();
      this.device = device;
      this.presentFormat = presentFormat;
      this.webgpuAvailable = true;
      console.log('[gpuEffectRunner] WebGPU ready (format', presentFormat, ')');
    } catch (err: any) {
      this.webgpuAvailable = false;
      console.warn('[gpuEffectRunner] WebGPU init failed — GPU effects will pass through unchanged:', err?.message || err);
    }
  }

  /** Apply a single GPU effect to the supplied input texture.
   *  Returns the post-effect texture (or the input untouched if
   *  WebGPU isn't ready yet — defensive against init race). */
  runGpuEffect(
    sourceTexture: THREE.Texture,
    effect: Effect,
    layerId: string,
    dt: number,
    threeRenderer: THREE.WebGLRenderer,
    width: number,
    height: number,
  ): THREE.Texture {
    // GATE: mid-chain GPU effects are a legacy comparison-only bridge.
    // The CPU-readback path below costs ~3ms at 1080p per call
    // (readRenderTargetPixels -> writeTexture round-trip). Native v2
    // must not use this to make the editor preview diverge from the
    // native output. Native effects need native graph/effect-pass ports.
    //
    // Cheap synchronous read — the settings store caches its value
    // and `get()` is O(1). Doing the check per frame (rather than via
    // subscription) means users toggling the flag in the dev panel
    // see the change on the very next frame without any plumbing.
    try {
      const s = getStore(settings);
      if (s?.experimental?.outputNativeCore || !s?.experimental?.allowMidChainGpuEffects) {
        return sourceTexture;
      }
    } catch {
      // Defensive: if the settings store somehow isn't initialised
      // yet (early boot, HMR edge case), fall through to the legacy
      // behaviour rather than blocking the chain entirely.
    }

    if (!this.webgpuAvailable || !this.device) {
      // Quietly pass through if WebGPU isn't ready — first few frames
      // after boot fall into this path while async init is in flight.
      return sourceTexture;
    }

    const key = `${layerId}::${effect.id}`;
    let instance = this.instances.get(key);

    // Lazy-create per-(layer,effect) instance. Stateful effects keep
    // their fields between frames; reset only happens when the user
    // removes/re-adds the effect (which changes effect.id).
    if (!instance) {
      try {
        instance = this.createInstance(effect.type, key, width, height);
      } catch (err: any) {
        console.warn('[gpuEffectRunner] failed to create', effect.type, 'instance:', err?.message || err);
        return sourceTexture;
      }
      this.instances.set(key, instance);
    }

    // Resize output canvas if the layer dimensions changed.
    if (instance.configuredW !== width || instance.configuredH !== height) {
      this.resizeInstanceOutput(instance, width, height);
    }

    // ── 1. Snapshot Three.js texture into a Uint8 buffer ──
    // Read pixels via the engine's renderer (same WebGL context that
    // owns the input texture — cross-context is impossible). The
    // pixels go into this.snapshotPixels (lazily allocated).
    const ok = this.snapshotInputToBuffer(sourceTexture, threeRenderer, width, height);
    if (!ok) return sourceTexture;

    // ── 2. Upload pixel buffer → WebGPU input texture ──
    // device.queue.writeTexture is the standard CPU→GPU upload path.
    // Costs ~1ms at 1080p; combined with readRenderTargetPixels
    // (~2ms) the whole bridge is ~3ms per GPU effect per frame.
    try {
      this.device.queue.writeTexture(
        { texture: instance.inputTexture },
        this.snapshotPixels!,
        { bytesPerRow: width * 4, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
    } catch (err: any) {
      console.warn('[gpuEffectRunner] writeTexture failed:', err?.message || err);
      return sourceTexture;
    }

    // ── 3. Encode WebGPU work for this effect ──
    const encoder = this.device.createCommandEncoder();
    try {
      this.encodeEffect(instance, instance.inputTextureView, encoder, effect, dt);
    } catch (err: any) {
      console.warn('[gpuEffectRunner] encode failed for', effect.type, ':', err?.message || err);
      return sourceTexture;
    }
    this.device.queue.submit([encoder.finish()]);

    // ── 4. Mark Three.js texture as needing re-upload (canvas content changed) ──
    instance.outputTexture.needsUpdate = true;
    return instance.outputTexture;
  }

  /** Snapshot a Three.js texture into this.snapshotPixels (Uint8Array,
   *  RGBA top-down). Uses the supplied engine renderer (the SAME
   *  context the texture lives in — cross-context texture sharing
   *  doesn't work and was the root cause of the all-black output).
   *  Returns false if anything went sideways so the caller can bail. */
  private snapshotInputToBuffer(
    tex: THREE.Texture,
    threeRenderer: THREE.WebGLRenderer,
    width: number,
    height: number,
  ): boolean {
    // (Re)allocate render target on resize. Use UnsignedByteType so
    // readRenderTargetPixels writes straight into a Uint8Array.
    if (!this.snapshotRenderTarget
        || this.snapshotRenderTarget.width !== width
        || this.snapshotRenderTarget.height !== height) {
      try { this.snapshotRenderTarget?.dispose(); } catch { /* */ }
      this.snapshotRenderTarget = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }
    if (!this.snapshotPixels || this.snapshotPixels.length !== width * height * 4) {
      this.snapshotPixels = new Uint8Array(width * height * 4);
    }

    // Save state we're about to clobber on the engine renderer.
    const prevTarget = threeRenderer.getRenderTarget();
    const prevAutoClear = threeRenderer.autoClear;
    const prevClearColor = new THREE.Color();
    threeRenderer.getClearColor(prevClearColor);
    const prevClearAlpha = threeRenderer.getClearAlpha();
    threeRenderer.autoClear = false;
    threeRenderer.setClearColor(0x000000, 0);

    try {
      // Render the input texture onto our snapshot RT via the engine
      // renderer (same context owns the input texture).
      this.snapshotMaterial.uniforms.uTexture.value = tex;
      this.snapshotMaterial.uniformsNeedUpdate = true;
      this.snapshotMesh.material = this.snapshotMaterial;
      threeRenderer.setRenderTarget(this.snapshotRenderTarget);
      threeRenderer.clear();
      threeRenderer.render(this.snapshotScene, this.snapshotCamera);

      // Read pixel data into our buffer. This is GPU→CPU readback —
      // the slow leg of the bridge (~1-3ms at 1080p) but it's the
      // only universal way to get WebGL pixels into WebGPU.
      threeRenderer.readRenderTargetPixels(this.snapshotRenderTarget, 0, 0, width, height, this.snapshotPixels);
    } catch (err: any) {
      console.warn('[gpuEffectRunner] snapshot failed:', err?.message || err);
      threeRenderer.autoClear = prevAutoClear;
      threeRenderer.setClearColor(prevClearColor, prevClearAlpha);
      threeRenderer.setRenderTarget(prevTarget);
      return false;
    }

    threeRenderer.autoClear = prevAutoClear;
    threeRenderer.setClearColor(prevClearColor, prevClearAlpha);
    threeRenderer.setRenderTarget(prevTarget);
    return true;
  }

  private createInstance(effectType: string, key: string, width: number, height: number): EffectInstance {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    // `as any` because the tsconfig doesn't include @webgpu/types and
    // TS narrows getContext('webgpu') to RenderingContext.
    const outputContext = outputCanvas.getContext('webgpu') as any;
    if (!outputContext) throw new Error('webgpu context unavailable on output canvas');
    outputContext.configure({
      device: this.device,
      format: this.presentFormat,
      alphaMode: 'premultiplied',
    });
    const outputTexture = new THREE.CanvasTexture(outputCanvas);
    outputTexture.minFilter = THREE.LinearFilter;
    outputTexture.magFilter = THREE.LinearFilter;
    outputTexture.generateMipmaps = false;
    outputTexture.colorSpace = THREE.SRGBColorSpace;
    // Three.js samples texture coords bottom-up (WebGL convention).
    // Our canvas is top-down. Flip Y on the texture so the engine's
    // compositor sees it right-side up.
    outputTexture.flipY = true;

    // Per-instance INPUT texture: where the snapshot canvas's pixels
    // get copied each frame. rgba8unorm is universally supported
    // for COPY_DST + TEXTURE_BINDING.
    const inputTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const inputTextureView = inputTexture.createView();

    let impl: any;
    if (effectType === 'gpuFluidSim') {
      impl = WebGPUFluidSim.create(this.device, 256);
    } else {
      throw new Error(`unknown gpu effect type: ${effectType}`);
    }

    return {
      type: effectType,
      impl,
      inputTexture,
      inputTextureView,
      outputCanvas,
      outputContext,
      outputFormat: this.presentFormat,
      outputTexture,
      configuredW: width,
      configuredH: height,
    };
  }

  private resizeInstanceOutput(instance: EffectInstance, w: number, h: number): void {
    instance.outputCanvas.width = w;
    instance.outputCanvas.height = h;
    instance.outputContext.configure({
      device: this.device,
      format: this.presentFormat,
      alphaMode: 'premultiplied',
    });
    instance.outputTexture.needsUpdate = true;
    // Reallocate input texture at the new size + invalidate the
    // sim's source-texture handle (it caches the view internally).
    try { instance.inputTexture?.destroy?.(); } catch { /* */ }
    instance.inputTexture = this.device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    instance.inputTextureView = instance.inputTexture.createView();
    if (instance.impl?.setSourceTexture) {
      instance.impl.setSourceTexture(instance.inputTextureView);
    }
    instance.configuredW = w;
    instance.configuredH = h;
  }

  /** Effect-type dispatch: encode the per-effect compute + render
   *  into the supplied encoder. */
  private encodeEffect(
    instance: EffectInstance,
    externalTexture: any,
    encoder: any,
    effect: Effect,
    dt: number,
  ): void {
    if (instance.type === 'gpuFluidSim') {
      const sim: WebGPUFluidSim = instance.impl;
      // Map effect.params → fluid sim params. The Effect type carries
      // a `params: EffectParams` object; we extract our knobs by
      // name with sensible defaults.
      const p: any = effect.params || {};
      // Fallback values match `getDefaultEffectParams('gpuFluidSim')` so
      // an effect created before that case existed (or via legacy load
      // paths that bypass the defaults) gets the new tuned look instead
      // of the original conservative numbers.
      const fp: Partial<FluidSimParams> = {
        injectStrength: p.injectStrength ?? 1.5,
        velocityFromGradient: p.velocityFromGradient ?? 1.4,
        viscosity: p.viscosity ?? 0.0,
        dyeDecay: p.dyeDecay ?? 2.4,
        velocityDecay: p.velocityDecay ?? 2.3,
        vorticity: p.vorticity ?? 1.0,
        outputBoost: p.outputBoost ?? 0.7,
        timeScale: p.timeScale ?? 1.6,
      };
      sim.setParams(fp);
      sim.setSourceTexture(externalTexture);
      sim.step(encoder, dt);
      const view = instance.outputContext.getCurrentTexture().createView();
      sim.encodeOutputToView(encoder, view, instance.outputFormat);
    }
  }

  /** Drop instances whose layer no longer exists, or whose effect
   *  was removed. Called periodically by the engine to free GPU
   *  memory. `liveKeys` is the set of keys (`${layerId}::${effectId}`)
   *  that should be retained. */
  reapStale(liveKeys: Set<string>): void {
    for (const [key, inst] of this.instances) {
      if (!liveKeys.has(key)) {
        try { inst.impl?.dispose?.(); } catch { /* */ }
        try { inst.outputTexture.dispose(); } catch { /* */ }
        try { inst.inputTexture?.destroy?.(); } catch { /* */ }
        this.instances.delete(key);
      }
    }
  }

  /** Has any work been registered (is WebGPU even online)? Used by
   *  the engine to decide whether to skip the "is this a GPU effect"
   *  check entirely. */
  isReady(): boolean { return this.webgpuAvailable; }

  dispose(): void {
    for (const inst of this.instances.values()) {
      try { inst.impl?.dispose?.(); } catch { /* */ }
      try { inst.outputTexture.dispose(); } catch { /* */ }
      try { inst.inputTexture?.destroy?.(); } catch { /* */ }
    }
    this.instances.clear();
    try { this.snapshotMesh.geometry.dispose(); } catch { /* */ }
    try { this.snapshotMaterial.dispose(); } catch { /* */ }
    try { this.snapshotRenderTarget?.dispose(); } catch { /* */ }
    this.snapshotPixels = null;
  }
}

/** Convenience: is the given EffectType a GPU effect? Checked by
 *  engine.applyEffects to dispatch to the runner instead of the
 *  WebGL material path. Currently just one — gpuFluidSim — but the
 *  prefix-based check makes adding more trivial. */
export function isGpuEffect(type: string): boolean {
  return type.startsWith('gpu');
}
