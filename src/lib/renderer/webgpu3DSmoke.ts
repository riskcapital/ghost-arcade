/**
 * WebGPU3DSmoke — true 3D volumetric smoke simulation + raymarched
 * renderer, all on the GPU.
 *
 * The 2D Fluid Smoke shader runs Stable Fluids on a 2D grid and
 * displays the dye texture directly. THIS shader runs Stable Fluids
 * on a full 3D voxel grid and renders the resulting volume by
 * raymarching the camera ray through the box, accumulating density
 * along the way. Result: smoke that has REAL 3D presence — depth,
 * occlusion, perspective foreshortening, the whole deal.
 *
 * The same family as the threejs-blocks `webgpu_simulation_smoke_3d`
 * example: voxel-grid Navier-Stokes + raymarched compositing with
 * dithered samples for banding-free output at modest step counts.
 *
 * ── Implementation choices ───────────────────────────────────────
 *
 * 1. STORAGE BUFFERS for the grids, not 3D textures. WebGPU's storage
 *    texture allowlist for write access is restrictive — `r32float`
 *    is the only single-channel float guaranteed; `rgba16float` 3D
 *    storage write is uneven across hardware. Storage buffers are
 *    universally supported and we just compute the linear index
 *    ourselves: `i = x + y*W + z*W*H`. Per-voxel access is identical
 *    cost to a 3D texture lookup; the only thing we lose is
 *    hardware bilinear/trilinear filtering, which we replace with
 *    manual trilinear lerps in the advection + raymarch shaders
 *    (~8 lookups + lerp, ~30 lines of WGSL).
 *
 * 2. EMISSIVE rendering, not transmissive. The renderer accumulates
 *    density × color along each ray as both color and alpha. Each
 *    voxel emits light proportional to its density. Looks like
 *    glowing smoke / ink in air. Real lighting (light marching for
 *    self-shadowing) costs another ~32 samples per primary sample
 *    per ray — too expensive for 60fps at our grid sizes. We get
 *    most of the visual benefit from front-to-back alpha
 *    compositing alone.
 *
 * 3. BLUE-NOISE-LIKE DITHER on ray start positions. Instead of all
 *    rays starting their march at the same volume entry point (which
 *    produces visible step-banding when sample count is low), we
 *    offset each ray by a stable hash of its pixel position. This
 *    distributes the banding into noise, which the eye discards as
 *    "natural film grain." Lets us run at 64 steps instead of 256
 *    while looking nearly as clean.
 *
 * 4. EMITTERS auto-arranged on a circle, like Ink Cloud. Each emitter
 *    splats density + outward velocity into the volume on a configurable
 *    cadence. Bass kicks trigger a synchronized burst across all
 *    emitters for audio reactivity.
 *
 * ── Compute pipeline (per frame) ─────────────────────────────────
 *
 *   1. splat            — inject density + velocity at emitter positions
 *   2. advectVelocity   — semi-Lagrangian velocity self-advection
 *   3. divergence       — compute div(velocity) into scalar field
 *   4. jacobi × 20      — solve Poisson for pressure
 *   5. subtractGradient — make velocity divergence-free
 *   6. advectDensity    — backward-trace density by velocity
 *   7. decay            — exponential fade per frame on density + velocity
 *
 * ── Render pass ──────────────────────────────────────────────────
 *
 *   8. raymarch         — fullscreen quad; per-pixel ray-march through
 *                          the unit cube containing the volume; sample
 *                          density (trilinear) at each step; accumulate
 *                          color + alpha front-to-back; output
 *                          premultiplied RGBA
 *
 * ── Storage layout ───────────────────────────────────────────────
 *
 *   velocity (×2 ping-pong): array<vec4<f32>>, 16 bytes/voxel
 *     xyz = velocity vector, w = pad
 *   density  (×2 ping-pong): array<vec4<f32>>, 16 bytes/voxel
 *     xyz = color (R,G,B), w = density scalar
 *   pressure (×2 ping-pong): array<f32>,        4 bytes/voxel
 *   divergence:               array<f32>,        4 bytes/voxel
 *
 *   For 48³ (110K voxels): vel 1.7MB × 2 + density 1.7MB × 2 +
 *   pressure 0.4MB × 2 + div 0.4MB = ~7.6MB total. Trivial.
 *   For 64³ (262K voxels): ~18MB. Also fine.
 */

const DEFAULT_GRID = 48;
const PRESSURE_ITERATIONS = 20;
const RAYMARCH_STEPS = 64;
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

/** Build the inverse of a viewProj matrix on the CPU side. The
 *  raymarcher uses inverseViewProj to convert NDC pixel coords
 *  back to world rays. We compute the inverse once per frame
 *  rather than burning shader cycles on it. */
function invertMat4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return identityMat4();
  det = 1 / det;
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return inv;
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
/* SHARED WGSL — struct declaration FIRST, then helper functions  */
/* ============================================================== */
// The SimGlobals struct must be declared BEFORE the bindings that
// reference it (otherwise some WGSL implementations error on the
// forward reference at validation time, even though the spec
// allows it). We split the shared WGSL into two halves: the struct
// goes ABOVE the bindings, the helper functions BELOW.
const SHARED_STRUCT = /* wgsl */ `
// Sim-wide uniform — gridSize, dt, decays, emitter count, audio
// burst flag. Emitter records live in a SEPARATE storage buffer
// (Emitter[]) so all emitters splat in a single compute dispatch
// without the per-dispatch writeBuffer coalescing bug that bites
// when you try to push different uniform values for back-to-back
// dispatches inside one command encoder.
struct SimGlobals {
  gridX: u32, gridY: u32, gridZ: u32, emitterCount: u32,
  dt:    f32, time: f32, burstMul: f32, _pad0: f32,
  densityDecay: f32, velocityDecay: f32, splatRadius: f32, _pad1: f32,
  // Wind = constant directional force added each frame; great for
  // sideways drift or pulling smoke toward one side. Turbulence =
  // 3D curl-noise force that swirls the velocity field organically;
  // gives the smoke "personality" beyond just rising in a column.
  windX: f32, windY: f32, windZ: f32, turbStrength: f32,
  turbScale: f32, _pad2: f32, _pad3: f32, _pad4: f32,
};

struct Emitter {
  center:   vec3<f32>, radius:   f32,
  color:    vec3<f32>, strength: f32,
  velocity: vec3<f32>, _pad:     f32,
};
`;

