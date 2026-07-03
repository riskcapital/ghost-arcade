struct NativeInstrumentUniforms {
  resolution: vec2<f32>,
  time: f32,
  source_kind: f32,
  params0: vec4<f32>,
  params1: vec4<f32>,
  audio0: vec4<f32>,
  audio1: vec4<f32>,
  audio2: vec4<f32>,
  seed: f32,
  _pad0: vec3<f32>,
}

@group(0) @binding(0)
var<uniform> u: NativeInstrumentUniforms;

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
  let w = f * f * f * (f * (f * vec2<f32>(6.0) - vec2<f32>(15.0)) + vec2<f32>(10.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    sum += value_noise(p * freq) * amp;
    freq *= 2.08;
    amp *= 0.52;
  }
  return sum;
}

fn palette(x: f32) -> vec3<f32> {
  return 0.54 + 0.46 * cos(vec3<f32>(0.0, 2.1, 4.2) + x * 6.2831853);
}

fn sphere_shade(uv: vec2<f32>, center: vec2<f32>, radius: f32, hue: f32, depth: f32, t: f32) -> vec4<f32> {
  let d = uv - center;
  let dist = length(d);
  let px = 2.0 / max(1.0, min(u.resolution.x, u.resolution.y));
  let edge_width = max(px * 3.4, fwidth(dist) * 2.25);
  let mask = 1.0 - smoothstep(radius - edge_width, radius + edge_width, dist);
  if (mask <= 0.0001) {
    return vec4<f32>(0.0);
  }
  let q = d / max(radius, 0.0001);
  let z = sqrt(max(0.0, 1.0 - dot(q, q)));
  let n = normalize(vec3<f32>(q.x, q.y, z));
  let light_dir = normalize(vec3<f32>(-0.46 + 0.2 * sin(t * 0.31 + depth), 0.62, 0.66));
  let view_dir = vec3<f32>(0.0, 0.0, 1.0);
  let diffuse = pow(clamp(dot(n, light_dir) * 0.5 + 0.5, 0.0, 1.0), 1.28);
  let spec = pow(max(dot(reflect(-light_dir, n), view_dir), 0.0), 44.0);
  let fresnel = pow(1.0 - clamp(z, 0.0, 1.0), 2.2);
  let streaks = 0.5 + 0.5 * sin((n.x * 8.2 + n.y * 5.6 + n.z * 2.1) + t * 0.38 + hue * 6.2831853);
  let grain = fbm(uv * (5.0 + depth * 4.0) + vec2<f32>(t * 0.028, -t * 0.019));
  var rgb = palette(hue + streaks * 0.04 + grain * 0.06) * (0.12 + diffuse * 1.08);
  rgb += palette(hue + 0.19) * fresnel * (0.34 + depth * 0.24);
  rgb += vec3<f32>(1.0, 0.93, 0.78) * spec * (0.42 + depth * 0.54);
  let edge_lift = smoothstep(0.0, 0.22, z);
  let alpha = mask * edge_lift * (0.34 + z * 0.54 + fresnel * 0.12);
  return vec4<f32>(rgb, alpha);
}

