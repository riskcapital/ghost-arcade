import { getGhostGpuRuntime } from './webgpuShared';
import { createAndWarmWgslShaderModule } from './wgsl';

/**
 * WebGPUStrokeParticles — GPU compute particles bound to Light
 * Painting strokes. Reads each stroke's points + brush type +
 * GPU params and renders thousands of particles per stroke that
 * move relative to the stroke's local tangent + normal.
 *
 * Brush types implemented:
 *   spiral    — particles orbit perpendicular to the stroke's tangent
 *               (candy-cane wrap). 3D illusion via tangent-axis offset
 *               + size/alpha modulation by sin(phase).
 *   firefly   — particles spawn on the stroke + drift outward with
 *               curl-noise jitter, sparkle in/out via life cycle.
 *   sap-flow  — particles travel ALONG the stroke at varying t
 *               offsets, like fluid moving through the path.
 *
 * Architecture:
 *
 *   JS side per frame:
 *     1. Collect all visible Light Painting layers from project store
 *     2. Filter strokes whose brush.type is one of the GPU brushes
 *     3. Pack stroke points into a single STORAGE BUFFER (uploaded
 *        only when the stroke set changes — strokes are append-only
 *        in light painting so this is cheap)
 *     4. Pack per-stroke metadata (point count + offset + brush
 *        params + colour) into a UNIFORM-style buffer
 *     5. Dispatch compute shader: one particle per global thread,
 *        each thread looks up its assigned stroke + segment +
 *        phase, computes position from tangent/normal/spiral math
 *     6. Render pass: instanced billboards, additive blend
 *
 *   GPU side:
 *     The compute shader does NOT spawn particles — they live
 *     forever in the buffer as parameterised positions. Each
 *     particle has a stable (stroke_id, segment_t, phase_offset)
 *     that doesn't change frame-to-frame; only the global TIME
 *     varies, which animates phase + drift. This makes the
 *     pipeline stateless across frames — no per-particle history,
 *     no spawn logic, no death conditions. The whole effect can
 *     be reset by changing the stroke set.
 *
 * Particle struct (32 bytes):
 *   stroke_id   u32   which stroke this particle is bound to
 *   seed_t      f32   anchor on the stroke (0..1 along total length)
 *   phase_seed  f32   per-particle phase offset (0..2π) for
 *                     spiral / firefly twinkle desync
 *   pad         u32
 *   pos         vec2  computed each frame (output of compute)
 *   _pad        vec2
 *   color       vec3  per-particle colour (with brush hue shift)
 *   alpha       f32   computed each frame (output, drives glow)
 *
 * Stroke metadata struct (per stroke, 64 bytes):
 *   points_offset   u32   index into the points-buffer
 *   points_count    u32
 *   brush_id        u32   0=spiral, 1=firefly, 2=sap-flow
 *   particle_offset u32   first particle in our slice
 *   particle_count  u32
 *   color_a         vec3  primary brush colour 0..1
 *   color_b         vec3  secondary (for hue cycling)
 *   spiral_radius   f32
 *   spiral_speed    f32
 *   spiral_pitch    f32
 *   particle_drift  f32
 *   glow            f32
 *   size            f32   billboard size in normalized canvas units
 */

import type { LightPaintingStroke, LightPaintingStrokePoint } from '$lib/types';

const PARTICLE_BYTES = 32;
// 96 base bytes (progress_pad ends at 96) + 16 for the taper_curve
// vec4 = 112. Stays aligned to 16-byte vec4 boundaries; uniform
// reads are happy.
const STROKE_META_BYTES = 112;
const POINT_BYTES = 8;                 // vec2 f32 per point
// Byte offset of the progress float within a StrokeMeta. Used by
// updateProgresses() to do a targeted write each frame without
// re-packing the entire meta buffer. Stays at 80 — taper_curve
// goes AFTER progress_pad so this offset is stable.
const STROKE_META_PROGRESS_OFFSET = 80;

const MAX_PARTICLES_TOTAL = 200000;    // hard cap across all strokes
const MAX_STROKES = 256;
const MAX_STROKE_POINTS = 16384;       // total points across all strokes

// HDR float format for the trail accumulator. rgba16float is core
// WebGPU (no feature required) for both render-attachment and
// texture-binding. We pick HDR over rgba8 because additive
// accumulation of bright particles will quickly clip on 8-bit
// and the trail decay multiplier becomes lossy.
// (Untyped literal — the project's tsconfig doesn't pull in the
// @webgpu/types globals, but Vite still emits the right runtime
// strings.)
const TRAIL_FORMAT = 'rgba16float';

// Time constant of the trail's exponential decay, in SECONDS.
// `decay_per_frame = exp(-dt / TRAIL_TAU_SEC)`. Smaller = trails
// fade faster. 0.45s gives glowing streaks that read as motion
// without smearing the whole canvas.
const TRAIL_TAU_SEC = 0.45;

// Brush ID mapping for the compute shader. Must stay in sync with
// the WGSL `if (sm.brush_id == Nu)` branches.
//
// Original organic brushes (0-4) — wrap-around / fluid-style:
//   spiral / firefly / sap-flow / water / smoke
//
// Premium effects brushes (5-9) — port of community's WebGL2 stamps
// to real GPU compute particles for far higher density and a true
// "alive" feel. Visuals modelled after the original fragment-shader
// implementations but with thousands of particles per stroke:
//   galaxy  — spiral arms with star density radiating from each
//             stroke point. Three arm structures + dim field.
//   nebula  — volumetric cloud puffs along the stroke, sampled
//             from fbm noise. Slow breathing pulse.
//   sparkle — high-frequency twinkling specks at small normal
//             offsets along the stroke. Random on/off cycles.
//   vortex  — particles orbit each stroke point with radius
//             oscillating; chromatic aberration via radial colour
//             shift.
//   plasma  — chaotic curl-noise driven turbulence around the
//             stroke. Colour oscillates with internal noise.
export function brushIdFor(t: string): number {
  switch (t) {
    case 'spiral':   return 0;
    case 'firefly':  return 1;
    case 'sap-flow': return 2;
    case 'water':    return 3;
    case 'smoke':    return 4;
    case 'galaxy':   return 5;
    case 'nebula':   return 6;
    case 'sparkle':  return 7;
    case 'vortex':   return 8;
    case 'plasma':   return 9;
    default: return 0;
  }
}

// Brushes that are owned by THIS WebGPU compute renderer. The WebGL2
// fragment-shader path in webglRenderer.ts must sentinel-skip these so
// they don't double-render. Exported so renderer.ts + webglRenderer.ts
// can stay in sync from one source of truth.
export const GPU_PARTICLE_BRUSHES = new Set<string>([
  'spiral', 'firefly', 'sap-flow', 'water', 'smoke',
  'galaxy', 'nebula', 'sparkle', 'vortex', 'plasma',
]);

