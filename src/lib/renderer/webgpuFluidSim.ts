/**
 * WebGPUFluidSim — real-time 2D incompressible-fluid simulation
 * (Stable Fluids, Jos Stam 1999) running entirely on GPU compute.
 *
 * The source texture (any layer's rendered output) acts as a
 * continuous DYE INJECTOR + FORCE source: bright pixels push the
 * velocity field outward + add their color to the dye. The result
 * is the source's colors swirling, billowing, and dissipating
 * realistically — like watercolor in a glass of water.
 *
 * This is a textbook GPU-compute showcase that's painful in WebGL
 * (you'd need 6+ ping-pong framebuffers and fragment-shader hacks)
 * but natural in WebGPU compute.
 *
 * ── Pipeline (per frame) ──
 *   1. injectFromSource — sample source texture, add to dye field
 *      and add velocity in directions of high-luminance gradient
 *   2. advectVelocity   — backward-advect velocity by itself
 *   3. divergence       — compute div(velocity) for pressure solve
 *   4. jacobi × N       — iterative Poisson solve for pressure
 *   5. subtractGradient — make velocity divergence-free
 *   6. advectDye        — backward-advect dye by velocity
 *   7. decay            — exponential fade of dye + velocity
 *
 * All passes are compute (workgroup_size 8x8). Grid is square,
 * default 256×256 — small enough to run multiple instances cheaply,
 * large enough to look detailed when upsampled to display.
 *
 * ── Field storage ──
 *   velocity: rgba16float (xy = vel.xy)        ping-pong A/B
 *   dye:      rgba16float (rgba = dye color)   ping-pong A/B
 *   divergence: r16float                       single
 *   pressure:   r16float                       ping-pong A/B
 *
 * ── External API ──
 *   create(device, gridSize)
 *   setSourceTexture(view)        — texture_2d<f32> view of input
 *   setParams(params)             — viscosity, vorticity, decay, ...
 *   step(dt)                       — encode one simulation step
 *   getDyeView()                  — current dye texture view (for output)
 *   getDyeFormat()
 *   reset()                        — clear all fields
 */

const GRID_DEFAULT = 256;
const PRESSURE_ITERATIONS = 25;          // Jacobi sweeps; 20–40 is the sweet spot
// Storage texture formats. Untyped because the project's tsconfig
// doesn't pull in @webgpu/types globals; runtime values are correct.
//
// NOTE on r32float vs r16float: WebGPU's standard storage-texture
// allowlist EXCLUDES r16float — only r32float, r32uint, r32sint
// are guaranteed for single-channel storage writes. We pay the 2x
// memory (still tiny: 256x256 × 4 bytes × 3 = 768KB total) for
// portability across all WebGPU implementations.
const VEL_FORMAT = 'rgba16float';
const DYE_FORMAT = 'rgba16float';
const SCALAR_FORMAT = 'r32float';

export interface FluidSimParams {
  injectStrength: number;     // how much source feeds dye + velocity (0..3)
  velocityFromGradient: number; // scales source-luminance gradient → velocity (0..3)
  viscosity: number;          // 0..0.01 — momentum diffusion
  dyeDecay: number;           // 0..1 per second — exponential fade
  velocityDecay: number;      // 0..1 per second
  vorticity: number;          // 0..3 — extra swirl confinement
  outputBoost: number;        // 1..4 — visual brightness multiplier on output
  // Time-stepping multiplier so users can slow / speed the sim
  // independently from rendering rate.
  timeScale: number;          // 0.1..3
}

const DEFAULT_PARAMS: FluidSimParams = {
  injectStrength: 1.0,
  velocityFromGradient: 1.0,
  viscosity: 0.0,
  dyeDecay: 0.4,
  velocityDecay: 0.6,
  vorticity: 1.5,
  outputBoost: 1.6,
  timeScale: 1.0,
};

