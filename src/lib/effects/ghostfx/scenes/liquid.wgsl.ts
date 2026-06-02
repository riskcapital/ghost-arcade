// "Liquid" — real 2D Navier-Stokes fluid simulation, GPU compute.
//
// Per-frame pass list (in order):
//   1. SPLAT          inject velocity + dye impulses (audio-driven)
//   2. ADVECT_VEL     semi-Lagrangian backward advection of velocity
//   3. DIVERGENCE     ∇·u on velocity field
//   4. JACOBI × N     iterate ∇²p = ∇·u (pressure Poisson solve)
//   5. SUBTRACT_GRAD  u' = u - ∇p (makes velocity divergence-free)
//   6. ADVECT_DYE     advect colored dye through final velocity field
//   7. RENDER         sample dye, tonemap, output premultiplied alpha
//
// Ping-pong textures: velocity, dye, pressure each have two textures
// (A and B). Each compute pass reads from one and writes to the
// other; CPU swaps the "current" pointer after each pass.
//
// Audio coupling per design constraints (emissions/rates only, never
// geometry):
//   beatPulse → big splat at random position (palette-colored)
//   bassSlow  → low-rate trickle of small splats (audible bass = more drops)
//   energy    → splat velocity impulse magnitude (drops "shove" harder)
//   trebSlow  → palette saturation drift (slow)
//   hueShift  → palette migration
//
// Each pass is its own WGSL module so it can declare only the
// bindings it actually uses — keeps pipeline layouts tight and
// avoids "binding declared but not bound" validation pain.

const LIQUID_COMMON = /* wgsl */ `
struct Uniforms {
  simRes: vec2<f32>,
  canvasRes: vec2<f32>,
  time: f32,
  dt: f32,
  // Audio (smoothed)
  bassSlow: f32, midSlow: f32, trebSlow: f32, energy: f32,
  beatPhase: f32, beatPulse: f32, hueShift: f32, exposure: f32,
  // Tuning
  splatForce: f32,
  splatRadius: f32,
  dyeDecay: f32,
  velDecay: f32,
  // Splat count
  numSplats: u32,
  pad0: u32, pad1: u32, pad2: u32,
};

struct Splat {
  posVel: vec4<f32>,        // xy = uv center, zw = velocity impulse (uv/s)
  colorRadius: vec4<f32>,   // xyz = color, w = radius (uv units)
};

@group(0) @binding(0) var<uniform> u: Uniforms;

// Manual bilinear sample of a texture_2d<f32>. We can't use samplers
// in compute (well, we can, but textureSampleLevel requires uniform
// control flow — easier to do it ourselves). uv in [0,1].
fn sampleBilinear(t: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let dim = vec2<f32>(textureDimensions(t));
  let p = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * dim - 0.5;
  let pi = floor(p);
  let pf = p - pi;
  let maxC = vec2<i32>(dim - 1.0);
  let i0 = clamp(vec2<i32>(pi), vec2<i32>(0), maxC);
  let i1 = clamp(i0 + vec2<i32>(1, 0), vec2<i32>(0), maxC);
  let i2 = clamp(i0 + vec2<i32>(0, 1), vec2<i32>(0), maxC);
  let i3 = clamp(i0 + vec2<i32>(1, 1), vec2<i32>(0), maxC);
  let c00 = textureLoad(t, i0, 0);
  let c10 = textureLoad(t, i1, 0);
  let c01 = textureLoad(t, i2, 0);
  let c11 = textureLoad(t, i3, 0);
  let cx0 = mix(c00, c10, pf.x);
  let cx1 = mix(c01, c11, pf.x);
  return mix(cx0, cx1, pf.y);
}

fn uvFromCoord(coord: vec2<i32>, dim: vec2<i32>) -> vec2<f32> {
  return (vec2<f32>(coord) + 0.5) / vec2<f32>(dim);
}
`;

// ─── 1. SPLAT ──────────────────────────────────────────────────────
// Adds Gaussian-weighted velocity + dye contributions from each
// active splat. Splats live in a storage buffer prepared by CPU each
// frame based on audio events.
export const LIQUID_SPLAT_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> splats: array<Splat>;
@group(0) @binding(2) var velIn: texture_2d<f32>;
@group(0) @binding(3) var dyeIn: texture_2d<f32>;
@group(0) @binding(4) var velOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var dyeOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csSplat(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(velIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);

  var vel = textureLoad(velIn, coord, 0).xy;
  var dye = textureLoad(dyeIn, coord, 0);

  // Aspect ratio of the sim grid — circular splats need x scaled by
  // aspect so they don't stretch into ellipses on wide sim grids.
  let aspect = u.simRes.x / max(u.simRes.y, 1.0);

  for (var i: u32 = 0u; i < u.numSplats; i = i + 1u) {
    let s = splats[i];
    let d = uv - s.posVel.xy;
    let dC = vec2<f32>(d.x * aspect, d.y);
    let r = max(s.colorRadius.w, 1e-4);
    let g = exp(-dot(dC, dC) / (r * r));
    vel = vel + s.posVel.zw * g * u.splatForce;
    let cAdd = s.colorRadius.xyz * g * u.splatForce * 0.6;
    dye = vec4<f32>(dye.xyz + cAdd, min(dye.w + g * u.splatForce * 0.5, 4.0));
  }

  textureStore(velOut, coord, vec4<f32>(vel, 0.0, 1.0));
  textureStore(dyeOut, coord, dye);
}
`;

// ─── 2. ADVECT VELOCITY ────────────────────────────────────────────
// Semi-Lagrangian backward advection. Look back along the velocity
// field and sample what was there one timestep ago. Apply small
// damping (velDecay close to 1.0) so the field doesn't run forever.
export const LIQUID_ADVECT_VEL_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var velIn: texture_2d<f32>;
@group(0) @binding(2) var velOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csAdvectVel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(velIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);

  let v0 = textureLoad(velIn, coord, 0).xy;
  // Backtrack to where this parcel came from. dt scaled by aspect-
  // free factor; sim grid is in uv-space velocity.
  let uvBack = uv - v0 * u.dt;
  let v1 = sampleBilinear(velIn, uvBack).xy * u.velDecay;
  textureStore(velOut, coord, vec4<f32>(v1, 0.0, 1.0));
}
`;

