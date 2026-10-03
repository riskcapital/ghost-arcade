/**
 * sliceOutputShader.ts — the Screen window's WebGPU pass (SliceOutputApp).
 *
 * One fullscreen pass per projector frame: projector calibration, rotation,
 * the screen's crop / corner / mesh warp, colour correction, edge and
 * shared-overlap blending, black-level lift and screen masks. The same
 * model as blendRenderer.ts's WebGL slice shader, in a y-down frame (the
 * editor's VideoFrame is top-down). Kept out of the component so the GPU
 * test drives exactly what the window runs.
 */

import type { OutputSlice } from '../stores/settings';
import { projectorCalibrationUniforms } from './projectorCalibration';
import { packScreenMasks, SCREEN_MASK_MAX } from '../stores/screenMaskGeometry';

export const SLICE_SHADER_WGSL = /* wgsl */ `
@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_external;

struct SliceUniform {
  crop: vec4<f32>,
  color: vec4<f32>,
  blendW: vec4<f32>,
  blendG: vec4<f32>,
  black: vec4<f32>,
};
@group(0) @binding(2) var<uniform> uSlice: SliceUniform;

// Everything about where the picture lands, packed by writeSliceGeometry:
//   warp   = (mode 0 rect / 1 corners / 2 mesh, mesh rows, mesh cols, _)
//   c0, c1 = corner quad (TL.xy, TR.xy) and (BR.xy, BL.xy), canvas 0..1
//   cal    = projector calibration (projectorCalibration.ts), y-down here
//   smask  = (mask count, keep-mask count, _, _); per mask info is
//            (first vertex, vertex count, feather, invert) and bounds the
//            padded vertex bounds (screenMaskGeometry.ts packScreenMasks)
//   mesh / smask_pts = points two per vec4 (mesh row-major, up to 32x32)
struct SliceGeometry {
  warp: vec4<f32>,
  c0: vec4<f32>,
  c1: vec4<f32>,
  cal: array<vec4<f32>, 5>,
  smask: vec4<f32>,
  smask_info: array<vec4<f32>, 8>,
  smask_bounds: array<vec4<f32>, 8>,
  mesh: array<vec4<f32>, 512>,
  smask_pts: array<vec4<f32>, 512>,
};
@group(0) @binding(3) var<uniform> uGeom: SliceGeometry;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );
  var out: VSOut;
  out.clip = vec4<f32>(positions[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

fn srgbToLinear(c: vec3<f32>) -> vec3<f32> {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3<f32>(2.4)), step(vec3<f32>(0.04045), c));
}

fn linearToSrgb(c: vec3<f32>) -> vec3<f32> {
  return mix(c * 12.92, 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055, step(vec3<f32>(0.0031308), c));
}

fn blendCurve(xIn: f32, pIn: f32) -> f32 {
  let x = clamp(xIn, 0.0, 1.0);
  let p = max(pIn, 0.01);
  if (x < 0.5) {
    return 0.5 * pow(2.0 * x, p);
  }
  return 1.0 - 0.5 * pow(2.0 * (1.0 - x), p);
}

fn edgeFactor(distance: f32, width: f32, gamma: f32) -> f32 {
  if (width <= 0.0) {
    return 1.0;
  }
  return blendCurve(distance / width, gamma);
}

fn meshPoint(index: i32) -> vec2<f32> {
  let packed = uGeom.mesh[clamp(index / 2, 0, 511)];
  return select(packed.zw, packed.xy, (index % 2) == 0);
}

fn maskPoint(index: i32) -> vec2<f32> {
  let packed = uGeom.smask_pts[clamp(index / 2, 0, 511)];
  return select(packed.zw, packed.xy, (index % 2) == 0);
}

fn segmentDistance(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.000001), 0.0, 1.0);
  return length(pa - ba * h);
}

/// One mask polygon: 1 inside, ramping to 0 over the feather measured
/// inward from the edge, 0 outside (even-odd crossing on the flattened
/// outline, so a curved edge feathers along its curve).
fn maskCoverage(uv: vec2<f32>, m: i32) -> f32 {
  let info = uGeom.smask_info[m];
  let start = i32(floor(info.x + 0.5));
  let count = min(i32(floor(info.y + 0.5)), 128);
  if (count < 3) { return 0.0; }
  let bounds = uGeom.smask_bounds[m];
  if (any(uv < bounds.xy) || any(uv > bounds.zw)) { return 0.0; }
  var inside = false;
  var minEdge = 1000.0;
  for (var i: i32 = 0; i < 128; i = i + 1) {
    if (i >= count) { break; }
    let a = maskPoint(start + i);
    let b = maskPoint(start + select(0, i + 1, i + 1 < count));
    if ((a.y <= uv.y && b.y > uv.y) || (a.y > uv.y && b.y <= uv.y)) {
      let x = (b.x - a.x) * (uv.y - a.y) / (b.y - a.y) + a.x;
      if (uv.x < x) { inside = !inside; }
    }
    minEdge = min(minEdge, segmentDistance(uv, a, b));
  }
  if (!inside) { return 0.0; }
  let feather = max(0.0, info.z);
  if (feather > 0.001) { return smoothstep(0.0, feather, minEdge); }
  return 1.0;
}

/// Normal masks keep the union of their insides (no normal mask keeps
/// everything); each inverted mask then cuts a hole.
fn maskAlpha(uv: vec2<f32>) -> f32 {
  let count = min(i32(floor(uGeom.smask.x + 0.5)), 8);
  if (count <= 0) { return 1.0; }
  var keep = select(1.0, 0.0, uGeom.smask.y > 0.5);
  var cut = 1.0;
  for (var m: i32 = 0; m < 8; m = m + 1) {
    if (m >= count) { break; }
    let coverage = maskCoverage(uv, m);
    if (uGeom.smask_info[m].w > 0.5) {
      cut = cut * (1.0 - coverage);
    } else {
      keep = max(keep, coverage);
    }
  }
  return clamp(keep * cut, 0.0, 1.0);
}

/// Screen content UV -> master canvas sample position: the screen's crop,
/// corner quad, or mesh (the forward map blendRenderer runs).
fn sliceSourceUv(uv: vec2<f32>) -> vec2<f32> {
  let mode = i32(floor(uGeom.warp.x + 0.5));
  if (mode == 1) {
    let top = mix(uGeom.c0.xy, uGeom.c0.zw, uv.x);
    let bottom = mix(uGeom.c1.zw, uGeom.c1.xy, uv.x);
    return mix(top, bottom, uv.y);
  }
  let rows = i32(floor(uGeom.warp.y + 0.5));
  let cols = i32(floor(uGeom.warp.z + 0.5));
  if (mode == 2 && rows > 1 && cols > 1) {
    let fx = uv.x * f32(cols - 1);
    let fy = uv.y * f32(rows - 1);
    let ci = i32(clamp(floor(fx), 0.0, f32(cols - 2)));
    let ri = i32(clamp(floor(fy), 0.0, f32(rows - 2)));
    let u = clamp(fx - f32(ci), 0.0, 1.0);
    let v = clamp(fy - f32(ri), 0.0, 1.0);
    let p00 = meshPoint(ri * cols + ci);
    let p10 = meshPoint(ri * cols + ci + 1);
    let p01 = meshPoint((ri + 1) * cols + ci);
    let p11 = meshPoint((ri + 1) * cols + ci + 1);
    return mix(mix(p00, p10, u), mix(p01, p11, u), v);
  }
  let crop = uSlice.crop;
  return crop.xy + uv * crop.zw;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var uv = in.uv;
  // Projector calibration first: the inverse homography takes this pixel
  // of the projector's raster back into the screen's frame. Outside the
  // corrected quad, or with crossed corners, the projector shows black.
  let calState = uGeom.cal[2].w;
  if (calState < -0.5) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  if (calState > 0.5) {
    let p = vec3<f32>(uv, 1.0);
    let z = dot(uGeom.cal[2].xyz, p);
    if (abs(z) < 0.000001) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    let q = vec2<f32>(dot(uGeom.cal[0].xyz, p), dot(uGeom.cal[1].xyz, p)) / z;
    if (any(q < vec2<f32>(0.0)) || any(q > vec2<f32>(1.0))) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    uv = q;
  }
  let rotation = uSlice.color.w;
  if (rotation > 0.5 && rotation < 1.5) {
    uv = vec2<f32>(uv.y, 1.0 - uv.x);
  } else if (rotation > 1.5 && rotation < 2.5) {
    uv = vec2<f32>(1.0 - uv.x, 1.0 - uv.y);
  } else if (rotation > 2.5) {
    uv = vec2<f32>(1.0 - uv.y, uv.x);
  }

  let srcUv = sliceSourceUv(uv);
  let src = textureSampleBaseClampToEdge(uTexture, uSampler, clamp(srcUv, vec2<f32>(0.0), vec2<f32>(1.0)));
  var col = srgbToLinear(src.rgb);

  col = col * max(uSlice.color.x, 0.0);
  col = (col - 0.5) * max(uSlice.color.y, 0.0) + 0.5;
  col = pow(max(col, vec3<f32>(0.0)), vec3<f32>(1.0 / max(uSlice.color.z, 0.01)));

  let edgeUv = in.uv;
  let aL = edgeFactor(edgeUv.x, uSlice.blendW.x, uSlice.blendG.x);
  let aR = edgeFactor(1.0 - edgeUv.x, uSlice.blendW.y, uSlice.blendG.y);
  let aT = edgeFactor(edgeUv.y, uSlice.blendW.z, uSlice.blendG.z);
  let aB = edgeFactor(1.0 - edgeUv.y, uSlice.blendW.w, uSlice.blendG.w);
  var alpha = aL * aR * aT * aB;
  // Shared overlap band: complementary fades in composition coordinates,
  // boundaries interpolated from top to bottom so the band can angle.
  if (uGeom.cal[4].x > 0.5) {
    let band = uGeom.cal[3];
    let start = mix(band.x, band.y, srcUv.y);
    let end = mix(band.z, band.w, srcUv.y);
    let weight = clamp((srcUv.x - start) / max(end - start, 0.000001), 0.0, 1.0);
    alpha = alpha * select(1.0 - weight, weight, uGeom.cal[4].y > 0.5);
  }

  let liftMix = mix(alpha, smoothstep(0.0, 1.0, alpha), clamp(uSlice.black.w, 0.0, 1.0));
  col = col + max(uSlice.black.rgb, vec3<f32>(0.0)) * liftMix;
  // Masks are cut in the screen's content space, so they ride along with a
  // re-pinned or calibrated screen, and they cut the black-level lift too.
  col = col * alpha * maskAlpha(uv);

  return vec4<f32>(linearToSrgb(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}`;