// Combined WGSL — all compute shaders share the same struct + helpers.
// Each entrypoint is a separate compute pass.
const FLUID_WGSL = /* wgsl */ `
struct Globals {
  grid:        vec2<f32>,    // grid resolution (W, H)
  dt:          f32,
  time:        f32,
  inject:      f32,           // dye injection strength
  vel_grad:    f32,           // source-gradient → velocity strength
  visc:        f32,
  vort:        f32,
  dye_decay:   f32,           // per-step decay multiplier (precomputed JS-side)
  vel_decay:   f32,
  pad0:        f32,
  pad1:        f32,
};

@group(0) @binding(0) var<uniform>             u: Globals;
@group(0) @binding(1) var src_tex:             texture_2d<f32>;
@group(0) @binding(2) var src_samp:            sampler;
@group(0) @binding(3) var vel_in:              texture_2d<f32>;
@group(0) @binding(4) var vel_out:             texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var dye_in:              texture_2d<f32>;
@group(0) @binding(6) var dye_out:             texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var div_tex:             texture_2d<f32>;
@group(0) @binding(8) var div_out:             texture_storage_2d<r32float, write>;
@group(0) @binding(9) var p_in:                texture_2d<f32>;
@group(0) @binding(10) var p_out:              texture_storage_2d<r32float, write>;

fn lum(c: vec3<f32>) -> f32 {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Bilinear sample of a vec2 velocity from vel_in at pixel center uv.
// Manually written so we don't need a sampler bound to a texture_2d
// (storage textures + sampled textures need different binding types).
fn sampleVel(uv: vec2<f32>) -> vec2<f32> {
  let dim = vec2<f32>(textureDimensions(vel_in, 0));
  let p = uv * dim - 0.5;
  let p0 = vec2<i32>(floor(p));
  let p1 = p0 + vec2<i32>(1, 0);
  let p2 = p0 + vec2<i32>(0, 1);
  let p3 = p0 + vec2<i32>(1, 1);
  let f = p - vec2<f32>(p0);
  let imax = vec2<i32>(dim) - vec2<i32>(1);
  let v0 = textureLoad(vel_in, clamp(p0, vec2<i32>(0), imax), 0).xy;
  let v1 = textureLoad(vel_in, clamp(p1, vec2<i32>(0), imax), 0).xy;
  let v2 = textureLoad(vel_in, clamp(p2, vec2<i32>(0), imax), 0).xy;
  let v3 = textureLoad(vel_in, clamp(p3, vec2<i32>(0), imax), 0).xy;
  return mix(mix(v0, v1, f.x), mix(v2, v3, f.x), f.y);
}

fn sampleDye(uv: vec2<f32>) -> vec4<f32> {
  let dim = vec2<f32>(textureDimensions(dye_in, 0));
  let p = uv * dim - 0.5;
  let p0 = vec2<i32>(floor(p));
  let p1 = p0 + vec2<i32>(1, 0);
  let p2 = p0 + vec2<i32>(0, 1);
  let p3 = p0 + vec2<i32>(1, 1);
  let f = p - vec2<f32>(p0);
  let imax = vec2<i32>(dim) - vec2<i32>(1);
  let v0 = textureLoad(dye_in, clamp(p0, vec2<i32>(0), imax), 0);
  let v1 = textureLoad(dye_in, clamp(p1, vec2<i32>(0), imax), 0);
  let v2 = textureLoad(dye_in, clamp(p2, vec2<i32>(0), imax), 0);
  let v3 = textureLoad(dye_in, clamp(p3, vec2<i32>(0), imax), 0);
  return mix(mix(v0, v1, f.x), mix(v2, v3, f.x), f.y);
}

// ── 1. Inject from source ──
// Read existing velocity + dye, add source contribution. The source
// is sampled via the bound sampler (it can be any resolution,
// upsampled to grid size). Velocity contribution comes from the
// luminance GRADIENT direction: bright regions push outward.
@compute @workgroup_size(8, 8)
fn cs_inject(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(vel_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let uv = (vec2<f32>(p) + 0.5) / vec2<f32>(dim);

  let s_center = textureSampleLevel(src_tex, src_samp, uv, 0.0);
  let l_center = lum(s_center.rgb);

  // Luminance gradient as a 2D vector (central differences).
  let px = 1.0 / vec2<f32>(dim);
  let l_l = lum(textureSampleLevel(src_tex, src_samp, uv - vec2(px.x, 0.0), 0.0).rgb);
  let l_r = lum(textureSampleLevel(src_tex, src_samp, uv + vec2(px.x, 0.0), 0.0).rgb);
  let l_d = lum(textureSampleLevel(src_tex, src_samp, uv - vec2(0.0, px.y), 0.0).rgb);
  let l_u = lum(textureSampleLevel(src_tex, src_samp, uv + vec2(0.0, px.y), 0.0).rgb);
  let grad = vec2(l_r - l_l, l_u - l_d);

  // Existing fields
  let v_old = textureLoad(vel_in, p, 0).xy;
  let d_old = textureLoad(dye_in, p, 0);

  // Add velocity from gradient. Sign chosen so bright regions push
  // outward (gradient points uphill, we add it).
  let v_new = v_old + grad * u.vel_grad * u.dt * 60.0;

  // Add dye. Use the source color directly, scaled by injection
  // strength and luminance (so dark regions don't dump black dye).
  let inject_amount = clamp(l_center * u.inject * u.dt * 60.0, 0.0, 2.0);
  let d_new = d_old + s_center * inject_amount;

  textureStore(vel_out, p, vec4(v_new, 0.0, 0.0));
  textureStore(dye_out, p, d_new);
}

// ── 2. Advect velocity by itself ──
// Backward-advection: for each cell, look up where the fluid came
// FROM (one timestep ago) and copy that value to here. This is
// unconditionally stable — cornerstone of the Stable Fluids method.
@compute @workgroup_size(8, 8)
fn cs_advect_vel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(vel_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let uv = (vec2<f32>(p) + 0.5) / vec2<f32>(dim);

  let v = textureLoad(vel_in, p, 0).xy;
  let back_uv = uv - v * u.dt;
  let v_advected = sampleVel(clamp(back_uv, vec2(0.0), vec2(1.0)));
  // Apply velocity decay (precomputed multiplier).
  textureStore(vel_out, p, vec4(v_advected * u.vel_decay, 0.0, 0.0));
}

// ── 3. Compute divergence ──
@compute @workgroup_size(8, 8)
fn cs_divergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(div_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let imax = dim - vec2<i32>(1);
  let v_l = textureLoad(vel_in, clamp(p + vec2<i32>(-1, 0), vec2<i32>(0), imax), 0).xy;
  let v_r = textureLoad(vel_in, clamp(p + vec2<i32>( 1, 0), vec2<i32>(0), imax), 0).xy;
  let v_d = textureLoad(vel_in, clamp(p + vec2<i32>(0, -1), vec2<i32>(0), imax), 0).xy;
  let v_u = textureLoad(vel_in, clamp(p + vec2<i32>(0,  1), vec2<i32>(0), imax), 0).xy;
  let d = 0.5 * ((v_r.x - v_l.x) + (v_u.y - v_d.y));
  textureStore(div_out, p, vec4(d, 0.0, 0.0, 0.0));
}

// ── 4. Pressure (Jacobi iteration) ──
// Solves grad²P = div(V). One pass = one Jacobi sweep; we run N
// passes from JS to converge.
@compute @workgroup_size(8, 8)
fn cs_jacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(p_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let imax = dim - vec2<i32>(1);
  let p_l = textureLoad(p_in, clamp(p + vec2<i32>(-1, 0), vec2<i32>(0), imax), 0).x;
  let p_r = textureLoad(p_in, clamp(p + vec2<i32>( 1, 0), vec2<i32>(0), imax), 0).x;
  let p_d = textureLoad(p_in, clamp(p + vec2<i32>(0, -1), vec2<i32>(0), imax), 0).x;
  let p_u = textureLoad(p_in, clamp(p + vec2<i32>(0,  1), vec2<i32>(0), imax), 0).x;
  let div = textureLoad(div_tex, p, 0).x;
  // Standard 4-point Poisson Jacobi update
  let p_new = (p_l + p_r + p_d + p_u - div) * 0.25;
  textureStore(p_out, p, vec4(p_new, 0.0, 0.0, 0.0));
}

// ── 5. Subtract pressure gradient (project to divergence-free) ──
@compute @workgroup_size(8, 8)
fn cs_subtract_grad(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(vel_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let imax = dim - vec2<i32>(1);
  let p_l = textureLoad(p_in, clamp(p + vec2<i32>(-1, 0), vec2<i32>(0), imax), 0).x;
  let p_r = textureLoad(p_in, clamp(p + vec2<i32>( 1, 0), vec2<i32>(0), imax), 0).x;
  let p_d = textureLoad(p_in, clamp(p + vec2<i32>(0, -1), vec2<i32>(0), imax), 0).x;
  let p_u = textureLoad(p_in, clamp(p + vec2<i32>(0,  1), vec2<i32>(0), imax), 0).x;
  let v = textureLoad(vel_in, p, 0).xy;
  let v_proj = v - 0.5 * vec2(p_r - p_l, p_u - p_d);
  textureStore(vel_out, p, vec4(v_proj, 0.0, 0.0));
}

// ── 6. Advect dye by velocity ──
@compute @workgroup_size(8, 8)
fn cs_advect_dye(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  let dim = vec2<i32>(textureDimensions(dye_out));
  if (p.x >= dim.x || p.y >= dim.y) { return; }
  let uv = (vec2<f32>(p) + 0.5) / vec2<f32>(dim);
  let v = textureLoad(vel_in, p, 0).xy;
  let back_uv = uv - v * u.dt;
  let d = sampleDye(clamp(back_uv, vec2(0.0), vec2(1.0)));
  // Apply dye decay.
  textureStore(dye_out, p, d * u.dye_decay);
}
`;

