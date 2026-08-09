// "Liquid" — real 2D Navier-Stokes fluid simulation, GPU compute.
//
// Per-frame pass list (in order):
//   1. SPLAT          inject velocity + dye impulses (audio-driven, generated
//                     per-frame IN THE NATIVE CORE — see main.rs)
//   2. ADVECT_VEL     semi-Lagrangian advection + vorticity confinement
//   3. DIVERGENCE     ∇·u on velocity field
//   4. JACOBI × N     iterate ∇²p = ∇·u (pressure Poisson solve)
//   5. SUBTRACT_GRAD  u' = u - ∇p (makes velocity divergence-free)
//   6. ADVECT_DYE     advect colored dye through final velocity field
//   7. RENDER         screen-space liquid shading (normals/specular/fresnel)
//
// STORAGE MODEL: all fields live in persistent STORAGE BUFFERS, not textures.
// The native core's compute-graph runtime supports persistent named buffers
// (the same mechanism the 3D Smoke instrument uses) but has no graph-internal
// texture concept — the original texture-based port of this scene could never
// build a pipeline under the native template path. Bilinear sampling is done
// manually (it already was, even in the texture version).
//
// Ping-pong: velocity, dye, pressure each have two buffers (A and B); the
// graph builder alternates read/write roles per pass.

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
  // Splat count + look
  numSplats: u32,
  vorticity: f32,   // vorticity-confinement strength (swirl liveliness)
  gloss: f32,       // 0..1 — specular tightness/intensity of the liquid surface
  ambient: f32,     // ambient light floor
  depth: f32,       // height scale for the 3D raymarched surface
  bubbleRate: f32,  // droplet/bubble spawn intensity
  lightDir: vec4<f32>, // xyz = normalized light direction (z toward viewer), w = strength
  // Trailing pad keeps this struct at a UNIQUE 128-byte size: the native
  // core's per-frame template updater dispatches GhostFX uniform layouts by
  // byte length (112 = drift/ribbons). Changing this size requires updating
  // native_plugin_graph_frame_job in native-renderer/src/main.rs.
  pad2: vec4<f32>,
};

