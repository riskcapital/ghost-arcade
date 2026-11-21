// Cloud Flock: live point state, next to the scan's rest positions.
struct FlockPoint {
  p: vec4<f32>, // position xyz (scan space), speed
  v: vec4<f32>, // velocity xyz, seed (0 = not yet placed)
}

// Coarse velocity and density grid the flock splats into every frame, so a
// point can fly with its neighbours (alignment) and find the edges of the
// sheet it belongs to. Fixed-point i32 per cell: vx, vy, vz, count.
const FLOCK_GRID_N: u32 = 32u;
const FLOCK_GRID_HALF: f32 = 1.5;
const FLOCK_FIXED: f32 = 1024.0;

fn flock_cell(p: vec3<f32>) -> vec3<i32> {
  let g = (p / FLOCK_GRID_HALF * 0.5 + 0.5) * f32(FLOCK_GRID_N);
  return clamp(vec3<i32>(floor(g)), vec3<i32>(0), vec3<i32>(i32(FLOCK_GRID_N) - 1));
}

fn flock_cell_index(c: vec3<i32>) -> u32 {
  let n = i32(FLOCK_GRID_N);
  let k = clamp(c, vec3<i32>(0), vec3<i32>(n - 1));
  return u32((k.z * n + k.y) * n + k.x);
}
