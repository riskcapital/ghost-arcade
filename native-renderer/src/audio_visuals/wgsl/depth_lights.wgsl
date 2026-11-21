// Depth Lights: the cloud as lights in space. Points fall into depth slices
// from the camera; each slice follows its own part of the spectrum, and its
// points switch on one by one as that slice's envelope rises (each point has
// its own threshold), so slices read as banks of lights going on and off.
// Block (C.data): [0..7] = 32 slice envelopes; [8] near, far, slices, on size.
// C.forward.w is the share of points that are lights.
@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(3) var<storage, read_write> sprites: array<Sprite>;

fn slice_level(k: u32) -> f32 {
  let v = C.data[k / 4u];
  let j = k % 4u;
  if (j == 0u) { return v.x; }
  if (j == 1u) { return v.y; }
  if (j == 2u) { return v.z; }
  return v.w;
}

@compute @workgroup_size(64)
fn cs_depth(@builtin(global_invocation_id) gid: vec3<u32>) {
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
  let clip = C.view_proj * vec4<f32>(world, 1.0);
  if (clip.w <= 0.01) {
    sprites[ii] = no_sprite();
    return;
  }
  let info = C.data[8];
  let slices = max(info.z, 1.0);
  let depth = dot(world - C.cam.xyz, C.forward.xyz);
  let s = clamp((depth - info.x) / max(info.y - info.x, 1e-3), 0.0, 0.9999) * slices;
  let k = u32(floor(s));
  let level = slice_level(k);
  // Only some points are lights; each switches on at its own level, so a
  // slice fills up light by light as its envelope rises.
  let is_light = hash11(ii * 1597334677u + 5u) < C.forward.w;
  let threshold = 0.12 + pow(hash11(ii * 2654435761u + 17u), 0.5) * 0.86;
  let on = select(0.0, smoothstep(threshold - 0.03, threshold + 0.03, level), is_light);
  // Slice colour runs between the two tones front to back.
  let tone = mix(C.mid.rgb * C.mid.w, C.high.rgb * C.high.w, s / slices);
  let scan = mix(C.base.rgb, rgba.rgb * C.base.rgb * 2.0, C.base.w) * C.look.x;
  // A lit point is a small, hot pinpoint; an unlit one a dim speck.
  let size = select(sprite_size(clip.w, 1.0), C.cam.w * info.w, on > 0.01);
  let color = (scan + tone * on * C.look.y) * C.look.z * rgba.a * depth_fade(clip.w);
  sprites[ii] = Sprite(clip, vec4<f32>(color, size));
}
