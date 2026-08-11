struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  command_phase: f32,
  layer_count: f32,
  frame_count: f32,
  // Master output gate: 1.0 normal, 0.0 blackout. Applied to the final
  // composite so blackout kills the real output, not just the editor's
  // DOM preview overlay.
  output_gate: f32,
  // Number of composite-stage effects in `post` (0..8).
  post_count: f32,
  audio0: vec4<f32>, // level, bass, mid, treble
  audio1: vec4<f32>, // high, beat, beat phase, bpm
  audio2: vec4<f32>, // centroid, kick, snare, active
  // Composite-stage effects, applied to the blended frame: composition
  // effects first, then macro effect bundles. Each entry is the same
  // [op, amount, _, mix] descriptor apply_native_effect() takes for layer
  // effects; `mix` carries the macro's wet/dry knob (1.0 for composition
  // effects, which are always fully wet).
  post: array<vec4<f32>, 8>,
  // Output stage, mirroring the WebGL output quad + overlay:
  //   out0 = crop (x, y, width, height) in source UV
  //   out1 = (rotation quarter-turns, brightness, contrast, gamma)
  //   edge = edge-blend widths (left, right, top, bottom) as UV fractions
  //   dome0 = (enabled, mode, fov radians, rotation radians)
  //   dome1 = (tilt radians, offset x, offset y, curvature)
  //   dome2 = (truncation, edge-blend gamma, slice mode, _)
  //   edge_gamma = per-edge blend gamma (left, right, top, bottom)
  //   black_level = projector black-level lift (r, g, b, feather)
  // Slice mode selects the multi-projector grade used by blendRenderer —
  // linear-light working space, inverse gamma, Bourke blend curve and
  // black-level lift — instead of the single-output grade.
  out0: vec4<f32>,
  out1: vec4<f32>,
  edge: vec4<f32>,
  dome0: vec4<f32>,
  dome1: vec4<f32>,
  dome2: vec4<f32>,
  edge_gamma: vec4<f32>,
  black_level: vec4<f32>,
  // Output-side geometry warp, run in two stages so a keystoned projector
  // can sit under a master warp exactly as the WebGL two-pass path does:
  //   swarp  = per-slice screen warp   (mode 0 rect, 1 corners, 2 mesh)
  //   mwarp  = master warp             (mode 0 off,  3 corners+mesh)
  // Each block is (mode, rows, cols, _) with its corner quad in c0/c1 as
  // (TL.xy, TR.xy) and (BR.xy, BL.xy), and its control points packed two
  // per vec4 in the matching mesh array (row-major, up to 16x16).
  swarp: vec4<f32>,
  swarp_c0: vec4<f32>,
  swarp_c1: vec4<f32>,
  mwarp: vec4<f32>,
  mwarp_c0: vec4<f32>,
  mwarp_c1: vec4<f32>,
  swarp_mesh: array<vec4<f32>, 128>,
  mwarp_mesh: array<vec4<f32>, 128>,
}

@group(0) @binding(0)
var<uniform> u: Uniforms;

struct GhostAudioUniforms {
  audio0: vec4<f32>,
  audio1: vec4<f32>,
  audio2: vec4<f32>,
}

fn ghost_audio_from_vecs(audio0: vec4<f32>, audio1: vec4<f32>, audio2: vec4<f32>) -> GhostAudioUniforms {
  return GhostAudioUniforms(audio0, audio1, audio2);
}

fn ghost_audio_scene() -> GhostAudioUniforms {
  return ghost_audio_from_vecs(u.audio0, u.audio1, u.audio2);
}

fn ghost_audio_active(audio: GhostAudioUniforms) -> f32 {
  return clamp(audio.audio2.w, 0.0, 1.0);
}

fn ghost_audio_raw_level(audio: GhostAudioUniforms) -> f32 { return audio.audio0.x; }
fn ghost_audio_raw_bass(audio: GhostAudioUniforms) -> f32 { return audio.audio0.y; }
fn ghost_audio_raw_mid(audio: GhostAudioUniforms) -> f32 { return audio.audio0.z; }
fn ghost_audio_raw_treble(audio: GhostAudioUniforms) -> f32 { return audio.audio0.w; }
fn ghost_audio_raw_high(audio: GhostAudioUniforms) -> f32 { return audio.audio1.x; }
fn ghost_audio_raw_beat(audio: GhostAudioUniforms) -> f32 { return audio.audio1.y; }
fn ghost_audio_beat_phase(audio: GhostAudioUniforms) -> f32 { return audio.audio1.z; }
fn ghost_audio_bpm(audio: GhostAudioUniforms) -> f32 { return audio.audio1.w; }
fn ghost_audio_raw_centroid(audio: GhostAudioUniforms) -> f32 { return audio.audio2.x; }
fn ghost_audio_raw_kick(audio: GhostAudioUniforms) -> f32 { return audio.audio2.y; }
fn ghost_audio_raw_snare(audio: GhostAudioUniforms) -> f32 { return audio.audio2.z; }

fn ghost_audio_level(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_level(audio) * ghost_audio_active(audio); }
fn ghost_audio_bass(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_bass(audio) * ghost_audio_active(audio); }
fn ghost_audio_mid(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_mid(audio) * ghost_audio_active(audio); }
fn ghost_audio_treble(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_treble(audio) * ghost_audio_active(audio); }
fn ghost_audio_high(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_high(audio) * ghost_audio_active(audio); }
fn ghost_audio_beat(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_beat(audio) * ghost_audio_active(audio); }
fn ghost_audio_centroid(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_centroid(audio) * ghost_audio_active(audio); }
fn ghost_audio_kick(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_kick(audio) * ghost_audio_active(audio); }
fn ghost_audio_snare(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_snare(audio) * ghost_audio_active(audio); }

fn ghost_audio_band_drive(bass: f32, mid: f32, treble: f32, weights: vec3<f32>) -> f32 {
  return clamp(dot(vec3<f32>(bass, mid, treble), weights), 0.0, 1.0);
}

fn ghost_audio_uniform_band_drive(audio: GhostAudioUniforms, weights: vec3<f32>) -> f32 {
  return ghost_audio_band_drive(
    ghost_audio_bass(audio),
    ghost_audio_mid(audio),
    ghost_audio_treble(audio),
    weights,
  );
}

fn ghost_audio_soft_gate(x: f32, threshold: f32, softness: f32) -> f32 {
  return smoothstep(threshold - softness, threshold + softness, x);
}

fn ghost_audio_pulse(phase: f32, width: f32) -> f32 {
  let p = abs(fract(phase) * 2.0 - 1.0);
  return 1.0 - smoothstep(0.0, max(width, 1e-4), p);
}

struct LayerData {
  p0: vec4<f32>,
  p1: vec4<f32>,
  color: vec4<f32>,
  info: vec4<f32>,
  params0: vec4<f32>,
  params1: vec4<f32>,
  style: vec4<f32>,
  uv0: vec4<f32>,
  uv1: vec4<f32>,
  shape: vec4<f32>,
  shape2: vec4<f32>,
  shape_meta: vec4<f32>,
  shape_pts: array<vec4<f32>, 32>,
  effect0: vec4<f32>,
  effect1: vec4<f32>,
  effect2: vec4<f32>,
  effect3: vec4<f32>,
  edge_effects: array<array<vec4<f32>, 7>, 4>,
  mask_info: vec4<f32>,
  mask: array<vec4<f32>, 64>,
  mesh: array<vec4<f32>, 128>,
  source_rect: vec4<f32>,
}

@group(0) @binding(1)
var<storage, read> layers: array<LayerData>;

@group(0) @binding(2)
var<storage, read> source_previews: array<vec4<f32>>;

@group(0) @binding(3)
var source_frames: texture_2d_array<f32>;

@group(0) @binding(4)
var source_frame_sampler: sampler;

const SOURCE_PREVIEW_SIZE: i32 = 256;
const SOURCE_PREVIEW_PIXELS: i32 = SOURCE_PREVIEW_SIZE * SOURCE_PREVIEW_SIZE;
const MAX_SOURCE_PREVIEW_SLOTS: i32 = 16;
const MAX_SOURCE_FRAME_SLOTS: i32 = 24;
const SOURCE_FRAME_SLOT_OFFSET: f32 = 100.0;
const NATIVE_SHADER_SOURCE_KIND: f32 = 17.0;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let p = pos[vertex_index];
  var out: VertexOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

fn hash21(p: vec2<f32>) -> f32 {
  let q = fract(vec2<f32>(
    dot(p, vec2<f32>(127.1, 311.7)),
    dot(p, vec2<f32>(269.5, 183.3))
  ));
  return fract(sin(q.x + q.y) * 43758.5453123);
}

fn value_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  let w = f * f * (vec2<f32>(3.0) - 2.0 * f);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    sum += value_noise(p * freq) * amp;
    freq *= 2.13;
    amp *= 0.52;
  }
  return sum;
}

fn proxy_palette(x: f32) -> vec3<f32> {
  return 0.55 + 0.45 * cos(vec3<f32>(0.0, 2.1, 4.2) + x * 6.2831853);
}

fn soft_particle(p: vec2<f32>, center: vec2<f32>, radius: f32) -> f32 {
  let d = p - center;
  return exp(-dot(d, d) / max(0.0001, radius * radius));
}

fn shaded_proxy_sphere(uv: vec2<f32>, center: vec2<f32>, radius: f32, hue: f32, depth: f32, t: f32) -> vec4<f32> {
  let d = uv - center;
  let dist = length(d);
  let px = 1.5 / max(1.0, min(u.resolution.x, u.resolution.y));
  let edge_width = max(px * 2.5, fwidth(dist) * 1.65);
  let mask = 1.0 - smoothstep(radius - edge_width, radius + edge_width, dist);
  let q = d / max(radius, 0.0001);
  let z = sqrt(max(0.0, 1.0 - dot(q, q)));
  let n = normalize(vec3<f32>(q.x, q.y, z));
  let light_dir = normalize(vec3<f32>(-0.42 + 0.22 * sin(t * 0.37 + depth), 0.56, 0.72));
  let view_dir = vec3<f32>(0.0, 0.0, 1.0);
  let diffuse = pow(clamp(dot(n, light_dir) * 0.5 + 0.5, 0.0, 1.0), 1.45);
  let spec = pow(max(dot(reflect(-light_dir, n), view_dir), 0.0), 30.0);
  let fresnel = pow(1.0 - clamp(z, 0.0, 1.0), 2.4);
  let striation = 0.5 + 0.5 * sin((n.x * 7.0 + n.y * 5.5 + n.z * 2.0) + t * 0.32 + hue * 6.2831853);
  let surface_noise = fbm(uv * (5.0 + depth * 3.0) + vec2<f32>(t * 0.035, -t * 0.025));
  let base = proxy_palette(hue + striation * 0.035 + surface_noise * 0.05);
  var rgb = base * (0.18 + diffuse * 0.95);
  rgb += proxy_palette(hue + 0.22) * fresnel * (0.34 + depth * 0.22);
  rgb += vec3<f32>(1.0, 0.92, 0.78) * spec * (0.58 + depth * 0.42);
  rgb *= 0.78 + depth * 0.38;
  let edge_lift = smoothstep(0.0, 0.22, z);
  let alpha = mask * edge_lift * (0.25 + z * 0.54 + fresnel * 0.16);
  return vec4<f32>(rgb, alpha);
}

fn proxy_ray_sphere(ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, radius: f32) -> vec2<f32> {
  let oc = ro - center;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - c;
  if (h <= 0.0) {
    return vec2<f32>(-1.0);
  }
  let root = sqrt(h);
  return vec2<f32>(-b - root, root);
}

