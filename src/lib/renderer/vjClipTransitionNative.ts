import { createLayer, type Layer } from '../types';
import {
  VJ_CROSSFADE_BLEND_IDS,
  VJ_CROSSFADE_TRANSITION_IDS,
  VJ_CROSSFADE_WGSL,
} from './vjCrossfadeNative';

export const VJ_CLIP_TRANSITION_SHADER_ID = 'vj-clip-transition/render';
/** Core updates time (slot 3) and the two source rectangles (slots 28/52). */
export const VJ_CLIP_TRANSITION_UNIFORM_BYTES = 224;
export type VJClipTransitionState = {
  outgoing: Layer;
  progress: number;
  style: string;
  snapshotSourceId?: string;
  token?: number | string;
  duration?: number;
  running?: boolean;
};
export type VJClipTransitionBranch = {
  layer: Layer;
  opacity: number;
  /** GPU graph and shader frames already encode premultiplied coverage. */
  premultiplied: boolean;
  uvTransform: readonly number[];
  uvFlags: readonly number[];
  ready?: boolean;
};
export type VJClipTransitionGraphOptions = {
  outputSourceId: string;
  sourceAId: string;
  sourceBId: string;
  width: number;
  height: number;
  mix: number;
  transition: string;
  blendMode?: string;
  branchA: VJClipTransitionBranch;
  branchB: VJClipTransitionBranch;
  time: number;
  frameIndex: number;
};

export function vjClipTransitionInputId(canonicalLayerId: string, side: 'in' | 'out', token: number | string = 0): string {
  return `__vj-clip:${canonicalLayerId}:${token}:${side}`;
}

export function vjClipTransitionSourceId(canonicalLayerId: string): string {
  return `plugin:${canonicalLayerId}:vj-crossfade`;
}

const clamp01 = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

/** A graph result is a full-canvas picture: do not reapply input geometry or FX. */
export function neutralVJClipTransitionLayer(layer: Layer): Layer {
  const neutral = createLayer(layer.id, layer.name, 'media');
  return {
    ...neutral,
    visible: layer.visible,
    locked: layer.locked,
    opacity: 1,
    blendMode: layer.blendMode,
    bank: layer.bank,
    contentFit: 'stretch',
    _deckMonitorBank: layer._deckMonitorBank,
    _deckMonitorOpacity: layer._deckMonitorOpacity,
  };
}

/** Used both for a row's clip change and for the surrounding A/B bank mix. */
export function makeVJClipTransitionCarrier(
  base: Layer,
  outgoingLayerId: string,
  incomingLayerId: string,
  progress: number,
  style: string,
  overrides: {
    id?: string;
    sourceAId?: string;
    opacityA?: number;
    opacityB?: number;
    blendMode?: string;
    active?: boolean;
    clockToken?: number | string;
    clockDuration?: number;
    clockRunning?: boolean;
  } = {},
): Layer {
  const id = overrides.id ?? base.id;
  return {
    ...neutralVJClipTransitionLayer(base),
    id,
    source: {
      id: `vj-clip-transition-src:${id}`,
      type: 'effect',
      name: base.name,
      src: `plugin://vj-crossfade/clip/${id}`,
      effectSource: {
        effectType: 'vj-crossfade',
        vjclipTransition: true,
        vjclipTransitionActive: overrides.active === true,
        vjclipClockToken: overrides.clockToken,
        vjclipClockDuration: overrides.clockDuration,
        vjclipClockRunning: overrides.clockRunning === true,
        vjxfadeLayerA: outgoingLayerId,
        vjxfadeLayerB: incomingLayerId,
        vjclipSourceA: overrides.sourceAId,
        vjxfadeOpacityA: overrides.opacityA ?? 1,
        vjxfadeOpacityB: overrides.opacityB ?? 1,
        vjxfadeMix: clamp01(progress),
        vjxfadeTransition: style,
        vjxfadeBlend: overrides.blendMode ?? 'normal',
      },
    } as NonNullable<Layer['source']>,
  };
}

