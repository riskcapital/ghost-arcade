@group(0) @binding(0) var<storage, read> trail: array<TrailPoint>;
@group(0) @binding(1) var<uniform> U: RibbonU;
@group(0) @binding(2) var<storage, read> heads: array<Head>;

struct RibOut {
  @builtin(position) position: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) tangent: vec3<f32>,
  @location(2) side: vec3<f32>,
  @location(3) across: f32,
  @location(4) heat: f32,
  @location(5) fade: f32,
}

@vertex
fn vs_ribbon(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RibOut {
  var out: RibOut;
  out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  out.world = vec3<f32>(0.0);
  out.tangent = vec3<f32>(0.0, 1.0, 0.0);
  out.side = vec3<f32>(1.0, 0.0, 0.0);
  out.across = 0.0;
  out.heat = 0.0;
  out.fade = 0.0;
  let n = u32(U.clock.w);
  let segs = n - 1u;
  let ribbon = ii / segs;
  let k = ii % segs;
  // Only what this ribbon wrote since it (re)entered the river is drawn.
  let lived = u32(max(U.kink.w - heads[ii / segs].p.w, 0.0)) + 1u;
  let filled = min(u32(U.shape.x), lived);
  if (filled < 3u) {
    return out;
  }
  if (k + 1u >= filled) {
    return out;
  }
  let head = u32(U.clock.z);
  let base_i = ribbon * n;
  let a = trail[base_i + (head + n - k) % n];
  let b = trail[base_i + (head + n - k - 1u) % n];
  // Neighbours either side give smooth per-vertex tangents.
  let a0 = trail[base_i + (head + n - max(k, 1u) + 1u) % n];
  let b1 = trail[base_i + (head + n - min(k + 2u, filled - 1u)) % n];
  let corner = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u)[vi];
  let along = f32(corner / 2u);
  let side = f32(corner % 2u) * 2.0 - 1.0;
  let p = mix(a.a.xyz, b.a.xyz, along);
  let s = safe_normalize(mix(a.b.xyz, b.b.xyz, along), vec3<f32>(1.0, 0.0, 0.0));
  let w = mix(a.a.w, b.a.w, along);
  // 0 at the head, 1 at the oldest point drawn.
  let u = (f32(k) + along) / max(f32(filled - 1u), 1.0);
  let taper = smoothstep(0.0, 0.025, u) * pow(max(1.0 - u, 0.0), 0.55);
  let world = p + s * w * taper * side;
  out.position = U.view_proj * vec4<f32>(world, 1.0);
  out.world = world;
  let ta = safe_normalize(a0.a.xyz - b.a.xyz, vec3<f32>(0.0, 1.0, 0.0));
  let tb = safe_normalize(a.a.xyz - b1.a.xyz, ta);
  out.tangent = safe_normalize(mix(ta, tb, along), ta);
  out.side = s;
  out.across = side;
  out.heat = mix(a.b.w, b.b.w, along);
  out.fade = pow(max(1.0 - u, 0.0), 1.3);
  return out;
}

@fragment
fn fs_ribbon(in: RibOut) -> @location(0) vec4<f32> {
  let t = safe_normalize(in.tangent, vec3<f32>(0.0, 1.0, 0.0));
  var nrm = safe_normalize(cross(t, in.side), vec3<f32>(0.0, 0.0, 1.0));
  let to_eye = U.eye.xyz - in.world;
  let dist = length(to_eye);
  let v = to_eye / max(dist, 1e-4);
  // Two-sided silk: the face toward the camera picks the tone.
  let facing = dot(nrm, v) >= 0.0;
  nrm = select(-nrm, nrm, facing);
  let base = select(U.back.rgb * U.back.w, U.front.rgb * U.front.w, facing);
  let key = normalize(vec3<f32>(0.45, 0.85, 0.3));
  let rim_dir = normalize(vec3<f32>(-0.5, 0.2, -0.85));
  let diffuse = 0.08 + 0.92 * max(dot(nrm, key), 0.0);
  let half_v = normalize(key + v);
  // Anisotropic sheen along the ribbon (silk) and a tight highlight.
  let th = dot(t, half_v);
  let sheen = pow(sqrt(max(1.0 - th * th, 0.0)), 220.0);
  let spec = pow(max(dot(nrm, half_v), 0.0), 180.0);
  let rim = pow(1.0 - abs(dot(nrm, v)), 4.0);
  let hem = smoothstep(0.7, 1.0, abs(in.across));
  var col = base * diffuse + base * rim * 1.3;
  col += mix(base, U.core.rgb, 0.6) * (sheen * 0.5 + spec * 1.2) * U.env.w;
  // A hit's light rides down the ribbon with the history.
  col += U.core.rgb * U.core.w * in.heat * (0.05 + 0.25 * hem);
  col *= exp(-max(dist - 2.0, 0.0) * U.eye.w);
  col *= in.fade;
  return vec4<f32>(col, 1.0);
}
