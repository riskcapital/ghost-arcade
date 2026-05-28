/**
 * GPU-based slice renderer — replaces the 2D-canvas crop + gradient-strip
 * post-process with a single WebGL fragment-shader pass that does:
 *
 *   1.  Map projector-side UV (vUv) to a sample position on the master
 *       canvas, using one of three SOURCE warp modes:
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
 * OUTPUT WARP (projector-side distortion) is handled separately, by
 * displacing the render quad's GEOMETRY rather than inverse-mapping in
 * the fragment shader. The vertex positions move to the warp's control
 * points (projector unit-quad space) while the logical UV — and thus
 * everything the fragment shader does — is unchanged. This is the
 * industry-standard forward-mesh warp (MadMapper / Resolume) and avoids
 * the per-fragment inverse-bilinear search that made the old
 * `uOutWarpMode` path stall the GPU on enable. Two consumers share it:
 *   • per-screen output warp — `renderSlicePixels` picks the slice's
 *     output-warp geometry, so one bumped projector can be re-aligned.
 *   • master output warp — `renderMasterWarpedCanvas` runs ONE full-frame
 *     pass with the master warp geometry, producing a warped composite
 *     that every slice then crops from (whole-rig nudge).
 * An identity warp builds a geometry pixel-identical to the original
 * full-screen quad, so warps that are disabled cost nothing and render
 * exactly as before.
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
import type { WarpCorners } from '../types';

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
// Per-slice SOURCE mesh texture cache. Keyed by sliceId so we don't
// reallocate a DataTexture every frame for a screen whose mesh hasn't
// changed. Invalidated by a hash of the points array.
const meshTexCache = new Map<string, { tex: THREE.DataTexture; hash: string; cols: number; rows: number }>();

// Output-warp GEOMETRY cache. Output warp displaces vertices, so it's a
// BufferGeometry (not a texture). Keyed by a cache key (slice id +
// purpose) and invalidated by a content hash. The identity geometry is
// shared under a fixed key so every disabled-warp slice reuses one quad.
const geoCache = new Map<string, { geo: THREE.BufferGeometry; hash: string }>();
const IDENTITY_GEO_KEY = '__identity__';

let backingCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

let readbackPixels: Uint8Array | null = null;
let readbackW = 0;
let readbackH = 0;

// Master-warp presentation canvas + reused ImageData. Separate from the
// per-slice readback because it's a different (full-frame) size and is
// consumed as a 2D canvas the slice loop crops from.
let masterCanvas: HTMLCanvasElement | null = null;
let masterCtx: CanvasRenderingContext2D | null = null;
let masterImageData: ImageData | null = null;

// Largest mesh dimension we support (per-side). SOURCE mesh data is
// uploaded as a `MAX_MESH × MAX_MESH` float DataTexture, sampled with
// nearest filtering — only the actual (rows × cols) sub-region is
// meaningful; the rest is unused padding. 32 is generous: a 32×32
// control mesh is way more than typical projection-mapping rigs need
// (~5×5 is the MadMapper default).
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

  void main() {
    // vUv is the slice's LOGICAL projector UV. Output warp (when active)
    // displaces the vertex positions, not this UV, so everything below —
    // source sampling, rotation, edge-blend — runs in undistorted
    // projector space and simply lands on the warped geometry.
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

// Stable hash of a SOURCE mesh's contents for cache invalidation. JSON is
// fast enough for ≤32×32 grids (the upper bound).
function meshHash(slice: OutputSlice): string {
  const g = slice.meshGrid;
  if (!g) return 'none';
  return `${g.rows}x${g.cols}:${JSON.stringify(g.points)}`;
}

// Pack a SOURCE mesh (master-canvas coords) into a DataTexture.
function meshTextureFor(slice: OutputSlice): THREE.DataTexture {
  const mesh = slice.meshGrid;
  if (!mesh || mesh.rows < 2 || mesh.cols < 2) return ensureMeshPlaceholder();
  const hash = meshHash(slice);
  const cached = meshTexCache.get(slice.id);
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
    meshTexCache.set(slice.id, { tex: cached.tex, hash, cols: mesh.cols, rows: mesh.rows });
    return cached.tex;
  }
  const tex = new THREE.DataTexture(data, MAX_MESH, MAX_MESH, THREE.RGFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  meshTexCache.set(slice.id, { tex, hash, cols: mesh.cols, rows: mesh.rows });
  return tex;
}

// ─── Output-warp geometry (forward mesh warp) ───────────────────────────
//
// A warp's control points live in PROJECTOR unit-quad space, top-origin
// 0..1 (TL = 0,0 / BR = 1,1). We build a tessellated quad whose vertex
// positions are those control points mapped to clip space and whose UVs
// are the regular lattice. The fragment shader then samples + blends in
// undistorted logical UV space; the displacement is purely geometric.
//
// Identity (TL=0,0 TR=1,0 BL=0,1 BR=1,1, flat mesh) reproduces the
// original full-screen quad exactly, so a disabled warp is a no-op.

// Convert a projector-space point (top-origin 0..1) to clip-space NDC.
// x: 0→-1, 1→+1.  y: 0(top)→+1, 1(bottom)→-1.
function projToClipX(x: number): number { return 2 * x - 1; }
function projToClipY(y: number): number { return 1 - 2 * y; }

// Build a BufferGeometry from a rows×cols grid of projector-space points.
// Vertex (r,c): position = clip(points[r][c]); uv = (c/(cols-1),
// 1 - r/(rows-1)) so the top row carries uv.y=1 — matching the
// orientation of the original PlaneGeometry(2,2).
function buildGridGeometry(points: { x: number; y: number }[][], rows: number, cols: number): THREE.BufferGeometry {
  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = points[r]?.[c] ?? { x: c / (cols - 1), y: r / (rows - 1) };
      const vi = r * cols + c;
      positions[vi * 3]     = projToClipX(p.x);
      positions[vi * 3 + 1] = projToClipY(p.y);
      positions[vi * 3 + 2] = 0;
      uvs[vi * 2]     = c / (cols - 1);
      uvs[vi * 2 + 1] = 1 - r / (rows - 1);
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v00 = r * cols + c;
      const v10 = r * cols + (c + 1);
      const v01 = (r + 1) * cols + c;
      const v11 = (r + 1) * cols + (c + 1);
      indices.push(v00, v01, v10, v10, v01, v11);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// Identity geometry (single full-screen quad) — shared, built once.
function identityGeometry(): THREE.BufferGeometry {
  const cached = geoCache.get(IDENTITY_GEO_KEY);
  if (cached) return cached.geo;
  const geo = buildGridGeometry(
    [[{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 1 }, { x: 1, y: 1 }]],
    2, 2,
  );
  geoCache.set(IDENTITY_GEO_KEY, { geo, hash: 'identity' });
  return geo;
}

function warpIsIdentity(warp: OutputWarp | null | undefined): boolean {
  if (!warp || !warp.enabled) return true;
  if (warp.mode === 'corners') {
    const c = warp.corners;
    if (!c) return true;
    return (
      c.topLeft.x === 0 && c.topLeft.y === 0 &&
      c.topRight.x === 1 && c.topRight.y === 0 &&
      c.bottomLeft.x === 0 && c.bottomLeft.y === 1 &&
      c.bottomRight.x === 1 && c.bottomRight.y === 1
    );
  }
  // mesh
  const g = warp.meshGrid;
  if (!g || g.rows < 2 || g.cols < 2) return true;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const p = g.points[r]?.[c];
      if (!p) continue;
      if (Math.abs(p.x - c / (g.cols - 1)) > 1e-6 || Math.abs(p.y - r / (g.rows - 1)) > 1e-6) return false;
    }
  }
  return true;
}

function warpHash(warp: OutputWarp): string {
  if (warp.mode === 'corners') return `c:${JSON.stringify(warp.corners)}`;
  return `m:${warp.meshGrid?.rows}x${warp.meshGrid?.cols}:${JSON.stringify(warp.meshGrid?.points)}`;
}

function cornersToGrid(c: WarpCorners): { x: number; y: number }[][] {
  return [
    [{ x: c.topLeft.x, y: c.topLeft.y }, { x: c.topRight.x, y: c.topRight.y }],
    [{ x: c.bottomLeft.x, y: c.bottomLeft.y }, { x: c.bottomRight.x, y: c.bottomRight.y }],
  ];
}

// Resolve the geometry for an output warp, cached by key + content hash.
// Returns the shared identity geometry when the warp is off / identity.
function geometryForWarp(cacheKey: string, warp: OutputWarp | null | undefined): THREE.BufferGeometry {
  if (warpIsIdentity(warp)) return identityGeometry();
  const w = warp as OutputWarp;
  const hash = warpHash(w);
  const cached = geoCache.get(cacheKey);
  if (cached && cached.hash === hash) return cached.geo;
  if (cached) cached.geo.dispose();
  let geo: THREE.BufferGeometry;
  if (w.mode === 'corners' && w.corners) {
    geo = buildGridGeometry(cornersToGrid(w.corners), 2, 2);
  } else if (w.mode === 'mesh' && w.meshGrid && w.meshGrid.rows >= 2 && w.meshGrid.cols >= 2) {
    geo = buildGridGeometry(w.meshGrid.points as { x: number; y: number }[][], w.meshGrid.rows, w.meshGrid.cols);
  } else {
    return identityGeometry();
  }
  geoCache.set(cacheKey, { geo, hash });
  return geo;
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
    renderer.setClearColor(0x000000, 1);
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
      // Output-warp geometry winding can flip when corners are dragged
      // past each other; render both faces so a crossed warp never
      // culls to black.
      side: THREE.DoubleSide,
    });
    quad = new THREE.Mesh(identityGeometry(), material);
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

// Set the per-slice fragment uniforms (crop / source-warp / rotation /
// color / blend / black-level / stage intensity). Shared by the slice
// pass and indirectly by the neutral master-warp pass (which overrides
// to identity before calling render).
function applySliceUniforms(slice: OutputSlice, stageIntensity: number) {
  const u = material!.uniforms;
  u.uCrop.value.set(slice.cropX, slice.cropY, slice.cropW, slice.cropH);
  // Source-warp mode dispatch. Corners and mesh modes self-heal: if the
  // operator flipped warpMode but the geometry initializer was bypassed
  // (e.g. older slice deserialized without corners), we synthesize
  // identity-from-rect corners/mesh on the fly so the shader still
  // takes the right path and the operator's mode pick isn't silently
  // ignored.
  const mode = slice.warpMode ?? 'rect';
  if (mode === 'corners') {
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
}

// Render the current scene into the (0,0,w,h) viewport and read the
// pixels back, flipped upright. Returns the shared readback buffer.
function renderAndReadback(w: number, h: number): Uint8Array | null {
  try {
    renderer!.setViewport(0, 0, w, h);
    renderer!.setScissor(0, 0, w, h);
    renderer!.setScissorTest(true);
    // autoClear (default on) clears the scissored viewport to the
    // opaque-black clear color before drawing — so regions the warp
    // geometry doesn't cover read back as black, not stale pixels.
    renderer!.render(scene!, camera!);
    const gl = renderer!.getContext();
    if (!readbackPixels || readbackW !== w || readbackH !== h) {
      readbackPixels = new Uint8Array(w * h * 4);
      readbackW = w;
      readbackH = h;
    }
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, readbackPixels);
    flipRowsInPlace(readbackPixels, w, h);
    return readbackPixels;
  } catch (err) {
    console.warn('[blendRenderer] render/readback failed', err);
    return null;
  } finally {
    if (renderer) renderer.setScissorTest(false);
  }
}

/**
 * Render one slice into the backing WebGL canvas and read back the
 * pixels at the slice's output resolution. Returns Uint8Array of RGBA
 * bytes or null if WebGL is unavailable.
 *
 * `stageIntensity` (0..1) scales final output — used by the per-screen
 * stage effects (radial pulse, beat strobe, etc.). Defaults to 1.
 *
 * Per-screen OUTPUT warp (`slice.outputWarp`) is applied here by
 * selecting the slice's warp geometry; when off it uses the shared
 * identity quad and renders exactly as before.
 */
