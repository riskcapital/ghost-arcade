/**
 * WebGPUPixelParticles — turn any 2D source (image / video / canvas
 * / GPUTexture) into a cloud of 3D animated particles. Each pixel
 * of the source seeds one particle that:
 *   - takes its color by sampling the source texture at its
 *     UV anchor (so the cloud always looks like the source)
 *   - takes its z-depth from luminance OR an optional depth map
 *   - is animated by a compute shader per the active "effect mode"
 *
 * This is the foundation for an entire effect family — sand, drift,
 * depth-displace, scatter, halftone-dots, stipple-noise — by
 * swapping the per-mode compute branch.
 *
 * Source plumbing (all converge into a single GPUTexture):
 *   ImageBitmap / HTMLImageElement → device.queue.copyExternalImageToTexture
 *   HTMLVideoElement              → device.importExternalTexture (per frame)
 *   HTMLCanvasElement             → copyExternalImageToTexture
 *   GPUTexture                    → already a texture, bind directly
 *
 * Architecture per frame:
 *   1. (optional) re-import source texture if it's a video frame
 *   2. compute pass: dispatch particleCount / 64 workgroups, each
 *      thread updates one particle (position, velocity, alpha)
 *   3. render pass: instanced quads with billboarded sprites,
 *      additive blend, perspective-projected so depth reads
 *
 * Particle layout (32 bytes, std430):
 *   pos:    vec3<f32>     world XYZ in [-1..1] cube
 *   alpha:  f32           per-particle alpha (life / mode-dependent)
 *   vel:    vec3<f32>     velocity for stateful sims (sand, fluid)
 *   life:   f32           0..1, used by some modes to fade
 *
 * Effect modes (compute shader branches on `mode_id` uniform):
 *   0: identity      — particle stays at its UV anchor (sanity check)
 *   1: depth-shift   — Z = luminance * depth_strength, always-on
 *                       perspective so the source looks 3D
 *   2: sand-fall     — gravity drags particles down, accumulate at
 *                       the bottom or at user-defined floor lines
 *   3: scatter       — random walk + slow recovery to anchor
 *   4: halftone      — particles snap to a coarse grid; size scales
 *                       with luminance (looks like halftone print)
 *   5: stipple-noise — tight noise wobble around anchor; reads as
 *                       hand-drawn ink stipple animation
 *   6: dissolve      — particles drift outward and fade; use for
 *                       fade-in/fade-out transitions on any layer
 *
 * The whole pipeline targets a 1024×1024 source (≈1M particles) by
 * default; smaller sources are upscaled/downsampled at sample time.
 * Particle count is independent of source resolution — we sample N
 * anchors uniformly across UV space so you can have 50K particles
 * representing a 4K image.
 */

const PARTICLE_BYTES = 32;
const MAX_PARTICLES = 1_000_000;       // hard ceiling
const DEFAULT_PARTICLES = 250_000;     // sweet spot — sharp without melting GPU

/** Column-major 4x4 matrix multiply: out = a × b. Both inputs and
 *  output stored in 16-float column-major layout (matches WGSL's
 *  mat4x4<f32> convention so we can writeBuffer directly). */
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

// Effect mode IDs — must stay in sync with the compute shader's
// `if (u.mode == Nu)` branches.
export type PixelEffectMode =
  | 'identity'
  | 'depth-shift'
  | 'sand-fall'
  | 'scatter'
  | 'halftone'
  | 'stipple-noise'
  | 'dissolve';

export type PixelDepthSource =
  | 'luminance'
  | 'inverse-luminance'
  | 'edge-density'
  | 'saturation';

export type PixelDepthMotion =
  | 'locked'
  | 'drift'
  | 'orbit'
  | 'ripple'
  | 'swarm'
  | 'breathe';

const MODE_IDS: Record<PixelEffectMode, number> = {
  'identity':       0,
  'depth-shift':    1,
  'sand-fall':      2,
  'scatter':        3,
  'halftone':       4,
  'stipple-noise':  5,
  'dissolve':       6,
};

const DEPTH_SOURCE_IDS: Record<PixelDepthSource, number> = {
  'luminance': 0,
  'inverse-luminance': 1,
  'edge-density': 2,
  'saturation': 3,
};

const DEPTH_MOTION_IDS: Record<PixelDepthMotion, number> = {
  'locked': 0,
  'drift': 1,
  'orbit': 2,
  'ripple': 3,
  'swarm': 4,
  'breathe': 5,
};

