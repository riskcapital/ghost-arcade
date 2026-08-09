// Native 3D Model renderer. Three.js loaders parse the model ONCE on the
// CPU (GLB/GLTF/OBJ/FBX) into a flat triangle-list vertex buffer that
// uploads to a persistent GPU storage buffer; the first diffuse texture
// bakes to RGBA and uploads as a source frame. Every frame packs a small
// camera/material uniform and the GPU draws the mesh depth-tested with
// the release renderer's lighting model, materials, and deformations.
import type { Model3DContent } from '$lib/types';
import { getModel3DLightingProfile } from '$lib/model3d/Model3DRenderer';

export const MODEL3D_NATIVE_SHADER_ID = 'model3d/render-v1';
export const MODEL3D_MAX_VERTICES = 3_500_000; // unique vertices
export const MODEL3D_MAX_INDICES = 9_000_000; // 3M triangles
export const MODEL3D_VERTEX_VEC4S = 2;
export const MODEL3D_UNIFORM_VEC4S = 20;
export const MODEL3D_UNIFORM_BYTES = MODEL3D_UNIFORM_VEC4S * 16;

const MATERIALS = [
  'source', 'standard', 'wireframe', 'glass', 'chrome', 'hologram', 'lava', 'ice',
  'neon', 'xray', 'toon', 'matcap', 'fresnel', 'dissolve', 'glitch', 'normal', 'depth',
];
const DEFORMS = [
  'none', 'noise', 'wave', 'twist', 'bend', 'taper', 'spherify', 'inflate',
  'explode', 'implode', 'shatter', 'melt', 'pixelate', 'jelly', 'breathe',
  'pulse', 'bulge', 'tentacle', 'magnetic', 'swirl', 'fracture',
];

