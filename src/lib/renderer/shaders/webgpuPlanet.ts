/**
 * WebGPUPlanet — fully procedural ray-traced planet. ONE fragment
 * shader handles Earth / Mars / Jupiter / Saturn:
 *   - Ray-sphere intersection
 *   - Per-planet procedural surface (FBM noise + palette)
 *   - Earth-only cloud layer (separate noise, scrolling)
 *   - Atmospheric scattering rim glow (analytic, per-planet tint)
 *   - Polar aurora (Earth, ray-marched curtain)
 *   - Procedural star field background
 *   - Saturn rings (ray-plane intersection with banded gaps)
 *   - Sun lighting + day/night terminator
 *
 * Reference: feels like the Kanye SOFI installation — dramatic,
 * surreal-scale, alive with atmosphere.
 *
 * Implements GpuShaderImpl so it plugs into the gpu-layer system
 * without any special-casing in the runner.
 */

import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';
import { createAndWarmWgslShaderModule } from '../wgsl';
import { getGhostGpuRuntime } from '../webgpuShared';
import type { GhostGpuRuntime } from '../gpuRuntime';

const PLANET_IDS: Record<string, number> = {
  'earth':   0,
  'mars':    1,
  'jupiter': 2,
  'saturn':  3,
};

// Param schema — mirrored by the panel + by deriveDefaults below.
export const planetParamSchema: ParamControl[] = [
  { kind: 'select', key: 'planet', label: 'Planet', group: 'Planet',
    options: [
      { value: 'earth', label: 'Earth' },
      { value: 'mars', label: 'Mars' },
      { value: 'jupiter', label: 'Jupiter' },
      { value: 'saturn', label: 'Saturn' },
    ],
    default: 'earth' },
  // Camera — defaults pulled back so stars are visible around the
  // planet by default. Pull Distance to 1.05 for half-sphere zoom.
  { kind: 'slider', key: 'cameraDistance', label: 'Distance', group: 'Camera',
    min: 1.05, max: 8, step: 0.01, default: 4.0 },
  { kind: 'slider', key: 'fovDeg', label: 'FOV', group: 'Camera',
    min: 15, max: 90, step: 1, default: 50 },
  { kind: 'angle', key: 'cameraYaw', label: 'Yaw', group: 'Camera', default: 0 },
  { kind: 'angle', key: 'cameraPitch', label: 'Pitch', group: 'Camera', default: 0 },
  // Planet position — moves the planet around in the frame
  // independent of camera orbit. World-space offset; ranges are
  // generous so you can push the planet to any corner.
  { kind: 'slider', key: 'planetX', label: 'Planet X', group: 'Camera',
    min: -3, max: 3, step: 0.01, default: 0 },
  { kind: 'slider', key: 'planetY', label: 'Planet Y', group: 'Camera',
    min: -3, max: 3, step: 0.01, default: 0 },
  // Rotation
  { kind: 'slider', key: 'rotationSpeed', label: 'Spin Speed (°/s)', group: 'Rotation',
    min: -30, max: 30, step: 0.1, default: 4 },
  { kind: 'angle', key: 'rotationOffset', label: 'Rotation Offset', group: 'Rotation', default: 0 },
  // Lighting + emission
  { kind: 'angle', key: 'sunYaw', label: 'Sun Yaw', group: 'Lighting', default: -45 },
  { kind: 'angle', key: 'sunPitch', label: 'Sun Pitch', group: 'Lighting', default: 15 },
  { kind: 'slider', key: 'sunBrightness', label: 'Sun Brightness', group: 'Lighting',
    min: 0, max: 3, step: 0.01, default: 1.0 },
  { kind: 'slider', key: 'emission', label: 'Self-Emission', group: 'Lighting',
    min: 0, max: 1.5, step: 0.01, default: 0.35 },
  { kind: 'slider', key: 'outerGlow', label: 'Outer Glow', group: 'Lighting',
    min: 0, max: 2, step: 0.01, default: 0.0 },
  // Atmosphere + clouds (clouds now apply to all planets)
  { kind: 'slider', key: 'cloudCoverage', label: 'Cloud Coverage', group: 'Clouds',
    min: 0, max: 1, step: 0.01, default: 0.65 },
  { kind: 'slider', key: 'cloudThickness', label: 'Cloud Thickness', group: 'Clouds',
    min: 0.5, max: 4, step: 0.05, default: 1.8 },
  { kind: 'slider', key: 'cloudSpeed', label: 'Cloud Speed', group: 'Clouds',
    min: 0, max: 3, step: 0.01, default: 0.7 },
  { kind: 'color', key: 'cloudColor', label: 'Cloud Color', group: 'Clouds',
    default: [255, 255, 255] },
  { kind: 'slider', key: 'atmosphereHeight', label: 'Atmosphere Thickness', group: 'Atmosphere',
    min: 0, max: 0.3, step: 0.005, default: 0.06 },
  { kind: 'slider', key: 'auroraStrength', label: 'Aurora Strength', group: 'Atmosphere',
    min: 0, max: 2, step: 0.01, default: 0.8 },
  // Earth surface (only meaningful for Earth, but harmless on others).
  // Vibrant land color → glowing shoreline that hugs it → both
  // user-driven so the look can swing from photorealistic Earth to
  // Tron-style sci-fi map.
  { kind: 'color', key: 'landColor', label: 'Land Color', group: 'Earth Surface',
    default: [110, 175, 70] },
  { kind: 'color', key: 'shorelineColor', label: 'Shoreline Glow Color', group: 'Earth Surface',
    default: [60, 230, 220] },
  { kind: 'slider', key: 'shorelineIntensity', label: 'Shoreline Glow Intensity', group: 'Earth Surface',
    min: 0, max: 5, step: 0.05, default: 1.6 },
  { kind: 'slider', key: 'shorelineWidth', label: 'Shoreline Width', group: 'Earth Surface',
    min: 0.005, max: 0.10, step: 0.001, default: 0.040 },
  { kind: 'slider', key: 'starDensity', label: 'Star Density', group: 'Background',
    min: 0, max: 2, step: 0.01, default: 1.0 },
  // Saturn rings — analytic SDF with multi-band detail (Cassini +
  // Encke + Maxwell gaps, FBM micro-banding for granularity, sun
  // shadow from the planet body).
  { kind: 'slider', key: 'ringInner', label: 'Ring Inner Radius', group: 'Saturn',
    min: 1.05, max: 2.5, step: 0.01, default: 1.25 },
  { kind: 'slider', key: 'ringOuter', label: 'Ring Outer Radius', group: 'Saturn',
    min: 1.5, max: 4, step: 0.01, default: 2.3 },
  { kind: 'slider', key: 'ringOpacity', label: 'Ring Opacity', group: 'Saturn',
    min: 0, max: 1, step: 0.01, default: 0.95 },
  { kind: 'slider', key: 'ringDetail', label: 'Ring Detail', group: 'Saturn',
    min: 0, max: 1.5, step: 0.01, default: 1.0 },
];

export const planetParamDefaults = deriveDefaults(planetParamSchema);

