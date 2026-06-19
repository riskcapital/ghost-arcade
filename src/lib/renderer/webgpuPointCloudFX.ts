/**
 * WebGPUPointCloudFX — turn a static point cloud into a living
 * TouchDesigner-style instrument.
 *
 * Loads a `.ply` or `.splat` file (positions + colors), uploads them
 * into immutable "home" buffers, then runs a per-frame compute pass
 * that pushes each point around its home under a stack of effects:
 *
 *   • Curl-noise wind — ambient swirl, always-on configurable
 *   • Bass-triggered burst — radial explosion impulse; particles
 *     fly outward from the cloud center, decay back as the impulse
 *     dies away
 *   • Treble shimmer — fine-grained position jitter
 *   • Proximity wave — an animated "field sphere" orbits through
 *     the cloud, pushing nearby points outward as it passes (smooth
 *     radial falloff from the sphere center)
 *   • Anchor pull — yanks each point back toward its home; the
 *     amplitude trades chaos vs. legibility
 *   • Color treatments — hue shift, saturation, brightness
 *   • Dissolve radius — alpha=0 for points outside the radial bound;
 *     sweep the radius in/out for wipes
 *
 * Render pass has three topology modes:
 *   • Points — classic billboard sprites, soft disc falloff
 *   • Billboards — same as points but larger / blurrier
 *   • Worm Strokes — quads extruded along each point's velocity
 *     vector. Same trick as the flythrough shader — gives the
 *     volumetric brush-stroke look as the cloud breathes / bursts.
 *
 * Storage layout (per-point), two buffers:
 *
 *   HOME (32 bytes, immutable after load):
 *     homePos:   vec3<f32>  (12)
 *     _pad0:     f32        (4)
 *     homeColor: vec3<f32>  (12)
 *     _pad1:     f32        (4)
 *
 *   LIVE (48 bytes, compute-shader write-target):
 *     pos:   vec3<f32>  (12)
 *     alpha: f32        (4)
 *     vel:   vec3<f32>  (12)
 *     size:  f32        (4)
 *     color: vec3<f32>  (12)
 *     _pad:  f32        (4)
 *
 * Total: 80 bytes per point. 250K points (default) = 20MB; 1M points
 * = 80MB. Within budget on any modern GPU.
 *
 * Loading: the host calls `setPointCloudData(positions, colors)` with
 * Float32Array (XYZ × N) + Float32Array (RGB × N, in 0..1). The
 * renderer (re)allocates buffers, normalizes positions into a unit
 * cube around the cloud's centroid, and writeBuffer's the data. After
 * that the first frame renders immediately.
 */

const HOME_BYTES = 32;
const LIVE_BYTES = 48;
const MAX_POINTS = 4_000_000;
const DEFAULT_POINT_SIZE = 0.006;

type Topology = 'points' | 'billboards' | 'strokes';

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

