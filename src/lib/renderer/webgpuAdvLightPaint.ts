import { getGhostGpuRuntime } from './webgpuShared';
import { createAndWarmWgslShaderModule } from './wgsl';

/**
 * WebGPUAdvLightPaint — 3D physics-driven particle paint engine.
 *
 * Renders the `adv-lightpaint` layer type (see types.ts
 * `AdvLightPaintingContent`). Pure WebGPU compute + render — no
 * fallback to WebGL. The layer's content drives 80K-200K particles
 * in a storage buffer, updated each frame by a compute shader
 * configured by the active brush preset:
 *
 *   drip   — high gravity, high viscosity, slight downward bias on
 *            spawn. Particles fall in coherent streams that pool.
 *   water  — gravity + cohesion. Particles weakly attract toward
 *            local density, pools form at rest. 2D fluid surface
 *            tension approximation; not full Navier-Stokes.
 *   smoke  — buoyant (negative gravity), very low viscosity,
 *            expanding outward. Wispy upward plumes.
 *   plasma — chaotic curl-noise + bright additive. Swirling colour.
 *   shader — same physics as plasma but colour sampled from a
 *            procedural HSV pattern (future v2: any ISF shader).
 *
 * Particles are 3D (position vec3, velocity vec3) so the brush has
 * a depth dimension — the user can paint at z=−1..1 and particles
 * project with simple perspective at render. Depth-fade on alpha so
 * far particles are dimmer; near particles are bigger via projected
 * billboard size.
 *
 * Public surface:
 *
 *   const adv = await WebGPUAdvLightPaint.create(device, presentFormat);
 *   adv.setContent(advLightPaintingContent);   // every frame; cheap
 *   adv.setSpawnPosition(u, v, active);         // 0..1 normalized + drawing flag
 *   adv.setBassEnergy(energy);                  // 0..1
 *   adv.setViewport(w, h);
 *   adv.encodeFrame(encoder, finalView);        // additive on top of bridge
 *   adv.dispose();
 *
 * The compute pipeline is rebuilt only when particleCount changes —
 * other parameters (gravity, viscosity, brush, etc.) are pushed via
 * uniforms each frame and don't require pipeline recompilation.
 */

import type { AdvLightPaintingContent, AdvLightPaintBrush } from '$lib/types';

// 3D particle struct: position(vec3) + velocity(vec3) + color(vec3) + life(f32)
//   Layout: pos(12) + pad(4) + vel(12) + pad(4) + col(12) + life(4) = 48 bytes
//   The pads keep std430-friendly vec3 alignment.
const PARTICLE_BYTES = 48;
const MAX_PARTICLES = 200000;
const ABSOLUTE_MIN_PARTICLES = 5000;

// Uniforms struct (112 bytes, vec4-aligned):
//   vec4 spawn         (xyz pos in normalized 0..1, w = active 0/1)
//   vec4 dt_time_count (dt, total_time, particle_count, spawn_per_frame)
//   vec4 color         (rgb, lifespan_seconds)
//   vec4 forces        (gravity, viscosity, audio_bass, brush_id)
//   vec4 misc          (size, glow, depth_fade, hue_cycle_speed)
//   vec4 viewport      (w, h, emissionZ, spawn_spread)
//   vec4 prev_spawn    (prev_x, prev_y, prev_active, _pad)  ← stroke interp
const UNIFORM_BYTES = 112;

const COMPUTE_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>,    // x,y in 0..1 canvas UV; z in -1..1 depth
  _pad0: f32,
  vel: vec3<f32>,
  _pad1: f32,
  col: vec3<f32>,
  life: f32,         // 0..1, decays over time; <=0 means dead
};