// ─────────────────────────────────────────────────────────────
// WGSL — the entire shader. Read the comments inline; this is the
// star of the show.
// ─────────────────────────────────────────────────────────────
const PLANET_WGSL = /* wgsl */ `
const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717958;

struct Globals {
  resolution:        vec2<f32>,
  time:              f32,
  planet_id:         u32,         // 0=earth, 1=mars, 2=jupiter, 3=saturn

  camera_distance:   f32,
  fov_deg:           f32,
  camera_yaw:        f32,         // degrees
  camera_pitch:      f32,         // degrees

  rotation_offset:   f32,         // degrees (manual)
  rotation_anim:     f32,         // degrees (time-driven)
  sun_yaw:           f32,         // degrees
  sun_pitch:         f32,         // degrees

  cloud_coverage:    f32,
  cloud_phase:       f32,         // accumulated cloud time (for scroll)
  atmosphere_height: f32,         // fraction of planet radius
  aurora_strength:   f32,

  star_density:      f32,
  ring_inner:        f32,
  ring_outer:        f32,
  ring_opacity:      f32,

  // ── Added: cloud color (rgb) + sun brightness ──
  cloud_color:       vec3<f32>,
  sun_brightness:    f32,

  // ── Planet world-space offset + ring detail multiplier ──
  planet_x:          f32,
  planet_y:          f32,
  ring_detail:       f32,         // 0..1.5 — multiplier on ring micro-bands
  pad_a:             f32,

  // ── Emission + outer glow ──
  emission:          f32,
  outer_glow:        f32,
  pad0:              f32,
  pad1:              f32,

  // ── Earth surface controls ──
  land_color:        vec3<f32>,
  shoreline_intensity: f32,
  shoreline_color:   vec3<f32>,
  shoreline_width:   f32,
  // ── Cloud thickness (multiplier on absorption) ──
  cloud_thickness:   f32,
  pad_b:             f32,
  pad_c:             f32,
  pad_d:             f32,
};

@group(0) @binding(0) var<uniform> u: Globals;

// ── Hash + noise helpers ──
fn hash11(n: f32) -> f32 {
  return fract(sin(n * 12.9898) * 43758.5453);
}
fn hash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
fn hash31(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let v000 = hash31(i);
  let v100 = hash31(i + vec3(1.0, 0.0, 0.0));
  let v010 = hash31(i + vec3(0.0, 1.0, 0.0));
  let v110 = hash31(i + vec3(1.0, 1.0, 0.0));
  let v001 = hash31(i + vec3(0.0, 0.0, 1.0));
  let v101 = hash31(i + vec3(1.0, 0.0, 1.0));
  let v011 = hash31(i + vec3(0.0, 1.0, 1.0));
  let v111 = hash31(i + vec3(1.0, 1.0, 1.0));
  let x00 = mix(v000, v100, s.x);
  let x10 = mix(v010, v110, s.x);
  let x01 = mix(v001, v101, s.x);
  let x11 = mix(v011, v111, s.x);
  let y0 = mix(x00, x10, s.y);
  let y1 = mix(x01, x11, s.y);
  return mix(y0, y1, s.z);
}

fn fbm(p: vec3<f32>, octaves: i32) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var pp = p;
  for (var i = 0; i < octaves; i = i + 1) {
    v = v + amp * noise3(pp);
    pp = pp * 2.03;
    amp = amp * 0.5;
  }
  return v;
}

// Ridged variant for sharp continental edges / cloud filaments.
fn fbm_ridge(p: vec3<f32>, octaves: i32) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var pp = p;
  for (var i = 0; i < octaves; i = i + 1) {
    let n = 1.0 - abs(noise3(pp) * 2.0 - 1.0);
    v = v + amp * n * n;
    pp = pp * 2.03;
    amp = amp * 0.5;
  }
  return v;
}

// ── Ray-sphere intersection. Returns vec2(t_near, t_far) or
//    vec2(-1) if no intersection. ──
fn raySphere(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, r: f32) -> vec2<f32> {
  let oc = ro - c;
  let b = dot(oc, rd);
  let cc = dot(oc, oc) - r * r;
  let h = b * b - cc;
  if (h < 0.0) { return vec2(-1.0, -1.0); }
  let s = sqrt(h);
  return vec2(-b - s, -b + s);
}

// Ray-plane (y = 0). Returns t or -1.
fn rayPlaneY(ro: vec3<f32>, rd: vec3<f32>, planeY: f32) -> f32 {
  if (abs(rd.y) < 1e-5) { return -1.0; }
  let t = (planeY - ro.y) / rd.y;
  return select(-1.0, t, t > 0.0);
}

// ── Star field background. Two layers (small + occasional bright)
// hash-cell sampled along the ray direction. Stars are now larger
// and brighter so they actually read on the bridge canvas. ──
fn starLayer(rd: vec3<f32>, scale: f32, density: f32, sizePx: f32, brightBase: f32) -> vec3<f32> {
  let lat = asin(clamp(rd.y, -1.0, 1.0)) / PI + 0.5;
  let lon = atan2(rd.z, rd.x) / TAU + 0.5;
  let uv = vec2(lon, lat) * scale;
  let cell = floor(uv);
  let f = fract(uv) - 0.5;
  let h1 = hash21(cell);
  let h2 = hash21(cell + 17.31);
  let h3 = hash21(cell + 41.11);
  let threshold = 1.0 - density * 0.10;
  if (h1 < threshold) { return vec3(0.0); }
  let center = vec2(h2, h3) - 0.5;
  let d = length(f - center);
  let bright = pow(h1, 8.0) * brightBase + 0.15;
  let star = smoothstep(sizePx, 0.0, d) * bright;
  let hue = vec3(
    0.80 + 0.20 * h2,
    0.85 + 0.15 * h3,
    0.92 + 0.08 * h1,
  );
  return star * hue;
}

fn starField(rd: vec3<f32>, density: f32) -> vec3<f32> {
  // Two layers: dense small stars + sparse bright stars for variety.
  // Density param scales BOTH so the user has one knob.
  let small = starLayer(rd, 180.0, density * 1.0,  0.04, 0.85);
  let big   = starLayer(rd, 60.0,  density * 0.45, 0.10, 1.6);
  return small + big;
}

// ── Per-planet surface shaders. Take a sphere-surface point's
// direction (n) and return surface RGB. UV not used directly —
// noise is sampled in 3D so there's no pole pinching / seam. ──
fn earthSurface(n: vec3<f32>) -> vec3<f32> {
  let p = n * 3.0;
  // Continental landmasses via FBM thresholded. 4 octaves instead of 5 —
  // continent silhouette is dominated by the first 3 octaves; the 5th
  // adds sub-pixel jitter that anti-aliasing eats anyway.
  let continent = fbm(p, 4);
  let is_land = step(0.5, continent);

  // Ocean — deep blue to lighter shore.
  let ocean_deep = vec3(0.015, 0.06, 0.18);
  let ocean_shore = vec3(0.05, 0.20, 0.42);
  let ocean = mix(ocean_deep, ocean_shore, smoothstep(0.40, 0.50, continent));

  // ── Land ──
  // Use the user's land color as the BASE green. Add subtle dark
  // variation via FBM so the surface reads as terrain instead of
  // flat paint, but the dominant tone is the user-chosen color.
  // Single 4-octave fbm covers both broad highlands and small valleys;
  // the previous 5-oct + 4-oct twin sample was duplicative and the
  // mid-band terms cancel out in the (shade = a + b) blend.
  let lat = abs(n.y);
  let elev = fbm(p * 1.7 + vec3(11.3), 4);
  let snow = vec3(0.92, 0.94, 0.97);
  let shade = (elev - 0.5) * 0.45;
  var land = u.land_color + vec3(shade);
  // Polar latitudes blend toward snow.
  land = mix(land, snow, smoothstep(0.78, 0.95, lat));

  // Polar caps — both land and ocean go snowy at high latitude.
  let polar = smoothstep(0.86, 0.97, lat);
  return mix(mix(ocean, land, is_land), snow, polar);
}

fn marsSurface(n: vec3<f32>) -> vec3<f32> {
  let p = n * 3.5;
  let base = fbm(p, 5);
  let detail = fbm(p * 4.0, 4);
  // Two reds — rust + darker iron oxide.
  let rust = vec3(0.78, 0.42, 0.25);
  let iron = vec3(0.45, 0.20, 0.12);
  let dust = vec3(0.92, 0.70, 0.55);
  var col = mix(iron, rust, smoothstep(0.3, 0.7, base));
  col = mix(col, dust, smoothstep(0.55, 0.85, base + detail * 0.2) * 0.45);
  // Polar caps — pale CO2 ice.
  let lat = abs(n.y);
  let polar = smoothstep(0.82, 0.94, lat);
  return mix(col, vec3(0.95, 0.92, 0.88), polar);
}

fn jupiterSurface(n: vec3<f32>) -> vec3<f32> {
  // Jupiter is dominated by latitudinal bands. Modulate by FBM in
  // the perpendicular direction so the bands have turbulence.
  let lat = n.y;
  // 7 bands across the planet via cosine.
  let band_signal = sin(lat * 14.0 + fbm(n * 4.0, 4) * 2.5);
  let band = smoothstep(-0.4, 0.4, band_signal);
  let cream = vec3(0.92, 0.83, 0.62);
  let beige = vec3(0.78, 0.62, 0.42);
  let brown = vec3(0.50, 0.32, 0.18);
  let white = vec3(0.95, 0.92, 0.85);
  var col = mix(brown, cream, band);
  // Add a second layer with finer detail.
  let detail = fbm(n * 8.0 + vec3(13.7, 0.0, 0.0), 4);
  col = mix(col, beige, detail * 0.4);
  col = mix(col, white, smoothstep(0.7, 0.95, band) * 0.3);
  // Great Red Spot — elliptical region at southern mid-latitude.
  let spot_lat = -0.32;
  let spot_lon = atan2(n.z, n.x);
  let dlon = spot_lon - PI * 0.4;
  let dlon_w = atan2(sin(dlon), cos(dlon));    // wrap to [-π, π]
  let dlat = n.y - spot_lat;
  let spot = exp(-(dlon_w * dlon_w * 14.0 + dlat * dlat * 110.0));
  let spot_col = vec3(0.78, 0.30, 0.22);
  return mix(col, spot_col, smoothstep(0.0, 0.6, spot));
}

fn saturnSurface(n: vec3<f32>) -> vec3<f32> {
  // Like Jupiter but pastel + softer bands.
  let lat = n.y;
  let band_signal = sin(lat * 11.0 + fbm(n * 3.0, 4) * 1.8);
  let band = smoothstep(-0.5, 0.5, band_signal);
  let pale_gold = vec3(0.95, 0.85, 0.65);
  let warm_tan = vec3(0.85, 0.72, 0.50);
  let dim_tan = vec3(0.70, 0.58, 0.38);
  var col = mix(dim_tan, pale_gold, band);
  let detail = fbm(n * 7.0, 4);
  col = mix(col, warm_tan, detail * 0.3);
  return col;
}

// ── Cloud layer. Generic — works on every planet now (Mars dust
// clouds, Jupiter ammonia, Earth water vapour all share the same
// noise math; user-controlled color + coverage discriminate). The
// per-planet scale tweak just changes how broken-up the clouds
// look (higher freq for gas giants → more streaky).
fn cloudCover(n: vec3<f32>, phase: f32, coverage: f32, freq_mul: f32) -> f32 {
  let p = n * 4.0 * freq_mul + vec3(phase * 0.2, 0.0, phase * 0.15);
  let raw = fbm(p, 6);
  let c = smoothstep(0.45 - coverage * 0.35, 0.65 - coverage * 0.35, raw);
  let wisp = fbm_ridge(p * 2.5 + 7.7, 4);
  return clamp(c + wisp * 0.1 - 0.05, 0.0, 1.0);
}

// ── Aurora — thin curtain at high latitudes. We sample along the
// view ray as it passes through the atmosphere shell, accumulating
// where the curtain is present (lat > 0.7). The curtain itself is
// a 3D noise modulated by latitude + time. ──
fn auroraColor(p: vec3<f32>, t: f32) -> vec3<f32> {
  let n = normalize(p);
  let lat = abs(n.y);
  if (lat < 0.62) { return vec3(0.0); }
  // Curtain pattern — vertical streaks via stretched noise.
  let q = vec3(n.x * 6.0, p.y * 8.0 + t * 0.4, n.z * 6.0);
  let pattern = fbm_ridge(q, 4);
  let pattern2 = fbm(q * 2.0 + t * 0.3, 3);
  let intensity = pattern * pattern2;
  // Latitude falloff — strongest at ~0.85, fades by 0.62 and 0.97.
  let lat_falloff = smoothstep(0.62, 0.78, lat) * (1.0 - smoothstep(0.92, 0.99, lat));
  // Color cycle — green dominant, magenta accents, blue tail.
  let phase = pattern + t * 0.12;
  let green  = vec3(0.05, 0.95, 0.35);
  let magenta = vec3(0.85, 0.10, 0.65);
  let blue   = vec3(0.20, 0.45, 0.95);
  let col = mix(green, mix(magenta, blue, sin(phase) * 0.5 + 0.5), 0.35);
  return col * intensity * lat_falloff;
}

// ── Surface heightmap + perturbed normal ──
// Sample a low-frequency height for each planet, compute the
// surface normal via finite differences in tangent space, and
// return a perturbed normal that creates real terrain shadowing
// when lit. Gas giants stay smooth (return original n).
fn surfaceHeight(n: vec3<f32>, planet_id: u32) -> f32 {
  if (planet_id == 0u) {
    // Earth: continents have elevation. FBM-thresholded land mask
    // gives binary; multiply by detail noise so highlands feel
    // textured rather than flat.
    let p = n * 4.0;
    let h_continent = fbm(p, 5);
    let is_land = step(0.5, h_continent);
    let detail = fbm(p * 6.0, 4);
    return is_land * (h_continent - 0.5 + detail * 0.4) * 0.18;
  }
  if (planet_id == 1u) {
    // Mars: rugged with crater-like detail. Higher amplitude than
    // Earth — less water, more visible relief.
    let p = n * 5.0;
    return (fbm(p, 6) - 0.5) * 0.24;
  }
  return 0.0;  // Gas giants: smooth
}

// Stripped height sampler for bump-mapping ONLY. perturbedNormal calls
// this 3× per pixel (h0/h1/h2 for tangent-space gradient), so cutting
// octaves here is multiplied by 3. The full surfaceHeight() above is
// still used elsewhere where the value is read directly, not differenced.
//
// Tangent-space gradient picks up the LOW-FREQUENCY relief (mountain
// ranges, continental shelves) — that's what casts visible terminator
// shadows at the planet's apparent scale. High-frequency detail noise
// (the * 6.0 term, frequency 24) contributes nothing across an
// eps=0.012 step at planet scale; its gradient is dominated by aliasing,
// not signal.
fn surfaceHeightBump(n: vec3<f32>, planet_id: u32) -> f32 {
  if (planet_id == 0u) {
    // Earth bump: just the continent mask, 3 octaves instead of 5+4=9.
    let p = n * 4.0;
    let h_continent = fbm(p, 3);
    let is_land = step(0.5, h_continent);
    return is_land * (h_continent - 0.5) * 0.18;
  }
  if (planet_id == 1u) {
    // Mars bump: 3 octaves instead of 6.
    let p = n * 5.0;
    return (fbm(p, 3) - 0.5) * 0.24;
  }
  return 0.0;
}

fn perturbedNormal(n: vec3<f32>, planet_id: u32) -> vec3<f32> {
  if (planet_id == 2u || planet_id == 3u) { return n; }
  let eps = 0.012;
  // Tangent basis from arbitrary helper vector — robust because we
  // don't care about specific tangent direction.
  let helper = select(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), abs(n.y) > 0.95);
  let tangent = normalize(cross(n, helper));
  let bitangent = normalize(cross(n, tangent));
  // 3× the cost of fbm here — was 9 octaves × 3 = 27 octaves per pixel
  // on Earth. Stripped sampler drops that to 3 × 3 = 9 octaves. Single
  // biggest per-pixel win in the surface pass.
  let h0 = surfaceHeightBump(n, planet_id);
  let h1 = surfaceHeightBump(normalize(n + tangent * eps), planet_id);
  let h2 = surfaceHeightBump(normalize(n + bitangent * eps), planet_id);
  let dx = (h1 - h0) / eps;
  let dy = (h2 - h0) / eps;
  // Bumpiness multiplier — higher = more pronounced terrain shadows.
  let bump = 4.0;
  return normalize(n - tangent * dx * bump - bitangent * dy * bump);
}

// ── Earth shoreline glow ──
// Single contribution: a bright glowing ring at the EXACT
// land/ocean boundary (the outline of every continent). The
// intensity, color, and width of the ring are all user-driven via
// uniforms so the look ranges from subtle bioluminescence to
// SOFI-stadium Tron-Earth.
//
// Math: the continent FBM crosses 0.5 right at the coast, so
// abs(continent - 0.5) is a signed distance to the coastline.
// smoothstep(width, 0, dist) gives a sharp ring of glow centered
// on that boundary. A small FBM jitter along the coast keeps it
// organic instead of perfectly uniform.
fn earthShorelineGlow(n_rot: vec3<f32>) -> vec3<f32> {
  let p = n_rot * 3.0;
  // 3 octaves instead of 5. The coastline silhouette is determined by
  // the threshold-crossing of the lowest 2-3 octaves; the 4th/5th add
  // sub-coast wiggle that the smoothstep eats anyway. Cuts 40% off
  // shoreline cost on every Earth pixel even when shoreline is off
  // (early-out below saves the jitter sample but not this one).
  let continent = fbm(p, 3);
  let coast_dist = abs(continent - 0.5);
  let half_width = max(u.shoreline_width, 0.001);
  let coast = smoothstep(half_width, 0.0, coast_dist);
  if (coast < 0.001) { return vec3(0.0); }
  // Light per-pixel variation so the coastline doesn't look painted
  // on with a uniform brush. 2-octave is enough at freq 22.
  let jitter = 0.75 + 0.25 * fbm(n_rot * 22.0 + 3.7, 2);
  return u.shoreline_color * coast * jitter * u.shoreline_intensity;
}

// ── Volumetric atmosphere ray-march ──
// Simplified Rayleigh-ish scattering: sample density along the view
// ray inside the atmosphere shell, accumulate scattered light using
// a single secondary ray toward the sun per sample. Gives proper
// sunsets, day/night terminator glow, and a depth-aware rim.
fn atmDensity(p: vec3<f32>, planet_center: vec3<f32>, r_planet: f32, r_atmo: f32) -> f32 {
  let h = length(p - planet_center) - r_planet;
  let scale_height = (r_atmo - r_planet) * 0.45;
  return exp(-max(h, 0.0) / scale_height);
}

fn marchAtmosphere(
  ro: vec3<f32>, rd: vec3<f32>,
  t_start: f32, t_end: f32,
  sun: vec3<f32>,
  planet_center: vec3<f32>, r_planet: f32, r_atmo: f32,
  planet_id: u32, sun_brightness: f32,
) -> vec3<f32> {
  let span = max(t_end - t_start, 0.0);
  if (span <= 0.0001) { return vec3(0.0); }
  // 8 steps instead of 12 — atmosphere is exponentially front-loaded
  // (rim shells contribute most), the eye can't distinguish 8 vs 12
  // samples across a soft Rayleigh integral.
  let steps: i32 = 8;
  let dt = span / f32(steps);
  let tint = atmosphereTint(planet_id);
  let r_planet_sq = r_planet * r_planet;
  var accum = vec3(0.0);
  for (var i = 0; i < steps; i = i + 1) {
    let t = t_start + (f32(i) + 0.5) * dt;
    let p = ro + rd * t;
    let density = atmDensity(p, planet_center, r_planet, r_atmo);
    if (density < 0.001) { continue; }
    // Secondary ray toward sun: single-sample optical depth proxy.
    let sun_hit = raySphere(p, sun, planet_center, r_atmo);
    let sun_path = max(sun_hit.y, 0.0);
    // Cheap planet-shadow test: the sun-ray hits the planet body iff
    // the perpendicular distance from the planet center to the line
    // (p, sun) is less than r_planet AND the planet is in front of p
    // along the sun direction. Cuts a raySphere() call per atmosphere
    // step (8 fewer raySphere calls per pixel) without altering the
    // terminator dimming behaviour visibly.
    let to_c = planet_center - p;
    let along = dot(to_c, sun);                // >0 = planet is sunward
    let perp_sq = dot(to_c, to_c) - along * along;
    let blocked = step(0.0, along) * step(perp_sq, r_planet_sq);
    let sun_density = density * sun_path * 0.7;
    let attenuation = exp(-sun_density * tint * 1.4);
    accum = accum + attenuation * tint * density * dt * (1.0 - blocked * 0.85);
  }
  return accum * 6.5 * sun_brightness;
}

// ── Henyey-Greenstein phase function ──
// g controls forward (g→1) vs back (g→-1) scattering. Real clouds
// have g≈0.7-0.8 (strongly forward scattering), which gives the
// silver lining when sun is behind the cloud and the bright halo
// when looking through the cloud toward the sun.
fn hgPhase(cos_theta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * cos_theta, 1.5));
}

// ── Volumetric cloud density ──
// Three-layer construction:
//   1. CUMULUS BASE — low-frequency FBM defines the big formations
//      (anvils, fronts). Coverage threshold here.
//   2. PUFFS — mid-frequency FBM modulates density inside formations
//      so they read as bulbous billows, not flat blobs.
//   3. EROSION — high-frequency ridged FBM SUBTRACTS at the edges,
//      cutting wispy filaments + breaking up the silhouette so the
//      clouds look truly fluid + alive instead of cookie-cutter.
//
// Vertical density curve: gradual fade-in from the base, peak in
// the middle of the shell, slow fade at the top. Gives cumulus a
// flatter base and more billowy crown.
fn cloudDensity(
  p_local: vec3<f32>, total_rot: f32, phase: f32,
  coverage: f32, freq_mul: f32,
) -> f32 {
  let r = length(p_local);
  let r_low = 1.005;
  let r_high = 1.060;
  if (r < r_low || r > r_high) { return 0.0; }
  // Asymmetric vertical curve: flatter base, billowy top.
  let shell_t = (r - r_low) / (r_high - r_low);
  let vertical = smoothstep(0.0, 0.18, shell_t) * (1.0 - smoothstep(0.7, 1.0, shell_t));
  // Apply planet rotation so clouds drift with the world.
  let p_rot = rotateY(p_local, total_rot * 0.92);
  let n = normalize(p_rot);
  // Layer 1 — CUMULUS BASE (low freq, big formations)
  let p_big = n * 1.8 * freq_mul + vec3(phase * 0.18, 0.0, phase * 0.12);
  let cumulus = fbm(p_big, 4);
  // Coverage threshold drives the fundamental cloud-vs-sky decision.
  let cov_t = 0.50 - coverage * 0.35;
  let shape = smoothstep(cov_t, cov_t + 0.18, cumulus);
  if (shape < 0.001) { return 0.0; }
  // Layer 2 — PUFFS (medium freq, billowy structure)
  let p_med = n * 6.0 * freq_mul + vec3(phase * 0.30, 0.0, phase * 0.22);
  let puffs = fbm(p_med, 4);
  let with_puffs = shape * (0.55 + 0.55 * puffs);
  // Layer 3 — EROSION (high freq ridged, edge detail)
  let p_det = n * 18.0 * freq_mul + vec3(phase * 0.45, 0.0, phase * 0.35);
  let detail = fbm_ridge(p_det, 4);
  let eroded = max(0.0, with_puffs - detail * 0.32);
  return clamp(eroded * vertical, 0.0, 1.0);
}

// Stripped shadow-only cloud density: cumulus shape + vertical shell only.
// No puffs, no erosion, 2-octave fbm instead of 4. Used inside the shadow
// loop where the result is integrated along the sun ray, so high-freq edge
// detail washes out anyway — only the coarse silhouette affects attenuation.
// Roughly 6× cheaper than cloudDensity() and the visual delta is invisible
// because shadow rays only modulate the lighting term, not the silhouette.
fn cloudDensityShadow(
  p_local: vec3<f32>, total_rot: f32, phase: f32,
  coverage: f32, freq_mul: f32,
) -> f32 {
  let r = length(p_local);
  let r_low = 1.005;
  let r_high = 1.060;
  if (r < r_low || r > r_high) { return 0.0; }
  let shell_t = (r - r_low) / (r_high - r_low);
  let vertical = smoothstep(0.0, 0.18, shell_t) * (1.0 - smoothstep(0.7, 1.0, shell_t));
  let p_rot = rotateY(p_local, total_rot * 0.92);
  let n = normalize(p_rot);
  let p_big = n * 1.8 * freq_mul + vec3(phase * 0.18, 0.0, phase * 0.12);
  let cumulus = fbm(p_big, 2);
  let cov_t = 0.50 - coverage * 0.35;
  let shape = smoothstep(cov_t, cov_t + 0.18, cumulus);
  return clamp(shape * vertical, 0.0, 1.0);
}

// ── Volumetric cloud ray-march ──
// 22 primary samples + 2 logarithmically-spaced light samples per
// dense primary, with per-pixel + per-frame temporal jitter on the
// primary t-offset so the eye integrates over 2-3 frames at 60fps
// without visible banding. Beer-Powder lighting (Häusler-Frostbite
// trick): direct attenuation (Beer) + powder term for dark internal
// shadowing on thick clouds. HG phase term gives the silver lining
// when backlit. Multiple-scattering approximation via a small
// ambient lift on top. Shadow samples use cloudDensityShadow() — a
// stripped 2-octave cumulus-only sampler ~6× cheaper than the full
// cloudDensity(); shadow integration washes out fine detail anyway.
fn marchClouds(
  ro: vec3<f32>, rd: vec3<f32>,
  t_start: f32, t_end: f32,
  sun: vec3<f32>,
  planet_center: vec3<f32>,
  total_rot: f32, phase: f32,
  coverage: f32, freq_mul: f32,
  cloud_color: vec3<f32>,
  sun_brightness: f32,
) -> vec4<f32> {
  let span = max(t_end - t_start, 0.0);
  if (span <= 0.0001) { return vec4(0.0); }
  let steps: i32 = 22;
  let dt = span / f32(steps);
  // Per-pixel + per-frame jitter on the march offset. The eye accumulates
  // across frames at typical 60fps refresh, smoothing banding that 22
  // primary steps would otherwise show on dense cloud edges. White-noise
  // jitter is fine for volumetric integration; blue-noise would look
  // marginally cleaner on stills but adds a 64×64 LUT for negligible gain.
  let jitter = hash31(rd * 100.0 + vec3(u.time * 11.0, u.time * 7.0, u.time * 13.0));
  var transmittance = 1.0;
  var color = vec3(0.0);

  // ── Lighting model ──
  // Three components, all visible from ANY view angle:
  //   1. LAMBERTIAN BASELINE — direct-attenuated sun light, view-
  //      independent. Makes front-lit clouds visible (was missing
  //      before — pure phase-only model collapsed when sun was
  //      behind the camera).
  //   2. PHASE BOOST (HG) — additional brightness when looking
  //      toward sun (silver lining backlit, halo through clouds).
  //   3. SKY AMBIENT — blue lift on the top of clouds approximating
  //      multiple-scattering bounce light from the sky.
  let cos_theta = dot(rd, sun);
  let phase_fwd = hgPhase(cos_theta, 0.72);   // tight forward
  let phase_back = hgPhase(cos_theta, -0.18); // gentle back
  let phase_term = phase_fwd * 0.78 + phase_back * 0.22;

  // Shadow march: 2 samples (close + far) using the stripped density
  // function. Sum of distances 0.072 vs the prior 3-sample sum 0.112,
  // but cloudDensityShadow() returns ~1.4× higher (no erosion subtract)
  // so the light_density integral lands ~0.9× of the prior 3-sample one —
  // close enough that the 9.0/18.0 Beer-Powder multipliers preserve the
  // lit/shadow contrast without re-tuning.
  let light_steps_dist: array<f32, 2> = array<f32, 2>(0.012, 0.060);
  let sky_color = vec3(0.55, 0.70, 0.95);

  // Thickness multiplier — scales every density sample so clouds
  // become more opaque + cast deeper self-shadows. User-controlled
  // via the cloud_thickness uniform.
  let thick = u.cloud_thickness;

  for (var i = 0; i < steps; i = i + 1) {
    let t = t_start + (f32(i) + jitter) * dt;
    let p_local = ro + rd * t - planet_center;
    let d_raw = cloudDensity(p_local, total_rot, phase, coverage, freq_mul);
    let d = d_raw * thick;
    if (d < 0.002) { continue; }

    // Optical depth toward sun via 2 log-spaced samples (close + far),
    // each using the stripped cloudDensityShadow() — 2-octave cumulus
    // shape only. Shadow integration smooths out high-freq detail so
    // dropping puffs + erosion is invisible. This is the biggest single
    // perf win in the cloud pass.
    var light_density = 0.0;
    for (var j = 0; j < 2; j = j + 1) {
      let pl = p_local + sun * light_steps_dist[j];
      light_density = light_density + cloudDensityShadow(pl, total_rot, phase, coverage, freq_mul) * thick * light_steps_dist[j];
    }
    // Beer-Powder: direct attenuation + powder term (dark heart on
    // thick clouds when viewed perpendicular to sun). Symmetric
    // around perpendicular so both front-lit and backlit clouds
    // get the powder shading.
    let beer = exp(-light_density * 9.0);
    let powder = 1.0 - exp(-light_density * 18.0);
    let perp_factor = 1.0 - abs(cos_theta);                          // 0 at aligned, 1 perpendicular
    let beer_powder = beer * mix(1.0, 1.0 - powder * 0.55, perp_factor);

    // (1) LAMBERTIAN BASELINE — view-independent direct light.
    // Without this, front-lit clouds vanish. Multiplier (5.0) tuned
    // so cumulus reads bright in normal sunlight.
    let lambert = beer_powder * sun_brightness * 5.0;

    // (2) PHASE BOOST — directional silver-lining/halo on top.
    let directional = beer_powder * phase_term * sun_brightness * 9.0;

    // (3) SKY AMBIENT — top-of-cloud sky bounce.
    let n_sphere = normalize(p_local);
    let sky_lift = (max(n_sphere.y, 0.0) * 0.4 + 0.18) * 0.20;
    let sky_amb = sky_color * sky_lift;

    let scattered = cloud_color * (lambert + directional) + cloud_color * sky_amb;

    // Beer's law on accumulated cloud density for opacity.
    let sample_alpha = 1.0 - exp(-d * 8.5 * dt);
    color = color + scattered * sample_alpha * transmittance;
    transmittance = transmittance * (1.0 - sample_alpha);
    // Early-out at 0.05: once 95% of light is absorbed, remaining
    // samples contribute below visible threshold (well under 1 LSB at
    // 8-bit). Cheap lift for dense cloud cover paths.
    if (transmittance < 0.05) { break; }
  }
  return vec4(color, 1.0 - transmittance);
}

// ── Milky Way + nebulae background ──
// Soft galactic plane band tilted at an arbitrary angle, with FBM
// nebula clouds along it. Adds depth + cosmic atmosphere to the
// star field. Returns rgb to add to the sky.
fn milkyWay(rd: vec3<f32>) -> vec3<f32> {
  // Galactic plane normal — fixed orientation.
  let plane_normal = normalize(vec3(0.45, 0.85, 0.30));
  let off_plane = abs(dot(rd, plane_normal));
  // Gaussian band: bright near the plane, fades to dark at poles.
  let band = exp(-off_plane * off_plane * 16.0);
  if (band < 0.005) { return vec3(0.0); }
  // FBM clouds along the galactic plane.
  let p = rd * 5.0;
  let nebula_a = fbm(p, 5);
  let nebula_b = fbm(p * 3.0 + vec3(11.0), 4);
  let intensity = band * (0.4 + 0.6 * nebula_a) * (0.6 + 0.4 * nebula_b);
  // Colour: warm reds and blues — interstellar dust.
  let warm = vec3(0.65, 0.45, 0.30);
  let cool = vec3(0.30, 0.40, 0.65);
  let hue = mix(warm, cool, nebula_b);
  return hue * intensity * 0.35;
}

// ── ACES filmic tonemap ──
// Industry-standard cinematic tonemap. Compresses highlights more
// elegantly than Reinhard while preserving deep blacks. The values
// are the Krzysztof Narkowicz approximation.
fn tonemap_aces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3(0.0), vec3(1.0));
}

// ── Saturn rings — analytic SDF with multi-band detail ──
// Three major rings (C, B, A) separated by the Cassini Division.
// Encke + Maxwell sub-gaps add character. FBM micro-banding gives
// granular detail at every zoom level. detail_mul (0..1.5) scales
// the high-frequency micro-bands so the user can dial granularity.
fn ringDetailedColor(r: f32, rad_inner: f32, rad_outer: f32, detail_mul: f32) -> vec4<f32> {
  if (r < rad_inner || r > rad_outer) { return vec4(0.0); }
  let t = (r - rad_inner) / (rad_outer - rad_inner);

  // Major-band density profile. Ranges roughly correspond to real
  // Saturn rings rescaled to [0..1]:
  //   C ring  : t ∈ [0.00, 0.18]   thin, dim
  //   B ring  : t ∈ [0.18, 0.50]   bright, dense (most opaque)
  //   Cassini : t ∈ [0.50, 0.55]   gap
  //   A ring  : t ∈ [0.55, 0.90]   medium opacity
  //   Encke   : t ≈  0.78          narrow gap inside A
  var density = 0.0;
  // C
  density = density + smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.16, 0.20, t)) * 0.32;
  // Inside C, faint Maxwell gap at t ≈ 0.10
  let maxwell = smoothstep(0.095, 0.105, t) * (1.0 - smoothstep(0.115, 0.105, t));
  density = density * (1.0 - maxwell * 0.7);
  // B (densest)
  density = density + smoothstep(0.16, 0.22, t) * (1.0 - smoothstep(0.46, 0.52, t)) * 0.95;
  // Cassini gap
  let cassini = smoothstep(0.49, 0.52, t) * (1.0 - smoothstep(0.55, 0.58, t));
  density = density * (1.0 - cassini * 0.92);
  // A
  density = density + smoothstep(0.52, 0.58, t) * (1.0 - smoothstep(0.86, 0.92, t)) * 0.62;
  // Encke
  let encke = smoothstep(0.775, 0.78, t) * (1.0 - smoothstep(0.795, 0.79, t));
  density = density * (1.0 - encke * 0.85);
  // Inner taper + outer fade
  density = density * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.92, 1.0, t));

  // FBM micro-banding along radius — gives the granular ringlet
  // texture you see in Cassini imagery. Two octaves at very different
  // frequencies stack up to look natural. detail_mul scales it.
  let micro_a = fbm(vec3(t * 90.0, 0.0, 0.0), 4);
  let micro_b = fbm(vec3(t * 240.0 + 7.0, 0.0, 0.0), 3);
  let micro = (micro_a * 0.6 + micro_b * 0.4) - 0.5;
  density = density * (1.0 + micro * 0.45 * detail_mul);

  // Hairline ringlets — sinusoidal detail to suggest individual
  // ringlets at very high zoom. Frequency scales with detail.
  let ringlet = sin(t * 380.0) * 0.5 + 0.5;
  density = density * (0.85 + 0.15 * ringlet * detail_mul);

  // Color: warm cream in the dense B, cooler greys outward, and a
  // hint of dim brown in C. Real Saturn rings look like this in
  // visible-light imaging.
  let cream = vec3(0.97, 0.88, 0.65);
  let cool  = vec3(0.72, 0.68, 0.58);
  let dim   = vec3(0.50, 0.45, 0.38);
  var col = mix(dim, cream, smoothstep(0.0, 0.25, t));
  col = mix(col, cool, smoothstep(0.55, 0.95, t));

  return vec4(col, clamp(density, 0.0, 1.0));
}

// ── Camera matrix — yaw/pitch around target with given distance. ──
fn cameraDir(uv: vec2<f32>) -> vec3<f32> {
  // Build basis: planet at origin, camera offset by distance + orbit.
  let yaw = u.camera_yaw * PI / 180.0;
  let pitch = u.camera_pitch * PI / 180.0;
  let cy = cos(yaw); let sy = sin(yaw);
  let cp = cos(pitch); let sp = sin(pitch);
  // Camera position around origin
  let cam = vec3(sy * cp, sp, -cy * cp) * u.camera_distance;
  // Forward = -cam direction (looking at origin)
  let fwd = -normalize(cam);
  let right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let f = 1.0 / tan(u.fov_deg * 0.5 * PI / 180.0);
  return normalize(uv.x * right + uv.y * up + f * fwd);
}

fn cameraPos() -> vec3<f32> {
  let yaw = u.camera_yaw * PI / 180.0;
  let pitch = u.camera_pitch * PI / 180.0;
  let cy = cos(yaw); let sy = sin(yaw);
  let cp = cos(pitch); let sp = sin(pitch);
  return vec3(sy * cp, sp, -cy * cp) * u.camera_distance;
}

// Sun direction in world space.
fn sunDir() -> vec3<f32> {
  let yaw = u.sun_yaw * PI / 180.0;
  let pitch = u.sun_pitch * PI / 180.0;
  let cy = cos(yaw); let sy = sin(yaw);
  let cp = cos(pitch); let sp = sin(pitch);
  return normalize(vec3(sy * cp, sp, -cy * cp));
}

// Atmosphere scattering colour — approximate Rayleigh-ish per-planet
// rim glow. Returns RGB to add at the silhouette.
fn atmosphereTint(planet_id: u32) -> vec3<f32> {
  // Earth: blue. Mars: dusty pink. Jupiter: pale cream. Saturn: pale gold.
  if (planet_id == 0u) { return vec3(0.30, 0.55, 1.05); }
  if (planet_id == 1u) { return vec3(0.85, 0.55, 0.42); }
  if (planet_id == 2u) { return vec3(0.85, 0.78, 0.62); }
  return vec3(0.92, 0.85, 0.65);
}

// Rotate vector around Y axis by angle (radians).
fn rotateY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// ── Vertex: full-screen triangle ──
struct V { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_full(@builtin(vertex_index) vid: u32) -> V {
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  var out: V;
  out.clip = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2(x, y);
  return out;
}

// ── Fragment: the planet ──
@fragment fn fs_planet(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let frag = pos.xy;
  // Centered, aspect-corrected screen UV.
  let uv = (frag - u.resolution * 0.5) / u.resolution.y;
  // Y in clip space goes down for fragment coords; flip so UP is positive y.
  let uv2 = vec2(uv.x, -uv.y);

  let ro = cameraPos();
  let rd = cameraDir(uv2);
  // Planet center is offset in world space — moves the planet around
  // in the frame independently of camera orbit. Camera always looks
  // at world origin so the offset just shifts the sphere within the
  // field of view.
  let center = vec3(u.planet_x, u.planet_y, 0.0);
  let r_planet = 1.0;
  let r_atmo = r_planet * (1.0 + u.atmosphere_height);
  let r_cloud = r_planet * 1.012;
  let sun = sunDir();

  // Atmosphere shell intersection (for rim glow + aurora marching).
  let tA = raySphere(ro, rd, center, r_atmo);
  let tP = raySphere(ro, rd, center, r_planet);
  let hits_atmo = tA.x > 0.0;
  let hits_planet = tP.x > 0.0;

  // ── Background ──
  // Stars + Milky Way galactic band. Sky-only: pixels covered by the
  // planet body would overwrite the background entirely on the next
  // branch, so computing starField()/milkyWay() there is pure waste.
  // For a planet that fills 30-40% of the frame, this skips a couple
  // dozen noise lookups per visible-planet pixel.
  var col = vec3(0.0);
  if (!hits_planet) {
    col = starField(rd, u.star_density) + milkyWay(rd) * u.star_density;
  }

  // ── Surface ──
  if (hits_planet) {
    let p = ro + rd * tP.x;
    let n = normalize(p - center);
    let total_rot = (u.rotation_offset + u.rotation_anim) * PI / 180.0;
    let n_rot = rotateY(n, total_rot);

    var base_surface = vec3(0.0);
    if (u.planet_id == 0u)      { base_surface = earthSurface(n_rot); }
    else if (u.planet_id == 1u) { base_surface = marsSurface(n_rot); }
    else if (u.planet_id == 2u) { base_surface = jupiterSurface(n_rot); }
    else                         { base_surface = saturnSurface(n_rot); }

    // Perturbed normal from heightmap — gives real terrain shadows
    // (mountain ranges cast shadow at low sun angles). Gas giants
    // skip this and use the smooth sphere normal.
    let n_perturbed = perturbedNormal(n_rot, u.planet_id);
    // Rotate the perturbed normal back into world space for lighting.
    let n_lit = rotateY(n_perturbed, -total_rot);

    // Sun lighting — uses the perturbed normal so terrain self-shadows.
    let nl_smooth = max(dot(n, sun), 0.0);                  // for terminator
    let nl_perturbed = max(dot(n_lit, sun), 0.0);            // for terrain
    let term = smoothstep(-0.05, 0.15, dot(n, sun));
    let ambient = 0.06;
    let lighting = (ambient + nl_perturbed * u.sun_brightness) * term + ambient * (1.0 - term);
    var surface = base_surface * lighting;

    // Self-emission — surface glows independent of sun.
    surface = surface + base_surface * u.emission;

    // ── Earth shoreline glow ──
    // Glowing ring at the EXACT outline of every continent. Color +
    // intensity + width all under user control via the panel. A
    // small night-side boost so the rim is visible on the dark
    // hemisphere too.
    if (u.planet_id == 0u && u.shoreline_intensity > 0.001) {
      let glow = earthShorelineGlow(n_rot);
      let night_boost = 1.0 + (1.0 - term) * 0.6;
      surface = surface + glow * night_boost;
    }

    // Specular sun-glint on Earth oceans.
    if (u.planet_id == 0u) {
      let view = normalize(ro - p);
      let halfV = normalize(sun + view);
      let spec = pow(max(dot(n, halfV), 0.0), 64.0) * smoothstep(0.0, 0.4, nl_smooth);
      surface = surface + vec3(1.0, 0.95, 0.85) * spec * 0.45 * u.sun_brightness;
    }

    col = surface;
  }

  // ── Volumetric clouds (ray-march through cloud shell) ──
  // Marches through the cloud shell IN FRONT of the planet hit (or
  // through the full chord if missing the planet). Lit by sun, with
  // self-shadowing + forward scattering (silver lining).
  if (u.cloud_coverage > 0.001) {
    // Cloud shell is now taller (1.005 → 1.060) to give cumulus
    // more visible vertical depth. Matches cloudDensity's r_low /
    // r_high.
    let cloud_inner = r_planet * 1.005;
    let cloud_outer = r_planet * 1.060;
    let tCi = raySphere(ro, rd, center, cloud_inner);
    let tCo = raySphere(ro, rd, center, cloud_outer);
    if (tCo.x > 0.0) {
      // Front cap of the cloud shell, terminated by the planet hit
      // if we hit it before exiting the shell.
      let t_start = max(tCo.x, 0.0);
      var t_end = tCo.y;
      if (hits_planet && tP.x < t_end) { t_end = tP.x; }
      // If we entered the inner sphere (planet+near-cloud), march
      // only the front cap of the cloud shell.
      if (tCi.x > 0.0 && tCi.x < t_end) { t_end = tCi.x; }
      let total_rot = (u.rotation_offset + u.rotation_anim) * PI / 180.0;
      var cloud_freq_mul = 1.0;
      if (u.planet_id == 1u) { cloud_freq_mul = 0.8; }
      if (u.planet_id == 2u) { cloud_freq_mul = 1.6; }
      if (u.planet_id == 3u) { cloud_freq_mul = 1.4; }
      let cloud_rgba = marchClouds(
        ro, rd, t_start, t_end, sun, center,
        total_rot, u.cloud_phase, u.cloud_coverage, cloud_freq_mul,
        u.cloud_color, u.sun_brightness,
      );
      col = mix(col, cloud_rgba.rgb, cloud_rgba.a);
    }
  }

  // ── Volumetric atmosphere ──
  // Ray-march the atmosphere shell with per-sample sun lighting.
  // Gives proper Rayleigh-ish color shifts (planet rim glows in
  // its atmosphere tint, color gets warmer when viewing the
  // terminator at a glancing angle = "sunset" effect).
  if (hits_atmo && u.atmosphere_height > 0.0001) {
    let t_start = max(tA.x, 0.0);
    let t_end = select(tA.y, tP.x, hits_planet);
    let scattered = marchAtmosphere(
      ro, rd, t_start, t_end, sun,
      center, r_planet, r_atmo, u.planet_id, u.sun_brightness,
    );
    col = col + scattered;
  }

  // ── Outer glow halo ──
  // Soft luminous halo extending OUTSIDE the planet/atmosphere,
  // independent of physical scattering. Lets the user push the
  // planet to look like a glowing celestial body. Falls off with
  // angular distance to the planet center.
  if (u.outer_glow > 0.0001) {
    // Closest approach distance (in world units) from ray to the
    // planet center — used as the falloff metric.
    let to_center = center - ro;
    let proj = dot(to_center, rd);
    let closest = ro + rd * max(proj, 0.0);
    let dist = length(closest - center);
    // Fade from full at the planet surface to nothing at ~3 radii out.
    let halo = 1.0 - smoothstep(r_planet, r_planet * 3.0, dist);
    let halo_tint = atmosphereTint(u.planet_id);
    col = col + halo_tint * pow(halo, 2.5) * u.outer_glow * 0.7;
  }

  // ── Aurora — only Earth, at high latitudes. We march a few
  // samples through the atmosphere shell looking for points where
  // the polar curtain pattern lights up. ──
  if (u.planet_id == 0u && u.aurora_strength > 0.001 && hits_atmo) {
    let t_start = max(tA.x, 0.0);
    let t_end = select(tA.y, tP.x, hits_planet);
    let span = max(t_end - t_start, 0.0);
    let steps: i32 = 6;
    var aur = vec3(0.0);
    for (var i = 0; i < steps; i = i + 1) {
      let f = (f32(i) + 0.5) / f32(steps);
      let t = t_start + span * f;
      let p = ro + rd * t;
      // Translate to planet-local space, then rotate. Aurora moves
      // with the world and stays anchored to the planet (which may
      // be offset via planet_x/y).
      let p_local = p - center;
      let total_rot = (u.rotation_offset + u.rotation_anim) * PI / 180.0;
      let p_rot = rotateY(p_local, total_rot);
      aur = aur + auroraColor(p_rot, u.time);
    }
    aur = aur * (span / f32(steps)) * 0.6;
    col = col + aur * u.aurora_strength;
  }

  // ── Saturn rings ──
  // Analytic ray-plane intersection on the planet's equatorial
  // plane, multi-band detail with FBM micro-structure, sun-shadow
  // from the planet body. Plane moves with the planet's offset.
  if (u.planet_id == 3u && u.ring_opacity > 0.001) {
    let t_ring = rayPlaneY(ro, rd, center.y);
    if (t_ring > 0.0) {
      let ring_pt = (ro + rd * t_ring) - center;
      let r = length(ring_pt.xz);
      let occluded_by_planet = hits_planet && tP.x < t_ring;
      if (!occluded_by_planet) {
        let rc = ringDetailedColor(r, u.ring_inner, u.ring_outer, u.ring_detail);
        let alpha = rc.a * u.ring_opacity;
        // Sun shadow — if the line from ring point to sun passes
        // through the planet body, that ring patch is in shadow.
        let along = dot(ring_pt, sun);
        let perp = ring_pt - sun * along;
        let in_shadow = step(length(perp), r_planet) * step(0.0, along);
        // Forward-scattering brightness boost when the camera looks
        // toward the sun through the rings (gives that lit-up
        // backlit ring look from Cassini's "In Saturn's Shadow").
        let view = normalize(ro - (ring_pt + center));
        let phase = max(dot(view, -sun), 0.0);
        let backlit = pow(phase, 6.0) * 0.6;
        let lit = mix(0.95 * u.sun_brightness + backlit, 0.20, in_shadow);
        col = mix(col, rc.rgb * lit, alpha);
      }
    }
  }

  // ── ACES filmic tonemap + slight contrast pop ──
  // ACES handles bright atmosphere/aurora highlights way better
  // than Reinhard — keeps colors saturated instead of bleaching to
  // white. Slight gamma curve at the end for cinematic punch.
  col = tonemap_aces(col);
  col = pow(col, vec3(0.95));

  return vec4(col, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────
// JS implementation
// ─────────────────────────────────────────────────────────────

const planetBindGroupLayouts = new WeakMap<object, any>();
const planetPipelineLayouts = new WeakMap<object, any>();

function getPlanetBindGroupLayout(device: any): any {
  const key = device as object;
  let layout = planetBindGroupLayouts.get(key);
  if (!layout) {
    layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    planetBindGroupLayouts.set(key, layout);
  }
  return layout;
}

function getPlanetPipelineLayout(device: any): any {
  const key = device as object;
  let layout = planetPipelineLayouts.get(key);
  if (!layout) {
    layout = device.createPipelineLayout({ bindGroupLayouts: [getPlanetBindGroupLayout(device)] });
    planetPipelineLayouts.set(key, layout);
  }
  return layout;
}

function planetPipelineKey(format: any): string {
  return `planet:${String(format)}`;
}

function createPlanetPipelineDescriptor(device: any, format: any, module: any): Record<string, any> {
  return {
    label: planetPipelineKey(format),
    layout: getPlanetPipelineLayout(device),
    vertex: { module, entryPoint: 'vs_full' },
    fragment: {
      module,
      entryPoint: 'fs_planet',
      targets: [{
        format,
        // The planet renders fully opaque (background covers stars
        // + atmosphere), so simple "over" blend is fine. Premultiplied
        // alpha means the engine compositor can blend it normally.
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  };
}

export function prewarmWebGPUPlanet(device: any, presentFormat: any, runtime?: GhostGpuRuntime | null): Promise<any> | void {
  const shaderRuntime = runtime ?? getGhostGpuRuntime();
  const module = createAndWarmWgslShaderModule(shaderRuntime ?? device, PLANET_WGSL, `planet/${String(presentFormat)}`);
  const descriptor = createPlanetPipelineDescriptor(device, presentFormat, module);
  if (shaderRuntime) {
    return shaderRuntime.warmRenderPipeline(descriptor, planetPipelineKey(presentFormat));
  }
  device.createRenderPipeline(descriptor);
}

export class WebGPUPlanet implements GpuShaderImpl {
  readonly device: any;
  readonly presentFormat: any;

  private uniformBuffer: any;
  private bindGroupLayout: any;
  private pipelineByFormat: Map<string, any> = new Map();
  private bindGroup: any;

  // Mutable state — accumulated rotation + cloud phase so they
  // continue across frames regardless of the user's `time` knob.
  private startTime = performance.now();
  private accumRotation = 0;        // degrees
  private cloudPhase = 0;
  private lastFrameTime = performance.now();

  // Snapshot of last params so we can read in encodeFrame.
  private params: Record<string, any> = { ...planetParamDefaults };

  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;

    // Globals struct = 176 bytes. Layout matches the WGSL Globals:
    //   resolution(8) + time(4) + planet_id(4)              → 16
    //   distance + fov + yaw + pitch                          → 16
    //   rot_off + rot_anim + sun_yaw + sun_pitch              → 16
    //   cloud_cov + cloud_phase + atmo_h + aurora             → 16
    //   star_density + ring_in + ring_out + ring_opacity      → 16
    //   cloud_color (vec3) + sun_brightness                   → 16
    //   planet_x + planet_y + ring_detail + pad               → 16
    //   emission + outer_glow + 2 pad                         → 16
    //   land_color (vec3) + shoreline_intensity               → 16
    //   shoreline_color (vec3) + shoreline_width              → 16
    //   cloud_thickness + 3 pad                               → 16
    this.uniformBuffer = device.createBuffer({
      size: 176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = getPlanetBindGroupLayout(device);
    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    console.log('[WebGPUPlanet] initialised');
  }

  setParams(p: Record<string, any>): void {
    this.params = { ...planetParamDefaults, ...p };
  }

  private getOrCreatePipeline(format: any): any {
    const key = String(format);
    const cached = this.pipelineByFormat.get(key);
    if (cached) return cached;
    const shaderRuntime = getGhostGpuRuntime();
    const mod = createAndWarmWgslShaderModule(shaderRuntime ?? this.device, PLANET_WGSL, `planet/${key}`);
    const descriptor = createPlanetPipelineDescriptor(this.device, format, mod);
    const pipeline = shaderRuntime?.createRenderPipeline(descriptor, planetPipelineKey(format))
      ?? this.device.createRenderPipeline(descriptor);
    this.pipelineByFormat.set(key, pipeline);
    return pipeline;
  }

  encodeFrame(encoder: any, targetView: any, targetFormat: any, width: number, height: number, dt: number, time?: number): void {
    const now = performance.now();
    this.lastFrameTime = now;
    const frameDt = Math.max(0, Math.min(0.1, dt));
    this.accumRotation = (this.accumRotation + (this.params.rotationSpeed ?? 0) * frameDt) % 360;
    this.cloudPhase += (this.params.cloudSpeed ?? 0) * frameDt;
    const totalTime = typeof time === 'number' && Number.isFinite(time)
      ? Math.max(0, time)
      : (now - this.startTime) / 1000;

    const planetId = PLANET_IDS[String(this.params.planet ?? 'earth')] ?? 0;

    // Build Globals uniform — 176 bytes, see WGSL Globals struct.
    const buf = new ArrayBuffer(176);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = width;
    f[1] = height;
    f[2] = totalTime;
    u[3] = planetId;
    f[4] = this.params.cameraDistance ?? 4.0;
    f[5] = this.params.fovDeg ?? 50;
    f[6] = this.params.cameraYaw ?? 0;
    f[7] = this.params.cameraPitch ?? 0;
    f[8] = this.params.rotationOffset ?? 0;
    f[9] = this.accumRotation;
    f[10] = this.params.sunYaw ?? -45;
    f[11] = this.params.sunPitch ?? 15;
    f[12] = this.params.cloudCoverage ?? 0.55;
    f[13] = this.cloudPhase;
    f[14] = this.params.atmosphereHeight ?? 0.06;
    f[15] = this.params.auroraStrength ?? 0.7;
    f[16] = this.params.starDensity ?? 1.0;
    f[17] = this.params.ringInner ?? 1.3;
    f[18] = this.params.ringOuter ?? 2.2;
    f[19] = this.params.ringOpacity ?? 0.95;
    // ── Cloud color (rgb 0..255 → 0..1) + sun brightness ──
    const cc = this.params.cloudColor ?? [255, 255, 255];
    f[20] = (cc[0] ?? 255) / 255;
    f[21] = (cc[1] ?? 255) / 255;
    f[22] = (cc[2] ?? 255) / 255;
    f[23] = this.params.sunBrightness ?? 1.0;
    // ── Planet offset + ring detail (+ 1 pad) ──
    f[24] = this.params.planetX ?? 0;
    f[25] = this.params.planetY ?? 0;
    f[26] = this.params.ringDetail ?? 1.0;
    // f[27] pad
    // ── Emission + outer glow (+ 2 pad) ──
    f[28] = this.params.emission ?? 0;
    f[29] = this.params.outerGlow ?? 0;
    // ── Earth land + shoreline + cloud thickness ──
    const lc = this.params.landColor ?? [110, 175, 70];
    f[32] = (lc[0] ?? 110) / 255;
    f[33] = (lc[1] ?? 175) / 255;
    f[34] = (lc[2] ?? 70)  / 255;
    f[35] = this.params.shorelineIntensity ?? 1.6;
    const sc = this.params.shorelineColor ?? [60, 230, 220];
    f[36] = (sc[0] ?? 60)  / 255;
    f[37] = (sc[1] ?? 230) / 255;
    f[38] = (sc[2] ?? 220) / 255;
    f[39] = this.params.shorelineWidth ?? 0.04;
    f[40] = this.params.cloudThickness ?? 1.8;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, buf);

    const pipeline = this.getOrCreatePipeline(targetFormat);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
  }

  dispose(): void {
    try { this.uniformBuffer?.destroy?.(); } catch { /* */ }
  }
}