/* ============================================================== */
/* COMPUTE — per-point effects                                    */
/* ============================================================== */
const COMPUTE_WGSL = /* wgsl */ `
struct Home {
  homePos:   vec3<f32>,
  _pad0:     f32,
  homeColor: vec3<f32>,
  _pad1:     f32,
};

struct Live {
  pos:   vec3<f32>,
  alpha: f32,
  vel:   vec3<f32>,
  size:  f32,
  color: vec3<f32>,
  _pad:  f32,
};

// Compute-pass uniform. Layout intentionally packed in 16-byte
// blocks so the JS-side writeBuffer math is one float[] write rather
// than a dance of typed-array views. See encodeFrame() for the
// matching CPU-side offsets.
struct U {
  // Block 0 — core timing + size (16 bytes)
  dt:                f32,
  time:              f32,
  pointCount:        u32,
  baseSize:          f32,
  // Block 1 — motion (curl wind + anchor pull + damping)
  windStrength:      f32,
  windScale:         f32,
  anchorPull:        f32,
  damping:           f32,
  // Block 2 — audio
  bass:              f32,
  treble:            f32,
  burstImpulse:      f32,
  shimmerStrength:   f32,
  // Block 3 — proximity wave center + radius
  waveCenter:        vec3<f32>,
  waveRadius:        f32,
  // Block 4 — wave + twist + voxel mix
  waveStrength:      f32,
  waveFalloff:       f32,
  twistAmount:       f32,    // height-based Y-axis torsion (radians per unit Y)
  voxelSize:         f32,    // grid cell size for voxel snapping
  // Block 5 — voxel + dissolve + hue
  voxelMix:          f32,    // 0 = no snap, 1 = full snap
  dissolveRadius:    f32,
  dissolveSoftness:  f32,
  hueShift:          f32,
  // Block 6 — color basics
  saturation:        f32,
  brightness:        f32,
  colorMode:         u32,    // 0=source 1=solid 2=grad2 3=grad3 4=palette4 5=rainbow 6=random
  colorMap:          u32,    // 0=index 1=depth-z 2=depth-cam 3=radial 4=y-axis 5=luminance 6=noise
  // Block 7 — color mix + map shaping
  colorMix:          f32,    // 0 = source color, 1 = pure custom
  colorMapScale:     f32,    // expand/compress the mapping range
  colorMapOffset:    f32,    // shift the mapping
  colorCycleOffset:  f32,    // animated phase for rainbow / palette cycling
  // Block 8 — random-hue params
  randomSat:         f32,
  randomVal:         f32,
  filterMode:        u32,    // 0=none 1=drift 2=swarm 3=slice 4=contour 5=rift 6=prism 7=fog
  filterAxis:        u32,    // 0=x 1=y 2=z 3=radial
  // Blocks 9-12 — palette colors (vec3 + 4 bytes pad each)
  colorA:            vec3<f32>,
  _padA:             f32,
  colorB:            vec3<f32>,
  _padB:             f32,
  colorC:            vec3<f32>,
  _padC:             f32,
  colorD:            vec3<f32>,
  _padD:             f32,
  // Blocks 13-15 — Signal-loss style gesture layer
  filterAmount:      f32,
  filterSpeed:       f32,
  filterPhase:       f32,
  filterWidth:       f32,
  filterSoftness:    f32,
  contourBands:      f32,
  fogDensity:        f32,
  fogOpacity:        f32,
  fogColor:          vec3<f32>,
  _padFog:           f32,
};

@group(0) @binding(0) var<storage, read>       home: array<Home>;
@group(0) @binding(1) var<storage, read_write> live: array<Live>;
@group(0) @binding(2) var<uniform>             u:    U;

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

// Divergence-free flow via curl of a vector noise potential. Same
// pattern as the flythrough shader — gives smooth swirly motion that
// reads as wind through the cloud rather than chaotic noise.
fn curl(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = noise3(p + vec3<f32>(0.0,  e, 0.0) + vec3<f32>(0.0, 0.0, 11.0));
  let ax2 = noise3(p + vec3<f32>(0.0, -e, 0.0) + vec3<f32>(0.0, 0.0, 11.0));
  let ay1 = noise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = noise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let bx1 = noise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(0.0, 0.0, 11.0));
  let bx2 = noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(0.0, 0.0, 11.0));
  let by1 = noise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(31.0, 0.0, 0.0));
  let by2 = noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(31.0, 0.0, 0.0));
  let bz1 = noise3(p + vec3<f32>(0.0,  e, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let bz2 = noise3(p + vec3<f32>(0.0, -e, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let cx = (ax1 - ax2) - (bx1 - bx2);
  let cy = (ay1 - ay2) - (by1 - by2);
  let cz = (az1 - az2) - (bz1 - bz2);
  return vec3<f32>(cx, cy, cz) / (2.0 * e);
}

fn axisValue(p: vec3<f32>, axis: u32) -> f32 {
  if (axis == 0u) { return p.x; }
  if (axis == 1u) { return p.y; }
  if (axis == 2u) { return p.z; }
  return length(p);
}

fn axisNormal(axis: u32, p: vec3<f32>) -> vec3<f32> {
  if (axis == 0u) { return vec3<f32>(1.0, 0.0, 0.0); }
  if (axis == 1u) { return vec3<f32>(0.0, 1.0, 0.0); }
  if (axis == 2u) { return vec3<f32>(0.0, 0.0, 1.0); }
  return normalize(p + vec3<f32>(1e-5, 0.0, 0.0));
}

// HSV ↔ RGB helpers for the hue-shift / saturation pass.
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  var p: vec4<f32>;
  if (c.g < c.b) {
    p = vec4<f32>(c.b, c.g, K.w, K.z);
  } else {
    p = vec4<f32>(c.g, c.b, K.x, K.y);
  }
  var q: vec4<f32>;
  if (c.r < p.x) {
    q = vec4<f32>(p.x, p.y, p.w, c.r);
  } else {
    q = vec4<f32>(c.r, p.y, p.z, p.x);
  }
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// ── Color helpers ────────────────────────────────────────────────
// 't' is the mapping value 0..1 from the chosen colorMap. Picking
// a color from each mode is a single switch on u.colorMode.
// (Note: backticks intentionally avoided here — this WGSL string is
// a JS template literal and any backtick would terminate it early.)
fn paletteColor(t: f32, i: u32) -> vec3<f32> {
  // Mode 1 — solid
  if (u.colorMode == 1u) { return u.colorA; }
  // Mode 2 — 2-stop gradient
  if (u.colorMode == 2u) { return mix(u.colorA, u.colorB, t); }
  // Mode 3 — 3-stop gradient
  if (u.colorMode == 3u) {
    if (t < 0.5) { return mix(u.colorA, u.colorB, t * 2.0); }
    return mix(u.colorB, u.colorC, (t - 0.5) * 2.0);
  }
  // Mode 4 — 4-color palette, smooth blend across the range
  if (u.colorMode == 4u) {
    let s = t * 3.0;
    if (s < 1.0) { return mix(u.colorA, u.colorB, s); }
    if (s < 2.0) { return mix(u.colorB, u.colorC, s - 1.0); }
    return mix(u.colorC, u.colorD, s - 2.0);
  }
  // Mode 5 — rainbow cycle; colorCycleOffset animates the phase
  if (u.colorMode == 5u) {
    let phase = fract(t + u.colorCycleOffset);
    return hsv2rgb(vec3<f32>(phase, 1.0, 1.0));
  }
  // Mode 6 — random per-particle hue; deterministic so a given
  // particle keeps the same color across frames (stable look)
  if (u.colorMode == 6u) {
    let hue = hash3(vec3<f32>(f32(i) * 0.317, 13.0, 91.0));
    return hsv2rgb(vec3<f32>(fract(hue + u.colorCycleOffset), u.randomSat, u.randomVal));
  }
  // Mode 0 — source (return zero; caller falls back to homeColor)
  return vec3<f32>(0.0);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.pointCount) { return; }
  let h = home[i];
  var l = live[i];

  // ── Effective home position (twist + voxel snap) ───────────────
  // Both effects modify the "home" target the anchor pull reaches
  // for, rather than directly displacing the live position. Lets
  // the particle motion (wind, burst, shimmer) continue to work on
  // top of a deformed cloud rather than fighting it.
  var effHome = h.homePos;
  // Twist — rotate XZ around Y by an angle proportional to Y. Gives
  // a candy-twist look; pair with auto-rotate Y for hypnotic spirals.
  let twistAngle = u.twistAmount * h.homePos.y;
  let cT = cos(twistAngle);
  let sT = sin(twistAngle);
  effHome = vec3<f32>(
    h.homePos.x * cT - h.homePos.z * sT,
    h.homePos.y,
    h.homePos.x * sT + h.homePos.z * cT,
  );
  // Voxel snap — quantize home to a 3D grid. voxelMix=0 disables;
  // voxelMix=1 fully snaps. Mix linearly so users can crossfade.
  if (u.voxelMix > 0.0 && u.voxelSize > 0.0001) {
    let snapped = round(effHome / u.voxelSize) * u.voxelSize;
    effHome = mix(effHome, snapped, u.voxelMix);
  }

  // Gesture layer — named destructive/reconstructive looks inspired
  // by photo point-cloud tools, but implemented as parametric GPU
  // transforms so they remain performable and keyframeable.
  let gesturePhase = u.filterPhase + u.time * u.filterSpeed;
  let scanCenter = sin(gesturePhase * 6.2831853) * 0.85;
  let axisVal = axisValue(effHome, u.filterAxis);
  let axisN = axisNormal(u.filterAxis, effHome);
  let amount = u.filterAmount;
  if (u.filterMode == 1u) {
    // DRIFT — slow procedural displacement of the home field, so the
    // cloud breathes without losing its silhouette.
    let drift = curl(effHome * (0.65 + u.windScale * 0.35) + vec3<f32>(0.0, gesturePhase * 0.25, 9.7));
    effHome = effHome + drift * amount * 0.12;
  } else if (u.filterMode == 5u) {
    // RIFT — split across a moving plane and shear the two sides in
    // opposite directions. Width controls the tear zone.
    let plane = axisVal - scanCenter * 0.5;
    let side = select(-1.0, 1.0, plane >= 0.0);
    let tear = 1.0 - exp(-abs(plane) / max(u.filterWidth, 0.01));
    let tangent = normalize(cross(axisN, vec3<f32>(0.0, 1.0, 0.37)) + vec3<f32>(1e-4, 0.0, 0.0));
    effHome = effHome + (axisN * side * 0.32 + tangent * sin(axisVal * 8.0 + gesturePhase * 6.2831853) * 0.14) * amount * tear;
  } else if (u.filterMode == 6u) {
    // PRISM — chromatic scatter. Points fan apart by source color and
    // depth, giving a refracted, impossible-camera read.
    let lum = dot(h.homeColor, vec3<f32>(0.299, 0.587, 0.114));
    let chroma = h.homeColor - vec3<f32>(lum);
    let prismDir = normalize(vec3<f32>(chroma.r - chroma.b, chroma.g - chroma.r, chroma.b - chroma.g) + axisN * 0.35);
    effHome = effHome + prismDir * amount * (0.04 + 0.22 * abs(axisVal));
  }

  // ── Position update ────────────────────────────────────────────
  // Velocity = curl wind + bass burst + proximity wave + treble shimmer,
  // damped each frame so things settle when the audio drops.
  let pSample = effHome * u.windScale + vec3<f32>(0.0, 0.0, u.time * 0.1);
  let windV   = curl(pSample) * u.windStrength;

  // Bass burst — radial outward impulse from the cloud center.
  let outward = normalize(effHome + vec3<f32>(1e-5, 0.0, 0.0));
  let burstV  = outward * u.burstImpulse;

  // Proximity wave — a moving sphere pushes points radially outward
  // from its center, with a smooth falloff at its surface.
  let toPoint = l.pos - u.waveCenter;
  let d       = length(toPoint);
  let r       = u.waveRadius;
  let shellW  = max(u.waveFalloff, 1e-3);
  let bandT   = clamp(1.0 - abs(d - r) / shellW, 0.0, 1.0);
  let waveV   = select(vec3<f32>(0.0), normalize(toPoint) * u.waveStrength * bandT, d > 1e-4);

  // Treble shimmer — small random per-point jitter scaled by treble.
  let jitterMag = u.shimmerStrength * u.treble;
  let jx = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 0.0)) - 0.5) * 2.0;
  let jy = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 1.0)) - 0.5) * 2.0;
  let jz = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 2.0)) - 0.5) * 2.0;
  let shimmerV = vec3<f32>(jx, jy, jz) * jitterMag;

  var gestureV = vec3<f32>(0.0);
  if (u.filterMode == 2u) {
    // SWARM — autonomous local steering around each point's home.
    // Bass opens the flock; anchorPull still decides how fast it
    // regroups.
    let seed = hash3(vec3<f32>(f32(i) * 0.019, 31.0, 7.0));
    let localCurl = curl(l.pos * (2.0 + u.windScale) + vec3<f32>(seed * 9.0, gesturePhase, -seed * 4.0));
    let orbit = normalize(cross(outward, vec3<f32>(0.17 + seed, 0.81, 0.43)) + vec3<f32>(1e-4, 0.0, 0.0));
    gestureV = (localCurl * 0.55 + orbit * sin(gesturePhase * 6.2831853 + seed * 6.2831853) * 0.35) * amount * (0.45 + u.bass * 1.25);
  }

  // Anchor pull — yank toward the EFFECTIVE home (twisted + voxeled).
  let pullV = (effHome - l.pos) * u.anchorPull;

  // Integrate.
  let targetVel = windV + burstV + waveV + shimmerV + gestureV + pullV;
  l.vel = mix(l.vel, targetVel, clamp(u.dt * 6.0, 0.0, 1.0));
  l.pos = l.pos + l.vel * u.dt;
  l.vel = l.vel * (1.0 - u.damping * u.dt);

  // ── Color update ───────────────────────────────────────────────
  // 1. Compute the mapping value 't' in [0,1] based on the chosen map.
  //    The map drives where each particle samples from the palette /
  //    gradient. Different maps give different aesthetics:
  //      index    — multi-color worms (particle id → palette position)
  //      depth-z  — classic depth gradient (back/front color)
  //      radial   — bullseye coloring from cloud center
  //      y-axis   — vertical gradient (sunset/sky)
  //      luminance— preserves source contrast as the palette key
  //      noise    — organic patches of color
  var t: f32 = 0.0;
  if (u.colorMap == 0u) {
    t = f32(i) / max(f32(u.pointCount), 1.0);
  } else if (u.colorMap == 1u) {
    t = effHome.z * 0.5 + 0.5;
  } else if (u.colorMap == 2u) {
    // depth-from-camera — we don't have view-space here without an
    // extra uniform, so approximate with negative Z (matches our
    // camera-looking-down-+Z convention).
    t = -effHome.z * 0.5 + 0.5;
  } else if (u.colorMap == 3u) {
    t = clamp(length(effHome), 0.0, 1.0);
  } else if (u.colorMap == 4u) {
    t = effHome.y * 0.5 + 0.5;
  } else if (u.colorMap == 5u) {
    t = dot(h.homeColor, vec3<f32>(0.299, 0.587, 0.114));
  } else if (u.colorMap == 6u) {
    t = noise3(effHome * 3.0 + vec3<f32>(0.0, 0.0, u.time * 0.2)) * 0.5 + 0.5;
  }
  // Reshape — scale + offset, then clamp.
  t = clamp(t * u.colorMapScale + u.colorMapOffset, 0.0, 1.0);
  if (u.filterMode == 4u) {
    let bands = max(u.contourBands, 2.0);
    t = floor(t * bands) / max(bands - 1.0, 1.0);
  } else if (u.filterMode == 6u) {
    t = fract(t + axisVal * 0.18 + gesturePhase * 0.12);
  }

  // 2. Get the mode color (or source if mode 0). Blend with source by
  //    colorMix — useful for tinting source colors without losing them.
  var paletteC = paletteColor(t, i);
  if (u.colorMode == 0u) { paletteC = h.homeColor; }
  var c = mix(h.homeColor, paletteC, u.colorMix);

  // 3. Apply global HSV adjustments on top (hue shift, sat, bright).
  var hsv = rgb2hsv(c);
  hsv.x = fract(hsv.x + u.hueShift);
  hsv.y = clamp(hsv.y * u.saturation, 0.0, 2.0);
  hsv.z = clamp(hsv.z * u.brightness, 0.0, 4.0);
  l.color = hsv2rgb(hsv);

  // ── Size pulse ─────────────────────────────────────────────────
  var sizeBoost = 1.0 + u.bass * 1.2;
  if (u.filterMode == 4u) {
    let bands = max(u.contourBands, 2.0);
    let stripe = abs(fract((axisValue(effHome, u.filterAxis) * 0.5 + 0.5) * bands + gesturePhase) - 0.5) * 2.0;
    sizeBoost = sizeBoost * mix(1.8, 0.55, smoothstep(0.0, 0.28, stripe));
  }
  l.size = u.baseSize * sizeBoost;

  // ── Dissolve ───────────────────────────────────────────────────
  let distFromCenter = length(h.homePos);
  let softness = max(u.dissolveSoftness, 1e-4);
  let dissolveAlpha = 1.0 - smoothstep(u.dissolveRadius, u.dissolveRadius + softness, distFromCenter);
  var gestureAlpha = 1.0;
  if (u.filterMode == 3u) {
    let planeDist = abs(axisValue(effHome, u.filterAxis) - scanCenter);
    gestureAlpha = 1.0 - smoothstep(max(u.filterWidth, 0.001), max(u.filterWidth + u.filterSoftness, 0.002), planeDist);
  } else if (u.filterMode == 4u) {
    let bands = max(u.contourBands, 2.0);
    let stripe = abs(fract((axisValue(effHome, u.filterAxis) * 0.5 + 0.5) * bands + gesturePhase) - 0.5) * 2.0;
    gestureAlpha = mix(0.3, 1.0, 1.0 - smoothstep(0.0, max(u.filterSoftness, 0.02), stripe));
  }
  l.alpha = clamp(dissolveAlpha * gestureAlpha, 0.0, 1.0);

  live[i] = l;
}
`;

