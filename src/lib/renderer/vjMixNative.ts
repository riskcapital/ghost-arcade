/**
 * Native VJ Mix — the true post-crossfade composite of every VJ row,
 * rendered core-side into one source frame that mapping layers bound to
 * "VJ Mix" (vjLayerIndex === -1) sample directly.
 *
 * Rows arrive bottom→top; each pass blends one row's composited frame
 * (post-crossfade when that row has a vj-xfade carrier) over the running
 * accumulator with the row's opacity and per-row blend mode, using the
 * exact native_blend math the compositor applies (heartbeat.wgsl), so the
 * mix matches what the VJ output itself shows.
 *
 * Same machinery as vjCrossfadeNative.ts: 48-byte uniforms (the core
 * identifies the layout by byte length and rewrites slot 3 = time every
 * frame), source-frame texture bindings, replace-blend render passes.
 */

export const VJ_MIX_SHADER_ID = 'vj-mix/render';

// Mirrors native-renderer/src/compositor.rs blend_mode_code — the per-row
// blend the compositor would apply is reproduced inside the mix pass.
export const VJ_MIX_BLEND_CODES: Record<string, number> = {
  normal: 0,
  add: 1,
  plus: 1,
  'linear-dodge': 1,
  multiply: 2,
  screen: 3,
  overlay: 4,
  subtract: 5,
  minus: 5,
  difference: 6,
  lighten: 7,
  darken: 8,
  average: 9,
  avg: 9,
  hardlight: 10,
  'hard-light': 10,
  softlight: 11,
  'soft-light': 11,
  exclusion: 12,
  'color-dodge': 13,
  colordodge: 13,
  dodge: 13,
  'color-burn': 14,
  colorburn: 14,
  burn: 14,
  hue: 15,
  saturation: 16,
  color: 17,
  luminosity: 18,
  luma: 18,
  divide: 19,
  negation: 20,
  phoenix: 21,
  'linear-light': 22,
  linearlight: 22,
  'hard-mix': 23,
  hardmix: 23,
  'vivid-light': 24,
  vividlight: 24,
  'pin-light': 25,
  pinlight: 25,
};

export function vjMixBlendModeCode(mode: string | null | undefined): number {
  const normalized = String(mode ?? '').trim().toLowerCase().replace(/_/g, '-');
  return VJ_MIX_BLEND_CODES[normalized] ?? VJ_MIX_BLEND_CODES[normalized.replace(/-/g, '')] ?? 0;
}

// Uniform layout — 48 bytes / 12 f32 slots. The core identifies this graph
// by byte length and rewrites slot 3 (time) every frame (same convention as
// the VJ crossfade uniform):
//   [0] width  [1] height  [2] source (row) opacity  [3] time
//   [4] blend mode code    [5] isFirst (clear accumulator flag)
//   [6..11] padding
export const VJ_MIX_UNIFORM_BYTES = 48;

