/**
 * WebGPUFluidRidersShader — ONE instrument: glossy riders embedded in a
 * real 3D fluid.
 *
 * The previous build stacked two independent instruments (a 3D smoke
 * volume, then a sphere field animated by pure procedural noise). The
 * spheres never touched the fluid, so nothing was connected: they were
 * painted on top of the smoke with their own lighting and their own
 * depth pass.
 *
 * This build is a single coupled simulation + a single raymarch.
 *
 * ── Compute chain (per frame) ────────────────────────────────────
 *   1. splat              (3d-smoke/splat)              inject density + velocity
 *   2. advect-velocity    (fluid-riders/advect ×2)      MacCormack self-advection
 *                                                        with a reversion limiter;
 *                                                        falls back to the plain
 *                                                        3d-smoke semi-Lagrangian
 *                                                        pass on `performance`
 *   3. vorticity          (fluid-riders/vorticity)      Fedkiw confinement
 *   4. SURFACE TENSION    (fluid-riders/surface)        CSF curvature force +
 *                                                        density-weighted viscosity
 *   5. divergence         (3d-smoke/divergence)
 *   6. PRESSURE WARM      (fluid-riders/pressure)       p *= 0.8 before the sweep
 *   7. jacobi × N         (3d-smoke/jacobi)
 *   8. subtract-gradient  (3d-smoke/subtract-gradient)
 *   9. advect-density     (fluid-riders/advect ×2)      MacCormack, same fallback
 *  10. RIDERS             (fluid-riders/riders)         riders read the
 *                                                        divergence-free velocity
 *                                                        (trilinear), the density
 *                                                        field and the pressure
 *                                                        field
 *  11. CLEAR TILES        (fluid-riders/clear-tiles)    zero the bin counts
 *  12. BIN RIDERS         (fluid-riders/bin-riders)     screen-tile binning
 *
 * ── Render (one fullscreen pass) ─────────────────────────────────
 *  13. fluid-riders/render — per pixel: analytic ray/sphere against the
 *      riders in THIS pixel's tile, then a volume march clipped to the
 *      nearest sphere hit. Smoke in FRONT of a rider occludes it; smoke
 *      behind it is never marched. Henyey-Greenstein phase + a cheap
 *      second wide scattering lobe for the dense cores, Beer-Lambert
 *      light-march self-shadowing, Filament GGX + a clear-coat lobe on
 *      the riders under a three-point studio rig, a procedural
 *      environment for the reflections, a volume shadow marched from the
 *      rider toward the key light, fluid-derived AO, then AgX (ACES and
 *      Linear selectable) + vignette.
 *
 * ── Why riders READ as riding ────────────────────────────────────
 * The coupling is Stokes drag solved analytically over the step:
 *     τ = 2ρ_p r²/(9ρ_f ν) ;  v₁ = v∞ + (v₀ - v∞)·exp(-dt/τ)
 * τ is derived from each rider's OWN radius, so it scales with r²: the
 * big spheres lag by a quarter-second and get carried by whatever wave
 * catches them while the droplets track the flow almost exactly. That
 * LAG is the whole effect, and because exp(-dt/τ) ∈ (0,1) for every dt
 * and every τ the integrator is unconditionally stable — no clamping, no
 * substepping, and no need to make the population sluggish to keep it
 * from exploding.
 *
 * Clustering is NOT a force. Inertial particles are centrifuged out of
 * vortex cores and pile up in the strain-dominated filaments between
 * them; that happens by itself once τ is real, and it peaks when τ is
 * near the eddy turnover time. Spreading τ across decades ("Weight
 * Spread") therefore has different riders decorating different
 * structures at once. The one artistic override on top is a signed
 * -c·∇p, which is conservative and, because a vortex core is a pressure
 * minimum, pools riders in the cores or flings them onto the filaments
 * from a single knob.
 *
 * ── Screen-tile binning ──────────────────────────────────────────
 * Per-pixel analytic spheres over the whole population would be
 * O(pixels × riders). The bin pass projects each rider once, derives its
 * NDC-space footprint, and appends its index to every tile it covers
 * (atomic counter, capped). The fragment shader then only tests the
 * handful of riders in its own tile. Binning is done in NDC rather than
 * pixels on purpose: the core renders instruments into a SQUARE source
 * frame whose size is a runtime quality setting, so a pixel-space tile
 * grid would not line up with the fragment coordinates. The tile counts
 * are still derived from a 16px tile at the layer's nominal resolution.
 */

import {
  WebGPU3DSmoke,
  SMOKE_3D_NATIVE_SHADER_IDS,
  type Smoke3DParams,
} from '../webgpu3DSmoke';
import {
  WebGPUVolumetricSpheresShader,
  type VolumetricSpheresParams,
} from './webgpuVolumetricSpheresShader';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';
import { resolveGhostWgsl } from '../wgsl';
import {
  RIDERS_COLOR_PRESET_OPTIONS,
  applyRidersColorPreset,
} from './webgpuSmokeRidersShader';

/* ============================================================== */
/* CONSTANTS                                                       */
/* ============================================================== */

const FLUID_RIDERS_MAX_EMITTERS = 8;
// Ceiling on how much emission one frame may deposit, in whole splats.
// Emission is continuous (`dt * splatRate` of a splat per frame — see
// CONTINUOUS EMISSION in the graph builder), so this is not a rate knob:
// it is a blast shield for a pathological frame. dt is already clamped to
// 1/15 s, and the worst legitimate quota (flowSpeed 2, bass 1, 60 fps) is
// 2.13, so at the shipped defaults it sits 17x above the per-frame quota
// and never engages.
const SPLAT_QUOTA_CAP = 4;

const FLUID_RIDERS_TILE_SIZE = 16;
const FLUID_RIDERS_TILE_CAP = 64;
/** Register-resident cap on the depth-sorted rider hit list the render
 *  pass keeps per ray. The live count is a uniform (`riderHits`) so the
 *  quality tier can scale it without recompiling the shader; this is
 *  only the array size the WGSL has to reserve. */
const FLUID_RIDERS_MAX_HITS = 4;
const FLUID_RIDERS_MAX_COUNT = 2048;
const FLUID_RIDERS_MIN_COUNT = 16;
/** pos(3)+radius, vel(3)+tau, seed+tint+life+fade = 12 floats = 48 bytes.
 *  Slot 7 used to be an arbitrary `mass`; it now carries the Stokes
 *  relaxation time τ (seconds) the integrator derived for this rider. */
const FLUID_RIDERS_STRIDE_FLOATS = 12;
/** Reference rider radius (world units) that "Weight" is quoted at. τ ∝ r²,
 *  so a rider twice this size lags four times as long. */
const FLUID_RIDERS_TAU_REF_RADIUS = 0.05;
/** Warm-start scale for the pressure field: p *= 0.8 before the Jacobi
 *  sweep makes the solve temporally coherent (≈3× the effective
 *  iterations) while still bleeding off last frame's stale residual. */
const FLUID_RIDERS_PRESSURE_WARM = 0.8;

/* ============================================================== */
/* WGSL — vorticity confinement                                    */
/* ============================================================== */
// Curl is recomputed at the cell and its six neighbours rather than
// read back from a curl buffer. That is 7 curl evaluations instead of a
// second full-grid pass plus a barrier, and at 48³ the extra ALU is far
// cheaper than the extra dispatch.
//
// |curl| is NOT persisted any more. The riders used to climb its
// gradient; that force is gone (see the rider pass), and nothing else
// read the field, so the buffer and its store were pure cost.
const FLUID_RIDERS_VORTICITY_WGSL = /* wgsl */ `
struct VortU {
  gridX: u32, gridY: u32, gridZ: u32, _pad0: u32,
  dt: f32, strength: f32, cellSize: f32, pressureWarm: f32,
};

@group(0) @binding(0) var<uniform>             vu:      VortU;
@group(0) @binding(1) var<storage, read>       velIn:   array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velOut:  array<vec4<f32>>;

fn vortIdx(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * vu.gridX + u32(p.z) * vu.gridX * vu.gridY;
}

fn vortClamp(p: vec3<i32>) -> vec3<i32> {
  let mx = vec3<i32>(i32(vu.gridX) - 1, i32(vu.gridY) - 1, i32(vu.gridZ) - 1);
  return clamp(p, vec3<i32>(0), mx);
}

fn vortVel(p: vec3<i32>) -> vec3<f32> {
  return velIn[vortIdx(vortClamp(p))].xyz;
}

// w = curl(u), central differences on the collocated grid.
//
// The 0.5/cellSize factor matters: the differences above are per GRID
// INDEX, so without dividing by the cell size this returns h*(curl u),
// and the confinement force (which multiplies by h again) comes out
// grid-squared too small — i.e. a no-op you can dial to maximum and
// never see.
fn vortCurl(p: vec3<i32>) -> vec3<f32> {
  let vR = vortVel(p + vec3<i32>( 1,  0,  0));
  let vL = vortVel(p + vec3<i32>(-1,  0,  0));
  let vU = vortVel(p + vec3<i32>( 0,  1,  0));
  let vD = vortVel(p + vec3<i32>( 0, -1,  0));
  let vF = vortVel(p + vec3<i32>( 0,  0,  1));
  let vB = vortVel(p + vec3<i32>( 0,  0, -1));
  let d = vec3<f32>(
    (vU.z - vD.z) - (vF.y - vB.y),
    (vF.x - vB.x) - (vR.z - vL.z),
    (vR.y - vL.y) - (vU.x - vD.x),
  );
  return d * (0.5 / max(vu.cellSize, 1e-5));
}

@compute @workgroup_size(4, 4, 4)
fn cs_vorticity(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= vu.gridX || gid.y >= vu.gridY || gid.z >= vu.gridZ) { return; }
  let p = vec3<i32>(gid);
  let i = vortIdx(p);
  let w = vortCurl(p);

  let base = velIn[i].xyz;
  var force = vec3<f32>(0.0);
  if (vu.strength > 0.00001) {
    // eta = grad|w|; N = normalized eta; f = eps * cellSize * (N x w)
    let mR = length(vortCurl(p + vec3<i32>( 1,  0,  0)));
    let mL = length(vortCurl(p + vec3<i32>(-1,  0,  0)));
    let mU = length(vortCurl(p + vec3<i32>( 0,  1,  0)));
    let mD = length(vortCurl(p + vec3<i32>( 0, -1,  0)));
    let mF = length(vortCurl(p + vec3<i32>( 0,  0,  1)));
    let mB = length(vortCurl(p + vec3<i32>( 0,  0, -1)));
    let eta = vec3<f32>(mR - mL, mU - mD, mF - mB) * 0.5;
    let n = eta / (length(eta) + 1e-5);
    force = cross(n, w) * (vu.strength * vu.cellSize);
  }
  velOut[i] = vec4<f32>(base + force * vu.dt, 0.0);
}
`;

/* ============================================================== */
/* WGSL — pressure warm start                                      */
/* ============================================================== */
// The pressure field is persistent, so the Jacobi sweep already begins
// from LAST frame's solution — but an unscaled restart carries the whole
// stale residual with it and the solve drifts. Scaling by 0.8 first
// keeps the low-frequency part (which is what costs iterations to
// rebuild) while bleeding off the part that is no longer valid.
// Empirically ~20 warm-started iterations resolve as well as ~60 cold
// ones, which is what pays for the extra sweeps this instrument now
// runs at every tier. One trivially bandwidth-bound pass.
const FLUID_RIDERS_PRESSURE_WGSL = /* wgsl */ `
struct VortU {
  gridX: u32, gridY: u32, gridZ: u32, _pad0: u32,
  dt: f32, strength: f32, cellSize: f32, pressureWarm: f32,
};

@group(0) @binding(0) var<uniform>             vu:       VortU;
@group(0) @binding(1) var<storage, read_write> pressure: array<f32>;

@compute @workgroup_size(64)
fn cs_pressure_warm(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= vu.gridX * vu.gridY * vu.gridZ) { return; }
  pressure[i] = pressure[i] * vu.pressureWarm;
}
`;

/* ============================================================== */
/* WGSL — MacCormack advection with the reversion limiter          */
/* ============================================================== */
// Semi-Lagrangian advection is unconditionally stable and hopelessly
// diffusive: every step trilinearly blends 8 neighbours, so a filament
// one cell wide is gone in a handful of frames. That diffusion is what
// erases the stringy paint.
//
// MacCormack advects forward, advects the result BACK, and uses the
// round-trip error to cancel the leading diffusion term:
//     φ̂ⁿ⁺¹ = A(φⁿ) ; φ̂ⁿ = A_R(φ̂ⁿ⁺¹) ; φⁿ⁺¹ = φ̂ⁿ⁺¹ + (φⁿ - φ̂ⁿ)/2
// It costs two advections (hence the forward pass writing a scratch
// buffer and this pass reading it), and buys more visible detail than
// doubling the grid resolution would — math is cheap next to bandwidth.
//
// The correction is UNCONDITIONALLY UNSTABLE without a limiter: it can
// manufacture new extrema and they compound. Two guards, both required:
//   * REVERSION, not clamping. If the corrected value leaves the range
//     of the eight grid corners the FIRST advection actually read, fall
//     back to the plain semi-Lagrangian value. Clamping to the range
//     smears; reverting keeps free-surface fronts (i.e. the paint) sharp.
//   * The corner range must be POINT-sampled. Reading it with the same
//     trilinear filter used for advection returns a value that is by
//     construction inside the range, which silently makes the limiter a
//     no-op — the classic way this ships broken.
// Cells on the domain boundary also revert: the backward trace leaves
// the grid there and the clamped fetch is not a valid round trip.
const FLUID_RIDERS_ADVECT_WGSL = /* wgsl */ `
#include <noise>

struct SimU {
  gridX: u32, gridY: u32, gridZ: u32, emitterCount: u32,
  dt: f32, time: f32, burstMul: f32, _pad0: f32,
  densityDecay: f32, velocityDecay: f32, splatRadius: f32, _pad1: f32,
  windX: f32, windY: f32, windZ: f32, turbStrength: f32,
  turbScale: f32, _pad2: f32, _pad3: f32, _pad4: f32,
};

@group(0) @binding(0) var<uniform>             sim:    SimU;
@group(0) @binding(1) var<storage, read>       velIn:  array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       srcIn:  array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> tmpBuf: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> outBuf: array<vec4<f32>>;

fn mcIdx(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * sim.gridX + u32(p.z) * sim.gridX * sim.gridY;
}

fn mcClamp(p: vec3<i32>) -> vec3<i32> {
  let mx = vec3<i32>(i32(sim.gridX) - 1, i32(sim.gridY) - 1, i32(sim.gridZ) - 1);
  return clamp(p, vec3<i32>(0), mx);
}

fn mcDim() -> vec3<f32> {
  return vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
}

fn mcSampleSrc(uv: vec3<f32>) -> vec4<f32> {
  let p = uv * mcDim() - vec3<f32>(0.5);
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let v000 = srcIn[mcIdx(mcClamp(p0 + vec3<i32>(0, 0, 0)))];
  let v100 = srcIn[mcIdx(mcClamp(p0 + vec3<i32>(1, 0, 0)))];
  let v010 = srcIn[mcIdx(mcClamp(p0 + vec3<i32>(0, 1, 0)))];
  let v110 = srcIn[mcIdx(mcClamp(p0 + vec3<i32>(1, 1, 0)))];
  let v001 = srcIn[mcIdx(mcClamp(p0 + vec3<i32>(0, 0, 1)))];
  let v101 = srcIn[mcIdx(mcClamp(p0 + vec3<i32>(1, 0, 1)))];
  let v011 = srcIn[mcIdx(mcClamp(p0 + vec3<i32>(0, 1, 1)))];
  let v111 = srcIn[mcIdx(mcClamp(p0 + vec3<i32>(1, 1, 1)))];
  let x00 = mix(v000, v100, f.x);
  let x10 = mix(v010, v110, f.x);
  let x01 = mix(v001, v101, f.x);
  let x11 = mix(v011, v111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

fn mcSampleTmp(uv: vec3<f32>) -> vec4<f32> {
  let p = uv * mcDim() - vec3<f32>(0.5);
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let v000 = tmpBuf[mcIdx(mcClamp(p0 + vec3<i32>(0, 0, 0)))];
  let v100 = tmpBuf[mcIdx(mcClamp(p0 + vec3<i32>(1, 0, 0)))];
  let v010 = tmpBuf[mcIdx(mcClamp(p0 + vec3<i32>(0, 1, 0)))];
  let v110 = tmpBuf[mcIdx(mcClamp(p0 + vec3<i32>(1, 1, 0)))];
  let v001 = tmpBuf[mcIdx(mcClamp(p0 + vec3<i32>(0, 0, 1)))];
  let v101 = tmpBuf[mcIdx(mcClamp(p0 + vec3<i32>(1, 0, 1)))];
  let v011 = tmpBuf[mcIdx(mcClamp(p0 + vec3<i32>(0, 1, 1)))];
  let v111 = tmpBuf[mcIdx(mcClamp(p0 + vec3<i32>(1, 1, 1)))];
  let x00 = mix(v000, v100, f.x);
  let x10 = mix(v010, v110, f.x);
  let x01 = mix(v001, v101, f.x);
  let x11 = mix(v011, v111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

// Forward advection: the plain semi-Lagrangian backtrace, written to the
// scratch buffer so the correction pass can advect it back.
@compute @workgroup_size(4, 4, 4)
fn cs_advect_fwd(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let i = mcIdx(vec3<i32>(gid));
  let uv = (vec3<f32>(gid) + vec3<f32>(0.5)) / mcDim();
  let v = velIn[i].xyz;
  tmpBuf[i] = mcSampleSrc(uv - v * sim.dt);
}

struct McResult {
  value: vec4<f32>,
  reverted: bool,
};

fn mcCorrect(gid: vec3<u32>, i: u32) -> McResult {
  let dim = mcDim();
  let uv = (vec3<f32>(gid) + vec3<f32>(0.5)) / dim;
  let v = velIn[i].xyz;
  let backUv = uv - v * sim.dt;
  let fwd = tmpBuf[i];

  var out: McResult;
  out.value = fwd;
  out.reverted = true;

  // Boundary cells revert: the round trip leaves the grid and the
  // clamped fetch is not the value the forward trace actually read.
  let border = 1.5 / min(dim.x, min(dim.y, dim.z));
  if (any(backUv < vec3<f32>(border)) || any(backUv > vec3<f32>(1.0 - border))) {
    return out;
  }

  // Backward advection of the forward result, then the correction.
  let back = mcSampleTmp(uv + v * sim.dt);
  let src = srcIn[i];
  let corrected = fwd + (src - back) * 0.5;

  // POINT-sampled range of the eight corners the forward trace read.
  let p = backUv * dim - vec3<f32>(0.5);
  let p0 = vec3<i32>(floor(p));
  var lo = srcIn[mcIdx(mcClamp(p0))];
  var hi = lo;
  for (var c: i32 = 1; c < 8; c = c + 1) {
    let o = vec3<i32>(c & 1, (c >> 1) & 1, (c >> 2) & 1);
    let s = srcIn[mcIdx(mcClamp(p0 + o))];
    lo = min(lo, s);
    hi = max(hi, s);
  }
  if (any(corrected < lo) || any(corrected > hi)) { return out; }

  out.value = corrected;
  out.reverted = false;
  return out;
}

@compute @workgroup_size(4, 4, 4)
fn cs_advect_mc_vel(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let i = mcIdx(vec3<i32>(gid));
  let uv = (vec3<f32>(gid) + vec3<f32>(0.5)) / mcDim();
  var advected = mcCorrect(gid, i).value.xyz;

  advected = advected + vec3<f32>(sim.windX, sim.windY, sim.windZ) * sim.dt;
  if (sim.turbStrength > 0.0001) {
    let q = uv * sim.turbScale + vec3<f32>(0.0, 0.0, sim.time * 0.2);
    advected = advected + ghost_curl_noise3(q) * (sim.turbStrength * sim.dt);
  }
  // Decay is authored per-60fps-frame but applied per dt, so slowing the
  // sim slows dissipation with it instead of fading at the old wall clock.
  outBuf[i] = vec4<f32>(advected * pow(sim.velocityDecay, sim.dt * 60.0), 0.0);
}

@compute @workgroup_size(4, 4, 4)
fn cs_advect_mc_den(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let i = mcIdx(vec3<i32>(gid));
  let d = mcCorrect(gid, i).value;
  outBuf[i] = vec4<f32>(d.xyz, max(d.w, 0.0) * pow(sim.densityDecay, sim.dt * 60.0));
}
`;