struct Splat {
  posVel: vec4<f32>,        // xy = uv center, zw = velocity impulse (uv/s)
  colorRadius: vec4<f32>,   // xyz = color, w = radius (uv units)
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn simDim() -> vec2<i32> {
  return vec2<i32>(i32(u.simRes.x), max(i32(u.simRes.y), 1));
}

fn simIdx(coord: vec2<i32>) -> u32 {
  let dim = simDim();
  let c = clamp(coord, vec2<i32>(0), dim - vec2<i32>(1));
  return u32(c.y * dim.x + c.x);
}

fn uvFromCoord(coord: vec2<i32>, dim: vec2<i32>) -> vec2<f32> {
  return (vec2<f32>(coord) + 0.5) / vec2<f32>(dim);
}
`;

// ─── 1. SPLAT ──────────────────────────────────────────────────────
// Adds Gaussian-weighted velocity + dye contributions from each active
// splat. The splat list is regenerated EVERY FRAME by the native core
// (emitters + beat vortex rings + bass trickle) — replaying a static
// frame-zero list was the "liquid barely shows anything" defect.
export const LIQUID_SPLAT_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> splats: array<Splat>;
@group(0) @binding(2) var<storage, read> velIn: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> dyeIn: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> velOut: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> dyeOut: array<vec4<f32>>;

@compute @workgroup_size(8, 8)
fn csSplat(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = simDim();
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);
  let index = simIdx(coord);

  var vel = velIn[index];
  var dye = dyeIn[index];

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

  velOut[index] = vel;
  dyeOut[index] = dye;
}
`;

// ─── 2. ADVECT VELOCITY (+ vorticity confinement) ─────────────────
// Semi-Lagrangian backward advection, then vorticity confinement:
// advection smears small eddies away, so we measure the local curl and
// push velocity back toward the swirl centers. This is the pass that
// keeps the fluid ALIVE — without it the field dissolves into
// featureless drift within a second of the last splat.
export const LIQUID_ADVECT_VEL_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> velIn: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> velOut: array<vec2<f32>>;

fn sampleVelBilinear(uv: vec2<f32>) -> vec2<f32> {
  let dim = vec2<f32>(simDim());
  let p = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * dim - 0.5;
  let pi = floor(p);
  let pf = p - pi;
  let i = vec2<i32>(pi);
  let c00 = velIn[simIdx(i)];
  let c10 = velIn[simIdx(i + vec2<i32>(1, 0))];
  let c01 = velIn[simIdx(i + vec2<i32>(0, 1))];
  let c11 = velIn[simIdx(i + vec2<i32>(1, 1))];
  return mix(mix(c00, c10, pf.x), mix(c01, c11, pf.x), pf.y);
}

fn curlAt(coord: vec2<i32>) -> f32 {
  let l = velIn[simIdx(coord + vec2<i32>(-1, 0))].y;
  let r = velIn[simIdx(coord + vec2<i32>( 1, 0))].y;
  let b = velIn[simIdx(coord + vec2<i32>(0, -1))].x;
  let t = velIn[simIdx(coord + vec2<i32>(0,  1))].x;
  return 0.5 * ((r - l) - (t - b));
}

@compute @workgroup_size(8, 8)
fn csAdvectVel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = simDim();
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);

  let v0 = velIn[simIdx(coord)];
  let uvBack = uv - v0 * u.dt;
  var v1 = sampleVelBilinear(uvBack) * u.velDecay;

  // Vorticity confinement: F = eps * (N x omega), N = grad|omega| normalized.
  if (u.vorticity > 0.001) {
    let omega = curlAt(coord);
    let oL = abs(curlAt(coord + vec2<i32>(-1, 0)));
    let oR = abs(curlAt(coord + vec2<i32>( 1, 0)));
    let oB = abs(curlAt(coord + vec2<i32>(0, -1)));
    let oT = abs(curlAt(coord + vec2<i32>(0,  1)));
    let eta = vec2<f32>(oR - oL, oT - oB) * 0.5;
    let etaLen = length(eta);
    if (etaLen > 1e-5) {
      let n = eta / etaLen;
      v1 = v1 + vec2<f32>(n.y, -n.x) * omega * u.vorticity * u.dt;
    }
  }
  velOut[simIdx(coord)] = v1;
}
`;

// ─── 3. DIVERGENCE ────────────────────────────────────────────────
export const LIQUID_DIVERGENCE_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> velIn: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> divOut: array<f32>;

@compute @workgroup_size(8, 8)
fn csDivergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = simDim();
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let vL = velIn[simIdx(coord + vec2<i32>(-1, 0))].x;
  let vR = velIn[simIdx(coord + vec2<i32>( 1, 0))].x;
  let vB = velIn[simIdx(coord + vec2<i32>(0, -1))].y;
  let vT = velIn[simIdx(coord + vec2<i32>(0,  1))].y;
  divOut[simIdx(coord)] = 0.5 * ((vR - vL) + (vT - vB));
}
`;

// ─── 4. JACOBI ITERATION (pressure solve) ─────────────────────────
export const LIQUID_JACOBI_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> presIn: array<f32>;
@group(0) @binding(2) var<storage, read> divIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> presOut: array<f32>;

@compute @workgroup_size(8, 8)
fn csJacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = simDim();
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let pL = presIn[simIdx(coord + vec2<i32>(-1, 0))];
  let pR = presIn[simIdx(coord + vec2<i32>( 1, 0))];
  let pB = presIn[simIdx(coord + vec2<i32>(0, -1))];
  let pT = presIn[simIdx(coord + vec2<i32>(0,  1))];
  let d = divIn[simIdx(coord)];
  presOut[simIdx(coord)] = (pL + pR + pB + pT - d) * 0.25;
}
`;

// ─── 5. SUBTRACT GRADIENT ─────────────────────────────────────────
export const LIQUID_SUBTRACT_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> velIn: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> presIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> velOut: array<vec2<f32>>;

@compute @workgroup_size(8, 8)
fn csSubtractGradient(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = simDim();
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let pL = presIn[simIdx(coord + vec2<i32>(-1, 0))];
  let pR = presIn[simIdx(coord + vec2<i32>( 1, 0))];
  let pB = presIn[simIdx(coord + vec2<i32>(0, -1))];
  let pT = presIn[simIdx(coord + vec2<i32>(0,  1))];
  let v = velIn[simIdx(coord)];
  velOut[simIdx(coord)] = v - vec2<f32>(pR - pL, pT - pB) * 0.5;
}
`;

// ─── 6. ADVECT DYE ────────────────────────────────────────────────
export const LIQUID_ADVECT_DYE_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> dyeIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velIn: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> dyeOut: array<vec4<f32>>;