fn native_isf_proxy(source_uv: vec2<f32>, t: f32, seed: f32, params0: vec4<f32>, params1: vec4<f32>) -> vec4<f32> {
  let intensity = clamp(params0.x, 0.0, 4.0);
  let scale = clamp(params0.y, 0.18, 4.0);
  let density = clamp(params0.z, 0.0, 1.0);
  let speed = clamp(params0.w, 0.0, 2.0);
  let style = clamp(params1.x, 0.0, 1.0);
  let variation = clamp(params1.y, 0.0, 1.0);
  let detail = clamp(params1.z, 0.0, 1.0);
  let bg_alpha = clamp(params1.w, 0.0, 1.0);
  let audio = ghost_audio_scene();
  let audio_level = ghost_audio_level(audio);
  let audio_bass = ghost_audio_bass(audio);
  let audio_high = ghost_audio_high(audio);
  let audio_beat = ghost_audio_beat(audio);
  let local_t = t * (0.20 + speed * 1.85) + seed * 0.017 + audio_beat * 0.22;
  let uv = source_uv * 2.0 - vec2<f32>(1.0);
  let aspect_uv = uv * vec2<f32>(max(0.2, u.resolution.x / max(1.0, u.resolution.y)), 1.0);
  let r = length(aspect_uv);
  let a = atan2(uv.y, uv.x);
  let tunnel = sin((r * (18.0 + detail * 52.0)) - local_t * (2.4 + audio_bass * 1.8) + a * (3.0 + variation * 8.0));
  let rings = pow(1.0 - smoothstep(0.0, 0.95, abs(tunnel)), 1.4 + detail * 2.6);
  let field_a = fbm(source_uv * (2.2 + scale * 1.35) + vec2<f32>(local_t * 0.13, -local_t * 0.11));
  let field_b = fbm((source_uv.yx + vec2<f32>(style, variation)) * (5.0 + density * 12.0) - vec2<f32>(local_t * 0.18, local_t * 0.15));
  let rays = smoothstep(0.04, 0.0, abs(fract(a / 6.2831853 * (8.0 + detail * 22.0) + field_b * 0.22 + local_t * 0.09) - 0.5));
  let core = exp(-r * r * (2.2 + scale * 0.8));
  let glow = clamp(rings * (0.35 + density * 0.82) + rays * (0.14 + variation * 0.38) + core * (0.30 + audio_level * 0.62), 0.0, 2.5);
  var col = proxy_palette(style + field_a * 0.13 + local_t * 0.025) * glow;
  col += proxy_palette(style + 0.27 + field_b * 0.08) * core * (0.26 + audio_high * 0.42);
  col += vec3<f32>(0.015, 0.025, 0.045) * bg_alpha;
  col *= 0.48 + intensity * 0.72 + audio_level * 0.35;
  let alpha = clamp(bg_alpha * (0.22 + glow * 0.62 + core * 0.25), 0.0, 0.98);
  return vec4<f32>(max(col, vec3<f32>(0.0)), alpha);
}

fn gpu_proxy(kind: f32, source_uv: vec2<f32>, t: f32, seed: f32, params0: vec4<f32>, params1: vec4<f32>) -> vec4<f32> {
  if (abs(kind - NATIVE_SHADER_SOURCE_KIND) < 0.5) {
    return native_isf_proxy(source_uv, t, seed, params0, params1);
  }
  let intensity = clamp(params0.x, 0.0, 4.0);
  let scale = clamp(params0.y, 0.18, 4.0);
  let density = clamp(params0.z, 0.0, 1.0);
  let speed = clamp(params0.w, 0.0, 2.0);
  let style = clamp(params1.x, 0.0, 1.0);
  let variation = clamp(params1.y, 0.0, 1.0);
  let detail = clamp(params1.z, 0.0, 1.0);
  let bg_alpha = clamp(params1.w, 0.0, 1.0);
  let audio = ghost_audio_scene();
  let audio_level = ghost_audio_level(audio);
  let audio_bass = ghost_audio_bass(audio);
  let audio_treble = ghost_audio_treble(audio);
  let audio_beat = ghost_audio_beat(audio);
  let audio_kick = ghost_audio_kick(audio);
  let audio_snare = ghost_audio_snare(audio);
  let audio_drive = clamp(audio_level * 0.42 + audio_bass * 0.30 + audio_beat * 0.38 + audio_kick * 0.22 + audio_snare * 0.12, 0.0, 1.75);
  let local_t = t * (0.18 + speed * 1.65) * (1.0 + audio_level * 0.45 + audio_beat * 0.28);
  let uv = source_uv * 2.0 - vec2<f32>(1.0);
  let r = length(uv);
  var col = vec3<f32>(0.02, 0.035, 0.055);
  var alpha = 0.72;

  if (kind < 10.5) {
    let body_radius = clamp(0.50 * sqrt(scale), 0.22, 0.82);
    let body = 1.0 - smoothstep(body_radius, body_radius + 0.035, r);
    let band_warp = sin(uv.x * (6.0 + detail * 18.0) + local_t * 0.55 + sin(uv.y * 4.0) * (1.0 + variation * 2.0));
    let bands = 0.5 + 0.5 * sin(uv.y * (14.0 + detail * 34.0) + band_warp + seed * 0.31 + style * 6.2831853);
    let terminator = smoothstep(-0.45, 0.8, -uv.x + uv.y * 0.22 + (style - 0.5) * 0.35);
    let rim = smoothstep(body_radius + 0.02, body_radius - 0.06, r) * smoothstep(body_radius - 0.24, body_radius, r);
    let ring_y = uv.y + 0.14 + 0.08 * variation * sin(uv.x * (4.0 + detail * 12.0) + local_t);
    let ring_width = mix(0.055, 0.018, detail);
    let ring_band = (1.0 - smoothstep(0.012, ring_width, abs(ring_y))) * smoothstep(body_radius * 0.92, body_radius * 1.18, abs(uv.x)) * (1.0 - smoothstep(body_radius * 1.85, body_radius * 2.25, abs(uv.x)));
    let planet = proxy_palette(style + bands * 0.12) * (0.35 + bands * 0.95);
    col = mix(col, planet * (0.42 + terminator * 0.9), body);
    col += proxy_palette(style + 0.32) * rim * (0.24 + detail * 0.45);
    col += proxy_palette(style + 0.64) * ring_band * (0.35 + variation * 0.65);
    alpha = max(body * 0.98, ring_band * (0.42 + variation * 0.52));
  } else if (kind < 13.5) {
    let cell_count = mix(14.0, 58.0, density);
    let flow = vec2<f32>(0.08 * sin(local_t * 0.7 + seed), 0.10 * cos(local_t * 0.58 + seed));
    let grid_uv = source_uv * cell_count / sqrt(scale) + flow * 12.0;
    let cell = floor(grid_uv);
    let f = fract(grid_uv) - vec2<f32>(0.5);
    let sparkle = exp(-dot(f, f) * mix(38.0, 140.0, scale / 4.0)) * (0.35 + 0.65 * hash21(cell + style * 17.0));
    let tunnel = pow(1.0 - abs(fract(r * mix(4.5, 12.5, detail) - local_t * 0.95 + seed * 0.07) - 0.5) * 2.0, 3.0 + variation * 3.0);
    let scan = smoothstep(0.03, 0.0, abs(fract((uv.x - uv.y) * (3.0 + detail * 9.0) + local_t * 0.33) - 0.5));
    col = proxy_palette(r + local_t * 0.08 + seed * 0.01 + style) * (sparkle * (0.75 + density) + tunnel * (0.25 + variation * 0.45) + scan * 0.16);
    col += vec3<f32>(0.02, 0.08, 0.12);
    alpha = clamp(0.36 + sparkle * 0.75 + tunnel * 0.35, 0.0, 0.95);
  } else if (kind < 14.5) {
    let field_scale = mix(20.0, 72.0, density) / sqrt(scale);
    let swirl = sin(r * (14.0 + detail * 40.0) - local_t * 2.2 + uv.x * uv.y * (5.0 + variation * 18.0) + seed * 0.12);
    let arms = pow(1.0 - smoothstep(0.0, 0.9, abs(swirl)), 1.4 + detail * 2.5) * (1.0 - smoothstep(0.0, 1.15 + scale * 0.2, r));
    let star_cell = floor(source_uv * field_scale + vec2<f32>(local_t * 0.18, -local_t * 0.12));
    let star_f = fract(source_uv * field_scale + vec2<f32>(local_t * 0.18, -local_t * 0.12)) - vec2<f32>(0.5);
    let stars = exp(-dot(star_f, star_f) * mix(55.0, 180.0, scale / 4.0)) * step(0.92 - density * 0.34, hash21(star_cell));
    let gravity = exp(-r * r * 5.0);
    col = vec3<f32>(0.04, 0.08, 0.14) + proxy_palette(r * 0.7 + local_t * 0.06 + style) * (arms * 0.9 + stars * 1.25);
    col += proxy_palette(style + 0.22) * gravity * (0.2 + variation * 0.48);
    alpha = clamp(0.38 + arms * 0.48 + stars * 0.9 + gravity * 0.18, 0.0, 0.95);
  } else if (kind < 15.5) {
    let lens = (source_uv - vec2<f32>(0.5)) * vec2<f32>(max(0.4, u.resolution.x / max(1.0, u.resolution.y)), 1.0);
    let soft_vignette = smoothstep(1.2, 0.12, length(lens));
    let ro = vec3<f32>(0.0, 0.04, 3.45);
    let rd = normalize(vec3<f32>(lens * (0.90 - detail * 0.06), -1.84));
    var closest_t = 1.0e6;
    var hit_color = vec3<f32>(0.0);
    var hit_alpha = 0.0;
    var volume_color = vec3<f32>(0.0);
    var volume_alpha = 0.0;
    var glow = vec3<f32>(0.0);
    var glow_energy = 0.0;
    col = vec3<f32>(0.014, 0.018, 0.032) + proxy_palette(style + 0.58) * soft_vignette * 0.055;
    let sphere_count = 34 + i32(floor(detail * 14.0 + density * 12.0));
    for (var i: i32 = 0; i < 64; i = i + 1) {
      if (i >= sphere_count) {
        break;
      }
      let fi = f32(i);
      let depth = 0.5 + 0.5 * sin(local_t * (0.22 + fi * 0.012) + fi * 1.91 + seed * 0.041);
      let lane = fi / max(1.0, f32(sphere_count - 1));
      let swirl = local_t * (0.18 + fi * 0.007) + fi * 2.399963 + seed * 0.037;
      let jitter = hash21(vec2<f32>(fi, seed));
      let center = vec3<f32>(
        sin(swirl) * (0.55 + density * 0.32 + lane * 0.12),
        cos(swirl * 0.78 + variation * 2.7) * (0.36 + density * 0.20) + sin(lane * 7.0 + local_t * 0.27) * 0.07,
        0.55 - lane * (2.65 + density * 0.62) + sin(swirl * 0.37 + fi) * 0.18
      );
      let radius = (0.052 + scale * 0.024) * (0.76 + depth * 0.46 + variation * 0.22 * jitter);
      let hue = style + fi * 0.061 + local_t * 0.012 + jitter * 0.08;
      let hit = proxy_ray_sphere(ro, rd, center, radius);
      let closest_on_ray = dot(center - ro, rd);
      let miss = length(ro - center + rd * closest_on_ray);
      let shell = max(0.0, 1.0 - miss / max(radius * (1.45 + density * 0.65), 0.0001));
      let halo = pow(shell, 3.1) * (0.045 + radius * 0.8) * (0.76 + density * 0.85);
      glow += proxy_palette(hue + 0.08) * halo * (0.50 + depth * 0.48);
      glow_energy += halo;
      if (hit.x > 0.02) {
        let pos = ro + rd * hit.x;
        let n = normalize(pos - center);
        let light_dir = normalize(vec3<f32>(-0.44 + 0.18 * sin(local_t * 0.24), 0.58, 0.68));
        let rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.15);
        let diffuse = pow(clamp(dot(n, light_dir) * 0.5 + 0.5, 0.0, 1.0), 1.18);
        let spec = pow(max(dot(reflect(-light_dir, n), -rd), 0.0), 48.0);
        let span_width = hit.y / max(radius, 0.0001);
        let tangent_softness = smoothstep(0.0, max(0.13, 0.18 + fwidth(span_width) * 4.5), span_width);
        let surface = fbm(n.xy * (2.0 + detail * 4.0) + vec2<f32>(local_t * 0.025, -local_t * 0.017));
        var sphere_color = proxy_palette(hue + surface * 0.05) * (0.15 + diffuse * 1.04);
        sphere_color += proxy_palette(hue + 0.22) * rim * (0.32 + depth * 0.24);
        sphere_color += vec3<f32>(1.0, 0.94, 0.82) * spec * (0.48 + depth * 0.46);
        sphere_color *= 0.70 + (1.0 - lane) * 0.20;
        let sphere_alpha = clamp(tangent_softness * (0.78 + rim * 0.14), 0.0, 1.0);
        let depth_fade = exp(-max(hit.x, 0.0) * (0.19 + density * 0.06));
        volume_color += sphere_color * sphere_alpha * depth_fade * (0.026 + density * 0.020);
        volume_alpha += sphere_alpha * depth_fade * 0.024;
        if (hit.x < closest_t) {
          closest_t = hit.x;
          hit_color = sphere_color;
          hit_alpha = sphere_alpha;
        }
      }
    }
    let haze = fbm(source_uv * (2.0 + detail * 6.0) + vec2<f32>(local_t * 0.13, -local_t * 0.10));
    let bloom = smoothstep(0.0, 0.48 + density * 0.42, glow_energy);
    col = mix(col + glow + volume_color, hit_color + glow * 0.44 + volume_color * 0.70, hit_alpha);
    col += proxy_palette(style + 0.47) * haze * (0.07 + variation * 0.22);
    col += proxy_palette(style + 0.18) * bloom * (0.08 + detail * 0.16);
    alpha = clamp(0.20 + hit_alpha * 0.58 + bloom * 0.34 + glow_energy * 0.42 + volume_alpha + haze * 0.08, 0.0, 0.96);
  } else {
    let drift = vec2<f32>(local_t * 0.11 + seed * 0.01, -local_t * 0.085);
    let smoke = fbm(source_uv * (2.0 + density * 3.0) + drift)
      + 0.55 * fbm(source_uv * (4.5 + detail * 8.0) - drift.yx * (1.0 + variation))
      + 0.24 * fbm(source_uv * (8.0 + detail * 14.0) + drift * 2.1);
    let plume = smoothstep(0.28 - density * 0.20, 1.15, smoke) * (1.0 - smoothstep(0.55 + scale * 0.05, 1.25 + scale * 0.14, r));
    let ember = smoothstep(0.94 - detail * 0.18, 1.0, value_noise(source_uv * (18.0 + density * 28.0) + vec2<f32>(local_t * 1.8, seed)));
    col = mix(vec3<f32>(0.035, 0.055, 0.075), proxy_palette(style + 0.1) * 0.92, plume);
    col += proxy_palette(smoke * 0.18 + local_t * 0.04 + style) * ember * (0.2 + variation * 0.55);
    alpha = clamp(0.34 + plume * 0.52 + ember * 0.18, 0.0, 0.92);
  }

  col *= (0.35 + intensity * 0.75) * (1.0 + audio_drive * 0.72);
  col += proxy_palette(style + audio_treble * 0.18 + audio_beat * 0.08) * audio_drive * 0.14;
  alpha *= mix(0.38, 1.0, bg_alpha) * (1.0 + audio_beat * 0.18 + audio_kick * 0.12);
  return vec4<f32>(max(col, vec3<f32>(0.0)), alpha);
}