/* ============================================================== */
/* RENDER — instanced quads, three topologies                     */
/* ============================================================== */
const RENDER_WGSL = /* wgsl */ `
struct Live {
  pos:   vec3<f32>,
  alpha: f32,
  vel:   vec3<f32>,
  size:  f32,
  color: vec3<f32>,
  _pad:  f32,
};

struct U {
  viewProj:     mat4x4<f32>,
  camRight:     vec3<f32>,
  _pad0:        f32,
  camUp:        vec3<f32>,
  _pad1:        f32,
  topology:     u32,        // 0=points, 1=billboards, 2=strokes
  strokeLength: f32,
  strokeWidth:  f32,
  opacity:      f32,
  pointCount:   u32,
  _pad2:        f32,
  _pad3:        f32,
  _pad4:        f32,
  fogColor:     vec3<f32>,
  fogOpacity:   f32,
  fogDensity:   f32,
  _pad5:        f32,
  _pad6:        f32,
  _pad7:        f32,
};

@group(0) @binding(0) var<storage, read> live: array<Live>;
@group(0) @binding(1) var<uniform>       u:    U;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,
  @location(1) color:     vec3<f32>,
  @location(2) alpha:     f32,
  @location(3) depth01:   f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = live[iid];

  var cornerUV: vec2<f32> = vec2<f32>(0.0, 0.0);
  var offset:   vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

  if (u.topology == 2u) {
    // STROKES — quad extruded along velocity vector.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0,  1.0),
      vec2<f32>(0.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x, q.y * 0.5 + 0.5);

    let speed = length(p.vel);
    let dir = select(vec3<f32>(1.0, 0.0, 0.0), p.vel / max(speed, 1e-4), speed > 1e-4);
    let camFwd = normalize(cross(u.camRight, u.camUp));
    var perp = normalize(cross(dir, camFwd));
    if (length(perp) < 1e-3) {
      perp = normalize(cross(dir, u.camUp));
    }
    offset = -dir * (q.x * u.strokeLength) + perp * (q.y * u.strokeWidth * 0.5);
  } else {
    // POINTS / BILLBOARDS — quad facing the camera.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5);
    // billboards are 2× bigger than points
    let sizeMul = select(1.0, 2.0, u.topology == 1u);
    offset = u.camRight * (q.x * p.size * sizeMul) + u.camUp * (q.y * p.size * sizeMul);
  }

  var out: VSOut;
  out.pos    = u.viewProj * vec4<f32>(p.pos + offset, 1.0);
  out.uv     = cornerUV;
  out.color  = p.color;
  out.alpha  = p.alpha * u.opacity;
  out.depth01 = clamp(out.pos.z / max(out.pos.w, 1e-5) * 0.5 + 0.5, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var mask: f32 = 1.0;
  if (u.topology == 2u) {
    // Stroke taper — alpha drops along x (head→tail), pinches at the
    // perpendicular edges (y).
    let headTail = 1.0 - in.uv.x;
    let perp     = 1.0 - abs(in.uv.y - 0.5) * 2.0;
    mask = headTail * smoothstep(0.0, 0.4, perp);
  } else if (u.topology == 1u) {
    // Billboard — soft gaussian-ish disc
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0;
    mask = exp(-d * d * 3.0);
  } else {
    // Point — tighter soft disc
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0;
    mask = smoothstep(1.0, 0.2, d);
  }
  let a = in.alpha * mask;
  let fogT = clamp((1.0 - exp(-in.depth01 * max(u.fogDensity, 0.0) * 4.0)) * u.fogOpacity, 0.0, 1.0);
  let color = mix(in.color, u.fogColor, fogT);
  return vec4<f32>(color * a, a);
}
`;

