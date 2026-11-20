@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> U: StrandsU;

struct StreakOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) across: f32,
}

fn palette(t: f32) -> vec3<f32> {
  // Mostly fringe; the mid tone is a thin band on the way to the core.
  let s1 = smoothstep(0.55, 0.85, t);
  let s2 = smoothstep(1.0, 1.5, t);
  var col = mix(U.fringe.rgb * U.fringe.w, U.mid.rgb * U.mid.w, s1);
  col = mix(col, U.core.rgb * U.core.w, s2);
  return col * smoothstep(0.0, 0.12, t);
}

@vertex
fn vs_streak(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> StreakOut {
  var out: StreakOut;
  let pt = particles[ii];
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.color = vec3<f32>(0.0);
  out.across = 0.0;
  if (pt.q.x >= pt.q.y || pt.q.y <= 0.0) {
    return out;
  }
  let aspect = U.res.z;
  let t = pt.q.x / pt.q.y;
  let head = pt.p.xy;
  var trail = pt.p.zw * U.look.x;
  let trail_len = length(trail);
  if (trail_len > 0.03) {
    trail *= 0.03 / trail_len;
  }
  let tail = head - trail;
  let to_ndc = vec2<f32>(1.0 / aspect, 1.0);
  let h = head * to_ndc;
  let tl = tail * to_ndc;
  var dir = h - tl;
  let px = vec2<f32>(2.0 / U.res.x, 2.0 / U.res.y);
  if (length(dir / px) < 0.5) {
    dir = vec2<f32>(0.0, px.y * 0.5);
  }
  let n = normalize(vec2<f32>(-dir.y, dir.x) / px) * px * U.look.y;
  // Two triangles: corners 0..3 = (tail,-), (tail,+), (head,-), (head,+).
  let corner = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u)[vi];
  let along = f32(corner / 2u);
  let side = f32(corner % 2u) * 2.0 - 1.0;
  let base = mix(tl, h, along);
  out.position = vec4<f32>(base + n * side, 0.0, 1.0);
  out.across = side;
  let fade = smoothstep(0.0, 0.06, t) * pow(1.0 - t, 1.6);
  let heat = pt.q.z * exp(-pt.q.x * U.fibre.z);
  out.color = palette(heat) * fade * U.look.z * mix(0.35, 1.0, along);
  return out;
}

@fragment
fn fs_streak(in: StreakOut) -> @location(0) vec4<f32> {
  let a = exp(-in.across * in.across * 2.8);
  return vec4<f32>(in.color * a, 0.0);
}