/* ============================================================== */
/* WGSL — surface tension (CSF) + shear-thinning viscosity         */
/* ============================================================== */
// Turbulence alone never produces a droplet. Necking, pinch-off and
// stringy filaments are surface tension: the Continuum Surface Force
// model treats the density gradient as a diffuse interface and pushes
// it toward lower curvature.
//     n = ∇ρ ;  κ = -∇·(n/|n|) ;  f_st = σ·κ·∇ρ
// A thin bridge has high curvature at its waist, so σ pulls the waist
// in until it snaps — which is exactly the reference look. The force is
// injected BEFORE the projection so it comes out divergence-free.
//
// Paired with a density-weighted viscous diffusion ("Paint Thickness"):
// real paint is shear-thinning, so the dense body drags on itself while
// the thin spray stays free. A Laplacian smoothing whose coefficient is
// held under 0.5 is explicit-stable by inspection.
const FLUID_RIDERS_SURFACE_WGSL = /* wgsl */ `
struct SurfU {
  gridX: u32, gridY: u32, gridZ: u32, _pad0: u32,
  dt: f32, tension: f32, thickness: f32, maxStep: f32,
};

@group(0) @binding(0) var<uniform>             su:      SurfU;
@group(0) @binding(1) var<storage, read>       denIn:   array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       velIn:   array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velOut:  array<vec4<f32>>;

fn stIdx(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * su.gridX + u32(p.z) * su.gridX * su.gridY;
}

fn stClamp(p: vec3<i32>) -> vec3<i32> {
  let mx = vec3<i32>(i32(su.gridX) - 1, i32(su.gridY) - 1, i32(su.gridZ) - 1);
  return clamp(p, vec3<i32>(0), mx);
}

fn stDen(p: vec3<i32>) -> f32 {
  return denIn[stIdx(stClamp(p))].w;
}

fn stGrad(p: vec3<i32>) -> vec3<f32> {
  return vec3<f32>(
    stDen(p + vec3<i32>(1, 0, 0)) - stDen(p - vec3<i32>(1, 0, 0)),
    stDen(p + vec3<i32>(0, 1, 0)) - stDen(p - vec3<i32>(0, 1, 0)),
    stDen(p + vec3<i32>(0, 0, 1)) - stDen(p - vec3<i32>(0, 0, 1)),
  ) * 0.5;
}

// Unit interface normal. The epsilon matters: away from an interface
// |∇ρ| is ~0 and the direction is pure noise, so the guard is what keeps
// curvature from exploding in the empty parts of the box.
fn stNormal(p: vec3<i32>) -> vec3<f32> {
  let g = stGrad(p);
  return g / (length(g) + 1e-4);
}

@compute @workgroup_size(4, 4, 4)
fn cs_surface_tension(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= su.gridX || gid.y >= su.gridY || gid.z >= su.gridZ) { return; }
  let p = vec3<i32>(gid);
  let i = stIdx(p);
  var v = velIn[i].xyz;

  if (su.tension > 0.00001) {
    let grad = stGrad(p);
    // κ = -∇·n̂, central differences on the unit normal field.
    let divN =
      (stNormal(p + vec3<i32>(1, 0, 0)).x - stNormal(p - vec3<i32>(1, 0, 0)).x) +
      (stNormal(p + vec3<i32>(0, 1, 0)).y - stNormal(p - vec3<i32>(0, 1, 0)).y) +
      (stNormal(p + vec3<i32>(0, 0, 1)).z - stNormal(p - vec3<i32>(0, 0, 1)).z);
    let kappa = -0.5 * divN;
    var force = grad * (su.tension * kappa);
    // CFL guard: surface tension is the stiffest term in the sim, and a
    // single cell of high curvature must not move fluid more than a
    // fraction of a cell in one step.
    let step = length(force) * su.dt;
    if (step > su.maxStep) { force = force * (su.maxStep / max(step, 1e-6)); }
    v = v + force * su.dt;
  }

  if (su.thickness > 0.00001) {
    let density = denIn[i].w;
    let lap = (
      velIn[stIdx(stClamp(p + vec3<i32>(1, 0, 0)))].xyz +
      velIn[stIdx(stClamp(p - vec3<i32>(1, 0, 0)))].xyz +
      velIn[stIdx(stClamp(p + vec3<i32>(0, 1, 0)))].xyz +
      velIn[stIdx(stClamp(p - vec3<i32>(0, 1, 0)))].xyz +
      velIn[stIdx(stClamp(p + vec3<i32>(0, 0, 1)))].xyz +
      velIn[stIdx(stClamp(p - vec3<i32>(0, 0, 1)))].xyz
    ) * (1.0 / 6.0) - velIn[i].xyz;
    // Coefficient capped at 0.5 — the explicit-diffusion stability limit.
    let amount = clamp(su.thickness * density * su.dt * 6.0, 0.0, 0.5);
    v = v + lap * amount;
  }

  velOut[i] = vec4<f32>(v, 0.0);
}
`;

/* ============================================================== */
/* WGSL — rider simulation (the coupling)                          */
/* ============================================================== */
const FLUID_RIDERS_SIM_WGSL = /* wgsl */ `
struct Rider {
  pos:    vec3<f32>, radius: f32,
  vel:    vec3<f32>, tau:    f32,
  seed:   f32, tint: f32, life: f32, fade: f32,
};

struct RiderU {
  gridX: u32, gridY: u32, gridZ: u32, riderCount: u32,
  dt: f32, time: f32, flowScale: f32, tauScale: f32,
  buoyancy: f32, gravity: f32, vortexPull: f32, damping: f32,
  tauSpread: f32, gravityFactor: f32, radiusMin: f32, radiusVar: f32,
  bounds: vec3<f32>, containStrength: f32,
  spawnCenter: vec3<f32>, spawnRadius: f32,
  lifeSpan: f32, pressureGain: f32, bass: f32, treble: f32,
  radiusScale: f32, tauRefRadius: f32, surfaceStick: f32, isoLevel: f32,
  surfaceBias: f32, _rpad0: f32, _rpad1: f32, _rpad2: f32,
};

@group(0) @binding(0) var<uniform>             ru:      RiderU;
@group(0) @binding(1) var<storage, read_write> riders:  array<Rider>;
@group(0) @binding(2) var<storage, read>       velField: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read>       denField: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read>       prsField: array<f32>;

fn riderHash(n: f32) -> f32 {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

fn gridIdx(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * ru.gridX + u32(p.z) * ru.gridX * ru.gridY;
}

fn gridClamp(p: vec3<i32>) -> vec3<i32> {
  let mx = vec3<i32>(i32(ru.gridX) - 1, i32(ru.gridY) - 1, i32(ru.gridZ) - 1);
  return clamp(p, vec3<i32>(0), mx);
}

// Full trilinear fetch of the velocity field. The grid is a storage
// buffer (no hardware filtering), so the eight corners are mixed by
// hand — exactly what the fluid's own advection does, which keeps the
// riders on the same field the dye is on.
fn sampleVelocityTrilinear(uvw: vec3<f32>) -> vec3<f32> {
  let dim = vec3<f32>(f32(ru.gridX), f32(ru.gridY), f32(ru.gridZ));
  let p = clamp(uvw, vec3<f32>(0.0), vec3<f32>(1.0)) * dim - vec3<f32>(0.5);
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let v000 = velField[gridIdx(gridClamp(p0 + vec3<i32>(0, 0, 0)))].xyz;
  let v100 = velField[gridIdx(gridClamp(p0 + vec3<i32>(1, 0, 0)))].xyz;
  let v010 = velField[gridIdx(gridClamp(p0 + vec3<i32>(0, 1, 0)))].xyz;
  let v110 = velField[gridIdx(gridClamp(p0 + vec3<i32>(1, 1, 0)))].xyz;
  let v001 = velField[gridIdx(gridClamp(p0 + vec3<i32>(0, 0, 1)))].xyz;
  let v101 = velField[gridIdx(gridClamp(p0 + vec3<i32>(1, 0, 1)))].xyz;
  let v011 = velField[gridIdx(gridClamp(p0 + vec3<i32>(0, 1, 1)))].xyz;
  let v111 = velField[gridIdx(gridClamp(p0 + vec3<i32>(1, 1, 1)))].xyz;
  let x00 = mix(v000, v100, f.x);
  let x10 = mix(v010, v110, f.x);
  let x01 = mix(v001, v101, f.x);
  let x11 = mix(v011, v111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleDensityAt(uvw: vec3<f32>) -> f32 {
  let dim = vec3<f32>(f32(ru.gridX), f32(ru.gridY), f32(ru.gridZ));
  let p = clamp(uvw, vec3<f32>(0.0), vec3<f32>(1.0)) * dim - vec3<f32>(0.5);
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let d000 = denField[gridIdx(gridClamp(p0 + vec3<i32>(0, 0, 0)))].w;
  let d100 = denField[gridIdx(gridClamp(p0 + vec3<i32>(1, 0, 0)))].w;
  let d010 = denField[gridIdx(gridClamp(p0 + vec3<i32>(0, 1, 0)))].w;
  let d110 = denField[gridIdx(gridClamp(p0 + vec3<i32>(1, 1, 0)))].w;
  let d001 = denField[gridIdx(gridClamp(p0 + vec3<i32>(0, 0, 1)))].w;
  let d101 = denField[gridIdx(gridClamp(p0 + vec3<i32>(1, 0, 1)))].w;
  let d011 = denField[gridIdx(gridClamp(p0 + vec3<i32>(0, 1, 1)))].w;
  let d111 = denField[gridIdx(gridClamp(p0 + vec3<i32>(1, 1, 1)))].w;
  let x00 = mix(d000, d100, f.x);
  let x10 = mix(d010, d110, f.x);
  let x01 = mix(d001, d101, f.x);
  let x11 = mix(d011, d111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

// Pressure at a cell offset from the rider. In an incompressible flow a
// vortex core is a PRESSURE MINIMUM, so -∇p points into the core: one
// signed knob gives both "riders pool in the vortices" (positive) and
// "riders are flung out onto the strain filaments" (negative).
fn pressureAtCell(uvw: vec3<f32>, offset: vec3<i32>) -> f32 {
  let dim = vec3<f32>(f32(ru.gridX), f32(ru.gridY), f32(ru.gridZ));
  let p = vec3<i32>(floor(clamp(uvw, vec3<f32>(0.0), vec3<f32>(1.0)) * dim));
  return prsField[gridIdx(gridClamp(p + offset))];
}

fn pressureGradient(uvw: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    pressureAtCell(uvw, vec3<i32>( 1,  0,  0)) - pressureAtCell(uvw, vec3<i32>(-1,  0,  0)),
    pressureAtCell(uvw, vec3<i32>( 0,  1,  0)) - pressureAtCell(uvw, vec3<i32>( 0, -1,  0)),
    pressureAtCell(uvw, vec3<i32>( 0,  0,  1)) - pressureAtCell(uvw, vec3<i32>( 0,  0, -1)),
  ) * 0.5;
}

// Riders are born in the emitter DISC, flattened in Y, so a recycled
// rider re-enters where the paint is actually being injected instead of
// popping into empty air somewhere in the box.
fn riderSpawn(seed: f32) -> vec3<f32> {
  let a = riderHash(seed * 3.17 + 1.7) * 6.2831853;
  let z = riderHash(seed * 7.31 + 4.1) * 2.0 - 1.0;
  let r = pow(riderHash(seed * 11.93 + 8.3), 0.4);
  let planar = sqrt(max(0.0, 1.0 - z * z));
  let dir = vec3<f32>(cos(a) * planar, z * 0.32, sin(a) * planar);
  return ru.spawnCenter + dir * (r * ru.spawnRadius);
}

// Analytic solution of dv/dt = (u - v)/tau + a over one step with u and
// a frozen. exp(-dt/tau) lies in (0,1) for ANY dt and ANY tau, so v1 is
// always a convex combination of v0 and vInf — unconditionally stable,
// no clamping and no substepping, at any weight the operator dials in.
//
// The explicit-Euler form this replaces (v += (u-v)*(dt/tau)) is only
// stable for dt < 2*tau, and a small tau — a light, responsive rider —
// is exactly the unstable case. It could only ever be tuned by making
// the whole population sluggish.
//
// The position update must use the integral of v over the step, not
// x + v1*dt: the latter is first order and gets the tau -> 0 tracer
// limit wrong, which is the limit the droplets live in.
struct RiderStep {
  vel: vec3<f32>,
  pos: vec3<f32>,
};

fn riderIntegrate(
  x0: vec3<f32>,
  v0: vec3<f32>,
  vInf: vec3<f32>,
  tau: f32,
  dt: f32,
) -> RiderStep {
  let z = dt / tau;
  let a = exp(-z);
  // 1-exp(-z) cancels catastrophically for tiny z; the series does not.
  var oneMinusA = 1.0 - a;
  if (z < 1e-3) { oneMinusA = z * (1.0 - z * 0.5 * (1.0 - z / 3.0)); }
  var out: RiderStep;
  out.vel = vInf + (v0 - vInf) * a;
  out.pos = x0 + vInf * dt + (v0 - vInf) * (tau * oneMinusA);
  return out;
}

@compute @workgroup_size(64)
fn cs_riders(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= ru.riderCount) { return; }
  var r = riders[i];
  let dt = min(ru.dt, 1.0 / 30.0);

  // ── Stokes relaxation time, derived from the rider's own radius. ─
  // τ = 2ρ_p r² / (9 ρ_f ν), i.e. τ ∝ r². Doubling a rider's radius
  // quadruples its lag, which is both the physics and the art
  // direction: the big spheres read as heavy while the droplets whip
  // around. Terminal velocity g_eff·τ ∝ r² falls out for free.
  let worldRadius = max(r.radius * ru.radiusScale, 1e-5);
  let radiusRatio = worldRadius / max(ru.tauRefRadius, 1e-5);
  // Spread the population across decades of τ. Preferential
  // concentration peaks at Stokes number ~1, so a population spanning
  // [0.1, 10]× the eddy turnover time has riders clustering on several
  // different structures at once instead of all picking the same one.
  let spreadT = riderHash(r.seed * 31.77 + 5.31) * 2.0 - 1.0;
  let spread = pow(10.0, ru.tauSpread * spreadT);
  // ±20% per-rider jitter — a uniform τ makes the whole population move
  // as one rigid mass.
  let jitter = 0.8 + 0.4 * riderHash(r.seed * 19.19 + 2.4);
  let tau = max(ru.tauScale * radiusRatio * radiusRatio * spread * jitter, 1e-4);

  let extent = max(ru.bounds * 2.0, vec3<f32>(1e-4));
  let uvw = (r.pos + ru.bounds) / extent;
  let density = sampleDensityAt(uvw);

  // ── External accelerations (everything that is not drag). ───────
  // Buoyancy is baked into gravity through the density ratio:
  // g_eff = g(1 - ρ_f/ρ_p), so a rider lighter than the fluid RISES
  // without a second knob fighting the first.
  var aExt = vec3<f32>(0.0, -1.0, 0.0) * (ru.gravity * ru.gravityFactor);
  aExt = aExt + vec3<f32>(0.0, 1.0, 0.0) * (ru.buoyancy * density);
  // Signed pressure-gradient force. Clustering itself comes free from
  // inertia (preferential concentration); this is the artistic override
  // on top of it, and it is conservative, unlike climbing |∇ω|.
  if (abs(ru.vortexPull) > 0.00001) {
    aExt = aExt - pressureGradient(uvw) * (ru.vortexPull * ru.pressureGain);
  }
  // ── Density-seeking ("Ride Surface"). ∇ρ points toward increasing
  //    density, so (seekLevel − ρ)·ĝ pulls a rider sitting in thinner
  //    paint inward and pushes an over-buried one back out.
  //
  //    Two things were wrong here, and together they are the whole
  //    "orbs pasted in front of the liquid" complaint.
  //
  //    1. It was an ACCELERATION. Everything in aExt reaches the rider
  //       multiplied by τ_eff — about 0.08 s at the shipped Weight — so
  //       even the clamped maximum moved a rider at ~0.5 units/s while
  //       the flow term is a full velocity. Measured: Ride Surface 0 and
  //       Ride Surface 4 render indistinguishably. Nobody was riding the
  //       surface; the population simply lived in the thin dye halo the
  //       isosurface does not draw, which is what put every orb outside
  //       the mass. It is a velocity the rider relaxes toward now, like
  //       the containment term below — same reasoning, same units, and
  //       heavy riders still ease in instead of being catapulted.
  //
  //    2. The target was the iso level for EVERYONE, so the best case
  //       this could ever reach was a single shell — whose near half is
  //       in front of an opaque surface and whose far half is hidden
  //       behind it. "Surface Bias" gives each rider its own target from
  //       a seed-hashed band around the iso level, so the population
  //       spreads through the BODY: some hovering proud of the skin,
  //       some straddling it, some deep enough to read only as a tinted
  //       glow through the paint. 0 restores the single-shell target.
  var seekVel = vec3<f32>(0.0);
  if (ru.surfaceStick > 0.0001) {
    // [-0.3, 1]: a minority ride just OUTSIDE the skin, the rest fan
    // inward. Biased outward so the silhouette keeps orbs breaking the
    // surface rather than everything sinking out of sight.
    let depthH = riderHash(r.seed * 41.13 + 7.77) * 1.3 - 0.3;
    // (WGSL reserves the name "target", hence seekLevel.)
    let seekLevel = ru.isoLevel * (1.0 + clamp(ru.surfaceBias, 0.0, 1.0) * depthH * 2.4);
    let hs = 1.5 / f32(ru.gridX);
    let gx = sampleDensityAt(uvw + vec3<f32>(hs, 0.0, 0.0)) - sampleDensityAt(uvw - vec3<f32>(hs, 0.0, 0.0));
    let gy = sampleDensityAt(uvw + vec3<f32>(0.0, hs, 0.0)) - sampleDensityAt(uvw - vec3<f32>(0.0, hs, 0.0));
    let gz = sampleDensityAt(uvw + vec3<f32>(0.0, 0.0, hs)) - sampleDensityAt(uvw - vec3<f32>(0.0, 0.0, hs));
    let g = vec3<f32>(gx, gy, gz);
    let gm = length(g);
    if (gm > 1e-4) {
      // Clamped in units of the flow it competes with: a rider crosses
      // the pour in a second or two at full deflection, never faster.
      seekVel = (g / gm) * clamp((seekLevel - density) * ru.surfaceStick * 2.5, -2.2, 2.2);
    }
  }

  // ── Soft containment, expressed as a velocity the rider relaxes
  //    toward rather than a force. Folding it into the target keeps a
  //    heavy (large τ) rider from being launched by the spring. ──────
  let over = abs(r.pos) - ru.bounds;
  let outward = max(over, vec3<f32>(0.0)) * sign(r.pos);

  // Extra viscous damping toward rest composes exactly with the drag:
  // dv/dt = (u-v)/τ - λv + a  ⇒  1/τ_eff = 1/τ + λ.
  let tauEff = 1.0 / (1.0 / tau + max(ru.damping, 0.0));
  let velRatio = tauEff / tau;

  // ── RK2 midpoint. Forward Euler behaves miserably for rotational
  //    motion — it spirals riders outward and hollows every vortex into
  //    a ring over time. Sampling the fluid at the midpoint of the step
  //    costs one extra trilinear fetch and fixes it. ─────────────────
  let u0 = sampleVelocityTrilinear(uvw) * extent * ru.flowScale
    + seekVel - outward * ru.containStrength;
  let half = riderIntegrate(r.pos, r.vel, u0 * velRatio + aExt * tauEff, tauEff, dt * 0.5);
  let uMidRaw = sampleVelocityTrilinear((half.pos + ru.bounds) / extent);
  let uMid = uMidRaw * extent * ru.flowScale
    + seekVel - outward * ru.containStrength;
  let step = riderIntegrate(r.pos, r.vel, uMid * velRatio + aExt * tauEff, tauEff, dt);

  var vel = step.vel;
  var pos = step.pos;

  var life = r.life - dt;

  // A rider that has ridden the plume all the way to the ceiling is DONE.
  // Without this it parks against the containment spring and the whole
  // population piles up at the top of the box instead of cycling through
  // the flow — which reads as a bug, not as riding.
  let ceiling = ru.bounds.y * 0.82;
  if (pos.y > ceiling) { life = min(life, 0.35); }
  // A rider that has fallen out of the paint is no longer riding
  // anything — retire it so the population tracks the fluid instead of
  // accumulating as debris drifting through empty space.
  if (density < 0.015) { life = min(life, 0.9); }

  // Retiring riders shrink out and respawning ones grow in, so recycling
  // never shows as a pop. fade is a plain radius multiplier that the bin
  // and render passes both honour.
  let retiring = life <= 0.0 || any(abs(pos) > ru.bounds * 1.04);
  let targetFade = select(1.0, 0.0, retiring);
  var fade = r.fade + (targetFade - r.fade) * (1.0 - exp(-9.0 * dt));
  if (retiring && fade < 0.04) {
    // Recycle through a seed-hashed emitter position so the population
    // stays inside the active flow instead of draining to the edges.
    let respawnSeed = r.seed + ru.time * 0.37 + f32(i) * 0.017;
    pos = riderSpawn(respawnSeed);
    vel = vec3<f32>(0.0);
    life = ru.lifeSpan * (0.45 + riderHash(respawnSeed * 5.7) * 0.9);
    fade = 0.0;
    r.tint = riderHash(respawnSeed * 13.3 + 0.9);
    r.radius = ru.radiusMin + pow(riderHash(respawnSeed * 23.1 + 3.3), 1.7) * ru.radiusVar;
  }

  r.pos = pos;
  r.vel = vel;
  r.tau = tau;
  r.life = life;
  r.fade = fade;
  riders[i] = r;
}
`;

