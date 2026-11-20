// HDR feedback + post chain (hdr_post.rs builds the passes):
//   fs_feedback   previous accumulation, advected and decayed, into the new one
//   fs_down_first 13-tap downsample with a soft knee and Karis weighting
//   fs_down       13-tap downsample
//   fs_up         3x3 tent upsample of the coarser level plus this level
//   fs_composite  scene + bloom, chromatic split, exposure, tone map, dither
// Every pass is a fullscreen triangle; uv (0,0) is the texture's first row.

struct PostU {
  // src texel size xy, dst texel size zw
  texel: vec4<f32>,
  // bloom strength, chromatic split, exposure, knee threshold
  grade: vec4<f32>,
  // vignette, dither, frame, burn (how far very hot light whitens)
  finish: vec4<f32>,
  // feedback: decay, outward zoom, swirl, aspect
  feedback: vec4<f32>,
  // time, flow amount, bloom level count, 0
  misc: vec4<f32>,
  // bloom tint rgb, 0
  tint: vec4<f32>,
}

@group(0) @binding(0) var<uniform> P: PostU;
@group(0) @binding(1) var src_tex: texture_2d<f32>;
@group(0) @binding(2) var post_sampler: sampler;
@group(0) @binding(3) var add_tex: texture_2d<f32>;