fn sampleDyeBilinear(uv: vec2<f32>) -> vec4<f32> {
  let dim = vec2<f32>(simDim());
  let p = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * dim - 0.5;
  let pi = floor(p);
  let pf = p - pi;
  let i = vec2<i32>(pi);
  let c00 = dyeIn[simIdx(i)];
  let c10 = dyeIn[simIdx(i + vec2<i32>(1, 0))];
  let c01 = dyeIn[simIdx(i + vec2<i32>(0, 1))];
  let c11 = dyeIn[simIdx(i + vec2<i32>(1, 1))];
  return mix(mix(c00, c10, pf.x), mix(c01, c11, pf.x), pf.y);
}

@compute @workgroup_size(8, 8)
fn csAdvectDye(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = simDim();
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);
  let v = velIn[simIdx(coord)];
  let uvBack = uv - v * u.dt;
  dyeOut[simIdx(coord)] = sampleDyeBilinear(uvBack) * u.dyeDecay;
}
`;

// ─── 7. RENDER ─────────────────────────────────────────────────────
// Screen-space liquid shading. The dye density field is treated as a
// liquid height-field: gradients give surface normals, which drive a
// full glossy-material stack — Blinn specular from the key light,
// fresnel rim lit by a fake environment, Beer–Lambert absorption for
// thick saturated cores, and a cheap directional self-shadow. This is
// what turns a flat 2D dye sim into something that reads as thick,
// raytraced liquid (the "Notch splash" look) instead of colored smoke.
//
// IMPORTANT: writes UN-premultiplied HDR color + density-alpha into
// sceneTex (rgba16float); the composite does tonemap/premultiply.
// Speculars intentionally exceed 1.0 so bloom picks them up.
export const LIQUID_RENDER_WGSL = LIQUID_COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> dyeField: array<vec4<f32>>;

struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsRender(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsOut;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}

fn sampleDye(uv: vec2<f32>) -> vec4<f32> {
  let dim = vec2<f32>(simDim());
  let p = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * dim - 0.5;
  let pi = floor(p);
  let pf = p - pi;
  let i = vec2<i32>(pi);
  let c00 = dyeField[simIdx(i)];
  let c10 = dyeField[simIdx(i + vec2<i32>(1, 0))];
  let c01 = dyeField[simIdx(i + vec2<i32>(0, 1))];
  let c11 = dyeField[simIdx(i + vec2<i32>(1, 1))];
  return mix(mix(c00, c10, pf.x), mix(c01, c11, pf.x), pf.y);
}

fn dyeDensity(uv: vec2<f32>) -> f32 {
  let d = sampleDye(uv);
  return d.a + dot(d.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)) * 0.35;
}

fn liquidHeight(uv: vec2<f32>) -> f32 {
  // Compress density into a bounded "thickness" so tall stacks of dye
  // round off like a meniscus instead of growing needle highlights.
  return pow(clamp(dyeDensity(uv) / 1.6, 0.0, 1.0), 0.72);
}

@fragment fn fsRender(in: VsOut) -> @location(0) vec4<f32> {
  // ── 3D heightfield raymarch ─────────────────────────────────────
  // The dye density field is a liquid height surface; march a tilted
  // perspective ray until it dips below the surface, then shade the
  // hit point. This buys real depth: parallax, side-walls on thick
  // blobs, and self-occlusion — the "volumetric splash" read.
  let depthScale = clamp(u.depth, 0.02, 1.0);
  let tilt = (in.uv - vec2<f32>(0.5)) * 0.55;
  let ro = vec3<f32>(in.uv - tilt * depthScale * 0.6, 1.0);
  let rd = normalize(vec3<f32>(tilt * depthScale, -1.0));

  var t = (1.0 - depthScale) / max(-rd.z, 0.35);
  var hitUv = in.uv;
  var hitH = 0.0;
  var hit = false;
  let stepLen = depthScale / 18.0;
  for (var i = 0; i < 26; i = i + 1) {
    let p = ro + rd * t;
    if (p.z <= 0.0) { break; }
    let sUv = p.xy;
    let h = liquidHeight(sUv) * depthScale;
    if (p.z <= h) {
      // Binary refine for a clean silhouette.
      var t0 = t - stepLen;
      var t1 = t;
      for (var j = 0; j < 4; j = j + 1) {
        let tm = (t0 + t1) * 0.5;
        let pm = ro + rd * tm;
        if (pm.z <= liquidHeight(pm.xy) * depthScale) { t1 = tm; } else { t0 = tm; }
      }
      let ph = ro + rd * t1;
      hitUv = ph.xy;
      hitH = ph.z;
      hit = true;
      break;
    }
    t = t + stepLen;
  }
  if (!hit) {
    return vec4<f32>(0.0);
  }

  let dye = sampleDye(hitUv);
  let density = dyeDensity(hitUv);
  let h = liquidHeight(hitUv);

  // Surface normal from the height gradient at the HIT point, with z
  // compressed by the depth scale so tall surfaces read steep.
  let texel = vec2<f32>(1.5) / max(u.simRes, vec2<f32>(8.0));
  let hx = liquidHeight(hitUv + vec2<f32>(texel.x, 0.0)) - liquidHeight(hitUv - vec2<f32>(texel.x, 0.0));
  let hy = liquidHeight(hitUv + vec2<f32>(0.0, texel.y)) - liquidHeight(hitUv - vec2<f32>(0.0, texel.y));
  let bump = (2.2 + u.gloss * 3.2) * (0.5 + depthScale);
  let n = normalize(vec3<f32>(-hx * bump, -hy * bump, 1.0));

  let lightStrength = max(u.lightDir.w, 0.0);
  let l = normalize(u.lightDir.xyz);
  let v = normalize(-rd);
  let hVec = normalize(l + v);

  // Body color with Beer–Lambert-ish absorption; thickness now comes
  // from the surface height at the hit, so cores go deep and rich.
  let albedo = dye.rgb / max(density, 1e-3);
  let deep = albedo * albedo * 0.9;
  let body = mix(albedo, deep, clamp(h * 1.15, 0.0, 1.0)) * (0.30 + 0.70 * h);

  // Directional self-shadow marched a few texels toward the light.
  let shadowTap = liquidHeight(hitUv + l.xy * texel * 5.0);
  let shade = 1.0 - clamp((shadowTap - h) * 1.8, 0.0, 0.65);

  let diffuse = max(dot(n, l), 0.0) * lightStrength * shade;
  let specPow = mix(28.0, 220.0, clamp(u.gloss, 0.0, 1.0));
  let spec = pow(max(dot(n, hVec), 0.0), specPow) * (0.5 + 2.6 * u.gloss) * lightStrength * shade;

  let fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
  let r = reflect(-v, n);
  let horizon = clamp(r.y * 0.5 + 0.5, 0.0, 1.0);
  let envDeep = vec3<f32>(0.015, 0.012, 0.035);
  let envGlow = albedo * 1.35 + vec3<f32>(0.28, 0.22, 0.30);
  let env = mix(envDeep, envGlow, horizon);

  // Depth cue: surfaces deeper in the volume dim slightly — sells 3D.
  let depthCue = mix(0.55, 1.0, clamp(hitH / max(depthScale, 1e-3), 0.0, 1.0));

  let col = (body * (u.ambient + diffuse)
    + env * fres * (0.35 + 0.75 * u.gloss)
    + vec3<f32>(1.0, 0.98, 0.94) * spec) * depthCue;

  let alpha = smoothstep(0.015, 0.20, density);
  return vec4<f32>(col, alpha);
}
`;

