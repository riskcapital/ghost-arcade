/**
 * Analog Synth's render graph. Installed once on a `videosynth` layer and drawn
 * by the core every frame: the core writes the clock and audio into the
 * frame block, so the patch only goes out when a control moves.
 *
 *   synth  oscillators, mixer, picture, feedback from `prev` → `next`
 *   keep   `next` → `prev`, for the next frame's feedback
 *   out    `next` through the tube → the layer's source
 */
import { scene3dFrameBuffer } from '../renderer/scene3dFrame';
import { INPUT_LAYER_KEY, paramBlock } from './patch';
import { VIDEOSYNTH_SHADER_ID } from './shaders';

export type VideoSynthGraph = {
  config: { textures: object[]; buffers: object[]; passes: object[]; render_passes: object[]; readbacks: [] };
  topology: string;
  values: { id: string; initial_b64: string }[];
};

function b64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
  return btoa(s);
}

/** The picture is drawn at the output's shape, long side at most `maxSide`. */
export function buildVideoSynthGraph(options: {
  params: Record<string, unknown> | null | undefined;
  sourceId: string;
  width: number;
  height: number;
  maxSide?: number;
}): VideoSynthGraph {
  const safe = options.sourceId.replace(/[^\w:-]+/g, '_').slice(0, 120);
  const id = (name: string) => `videosynth:${safe}:${name}`;
  const aspect = options.width / Math.max(1, options.height);
  const side = options.maxSide ?? 1920;
  const w = Math.round(aspect >= 1 ? side : side * aspect);
  const h = Math.round(aspect >= 1 ? side / aspect : side);
  const textures = [
    { id: id('next'), width: w, height: h, format: 'rgba16float' },
    { id: id('prev'), width: w, height: h, format: 'rgba16float' },
  ];
  const patch = { id: id('patch'), kind: 'uniform', byte_length: 256, initial_b64: b64(paramBlock(options.params, aspect)) };
  const frame = scene3dFrameBuffer(id('clock'));
  const base = [{ binding: 0, resource: patch.id, kind: 'uniform' }, { binding: 1, resource: frame.id, kind: 'uniform' }];
  // The input layer's composited picture (any layer; empty when none is set).
  const inputLayer = typeof options.params?.[INPUT_LAYER_KEY] === 'string' ? (options.params[INPUT_LAYER_KEY] as string) : '';
  const input = { binding: 4, kind: 'source-frame-texture', source_id: `layer-frame:${inputLayer}` };
  const pass = (name: string, entry: string, from: string, target: object) => ({
    name, shader_id: VIDEOSYNTH_SHADER_ID, vertex_entry: 'vs_main', fragment_entry: entry, vertex_count: 3, clear: true, clear_color: [0, 0, 0, 1],
    bindings: [...base, { binding: 2, kind: 'graph-texture', texture: from }, { binding: 3, kind: 'source-frame-sampler' }, input],
    ...target,
  });
  const render_passes = [
    pass('synth', 'fs_synth', id('prev'), { target: 'texture', texture: id('next') }),
    pass('keep', 'fs_keep', id('next'), { target: 'texture', texture: id('prev') }),
    pass('out', 'fs_out', id('next'), { target: 'source_frame', source_id: options.sourceId, include_snapshot: false }),
  ];
  return {
    config: { textures, buffers: [patch, frame], passes: [], render_passes, readbacks: [] },
    topology: JSON.stringify([textures, options.sourceId, inputLayer]),
    values: [{ id: patch.id, initial_b64: patch.initial_b64 }],
  };
}