/* ============================================================== */
/* WGSL — screen-tile binning                                      */
/* ============================================================== */
const FLUID_RIDERS_BIN_WGSL = /* wgsl */ `
struct Rider {
  pos:    vec3<f32>, radius: f32,
  vel:    vec3<f32>, tau:    f32,
  seed:   f32, tint: f32, life: f32, fade: f32,
};

struct BinU {
  viewProj: mat4x4<f32>,
  tileCountX: u32, tileCountY: u32, tileCap: u32, riderCount: u32,
  projY: f32, aspect: f32, radiusScale: f32, _pad0: f32,
};

@group(0) @binding(0) var<uniform>             bu:      BinU;
@group(0) @binding(1) var<storage, read>       riders:  array<Rider>;
@group(0) @binding(2) var<storage, read_write> counts:  array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> indices: array<u32>;

@compute @workgroup_size(64)
fn cs_clear_tiles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= bu.tileCountX * bu.tileCountY) { return; }
  atomicStore(&counts[i], 0u);
}

@compute @workgroup_size(64)
fn cs_bin_riders(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= bu.riderCount) { return; }
  let r = riders[i];
  let clip = bu.viewProj * vec4<f32>(r.pos, 1.0);
  // clip.w == view-space distance for this projection; reject behind-camera.
  if (clip.w <= 0.001) { return; }
  let ndc = clip.xyz / clip.w;

  let radius = max(r.radius * bu.radiusScale * r.fade, 1e-5);
  // Screen-space radius. projY = 1/tan(fov/2), so radius * projY / viewZ is
  // the half-height footprint in NDC; X divides by the aspect ratio.
  let rY = radius * bu.projY / max(clip.w, 1e-3);
  let rX = rY / max(bu.aspect, 1e-3);

  let uMin = (ndc.x - rX) * 0.5 + 0.5;
  let uMax = (ndc.x + rX) * 0.5 + 0.5;
  // NDC +Y is up, tile rows run top-down, so the V range flips.
  let vMin = 0.5 - (ndc.y + rY) * 0.5;
  let vMax = 0.5 - (ndc.y - rY) * 0.5;

  let tcx = i32(bu.tileCountX);
  let tcy = i32(bu.tileCountY);
  var x0 = i32(floor(uMin * f32(bu.tileCountX)));
  var x1 = i32(floor(uMax * f32(bu.tileCountX)));
  var y0 = i32(floor(vMin * f32(bu.tileCountY)));
  var y1 = i32(floor(vMax * f32(bu.tileCountY)));
  if (x1 < 0 || y1 < 0 || x0 >= tcx || y0 >= tcy) { return; }
  x0 = clamp(x0, 0, tcx - 1);
  x1 = clamp(x1, 0, tcx - 1);
  y0 = clamp(y0, 0, tcy - 1);
  y1 = clamp(y1, 0, tcy - 1);
  // A rider parked on the near plane can otherwise cover the whole grid;
  // cap the span so one degenerate rider cannot stall the dispatch.
  x1 = min(x1, x0 + 63);
  y1 = min(y1, y0 + 63);

  for (var ty = y0; ty <= y1; ty = ty + 1) {
    for (var tx = x0; tx <= x1; tx = tx + 1) {
      let tile = u32(ty) * bu.tileCountX + u32(tx);
      let slot = atomicAdd(&counts[tile], 1u);
      if (slot < bu.tileCap) {
        indices[tile * bu.tileCap + slot] = i;
      }
    }
  }
}
`;

