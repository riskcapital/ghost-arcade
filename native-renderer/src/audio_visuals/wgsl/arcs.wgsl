// Lightning Arcs (arcs.rs has the CPU side). Positions in picture heights,
// y up. Each bolt is a seeded midpoint-displacement curve evaluated in closed
// form: the displacement at u is the sum over levels of hat functions through
// random offsets at that level's new midpoints, so the ends stay anchored and
// every segment can be computed on its own.

struct ArcData {
  a: vec4<f32>, // start xy, end xy
  b: vec4<f32>, // brightness, seed, band, width scale
}

struct ArcU {
  res: vec4<f32>,    // width, height, aspect, live arcs
  look: vec4<f32>,   // core px, glow px, brightness, jaggedness
  misc: vec4<f32>,   // time, nodes, levels, branches
  audio: vec4<f32>,  // level, high envelope, drive level, point glow
  view: View2,
  core: vec4<f32>,
  mid: vec4<f32>,
  fringe: vec4<f32>,
  nodes: array<vec4<f32>, 12>, // xy, flare, size (11 used)
  arcs: array<ArcData, 16>,
}

@group(0) @binding(0) var<uniform> A: ArcU;

const MAIN_SEGS: u32 = 96u;
const BRANCH_SEGS: u32 = 32u;

fn hsigned(a: u32, b: u32) -> f32 {
  return hash21(a, b) * 2.0 - 1.0;
}

// Midpoint displacement at u in 0..1: (across, along) offsets, unit scale.
fn midpoint(u: f32, seed: u32, levels: u32) -> vec2<f32> {
  var off = vec2<f32>(0.0);
  var amp = 0.5;
  for (var l = 1u; l <= levels; l = l + 1u) {
    let n = f32(1u << l);
    let x = u * n;
    let m = u32(floor(x));
    let f = x - f32(m);
    var k = m;
    var w = f;
    if ((m & 1u) == 1u) {
      w = 1.0 - f;
    } else {
      k = m + 1u;
    }
    let key = seed * 131u + l * 7919u + k;
    off += vec2<f32>(hsigned(key, 11u), hsigned(key, 29u) * 0.35) * amp * w;
    amp *= 0.56;
  }
  return off;
}

fn bolt_point(a: vec2<f32>, b: vec2<f32>, u: f32, seed: u32, levels: u32, jag: f32) -> vec2<f32> {
  let d = b - a;
  let len = length(d);
  let t = d / max(len, 1e-4);
  let n = vec2<f32>(-t.y, t.x);
  let off = midpoint(u, seed, levels) * len * jag;
  return a + d * u + n * off.x + t * off.y;
}

struct ArcOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) across: f32,
  @location(2) glow: f32,
}

fn arc_ndc(p: vec2<f32>) -> vec2<f32> {
  let q = view2_apply(A.view, p);
  return vec2<f32>(q.x / A.res.z, q.y);
}