export function renderSlicePixels(
  source: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | ImageBitmap,
  slice: OutputSlice,
  sliceW: number,
  sliceH: number,
  stageIntensity = 1,
): Uint8Array | null {
  if (sliceW <= 0 || sliceH <= 0) return null;
  if (!ensureRenderer(sliceW, sliceH)) return null;
  setSourceFrame(source);
  applySliceUniforms(slice, stageIntensity);
  // Per-screen output warp → geometry. Cache key namespaced per slice.
  quad!.geometry = geometryForWarp(`slice:${slice.id}`, slice.outputWarp);
  return renderAndReadback(sliceW, sliceH);
}

/**
 * Apply the MASTER output warp to the full composite, returning a 2D
 * canvas with the warped frame (upright, RGBA). Every slice then crops
 * from this canvas, so a single warp re-aligns the entire rig at once —
 * the "projector got bumped, nudge everything" rescue.
 *
 * Returns null when WebGL is unavailable or the warp is identity/off
 * (caller should fall back to the unwarped source in that case).
 *
 * NOTE: this is a full-frame GPU pass + readback per frame. It only runs
 * when the master warp is enabled AND non-identity, so the common case
 * (no master warp) pays nothing.
 */
export function renderMasterWarpedCanvas(
  source: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | ImageBitmap,
  warp: OutputWarp | null | undefined,
  w: number,
  h: number,
): HTMLCanvasElement | null {
  if (w <= 0 || h <= 0) return null;
  if (warpIsIdentity(warp)) return null;
  if (!ensureRenderer(w, h)) return null;
  setSourceFrame(source);
  // Neutral fragment params: pure passthrough sampling (identity crop,
  // no color/blend/black-level). The warp is entirely geometric.
  const u = material!.uniforms;
  u.uCrop.value.set(0, 0, 1, 1);
  u.uWarpMode.value = 0;
  u.uMeshTex.value = ensureMeshPlaceholder();
  u.uRotation.value = 0;
  u.uBrightness.value = 1;
  u.uContrast.value = 1;
  u.uGamma.value = 1;
  u.uBlendW.value.set(0, 0, 0, 0);
  u.uBlackLevel.value.set(0, 0, 0);
  u.uStageIntensity.value = 1;
  quad!.geometry = geometryForWarp('master', warp);

  const px = renderAndReadback(w, h);
  if (!px) return null;

  // Blit the upright bytes into a reused 2D canvas the slice loop can
  // drawImage/crop from.
  if (!masterCanvas || masterCanvas.width !== w || masterCanvas.height !== h) {
    masterCanvas = document.createElement('canvas');
    masterCanvas.width = w;
    masterCanvas.height = h;
    masterCtx = masterCanvas.getContext('2d', { willReadFrequently: false });
    masterImageData = null;
  }
  if (!masterCtx) return null;
  if (!masterImageData) masterImageData = masterCtx.createImageData(w, h);
  masterImageData.data.set(px.subarray(0, w * h * 4));
  masterCtx.putImageData(masterImageData, 0, 0);
  return masterCanvas;
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
  if (material) { material.dispose(); material = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  quad = null;
  scene = null;
  camera = null;
  backingCanvas = null;
  readbackPixels = null;
  readbackW = 0;
  readbackH = 0;
  masterCanvas = null;
  masterCtx = null;
  masterImageData = null;
  if (meshTexPlaceholder) { meshTexPlaceholder.dispose(); meshTexPlaceholder = null; }
  for (const c of meshTexCache.values()) c.tex.dispose();
  meshTexCache.clear();
  for (const g of geoCache.values()) g.geo.dispose();
  geoCache.clear();
}

export function isBlendRendererAvailable(): boolean {
  if (renderer) return true;
  return ensureRenderer(1920, 1080);
}