/* ============================================================== */
/* WGSL — unified render                                           */
/* ============================================================== */
const FLUID_RIDERS_RENDER_WGSL = /* wgsl */ `
#include <noise>

struct Rider {
  pos:    vec3<f32>, radius: f32,
  vel:    vec3<f32>, tau:    f32,
  seed:   f32, tint: f32, life: f32, fade: f32,
};

struct RenderU {
  invViewProj:  mat4x4<f32>,
  smokeTint:    vec3<f32>, exposure: f32,
  volumeScale:  vec3<f32>, density:  f32,
  bgColor:      vec3<f32>, bgOpacity: f32,
  gridX: u32, gridY: u32, gridZ: u32, riderCount: u32,
  keyDir:       vec3<f32>, keyStrength: f32,
  keyColor:     vec3<f32>, anisotropy:  f32,
  fillDir:      vec3<f32>, fillStrength: f32,
  fillColor:    vec3<f32>, roughness:    f32,
  rimDir:       vec3<f32>, rimStrength:  f32,
  rimColor:     vec3<f32>, metalness:    f32,
  paletteA:     vec3<f32>, emission:     f32,
  paletteB:     vec3<f32>, msStrength:   f32,
  paletteC:     vec3<f32>, shadowStepLen: f32,
  paletteD:     vec3<f32>, aoStrength:   f32,
  shadowSteps: u32, marchSteps: u32, tileCountX: u32, tileCountY: u32,
  radiusScale: f32, ambient: f32, vignette: f32, bgMode: f32,
  frameIndex: u32, tonemap: f32, clearCoat: f32, coatRoughness: f32,
  isoLevel: f32, paintThickness: f32, colorFollow: f32, edgeSoftness: f32,
  riderOpacity: f32, reflectStrength: f32, liquidGlass: f32, surfaceDetail: f32,
  detailScale: f32, timeSec: f32, submergeClarity: f32, riderHits: u32,
};

@group(0) @binding(0) var<uniform>       u:        RenderU;
@group(0) @binding(1) var<storage, read> densBuf:  array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> riders:   array<Rider>;
@group(0) @binding(3) var<storage, read> tileCounts:  array<u32>;
@group(0) @binding(4) var<storage, read> tileIndices: array<u32>;

const SR_PI: f32 = 3.14159265359;

fn srFlat(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * u.gridX + u32(p.z) * u.gridX * u.gridY;
}

fn srSampleDensity(uvw: vec3<f32>) -> vec4<f32> {
  let dim = vec3<f32>(f32(u.gridX), f32(u.gridY), f32(u.gridZ));
  let p = clamp(uvw, vec3<f32>(0.001), vec3<f32>(0.999)) * dim - vec3<f32>(0.5);
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let mx = vec3<i32>(i32(u.gridX) - 1, i32(u.gridY) - 1, i32(u.gridZ) - 1);
  let v000 = densBuf[srFlat(clamp(p0 + vec3<i32>(0, 0, 0), vec3<i32>(0), mx))];
  let v100 = densBuf[srFlat(clamp(p0 + vec3<i32>(1, 0, 0), vec3<i32>(0), mx))];
  let v010 = densBuf[srFlat(clamp(p0 + vec3<i32>(0, 1, 0), vec3<i32>(0), mx))];
  let v110 = densBuf[srFlat(clamp(p0 + vec3<i32>(1, 1, 0), vec3<i32>(0), mx))];
  let v001 = densBuf[srFlat(clamp(p0 + vec3<i32>(0, 0, 1), vec3<i32>(0), mx))];
  let v101 = densBuf[srFlat(clamp(p0 + vec3<i32>(1, 0, 1), vec3<i32>(0), mx))];
  let v011 = densBuf[srFlat(clamp(p0 + vec3<i32>(0, 1, 1), vec3<i32>(0), mx))];
  let v111 = densBuf[srFlat(clamp(p0 + vec3<i32>(1, 1, 1), vec3<i32>(0), mx))];
  let x00 = mix(v000, v100, f.x);
  let x10 = mix(v010, v110, f.x);
  let x01 = mix(v001, v101, f.x);
  let x11 = mix(v011, v111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

fn srHash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + vec3<f32>(dot(p3, p3.yzx + vec3<f32>(33.33)));
  return fract((p3.x + p3.y) * p3.z);
}

fn srIntersectBox(ro: vec3<f32>, rd: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> vec2<f32> {
  let invD = vec3<f32>(1.0) / rd;
  let t0 = (bmin - ro) * invD;
  let t1 = (bmax - ro) * invD;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2<f32>(
    max(max(tmin.x, tmin.y), tmin.z),
    min(min(tmax.x, tmax.y), tmax.z),
  );
}

// Henyey-Greenstein phase — the forward-scatter lobe that produces the
// bright halo where the key light shines through the thin edges.
fn srHg(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * SR_PI * pow(max(denom, 1e-4), 1.5));
}

// Filament's numerically-hardened GGX. The textbook form squares
// (NoH²(a²-1)+1), which loses all its bits in fp32 on a smooth material
// at grazing angles and shows up as blocky highlights on exactly the
// glossy spheres this instrument is built around.
fn srDGgx(nDotH: f32, a: f32) -> f32 {
  let a2 = nDotH * a;
  let k = a / max(1.0 - nDotH * nDotH + a2 * a2, 1e-8);
  return k * k * (1.0 / SR_PI);
}

// Height-correlated Smith visibility. This already carries the
// 1/(4·NoL·NoV) denominator, so the specular term is D*V*F with no
// further division.
fn srVSmith(nDotV: f32, nDotL: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = nDotL * sqrt(nDotV * nDotV * (1.0 - a2) + a2);
  let gl = nDotV * sqrt(nDotL * nDotL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

// Kelemen visibility for the clear coat: the coat is a thin smooth
// dielectric, so the full Smith term is wasted on it.
fn srVKelemen(lDotH: f32) -> f32 {
  return 0.25 / max(lDotH * lDotH, 1e-4);
}

fn srFSchlick(f0: f32, cosT: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

fn srFresnel(f0: vec3<f32>, cosT: f32) -> vec3<f32> {
  let f = pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * f;
}

// Cheap procedural studio environment: ground, horizon, sky, plus a
// bright key blob. Sampled along the reflection vector this is what
// makes the riders read as raytraced instead of shaded.
fn srEnv(dir: vec3<f32>) -> vec3<f32> {
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let ground  = vec3<f32>(0.030, 0.028, 0.026);
  let horizon = vec3<f32>(0.240, 0.235, 0.230);
  let sky     = vec3<f32>(0.380, 0.430, 0.520);
  var col = mix(ground, horizon, smoothstep(0.0, 0.5, t));
  col = mix(col, sky, smoothstep(0.5, 1.0, t));
  // Thin bright horizon strip: a mirror needs STRUCTURE, and a smooth
  // three-band gradient has none — this is the streak that sweeps
  // across the glossy surfaces as they turn.
  let band = exp(-abs(dir.y - 0.06) * 24.0) * 0.4;
  col = col + vec3<f32>(0.55, 0.57, 0.60) * band;
  let blob = pow(max(dot(dir, u.keyDir), 0.0), 48.0) * 2.4;
  let bounce = pow(max(dot(dir, -u.keyDir), 0.0), 8.0) * 0.25;
  return col + u.keyColor * blob + u.fillColor * bounce;
}

fn srPalette(t: f32) -> vec3<f32> {
  let x = fract(t) * 4.0;
  let idx = u32(floor(x));
  let f = fract(x);
  var c0 = u.paletteA;
  var c1 = u.paletteB;
  if (idx == 1u) { c0 = u.paletteB; c1 = u.paletteC; }
  else if (idx == 2u) { c0 = u.paletteC; c1 = u.paletteD; }
  else if (idx >= 3u) { c0 = u.paletteD; c1 = u.paletteA; }
  return mix(c0, c1, f);
}

// Beer-Lambert transmittance along a direction through the volume.
// Shared by the in-scatter term and by the riders' volume shadow, so
// smoke shadows land on the spheres exactly as they land on itself.
fn srShadowMarch(start: vec3<f32>, dir: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>, stepScale: f32) -> f32 {
  if (u.shadowSteps == 0u) { return 1.0; }
  let stepLen = max(u.shadowStepLen, 0.001) * stepScale;
  let extent = bmax - bmin;
  var depth = 0.0;
  var lp = start;
  var s: u32 = 0u;
  loop {
    if (s >= u.shadowSteps) { break; }
    lp = lp + dir * stepLen;
    if (lp.x < bmin.x || lp.y < bmin.y || lp.z < bmin.z ||
        lp.x > bmax.x || lp.y > bmax.y || lp.z > bmax.z) { break; }
    let ls = srSampleDensity((lp - bmin) / extent);
    depth = depth + ls.w * stepLen * u.density;
    s = s + 1u;
  }
  return exp(-depth);
}

// Outward surface normal for the liquid: the density field's gradient,
// negated because density INCREASES going inward.
fn srSurfaceNormal(uvw: vec3<f32>, h: f32) -> vec3<f32> {
  let dx = srSampleDensity(uvw + vec3<f32>(h, 0.0, 0.0)).w - srSampleDensity(uvw - vec3<f32>(h, 0.0, 0.0)).w;
  let dy = srSampleDensity(uvw + vec3<f32>(0.0, h, 0.0)).w - srSampleDensity(uvw - vec3<f32>(0.0, h, 0.0)).w;
  let dz = srSampleDensity(uvw + vec3<f32>(0.0, 0.0, h)).w - srSampleDensity(uvw - vec3<f32>(0.0, 0.0, h)).w;
  let g = vec3<f32>(dx, dy, dz);
  let m = length(g);
  if (m < 1e-6) { return vec3<f32>(0.0, 1.0, 0.0); }
  return -g / m;
}

fn srAces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3<f32>(b))) / (x * (c * x + vec3<f32>(d)) + vec3<f32>(e)),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

// ── AgX ────────────────────────────────────────────────────────────
// ACES' RRT skews saturated warm tones toward yellow as they brighten
// (the "notorious six"), so a bright orange highlight leaves the hue it
// started on and the paint reads as plastic. Measured on this palette:
// pure orange run from 1/4 to 16 stops drifts 20°→59° through ACES and
// only 18°→40° through AgX, and AgX gets there by desaturating toward
// white the way film does rather than by rotating the hue.
//
// The inset matrix mixes the channels together before the curve (which
// is what stops one channel clipping alone and dragging the hue) and
// the outset undoes most of it afterwards. Both preserve neutral grey,
// which is the round-trip worth checking: 0.18 in must come back 0.18.
//
// WGSL mat3x3 takes COLUMNS, same as GLSL, so these are transcribed in
// source order from Godot's tonemap.glsl.
const SR_AGX_MID: f32 = 0.18;
const SR_AGX_TOE: f32 = 1.35;

fn srAgxCurve(x: vec3<f32>) -> vec3<f32> {
  // Below middle grey a power toe, above it a Reinhard shoulder. The
  // shoulder constant is chosen so the two halves share a slope at 0.18
  // — a kink there is instantly visible as a banded ramp in the smoke.
  let shoulder = (1.0 - SR_AGX_MID) / SR_AGX_TOE;
  let c = max(x, vec3<f32>(0.0));
  let toe = vec3<f32>(SR_AGX_MID) * pow(c / SR_AGX_MID, vec3<f32>(SR_AGX_TOE));
  let d = max(c - vec3<f32>(SR_AGX_MID), vec3<f32>(0.0));
  let knee = vec3<f32>(SR_AGX_MID) + (1.0 - SR_AGX_MID) * (d / (d + vec3<f32>(shoulder)));
  return select(knee, toe, c < vec3<f32>(SR_AGX_MID));
}

fn srAgx(x: vec3<f32>) -> vec3<f32> {
  let inset = mat3x3<f32>(
    vec3<f32>(0.544814746488245, 0.140416948464053, 0.0888104196149096),
    vec3<f32>(0.373787398372697, 0.754137554567394, 0.178871756420858),
    vec3<f32>(0.0813978551390581, 0.105445496968552, 0.732317823964232),
  );
  let outset = mat3x3<f32>(
    vec3<f32>(1.96488741169489, -0.299313364904742, -0.164352742528393),
    vec3<f32>(-0.855988495690215, 1.32639796461980, -0.238183969428088),
    vec3<f32>(-0.108898916004672, -0.0270845997150571, 1.40253671195648),
  );
  var c = inset * max(x, vec3<f32>(0.0));
  c = srAgxCurve(c);
  c = min(vec3<f32>(1.0), c);
  return clamp(outset * c, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn srTonemap(x: vec3<f32>) -> vec3<f32> {
  if (u.tonemap > 1.5) { return clamp(x, vec3<f32>(0.0), vec3<f32>(1.0)); }
  if (u.tonemap > 0.5) { return srAces(x); }
  return srAgx(x);
}

// ── Per-orb dielectric shading. ────────────────────────────────────
// Split into diffuse and specular because a glass sphere's REFLECTIONS
// do not fade with its transparency — only its body does. The composite
// emits (diffuse * alpha + spec), so the studio highlight and the env
// mirror keep full strength at any opacity. Scaling one premultiplied
// colour by alpha instead is exactly what made the old Orb Opacity read
// as a global dimmer.
struct RiderShade {
  diffuse: vec3<f32>,
  spec:    vec3<f32>,
  alpha:   f32,
};

fn srShadeRider(
  ri: u32,
  t: f32,
  ro: vec3<f32>,
  rd: vec3<f32>,
  bmin: vec3<f32>,
  bmax: vec3<f32>,
) -> RiderShade {
  let rider = riders[ri];
  let radius = max(rider.radius * u.radiusScale * rider.fade, 1e-5);
  // Re-derive the chord instead of carrying it in a second per-hit
  // array: ten ALU beats eight live registers held across the whole
  // fragment shader, and occupancy is what this pass is short of.
  let ocR = ro - rider.pos;
  let bqR = dot(ocR, rd);
  let discR = max(bqR * bqR - (dot(ocR, ocR) - radius * radius), 0.0);
  let sqR = sqrt(discR);
  let chord = max((-bqR + sqR) - max(-bqR - sqR, 0.0), 0.0);
  let extent = bmax - bmin;
  let hitPos = ro + rd * t;
  let n = normalize(hitPos - rider.pos);
  let v = -rd;
  let nDotV = max(dot(n, v), 1e-4);
  let rough = clamp(u.roughness, 0.03, 1.0);
  let a = rough * rough;
  let paletteAlbedo = srPalette(rider.tint + rider.seed * 0.13);
  let fluidHere = srSampleDensity((rider.pos - bmin) / extent);
  // Only follow where there is actually fluid, so riders out in clear air
  // keep their palette colour instead of fading to black.
  let followAmt = clamp(u.colorFollow * 0.1, 0.0, 1.0) * smoothstep(0.0, u.isoLevel, fluidHere.w);
  let albedo = mix(paletteAlbedo, fluidHere.xyz * u.smokeTint, followAmt);
  let f0 = mix(vec3<f32>(0.04), albedo, clamp(u.metalness, 0.0, 1.0));
  let diffuseAlbedo = albedo * (1.0 - clamp(u.metalness, 0.0, 1.0));

  // ── Coverage as a dielectric shell rather than a flat opacity. ────
  // Fresnel first: at grazing incidence a glass sphere is a MIRROR and
  // fully covers, face-on it is a window. That single term is most of
  // the bubble read — a bright rim with a see-through middle.
  // Then Beer-Lambert over the chord the ray actually cut, so the same
  // orb is denser through its middle than near its edge, and a fat orb
  // is denser than a droplet at matching angles.
  let op = clamp(u.riderOpacity, 0.0, 1.0);
  let fShell = srFSchlick(0.04, nDotV);
  // Orb Opacity is the body's ABSORPTION COEFFICIENT, not a lerp on the
  // final alpha. Lerping alpha toward 1 leaves a 0.35 orb still ~0.7
  // covered — which is why the slider only ever read as a dimmer. As a
  // coefficient it runs 0 → infinity across the slider, so the bottom
  // half is genuinely thin glass and the top is solid.
  let bodyK = (op / max(1.0 - op, 1e-3)) * 1.1;
  // chord/(2r) is 0..1 pure geometry; radius/radiusScale is the rider's
  // OWN size in units of the population's reference, so the density
  // ranking survives the global Rider Size knob.
  let sizeRatio = radius / max(u.radiusScale, 1e-5);
  let optical = (chord / max(2.0 * radius, 1e-5)) * sizeRatio * bodyK;
  let bodyCover = 1.0 - exp(-max(optical, 0.0));
  let shellA = fShell + (1.0 - fShell) * bodyCover;
  // Pinned at exactly 1 at the top of the slider so existing projects
  // render identically to before.
  let alpha = select(clamp(shellA, 0.0, 1.0), 1.0, op >= 0.999);

  // Volume shadow: march the density grid from the surface toward the
  // key light. Without this the riders float ON the smoke; with it
  // they sit IN it.
  let volShadow = srShadowMarch(hitPos + n * 0.01, u.keyDir, bmin, bmax, 3.0);

  // Fluid AO: how much smoke is packed around the contact point.
  let aoUvw = (hitPos - bmin) / extent;
  let aoDen = (srSampleDensity(aoUvw).w
    + srSampleDensity(aoUvw + n * 0.035).w
    + srSampleDensity(aoUvw - n * 0.035).w) * 0.3333;
  let ao = clamp(1.0 / (1.0 + max(u.aoStrength, 0.0) * aoDen * 0.35), 0.25, 1.0);

  // ── An orb BURIED in the paint is not in shadow. It is suspended in a
  //    lit scattering medium with glowing pigment on every side, so the
  //    key light's hard volume shadow and the contact AO — both correct
  //    for an orb sitting ON the surface — punch it out as a black hole
  //    in the pour instead. Fade both toward an isotropic in-scatter as
  //    the local density rises past the iso level, and light the orb
  //    with the surrounding paint's own colour.
  //    Tuned by eye against the probe: lift it all the way and a buried
  //    orb takes the paint's own colour and disappears; leave it out and
  //    it is a black hole. It wants to stay READABLE — a shade deeper
  //    and more saturated than the pour it is suspended in.
  let embed = smoothstep(0.0, max(u.isoLevel, 1e-3) * 1.2, aoDen);
  let shadeIn = mix(volShadow, 1.0, embed * 0.55);
  let aoIn = mix(ao, 1.0, embed * 0.45);
  let mediumLit = fluidHere.xyz * u.smokeTint * u.keyColor
    * (max(u.keyStrength, 0.0) * 0.08 * embed);

  // Glossy paint is not one lobe. It is a pigmented base plus a thin
  // clear dielectric coat over the top, and the coat is what produces
  // the tight white highlight that reads as "wet" — a single GGX lobe
  // widened to match only ever reads as "shiny plastic".
  let coat = clamp(u.clearCoat, 0.0, 1.0);
  let coatRough = clamp(u.coatRoughness, 0.03, 1.0);
  let coatA = coatRough * coatRough;

  var litD = vec3<f32>(0.0);
  var litS = vec3<f32>(0.0);
  // Key (warm, shadowed by the volume).
  {
    let l = u.keyDir;
    let h = normalize(l + v);
    let nDotL = max(dot(n, l), 1e-4);
    let nDotH = max(dot(n, h), 0.0);
    let lDotH = max(dot(l, h), 0.0);
    let spec = srDGgx(nDotH, a) * srVSmith(nDotV, nDotL, a);
    let fr = srFresnel(f0, lDotH);
    // Coat f0 = 0.04 (IOR 1.5). Whatever the coat reflects never
    // reaches the base, so the base lobe is attenuated by (1 - Fc).
    let fc = srFSchlick(0.04, lDotH) * coat;
    let specCoat = srDGgx(nDotH, coatA) * srVKelemen(lDotH) * fc;
    let radiance = u.keyColor * (u.keyStrength * nDotL * shadeIn);
    litD = litD + radiance * (diffuseAlbedo / SR_PI) * (1.0 - fc);
    litS = litS + radiance * (fr * spec * (1.0 - fc) + vec3<f32>(specCoat));
  }
  // Fill (cool, unshadowed — bounce light does not cast).
  {
    let l = u.fillDir;
    let h = normalize(l + v);
    let nDotL = max(dot(n, l), 1e-4);
    let nDotH = max(dot(n, h), 0.0);
    let lDotH = max(dot(l, h), 0.0);
    let spec = srDGgx(nDotH, a) * srVSmith(nDotV, nDotL, a);
    let fr = srFresnel(f0, lDotH);
    let fc = srFSchlick(0.04, lDotH) * coat;
    let specCoat = srDGgx(nDotH, coatA) * srVKelemen(lDotH) * fc;
    let radiance = u.fillColor * (u.fillStrength * nDotL);
    litD = litD + radiance * (diffuseAlbedo / SR_PI) * (1.0 - fc);
    litS = litS + radiance * (fr * spec * (1.0 - fc) + vec3<f32>(specCoat));
  }
  // Back rim — the separation edge that pops them off the smoke.
  {
    let l = u.rimDir;
    let nDotL = max(dot(n, l), 0.0);
    let edge = pow(1.0 - nDotV, 2.5);
    litS = litS + u.rimColor * (u.rimStrength * nDotL * edge);
  }
  // Environment reflection — base lobe plus the coat's own mirror
  // term, which is what puts the studio in the highlight. Scaled by
  // the Reflections knob, and topped up with a Fresnel-only mirror as
  // coverage drops so a see-through orb reads as GLASS, not as a ghost.
  {
    let refl = reflect(rd, n);
    let env = srEnv(refl);
    let fr = srFresnel(f0, nDotV);
    let fc = srFSchlick(0.04, nDotV) * coat;
    let reflGain = max(u.reflectStrength, 0.0);
    litS = litS + env * fr * (0.55 * (1.0 - rough * 0.65)) * (1.0 - fc) * reflGain;
    litS = litS + env * (fc * (1.0 - coatRough * 0.6)) * reflGain;
    litS = litS + env * fr * ((1.0 - alpha) * 0.9 * reflGain);
  }
  litD = litD + diffuseAlbedo * (vec3<f32>(u.ambient) + mediumLit);

  var out: RiderShade;
  out.diffuse = litD * aoIn;
  out.spec = litS * aoIn;
  out.alpha = alpha;
  return out;
}

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
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
  // ── 1. World ray for this pixel. ───────────────────────────────
  let ndc = in.ndc;
  let nearW = u.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let farW  = u.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let ro = nearW.xyz / nearW.w;
  let rd = normalize(farW.xyz / farW.w - ro);

  let bmin = -u.volumeScale;
  let bmax =  u.volumeScale;
  let extent = bmax - bmin;

  // ── 2. Analytic sphere pass over this pixel's tile bucket. The K
  //     NEAREST hits are kept, insertion-sorted by entry t, instead of
  //     only the nearest — that is what lets a glass orb show the orbs
  //     behind it. K = 1 collapses to the old nearest-hit path, and at
  //     Orb Opacity 1 the composite saturates on the first hit anyway,
  //     so the extra hits cost nothing until glass is dialled in.
  var hitT = array<f32, ${FLUID_RIDERS_MAX_HITS}>(1.0e30, 1.0e30, 1.0e30, 1.0e30);
  var hitRi = array<u32, ${FLUID_RIDERS_MAX_HITS}>(0u, 0u, 0u, 0u);
  var hitCount: u32 = 0u;
  let maxHits = clamp(u.riderHits, 1u, ${FLUID_RIDERS_MAX_HITS}u);
  let tu = clamp(u32((ndc.x * 0.5 + 0.5) * f32(u.tileCountX)), 0u, max(u.tileCountX, 1u) - 1u);
  let tv = clamp(u32((0.5 - ndc.y * 0.5) * f32(u.tileCountY)), 0u, max(u.tileCountY, 1u) - 1u);
  let tile = tv * u.tileCountX + tu;
  let bucket = min(tileCounts[tile], ${FLUID_RIDERS_TILE_CAP}u);
  var b: u32 = 0u;
  loop {
    if (b >= bucket) { break; }
    let ri = tileIndices[tile * ${FLUID_RIDERS_TILE_CAP}u + b];
    b = b + 1u;
    if (ri >= u.riderCount) { continue; }
    let rider = riders[ri];
    let radius = rider.radius * u.radiusScale * rider.fade;
    if (radius < 1e-4) { continue; }
    let oc = ro - rider.pos;
    let bq = dot(oc, rd);
    let cq = dot(oc, oc) - radius * radius;
    let disc = bq * bq - cq;
    if (disc < 0.0) { continue; }
    let sq = sqrt(disc);
    let tNear = -bq - sq;
    let tFar = -bq + sq;
    var t = tNear;
    if (t < 0.001) { t = tFar; }
    if (t < 0.001) { continue; }
    // Full list and this hit is behind the worst kept one: reject.
    if (hitCount >= maxHits && t >= hitT[maxHits - 1u]) { continue; }
    // Insertion sort by t. The list is at most 8 long, so shifting is
    // cheaper than any sort worth the name.
    var slot = min(hitCount, maxHits - 1u);
    loop {
      if (slot == 0u) { break; }
      if (hitT[slot - 1u] <= t) { break; }
      hitT[slot] = hitT[slot - 1u];
      hitRi[slot] = hitRi[slot - 1u];
      slot = slot - 1u;
    }
    hitT[slot] = t;
    hitRi[slot] = ri;
    hitCount = min(hitCount + 1u, maxHits);
  }
  let hasHit = hitCount > 0u;
  let tHit = hitT[0];

  // ── 3. Iso-surface hunt. An OPAQUE rider clips the march (liquid
  //     behind it is never marched); a transparent rider must NOT stop
  //     it — the surface behind the orb has to be found so it can show
  //     through the glass. The composite in section 5 orders the two
  //     hits by actual depth.
  var surfHit = false;
  var surfT = 1.0e30;
  var surfRGB = vec3<f32>(0.0);
  var surfA = 0.0;
  var surfTint = vec3<f32>(1.0);
  // Per-unit-depth extinction for looking INTO the paint (section 5).
  var surfSubK = vec3<f32>(1.0e30);
  let riderOpaque = clamp(u.riderOpacity, 0.0, 1.0) >= 0.999;
  let slab = srIntersectBox(ro, rd, bmin, bmax);
  if (slab.y >= slab.x && slab.y > 0.0) {
    let tStart = max(slab.x, 0.0);
    let tEnd = select(slab.y, min(slab.y, tHit), hasHit && riderOpaque);
    if (tEnd > tStart) {
      let steps = clamp(u.marchSteps, 8u, 192u);
      let stepLen = (tEnd - tStart) / f32(steps);
      // QUARTER-strength temporal dither. The full golden-ratio offset
      // (which the smoke instrument and the shadow march keep) moves the
      // surface-crossing sample a whole step every frame, and on a 48³
      // grid that reads as a crawling, jagged silhouette. A quarter of
      // the sequence still breaks banding without the crawl.
      let dither = fract(srHash12(in.pos.xy) + 0.61803398875 * f32(u.frameIndex)) * 0.25;
      var t0 = tStart + stepLen * dither;
      var prevT = t0;
      var i: u32 = 0u;
      // Viscous liquid is (near-)OPAQUE: instead of integrating
      // transmittance we hunt the isosurface where density crosses the
      // threshold, refine the crossing, and shade it as a glossy
      // dielectric surface.
      loop {
        if (i >= steps) { break; }
        i = i + 1u;
        if (t0 > tEnd) { break; }
        let d = srSampleDensity((ro + rd * t0 - bmin) / extent).w;
        if (d >= u.isoLevel) {
          // Binary refine so the surface is not stair-stepped.
          var lo = prevT;
          var hi = t0;
          var r: u32 = 0u;
          loop {
            if (r >= 4u) { break; }
            r = r + 1u;
            let mid = (lo + hi) * 0.5;
            if (srSampleDensity((ro + rd * mid - bmin) / extent).w >= u.isoLevel) { hi = mid; } else { lo = mid; }
          }
          let ht = hi;
          let hpos = ro + rd * ht;
          let huvw = (hpos - bmin) / extent;
          let sc = srSampleDensity(huvw);
          // Narrow + wide gradient taps averaged: the narrow tap keeps
          // the sheet's shape, the wide tap kills the grid-frequency
          // grit that made the surface look pebble-dashed.
          let gridF = f32(max(u.gridX, 1u));
          let hnNarrow = srSurfaceNormal(huvw, 1.5 / gridF);
          let hnWide = srSurfaceNormal(huvw, 3.0 / gridF);
          let hnGeo = normalize(hnNarrow + hnWide);
          var hn = hnGeo;
          // Sculpted micro-texture: two octaves of curl noise perturb
          // the normal. 0 = poured glass, high = rough cast concrete.
          if (u.surfaceDetail > 0.001) {
            let dq = hpos * u.detailScale + vec3<f32>(0.0, u.timeSec * 0.12, 0.0);
            let dn = ghost_curl_noise3(dq) + ghost_curl_noise3(dq * 2.63 + vec3<f32>(17.7)) * 0.5;
            hn = normalize(hn + dn * (u.surfaceDetail * 0.55));
          }
          let hv = -rd;

          // Beer-Lambert body tint: march a little past the surface so thick
          // pours read deeply saturated while thin sheets stay translucent.
          var thick = 0.0;
          var q: u32 = 0u;
          loop {
            if (q >= 6u) { break; }
            q = q + 1u;
            let tp = ht + f32(q) * stepLen;
            if (tp > slab.y) { break; }
            thick = thick + srSampleDensity((ro + rd * tp - bmin) / extent).w * stepLen;
          }
          let tint = sc.xyz * u.smokeTint;
          let absorb = exp(-max(thick, 0.0) * u.density * u.paintThickness * 3.0 * (vec3<f32>(1.0) - tint));

          let shadow = srShadowMarch(hpos + hn * 0.01, u.keyDir, bmin, bmax, 1.0);
          let rough = clamp(u.roughness, 0.03, 1.0);
          let a = max(rough * rough, 0.002);
          let nv = max(dot(hn, hv), 1e-4);
          let nvGeo = max(dot(hnGeo, hv), 0.0);

          // Key: GGX + clear coat.
          let hl = normalize(u.keyDir + hv);
          let nl = max(dot(hn, u.keyDir), 0.0);
          let nh = max(dot(hn, hl), 0.0);
          let lh = max(dot(hl, u.keyDir), 0.0);
          let spec = srDGgx(nh, a) * srVSmith(nv, nl, a) * srFresnel(vec3<f32>(0.04), lh);
          let ca = max(u.coatRoughness * u.coatRoughness, 0.002);
          let coat = srDGgx(nh, ca) * srVKelemen(lh) * srFSchlick(0.04, lh) * u.clearCoat;
          // Wrapped diffuse stands in for subsurface travel in thick media.
          let wrap = max(dot(hn, u.keyDir) * 0.5 + 0.5, 0.0);
          let diffuse = tint * absorb * wrap;
          let keyLit = (diffuse + spec + vec3<f32>(coat)) * u.keyColor * (u.keyStrength * shadow);

          let fillLit = tint * absorb * u.fillColor * (u.fillStrength * max(dot(hn, -u.fillDir) * 0.5 + 0.5, 0.0));
          let rimLit = u.rimColor * (u.rimStrength * pow(1.0 - nv, 4.0));
          // Env mirror obeys roughness (a rough pour should not mirror
          // the studio) and the Reflections knob.
          let envLit = srEnv(reflect(-hv, hn)) * srFresnel(vec3<f32>(0.04), nv)
            * (0.6 + u.clearCoat) * (1.0 - rough * 0.7) * max(u.reflectStrength, 0.0);
          let col = keyLit + fillLit + rimLit + envLit + tint * absorb * u.ambient;

          // Silhouette coverage: grazing rays (GEOMETRIC normal nearly
          // perpendicular to the view) get partial alpha, so the edge
          // resolves as a soft anti-aliased arc instead of a voxel
          // staircase.
          var alpha = smoothstep(0.0, max(u.edgeSoftness, 1e-4), nvGeo);
          // Sub-voxel wisps: a sheet thinner than a march step resolves
          // as per-pixel hit-or-miss stipple. Fading coverage with the
          // optical thickness dissolves those wisps smoothly instead of
          // leaving a static dot pattern; solid bodies (thick >> 0.05)
          // are untouched.
          alpha = alpha * smoothstep(0.0, 0.045, thick);
          // Glass: facing regions keep the Fresnel reflection but
          // transmit the rest; the Beer-Lambert absorb tints whatever
          // shows through (section 5).
          let glass = clamp(u.liquidGlass, 0.0, 1.0);
          let fGlass = srFSchlick(0.04, nv);
          alpha = alpha * mix(1.0, fGlass + (1.0 - fGlass) * 0.25, glass);
          surfTint = mix(vec3<f32>(1.0), absorb, glass);
          // Extinction for radiance travelling back up through the paint
          // from something SUBMERGED in it. The colour-selective part is
          // the body tint (an orange pour passes red and eats blue, so a
          // buried orb glows red before it disappears); the grey floor is
          // plain turbidity, which is what makes depth read as depth
          // rather than as a hue shift.
          let tintC = clamp(tint, vec3<f32>(0.0), vec3<f32>(0.95));
          surfSubK = (vec3<f32>(0.55) + (vec3<f32>(1.0) - tintC))
            * ((u.density * max(u.paintThickness, 0.0) + 0.4) * 1.5);
          surfRGB = col * u.emission;
          surfA = clamp(alpha, 0.0, 1.0);
          surfT = ht;
          surfHit = true;
          break;
        }
        prevT = t0;
        t0 = t0 + stepLen;
      }
    }
  }

  // ── 4. Shade the depth-sorted orbs, front-to-back, split by whether
  //     each one sits in front of the liquid surface or under it.
  //     Everything submerged is attenuated by the paint standing over
  //     IT specifically — which is what produces a waterline for free
  //     on an orb straddling the skin: pixels just below the crossing
  //     have a near-zero path through the paint and darken smoothly as
  //     the orb sinks away from the camera.
  var frontRGB = vec3<f32>(0.0);
  var frontA = 0.0;
  var backRGB = vec3<f32>(0.0);
  var backA = 0.0;
  // Depth-weighted coverage of the submerged stack: how much of the
  // paint's own glow each buried orb blocks. Without it a submerged orb
  // can only ADD light and reads as a highlight on the pour rather than
  // as a solid object suspended inside it.
  var backOcc = 0.0;
  let clarity = clamp(u.submergeClarity, 0.0, 1.0);
  let surfLeak = 1.0 - surfA;
  var k: u32 = 0u;
  loop {
    if (k >= hitCount) { break; }
    // Saturated: no light from further back can reach the camera, so
    // stop paying for per-orb PBR. At Orb Opacity 1 this fires on the
    // very first hit and the cost is identical to the old single-hit
    // path.
    if (frontA > 0.995) { break; }
    let ht = hitT[k];
    let submerged = surfHit && ht > surfT;
    if (submerged && backA > 0.995) { break; }
    let sh = srShadeRider(hitRi[k], ht, ro, rd, bmin, bmax);
    // Premultiplied contribution: the body scales with coverage, the
    // reflections do not.
    let pre = sh.diffuse * sh.alpha + sh.spec;
    if (submerged) {
      // Liquid throughput to THIS orb: the surface's own coverage gap
      // (unchanged from before) plus a look-into-the-paint term that
      // dies exponentially with how deep the orb sits. At Submerge
      // Clarity 0 the second term vanishes and the result is exactly
      // the old behaviour.
      let du = max(ht - surfT, 0.0);
      let deep = exp(-min(du * surfSubK, vec3<f32>(60.0)));
      let through = surfTint * (vec3<f32>(surfLeak) + deep * (surfA * clarity));
      let oneMinus = 1.0 - backA;
      backRGB = backRGB + pre * (oneMinus * through);
      backA = backA + sh.alpha * oneMinus;
      // Occlusion rides the clarity term only, so Submerge Clarity 0
      // leaves the old fully-opaque-liquid composite untouched.
      let deepS = (deep.r + deep.g + deep.b) * 0.33333;
      backOcc = backOcc + sh.alpha * oneMinus * (surfA * clarity * deepS);
    } else {
      let oneMinus = 1.0 - frontA;
      frontRGB = frontRGB + pre * oneMinus;
      frontA = frontA + sh.alpha * oneMinus;
    }
    k = k + 1u;
  }

  // Background: transparent, flat tint, or a vertical studio backdrop.
  // Computed on every path now — it shows through glassy liquid and
  // transparent orbs.
  var bgRGB = u.bgColor;
  if (u.bgMode > 1.5) {
    let vgrad = clamp(ndc.y * 0.5 + 0.5, 0.0, 1.0);
    bgRGB = mix(u.bgColor * 0.35, u.bgColor * 1.35 + vec3<f32>(0.02), vgrad);
  }
  let bgA = select(0.0, clamp(u.bgOpacity, 0.0, 1.0), u.bgMode > 0.5);

  // ── 5. Composite (premultiplied): front orbs OVER [liquid surface +
  //      whatever is submerged in it] OVER backdrop. The submerged
  //      stack already carries the liquid's throughput per orb, so it
  //      is ADDED to the surface rather than gated by it again — it is
  //      radiance emerging from inside the medium, which is exactly
  //      what a sphere buried in paint is.
  let bgPre = bgRGB * bgA;
  let deepRGB = backRGB + bgPre * ((1.0 - backA) * surfLeak) * surfTint;
  let deepA = backA + bgA * (1.0 - backA) * surfLeak;
  let liqRGB = surfRGB * (surfA * (1.0 - clamp(backOcc, 0.0, 1.0))) + deepRGB;
  let liqA = clamp(surfA + deepA * surfLeak, 0.0, 1.0);
  let outRGB = frontRGB + liqRGB * (1.0 - frontA);
  let outA = clamp(frontA + liqA * (1.0 - frontA), 0.0, 1.0);

  // ── 6. Tonemap + vignette. Tonemap the UNPREMULTIPLIED colour so a
  //      partially covered pixel keeps a sane hue, then restore the
  //      premultiplied form the compositor expects.
  let unpremul = outRGB / max(outA, 1e-4);
  var toned = srTonemap(unpremul * max(u.exposure, 0.0));
  let r2 = dot(ndc, ndc);
  let vig = mix(1.0, clamp(1.0 - 0.34 * r2, 0.0, 1.0), clamp(u.vignette, 0.0, 1.0));
  toned = toned * vig;
  return vec4<f32>(toned * outA, clamp(outA, 0.0, 1.0));
}
`;

