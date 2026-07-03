struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  command_phase: f32,
  layer_count: f32,
  frame_count: f32,
  _pad0: vec2<f32>,
  audio0: vec4<f32>, // level, bass, mid, treble
  audio1: vec4<f32>, // high, beat, beat phase, bpm
  audio2: vec4<f32>, // centroid, kick, snare, active
}

@group(0) @binding(0)
var<uniform> u: Uniforms;

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
  effect0: vec4<f32>,
  effect1: vec4<f32>,
  effect2: vec4<f32>,
  effect3: vec4<f32>,
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
const MAX_SOURCE_FRAME_SLOTS: i32 = 8;
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
  let audio_on = u.audio2.w;
  let audio_level = u.audio0.x * audio_on;
  let audio_bass = u.audio0.y * audio_on;
  let audio_high = u.audio1.x * audio_on;
  let audio_beat = u.audio1.y * audio_on;
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
  let audio_on = u.audio2.w;
  let audio_level = u.audio0.x * audio_on;
  let audio_bass = u.audio0.y * audio_on;
  let audio_treble = u.audio0.w * audio_on;
  let audio_beat = u.audio1.y * audio_on;
  let audio_kick = u.audio2.y * audio_on;
  let audio_snare = u.audio2.z * audio_on;
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
  sampled = sampled / max(total, 0.0001);
  let rgb = clamp((sampled.rgb - vec3<f32>(0.5)) * 1.035 + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(rgb, sampled.a);
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
  return textureSample(source_frames, source_frame_sampler, sample_uv, slot);
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
  let dims = vec2<f32>(textureDimensions(source_frames, 0));
  let pixel_dx = dpdx(sample_uv) * dims;
  let pixel_dy = dpdy(sample_uv) * dims;
  let footprint = max(length(pixel_dx), length(pixel_dy));
  let linear = sample_source_frame_linear(slot, sample_uv);
  if (footprint > 1.35) {
    return sample_source_frame_minified(slot, sample_uv, footprint);
  }

  let coord = clamp(sample_uv, vec2<f32>(0.0), vec2<f32>(0.999999)) * dims - vec2<f32>(0.5);
  let base = floor(coord);
  let f = fract(coord);
  var sampled = vec4<f32>(0.0);
  var total = 0.0;
  for (var oy: i32 = -1; oy <= 2; oy = oy + 1) {
    let wy = cubic_weight(f.y - f32(oy));
    for (var ox: i32 = -1; ox <= 2; ox = ox + 1) {
      let wx = cubic_weight(f.x - f32(ox));
      let w = wx * wy;
      sampled += sample_source_frame_texel(slot, i32(base.x) + ox, i32(base.y) + oy) * w;
      total += w;
    }
  }
  let cubic = sampled / max(total, 0.0001);
  let cubic_amount = 1.0 - smoothstep(0.95, 1.35, footprint);
  return mix(linear, max(cubic, vec4<f32>(0.0)), cubic_amount);
}

fn sample_source_content(slot_code: f32, uv: vec2<f32>) -> vec4<f32> {
  if (slot_code >= SOURCE_FRAME_SLOT_OFFSET) {
    return sample_source_frame(slot_code, uv);
  }
  return sample_source_preview(slot_code, uv);
}