// ─── 3. DIVERGENCE ────────────────────────────────────────────────
// Central-difference divergence of velocity. div = ∂u/∂x + ∂v/∂y.
// Used as the RHS of the pressure Poisson equation.
export const LIQUID_DIVERGENCE_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var velIn: texture_2d<f32>;
@group(0) @binding(2) var divOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csDivergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(velIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let maxC = dim - vec2<i32>(1);
  let l = clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxC);
  let r = clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), maxC);
  let b = clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxC);
  let t = clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), maxC);
  let vL = textureLoad(velIn, l, 0).x;
  let vR = textureLoad(velIn, r, 0).x;
  let vB = textureLoad(velIn, b, 0).y;
  let vT = textureLoad(velIn, t, 0).y;
  let div = 0.5 * ((vR - vL) + (vT - vB));
  textureStore(divOut, coord, vec4<f32>(div, 0.0, 0.0, 1.0));
}
`;

// ─── 4. JACOBI ITERATION (pressure solve) ─────────────────────────
// One Jacobi step toward solving ∇²p = ∇·u. CPU runs this N times,
// ping-ponging between pressureA and pressureB each iteration.
//   p_new[i,j] = (p[i-1,j] + p[i+1,j] + p[i,j-1] + p[i,j+1] - div[i,j]) / 4
export const LIQUID_JACOBI_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var presIn: texture_2d<f32>;
@group(0) @binding(2) var divIn: texture_2d<f32>;
@group(0) @binding(3) var presOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csJacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(presIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let maxC = dim - vec2<i32>(1);
  let pL = textureLoad(presIn, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxC), 0).x;
  let pR = textureLoad(presIn, clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), maxC), 0).x;
  let pB = textureLoad(presIn, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxC), 0).x;
  let pT = textureLoad(presIn, clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), maxC), 0).x;
  let d = textureLoad(divIn, coord, 0).x;
  let pNew = (pL + pR + pB + pT - d) * 0.25;
  textureStore(presOut, coord, vec4<f32>(pNew, 0.0, 0.0, 1.0));
}
`;

// ─── 5. SUBTRACT GRADIENT ─────────────────────────────────────────
// Subtract gradient of pressure from velocity to enforce
// incompressibility: u' = u - ∇p
export const LIQUID_SUBTRACT_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var velIn: texture_2d<f32>;
@group(0) @binding(2) var presIn: texture_2d<f32>;
@group(0) @binding(3) var velOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csSubtractGradient(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(velIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let maxC = dim - vec2<i32>(1);
  let pL = textureLoad(presIn, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxC), 0).x;
  let pR = textureLoad(presIn, clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), maxC), 0).x;
  let pB = textureLoad(presIn, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxC), 0).x;
  let pT = textureLoad(presIn, clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), maxC), 0).x;
  let v = textureLoad(velIn, coord, 0).xy;
  let grad = vec2<f32>(pR - pL, pT - pB) * 0.5;
  let vNew = v - grad;
  textureStore(velOut, coord, vec4<f32>(vNew, 0.0, 1.0));
}
`;

// ─── 6. ADVECT DYE ────────────────────────────────────────────────
// Backward advect the colored dye through the (now divergence-free)
// velocity field. Apply dyeDecay so colors fade over time.
export const LIQUID_ADVECT_DYE_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var dyeIn: texture_2d<f32>;
@group(0) @binding(2) var velIn: texture_2d<f32>;
@group(0) @binding(3) var dyeOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csAdvectDye(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(dyeIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);

  let v = textureLoad(velIn, coord, 0).xy;
  let uvBack = uv - v * u.dt;
  let d = sampleBilinear(dyeIn, uvBack) * u.dyeDecay;
  textureStore(dyeOut, coord, d);
}
`;

// ─── 7. RENDER ─────────────────────────────────────────────────────
// Fullscreen tri, samples dye texture (with bilinear filtering),
// outputs HDR to sceneTex. Bloom pass downstream will extract bright
// dye plumes and the composite shader will tonemap + premultiply.
//
// IMPORTANT: this writes UN-premultiplied HDR color + density-alpha
// into sceneTex (rgba16float). The composite shader does the final
// tonemap/premultiply step.
export const LIQUID_RENDER_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var dyeTex: texture_2d<f32>;
@group(0) @binding(2) var dyeSamp: sampler;

struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsRender(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsOut;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}

@fragment fn fsRender(in: VsOut) -> @location(0) vec4<f32> {
  let dye = textureSampleLevel(dyeTex, dyeSamp, in.uv, 0.0);
  // HDR color stays HDR — composite will tonemap. Boost dye colors
  // a bit so bloom has something to extract from quiet sections.
  let col = dye.rgb * 1.4;
  // Alpha = density. Composite reads sceneTex.a and outputs premul.
  let alpha = clamp(dye.a + dot(col, vec3<f32>(0.2126, 0.7152, 0.0722)) * 0.4, 0.0, 1.0);
  return vec4<f32>(col, alpha);
}
`;
