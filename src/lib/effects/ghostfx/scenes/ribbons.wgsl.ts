// "Ribbons" — aurora-like compute-driven ribbon trails through a
// curl-noise flow field. Camera-facing quad strips give them real
// 3D ribbon geometry (not 1px lines). Audio drives SPAWN RATE and
// FLOW VELOCITY — never geometry directly. Beats spawn obvious
// bursts of new ribbons; energy makes existing ribbons fly faster
// through the field.
//
// Same compute/render split as Drift: read_write storage requires
// the compute module to be separate from the render module (which
// declares the same buffer as read-only-storage).
//
// Storage:
//   particles[N_RIBBONS]            32 B each (pos, age, vel, seed)
//   trail[N_RIBBONS * TRAIL_LEN]    16 B each (vec3 pos + age)
//
// Visible audio reactivity (per user constraints — emission/rates, NOT shape):
//   bassSlow + beatPulse → ribbon SPAWN rate (dead ribbons probabilistically
//     respawn each frame; on bass hits / beats you visibly see new ribbons
//     bursting into existence)
//   energy            → flow velocity (ribbons fly faster, longer streaks)
//   bassSlow          → curl-noise field strength (more turbulent on bass)
//   trebSlow          → palette saturation drift (slow, no fast change)
//   hueShift          → palette migration

const RIBBONS_HEADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  dt: f32,
  bassSlow: f32, midSlow: f32, trebSlow: f32,
  bassFast: f32, midFast: f32, trebFast: f32,
  energy: f32,
  beatPhase: f32,
  beatPulse: f32,
  amp: f32,
  hueShift: f32,
  exposure: f32,
  latticeThreshold: f32,
  vortexStrength: f32,
  ribbonWidth: f32,
  ribbonTranslucency: f32,
  lightDirAndStrength: vec4<f32>,
  ambient: f32,
  ribbonSpawn: f32,
  pad1: f32, pad2: f32,
};
struct Particle {
  pos: vec3<f32>,
  age: f32,
  vel: vec3<f32>,
  seed: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

const TAU: f32 = 6.28318530718;
const PHI: f32 = 0.61803398875;

const NUM_RIBBONS: u32 = ${'$'}{NUM_RIBBONS}u;
const TRAIL_LEN: u32 = ${'$'}{TRAIL_LEN}u;

const FLY_ZONE_LEN: f32 = 80.0;
const SPAWN_RADIUS_BASE: f32 = 6.0;

fn hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x = x * (x + 33.33);
  return fract(x * x);
}
fn hash33(p: vec3<f32>) -> vec3<f32> {
  var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  q = q + dot(q, q.yxz + 33.33);
  return fract(vec3<f32>(q.x + q.y, q.y + q.z, q.z + q.x) * q.zyx);
}
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}
fn palette(t: f32, intensity: f32) -> vec3<f32> {
  let h = fract(0.86 + u.hueShift + t * 0.22);
  let s = clamp(0.55 + intensity * 0.30 + u.trebSlow * 0.10, 0.0, 1.0);
  let v = clamp(0.55 + intensity * 0.45, 0.0, 1.0);
  return hsv2rgb(vec3<f32>(h, s, v));
}