// ── Output render shader ──
// Renders the dye texture onto a fullscreen quad with output_boost
// scaling. Used for displaying the simulation result on a canvas.
const OUTPUT_WGSL = /* wgsl */ `
struct V { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_full(@builtin(vertex_index) vid: u32) -> V {
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  var out: V;
  out.clip = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2(x, y);
  return out;
}
struct OutU { boost: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(0) var dye:  texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: OutU;
@fragment fn fs_out(in: V) -> @location(0) vec4<f32> {
  let c = textureSample(dye, samp, in.uv);
  let boosted = c * u.boost;
  // Premultiplied alpha — alpha follows brightness so the layer
  // composites naturally over the underlying canvas.
  let a = clamp(max(max(boosted.r, boosted.g), boosted.b), 0.0, 1.0);
  return vec4(boosted.rgb, a);
}
`;

export class WebGPUFluidSim {
  readonly device: any;
  readonly grid: number;
  private params: FluidSimParams = { ...DEFAULT_PARAMS };
  private elapsed = 0;

  // Field textures (ping-pong pairs for vel/dye/pressure, single for divergence)
  private velA: any; private velB: any;
  private dyeA: any; private dyeB: any;
  private divTex: any;
  private prsA: any; private prsB: any;
  private velFlip = false;   // true: write→B,read←A flipped after step
  private dyeFlip = false;
  private prsFlip = false;

