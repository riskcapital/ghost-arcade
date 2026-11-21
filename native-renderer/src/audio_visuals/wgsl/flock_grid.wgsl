// Cloud Flock neighbour grid: clear it, then splat every point's velocity
// and a count into its cell (fixed point, atomic adds). The update pass
// reads it back. Block (C.data) [3].y is the alignment rate: 0 = the flock
// is formed and nothing is splatted.
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read> flock: array<FlockPoint>;
@group(0) @binding(4) var<storage, read_write> grid: array<atomic<i32>>;

@compute @workgroup_size(64)
fn cs_grid_clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < FLOCK_GRID_N * FLOCK_GRID_N * FLOCK_GRID_N * 4u) {
    atomicStore(&grid[gid.x], 0);
  }
}

@compute @workgroup_size(64)
fn cs_grid_splat(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(C.res.w) || C.data[3].y <= 0.0) {
    return;
  }
  let f = flock[i];
  if (f.v.w == 0.0) {
    return;
  }
  let cell = flock_cell_index(flock_cell(f.p.xyz)) * 4u;
  // Clamped so a full cell cannot overflow i32.
  let v = vec3<i32>(clamp(f.v.xyz, vec3<f32>(-2.0), vec3<f32>(2.0)) * FLOCK_FIXED);
  atomicAdd(&grid[cell], v.x);
  atomicAdd(&grid[cell + 1u], v.y);
  atomicAdd(&grid[cell + 2u], v.z);
  atomicAdd(&grid[cell + 3u], 1);
}
