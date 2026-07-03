// Ghost WGSL stdlib: noise and hashing helpers.
// Keep function names prefixed so modules can be included safely into
// existing shaders that already define local hash/noise helpers.

const GHOST_TAU: f32 = 6.28318530718;

fn ghost_hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x = x * (x + 33.33);
  return fract(x * x);
}

fn ghost_hash12(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  let q = p3 + dot(p3, p3.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn ghost_hash13(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7, 74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}

fn ghost_hash33(p: vec3<f32>) -> vec3<f32> {
  var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  q = q + dot(q, q.yxz + 33.33);
  return fract(vec3<f32>(q.x + q.y, q.y + q.z, q.z + q.x) * q.zyx);
}

fn ghost_value_noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = ghost_hash13(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = ghost_hash13(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = ghost_hash13(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = ghost_hash13(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = ghost_hash13(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = ghost_hash13(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = ghost_hash13(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = ghost_hash13(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  let nxy0 = mix(nx00, nx10, s.y);
  let nxy1 = mix(nx01, nx11, s.y);
  return mix(nxy0, nxy1, s.z) * 2.0 - 1.0;
}

fn ghost_curl_noise3(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = ghost_value_noise3(p + vec3<f32>(0.0, e, 0.0));
  let ax2 = ghost_value_noise3(p + vec3<f32>(0.0, -e, 0.0));
  let ay1 = ghost_value_noise3(p + vec3<f32>(0.0, 0.0, e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = ghost_value_noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = ghost_value_noise3(p + vec3<f32>(e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = ghost_value_noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  return vec3<f32>(ay1 - ay2, az1 - az2, ax1 - ax2) / (2.0 * e);
}