function finite(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function idx(list: string[], v: unknown): number {
  const i = list.indexOf(String(v ?? ''));
  return i >= 0 ? i : 0;
}
function col255(c: [number, number, number] | undefined, fb: [number, number, number]): [number, number, number] {
  const s = c ?? fb;
  return [clamp(finite(s[0], fb[0]) / 255, 0, 1), clamp(finite(s[1], fb[1]) / 255, 0, 1), clamp(finite(s[2], fb[2]) / 255, 0, 1)];
}

export interface Model3DNativeMesh {
  buffer: Float32Array; // 2 vec4s per vertex: [pos.xyz, uvHalf2][nrm.xyz, rgba8 color (alpha=255 → fs texture)]
  indices: Uint32Array; // triangle list into the vertex buffer
  indexCount: number;
  vertexCount: number;
  sourceVertexCount: number;
  faceCount: number;
  texture: { rgba: Uint8ClampedArray; width: number; height: number } | null;
}

function toHalf(value: number): number {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 112;
  const mant = (x >>> 13) & 0x3ff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7bff;
  return sign | (exp << 10) | mant;
}
function packHalf2(a: number, b: number): number {
  return (toHalf(a) | (toHalf(b) << 16)) >>> 0;
}

// Parse a model with the Three.js loaders and flatten every mesh into a
// world-space triangle list, normalized to a centered ~4-unit bounds.
export async function loadModel3DNativeMesh(
  url: string,
  format: string,
  onProgress?: (progress: number, detail: string) => void,
): Promise<Model3DNativeMesh> {
  const THREE = await import('three');
  onProgress?.(0.05, 'Reading model data');
  let root: import('three').Object3D;
  const fmt = String(format || '').toLowerCase();
  if (fmt === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    root = await new OBJLoader().loadAsync(url);
  } else if (fmt === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    root = await new FBXLoader().loadAsync(url);
  } else {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    root = gltf.scene;
  }
  onProgress?.(0.45, 'Flattening geometry');
  root.updateMatrixWorld(true);

  type MeshEntry = {
    geom: import('three').BufferGeometry;
    color: number; // packed rgba8
    hasTex: boolean;
    matrix: import('three').Matrix4;
  };
  // Read back each unique texture's pixels once so multi-material models
  // can bake texture color per vertex (dense meshes make this read as real
  // texturing; a single-texture model additionally samples sharply in the
  // fragment shader).
  type TexPixels = { data: Uint8ClampedArray; w: number; h: number };
  const texPixelCache = new Map<unknown, TexPixels | null>();
  const readTexPixels = (image: unknown): TexPixels | null => {
    if (texPixelCache.has(image)) return texPixelCache.get(image) ?? null;
    let out: TexPixels | null = null;
    try {
      const img = image as { width?: number; height?: number };
      const w = Math.min(512, Math.max(2, Number(img.width) || 128));
      const h = Math.min(512, Math.max(2, Number(img.height) || 128));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image as CanvasImageSource, 0, 0, w, h);
      out = { data: ctx.getImageData(0, 0, w, h).data, w, h };
    } catch { out = null; }
    texPixelCache.set(image, out);
    return out;
  };

  const entries: (MeshEntry & { texPixels: TexPixels | null })[] = [];
  const uniqueImages = new Set<unknown>();
  let texImage: CanvasImageSource | null = null;
  let triTotal = 0;
  root.traverse((obj) => {
    const mesh = obj as import('three').Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    const geom = mesh.geometry as import('three').BufferGeometry;
    const pos = geom.getAttribute('position');
    if (!pos) return;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as import('three').MeshStandardMaterial;
    const map = material?.map as import('three').Texture | undefined;
    if (map?.image) {
      uniqueImages.add(map.image);
      if (!texImage) texImage = map.image as CanvasImageSource;
    }
    const mc = material?.color;
    const r = clamp(Math.round((mc?.r ?? 1) * 255), 0, 255);
    const g = clamp(Math.round((mc?.g ?? 1) * 255), 0, 255);
    const b = clamp(Math.round((mc?.b ?? 1) * 255), 0, 255);
    const packed = r | (g << 8) | (b << 16) | (255 << 24);
    triTotal += (geom.index ? geom.index.count : pos.count) / 3;
    entries.push({
      geom,
      color: packed,
      hasTex: !!(map?.image),
      matrix: mesh.matrixWorld,
      texPixels: map?.image ? readTexPixels(map.image) : null,
    } as MeshEntry & { texPixels: TexPixels | null });
  });
  if (!entries.length) throw new Error('model contains no mesh geometry');
  // Sharp fragment-shader texturing only works when the whole model shares
  // one texture; otherwise per-vertex baking carries the texture color.
  const singleTexture = uniqueImages.size === 1;

  // Indexed extraction with attribute ACCESSORS (getX/getY/getZ) so
  // interleaved and normalized GLTF buffers read correctly — raw array
  // indexing garbles them into triangle noise.
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();

  let uniqueTotal = 0;
  let indexTotal = 0;
  const geoms: Array<{
    e: (typeof entries)[number];
    pos: import('three').BufferAttribute;
    nrm: import('three').BufferAttribute | null;
    uv: import('three').BufferAttribute | null;
    count: number;
    idxCount: number;
  }> = [];
  for (const e of entries) {
    const geom = e.geom;
    const pos = geom.getAttribute('position') as import('three').BufferAttribute;
    const idxAttr = geom.index;
    geoms.push({
      e,
      pos,
      nrm: (geom.getAttribute('normal') as import('three').BufferAttribute) ?? null,
      uv: (geom.getAttribute('uv') as import('three').BufferAttribute) ?? null,
      count: pos.count,
      idxCount: idxAttr ? idxAttr.count : pos.count,
    });
    uniqueTotal += pos.count;
    indexTotal += idxAttr ? idxAttr.count : pos.count;
  }
  if (uniqueTotal > MODEL3D_MAX_VERTICES) throw new Error(`model too dense: ${uniqueTotal.toLocaleString()} vertices`);
  const triStride = Math.max(1, Math.ceil(indexTotal / MODEL3D_MAX_INDICES));

  // Bounds in world space (accessor-correct).
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const g of geoms) {
    const step = Math.max(1, Math.floor(g.count / 20000));
    for (let i = 0; i < g.count; i += step) {
      v.set(g.pos.getX(i), g.pos.getY(i), g.pos.getZ(i)).applyMatrix4(g.e.matrix);
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  const norm = 4 / extent;

  const buffer = new Float32Array(uniqueTotal * MODEL3D_VERTEX_VEC4S * 4);
  const u32 = new Uint32Array(buffer.buffer);
  const indices = new Uint32Array(Math.ceil(indexTotal / triStride / 3) * 3 + 3);
  let vertWrite = 0;
  let idxWrite = 0;
  for (const g of geoms) {
    const e = g.e;
    nm.getNormalMatrix(e.matrix);
    const vertBase = vertWrite;
    for (let i = 0; i < g.count; i++) {
      v.set(g.pos.getX(i), g.pos.getY(i), g.pos.getZ(i)).applyMatrix4(e.matrix);
      if (g.nrm) n.set(g.nrm.getX(i), g.nrm.getY(i), g.nrm.getZ(i)).applyMatrix3(nm).normalize();
      else n.set(0, 1, 0);
      const uvx = g.uv ? g.uv.getX(i) : 0;
      const uvy = g.uv ? g.uv.getY(i) : 0;
      let color = e.color;
      if (e.texPixels && g.uv && !(singleTexture && e.hasTex)) {
        const tp = e.texPixels;
        const tx = Math.floor((((uvx % 1) + 1) % 1) * (tp.w - 1));
        const ty = Math.floor(((((1 - uvy) % 1) + 1) % 1) * (tp.h - 1));
        const ti = (ty * tp.w + tx) * 4;
        const cr = ((e.color & 0xff) * tp.data[ti]) / 255 | 0;
        const cg = (((e.color >> 8) & 0xff) * tp.data[ti + 1]) / 255 | 0;
        const cb = (((e.color >> 16) & 0xff) * tp.data[ti + 2]) / 255 | 0;
        color = cr | (cg << 8) | (cb << 16) | (255 << 24);
      }
      const base = vertWrite * MODEL3D_VERTEX_VEC4S * 4;
      buffer[base] = (v.x - cx) * norm;
      buffer[base + 1] = (v.y - cy) * norm;
      buffer[base + 2] = (v.z - cz) * norm;
      u32[base + 3] = packHalf2(uvx, uvy);
      buffer[base + 4] = n.x;
      buffer[base + 5] = n.y;
      buffer[base + 6] = n.z;
      // Alpha byte doubles as the fs-texture flag (255 = sample texture).
      u32[base + 7] = (color & 0x00ffffff) | ((singleTexture && e.hasTex ? 255 : 0) << 24);
      vertWrite += 1;
    }
    const idxAttr = e.geom.index;
    let tri = 0;
    for (let t = 0; t + 2 < g.idxCount; t += 3) {
      if (tri++ % triStride !== 0) continue;
      for (let k = 0; k < 3; k++) {
        indices[idxWrite++] = vertBase + (idxAttr ? idxAttr.getX(t + k) : t + k);
      }
    }
  }
  const write = vertWrite;
  onProgress?.(0.8, 'Baking texture');

  let texture: Model3DNativeMesh['texture'] = null;
  if (texImage && singleTexture && typeof document !== 'undefined') {
    try {
      const img = texImage as { width?: number; height?: number };
      const tw = Math.min(1024, Math.max(2, Number(img.width) || 256));
      const th = Math.min(1024, Math.max(2, Number(img.height) || 256));
      const canvas = document.createElement('canvas');
      canvas.width = tw; canvas.height = th;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(texImage as CanvasImageSource, 0, 0, tw, th);
      texture = { rgba: ctx.getImageData(0, 0, tw, th).data, width: tw, height: th };
    } catch { texture = null; }
  }

  return {
    buffer: buffer.subarray(0, write * MODEL3D_VERTEX_VEC4S * 4),
    indices: indices.subarray(0, idxWrite),
    indexCount: idxWrite,
    vertexCount: write,
    sourceVertexCount: uniqueTotal,
    faceCount: Math.round(triTotal),
    texture,
  };
}

// Column-major view-projection from Model3DCamera (WebGPU z in [0,1]).
export function model3dViewProjection(content: Model3DContent, aspect: number, time: number): number[] {
  const cam = content.camera ?? ({} as Model3DContent['camera']);
  const fov = (clamp(finite(cam.fov, 50), 10, 120) * Math.PI) / 180;
  const distance = Math.max(0.2, finite(cam.distance, 5));
  const orbitX = (finite(cam.orbitX, 0) * Math.PI) / 180;
  let orbitY = (finite(cam.orbitY, 0) * Math.PI) / 180;
  if (cam.autoRotate) orbitY += time * (finite(cam.rotateSpeed, 30) * Math.PI) / 180;
  const roll = (finite(cam.roll, 0) * Math.PI) / 180;
  const eyeX = Math.sin(orbitY) * Math.cos(orbitX) * distance;
  const eyeY = Math.sin(orbitX) * distance;
  const eyeZ = Math.cos(orbitY) * Math.cos(orbitX) * distance;
  let fx = -eyeX, fy = -eyeY, fz = -eyeZ;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let r0 = fy * 0 - fz * 1, r1 = fz * 0 - fx * 0, r2 = fx * 1 - fy * 0;
  const rl = Math.hypot(r0, r1, r2) || 1; r0 /= rl; r1 /= rl; r2 /= rl;
  let u0 = r1 * fz - r2 * fy, u1 = r2 * fx - r0 * fz, u2 = r0 * fy - r1 * fx;
  if (roll !== 0) {
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const nr0 = r0 * cr + u0 * sr, nr1 = r1 * cr + u1 * sr, nr2 = r2 * cr + u2 * sr;
    u0 = u0 * cr - r0 * sr; u1 = u1 * cr - r1 * sr; u2 = u2 * cr - r2 * sr;
    r0 = nr0; r1 = nr1; r2 = nr2;
  }
  const tx = -(r0 * eyeX + r1 * eyeY + r2 * eyeZ);
  const ty = -(u0 * eyeX + u1 * eyeY + u2 * eyeZ);
  const tz = fx * eyeX + fy * eyeY + fz * eyeZ;
  const view = [r0, u0, -fx, 0, r1, u1, -fy, 0, r2, u2, -fz, 0, tx, ty, tz, 1];
  const f = 1 / Math.tan(fov / 2);
  const near = 0.05, far = 200;
  const proj = [
    f / Math.max(0.001, aspect), 0, 0, 0,
    0, f, 0, 0,
    finite(cam.panX, 0) * 0.04, -finite(cam.panY, 0) * 0.04, far / (near - far), -1,
    0, 0, (far * near) / (near - far), 0,
  ];
  const vp = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += proj[k * 4 + r] * view[c * 4 + k];
    vp[c * 4 + r] = s;
  }
  return vp;
}