fn ray_sphere(ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, radius: f32) -> vec2<f32> {
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

fn native_balls_sample(uv: vec2<f32>) -> vec4<f32> {
  let intensity = clamp(u.params0.x, 0.0, 4.0);
  let scale = clamp(u.params0.y, 0.18, 4.0);
  let density = clamp(u.params0.z, 0.0, 1.0);
  let speed = clamp(u.params0.w, 0.0, 2.0);
  let style = clamp(u.params1.x, 0.0, 1.0);
  let variation = clamp(u.params1.y, 0.0, 1.0);
  let detail = clamp(u.params1.z, 0.0, 1.0);
  let bg_alpha = clamp(u.params1.w, 0.0, 1.0);
  let audio_on = u.audio2.w;
  let drive = (u.audio0.x * 0.38 + u.audio0.y * 0.32 + u.audio1.y * 0.34) * audio_on;
  let t = u.time * (0.18 + speed * 1.55) * (1.0 + drive * 0.42);
  let aspect = max(0.4, u.resolution.x / max(1.0, u.resolution.y));
  let lens = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0);
  let vignette = smoothstep(1.32, 0.14, length(lens));
  var col = vec3<f32>(0.012, 0.016, 0.032) + palette(style + 0.54) * vignette * 0.07 * bg_alpha;
  var alpha = 0.12 * bg_alpha;

  let ro = vec3<f32>(0.0, 0.05, 3.65);
  let rd = normalize(vec3<f32>(lens * (0.86 - detail * 0.08), -1.88));
  var closest_t = 1.0e6;
  var hit_color = vec3<f32>(0.0);
  var hit_alpha = 0.0;
  var volume_color = vec3<f32>(0.0);
  var volume_alpha = 0.0;
  var glow = vec3<f32>(0.0);
  var glow_energy = 0.0;
  var projected_color = vec3<f32>(0.0);
  var projected_alpha = 0.0;
  let count = 80 + i32(floor(detail * 32.0 + density * 24.0));
  for (var i: i32 = 0; i < 128; i = i + 1) {
    if (i >= count) {
      break;
    }
    let fi = f32(i);
    let phase = fi * 2.399963 + u.seed * 0.017;
    let depth = 0.5 + 0.5 * sin(t * (0.16 + fi * 0.009) + phase * 1.31);
    let lane = fi / max(1.0, f32(count - 1));
    let swirl = t * (0.18 + fi * 0.006) + phase;
    let center = vec3<f32>(
      sin(swirl) * (0.58 + density * 0.34 + lane * 0.18),
      cos(swirl * 0.78 + variation * 2.7) * (0.42 + density * 0.22) + sin(lane * 7.0 + t * 0.3) * 0.08,
      0.72 - lane * (3.15 + density * 0.92) + sin(swirl * 0.37 + phase) * 0.24
    );
    let jitter = hash21(vec2<f32>(fi, u.seed));
    let radius = (0.046 + scale * 0.026) * (0.76 + depth * 0.46 + variation * 0.24 * jitter);
    let hue = style + fi * 0.059 + t * 0.012 + jitter * 0.08;
    let view_depth = max(0.24, ro.z - center.z);
    let projection_scale = 1.88 / max(0.42, view_depth * (0.86 - detail * 0.08));
    let projected_lens = (center.xy - ro.xy) * projection_scale;
    let projected_uv = vec2<f32>(0.5) + projected_lens / vec2<f32>(aspect, 1.0);
    let projected_radius = clamp(radius * projection_scale * (0.78 + detail * 0.08), 0.004, 0.28);
    let projected = sphere_shade(uv, projected_uv, projected_radius, hue, depth, t);
    if (projected.a > 0.0001) {
      let projected_depth_fade = exp(-view_depth * (0.18 + density * 0.045));
      let projected_layer_alpha = clamp(projected.a * projected_depth_fade * (0.035 + (1.0 - lane) * 0.025), 0.0, 0.08);
      let remaining_alpha = 1.0 - projected_alpha;
      projected_color += projected.rgb * projected_layer_alpha * remaining_alpha;
      projected_alpha += projected_layer_alpha * remaining_alpha;
    }
    let hit = ray_sphere(ro, rd, center, radius);
    let ray_to_center = ro - center;
    let closest_on_ray = dot(center - ro, rd);
    let miss = length(ray_to_center + rd * closest_on_ray);
    let shell = max(0.0, 1.0 - miss / max(radius * (1.55 + density * 0.65), 0.0001));
    let halo = pow(shell, 3.2) * (0.05 + radius * 0.9) * (0.8 + density * 0.9);
    glow += palette(hue + 0.08) * halo * (0.52 + depth * 0.5);
    glow_energy += halo;
    if (hit.x > 0.02) {
      let pos = ro + rd * hit.x;
      let n = normalize(pos - center);
      let light_dir = normalize(vec3<f32>(-0.48 + 0.18 * sin(t * 0.24), 0.58, 0.66));
      let rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.05);
      let diffuse = pow(clamp(dot(n, light_dir) * 0.5 + 0.5, 0.0, 1.0), 1.16);
      let spec = pow(max(dot(reflect(-light_dir, n), -rd), 0.0), 54.0);
      let hit_width = hit.y / max(radius, 0.0001);
      let tangent_softness = smoothstep(0.0, max(0.14, 0.22 + fwidth(hit_width) * 6.5), hit_width);
      let grain = fbm(n.xy * (2.2 + detail * 4.2) + vec2<f32>(t * 0.025, -t * 0.017));
      var sphere_color = palette(hue + grain * 0.055) * (0.12 + diffuse * 1.12);
      sphere_color += palette(hue + 0.22) * rim * (0.32 + depth * 0.28);
      sphere_color += vec3<f32>(1.0, 0.94, 0.82) * spec * (0.56 + depth * 0.54);
      sphere_color *= 0.68 + (1.0 - lane) * 0.22;
      let sphere_alpha = clamp(tangent_softness * (0.70 + rim * 0.18), 0.0, 1.0);
      let depth_fade = exp(-max(hit.x, 0.0) * (0.18 + density * 0.05));
      volume_color += sphere_color * sphere_alpha * depth_fade * (0.022 + density * 0.020);
      volume_alpha += sphere_alpha * depth_fade * 0.021;
      if (hit.x < closest_t) {
        closest_t = hit.x;
        hit_color = sphere_color;
        hit_alpha = sphere_alpha;
      }
    }
  }
  let haze = fbm(uv * (1.8 + detail * 6.4) + vec2<f32>(t * 0.12, -t * 0.09));
  let bloom = smoothstep(0.0, 0.42 + density * 0.38, glow_energy);
  col = mix(col + glow + volume_color, hit_color + glow * 0.45 + volume_color * 0.7, hit_alpha);
  let projected_mix = clamp(projected_alpha * (0.10 + detail * 0.04), 0.0, 0.14);
  col = mix(col, projected_color + glow * 0.22 + volume_color * 0.42, projected_mix);
  col += projected_color * smoothstep(0.03, 0.36, projected_alpha) * (0.025 + density * 0.035);
  col += palette(style + 0.43) * haze * (0.06 + variation * 0.25);
  col += palette(style + 0.18 + drive * 0.06) * bloom * (0.10 + detail * 0.18);
  col *= 0.46 + intensity * 0.72 + drive * 0.36;
  alpha = max(alpha, clamp(hit_alpha + projected_alpha * 0.32 + bloom * 0.22 + glow_energy * 0.45 + volume_alpha, 0.0, 1.0));
  return vec4<f32>(max(col, vec3<f32>(0.0)), clamp(alpha, 0.0, 1.0));
}

