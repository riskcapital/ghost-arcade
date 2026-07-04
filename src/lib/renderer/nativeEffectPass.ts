export type NativeEffectPassId =
  | 'invert'
  | 'grayscale'
  | 'brightness'
  | 'contrast'
  | 'gamma'
  | 'saturation'
  | 'hue'
  | 'posterize'
  | 'noise';

export interface NativeEffectPassManifestEntry {
  id: NativeEffectPassId;
  code: number;
  defaultAmount: number;
  amountMin: number;
  amountMax: number;
}

export interface NativeEffectPassOptions {
  sourceId: string;
  targetSourceId: string;
  effect: NativeEffectPassId;
  width?: number;
  height?: number;
  time?: number;
  frameDelta?: number;
  frameIndex?: number;
  amount?: number;
  mix?: number;
  params?: Partial<{
    scale: number;
    seed: number;
    param0: number;
    param1: number;
    param2: number;
    param3: number;
  }>;
  clear?: boolean;
  seq?: number;
}

export interface NativeEffectPassGraph {
  effect: NativeEffectPassId;
  config: {
    buffers: Array<Record<string, unknown>>;
    passes: unknown[];
    readbacks: string[];
    render_passes: Array<Record<string, unknown>>;
  };
}

export const NATIVE_EFFECT_PASS_SHADER_ID = 'effect-pass/render';

