/**
 * WebGPUInkCloud — ink-in-water / volumetric smoke simulation.
 *
 * A continuous-emission particle system, fundamentally different from
 * Particle Field's static-population behavior modes. Up to 8 emitter
 * sources spawn particles in their own colors; particles advect under
 * a stack of forces (buoyancy + wind + multi-octave curl + optional
 * vortex), and respawn back at their assigned emitter when they age
 * out. The result reads as multiple distinct ink columns dispersing
 * through invisible currents.
 *
 * Particle lifecycle:
 *   1. At init, every particle in the pool is pre-assigned to one
 *      emitter (round-robin). The assignment is permanent — when the
 *      particle dies, it respawns at the SAME emitter, so each
 *      emitter has a steady-state population of `N / emitterCount`
 *      live particles.
 *   2. On spawn: pos = emitter.pos + small jitter; vel = small
 *      random; color = emitter.color; age = 0; lifetime = avgLifetime
 *      ± lifetimeVariation.
 *   3. Each frame: integrate forces (buoyancy + wind + curl + vortex),
 *      age += dt, evolve size + color over (age/lifetime).
 *   4. When age >= lifetime: respawn (back to step 2).
 *
 * Multi-octave curl:
 *   The chunky-but-organic internal cloud structure (think the swirls
 *   and sub-clouds in real ink-in-water photos) comes from sampling
 *   curl-of-noise at TWO scales and summing them. Octave 1 is the
 *   large primary swirl — gives the major motion. Octave 2 is fine
 *   detail at higher frequency — gives wispy edges and internal
 *   variation. Surfacing both as separate strength + scale knobs
 *   lets users tune from "smooth orb" to "stringy wisps" to
 *   "chunky cumulus."
 *
 * Particle layout (64 bytes per particle, std430-aligned):
 *   pos:   vec3<f32>  age:      f32      // current pos + current age
 *   vel:   vec3<f32>  lifetime: f32      // current vel + per-particle lifetime
 *   color: vec3<f32>  size:     f32      // current color + current size
 *   home:  vec3<f32>  emitter:  u32      // emitter pos (cached for respawn) + emitter id
 */

