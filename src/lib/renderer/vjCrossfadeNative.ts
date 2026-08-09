/**
 * Native VJ A/B crossfade — WGSL port of the browser transition library
 * (crossfadeTransitions.ts), rendered by the core as a two-input compute
 * -graph pass: Bank A's and Bank B's composited source frames in, one mixed
 * frame out. Transition selection, mix, bank opacity, blend mode, and time
 * ride a 48-byte uniform; the core rewrites time every frame (byte-length
 * dispatch, same pattern as the GhostFX layouts) while live control changes
 * update the installed uniform buffer in place.
 *
 * Design rule carried over verbatim from the browser library: the MIDPOINT
 * of every transition is its peak visual moment, and a 2% dead zone at each
 * fader end guarantees clean pure-A / pure-B frames.
 */

export const VJ_CROSSFADE_SHADER_ID = 'vj-crossfade/render';

export const VJ_CROSSFADE_TRANSITION_IDS: Record<string, number> = {
  dissolve: 0,
  wipe: 1,
  'rgb-split': 2,
  cube: 3,
  shatter: 4,
  halftone: 5,
  glitch: 6,
  liquid: 7,
  strobe: 8,
  slide: 9,
};

export const VJ_CROSSFADE_BLEND_IDS: Record<string, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  add: 3,
  difference: 4,
  darken: 5,
  lighten: 6,
  overlay: 7,
  exclusion: 8,
};

// Uniform layout — 48 bytes / 12 f32 slots. The core identifies this graph
// by byte length and rewrites slot 3 (time) every frame:
//   [0] width  [1] height  [2] mix (post-curve)  [3] time
//   [4] transition id      [5] blend mode id
//   [6] Bank A opacity     [7] Bank B opacity    [8..11] padding
export const VJ_CROSSFADE_UNIFORM_BYTES = 48;