fn glow_line(p: vec2<f32>, origin: vec2<f32>, dir: vec2<f32>, width: f32) -> f32 {
  let d = normalize(dir);
  let local = p - origin;
  let along = dot(local, d);
  let lateral = length(local - d * along);
  let gate = smoothstep(-0.05, 0.2, along) * (1.0 - smoothstep(0.65, 1.05, along));
  return exp(-lateral * lateral / max(0.0001, width)) * gate;
}

fn tri_sign(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

fn point_in_triangle(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> bool {
  let d1 = tri_sign(p, a, b);
  let d2 = tri_sign(p, b, c);
  let d3 = tri_sign(p, c, a);
  let has_neg = (d1 < 0.0) || (d2 < 0.0) || (d3 < 0.0);
  let has_pos = (d1 > 0.0) || (d2 > 0.0) || (d3 > 0.0);
  return !(has_neg && has_pos);
}

fn point_in_quad(p: vec2<f32>, tl: vec2<f32>, tr: vec2<f32>, br: vec2<f32>, bl: vec2<f32>) -> bool {
  return point_in_triangle(p, tl, tr, br) || point_in_triangle(p, tl, br, bl);
}

fn barycentric(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> vec3<f32> {
  let v0 = b - a;
  let v1 = c - a;
  let v2 = p - a;
  let d00 = dot(v0, v0);
  let d01 = dot(v0, v1);
  let d11 = dot(v1, v1);
  let d20 = dot(v2, v0);
  let d21 = dot(v2, v1);
  let denom = max(d00 * d11 - d01 * d01, 0.000001);
  let v = (d11 * d20 - d01 * d21) / denom;
  let w = (d00 * d21 - d01 * d20) / denom;
  return vec3<f32>(1.0 - v - w, v, w);
}

fn barycentric_inside(b: vec3<f32>) -> bool {
  return b.x >= -0.0005 && b.y >= -0.0005 && b.z >= -0.0005;
}

fn quad_local_uv(p: vec2<f32>, tl: vec2<f32>, tr: vec2<f32>, br: vec2<f32>, bl: vec2<f32>) -> vec3<f32> {
  // Smooth inverse-bilinear mapping across the whole warped quad. The old
  // two-triangle barycentric split was affine per triangle, which sheared
  // content along the tl-br diagonal into a visible hard edge. The
  // triangle path remains as a fallback for concave handle layouts where
  // the bilinear inverse has no solution.
  let uvb = inverse_bilinear(p, tl, tr, br, bl);
  if (uvb.x >= -0.0005 && uvb.x <= 1.0005 && uvb.y >= -0.0005 && uvb.y <= 1.0005) {
    return vec3<f32>(1.0, clamp(uvb, vec2<f32>(0.0), vec2<f32>(1.0)));
  }
  let b0 = barycentric(p, tl, tr, br);
  if (barycentric_inside(b0)) {
    let uv = b0.x * vec2<f32>(0.0, 0.0) + b0.y * vec2<f32>(1.0, 0.0) + b0.z * vec2<f32>(1.0, 1.0);
    return vec3<f32>(1.0, uv);
  }
  let b1 = barycentric(p, tl, br, bl);
  if (barycentric_inside(b1)) {
    let uv = b1.x * vec2<f32>(0.0, 0.0) + b1.y * vec2<f32>(1.0, 1.0) + b1.z * vec2<f32>(0.0, 1.0);
    return vec3<f32>(1.0, uv);
  }
  return vec3<f32>(0.0, 0.0, 0.0);
}

fn cross2(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return a.x * b.y - a.y * b.x;
}

fn inverse_bilinear(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>) -> vec2<f32> {
  let e = b - a;
  let f = d - a;
  let g = a - b + c - d;
  let h = p - a;
  let k2 = cross2(g, f);
  let k1 = cross2(e, f) + cross2(h, g);
  let k0 = cross2(h, e);
  var u_coord = -1.0;
  var v_coord = -1.0;
  if (abs(k2) < 0.0001) {
    if (abs(k1) < 0.0001) { return vec2<f32>(-1.0); }
    v_coord = -k0 / k1;
  } else {
    let discriminant = k1 * k1 - 4.0 * k0 * k2;
    if (discriminant < 0.0) { return vec2<f32>(-1.0); }
    let root = sqrt(discriminant);
    let v0 = (-k1 - root) / (2.0 * k2);
    let v1 = (-k1 + root) / (2.0 * k2);
    v_coord = select(v1, v0, v0 >= 0.0 && v0 <= 1.0);
  }
  let denom_x = e.x + g.x * v_coord;
  let denom_y = e.y + g.y * v_coord;
  if (abs(denom_x) > 0.0001) {
    u_coord = (h.x - f.x * v_coord) / denom_x;
  } else if (abs(denom_y) > 0.0001) {
    u_coord = (h.y - f.y * v_coord) / denom_y;
  }
  return vec2<f32>(u_coord, v_coord);
}

fn layer_mesh_point(layer_index: u32, index: u32) -> vec2<f32> {
  let packed = layers[layer_index].mesh[index / 2u];
  return select(packed.zw, packed.xy, (index & 1u) == 0u);
}

fn layer_mesh_uv(local_uv: vec2<f32>, layer_index: u32) -> vec3<f32> {
  let rows = u32(clamp(floor(layers[layer_index].style.z + 0.5), 0.0, 16.0));
  let cols = u32(clamp(floor(layers[layer_index].style.w + 0.5), 0.0, 16.0));
  if (rows < 2u || cols < 2u) {
    return vec3<f32>(1.0, local_uv);
  }
  // Small grids are cheap enough to search exactly. Larger grids use the
  // regular-grid cell as a spatial index and inspect its immediate neighbors.
  // This keeps interactive 12x12 warps bounded to nine inverse solves instead
  // of 121 for every output pixel.
  let exact_search = rows <= 4u && cols <= 4u;
  let estimated_row = min(rows - 2u, u32(clamp(floor(local_uv.y * f32(rows - 1u)), 0.0, f32(rows - 2u))));
  let estimated_col = min(cols - 2u, u32(clamp(floor(local_uv.x * f32(cols - 1u)), 0.0, f32(cols - 2u))));
  for (var row = 0u; row < 15u; row = row + 1u) {
    if (row >= rows - 1u) { break; }
    if (!exact_search && (row + 1u < estimated_row || row > estimated_row + 1u)) { continue; }
    for (var col = 0u; col < 15u; col = col + 1u) {
      if (col >= cols - 1u) { break; }
      if (!exact_search && (col + 1u < estimated_col || col > estimated_col + 1u)) { continue; }
      let top_left = layer_mesh_point(layer_index, row * cols + col);
      let top_right = layer_mesh_point(layer_index, row * cols + col + 1u);
      let bottom_right = layer_mesh_point(layer_index, (row + 1u) * cols + col + 1u);
      let bottom_left = layer_mesh_point(layer_index, (row + 1u) * cols + col);
      let cell_uv = inverse_bilinear(local_uv, top_left, top_right, bottom_right, bottom_left);
      if (cell_uv.x >= 0.0 && cell_uv.x <= 1.0 && cell_uv.y >= 0.0 && cell_uv.y <= 1.0) {
        return vec3<f32>(
          1.0,
          (f32(col) + cell_uv.x) / f32(cols - 1u),
          (f32(row) + cell_uv.y) / f32(rows - 1u),
        );
      }
    }
  }
  return vec3<f32>(0.0, local_uv);
}

fn sample_source_preview_pixel(slot: i32, x: i32, y: i32) -> vec4<f32> {
  let safe_slot = clamp(slot, 0, MAX_SOURCE_PREVIEW_SLOTS - 1);
  let sx = clamp(x, 0, SOURCE_PREVIEW_SIZE - 1);
  let sy = clamp(y, 0, SOURCE_PREVIEW_SIZE - 1);
  let index = safe_slot * SOURCE_PREVIEW_PIXELS + sy * SOURCE_PREVIEW_SIZE + sx;
  return source_previews[u32(index)];
}

fn cubic_weight(x: f32) -> f32 {
  let a = -0.5;
  let ax = abs(x);
  let ax2 = ax * ax;
  let ax3 = ax2 * ax;
  if (ax <= 1.0) {
    return (a + 2.0) * ax3 - (a + 3.0) * ax2 + 1.0;
  }
  if (ax < 2.0) {
    return a * ax3 - 5.0 * a * ax2 + 8.0 * a * ax - 4.0 * a;
  }
  return 0.0;
}

fn sample_source_preview(slot_plus_one: f32, uv: vec2<f32>) -> vec4<f32> {
  let slot = clamp(i32(floor(slot_plus_one - 1.0)), 0, MAX_SOURCE_PREVIEW_SLOTS - 1);
  let coord = clamp(uv, vec2<f32>(0.0), vec2<f32>(0.9999)) * f32(SOURCE_PREVIEW_SIZE) - vec2<f32>(0.5);
  let base = floor(coord);
  let f = fract(coord);
  var sampled = vec4<f32>(0.0);
  var total = 0.0;
  for (var oy: i32 = -1; oy <= 2; oy = oy + 1) {
    let wy = cubic_weight(f.y - f32(oy));
    for (var ox: i32 = -1; ox <= 2; ox = ox + 1) {
      let wx = cubic_weight(f.x - f32(ox));
      let w = wx * wy;
      sampled += sample_source_preview_pixel(slot, i32(base.x) + ox, i32(base.y) + oy) * w;
      total += w;
    }
  }
  return sampled / max(total, 0.0001);
}

fn sample_source_frame_texel(slot: i32, x: i32, y: i32) -> vec4<f32> {
  let safe_slot = clamp(slot, 0, MAX_SOURCE_FRAME_SLOTS - 1);
  let dims = vec2<i32>(textureDimensions(source_frames, 0));
  let sx = clamp(x, 0, dims.x - 1);
  let sy = clamp(y, 0, dims.y - 1);
  return textureLoad(source_frames, vec2<i32>(sx, sy), safe_slot, 0);
}

fn sample_source_frame_linear(slot: i32, uv: vec2<f32>) -> vec4<f32> {
  let sample_uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  return textureSampleLevel(source_frames, source_frame_sampler, sample_uv, slot, 0.0);
}

fn sample_source_frame_live(slot: i32, uv: vec2<f32>) -> vec4<f32> {
  let sample_uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  // Streaming video replaces level zero every frame and deliberately skips
  // per-frame mip generation. Pin live media to the resident level so the
  // sampler can never select an untouched (black) mip.
  return textureSampleLevel(source_frames, source_frame_sampler, sample_uv, slot, 0.0);
}

fn sample_source_frame_minified(slot: i32, uv: vec2<f32>, footprint: f32) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(source_frames, 0));
  let texel = vec2<f32>(1.0) / max(dims, vec2<f32>(1.0));
  let radius = clamp(footprint * 0.42, 0.75, 3.25);
  let sample_uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let center = sample_source_frame_linear(slot, sample_uv);
  let axis_x = texel * vec2<f32>(radius, 0.0);
  let axis_y = texel * vec2<f32>(0.0, radius);
  let diag = texel * vec2<f32>(radius * 0.70710678);
  var sampled = center * 0.28;
  sampled += sample_source_frame_linear(slot, sample_uv + axis_x) * 0.11;
  sampled += sample_source_frame_linear(slot, sample_uv - axis_x) * 0.11;
  sampled += sample_source_frame_linear(slot, sample_uv + axis_y) * 0.11;
  sampled += sample_source_frame_linear(slot, sample_uv - axis_y) * 0.11;
  sampled += sample_source_frame_linear(slot, sample_uv + diag) * 0.07;
  sampled += sample_source_frame_linear(slot, sample_uv - diag) * 0.07;
  sampled += sample_source_frame_linear(slot, sample_uv + vec2<f32>(diag.x, -diag.y)) * 0.07;
  sampled += sample_source_frame_linear(slot, sample_uv + vec2<f32>(-diag.x, diag.y)) * 0.07;
  let blur_amount = smoothstep(1.25, 3.25, footprint);
  return mix(center, max(sampled, vec4<f32>(0.0)), blur_amount);
}

fn sample_source_frame(slot_code: f32, uv: vec2<f32>) -> vec4<f32> {
  let slot = clamp(i32(floor(slot_code - SOURCE_FRAME_SLOT_OFFSET - 1.0)), 0, MAX_SOURCE_FRAME_SLOTS - 1);
  let sample_uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  return sample_source_frame_linear(slot, sample_uv);
}

fn sample_source_content(slot_code: f32, uv: vec2<f32>, layer_index: u32) -> vec4<f32> {
  if (slot_code >= SOURCE_FRAME_SLOT_OFFSET) {
    let rect = layers[layer_index].source_rect;
    let slot = clamp(i32(floor(slot_code - SOURCE_FRAME_SLOT_OFFSET - 1.0)), 0, MAX_SOURCE_FRAME_SLOTS - 1);
    let sample_uv = rect.xy + uv * rect.zw;
    if (layers[layer_index].info.z > 2.5 && layers[layer_index].info.z < 3.5) {
      return sample_source_frame_live(slot, sample_uv);
    }
    return sample_source_frame(slot_code, sample_uv);
  }
  return sample_source_preview(slot_code, uv);
}

fn source_content_for_layer(sampled: vec4<f32>, source_kind: f32) -> vec4<f32> {
  if (source_kind >= 9.0 && sampled.a > 0.0001) {
    return vec4<f32>(sampled.rgb / sampled.a, sampled.a);
  }
  return sampled;
}

// Surface-space transform for warped shapes. MadMapper-model: the shape is a
// deformable surface — handles move the GEOMETRY, and both the mask and the
// content are evaluated in the surface's local space, so they deform as one.
fn native_shape_surface_uv(local_uv: vec2<f32>, layer_index: u32) -> vec2<f32> {
  let warp_kind = i32(floor(layers[layer_index].shape_meta.w + 0.5));
  if (warp_kind == 1) {
    let pts0 = layers[layer_index].shape_pts[0];
    let pts1 = layers[layer_index].shape_pts[1];
    let pts2 = layers[layer_index].shape_pts[2];
    var w = native_inverse_quad_warp(local_uv, pts0.xy, pts0.zw, pts1.xy, pts1.zw);
    let center_offset = pts2.xy - vec2<f32>(0.5);
    let center_weight = 1.0 - smoothstep(0.0, 0.5, length(w - vec2<f32>(0.5)));
    w = w - center_offset * center_weight * 0.6;
    return w;
  }
  return local_uv;
}

// Mean-value coordinates: content-follow for warped custom polygons. Maps a
// pixel inside the CURRENT (dragged) polygon back to the BASE outline the
// content was authored against, so the texture stretches smoothly with the
// dragged vertices (HeavyM-style).
fn native_custom_mvc_uv(p: vec2<f32>, layer_index: u32) -> vec2<f32> {
  let count = min(32, i32(floor(layers[layer_index].shape_meta.x + 0.5)));
  if (count < 3) {
    return p;
  }
  var tans: array<f32, 32>;
  var dists: array<f32, 32>;
  for (var i: i32 = 0; i < 32; i = i + 1) {
    if (i >= count) { break; }
    let packed_a = layers[layer_index].shape_pts[i / 2];
    let v_i = select(packed_a.zw, packed_a.xy, (i % 2) == 0);
    let next = (i + 1) % count;
    let packed_b = layers[layer_index].shape_pts[next / 2];
    let v_n = select(packed_b.zw, packed_b.xy, (next % 2) == 0);
    let e_i = v_i - p;
    let e_n = v_n - p;
    let d_i = length(e_i);
    dists[i] = d_i;
    if (d_i < 0.0005) {
      // On a vertex: return its base position directly.
      let base = layers[layer_index].shape_pts[16 + i / 2];
      return select(base.zw, base.xy, (i % 2) == 0);
    }
    let cross_z = e_i.x * e_n.y - e_i.y * e_n.x;
    let dot_v = dot(e_i, e_n);
    // tan(angle/2) = (|a||b| - a.b) / cross — signed by winding
    let denom = select(cross_z, sign(cross_z) * 0.000001, abs(cross_z) < 0.000001);
    tans[i] = (d_i * length(e_n) - dot_v) / denom;
  }
  var uv = vec2<f32>(0.0);
  var wsum = 0.0;
  for (var i: i32 = 0; i < 32; i = i + 1) {
    if (i >= count) { break; }
    let prev = (i + count - 1) % count;
    let w_i = (tans[prev] + tans[i]) / max(dists[i], 0.0005);
    let base = layers[layer_index].shape_pts[16 + i / 2];
    let b_i = select(base.zw, base.xy, (i % 2) == 0);
    uv = uv + b_i * w_i;
    wsum = wsum + w_i;
  }
  if (abs(wsum) < 0.000001) {
    return p;
  }
  return uv / wsum;
}

// Iterative inverse bilinear: find uv such that bilerp(quad, uv) = p.
fn native_inverse_quad_warp(p: vec2<f32>, tl: vec2<f32>, tr: vec2<f32>, bl: vec2<f32>, br: vec2<f32>) -> vec2<f32> {
  var uv = vec2<f32>(0.5, 0.5);
  for (var i = 0; i < 6; i = i + 1) {
    let top = mix(tl, tr, uv.x);
    let bottom = mix(bl, br, uv.x);
    let predicted = mix(top, bottom, uv.y);
    let error = p - predicted;
    let d_x = mix(tr - tl, br - bl, uv.y);
    let d_y = bottom - top;
    let det = d_x.x * d_y.y - d_x.y * d_y.x;
    if (abs(det) < 0.00001) { break; }
    uv = uv + vec2<f32>(
      (error.x * d_y.y - error.y * d_y.x) / det,
      (d_x.x * error.y - d_x.y * error.x) / det
    );
  }
  return uv;
}

fn native_barycentric(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> vec3<f32> {
  let v0 = b - a;
  let v1 = c - a;
  let v2 = p - a;
  let d00 = dot(v0, v0);
  let d01 = dot(v0, v1);
  let d11 = dot(v1, v1);
  let d20 = dot(v2, v0);
  let d21 = dot(v2, v1);
  let denom = d00 * d11 - d01 * d01;
  if (abs(denom) < 0.000001) {
    return vec3<f32>(1.0, 0.0, 0.0);
  }
  let v = (d11 * d20 - d01 * d21) / denom;
  let w = (d00 * d21 - d01 * d20) / denom;
  return vec3<f32>(1.0 - v - w, v, w);
}

fn layer_sample_uv(raw_uv: vec2<f32>, layer_index: u32) -> vec3<f32> {
  var sampled_uv = raw_uv;
  // Shape control-point warp (MadMapper-style). Kind 1: circle quad+center —
  // content is bilinearly warped through the 4 corner handles and pulled
  // toward the center handle. Kind 2: triangle — content is barycentrically
  // remapped so it stretches with the dragged vertices.
  let warp_kind = i32(floor(layers[layer_index].shape_meta.w + 0.5));
  let content_follow = layers[layer_index].shape_meta.z >= 0.5;
  if (warp_kind == 1 && content_follow) {
    sampled_uv = clamp(native_shape_surface_uv(raw_uv, layer_index), vec2<f32>(0.0), vec2<f32>(1.0));
  } else if (warp_kind == 3) {
    sampled_uv = clamp(native_custom_mvc_uv(raw_uv, layer_index), vec2<f32>(0.0), vec2<f32>(1.0));
  } else if (warp_kind == 2 && content_follow) {
    let pts0 = layers[layer_index].shape_pts[0];
    let pts1 = layers[layer_index].shape_pts[1];
    let bc = native_barycentric(raw_uv, pts0.xy, pts0.zw, pts1.xy);
    if (bc.x >= 0.0 && bc.y >= 0.0 && bc.z >= 0.0) {
      let d0 = vec2<f32>(0.5, 0.1);
      let d1 = vec2<f32>(0.1, 0.9);
      let d2 = vec2<f32>(0.9, 0.9);
      sampled_uv = clamp(d0 * bc.x + d1 * bc.y + d2 * bc.z, vec2<f32>(0.0), vec2<f32>(1.0));
    }
  }
  // Custom-shape content fit: 1 = warp (stretch content into the polygon's
  // bounding box), 2 = fill (aspect-preserving cover of the bbox). shape2
  // carries the polygon bbox [minX, minY, sizeX, sizeY] for custom shapes.
  if (layers[layer_index].shape.x >= 5.5 && warp_kind != 3) {
    let fit = i32(floor(layers[layer_index].shape_meta.z + 0.5));
    if (fit >= 1) {
      let bb_min = layers[layer_index].shape2.xy;
      let bb_size = max(layers[layer_index].shape2.zw, vec2<f32>(0.0001));
      var fitted = (sampled_uv - bb_min) / bb_size;
      if (fit == 2) {
        let bb_aspect = bb_size.x / bb_size.y;
        if (bb_aspect > 1.0) {
          fitted.y = (fitted.y - 0.5) / bb_aspect + 0.5;
        } else {
          fitted.x = (fitted.x - 0.5) * bb_aspect + 0.5;
        }
      }
      sampled_uv = clamp(fitted, vec2<f32>(0.0), vec2<f32>(1.0));
    }
  }
  if (layers[layer_index].uv1.z > 0.5) {
    sampled_uv.x = 1.0 - sampled_uv.x;
  }
  if (layers[layer_index].uv1.w > 0.5) {
    sampled_uv.y = 1.0 - sampled_uv.y;
  }

  var content_mask = 1.0;
  let fit_mode = i32(floor(layers[layer_index].uv1.x + 0.5));
  let ratio = max(layers[layer_index].uv1.y, 0.0001);
  if (fit_mode == 1) {
    if (ratio > 1.0) {
      sampled_uv.x = (sampled_uv.x - 0.5) / ratio + 0.5;
    } else {
      sampled_uv.y = (sampled_uv.y - 0.5) * ratio + 0.5;
    }
  } else if (fit_mode == 2) {
    if (ratio > 1.0) {
      sampled_uv.y = (sampled_uv.y - 0.5) * ratio + 0.5;
    } else {
      sampled_uv.x = (sampled_uv.x - 0.5) / ratio + 0.5;
    }
    let in_bounds = sampled_uv.x >= 0.0 && sampled_uv.x <= 1.0 && sampled_uv.y >= 0.0 && sampled_uv.y <= 1.0;
    content_mask = select(0.0, 1.0, in_bounds);
  }

  sampled_uv = layers[layer_index].uv0.xy + sampled_uv * layers[layer_index].uv0.zw;
  return vec3<f32>(sampled_uv, content_mask);
}

fn hue_rotate(c: vec3<f32>, turns: f32) -> vec3<f32> {
  let angle = turns * 6.2831853;
  let co = cos(angle);
  let si = sin(angle);
  return vec3<f32>(
    dot(c, vec3<f32>(0.299 + 0.701 * co + 0.168 * si, 0.587 - 0.587 * co + 0.330 * si, 0.114 - 0.114 * co - 0.497 * si)),
    dot(c, vec3<f32>(0.299 - 0.299 * co - 0.328 * si, 0.587 + 0.413 * co + 0.035 * si, 0.114 - 0.114 * co + 0.292 * si)),
    dot(c, vec3<f32>(0.299 - 0.300 * co + 1.250 * si, 0.587 - 0.588 * co - 1.050 * si, 0.114 + 0.886 * co - 0.203 * si))
  );
}

fn apply_native_effect(color_in: vec3<f32>, effect: vec4<f32>, uv: vec2<f32>, t: f32) -> vec3<f32> {
  let op = i32(floor(effect.x + 0.5));
  let amount = effect.y;
  let color = max(color_in, vec3<f32>(0.0));
  let luma = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  if (op == 1) {
    return mix(color, vec3<f32>(1.0) - color, clamp(amount, 0.0, 1.0));
  }
  if (op == 2) {
    return mix(color, vec3<f32>(luma), clamp(amount, 0.0, 1.0));
  }
  if (op == 3) {
    return color * max(0.0, amount);
  }
  if (op == 4) {
    return (color - vec3<f32>(0.5)) * max(0.0, amount) + vec3<f32>(0.5);
  }
  if (op == 5) {
    return pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / max(0.05, amount)));
  }
  if (op == 6) {
    return mix(vec3<f32>(luma), color, max(0.0, amount));
  }
  if (op == 7) {
    return hue_rotate(color, amount);
  }
  if (op == 8) {
    let levels = max(2.0, floor(amount + 0.5));
    return floor(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)) * levels + vec3<f32>(0.5)) / levels;
  }
  if (op == 9) {
    let grain_uv = uv * u.resolution.xy * 0.42 + vec2<f32>(t * 19.0, u.frame_count * 0.37);
    let n = value_noise(grain_uv) - 0.5;
    return color + vec3<f32>(n * clamp(amount, 0.0, 1.0) * 0.72);
  }
  return color;
}

