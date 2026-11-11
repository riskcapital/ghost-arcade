// Scene 3D spike: bloom chain and final tone map.

struct Post {
  params: vec4f, // threshold, bloom strength, exposure, unused
}

@group(0) @binding(0) var<uniform> post: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: VsOut;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

fn down13(uv: vec2f) -> vec3f {
  let t = 1.0 / vec2f(textureDimensions(src));
  let a = textureSampleLevel(src, samp, uv + t * vec2f(-2.0, -2.0), 0.0).rgb;
  let b = textureSampleLevel(src, samp, uv + t * vec2f(0.0, -2.0), 0.0).rgb;
  let c = textureSampleLevel(src, samp, uv + t * vec2f(2.0, -2.0), 0.0).rgb;
  let d = textureSampleLevel(src, samp, uv + t * vec2f(-2.0, 0.0), 0.0).rgb;
  let e = textureSampleLevel(src, samp, uv, 0.0).rgb;
  let f = textureSampleLevel(src, samp, uv + t * vec2f(2.0, 0.0), 0.0).rgb;
  let g = textureSampleLevel(src, samp, uv + t * vec2f(-2.0, 2.0), 0.0).rgb;
  let h = textureSampleLevel(src, samp, uv + t * vec2f(0.0, 2.0), 0.0).rgb;
  let i = textureSampleLevel(src, samp, uv + t * vec2f(2.0, 2.0), 0.0).rgb;
  let j = textureSampleLevel(src, samp, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  let k = textureSampleLevel(src, samp, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(src, samp, uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  let m = textureSampleLevel(src, samp, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}

@fragment
fn fs_down_first(in: VsOut) -> @location(0) vec4f {
  let c = down13(in.uv);
  let luma = max(c.r, max(c.g, c.b));
  let knee = post.params.x * 0.5;
  let soft = clamp(luma - post.params.x + knee, 0.0, 2.0 * knee);
  let w = max(soft * soft / (4.0 * knee + 1e-4), luma - post.params.x) / max(luma, 1e-4);
  return vec4f(c * w, 1.0);
}

@fragment
fn fs_down(in: VsOut) -> @location(0) vec4f {
  return vec4f(down13(in.uv), 1.0);
}

@fragment
fn fs_up(in: VsOut) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  var c = textureSampleLevel(src, samp, in.uv, 0.0).rgb * 4.0;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(-1.0, 0.0), 0.0).rgb * 2.0;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(1.0, 0.0), 0.0).rgb * 2.0;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(0.0, -1.0), 0.0).rgb * 2.0;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(0.0, 1.0), 0.0).rgb * 2.0;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  return vec4f(c / 16.0, 0.0);
}

@group(0) @binding(3) var bloom: texture_2d<f32>;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_composite(in: VsOut) -> @location(0) vec4f {
  let scene = textureSampleLevel(src, samp, in.uv, 0.0).rgb;
  let glow = textureSampleLevel(bloom, samp, in.uv, 0.0).rgb;
  let hdr = (scene + glow * post.params.y) * post.params.z;
  let mapped = pow(aces(hdr), vec3f(1.0 / 2.2));
  return vec4f(mapped, 1.0);
}
