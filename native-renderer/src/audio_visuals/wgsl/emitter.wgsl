// Emitter shapes: the GPU copy of emitter.rs (keep the two in step).
// A point, unit tangent, outward normal and spectral coordinate at u in 0..1.

const EMITTER_LINE: u32 = 0u;
const EMITTER_RING: u32 = 1u;
const EMITTER_POLYGON: u32 = 2u;
const EMITTER_STRATA: u32 = 3u;
const EM_PI: f32 = 3.14159265358979;
const EM_TAU: f32 = 6.28318530717959;

struct EmitterShape {
  kind: u32,
  sides: u32,
  count: u32,
  rotation: f32,
  center: vec2<f32>,
  size: vec2<f32>,
}

struct EmitterPoint {
  pos: vec2<f32>,
  tangent: vec2<f32>,
  normal: vec2<f32>,
  spectral: f32,
}

fn em_rotate(v: vec2<f32>, angle: f32) -> vec2<f32> {
  let s = sin(angle);
  let c = cos(angle);
  return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

fn em_mirror(u: f32) -> f32 {
  return 1.0 - abs(2.0 * u - 1.0);
}

fn emitter_sample(shape: EmitterShape, u_in: f32) -> EmitterPoint {
  let u = fract(u_in);
  var local = vec2<f32>(0.0);
  var tangent = vec2<f32>(0.0, 1.0);
  var normal = vec2<f32>(1.0, 0.0);
  var spectral = u;
  if (shape.kind == EMITTER_RING) {
    let a = u * EM_TAU + EM_PI * 0.5;
    let s = sin(a);
    let c = cos(a);
    local = vec2<f32>(c * shape.size.x, s * shape.size.y);
    tangent = normalize(vec2<f32>(-s * shape.size.x, c * shape.size.y));
    normal = vec2<f32>(tangent.y, -tangent.x);
    spectral = em_mirror(u);
  } else if (shape.kind == EMITTER_POLYGON) {
    let sides = f32(clamp(shape.sides, 3u, 64u));
    let t = u * sides;
    let edge = min(floor(t), sides - 1.0);
    let f = t - edge;
    let offset = EM_PI * 0.5 - EM_PI / sides;
    let a0 = offset + edge / sides * EM_TAU;
    let a1 = offset + (edge + 1.0) / sides * EM_TAU;
    let p0 = vec2<f32>(cos(a0), sin(a0)) * shape.size.x;
    let p1 = vec2<f32>(cos(a1), sin(a1)) * shape.size.x;
    local = mix(p0, p1, f);
    tangent = normalize(p1 - p0);
    normal = vec2<f32>(tangent.y, -tangent.x);
    spectral = em_mirror(u);
  } else if (shape.kind == EMITTER_STRATA) {
    let count = f32(clamp(shape.count, 1u, 64u));
    let t = u * count;
    let line = min(floor(t), count - 1.0);
    let f = t - line;
    var y = 0.0;
    if (count > 1.0) {
      y = (line / (count - 1.0) * 2.0 - 1.0) * shape.size.y;
    }
    local = vec2<f32>((f * 2.0 - 1.0) * shape.size.x, y);
    tangent = vec2<f32>(1.0, 0.0);
    normal = vec2<f32>(0.0, 1.0);
    spectral = 1.0 - em_mirror(f);
  } else {
    local = vec2<f32>(0.0, (u * 2.0 - 1.0) * shape.size.y);
  }
  var point: EmitterPoint;
  point.pos = em_rotate(local, shape.rotation) + shape.center;
  point.tangent = em_rotate(tangent, shape.rotation);
  point.normal = em_rotate(normal, shape.rotation);
  point.spectral = spectral;
  return point;
}
