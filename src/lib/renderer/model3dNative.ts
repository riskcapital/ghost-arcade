// Native 3D Model renderer. Three.js loaders parse the model ONCE on the
// CPU (GLB/GLTF/OBJ/FBX) into a flat triangle-list vertex buffer that
// uploads to a persistent GPU storage buffer; the first diffuse texture
// bakes to RGBA and uploads as a source frame. Every frame packs a small
// camera/material uniform and the GPU draws the mesh depth-tested with
// the release renderer's lighting model, materials, and deformations.
import type { Model3DContent } from '$lib/types';
import { getModel3DLightingProfile } from '$lib/model3d/Model3DRenderer';
import { MODEL3D_DEFORM_ORDER, model3dDeformAxisIndex } from '$lib/model3d/model3dDeforms';

export const MODEL3D_NATIVE_SHADER_ID = 'model3d/render-v1';
export const MODEL3D_MAX_VERTICES = 3_500_000; // unique vertices
export const MODEL3D_MAX_INDICES = 9_000_000; // 3M triangles
export const MODEL3D_VERTEX_VEC4S = 2;
export const MODEL3D_UNIFORM_VEC4S = 27;
export const MODEL3D_UNIFORM_BYTES = MODEL3D_UNIFORM_VEC4S * 16;

const MATERIALS = [
  'source', 'standard', 'wireframe', 'glass', 'chrome', 'hologram', 'lava', 'ice',
  'neon', 'xray', 'toon', 'matcap', 'fresnel', 'dissolve', 'glitch', 'normal', 'depth',
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
  /** Bounding diagonal after normalization (the longest side is 4 units). */
  diagonal: number;
}

/** A cube's diagonal at the normalized size: the fallback before a mesh loads. */
export const MODEL3D_DEFAULT_DIAGONAL = 4 * Math.sqrt(3);

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
    diagonal: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * norm,
  };
}

// Column-major view-projection from Model3DCamera (WebGPU z in [0,1]).
export function model3dViewProjection(content: Model3DContent, aspect: number, time: number): number[] {
  const cam = content.camera ?? ({} as Model3DContent['camera']);
  const fov = (clamp(finite(cam.fov, 50), 10, 120) * Math.PI) / 180;
  const distance = Math.max(0.2, finite(cam.distance, 5));
  const orbitX = (finite(cam.orbitX, 0) * Math.PI) / 180;
  let orbitY = (finite(cam.orbitY, 0) * Math.PI) / 180;
  // Match the release: Model3DRenderer adds time * rotateSpeed * 0.3 RADIANS
  // to the model's +Y rotation. Orbiting the camera the opposite way is the
  // equivalent view; the old deg/s rate was ~17x slower than release.
  if (cam.autoRotate) orbitY -= time * finite(cam.rotateSpeed, 30) * 0.3;
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
  const speed = Math.max(0.05, finite(content.animationSpeed, 1));
  const t = time * speed;
  const amp = clamp(finite(content.animationIntensity, 1), 0, 3);
  // One-shot progress, matching Model3DRenderer: looping animations ride a
  // 0..1 sawtooth off the clock, one-shots ride the panel's progress slider.
  const loopT = ((t * 0.25) % 1 + 1) % 1;
  const oneShotT = content.animationLoop
    ? loopT
    : clamp(finite(content.animationProgress, 0), 0, 1);
  // Swapped to match the gizmo's release-calibrated axes (see splatNative).
  let rx = (finite(content.rotationY, 0) * Math.PI) / 180;
  let ry = (finite(content.rotationX, 0) * Math.PI) / 180;
  let rz = (finite(content.rotationZ, 0) * Math.PI) / 180;
  let px = finite(content.positionX, 0);
  let py = finite(content.positionY, 0);
  let pz = finite(content.positionZ, 0);
  const baseScale = Math.max(0.01, finite(content.scaleUniform, 1));
  let scaleX = baseScale;
  let scaleY = baseScale;
  let scaleZ = baseScale;
  let opacityMul = 1;
  let uvPanX = 0;
  let uvPanY = 0;
  switch (content.animationType) {
    case 'rotate': ry += t; break;
    case 'orbit': px += Math.cos(t) * amp; pz += Math.sin(t) * amp; ry += t; break;
    case 'bounce': py += Math.abs(Math.sin(t * 2)) * amp; break;
    case 'swing': rz += Math.sin(t * 1.5) * 0.5 * amp; break;
    case 'float': py += Math.sin(t) * 0.3 * amp; ry += Math.sin(t * 0.5) * 0.2; break;
    case 'shake': px += Math.sin(t * 23) * 0.05 * amp; py += Math.cos(t * 31) * 0.05 * amp; break;
    case 'spiral': px += Math.cos(t) * amp * 0.8; pz += Math.sin(t) * amp * 0.8; py += Math.sin(t * 0.7) * 0.5 * amp; ry += t; break;
    case 'fadeIn': opacityMul = clamp((t % 4) / 1.5, 0, 1); break;
    case 'scaleIn': {
      const k = clamp((t % 4) / 1.2, 0.001, 1);
      scaleX *= k; scaleY *= k; scaleZ *= k;
      break;
    }
    case 'unfold': {
      // Rotate from 90 degrees toward 0 on X as the one-shot completes.
      rx += (1 - oneShotT) * (Math.PI * 0.5) * amp;
      break;
    }
    case 'assemble': {
      // Parts converge out of an explosion: the balloon and spin shrink to 0.
      const f = 1 - oneShotT;
      const k = 1 + f * amp * 1.5;
      scaleX *= k; scaleY *= k; scaleZ *= k;
      ry += f * Math.PI * 2;
      break;
    }
    case 'grow': {
      const eased = Math.max(0.001, 1 - Math.pow(1 - oneShotT, 3));
      scaleX *= eased; scaleY *= eased; scaleZ *= eased;
      break;
    }
    case 'morphLoop': {
      // Squash-and-stretch stand-in; true vertex morphing needs keyframes.
      const m = Math.sin(t) * amp * 0.15;
      scaleX *= 1 + m;
      scaleY *= 1 - m * 0.5;
      scaleZ *= 1 + m * 0.5;
      break;
    }
    case 'texturePan': {
      uvPanX = ((t * 0.1) % 1 + 1) % 1;
      uvPanY = ((t * 0.07) % 1 + 1) % 1;
      break;
    }
    case 'colorCycle': break; // handled in shader via time
    default: break;
  }
  return { rx, ry, rz, px, py, pz, scaleX, scaleY, scaleZ, opacityMul, uvPanX, uvPanY };
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
  audioSub?: number;
  audioBass?: number;
  audioLowMid?: number;
  audioMid?: number;
  audioHighMid?: number;
  audioHigh?: number;
  audioBeat?: number;
  audioBeatPhase?: number;
  includeSnapshot?: boolean;
  /** The mesh's bounding diagonal in its normalized units (see loadModel3DNativeMesh). */
  meshDiagonal?: number;
}

