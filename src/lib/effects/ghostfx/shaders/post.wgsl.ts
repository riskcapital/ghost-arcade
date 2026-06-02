// GhostFX post-process WGSL — three pipelines share one source file
// because they all draw the same fullscreen triangle and need the
// same vertex shader.
//
//   pipeline A — extract + horizontal blur
//   pipeline B — vertical blur
//   pipeline C — composite (scene + bloom, ACES tonemap, vignette)
//
// HDR convention: scene texture is rgba16float written with values
// that may exceed 1.0 (specular highlights, halo glow). Bloom
// extracts pixels where any channel > threshold, blurs them, then
// composite adds (bloom × intensity) back to the LDR-tonemapped
// scene. Threshold + intensity are exposed as user params so a VJ
// can dial subtle → blown out.

export const POST_WGSL = /* wgsl */ `
struct Uniforms {
  resolution: vec2<f32>,         // full-res scene size
  bloomThreshold: f32,           // pixels above this contribute to bloom
  bloomIntensity: f32,           // how much bloom adds back at composite
  exposure: f32,                 // post-tonemap exposure
  vignette: f32,                 // 0..1 vignette strength
  padA: f32, padB: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var sceneTex: texture_2d<f32>;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;  // unused by extract; used by vBlur (samples hBlur output) and composite

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsOut;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}

// Karis-style perceptual bright-pass. Subtract threshold then push
// the remainder through a soft knee so we don't get hard halos
// around sharp specular spikes.
fn brightPass(c: vec3<f32>, threshold: f32) -> vec3<f32> {
  let knee = 0.5;
  let lum = max(max(c.r, c.g), c.b);
  let soft = clamp(lum - threshold + knee, 0.0, 2.0 * knee);
  let softFactor = soft * soft / (4.0 * knee + 0.0001);
  let amt = max(softFactor, lum - threshold) / max(lum, 0.0001);
  return c * amt;
}

// 9-tap separable gaussian. Weights pre-baked for sigma ~3.5.
// In hBlur we sample sceneTex with horizontal offsets after
// brightPass; in vBlur we sample bloomTex (the hBlur output) with
// vertical offsets and skip the bright pass.
const GAUSS_W: array<f32, 5> = array<f32, 5>(0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);

@fragment
fn fsExtractHBlur(in: VsOut) -> @location(0) vec4<f32> {
  // Half-res sampling — caller binds half-res target. Source pixel
  // step is in scene-space units so we use 2x the full-res inverse
  // to compensate for the downsample.
  let texel = vec2<f32>(2.0, 0.0) / u.resolution;
  var acc: vec3<f32> = brightPass(textureSampleLevel(sceneTex, srcSampler, in.uv, 0.0).rgb, u.bloomThreshold) * GAUSS_W[0];
  for (var i = 1; i < 5; i = i + 1) {
    let off = texel * f32(i);
    acc = acc + brightPass(textureSampleLevel(sceneTex, srcSampler, in.uv + off, 0.0).rgb, u.bloomThreshold) * GAUSS_W[i];
    acc = acc + brightPass(textureSampleLevel(sceneTex, srcSampler, in.uv - off, 0.0).rgb, u.bloomThreshold) * GAUSS_W[i];
  }
  return vec4<f32>(acc, 1.0);
}

@fragment
fn fsVBlur(in: VsOut) -> @location(0) vec4<f32> {
  // We're now sampling bloomTex (hBlur output, half-res). Use
  // bloomTex resolution implicitly via textureDimensions — keeps
  // the blur radius consistent regardless of target size.
  let dim = vec2<f32>(textureDimensions(bloomTex, 0));
  let texel = vec2<f32>(0.0, 1.0) / dim;
  var acc: vec3<f32> = textureSampleLevel(bloomTex, srcSampler, in.uv, 0.0).rgb * GAUSS_W[0];
  for (var i = 1; i < 5; i = i + 1) {
    let off = texel * f32(i);
    acc = acc + textureSampleLevel(bloomTex, srcSampler, in.uv + off, 0.0).rgb * GAUSS_W[i];
    acc = acc + textureSampleLevel(bloomTex, srcSampler, in.uv - off, 0.0).rgb * GAUSS_W[i];
  }
  return vec4<f32>(acc, 1.0);
}

// ACES Filmic tone curve — preserves highlight saturation better
// than Reinhard while keeping shadows rich. Fit-coefficient version
// from Stephen Hill / Krzysztof Narkowicz.
fn acesTonemap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fsComposite(in: VsOut) -> @location(0) vec4<f32> {
  let sceneRGBA = textureSampleLevel(sceneTex, srcSampler, in.uv, 0.0);
  let bloomRGB  = textureSampleLevel(bloomTex, srcSampler, in.uv, 0.0).rgb;
  let scene = sceneRGBA.rgb;

  // Additive bloom — multiply by user-tunable intensity. We DON'T
  // mix(bloom, scene, k) because that washes out shadows. Pure add
  // keeps blacks black, just lights bright regions.
  var col = scene + bloomRGB * u.bloomIntensity;

  // Exposure trim (user) → tonemap
  col = col * exp2(u.exposure);
  col = acesTonemap(col);

  // Smooth vignette in NDC space — frames the eye toward center
  // without obvious dark corners.
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  let p = vec2<f32>((in.uv.x * 2.0 - 1.0) * aspect, 1.0 - in.uv.y * 2.0);
  let vig = 1.0 - smoothstep(0.55, 1.30, length(p));
  col = col * mix(1.0, 0.85 + 0.15 * vig, u.vignette);

  // Alpha: union of scene coverage and bloom luminance — bloom halos
  // around bright particles should still be visible even where the
  // raw scene alpha is sparse. Tonemap above already clamped col to
  // [0,1], so taking max with col luma gives a reasonable cutoff.
  let bloomLuma = dot(bloomRGB * u.bloomIntensity, vec3<f32>(0.2126, 0.7152, 0.0722));
  var alpha = clamp(max(sceneRGBA.a, bloomLuma), 0.0, 1.0);
  // Premultiplied output — canvas is configured alphaMode:'premultiplied'
  // and the Three.js material reads premultipliedAlpha:true.
  return vec4<f32>(col * alpha, alpha);
}
`;
