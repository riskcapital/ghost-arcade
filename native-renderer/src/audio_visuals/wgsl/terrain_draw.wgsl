@group(0) @binding(0) var<storage, read> rows: array<f32>;
@group(0) @binding(1) var<uniform> T: TerrainU;

struct TerrOut {
  @builtin(position) position: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) cell: vec2<f32>,
  @location(3) age: f32,
}

// Height at column c (0..cols) and row age r (0 = newest).
fn terrain_h(c: i32, r: i32) -> f32 {
  let cols = i32(T.grid.x);
  let n = i32(T.grid.y);
  let bins = i32(T.grid.z);
  let filled = i32(T.clock.w);
  let rc = clamp(r, 0, max(filled - 1, 0));
  let slot = (i32(T.clock.z) - rc + n * 4) % n;
  let cc = clamp(c, 0, cols);
  var bin = cc;
  if (T.grid.w > 0.5) {
    bin = abs(cc - cols / 2);
  }
  bin = clamp(bin, 0, bins - 1);
  let v = rows[u32(slot * bins + bin)];
  // The sides of the valley fall away; the music shapes the middle.
  let u = f32(cc) / f32(cols) * 2.0 - 1.0;
  let side = 1.0 - smoothstep(0.75, 1.0, abs(u));
  return pow(max(v, 0.0), 1.35) * T.shape.z * side;
}

fn terrain_world(c: f32, r: f32, h: f32) -> vec3<f32> {
  let cols = T.grid.x;
  let x = (c / cols - 0.5) * T.shape.x;
  let z = -(r - T.clock.y) * T.shape.y;
  return vec3<f32>(x, h, z);
}

@vertex
fn vs_terrain(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TerrOut {
  var out: TerrOut;
  let cols = u32(T.grid.x);
  let filled = u32(T.clock.w);
  let cell_c = ii % cols;
  let cell_r = ii / cols;
  out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  out.world = vec3<f32>(0.0);
  out.normal = vec3<f32>(0.0, 1.0, 0.0);
  out.cell = vec2<f32>(0.0);
  out.age = 0.0;
  if (cell_r + 1u >= filled) {
    return out;
  }
  let corner = array<vec2<u32>, 6>(
    vec2<u32>(0u, 0u), vec2<u32>(1u, 0u), vec2<u32>(0u, 1u),
    vec2<u32>(0u, 1u), vec2<u32>(1u, 0u), vec2<u32>(1u, 1u))[vi];
  let c = i32(cell_c + corner.x);
  let r = i32(cell_r + corner.y);
  let h = terrain_h(c, r);
  let world = terrain_world(f32(c), f32(r), h);
  // Normal from the neighbouring heights.
  let dx = (terrain_h(c + 1, r) - terrain_h(c - 1, r)) / (2.0 * T.shape.x / T.grid.x);
  let dz = (terrain_h(c, r - 1) - terrain_h(c, r + 1)) / (2.0 * T.shape.y);
  out.normal = normalize(vec3<f32>(-dx, 1.0, dz));
  out.world = world;
  out.position = T.view_proj * vec4<f32>(world, 1.0);
  out.cell = vec2<f32>(f32(c), f32(r) - T.clock.y);
  out.age = f32(r) - T.clock.y;
  return out;
}

fn grid_line(x: f32, width: f32) -> f32 {
  let f = abs(fract(x - 0.5) - 0.5);
  let w = fwidth(x) * width;
  return 1.0 - smoothstep(0.0, max(w, 1e-4), f);
}

@fragment
fn fs_terrain(in: TerrOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let to_eye = T.eye.xyz - in.world;
  let dist = length(to_eye);
  let v = to_eye / max(dist, 1e-4);
  let flags = u32(T.shape.w);
  let amp = max(T.shape.z, 1e-3);
  let height = clamp(in.world.y / amp, 0.0, 1.2);
  // A low sun from far down the valley rims every ridge; a cool fill above.
  let sun = normalize(vec3<f32>(0.25, 0.45, -1.0));
  let fill = normalize(vec3<f32>(-0.3, 1.0, 0.4));
  let diffuse = max(dot(n, sun), 0.0) * 0.8 + max(dot(n, fill), 0.0) * 0.25;
  let rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * max(dot(-v, sun), 0.0);
  let body = mix(T.fringe.rgb * T.fringe.w, T.mid.rgb * T.mid.w, smoothstep(0.08, 0.95, height));
  let hot = T.core.rgb * T.core.w;
  var col = body * (0.04 + diffuse * 0.85) + T.mid.rgb * T.mid.w * rim * 1.2;
  // The live edge burns, and fresh ridges glow as they arrive.
  let fresh = exp(-in.age * 0.25);
  col += hot * smoothstep(0.25, 0.9, height) * fresh * 0.08;
  // The live edge: a thin hot line along the newest row, drawn over the fade.
  let edge_glow = hot * (1.0 - smoothstep(0.0, 1.2 + T.extra.z * 2.0, in.age)) * (0.15 + height) * 0.35 * (0.5 + T.extra.y + T.extra.z);
  let lw = T.look.w;
  if ((flags & 1u) != 0u) {
    // Wireframe: a dark surface under a glowing grid.
    col *= 0.25;
    let g = max(grid_line(in.cell.x * T.extra.x, lw), grid_line(in.cell.y * T.extra.x, lw));
    col += mix(T.mid.rgb * T.mid.w, hot, height) * g * T.look.y * 0.5;
  }
  if ((flags & 2u) != 0u) {
    let iso = in.world.y / amp * T.look.x;
    let line = grid_line(iso, lw) * smoothstep(0.02, 0.1, height);
    col += mix(T.mid.rgb * T.mid.w * 1.5, hot, smoothstep(0.3, 1.0, height)) * line * T.look.y * (0.45 + 0.5 * T.extra.z * exp(-in.age * 0.05));
  }
  // The far edge of the history fades into the dark.
  col *= 1.0 - smoothstep(T.clock.w * 0.7, T.clock.w - 1.0, in.age);
  // The near edge fades in over the first rows, so there is no hard cut
  // through the hills at the bottom of the picture.
  col = col * smoothstep(0.0, 7.0, in.age) + edge_glow;
  col *= exp(-max(dist - 1.5, 0.0) * T.eye.w);
  return vec4<f32>(col, 1.0);
}
