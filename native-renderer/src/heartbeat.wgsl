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
  // Each block is (mode, rows, cols, bezier) with its corner quad in c0/c1 as
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
  // Per-screen polygon masks, cut from the projector's frame after the
  // crop and warp have been resolved (slice mode only):
  //   smask        = (mask count, keep count, alpha output, _)
  //                  alpha output (z > 0.5) is set only by the recording
  //                  target pass: fs_main then returns straight colour and
  //                  the blended layers' coverage instead of an opaque frame.
  //   smask_info   = per mask (point start, point count, feather, invert)
  //   smask_bounds = per mask vertex bounds (x0, y0, x1, y1), padded
  //   smask_pts    = vertices in screen UV, two per vec4, up to 8 x 128
  //                  (curved edges arrive already cut into polylines)
  smask: vec4<f32>,
  smask_info: array<vec4<f32>, 8>,
  smask_bounds: array<vec4<f32>, 8>,
  smask_pts: array<vec4<f32>, 512>,
  // Bezier tangents of the screen and master meshes, two vec4 per point
  // exactly like LayerData.mesh_tangents. Read only while swarp.w / mwarp.w
  // is 1, so a tangent-free mesh keeps its straight bilinear cells.
  swarp_tangents: array<vec4<f32>, 512>,
  mwarp_tangents: array<vec4<f32>, 512>,
  // Beat clock (beat position, bpm, _, _): the editor's launch clock, run on
  // the render clock between anchors. Drives beat-synced Edge Effects.
  clock: vec4<f32>,
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
  // Edge Effects (see the Edge Effects section): 16 stacks of 22 resolved
  // vec4s; (points, effects, corners, diagonals); (centroid px, perimeter
  // px, inradius px); (seed); the centerline bbox px; the output-UV rectangle
  // the stack can touch; 16-segment chunk bounds; corners (x, y, arc length,
  // point index); diagonal corner pairs, two per vec4; and the centerline
  // itself (x px, y px, arc length px, surface scale).
  edge_effects: array<array<vec4<f32>, 22>, 16>,
  edge_info: vec4<f32>,
  edge_geom: vec4<f32>,
  edge_extra: vec4<f32>,
  edge_extra2: vec4<f32>,
  edge_bounds: vec4<f32>,
  edge_chunks: array<vec4<f32>, 32>,
  edge_corners: array<vec4<f32>, 64>,
  edge_diags: array<vec4<f32>, 32>,
  edge_pts: array<vec4<f32>, 512>,
  mask_info: vec4<f32>,
  mask: array<vec4<f32>, 64>,
  mesh: array<vec4<f32>, 128>,
  // Bezier tangents, two vec4 per point: (right.xy, down.xy), (left.xy, up.xy).
  // Read only while fast_flags.y says the mesh is a Bezier mesh.
  mesh_tangents: array<vec4<f32>, 512>,
  // Quad-local (min u, min v, max u, max v) holding a Bezier mesh's whole
  // surface. Read only while fast_flags.y says the mesh is a Bezier mesh.
  mesh_bounds: vec4<f32>,
  source_rect: vec4<f32>,
  fast_flags: vec4<u32>,
  // (r, g, b) colour multiplier (Screen FX colour chases; white leaves the
  // layer be), w the content alpha folded into color.a (see fs_main).
  tint: vec4<f32>,
}

@group(0) @binding(1)
var<storage, read> layers: array<LayerData>;

@group(0) @binding(2)
var<storage, read> source_previews: array<vec4<f32>>;

@group(0) @binding(3)
var source_frames: texture_2d_array<f32>;

@group(0) @binding(4)
var source_frame_sampler: sampler;

// Painted masks (paint_mask.rs): one R8 layer per painted layer, 1 =
// visible. Addressed in the layer's content UV so a painted hole rides
// along with corner pins and mesh warps.
@group(0) @binding(5)
var paint_masks: texture_2d_array<f32>;

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
  let ab = b - a;
  let ac = c - a;
  let ap = p - a;
  let determinant = cross2(ab, ac);
  if (abs(determinant) < 0.0000000001) { return vec3<f32>(-1.0); }
  let v = cross2(ap, ac) / determinant;
  let w = cross2(ab, ap) / determinant;
  return vec3<f32>(1.0 - v - w, v, w);
}

fn barycentric_inside(b: vec3<f32>) -> bool {
  return b.x >= -0.0005 && b.y >= -0.0005 && b.z >= -0.0005;
}

