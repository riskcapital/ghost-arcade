/**
 * GPU-based slice renderer — replaces the 2D-canvas crop + gradient-strip
 * post-process with a single WebGL fragment-shader pass that does:
 *
 *   1.  Map projector-side UV (vUv) to a sample position on the master
 *       canvas, using one of three warp modes:
 *          rect    — axis-aligned crop (uCrop).
 *          corners — 4-point quad warp (uCornerTL/TR/BL/BR).
 *          mesh    — per-cell bilinear over a uMeshTex DataTexture
 *                    (rows × cols control points).
 *   2.  Apply per-axis rotation (0/90/180/270°).
 *   3.  Apply brightness / contrast / gamma in linear space.
 *   4.  Compute per-edge alpha using the Paul Bourke piecewise S-curve
 *       (canonical edge-blending formula used by Resolume, MadMapper,
 *       TouchDesigner, VIOSO). Per-edge gamma overrides supported.
 *   5.  Add a per-channel black-level lift on the NON-overlap region
 *       with feathered boundary so real projectors don't show a
 *       brighter overlap stripe.
 *
 * The 2D-canvas path (outputPostProcess.applyEdgeBlending) is retained
 * as a fallback when WebGL is unavailable; this module just runs
 * faster, handles 4×4K rigs without choking the main thread, and can
 * ADD light (black-level lift) where the 2D path can only subtract.
 *
 * Reuses a single hidden WebGLRenderer + ShaderMaterial across slices
 * — instantiating one per slice would chew device memory and stall
 * on GPU sync. A single backing canvas is resized per slice via
 * gl.viewport calls, not by recreating buffers. Mesh data is
 * uploaded as a small float DataTexture only when the slice's mesh
 * actually changes (per-frame uniform writes stay cheap).
 */

import * as THREE from 'three';
import type { OutputSlice, OutputWarp } from '../stores/settings';
import { createDefaultSlice, identityOutputCorners } from '../stores/settings';

// ─── Module-singleton renderer ──────────────────────────────────────────
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | null = null;
let quad: THREE.Mesh | null = null;
let material: THREE.ShaderMaterial | null = null;
let sourceTexture: THREE.CanvasTexture | null = null;
// Reusable single-pixel placeholder DataTexture so the uMeshTex
// uniform is always bound — sampling an unbound texture is undefined
// behavior on some drivers. The shader gates on uWarpMode so the
// placeholder is never actually sampled, but it must exist.
let meshTexPlaceholder: THREE.DataTexture | null = null;
// Per-slice mesh texture cache. Keyed by sliceId so we don't
// reallocate a DataTexture every frame for a screen whose mesh hasn't
// changed. Invalidated by a hash of the points array.
const meshTexCache = new Map<string, { tex: THREE.DataTexture; hash: string; cols: number; rows: number }>();

let backingCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

let readbackPixels: Uint8Array | null = null;
let readbackW = 0;
let readbackH = 0;

// Largest mesh dimension we support (per-side). Mesh data is uploaded
// as a `MAX_MESH × MAX_MESH` float DataTexture, sampled with nearest
// filtering — only the actual (rows × cols) sub-region is meaningful;
// the rest is unused padding. 32 is generous: a 32×32 control mesh is
// way more than typical projection-mapping rigs need (~5×5 is the
// MadMapper default).
const MAX_MESH = 32;