export const VJ_CROSSFADE_WGSL = /* wgsl */ `
struct XfadeUniforms {
  dims: vec2<f32>,
  mixv: f32,
  time: f32,
  transition: f32,
  blendMode: f32,
  bankOpacity: vec2<f32>,
  pad1: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: XfadeUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;

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
// alpha and are unpremultiplied before display. Sampling the raw texture
// without this made every FS-shader bank mix out near-black.
fn normalizeSample(c: vec4<f32>) -> vec4<f32> {
  if (c.a > 0.0001) {
    return vec4<f32>(c.rgb / c.a, c.a);
  }
  return c;
}
fn sampleA(uv: vec2<f32>) -> vec4<f32> {
  let c = normalizeSample(textureSampleLevel(texA, samp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0));
  let opacity = clamp(u.bankOpacity.x, 0.0, 1.0);
  return vec4<f32>(c.rgb * opacity, opacity);
}
fn sampleB(uv: vec2<f32>) -> vec4<f32> {
  let c = normalizeSample(textureSampleLevel(texB, samp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0));
  let opacity = clamp(u.bankOpacity.y, 0.0, 1.0);
  return vec4<f32>(c.rgb * opacity, opacity);
}

fn xfHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn xfNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(xfHash(i), xfHash(i + vec2<f32>(1.0, 0.0)), f.x),
    mix(xfHash(i + vec2<f32>(0.0, 1.0)), xfHash(i + vec2<f32>(1.0, 1.0)), f.x),
    f.y,
  );
}

// Per-channel blend math — mirrors the browser xfBlend exactly.
fn xfBlend(a: vec3<f32>, b: vec3<f32>, mode: i32) -> vec3<f32> {
  if (mode == 1) { return a * b; }
  if (mode == 2) { return vec3<f32>(1.0) - (vec3<f32>(1.0) - a) * (vec3<f32>(1.0) - b); }
  if (mode == 3) { return min(a + b, vec3<f32>(1.0)); }
  if (mode == 4) { return abs(a - b); }
  if (mode == 5) { return min(a, b); }
  if (mode == 6) { return max(a, b); }
  if (mode == 7) {
    let lo = 2.0 * a * b;
    let hi = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - a) * (vec3<f32>(1.0) - b);
    return mix(lo, hi, step(vec3<f32>(0.5), a));
  }
  if (mode == 8) { return a + b - 2.0 * a * b; }
  return mix(a, b, 0.5);
}

fn transitionColor(uv: vec2<f32>, m: f32, t: f32, transition: i32) -> vec4<f32> {
  // 0 · DISSOLVE — constant-power so 50/50 has no luminance valley.
  if (transition == 0) {
    let ka = cos(m * 1.5707963);
    let kb = sin(m * 1.5707963);
    return sampleA(uv) * ka + sampleB(uv) * kb;
  }
  // 1 · HARD WIPE — slight diagonal, exact 50/50 split at midpoint.
  if (transition == 1) {
    let wipeAt = m + (uv.y - 0.5) * 0.06;
    let side = step(uv.x, wipeAt);
    return mix(sampleB(uv), sampleA(uv), 1.0 - side);
  }
  // 2 · RGB SPLIT — chromatic aberration peaks at midpoint.
  if (transition == 2) {
    let intensity = 1.0 - abs(2.0 * m - 1.0);
    let offset = intensity * 0.04;
    let a = vec4<f32>(
      sampleA(uv + vec2<f32>(-offset, 0.0)).r,
      sampleA(uv).g,
      sampleA(uv + vec2<f32>(offset, 0.0)).b,
      1.0,
    );
    let b = vec4<f32>(
      sampleB(uv + vec2<f32>(-offset, 0.0)).r,
      sampleB(uv).g,
      sampleB(uv + vec2<f32>(offset, 0.0)).b,
      1.0,
    );
    return mix(a, b, smoothstep(0.0, 1.0, m));
  }
  // 3 · CUBE — 90° face rotation, edge-on hinge at midpoint.
  if (transition == 3) {
    let angle = m * 1.5707963;
    let ca = cos(angle);
    let x = uv.x * 2.0 - 1.0;
    let edgeX = ca * 2.0 - 1.0;
    var col: vec4<f32>;
    if (x < edgeX) {
      let uCoord = (x + 1.0) / (edgeX + 1.0);
      let shade = mix(1.0, 0.65, smoothstep(0.6, 1.0, uCoord));
      col = sampleA(vec2<f32>(uCoord, uv.y)) * shade;
    } else {
      let uCoord = (x - edgeX) / (1.0 - edgeX);
      let shade = mix(0.65, 1.0, smoothstep(0.0, 0.4, uCoord));
      col = sampleB(vec2<f32>(uCoord, uv.y)) * shade;
    }
    let seam = smoothstep(0.012, 0.0, abs(x - edgeX));
    return vec4<f32>(mix(col.rgb, vec3<f32>(1.0), seam * 0.45), col.a);
  }
  // 4 · SHATTER — A breaks into drifting shards revealing B.
  if (transition == 4) {
    let cellSize = vec2<f32>(1.0 / 12.0, 1.0 / 7.0);
    let cellId = floor(uv / cellSize);
    let cellUV = fract(uv / cellSize);
    let delay = xfHash(cellId) * 0.4;
    let local = clamp((m - delay) / (1.0 - delay), 0.0, 1.0);
    var dir = normalize(vec2<f32>(xfHash(cellId + 1.7) - 0.5, xfHash(cellId + 3.3) - 0.5));
    dir.y = dir.y - 0.6;
    let cellOffset = dir * local * 0.55;
    let sampleUv = uv - cellOffset;
    var a = sampleA(sampleUv);
    var aAlpha = 1.0 - smoothstep(0.7, 1.0, local);
    if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) {
      aAlpha = 0.0;
    }
    let b = sampleB(uv);
    let edgeDist = min(cellUV, vec2<f32>(1.0) - cellUV);
    let crack = smoothstep(0.04, 0.0, min(edgeDist.x, edgeDist.y));
    a = vec4<f32>(mix(a.rgb, vec3<f32>(0.0), crack * aAlpha * 0.55), a.a);
    return mix(b, a, aAlpha);
  }
  // 5 · HALFTONE — pop-art dot reveal, peak density at midpoint.
  if (transition == 5) {
    let density = 1.0 - abs(m - 0.5) * 2.0;
    let dotR = 0.6 + m * 0.5;
    let grid = fract(uv * 70.0) - 0.5;
    let d = length(grid);
    var dotMask = smoothstep(0.5 * dotR + 0.05, 0.5 * dotR - 0.05, d);
    dotMask = dotMask * density;
    let base = mix(sampleA(uv), sampleB(uv), m);
    return mix(base, sampleB(uv), dotMask);
  }
  // 6 · GLITCH — datamosh block scramble, peak chaos at midpoint.
  if (transition == 6) {
    let intensity = 1.0 - abs(2.0 * m - 1.0);
    let blockSize = mix(80.0, 22.0, intensity);
    let block = floor(uv * blockSize);
    let r = xfHash(block + floor(t * 12.0));
    let shift = (r - 0.5) * intensity * 0.18;
    let vshift = (xfHash(block + 7.7) - 0.5) * intensity * 0.05;
    let sampleUv = uv + vec2<f32>(shift, vshift);
    let pickB = step(xfHash(block + 13.13), m);
    let sa = sampleA(sampleUv);
    let sb = sampleB(sampleUv);
    var col = mix(sa, sb, pickB);
    if (intensity > 0.5) {
      let pickRedB = step(xfHash(block + 23.7), m);
      let pickBlueB = step(xfHash(block + 41.1), m);
      col.r = mix(sa.r, sb.r, pickRedB);
      col.b = mix(sa.b, sb.b, pickBlueB);
    }
    return col;
  }
  // 7 · LIQUID — noise-displaced flow morph.
  if (transition == 7) {
    let intensity = 1.0 - abs(2.0 * m - 1.0);
    let disp = intensity * 0.09;
    let nUV = uv * 4.0 + t * 0.12;
    let n1 = xfNoise(nUV);
    let n2 = xfNoise(nUV + 13.7);
    let offset = vec2<f32>(n1 - 0.5, n2 - 0.5) * disp;
    let a = sampleA(uv + offset);
    let b = sampleB(uv - offset);
    return mix(a, b, smoothstep(0.0, 1.0, m));
  }
  // 8 · STROBE — hard A/B alternation, fastest at midpoint.
  if (transition == 8) {
    let intensity = 1.0 - abs(2.0 * m - 1.0);
    let rate = 2.0 + intensity * 22.0;
    let phase = fract(t * rate);
    let showA = step(phase, 1.0 - m);
    return mix(sampleB(uv), sampleA(uv), showA);
  }
  // 9 · SLIDE — A slides off left, B slides in from the right.
  if (transition == 9) {
    let aUv = uv + vec2<f32>(m, 0.0);
    let bUv = uv + vec2<f32>(m - 1.0, 0.0);
    let inA = aUv.x >= 0.0 && aUv.x <= 1.0;
    let inB = bUv.x >= 0.0 && bUv.x <= 1.0;
    var col = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    if (inA && !inB) {
      col = sampleA(aUv);
    } else if (inB) {
      col = sampleB(bUv);
    }
    let seamA = smoothstep(0.018, 0.0, aUv.x);
    let seamB = smoothstep(0.018, 0.0, 1.0 - bUv.x);
    return vec4<f32>(mix(col.rgb, vec3<f32>(1.0), max(seamA, seamB) * 0.4), col.a);
  }
  // Unknown id — constant-power dissolve, never black.
  let ka = cos(m * 1.5707963);
  let kb = sin(m * 1.5707963);
  return sampleA(uv) * ka + sampleB(uv) * kb;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let m = clamp(u.mixv, 0.0, 1.0);
  let transition = i32(u.transition + 0.5);
  var color = transitionColor(in.uv, m, u.time, transition);

  // Blend-mode tint over the overlap zone — transition journey preserved,
  // mixed pixels tinted by the selected per-channel math.
  let blendMode = i32(u.blendMode + 0.5);
  if (blendMode != 0) {
    let a = sampleA(in.uv).rgb;
    let b = sampleB(in.uv).rgb;
    let blended = xfBlend(a, b, blendMode);
    let overlap = 1.0 - abs(m - 0.5) * 2.0;
    color = vec4<f32>(mix(color.rgb, blended, overlap), color.a);
  }

  // 2% dead zone at each end: operators expect fader-at-end = clean bank,
  // no residual seams/cracks/slivers from the transition math.
  let DEAD_ZONE = 0.02;
  if (m < DEAD_ZONE) {
    color = mix(sampleA(in.uv), color, smoothstep(0.0, DEAD_ZONE, m));
  } else if (m > 1.0 - DEAD_ZONE) {
    color = mix(color, sampleB(in.uv), smoothstep(1.0 - DEAD_ZONE, 1.0, m));
  }
  // RGB is premultiplied by the independently-controlled bank opacity.
  // The compositor unpremultiplies native source frames before applying
  // their alpha, so preserving coverage here lets lower VJ rows show
  // through instead of turning a faded bank into an opaque black plate.
  return vec4<f32>(color.rgb, clamp(color.a, 0.0, 1.0));
}
`;