export const NATIVE_EFFECT_PASS_MANIFEST: NativeEffectPassManifestEntry[] = [
  { id: 'invert', code: 1, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'grayscale', code: 2, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'brightness', code: 3, defaultAmount: 1, amountMin: 0, amountMax: 4 },
  { id: 'contrast', code: 4, defaultAmount: 1, amountMin: 0, amountMax: 4 },
  { id: 'gamma', code: 5, defaultAmount: 1, amountMin: 0.1, amountMax: 4 },
  { id: 'saturation', code: 6, defaultAmount: 1, amountMin: 0, amountMax: 4 },
  { id: 'hue', code: 7, defaultAmount: 0, amountMin: -1, amountMax: 1 },
  { id: 'posterize', code: 8, defaultAmount: 6, amountMin: 2, amountMax: 32 },
  { id: 'noise', code: 9, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
];

const NATIVE_EFFECT_PASS_BY_ID = new Map(
  NATIVE_EFFECT_PASS_MANIFEST.map((entry) => [entry.id, entry]),
);

const NATIVE_EFFECT_PASS_WGSL = /* wgsl */`
struct EffectPassUniforms {
  resolution_time: vec4<f32>,
  effect: vec4<f32>,
  params0: vec4<f32>,
  params1: vec4<f32>,
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var source_tex: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> u: EffectPassUniforms;

fn saturate3(value: vec3<f32>) -> vec3<f32> {
  return clamp(value, vec3<f32>(0.0), vec3<f32>(1.5));
}

fn luma(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

fn hue_rotate(color: vec3<f32>, turns: f32) -> vec3<f32> {
  let angle = turns * 6.28318530718;
  let axis = normalize(vec3<f32>(1.0, 1.0, 1.0));
  return color * cos(angle) + cross(axis, color) * sin(angle) + axis * dot(axis, color) * (1.0 - cos(angle));
}

fn fract1(value: f32) -> f32 {
  return value - floor(value);
}

fn hash21(p: vec2<f32>) -> f32 {
  let q = fract(vec2<f32>(
    p.x * 127.1 + p.y * 311.7,
    p.x * 269.5 + p.y * 183.3,
  ));
  return fract1(sin(q.x + q.y) * 43758.5453123);
}

fn value_noise2d(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  let v = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, v.x), mix(c, d, v.x), v.y);
}

fn apply_effect(color: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
  let code = u32(round(u.effect.x));
  let amount = u.effect.y;
  if (code == 1u) {
    return mix(color, vec3<f32>(1.0) - color, clamp(amount, 0.0, 1.0));
  }
  if (code == 2u) {
    let gray = vec3<f32>(luma(color));
    return mix(color, gray, clamp(amount, 0.0, 1.0));
  }
  if (code == 3u) {
    return color * max(0.0, amount);
  }
  if (code == 4u) {
    return (color - vec3<f32>(0.5)) * amount + vec3<f32>(0.5);
  }
  if (code == 5u) {
    return pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / max(0.001, amount)));
  }
  if (code == 6u) {
    let gray = vec3<f32>(luma(color));
    return mix(gray, color, amount);
  }
  if (code == 7u) {
    return hue_rotate(color, amount);
  }
  if (code == 8u) {
    let levels = max(2.0, floor(amount + 0.5));
    return floor(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)) * levels + vec3<f32>(0.5)) / levels;
  }
  if (code == 9u) {
    let scale = max(0.001, u.params0.x);
    let seed = u.params0.y;
    let n = value_noise2d(uv * u.resolution_time.xy * scale + vec2<f32>(u.resolution_time.z * 19.0 + seed, u.effect.w * 0.37)) - 0.5;
    return color + n * clamp(amount, 0.0, 1.0) * 0.72;
  }
  return color;
}

@vertex
fn vs_full(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let pos = positions[vertex_index];
  var out: VsOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + vec2<f32>(0.5);
  return out;
}

@fragment
fn fs_effect(in: VsOut) -> @location(0) vec4<f32> {
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let src = textureSampleLevel(source_tex, source_sampler, uv, 0.0);
  let effected = apply_effect(src.rgb, uv);
  let mixed = mix(src.rgb, effected, clamp(u.effect.z, 0.0, 1.0));
  return vec4<f32>(saturate3(mixed), src.a);
}
`;

export function getNativeEffectPassShaderSource() {
  return {
    shaderId: NATIVE_EFFECT_PASS_SHADER_ID,
    stage: 'render',
    entry: 'fs_effect',
    source: NATIVE_EFFECT_PASS_WGSL,
  };
}

export function buildNativeEffectPassPrecompileCommands() {
  const source = getNativeEffectPassShaderSource();
  return [{
    type: 'precompile_shader',
    shader_id: source.shaderId,
    stage: source.stage,
    entry: source.entry,
    source: source.source,
  }];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeGraphId(value: string): string {
  return String(value || 'effect').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 180);
}

export function nativeEffectPassManifestEntry(effect: NativeEffectPassId): NativeEffectPassManifestEntry {
  const entry = NATIVE_EFFECT_PASS_BY_ID.get(effect);
  if (!entry) throw new Error(`Unsupported native effect pass: ${effect}`);
  return entry;
}

export function packNativeEffectPassUniforms(options: NativeEffectPassOptions): number[] {
  const manifest = nativeEffectPassManifestEntry(options.effect);
  const width = Math.max(1, Math.round(options.width ?? 1920));
  const height = Math.max(1, Math.round(options.height ?? 1080));
  const time = Number.isFinite(options.time) ? Number(options.time) : 0;
  const frameDelta = Number.isFinite(options.frameDelta) ? Number(options.frameDelta) : 1 / 60;
  const amount = clampNumber(
    options.amount ?? manifest.defaultAmount,
    manifest.amountMin,
    manifest.amountMax,
    manifest.defaultAmount,
  );
  const mix = clampNumber(options.mix ?? 1, 0, 1, 1);
  const frameIndex = Math.max(0, Math.round(options.frameIndex ?? 0));
  const params = options.params ?? {};
  const scale = clampNumber(params.scale ?? params.param0 ?? 0.42, 0.001, 64, 0.42);
  const seed = clampNumber(params.seed ?? params.param1 ?? 0, -100000, 100000, 0);
  const param2 = clampNumber(params.param2 ?? 0, -100000, 100000, 0);
  const param3 = clampNumber(params.param3 ?? 0, -100000, 100000, 0);
  return [
    width,
    height,
    time,
    frameDelta,
    manifest.code,
    amount,
    mix,
    frameIndex,
    scale,
    seed,
    param2,
    param3,
    0,
    0,
    0,
    0,
  ];
}

export function buildNativeEffectPassGraph(options: NativeEffectPassOptions): NativeEffectPassGraph {
  const manifest = nativeEffectPassManifestEntry(options.effect);
  const targetSourceId = options.targetSourceId || `${options.sourceId}:effect:${options.effect}`;
  const safeTarget = safeGraphId(targetSourceId);
  const uniformId = `effect-pass:${safeTarget}:uniform`;
  return {
    effect: manifest.id,
    config: {
      buffers: [{
        id: uniformId,
        kind: 'uniform',
        byte_length: 64,
        initial_f32: packNativeEffectPassUniforms(options),
      }],
      passes: [],
      readbacks: [],
      render_passes: [{
        name: `effect-pass-${manifest.id}`,
        shader_id: NATIVE_EFFECT_PASS_SHADER_ID,
        target: 'source_frame',
        source_id: targetSourceId,
        seq: Math.max(0, Math.round(options.seq ?? options.frameIndex ?? 0)),
        vertex_entry: 'vs_full',
        fragment_entry: 'fs_effect',
        vertex_count: 3,
        instance_count: 1,
        clear: options.clear ?? true,
        clear_color: [0, 0, 0, 0],
        blend: 'replace',
        bindings: [
          { binding: 0, kind: 'source-frame-texture', source_id: options.sourceId },
          { binding: 1, kind: 'source-frame-sampler' },
          { binding: 2, resource: uniformId, kind: 'uniform' },
        ],
      }],
    },
  };
}
