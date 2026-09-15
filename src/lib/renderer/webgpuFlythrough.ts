import { getGhostGpuRuntime } from './webgpuShared';
import { createAndWarmWgslShaderModule, resolveGhostWgsl } from './wgsl';
import { getParticleDirectorShaderSource } from './particleDirector';

/**
 * WebGPUFlythrough — endless point-cloud tunnel through any 2D source.
 *
 * Visual concept: take an image or video frame, derive a depth field
 * from it (luminance / edge density), seed N particles across the UV
 * anchor grid, and replicate the resulting 3D cloud into K "slabs"
 * stacked along the camera's Z axis. Move the camera forward through
 * them continuously; whenever a slab passes behind the camera, wrap
 * its Z offset to the far end of the stack. Net effect: the user
 * appears to fly THROUGH an infinite recursion of the source.
 *
 * Why a dedicated renderer (not a mode of WebGPUPixelParticles):
 *   - Camera model is fundamentally different — auto-translating Z
 *     accumulator, not a fixed orbit-from-knobs camera.
 *   - Particle topology is fundamentally different — either point
 *     sprites OR velocity-extruded quads (worm/brush strokes), the
 *     latter needing 6 verts/particle in an instanced draw.
 *   - Slab replication is unique to this mode — single particle
 *     buffer rendered as K instances at staggered Z offsets.
 *   - Curl-noise advection (rather than per-mode arithmetic) drives
 *     particle motion, giving the fluid-worm look without a fluid sim.
 * Cramming all of this into PixelParticles would double its size and
 * obscure both implementations. Routing flythrough mode to this class
 * keeps both clean.
 *
 * Architecture per frame:
 *   1. Update source texture if it's a video frame (one writeTexture
 *      per frame at ~1ms for 1080p; cheap relative to the visual).
 *   2. Tick `flyDistance` by `flySpeed * dt`. Accumulator wraps
 *      naturally through the modulo in the vertex shader.
 *   3. Compute pass — one thread per particle:
 *        - Compute curl-noise velocity at current pos
 *        - Lerp velocity toward (curl + anchor-pull) over dt
 *        - Integrate position by velocity * dt
 *      Particles near their anchor swirl smoothly; particles that
 *      escape get yanked back by anchor-pull. No need to reset
 *      particles — the slab recycling in the vertex shader handles
 *      the spatial wrap.
 *   4. Render pass — instanced draw with K instances:
 *        - Vertex shader: decode (instance_id, vertex_id) →
 *          (slab_index, particle_corner). Compute slab Z offset via
 *          modulo-wrap of flyDistance. Add to particle.pos. Project.
 *        - Stroke topology: extrude the particle into a quad along
 *          its velocity vector; UV.x runs head→tail for the alpha
 *          taper.
 *        - Point topology: classic billboard, size scales with depth.
 *        - Fragment shader: sample source texture at particle's
 *          anchor UV, multiply by alpha taper (strokes) or radial
 *          falloff (points). Output additive over whatever's behind.
 *
 * Particle layout (48 bytes per particle, std430-aligned):
 *   pos:         vec3<f32>     // slab-local 3D position
 *   alpha:       f32           // per-particle alpha
 *   vel:         vec3<f32>     // current velocity (used for stroke direction)
 *   depthAnchor: f32           // source-derived Z anchor
 *   anchor:      vec2<f32>     // fixed XY anchor in [-1..1]
 *   signal:      vec2<f32>     // x = remembered luma (<0 = unread), y = change
 */

const PARTICLE_BYTES = 48;
const MAX_PARTICLES = 1_000_000;
const DEFAULT_PARTICLES = 250_000;

type Topology = 'points' | 'strokes';
type DepthSource = 'luminance' | 'inverse-luminance' | 'edge-density';

const DEPTH_SRC_IDS: Record<DepthSource, number> = {
  'luminance': 0,
  'inverse-luminance': 1,
  'edge-density': 2,
};

/** Column-major 4x4 multiply: out = a × b. */
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
  m[0] = f / aspect;
  m[5] = f;
  // Flythrough's tunnel is authored in front of the camera along +Z.
  // WebGPU clip depth is 0..1, so use a forward-Z projection (w = +z).
  m[10] = far / (far - near);
  m[11] = 1;
  m[14] = -(near * far) / (far - near);
  return m;
}