/* ============================================================== */
/* TYPESCRIPT WRAPPER                                              */
/* ============================================================== */

export type ColorMode = 'source' | 'solid' | 'gradient2' | 'gradient3' | 'palette4' | 'rainbow' | 'random';
export type ColorMap  = 'index' | 'depth-z' | 'depth-cam' | 'radial' | 'y-axis' | 'luminance' | 'noise';
export type PointCloudFilterMode = 'none' | 'drift' | 'swarm' | 'slice' | 'contour' | 'rift' | 'prism' | 'fog';
export type PointCloudFilterAxis = 'x' | 'y' | 'z' | 'radial';

// Color mode + map enum strings → shader u32 IDs. Stays in lockstep
// with the WGSL switch ladders in `paletteColor` and `cs_main`.
const COLOR_MODE_ID: Record<ColorMode, number> = {
  'source': 0, 'solid': 1, 'gradient2': 2, 'gradient3': 3,
  'palette4': 4, 'rainbow': 5, 'random': 6,
};
const COLOR_MAP_ID: Record<ColorMap, number> = {
  'index': 0, 'depth-z': 1, 'depth-cam': 2, 'radial': 3,
  'y-axis': 4, 'luminance': 5, 'noise': 6,
};
const FILTER_MODE_ID: Record<PointCloudFilterMode, number> = {
  none: 0, drift: 1, swarm: 2, slice: 3, contour: 4, rift: 5, prism: 6, fog: 7,
};
const FILTER_AXIS_ID: Record<PointCloudFilterAxis, number> = {
  x: 0, y: 1, z: 2, radial: 3,
};

