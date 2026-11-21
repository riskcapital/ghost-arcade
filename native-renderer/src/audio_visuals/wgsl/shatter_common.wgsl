// Mesh Shatter (shatter.rs has the CPU side). C.data:
//   [0] spread amount, spin, crack heat, explode distance
//   [1] shard size, fracture seed, crack glow, glint
//   [2] size variation, drive level, mid level, high level
//   [3] break spread (stagger), scan brightness gain

fn shard_hash(pivot: vec3<f32>, salt: u32) -> f32 {
  let b = bitcast<vec3<u32>>(pivot);
  return hash11(pcg(b.x ^ pcg(b.y ^ pcg(b.z + salt))));
}

fn shard_unit(pivot: vec3<f32>, salt: u32) -> vec3<f32> {
  let z = shard_hash(pivot, salt) * 2.0 - 1.0;
  let a = shard_hash(pivot, salt + 101u) * 6.28318530718;
  let r = sqrt(max(1.0 - z * z, 0.0));
  return vec3<f32>(r * cos(a), z, r * sin(a));
}

fn rotate_axis(v: vec3<f32>, axis: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
