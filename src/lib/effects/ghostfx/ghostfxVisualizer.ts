// GhostFX — original audio-reactive visualizer plugin.
//
// Phase 1 (this file) ships a single hero scene ("Liminal") — a
// raymarched SDF metaball field rendered through WebGPU. Subsequent
// phases add: compute particle fields, a post-process stack
// (bloom/CA/grain), and a preset library covering the cinematic /
// psychedelic / sculptural categories.
//
// Pipeline shape (per layer):
//
//   GPUDevice (shared)
//        │
//        ├── WebGPU canvas (offscreen, sized to layer)
//        │      └── single render pass (vertex+fragment, WGSL scene)
//        │             writes to canvas context view
//        │
//        ▼
//   Three.js CanvasTexture wrapping the WebGPU canvas
//        │
//        ▼
//   Fullscreen quad blit → layer's WebGLRenderTarget
//
// Same blit pattern as our other plugins (AudioMotion, Hydra, Wave.js)
// — keeps GhostFX a drop-in layer source that participates in opacity,
// blend modes, warp, mapping, slicing, recording, etc.
//
// Author: Ghost Arcade (original)

import * as THREE from 'three';
import { ensureWebGPUDevice, getWebGPUDevice, getPreferredCanvasFormat } from '../../renderer/webgpuShared';
import { buildDriftWgsl } from './scenes/drift.wgsl';
import { buildRibbonsWgsl } from './scenes/ribbons.wgsl';
import {
  LIQUID_SPLAT_WGSL, LIQUID_ADVECT_VEL_WGSL, LIQUID_DIVERGENCE_WGSL,
  LIQUID_JACOBI_WGSL, LIQUID_SUBTRACT_WGSL, LIQUID_ADVECT_DYE_WGSL,
  LIQUID_RENDER_WGSL,
} from './scenes/liquid.wgsl';
import { POST_WGSL } from './shaders/post.wgsl';
import { AudioSmoother } from './audioSmoother';
import type { AudioAnalysis } from '../../audio/analyzer';

// Particle + trail sizes for Drift. Used to:
//   - size storage buffers (particles: NUM*32B, trail: NUM*TRAIL*16B)
//   - parameterize WGSL constants via buildDriftWgsl()
//   - parameterize draw counts (trails = NUM*(TRAIL-1)*2 verts, lattice = NUM*2)
//
// 50k particles × 16 trail slots = 12.8 MB trail buffer, 1.6 MB particle
// buffer. Well under WebGPU's 128 MB max storage size on any device.
const DRIFT_PARTICLE_COUNT = 50000;
const DRIFT_TRAIL_LEN = 16;
// Ribbons — fewer "particles" but each is a long quad strip. Total
// vertex count: RIBBONS_COUNT * (RIBBONS_TRAIL_LEN - 1) * 6 ≈ 1.15M
// (4096 × 47 × 6). Storage: ~3.1 MB.
const RIBBONS_COUNT = 4096;
const RIBBONS_TRAIL_LEN = 48;

// Liquid — 2D fluid sim grid. Width fixed; height matches canvas
// aspect ratio. 384×216 = ~83k cells, ~30 pressure iterations / frame
// = ~2.5M Jacobi cell-ops, well within budget on any WebGPU device.
const LIQUID_SIM_W = 384;
const LIQUID_JACOBI_ITERS = 30;
const LIQUID_MAX_SPLATS = 32;       // per-frame splat budget
const LIQUID_SPLAT_STRIDE = 32;     // bytes per Splat in WGSL (vec4 + vec4)

export type RibbonBlend = 'additive' | 'lighten' | 'glass';

export interface GhostFXParams {
  scenePreset: string;
  sensitivity: number;        // 0.25..4 — audio drive multiplier
  hueDriftSpeed: number;      // 0..2 — palette rotation
  // Composite-pass post-stack
  exposure: number;           // -1..1 — final exposure trim (post-bloom)
  bloomIntensity: number;     // 0..3 — bloom add-back
  bloomThreshold: number;     // 0..2 — bright pass threshold
  vignette: number;           // 0..1 — vignette strength
  bgAlpha: number;            // 0..1
  // Drift-scene specific
  vortexStrength: number;     // 0..6 — curl-noise force gain (0 = static, 6 = chaotic)
  latticeThreshold: number;   // 0..6 — max neighbor distance for a line (0 = lattice off)
  trailIntensity: number;     // 0..2 — trail brightness multiplier (0 = no trails)
  feedbackAmount: number;     // 0..1 — frame-feedback echo strength (0 = no echo)
  feedbackZoom: number;       // 0.985..1.015 — per-frame zoom of feedback texture
  // Ribbons-scene specific
  ribbonWidth: number;        // 0.02..0.30 — head width (world units; tail ≈ 15% of this)
  ribbonSpawn: number;        // 0.2..3.0 — spawn-probability multiplier (1.0 = base)
  ribbonTranslucency: number; // 0..1 — alpha gain for back-ribbon visibility (only effective with glass blend)
  ribbonBlend: RibbonBlend;
  lightAzimuth: number;       // 0..360 — light yaw in degrees
  lightElevation: number;     // -90..90 — light pitch in degrees (>0 = above)
  lightStrength: number;      // 0..2 — directional light intensity (diffuse contribution)
  ambient: number;            // 0..1 — ambient floor (always-on baseline lighting)
  // Liquid-scene specific
  liquidSplatForce: number;   // 0.2..3.0 — impulse intensity multiplier
  liquidSplatRadius: number;  // 0.01..0.20 — drop radius in uv units
  liquidDyeDecay: number;     // 0.985..1.0 — dye fade rate per frame (lower = faster fade)
  liquidVelDecay: number;     // 0.95..1.0 — velocity damping per frame
  liquidBassRate: number;     // 0..2 — bass-driven ambient splat probability multiplier
}

const DEFAULT_PARAMS: GhostFXParams = {
  scenePreset: 'drift',
  sensitivity: 1.4,
  hueDriftSpeed: 0.15,
  exposure: 0.1,
  bloomIntensity: 1.4,
  bloomThreshold: 0.45,
  vignette: 0.7,
  bgAlpha: 0.0,
  vortexStrength: 2.0,
  latticeThreshold: 2.5,
  trailIntensity: 1.0,
  feedbackAmount: 0.35,
  feedbackZoom: 1.003,
  ribbonWidth: 0.10,
  ribbonSpawn: 1.0,
  ribbonTranslucency: 0.35,
  ribbonBlend: 'additive',
  lightAzimuth: 35,
  lightElevation: 55,
  lightStrength: 0.9,
  ambient: 0.30,
  liquidSplatForce: 1.0,
  liquidSplatRadius: 0.08,
  liquidDyeDecay: 0.995,
  liquidVelDecay: 0.992,
  liquidBassRate: 1.0,
};

// Scene uniform layout — matches `Uniforms` struct in drift.wgsl /
// ribbons.wgsl. Float index → field, with explicit offsets so the
// CPU write order lines up with the WGSL struct exactly.
//
//   [0..2]   resolution (vec2)
//   [2]      time
//   [3]      dt
//   [4..10]  bassSlow, midSlow, trebSlow, bassFast, midFast, trebFast
//   [10]     energy
//   [11]     beatPhase
//   [12]     beatPulse
//   [13]     amp
//   [14]     hueShift
//   [15]     exposure
//   [16]     latticeThreshold
//   [17]     vortexStrength
//   [18]     ribbonWidth
//   [19]     ribbonTranslucency
//   [20..24] lightDirAndStrength (vec4): xyz = light dir, w = strength
//   [24]     ambient
//   [25]     ribbonSpawn
//   [26..28] pad
// 28 floats = 112 bytes (16-aligned for the vec4 at offset 80).
const UNIFORM_BYTES = 112;
const UNIFORM_FLOATS = UNIFORM_BYTES / 4;

// Post uniform layout. Field order:
//   resolution (vec2), bloomThreshold, bloomIntensity,
//   exposure, vignette, feedbackAmount, feedbackZoom
// Total: 2 + 6 = 8 f32 = 32 bytes.
const POST_UNIFORM_BYTES = 32;
const POST_UNIFORM_FLOATS = POST_UNIFORM_BYTES / 4;

export class GhostFXVisualizer {
  private canvas: HTMLCanvasElement;
  // WebGPU types aren't in the project's TS lib (matches existing usage
  // in webgpuShared.ts / webgpuPaintDrip.ts which also use `any`).
  // Behavior is still correct at runtime — the constants/methods are
  // attached to the actual GPU objects regardless of declared types.
  private device: any = null;
  private context: any = null;
  private presentFormat: string = 'bgra8unorm';

