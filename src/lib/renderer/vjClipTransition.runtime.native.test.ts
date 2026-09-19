import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createLayer, type Layer } from '../types';
import { hardwareTestPlatform as platform, closeNativeTestCore } from './nativeHardwareTestPlatform';
import { buildVJClipTransitionGraph, buildVJClipTransitionPrecompileCommands, buildVJClipTransitionUniformUpdate, type VJClipTransitionGraphOptions } from './vjClipTransitionNative';
import { buildVJMixGraph, buildVJMixPrecompileCommands } from './vjMixNative';
import { VJ_CROSSFADE_TRANSITION_IDS } from './vjCrossfadeNative';
const hardwareDescribe = platform.runnable ? describe : describe.skip;
const FULL = createLayer('', '', 'media').corners;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Command = Record<string, unknown>;

function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  let nextId = 0;
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (value) => { stderr = (stderr + value).slice(-8000); });
  child.on('error', (error) => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const response = JSON.parse(line);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(`${response.error}: ${stderr}`));
  });
  const send = (method: string, params: Command = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: ${stderr}`)); }, 15000);
    pending.set(id, {
      resolve(value) { clearTimeout(timeout); resolve(value); },
      reject(error) { clearTimeout(timeout); reject(error); },
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  return {
    send, commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() { try { await send('shutdown'); } finally { await closeNativeTestCore(child); } },
  };
}
type Core = ReturnType<typeof core>;

function solid(sourceId: string, rgba: number[], width = 16, height = 16, rect = false): Command {
  const buffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buffer.length; i += 4) buffer.set(rgba, i);
  return { type: 'upload_source_frame', source_id: sourceId, seq: 1, width, height,
    rgba_b64: buffer.toString('base64'), ...(rect ? { placement: 'rect' } : {}) };
}
function imageLayer(id: string, source: string, z: number, opacity: number): Command[] {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, opacity, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    { type: 'bind_media_source', layer_id: id, source_id: source, source_type: 'image', uri: `upload://${source}` },
  ];
}
function graphLayer(id: string, sourceId: string, config: unknown, z = 1, opacity = 1, kind = 'vj-crossfade'): Command[] {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, opacity, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    { type: 'set_native_graph_layer', layer_id: id, kind,
      instrument_source_id: sourceId, composite_source_id: sourceId,
      input_source_id: null, effect_graph: config, params: { vjclipTransition: true } },
  ];
}
function options(layerA?: Layer, layerB?: Layer): VJClipTransitionGraphOptions {
  return {
    outputSourceId: 'plugin:clip:vj-crossfade', sourceAId: 'src:red', sourceBId: 'src:blue',
    width: 64, height: 36, mix: 0.5, transition: 'dissolve', time: 0, frameIndex: 0,
    branchA: { layer: layerA ?? createLayer('out', '', 'media'), opacity: 1, premultiplied: false, uvTransform: [0, 0, 1, 1], uvFlags: [0, 1, 0, 0] },
    branchB: { layer: layerB ?? createLayer('in', '', 'media'), opacity: 1, premultiplied: false, uvTransform: [0, 0, 1, 1], uvFlags: [0, 1, 0, 0] },
  };
}
async function start(rpc: Core) {
  const status = await rpc.send('start', { config: { backend: platform.rendererBackend,
    width: 64, height: 36, source_frame_size: 256, target_fps: 60, native_quality_policy: 'fixed' } });
  expect(status.backend_ready).toBe(true);
  expect(status.adapter_is_software).toBe(false);
  await rpc.commands([
    ...buildVJClipTransitionPrecompileCommands(), ...buildVJMixPrecompileCommands(),
    solid('src:green', [0, 255, 0, 255]), ...imageLayer('background', 'src:green', 100, 1),
  ]);
}
async function settledMean(rpc: Core): Promise<number[]> {
  await sleep(100);
  return (await rpc.send('frame_snapshot')).mean_rgba;
}
async function eventuallyMean(rpc: Core, check: (value: number[]) => boolean): Promise<number[]> {
  let value: number[] = [];
  for (let i = 0; i < 80; i++) {
    value = await settledMean(rpc);
    if (check(value)) return value;
  }
  throw new Error(`Unexpected rendered colour: ${JSON.stringify(value)}; ${JSON.stringify(await rpc.send('status'))}`);
}

