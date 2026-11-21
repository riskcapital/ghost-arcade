// Draws each point carried by its shard: out along a direction from the
// cloud's middle, turned about the shard's own axis, lit by a glint off the
// shard's face, with glowing cracks along the shard edges after a break.
@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read> shards: array<vec4<f32>>;

@vertex
fn vs_shatter(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {
  var out: PointOut;
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.color = vec3<f32>(0.0);
  out.quad = vec2<f32>(0.0);
  let point = points[ii];
  let rgba = unpack_point_color(point.w);
  if (rgba.a <= 0.02) {
    return out;
  }
  let sh = shards[ii];
  let amount = C.data[0].x;
  let spin = C.data[0].y;
  let heat = C.data[0].z;
  let seed = u32(C.data[1].y * 65535.0);
  var pivot = sh.xyz;
  var edge = sh.w;
  // Not yet assigned (the first frame): whole and uncracked.
  if (dot(pivot, pivot) == 0.0 && edge == 0.0) {
    pivot = point.xyz;
    edge = 1.0;
  }
  var pos = point.xyz;
  var nrm = shard_unit(pivot, 7u + seed);
  if (amount > 0.0) {
    let away = normalize(pivot + shard_unit(pivot, 3u + seed) * 0.45 + vec3<f32>(1e-4));
    let reach = C.data[0].w * (0.35 + 0.65 * shard_hash(pivot, 5u + seed));
    let axis = shard_unit(pivot, 11u + seed);
    let angle = spin * (0.4 + 1.2 * shard_hash(pivot, 13u)) * smoothstep(0.0, 0.35, amount);
    pos = pivot + rotate_axis(point.xyz - pivot, axis, angle) + away * reach * amount;
    nrm = rotate_axis(nrm, axis, angle);
  }
  let world = (C.model * vec4<f32>(pos, 1.0)).xyz;
  let clip = C.view_proj * vec4<f32>(world, 1.0);
  if (clip.w <= 0.01) {
    return out;
  }
  let crack = (1.0 - smoothstep(0.0, 0.09, edge));
  let corner = SPRITE_CORNERS[vi];
  let variation = 1.0 + C.data[2].x * (hash11(ii * 2654435761u) - 0.5) * 1.6;
  let size_px = C.cam.w * clamp(1.6 / clip.w, 0.55, 2.2) * variation * (1.0 + crack * heat * 0.6);
  let px = vec2<f32>(2.0 / C.res.x, 2.0 / C.res.y) * size_px;
  out.position = vec4<f32>(clip.xy + corner * px * clip.w, clip.z, clip.w);
  out.quad = corner;
  let scan = mix(C.bass.rgb * C.bass.w, rgba.rgb * C.base.rgb * 2.0 * C.bass.w, C.base.w) * C.look.x;
  // A glint when a tumbling shard's face turns toward the camera.
  let to_eye = normalize(C.cam.xyz - world);
  let light = normalize(vec3<f32>(0.4, 0.8, 0.45));
  let glint = pow(max(dot(reflect(-light, nrm), to_eye), 0.0), 18.0) * amount * C.data[1].w * (1.0 + C.data[2].w);
  // Cracks burn at the break and stay faintly lit while the shards are apart.
  let crack_light = crack * (heat * 1.0 + amount * 0.12) * C.data[1].z * (0.6 + 0.8 * C.data[2].y + 0.5 * C.data[2].z);
  let depth_fade = clamp(2.2 / clip.w, 0.25, 1.0);
  out.color = (scan * (1.0 - crack * amount * 0.5) + C.mid.rgb * C.mid.w * glint + C.high.rgb * C.high.w * crack_light)
    * C.look.z * rgba.a * depth_fade * 0.028;
  return out;
}