/** Retain only active branches; canonical IDs remain stable for decks and Stage feeds. */
export function buildVJClipTransitionLayers(
  layers: Layer[],
  transitions: ReadonlyMap<string, VJClipTransitionState>,
  wrapInactive = false,
): Layer[] {
  if (!transitions.size && !wrapInactive) return layers;
  const result: Layer[] = [];
  for (const incoming of layers) {
    const state = transitions.get(incoming.id);
    if (!state || state.progress >= 1) {
      if (!wrapInactive) { result.push(incoming); continue; }
      // Keep the canonical picture in canvas space after a fade finishes.
      // Decks and VJ Mix sample layer-frame directly, before the compositor
      // applies geometry, so returning to a raw texture here causes a jump.
      const inputId = vjClipTransitionInputId(incoming.id, 'in', 'steady');
      result.push({ ...incoming, id: inputId, opacity: 0, bank: undefined,
        _deckMonitorBank: undefined, _deckMonitorOpacity: undefined });
      result.push(makeVJClipTransitionCarrier(incoming, inputId, inputId, 1, 'dissolve', {
        opacityA: incoming.opacity, opacityB: incoming.opacity,
      }));
      continue;
    }
    const incomingId = vjClipTransitionInputId(incoming.id, 'in', state.token);
    const outgoingId = vjClipTransitionInputId(incoming.id, 'out', state.token);
    const hide = (layer: Layer, id: string): Layer => ({
      ...layer, id, opacity: 0, bank: undefined,
      _deckMonitorBank: undefined, _deckMonitorOpacity: undefined,
    });
    // A frozen transition is already transformed and shaded. Its source frame
    // is bound directly; no scene layer or duplicate FX chain is needed.
    if (!state.snapshotSourceId) result.push(hide(state.outgoing, outgoingId));
    result.push(hide(incoming, incomingId));
    result.push(makeVJClipTransitionCarrier(incoming, outgoingId, incomingId, state.progress, state.style, {
      sourceAId: state.snapshotSourceId,
      active: true,
      clockToken: state.token, clockDuration: state.duration, clockRunning: state.running,
      opacityA: state.snapshotSourceId ? 1 : state.outgoing.opacity,
      opacityB: incoming.opacity,
    }));
  }
  return result;
}

/** Inverse of VJ's affine corner transform, expressed in top-origin canvas UV. */
export function vjClipTransitionInverse(layer: Layer): { x: number[]; y: number[]; valid: boolean } {
  const c = layer.corners;
  const origin = [c.topLeft.x, 1 - c.topLeft.y];
  const x = [c.topRight.x - c.topLeft.x, c.topLeft.y - c.topRight.y];
  const y = [c.bottomLeft.x - c.topLeft.x, c.topLeft.y - c.bottomLeft.y];
  const det = x[0] * y[1] - x[1] * y[0];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-8) return { x: [0, 0, 0, 0], y: [0, 0, 0, 0], valid: false };
  const ix = [y[1] / det, -y[0] / det];
  const iy = [-x[1] / det, x[0] / det];
  return {
    x: [ix[0], ix[1], -ix[0] * origin[0] - ix[1] * origin[1], 0],
    y: [iy[0], iy[1], -iy[0] * origin[0] - iy[1] * origin[1], 0],
    valid: true,
  };
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export function buildVJClipTransitionUniformUpdate(options: VJClipTransitionGraphOptions) {
  const values = new Float32Array(VJ_CLIP_TRANSITION_UNIFORM_BYTES / 4);
  values.set([Math.max(1, options.width), Math.max(1, options.height), clamp01(options.mix), options.time,
    VJ_CROSSFADE_TRANSITION_IDS[options.transition] ?? 0, VJ_CROSSFADE_BLEND_IDS[options.blendMode ?? 'normal'] ?? 0,
    options.branchA.ready === false ? 0 : 1, options.branchB.ready === false ? 0 : 1]);
  const writeBranch = (branch: VJClipTransitionBranch, offset: number) => {
    const inverse = vjClipTransitionInverse(branch.layer);
    values.set(inverse.x, offset);
    values.set(inverse.y, offset + 4);
    values.set(branch.uvTransform, offset + 8);
    values.set(branch.uvFlags, offset + 12);
    values.set([clamp01(branch.opacity), branch.premultiplied ? 1 : 0, inverse.valid ? 1 : 0, 0], offset + 16);
    values.set([0, 0, 1, 1], offset + 20);
  };
  writeBranch(options.branchA, 8);
  writeBranch(options.branchB, 32);
  const initialB64 = bufferToBase64(values.buffer);
  values[3] = 0; // Core owns animation time; advancing it must not reinstall a graph.
  return {
    bufferId: `vjxfade:${options.outputSourceId}:uniform`,
    initialB64,
    signature: bufferToBase64(values.buffer),
  };
}