export const VJ_MIX_WGSL = /* wgsl */ `
struct MixUniforms {
  dims: vec2<f32>,
  srcOpacity: f32,
  time: f32,
  blendMode: f32,
  isFirst: f32,
  pad0: vec2<f32>,
  pad1: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: MixUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var texDst: texture_2d<f32>;
@group(0) @binding(3) var texSrc: texture_2d<f32>;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
  var out: VsOut;
  let x = f32(i32(vid & 1u) * 4 - 1);
  let y = f32(i32(vid >> 1u) * 4 - 1);
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
  return out;
}

// Match the compositor's display normalization (heartbeat.wgsl
// source_content_for_layer): native-shader sources encode brightness in
// alpha and are unpremultiplied before display. Mandatory — sampling raw
// FS-shader frames without this mixes out near-black.
fn normalizeSample(c: vec4<f32>) -> vec4<f32> {
  if (c.a > 0.0001) {
    return vec4<f32>(c.rgb / c.a, c.a);
  }
  return c;
}

fn mixRgbToHsv(c: vec3<f32>) -> vec3<f32> {
  let cmax = max(c.r, max(c.g, c.b));
  let cmin = min(c.r, min(c.g, c.b));
  let delta = cmax - cmin;
  var h = 0.0;
  if (delta > 0.00001) {
    if (cmax == c.r) {
      h = ((c.g - c.b) / delta) % 6.0;
    } else if (cmax == c.g) {
      h = (c.b - c.r) / delta + 2.0;
    } else {
      h = (c.r - c.g) / delta + 4.0;
    }
    h = h / 6.0;
    if (h < 0.0) { h = h + 1.0; }
  }
  var s = 0.0;
  if (cmax > 0.00001) { s = delta / cmax; }
  return vec3<f32>(h, s, cmax);
}

fn mixHsvToRgb(c: vec3<f32>) -> vec3<f32> {
  let h = c.x * 6.0;
  let s = clamp(c.y, 0.0, 1.0);
  let v = clamp(c.z, 0.0, 1.0);
  let i = floor(h);
  let f = h - i;
  let p = v * (1.0 - s);
  let q = v * (1.0 - s * f);
  let t = v * (1.0 - s * (1.0 - f));
  let idx = i32(i) % 6;
  if (idx == 0) { return vec3<f32>(v, t, p); }
  if (idx == 1) { return vec3<f32>(q, v, p); }
  if (idx == 2) { return vec3<f32>(p, v, t); }
  if (idx == 3) { return vec3<f32>(p, q, v); }
  if (idx == 4) { return vec3<f32>(t, p, v); }
  return vec3<f32>(v, p, q);
}

// Port of native_blend (native-renderer/src/heartbeat.wgsl) — codes from
// compositor.rs blend_mode_code. Mode 26 (hierarchy-mask) is not a color
// blend and falls through to normal.
fn nativeBlend(dst_in: vec3<f32>, src_in: vec3<f32>, alpha: f32, mode: f32) -> vec3<f32> {
  let dst = clamp(dst_in, vec3<f32>(0.0), vec3<f32>(1.5));
  let src = clamp(src_in, vec3<f32>(0.0), vec3<f32>(1.5));
  let m = i32(floor(mode + 0.5));
  var blended = src;
  if (m == 1) {
    blended = clamp(dst + src, vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 2) {
    blended = dst * src;
  } else if (m == 3) {
    blended = vec3<f32>(1.0) - (vec3<f32>(1.0) - dst) * (vec3<f32>(1.0) - src);
  } else if (m == 4) {
    blended = select(2.0 * dst * src, vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - dst) * (vec3<f32>(1.0) - src), dst > vec3<f32>(0.5));
  } else if (m == 5) {
    blended = max(dst - src, vec3<f32>(0.0));
  } else if (m == 6) {
    blended = abs(dst - src);
  } else if (m == 7) {
    blended = max(dst, src);
  } else if (m == 8) {
    blended = min(dst, src);
  } else if (m == 9) {
    blended = (dst + src) * 0.5;
  } else if (m == 10) {
    blended = select(2.0 * dst * src, vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - dst) * (vec3<f32>(1.0) - src), src > vec3<f32>(0.5));
  } else if (m == 11) {
    blended = (vec3<f32>(1.0) - 2.0 * src) * dst * dst + 2.0 * src * dst;
  } else if (m == 12) {
    blended = dst + src - 2.0 * dst * src;
  } else if (m == 13) {
    blended = clamp(dst / max(vec3<f32>(1.0) - src, vec3<f32>(0.001)), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 14) {
    blended = clamp(vec3<f32>(1.0) - ((vec3<f32>(1.0) - dst) / max(src, vec3<f32>(0.001))), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 15) {
    let dh = mixRgbToHsv(clamp(dst, vec3<f32>(0.0), vec3<f32>(1.0)));
    let sh = mixRgbToHsv(clamp(src, vec3<f32>(0.0), vec3<f32>(1.0)));
    blended = mixHsvToRgb(vec3<f32>(sh.x, dh.y, dh.z));
  } else if (m == 16) {
    let dh = mixRgbToHsv(clamp(dst, vec3<f32>(0.0), vec3<f32>(1.0)));
    let sh = mixRgbToHsv(clamp(src, vec3<f32>(0.0), vec3<f32>(1.0)));
    blended = mixHsvToRgb(vec3<f32>(dh.x, sh.y, dh.z));
  } else if (m == 17) {
    let dh = mixRgbToHsv(clamp(dst, vec3<f32>(0.0), vec3<f32>(1.0)));
    let sh = mixRgbToHsv(clamp(src, vec3<f32>(0.0), vec3<f32>(1.0)));
    blended = mixHsvToRgb(vec3<f32>(sh.x, sh.y, dh.z));
  } else if (m == 18) {
    let dh = mixRgbToHsv(clamp(dst, vec3<f32>(0.0), vec3<f32>(1.0)));
    let sh = mixRgbToHsv(clamp(src, vec3<f32>(0.0), vec3<f32>(1.0)));
    blended = mixHsvToRgb(vec3<f32>(dh.x, dh.y, sh.z));
  } else if (m == 19) {
    blended = clamp(dst / max(src, vec3<f32>(0.001)), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 20) {
    blended = clamp(vec3<f32>(1.0) - abs(vec3<f32>(1.0) - dst - src), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 21) {
    blended = clamp(min(dst, src) - max(dst, src) + vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 22) {
    blended = clamp(dst + 2.0 * src - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 23) {
    let linear_light = clamp(dst + 2.0 * src - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
    blended = step(vec3<f32>(0.5), linear_light);
  } else if (m == 24) {
    let burn = vec3<f32>(1.0) - ((vec3<f32>(1.0) - dst) / max(2.0 * src, vec3<f32>(0.001)));
    let dodge = dst / max(2.0 * (vec3<f32>(1.0) - src), vec3<f32>(0.001));
    blended = clamp(select(burn, dodge, src >= vec3<f32>(0.5)), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 25) {
    let low = min(dst, 2.0 * src);
    let high = max(dst, 2.0 * src - vec3<f32>(1.0));
    blended = clamp(select(low, high, src >= vec3<f32>(0.5)), vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return mix(dst_in, blended, clamp(alpha, 0.0, 1.0));
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0));
  var dst = vec4<f32>(0.0);
  if (u.isFirst < 0.5) {
    dst = normalizeSample(textureSampleLevel(texDst, samp, uv, 0.0));
  }
  let src = normalizeSample(textureSampleLevel(texSrc, samp, uv, 0.0));
  let opacity = clamp(u.srcOpacity, 0.0, 1.0);
  // Coverage = source alpha × row opacity, matching the compositor's layer
  // alpha application. Preserve accumulated coverage (no forced opaque) so
  // an all-transparent mix stays transparent over the stack below.
  let cover = clamp(src.a, 0.0, 1.0) * opacity;
  let outRgb = nativeBlend(dst.rgb, src.rgb, cover, u.blendMode);
  let outA = clamp(dst.a + cover * (1.0 - dst.a), 0.0, 1.0);
  // RGB is re-premultiplied by coverage: the compositor unpremultiplies
  // native source frames before applying their alpha (same convention the
  // crossfade output uses).
  return vec4<f32>(outRgb * outA, outA);
}
`;