export function buildModel3DNativeComputeGraph(options: Model3DNativeGraphOptions) {
  const width = Math.max(2, Math.round(options.width || 1920));
  const height = Math.max(2, Math.round(options.height || 1080));
  const time = Math.max(0, finite(options.time, 0));
  const c = options.content;
  const data = new Float32Array(MODEL3D_UNIFORM_VEC4S * 4);
  data.set(model3dViewProjection(c, width / height, time), 0);

  const xf = animatedTransform(c, time);

  // Audio reactivity + beat sync, ported from Model3DRenderer.updateModel.
  // The release resets the transform from content every frame and then adds
  // the audio nudges, so these are genuinely stateless and port exactly.
  const au = c.audio ?? ({ enabled: false } as Model3DContent['audio']);
  const bandMap: Record<string, number> = {
    sub: finite(options.audioSub, 0),
    bass: finite(options.audioBass, 0),
    lowMid: finite(options.audioLowMid, 0),
    mid: finite(options.audioMid, 0),
    highMid: finite(options.audioHighMid, 0),
    high: finite(options.audioHigh, 0),
    all: finite(options.audioLevel, 0),
  };
  const audioLevel = au.enabled
    ? clamp(bandMap[String(au.audioBand ?? 'all')] ?? bandMap.all, 0, 1.5)
    : 0;
  const beat = au.enabled ? clamp(finite(options.audioBeat, 0), 0, 2) : 0;
  if (audioLevel > 0) {
    // scaleResponse: model.scale *= 1 + level * response * 0.5
    const boost = 1 + audioLevel * clamp(finite(au.scaleResponse, 0), 0, 4) * 0.5;
    xf.scaleX *= boost; xf.scaleY *= boost; xf.scaleZ *= boost;
    // rotationResponse: rotation.y += level * response * 0.05 (per-frame nudge)
    xf.ry += audioLevel * clamp(finite(au.rotationResponse, 0), 0, 4) * 0.05;
  }
  if (beat > 0) {
    const punch = 1 + clamp(finite(c.beatScale, 0), 0, 4) * beat * 0.3;
    xf.scaleX *= punch; xf.scaleY *= punch; xf.scaleZ *= punch;
    xf.ry += clamp(finite(c.beatRotate, 0), 0, 4) * beat * Math.PI * 0.1;
  }
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
  data[20] = xf.scaleX; data[21] = xf.rx; data[22] = xf.ry; data[23] = xf.rz;
  data[24] = xf.px; data[25] = xf.py; data[26] = xf.pz;
  data[27] = idx(MATERIALS, c.materialType);
  data[28] = matColor[0]; data[29] = matColor[1]; data[30] = matColor[2];
  data[31] = clamp(finite(c.materialOpacity, 1), 0, 1) * xf.opacityMul;
  data[32] = emissive[0]; data[33] = emissive[1]; data[34] = emissive[2];
  // Base emissive + beatColorFlash (release: += flash * beat * 3) + an
  // emissiveResponse pump (not present in the WebGL path; additive approx).
  data[35] = clamp(
    finite(c.materialEmissiveIntensity, 0)
      + clamp(finite(c.beatColorFlash, 0), 0, 4) * beat * 3
      + audioLevel * clamp(finite(au.emissiveResponse, 0), 0, 4) * 2,
    0, 8);
  data[36] = Math.cos(el) * Math.cos(az); data[37] = Math.sin(el); data[38] = Math.cos(el) * Math.sin(az);
  data[39] = clamp(finite(c.directionalIntensity, 1) * profile.keyScale, 0, 5);
  data[40] = lightColor[0]; data[41] = lightColor[1]; data[42] = lightColor[2];
  data[43] = clamp(finite(c.ambientIntensity, 0.4) * profile.ambientScale, 0, 3);
  data[44] = rimColor[0]; data[45] = rimColor[1]; data[46] = rimColor[2];
  data[47] = clamp(finite(c.rimIntensity, 0) * profile.rimScale, 0, 5);
  data[48] = idx(MODEL3D_DEFORM_ORDER, c.deformationType);
  // Release morph shader: intensity = morphIntensity + level*deformResponse
  // (+ beatExplode * beat * 0.5 boost in updateShaderUniforms).
  data[49] = clamp(
    finite(c.deformationIntensity, 0.5)
      + audioLevel * clamp(finite(au.deformResponse, 0), 0, 4)
      + clamp(finite(c.beatExplode, 0), 0, 4) * beat * 0.5,
    0, 4);
  data[50] = Math.max(0, finite(c.deformationSpeed, 1));
  data[51] = Math.max(0.1, finite(c.deformationScale, 2));
  data[52] = options.hasTexture && c.materialType === 'source' ? 1 : 0;
  data[53] = clamp(finite(c.toonLevels, 4), 2, 12);
  data[54] = clamp(finite(c.dissolveAmount, 0), 0, 1);
  data[55] = clamp(finite(c.fresnelPower, 2), 0.3, 8);
  data[56] = Math.max(0.05, finite(c.hologramScanSpeed, 2));
  data[57] = clamp(finite(c.hologramScanCount, 30), 4, 120);
  data[58] = audioLevel; // band-selected, already gated on audio.enabled
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
  // anim0: per-axis scale (morphLoop squash/stretch) + texturePan UV offset.
  data[72] = xf.scaleY;
  data[73] = xf.scaleZ;
  data[74] = xf.uvPanX;
  data[75] = xf.uvPanY;
  // mat2: standard PBR + hologram glitch + chrome reflectivity
  data[76] = clamp(finite(c.materialRoughness, 0.5), 0, 1);
  data[77] = clamp(finite(c.materialMetalness, 0.5), 0, 1);
  data[78] = clamp(finite(c.hologramGlitchIntensity, 0), 0, 2);
  data[79] = clamp(finite(c.chromeReflectivity, 0.9), 0, 1);
  // mat3: lava + glass knobs
  data[80] = Math.max(0, finite(c.lavaFlowSpeed, 1));
  data[81] = clamp(finite(c.lavaCrackIntensity, 1), 0, 3);
  data[82] = clamp(finite(c.glassIOR, 1.5), 1, 2.5);
  data[83] = clamp(finite(c.glassThickness, 0.5), 0, 3);
  // wire0/wire1: wireframe overlay (indices match getModel3DWireframeModeIndex)
  const WIREFRAME_MODES = ['none', 'classic', 'animated', 'glow', 'neon', 'pulse', 'rainbow', 'dotted', 'thick'];
  data[84] = idx(WIREFRAME_MODES, c.wireframeMode);
  data[85] = clamp(finite(c.wireframeOpacity, 1), 0, 1);
  data[86] = clamp(finite(c.wireframeThickness, 1), 0.1, 10);
  data[87] = Math.max(0, finite(c.wireframeAnimSpeed, 1));
  const wireCol = col255(c.wireframeColor, [100, 200, 255]);
  data[88] = wireCol[0]; data[89] = wireCol[1]; data[90] = wireCol[2];
  data[91] = clamp(finite(c.dissolveEdgeWidth, 0.06), 0, 0.4);
  // fx3: audio color pump, environment boost, deform axis, shadow strength
  data[92] = audioLevel * clamp(finite(au.colorResponse, 0), 0, 4);
  const envOn = c.environmentEnabled ?? true;
  data[93] = envOn
    ? Math.max(0, finite(c.environmentIntensity, 1))
      * finite((profile as { environmentScale?: number }).environmentScale, 0.25)
    : 0;
  data[94] = model3dDeformAxisIndex(c.deformationType, c.deformationAxis);
  data[95] = (c.shadowsEnabled ?? true)
    ? clamp(finite((profile as { selfShadowStrength?: number }).selfShadowStrength, 0.6), 0, 1)
    : 0;
  // fx4: shadow softness/bias + vertex decorations
  data[96] = clamp(finite(c.shadowSoftness, 1), 0, 4);
  data[97] = clamp(finite(c.shadowBias, -0.0005), -0.01, 0.01);
  const DECOR_MODES = ['none', 'spheres', 'cubes', 'pyramids', 'points'];
  const decorMode = idx(DECOR_MODES, c.vertexDecoration);
  data[98] = decorMode;
  data[99] = Math.max(0, finite(c.vertexDecorationSize, 0.02));
  const decorCol = col255(c.vertexDecorationColor, [255, 255, 255]);
  data[100] = decorCol[0]; data[101] = decorCol[1]; data[102] = decorCol[2];
  const decorStride = Math.max(1, Math.ceil(Math.max(1, options.vertexCount) / 60000));
  data[103] = decorStride;
  // deform1: spread, and the scale into the WebGL renderer's deformation
  // space (bounding diagonal = 2 units).
  data[104] = clamp(finite(c.deformationSpread, 1), 0, 6);
  data[105] = 2 / Math.max(1e-3, finite(options.meshDiagonal, MODEL3D_DEFAULT_DIAGONAL));

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
      },
      // Vertex decorations: second pass over the same target (clear:false)
      // drawing one small screen-facing triangle per strided vertex.
      ...(decorMode > 0 && options.vertexCount > 0 ? [{
        name: 'model3d-decor',
        shader_id: MODEL3D_NATIVE_SHADER_ID,
        vertex_entry: 'vs_decor',
        fragment_entry: 'fs_decor',
        target: 'source_frame',
        source_id: sourceId,
        seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
        clear: false,
        include_snapshot: false,
        blend: 'alpha',
        primitive: 'triangle-list',
        vertex_count: Math.max(3, Math.ceil(options.vertexCount / decorStride) * 3),
        instance_count: 1,
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
      }] : [])],
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
  pad0: vec4<f32>, pad1: vec4<f32>,
  anim0: vec4<f32>,    // scaleY, scaleZ, uvPanX, uvPanY
  mat2: vec4<f32>,     // roughness, metalness, hologramGlitch, chromeReflectivity
  mat3: vec4<f32>,     // lavaFlowSpeed, lavaCrackIntensity, glassIOR, glassThickness
  wire0: vec4<f32>,    // wireMode, wireOpacity, wireThickness, wireAnimSpeed
  wire1: vec4<f32>,    // wireColor.rgb, dissolveEdgeWidth
  fx3: vec4<f32>,      // audioColorPump, envIntensity, deformAxis, shadowStrength
  fx4: vec4<f32>,      // shadowSoftness, shadowBias, decorMode, decorSize
  decor0: vec4<f32>,   // decorColor.rgb, decorStride
  deform1: vec4<f32>,  // spread, native-to-canonical scale, 0, 0
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

