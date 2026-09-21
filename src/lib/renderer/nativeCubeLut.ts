import type { CubeLut } from '../color/cubeLut';

export const NATIVE_CUBE_LUT_SHADER_ID = 'native-cube-lut-v1';

/** Dedicated shader so ordinary effects pay no extra storage-binding cost. */
export const NATIVE_CUBE_LUT_WGSL = /* wgsl */`
struct LutUniforms {
  domain_min: vec4<f32>,
  domain_scale: vec4<f32>,
  settings: vec4<f32>,
}
struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}
@group(0) @binding(0) var source_tex: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> u: LutUniforms;
@group(0) @binding(3) var<storage, read> table: array<vec4<f32>>;

fn lookup(p: vec3<u32>, n: u32) -> vec3<f32> {
  return table[p.x + n * (p.y + n * p.z)].rgb;
}
fn grade(rgb: vec3<f32>) -> vec3<f32> {
  let n = u32(u.settings.x);
  let p = clamp((rgb - u.domain_min.xyz) * u.domain_scale.xyz, vec3<f32>(0.0), vec3<f32>(1.0)) * f32(n - 1u);
  let lo = vec3<u32>(floor(p));
  let hi = min(lo + vec3<u32>(1u), vec3<u32>(n - 1u));
  let f = fract(p);
  let z0 = mix(
    mix(lookup(lo, n), lookup(vec3<u32>(hi.x, lo.y, lo.z), n), f.x),
    mix(lookup(vec3<u32>(lo.x, hi.y, lo.z), n), lookup(vec3<u32>(hi.x, hi.y, lo.z), n), f.x), f.y);
  let z1 = mix(
    mix(lookup(vec3<u32>(lo.x, lo.y, hi.z), n), lookup(vec3<u32>(hi.x, lo.y, hi.z), n), f.x),
    mix(lookup(vec3<u32>(lo.x, hi.y, hi.z), n), lookup(hi, n), f.x), f.y);
  return mix(z0, z1, f.z);
}
@vertex
fn vs_full(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let pos = positions[vertex_index];
  var out: VsOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = vec2<f32>(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  return out;
}
@fragment
fn fs_effect(in: VsOut) -> @location(0) vec4<f32> {
  let src = textureSampleLevel(source_tex, source_sampler, clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
  return vec4<f32>(mix(src.rgb, grade(src.rgb), u.settings.y), src.a);
}
`;

export function buildNativeCubeLutPrecompileCommand() {
  return { type: 'precompile_shader' as const, shader_id: NATIVE_CUBE_LUT_SHADER_ID, stage: 'render', entry: 'fs_effect', source: NATIVE_CUBE_LUT_WGSL };
}

/** Small uniform updates can change strength without uploading the LUT again. */
export function packNativeCubeLutUniforms(lut: CubeLut, strength = 1): number[] {
  const mix = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 1;
  return [...lut.domainMin, 0, ...lut.domainMax.map((max, i) => 1 / (max - lut.domainMin[i])), 0, lut.size, mix, 0, 0];
}

// Binary float32 transport preserves the full Cube numeric range (the generic
// JSON f32 importer intentionally clamps values). Cache the large payload once.
const packedTables = new WeakMap<CubeLut, string>();
function encodeFloats(values: readonly number[]): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setFloat32(i * 4, value, true));
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(chunks.join(''));
}
function packedTable(lut: CubeLut): string {
  let packed = packedTables.get(lut);
  if (!packed) { packed = encodeFloats(lut.rgba); packedTables.set(lut, packed); }
  return packed;
}

/** Build at graph installation, not once per frame. The LUT stays in GPU storage. */
export function buildNativeCubeLutGraph(options: {
  lut: CubeLut;
  sourceId: string;
  targetSourceId: string;
  strength?: number;
  seq?: number;
}) {
  if (!options.sourceId || !options.targetSourceId || options.sourceId === options.targetSourceId) {
    throw new Error('LUT rendering requires distinct source and target IDs.');
  }
  const uniformId = 'cube-lut:uniform';
  const tableId = 'cube-lut:table';
  return {
    buffers: [
      { id: uniformId, kind: 'uniform', byte_length: 48, initial_b64: encodeFloats(packNativeCubeLutUniforms(options.lut, options.strength)) },
      { id: tableId, kind: 'storage', byte_length: options.lut.rgba.length * 4, initial_b64: packedTable(options.lut) },
    ],
    passes: [],
    readbacks: [],
    render_passes: [{
      name: 'cube-lut', shader_id: NATIVE_CUBE_LUT_SHADER_ID,
      target: 'source_frame', source_id: options.targetSourceId,
      seq: Number.isFinite(options.seq) ? Math.max(0, Math.round(options.seq!)) : 0,
      vertex_entry: 'vs_full', fragment_entry: 'fs_effect', vertex_count: 3, instance_count: 1,
      clear: true, clear_color: [0, 0, 0, 0], blend: 'replace',
      bindings: [
        { binding: 0, kind: 'source-frame-texture', source_id: options.sourceId },
        { binding: 1, kind: 'source-frame-sampler' },
        { binding: 2, kind: 'uniform', resource: uniformId },
        { binding: 3, kind: 'read-only-storage', resource: tableId },
      ],
    }],
  };
}