/* ============================================================== */
/* SHADER REGISTRY                                                 */
/* ============================================================== */

export const FLUID_RIDERS_NATIVE_SHADER_IDS = Object.freeze({
  vorticity: 'fluid-riders/vorticity',
  pressure: 'fluid-riders/pressure',
  advect: 'fluid-riders/advect',
  surface: 'fluid-riders/surface',
  riders: 'fluid-riders/riders',
  tiles: 'fluid-riders/tiles',
  render: 'fluid-riders/render',
});

/** The full shader-id set this instrument's native graph installs —
 *  the reused fluid chain plus the new coupled passes. Kept here so the
 *  sync route table and the Rust manifest can be checked against one
 *  source of truth. */
export const FLUID_RIDERS_NATIVE_GRAPH_SHADER_IDS: readonly string[] = Object.freeze([
  SMOKE_3D_NATIVE_SHADER_IDS.splat,
  SMOKE_3D_NATIVE_SHADER_IDS.advectVelocity,
  SMOKE_3D_NATIVE_SHADER_IDS.divergence,
  SMOKE_3D_NATIVE_SHADER_IDS.jacobi,
  SMOKE_3D_NATIVE_SHADER_IDS.subtractGradient,
  SMOKE_3D_NATIVE_SHADER_IDS.advectDensity,
  FLUID_RIDERS_NATIVE_SHADER_IDS.vorticity,
  FLUID_RIDERS_NATIVE_SHADER_IDS.pressure,
  FLUID_RIDERS_NATIVE_SHADER_IDS.advect,
  FLUID_RIDERS_NATIVE_SHADER_IDS.surface,
  FLUID_RIDERS_NATIVE_SHADER_IDS.riders,
  FLUID_RIDERS_NATIVE_SHADER_IDS.tiles,
  FLUID_RIDERS_NATIVE_SHADER_IDS.render,
]);

export type FluidRidersNativeShaderStage = 'compute' | 'render';

export interface FluidRidersNativeShaderSource {
  shaderId: string;
  label: string;
  stage: FluidRidersNativeShaderStage;
  entry: string;
  source: string;
}

export interface FluidRidersNativePrecompileCommand {
  type: 'precompile_shader';
  shader_id: string;
  stage: FluidRidersNativeShaderStage;
  entry: string;
  source: string;
}

export function getFluidRidersNativeShaderSources(): FluidRidersNativeShaderSource[] {
  return [
    {
      shaderId: FLUID_RIDERS_NATIVE_SHADER_IDS.vorticity,
      label: 'fluid-riders/vorticity',
      stage: 'compute',
      entry: 'cs_vorticity',
      source: resolveGhostWgsl(FLUID_RIDERS_VORTICITY_WGSL, 'fluid-riders/vorticity'),
    },
    {
      shaderId: FLUID_RIDERS_NATIVE_SHADER_IDS.pressure,
      label: 'fluid-riders/pressure',
      stage: 'compute',
      entry: 'cs_pressure_warm',
      source: resolveGhostWgsl(FLUID_RIDERS_PRESSURE_WGSL, 'fluid-riders/pressure'),
    },
    {
      shaderId: FLUID_RIDERS_NATIVE_SHADER_IDS.advect,
      label: 'fluid-riders/advect',
      stage: 'compute',
      entry: 'cs_advect_fwd',
      source: resolveGhostWgsl(FLUID_RIDERS_ADVECT_WGSL, 'fluid-riders/advect'),
    },
    {
      shaderId: FLUID_RIDERS_NATIVE_SHADER_IDS.surface,
      label: 'fluid-riders/surface',
      stage: 'compute',
      entry: 'cs_surface_tension',
      source: resolveGhostWgsl(FLUID_RIDERS_SURFACE_WGSL, 'fluid-riders/surface'),
    },
    {
      shaderId: FLUID_RIDERS_NATIVE_SHADER_IDS.riders,
      label: 'fluid-riders/riders',
      stage: 'compute',
      entry: 'cs_riders',
      source: resolveGhostWgsl(FLUID_RIDERS_SIM_WGSL, 'fluid-riders/riders'),
    },
    {
      shaderId: FLUID_RIDERS_NATIVE_SHADER_IDS.tiles,
      label: 'fluid-riders/tiles',
      stage: 'compute',
      entry: 'cs_bin_riders',
      source: resolveGhostWgsl(FLUID_RIDERS_BIN_WGSL, 'fluid-riders/tiles'),
    },
    {
      shaderId: FLUID_RIDERS_NATIVE_SHADER_IDS.render,
      label: 'fluid-riders/render',
      stage: 'render',
      entry: 'fs_main',
      source: resolveGhostWgsl(FLUID_RIDERS_RENDER_WGSL, 'fluid-riders/render'),
    },
  ];
}

export function buildFluidRidersNativePrecompileCommands(): FluidRidersNativePrecompileCommand[] {
  return getFluidRidersNativeShaderSources().map((shader) => ({
    type: 'precompile_shader',
    shader_id: shader.shaderId,
    stage: shader.stage,
    entry: shader.entry,
    source: shader.source,
  }));
}

/* ============================================================== */
/* PARAM SCHEMA                                                    */
/* ============================================================== */

export const fluidRidersParamSchema: ParamControl[] = [
  { kind: 'select', key: 'quality', label: 'Quality', group: 'Core',
    options: [
      { value: 'performance', label: 'Performance' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'ultra', label: 'Ultra' },
    ],
    default: 'balanced' },
  { kind: 'select', key: 'style', label: 'Style', group: 'Core',
    options: [
      { value: 'paint', label: 'Paint Splash' },
      { value: 'ember', label: 'Ember Column' },
      { value: 'pearl', label: 'Pearl Drift' },
    ],
    default: 'paint' },
  { kind: 'slider', key: 'intensity', label: 'Intensity', group: 'Core',
    min: 0, max: 2, step: 0.01, default: 1 },
  { kind: 'slider', key: 'exposure', label: 'Exposure', group: 'Core',
    min: 0.1, max: 4, step: 0.01, default: 1.5 },
  // Master time scale for the whole solve (fluid + riders). The look is
  // built around slow, heavy motion — 1.0 is the old frenetic rate.
  { kind: 'slider', key: 'flowSpeed', label: 'Flow Speed', group: 'Core',
    min: 0.05, max: 2, step: 0.01, default: 0.32 },

  // ── Fluid ────────────────────────────────────────────────────
  { kind: 'slider', key: 'vorticity', label: 'Vorticity', group: 'Fluid',
    min: 0, max: 12, step: 0.05, default: 3.8 },
  { kind: 'slider', key: 'smokeDensity', label: 'Density', group: 'Fluid',
    min: 0, max: 8, step: 0.05, default: 3.0 },
  { kind: 'slider', key: 'smokeGlow', label: 'Volume Gain', group: 'Fluid',
    min: 0, max: 6, step: 0.05, default: 1.35 },
  { kind: 'slider', key: 'smokeTurbulence', label: 'Turbulence', group: 'Fluid',
    min: 0, max: 4, step: 0.01, default: 0.5 },
  { kind: 'slider', key: 'smokeSpread', label: 'Emitter Spread', group: 'Fluid',
    min: 0, max: 0.9, step: 0.01, default: 0.38 },
  { kind: 'slider', key: 'emitterCount', label: 'Emitters', group: 'Fluid',
    min: 1, max: 8, step: 1, default: 5 },
  { kind: 'slider', key: 'isoLevel', label: 'Surface Level', group: 'Fluid',
    min: 0.02, max: 2.5, step: 0.01, default: 0.42 },
  // Grazing-angle silhouette fade: 0 is a hard (stair-stepped) edge,
  // higher values feather the rim of the liquid.
  { kind: 'slider', key: 'edgeSoftness', label: 'Edge Softness', group: 'Fluid',
    min: 0, max: 0.5, step: 0.01, default: 0.18 },
  { kind: 'slider', key: 'viscosity', label: 'Viscosity', group: 'Fluid',
    min: 0, max: 1, step: 0.01, default: 0.72 },
  { kind: 'slider', key: 'surfaceTension', label: 'Surface Tension', group: 'Fluid',
    min: 0, max: 3, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'paintThickness', label: 'Paint Thickness', group: 'Fluid',
    min: 0, max: 2, step: 0.01, default: 0.5 },
  { kind: 'select', key: 'advection', label: 'Advection', group: 'Fluid',
    options: [
      { value: 'maccormack', label: 'MacCormack (sharp)' },
      { value: 'semi-lagrangian', label: 'Semi-Lagrangian (cheap)' },
    ],
    default: 'maccormack' },
  { kind: 'slider', key: 'shadowSteps', label: 'Shadow Steps', group: 'Fluid',
    min: 0, max: 12, step: 1, default: 5 },
  // 96 for the liquid (vs the smoke instrument's 72): the surface hunt
  // needs finer steps than a scatter integral or the silhouette pops.
  { kind: 'slider', key: 'marchSteps', label: 'March Steps', group: 'Fluid',
    min: 16, max: 160, step: 4, default: 96 },

  // ── Riders ───────────────────────────────────────────────────
  { kind: 'slider', key: 'colorFollow', label: 'Colour Follow', group: 'Riders',
    min: 0, max: 10, step: 0.05, default: 3.2 },
  { kind: 'select', key: 'colorPreset', label: 'Colour Preset', group: 'Palette',
    options: RIDERS_COLOR_PRESET_OPTIONS,
    default: 'custom' },
  { kind: 'slider', key: 'textureInfluence', label: 'Texture Influence', group: 'Palette',
    min: 0, max: 1, step: 0.01, default: 1 },
  { kind: 'slider', key: 'riderCount', label: 'Rider Count', group: 'Riders',
    min: 16, max: 2048, step: 8, default: 220 },
  { kind: 'slider', key: 'riderSize', label: 'Rider Size', group: 'Riders',
    min: 0.01, max: 0.3, step: 0.001, default: 0.042 },
  { kind: 'slider', key: 'riderSizeVariance', label: 'Size Variance', group: 'Riders',
    min: 0, max: 1, step: 0.01, default: 0.62 },
  // Weight IS the Stokes relaxation time τ at the reference radius. Each
  // rider scales it by its own r², so this slider sets the whole
  // population's lag while the size variance decides who lags most.
  { kind: 'slider', key: 'riderWeight', label: 'Weight', group: 'Riders',
    min: 0.01, max: 1.2, step: 0.005, default: 0.08 },
  // Spread in DECADES around Weight: 1.0 spans [0.1×, 10×], which is the
  // band where inertial clustering happens, so different riders settle
  // onto different filaments at the same time.
  { kind: 'slider', key: 'weightSpread', label: 'Weight Spread', group: 'Riders',
    min: 0, max: 1, step: 0.01, default: 0.38 },
  // ρ_p/ρ_f. Below 1 the rider is lighter than the paint and floats up.
  { kind: 'slider', key: 'riderDensity', label: 'Rider Density', group: 'Riders',
    min: 0.2, max: 4, step: 0.01, default: 1.9 },
  // Slightly hotter default coupling than the smoke instrument so the
  // orbs visibly translate with the sheet instead of hovering near it.
  { kind: 'slider', key: 'flowCoupling', label: 'Flow Coupling', group: 'Riders',
    min: 0, max: 3, step: 0.01, default: 1.35 },
  { kind: 'slider', key: 'buoyancy', label: 'Buoyancy', group: 'Riders',
    min: 0, max: 4, step: 0.01, default: 0.2 },
  { kind: 'slider', key: 'gravity', label: 'Gravity', group: 'Riders',
    min: 0, max: 4, step: 0.01, default: 1 },
  // Signed: +1 pools riders in the vortex cores (pressure minima),
  // -1 flings them out onto the strain filaments between the cores.
  { kind: 'slider', key: 'vortexPull', label: 'Vortex Pull', group: 'Riders',
    min: -1, max: 1, step: 0.01, default: 0 },
  // Surface-seeking spring toward the liquid's iso shell: the orbs
  // collect ON the surface and bob with it, which is what finally makes
  // them read as riding the content instead of floating near it.
  { kind: 'slider', key: 'surfaceStick', label: 'Ride Surface', group: 'Riders',
    min: 0, max: 4, step: 0.01, default: 1.6 },
  // How far the population spreads THROUGH the body instead of collecting
  // on the one iso shell. 0 is the old everyone-on-the-surface behaviour,
  // which reads as a shell of orbs pasted in front of the liquid because
  // the far half of that shell is hidden behind an opaque surface. Higher
  // values give each rider its own target depth, so some hover proud of
  // the skin, some straddle it and some sink far enough to show only as a
  // tinted glow through the paint.
  { kind: 'slider', key: 'surfaceBias', label: 'Surface Bias', group: 'Riders',
    min: 0, max: 1, step: 0.01, default: 0.62 },
  { kind: 'slider', key: 'riderDamping', label: 'Damping', group: 'Riders',
    min: 0, max: 4, step: 0.01, default: 0.45 },
  { kind: 'slider', key: 'riderLife', label: 'Recycle Time', group: 'Riders',
    min: 1, max: 60, step: 0.5, default: 6 },

  // ── Material ─────────────────────────────────────────────────
  { kind: 'slider', key: 'roughness', label: 'Roughness', group: 'Material',
    min: 0.03, max: 1, step: 0.01, default: 0.17 },
  { kind: 'slider', key: 'metalness', label: 'Metalness', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0.08 },
  { kind: 'slider', key: 'clearCoat', label: 'Clear Coat', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0.75 },
  { kind: 'slider', key: 'coatRoughness', label: 'Coat Roughness', group: 'Material',
    min: 0.01, max: 1, step: 0.01, default: 0.08 },
  { kind: 'slider', key: 'riderOpacity', label: 'Orb Opacity', group: 'Material',
    min: 0.15, max: 1, step: 0.01, default: 1 },
  { kind: 'slider', key: 'reflectStrength', label: 'Reflections', group: 'Material',
    min: 0, max: 3, step: 0.01, default: 1 },
  // Blends the liquid surface from opaque paint toward a transmissive
  // glass: facing regions let the backdrop through, tinted by the body.
  { kind: 'slider', key: 'liquidGlass', label: 'Glass', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0 },
  // How far you can see INTO the paint. Radiance from a submerged orb
  // climbs back out through a Beer-Lambert path whose length is the orb's
  // own depth under the surface, so shallow orbs read clearly, deeper
  // ones go tinted and dim, and the backdrop behind the whole pour stays
  // hidden exactly as before. 0 restores the fully opaque liquid.
  { kind: 'slider', key: 'submergeClarity', label: 'Submerge Clarity', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0.85 },
  // Micro normal perturbation: 0 = poured glass, 1 = rough cast concrete.
  { kind: 'slider', key: 'surfaceDetail', label: 'Surface Texture', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0.12 },
  { kind: 'slider', key: 'detailScale', label: 'Texture Scale', group: 'Material',
    min: 1, max: 24, step: 0.5, default: 8 },
  { kind: 'slider', key: 'contactAO', label: 'Fluid AO', group: 'Material',
    min: 0, max: 4, step: 0.01, default: 1.1 },

  // ── Lighting ─────────────────────────────────────────────────
  { kind: 'slider', key: 'anisotropy', label: 'Anisotropy', group: 'Lighting',
    min: -0.9, max: 0.9, step: 0.01, default: 0.4 },
  { kind: 'slider', key: 'multiScatter', label: 'Multi Scatter', group: 'Lighting',
    min: 0, max: 2, step: 0.01, default: 0.35 },
  { kind: 'slider', key: 'keyStrength', label: 'Key Light', group: 'Lighting',
    min: 0, max: 8, step: 0.01, default: 3.1 },
  { kind: 'color', key: 'keyColor', label: 'Key Color', group: 'Lighting',
    default: [255, 238, 214] },
  { kind: 'slider', key: 'fillStrength', label: 'Fill Light', group: 'Lighting',
    min: 0, max: 4, step: 0.01, default: 0.85 },
  { kind: 'color', key: 'fillColor', label: 'Fill Color', group: 'Lighting',
    default: [158, 184, 232] },
  { kind: 'slider', key: 'rimStrength', label: 'Rim Light', group: 'Lighting',
    min: 0, max: 6, step: 0.01, default: 1.15 },
  { kind: 'color', key: 'rimColor', label: 'Rim Color', group: 'Lighting',
    default: [255, 206, 168] },
  { kind: 'slider', key: 'ambient', label: 'Ambient', group: 'Lighting',
    min: 0, max: 2, step: 0.01, default: 0.14 },

  // ── Palette / background ─────────────────────────────────────
  { kind: 'color', key: 'colorA', label: 'Color A', group: 'Palette',
    default: [255, 104, 10] },
  { kind: 'color', key: 'colorB', label: 'Color B', group: 'Palette',
    default: [232, 44, 6] },
  { kind: 'color', key: 'colorC', label: 'Color C', group: 'Palette',
    default: [255, 148, 38] },
  { kind: 'color', key: 'colorD', label: 'Color D', group: 'Palette',
    default: [168, 28, 4] },
  { kind: 'color', key: 'smokeColor', label: 'Smoke Tint', group: 'Palette',
    default: [255, 120, 30] },
  { kind: 'select', key: 'backgroundMode', label: 'Background', group: 'Palette',
    options: [
      { value: 'transparent', label: 'Transparent' },
      { value: 'flat', label: 'Flat' },
      { value: 'studio', label: 'Studio Gradient' },
    ],
    default: 'studio' },
  { kind: 'color', key: 'backgroundColor', label: 'Backdrop', group: 'Palette',
    default: [16, 15, 18] },
  { kind: 'slider', key: 'backgroundOpacity', label: 'Backdrop Opacity', group: 'Palette',
    min: 0, max: 1, step: 0.01, default: 1 },
  { kind: 'slider', key: 'vignette', label: 'Vignette', group: 'Palette',
    min: 0, max: 1, step: 0.01, default: 0.45 },
  { kind: 'select', key: 'tonemap', label: 'Tonemap', group: 'Palette',
    options: [
      { value: 'agx', label: 'AgX' },
      { value: 'aces', label: 'ACES' },
      { value: 'linear', label: 'Linear' },
    ],
    default: 'agx' },

  // ── Audio ────────────────────────────────────────────────────
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio',
    default: true },
  { kind: 'slider', key: 'bassDrive', label: 'Bass Drive', group: 'Audio',
    min: 0, max: 3, step: 0.05, default: 1.2,
    showWhen: { audioReactive: true } },
  { kind: 'slider', key: 'trebleShimmer', label: 'Treble Shimmer', group: 'Audio',
    min: 0, max: 0.2, step: 0.001, default: 0.025,
    showWhen: { audioReactive: true } },

  // ── Camera ───────────────────────────────────────────────────
  { kind: 'slider', key: 'fovDeg', label: 'FOV', group: 'Camera',
    min: 25, max: 95, step: 1, default: 48 },
  { kind: 'slider', key: 'cameraZ', label: 'Distance', group: 'Camera',
    min: 1.4, max: 7, step: 0.05, default: 2.85 },
  { kind: 'angle', key: 'rotateX', label: 'Rotate X', group: 'Camera', default: 0 },
  { kind: 'angle', key: 'rotateY', label: 'Rotate Y', group: 'Camera', default: 0 },
  { kind: 'angle', key: 'rotateZ', label: 'Rotate Z', group: 'Camera', default: 0 },
  { kind: 'slider', key: 'autoSpin', label: 'Auto Spin', group: 'Camera',
    min: -24, max: 24, step: 0.1, default: 1.4 },
];

