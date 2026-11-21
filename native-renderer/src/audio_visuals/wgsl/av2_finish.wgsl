// The composite of the second-set instruments: the shared post chain's
// composite plus the Look group's contrast (a power curve, so black stays
// black) and opacity. Joined after post.wgsl.

struct FinishU {
  grade: vec4<f32>, // contrast, opacity
}

@group(0) @binding(5) var<uniform> F: FinishU;

fn finish_grade(ldr: vec3<f32>) -> vec4<f32> {
  let c = pow(clamp(ldr, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(F.grade.x));
  let alpha = clamp(max(max(c.r, c.g), c.b) * 1.5, 0.0, 1.0) * F.grade.y;
  return vec4<f32>(c * F.grade.y, alpha);
}

fn finish_composite(uv: vec2<f32>, pos: vec2<f32>, extra_split: vec2<f32>) -> vec4<f32> {
  let c = uv - 0.5;
  let split = c * P.grade.y * (0.35 + length(c) * 1.6) + extra_split;
  let r = textureSampleLevel(src_tex, post_sampler, uv + split, 0.0).r;
  let g = textureSampleLevel(src_tex, post_sampler, uv, 0.0).g;
  let b = textureSampleLevel(src_tex, post_sampler, uv - split, 0.0).b;
  let br = textureSampleLevel(add_tex, post_sampler, uv + split * 2.0, 0.0).r;
  let bg = textureSampleLevel(add_tex, post_sampler, uv, 0.0).g;
  let bb = textureSampleLevel(add_tex, post_sampler, uv - split * 2.0, 0.0).b;
  let levels = max(P.misc.z, 1.0);
  var hdr = vec3<f32>(r, g, b) + vec3<f32>(br, bg, bb) * P.tint.rgb * (P.grade.x / levels);
  let vig = 1.0 - P.finish.x * smoothstep(0.25, 0.95, length(c * vec2<f32>(P.feedback.w, 1.0)) / max(P.feedback.w * 0.5, 0.5));
  hdr *= P.grade.z * vig;
  var ldr = srgb_encode(tone_map(hdr));
  let n = post_hash(pos, P.finish.z) + post_hash(pos + 17.0, P.finish.z) - 1.0;
  ldr = clamp(ldr + n * P.finish.y / 255.0, vec3<f32>(0.0), vec3<f32>(1.0));
  return finish_grade(ldr);
}

@fragment
fn fs_composite_finish(in: FullOut) -> @location(0) vec4<f32> {
  return finish_composite(in.uv, in.position.xy, vec2<f32>(0.0));
}