export interface PointCloudFXParams {
  topology: Topology;
  pointSize: number;
  opacity: number;
  // motion
  windStrength: number;
  windScale: number;
  anchorPull: number;
  damping: number;
  twistAmount: number;
  voxelMix: number;
  voxelSize: number;
  // audio impulses (raw values; renderer maintains the burst accumulator)
  bass: number;
  treble: number;
  shimmerStrength: number;
  burstGain: number;
  burstDecay: number;
  // proximity wave
  waveEnabled: boolean;
  waveSpeed: number;
  waveOrbitRadius: number;
  waveRadius: number;
  waveFalloff: number;
  waveStrength: number;
  // color — basic HSV adjustments applied AFTER the mode (legacy)
  hueShiftSpeed: number;
  saturation: number;
  brightness: number;
  // color — mode + map driving the palette lookup
  colorMode: ColorMode;
  colorMap: ColorMap;
  colorMix: number;          // 0 = pure source, 1 = pure custom
  colorMapScale: number;
  colorMapOffset: number;
  colorCycleSpeed: number;   // radians/sec of the rainbow / palette animation
  randomSat: number;         // 0..1 saturation for `random` mode
  randomVal: number;         // 0..2 value (brightness) for `random` mode
  // signal-loss-style gesture layer
  filterMode: PointCloudFilterMode;
  filterAxis: PointCloudFilterAxis;
  filterAmount: number;
  filterSpeed: number;
  filterPhase: number;
  filterWidth: number;
  filterSoftness: number;
  contourBands: number;
  fogDensity: number;
  fogOpacity: number;
  fogColor: [number, number, number];
  // color stops (RGB tuples in 0..1 — wrapper converts the panel's 0-255 ints)
  colorA: [number, number, number];
  colorB: [number, number, number];
  colorC: [number, number, number];
  colorD: [number, number, number];
  // dissolve
  dissolveRadius: number;
  dissolveSoftness: number;
  // stroke params (only used when topology = strokes)
  strokeLength: number;
  strokeWidth: number;
  // camera
  fovDeg: number;
  cameraZ: number;
  // object rotation (in degrees; positive = standard right-hand sense
  // around each axis). Applied around the cloud's center (which is
  // the world origin after the centroid-normalization in
  // setPointCloudData). XYZ-Euler order: Rz * Ry * Rx.
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  // auto-rotation per axis in degrees/sec — combines additively with
  // the static rotateX/Y/Z, so you can offset the start pose and
  // also spin continuously.
  autoRotateX: number;
  autoRotateY: number;
  autoRotateZ: number;
}