fn native_balls(uv: vec2<f32>) -> vec4<f32> {
  let detail = clamp(u.params1.z, 0.0, 1.0);
  let px = vec2<f32>(1.0) / max(vec2<f32>(1.0), u.resolution);
  let center = native_balls_sample(uv);
  let a = native_balls_sample(uv + px * vec2<f32>(0.58, 0.0));
  let b = native_balls_sample(uv + px * vec2<f32>(-0.58, 0.0));
  let c = native_balls_sample(uv + px * vec2<f32>(0.0, 0.58));
  let d = native_balls_sample(uv + px * vec2<f32>(0.0, -0.58));
  let five_tap = (center * 4.0 + a + b + c + d) / 8.0;
  if (detail < 0.52) {
    let aa = clamp(0.42 + detail * 0.34, 0.42, 0.60);
    return mix(center, five_tap, aa);
  }
  let e = native_balls_sample(uv + px * vec2<f32>(0.42, 0.42));
  let f = native_balls_sample(uv + px * vec2<f32>(-0.42, 0.42));
  let g = native_balls_sample(uv + px * vec2<f32>(0.42, -0.42));
  let h = native_balls_sample(uv + px * vec2<f32>(-0.42, -0.42));
  let averaged = (center * 4.0 + (a + b + c + d) * 2.0 + e + f + g + h) / 16.0;
  let aa = clamp(0.62 + detail * 0.22, 0.62, 0.86);
  return mix(center, averaged, aa);
}

