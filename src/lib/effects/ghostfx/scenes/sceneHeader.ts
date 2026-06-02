// Shared WGSL preamble for fragment-only GhostFX scenes (Hyperdrive,
// Mandala, Spectra, ...). Provides:
//   - The same `Uniforms` struct that Drift uses, bound at @group(0)
//     @binding(0). The visualizer writes one uniform buffer per
//     frame, layout-matched in ghostfxVisualizer.ts (UNIFORM_FLOATS).
//   - Common helpers: hashing, value noise, 2D fbm, hsv2rgb, palette.
//   - A `vsMain` fullscreen-triangle vertex shader that emits UV in
//     [0,1] at @location(0).
//
// Each scene concatenates SCENE_HEADER + its own `fsMain` fragment
// shader. The visualizer's fallback render-pipeline path
// (_buildScenePipeline) uses entry points `vsMain` + `fsMain`.
//
// Reserved WGSL keywords to avoid in this file and in scenes:
// target, mat, texture, output, frame.

export const SCENE_HEADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  dt: f32,
  bassSlow: f32, midSlow: f32, trebSlow: f32,
  bassFast: f32, midFast: f32, trebFast: f32,
  energy: f32,
  beatPhase: f32,
  beatPulse: f32,
  amp: f32,
  hueShift: f32,
  exposure: f32,
  latticeThreshold: f32,
  vortexStrength: f32,
  pad: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

const TAU: f32 = 6.28318530718;
const PI:  f32 = 3.14159265359;

// Hashing
fn hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x = x * (x + 33.33);
  return fract(x * x);
}
fn hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(0.1031, 0.1030));
  q = q + dot(q, q.yx + 33.33);
  return fract((q.x + q.y) * q.x);
}
fn hash22(p: vec2<f32>) -> vec2<f32> {
  let n = sin(dot(p, vec2<f32>(127.1, 311.7)));
  return fract(vec2<f32>(n * 43758.5, n * 23421.6));
}

// 2D value noise + fbm
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u3 = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u3.x), mix(c, d, u3.x), u3.y) * 2.0 - 1.0;
}
fn fbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var v = 0.0;
  var amp = 0.5;
  let rot = mat2x2<f32>(0.8, 0.6, -0.6, 0.8);
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + amp * vnoise(p);
    p = rot * p * 2.0;
    amp = amp * 0.5;
  }
  return v;
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}
// Hue rotated by audio hueShift; intensity bumps saturation+value.
fn palette(t: f32, intensity: f32) -> vec3<f32> {
  let h = fract(0.92 + u.hueShift + t * 0.18);
  let s = clamp(0.55 + intensity * 0.30, 0.0, 1.0);
  let v = clamp(0.55 + intensity * 0.45, 0.0, 1.0);
  return hsv2rgb(vec3<f32>(h, s, v));
}

// Fullscreen-triangle VS — uv in [0,1] (origin top-left).
struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsOut;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}
`;