fn m_fbm3(p0: vec3<f32>) -> f32 {
  var p = p0;
  var f = 0.5 * m_noise3(p); p = p * 2.01;
  f = f + 0.25 * m_noise3(p); p = p * 2.02;
  f = f + 0.125 * m_noise3(p); p = p * 2.03;
  f = f + 0.0625 * m_noise3(p);
  return f / 0.9375;
}
fn m_safe_norm(v: vec3<f32>) -> vec3<f32> {
  let l = length(v);
  return select(vec3<f32>(0.0), v / max(l, 1e-6), l > 1e-6);
}

// Deformations: the WebGL renderer's applyMorph, in its canonical space (the
// model's bounding diagonal = 2 units, centred), so each type reads the same
// controls and looks the same in both renderers. Indices follow
// MODEL3D_DEFORM_ORDER in model3dDeforms.ts.
fn m_deform(p: vec3<f32>, nrm: vec3<f32>) -> vec3<f32> {
  let dt = i32(mp.deform.x + 0.5);
  let di = mp.deform.y;          // intensity, with audio and beat
  let spd = mp.deform.z;
  let tt = mp.screen.z * spd;    // time * speed
  let dsc = mp.deform.w;         // scale
  let dspr = mp.deform1.x;       // spread
  let to_c = max(mp.deform1.y, 1e-6);
  if (dt <= 0 || di < 0.001) { return p; }
  let cp = p * to_c;
  var off = vec3<f32>(0.0);
  if (dt == 1) { // noise
    let n1 = m_fbm3(cp * dsc + vec3<f32>(tt * 0.5));
    let n2 = m_fbm3(cp * dsc * 1.5 - vec3<f32>(tt * 0.3));
    off = nrm * (n1 * 0.7 + n2 * 0.3) * di * dspr;
  } else if (dt == 2) { // wave
    let w = (sin(cp.x * dsc * 2.0 + tt * 2.0) + sin(cp.z * dsc * 2.0 + tt * 1.7) + sin((cp.x + cp.z) * dsc + tt * 2.3)) / 3.0;
    off = nrm * w * di * 0.5 * dspr;
  } else if (dt == 3) { // twist
    let a = sin(cp.y * dsc + tt) * di * 0.5 * dspr;
    let ca = cos(a); let sa = sin(a);
    off = vec3<f32>(cp.x * ca - cp.z * sa, cp.y, cp.x * sa + cp.z * ca) - cp;
  } else if (dt == 4) { // bend
    let a = cp.y * di * dspr;
    let ca = cos(a); let sa = sin(a);
    off = vec3<f32>(cp.x, cp.y * ca - cp.z * sa, cp.y * sa + cp.z * ca) - cp;
  } else if (dt == 5) { // taper
    off = -vec3<f32>(cp.x, 0.0, cp.z) * abs(cp.y) * di * dspr;
  } else if (dt == 6) { // spherify (spread = radius)
    off = (m_safe_norm(cp) * dspr - cp) * di;
  } else if (dt == 7) { // inflate
    let b = pow(sin(tt * 2.0) * 0.5 + 0.5, 0.7);
    let v = 1.0 + m_noise3(cp * dsc * 2.0 + vec3<f32>(tt * 0.5)) * 0.2;
    off = nrm * b * di * v * dspr;
  } else if (dt == 8) { // explode
    let n = m_noise3(cp * 10.0) * 0.3 + 0.7;
    off = m_safe_norm(cp) * di * n * dspr;
  } else if (dt == 9) { // implode
    let n = m_noise3(cp * 10.0) * 0.3 + 0.7;
    off = -cp * clamp(di * dspr, 0.0, 1.5) * n * 0.5;
  } else if (dt == 10) { // shatter
    let q = max(dsc * 0.8, 1e-3);
    let chunk = floor(cp * q) / q;
    let n1 = m_noise3(chunk * 5.0);
    let n2 = m_noise3(chunk * 5.0 + vec3<f32>(100.0));
    let n3 = m_noise3(chunk * 5.0 + vec3<f32>(200.0));
    let sc = m_safe_norm(vec3<f32>(n1, n2, n3) + m_safe_norm(cp + vec3<f32>(0.001)) * 0.5);
    off = sc * di * dspr * (0.6 + abs(n1) * 0.4);
  } else if (dt == 11) { // melt
    let h = clamp((cp.y + 1.0) * 0.5, 0.0, 1.0);
    let m = h * h * di * dspr;
    let n = m_noise3(cp * dsc + vec3<f32>(tt * 0.6));
    off = vec3<f32>(n * m * 0.3, -m * 0.5, n * m * 0.3);
  } else if (dt == 12) { // voxelize
    let vs = max(0.04, 0.5 / max(dsc, 0.1));
    off = (floor(cp / vs + 0.5) * vs - cp) * di * dspr;
  } else if (dt == 13) { // jelly
    let w1 = sin(cp.y * 3.0 + tt * 4.0) * sin(cp.x * 2.0 + tt * 3.0);
    let w2 = sin(cp.z * 2.5 + tt * 3.5) * cos(cp.y * 2.0 + tt * 2.5);
    let j = sin((w1 + w2) * 0.5 * 3.14159 + length(cp) * 0.5);
    off = nrm * j * di * 0.4 * dspr;
  } else if (dt == 14) { // breathe
    off = cp * sin(tt * 2.0) * di * 0.2 * dspr;
  } else if (dt == 15) { // pulse
    var pl = sin(length(cp) * dsc * 3.0 - tt * 4.0) * 0.5 + 0.5;
    pl = pl * pl;
    off = m_safe_norm(cp) * pl * di * 0.5 * dspr;
  } else if (dt == 16) { // bulge
    var w = max(0.0, sin(cp.y * dsc * 2.0 - tt * 3.0));
    w = w * w;
    off = nrm * w * di * dspr;
  } else if (dt == 17) { // tentacle
    let k = cp.y * dsc * 4.0 - tt * 3.0;
    let a = di * 0.3 * (cp.y + 1.0) * dspr;
    off = vec3<f32>(sin(k + cp.x * 2.0) * a, 0.0, sin(k + cp.z * 2.0 + 1.0) * a);
  } else if (dt == 18) { // magnetic
    let pull = (sin(tt) * 0.5 + 0.5) * di * dspr;
    off = vec3<f32>(-cp.x * pull * 0.2, sign(cp.y) * pull * 0.5, -cp.z * pull * 0.2);
  } else if (dt == 19) { // swirl
    let r = length(cp.xz);
    let ang = atan2(cp.z, cp.x) + (cp.y * dsc + tt * spd * 0.5) * di;
    let pr = r * (1.0 + di * dspr * 0.3);
    off = vec3<f32>(cos(ang) * pr, cp.y, sin(ang) * pr) - cp;
  } else if (dt == 20) { // fracture
    let id = floor(cp * dsc * 0.5);
    let seed = m_noise3(id * 7.0);
    let dir = m_safe_norm(vec3<f32>(
      m_noise3(id * 3.1 + vec3<f32>(11.0)),
      m_noise3(id * 3.1 + vec3<f32>(22.0)),
      m_noise3(id * 3.1 + vec3<f32>(33.0))) + cp * 0.4);
    off = dir * (0.6 + abs(seed) * 0.6) * di * dspr;
  }
  // Axis restriction: keep only the chosen component of the displacement.
  let dax = i32(mp.fx3.z + 0.5);
  if (dax == 1) { off = vec3<f32>(off.x, 0.0, 0.0); }
  else if (dax == 2) { off = vec3<f32>(0.0, off.y, 0.0); }
  else if (dax == 3) { off = vec3<f32>(0.0, 0.0, off.z); }
  return (cp + off) / to_c;
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) world: vec3<f32>,
  @location(3) color: vec4<f32>,
  @location(4) misc: vec4<f32>, // hasVertexTex, viewZ, triId, 0
  @location(5) bary: vec3<f32>,
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

  var bary = vec3<f32>(0.0);
  bary[vi % 3u] = 1.0;

  // Deformation (object space, before transform).
  pos = m_deform(pos, nrm);

  // Model transform: per-axis scale, euler ZYX, translate. anim0.xy carry the
  // Y/Z scale so morphLoop can squash and stretch; a zero (uniform never
  // packed) falls back to the uniform scale.
  let scale_y = select(mp.anim0.x, mp.xform0.x, mp.anim0.x <= 0.0);
  let scale_z = select(mp.anim0.y, mp.xform0.x, mp.anim0.y <= 0.0);
  pos = pos * vec3<f32>(mp.xform0.x, scale_y, scale_z);
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
      // These five types previously shared one identical branch, and the
      // shared trail direction started aligned with the view axis (copies
      // hidden behind the model), so switching type/count showed nothing.
      // Bias the direction sideways and differentiate each type.
      var dir = normalize(vec3<f32>(sin(et * 0.9) + 0.35, 0.25 * sin(et * 0.6) + 0.15, cos(et * 0.9)));
      var sp = spacing;
      if (etype == 2) { sp = spacing * 0.35; } // motionBlur: tight smear
      if (etype == 3) { // afterimage: frozen past poses along older directions
        dir = normalize(vec3<f32>(sin(et * 0.9 - k * 0.5) + 0.35, 0.25 * sin(et * 0.6 - k * 0.5) + 0.15, cos(et * 0.9 - k * 0.5)));
      }
      if (etype == 4) { echo_alpha = echo_alpha * step(0.5, fract(et * 2.0 + k * 0.37)); } // strobe flicker
      if (etype == 5) { dir = vec3<f32>(1.0, 0.0, 0.0); } // stream: straight line
      off = -dir * sp * k;
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
  out.bary = bary;
  return out;
}

