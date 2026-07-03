// Ghost WGSL stdlib: color conversion, palette, and premult helpers.

fn ghost_luma709(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn ghost_luma601(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.299, 0.587, 0.114));
}

fn ghost_rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  var p: vec4<f32>;
  if (c.g < c.b) {
    p = vec4<f32>(c.b, c.g, K.w, K.z);
  } else {
    p = vec4<f32>(c.g, c.b, K.x, K.y);
  }
  var q: vec4<f32>;
  if (c.r < p.x) {
    q = vec4<f32>(p.x, p.y, p.w, c.r);
  } else {
    q = vec4<f32>(c.r, p.y, p.z, p.x);
  }
  let d = q.x - min(q.w, q.y);
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

fn ghost_hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn ghost_saturate_color(c: vec3<f32>, amount: f32) -> vec3<f32> {
  let g = vec3<f32>(ghost_luma709(c));
  return mix(g, c, amount);
}

fn ghost_apply_hsv_trim(c: vec3<f32>, hueShift: f32, saturation: f32, value: f32) -> vec3<f32> {
  var hsv = ghost_rgb2hsv(c);
  hsv.x = fract(hsv.x + hueShift);
  hsv.y = clamp(hsv.y * saturation, 0.0, 2.0);
  hsv.z = clamp(hsv.z * value, 0.0, 8.0);
  return ghost_hsv2rgb(hsv);
}

fn ghost_premul(c: vec3<f32>, alpha: f32) -> vec4<f32> {
  let a = clamp(alpha, 0.0, 1.0);
  return vec4<f32>(c * a, a);
}

fn ghost_palette4(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, d: vec3<f32>, t: f32) -> vec3<f32> {
  let x = fract(t);
  if (x < 0.3333333) {
    return mix(a, b, x * 3.0);
  }
  if (x < 0.6666667) {
    return mix(b, c, (x - 0.3333333) * 3.0);
  }
  return mix(c, d, (x - 0.6666667) * 3.0);
}