fn layer_sample_uv(raw_uv: vec2<f32>, layer: LayerData) -> vec3<f32> {
  var sampled_uv = raw_uv;
  if (layer.uv1.z > 0.5) {
    sampled_uv.x = 1.0 - sampled_uv.x;
  }
  if (layer.uv1.w > 0.5) {
    sampled_uv.y = 1.0 - sampled_uv.y;
  }

  var content_mask = 1.0;
  let fit_mode = i32(floor(layer.uv1.x + 0.5));
  let ratio = max(layer.uv1.y, 0.0001);
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

  sampled_uv = layer.uv0.xy + sampled_uv * layer.uv0.zw;
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

fn apply_native_effects(color: vec3<f32>, layer: LayerData, uv: vec2<f32>, t: f32) -> vec3<f32> {
  let count = i32(floor(layer.style.y + 0.5));
  var out = color;
  if (count > 0) { out = apply_native_effect(out, layer.effect0, uv, t); }
  if (count > 1) { out = apply_native_effect(out, layer.effect1, uv, t); }
  if (count > 2) { out = apply_native_effect(out, layer.effect2, uv, t); }
  if (count > 3) { out = apply_native_effect(out, layer.effect3, uv, t); }
  return out;
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
    blended = dst + src;
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

fn native_layer_shape(local_uv: vec2<f32>, layer: LayerData) -> vec2<f32> {
  let shape_type = i32(floor(layer.shape.x + 0.5));
  if (shape_type == 0) {
    return vec2<f32>(1.0, 0.0);
  }
  let feather = max(layer.shape.y, 0.0);
  let rotation = layer.shape.z;
  let scale = max(layer.shape.w, 0.0001);
  var dist = 1.0;
  if (shape_type == 1) {
    let p = rotate2d((local_uv - vec2<f32>(0.5)) / scale, -rotation);
    dist = length(p) - 0.5;
  } else if (shape_type == 2) {
    let p = rotate2d((local_uv - vec2<f32>(0.5)) / scale, -rotation) + vec2<f32>(0.5);
    dist = triangle_signed_distance(p, vec2<f32>(0.5, 0.88), vec2<f32>(0.14, 0.14), vec2<f32>(0.86, 0.14));
  }
  let mask = select(
    select(0.0, 1.0, dist < 0.0),
    1.0 - smoothstep(-feather, 0.0, dist),
    feather > 0.001
  );
  let edge_width = max(0.0065, feather * 0.42 + 0.0065);
  let edge = 1.0 - smoothstep(0.0015, edge_width, abs(dist));
  return vec2<f32>(clamp(mask, 0.0, 1.0), clamp(edge, 0.0, 1.0));
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
  var p = (in.uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time;
  let audio_on = u.audio2.w;
  let audio_level = u.audio0.x * audio_on;
  let audio_bass = u.audio0.y * audio_on;
  let audio_treble = u.audio0.w * audio_on;
  let audio_beat = u.audio1.y * audio_on;
  let audio_kick = u.audio2.y * audio_on;
  let audio_snare = u.audio2.z * audio_on;
  let audio_drive = clamp(audio_level * 0.36 + audio_bass * 0.30 + audio_beat * 0.42 + audio_kick * 0.26 + audio_snare * 0.18, 0.0, 1.8);
  let core = vec2<f32>(0.0, 0.02 * sin(t * 0.9));

  var color = vec3<f32>(0.006, 0.008, 0.012);
  let vignette = smoothstep(1.45, 0.18, length(p));
  color += vec3<f32>(0.01, 0.025, 0.04) * vignette * (1.0 + audio_drive * 0.8);

  let rings = abs(sin((length(p - core) * (18.0 + audio_bass * 5.0) - t * (3.0 + audio_level * 2.0)) + u.command_phase * 0.015));
  color += vec3<f32>(0.02, 0.18 + audio_treble * 0.16, 0.28 + audio_bass * 0.18) * pow(1.0 - rings, 8.0) * vignette * (1.0 + audio_beat * 1.35);

  let layer_energy = clamp(u.layer_count / 16.0, 0.0, 1.0);
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

  let canvas_uv = in.uv;
  for (var i: i32 = 0; i < 64; i = i + 1) {
    if (f32(i) >= u.layer_count) {
      break;
    }
    let layer = layers[i];
    if (layer.info.x < 0.5 || layer.color.a <= 0.001) {
      continue;
    }
    let tl = layer.p0.xy;
    let tr = layer.p0.zw;
    let br = layer.p1.xy;
    let bl = layer.p1.zw;
    let local = quad_local_uv(canvas_uv, tl, tr, br, bl);
    let inside = local.x > 0.5;
    let uv_sample = layer_sample_uv(local.yz, layer);
    let sample_uv = uv_sample.xy;
    let content_mask = uv_sample.z;
    let shape_sample = native_layer_shape(local.yz, layer);
    let shape_mask = select(0.0, shape_sample.x, inside);
    let edge_dist = quad_edge_distance(canvas_uv, tl, tr, br, bl);
    let quad_edge = 1.0 - smoothstep(0.0015, 0.0065, edge_dist);
    let edge = select(quad_edge, shape_sample.y * select(0.0, 1.0, inside), layer.shape.x > 0.5);
    var layer_rgb = layer.color.rgb;
    var fill_alpha = layer.color.a * 0.56 * shape_mask;
    if (inside && layer.info.w > 0.5) {
      let preview = sample_source_content(layer.info.w, sample_uv);
      let source_alpha = preview.a * content_mask * shape_mask;
      layer_rgb = mix(layer_rgb, preview.rgb, source_alpha);
      fill_alpha = layer.color.a * 0.88 * content_mask * shape_mask;
    } else if (inside && layer.info.z >= 9.0) {
      let proxy = gpu_proxy(layer.info.z, sample_uv, t, layer.info.y, layer.params0, layer.params1);
      let proxy_alpha = proxy.a * content_mask * shape_mask;
      layer_rgb = mix(layer_rgb, proxy.rgb, proxy_alpha);
      fill_alpha = layer.color.a * (0.62 + 0.28 * proxy_alpha) * content_mask * shape_mask;
    }
    layer_rgb = apply_native_effects(layer_rgb, layer, sample_uv, t);
    let pulse = 0.88 + 0.12 * sin(t * 2.2 + layer.info.y * 0.73 + u.command_phase * 6.2831);
    if (inside && shape_mask > 0.001) {
      color = native_blend(color, layer_rgb, fill_alpha, layer.style.x);
      color += layer_rgb * 0.04 * pulse;
    }
    color += layer_rgb * edge * (0.34 + 0.16 * pulse);
  }

  let grain = value_noise(in.uv * u.resolution.xy * 0.36 + vec2<f32>(t * 21.0, u.frame_count * 0.23));
  color += (grain - 0.5) * 0.0015;
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.82));
  return vec4<f32>(color, 1.0);
}