function clamp01(value: number, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function clampPositive(value: number, fallback = 1, min = 0.001, max = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function rotationIndex(rotation: number | undefined): number {
  if (rotation === 90) return 1;
  if (rotation === 180) return 2;
  if (rotation === 270) return 3;
  return 0;
}

/** SliceUniform (binding 2): crop, colour, blend widths and gammas, black. */
export const SLICE_UNIFORM_FLOATS = 5 * 4;

export function packSliceUniform(s: OutputSlice, u: Float32Array): void {
  const cropX = clamp01(s.cropX, 0);
  const cropY = clamp01(s.cropY, 0);
  const cropW = Math.min(clampPositive(s.cropW, 1), 1 - cropX);
  const cropH = Math.min(clampPositive(s.cropH, 1), 1 - cropY);
  const defG = s.edgeBlendGamma ?? 2.2;
  u[0] = cropX;
  u[1] = cropY;
  u[2] = Math.max(0.001, cropW);
  u[3] = Math.max(0.001, cropH);
  u[4] = Math.max(0, s.brightness ?? 1);
  u[5] = Math.max(0, s.contrast ?? 1);
  u[6] = Math.max(0.01, s.gamma ?? 1);
  u[7] = rotationIndex(s.rotation);
  u[8] = clamp01(s.edgeBlendLeft ?? 0);
  u[9] = clamp01(s.edgeBlendRight ?? 0);
  u[10] = clamp01(s.edgeBlendTop ?? 0);
  u[11] = clamp01(s.edgeBlendBottom ?? 0);
  u[12] = Math.max(0.01, s.edgeBlendLeftGamma ?? defG);
  u[13] = Math.max(0.01, s.edgeBlendRightGamma ?? defG);
  u[14] = Math.max(0.01, s.edgeBlendTopGamma ?? defG);
  u[15] = Math.max(0.01, s.edgeBlendBottomGamma ?? defG);
  u[16] = Math.max(0, s.blackLevelR ?? 0);
  u[17] = Math.max(0, s.blackLevelG ?? 0);
  u[18] = Math.max(0, s.blackLevelB ?? 0);
  u[19] = clamp01(s.blackLevelFeather ?? 0.5, 0.5);
}

// SliceGeometry layout in floats (see the WGSL struct).
const GEOM_WARP = 0;
const GEOM_C0 = 4;
const GEOM_C1 = 8;
const GEOM_CAL = 12;
const GEOM_SMASK = 32;
const GEOM_SMASK_INFO = 36;
const GEOM_SMASK_BOUNDS = GEOM_SMASK_INFO + SCREEN_MASK_MAX * 4;
const GEOM_MESH = GEOM_SMASK_BOUNDS + SCREEN_MASK_MAX * 4;
const GEOM_SMASK_PTS = GEOM_MESH + 512 * 4;
export const SLICE_GEOMETRY_FLOATS = GEOM_SMASK_PTS + 512 * 4;
const MAX_SLICE_MESH_POINTS = 1024; // 32 x 32, as blendRenderer

/** SliceGeometry (binding 3): where the picture lands. Same self-healing as
 *  blendRenderer: a corner/mesh screen whose geometry never initialised
 *  still takes its mode, from the crop. */
export function packSliceGeometry(s: OutputSlice, g: Float32Array): void {
  g.fill(0);
  const mode = s.warpMode ?? 'rect';
  const mesh = s.meshGrid;
  if (mode === 'corners') {
    const c = s.corners ?? {
      topLeft: { x: s.cropX, y: s.cropY },
      topRight: { x: s.cropX + s.cropW, y: s.cropY },
      bottomLeft: { x: s.cropX, y: s.cropY + s.cropH },
      bottomRight: { x: s.cropX + s.cropW, y: s.cropY + s.cropH },
    };
    g[GEOM_WARP] = 1;
    g.set([c.topLeft.x, c.topLeft.y, c.topRight.x, c.topRight.y], GEOM_C0);
    g.set([c.bottomRight.x, c.bottomRight.y, c.bottomLeft.x, c.bottomLeft.y], GEOM_C1);
  } else if (mode === 'mesh' && mesh && mesh.rows >= 2 && mesh.cols >= 2 && mesh.rows * mesh.cols <= MAX_SLICE_MESH_POINTS) {
    g[GEOM_WARP] = 2;
    g[GEOM_WARP + 1] = mesh.rows;
    g[GEOM_WARP + 2] = mesh.cols;
    for (let r = 0; r < mesh.rows; r++) {
      for (let c = 0; c < mesh.cols; c++) {
        const p = mesh.points[r]?.[c];
        const i = GEOM_MESH + (r * mesh.cols + c) * 2;
        g[i] = p?.x ?? 0;
        g[i + 1] = p?.y ?? 0;
      }
    }
  }
  // projectorCalibrationUniforms is written for blendRenderer's y-up UV;
  // this shader is y-down, so the homography is solved on the corners as
  // given and used directly (no flip on either side).
  projectorCalibrationUniforms(s).forEach((row, i) => g.set(row, GEOM_CAL + i * 4));
  const masks = packScreenMasks(s.masks);
  g[GEOM_SMASK] = masks.count;
  g[GEOM_SMASK + 1] = masks.keepCount;
  g.set(masks.info, GEOM_SMASK_INFO);
  g.set(masks.bounds, GEOM_SMASK_BOUNDS);
  g.set(masks.points, GEOM_SMASK_PTS);
}