const SHARED_HELPERS = /* wgsl */ `
fn flatIdx(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * sim.gridX + u32(p.z) * sim.gridX * sim.gridY;
}

fn clampGrid(p: vec3<i32>) -> vec3<i32> {
  let mx = vec3<i32>(i32(sim.gridX) - 1, i32(sim.gridY) - 1, i32(sim.gridZ) - 1);
  return clamp(p, vec3<i32>(0), mx);
}

fn sampleVel3D(uv: vec3<f32>) -> vec3<f32> {
  let dim = vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let p = uv * dim - 0.5;
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let v000 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 0, 0)))].xyz;
  let v100 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 0, 0)))].xyz;
  let v010 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 1, 0)))].xyz;
  let v110 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 1, 0)))].xyz;
  let v001 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 0, 1)))].xyz;
  let v101 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 0, 1)))].xyz;
  let v011 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 1, 1)))].xyz;
  let v111 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 1, 1)))].xyz;
  let vx00 = mix(v000, v100, f.x);
  let vx10 = mix(v010, v110, f.x);
  let vx01 = mix(v001, v101, f.x);
  let vx11 = mix(v011, v111, f.x);
  let vxy0 = mix(vx00, vx10, f.y);
  let vxy1 = mix(vx01, vx11, f.y);
  return mix(vxy0, vxy1, f.z);
}

// 3D value noise + analytic curl — used by the wind/turbulence pass
// to add divergence-free swirling forces to the velocity field.
// "curl of a noise vector field" produces motion that looks like
// natural turbulence without the unrealistic compression/expansion
// you'd get from sampling raw noise directly as a velocity.
fn hash13(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7,  74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}
fn vnoise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  let nxy0 = mix(nx00, nx10, s.y);
  let nxy1 = mix(nx01, nx11, s.y);
  return mix(nxy0, nxy1, s.z) * 2.0 - 1.0;
}
fn curl3D(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = vnoise3(p + vec3<f32>(0.0,  e, 0.0));
  let ax2 = vnoise3(p + vec3<f32>(0.0, -e, 0.0));
  let ay1 = vnoise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = vnoise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = vnoise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = vnoise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  return vec3<f32>(ay1 - ay2, az1 - az2, ax1 - ax2) / (2.0 * e);
}

fn sampleDen3D(uv: vec3<f32>) -> vec4<f32> {
  let dim = vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let p = uv * dim - 0.5;
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let v000 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 0, 0)))];
  let v100 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 0, 0)))];
  let v010 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 1, 0)))];
  let v110 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 1, 0)))];
  let v001 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 0, 1)))];
  let v101 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 0, 1)))];
  let v011 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 1, 1)))];
  let v111 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 1, 1)))];
  let vx00 = mix(v000, v100, f.x);
  let vx10 = mix(v010, v110, f.x);
  let vx01 = mix(v001, v101, f.x);
  let vx11 = mix(v011, v111, f.x);
  let vxy0 = mix(vx00, vx10, f.y);
  let vxy1 = mix(vx01, vx11, f.y);
  return mix(vxy0, vxy1, f.z);
}
`;

/* ============================================================== */
/* COMPUTE: SPLAT — inject density + velocity at a sphere         */
/* ============================================================== */
const SPLAT_WGSL = /* wgsl */ `
${SHARED_STRUCT}
@group(0) @binding(0) var<uniform>             sim:        SimGlobals;
@group(0) @binding(1) var<storage, read_write> velocityIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densityIn:  array<vec4<f32>>;
@group(0) @binding(3) var<storage, read>       emitters:   array<Emitter>;

${SHARED_HELPERS}
@compute @workgroup_size(4, 4, 4)
fn cs_splat(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let uv = (vec3<f32>(gid) + 0.5) / vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let i = flatIdx(vec3<i32>(gid));
  // Sum contribution from EVERY active emitter in a single dispatch.
  // The previous design did one dispatch per emitter, but back-to-back
  // queue.writeBuffer calls all coalesced before the encoder ran, so
  // every dispatch saw only the last emitter's uniform. By making
  // splat aware of all emitters at once via a storage buffer, we
  // sidestep the issue entirely (and run faster — one buffer
  // read/write per voxel instead of N).
  var addedDensity:  f32       = 0.0;
  var addedColor:    vec3<f32> = vec3<f32>(0.0);
  var addedVelocity: vec3<f32> = vec3<f32>(0.0);
  let n = sim.emitterCount;
  for (var e: u32 = 0u; e < n; e = e + 1u) {
    let em = emitters[e];
    let toSplat = uv - em.center;
    let d = length(toSplat);
    let r = max(em.radius, 0.001);
    let w = exp(-d * d / (r * r));
    if (w < 0.0005) { continue; }
    let strength = em.strength * sim.burstMul;
    let dContrib = strength * w;
    addedDensity  = addedDensity  + dContrib;
    addedColor    = addedColor    + em.color * dContrib;
    addedVelocity = addedVelocity + em.velocity * w;
  }
  if (addedDensity < 1e-5 && length(addedVelocity) < 1e-5) { return; }
  // Mix into existing density (proportional color blending so colors
  // mix realistically when emitters overlap).
  let cur = densityIn[i];
  let newDensity = cur.w + addedDensity;
  let blendedColor = (cur.xyz * cur.w + addedColor) / max(newDensity, 1e-4);
  densityIn[i] = vec4<f32>(blendedColor, newDensity);
  // Add velocity additively.
  let curV = velocityIn[i];
  velocityIn[i] = vec4<f32>(curV.xyz + addedVelocity, 0.0);
}
`;

/* ============================================================== */
/* COMPUTE: ADVECT VELOCITY — semi-Lagrangian backtrace           */
/* ============================================================== */
const ADVECT_VEL_WGSL = /* wgsl */ `
${SHARED_STRUCT}
@group(0) @binding(0) var<uniform>             sim:         SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn:  array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densityIn:   array<vec4<f32>>;  // unused but bound for SHARED_HELPERS
@group(0) @binding(3) var<storage, read_write> velocityOut: array<vec4<f32>>;

${SHARED_HELPERS}
@compute @workgroup_size(4, 4, 4)
fn cs_advect_vel(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let dim = vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let uv = (vec3<f32>(gid) + 0.5) / dim;
  // Backtrace: where did the fluid that's HERE come from one timestep ago?
  let v = velocityIn[flatIdx(vec3<i32>(gid))].xyz;
  let prevUV = uv - v * sim.dt;
  var advected = sampleVel3D(prevUV);

  // ── Wind: constant directional force (added per-frame). ─────
  let wind = vec3<f32>(sim.windX, sim.windY, sim.windZ);
  advected = advected + wind * sim.dt;

  // ── Turbulence: 3D curl-noise force, animated over time so the
  //    swirls don't lock into one pattern. Sampled in WORLD coords
  //    (uv ∈ [0,1]) scaled by turbScale so the user can dial swirl
  //    size from "single huge vortex" to "fine wispy detail." Time
  //    drift moves the noise field through space, giving smoke that
  //    reads as alive even when nothing else is happening. ─────
  if (sim.turbStrength > 0.0001) {
    let p = uv * sim.turbScale + vec3<f32>(0.0, 0.0, sim.time * 0.2);
    let turb = curl3D(p) * sim.turbStrength;
    advected = advected + turb * sim.dt;
  }

  velocityOut[flatIdx(vec3<i32>(gid))] = vec4<f32>(advected * sim.velocityDecay, 0.0);
}
`;