// Share the ten established transition shapes. The few coverage-unsafe bank
// conveniences are replaced here: transparent clips must reveal lower rows,
// channel offsets preserve alpha, and white seam highlights stay within coverage.
const transitionFunctions = VJ_CROSSFADE_WGSL
  .slice(VJ_CROSSFADE_WGSL.indexOf('fn xfHash'), VJ_CROSSFADE_WGSL.indexOf('@fragment'))
  .replaceAll('      1.0,\n    );', '      max(max(sampleA(uv + vec2<f32>(-offset, 0.0)).a, sampleA(uv).a), sampleA(uv + vec2<f32>(offset, 0.0)).a),\n    );')
  .replace('max(max(sampleA(uv + vec2<f32>(-offset, 0.0)).a, sampleA(uv).a), sampleA(uv + vec2<f32>(offset, 0.0)).a),\n    );\n    return mix(a, b', 'max(max(sampleB(uv + vec2<f32>(-offset, 0.0)).a, sampleB(uv).a), sampleB(uv + vec2<f32>(offset, 0.0)).a),\n    );\n    return mix(a, b')
  .replaceAll('vec3<f32>(1.0), seam * 0.45', 'vec3<f32>(col.a), seam * 0.45')
  .replaceAll('vec3<f32>(1.0), max(seamA, seamB) * 0.4', 'vec3<f32>(col.a), max(seamA, seamB) * 0.4')
  .replace('var col = vec4<f32>(0.0, 0.0, 0.0, 1.0);', 'var col = vec4<f32>(0.0);')
  .replace('col = sampleA(vec2<f32>(uCoord, uv.y)) * shade;', 'col = sampleA(vec2<f32>(uCoord, uv.y));\n      col = vec4<f32>(col.rgb * shade, col.a);')
  .replace('col = sampleB(vec2<f32>(uCoord, uv.y)) * shade;', 'col = sampleB(vec2<f32>(uCoord, uv.y));\n      col = vec4<f32>(col.rgb * shade, col.a);')
  .replace('col.b = mix(sa.b, sb.b, pickBlueB);', 'col.b = mix(sa.b, sb.b, pickBlueB);\n      col.a = max(col.a, max(mix(sa.a, sb.a, pickRedB), mix(sa.a, sb.a, pickBlueB)));');

export const VJ_CLIP_TRANSITION_WGSL = /* wgsl */ `
struct Branch {
  inverseX: vec4<f32>, inverseY: vec4<f32>,
  uvTransform: vec4<f32>, uvFlags: vec4<f32>,
  metadata: vec4<f32>, sourceRect: vec4<f32>,
};
struct ClipUniforms {
  dims: vec2<f32>, mixv: f32, time: f32,
  transition: f32, blendMode: f32, ready: vec2<f32>,
  a: Branch, b: Branch,
};
@group(0) @binding(0) var<uniform> u: ClipUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;
struct VsOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>, };
@vertex fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
  var out: VsOut;
  let x = f32(i32(vid & 1u) * 4 - 1);
  let y = f32(i32(vid >> 1u) * 4 - 1);
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
  return out;
}
fn branchUV(uv: vec2<f32>, b: Branch) -> vec3<f32> {
  let p = vec3<f32>(uv, 1.0);
  var q = vec2<f32>(dot(b.inverseX.xyz, p), dot(b.inverseY.xyz, p));
  if (b.metadata.z < 0.5 || any(q < vec2<f32>(0.0)) || any(q > vec2<f32>(1.0))) { return vec3<f32>(0.0); }
  if (b.uvFlags.z > 0.5) { q.x = 1.0 - q.x; }
  if (b.uvFlags.w > 0.5) { q.y = 1.0 - q.y; }
  let ratio = max(b.uvFlags.y, 0.0001);
  let fit = i32(b.uvFlags.x + 0.5);
  if (fit == 1) {
    if (ratio > 1.0) { q.x = (q.x - 0.5) / ratio + 0.5; }
    else { q.y = (q.y - 0.5) * ratio + 0.5; }
  } else if (fit == 2) {
    if (ratio > 1.0) { q.y = (q.y - 0.5) * ratio + 0.5; }
    else { q.x = (q.x - 0.5) / ratio + 0.5; }
    if (any(q < vec2<f32>(0.0)) || any(q > vec2<f32>(1.0))) { return vec3<f32>(0.0); }
  }
  q = b.uvTransform.xy + q * b.uvTransform.zw;
  q = b.sourceRect.xy + q * b.sourceRect.zw;
  return vec3<f32>(q, 1.0);
}
fn premultiply(c: vec4<f32>, b: Branch) -> vec4<f32> {
  let alpha = clamp(c.a, 0.0, 1.0);
  if (alpha <= 0.0) { return vec4<f32>(0.0); }
  let rgb = select(c.rgb * alpha, c.rgb, b.metadata.y > 0.5);
  return vec4<f32>(rgb, alpha) * b.metadata.x;
}
fn sampleA(uv: vec2<f32>) -> vec4<f32> {
  let q = branchUV(uv, u.a);
  if (q.z < 0.5) { return vec4<f32>(0.0); }
  let halfTexel = vec2<f32>(0.5) / vec2<f32>(textureDimensions(texA));
  let sampleUv = clamp(q.xy, u.a.sourceRect.xy + halfTexel, u.a.sourceRect.xy + u.a.sourceRect.zw - halfTexel);
  return premultiply(textureSampleLevel(texA, samp, sampleUv, 0.0), u.a);
}
fn sampleB(uv: vec2<f32>) -> vec4<f32> {
  let q = branchUV(uv, u.b);
  if (q.z < 0.5) { return vec4<f32>(0.0); }
  let halfTexel = vec2<f32>(0.5) / vec2<f32>(textureDimensions(texB));
  let sampleUv = clamp(q.xy, u.b.sourceRect.xy + halfTexel, u.b.sourceRect.xy + u.b.sourceRect.zw - halfTexel);
  return premultiply(textureSampleLevel(texB, samp, sampleUv, 0.0), u.b);
}
${transitionFunctions}
@fragment fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  if (u.ready.y < 0.5) { return sampleA(in.uv); }
  if (u.ready.x < 0.5) { return sampleB(in.uv); }
  let m = clamp(u.mixv, 0.0, 1.0);
  if (m <= 0.0) { return sampleA(in.uv); }
  if (m >= 1.0) { return sampleB(in.uv); }
  var color = transitionColor(in.uv, m, u.time, i32(u.transition + 0.5));
  if (i32(u.blendMode + 0.5) != 0) {
    let a = sampleA(in.uv);
    let b = sampleB(in.uv);
    let overlap = (1.0 - abs(m - 0.5) * 2.0) * min(a.a, b.a);
    let blended = xfBlend(a.rgb / max(a.a, 0.0001), b.rgb / max(b.a, 0.0001), i32(u.blendMode + 0.5));
    color = vec4<f32>(mix(color.rgb, blended * color.a, overlap), color.a);
  }
  if (m < 0.02) { color = mix(sampleA(in.uv), color, smoothstep(0.0, 0.02, m)); }
  else if (m > 0.98) { color = mix(color, sampleB(in.uv), smoothstep(0.98, 1.0, m)); }
  return vec4<f32>(color.rgb, clamp(color.a, 0.0, 1.0));
}
`;