// Camera — slow drift along +z, very gentle bob (no audio bouncing).
fn cameraPos() -> vec3<f32> {
  let z = u.time * (2.0 + u.energy * 2.5);  // energy → ribbons stream past faster
  let x = sin(u.time * 0.17) * 0.45;
  let y = cos(u.time * 0.21) * 0.30;
  return vec3<f32>(x, y, z);
}
fn cameraForward(t: f32) -> vec3<f32> {
  let yaw   = sin(t * 0.11) * 0.06;
  let pitch = cos(t * 0.14) * 0.04;
  return normalize(vec3<f32>(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
}

// 3D value noise + curl (divergence-free vector field) — same as Drift,
// but at a larger spatial scale so ribbons make long sweeping curves
// instead of tight scribbles.
fn vnoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u3 = f * f * (3.0 - 2.0 * f);
  let n000 = hash11(dot(i + vec3<f32>(0.0,0.0,0.0), vec3<f32>(1.0,57.0,113.0)));
  let n100 = hash11(dot(i + vec3<f32>(1.0,0.0,0.0), vec3<f32>(1.0,57.0,113.0)));
  let n010 = hash11(dot(i + vec3<f32>(0.0,1.0,0.0), vec3<f32>(1.0,57.0,113.0)));
  let n110 = hash11(dot(i + vec3<f32>(1.0,1.0,0.0), vec3<f32>(1.0,57.0,113.0)));
  let n001 = hash11(dot(i + vec3<f32>(0.0,0.0,1.0), vec3<f32>(1.0,57.0,113.0)));
  let n101 = hash11(dot(i + vec3<f32>(1.0,0.0,1.0), vec3<f32>(1.0,57.0,113.0)));
  let n011 = hash11(dot(i + vec3<f32>(0.0,1.0,1.0), vec3<f32>(1.0,57.0,113.0)));
  let n111 = hash11(dot(i + vec3<f32>(1.0,1.0,1.0), vec3<f32>(1.0,57.0,113.0)));
  let xy0 = mix(mix(n000, n100, u3.x), mix(n010, n110, u3.x), u3.y);
  let xy1 = mix(mix(n001, n101, u3.x), mix(n011, n111, u3.x), u3.y);
  return mix(xy0, xy1, u3.z) * 2.0 - 1.0;
}
fn potential(p: vec3<f32>) -> vec3<f32> {
  let s = 0.18;  // smaller s → larger spatial scale → smoother sweeps
  return vec3<f32>(
    vnoise(p * s + vec3<f32>(0.0,  0.0,  0.0)),
    vnoise(p * s + vec3<f32>(31.4, 12.7, 6.28)),
    vnoise(p * s + vec3<f32>(-7.3, 41.2, 23.1)),
  );
}
fn curlNoise(p: vec3<f32>) -> vec3<f32> {
  let e = 0.15;
  let dy_dz = potential(p + vec3<f32>(0.0, 0.0, e)).y - potential(p - vec3<f32>(0.0, 0.0, e)).y;
  let dz_dy = potential(p + vec3<f32>(0.0, e, 0.0)).z - potential(p - vec3<f32>(0.0, e, 0.0)).z;
  let dz_dx = potential(p + vec3<f32>(e, 0.0, 0.0)).z - potential(p - vec3<f32>(e, 0.0, 0.0)).z;
  let dx_dz = potential(p + vec3<f32>(0.0, 0.0, e)).x - potential(p - vec3<f32>(0.0, 0.0, e)).x;
  let dx_dy = potential(p + vec3<f32>(0.0, e, 0.0)).x - potential(p - vec3<f32>(0.0, e, 0.0)).x;
  let dy_dx = potential(p + vec3<f32>(e, 0.0, 0.0)).y - potential(p - vec3<f32>(e, 0.0, 0.0)).y;
  return vec3<f32>(dy_dz - dz_dy, dz_dx - dx_dz, dx_dy - dy_dx) / (2.0 * e);
}

// Projection — same convention as Drift.
struct Projected { clip: vec3<f32>, depth: f32 };
fn projectToClip(worldPos: vec3<f32>) -> Projected {
  let cam = cameraPos();
  let fwd = cameraForward(u.time);
  let up0 = vec3<f32>(0.0, 1.0, 0.0);
  let right = normalize(cross(up0, fwd));
  let upV = cross(fwd, right);
  let rel = worldPos - cam;
  let vx = dot(rel, right);
  let vy = dot(rel, upV);
  let vz = dot(rel, fwd);
  let focal = 1.3;
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  var out: Projected;
  if (vz <= 0.05) {
    out.clip = vec3<f32>(2.0, 2.0, 1.0);
    out.depth = -1.0;
  } else {
    out.clip = vec3<f32>(
      (vx / vz) * focal / aspect,
      (vy / vz) * focal,
      vz,
    );
    out.depth = vz;
  }
  return out;
}

// Build a camera-facing side vector for a ribbon segment.
fn ribbonSide(p0: vec3<f32>, p1: vec3<f32>) -> vec3<f32> {
  let cam = cameraPos();
  let mid = (p0 + p1) * 0.5;
  let toCam = normalize(cam - mid);
  let seg = p1 - p0;
  let segLen = length(seg);
  if (segLen < 1e-5) {
    return vec3<f32>(1.0, 0.0, 0.0);  // degenerate: arbitrary direction
  }
  let side = cross(seg / segLen, toCam);
  let sLen = length(side);
  if (sLen < 1e-5) {
    return vec3<f32>(1.0, 0.0, 0.0);
  }
  return side / sLen;
}
`;

// ── Compute module: read_write storage + audio-gated spawn ────────
const COMPUTE_BODY = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> trail: array<vec4<f32>>;

fn respawn(idx: u32, p: ptr<function, Particle>) {
  let s = f32(idx) * PHI + u.time * 0.013;
  let h = hash33(vec3<f32>(s, s + 11.3, s + 23.7));
  let cam = cameraPos();
  // Spawn point: ahead of the camera in a cylinder around +z
  let angle = h.x * TAU;
  let radius = SPAWN_RADIUS_BASE * mix(0.4, 1.4, h.y);
  let zOffset = mix(20.0, FLY_ZONE_LEN, h.z);
  let pos = vec3<f32>(cos(angle) * radius, sin(angle) * radius, cam.z + zOffset);
  (*p).pos = pos;
  (*p).vel = vec3<f32>(0.0, 0.0, -1.0) * (0.5 + h.x * 0.5);
  (*p).age = 0.0;
  // seed encodes per-ribbon randomness + serves as "alive" flag (non-zero)
  (*p).seed = 0.1 + h.y * 0.9;
}

@compute @workgroup_size(64)
fn csAdvect(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= NUM_RIBBONS) { return; }
  var p = particles[idx];

  // Dead ribbon — probabilistic respawn gated by audio. This is the
  // visible "obvious audio reactivity" — beats and bass produce
  // bursts of new ribbons bursting into existence.
  if (p.seed == 0.0) {
    let r = hash11(f32(idx) * 0.1731 + u.time * 13.7);
    // Base trickle so the field never goes empty; bass + beats add
    // big bursts. Tuned so quiet ≈ a few ribbons/sec, beats ≈
    // hundreds/sec from the 4096-pool.
    let spawnProb = (0.0008 + u.bassSlow * 0.022 + u.beatPulse * 0.10 + u.energy * 0.003) * u.ribbonSpawn;
    if (r < spawnProb) {
      respawn(idx, &p);
      // Initialize trail to all spawn position
      for (var i: u32 = 0u; i < TRAIL_LEN; i = i + 1u) {
        trail[idx * TRAIL_LEN + i] = vec4<f32>(p.pos, 0.0);
      }
    } else {
      // Stay dead; write degenerate trail (off-screen, far away)
      let dead = vec4<f32>(10000.0, 10000.0, 10000.0, -1.0);
      for (var i: u32 = 0u; i < TRAIL_LEN; i = i + 1u) {
        trail[idx * TRAIL_LEN + i] = dead;
      }
      particles[idx] = p;
      return;
    }
  }

  // Integrate position through curl-noise. vortexStrength is a user
  // tunable; bassSlow modulates turbulence (still rates, not shapes).
  let fieldP = p.pos * 0.12 + vec3<f32>(0.0, 0.0, u.time * 0.08);
  let force = curlNoise(fieldP) * (1.5 + u.vortexStrength * 0.5) * (0.6 + u.bassSlow * 0.6);

  // Forward drift: ribbons stream past the camera as it advances.
  // energy → faster current (visible velocity coupling).
  let drift = vec3<f32>(0.0, 0.0, -0.4 - u.energy * 0.5);
  let dt = clamp(u.dt, 0.0, 0.05);
  p.vel = p.vel * 0.93 + (force + drift) * dt;
  p.pos = p.pos + p.vel;
  p.age = p.age + dt;

  // Death conditions: out of range, or aged out (long lifespan so
  // ribbons fully form before they die).
  let cam = cameraPos();
  let rel = p.pos - cam;
  let outOfBox = rel.z < -12.0 || rel.z > FLY_ZONE_LEN * 1.8 || length(rel.xy) > 22.0;
  let aged = p.age > 8.0;
  if (outOfBox || aged) {
    // Kill — wait for next probabilistic respawn
    p.seed = 0.0;
    let dead = vec4<f32>(10000.0, 10000.0, 10000.0, -1.0);
    for (var i: u32 = 0u; i < TRAIL_LEN; i = i + 1u) {
      trail[idx * TRAIL_LEN + i] = dead;
    }
    particles[idx] = p;
    return;
  }

  // Shift trail history one slot back, write new head at slot 0.
  for (var i: u32 = TRAIL_LEN - 1u; i > 0u; i = i - 1u) {
    trail[idx * TRAIL_LEN + i] = trail[idx * TRAIL_LEN + i - 1u];
  }
  trail[idx * TRAIL_LEN + 0u] = vec4<f32>(p.pos, p.age);
  particles[idx] = p;
}
`;

// ── Render module: read storage + bg + ribbon quad-strip pipelines ─
const RENDER_BODY = /* wgsl */ `
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> trail: array<vec4<f32>>;

// Background — deep cosmic gradient, no audio coupling.
struct VsBg { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsBg(@builtin(vertex_index) vid: u32) -> VsBg {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsBg;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}
@fragment fn fsBg(in: VsBg) -> @location(0) vec4<f32> {
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  let p = vec2<f32>((in.uv.x * 2.0 - 1.0) * aspect, 1.0 - in.uv.y * 2.0);
  let r = length(p);
  // Slow ambient palette; brightness barely changes — audio doesn't drive bg.
  let baseHue = palette(0.10, 0.30);
  let glow = exp(-r * 1.3) * 0.15;
  let glowCol = palette(0.55, 0.85);
  var col = baseHue * 0.18 + glowCol * glow;
  // Sparse starfield — fixed pattern, not audio-driven.
  let starN = hash11(floor(in.uv.x * 900.0) + floor(in.uv.y * 900.0) * 31.13);
  if (starN > 0.9975) {
    col = col + vec3<f32>((starN - 0.9975) * 220.0);
  }
  return vec4<f32>(col, 1.0);
}

// Ribbons — camera-facing quad strip. 6 vertices per segment, drawn
// triangle-list (NO topology change between draws). Per ribbon,
// (TRAIL_LEN-1) segments. Total verts = N_RIBBONS * (TRAIL_LEN-1) * 6.
//
// Vertex decoding:
//   vid → (ribbonIdx, segIdx, cornerId in [0..5])
// Quad layout (corners around the strip):
//     2 ── 5    (=2)
//     │  ╱ │
//     │ ╱  │
//     0 ── 4
//     │  ╲ │
//     │ ╲  │
//     1 ── 3    (=4)
// Tri1: 0,1,2  Tri2: 1,4,2 → six corner ids = [0,1,2, 1,4,2]
// We index that array via cornerId.
struct VsR {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) brightness: f32,
  @location(2) crossU: f32,   // [-1..1] across ribbon width
  @location(3) litFront: f32, // diffuse term on +normal side (0..1+)
  @location(4) litBack: f32,  // diffuse term on -normal side (0..1+)
};
@vertex fn vsRibbon(@builtin(vertex_index) vid: u32) -> VsR {
  let vertsPerSeg: u32 = 6u;
  let segsPerRibbon: u32 = TRAIL_LEN - 1u;
  let vertsPerRibbon: u32 = segsPerRibbon * vertsPerSeg;
  let ribbonIdx = vid / vertsPerRibbon;
  let inRibbon  = vid % vertsPerRibbon;
  let segIdx    = inRibbon / vertsPerSeg;       // 0..segsPerRibbon-1
  let cornerId  = inRibbon % vertsPerSeg;       // 0..5

  // Lookup table for the six corners of the quad-as-two-triangles.
  // Each entry encodes (which endpoint: 0=p0 1=p1, sideSign +1/-1).
  // Tri1: (p0,+) (p0,-) (p1,+)
  // Tri2: (p0,-) (p1,-) (p1,+)
  var endpoint: u32 = 0u;
  var sideSign: f32 = 1.0;
  if      (cornerId == 0u) { endpoint = 0u; sideSign =  1.0; }
  else if (cornerId == 1u) { endpoint = 0u; sideSign = -1.0; }
  else if (cornerId == 2u) { endpoint = 1u; sideSign =  1.0; }
  else if (cornerId == 3u) { endpoint = 0u; sideSign = -1.0; }
  else if (cornerId == 4u) { endpoint = 1u; sideSign = -1.0; }
  else                     { endpoint = 1u; sideSign =  1.0; }

  let t0 = trail[ribbonIdx * TRAIL_LEN + segIdx];
  let t1 = trail[ribbonIdx * TRAIL_LEN + segIdx + 1u];

  var out: VsR;
  // Degenerate / dead ribbon → off-screen vertex.
  if (t0.w < -0.5 || t1.w < -0.5) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.brightness = 0.0;
    out.crossU = 0.0;
    out.litFront = 0.0;
    out.litBack = 0.0;
    return out;
  }

  let p0 = t0.xyz;
  let p1 = t1.xyz;
  let side = ribbonSide(p0, p1);

  // Width: user-tunable head width tapers to ~15% at tail. NO audio
  // coupling — keeps ribbon shape stable, audio drives spawn rate
  // and flow speed instead.
  let widthHead: f32 = u.ribbonWidth;
  let widthTail: f32 = u.ribbonWidth * 0.15;
  let tA = f32(segIdx) / f32(TRAIL_LEN);
  let tB = f32(segIdx + 1u) / f32(TRAIL_LEN);
  let wA = mix(widthHead, widthTail, tA);
  let wB = mix(widthHead, widthTail, tB);

  let p = select(p1, p0, endpoint == 0u);
  let w = select(wB, wA, endpoint == 0u);
  let worldCorner = p + side * (sideSign * w);
  let proj = projectToClip(worldCorner);

  if (proj.depth < 0.0) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.brightness = 0.0;
    out.crossU = 0.0;
    out.litFront = 0.0;
    out.litBack = 0.0;
    return out;
  }
  out.pos = vec4<f32>(proj.clip.x, proj.clip.y, 0.0, 1.0);

  // Color: per-ribbon hue from seed, slowly migrating with time.
  let pr = particles[ribbonIdx];
  let hueAtRibbon = fract(pr.seed * 0.73 + u.time * 0.015);
  out.color = palette(hueAtRibbon, 0.95);

  // Brightness: head bright, tail dim (along-length falloff). Depth
  // fog adds atmosphere. No audio coupling on brightness here — the
  // ribbon already feels alive from the flow.
  let alongAge = 1.0 - tA;   // 1 at head, 0 at tail
  let depth01 = clamp(1.0 - proj.depth / FLY_ZONE_LEN, 0.0, 1.0);
  out.brightness = alongAge * (0.6 + depth01 * 0.8);

  // Directional lighting. The ribbon's surface normal is perpendicular
  // to both the segment direction and the side vector. Two-sided
  // shading: litFront for sideSign>0, litBack for sideSign<0 — the
  // fragment shader picks based on its interpolated crossU sign.
  let seg = p1 - p0;
  var ribbonNormal = vec3<f32>(0.0, 0.0, 1.0);
  if (length(seg) > 1e-5) {
    let n = cross(normalize(seg), side);
    if (length(n) > 1e-5) {
      ribbonNormal = normalize(n);
    }
  }
  let lightDir = normalize(u.lightDirAndStrength.xyz);
  let lightStr = u.lightDirAndStrength.w;
  let frontDot = max(dot(ribbonNormal, lightDir), 0.0);
  let backDot  = max(dot(-ribbonNormal, lightDir), 0.0);
  // Subsurface scattering: back side gets some transmitted light too
  // (30% of front). Makes the ribbon feel translucent under back-lighting
  // rather than going pitch-black like opaque metal.
  out.litFront = u.ambient + lightStr * (frontDot + 0.30 * backDot);
  out.litBack  = u.ambient + lightStr * (backDot  + 0.30 * frontDot);

  out.crossU = sideSign;
  return out;
}
@fragment fn fsRibbon(in: VsR) -> @location(0) vec4<f32> {
  // Soft cross-section: bright core, alpha falls off at edges so the
  // ribbon doesn't look like a hard quad.
  let core = exp(-in.crossU * in.crossU * 2.2);

  // Pick front- or back-side lighting from the interpolated crossU sign.
  // (Side > 0 = "front" face = the side the cross-product normal points to.)
  let lit = select(in.litBack, in.litFront, in.crossU >= 0.0);

  // Final color is base * brightness * lighting * core. Translucency
  // raises alpha so back-ribbons remain visible through front ones
  // under glass-blend; under additive blend it just increases the
  // additive contribution (visible as a slight brightness boost).
  let col = in.color * in.brightness * lit * core * 1.2;
  let alpha = in.brightness * core * (0.6 + u.ribbonTranslucency * 0.8);
  return vec4<f32>(col, alpha);
}
`;

export function buildRibbonsWgsl(numRibbons: number, trailLen: number): {
  compute: string;
  render: string;
} {
  const header = RIBBONS_HEADER
    .replace(/\$\{NUM_RIBBONS\}/g, String(numRibbons))
    .replace(/\$\{TRAIL_LEN\}/g, String(trailLen));
  return {
    compute: header + COMPUTE_BODY,
    render:  header + RENDER_BODY,
  };
}