fn apply_native_effects(color: vec3<f32>, layer_index: u32, uv: vec2<f32>, t: f32) -> vec3<f32> {
  let count = i32(floor(layers[layer_index].style.y + 0.5));
  var out = color;
  if (count > 0) { out = apply_native_effect(out, layers[layer_index].effect0, uv, t); }
  if (count > 1) { out = apply_native_effect(out, layers[layer_index].effect1, uv, t); }
  if (count > 2) { out = apply_native_effect(out, layers[layer_index].effect2, uv, t); }
  if (count > 3) { out = apply_native_effect(out, layers[layer_index].effect3, uv, t); }
  return out;
}

/// Composite-stage chain: runs after every layer has blended, mirroring the
/// WebGL engine's order (composition effects, then macro bundles). Each entry
/// mixes its result back by `mix` so a macro knob at 0.5 reads as half-wet,
/// exactly like the engine's bundle mix.
fn apply_composite_effects(color_in: vec3<f32>, uv: vec2<f32>, t: f32) -> vec3<f32> {
  let count = i32(floor(u.post_count + 0.5));
  var out = color_in;
  for (var i = 0; i < count; i = i + 1) {
    let descriptor = u.post[i];
    let wet = apply_native_effect(out, descriptor, uv, t);
    out = mix(out, wet, clamp(descriptor.w, 0.0, 1.0));
  }
  return out;
}