const PARTICLE_BYTES = 64;
const DEFAULT_PARTICLES = 150_000;
const MAX_PARTICLES = 600_000;
const MAX_EMITTERS = 8;

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}
function identityMat4(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI / 180) / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = far / (near - far); m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}
function translate(x: number, y: number, z: number): Float32Array {
  const m = identityMat4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/* ============================================================== */
/* SIMULATION COMPUTE — advect + age + respawn                    */
/* ============================================================== */
const SIM_WGSL = /* wgsl */ `
struct Particle {
  pos:      vec3<f32>, age:      f32,
  vel:      vec3<f32>, lifetime: f32,
  color:    vec3<f32>, size:     f32,
  home:     vec3<f32>, emitter:  u32,
};

struct Emitter {
  pos:   vec3<f32>, _p0: f32,
  color: vec3<f32>, _p1: f32,
};

struct U {
  // Block 0 — timing
  dt: f32, time: f32, particleCount: u32, emitterCount: u32,
  // Block 1 — lifetime
  avgLifetime: f32, lifetimeVar: f32, sizeStart: f32, sizeEnd: f32,
  // Block 2 — color evolution
  fadeColor: vec3<f32>, colorFadeAmount: f32,
  // Block 3 — forces
  buoyancy: f32, damping: f32, spawnJitter: f32, audioBurst: f32,
  // Block 4 — wind
  wind: vec3<f32>, _p2: f32,
  // Block 5 — curl octave 1
  curl1Strength: f32, curl1Scale: f32, curl1TimeFlow: f32, _p3: f32,
  // Block 6 — curl octave 2
  curl2Strength: f32, curl2Scale: f32, curl2TimeFlow: f32, _p4: f32,
  // Block 7 — vortex
  vortexCenter: vec3<f32>, vortexStrength: f32,
  vortexAxis:   vec3<f32>, vortexRadius:   f32,
  // Block 8 — audio
  bass: f32, treble: f32, shimmerStrength: f32, _p5: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform>             u:         U;
// Up to MAX_EMITTERS emitter records. We size the array generously
// in WGSL but only the first u.emitterCount entries are actually
// populated on the CPU side.
@group(0) @binding(2) var<storage, read>       emitters:  array<Emitter, ${MAX_EMITTERS}>;

fn hash3(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7,  74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}
fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  let nxy0 = mix(nx00, nx10, s.y);
  let nxy1 = mix(nx01, nx11, s.y);
  return mix(nxy0, nxy1, s.z) * 2.0 - 1.0;
}
fn curl(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = noise3(p + vec3<f32>(0.0,  e, 0.0));
  let ax2 = noise3(p + vec3<f32>(0.0, -e, 0.0));
  let ay1 = noise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = noise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  return vec3<f32>(ay1 - ay2, az1 - az2, ax1 - ax2) / (2.0 * e);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.particleCount) { return; }
  var p = particles[i];

  // ── Lifecycle / respawn ────────────────────────────────────────
  // Audio burst can artificially "kill" a chunk of particles by
  // forcing their age past lifetime. The chunk is hashed by particle
  // id so each bass hit refreshes a different subset, giving the
  // visible burst effect rather than a synchronized reset.
  let burstTrigger = u.audioBurst > 0.5 && hash3(vec3<f32>(f32(i) * 0.027, u.time, 1.0)) < u.audioBurst;

  if (p.age >= p.lifetime || burstTrigger) {
    // Respawn at the assigned emitter's position with a small jitter
    // so the spawn region has volume rather than a single point.
    let em = emitters[p.emitter];
    let r1 = (hash3(vec3<f32>(f32(i) * 0.13, u.time, 0.0)) - 0.5) * 2.0;
    let r2 = (hash3(vec3<f32>(f32(i) * 0.13, u.time, 1.0)) - 0.5) * 2.0;
    let r3 = (hash3(vec3<f32>(f32(i) * 0.13, u.time, 2.0)) - 0.5) * 2.0;
    p.pos      = em.pos + vec3<f32>(r1, r2, r3) * u.spawnJitter;
    p.home     = em.pos;
    p.color    = em.color;
    p.vel      = vec3<f32>(0.0, 0.0, 0.0);
    p.age      = 0.0;
    // Per-particle lifetime variance so dispersal isn't synchronized.
    let r4 = hash3(vec3<f32>(f32(i) * 0.077, u.time, 5.0)) * 2.0 - 1.0;
    p.lifetime = u.avgLifetime * (1.0 + r4 * u.lifetimeVar);
    p.size     = u.sizeStart;
  }

  // ── Forces ─────────────────────────────────────────────────────
  // Buoyancy — constant upward force; smoke rises.
  var force = vec3<f32>(0.0, u.buoyancy, 0.0);
  // Wind — directional force (user-controllable).
  force = force + u.wind;
  // Curl noise octave 1 — primary swirl.
  let p1 = p.pos * u.curl1Scale + vec3<f32>(0.0, 0.0, u.time * u.curl1TimeFlow);
  force = force + curl(p1) * u.curl1Strength;
  // Curl noise octave 2 — fine wispy detail at higher frequency.
  let p2 = p.pos * u.curl2Scale + vec3<f32>(11.0, 0.0, u.time * u.curl2TimeFlow);
  force = force + curl(p2) * u.curl2Strength;
  // Vortex — rotational pull around a moving center, in a plane
  // perpendicular to vortexAxis. Strength tapers smoothly with
  // distance from the axis line so the swirl has a soft falloff.
  if (u.vortexStrength > 0.001) {
    let toCenter = p.pos - u.vortexCenter;
    let axisN    = normalize(u.vortexAxis);
    let proj     = dot(toCenter, axisN) * axisN;
    let radial   = toCenter - proj;
    let rLen     = length(radial);
    if (rLen > 1e-4) {
      let tangent = normalize(cross(axisN, radial));
      let falloff = exp(-rLen * rLen / max(u.vortexRadius * u.vortexRadius, 1e-4));
      force = force + tangent * u.vortexStrength * falloff;
    }
  }
  // Treble shimmer — small per-particle noise added to velocity.
  let jx = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 0.0)) - 0.5) * 2.0;
  let jy = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 1.0)) - 0.5) * 2.0;
  let jz = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 2.0)) - 0.5) * 2.0;
  force = force + vec3<f32>(jx, jy, jz) * u.shimmerStrength * u.treble;

  // Integrate.
  p.vel = p.vel + force * u.dt;
  p.vel = p.vel * (1.0 - u.damping * u.dt);
  p.pos = p.pos + p.vel * u.dt;
  p.age = p.age + u.dt;

  // ── Visual evolution over life ──────────────────────────────────
  // Normalized life 0..1. Used to grow size and decay color/alpha.
  let lifeT = clamp(p.age / max(p.lifetime, 0.001), 0.0, 1.0);
  // Size: linear interpolation from sizeStart to sizeEnd. Particles
  // typically grow as they age (smoke disperses outward).
  p.size = mix(u.sizeStart, u.sizeEnd, lifeT);
  // Color: blend toward the user-set fade color over life. With fade
  // = dark, particles dim into the background as they die. With
  // fade = white, they brighten before vanishing (softer ending).
  let evolvedColor = mix(emitters[p.emitter].color, u.fadeColor, lifeT * u.colorFadeAmount);
  p.color = evolvedColor;

  particles[i] = p;
}
`;

/* ============================================================== */
/* RENDER — additive soft billboards                              */
/* ============================================================== */
const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos:      vec3<f32>, age:      f32,
  vel:      vec3<f32>, lifetime: f32,
  color:    vec3<f32>, size:     f32,
  home:     vec3<f32>, emitter:  u32,
};