const DEFAULT_PARAMS: PointCloudFXParams = {
  topology: 'points',
  pointSize: DEFAULT_POINT_SIZE,
  opacity: 1.0,
  windStrength: 0.05,
  windScale: 1.0,
  anchorPull: 2.0,
  damping: 0.8,
  twistAmount: 0,
  voxelMix: 0,
  voxelSize: 0.1,
  bass: 0, treble: 0,
  shimmerStrength: 0.02,
  burstGain: 0.6,
  burstDecay: 2.5,
  waveEnabled: true,
  waveSpeed: 0.6,
  waveOrbitRadius: 0.8,
  waveRadius: 0.3,
  waveFalloff: 0.2,
  waveStrength: 0.8,
  hueShiftSpeed: 0.05,
  saturation: 1.0,
  brightness: 1.0,
  colorMode: 'source',
  colorMap: 'index',
  colorMix: 1.0,
  colorMapScale: 1.0,
  colorMapOffset: 0.0,
  colorCycleSpeed: 0.0,
  randomSat: 0.85,
  randomVal: 1.0,
  filterMode: 'none',
  filterAxis: 'z',
  filterAmount: 0.75,
  filterSpeed: 0.2,
  filterPhase: 0.0,
  filterWidth: 0.18,
  filterSoftness: 0.08,
  contourBands: 12,
  fogDensity: 0.0,
  fogOpacity: 0.0,
  fogColor: [0.02, 0.025, 0.035],
  // Default palette: cool neon spectrum that immediately reads as
  // "multi-colored worms" the moment users pick gradient2/3 or
  // palette4 + topology=strokes.
  colorA: [0.24, 0.39, 0.94],  // deep blue
  colorB: [0.94, 0.24, 0.71],  // hot pink
  colorC: [1.00, 0.78, 0.12],  // gold
  colorD: [0.16, 0.86, 0.86],  // cyan
  dissolveRadius: 10.0,
  dissolveSoftness: 0.05,
  strokeLength: 0.04,
  strokeWidth: 0.004,
  fovDeg: 50,
  cameraZ: 2.5,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  autoRotateX: 0,
  autoRotateY: 8,   // gentle Y spin out of the box so the cloud feels alive
  autoRotateZ: 0,
};

