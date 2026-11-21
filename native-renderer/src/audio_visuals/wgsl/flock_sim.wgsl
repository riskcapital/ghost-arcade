// Cloud Flock: update every point and write its sprite, one pass.
// Block (C.data):
//   [0] dt, spring, curl strength, drag
//   [1] scatter impulse (this frame), cohesion, flow speed, time
//   [2] flock centre xyz, flow scale
//   [3] banding (pull toward the flow's ridges), alignment rate, cruise speed, separation
//   [4] edge light, 0, 0, 0
@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read_write> flock: array<FlockPoint>;
@group(0) @binding(3) var<storage, read_write> sprites: array<Sprite>;
@group(0) @binding(4) var<storage, read> grid: array<i32>;

struct GridSample {
  vel: vec3<f32>,   // summed velocity (not yet divided by count)
  count: f32,
  grad: vec3<f32>,  // d count / d cell
}

// Trilinear read of the neighbour grid between cell centres, with the
// gradient of the same interpolation, so nothing snaps to the cells (nearest
// reads drew the grid's stripes into the swarm).
fn grid_sample(p: vec3<f32>) -> GridSample {
  let g = (p / FLOCK_GRID_HALF * 0.5 + 0.5) * f32(FLOCK_GRID_N) - 0.5;
  let base = vec3<i32>(floor(g));
  let t = g - floor(g);
  var out: GridSample;
  out.vel = vec3<f32>(0.0);
  out.count = 0.0;
  out.grad = vec3<f32>(0.0);
  for (var k = 0u; k < 8u; k = k + 1u) {
    let o = vec3<i32>(i32(k & 1u), i32((k >> 1u) & 1u), i32((k >> 2u) & 1u));
    let c = base + o;
    let n = i32(FLOCK_GRID_N);
    if (any(c < vec3<i32>(0)) || any(c >= vec3<i32>(n))) {
      continue;
    }
    let cell = flock_cell_index(c) * 4u;
    let w3 = select(1.0 - t, t, vec3<bool>(o == vec3<i32>(1)));
    let w = w3.x * w3.y * w3.z;
    let count = f32(grid[cell + 3u]);
    out.count += w * count;
    out.vel += w * vec3<f32>(f32(grid[cell]), f32(grid[cell + 1u]), f32(grid[cell + 2u]));
    let s = select(vec3<f32>(-1.0), vec3<f32>(1.0), vec3<bool>(o == vec3<i32>(1)));
    out.grad += count * s * vec3<f32>(w3.y * w3.z, w3.x * w3.z, w3.x * w3.y);
  }
  return out;
}

// Uphill direction of a smooth 3D field built from three planar noises.
// Following it gathers points onto sheets: the dense bands of a murmuration
// with clear air between them (a curl flow alone keeps density even).
fn ridge3(p: vec3<f32>, t: f32) -> vec3<f32> {
  let a = gnoise2(p.xy + vec2<f32>(t * 0.2, 0.0), 41u);
  let b = gnoise2(p.yz + vec2<f32>(0.0, t * 0.17), 59u);
  let c = gnoise2(p.zx + vec2<f32>(t * 0.13, 3.0), 73u);
  return vec3<f32>(a.y + c.z, a.z + b.y, b.z + c.y);
}

fn flock_sprite(i: u32, f: FlockPoint, edge: f32) -> Sprite {
  let rgba = unpack_point_color(points[i].w);
  if (rgba.a <= 0.02) {
    return no_sprite();
  }
  let world = (C.model * vec4<f32>(f.p.xyz, 1.0)).xyz;
  let clip = C.view_proj * vec4<f32>(world, 1.0);
  if (clip.w <= 0.01) {
    return no_sprite();
  }
  let heat = clamp(f.p.w * C.look.w, 0.0, 1.0);
  let scan = mix(C.base.rgb, rgba.rgb * C.base.rgb * 2.0, C.base.w);
  let rest_col = scan * C.look.x;
  // The body of the swarm stays dark; its edges, where density falls away,
  // burn bright: crisp sheets instead of a lit cloud.
  let hot = mix(C.mid.rgb * C.mid.w, C.high.rgb * C.high.w, edge) * C.look.y;
  let color = mix(rest_col, hot * 1.2, smoothstep(0.15, 0.9, heat)) * C.look.z * rgba.a * depth_fade(clip.w);
  // Moving points draw finer and fainter each, so the swarm reads as crisp
  // grain with dense bands, not an additive haze.
  return Sprite(clip, vec4<f32>(color, sprite_size(clip.w, mix(1.0, 0.45, heat), i)));
}