export function buildVJCrossfadePrecompileCommands() {
  return [
    {
      type: 'precompile_shader' as const,
      shader_id: VJ_CROSSFADE_SHADER_ID,
      stage: 'render',
      source: VJ_CROSSFADE_WGSL,
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

export type VJCrossfadeGraphOptions = {
  /** Scene-layer source id the mixed frame composites into. */
  outputSourceId: string;
  /** Bank A composited source frame id. */
  sourceAId: string;
  /** Bank B composited source frame id. */
  sourceBId: string;
  width: number;
  height: number;
  /** Post-curve fader value, 0 = pure A, 1 = pure B. */
  mix: number;
  transition: string;
  blendMode: string;
  opacityA: number;
  opacityB: number;
  time: number;
  frameIndex: number;
};

export type VJCrossfadeUniformOptions = Pick<
  VJCrossfadeGraphOptions,
  'outputSourceId' | 'width' | 'height' | 'mix' | 'transition' | 'blendMode' | 'opacityA' | 'opacityB' | 'time'
>;

export type VJCrossfadeUniformUpdate = {
  bufferId: string;
  initialB64: string;
  signature: string;
};

export function buildVJCrossfadeUniformUpdate(
  options: VJCrossfadeUniformOptions,
): VJCrossfadeUniformUpdate {
  const buffer = new ArrayBuffer(VJ_CROSSFADE_UNIFORM_BYTES);
  const f = new Float32Array(buffer);
  f[0] = Math.max(1, options.width);
  f[1] = Math.max(1, options.height);
  f[2] = Math.max(0, Math.min(1, options.mix));
  f[3] = options.time;
  f[4] = VJ_CROSSFADE_TRANSITION_IDS[options.transition] ?? 0;
  f[5] = VJ_CROSSFADE_BLEND_IDS[options.blendMode] ?? 0;
  f[6] = Math.max(0, Math.min(1, options.opacityA));
  f[7] = Math.max(0, Math.min(1, options.opacityB));
  return {
    bufferId: `vjxfade:${options.outputSourceId}:uniform`,
    initialB64: bufferToBase64(buffer),
    // Time is core-owned and changes every frame, so it is intentionally not
    // part of the renderer-sync change signature.
    signature: [
      Math.max(1, options.width),
      Math.max(1, options.height),
      Math.max(0, Math.min(1, options.mix)).toFixed(6),
      VJ_CROSSFADE_TRANSITION_IDS[options.transition] ?? 0,
      VJ_CROSSFADE_BLEND_IDS[options.blendMode] ?? 0,
      Math.max(0, Math.min(1, options.opacityA)).toFixed(6),
      Math.max(0, Math.min(1, options.opacityB)).toFixed(6),
    ].join(':'),
  };
}

export function buildVJCrossfadeGraph(options: VJCrossfadeGraphOptions) {
  const uniform = buildVJCrossfadeUniformUpdate(options);
  return {
    config: {
      buffers: [
        {
          id: uniform.bufferId,
          kind: 'uniform',
          byte_length: VJ_CROSSFADE_UNIFORM_BYTES,
          initial_b64: uniform.initialB64,
        },
      ],
      passes: [],
      render_passes: [
        {
          name: 'vj-crossfade',
          shader_id: VJ_CROSSFADE_SHADER_ID,
          vertex_entry: 'vsMain',
          fragment_entry: 'fsMain',
          target: 'source_frame',
          source_id: options.outputSourceId,
          seq: options.frameIndex,
          clear: true,
          generate_mips: false,
          blend: 'replace',
          vertex_count: 3,
          instance_count: 1,
          bindings: [
            { binding: 0, resource: uniform.bufferId, kind: 'uniform' },
            { binding: 1, kind: 'source-frame-sampler' },
            { binding: 2, kind: 'source-frame-texture', source_id: options.sourceAId },
            { binding: 3, kind: 'source-frame-texture', source_id: options.sourceBId },
          ],
        },
      ],
      readbacks: [],
    },
  };
}
