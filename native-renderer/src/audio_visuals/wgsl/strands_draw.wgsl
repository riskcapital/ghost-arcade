@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> U: StrandsU;

// One instance per trail segment: particle = instance / TRAIL_POINTS,
// segment k counts back from the particle's head. The colour was worked
// out once per particle by the simulation, so a vertex only places a quad.

struct TrailOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) across: f32,
}

@vertex
fn vs_trail(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TrailOut {
  var out: TrailOut;
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.color = vec3<f32>(0.0);
  out.across = 0.0;
  let index = ii / TRAIL_POINTS;
  let k = ii % TRAIL_POINTS;
  // Field by field, never the whole 128-byte particle: this runs six times
  // per segment, and copying the struct made the draw bandwidth-bound.
  let col = particles[index].col;
  let segments = u32(clamp(U.pan.w, 1.0, f32(TRAIL_POINTS)));
  if (col.w <= 0.0 || k >= segments) {
    return out;
  }
  let head = trail_head(u32(U.clock.z));
  var a = particles[index].p.xy;
  if (k > 0u) {
    a = particles[index].trail[(head + TRAIL_POINTS - (k - 1u)) % TRAIL_POINTS];
  }
  let b = particles[index].trail[(head + TRAIL_POINTS - k) % TRAIL_POINTS];
  // The 2D camera: turn, zoom, pan, then to clip space.
  let turn = mat2x2<f32>(U.view.x, U.view.y, -U.view.y, U.view.x);
  let to_ndc = vec2<f32>(1.0 / U.res.z, 1.0);
  let pa = (turn * a * U.view.z + U.pan.xy) * to_ndc;
  let pb = (turn * b * U.view.z + U.pan.xy) * to_ndc;
  let px = vec2<f32>(2.0 / U.res.x, 2.0 / U.res.y);
  var dir = (pa - pb) / px;
  let len = length(dir);
  if (len < 0.35 && k > 0u) {
    return out;
  }
  if (len < 0.35) {
    dir = vec2<f32>(0.0, 1.0);
  }
  let vary = mix(1.0, 0.3 + 1.4 * hash11(index * 2246822519u + 9u), U.view.w);
  let n = normalize(vec2<f32>(-dir.y, dir.x)) * px * U.look.y * vary;
  let corner = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u)[vi];
  let along = f32(corner / 2u);
  let side = f32(corner % 2u) * 2.0 - 1.0;
  out.position = vec4<f32>(mix(pb, pa, along) + n * side, 0.0, 1.0);
  out.across = side;
  // The trail fades toward its tail.
  let tail = (f32(k) + 1.0 - along) / f32(segments);
  out.color = col.rgb * pow(1.0 - tail, 1.3);
  return out;
}

@fragment
fn fs_trail(in: TrailOut) -> @location(0) vec4<f32> {
  let a = exp(-in.across * in.across * 2.8);
  return vec4<f32>(in.color * a, 0.0);
}