struct UR {
  viewProj:    mat4x4<f32>,
  camRight:    vec3<f32>,
  _p0:         f32,
  camUp:       vec3<f32>,
  _p1:         f32,
  // particle render params
  brightness:  f32,
  alphaScale:  f32,
  density:     f32,        // soft-edge falloff exponent in fragment
  _p2:         f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform>       u:         UR;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,
  @location(1) color:     vec3<f32>,
  @location(2) alpha:     f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = particles[iid];

  let xy = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
  );
  let q = xy[vid];
  let offset = u.camRight * (q.x * p.size) + u.camUp * (q.y * p.size);
  let worldPos = p.pos + offset;

  // Alpha: fade in from spawn (first 10% of life) + fade out near
  // death (last 30% of life). Without the spawn fade-in, particles
  // pop in at their full alpha which looks discrete; the smooth
  // ramp makes the emission look continuous and dust-like.
  let lifeT = clamp(p.age / max(p.lifetime, 0.001), 0.0, 1.0);
  let fadeIn  = smoothstep(0.0, 0.1, lifeT);
  let fadeOut = 1.0 - smoothstep(0.7, 1.0, lifeT);
  let lifeAlpha = fadeIn * fadeOut;

  var out: VSOut;
  out.pos   = u.viewProj * vec4<f32>(worldPos, 1.0);
  out.uv    = q;                                 // -1..1 for radial fragment shader
  out.color = p.color * u.brightness;
  out.alpha = lifeAlpha * u.alphaScale;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  // Soft exponential disc — the high overlap of premultiplied-alpha
  // discs gives the volumetric density. u.density exponent shapes
  // the edge softness: low = fluffy halos, high = sharper puffs.
  let mask = exp(-d * d * u.density);
  let a = in.alpha * mask;
  // Premultiplied output — composites cleanly with the bg fill +
  // other particles in the same render pass.
  return vec4<f32>(in.color * a, a);
}
`;

/* ============================================================== */
/* BACKGROUND FILL — solid color base                             */
/* ============================================================== */
const BG_WGSL = /* wgsl */ `
struct UB { color: vec3<f32>, opacity: f32, };
@group(0) @binding(0) var<uniform> u: UB;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  return vec4<f32>(positions[vid], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  let a = u.opacity;
  return vec4<f32>(u.color * a, a);
}
`;

/* ============================================================== */
/* TYPESCRIPT WRAPPER                                              */
/* ============================================================== */

export interface InkCloudParams {
  particleCount: number;
  // Emitters — auto-arranged on a circle in the XZ plane at radius `spread`.
  // Y position controlled by `spawnY` (slightly below center for "ink rising
  // from below" feel).
  emitterCount: number;
  spread: number;
  spawnY: number;
  spawnJitter: number;
  // Lifecycle
  avgLifetime: number;
  lifetimeVar: number;
  sizeStart: number;
  sizeEnd: number;
  // Color evolution
  fadeColor: [number, number, number];
  colorFadeAmount: number;
  // Forces
  buoyancy: number;
  damping: number;
  windX: number;
  windY: number;
  windZ: number;
  // Curl octave 1
  curl1Strength: number;
  curl1Scale: number;
  curl1TimeFlow: number;
  // Curl octave 2
  curl2Strength: number;
  curl2Scale: number;
  curl2TimeFlow: number;
  // Vortex
  vortexEnabled: boolean;
  vortexStrength: number;
  vortexRadius: number;
  vortexAxisX: number;
  vortexAxisY: number;
  vortexAxisZ: number;
  // Audio
  bass: number;
  treble: number;
  audioBurstStrength: number;
  shimmerStrength: number;
  // Render
  brightness: number;
  alphaScale: number;
  density: number;
  // Background
  bgColor: [number, number, number];
  bgOpacity: number;
  // Emitter colors — eight slots; only first emitterCount are used
  // (extras ignored). Stored 0..1 RGB.
  emitterColors: [number, number, number][];
  // Camera + object rotation
  fovDeg: number;
  cameraZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  autoRotateX: number;
  autoRotateY: number;
  autoRotateZ: number;
}

const DEFAULT_PARAMS: InkCloudParams = {
  particleCount: DEFAULT_PARTICLES,
  emitterCount: 4,
  spread: 0.4,
  spawnY: -0.4,
  spawnJitter: 0.04,
  avgLifetime: 3.0,
  lifetimeVar: 0.3,
  sizeStart: 0.008,
  sizeEnd: 0.05,
  fadeColor: [0.04, 0.05, 0.10],
  colorFadeAmount: 1.0,
  buoyancy: 0.18,
  damping: 0.6,
  windX: 0, windY: 0, windZ: 0,
  curl1Strength: 0.3,
  curl1Scale: 1.6,
  curl1TimeFlow: 0.15,
  curl2Strength: 0.18,
  curl2Scale: 5.0,
  curl2TimeFlow: 0.4,
  vortexEnabled: false,
  vortexStrength: 0.6,
  vortexRadius: 0.5,
  vortexAxisX: 0, vortexAxisY: 1, vortexAxisZ: 0,
  bass: 0, treble: 0,
  audioBurstStrength: 0.3,
  shimmerStrength: 0.04,
  brightness: 1.2,
  alphaScale: 0.55,
  density: 2.5,
  bgColor: [0.04, 0.04, 0.08],
  bgOpacity: 1.0,
  // Emitter palette — vivid ink-in-water colors. Tunable via the
  // panel's Emitter Color A-D pickers (extras 5-8 cycle the palette).
  emitterColors: [
    [1.00, 0.40, 0.18],   // warm orange
    [0.18, 0.78, 1.00],   // cyan
    [0.85, 0.20, 0.85],   // magenta
    [0.20, 0.95, 0.55],   // lime green
    [1.00, 0.85, 0.30],   // gold
    [0.50, 0.30, 1.00],   // deep purple
    [1.00, 0.30, 0.55],   // hot pink
    [0.30, 1.00, 0.95],   // mint
  ],
  fovDeg: 50,
  cameraZ: 2.4,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  autoRotateX: 0,
  autoRotateY: 0,
  autoRotateZ: 0,
};

const BLEND_PREMULT_OVER: any = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export class WebGPUInkCloud {
  private device: any;
  private presentFormat: any;
  // Buffers
  private particleBuffer: any = null;
  private simUniform: any;
  private renderUniform: any;
  private bgUniform: any;
  private emitterBuffer: any;
  // Pipelines + bind groups
  private bgPipeline: any;
  private bgLayout: any;
  private bgBindGroup: any = null;
  private simPipeline: any;
  private simLayout: any;
  private simBindGroup: any = null;
  private renderPipeline: any;
  private renderLayout: any;
  private renderBindGroup: any = null;

  private params: InkCloudParams = { ...DEFAULT_PARAMS };
  private particleCount = DEFAULT_PARTICLES;
  private viewportW = 1920;
  private viewportH = 1080;
  private prevFrameTime = 0;
  private autoRotXPhase = 0;
  private autoRotYPhase = 0;
  private autoRotZPhase = 0;
  // Audio burst latch — when bass spikes, hold burst high for a few
  // frames so visible chunk gets refreshed across more particles
  // than a single dispatch can cover.
  private burstHoldTimer = 0;
  private prevBass = 0;

  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.init();
  }

  private init(): void {
    // ── Uniform buffers ────────────────────────────────────────
    // Sim uniform: 9 16-byte blocks = 144 bytes. Round to 192 for headroom.
    this.simUniform = this.device.createBuffer({
      size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Render uniform: 64 (viewProj) + 16 + 16 + 16 = 112. Round to 128.
    this.renderUniform = this.device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Background uniform: 16 bytes (color + opacity).
    this.bgUniform = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Emitter buffer: 8 emitters * 32 bytes (vec3 pos + pad + vec3
    // color + pad) = 256 bytes.
    this.emitterBuffer = this.device.createBuffer({
      size: MAX_EMITTERS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // ── Particle buffer (sized by setParticleCount) ────────────
    this.allocateParticleBuffer(this.particleCount);

    // ── Pipelines ──────────────────────────────────────────────
    this.buildPipelines();
    this.rebuildBindGroups();
    this.writeEmitterBuffer();
  }

  private allocateParticleBuffer(n: number): void {
    n = Math.max(1024, Math.min(MAX_PARTICLES, Math.floor(n)));
    if (this.particleBuffer) { try { this.particleBuffer.destroy?.(); } catch { /* */ } }
    this.particleBuffer = this.device.createBuffer({
      size: n * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.particleCount = n;
    this.seedParticles();
    if (this.simLayout) this.rebuildBindGroups();
  }

  /** Seed: every particle starts already "dead" (age >= lifetime) so
   *  the first compute pass respawns them all at their assigned
   *  emitter. This avoids a visible "synchronized burst" on init. */
  private seedParticles(): void {
    const n = this.particleCount;
    const buf = new ArrayBuffer(n * PARTICLE_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    const emCount = Math.max(1, Math.min(MAX_EMITTERS, this.params.emitterCount | 0));

    for (let i = 0; i < n; i++) {
      const off = i * 16;  // 64 / 4 = 16 floats per particle
      // Random pre-existing-life so respawn is staggered across
      // ~lifetime seconds, giving an immediately-flowing emission
      // rather than all particles spawning on the same frame.
      const initAge = Math.random() * this.params.avgLifetime;
      const initLife = this.params.avgLifetime;
      // pos + age
      f[off + 0] = 0; f[off + 1] = 0; f[off + 2] = 0; f[off + 3] = initAge;
      // vel + lifetime
      f[off + 4] = 0; f[off + 5] = 0; f[off + 6] = 0; f[off + 7] = initLife;
      // color + size
      f[off + 8] = 0; f[off + 9] = 0; f[off + 10] = 0; f[off + 11] = this.params.sizeStart;
      // home + emitter
      f[off + 12] = 0; f[off + 13] = 0; f[off + 14] = 0;
      u[off + 15] = (i % emCount) >>> 0;  // round-robin assignment
    }
    this.device.queue.writeBuffer(this.particleBuffer, 0, buf);
  }

  /** Recompute emitter positions + colors on the GPU. Called when
   *  emitter count, spread, spawnY, or any emitter color changes. */
  private writeEmitterBuffer(): void {
    const buf = new ArrayBuffer(MAX_EMITTERS * 32);
    const f = new Float32Array(buf);
    const emCount = Math.max(1, Math.min(MAX_EMITTERS, this.params.emitterCount | 0));
    for (let i = 0; i < MAX_EMITTERS; i++) {
      const off = i * 8;  // 32 bytes / 4 = 8 floats per emitter
      // Position: emitter i at angle (i / emCount) * 2π on the XZ
      // circle of radius `spread`. emitterCount=1 → single point at
      // origin; emitterCount=8 → 8 points evenly spaced.
      const angle = emCount > 1 ? (i / emCount) * Math.PI * 2 : 0;
      f[off + 0] = Math.cos(angle) * this.params.spread;
      f[off + 1] = this.params.spawnY;
      f[off + 2] = Math.sin(angle) * this.params.spread;
      // pad at off+3
      // Color: cycle through user-set palette
      const col = this.params.emitterColors[i % this.params.emitterColors.length] ?? [1, 1, 1];
      f[off + 4] = col[0]; f[off + 5] = col[1]; f[off + 6] = col[2];
      // pad at off+7
    }
    this.device.queue.writeBuffer(this.emitterBuffer, 0, buf);
  }

  private buildPipelines(): void {
    // Background
    const bgMod = this.device.createShaderModule({ code: BG_WGSL });
    this.bgLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.bgPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bgLayout] }),
      vertex:   { module: bgMod, entryPoint: 'vs_main' },
      fragment: {
        module: bgMod,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Sim compute
    const simMod = this.device.createShaderModule({ code: SIM_WGSL });
    this.simLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.simPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.simLayout] }),
      compute: { module: simMod, entryPoint: 'cs_main' },
    });

    // Render
    const renderMod = this.device.createShaderModule({ code: RENDER_WGSL });
    this.renderLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderLayout] }),
      vertex:   { module: renderMod, entryPoint: 'vs_main' },
      fragment: {
        module: renderMod,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private rebuildBindGroups(): void {
    this.bgBindGroup = this.device.createBindGroup({
      layout: this.bgLayout,
      entries: [{ binding: 0, resource: { buffer: this.bgUniform } }],
    });
    this.simBindGroup = this.device.createBindGroup({
      layout: this.simLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.simUniform } },
        { binding: 2, resource: { buffer: this.emitterBuffer } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniform } },
      ],
    });
  }

  setParams(p: Partial<InkCloudParams>): void {
    const wasCount = this.params.particleCount;
    const wasEmitter = this.params.emitterCount;
    const wasSpread = this.params.spread;
    const wasSpawnY = this.params.spawnY;
    const wasColors = this.params.emitterColors;
    this.params = { ...this.params, ...p };
    if (this.params.particleCount !== wasCount) {
      this.allocateParticleBuffer(this.params.particleCount);
    }
    // Emitter buffer needs rewrite when count, layout, or any color changed.
    const colorsChanged = wasColors !== this.params.emitterColors;
    if (this.params.emitterCount !== wasEmitter
        || this.params.spread !== wasSpread
        || this.params.spawnY !== wasSpawnY
        || colorsChanged) {
      this.writeEmitterBuffer();
    }
  }

  setViewport(w: number, h: number): void { this.viewportW = w; this.viewportH = h; }

  encodeFrame(encoder: any, targetView: any): void {
    const now = performance.now() / 1000;
    let dt = this.prevFrameTime === 0 ? 1 / 60 : (now - this.prevFrameTime);
    dt = Math.min(Math.max(dt, 0.001), 1 / 15);
    this.prevFrameTime = now;

    // Audio burst — bass rising edge spikes the burst hold timer.
    // Held over ~150ms so the burst affects multiple frames'
    // worth of particles (one frame's compute dispatch otherwise
    // refreshes only one slice of the pool because of the hashed
    // selection).
    const bassDelta = Math.max(0, this.params.bass - this.prevBass);
    if (bassDelta > 0.05) this.burstHoldTimer = Math.max(this.burstHoldTimer, 0.15);
    this.burstHoldTimer = Math.max(0, this.burstHoldTimer - dt);
    this.prevBass = this.params.bass;
    const audioBurst = this.burstHoldTimer > 0 ? this.params.audioBurstStrength : 0;

    this.autoRotXPhase += this.params.autoRotateX * dt;
    this.autoRotYPhase += this.params.autoRotateY * dt;
    this.autoRotZPhase += this.params.autoRotateZ * dt;

    // ── Sim uniform ────────────────────────────────────────────
    const sBuf = new ArrayBuffer(192);
    const sF = new Float32Array(sBuf);
    const sU = new Uint32Array(sBuf);
    // Block 0
    sF[0] = dt; sF[1] = now;
    sU[2] = this.particleCount >>> 0;
    sU[3] = Math.max(1, Math.min(MAX_EMITTERS, this.params.emitterCount | 0)) >>> 0;
    // Block 1 — lifetime
    sF[4] = this.params.avgLifetime;
    sF[5] = this.params.lifetimeVar;
    sF[6] = this.params.sizeStart;
    sF[7] = this.params.sizeEnd;
    // Block 2 — color evolution
    sF[8] = this.params.fadeColor[0]; sF[9] = this.params.fadeColor[1]; sF[10] = this.params.fadeColor[2];
    sF[11] = this.params.colorFadeAmount;
    // Block 3 — forces
    sF[12] = this.params.buoyancy;
    sF[13] = this.params.damping;
    sF[14] = this.params.spawnJitter;
    sF[15] = audioBurst;
    // Block 4 — wind
    sF[16] = this.params.windX; sF[17] = this.params.windY; sF[18] = this.params.windZ;
    // Block 5 — curl 1
    sF[20] = this.params.curl1Strength;
    sF[21] = this.params.curl1Scale;
    sF[22] = this.params.curl1TimeFlow;
    // Block 6 — curl 2
    sF[24] = this.params.curl2Strength;
    sF[25] = this.params.curl2Scale;
    sF[26] = this.params.curl2TimeFlow;
    // Block 7 — vortex
    const vEnabled = this.params.vortexEnabled ? 1 : 0;
    sF[28] = 0; sF[29] = 0; sF[30] = 0;  // vortexCenter (origin for v1)
    sF[31] = this.params.vortexStrength * vEnabled;
    sF[32] = this.params.vortexAxisX;
    sF[33] = this.params.vortexAxisY;
    sF[34] = this.params.vortexAxisZ;
    sF[35] = this.params.vortexRadius;
    // Block 8 — audio
    sF[36] = this.params.bass;
    sF[37] = this.params.treble;
    sF[38] = this.params.shimmerStrength;
    this.device.queue.writeBuffer(this.simUniform, 0, sBuf);

    // ── Sim compute pass ───────────────────────────────────────
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.simPipeline);
      pass.setBindGroup(0, this.simBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
      pass.end();
    }

    // ── Camera + object rotation ───────────────────────────────
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const proj = perspective(this.params.fovDeg, aspect, 0.05, 100);
    const view = translate(0, 0, -this.params.cameraZ);
    const D2R = Math.PI / 180;
    const rxRad = (this.params.rotateX + this.autoRotXPhase) * D2R;
    const ryRad = (this.params.rotateY + this.autoRotYPhase) * D2R;
    const rzRad = (this.params.rotateZ + this.autoRotZPhase) * D2R;
    const cx = Math.cos(rxRad), sx = Math.sin(rxRad);
    const cyy = Math.cos(ryRad), syy = Math.sin(ryRad);
    const cz = Math.cos(rzRad), sz = Math.sin(rzRad);
    const rxM = new Float32Array([1, 0, 0, 0,  0, cx, sx, 0,  0, -sx, cx, 0,  0, 0, 0, 1]);
    const ryM = new Float32Array([cyy, 0, -syy, 0,  0, 1, 0, 0,  syy, 0, cyy, 0,  0, 0, 0, 1]);
    const rzM = new Float32Array([cz, sz, 0, 0,  -sz, cz, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);
    const objRot = mat4Mul(rzM, mat4Mul(ryM, rxM));
    const viewProj = mat4Mul(proj, mat4Mul(view, objRot));

    // ── Render uniform ─────────────────────────────────────────
    const rBuf = new ArrayBuffer(128);
    const rF = new Float32Array(rBuf);
    rF.set(viewProj, 0);
    rF[16] = 1; rF[17] = 0; rF[18] = 0;       // camRight
    rF[20] = 0; rF[21] = 1; rF[22] = 0;       // camUp
    rF[24] = this.params.brightness;
    rF[25] = this.params.alphaScale;
    rF[26] = this.params.density;
    this.device.queue.writeBuffer(this.renderUniform, 0, rBuf);

    // ── Background uniform ─────────────────────────────────────
    const bBuf = new ArrayBuffer(16);
    const bF = new Float32Array(bBuf);
    bF[0] = this.params.bgColor[0];
    bF[1] = this.params.bgColor[1];
    bF[2] = this.params.bgColor[2];
    bF[3] = this.params.bgOpacity;
    this.device.queue.writeBuffer(this.bgUniform, 0, bBuf);

    // ── Render passes — bg then particles ──────────────────────
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    if (this.params.bgOpacity > 0.001) {
      pass.setPipeline(this.bgPipeline);
      pass.setBindGroup(0, this.bgBindGroup);
      pass.draw(3, 1, 0, 0);
    }
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(6, this.particleCount, 0, 0);
    pass.end();
  }

  dispose(): void {
    try { this.particleBuffer?.destroy?.(); } catch { /* */ }
    try { this.simUniform?.destroy?.(); } catch { /* */ }
    try { this.renderUniform?.destroy?.(); } catch { /* */ }
    try { this.bgUniform?.destroy?.(); } catch { /* */ }
    try { this.emitterBuffer?.destroy?.(); } catch { /* */ }
    this.particleBuffer = null;
  }
}