const BLEND_PREMULT_OVER: any = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export class WebGPUPointCloudFX {
  private device: any;
  private presentFormat: any;

  private homeBuffer: any = null;
  private liveBuffer: any = null;
  private computeUniformBuffer: any;
  private renderUniformBuffer: any;
  private computePipeline: any;
  private renderPipeline: any;
  private computeBindGroupLayout: any;
  private renderBindGroupLayout: any;
  private computeBindGroup: any = null;
  private renderBindGroup: any = null;

  private pointCount = 0;
  private viewportW = 1920;
  private viewportH = 1080;
  private prevFrameTime = 0;
  private params: PointCloudFXParams = { ...DEFAULT_PARAMS };

  // Effect accumulators driven on the CPU side:
  //  - hueShiftPhase advances at hueShiftSpeed * dt every frame
  //  - colorCyclePhase advances at colorCycleSpeed * dt (drives the
  //    rainbow + random hue animation independently from hueShift)
  //  - burstImpulse spikes on bass hits, decays per-second by burstDecay
  //  - waveTime drives the proximity sphere's orbit angle
  //  - autoRot{X,Y,Z}Phase each accumulate if their auto-rotate
  //    speed is non-zero (in degrees, since the user-facing knob is
  //    "degrees per second")
  private hueShiftPhase = 0;
  private colorCyclePhase = 0;
  private burstImpulse = 0;
  private prevBass = 0;
  private waveTime = 0;
  private autoRotXPhase = 0;
  private autoRotYPhase = 0;
  private autoRotZPhase = 0;

  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.init();
  }

  private init(): void {
    this.computeUniformBuffer = this.device.createBuffer({
      // 9 16-byte blocks for core params + 4 palette blocks +
      // 3 gesture/filter blocks = 16 × 16 = 256 bytes. Round to 288
      // for headroom and backwards safety while iterating.
      size: 288,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderUniformBuffer = this.device.createBuffer({
      size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const computeModule = this.device.createShaderModule({ code: COMPUTE_WGSL });
    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    const renderModule = this.device.createShaderModule({ code: RENDER_WGSL });
    this.renderBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX,   buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderBindGroupLayout] }),
      vertex:   { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** Replace the cloud's geometry. `positions` is a Float32Array of
   *  3N XYZ values in any coordinate frame; `colors` is a Float32Array
   *  of 3N RGB values in 0..1. Both arrays must have the same point
   *  count. The renderer normalizes positions into a unit-ish cube
   *  centered at the origin so the camera framing works regardless
   *  of the source's scale (Gaussian splats arrive in millimeters,
   *  PLY scans in meters, etc.). */
  setPointCloudData(positions: Float32Array, colors: Float32Array): void {
    const n = Math.min(MAX_POINTS, Math.floor(Math.min(positions.length / 3, colors.length / 3)));
    if (n === 0) return;

    // ── Compute centroid + bounding extent for normalization ───
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += positions[i * 3 + 0];
      cy += positions[i * 3 + 1];
      cz += positions[i * 3 + 2];
    }
    cx /= n; cy /= n; cz /= n;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const dx = positions[i * 3 + 0] - cx;
      const dy = positions[i * 3 + 1] - cy;
      const dz = positions[i * 3 + 2] - cz;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r > maxR) maxR = r;
    }
    const scale = maxR > 0 ? 0.9 / maxR : 1.0;

    // ── Build the home buffer (32 bytes/point) ─────────────────
    const homeBytes = new ArrayBuffer(n * HOME_BYTES);
    const homeF = new Float32Array(homeBytes);
    for (let i = 0; i < n; i++) {
      const off = i * 8;  // 32 bytes / 4 = 8 floats
      homeF[off + 0] = (positions[i * 3 + 0] - cx) * scale;
      homeF[off + 1] = (positions[i * 3 + 1] - cy) * scale;
      homeF[off + 2] = (positions[i * 3 + 2] - cz) * scale;
      homeF[off + 3] = 0;
      homeF[off + 4] = colors[i * 3 + 0];
      homeF[off + 5] = colors[i * 3 + 1];
      homeF[off + 6] = colors[i * 3 + 2];
      homeF[off + 7] = 0;
    }

    // ── Build the live buffer seed (initial = home) ────────────
    // alpha=1, vel=0, size=baseSize, color=homeColor
    const liveBytes = new ArrayBuffer(n * LIVE_BYTES);
    const liveF = new Float32Array(liveBytes);
    for (let i = 0; i < n; i++) {
      const off = i * 12;  // 48 bytes / 4 = 12 floats
      liveF[off + 0] = homeF[i * 8 + 0];  // pos.x
      liveF[off + 1] = homeF[i * 8 + 1];  // pos.y
      liveF[off + 2] = homeF[i * 8 + 2];  // pos.z
      liveF[off + 3] = 1.0;               // alpha
      liveF[off + 4] = 0;                 // vel.x
      liveF[off + 5] = 0;                 // vel.y
      liveF[off + 6] = 0;                 // vel.z
      liveF[off + 7] = this.params.pointSize;  // size
      liveF[off + 8] = homeF[i * 8 + 4];  // color.r
      liveF[off + 9] = homeF[i * 8 + 5];  // color.g
      liveF[off + 10] = homeF[i * 8 + 6]; // color.b
      liveF[off + 11] = 0;
    }

    // ── (Re)allocate buffers at the right size ─────────────────
    try { this.homeBuffer?.destroy?.(); } catch { /* */ }
    try { this.liveBuffer?.destroy?.(); } catch { /* */ }
    this.homeBuffer = this.device.createBuffer({
      size: n * HOME_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.liveBuffer = this.device.createBuffer({
      size: n * LIVE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.homeBuffer, 0, homeBytes);
    this.device.queue.writeBuffer(this.liveBuffer, 0, liveBytes);

    // Bind groups capture buffer handles — re-create them.
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.homeBuffer } },
        { binding: 1, resource: { buffer: this.liveBuffer } },
        { binding: 2, resource: { buffer: this.computeUniformBuffer } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.liveBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
      ],
    });

    this.pointCount = n;
    console.log('[pointcloud-fx] loaded', n, 'points (normalized to unit cube; src scale =', scale.toFixed(4), ')');
  }

  setParams(p: Partial<PointCloudFXParams>): void {
    this.params = { ...this.params, ...p };
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
  }

  encodeFrame(encoder: any, targetView: any): void {
    if (!this.pointCount || !this.homeBuffer || !this.liveBuffer) return;

    const now = performance.now() / 1000;
    let dt = this.prevFrameTime === 0 ? 1 / 60 : (now - this.prevFrameTime);
    dt = Math.min(Math.max(dt, 0.001), 1 / 15);
    this.prevFrameTime = now;

    // ── CPU-side effect accumulators ───────────────────────────
    this.hueShiftPhase += this.params.hueShiftSpeed * dt;
    if (this.hueShiftPhase > 1) this.hueShiftPhase -= Math.floor(this.hueShiftPhase);
    if (this.hueShiftPhase < 0) this.hueShiftPhase -= Math.floor(this.hueShiftPhase);
    this.colorCyclePhase += this.params.colorCycleSpeed * dt;
    if (this.colorCyclePhase > 1) this.colorCyclePhase -= Math.floor(this.colorCyclePhase);
    if (this.colorCyclePhase < 0) this.colorCyclePhase -= Math.floor(this.colorCyclePhase);

    // Bass burst — detect rising edge of bass, spike the impulse,
    // decay exponentially. Constant bass keeps a steady push; only
    // ramping bass spawns new bursts.
    const bassDelta = Math.max(0, this.params.bass - this.prevBass);
    if (bassDelta > 0.04) {
      this.burstImpulse += bassDelta * this.params.burstGain * 8;
    }
    this.burstImpulse = Math.max(0, this.burstImpulse - this.burstImpulse * this.params.burstDecay * dt);
    this.prevBass = this.params.bass;

    this.waveTime += this.params.waveSpeed * dt;
    // Auto-rotate accumulators — degrees, separate axis each. The
    // final object rotation = static rotate{X,Y,Z} + autoRot{X,Y,Z}Phase.
    this.autoRotXPhase += this.params.autoRotateX * dt;
    this.autoRotYPhase += this.params.autoRotateY * dt;
    this.autoRotZPhase += this.params.autoRotateZ * dt;

    // ── Compute uniforms (288 bytes; see WGSL `struct U`) ──────
    const cuBuf = new ArrayBuffer(288);
    const cuF = new Float32Array(cuBuf);
    const cuU = new Uint32Array(cuBuf);
    // Block 0 — timing + core
    cuF[0]  = dt;
    cuF[1]  = now;
    cuU[2]  = this.pointCount >>> 0;
    cuF[3]  = this.params.pointSize;
    // Block 1 — motion
    cuF[4]  = this.params.windStrength;
    cuF[5]  = this.params.windScale;
    cuF[6]  = this.params.anchorPull;
    cuF[7]  = this.params.damping;
    // Block 2 — audio
    cuF[8]  = this.params.bass;
    cuF[9]  = this.params.treble;
    cuF[10] = this.burstImpulse;
    cuF[11] = this.params.shimmerStrength;
    // Block 3 — wave center + radius
    // Proximity sphere orbits on a tilted ellipse around the cloud
    // origin. The Y component runs at 0.6× / Z at 0.4× so the path
    // sweeps a more 3D shape than a flat XY circle.
    const wAng = this.waveTime;
    const wEnabled = this.params.waveEnabled ? 1 : 0;
    cuF[12] = wEnabled * Math.cos(wAng) * this.params.waveOrbitRadius;
    cuF[13] = wEnabled * Math.sin(wAng) * this.params.waveOrbitRadius * 0.6;
    cuF[14] = wEnabled * Math.sin(wAng * 0.7) * this.params.waveOrbitRadius * 0.4;
    cuF[15] = this.params.waveRadius;
    // Block 4 — wave + twist + voxel size
    cuF[16] = this.params.waveStrength * wEnabled;
    cuF[17] = this.params.waveFalloff;
    cuF[18] = this.params.twistAmount;
    cuF[19] = this.params.voxelSize;
    // Block 5 — voxel mix + dissolve + hue
    cuF[20] = this.params.voxelMix;
    cuF[21] = this.params.dissolveRadius;
    cuF[22] = this.params.dissolveSoftness;
    cuF[23] = this.hueShiftPhase;
    // Block 6 — color basics
    cuF[24] = this.params.saturation;
    cuF[25] = this.params.brightness;
    cuU[26] = COLOR_MODE_ID[this.params.colorMode] >>> 0;
    cuU[27] = COLOR_MAP_ID[this.params.colorMap]   >>> 0;
    // Block 7 — color mix + map shaping
    cuF[28] = this.params.colorMix;
    cuF[29] = this.params.colorMapScale;
    cuF[30] = this.params.colorMapOffset;
    cuF[31] = this.colorCyclePhase;
    // Block 8 — random hue params
    cuF[32] = this.params.randomSat;
    cuF[33] = this.params.randomVal;
    cuU[34] = FILTER_MODE_ID[this.params.filterMode] >>> 0;
    cuU[35] = FILTER_AXIS_ID[this.params.filterAxis] >>> 0;
    // Blocks 9-12 — palette colors. Each vec3 starts at a 16-byte
    // boundary; the float index is (16 + block*16) / 4 = 36, 40, 44, 48.
    cuF[36] = this.params.colorA[0]; cuF[37] = this.params.colorA[1]; cuF[38] = this.params.colorA[2];
    cuF[40] = this.params.colorB[0]; cuF[41] = this.params.colorB[1]; cuF[42] = this.params.colorB[2];
    cuF[44] = this.params.colorC[0]; cuF[45] = this.params.colorC[1]; cuF[46] = this.params.colorC[2];
    cuF[48] = this.params.colorD[0]; cuF[49] = this.params.colorD[1]; cuF[50] = this.params.colorD[2];
    // Blocks 13-15 — filter/gesture controls.
    cuF[52] = this.params.filterAmount;
    cuF[53] = this.params.filterSpeed;
    cuF[54] = this.params.filterPhase;
    cuF[55] = this.params.filterWidth;
    cuF[56] = this.params.filterSoftness;
    cuF[57] = this.params.contourBands;
    cuF[58] = this.params.fogDensity;
    cuF[59] = this.params.fogOpacity;
    cuF[60] = this.params.fogColor[0];
    cuF[61] = this.params.fogColor[1];
    cuF[62] = this.params.fogColor[2];
    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, cuBuf);

    // ── Compute pass ───────────────────────────────────────────
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.computePipeline);
      pass.setBindGroup(0, this.computeBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.pointCount / 64));
      pass.end();
    }

    // ── Camera + object rotation matrices ──────────────────────
    // Camera sits straight on at Z = -cameraZ looking down +Z. The
    // cloud rotates around its OWN center (the world origin after
    // the centroid normalization in setPointCloudData), driven by
    // the user's rotate{X,Y,Z} + auto-rotate accumulators.
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const proj = perspective(this.params.fovDeg, aspect, 0.05, 100);

    // View — pure Z translation. No camera rotation; the object
    // rotation block below puts the cloud wherever the user wants.
    const view = translate(0, 0, -this.params.cameraZ);

    // Object rotation — XYZ Euler (apply X, then Y, then Z in body
    // frame; matrix composition order Rz * Ry * Rx). Auto-rotate
    // adds to the static slider value so users can both set a
    // starting pose and have it continuously spin.
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

    // Final viewProj = proj · view · objectRot. Pre-multiplied on the
    // CPU so the vertex shader stays the trivial single-matrix mul.
    const viewProj = mat4Mul(proj, mat4Mul(view, objRot));

    // camRight/camUp for billboarding the point quads. With the
    // object rotated, the billboards still need to face the CAMERA,
    // not the rotated frame — so we use identity right/up (the
    // camera doesn't rotate in this design). The billboards stay
    // screen-aligned regardless of how the cloud is rotated.
    const camRight = [1, 0, 0];
    const camUp    = [0, 1, 0];

    // ── Render uniforms ────────────────────────────────────────
    const ruBuf = new ArrayBuffer(192);
    const ruF = new Float32Array(ruBuf);
    const ruU = new Uint32Array(ruBuf);
    ruF.set(viewProj, 0);
    ruF[16] = camRight[0]; ruF[17] = camRight[1]; ruF[18] = camRight[2]; ruF[19] = 0;
    ruF[20] = camUp[0]; ruF[21] = camUp[1]; ruF[22] = camUp[2]; ruF[23] = 0;
    ruU[24] = this.params.topology === 'strokes' ? 2 : (this.params.topology === 'billboards' ? 1 : 0);
    ruF[25] = this.params.strokeLength;
    ruF[26] = this.params.strokeWidth;
    ruF[27] = this.params.opacity;
    ruU[28] = this.pointCount >>> 0;
    const fogModeBoost = this.params.filterMode === 'fog' ? 1 : 0;
    ruF[32] = this.params.fogColor[0];
    ruF[33] = this.params.fogColor[1];
    ruF[34] = this.params.fogColor[2];
    ruF[35] = Math.max(this.params.fogOpacity, fogModeBoost * this.params.filterAmount * 0.65);
    ruF[36] = Math.max(this.params.fogDensity, fogModeBoost * (0.45 + this.params.filterAmount * 1.4));
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ruBuf);

    // ── Render pass ────────────────────────────────────────────
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(6, this.pointCount, 0, 0);
    pass.end();
  }

  dispose(): void {
    try { this.homeBuffer?.destroy?.(); } catch { /* */ }
    try { this.liveBuffer?.destroy?.(); } catch { /* */ }
    try { this.computeUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.renderUniformBuffer?.destroy?.(); } catch { /* */ }
    this.homeBuffer = null;
    this.liveBuffer = null;
    this.pointCount = 0;
  }
}