function translate(x: number, y: number, z: number): Float32Array {
  const m = identityMat4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/* ============================================================== */
/* CURL FIELD — baked once into a storage buffer                   */
/* ============================================================== */
/*
 * The flow used to be evaluated per particle, per frame: curl by central
 * differences is twelve value-noise lookups, each eight sin-hashes, so 96
 * hashes for every particle every frame. At a million particles that was the
 * bulk of the compute pass.
 *
 * The field is static in its own coordinates (time only ever slid the sample
 * point along Z), so it is baked once into a periodic grid and particles read
 * it with one trilinear lookup. Periodic so the grid can wrap with no seam:
 * the lattice hash is taken modulo CURL_PERIOD, which makes the noise, and so
 * its curl, exactly repeat. The period is wide enough that even at the top of
 * the Flow Scale slider a slab is two thirds of one repeat across, so the
 * repeat never shows inside the frame.
 *
 * The hash is integer (PCG3D) rather than fract(sin()). sin-hashes lose
 * precision at large lattice coordinates and band on some GPUs; a baked field
 * would freeze any banding in place, so it is worth not having.
 */
export const FLYTHROUGH_CURL_GRID_N = 80;
export const FLYTHROUGH_CURL_PERIOD = 24;
export const FLYTHROUGH_CURL_BYTES = FLYTHROUGH_CURL_GRID_N ** 3 * 16;

const CURL_BAKE_WGSL = /* wgsl */ `
struct BakeU {
  n:      u32,
  period: u32,
  _a:     u32,
  _b:     u32,
};

@group(0) @binding(0) var<storage, read_write> curlField: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> bu: BakeU;

fn pcg3d(input: vec3<u32>) -> vec3<u32> {
  var v = input * 1664525u + 1013904223u;
  v.x = v.x + v.y * v.z;
  v.y = v.y + v.z * v.x;
  v.z = v.z + v.x * v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x = v.x + v.y * v.z;
  v.y = v.y + v.z * v.x;
  v.z = v.z + v.x * v.y;
  return v;
}

fn latticeHash(i: vec3<f32>) -> f32 {
  let period = i32(bu.period);
  let x = ((i32(i.x) % period) + period) % period;
  let y = ((i32(i.y) % period) + period) % period;
  let z = ((i32(i.z) % period) + period) % period;
  let h = pcg3d(vec3<u32>(u32(x), u32(y), u32(z)));
  return f32(h.x) / 4294967295.0;
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = latticeHash(i);
  let n100 = latticeHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = latticeHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = latticeHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = latticeHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = latticeHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = latticeHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = latticeHash(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z) * 2.0 - 1.0;
}

// curl(A) for a vector potential A made of three decorrelated noise fields,
// by central differences. Divergence-free, so the flow swirls rather than
// sources or sinks. The offsets (11, 31, 47) decorrelate the three fields and
// stay inside one period.
fn curl(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let dx = vec3<f32>(e, 0.0, 0.0);
  let dy = vec3<f32>(0.0, e, 0.0);
  let dz = vec3<f32>(0.0, 0.0, e);
  let ox = vec3<f32>(0.0, 0.0, 11.0);
  let oy = vec3<f32>(31.0, 0.0, 0.0);
  let oz = vec3<f32>(0.0, 47.0, 0.0);
  let cx = (noise3(p + dy + ox) - noise3(p - dy + ox)) - (noise3(p + dz + ox) - noise3(p - dz + ox));
  let cy = (noise3(p + dz + oy) - noise3(p - dz + oy)) - (noise3(p + dx + oy) - noise3(p - dx + oy));
  let cz = (noise3(p + dx + oz) - noise3(p - dx + oz)) - (noise3(p + dy + oz) - noise3(p - dy + oz));
  return vec3<f32>(cx, cy, cz) / (2.0 * e);
}

@compute @workgroup_size(4, 4, 4)
fn cs_bake(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= bu.n || gid.y >= bu.n || gid.z >= bu.n) { return; }
  let cell = f32(bu.period) / f32(bu.n);
  let c = curl(vec3<f32>(gid) * cell);
  curlField[gid.x + bu.n * (gid.y + bu.n * gid.z)] = vec4<f32>(c, 0.0);
}
`;

/* ============================================================== */
/* COMPUTE SHADER — baked curl advection + anchor + wander + signal */
/* ============================================================== */
const COMPUTE_WGSL = /* wgsl */ `
struct Particle {
  pos:         vec3<f32>,
  alpha:       f32,
  vel:         vec3<f32>,
  depthAnchor: f32,
  anchor:      vec2<f32>,
  // x = the source luma this particle remembers (negative until the first
  //     frame has been read), y = how much its pixel is changing right now.
  signal:      vec2<f32>,
};

struct U {
  dt:              f32,
  time:            f32,
  flowStrength:    f32,
  flowScale:       f32,
  anchorPull:      f32,
  tunnelDepth:     f32,
  depthStrength:   f32,
  particleCount:   u32,
  depthSource:     u32,
  flyDistance:     f32,
  mirrorX:         u32,
  wanderRadius:    f32,   // 0 = unbounded
  motionReactive:  f32,   // 0 = off
  motionDecay:     f32,   // how fast the remembered luma catches up, 1/s
  curlGridN:       u32,
  curlPeriod:      f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;
@group(0) @binding(4) var<storage, read> curlField: array<vec4<f32>>;

fn curlAt(x: i32, y: i32, z: i32) -> vec3<f32> {
  let n = i32(u.curlGridN);
  let wx = ((x % n) + n) % n;
  let wy = ((y % n) + n) % n;
  let wz = ((z % n) + n) % n;
  return curlField[u32(wx + n * (wy + n * wz))].xyz;
}

// One trilinear read of the baked field, wrapping at the period.
fn sampleCurl(p: vec3<f32>) -> vec3<f32> {
  let g = p / u.curlPeriod * f32(u.curlGridN);
  let base = floor(g);
  let f = g - base;
  let ix = i32(base.x);
  let iy = i32(base.y);
  let iz = i32(base.z);
  let c00 = mix(curlAt(ix, iy, iz),         curlAt(ix + 1, iy, iz),         f.x);
  let c10 = mix(curlAt(ix, iy + 1, iz),     curlAt(ix + 1, iy + 1, iz),     f.x);
  let c01 = mix(curlAt(ix, iy, iz + 1),     curlAt(ix + 1, iy, iz + 1),     f.x);
  let c11 = mix(curlAt(ix, iy + 1, iz + 1), curlAt(ix + 1, iy + 1, iz + 1), f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}

fn sourceLumaAt(uv: vec2<f32>) -> f32 {
  let color = textureSampleLevel(sourceTexture, sourceSampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
  return dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114));
}

fn sourceDepthAt(uv: vec2<f32>, mode: u32) -> f32 {
  let y = sourceLumaAt(uv);
  if (mode == 1u) {
    return 1.0 - y;
  }
  if (mode == 2u) {
    let dims = max(textureDimensions(sourceTexture), vec2<u32>(1u, 1u));
    let texel = 1.0 / vec2<f32>(dims);
    let dx = abs(sourceLumaAt(uv + vec2<f32>(texel.x, 0.0)) - sourceLumaAt(uv - vec2<f32>(texel.x, 0.0)));
    let dy = abs(sourceLumaAt(uv + vec2<f32>(0.0, texel.y)) - sourceLumaAt(uv - vec2<f32>(0.0, texel.y)));
    return clamp((dx + dy) * 4.0, 0.0, 1.0);
  }
  return y;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.particleCount) { return; }
  var p = particles[i];
  var anchorUV = vec2<f32>(p.anchor.x * 0.5 + 0.5, 1.0 - (p.anchor.y * 0.5 + 0.5));
  if (u.mirrorX == 1u) { anchorUV.x = 1.0 - anchorUV.x; }
  let sourceColor = textureSampleLevel(sourceTexture, sourceSampler, anchorUV, 0.0);
  let sourceDepth = sourceDepthAt(anchorUV, u.depthSource);
  let sourceMix = clamp(u.dt * 12.0, 0.0, 1.0);
  p.depthAnchor = mix(p.depthAnchor, sourceDepth, sourceMix);
  p.alpha = max(0.02, sourceColor.a);

  // ── Signal: how much this particle's pixel is changing ──
  // A remembered luma that catches up at motionDecay per second. The gap
  // between it and the live luma is the change, so a still image settles to
  // zero and only moving video drives anything. Always tracked, even with
  // reactivity off, so switching it on mid-set does not fire every particle
  // at once against a stale memory.
  let luma = dot(sourceColor.rgb, vec3<f32>(0.299, 0.587, 0.114));
  if (p.signal.x < 0.0) { p.signal.x = luma; }
  let change = abs(luma - p.signal.x);
  p.signal.x = mix(p.signal.x, luma, 1.0 - exp(-u.dt * max(u.motionDecay, 0.0)));
  p.signal.y = mix(p.signal.y, change, clamp(u.dt * 20.0, 0.0, 1.0));

  // Baked curl, sampled in the slab-local frame. flowScale=1 is roughly one
  // swirl across a slab; time slides the sample point along Z so the flow
  // keeps evolving without re-baking anything.
  let samplePos = p.pos * u.flowScale + vec3<f32>(0.0, 0.0, u.time * 0.1);
  let flow = sampleCurl(samplePos) * u.flowStrength;

  // Anchor pull keeps the image legible by drawing particles back to where
  // their pixel lives.
  let homeXY = vec3<f32>(p.anchor.x, p.anchor.y, p.depthAnchor * u.depthStrength);
  let pull = (homeXY - p.pos) * u.anchorPull;

  var targetVel = flow + pull;
  if (u.motionReactive > 0.0) {
    // Changing pixels burst along their flow and toward the camera.
    let along = flow / max(length(flow), 0.0001);
    targetVel = targetVel + (along + vec3<f32>(0.0, 0.0, -0.6)) * p.signal.y * u.motionReactive * 6.0;
  }
  p.vel = mix(p.vel, targetVel, clamp(u.dt * 6.0, 0.0, 1.0));
  p.pos = p.pos + p.vel * u.dt;

  // ── Wander radius ──
  // A hard limit on how far a particle may travel from its pixel. Anchor
  // pull is a spring, so strong flow or a burst of reactivity can still carry
  // particles far enough to lose the picture; this is the guarantee. Outward
  // velocity is cancelled as a particle nears the rim so it slides along the
  // boundary instead of piling onto it.
  if (u.wanderRadius > 0.0) {
    let offset = p.pos - homeXY;
    let r = length(offset);
    if (r > 0.00001) {
      let dir = offset / r;
      let rim = smoothstep(u.wanderRadius * 0.7, u.wanderRadius, r);
      p.vel = p.vel - dir * max(dot(p.vel, dir), 0.0) * rim;
      if (r > u.wanderRadius) {
        p.pos = homeXY + dir * u.wanderRadius;
      }
    }
  }

  // Keep particles inside the slab's Z range. The slab itself wraps in the
  // vertex shader, but a particle outside it would pierce the next slab.
  let halfDepth = u.tunnelDepth * 0.5;
  if (p.pos.z >  halfDepth) { p.pos.z = -halfDepth; }
  if (p.pos.z < -halfDepth) { p.pos.z =  halfDepth; }

  particles[i] = p;
}
`;

/* ============================================================== */
/* RENDER SHADER — point and stroke topology in one module        */
/* ============================================================== */
const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos:         vec3<f32>,
  alpha:       f32,
  vel:         vec3<f32>,
  depthAnchor: f32,
  anchor:      vec2<f32>,
  signal:      vec2<f32>,
};

struct U {
  viewProj:        mat4x4<f32>,
  // camera-space basis for billboarding the point-topology quads
  camRight:        vec3<f32>,
  _pad0:           f32,
  camUp:           vec3<f32>,
  _pad1:           f32,
  // sizing / topology
  baseSize:        f32,        // point size in world units
  strokeLength:    f32,        // stroke length in world units
  strokeWidth:     f32,        // stroke width in world units
  topology:        u32,        // 0 = points, 1 = strokes
  // slab replication
  slabCount:       u32,
  tunnelDepth:     f32,
  flyDistance:     f32,
  particleCount:   u32,
  // depth source params (handled in fs via the sourceTexture sample)
  opacity:         f32,
  fadeNearAlpha:   f32,        // alpha at the camera-nearest slab boundary
  fadeFarAlpha:    f32,        // alpha at the farthest slab boundary
  mirrorX:         u32,
  motionReactive:  f32,        // grows particles whose pixel is changing
  // Shared with RENDER_LIT_WGSL. The soft render reads lens, for depth of
  // field on points.
  light:           vec4<f32>,  // xyz = light in sprite space, w = ambient
  material:        vec4<f32>,  // x = diffuse, y = specular, z = shininess
  lens:            vec4<f32>,  // x = focus distance, y = aperture, z = max blur (NDC)
  proj:            vec4<f32>,  // x = near, y = far, z = focal (proj[5])
};

// Uniform 0..1 from an instance index, for depth-of-field thinning. Integer
// because a sin-hash of indices in the millions has no fractional bits left.
fn instance_rand(index: u32) -> f32 {
  var v = index * 747796405u + 2891336453u;
  v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  v = (v >> 22u) ^ v;
  return f32(v) / 4294967295.0;
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,   // (corner-uv): for strokes, x=along, y=across; for points, classic 0..1
  @location(1) anchor:    vec2<f32>,   // texture-sample UV for color
  @location(2) alpha:     f32,
};