@compute @workgroup_size(64)
fn cs_flock(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(C.res.w)) {
    return;
  }
  let dt = C.data[0].x;
  let rest = points[i].xyz;
  var f = flock[i];
  var edge = 0.0;
  if (f.v.w == 0.0) {
    // First frame of this cloud: start formed, at rest.
    f.p = vec4<f32>(rest, 0.0);
    f.v = vec4<f32>(0.0, 0.0, 0.0, 1.0 + hash11(i * 747796405u + 1u));
    flock[i] = f;
  } else if (dt > 0.0) {
    // dt 0 is a repeat render of the same frame: nothing moves.
    var pos = f.p.xyz;
    var vel = f.v.xyz;
    let seed = f.v.w;
    let center = C.data[2].xyz;
    let impulse = C.data[1].x;
    if (impulse > 0.0) {
      // A kick: burst out from the flock's centre, each point at its own pace.
      let jitter = vec3<f32>(hash11(i * 3u + 7u), hash11(i * 5u + 11u), hash11(i * 7u + 13u)) - 0.5;
      let out_dir = normalize(pos - center + jitter * 0.35);
      vel += out_dir * impulse * mix(0.4, 1.4, fract(seed * 7.13));
    }
    var acc = (rest - pos) * C.data[0].y + (center - pos) * C.data[1].y;
    // The swarm's flow is most of this pass's cost; a formed flock skips it.
    if (C.data[0].z > 0.0) {
      let t = C.data[1].w * C.data[1].z;
      let q = pos * C.data[2].w;
      // curl3 peaks around 4; scaled so "swarm" 1 is a strong but bounded flow.
      let flow = curl3(q, t);
      acc += flow * (C.data[0].z * 0.25);
      // Neighbours from the grid: their mean heading (alignment) and the
      // density around this point (separation down the gradient).
      let gs = grid_sample(pos);
      var heading = flow / max(length(flow), 1e-3);
      if (gs.count > 1.0) {
        let mean_v = gs.vel / (gs.count * FLOCK_FIXED);
        heading = normalize(mean_v * 3.0 + heading + vec3<f32>(1e-4));
      }
      vel += (heading * C.data[3].z - vel) * min(1.0, C.data[3].y * dt);
      let mean_count = max(C.res.w, 1.0) / f32(FLOCK_GRID_N * FLOCK_GRID_N * FLOCK_GRID_N);
      let crowd = gs.count / mean_count;
      // Push out of crowded cells: the sheets stay thin with dark air between.
      acc -= gs.grad / (mean_count * 8.0) * C.data[3].w * smoothstep(1.0, 6.0, crowd);

      if (C.data[3].x > 0.0) {
        // Drift straight onto the ridges (position, not force, so the
        // alignment above cannot smooth it away): dense bands, empty gaps.
        pos += ridge3(q * 6.0, t) * (C.data[3].x * 0.03 * dt);
      }
    }
    vel = vel * exp(-C.data[0].w * dt) + acc * dt;
    pos += vel * dt;
    f = FlockPoint(vec4<f32>(pos, length(vel)), vec4<f32>(vel, seed));
    flock[i] = f;
  }
  // Edge measure from the grid at the point's place now (also on a repeat
  // render, so it draws the same picture): how sharply density falls away.
  if (C.data[3].y > 0.0 && f.v.w != 0.0) {
    let gs = grid_sample(f.p.xyz);
    let mean_count = max(C.res.w, 1.0) / f32(FLOCK_GRID_N * FLOCK_GRID_N * FLOCK_GRID_N);
    // Where density falls away steeply relative to itself (the boundary of
    // a sheet), and only where there are enough points to call it a sheet.
    let rel = length(gs.grad) / max(gs.count, 1.0);
    edge = smoothstep(0.35, 0.8, rel) * smoothstep(3.0, 8.0, gs.count / mean_count)
      * smoothstep(0.0, 0.3, C.data[3].y) * C.data[4].x;
  }
  sprites[i] = flock_sprite(i, f, edge);
}