// A corner warp is one bilinear surface, not a pair of filled triangles.
// Beyond a fold its inverse has no solution; triangle fallback there draws
// an extra affine copy of the content under the actual folded surface.
fn quad_local_uv(p: vec2<f32>, tl: vec2<f32>, tr: vec2<f32>, br: vec2<f32>, bl: vec2<f32>) -> vec3<f32> {
  let uv = inverse_bilinear(p, tl, tr, br, bl);
  if (all(uv >= vec2<f32>(-0.0005)) && all(uv <= vec2<f32>(1.0005))) {
    return vec3<f32>(1.0, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
  }
  return vec3<f32>(0.0);
}

// A Bezier layer mesh can bulge past its corner quad, so its pixels are
// bounded by the surface's reach (mesh_bounds) instead. The corner pin is
// the bilinear map of the quad, continued outward: this inverts it on that
// continued map and returns (inside the reach, u, v) with u, v unclamped.
// Of the two roots the one inside the reach and nearest its centre wins,
// which inside the quad is the same root quad_local_uv takes.
fn quad_local_uv_reach(p: vec2<f32>, tl: vec2<f32>, tr: vec2<f32>, br: vec2<f32>, bl: vec2<f32>, reach: vec4<f32>) -> vec3<f32> {
  let lo = min(reach.xy, vec2<f32>(0.0)) - vec2<f32>(0.0005);
  let hi = max(reach.zw, vec2<f32>(1.0)) + vec2<f32>(0.0005);
  let centre = (lo + hi) * 0.5;
  let e = tr - tl;
  let f = bl - tl;
  let g = tl - tr + br - bl;
  let h = p - tl;
  let k2 = cross2(g, f);
  let k1 = cross2(e, f) + cross2(h, g);
  let k0 = cross2(h, e);
  var roots = vec2<f32>(0.0);
  if (abs(k2) < 0.0001) {
    if (abs(k1) < 0.0001) { return vec3<f32>(0.0); }
    roots = vec2<f32>(-k0 / k1);
  } else {
    let discriminant = k1 * k1 - 4.0 * k0 * k2;
    if (discriminant < 0.0) { return vec3<f32>(0.0); }
    let root = sqrt(discriminant);
    roots = vec2<f32>((-k1 - root) / (2.0 * k2), (-k1 + root) / (2.0 * k2));
  }
  var best = vec3<f32>(0.0);
  var best_distance = 1e30;
  for (var i = 0u; i < 2u; i = i + 1u) {
    let v_coord = roots[i];
    let denom_x = e.x + g.x * v_coord;
    let denom_y = e.y + g.y * v_coord;
    var u_coord = 0.0;
    if (abs(denom_x) >= abs(denom_y)) {
      if (abs(denom_x) <= 1e-7) { continue; }
      u_coord = (h.x - f.x * v_coord) / denom_x;
    } else {
      u_coord = (h.y - f.y * v_coord) / denom_y;
    }
    let uv = vec2<f32>(u_coord, v_coord);
    if (any(uv < lo) || any(uv > hi)) { continue; }
    let distance = dot(uv - centre, uv - centre);
    if (distance < best_distance) {
      best_distance = distance;
      best = vec3<f32>(1.0, uv);
    }
  }
  return best;
}

/// Output-space rectangle (min, max) the corner pin maps a Bezier mesh's
/// reach to. A bilinear map keeps a rectangle inside the hull of its
/// mapped corners, so the four corners bound it.
fn quad_reach_bounds(tl: vec2<f32>, tr: vec2<f32>, br: vec2<f32>, bl: vec2<f32>, reach: vec4<f32>) -> vec4<f32> {
  let lo = min(reach.xy, vec2<f32>(0.0));
  let hi = max(reach.zw, vec2<f32>(1.0));
  let c0 = mix(mix(tl, tr, lo.x), mix(bl, br, lo.x), lo.y);
  let c1 = mix(mix(tl, tr, hi.x), mix(bl, br, hi.x), lo.y);
  let c2 = mix(mix(tl, tr, hi.x), mix(bl, br, hi.x), hi.y);
  let c3 = mix(mix(tl, tr, lo.x), mix(bl, br, lo.x), hi.y);
  return vec4<f32>(min(min(c0, c1), min(c2, c3)), max(max(c0, c1), max(c2, c3)));
}

fn mesh_cell_uv(p: vec2<f32>, tl: vec2<f32>, tr: vec2<f32>, br: vec2<f32>, bl: vec2<f32>) -> vec3<f32> {
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

// Bezier mesh: every cell is a Coons patch bounded by four cubic edges, the
// same surface src/lib/utils/meshWarp.ts evaluates for the editor outline.
// Its bicubic form has 16 control points, so a cell can be rejected exactly
// by their bounds before the per-pixel Newton inverse runs.

const MESH_TANGENT_RIGHT: u32 = 0u;
const MESH_TANGENT_DOWN: u32 = 1u;
const MESH_TANGENT_LEFT: u32 = 2u;
const MESH_TANGENT_UP: u32 = 3u;

fn layer_mesh_tangent(layer_index: u32, index: u32, side: u32) -> vec2<f32> {
  let packed = layers[layer_index].mesh_tangents[index * 2u + (side >> 1u)];
  return select(packed.zw, packed.xy, (side & 1u) == 0u);
}

struct MeshPatch {
  // Corners: a = (row, col), b = (row, col + 1), c = (row + 1, col + 1), d = (row + 1, col).
  a: vec2<f32>,
  b: vec2<f32>,
  c: vec2<f32>,
  d: vec2<f32>,
  // Inner control points of the top (a->b), bottom (d->c), left (a->d) and right (b->c) edges.
  ab1: vec2<f32>,
  ab2: vec2<f32>,
  dc1: vec2<f32>,
  dc2: vec2<f32>,
  ad1: vec2<f32>,
  ad2: vec2<f32>,
  bc1: vec2<f32>,
  bc2: vec2<f32>,
}

/// A cell's patch from its four corners and the eight tangents that bend
/// its edges. Every mesh builds its cells here: layer meshes, screen meshes
/// and the Master Warp only differ in where their points are stored.
fn mesh_patch_build(
  a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>,
  a_right: vec2<f32>, a_down: vec2<f32>,
  b_left: vec2<f32>, b_down: vec2<f32>,
  c_left: vec2<f32>, c_up: vec2<f32>,
  d_right: vec2<f32>, d_up: vec2<f32>,
) -> MeshPatch {
  var mp: MeshPatch;
  mp.a = a;
  mp.b = b;
  mp.c = c;
  mp.d = d;
  mp.ab1 = a + a_right;
  mp.ab2 = b + b_left;
  mp.dc1 = d + d_right;
  mp.dc2 = c + c_left;
  mp.ad1 = a + a_down;
  mp.ad2 = d + d_up;
  mp.bc1 = b + b_down;
  mp.bc2 = c + c_up;
  return mp;
}

fn layer_mesh_patch(layer_index: u32, row: u32, col: u32, cols: u32) -> MeshPatch {
  let ia = row * cols + col;
  let ib = ia + 1u;
  let id = ia + cols;
  let ic = id + 1u;
  return mesh_patch_build(
    layer_mesh_point(layer_index, ia), layer_mesh_point(layer_index, ib),
    layer_mesh_point(layer_index, ic), layer_mesh_point(layer_index, id),
    layer_mesh_tangent(layer_index, ia, MESH_TANGENT_RIGHT), layer_mesh_tangent(layer_index, ia, MESH_TANGENT_DOWN),
    layer_mesh_tangent(layer_index, ib, MESH_TANGENT_LEFT), layer_mesh_tangent(layer_index, ib, MESH_TANGENT_DOWN),
    layer_mesh_tangent(layer_index, ic, MESH_TANGENT_LEFT), layer_mesh_tangent(layer_index, ic, MESH_TANGENT_UP),
    layer_mesh_tangent(layer_index, id, MESH_TANGENT_RIGHT), layer_mesh_tangent(layer_index, id, MESH_TANGENT_UP),
  );
}

fn bezier3(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
  let s = 1.0 - t;
  return s * s * s * p0 + 3.0 * s * s * t * p1 + 3.0 * s * t * t * p2 + t * t * t * p3;
}

fn bezier3_tangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
  let s = 1.0 - t;
  return 3.0 * (s * s * (p1 - p0) + 2.0 * s * t * (p2 - p1) + t * t * (p3 - p2));
}

/// Coons patch: blend the top/bottom edges in v and the left/right edges in
/// u, minus the bilinear corner sheet counted twice. Straight edges reduce
/// it to the plain bilinear cell.
fn mesh_patch_eval(p: MeshPatch, uv: vec2<f32>) -> vec2<f32> {
  let top = bezier3(p.a, p.ab1, p.ab2, p.b, uv.x);
  let bottom = bezier3(p.d, p.dc1, p.dc2, p.c, uv.x);
  let left = bezier3(p.a, p.ad1, p.ad2, p.d, uv.y);
  let right = bezier3(p.b, p.bc1, p.bc2, p.c, uv.y);
  let sheet = mix(mix(p.a, p.b, uv.x), mix(p.d, p.c, uv.x), uv.y);
  return mix(top, bottom, uv.y) + mix(left, right, uv.x) - sheet;
}

/// Inner control point (i, j) in 1..2 of the patch's bicubic Bezier form.
fn mesh_patch_inner(p: MeshPatch, i: u32, j: u32) -> vec2<f32> {
  let fu = f32(i) / 3.0;
  let fv = f32(j) / 3.0;
  let top_i = select(p.ab2, p.ab1, i == 1u);
  let bottom_i = select(p.dc2, p.dc1, i == 1u);
  let left_j = select(p.ad2, p.ad1, j == 1u);
  let right_j = select(p.bc2, p.bc1, j == 1u);
  let sheet = mix(mix(p.a, p.b, fu), mix(p.d, p.c, fu), fv);
  return mix(top_i, bottom_i, fv) + mix(left_j, right_j, fu) - sheet;
}

/// The patch lies inside the convex hull of its 16 Bezier control points,
/// so a pixel outside their bounds can skip the solve.
fn mesh_patch_contains_bounds(p: MeshPatch, q: vec2<f32>) -> bool {
  var lo = min(min(p.a, p.b), min(p.c, p.d));
  var hi = max(max(p.a, p.b), max(p.c, p.d));
  lo = min(lo, min(min(p.ab1, p.ab2), min(p.dc1, p.dc2)));
  hi = max(hi, max(max(p.ab1, p.ab2), max(p.dc1, p.dc2)));
  lo = min(lo, min(min(p.ad1, p.ad2), min(p.bc1, p.bc2)));
  hi = max(hi, max(max(p.ad1, p.ad2), max(p.bc1, p.bc2)));
  for (var j = 1u; j <= 2u; j = j + 1u) {
    for (var i = 1u; i <= 2u; i = i + 1u) {
      let inner = mesh_patch_inner(p, i, j);
      lo = min(lo, inner);
      hi = max(hi, inner);
    }
  }
  return all(q >= lo - vec2<f32>(0.002)) && all(q <= hi + vec2<f32>(0.002));
}

/// Newton steps from `start` toward the (u, v) whose patch position is `q`.
/// Returns (found, u, v). A step that lands far outside the cell is clamped
/// back so a wild first guess cannot run off to another cell's surface.
fn mesh_patch_newton(q: vec2<f32>, p: MeshPatch, start: vec2<f32>) -> vec3<f32> {
  var uv = start;
  var residual = mesh_patch_eval(p, uv) - q;
  for (var iteration = 0u; iteration < 10u; iteration = iteration + 1u) {
    if (dot(residual, residual) < 1e-12) { break; }
    let top = bezier3(p.a, p.ab1, p.ab2, p.b, uv.x);
    let bottom = bezier3(p.d, p.dc1, p.dc2, p.c, uv.x);
    let left = bezier3(p.a, p.ad1, p.ad2, p.d, uv.y);
    let right = bezier3(p.b, p.bc1, p.bc2, p.c, uv.y);
    let d_top = bezier3_tangent(p.a, p.ab1, p.ab2, p.b, uv.x);
    let d_bottom = bezier3_tangent(p.d, p.dc1, p.dc2, p.c, uv.x);
    let d_left = bezier3_tangent(p.a, p.ad1, p.ad2, p.d, uv.y);
    let d_right = bezier3_tangent(p.b, p.bc1, p.bc2, p.c, uv.y);
    let d_sheet_u = mix(p.b - p.a, p.c - p.d, uv.y);
    let d_sheet_v = mix(p.d, p.c, uv.x) - mix(p.a, p.b, uv.x);
    let du = mix(d_top, d_bottom, uv.y) + (right - left) - d_sheet_u;
    let dv = (bottom - top) + mix(d_left, d_right, uv.x) - d_sheet_v;
    let det = du.x * dv.y - dv.x * du.y;
    if (abs(det) < 1e-9) { return vec3<f32>(0.0, uv); }
    let delta = vec2<f32>(
      (residual.x * dv.y - residual.y * dv.x) / det,
      (du.x * residual.y - du.y * residual.x) / det,
    );
    uv = clamp(uv - delta, vec2<f32>(-0.5), vec2<f32>(1.5));
    residual = mesh_patch_eval(p, uv) - q;
  }
  let inside = all(uv >= vec2<f32>(-0.0005)) && all(uv <= vec2<f32>(1.0005));
  let converged = dot(residual, residual) < 1e-9;
  return vec3<f32>(select(0.0, 1.0, inside && converged), clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
}

/// Inverse of one Bezier cell: (inside, u, v). The bilinear inverse of the
/// corner quad is the first guess; when that misses (the pixel sits in a
/// bulge outside the quad) the centre and quadrants are tried in turn.
fn mesh_patch_uv(q: vec2<f32>, p: MeshPatch) -> vec3<f32> {
  let start = inverse_bilinear(q, p.a, p.b, p.c, p.d);
  if (all(start >= vec2<f32>(-0.25)) && all(start <= vec2<f32>(1.25))) {
    let hit = mesh_patch_newton(q, p, clamp(start, vec2<f32>(0.0), vec2<f32>(1.0)));
    if (hit.x > 0.5) { return hit; }
  }
  let centre = mesh_patch_newton(q, p, vec2<f32>(0.5));
  if (centre.x > 0.5) { return centre; }
  for (var quadrant = 0u; quadrant < 4u; quadrant = quadrant + 1u) {
    let seed = vec2<f32>(
      select(0.25, 0.75, (quadrant & 1u) == 1u),
      select(0.25, 0.75, quadrant >= 2u),
    );
    let hit = mesh_patch_newton(q, p, seed);
    if (hit.x > 0.5) { return hit; }
  }
  return vec3<f32>(0.0, 0.0, 0.0);
}

fn layer_mesh_uv_bezier(local_uv: vec2<f32>, layer_index: u32, rows: u32, cols: u32) -> vec3<f32> {
  // Same nearby-first search as the straight mesh below.
  let exact_search = rows <= 4u && cols <= 4u;
  let estimated_row = min(rows - 2u, u32(clamp(floor(local_uv.y * f32(rows - 1u)), 0.0, f32(rows - 2u))));
  let estimated_col = min(cols - 2u, u32(clamp(floor(local_uv.x * f32(cols - 1u)), 0.0, f32(cols - 2u))));
  for (var search = 0u; search < 2u; search = search + 1u) {
    if (search == 1u && exact_search) { break; }
    for (var row = 0u; row < 15u; row = row + 1u) {
      if (row >= rows - 1u) { break; }
      for (var col = 0u; col < 15u; col = col + 1u) {
        if (col >= cols - 1u) { break; }
        let nearby = exact_search || (row + 1u >= estimated_row && row <= estimated_row + 1u
          && col + 1u >= estimated_col && col <= estimated_col + 1u);
        if ((search == 0u && !nearby) || (search == 1u && nearby)) { continue; }
        let mesh_cell = layer_mesh_patch(layer_index, row, col, cols);
        if (!mesh_patch_contains_bounds(mesh_cell, local_uv)) { continue; }
        let cell = mesh_patch_uv(local_uv, mesh_cell);
        if (cell.x > 0.5) {
          return vec3<f32>(1.0,
            (f32(col) + cell.y) / f32(cols - 1u),
            (f32(row) + cell.z) / f32(rows - 1u));
        }
      }
    }
  }
  return vec3<f32>(0.0, local_uv);
}

fn layer_mesh_uv(local_uv: vec2<f32>, layer_index: u32) -> vec3<f32> {
  let rows = u32(clamp(floor(layers[layer_index].style.z + 0.5), 0.0, 16.0));
  let cols = u32(clamp(floor(layers[layer_index].style.w + 0.5), 0.0, 16.0));
  if (rows < 2u || cols < 2u) {
    return vec3<f32>(1.0, local_uv);
  }
  if (layers[layer_index].fast_flags.y == 1u) {
    return layer_mesh_uv_bezier(local_uv, layer_index, rows, cols);
  }
  // Try nearby cells first. A strong warp can move a cell far beyond its
  // original grid neighborhood, so unresolved pixels also search the rest.
  // Bounds reject unrelated cells before any inverse/triangle solve.
  let exact_search = rows <= 4u && cols <= 4u;
  let estimated_row = min(rows - 2u, u32(clamp(floor(local_uv.y * f32(rows - 1u)), 0.0, f32(rows - 2u))));
  let estimated_col = min(cols - 2u, u32(clamp(floor(local_uv.x * f32(cols - 1u)), 0.0, f32(cols - 2u))));
  for (var search = 0u; search < 2u; search = search + 1u) {
    if (search == 1u && exact_search) { break; }
    for (var row = 0u; row < 15u; row = row + 1u) {
      if (row >= rows - 1u) { break; }
      for (var col = 0u; col < 15u; col = col + 1u) {
        if (col >= cols - 1u) { break; }
        let nearby = exact_search || (row + 1u >= estimated_row && row <= estimated_row + 1u
          && col + 1u >= estimated_col && col <= estimated_col + 1u);
        if ((search == 0u && !nearby) || (search == 1u && nearby)) { continue; }
        let a = layer_mesh_point(layer_index, row * cols + col);
        let b = layer_mesh_point(layer_index, row * cols + col + 1u);
        let c = layer_mesh_point(layer_index, (row + 1u) * cols + col + 1u);
        let d = layer_mesh_point(layer_index, (row + 1u) * cols + col);
        let bounds_min = min(min(a, b), min(c, d)) - vec2<f32>(0.000001);
        let bounds_max = max(max(a, b), max(c, d)) + vec2<f32>(0.000001);
        if (any(local_uv < bounds_min) || any(local_uv > bounds_max)) { continue; }
        // Concave/folded cells use the same two triangles as the mesh, rather
        // than turning an unsolved bilinear inverse into transparent pixels.
        let cell = mesh_cell_uv(local_uv, a, b, c, d);
        if (cell.x > 0.5) {
          return vec3<f32>(1.0,
            (f32(col) + cell.y) / f32(cols - 1u),
            (f32(row) + cell.z) / f32(rows - 1u));
        }
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

// Surface-space transform for warped shapes. other mapping software-model: the shape is a
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
// dragged vertices (conventional).
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
  // Shape control-point warp (conventional). Kind 1: circle quad+center —
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

fn swarp_mesh_tangent(index: u32, side: u32) -> vec2<f32> {
  let packed = u.swarp_tangents[min(index * 2u + (side >> 1u), 511u)];
  return select(packed.zw, packed.xy, (side & 1u) == 0u);
}

fn mwarp_mesh_tangent(index: u32, side: u32) -> vec2<f32> {
  let packed = u.mwarp_tangents[min(index * 2u + (side >> 1u), 511u)];
  return select(packed.zw, packed.xy, (side & 1u) == 0u);
}

fn swarp_mesh_patch(row: u32, col: u32, cols: u32) -> MeshPatch {
  let ia = row * cols + col;
  let ib = ia + 1u;
  let id = ia + cols;
  let ic = id + 1u;
  return mesh_patch_build(
    swarp_mesh_point(ia), swarp_mesh_point(ib), swarp_mesh_point(ic), swarp_mesh_point(id),
    swarp_mesh_tangent(ia, MESH_TANGENT_RIGHT), swarp_mesh_tangent(ia, MESH_TANGENT_DOWN),
    swarp_mesh_tangent(ib, MESH_TANGENT_LEFT), swarp_mesh_tangent(ib, MESH_TANGENT_DOWN),
    swarp_mesh_tangent(ic, MESH_TANGENT_LEFT), swarp_mesh_tangent(ic, MESH_TANGENT_UP),
    swarp_mesh_tangent(id, MESH_TANGENT_RIGHT), swarp_mesh_tangent(id, MESH_TANGENT_UP),
  );
}

fn mwarp_mesh_patch(row: u32, col: u32, cols: u32) -> MeshPatch {
  let ia = row * cols + col;
  let ib = ia + 1u;
  let id = ia + cols;
  let ic = id + 1u;
  return mesh_patch_build(
    mwarp_mesh_point(ia), mwarp_mesh_point(ib), mwarp_mesh_point(ic), mwarp_mesh_point(id),
    mwarp_mesh_tangent(ia, MESH_TANGENT_RIGHT), mwarp_mesh_tangent(ia, MESH_TANGENT_DOWN),
    mwarp_mesh_tangent(ib, MESH_TANGENT_LEFT), mwarp_mesh_tangent(ib, MESH_TANGENT_DOWN),
    mwarp_mesh_tangent(ic, MESH_TANGENT_LEFT), mwarp_mesh_tangent(ic, MESH_TANGENT_UP),
    mwarp_mesh_tangent(id, MESH_TANGENT_RIGHT), mwarp_mesh_tangent(id, MESH_TANGENT_UP),
  );
}

/// Master Warp Bezier mesh: the control points are destinations, so each
/// pixel inverts the Coons patch of the cell it lands in, with the same
/// nearby-first search and bounds rejection as layer_mesh_uv_bezier. It is a
/// separate loop only because the fs_output pipeline has no layer buffer.
fn mwarp_mesh_uv_bezier(q: vec2<f32>, rows: u32, cols: u32) -> vec3<f32> {
  let exact_search = rows <= 4u && cols <= 4u;
  let estimated_row = min(rows - 2u, u32(clamp(floor(q.y * f32(rows - 1u)), 0.0, f32(rows - 2u))));
  let estimated_col = min(cols - 2u, u32(clamp(floor(q.x * f32(cols - 1u)), 0.0, f32(cols - 2u))));
  for (var search = 0u; search < 2u; search = search + 1u) {
    if (search == 1u && exact_search) { break; }
    for (var row = 0u; row < WARP_MESH_MAX_DIM - 1u; row = row + 1u) {
      if (row >= rows - 1u) { break; }
      for (var col = 0u; col < WARP_MESH_MAX_DIM - 1u; col = col + 1u) {
        if (col >= cols - 1u) { break; }
        let nearby = exact_search || (row + 1u >= estimated_row && row <= estimated_row + 1u
          && col + 1u >= estimated_col && col <= estimated_col + 1u);
        if ((search == 0u && !nearby) || (search == 1u && nearby)) { continue; }
        let mesh_cell = mwarp_mesh_patch(row, col, cols);
        if (!mesh_patch_contains_bounds(mesh_cell, q)) { continue; }
        let cell = mesh_patch_uv(q, mesh_cell);
        if (cell.x > 0.5) {
          return vec3<f32>(
            (f32(col) + cell.y) / f32(cols - 1u),
            (f32(row) + cell.z) / f32(rows - 1u),
            1.0,
          );
        }
      }
    }
  }
  return vec3<f32>(q, 0.0);
}

/// Per-slice screen warp: projector UV -> master-canvas sample position.
/// Corners and mesh control points are already sample positions, so this is
/// a direct forward interpolation with no solve. A Bezier mesh evaluates
/// its cell as the Coons patch instead of the bilinear sheet.
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
    if (u.swarp.w > 0.5) {
      return mesh_patch_eval(swarp_mesh_patch(ri, ci, cols), vec2<f32>(su, sv));
    }
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
  if (u.mwarp.w > 0.5) {
    return mwarp_mesh_uv_bezier(q, rows, cols);
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

const SCREEN_MASK_MAX: i32 = 8;
const SCREEN_MASK_FLAT_POINTS: i32 = 128;

fn screen_mask_point(index: i32) -> vec2<f32> {
  let slot = clamp(index / 2, 0, 511);
  let packed = u.smask_pts[slot];
  return select(packed.zw, packed.xy, (index % 2) == 0);
}

/// Coverage of one screen mask polygon at `uv`: 1 inside, ramping to 0 over
/// `feather` UV units measured inward from the edge, 0 outside. Same ray
/// crossing and edge distance test as native_polygon_mask. A curved mask is
/// its flattened polyline (flatten_screen_mask), whose distance field stays
/// within the flattening tolerance of the curve's, so the feather follows
/// the curve. Pixels outside the padded bounds have no crossing to count.
fn screen_mask_coverage(uv: vec2<f32>, mask_index: i32) -> f32 {
  let info = u.smask_info[mask_index];
  let start = i32(floor(info.x + 0.5));
  let count = min(i32(floor(info.y + 0.5)), SCREEN_MASK_FLAT_POINTS);
  if (count < 3) { return 0.0; }
  let bounds = u.smask_bounds[mask_index];
  if (any(uv < bounds.xy) || any(uv > bounds.zw)) { return 0.0; }
  var crossings = 0;
  var min_edge_distance = 1000.0;
  for (var i: i32 = 0; i < SCREEN_MASK_FLAT_POINTS; i = i + 1) {
    if (i >= count) { break; }
    let a = screen_mask_point(start + i);
    let b = screen_mask_point(start + ((i + 1) % count));
    let crosses = ((a.y <= uv.y && b.y > uv.y) || (a.y > uv.y && b.y <= uv.y)) &&
      (uv.x < (b.x - a.x) * (uv.y - a.y) / max(abs(b.y - a.y), 0.000001) * sign(b.y - a.y) + a.x);
    if (crosses) { crossings = crossings + 1; }
    min_edge_distance = min(min_edge_distance, segment_distance(uv, a, b));
  }
  if ((crossings % 2) != 1) { return 0.0; }
  let feather = max(0.0, info.z);
  if (feather > 0.001) {
    return smoothstep(0.0, feather, min_edge_distance);
  }
  return 1.0;
}

/// Per-screen mask stack, evaluated in the screen's content UV (after
/// rotation, before the crop / warp sample) so it rides along with a
/// re-pinned projector. Normal masks keep the union of their insides (no
/// normal mask keeps everything); each inverted mask then cuts a hole.
fn screen_mask_alpha(uv: vec2<f32>) -> f32 {
  let count = min(i32(floor(u.smask.x + 0.5)), SCREEN_MASK_MAX);
  if (count <= 0) { return 1.0; }
  let keep_count = i32(floor(u.smask.y + 0.5));
  var keep = select(1.0, 0.0, keep_count > 0);
  var cut = 1.0;
  for (var m: i32 = 0; m < SCREEN_MASK_MAX; m = m + 1) {
    if (m >= count) { break; }
    let coverage = screen_mask_coverage(uv, m);
    if (u.smask_info[m].w > 0.5) {
      cut = cut * (1.0 - coverage);
    } else {
      keep = max(keep, coverage);
    }
  }
  return clamp(keep * cut, 0.0, 1.0);
}

/// Alignment test patterns, drawn OVER the composited frame on the output.
/// Codes mirror TestPatternType: 1 grid, 2 crosshair, 3 colour bars,
/// 4 white, 5 gradient, 6 checkerboard. Patterns draw in screen space
/// (pre-warp UV) so a keystoned rig shows the pattern through its warp —
/// which is the whole point of an alignment pattern.
fn apply_test_pattern(color_in: vec3<f32>, uv: vec2<f32>, aspect: f32) -> vec3<f32> {
  let code = i32(floor(u.dome2.w + 0.5));
  if (code <= 0) { return color_in; }
  if (code == 4) { return vec3<f32>(1.0); }
  if (code == 5) {
    return vec3<f32>(uv.x, uv.y, 1.0 - uv.x);
  }
  if (code == 6) {
    let cells = 8.0;
    let cx = floor(uv.x * cells * aspect);
    let cy = floor(uv.y * cells);
    let odd = (cx + cy) - 2.0 * floor((cx + cy) / 2.0);
    return vec3<f32>(select(0.08, 0.92, odd > 0.5));
  }
  if (code == 3) {
    let bars = array<vec3<f32>, 7>(
      vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(0.0, 1.0, 1.0),
      vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(1.0, 0.0, 0.0),
      vec3<f32>(0.0, 0.0, 1.0));
    let index = i32(clamp(floor(uv.x * 7.0), 0.0, 6.0));
    return bars[index];
  }
  // Grid and crosshair overlay the content rather than replacing it, so
  // alignment can happen against live footage.
  var out = color_in * 0.35;
  let px = 1.0 / max(u.resolution.x, 1.0);
  let py = 1.0 / max(u.resolution.y, 1.0);
  if (code == 1) {
    let cols = 12.0;
    let rows = 12.0 / aspect;
    let gx = abs(fract(uv.x * cols) - 0.5);
    let gy = abs(fract(uv.y * rows) - 0.5);
    let line = max(step(gx, px * cols * 1.2), step(gy, py * rows * 1.2));
    out = mix(out, vec3<f32>(0.0, 1.0, 0.55), line);
  }
  let cx = abs(uv.x - 0.5);
  let cy = abs(uv.y - 0.5);
  let cross = max(step(cx, px * 1.5), step(cy, py * 1.5));
  let ring = abs(length(vec2<f32>((uv.x - 0.5) * aspect, uv.y - 0.5)) - 0.25);
  let circle = step(ring, px * 2.0);
  if (code == 2 || code == 1) {
    out = mix(out, vec3<f32>(1.0, 0.3, 0.9), max(cross, circle));
  }
  return out;
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

// ── Edge Effects ──────────────────────────────────────────────────────────
// conventional stroke, fill and animation stacks on a layer's outline,
// evaluated analytically per OUTPUT pixel after the layer's warp. The
// outline arrives already warped and flattened (edgeEffectGeometry.ts):
// the stroke centerline in output pixels (y up) with the arc length and
// surface scale at each point. Distances, widths, dashes and glows are all
// output pixels, and every edge is an analytic coverage ramp one screen
// pixel wide, so nothing is resampled and nothing goes soft under a warp.
//
// The classic types (solid through fire, plasma through gradient, and the
// eight classic animations) keep the colour and motion math of the editor's
// drawing shape shader (src/lib/drawing/renderer.ts); only their anti-alias
// ramps became analytic. Values arrive resolved by the shared resolvers.
//
// Per-effect vec4 layout (packNativeEdgeEffect in nativeRendererSync.ts):
//   0 (active, opacity, blend, stroke type)     1 stroke colour
//   2 (width px, glow size px, glow intensity, pulse/flicker speed)
//   3 (snake length, stroke speed, snake count, dash length)
//   4 (gap length, electric arc, scanner beam, scanner trail)
//   5 (strobe rate, fill type, fill speed, gradient type)
//   6 fill colour   7 second fill colour
//   8 fill params A   9 (animation type, count, spacing, speed)
//  10 animation params A   11 stroke params B
//  12 beat chase (group index, group count, chase beats, hue per beat)
//  13 (cap, join, miter limit, width mode)
//  14 (trim start, trim end, trim offset, trim mode)
//  15 (trim speed, chase delay s, seed, custom centre)
//  16 (centre x px, centre y px, fill progress mode, fill progress)
//  17 dash pattern (dash, gap, dash, gap) px
//  18 group bounds (min x, min y, max x, max y) px
//  19 the effect's own output-UV cull rectangle
//  20 (cull reach px from the centerline, draws inside, reach px, _)
//  21 beat reaction (mode, source, amount, decay), see edge_react

const EDGE_PI: f32 = 3.14159265359;
const EDGE_TAU: f32 = 6.28318530718;

fn edge_mod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

/// GLSL smoothstep, spelled out: the snake stroke relies on reversed edges.
fn edge_smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/// The drawing shader's hash, kept for the classic types' flicker timing.
fn edge_random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453123);
}

/// Integer hash for the new types: identical on every GPU.
fn edge_hash_u(v: u32) -> u32 {
  var x = v * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}

fn edge_hash2(a: f32, b: f32) -> f32 {
  let h = edge_hash_u(bitcast<u32>(i32(floor(a))) ^ edge_hash_u(bitcast<u32>(i32(floor(b))) + 0x9e3779b9u));
  return f32(h & 0x00ffffffu) / 16777215.0;
}

fn edge_value_noise(x: f32, seed: f32) -> f32 {
  let i = floor(x);
  let f = x - i;
  let u = f * f * (3.0 - 2.0 * f);
  return mix(edge_hash2(i, seed), edge_hash2(i + 1.0, seed), u) * 2.0 - 1.0;
}

/// GLSL rotate2d(a) * v with rotate2d = mat2(c, -s, s, c).
fn edge_rotate(v: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * v.x + s * v.y, -s * v.x + c * v.y);
}

fn edge_hsv(h: f32, s: f32, v: f32) -> vec3<f32> {
  let k = vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0);
  let p = abs(fract(vec3<f32>(h) + k) * 6.0 - vec3<f32>(3.0));
  return v * mix(vec3<f32>(1.0), clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), s);
}

/// Analytic coverage of a signed distance (negative inside), `aa` screen px wide.
fn edge_cov(sd: f32, aa: f32) -> f32 {
  return clamp(0.5 - sd / aa, 0.0, 1.0);
}

fn edge_pt(li: u32, i: i32) -> vec4<f32> {
  return layers[li].edge_pts[i];
}

struct EdgeHit {
  d: f32,      // signed distance to the centerline polygon, px, negative inside
  s: f32,      // arc length of the closest centerline point, px
  seg: i32,    // closest segment
  h: f32,      // position along it (0-1)
  scale: f32,  // surface scale there
}

/// Closest point and winding against the centerline, visiting only the
/// 16-segment chunks that can matter (closer than the best so far, or
/// crossed by the pixel's winding ray).
fn edge_hit(li: u32, p: vec2<f32>, count: i32) -> EdgeHit {
  var best = 1.0e20;
  var winding = 0;
  var seg = 0;
  var hh = 0.0;
  let chunk_count = (count + 15) / 16;
  for (var c: i32 = 0; c < 32; c = c + 1) {
    if (c >= chunk_count) { break; }
    let bb = layers[li].edge_chunks[c];
    let q = max(max(bb.xy - p, p - bb.zw), vec2<f32>(0.0));
    let box_d2 = dot(q, q);
    let ray_hits = p.y >= bb.y && p.y < bb.w && p.x <= bb.z;
    if (box_d2 >= best && !ray_hits) { continue; }
    let start = c * 16;
    let end = min(start + 16, count);
    for (var i: i32 = start; i < end; i = i + 1) {
      let a = edge_pt(li, i).xy;
      let b = edge_pt(li, select(i + 1, 0, i + 1 >= count)).xy;
      let pa = p - a;
      let ba = b - a;
      let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
      let e = pa - ba * h;
      let d2 = dot(e, e);
      if (d2 < best) {
        best = d2;
        seg = i;
        hh = h;
      }
      let cross_z = ba.x * pa.y - pa.x * ba.y;
      if (a.y <= p.y) {
        if (b.y > p.y && cross_z > 0.0) { winding = winding + 1; }
      } else if (b.y <= p.y && cross_z < 0.0) {
        winding = winding - 1;
      }
    }
  }
  let a = edge_pt(li, seg);
  let b = edge_pt(li, select(seg + 1, 0, seg + 1 >= count));
  let seg_len = length(b.xy - a.xy);
  var out: EdgeHit;
  out.d = select(1.0, -1.0, winding != 0) * sqrt(best);
  out.s = a.z + seg_len * hh;
  out.seg = seg;
  out.h = hh;
  out.scale = mix(a.w, b.w, hh);
  return out;
}

/// Output position of arc length `s` along the centerline.
fn edge_point_at(li: u32, s_in: f32, count: i32, total: f32) -> vec2<f32> {
  let s = edge_mod(s_in, total);
  var lo = 0;
  var hi = count - 1;
  for (var k: i32 = 0; k < 10; k = k + 1) {
    if (lo >= hi) { break; }
    let mid = (lo + hi + 1) / 2;
    if (edge_pt(li, mid).z <= s) { lo = mid; } else { hi = mid - 1; }
  }
  let a = edge_pt(li, lo);
  let b = edge_pt(li, select(lo + 1, 0, lo + 1 >= count));
  let seg_end = select(b.z, total, lo + 1 >= count);
  let t = clamp((s - a.z) / max(seg_end - a.z, 1e-6), 0.0, 1.0);
  return mix(a.xy, b.xy, t);
}

/// Signed distance to a stroke of half-width `hw` on the centerline, with
/// the chosen join where the closest feature is a vertex (0 miter, 1 round,
/// 2 bevel). Round joins are the plain distance field.
fn edge_band_sd(li: u32, p: vec2<f32>, hit: EdgeHit, hw: f32, join: i32, miter_limit: f32, count: i32) -> f32 {
  var sd = abs(hit.d) - hw;
  if (join == 1 || (hit.h > 0.0 && hit.h < 1.0)) { return sd; }
  let vi = select(hit.seg, select(hit.seg + 1, 0, hit.seg + 1 >= count), hit.h >= 1.0);
  let v = edge_pt(li, vi).xy;
  let prev = edge_pt(li, select(vi - 1, count - 1, vi == 0)).xy;
  let next = edge_pt(li, select(vi + 1, 0, vi + 1 >= count)).xy;
  let tin = normalize(v - prev);
  let tout = normalize(next - v);
  let rel = p - v;
  var nin = vec2<f32>(-tin.y, tin.x);
  if (dot(nin, rel) < 0.0) { nin = -nin; }
  var nout = vec2<f32>(-tout.y, tout.x);
  if (dot(nout, rel) < 0.0) { nout = -nout; }
  // A straight-through vertex (a mesh or flattening split) has no join:
  // both offset points coincide, the miter edges below would normalize a
  // zero vector, and the NaN they give survives max() in the dash and trim
  // cuts as a line through the vertex. The band there is the plain one.
  if (dot(nin, nout) > 0.99999) { return sd; }
  let a = v + nin * hw;
  let b = v + nout * hw;
  let denom = max(1.0 + dot(nin, nout), 1e-4);
  let ratio = sqrt(2.0 / denom);
  if (join == 0 && ratio <= miter_limit) {
    let m = v + (nin + nout) / denom * hw;
    let e0 = normalize(m - a);
    let e1 = normalize(b - m);
    let n0 = vec2<f32>(e0.y, -e0.x) * sign(dot(vec2<f32>(e0.y, -e0.x), a - v));
    let n1 = vec2<f32>(e1.y, -e1.x) * sign(dot(vec2<f32>(e1.y, -e1.x), b - v));
    sd = max(dot(p - a, n0), dot(p - b, n1));
  } else {
    let e = normalize(b - a);
    var n = vec2<f32>(e.y, -e.x);
    if (dot(n, a - v) < 0.0) { n = -n; }
    sd = dot(p - a, n);
  }
  return sd;
}

/// Signed distance, along the path, outside the circular interval
/// [s0, s0 + len) of a closed path of length `total` (negative inside).
fn edge_interval_out(s: f32, s0: f32, len: f32, total: f32) -> f32 {
  if (len >= total) { return -1.0e6; }
  if (len <= 0.0) { return 1.0e6; }
  let u = edge_mod(s - s0, total);
  if (u < len) { return -min(u, len - u); }
  return min(u - len, total - u);
}

/// Same for a periodic on-interval [0, on) repeating every `cycle`.
fn edge_periodic_out(u_in: f32, on: f32, cycle: f32) -> f32 {
  let u = edge_mod(u_in, cycle);
  if (u < on) { return -min(u, on - u); }
  return min(u - on, cycle - u);
}

/// A band cut to an open run of the path: `along` is the distance outside
/// the run along the path. Caps: 0 butt, 1 round, 2 square.
fn edge_open_sd(band_sd: f32, along: f32, hw: f32, cap: i32) -> f32 {
  if (cap == 1) {
    if (along > 0.0) { return length(vec2<f32>(along, max(band_sd + hw, 0.0))) - hw; }
    return max(band_sd, along);
  }
  if (cap == 2) { return max(band_sd, along - hw); }
  return max(band_sd, along);
}

/// Coverage of a stroke whose signed distance was built for half-width
/// max(width, aa) / 2: lines thinner than a pixel keep a one pixel footprint
/// and fade by their width instead of breaking up.
fn edge_line_cov(sd: f32, width: f32, aa: f32) -> f32 {
  return edge_cov(sd, aa) * clamp(width / aa, 0.0, 1.0);
}

/// 1 - smoothstep(0, radius, dist) as the classic types use it, filtered
/// when the radius is below a pixel so it fades instead of aliasing.
fn edge_falloff(dist: f32, radius: f32, aa: f32) -> f32 {
  let r = max(radius, aa);
  return (1.0 - edge_smoothstep(0.0, r, dist)) * clamp(radius / aa, 0.0, 1.0);
}

/// Animated 0-1 progress for wipes and growth fills: 0 loop, 1 ping-pong,
/// 2 beat phase, 3 manual (the progress value itself).
fn edge_progress(t: f32, speed: f32, mode: i32, manual: f32) -> f32 {
  if (mode == 1) { return 1.0 - abs(fract(t * speed * 0.5) * 2.0 - 1.0); }
  if (mode == 2) { return fract(u.clock.x); }
  if (mode == 3) { return clamp(manual, 0.0, 1.0); }
  return fract(t * speed);
}

/// Coverage of the "on" half-period of a periodic coordinate (crisp stripes).
fn edge_stripe(x: f32, period: f32, duty: f32, aa: f32) -> f32 {
  return edge_cov(edge_periodic_out(x, period * duty, period), aa);
}

struct EdgeCtx {
  count: i32,
  total: f32,
  centroid: vec2<f32>,
  inradius: f32,
  corner_count: i32,
  diag_count: i32,
  aa: f32,
  res: vec2<f32>,
  seed: f32,
  bbox: vec4<f32>,
}

// ---------- classic strokes (px) ----------

fn edge_solid_stroke(sd: f32, color: vec4<f32>, width: f32, aa: f32) -> vec4<f32> {
  return vec4<f32>(color.rgb, color.a * edge_line_cov(sd, width, aa));
}

fn edge_glow_stroke(d: f32, core: f32, color: vec4<f32>, glow_size: f32, intensity: f32, pulse: f32, t: f32, aa: f32) -> vec4<f32> {
  let pulse_mod = select(1.0, 0.7 + 0.3 * sin(t * pulse * 3.0), pulse > 0.0);
  var glow = edge_falloff(abs(d), glow_size, aa);
  glow = pow(glow, 2.0) * intensity * pulse_mod;
  return vec4<f32>(color.rgb * (core + glow), max(core, glow * 0.8) * color.a);
}

fn edge_neon_stroke(d: f32, core: f32, color: vec4<f32>, width: f32, glow_size: f32, flicker: f32, t: f32, aa: f32) -> vec4<f32> {
  var flicker_mod = 1.0;
  if (flicker > 0.0) {
    flicker_mod = 0.85 + 0.15 * sin(t * flicker * 15.0);
    flicker_mod = flicker_mod * (0.9 + 0.1 * edge_random(vec2<f32>(floor(t * 8.0), 0.0)));
  }
  let inner = 1.0 - edge_smoothstep(0.0, 3.0, abs(d) - width * 0.5);
  var outer = edge_falloff(abs(d), glow_size, aa);
  outer = pow(outer, 1.5);
  var final_color = vec3<f32>(1.0) * core * 0.8 + color.rgb * inner + color.rgb * outer * 0.5;
  final_color = final_color * flicker_mod;
  return vec4<f32>(final_color, max(core, max(inner * 0.9, outer * 0.6)) * color.a);
}

fn edge_snake_stroke(d: f32, core: f32, color: vec4<f32>, width: f32, snake_len: f32, speed: f32, path_pos: f32, snake_count: i32, t: f32, rx: f32, aa: f32) -> vec4<f32> {
  var total_in_snake = 0.0;
  var total_fade = 0.0;
  var total_head_glow = 0.0;
  for (var s: i32 = 0; s < 8; s = s + 1) {
    if (s >= snake_count) { break; }
    let snake_offset = f32(s) / f32(snake_count);
    let head_pos = edge_mod(t * speed + snake_offset, 1.0);
    let dist_behind = edge_mod(head_pos - path_pos + 1.0, 1.0);
    let in_snake = edge_smoothstep(snake_len + 0.02, snake_len - 0.02, dist_behind);
    let fade = 1.0 - clamp(dist_behind / max(snake_len, 0.001), 0.0, 1.0);
    total_in_snake = max(total_in_snake, in_snake);
    total_fade = max(total_fade, fade * in_snake);
    let head_dist = abs(path_pos - head_pos);
    let head_dist_wrapped = min(head_dist, 1.0 - head_dist);
    total_head_glow = max(total_head_glow, exp(-head_dist_wrapped * 30.0));
  }
  let glow = edge_falloff(abs(d), width * 2.0 / rx, aa) * total_head_glow;
  let body = core * total_in_snake * max(total_fade, 0.1);
  return vec4<f32>(color.rgb * (body + glow), (body + glow * 0.5) * color.a);
}

fn edge_rainbow_stroke(d: f32, core: f32, width: f32, speed: f32, path_pos: f32, t: f32, rx: f32, aa: f32) -> vec4<f32> {
  let hue = edge_mod(path_pos * 2.0 + t * speed, 1.0);
  let rainbow = 0.5 + 0.5 * cos(EDGE_TAU * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  var glow = edge_falloff(abs(d), width * 1.5 / rx, aa);
  glow = pow(glow, 2.0) * 0.5;
  return vec4<f32>(rainbow * (core + glow), max(core, glow * 0.7));
}

fn edge_dashed_stroke(core: f32, color: vec4<f32>, dash_len: f32, gap_len: f32, path_pos: f32, speed: f32, t: f32) -> vec4<f32> {
  let cycle = dash_len + gap_len;
  let pos = edge_mod(path_pos + t * speed * 0.1, 1.0);
  let dash_phase = edge_mod(pos * 10.0, cycle);
  let dash = edge_smoothstep(0.0, 0.02, dash_phase) * (1.0 - edge_smoothstep(dash_len - 0.02, dash_len, dash_phase));
  return vec4<f32>(color.rgb * core * dash, color.a * core * dash);
}

/// The electric stroke's jittering white core, as analytic coverage.
fn edge_electric_core(d: f32, width: f32, arc_intensity: f32, speed: f32, path_pos: f32, time: f32, rx: f32, aa: f32) -> f32 {
  let t = time * speed;
  // Arc offsets were UV distances in the editor; px here.
  var jitter = sin(path_pos * 50.0 + t * 20.0) * arc_intensity * 0.003 * rx;
  jitter = jitter + sin(path_pos * 120.0 + t * 35.0) * arc_intensity * 0.002 * rx;
  return edge_line_cov(abs(d + jitter) - max(width * 0.6, aa) * 0.5, width * 0.6, aa);
}

fn edge_electric_stroke(d: f32, core: f32, color: vec4<f32>, width: f32, arc_intensity: f32, speed: f32, path_pos: f32, time: f32, rx: f32, aa: f32) -> vec4<f32> {
  let t = time * speed;
  let arc1_offset = sin(path_pos * 30.0 + t * 15.0) * arc_intensity * 0.008 * rx;
  let arc1 = 1.0 - edge_smoothstep(0.0, 3.0, abs(d + arc1_offset) - width * 0.15);
  let arc2_offset = cos(path_pos * 45.0 + t * 22.0) * arc_intensity * 0.006 * rx;
  let arc2 = 1.0 - edge_smoothstep(0.0, 3.0, abs(d + arc2_offset) - width * 0.1);
  let core_color = vec3<f32>(1.0) * core;
  let arc_color = color.rgb * (arc1 * 0.6 + arc2 * 0.4);
  var glow = edge_falloff(abs(d), width * 3.0 / rx, aa);
  glow = pow(glow, 2.5) * 0.4;
  let flicker = 0.85 + 0.15 * edge_random(vec2<f32>(floor(t * 12.0), path_pos * 5.0));
  let alpha = max(core, max(arc1 * 0.6, max(arc2 * 0.4, glow * 0.5)));
  return vec4<f32>((core_color + arc_color + color.rgb * glow) * flicker, alpha * color.a);
}

fn edge_strobe_stroke(d: f32, core: f32, color: vec4<f32>, width: f32, rate: f32, t: f32, rx: f32, aa: f32) -> vec4<f32> {
  let on = step(0.0, sin(t * rate * EDGE_TAU));
  var glow = edge_falloff(abs(d), width * 2.0 / rx, aa);
  glow = pow(glow, 1.5) * 0.8;
  return vec4<f32>(color.rgb * (core + glow) * on, max(core, glow * 0.7) * on * color.a);
}

fn edge_scanner_stroke(d: f32, core: f32, color: vec4<f32>, width: f32, beam_width: f32, speed: f32, path_pos: f32, trail: f32, t: f32, rx: f32, aa: f32) -> vec4<f32> {
  let scan_pos = edge_mod(t * speed * 0.2, 1.0);
  var dist = abs(path_pos - scan_pos);
  dist = min(dist, 1.0 - dist);
  var beam = 1.0 - edge_smoothstep(0.0, beam_width, dist);
  beam = pow(beam, 2.0);
  let trail_dist = edge_mod(scan_pos - path_pos + 1.0, 1.0);
  let trail_fade = (1.0 - edge_smoothstep(0.0, trail, trail_dist)) * 0.4;
  let intensity = max(beam, trail_fade);
  var glow = edge_falloff(abs(d), width * 2.0 / rx, aa);
  glow = pow(glow, 2.0) * beam * 0.6;
  return vec4<f32>(color.rgb * (core * intensity + glow), (core * intensity + glow * 0.5) * color.a);
}

fn edge_fire_stroke(d: f32, core: f32, color: vec4<f32>, width: f32, speed: f32, path_pos: f32, time: f32, rx: f32, aa: f32) -> vec4<f32> {
  let t = time * speed;
  var noise = sin(path_pos * 20.0 + t * 5.0) * 0.5 + 0.5;
  noise = noise * (sin(path_pos * 35.0 - t * 3.0) * 0.5 + 0.5);
  noise = noise + sin(path_pos * 8.0 + t * 7.0) * 0.3;
  var fire_color = mix(vec3<f32>(1.0, 0.2, 0.0), vec3<f32>(1.0, 0.9, 0.2), noise);
  fire_color = mix(fire_color, vec3<f32>(1.0), core * 0.5);
  let w_uv = width / rx;
  let flame_dist = abs(d) - width * (0.5 + noise * 0.8);
  var flame = edge_falloff(max(flame_dist, 0.0), w_uv * 2.0, aa);
  flame = flame * noise;
  let final_color = fire_color * core + vec3<f32>(1.0, 0.3, 0.0) * flame * 0.6;
  return vec4<f32>(final_color, max(core, flame * 0.5) * color.a);
}

// ---------- classic fills (uv = output UV, as the editor shader) ----------

fn edge_plasma_fill(inside: f32, p: vec2<f32>, speed: f32, scale: f32, complexity: f32, palette: i32, time: f32) -> vec4<f32> {
  if (inside < 0.01) { return vec4<f32>(0.0); }
  let t = time * speed;
  let s = scale;
  var plasma = 0.0;
  plasma = plasma + sin(p.x * s + t);
  plasma = plasma + sin(p.y * s + t * 1.2);
  plasma = plasma + sin((p.x + p.y) * s * 0.75 + t * 0.7);
  plasma = plasma + sin(length(p - vec2<f32>(0.5)) * s * 1.5 + t * 0.9);
  if (complexity > 2.0) {
    plasma = plasma + sin(p.x * s * 2.0 - p.y * s * 1.5 + t * 1.5) * 0.5;
    plasma = plasma + sin(length(p - vec2<f32>(0.3, 0.7)) * s * 2.0 + t * 1.1) * 0.4;
  }
  if (complexity > 4.0) {
    plasma = plasma + sin((p.x * p.y) * s * 3.0 + t * 2.0) * 0.3;
    plasma = plasma + cos(p.x * s * 3.0 + sin(p.y * s * 2.0 + t)) * 0.25;
  }
  let total_weight = 4.0 + select(0.0, 0.9, complexity > 2.0) + select(0.0, 0.55, complexity > 4.0);
  plasma = plasma / total_weight + 0.5;
  var color: vec3<f32>;
  if (palette == 1) {
    color = mix(vec3<f32>(0.1, 0.0, 0.0), vec3<f32>(1.0, 0.9, 0.2), plasma);
    color = mix(color, vec3<f32>(1.0, 0.3, 0.0), sin(plasma * EDGE_PI) * 0.5 + 0.5);
  } else if (palette == 2) {
    color = mix(vec3<f32>(0.0, 0.05, 0.2), vec3<f32>(0.0, 0.8, 1.0), plasma);
    color = mix(color, vec3<f32>(0.2, 0.4, 0.8), sin(plasma * EDGE_PI * 2.0) * 0.3 + 0.5);
  } else if (palette == 3) {
    color = 0.5 + 0.5 * cos(EDGE_TAU * (plasma * 2.0 + vec3<f32>(0.0, 0.15, 0.4)));
    color = pow(color, vec3<f32>(0.8));
  } else {
    color = 0.5 + 0.5 * cos(EDGE_TAU * (plasma + vec3<f32>(0.0, 0.33, 0.67)));
  }
  return vec4<f32>(color, inside);
}

fn edge_liquid_fill(inside: f32, p: vec2<f32>, base_color: vec4<f32>, speed: f32, viscosity: f32, turbulence: f32, metallic: f32, time: f32) -> vec4<f32> {
  if (inside < 0.01) { return vec4<f32>(0.0); }
  let t = time * speed;
  let dist_amt = 0.05 * (1.0 - viscosity * 0.8);
  let distort1 = sin(p.x * 15.0 + t) * cos(p.y * 12.0 + t * 0.8) * dist_amt;
  let distort2 = cos(p.x * 10.0 - t * 0.6) * sin(p.y * 18.0 + t * 1.2) * dist_amt * turbulence;
  let dp = p + vec2<f32>(distort1, distort2);
  var noise = sin(dp.x * 25.0 + t) * sin(dp.y * 25.0 - t) * 0.5 + 0.5;
  if (turbulence > 0.3) {
    noise = noise + sin(dp.x * 50.0 - t * 1.5) * sin(dp.y * 40.0 + t * 1.3) * 0.2 * turbulence;
  }
  if (turbulence > 0.6) {
    noise = noise + sin(dp.x * 80.0 + t * 2.0) * cos(dp.y * 70.0 - t * 1.8) * 0.1 * turbulence;
  }
  noise = clamp(noise, 0.0, 1.0);
  var color = base_color.rgb * (0.6 + noise * 0.6);
  let deep_color = base_color.rgb * vec3<f32>(0.6, 0.8, 1.2);
  color = mix(deep_color, color, noise);
  let highlight = pow(noise, 3.0 + (1.0 - metallic) * 3.0) * metallic;
  let sheen = pow(max(0.0, sin(dp.x * 40.0 + t * 2.0) * cos(dp.y * 35.0 - t * 1.5)), 8.0) * metallic * 0.4;
  color = color + vec3<f32>(highlight + sheen);
  return vec4<f32>(color, base_color.a * inside);
}

fn edge_fire_fill(inside: f32, p: vec2<f32>, speed: f32, intensity: f32, turbulence: f32, palette: i32, time: f32) -> vec4<f32> {
  if (inside < 0.01) { return vec4<f32>(0.0); }
  let t = time * speed;
  var fire = 0.0;
  fire = fire + sin(p.x * 8.0 + t * 3.0) * 0.5;
  fire = fire + sin(p.y * 6.0 - t * 2.5) * 0.5;
  fire = fire + sin((p.x + p.y) * 5.0 + t * 4.0) * 0.3;
  if (turbulence > 0.3) {
    fire = fire + sin(p.x * 16.0 - t * 5.0) * sin(p.y * 14.0 + t * 3.5) * turbulence * 0.4;
  }
  if (turbulence > 0.6) {
    fire = fire + sin(p.x * 30.0 + t * 8.0) * cos(p.y * 25.0 - t * 6.0) * turbulence * 0.2;
  }
  fire = fire * 0.5 + 0.5;
  var dark_color = vec3<f32>(1.0, 0.2, 0.0);
  var bright_color = vec3<f32>(1.0, 0.9, 0.2);
  var mid_color = vec3<f32>(1.0, 0.5, 0.1);
  if (palette == 1) {
    dark_color = vec3<f32>(0.0, 0.0, 0.4);
    bright_color = vec3<f32>(0.4, 0.7, 1.0);
    mid_color = vec3<f32>(0.1, 0.3, 0.9);
  } else if (palette == 2) {
    dark_color = vec3<f32>(0.0, 0.2, 0.0);
    bright_color = vec3<f32>(0.5, 1.0, 0.3);
    mid_color = vec3<f32>(0.1, 0.7, 0.2);
  } else if (palette == 3) {
    dark_color = vec3<f32>(0.2, 0.0, 0.3);
    bright_color = vec3<f32>(1.0, 0.5, 1.0);
    mid_color = vec3<f32>(0.5, 0.1, 0.8);
  }
  var color = mix(dark_color, bright_color, pow(fire, 1.5));
  color = mix(color, mid_color, fire * 0.4);
  color = color * intensity;
  return vec4<f32>(color, inside);
}

fn edge_electric_fill(inside: f32, p: vec2<f32>, color: vec4<f32>, speed: f32, intensity: f32, arc_count: f32, time: f32) -> vec4<f32> {
  if (inside < 0.01) { return vec4<f32>(0.0); }
  let t = time * speed;
  let freq_mult = arc_count * 6.0;
  var arc = 0.0;
  arc = arc + sin(p.x * freq_mult + t * 8.0) * sin(p.y * freq_mult * 0.83 - t * 6.0);
  arc = arc + sin((p.x - p.y) * freq_mult * 1.33 + t * 12.0) * 0.5;
  arc = arc + sin(length(p - vec2<f32>(0.5)) * freq_mult * 0.67 + t * 10.0) * 0.3;
  arc = pow(abs(arc), 0.3);
  let bolt = step(1.0 - intensity * 0.25, arc);
  let glow = pow(arc, 3.0 - intensity * 0.5);
  var final_color = color.rgb * (glow * 0.4 * intensity + bolt * 1.5);
  final_color = final_color + vec3<f32>(0.8, 0.9, 1.0) * bolt * 0.5 * intensity;
  let flash = step(0.97 - intensity * 0.05, edge_random(vec2<f32>(floor(t * (4.0 + intensity * 4.0)), 0.0)));
  final_color = final_color + color.rgb * flash * 0.3 * intensity;
  final_color = final_color + color.rgb * (glow * 0.15 * intensity);
  return vec4<f32>(final_color, inside * max(glow * 0.5, bolt));
}

fn edge_holographic_fill(inside: f32, d: f32, p: vec2<f32>, speed: f32, shift: f32, scanlines: f32, flicker_amt: f32, time: f32, rx: f32) -> vec4<f32> {
  if (inside < 0.01) { return vec4<f32>(0.0); }
  let t = time * speed;
  let angle = atan2(p.y - 0.5, p.x - 0.5);
  let hue = edge_mod(angle / EDGE_TAU + t * 0.1 + shift, 1.0);
  let rainbow = 0.5 + 0.5 * cos(EDGE_TAU * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let fresnel = exp(-abs(d) / (0.05 * rx) * 2.0);
  var scan = 1.0;
  if (scanlines > 0.1) {
    scan = sin(p.y * scanlines * 100.0 + t * 2.0) * 0.5 + 0.5;
    scan = mix(0.7, 1.0, scan);
  }
  var flicker = 1.0;
  if (flicker_amt > 0.01) {
    flicker = 1.0 - flicker_amt * 0.15;
    flicker = flicker + flicker_amt * 0.15 * sin(t * 15.0);
    flicker = flicker * (1.0 - flicker_amt * 0.1 * step(0.95, edge_random(vec2<f32>(floor(t * 8.0), 0.0))));
  }
  return vec4<f32>(rainbow * scan * flicker * (0.5 + fresnel * 0.5), inside * 0.8);
}

fn edge_noise_fill(inside: f32, p: vec2<f32>, color: vec4<f32>, speed: f32, scale: f32, turbulence: f32, color2: vec4<f32>, time: f32) -> vec4<f32> {
  if (inside < 0.01) { return vec4<f32>(0.0); }
  let t = time * speed;
  var n = 0.0;
  var amp = 1.0;
  var freq = scale;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    n = n + amp * (sin(p.x * freq + t + f32(i)) * cos(p.y * freq * 1.3 - t * 0.7 + f32(i) * 2.0));
    amp = amp * 0.5;
    freq = freq * (2.0 + turbulence);
  }
  n = n * 0.5 + 0.5;
  return vec4<f32>(mix(color2.rgb, color.rgb, n), inside * color.a);
}

fn edge_gradient_fill(inside: f32, p: vec2<f32>, px: vec2<f32>, color: vec4<f32>, color2: vec4<f32>, angle: f32, speed: f32, grad_type: i32, time: f32) -> vec4<f32> {
  if (inside < 0.01) { return vec4<f32>(0.0); }
  var t: f32;
  if (grad_type == 1) {
    t = fract(clamp(length(p - vec2<f32>(0.5)) * 2.0 + time * speed * 0.1, 0.0, 1.0));
  } else if (grad_type == 2) {
    let a = atan2(p.y - 0.5, p.x - 0.5);
    t = edge_mod(a / EDGE_TAU + 0.5 + time * speed * 0.1, 1.0);
  } else if (grad_type == 3) {
    // Diamond: the L1 distance from the centre.
    t = fract(clamp((abs(p.x - 0.5) + abs(p.y - 0.5)) * 2.0 + time * speed * 0.1, 0.0, 1.0));
  } else {
    let a = angle + time * speed * 0.5;
    t = clamp(dot(p - vec2<f32>(0.5), vec2<f32>(cos(a), sin(a))) + 0.5, 0.0, 1.0);
  }
  // Half an 8-bit step of dither keeps long ramps from banding.
  let dither = (edge_hash2(px.x, px.y + 17.0) - 0.5) / 255.0;
  return vec4<f32>(mix(color.rgb, color2.rgb, t) + vec3<f32>(dither), inside * mix(color.a, color2.a, t));
}

// ---------- new fills ----------

/// Extent of `bbox` (px) projected on `dir`: (min, max).
fn edge_extent(bbox: vec4<f32>, dir: vec2<f32>) -> vec2<f32> {
  let a = dot(bbox.xy, dir);
  let b = dot(vec2<f32>(bbox.z, bbox.y), dir);
  let c = dot(bbox.zw, dir);
  let d = dot(vec2<f32>(bbox.x, bbox.w), dir);
  return vec2<f32>(min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
}

fn edge_far_corner(bbox: vec4<f32>, origin: vec2<f32>) -> f32 {
  return max(max(length(bbox.xy - origin), length(bbox.zw - origin)),
    max(length(vec2<f32>(bbox.z, bbox.y) - origin), length(vec2<f32>(bbox.x, bbox.w) - origin)));
}

/// Crisp pattern lines: 0 dots, 1 lines (hatch), 2 grid, 3 crosshatch,
/// 4 chevron, 5 hexagon. Returns the pattern's coverage.
fn edge_pattern(q: vec2<f32>, kind: i32, scale: f32, line_w: f32, aa: f32) -> f32 {
  let s = max(scale, 1.0);
  let hw = max(line_w, aa) * 0.5;
  let fade = clamp(line_w / aa, 0.0, 1.0);
  if (kind == 0) {
    let cell = q - s * (floor(q / s) + vec2<f32>(0.5));
    return edge_cov(length(cell) - max(line_w, aa) * 0.5 * 2.0, aa) * fade;
  }
  let fx = abs(q.x - s * round(q.x / s));
  let fy = abs(q.y - s * round(q.y / s));
  if (kind == 1) { return edge_cov(fx - hw, aa) * fade; }
  if (kind == 2) { return edge_cov(min(fx, fy) - hw, aa) * fade; }
  if (kind == 3) {
    let r = vec2<f32>(q.x + q.y, q.x - q.y) * 0.70710678;
    let gx = abs(r.x - s * round(r.x / s));
    let gy = abs(r.y - s * round(r.y / s));
    return edge_cov(min(gx, gy) - hw, aa) * fade;
  }
  if (kind == 4) {
    let y = q.y + abs(edge_mod(q.x, s) - s * 0.5);
    let g = abs(y - s * round(y / s));
    return edge_cov(g * 0.70710678 - hw, aa) * fade;
  }
  // Hexagon edges: distance to the nearest hexagon cell border.
  let r = vec2<f32>(1.0, 1.7320508) * s;
  let h = r * 0.5;
  let a = q - r * floor(q / r) - h;
  let b = (q - h) - r * floor((q - h) / r) - h;
  let g = select(b, a, dot(a, a) < dot(b, b));
  let ag = abs(g);
  let hex = max(dot(ag, normalize(vec2<f32>(1.0, 1.7320508))), ag.x);
  return edge_cov(abs(hex - s * 0.5) - hw, aa) * fade;
}

// ---------- one edge effect ----------

fn edge_fx(li: u32, e: i32, k: i32) -> vec4<f32> {
  return layers[li].edge_effects[e][k];
}

/// One edge effect at output pixel `p`, as premultiplied colour.
fn edge_effect_fragment(li: u32, e: i32, p: vec2<f32>, base: EdgeHit, ctx: EdgeCtx) -> vec4<f32> {
  let v0 = edge_fx(li, e, 0);
  let stroke_color_u = edge_fx(li, e, 1);
  let sw = edge_fx(li, e, 2);
  let s3 = edge_fx(li, e, 3);
  let s4 = edge_fx(li, e, 4);
  let f5 = edge_fx(li, e, 5);
  let fill_color_u = edge_fx(li, e, 6);
  let fill_color2_u = edge_fx(li, e, 7);
  let fa = edge_fx(li, e, 8);
  let an = edge_fx(li, e, 9);
  let ap = edge_fx(li, e, 10);
  let sb = edge_fx(li, e, 11);
  let fb = edge_fx(li, e, 12);
  let geo = edge_fx(li, e, 13);
  let trim = edge_fx(li, e, 14);
  let misc = edge_fx(li, e, 15);
  let cen = edge_fx(li, e, 16);
  let dash = edge_fx(li, e, 17);
  let gbox = edge_fx(li, e, 18);
  let stroke_type = i32(floor(v0.w + 0.5));
  let fill_type = i32(floor(f5.y + 0.5));
  let anim_type = i32(floor(an.x + 0.5));
  let res = ctx.res;
  let rx = res.x;
  let total = ctx.total;
  let t = u.time - misc.y;
  let center = select(ctx.centroid, cen.xy, misc.w > 0.5);
  let anim_count = an.y;
  let anim_spacing = an.z;
  let anim_speed = an.w;

  // Transform animations move the query point: q is where p lands on the
  // shape, k how much the transform magnifies it (distances scale by k).
  var q = p;
  var k = 1.0;
  var visible = 1.0;
  if (anim_type == 4) {
    let angle = t * ap.x;
    if (angle != 0.0) { q = center + edge_rotate(p - center, angle); }
  } else if (anim_type == 8 || anim_type == 9) {
    // Card flip about the shape's X (8) or Y (9) axis, with perspective.
    let theta = t * anim_speed * EDGE_TAU;
    // Perspective 1 puts the eye 2.5 shape radii away (the near edge grows
    // at most 1.7x); 0 is a flat projection.
    let persp = clamp(ap.x, 0.0, 1.0);
    let extent = max(max(ctx.bbox.z - ctx.bbox.x, ctx.bbox.w - ctx.bbox.y) * 0.5, 8.0);
    let focal = select(1.0e7, extent * 2.5 / persp, persp > 0.001);
    let rel = p - center;
    let along = select(rel.x, rel.y, anim_type == 8);
    let across = select(rel.y, rel.x, anim_type == 8);
    let c = cos(theta);
    let s = sin(theta);
    let denom = focal * c - along * s;
    if (abs(denom) < 1e-3 || abs(c) < 1e-3) {
      visible = 0.0;
    } else {
      let a_plane = along * focal / denom;
      let depth = focal + a_plane * s;
      if (depth <= 0.0) { visible = 0.0; }
      let x_plane = across * depth / focal;
      q = center + select(vec2<f32>(a_plane, x_plane), vec2<f32>(x_plane, a_plane), anim_type == 8);
      k = sqrt(abs(focal * focal * c / (depth * depth) * focal / depth));
    }
  } else if (anim_type == 10) {
    let tau = fract(t * anim_speed);
    let bounciness = max(ap.y, 1.0);
    let sc = max(1.0 - ap.x * exp(-5.0 * tau) * cos(tau * bounciness * EDGE_TAU), 0.05);
    q = center + (p - center) / sc;
    k = sc;
  } else if (anim_type == 11) {
    let a = t * anim_speed * EDGE_TAU;
    q = p - ap.x * vec2<f32>(cos(a), sin(a));
  } else if (anim_type == 12) {
    q = p - vec2<f32>(0.0, ap.x * abs(sin(t * anim_speed * EDGE_PI)));
  } else if (anim_type == 13) {
    let n = t * anim_speed * 8.0;
    q = p - ap.x * vec2<f32>(edge_value_noise(n, 11.0 + ctx.seed), edge_value_noise(n, 37.0 + ctx.seed));
  }
  if (visible < 0.5) { return vec4<f32>(0.0); }
  var hit = base;
  if (any(q != p)) {
    // A moved shape draws nothing where the moved point is beyond its box
    // plus the effect's reach: skip the distance field there.
    let reach = edge_fx(li, e, 20).z / max(k, 0.05);
    if (any(q < ctx.bbox.xy - vec2<f32>(reach)) || any(q > ctx.bbox.zw + vec2<f32>(reach))) {
      return vec4<f32>(0.0);
    }
    hit = edge_hit(li, q, ctx.count);
  }
  let aa = ctx.aa / max(k, 0.05);
  let fill_px = select(p, q, anim_type >= 8);
  let uv = fill_px / res;
  let d = hit.d;
  let s_arc = hit.s;
  let path_pos = s_arc / total;
  let inside = edge_cov(d, aa);

  // Stroke geometry shared by the core band of every stroke type.
  let width = sw.x * select(1.0, hit.scale, geo.w > 0.5);
  let hw = max(width, aa) * 0.5;
  let cap = i32(floor(geo.x + 0.5));
  let join = i32(floor(geo.y + 0.5));
  let band = edge_band_sd(li, q, hit, hw, join, max(geo.z, 1.0), ctx.count);

  // Trim path: the stroke only shows between start and end (fractions of the
  // perimeter), shifted by offset and optionally animated.
  var trim_on = false;
  var trim_along = -1.0e6;
  let trim_mode = i32(floor(trim.w + 0.5));
  if (trim_mode > 0 || trim.x > 0.0 || trim.y < 1.0) {
    trim_on = true;
    var t0 = trim.x;
    var t1 = trim.y;
    let prog = fract(t * misc.x);
    if (trim_mode == 1) { t1 = t0 + (t1 - t0) * prog; }
    else if (trim_mode == 2) { t0 = t0 + (t1 - t0) * prog; }
    else if (trim_mode == 3) { t1 = t0 + (t1 - t0) * (1.0 - abs(prog * 2.0 - 1.0)); }
    trim_along = edge_interval_out(s_arc, (t0 + trim.z) * total, (t1 - t0) * total, total);
  }
  // Classic types take the plain band and are trimmed by a mask afterwards;
  // solid and the new types cut the band itself, so the trim gets real caps.
  let core = edge_line_cov(band, width, aa);
  let core_sd = select(band, edge_open_sd(band, trim_along, hw, cap), trim_on);
  let stroke_speed = s3.y;

  // Fill and stroke are evaluated at full coverage (fill_color, and the
  // stroke with its core off and on: stroke0, stroke1); their analytic
  // coverages (fill_w, stroke_w) are applied at the end, linearly.
  var fill_color = vec4<f32>(0.0);
  var fill_w = inside;
  var stroke0 = vec4<f32>(0.0);
  var stroke1 = vec4<f32>(0.0);
  var stroke_w = 0.0;
  var stroke_has_trim = false;

  // ----- fill -----
  let fill_speed = f5.z;
  let prog_mode = i32(floor(cen.z + 0.5));
  if (inside <= 0.0) {
    // Nothing of the fill reaches this pixel.
  } else if (fill_type == 1) {
    fill_color = fill_color_u;
  } else if (fill_type == 2) {
    fill_color = edge_plasma_fill(1.0, uv, fill_speed, fa.x, fa.y, i32(floor(fa.z + 0.5)), t);
  } else if (fill_type == 3) {
    fill_color = edge_liquid_fill(1.0, uv, fill_color_u, fill_speed, fa.x, fa.y, fa.z, t);
  } else if (fill_type == 4) {
    fill_color = edge_fire_fill(1.0, uv, fill_speed, fa.x, fa.y, i32(floor(fa.z + 0.5)), t);
  } else if (fill_type == 5) {
    fill_color = edge_electric_fill(1.0, uv, fill_color_u, fill_speed, fa.x, fa.y, t);
  } else if (fill_type == 6) {
    fill_color = edge_holographic_fill(1.0, d, uv, fill_speed, fa.x, fa.y, fa.z, t, rx);
  } else if (fill_type == 7) {
    fill_color = edge_noise_fill(1.0, uv, fill_color_u, fill_speed, fa.x, fa.y, fill_color2_u, t);
  } else if (fill_type == 8) {
    fill_color = edge_gradient_fill(1.0, uv, fill_px, fill_color_u, fill_color2_u, fa.x, fill_speed, i32(floor(f5.w + 0.5)), t);
  } else if (fill_type >= 9) {
    let prog = edge_progress(t, fill_speed, prog_mode, cen.w);
    var region = d;           // signed distance of the lit region
    var c1 = fill_color_u;
    var mixv = 0.0;           // 0 = colour 1, 1 = colour 2 (patterns)
    if (fill_type == 9) {
      var index = 0.0;
      // New colour each beat of the beat clock, delayed by the group chase.
      if (fa.z > 0.5) { index = floor(u.clock.x - misc.y * u.clock.y / 60.0); }
      let hue = edge_hash2(ctx.seed * 7.0 + index, 3.0 + f32(e));
      c1 = vec4<f32>(edge_hsv(hue, clamp(fa.x, 0.0, 1.0), clamp(fa.y, 0.0, 1.0)), fill_color_u.a);
    } else if (fill_type == 10) {
      region = max(d, -d - prog * ctx.inradius);
    } else if (fill_type == 11) {
      region = (1.0 - prog) * ctx.inradius + d;
    } else if (fill_type == 12) {
      let ci = clamp(i32(floor(fa.x + 0.5)), 0, max(ctx.corner_count - 1, 0));
      let corner = select(center, layers[li].edge_corners[ci].xy, ctx.corner_count > 0);
      region = max(d, length(fill_px - corner) - prog * edge_far_corner(ctx.bbox, corner));
    } else if (fill_type == 13 || fill_type == 14) {
      let dir = vec2<f32>(cos(fa.x), sin(fa.x));
      let ext = edge_extent(select(ctx.bbox, gbox, fill_type == 14), dir);
      let soft = max(fa.y, 0.0);
      let along = dot(fill_px, dir) - (ext.x + prog * (ext.y - ext.x + soft));
      if (soft > 0.5) {
        c1 = vec4<f32>(fill_color_u.rgb, fill_color_u.a * (1.0 - edge_smoothstep(-soft, 0.0, along)));
      } else {
        region = max(d, along);
      }
    } else if (fill_type == 15) {
      let steps = max(floor(fa.x + 0.5), 1.0);
      let dir = vec2<f32>(cos(fa.y), sin(fa.y));
      let ext = edge_extent(ctx.bbox, dir);
      let span = max(ext.y - ext.x, 1.0);
      let x = dot(fill_px, dir) - ext.x;
      let lit = floor(prog * (steps + 1.0));
      region = max(d, x - lit * span / steps);
      let band_i = floor(x / (span / steps));
      c1 = vec4<f32>(fill_color_u.rgb * (0.55 + 0.45 * (band_i + 1.0) / steps), fill_color_u.a);
    } else if (fill_type == 16) {
      let period = max(fa.x, 1.0);
      mixv = 1.0 - edge_stripe(-d - t * fill_speed * period, period, 0.5, aa);
    } else if (fill_type == 17 || fill_type == 18) {
      let dir = vec2<f32>(-sin(fa.x), cos(fa.x));
      let period = max(fa.y, 0.5) * 2.0;
      mixv = 1.0 - edge_stripe(dot(fill_px, dir) + t * fill_speed * period, period, 0.5, aa);
      if (fill_type == 18) {
        let dir2 = vec2<f32>(sin(fa.x), cos(fa.x));
        let second = edge_stripe(dot(fill_px, dir2) - t * fill_speed * period, period, 0.5, aa);
        mixv = 1.0 - max(1.0 - mixv, second);
      }
    } else if (fill_type == 19) {
      let cell = max(fa.x, 2.0);
      let id = floor(fill_px / cell);
      let on = step(edge_hash2(id.x + ctx.seed * 13.0, id.y), prog);
      mixv = 1.0 - on;
    } else if (fill_type == 20) {
      let radius = max(fa.x, 0.01) * max(ctx.inradius, 1.0);
      let pulse = select(1.0, 0.8 + 0.2 * sin(t * fa.z * EDGE_TAU), fa.z > 0.0);
      let glow = clamp(fa.y * pulse * exp(-length(fill_px - center) / radius * 2.0), 0.0, 1.5);
      c1 = vec4<f32>(fill_color_u.rgb * glow, fill_color_u.a * clamp(glow, 0.0, 1.0));
    } else if (fill_type == 21) {
      // Origami: fan facets from the centre to each corner, each folding.
      let rel = fill_px - center;
      let ang = atan2(rel.y, rel.x);
      var facet = 0.0;
      let n = max(ctx.corner_count, 0);
      if (n >= 3) {
        var best = 1.0e9;
        for (var i: i32 = 0; i < 64; i = i + 1) {
          if (i >= n) { break; }
          let ca = layers[li].edge_corners[i].xy - center;
          let da = edge_mod(ang - atan2(ca.y, ca.x), EDGE_TAU);
          if (da < best) { best = da; facet = f32(i); }
        }
      } else {
        facet = floor(edge_mod(ang, EDGE_TAU) / (EDGE_TAU / 8.0));
      }
      let fold = 0.5 + 0.5 * sin(t * fill_speed * EDGE_TAU + facet * 1.7);
      let depth = clamp(-d / max(ctx.inradius, 1.0), 0.0, 1.0);
      let shade = mix(1.0, 0.35 + 0.65 * fold, clamp(fa.x, 0.0, 1.0)) * mix(0.8, 1.05, depth);
      c1 = vec4<f32>(fill_color_u.rgb * shade, fill_color_u.a);
    } else if (fill_type == 22) {
      let cell = max(fa.x, 2.0);
      let r = edge_rotate(fill_px - center, fa.y);
      let id = floor(r / cell);
      let cc = (id + vec2<f32>(0.5)) * cell;
      var value = 0.0;
      if (fa.z > 0.5) {
        value = clamp(u.audio0.x * 2.0, 0.0, 1.0);
      } else {
        let span = max(ctx.bbox.z - ctx.bbox.x, ctx.bbox.w - ctx.bbox.y);
        value = 1.0 - abs(fract(cc.x / max(span, 1.0) + t * fill_speed * 0.25) * 2.0 - 1.0);
      }
      let radius = cell * 0.5 * sqrt(value) * 1.414;
      mixv = 1.0 - edge_cov(length(r - cc) - radius, aa);
    } else if (fill_type == 23) {
      let r = edge_rotate(fill_px - center, fa.z + t * fill_speed);
      mixv = 1.0 - edge_pattern(r, i32(floor(fa.x + 0.5)), fa.y, fa.w, aa);
    } else if (fill_type == 24) {
      region = max(d, length(fill_px - center) - prog * edge_far_corner(ctx.bbox, center));
    } else if (fill_type == 25) {
      let rel = fill_px - center;
      // Clockwise from twelve o'clock.
      let ang = edge_mod(EDGE_PI * 0.5 - atan2(rel.y, rel.x), EDGE_TAU);
      let sweep = prog * EDGE_TAU;
      let r = length(rel);
      // Arc distance to the nearer boundary ray of the swept wedge.
      var wedge = select(min(ang - sweep, EDGE_TAU - ang), -min(ang, sweep - ang), ang < sweep) * r;
      if (sweep >= EDGE_TAU - 1e-4) { wedge = -1.0e6; }
      region = max(d, wedge);
    } else if (fill_type == 26) {
      let dir = vec2<f32>(cos(fa.y), sin(fa.y));
      let ext = edge_extent(ctx.bbox, dir);
      let pos = ext.x + prog * (ext.y - ext.x);
      region = max(d, abs(dot(fill_px, dir) - pos) - max(fa.x, aa) * 0.5);
      c1 = vec4<f32>(fill_color_u.rgb, fill_color_u.a * clamp(fa.x / aa, 0.0, 1.0));
    }
    // `region` starts as the shape itself; wipes and growth fills cut it.
    let col = mix(c1, fill_color2_u, mixv);
    fill_color = col;
    fill_w = edge_cov(region, aa);
  }

  // ----- stroke -----
  if (stroke_type == 1) {
    stroke1 = stroke_color_u;
    stroke_w = edge_line_cov(core_sd, width, aa);
    stroke_has_trim = true;
  } else if (stroke_type == 2) {
    stroke1 = edge_glow_stroke(d, 1.0, stroke_color_u, sw.y, sw.z, sw.w, t, aa);
    stroke0 = edge_glow_stroke(d, 0.0, stroke_color_u, sw.y, sw.z, sw.w, t, aa);
    stroke_w = core;
  } else if (stroke_type == 3) {
    let nhw = max(width * 0.6, aa) * 0.5;
    stroke_w = edge_line_cov(edge_band_sd(li, q, hit, nhw, join, max(geo.z, 1.0), ctx.count), width * 0.6, aa);
    stroke1 = edge_neon_stroke(d, 1.0, stroke_color_u, width, sw.y, sw.w, t, aa);
    stroke0 = edge_neon_stroke(d, 0.0, stroke_color_u, width, sw.y, sw.w, t, aa);
  } else if (stroke_type == 4) {
    stroke1 = edge_snake_stroke(d, 1.0, stroke_color_u, width, s3.x, stroke_speed, path_pos, i32(s3.z), t, rx, aa);
    stroke0 = edge_snake_stroke(d, 0.0, stroke_color_u, width, s3.x, stroke_speed, path_pos, i32(s3.z), t, rx, aa);
    stroke_w = core;
  } else if (stroke_type == 5) {
    stroke1 = edge_rainbow_stroke(d, 1.0, width, stroke_speed, path_pos, t, rx, aa);
    stroke0 = edge_rainbow_stroke(d, 0.0, width, stroke_speed, path_pos, t, rx, aa);
    stroke_w = core;
  } else if (stroke_type == 6) {
    stroke1 = edge_dashed_stroke(1.0, stroke_color_u, s3.w, s4.x, path_pos, stroke_speed, t);
    stroke_w = core;
  } else if (stroke_type == 7) {
    stroke_w = edge_electric_core(d, width, s4.y, stroke_speed, path_pos, t, rx, aa);
    stroke1 = edge_electric_stroke(d, 1.0, stroke_color_u, width, s4.y, stroke_speed, path_pos, t, rx, aa);
    stroke0 = edge_electric_stroke(d, 0.0, stroke_color_u, width, s4.y, stroke_speed, path_pos, t, rx, aa);
  } else if (stroke_type == 8) {
    stroke1 = edge_strobe_stroke(d, 1.0, stroke_color_u, width, f5.x, t, rx, aa);
    stroke0 = edge_strobe_stroke(d, 0.0, stroke_color_u, width, f5.x, t, rx, aa);
    stroke_w = core;
  } else if (stroke_type == 9) {
    stroke1 = edge_scanner_stroke(d, 1.0, stroke_color_u, width, s4.z, stroke_speed, path_pos, s4.w, t, rx, aa);
    stroke0 = edge_scanner_stroke(d, 0.0, stroke_color_u, width, s4.z, stroke_speed, path_pos, s4.w, t, rx, aa);
    stroke_w = core;
  } else if (stroke_type == 10) {
    stroke1 = edge_fire_stroke(d, 1.0, stroke_color_u, width, stroke_speed, path_pos, t, rx, aa);
    stroke0 = edge_fire_stroke(d, 0.0, stroke_color_u, width, stroke_speed, path_pos, t, rx, aa);
    stroke_w = core;
  } else if (stroke_type >= 11) {
    var sd = core_sd;
    var alpha_scale = 1.0;
    var add_rgb = vec3<f32>(0.0);
    var add_a = 0.0;
    if (stroke_type == 11 || stroke_type == 12) {
      // Half / Quarter: lit runs of the border that travel round it.
      let o = fract(t * stroke_speed) * total;
      var along = edge_interval_out(s_arc, o, total * 0.5, total);
      if (stroke_type == 12) {
        along = min(edge_interval_out(s_arc, o, total * 0.25, total), edge_interval_out(s_arc, o + total * 0.5, total * 0.25, total));
      }
      sd = edge_open_sd(core_sd, along, hw, cap);
    } else if (stroke_type == 13) {
      // Line: a run of `length` travelling the border (normal, boomerang
      // back and forth, or yoyo growing and shrinking).
      let len = clamp(sb.x, 0.0, 1.0) * total;
      let mode = i32(floor(sb.y + 0.5));
      var head = fract(t * stroke_speed) * total;
      var run = len;
      if (mode == 1) {
        head = (1.0 - abs(fract(t * stroke_speed * 0.5) * 2.0 - 1.0)) * total;
      } else if (mode == 2) {
        run = len * (1.0 - abs(fract(t * stroke_speed) * 2.0 - 1.0));
        head = fract(t * stroke_speed * 0.25) * total + run;
      }
      sd = edge_open_sd(core_sd, edge_interval_out(s_arc, head - run, run, total), hw, cap);
    } else if (stroke_type == 14) {
      // Comet: a crisp head dot and a tail fading analytically behind it.
      let head = fract(t * stroke_speed) * total;
      let tail = max(clamp(sb.x, 0.0, 1.0) * total, 1.0);
      let behind = edge_mod(head - s_arc, total);
      sd = edge_open_sd(core_sd, edge_interval_out(s_arc, head - tail, tail, total), hw, 1);
      alpha_scale = select(0.0, exp(-3.0 * behind / tail), behind <= tail);
      let head_p = edge_point_at(li, head, ctx.count, total);
      let head_r = max(width * max(sb.y, 1.0), aa) * 0.5;
      add_a = edge_cov(length(q - head_p) - head_r, aa);
    } else if (stroke_type == 15 || stroke_type == 16) {
      // Dash pattern / marching ants: dashes measured in path pixels, the
      // pattern fitted to a whole number of repeats round the closed path.
      var d1 = max(dash.x, 0.0);
      var g1 = max(dash.y, 0.0);
      var d2 = max(dash.z, 0.0);
      var g2 = max(dash.w, 0.0);
      if (stroke_type == 16) { d2 = 0.0; g2 = 0.0; }
      let cycle = max(d1 + g1 + d2 + g2, 1.0);
      let repeats = max(round(total / cycle), 1.0);
      let fit = total / (repeats * cycle);
      var offset = t * stroke_speed;
      if (stroke_type == 16 && sb.x > 0.5) {
        // One full dash cycle per beat, locked to the beat phase.
        offset = fract(u.clock.x) * cycle * fit;
      }
      let uu = s_arc - offset;
      var along = edge_periodic_out(uu, d1 * fit, cycle * fit);
      if (d2 > 0.0) {
        along = min(along, edge_periodic_out(uu - (d1 + g1) * fit, d2 * fit, cycle * fit));
      }
      sd = edge_open_sd(core_sd, along, hw, cap);
    } else if (stroke_type == 17) {
      // Offset outlines: parallel copies at a fixed pixel spacing, inset,
      // outset or both, drifting outward at `speed` px/s.
      let count = max(floor(sb.x + 0.5), 1.0);
      let spacing = max(sb.y, 1.0);
      let direction = i32(floor(sb.z + 0.5));
      let phase = edge_mod(t * stroke_speed, spacing);
      var best = 1.0e6;
      if (direction != 1) {
        let x = -d - phase;
        let kk = clamp(round(x / spacing), 0.0, count);
        best = min(best, abs(x - kk * spacing));
      }
      if (direction != 0) {
        let x = d + phase;
        let kk = clamp(round(x / spacing), 0.0, count);
        best = min(best, abs(x - kk * spacing));
      }
      sd = best - hw;
      if (trim_on) { sd = max(sd, trim_along); }
    } else if (stroke_type == 18) {
      // Corner accents: brackets running `length` px from each corner.
      var along = 1.0e6;
      for (var i: i32 = 0; i < 64; i = i + 1) {
        if (i >= ctx.corner_count) { break; }
        let sc = layers[li].edge_corners[i].z;
        let du = abs(edge_mod(s_arc - sc + total * 0.5, total) - total * 0.5);
        along = min(along, du - max(sb.x, 0.0));
      }
      sd = edge_open_sd(core_sd, along, hw, cap);
    } else if (stroke_type == 19) {
      // Vertex dots, swelling on the beat, with a ring burst.
      let beat = ghost_audio_beat(ghost_audio_scene());
      let r0 = max(sb.x, 0.5);
      let r = r0 * (1.0 + max(sb.y, 0.0) * beat);
      var dot_sd = 1.0e6;
      var ring = 1.0e6;
      for (var i: i32 = 0; i < 64; i = i + 1) {
        if (i >= ctx.corner_count) { break; }
        let dist = length(q - layers[li].edge_corners[i].xy);
        dot_sd = min(dot_sd, dist - r);
        ring = min(ring, abs(dist - r0 * (1.0 + 3.0 * max(sb.y, 0.0) * beat)));
      }
      sd = dot_sd;
      if (trim_on) { sd = max(sd, trim_along); }
      add_a = edge_line_cov(ring - max(width, aa) * 0.5, width, aa) * beat * select(0.0, 1.0, sb.y > 0.0);
    } else if (stroke_type == 20) {
      // Wireframe: spokes from the centre to each corner, the inner
      // triangulation, and optionally the outline itself.
      var best = select(1.0e6, abs(d), sb.z > 0.5);
      let n = ctx.corner_count;
      if (sb.x > 0.5) {
        for (var i: i32 = 0; i < 64; i = i + 1) {
          if (i >= n) { break; }
          let a = layers[li].edge_corners[i].xy;
          let pa = q - center;
          let ba = a - center;
          let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
          best = min(best, length(pa - ba * h));
        }
      }
      if (sb.y > 0.5) {
        for (var i: i32 = 0; i < 64; i = i + 1) {
          if (i >= ctx.diag_count) { break; }
          let pair = layers[li].edge_diags[i / 2];
          let ij = select(pair.zw, pair.xy, (i % 2) == 0);
          let a = layers[li].edge_corners[i32(ij.x)].xy;
          let b = layers[li].edge_corners[i32(ij.y)].xy;
          let pa = q - a;
          let ba = b - a;
          let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
          best = min(best, length(pa - ba * h));
        }
      }
      sd = best - hw;
      if (trim_on) { sd = max(sd, trim_along); }
    } else if (stroke_type == 21 || stroke_type == 22) {
      // Zig-zag / wiggle: the centerline displaced across itself as a
      // function of arc length; dividing by the slope keeps it crisp.
      let amp = max(sb.x, 0.0);
      let wl = max(sb.y, 2.0);
      let x = s_arc / wl + t * stroke_speed;
      var offset = 0.0;
      var slope = 0.0;
      if (stroke_type == 21) {
        offset = amp * (abs(fract(x) * 4.0 - 2.0) - 1.0);
        slope = 4.0 * amp / wl;
      } else {
        offset = amp * edge_value_noise(x * 2.0, sb.z + ctx.seed);
        slope = 3.0 * amp / wl;
      }
      sd = abs(d - offset) / sqrt(1.0 + slope * slope) - hw;
      if (trim_on) { sd = max(sd, trim_along); }
    }
    let cov_line = edge_line_cov(sd, width, aa) * alpha_scale;
    stroke1 = stroke_color_u;
    stroke_w = max(cov_line, add_a);
    stroke_has_trim = true;
  }

  // ----- classic animations (the editor's, at output resolution) -----
  if (anim_type == 1 && anim_count >= 1.0) {
    let cnt = i32(anim_count);
    let direction = i32(floor(ap.x + 0.5));
    let loop_count = select(cnt, cnt * 2, direction == 2);
    let ta = t * anim_speed;
    var result = vec4<f32>(0.0);
    for (var i: i32 = 0; i < 40; i = i + 1) {
      if (i >= loop_count) { break; }
      let fi = f32(i % cnt);
      let is_inward = (direction == 1) || (direction == 2 && i >= cnt);
      let phase = edge_mod(fi * anim_spacing + ta * 0.15, f32(cnt) * anim_spacing);
      var scale: f32;
      if (is_inward) {
        scale = max(1.0 - phase / (f32(cnt) * anim_spacing) * 0.95, 0.02);
      } else {
        scale = 1.0 + phase;
      }
      let rq = center + (p - center) / scale;
      // The distance field is 1-Lipschitz: |d(rq)| >= |d(p)| - |rq - p|, so
      // a ring that cannot reach this pixel is skipped without a search.
      if (abs(base.d) - length(rq - p) > max(sw.x * 2.0, aa / scale) + 1.0) { continue; }
      let ring = edge_hit(li, rq, ctx.count);
      let stroke_alpha = edge_falloff(abs(ring.d), sw.x * 2.0, aa / scale);
      result = max(result, stroke_color_u * stroke_alpha);
    }
    stroke0 = stroke0 + result;
    stroke1 = stroke1 + result;
  }
  if (anim_type == 3) {
    let breathe_t = sin(t * anim_speed * EDGE_PI) * 0.5 + 0.5;
    let bs = mix(ap.x, ap.y, breathe_t);
    let bh = edge_hit(li, center + (p - center) / bs, ctx.count);
    stroke_w = edge_line_cov(abs(bh.d) - hw, width, aa / max(bs, 0.05));
    stroke1 = stroke_color_u;
    stroke0 = vec4<f32>(0.0);
  }
  if (anim_type == 2 && anim_count > 0.0) {
    let rel = p - center;
    let ray_angle = edge_mod(atan2(rel.y, rel.x) + t * anim_speed * 0.5, EDGE_TAU);
    let ray = pow(abs(cos(ray_angle * anim_count * 0.5)), 20.0);
    let radiate = ray * (1.0 - edge_smoothstep(0.0, 0.4 * rx, length(rel)));
    stroke0 = stroke0 + stroke_color_u * radiate * 0.5;
    stroke1 = stroke1 + stroke_color_u * radiate * 0.5;
  }
  if (anim_type == 5) {
    let dist = length(p - center);
    let ripple_count = max(anim_count, 3.0);
    for (var i: i32 = 0; i < 10; i = i + 1) {
      if (f32(i) >= ripple_count) { break; }
      let r = edge_mod(t * anim_speed * 0.15 + f32(i) * anim_spacing, ripple_count * anim_spacing);
      let ring = edge_falloff(abs(dist - r * rx), sw.x * 2.0, aa);
      let add = stroke_color_u * ring * exp(-r * ap.x * 5.0) * 0.3;
      stroke0 = stroke0 + add;
      stroke1 = stroke1 + add;
    }
  }
  if (anim_type == 6) {
    let wt = t * anim_speed;
    let wave_offset = vec2<f32>(
      sin(uv.y * ap.y * 20.0 + wt * 3.0),
      cos(uv.x * ap.y * 20.0 + wt * 2.5),
    ) * ap.x * 0.02 * rx;
    let wh = edge_hit(li, p + wave_offset, ctx.count);
    stroke_w = edge_line_cov(abs(wh.d) - hw, width, aa);
    stroke1 = stroke_color_u;
    stroke0 = vec4<f32>(0.0);
    if (fill_type > 0) {
      fill_w = fill_w * edge_cov(wh.d, aa);
    }
  }
  if (anim_type == 7 && ap.x > 0.0) {
    let gt = t * anim_speed;
    let block_y = floor(uv.y * (10.0 / ap.y)) * ap.y * 0.1;
    let trigger = step(0.92, edge_random(vec2<f32>(block_y, floor(gt * 4.0))));
    let offset = (edge_random(vec2<f32>(block_y + 1.0, floor(gt * 4.0))) - 0.5) * ap.x * 0.05 * rx;
    if (trigger > 0.5) {
      let hr = edge_hit(li, p + vec2<f32>(offset, 0.0), ctx.count);
      let hb = edge_hit(li, p - vec2<f32>(offset, 0.0), ctx.count);
      let ar = edge_line_cov(abs(hr.d) - hw, width, aa);
      let ab = edge_line_cov(abs(hb.d) - hw, width, aa);
      let ag = mix(stroke0, stroke1, stroke_w).a;
      stroke1 = vec4<f32>(stroke_color_u.r * ar, stroke_color_u.g * ag, stroke_color_u.b * ab, max(ar, max(ag, ab)) * stroke_color_u.a);
      stroke0 = stroke1;
      stroke_w = 1.0;
    }
  }

  // The four corners of (fill coverage, stroke coverage), each composited
  // the editor's way, then interpolated: analytic edges stay linear.
  let classic = stroke_type <= 10 && fill_type <= 8;
  let fill0 = vec4<f32>(fill_color.rgb, 0.0);
  let bare = mix(edge_compose(fill0, stroke0, classic), edge_compose(fill_color, stroke0, classic), fill_w);
  let lit = mix(edge_compose(fill0, stroke1, classic), edge_compose(fill_color, stroke1, classic), fill_w);
  var out = mix(bare, lit, stroke_w);
  if (trim_on && !stroke_has_trim) {
    // Classic strokes: the trim masks the whole stroke, halo included.
    let no_stroke = mix(edge_compose(fill0, vec4<f32>(0.0), classic), edge_compose(fill_color, vec4<f32>(0.0), classic), fill_w);
    out = mix(no_stroke, out, edge_cov(trim_along, aa));
  }
  return out;
}

/// Fill and stroke composited to premultiplied colour. The classic types
/// keep the editor's shape shader composite (mix by stroke alpha, then the
/// additive (SRC_ALPHA, ONE) write into an 8-bit target), which shapes
/// their glow halos; the new types use plain premultiplied source-over.
fn edge_compose(fill: vec4<f32>, stroke: vec4<f32>, classic: bool) -> vec4<f32> {
  if (classic) {
    let r = mix(fill, stroke, stroke.a);
    let a = clamp(r.a, 0.0, 1.0);
    return vec4<f32>(clamp(r.rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * a, a);
  }
  let sa = clamp(stroke.a, 0.0, 1.0);
  let fa = clamp(fill.a, 0.0, 1.0);
  let rgb = clamp(stroke.rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * sa + clamp(fill.rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * fa * (1.0 - sa);
  return vec4<f32>(rgb, sa + fa * (1.0 - sa));
}

/// Hue rotation about the grey axis (Rodrigues), `turns` of a full circle.
fn edge_hue_rotate(c: vec3<f32>, turns: f32) -> vec3<f32> {
  let a = turns * EDGE_TAU;
  let k = vec3<f32>(0.57735027);
  let ca = cos(a);
  return clamp(c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca), vec3<f32>(0.0), vec3<f32>(1.0));
}

/// Beat reaction of one effect (Looks): slot 21 = (mode, source, amount,
/// decay), slot 12 = (chase index, chase count, chase beats, hue per beat).
/// Modes: 1 pulse, 2 boost, 3 step (one group member per beat), 4 strobe.
/// Sources: 0 beat clock, 1 kick, 2 snare, 3 bass, 4 level, 5 treble; audio
/// sources follow the beat clock while no audio is live, so a Look moves on
/// a tapped or typed tempo too. Returns (alpha gain, whiten, hue turns, _).
fn edge_react(rx: vec4<f32>, rc: vec4<f32>) -> vec4<f32> {
  let mode = i32(floor(rx.x + 0.5));
  let source = i32(floor(rx.y + 0.5));
  let amount = clamp(rx.z, 0.0, 1.0);
  let decay = max(rx.w, 0.05);
  let n = max(floor(rc.y + 0.5), 1.0);
  let k = floor(rc.x + 0.5);
  let beat = u.clock.x - k * rc.z;
  let beat_i = floor(beat);
  let clock_env = exp(-(beat - beat_i) * 4.0 * decay);
  let audio = ghost_audio_scene();
  var env = clock_env;
  if (source > 0 && ghost_audio_active(audio) > 0.5) {
    if (source == 1) { env = ghost_audio_kick(audio); }
    else if (source == 2) { env = ghost_audio_snare(audio); }
    else if (source == 3) { env = ghost_audio_bass(audio); }
    else if (source == 4) { env = ghost_audio_level(audio); }
    else { env = ghost_audio_treble(audio); }
  }
  env = clamp(env, 0.0, 1.0);
  var gain = 1.0;
  var whiten = 0.0;
  if (mode == 1) {
    gain = 1.0 - amount + amount * env;
  } else if (mode == 2) {
    gain = 1.0 + amount * env * 1.5;
    whiten = amount * env * 0.45;
  } else if (mode == 3) {
    let lit = select(0.0, 1.0, abs(edge_mod(floor(u.clock.x), n) - k) < 0.5);
    gain = 1.0 - amount + amount * lit * mix(1.0, clock_env, 0.35);
  } else if (mode == 4) {
    gain = select(1.0 - amount, 1.0, env > 0.5);
  }
  return vec4<f32>(gain, whiten, rc.w * beat_i, 0.0);
}

/// The layer's edge stack at output UV `p_uv`: each effect is composited
/// onto the layer with premultiplied source-over and its blend mode
/// (W3C compositing), then the layer goes on with its own blend and opacity.
/// `layer` is straight colour and coverage; so is the result.
fn apply_native_edge_effects(layer: vec4<f32>, p_uv: vec2<f32>, li: u32, aa: f32) -> vec4<f32> {
  let info = layers[li].edge_info;
  var ctx: EdgeCtx;
  ctx.count = min(i32(floor(info.x + 0.5)), 512);
  let effect_count = min(i32(floor(info.y + 0.5)), 16);
  if (ctx.count < 3 || effect_count < 1) { return layer; }
  ctx.corner_count = min(i32(floor(info.z + 0.5)), 64);
  ctx.diag_count = min(i32(floor(info.w + 0.5)), 64);
  let geom = layers[li].edge_geom;
  ctx.centroid = geom.xy;
  ctx.total = max(geom.z, 1.0);
  ctx.inradius = geom.w;
  ctx.aa = aa;
  ctx.res = u.resolution;
  ctx.seed = layers[li].edge_extra.x;
  ctx.bbox = layers[li].edge_extra2;
  let p = p_uv * u.resolution;
  var base: EdgeHit;
  var base_ready = false;
  var cr = layer.rgb * layer.a;
  var ca = layer.a;
  for (var e: i32 = 0; e < 16; e = e + 1) {
    if (e >= effect_count) { break; }
    // Cull per effect: outside its own rectangle, or (for effects that keep
    // the outline still) farther from the centerline than it can reach.
    let rect = layers[li].edge_effects[e][19];
    if (any(p_uv < rect.xy) || any(p_uv > rect.zw)) { continue; }
    if (!base_ready) {
      base = edge_hit(li, p, ctx.count);
      base_ready = true;
    }
    let cull = layers[li].edge_effects[e][20];
    if (base.d > cull.x || (cull.y < 0.5 && -base.d > cull.x)) { continue; }
    let head = layers[li].edge_effects[e][0];
    // Premultiplied effect colour.
    let frag = edge_effect_fragment(li, e, p, base, ctx);
    var src_a = clamp(frag.a, 0.0, 1.0) * clamp(head.y, 0.0, 1.0);
    var src_c = clamp(frag.rgb / max(frag.a, 1e-6), vec3<f32>(0.0), vec3<f32>(1.0));
    let react_mode = layers[li].edge_effects[e][21];
    if (react_mode.x > 0.5) {
      let r = edge_react(react_mode, layers[li].edge_effects[e][12]);
      src_a = clamp(src_a * r.x, 0.0, 1.0);
      if (r.z != 0.0) { src_c = edge_hue_rotate(src_c, r.z); }
      src_c = mix(src_c, vec3<f32>(1.0), clamp(r.y, 0.0, 1.0));
    }
    if (src_a <= 0.0) { continue; }
    let cb = select(vec3<f32>(0.0), cr / max(ca, 1e-6), ca > 1e-6);
    let blended = native_blend(cb, src_c, 1.0, head.z);
    cr = src_a * (1.0 - ca) * src_c + src_a * ca * blended + (1.0 - src_a) * cr;
    ca = src_a + ca * (1.0 - src_a);
  }
  return vec4<f32>(select(vec3<f32>(0.0), cr / max(ca, 1e-6), ca > 1e-6), ca);
}

// fast_flags.z = paint-mask array slot + 1 (0 = none); fast_flags.w bit 0
// = inverted. `content_uv` is the mesh-inverse UV (y down), the space the
// editor paints in.
fn native_paint_mask(content_uv: vec2<f32>, layer_index: u32) -> f32 {
  let slot = layers[layer_index].fast_flags.z;
  if (slot == 0u) {
    return 1.0;
  }
  let uv = clamp(content_uv, vec2<f32>(0.0), vec2<f32>(1.0));
  var m = textureSampleLevel(paint_masks, source_frame_sampler, uv, i32(slot - 1u), 0.0).r;
  if ((layers[layer_index].fast_flags.w & 1u) != 0u) {
    m = 1.0 - m;
  }
  return clamp(m, 0.0, 1.0);
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
  // One screen pixel measured in composition pixels: the anti-alias width
  // of analytic edges (1 unless the output stage scales the composition).
  let canvas_px = canvas_uv * u.resolution;
  let edge_aa = clamp(max(length(dpdx(canvas_px)), length(dpdy(canvas_px))), 0.25, 8.0);
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
  // Coverage of everything blended so far. `color` is that stack composited
  // over black, i.e. premultiplied by this; only the alpha recording pass
  // reads it.
  var out_alpha = 0.0;
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
    if (layers[layer_index].info.x < 0.5) {
      continue;
    }
    let tl = layers[layer_index].p0.xy;
    let tr = layers[layer_index].p0.zw;
    let br = layers[layer_index].p1.xy;
    let bl = layers[layer_index].p1.zw;
    // Hierarchy mask layer (blend code 26). Layers composite bottom to top, so
    // `color` here holds exactly the layers below the mask: clip that, and
    // everything above the mask blends on top unclipped. This runs before the
    // bounds reject because pixels outside the mask's quad are masked too
    // (outside every shape, or kept when inverted), and before the alpha check
    // because a mask layer carries no fill of its own (color alpha 0).
    if (layers[layer_index].style.x >= 25.5 && layers[layer_index].style.x < 26.5) {
      let mask_enabled = layers[layer_index].mask_info.x > 0.5 && layers[layer_index].mask_info.w >= 2.5;
      if (mask_enabled) {
        let mask_local = quad_local_uv(canvas_uv, tl, tr, br, bl);
        var coverage = select(0.0, 1.0, layers[layer_index].mask_info.y > 0.5);
        if (mask_local.x > 0.5) {
          coverage = native_polygon_mask(mask_local.yz, layer_index);
        }
        color = color * coverage;
        out_alpha = out_alpha * coverage;
      }
      continue;
    }
    if (layers[layer_index].color.a <= 0.001) {
      continue;
    }
    // Edge effects can glow past the layer's quad, so a layer that carries
    // them is also evaluated inside the rectangle its stack can reach.
    let edge_bounds = layers[layer_index].edge_bounds;
    let in_edges = layers[layer_index].edge_info.y > 0.5 && layers[layer_index].edge_info.x > 2.5
      && all(canvas_uv >= edge_bounds.xy) && all(canvas_uv <= edge_bounds.zw);
    // Reject outside the conservative quad bounds before inverse mapping,
    // mesh search, masks and effects.
    // A Bezier mesh can bulge past the corner quad: bound it by the reach
    // of its surface instead, so the bulge keeps its content.
    let bezier_mesh = layers[layer_index].fast_flags.y == 1u;
    var quad_min = min(min(tl, tr), min(br, bl));
    var quad_max = max(max(tl, tr), max(br, bl));
    if (bezier_mesh) {
      let reach = quad_reach_bounds(tl, tr, br, bl, layers[layer_index].mesh_bounds);
      quad_min = min(quad_min, reach.xy);
      quad_max = max(quad_max, reach.zw);
    }
    let bounds_pad = vec2<f32>(max(1.0, max(quad_max.x - quad_min.x, quad_max.y - quad_min.y)) * 0.001);
    let bounds_min = quad_min - bounds_pad;
    let bounds_max = quad_max + bounds_pad;
    let in_quad_bounds = !(any(canvas_uv < bounds_min) || any(canvas_uv > bounds_max));
    if (!in_quad_bounds && !in_edges) {
      continue;
    }
    if (layers[layer_index].fast_flags.x != 0u) {
      // CPU-classified plain rectangles keep the same shape AA and blend order.
      let uv = (canvas_uv - tl) / (br - tl);
      if (all(uv >= vec2<f32>(-0.0005)) && all(uv <= vec2<f32>(1.0005))) {
        let coverage = native_layer_shape(clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), layer_index).x;
        if (coverage > 0.001) {
          let fill_alpha = clamp(layers[layer_index].color.a * 0.56 * coverage, 0.0, 1.0);
          color = native_blend(color, layers[layer_index].color.rgb * layers[layer_index].tint.rgb,
            fill_alpha, layers[layer_index].style.x);
          out_alpha = fill_alpha + out_alpha * (1.0 - fill_alpha);
        }
      }
      continue;
    }
    var layer_rgb = layers[layer_index].color.rgb;
    // Content coverage before the layer's opacity (the editor's layer texture alpha).
    var content_alpha = 0.0;
    if (in_quad_bounds) {
      var local: vec3<f32>;
      if (bezier_mesh) {
        local = quad_local_uv_reach(canvas_uv, tl, tr, br, bl, layers[layer_index].mesh_bounds);
      } else {
        local = quad_local_uv(canvas_uv, tl, tr, br, bl);
      }
      let inside = local.x > 0.5;
      let mesh_sample = layer_mesh_uv(local.yz, layer_index);
      let inside_mesh = inside && mesh_sample.x > 0.5;
      if (inside_mesh) {
        let uv_sample = layer_sample_uv(mesh_sample.yz, layer_index);
        let sample_uv = uv_sample.xy;
        let content_mask = uv_sample.z;
        // A Bezier layer's shape and mask are cut in the layer's own UV
        // before the mesh bends it, as the editor texture and the Edge
        // Effect outline are, so they follow the surface into a bulge.
        // A non-rectangular shape does the same on a straight mesh: cut in
        // quad UV, the content stayed at the unwarped shape while its Edge
        // Effects followed the warp. A plain rectangle keeps quad UV there,
        // so its anti-aliased edge stays one output pixel wide in cells the
        // mesh squeezes or stretches.
        let mask_uv = select(local.yz, mesh_sample.yz, bezier_mesh);
        let shaped = layers[layer_index].shape.x > 0.5;
        let shape_uv = select(mask_uv, mesh_sample.yz, shaped);
        let shape_sample = native_layer_shape(shape_uv, layer_index);
        let polygon_mask = native_polygon_mask(mask_uv, layer_index)
          * native_paint_mask(mesh_sample.yz, layer_index);
        let shape_mask = shape_sample.x * polygon_mask;
        content_alpha = 0.56 * shape_mask;
        if (layers[layer_index].info.w > 0.5) {
          let preview = source_content_for_layer(sample_source_content(layers[layer_index].info.w, sample_uv, layer_index), layers[layer_index].info.z);
          layer_rgb = preview.rgb;
          content_alpha = preview.a * content_mask * shape_mask;
        } else if (layers[layer_index].info.z >= 9.0) {
          let proxy = gpu_proxy(layers[layer_index].info.z, sample_uv, t, layers[layer_index].info.y, layers[layer_index].params0, layers[layer_index].params1);
          let proxy_alpha = proxy.a * content_mask * shape_mask;
          layer_rgb = proxy.rgb;
          content_alpha = (0.62 + 0.28 * proxy_alpha) * content_mask * shape_mask;
        }
        layer_rgb = apply_native_effects(layer_rgb, layer_index, sample_uv, t);
        if (shape_mask <= 0.001) {
          content_alpha = 0.0;
        }
      }
    }
    // color.a is the layer opacity times its content alpha (tint.w). The
    // content alpha dims a layer's own placeholder content (a source-less
    // shape draws at 35%) but must not dim the Edge Effects drawn on it.
    var layer_alpha = layers[layer_index].color.a;
    if (in_edges) {
      let own = clamp(layers[layer_index].tint.w, 0.0, 1.0);
      let edged = apply_native_edge_effects(vec4<f32>(layer_rgb, content_alpha * own), canvas_uv, layer_index, edge_aa);
      layer_rgb = edged.rgb;
      content_alpha = edged.a;
      layer_alpha = layer_alpha / max(own, 1e-4);
    }
    if (content_alpha > 0.0) {
      layer_rgb = layer_rgb * layers[layer_index].tint.rgb;
      let blend_alpha = clamp(min(layer_alpha, 1.0) * content_alpha, 0.0, 1.0);
      color = native_blend(color, layer_rgb, blend_alpha, layers[layer_index].style.x);
      out_alpha = blend_alpha + out_alpha * (1.0 - blend_alpha);
    }
  }

  color = apply_composite_effects(color, canvas_uv, t);
  if (u.smask.z > 0.5) {
    // Recording with transparency: un-premultiply so empty regions carry
    // alpha 0 and content its own coverage (ProRes 4444 / HAP Alpha expect
    // straight alpha). No output stage: this is the composition itself.
    let a = clamp(out_alpha, 0.0, 1.0);
    let straight = select(vec3<f32>(0.0), color / max(a, 0.0001), a > 0.0001);
    return vec4<f32>(clamp(straight, vec3<f32>(0.0), vec3<f32>(1.0)), a);
  }
  color = apply_test_pattern(color, in.uv, aspect);
  if (u.dome2.z > 0.5) {
    color = slice_output_grade(color, in.uv) * dome_mask * screen_mask_alpha(output_rotate_uv(in.uv));
  } else {
    color = output_color_grade(color);
    color = color * dome_mask * edge_blend_alpha(in.uv);
  }
  return vec4<f32>(clamp(color * u.output_gate, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

@group(1) @binding(0) var creative_master: texture_2d<f32>;
@group(1) @binding(1) var creative_sampler: sampler;

@fragment
fn fs_output(in: VertexOut) -> @location(0) vec4<f32> {
  // Blackout is independent of every creative operation and calibration.
  if (u.output_gate <= 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
  let source = output_source_uv(in.uv);
  var uv = source.xy;
  var mask = source.z;
  if (u.dome0.x > 0.5) {
    let domed = dome_source_uv(uv, aspect);
    uv = domed.xy;
    mask *= domed.z;
  }
  var color = textureSampleLevel(creative_master, creative_sampler, vec2<f32>(uv.x, 1.0 - uv.y), 0.0).rgb;
  color = apply_test_pattern(color, in.uv, aspect);
  if (u.dome2.z > 0.5) {
    color = slice_output_grade(color, in.uv) * mask * screen_mask_alpha(output_rotate_uv(in.uv));
  } else {
    color = output_color_grade(color) * mask * edge_blend_alpha(in.uv);
  }
  return vec4<f32>(clamp(color * u.output_gate, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
