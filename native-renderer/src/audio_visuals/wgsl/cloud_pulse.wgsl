// Cloud Pulse: a scanned point cloud lit by waves of light, one family per
// band, travelling out by radius, depth or height from an origin. Points are
// drawn as tiny additive sprites into the HDR accumulation.

@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read> av: array<f32>;

@vertex
fn vs_point(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {
  var out: PointOut;
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.color = vec3<f32>(0.0);
  out.quad = vec2<f32>(0.0);
  let point = points[ii];
  let rgba = unpack4x8unorm(bitcast<u32>(point.w));
  if (rgba.a <= 0.02) {
    return out;
  }
  let world = (C.model * vec4<f32>(point.xyz, 1.0)).xyz;
  var metric = length(world - C.origin.xyz);
  if (C.origin.w > 1.5) {
    metric = world.y - C.origin.y;
  } else if (C.origin.w > 0.5) {
    metric = dot(world - C.cam.xyz, C.forward.xyz) - dot(C.origin.xyz - C.cam.xyz, C.forward.xyz);
  }
  metric = abs(metric);
  var light = vec3<f32>(0.0);
  var energy = 0.0;
  let waves = u32(C.audio.w);
  for (var w = 0u; w < waves; w = w + 1u) {
    let wave = C.data[w];
    let x = (metric - wave.x) / max(wave.y, 1e-3);
    // A sharp leading edge, then a wake that dies away behind it.
    let front = select(exp(-x * x * 1.5), exp(x * 0.7) * 0.6 + exp(-x * x * 1.5) * 0.4, x < 0.0);
    let e = front * wave.z;
    light += band_color(wave.w) * e;
    energy += e;
  }
  let sparkle = pow(hash11(ii * 2654435761u + u32(C.audio.x * 24.0)), 24.0) * C.audio.z * C.forward.w;
  light += C.high.rgb * C.high.w * sparkle;
  energy += sparkle;
  let scan = mix(C.base.rgb, rgba.rgb * C.base.rgb * 2.0, C.base.w);
  // Displace along the direction away from the origin as the wave passes.
  let away = normalize(world - C.origin.xyz + vec3<f32>(1e-4));
  let moved = world + away * energy * C.look.w;
  let clip = C.view_proj * vec4<f32>(moved, 1.0);
  if (clip.w <= 0.01) {
    return out;
  }
  let corner = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0))[vi];
  let size_px = C.cam.w * clamp(1.6 / clip.w, 0.55, 2.2) * (1.0 + min(energy, 3.0) * 0.35);
  let px = vec2<f32>(2.0 / C.res.x, 2.0 / C.res.y) * size_px;
  out.position = vec4<f32>(clip.xy + corner * px * clip.w, clip.z, clip.w);
  out.quad = corner;
  let depth_fade = clamp(2.2 / clip.w, 0.25, 1.0);
  out.color = (scan * C.look.x + light * C.look.y) * C.look.z * rgba.a * depth_fade;
  return out;
}