const COMPUTE_WGSL = /* wgsl */ `
struct Particle {
  stroke_id: u32,
  seed_t: f32,
  phase_seed: f32,
  _pad0: u32,
  pos: vec2<f32>,
  _pad1: vec2<f32>,
  color: vec3<f32>,
  alpha: f32,
};

struct StrokeMeta {
  points_offset: u32,
  points_count: u32,
  brush_id: u32,
  particle_offset: u32,
  particle_count: u32,
  // Number of particles at the START of this stroke's slice that
  // render as "core" — anchored on the stroke centerline with no
  // offset, full alpha. Used by the spiral brush when ShowCore is
  // on so the wrap reads correctly on a 3D surface (back-side
  // particles are culled, the bright core stays visible).
  core_count: u32,
  _pad2: vec2<u32>,
  color_a: vec3<f32>,
  spiral_radius: f32,
  color_b: vec3<f32>,
  spiral_speed: f32,
  spiral_pitch_drift_glow_size: vec4<f32>, // x=pitch, y=drift, z=glow, w=size
  // Per-frame mutable: animation drawing-head position 0..1.
  progress_pad: vec4<f32>,                 // x=progress, y=water_gravity, z=smoke_rise, w=tube_style (0=none,1=glass,2=core-glow)
  taper_curve: vec4<f32>,                  // x=taperStart, y=taperEnd, z=power_curve (1=linear), w=spare
};

struct Globals {
  time: f32,
  dt: f32,
  total_particles: u32,
  total_strokes: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read>       points:    array<vec2<f32>>;
@group(0) @binding(2) var<storage, read>       strokes:   array<StrokeMeta>;
@group(0) @binding(3) var<uniform>             u:         Globals;

// Sample stroke's polyline at parameter t (0..1) along its length.
// Returns position + tangent (normalized) + cumulative length so
// the caller can also compute speed-corrected animation.
struct StrokeSample {
  pos: vec2<f32>,
  tangent: vec2<f32>,
  normal: vec2<f32>,
};

// Variable named 'sm' (StrokeMeta) because WGSL reserves 'meta'.
fn sampleStroke(sm: StrokeMeta, t: f32) -> StrokeSample {
  var out: StrokeSample;
  let n = sm.points_count;
  if (n < 2u) {
    let p = points[sm.points_offset];
    out.pos = p;
    out.tangent = vec2(1.0, 0.0);
    out.normal = vec2(0.0, 1.0);
    return out;
  }
  // Find the segment containing t. Naive: linear search through
  // segments. For long strokes this is O(n) per particle but n is
  // bounded by stroke_points (~thousands) — fine on the GPU.
  let seg_count = n - 1u;
  let scaled = clamp(t, 0.0, 0.9999) * f32(seg_count);
  let seg_idx = u32(floor(scaled));
  let seg_local = scaled - f32(seg_idx);
  let p0 = points[sm.points_offset + seg_idx];
  let p1 = points[sm.points_offset + seg_idx + 1u];
  let dir = p1 - p0;
  let len = length(dir) + 0.000001;
  out.pos = mix(p0, p1, seg_local);
  out.tangent = dir / len;
  // Normal in 2D = perpendicular: rotate tangent 90° (CCW)
  out.normal = vec2(-out.tangent.y, out.tangent.x);
  return out;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.total_particles) { return; }
  var p = particles[i];
  let sid = p.stroke_id;
  if (sid >= u.total_strokes) {
    p.alpha = 0.0;
    particles[i] = p;
    return;
  }
  let sm = strokes[sid];
  let pitch = sm.spiral_pitch_drift_glow_size.x;
  let drift = sm.spiral_pitch_drift_glow_size.y;
  let glow  = sm.spiral_pitch_drift_glow_size.z;
  let size  = sm.spiral_pitch_drift_glow_size.w;

  // core_count > 0 is the SENTINEL FLAG for "wrap-around mode" —
  // the continuous glowing centerline is rendered separately via
  // the SDF tube pipeline. Here it only gates back-side culling
  // of spiral particles. We don't waste any particle slots on
  // dotted core dots anymore.
  let water_gravity = sm.progress_pad.y;
  let smoke_rise    = sm.progress_pad.z;

  // Per-particle brightness jitter for a more "alive" look. Cheap
  // hash on phase_seed → 0.78..1.22 brightness multiplier so the
  // cluster reads as many distinct sparks rather than a uniform mass.
  let jitter = 0.78 + 0.44 * fract(sin(p.phase_seed * 17.137) * 43.5);

  if (sm.brush_id == 0u) {
    // ── SPIRAL (candy cane) ──
    let ss = sampleStroke(sm, p.seed_t);
    let phase = u.time * sm.spiral_speed + p.phase_seed + p.seed_t * pitch * 6.28318530;
    let cosP = cos(phase);
    let sinP = sin(phase);
    let radius = sm.spiral_radius;
    let offset = ss.normal * (cosP * radius);
    p.pos = ss.pos + offset;
    // When core_count > 0 (wrap-around mode is on, SDF tube
    // renders the centerline), HIDE back-side particles entirely
    // so they can't leak through the surface they're meant to
    // wrap around. When core_count == 0 (full 360° helix mode)
    // keep the existing front/back fade so both halves of the
    // spiral are visible.
    let depth = (sinP + 1.0) * 0.5;          // 0..1, 1 = front
    if (sm.core_count > 0u) {
      let front_factor = smoothstep(0.45, 0.6, depth);
      p.alpha = front_factor * glow * jitter;
    } else {
      p.alpha = (0.3 + depth * 0.7) * glow * jitter;
    }
    // Bias toward color_b on the front-half of the wrap so the
    // spiral reads as bicolour rather than washing out.
    p.color = mix(sm.color_a, sm.color_b, depth * 0.5);
  } else if (sm.brush_id == 1u) {
    // ── FIREFLY ──
    // Each firefly has its own phase and lifetime, drifts outward
    // from the stroke as it ages, then dies + respawns at a new
    // anchor. Trail texture turns the drift into glowing streaks.
    let ss = sampleStroke(sm, p.seed_t);
    let lifetime = 2.0 + jitter * 0.8;       // 2..2.6s per spark
    let phase = (u.time + p.phase_seed * lifetime * 1.7) * 0.5;
    let life = fract(phase / lifetime);      // 0..1
    let ang = p.phase_seed * 6.28318530;
    let dir = vec2(cos(ang), sin(ang));
    // Drift accelerates with life so trail spreads like a real spark
    p.pos = ss.pos + dir * drift * life * life;
    let twinkle = sin(phase * 14.0 + p.phase_seed * 5.0) * 0.5 + 0.5;
    // Soft fade in (0..0.1) + linear fade out so motion-blur in the
    // trail texture has clean leading and trailing edges.
    let fade_in = clamp(life * 10.0, 0.0, 1.0);
    let fade_out = 1.0 - life;
    p.alpha = fade_in * fade_out * (0.45 + twinkle * 0.55) * glow * jitter;
    // Color shifts from primary to secondary as it ages — gives the
    // trail a subtle gradient.
    p.color = mix(sm.color_a, sm.color_b, life * 0.6);
  } else if (sm.brush_id == 2u) {
    // ── SAP-FLOW ──
    // Particles travel ALONG the stroke, leaving glowing streaks
    // in the trail texture. Multiple speed bands per particle so
    // the flow doesn't look like a parade of identical dots.
    let speed = 0.22 * (0.7 + jitter * 0.6);
    let t = fract(p.seed_t + u.time * speed + p.phase_seed * 0.1);
    let ss = sampleStroke(sm, t);
    let wobble = sin(u.time * 2.0 + p.phase_seed * 3.0) * drift * 0.4;
    p.pos = ss.pos + ss.normal * wobble;
    let head_dist = abs(t - fract(p.phase_seed * 7.0));
    let intensity = exp(-head_dist * head_dist * 16.0);
    p.alpha = (0.25 + intensity * 0.85) * glow * jitter;
    p.color = mix(sm.color_a, sm.color_b, intensity);
  } else if (sm.brush_id == 3u) {
    // ── WATER (ECTOPLASM) ──
    // Viscous glowing fluid hugging the stroke. Each particle is
    // anchored to a stroke point (seed_t); a low-frequency noise
    // displaces it along the stroke's normal so the cluster
    // undulates slowly like thick fluid. phase_seed splits
    // particles to either side of the stroke (negative / positive
    // offset). High particle density + additive blend = solid
    // glowing tube.
    let ss = sampleStroke(sm, p.seed_t);
    // Low-freq undulation (slow + spatial variation along stroke)
    let n = sin(p.seed_t * 8.0 + u.time * 0.4 * sm.spiral_speed) * 0.5
          + sin(p.seed_t * 13.0 - u.time * 0.27 * sm.spiral_speed) * 0.3;
    // Side: phase_seed < π → left, ≥ π → right. Plus per-particle
    // distance variation within drift radius.
    let side = select(-1.0, 1.0, p.phase_seed > 3.14159);
    let dist_frac = fract(p.phase_seed * 0.318);  // 0..1, deterministic per particle
    let offset_amt = (0.4 + dist_frac * 0.6) * drift * (0.5 + 0.5 * n);
    p.pos = ss.pos + ss.normal * side * offset_amt;
    // Slight gravitational sag (water_gravity) — pulls the cluster
    // downward so it looks like it's hanging off the stroke. 0 =
    // pure flow, higher = heavier sag.
    p.pos.y = p.pos.y + water_gravity * dist_frac * drift * 0.3;
    // Bright core, fades with distance from stroke
    let dist_norm = abs(offset_amt) / max(drift, 0.0001);
    p.alpha = (1.0 - dist_norm * 0.4) * glow * 0.9;
    // Slow color shift between primary and secondary
    let color_phase = sin(u.time * 0.5 + p.seed_t * 2.0) * 0.5 + 0.5;
    p.color = mix(sm.color_a, sm.color_b, color_phase * 0.3);
  } else if (sm.brush_id == 4u) {
    // ── SMOKE ──
    // Particles spawn on the stroke + rise upward over their
    // lifetime, drifting laterally with curl noise. Fade out as
    // they rise. Stateless: position computed analytically from
    // (lifetime, phase_seed, time).
    let lifetime = 3.5;
    let life = fract((u.time + p.phase_seed * lifetime) / lifetime);
    let t_alive = life * lifetime;
    let ss = sampleStroke(sm, p.seed_t);
    // Rise along world-up (y decreases in canvas coords)
    let rise_y = -smoke_rise * t_alive;
    // Lateral drift via curl-noise-ish offset
    let drift_x = sin(t_alive * 1.2 + p.phase_seed * 7.0) * drift * t_alive * 0.5
                + sin(t_alive * 2.7 + p.phase_seed * 11.0) * drift * t_alive * 0.2;
    p.pos = vec2(ss.pos.x + drift_x, ss.pos.y + rise_y);
    // Smoke fades quickly: peak at ~25% life, dies by 100%
    let fade_in = clamp(life * 4.0, 0.0, 1.0);
    let fade_out = 1.0 - life;
    p.alpha = fade_in * fade_out * glow * 0.6;
    p.color = sm.color_a;
  } else if (sm.brush_id == 5u) {
    // ── GALAXY ──
    // Each stroke point is the centre of a small galaxy. Particles
    // distribute into 3 spiral arms + a dim halo + a bright core
    // cluster, governed by phase_seed bands:
    //   phase_seed < 0.15      → bright core stars (small radius)
    //   phase_seed < 0.85      → arm stars (one of N arms, log-spiral)
    //   phase_seed ≥ 0.85      → halo / field stars (random radius)
    // The whole galaxy slowly rotates over time. Colour gradient
    // from color_a (bright centre) to color_b (cooler arms).
    let ss = sampleStroke(sm, p.seed_t);
    let arm_count = max(2.0, floor(pitch * 0.5));   // pitch repurposed as arm count (~2–8)
    let radius_max = sm.spiral_radius;
    let rot_t = u.time * sm.spiral_speed * 0.5;
    // Slot the particle into core / arm / halo by hashing phase_seed
    let band = fract(p.phase_seed * 0.31831);          // 0..1, decorrelated
    var r_norm: f32;
    var ang: f32;
    var bright: f32;
    var col_mix: f32;
    if (band < 0.15) {
      // Bright core star — small radius, full alpha
      r_norm = band / 0.15 * 0.18;                     // 0..0.18
      ang = fract(p.phase_seed * 5.7) * 6.28318530;
      bright = 1.4;
      col_mix = r_norm * 1.5;                          // mostly color_a
    } else if (band < 0.85) {
      // Arm star — log-spiral with N arms
      let armband = (band - 0.15) / 0.70;              // 0..1
      let arm = floor(fract(p.phase_seed * 13.7) * arm_count); // 0..arm_count-1
      r_norm = pow(armband, 0.7);                      // bias toward inner arms
      // Log spiral: ang = arm_angle + log(r) * tightness
      let arm_angle = arm / arm_count * 6.28318530;
      ang = arm_angle + log(r_norm + 0.05) * 3.0 + rot_t;
      // Per-particle scatter perpendicular to the arm so arms have width
      let scatter = (fract(p.phase_seed * 91.3) - 0.5) * 0.18;
      ang = ang + scatter;
      bright = 0.7 + (1.0 - r_norm) * 0.6;
      col_mix = r_norm;                                // outer arms bias to color_b
    } else {
      // Halo / field star — wide ring, sparse, dimmer
      let h = (band - 0.85) / 0.15;
      r_norm = 0.4 + h * 0.6;                          // 0.4..1.0
      ang = fract(p.phase_seed * 23.1) * 6.28318530 + rot_t * 0.3;
      bright = 0.25 + fract(p.phase_seed * 41.7) * 0.35;
      col_mix = 0.7 + h * 0.3;
    }
    let r = r_norm * radius_max;
    let off = vec2(cos(ang), sin(ang)) * r;
    p.pos = ss.pos + off;
    p.alpha = bright * glow * jitter;
    p.color = mix(sm.color_a, sm.color_b, col_mix);
  } else if (sm.brush_id == 6u) {
    // ── NEBULA ──
    // Volumetric cloud puffs along the stroke. Each particle sits
    // at a perturbed offset around its anchor, sampled from
    // low-frequency noise. Slow "breathing" pulse on alpha makes
    // the cloud feel volumetric.
    let ss = sampleStroke(sm, p.seed_t);
    // Drift offset — noise-driven so puffs feel organic.
    let n_seed = p.phase_seed * 5.7;
    let nx = sin(n_seed * 1.3 + u.time * 0.15) * cos(n_seed * 2.7 - u.time * 0.09);
    let ny = cos(n_seed * 1.7 - u.time * 0.13) * sin(n_seed * 3.1 + u.time * 0.07);
    let off_dist = (0.3 + fract(p.phase_seed * 0.917) * 0.7) * drift;
    p.pos = ss.pos + vec2(nx, ny) * off_dist;
    // Breathing pulse — desync'd per particle by phase_seed
    let pulse = sin(u.time * 0.6 + p.phase_seed * 4.3) * 0.5 + 0.5;
    // Falloff with distance from centerline so the cloud has a
    // bright core and softer halo.
    let dist_norm = length(vec2(nx, ny));
    let core_falloff = exp(-dist_norm * dist_norm * 1.8);
    p.alpha = (0.25 + pulse * 0.55) * core_falloff * glow * jitter * 0.85;
    // Mix toward color_b at edges — outer puffs read as cooler.
    p.color = mix(sm.color_a, sm.color_b, dist_norm * 0.6);
  } else if (sm.brush_id == 7u) {
    // ── SPARKLE ──
    // Twinkling specks scattered along the stroke. Each particle
    // has its own twinkle phase (high-frequency on/off cycle).
    // Position: anchored at seed_t with a tiny normal offset so
    // sparkles aren't all stacked on the centerline.
    let ss = sampleStroke(sm, p.seed_t);
    let off_dir = vec2(
      cos(p.phase_seed * 11.3),
      sin(p.phase_seed * 7.1),
    );
    let off_dist = fract(p.phase_seed * 0.6180) * drift * 0.6;
    p.pos = ss.pos + off_dir * off_dist;
    // Twinkle: high-frequency square-ish wave (sharp on, slow off).
    // Each particle has its own period and phase so the cluster
    // sparkles asynchronously.
    let twk_period = 0.6 + fract(p.phase_seed * 31.7) * 1.4;
    let twk_phase = fract((u.time + p.phase_seed * twk_period) / twk_period);
    // Sharp attack (0..0.1), exponential decay (0.1..1.0)
    let twk_a = clamp(twk_phase * 12.0, 0.0, 1.0);
    let twk_b = exp(-(twk_phase - 0.08) * 4.5);
    let twk = twk_a * smoothstep(0.0, 0.5, twk_b);
    p.alpha = twk * glow * jitter * 1.3;
    // Colour shifts toward color_b at peak brightness — gives a
    // subtle bicolour twinkle.
    p.color = mix(sm.color_a, sm.color_b, twk * 0.4);
  } else if (sm.brush_id == 8u) {
    // ── VORTEX ──
    // Particles orbit each stroke point with radius oscillating
    // between min and max — looks like a swirling vortex. Phase
    // advances over time so the swirl rotates. Chromatic
    // aberration: colour shifts based on radial distance.
    let ss = sampleStroke(sm, p.seed_t);
    let radius_max = sm.spiral_radius;
    let orbit_speed = sm.spiral_speed * 2.0;
    // Each particle has its own base radius + orbit phase.
    let r_base = fract(p.phase_seed * 0.318);              // 0..1
    let phase_off = fract(p.phase_seed * 7.13) * 6.28318530;
    let phase = u.time * orbit_speed + phase_off;
    // Radius pulses between 0.4·max and 1.0·max — gives a breathing
    // swirl rather than a fixed ring.
    let r_pulse = 0.4 + 0.6 * (sin(phase * 0.7 + p.phase_seed * 5.0) * 0.5 + 0.5);
    let r = r_base * radius_max * r_pulse;
    let off = vec2(cos(phase), sin(phase)) * r;
    p.pos = ss.pos + off;
    let r_norm = r_base * r_pulse;
    // Chromatic aberration: inner particles → color_a, outer → color_b
    p.color = mix(sm.color_a, sm.color_b, smoothstep(0.2, 1.0, r_norm));
    // Brighter near the centre, fading toward the edge
    p.alpha = (0.4 + (1.0 - r_norm) * 0.7) * glow * jitter;
  } else if (sm.brush_id == 9u) {
    // ── PLASMA ──
    // Chaotic noise-driven turbulence around the stroke. Particles
    // are displaced by a sum of sinusoids (cheap fbm-ish noise)
    // that animates over time. Colour oscillates between primary
    // and secondary with internal noise frequency — gives the
    // characteristic electric/plasma read.
    let ss = sampleStroke(sm, p.seed_t);
    let seed = p.phase_seed;
    // Multi-octave displacement field driven by time
    let nx1 = sin(seed * 3.1 + u.time * sm.spiral_speed * 1.7);
    let ny1 = cos(seed * 2.7 - u.time * sm.spiral_speed * 1.3);
    let nx2 = sin(seed * 7.3 - u.time * sm.spiral_speed * 2.3) * 0.5;
    let ny2 = cos(seed * 5.9 + u.time * sm.spiral_speed * 1.9) * 0.5;
    let disp = vec2(nx1 + nx2, ny1 + ny2);
    p.pos = ss.pos + disp * drift * 0.7;
    // Internal "arc" oscillation — colour switches between primary
    // and secondary on a high-frequency cycle.
    let arc = sin(u.time * 6.0 * sm.spiral_speed + seed * 11.0) * 0.5 + 0.5;
    let arc_mix = smoothstep(0.35, 0.65, arc);
    p.color = mix(sm.color_a, sm.color_b, arc_mix);
    // Bright cluster with a fast crackle modulation
    let crackle = (sin(u.time * 14.0 + seed * 17.0) * 0.5 + 0.5);
    p.alpha = (0.55 + crackle * 0.45) * glow * jitter;
  }

  // ── Animation drawing-head gate ──
  // The stroke's progress is 0..1, advancing as the user's
  // animation timeline plays the stroke. Particles whose anchor
  // (seed_t) is past the head are not yet drawn yet (alpha=0).
  // For sap-flow, the particle's effective head is its current
  // animated t (already wrapped), so we use a soft fade near the
  // boundary so the trail looks natural at the head edge.
  let progress = sm.progress_pad.x;
  if (progress < 0.999) {
    if (sm.brush_id == 2u) {
      // Sap-flow uses animated t internally; gate on the cumulative
      // progress sweeping the source location instead.
      if (p.seed_t > progress) { p.alpha = 0.0; }
    } else {
      // Spiral / firefly: anchored to seed_t. Soft edge so the
      // drawing head doesn't have a hard cliff.
      let edge = 0.04;
      let fade = clamp((progress - p.seed_t) / edge, 0.0, 1.0);
      p.alpha = p.alpha * fade;
    }
  }

  particles[i] = p;
}
`;

