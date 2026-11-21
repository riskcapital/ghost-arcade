// The post chain's composite for Shockwave Rings: the accumulated scene and
// its bloom are seen through every live front, a lens that magnifies across
// the front with a slight spectral split. Done at composite time (not in the
// feedback), so the lens never compounds frame over frame.
@group(0) @binding(4) var<uniform> S: ShockU;

fn shock_lens(uv: vec2<f32>) -> vec2<f32> {
  let aspect = P.feedback.w;
  let p = vec2<f32>((uv.x - 0.5) * 2.0 * aspect, (0.5 - uv.y) * 2.0);
  var off = vec2<f32>(0.0);
  let live = u32(S.clock.y);
  for (var r = 0u; r < live; r = r + 1u) {
    let ring = shock_seen(S.rings[r], S.view);
    let d = shock_d(p, ring);
    off += d.xy * S.field.y * ring.b.x * d.z * exp(-d.z * d.z);
  }
  return vec2<f32>(off.x / (2.0 * aspect), -off.y * 0.5);
}

@fragment
fn fs_composite_refract(in: FullOut) -> @location(0) vec4<f32> {
  let duv = shock_lens(in.uv);
  return finish_composite(in.uv - duv, in.position.xy, duv * S.look.w);
}