fn native_planet(uv: vec2<f32>) -> vec4<f32> {
  let intensity = clamp(u.params0.x, 0.0, 4.0);
  let scale = clamp(u.params0.y, 0.18, 4.0);
  let style = clamp(u.params1.x, 0.0, 1.0);
  let detail = clamp(u.params1.z, 0.0, 1.0);
  let p = (uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(max(0.4, u.resolution.x / max(1.0, u.resolution.y)), 1.0);
  let r = length(p);
  let body_radius = clamp(0.52 * sqrt(scale), 0.22, 0.84);
  let body = 1.0 - smoothstep(body_radius, body_radius + 0.01, r);
  let nxy = p / max(body_radius, 0.0001);
  let z = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  let longitude = atan2(nxy.y, nxy.x) + u.time * 0.18;
  let bands = 0.5 + 0.5 * sin(nxy.y * (16.0 + detail * 38.0) + sin(longitude * 5.0) * 0.9);
  let light = pow(clamp(dot(normalize(vec3<f32>(nxy, z)), normalize(vec3<f32>(-0.35, 0.58, 0.73))) * 0.5 + 0.5, 0.0, 1.0), 1.25);
  var col = palette(style + bands * 0.13 + longitude * 0.015) * (0.22 + light * 1.05) * body;
  let ring_y = p.y + 0.13;
  let ring = (1.0 - smoothstep(0.012, 0.042, abs(ring_y))) * smoothstep(body_radius * 0.92, body_radius * 1.2, abs(p.x)) * (1.0 - smoothstep(body_radius * 1.9, body_radius * 2.3, abs(p.x)));
  col += palette(style + 0.55) * ring * 0.85;
  col *= 0.42 + intensity * 0.72;
  return vec4<f32>(col, max(body, ring * 0.72));
}

fn native_pixel_particles(uv: vec2<f32>) -> vec4<f32> {
  let intensity = clamp(u.params0.x, 0.0, 4.0);
  let scale = clamp(u.params0.y, 0.18, 4.0);
  let density = clamp(u.params0.z, 0.0, 1.0);
  let speed = clamp(u.params0.w, 0.0, 2.0);
  let style = clamp(u.params1.x, 0.0, 1.0);
  let variation = clamp(u.params1.y, 0.0, 1.0);
  let detail = clamp(u.params1.z, 0.0, 1.0);
  let bg_alpha = clamp(u.params1.w, 0.0, 1.0);
  let t = u.time * (0.28 + speed * 1.55);
  let audio_on = u.audio2.w;
  let drive = (u.audio0.x * 0.35 + u.audio0.y * 0.38 + u.audio1.y * 0.45) * audio_on;
  let aspect = max(0.5, u.resolution.x / max(1.0, u.resolution.y));
  let p = (uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
  let grid_count = mix(18.0, 96.0, density) / sqrt(scale);
  let flow = vec2<f32>(sin(t * 0.51 + style * 6.2831853), cos(t * 0.43 + variation * 5.2)) * (0.24 + drive * 0.08);
  let grid_uv = uv * grid_count + flow;
  let cell = floor(grid_uv);
  let f = fract(grid_uv) - vec2<f32>(0.5);
  let jitter = vec2<f32>(
    hash21(cell + vec2<f32>(u.seed, 3.17)),
    hash21(cell.yx + vec2<f32>(8.11, u.seed))
  ) - vec2<f32>(0.5);
  let spark_dist = length(f - jitter * (0.28 + variation * 0.24));
  let spark = exp(-spark_dist * spark_dist * mix(42.0, 210.0, detail)) * step(0.42 - density * 0.26, hash21(cell + 19.7));
  let scan = smoothstep(0.025, 0.0, abs(fract((p.x - p.y) * (3.0 + detail * 11.0) + t * 0.24) - 0.5));
  let tunnel = pow(1.0 - abs(fract(length(p) * mix(4.5, 14.0, detail) - t * 0.8 + style) - 0.5) * 2.0, 3.0 + variation * 4.0);
  var col = vec3<f32>(0.012, 0.018, 0.034) * bg_alpha;
  col += palette(hash21(cell) * 0.18 + style + t * 0.018) * spark * (1.1 + drive * 0.8);
  col += palette(style + 0.27) * tunnel * (0.12 + density * 0.24);
  col += palette(style + 0.62) * scan * (0.08 + variation * 0.2);
  col *= 0.5 + intensity * 0.78 + drive * 0.32;
  let alpha = clamp(bg_alpha * (0.28 + spark * 0.86 + tunnel * 0.24 + scan * 0.18), 0.0, 1.0);
  return vec4<f32>(max(col, vec3<f32>(0.0)), alpha);
}

fn native_flythrough(uv: vec2<f32>) -> vec4<f32> {
  let intensity = clamp(u.params0.x, 0.0, 4.0);
  let scale = clamp(u.params0.y, 0.18, 4.0);
  let density = clamp(u.params0.z, 0.0, 1.0);
  let speed = clamp(u.params0.w, 0.0, 2.0);
  let style = clamp(u.params1.x, 0.0, 1.0);
  let variation = clamp(u.params1.y, 0.0, 1.0);
  let detail = clamp(u.params1.z, 0.0, 1.0);
  let bg_alpha = clamp(u.params1.w, 0.0, 1.0);
  let t = u.time * (0.18 + speed * 1.65);
  let aspect = max(0.5, u.resolution.x / max(1.0, u.resolution.y));
  var p = (uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
  let audio_on = u.audio2.w;
  let beat = u.audio1.y * audio_on;
  let twist = atan2(p.y, p.x) + length(p) * (1.5 + variation * 4.5) - t * (0.42 + beat * 0.22);
  let radial = length(p) + 0.08 * sin(t * 0.5 + twist * 3.0);
  let depth = 1.0 / max(0.08, radial);
  let lane_count = 10.0 + detail * 34.0;
  let lanes = smoothstep(0.05, 0.0, abs(fract(twist / 6.2831853 * lane_count + t * 0.12) - 0.5));
  let rings = pow(1.0 - abs(fract(depth * (0.32 + density * 0.92) - t * (0.56 + speed * 0.7)) - 0.5) * 2.0, 4.0 + detail * 4.0);
  let stars = smoothstep(0.94 - density * 0.24, 1.0, value_noise(vec2<f32>(twist * 3.0, depth * 1.8) + u.seed));
  let vignette = smoothstep(1.35, 0.18, radial / sqrt(scale));
  var col = vec3<f32>(0.006, 0.01, 0.022) * bg_alpha;
  col += palette(style + depth * 0.012 + t * 0.02) * lanes * rings * (0.72 + beat * 0.55);
  col += palette(style + 0.42) * stars * rings * 0.42;
  col += vec3<f32>(0.08, 0.6, 1.0) * pow(vignette, 1.8) * 0.05;
  col *= 0.55 + intensity * 0.82;
  let alpha = clamp(bg_alpha * (0.22 + lanes * rings * 0.66 + stars * 0.32), 0.0, 1.0);
  return vec4<f32>(max(col, vec3<f32>(0.0)), alpha);
}

fn native_point_cloud(uv: vec2<f32>) -> vec4<f32> {
  let intensity = clamp(u.params0.x, 0.0, 4.0);
  let scale = clamp(u.params0.y, 0.18, 4.0);
  let density = clamp(u.params0.z, 0.0, 1.0);
  let speed = clamp(u.params0.w, 0.0, 2.0);
  let style = clamp(u.params1.x, 0.0, 1.0);
  let variation = clamp(u.params1.y, 0.0, 1.0);
  let detail = clamp(u.params1.z, 0.0, 1.0);
  let bg_alpha = clamp(u.params1.w, 0.0, 1.0);
  let t = u.time * (0.15 + speed * 0.95);
  let aspect = max(0.5, u.resolution.x / max(1.0, u.resolution.y));
  let p = (uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
  var col = vec3<f32>(0.006, 0.011, 0.019) * bg_alpha;
  var alpha = 0.18 * bg_alpha;
  let rings = 9 + i32(floor(detail * 18.0 + density * 12.0));
  for (var i: i32 = 0; i < 32; i = i + 1) {
    if (i >= rings) {
      break;
    }
    let fi = f32(i);
    let z = fi / max(1.0, f32(rings - 1));
    let angle = fi * 2.399963 + t * (0.34 + fi * 0.006) + u.seed * 0.01;
    let ring_radius = mix(0.12, 1.05 + scale * 0.10, z);
    let center = vec2<f32>(cos(angle), sin(angle * (0.85 + variation * 0.25))) * ring_radius * (0.34 + density * 0.32);
    let local = p - center;
    let radial = abs(length(local) - ring_radius * (0.30 + 0.15 * sin(angle)));
    let bead = exp(-radial * radial * mix(180.0, 720.0, detail)) * smoothstep(1.35, 0.05, length(p));
    let sparkle = pow(0.5 + 0.5 * sin(angle * 7.0 + t * 2.0 + radial * 32.0), 5.0);
    let c = palette(style + z * 0.34 + sparkle * 0.05);
    col += c * bead * (0.05 + sparkle * 0.12 + density * 0.08);
    alpha = max(alpha, bead * (0.16 + sparkle * 0.22));
  }
  let dust = smoothstep(0.68 - density * 0.2, 1.0, fbm(uv * (10.0 + detail * 22.0) + vec2<f32>(t * 0.24, -t * 0.18)));
  col += palette(style + 0.18) * dust * (0.04 + variation * 0.18);
  col *= 0.54 + intensity * 0.86;
  return vec4<f32>(max(col, vec3<f32>(0.0)), clamp(alpha + dust * 0.2, 0.0, 1.0));
}

fn native_particle_field(uv: vec2<f32>) -> vec4<f32> {
  let intensity = clamp(u.params0.x, 0.0, 4.0);
  let scale = clamp(u.params0.y, 0.18, 4.0);
  let density = clamp(u.params0.z, 0.0, 1.0);
  let speed = clamp(u.params0.w, 0.0, 2.0);
  let style = clamp(u.params1.x, 0.0, 1.0);
  let variation = clamp(u.params1.y, 0.0, 1.0);
  let detail = clamp(u.params1.z, 0.0, 1.0);
  let bg_alpha = clamp(u.params1.w, 0.0, 1.0);
  let audio_on = u.audio2.w;
  let drive = (u.audio0.x * 0.24 + u.audio0.y * 0.45 + u.audio1.y * 0.38) * audio_on;
  let t = u.time * (0.16 + speed * 1.35) * (1.0 + drive * 0.35);
  let aspect = max(0.5, u.resolution.x / max(1.0, u.resolution.y));
  let p = (uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
  let r = length(p);
  var col = vec3<f32>(0.005, 0.011, 0.018) * bg_alpha;
  var alpha = 0.20 * bg_alpha;
  let well_count = 3 + i32(floor(detail * 6.0));
  var field = 0.0;
  var filament = 0.0;
  for (var i: i32 = 0; i < 9; i = i + 1) {
    if (i >= well_count) {
      break;
    }
    let fi = f32(i);
    let a = t * (0.34 + fi * 0.073) + fi * 2.399963 + u.seed * 0.03;
    let c = vec2<f32>(
      cos(a + sin(t * 0.17 + fi) * variation),
      sin(a * (0.82 + variation * 0.18))
    ) * (0.18 + density * 0.42 + 0.05 * fi);
    let d = length(p - c);
    let well = exp(-d * d * (7.0 + density * 14.0));
    field += well;
    let dir = normalize(c + vec2<f32>(0.0001, -0.0003));
    let line = abs(dot(p - c, vec2<f32>(-dir.y, dir.x)));
    filament += smoothstep(0.035 + scale * 0.006, 0.0, line) * smoothstep(0.78, 0.02, d);
  }
  let swirl = sin(r * (18.0 + detail * 44.0) - t * 2.2 + atan2(p.y, p.x) * (4.0 + variation * 12.0));
  let arms = pow(1.0 - smoothstep(0.0, 0.92, abs(swirl)), 1.5 + detail * 2.4) * smoothstep(1.45, 0.12, r / sqrt(scale));
  let grid_scale = mix(28.0, 110.0, density) / sqrt(scale);
  let star_cell = floor(uv * grid_scale + vec2<f32>(t * 0.22, -t * 0.15));
  let star_f = fract(uv * grid_scale + vec2<f32>(t * 0.22, -t * 0.15)) - vec2<f32>(0.5);
  let stars = exp(-dot(star_f, star_f) * mix(70.0, 260.0, detail)) * step(0.90 - density * 0.28, hash21(star_cell));
  let haze = fbm(uv * (2.6 + density * 8.0) + vec2<f32>(t * 0.12, -t * 0.09));
  col += palette(style + r * 0.08 + t * 0.018) * arms * (0.42 + drive * 0.2);
  col += palette(style + 0.19) * field * (0.18 + variation * 0.36);
  col += palette(style + 0.54) * filament * (0.10 + density * 0.24);
  col += palette(style + 0.78) * stars * (0.64 + drive * 0.48);
  col += palette(style + 0.35) * haze * (0.03 + density * 0.10);
  col *= 0.52 + intensity * 0.78 + drive * 0.28;
  alpha = max(alpha, clamp(arms * 0.44 + field * 0.24 + filament * 0.28 + stars * 0.82 + haze * 0.08, 0.0, 1.0));
  return vec4<f32>(max(col, vec3<f32>(0.0)), clamp(alpha, 0.0, 1.0));
}

fn native_smoke(uv: vec2<f32>) -> vec4<f32> {
  let intensity = clamp(u.params0.x, 0.0, 4.0);
  let scale = clamp(u.params0.y, 0.18, 4.0);
  let density = clamp(u.params0.z, 0.0, 1.0);
  let speed = clamp(u.params0.w, 0.0, 2.0);
  let style = clamp(u.params1.x, 0.0, 1.0);
  let variation = clamp(u.params1.y, 0.0, 1.0);
  let detail = clamp(u.params1.z, 0.0, 1.0);
  let t = u.time * (0.12 + speed * 1.2);
  let p = uv * 2.0 - vec2<f32>(1.0);
  let r = length(p * vec2<f32>(max(0.5, u.resolution.x / max(1.0, u.resolution.y)), 1.0));
  let drift = vec2<f32>(t * 0.11 + u.seed * 0.01, -t * 0.082);
  let smoke = fbm(uv * (2.0 + density * 3.0) + drift)
    + 0.55 * fbm(uv * (4.4 + detail * 8.0) - drift.yx * (1.0 + variation))
    + 0.24 * fbm(uv * (8.0 + detail * 14.0) + drift * 2.1);
  let plume = smoothstep(0.28 - density * 0.20, 1.18, smoke) * (1.0 - smoothstep(0.58 + scale * 0.05, 1.26 + scale * 0.12, r));
  let ember = smoothstep(0.94 - detail * 0.18, 1.0, value_noise(uv * (18.0 + density * 28.0) + vec2<f32>(t * 1.8, u.seed)));
  var col = mix(vec3<f32>(0.035, 0.055, 0.075), palette(style + 0.1) * 0.92, plume);
  col += palette(smoke * 0.18 + t * 0.04 + style) * ember * (0.2 + variation * 0.55);
  col *= 0.42 + intensity * 0.72;
  return vec4<f32>(col, clamp(0.32 + plume * 0.54 + ember * 0.20, 0.0, 1.0));
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  if (abs(u.source_kind - 10.0) < 0.5) {
    return native_planet(in.uv);
  }
  if (abs(u.source_kind - 11.0) < 0.5) {
    return native_pixel_particles(in.uv);
  }
  if (abs(u.source_kind - 12.0) < 0.5) {
    return native_flythrough(in.uv);
  }
  if (abs(u.source_kind - 13.0) < 0.5) {
    return native_point_cloud(in.uv);
  }
  if (abs(u.source_kind - 14.0) < 0.5) {
    return native_particle_field(in.uv);
  }
  if (abs(u.source_kind - 15.0) < 0.5) {
    return native_balls(in.uv);
  }
  if (abs(u.source_kind - 16.0) < 0.5) {
    return native_smoke(in.uv);
  }
  return native_balls(in.uv);
}