export function buildVJMixPrecompileCommands() {
  return [
    {
      type: 'precompile_shader' as const,
      shader_id: VJ_MIX_SHADER_ID,
      stage: 'render',
      source: VJ_MIX_WGSL,
      entry: 'fsMain',
    },
  ];
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export type VJMixRow = {
  /** `layer-frame:<layerId>` id of the row's composited frame — the
   *  vj-xfade carrier when the row is crossfading, else the plain row. */
  frameId: string;
  /** Post-crossfade row opacity (crossfade rows bake bank opacity → 1). */
  opacity: number;
  /** Per-row blend mode name (compositor blend_mode_code vocabulary). */
  blendMode: string;
};

export type VJMixGraphOptions = {
  /** Scene-layer source id the mixed frame composites into. */
  outputSourceId: string;
  /** Rows ordered bottom→top. */
  rows: VJMixRow[];
  width: number;
  height: number;
  time: number;
  frameIndex: number;
};

export type VJMixUniformOptions = Pick<
  VJMixGraphOptions,
  'outputSourceId' | 'rows' | 'width' | 'height' | 'time'
>;

export type VJMixUniformUpdate = {
  buffers: Array<{ bufferId: string; initialB64: string }>;
  signature: string;
};

function vjMixPassUniformBufferId(outputSourceId: string, index: number): string {
  return `vjmix:${outputSourceId}:pass:${index}:uniform`;
}

export function buildVJMixUniformUpdate(options: VJMixUniformOptions): VJMixUniformUpdate {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const buffers: Array<{ bufferId: string; initialB64: string }> = [];
  const signatureParts: string[] = [String(width), String(height)];
  options.rows.forEach((row, index) => {
    const buffer = new ArrayBuffer(VJ_MIX_UNIFORM_BYTES);
    const f = new Float32Array(buffer);
    const opacity = Math.max(0, Math.min(1, row.opacity));
    const blendCode = vjMixBlendModeCode(row.blendMode);
    f[0] = width;
    f[1] = height;
    f[2] = opacity;
    f[3] = options.time;
    f[4] = blendCode;
    f[5] = index === 0 ? 1 : 0;
    buffers.push({
      bufferId: vjMixPassUniformBufferId(options.outputSourceId, index),
      initialB64: bufferToBase64(buffer),
    });
    // Time is core-owned and changes every frame, so it is intentionally
    // not part of the renderer-sync change signature.
    signatureParts.push(`${row.frameId}:${opacity.toFixed(6)}:${blendCode}`);
  });
  return { buffers, signature: signatureParts.join('|') };
}

export function buildVJMixGraph(options: VJMixGraphOptions) {
  if (!options.rows.length) {
    throw new Error('Native VJ mix graph requires at least one row');
  }
  const uniform = buildVJMixUniformUpdate(options);
  const lastIndex = options.rows.length - 1;
  const renderPasses = options.rows.map((row, index) => {
    const dstBinding = index === 0
      ? { binding: 2, kind: 'source-frame-texture', allow_missing: true }
      : {
          binding: 2,
          kind: 'source-frame-texture',
          source_id: `${options.outputSourceId}:step:${(index - 1) % 2}`,
        };
    return {
      name: `vj-mix-${index}`,
      shader_id: VJ_MIX_SHADER_ID,
      vertex_entry: 'vsMain',
      fragment_entry: 'fsMain',
      target: 'source_frame',
      source_id: index === lastIndex
        ? options.outputSourceId
        : `${options.outputSourceId}:step:${index % 2}`,
      // Higher seq than the vj-xfade passes (seq: frameIndex) so the mix
      // consumes this frame's crossfade output, not last frame's.
      seq: options.frameIndex * 16 + 8 + index,
      clear: true,
      generate_mips: false,
      blend: 'replace',
      vertex_count: 3,
      instance_count: 1,
      bindings: [
        { binding: 0, resource: uniform.buffers[index].bufferId, kind: 'uniform' },
        { binding: 1, kind: 'source-frame-sampler' },
        dstBinding,
        { binding: 3, kind: 'source-frame-texture', source_id: row.frameId },
      ],
    };
  });
  return {
    config: {
      buffers: uniform.buffers.map((entry) => ({
        id: entry.bufferId,
        kind: 'uniform',
        byte_length: VJ_MIX_UNIFORM_BYTES,
        initial_b64: entry.initialB64,
      })),
      passes: [],
      render_passes: renderPasses,
      readbacks: [],
    },
  };
}