  private sampler: any;
  private globalsBuffer: any;       // 48 bytes (Globals struct)
  private outputUniformBuffer: any; // 16 bytes

  // Source texture binding (set externally each frame)
  private sourceTextureView: any = null;

  // Pipelines + per-pipeline bind group layouts. Each pass gets its
  // own layout containing only the bindings it actually needs —
  // WebGPU's synchronization rule rejects a single bind group from
  // declaring the same texture as both readable AND writable in one
  // compute pass, so we MUST split the layouts.
  private bglInject: any;
  private bglAdvectVel: any;
  private bglDivergence: any;
  private bglJacobi: any;
  private bglSubtractGrad: any;
  private bglAdvectDye: any;
  private pipelineInject: any;
  private pipelineAdvectVel: any;
  private pipelineDivergence: any;
  private pipelineJacobi: any;
  private pipelineSubtractGrad: any;
  private pipelineAdvectDye: any;

  // Output render pipeline
  private outputBGL: any;
  private outputPipeline: any;

  // Bind-group cache: keyed by (read/write swap state) so we don't
  // rebuild every dispatch. Bind groups are immutable in WebGPU; we
  // need 2 versions per pipeline (for ping-pong direction).
  private bgInject: any[] = [];
  private bgAdvectVel: any[] = [];
  private bgDivergence: any[] = [];
  private bgJacobi: any[] = [];
  private bgSubtractGrad: any[] = [];
  private bgAdvectDye: any[] = [];
  private bgOutput: any = null;
  private outputViewCacheKey: string = '';

