/**
 * WebGPUFluidSmokeShader — wraps the existing WebGPUFluidSim
 * (Stable-Fluids 2D incompressible-fluid simulation, complete with
 * advection, divergence, Jacobi pressure solve, vorticity confinement,
 * and dye decay) as a standalone GPU layer shader.
 *
 * Source-driven, like the threejs-blocks `smokeRTT` technique: any
 * picked image / video / camera / Spout sender / layer feeds the
 * sim. Bright pixels become DYE INJECTORS, and the source's
 * luminance gradient direction becomes a velocity force — so the
 * source's colors swirl and dissolve like watercolor in a glass of
 * water. Drop in a video and watch it billow into a fluid smoke;
 * point a webcam and the room becomes liquid.
 *
 * The hard work is all in `webgpuFluidSim.ts` — this wrapper just
 * threads the source pixel data into the sim each frame and routes
 * the dye output to the layer canvas. Audio reactivity rides on top
 * by modulating injection strength (bass kicks = bigger smoke
 * pulses).
 *
 * Architectural note: the standard "particle smoke" Ink Cloud shader
 * fakes fluid motion via curl-noise on individual particles — looks
 * great but isn't real fluid. THIS shader runs an actual Eulerian
 * Navier-Stokes solver on the GPU. The two are complementary:
 *   - Particle smoke = chunky individual puffs, light on GPU
 *   - Fluid smoke = continuous medium with real pressure-based flow
 *     and natural vortices, heavier (multiple ping-pong texture
 *     passes per frame including ~25 Jacobi iterations)
 */

import { WebGPUFluidSim, type FluidSimParams } from '../webgpuFluidSim';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

// Simulation grid resolution. Higher = more detail, more GPU. 256
// is the sweet spot — finer than this and the per-step Jacobi
// iterations dominate frame time on integrated GPUs.
const SIM_GRID = 256;

export const fluidSmokeParamSchema: ParamControl[] = [
  // ── Source ────────────────────────────────────────────────────
  // The pixel source that feeds the sim. Bright regions inject dye;
  // luminance gradients inject velocity. Anything works — image,
  // video, layer, webcam, Spout sender. The single most impactful
  // knob is "Inject Strength" below.
  { kind: 'media-source', key: 'source', label: 'Source', group: 'Source' },

  // ── Injection ────────────────────────────────────────────────
  // injectStrength feeds dye color into the simulation each frame.
  // velocityFromGradient turns the source's luminance gradient into
  // a velocity force — so a bright moving subject pushes the fluid
  // around. With both at 0, the sim just decays whatever's there.
  { kind: 'slider', key: 'injectStrength', label: 'Inject Strength', group: 'Injection',
    min: 0, max: 3, step: 0.01, default: 1.0 },
  { kind: 'slider', key: 'velocityFromGradient', label: 'Velocity From Gradient', group: 'Injection',
    min: 0, max: 3, step: 0.01, default: 1.0 },

  // ── Fluid Physics ─────────────────────────────────────────────
  // Vorticity confinement adds artificial swirl that counteracts
  // Jacobi-step diffusion, keeping the sim "alive" longer.
  // Viscosity diffuses momentum (smooths velocity); usually 0.
  // Decay multipliers are applied per-second; lower = longer trails.
  { kind: 'slider', key: 'vorticity', label: 'Vorticity (swirl)', group: 'Fluid Physics',
    min: 0, max: 5, step: 0.01, default: 1.5 },
  { kind: 'slider', key: 'viscosity', label: 'Viscosity', group: 'Fluid Physics',
    min: 0, max: 0.01, step: 0.0001, default: 0.0 },
  { kind: 'slider', key: 'dyeDecay', label: 'Dye Decay (per sec)', group: 'Fluid Physics',
    min: 0.01, max: 2, step: 0.01, default: 0.4 },
  { kind: 'slider', key: 'velocityDecay', label: 'Velocity Decay (per sec)', group: 'Fluid Physics',
    min: 0.01, max: 2, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'timeScale', label: 'Time Scale', group: 'Fluid Physics',
    min: 0.1, max: 3, step: 0.01, default: 1.0 },

  // ── Output ────────────────────────────────────────────────────
  // outputBoost multiplies the dye RGB before display — dye texture
  // is rgba16float so we can boost beyond 1.0 for HDR-ish glow.
  { kind: 'slider', key: 'outputBoost', label: 'Output Brightness', group: 'Output',
    min: 0.5, max: 4, step: 0.05, default: 1.6 },

  // ── Audio ─────────────────────────────────────────────────────
  // Bass spikes scale injectStrength — kicks pulse fresh smoke into
  // the field. Treble has no direct hook in the existing sim; we'd
  // have to add a per-fragment shimmer pass to use it. Skipped here.
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio', default: true },
  { kind: 'slider', key: 'audioBassBoost', label: 'Bass → Inject Boost', group: 'Audio',
    min: 0, max: 4, step: 0.05, default: 1.5,
    showWhen: { audioReactive: true } },
];

export const fluidSmokeParamDefaults = deriveDefaults(fluidSmokeParamSchema);

