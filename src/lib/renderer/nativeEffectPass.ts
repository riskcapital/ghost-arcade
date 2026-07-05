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
  | 'glitch'
  | 'exposure'
  | 'vibrance'
  | 'temperature-tint'
  | 'sharpen'
  | 'directional-blur'
  | 'zoom-blur'
  | 'radial-blur'
  | 'kaleidoscope'
  | 'mirror'
  | 'chroma-key'
  | 'luma-key'
  | 'difference-key'
  | 'erode'
  | 'dilate'
  | 'wave'
  | 'fisheye'
  | 'lens-distortion'
  | 'twirl'
  | 'pinch-bulge'
  | 'edge-detect'
  | 'film-grain'
  | 'filmic-tonemap'
  | 'bloom'
  | 'colorama'
  | 'edge-feather'
  | 'dither'
  | 'outline'
  | 'emboss'
  | 'crt'
  | 'thermal'
  | 'night-vision';

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
    amount: number;
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
    exposure: number;
    rollOff: number;
    highlightProtect: number;
    vibrance: number;
    skinProtect: number;
    ceiling: number;
    temperature: number;
    tint: number;
    shadowTemp: number;
    highlightTemp: number;
    splitTone: number;
    autoCycle: number;
    prismSpread: number;
    outputMix: number;
    samples: number;
    falloff: number;
    centerBias: number;
    chromatic: number;
    radiusInner: number;
    radiusOuter: number;
    segments: number;
    zoom: number;
    spiral: number;
    position: number;
    offset: number;
    flipSide: number;
    keyR: number;
    keyG: number;
    keyB: number;
    tolerance: number;
    lowCut: number;
    highCut: number;
    gamma: number;
    invert: number;
    matte: number;
    premultiply: number;
    refR: number;
    refG: number;
    refB: number;
    spill: number;
    channel: number;
    frequency: number;
    waveform: number;
    phase: number;
    secondary: number;
    chromaSplit: number;
    strength: number;
    contrast: number;
    edgeFade: number;
    cubic: number;
    anamorphicX: number;
    palette: number;
    height: number;
    glow: number;
    noise: number;
    vignette: number;
    bloom: number;
    scopeMask: number;
    threshold: number;
    thickness: number;
    edgeTintR: number;
    edgeTintG: number;
    edgeTintB: number;
    tintEdges: number;
    edgeGlow: number;
    edgeOnlyAlpha: number;
    bloomIntensity: number;
    bloomKnee: number;
    bloomRadius: number;
    bloomAnamorphic: number;
    red: number;
    green: number;
    blue: number;
    grainSize: number;
    grainShadow: number;
    grainMid: number;
    grainHigh: number;
    grainMono: number;
    grainStock: number;
    grainColorJitter: number;
    grainAnimSpeed: number;
    tonemapCurve: number;
    tonemapExposure: number;
    tonemapContrast: number;
    tonemapMix: number;
    coloramaPalette: number;
    coloramaOffset: number;
    coloramaSpeed: number;
    coloramaContrast: number;
    coloramaMix: number;
    coloramaBands: number;
    coloramaAudioReact: number;
    coloramaHueShift: number;
    audio: number;
    featherTop: number;
    featherBottom: number;
    featherLeft: number;
    featherRight: number;
    featherSoftness: number;
    featherGamma: number;
    featherMattePreview: number;
    ditherType: number;
    ditherIntensity: number;
    ditherScale: number;
    ditherColorDepth: number;
    ditherPalette: number;
    ditherPixelLock: number;
    outlineThickness: number;
    outlineR: number;
    outlineG: number;
    outlineB: number;
    outlineOnly: number;
    outlineGlow: number;
    outlinePosition: number;
    outlineCrawl: number;
    outlineAlphaAware: number;
    embossStrength: number;
    embossAngle: number;
    embossHeight: number;
    embossHighlightR: number;
    embossHighlightG: number;
    embossHighlightB: number;
    embossShadowR: number;
    embossShadowG: number;
    embossShadowB: number;
    crtScanlines: number;
    crtScanCount: number;
    crtMask: number;
    crtMaskType: number;
    crtCurvature: number;
    crtVignette: number;
    crtGlow: number;
    crtRollingBar: number;
    crtChromatic: number;
    thermalIntensity: number;
    thermalPalette: number;
    thermalShimmer: number;
    thermalSensorNoise: number;
    nightVisionIntensity: number;
    nightVisionNoise: number;
    nightVisionVignette: number;
    nightVisionPhosphor: number;
    nightVisionBloom: number;
    nightVisionScopeMask: number;
    nightVisionRollingNoise: number;
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
  { id: 'exposure', code: 17, defaultAmount: 0, amountMin: -4, amountMax: 4 },
  { id: 'vibrance', code: 18, defaultAmount: 0.3, amountMin: -1, amountMax: 2 },
  { id: 'temperature-tint', code: 19, defaultAmount: 0, amountMin: -1, amountMax: 1 },
  { id: 'sharpen', code: 20, defaultAmount: 0.5, amountMin: 0, amountMax: 3 },
  { id: 'directional-blur', code: 21, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'zoom-blur', code: 22, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'radial-blur', code: 23, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'kaleidoscope', code: 24, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'mirror', code: 25, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'chroma-key', code: 26, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'luma-key', code: 27, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'difference-key', code: 28, defaultAmount: 0.3, amountMin: 0, amountMax: 1 },
  { id: 'erode', code: 29, defaultAmount: 2, amountMin: 1, amountMax: 8 },
  { id: 'dilate', code: 30, defaultAmount: 2, amountMin: 1, amountMax: 8 },
  { id: 'wave', code: 31, defaultAmount: 10, amountMin: 0, amountMax: 50 },
  { id: 'fisheye', code: 32, defaultAmount: 0.5, amountMin: -1, amountMax: 1 },
  { id: 'lens-distortion', code: 33, defaultAmount: 0.4, amountMin: -1, amountMax: 1 },
  { id: 'twirl', code: 34, defaultAmount: 1.5, amountMin: -6.28319, amountMax: 6.28319 },
  { id: 'pinch-bulge', code: 35, defaultAmount: 0.4, amountMin: -1, amountMax: 1 },
  { id: 'edge-detect', code: 36, defaultAmount: 0.1, amountMin: 0, amountMax: 1 },
  { id: 'film-grain', code: 37, defaultAmount: 0.3, amountMin: 0, amountMax: 1 },
  { id: 'filmic-tonemap', code: 38, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'bloom', code: 39, defaultAmount: 0.6, amountMin: 0, amountMax: 1 },
  { id: 'colorama', code: 40, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'edge-feather', code: 41, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'dither', code: 42, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'outline', code: 43, defaultAmount: 2, amountMin: 0, amountMax: 12 },
  { id: 'emboss', code: 44, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'crt', code: 45, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'thermal', code: 46, defaultAmount: 1, amountMin: 0.05, amountMax: 2 },
  { id: 'night-vision', code: 47, defaultAmount: 1.5, amountMin: 0, amountMax: 2 },
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

fn rotate2d(value: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(value.x * c - value.y * s, value.x * s + value.y * c);
}

fn rgb_to_ycbcr(c: vec3<f32>) -> vec3<f32> {
  let y = dot(c, vec3<f32>(0.299, 0.587, 0.114));
  let cb = -0.169 * c.r - 0.331 * c.g + 0.5 * c.b;
  let cr = 0.5 * c.r - 0.419 * c.g - 0.081 * c.b;
  return vec3<f32>(y, cb, cr);
}

fn hue_value(c: vec3<f32>) -> f32 {
  let maxc = max(c.r, max(c.g, c.b));
  let minc = min(c.r, min(c.g, c.b));
  let delta = maxc - minc;
  if (delta <= 0.00001) {
    return 0.0;
  }
  var hue = 0.0;
  if (maxc == c.r) {
    hue = (c.g - c.b) / delta;
  } else if (maxc == c.g) {
    hue = 2.0 + (c.b - c.r) / delta;
  } else {
    hue = 4.0 + (c.r - c.g) / delta;
  }
  return fract(hue / 6.0);
}

fn saturation_value(c: vec3<f32>) -> f32 {
  let maxc = max(c.r, max(c.g, c.b));
  let minc = min(c.r, min(c.g, c.b));
  return clamp((maxc - minc) / max(0.0001, maxc), 0.0, 1.0);
}

fn channel_value(c: vec4<f32>, channel: u32) -> f32 {
  if (channel == 1u) {
    return c.r;
  }
  if (channel == 2u) {
    return c.g;
  }
  if (channel == 3u) {
    return c.b;
  }
  if (channel == 4u) {
    return c.a;
  }
  return luma(c.rgb);
}

fn wave_signal(value: f32, waveform: u32) -> f32 {
  if (waveform == 1u) {
    return abs(fract(value / 6.28318530718 + 0.25) * 4.0 - 2.0) - 1.0;
  }
  if (waveform == 2u) {
    return fract(value / 6.28318530718) * 2.0 - 1.0;
  }
  if (waveform == 3u) {
    if (sin(value) >= 0.0) {
      return 1.0;
    }
    return -1.0;
  }
  return sin(value);
}