// Wrap the per-slab Z offset so that the K slabs continuously cycle
// past the camera as flyDistance accumulates. Slab 0 is the nearest
// to the camera by default; over time each slab slides toward the
// camera and wraps to the far end when it passes Z = -tunnelDepth/2.
fn slabZ(slabIndex: u32) -> f32 {
  let total = f32(u.slabCount) * u.tunnelDepth;
  let raw   = f32(slabIndex) * u.tunnelDepth - u.flyDistance;
  // floor-mod so negative inputs land in [0, total)
  let m     = raw - floor(raw / total) * total;
  return m - u.tunnelDepth * 0.5;
}

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  // iid encodes (slabIndex, particleIndex) packed as:
  //   particleIndex = iid % particleCount
  //   slabIndex     = iid / particleCount
  let pIdx = iid % u.particleCount;
  let sIdx = iid / u.particleCount;
  let p    = particles[pIdx];

  // Anchor color sample: use UV derived from anchor.xy (already in
  // [-1..1]; remap to [0..1] for texture sampling).
  var anchorUV = vec2<f32>(p.anchor.x * 0.5 + 0.5, 1.0 - (p.anchor.y * 0.5 + 0.5));
  if (u.mirrorX == 1u) { anchorUV.x = 1.0 - anchorUV.x; }

  // Slab-local position + slab Z offset = world position.
  let worldPos = vec3<f32>(p.pos.x, p.pos.y, p.pos.z + slabZ(sIdx));

  // Per-vertex corner offset depends on topology.
  var cornerUV: vec2<f32> = vec2<f32>(0.0, 0.0);
  var offset:   vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var dofFade = 1.0;

  if (u.topology == 1u) {
    // STROKE TOPOLOGY — quad extruded along velocity vector.
    //   vid 0..5: two triangles forming a quad
    //   x ∈ {0, 1} = along velocity (head, tail)
    //   y ∈ {-1, +1} = perpendicular to velocity
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0,  1.0),
      vec2<f32>(0.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x, q.y * 0.5 + 0.5);

    // Stroke direction is the CAMERA'S BACKWARD axis (uniformly,
    // not per-particle velocity). Reasoning: flythrough particles
    // are nearly stationary (anchor pull dominates the curl-noise
    // velocity), so velocity-aligned strokes pointed in random
    // directions for every particle. Visually that produced a
    // radial "starburst" pattern emanating from the center
    // vanishing point — with a black vertical wedge in the middle
    // where no stroke endpoints happened to land. By making every
    // stroke trail backward along the camera's flight axis we get
    // proper uniform "motion lines" that read as the camera flying
    // forward through the tunnel — and no center-column gap.
    //
    // dir = (0, 0, -1) so that -dir * q.x * strokeLength extends
    // the stroke into +Z (away from camera, deeper into the
    // tunnel). perp = (1, 0, 0) gives the stroke width along
    // screen-X.
    let dir = vec3<f32>(0.0, 0.0, -1.0);
    let perp = vec3<f32>(1.0, 0.0, 0.0);

    // Stroke tail trails AWAY from the camera (head at the
    // particle's anchor position, tail extending deeper into Z).
    offset = -dir * (q.x * u.strokeLength) + perp * (q.y * u.strokeWidth * 0.5);
  } else {
    // POINT TOPOLOGY — billboard quad facing the camera.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5);
    var pointSize = u.baseSize;
    if (u.lens.y > 0.0) {
      // Depth of field, thinned rather than only faded: see the lit render.
      let w = max((u.viewProj * vec4<f32>(worldPos, 1.0)).w, 0.0001);
      let blurNdc = min(u.lens.y * 0.08 * abs(w - u.lens.x) / w, u.lens.z);
      let grown = pointSize + blurNdc * w / max(u.proj.z, 0.0001);
      let ratio = (pointSize * pointSize) / (grown * grown);
      let keep = min(1.0, ratio * 3.0);
      if (instance_rand(iid) > keep) {
        var thinned: VSOut;
        thinned.pos = vec4<f32>(2.0, 2.0, 0.0, 1.0);
        return thinned;
      }
      dofFade = ratio / keep;
      pointSize = grown;
    }
    offset = u.camRight * (q.x * pointSize) + u.camUp * (q.y * pointSize);
  }

  // Motion reactivity swells a particle while its pixel changes, so movement
  // in the source reads in the frame even where flow hides the displacement.
  offset = offset * (1.0 + p.signal.y * u.motionReactive * 3.0);

  let finalWorld = worldPos + offset;

  // Depth-based fade so slabs fade in as they emerge from the far
  // end of the tunnel + fade out as they leave the near end. This
  // softens the wrap discontinuity — without it you can SEE slabs pop.
  let z = worldPos.z;
  let total = f32(u.slabCount) * u.tunnelDepth;
  let t = clamp((z + u.tunnelDepth * 0.5) / total, 0.0, 1.0);
  let edgeFade = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t));
  let depthAlpha = mix(u.fadeNearAlpha, u.fadeFarAlpha, t) * edgeFade;

  var out: VSOut;
  out.pos    = u.viewProj * vec4<f32>(finalWorld, 1.0);
  out.uv     = cornerUV;
  out.anchor = anchorUV;
  // Particles passing the lens fade out rather than smearing across the frame.
  let lensFade = smoothstep(0.06, 0.45, max(out.pos.w, 0.0));
  out.alpha  = p.alpha * depthAlpha * u.opacity * dofFade * lensFade;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Sample source color at the anchor's UV.
  let srcColor = textureSample(sourceTexture, sourceSampler, in.anchor);

  // Falloff shape:
  //   Points  — radial disc with soft edge
  //   Strokes — taper along x (head→tail) for streak look
  var mask: f32 = 1.0;
  if (u.topology == 1u) {
    // Stroke: alpha tapers from 1 at head (uv.x=0) to 0 at tail (uv.x=1)
    // with a soft pinch at the perpendicular edges (uv.y).
    let headTail = 1.0 - in.uv.x;
    let perp = 1.0 - abs(in.uv.y - 0.5) * 2.0;
    mask = headTail * smoothstep(0.0, 0.4, perp);
  } else {
    // Point: radial soft disc
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0;
    mask = smoothstep(1.0, 0.2, d);
  }
  let a = srcColor.a * in.alpha * mask;
  // Additive-friendly premultiplied alpha. The host pipeline picks
  // the blend mode via the layer setting; we just produce premul-RGBA.
  return vec4<f32>(srcColor.rgb * a, a);
}
`;

/* ============================================================== */
/* LIT GRAINS — sphere impostors with real depth (points only)     */
/* ============================================================== */
/*
 * The same idea as Pixel Particles' lit grains (see RENDER_LIT_WGSL there):
 * each point is a small sphere, lit by one directional light, writing its own
 * depth so the tunnel's near grains genuinely hide the far ones instead of
 * the whole stack adding up to haze.
 *
 * Two things differ here. Points are sized in world units, so the sphere's
 * radius is simply the point size. And the slab wrap fade cannot be alpha on
 * an opaque grain, so grains shrink to nothing at the ends of the stack
 * instead of fading.
 *
 * Strokes stay soft: a streak is not a sphere.
 */
const RENDER_LIT_WGSL = /* wgsl */ `
struct Particle {
  pos:         vec3<f32>,
  alpha:       f32,
  vel:         vec3<f32>,
  depthAnchor: f32,
  anchor:      vec2<f32>,
  signal:      vec2<f32>,
};

struct U {
  viewProj:        mat4x4<f32>,
  camRight:        vec3<f32>,
  _pad0:           f32,
  camUp:           vec3<f32>,
  _pad1:           f32,
  baseSize:        f32,
  strokeLength:    f32,
  strokeWidth:     f32,
  topology:        u32,
  slabCount:       u32,
  tunnelDepth:     f32,
  flyDistance:     f32,
  particleCount:   u32,
  opacity:         f32,
  fadeNearAlpha:   f32,
  fadeFarAlpha:    f32,
  mirrorX:         u32,
  motionReactive:  f32,
  light:           vec4<f32>,
  material:        vec4<f32>,
  lens:            vec4<f32>,
  proj:            vec4<f32>,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

fn instance_rand(index: u32) -> f32 {
  var v = index * 747796405u + 2891336453u;
  v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  v = (v >> 22u) ^ v;
  return f32(v) / 4294967295.0;
}

fn slabZ(slabIndex: u32) -> f32 {
  let total = f32(u.slabCount) * u.tunnelDepth;
  let raw   = f32(slabIndex) * u.tunnelDepth - u.flyDistance;
  let m     = raw - floor(raw / total) * total;
  return m - u.tunnelDepth * 0.5;
}

struct LitOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:           vec2<f32>,
  @location(1) color:        vec3<f32>,
  @location(2) depthCenter:  f32,
  @location(3) depthScale:   f32,
  @location(4) alpha:        f32,
};

fn culled() -> LitOut {
  var out: LitOut;
  out.pos = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  return out;
}