const COMPUTE_WGSL = /* wgsl */ `
struct Particle {
  pos:   vec3<f32>,
  alpha: f32,
  vel:   vec3<f32>,
  life:  f32,
};

struct Globals {
  time:          f32,   // seconds since init
  dt:            f32,   // seconds since last frame
  total:         u32,   // active particle count
  mode:          u32,   // effect-mode id
  // Per-mode knobs (packed into a single vec4 to keep the uniform
  // small; meanings shift by mode):
  //   depth-shift:  x=depth_strength,  y=_,            z=spin_speed,  w=spin_axis
  //   sand-fall:    x=fall_speed,      y=floor_y,      z=x_drift_amp, w=stream_density (0..1)
  //   scatter:      x=jitter_amp,      y=recovery,     z=noise_freq,  w=_
  //   halftone:     x=cell_size,       y=size_gain,    z=_,           w=_
  //   stipple:      x=wobble_amp,      y=wobble_freq,  z=_,           w=_
  //   dissolve:     x=spread,          y=cycle_speed,  z=swirl,       w=_
  knobs:         vec4<f32>,
  tex_size:      vec2<f32>,
  anchor_jitter: f32,
  // Lighting toggle — when 1, depth-shift mode shades particles via
  // a Lambert term computed from the heightmap normal + light position.
  light_enabled: f32,
  // Light position in world space + intensity multiplier (vec4 for
  // alignment).
  light_pos:     vec4<f32>,    // xyz=position, w=intensity
  // Ambient + heightmap-derivative scale for the lighting model.
  light_ambient_height: vec4<f32>, // x=ambient, y=height_scale, z=_, w=_
  // Noise-driven displacement for depth-shift. amp_xy + amp_z control
  // strength on the two axes; freq + speed control spatial / temporal
  // scale of the underlying value noise.
  noise_params:  vec4<f32>,    // x=amp_xy, y=amp_z, z=freq, w=speed
  // Fit mode + view extent. fit_mode: 0=stretch, 1=contain, 2=cover.
  // view_extent_xy is the camera's visible world extent at the planet
  // plane (z=0) — computed JS-side from FOV + cameraZ + canvas
  // aspect. By sizing the anchor extent to match the view extent,
  // STRETCH always fills the canvas regardless of camera zoom; the
  // other modes scale relative to this baseline.
  // x repurposed: mirror_source_x flag (0 or 1). Anchor extent is
  // already stretch-only after the fit-mode removal so that slot
  // had no consumer; using it for the source-mirror toggle keeps
  // the buffer size unchanged.
  fit_params:    vec4<f32>,    // x=mirror_source_x, y=canvas_aspect, z=view_x, w=view_y
  // Depth-from-image controls for depth-shift mode. The shader keeps
  // source colour stable, but this controls how source pixels become
  // Z-depth: luma / inverse / edge-density / saturation, plus curve,
  // contrast, and optional neighbor smoothing to calm noisy video.
  depth_params:  vec4<f32>,    // x=source_id, y=curve, z=contrast, w=smoothing
  // Smooth stateless motion on the derived 3D cloud. These are not
  // particle-life sims; they are reversible fields around the source
  // anchors, so the image stays readable while it breathes/moves.
  depth_motion:  vec4<f32>,    // x=motion_id, y=amount, z=speed, w=scale
  depth_motion2: vec4<f32>,    // x=center, y=depth_coupling, z=phase, w=_
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform>             u: Globals;
@group(0) @binding(2) var src:                 texture_2d<f32>;
@group(0) @binding(3) var samp:                sampler;

// Cheap deterministic hash for per-particle randomness. Returns
// 0..1. A full PRNG is overkill for our use — phase noise reads as
// random enough.
fn hash11(n: f32) -> f32 {
  let s = sin(n * 78.233 + 12.9898) * 43758.5453;
  return s - floor(s);
}
fn hash21(p: vec2<f32>) -> f32 {
  let s = sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453;
  return s - floor(s);
}

// Smooth 2D value noise (gradient noise is not worth the cost for
// post-effect wobble). Range 0..1.
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2(1.0, 0.0));
  let c = hash21(i + vec2(0.0, 1.0));
  let d = hash21(i + vec2(1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

// Luminance from RGB.
fn lum(c: vec3<f32>) -> f32 {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

fn source_depth(sample_uv: vec2<f32>, rgb: vec3<f32>) -> f32 {
  let mode = u.depth_params.x;
  let px = vec2(1.0 / max(u.tex_size.x, 1.0), 0.0);
  let py = vec2(0.0, 1.0 / max(u.tex_size.y, 1.0));
  var raw = lum(rgb);

  if (mode > 2.5 && mode < 3.5) {
    let hi = max(max(rgb.r, rgb.g), rgb.b);
    let lo = min(min(rgb.r, rgb.g), rgb.b);
    raw = hi - lo;
  } else if (mode > 1.5 && mode < 2.5) {
    let lL = lum(textureSampleLevel(src, samp, clamp(sample_uv - px, vec2(0.0), vec2(1.0)), 0.0).rgb);
    let lR = lum(textureSampleLevel(src, samp, clamp(sample_uv + px, vec2(0.0), vec2(1.0)), 0.0).rgb);
    let lU = lum(textureSampleLevel(src, samp, clamp(sample_uv - py, vec2(0.0), vec2(1.0)), 0.0).rgb);
    let lD = lum(textureSampleLevel(src, samp, clamp(sample_uv + py, vec2(0.0), vec2(1.0)), 0.0).rgb);
    raw = clamp(length(vec2(lR - lL, lD - lU)) * 3.5, 0.0, 1.0);
  } else {
    let smoothing = clamp(u.depth_params.w, 0.0, 1.0);
    if (smoothing > 0.001) {
      let lL = lum(textureSampleLevel(src, samp, clamp(sample_uv - px, vec2(0.0), vec2(1.0)), 0.0).rgb);
      let lR = lum(textureSampleLevel(src, samp, clamp(sample_uv + px, vec2(0.0), vec2(1.0)), 0.0).rgb);
      let lU = lum(textureSampleLevel(src, samp, clamp(sample_uv - py, vec2(0.0), vec2(1.0)), 0.0).rgb);
      let lD = lum(textureSampleLevel(src, samp, clamp(sample_uv + py, vec2(0.0), vec2(1.0)), 0.0).rgb);
      let blurred = (raw + lL + lR + lU + lD) * 0.2;
      raw = mix(raw, blurred, smoothing);
    }
    if (mode > 0.5 && mode < 1.5) {
      raw = 1.0 - raw;
    }
  }

  let contrast = max(u.depth_params.z, 0.01);
  raw = clamp((raw - 0.5) * contrast + 0.5, 0.0, 1.0);
  return pow(raw, max(u.depth_params.y, 0.05));
}

fn apply_depth_motion(base: vec3<f32>, uv: vec2<f32>, depth_v: f32, seed: f32) -> vec3<f32> {
  let mode = u.depth_motion.x;
  let amount = u.depth_motion.y;
  if (mode < 0.5 || amount < 0.0001) { return base; }

  let speed = u.depth_motion.z;
  let scale = max(u.depth_motion.w, 0.001);
  let phase = u.depth_motion2.z;
  let depth_coupling = u.depth_motion2.y;
  let depth_weight = max(0.05, 1.0 + (depth_v - 0.5) * depth_coupling);
  let t = u.time * speed + phase;
  var out = base;

  if (mode > 0.5 && mode < 1.5) {
    // Drift: calm, reversible field movement. Good default for
    // photo/video point clouds because it keeps silhouettes readable.
    let nx = vnoise(uv * scale + vec2(t * 0.17, seed * 0.00003)) - 0.5;
    let ny = vnoise(uv * scale + vec2(19.17, t * 0.13 + seed * 0.00002)) - 0.5;
    let nz = vnoise(uv * scale + vec2(41.7 + t * 0.11, 7.3)) - 0.5;
    out.x = out.x + nx * amount * depth_weight;
    out.y = out.y + ny * amount * depth_weight;
    out.z = out.z + nz * amount * 0.85 * depth_weight;
  } else if (mode > 1.5 && mode < 2.5) {
    // Orbit: depth-separated layers gently swirl around the image
    // center. The angle is bounded, so it never spins into chaos.
    let rel = out.xy;
    let radius = length(rel);
    let angle = sin(t + depth_v * 6.28318 + radius * scale) * amount * 0.45 * depth_weight;
    let s = sin(angle);
    let c = cos(angle);
    out.x = rel.x * c - rel.y * s;
    out.y = rel.x * s + rel.y * c;
  } else if (mode > 2.5 && mode < 3.5) {
    // Ripple: radial waves travel through both XY and Z, using depth
    // as phase so foreground/background breathe separately.
    let rel = out.xy;
    let radius = length(rel);
    let dir = rel / max(radius, 0.001);
    let wave = sin(radius * scale * 5.0 - t * 6.28318 + depth_v * 3.14159);
    let ripple_xy = out.xy + dir * wave * amount * 0.32 * depth_weight;
    out = vec3(ripple_xy.x, ripple_xy.y, out.z + wave * amount * 0.7 * depth_weight);
  } else if (mode > 3.5 && mode < 4.5) {
    // Swarm: a stronger organic vector field plus a mild vortex,
    // still anchored to source UVs for stable colour.
    let flow = vec2(
      vnoise(uv * scale + vec2(t * 0.31, 5.7)),
      vnoise(uv * scale + vec2(11.1, t * 0.29))
    ) - vec2(0.5);
    let rel = out.xy;
    let vortex = vec2(-rel.y, rel.x) / (length(rel) + 0.35);
    let swarm_xy = out.xy + (flow * 1.35 + vortex * 0.28) * amount * depth_weight;
    let swarm_z = out.z + (vnoise(uv * scale + vec2(t * 0.19, 23.4)) - 0.5) * amount * depth_weight;
    out = vec3(swarm_xy.x, swarm_xy.y, swarm_z);
  } else if (mode > 4.5 && mode < 5.5) {
    // Breathe: scales the cloud subtly by depth and pushes Z so it
    // reads like a living relief sculpture rather than random noise.
    let pulse = sin(t + depth_v * 6.28318);
    let scale_pulse = 1.0 + pulse * amount * 0.12 * depth_weight;
    let breathe_xy = out.xy * scale_pulse;
    out = vec3(breathe_xy.x, breathe_xy.y, out.z + pulse * amount * 0.45 * depth_weight);
  }

  return out;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.total) { return; }
  var p = particles[i];

  // Anchor in UV space. We lay out particles on a quasi-uniform grid
  // (Hammersley-ish using bit reversal would be ideal but a simple
  // sqrt-based grid + per-particle jitter avoids visible banding for
  // the counts we care about).
  let count_f = f32(u.total);
  let cols = ceil(sqrt(count_f));
  let cx = f32(i % u32(cols));
  let cy = floor(f32(i) / cols);
  let cell = vec2(cx, cy) / cols;
  let jx = (hash11(f32(i) * 1.731) - 0.5) * u.anchor_jitter / cols;
  let jy = (hash11(f32(i) * 2.137) - 0.5) * u.anchor_jitter / cols;
  let uv = clamp(cell + vec2(jx, jy), vec2(0.0), vec2(0.99999));

  // Default tint (vel) to white — modes that use lighting (depth-
  // shift) overwrite this. Render shader multiplies the source
  // sample by p.vel.xyz, so vec3(1) is a no-op tint.
  p.vel = vec3(1.0);

  // Source-sampling UV. We mirror the SAMPLE (not the anchor) when
  // mirror_source_x is on so particles stay in place but read the
  // colour from the opposite side of the source — the standard
  // "selfie" flip for webcam feeds. Costs one branch per particle.
  var sample_uv = uv;
  if (u.fit_params.x > 0.5) { sample_uv.x = 1.0 - sample_uv.x; }

  // Sample source color + luminance (used for depth in several modes).
  let col = textureSampleLevel(src, samp, sample_uv, 0.0);
  let l = lum(col.rgb);

  // Anchor extent matches the camera's view extent at the source
  // plane (z=0). The source UV maps uniformly across this extent,
  // so the source always fills the visible canvas — non-matching
  // aspects show the source stretched to fit. The user controls
  // framing via Camera Distance / FOV / Pan (no separate fit mode).
  let view_x = max(u.fit_params.z, 0.001);
  let view_y = max(u.fit_params.w, 0.001);
  let anchor_world = vec2((uv.x * 2.0 - 1.0) * view_x, (1.0 - uv.y * 2.0) * view_y);

  if (u.mode == 0u) {
    // ── IDENTITY ──
    // Pin to anchor with a subtle per-particle alpha shimmer so the
    // image has a faint living quality (not stone-still). Camera
    // controls still apply so the user can frame / zoom the source.
    p.pos = vec3(anchor_world, 0.0);
    let shimmer = 0.92 + 0.08 * sin(u.time * 1.3 + f32(i) * 0.07);
    p.alpha = col.a * shimmer;
    p.life = 1.0;
  } else if (u.mode == 1u) {
    // ── DEPTH SHIFT ──
    // Z displaced by luminance with optional auto-spin (set spin
    // speed = 0 to disable; default is 0). Camera yaw/pitch in the
    // VP matrix lets the user orbit even when auto-spin is off.
    // Optional Lambert lighting from a movable point light: surface
    // normal computed from the source's luminance derivatives, then
    // diffuse term applied to the particle color.
    let depth = u.knobs.x;
    let depth_v = source_depth(sample_uv, col.rgb);
    let spin_s = u.knobs.z;
    let axis = u.knobs.w;     // 0=Y axis, 1=X axis (rotate vertically)
    let depth_center = clamp(u.depth_motion2.x, 0.0, 1.0);
    let z = (depth_v - depth_center) * depth;
    var rotated = vec3(anchor_world, z);
    rotated = apply_depth_motion(rotated, uv, depth_v, f32(i));
    if (abs(spin_s) > 0.001) {
      let ang = u.time * spin_s;
      let s_sin = sin(ang);
      let s_cos = cos(ang);
      if (axis < 0.5) {
        rotated = vec3(
          s_cos * rotated.x + s_sin * rotated.z,
          rotated.y,
          -s_sin * rotated.x + s_cos * rotated.z,
        );
      } else {
        rotated = vec3(
          rotated.x,
          s_cos * rotated.y - s_sin * rotated.z,
          s_sin * rotated.y + s_cos * rotated.z,
        );
      }
    }
    // ── Noise displacement ──
    // Layered value noise sampled at (uv * freq) + a time offset
    // gives a flowing per-particle wobble. Three different sample
    // points (offset in noise space) produce decorrelated x/y/z
    // displacements so the particle wanders smoothly rather than
    // sliding along one axis.
    let n_amp_xy = u.noise_params.x;
    let n_amp_z = u.noise_params.y;
    let n_freq = max(u.noise_params.z, 0.001);
    let n_speed = u.noise_params.w;
    if (n_amp_xy > 0.0001 || n_amp_z > 0.0001) {
      let nt = u.time * n_speed;
      // Three noise samples — separated by large arbitrary offsets so
      // they read as independent fields. Center each on 0 by
      // subtracting 0.5.
      let nx = vnoise(uv * n_freq + vec2(nt, 0.0)) - 0.5;
      let ny = vnoise(uv * n_freq + vec2(17.31, nt * 0.83)) - 0.5;
      let nz = vnoise(uv * n_freq + vec2(43.7 + nt * 0.61, 91.2)) - 0.5;
      rotated.x = rotated.x + nx * n_amp_xy * 2.0;
      rotated.y = rotated.y + ny * n_amp_xy * 2.0;
      rotated.z = rotated.z + nz * n_amp_z;
    }
    p.pos = rotated;

    // ── Lighting (optional) ──
    // Compute a surface normal from the heightmap derivatives, then
    // Lambert-shade against the user's light position. Result stored
    // in p.color; render shader uses p.color as a tint multiplier on
    // top of the source sample so colored sources keep their colour
    // but get the light/shadow gradient.
    var tint = vec3(1.0);
    if (u.light_enabled > 0.5) {
      let h_scale = u.light_ambient_height.y;
      // Sample neighbours for finite-difference normal. Use the
      // texture size to compute one-pixel offsets; fallback to a
      // small fixed offset when tex_size is missing.
      let px = vec2(1.0 / max(u.tex_size.x, 1.0), 0.0);
      let py = vec2(0.0, 1.0 / max(u.tex_size.y, 1.0));
      let cL = textureSampleLevel(src, samp, clamp(sample_uv - px, vec2(0.0), vec2(1.0)), 0.0).rgb;
      let cR = textureSampleLevel(src, samp, clamp(sample_uv + px, vec2(0.0), vec2(1.0)), 0.0).rgb;
      let cU = textureSampleLevel(src, samp, clamp(sample_uv - py, vec2(0.0), vec2(1.0)), 0.0).rgb;
      let cD = textureSampleLevel(src, samp, clamp(sample_uv + py, vec2(0.0), vec2(1.0)), 0.0).rgb;
      let lL = source_depth(clamp(sample_uv - px, vec2(0.0), vec2(1.0)), cL);
      let lR = source_depth(clamp(sample_uv + px, vec2(0.0), vec2(1.0)), cR);
      let lU = source_depth(clamp(sample_uv - py, vec2(0.0), vec2(1.0)), cU);
      let lD = source_depth(clamp(sample_uv + py, vec2(0.0), vec2(1.0)), cD);
      let dx = (lR - lL) * depth * h_scale * 4.0;
      let dy = (lD - lU) * depth * h_scale * 4.0;
      // Source plane lives in XY, depth in Z. Normal points toward
      // +Z when surface is flat; gradient tilts it toward -gradient.
      let n = normalize(vec3(-dx, dy, 1.0));
      let to_light = normalize(u.light_pos.xyz - rotated);
      let diffuse = max(dot(n, to_light), 0.0);
      let intensity = u.light_pos.w;
      let ambient = u.light_ambient_height.x;
      tint = vec3(ambient + diffuse * intensity);
    }
    // Stash tint in vel (vel is unused by the new stateless modes).
    // Render shader multiplies the source sample by this vec3 to
    // apply the lighting term.
    p.vel = tint;
    p.alpha = col.a;
    p.life = 1.0;
  } else if (u.mode == 2u) {
    // ── SAND FALL ──
    // Stateless continuous flow. Each particle has a per-particle
    // PHASE (offset from a global clock), and its Y position
    // interpolates from the anchor (top) down to the floor over a
    // period. When phase wraps, it pops back up to the anchor —
    // result is a constant rain of grains with the source image
    // visible at the top. Stateless = no per-frame state, no
    // settling-then-stopping bug.
    let fall_speed = max(u.knobs.x, 0.05);   // cycles per second-ish
    let floor_y = u.knobs.y;                  // bottom Y in world coords
    let drift_amp = u.knobs.z;                // x-drift amplitude
    let density = clamp(u.knobs.w, 0.0, 1.0); // 0=sparse, 1=full
    // Per-particle phase: time + per-particle offset (0..1) wrapped
    // by fall_speed so each grain falls on its own schedule.
    let h = hash11(f32(i) * 0.137);
    let phase = fract(u.time * fall_speed + h);
    // Y interpolates from anchor_world.y (top) to floor_y (bottom).
    let top_y = anchor_world.y;
    let drop_y = mix(top_y, floor_y, phase);
    // X-drift uses time-varying noise per particle so streams aren't
    // perfectly vertical.
    let drift_x = sin(u.time * 0.6 + f32(i) * 0.21) * drift_amp;
    p.pos = vec3(anchor_world.x + drift_x, drop_y, 0.0);
    // Density gate — particles whose hash exceeds the density value
    // are hidden so the user can sparsify a dense source.
    let visible = step(h, density);
    // Soft fade in (entering from anchor) + fade out (about to wrap).
    let fade = smoothstep(0.0, 0.04, phase) * smoothstep(1.0, 0.96, phase);
    p.alpha = col.a * fade * visible;
  } else if (u.mode == 3u) {
    // ── SCATTER ──
    // Each particle wobbles around its anchor following a noise
    // field; recovery pulls it back so the image holds its overall
    // shape while constantly trembling. Reads as "alive sand image".
    let amp = u.knobs.x;
    let recov = u.knobs.y;
    let nf = u.knobs.z;
    let n1 = vnoise(uv * nf + vec2(u.time * 0.3, 0.0));
    let n2 = vnoise(uv * nf + vec2(0.0, u.time * 0.27));
    // 'target' is a WGSL reserved keyword — using target_pos.
    let target_pos = vec3(
      anchor_world.x + (n1 - 0.5) * amp,
      anchor_world.y + (n2 - 0.5) * amp,
      0.0,
    );
    p.pos = mix(p.pos, target_pos, clamp(recov * u.dt * 6.0, 0.0, 1.0));
    p.alpha = col.a;
  } else if (u.mode == 4u) {
    // ── HALFTONE ──
    // Snap to a coarse grid based on cell_size, then particle's
    // alpha = smoothed luminance and its rendered size scales with
    // luminance too (handled in vertex shader via meta read).
    let cs = max(u.knobs.x, 0.005);
    let grid_uv = floor(uv / cs) * cs + cs * 0.5;
    let grid_world = vec2(grid_uv.x * 2.0 - 1.0, 1.0 - grid_uv.y * 2.0);
    p.pos = vec3(grid_world, 0.0);
    // Re-sample at the cell center so dot color isn't dependent on
    // sub-cell position (avoids dot color flicker as you change
    // cell size). Apply the mirror flip to the sample only — dot
    // position stays put.
    var cell_sample_uv = grid_uv;
    if (u.fit_params.x > 0.5) { cell_sample_uv.x = 1.0 - cell_sample_uv.x; }
    let cell_col = textureSampleLevel(src, samp, cell_sample_uv, 0.0);
    let cell_l = lum(cell_col.rgb);
    p.alpha = cell_l;
    // Stash luminance in life so the vertex shader can scale dot size.
    p.life = cell_l;
  } else if (u.mode == 5u) {
    // ── STIPPLE NOISE ──
    // Tight micro-wobble using a high-frequency noise. Reads as
    // hand-drawn ink stipple shimmering. Particle alpha modulated
    // by luminance so dark areas read as denser.
    let amp = u.knobs.x;
    let freq = u.knobs.y;
    let nx = vnoise(uv * freq + vec2(u.time * 1.7, 0.0));
    let ny = vnoise(uv * freq + vec2(0.0, u.time * 1.3));
    p.pos = vec3(
      anchor_world.x + (nx - 0.5) * amp,
      anchor_world.y + (ny - 0.5) * amp,
      0.0,
    );
    // Map: dark in source = brighter dot (ink stipple is denser in
    // shadows). Subtract from 1 to invert.
    let inv_l = 1.0 - l;
    p.alpha = pow(inv_l, 1.6) * col.a;
  } else if (u.mode == 6u) {
    // ── DISSOLVE ──
    // Stateless looping cycle. Each particle progresses through
    // phase 0..1 with per-particle offset so dissolution is
    // staggered. At phase=0 the particle is
    // at its anchor with full alpha; as phase increases it drifts
    // outward in a swirl and fades; at phase=1 it loops back to the
    // anchor instantly. Continuously cycles — no black-screen
    // freeze-state.
    let spread = u.knobs.x;
    let cycle_speed = max(u.knobs.y, 0.05);   // cycles per second
    let swirl = u.knobs.z;
    let h = hash11(f32(i) * 0.193);
    let phase = fract(u.time * cycle_speed + h);
    let r = phase * spread;
    let ang = uv.x * 6.28318 + u.time * swirl + h * 6.28318;
    p.pos = vec3(
      anchor_world.x + cos(ang) * r,
      anchor_world.y + sin(ang) * r,
      0.0,
    );
    // Smooth in (snap back is gentle, not hard) + fade out as phase
    // reaches 1. Keeps the cycle visually continuous.
    let fade = smoothstep(0.0, 0.06, phase) * (1.0 - phase);
    p.alpha = fade * col.a;
  }

  particles[i] = p;
}
`;