struct FullOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_full(@builtin(vertex_index) index: u32) -> FullOut {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  var out: FullOut;
  out.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

fn post_hash(p: vec2<f32>, salt: f32) -> f32 {
  let q = fract(p * vec2<f32>(0.1031, 0.1030) + salt * 0.0173);
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

fn flow_offset(p: vec2<f32>, t: f32) -> vec2<f32> {
  // Cheap smooth swirl field for the feedback smear (no texture reads).
  let a = sin(p.y * 3.1 + t * 0.7) + sin(p.x * 2.3 - t * 0.5) * 0.6;
  let b = cos(p.x * 2.7 - t * 0.6) + cos(p.y * 3.7 + t * 0.4) * 0.6;
  return vec2<f32>(a, b);
}

@fragment
fn fs_feedback(in: FullOut) -> @location(0) vec4<f32> {
  let aspect = P.feedback.w;
  var c = (in.uv - 0.5) * vec2<f32>(aspect, 1.0);
  let r = length(c);
  // Sample slightly inward so the picture drifts outward, with a slow turn.
  let zoom = 1.0 - P.feedback.y;
  let ang = P.feedback.z * (0.6 + r);
  let s = sin(ang);
  let co = cos(ang);
  c = vec2<f32>(c.x * co - c.y * s, c.x * s + c.y * co) * zoom;
  c += flow_offset(c * 2.0, P.misc.x) * P.misc.y;
  let uv = c / vec2<f32>(aspect, 1.0) + 0.5;
  let prev = textureSampleLevel(src_tex, post_sampler, uv, 0.0).rgb;
  let edge = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return vec4<f32>(prev * P.feedback.x * edge, 1.0);
}

fn tap(uv: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(src_tex, post_sampler, uv, 0.0).rgb;
}

fn karis(c: vec3<f32>) -> f32 {
  return 1.0 / (1.0 + max(max(c.r, c.g), c.b));
}

fn knee(c: vec3<f32>) -> vec3<f32> {
  let t = P.grade.w;
  let m = max(max(c.r, c.g), c.b);
  let soft = clamp(m - t * 0.5, 0.0, t) ;
  let w = max(soft * soft / max(t * 2.0, 1e-4), m - t) / max(m, 1e-4);
  return c * max(w, 0.0);
}

@fragment
fn fs_down_first(in: FullOut) -> @location(0) vec4<f32> {
  let d = P.texel.xy;
  let uv = in.uv;
  let a = tap(uv + d * vec2<f32>(-2.0, -2.0));
  let b = tap(uv + d * vec2<f32>(0.0, -2.0));
  let c = tap(uv + d * vec2<f32>(2.0, -2.0));
  let e = tap(uv + d * vec2<f32>(-2.0, 0.0));
  let f = tap(uv);
  let g = tap(uv + d * vec2<f32>(2.0, 0.0));
  let h = tap(uv + d * vec2<f32>(-2.0, 2.0));
  let i = tap(uv + d * vec2<f32>(0.0, 2.0));
  let j = tap(uv + d * vec2<f32>(2.0, 2.0));
  let k = tap(uv + d * vec2<f32>(-1.0, -1.0));
  let l = tap(uv + d * vec2<f32>(1.0, -1.0));
  let m = tap(uv + d * vec2<f32>(-1.0, 1.0));
  let n = tap(uv + d * vec2<f32>(1.0, 1.0));
  // Karis average per group keeps single hot pixels from flickering.
  let g0 = (k + l + m + n) * 0.25;
  let g1 = (a + b + e + f) * 0.25;
  let g2 = (b + c + f + g) * 0.25;
  let g3 = (e + f + h + i) * 0.25;
  let g4 = (f + g + i + j) * 0.25;
  let w0 = karis(g0) * 0.5;
  let w1 = karis(g1) * 0.125;
  let w2 = karis(g2) * 0.125;
  let w3 = karis(g3) * 0.125;
  let w4 = karis(g4) * 0.125;
  let sum = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / max(w0 + w1 + w2 + w3 + w4, 1e-4);
  return vec4<f32>(knee(sum), 1.0);
}

@fragment
fn fs_down(in: FullOut) -> @location(0) vec4<f32> {
  let d = P.texel.xy;
  let uv = in.uv;
  var sum = tap(uv) * 0.125;
  sum += (tap(uv + d * vec2<f32>(-1.0, -1.0)) + tap(uv + d * vec2<f32>(1.0, -1.0))
    + tap(uv + d * vec2<f32>(-1.0, 1.0)) + tap(uv + d * vec2<f32>(1.0, 1.0))) * 0.125;
  sum += (tap(uv + d * vec2<f32>(-2.0, -2.0)) + tap(uv + d * vec2<f32>(2.0, -2.0))
    + tap(uv + d * vec2<f32>(-2.0, 2.0)) + tap(uv + d * vec2<f32>(2.0, 2.0))) * 0.03125;
  sum += (tap(uv + d * vec2<f32>(0.0, -2.0)) + tap(uv + d * vec2<f32>(-2.0, 0.0))
    + tap(uv + d * vec2<f32>(2.0, 0.0)) + tap(uv + d * vec2<f32>(0.0, 2.0))) * 0.0625;
  return vec4<f32>(sum, 1.0);
}

@fragment
fn fs_up(in: FullOut) -> @location(0) vec4<f32> {
  // src = the coarser level (tent upsampled), add = this level.
  let d = P.texel.xy;
  let uv = in.uv;
  var sum = tap(uv) * 4.0;
  sum += (tap(uv + vec2<f32>(-d.x, 0.0)) + tap(uv + vec2<f32>(d.x, 0.0))
    + tap(uv + vec2<f32>(0.0, -d.y)) + tap(uv + vec2<f32>(0.0, d.y))) * 2.0;
  sum += tap(uv + vec2<f32>(-d.x, -d.y)) + tap(uv + vec2<f32>(d.x, -d.y))
    + tap(uv + vec2<f32>(-d.x, d.y)) + tap(uv + vec2<f32>(d.x, d.y));
  let here = textureSampleLevel(add_tex, post_sampler, uv, 0.0).rgb;
  return vec4<f32>(sum / 16.0 + here, 1.0);
}

fn srgb_encode(c: vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

// Filmic shoulder on the brightest channel, so saturated fringes keep their
// hue instead of turning orange; very hot light then burns toward white.
fn tone_map(c: vec3<f32>) -> vec3<f32> {
  let m = max(max(c.r, c.g), c.b);
  if (m <= 1e-6) {
    return vec3<f32>(0.0);
  }
  let a = 2.51;
  let b = 0.03;
  let cc = 2.43;
  let d = 0.59;
  let e = 0.14;
  let tm = clamp((m * (a * m + b)) / (m * (cc * m + d) + e), 0.0, 1.0);
  let hue = c / m;
  let burn = smoothstep(1.0, 9.0, m) * P.finish.w;
  return mix(hue, vec3<f32>(1.0), burn) * tm;
}

@fragment
fn fs_composite(in: FullOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let c = uv - 0.5;
  let split = c * P.grade.y * (0.35 + length(c) * 1.6);
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
  // Triangular dither, one 8-bit step wide, breaks up banding in the glow.
  let n = post_hash(in.position.xy, P.finish.z) + post_hash(in.position.xy + 17.0, P.finish.z) - 1.0;
  ldr = clamp(ldr + n * P.finish.y / 255.0, vec3<f32>(0.0), vec3<f32>(1.0));
  let alpha = clamp(max(max(ldr.r, ldr.g), ldr.b) * 1.5, 0.0, 1.0);
  return vec4<f32>(ldr, alpha);
}