// pass_id: 0 = lit, no depth of field; 1 = sharp grains only; 2 = blurred only
fn grain_vertex(vid: u32, iid: u32, pass_id: u32) -> LitOut {
  let pIdx = iid % u.particleCount;
  let sIdx = iid / u.particleCount;
  let p = particles[pIdx];

  let worldPos = vec3<f32>(p.pos.x, p.pos.y, p.pos.z + slabZ(sIdx));
  let total = f32(u.slabCount) * u.tunnelDepth;
  let t = clamp((worldPos.z + u.tunnelDepth * 0.5) / total, 0.0, 1.0);
  // Grains cannot fade, so the stack's ends shrink them away instead.
  let edge = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t));
  var size = u.baseSize * edge * (1.0 + p.signal.y * u.motionReactive * 3.0);
  if (size <= 0.00001) { return culled(); }

  let center = u.viewProj * vec4<f32>(worldPos, 1.0);
  let w = max(center.w, 0.0001);
  // Grains passing the lens shrink away instead of filling the frame. On a
  // long lens a slab sliding past the camera otherwise becomes a wall of
  // spheres the size of the screen.
  size = size * smoothstep(0.06, 0.45, w);
  if (size <= 0.00001) { return culled(); }
  var alpha = p.alpha * u.opacity;
  if (pass_id > 0u) {
    let blurNdc = min(u.lens.y * 0.08 * abs(w - u.lens.x) / w, u.lens.z);
    let blurWorld = blurNdc * w / max(u.proj.z, 0.0001);
    let blurred = blurWorld > size * 0.6;
    if (pass_id == 1u && blurred) { return culled(); }
    if (pass_id == 2u && !blurred) { return culled(); }
    if (pass_id == 2u) {
      let grown = size + blurWorld;
      let ratio = (size * size) / (grown * grown);
      let keep = min(1.0, ratio * 3.0);
      if (instance_rand(iid) > keep) { return culled(); }
      alpha = alpha * (ratio / keep);
      size = grown;
    }
  }

  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
  );
  let q = corners[vid];
  let world = worldPos + u.camRight * (q.x * size) + u.camUp * (q.y * size);

  var anchorUV = vec2<f32>(p.anchor.x * 0.5 + 0.5, 1.0 - (p.anchor.y * 0.5 + 0.5));
  if (u.mirrorX == 1u) { anchorUV.x = 1.0 - anchorUV.x; }
  let c = textureSampleLevel(sourceTexture, sourceSampler, anchorUV, 0.0);

  // Forward-Z projection: depth moves by near*far / ((far-near) * w^2) per
  // world unit toward the camera, and the sphere's front is one radius closer.
  let near = u.proj.x;
  let far = u.proj.y;
  var out: LitOut;
  out.pos = u.viewProj * vec4<f32>(world, 1.0);
  out.uv = q;
  out.color = c.rgb;
  out.depthCenter = center.z / w;
  out.depthScale = size * near * far / ((far - near) * w * w);
  out.alpha = alpha * c.a;
  return out;
}