const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos:   vec3<f32>,
  alpha: f32,
  vel:   vec3<f32>,
  life:  f32,
};

struct RU {
  // Combined view+projection (perspective so depth-shift reads).
  // Flattened row-major into 4 vec4s.
  vp:           mat4x4<f32>,
  // Aspect for billboard squareness, particle size in normalized
  // units, mode for size-modulation behaviour, opacity envelope.
  mu:           vec4<f32>,    // x=aspect_y, y=base_size, z=mode_id, w=opacity ('meta' is reserved in WGSL)
  // Per-frame flags. x=mirror_source_x, y=active particle count,
  // z=anchor jitter. The render shader recomputes each particle's
  // original UV from instance id so source colour stays pinned to
  // the source pixel even when motion moves the particle in 3D.
  flags:        vec4<f32>,
};

@group(0) @binding(0) var<storage, read>      particles: array<Particle>;
@group(0) @binding(1) var<uniform>            u: RU;
@group(0) @binding(2) var src:                texture_2d<f32>;
@group(0) @binding(3) var samp:               sampler;

fn hash11(n: f32) -> f32 {
  let s = sin(n * 78.233 + 12.9898) * 43758.5453;
  return s - floor(s);
}

fn anchor_uv_for(iid: u32) -> vec2<f32> {
  let total = max(u.flags.y, 1.0);
  let cols = ceil(sqrt(total));
  let cx = f32(iid % u32(cols));
  let cy = floor(f32(iid) / cols);
  let cell = vec2(cx, cy) / cols;
  let jitter = clamp(u.flags.z, 0.0, 1.0);
  let jx = (hash11(f32(iid) * 1.731) - 0.5) * jitter / cols;
  let jy = (hash11(f32(iid) * 2.137) - 0.5) * jitter / cols;
  return clamp(cell + vec2(jx, jy), vec2(0.0), vec2(0.99999));
}