/* ============================================================== */
/* COMPUTE: DIVERGENCE                                            */
/* ============================================================== */
const DIVERGENCE_WGSL = /* wgsl */ `
${SHARED_STRUCT}
@group(0) @binding(0) var<uniform>             sim:        SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densityIn:  array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> divOut:     array<f32>;

${SHARED_HELPERS}
@compute @workgroup_size(4, 4, 4)
fn cs_divergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let p = vec3<i32>(gid);
  // Central differences. Edges clamp via clampGrid in flatIdx.
  let vL = velocityIn[flatIdx(clampGrid(p + vec3<i32>(-1, 0, 0)))].xyz;
  let vR = velocityIn[flatIdx(clampGrid(p + vec3<i32>( 1, 0, 0)))].xyz;
  let vD = velocityIn[flatIdx(clampGrid(p + vec3<i32>(0, -1, 0)))].xyz;
  let vU = velocityIn[flatIdx(clampGrid(p + vec3<i32>(0,  1, 0)))].xyz;
  let vB = velocityIn[flatIdx(clampGrid(p + vec3<i32>(0, 0, -1)))].xyz;
  let vF = velocityIn[flatIdx(clampGrid(p + vec3<i32>(0, 0,  1)))].xyz;
  let div = 0.5 * ((vR.x - vL.x) + (vU.y - vD.y) + (vF.z - vB.z));
  divOut[flatIdx(p)] = div;
}
`;

/* ============================================================== */
/* COMPUTE: JACOBI PRESSURE ITERATION                             */
/* ============================================================== */
const JACOBI_WGSL = /* wgsl */ `
${SHARED_STRUCT}
@group(0) @binding(0) var<uniform>             sim:         SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn:  array<vec4<f32>>;  // bound for SHARED_HELPERS, unused
@group(0) @binding(2) var<storage, read_write> densityIn:   array<vec4<f32>>;  // bound for SHARED_HELPERS, unused
@group(0) @binding(3) var<storage, read>       divIn:       array<f32>;
@group(0) @binding(4) var<storage, read>       pressureIn:  array<f32>;
@group(0) @binding(5) var<storage, read_write> pressureOut: array<f32>;

${SHARED_HELPERS}
@compute @workgroup_size(4, 4, 4)
fn cs_jacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let p = vec3<i32>(gid);
  // 6-neighbor average of pressure minus the divergence at this cell.
  let pL = pressureIn[flatIdx(clampGrid(p + vec3<i32>(-1, 0, 0)))];
  let pR = pressureIn[flatIdx(clampGrid(p + vec3<i32>( 1, 0, 0)))];
  let pD = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, -1, 0)))];
  let pU = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0,  1, 0)))];
  let pB = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, 0, -1)))];
  let pF = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, 0,  1)))];
  let d = divIn[flatIdx(p)];
  pressureOut[flatIdx(p)] = (pL + pR + pD + pU + pB + pF - d) / 6.0;
}
`;

/* ============================================================== */
/* COMPUTE: SUBTRACT GRADIENT — make velocity divergence-free     */
/* ============================================================== */
const SUBTRACT_GRAD_WGSL = /* wgsl */ `
${SHARED_STRUCT}
@group(0) @binding(0) var<uniform>             sim:         SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn:  array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densityIn:   array<vec4<f32>>;  // unused, bound for SHARED_HELPERS
@group(0) @binding(3) var<storage, read>       pressureIn:  array<f32>;
@group(0) @binding(4) var<storage, read_write> velocityOut: array<vec4<f32>>;

${SHARED_HELPERS}
@compute @workgroup_size(4, 4, 4)
fn cs_subtract_grad(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let p = vec3<i32>(gid);
  let pL = pressureIn[flatIdx(clampGrid(p + vec3<i32>(-1, 0, 0)))];
  let pR = pressureIn[flatIdx(clampGrid(p + vec3<i32>( 1, 0, 0)))];
  let pD = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, -1, 0)))];
  let pU = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0,  1, 0)))];
  let pB = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, 0, -1)))];
  let pF = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, 0,  1)))];
  let v = velocityIn[flatIdx(p)].xyz;
  let grad = vec3<f32>(pR - pL, pU - pD, pF - pB) * 0.5;
  velocityOut[flatIdx(p)] = vec4<f32>(v - grad, 0.0);
}
`;

/* ============================================================== */
/* COMPUTE: ADVECT DENSITY — backward-trace dye/density           */
/* ============================================================== */
const ADVECT_DEN_WGSL = /* wgsl */ `
${SHARED_STRUCT}
@group(0) @binding(0) var<uniform>             sim:        SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       densityIn:  array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> densityOut: array<vec4<f32>>;

${SHARED_HELPERS}
@compute @workgroup_size(4, 4, 4)
fn cs_advect_den(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let dim = vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let uv = (vec3<f32>(gid) + 0.5) / dim;
  let v = velocityIn[flatIdx(vec3<i32>(gid))].xyz;
  let prevUV = uv - v * sim.dt;
  let d = sampleDen3D(prevUV);
  densityOut[flatIdx(vec3<i32>(gid))] = vec4<f32>(d.xyz, d.w * sim.densityDecay);
}
`;

