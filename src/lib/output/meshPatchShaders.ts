/**
 * meshPatchShaders.ts — Bezier mesh cells for the 1.9 output shaders.
 *
 * A Bezier mesh cell is a Coons patch bounded by four cubic edges, the
 * surface meshWarp.ts evaluates on the CPU (evaluateMeshCell) and 2.0's
 * native core renders. Screen meshes are forward maps and only evaluate the
 * patch; the Master Warp's points are destinations, so each pixel inverts
 * it: a bounds reject on the patch's 16 control points, then Newton from
 * the bilinear guess, the centre and the four quadrant seeds. Ported from
 * heartbeat.wgsl (mesh_patch_*) so the three passes here — the Screen
 * window, blendRenderer and the editor presenter — share one definition.
 *
 * Tangents travel resolved (resolveMeshTangents), two vec4 per point in
 * row-major order: (right.xy, down.xy) then (left.xy, up.xy).
 */

import type { MeshWarpGrid } from '../types';
import { meshGridHasTangents, resolveMeshTangents } from '../utils/meshWarp';

/** Floats per point in a packed tangent array. */
export const MESH_TANGENT_FLOATS = 8;

/** Write a grid's resolved tangents into `out` at `offset` (row-major,
 *  MESH_TANGENT_FLOATS per point). Returns false, writing nothing, when the
 *  grid has no curved cells to draw, so callers keep the bilinear path. */
export function packMeshTangents(grid: MeshWarpGrid | null | undefined, out: Float32Array, offset = 0, maxPoints = Infinity): boolean {
  if (!grid || !meshGridHasTangents(grid) || grid.rows * grid.cols > maxPoints) return false;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const t = resolveMeshTangents(grid, r, c);
      out.set([t.right.x, t.right.y, t.down.x, t.down.y, t.left.x, t.left.y, t.up.x, t.up.y],
        offset + (r * grid.cols + c) * MESH_TANGENT_FLOATS);
    }
  }
  return true;
}

/** Corners a = (row, col), b = (row, col + 1), c = (row + 1, col + 1),
 *  d = (row + 1, col); the inner control points of the top (a->b), bottom
 *  (d->c), left (a->d) and right (b->c) edges. Build one with
 *  mp_build(a, b, c, d, a.right, a.down, b.left, b.down, c.left, c.up,
 *  d.right, d.up). */
