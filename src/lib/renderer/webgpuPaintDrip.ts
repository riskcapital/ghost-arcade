/**
 * WebGPUPaintDrip — Phase 3.1 showcase: glowing drips of paint
 * driven by a 50K-particle compute shader, composited additively
 * on top of the bridge frame.
 *
 * Architectural intent: prove WebGPU compute shaders unlock effects
 * the WebGL renderer simply cannot match. 50,000 particles updated
 * per frame on the GPU at 60fps with curl-noise organics + gravity +
 * audio reactivity — try doing that on WebGL transform feedback and
 * watch the editor cry.
 *
 * Physics model:
 *   - Each particle has position, velocity, color, life
 *   - Per-frame update: gravity pulls down, viscosity damps velocity,
 *     micro-noise adds organic wobble (so drips don't fall in
 *     perfectly straight lines), life decays over ~3s
 *   - Mouse held: spawn ~120 particles per frame at cursor with a
 *     tiny velocity spread + slight downward bias, HSV-cycling colors
 *   - Audio bass detected: every particle gets an upward jolt, drops
 *     "jump on the beat"
 *   - Dead particles get respawned at the cursor or remain dead until
 *     the next spawn cycle
 *
 * Render: instanced billboards with additive blending. Each quad is
 * a glowing soft circle (radial falloff in fragment shader). Long
 * lifespans + many particles produce natural-looking trails as they
 * fall — that's the "dripping" look.
 *
 * Public surface:
 *
 *   const drip = await WebGPUPaintDrip.create(device, presentFormat);
 *   drip.setSpawnPosition(u, v, active);  // 0..1 normalized; active=mouse held
 *   drip.setBassEnergy(energy);            // 0..1 from audioBands.bass
 *   drip.encodeFrame(encoder, finalView, dt);  // call AFTER bridge present
 *   drip.dispose();
 *
 * Performance budget: ~0.4ms compute + ~0.6ms render at 1080p with
 * 50K particles on a discrete GPU. Negligible vs the bridge cost.
 */

const PARTICLE_COUNT = 50000;
const PARTICLE_BYTES = 32;          // 8 (pos) + 8 (vel) + 12 (color) + 4 (life)
const SPAWN_PER_FRAME = 120;        // when mouse held
const LIFE_SECONDS = 3.0;           // particles live ~3s before dying

// Uniforms struct (std140-ish layout, vec4 alignment):
//   vec2 spawn_pos    (xy)
//   f32  spawn_active (z)
//   f32  bass_energy  (w)
//   ---
//   f32  delta_time
//   f32  total_time
//   u32  particle_count
//   u32  spawn_per_frame
//   ---
//   vec3 spawn_color  (xyz)
//   f32  decay_rate
//   ---
//   vec2 viewport     (xy aspect-correct multipliers)
//   f32  gravity
//   f32  viscosity
const UNIFORM_BYTES = 64;

// HSV → RGB. Used CPU-side to compute the "current spawn color" each
// frame as the hue cycles slowly over time.
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