/* ============================================================== */
/* RENDER: RAYMARCH the density volume                            */
/* ============================================================== */
// Fullscreen render pass. For each pixel:
//   1. Compute world-space ray from inverseViewProj * NDC
//   2. Intersect the ray with the unit cube [-1,1]^3 (smoke volume)
//   3. March from entry to exit in N steps
//   4. At each step, trilinear-sample the density buffer
//   5. Accumulate color + alpha front-to-back (premultiplied)
//   6. Output the accumulated RGBA
//
// Blue-noise dither: the ray's start position within the first
// step is offset by a stable hash of the pixel coords. Without
// this, low step counts produce visible concentric bands; with
// it, the bands become noise that the eye filters out.
const RENDER_WGSL = /* wgsl */ `
struct RenderUniforms {
  invViewProj:    mat4x4<f32>,
  cameraPos:      vec3<f32>,
  emission:       f32,
  volumeScale:    vec3<f32>,
  density:        f32,
  fogColor:       vec3<f32>,
  fogOpacity:     f32,
  gridX: u32, gridY: u32, gridZ: u32, _pad0: u32,
  // Lighting: directional light + ambient. lightDir should be a
  // pre-normalized direction TOWARD the light (so dot-product with
  // surface normal gives the right sign). lightColor is RGB; ambient
  // adds an unconditional brightness floor so the dark side isn't
  // pitch black.
  lightDir:       vec3<f32>,
  lightStrength:  f32,
  lightColor:     vec3<f32>,
  ambient:        f32,
  // Number of "shadow march" steps along the light direction at
  // each main raymarch sample. More steps = softer/more accurate
  // shadows but slower. 0 disables self-shadowing entirely (just
  // ambient + constant light).
  shadowSteps:    u32,
  shadowStepLen:  f32,
  _pad1: f32, _pad2: f32,
};

@group(0) @binding(0) var<uniform>           u:        RenderUniforms;
@group(0) @binding(1) var<storage, read>     densBuf:  array<vec4<f32>>;

fn flatI(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * u.gridX + u32(p.z) * u.gridX * u.gridY;
}

fn sampleDensityRM(uv: vec3<f32>) -> vec4<f32> {
  let dim = vec3<f32>(f32(u.gridX), f32(u.gridY), f32(u.gridZ));
  let p = clamp(uv, vec3<f32>(0.001), vec3<f32>(0.999)) * dim - 0.5;
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let mx = vec3<i32>(i32(u.gridX) - 1, i32(u.gridY) - 1, i32(u.gridZ) - 1);
  let v000 = densBuf[flatI(clamp(p0 + vec3<i32>(0, 0, 0), vec3<i32>(0), mx))];
  let v100 = densBuf[flatI(clamp(p0 + vec3<i32>(1, 0, 0), vec3<i32>(0), mx))];
  let v010 = densBuf[flatI(clamp(p0 + vec3<i32>(0, 1, 0), vec3<i32>(0), mx))];
  let v110 = densBuf[flatI(clamp(p0 + vec3<i32>(1, 1, 0), vec3<i32>(0), mx))];
  let v001 = densBuf[flatI(clamp(p0 + vec3<i32>(0, 0, 1), vec3<i32>(0), mx))];
  let v101 = densBuf[flatI(clamp(p0 + vec3<i32>(1, 0, 1), vec3<i32>(0), mx))];
  let v011 = densBuf[flatI(clamp(p0 + vec3<i32>(0, 1, 1), vec3<i32>(0), mx))];
  let v111 = densBuf[flatI(clamp(p0 + vec3<i32>(1, 1, 1), vec3<i32>(0), mx))];
  let vx00 = mix(v000, v100, f.x);
  let vx10 = mix(v010, v110, f.x);
  let vx01 = mix(v001, v101, f.x);
  let vx11 = mix(v011, v111, f.x);
  let vxy0 = mix(vx00, vx10, f.y);
  let vxy1 = mix(vx01, vx11, f.y);
  return mix(vxy0, vxy1, f.z);
}

fn hash12(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  let p3y = p3 + dot(p3, p3.yxz + 33.33);
  return fract((p3y.x + p3y.y) * p3y.z);
}

// Slab method ray-AABB intersection with the box [-1,1]^3 (then
// scaled by volumeScale). Returns (tEntry, tExit). If they're
// the wrong order, the ray missed.
fn intersectBox(ro: vec3<f32>, rd: vec3<f32>, boxMin: vec3<f32>, boxMax: vec3<f32>) -> vec2<f32> {
  let invD = 1.0 / rd;
  let t0 = (boxMin - ro) * invD;
  let t1 = (boxMax - ro) * invD;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tEntry = max(max(tmin.x, tmin.y), tmin.z);
  let tExit  = min(min(tmax.x, tmax.y), tmax.z);
  return vec2<f32>(tEntry, tExit);
}

struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) ndc: vec2<f32>, };

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  // Fullscreen triangle (one big triangle that covers the screen)
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let p = positions[vid];
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.ndc = p;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // 1. Build world-space ray from this pixel
  let ndc = in.ndc;
  let nearW = u.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let farW  = u.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let nearP = nearW.xyz / nearW.w;
  let farP  = farW.xyz  / farW.w;
  let rd = normalize(farP - nearP);
  let ro = nearP;

  // 2. Volume bounding box, scaled by volumeScale
  let boxMin = -u.volumeScale;
  let boxMax =  u.volumeScale;
  let t = intersectBox(ro, rd, boxMin, boxMax);
  if (t.y < t.x || t.y < 0.0) {
    // Missed the volume entirely — show fog background.
    return vec4<f32>(u.fogColor * u.fogOpacity, u.fogOpacity);
  }
  let tStart = max(t.x, 0.0);
  let tEnd   = t.y;

  // 3. Blue-noise-like dither offset on ray start. hash12 gives a
  //    decorrelated value per pixel that breaks the regular sample
  //    pattern that causes step banding.
  let dither = hash12(in.pos.xy);

  let nSteps = ${RAYMARCH_STEPS};
  let stepLen = (tEnd - tStart) / f32(nSteps);
  var t0 = tStart + stepLen * dither;

  // 4. Front-to-back accumulation with per-step self-shadowing.
  //    For each main raymarch sample, optionally march toward the
  //    light source for u.shadowSteps short steps and accumulate
  //    density along that direction. Use exp(-shadowDensity) as a
  //    transmittance factor: dense regions cast shadows on themselves
  //    and on neighbors, giving the cloud a clear LIT side and dark
  //    side. shadowSteps=0 disables self-shadowing (cheaper).
  var accum = vec4<f32>(0.0);
  let lightStepLen = max(u.shadowStepLen, 0.001);
  let extentRange = boxMax - boxMin;
  for (var i = 0; i < nSteps; i = i + 1) {
    if (t0 > tEnd || accum.a > 0.99) { break; }
    let pos = ro + rd * t0;
    let uvw = (pos - boxMin) / extentRange;
    let s = sampleDensityRM(uvw);

    // Light-march for self-shadowing. We accumulate optical depth
    // along the light direction and convert via Beer-Lambert
    // (exp(-depth)) into a transmittance factor.
    var shadow: f32 = 1.0;
    if (u.shadowSteps > 0u && s.w > 0.001) {
      var lightDepth: f32 = 0.0;
      var lp = pos;
      let steps = u.shadowSteps;
      for (var li: u32 = 0u; li < steps; li = li + 1u) {
        lp = lp + u.lightDir * lightStepLen;
        // Bail out if we've left the volume — no more occluders.
        if (lp.x < boxMin.x || lp.y < boxMin.y || lp.z < boxMin.z ||
            lp.x > boxMax.x || lp.y > boxMax.y || lp.z > boxMax.z) {
          break;
        }
        let luvw = (lp - boxMin) / extentRange;
        let ls = sampleDensityRM(luvw);
        lightDepth = lightDepth + ls.w * lightStepLen * u.density;
      }
      shadow = exp(-lightDepth);
    }

    // Final lit contribution = (ambient + lit*shadow) tinted by both
    // the smoke's own color (s.xyz) AND the light's color when the
    // light is the dominant source.
    let lit = u.ambient + u.lightStrength * shadow;
    let litColor = s.xyz * mix(vec3<f32>(1.0), u.lightColor, u.lightStrength * shadow);
    let alpha = clamp(s.w * stepLen * u.density, 0.0, 1.0);
    let col = litColor * u.emission * lit;

    // Premultiplied front-to-back accumulation. Full-vector
    // assignment because Chromium's WGSL rejects swizzle-write.
    let oneMinusA = 1.0 - accum.a;
    let newRGB = accum.rgb + col * alpha * oneMinusA;
    let newA   = accum.a + alpha * oneMinusA;
    accum = vec4<f32>(newRGB, newA);
    t0 = t0 + stepLen;
  }

  // 5. Composite the accumulated smoke OVER the fog background. The
  //    fog fills any unoccluded portion of the pixel.
  let bgRGBA = vec4<f32>(u.fogColor * u.fogOpacity, u.fogOpacity);
  let outA = accum.a + bgRGBA.a * (1.0 - accum.a);
  let outRGB = accum.rgb + bgRGBA.rgb * (1.0 - accum.a);
  return vec4<f32>(outRGB, outA);
}
`;