struct U {
  spawn: vec4<f32>,           // xyz spawn pos, w active
  dt_time_count: vec4<f32>,   // dt, time, count(u32), spawn_per_frame(u32)
  color_life: vec4<f32>,      // rgb, lifespan_sec
  forces: vec4<f32>,          // gravity, viscosity, audio_bass, brush_id
  misc: vec4<f32>,            // size, glow, depth_fade, hue_cycle_speed
  viewport: vec4<f32>,        // w, h, emissionZ, spawn_spread
  prev_spawn: vec4<f32>,      // prev_x, prev_y, was_active (1=continuous), pad
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;

fn hash21(p: vec2<f32>) -> f32 {
  let n = sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453;
  return fract(n);
}
fn hash21_v2(p: vec2<f32>) -> vec2<f32> {
  return vec2(hash21(p), hash21(p + vec2(13.7, 91.3)));
}
fn hash31(p: vec3<f32>) -> f32 {
  return hash21(vec2(p.x + p.z * 0.1, p.y + p.z * 0.7));
}

// Curl noise for smoke / plasma brushes.
fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2(1.0, 0.0));
  let c = hash21(i + vec2(0.0, 1.0));
  let d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn curl2(p: vec2<f32>) -> vec2<f32> {
  let e = 0.01;
  let n_pp = noise2(p + vec2(e, 0.0));
  let n_pn = noise2(p - vec2(e, 0.0));
  let n_mp = noise2(p + vec2(0.0, e));
  let n_mn = noise2(p - vec2(0.0, e));
  return vec2((n_mp - n_mn) / (2.0 * e), -(n_pp - n_pn) / (2.0 * e));
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let count = u32(u.dt_time_count.z);
  let spawn_per_frame = u32(u.dt_time_count.w);
  if (i >= count) { return; }

  var p = particles[i];
  let dt = u.dt_time_count.x;
  let t = u.dt_time_count.y;
  let brush = u32(u.forces.w);
  let lifespan = max(0.05, u.color_life.w);

  // Spawn dead particles when the user is actively dragging.
  // Stroke interpolation: distribute spawns ALONG the line from
  // last-frame's spawn position to this-frame's. This is what makes
  // it feel like painting a stroke instead of poking dots — at high
  // mouse speed, frame-to-frame position deltas can be huge (10+
  // canvas widths per second); without interpolation we'd get
  // sparse puffs spread along the path. With interpolation we get
  // a continuous bead of particles tracing the cursor.
  if (p.life <= 0.0) {
    if (u.spawn.w > 0.5 && i < spawn_per_frame) {
      let r = hash21_v2(vec2(f32(i), t));
      let r2 = hash21_v2(vec2(f32(i) * 1.7, t * 1.3));
      let spread = u.viewport.w;

      // Stroke interpolation parameter: 0 = previous mouse pos,
      // 1 = current mouse pos. Each spawned particle gets a unique
      // t in [0,1] so the spawn batch covers the entire stroke
      // segment. If was_active is 0 (mousedown just started),
      // collapse to a single point — no previous pos to interpolate
      // from.
      let was_active = u.prev_spawn.z;
      var stroke_t = f32(i) / f32(max(1u, spawn_per_frame - 1u));
      if (was_active < 0.5) { stroke_t = 1.0; }
      let stroke_pos = mix(u.prev_spawn.xy, u.spawn.xy, stroke_t);

      // Brush-specific initial spread + cluster size. Bigger numbers
      // here = bigger visible "brush footprint" at each stroke point.
      let cluster_size = 0.025 * (0.4 + spread * 2.0);
      let jitter = (r - 0.5) * cluster_size;
      p.pos = vec3(stroke_pos.x + jitter.x, stroke_pos.y + jitter.y, u.spawn.z);

      // Velocity: brush-specific initial direction. Tuned for
      // dramatic visual difference between brushes.
      var v_dir = vec3(0.0);
      if (brush == 0u) {
        // drip: STRONG downward + slight lateral spread
        v_dir = vec3((r2.x - 0.5) * 0.06, 0.10 + r2.y * 0.10, 0.0);
      } else if (brush == 1u) {
        // water: lateral spread, slight downward, low cohesion-ready
        v_dir = vec3((r2.x - 0.5) * 0.18, (r2.y - 0.3) * 0.05, 0.0);
      } else if (brush == 2u) {
        // smoke: STRONG upward, more lateral wobble (wisps)
        v_dir = vec3((r2.x - 0.5) * 0.08, -0.08 - r2.y * 0.10, 0.0);
      } else if (brush == 3u) {
        // plasma: full random outward burst, faster
        let angle = r.x * 6.28318530;
        let speed = 0.10 + r.y * 0.20;
        v_dir = vec3(cos(angle) * speed, sin(angle) * speed, (r2.x - 0.5) * 0.08);
      } else {
        // shader (placeholder): swirly with slight downward
        let angle = r.x * 6.28318530;
        let speed = 0.08 + r.y * 0.12;
        v_dir = vec3(cos(angle) * speed, sin(angle) * speed + 0.02, 0.0);
      }
      p.vel = v_dir * (0.8 + spread * 0.6);

      // Colour: base + per-particle hue jitter. Plasma/shader get
      // bigger hue shifts so they look chromatically alive.
      var col = u.color_life.rgb;
      if (brush == 3u || brush == 4u) {
        let hue_shift = r.x * 0.6 - 0.3;
        col = mix(col, col.gbr, abs(hue_shift));
      } else {
        // Subtle per-particle brightness jitter for non-plasma
        col = col * (0.85 + r.x * 0.3);
      }
      p.col = col;
      p.life = 1.0;
    }
    particles[i] = p;
    return;
  }

  // ── Active particle update ──
  var vel = p.vel;
  let pos = p.pos;
  let visc = clamp(u.forces.y, 0.5, 0.999);
  let grav_in = u.forces.x;
  let bass = u.forces.z;

  if (brush == 0u) {
    // drip: gravity down + small noise wobble
    vel.y += grav_in * dt;
    let wob = (hash21_v2(vec2(f32(i) * 0.13, t * 4.0)) - 0.5) * 0.0008;
    vel.x += wob.x;
    vel.z += wob.y * 0.5;
  } else if (brush == 1u) {
    // water: gravity + cohesion (pull toward spawn point if near it)
    vel.y += grav_in * dt * 0.7;
    let toward = u.spawn.xyz - pos;
    let d = length(toward);
    if (d < 0.15 && u.spawn.w > 0.5) {
      vel += normalize(toward + vec3(0.0001)) * 0.02 * dt;
    }
  } else if (brush == 2u) {
    // smoke: buoyancy (negative gravity) + curl noise + expansion
    vel.y -= grav_in * 0.6 * dt;  // upward
    let c = curl2(pos.xy * 4.0 + vec2(t * 0.2));
    vel.x += c.x * 0.04 * dt;
    vel.z += c.y * 0.03 * dt;
  } else if (brush == 3u) {
    // plasma: pure curl noise driven, no gravity
    let c = curl2(pos.xy * 6.0 + vec2(t * 0.3));
    vel.x += c.x * 0.2 * dt;
    vel.y += c.y * 0.2 * dt;
    vel.z += sin(t * 1.5 + f32(i) * 0.013) * 0.05 * dt;
  } else {
    // shader (placeholder): swirl + slight gravity
    let c = curl2(pos.xy * 5.0 + vec2(t * 0.2));
    vel.x += c.x * 0.15 * dt;
    vel.y += c.y * 0.15 * dt + grav_in * 0.3 * dt;
  }

  // Audio bass: kick all live particles upward + outward radially.
  // Variable renamed from 'from' because WGSL reserves that keyword.
  if (bass > 0.05) {
    vel.y -= bass * 0.5 * dt;
    let delta = pos.xy - u.spawn.xy;
    let dist = length(delta) + 0.001;
    let push = (delta / dist) * bass * 0.15 * dt;
    vel.x += push.x;
    vel.z += push.y * 0.5;
  }

  // Viscosity damping (per-second damping factor)
  vel *= pow(visc, dt * 60.0);

  // Update position
  var new_pos = pos + vel * dt;

  // Decay life
  let new_life = p.life - dt / lifespan;

  // Boundary: kill at canvas extents (drips fall off)
  var alive = new_life;
  if (new_pos.y > 1.1 || new_pos.y < -0.1) { alive = 0.0; }
  if (new_pos.x < -0.1 || new_pos.x > 1.1) { alive = 0.0; }
  if (abs(new_pos.z) > 2.0) { alive = 0.0; }

  p.pos = new_pos;
  p.vel = vel;
  p.life = alive;
  particles[i] = p;
}
`;

const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>,
  _pad0: f32,
  vel: vec3<f32>,
  _pad1: f32,
  col: vec3<f32>,
  life: f32,
};

struct U {
  size: f32,
  glow: f32,
  depth_fade: f32,
  aspect_y: f32,    // viewport aspect compensation for round particles
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;

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
  let life01 = clamp(p.life, 0.0, 1.0);

  if (life01 <= 0.0) {
    // Cull: snap to off-screen.
    var dead: VSOut;
    dead.clip = vec4(2.0, 2.0, 0.0, 1.0);
    dead.uv = vec2(0.0);
    dead.color = vec4(0.0);
    return dead;
  }

  // Simple perspective: map z (-1..1) to a size factor 0.5..1.5
  // (closer particles bigger). Only affects size, not position —
  // the canvas is still effectively 2D, just with depth-driven
  // visual cues.
  let depth_size = 1.0 - p.pos.z * 0.5;   // -1 -> 1.5x, 0 -> 1, 1 -> 0.5x
  let size = u.size * depth_size * (0.4 + life01 * 0.6);

  let world = vec2(p.pos.x + corner.x * size,
                    p.pos.y + corner.y * size * u.aspect_y);
  // UV (0..1) -> clip (-1..1, Y flipped)
  let clip_pos = vec2(world.x * 2.0 - 1.0, 1.0 - world.y * 2.0);

  // Depth fade on alpha: distant particles dimmer
  let depth_alpha = mix(1.0, max(0.2, 1.0 - p.pos.z), u.depth_fade);
  let intensity = u.glow * life01 * depth_alpha;

  var out: VSOut;
  out.clip = vec4(clip_pos, 0.0, 1.0);
  out.uv = corner * 0.5 + 0.5;
  out.color = vec4(p.col * intensity, life01 * depth_alpha);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let d = length(in.uv - 0.5) * 2.0;
  // Tight bright core + wider soft halo for that "glow" character.
  let core = exp(-d * d * 8.0);
  let halo = exp(-d * d * 1.8) * 0.35;
  let alpha = (core + halo) * in.color.a;
  return vec4(in.color.rgb * alpha, alpha);
}
`;