// Rigid model animations run on the CPU as transform adjustments.
function animatedTransform(content: Model3DContent, time: number) {
  const t = time * Math.max(0.05, finite(content.animationSpeed, 1));
  const amp = clamp(finite(content.animationIntensity, 1), 0, 3);
  // Swapped to match the gizmo's release-calibrated axes (see splatNative).
  let rx = (finite(content.rotationY, 0) * Math.PI) / 180;
  let ry = (finite(content.rotationX, 0) * Math.PI) / 180;
  let rz = (finite(content.rotationZ, 0) * Math.PI) / 180;
  let px = finite(content.positionX, 0);
  let py = finite(content.positionY, 0);
  let pz = finite(content.positionZ, 0);
  let scale = Math.max(0.01, finite(content.scaleUniform, 1));
  let opacityMul = 1;
  switch (content.animationType) {
    case 'rotate': ry += t; break;
    case 'orbit': px += Math.cos(t) * amp; pz += Math.sin(t) * amp; ry += t; break;
    case 'bounce': py += Math.abs(Math.sin(t * 2)) * amp; break;
    case 'swing': rz += Math.sin(t * 1.5) * 0.5 * amp; break;
    case 'float': py += Math.sin(t) * 0.3 * amp; ry += Math.sin(t * 0.5) * 0.2; break;
    case 'shake': px += Math.sin(t * 23) * 0.05 * amp; py += Math.cos(t * 31) * 0.05 * amp; break;
    case 'spiral': px += Math.cos(t) * amp * 0.8; pz += Math.sin(t) * amp * 0.8; py += Math.sin(t * 0.7) * 0.5 * amp; ry += t; break;
    case 'fadeIn': opacityMul = clamp((t % 4) / 1.5, 0, 1); break;
    case 'scaleIn': scale *= clamp((t % 4) / 1.2, 0.001, 1); break;
    case 'colorCycle': break; // handled in shader via time
    default: break;
  }
  return { rx, ry, rz, px, py, pz, scale, opacityMul };
}

export interface Model3DNativeGraphOptions {
  sourceId: string;
  content: Model3DContent;
  vertexCount: number;
  indexCount: number;
  meshBufferId: string;
  meshB64?: string | null;
  meshByteLength: number;
  indexBufferId: string;
  indexB64?: string | null;
  indexByteLength: number;
  textureSourceId: string;
  hasTexture: boolean;
  width: number;
  height: number;
  time: number;
  frameDelta: number;
  frameIndex: number;
  audioLevel?: number;
  includeSnapshot?: boolean;
}