export const fluidRidersParamDefaults = deriveDefaults(fluidRidersParamSchema);

/* ============================================================== */
/* PARAM NORMALIZATION                                             */
/* ============================================================== */

type Bands = { bass: number; mid: number; treble: number };

export interface FluidRidersStyleTuning {
  emitters: number;
  spawnY: number;
  splatRadius: number;
  splatVelocity: number;
  densityDecay: number;
  wind: [number, number, number];
  turbScale: number;
  spinX: number;
  spinZ: number;
  sizeScale: number;
  buoyancyScale: number;
  gravityScale: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return clamp(Number.isFinite(parsed) ? parsed : fallback, min, max);
}

function rgb01(c: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(c) || c.length < 3) return [...fallback];
  const r = Number(c[0]);
  const g = Number(c[1]);
  const b = Number(c[2]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return [...fallback];
  const divisor = Math.max(r, g, b) > 1.01 ? 255 : 1;
  return [clamp(r / divisor, 0, 1), clamp(g / divisor, 0, 1), clamp(b / divisor, 0, 1)];
}

export function fluidRidersStyleTuning(style: string): FluidRidersStyleTuning {
  if (style === 'ember') {
    return {
      emitters: 6,
      spawnY: -0.68,
      splatRadius: 0.072,
      splatVelocity: 0.95,
      densityDecay: 0.987,
      wind: [0.04, 0.5, -0.02],
      turbScale: 3.4,
      spinX: -0.25,
      spinZ: 0.2,
      sizeScale: 0.72,
      buoyancyScale: 1.6,
      gravityScale: 0.4,
    };
  }
  if (style === 'pearl') {
    return {
      emitters: 4,
      spawnY: -0.16,
      splatRadius: 0.13,
      splatVelocity: 0.42,
      densityDecay: 0.995,
      wind: [-0.03, 0.08, 0.04],
      turbScale: 1.8,
      spinX: 0.1,
      spinZ: -0.12,
      sizeScale: 1.3,
      buoyancyScale: 0.55,
      gravityScale: 0.25,
    };
  }
  // 'paint' — thick, slow, heavy, wide splats with long stringy filaments.
  return {
    emitters: 5,
    spawnY: -0.52,
    splatRadius: 0.052,
    splatVelocity: 1.05,
    densityDecay: 0.9865,
    wind: [0, 0.18, 0],
    turbScale: 5.2,
    spinX: -0.16,
    spinZ: 0.06,
    sizeScale: 1,
    buoyancyScale: 1,
    gravityScale: 1,
  };
}

export interface FluidRidersResolvedParams {
  quality: string;
  style: string;
  gridSize: 32 | 48 | 64;
  pressureIterations: number;
  pressureWarm: number;
  macCormack: boolean;
  marchSteps: number;
  shadowSteps: number;
  shadowStepLen: number;
  riderCount: number;
  intensity: number;
  // fluid
  emitterCount: number;
  spread: number;
  spawnY: number;
  splatRadius: number;
  splatStrength: number;
  splatVelocityMag: number;
  splatRate: number;
  velocityDecay: number;
  densityDecay: number;
  wind: [number, number, number];
  turbStrength: number;
  turbScale: number;
  vorticity: number;
  surfaceTension: number;
  paintThickness: number;
  density: number;
  emission: number;
  // riders
  riderSize: number;
  riderSizeVariance: number;
  /** τ in seconds for a rider at the reference radius. */
  riderWeight: number;
  /** τ spread in decades: 1 => [0.1×, 10×]. */
  weightSpread: number;
  /** ρ_p/ρ_f. Drives g_eff = g(1 - ρ_f/ρ_p). */
  riderDensity: number;
  /** Precomputed (1 - ρ_f/ρ_p) so the shader does no division. */
  gravityFactor: number;
  flowCoupling: number;
  buoyancy: number;
  gravity: number;
  vortexPull: number;
  /** Surface-seeking spring toward the iso shell. */
  surfaceStick: number;
  surfaceBias: number;
  riderDamping: number;
  riderLife: number;
  containStrength: number;
  // material
  roughness: number;
  metalness: number;
  clearCoat: number;
  coatRoughness: number;
  riderOpacity: number;
  reflectStrength: number;
  liquidGlass: number;
  submergeClarity: number;
  /** Depth-sorted rider hits the render pass keeps per ray (quality-scaled). */
  riderHits: number;
  surfaceDetail: number;
  detailScale: number;
  contactAO: number;
  // lighting
  anisotropy: number;
  multiScatter: number;
  keyStrength: number;
  keyColor: [number, number, number];
  fillStrength: number;
  fillColor: [number, number, number];
  rimStrength: number;
  rimColor: [number, number, number];
  ambient: number;
  // palette
  colorA: [number, number, number];
  colorB: [number, number, number];
  colorC: [number, number, number];
  colorD: [number, number, number];
  smokeColor: [number, number, number];
  backgroundMode: number;
  backgroundColor: [number, number, number];
  backgroundOpacity: number;
  vignette: number;
  exposure: number;
  flowSpeed: number;
  isoLevel: number;
  /** Grazing-angle silhouette fade width. */
  edgeSoftness: number;
  viscosity: number;
  colorFollow: number;
  textureInfluence: number;
  /** 0 = AgX, 1 = ACES, 2 = Linear. */
  tonemap: number;
  // camera
  volumeScaleX: number;
  volumeScaleZ: number;
  fovDeg: number;
  cameraZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  autoRotateX: number;
  autoRotateY: number;
  autoRotateZ: number;
  // audio
  audioReactive: boolean;
  bass: number;
  treble: number;
  audioBurst: number;
}

const BACKGROUND_MODE_ID: Record<string, number> = {
  transparent: 0,
  flat: 1,
  studio: 2,
};

const TONEMAP_ID: Record<string, number> = {
  agx: 0,
  aces: 1,
  linear: 2,
};

/**
 * Resolve the operator-facing param object into the single flat model the
 * native graph consumes. This is the ONE place quality tiers, style
 * presets and audio drive are folded in — the WGSL only ever sees numbers.
 */
export function resolveFluidRidersParams(
  params?: Record<string, any> | null,
  bands?: { bass?: number; treble?: number } | null,
): FluidRidersResolvedParams {
  const p = applyRidersColorPreset(
    { ...fluidRidersParamDefaults, ...(params ?? {}) },
  ) as Record<string, any>;
  const quality = String(p.quality ?? 'balanced');
  const style = String(p.style ?? 'paint');
  const tuning = fluidRidersStyleTuning(style);
  const intensity = num(p.intensity, 1, 0, 2);
  const reactive = p.audioReactive !== false;
  const bassDrive = num(p.bassDrive, 1.2, 0, 3);
  const bass = reactive ? clamp(num(bands?.bass, 0, 0, 4) * bassDrive, 0, 1.8) : 0;
  const treble = reactive ? clamp(num(bands?.treble, 0, 0, 4), 0, 1) : 0;

  const gridSize: 32 | 48 | 64 = quality === 'ultra' ? 64 : quality === 'performance' ? 32 : 48;
  // Warm-starting the pressure field is what makes these counts
  // affordable — the floor is 20, below which the projection visibly
  // fails to close and the plume smears sideways.
  const pressureIterations = quality === 'ultra' ? 24 : 20;
  const qualityCountScale = quality === 'ultra' ? 1.35 : quality === 'performance' ? 0.5 : 1;
  // The animated low-discrepancy march offset buys back roughly the
  // quality a tenth of the steps used to cost, so the base step count
  // dropped from 80 to 72 without a visible change.
  const qualityMarchScale = quality === 'ultra' ? 1.4 : quality === 'performance' ? 0.5 : 1;
  // K nearest orb hits per ray. The gather itself is nearly free (the
  // ray-sphere test already runs for every binned rider); the cost is K
  // PBR evaluations, and the composite early-outs the moment alpha
  // saturates — so this only bites when Orb Opacity is below 1.
  const qualityRiderHits = quality === 'ultra' ? 4 : quality === 'performance' ? 2 : 3;
  // MacCormack doubles the advection cost. Performance keeps the plain
  // semi-Lagrangian chain; the other tiers honour the operator's choice.
  const macCormack = quality === 'performance'
    ? false
    : String(p.advection ?? 'maccormack') !== 'semi-lagrangian';

  const riderCount = clamp(
    Math.round(num(p.riderCount, 220, FLUID_RIDERS_MIN_COUNT, FLUID_RIDERS_MAX_COUNT) * qualityCountScale),
    FLUID_RIDERS_MIN_COUNT,
    FLUID_RIDERS_MAX_COUNT,
  );
  const marchSteps = clamp(
    Math.round(num(p.marchSteps, 96, 16, 160) * qualityMarchScale),
    16,
    192,
  );
  const shadowSteps = Math.round(num(p.shadowSteps, 5, 0, 12) * (quality === 'performance' ? 0.6 : 1));

  const riderDensity = num(p.riderDensity, 1.9, 0.2, 4);
  const smokeTint = rgb01(p.smokeColor, [1.0, 0.470, 0.118]);

  return {
    quality,
    style,
    gridSize,
    pressureIterations,
    pressureWarm: FLUID_RIDERS_PRESSURE_WARM,
    macCormack,
    marchSteps,
    shadowSteps,
    shadowStepLen: 0.075,
    riderCount,
    intensity,

    emitterCount: Math.round(num(p.emitterCount, tuning.emitters, 1, FLUID_RIDERS_MAX_EMITTERS)),
    spread: num(p.smokeSpread, 0.38, 0, 0.9),
    spawnY: tuning.spawnY,
    splatRadius: tuning.splatRadius,
    splatStrength: (0.34 + bass * 0.26) * Math.max(0.1, intensity),
    splatVelocityMag: tuning.splatVelocity + bass * 0.4,
    splatRate: 44 + bass * 20,
    velocityDecay: 0.984,
    densityDecay: tuning.densityDecay,
    wind: tuning.wind,
    turbStrength: num(p.smokeTurbulence, 1.3, 0, 4) + bass * 0.45,
    turbScale: tuning.turbScale,
    vorticity: num(p.vorticity, 6.5, 0, 12) * (1 + bass * 0.35),
    surfaceTension: num(p.surfaceTension, 0.6, 0, 3),
    paintThickness: num(p.paintThickness, 0.5, 0, 2),
    density: num(p.smokeDensity, 3.0, 0, 8),
    emission: num(p.smokeGlow, 1.35, 0, 6) * (0.85 + intensity * 0.35),

    riderSize: num(p.riderSize, 0.042, 0.01, 0.3) * tuning.sizeScale,
    riderSizeVariance: num(p.riderSizeVariance, 0.62, 0, 1),
    riderWeight: num(p.riderWeight, 0.08, 0.01, 1.2),
    weightSpread: num(p.weightSpread, 0.38, 0, 1),
    riderDensity,
    gravityFactor: 1 - 1 / riderDensity,
    flowCoupling: num(p.flowCoupling, 1.35, 0, 3),
    buoyancy: num(p.buoyancy, 0.2, 0, 4) * tuning.buoyancyScale * (1 + bass * 0.4),
    gravity: num(p.gravity, 1, 0, 4) * tuning.gravityScale,
    vortexPull: num(p.vortexPull, 0, -1, 1),
    surfaceStick: num(p.surfaceStick, 1.6, 0, 4),
    surfaceBias: num(p.surfaceBias, 0.62, 0, 1),
    riderDamping: num(p.riderDamping, 0.45, 0, 4),
    riderLife: num(p.riderLife, 6, 1, 60),
    // Velocity gain, not a spring constant: the containment is folded
    // into the velocity the rider relaxes toward, so a heavy rider is
    // eased back into the box instead of being catapulted.
    containStrength: 6,

    roughness: num(p.roughness, 0.17, 0.03, 1),
    metalness: num(p.metalness, 0.08, 0, 1),
    clearCoat: num(p.clearCoat, 0.75, 0, 1),
    coatRoughness: num(p.coatRoughness, 0.08, 0.01, 1),
    riderOpacity: num(p.riderOpacity, 1, 0.15, 1),
    reflectStrength: num(p.reflectStrength, 1, 0, 3),
    liquidGlass: num(p.liquidGlass, 0, 0, 1),
    submergeClarity: num(p.submergeClarity, 0.85, 0, 1),
    riderHits: qualityRiderHits,
    surfaceDetail: num(p.surfaceDetail, 0.12, 0, 1),
    detailScale: num(p.detailScale, 8, 1, 24),
    contactAO: num(p.contactAO, 1.1, 0, 4),

    anisotropy: num(p.anisotropy, 0.4, -0.9, 0.9),
    multiScatter: num(p.multiScatter, 0.35, 0, 2),
    keyStrength: num(p.keyStrength, 3.1, 0, 8) * (0.8 + intensity * 0.25),
    keyColor: rgb01(p.keyColor, [1.0, 0.933, 0.839]),
    fillStrength: num(p.fillStrength, 0.6, 0, 4),
    fillColor: rgb01(p.fillColor, [0.620, 0.722, 0.910]),
    rimStrength: num(p.rimStrength, 1.15, 0, 6) * (1 + treble * num(p.trebleShimmer, 0.025, 0, 0.2) * 12),
    rimColor: rgb01(p.rimColor, [1.0, 0.808, 0.659]),
    ambient: num(p.ambient, 0.14, 0, 2),

    colorA: rgb01(p.colorA, [1.0, 0.408, 0.039]),
    colorB: rgb01(p.colorB, [0.910, 0.173, 0.024]),
    colorC: rgb01(p.colorC, [1.0, 0.580, 0.149]),
    colorD: rgb01(p.colorD, [0.659, 0.110, 0.016]),
    smokeColor: smokeTint,
    backgroundMode: BACKGROUND_MODE_ID[String(p.backgroundMode ?? 'studio')] ?? 2,
    backgroundColor: rgb01(p.backgroundColor, [0.063, 0.059, 0.071]),
    backgroundOpacity: num(p.backgroundOpacity, 1, 0, 1),
    vignette: num(p.vignette, 0.45, 0, 1),
    exposure: num(p.exposure, 1.5, 0.1, 4),
    flowSpeed: num(p.flowSpeed, 0.32, 0.05, 2),
    isoLevel: num(p.isoLevel, 0.42, 0.02, 2.5),
    edgeSoftness: num(p.edgeSoftness, 0.18, 0, 0.5),
    viscosity: num(p.viscosity, 0.72, 0, 1),
    colorFollow: num(p.colorFollow, 3.2, 0, 10),
    textureInfluence: num(p.textureInfluence, 1, 0, 1),
    tonemap: TONEMAP_ID[String(p.tonemap ?? 'agx')] ?? 0,

    volumeScaleX: 1.72,
    volumeScaleZ: 1.25,
    fovDeg: num(p.fovDeg, 48, 25, 95),
    cameraZ: num(p.cameraZ, 2.85, 1.4, 7),
    rotateX: num(p.rotateX, 0, -3600, 3600),
    rotateY: num(p.rotateY, 0, -3600, 3600),
    rotateZ: num(p.rotateZ, 0, -3600, 3600),
    autoRotateX: tuning.spinX,
    autoRotateY: num(p.autoSpin, 4.5, -24, 24),
    autoRotateZ: tuning.spinZ,

    audioReactive: reactive,
    bass,
    treble,
    audioBurst: bassDrive,
  };
}

/* ============================================================== */
/* MATH                                                            */
/* ============================================================== */

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
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}

