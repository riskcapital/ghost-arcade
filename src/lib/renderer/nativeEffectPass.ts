export type NativeEffectPassId =
  | 'invert'
  | 'grayscale'
  | 'brightness'
  | 'contrast'
  | 'gamma'
  | 'saturation'
  | 'hue'
  | 'posterize'
  | 'noise'
  | 'pixelate'
  | 'vignette'
  | 'rgb-shift'
  | 'scanlines'
  | 'blur'
  | 'chromatic-aberration'
  | 'glitch';

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
    mode: number;
    gridLines: number;
    animSpeed: number;
    animAmount: number;
    param4: number;
    param5: number;
    param6: number;
    param7: number;
    softness: number;
    roundness: number;
    shape: number;
    aspect: number;
    centerX: number;
    centerY: number;
    tintAmount: number;
    breathing: number;
    angle: number;
    count: number;
    intensity: number;
    speed: number;
    radius: number;
    edgeProtect: number;
    edgeFalloff: number;
    rollingBar: number;
    phosphor: number;
    curvature: number;
    interlace: number;
    rgbSplit: number;
    jitter: number;
    blockSize: number;
    triggerMode: number;
    blockHold: number;
    verticalSlice: number;
    tearChance: number;
    prismSpread: number;
    outputMix: number;
  }>;
  clear?: boolean;
  seq?: number;
}

export interface NativeEffectPassChainPass {
  effect: NativeEffectPassId;
  amount?: number;
  mix?: number;
  params?: NativeEffectPassOptions['params'];
}

export interface NativeEffectPassChainOptions extends Omit<NativeEffectPassOptions, 'effect' | 'amount' | 'mix' | 'params'> {
  effects: NativeEffectPassChainPass[];
  intermediatePrefix?: string;
}

export interface NativeEffectPassGraph {
  effect: NativeEffectPassId;
  effects?: NativeEffectPassId[];
  config: {
    buffers: Array<Record<string, unknown>>;
    passes: unknown[];
    readbacks: string[];
    render_passes: Array<Record<string, unknown>>;
  };
}