const RENDER_WGSL = /* wgsl */ `
struct Particle {
  stroke_id: u32,
  seed_t: f32,
  phase_seed: f32,
  _pad0: u32,
  pos: vec2<f32>,
  _pad1: vec2<f32>,
  color: vec3<f32>,
  alpha: f32,
};

// Same StrokeMeta layout as the compute shader. We read per-stroke
// billboard size from spiral_pitch_drift_glow_size.w + the core_count
// + brush_id so each brush type can render at a different scale.
// Smoke / ectoplasm need MUCH bigger billboards than spiral to read
// as fluid / volumetric instead of dotted particles.
struct StrokeMeta {
  points_offset: u32,
  points_count: u32,
  brush_id: u32,
  particle_offset: u32,
  particle_count: u32,
  core_count: u32,
  _pad2: vec2<u32>,
  color_a: vec3<f32>,
  spiral_radius: f32,
  color_b: vec3<f32>,
  spiral_speed: f32,
  spiral_pitch_drift_glow_size: vec4<f32>,
  progress_pad: vec4<f32>,
  taper_curve: vec4<f32>,
};

struct RU {
  aspect_y: f32,         // viewport aspect compensation (h/w)
  global_scale: f32,     // 1.0 default; ops can globally tweak
  pad: vec2<f32>,
};

@group(0) @binding(0) var<storage, read>      particles: array<Particle>;
@group(0) @binding(1) var<uniform>            u: RU;
@group(0) @binding(2) var<storage, read>      strokes: array<StrokeMeta>;

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

  if (p.alpha <= 0.001) {
    var dead: VSOut;
    dead.clip = vec4(2.0, 2.0, 0.0, 1.0);
    dead.uv = vec2(0.0);
    dead.color = vec4(0.0);
    return dead;
  }

  // Per-stroke base billboard size from meta. Smoke / ectoplasm
  // strokes ship with much larger sizes than spiral so they read
  // as continuous fluid/volume rather than dotted particles.
  let sm = strokes[p.stroke_id];
  let base_size = sm.spiral_pitch_drift_glow_size.w * u.global_scale;

  // Per-stroke taper: width interpolates from taperStart at the
  // stroke head to taperEnd at the tail, with a power curve for
  // shape control. Each particle is anchored at seed_t so we use
  // that as the lerp parameter — particles near the start get the
  // start width, particles near the end get the end width.
  let taper_t = pow(clamp(p.seed_t, 0.0, 1.0), max(sm.taper_curve.z, 0.0001));
  let taper_w = mix(sm.taper_curve.x, sm.taper_curve.y, taper_t);

  let size_mul = (0.4 + clamp(p.alpha, 0.0, 2.0) * 0.4) * taper_w;
  let size_x = base_size * size_mul;
  let size_y = base_size * size_mul * u.aspect_y;
  let world = vec2(p.pos.x + corner.x * size_x,
                    p.pos.y + corner.y * size_y);
  let clip_pos = vec2(world.x * 2.0 - 1.0, 1.0 - world.y * 2.0);

  var out: VSOut;
  out.clip = vec4(clip_pos, 0.0, 1.0);
  out.uv = corner * 0.5 + 0.5;
  out.color = vec4(p.color * p.alpha, p.alpha);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let d = length(in.uv - 0.5) * 2.0;
  if (d > 1.0) { discard; }
  // Three-band falloff: searing core + bright halo + wide bloom.
  // The bloom band is what gives the particle a sense of luminosity
  // when accumulated additively into the trail texture rather than
  // looking like a hard dot. Tuned so a cluster of 100 particles
  // overlapping reads as a continuous glowing volume.
  let core  = exp(-d * d * 11.0);
  let halo  = exp(-d * d * 3.0) * 0.55;
  let bloom = exp(-d * d * 0.7) * 0.18;
  let intensity = (core + halo + bloom) * in.color.a;
  // in.color.rgb already premultiplied with particle alpha by VS;
  // multiplying by intensity gives correct additive contribution.
  return vec4(in.color.rgb * intensity * 1.4, intensity);
}
`;