function brushId(b: AdvLightPaintBrush): number {
  switch (b) {
    case 'drip':   return 0;
    case 'water':  return 1;
    case 'smoke':  return 2;
    case 'plasma': return 3;
    case 'shader': return 4;
  }
}

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

export interface AdvLightPaintStats {
  particleCapacity: number;
  framesEncoded: number;
  spawnRate: number;
  brush: AdvLightPaintBrush;
  bass: number;
  hue: number;
}

export class WebGPUAdvLightPaint {
  static async create(device: any, presentFormat: any): Promise<WebGPUAdvLightPaint> {
    return new WebGPUAdvLightPaint(device, presentFormat);
  }

  readonly device: any;
  readonly presentFormat: any;

  private particleBuffer: any = null;
  private computeUniformBuffer: any;
  private renderUniformBuffer: any;
  private computePipeline: any;
  private renderPipeline: any;
  private computeBindGroupLayout: any;
  private renderBindGroupLayout: any;
  private computeBindGroup: any = null;
  private renderBindGroup: any = null;

  private currentCapacity = 0;
  private content: AdvLightPaintingContent | null = null;
  private spawnU = 0.5;
  private spawnV = 0.5;
  private spawnActive = false;
  // Stroke interpolation: remember last frame's mouse pos + active
  // state. The shader uses this to lerp spawn positions across the
  // segment from prev → curr each frame, so a fast drag traces a
  // continuous bead rather than scattered puffs.
  private prevSpawnU = 0.5;
  private prevSpawnV = 0.5;
  private prevSpawnActive = false;
  private bassEnergy = 0;
  private bassTarget = 0;
  private hue = 0;
  private viewportW = 1920;
  private viewportH = 1080;
  private startTime = 0;
  private lastFrameTime = 0;