export type NativeEffectPassPrecompileCommand = {
  type: 'precompile_shader';
  shader_id: string;
  stage: string;
  entry: string;
  source: string;
};

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
  { id: 'pixelate', code: 10, defaultAmount: 8, amountMin: 1, amountMax: 128 },
  { id: 'vignette', code: 11, defaultAmount: 0.8, amountMin: 0, amountMax: 2 },
  { id: 'rgb-shift', code: 12, defaultAmount: 5, amountMin: 0, amountMax: 80 },
  { id: 'scanlines', code: 13, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'blur', code: 14, defaultAmount: 5, amountMin: 0, amountMax: 48 },
  { id: 'chromatic-aberration', code: 15, defaultAmount: 0.4, amountMin: 0, amountMax: 3 },
  { id: 'glitch', code: 16, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
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

fn sample_clamped(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(source_tex, source_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
}

fn sample_rgb(uv: vec2<f32>) -> vec3<f32> {
  return sample_clamped(uv).rgb;
}

fn effect_texel() -> vec2<f32> {
  return vec2<f32>(1.0) / max(u.resolution_time.xy, vec2<f32>(1.0));
}

fn apply_effect(src: vec4<f32>, uv: vec2<f32>) -> vec4<f32> {
  let color = src.rgb;
  let code = u32(round(u.effect.x));
  let amount = u.effect.y;
  if (code == 1u) {
    return vec4<f32>(mix(color, vec3<f32>(1.0) - color, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 2u) {
    let gray = vec3<f32>(luma(color));
    return vec4<f32>(mix(color, gray, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 3u) {
    return vec4<f32>(color * max(0.0, amount), src.a);
  }
  if (code == 4u) {
    return vec4<f32>((color - vec3<f32>(0.5)) * amount + vec3<f32>(0.5), src.a);
  }
  if (code == 5u) {
    return vec4<f32>(pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / max(0.001, amount))), src.a);
  }
  if (code == 6u) {
    let gray = vec3<f32>(luma(color));
    return vec4<f32>(mix(gray, color, amount), src.a);
  }
  if (code == 7u) {
    return vec4<f32>(hue_rotate(color, amount), src.a);
  }
  if (code == 8u) {
    let levels = max(2.0, floor(amount + 0.5));
    return vec4<f32>(floor(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)) * levels + vec3<f32>(0.5)) / levels, src.a);
  }
  if (code == 9u) {
    let scale = max(0.001, u.params0.x);
    let seed = u.params0.y;
    let n = value_noise2d(uv * u.resolution_time.xy * scale + vec2<f32>(u.resolution_time.z * 19.0 + seed, u.effect.w * 0.37)) - 0.5;
    return vec4<f32>(color + n * clamp(amount, 0.0, 1.0) * 0.72, src.a);
  }
  if (code == 10u) {
    let mode = u32(round(u.params0.x));
    let grid_lines = clamp(u.params0.y, 0.0, 1.0);
    let anim_speed = max(0.0, u.params0.z);
    let anim_amount = clamp(u.params0.w, 0.0, 1.0);
    var size = max(1.0, amount);
    if (anim_speed > 0.001) {
      let w = sin(u.resolution_time.z * anim_speed * 3.14159) * 0.5 + 0.5;
      size = size * mix(1.0 - anim_amount * 0.5, 1.0 + anim_amount, w);
    }
    let pixel_size = max(vec2<f32>(1.0) / u.resolution_time.xy, vec2<f32>(size) / u.resolution_time.xy);
    let cell_id = floor(uv / pixel_size);
    let cell_uv = clamp((cell_id + vec2<f32>(0.5)) * pixel_size, vec2<f32>(0.0), vec2<f32>(1.0));
    let cell_local = clamp((uv - cell_id * pixel_size) / pixel_size, vec2<f32>(0.0), vec2<f32>(1.0));
    let sample0 = textureSampleLevel(source_tex, source_sampler, cell_uv, 0.0);
    var rgb = sample0.rgb;
    if (mode == 1u) {
      rgb = floor(sample0.rgb * vec3<f32>(4.0)) / vec3<f32>(3.0);
    } else if (mode == 2u) {
      let d = cell_local - vec2<f32>(0.5);
      let hex = max(abs(d.x), max(abs(d.y), abs(d.x) * 0.5 + abs(d.y) * 0.866));
      if (hex > 0.5) {
        rgb = vec3<f32>(0.0);
      }
    } else if (mode == 3u) {
      let disc = smoothstep(0.5, 0.45, length(cell_local - vec2<f32>(0.5)));
      rgb = sample0.rgb * disc;
    }
    if (grid_lines > 0.001) {
      let edge = abs(cell_local - vec2<f32>(0.5));
      let on_edge = step(0.46, max(edge.x, edge.y));
      rgb = rgb * mix(1.0, 0.0, on_edge * grid_lines);
    }
    return vec4<f32>(rgb, src.a);
  }
  if (code == 11u) {
    let softness = clamp(u.params0.x, 0.0, 2.0);
    let roundness = clamp(u.params0.y, 0.0, 1.0);
    let shape = u32(round(clamp(u.params0.z, 0.0, 3.0)));
    let aspect = max(0.0001, u.params0.w);
    let center = clamp(u.params1.xy, vec2<f32>(-2.0), vec2<f32>(3.0));
    let tint_amount = clamp(u.params1.z, 0.0, 1.0);
    let breathing = clamp(u.params1.w, 0.0, 1.0);
    let breath = sin(u.resolution_time.z * 0.5 * 6.28318) * 0.5 + 0.5;
    let effective_size = amount - breathing * 0.15 * (breath - 0.5);
    let pos = uv - center;
    var dist = 1.0;
    if (shape == 0u) {
      let rect_dist = max(abs(pos.x), abs(pos.y)) * 2.0;
      let circ_dist = length(pos) * 2.0;
      dist = mix(rect_dist, circ_dist, roundness);
    } else if (shape == 1u) {
      dist = length(vec2<f32>(pos.x / aspect, pos.y)) * 2.0;
    } else if (shape == 2u) {
      dist = max(abs(pos.x), abs(pos.y)) * 2.0;
    } else {
      let q = vec2<f32>(pos.x / aspect, pos.y) * 2.0;
      dist = pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25);
    }
    let vignette = 1.0 - smoothstep(effective_size - softness * 0.5, effective_size + softness * 0.5, dist);
    let tint = vec3<f32>(0.0);
    let final_rgb = mix(src.rgb, tint, (1.0 - vignette) * tint_amount);
    let final_alpha = src.a * mix(vignette, 1.0, tint_amount);
    return vec4<f32>(final_rgb, final_alpha);
  }
  if (code == 12u) {
    let angle = u.params0.x * 0.01745329252;
    let mode = u32(round(clamp(u.params0.y, 0.0, 4.0)));
    let center = clamp(u.params0.zw, vec2<f32>(0.0), vec2<f32>(1.0));
    let prism = clamp(u.params1.x, 0.0, 3.0);
    let px = max(vec2<f32>(1.0), u.resolution_time.xy);
    var dir = vec2<f32>(cos(angle), sin(angle));
    if (mode == 1u || mode == 2u) {
      let radial = uv - center;
      dir = normalize(radial + vec2<f32>(0.0001));
    } else if (mode == 3u) {
      let lum = luma(color);
      dir = normalize((uv - center) * (lum * 2.0 - 1.0) + vec2<f32>(0.0001));
    } else if (mode == 4u) {
      let tx = effect_texel();
      let gx = luma(sample_rgb(uv + vec2<f32>(tx.x, 0.0))) - luma(sample_rgb(uv - vec2<f32>(tx.x, 0.0)));
      let gy = luma(sample_rgb(uv + vec2<f32>(0.0, tx.y))) - luma(sample_rgb(uv - vec2<f32>(0.0, tx.y)));
      dir = normalize(vec2<f32>(gx, gy) + vec2<f32>(0.0001));
    }
    let spread = (amount * (1.0 + prism * 0.35)) / px;
    let off = dir * spread;
    let r = sample_rgb(uv + off).r;
    let g = sample_rgb(uv + off * 0.15).g;
    let b = sample_rgb(uv - off).b;
    return vec4<f32>(vec3<f32>(r, g, b), src.a);
  }
  if (code == 13u) {
    let count = max(1.0, u.params0.x);
    let speed = u.params0.y;
    let phosphor = clamp(u.params0.z, 0.0, 1.0);
    let rolling = clamp(u.params0.w, 0.0, 1.0);
    let curvature = clamp(u.params1.x, 0.0, 1.0);
    let interlace = clamp(u.params1.y, 0.0, 1.0);
    let p = uv * 2.0 - vec2<f32>(1.0);
    let curve_uv = clamp(uv + p * dot(p, p) * curvature * 0.08, vec2<f32>(0.0), vec2<f32>(1.0));
    var rgb = mix(color, sample_rgb(curve_uv), step(0.001, curvature));
    let scanline = sin((curve_uv.y * count + u.resolution_time.z * speed * 50.0) * 3.14159265) * 0.5 + 0.5;
    rgb *= 1.0 - clamp(amount, 0.0, 1.0) * scanline * 0.52;
    if (phosphor > 0.001) {
      let stripe = fract(curve_uv.x * u.resolution_time.x / 3.0);
      let mask = vec3<f32>(
        smoothstep(0.00, 0.18, stripe) * (1.0 - smoothstep(0.31, 0.39, stripe)),
        smoothstep(0.31, 0.40, stripe) * (1.0 - smoothstep(0.63, 0.72, stripe)),
        smoothstep(0.64, 0.73, stripe),
      );
      rgb *= mix(vec3<f32>(1.0), mask * 1.45, phosphor);
    }
    if (rolling > 0.001) {
      let bar = 1.0 - smoothstep(0.0, 0.28, abs(fract(curve_uv.y - u.resolution_time.z * 0.18) - 0.5));
      rgb *= 1.0 + bar * rolling * 0.35;
    }
    if (interlace > 0.001) {
      let field = fract((floor(curve_uv.y * u.resolution_time.y) + u.effect.w) * 0.5) * 2.0;
      rgb *= mix(1.0, mix(0.82, 1.08, field), interlace);
    }
    return vec4<f32>(rgb, src.a);
  }
  if (code == 14u) {
    let radius = max(0.0, amount);
    if (radius < 0.001) {
      return src;
    }
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let angle = u.params0.y * 0.01745329252;
    let edge_protect = clamp(u.params0.w, 0.0, 1.0);
    let wet = clamp(u.params1.x, 0.0, 1.0);
    let tx = effect_texel();
    var acc = color * 0.22;
    var wsum = 0.22;
    var dir_x = vec2<f32>(tx.x, 0.0);
    var dir_y = vec2<f32>(0.0, tx.y);
    if (mode == 2u) {
      let dir = vec2<f32>(cos(angle), sin(angle));
      dir_x = dir * tx * radius;
      dir_y = -dir_x;
    } else {
      dir_x *= radius;
      dir_y *= radius;
    }
    let diag_a = dir_x + dir_y;
    let diag_b = dir_x - dir_y;
    let samples = array<vec2<f32>, 8>(
      dir_x, -dir_x, dir_y, -dir_y,
      diag_a, -diag_a, diag_b, -diag_b,
    );
    for (var i = 0u; i < 8u; i = i + 1u) {
      let s = sample_rgb(uv + samples[i]);
      let dl = abs(luma(s) - luma(color));
      let edge_w = mix(1.0, 1.0 - smoothstep(0.05, 0.28, dl), edge_protect);
      let diag_w = select(0.095, 0.14, i < 4u);
      acc += s * diag_w * edge_w;
      wsum += diag_w * edge_w;
    }
    let blurred = acc / max(0.0001, wsum);
    return vec4<f32>(mix(color, blurred, wet), src.a);
  }
  if (code == 15u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let angle = u.params0.y * 0.01745329252;
    let center = clamp(u.params0.zw, vec2<f32>(0.0), vec2<f32>(1.0));
    let edge_falloff = clamp(u.params1.x, 0.0, 1.0);
    let wet = clamp(u.params1.y, 0.0, 1.0);
    var dir = vec2<f32>(cos(angle), sin(angle));
    let radial = uv - center;
    if (mode == 1u || mode == 2u) {
      dir = normalize(radial + vec2<f32>(0.0001));
    } else if (mode == 3u) {
      dir = normalize(vec2<f32>(radial.x * 0.35 + radial.y, radial.y * 0.35 - radial.x) + vec2<f32>(0.0001));
    }
    let dist = clamp(length(radial) * 1.4142, 0.0, 1.0);
    let edge_gain = mix(1.0, smoothstep(0.05, 1.0, dist), edge_falloff);
    let px_amount = amount * mix(18.0, 40.0, step(2.0, f32(mode))) * edge_gain;
    let off = dir * (px_amount / max(vec2<f32>(1.0), u.resolution_time.xy));
    let shifted = vec3<f32>(
      sample_rgb(uv + off).r,
      sample_rgb(uv).g,
      sample_rgb(uv - off).b,
    );
    return vec4<f32>(mix(color, shifted, wet), src.a);
  }
  if (code == 16u) {
    let intensity = clamp(amount, 0.0, 1.0);
    let speed = max(0.0, u.params0.x);
    let block_size = clamp(u.params0.y, 0.0, 1.0);
    let rgb_split = clamp(u.params0.z, 0.0, 1.0);
    let jitter = clamp(u.params0.w, 0.0, 1.0);
    let vertical_slice = clamp(u.params1.x, 0.0, 1.0);
    let block_hold = clamp(u.params1.y, 0.0, 1.0);
    let tear_chance = clamp(u.params1.z, 0.0, 1.0);
    let t = floor(u.resolution_time.z * mix(8.0, 28.0, speed) / max(0.08, block_hold + 0.08));
    let row_count = mix(12.0, 96.0, 1.0 - block_size);
    let row = floor(uv.y * row_count);
    let block = vec2<f32>(row, t);
    let row_hit = step(1.0 - intensity * 0.45, hash21(block));
    let tear_hit = step(1.0 - tear_chance * intensity, hash21(block + vec2<f32>(19.1, 4.7)));
    let slice_gate = mix(1.0, step(0.5, hash21(vec2<f32>(floor(uv.x * 10.0), t + 3.0))), vertical_slice);
    let shift = (hash21(block + vec2<f32>(2.7, 8.3)) - 0.5) * 0.18 * intensity * row_hit * slice_gate;
    let fine = (value_noise2d(vec2<f32>(uv.y * 160.0, t)) - 0.5) * 0.025 * jitter * intensity;
    let tear = tear_hit * intensity * 0.08 * sign(hash21(block + vec2<f32>(7.0, 11.0)) - 0.5);
    let warped_uv = uv + vec2<f32>(shift + fine + tear, 0.0);
    let split = rgb_split * intensity * (0.004 + row_hit * 0.018 + tear_hit * 0.04);
    let r = sample_rgb(warped_uv + vec2<f32>(split, 0.0)).r;
    let g = sample_rgb(warped_uv).g;
    let b = sample_rgb(warped_uv - vec2<f32>(split, 0.0)).b;
    var rgb = vec3<f32>(r, g, b);
    let block_noise = (hash21(floor(warped_uv * vec2<f32>(24.0, row_count)) + vec2<f32>(t)) - 0.5) * intensity * row_hit;
    rgb += block_noise * vec3<f32>(0.22, -0.04, 0.18);
    return vec4<f32>(mix(color, rgb, intensity), src.a);
  }
  return src;
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
  let effected = apply_effect(src, uv);
  let mixed = mix(src, effected, clamp(u.effect.z, 0.0, 1.0));
  return vec4<f32>(saturate3(mixed.rgb), clamp(mixed.a, 0.0, 1.0));
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

export function buildNativeEffectPassPrecompileCommands(): NativeEffectPassPrecompileCommand[] {
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
  let param0 = clampNumber(params.scale ?? params.param0 ?? params.mode ?? 0.42, 0, 64, 0.42);
  let param1 = clampNumber(params.seed ?? params.param1 ?? params.gridLines ?? 0, -100000, 100000, 0);
  let param2 = clampNumber(params.param2 ?? params.animSpeed ?? 0, -100000, 100000, 0);
  let param3 = clampNumber(params.param3 ?? params.animAmount ?? 0, -100000, 100000, 0);
  let param4 = clampNumber(params.param4 ?? params.centerX ?? 0, -100000, 100000, 0);
  let param5 = clampNumber(params.param5 ?? params.centerY ?? 0, -100000, 100000, 0);
  let param6 = clampNumber(params.param6 ?? params.tintAmount ?? 0, -100000, 100000, 0);
  let param7 = clampNumber(params.param7 ?? params.breathing ?? 0, -100000, 100000, 0);

  if (options.effect === 'vignette') {
    param0 = clampNumber(params.softness ?? params.param0, 0, 2, 0.4);
    param1 = clampNumber(params.roundness ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.shape ?? params.param2, 0, 3, 0);
    param3 = clampNumber(params.aspect ?? params.param3, 0.1, 4, 1);
    param4 = clampNumber(params.centerX ?? params.param4, -2, 3, 0.5);
    param5 = clampNumber(params.centerY ?? params.param5, -2, 3, 0.5);
    param6 = clampNumber(params.tintAmount ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.breathing ?? params.param7, 0, 1, 0);
  } else if (options.effect === 'rgb-shift') {
    param0 = clampNumber(params.angle ?? params.param0, 0, 360, 0);
    param1 = clampNumber(params.mode ?? params.param1, 0, 4, 0);
    param2 = clampNumber(params.centerX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.centerY ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.prismSpread ?? params.param4, 0, 3, 1);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'scanlines') {
    param0 = clampNumber(params.count ?? params.param0, 1, 1200, 200);
    param1 = clampNumber(params.speed ?? params.param1, -4, 4, 0);
    param2 = clampNumber(params.phosphor ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.rollingBar ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.curvature ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.interlace ?? params.param5, 0, 1, 0);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'blur') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 1);
    param1 = clampNumber(params.angle ?? params.param1, 0, 360, 0);
    param2 = clampNumber(params.param2, 0, 2, 1);
    param3 = clampNumber(params.edgeProtect ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.outputMix ?? params.param4, 0, 1, 1);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'chromatic-aberration') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 1);
    param1 = clampNumber(params.angle ?? params.param1, 0, 360, 0);
    param2 = clampNumber(params.centerX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.centerY ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.edgeFalloff ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.outputMix ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'glitch') {
    param0 = clampNumber(params.speed ?? params.param0, 0, 4, 1);
    param1 = clampNumber(params.blockSize ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.rgbSplit ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.jitter ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.verticalSlice ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.blockHold ?? params.param5, 0, 1, 0.3);
    param6 = clampNumber(params.tearChance ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.triggerMode ?? params.param7, 0, 3, 0);
  }
  return [
    width,
    height,
    time,
    frameDelta,
    manifest.code,
    amount,
    mix,
    frameIndex,
    param0,
    param1,
    param2,
    param3,
    param4,
    param5,
    param6,
    param7,
  ];
}