  // Scene pipelines (renders into sceneTex at HDR rgba16float).
  // Drift uses four passes: bg + trails + particles + lattice, plus
  // a preceding compute pass that advects particles and shifts trail
  // history each frame.
  private scenePipeline: any = null;       // bg fullscreen
  private particlePipeline: any = null;    // instanced point sprites (Drift) OR ribbon quad-strip (Ribbons; one of _ribbonPipelines)
  // Ribbons: one pipeline per blend mode. Render() picks the active
  // one based on params.ribbonBlend and re-assigns particlePipeline.
  private _ribbonPipelines: { additive: any; lighten: any; glass: any } | null = null;
  // Liquid: full 2D fluid sim state.
  private _liquidPipelines: {
    splat: any;
    advectVel: any;
    divergence: any;
    jacobi: any;
    subtractGradient: any;
    advectDye: any;
    render: any;       // also used as scenePipeline for the bg pass
  } | null = null;
  private _liquidTextures: {
    velA: any; velB: any;
    dyeA: any; dyeB: any;
    presA: any; presB: any;
    div: any;
    velAView: any; velBView: any;
    dyeAView: any; dyeBView: any;
    presAView: any; presBView: any;
    divView: any;
    sampler: any;
    simW: number; simH: number;
  } | null = null;
  // Per-pass bind groups. Splat + advectDye need 4 combos each (vel
  // parity × dye parity) because vel toggles 3× per frame while dye
  // toggles 2× — they desync and we don't pay a redundant copy.
  // Naming: lowercase suffixes encode the parities; e.g.
  // splat_vA_dB = read velA + dyeB, write velB + dyeA.
  private _liquidBindGroups: {
    splat_vA_dA: any; splat_vA_dB: any; splat_vB_dA: any; splat_vB_dB: any;
    advectVelAB: any; advectVelBA: any;
    divergenceA: any; divergenceB: any;
    jacobiAB: any; jacobiBA: any;
    subtractAB: any; subtractBA: any;
    advectDye_vA_dA: any; advectDye_vA_dB: any; advectDye_vB_dA: any; advectDye_vB_dB: any;
    renderA: any; renderB: any;
  } | null = null;
  private _liquidUniformBuffer: any = null;
  private _liquidSplatBuffer: any = null;
  // Splat-buffer scratch (CPU-side) — packed as Float32 [posX, posY, velX, velY, r, g, b, radius] × N
  private _liquidSplatCpu = new Float32Array(LIQUID_MAX_SPLATS * 8);
  private _liquidUniformCpu = new ArrayBuffer(96);
  private _liquidUniformF32 = new Float32Array(this._liquidUniformCpu);
  private _liquidUniformU32 = new Uint32Array(this._liquidUniformCpu);
  // Ping-pong state: true = "current is A", false = "current is B"
  private _liquidVelIsA = true;
  private _liquidDyeIsA = true;
  // Beat detector — fires on rising edge of beatPulse
  private _liquidPrevBeatPulse = 0;
  // Accumulated phase for ambient bass-driven splats
  private _liquidAmbientAcc = 0;
  private trailPipeline: any = null;       // line topology, one segment per (particle, trail-slot pair)
  private latticePipeline: any = null;     // line topology, particle ↔ buddy connectors
  private computePipeline: any = null;     // particle advection + trail shift
  // Per-scene draw parameters — set by _build*Pipelines, consumed in render().
  private _particleVertCount: number = 6;
  private _particleInstCount: number = 0;
  private _computeDispatchCount: number = 0;
  private sceneUniformBuffer: any = null;
  private sceneBindGroup: any = null;            // render-side: read-only-storage + uniform (VERTEX|FRAGMENT)
  private driftComputeBindGroup: any = null;     // compute-side: read_write storage + uniform (COMPUTE)
  // Storage buffers (Drift). Particles persist across frames; the
  // compute pipeline mutates them in place. Trail buffer holds
  // TRAIL_LEN past positions per particle — also mutated in compute.
  private particleBuffer: any = null;
  private trailBuffer: any = null;

  // Post pipelines — extract+hBlur, vBlur, composite all share the
  // same vertex shader + uniform buffer + sampler; only the
  // fragment entry point and texture bindings differ.
  private postExtractPipeline: any = null;
  private postBlurVPipeline: any = null;
  private postCompositePipeline: any = null;
  private postUniformBuffer: any = null;
  private linearSampler: any = null;
  // Explicit shared bind group layout for all post passes — see
  // _buildPostPipelines for the rationale (avoids layout: 'auto'
  // per-shader divergence).
  private _postBindLayout: any = null;
  // Per-pass bind groups bind whichever textures that pass reads.
  private postExtractBindGroup: any = null;
  private postBlurVBindGroup: any = null;
  private postCompositeBindGroup: any = null;

  // HDR offscreen textures
  private sceneTex: any = null;
  private bloomTexA: any = null;  // hBlur output (half-res)
  private bloomTexB: any = null;  // vBlur output (half-res)
  private sceneTexView: any = null;
  private bloomTexAView: any = null;
  private bloomTexBView: any = null;
  private texWidth = 0;
  private texHeight = 0;
  private postUniformCpu = new Float32Array(POST_UNIFORM_FLOATS);
  private uniformCpu = new Float32Array(UNIFORM_FLOATS);
  private ready = false;
  /** Last scene id we attempted to build a pipeline for, succeed or
   *  fail. Used to suppress per-frame retry spam — only rebuild when
   *  the user explicitly changes the preset, not when the param-pump
   *  re-pushes the same value 60×/s. */
  private attemptedScene: string = '';
  private currentScene: string = '';

  // Three.js blit
  private texture: THREE.CanvasTexture;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.MeshBasicMaterial;
  private quad: THREE.Mesh;

  private width: number;
  private height: number;
  private params: GhostFXParams = { ...DEFAULT_PARAMS };

  private timeStart = performance.now();
  private accHue = 0;
  // Audio smoothing — the heart of the "mesmerizing, not jerky" design.
  // Raw audio NEVER reaches the shader; every uniform value passes
  // through here first. See audioSmoother.ts for the rationale on
  // each time constant.
  private smoother = new AudioSmoother();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    // Offscreen but attached so canvas measurements work.
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText = 'position:absolute;top:-99999px;left:-99999px;pointer-events:none;';
    document.body.appendChild(this.canvas);