export function buildModel3DNativeComputeGraph(options: Model3DNativeGraphOptions) {
  const width = Math.max(2, Math.round(options.width || 1920));
  const height = Math.max(2, Math.round(options.height || 1080));
  const time = Math.max(0, finite(options.time, 0));
  const c = options.content;
  const data = new Float32Array(MODEL3D_UNIFORM_VEC4S * 4);
  data.set(model3dViewProjection(c, width / height, time), 0);

  const xf = animatedTransform(c, time);
  const matColor = col255(c.materialColor, [255, 255, 255]);
  const emissive = col255(c.materialEmissive, [0, 0, 0]);
  const panelLight = col255(c.lightColor, [255, 255, 255]);
  // Preset light colors animate on the clock, exactly like the release's
  // getLightColorForPreset: disco cycles the hue wheel, neon breathes
  // pink<->cyan. The panel color tints the result.
  let presetRGB: [number, number, number] = [1, 1, 1];
  const preset = String(c.lightingPreset ?? 'studio');
  if (preset === 'dramatic') presetRGB = [1, 0.95, 0.85];
  else if (preset === 'sunrise') presetRGB = [1, 0.7, 0.4];
  else if (preset === 'moonlight') presetRGB = [0.55, 0.65, 1];
  else if (preset === 'neon') {
    const nt = Math.sin(time * 0.7) * 0.5 + 0.5;
    presetRGB = [1 - nt * 0.4, nt * 0.6 + 0.2, 1];
  } else if (preset === 'disco') {
    const hue = (time * 0.6) % 1;
    const q = (h: number) => {
      const k = (h * 6) % 6;
      return clamp(Math.min(k, 4 - k, 1), 0, 1) * 0.8 + 0.2;
    };
    presetRGB = [q(hue), q(hue - 1 / 3), q(hue - 2 / 3)];
  }
  const lightColor: [number, number, number] = [
    panelLight[0] * presetRGB[0], panelLight[1] * presetRGB[1], panelLight[2] * presetRGB[2],
  ];
  let rimColor = col255(c.rimColor, [128, 180, 255]);
  if (preset === 'neon' || preset === 'disco') {
    // The wild edge glow: the rim rides the animated preset color, offset
    // in phase so it plays against the key instead of matching it.
    const rt = Math.sin(time * 0.7 + 2.1) * 0.5 + 0.5;
    const rimAnim: [number, number, number] = preset === 'neon'
      ? [1 - rt * 0.2, rt * 0.7 + 0.1, 1]
      : [presetRGB[1], presetRGB[2], presetRGB[0]];
    rimColor = [
      clamp(rimColor[0] * 0.4 + rimAnim[0] * 0.8, 0, 1.5),
      clamp(rimColor[1] * 0.4 + rimAnim[1] * 0.8, 0, 1.5),
      clamp(rimColor[2] * 0.4 + rimAnim[2] * 0.8, 0, 1.5),
    ];
  }
  let profile = { ambientScale: 1, keyScale: 1, fillScale: 1, rimScale: 1, azimuthOffset: 0, elevationOffset: 0 };
  try { profile = { ...profile, ...getModel3DLightingProfile(c.lightingPreset) }; } catch { /* unknown preset */ }
  const az = ((finite(c.keyLightAzimuth, 135) + profile.azimuthOffset) * Math.PI) / 180;
  const el = ((finite(c.keyLightElevation, 45) + profile.elevationOffset) * Math.PI) / 180;

  data[16] = width; data[17] = height; data[18] = time; data[19] = options.vertexCount;
  data[20] = xf.scale; data[21] = xf.rx; data[22] = xf.ry; data[23] = xf.rz;
  data[24] = xf.px; data[25] = xf.py; data[26] = xf.pz;
  data[27] = idx(MATERIALS, c.materialType);
  data[28] = matColor[0]; data[29] = matColor[1]; data[30] = matColor[2];
  data[31] = clamp(finite(c.materialOpacity, 1), 0, 1) * xf.opacityMul;
  data[32] = emissive[0]; data[33] = emissive[1]; data[34] = emissive[2];
  data[35] = clamp(finite(c.materialEmissiveIntensity, 0), 0, 5);
  data[36] = Math.cos(el) * Math.cos(az); data[37] = Math.sin(el); data[38] = Math.cos(el) * Math.sin(az);
  data[39] = clamp(finite(c.directionalIntensity, 1) * profile.keyScale, 0, 5);
  data[40] = lightColor[0]; data[41] = lightColor[1]; data[42] = lightColor[2];
  data[43] = clamp(finite(c.ambientIntensity, 0.4) * profile.ambientScale, 0, 3);
  data[44] = rimColor[0]; data[45] = rimColor[1]; data[46] = rimColor[2];
  data[47] = clamp(finite(c.rimIntensity, 0) * profile.rimScale, 0, 5);
  data[48] = idx(DEFORMS, c.deformationType);
  data[49] = clamp(finite(c.deformationIntensity, 0.5), 0, 3) * clamp(finite(c.deformationSpread, 1), 0.2, 6);
  data[50] = Math.max(0.05, finite(c.deformationSpeed, 1));
  data[51] = Math.max(0.1, finite(c.deformationScale, 1));
  data[52] = options.hasTexture && c.materialType === 'source' ? 1 : 0;
  data[53] = clamp(finite(c.toonLevels, 4), 2, 12);
  data[54] = clamp(finite(c.dissolveAmount, 0), 0, 1);
  data[55] = clamp(finite(c.fresnelPower, 2), 0.3, 8);
  data[56] = Math.max(0.05, finite(c.hologramScanSpeed, 2));
  data[57] = clamp(finite(c.hologramScanCount, 30), 4, 120);
  data[58] = clamp(finite(options.audioLevel, 0), 0, 1.5) * (c.audio?.enabled ? 1 : 0);
  data[59] = c.animationType === 'colorCycle' ? 1 : 0;
  data[60] = clamp(finite(c.fillIntensity, 0.4) * profile.fillScale, 0, 3);
  data[61] = clamp(finite(c.toneMappingExposure, 1), 0.1, 3);
  data[62] = preset === 'disco' ? 1 : 0;

  const echo = c.echo ?? ({ enabled: false } as Model3DContent['echo']);
  const echoOn = !!echo.enabled && echo.type !== 'none';
  const echoCount = echoOn ? clamp(Math.round(finite(echo.count, 6)), 1, 60) : 0;
  const ECHO_TYPES = ['none', 'ghostTrail', 'motionBlur', 'afterimage', 'strobeCopies', 'stream', 'swarm', 'grid', 'radial', 'spiral', 'random', 'fountain', 'tornado', 'explosion', 'orbit', 'matrix', 'dna', 'kaleidoscope'];
  data[64] = echoOn ? idx(ECHO_TYPES, echo.type) : 0;
  data[65] = echoCount;
  data[66] = Math.max(0.05, finite(echo.spacing, 0.5));
  data[67] = clamp(finite(echo.fadeRate, 0.15), 0, 0.95);
  data[68] = clamp(finite(echo.scaleVariation, 0), 0, 1);
  data[69] = clamp(finite(echo.rotationVariation, 0), 0, 2);
  data[70] = clamp(finite(echo.colorVariation, 0), 0, 1);
  data[71] = time * Math.max(0.05, finite(echo.speed, 1)) + finite(echo.phaseOffset, 0);

  const bg = c.backgroundMode === 'color' ? col255(c.backgroundColor, [0, 0, 0]) : [0, 0, 0];
  const bgA = c.backgroundMode === 'color' ? clamp(finite(c.backgroundOpacity, 1), 0, 1) : 0;

  const sourceId = String(options.sourceId || 'model3d-native-source');
  const safe = sourceId.replace(/[^a-zA-Z0-9:_-]+/g, '_');
  const uniformId = `model3d:${safe}:uniform`;
  const meshBuffer: Record<string, unknown> = {
    id: options.meshBufferId,
    kind: 'storage-read',
    byte_length: Math.max(48, options.meshByteLength),
    persistent: true,
  };
  if (options.meshB64) {
    meshBuffer.initial_b64 = options.meshB64;
    meshBuffer.clear = true;
  }
  const indexBuffer: Record<string, unknown> = {
    id: options.indexBufferId,
    kind: 'storage-read',
    byte_length: Math.max(12, options.indexByteLength),
    persistent: true,
  };
  if (options.indexB64) {
    indexBuffer.initial_b64 = options.indexB64;
    indexBuffer.clear = true;
  }
  return {
    state: null as null,
    config: {
      buffers: [
        { id: uniformId, kind: 'uniform', byte_length: MODEL3D_UNIFORM_BYTES, initial_f32: Array.from(data) },
        meshBuffer,
        indexBuffer,
      ],
      passes: [],
      readbacks: [],
      render_passes: [{
        name: 'model3d-render',
        shader_id: MODEL3D_NATIVE_SHADER_ID,
        vertex_entry: 'vs_mesh',
        fragment_entry: 'fs_mesh',
        target: 'source_frame',
        source_id: sourceId,
        seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
        clear: true,
        clear_color: [bg[0] * bgA, bg[1] * bgA, bg[2] * bgA, bgA],
        include_snapshot: !!options.includeSnapshot,
        blend: 'alpha',
        primitive: 'triangle-list',
        vertex_count: Math.max(3, options.indexCount),
        instance_count: 1 + (echoOn ? echoCount : 0),
        depth: true,
        depth_write: true,
        depth_compare: 'less',
        bindings: [
          { binding: 0, resource: uniformId, kind: 'uniform' },
          { binding: 1, resource: options.meshBufferId, kind: 'read-only-storage' },
          { binding: 2, kind: 'source-frame-texture', source_id: options.textureSourceId, allow_missing: true },
          { binding: 3, kind: 'source-frame-sampler' },
          { binding: 4, resource: options.indexBufferId, kind: 'read-only-storage' },
        ],
      }],
    },
    sourceId,
    passCount: 1,
  };
}