hardwareDescribe('native clip transition pixels', () => {
  it('preserves lower-row coverage through all ten transition styles', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red', [255, 0, 0, 96]), solid('src:blue', [0, 0, 255, 96])]);
      for (const style of Object.keys(VJ_CROSSFADE_TRANSITION_IDS)) {
        const config = buildVJClipTransitionGraph({ ...options(), transition: style }).config;
        await rpc.commands(graphLayer('clip', 'plugin:clip:vj-crossfade', config));
        const mean = await eventuallyMean(rpc, ([r, g, b]) => r + b > 0.12 && g > 0.35);
        expect(mean[1], `${style} must retain the green row under partial-alpha clips`).toBeGreaterThan(0.35);
      }
      expect((await rpc.send('status')).shader_precompile_failed).toBe(0);
    } finally { await rpc.close(); }
  }, 60000);

  it('keeps independent geometry and opacity, including contain margins and translated outgoing corners', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red', [255, 0, 0, 255]), solid('src:blue', [0, 0, 255, 255])]);
      const left = createLayer('out', '', 'media');
      left.corners = { topLeft: { x: 0, y: 1 }, topRight: { x: 0.5, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 0.5, y: 0 } };
      const base = options(left);
      base.branchA.opacity = 0.5;
      base.branchB.uvFlags = [2, 2, 0, 0]; // Contain a source twice as wide: half-height coverage.
      await rpc.commands(graphLayer('clip', base.outputSourceId, buildVJClipTransitionGraph({ ...base, mix: 0 }).config));
      const outgoing = await eventuallyMean(rpc, ([r, g, b]) => r > 0.20 && r < 0.30 && g > 0.70 && b < 0.02);
      expect(outgoing[0]).toBeCloseTo(0.25, 1);
      const update = buildVJClipTransitionUniformUpdate({ ...base, mix: 1 });
      await rpc.commands([{ type: 'update_native_graph_buffer', layer_id: 'clip', buffer_id: update.bufferId, initial_b64: update.initialB64 }]);
      const incoming = await eventuallyMean(rpc, ([r, g, b]) => r < 0.02 && g > 0.40 && g < 0.60 && b > 0.40 && b < 0.60);
      expect(incoming[2]).toBeCloseTo(0.5, 1);
    } finally { await rpc.close(); }
  }, 30000);

  it('keeps the outgoing picture while incoming is missing and resolves raw-video source rectangles', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red', [255, 0, 0, 255], 32, 16, true)]);
      const base = options();
      await rpc.commands(graphLayer('clip', base.outputSourceId, buildVJClipTransitionGraph(base).config));
      await eventuallyMean(rpc, ([r, g, b]) => r > 0.95 && g < 0.02 && b < 0.02);
      await rpc.commands([solid('src:blue', [0, 0, 255, 255])]);
      await eventuallyMean(rpc, ([r, g, b]) => r > 0.55 && g < 0.02 && b > 0.55);
    } finally { await rpc.close(); }
  }, 30000);

  it('preserves alpha through nested clip → A/B → VJ Mix graph dependencies', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red', [255, 0, 0, 128]), solid('src:blue', [0, 0, 255, 0])]);
      const clip = { ...options(), mix: 0 };
      const ab = { ...options(), outputSourceId: 'plugin:ab:vj-crossfade', sourceAId: 'layer-frame:clip', mix: 0,
        branchA: { ...options().branchA, premultiplied: true } };
      const mixSource = 'plugin:mix:vj-mix';
      const mix = buildVJMixGraph({ outputSourceId: mixSource, width: 64, height: 36, time: 0, frameIndex: 0,
        rows: [{ frameId: 'layer-frame:background', opacity: 1, blendMode: 'normal' }, { frameId: 'layer-frame:ab', opacity: 1, blendMode: 'normal' }] });
      // Deliberately opposite scene order: execution must follow producer dependencies.
      await rpc.commands([
        ...graphLayer('mix', mixSource, mix.config, 10, 1, 'vj-mix'),
        ...graphLayer('ab', ab.outputSourceId, buildVJClipTransitionGraph(ab).config, 9, 0),
        ...graphLayer('clip', clip.outputSourceId, buildVJClipTransitionGraph(clip).config, 8, 0),
      ]);
      const mean = await eventuallyMean(rpc, ([r, g, b]) => r > 0.45 && r < 0.55 && g > 0.45 && g < 0.55 && b < 0.02);
      expect(mean[0]).toBeCloseTo(0.5, 1);
      expect(mean[1]).toBeCloseTo(0.5, 1);
    } finally { await rpc.close(); }
  }, 30000);
});