fn tonemap_aces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + vec3<f32>(0.03))) / (x * (2.43 * x + vec3<f32>(0.59)) + vec3<f32>(0.14)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tonemap_reinhard(x: vec3<f32>) -> vec3<f32> {
  return x / (vec3<f32>(1.0) + x);
}

fn tonemap_hable(x: vec3<f32>) -> vec3<f32> {
  let A = 0.15;
  let B = 0.50;
  let C = 0.10;
  let D = 0.20;
  let E = 0.02;
  let F = 0.30;
  let W = 11.2;
  let n = ((x * (A * x + vec3<f32>(C * B)) + vec3<f32>(D * E)) / (x * (A * x + vec3<f32>(B)) + vec3<f32>(D * F))) - vec3<f32>(E / F);
  let wn = ((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F;
  return clamp(n / vec3<f32>(wn), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tonemap_scurve(x: vec3<f32>) -> vec3<f32> {
  let t = smoothstep(vec3<f32>(0.0), vec3<f32>(1.0), x);
  return t * t * (vec3<f32>(3.0) - vec3<f32>(2.0) * t);
}

fn bloom_threshold_knee(col: vec3<f32>, threshold: f32, knee: f32) -> vec3<f32> {
  let br = max(col.r, max(col.g, col.b));
  let knee_amt = max(knee, 0.0001);
  var soft = clamp(br - threshold + knee_amt, 0.0, 2.0 * knee_amt);
  soft = soft * soft / (4.0 * knee_amt + 0.00001);
  let contribution = max(soft, br - threshold) / max(br, 0.00001);
  return col * contribution;
}

fn bloom_ring_sample(uv: vec2<f32>, px: vec2<f32>, radius: f32, anamorphic: f32) -> vec3<f32> {
  let aniso = clamp(anamorphic, 0.0, 1.0);
  let r = px * radius * vec2<f32>(1.0, 1.0 - aniso * 0.92);
  var acc = vec3<f32>(0.0);
  acc += sample_rgb(uv + r * vec2<f32>( 1.0,  0.0));
  acc += sample_rgb(uv + r * vec2<f32>(-1.0,  0.0));
  acc += sample_rgb(uv + r * vec2<f32>( 0.7,  0.7));
  acc += sample_rgb(uv + r * vec2<f32>(-0.7,  0.7));
  acc += sample_rgb(uv + r * vec2<f32>( 0.7, -0.7));
  acc += sample_rgb(uv + r * vec2<f32>(-0.7, -0.7));
  acc += sample_rgb(uv + r * vec2<f32>( 0.0,  1.0));
  acc += sample_rgb(uv + r * vec2<f32>( 0.0, -1.0));
  acc += sample_rgb(uv + r * vec2<f32>( 1.7,  0.0));
  acc += sample_rgb(uv + r * vec2<f32>(-1.7,  0.0));
  acc += sample_rgb(uv + r * vec2<f32>( 0.0,  1.7));
  acc += sample_rgb(uv + r * vec2<f32>( 0.0, -1.7));
  acc += sample_rgb(uv);
  return acc / 13.0;
}

fn colorama_cosine_palette(t: f32, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, d: vec3<f32>) -> vec3<f32> {
  return a + b * cos(6.28318530718 * (c * t + d));
}

fn colorama_palette(t: f32, palette: u32, hue_shift: f32) -> vec3<f32> {
  var a = vec3<f32>(0.5, 0.5, 0.5);
  var b = vec3<f32>(0.5, 0.5, 0.5);
  var c = vec3<f32>(1.0, 1.0, 1.0);
  var d = vec3<f32>(0.0, 0.33, 0.67);

  if (palette == 1u) {
    d = vec3<f32>(0.0, 0.1, 0.2);
  } else if (palette == 2u) {
    d = vec3<f32>(0.3, 0.2, 0.2);
  } else if (palette == 3u) {
    c = vec3<f32>(1.0, 1.0, 0.5);
    d = vec3<f32>(0.8, 0.9, 0.3);
  } else if (palette == 4u) {
    c = vec3<f32>(1.0, 0.7, 0.4);
    d = vec3<f32>(0.0, 0.15, 0.2);
  } else if (palette == 5u) {
    d = vec3<f32>(0.0, 0.1, 0.0);
  } else if (palette == 6u) {
    a = vec3<f32>(0.8, 0.8, 0.9);
    b = vec3<f32>(0.2, 0.4, 0.2);
    d = vec3<f32>(0.0, 0.25, 0.25);
  } else if (palette == 7u) {
    c = vec3<f32>(2.0, 1.0, 0.0);
    d = vec3<f32>(0.5, 0.2, 0.25);
  } else if (palette == 8u) {
    a = vec3<f32>(0.6, 0.4, 0.7);
    b = vec3<f32>(0.4, 0.4, 0.4);
    c = vec3<f32>(1.0, 1.0, 0.5);
    d = vec3<f32>(0.0, 0.15, 0.50);
  } else if (palette == 9u) {
    a = vec3<f32>(0.55, 0.45, 0.55);
    b = vec3<f32>(0.55, 0.5, 0.5);
    c = vec3<f32>(1.5, 1.5, 1.0);
    d = vec3<f32>(0.0, 0.5, 0.85);
  } else if (palette == 10u) {
    a = vec3<f32>(0.85, 0.8, 0.85);
    b = vec3<f32>(0.15, 0.18, 0.15);
    d = vec3<f32>(0.0, 0.33, 0.67);
  } else if (palette == 11u) {
    let h = fract1(hue_shift);
    d = vec3<f32>(h, h + 0.33, h + 0.67);
  }

  return colorama_cosine_palette(t, a, b, c, d);
}

fn dither_palette_snap(c: vec3<f32>, palette: u32) -> vec3<f32> {
  let lum = luma(c);
  if (palette == 1u) {
    let v = select(0.0, 1.0, lum >= 0.5);
    return vec3<f32>(v);
  }
  if (palette == 2u) {
    if (lum < 0.25) { return vec3<f32>(0.0, 0.0, 0.0); }
    if (lum < 0.5) { return vec3<f32>(0.0, 1.0, 1.0); }
    if (lum < 0.75) { return vec3<f32>(1.0, 0.0, 1.0); }
    return vec3<f32>(1.0, 1.0, 1.0);
  }
  if (palette == 3u) {
    let levels = vec3<f32>(2.0, 2.0, 1.0);
    return floor(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)) * levels + vec3<f32>(0.5)) / max(levels, vec3<f32>(1.0));
  }
  if (palette == 4u) {
    if (lum < 0.25) { return vec3<f32>(0.05, 0.10, 0.03); }
    if (lum < 0.5) { return vec3<f32>(0.19, 0.38, 0.19); }
    if (lum < 0.75) { return vec3<f32>(0.55, 0.67, 0.32); }
    return vec3<f32>(0.80, 0.86, 0.55);
  }
  if (palette == 5u) {
    return vec3<f32>(lum * 1.25, lum * 0.72, lum * 0.18);
  }
  return c;
}

fn dither_threshold(kind: u32, cell: vec2<f32>, uv: vec2<f32>, color: vec3<f32>) -> f32 {
  if (kind == 1u) {
    return hash21(floor(cell * vec2<f32>(0.7, 1.3)) + vec2<f32>(19.0, 3.0));
  }
  if (kind == 2u) {
    let centered = fract(cell * 0.5) - vec2<f32>(0.5);
    return smoothstep(0.08, 0.48, length(centered));
  }
  if (kind == 3u) {
    let a = hash21(cell + vec2<f32>(0.0, 0.0));
    let b = hash21(cell + vec2<f32>(1.0, 0.0));
    let c = hash21(cell + vec2<f32>(0.0, 1.0));
    return (a * 0.55 + b * 0.25 + c * 0.20);
  }
  if (kind == 4u) {
    let n = hash21(floor(cell * 0.5) + vec2<f32>(luma(color) * 7.0, 11.0));
    return mix(fract(cell.x * 0.37 + cell.y * 0.63), n, 0.55);
  }
  let p = floor(cell);
  let base = fract(p.x * 0.125 + p.y * 0.375 + p.x * p.y * 0.0625);
  return mix(base, hash21(p), 0.28);
}

fn thermal_palette_native(t: f32, palette: u32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  if (palette == 1u) {
    if (x < 0.18) { return mix(vec3<f32>(0.0), vec3<f32>(0.28, 0.0, 0.45), x / 0.18); }
    if (x < 0.38) { return mix(vec3<f32>(0.28, 0.0, 0.45), vec3<f32>(0.0, 0.35, 1.0), (x - 0.18) / 0.20); }
    if (x < 0.62) { return mix(vec3<f32>(0.0, 0.35, 1.0), vec3<f32>(0.0, 1.0, 0.55), (x - 0.38) / 0.24); }
    if (x < 0.82) { return mix(vec3<f32>(0.0, 1.0, 0.55), vec3<f32>(1.0, 0.65, 0.0), (x - 0.62) / 0.20); }
    return mix(vec3<f32>(1.0, 0.65, 0.0), vec3<f32>(1.0), (x - 0.82) / 0.18);
  }
  if (palette == 2u) {
    if (x < 0.35) { return mix(vec3<f32>(1.0), vec3<f32>(0.35, 1.0, 1.0), x / 0.35); }
    if (x < 0.70) { return mix(vec3<f32>(0.35, 1.0, 1.0), vec3<f32>(0.0, 0.25, 1.0), (x - 0.35) / 0.35); }
    return mix(vec3<f32>(0.0, 0.25, 1.0), vec3<f32>(1.0, 0.0, 0.65), (x - 0.70) / 0.30);
  }
  if (palette == 3u) {
    if (x < 0.30) { return mix(vec3<f32>(0.0, 0.05, 0.0), vec3<f32>(0.0, 0.62, 0.12), x / 0.30); }
    if (x < 0.62) { return mix(vec3<f32>(0.0, 0.62, 0.12), vec3<f32>(0.95, 0.82, 0.0), (x - 0.30) / 0.32); }
    if (x < 0.86) { return mix(vec3<f32>(0.95, 0.82, 0.0), vec3<f32>(0.95, 0.22, 0.04), (x - 0.62) / 0.24); }
    return mix(vec3<f32>(0.95, 0.22, 0.04), vec3<f32>(1.0, 0.0, 0.65), (x - 0.86) / 0.14);
  }
  if (palette == 4u) {
    return vec3<f32>(x);
  }
  if (x < 0.2) { return mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(0.0, 0.5, 1.0), x * 5.0); }
  if (x < 0.4) { return mix(vec3<f32>(0.0, 0.5, 1.0), vec3<f32>(0.0, 1.0, 0.0), (x - 0.2) * 5.0); }
  if (x < 0.6) { return mix(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), (x - 0.4) * 5.0); }
  if (x < 0.8) { return mix(vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), (x - 0.6) * 5.0); }
  return mix(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0), (x - 0.8) * 5.0);
}