const WARP_MESH_MAX_DIM: u32 = 16u;

fn swarp_mesh_point(index: u32) -> vec2<f32> {
  let slot = min(index / 2u, 127u);
  let packed = u.swarp_mesh[slot];
  return select(packed.zw, packed.xy, (index & 1u) == 0u);
}

fn mwarp_mesh_point(index: u32) -> vec2<f32> {
  let slot = min(index / 2u, 127u);
  let packed = u.mwarp_mesh[slot];
  return select(packed.zw, packed.xy, (index & 1u) == 0u);
}

/// Solve for the (u, v) inside a quad that maps to `p`. Returns values
/// outside 0..1 when `p` lies outside the quad, which callers use as the
/// containment test. Same solver the layer mesh warp uses.
fn warp_inverse_bilinear(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>) -> vec2<f32> {
  return inverse_bilinear(p, a, b, c, d);
}

/// Per-slice screen warp: projector UV -> master-canvas sample position.
/// Corners and mesh control points are already sample positions, so this is
/// a direct forward interpolation with no solve.
fn slice_warp_uv(uv: vec2<f32>) -> vec2<f32> {
  let mode = i32(floor(u.swarp.x + 0.5));
  if (mode == 1) {
    let top = mix(u.swarp_c0.xy, u.swarp_c0.zw, uv.x);
    let bottom = mix(u.swarp_c1.zw, u.swarp_c1.xy, uv.x);
    return mix(top, bottom, uv.y);
  }
  if (mode == 2) {
    let rows = u32(clamp(u.swarp.y, 2.0, f32(WARP_MESH_MAX_DIM)));
    let cols = u32(clamp(u.swarp.z, 2.0, f32(WARP_MESH_MAX_DIM)));
    let fx = uv.x * f32(cols - 1u);
    let fy = uv.y * f32(rows - 1u);
    let ci = u32(clamp(floor(fx), 0.0, f32(cols - 2u)));
    let ri = u32(clamp(floor(fy), 0.0, f32(rows - 2u)));
    let su = clamp(fx - f32(ci), 0.0, 1.0);
    let sv = clamp(fy - f32(ri), 0.0, 1.0);
    let p00 = swarp_mesh_point(ri * cols + ci);
    let p10 = swarp_mesh_point(ri * cols + ci + 1u);
    let p01 = swarp_mesh_point((ri + 1u) * cols + ci);
    let p11 = swarp_mesh_point((ri + 1u) * cols + ci + 1u);
    return mix(mix(p00, p10, su), mix(p01, p11, su), sv);
  }
  // Rect: the plain axis-aligned crop.
  return u.out0.xy + uv * u.out0.zw;
}

/// Master warp: FORWARD / destination semantics — the corners say where the
/// content lands on the output, so sampling has to invert them. Returns the
/// source UV in xy and 0 in z for pixels outside the warped quad, which the
/// caller paints black (pulling a corner in crops, like layer map mode).
fn master_warp_uv(uv: vec2<f32>) -> vec3<f32> {
  if (u.mwarp.x < 0.5) {
    return vec3<f32>(uv, 1.0);
  }
  let q = warp_inverse_bilinear(uv, u.mwarp_c0.xy, u.mwarp_c0.zw, u.mwarp_c1.xy, u.mwarp_c1.zw);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
    return vec3<f32>(uv, 0.0);
  }
  let rows = u32(clamp(u.mwarp.y, 0.0, f32(WARP_MESH_MAX_DIM)));
  let cols = u32(clamp(u.mwarp.z, 0.0, f32(WARP_MESH_MAX_DIM)));
  if (rows < 2u || cols < 2u) {
    return vec3<f32>(q, 1.0);
  }
  // The mesh deforms within the corner-pinned quad, so its cells have to be
  // searched: unlike the slice mesh, the control points are destinations.
  // The regular grid cell is a good first guess; neighbours cover the rest.
  let est_row = min(rows - 2u, u32(clamp(floor(q.y * f32(rows - 1u)), 0.0, f32(rows - 2u))));
  let est_col = min(cols - 2u, u32(clamp(floor(q.x * f32(cols - 1u)), 0.0, f32(cols - 2u))));
  for (var row = 0u; row < WARP_MESH_MAX_DIM - 1u; row = row + 1u) {
    if (row >= rows - 1u) { break; }
    if (row + 1u < est_row || row > est_row + 1u) { continue; }
    for (var col = 0u; col < WARP_MESH_MAX_DIM - 1u; col = col + 1u) {
      if (col >= cols - 1u) { break; }
      if (col + 1u < est_col || col > est_col + 1u) { continue; }
      let a = mwarp_mesh_point(row * cols + col);
      let b = mwarp_mesh_point(row * cols + col + 1u);
      let c = mwarp_mesh_point((row + 1u) * cols + col + 1u);
      let d = mwarp_mesh_point((row + 1u) * cols + col);
      let t = warp_inverse_bilinear(q, a, b, c, d);
      if (t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0) {
        return vec3<f32>(
          (f32(col) + t.x) / f32(cols - 1u),
          (f32(row) + t.y) / f32(rows - 1u),
          1.0,
        );
      }
    }
  }
  return vec3<f32>(q, 0.0);
}

/// Output rotation, in quarter turns, matching opaqueOutputFragmentShader.
fn output_rotate_uv(uv: vec2<f32>) -> vec2<f32> {
  let index = i32(floor(u.out1.x + 0.5));
  if (index == 1) { return vec2<f32>(uv.y, 1.0 - uv.x); }
  if (index == 2) { return vec2<f32>(1.0 - uv.x, 1.0 - uv.y); }
  if (index == 3) { return vec2<f32>(1.0 - uv.y, uv.x); }
  return uv;
}

/// Screen UV -> composition UV: rotation then crop. The compositor has no
/// intermediate texture to resample, so the output transform runs as an
/// inverse map on the sampling coordinate instead of a blit — which also
/// means cropping costs no resolution.
fn output_source_uv(uv: vec2<f32>) -> vec3<f32> {
  // Rotation first, so "left"/"top" always mean the projector's physical
  // edges regardless of how the screen is mounted, then the screen warp
  // (or plain crop), then the master warp underneath it.
  let rotated = output_rotate_uv(uv);
  let warped = slice_warp_uv(rotated);
  return master_warp_uv(warped);
}

fn output_color_grade(color_in: vec3<f32>) -> vec3<f32> {
  var out = color_in * max(u.out1.y, 0.0);
  out = (out - vec3<f32>(0.5)) * max(u.out1.z, 0.0) + vec3<f32>(0.5);
  return pow(max(out, vec3<f32>(0.0)), vec3<f32>(max(u.out1.w, 0.001)));
}

/// Projector soft-edge ramp. The 2D overlay painted a black gradient with
/// alpha `1 - t^(1/gamma)` over each blend band, so the surviving image
/// multiplier is `t^(1/gamma)` where t runs 0 at the panel edge to 1 at the
/// inner boundary. UV here is y-up, so the top band is measured from 1.
fn edge_blend_alpha(uv: vec2<f32>) -> f32 {
  let inv_gamma = 1.0 / max(u.dome2.y, 0.05);
  var alpha = 1.0;
  if (u.edge.x > 0.0001) {
    alpha = alpha * pow(clamp(uv.x / u.edge.x, 0.0, 1.0), inv_gamma);
  }
  if (u.edge.y > 0.0001) {
    alpha = alpha * pow(clamp((1.0 - uv.x) / u.edge.y, 0.0, 1.0), inv_gamma);
  }
  if (u.edge.z > 0.0001) {
    alpha = alpha * pow(clamp((1.0 - uv.y) / u.edge.z, 0.0, 1.0), inv_gamma);
  }
  if (u.edge.w > 0.0001) {
    alpha = alpha * pow(clamp(uv.y / u.edge.w, 0.0, 1.0), inv_gamma);
  }
  return alpha;
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow(max(c + vec3<f32>(0.055), vec3<f32>(0.0)) / 1.055, vec3<f32>(2.4));
  return select(lo, hi, c >= vec3<f32>(0.04045));
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(lo, hi, c >= vec3<f32>(0.0031308));
}

/// Paul Bourke's piecewise soft-edge curve — the one blendRenderer uses for
/// projector overlaps. A plain power ramp leaves a visible seam at the
/// midpoint; this is symmetric about 0.5 so two overlapping projectors sum
/// to unity.
fn blend_curve(x: f32, p: f32) -> f32 {
  if (x < 0.5) {
    return 0.5 * pow(2.0 * x, p);
  }
  return 1.0 - 0.5 * pow(2.0 * (1.0 - x), p);
}

/// Per-slice edge-blend alpha, with an independent gamma per edge.
fn slice_blend_alpha(uv: vec2<f32>) -> f32 {
  var alpha = 1.0;
  if (u.edge.x > 0.0) {
    alpha = alpha * blend_curve(clamp(uv.x / u.edge.x, 0.0, 1.0), u.edge_gamma.x);
  }
  if (u.edge.y > 0.0) {
    alpha = alpha * blend_curve(clamp((1.0 - uv.x) / u.edge.y, 0.0, 1.0), u.edge_gamma.y);
  }
  if (u.edge.z > 0.0) {
    alpha = alpha * blend_curve(clamp((1.0 - uv.y) / u.edge.z, 0.0, 1.0), u.edge_gamma.z);
  }
  if (u.edge.w > 0.0) {
    alpha = alpha * blend_curve(clamp(uv.y / u.edge.w, 0.0, 1.0), u.edge_gamma.w);
  }
  return alpha;
}