// ─── Shader source ─────────────────────────────────────────────────────
const VERT_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAG_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uSource;
  // Crop region for rect mode (normalized 0..1 on master canvas).
  uniform vec4 uCrop;          // (x, y, w, h)
  // Warp mode discriminator: 0 = rect, 1 = corners, 2 = mesh.
  uniform int uWarpMode;
  // Corners mode: 4 sample positions on the master canvas. UV order:
  //   TL = (uCornerTL.xy), TR = (uCornerTR.xy)
  //   BL = (uCornerBL.xy), BR = (uCornerBR.xy)
  // Bilinear interpolated across vUv to produce the source sample.
  uniform vec2 uCornerTL;
  uniform vec2 uCornerTR;
  uniform vec2 uCornerBL;
  uniform vec2 uCornerBR;
  // Mesh mode: control-point texture (RG float, MAX_MESH × MAX_MESH).
  // Each texel encodes one point's (x, y) on the master canvas.
  // Only the (uMeshRows × uMeshCols) sub-rect is meaningful.
  uniform sampler2D uMeshTex;
  uniform int uMeshRows;
  uniform int uMeshCols;

  // Rotation: 0/1/2/3 = 0/90/180/270 degrees.
  uniform int uRotation;
  // Color correction (linear-space).
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uGamma;
  // Edge blend widths per edge (0..0.5 of the slice).
  uniform vec4 uBlendW;        // (left, right, top, bottom)
  uniform vec4 uBlendG;        // (left, right, top, bottom) S-curve power
  uniform vec3 uBlackLevel;
  uniform float uBlackFeather;
  // Stage-effect intensity multiplier (0..1). Modulates the screen's
  // brightness based on the bound stage effect's per-frame value.
  // Defaults to 1.0 when no stage effect is bound.
  uniform float uStageIntensity;

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  float blendCurve(float x, float p) {
    if (x < 0.5) return 0.5 * pow(2.0 * x, p);
    return 1.0 - 0.5 * pow(2.0 * (1.0 - x), p);
  }

  // Read one mesh control point from the texture. Texels are
  // center-sampled so (col + 0.5) / texDim avoids edge bleeding.
  vec2 meshAt(int ri, int ci) {
    float texDim = ${MAX_MESH}.0;
    vec2 uv = vec2((float(ci) + 0.5) / texDim, (float(ri) + 0.5) / texDim);
    return texture2D(uMeshTex, uv).rg;
  }

  // Inverse bilinear: given a point p and a quad (a, b, c, d) where
  // bilinear(a, b, c, d, u, v) = mix(mix(a, b, u), mix(d, c, u), v),
  // find (u, v) such that the formula equals p. Returns (-1, -1) if
  // p is outside the quad. Closed-form solution from Inigo Quilez:
  // https://www.iquilezles.org/www/articles/ibilinear/ibilinear.htm
  // Quad winding here: a=TL, b=TR, c=BR, d=BL.
  float cross2D(vec2 v, vec2 w) { return v.x * w.y - v.y * w.x; }
  vec2 invBilinear(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
    vec2 e = b - a;
    vec2 f = d - a;
    vec2 g = a - b + c - d;
    vec2 h = p - a;
    float k2 = cross2D(g, f);
    float k1 = cross2D(e, f) + cross2D(h, g);
    float k0 = cross2D(h, e);
    if (abs(k2) < 0.0001) {
      // Degenerate to a parallelogram (k2 ≈ 0): linear solve.
      float v = -k0 / k1;
      float denomU = e.x + g.x * v;
      float u = abs(denomU) > 0.0001
        ? (h.x - f.x * v) / denomU
        : (h.y - f.y * v) / (e.y + g.y * v);
      return vec2(u, v);
    }
    float w = k1 * k1 - 4.0 * k0 * k2;
    if (w < 0.0) return vec2(-1.0);
    w = sqrt(w);
    float v1 = (-k1 - w) / (2.0 * k2);
    float v2 = (-k1 + w) / (2.0 * k2);
    // Pick the root that lies in [0, 1].
    float v = (v1 >= 0.0 && v1 <= 1.0) ? v1 : v2;
    float denomU = e.x + g.x * v;
    float u = abs(denomU) > 0.0001
      ? (h.x - f.x * v) / denomU
      : (h.y - f.y * v) / (e.y + g.y * v);
    return vec2(u, v);
  }

  void main() {
    vec2 uv = vUv;
    // Rotate the projector-side UV first so "left" / "top" in the
    // operator's mental model always match the projector's physical
    // edges, independent of which way the screen is mounted.
    if (uRotation == 1) uv = vec2(uv.y, 1.0 - uv.x);
    else if (uRotation == 2) uv = vec2(1.0 - uv.x, 1.0 - uv.y);
    else if (uRotation == 3) uv = vec2(1.0 - uv.y, uv.x);

    // ─ Forward map: projector UV → master canvas sample position. ─
    vec2 srcUv;
    if (uWarpMode == 1) {
      // Corners: bilinear interpolation of the 4 corner positions.
      // Top row = mix(TL, TR), bottom row = mix(BL, BR), then mix
      // them down by uv.y. This is the same projective approximation
      // MadMapper / Resolume use for their quad-warp.
      vec2 top    = mix(uCornerTL, uCornerTR, uv.x);
      vec2 bottom = mix(uCornerBL, uCornerBR, uv.x);
      srcUv = mix(top, bottom, uv.y);
    } else if (uWarpMode == 2 && uMeshRows > 1 && uMeshCols > 1) {
      // Mesh: find the cell containing this UV, then bilinear-interp
      // the cell's 4 corner sample positions.
      float fx = uv.x * float(uMeshCols - 1);
      float fy = uv.y * float(uMeshRows - 1);
      int ci = int(clamp(floor(fx), 0.0, float(uMeshCols - 2)));
      int ri = int(clamp(floor(fy), 0.0, float(uMeshRows - 2)));
      float u = clamp(fx - float(ci), 0.0, 1.0);
      float v = clamp(fy - float(ri), 0.0, 1.0);
      vec2 p00 = meshAt(ri,     ci);
      vec2 p10 = meshAt(ri,     ci + 1);
      vec2 p01 = meshAt(ri + 1, ci);
      vec2 p11 = meshAt(ri + 1, ci + 1);
      srcUv = mix(mix(p00, p10, u), mix(p01, p11, u), v);
    } else if (uWarpMode == 3) {
      // ─ Master warp: FORWARD / destination semantics (matches the
      //   layer "map mode" feel). The four corners are where the
      //   content's corners LAND on the output, and the mesh (if any)
      //   deforms WITHIN that corner-pinned quad. We invert that forward
      //   map to sample: output uv → quad-local q (inverse-bilinear over
      //   the corner quad) → if a mesh is present, invert the mesh
      //   deformation per-cell → content UV. Pixels outside the quad are
      //   black — so pulling a corner inward crops/keystones the image,
      //   exactly like dragging a layer's corner in map mode.
      vec2 q = invBilinear(uv, uCornerTL, uCornerTR, uCornerBR, uCornerBL);
      if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      if (uMeshRows > 1 && uMeshCols > 1) {
        // Invert the mesh deformation: the mesh control points are in
        // quad-local 0..1 coords, so find the deformed cell containing q
        // and inverse-bilinear to recover the content UV.
        bool found = false;
        vec2 cellUv = vec2(0.0);
        for (int ri = 0; ri < ${MAX_MESH} - 1; ri++) {
          if (ri >= uMeshRows - 1) break;
          for (int ci = 0; ci < ${MAX_MESH} - 1; ci++) {
            if (ci >= uMeshCols - 1) break;
            if (found) continue;
            vec2 a = meshAt(ri,     ci);
            vec2 b = meshAt(ri,     ci + 1);
            vec2 c = meshAt(ri + 1, ci + 1);
            vec2 d = meshAt(ri + 1, ci);
            vec2 t = invBilinear(q, a, b, c, d);
            if (t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0) {
              float gu = (float(ci) + t.x) / float(uMeshCols - 1);
              float gv = (float(ri) + t.y) / float(uMeshRows - 1);
              cellUv = vec2(gu, gv);
              found = true;
            }
          }
        }
        if (!found) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        srcUv = cellUv;
      } else {
        srcUv = q;
      }
    } else {
      // Rect (default fallback): the original axis-aligned crop.
      srcUv = uCrop.xy + uv * uCrop.zw;
    }

    vec4 src = texture2D(uSource, srcUv);
    vec3 col = srgbToLinear(src.rgb);

    col *= uBrightness;
    col = (col - 0.5) * uContrast + 0.5;
    col = pow(max(col, 0.0), vec3(1.0 / uGamma));

    // Edge blend alpha — projector-side UV, so "left" is always the
    // physical left edge of the projected image.
    float aL = uBlendW.x > 0.0 ? blendCurve(clamp(vUv.x / uBlendW.x, 0.0, 1.0), uBlendG.x) : 1.0;
    float aR = uBlendW.y > 0.0 ? blendCurve(clamp((1.0 - vUv.x) / uBlendW.y, 0.0, 1.0), uBlendG.y) : 1.0;
    float aT = uBlendW.z > 0.0 ? blendCurve(clamp((1.0 - vUv.y) / uBlendW.z, 0.0, 1.0), uBlendG.z) : 1.0;
    float aB = uBlendW.w > 0.0 ? blendCurve(clamp(vUv.y / uBlendW.w, 0.0, 1.0), uBlendG.w) : 1.0;
    float alpha = aL * aR * aT * aB;

    float liftMix = mix(alpha, smoothstep(0.0, 1.0, alpha), uBlackFeather);
    col += uBlackLevel * liftMix;

    col *= alpha * uStageIntensity;

    gl_FragColor = vec4(linearToSrgb(clamp(col, 0.0, 1.0)), 1.0);
  }