// ── Stroke Tube SDF renderer ──
// Draws a thick continuous glowing line along a stroke by emitting
// one quad per segment (instanced). The fragment shader computes
// distance from the pixel to the segment centerline and outputs a
// glowing falloff — bright core + soft halo. This is what makes the
// "wrap-around" mode read as a tube rather than a row of dots:
// particles can never form a smooth continuous line via additive
// blending alone (gaps + bumps), but SDF geometry is genuinely
// continuous.
//
// One pipeline, one bind group, but a separate `draw()` call per
// stroke with `corePerStrokeBuffer` updated between draws to point
// at the right stroke meta.
const TUBE_WGSL = /* wgsl */ `
struct StrokeMeta {
  points_offset: u32,
  points_count: u32,
  brush_id: u32,
  particle_offset: u32,
  particle_count: u32,
  core_count: u32,
  _pad2: vec2<u32>,
  color_a: vec3<f32>,
  spiral_radius: f32,
  color_b: vec3<f32>,
  spiral_speed: f32,
  spiral_pitch_drift_glow_size: vec4<f32>,
  progress_pad: vec4<f32>,
  taper_curve: vec4<f32>,
};

struct TubeGlobals {
  aspect_y: f32,
  pad: vec3<f32>,
};

struct TubePerStroke {
  stroke_id: u32,
  pad: vec3<u32>,
};

@group(0) @binding(0) var<storage, read>  strokes: array<StrokeMeta>;
@group(0) @binding(1) var<storage, read>  points: array<vec2<f32>>;
@group(0) @binding(2) var<uniform>        u: TubeGlobals;
@group(0) @binding(3) var<uniform>        ps: TubePerStroke;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) side: f32,        // -1..+1 across the tube width
  @location(1) along_t: f32,     // 0..1 along the stroke
};

// Per-brush container radius — how wide the glass tube needs to
// be to enclose the particles for that brush type. Returns radius
// in normalized canvas units (matches the rest of the pipeline).
//
//  spiral   : orbit_radius * scale       (orbit lives at orbit_radius)
//  firefly  : drift * scale               (sparks drift up to drift)
//  sap-flow : drift * 0.6 * scale         (small wobble around stroke)
//  water    : drift * 1.05 * scale        (cluster + sag)
//  smoke    : 0.04 * scale                 (particles rise/diffuse;
//                                           fixed slim chimney)
//
// _pad2.x carries the user's per-brush scale multiplier
// (u32(round(scale * 1000))) so we can carry a per-brush radius
// scaler without re-padding the struct. Falls back to 1.25 when unset.
fn glassTubeWidth(sm: StrokeMeta) -> f32 {
  let drift = sm.spiral_pitch_drift_glow_size.y;
  let scale_q = sm._pad2.x;
  let scale = max(0.5, f32(scale_q) * 0.001);
  if (sm.brush_id == 0u) {
    return sm.spiral_radius * scale;
  } else if (sm.brush_id == 1u) {
    return drift * scale;
  } else if (sm.brush_id == 2u) {
    return drift * 0.6 * scale;
  } else if (sm.brush_id == 3u) {
    return drift * 1.05 * scale;
  } else if (sm.brush_id == 4u) {
    return 0.04 * scale;
  }
  return sm.spiral_pitch_drift_glow_size.w * 1.6;
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) seg_id: u32) -> VSOut {
  let sm = strokes[ps.stroke_id];
  // Skip if seg_id is past the stroke's segment count
  let seg_count = sm.points_count - 1u;
  if (seg_id >= seg_count) {
    var dead: VSOut;
    dead.clip = vec4(2.0, 2.0, 0.0, 1.0);
    dead.side = 0.0;
    dead.along_t = 0.0;
    return dead;
  }
  let p0 = points[sm.points_offset + seg_id];
  let p1 = points[sm.points_offset + seg_id + 1u];
  let dir = p1 - p0;
  let len = length(dir) + 0.000001;
  let tangent = dir / len;
  // Normal in 2D: rotate tangent 90° CCW. Aspect-corrected on the
  // y axis so the tube is round, not oval-stretched.
  let normal_raw = vec2(-tangent.y, tangent.x);
  let normal = vec2(normal_raw.x, normal_raw.y * u.aspect_y);
  // Width depends on tube style:
  //   1 = glass container — auto-sized to hold particles
  //   2 = solid glow centerline (current wrap-around mode core)
  let style = u32(round(sm.progress_pad.w));
  var base_width: f32;
  if (style == 1u) {
    base_width = glassTubeWidth(sm);
  } else {
    // Solid glow centerline — tight billboard-sized line
    base_width = sm.spiral_pitch_drift_glow_size.w * 1.6;
  }

  // Two triangles forming the segment quad.
  // vid: 0=start-left, 1=start-right, 2=end-left, 3=end-left, 4=start-right, 5=end-right
  var along_arr = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
  var side_arr  = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);
  let along = along_arr[vid];
  let side = side_arr[vid];

  // Position along stroke for the current vertex, used for the
  // taper width lerp + the progress-gating output.
  let along_in_stroke = (f32(seg_id) + along) / max(f32(seg_count), 1.0);
  // Taper: width scales between taperStart and taperEnd along the
  // stroke. Power curve on z for shape control. This is what lets
  // a single stroke render as a tapered tube — thick base, thin
  // tip — for tree branch wraparound projections.
  let taper_t = pow(clamp(along_in_stroke, 0.0, 1.0), max(sm.taper_curve.z, 0.0001));
  let taper_w = mix(sm.taper_curve.x, sm.taper_curve.y, taper_t);
  let width = base_width * taper_w;

  let pos = mix(p0, p1, along) + normal * side * width;
  let clip_pos = vec2(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0);

  var out: VSOut;
  out.clip = vec4(clip_pos, 0.0, 1.0);
  out.side = side;
  out.along_t = along_in_stroke;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let sm = strokes[ps.stroke_id];
  let progress = sm.progress_pad.x;
  // Animation gating with a soft edge at the drawing head so it
  // doesn't pop in.
  if (in.along_t > progress + 0.01) { discard; }
  let edge_fade = clamp((progress - in.along_t) * 50.0, 0.0, 1.0);

  let glow = sm.spiral_pitch_drift_glow_size.z;
  let d = abs(in.side);
  let style = u32(round(sm.progress_pad.w));

  if (style == 1u) {
    // ── GLASS CONTAINER ──
    // Fake-3D translucent cylinder. The 2D quad represents the
    // side projection of a round tube; brightness picks up at the
    // silhouette (rim) like a fresnel reflection on glass, plus a
    // faint inner highlight from the curved front surface. Result:
    // the particles inside read as if they're enclosed in a
    // luminous tube.
    if (d > 1.0) { discard; }
    // Curved depth: 1 at center, 0 at rim. Used for inner shading.
    let depth = sqrt(max(0.0, 1.0 - d * d));
    // Rim: narrow, bright band hugging the silhouette. pow(d,6) is
    // sharp enough that the rim doesn't bleed across the whole tube.
    let rim = pow(d, 6.0) * 1.4;
    // Inner highlight: subtle curvature shading so the tube reads
    // as round, not flat.
    let inner = depth * 0.10;
    // Body tint: very faint colored haze across the whole interior
    // so even an empty tube has a "glass with light in it" feel.
    let body = (1.0 - d * d) * 0.06;
    // Unpack the dedicated tube color from _pad2.y (R<<16 | G<<8 | B,
    // 0-255 per channel) so the glass can be tinted independently of
    // the particle color.
    let packed = sm._pad2.y;
    let tube_r = f32((packed >> 16u) & 0xffu) / 255.0;
    let tube_g = f32((packed >> 8u)  & 0xffu) / 255.0;
    let tube_b = f32( packed         & 0xffu) / 255.0;
    let tube_color = vec3<f32>(tube_r, tube_g, tube_b);
    // Subtle iridescent shift at the rim — a hint of color_b
    // mixed in based on rim intensity. Gives the glass that
    // "container is alive" pop. The base is the dedicated tube
    // color desaturated toward white for the body, with a touch of
    // particle's secondary color leaking in at the rim.
    let tint_mix = clamp(rim * 0.5, 0.0, 1.0);
    let tint = mix(mix(tube_color, vec3(1.0), 0.35),
                   sm.color_b,
                   tint_mix * 0.25);
    let intensity = (rim + inner + body) * glow * 0.9 * edge_fade;
    return vec4(tint * intensity, intensity);
  }

  // ── SOLID GLOW CENTERLINE (default / wrap-around core) ──
  let core_intensity = exp(-d * d * 7.0);
  let halo_intensity = exp(-d * d * 1.4) * 0.45;
  let intensity = (core_intensity + halo_intensity) * glow * 1.2 * edge_fade;
  return vec4(sm.color_a * intensity, intensity);
}
`;