export function buildModel3DNativePrecompileCommands() {
  return [{
    type: 'precompile_shader' as const,
    shader_id: MODEL3D_NATIVE_SHADER_ID,
    stage: 'render' as const,
    entry: 'fs_mesh',
    source: MODEL3D_NATIVE_WGSL,
  }];
}

export const MODEL3D_NATIVE_WGSL = /* wgsl */`
struct ModelParams {
  vp0: vec4<f32>, vp1: vec4<f32>, vp2: vec4<f32>, vp3: vec4<f32>,
  screen: vec4<f32>,   // width, height, time, vertexCount
  xform0: vec4<f32>,   // scale, rotX, rotY, rotZ
  xform1: vec4<f32>,   // posXYZ, materialType
  mat0: vec4<f32>,     // matColor.rgb, opacity
  mat1: vec4<f32>,     // emissive.rgb, emissiveIntensity
  light0: vec4<f32>,   // keyDir.xyz, directionalIntensity
  light1: vec4<f32>,   // lightColor.rgb, ambient
  light2: vec4<f32>,   // rimColor.rgb, rimIntensity
  deform: vec4<f32>,   // type, intensity, speed, scale
  fx0: vec4<f32>,      // hasTexture, toonLevels, dissolve, fresnelPower
  fx1: vec4<f32>,      // holoSpeed, holoCount, audioLevel, colorCycle
  fx2: vec4<f32>,      // fillIntensity, exposure, discoSweep, 0
  pad0: vec4<f32>, pad1: vec4<f32>, pad2: vec4<f32>,
}
@group(0) @binding(0) var<uniform> mp: ModelParams;
@group(0) @binding(1) var<storage, read> verts: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(0) @binding(2) var diffuse_tex: texture_2d<f32>;
@group(0) @binding(3) var diffuse_smp: sampler;

fn m_hash3(p: vec3<f32>) -> f32 { return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453); }
fn m_noise3(p: vec3<f32>) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(m_hash3(i), m_hash3(i + vec3<f32>(1.0, 0.0, 0.0)), u.x);
  let b = mix(m_hash3(i + vec3<f32>(0.0, 1.0, 0.0)), m_hash3(i + vec3<f32>(1.0, 1.0, 0.0)), u.x);
  let c = mix(m_hash3(i + vec3<f32>(0.0, 0.0, 1.0)), m_hash3(i + vec3<f32>(1.0, 0.0, 1.0)), u.x);
  let d = mix(m_hash3(i + vec3<f32>(0.0, 1.0, 1.0)), m_hash3(i + vec3<f32>(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z) * 2.0 - 1.0;
}
fn m_hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(vec3<f32>(1.0), clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) world: vec3<f32>,
  @location(3) color: vec4<f32>,
  @location(4) misc: vec4<f32>, // hasVertexTex, viewZ, triId, 0
}

@vertex fn vs_mesh(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  var out: VsOut;
  let base = indices[vi] * 2u;
  let p0 = verts[base];
  let p1 = verts[base + 1u];
  let t = mp.screen.z;
  var pos = p0.xyz;
  var nrm = p1.xyz;
  let tri = f32(vi / 3u);

  // Deformation (object space, before transform)
  let dt = i32(mp.deform.x + 0.5);
  let di = mp.deform.y;
  let dsp = t * mp.deform.z;
  let dsc = mp.deform.w;
  if (dt == 1) {
    pos = pos + nrm * m_noise3(pos * dsc * 2.0 + dsp) * di * 0.3;
  } else if (dt == 2) {
    pos.y = pos.y + sin(pos.x * dsc * 2.0 + dsp * 2.0) * di * 0.3;
  } else if (dt == 3) {
    let a = pos.y * di * dsc * 0.8 + dsp * 0.3;
    let ca = cos(a); let sa = sin(a);
    pos = vec3<f32>(pos.x * ca - pos.z * sa, pos.y, pos.x * sa + pos.z * ca);
  } else if (dt == 4) {
    let a = pos.y * di * 0.4;
    pos.x = pos.x + sin(a) * 1.5;
  } else if (dt == 5) {
    let s = mix(1.0, 0.2, clamp((pos.y + 2.0) / 4.0, 0.0, 1.0) * di);
    pos = vec3<f32>(pos.x * s, pos.y, pos.z * s);
  } else if (dt == 6) {
    let r = normalize(pos + vec3<f32>(1e-5)) * 1.6;
    pos = mix(pos, r, di * (0.5 + 0.5 * sin(dsp)));
  } else if (dt == 7) {
    pos = pos + nrm * di * 0.3 * (0.5 + 0.5 * sin(dsp));
  } else if (dt == 8 || dt == 10 || dt == 20) {
    let dir = normalize(pos + vec3<f32>(1e-5));
    let h = m_hash3(vec3<f32>(tri * 0.13, tri * 0.71, tri * 0.37));
    pos = pos + dir * di * (0.4 + h * 0.8);
  } else if (dt == 9) {
    pos = mix(pos, vec3<f32>(0.0), di * 0.7);
  } else if (dt == 11) {
    let melt = clamp((2.0 - pos.y) / 4.0, 0.0, 1.0) * di;
    pos.y = pos.y - melt * (0.5 + 0.5 * sin(dsp * 0.5));
    pos.x = pos.x * (1.0 + melt * 0.3);
    pos.z = pos.z * (1.0 + melt * 0.3);
  } else if (dt == 12) {
    let g = max(0.15, 0.8 / dsc);
    pos = floor(pos / g + 0.5) * g;
  } else if (dt == 13) {
    pos = pos + vec3<f32>(sin(dsp * 3.0 + pos.y * 2.0), 0.0, cos(dsp * 2.5 + pos.x * 2.0)) * di * 0.15;
  } else if (dt == 14) {
    pos = pos * (1.0 + sin(dsp * 2.0) * di * 0.2);
  } else if (dt == 15 || dt == 16) {
    let d = length(pos);
    pos = pos + normalize(pos + vec3<f32>(1e-5)) * sin(d * dsc * 3.0 - dsp * 3.0) * di * 0.2;
  } else if (dt == 17) {
    pos.x = pos.x + sin(pos.y * dsc * 2.0 + dsp * 2.0) * di * 0.3 * clamp(pos.y + 1.0, 0.0, 2.0);
  } else if (dt == 18) {
    pos.y = pos.y + sign(pos.y) * di * 0.3 * (0.5 + 0.5 * sin(dsp));
  } else if (dt == 19) {
    let a = length(pos.xz) * di * dsc + dsp;
    let ca = cos(a); let sa = sin(a);
    pos = vec3<f32>(pos.x * ca - pos.z * sa, pos.y, pos.x * sa + pos.z * ca);
  }

  // Model transform: scale, euler ZYX, translate
  pos = pos * mp.xform0.x;
  let cx = cos(mp.xform0.y); let sx = sin(mp.xform0.y);
  let cy = cos(mp.xform0.z); let sy = sin(mp.xform0.z);
  let cz = cos(mp.xform0.w); let sz = sin(mp.xform0.w);
  var q = vec3<f32>(pos.x, pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);
  q = vec3<f32>(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  q = vec3<f32>(q.x * cz - q.y * sz, q.x * sz + q.y * cz, q.z);
  q = q + vec3<f32>(mp.xform1.x, mp.xform1.y, mp.xform1.z);
  var nq = vec3<f32>(nrm.x, nrm.y * cx - nrm.z * sx, nrm.y * sx + nrm.z * cx);
  nq = vec3<f32>(nq.x * cy + nq.z * sy, nq.y, -nq.x * sy + nq.z * cy);
  nq = vec3<f32>(nq.x * cz - nq.y * sz, nq.x * sz + nq.y * cz, nq.z);

  // Echo copies: world-space arrangement per type with fade/scale/hue drift.
  var echo_alpha = 1.0;
  var echo_hue = 0.0;
  if (ii > 0u) {
    let k = f32(ii);
    let et = mp.pad1.w;
    let etype = i32(mp.pad0.x + 0.5);
    let spacing = mp.pad0.z;
    let h1 = fract(sin(k * 12.9898) * 43758.5453);
    let h2 = fract(sin(k * 78.233) * 43758.5453);
    let h3 = fract(sin(k * 45.164) * 43758.5453);
    var off = vec3<f32>(0.0);
    if (etype <= 5) { // trails / blur / afterimage / strobe / stream
      let dir = normalize(vec3<f32>(sin(et * 0.9), 0.25 * sin(et * 0.6), cos(et * 0.9)));
      off = -dir * spacing * k;
      q = q * (1.0 - mp.pad1.x * 0.04 * k);
    } else if (etype == 7) { // grid
      let side = max(1.0, round(pow(mp.pad0.y + 1.0, 1.0 / 3.0)));
      let gx = (k % side) - (side - 1.0) * 0.5;
      let gy = (floor(k / side) % side) - (side - 1.0) * 0.5;
      let gz = floor(k / (side * side)) - (side - 1.0) * 0.5;
      off = vec3<f32>(gx, gy, gz) * spacing * 2.0;
    } else if (etype == 8 || etype == 14) { // radial / orbit
      let a = k / max(1.0, mp.pad0.y) * 6.28318 + select(0.0, et, etype == 14);
      off = vec3<f32>(cos(a), 0.0, sin(a)) * spacing * 3.0;
    } else if (etype == 9 || etype == 12 || etype == 16) { // spiral / tornado / dna
      let a = k * 0.7 + et * select(0.4, 1.4, etype == 12);
      let r = spacing * (1.0 + k * select(0.12, 0.28, etype == 12));
      var yy = (k / max(1.0, mp.pad0.y) - 0.5) * spacing * 6.0;
      if (etype == 16) { yy = (k / max(1.0, mp.pad0.y) - 0.5) * spacing * 5.0; }
      let flip = select(1.0, -1.0, etype == 16 && (ii % 2u) == 1u);
      off = vec3<f32>(cos(a) * r * flip, yy, sin(a) * r * flip);
    } else if (etype == 13) { // explosion
      let dir = normalize(vec3<f32>(h1 - 0.5, h2 - 0.5, h3 - 0.5) + vec3<f32>(1e-4));
      off = dir * spacing * 3.0 * fract(et * 0.25);
      echo_alpha = 1.0 - fract(et * 0.25);
    } else if (etype == 11) { // fountain
      let ph = fract(et * 0.3 + h1);
      off = vec3<f32>((h2 - 0.5) * spacing * 2.0, ph * spacing * 4.0 - ph * ph * spacing * 6.0, (h3 - 0.5) * spacing * 2.0);
      echo_alpha = 1.0 - ph * 0.6;
    } else if (etype == 15) { // matrix
      off = vec3<f32>((h1 - 0.5) * spacing * 8.0, 3.0 - fract(et * 0.4 + h2) * 8.0 * spacing * 0.5, (h3 - 0.5) * spacing * 4.0);
    } else if (etype == 17) { // kaleidoscope
      let a = k / max(1.0, mp.pad0.y) * 6.28318;
      let ca2 = cos(a); let sa2 = sin(a);
      q = vec3<f32>(q.x * ca2 - q.z * sa2, q.y, q.x * sa2 + q.z * ca2);
    } else { // swarm / random
      off = vec3<f32>(sin(et * (0.5 + h1) + h2 * 6.28), sin(et * (0.4 + h2) + h3 * 6.28) * 0.6, cos(et * (0.6 + h3) + h1 * 6.28)) * spacing * 2.5 * (0.4 + h1);
    }
    // Rotation variation about Y
    let rv = mp.pad1.y * (h2 - 0.5) * 2.0 + select(0.0, k * 0.15, mp.pad1.y > 0.001);
    if (abs(rv) > 0.001) {
      let cr2 = cos(rv); let sr2 = sin(rv);
      q = vec3<f32>(q.x * cr2 - q.z * sr2, q.y, q.x * sr2 + q.z * cr2);
    }
    q = q * (1.0 - mp.pad1.x * h3 * 0.5) + off;
    echo_alpha = echo_alpha * pow(1.0 - mp.pad0.w, k);
    echo_hue = mp.pad1.z * k * 0.08;
  }

  let clip = mp.vp0 * q.x + mp.vp1 * q.y + mp.vp2 * q.z + mp.vp3;
  out.position = clip;
  out.normal = nq;
  out.uv = unpack2x16float(bitcast<u32>(p0.w));
  out.world = q;
  let packed = bitcast<u32>(p1.w);
  out.color = vec4<f32>(
    f32(packed & 0xffu) / 255.0,
    f32((packed >> 8u) & 0xffu) / 255.0,
    f32((packed >> 16u) & 0xffu) / 255.0,
    echo_alpha);
  out.misc = vec4<f32>(select(0.0, 1.0, ((packed >> 24u) & 0xffu) > 127u), clip.w, tri, echo_hue);
  return out;
}

@fragment fn fs_mesh(in: VsOut) -> @location(0) vec4<f32> {
  let t = mp.screen.z;
  let mat = i32(mp.xform1.w + 0.5);
  var n = normalize(in.normal);
  let view_dir = vec3<f32>(0.0, 0.0, 1.0);
  let fres = pow(1.0 - clamp(abs(n.z), 0.0, 1.0), mp.fx0.w);

  var albedo = mp.mat0.rgb;
  if (mat == 0) {
    albedo = in.color.rgb;
    if (mp.fx0.x > 0.5 && in.misc.x > 0.5) {
      let uv = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
      albedo = albedo * textureSampleLevel(diffuse_tex, diffuse_smp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
    }
  }
  if (mp.fx1.w > 0.5) {
    let shift = fract(t * 0.15);
    let base = albedo;
    albedo = m_hsv2rgb(vec3<f32>(shift + (base.r + base.g + base.b) * 0.2, 0.8, max(max(base.r, base.g), base.b)));
  }

  // Lighting: key + fill + ambient
  let key = clamp(dot(n, normalize(mp.light0.xyz)), 0.0, 1.0) * mp.light0.w;
  let fill = clamp(dot(n, normalize(vec3<f32>(-mp.light0.x, 0.3, -mp.light0.z))), 0.0, 1.0) * mp.fx2.x;
  var lit = albedo * mp.light1.rgb * (key + fill) + albedo * mp.light1.w;
  var alpha = mp.mat0.w;

  if (mat == 10) { // toon
    let levels = mp.fx0.y;
    let q = floor(clamp(key + fill, 0.0, 1.0) * levels + 0.5) / levels;
    lit = albedo * mp.light1.rgb * q + albedo * mp.light1.w * 0.6;
  } else if (mat == 5) { // hologram
    let scan = 0.6 + 0.4 * sin(in.world.y * mp.fx1.y + t * mp.fx1.x * 3.0);
    lit = mix(vec3<f32>(0.1, 0.6, 1.0), albedo, 0.3) * scan + mp.light2.rgb * fres * 1.5;
    alpha = alpha * (0.35 + fres * 0.5) * scan;
  } else if (mat == 9) { // xray
    lit = albedo * 0.2 + vec3<f32>(0.4, 0.7, 1.0) * fres * 1.6;
    alpha = alpha * (0.08 + fres * 0.7);
  } else if (mat == 8) { // neon
    lit = albedo * (1.5 + sin(t * 3.0) * 0.3) + mp.mat1.rgb * mp.mat1.w;
  } else if (mat == 4) { // chrome — fake env gradient
    let env = mix(vec3<f32>(0.15, 0.16, 0.2), vec3<f32>(0.9, 0.95, 1.0), clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
    lit = env * (0.4 + key * 0.8) + vec3<f32>(1.0) * pow(key, 24.0);
  } else if (mat == 3) { // glass
    lit = albedo * 0.15 + vec3<f32>(0.8, 0.9, 1.0) * fres * 1.2 + vec3<f32>(1.0) * pow(key, 32.0);
    alpha = alpha * (0.18 + fres * 0.6);
  } else if (mat == 6) { // lava
    let flow = m_noise3(in.world * 2.5 + vec3<f32>(0.0, -t * mp.deform.z * 0.5, 0.0));
    let heat = clamp(flow * 0.5 + 0.5, 0.0, 1.0);
    lit = mix(vec3<f32>(0.15, 0.02, 0.0), vec3<f32>(1.0, 0.5, 0.05), pow(heat, 1.6)) + vec3<f32>(1.0, 0.8, 0.2) * pow(heat, 5.0);
  } else if (mat == 7) { // ice
    lit = mix(lit, vec3<f32>(0.75, 0.9, 1.0), 0.6) + vec3<f32>(1.0) * fres * 0.8;
    alpha = alpha * (0.5 + fres * 0.4);
  } else if (mat == 12) { // fresnel
    lit = lit * 0.3 + mp.light2.rgb * fres * 2.0;
  } else if (mat == 13) { // dissolve
    let h = m_hash3(floor(in.world * 14.0));
    if (h < mp.fx0.z) { discard; }
    if (h < mp.fx0.z + 0.06) { lit = mp.light2.rgb * 2.0; }
  } else if (mat == 14) { // glitch
    let band = step(0.92, m_hash3(vec3<f32>(floor(in.world.y * 20.0), floor(t * 12.0), 1.0)));
    lit = mix(lit, vec3<f32>(lit.b, lit.r, lit.g), band);
  } else if (mat == 15) { // normal viz
    lit = n * 0.5 + vec3<f32>(0.5);
  } else if (mat == 16) { // depth viz
    let d = clamp(in.misc.y / 12.0, 0.0, 1.0);
    lit = vec3<f32>(1.0 - d);
  }

  // Disco: orbiting colored point lights approximated as a hue sweep
  // around the model, matching the release's 6 rotating PointLights.
  if (mp.fx2.z > 0.5) {
    let ang = atan2(in.world.z, in.world.x);
    let sweep = m_hsv2rgb(vec3<f32>(fract(t * 0.08 + ang * 0.318), 1.0, 1.0));
    let facing = 0.5 + 0.5 * dot(n, normalize(vec3<f32>(cos(ang), 0.4, sin(ang))));
    lit = lit + albedo * sweep * facing * 0.9;
  }

  // Echo copy hue drift + fade
  if (in.misc.w > 0.001) {
    lit = m_hsv2rgb(vec3<f32>(fract(in.misc.w + (lit.r + lit.g + lit.b) * 0.25), 0.7, max(max(lit.r, lit.g), max(lit.b, 0.2))));
  }
  alpha = alpha * in.color.a;

  // Rim + emissive + audio pump + exposure
  lit = lit + mp.light2.rgb * fres * mp.light2.w;
  lit = lit + mp.mat1.rgb * mp.mat1.w * 0.5;
  lit = lit * (1.0 + mp.fx1.z * 0.4);
  lit = vec3<f32>(1.0) - exp(-lit * mp.fx2.y);

  if (alpha < 0.004) { discard; }
  return vec4<f32>(lit * alpha, alpha);
}
`;
