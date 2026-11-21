// Cloud Pulse: a scanned point cloud lit by waves of light, one family per
// band, travelling out by radius, depth or height from an origin. The
// compute pass lights each point once per frame; sprite_draw.wgsl draws it.

@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(3) var<storage, read_write> sprites: array<Sprite>;

@compute @workgroup_size(64)
fn cs_pulse(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ii = gid.x;
  if (ii >= u32(C.res.w)) {
    return;
  }
  let point = points[ii];
  let rgba = unpack_point_color(point.w);
  if (rgba.a <= 0.02) {
    sprites[ii] = no_sprite();
    return;
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
    let front = select(exp(-x * x * 1.5), exp(x * C.look2.y) * 0.6 + exp(-x * x * 1.5) * 0.4, x < 0.0);
    let e = front * wave.z;
    // The very front burns toward white, so the wavefront reads as a line.
    let crest = exp(-x * x * 6.0) * wave.z;
    light += band_color(wave.w) * e + vec3<f32>(crest * 2.5);
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
    sprites[ii] = no_sprite();
    return;
  }
  let color = (scan * C.look.x + light * C.look.y) * C.look.z * rgba.a * depth_fade(clip.w);
  sprites[ii] = Sprite(clip, vec4<f32>(color, sprite_size(clip.w, 1.0 + min(energy, 3.0) * 0.35, ii)));
}