function translate(x: number, y: number, z: number): Float32Array {
  const m = identityMat4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function rotationMatrices(rx: number, ry: number, rz: number): Float32Array {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const rxM = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
  const ryM = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
  const rzM = new Float32Array([cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return mat4Mul(rzM, mat4Mul(ryM, rxM));
}

/** Rotate a camera-space direction into the volume's object space so the
 *  studio rig stays FIXED while the volume spins. Without this the key
 *  light orbits with the smoke and the whole thing reads as a spinning
 *  prop instead of a lit subject. */
function lightToObjectSpace(model: Float32Array, dir: [number, number, number]): [number, number, number] {
  // Rotation-only model: inverse == transpose.
  const x = model[0] * dir[0] + model[1] * dir[1] + model[2] * dir[2];
  const y = model[4] * dir[0] + model[5] * dir[1] + model[6] * dir[2];
  const z = model[8] * dir[0] + model[9] * dir[1] + model[10] * dir[2];
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/* ============================================================== */
/* NATIVE GRAPH                                                    */
/* ============================================================== */

type FluidRidersBufferKind = 'uniform' | 'storage';
type FluidRidersBindingKind = 'uniform' | 'storage' | 'read-only-storage';

export interface FluidRidersNativeGraphBuffer {
  id: string;
  kind: FluidRidersBufferKind;
  byte_length: number;
  persistent?: boolean;
  clear?: boolean;
  initial_b64?: string;
}

export interface FluidRidersNativeGraphBinding {
  binding: number;
  resource: string;
  kind: FluidRidersBindingKind;
}

export interface FluidRidersNativeGraphPass {
  name: string;
  shader_id: string;
  entry: string;
  dispatch: [number, number, number];
  bindings: FluidRidersNativeGraphBinding[];
}

export interface FluidRidersNativeGraphRenderPass {
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
  primitive?: 'triangle-list';
  vertex_count: number;
  instance_count: number;
  bindings: FluidRidersNativeGraphBinding[];
}

export interface FluidRidersNativeGraphState {
  grid: number;
  riderCount: number;
  tileCountX: number;
  tileCountY: number;
  velFlip: boolean;
  denFlip: boolean;
  prsFlip: boolean;
  prevBass: number;
  burstHoldTimer: number;
  autoRotXPhase: number;
  autoRotYPhase: number;
  autoRotZPhase: number;
  prevFrameTime: number;
}

export interface FluidRidersNativeGraphOptions {
  sourceId: string;
  params?: Record<string, any> | null;
  width?: number;
  height?: number;
  time?: number;
  frameDelta?: number;
  frameIndex?: number;
  audioBass?: number;
  audioTreble?: number;
  state?: FluidRidersNativeGraphState | null;
  reset?: boolean;
  includeSnapshot?: boolean;
}

export interface FluidRidersNativeGraphBuildResult {
  config: {
    buffers: FluidRidersNativeGraphBuffer[];
    passes: FluidRidersNativeGraphPass[];
    render_passes: FluidRidersNativeGraphRenderPass[];
    readbacks: string[];
  };
  sourceId: string;
  state: FluidRidersNativeGraphState;
  riderCount: number;
  passCount: number;
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

function writeF32(view: DataView, index: number, value: number): void {
  view.setFloat32(index * 4, Number.isFinite(value) ? value : 0, true);
}

function writeU32(view: DataView, index: number, value: number): void {
  view.setUint32(index * 4, Math.max(0, Math.round(value)) >>> 0, true);
}

/** Deterministic seed hash — mirrored bit-for-shape in the Rust core so
 *  both graph builders spawn the same population. */
export function fluidRidersHash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function buildFluidRidersInitialRiderBuffer(
  params: FluidRidersResolvedParams,
  count: number,
): ArrayBuffer {
  const riderCount = clamp(Math.round(count), FLUID_RIDERS_MIN_COUNT, FLUID_RIDERS_MAX_COUNT);
  const floats = new Float32Array(riderCount * FLUID_RIDERS_STRIDE_FLOATS);
  const bx = params.volumeScaleX;
  const bz = params.volumeScaleZ;
  const spawnY = params.spawnY;
  const radiusVar = params.riderSizeVariance;
  for (let i = 0; i < riderCount; i++) {
    const seed = i * 0.6180339887 + 0.137;
    const s1 = fluidRidersHash(seed * 3.17 + 1.7);
    const s2 = fluidRidersHash(seed * 7.31 + 4.1);
    const s3 = fluidRidersHash(seed * 11.93 + 8.3);
    const s4 = fluidRidersHash(seed * 23.1 + 3.3);
    const s5 = fluidRidersHash(seed * 13.3 + 0.9);
    const a = s1 * Math.PI * 2;
    const z = s2 * 2 - 1;
    const planar = Math.sqrt(Math.max(0, 1 - z * z));
    const r = Math.pow(s3, 0.4);
    const off = i * FLUID_RIDERS_STRIDE_FLOATS;
    floats[off + 0] = Math.cos(a) * planar * r * bx * 0.34;
    floats[off + 1] = spawnY + z * r * 0.3;
    floats[off + 2] = Math.sin(a) * planar * r * bz * 0.34;
    floats[off + 3] = 0.45 + Math.pow(s4, 1.7) * (0.35 + radiusVar * 1.9);
    floats[off + 4] = 0;
    floats[off + 5] = 0;
    floats[off + 6] = 0;
    // τ is derived from radius + seed by cs_riders on every step, so the
    // seeded value is only a placeholder. Leaving it zero keeps this
    // buffer byte-identical to the Rust builder's with no shared formula
    // to drift.
    floats[off + 7] = 0;
    floats[off + 8] = seed;
    floats[off + 9] = s5;
    floats[off + 10] = params.riderLife * (0.2 + s2 * 1.1);
    // Seeded riders start fully faded IN so the very first frame already
    // shows the population; only recycled riders ramp.
    floats[off + 11] = 1;
  }
  return floats.buffer;
}

function buildSimUniform(
  params: FluidRidersResolvedParams,
  dt: number,
  time: number,
  // Fraction of one full splat this frame carries (see CONTINUOUS
  // EMISSION above), already multiplied by the audio burst gain. The
  // splat WGSL multiplies emitter strength by this slot, so a value of
  // 0.234 deposits 23.4% of a splat — which is what a 5.3 ms step at 44
  // splats/s is worth.
  emitMul: number,
): string {
  const buffer = new ArrayBuffer(96);
  const view = new DataView(buffer);
  writeU32(view, 0, params.gridSize);
  writeU32(view, 1, params.gridSize);
  writeU32(view, 2, params.gridSize);
  writeU32(view, 3, params.emitterCount);
  writeF32(view, 4, dt);
  writeF32(view, 5, time);
  writeF32(view, 6, emitMul);
  writeF32(view, 8, params.densityDecay);
  writeF32(view, 9, params.velocityDecay);
  writeF32(view, 10, params.splatRadius);
  writeF32(view, 12, params.wind[0]);
  writeF32(view, 13, params.wind[1]);
  writeF32(view, 14, params.wind[2]);
  writeF32(view, 15, params.turbStrength);
  writeF32(view, 16, params.turbScale);
  return bufferToBase64(buffer);
}

// `velScale` is the same per-frame emission fraction the density term
// gets. The shared splat WGSL adds emitter velocity WITHOUT the strength
// multiplier, so rate-normalising the injected momentum has to happen
// here: without it, running the pass every frame instead of every fifth
// would quintuple the jet and the plume would change shape, not just
// stop flickering.
function buildEmittersBuffer(params: FluidRidersResolvedParams, velScale: number): string {
  const buffer = new ArrayBuffer(FLUID_RIDERS_MAX_EMITTERS * 48);
  const values = new Float32Array(buffer);
  const emCount = clamp(params.emitterCount | 0, 1, FLUID_RIDERS_MAX_EMITTERS);
  const palette = [params.colorA, params.colorB, params.colorC, params.colorD];
  for (let i = 0; i < emCount; i++) {
    const off = i * 12;
    const angle = emCount > 1 ? (i / emCount) * Math.PI * 2 : 0;
    const cx = Math.cos(angle) * params.spread;
    const cz = Math.sin(angle) * params.spread;
    const color = palette[i % palette.length];
    values[off + 0] = cx * 0.5 + 0.5;
    values[off + 1] = params.spawnY * 0.5 + 0.5;
    values[off + 2] = cz * 0.5 + 0.5;
    values[off + 3] = params.splatRadius;
    values[off + 4] = color[0];
    values[off + 5] = color[1];
    values[off + 6] = color[2];
    values[off + 7] = params.splatStrength;
    const vm = params.splatVelocityMag * velScale;
    values[off + 8] = Math.cos(angle) * vm * 0.18;
    values[off + 9] = vm;
    values[off + 10] = Math.sin(angle) * vm * 0.18;
  }
  return bufferToBase64(buffer);
}

function buildVorticityUniform(params: FluidRidersResolvedParams, dt: number): string {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  writeU32(view, 0, params.gridSize);
  writeU32(view, 1, params.gridSize);
  writeU32(view, 2, params.gridSize);
  writeF32(view, 4, dt);
  writeF32(view, 5, params.vorticity);
  writeF32(view, 6, 1 / Math.max(1, params.gridSize));
  writeF32(view, 7, params.pressureWarm);
  return bufferToBase64(buffer);
}

function buildSurfaceUniform(params: FluidRidersResolvedParams, dt: number): string {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  writeU32(view, 0, params.gridSize);
  writeU32(view, 1, params.gridSize);
  writeU32(view, 2, params.gridSize);
  writeF32(view, 4, dt);
  writeF32(view, 5, params.surfaceTension);
  writeF32(view, 6, params.paintThickness);
  // CFL cap: no cell may be pushed more than a quarter of a cell width
  // (velocity is in uv/s, so a cell is 1/grid) by surface tension alone.
  writeF32(view, 7, 0.25 / Math.max(1, params.gridSize));
  return bufferToBase64(buffer);
}

function buildRiderUniform(
  params: FluidRidersResolvedParams,
  dt: number,
  time: number,
  riderCount: number,
): string {
  const buffer = new ArrayBuffer(144);
  const view = new DataView(buffer);
  writeU32(view, 0, params.gridSize);
  writeU32(view, 1, params.gridSize);
  writeU32(view, 2, params.gridSize);
  writeU32(view, 3, riderCount);
  writeF32(view, 4, dt);
  writeF32(view, 5, time);
  writeF32(view, 6, params.flowCoupling);
  writeF32(view, 7, params.riderWeight);
  writeF32(view, 8, params.buoyancy);
  writeF32(view, 9, params.gravity);
  writeF32(view, 10, params.vortexPull);
  writeF32(view, 11, params.riderDamping);
  writeF32(view, 12, params.weightSpread);
  writeF32(view, 13, params.gravityFactor);
  writeF32(view, 14, 0.45);
  writeF32(view, 15, 0.35 + params.riderSizeVariance * 1.9);
  writeF32(view, 16, params.volumeScaleX);
  writeF32(view, 17, 1);
  writeF32(view, 18, params.volumeScaleZ);
  writeF32(view, 19, params.containStrength);
  writeF32(view, 20, 0);
  writeF32(view, 21, params.spawnY);
  writeF32(view, 22, 0);
  writeF32(view, 23, Math.max(0.15, params.spread * params.volumeScaleX + 0.2));
  writeF32(view, 24, params.riderLife);
  // Pressure-gradient gain: the solver's p lives on grid indices, so the
  // per-index difference becomes a world-space gradient by dividing by
  // the world cell size (extent/grid) — folded here as grid/extentY,
  // with extentY = 2 (the volume is 1 unit tall each way).
  writeF32(view, 25, params.gridSize * 0.5);
  writeF32(view, 26, params.bass);
  writeF32(view, 27, params.treble);
  writeF32(view, 28, params.riderSize);
  writeF32(view, 29, FLUID_RIDERS_TAU_REF_RADIUS);
  writeF32(view, 30, params.surfaceStick);
  writeF32(view, 31, params.isoLevel);
  writeF32(view, 32, params.surfaceBias);
  return bufferToBase64(buffer);
}

function buildBinUniform(
  params: FluidRidersResolvedParams,
  viewProj: Float32Array,
  tileCountX: number,
  tileCountY: number,
  riderCount: number,
  aspect: number,
): string {
  const buffer = new ArrayBuffer(96);
  const view = new DataView(buffer);
  const floats = new Float32Array(buffer);
  floats.set(viewProj, 0);
  writeU32(view, 16, tileCountX);
  writeU32(view, 17, tileCountY);
  writeU32(view, 18, FLUID_RIDERS_TILE_CAP);
  writeU32(view, 19, riderCount);
  writeF32(view, 20, 1 / Math.tan((params.fovDeg * Math.PI / 180) / 2));
  writeF32(view, 21, aspect);
  writeF32(view, 22, params.riderSize);
  return bufferToBase64(buffer);
}

function buildRenderUniform(
  params: FluidRidersResolvedParams,
  state: FluidRidersNativeGraphState,
  invViewProj: Float32Array,
  model: Float32Array,
  tileCountX: number,
  tileCountY: number,
  riderCount: number,
  frameIndex: number,
  time: number,
): string {
  const buffer = new ArrayBuffer(384);
  const view = new DataView(buffer);
  const floats = new Float32Array(buffer);
  floats.set(invViewProj, 0);
  // Studio rig, specified in CAMERA space and rotated into the volume's
  // object space so the lights stay put while the volume spins.
  const key = lightToObjectSpace(model, [-0.42, 0.68, 0.62]);
  const fill = lightToObjectSpace(model, [0.66, 0.12, 0.74]);
  const rim = lightToObjectSpace(model, [0.18, 0.28, -0.94]);
  writeF32(view, 16, params.smokeColor[0]);
  writeF32(view, 17, params.smokeColor[1]);
  writeF32(view, 18, params.smokeColor[2]);
  writeF32(view, 19, params.exposure);
  writeF32(view, 20, params.volumeScaleX);
  writeF32(view, 21, 1);
  writeF32(view, 22, params.volumeScaleZ);
  writeF32(view, 23, params.density);
  writeF32(view, 24, params.backgroundColor[0]);
  writeF32(view, 25, params.backgroundColor[1]);
  writeF32(view, 26, params.backgroundColor[2]);
  writeF32(view, 27, params.backgroundOpacity);
  writeU32(view, 28, params.gridSize);
  writeU32(view, 29, params.gridSize);
  writeU32(view, 30, params.gridSize);
  writeU32(view, 31, riderCount);
  writeF32(view, 32, key[0]);
  writeF32(view, 33, key[1]);
  writeF32(view, 34, key[2]);
  writeF32(view, 35, params.keyStrength);
  writeF32(view, 36, params.keyColor[0]);
  writeF32(view, 37, params.keyColor[1]);
  writeF32(view, 38, params.keyColor[2]);
  writeF32(view, 39, params.anisotropy);
  writeF32(view, 40, fill[0]);
  writeF32(view, 41, fill[1]);
  writeF32(view, 42, fill[2]);
  writeF32(view, 43, params.fillStrength);
  writeF32(view, 44, params.fillColor[0]);
  writeF32(view, 45, params.fillColor[1]);
  writeF32(view, 46, params.fillColor[2]);
  writeF32(view, 47, params.roughness);
  writeF32(view, 48, rim[0]);
  writeF32(view, 49, rim[1]);
  writeF32(view, 50, rim[2]);
  writeF32(view, 51, params.rimStrength);
  writeF32(view, 52, params.rimColor[0]);
  writeF32(view, 53, params.rimColor[1]);
  writeF32(view, 54, params.rimColor[2]);
  writeF32(view, 55, params.metalness);
  writeF32(view, 56, params.colorA[0]);
  writeF32(view, 57, params.colorA[1]);
  writeF32(view, 58, params.colorA[2]);
  writeF32(view, 59, params.emission);
  writeF32(view, 60, params.colorB[0]);
  writeF32(view, 61, params.colorB[1]);
  writeF32(view, 62, params.colorB[2]);
  writeF32(view, 63, params.multiScatter);
  writeF32(view, 64, params.colorC[0]);
  writeF32(view, 65, params.colorC[1]);
  writeF32(view, 66, params.colorC[2]);
  writeF32(view, 67, params.shadowStepLen);
  writeF32(view, 68, params.colorD[0]);
  writeF32(view, 69, params.colorD[1]);
  writeF32(view, 70, params.colorD[2]);
  writeF32(view, 71, params.contactAO);
  writeU32(view, 72, params.shadowSteps);
  writeU32(view, 73, params.marchSteps);
  writeU32(view, 74, tileCountX);
  writeU32(view, 75, tileCountY);
  writeF32(view, 76, params.riderSize);
  writeF32(view, 77, params.ambient);
  writeF32(view, 78, params.vignette);
  writeF32(view, 79, params.backgroundMode);
  // Wrapped: the march offset only needs the frame's phase, and a u32
  // that has been counting for hours loses fp32 precision inside the
  // shader's f32(frameIndex).
  writeU32(view, 80, frameIndex % 4096);
  writeF32(view, 81, params.tonemap);
  writeF32(view, 82, params.clearCoat);
  writeF32(view, 83, params.coatRoughness);
  writeF32(view, 84, params.isoLevel);
  writeF32(view, 85, params.paintThickness);
  writeF32(view, 86, params.colorFollow);
  writeF32(view, 87, params.edgeSoftness);
  writeF32(view, 88, params.riderOpacity);
  writeF32(view, 89, params.reflectStrength);
  writeF32(view, 90, params.liquidGlass);
  writeF32(view, 91, params.surfaceDetail);
  writeF32(view, 92, params.detailScale);
  writeF32(view, 93, time);
  writeF32(view, 94, params.submergeClarity);
  writeU32(view, 95, params.riderHits);
  // `state` participates only through the rotation baked into invViewProj.
  void state;
  return bufferToBase64(buffer);
}

function sanitizeGraphId(value: string): string {
  return String(value || 'source').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 160);
}

function initialState(grid: number, riderCount: number, tileCountX: number, tileCountY: number, time: number): FluidRidersNativeGraphState {
  return {
    grid,
    riderCount,
    tileCountX,
    tileCountY,
    velFlip: false,
    denFlip: false,
    prsFlip: false,
    prevBass: 0,
    burstHoldTimer: 0,
    autoRotXPhase: 0,
    autoRotYPhase: 0,
    autoRotZPhase: 0,
    prevFrameTime: time,
  };
}

export function buildFluidRidersNativeComputeGraph(
  options: FluidRidersNativeGraphOptions,
): FluidRidersNativeGraphBuildResult {
  const sourceId = String(options.sourceId || 'fluid-riders-native-source');
  const width = Math.max(1, Math.round(options.width || 1920));
  const height = Math.max(1, Math.round(options.height || 1080));
  const time = Math.max(0, Number.isFinite(options.time) ? Number(options.time) : 0);
  const frameIndex = Math.max(0, Math.round(options.frameIndex ?? 0));
  const params = resolveFluidRidersParams(options.params ?? {}, {
    bass: options.audioBass ?? 0,
    treble: options.audioTreble ?? 0,
  });

  const riderCount = params.riderCount;
  const tileCountX = Math.max(1, Math.ceil(width / FLUID_RIDERS_TILE_SIZE));
  const tileCountY = Math.max(1, Math.ceil(height / FLUID_RIDERS_TILE_SIZE));
  const tileCount = tileCountX * tileCountY;

  const prev = options.state ?? null;
  const mustReset = !!options.reset
    || !prev
    || prev.grid !== params.gridSize
    || prev.riderCount !== riderCount
    || prev.tileCountX !== tileCountX
    || prev.tileCountY !== tileCountY;
  let state = mustReset
    ? initialState(params.gridSize, riderCount, tileCountX, tileCountY, time)
    : { ...prev! };

  let dt = typeof options.frameDelta === 'number' && Number.isFinite(options.frameDelta)
    ? options.frameDelta
    : (state.prevFrameTime === 0 ? 1 / 60 : time - state.prevFrameTime);
  dt = clamp(dt, 0, 1 / 15) * params.flowSpeed;
  state.prevFrameTime = time;
  state.autoRotXPhase += params.autoRotateX * dt;
  state.autoRotYPhase += params.autoRotateY * dt;
  state.autoRotZPhase += params.autoRotateZ * dt;

  const bassDelta = Math.max(0, params.bass - state.prevBass);
  if (bassDelta > 0.05) state.burstHoldTimer = Math.max(state.burstHoldTimer, 0.15);
  state.burstHoldTimer = Math.max(0, state.burstHoldTimer - dt);
  state.prevBass = params.bass;
  const burstActive = state.burstHoldTimer > 0;
  // ── CONTINUOUS EMISSION ──────────────────────────────────────────
  // The emitter used to bank dt in an accumulator and dump ONE WHOLE
  // splat the frame it crossed 1/splatRate. At 60 fps with the default
  // flowSpeed (0.32) a frame advances the sim 5.3 ms and the period is
  // 22.7 ms, so the field got a lump every FIFTH frame and nothing on
  // the other four: measured mean luma ran 0.1179, 0.1174, 0.1169,
  // 0.1162, then jumped +0.0044 — a 12 Hz sawtooth in the glow, which
  // is exactly the jagged flicker. Worse, the accumulator RESET to zero
  // rather than subtracting the period, so it threw the remainder away
  // and realised 37.5 splats/s when 44 were asked for, and the realised
  // rate moved with the framerate.
  //
  // Deposit the same mass CONTINUOUSLY instead: every frame carries
  // exactly `dt * splatRate` of one splat, so the mass per simulated
  // second is splatRate * splatStrength no matter how the frames fall.
  // Nothing in the solve changes — the fluid is not smoothed, only the
  // source term stops being a pulse train. The cap only exists so a
  // pathological hitch (dt is already clamped to 1/15 s) cannot detonate
  // the field in one frame; at the default rate it sits 17x above the
  // per-frame quota and 1.9x above the worst legitimate case
  // (flowSpeed 2, bass 1, 60 fps), so it never engages in normal use.
  //
  // A burst is now a sustained 2.5x on the rate for its hold window
  // rather than a run of full-strength lumps, which keeps the accent
  // audible without reintroducing the staircase.
  const emitQuota = clamp(dt * params.splatRate, 0, SPLAT_QUOTA_CAP);
  // Buffers were just (re)created and are zero: prime with a full splat
  // so the first frame is not empty. Deterministic — reset happens on
  // frame 0 / grid change only, identically for live and offline.
  const emitScale = mustReset ? Math.max(emitQuota, 1) : emitQuota;
  const fire = emitScale > 0;
  const burstMul = burstActive ? 2.5 + params.audioBurst : 1;

  // Camera / projection.
  const aspect = Math.max(0.05, width / height);
  const d2r = Math.PI / 180;
  const proj = perspective(params.fovDeg, aspect, 0.01, 100);
  const view = translate(0, 0, -params.cameraZ);
  const model = rotationMatrices(
    (params.rotateX + state.autoRotXPhase) * d2r,
    (params.rotateY + state.autoRotYPhase) * d2r,
    (params.rotateZ + state.autoRotZPhase) * d2r,
  );
  const viewProj = mat4Mul(proj, mat4Mul(view, model));
  const invViewProj = invertMat4(viewProj);

  const prefix = `fluid-riders:${sanitizeGraphId(sourceId)}`;
  const gid = (name: string) => `${prefix}:g${params.gridSize}:${name}`;
  const rid = (name: string) => `${prefix}:r${riderCount}:${name}`;
  const tid = (name: string) => `${prefix}:t${tileCountX}x${tileCountY}:${name}`;
  const uid = (name: string) => `${prefix}:${name}`;

  const cellCount = params.gridSize * params.gridSize * params.gridSize;
  const vec4Bytes = cellCount * 16;
  const f32Bytes = cellCount * 4;

  const buffers: FluidRidersNativeGraphBuffer[] = [
    { id: uid('sim-uniform'), kind: 'uniform', byte_length: 96, initial_b64: buildSimUniform(params, dt, time, emitScale * burstMul) },
    { id: uid('vort-uniform'), kind: 'uniform', byte_length: 32, initial_b64: buildVorticityUniform(params, dt) },
    { id: uid('surface-uniform'), kind: 'uniform', byte_length: 32, initial_b64: buildSurfaceUniform(params, dt) },
    { id: uid('rider-uniform'), kind: 'uniform', byte_length: 144, initial_b64: buildRiderUniform(params, dt, time, riderCount) },
    { id: uid('bin-uniform'), kind: 'uniform', byte_length: 96, initial_b64: buildBinUniform(params, viewProj, tileCountX, tileCountY, riderCount, aspect) },
    { id: uid('render-uniform'), kind: 'uniform', byte_length: 384, initial_b64: buildRenderUniform(params, state, invViewProj, model, tileCountX, tileCountY, riderCount, frameIndex, time) },
    { id: uid('emitters'), kind: 'storage', byte_length: FLUID_RIDERS_MAX_EMITTERS * 48, initial_b64: buildEmittersBuffer(params, emitScale) },
    { id: gid('velocity-a'), kind: 'storage', byte_length: vec4Bytes, persistent: true, clear: mustReset },
    { id: gid('velocity-b'), kind: 'storage', byte_length: vec4Bytes, persistent: true, clear: mustReset },
    { id: gid('density-a'), kind: 'storage', byte_length: vec4Bytes, persistent: true, clear: mustReset },
    { id: gid('density-b'), kind: 'storage', byte_length: vec4Bytes, persistent: true, clear: mustReset },
    { id: gid('divergence'), kind: 'storage', byte_length: f32Bytes, persistent: true, clear: mustReset },
    { id: gid('pressure-a'), kind: 'storage', byte_length: f32Bytes, persistent: true, clear: mustReset },
    { id: gid('pressure-b'), kind: 'storage', byte_length: f32Bytes, persistent: true, clear: mustReset },
    // One scratch field shared by both MacCormack advections: velocity
    // is corrected at the top of the frame and density at the bottom, so
    // the forward result never has to survive across the two.
    { id: gid('advect-tmp'), kind: 'storage', byte_length: vec4Bytes, persistent: true, clear: mustReset },
    {
      id: rid('riders'),
      kind: 'storage',
      byte_length: riderCount * FLUID_RIDERS_STRIDE_FLOATS * 4,
      persistent: true,
      clear: mustReset,
      ...(mustReset
        ? { initial_b64: bufferToBase64(buildFluidRidersInitialRiderBuffer(params, riderCount)) }
        : {}),
    },
    { id: tid('tile-counts'), kind: 'storage', byte_length: tileCount * 4, persistent: true, clear: mustReset },
    { id: tid('tile-indices'), kind: 'storage', byte_length: tileCount * FLUID_RIDERS_TILE_CAP * 4, persistent: true, clear: mustReset },
  ];

  const wg = Math.ceil(params.gridSize / 4);
  const gridDispatch: [number, number, number] = [wg, wg, wg];
  const passes: FluidRidersNativeGraphPass[] = [];
  const addPass = (
    name: string,
    shaderId: string,
    entry: string,
    dispatch: [number, number, number],
    bindings: FluidRidersNativeGraphBinding[],
  ) => {
    passes.push({ name, shader_id: shaderId, entry, dispatch, bindings });
  };

  let velFlip = state.velFlip;
  let denFlip = state.denFlip;
  let prsFlip = state.prsFlip;
  const velCur = () => gid(velFlip ? 'velocity-b' : 'velocity-a');
  const velNext = () => gid(velFlip ? 'velocity-a' : 'velocity-b');
  const denCur = () => gid(denFlip ? 'density-b' : 'density-a');
  const denNext = () => gid(denFlip ? 'density-a' : 'density-b');
  const prsCur = () => gid(prsFlip ? 'pressure-b' : 'pressure-a');
  const prsNext = () => gid(prsFlip ? 'pressure-a' : 'pressure-b');

  if (fire) {
    addPass('fluid-riders-splat', SMOKE_3D_NATIVE_SHADER_IDS.splat, 'cs_splat', gridDispatch, [
      { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
      { binding: 1, resource: velCur(), kind: 'storage' },
      { binding: 2, resource: denCur(), kind: 'storage' },
      { binding: 3, resource: uid('emitters'), kind: 'read-only-storage' },
    ]);
  }
  if (params.macCormack) {
    addPass('fluid-riders-advect-velocity-fwd', FLUID_RIDERS_NATIVE_SHADER_IDS.advect, 'cs_advect_fwd', gridDispatch, [
      { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
      { binding: 1, resource: velCur(), kind: 'read-only-storage' },
      { binding: 2, resource: velCur(), kind: 'read-only-storage' },
      { binding: 3, resource: gid('advect-tmp'), kind: 'storage' },
      { binding: 4, resource: velNext(), kind: 'storage' },
    ]);
    addPass('fluid-riders-advect-velocity', FLUID_RIDERS_NATIVE_SHADER_IDS.advect, 'cs_advect_mc_vel', gridDispatch, [
      { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
      { binding: 1, resource: velCur(), kind: 'read-only-storage' },
      { binding: 2, resource: velCur(), kind: 'read-only-storage' },
      { binding: 3, resource: gid('advect-tmp'), kind: 'storage' },
      { binding: 4, resource: velNext(), kind: 'storage' },
    ]);
  } else {
    addPass('fluid-riders-advect-velocity', SMOKE_3D_NATIVE_SHADER_IDS.advectVelocity, 'cs_advect_vel', gridDispatch, [
      { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
      { binding: 1, resource: velCur(), kind: 'read-only-storage' },
      { binding: 2, resource: denCur(), kind: 'storage' },
      { binding: 3, resource: velNext(), kind: 'storage' },
    ]);
  }
  velFlip = !velFlip;

  // Vorticity confinement — after advection, before the projection solve
  // so the added swirl is made divergence-free along with everything else.
  addPass('fluid-riders-vorticity', FLUID_RIDERS_NATIVE_SHADER_IDS.vorticity, 'cs_vorticity', gridDispatch, [
    { binding: 0, resource: uid('vort-uniform'), kind: 'uniform' },
    { binding: 1, resource: velCur(), kind: 'read-only-storage' },
    { binding: 2, resource: velNext(), kind: 'storage' },
  ]);
  velFlip = !velFlip;

  // Surface tension + shear-thinning viscosity, also upstream of the
  // projection so the interface force comes out divergence-free.
  addPass('fluid-riders-surface-tension', FLUID_RIDERS_NATIVE_SHADER_IDS.surface, 'cs_surface_tension', gridDispatch, [
    { binding: 0, resource: uid('surface-uniform'), kind: 'uniform' },
    { binding: 1, resource: denCur(), kind: 'read-only-storage' },
    { binding: 2, resource: velCur(), kind: 'read-only-storage' },
    { binding: 3, resource: velNext(), kind: 'storage' },
  ]);
  velFlip = !velFlip;

  addPass('fluid-riders-divergence', SMOKE_3D_NATIVE_SHADER_IDS.divergence, 'cs_divergence', gridDispatch, [
    { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
    { binding: 1, resource: velCur(), kind: 'read-only-storage' },
    { binding: 2, resource: denCur(), kind: 'storage' },
    { binding: 3, resource: gid('divergence'), kind: 'storage' },
  ]);
  // Warm start: scale last frame's pressure down instead of restarting
  // from it verbatim (or from zero). One bandwidth-bound pass that is
  // worth roughly triple the Jacobi sweeps it precedes.
  addPass('fluid-riders-pressure-warm', FLUID_RIDERS_NATIVE_SHADER_IDS.pressure, 'cs_pressure_warm',
    [Math.max(1, Math.ceil(cellCount / 64)), 1, 1], [
      { binding: 0, resource: uid('vort-uniform'), kind: 'uniform' },
      { binding: 1, resource: prsCur(), kind: 'storage' },
    ]);
  for (let it = 0; it < params.pressureIterations; it++) {
    addPass(`fluid-riders-jacobi-${it + 1}`, SMOKE_3D_NATIVE_SHADER_IDS.jacobi, 'cs_jacobi', gridDispatch, [
      { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
      { binding: 1, resource: velCur(), kind: 'read-only-storage' },
      { binding: 2, resource: denCur(), kind: 'storage' },
      { binding: 3, resource: gid('divergence'), kind: 'read-only-storage' },
      { binding: 4, resource: prsCur(), kind: 'read-only-storage' },
      { binding: 5, resource: prsNext(), kind: 'storage' },
    ]);
    prsFlip = !prsFlip;
  }
  addPass('fluid-riders-subtract-gradient', SMOKE_3D_NATIVE_SHADER_IDS.subtractGradient, 'cs_subtract_grad', gridDispatch, [
    { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
    { binding: 1, resource: velCur(), kind: 'read-only-storage' },
    { binding: 2, resource: denCur(), kind: 'storage' },
    { binding: 3, resource: prsCur(), kind: 'read-only-storage' },
    { binding: 4, resource: velNext(), kind: 'storage' },
  ]);
  velFlip = !velFlip;
  if (params.macCormack) {
    addPass('fluid-riders-advect-density-fwd', FLUID_RIDERS_NATIVE_SHADER_IDS.advect, 'cs_advect_fwd', gridDispatch, [
      { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
      { binding: 1, resource: velCur(), kind: 'read-only-storage' },
      { binding: 2, resource: denCur(), kind: 'read-only-storage' },
      { binding: 3, resource: gid('advect-tmp'), kind: 'storage' },
      { binding: 4, resource: denNext(), kind: 'storage' },
    ]);
    addPass('fluid-riders-advect-density', FLUID_RIDERS_NATIVE_SHADER_IDS.advect, 'cs_advect_mc_den', gridDispatch, [
      { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
      { binding: 1, resource: velCur(), kind: 'read-only-storage' },
      { binding: 2, resource: denCur(), kind: 'read-only-storage' },
      { binding: 3, resource: gid('advect-tmp'), kind: 'storage' },
      { binding: 4, resource: denNext(), kind: 'storage' },
    ]);
  } else {
    addPass('fluid-riders-advect-density', SMOKE_3D_NATIVE_SHADER_IDS.advectDensity, 'cs_advect_den', gridDispatch, [
      { binding: 0, resource: uid('sim-uniform'), kind: 'uniform' },
      { binding: 1, resource: velCur(), kind: 'read-only-storage' },
      { binding: 2, resource: denCur(), kind: 'read-only-storage' },
      { binding: 3, resource: denNext(), kind: 'storage' },
    ]);
  }
  denFlip = !denFlip;

  // Riders read the FINAL divergence-free velocity, the FINAL density
  // and the pressure field the projection just solved.
  const riderDispatch: [number, number, number] = [Math.max(1, Math.ceil(riderCount / 64)), 1, 1];
  addPass('fluid-riders-riders', FLUID_RIDERS_NATIVE_SHADER_IDS.riders, 'cs_riders', riderDispatch, [
    { binding: 0, resource: uid('rider-uniform'), kind: 'uniform' },
    { binding: 1, resource: rid('riders'), kind: 'storage' },
    { binding: 2, resource: velCur(), kind: 'read-only-storage' },
    { binding: 3, resource: denCur(), kind: 'read-only-storage' },
    { binding: 4, resource: prsCur(), kind: 'read-only-storage' },
  ]);

  const tileDispatch: [number, number, number] = [Math.max(1, Math.ceil(tileCount / 64)), 1, 1];
  addPass('fluid-riders-clear-tiles', FLUID_RIDERS_NATIVE_SHADER_IDS.tiles, 'cs_clear_tiles', tileDispatch, [
    { binding: 0, resource: uid('bin-uniform'), kind: 'uniform' },
    { binding: 1, resource: rid('riders'), kind: 'read-only-storage' },
    { binding: 2, resource: tid('tile-counts'), kind: 'storage' },
    { binding: 3, resource: tid('tile-indices'), kind: 'storage' },
  ]);
  addPass('fluid-riders-bin-riders', FLUID_RIDERS_NATIVE_SHADER_IDS.tiles, 'cs_bin_riders', riderDispatch, [
    { binding: 0, resource: uid('bin-uniform'), kind: 'uniform' },
    { binding: 1, resource: rid('riders'), kind: 'read-only-storage' },
    { binding: 2, resource: tid('tile-counts'), kind: 'storage' },
    { binding: 3, resource: tid('tile-indices'), kind: 'storage' },
  ]);

  const renderPass: FluidRidersNativeGraphRenderPass = {
    name: 'fluid-riders-unified',
    shader_id: FLUID_RIDERS_NATIVE_SHADER_IDS.render,
    vertex_entry: 'vs_main',
    fragment_entry: 'fs_main',
    target: 'source_frame',
    source_id: sourceId,
    seq: frameIndex,
    clear: true,
    clear_color: [0, 0, 0, 0],
    include_snapshot: !!options.includeSnapshot,
    blend: 'alpha',
    primitive: 'triangle-list',
    vertex_count: 3,
    instance_count: 1,
    bindings: [
      { binding: 0, resource: uid('render-uniform'), kind: 'uniform' },
      { binding: 1, resource: denCur(), kind: 'read-only-storage' },
      { binding: 2, resource: rid('riders'), kind: 'read-only-storage' },
      { binding: 3, resource: tid('tile-counts'), kind: 'read-only-storage' },
      { binding: 4, resource: tid('tile-indices'), kind: 'read-only-storage' },
    ],
  };

  state = {
    ...state,
    grid: params.gridSize,
    riderCount,
    tileCountX,
    tileCountY,
    velFlip,
    denFlip,
    prsFlip,
  };

  return {
    config: {
      buffers,
      passes,
      render_passes: [renderPass],
      readbacks: [],
    },
    sourceId,
    state,
    riderCount,
    passCount: passes.length + 1,
  };
}

/* ============================================================== */
/* BROWSER FALLBACK                                                */
/* ============================================================== */
// The native compute graph above is the real instrument. The in-browser
// WebGPU path keeps working by driving the two existing renderers with
// params derived from the new model — approximate, but it never
// regresses to a black layer on the non-native build.

export interface FluidRidersInnerParams {
  smoke: Partial<Smoke3DParams>;
  spheres: Partial<VolumetricSpheresParams>;
}

export function buildFluidRidersInnerParams(
  params?: Record<string, any> | null,
  bands?: { bass?: number; treble?: number } | null,
): FluidRidersInnerParams {
  const p = resolveFluidRidersParams(params, bands);
  const to255 = (c: [number, number, number]): [number, number, number] =>
    [c[0] * 255, c[1] * 255, c[2] * 255];
  return {
    smoke: {
      gridSize: p.gridSize,
      emitterCount: p.emitterCount,
      spread: p.spread,
      spawnY: p.spawnY,
      splatRadius: p.splatRadius,
      splatStrength: p.splatStrength,
      splatVelocityMag: p.splatVelocityMag,
      splatRate: p.splatRate,
      velocityDecay: p.velocityDecay,
      densityDecay: p.densityDecay,
      windX: p.wind[0],
      windY: p.wind[1],
      windZ: p.wind[2],
      turbStrength: p.turbStrength + p.vorticity * 0.06,
      turbScale: p.turbScale,
      emission: p.emission * 1.6,
      density: p.density,
      fogColor: p.backgroundColor,
      fogOpacity: p.backgroundMode === 0 ? 0 : p.backgroundOpacity,
      lightDirX: -0.42,
      lightDirY: 0.68,
      lightDirZ: 0.62,
      lightStrength: p.keyStrength * 0.28,
      lightColor: p.keyColor,
      ambient: p.ambient,
      shadowSteps: p.shadowSteps,
      shadowStepLen: p.shadowStepLen,
      volumeScaleX: p.volumeScaleX,
      volumeScaleZ: p.volumeScaleZ,
      fovDeg: p.fovDeg,
      cameraZ: p.cameraZ,
      rotateX: p.rotateX,
      rotateY: p.rotateY,
      rotateZ: p.rotateZ,
      autoRotateX: p.autoRotateX,
      autoRotateY: p.autoRotateY,
      autoRotateZ: p.autoRotateZ,
      bass: p.bass,
      treble: p.treble,
      audioBurst: p.audioBurst,
      emitterColors: [p.colorA, p.colorB, p.colorC, p.colorD, p.colorA, p.colorB, p.colorC, p.colorD],
    },
    spheres: {
      layout: 'cluster',
      sphereCount: p.riderCount,
      radiusScale: p.riderSize,
      radiusVariance: p.riderSizeVariance,
      spread: p.volumeScaleX * 0.8,
      depth: p.volumeScaleZ * 0.9,
      opacity: 1,
      fogDensity: 0.3 + p.density * 0.04,
      backgroundOpacity: 0,
      fogColor: p.backgroundColor,
      clearBackground: false,
      lightX: -0.42,
      lightY: 0.68,
      lightZ: 0.62,
      lightStrength: p.keyStrength * 0.3,
      ambient: p.ambient + 0.1,
      diffuse: 1.0,
      specular: 0.4 + (1 - p.roughness) * 0.9,
      shininess: 24 + (1 - p.roughness) * 160,
      reflection: 0.1 + (1 - p.roughness) * 0.35,
      rim: p.rimStrength * 0.2,
      colorCycle: 0.02,
      saturation: 1.05,
      brightness: p.exposure,
      colorA: to255(p.colorA),
      colorB: to255(p.colorB),
      colorC: to255(p.colorC),
      colorD: to255(p.colorD),
      motion: p.flowCoupling,
      swirl: Math.abs(p.vortexPull) * 2,
      pull: 0.2,
      chaos: p.turbStrength * 0.4,
      damping: 1 + p.riderDamping,
      audioReactive: p.audioReactive,
      bassPulse: p.audioBurst,
      trebleSparkle: 0.25,
      fovDeg: p.fovDeg,
      cameraZ: p.cameraZ,
      rotateX: p.rotateX,
      rotateY: p.rotateY,
      rotateZ: p.rotateZ,
      autoRotateX: p.autoRotateX,
      autoRotateY: p.autoRotateY,
      autoRotateZ: p.autoRotateZ,
    },
  };
}

export class WebGPUFluidRidersShader implements GpuShaderImpl {
  private smoke: WebGPU3DSmoke;
  private particles: WebGPUVolumetricSpheresShader;
  private bands: Bands | null = null;
  private smoothedBands: Bands = { bass: 0, mid: 0, treble: 0 };
  private lastBandTime = 0;
  private lastParams: Record<string, any> = { ...fluidRidersParamDefaults };

  constructor(device: any, presentFormat: any) {
    this.smoke = new WebGPU3DSmoke(device, presentFormat);
    this.particles = new WebGPUVolumetricSpheresShader(device, presentFormat);
    this.applyParams();
  }

  setBands(bass: number, mid: number, treble: number): void {
    const now = performance.now() / 1000;
    const dt = this.lastBandTime === 0
      ? 1 / 60
      : Math.min(Math.max(now - this.lastBandTime, 1 / 240), 0.25);
    this.lastBandTime = now;

    const smoothing = 0.86;
    const attack = 1 - Math.pow(smoothing, dt * 90);
    const release = 1 - Math.pow(smoothing, dt * 26);
    const follow = (prev: number, targetValue: number) => {
      const amount = targetValue > prev ? attack : release;
      return prev + (targetValue - prev) * amount;
    };

    this.smoothedBands = {
      bass: follow(this.smoothedBands.bass, bass),
      mid: follow(this.smoothedBands.mid, mid),
      treble: follow(this.smoothedBands.treble, treble),
    };
    this.bands = this.smoothedBands;
    this.applyParams();
  }

  setParams(params: Record<string, any>): void {
    this.lastParams = { ...fluidRidersParamDefaults, ...params };
    this.applyParams();
  }

  encodeFrame(encoder: any, targetView: any, format: any, width: number, height: number, dt: number, time?: number): void {
    this.smoke.setViewport(width, height);
    this.particles.resize(width, height);

    const clearPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();

    this.smoke.encodeFrame(encoder, targetView, time, dt);
    this.particles.encodeFrame(encoder, targetView, format, width, height, dt, time);
  }

  resize(_width: number, _height: number): void {
    // Both inner renderers receive viewport dimensions per frame.
  }

  getDebugStats(): Record<string, any> {
    return {
      instrument: 'fluid-riders',
      mode: 'webgpu-fallback',
      smoke: this.smoke.getDebugStats(),
      particles: typeof (this.particles as any).getDebugStats === 'function'
        ? (this.particles as any).getDebugStats()
        : { instrument: 'volumetric-spheres' },
    };
  }

  dispose(): void {
    try { this.smoke.dispose(); } catch { /* */ }
    try { this.particles.dispose(); } catch { /* */ }
  }

  private applyParams(): void {
    const mapped = buildFluidRidersInnerParams(this.lastParams, this.bands);
    this.smoke.setParams(mapped.smoke);
    this.particles.setParams(mapped.spheres);
  }
}