struct VSOut {
  @builtin(position) clip:  vec4<f32>,
  @location(0) uv:          vec2<f32>,
  @location(1) color:       vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(-1.0, 1.0),  vec2(1.0, -1.0), vec2(1.0, 1.0),
  );
  let corner = corners[vid];
  let p = particles[iid];

  if (p.alpha <= 0.001) {
    var dead: VSOut;
    dead.clip = vec4(2.0, 2.0, 0.0, 1.0);
    dead.uv = vec2(0.0);
    dead.color = vec4(0.0);
    return dead;
  }

  // Halftone (mode 4) scales dot size by luminance (stored in life).
  // Default behaviour: size proportional to alpha so very-dim
  // particles barely show.
  let mode_id = u.mu.z;
  var size_mul = 0.5 + clamp(p.alpha, 0.0, 1.0) * 0.5;
  if (mode_id > 3.5 && mode_id < 4.5) {
    // Halftone: size from p.life (= luminance set by compute)
    size_mul = clamp(p.life, 0.05, 1.0) * 1.6;
  }

  let base = u.mu.y;
  let size_x = base * size_mul;
  let size_y = base * size_mul * u.mu.x;

  // Project the particle's world position via vp matrix; the
  // billboard offsets are added in clip space (post-projection)
  // so size stays constant on screen regardless of depth.
  let world = p.pos;
  let clip_center = u.vp * vec4(world, 1.0);
  // Perspective-divide the offset so size is in NDC; multiply by w
  // to keep the offset in clip space.
  let offset_clip = vec2(corner.x * size_x, corner.y * size_y) * clip_center.w;
  let clip_pos = vec4(clip_center.xy + offset_clip, clip_center.z, clip_center.w);

  // Sample source color from the particle's ORIGINAL source anchor,
  // not its moved world position. That keeps photo/video colour
  // coherent while depth motion moves the point cloud around.
  var resample_uv = anchor_uv_for(iid);
  if (u.flags.x > 0.5) { resample_uv.x = 1.0 - resample_uv.x; }
  let c = textureSampleLevel(src, samp, clamp(resample_uv, vec2(0.0), vec2(1.0)), 0.0);
  let opacity_env = u.mu.w;
  let a = clamp(p.alpha * opacity_env, 0.0, 1.0);
  // p.vel doubles as a per-particle tint (set by compute shader for
  // lighting in depth-shift; defaults to vec3(1) for everything else).
  let tint = p.vel;
  var col_rgb = c.rgb * tint * a;
  // Halftone: render dots in source color, but boost contrast so
  // they read as proper print dots (not muted).
  if (mode_id > 3.5 && mode_id < 4.5) {
    col_rgb = c.rgb * tint * a * 1.4;
  }

  var out: VSOut;
  out.clip = clip_pos;
  out.uv = corner * 0.5 + 0.5;
  out.color = vec4(col_rgb, a);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Disc with smooth edge — looks like a soft sprite.
  let d = length(in.uv - 0.5) * 2.0;
  if (d > 1.0) { discard; }
  let edge = 1.0 - smoothstep(0.7, 1.0, d);
  let alpha = in.color.a * edge;
  return vec4(in.color.rgb * edge, alpha);
}
`;

export interface PixelParticlesOptions {
  /** Number of particles to spawn. Capped to MAX_PARTICLES. Higher
   *  = sharper image at the cost of GPU work. */
  particleCount?: number;
  /** Effect mode. */
  mode?: PixelEffectMode;
  /** Per-mode parameters (semantics depend on mode — see knobs
   *  comment in compute shader). */
  knobs?: [number, number, number, number];
  /** Base particle billboard size in normalized canvas units.
   *  Smaller = finer dots. */
  baseSize?: number;
  /** Global opacity envelope (independent of per-particle alpha). */
  opacity?: number;
  /** Anchor placement jitter to break grid banding. 0..1. */
  anchorJitter?: number;
  /** Camera FOV in degrees. Used to build the projection matrix. */
  fovDeg?: number;
  /** Camera Z distance from origin. */
  cameraZ?: number;
}

export interface PixelParticlesStats {
  framesEncoded: number;
  particleCount: number;
  hasSource: boolean;
}

export class WebGPUPixelParticles {
  static async create(device: any, presentFormat: any): Promise<WebGPUPixelParticles> {
    return new WebGPUPixelParticles(device, presentFormat);
  }

  readonly device: any;
  readonly presentFormat: any;

  private particleBuffer: any;
  private globalsBuffer: any;
  private renderUniformBuffer: any;
  private sourceTexture: any = null;
  private sourceSampler: any;

  private computePipeline: any;
  private renderPipeline: any;
  private computeBindGroupLayout: any;
  private renderBindGroupLayout: any;
  private renderPipelineLayout: any;
  private renderModule: any;
  private computeBindGroup: any = null;
  private renderBindGroup: any = null;
  // Cache of render pipelines keyed by blend-mode name. Pipelines
  // are immutable on the WebGPU side, so changing the layer's blend
  // mode means swapping which pipeline we bind. We lazily create
  // them on first use.
  private renderPipelinesByBlend: Map<string, any> = new Map();
  private currentBlend: string = 'add';

  private particleCount = DEFAULT_PARTICLES;
  private mode: PixelEffectMode = 'identity';
  private knobs: [number, number, number, number] = [1, 0, 0, 0];
  private baseSize = 0.005;
  private opacity = 1.0;
  private anchorJitter = 0.6;
  private fovDeg = 50;
  private cameraZ = 2.2;
  private cameraYaw = 0;        // degrees
  private cameraPitch = 0;      // degrees
  private panX = 0;
  private panY = 0;
  // Lighting (depth-shift mode)
  private lightEnabled = false;
  private lightPos: [number, number, number] = [1, 1, 1.5];
  private lightIntensity = 1.5;
  private lightAmbient = 0.25;
  private lightHeightStrength = 1.5;
  // Noise displacement (depth-shift). Stored as vec4 packed into
  // noise_params uniform.
  private noiseAmpXY = 0;
  private noiseAmpZ = 0;
  private noiseFreq = 4;
  private noiseSpeed = 0.5;
  // Derived depth + smooth point-cloud motion for photo/video
  // source clouds. These apply only to depth-shift mode.
  private depthSource: PixelDepthSource = 'luminance';
  private depthCurve = 1;
  private depthContrast = 1;
  private depthSmoothing = 0.2;
  private depthCenter = 0.5;
  private depthMotion: PixelDepthMotion = 'locked';
  private depthMotionAmount = 0.08;
  private depthMotionSpeed = 0.45;
  private depthMotionScale = 3.5;
  private depthMotionCoupling = 0.7;
  private depthMotionPhase = 0;
  // Fit mode — 0=stretch, 1=contain, 2=cover. Default cover so
  // source aspect is preserved AND the canvas is filled.
  private fitMode = 2;
  // Horizontal-mirror flag for the source. Mostly useful for webcam
  // selfie-flip but works for any source. Flips the SAMPLE UV (not
  // the anchor) so particle layout stays put while the colour reads
  // from the mirrored position.
  private mirrorX = false;
  private texW = 1;
  private texH = 1;

  private viewportW = 1920;
  private viewportH = 1080;
  private startTime = 0;
  private lastFrameTime = 0;
  private needsParticleReset = true;

  readonly stats: PixelParticlesStats = {
    framesEncoded: 0,
    particleCount: 0,
    hasSource: false,
  };

  private constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;

    this.particleBuffer = device.createBuffer({
      size: MAX_PARTICLES * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Globals struct is 160 bytes:
    //   time, dt, total(u32), mode(u32)            → 16
    //   knobs vec4                                  → 16
    //   tex_size vec2 + jitter + light_enabled f32  → 16
    //   light_pos vec4 (xyz=pos, w=intensity)       → 16
    //   light_ambient_height vec4                   → 16
    //   noise_params vec4 (amp_xy, amp_z, freq, speed) → 16
    //   fit_params vec4 (fit_mode, canvas_aspect, _, _) → 16
    //   depth_params vec4                           → 16
    //   depth_motion vec4                           → 16
    //   depth_motion2 vec4                          → 16
    this.globalsBuffer = device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Render uniform: mat4x4 (64) + vec4 meta (16) + vec4 flags (16) = 96
    this.renderUniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sourceSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Build pipelines. Bind groups are deferred until a source
    // texture has been provided (because they need to bind it).
    const computeModule = device.createShaderModule({ code: COMPUTE_WGSL });
    this.computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      ],
    });
    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    this.renderModule = device.createShaderModule({ code: RENDER_WGSL });
    this.renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, sampler: {} },
      ],
    });
    this.renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.renderBindGroupLayout] });
    // Pre-create the default ('add') pipeline so identity / noop case
    // works without a lazy build on first frame.
    this.renderPipeline = this.getOrCreateRenderPipeline('add');

    console.log('[WebGPUPixelParticles] initialised');
  }

  /** Replace the source texture from an image / canvas / bitmap.
   *  Async because some sources (HTMLImageElement that hasn't fully
   *  decoded) need an ImageBitmap roundtrip. For per-frame video
   *  feeds use updateSourceFromVideo() instead — it skips the
   *  bitmap allocation. */
  async setSourceImage(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement): Promise<void> {
    let w: number;
    let h: number;
    if (source instanceof ImageBitmap) {
      w = source.width; h = source.height;
    } else if (source instanceof HTMLVideoElement) {
      w = source.videoWidth; h = source.videoHeight;
    } else if (source instanceof HTMLCanvasElement) {
      w = source.width; h = source.height;
    } else {
      // HTMLImageElement
      w = (source as HTMLImageElement).naturalWidth;
      h = (source as HTMLImageElement).naturalHeight;
    }
    if (w <= 0 || h <= 0) return;

    this.ensureSourceTexture(w, h);
    // copyExternalImageToTexture accepts all of these source types
    // directly — no bitmap intermediate needed.
    this.device.queue.copyExternalImageToTexture(
      { source: source as any },
      { texture: this.sourceTexture },
      [w, h, 1],
    );
    this.rebuildBindGroups();
    this.needsParticleReset = true;
    this.stats.hasSource = true;
    console.log('[WebGPUPixelParticles] source uploaded:', w, 'x', h, '(' + (source.constructor as any).name + ')');
  }

  /** Per-frame video update — copies the current video frame into
   *  the source texture without async/bitmap overhead. Call this on
   *  every encodeFrame for video sources. Handles texture resize
   *  if the video resolution changed (e.g. adaptive streams). */
  updateSourceFromVideo(video: HTMLVideoElement): void {
    if (!video || video.readyState < 2) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w <= 0 || h <= 0) return;
    const sizeChanged = !this.sourceTexture || this.texW !== w || this.texH !== h;
    if (sizeChanged) {
      this.ensureSourceTexture(w, h);
      this.rebuildBindGroups();
      this.stats.hasSource = true;
      this.needsParticleReset = true;
    }
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video as any },
        { texture: this.sourceTexture },
        [w, h, 1],
      );
    } catch {
      // copyExternalImageToTexture can throw if the video is in an
      // intermediate state (seeking, etc.). Skip this frame.
    }
  }

  /** Upload a raw RGBA8 byte buffer straight into the source texture.
   *  Skips the HTMLCanvasElement / ImageBitmap intermediates that the
   *  copyExternalImageToTexture path needs — used by zero-copy capture
   *  feeds (Spout / Syphon) where the IPC layer already hands back a
   *  flat RGBA Uint8Array. Caller guarantees data.byteLength === w*h*4. */
  updateSourceFromBytes(data: Uint8Array, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    if (data.byteLength !== w * h * 4) return; // size mismatch — drop frame
    const sizeChanged = !this.sourceTexture || this.texW !== w || this.texH !== h;
    if (sizeChanged) {
      this.ensureSourceTexture(w, h);
      this.rebuildBindGroups();
      this.needsParticleReset = true;
    }
    try {
      this.device.queue.writeTexture(
        { texture: this.sourceTexture },
        data,
        { bytesPerRow: w * 4, rowsPerImage: h },
        [w, h, 1],
      );
    } catch {
      // Texture in transient state (re-creation racing this upload). Skip.
    }
  }

  /** Update from any drawable canvas (e.g. another layer's render
   *  target). Synchronous, no bitmap overhead. */
  updateSourceFromCanvas(canvas: HTMLCanvasElement): void {
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;
    const sizeChanged = !this.sourceTexture || this.texW !== w || this.texH !== h;
    if (sizeChanged) {
      this.ensureSourceTexture(w, h);
      this.rebuildBindGroups();
      this.stats.hasSource = true;
      this.needsParticleReset = true;
    }
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: canvas as any },
        { texture: this.sourceTexture },
        [w, h, 1],
      );
    } catch { /* canvas in transient state */ }
  }

  private ensureSourceTexture(w: number, h: number): void {
    if (this.sourceTexture && this.texW === w && this.texH === h) return;
    try { this.sourceTexture?.destroy?.(); } catch { /* */ }
    this.sourceTexture = this.device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.texW = w;
    this.texH = h;
  }

  setMode(mode: PixelEffectMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.needsParticleReset = true;
    }
  }

  setKnobs(knobs: [number, number, number, number]): void {
    this.knobs = knobs;
  }

  setBaseSize(size: number): void {
    this.baseSize = Math.max(0.0005, Math.min(0.05, size));
  }

  setOpacity(o: number): void {
    this.opacity = Math.max(0, Math.min(1, o));
  }

  setAnchorJitter(j: number): void {
    this.anchorJitter = Math.max(0, Math.min(1, j));
  }

  setCamera(fovDeg: number, cameraZ: number): void {
    this.fovDeg = Math.max(10, Math.min(120, fovDeg));
    this.cameraZ = Math.max(0.5, Math.min(10, cameraZ));
  }

  /** Camera orbit: yaw + pitch in degrees applied around the world
   *  origin before perspective. Lets the user "place the image"
   *  from the panel without auto-spin. */
  setOrbit(yawDeg: number, pitchDeg: number): void {
    this.cameraYaw = yawDeg;
    this.cameraPitch = pitchDeg;
  }

  /** Pan offset in normalized canvas units. */
  setPan(x: number, y: number): void {
    this.panX = x;
    this.panY = y;
  }

  /** Light source for depth-shift Lambert shading. Position is in
   *  the same world-space the particles live in (XY in [-1,1],
   *  Z is depth — positive values are "in front" of the source plane). */
  setLight(enabled: boolean, x: number, y: number, z: number, intensity: number, ambient: number, heightStrength: number): void {
    this.lightEnabled = enabled;
    this.lightPos = [x, y, z];
    this.lightIntensity = intensity;
    this.lightAmbient = ambient;
    this.lightHeightStrength = heightStrength;
  }

  /** Noise displacement for depth-shift mode. ampXY moves particles
   *  in the XY plane; ampZ pushes them along Z. Both reset to 0 to
   *  disable noise without overhead. */
  setNoise(ampXY: number, ampZ: number, freq: number, speed: number): void {
    this.noiseAmpXY = ampXY;
    this.noiseAmpZ = ampZ;
    this.noiseFreq = freq;
    this.noiseSpeed = speed;
  }

  /** Convert the source image/video into a usable depth field without
   *  leaving the GPU. Luminance is the photographic default; inverse
   *  works for backlit footage; edge-density turns outlines into
   *  relief; saturation gives colorful sources extra dimensionality. */
  setDepthShape(source: PixelDepthSource, curve: number, contrast: number, smoothing: number, center: number): void {
    this.depthSource = source in DEPTH_SOURCE_IDS ? source : 'luminance';
    this.depthCurve = Math.max(0.05, Math.min(4, curve));
    this.depthContrast = Math.max(0.01, Math.min(4, contrast));
    this.depthSmoothing = Math.max(0, Math.min(1, smoothing));
    this.depthCenter = Math.max(0, Math.min(1, center));
  }

  /** Smooth, reversible motion on the depth cloud. This is deliberately
   *  stateless so slider/MIDI/keyframe changes are immediate and do
   *  not leave particles permanently scattered. */
  setDepthMotion(mode: PixelDepthMotion, amount: number, speed: number, scale: number, coupling: number, phase: number): void {
    this.depthMotion = mode in DEPTH_MOTION_IDS ? mode : 'locked';
    this.depthMotionAmount = Math.max(0, Math.min(2, amount));
    this.depthMotionSpeed = Math.max(0, Math.min(4, speed));
    this.depthMotionScale = Math.max(0.1, Math.min(24, scale));
    this.depthMotionCoupling = Math.max(0, Math.min(3, coupling));
    this.depthMotionPhase = phase;
  }

  /** Source fit mode — controls how the source's aspect ratio is
   *  honored when laying out particle anchors. 0=stretch (squashes
   *  to square — legacy behavior), 1=contain (preserve aspect, fit
   *  entirely with letterbox), 2=cover (preserve aspect, fill canvas
   *  with crop). Default 2. */
  setFitMode(mode: number): void {
    this.fitMode = Math.max(0, Math.min(2, Math.round(mode)));
  }

  /** Mirror the source horizontally (selfie-flip for webcams). */
  setMirrorX(on: boolean): void {
    this.mirrorX = !!on;
  }

  setParticleCount(n: number): void {
    const clamped = Math.max(1024, Math.min(MAX_PARTICLES, Math.floor(n)));
    if (clamped !== this.particleCount) {
      this.particleCount = clamped;
      this.needsParticleReset = true;
    }
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
  }

  /** Set the active blend mode by name (matches Layer.blendMode).
   *  Switches the render pipeline to the matching one (lazily
   *  created + cached). Modes that can't be expressed via fixed-
   *  function blending fall back to 'add'.
   *
   *  Supported via WebGPU fixed-function blend:
   *    'normal'   — premultiplied-alpha "over" (the typical layer mix)
   *    'add'      — additive  (default; current behaviour)
   *    'multiply' — src * dst (darkens; great over bright sources)
   *    'screen'   — 1 - (1-src)*(1-dst) (lightens)
   *    'subtract' — dst - src
   *    'darken'   — min(src, dst)
   *    'lighten'  — max(src, dst)
   *  Other modes (overlay, hue, saturation, color-dodge, etc.) need
   *  shader-side dest-read which is being deferred. They fall back
   *  to 'normal' so at least the layer composites instead of pure-add. */
  setBlendMode(mode: string): void {
    if (mode === this.currentBlend) return;
    this.currentBlend = mode;
    this.renderPipeline = this.getOrCreateRenderPipeline(mode);
  }

  private getOrCreateRenderPipeline(mode: string): any {
    const cached = this.renderPipelinesByBlend.get(mode);
    if (cached) return cached;
    const blend = this.blendDescriptorFor(mode);
    const pipeline = this.device.createRenderPipeline({
      layout: this.renderPipelineLayout,
      vertex: { module: this.renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: this.renderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.renderPipelinesByBlend.set(mode, pipeline);
    return pipeline;
  }

  private blendDescriptorFor(mode: string): any {
    // src is premultiplied (vertex shader outputs rgb*alpha, alpha).
    switch (mode) {
      case 'normal':
        return {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        };
      case 'add':
        return {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        };
      case 'multiply':
        // result = src*dst + (1-src.a)*dst → premult-aware multiply
        return {
          color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        };
      case 'screen':
        return {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        };
      case 'subtract':
        return {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'reverse-subtract' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        };
      case 'darken':
        return {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        };
      case 'lighten':
        return {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        };
      default:
        // Modes needing dest-read (overlay/hue/etc) — fall back to
        // 'normal' so the layer at least composites rather than
        // dominating the view via additive.
        return {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        };
    }
  }

  private rebuildBindGroups(): void {
    if (!this.sourceTexture) return;
    const view = this.sourceTexture.createView();
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.globalsBuffer } },
        { binding: 2, resource: view },
        { binding: 3, resource: this.sourceSampler },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
        { binding: 2, resource: view },
        { binding: 3, resource: this.sourceSampler },
      ],
    });
  }

  /** Reset particles to anchor positions, zero velocity, full life.
   *  Compute shader's `identity` branch will park them at their
   *  anchors next dispatch; modes that need lives (sand, dissolve)
   *  start fresh. Cheap — we just zero the buffer. */
  private resetParticles(): void {
    // Zero the whole particle slice. Compute shader will write
    // anchor positions on the next dispatch.
    const zeros = new Float32Array(this.particleCount * (PARTICLE_BYTES / 4));
    // Pre-seed life=1 so dissolve mode starts visible.
    for (let i = 0; i < this.particleCount; i++) {
      zeros[i * 8 + 7] = 1.0;
    }
    this.device.queue.writeBuffer(this.particleBuffer, 0, zeros.buffer, 0, this.particleCount * PARTICLE_BYTES);
    this.needsParticleReset = false;
  }

  /** Build vp = projection × view matrix where view = translate(panX,
   *  panY, -cameraZ) × rotateX(pitch) × rotateY(yaw). Lets the user
   *  orbit + pan + zoom + adjust FOV from the panel. Applies to ALL
   *  modes uniformly so every effect can be framed properly. */
  private computeViewProjection(): Float32Array {
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const fov = (this.fovDeg * Math.PI) / 180;
    const near = 0.1;
    const far = 100.0;
    const f = 1.0 / Math.tan(fov / 2);
    // Standard right-handed perspective into clip with y up
    const proj = new Float32Array(16);
    proj[0] = f / aspect;
    proj[5] = f;
    proj[10] = (far + near) / (near - far);
    proj[11] = -1;
    proj[14] = (2 * far * near) / (near - far);
    // Yaw + pitch rotation around the world origin (so the user
    // is orbiting the source plane, not strafing a free-flying camera).
    const yaw = (this.cameraYaw * Math.PI) / 180;
    const pitch = (this.cameraPitch * Math.PI) / 180;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // rotateY(yaw) — column-major
    const rotY = new Float32Array(16);
    rotY[0] = cy;  rotY[2] = sy;
    rotY[5] = 1;
    rotY[8] = -sy; rotY[10] = cy;
    rotY[15] = 1;
    // rotateX(pitch) — column-major
    const rotX = new Float32Array(16);
    rotX[0] = 1;
    rotX[5] = cp;  rotX[6] = sp;
    rotX[9] = -sp; rotX[10] = cp;
    rotX[15] = 1;
    // pan + translate: column-major translation matrix
    const trans = new Float32Array(16);
    trans[0] = trans[5] = trans[10] = trans[15] = 1;
    trans[12] = this.panX;
    trans[13] = this.panY;
    trans[14] = -this.cameraZ;
    // view = trans × rotX × rotY (apply rotation first, then translate)
    const tx = mat4Mul(rotX, rotY);
    const view = mat4Mul(trans, tx);
    return mat4Mul(proj, view);
  }

  /** Encode a frame: compute pass + render pass. Additive over
   *  finalView. No-op if no source has been provided. */
  encodeFrame(encoder: any, finalView: any, time?: number, frameDt?: number): void {
    if (!this.sourceTexture || !this.computeBindGroup || !this.renderBindGroup) return;
    if (this.needsParticleReset) this.resetParticles();

    const now = performance.now();
    const totalTime = typeof time === 'number' && Number.isFinite(time)
      ? Math.max(0, time)
      : (now - this.startTime) / 1000;
    const dt = typeof frameDt === 'number' && Number.isFinite(frameDt)
      ? Math.max(0, Math.min(0.05, frameDt))
      : Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    // Globals uniform — 160 bytes, see WGSL Globals struct.
    const gu = new ArrayBuffer(160);
    const guF = new Float32Array(gu);
    const guU = new Uint32Array(gu);
    guF[0] = totalTime;
    guF[1] = dt;
    guU[2] = this.particleCount;
    guU[3] = MODE_IDS[this.mode];
    // knobs
    guF[4] = this.knobs[0];
    guF[5] = this.knobs[1];
    guF[6] = this.knobs[2];
    guF[7] = this.knobs[3];
    // tex_size + anchor_jitter + light_enabled
    guF[8] = this.texW;
    guF[9] = this.texH;
    guF[10] = this.anchorJitter;
    guF[11] = this.lightEnabled ? 1 : 0;
    // light_pos vec4 (xyz=position, w=intensity)
    guF[12] = this.lightPos[0];
    guF[13] = this.lightPos[1];
    guF[14] = this.lightPos[2];
    guF[15] = this.lightIntensity;
    // light_ambient_height vec4 (x=ambient, y=heightStrength)
    guF[16] = this.lightAmbient;
    guF[17] = this.lightHeightStrength;
    // noise_params vec4 (amp_xy, amp_z, freq, speed)
    guF[20] = this.noiseAmpXY;
    guF[21] = this.noiseAmpZ;
    guF[22] = this.noiseFreq;
    guF[23] = this.noiseSpeed;
    // fit_params vec4 (fit_mode, canvas_aspect, view_x, view_y)
    // view_extent_y at the planet plane (z=0):
    //   v = 2 * tan(fov/2) * cameraZ
    // and view_x = view_y * canvas_aspect. The compute shader uses
    // these as the BASE anchor extent so STRETCH always fills the
    // canvas regardless of camera zoom / FOV.
    const fovRad = this.fovDeg * Math.PI / 180;
    const canvasAspect = this.viewportW / Math.max(1, this.viewportH);
    const viewY = Math.tan(fovRad * 0.5) * this.cameraZ;
    const viewX = viewY * canvasAspect;
    // fit_params.x is now the source-mirror flag (anchor extent is
    // always the camera view, so the original fit_mode slot was free).
    guF[24] = this.mirrorX ? 1 : 0;
    guF[25] = canvasAspect;
    guF[26] = viewX;
    guF[27] = viewY;
    // depth_params vec4 (source_id, curve, contrast, smoothing)
    guF[28] = DEPTH_SOURCE_IDS[this.depthSource];
    guF[29] = this.depthCurve;
    guF[30] = this.depthContrast;
    guF[31] = this.depthSmoothing;
    // depth_motion vec4 (motion_id, amount, speed, scale)
    guF[32] = DEPTH_MOTION_IDS[this.depthMotion];
    guF[33] = this.depthMotionAmount;
    guF[34] = this.depthMotionSpeed;
    guF[35] = this.depthMotionScale;
    // depth_motion2 vec4 (center, depth coupling, phase, _)
    guF[36] = this.depthCenter;
    guF[37] = this.depthMotionCoupling;
    guF[38] = this.depthMotionPhase;
    this.device.queue.writeBuffer(this.globalsBuffer, 0, gu);

    // Render uniform: vp (16 floats) + mu (4) + flags (4) = 24 floats / 96 B
    const ru = new ArrayBuffer(96);
    const ruF = new Float32Array(ru);
    const vp = this.computeViewProjection();
    ruF.set(vp, 0);
    ruF[16] = this.viewportW / Math.max(1, this.viewportH); // aspect_y
    ruF[17] = this.baseSize;
    ruF[18] = MODE_IDS[this.mode];
    ruF[19] = this.opacity;
    ruF[20] = this.mirrorX ? 1 : 0; // flags.x = mirror_source_x
    ruF[21] = this.particleCount;   // flags.y = total particles
    ruF[22] = this.anchorJitter;     // flags.z = anchor jitter
    // ruF[23] reserved for future flags
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ru);

    // Compute pass
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(this.computePipeline);
    cpass.setBindGroup(0, this.computeBindGroup);
    cpass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
    cpass.end();

    // Render pass — pre-multiplied alpha over finalView so the
    // particles composite naturally with whatever's behind.
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: finalView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    rpass.setPipeline(this.renderPipeline);
    rpass.setBindGroup(0, this.renderBindGroup);
    rpass.draw(6, this.particleCount, 0, 0);
    rpass.end();

    this.stats.framesEncoded++;
    this.stats.particleCount = this.particleCount;
  }

  dispose(): void {
    try { this.particleBuffer?.destroy?.(); } catch { /* */ }
    try { this.globalsBuffer?.destroy?.(); } catch { /* */ }
    try { this.renderUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.sourceTexture?.destroy?.(); } catch { /* */ }
  }
}

// ── Per-mode default knob presets ──
// Keep these in one place so the panel can apply them whenever the
// user picks a new mode. Each tuple matches the `knobs` semantics in
// the compute shader for the corresponding mode.
export const PIXEL_FX_DEFAULT_KNOBS: Record<PixelEffectMode, [number, number, number, number]> = {
  // identity — knobs unused
  'identity':       [0, 0, 0, 0],
  // depth-shift: depth_strength, perspective(unused), spin_speed, spin_axis
  'depth-shift':    [0.6, 0, 0.4, 0],
  // sand-fall: gravity, floor_y, jitter, settle_dt(unused)
  'sand-fall':      [1.4, -1.05, 0.05, 0],
  // scatter: jitter_amp, recovery, noise_freq, _
  'scatter':        [0.04, 1.5, 4.0, 0],
  // halftone: cell_size, size_gain, _, _
  'halftone':       [0.012, 1.0, 0, 0],
  // stipple-noise: wobble_amp, wobble_freq, _, _
  'stipple-noise':  [0.008, 35.0, 0, 0],
  // dissolve: spread, fade_speed, swirl, _
  'dissolve':       [1.6, 0.4, 0.6, 0],
};