  static create(device: any, grid: number = GRID_DEFAULT): WebGPUFluidSim {
    return new WebGPUFluidSim(device, grid);
  }

  private constructor(device: any, grid: number) {
    this.device = device;
    this.grid = Math.max(64, Math.min(1024, Math.floor(grid)));

    // ── Allocate field textures ──
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const vDesc = { size: [this.grid, this.grid, 1], format: VEL_FORMAT, usage };
    const dDesc = { size: [this.grid, this.grid, 1], format: DYE_FORMAT, usage };
    const sDesc = { size: [this.grid, this.grid, 1], format: SCALAR_FORMAT, usage };
    this.velA = device.createTexture(vDesc);
    this.velB = device.createTexture(vDesc);
    this.dyeA = device.createTexture(dDesc);
    this.dyeB = device.createTexture(dDesc);
    this.divTex = device.createTexture(sDesc);
    this.prsA = device.createTexture(sDesc);
    this.prsB = device.createTexture(sDesc);

    this.sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    this.globalsBuffer = device.createBuffer({
      size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.outputUniformBuffer = device.createBuffer({
      size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Build a single bind group layout that covers ALL pipelines ──
    // (they all use the same struct layout; unused bindings are fine
    // to leave as defaults). Saves us from N near-identical layouts.
    // Per-pipeline bind group layouts. Each entry point declares
    // ONLY the bindings it actually uses, so WebGPU's "no read+write
    // of same texture in one bind group" rule is satisfied without
    // contortions. Entry-point binding usage was determined by reading
    // the WGSL above:
    //   inject:        u (B0), src+samp (B1,2), vel_in/out (B3,4), dye_in/out (B5,6)
    //   advect_vel:    u, vel_in/out (B3,4)
    //   divergence:    u, vel_in (B3), div_out (B8)
    //   jacobi:        u, div_tex (B7), p_in (B9), p_out (B10)
    //   subtract_grad: u, vel_in/out (B3,4), p_in (B9)
    //   advect_dye:    u, vel_in (B3), dye_in/out (B5,6)
    const ub: any = { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } };
    const tex = (binding: number, st: string = 'float') => ({
      binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: st },
    });
    const stor = (binding: number, format: string) => ({
      binding, visibility: GPUShaderStage.COMPUTE, storageTexture: { format, access: 'write-only' },
    });
    const samp: any = { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: {} };

    this.bglInject = device.createBindGroupLayout({
      entries: [ ub, tex(1, 'float'), samp, tex(3, 'float'), stor(4, VEL_FORMAT), tex(5, 'float'), stor(6, DYE_FORMAT) ],
    });
    this.bglAdvectVel = device.createBindGroupLayout({
      entries: [ ub, tex(3, 'float'), stor(4, VEL_FORMAT) ],
    });
    this.bglDivergence = device.createBindGroupLayout({
      entries: [ ub, tex(3, 'float'), stor(8, SCALAR_FORMAT) ],
    });
    this.bglJacobi = device.createBindGroupLayout({
      entries: [ ub, tex(7, 'unfilterable-float'), tex(9, 'unfilterable-float'), stor(10, SCALAR_FORMAT) ],
    });
    this.bglSubtractGrad = device.createBindGroupLayout({
      entries: [ ub, tex(3, 'float'), stor(4, VEL_FORMAT), tex(9, 'unfilterable-float') ],
    });
    this.bglAdvectDye = device.createBindGroupLayout({
      entries: [ ub, tex(3, 'float'), tex(5, 'float'), stor(6, DYE_FORMAT) ],
    });

    const computeModule = device.createShaderModule({ code: FLUID_WGSL });
    const mkPipeline = (entry: string, bgl: any) => device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module: computeModule, entryPoint: entry },
    });
    this.pipelineInject = mkPipeline('cs_inject', this.bglInject);
    this.pipelineAdvectVel = mkPipeline('cs_advect_vel', this.bglAdvectVel);
    this.pipelineDivergence = mkPipeline('cs_divergence', this.bglDivergence);
    this.pipelineJacobi = mkPipeline('cs_jacobi', this.bglJacobi);
    this.pipelineSubtractGrad = mkPipeline('cs_subtract_grad', this.bglSubtractGrad);
    this.pipelineAdvectDye = mkPipeline('cs_advect_dye', this.bglAdvectDye);