// ── Trail accumulator pipeline ──
// Two render-target textures (rgba16float) that ping-pong each
// frame. Particles render into the "write" texture additively;
// before that, a decay pass copies the previous "read" texture
// into "write" multiplied by a decay factor (so the previous
// frame's contribution fades). Then a final pass composites the
// trail texture additively over finalView. Net effect: every
// particle leaves a glowing streak that fades over ~0.5s. This
// is what makes the GPU brushes read as REAL particle simulation
// rather than a cloud of independent dots — motion is visible.
//
// All passes share a full-screen-triangle vertex shader.
const FULLSCREEN_VS_WGSL = /* wgsl */ `
struct V {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex
fn vs_full(@builtin(vertex_index) vid: u32) -> V {
  // 3 vertices forming a single oversized triangle that covers
  // the whole viewport. Cheaper than two-triangle quads + avoids
  // diagonal seam artefacts. UV mapped so (0,0) = top-left,
  // (1,1) = bottom-right of the viewport.
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  var out: V;
  out.clip = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2(x, y);
  return out;
}
`;

const DECAY_WGSL = /* wgsl */ `
${FULLSCREEN_VS_WGSL}
struct DecayU {
  decay: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};
@group(0) @binding(0) var src:  texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: DecayU;
@fragment
fn fs_decay(in: V) -> @location(0) vec4<f32> {
  let c = textureSample(src, samp, in.uv);
  return c * u.decay;
}
`;

const COMPOSITE_WGSL = /* wgsl */ `
${FULLSCREEN_VS_WGSL}
@group(0) @binding(0) var src:  texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@fragment
fn fs_comp(in: V) -> @location(0) vec4<f32> {
  let c = textureSample(src, samp, in.uv);
  return c;
}
`;

// CPU-side stroke registration. The presenter calls setStrokes()
// whenever the project's stroke set changes; the upload pipeline
// re-packs the GPU buffers and assigns particle slots to strokes
// proportional to their gpuParticleCount budgets.

export type GPUBrushKind =
  | 'spiral' | 'firefly' | 'sap-flow' | 'water' | 'smoke'
  | 'galaxy' | 'nebula' | 'sparkle' | 'vortex' | 'plasma';

export interface StrokeForGPU {
  id: string;
  brushType: GPUBrushKind;
  points: LightPaintingStrokePoint[];
  colorA: [number, number, number];   // 0..1
  colorB: [number, number, number];   // 0..1
  particleCount: number;
  spiralRadius: number;
  spiralSpeed: number;
  spiralPitch: number;
  particleDrift: number;
  glow: number;
  sizeUV: number;
  /** Animation drawing-head progress 0..1. */
  progress: number;
  /** Spiral only: render glowing core stroke + cull back-side
   *  particles. */
  showCore: boolean;
  /** Water only: gravitational sag (0=pure flow, 2=heavy hang). */
  waterGravity: number;
  /** Smoke only: rise speed multiplier. */
  smokeRise: number;
  /** Translucent glass-tube container around the stroke that
   *  visually encloses the particles. 0 = no tube, 1 = glass
   *  container, 2 = solid glow centerline (used internally for
   *  spiral wrap-around mode — set via showCore, not directly). */
  tubeStyle: 0 | 1 | 2;
  /** Multiplier on the auto-computed glass-tube radius. 1.0 fits
   *  particles snugly; >1 looser. */
  glassTubeRadiusScale: number;
  /** Glass-tube color, RGB 0..1. Independent of particle color
   *  (color_a / color_b) so the container can be tinted separately
   *  from its contents. Packed into _pad2.y as 8-bit-per-channel. */
  glassTubeColor: [number, number, number];
  /** Width multiplier at the start of the stroke (progress=0).
   *  1.0 = full size, 0.0 = pinched. */
  taperStart: number;
  /** Width multiplier at the end of the stroke (progress=1). */
  taperEnd: number;
  /** Power exponent on the taper interpolation (1=linear). */
  taperCurve: number;
}

export interface WebGPUStrokeParticlesStats {
  framesEncoded: number;
  totalParticles: number;
  totalStrokes: number;
  totalPoints: number;
}

export class WebGPUStrokeParticles {
  static async create(device: any, presentFormat: any): Promise<WebGPUStrokeParticles> {
    return new WebGPUStrokeParticles(device, presentFormat);
  }

  readonly device: any;
  readonly presentFormat: any;

  private particleBuffer: any;        // size = MAX_PARTICLES_TOTAL * PARTICLE_BYTES
  private pointsBuffer: any;          // size = MAX_STROKE_POINTS * POINT_BYTES
  private strokeMetaBuffer: any;      // size = MAX_STROKES * STROKE_META_BYTES
  private globalsBuffer: any;         // 16 bytes
  private renderUniformBuffer: any;   // 16 bytes

  private computePipeline: any;
  private renderPipeline: any;
  private computeBindGroup: any;
  private renderBindGroup: any;

  // SDF tube pipeline — used for the spiral "wrap-around" mode core
  // line (and any future brush type that wants a continuous glowing
  // tube along the stroke). One uniform buffer holds the current
  // stroke_id; encodeFrame writes it once per stroke before each
  // tube draw call.
  private tubePipeline: any;
  private tubeBindGroup: any;
  private tubeGlobalsBuffer: any;     // 16 bytes — aspect_y + pad
  private tubePerStrokeBuffer: any;   // 16 bytes — stroke_id + pad
  // Cache of which strokes need the SDF tube pass per frame.
  // Populated by setStrokes (showCore=true → push stroke index).
  private strokeIndexesNeedingTube: number[] = [];
  // Cache of segment count per stroke — also populated by setStrokes
  // so encodeFrame doesn't need to re-walk the points.
  private strokeSegmentCounts: number[] = [];

  // ── Trail accumulator pipeline ──
  // Two ping-pong textures + decay/composite pipelines.
  // renderPipelineTrail is a duplicate of renderPipeline that
  // targets TRAIL_FORMAT instead of presentFormat so we can render
  // particles into the trail texture.
  private trailsEnabled = true;
  private trailW = 0;
  private trailH = 0;
  private trailTexA: any = null;
  private trailTexB: any = null;
  private trailViewA: any = null;
  private trailViewB: any = null;
  private trailFlipped = false;       // false: write→B, read←A; true: write→A, read←B
  private trailSampler: any = null;
  private renderPipelineTrail: any = null;   // particles → TRAIL_FORMAT (additive)
  private decayPipeline: any = null;         // fullscreen blit w/ multiply
  private decayBGL: any = null;
  private compositePipeline: any = null;     // fullscreen additive into presentFormat
  private compositeBGL: any = null;
  private decayBindGroupA: any = null;       // reads texA
  private decayBindGroupB: any = null;       // reads texB
  private compositeBindGroupA: any = null;   // reads texA
  private compositeBindGroupB: any = null;   // reads texB
  private decayUniformBuffer: any = null;    // 16 bytes — decay multiplier

  private currentTotalParticles = 0;
  private currentTotalStrokes = 0;
  private currentTotalPoints = 0;
  private startTime = 0;
  private lastFrameTime = 0;
  private lastUploadHash = '';
  private viewportW = 1920;
  private viewportH = 1080;

  readonly stats: WebGPUStrokeParticlesStats = {
    framesEncoded: 0,
    totalParticles: 0,
    totalStrokes: 0,
    totalPoints: 0,
  };

  private constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;

    // Allocate max-sized buffers up front. Re-allocating per stroke
    // change would churn GPU memory; we use offsets instead.
    this.particleBuffer = device.createBuffer({
      size: MAX_PARTICLES_TOTAL * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.pointsBuffer = device.createBuffer({
      size: MAX_STROKE_POINTS * POINT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.strokeMetaBuffer = device.createBuffer({
      size: MAX_STROKES * STROKE_META_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.globalsBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Initialise particles as all-dead (alpha=0)
    const zeroParticles = new Float32Array((MAX_PARTICLES_TOTAL * PARTICLE_BYTES) / 4);
    device.queue.writeBuffer(this.particleBuffer, 0, zeroParticles.buffer);

    const shaderRuntime = getGhostGpuRuntime() ?? device;
    const computeModule = createAndWarmWgslShaderModule(shaderRuntime, COMPUTE_WGSL, 'stroke-particles/compute');
    const computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });
    this.computeBindGroup = device.createBindGroup({
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.pointsBuffer } },
        { binding: 2, resource: { buffer: this.strokeMetaBuffer } },
        { binding: 3, resource: { buffer: this.globalsBuffer } },
      ],
    });

    const renderModule = createAndWarmWgslShaderModule(shaderRuntime, RENDER_WGSL, 'stroke-particles/render');
    const renderBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
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
    this.renderBindGroup = device.createBindGroup({
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
        { binding: 2, resource: { buffer: this.strokeMetaBuffer } },
      ],
    });