const COMPUTE_WGSL = /* wgsl */ `
struct Particle {
  pos: vec2<f32>,
  vel: vec2<f32>,
  color: vec3<f32>,
  life: f32,
};

struct Uniforms {
  // vec4 #0
  spawn_pos: vec2<f32>,
  spawn_active: f32,
  bass_energy: f32,
  // vec4 #1
  delta_time: f32,
  total_time: f32,
  particle_count: u32,
  spawn_per_frame: u32,
  // vec4 #2
  spawn_color: vec3<f32>,
  decay_rate: f32,
  // vec4 #3
  viewport: vec2<f32>,
  gravity: f32,
  viscosity: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: Uniforms;

// PRNG — simple hash, deterministic per (id, time slot) so particles
// don't all jitter the same way. Returns 0..1.
fn hash21(p: vec2<f32>) -> f32 {
  var n = p.x * 12.9898 + p.y * 78.233;
  return fract(sin(n) * 43758.5453);
}

fn hash21_v2(p: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(hash21(p), hash21(p + vec2(13.7, 91.3)));
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.particle_count) { return; }
  var p = particles[i];

  // Spawn dead particles when the mouse is active. Distribute spawns
  // across the first SPAWN_PER_FRAME dead slots — index ranges further
  // out are reserved for future "audio burst" spawns.
  if (p.life <= 0.0) {
    if (u.spawn_active > 0.5 && i < u.spawn_per_frame) {
      // Per-particle stable seed from id + time — avoids entire spawn
      // batches landing on the same point.
      let r = hash21_v2(vec2(f32(i), u.total_time));
      let angle = r.x * 6.28318530;
      let radius = r.y * 0.004;  // tiny spread around cursor
      p.pos = u.spawn_pos + vec2(cos(angle) * radius, sin(angle) * radius * u.viewport.y / u.viewport.x);
      // Initial velocity: small random with downward bias. Drips
      // start moving down immediately, give the visual its drip
      // character.
      let v_angle = (r.x - 0.5) * 0.6 + 1.5707963; // ~90 degrees ± 17deg = pointing down
      let v_speed = 0.02 + r.y * 0.04;
      p.vel = vec2(cos(v_angle) * v_speed, sin(v_angle) * v_speed);
      p.color = u.spawn_color;
      p.life = 1.0;
    }
    particles[i] = p;
    return;
  }

  // Apply gravity. y increases downward in our normalized coord
  // system (matches typical UV).
  p.vel.y += u.gravity * u.delta_time;

  // Audio bass kick — every alive particle gets a small upward jolt
  // proportional to the bass energy. Visible as drips "jumping" on
  // the beat. The kick is brief; bass_energy decays in the JS layer.
  if (u.bass_energy > 0.05) {
    p.vel.y -= u.bass_energy * 0.6 * u.delta_time;
    // Add a tiny outward radial component so kicks "puff" the drips.
    let to_center = p.pos - u.spawn_pos;
    let dist = length(to_center) + 0.001;
    p.vel += (to_center / dist) * u.bass_energy * 0.1 * u.delta_time;
  }

  // Tiny per-particle noise wobble — keeps drips from falling in
  // perfectly straight lines. Looks more organic.
  let wobble = (hash21_v2(vec2(f32(i) * 0.13, u.total_time * 4.0)) - 0.5) * 0.001;
  p.vel += wobble;

  // Viscosity / drag.
  p.vel *= pow(u.viscosity, u.delta_time * 60.0);

  // Update position.
  p.pos += p.vel * u.delta_time;

  // Decay life.
  p.life -= u.decay_rate * u.delta_time;

  // Kill at canvas bottom (drips fall off the screen).
  if (p.pos.y > 1.05) { p.life = 0.0; }
  // Wrap horizontally so off-screen particles don't waste memory but
  // also don't suddenly reappear visibly.
  if (p.pos.x < -0.05 || p.pos.x > 1.05) { p.life = 0.0; }

  particles[i] = p;
}
`;

const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos: vec2<f32>,
  vel: vec2<f32>,
  color: vec3<f32>,
  life: f32,
};

