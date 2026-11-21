@group(0) @binding(0) var<uniform> S: ShockU;

struct SoftOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) quad: vec2<f32>,
}

fn shock_palette(heat: f32) -> vec3<f32> {
  var col = mix(S.fringe.rgb * S.fringe.w, S.mid.rgb * S.mid.w, smoothstep(0.08, 0.5, heat));
  return mix(col, S.core.rgb * S.core.w, smoothstep(0.62, 1.0, heat));
}

fn shock_ndc(p: vec2<f32>) -> vec2<f32> {
  let q = view2_apply(S.view, p);
  return vec2<f32>(q.x / S.res.z, q.y);
}

fn offscreen() -> SoftOut {
  var out: SoftOut;
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.color = vec3<f32>(0.0);
  out.quad = vec2<f32>(0.0);
  return out;
}

// One particle of a ring: most hug the front, a tail trails behind it, and a
// share of a kick's particles sit on a shell (limb-bright when seen face on).
// Each is a short streak along its direction of travel.
@vertex
fn vs_ring(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SoftOut {
  let per = u32(S.res.w);
  let ring_i = ii / per;
  let j = ii % per;
  if (ring_i >= u32(S.clock.y)) {
    return offscreen();
  }
  let ring = S.rings[ring_i];
  if (ring.b.x <= 0.002) {
    return offscreen();
  }
  let seed = u32(ring.b.w * 65535.0);
  let h1 = hash11(j * 3u + seed * 7919u);
  let h2 = hash11(j * 5u + 1u + seed);
  let h3 = hash11(j * 7u + 2u + seed * 31u);
  let h4 = hash11(j * 11u + 3u + seed * 131u);
  let width = ring.a.w;
  let radius = ring.a.z;
  let a = (f32(j) + h1) / f32(per) * 6.28318530718;
  let around = vec2<f32>(cos(a), sin(a));
  // Most hug the front; a thin wake trails behind it.
  // Three in four sit exactly on the front (a crisp edge); the rest trail
  // behind it in a thin wake.
  let in_wake = h3 < 0.25;
  let lag = select(-width * 0.12 * h2, -width * (0.3 + pow(h2, 2.0) * 2.5), in_wake);
  let wobble = gnoise2(around * 2.5 + vec2<f32>(f32(seed % 97u)), seed).x * 0.012 * radius;
  var dir = around;
  var pos = ring.a.xy + around * max(radius + lag + wobble, 0.0);
  var bright = 1.0;
  if (ring.b.y < 0.5 && h4 < S.shape.z) {
    // A shell: a point on a sphere of this radius, seen face on.
    let z = h3 * 2.0 - 1.0;
    let rr = sqrt(max(1.0 - z * z, 0.0));
    dir = around;
    pos = ring.a.xy + around * rr * max(radius + lag * 0.4, 0.0);
    bright = 0.25 * rr * rr;
  }
  let heat = exp(min(lag, 0.0) / max(width * 0.6, 1e-4));
  let speed = ring.b.z;
  // About one frame of travel: motion blur, so a fast thin front stays one
  // continuous band in the trails instead of a stack of copies.
  // About half a frame of travel: enough blur to join a fast front into one
  // band, short enough that the edge stays crisp.
  let len = max(speed * S.look.z * select(0.5, 0.9, in_wake), 0.001);
  let head = shock_ndc(pos);
  let tail = shock_ndc(pos - dir * len);
  let px = vec2<f32>(2.0 / S.res.x, 2.0 / S.res.y);
  var axis = head - tail;
  let size = S.shape.x * (1.0 + S.shape.y * (hash11(j * 13u + seed) - 0.5) * 1.6);
  let n = normalize(vec2<f32>(-axis.y, axis.x) / px + vec2<f32>(1e-5, 0.0)) * px * size;
  let corner = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u)[vi];
  let along = f32(corner / 2u);
  let side = f32(corner % 2u) * 2.0 - 1.0;
  var out: SoftOut;
  out.position = vec4<f32>(mix(tail, head, along) + n * side, 0.0, 1.0);
  out.quad = vec2<f32>(0.0, side);
  out.color = shock_palette(heat) * ring.b.x * S.look.x * bright * mix(0.4, 1.0, along);
  return out;
}

// The dust the fronts push through: a jittered grid of fine points, shoved
// outward as a front passes and glowing where it is compressed.
@vertex
fn vs_dust(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SoftOut {
  let cols = u32(S.field.z);
  let rows = u32(S.field.w);
  let h1 = hash11(ii * 3u + 11u);
  let h2 = hash11(ii * 5u + 12u);
  let h3 = hash11(ii * 7u + 13u);
  let cell = vec2<f32>(f32(ii % cols) + h1, f32(ii / cols) + h2) / vec2<f32>(f32(cols), f32(rows));
  var pos = (cell * 2.0 - 1.0) * vec2<f32>(S.res.z, 1.0) * 1.04;
  var energy = 0.0;
  var push = vec2<f32>(0.0);
  let live = u32(S.clock.y);
  for (var r = 0u; r < live; r = r + 1u) {
    let ring = S.rings[r];
    let d = shock_d(pos, ring);
    let g = exp(-(d.z - 0.25) * (d.z - 0.25) * 2.0);
    push += d.xy * g * ring.b.x * S.field.x;
    energy += g * ring.b.x;
  }
  pos += push;
  let size = mix(0.7, 1.6, h3 * h3) * S.shape.x / 1.1;
  let corner = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0))[vi];
  let px = vec2<f32>(2.0 / S.res.x, 2.0 / S.res.y) * size;
  var out: SoftOut;
  out.position = vec4<f32>(shock_ndc(pos) + corner * px, 0.0, 1.0);
  out.quad = corner;
  let e = min(energy, 2.0);
  let tone = mix(S.fringe.rgb * S.fringe.w, S.mid.rgb * S.mid.w, smoothstep(0.0, 1.0, e));
  // Hats make the dust glitter.
  let glitter = 1.0 + pow(hash11(ii * 7919u + u32(S.clock.x * 30.0)), 30.0) * S.shape.w * 12.0;
  out.color = tone * S.look.y * (0.012 + 0.05 * e) * mix(0.25, 1.0, h3 * h3) * (0.6 + 0.8 * S.clock.w) * glitter;
  return out;
}

@fragment
fn fs_soft(in: SoftOut) -> @location(0) vec4<f32> {
  let d = dot(in.quad, in.quad);
  return vec4<f32>(in.color * exp(-d * 2.6), 0.0);
}