export const MESH_PATCH_WGSL = /* wgsl */ `
struct MeshPatch {
  a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>,
  ab1: vec2<f32>, ab2: vec2<f32>, dc1: vec2<f32>, dc2: vec2<f32>,
  ad1: vec2<f32>, ad2: vec2<f32>, bc1: vec2<f32>, bc2: vec2<f32>,
};

fn mp_build(
  a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>,
  a_right: vec2<f32>, a_down: vec2<f32>, b_left: vec2<f32>, b_down: vec2<f32>,
  c_left: vec2<f32>, c_up: vec2<f32>, d_right: vec2<f32>, d_up: vec2<f32>,
) -> MeshPatch {
  var p: MeshPatch;
  p.a = a; p.b = b; p.c = c; p.d = d;
  p.ab1 = a + a_right; p.ab2 = b + b_left;
  p.dc1 = d + d_right; p.dc2 = c + c_left;
  p.ad1 = a + a_down;  p.ad2 = d + d_up;
  p.bc1 = b + b_down;  p.bc2 = c + c_up;
  return p;
}

fn mp_bezier3(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
  let s = 1.0 - t;
  return s * s * s * p0 + 3.0 * s * s * t * p1 + 3.0 * s * t * t * p2 + t * t * t * p3;
}

fn mp_bezier3_tangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
  let s = 1.0 - t;
  return 3.0 * (s * s * (p1 - p0) + 2.0 * s * t * (p2 - p1) + t * t * (p3 - p2));
}

fn mp_eval(p: MeshPatch, uv: vec2<f32>) -> vec2<f32> {
  let top = mp_bezier3(p.a, p.ab1, p.ab2, p.b, uv.x);
  let bottom = mp_bezier3(p.d, p.dc1, p.dc2, p.c, uv.x);
  let left = mp_bezier3(p.a, p.ad1, p.ad2, p.d, uv.y);
  let right = mp_bezier3(p.b, p.bc1, p.bc2, p.c, uv.y);
  let sheet = mix(mix(p.a, p.b, uv.x), mix(p.d, p.c, uv.x), uv.y);
  return mix(top, bottom, uv.y) + mix(left, right, uv.x) - sheet;
}

fn mp_inner(p: MeshPatch, i: u32, j: u32) -> vec2<f32> {
  let fu = f32(i) / 3.0;
  let fv = f32(j) / 3.0;
  let top_i = select(p.ab2, p.ab1, i == 1u);
  let bottom_i = select(p.dc2, p.dc1, i == 1u);
  let left_j = select(p.ad2, p.ad1, j == 1u);
  let right_j = select(p.bc2, p.bc1, j == 1u);
  let sheet = mix(mix(p.a, p.b, fu), mix(p.d, p.c, fu), fv);
  return mix(top_i, bottom_i, fv) + mix(left_j, right_j, fu) - sheet;
}

fn mp_contains_bounds(p: MeshPatch, q: vec2<f32>) -> bool {
  var lo = min(min(p.a, p.b), min(p.c, p.d));
  var hi = max(max(p.a, p.b), max(p.c, p.d));
  lo = min(lo, min(min(p.ab1, p.ab2), min(p.dc1, p.dc2)));
  hi = max(hi, max(max(p.ab1, p.ab2), max(p.dc1, p.dc2)));
  lo = min(lo, min(min(p.ad1, p.ad2), min(p.bc1, p.bc2)));
  hi = max(hi, max(max(p.ad1, p.ad2), max(p.bc1, p.bc2)));
  for (var j = 1u; j <= 2u; j = j + 1u) {
    for (var i = 1u; i <= 2u; i = i + 1u) {
      let inner = mp_inner(p, i, j);
      lo = min(lo, inner);
      hi = max(hi, inner);
    }
  }
  return all(q >= lo - vec2<f32>(0.002)) && all(q <= hi + vec2<f32>(0.002));
}

fn mp_cross(a: vec2<f32>, b: vec2<f32>) -> f32 { return a.x * b.y - a.y * b.x; }

fn mp_inverse_bilinear(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>) -> vec2<f32> {
  let e = b - a;
  let f = d - a;
  let g = a - b + c - d;
  let h = p - a;
  let k2 = mp_cross(g, f);
  let k1 = mp_cross(e, f) + mp_cross(h, g);
  let k0 = mp_cross(h, e);
  var u = -1.0;
  var v = -1.0;
  if (abs(k2) < 0.0001) {
    if (abs(k1) < 0.0001) { return vec2<f32>(-1.0); }
    v = -k0 / k1;
  } else {
    let discriminant = k1 * k1 - 4.0 * k0 * k2;
    if (discriminant < 0.0) { return vec2<f32>(-1.0); }
    let root = sqrt(discriminant);
    let v0 = (-k1 - root) / (2.0 * k2);
    let v1 = (-k1 + root) / (2.0 * k2);
    v = select(v1, v0, v0 >= 0.0 && v0 <= 1.0);
  }
  let denom_x = e.x + g.x * v;
  let denom_y = e.y + g.y * v;
  if (abs(denom_x) > 0.0001) { u = (h.x - f.x * v) / denom_x; }
  else if (abs(denom_y) > 0.0001) { u = (h.y - f.y * v) / denom_y; }
  return vec2<f32>(u, v);
}

fn mp_newton(q: vec2<f32>, p: MeshPatch, start: vec2<f32>) -> vec3<f32> {
  var uv = start;
  var residual = mp_eval(p, uv) - q;
  for (var iteration = 0u; iteration < 10u; iteration = iteration + 1u) {
    if (dot(residual, residual) < 1e-12) { break; }
    let top = mp_bezier3(p.a, p.ab1, p.ab2, p.b, uv.x);
    let bottom = mp_bezier3(p.d, p.dc1, p.dc2, p.c, uv.x);
    let left = mp_bezier3(p.a, p.ad1, p.ad2, p.d, uv.y);
    let right = mp_bezier3(p.b, p.bc1, p.bc2, p.c, uv.y);
    let d_top = mp_bezier3_tangent(p.a, p.ab1, p.ab2, p.b, uv.x);
    let d_bottom = mp_bezier3_tangent(p.d, p.dc1, p.dc2, p.c, uv.x);
    let d_left = mp_bezier3_tangent(p.a, p.ad1, p.ad2, p.d, uv.y);
    let d_right = mp_bezier3_tangent(p.b, p.bc1, p.bc2, p.c, uv.y);
    let d_sheet_u = mix(p.b - p.a, p.c - p.d, uv.y);
    let d_sheet_v = mix(p.d, p.c, uv.x) - mix(p.a, p.b, uv.x);
    let du = mix(d_top, d_bottom, uv.y) + (right - left) - d_sheet_u;
    let dv = (bottom - top) + mix(d_left, d_right, uv.x) - d_sheet_v;
    let det = du.x * dv.y - dv.x * du.y;
    if (abs(det) < 1e-9) { return vec3<f32>(0.0, uv); }
    let delta = vec2<f32>(
      (residual.x * dv.y - residual.y * dv.x) / det,
      (du.x * residual.y - du.y * residual.x) / det,
    );
    uv = clamp(uv - delta, vec2<f32>(-0.5), vec2<f32>(1.5));
    residual = mp_eval(p, uv) - q;
  }
  let inside = all(uv >= vec2<f32>(-0.0005)) && all(uv <= vec2<f32>(1.0005));
  let converged = dot(residual, residual) < 1e-9;
  return vec3<f32>(select(0.0, 1.0, inside && converged), clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
}

/// (found, u, v) of q inside the patch.
fn mp_uv(q: vec2<f32>, p: MeshPatch) -> vec3<f32> {
  let start = mp_inverse_bilinear(q, p.a, p.b, p.c, p.d);
  if (all(start >= vec2<f32>(-0.25)) && all(start <= vec2<f32>(1.25))) {
    let hit = mp_newton(q, p, clamp(start, vec2<f32>(0.0), vec2<f32>(1.0)));
    if (hit.x > 0.5) { return hit; }
  }
  let centre = mp_newton(q, p, vec2<f32>(0.5));
  if (centre.x > 0.5) { return centre; }
  for (var quadrant = 0u; quadrant < 4u; quadrant = quadrant + 1u) {
    let seed = vec2<f32>(select(0.25, 0.75, (quadrant & 1u) == 1u), select(0.25, 0.75, quadrant >= 2u));
    let hit = mp_newton(q, p, seed);
    if (hit.x > 0.5) { return hit; }
  }
  return vec3<f32>(0.0, 0.0, 0.0);
}
`;