function buildNativeEffectPassRenderPass(
  options: NativeEffectPassOptions,
  manifest: NativeEffectPassManifestEntry,
  uniformId: string,
  nameSuffix = '',
): Record<string, unknown> {
  return {
    name: `effect-pass-${manifest.id}${nameSuffix}`,
    shader_id: NATIVE_EFFECT_PASS_SHADER_ID,
    target: 'source_frame',
    source_id: options.targetSourceId,
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
  };
}

export function buildNativeEffectPassGraph(options: NativeEffectPassOptions): NativeEffectPassGraph {
  const manifest = nativeEffectPassManifestEntry(options.effect);
  const targetSourceId = options.targetSourceId || `${options.sourceId}:effect:${options.effect}`;
  const safeTarget = safeGraphId(targetSourceId);
  const uniformId = `effect-pass:${safeTarget}:uniform`;
  const renderOptions = { ...options, targetSourceId };
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
      render_passes: [buildNativeEffectPassRenderPass(renderOptions, manifest, uniformId)],
    },
  };
}

export function buildNativeEffectPassChainGraph(options: NativeEffectPassChainOptions): NativeEffectPassGraph {
  const effects = options.effects.filter((effect) => effect && NATIVE_EFFECT_PASS_BY_ID.has(effect.effect));
  if (!effects.length) {
    throw new Error('Native effect-pass chain requires at least one supported effect');
  }
  if (effects.length === 1) {
    return buildNativeEffectPassGraph({
      ...options,
      effect: effects[0].effect,
      amount: effects[0].amount,
      mix: effects[0].mix,
      params: effects[0].params,
    });
  }

  const buffers: Array<Record<string, unknown>> = [];
  const renderPasses: Array<Record<string, unknown>> = [];
  const finalTargetSourceId = options.targetSourceId || `${options.sourceId}:effect:${effects[effects.length - 1].effect}`;
  const safeFinalTarget = safeGraphId(finalTargetSourceId);
  const intermediatePrefix = safeGraphId(options.intermediatePrefix || `${finalTargetSourceId}:chain`);
  let currentSourceId = options.sourceId;

  effects.forEach((effect, index) => {
    const manifest = nativeEffectPassManifestEntry(effect.effect);
    const targetSourceId = index === effects.length - 1
      ? finalTargetSourceId
      : `${intermediatePrefix}:step:${index}`;
    const uniformId = `effect-pass:${safeFinalTarget}:pass:${index}:uniform`;
    const passOptions: NativeEffectPassOptions = {
      ...options,
      sourceId: currentSourceId,
      targetSourceId,
      effect: effect.effect,
      amount: effect.amount,
      mix: effect.mix,
      params: effect.params,
      seq: Math.max(0, Math.round(options.seq ?? options.frameIndex ?? 0)) + index,
    };
    buffers.push({
      id: uniformId,
      kind: 'uniform',
      byte_length: 64,
      initial_f32: packNativeEffectPassUniforms(passOptions),
    });
    renderPasses.push(buildNativeEffectPassRenderPass(passOptions, manifest, uniformId, `-${index + 1}`));
    currentSourceId = targetSourceId;
  });

  return {
    effect: effects[0].effect,
    effects: effects.map((effect) => effect.effect),
    config: {
      buffers,
      passes: [],
      readbacks: [],
      render_passes: renderPasses,
    },
  };
}