`;

// Build the placeholder mesh DataTexture (sampled but never used when
// uWarpMode != 2). Must exist so the uMeshTex uniform binding stays
// valid across switching slices in/out of mesh mode.
function ensureMeshPlaceholder(): THREE.DataTexture {
  if (meshTexPlaceholder) return meshTexPlaceholder;
  const data = new Float32Array(MAX_MESH * MAX_MESH * 2);
  meshTexPlaceholder = new THREE.DataTexture(
    data,
    MAX_MESH,
    MAX_MESH,
    THREE.RGFormat,
    THREE.FloatType,
  );
  meshTexPlaceholder.magFilter = THREE.NearestFilter;
  meshTexPlaceholder.minFilter = THREE.NearestFilter;
  meshTexPlaceholder.wrapS = THREE.ClampToEdgeWrapping;
  meshTexPlaceholder.wrapT = THREE.ClampToEdgeWrapping;
  meshTexPlaceholder.needsUpdate = true;
  return meshTexPlaceholder;
}

// Stable hash of a mesh's contents for cache invalidation. JSON is
// fast enough for ≤32×32 grids (the upper bound).
function meshHash(slice: OutputSlice): string {
  const g = slice.meshGrid;
  if (!g) return 'none';
  return `${g.rows}x${g.cols}:${JSON.stringify(g.points)}`;
}

// Generic mesh-texture packer used by both source mesh (master-canvas
// coords) and output mesh (projector-quad coords). Shape is identical;
// only the cache + content differ. `mesh` is the MeshWarpGrid to pack.
function packMeshToTexture(
  cache: Map<string, { tex: THREE.DataTexture; hash: string; cols: number; rows: number }>,
  sliceId: string,
  mesh: { rows: number; cols: number; points: { x: number; y: number }[][] } | null | undefined,
  hash: string,
): THREE.DataTexture {
  if (!mesh || mesh.rows < 2 || mesh.cols < 2) return ensureMeshPlaceholder();
  const cached = cache.get(sliceId);
  if (cached && cached.hash === hash) return cached.tex;
  const data = new Float32Array(MAX_MESH * MAX_MESH * 2);
  for (let r = 0; r < mesh.rows; r++) {
    for (let c = 0; c < mesh.cols; c++) {
      const p = mesh.points[r]?.[c];
      const i = (r * MAX_MESH + c) * 2;
      data[i] = p?.x ?? 0;
      data[i + 1] = p?.y ?? 0;
    }
  }
  if (cached) {
    (cached.tex.image.data as Float32Array).set(data);
    cached.tex.needsUpdate = true;
    cache.set(sliceId, { tex: cached.tex, hash, cols: mesh.cols, rows: mesh.rows });
    return cached.tex;
  }
  const tex = new THREE.DataTexture(data, MAX_MESH, MAX_MESH, THREE.RGFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  cache.set(sliceId, { tex, hash, cols: mesh.cols, rows: mesh.rows });
  return tex;
}

// Source mesh texture for a slice. Cached + content-hashed so drag
// edits update GPU-side incrementally rather than reallocating.
function meshTextureFor(slice: OutputSlice): THREE.DataTexture {
  return packMeshToTexture(meshTexCache, slice.id, slice.meshGrid, meshHash(slice));
}

function ensureRenderer(maxW: number, maxH: number): boolean {
  if (renderer && backingCanvas) {
    const cw = (backingCanvas as HTMLCanvasElement).width;
    const ch = (backingCanvas as HTMLCanvasElement).height;
    if (cw < maxW || ch < maxH) {
      try {
        renderer.setSize(Math.max(cw, maxW), Math.max(ch, maxH), false);
      } catch {
        return false;
      }
    }
    return true;
  }
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      backingCanvas = new OffscreenCanvas(maxW, maxH) as any;
    } else {
      backingCanvas = document.createElement('canvas');
      (backingCanvas as HTMLCanvasElement).width = maxW;
      (backingCanvas as HTMLCanvasElement).height = maxH;
    }
    renderer = new THREE.WebGLRenderer({
      canvas: backingCanvas as any,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(maxW, maxH, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    material = new THREE.ShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      uniforms: {
        uSource: { value: null },
        uCrop: { value: new THREE.Vector4(0, 0, 1, 1) },
        uWarpMode: { value: 0 },
        uCornerTL: { value: new THREE.Vector2(0, 0) },
        uCornerTR: { value: new THREE.Vector2(1, 0) },
        uCornerBL: { value: new THREE.Vector2(0, 1) },
        uCornerBR: { value: new THREE.Vector2(1, 1) },
        uMeshTex: { value: ensureMeshPlaceholder() },
        uMeshRows: { value: 0 },
        uMeshCols: { value: 0 },
        uRotation: { value: 0 },
        uBrightness: { value: 1 },
        uContrast: { value: 1 },
        uGamma: { value: 1 },
        uBlendW: { value: new THREE.Vector4(0, 0, 0, 0) },
        uBlendG: { value: new THREE.Vector4(2.2, 2.2, 2.2, 2.2) },
        uBlackLevel: { value: new THREE.Vector3(0, 0, 0) },
        uBlackFeather: { value: 0.5 },
        uStageIntensity: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);
    return true;
  } catch (err) {
    console.warn('[blendRenderer] WebGL init failed; falling back to 2D canvas path', err);
    renderer = null;
    return false;
  }
}

function setSourceFrame(source: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | ImageBitmap) {
  if (!sourceTexture || (sourceTexture as any).image !== source) {
    if (sourceTexture) sourceTexture.dispose();
    sourceTexture = new THREE.CanvasTexture(source as any);
    sourceTexture.flipY = false;
    sourceTexture.minFilter = THREE.LinearFilter;
    sourceTexture.magFilter = THREE.LinearFilter;
    sourceTexture.wrapS = THREE.ClampToEdgeWrapping;
    sourceTexture.wrapT = THREE.ClampToEdgeWrapping;
    (sourceTexture as any).colorSpace = THREE.SRGBColorSpace;
  }
  sourceTexture.needsUpdate = true;
  if (material) material.uniforms.uSource.value = sourceTexture;
}

/**
 * Render one slice into the backing WebGL canvas and read back the
 * pixels at the slice's output resolution. Returns Uint8Array of RGBA
 * bytes or null if WebGL is unavailable.
 *
 * `stageIntensity` (0..1) scales final output — used by the per-screen
 * stage effects (radial pulse, beat strobe, etc.). Defaults to 1.
 */
export function renderSlicePixels(
  source: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | ImageBitmap,
  slice: OutputSlice,
  sliceW: number,
  sliceH: number,
  stageIntensity = 1,
  // gl.readPixels returns bottom-up rows. The native senders (Spout/
  // Syphon/NDI) consume the buffer directly and expect that flipped to
  // top-down (flip=true, the default). The master-warp path instead
  // feeds putImageData, which is ALSO top-down — but it draws the result
  // onto a 2D canvas that's then captured upright, so it must match the
  // un-warped drawImage(webglCanvas) passthrough, which is one flip the
  // other way. That path passes flip=false.
  flip = true,
  // Master warp: route through the forward/destination warp branch
  // (uWarpMode=3) — corners are where content lands + mesh deforms
  // within the quad, matching the layer "map mode" feel. The synthetic
  // master slice carries the corners/mesh; crop is ignored here.
  masterForward = false,
): Uint8Array | null {
  if (sliceW <= 0 || sliceH <= 0) return null;
  if (!ensureRenderer(sliceW, sliceH)) return null;
  setSourceFrame(source);

  const u = material!.uniforms;
  u.uCrop.value.set(slice.cropX, slice.cropY, slice.cropW, slice.cropH);
  // Warp mode dispatch. Corners and mesh modes self-heal: if the
  // operator flipped warpMode but the geometry initializer was bypassed
  // (e.g. older slice deserialized without corners), we synthesize
  // identity-from-rect corners/mesh on the fly so the shader still
  // takes the right path and the operator's mode pick isn't silently
  // ignored. Without this, an out-of-sync slice falls back to plain
  // rect crop and the warp looks like it's "not working."
  const mode = slice.warpMode ?? 'rect';
  if (masterForward) {
    // Forward master warp: always feed the corner quad (identity if the
    // operator hasn't dragged it) and, additively, the mesh if present.
    const c = slice.corners ?? {
      topLeft:     { x: 0, y: 0 },
      topRight:    { x: 1, y: 0 },
      bottomLeft:  { x: 0, y: 1 },
      bottomRight: { x: 1, y: 1 },
    };
    u.uWarpMode.value = 3;
    u.uCornerTL.value.set(c.topLeft.x, c.topLeft.y);
    u.uCornerTR.value.set(c.topRight.x, c.topRight.y);
    u.uCornerBL.value.set(c.bottomLeft.x, c.bottomLeft.y);
    u.uCornerBR.value.set(c.bottomRight.x, c.bottomRight.y);
    if (slice.meshGrid && slice.meshGrid.rows >= 2 && slice.meshGrid.cols >= 2) {
      u.uMeshRows.value = slice.meshGrid.rows;
      u.uMeshCols.value = slice.meshGrid.cols;
      u.uMeshTex.value = meshTextureFor(slice);
    } else {
      // rows ≤ 1 makes the shader skip the mesh path → corners only.
      u.uMeshRows.value = 1;
      u.uMeshCols.value = 1;
      u.uMeshTex.value = ensureMeshPlaceholder();
    }
  } else if (mode === 'corners') {
    const c = slice.corners ?? {
      topLeft:     { x: slice.cropX,                y: slice.cropY },
      topRight:    { x: slice.cropX + slice.cropW,  y: slice.cropY },
      bottomLeft:  { x: slice.cropX,                y: slice.cropY + slice.cropH },
      bottomRight: { x: slice.cropX + slice.cropW,  y: slice.cropY + slice.cropH },
    };
    u.uWarpMode.value = 1;
    u.uCornerTL.value.set(c.topLeft.x, c.topLeft.y);
    u.uCornerTR.value.set(c.topRight.x, c.topRight.y);
    u.uCornerBL.value.set(c.bottomLeft.x, c.bottomLeft.y);
    u.uCornerBR.value.set(c.bottomRight.x, c.bottomRight.y);
  } else if (mode === 'mesh' && slice.meshGrid && slice.meshGrid.rows >= 2 && slice.meshGrid.cols >= 2) {
    u.uWarpMode.value = 2;
    u.uMeshRows.value = slice.meshGrid.rows;
    u.uMeshCols.value = slice.meshGrid.cols;
    u.uMeshTex.value = meshTextureFor(slice);
  } else {
    u.uWarpMode.value = 0;
    u.uMeshTex.value = ensureMeshPlaceholder();
  }

  const rotEnum = slice.rotation === 90 ? 1 : slice.rotation === 180 ? 2 : slice.rotation === 270 ? 3 : 0;
  u.uRotation.value = rotEnum;
  u.uBrightness.value = slice.brightness;
  u.uContrast.value = slice.contrast;
  u.uGamma.value = slice.gamma;
  u.uBlendW.value.set(slice.edgeBlendLeft, slice.edgeBlendRight, slice.edgeBlendTop, slice.edgeBlendBottom);
  const defG = slice.edgeBlendGamma;
  u.uBlendG.value.set(
    slice.edgeBlendLeftGamma ?? defG,
    slice.edgeBlendRightGamma ?? defG,
    slice.edgeBlendTopGamma ?? defG,
    slice.edgeBlendBottomGamma ?? defG,
  );
  u.uBlackLevel.value.set(slice.blackLevelR ?? 0, slice.blackLevelG ?? 0, slice.blackLevelB ?? 0);
  u.uBlackFeather.value = slice.blackLevelFeather ?? 0.5;
  u.uStageIntensity.value = Math.max(0, Math.min(1, stageIntensity));

  try {
    renderer!.setViewport(0, 0, sliceW, sliceH);
    renderer!.setScissor(0, 0, sliceW, sliceH);
    renderer!.setScissorTest(true);
    renderer!.render(scene!, camera!);
    const gl = renderer!.getContext();
    if (!readbackPixels || readbackW !== sliceW || readbackH !== sliceH) {
      readbackPixels = new Uint8Array(sliceW * sliceH * 4);
      readbackW = sliceW;
      readbackH = sliceH;
    }
    gl.readPixels(0, 0, sliceW, sliceH, gl.RGBA, gl.UNSIGNED_BYTE, readbackPixels);
    if (flip) flipRowsInPlace(readbackPixels, sliceW, sliceH);
    return readbackPixels;
  } catch (err) {
    console.warn('[blendRenderer] render/readback failed', err);
    return null;
  } finally {
    if (renderer) renderer.setScissorTest(false);
  }
}

// ─── Global master warp ─────────────────────────────────────────────────
// Reused full-frame slice carrying ONLY the master warp's geometry. We
// synthesize it once and mutate in place so the master warp shares the
// exact, battle-tested corner/mesh sampler the per-Screen warp uses —
// no second shader, no second code path to drift out of sync. The stable
// id keeps the mesh-texture cache warm across frames.
let masterSlice: OutputSlice | null = null;

/**
 * Render the FULL source through the warp shader using a single global
 * master warp: identity crop, no edge-blend / black-level / color
 * correction / rotation — just the corner or mesh geometry. Returns
 * top-down RGBA pixels (already row-flipped) ready for `putImageData`,
 * or null if WebGL is unavailable. Identity corners ⇒ the output equals
 * the input, so an "enabled but untouched" master warp is a visual no-op.
 */
export function renderMasterWarpPixels(
  source: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | ImageBitmap,
  warp: OutputWarp,
  w: number,
  h: number,
): Uint8Array | null {
  if (!masterSlice) masterSlice = createDefaultSlice('__master_warp__', 'Master', 'master');
  const m = masterSlice;
  m.cropX = 0; m.cropY = 0; m.cropW = 1; m.cropH = 1;
  // Forward warp: corners ALWAYS apply (identity until dragged) and the
  // mesh is ADDITIVE — both combine, matching map mode (no exclusive
  // corners-vs-mesh mode). A valid grid (≥2×2) means the mesh is in play.
  m.warpMode = 'corners';
  m.corners = warp.corners ?? identityOutputCorners();
  m.meshGrid = (warp.meshGrid && warp.meshGrid.rows >= 2 && warp.meshGrid.cols >= 2)
    ? warp.meshGrid : undefined;
  m.rotation = 0;
  m.brightness = 1; m.contrast = 1; m.gamma = 1;
  m.edgeBlendLeft = 0; m.edgeBlendRight = 0; m.edgeBlendTop = 0; m.edgeBlendBottom = 0;
  m.blackLevelR = 0; m.blackLevelG = 0; m.blackLevelB = 0;
  // flip=false: 2D-canvas putImageData captured upright; masterForward=true
  // routes through the uWarpMode=3 forward/destination branch.
  return renderSlicePixels(source, m, w, h, 1, false, true);
}

function flipRowsInPlace(buf: Uint8Array, w: number, h: number) {
  const rowBytes = w * 4;
  const tmp = new Uint8Array(rowBytes);
  for (let y = 0; y < (h >> 1); y++) {
    const top = y * rowBytes;
    const bot = (h - 1 - y) * rowBytes;
    tmp.set(buf.subarray(top, top + rowBytes));
    buf.copyWithin(top, bot, bot + rowBytes);
    buf.set(tmp, bot);
  }
}

export function disposeBlendRenderer() {
  if (sourceTexture) { sourceTexture.dispose(); sourceTexture = null; }
  if (quad) { (quad.geometry as THREE.BufferGeometry).dispose(); quad = null; }
  if (material) { material.dispose(); material = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null;
  camera = null;
  backingCanvas = null;
  readbackPixels = null;
  readbackW = 0;
  readbackH = 0;
  if (meshTexPlaceholder) { meshTexPlaceholder.dispose(); meshTexPlaceholder = null; }
  for (const c of meshTexCache.values()) c.tex.dispose();
  meshTexCache.clear();
}

export function isBlendRendererAvailable(): boolean {
  if (renderer) return true;
  return ensureRenderer(1920, 1080);
}