@vertex
fn vs_lit(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> LitOut {
  return grain_vertex(vid, iid, 0u);
}

@vertex
fn vs_sharp(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> LitOut {
  return grain_vertex(vid, iid, 1u);
}

@vertex
fn vs_blur(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> LitOut {
  return grain_vertex(vid, iid, 2u);
}

struct GrainFragment {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fs_lit(in: LitOut) -> GrainFragment {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let nz = sqrt(1.0 - r2);
  let n = vec3<f32>(in.uv.x, in.uv.y, nz);
  let l = normalize(u.light.xyz);
  let ndl = dot(n, l);
  let wrapped = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  let diffuse = mix(wrapped * wrapped, max(ndl, 0.0), 0.6);
  let halfway = normalize(l + vec3<f32>(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, halfway), 0.0), max(u.material.z, 1.0)) * u.material.y;
  var out: GrainFragment;
  out.color = vec4<f32>(in.color * (u.light.w + u.material.x * diffuse) + vec3<f32>(spec), 1.0);
  out.depth = clamp(in.depthCenter - nz * in.depthScale, 0.0, 1.0);
  return out;
}

@fragment
fn fs_bokeh(in: LitOut) -> @location(0) vec4<f32> {
  let r = length(in.uv);
  if (r > 1.0) { discard; }
  let facing = clamp(normalize(u.light.xyz).z * 0.5 + 0.5, 0.0, 1.0);
  let a = in.alpha * (1.0 - smoothstep(0.3, 1.0, r));
  return vec4<f32>(in.color * (u.light.w + u.material.x * facing) * a, a);
}
`;

/* ============================================================== */
/* TYPESCRIPT WRAPPER                                              */
/* ============================================================== */

interface FlythroughParams {
  topology: Topology;
  depthSource: DepthSource;
  mirrorX: boolean;
  flySpeed: number;
  tunnelDepth: number;
  slabCount: number;
  flowStrength: number;
  flowScale: number;
  anchorPull: number;
  strokeLength: number;
  strokeWidth: number;
  depthStrength: number;
  baseSize: number;
  opacity: number;
  fovDeg: number;
  cameraYaw: number;
  cameraPitch: number;
  particleCount: number;
  /** Farthest a particle may travel from its pixel. 0 = unbounded. */
  wanderRadius: number;
  /** How hard a changing pixel pushes its particle. 0 = off. */
  motionReactive: number;
  /** How quickly a particle's remembered luma catches up, per second. */
  motionDecay: number;
  /** 'lit' draws points as sphere grains with depth. Strokes stay soft. */
  grainShading: 'soft' | 'lit';
  /** World-space direction the light comes from. */
  lightX: number;
  lightY: number;
  lightZ: number;
  lightIntensity: number;
  lightAmbient: number;
  grainSpecular: number;
  grainShininess: number;
  /** Distance ahead of the camera, in world units, that is in focus. */
  focusDistance: number;
  /** 0 = everything sharp. Points only. */
  aperture: number;
}

/** Internal default params. Used as the starting state of the renderer
 *  before the first `setParams` call from the host. Sensible enough to
 *  produce a visible result if someone instantiates and renders
 *  without configuring — useful for the dev console + smoke tests. */
const DEFAULT_PARAMS: FlythroughParams = {
  topology: 'strokes',
  depthSource: 'luminance',
  mirrorX: false,
  flySpeed: 0.8,
  tunnelDepth: 2.0,
  slabCount: 4,
  flowStrength: 0.4,
  flowScale: 2.0,
  anchorPull: 1.2,
  strokeLength: 0.08,
  strokeWidth: 0.006,
  depthStrength: 0.5,
  baseSize: 0.005,
  opacity: 1.0,
  fovDeg: 50,
  cameraYaw: 0,
  cameraPitch: 0,
  particleCount: DEFAULT_PARTICLES,
  wanderRadius: 0,
  motionReactive: 0,
  motionDecay: 3,
  grainShading: 'soft',
  lightX: 0.5,
  lightY: 0.7,
  lightZ: -0.5,
  lightIntensity: 1.2,
  lightAmbient: 0.25,
  grainSpecular: 0.35,
  grainShininess: 24,
  focusDistance: 1.5,
  aperture: 0,
};

const FLYTHROUGH_NEAR = 0.05;
const FLYTHROUGH_FAR = 100;

export const FLYTHROUGH_NATIVE_SHADER_IDS = Object.freeze({
  curlBake: 'flythrough/curl-bake',
  compute: 'flythrough/compute',
  render: 'flythrough/render',
  renderLit: 'flythrough/render-lit',
});

export type FlythroughNativeShaderStage = 'compute' | 'render';

export interface FlythroughNativeShaderSource {
  shaderId: string;
  label: string;
  stage: FlythroughNativeShaderStage;
  entry: string;
  source: string;
}

export interface FlythroughNativePrecompileCommand {
  type: 'precompile_shader';
  shader_id: string;
  stage: FlythroughNativeShaderStage;
  entry: string;
  source: string;
}

type FlythroughNativeGraphBinding = {
  binding: number;
  resource?: string;
  kind?: string;
  source_id?: string;
  allow_missing?: boolean;
};

type FlythroughNativeGraphBuffer = {
  id: string;
  kind: 'uniform' | 'storage' | 'read-only-storage';
  byte_length: number;
  persistent?: boolean;
  clear?: boolean;
  initial_b64?: string;
  initial_buffer?: ArrayBuffer | Uint8Array;
};

type FlythroughNativeGraphPass = {
  name: string;
  shader_id: string;
  entry: string;
  dispatch: [number, number, number];
  bindings: FlythroughNativeGraphBinding[];
};

type FlythroughNativeGraphRenderPass = {
  name: string;
  shader_id: string;
  vertex_entry: string;
  fragment_entry: string;
  target: 'source_frame';
  source_id: string;
  seq: number;
  clear: boolean;
  clear_color?: [number, number, number, number];
  include_snapshot?: boolean;
  blend: 'replace' | 'alpha' | 'add';
  vertex_count: number;
  instance_count: number;
  depth_test?: boolean;
  depth_write?: boolean;
  depth_load?: boolean;
  bindings: FlythroughNativeGraphBinding[];
};

/**
 * Soft (and every strokes frame): one blended pass. Lit points: opaque grains
 * with depth, and with an aperture, sharp grains then blurred grains over
 * them against the depth the sharp pass kept. Mirrors the Rust job.
 */
function buildFlythroughRenderPasses(
  params: FlythroughParams,
  sourceId: string,
  opts: { seq: number; includeSnapshot: boolean; instanceCount: number; bindings: FlythroughNativeGraphBinding[] },
): FlythroughNativeGraphRenderPass[] {
  const common = {
    target: 'source_frame' as const,
    source_id: sourceId,
    seq: opts.seq,
    clear_color: [0, 0, 0, 0] as [number, number, number, number],
    include_snapshot: opts.includeSnapshot,
    vertex_count: 6,
    instance_count: opts.instanceCount,
    bindings: opts.bindings,
  };
  if (params.grainShading !== 'lit' || params.topology !== 'points') {
    return [{
      ...common,
      name: 'flythrough-render',
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.render,
      vertex_entry: 'vs_main',
      fragment_entry: 'fs_main',
      clear: true,
      blend: 'alpha',
    }];
  }
  if (params.aperture <= 0) {
    return [{
      ...common,
      name: 'flythrough-render-lit',
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.renderLit,
      vertex_entry: 'vs_lit',
      fragment_entry: 'fs_lit',
      clear: true,
      blend: 'replace',
      depth_test: true,
      depth_write: true,
    }];
  }
  return [
    {
      ...common,
      name: 'flythrough-render-sharp',
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.renderLit,
      vertex_entry: 'vs_sharp',
      fragment_entry: 'fs_lit',
      clear: true,
      blend: 'replace',
      depth_test: true,
      depth_write: true,
    },
    {
      ...common,
      name: 'flythrough-render-blur',
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.renderLit,
      vertex_entry: 'vs_blur',
      fragment_entry: 'fs_bokeh',
      clear: false,
      include_snapshot: false,
      blend: 'alpha',
      depth_test: true,
      depth_write: false,
      depth_load: true,
    },
  ];
}

export interface FlythroughNativeGraphState {
  particleCount: number;
  prevFrameTime: number;
  flyDistance: number;
}

export interface FlythroughNativeGraphOptions {
  sourceId: string;
  mediaSourceId?: string | null;
  params?: Partial<FlythroughParams> & Record<string, any>;
  width?: number;
  height?: number;
  time?: number;
  frameDelta?: number;
  frameIndex?: number;
  state?: FlythroughNativeGraphState | null;
  reset?: boolean;
  includeSnapshot?: boolean;
  audioBass?: number;
  audioTreble?: number;
}

export interface FlythroughNativeGraphBuildResult {
  config: {
    buffers: FlythroughNativeGraphBuffer[];
    passes: FlythroughNativeGraphPass[];
    render_passes: FlythroughNativeGraphRenderPass[];
    readbacks: string[];
  };
  sourceId: string;
  mediaSourceId: string | null;
  state: FlythroughNativeGraphState;
  particleCount: number;
  topology: Topology;
  passCount: number;
}

// GPUBlendState — typed `any` to match the codebase convention (the
// ambient declarations file deliberately keeps WebGPU types narrow
// to avoid pulling in the full @webgpu/types package).
const BLEND_PREMULT_OVER: any = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export function getFlythroughNativeShaderSources(): FlythroughNativeShaderSource[] {
  return [
    {
      shaderId: FLYTHROUGH_NATIVE_SHADER_IDS.curlBake,
      label: 'flythrough/curl-bake',
      stage: 'compute',
      entry: 'cs_bake',
      source: resolveGhostWgsl(CURL_BAKE_WGSL, 'flythrough/curl-bake'),
    },
    {
      shaderId: FLYTHROUGH_NATIVE_SHADER_IDS.compute,
      label: 'flythrough/compute',
      stage: 'compute',
      entry: 'cs_main',
      source: resolveGhostWgsl(COMPUTE_WGSL, 'flythrough/compute'),
    },
    {
      shaderId: FLYTHROUGH_NATIVE_SHADER_IDS.render,
      label: 'flythrough/render',
      stage: 'render',
      entry: 'fs_main',
      source: resolveGhostWgsl(RENDER_WGSL, 'flythrough/render'),
    },
    {
      shaderId: FLYTHROUGH_NATIVE_SHADER_IDS.renderLit,
      label: 'flythrough/render-lit',
      stage: 'render',
      entry: 'fs_lit',
      source: resolveGhostWgsl(RENDER_LIT_WGSL, 'flythrough/render-lit'),
    },
    // Auto Camera's points of interest; the core runs it, not this module.
    getParticleDirectorShaderSource(),
  ];
}

export function buildFlythroughNativePrecompileCommands(): FlythroughNativePrecompileCommand[] {
  return getFlythroughNativeShaderSources().map((shader) => ({
    type: 'precompile_shader',
    shader_id: shader.shaderId,
    stage: shader.stage,
    entry: shader.entry,
    source: shader.source,
  }));
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function enumParam<T extends string>(value: unknown, allowed: Record<T, number>, fallback: T): T {
  const key = String(value ?? '').trim() as T;
  return Object.prototype.hasOwnProperty.call(allowed, key) ? key : fallback;
}

function normalizeFlythroughParams(raw: Partial<FlythroughParams> & Record<string, any> | undefined): FlythroughParams {
  const src = raw ?? {};
  return {
    topology: enumParam(src.topology, { points: 0, strokes: 1 }, DEFAULT_PARAMS.topology),
    depthSource: enumParam(src.depthSource, DEPTH_SRC_IDS, DEFAULT_PARAMS.depthSource),
    mirrorX: !!src.mirrorX,
    flySpeed: clampFinite(src.flySpeed, -16, 16, DEFAULT_PARAMS.flySpeed),
    tunnelDepth: clampFinite(src.tunnelDepth, 0.05, 64, DEFAULT_PARAMS.tunnelDepth),
    slabCount: Math.round(clampFinite(src.slabCount, 1, 8, DEFAULT_PARAMS.slabCount)),
    flowStrength: clampFinite(src.flowStrength, 0, 16, DEFAULT_PARAMS.flowStrength),
    flowScale: clampFinite(src.flowScale, 0.001, 64, DEFAULT_PARAMS.flowScale),
    anchorPull: clampFinite(src.anchorPull, 0, 16, DEFAULT_PARAMS.anchorPull),
    strokeLength: clampFinite(src.strokeLength, 0, 8, DEFAULT_PARAMS.strokeLength),
    strokeWidth: clampFinite(src.strokeWidth, 0.0001, 4, DEFAULT_PARAMS.strokeWidth),
    depthStrength: clampFinite(src.depthStrength, -8, 8, DEFAULT_PARAMS.depthStrength),
    baseSize: clampFinite(src.baseSize, 0.0001, 2, DEFAULT_PARAMS.baseSize),
    opacity: clampFinite(src.opacity, 0, 4, DEFAULT_PARAMS.opacity),
    fovDeg: clampFinite(src.fovDeg, 1, 160, DEFAULT_PARAMS.fovDeg),
    cameraYaw: clampFinite(src.cameraYaw, -3600, 3600, DEFAULT_PARAMS.cameraYaw),
    cameraPitch: clampFinite(src.cameraPitch, -3600, 3600, DEFAULT_PARAMS.cameraPitch),
    particleCount: Math.round(clampFinite(src.particleCount, 1024, MAX_PARTICLES, DEFAULT_PARAMS.particleCount)),
    // The panel exposes Limit Wander + Wander Radius; the shader only needs
    // the effective radius, with 0 meaning unbounded.
    wanderRadius: src.limitWander === true
      ? clampFinite(src.wanderRadius, 0, 8, 0.2)
      : 0,
    motionReactive: clampFinite(src.motionReactive, 0, 8, DEFAULT_PARAMS.motionReactive),
    motionDecay: clampFinite(src.motionDecay, 0, 60, DEFAULT_PARAMS.motionDecay),
    grainShading: src.grainShading === 'lit' ? 'lit' : 'soft',
    lightX: clampFinite(src.lightX, -16, 16, DEFAULT_PARAMS.lightX),
    lightY: clampFinite(src.lightY, -16, 16, DEFAULT_PARAMS.lightY),
    lightZ: clampFinite(src.lightZ, -16, 16, DEFAULT_PARAMS.lightZ),
    lightIntensity: clampFinite(src.lightIntensity, 0, 16, DEFAULT_PARAMS.lightIntensity),
    lightAmbient: clampFinite(src.lightAmbient, 0, 4, DEFAULT_PARAMS.lightAmbient),
    grainSpecular: clampFinite(src.grainSpecular, 0, 4, DEFAULT_PARAMS.grainSpecular),
    grainShininess: clampFinite(src.grainShininess, 1, 256, DEFAULT_PARAMS.grainShininess),
    focusDistance: clampFinite(src.focusDistance, 0.05, 64, DEFAULT_PARAMS.focusDistance),
    aperture: clampFinite(src.aperture, 0, 4, DEFAULT_PARAMS.aperture),
  };
}

/** The world light expressed in a billboard's own frame: x along camRight,
 *  y along camUp, z toward the camera. That is the frame fs_lit builds its
 *  sphere normal in, so the light has to meet it there. */
export function flythroughLightSpriteDir(
  params: Pick<FlythroughParams, 'lightX' | 'lightY' | 'lightZ'>,
  camRight: ArrayLike<number>,
  camUp: ArrayLike<number>,
): [number, number, number] {
  const len = Math.hypot(params.lightX, params.lightY, params.lightZ) || 1;
  const l = [params.lightX / len, params.lightY / len, params.lightZ / len];
  // The camera looks down +Z, so toward-camera is -(right x up).
  const toCam = [
    -(camRight[1] * camUp[2] - camRight[2] * camUp[1]),
    -(camRight[2] * camUp[0] - camRight[0] * camUp[2]),
    -(camRight[0] * camUp[1] - camRight[1] * camUp[0]),
  ];
  const dot = (a: ArrayLike<number>) => l[0] * a[0] + l[1] * a[1] + l[2] * a[2];
  return [dot(camRight), dot(camUp), dot(toCam)];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

function flythroughParticleInitialBuffer(count: number): ArrayBuffer {
  const particleCount = Math.max(1024, Math.min(MAX_PARTICLES, Math.floor(count)));
  const seed = new Float32Array(particleCount * (PARTICLE_BYTES / 4));
  for (let i = 0; i < particleCount; i++) {
    const u1 = (i + 0.5) / particleCount;
    let bits = i;
    bits = ((bits >> 1) & 0x55555555) | ((bits & 0x55555555) << 1);
    bits = ((bits >> 2) & 0x33333333) | ((bits & 0x33333333) << 2);
    bits = ((bits >> 4) & 0x0f0f0f0f) | ((bits & 0x0f0f0f0f) << 4);
    bits = ((bits >> 8) & 0x00ff00ff) | ((bits & 0x00ff00ff) << 8);
    bits = ((bits >> 16) >>> 0) | ((bits << 16) >>> 0);
    const u2 = (bits >>> 0) / 0x100000000;

    const ax = u1 * 2 - 1;
    const ay = u2 * 2 - 1;
    const off = i * (PARTICLE_BYTES / 4);
    seed[off + 0] = ax;
    seed[off + 1] = ay;
    seed[off + 2] = 0;
    seed[off + 3] = 1;
    seed[off + 4] = 0;
    seed[off + 5] = 0;
    seed[off + 6] = 0;
    seed[off + 7] = (Math.sin(ax * 7.3 + ay * 11.1) * 0.5 + 0.5);
    seed[off + 8] = ax;
    seed[off + 9] = ay;
    // signal.x < 0 means the particle has not read its pixel yet, so the
    // first frame does not register the whole image as a change.
    seed[off + 10] = -1;
    seed[off + 11] = 0;
  }
  return seed.buffer;
}

function flythroughNativeInitialState(params: FlythroughParams, time: number): FlythroughNativeGraphState {
  return {
    particleCount: params.particleCount,
    prevFrameTime: time,
    flyDistance: 0,
  };
}

function flythroughSourcePrefix(sourceId: string, params: FlythroughParams): string {
  return `flythrough:${String(sourceId || 'source').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 160)}:${params.particleCount}`;
}

function buildFlythroughComputeUniform(params: FlythroughParams, state: FlythroughNativeGraphState, dt: number, time: number): string {
  const buffer = new ArrayBuffer(64);
  const f = new Float32Array(buffer);
  const u = new Uint32Array(buffer);
  f[0] = dt;
  f[1] = time;
  f[2] = params.flowStrength;
  f[3] = params.flowScale;
  f[4] = params.anchorPull;
  f[5] = params.tunnelDepth;
  f[6] = params.depthStrength;
  u[7] = params.particleCount >>> 0;
  u[8] = DEPTH_SRC_IDS[params.depthSource] >>> 0;
  f[9] = state.flyDistance;
  u[10] = params.mirrorX ? 1 : 0;
  f[11] = params.wanderRadius;
  f[12] = params.motionReactive;
  f[13] = params.motionDecay;
  u[14] = FLYTHROUGH_CURL_GRID_N;
  f[15] = FLYTHROUGH_CURL_PERIOD;
  return bufferToBase64(buffer);
}

function buildFlythroughRenderUniform(params: FlythroughParams, state: FlythroughNativeGraphState, width: number, height: number): string {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const proj = perspective(params.fovDeg, aspect, FLYTHROUGH_NEAR, FLYTHROUGH_FAR);
  const yawRad = (params.cameraYaw ?? 0) * Math.PI / 180;
  const pitchRad = (params.cameraPitch ?? 0) * Math.PI / 180;
  const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
  const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
  const ry = new Float32Array([cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1]);
  const rx = new Float32Array([1, 0, 0, 0, 0, cp, -sp, 0, 0, sp, cp, 0, 0, 0, 0, 1]);
  const rot = mat4Mul(ry, rx);
  const view = mat4Mul(rot, translate(0, 0, -0.1));
  const viewProj = mat4Mul(proj, view);
  const buffer = new ArrayBuffer(256);
  const f = new Float32Array(buffer);
  const u = new Uint32Array(buffer);
  f.set(viewProj, 0);
  f[16] = rot[0]; f[17] = rot[1]; f[18] = rot[2]; f[19] = 0;
  f[20] = rot[4]; f[21] = rot[5]; f[22] = rot[6]; f[23] = 0;
  f[24] = params.baseSize;
  f[25] = params.strokeLength;
  f[26] = params.strokeWidth;
  u[27] = params.topology === 'strokes' ? 1 : 0;
  u[28] = Math.max(1, Math.min(8, params.slabCount | 0));
  f[29] = params.tunnelDepth;
  f[30] = state.flyDistance;
  u[31] = params.particleCount >>> 0;
  f[32] = params.opacity;
  f[33] = 1;
  f[34] = 1;
  u[35] = params.mirrorX ? 1 : 0;
  f[36] = params.motionReactive;
  const light = flythroughLightSpriteDir(params, [rot[0], rot[1], rot[2]], [rot[4], rot[5], rot[6]]);
  f[40] = light[0];
  f[41] = light[1];
  f[42] = light[2];
  f[43] = params.lightAmbient;
  f[44] = params.lightIntensity;
  f[45] = params.grainSpecular;
  f[46] = params.grainShininess;
  f[48] = params.focusDistance;
  f[49] = params.topology === 'points' ? params.aperture : 0;
  f[50] = 0.03;
  f[52] = FLYTHROUGH_NEAR;
  f[53] = FLYTHROUGH_FAR;
  f[54] = proj[5];
  return bufferToBase64(buffer);
}

export function buildFlythroughNativeComputeGraph(options: FlythroughNativeGraphOptions): FlythroughNativeGraphBuildResult {
  const rawParams = options.params ?? {};
  const params = normalizeFlythroughParams(rawParams);
  if (rawParams.audioReactive) {
    const bass = clampFinite(options.audioBass, 0, 4, 0);
    const treble = clampFinite(options.audioTreble, 0, 4, 0);
    params.flySpeed *= 1 + bass * 1.8;
    params.flowStrength *= 1 + treble * 1.5;
  }
  const sourceId = String(options.sourceId || 'flythrough-native-source');
  const mediaSourceId = options.mediaSourceId ? String(options.mediaSourceId) : '';
  const time = Math.max(0, Number.isFinite(options.time) ? Number(options.time) : 0);
  const mustReset = !!options.reset
    || !options.state
    || options.state.particleCount !== params.particleCount;
  const state = mustReset ? flythroughNativeInitialState(params, time) : { ...options.state! };
  let dt = typeof options.frameDelta === 'number' && Number.isFinite(options.frameDelta)
    ? options.frameDelta
    : (state.prevFrameTime === 0 ? 1 / 60 : time - state.prevFrameTime);
  dt = Math.min(Math.max(dt, 0), 1 / 15);
  state.prevFrameTime = time;
  state.flyDistance += params.flySpeed * dt;

  const prefix = flythroughSourcePrefix(sourceId, params);
  const id = (name: string) => `${prefix}:${name}`;
  // Keyed on the source alone so a Count change keeps the baked field.
  const curlFieldId = `flythrough:${String(sourceId || 'source').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 160)}:curl-field`;
  const width = Math.round(options.width || 1920);
  const height = Math.round(options.height || 1080);
  const buffers: FlythroughNativeGraphBuffer[] = [
    {
      id: id('compute-uniform'),
      kind: 'uniform',
      byte_length: 64,
      initial_b64: buildFlythroughComputeUniform(params, state, dt, time),
    },
    {
      id: id('render-uniform'),
      kind: 'uniform',
      byte_length: 256,
      initial_b64: buildFlythroughRenderUniform(params, state, width, height),
    },
    {
      id: id('particles'),
      kind: 'storage',
      byte_length: params.particleCount * PARTICLE_BYTES,
      persistent: true,
      clear: mustReset,
      initial_buffer: mustReset ? flythroughParticleInitialBuffer(params.particleCount) : undefined,
    },
    {
      id: curlFieldId,
      kind: 'storage',
      byte_length: FLYTHROUGH_CURL_BYTES,
      persistent: true,
      clear: mustReset,
    },
  ];
  // The curl field is baked in the same frame its buffer is created, which is
  // exactly the frame the particle buffer resets. After that it is only read.
  if (mustReset) {
    buffers.push({
      id: id('curl-bake-uniform'),
      kind: 'uniform',
      byte_length: 16,
      initial_b64: bufferToBase64(new Uint32Array([FLYTHROUGH_CURL_GRID_N, FLYTHROUGH_CURL_PERIOD, 0, 0]).buffer),
    });
  }

  const sourceTextureBinding: FlythroughNativeGraphBinding = mediaSourceId
    ? { binding: 2, kind: 'source-frame-texture', source_id: mediaSourceId }
    : { binding: 2, kind: 'source-frame-texture', allow_missing: true };
  const curlGroups = Math.ceil(FLYTHROUGH_CURL_GRID_N / 4);
  const passes: FlythroughNativeGraphPass[] = [
    ...(mustReset
      ? [{
          name: 'flythrough-curl-bake',
          shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.curlBake,
          entry: 'cs_bake',
          dispatch: [curlGroups, curlGroups, curlGroups] as [number, number, number],
          bindings: [
            { binding: 0, resource: curlFieldId, kind: 'storage' },
            { binding: 1, resource: id('curl-bake-uniform'), kind: 'uniform' },
          ],
        }]
      : []),
    {
      name: 'flythrough-compute',
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.compute,
      entry: 'cs_main',
      dispatch: [Math.ceil(params.particleCount / 64), 1, 1],
      bindings: [
        { binding: 0, resource: id('particles'), kind: 'storage' },
        { binding: 1, resource: id('compute-uniform'), kind: 'uniform' },
        sourceTextureBinding,
        { binding: 3, kind: 'source-frame-sampler' },
        { binding: 4, resource: curlFieldId, kind: 'read-only-storage' },
      ],
    },
  ];

  const slabs = Math.max(1, Math.min(8, params.slabCount | 0));
  const renderPasses = buildFlythroughRenderPasses(params, sourceId, {
    seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
    includeSnapshot: !!options.includeSnapshot,
    instanceCount: slabs * params.particleCount,
    bindings: [
      { binding: 0, resource: id('particles'), kind: 'read-only-storage' },
      { binding: 1, resource: id('render-uniform'), kind: 'uniform' },
      sourceTextureBinding,
      { binding: 3, kind: 'source-frame-sampler' },
    ],
  });

  return {
    config: {
      buffers,
      passes,
      render_passes: renderPasses,
      readbacks: [],
    },
    sourceId,
    mediaSourceId: mediaSourceId || null,
    state,
    particleCount: params.particleCount,
    topology: params.topology,
    passCount: passes.length + renderPasses.length,
  };
}

export class WebGPUFlythrough {
  private device: any;
  private presentFormat: any;

  // GPU resources
  private particleBuffer: any = null;
  private curlBuffer: any = null;
  private computeUniformBuffer: any = null;
  private renderUniformBuffer: any = null;
  private sourceTexture: any = null;
  private sourceTextureView: any = null;
  private sourceSampler: any = null;
  private computePipeline: any = null;
  private renderPipelinePoints: any = null;
  private renderPipelineStrokes: any = null;
  private computeBindGroupLayout: any = null;
  private renderBindGroupLayout: any = null;
  private computeBindGroup: any = null;
  private renderBindGroup: any = null;

  // CPU state
  private params: FlythroughParams = { ...DEFAULT_PARAMS };
  private flyDistance = 0;
  private prevFrameTime = 0;
  private viewportW = 1920;
  private viewportH = 1080;
  private blendMode: string = 'add';
  private sourceW = 1;
  private sourceH = 1;

  // Computed at construction. Capped by hardware support; default 250K
  // is the sweet spot for 1080p.
  private particleCount = DEFAULT_PARTICLES;

  /** Synchronous constructor — matches WebGPUPixelParticles's API so
   *  the host (WebGPUCanvas) can lazily instantiate a renderer per
   *  layer inside its frame loop without awaiting. All GPU resource
   *  creation here is synchronous in the WebGPU API; the only async
   *  surface is `setSourceImage(...)` which awaits createImageBitmap.
   *  Throws on init failure so the caller can skip / log. */
  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.init();
  }

  private init(): void {
    this.particleCount = Math.min(this.params.particleCount, MAX_PARTICLES);

    // Particle buffer — STORAGE for compute write, also bound as
    // read-only storage in the render pass. COPY_DST so we can seed
    // it from the CPU at init time.
    this.particleBuffer = this.device.createBuffer({
      size: this.particleCount * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Seed particle anchors from a Hammersley sequence in UV space
    // so the cloud has uniform-looking coverage without the obvious
    // banding of a regular grid.
    this.device.queue.writeBuffer(
      this.particleBuffer,
      0,
      new Float32Array(flythroughParticleInitialBuffer(this.particleCount)),
    );

    // Compute uniform buffer — 48 bytes (12 floats), but rounded up
    // to the WebGPU 16-byte alignment.
    this.computeUniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Render uniform buffer — fixed-size struct (see RENDER_WGSL `U`).
    // 64 (viewProj) + 16 (camRight) + 16 (camUp) + 64 (params) = 160.
    // Round up to 256 for safety / future expansion.
    this.renderUniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Source texture — starts 1×1 black; replaced on first
    // setSourceImage / updateSourceFromVideo call.
    this.sourceTexture = this.device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sourceTextureView = this.sourceTexture.createView();
    this.sourceSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // ── Curl field ───────────────────────────────────────────────
    // Baked once here; see CURL_BAKE_WGSL for why it is not evaluated per
    // particle any more.
    const shaderRuntime = getGhostGpuRuntime() ?? this.device;
    this.curlBuffer = this.device.createBuffer({
      size: FLYTHROUGH_CURL_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    {
      const bakeModule = createAndWarmWgslShaderModule(shaderRuntime, CURL_BAKE_WGSL, 'flythrough/curl-bake');
      const bakeLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
      });
      const bakeUniform = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(bakeUniform, 0, new Uint32Array([FLYTHROUGH_CURL_GRID_N, FLYTHROUGH_CURL_PERIOD, 0, 0]));
      const bakePipeline = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bakeLayout] }),
        compute: { module: bakeModule, entryPoint: 'cs_bake' },
      });
      const bakeGroup = this.device.createBindGroup({
        layout: bakeLayout,
        entries: [
          { binding: 0, resource: { buffer: this.curlBuffer } },
          { binding: 1, resource: { buffer: bakeUniform } },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(bakePipeline);
      pass.setBindGroup(0, bakeGroup);
      const groups = Math.ceil(FLYTHROUGH_CURL_GRID_N / 4);
      pass.dispatchWorkgroups(groups, groups, groups);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      try { bakeUniform.destroy?.(); } catch { /* released after submit */ }
    }

    // ── Compute pipeline ─────────────────────────────────────────
    const computeModule = createAndWarmWgslShaderModule(shaderRuntime, COMPUTE_WGSL, 'flythrough/compute');
    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.computeUniformBuffer } },
        { binding: 2, resource: this.sourceTextureView },
        { binding: 3, resource: this.sourceSampler },
        { binding: 4, resource: { buffer: this.curlBuffer } },
      ],
    });

    // ── Render pipelines (one per topology) ──────────────────────
    const renderModule = createAndWarmWgslShaderModule(shaderRuntime, RENDER_WGSL, 'flythrough/render');
    this.renderBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX,   buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const renderPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.renderBindGroupLayout],
    });

    const makePipeline = () => this.device.createRenderPipeline({
      layout: renderPipelineLayout,
      vertex:   { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
    });
    // Same shader covers both topology branches via the topology
    // uniform — so one pipeline is sufficient. The two-pipeline
    // structure is reserved for if/when we need topology-specific
    // blend states or vertex layouts.
    this.renderPipelinePoints = makePipeline();
    this.renderPipelineStrokes = this.renderPipelinePoints;

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
        { binding: 2, resource: this.sourceTextureView },
        { binding: 3, resource: this.sourceSampler },
      ],
    });
  }

  /** Rebuild the source texture at the given dimensions and re-create
   *  the render bind group to point at the new view. Called whenever
   *  the source size changes (e.g. user picks a different image, video
   *  resolution-switches). */
  private resizeSourceTexture(w: number, h: number): void {
    if (this.sourceW === w && this.sourceH === h && this.sourceTexture) return;
    try { this.sourceTexture?.destroy?.(); } catch { /* */ }
    this.sourceTexture = this.device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sourceTextureView = this.sourceTexture.createView();
    this.sourceW = w;
    this.sourceH = h;

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.computeUniformBuffer } },
        { binding: 2, resource: this.sourceTextureView },
        { binding: 3, resource: this.sourceSampler },
        { binding: 4, resource: { buffer: this.curlBuffer } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
        { binding: 2, resource: this.sourceTextureView },
        { binding: 3, resource: this.sourceSampler },
      ],
    });
  }

  /** Replace the source pixels from a still image. The image is
   *  uploaded once; subsequent frames sample the texture without
   *  re-uploading. Use this for image sources or one-time stills. */
  async setSourceImage(img: HTMLImageElement | ImageBitmap | HTMLCanvasElement): Promise<void> {
    const w = (img as any).naturalWidth ?? (img as any).width ?? 1;
    const h = (img as any).naturalHeight ?? (img as any).height ?? 1;
    this.resizeSourceTexture(w, h);
    let bitmap: ImageBitmap | null = null;
    let src: any = img;
    if (img instanceof HTMLImageElement) {
      // createImageBitmap with the right orientation + premultiply
      // hint so copyExternalImageToTexture writes the same pixels the
      // user sees in the source.
      try {
        bitmap = await createImageBitmap(img, { premultiplyAlpha: 'premultiply' });
        src = bitmap;
      } catch { /* fall through to the raw element */ }
    }
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: src, flipY: false },
        { texture: this.sourceTexture, premultipliedAlpha: true },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } finally {
      if (bitmap) { try { bitmap.close(); } catch { /* */ } }
    }
  }

  /** Replace the source pixels from a canvas. The renderer uses this
   *  when a `gpu` layer's source resolves to another layer's render
   *  canvas (e.g. one gpu layer feeding another). Cheap — one
   *  copyExternalImageToTexture per frame at canvas resolution. */
  updateSourceFromCanvas(canvas: HTMLCanvasElement): void {
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    if (w === 0 || h === 0) return;
    this.resizeSourceTexture(w, h);
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: canvas, flipY: false },
        { texture: this.sourceTexture, premultipliedAlpha: true },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch { /* skip frame on transient failures (context loss, etc.) */ }
  }

  /** Zero-copy byte upload for sources that already hand us a flat
   *  RGBA8 buffer (Spout / Syphon receivers, custom GPU capture
   *  paths). Caller must guarantee `data.length === w * h * 4`. */
  updateSourceFromBytes(data: Uint8Array, w: number, h: number): void {
    if (w === 0 || h === 0) return;
    this.resizeSourceTexture(w, h);
    try {
      this.device.queue.writeTexture(
        { texture: this.sourceTexture },
        data,
        { bytesPerRow: w * 4, rowsPerImage: h },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch { /* */ }
  }

  /** Replace the source pixels from a video frame. Called per frame
   *  while a video source is active. Skips when the video isn't
   *  ready (readyState < 2) or has 0×0 dimensions — caller doesn't
   *  need to gate. */
  updateSourceFromVideo(video: HTMLVideoElement): void {
    if (video.readyState < 2) return;
    const w = video.videoWidth | 0;
    const h = video.videoHeight | 0;
    if (w === 0 || h === 0) return;
    this.resizeSourceTexture(w, h);
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video, flipY: false },
        { texture: this.sourceTexture, premultipliedAlpha: true },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch (e) {
      // Common during seek / texture-loss recovery; skip the frame.
    }
  }

  setParams(p: Partial<FlythroughParams>): void {
    this.params = { ...this.params, ...p };
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
  }

  setBlendMode(mode: string): void {
    this.blendMode = mode;
  }

  /** Force-set the camera Z position along the tunnel. Useful for
   *  scrubbing the fly position from a timeline or external control.
   *  Otherwise flyDistance accumulates automatically via setParams. */
  setFlyDistance(d: number): void {
    this.flyDistance = d;
  }

  /** Encode the per-frame compute + render passes into the supplied
   *  encoder. The host (WebGPUCanvas) owns the encoder + the final
   *  queue.submit so we composite cleanly with other render passes. */
  encodeFrame(encoder: any, targetView: any, time?: number, frameDt?: number): void {
    if (!this.computePipeline || !this.renderPipelinePoints) return;

    const wallNow = performance.now() / 1000;
    const now = typeof time === 'number' && Number.isFinite(time) ? Math.max(0, time) : wallNow;
    let dt = typeof frameDt === 'number' && Number.isFinite(frameDt)
      ? frameDt
      : (this.prevFrameTime === 0 ? 1 / 60 : (now - this.prevFrameTime));
    // Clamp dt so a tab-switch or stall doesn't catapult particles
    // halfway across the universe.
    dt = Math.min(Math.max(dt, 0), 1 / 15);
    this.prevFrameTime = now;
    this.flyDistance += this.params.flySpeed * dt;

    // ── Write compute uniforms ────────────────────────────────────
    const cu = new Float32Array(16);
    cu[0]  = dt;
    cu[1]  = now;
    cu[2]  = this.params.flowStrength;
    cu[3]  = this.params.flowScale;
    cu[4]  = this.params.anchorPull;
    cu[5]  = this.params.tunnelDepth;
    cu[6]  = this.params.depthStrength;
    // u32 lives in the same buffer — view as Uint32 at offset 28
    new Uint32Array(cu.buffer, cu.byteOffset)[7] = this.particleCount >>> 0;
    new Uint32Array(cu.buffer, cu.byteOffset)[8] = DEPTH_SRC_IDS[this.params.depthSource] >>> 0;
    cu[9]  = this.flyDistance;
    new Uint32Array(cu.buffer, cu.byteOffset)[10] = this.params.mirrorX ? 1 : 0;
    cu[11] = this.params.wanderRadius;
    cu[12] = this.params.motionReactive;
    cu[13] = this.params.motionDecay;
    new Uint32Array(cu.buffer, cu.byteOffset)[14] = FLYTHROUGH_CURL_GRID_N;
    cu[15] = FLYTHROUGH_CURL_PERIOD;
    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, cu);

    // ── Compute pass ──────────────────────────────────────────────
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.computePipeline);
      pass.setBindGroup(0, this.computeBindGroup);
      const wg = Math.ceil(this.particleCount / 64);
      pass.dispatchWorkgroups(wg);
      pass.end();
    }

    // ── Build view + projection matrices ──────────────────────────
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const proj = perspective(this.params.fovDeg, aspect, 0.05, 100);

    // View transform: camera sits at world origin, looking +Z. Slabs
    // do all the moving via flyDistance + the modulo wrap in the
    // vertex shader — the camera itself is fixed so the projection
    // math stays trivial.
    //
    // Yaw + pitch rotate the world around the camera origin so users
    // can angle into the tunnel slightly without breaking the
    // straight-Z fly model.
    const yawRad = (this.params.cameraYaw ?? 0) * Math.PI / 180;
    const pitchRad = (this.params.cameraPitch ?? 0) * Math.PI / 180;
    const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
    const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
    const ry = new Float32Array([cy, 0, sy, 0,  0, 1, 0, 0,  -sy, 0, cy, 0,  0, 0, 0, 1]);
    const rx = new Float32Array([1, 0, 0, 0,  0, cp, -sp, 0,  0, sp, cp, 0,  0, 0, 0, 1]);
    const rot = mat4Mul(ry, rx);
    // Push the world slightly forward so Z=0 is in front of the camera
    // (avoids near-plane clipping on the first slab).
    const view = mat4Mul(rot, translate(0, 0, -0.1));
    const viewProj = mat4Mul(proj, view);

    // Camera basis vectors for billboarding the point quads. With the
    // identity-ish view, right = +X and up = +Y, rotated by yaw/pitch.
    const camRight = [rot[0], rot[1], rot[2]];
    const camUp    = [rot[4], rot[5], rot[6]];

    // ── Write render uniforms ─────────────────────────────────────
    const ru = new ArrayBuffer(256);
    const ruF = new Float32Array(ru);
    const ruU = new Uint32Array(ru);
    // viewProj  @ offset 0  (64 bytes)
    ruF.set(viewProj, 0);
    // camRight  @ offset 16 (16 bytes)
    ruF[16] = camRight[0]; ruF[17] = camRight[1]; ruF[18] = camRight[2]; ruF[19] = 0;
    // camUp     @ offset 20 (16 bytes)
    ruF[20] = camUp[0]; ruF[21] = camUp[1]; ruF[22] = camUp[2]; ruF[23] = 0;
    // params @ offset 24+
    ruF[24] = this.params.baseSize;
    ruF[25] = this.params.strokeLength;
    ruF[26] = this.params.strokeWidth;
    ruU[27] = this.params.topology === 'strokes' ? 1 : 0;
    ruU[28] = Math.max(1, Math.min(8, this.params.slabCount | 0));
    ruF[29] = this.params.tunnelDepth;
    ruF[30] = this.flyDistance;
    ruU[31] = this.particleCount >>> 0;
    ruF[32] = this.params.opacity;
    ruF[33] = 1.0;   // fadeNearAlpha — fully visible at near edge of stack
    ruF[34] = 1.0;   // fadeFarAlpha  — fully visible at far edge of stack
    ruU[35] = this.params.mirrorX ? 1 : 0;
    ruF[36] = this.params.motionReactive;
    // Lens stays zero here: depth of field and lit grains are native-only.
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ru);

    // ── Render pass ───────────────────────────────────────────────
    const slabs = Math.max(1, Math.min(8, this.params.slabCount | 0));
    const totalInstances = slabs * this.particleCount;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.renderPipelinePoints);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(6, totalInstances, 0, 0);
    pass.end();
  }

  dispose(): void {
    try { this.particleBuffer?.destroy?.(); } catch { /* */ }
    try { this.curlBuffer?.destroy?.(); } catch { /* */ }
    try { this.computeUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.renderUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.sourceTexture?.destroy?.(); } catch { /* */ }
    this.particleBuffer = null;
    this.curlBuffer = null;
    this.computeUniformBuffer = null;
    this.renderUniformBuffer = null;
    this.sourceTexture = null;
    this.sourceTextureView = null;
    this.computePipeline = null;
    this.renderPipelinePoints = null;
    this.renderPipelineStrokes = null;
    this.computeBindGroupLayout = null;
    this.renderBindGroupLayout = null;
    this.computeBindGroup = null;
    this.renderBindGroup = null;
  }
}