// ─── 8. BUBBLES: SIM ───────────────────────────────────────────────
// Ballistic droplets/bubbles spawned from fast-moving fluid: they
// inherit the local fluid velocity, pop upward, arc under gravity,
// and die. Spawn rate scales with local speed, energy, and the beat —
// this is the "splash" layer over the liquid surface.
export const LIQUID_BUBBLE_SIM_WGSL = LIQUID_COMMON + /* wgsl */ `
struct Bubble {
  pos: vec2<f32>,
  vel: vec2<f32>,
  life: f32,
  size: f32,
  hue: f32,
  seed: f32,
};
@group(0) @binding(1) var<storage, read_write> bubbles: array<Bubble>;
@group(0) @binding(2) var<storage, read> velField: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> dyeField: array<vec4<f32>>;

fn hash11(x: f32) -> f32 {
  return fract(sin(x * 127.1) * 43758.5453);
}

@compute @workgroup_size(64)
fn csBubbles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let count = arrayLength(&bubbles);
  if (gid.x >= count) { return; }
  var b = bubbles[gid.x];
  let dt = u.dt;

  if (b.life > 0.0) {
    // Integrate: gravity (screen-down = +y in uv space), drag, drift.
    b.vel.y = b.vel.y + 1.35 * dt;
    b.vel = b.vel * 0.988;
    b.pos = b.pos + b.vel * dt;
    b.life = b.life - dt;
    if (b.pos.x < -0.05 || b.pos.x > 1.05 || b.pos.y > 1.08) { b.life = 0.0; }
  } else {
    // Respawn attempt: probe a pseudo-random point; spawn probability
    // scales with local fluid speed + audio energy + beat.
    let s = f32(gid.x) * 0.618 + u.time * 1.7 + b.seed;
    let probe = vec2<f32>(hash11(s), hash11(s + 31.7));
    let dim = simDim();
    let index = simIdx(vec2<i32>(probe * vec2<f32>(dim)));
    let fluidVel = velField[index];
    let speed = length(fluidVel);
    let dyeHere = dyeField[index];
    let density = dyeHere.a;
    let chance = clamp((speed * 2.4 + u.beatPulse * 0.9 + u.energy * 0.4)
      * step(0.12, density) * u.bubbleRate, 0.0, 0.9);
    if (hash11(s + 77.3) < chance * dt * 12.0) {
      b.pos = probe;
      // Inherit fluid motion, kick "up" (−y) with spread.
      let spread = (hash11(s + 5.1) - 0.5) * 0.5;
      b.vel = fluidVel * 0.85 + vec2<f32>(spread, -(0.35 + speed * 0.55 + u.beatPulse * 0.4));
      b.life = 0.7 + hash11(s + 13.7) * 1.1;
      b.size = u.splatRadius * (0.10 + hash11(s + 41.3) * 0.22);
      b.hue = fract(u.hueShift + hash11(s + 3.3) * 0.35);
      b.seed = hash11(s + 9.9) * 100.0;
    }
  }
  bubbles[gid.x] = b;
}
`;