  readonly stats: AdvLightPaintStats = {
    particleCapacity: 0,
    framesEncoded: 0,
    spawnRate: 0,
    brush: 'drip',
    bass: 0,
    hue: 0,
  };

  private constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;

    this.computeUniformBuffer = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });

    const shaderRuntime = getGhostGpuRuntime() ?? device;
    const computeModule = createAndWarmWgslShaderModule(shaderRuntime, COMPUTE_WGSL, 'adv-light-paint/compute');
    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });
    const renderModule = createAndWarmWgslShaderModule(shaderRuntime, RENDER_WGSL, 'adv-light-paint/render');
    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.renderBindGroupLayout] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: presentFormat,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Initial allocation
    this._allocateParticles(80000);
    console.log('[AdvLightPaint] initialised');
  }

  private _allocateParticles(count: number): void {
    const clamped = Math.max(ABSOLUTE_MIN_PARTICLES, Math.min(MAX_PARTICLES, Math.round(count)));
    if (clamped === this.currentCapacity && this.particleBuffer) return;
    if (this.particleBuffer) {
      try { this.particleBuffer.destroy(); } catch { /* */ }
    }
    this.particleBuffer = this.device.createBuffer({
      size: clamped * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Zero-init (all dead).
    const zeros = new Float32Array(clamped * (PARTICLE_BYTES / 4));
    this.device.queue.writeBuffer(this.particleBuffer, 0, zeros.buffer);
    this.currentCapacity = clamped;
    this.stats.particleCapacity = clamped;
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.computeUniformBuffer } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
      ],
    });
    console.log('[AdvLightPaint] allocated', clamped, 'particles');
  }

  setContent(c: AdvLightPaintingContent | null): void {
    this.content = c;
    if (c && c.particleCount !== this.currentCapacity) {
      this._allocateParticles(c.particleCount);
    }
    if (c) this.stats.brush = c.brush;
  }

  setSpawnPosition(u: number, v: number, active: boolean): void {
    this.spawnU = u;
    this.spawnV = v;
    this.spawnActive = active;
  }

  setBassEnergy(energy: number): void {
    this.bassTarget = Math.max(0, Math.min(1, energy));
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
  }

  /** Reset the particle buffer to all-dead. Called when user clicks
   *  "clear" in the panel. */
  reset(): void {
    if (!this.particleBuffer || !this.currentCapacity) return;
    const zeros = new Float32Array(this.currentCapacity * (PARTICLE_BYTES / 4));
    this.device.queue.writeBuffer(this.particleBuffer, 0, zeros.buffer);
  }

  encodeFrame(encoder: any, finalView: any): void {
    if (!this.content || !this.particleBuffer || !this.computeBindGroup || !this.renderBindGroup) return;
    const c = this.content;

    const now = performance.now();
    const totalTime = (now - this.startTime) / 1000;
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    // Bass envelope
    this.bassEnergy = Math.max(this.bassEnergy * 0.85, this.bassTarget * c.audioReactivity);
    this.bassTarget *= 0.92;
    this.stats.bass = this.bassEnergy;

    // Hue cycle
    this.hue = (this.hue + dt * c.hueCycleSpeed) % 1;
    this.stats.hue = this.hue;
    let r = c.baseColor[0], g = c.baseColor[1], b = c.baseColor[2];
    if (c.hueCycleSpeed > 0.001) {
      // Drift through HSV from baseColor's hue + cycle offset
      // Using simple approximation: mix base with hue-rotated white
      const [hr, hg, hb] = hsvToRgb(this.hue, 0.85, 1.0);
      r = r * 0.4 + hr * 0.6;
      g = g * 0.4 + hg * 0.6;
      b = b * 0.4 + hb * 0.6;
    }

    // Pack compute uniforms. ALL values are Float32 — even integer
    // counts. WGSL casts them with u32(...) when needed. Mixing
    // Float32/Uint32 writes into the same buffer is a type-pun trap:
    // the bytes get reinterpreted as the wrong type on the GPU side
    // and you get garbage integers instead of e.g. 200.
    const cu = new ArrayBuffer(UNIFORM_BYTES);
    const cuF = new Float32Array(cu);
    cuF[0] = this.spawnU; cuF[1] = this.spawnV; cuF[2] = c.emissionZ; cuF[3] = this.spawnActive ? 1 : 0;
    cuF[4] = dt; cuF[5] = totalTime;
    cuF[6] = this.currentCapacity;
    cuF[7] = Math.max(1, Math.min(2000, c.spawnRate));
    cuF[8] = r; cuF[9] = g; cuF[10] = b; cuF[11] = c.lifespanSec;
    cuF[12] = c.gravity; cuF[13] = c.viscosity; cuF[14] = this.bassEnergy; cuF[15] = brushId(c.brush);
    cuF[16] = c.size; cuF[17] = c.glow; cuF[18] = 0.6; cuF[19] = c.hueCycleSpeed;
    cuF[20] = this.viewportW; cuF[21] = this.viewportH; cuF[22] = c.emissionZ; cuF[23] = c.spawnSpread;
    // prev_spawn slot — last frame's mouse position + active flag
    // for stroke interpolation. After packing, advance to current
    // values for next frame.
    cuF[24] = this.prevSpawnU;
    cuF[25] = this.prevSpawnV;
    cuF[26] = this.prevSpawnActive ? 1 : 0;
    cuF[27] = 0;
    this.prevSpawnU = this.spawnU;
    this.prevSpawnV = this.spawnV;
    this.prevSpawnActive = this.spawnActive;
    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, cu);

    // Render uniforms
    const ru = new Float32Array(4);
    ru[0] = c.size;
    ru[1] = c.glow;
    ru[2] = 0.6;            // depth_fade strength
    ru[3] = this.viewportW / Math.max(1, this.viewportH);
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ru.buffer);

    // Compute pass
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(this.computePipeline);
    cpass.setBindGroup(0, this.computeBindGroup);
    cpass.dispatchWorkgroups(Math.ceil(this.currentCapacity / 64));
    cpass.end();

    // Render pass: additive over the bridge frame
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: finalView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    rpass.setPipeline(this.renderPipeline);
    rpass.setBindGroup(0, this.renderBindGroup);
    rpass.draw(6, this.currentCapacity, 0, 0);
    rpass.end();

    this.stats.framesEncoded++;
    this.stats.spawnRate = this.spawnActive ? c.spawnRate : 0;
  }

  dispose(): void {
    try { this.particleBuffer?.destroy?.(); } catch { /* */ }
    try { this.computeUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.renderUniformBuffer?.destroy?.(); } catch { /* */ }
  }
}