/* ============================================================== */
/* TYPESCRIPT WRAPPER                                              */
/* ============================================================== */

export interface Smoke3DParams {
  // Grid / sim
  gridSize: 32 | 48 | 64;     // resolution per axis
  emission: number;            // visual brightness multiplier on raymarched output
  density: number;             // alpha contribution per voxel sample
  velocityDecay: number;       // 0..1 per frame multiplier
  densityDecay: number;        // same
  // Emitters
  emitterCount: number;
  spread: number;              // radial distance of emitters from center, in [0..1] grid coords
  spawnY: number;              // normalized Y position of emitter ring, [-1..1] (volume coords)
  splatRadius: number;         // splat softness in normalized grid coords
  splatStrength: number;       // density per splat
  splatVelocityMag: number;    // velocity magnitude per splat (outward)
  splatRate: number;           // Hz — how often each emitter fires
  // Audio
  bass: number;
  treble: number;
  audioBurst: number;          // bass-triggered extra splats per frame
  // Emitter colors
  emitterColors: [number, number, number][];
  // Volume box scale — the simulation grid is always voxel-uniform
  // but its world-space FOOTPRINT can be stretched per axis to fill
  // the layer canvas (which is usually widescreen, not square).
  // Y stays at 1.0 — height is the reference dimension that cameraZ
  // is calibrated to. X and Z are user-controllable.
  //
  // Defaults: X = 1.6 (close to 16:9), Z = 1.0 (cube-depth). Users
  // can stretch X for ultrawide displays or stretch Z for a longer
  // tunnel-of-smoke look.
  volumeScaleX: number;
  volumeScaleZ: number;
  // Wind: constant directional force on velocity each frame.
  windX: number;
  windY: number;
  windZ: number;
  // Turbulence: 3D curl-noise force amplitude + spatial scale.
  turbStrength: number;
  turbScale: number;
  // Camera + rotation
  fovDeg: number;
  cameraZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  autoRotateX: number;
  autoRotateY: number;
  autoRotateZ: number;
  // Atmosphere
  fogColor: [number, number, number];
  fogOpacity: number;
  // Lighting
  lightDirX: number;
  lightDirY: number;
  lightDirZ: number;
  lightStrength: number;
  lightColor: [number, number, number];
  ambient: number;
  shadowSteps: number;        // 0 = no self-shadowing; 4-8 = nice shadows
  shadowStepLen: number;      // world-space length of each shadow march step
}

const DEFAULT_PARAMS: Smoke3DParams = {
  gridSize: 48,
  // Bumped emission + density vs. earlier defaults so the volume is
  // immediately visible against the fog background — easier to spot
  // problems with sim parameters than problems with "is anything
  // rendering at all."
  emission: 2.5,
  density: 3.0,
  velocityDecay: 0.985,
  densityDecay: 0.992,
  emitterCount: 4,
  spread: 0.3,
  spawnY: -0.5,
  splatRadius: 0.10,
  splatStrength: 3.0,
  splatVelocityMag: 0.6,
  // Splat every frame by default — the rate-gated path made the
  // first few seconds visually empty, which combined with very dark
  // fog reads as "shader is broken." Always-on splatting is the
  // standard look for ink-rising-in-air anyway.
  splatRate: 60.0,
  bass: 0, treble: 0,
  audioBurst: 0.5,
  emitterColors: [
    [1.00, 0.40, 0.18], [0.18, 0.78, 1.00], [0.85, 0.20, 0.85], [0.20, 0.95, 0.55],
    [1.00, 0.85, 0.30], [0.50, 0.30, 1.00], [1.00, 0.30, 0.55], [0.30, 1.00, 0.95],
  ],
  // Volume defaults to widescreen-ish proportions so the canvas
  // (usually 16:9) gets filled out of the box. Bump X higher for
  // ultrawide; stretch Z for tunnel depth.
  volumeScaleX: 1.6,
  volumeScaleZ: 1.0,
  // Wind off, mild turbulence on by default — gentle organic swirl
  // so the smoke doesn't just rise in a column. The reference videos
  // user shared had real natural motion; turbulence is what
  // delivers that without faking it.
  windX: 0, windY: 0, windZ: 0,
  turbStrength: 0.5,
  turbScale: 2.5,
  // CameraZ tuned to fit the [-1,1] cube tightly within the height
  // of the layer canvas at FOV=50°. Math: half-FOV=25°, half-height
  // visible at distance D is D*tan(25°)=D*0.466. We want that == 1
  // (the cube's half-height); so D = 1/0.466 + 1 (near face offset)
  // ≈ 3.14. Going slightly closer (2.7) so the cube fills more of
  // the frame and the smoke reads larger.
  fovDeg: 50,
  cameraZ: 2.7,
  rotateX: 0, rotateY: 0, rotateZ: 0,
  // Auto-rotate disabled by default. Users can dial it on per-axis
  // through the Object Rotation panel section if they want.
  autoRotateX: 0, autoRotateY: 0, autoRotateZ: 0,
  // Default fog is medium-dark navy — visibly NOT pitch black so you
  // can see the rendered area vs. an actual broken render. Adjust
  // toward black via the panel for atmospheric / horror looks.
  fogColor: [0.08, 0.10, 0.18],
  fogOpacity: 1.0,
  // Lighting: directional light pointing down-and-toward-viewer
  // (sets a clear lit "top-front" surface and a dark "bottom-back")
  // with white-ish color and 4 shadow steps. 4 is enough to get a
  // visible lit/shadow split without dominating frame time.
  lightDirX: 0.4, lightDirY: 0.6, lightDirZ: 0.7,
  lightStrength: 0.8,
  lightColor: [1.0, 0.95, 0.85],   // very slightly warm — feels like a sun lamp
  ambient: 0.25,
  shadowSteps: 4,
  shadowStepLen: 0.06,
};