// ─── 9. BUBBLES: RENDER ───────────────────────────────────────────
// Instanced sphere impostors with the same key light as the liquid:
// tight specular, fresnel rim, tinted glassy body. Additive over the
// dark environment so they sparkle.
export const LIQUID_BUBBLE_RENDER_WGSL = LIQUID_COMMON + /* wgsl */ `
struct Bubble {
  pos: vec2<f32>,
  vel: vec2<f32>,
  life: f32,
  size: f32,
  hue: f32,
  seed: f32,
};
@group(0) @binding(1) var<storage, read> bubbles: array<Bubble>;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) hue: f32,
  @location(2) @interpolate(flat) fade: f32,
};

@vertex fn vsBubble(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VsOut {
  let b = bubbles[iid];
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  var out: VsOut;
  let alive = step(0.001, b.life);
  let aspect = u.canvasRes.x / max(u.canvasRes.y, 1.0);
  let corner = corners[vid];
  let size = b.size * alive;
  let world = b.pos + corner * vec2<f32>(size / max(aspect, 0.001), size);
  out.pos = vec4<f32>(world.x * 2.0 - 1.0, 1.0 - world.y * 2.0, 0.0, 1.0);
  out.local = corner;
  out.hue = b.hue;
  out.fade = clamp(b.life * 1.6, 0.0, 1.0) * alive;
  return out;
}

fn hue2rgb(h: f32) -> vec3<f32> {
  let k = fract(vec3<f32>(h, h + 1.0 / 3.0, h + 2.0 / 3.0));
  return clamp(abs(k * 6.0 - 3.0) - 1.0, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment fn fsBubble(in: VsOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.local, in.local);
  if (r2 > 1.0 || in.fade <= 0.0) { discard; }
  // Sphere impostor normal.
  let nz = sqrt(max(1.0 - r2, 0.0));
  let n = normalize(vec3<f32>(in.local.x, -in.local.y, nz));
  let l = normalize(u.lightDir.xyz);
  let vDir = vec3<f32>(0.0, 0.0, 1.0);
  let hVec = normalize(l + vDir);
  let tint = mix(vec3<f32>(1.0), hue2rgb(in.hue) * 0.9 + 0.25, 0.65);
  let body = tint * (u.ambient * 0.6 + max(dot(n, l), 0.0) * 0.35) * u.lightDir.w;
  let spec = pow(max(dot(n, hVec), 0.0), 160.0) * 2.2 * u.lightDir.w;
  let rim = pow(1.0 - nz, 2.5) * 0.8;
  let col = (body + vec3<f32>(spec) + tint * rim) * in.fade;
  // Additive target: alpha carries a soft disc for compositing weight.
  return vec4<f32>(col, nz * 0.6 * in.fade);
}
`;