/// Multi-projector grade for a slice display. Mirrors blendRenderer's
/// fragment shader so a native slice and a sender slice of the same screen
/// match: linear-light grade, inverse gamma, blend curve, then a black-level
/// lift that feathers across the overlap so non-overlap regions match the
/// projector's real black floor.
fn slice_output_grade(color_in: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
  var col = srgb_to_linear(clamp(color_in, vec3<f32>(0.0), vec3<f32>(1.0)));
  col = col * max(u.out1.y, 0.0);
  col = (col - vec3<f32>(0.5)) * max(u.out1.z, 0.0) + vec3<f32>(0.5);
  col = pow(max(col, vec3<f32>(0.0)), vec3<f32>(1.0 / max(u.out1.w, 0.001)));

  let alpha = slice_blend_alpha(uv);
  let lift_mix = mix(alpha, smoothstep(0.0, 1.0, alpha), clamp(u.black_level.w, 0.0, 1.0));
  col = col + u.black_level.rgb * lift_mix;
  col = col * alpha;
  return linear_to_srgb(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)));
}

/// Dome / fisheye reprojection, ported from shaders/dome.ts. Returns the
/// composition UV to sample in `xy` and the dome mask (edge falloff and the
/// circle cutoff) in `z`.
fn dome_source_uv(uv_in: vec2<f32>, aspect: f32) -> vec3<f32> {
  let mode = i32(floor(u.dome0.y + 0.5));
  let half_fov = u.dome0.z * 0.5;
  let truncation = u.dome2.x;

  var uv = (uv_in - vec2<f32>(0.5)) * 2.0;
  // Dome content is circular in a square frame, so undo the aspect.
  if (aspect > 1.0) { uv.x = uv.x * aspect; } else { uv.y = uv.y / aspect; }
  uv = uv - u.dome1.yz;
  let rot_c = cos(u.dome0.w);
  let rot_s = sin(u.dome0.w);
  uv = vec2<f32>(uv.x * rot_c - uv.y * rot_s, uv.x * rot_s + uv.y * rot_c);

  let r = length(uv);
  if (r > truncation) {
    return vec3<f32>(uv_in, 0.0);
  }

  if (mode == 3) {
    // Equirectangular: longitude/latitude straight onto the frame.
    let tex_uv = clamp(uv * vec2<f32>(0.5) + vec2<f32>(0.5), vec2<f32>(0.0), vec2<f32>(1.0));
    return vec3<f32>(tex_uv, 1.0);
  }

  var theta = r * half_fov;
  if (mode == 1) {
    theta = 2.0 * atan(r * tan(half_fov * 0.5));
  } else if (mode == 2) {
    theta = asin(min(r, 1.0)) * half_fov / (3.14159265359 * 0.5);
  }
  let phi = atan2(uv.y, uv.x);

  var dir = vec3<f32>(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
  let tilt_c = cos(u.dome1.x);
  let tilt_s = sin(u.dome1.x);
  dir = vec3<f32>(dir.x, dir.y * tilt_c - dir.z * tilt_s, dir.y * tilt_s + dir.z * tilt_c);

  let z = max(dir.z, 0.001);
  var tex_uv = vec2<f32>(dir.x / z * 0.5 + 0.5, dir.y / z * 0.5 + 0.5);
  tex_uv = mix(uv_in, tex_uv, u.dome1.w);
  tex_uv = clamp(tex_uv, vec2<f32>(0.0), vec2<f32>(1.0));

  let edge_fade = smoothstep(truncation, truncation - 0.05, r);
  return vec3<f32>(tex_uv, edge_fade);
}

fn rgb_to_hsv(c: vec3<f32>) -> vec3<f32> {
  let k = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4<f32>(c.bg, k.wz), vec4<f32>(c.gb, k.xy), c.g >= c.b);
  let q = select(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), c.r >= p.x);
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
  let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn native_blend(dst_in: vec3<f32>, src_in: vec3<f32>, alpha: f32, mode: f32) -> vec3<f32> {
  let dst = clamp(dst_in, vec3<f32>(0.0), vec3<f32>(1.5));
  let src = clamp(src_in, vec3<f32>(0.0), vec3<f32>(1.5));
  let m = i32(floor(mode + 0.5));
  var blended = src;
  if (m == 1) {
    blended = clamp(dst + src, vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 2) {
    blended = dst * src;
  } else if (m == 3) {
    blended = vec3<f32>(1.0) - (vec3<f32>(1.0) - dst) * (vec3<f32>(1.0) - src);
  } else if (m == 4) {
    blended = select(2.0 * dst * src, vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - dst) * (vec3<f32>(1.0) - src), dst > vec3<f32>(0.5));
  } else if (m == 5) {
    blended = max(dst - src, vec3<f32>(0.0));
  } else if (m == 6) {
    blended = abs(dst - src);
  } else if (m == 7) {
    blended = max(dst, src);
  } else if (m == 8) {
    blended = min(dst, src);
  } else if (m == 9) {
    blended = (dst + src) * 0.5;
  } else if (m == 10) {
    blended = select(2.0 * dst * src, vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - dst) * (vec3<f32>(1.0) - src), src > vec3<f32>(0.5));
  } else if (m == 11) {
    blended = (vec3<f32>(1.0) - 2.0 * src) * dst * dst + 2.0 * src * dst;
  } else if (m == 12) {
    blended = dst + src - 2.0 * dst * src;
  } else if (m == 13) {
    blended = clamp(dst / max(vec3<f32>(1.0) - src, vec3<f32>(0.001)), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 14) {
    blended = clamp(vec3<f32>(1.0) - ((vec3<f32>(1.0) - dst) / max(src, vec3<f32>(0.001))), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 15) {
    let dh = rgb_to_hsv(clamp(dst, vec3<f32>(0.0), vec3<f32>(1.0)));
    let sh = rgb_to_hsv(clamp(src, vec3<f32>(0.0), vec3<f32>(1.0)));
    blended = hsv_to_rgb(vec3<f32>(sh.x, dh.y, dh.z));
  } else if (m == 16) {
    let dh = rgb_to_hsv(clamp(dst, vec3<f32>(0.0), vec3<f32>(1.0)));
    let sh = rgb_to_hsv(clamp(src, vec3<f32>(0.0), vec3<f32>(1.0)));
    blended = hsv_to_rgb(vec3<f32>(dh.x, sh.y, dh.z));
  } else if (m == 17) {
    let dh = rgb_to_hsv(clamp(dst, vec3<f32>(0.0), vec3<f32>(1.0)));
    let sh = rgb_to_hsv(clamp(src, vec3<f32>(0.0), vec3<f32>(1.0)));
    blended = hsv_to_rgb(vec3<f32>(sh.x, sh.y, dh.z));
  } else if (m == 18) {
    let dh = rgb_to_hsv(clamp(dst, vec3<f32>(0.0), vec3<f32>(1.0)));
    let sh = rgb_to_hsv(clamp(src, vec3<f32>(0.0), vec3<f32>(1.0)));
    blended = hsv_to_rgb(vec3<f32>(dh.x, dh.y, sh.z));
  } else if (m == 19) {
    blended = clamp(dst / max(src, vec3<f32>(0.001)), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 20) {
    blended = clamp(vec3<f32>(1.0) - abs(vec3<f32>(1.0) - dst - src), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 21) {
    blended = clamp(min(dst, src) - max(dst, src) + vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 22) {
    blended = clamp(dst + 2.0 * src - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 23) {
    let linear_light = clamp(dst + 2.0 * src - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
    blended = step(vec3<f32>(0.5), linear_light);
  } else if (m == 24) {
    let burn = vec3<f32>(1.0) - ((vec3<f32>(1.0) - dst) / max(2.0 * src, vec3<f32>(0.001)));
    let dodge = dst / max(2.0 * (vec3<f32>(1.0) - src), vec3<f32>(0.001));
    blended = clamp(select(burn, dodge, src >= vec3<f32>(0.5)), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 25) {
    let low = min(dst, 2.0 * src);
    let high = max(dst, 2.0 * src - vec3<f32>(1.0));
    blended = clamp(select(low, high, src >= vec3<f32>(0.5)), vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return mix(dst_in, blended, clamp(alpha, 0.0, 1.0));
}

fn segment_distance(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let ba = b - a;
  let h = clamp(dot(p - a, ba) / max(dot(ba, ba), 0.000001), 0.0, 1.0);
  return length((p - a) - ba * h);
}

fn quad_edge_distance(p: vec2<f32>, tl: vec2<f32>, tr: vec2<f32>, br: vec2<f32>, bl: vec2<f32>) -> f32 {
  return min(
    min(segment_distance(p, tl, tr), segment_distance(p, tr, br)),
    min(segment_distance(p, br, bl), segment_distance(p, bl, tl))
  );
}

fn rotate2d(p: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn triangle_signed_distance(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> f32 {
  let edge_dist = min(min(segment_distance(p, a, b), segment_distance(p, b, c)), segment_distance(p, c, a));
  return select(edge_dist, -edge_dist, point_in_triangle(p, a, b, c));
}

fn native_regular_polygon_distance(p: vec2<f32>, r: f32, n: f32) -> f32 {
  let an = 3.14159265359 / max(n, 3.0);
  let a = atan2(p.y, p.x);
  let bn = (a - floor(a / (2.0 * an)) * (2.0 * an)) - an;
  let q = length(p) * vec2<f32>(cos(bn), abs(sin(bn)));
  return q.x - r;
}

fn native_star_distance(p0: vec2<f32>, r: f32, inner_r: f32, n: f32) -> f32 {
  let an = 3.14159265359 / max(n, 3.0);
  let en = 3.14159265359 / (max(n, 3.0) * 2.0);
  let acs = vec2<f32>(cos(an), sin(an));
  let ecs = vec2<f32>(cos(en), sin(en));
  let a = atan2(p0.y, p0.x);
  let bn = (a - floor(a / (2.0 * an)) * (2.0 * an)) - an;
  var p = length(p0) * vec2<f32>(cos(bn), abs(sin(bn)));
  p = p - r * acs;
  p = p + ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

fn native_ellipse_distance(p: vec2<f32>, r: vec2<f32>) -> f32 {
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return select(k0 * (k0 - 1.0) / max(k1, 0.0001), length(p) - min(r.x, r.y), k1 < 0.0001);
}

// Signed distance to the custom shape polygon (points packed 2 per vec4 in
// shape_pts, already in compositor local-UV space with y down).
fn native_custom_shape_distance(local_uv: vec2<f32>, layer_index: u32) -> f32 {
  let count = min(32, i32(floor(layers[layer_index].shape_meta.x + 0.5)));
  if (count < 3) {
    return -1.0;
  }
  var crossings = 0;
  var min_edge = 1000.0;
  for (var i: i32 = 0; i < 32; i = i + 1) {
    if (i >= count) { break; }
    let packed_a = layers[layer_index].shape_pts[i / 2];
    let a = select(packed_a.zw, packed_a.xy, (i % 2) == 0);
    let next = (i + 1) % count;
    let packed_b = layers[layer_index].shape_pts[next / 2];
    let b = select(packed_b.zw, packed_b.xy, (next % 2) == 0);
    let crosses = ((a.y <= local_uv.y && b.y > local_uv.y) || (a.y > local_uv.y && b.y <= local_uv.y)) &&
      (local_uv.x < (b.x - a.x) * (local_uv.y - a.y) / max(abs(b.y - a.y), 0.000001) * sign(b.y - a.y) + a.x);
    if (crosses) { crossings = crossings + 1; }
    min_edge = min(min_edge, segment_distance(local_uv, a, b));
  }
  return select(min_edge, -min_edge, (crossings % 2) == 1);
}

fn native_warp_quad_signed_distance(p: vec2<f32>, layer_index: u32) -> f32 {
  let pts0 = layers[layer_index].shape_pts[0];
  let pts1 = layers[layer_index].shape_pts[1];
  // Quad outline in draw order: tl -> tr -> br -> bl.
  var quad: array<vec2<f32>, 4>;
  quad[0] = pts0.xy;
  quad[1] = pts0.zw;
  quad[2] = pts1.zw;
  quad[3] = pts1.xy;
  var crossings = 0;
  var min_edge = 1000.0;
  for (var i = 0; i < 4; i = i + 1) {
    let a = quad[i];
    let b = quad[(i + 1) % 4];
    let crosses = ((a.y <= p.y && b.y > p.y) || (a.y > p.y && b.y <= p.y)) &&
      (p.x < (b.x - a.x) * (p.y - a.y) / max(abs(b.y - a.y), 0.000001) * sign(b.y - a.y) + a.x);
    if (crosses) { crossings = crossings + 1; }
    min_edge = min(min_edge, segment_distance(p, a, b));
  }
  return select(min_edge, -min_edge, (crossings % 2) == 1);
}

fn native_shape_signed_distance(local_uv: vec2<f32>, layer_index: u32) -> f32 {
  let shape_type = i32(floor(layers[layer_index].shape.x + 0.5));
  if (shape_type == 6) {
    return native_custom_shape_distance(local_uv, layer_index);
  }
  // Warped shapes: the SDF is evaluated in surface space so the mask deforms
  // together with the content (the shape is a surface, not a crop window).
  // The inverse-bilinear solver diverges far outside the quad and can fold
  // back into "inside" values — clip against the quad polygon itself so
  // nothing ever renders beyond the dragged surface.
  var quad_clip = -1.0;
  if (i32(floor(layers[layer_index].shape_meta.w + 0.5)) == 1) {
    quad_clip = native_warp_quad_signed_distance(local_uv, layer_index);
    if (quad_clip > 0.05) {
      return quad_clip;
    }
  }
  let eval_uv = native_shape_surface_uv(local_uv, layer_index);
  let rotation = layers[layer_index].shape.z;
  let scale = max(layers[layer_index].shape.w, 0.0001);
  let extra = layers[layer_index].shape2;
  var centered = rotate2d((eval_uv - vec2<f32>(0.5)) / scale, -rotation);
  // Compositor local UV runs y-down; the WebGL shape shader (the visual
  // reference) runs y-up. Mirror so orientation matches the editor overlay.
  centered.y = -centered.y;
  if (shape_type == 1) {
    return max(length(centered) - max(extra.x, 0.01) * 0.5, quad_clip);
  }
  if (shape_type == 2) {
    if (layers[layer_index].shape_meta.w > 1.5) {
      // Warped triangle: control points are absolute layer-local vertices.
      let pts0 = layers[layer_index].shape_pts[0];
      let pts1 = layers[layer_index].shape_pts[1];
      return triangle_signed_distance(local_uv, pts0.xy, pts0.zw, pts1.xy);
    }
    return triangle_signed_distance(centered + vec2<f32>(0.5), vec2<f32>(0.5, 0.88), vec2<f32>(0.14, 0.14), vec2<f32>(0.86, 0.14));
  }
  if (shape_type == 3) {
    return max(native_ellipse_distance(centered, vec2<f32>(max(extra.x, 0.01), max(extra.y, 0.01)) * 0.5), quad_clip);
  }
  if (shape_type == 4) {
    return max(native_regular_polygon_distance(centered, 0.4, extra.z), quad_clip);
  }
  if (shape_type == 5) {
    return max(native_star_distance(centered, 0.4, max(extra.w, 0.05) * 0.4, extra.z), quad_clip);
  }
  let q = abs(centered) - vec2<f32>(0.5);
  return max(length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0), quad_clip);
}

fn native_layer_shape(local_uv: vec2<f32>, layer_index: u32) -> vec2<f32> {
  let feather = max(layers[layer_index].shape.y, 0.0);
  let dist = native_shape_signed_distance(local_uv, layer_index);
  // ~1px anti-aliasing floor so unfeathered shapes still get clean edges.
  let aa = 1.5 / max(min(u.resolution.x, u.resolution.y), 64.0);
  var mask = select(
    1.0 - smoothstep(-aa, aa, dist),
    1.0 - smoothstep(-feather, 0.0, dist),
    feather > 0.001
  );
  if (layers[layer_index].shape_meta.y > 0.5) {
    mask = 1.0 - mask;
  }
  let edge_width = max(0.0065, feather * 0.42 + 0.0065);
  let edge = 1.0 - smoothstep(0.0015, edge_width, abs(dist));
  return vec2<f32>(clamp(mask, 0.0, 1.0), clamp(edge, 0.0, 1.0));
}

fn native_edge_path_phase(uv: vec2<f32>, layer_index: u32) -> f32 {
  let shape_type = i32(floor(layers[layer_index].shape.x + 0.5));
  if (shape_type == 0) {
    let d = vec4<f32>(uv.y, 1.0 - uv.x, 1.0 - uv.y, uv.x);
    let side = min(min(d.x, d.y), min(d.z, d.w));
    if (side == d.x) { return uv.x * 0.25; }
    if (side == d.y) { return 0.25 + uv.y * 0.25; }
    if (side == d.z) { return 0.75 - uv.x * 0.25; }
    return 1.0 - uv.y * 0.25;
  }
  let p = uv - vec2<f32>(0.5);
  return fract(atan2(p.y, p.x) / 6.28318530718 + 1.0);
}

fn native_edge_palette(t: f32) -> vec3<f32> {
  return 0.55 + 0.45 * cos(6.28318530718 * (t + vec3<f32>(0.0, 0.33, 0.67)));
}

fn native_edge_fill_color(
  fill_code: i32,
  uv: vec2<f32>,
  color0: vec4<f32>,
  color1: vec4<f32>,
  params: vec4<f32>,
  t: f32,
) -> vec4<f32> {
  if (fill_code == 1) {
    return vec4<f32>(color0.rgb, color0.a * clamp(params.y, 0.0, 1.0));
  }
  let scale = max(0.1, abs(params.y));
  let speed = params.w;
  let n = fbm(uv * scale + vec2<f32>(t * speed * 0.16, -t * speed * 0.12));
  if (fill_code == 2) {
    let wave = sin((uv.x + uv.y + n * 0.8) * scale * 3.0 + t * speed * 1.8);
    return vec4<f32>(native_edge_palette(wave * 0.12 + t * 0.04), 0.72);
  }
  if (fill_code == 3) {
    let liquid = smoothstep(0.18, 0.88, n + 0.18 * sin(uv.y * 9.0 + t * speed));
    return vec4<f32>(mix(color0.rgb * 0.32, color0.rgb * 1.35, liquid), color0.a * 0.78);
  }
  if (fill_code == 4) {
    let flame = smoothstep(0.24, 0.9, n + (1.0 - uv.y) * 0.42);
    return vec4<f32>(mix(vec3<f32>(0.45, 0.015, 0.0), vec3<f32>(1.0, 0.72, 0.08), flame), flame * 0.9);
  }
  if (fill_code == 5) {
    let arcs = pow(abs(sin((uv.x - uv.y + n * 0.22) * max(2.0, params.z) * 6.283 + t * speed * 2.0)), 18.0);
    return vec4<f32>(color0.rgb * (0.22 + arcs * 2.2), color0.a * (0.25 + arcs * 0.75));
  }
  if (fill_code == 6) {
    let holo = native_edge_palette(uv.x * 0.7 + uv.y * 0.3 + t * max(0.1, params.y) * 0.1);
    let scan = 0.72 + 0.28 * sin(uv.y * u.resolution.y * 0.35);
    return vec4<f32>(holo * scan, 0.7);
  }
  if (fill_code == 7) {
    return vec4<f32>(mix(color0.rgb, color1.rgb, n), mix(color0.a, color1.a, n) * 0.8);
  }
  if (fill_code == 8) {
    let angle = params.y * 0.01745329252;
    let axis = vec2<f32>(cos(angle), sin(angle));
    return vec4<f32>(mix(color0.rgb, color1.rgb, clamp(dot(uv - vec2<f32>(0.5), axis) + 0.5, 0.0, 1.0)), mix(color0.a, color1.a, 0.5));
  }
  return vec4<f32>(0.0);
}

fn apply_native_edge_effects(base: vec3<f32>, uv: vec2<f32>, shape_mask: f32, layer_index: u32, t: f32) -> vec4<f32> {
  var result = base;
  var coverage = 0.0;
  let signed_dist = native_shape_signed_distance(uv, layer_index);
  let pixel_uv = max(fwidth(signed_dist), 1.0 / max(1.0, min(u.resolution.x, u.resolution.y)));
  let path_phase = native_edge_path_phase(uv, layer_index);
  for (var effect_index: i32 = 0; effect_index < 4; effect_index = effect_index + 1) {
    let edge_info = layers[layer_index].edge_effects[effect_index][0];
    if (edge_info.x < 0.5 || edge_info.y <= 0.001) { continue; }
    let stroke_color_raw = layers[layer_index].edge_effects[effect_index][1];
    let stroke_params = layers[layer_index].edge_effects[effect_index][2];
    let fill_params = layers[layer_index].edge_effects[effect_index][3];
    let fill_color0 = layers[layer_index].edge_effects[effect_index][4];
    let fill_color1 = layers[layer_index].edge_effects[effect_index][5];
    let animation = layers[layer_index].edge_effects[effect_index][6];
    let stroke_code = i32(floor(edge_info.w + 0.5));
    let fill_code = i32(floor(fill_params.x + 0.5));
    let animation_code = i32(floor(animation.x + 0.5));
    let speed = animation.y;
    var animated_dist = signed_dist;
    var animated_phase = path_phase;
    var animation_gain = 1.0;
    if (animation_code == 2) {
      animation_gain = mix(max(0.05, animation.z), max(animation.z, animation.w), 0.5 + 0.5 * sin(t * speed * 3.14159265));
    } else if (animation_code == 3) {
      animated_phase = fract(animated_phase + t * speed * 0.12);
    } else if (animation_code == 5 || animation_code == 6) {
      animated_dist += sin(animated_phase * 6.2831853 * max(1.0, animation.z) - t * speed * 3.0) * animation.w * 0.12;
    } else if (animation_code == 7) {
      animated_phase = fract(animated_phase + (hash21(vec2<f32>(floor(t * max(1.0, speed) * 8.0), f32(effect_index))) - 0.5) * animation.z * 0.2);
      animation_gain = 0.68 + 0.32 * step(0.18, hash21(vec2<f32>(floor(t * max(1.0, speed) * 14.0), uv.y * 31.0)));
    }

    let fill_sample = native_edge_fill_color(fill_code, uv, fill_color0, fill_color1, fill_params, t);
    let fill_alpha = fill_sample.a * shape_mask * edge_info.y * animation_gain;
    if (fill_code > 0 && fill_alpha > 0.001) {
      result = native_blend(result, fill_sample.rgb, fill_alpha, edge_info.z);
      coverage = max(coverage, fill_alpha);
    }

    if (stroke_code > 0) {
      let width_px = max(0.5, stroke_params.x) * animation_gain;
      var stroke_alpha = 1.0 - smoothstep(width_px * pixel_uv, (width_px + 1.5) * pixel_uv, abs(animated_dist));
      var stroke_color = stroke_color_raw.rgb;
      if (stroke_code == 2 || stroke_code == 3) {
        let glow_px = max(width_px + 2.0, stroke_params.y);
        let glow = 1.0 - smoothstep(width_px * pixel_uv, glow_px * pixel_uv, abs(animated_dist));
        let pulse = 1.0 + 0.28 * sin(t * stroke_params.w * 6.2831853);
        stroke_alpha = max(stroke_alpha, glow * clamp(stroke_params.z, 0.0, 3.0) * 0.55) * pulse;
        if (stroke_code == 3) { stroke_color = mix(vec3<f32>(1.0), stroke_color, 0.7); }
      } else if (stroke_code == 4) {
        let snake_count = max(1.0, stroke_params.w);
        let snake_phase = fract(animated_phase * snake_count - t * stroke_params.z * 0.18);
        let snake_length = clamp(stroke_params.y, 0.02, 0.98);
        stroke_alpha *= 1.0 - smoothstep(snake_length, min(1.0, snake_length + 0.08), snake_phase);
      } else if (stroke_code == 5) {
        stroke_color = native_edge_palette(animated_phase + t * stroke_params.z * 0.08);
      } else if (stroke_code == 6) {
        let dash = max(0.01, stroke_params.y);
        let gap = max(0.005, stroke_params.z);
        stroke_alpha *= step(gap / (dash + gap), fract(animated_phase * 4.0 / (dash + gap) - t * stroke_params.w * 0.25));
      } else if (stroke_code == 7) {
        let arc = hash21(vec2<f32>(floor(animated_phase * 96.0), floor(t * max(0.1, stroke_params.z) * 20.0)));
        stroke_alpha *= 0.35 + step(0.42, arc) * clamp(stroke_params.y, 0.1, 2.0);
      } else if (stroke_code == 8) {
        let pulses = max(1.0, stroke_params.y);
        let pulse = abs(fract(animated_phase * pulses - t * stroke_params.z * 0.25) - 0.5) * 2.0;
        stroke_alpha *= 1.0 - smoothstep(0.08, max(0.1, stroke_params.w), pulse);
      } else if (stroke_code == 9) {
        let beam = abs(fract(animated_phase - t * stroke_params.z * 0.15) - 0.5) * 2.0;
        stroke_alpha *= 1.0 - smoothstep(max(0.01, stroke_params.y), max(0.02, stroke_params.y) + 0.12, beam);
      } else if (stroke_code == 10) {
        let flame = fbm(vec2<f32>(animated_phase * 18.0, t * max(0.1, stroke_params.z) * 1.4));
        stroke_color = mix(vec3<f32>(1.0, 0.08, 0.0), stroke_color, flame);
        stroke_alpha *= 0.45 + flame * clamp(stroke_params.y, 0.1, 2.0);
      }
      if (animation_code == 1) {
        let spacing = max(0.004, animation.w);
        let ring = abs(fract((-signed_dist / spacing) - t * speed * 0.3) - 0.5) * 2.0;
        stroke_alpha = max(stroke_alpha, (1.0 - smoothstep(0.04, 0.22, ring)) * shape_mask);
      } else if (animation_code == 4) {
        let rays = max(2.0, animation.z);
        let ray = pow(abs(sin((atan2(uv.y - 0.5, uv.x - 0.5) + t * speed) * rays * 0.5)), 18.0);
        stroke_alpha = max(stroke_alpha, ray * shape_mask * 0.75);
      }
      stroke_alpha = clamp(stroke_alpha * stroke_color_raw.a * edge_info.y, 0.0, 1.0) * shape_mask;
      result = native_blend(result, stroke_color, stroke_alpha, edge_info.z);
      coverage = max(coverage, stroke_alpha);
    }
  }
  return vec4<f32>(result, coverage);
}

fn native_polygon_mask(local_uv: vec2<f32>, layer_index: u32) -> f32 {
  let point_count = min(64, i32(floor(layers[layer_index].mask_info.w + 0.5)));
  if (layers[layer_index].mask_info.x < 0.5 || point_count < 3) {
    return 1.0;
  }

  var inside_union = false;
  var min_edge_distance = 1000.0;
  for (var shape_index: i32 = 0; shape_index < 8; shape_index = shape_index + 1) {
    var crossings = 0;
    var shape_points = 0;
    for (var i: i32 = 0; i < 64; i = i + 1) {
      if (i >= point_count) { break; }
      let packed = layers[layer_index].mask[i];
      if (i32(floor(packed.w + 0.5)) != shape_index) { continue; }
      let next_index = clamp(i32(floor(packed.z + 0.5)), 0, point_count - 1);
      let a = packed.xy;
      let b = layers[layer_index].mask[next_index].xy;
      shape_points = shape_points + 1;
      let crosses = ((a.y <= local_uv.y && b.y > local_uv.y) || (a.y > local_uv.y && b.y <= local_uv.y)) &&
        (local_uv.x < (b.x - a.x) * (local_uv.y - a.y) / max(abs(b.y - a.y), 0.000001) * sign(b.y - a.y) + a.x);
      if (crosses) { crossings = crossings + 1; }
      min_edge_distance = min(min_edge_distance, segment_distance(local_uv, a, b));
    }
    if (shape_points >= 3 && (crossings % 2) == 1) {
      inside_union = true;
    }
  }

  var alpha = select(0.0, 1.0, inside_union);
  let feather = max(0.0, layers[layer_index].mask_info.z);
  if (inside_union && feather > 0.001) {
    alpha = smoothstep(0.0, feather, min_edge_distance);
  }
  if (layers[layer_index].mask_info.y > 0.5) {
    alpha = 1.0 - alpha;
  }
  return clamp(alpha, 0.0, 1.0);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
  let source = output_source_uv(in.uv);
  var canvas_uv = source.xy;
  var dome_mask = source.z;
  if (u.dome0.x > 0.5) {
    let domed = dome_source_uv(canvas_uv, aspect);
    canvas_uv = domed.xy;
    // Multiply, don't replace: a pixel outside the master warp's quad stays
    // black even when the dome mask says it is inside the dome circle.
    dome_mask = dome_mask * domed.z;
  }
  var p = (canvas_uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time;
  let audio = ghost_audio_scene();
  let audio_level = ghost_audio_level(audio);
  let audio_bass = ghost_audio_bass(audio);
  let audio_treble = ghost_audio_treble(audio);
  let audio_beat = ghost_audio_beat(audio);
  let audio_kick = ghost_audio_kick(audio);
  let audio_snare = ghost_audio_snare(audio);
  let audio_drive = clamp(audio_level * 0.36 + audio_bass * 0.30 + audio_beat * 0.42 + audio_kick * 0.26 + audio_snare * 0.18, 0.0, 1.8);
  let core = vec2<f32>(0.0, 0.02 * sin(t * 0.9));

  let layer_energy = clamp(u.layer_count / 16.0, 0.0, 1.0);
  var color = vec3<f32>(0.0);
  if (u.layer_count < -0.5) {
    let vignette = smoothstep(1.45, 0.18, length(p));
    color += vec3<f32>(0.006, 0.008, 0.012);
    color += vec3<f32>(0.01, 0.025, 0.04) * vignette * (1.0 + audio_drive * 0.8);

    let rings = abs(sin((length(p - core) * (18.0 + audio_bass * 5.0) - t * (3.0 + audio_level * 2.0)) + u.command_phase * 0.015));
    color += vec3<f32>(0.02, 0.18 + audio_treble * 0.16, 0.28 + audio_bass * 0.18) * pow(1.0 - rings, 8.0) * vignette * (1.0 + audio_beat * 1.35);

    for (var i: i32 = 0; i < 10; i = i + 1) {
      let fi = f32(i);
      let a = fi * 0.6283185 + t * (0.18 + 0.05 * sin(fi) + audio_level * 0.12) + u.command_phase * 0.004 + audio_beat * 0.08;
      let dir = vec2<f32>(cos(a), sin(a));
      let beam = glow_line(p, core, dir, 0.0018 + layer_energy * 0.002 + audio_kick * 0.0015);
      let palette = 0.5 + 0.5 * cos(vec3<f32>(0.0, 2.1, 4.2) + a + vec3<f32>(0.0, 0.7, 1.6) + audio_treble * 0.9);
      color += palette * beam * (0.22 + layer_energy * 0.45 + audio_drive * 0.34);
    }

    let grid = abs(fract((p.x + p.y + t * 0.15) * 24.0) - 0.5);
    let grid_glow = smoothstep(0.025 + audio_snare * 0.01, 0.0, grid) * (0.06 + audio_drive * 0.08);
    color += vec3<f32>(0.0, 0.7 + audio_treble * 0.2, 1.0) * grid_glow * vignette;
  }

  for (var i: i32 = 0; i < 64; i = i + 1) {
    if (f32(i) >= u.layer_count) {
      break;
    }
    let layer_index = u32(i);
    if (layers[layer_index].info.x < 0.5 || layers[layer_index].color.a <= 0.001) {
      continue;
    }
    let tl = layers[layer_index].p0.xy;
    let tr = layers[layer_index].p0.zw;
    let br = layers[layer_index].p1.xy;
    let bl = layers[layer_index].p1.zw;
    let local = quad_local_uv(canvas_uv, tl, tr, br, bl);
    let inside = local.x > 0.5;
    // Hierarchy mask layer (blend code 26): instead of drawing content,
    // its polygon mask clips EVERYTHING composited below it. Pixels
    // outside the layer's quad count as outside every shape (masked
    // away; visible when inverted). Layer opacity scales mask strength.
    // Hierarchy mask layers are applied AFTER the color loop finishes — see
    // the pass just below `color = apply_composite_effects(...)`. Applying
    // them here would multiply the still-empty color by the mask's coverage,
    // producing black; the content painted afterwards would then show through
    // unclipped. Skipping them here defers the multiply until the composite
    // beneath the mask is already fully accumulated.
    if (layers[layer_index].style.x >= 25.5 && layers[layer_index].style.x < 26.5) {
      continue;
    }
    let mesh_sample = layer_mesh_uv(local.yz, layer_index);
    let inside_mesh = inside && mesh_sample.x > 0.5;
    let uv_sample = layer_sample_uv(mesh_sample.yz, layer_index);
    let sample_uv = uv_sample.xy;
    let content_mask = uv_sample.z;
    let shape_sample = native_layer_shape(local.yz, layer_index);
    let polygon_mask = native_polygon_mask(local.yz, layer_index);
    let shape_mask = select(0.0, shape_sample.x * polygon_mask, inside_mesh);
    var layer_rgb = layers[layer_index].color.rgb;
    var fill_alpha = layers[layer_index].color.a * 0.56 * shape_mask;
    if (inside_mesh && layers[layer_index].info.w > 0.5) {
      let preview = source_content_for_layer(sample_source_content(layers[layer_index].info.w, sample_uv, layer_index), layers[layer_index].info.z);
      let source_alpha = preview.a * content_mask * shape_mask;
      layer_rgb = preview.rgb;
      fill_alpha = layers[layer_index].color.a * source_alpha;
    } else if (inside_mesh && layers[layer_index].info.z >= 9.0) {
      let proxy = gpu_proxy(layers[layer_index].info.z, sample_uv, t, layers[layer_index].info.y, layers[layer_index].params0, layers[layer_index].params1);
      let proxy_alpha = proxy.a * content_mask * shape_mask;
      layer_rgb = proxy.rgb;
      fill_alpha = layers[layer_index].color.a * (0.62 + 0.28 * proxy_alpha) * content_mask * shape_mask;
    }
    layer_rgb = apply_native_effects(layer_rgb, layer_index, sample_uv, t);
    let edge_composite = apply_native_edge_effects(layer_rgb, local.yz, shape_mask, layer_index, t);
    layer_rgb = edge_composite.rgb;
    fill_alpha = max(fill_alpha, layers[layer_index].color.a * edge_composite.a);
    if (inside_mesh && shape_mask > 0.001) {
      color = native_blend(color, layer_rgb, fill_alpha, layers[layer_index].style.x);
    }
  }

  // Hierarchy-mask pass. Runs after the color loop so the mask's polygon
  // coverage clips the composite that was actually painted beneath it.
  // Pixels outside a mask layer's quad count as outside every shape (masked
  // away, or preserved when the mask is inverted). Layer opacity scales the
  // clip strength so a mask can fade in.
  for (var i: i32 = 0; i < 64; i = i + 1) {
    if (f32(i) >= u.layer_count) {
      break;
    }
    let mask_index = u32(i);
    // Mask layers legitimately carry color=(0,0,0,0), so the color.a>0 gate
    // used in the color loop cannot apply here — only visibility matters.
    if (layers[mask_index].info.x < 0.5) {
      continue;
    }
    if (layers[mask_index].style.x < 25.5 || layers[mask_index].style.x >= 26.5) {
      continue;
    }
    let mtl = layers[mask_index].p0.xy;
    let mtr = layers[mask_index].p0.zw;
    let mbr = layers[mask_index].p1.xy;
    let mbl = layers[mask_index].p1.zw;
    let mlocal = quad_local_uv(canvas_uv, mtl, mtr, mbr, mbl);
    let minside = mlocal.x > 0.5;
    let mask_enabled = layers[mask_index].mask_info.x > 0.5 && layers[mask_index].mask_info.w >= 2.5;
    var coverage = 1.0;
    if (mask_enabled) {
      if (minside) {
        coverage = native_polygon_mask(mlocal.yz, mask_index);
      } else {
        coverage = select(0.0, 1.0, layers[mask_index].mask_info.y > 0.5);
      }
    }
    // Mask layers use color=(0,0,0,0) — they carry no fill — so `color.a` is
    // not a usable strength for the mix. The mask always clips at full strength.
    color = color * coverage;
  }

  color = apply_composite_effects(color, canvas_uv, t);
  if (u.dome2.z > 0.5) {
    color = slice_output_grade(color, in.uv) * dome_mask;
  } else {
    color = output_color_grade(color);
    color = color * dome_mask * edge_blend_alpha(in.uv);
  }
  return vec4<f32>(clamp(color * u.output_gate, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
