// Per point, once per frame (cs_shatter_points): the point carried by its
// shard, out along a direction from the cloud's middle and turned about the
// shard's own axis, lit by a glint off the shard's face, with glowing cracks
// along the shard edges after a break. Shards near the fracture's epicentre
// break first and furthest, so the scan's silhouette still reads mid-break.
// The result (clip position, colour, size) goes to `drawn`; the vertex
// shader only expands it into a sprite.
@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read> shards: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> drawn: array<vec4<f32>>;

struct Shaded {
  clip: vec4<f32>,
  color: vec3<f32>,
  size_px: f32,
}

fn shade_point(ii: u32) -> Shaded {
  var out: Shaded;
  out.clip = vec4<f32>(0.0, 0.0, 0.0, -1.0);
  out.color = vec3<f32>(0.0);
  out.size_px = 0.0;
  let point = points[ii];
  let rgba = unpack_point_color(point.w);
  if (rgba.a <= 0.02) {
    return out;
  }
  let sh = shards[ii];
  let whole = C.data[0].x;
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
  // The break spreads out from an epicentre on the cloud's surface.
  let stagger = C.data[3].x;
  let epicentre = shard_unit(vec3<f32>(C.data[1].y, 0.37, 0.71), 3u) * 0.45;
  let reach01 = clamp(length(pivot - epicentre) / 1.1, 0.0, 1.0);
  let amount = clamp(whole * (1.0 + stagger) - stagger * reach01, 0.0, 1.0);
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
  let crack = (1.0 - smoothstep(0.0, 0.09, edge)) * step(0.001, whole);
  let variation = 1.0 + C.data[2].x * (hash11(ii * 2654435761u) - 0.5) * 1.6;
  out.clip = clip;
  out.size_px = C.cam.w * clamp(1.6 / clip.w, 0.55, 2.2) * variation * (1.0 + crack * heat * 0.6);
  // The scan's own brightness is normalised per cloud (C.data[3].y).
  let scan = mix(C.bass.rgb * C.bass.w, rgba.rgb * C.base.rgb * 2.0 * C.bass.w, C.base.w) * C.look.x * C.data[3].y;
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

@compute @workgroup_size(64)
fn cs_shatter_points(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(C.res.w)) {
    return;
  }
  let s = shade_point(i);
  drawn[i * 2u] = s.clip;
  drawn[i * 2u + 1u] = vec4<f32>(s.color, s.size_px);
}