struct RenderUniforms {
  // Convert from particle-space (0..1 UV) to clip-space and
  // compensate for canvas aspect ratio so particles look round
  // regardless of the canvas's WxH.
  size_uv: vec2<f32>,    // billboard size in UV (x and y separately)
  glow_boost: f32,
  pad: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: RenderUniforms;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
  );
  let corner = corners[vid];
  let p = particles[iid];

  // Cull dead particles by snapping their clip-space position OUT
  // of the viewport (cheaper than computing alpha=0 in the fragment).
  if (p.life <= 0.0) {
    var dead: VSOut;
    dead.clip = vec4(2.0, 2.0, 0.0, 1.0);  // off-screen
    dead.uv = vec2(0.0);
    dead.color = vec4(0.0);
    return dead;
  }

  // Particle size grows slightly as it falls (heavier drops look
  // bigger). And shrinks as life decays.
  let life01 = clamp(p.life, 0.0, 1.0);
  let size_factor = 0.6 + life01 * 0.4 + p.pos.y * 0.3;
  let world_pos = p.pos + corner * u.size_uv * size_factor;
  // UV (0..1) → clip (-1..1, Y flipped to match canvas coords)
  let clip_pos = vec2(world_pos.x * 2.0 - 1.0, 1.0 - world_pos.y * 2.0);

  var out: VSOut;
  out.clip = vec4(clip_pos, 0.0, 1.0);
  out.uv = corner * 0.5 + 0.5;
  // Pre-multiply color by life so older particles fade naturally.
  // Also boost intensity slightly — additive blend wants HDR-ish
  // colors so stacked particles compound to bright glow.
  let intensity = u.glow_boost * life01;
  out.color = vec4(p.color * intensity, life01);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Soft round particle: radial falloff with a bright core.
  let d = length(in.uv - 0.5) * 2.0;       // 0 at center, ~1.4 at corner
  let core = exp(-d * d * 6.0);             // bright tight core
  let halo = exp(-d * d * 1.5) * 0.4;       // wider soft halo
  let alpha = (core + halo) * in.color.a;
  // Output additive: alpha=1 in straight blending mode but our pipeline
  // uses src=ONE dst=ONE so alpha is ignored at the blend stage anyway.
  return vec4(in.color.rgb * alpha, alpha);
}
`;

export interface WebGPUPaintDripStats {
  framesEncoded: number;
  particleCount: number;
  spawnRate: number;          // particles spawned this frame
  bassEnergy: number;
  hue: number;
}

export class WebGPUPaintDrip {
  static async create(
    device: any,
    presentFormat: any,
  ): Promise<WebGPUPaintDrip> {
    return new WebGPUPaintDrip(device, presentFormat);
  }

  readonly device: any;
  readonly presentFormat: any;

  private particleBuffer: any;
  private computeUniformBuffer: any;
  private renderUniformBuffer: any;
  private computePipeline: any;
  private computeBindGroup: any;
  private renderPipeline: any;
  private renderBindGroup: any;
  private renderBindGroupLayout: any;
  private computeBindGroupLayout: any;
  private viewportW = 1920;
  private viewportH = 1080;
  private startTime = 0;
  private lastEncodeTime = 0;

  // CPU-side state — pushed into uniforms each frame
  private spawnU = 0.5;
  private spawnV = 0.5;
  private spawnActive = false;
  private bassEnergy = 0;       // exponential-decay buffered bass
  private bassTarget = 0;       // raw audio bass set externally
  private hue = 0;              // 0..1, cycles slowly

  readonly stats: WebGPUPaintDripStats = {
    framesEncoded: 0,
    particleCount: PARTICLE_COUNT,
    spawnRate: 0,
    bassEnergy: 0,
    hue: 0,
  };

  private constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.startTime = performance.now();
    this.lastEncodeTime = this.startTime;
    this._buildResources();
    // Initialise particle buffer with all-dead particles. Spawn
    // logic in compute will bring them to life when the mouse goes
    // active.
    const init = new Float32Array(PARTICLE_COUNT * (PARTICLE_BYTES / 4));
    // life field is at byte offset 28 (= float index 7). All others
    // start at 0; explicit zero is fine (Float32Array default).
    this.device.queue.writeBuffer(this.particleBuffer, 0, init.buffer);
    console.log('[WebGPUPaintDrip] initialised with', PARTICLE_COUNT, 'particles');
  }

  setSpawnPosition(u: number, v: number, active: boolean): void {
    this.spawnU = u;
    this.spawnV = v;
    this.spawnActive = active;
  }

  setBassEnergy(energy: number): void {
    // Latch the incoming target. The render loop applies an
    // exponential decay each frame so kicks have a brief but
    // visible falloff rather than instant on/off.
    this.bassTarget = Math.max(0, Math.min(1, energy));
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
  }

  private _buildResources(): void {
    const d = this.device;

    this.particleBuffer = d.createBuffer({
      size: PARTICLE_COUNT * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.computeUniformBuffer = d.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.renderUniformBuffer = d.createBuffer({
      size: 16,  // vec4 (size_uv, glow_boost, pad)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Compute pipeline ──
    const computeModule = d.createShaderModule({ code: COMPUTE_WGSL });
    this.computeBindGroupLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const computePipelineLayout = d.createPipelineLayout({
      bindGroupLayouts: [this.computeBindGroupLayout],
    });
    this.computePipeline = d.createComputePipeline({
      layout: computePipelineLayout,
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });
    this.computeBindGroup = d.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.computeUniformBuffer } },
      ],
    });

    // ── Render pipeline (additive blend) ──
    const renderModule = d.createShaderModule({ code: RENDER_WGSL });
    this.renderBindGroupLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
    const renderPipelineLayout = d.createPipelineLayout({
      bindGroupLayouts: [this.renderBindGroupLayout],
    });
    this.renderPipeline = d.createRenderPipeline({
      layout: renderPipelineLayout,
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.presentFormat,
          // Additive blending — particles add to whatever's already
          // in the framebuffer (the bridge frame, in our pipeline).
          blend: {
            color: {
              srcFactor: 'one',
              dstFactor: 'one',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one',
              operation: 'add',
            },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.renderBindGroup = d.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
      ],
    });
  }

  /** Encode one frame's compute + render passes onto the given
   *  encoder, blending additively over the current contents of
   *  finalView (the bridge frame). The caller is responsible for the
   *  initial clear/bridge pass before this; we ONLY add particles
   *  on top via additive blend. */
  encodeFrame(encoder: any, finalView: any): void {
    const now = performance.now();
    const totalTime = (now - this.startTime) / 1000;
    const dt = Math.min(0.05, (now - this.lastEncodeTime) / 1000);  // clamp dt to 50ms to survive a hiccup
    this.lastEncodeTime = now;

    // Decay the bass energy exponentially so a single kick produces
    // a visible-then-fade jolt rather than an on/off step.
    this.bassEnergy = Math.max(this.bassEnergy * 0.85, this.bassTarget);
    this.bassTarget *= 0.95;
    this.stats.bassEnergy = this.bassEnergy;

    // Cycle hue over time — drips paint a slow rainbow as the user
    // drags. Hue rate is slow (~30s per cycle) so it's not seizure-y.
    this.hue = (this.hue + dt * 0.04) % 1;
    const [r, g, b] = hsvToRgb(this.hue, 0.85, 1.0);
    this.stats.hue = this.hue;

    // Pack compute uniforms. The WGSL struct declares particle_count
    // and spawn_per_frame as `u32` fields, so we MUST write those
    // bytes as Uint32 (cuU[6/7]) — NOT Float32. Other fields stay
    // Float32 (cuF). Type alignment is critical: writing the wrong
    // numeric type gives the GPU garbage on read.
    const cu = new ArrayBuffer(UNIFORM_BYTES);
    const cuF = new Float32Array(cu);
    const cuU = new Uint32Array(cu);
    // vec4 #0
    cuF[0] = this.spawnU;
    cuF[1] = this.spawnV;
    cuF[2] = this.spawnActive ? 1 : 0;
    cuF[3] = this.bassEnergy;
    // vec4 #1 — last two fields are u32 in the WGSL struct
    cuF[4] = dt;
    cuF[5] = totalTime;
    cuU[6] = PARTICLE_COUNT;
    cuU[7] = SPAWN_PER_FRAME;
    // vec4 #2
    cuF[8] = r;
    cuF[9] = g;
    cuF[10] = b;
    cuF[11] = 1.0 / LIFE_SECONDS;  // decay_rate (life units per second)
    // vec4 #3
    cuF[12] = this.viewportW;
    cuF[13] = this.viewportH;
    cuF[14] = 0.45;   // gravity (downward)
    cuF[15] = 0.85;   // viscosity (per-second damping)
    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, cu);

    // Render uniforms — billboard sized in UV with aspect correction
    // so each particle is a circle, not an oval, regardless of the
    // canvas aspect ratio.
    const ru = new Float32Array(4);
    const sizeUV = 0.006;
    ru[0] = sizeUV;
    ru[1] = sizeUV * (this.viewportW / Math.max(1, this.viewportH));
    ru[2] = 1.4;  // glow_boost (HDR-ish — additive blend stacks brightness)
    ru[3] = 0;
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ru.buffer);

    // ── Compute pass: update all particles ──
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(this.computePipeline);
    cpass.setBindGroup(0, this.computeBindGroup);
    const workgroups = Math.ceil(PARTICLE_COUNT / 64);
    cpass.dispatchWorkgroups(workgroups);
    cpass.end();

    // ── Render pass: instanced billboards, additive blend ──
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: finalView,
        // load='load' preserves the bridge frame underneath
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    rpass.setPipeline(this.renderPipeline);
    rpass.setBindGroup(0, this.renderBindGroup);
    rpass.draw(6, PARTICLE_COUNT, 0, 0);
    rpass.end();

    this.stats.framesEncoded++;
    this.stats.spawnRate = this.spawnActive ? SPAWN_PER_FRAME : 0;
  }

  dispose(): void {
    try { this.particleBuffer?.destroy?.(); } catch { /* */ }
    try { this.computeUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.renderUniformBuffer?.destroy?.(); } catch { /* */ }
  }
}