/** The same functions in GLSL ES 3.00 (three.js ShaderMaterial on WebGL2). */
export const MESH_PATCH_GLSL = /* glsl */ `
  struct MeshPatch {
    vec2 a; vec2 b; vec2 c; vec2 d;
    vec2 ab1; vec2 ab2; vec2 dc1; vec2 dc2;
    vec2 ad1; vec2 ad2; vec2 bc1; vec2 bc2;
  };

  MeshPatch mpBuild(vec2 a, vec2 b, vec2 c, vec2 d,
                    vec2 aRight, vec2 aDown, vec2 bLeft, vec2 bDown,
                    vec2 cLeft, vec2 cUp, vec2 dRight, vec2 dUp) {
    MeshPatch p;
    p.a = a; p.b = b; p.c = c; p.d = d;
    p.ab1 = a + aRight; p.ab2 = b + bLeft;
    p.dc1 = d + dRight; p.dc2 = c + cLeft;
    p.ad1 = a + aDown;  p.ad2 = d + dUp;
    p.bc1 = b + bDown;  p.bc2 = c + cUp;
    return p;
  }

  vec2 mpBezier3(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
    float s = 1.0 - t;
    return s * s * s * p0 + 3.0 * s * s * t * p1 + 3.0 * s * t * t * p2 + t * t * t * p3;
  }

  vec2 mpBezier3Tangent(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
    float s = 1.0 - t;
    return 3.0 * (s * s * (p1 - p0) + 2.0 * s * t * (p2 - p1) + t * t * (p3 - p2));
  }

  vec2 mpEval(MeshPatch p, vec2 uv) {
    vec2 top = mpBezier3(p.a, p.ab1, p.ab2, p.b, uv.x);
    vec2 bottom = mpBezier3(p.d, p.dc1, p.dc2, p.c, uv.x);
    vec2 left = mpBezier3(p.a, p.ad1, p.ad2, p.d, uv.y);
    vec2 right = mpBezier3(p.b, p.bc1, p.bc2, p.c, uv.y);
    vec2 sheet = mix(mix(p.a, p.b, uv.x), mix(p.d, p.c, uv.x), uv.y);
    return mix(top, bottom, uv.y) + mix(left, right, uv.x) - sheet;
  }

  vec2 mpInner(MeshPatch p, int i, int j) {
    float fu = float(i) / 3.0;
    float fv = float(j) / 3.0;
    vec2 topI = i == 1 ? p.ab1 : p.ab2;
    vec2 bottomI = i == 1 ? p.dc1 : p.dc2;
    vec2 leftJ = j == 1 ? p.ad1 : p.ad2;
    vec2 rightJ = j == 1 ? p.bc1 : p.bc2;
    vec2 sheet = mix(mix(p.a, p.b, fu), mix(p.d, p.c, fu), fv);
    return mix(topI, bottomI, fv) + mix(leftJ, rightJ, fu) - sheet;
  }

  bool mpContainsBounds(MeshPatch p, vec2 q) {
    vec2 lo = min(min(p.a, p.b), min(p.c, p.d));
    vec2 hi = max(max(p.a, p.b), max(p.c, p.d));
    lo = min(lo, min(min(p.ab1, p.ab2), min(p.dc1, p.dc2)));
    hi = max(hi, max(max(p.ab1, p.ab2), max(p.dc1, p.dc2)));
    lo = min(lo, min(min(p.ad1, p.ad2), min(p.bc1, p.bc2)));
    hi = max(hi, max(max(p.ad1, p.ad2), max(p.bc1, p.bc2)));
    for (int j = 1; j <= 2; j++) {
      for (int i = 1; i <= 2; i++) {
        vec2 inner = mpInner(p, i, j);
        lo = min(lo, inner);
        hi = max(hi, inner);
      }
    }
    return all(greaterThanEqual(q, lo - vec2(0.002))) && all(lessThanEqual(q, hi + vec2(0.002)));
  }

  float mpCross(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

  vec2 mpInverseBilinear(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
    vec2 e = b - a;
    vec2 f = d - a;
    vec2 g = a - b + c - d;
    vec2 h = p - a;
    float k2 = mpCross(g, f);
    float k1 = mpCross(e, f) + mpCross(h, g);
    float k0 = mpCross(h, e);
    float u = -1.0;
    float v = -1.0;
    if (abs(k2) < 0.0001) {
      if (abs(k1) < 0.0001) return vec2(-1.0);
      v = -k0 / k1;
    } else {
      float discriminant = k1 * k1 - 4.0 * k0 * k2;
      if (discriminant < 0.0) return vec2(-1.0);
      float root = sqrt(discriminant);
      float v0 = (-k1 - root) / (2.0 * k2);
      float v1 = (-k1 + root) / (2.0 * k2);
      v = (v0 >= 0.0 && v0 <= 1.0) ? v0 : v1;
    }
    float denomX = e.x + g.x * v;
    float denomY = e.y + g.y * v;
    if (abs(denomX) > 0.0001) u = (h.x - f.x * v) / denomX;
    else if (abs(denomY) > 0.0001) u = (h.y - f.y * v) / denomY;
    return vec2(u, v);
  }

  vec3 mpNewton(vec2 q, MeshPatch p, vec2 start) {
    vec2 uv = start;
    vec2 residual = mpEval(p, uv) - q;
    for (int iteration = 0; iteration < 10; iteration++) {
      if (dot(residual, residual) < 1e-12) break;
      vec2 top = mpBezier3(p.a, p.ab1, p.ab2, p.b, uv.x);
      vec2 bottom = mpBezier3(p.d, p.dc1, p.dc2, p.c, uv.x);
      vec2 left = mpBezier3(p.a, p.ad1, p.ad2, p.d, uv.y);
      vec2 right = mpBezier3(p.b, p.bc1, p.bc2, p.c, uv.y);
      vec2 dTop = mpBezier3Tangent(p.a, p.ab1, p.ab2, p.b, uv.x);
      vec2 dBottom = mpBezier3Tangent(p.d, p.dc1, p.dc2, p.c, uv.x);
      vec2 dLeft = mpBezier3Tangent(p.a, p.ad1, p.ad2, p.d, uv.y);
      vec2 dRight = mpBezier3Tangent(p.b, p.bc1, p.bc2, p.c, uv.y);
      vec2 dSheetU = mix(p.b - p.a, p.c - p.d, uv.y);
      vec2 dSheetV = mix(p.d, p.c, uv.x) - mix(p.a, p.b, uv.x);
      vec2 du = mix(dTop, dBottom, uv.y) + (right - left) - dSheetU;
      vec2 dv = (bottom - top) + mix(dLeft, dRight, uv.x) - dSheetV;
      float det = du.x * dv.y - dv.x * du.y;
      if (abs(det) < 1e-9) return vec3(0.0, uv);
      vec2 delta = vec2(
        (residual.x * dv.y - residual.y * dv.x) / det,
        (du.x * residual.y - du.y * residual.x) / det
      );
      uv = clamp(uv - delta, vec2(-0.5), vec2(1.5));
      residual = mpEval(p, uv) - q;
    }
    bool inside = all(greaterThanEqual(uv, vec2(-0.0005))) && all(lessThanEqual(uv, vec2(1.0005)));
    bool converged = dot(residual, residual) < 1e-9;
    return vec3((inside && converged) ? 1.0 : 0.0, clamp(uv, vec2(0.0), vec2(1.0)));
  }

  // (found, u, v) of q inside the patch.
  vec3 mpUv(vec2 q, MeshPatch p) {
    vec2 start = mpInverseBilinear(q, p.a, p.b, p.c, p.d);
    if (all(greaterThanEqual(start, vec2(-0.25))) && all(lessThanEqual(start, vec2(1.25)))) {
      vec3 hit = mpNewton(q, p, clamp(start, vec2(0.0), vec2(1.0)));
      if (hit.x > 0.5) return hit;
    }
    vec3 centre = mpNewton(q, p, vec2(0.5));
    if (centre.x > 0.5) return centre;
    for (int quadrant = 0; quadrant < 4; quadrant++) {
      vec2 seed = vec2((quadrant == 1 || quadrant == 3) ? 0.75 : 0.25, quadrant >= 2 ? 0.75 : 0.25);
      vec3 hit = mpNewton(q, p, seed);
      if (hit.x > 0.5) return hit;
    }
    return vec3(0.0);
  }
`;