// One segment of one bolt or branch, as a glow quad (vertices 0-5) and a
// core quad (6-11).
@vertex
fn vs_arc(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ArcOut {
  var out: ArcOut;
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.color = vec3<f32>(0.0);
  out.across = 0.0;
  out.glow = 0.0;
  let branches = u32(A.misc.w);
  let per_arc = MAIN_SEGS + branches * BRANCH_SEGS;
  let arc_i = ii / per_arc;
  let s = ii % per_arc;
  if (arc_i >= u32(A.res.w)) {
    return out;
  }
  let arc = A.arcs[arc_i];
  let bright = arc.b.x;
  if (bright <= 0.002) {
    return out;
  }
  let seed = u32(arc.b.y);
  let levels = u32(A.misc.z);
  let jag = A.look.w * (1.0 + A.audio.y * 0.3);
  let a = arc.a.xy;
  let b = arc.a.zw;
  var p0: vec2<f32>;
  var p1: vec2<f32>;
  var weight = 1.0;
  var taper = 1.0;
  if (s < MAIN_SEGS) {
    let u0 = f32(s) / f32(MAIN_SEGS);
    let u1 = f32(s + 1u) / f32(MAIN_SEGS);
    p0 = bolt_point(a, b, u0, seed, levels, jag);
    p1 = bolt_point(a, b, u1, seed, levels, jag);
    taper = 0.75 + 0.25 * sin(3.14159 * u0);
  } else {
    // A branch: leaves the bolt part way along, angled off it, shorter and
    // dimmer toward its tip.
    let bi = (s - MAIN_SEGS) / BRANCH_SEGS;
    let k = (s - MAIN_SEGS) % BRANCH_SEGS;
    let bseed = seed * 977u + bi * 131u + 5u;
    let start_u = 0.12 + 0.7 * hash21(bseed, 1u);
    let root = bolt_point(a, b, start_u, seed, levels, jag);
    let d = b - a;
    let side = select(-1.0, 1.0, hash21(bseed, 2u) > 0.5);
    let ang = side * (0.35 + 0.55 * hash21(bseed, 3u));
    let dir = normalize(d);
    let rot = vec2<f32>(dir.x * cos(ang) - dir.y * sin(ang), dir.x * sin(ang) + dir.y * cos(ang));
    let blen = length(d) * (0.12 + 0.3 * hash21(bseed, 4u)) * (1.0 - start_u * 0.5);
    let tip = root + rot * blen;
    let u0 = f32(k) / f32(BRANCH_SEGS);
    let u1 = f32(k + 1u) / f32(BRANCH_SEGS);
    p0 = bolt_point(root, tip, u0, bseed, max(levels, 2u) - 2u, jag * 1.3);
    p1 = bolt_point(root, tip, u1, bseed, max(levels, 2u) - 2u, jag * 1.3);
    weight = 0.5 * (0.4 + 0.6 * hash21(bseed, 6u));
    taper = 1.0 - u0 * 0.85;
  }
  let layer_glow = vi < 6u;
  let corner = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u)[vi % 6u];
  let along = f32(corner / 2u);
  let side = f32(corner % 2u) * 2.0 - 1.0;
  let h0 = arc_ndc(p0);
  let h1 = arc_ndc(p1);
  let px = vec2<f32>(2.0 / A.res.x, 2.0 / A.res.y);
  var axis = (h1 - h0) / px;
  if (length(axis) < 1e-3) {
    axis = vec2<f32>(1.0, 0.0);
  }
  let t = normalize(axis);
  let n = vec2<f32>(-t.y, t.x);
  let width_px = select(A.look.x * arc.b.w * mix(0.6, 1.0, taper), A.look.y * arc.b.w * taper, layer_glow);
  // Overlap the joints a little so the bolt has no seams.
  let ext = t * select(0.5, width_px * 0.5, layer_glow) * (along * 2.0 - 1.0);
  let base = mix(h0, h1, along);
  out.position = vec4<f32>(base + (n * side * width_px + ext) * px, 0.0, 1.0);
  out.across = side;
  out.glow = select(0.0, 1.0, layer_glow);
  let energy = bright * weight * taper;
  if (layer_glow) {
    out.color = mix(A.fringe.rgb * A.fringe.w, A.mid.rgb * A.mid.w, clamp(energy, 0.0, 1.0)) * energy * 0.22;
  } else {
    out.color = mix(A.mid.rgb * A.mid.w, A.core.rgb * A.core.w, clamp(energy * 1.4, 0.0, 1.0)) * energy;
  }
  return out;
}

@fragment
fn fs_arc(in: ArcOut) -> @location(0) vec4<f32> {
  let x = in.across;
  // The glow falls off softly; the core is a hard bright line.
  let a = select(exp(-x * x * 4.0), exp(-x * x * 1.6) * (1.0 - x * x), in.glow < 0.5);
  return vec4<f32>(in.color * max(a, 0.0), 0.0);
}

struct NodeOut {
  @builtin(position) position: vec4<f32>,
  @location(0) quad: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) flare: f32,
}

// The emitter nodes: small hot orbs with a halo that flares when struck.
@vertex
fn vs_node(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> NodeOut {
  var out: NodeOut;
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.quad = vec2<f32>(0.0);
  out.color = vec3<f32>(0.0);
  out.flare = 0.0;
  if (ii >= u32(A.misc.y)) {
    return out;
  }
  let node = A.nodes[ii];
  let flare = min(node.z, 1.5);
  let corner = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0))[vi];
  let radius_px = (12.0 + 30.0 * flare) * node.w;
  let px = vec2<f32>(2.0 / A.res.x, 2.0 / A.res.y) * radius_px;
  out.position = vec4<f32>(arc_ndc(node.xy) + corner * px, 0.0, 1.0);
  out.quad = corner;
  out.flare = flare;
  out.color = mix(A.mid.rgb * A.mid.w, A.core.rgb * A.core.w, clamp(flare, 0.0, 1.0)) * A.audio.w * (0.7 + 0.6 * A.audio.z);
  return out;
}

@fragment
fn fs_node(in: NodeOut) -> @location(0) vec4<f32> {
  let r = length(in.quad);
  if (r > 1.0) {
    discard;
  }
  let core = exp(-r * r * 90.0 / (1.0 + in.flare * 3.0)) * 1.2;
  let halo = exp(-r * r * 7.0) * (1.0 - r * r) * (0.03 + 0.06 * in.flare);
  return vec4<f32>(in.color * (core + halo), 0.0);
}