    // ── SDF tube pipeline (continuous glowing centerline for the
    // wrap-around mode) ──
    // NOTE on sizes: TubeGlobals + TubePerStroke each contain a
    // vec3 alongside a leading scalar. WGSL struct rules force 16-
    // byte alignment for the vec3, which pads the struct from 16
    // up to 32 bytes. Buffers MUST match the padded size or the
    // pipeline barfs ("binding too small, requires at least 32
    // bytes"). Allocate 32 even though we only write 16 of meaningful
    // data — the trailing 16 stays zero, which matches the shader
    // pad fields exactly.
    this.tubeGlobalsBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.tubePerStrokeBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const tubeModule = createAndWarmWgslShaderModule(shaderRuntime, TUBE_WGSL, 'stroke-particles/tube');
    const tubeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.tubePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [tubeBGL] }),
      vertex: { module: tubeModule, entryPoint: 'vs_main' },
      fragment: {
        module: tubeModule,
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
    this.tubeBindGroup = device.createBindGroup({
      layout: tubeBGL,
      entries: [
        { binding: 0, resource: { buffer: this.strokeMetaBuffer } },
        { binding: 1, resource: { buffer: this.pointsBuffer } },
        { binding: 2, resource: { buffer: this.tubeGlobalsBuffer } },
        { binding: 3, resource: { buffer: this.tubePerStrokeBuffer } },
      ],
    });

    // ── Trail accumulator pipelines ──
    // 1. Particle render pipeline targeting TRAIL_FORMAT (so we can
    //    render into the trail texture). Same shader code as the
    //    direct-to-presentFormat pipeline; only the target format
    //    differs.
    // 2. Decay full-screen pipeline (read previous trail, write
    //    decayed; replace blend so the destination starts faded
    //    instead of accumulating from black).
    // 3. Composite full-screen pipeline (read trail, write to
    //    presentFormat finalView; additive blend).
    this.renderPipelineTrail = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: TRAIL_FORMAT,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.trailSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    this.decayUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const decayModule = createAndWarmWgslShaderModule(shaderRuntime, DECAY_WGSL, 'stroke-particles/decay');
    this.decayBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.decayPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.decayBGL] }),
      vertex: { module: decayModule, entryPoint: 'vs_full' },
      fragment: {
        module: decayModule,
        entryPoint: 'fs_decay',
        targets: [{
          format: TRAIL_FORMAT,
          // Replace blend — decay overwrites the trail target with the
          // faded previous frame. Particle pass after this adds onto it.
          blend: {
            color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const compositeModule = createAndWarmWgslShaderModule(shaderRuntime, COMPOSITE_WGSL, 'stroke-particles/composite');
    this.compositeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    this.compositePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.compositeBGL] }),
      vertex: { module: compositeModule, entryPoint: 'vs_full' },
      fragment: {
        module: compositeModule,
        entryPoint: 'fs_comp',
        targets: [{
          format: presentFormat,
          // Additive over the editor canvas / VJ output already drawn
          // into finalView. Trails glow on top of whatever's behind.
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    console.log('[WebGPUStrokeParticles] initialised, capacity:',
      MAX_PARTICLES_TOTAL.toLocaleString(), 'particles across',
      MAX_STROKES, 'strokes (trails:', this.trailsEnabled, ')');
  }

  /**
   * Allocate or re-allocate the ping-pong trail textures + their
   * bind groups whenever the viewport changes size. Idempotent —
   * cheap to call every frame.
   */
  private ensureTrailTextures(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    if (this.trailW === w && this.trailH === h && this.trailTexA && this.trailTexB) return;
    // Destroy old textures if they exist (resize path)
    try { this.trailTexA?.destroy?.(); } catch { /* noop */ }
    try { this.trailTexB?.destroy?.(); } catch { /* noop */ }
    this.trailW = w;
    this.trailH = h;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.trailTexA = this.device.createTexture({
      size: [w, h, 1],
      format: TRAIL_FORMAT,
      usage,
    });
    this.trailTexB = this.device.createTexture({
      size: [w, h, 1],
      format: TRAIL_FORMAT,
      usage,
    });
    this.trailViewA = this.trailTexA.createView();
    this.trailViewB = this.trailTexB.createView();

    // Bind groups for decay + composite. Decay reads "previous"
    // trail (the one we wrote into LAST frame) and writes (via render
    // pass attachment) into "current". Composite reads "current"
    // (just-written this frame) and additively blends into finalView.
    this.decayBindGroupA = this.device.createBindGroup({
      layout: this.decayBGL,
      entries: [
        { binding: 0, resource: this.trailViewA },
        { binding: 1, resource: this.trailSampler },
        { binding: 2, resource: { buffer: this.decayUniformBuffer } },
      ],
    });
    this.decayBindGroupB = this.device.createBindGroup({
      layout: this.decayBGL,
      entries: [
        { binding: 0, resource: this.trailViewB },
        { binding: 1, resource: this.trailSampler },
        { binding: 2, resource: { buffer: this.decayUniformBuffer } },
      ],
    });
    this.compositeBindGroupA = this.device.createBindGroup({
      layout: this.compositeBGL,
      entries: [
        { binding: 0, resource: this.trailViewA },
        { binding: 1, resource: this.trailSampler },
      ],
    });
    this.compositeBindGroupB = this.device.createBindGroup({
      layout: this.compositeBGL,
      entries: [
        { binding: 0, resource: this.trailViewB },
        { binding: 1, resource: this.trailSampler },
      ],
    });

    // Reset flip-state so frame ordering stays sane after resize.
    this.trailFlipped = false;
    console.log('[WebGPUStrokeParticles] trail textures allocated:', w, 'x', h);
  }

  /** Toggle persistent trails. When off, particles render directly
   *  to finalView with no decay accumulation (the original stateless
   *  look). Default: on. */
  setTrailsEnabled(enabled: boolean): void {
    this.trailsEnabled = enabled;
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
  }

  /** Upload the current set of GPU-brush strokes. Hash-keyed on the
   *  IMMUTABLE bits (id, brush params, points) so it's a no-op when
   *  only `progress` has changed (animation in flight). Use
   *  `updateProgresses()` per frame for the cheap per-stroke
   *  progress write. */
  setStrokes(strokes: StrokeForGPU[]): void {
    const hash = strokes.map(s =>
      `${s.id}:${s.brushType}:${s.points.length}:${s.particleCount}:${s.spiralRadius}:${s.spiralPitch}:${s.spiralSpeed}:${s.particleDrift}:${s.glow}:${s.sizeUV}:${s.colorA.join(',')}:${s.colorB.join(',')}:${s.tubeStyle}:${s.showCore ? 1 : 0}:${s.glassTubeRadiusScale}:${s.glassTubeColor.join(',')}:${s.waterGravity}:${s.smokeRise}:${s.taperStart}:${s.taperEnd}:${s.taperCurve}`
    ).join('|');
    if (hash === this.lastUploadHash) return;
    this.lastUploadHash = hash;

    // Allocate slices: each stroke gets `particleCount` particles
    // contiguously in the global buffer. Strokes also pack points
    // contiguously in the points buffer.
    let pointCursor = 0;
    let particleCursor = 0;
    const metaArr = new ArrayBuffer(MAX_STROKES * STROKE_META_BYTES);
    const metaF = new Float32Array(metaArr);
    const metaU = new Uint32Array(metaArr);
    const pointArr = new Float32Array(MAX_STROKE_POINTS * 2);
    // Reset per-frame tube tracking. Populated below for any stroke
    // with showCore=true so encodeFrame can dispatch one tube draw
    // per such stroke. Index points into the strokes meta buffer
    // (i.e. matches the position in `strokes` we're about to write).
    this.strokeIndexesNeedingTube = [];
    this.strokeSegmentCounts = [];

    // Initialise particles for each stroke. Each particle gets a
    // stable seed_t (anchor along the stroke) and phase_seed (per-
    // particle offset for spiral / firefly desync). These don't
    // change frame-to-frame — only the time uniform animates them.
    const particleArr = new Float32Array((MAX_PARTICLES_TOTAL * PARTICLE_BYTES) / 4);

    for (let s = 0; s < strokes.length && s < MAX_STROKES; s++) {
      const stroke = strokes[s];
      // Cap to remaining capacity
      const remainingPoints = MAX_STROKE_POINTS - pointCursor;
      const remainingParticles = MAX_PARTICLES_TOTAL - particleCursor;
      const ptsToUse = Math.min(stroke.points.length, remainingPoints);
      const partsToUse = Math.min(stroke.particleCount, remainingParticles);
      if (ptsToUse < 2 || partsToUse < 1) break;

      // Pack stroke meta — see WGSL StrokeMeta for the layout.
      const mO = s * (STROKE_META_BYTES / 4); // float index
      metaU[mO + 0] = pointCursor;            // points_offset
      metaU[mO + 1] = ptsToUse;               // points_count
      metaU[mO + 2] = brushIdFor(stroke.brushType); // brush_id
      metaU[mO + 3] = particleCursor;         // particle_offset
      metaU[mO + 4] = partsToUse;             // particle_count
      // core_count: spiral brush ShowCore allocates the first ~25%
      // of particles to render as the glowing centerline. Other
      // brushes set this to 0.
      // core_count is now a SENTINEL flag (1 vs 0) for "wrap-around
      // mode is on" rather than a particle allocation count. The
      // continuous glowing centerline is rendered as a real SDF
      // tube via tubePipeline (see encodeFrame). The compute shader
      // still checks `core_count > 0` to enable back-side culling
      // of spiral particles so only the front-half of the wrap is
      // visible. Setting to 1 instead of e.g. 50% means we don't
      // waste any particle budget on dotted core dots — they all
      // go to the spiral wrap.
      const coreCount = (stroke.brushType === 'spiral' && stroke.showCore) ? 1 : 0;
      metaU[mO + 5] = coreCount;
      // _pad2.x (mO+6) = quantised glass-tube radius scale
      // (u32(round(scale * 1000))) so the WGSL shader can read it
      // without introducing another vec4. Default 1250 = 1.25× fit.
      // _pad2.y (mO+7) = packed glass-tube color: u32 with R in
      // bits 16-23, G in bits 8-15, B in bits 0-7. Same precision
      // as the source (which is already 0-255 per channel).
      const radiusScaleQ = Math.max(500, Math.min(3000, Math.round((stroke.glassTubeRadiusScale ?? 1.25) * 1000)));
      metaU[mO + 6] = radiusScaleQ;
      const tcR = Math.max(0, Math.min(255, Math.round(stroke.glassTubeColor[0] * 255)));
      const tcG = Math.max(0, Math.min(255, Math.round(stroke.glassTubeColor[1] * 255)));
      const tcB = Math.max(0, Math.min(255, Math.round(stroke.glassTubeColor[2] * 255)));
      metaU[mO + 7] = ((tcR & 0xff) << 16) | ((tcG & 0xff) << 8) | (tcB & 0xff);
      metaF[mO + 8]  = stroke.colorA[0];      // color_a.r
      metaF[mO + 9]  = stroke.colorA[1];
      metaF[mO + 10] = stroke.colorA[2];
      metaF[mO + 11] = stroke.spiralRadius;   // spiral_radius
      metaF[mO + 12] = stroke.colorB[0];      // color_b.r
      metaF[mO + 13] = stroke.colorB[1];
      metaF[mO + 14] = stroke.colorB[2];
      metaF[mO + 15] = stroke.spiralSpeed;
      metaF[mO + 16] = stroke.spiralPitch;
      metaF[mO + 17] = stroke.particleDrift;
      metaF[mO + 18] = stroke.glow;
      metaF[mO + 19] = stroke.sizeUV;
      // progress_pad: x=progress, y=water_gravity, z=smoke_rise,
      // w=tube_style (0=none,1=glass,2=core-glow). mO+20 corresponds
      // to byte offset STROKE_META_PROGRESS_OFFSET.
      metaF[mO + 20] = stroke.progress;
      metaF[mO + 21] = stroke.waterGravity;
      metaF[mO + 22] = stroke.smokeRise;
      // Resolve the effective tube style: explicit tubeStyle wins,
      // but the legacy spiral+showCore combo still drives style 2
      // (solid glow centerline) when no explicit style is set, so
      // existing wrap-around projects keep working unchanged.
      let effectiveTubeStyle = stroke.tubeStyle;
      if (effectiveTubeStyle === 0 && stroke.brushType === 'spiral' && stroke.showCore) {
        effectiveTubeStyle = 2;
      }
      metaF[mO + 23] = effectiveTubeStyle;
      // taper_curve vec4 — at byte offset 96 (mO+24..27).
      // x=taperStart, y=taperEnd, z=power_curve, w=spare.
      metaF[mO + 24] = Math.max(0, Math.min(2, stroke.taperStart));
      metaF[mO + 25] = Math.max(0, Math.min(2, stroke.taperEnd));
      metaF[mO + 26] = Math.max(0.0001, Math.min(8, stroke.taperCurve));
      metaF[mO + 27] = 0;

      // Pack stroke points
      for (let p = 0; p < ptsToUse; p++) {
        pointArr[(pointCursor + p) * 2 + 0] = stroke.points[p].x;
        pointArr[(pointCursor + p) * 2 + 1] = stroke.points[p].y;
      }

      // Initialise particles for this stroke. Each gets:
      //   stroke_id     = s
      //   seed_t        = i / partsToUse (uniform spread along stroke)
      //   phase_seed    = pseudo-random in [0..2π]
      // Stable across frames — compute shader animates from these.
      for (let i = 0; i < partsToUse; i++) {
        const pO = (particleCursor + i) * (PARTICLE_BYTES / 4);
        const u32View = new Uint32Array(particleArr.buffer, pO * 4, 1);
        u32View[0] = s;                                    // stroke_id
        particleArr[pO + 1] = i / partsToUse;              // seed_t
        // phase_seed: deterministic hash of (s, i) so spawns are
        // identical across hot-reloads → no flicker on re-mount.
        particleArr[pO + 2] = ((Math.sin(s * 12.9898 + i * 78.233) * 43758.5453) % 1) * Math.PI * 2;
        // pad + pos + color + alpha left as zeros (compute fills them)
      }

      // Track strokes that need the SDF tube pass. Any non-zero
      // tube style (glass container OR solid glow centerline) gets
      // a draw call. Empty strokes (< 2 points) were already
      // rejected above so we always have ≥ 1 segment here.
      if (effectiveTubeStyle > 0) {
        this.strokeIndexesNeedingTube.push(s);
      }
      this.strokeSegmentCounts.push(Math.max(0, ptsToUse - 1));

      pointCursor += ptsToUse;
      particleCursor += partsToUse;
    }

    this.currentTotalStrokes = Math.min(strokes.length, MAX_STROKES);
    this.currentTotalParticles = particleCursor;
    this.currentTotalPoints = pointCursor;
    this.stats.totalStrokes = this.currentTotalStrokes;
    this.stats.totalParticles = this.currentTotalParticles;
    this.stats.totalPoints = this.currentTotalPoints;

    // Upload (only the used slice of each buffer)
    this.device.queue.writeBuffer(this.strokeMetaBuffer, 0, metaArr, 0, this.currentTotalStrokes * STROKE_META_BYTES);
    this.device.queue.writeBuffer(this.pointsBuffer, 0, pointArr.buffer, 0, this.currentTotalPoints * POINT_BYTES);
    this.device.queue.writeBuffer(this.particleBuffer, 0, particleArr.buffer, 0, this.currentTotalParticles * PARTICLE_BYTES);

    console.log('[WebGPUStrokeParticles] uploaded',
      this.currentTotalStrokes, 'strokes,',
      this.currentTotalPoints, 'points,',
      this.currentTotalParticles.toLocaleString(), 'particles');
  }

  /** Per-frame progress writes — cheap, only N floats. The order of
   *  the array MUST match the order of strokes passed to setStrokes
   *  (collectGPUStrokes returns them in deterministic order, so the
   *  caller can compute progress in the same order). */
  updateProgresses(progresses: number[]): void {
    const n = Math.min(progresses.length, this.currentTotalStrokes);
    if (n === 0) return;
    // Each stroke's progress sits at fixed byte offset 80 within
    // its 96-byte StrokeMeta. We do N small writeBuffers — one per
    // stroke — because writeBuffer accepts a single contiguous
    // range. For small N (<=256) this is microseconds total.
    const tmp = new Float32Array(1);
    for (let i = 0; i < n; i++) {
      tmp[0] = Math.max(0, Math.min(1, progresses[i]));
      const offset = i * STROKE_META_BYTES + STROKE_META_PROGRESS_OFFSET;
      this.device.queue.writeBuffer(this.strokeMetaBuffer, offset, tmp.buffer, 0, 4);
    }
  }

  /** Run the per-frame compute + render pass. additive blend on top
   *  of `finalView`. Caller is responsible for the bridge clear/
   *  present beforehand. No-op if no GPU strokes are registered. */
  encodeFrame(encoder: any, finalView: any): void {
    if (this.currentTotalParticles === 0) return;
    const now = performance.now();
    const totalTime = (now - this.startTime) / 1000;
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    // Globals uniform
    const gu = new ArrayBuffer(16);
    const guF = new Float32Array(gu);
    const guU = new Uint32Array(gu);
    guF[0] = totalTime;
    guF[1] = dt;
    guU[2] = this.currentTotalParticles;
    guU[3] = this.currentTotalStrokes;
    this.device.queue.writeBuffer(this.globalsBuffer, 0, gu);

    // Render uniform: aspect compensation + global scale.
    // Per-particle billboard size is now read from per-stroke meta
    // in the vertex shader (see RENDER_WGSL.vs_main) so each brush
    // can render at its own scale (smoke huge soft blobs vs spiral
    // tight dots). global_scale stays at 1; reserved for future
    // per-display dpr tweaks.
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const ru = new Float32Array(4);
    ru[0] = aspect;                    // aspect_y (multiplied with size for round particles)
    ru[1] = 1.0;                        // global_scale
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ru.buffer);

    // Compute pass
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(this.computePipeline);
    cpass.setBindGroup(0, this.computeBindGroup);
    cpass.dispatchWorkgroups(Math.ceil(this.currentTotalParticles / 64));
    cpass.end();

    if (this.trailsEnabled) {
      // ── TRAIL PATH ──
      // Decay previous trail → render particles into trail texture →
      // composite trail into finalView → tubes into finalView (no
      // trail). Particles leave glowing streaks that fade with the
      // exponential decay rate.
      this.ensureTrailTextures(this.viewportW, this.viewportH);

      // Time-based exponential decay: framerate-independent. Lower
      // tau → faster fade. Capped to a sane max in case dt spikes.
      const decayPerFrame = Math.exp(-Math.min(0.1, dt) / TRAIL_TAU_SEC);
      const decayU = new Float32Array(4);
      decayU[0] = decayPerFrame;
      this.device.queue.writeBuffer(this.decayUniformBuffer, 0, decayU.buffer);

      // Determine ping-pong direction. writeView is the trail texture
      // we will write into this frame; readView is what we DECAY FROM.
      const writeIsB = !this.trailFlipped;
      const writeView = writeIsB ? this.trailViewB : this.trailViewA;
      const decayBindGroup = writeIsB ? this.decayBindGroupA : this.decayBindGroupB;
      const compositeBindGroup = writeIsB ? this.compositeBindGroupB : this.compositeBindGroupA;

      // Single render pass: decay (replaces target with faded prev) →
      // particles (additive on top). Combining into one pass avoids
      // the cost of opening a second pass for what's effectively a
      // back-to-back operation on the same attachment.
      const trailPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: writeView,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        }],
      });
      // Step 1: decay (3-vert fullscreen triangle, replace blend so
      // it overwrites the cleared target with the faded previous trail).
      trailPass.setPipeline(this.decayPipeline);
      trailPass.setBindGroup(0, decayBindGroup);
      trailPass.draw(3);
      // Step 2: particles (additive on top of the decayed previous frame).
      trailPass.setPipeline(this.renderPipelineTrail);
      trailPass.setBindGroup(0, this.renderBindGroup);
      trailPass.draw(6, this.currentTotalParticles, 0, 0);
      trailPass.end();

      // Composite trail texture additively over finalView.
      const compPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: finalView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      compPass.setPipeline(this.compositePipeline);
      compPass.setBindGroup(0, compositeBindGroup);
      compPass.draw(3);
      compPass.end();

      this.trailFlipped = !this.trailFlipped;
    } else {
      // ── DIRECT PATH (no trails) ──
      // Original stateless render — particles drawn directly to finalView.
      const rpass = encoder.beginRenderPass({
        colorAttachments: [{
          view: finalView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      rpass.setPipeline(this.renderPipeline);
      rpass.setBindGroup(0, this.renderBindGroup);
      rpass.draw(6, this.currentTotalParticles, 0, 0);
      rpass.end();
    }

    // ── SDF tube pass (wrap-around mode core line) ──
    // Always draws directly to finalView (NOT the trail texture).
    // Tubes are continuous SDF geometry — they don't benefit from
    // trail accumulation and would smear into solid bars if they did.
    if (this.strokeIndexesNeedingTube.length > 0) {
      // Update tube globals (aspect_y) — shared across all tube draws.
      const tg = new Float32Array(4);
      tg[0] = aspect;
      this.device.queue.writeBuffer(this.tubeGlobalsBuffer, 0, tg.buffer);

      const tpass = encoder.beginRenderPass({
        colorAttachments: [{
          view: finalView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      tpass.setPipeline(this.tubePipeline);
      tpass.setBindGroup(0, this.tubeBindGroup);
      // Per-stroke uniform write + draw. WebGPU lets us writeBuffer
      // mid-pass; the GPU sees the new value before the next draw
      // because the queue is serialized.
      const psBuf = new Uint32Array(4);
      for (let k = 0; k < this.strokeIndexesNeedingTube.length; k++) {
        const sIdx = this.strokeIndexesNeedingTube[k];
        const segCount = this.strokeSegmentCounts[sIdx] ?? 0;
        if (segCount <= 0) continue;
        psBuf[0] = sIdx;
        this.device.queue.writeBuffer(this.tubePerStrokeBuffer, 0, psBuf.buffer);
        tpass.draw(6, segCount, 0, 0);
      }
      tpass.end();
    }

    this.stats.framesEncoded++;
  }

  dispose(): void {
    try { this.particleBuffer?.destroy?.(); } catch { /* */ }
    try { this.pointsBuffer?.destroy?.(); } catch { /* */ }
    try { this.strokeMetaBuffer?.destroy?.(); } catch { /* */ }
    try { this.globalsBuffer?.destroy?.(); } catch { /* */ }
    try { this.renderUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.tubeGlobalsBuffer?.destroy?.(); } catch { /* */ }
    try { this.tubePerStrokeBuffer?.destroy?.(); } catch { /* */ }
    try { this.decayUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.trailTexA?.destroy?.(); } catch { /* */ }
    try { this.trailTexB?.destroy?.(); } catch { /* */ }
  }
}

const GPU_BRUSH_SET = new Set<GPUBrushKind>([
  'spiral', 'firefly', 'sap-flow', 'water', 'smoke',
  'galaxy', 'nebula', 'sparkle', 'vortex', 'plasma',
]);

// Animation state captured per layer so progress can advance even
// while the project store doesn't fire. Keyed by layer id; the
// epoch records the wall-clock ms at which playback most recently
// started. Cleared when isPlaying flips to false.
//
// This module-level state is the cheapest place to track wall time
// without re-architecting the project store. It survives the
// per-frame collectGPUStrokes calls but resets on a hot-reload (no
// persistence needed — playback head resets across reloads anyway).
const layerPlayStarts = new Map<string, number>();

/**
 * Collect GPU-brush strokes + per-stroke animation progress from
 * the project's light-painting layers. Computes progress mirroring
 * the CPU renderer's logic (forward stagger only for v1; complex
 * loop modes / sequence reordering can be matched later).
 *
 * Returns BOTH a flat stroke list (for setStrokes — hash-keyed) and
 * a parallel progresses[] array (for updateProgresses — cheap per-
 * frame writes). Caller uses both each frame; setStrokes short-
 * circuits when nothing immutable changed, updateProgresses always
 * runs.
 */
interface LightPaintingLayerLike {
  id: string;
  visible: boolean;
  lightPaintingContent: import('$lib/types').LightPaintingContent | null;
}

export function collectGPUStrokes(layers: LightPaintingLayerLike[]): {
  strokes: StrokeForGPU[];
  progresses: number[];
} {
  const out: StrokeForGPU[] = [];
  const progresses: number[] = [];
  const nowMs = performance.now();

  for (const layer of layers) {
    if (!layer.visible || !layer.lightPaintingContent) continue;
    const content = layer.lightPaintingContent;

    // Track playback edge: when isPlaying transitions OFF→ON we
    // capture nowMs as the playback origin. Subsequent frames
    // compute elapsed = nowMs - origin. When isPlaying flips OFF
    // we drop the entry so each replay starts fresh.
    if (content.isPlaying) {
      if (!layerPlayStarts.has(layer.id)) {
        layerPlayStarts.set(layer.id, nowMs);
      }
    } else {
      layerPlayStarts.delete(layer.id);
    }
    const playStart = layerPlayStarts.get(layer.id) ?? nowMs;
    const playElapsedMs = Math.max(0, nowMs - playStart);

    // Filter to GPU strokes in the order they appear (matches the
    // CPU renderer's "recorded" sequence default).
    const visibleGpuStrokes = content.strokes.filter(
      (s) => s.visible && GPU_BRUSH_SET.has(s.brush.type as GPUBrushKind) && s.points.length >= 2,
    );

    // Compute stagger start times so each stroke begins drawing
    // after the previous one finishes plus the user's staggerDelay.
    const drawSpeed = Math.max(0.001, content.drawSpeed || 1);
    const staggerDelayMs = content.staggerStrokes ? (content.staggerDelay ?? 0) : 0;

    // Total animation duration drives loop wrapping. Stagger mode:
    // sum of (duration + delay) for all strokes minus the trailing
    // delay after the last stroke. Non-stagger: max stroke duration.
    let totalDurationMs: number;
    if (content.staggerStrokes) {
      totalDurationMs = visibleGpuStrokes.reduce(
        (acc, s) => acc + (s.duration / drawSpeed) + staggerDelayMs,
        0,
      ) - staggerDelayMs;
    } else {
      totalDurationMs = visibleGpuStrokes.reduce(
        (acc, s) => Math.max(acc, s.duration / drawSpeed),
        0,
      );
    }
    if (totalDurationMs <= 0) totalDurationMs = 1;

    // Apply loopMode to wrap playElapsedMs. Mirrors the CPU
    // renderer's getLoopedTime so GPU + CPU strokes stay in sync
    // when both kinds of brushes coexist on the same layer.
    let effectiveElapsedMs = playElapsedMs;
    if (content.isPlaying && totalDurationMs > 0) {
      const mode = content.loopMode;
      if (mode === 'forward') {
        effectiveElapsedMs = playElapsedMs % totalDurationMs;
      } else if (mode === 'reverse') {
        effectiveElapsedMs = totalDurationMs - (playElapsedMs % totalDurationMs);
      } else if (mode === 'pingpong') {
        const hold = Math.max(0, content.pingPongHold ?? 0);
        const cycle = playElapsedMs % (totalDurationMs * 2 + hold * 2);
        if (cycle <= totalDurationMs)               effectiveElapsedMs = cycle;
        else if (cycle <= totalDurationMs + hold)   effectiveElapsedMs = totalDurationMs;
        else if (cycle <= totalDurationMs * 2 + hold) effectiveElapsedMs = totalDurationMs - (cycle - totalDurationMs - hold);
        else                                          effectiveElapsedMs = 0;
      } else if (mode === 'once') {
        effectiveElapsedMs = Math.min(playElapsedMs, totalDurationMs);
      } else {
        effectiveElapsedMs = playElapsedMs % totalDurationMs;
      }
    }

    let cumulativeMs = 0;

    for (const stroke of visibleGpuStrokes) {
      const b = stroke.brush;
      const strokeDurationMs = (stroke.duration || 1000) / drawSpeed;
      const startMs = content.staggerStrokes ? cumulativeMs : 0;
      let progress: number;
      if (!content.isPlaying) {
        // Static / idle: show the full stroke (matches CPU
        // renderer behaviour when not playing).
        progress = 1;
      } else {
        const elapsedThisStroke = effectiveElapsedMs - startMs;
        progress = elapsedThisStroke <= 0
          ? 0
          : Math.min(1, elapsedThisStroke / strokeDurationMs);
      }

      // Per-brush sensible base sizes + particle count multipliers.
      // Particle systems can fake spiral wrap with small dots, but
      // smoke / fluid only read correctly with HUGE soft blobs that
      // overlap additively into a continuous medium. Spiral keeps
      // tight billboards so the wrap stays visually distinct.
      let sizeMul = 1;
      let particleBoost = 1;
      let glowBoost = 1;
      if (b.type === 'smoke') {
        sizeMul = 5;            // ~5x bigger blobs
        particleBoost = 3;       // ~3x more particles
        glowBoost = 0.5;         // soft, low individual contribution; mass effect
      } else if (b.type === 'water') {
        sizeMul = 4;             // big viscous blobs
        particleBoost = 4;       // very dense for fluid mass
        glowBoost = 0.7;
      } else if (b.type === 'firefly') {
        sizeMul = 1.5;
      } else if (b.type === 'sap-flow') {
        sizeMul = 1.2;
      }
      out.push({
        id: stroke.id,
        brushType: b.type as GPUBrushKind,
        points: stroke.points,
        colorA: [b.color[0] / 255, b.color[1] / 255, b.color[2] / 255],
        colorB: b.secondaryColor
          ? [b.secondaryColor[0] / 255, b.secondaryColor[1] / 255, b.secondaryColor[2] / 255]
          : [b.color[0] / 255, b.color[1] / 255, b.color[2] / 255],
        particleCount: Math.max(50, Math.min(4000, Math.round((b.gpuParticleCount ?? 800) * particleBoost))),
        spiralRadius:  Math.max(0.005, Math.min(0.2, b.gpuSpiralRadius ?? 0.025)),
        spiralSpeed:   b.gpuSpiralSpeed ?? 1.2,
        spiralPitch:   Math.max(1, Math.min(30, b.gpuSpiralPitch ?? 8)),
        particleDrift: Math.max(0.005, Math.min(0.3, b.gpuParticleDrift ?? 0.05)),
        glow:          Math.max(0, Math.min(5, (b.glow ?? 2) * glowBoost)),
        sizeUV:        Math.max(0.001, Math.min(0.15, (b.size ?? 20) * 0.0006 * sizeMul)),
        progress,
        showCore:      b.gpuSpiralShowCore ?? true,
        waterGravity:  Math.max(0, Math.min(2, b.gpuWaterGravity ?? 1)),
        smokeRise:     Math.max(0.05, Math.min(1.5, b.gpuSmokeRise ?? 0.5)),
        // Glass tube: opt-in via the brush's gpuGlassTube flag.
        // tubeStyle precedence (resolved in setStrokes):
        //   user enabled gpuGlassTube → 1 (glass)
        //   else legacy spiral+showCore → 2 (solid glow centerline)
        //   else 0 (no tube pass)
        tubeStyle:     b.gpuGlassTube ? 1 : 0,
        glassTubeRadiusScale: Math.max(0.5, Math.min(3.0, b.gpuGlassTubeRadiusScale ?? 1.25)),
        glassTubeColor: b.gpuGlassTubeColor
          ? [b.gpuGlassTubeColor[0] / 255, b.gpuGlassTubeColor[1] / 255, b.gpuGlassTubeColor[2] / 255]
          : [220 / 255, 230 / 255, 255 / 255],
        taperStart: b.taperStart ?? 1,
        taperEnd:   b.taperEnd   ?? 1,
        taperCurve: b.taperCurve ?? 1,
      });
      progresses.push(progress);

      cumulativeMs += strokeDurationMs + staggerDelayMs;
    }
  }
  return { strokes: out, progresses };
}
