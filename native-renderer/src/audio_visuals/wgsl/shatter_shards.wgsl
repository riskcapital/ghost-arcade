// Assigns every point to a shard: the nearest of jittered seed points, one
// per cell of a grid the shard size wide (a Voronoi fracture). Records the
// pivot and how close the point is to the crack (the next nearest seed).
@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read_write> shards: array<vec4<f32>>;

fn cell_seed(cell: vec3<i32>, size: f32) -> vec3<f32> {
  let h = pcg(u32(cell.x) * 73856093u ^ u32(cell.y) * 19349663u ^ u32(cell.z) * 83492791u);
  let j = vec3<f32>(hash11(h), hash11(h ^ 0x9e3779b9u), hash11(h ^ 0x85ebca6bu));
  return (vec3<f32>(cell) + 0.15 + 0.7 * j) * size;
}

@compute @workgroup_size(64)
fn cs_shards(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(C.res.w)) {
    return;
  }
  let size = max(C.data[1].x, 0.01);
  let p = points[i].xyz;
  let base = vec3<i32>(floor(p / size));
  var d1 = 1e9;
  var d2 = 1e9;
  var pivot = p;
  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let s = cell_seed(base + vec3<i32>(x, y, z), size);
        let d = distance(p, s);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          pivot = s;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
  }
  shards[i] = vec4<f32>(pivot, (d2 - d1) / size);
}