    // Output render pipeline (used by encodeOutputToView + caller)
    const outputModule = device.createShaderModule({ code: OUTPUT_WGSL });
    this.outputBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    console.log('[WebGPUFluidSim] initialised, grid:', this.grid);
  }

  /** Build the output render pipeline targeted at a specific canvas
   *  format. Done lazily because the caller controls what canvas
   *  format they're rendering to. */
  ensureOutputPipeline(format: any): void {
    if (this.outputPipeline && this._outputFormat === format) return;
    const outputModule = this.device.createShaderModule({ code: OUTPUT_WGSL });
    this.outputPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.outputBGL] }),
      vertex: { module: outputModule, entryPoint: 'vs_full' },
      fragment: {
        module: outputModule, entryPoint: 'fs_out',
        targets: [{
          format,
          // Pre-multiplied "over" — fluid composites smoothly over
          // the canvas's existing content (which is just zeros if we
          // render to a dedicated canvas).
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this._outputFormat = format;
  }
  private _outputFormat: any = null;

  setSourceTexture(view: any): void {
    if (this.sourceTextureView !== view) {
      this.sourceTextureView = view;
      // Source-bound bind groups need rebuild.
      this.bgInject = [];
    }
  }

  setParams(p: Partial<FluidSimParams>): void {
    this.params = { ...this.params, ...p };
  }

  /** Wipe all fields back to zero. Called when the layer/effect is
   *  re-initialised. */
  reset(encoder: any): void {
    // Easiest reset: write zero bytes to all field textures via
    // copyBufferToTexture would be heavy; instead, we use a clear
    // render pass per texture by hijacking the output pipeline.
    // For simplicity we just discard the bind-group caches and let
    // the inject pass start from a (likely garbage) state — the
    // dye_decay multiplier kills it within a few frames.
    this.elapsed = 0;
    this.velFlip = false;
    this.dyeFlip = false;
    this.prsFlip = false;
    this.bgInject = [];
    this.bgAdvectVel = [];
    this.bgDivergence = [];
    this.bgJacobi = [];
    this.bgSubtractGrad = [];
    this.bgAdvectDye = [];
  }

  /** Encode one simulation step into the provided command encoder.
   *  Caller is responsible for submitting the encoder. */
  step(encoder: any, dt: number): void {
    if (!this.sourceTextureView) return;
    const dtScaled = Math.min(0.1, dt * this.params.timeScale);
    this.elapsed += dtScaled;

    // Globals uniform — packed 48 bytes.
    const ub = new ArrayBuffer(48);
    const f = new Float32Array(ub);
    f[0] = this.grid; f[1] = this.grid;
    f[2] = dtScaled;  f[3] = this.elapsed;
    f[4] = this.params.injectStrength;
    f[5] = this.params.velocityFromGradient;
    f[6] = this.params.viscosity;
    f[7] = this.params.vorticity;
    // Per-step decay multipliers from rate × dt — exp(-rate * dt)
    // so it's framerate-independent.
    f[8] = Math.exp(-this.params.dyeDecay * dtScaled);
    f[9] = Math.exp(-this.params.velocityDecay * dtScaled);
    this.device.queue.writeBuffer(this.globalsBuffer, 0, ub);

    const groups = Math.ceil(this.grid / 8);
    const dev = this.device;
    const ubEntry = { binding: 0, resource: { buffer: this.globalsBuffer } };

    // Helpers — always return the CURRENT state of the ping-pong
    // pair. Critical: do NOT cache these at the top of step(); the
    // flip flags mutate as we progress. Computing fresh per use
    // guarantees read != write within any one bind group.
    //   `cur*` = the texture most recently written, used as the
    //            input for the next pass
    //   `next*` = the opposite buffer, used as the output target
    const curVel  = () => this.velFlip ? this.velB : this.velA;
    const nextVel = () => this.velFlip ? this.velA : this.velB;
    const curDye  = () => this.dyeFlip ? this.dyeB : this.dyeA;
    const nextDye = () => this.dyeFlip ? this.dyeA : this.dyeB;
    const curPrs  = () => this.prsFlip ? this.prsB : this.prsA;
    const nextPrs = () => this.prsFlip ? this.prsA : this.prsB;

    // Each step gets its own compute pass. Per-pass scope means
    // WebGPU's read+write hazard rules only apply within ONE
    // pipeline at a time, and the small per-pass overhead is
    // negligible (microseconds).

    // ── Step 1: Inject ── (read cur vel/dye, write next vel/dye)
    {
      const bg = dev.createBindGroup({
        layout: this.bglInject,
        entries: [
          ubEntry,
          { binding: 1, resource: this.sourceTextureView },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: curVel().createView() },
          { binding: 4, resource: nextVel().createView() },
          { binding: 5, resource: curDye().createView() },
          { binding: 6, resource: nextDye().createView() },
        ],
      });
      const cp = encoder.beginComputePass();
      cp.setPipeline(this.pipelineInject);
      cp.setBindGroup(0, bg);
      cp.dispatchWorkgroups(groups, groups);
      cp.end();
      this.velFlip = !this.velFlip;
      this.dyeFlip = !this.dyeFlip;
    }

    // ── Step 2: Advect velocity ── (read cur vel, write next vel)
    {
      const bg = dev.createBindGroup({
        layout: this.bglAdvectVel,
        entries: [
          ubEntry,
          { binding: 3, resource: curVel().createView() },
          { binding: 4, resource: nextVel().createView() },
        ],
      });
      const cp = encoder.beginComputePass();
      cp.setPipeline(this.pipelineAdvectVel);
      cp.setBindGroup(0, bg);
      cp.dispatchWorkgroups(groups, groups);
      cp.end();
      this.velFlip = !this.velFlip;
    }

    // ── Step 3: Divergence ── (read cur vel, write divTex)
    {
      const bg = dev.createBindGroup({
        layout: this.bglDivergence,
        entries: [
          ubEntry,
          { binding: 3, resource: curVel().createView() },
          { binding: 8, resource: this.divTex.createView() },
        ],
      });
      const cp = encoder.beginComputePass();
      cp.setPipeline(this.pipelineDivergence);
      cp.setBindGroup(0, bg);
      cp.dispatchWorkgroups(groups, groups);
      cp.end();
    }

    // ── Step 4: Jacobi pressure (N iterations, ping-pong pressure) ──
    for (let it = 0; it < PRESSURE_ITERATIONS; it++) {
      const bg = dev.createBindGroup({
        layout: this.bglJacobi,
        entries: [
          ubEntry,
          { binding: 7, resource: this.divTex.createView() },
          { binding: 9, resource: curPrs().createView() },
          { binding: 10, resource: nextPrs().createView() },
        ],
      });
      const cp = encoder.beginComputePass();
      cp.setPipeline(this.pipelineJacobi);
      cp.setBindGroup(0, bg);
      cp.dispatchWorkgroups(groups, groups);
      cp.end();
      this.prsFlip = !this.prsFlip;
    }

    // ── Step 5: Subtract pressure gradient ── (read cur vel + cur prs,
    // write next vel)
    {
      const bg = dev.createBindGroup({
        layout: this.bglSubtractGrad,
        entries: [
          ubEntry,
          { binding: 3, resource: curVel().createView() },
          { binding: 4, resource: nextVel().createView() },
          { binding: 9, resource: curPrs().createView() },
        ],
      });
      const cp = encoder.beginComputePass();
      cp.setPipeline(this.pipelineSubtractGrad);
      cp.setBindGroup(0, bg);
      cp.dispatchWorkgroups(groups, groups);
      cp.end();
      this.velFlip = !this.velFlip;
    }

    // ── Step 6: Advect dye by final velocity ── (read cur vel + cur dye,
    // write next dye)
    {
      const bg = dev.createBindGroup({
        layout: this.bglAdvectDye,
        entries: [
          ubEntry,
          { binding: 3, resource: curVel().createView() },
          { binding: 5, resource: curDye().createView() },
          { binding: 6, resource: nextDye().createView() },
        ],
      });
      const cp = encoder.beginComputePass();
      cp.setPipeline(this.pipelineAdvectDye);
      cp.setBindGroup(0, bg);
      cp.dispatchWorkgroups(groups, groups);
      cp.end();
      this.dyeFlip = !this.dyeFlip;
    }
  }

  /** Encode a render pass that draws the current dye texture onto
   *  the supplied target view. Caller chooses the target format
   *  (which determines the cached output pipeline). */
  encodeOutputToView(encoder: any, view: any, format: any): void {
    this.ensureOutputPipeline(format);
    // Output uniform — boost.
    const ou = new Float32Array(4);
    ou[0] = this.params.outputBoost;
    this.device.queue.writeBuffer(this.outputUniformBuffer, 0, ou.buffer);

    const dyeTex = this.dyeFlip ? this.dyeB : this.dyeA;
    const cacheKey = `${dyeTex === this.dyeA ? 'A' : 'B'}`;
    if (!this.bgOutput || this.outputViewCacheKey !== cacheKey) {
      this.bgOutput = this.device.createBindGroup({
        layout: this.outputBGL,
        entries: [
          { binding: 0, resource: dyeTex.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: this.outputUniformBuffer } },
        ],
      });
      this.outputViewCacheKey = cacheKey;
    }

    const rp = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    rp.setPipeline(this.outputPipeline);
    rp.setBindGroup(0, this.bgOutput);
    rp.draw(3);
    rp.end();
  }

  dispose(): void {
    try { this.velA?.destroy?.(); this.velB?.destroy?.(); } catch { /* */ }
    try { this.dyeA?.destroy?.(); this.dyeB?.destroy?.(); } catch { /* */ }
    try { this.divTex?.destroy?.(); } catch { /* */ }
    try { this.prsA?.destroy?.(); this.prsB?.destroy?.(); } catch { /* */ }
    try { this.globalsBuffer?.destroy?.(); } catch { /* */ }
    try { this.outputUniformBuffer?.destroy?.(); } catch { /* */ }
  }
}