    // Blit pipeline mirrors the other plugins exactly. CanvasTexture
    // re-uploads each frame when `needsUpdate = true`.
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // premultipliedAlpha matches the WebGPU canvas alphaMode and the
    // post-composite fragment shader output.
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    // Async WebGPU init — runs in background; render() no-ops until ready.
    void this._initWebGPU();
  }

  init(_renderer: THREE.WebGLRenderer): void { /* nothing extra */ }

  setParams(p: Partial<GhostFXParams>): void {
    Object.assign(this.params, p);
    if (
      p.scenePreset !== undefined &&
      p.scenePreset !== this.attemptedScene &&  // only retry on actual change, not param-pump re-pushes
      this.device
    ) {
      this._buildScenePipeline().catch(e => console.warn('[GhostFX] scene rebuild failed', e));
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    // HDR offscreen textures are sized explicitly — reallocate them
    // on resize so bloom + scene match the new canvas. Bind groups
    // are rebuilt at the same time since they reference the views.
    if (this.device) this._allocateTextures();
  }

  /**
   * Advance + render one frame. Caller passes the raw AudioAnalysis
   * directly; we do all smoothing/BPM-syncing/anticipation here, then
   * write the result into the uniform buffer. The shader sees nothing
   * but already-smooth, song-aware signals.
   */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, audio: AudioAnalysis | null, dt: number): void {
    if (
      !this.ready || !this.device || !this.context ||
      !this.scenePipeline || !this.sceneUniformBuffer || !this.sceneBindGroup ||
      !this.postExtractPipeline || !this.postBlurVPipeline || !this.postCompositePipeline ||
      !this.sceneTexView || !this.bloomTexAView || !this.bloomTexBView
    ) {
      // No frame yet → keep the previous target contents (next blit will overwrite).
      return;
    }

    // 1. Smooth + BPM-sync the audio (this is THE step that makes
    //    the visualizer feel "anticipatory" instead of jerky).
    const s = this.smoother.step(dt, audio, this.params.sensitivity);

    // 2. Slowly drift the hue offset for palette progression.
    //    Decoupled from audio entirely — the song's color story
    //    progresses on its own clock so the palette doesn't strobe.
    this.accHue = (this.accHue + dt * this.params.hueDriftSpeed * 0.04) % 1;

    // 3. Pack uniforms (matches `Uniforms` struct in drift.wgsl)
    const u = this.uniformCpu;
    u[0]  = this.width;
    u[1]  = this.height;
    u[2]  = (performance.now() - this.timeStart) / 1000;
    u[3]  = dt;
    u[4]  = s.bassSlow;
    u[5]  = s.midSlow;
    u[6]  = s.trebSlow;
    u[7]  = s.bassFast;
    u[8]  = s.midFast;
    u[9]  = s.trebFast;
    u[10] = s.energy;
    u[11] = s.beatPhase;
    u[12] = s.beatPulse;
    u[13] = s.amp;
    u[14] = this.accHue;
    u[15] = this.params.exposure;
    // Lattice threshold scales with audio so connections breathe in
    // and out with the music — calm sections show few lines, loud
    // sections fill with structure.
    u[16] = this.params.latticeThreshold * (0.6 + s.energy * 0.8);
    u[17] = this.params.vortexStrength;
    u[18] = this.params.ribbonWidth;
    u[19] = this.params.ribbonTranslucency;
    // Light dir from azimuth + elevation (degrees). Convention: world
    // +y up, +x right, +z forward. Azimuth = yaw around y (0 = +z),
    // elevation = pitch above horizon.
    {
      const az = this.params.lightAzimuth * Math.PI / 180;
      const el = this.params.lightElevation * Math.PI / 180;
      u[20] = Math.cos(el) * Math.sin(az);
      u[21] = Math.sin(el);
      u[22] = Math.cos(el) * Math.cos(az);
      u[23] = this.params.lightStrength;
    }
    u[24] = this.params.ambient;
    u[25] = this.params.ribbonSpawn;
    // u[26..27] padding
    this.device.queue.writeBuffer(this.sceneUniformBuffer, 0, u.buffer, u.byteOffset, u.byteLength);

    // Post uniforms — feedback fields wired so the composite can
    // sample the previous frame texture with zoom warp.
    const pu = this.postUniformCpu;
    pu[0] = this.width;
    pu[1] = this.height;
    pu[2] = this.params.bloomThreshold;
    pu[3] = this.params.bloomIntensity;
    pu[4] = this.params.exposure;
    pu[5] = this.params.vignette;
    pu[6] = this.params.feedbackAmount;
    pu[7] = this.params.feedbackZoom;
    this.device.queue.writeBuffer(this.postUniformBuffer, 0, pu.buffer, pu.byteOffset, pu.byteLength);

    // ── Encode the full chain in one command buffer ────────────────
    // pass 1: scene → sceneTex (rgba16float, full-res HDR)
    // pass 2: extract + horizontal blur → bloomTexA (half-res HDR)
    // pass 3: vertical blur → bloomTexB (half-res HDR)
    // pass 4: composite → swapchain (LDR)
    const encoder = this.device.createCommandEncoder({ label: 'ghostfx' });

    // 0a. Liquid scene — full fluid sim (multi-pass compute). Runs
    //     before the bg pass, which then samples the dye into sceneTex.
    if (this.currentScene === 'liquid') {
      this._renderLiquid(encoder, s, dt);
    }

    // 0b. Compute pass — advect particles + shift trail history. Runs
    //    before all the render passes so the storage buffer state
    //    that the vertex shaders read is one tick ahead.
    if (this.computePipeline) {
      const cp = encoder.beginComputePass({ label: 'ghostfx:drift:advect' });
      cp.setPipeline(this.computePipeline);
      cp.setBindGroup(0, this.driftComputeBindGroup);
      // Workgroup size = 64 in all csAdvect shaders; per-scene
      // dispatch count is set in _build*Pipelines based on the
      // scene's particle/ribbon count.
      cp.dispatchWorkgroups(this._computeDispatchCount);
      cp.end();
    }

    // 1. Background — fills sceneTex with a gradient/starfield.
    //
    // When bgAlpha = 0 the scene needs to be TRANSPARENT so this
    // visualizer can sit on top of other layers. In that case we
    // still need to clear sceneTex (otherwise particles accumulate
    // from previous frames) — we just clear to (0,0,0,0) and skip
    // the bg draw call entirely.
    {
      // Liquid's "bg" pass IS the dye render — always draw it. For
      // other scenes, gate on user bgAlpha (default 0 = transparent).
      const drawBg = this.currentScene === 'liquid' || this.params.bgAlpha > 0.001;
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.sceneTexView,
          clearValue: { r: 0, g: 0, b: 0, a: drawBg ? 1 : 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
        label: 'ghostfx:bg',
      });
      if (drawBg) {
        pass.setPipeline(this.scenePipeline);
        pass.setBindGroup(0, this.sceneBindGroup);
        pass.draw(3);
      }
      pass.end();
    }

    // 2. Trail ribbons — draw BEHIND particle heads so the head
    //    sits on top of its trail. Line-list draw with one segment
    //    per (particle, trail-slot pair). User-tunable intensity
    //    handled in fragment via per-vertex brightness scaled by
    //    trailIntensity uniform... actually we pre-scale brightness
    //    on the CPU since trailIntensity isn't in the WGSL struct;
    //    instead we just gate the entire draw call.
    if (this.trailPipeline && this.params.trailIntensity > 0.001) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.sceneTexView, loadOp: 'load', storeOp: 'store' }],
        label: 'ghostfx:trails',
      });
      pass.setPipeline(this.trailPipeline);
      pass.setBindGroup(0, this.sceneBindGroup);
      // 2 vertices per segment × (TRAIL_LEN - 1) segments × NUM particles.
      pass.draw(2 * (DRIFT_TRAIL_LEN - 1) * DRIFT_PARTICLE_COUNT);
      pass.end();
    }

    // For Ribbons, swap to the user-selected blend-mode pipeline.
    if (this.currentScene === 'ribbons' && this._ribbonPipelines) {
      this.particlePipeline = this._ribbonPipelines[this.params.ribbonBlend] ?? this._ribbonPipelines.additive;
    }

    // 3. Particle sprites — quads on top of trails
    if (this.particlePipeline) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.sceneTexView, loadOp: 'load', storeOp: 'store' }],
        label: 'ghostfx:particles',
      });
      pass.setPipeline(this.particlePipeline);
      pass.setBindGroup(0, this.sceneBindGroup);
      // Drift: 6 verts × N particles instances. Ribbons: one big
      // draw of N * (TRAIL_LEN-1) * 6 verts × 1 instance. Set per
      // scene in _build*Pipelines.
      pass.draw(this._particleVertCount, this._particleInstCount);
      pass.end();
    }

    // 4. Lattice connectors — 2 verts per particle (one line each
    //    to its buddy). Gated by the threshold param; when 0 we
    //    skip the pass entirely to save bandwidth.
    if (this.latticePipeline && this.params.latticeThreshold > 0.001) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.sceneTexView, loadOp: 'load', storeOp: 'store' }],
        label: 'ghostfx:lattice',
      });
      pass.setPipeline(this.latticePipeline);
      pass.setBindGroup(0, this.sceneBindGroup);
      pass.draw(2 * DRIFT_PARTICLE_COUNT);
      pass.end();
    }
    // Extract + hBlur → bloomTexA
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.bloomTexAView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.postExtractPipeline);
      pass.setBindGroup(0, this.postExtractBindGroup);
      pass.draw(3);
      pass.end();
    }
    // vBlur → bloomTexB
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.bloomTexBView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.postBlurVPipeline);
      pass.setBindGroup(0, this.postBlurVBindGroup);
      pass.draw(3);
      pass.end();
    }
    // Composite → canvas
    {
      const view = this.context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.postCompositePipeline);
      pass.setBindGroup(0, this.postCompositeBindGroup);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);

    // Blit canvas → Three.js render target
    this.texture.needsUpdate = true;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const prevClear = new THREE.Color();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(prevClear);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    try { this.sceneUniformBuffer?.destroy(); } catch {}
    try { this.postUniformBuffer?.destroy(); } catch {}
    try { this.sceneTex?.destroy(); } catch {}
    try { this.bloomTexA?.destroy(); } catch {}
    try { this.bloomTexB?.destroy(); } catch {}
    try { this.particleBuffer?.destroy(); } catch {}
    try { this.trailBuffer?.destroy(); } catch {}
    this.sceneUniformBuffer = null;
    this.postUniformBuffer = null;
    this.scenePipeline = null;
    this.particlePipeline = null;
    this.trailPipeline = null;
    this.latticePipeline = null;
    this.computePipeline = null;
    this.particleBuffer = null;
    this.trailBuffer = null;
    this.sceneBindGroup = null;
    this.driftComputeBindGroup = null;
    this._ribbonPipelines = null;
    // Liquid cleanup
    if (this._liquidTextures) {
      try { this._liquidTextures.velA?.destroy(); } catch {}
      try { this._liquidTextures.velB?.destroy(); } catch {}
      try { this._liquidTextures.dyeA?.destroy(); } catch {}
      try { this._liquidTextures.dyeB?.destroy(); } catch {}
      try { this._liquidTextures.presA?.destroy(); } catch {}
      try { this._liquidTextures.presB?.destroy(); } catch {}
      try { this._liquidTextures.div?.destroy(); } catch {}
    }
    try { this._liquidUniformBuffer?.destroy(); } catch {}
    try { this._liquidSplatBuffer?.destroy(); } catch {}
    this._liquidTextures = null;
    this._liquidPipelines = null;
    this._liquidBindGroups = null;
    this._liquidUniformBuffer = null;
    this._liquidSplatBuffer = null;
    this.postExtractPipeline = null;
    this.postBlurVPipeline = null;
    this.postCompositePipeline = null;
    this.postExtractBindGroup = null;
    this.postBlurVBindGroup = null;
    this.postCompositeBindGroup = null;
    this.sceneTex = this.bloomTexA = this.bloomTexB = null;
    this.sceneTexView = this.bloomTexAView = this.bloomTexBView = null;
    this.linearSampler = null;
    try { (this.context as any)?.unconfigure?.(); } catch {}
    this.context = null;
    this.texture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    try { this.canvas.remove(); } catch {}
    this.ready = false;
  }

  isReady(): boolean { return this.ready; }

  // ── Internal ─────────────────────────────────────────────────────────

  private async _initWebGPU(): Promise<void> {
    try {
      const { device, presentFormat } = await ensureWebGPUDevice();
      this.device = device;
      this.presentFormat = presentFormat;

      this.context = (this.canvas as any).getContext('webgpu');
      if (!this.context) throw new Error('canvas.getContext("webgpu") returned null');
      this.context.configure({
        device: this.device,
        format: this.presentFormat,
        // 'premultiplied' so the canvas itself participates in alpha
        // blending — lets GhostFX sit on top of other layers when its
        // bg pass is skipped (bgAlpha = 0). Composite shader writes
        // premultiplied pixels (rgb * alpha, alpha).
        alphaMode: 'premultiplied',
      });

      // Uniform buffers — UNIFORM | COPY_DST is the standard combo.
      this.sceneUniformBuffer = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'ghostfx:sceneUniforms',
      });
      this.postUniformBuffer = this.device.createBuffer({
        size: POST_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'ghostfx:postUniforms',
      });

      // Linear-clamp sampler shared by all post passes — clamp avoids
      // wrapping artifacts at screen edges during blur.
      this.linearSampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      this._allocateTextures();
      await this._buildPostPipelines();
      await this._buildScenePipeline();
      this.ready = true;
    } catch (e) {
      console.warn('[GhostFX] WebGPU init failed', e);
      this.ready = false;
    }
  }

  /** (Re)allocate the HDR offscreen textures + their views + the
   *  bind groups that reference them. Called on init and on resize. */
  private _allocateTextures(): void {
    if (!this.device) return;
    // Destroy old (idempotent)
    try { this.sceneTex?.destroy(); } catch {}
    try { this.bloomTexA?.destroy(); } catch {}
    try { this.bloomTexB?.destroy(); } catch {}

    this.texWidth = this.width;
    this.texHeight = this.height;
    const halfW = Math.max(1, Math.floor(this.width / 2));
    const halfH = Math.max(1, Math.floor(this.height / 2));

    // rgba16float lets HDR values > 1.0 pass through to the bright
    // pass. rgba8 would clamp before bloom, defeating the purpose.
    const HDR = 'rgba16float';
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

    this.sceneTex  = this.device.createTexture({ size: [this.width, this.height], format: HDR, usage, label: 'ghostfx:sceneTex' });
    this.bloomTexA = this.device.createTexture({ size: [halfW, halfH],            format: HDR, usage, label: 'ghostfx:bloomA' });
    this.bloomTexB = this.device.createTexture({ size: [halfW, halfH],            format: HDR, usage, label: 'ghostfx:bloomB' });

    this.sceneTexView  = this.sceneTex.createView();
    this.bloomTexAView = this.bloomTexA.createView();
    this.bloomTexBView = this.bloomTexB.createView();

    // Re-bind any post bind groups that reference these textures.
    // (Pipelines are unchanged; only the bindings shift.)
    this._rebuildPostBindGroups();
  }

  private async _buildPostPipelines(): Promise<void> {
    if (!this.device) return;
    const module = this.device.createShaderModule({ code: POST_WGSL, label: 'ghostfx:post' });
    const info = await module.getCompilationInfo?.();
    const errs = (info?.messages ?? []).filter((m: any) => m.type === 'error');
    if (errs.length) {
      for (const m of errs) console.error(`[GhostFX] WGSL post ${m.lineNum}:${m.linePos}: ${m.message}`);
      throw new Error('post shader compile failed');
    }
    const HDR = 'rgba16float';

    // Explicit shared bind group layout for all post passes. With
    // layout: 'auto' each pipeline derives its OWN layout from what
    // its fragment shader reads — those layouts then disagree on
    // which bindings exist, and any bind group that doesn't exactly
    // match the layout (extra entries OR missing entries) is
    // invalid. Building one shared layout sidesteps the entire
    // class of "this entry isn't in the layout" bugs.
    const postBindLayout = this.device.createBindGroupLayout({
      label: 'ghostfx:postBindLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    const postPipelineLayout = this.device.createPipelineLayout({
      label: 'ghostfx:postPipelineLayout',
      bindGroupLayouts: [postBindLayout],
    });
    // Stash for bind group construction.
    this._postBindLayout = postBindLayout;

    this.postExtractPipeline = this.device.createRenderPipeline({
      layout: postPipelineLayout, label: 'ghostfx:extract+hBlur',
      vertex:   { module, entryPoint: 'vsMain' },
      fragment: { module, entryPoint: 'fsExtractHBlur', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list' },
    });
    this.postBlurVPipeline = this.device.createRenderPipeline({
      layout: postPipelineLayout, label: 'ghostfx:vBlur',
      vertex:   { module, entryPoint: 'vsMain' },
      fragment: { module, entryPoint: 'fsVBlur', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list' },
    });
    this.postCompositePipeline = this.device.createRenderPipeline({
      layout: postPipelineLayout, label: 'ghostfx:composite',
      vertex:   { module, entryPoint: 'vsMain' },
      fragment: { module, entryPoint: 'fsComposite', targets: [{ format: this.presentFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    this._rebuildPostBindGroups();
  }

  /** Build (or rebuild) the bind groups for each post pass — needs
   *  to happen on init AND on any texture re-allocation since the
   *  views move. */
  private _rebuildPostBindGroups(): void {
    if (!this.device || !this.postExtractPipeline || !this.postBlurVPipeline || !this.postCompositePipeline) return;
    if (!this.sceneTexView || !this.bloomTexAView || !this.bloomTexBView) return;

    if (!this._postBindLayout) return;

    // Shared layout has all 4 bindings (uniforms, sampler, sceneTex,
    // bloomTex). Each pass binds whichever texture is real for that
    // pass; the shader only reads what it reads. The "dummy" texture
    // for an unused slot is just whichever live view is convenient.
    //
    // Per-shader USAGE (not binding presence):
    //   extract+hBlur reads sceneTex (binding 2); bloomTex slot is unused → dummy = sceneTex
    //   vBlur reads bloomTex (binding 3, hBlur output); sceneTex slot unused → dummy = bloomTexA
    //   composite reads both: scene + bloomTexB (vBlur output)

    // Wrap bind group creation in an error scope so the actual
    // validation message ("entry N's resource is incompatible with
    // layout entry N's type" etc.) surfaces instead of the opaque
    // downstream "Invalid BindGroup" error.
    this.device.pushErrorScope?.('validation');

    this.postExtractBindGroup = this.device.createBindGroup({
      layout: this._postBindLayout, label: 'ghostfx:extractBG',
      entries: [
        { binding: 0, resource: { buffer: this.postUniformBuffer } },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: this.sceneTexView },
        { binding: 3, resource: this.sceneTexView },  // dummy — shader doesn't read it
      ],
    });
    this.postBlurVBindGroup = this.device.createBindGroup({
      layout: this._postBindLayout, label: 'ghostfx:vBlurBG',
      entries: [
        { binding: 0, resource: { buffer: this.postUniformBuffer } },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: this.bloomTexAView }, // dummy — shader doesn't read it
        { binding: 3, resource: this.bloomTexAView }, // hBlur output (real)
      ],
    });
    this.postCompositeBindGroup = this.device.createBindGroup({
      layout: this._postBindLayout, label: 'ghostfx:compositeBG',
      entries: [
        { binding: 0, resource: { buffer: this.postUniformBuffer } },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: this.sceneTexView },
        { binding: 3, resource: this.bloomTexBView },
      ],
    });

    this.device.popErrorScope?.().then((err: any) => {
      if (err) console.error('[GhostFX] bind group validation error:', err.message);
    });
  }

  /** Surface WGSL compile errors with file:line:col instead of the
   *  opaque downstream "invalid pipeline" once a bad module is used.
   *  Returns true if the module compiled clean. */
  private async _checkModule(label: string, module: any): Promise<boolean> {
    try {
      const info = await module.getCompilationInfo?.();
      const errs = (info?.messages ?? []).filter((m: any) => m.type === 'error');
      if (errs.length) {
        for (const m of errs) {
          console.error(`[GhostFX] WGSL ${label} ${m.lineNum}:${m.linePos}: ${m.message}`);
        }
        return false;
      }
    } catch { /* older Chromium without getCompilationInfo — proceed */ }
    return true;
  }

  private async _buildScenePipeline(): Promise<void> {
    if (!this.device || !this.sceneUniformBuffer) return;
    const sceneId = this.params.scenePreset || 'drift';
    this.attemptedScene = sceneId;

    if (sceneId === 'drift') {
      // Drift uses two shader modules because WGSL forbids
      // `read_write` storage access in vertex/fragment stages — the
      // same buffer needs `read_write` for compute and `read` for
      // render. Two modules with the same binding numbers point at
      // the same buffer; the layout entry's `type: 'storage'` allows
      // both.
      const wgsl = buildDriftWgsl(DRIFT_PARTICLE_COUNT, DRIFT_TRAIL_LEN);
      const computeModule = this.device.createShaderModule({ code: wgsl.compute, label: 'ghostfx:drift:compute' });
      const renderModule  = this.device.createShaderModule({ code: wgsl.render,  label: 'ghostfx:drift:render' });
      const okC = await this._checkModule('drift:compute', computeModule);
      const okR = await this._checkModule('drift:render',  renderModule);
      if (!okC || !okR) { this.ready = false; return; }
      this._buildDriftPipelines(computeModule, renderModule);
      this.currentScene = sceneId;
      return;
    }

    if (sceneId === 'ribbons') {
      const wgsl = buildRibbonsWgsl(RIBBONS_COUNT, RIBBONS_TRAIL_LEN);
      const computeModule = this.device.createShaderModule({ code: wgsl.compute, label: 'ghostfx:ribbons:compute' });
      const renderModule  = this.device.createShaderModule({ code: wgsl.render,  label: 'ghostfx:ribbons:render' });
      const okC = await this._checkModule('ribbons:compute', computeModule);
      const okR = await this._checkModule('ribbons:render',  renderModule);
      if (!okC || !okR) { this.ready = false; return; }
      this._buildRibbonsPipelines(computeModule, renderModule);
      this.currentScene = sceneId;
      return;
    }

    if (sceneId === 'liquid') {
      // 7 modules: 6 compute + 1 render. Each is small so we compile
      // and check them all up front.
      const modSplat     = this.device.createShaderModule({ code: LIQUID_SPLAT_WGSL,       label: 'ghostfx:liquid:splat' });
      const modAdvectVel = this.device.createShaderModule({ code: LIQUID_ADVECT_VEL_WGSL,  label: 'ghostfx:liquid:advectVel' });
      const modDiv       = this.device.createShaderModule({ code: LIQUID_DIVERGENCE_WGSL,  label: 'ghostfx:liquid:divergence' });
      const modJacobi    = this.device.createShaderModule({ code: LIQUID_JACOBI_WGSL,      label: 'ghostfx:liquid:jacobi' });
      const modSubtract  = this.device.createShaderModule({ code: LIQUID_SUBTRACT_WGSL,    label: 'ghostfx:liquid:subtract' });
      const modAdvectDye = this.device.createShaderModule({ code: LIQUID_ADVECT_DYE_WGSL,  label: 'ghostfx:liquid:advectDye' });
      const modRender    = this.device.createShaderModule({ code: LIQUID_RENDER_WGSL,      label: 'ghostfx:liquid:render' });
      const checks = await Promise.all([
        this._checkModule('liquid:splat',      modSplat),
        this._checkModule('liquid:advectVel',  modAdvectVel),
        this._checkModule('liquid:divergence', modDiv),
        this._checkModule('liquid:jacobi',     modJacobi),
        this._checkModule('liquid:subtract',   modSubtract),
        this._checkModule('liquid:advectDye',  modAdvectDye),
        this._checkModule('liquid:render',     modRender),
      ]);
      if (checks.some(ok => !ok)) { this.ready = false; return; }
      this._buildLiquidPipelines({ modSplat, modAdvectVel, modDiv, modJacobi, modSubtract, modAdvectDye, modRender });
      this.currentScene = sceneId;
      return;
    }

    // Single-module fallback for future scenes that follow the
    // original Liminal-style pattern.
    const wgsl = this._wgslForScene(sceneId);
    const module = this.device.createShaderModule({ code: wgsl, label: `ghostfx:${sceneId}` });
    if (!(await this._checkModule(sceneId, module))) { this.ready = false; return; }

    {
      // Generic single-pass fallback for future scenes that follow
      // the original Liminal-style pattern.
      const layoutOnlyUniforms = this.device.createBindGroupLayout({
        label: `ghostfx:${sceneId}:bindLayout`,
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      const pl = this.device.createPipelineLayout({ bindGroupLayouts: [layoutOnlyUniforms] });
      this.scenePipeline = this.device.createRenderPipeline({
        layout: pl, label: `ghostfx:${sceneId}`,
        vertex:   { module, entryPoint: 'vsMain' },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
      });
      this.particlePipeline = null;
      this.trailPipeline = null;
      this.latticePipeline = null;
      this.computePipeline = null;
      this.sceneBindGroup = this.device.createBindGroup({
        layout: layoutOnlyUniforms,
        entries: [{ binding: 0, resource: { buffer: this.sceneUniformBuffer } }],
      });
    }
    this.currentScene = sceneId;
  }

  /** Build all the Drift-scene pipelines: compute (advect), bg
   *  (fullscreen clear), trails (line list), particles (quad
   *  sprites), lattice (line list). All five pipelines share one
   *  bind group layout (uniforms + 2 storage buffers) and one bind
   *  group. */
  private _buildDriftPipelines(computeModule: any, renderModule: any): void {
    if (!this.device || !this.sceneUniformBuffer) return;

    // (Re)allocate storage buffers. Particle struct in WGSL std430:
    //   pos: vec3, age: f32, vel: vec3, seed: f32 → 32 B (16-aligned)
    // Trail entries are vec4<f32> = 16 B each.
    const PARTICLE_BYTES = DRIFT_PARTICLE_COUNT * 32;
    const TRAIL_BYTES = DRIFT_PARTICLE_COUNT * DRIFT_TRAIL_LEN * 16;
    if (!this.particleBuffer || this.particleBuffer.size !== PARTICLE_BYTES) {
      try { this.particleBuffer?.destroy(); } catch {}
      this.particleBuffer = this.device.createBuffer({
        size: PARTICLE_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'ghostfx:drift:particles',
      });
      // Init to all zeros — compute kicks newborn particles (seed==0)
      // through respawn() on first frame so we never see uninitialized
      // pixel garbage.
      const init = new ArrayBuffer(PARTICLE_BYTES);
      this.device.queue.writeBuffer(this.particleBuffer, 0, init);
    }
    if (!this.trailBuffer || this.trailBuffer.size !== TRAIL_BYTES) {
      try { this.trailBuffer?.destroy(); } catch {}
      this.trailBuffer = this.device.createBuffer({
        size: TRAIL_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'ghostfx:drift:trails',
      });
    }

    // WebGPU rule: a BindGroupLayout entry with buffer.type 'storage'
    // (writable) is NOT allowed to include Vertex visibility — only
    // 'read-only-storage' may be visible to Vertex. So even though
    // WGSL lets us declare the same binding as read_write in compute
    // and read in render, the BindGroupLayouts must differ.
    //
    // Solution: TWO layouts + TWO pipeline layouts + TWO bind groups,
    // all backed by the same underlying buffers.
    //
    //   computeBindLayout — storage (rw) + uniform, COMPUTE visibility
    //   renderBindLayout  — read-only-storage + uniform, VERTEX|FRAGMENT
    const driftComputeBindLayout = this.device.createBindGroupLayout({
      label: 'ghostfx:drift:computeBindLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const driftRenderBindLayout = this.device.createBindGroupLayout({
      label: 'ghostfx:drift:renderBindLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const driftComputePipelineLayout = this.device.createPipelineLayout({
      label: 'ghostfx:drift:computePipelineLayout',
      bindGroupLayouts: [driftComputeBindLayout],
    });
    const driftRenderPipelineLayout = this.device.createPipelineLayout({
      label: 'ghostfx:drift:renderPipelineLayout',
      bindGroupLayouts: [driftRenderBindLayout],
    });

    // 1. Compute — advect particles, age them, shift trail. Uses
    //    the compute module (read_write storage access) + compute layout.
    this.computePipeline = this.device.createComputePipeline({
      layout: driftComputePipelineLayout, label: 'ghostfx:drift:csAdvect',
      compute: { module: computeModule, entryPoint: 'csAdvect' },
    });

    // 2. Background — fullscreen tri, clears sceneTex. Uses render
    //    module + render layout (read-only storage access).
    this.scenePipeline = this.device.createRenderPipeline({
      layout: driftRenderPipelineLayout, label: 'ghostfx:drift:bg',
      vertex:   { module: renderModule, entryPoint: 'vsBg' },
      fragment: { module: renderModule, entryPoint: 'fsBg', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });

    // 3. Trails — line topology, additive
    this.trailPipeline = this.device.createRenderPipeline({
      layout: driftRenderPipelineLayout, label: 'ghostfx:drift:trails',
      vertex:   { module: renderModule, entryPoint: 'vsTrail' },
      fragment: {
        module: renderModule, entryPoint: 'fsTrail',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
    });

    // 4. Particle sprites — instanced quads, additive
    this.particlePipeline = this.device.createRenderPipeline({
      layout: driftRenderPipelineLayout, label: 'ghostfx:drift:particles',
      vertex:   { module: renderModule, entryPoint: 'vsParticle' },
      fragment: {
        module: renderModule, entryPoint: 'fsParticle',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // 5. Lattice — line topology, additive
    this.latticePipeline = this.device.createRenderPipeline({
      layout: driftRenderPipelineLayout, label: 'ghostfx:drift:lattice',
      vertex:   { module: renderModule, entryPoint: 'vsLattice' },
      fragment: {
        module: renderModule, entryPoint: 'fsLattice',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
    });

    // Two bind groups backed by the same buffers — one per layout.
    // Compute pass binds driftComputeBindGroup; render passes bind
    // sceneBindGroup.
    this.driftComputeBindGroup = this.device.createBindGroup({
      layout: driftComputeBindLayout, label: 'ghostfx:drift:computeBindGroup',
      entries: [
        { binding: 0, resource: { buffer: this.sceneUniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
        { binding: 2, resource: { buffer: this.trailBuffer } },
      ],
    });
    this.sceneBindGroup = this.device.createBindGroup({
      layout: driftRenderBindLayout, label: 'ghostfx:drift:renderBindGroup',
      entries: [
        { binding: 0, resource: { buffer: this.sceneUniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
        { binding: 2, resource: { buffer: this.trailBuffer } },
      ],
    });

    // Per-scene draw bookkeeping: Drift = instanced quads.
    this._particleVertCount = 6;
    this._particleInstCount = DRIFT_PARTICLE_COUNT;
    this._computeDispatchCount = Math.ceil(DRIFT_PARTICLE_COUNT / 64);
  }

  /** Build the Ribbons-scene pipelines: compute (advect + audio-gated
   *  spawn) + bg + ribbons (camera-facing quad strip). No trails (the
   *  quad strip IS the trail) and no lattice. */
  private _buildRibbonsPipelines(computeModule: any, renderModule: any): void {
    if (!this.device || !this.sceneUniformBuffer) return;

    const PARTICLE_BYTES = RIBBONS_COUNT * 32;
    const TRAIL_BYTES = RIBBONS_COUNT * RIBBONS_TRAIL_LEN * 16;
    if (!this.particleBuffer || this.particleBuffer.size !== PARTICLE_BYTES) {
      try { this.particleBuffer?.destroy(); } catch {}
      this.particleBuffer = this.device.createBuffer({
        size: PARTICLE_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'ghostfx:ribbons:particles',
      });
      // Init zeros so all ribbons start dead (seed==0), then the
      // compute shader probabilistically spawns them as audio drives.
      const init = new ArrayBuffer(PARTICLE_BYTES);
      this.device.queue.writeBuffer(this.particleBuffer, 0, init);
    }
    if (!this.trailBuffer || this.trailBuffer.size !== TRAIL_BYTES) {
      try { this.trailBuffer?.destroy(); } catch {}
      this.trailBuffer = this.device.createBuffer({
        size: TRAIL_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'ghostfx:ribbons:trails',
      });
      // Init to a sentinel "dead trail" (w = -1) so dead ribbons
      // emit degenerate vertices instead of drawing through (0,0,0).
      const init = new Float32Array(TRAIL_BYTES / 4);
      for (let i = 0; i < init.length; i += 4) {
        init[i + 0] = 1e4; init[i + 1] = 1e4; init[i + 2] = 1e4; init[i + 3] = -1;
      }
      this.device.queue.writeBuffer(this.trailBuffer, 0, init);
    }

    // Same compute / render bind layout split as Drift.
    const computeBL = this.device.createBindGroupLayout({
      label: 'ghostfx:ribbons:computeBindLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const renderBL = this.device.createBindGroupLayout({
      label: 'ghostfx:ribbons:renderBindLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const computePL = this.device.createPipelineLayout({
      label: 'ghostfx:ribbons:computePipelineLayout', bindGroupLayouts: [computeBL],
    });
    const renderPL = this.device.createPipelineLayout({
      label: 'ghostfx:ribbons:renderPipelineLayout', bindGroupLayouts: [renderBL],
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: computePL, label: 'ghostfx:ribbons:csAdvect',
      compute: { module: computeModule, entryPoint: 'csAdvect' },
    });
    this.scenePipeline = this.device.createRenderPipeline({
      layout: renderPL, label: 'ghostfx:ribbons:bg',
      vertex:   { module: renderModule, entryPoint: 'vsBg' },
      fragment: { module: renderModule, entryPoint: 'fsBg', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    // Three ribbon pipelines, one per blend mode. Same vertex/fragment
    // entry points — only the blend state differs. render() picks the
    // active one each frame from params.ribbonBlend.
    const mkRibbonPipeline = (label: string, blend: any) => this.device.createRenderPipeline({
      layout: renderPL, label,
      vertex:   { module: renderModule, entryPoint: 'vsRibbon' },
      fragment: {
        module: renderModule, entryPoint: 'fsRibbon',
        targets: [{ format: 'rgba16float', blend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this._ribbonPipelines = {
      // Additive: pure glow — back ribbons add to front. Brightest mode.
      additive: mkRibbonPipeline('ghostfx:ribbons:strip:additive', {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
      }),
      // Lighten: per-channel max(src, dst). Ribbons cleanly punch
      // through whatever's underneath — no additive blowout, no muddy
      // stacking. Best fit for the colored-palette aurora aesthetic.
      // Note: srcFactor/dstFactor are ignored when operation is min/max.
      lighten: mkRibbonPipeline('ghostfx:ribbons:strip:lighten', {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
      }),
      // Glass: alpha-blended translucency. Back ribbons partially
      // visible THROUGH front (requires translucency > 0). No depth
      // sort, so ribbon ordering is whatever-came-first — that's OK
      // for a wispy aurora look.
      glass: mkRibbonPipeline('ghostfx:ribbons:strip:glass', {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }),
    };
    this.particlePipeline = this._ribbonPipelines.additive;  // default; render() updates
    // No separate trail / lattice for Ribbons — quad strip is the trail.
    this.trailPipeline = null;
    this.latticePipeline = null;

    this.driftComputeBindGroup = this.device.createBindGroup({
      layout: computeBL, label: 'ghostfx:ribbons:computeBindGroup',
      entries: [
        { binding: 0, resource: { buffer: this.sceneUniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
        { binding: 2, resource: { buffer: this.trailBuffer } },
      ],
    });
    this.sceneBindGroup = this.device.createBindGroup({
      layout: renderBL, label: 'ghostfx:ribbons:renderBindGroup',
      entries: [
        { binding: 0, resource: { buffer: this.sceneUniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
        { binding: 2, resource: { buffer: this.trailBuffer } },
      ],
    });

    // Ribbons: single huge draw of all quad-strip vertices.
    this._particleVertCount = RIBBONS_COUNT * (RIBBONS_TRAIL_LEN - 1) * 6;
    this._particleInstCount = 1;
    this._computeDispatchCount = Math.ceil(RIBBONS_COUNT / 64);
  }

  /** Build the Liquid-scene pipelines: a 2D fluid sim. Allocates
   *  ping-pong storage textures (velocity, dye, pressure) + a single
   *  divergence texture, builds 6 compute pipelines + 1 render
   *  pipeline (which doubles as scenePipeline so the bg pass renders
   *  the dye to sceneTex). Pre-builds per-pass bind groups in both
   *  ping-pong directions. */
  private _buildLiquidPipelines(mods: {
    modSplat: any; modAdvectVel: any; modDiv: any; modJacobi: any;
    modSubtract: any; modAdvectDye: any; modRender: any;
  }): void {
    if (!this.device) return;

    const simW = LIQUID_SIM_W;
    const simH = Math.max(8, Math.round(LIQUID_SIM_W * this.height / Math.max(this.width, 1)));

    // ─── Textures + sampler ───────────────────────────────────────
    // WebGPU only allows write-storage access on a fixed format set
    // (rgba8unorm, rgba16float, r32float, rg32float, rgba32float,
    // bgra8unorm, ...). rg16float and r16float aren't in that set
    // without optional features, so we use rgba16float for everything
    // and ignore the unused channels. ~8 bytes/pixel × 384×216 ≈ 660KB
    // per ping-pong texture — totally fine.
    const mkTex = (label: string) => this.device.createTexture({
      label, size: [simW, simH],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const mkVel = mkTex;
    const mkDye = mkTex;
    const mkR = mkTex;
    const velA = mkVel('ghostfx:liquid:velA');
    const velB = mkVel('ghostfx:liquid:velB');
    const dyeA = mkDye('ghostfx:liquid:dyeA');
    const dyeB = mkDye('ghostfx:liquid:dyeB');
    const presA = mkR('ghostfx:liquid:presA');
    const presB = mkR('ghostfx:liquid:presB');
    const div = mkR('ghostfx:liquid:div');
    const sampler = this.device.createSampler({
      label: 'ghostfx:liquid:sampler',
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    this._liquidTextures = {
      velA, velB, dyeA, dyeB, presA, presB, div,
      velAView: velA.createView(), velBView: velB.createView(),
      dyeAView: dyeA.createView(), dyeBView: dyeB.createView(),
      presAView: presA.createView(), presBView: presB.createView(),
      divView: div.createView(),
      sampler, simW, simH,
    };

    // ─── Uniform + splat buffers ──────────────────────────────────
    if (this._liquidUniformBuffer) { try { this._liquidUniformBuffer.destroy(); } catch {} }
    this._liquidUniformBuffer = this.device.createBuffer({
      size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'ghostfx:liquid:uniforms',
    });
    if (this._liquidSplatBuffer) { try { this._liquidSplatBuffer.destroy(); } catch {} }
    this._liquidSplatBuffer = this.device.createBuffer({
      size: LIQUID_MAX_SPLATS * LIQUID_SPLAT_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'ghostfx:liquid:splats',
    });

    // ─── Bind layouts ─────────────────────────────────────────────
    // Each pass has its own. Uniform at binding(0). Sampled textures
    // use type 'unfilterable-float' since rg16float / rgba16float /
    // r16float are unfilterable in compute storage view. (We do
    // manual bilinear in WGSL — see sampleBilinear in liquid common.)
    const stages = { compute: GPUShaderStage.COMPUTE, frag: GPUShaderStage.FRAGMENT, vert: GPUShaderStage.VERTEX };
    const ub = { type: 'uniform' as const };
    const sb = { type: 'read-only-storage' as const };
    const texF = { sampleType: 'unfilterable-float' as const };
    const texFilt = { sampleType: 'float' as const };  // for render pass (sampled via sampler)

    const splatBL = this.device.createBindGroupLayout({
      label: 'ghostfx:liquid:splat:bl',
      entries: [
        { binding: 0, visibility: stages.compute, buffer: ub },
        { binding: 1, visibility: stages.compute, buffer: sb },
        { binding: 2, visibility: stages.compute, texture: texF },
        { binding: 3, visibility: stages.compute, texture: texF },
        { binding: 4, visibility: stages.compute, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 5, visibility: stages.compute, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const advVelBL = this.device.createBindGroupLayout({
      label: 'ghostfx:liquid:advectVel:bl',
      entries: [
        { binding: 0, visibility: stages.compute, buffer: ub },
        { binding: 1, visibility: stages.compute, texture: texF },
        { binding: 2, visibility: stages.compute, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const divBL = this.device.createBindGroupLayout({
      label: 'ghostfx:liquid:divergence:bl',
      entries: [
        { binding: 0, visibility: stages.compute, buffer: ub },
        { binding: 1, visibility: stages.compute, texture: texF },
        { binding: 2, visibility: stages.compute, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const jacobiBL = this.device.createBindGroupLayout({
      label: 'ghostfx:liquid:jacobi:bl',
      entries: [
        { binding: 0, visibility: stages.compute, buffer: ub },
        { binding: 1, visibility: stages.compute, texture: texF },
        { binding: 2, visibility: stages.compute, texture: texF },
        { binding: 3, visibility: stages.compute, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const subBL = this.device.createBindGroupLayout({
      label: 'ghostfx:liquid:subtract:bl',
      entries: [
        { binding: 0, visibility: stages.compute, buffer: ub },
        { binding: 1, visibility: stages.compute, texture: texF },
        { binding: 2, visibility: stages.compute, texture: texF },
        { binding: 3, visibility: stages.compute, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const advDyeBL = this.device.createBindGroupLayout({
      label: 'ghostfx:liquid:advectDye:bl',
      entries: [
        { binding: 0, visibility: stages.compute, buffer: ub },
        { binding: 1, visibility: stages.compute, texture: texF },
        { binding: 2, visibility: stages.compute, texture: texF },
        { binding: 3, visibility: stages.compute, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const renderBL = this.device.createBindGroupLayout({
      label: 'ghostfx:liquid:render:bl',
      entries: [
        { binding: 0, visibility: stages.vert | stages.frag, buffer: ub },
        { binding: 1, visibility: stages.frag, texture: texFilt },
        { binding: 2, visibility: stages.frag, sampler: { type: 'filtering' } },
      ],
    });

    // ─── Pipelines ────────────────────────────────────────────────
    const mkComputePL = (label: string, bl: any) => this.device.createPipelineLayout({ label, bindGroupLayouts: [bl] });
    const mkCompute = (label: string, bl: any, module: any, entryPoint: string) =>
      this.device.createComputePipeline({ label, layout: mkComputePL(`${label}:pl`, bl), compute: { module, entryPoint } });

    this._liquidPipelines = {
      splat:            mkCompute('ghostfx:liquid:splat',            splatBL,   mods.modSplat,     'csSplat'),
      advectVel:        mkCompute('ghostfx:liquid:advectVel',        advVelBL,  mods.modAdvectVel, 'csAdvectVel'),
      divergence:       mkCompute('ghostfx:liquid:divergence',       divBL,     mods.modDiv,       'csDivergence'),
      jacobi:           mkCompute('ghostfx:liquid:jacobi',           jacobiBL,  mods.modJacobi,    'csJacobi'),
      subtractGradient: mkCompute('ghostfx:liquid:subtractGradient', subBL,     mods.modSubtract,  'csSubtractGradient'),
      advectDye:        mkCompute('ghostfx:liquid:advectDye',        advDyeBL,  mods.modAdvectDye, 'csAdvectDye'),
      render: this.device.createRenderPipeline({
        label: 'ghostfx:liquid:render',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [renderBL] }),
        vertex:   { module: mods.modRender, entryPoint: 'vsRender' },
        fragment: { module: mods.modRender, entryPoint: 'fsRender', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
      }),
    };
    // scenePipeline replaced with the liquid render pipeline — the
    // render() bg pass will pick it up and draw dye to sceneTex.
    this.scenePipeline = this._liquidPipelines.render;

    // ─── Per-pass bind groups (both ping-pong directions) ─────────
    const T = this._liquidTextures;
    const U = this._liquidUniformBuffer;
    const SP = this._liquidSplatBuffer;

    // splat: read both vel + dye, write the OPPOSITE side.
    const mkSplatBG = (rVel: any, rDye: any, wVel: any, wDye: any, label: string) => this.device.createBindGroup({
      label, layout: splatBL, entries: [
        { binding: 0, resource: { buffer: U } },
        { binding: 1, resource: { buffer: SP } },
        { binding: 2, resource: rVel },
        { binding: 3, resource: rDye },
        { binding: 4, resource: wVel },
        { binding: 5, resource: wDye },
      ],
    });
    const mkAdvVelBG = (rVel: any, wVel: any, label: string) => this.device.createBindGroup({
      label, layout: advVelBL, entries: [
        { binding: 0, resource: { buffer: U } },
        { binding: 1, resource: rVel },
        { binding: 2, resource: wVel },
      ],
    });
    const mkDivBG = (rVel: any, label: string) => this.device.createBindGroup({
      label, layout: divBL, entries: [
        { binding: 0, resource: { buffer: U } },
        { binding: 1, resource: rVel },
        { binding: 2, resource: T.divView },
      ],
    });
    const mkJacobiBG = (rPres: any, wPres: any, label: string) => this.device.createBindGroup({
      label, layout: jacobiBL, entries: [
        { binding: 0, resource: { buffer: U } },
        { binding: 1, resource: rPres },
        { binding: 2, resource: T.divView },
        { binding: 3, resource: wPres },
      ],
    });
    const mkSubBG = (rVel: any, rPres: any, wVel: any, label: string) => this.device.createBindGroup({
      label, layout: subBL, entries: [
        { binding: 0, resource: { buffer: U } },
        { binding: 1, resource: rVel },
        { binding: 2, resource: rPres },
        { binding: 3, resource: wVel },
      ],
    });
    const mkAdvDyeBG = (rDye: any, rVel: any, wDye: any, label: string) => this.device.createBindGroup({
      label, layout: advDyeBL, entries: [
        { binding: 0, resource: { buffer: U } },
        { binding: 1, resource: rDye },
        { binding: 2, resource: rVel },
        { binding: 3, resource: wDye },
      ],
    });
    const mkRenderBG = (rDye: any, label: string) => this.device.createBindGroup({
      label, layout: renderBL, entries: [
        { binding: 0, resource: { buffer: U } },
        { binding: 1, resource: rDye },
        { binding: 2, resource: T.sampler },
      ],
    });

    this._liquidBindGroups = {
      // splat: 4 combos (vel parity × dye parity). Each writes to the
      // opposite side of what it reads.
      splat_vA_dA: mkSplatBG(T.velAView, T.dyeAView, T.velBView, T.dyeBView, 'splat:vA_dA'),
      splat_vA_dB: mkSplatBG(T.velAView, T.dyeBView, T.velBView, T.dyeAView, 'splat:vA_dB'),
      splat_vB_dA: mkSplatBG(T.velBView, T.dyeAView, T.velAView, T.dyeBView, 'splat:vB_dA'),
      splat_vB_dB: mkSplatBG(T.velBView, T.dyeBView, T.velAView, T.dyeAView, 'splat:vB_dB'),
      // advectVel: 2 combos (vel parity only)
      advectVelAB: mkAdvVelBG(T.velAView, T.velBView, 'advectVel:AB'),
      advectVelBA: mkAdvVelBG(T.velBView, T.velAView, 'advectVel:BA'),
      // divergence: 2 combos
      divergenceA: mkDivBG(T.velAView, 'div:A'),
      divergenceB: mkDivBG(T.velBView, 'div:B'),
      // jacobi: 2 combos (pressure parity)
      jacobiAB: mkJacobiBG(T.presAView, T.presBView, 'jacobi:AB'),
      jacobiBA: mkJacobiBG(T.presBView, T.presAView, 'jacobi:BA'),
      // subtract: 2 combos (vel parity; pres always at A after even iters)
      subtractAB: mkSubBG(T.velAView, T.presAView, T.velBView, 'subtract:AB'),
      subtractBA: mkSubBG(T.velBView, T.presAView, T.velAView, 'subtract:BA'),
      // advectDye: 4 combos (vel parity × dye parity)
      advectDye_vA_dA: mkAdvDyeBG(T.dyeAView, T.velAView, T.dyeBView, 'advectDye:vA_dA'),
      advectDye_vA_dB: mkAdvDyeBG(T.dyeBView, T.velAView, T.dyeAView, 'advectDye:vA_dB'),
      advectDye_vB_dA: mkAdvDyeBG(T.dyeAView, T.velBView, T.dyeBView, 'advectDye:vB_dA'),
      advectDye_vB_dB: mkAdvDyeBG(T.dyeBView, T.velBView, T.dyeAView, 'advectDye:vB_dB'),
      // render: 2 combos (which dye to sample)
      renderA: mkRenderBG(T.dyeAView, 'render:A'),
      renderB: mkRenderBG(T.dyeBView, 'render:B'),
    };

    // Liquid uses neither particle/trail/lattice nor the compute
    // dispatch slot — the bg pass IS the entire scene draw.
    this.particlePipeline = null;
    this.trailPipeline = null;
    this.latticePipeline = null;
    this.computePipeline = null;  // Liquid has its own multi-pass compute (run in render())
    this._particleVertCount = 0;
    this._particleInstCount = 0;
    this._computeDispatchCount = 0;
    // For the bg pass, scenePipeline (=liquid render) needs a bind
    // group with the dye texture. Switch this per frame in render().
    this.sceneBindGroup = this._liquidBindGroups.renderA;

    // Reset ping-pong + clear textures by writing zeros
    this._liquidVelIsA = true;
    this._liquidDyeIsA = true;
    this._liquidPrevBeatPulse = 0;
    this._liquidAmbientAcc = 0;
  }

  /** Liquid splat scheduler — turns audio events into queued splats.
   *  Beats spawn big colored drops; bass adds a steady trickle. The
   *  fluid sim does the rest. Returns count packed into splat buffer. */
  private _scheduleLiquidSplats(s: { bassSlow: number; energy: number; beatPulse: number }, dt: number): number {
    const buf = this._liquidSplatCpu;
    let n = 0;

    const hsv2rgb = (h: number, sat: number, val: number) => {
      const i = Math.floor(h * 6);
      const f = h * 6 - i;
      const p = val * (1 - sat);
      const q = val * (1 - f * sat);
      const t = val * (1 - (1 - f) * sat);
      switch (i % 6) {
        case 0: return [val, t, p];
        case 1: return [q, val, p];
        case 2: return [p, val, t];
        case 3: return [p, q, val];
        case 4: return [t, p, val];
        default: return [val, p, q];
      }
    };
    const addSplat = (cx: number, cy: number, vx: number, vy: number, r: number, g: number, b: number, radius: number) => {
      if (n >= LIQUID_MAX_SPLATS) return;
      const o = n * 8;
      buf[o + 0] = cx; buf[o + 1] = cy;
      buf[o + 2] = vx; buf[o + 3] = vy;
      buf[o + 4] = r;  buf[o + 5] = g; buf[o + 6] = b;
      buf[o + 7] = radius;
      n++;
    };

    // Beat onset → 1-2 big splats with palette colors
    if (s.beatPulse > 0.5 && this._liquidPrevBeatPulse < 0.3) {
      const burstCount = 1 + (s.energy > 0.4 ? 1 : 0);
      for (let i = 0; i < burstCount; i++) {
        const hue = (this.accHue + Math.random() * 0.4) % 1;
        const [r, g, b] = hsv2rgb(hue, 0.9, 1.0);
        const pos = [Math.random(), Math.random()];
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.4 + s.energy * 0.8;
        addSplat(pos[0], pos[1], Math.cos(angle) * speed, Math.sin(angle) * speed,
                 r, g, b, this.params.liquidSplatRadius * 1.4);
      }
    }
    this._liquidPrevBeatPulse = s.beatPulse;

    // Bass-driven ambient trickle
    this._liquidAmbientAcc += dt * (0.8 + s.bassSlow * 10) * Math.max(this.params.liquidBassRate, 0);
    while (this._liquidAmbientAcc > 1 && n < LIQUID_MAX_SPLATS) {
      this._liquidAmbientAcc -= 1;
      const hue = (this.accHue + Math.random() * 0.6) % 1;
      const [r, g, b] = hsv2rgb(hue, 0.75, 0.95);
      const pos = [Math.random(), Math.random()];
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.15 + s.energy * 0.3;
      addSplat(pos[0], pos[1], Math.cos(angle) * speed, Math.sin(angle) * speed,
               r, g, b, this.params.liquidSplatRadius * (0.5 + Math.random() * 0.5));
    }

    // Write to GPU (only the active prefix; the rest is unread).
    if (n > 0) {
      this.device.queue.writeBuffer(this._liquidSplatBuffer, 0, buf.buffer, 0, n * LIQUID_SPLAT_STRIDE);
    }
    return n;
  }

  /** Write the per-frame Liquid uniform buffer. */
  private _writeLiquidUniforms(s: any, dt: number, numSplats: number): void {
    const T = this._liquidTextures!;
    const f = this._liquidUniformF32;
    const u = this._liquidUniformU32;
    f[0] = T.simW; f[1] = T.simH;
    f[2] = this.width; f[3] = this.height;
    f[4] = (performance.now() - this.timeStart) / 1000;
    f[5] = dt;
    f[6] = s.bassSlow; f[7] = s.midSlow; f[8] = s.trebSlow; f[9] = s.energy;
    f[10] = s.beatPhase; f[11] = s.beatPulse; f[12] = this.accHue; f[13] = this.params.exposure;
    f[14] = this.params.liquidSplatForce;
    f[15] = this.params.liquidSplatRadius;
    f[16] = this.params.liquidDyeDecay;
    f[17] = this.params.liquidVelDecay;
    u[18] = numSplats;
    // [19..23] = pad
    this.device.queue.writeBuffer(this._liquidUniformBuffer, 0, this._liquidUniformCpu);
  }

  /** Encode all 6 Liquid compute passes (splat → advect vel → div →
   *  jacobi×N → subtract → advect dye) into the given command encoder.
   *  Updates this.sceneBindGroup to point at the post-advect dye
   *  texture so the bg render pass shows the latest frame. */
  private _renderLiquid(encoder: any, s: any, dt: number): void {
    if (!this._liquidPipelines || !this._liquidBindGroups || !this._liquidTextures) return;
    const P = this._liquidPipelines;
    const G = this._liquidBindGroups;
    const T = this._liquidTextures;

    const numSplats = this._scheduleLiquidSplats(s, dt);
    this._writeLiquidUniforms(s, dt, numSplats);

    const wgX = Math.ceil(T.simW / 8);
    const wgY = Math.ceil(T.simH / 8);

    const cp = encoder.beginComputePass({ label: 'ghostfx:liquid' });

    // 1. Splat (only if there are splats to inject — saves a dispatch
    //    on silent frames). Even with 0 splats the shader runs OK; we
    //    just skip to save GPU work.
    if (numSplats > 0) {
      cp.setPipeline(P.splat);
      let splatBG: any;
      if (this._liquidVelIsA && this._liquidDyeIsA)         splatBG = G.splat_vA_dA;
      else if (this._liquidVelIsA && !this._liquidDyeIsA)   splatBG = G.splat_vA_dB;
      else if (!this._liquidVelIsA && this._liquidDyeIsA)   splatBG = G.splat_vB_dA;
      else                                                  splatBG = G.splat_vB_dB;
      cp.setBindGroup(0, splatBG);
      cp.dispatchWorkgroups(wgX, wgY);
      this._liquidVelIsA = !this._liquidVelIsA;
      this._liquidDyeIsA = !this._liquidDyeIsA;
    }

    // 2. Advect velocity
    cp.setPipeline(P.advectVel);
    cp.setBindGroup(0, this._liquidVelIsA ? G.advectVelAB : G.advectVelBA);
    cp.dispatchWorkgroups(wgX, wgY);
    this._liquidVelIsA = !this._liquidVelIsA;

    // 3. Divergence (reads current vel, no toggle)
    cp.setPipeline(P.divergence);
    cp.setBindGroup(0, this._liquidVelIsA ? G.divergenceA : G.divergenceB);
    cp.dispatchWorkgroups(wgX, wgY);

    // 4. Pressure Jacobi — even iter count so we end with pressure in A.
    // Start: read A, write B. After N (even), latest write is in A.
    for (let i = 0; i < LIQUID_JACOBI_ITERS; i++) {
      cp.setPipeline(P.jacobi);
      cp.setBindGroup(0, (i % 2 === 0) ? G.jacobiAB : G.jacobiBA);
      cp.dispatchWorkgroups(wgX, wgY);
    }

    // 5. Subtract gradient (pres always reads from A; vel ping-pong)
    cp.setPipeline(P.subtractGradient);
    cp.setBindGroup(0, this._liquidVelIsA ? G.subtractAB : G.subtractBA);
    cp.dispatchWorkgroups(wgX, wgY);
    this._liquidVelIsA = !this._liquidVelIsA;

    // 6. Advect dye through final velocity
    cp.setPipeline(P.advectDye);
    let advDyeBG: any;
    if (this._liquidVelIsA && this._liquidDyeIsA)         advDyeBG = G.advectDye_vA_dA;
    else if (this._liquidVelIsA && !this._liquidDyeIsA)   advDyeBG = G.advectDye_vA_dB;
    else if (!this._liquidVelIsA && this._liquidDyeIsA)   advDyeBG = G.advectDye_vB_dA;
    else                                                  advDyeBG = G.advectDye_vB_dB;
    cp.setBindGroup(0, advDyeBG);
    cp.dispatchWorkgroups(wgX, wgY);
    this._liquidDyeIsA = !this._liquidDyeIsA;

    cp.end();

    // Update sceneBindGroup so the bg render pass reads from the
    // freshly-advected dye texture.
    this.sceneBindGroup = this._liquidDyeIsA ? G.renderA : G.renderB;
  }

  /** Returns the WGSL source for single-module (fragment-only) scenes.
   *  Drift is handled directly in `_buildScenePipeline` because it
   *  needs two modules (compute + render with different storage
   *  access modes). Liquid will get the same special-case treatment.
   *
   *  Unknown ids fall through to a black passthrough — keeps the
   *  fallback render-pipeline path compilable while loudly indicating
   *  a missing scene.
   */
  private _wgslForScene(_id: string): string {
    // No fragment-only scenes registered. Ribbons / SDF Tunnel /
    // Nebula / Liquid all use specialised pipelines built directly
    // in _buildScenePipeline.
    return /* wgsl */ `
      struct Uniforms { resolution: vec2<f32> };
      @group(0) @binding(0) var<uniform> u: Uniforms;
      struct VsOut { @builtin(position) pos: vec4<f32> };
      @vertex fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
        let x = f32(((vid << 1u) & 2u));
        let y = f32(vid & 2u);
        var out: VsOut;
        out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
        return out;
      }
      @fragment fn fsMain() -> @location(0) vec4<f32> { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    `;
  }
}
