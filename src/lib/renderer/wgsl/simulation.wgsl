// Ghost WGSL stdlib: simulation math helpers.

fn ghost_exp_decay(value: f32, decayPerSecond: f32, dt: f32) -> f32 {
  return value * exp(-max(decayPerSecond, 0.0) * max(dt, 0.0));
}

fn ghost_spring(current: f32, target_value: f32, stiffness: f32, dt: f32) -> f32 {
  let k = 1.0 - exp(-max(stiffness, 0.0) * max(dt, 0.0));
  return mix(current, target_value, k);
}

fn ghost_advect_pos(pos: vec3<f32>, vel: vec3<f32>, dt: f32, damping: f32) -> vec3<f32> {
  return pos + vel * max(dt, 0.0) * max(damping, 0.0);
}

fn ghost_wrap01(v: vec3<f32>) -> vec3<f32> {
  return fract(fract(v) + vec3<f32>(1.0));
}