const BLEND_PREMULT_OVER: any = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export class WebGPU3DSmoke {
  private device: any;
  private presentFormat: any;
  // Grid dimensions (uniform across the three axes — supports
  // anisotropic if we ever want, but uniform is the common case).
  private grid = DEFAULT_GRID;
  private cellCount = DEFAULT_GRID * DEFAULT_GRID * DEFAULT_GRID;

  // Storage buffers — ping-pong for velocity / density / pressure.
  private velA: any = null;
  private velB: any = null;
  private denA: any = null;
  private denB: any = null;
  private divBuf: any = null;
  private prsA: any = null;
  private prsB: any = null;
  // Ping-pong flip flags
  private velFlip = false;
  private denFlip = false;
  private prsFlip = false;

  // Uniform buffers
  private simUniform: any;
  private renderUniform: any;
  // Emitter records — separate storage buffer (not uniform) so we
  // can have an array. Sized for MAX_EMITTERS even when fewer are
  // active; the splat shader loops over u.emitterCount only.
  private emitterBuffer: any;

  // Pipelines + bind group layouts
  private splatPipeline: any;
  private splatLayout: any;
  private advectVelPipeline: any;
  private advectVelLayout: any;
  private divPipeline: any;
  private divLayout: any;
  private jacobiPipeline: any;
  private jacobiLayout: any;
  private subtractGradPipeline: any;
  private subtractGradLayout: any;
  private advectDenPipeline: any;
  private advectDenLayout: any;
  private renderPipeline: any;
  private renderLayout: any;

  // CPU-side state
  private params: Smoke3DParams = { ...DEFAULT_PARAMS };
  private viewportW = 1920;
  private viewportH = 1080;
  private prevFrameTime = 0;
  private autoRotXPhase = 0;
  private autoRotYPhase = 0;
  private autoRotZPhase = 0;
  private splatTimer = 0;       // accumulator in seconds for periodic splat fire
  private prevBass = 0;
  private burstHoldTimer = 0;
  // One-shot logs so we can verify the pipeline is actually running
  // when debugging "shader shows nothing." Reset to false in
  // dispose() so HMR-recreated instances log again.
  private _loggedFirstFrame = false;

  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.allocateGrid(this.grid);
    // SimGlobals: 5 16-byte blocks (gridsize+timing + audio + decays
    // + wind + turbScale) = 80 bytes. Round to 96.
    this.simUniform = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderUniform = device.createBuffer({
      size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Emitter storage buffer: 48 bytes per emitter × MAX_EMITTERS = 384 bytes.
    this.emitterBuffer = device.createBuffer({
      size: MAX_EMITTERS * 48,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.buildPipelines();
  }

  private allocateGrid(g: number): void {
    this.grid = g;
    const cells = g * g * g;
    this.cellCount = cells;
    const vec4Size = cells * 16;
    const f32Size = cells * 4;
    // Free old
    [this.velA, this.velB, this.denA, this.denB, this.divBuf, this.prsA, this.prsB].forEach((b) => {
      try { b?.destroy?.(); } catch { /* */ }
    });
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.velA   = this.device.createBuffer({ size: vec4Size, usage });
    this.velB   = this.device.createBuffer({ size: vec4Size, usage });
    this.denA   = this.device.createBuffer({ size: vec4Size, usage });
    this.denB   = this.device.createBuffer({ size: vec4Size, usage });
    this.divBuf = this.device.createBuffer({ size: f32Size,  usage });
    this.prsA   = this.device.createBuffer({ size: f32Size,  usage });
    this.prsB   = this.device.createBuffer({ size: f32Size,  usage });
    // Initialize to zero — buffers are uninitialised by default.
    const zero4 = new Float32Array(cells * 4);
    const zero1 = new Float32Array(cells);
    this.device.queue.writeBuffer(this.velA, 0, zero4);
    this.device.queue.writeBuffer(this.velB, 0, zero4);
    this.device.queue.writeBuffer(this.denA, 0, zero4);
    this.device.queue.writeBuffer(this.denB, 0, zero4);
    this.device.queue.writeBuffer(this.divBuf, 0, zero1);
    this.device.queue.writeBuffer(this.prsA, 0, zero1);
    this.device.queue.writeBuffer(this.prsB, 0, zero1);
  }

  private buildPipelines(): void {
    // Splat: uniform + velocity_rw + density_rw + emitters (read)
    this.splatLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.splatPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.splatLayout] }),
      compute: { module: this.device.createShaderModule({ code: SPLAT_WGSL }), entryPoint: 'cs_splat' },
    });

    // Advect velocity: uniform + velIn (read) + densityIn (rw) + velOut (rw)
    this.advectVelLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.advectVelPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.advectVelLayout] }),
      compute: { module: this.device.createShaderModule({ code: ADVECT_VEL_WGSL }), entryPoint: 'cs_advect_vel' },
    });

    // Divergence: uniform + velIn (read) + densityIn (rw) + divOut (rw)
    this.divLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.divPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.divLayout] }),
      compute: { module: this.device.createShaderModule({ code: DIVERGENCE_WGSL }), entryPoint: 'cs_divergence' },
    });

    // Jacobi: uniform + velIn (read, unused in body) + densityIn (rw, unused) + divIn (read) + pIn (read) + pOut (rw)
    this.jacobiLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.jacobiPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.jacobiLayout] }),
      compute: { module: this.device.createShaderModule({ code: JACOBI_WGSL }), entryPoint: 'cs_jacobi' },
    });

    // SubtractGrad: uniform + velIn (read) + densityIn (rw, unused) + pIn (read) + velOut (rw)
    this.subtractGradLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.subtractGradPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.subtractGradLayout] }),
      compute: { module: this.device.createShaderModule({ code: SUBTRACT_GRAD_WGSL }), entryPoint: 'cs_subtract_grad' },
    });

    // Advect density: uniform + velIn (read) + denIn (read) + denOut (rw)
    this.advectDenLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.advectDenPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.advectDenLayout] }),
      compute: { module: this.device.createShaderModule({ code: ADVECT_DEN_WGSL }), entryPoint: 'cs_advect_den' },
    });

    // Render: uniform + density buffer
    this.renderLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const renderMod = this.device.createShaderModule({ code: RENDER_WGSL });
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

  setParams(p: Partial<Smoke3DParams>): void {
    const wasGrid = this.params.gridSize;
    this.params = { ...this.params, ...p };
    if (this.params.gridSize !== wasGrid) {
      this.allocateGrid(this.params.gridSize);
    }
  }

  setViewport(w: number, h: number): void { this.viewportW = w; this.viewportH = h; }

  /** Encode one full sim step + render. The sim splats one emitter
   *  per call (round-robin through emitters across frames so we
   *  don't issue N pipelines per frame for N emitters). */
  encodeFrame(encoder: any, targetView: any): void {
    if (!this._loggedFirstFrame) {
      this._loggedFirstFrame = true;
      console.log('[3D Smoke] first frame — grid:', this.grid, 'cells:', this.cellCount,
        'viewport:', this.viewportW, 'x', this.viewportH,
        'cameraZ:', this.params.cameraZ, 'fogColor:', this.params.fogColor);
    }
    const now = performance.now() / 1000;
    let dt = this.prevFrameTime === 0 ? 1 / 60 : (now - this.prevFrameTime);
    dt = Math.min(Math.max(dt, 0.001), 1 / 15);
    this.prevFrameTime = now;

    // Auto-rotate accumulators (degrees)
    this.autoRotXPhase += this.params.autoRotateX * dt;
    this.autoRotYPhase += this.params.autoRotateY * dt;
    this.autoRotZPhase += this.params.autoRotateZ * dt;

    // ── Audio burst hold ───────────────────────────────────────
    const bassDelta = Math.max(0, this.params.bass - this.prevBass);
    if (bassDelta > 0.05) this.burstHoldTimer = Math.max(this.burstHoldTimer, 0.15);
    this.burstHoldTimer = Math.max(0, this.burstHoldTimer - dt);
    this.prevBass = this.params.bass;
    const burstActive = this.burstHoldTimer > 0;

    // ── Splat scheduler ────────────────────────────────────────
    // Each emitter wants to fire `splatRate` times/sec. We track a
    // single timer and fire ALL emitters together when it ticks
    // over — gives a synchronized pulse rather than randomly-timed
    // bursts (looks more deliberate). Bass burst forces an
    // immediate fire regardless of timer.
    this.splatTimer += dt;
    const splatPeriod = 1.0 / Math.max(0.1, this.params.splatRate);
    const shouldFireScheduled = this.splatTimer >= splatPeriod;
    if (shouldFireScheduled) this.splatTimer = 0;
    const fire = shouldFireScheduled || burstActive;

    // ── Pack all emitter records + sim uniform once, dispatch once ──
    const emCount = Math.max(1, Math.min(MAX_EMITTERS, this.params.emitterCount | 0));
    const burstMul = burstActive ? 2.5 : 1.0;
    // Emitters storage buffer: 8 records × 48 bytes = 384 bytes
    const eBuf = new ArrayBuffer(MAX_EMITTERS * 48);
    const eF = new Float32Array(eBuf);
    for (let i = 0; i < MAX_EMITTERS; i++) {
      const off = i * 12;  // 48/4 = 12 floats per emitter
      if (i < emCount) {
        const angle = emCount > 1 ? (i / emCount) * Math.PI * 2 : 0;
        const cx = Math.cos(angle) * this.params.spread;
        const cz = Math.sin(angle) * this.params.spread;
        const uvX = cx * 0.5 + 0.5;
        const uvY = this.params.spawnY * 0.5 + 0.5;
        const uvZ = cz * 0.5 + 0.5;
        const col = this.params.emitterColors[i % this.params.emitterColors.length] ?? [1, 1, 1];
        const outX = Math.cos(angle);
        const outZ = Math.sin(angle);
        const vMag = this.params.splatVelocityMag;
        // Block 0 — center + radius
        eF[off + 0] = uvX; eF[off + 1] = uvY; eF[off + 2] = uvZ;
        eF[off + 3] = this.params.splatRadius;
        // Block 1 — color + strength
        eF[off + 4] = col[0]; eF[off + 5] = col[1]; eF[off + 6] = col[2];
        eF[off + 7] = this.params.splatStrength;
        // Block 2 — velocity (small outward + upward) + pad
        eF[off + 8]  = outX * vMag * 0.3;
        eF[off + 9]  = vMag;
        eF[off + 10] = outZ * vMag * 0.3;
      } else {
        // Inactive emitter — zero out so loops over MAX_EMITTERS in
        // the shader can short-circuit cheaply (strength=0 → no
        // contribution).
        for (let k = 0; k < 12; k++) eF[off + k] = 0;
      }
    }
    this.device.queue.writeBuffer(this.emitterBuffer, 0, eBuf);

    // Sim uniform — gridsize + timing + decays + wind + turbulence.
    const sBuf = new ArrayBuffer(96);
    const sF = new Float32Array(sBuf);
    const sU = new Uint32Array(sBuf);
    // Block 0: gridX, gridY, gridZ, emitterCount
    sU[0] = this.grid >>> 0; sU[1] = this.grid >>> 0; sU[2] = this.grid >>> 0;
    sU[3] = emCount >>> 0;
    // Block 1: dt, time, burstMul, _pad
    sF[4] = dt; sF[5] = now; sF[6] = fire ? burstMul : 0;
    // Block 2: densityDecay, velocityDecay, splatRadius, _pad
    sF[8] = this.params.densityDecay;
    sF[9] = this.params.velocityDecay;
    sF[10] = this.params.splatRadius;
    // Block 3: windX, windY, windZ, turbStrength
    sF[12] = this.params.windX;
    sF[13] = this.params.windY;
    sF[14] = this.params.windZ;
    sF[15] = this.params.turbStrength;
    // Block 4: turbScale + 3 pad
    sF[16] = this.params.turbScale;
    this.device.queue.writeBuffer(this.simUniform, 0, sBuf);

    const wg = Math.ceil(this.grid / 4);

    // Splat pass — single dispatch handles all emitters.
    if (fire) {
      const splatBG = this.device.createBindGroup({
        layout: this.splatLayout,
        entries: [
          { binding: 0, resource: { buffer: this.simUniform } },
          { binding: 1, resource: { buffer: this.velFlip ? this.velB : this.velA } },
          { binding: 2, resource: { buffer: this.denFlip ? this.denB : this.denA } },
          { binding: 3, resource: { buffer: this.emitterBuffer } },
        ],
      });
      const sp = encoder.beginComputePass();
      sp.setPipeline(this.splatPipeline);
      sp.setBindGroup(0, splatBG);
      sp.dispatchWorkgroups(wg, wg, wg);
      sp.end();
    }

    // ── 1. Advect velocity ──
    {
      const velIn  = this.velFlip ? this.velB : this.velA;
      const velOut = this.velFlip ? this.velA : this.velB;
      const denCur = this.denFlip ? this.denB : this.denA;
      const bg = this.device.createBindGroup({
        layout: this.advectVelLayout,
        entries: [
          { binding: 0, resource: { buffer: this.simUniform } },
          { binding: 1, resource: { buffer: velIn } },
          { binding: 2, resource: { buffer: denCur } },
          { binding: 3, resource: { buffer: velOut } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.advectVelPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wg, wg, wg);
      pass.end();
      this.velFlip = !this.velFlip;
    }

    // ── 2. Divergence ──
    {
      const velIn = this.velFlip ? this.velB : this.velA;
      const denCur = this.denFlip ? this.denB : this.denA;
      const bg = this.device.createBindGroup({
        layout: this.divLayout,
        entries: [
          { binding: 0, resource: { buffer: this.simUniform } },
          { binding: 1, resource: { buffer: velIn } },
          { binding: 2, resource: { buffer: denCur } },
          { binding: 3, resource: { buffer: this.divBuf } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.divPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wg, wg, wg);
      pass.end();
    }

    // Reset pressure to 0 before Jacobi (cheap — copy over the
    // buffer with zeros isn't worth doing per frame; the Jacobi
    // converges fine from leftover state).

    // ── 3. Jacobi pressure × N ──
    for (let it = 0; it < PRESSURE_ITERATIONS; it++) {
      const velIn = this.velFlip ? this.velB : this.velA;
      const denCur = this.denFlip ? this.denB : this.denA;
      const pIn  = this.prsFlip ? this.prsB : this.prsA;
      const pOut = this.prsFlip ? this.prsA : this.prsB;
      const bg = this.device.createBindGroup({
        layout: this.jacobiLayout,
        entries: [
          { binding: 0, resource: { buffer: this.simUniform } },
          { binding: 1, resource: { buffer: velIn } },
          { binding: 2, resource: { buffer: denCur } },
          { binding: 3, resource: { buffer: this.divBuf } },
          { binding: 4, resource: { buffer: pIn } },
          { binding: 5, resource: { buffer: pOut } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.jacobiPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wg, wg, wg);
      pass.end();
      this.prsFlip = !this.prsFlip;
    }

    // ── 4. Subtract gradient ──
    {
      const velIn  = this.velFlip ? this.velB : this.velA;
      const velOut = this.velFlip ? this.velA : this.velB;
      const denCur = this.denFlip ? this.denB : this.denA;
      const pIn    = this.prsFlip ? this.prsB : this.prsA;
      const bg = this.device.createBindGroup({
        layout: this.subtractGradLayout,
        entries: [
          { binding: 0, resource: { buffer: this.simUniform } },
          { binding: 1, resource: { buffer: velIn } },
          { binding: 2, resource: { buffer: denCur } },
          { binding: 3, resource: { buffer: pIn } },
          { binding: 4, resource: { buffer: velOut } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.subtractGradPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wg, wg, wg);
      pass.end();
      this.velFlip = !this.velFlip;
    }

    // ── 5. Advect density ──
    {
      const velIn  = this.velFlip ? this.velB : this.velA;
      const denIn  = this.denFlip ? this.denB : this.denA;
      const denOut = this.denFlip ? this.denA : this.denB;
      const bg = this.device.createBindGroup({
        layout: this.advectDenLayout,
        entries: [
          { binding: 0, resource: { buffer: this.simUniform } },
          { binding: 1, resource: { buffer: velIn } },
          { binding: 2, resource: { buffer: denIn } },
          { binding: 3, resource: { buffer: denOut } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.advectDenPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wg, wg, wg);
      pass.end();
      this.denFlip = !this.denFlip;
    }

    // ── 6. Raymarch render to layer canvas ──
    // Build viewProj + inverse for the raymarcher.
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const proj = perspective(this.params.fovDeg, aspect, 0.01, 100);
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
    const invViewProj = invertMat4(viewProj);
    const camPos = [0, 0, this.params.cameraZ];

    // Render uniform layout (192 bytes)
    const rBuf = new ArrayBuffer(192);
    const rF = new Float32Array(rBuf);
    const rU = new Uint32Array(rBuf);
    rF.set(invViewProj, 0);
    // camPos + emission @ 16 floats
    rF[16] = camPos[0]; rF[17] = camPos[1]; rF[18] = camPos[2];
    rF[19] = this.params.emission;
    // volumeScale (vec3) + density @ 20. Y always 1 (the reference
    // dimension cameraZ is calibrated against); X and Z user-set.
    rF[20] = this.params.volumeScaleX;
    rF[21] = 1;
    rF[22] = this.params.volumeScaleZ;
    rF[23] = this.params.density;
    // fogColor + fogOpacity @ 24
    rF[24] = this.params.fogColor[0]; rF[25] = this.params.fogColor[1]; rF[26] = this.params.fogColor[2];
    rF[27] = this.params.fogOpacity;
    // grid u32x3 + pad @ 28
    rU[28] = this.grid >>> 0; rU[29] = this.grid >>> 0; rU[30] = this.grid >>> 0;
    // Light direction (vec3 + lightStrength) @ 32 — normalize on
    // the CPU so the shader can skip the normalize() call per
    // sample. Falls back to default-up if user dragged all sliders
    // to zero.
    const lx = this.params.lightDirX;
    const ly = this.params.lightDirY;
    const lz = this.params.lightDirZ;
    const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    rF[32] = lx / lLen; rF[33] = ly / lLen; rF[34] = lz / lLen;
    rF[35] = this.params.lightStrength;
    // Light color + ambient @ 36
    rF[36] = this.params.lightColor[0];
    rF[37] = this.params.lightColor[1];
    rF[38] = this.params.lightColor[2];
    rF[39] = this.params.ambient;
    // Shadow params @ 40 — shadowSteps is u32, then shadowStepLen
    // (f32), then 2 pad floats.
    rU[40] = Math.max(0, Math.min(16, Math.round(this.params.shadowSteps))) >>> 0;
    rF[41] = this.params.shadowStepLen;
    this.device.queue.writeBuffer(this.renderUniform, 0, rBuf);

    const denCur = this.denFlip ? this.denB : this.denA;
    const renderBG = this.device.createBindGroup({
      layout: this.renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniform } },
        { binding: 1, resource: { buffer: denCur } },
      ],
    });
    const rp = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    rp.setPipeline(this.renderPipeline);
    rp.setBindGroup(0, renderBG);
    rp.draw(3);
    rp.end();
  }

  dispose(): void {
    [this.velA, this.velB, this.denA, this.denB, this.divBuf, this.prsA, this.prsB,
     this.simUniform, this.renderUniform, this.emitterBuffer].forEach((b) => {
      try { b?.destroy?.(); } catch { /* */ }
    });
  }
}