export function buildVJClipTransitionPrecompileCommands() {
  return [{ type: 'precompile_shader' as const, shader_id: VJ_CLIP_TRANSITION_SHADER_ID,
    stage: 'render', source: VJ_CLIP_TRANSITION_WGSL, entry: 'fsMain' }];
}

export function buildVJClipTransitionGraph(options: VJClipTransitionGraphOptions) {
  const uniform = buildVJClipTransitionUniformUpdate(options);
  return { config: {
    buffers: [{ id: uniform.bufferId, kind: 'uniform', byte_length: VJ_CLIP_TRANSITION_UNIFORM_BYTES, initial_b64: uniform.initialB64 }],
    passes: [],
    render_passes: [{
      name: 'vj-clip-transition', shader_id: VJ_CLIP_TRANSITION_SHADER_ID,
      vertex_entry: 'vsMain', fragment_entry: 'fsMain', target: 'source_frame', source_id: options.outputSourceId,
      seq: options.frameIndex, clear: true, generate_mips: false, blend: 'replace', vertex_count: 3, instance_count: 1,
      bindings: [
        { binding: 0, resource: uniform.bufferId, kind: 'uniform' },
        { binding: 1, kind: 'source-frame-sampler' },
        { binding: 2, kind: 'source-frame-texture', source_id: options.sourceAId },
        { binding: 3, kind: 'source-frame-texture', source_id: options.sourceBId },
      ],
    }],
    readbacks: [],
  } };
}

/** Compile the real pipeline before the first performance-time trigger. */
export function buildVJClipTransitionWarmupCommands(): Array<Record<string, unknown>> {
  const sourceId = 'warmup:vj-clip:src';
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const branch: VJClipTransitionBranch = {
    layer: createLayer('warmup:vj-clip', 'Transition warmup', 'media'),
    opacity: 1, premultiplied: false, uvTransform: [0, 0, 1, 1], uvFlags: [0, 1, 0, 0],
  };
  return [
    { type: 'upload_source_frame', source_id: sourceId, seq: 1, width: 16, height: 16, rgba_b64: bufferToBase64(rgba.buffer) },
    { type: 'queue_compute_graph', ...buildVJClipTransitionGraph({
      outputSourceId: 'warmup:vj-clip:out', sourceAId: sourceId, sourceBId: sourceId,
      width: 16, height: 16, mix: 0, transition: 'dissolve',
      branchA: branch, branchB: branch, time: 0, frameIndex: 0,
    }).config },
  ];
}
