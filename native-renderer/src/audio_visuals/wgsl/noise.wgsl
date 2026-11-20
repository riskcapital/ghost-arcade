// Hashes and 2D/3D curl noise shared by the audio-reactive instruments.

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn hash11(v: u32) -> f32 {
  return f32(pcg(v)) / 4294967295.0;
}

fn hash21(a: u32, b: u32) -> f32 {
  return hash11(a ^ pcg(b + 0x9e3779b9u));
}

fn grad2(ix: i32, iy: i32, seed: u32) -> vec2<f32> {
  let h = pcg(u32(ix) * 73856093u ^ u32(iy) * 19349663u ^ seed);
  let a = f32(h) / 4294967295.0 * 6.28318530717959;
  return vec2<f32>(cos(a), sin(a));
}

// Gradient noise with its analytic derivative: (value, d/dx, d/dy).
fn gnoise2(p: vec2<f32>, seed: u32) -> vec3<f32> {
  let i = floor(p);
  let f = p - i;
  let ix = i32(i.x);
  let iy = i32(i.y);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = grad2(ix, iy, seed);
  let gb = grad2(ix + 1, iy, seed);
  let gc = grad2(ix, iy + 1, seed);
  let gd = grad2(ix + 1, iy + 1, seed);
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2<f32>(1.0, 0.0));
  let vc = dot(gc, f - vec2<f32>(0.0, 1.0));
  let vd = dot(gd, f - vec2<f32>(1.0, 1.0));
  let value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
  let deriv = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
    + du * (vec2<f32>(vb - va, vc - va) + u.yx * (va - vb - vc + vd));
  return vec3<f32>(value, deriv);
}

// Divergence-free 2D flow: the curl of two octaves of gradient noise.
fn curl2(p: vec2<f32>, t: f32) -> vec2<f32> {
  let n1 = gnoise2(p + vec2<f32>(t * 0.37, -t * 0.21), 17u);
  let n2 = gnoise2(p * 2.13 + vec2<f32>(-t * 0.53, t * 0.41), 91u);
  let d = n1.yz + n2.yz * 0.5;
  return vec2<f32>(d.y, -d.x);
}

// A cheap divergence-free-ish 3D flow from three 2D curl slices.
fn curl3(p: vec3<f32>, t: f32) -> vec3<f32> {
  let a = curl2(p.xy, t);
  let b = curl2(p.yz + vec2<f32>(5.2, 1.3), t);
  let c = curl2(p.zx + vec2<f32>(-3.1, 7.7), t);
  return vec3<f32>(a.x + c.y, a.y + b.x, b.y + c.x);
}