@fragment fn fs_mesh(in: VsOut) -> @location(0) vec4<f32> {
  let t = mp.screen.z;
  let mat = i32(mp.xform1.w + 0.5);
  // Wireframe edge factor from per-corner barycentrics. Derivatives are taken
  // up front, before any material discard, to keep uniform control flow.
  let pw = fwidth(in.bary);
  var wthick = max(mp.wire0.z, 0.25);
  if (i32(mp.wire0.x + 0.5) == 8) { wthick = max(wthick * 2.4, 3.5); }
  let edge_d = smoothstep(vec3<f32>(0.0), pw * wthick, in.bary);
  let wire_edge = 1.0 - min(min(edge_d.x, edge_d.y), edge_d.z);
  var n = normalize(in.normal);
  let view_dir = vec3<f32>(0.0, 0.0, 1.0);
  let fres = pow(1.0 - clamp(abs(n.z), 0.0, 1.0), mp.fx0.w);

  var albedo = mp.mat0.rgb;
  if (mat == 0) {
    albedo = in.color.rgb;
    if (mp.fx0.x > 0.5 && in.misc.x > 0.5) {
      // texturePan slides the diffuse lookup; anim0.zw are 0 otherwise.
      let uv = fract(vec2<f32>(in.uv.x, 1.0 - in.uv.y) + vec2<f32>(mp.anim0.z, mp.anim0.w));
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

  if (mat == 1) { // standard — roughness/metalness approximation
    let rough = clamp(mp.mat2.x, 0.0, 1.0);
    let metal = clamp(mp.mat2.y, 0.0, 1.0);
    let ndl = key / max(mp.light0.w, 0.001);
    let spec = pow(ndl, mix(64.0, 4.0, rough)) * mp.light0.w * mix(0.5, 0.06, rough);
    let spec_col = mix(vec3<f32>(1.0), albedo, metal);
    lit = albedo * mp.light1.rgb * (key + fill) * (1.0 - metal * 0.6)
      + albedo * mp.light1.w
      + spec_col * mp.light1.rgb * spec * (0.5 + metal * 1.5);
  } else if (mat == 10) { // toon
    let levels = mp.fx0.y;
    let q = floor(clamp(key + fill, 0.0, 1.0) * levels + 0.5) / levels;
    lit = albedo * mp.light1.rgb * q + albedo * mp.light1.w * 0.6;
  } else if (mat == 5) { // hologram
    let scan = 0.6 + 0.4 * sin(in.world.y * mp.fx1.y + t * mp.fx1.x * 3.0);
    lit = mix(vec3<f32>(0.1, 0.6, 1.0), albedo, 0.3) * scan + mp.light2.rgb * fres * 1.5;
    alpha = alpha * (0.35 + fres * 0.5) * scan;
    // Glitch: random horizontal bands flicker with channel-swapped color.
    let gband = step(1.0 - clamp(mp.mat2.z, 0.0, 2.0) * 0.12, m_hash3(vec3<f32>(floor(in.world.y * 26.0), floor(t * 18.0), 7.0)));
    lit = mix(lit, vec3<f32>(lit.b, lit.g, lit.r) * 1.6, gband * 0.8);
    alpha = alpha * (1.0 - gband * 0.5);
  } else if (mat == 9) { // xray
    lit = albedo * 0.2 + vec3<f32>(0.4, 0.7, 1.0) * fres * 1.6;
    alpha = alpha * (0.08 + fres * 0.7);
  } else if (mat == 8) { // neon
    lit = albedo * (1.5 + sin(t * 3.0) * 0.3) + mp.mat1.rgb * mp.mat1.w;
  } else if (mat == 4) { // chrome — fake env gradient, blended by reflectivity
    let env = mix(vec3<f32>(0.15, 0.16, 0.2), vec3<f32>(0.9, 0.95, 1.0), clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
    let mirror = env * (0.4 + key * 0.8) + vec3<f32>(1.0) * pow(key, 24.0);
    lit = mix(albedo * mp.light1.rgb * (key * 0.6 + 0.25), mirror, clamp(mp.mat2.w, 0.0, 1.0));
  } else if (mat == 3) { // glass — IOR steers the fresnel curve, thickness the body
    let ior_f = pow(1.0 - clamp(abs(n.z), 0.0, 1.0), max(0.5, 5.0 - (clamp(mp.mat3.z, 1.0, 2.5) - 1.0) * 2.5));
    let thick = clamp(mp.mat3.w, 0.0, 3.0);
    lit = albedo * (0.1 + thick * 0.15) + vec3<f32>(0.8, 0.9, 1.0) * ior_f * 1.2 + vec3<f32>(1.0) * pow(key, 32.0);
    alpha = alpha * clamp(0.12 + thick * 0.08 + ior_f * 0.6, 0.0, 1.0);
  } else if (mat == 6) { // lava
    let flow = m_noise3(in.world * 2.5 + vec3<f32>(0.0, -t * mp.mat3.x * 0.5, 0.0));
    let heat = clamp(flow * 0.5 + 0.5, 0.0, 1.0);
    let crack = clamp(mp.mat3.y, 0.0, 3.0);
    lit = mix(vec3<f32>(0.15, 0.02, 0.0), vec3<f32>(1.0, 0.5, 0.05), pow(heat, 1.6)) + vec3<f32>(1.0, 0.8, 0.2) * pow(heat, 5.0) * (0.4 + crack * 0.6);
    lit = mix(lit, vec3<f32>(0.05, 0.01, 0.0), crack * 0.35 * (1.0 - heat));
  } else if (mat == 7) { // ice
    lit = mix(lit, vec3<f32>(0.75, 0.9, 1.0), 0.6) + vec3<f32>(1.0) * fres * 0.8;
    alpha = alpha * (0.5 + fres * 0.4);
  } else if (mat == 12) { // fresnel
    lit = lit * 0.3 + mp.light2.rgb * fres * 2.0;
  } else if (mat == 13) { // dissolve
    let h = m_hash3(floor(in.world * 14.0));
    if (h < mp.fx0.z) { discard; }
    if (h < mp.fx0.z + max(mp.wire1.w, 0.005)) { lit = mp.light2.rgb * 2.0; }
  } else if (mat == 14) { // glitch
    let band = step(0.92, m_hash3(vec3<f32>(floor(in.world.y * 20.0), floor(t * 12.0), 1.0)));
    lit = mix(lit, vec3<f32>(lit.b, lit.r, lit.g), band);
  } else if (mat == 2) { // wireframe material — edges only
    lit = mp.wire1.rgb * (0.5 + 0.5 * key) + mp.mat1.rgb * mp.mat1.w;
    alpha = alpha * wire_edge;
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

  // Environment lighting boost (stateless stand-in for the release's IBL map).
  if (mp.fx3.y > 0.001) {
    let envg = mix(vec3<f32>(0.16, 0.17, 0.22), vec3<f32>(0.65, 0.72, 0.8), clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
    lit = lit + albedo * envg * mp.fx3.y * 0.5;
  }
  // Shadows: the release uses real shadow maps. Statelessly approximated as
  // key-facing self-shadow darkening; softness widens the terminator and
  // bias nudges its threshold.
  if (mp.fx3.w > 0.001) {
    let ssoft = clamp(mp.fx4.x, 0.0, 4.0) * 0.25;
    let sh = smoothstep(-0.15 - ssoft * 0.35 + mp.fx4.y * 20.0, 0.35 + ssoft * 0.35, dot(n, normalize(mp.light0.xyz)));
    lit = lit * mix(1.0 - mp.fx3.w * 0.45, 1.0, sh);
  }
  // Wireframe overlay on any material (port of the barycentric fwidth look).
  let wmode = i32(mp.wire0.x + 0.5);
  if (wmode > 0 && mat != 2) {
    var wcol = mp.wire1.rgb;
    var walpha = wire_edge * mp.wire0.y;
    if (wmode == 2) { // animated packets
      let flowv = fract(dot(in.world, vec3<f32>(1.7, 2.3, 1.1)) - t * max(mp.wire0.w, 0.01) * 1.8);
      let packet = smoothstep(0.05, 0.28, flowv) * (1.0 - smoothstep(0.45, 0.72, flowv));
      walpha = walpha * (0.18 + packet * 1.25);
      wcol = mix(wcol * 0.45, min(vec3<f32>(1.0), wcol * 1.8), packet);
    } else if (wmode == 3 || wmode == 4) { // glow / neon halo
      let halo_d = smoothstep(vec3<f32>(0.0), pw * wthick * select(2.4, 3.8, wmode == 3), in.bary);
      let halo = 1.0 - min(min(halo_d.x, halo_d.y), halo_d.z);
      let core = pow(wire_edge, select(0.3, 0.75, wmode == 3));
      walpha = (halo * 0.38 + core) * mp.wire0.y;
      if (wmode == 4) { wcol = mix(wcol, vec3<f32>(1.0), core * 0.65); }
    } else if (wmode == 5) { // pulse
      let pulse = 0.5 + 0.5 * sin(t * max(mp.wire0.w, 0.01) * 4.0);
      walpha = walpha * (0.3 + pulse * 0.9);
      wcol = mix(wcol * 0.55, min(vec3<f32>(1.0), wcol * 1.75), pulse);
    } else if (wmode == 6) { // rainbow
      wcol = m_hsv2rgb(vec3<f32>(fract(dot(in.world, vec3<f32>(0.13, 0.17, 0.11)) + t * max(mp.wire0.w, 0.01) * 0.15), 1.0, 1.0));
    } else if (wmode == 7) { // dotted
      walpha = walpha * step(0.5, fract(dot(in.world, vec3<f32>(6.0, 6.0, 6.0)) + t * max(mp.wire0.w, 0.01) * 0.5));
    }
    lit = mix(lit, wcol, clamp(walpha, 0.0, 1.0));
  }
  // Rim + emissive + audio pump (+ colorResponse pump) + exposure
  lit = lit + mp.light2.rgb * fres * mp.light2.w;
  lit = lit + mp.mat1.rgb * mp.mat1.w * 0.5;
  lit = lit * (1.0 + mp.fx1.z * 0.4 + mp.fx3.x * 0.8);
  lit = vec3<f32>(1.0) - exp(-lit * mp.fx2.y);

  if (alpha < 0.004) { discard; }
  return vec4<f32>(lit * alpha, alpha);
}

// Vertex decorations: one small screen-facing triangle per strided vertex.
// Approximates the release's instanced sphere/cube/pyramid markers ('points'
// draws extra small). Markers follow the model transform and the vertex
// deformations.
struct DecorOut {
  @builtin(position) position: vec4<f32>,
  @location(0) shade: f32,
}

@vertex fn vs_decor(@builtin(vertex_index) vi: u32) -> DecorOut {
  var out: DecorOut;
  let stride = max(1u, u32(mp.decor0.w + 0.5));
  let m = (vi / 3u) * stride;
  let corner = vi % 3u;
  if (m >= u32(mp.screen.w + 0.5)) {
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.shade = 0.0;
    return out;
  }
  var pos = m_deform(verts[m * 2u].xyz, verts[m * 2u + 1u].xyz);
  let scale_y = select(mp.anim0.x, mp.xform0.x, mp.anim0.x <= 0.0);
  let scale_z = select(mp.anim0.y, mp.xform0.x, mp.anim0.y <= 0.0);
  pos = pos * vec3<f32>(mp.xform0.x, scale_y, scale_z);
  let cx = cos(mp.xform0.y); let sx = sin(mp.xform0.y);
  let cy = cos(mp.xform0.z); let sy = sin(mp.xform0.z);
  let cz = cos(mp.xform0.w); let sz = sin(mp.xform0.w);
  var q = vec3<f32>(pos.x, pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);
  q = vec3<f32>(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  q = vec3<f32>(q.x * cz - q.y * sz, q.x * sz + q.y * cz, q.z);
  q = q + vec3<f32>(mp.xform1.x, mp.xform1.y, mp.xform1.z);
  var clip = mp.vp0 * q.x + mp.vp1 * q.y + mp.vp2 * q.z + mp.vp3;
  var size = mp.fx4.w * 2.0;
  if (i32(mp.fx4.z + 0.5) == 4) { size = size * 0.3; } // points
  var ox = 0.0; var oy = 1.0;
  if (corner == 1u) { ox = -0.866; oy = -0.5; }
  if (corner == 2u) { ox = 0.866; oy = -0.5; }
  // Fixed clip-space offset: after the perspective divide the marker shrinks
  // with distance, giving an approximately world-sized billboard.
  clip.x = clip.x + ox * size * (mp.screen.y / mp.screen.x) * 2.2;
  clip.y = clip.y + oy * size * 2.2;
  out.position = clip;
  out.shade = 0.7 + 0.3 * oy;
  return out;
}

@fragment fn fs_decor(in: DecorOut) -> @location(0) vec4<f32> {
  if (i32(mp.fx4.z + 0.5) == 0) { discard; }
  let a = mp.mat0.w;
  return vec4<f32>(mp.decor0.rgb * in.shade * a, a);
}
`;