export class WebGPUFluidSmokeShader implements GpuShaderImpl {
  private device: any;
  private presentFormat: any;
  // The simulator. Created lazily once we have the device.
  private sim: WebGPUFluidSim;
  // Source texture the sim reads its dye/velocity injection from.
  // We copy whatever the user picked (image/video/canvas/bytes) into
  // this texture each frame and hand its view to sim.setSourceTexture.
  private sourceTex: any = null;
  private sourceTexView: any = null;
  private sourceW = 1;
  private sourceH = 1;
  // Audio bands snapshot pumped by the runner's setBands hook.
  private bands: { bass: number; mid: number; treble: number } | null = null;
  private lastParams: Record<string, any> = { ...fluidSmokeParamDefaults };

  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.sim = WebGPUFluidSim.create(device, SIM_GRID);
    // 1×1 placeholder source; replaced on first setSource call. The
    // sim won't inject anything visible until a real source binds.
    this.sourceTex = device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sourceTexView = this.sourceTex.createView();
    this.sim.setSourceTexture(this.sourceTexView);
    // Output format is passed per-call to encodeOutputToView (which
    // caches the pipeline keyed by format). No setOutputFormat call
    // needed at construction.
  }

  setBands(bass: number, mid: number, treble: number): void {
    this.bands = { bass, mid, treble };
    this.applyParamsToSim();
  }

  setParams(p: Record<string, any>): void {
    this.lastParams = { ...fluidSmokeParamDefaults, ...p };
    this.applyParamsToSim();
  }

  /** Feed the user's tuning + the live audio bands into the inner
   *  sim. Bass boost is multiplicative on top of the user's
   *  injectStrength baseline, so a constant audio level produces a
   *  steady amplification rather than a one-shot spike. */
  private applyParamsToSim(): void {
    const p = this.lastParams;
    const reactive = !!p.audioReactive && this.bands;
    const liveBass = reactive ? this.bands!.bass : 0;
    const baseInject = p.injectStrength ?? 1.0;
    const audioInject = baseInject * (1 + liveBass * (p.audioBassBoost ?? 1.5));
    const fp: Partial<FluidSimParams> = {
      injectStrength: audioInject,
      velocityFromGradient: p.velocityFromGradient ?? 1.0,
      viscosity: p.viscosity ?? 0,
      dyeDecay: p.dyeDecay ?? 0.4,
      velocityDecay: p.velocityDecay ?? 0.6,
      vorticity: p.vorticity ?? 1.5,
      outputBoost: p.outputBoost ?? 1.6,
      timeScale: p.timeScale ?? 1.0,
    };
    this.sim.setParams(fp);
  }

  /** Resize + recreate the source texture when the user picks a new
   *  source with different dimensions. Re-binds the new view to the
   *  sim so subsequent steps sample the right data. */
  private resizeSource(w: number, h: number): void {
    if (this.sourceW === w && this.sourceH === h && this.sourceTex) return;
    try { this.sourceTex?.destroy?.(); } catch { /* */ }
    this.sourceTex = this.device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sourceTexView = this.sourceTex.createView();
    this.sourceW = w; this.sourceH = h;
    this.sim.setSourceTexture(this.sourceTexView);
  }

  setSource(src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap): void {
    const w = (src as any).naturalWidth ?? (src as any).videoWidth ?? (src as any).width ?? 1;
    const h = (src as any).naturalHeight ?? (src as any).videoHeight ?? (src as any).height ?? 1;
    if (!w || !h) return;
    // Skip videos that haven't decoded a frame yet — copyExternalImage
    // throws on readyState < 2. The runner calls us every frame so
    // we'll get the data the moment it's ready.
    if (src instanceof HTMLVideoElement && src.readyState < 2) return;
    this.resizeSource(w, h);
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: src, flipY: false },
        { texture: this.sourceTex, premultipliedAlpha: false },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch { /* skip frame on transient failures */ }
  }

  setSourceFromBytes(data: Uint8Array, w: number, h: number): void {
    if (!w || !h) return;
    this.resizeSource(w, h);
    try {
      this.device.queue.writeTexture(
        { texture: this.sourceTex },
        data,
        { bytesPerRow: w * 4, rowsPerImage: h },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch { /* */ }
  }

  encodeFrame(encoder: any, targetView: any, format: any, _w: number, _h: number, dt: number): void {
    // 1) Step the simulation one tick (inject → advect velocity →
    //    divergence → Jacobi × 25 → subtract gradient → advect dye →
    //    decay). All on the GPU; no CPU-side waiting.
    this.sim.step(encoder, dt);
    // 2) Render the resulting dye field into the layer canvas. The
    //    sim handles the clear + fullscreen-quad blit internally and
    //    caches the output pipeline keyed by `format` so per-frame
    //    overhead is just one bind-group update.
    this.sim.encodeOutputToView(encoder, targetView, format);
  }

  resize(_w: number, _h: number): void { /* no-op — sim grid is fixed */ }

  dispose(): void {
    try { this.sim.dispose(); } catch { /* */ }
    try { this.sourceTex?.destroy?.(); } catch { /* */ }
  }
}