fn night_vision_tint(lum: f32, phosphor: u32) -> vec3<f32> {
  if (phosphor == 1u) {
    return vec3<f32>(lum, lum * 0.65, lum * 0.15);
  }
  if (phosphor == 2u) {
    return vec3<f32>(lum);
  }
  return vec3<f32>(lum * 0.2, lum, lum * 0.2);
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
  if (code == 17u) {
    let rolloff = clamp(u.params0.x, 0.0, 1.0);
    let protect = clamp(u.params0.y, 0.0, 1.0);
    let gain = pow(2.0, amount);
    let exposed = color * gain;
    let compressed = exposed / (vec3<f32>(1.0) + exposed * rolloff);
    let highlight = smoothstep(0.55, 1.05, luma(color));
    let protected_color = mix(exposed, compressed, rolloff);
    return vec4<f32>(mix(protected_color, color, protect * highlight), src.a);
  }
  if (code == 18u) {
    let skin_protect = clamp(u.params0.x, 0.0, 1.0);
    let highlight_protect = clamp(u.params0.y, 0.0, 1.0);
    let ceiling = max(0.05, u.params0.z);
    let gray = vec3<f32>(luma(color));
    let maxc = max(color.r, max(color.g, color.b));
    let minc = min(color.r, min(color.g, color.b));
    let sat = clamp((maxc - minc) / max(0.001, maxc), 0.0, 1.0);
    let warm_skin = smoothstep(0.25, 0.75, color.r - color.b) * smoothstep(0.08, 0.45, color.g);
    let high = smoothstep(0.62, 1.05, luma(color));
    let protect = (1.0 - skin_protect * warm_skin) * (1.0 - highlight_protect * high);
    let boost = amount * (1.0 - sat) * protect;
    let vibrant = gray + (color - gray) * (1.0 + boost);
    return vec4<f32>(min(max(vibrant, vec3<f32>(0.0)), vec3<f32>(ceiling)), src.a);
  }
  if (code == 19u) {
    let tint = clamp(u.params0.x, -1.0, 1.0);
    let shadow_temp = clamp(u.params0.y, -1.0, 1.0);
    let highlight_temp = clamp(u.params0.z, -1.0, 1.0);
    let split_tone = clamp(u.params0.w, 0.0, 1.0);
    let auto_cycle = clamp(u.params1.x, 0.0, 1.0);
    let cycle = sin(u.resolution_time.z * 0.18 * 6.28318) * auto_cycle;
    let temp = clamp(amount + cycle, -1.0, 1.0);
    let warmth = vec3<f32>(0.16, 0.055, -0.14);
    let magenta_green = vec3<f32>(0.08, -0.12, 0.08);
    let lum = luma(color);
    let shadow_mask = 1.0 - smoothstep(0.18, 0.58, lum);
    let high_mask = smoothstep(0.45, 0.92, lum);
    let split = warmth * (shadow_temp * shadow_mask + highlight_temp * high_mask) * split_tone;
    let corrected = color + warmth * temp + magenta_green * tint + split;
    return vec4<f32>(max(corrected, vec3<f32>(0.0)), src.a);
  }
  if (code == 20u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 1.0)));
    let radius = max(1.0, u.params0.y);
    let edge_protect = clamp(u.params0.z, 0.0, 1.0);
    let clarity = clamp(u.params0.w, 0.0, 1.0);
    let tx = effect_texel() * radius;
    let north = sample_rgb(uv + vec2<f32>(0.0, tx.y));
    let south = sample_rgb(uv - vec2<f32>(0.0, tx.y));
    let east = sample_rgb(uv + vec2<f32>(tx.x, 0.0));
    let west = sample_rgb(uv - vec2<f32>(tx.x, 0.0));
    let avg = (north + south + east + west) * 0.25;
    let detail = color - avg;
    let edge_weight = mix(1.0, smoothstep(0.015, 0.22, length(detail)), edge_protect);
    var mode_gain = 1.0;
    if (mode == 1u) {
      mode_gain = 0.68;
    }
    let sharpened = color + detail * amount * 2.4 * mode_gain * edge_weight;
    let clarity_rgb = (sharpened - vec3<f32>(0.5)) * (1.0 + clarity * 0.55) + vec3<f32>(0.5);
    return vec4<f32>(clarity_rgb, src.a);
  }
  if (code == 21u) {
    let angle = u.params0.x * 0.01745329252;
    let samples = clamp(u.params0.y, 4.0, 32.0);
    let falloff = clamp(u.params0.z, 0.0, 1.0);
    let center_bias = clamp(u.params0.w, 0.0, 1.0);
    let wet = clamp(u.params1.x, 0.0, 1.0);
    let dir = vec2<f32>(cos(angle), sin(angle));
    let reach = amount * 72.0 / max(u.resolution_time.xy, vec2<f32>(1.0));
    var acc = color * (1.0 + center_bias * 2.0);
    var wsum = 1.0 + center_bias * 2.0;
    for (var i = 0u; i < 12u; i = i + 1u) {
      let fi = f32(i) - 5.5;
      let norm = abs(fi) / 6.0;
      let sample_enabled = step(norm * 12.0, samples);
      let weight = sample_enabled * mix(1.0, 1.0 - norm, falloff);
      let sample_uv = uv + dir * reach * fi / 6.0;
      acc += sample_rgb(sample_uv) * weight;
      wsum += weight;
    }
    let blurred = acc / max(0.0001, wsum);
    return vec4<f32>(mix(color, blurred, wet), src.a);
  }
  if (code == 22u) {
    let center = clamp(u.params0.xy, vec2<f32>(0.0), vec2<f32>(1.0));
    let samples = clamp(u.params0.z, 4.0, 32.0);
    let falloff = clamp(u.params0.w, 0.0, 1.0);
    let chromatic = clamp(u.params1.x, 0.0, 1.0);
    let wet = clamp(u.params1.y, 0.0, 1.0);
    let dir = uv - center;
    var acc = color;
    var wsum = 1.0;
    for (var i = 1u; i <= 12u; i = i + 1u) {
      let fi = f32(i);
      let norm = fi / 12.0;
      let sample_enabled = step(norm * 24.0, samples);
      let weight = sample_enabled * mix(1.0, 1.0 - norm, falloff);
      let offset = dir * amount * norm * 0.62;
      let sample_uv = uv - offset;
      var sample_col = sample_rgb(sample_uv);
      if (chromatic > 0.001) {
        let c_off = offset * chromatic * 0.18;
        sample_col = vec3<f32>(
          sample_rgb(sample_uv + c_off).r,
          sample_col.g,
          sample_rgb(sample_uv - c_off).b,
        );
      }
      acc += sample_col * weight;
      wsum += weight;
    }
    let blurred = acc / max(0.0001, wsum);
    return vec4<f32>(mix(color, blurred, wet), src.a);
  }
  if (code == 23u) {
    let center = clamp(u.params0.xy, vec2<f32>(0.0), vec2<f32>(1.0));
    let samples = clamp(u.params0.z, 4.0, 32.0);
    let falloff = clamp(u.params0.w, 0.0, 1.0);
    let radius_inner = clamp(u.params1.x, 0.0, 1.0);
    let radius_outer = max(radius_inner + 0.001, clamp(u.params1.y, 0.001, 1.5));
    let wet = clamp(u.params1.z, 0.0, 1.0);
    let radial = uv - center;
    let dist = length(radial) * 1.4142;
    let mask = smoothstep(radius_inner, radius_outer, dist);
    var acc = color;
    var wsum = 1.0;
    for (var i = 0u; i < 12u; i = i + 1u) {
      let fi = f32(i) - 5.5;
      let norm = abs(fi) / 6.0;
      let sample_enabled = step(norm * 12.0, samples);
      let weight = sample_enabled * mix(1.0, 1.0 - norm, falloff);
      let angle = amount * mask * fi * 0.14;
      acc += sample_rgb(center + rotate2d(radial, angle)) * weight;
      wsum += weight;
    }
    let blurred = acc / max(0.0001, wsum);
    return vec4<f32>(mix(color, blurred, wet * mask), src.a);
  }
  if (code == 24u) {
    let segments = max(2.0, floor(u.params0.x + 0.5));
    let base_angle = (u.params0.y + u.resolution_time.z * u.params1.w * 45.0) * 0.01745329252;
    let center = clamp(u.params0.zw, vec2<f32>(0.0), vec2<f32>(1.0));
    let zoom = max(0.01, u.params1.x);
    let mode = u32(round(clamp(u.params1.y, 0.0, 2.0)));
    let spiral = clamp(u.params1.z, 0.0, 2.0);
    let p = (uv - center) / zoom;
    let r = length(p);
    var a = atan2(p.y, p.x) + base_angle + r * spiral;
    let seg_angle = 6.28318530718 / segments;
    a = abs((a - floor(a / seg_angle) * seg_angle) - seg_angle * 0.5);
    var sample_uv = center + vec2<f32>(cos(a), sin(a)) * r * zoom;
    if (mode == 1u) {
      sample_uv = fract(sample_uv);
    } else if (mode == 2u) {
      sample_uv = center + rotate2d(sample_uv - center, r * spiral * 2.4);
    }
    let kaleido = sample_rgb(sample_uv);
    return vec4<f32>(mix(color, kaleido, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 25u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let position = clamp(u.params0.y, 0.0, 1.0);
    let offset = (clamp(u.params0.z, 0.0, 1.0) - 0.5) * 0.5;
    let flip_side = u.params0.w > 0.5;
    var sample_uv = uv;
    if (mode == 0u) {
      let on_side = uv.x > position;
      if (on_side != flip_side) {
        sample_uv.x = position - (uv.x - position);
      }
      sample_uv.x += offset;
    } else if (mode == 1u) {
      let on_side = uv.y > position;
      if (on_side != flip_side) {
        sample_uv.y = position - (uv.y - position);
      }
      sample_uv.y += offset;
    } else if (mode == 2u) {
      sample_uv = vec2<f32>(
        position - abs(uv.x - position),
        position - abs(uv.y - position),
      ) + vec2<f32>(offset);
    } else {
      if (uv.x + uv.y > 1.0) {
        sample_uv = vec2<f32>(1.0 - uv.y, 1.0 - uv.x);
      }
      sample_uv += vec2<f32>(offset, -offset);
    }
    let mirrored = sample_rgb(sample_uv);
    return vec4<f32>(mix(color, mirrored, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 26u) {
    let key = clamp(u.params0.xyz, vec3<f32>(0.0), vec3<f32>(1.0));
    let softness = clamp(u.params0.w, 0.0, 1.0);
    let spill = clamp(u.params1.x, 0.0, 1.0);
    let show_matte = u.params1.y > 0.5;
    let mode = u32(round(clamp(u.params1.z, 0.0, 2.0)));
    var dist = 0.0;
    if (mode == 0u) {
      let src_hue = hue_value(color);
      let key_hue = hue_value(key);
      var hue_dist = abs(src_hue - key_hue);
      hue_dist = min(hue_dist, 1.0 - hue_dist);
      dist = hue_dist * 2.0 + (1.0 - saturation_value(color)) * 0.3;
    } else if (mode == 1u) {
      let src_yc = rgb_to_ycbcr(color);
      let key_yc = rgb_to_ycbcr(key);
      dist = length(src_yc.yz - key_yc.yz) * 2.0;
    } else {
      dist = length(color - key);
    }
    let matte = smoothstep(amount, amount + softness + 0.001, dist);
    var result = color;
    if (spill > 0.001) {
      let spill_amount = spill * (1.0 - matte);
      if (key.g >= max(key.r, key.b)) {
        result.g = min(result.g, mix(result.g, (result.r + result.b) * 0.5, spill_amount));
      } else if (key.r >= max(key.g, key.b)) {
        result.r = min(result.r, mix(result.r, (result.g + result.b) * 0.5, spill_amount));
      } else {
        result.b = min(result.b, mix(result.b, (result.r + result.g) * 0.5, spill_amount));
      }
    }
    if (show_matte) {
      return vec4<f32>(vec3<f32>(matte), src.a);
    }
    return vec4<f32>(result, src.a * matte);
  }
  if (code == 27u) {
    let high_cut = max(amount + 0.001, clamp(u.params0.x, 0.0, 1.0));
    let invert = u.params0.y > 0.5;
    let gamma = max(0.001, u.params0.z);
    let show_matte = u.params0.w > 0.5;
    let premultiply = u.params1.x > 0.5;
    var matte = smoothstep(amount, high_cut, luma(color));
    if (invert) {
      matte = 1.0 - matte;
    }
    matte = pow(clamp(matte, 0.0, 1.0), gamma);
    if (show_matte) {
      return vec4<f32>(vec3<f32>(matte), src.a);
    }
    var result = color;
    if (premultiply) {
      result = color * matte;
    }
    return vec4<f32>(result, src.a * matte);
  }
  if (code == 28u) {
    let ref_color = clamp(u.params0.xyz, vec3<f32>(0.0), vec3<f32>(1.0));
    let softness = clamp(u.params0.w, 0.0, 1.0);
    let invert = u.params1.x > 0.5;
    let show_matte = u.params1.y > 0.5;
    let mode = u32(round(clamp(u.params1.z, 0.0, 2.0)));
    let diff = abs(color - ref_color);
    var dist = length(diff);
    if (mode == 1u) {
      dist = diff.r + diff.g + diff.b;
    } else if (mode == 2u) {
      dist = max(diff.r, max(diff.g, diff.b));
    }
    var matte = smoothstep(amount, amount + softness + 0.001, dist);
    if (invert) {
      matte = 1.0 - matte;
    }
    if (show_matte) {
      return vec4<f32>(vec3<f32>(matte), src.a);
    }
    return vec4<f32>(color, src.a * matte);
  }
  if (code == 29u || code == 30u) {
    let radius = clamp(amount, 1.0, 8.0);
    let shape = u32(round(clamp(u.params0.x, 0.0, 2.0)));
    let channel = u32(round(clamp(u.params0.y, 0.0, 4.0)));
    let wet = clamp(u.params0.z, 0.0, 1.0);
    let tx = effect_texel();
    var chosen = src;
    var chosen_value = channel_value(src, channel);
    if (code == 29u) {
      chosen = vec4<f32>(1.0);
      chosen_value = 1.0;
    } else {
      chosen = vec4<f32>(0.0);
      chosen_value = 0.0;
    }
    for (var y = 0u; y < 17u; y = y + 1u) {
      let fy = f32(y) - 8.0;
      let ay = abs(fy);
      for (var x = 0u; x < 17u; x = x + 1u) {
        let fx = f32(x) - 8.0;
        let ax = abs(fx);
        var inside = ax <= radius && ay <= radius;
        if (shape == 0u) {
          inside = ax + ay <= radius + 0.001;
        } else if (shape == 2u) {
          inside = ax * ax + ay * ay <= radius * radius + 0.001;
        }
        if (inside) {
          let sample_col = sample_clamped(uv + vec2<f32>(fx, fy) * tx);
          let sample_value = channel_value(sample_col, channel);
          if (code == 29u) {
            if (sample_value < chosen_value) {
              chosen = sample_col;
              chosen_value = sample_value;
            }
          } else if (sample_value > chosen_value) {
            chosen = sample_col;
            chosen_value = sample_value;
          }
        }
      }
    }
    return vec4<f32>(mix(color, chosen.rgb, wet), mix(src.a, chosen.a, wet));
  }
  if (code == 31u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let waveform = u32(round(clamp(u.params0.y, 0.0, 3.0)));
    let frequency = max(0.01, u.params0.z);
    let speed = clamp(u.params0.w, 0.0, 3.0);
    let phase = u.params1.x * 0.01745329252 + u.resolution_time.z * speed * 6.28318530718;
    let secondary = clamp(u.params1.y, 0.0, 1.0);
    let chroma_split = clamp(u.params1.z, 0.0, 1.0);
    let amp = amount / max(u.resolution_time.xy, vec2<f32>(1.0));
    let centered = uv - vec2<f32>(0.5);
    var offset = vec2<f32>(0.0);
    if (mode == 1u) {
      let signal = wave_signal((uv.x * frequency + phase) * 6.28318530718, waveform);
      let harmonic = wave_signal((uv.x * frequency * 2.0 + phase * 1.37) * 6.28318530718, waveform);
      offset.y = (signal + harmonic * secondary * 0.5) * amp.y;
    } else if (mode == 2u) {
      let r = length(centered);
      let signal = wave_signal((r * frequency + phase) * 6.28318530718, waveform);
      let dir = normalize(centered + vec2<f32>(0.0001, 0.0));
      offset = dir * signal * length(amp) * 0.7;
    } else if (mode == 3u) {
      let r = length(centered);
      let signal = wave_signal((r * frequency + phase) * 6.28318530718, waveform);
      offset = rotate2d(centered, signal * amount * 0.004) - centered;
    } else {
      let signal = wave_signal((uv.y * frequency + phase) * 6.28318530718, waveform);
      let harmonic = wave_signal((uv.y * frequency * 2.0 + phase * 1.37) * 6.28318530718, waveform);
      offset.x = (signal + harmonic * secondary * 0.5) * amp.x;
    }
    let sample_uv = uv + offset;
    var waved = sample_rgb(sample_uv);
    if (chroma_split > 0.001) {
      let chroma_offset = offset * chroma_split * 1.5;
      waved = vec3<f32>(
        sample_rgb(sample_uv + chroma_offset).r,
        waved.g,
        sample_rgb(sample_uv - chroma_offset).b,
      );
    }
    return vec4<f32>(waved, src.a);
  }
  if (code == 32u) {
    let radius = max(0.05, u.params0.x);
    let center = clamp(u.params0.yz, vec2<f32>(0.0), vec2<f32>(1.0));
    let zoom = max(0.05, u.params0.w);
    let mode = u32(round(clamp(u.params1.x, 0.0, 2.0)));
    let chroma_edge = clamp(u.params1.y, 0.0, 1.0);
    let p = (uv - center) / radius;
    let dist = length(p);
    var strength = amount;
    if (mode == 2u) {
      strength = -abs(amount);
    } else if (mode == 1u) {
      strength = abs(amount);
    }
    let mask = 1.0 - smoothstep(0.92, 1.0, dist);
    let factor = max(0.05, 1.0 + strength * dist * dist);
    let sample_uv = center + p * radius * factor / zoom;
    var fish = sample_rgb(mix(uv, sample_uv, mask));
    if (chroma_edge > 0.001) {
      let edge = smoothstep(0.35, 1.0, dist) * chroma_edge;
      let chroma_dir = normalize(p + vec2<f32>(0.0001, 0.0)) * edge * 0.018;
      fish = vec3<f32>(
        sample_rgb(sample_uv + chroma_dir).r,
        fish.g,
        sample_rgb(sample_uv - chroma_dir).b,
      );
    }
    return vec4<f32>(mix(color, fish, mask), src.a);
  }
  if (code == 33u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let center = clamp(u.params0.yz, vec2<f32>(0.0), vec2<f32>(1.0));
    let cubic = clamp(u.params0.w, -0.5, 0.5);
    let anamorphic_x = max(0.1, u.params1.x);
    let edge_fade = clamp(u.params1.y, 0.0, 1.0);
    let chroma = clamp(u.params1.z, 0.0, 1.0);
    var p = uv - center;
    p.x *= anamorphic_x;
    let r2 = dot(p, p);
    var k = amount;
    if (mode == 1u) {
      k = -abs(amount);
    } else if (mode == 3u) {
      k = amount * 1.35;
    }
    let factor = max(0.05, 1.0 + k * r2 + cubic * r2 * r2);
    var warped = p * factor;
    warped.x /= anamorphic_x;
    let sample_uv = center + warped;
    let mask = mix(1.0, 1.0 - smoothstep(0.78, 1.15, length(p)), edge_fade);
    var lens = sample_rgb(sample_uv);
    if (chroma > 0.001) {
      let dir = normalize(warped + vec2<f32>(0.0001, 0.0)) * chroma * r2 * 0.035;
      lens = vec3<f32>(
        sample_rgb(sample_uv + dir).r,
        lens.g,
        sample_rgb(sample_uv - dir).b,
      );
    }
    return vec4<f32>(mix(color, lens, clamp(mask, 0.0, 1.0)), src.a);
  }
  if (code == 34u) {
    let radius = max(0.01, u.params0.x);
    let center = clamp(u.params0.yz, vec2<f32>(0.0), vec2<f32>(1.0));
    let falloff = max(0.1, u.params0.w);
    let speed = clamp(u.params1.x, 0.0, 2.0);
    let wet = clamp(u.params1.y, 0.0, 1.0);
    let p = uv - center;
    let dist = length(p);
    let influence = pow(1.0 - smoothstep(0.0, radius, dist), falloff);
    let angle = (amount + u.resolution_time.z * speed * 6.28318530718) * influence;
    let twirled = sample_rgb(center + rotate2d(p, angle));
    return vec4<f32>(mix(color, twirled, wet * influence), src.a);
  }
  if (code == 35u) {
    let radius = max(0.01, u.params0.x);
    let center = clamp(u.params0.yz, vec2<f32>(0.0), vec2<f32>(1.0));
    let falloff = max(0.1, u.params0.w);
    let chroma = clamp(u.params1.x, 0.0, 1.0);
    let wet = clamp(u.params1.y, 0.0, 1.0);
    let p = uv - center;
    let dist = length(p);
    let influence = pow(1.0 - smoothstep(0.0, radius, dist), falloff);
    let factor = max(0.05, 1.0 - amount * influence * 0.75);
    let sample_uv = center + p * factor;
    var pinched = sample_rgb(sample_uv);
    if (chroma > 0.001) {
      let dir = normalize(p + vec2<f32>(0.0001, 0.0)) * chroma * influence * 0.02;
      pinched = vec3<f32>(
        sample_rgb(sample_uv + dir).r,
        pinched.g,
        sample_rgb(sample_uv - dir).b,
      );
    }
    return vec4<f32>(mix(color, pinched, wet * influence), src.a);
  }
  if (code == 36u) {
    let threshold = clamp(amount, 0.0, 1.0);
    let thickness = max(0.25, u.params0.x);
    let mode = u32(round(clamp(u.params0.y, 0.0, 3.0)));
    let flags = u32(round(clamp(u.params0.z, 0.0, 3.0)));
    let invert_edges = (flags & 1u) == 1u;
    let edge_only = (flags & 2u) == 2u;
    let edge_tint = clamp(vec3<f32>(u.params0.w, u.params1.x, u.params1.y), vec3<f32>(0.0), vec3<f32>(1.5));
    let tint_edges = clamp(u.params1.z, 0.0, 1.0);
    let glow = clamp(u.params1.w, 0.0, 2.0);
    let tx = effect_texel() * thickness;

    let tl = sample_rgb(uv + vec2<f32>(-tx.x, -tx.y));
    let tc = sample_rgb(uv + vec2<f32>(0.0, -tx.y));
    let tr = sample_rgb(uv + vec2<f32>(tx.x, -tx.y));
    let ml = sample_rgb(uv + vec2<f32>(-tx.x, 0.0));
    let mr = sample_rgb(uv + vec2<f32>(tx.x, 0.0));
    let bl = sample_rgb(uv + vec2<f32>(-tx.x, tx.y));
    let bc = sample_rgb(uv + vec2<f32>(0.0, tx.y));
    let br = sample_rgb(uv + vec2<f32>(tx.x, tx.y));

    let gx_rgb = tr + mr * 2.0 + br - tl - ml * 2.0 - bl;
    let gy_rgb = bl + bc * 2.0 + br - tl - tc * 2.0 - tr;
    let gx_l = luma(gx_rgb);
    let gy_l = luma(gy_rgb);
    var edge_strength = length(vec2<f32>(gx_l, gy_l));
    if (mode == 1u) {
      edge_strength = length(gx_rgb) * 0.58 + length(gy_rgb) * 0.58;
    } else if (mode == 2u) {
      let lap = abs(luma(tl + tc + tr + ml + mr + bl + bc + br - color * 8.0));
      edge_strength = max(edge_strength, lap);
    } else if (mode == 3u) {
      let local_max = max(max(luma(tl), luma(tc)), max(max(luma(tr), luma(ml)), max(max(luma(mr), luma(bl)), max(luma(bc), luma(br)))));
      let local_min = min(min(luma(tl), luma(tc)), min(min(luma(tr), luma(ml)), min(min(luma(mr), luma(bl)), min(luma(bc), luma(br)))));
      edge_strength = max(edge_strength, local_max - local_min);
    }

    let feather = max(0.01, 0.18 / max(1.0, thickness));
    var edge_mask = smoothstep(threshold, threshold + feather, edge_strength);
    if (invert_edges) {
      edge_mask = 1.0 - edge_mask;
    }
    let edge_color = mix(vec3<f32>(edge_mask), edge_tint * edge_mask, tint_edges);
    let glow_color = edge_tint * edge_mask * glow * 0.65;
    if (edge_only) {
      return vec4<f32>(edge_color + glow_color, src.a * edge_mask);
    }
    let composited = mix(color, edge_color + glow_color, edge_mask);
    return vec4<f32>(composited, src.a);
  }
  if (code == 37u) {
    let grain_amount = clamp(amount, 0.0, 1.0);
    let grain_size = max(0.25, u.params0.x);
    let shadow_weight = clamp(u.params0.y, 0.0, 2.0);
    let mid_weight = clamp(u.params0.z, 0.0, 2.0);
    let high_weight = clamp(u.params0.w, 0.0, 2.0);
    let mono = u.params1.x >= 0.5;
    let stock = u32(round(clamp(u.params1.y, 0.0, 3.0)));
    let color_jitter = clamp(u.params1.z, 0.0, 1.0);
    let anim_speed = max(0.0, u.params1.w);
    let lum = luma(color);
    let shadow_mask = 1.0 - smoothstep(0.12, 0.55, lum);
    let mid_mask = 1.0 - smoothstep(0.0, 0.55, abs(lum - 0.5));
    let high_mask = smoothstep(0.48, 0.95, lum);
    let tonal_weight = max(0.0, shadow_mask * shadow_weight + mid_mask * mid_weight + high_mask * high_weight);
    let frame_seed = floor(u.effect.w + u.resolution_time.z * anim_speed * 24.0);
    let cell = floor(uv * u.resolution_time.xy / grain_size);
    let n0 = hash21(cell + vec2<f32>(frame_seed * 1.71, frame_seed * 0.37));
    var grain = n0 - 0.5;
    if (stock == 1u) {
      let fine = hash21(cell * 1.73 + vec2<f32>(frame_seed * 2.11, 19.0)) - 0.5;
      grain = grain * 0.62 + fine * 0.38;
    } else if (stock == 2u) {
      grain = sign(grain) * pow(abs(grain) * 2.0, 1.35) * 0.5;
    } else if (stock == 3u) {
      let coarse = hash21(floor(cell * 0.42) + vec2<f32>(frame_seed, 31.0)) - 0.5;
      grain = grain * 0.48 + coarse * 0.52;
    }
    let strength = grain_amount * tonal_weight * 0.42;
    var grain_rgb = vec3<f32>(grain);
    if (!mono) {
      let nr = hash21(cell + vec2<f32>(frame_seed * 3.1, 7.0)) - 0.5;
      let ng = hash21(cell + vec2<f32>(frame_seed * 4.7, 13.0)) - 0.5;
      let nb = hash21(cell + vec2<f32>(frame_seed * 5.3, 23.0)) - 0.5;
      grain_rgb = mix(vec3<f32>(grain), vec3<f32>(nr, ng, nb), color_jitter);
    }
    let grained = color + grain_rgb * strength;
    return vec4<f32>(max(grained, vec3<f32>(0.0)), src.a);
  }
  if (code == 38u) {
    let tonemap_mix = clamp(amount, 0.0, 1.0);
    let curve = u32(round(clamp(u.params0.x, 0.0, 5.0)));
    let exposure = clamp(u.params0.y, 0.25, 4.0);
    let contrast = clamp(u.params0.z, 0.0, 1.0);
    let gained = max(color * exposure, vec3<f32>(0.0));
    var mapped = tonemap_aces(gained);
    if (curve == 1u) {
      mapped = tonemap_reinhard(gained);
    } else if (curve == 2u) {
      mapped = tonemap_hable(gained);
    } else if (curve == 3u) {
      let gray = vec3<f32>(luma(gained));
      mapped = tonemap_aces(clamp(mix(gained, gray * 1.4, 0.5), vec3<f32>(0.0), vec3<f32>(1.0)));
    } else if (curve == 4u) {
      mapped = pow(tonemap_aces(gained * vec3<f32>(0.95, 0.97, 1.05)), vec3<f32>(1.0 / 1.1));
    } else if (curve == 5u) {
      mapped = gained / (vec3<f32>(1.0) + gained * 0.5);
    }
    if (contrast > 0.001) {
      mapped = mix(mapped, tonemap_scurve(mapped), contrast);
    }
    return vec4<f32>(mix(color, mapped, tonemap_mix), src.a);
  }
  if (code == 39u) {
    let bloom_mix = clamp(amount, 0.0, 1.0);
    let intensity = clamp(u.params0.x, 0.0, 2.0);
    let threshold = clamp(u.params0.y, 0.0, 1.0);
    let knee = clamp(u.params0.z, 0.0, 1.0);
    let radius = clamp(u.params0.w, 0.0, 1.0);
    let anamorphic = clamp(u.params1.x, 0.0, 1.0);
    let tint = clamp(u.params1.yzw, vec3<f32>(0.0), vec3<f32>(1.5));
    let px = effect_texel();
    let base_radius = radius * 9.0 + 1.5;
    let ring1 = bloom_ring_sample(uv, px, base_radius, anamorphic);
    let ring2 = bloom_ring_sample(uv, px, base_radius * 2.2, anamorphic);
    let ring3 = bloom_ring_sample(uv, px, base_radius * 4.5, anamorphic);
    let blurred = ring1 * 0.55 + ring2 * 0.30 + ring3 * 0.15;
    let bloom = bloom_threshold_knee(blurred, threshold, knee) * intensity * tint;
    let composited = vec3<f32>(1.0) - (vec3<f32>(1.0) - color) * (vec3<f32>(1.0) - bloom);
    return vec4<f32>(mix(color, composited, bloom_mix), src.a);
  }
  if (code == 40u) {
    let palette = u32(round(clamp(u.params0.x, 0.0, 11.0)));
    let offset = clamp(u.params0.y, 0.0, 1.0);
    let speed = clamp(u.params0.z, 0.0, 2.0);
    let contrast = clamp(u.params0.w, 0.5, 2.0);
    let bands = clamp(u.params1.x, 0.0, 32.0);
    let audio_react = clamp(u.params1.y, 0.0, 1.0);
    let hue_shift = clamp(u.params1.z, 0.0, 1.0);
    let audio = clamp(u.params1.w, 0.0, 1.5);
    var lum = clamp((luma(color) - 0.5) * contrast + 0.5, 0.0, 1.0);
    if (bands >= 0.5) {
      let steps = floor(bands + 0.5);
      lum = clamp(floor(lum * steps) / max(steps - 1.0, 1.0), 0.0, 1.0);
    }
    let t = lum + offset + u.resolution_time.z * speed + hue_shift + audio * audio_react;
    let palette_color = colorama_palette(t, palette, hue_shift);
    return vec4<f32>(mix(color, palette_color, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 41u) {
    let top = clamp(u.params0.x, 0.0, 1.0);
    let bottom = clamp(u.params0.y, 0.0, 1.0);
    let left = clamp(u.params0.z, 0.0, 1.0);
    let right = clamp(u.params0.w, 0.0, 1.0);
    let softness = clamp(u.params1.x, 0.0, 2.0);
    let feather_gamma = max(0.0001, u.params1.y);
    let matte_preview = u.params1.z > 0.5;
    var alpha = 1.0;
    if (top > 0.0001) {
      alpha *= smoothstep(1.0, 1.0 - top, uv.y);
    }
    if (bottom > 0.0001) {
      alpha *= smoothstep(0.0, bottom, uv.y);
    }
    if (left > 0.0001) {
      alpha *= smoothstep(0.0, left, uv.x);
    }
    if (right > 0.0001) {
      alpha *= smoothstep(1.0, 1.0 - right, uv.x);
    }
    alpha = pow(clamp(alpha, 0.0, 1.0), 1.0 / max(softness + 0.5, 0.1));
    alpha = pow(alpha, feather_gamma) * clamp(amount, 0.0, 1.0);
    if (matte_preview) {
      return vec4<f32>(mix(vec3<f32>(0.0), vec3<f32>(1.0, 0.0, 0.0), 1.0 - alpha), src.a);
    }
    return vec4<f32>(color, src.a * alpha);
  }
  if (code == 42u) {
    let kind = u32(round(clamp(u.params0.x, 0.0, 4.0)));
    let scale = max(0.5, u.params0.y);
    let depth = max(1.0, floor(u.params0.z + 0.5));
    let palette = u32(round(clamp(u.params0.w, 0.0, 5.0)));
    let pixel_lock = u.params1.x > 0.5;
    var cell = uv * u.resolution_time.xy / scale;
    if (pixel_lock) {
      cell = floor(cell);
    }
    let threshold = (dither_threshold(kind, floor(cell), uv, color) - 0.5) * clamp(amount, 0.0, 1.0);
    let levels = max(2.0, pow(2.0, depth));
    var dithered = color + vec3<f32>(threshold / levels);
    dithered = floor(clamp(dithered, vec3<f32>(0.0), vec3<f32>(1.0)) * levels + vec3<f32>(0.5)) / levels;
    dithered = dither_palette_snap(dithered, palette);
    return vec4<f32>(clamp(dithered, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 43u) {
    let thickness = max(0.25, amount);
    let outline_color = clamp(u.params0.xyz, vec3<f32>(0.0), vec3<f32>(1.5));
    let only = u.params0.w > 0.5;
    let glow = clamp(u.params1.x, 0.0, 1.0);
    let position = u32(round(clamp(u.params1.y, 0.0, 2.0)));
    let crawl = clamp(u.params1.z, 0.0, 1.0);
    let alpha_aware = clamp(u.params1.w, 0.0, 1.0);
    let tx = effect_texel() * thickness;
    let center_value = mix(luma(color), src.a, alpha_aware);
    var edge = 0.0;
    var inside_sum = 0.0;
    var outside_sum = 0.0;
    for (var yy = 0u; yy < 3u; yy = yy + 1u) {
      let fy = f32(yy) - 1.0;
      for (var xx = 0u; xx < 3u; xx = xx + 1u) {
        let fx = f32(xx) - 1.0;
        if (!(xx == 1u && yy == 1u)) {
          let nb4 = sample_clamped(uv + vec2<f32>(fx, fy) * tx);
          let nb = mix(luma(nb4.rgb), nb4.a, alpha_aware);
          let diff = nb - center_value;
          edge += abs(diff);
          if (diff < 0.0) {
            inside_sum += -diff;
          } else {
            outside_sum += diff;
          }
        }
      }
    }
    edge = smoothstep(0.05, 0.15, edge / 8.0);
    if (position == 0u) {
      edge *= smoothstep(0.0, 0.1, outside_sum / 8.0);
    } else if (position == 1u) {
      edge *= smoothstep(0.0, 0.1, inside_sum / 8.0);
    }
    if (crawl > 0.001) {
      let ants = sin((uv.x + uv.y) * 80.0 - u.resolution_time.z * crawl * 6.0) * 0.5 + 0.5;
      edge *= ants;
    }
    var glow_edge = 0.0;
    if (glow > 0.001) {
      for (var gy = 0u; gy < 5u; gy = gy + 1u) {
        let fy = f32(gy) - 2.0;
        for (var gx = 0u; gx < 5u; gx = gx + 1u) {
          let fx = f32(gx) - 2.0;
          let nb4 = sample_clamped(uv + vec2<f32>(fx, fy) * tx * 2.0);
          let nb = mix(luma(nb4.rgb), nb4.a, alpha_aware);
          glow_edge += abs(nb - center_value);
        }
      }
      glow_edge = smoothstep(0.02, 0.1, glow_edge / 24.0) * glow * 0.7;
    }
    let outline_mask = max(edge, glow_edge);
    let outlined = outline_color * outline_mask;
    if (only) {
      return vec4<f32>(outlined, src.a * outline_mask);
    }
    return vec4<f32>(color + outlined, src.a);
  }
  if (code == 44u) {
    let angle = u.params0.x * 0.01745329252;
    let height = clamp(u.params0.y, 0.0, 1.0);
    let highlight = clamp(vec3<f32>(u.params0.z, u.params0.w, u.params1.x), vec3<f32>(0.0), vec3<f32>(1.5));
    let shadow = clamp(u.params1.yzw, vec3<f32>(0.0), vec3<f32>(1.5));
    let tx = effect_texel();
    let l_l = luma(sample_rgb(uv - vec2<f32>(tx.x, 0.0)));
    let l_r = luma(sample_rgb(uv + vec2<f32>(tx.x, 0.0)));
    let l_d = luma(sample_rgb(uv - vec2<f32>(0.0, tx.y)));
    let l_u = luma(sample_rgb(uv + vec2<f32>(0.0, tx.y)));
    let dir = vec2<f32>(cos(angle), sin(angle));
    let dx = (l_r - l_l) * (1.0 + height * 4.0);
    let dy = (l_u - l_d) * (1.0 + height * 4.0);
    let normal = normalize(vec3<f32>(-dx, -dy, 1.0));
    let light = normalize(vec3<f32>(dir.x, dir.y, 0.5));
    let diff = max(dot(normal, light), 0.0);
    let along = (l_r - l_l) * dir.x + (l_u - l_d) * dir.y;
    let embossed = clamp(along * amount + 0.5, 0.0, 1.0);
    let relit = color * 0.48 + mix(shadow, highlight, embossed) + vec3<f32>(pow(diff, 18.0) * 0.18);
    return vec4<f32>(clamp(relit, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 45u) {
    let scan_count = max(32.0, u.params0.x);
    let mask_amount = clamp(u.params0.y, 0.0, 1.0);
    let mask_type = u32(round(clamp(u.params0.z, 0.0, 2.0)));
    let curvature = clamp(u.params0.w, 0.0, 1.0);
    let vignette = clamp(u.params1.x, 0.0, 1.0);
    let glow = clamp(u.params1.y, 0.0, 1.0);
    let rolling = clamp(u.params1.z, 0.0, 1.0);
    let chromatic = clamp(u.params1.w, 0.0, 1.0);
    var crt_uv = uv;
    if (curvature > 0.001) {
      var p = uv * 2.0 - vec2<f32>(1.0);
      let offset = abs(p.yx) / vec2<f32>(6.0, 4.0);
      p = p + p * offset * offset * curvature;
      crt_uv = p * 0.5 + vec2<f32>(0.5);
      if (crt_uv.x < 0.0 || crt_uv.x > 1.0 || crt_uv.y < 0.0 || crt_uv.y > 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, src.a);
      }
    }
    var crt_col = sample_rgb(crt_uv);
    if (chromatic > 0.001) {
      let cd = (crt_uv - vec2<f32>(0.5)) * chromatic * 0.01;
      crt_col = vec3<f32>(
        sample_rgb(crt_uv + cd).r,
        sample_rgb(crt_uv).g,
        sample_rgb(crt_uv - cd).b,
      );
    }
    if (mask_amount > 0.001) {
      let px = crt_uv * u.resolution_time.xy;
      let stripe = fract(px.x / 3.0) * 3.0;
      var mask_col = vec3<f32>(0.62);
      if (stripe < 1.0) {
        mask_col = vec3<f32>(1.4, 0.62, 0.62);
      } else if (stripe < 2.0) {
        mask_col = vec3<f32>(0.62, 1.4, 0.62);
      } else {
        mask_col = vec3<f32>(0.62, 0.62, 1.4);
      }
      if (mask_type == 2u) {
        mask_col *= mix(0.75, 1.0, step(0.5, fract(px.y * 0.5)));
      } else if (mask_type == 1u) {
        mask_col *= 1.0 - step(0.96, fract(px.y * 0.02)) * 0.3;
      }
      crt_col = mix(crt_col, crt_col * mask_col, mask_amount);
    }
    let scan = sin(crt_uv.y * scan_count * 3.14159) * 0.5 + 0.5;
    crt_col *= mix(1.0, scan, clamp(amount, 0.0, 1.0));
    if (glow > 0.001) {
      let tx = effect_texel();
      let g = sample_rgb(crt_uv + vec2<f32>(tx.x, 0.0)) +
        sample_rgb(crt_uv - vec2<f32>(tx.x, 0.0)) +
        sample_rgb(crt_uv + vec2<f32>(0.0, tx.y)) +
        sample_rgb(crt_uv - vec2<f32>(0.0, tx.y));
      crt_col += g * glow * 0.05;
    }
    if (rolling > 0.001) {
      let bar = smoothstep(0.7, 1.0, sin(crt_uv.y * 6.0 - u.resolution_time.z * 1.5));
      crt_col += vec3<f32>(bar * rolling * 0.18);
    }
    if (vignette > 0.001) {
      let d = distance(crt_uv, vec2<f32>(0.5));
      crt_col *= 1.0 - smoothstep(0.3, 0.78, d) * vignette;
    }
    return vec4<f32>(crt_col, src.a);
  }
  if (code == 46u) {
    let palette = u32(round(clamp(u.params0.x, 0.0, 4.0)));
    let shimmer = clamp(u.params0.y, 0.0, 1.0);
    let sensor_noise = clamp(u.params0.z, 0.0, 1.0);
    var thermal_uv = uv;
    if (shimmer > 0.001) {
      let lum0 = luma(color);
      let wobble = sin(uv.y * 60.0 + u.resolution_time.z * 4.0) * 0.5 + sin(uv.x * 35.0 + u.resolution_time.z * 3.0) * 0.5;
      thermal_uv += vec2<f32>(wobble * shimmer * lum0 * 0.006, wobble * shimmer * lum0 * 0.003);
    }
    let thermal_src = sample_clamped(thermal_uv);
    var temp = pow(luma(thermal_src.rgb), 1.0 / max(amount, 0.05));
    if (sensor_noise > 0.001) {
      let band = hash21(vec2<f32>(floor(uv.y * u.resolution_time.y * 0.5), floor(u.resolution_time.z * 8.0)));
      temp = clamp(temp + (band - 0.5) * sensor_noise * 0.18, 0.0, 1.0);
    }
    return vec4<f32>(thermal_palette_native(temp, palette), thermal_src.a);
  }
  if (code == 47u) {
    let noise_amount = clamp(u.params0.x, 0.0, 1.0);
    let vignette = clamp(u.params0.y, 0.0, 1.0);
    let phosphor = u32(round(clamp(u.params0.z, 0.0, 2.0)));
    let bloom = clamp(u.params0.w, 0.0, 2.0);
    let scope_mask = u32(round(clamp(u.params1.x, 0.0, 2.0)));
    let rolling_noise = clamp(u.params1.y, 0.0, 1.0);
    var lum = pow(luma(color), 0.8) * amount;
    var nv = night_vision_tint(lum, phosphor);
    let scanline = sin(uv.y * u.resolution_time.y * 2.0) * 0.5 + 0.5;
    nv *= 0.95 + scanline * 0.05;
    if (rolling_noise > 0.001) {
      let band_y = floor((uv.y + u.resolution_time.z * 0.15) * 80.0);
      let band_rand = hash21(vec2<f32>(band_y, floor(u.resolution_time.z * 4.0)));
      nv += vec3<f32>(band_rand - 0.5) * rolling_noise * 0.4 * vec3<f32>(0.0, 1.0, 0.0);
    }
    if (noise_amount > 0.001) {
      let n = hash21(uv * u.resolution_time.xy + vec2<f32>(u.resolution_time.z * 1000.0));
      nv += vec3<f32>(n - 0.5) * noise_amount * 0.2;
    }
    if (bloom > 0.001) {
      let tx = effect_texel() * (3.0 + bloom * 2.0);
      var glow_sum = 0.0;
      for (var by = 0u; by < 5u; by = by + 1u) {
        let fy = f32(by) - 2.0;
        for (var bx = 0u; bx < 5u; bx = bx + 1u) {
          let fx = f32(bx) - 2.0;
          glow_sum += luma(sample_rgb(uv + vec2<f32>(fx, fy) * tx));
        }
      }
      nv += night_vision_tint(glow_sum / 25.0, phosphor) * bloom * 0.45;
    }
    let dist = distance(uv, vec2<f32>(0.5));
    if (vignette > 0.001) {
      nv *= 1.0 - smoothstep(0.35, 0.78, dist) * vignette;
    }
    if (scope_mask == 1u) {
      nv *= 1.0 - smoothstep(0.47, 0.50, dist);
    } else if (scope_mask == 2u) {
      let circle = 1.0 - smoothstep(0.47, 0.50, dist);
      let cross = 1.0 - min(step(0.005, abs(uv.x - 0.5)), step(0.005, abs(uv.y - 0.5)));
      nv = mix(nv * circle, vec3<f32>(0.0, 1.0, 0.0), cross * 0.35);
    }
    return vec4<f32>(clamp(nv, vec3<f32>(0.0), vec3<f32>(1.5)), src.a);
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
  out.uv = vec2<f32>(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
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
  let amount = clampNumber(
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
  } else if (options.effect === 'exposure') {
    param0 = clampNumber(params.rollOff ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.highlightProtect ?? params.param1, 0, 1, 0);
    param2 = 0;
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'vibrance') {
    param0 = clampNumber(params.skinProtect ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.highlightProtect ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.ceiling ?? params.param2, 0.1, 2, 1);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'temperature-tint') {
    param0 = clampNumber(params.tint ?? params.param0, -1, 1, 0);
    param1 = clampNumber(params.shadowTemp ?? params.param1, -1, 1, 0);
    param2 = clampNumber(params.highlightTemp ?? params.param2, -1, 1, 0);
    param3 = clampNumber(params.splitTone ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.autoCycle ?? params.param4, 0, 1, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'sharpen') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.radius ?? params.param1, 1, 8, 2);
    param2 = clampNumber(params.edgeProtect ?? params.param2, 0, 1, 0.2);
    param3 = clampNumber(params.param3 ?? params.intensity ?? 0, 0, 1, 0);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'directional-blur') {
    param0 = clampNumber(params.angle ?? params.param0, 0, 360, 0);
    param1 = clampNumber(params.samples ?? params.count ?? params.param1, 4, 32, 16);
    param2 = clampNumber(params.falloff ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.centerBias ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.outputMix ?? params.param4, 0, 1, 1);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'zoom-blur') {
    param0 = clampNumber(params.centerX ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.centerY ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.samples ?? params.count ?? params.param2, 4, 32, 16);
    param3 = clampNumber(params.falloff ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.chromatic ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.outputMix ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'radial-blur') {
    param0 = clampNumber(params.centerX ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.centerY ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.samples ?? params.count ?? params.param2, 4, 32, 16);
    param3 = clampNumber(params.falloff ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.radiusInner ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.radiusOuter ?? params.param5, 0, 1.5, 0.7);
    param6 = clampNumber(params.outputMix ?? params.param6, 0, 1, 1);
    param7 = 0;
  } else if (options.effect === 'kaleidoscope') {
    param0 = clampNumber(params.segments ?? params.count ?? params.param0, 2, 32, 6);
    param1 = clampNumber(params.angle ?? params.param1, 0, 360, 0);
    param2 = clampNumber(params.centerX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.centerY ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.zoom ?? params.param4, 0.25, 4, 1);
    param5 = clampNumber(params.mode ?? params.param5, 0, 2, 0);
    param6 = clampNumber(params.spiral ?? params.param6, 0, 2, 0);
    param7 = clampNumber(params.animSpeed ?? params.speed ?? params.param7, 0, 2, 0);
  } else if (options.effect === 'mirror') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.position ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.offset ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.flipSide ?? params.param3, 0, 1, 0);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'chroma-key') {
    param0 = clampNumber(params.keyR ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.keyG ?? params.param1, 0, 1, 1);
    param2 = clampNumber(params.keyB ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.softness ?? params.param3, 0, 1, 0.15);
    param4 = clampNumber(params.spill ?? params.param4, 0, 1, 0.6);
    param5 = clampNumber(params.matte ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.mode ?? params.param6, 0, 2, 1);
    param7 = 0;
  } else if (options.effect === 'luma-key') {
    param0 = clampNumber(params.highCut ?? params.param0, 0, 1, 0.6);
    param1 = clampNumber(params.invert ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.param2 ?? params.gamma ?? 1, 0.2, 3, 1);
    param3 = clampNumber(params.matte ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.premultiply ?? params.param4, 0, 1, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'difference-key') {
    param0 = clampNumber(params.refR ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.refG ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.refB ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.softness ?? params.param3, 0, 1, 0.15);
    param4 = clampNumber(params.invert ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.matte ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.mode ?? params.param6, 0, 2, 0);
    param7 = 0;
  } else if (options.effect === 'erode' || options.effect === 'dilate') {
    param0 = clampNumber(params.shape ?? params.param0, 0, 2, 1);
    param1 = clampNumber(params.channel ?? params.param1, 0, 4, 0);
    param2 = clampNumber(params.outputMix ?? params.param2, 0, 1, 1);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'wave') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.waveform ?? params.param1, 0, 3, 0);
    param2 = clampNumber(params.frequency ?? params.param2, 0.5, 30, 5);
    param3 = clampNumber(params.speed ?? params.param3, 0, 3, 1);
    param4 = clampNumber(params.phase ?? params.param4, 0, 360, 0);
    param5 = clampNumber(params.secondary ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.chromaSplit ?? params.param6, 0, 1, 0);
    param7 = 0;
  } else if (options.effect === 'fisheye') {
    param0 = clampNumber(params.radius ?? params.param0, 0.1, 1, 1);
    param1 = clampNumber(params.centerX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.centerY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.zoom ?? params.param3, 0.5, 2, 1);
    param4 = clampNumber(params.mode ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.edgeFalloff ?? params.chromatic ?? params.chromaSplit ?? params.param5, 0, 1, 0);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'lens-distortion') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.centerX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.centerY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.cubic ?? params.param3, -0.5, 0.5, 0);
    param4 = clampNumber(params.anamorphicX ?? params.param4, 0.5, 2, 1.3);
    param5 = clampNumber(params.edgeFade ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.chromatic ?? params.chromaSplit ?? params.param6, 0, 1, 0);
    param7 = 0;
  } else if (options.effect === 'twirl') {
    param0 = clampNumber(params.radius ?? params.param0, 0.05, 1, 0.5);
    param1 = clampNumber(params.centerX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.centerY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.falloff ?? params.param3, 0.5, 4, 1.5);
    param4 = clampNumber(params.animSpeed ?? params.speed ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.outputMix ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'pinch-bulge') {
    param0 = clampNumber(params.radius ?? params.param0, 0.1, 1, 0.5);
    param1 = clampNumber(params.centerX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.centerY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.falloff ?? params.param3, 0.5, 4, 1.5);
    param4 = clampNumber(params.chromatic ?? params.chromaSplit ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.outputMix ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'edge-detect') {
    const invert = clampNumber(params.invert ?? params.param2, 0, 1, 0) >= 0.5 ? 1 : 0;
    const edgeOnly = clampNumber(params.edgeOnlyAlpha ?? params.param7, 0, 1, 0) >= 0.5 ? 2 : 0;
    param0 = clampNumber(params.thickness ?? params.param0, 0.25, 12, 1);
    param1 = clampNumber(params.mode ?? params.param1, 0, 3, 0);
    param2 = invert + edgeOnly;
    param3 = clampNumber(params.edgeTintR ?? params.param3, 0, 1.5, 1);
    param4 = clampNumber(params.edgeTintG ?? params.param4, 0, 1.5, 1);
    param5 = clampNumber(params.edgeTintB ?? params.param5, 0, 1.5, 1);
    param6 = clampNumber(params.tintEdges ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.edgeGlow ?? params.param7, 0, 2, 0);
  } else if (options.effect === 'film-grain') {
    param0 = clampNumber(params.grainSize ?? params.param0, 0.25, 8, 1);
    param1 = clampNumber(params.grainShadow ?? params.param1, 0, 2, 0.7);
    param2 = clampNumber(params.grainMid ?? params.param2, 0, 2, 1);
    param3 = clampNumber(params.grainHigh ?? params.param3, 0, 2, 0.5);
    param4 = clampNumber(params.grainMono ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.grainStock ?? params.param5, 0, 3, 1);
    param6 = clampNumber(params.grainColorJitter ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.grainAnimSpeed ?? params.param7, 0, 4, 1);
  } else if (options.effect === 'filmic-tonemap') {
    amount = clampNumber(options.amount ?? params.tonemapMix ?? params.outputMix ?? params.param3, 0, 1, 1);
    param0 = clampNumber(params.tonemapCurve ?? params.param0, 0, 5, 0);
    param1 = clampNumber(params.tonemapExposure ?? params.exposure ?? params.param1, 0.25, 4, 1);
    param2 = clampNumber(params.tonemapContrast ?? params.contrast ?? params.param2, 0, 1, 0);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'bloom') {
    amount = clampNumber(options.amount ?? params.amount ?? params.outputMix ?? params.param7, 0, 1, 0.6);
    param0 = clampNumber(params.bloomIntensity ?? params.intensity ?? params.param0, 0, 2, 1);
    param1 = clampNumber(params.threshold ?? params.param1, 0, 1, 0.6);
    param2 = clampNumber(params.bloomKnee ?? params.softness ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.bloomRadius ?? params.radius ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.bloomAnamorphic ?? params.anamorphicX ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.red ?? params.param5, 0, 1.5, 1);
    param6 = clampNumber(params.green ?? params.param6, 0, 1.5, 1);
    param7 = clampNumber(params.blue ?? params.param7, 0, 1.5, 1);
  } else if (options.effect === 'colorama') {
    amount = clampNumber(options.amount ?? params.coloramaMix ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.coloramaPalette ?? params.param0, 0, 11, 0);
    param1 = clampNumber(params.coloramaOffset ?? params.offset ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.coloramaSpeed ?? params.speed ?? params.param2, 0, 2, 0.2);
    param3 = clampNumber(params.coloramaContrast ?? params.contrast ?? params.param3, 0.5, 2, 1);
    param4 = clampNumber(params.coloramaBands ?? params.param4, 0, 32, 0);
    param5 = clampNumber(params.coloramaAudioReact ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.coloramaHueShift ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.audio ?? params.param7, 0, 1.5, 0);
  } else if (options.effect === 'edge-feather') {
    amount = clampNumber(options.amount ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.featherTop ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.featherBottom ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.featherLeft ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.featherRight ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.featherSoftness ?? params.softness ?? params.param4, 0, 2, 0.5);
    param5 = clampNumber(params.featherGamma ?? params.gamma ?? params.param5, 0.1, 4, 1);
    param6 = clampNumber(params.featherMattePreview ?? params.matte ?? params.param6, 0, 1, 0);
    param7 = 0;
  } else if (options.effect === 'dither') {
    amount = clampNumber(options.amount ?? params.ditherIntensity ?? params.intensity ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.ditherType ?? params.mode ?? params.param0, 0, 4, 0);
    param1 = clampNumber(params.ditherScale ?? params.scale ?? params.param1, 0.5, 64, 1);
    param2 = clampNumber(params.ditherColorDepth ?? params.param2, 1, 8, 2);
    param3 = clampNumber(params.ditherPalette ?? params.palette ?? params.param3, 0, 5, 0);
    param4 = clampNumber(params.ditherPixelLock ?? params.param4, 0, 1, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'outline') {
    amount = clampNumber(options.amount ?? params.outlineThickness ?? params.thickness ?? params.amount, 0, 12, 2);
    param0 = clampNumber(params.outlineR ?? params.red ?? params.param0, 0, 1.5, 1);
    param1 = clampNumber(params.outlineG ?? params.green ?? params.param1, 0, 1.5, 1);
    param2 = clampNumber(params.outlineB ?? params.blue ?? params.param2, 0, 1.5, 1);
    param3 = clampNumber(params.outlineOnly ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.outlineGlow ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.outlinePosition ?? params.position ?? params.param5, 0, 2, 1);
    param6 = clampNumber(params.outlineCrawl ?? params.speed ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.outlineAlphaAware ?? params.param7, 0, 1, 0);
  } else if (options.effect === 'emboss') {
    amount = clampNumber(options.amount ?? params.embossStrength ?? params.strength ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.embossAngle ?? params.angle ?? params.param0, 0, 360, 135);
    param1 = clampNumber(params.embossHeight ?? params.height ?? params.param1, 0, 1, 1);
    param2 = clampNumber(params.embossHighlightR ?? params.red ?? params.param2, 0, 1.5, 1);
    param3 = clampNumber(params.embossHighlightG ?? params.green ?? params.param3, 0, 1.5, 1);
    param4 = clampNumber(params.embossHighlightB ?? params.blue ?? params.param4, 0, 1.5, 1);
    param5 = clampNumber(params.embossShadowR ?? params.param5, 0, 1.5, 0);
    param6 = clampNumber(params.embossShadowG ?? params.param6, 0, 1.5, 0);
    param7 = clampNumber(params.embossShadowB ?? params.param7, 0, 1.5, 0);
  } else if (options.effect === 'crt') {
    amount = clampNumber(options.amount ?? params.crtScanlines ?? params.intensity ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.crtScanCount ?? params.count ?? params.param0, 32, 1200, 480);
    param1 = clampNumber(params.crtMask ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.crtMaskType ?? params.mode ?? params.param2, 0, 2, 0);
    param3 = clampNumber(params.crtCurvature ?? params.curvature ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.crtVignette ?? params.param4, 0, 1, 0.4);
    param5 = clampNumber(params.crtGlow ?? params.glow ?? params.param5, 0, 1, 0.5);
    param6 = clampNumber(params.crtRollingBar ?? params.rollingBar ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.crtChromatic ?? params.chromatic ?? params.param7, 0, 1, 0.3);
  } else if (options.effect === 'thermal') {
    amount = clampNumber(options.amount ?? params.thermalIntensity ?? params.intensity ?? params.amount, 0.05, 2, 1);
    param0 = clampNumber(params.thermalPalette ?? params.palette ?? params.param0, 0, 4, 0);
    param1 = clampNumber(params.thermalShimmer ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.thermalSensorNoise ?? params.noise ?? params.param2, 0, 1, 0);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'night-vision') {
    amount = clampNumber(options.amount ?? params.nightVisionIntensity ?? params.intensity ?? params.amount, 0, 2, 1.5);
    param0 = clampNumber(params.nightVisionNoise ?? params.noise ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.nightVisionVignette ?? params.vignette ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.nightVisionPhosphor ?? params.phosphor ?? params.param2, 0, 2, 0);
    param3 = clampNumber(params.nightVisionBloom ?? params.bloom ?? params.param3, 0, 2, 0.6);
    param4 = clampNumber(params.nightVisionScopeMask ?? params.scopeMask ?? params.param4, 0, 2, 1);
    param5 = clampNumber(params.nightVisionRollingNoise ?? params.rollingBar ?? params.param5, 0, 1, 0);
    param6 = 0;
    param7 = 0;
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
