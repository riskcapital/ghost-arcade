import { composeNativeGraphs } from './nativeGraphComposition';
import { buildVJGroupedMixGraph } from './vjGroupNative';
import { buildVJMixGraph, buildVJMixPrecompileCommands } from './vjMixNative';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildNativeEffectPassChainGraph,
  buildCompositeEffectPassChainGraph,
  buildNativeEffectPassPrecompileCommands,
} from './nativeEffectPass';

/**
 * Runs a composition-FX chain on the real GPU.
 *
 * Composition FX used to reach the core only as inline colour maths inside
 * the compositor's single fullscreen pass, which has no texture to sample
 * neighbours from — so blur and everything like it was silently dropped and
 * users reported composition FX doing nothing. They now run as a real
 * effect-pass chain over a full-resolution copy of the finished composite.
 *
 * This drives that path end to end: the core must accept a graph whose
 * render target is the composite ping-pong, and render a frame with it
 * queued, without a shader error or a dropped frame.
 */

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

type NativeRpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
};

function createNativeRpc(): NativeRpc {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (!child.stdin || !child.stdout) throw new Error('native render-core stdio was not initialized');

  let nextId = 1;
  let stdout = '';
  const pending = new Map<number, {
    timer: ReturnType<typeof setTimeout>;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string };
          const wait = typeof message.id === 'number' ? pending.get(message.id) : null;
          if (wait) {
            clearTimeout(wait.timer);
            pending.delete(message.id as number);
            if (message.ok) wait.resolve(message.result);
            else wait.reject(new Error(message.error || 'native rpc error'));
          }
        } catch {
          // non-JSON log line from the core — ignore
        }
      }
      index = stdout.indexOf('\n');
    }
  });

  return {
    send(method, params = {}, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`native rpc timeout: ${method}`));
        }, timeoutMs);
        pending.set(id, { timer, resolve, reject });
        child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    async close() {
      for (const [, wait] of pending) clearTimeout(wait.timer);
      pending.clear();
      child.kill();
    },
  };
}

const hasNativeCore = existsSync(nativeCoreBin);
const itIfNativeCore = hasNativeCore ? it : it.skip;
const nativeBackend = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'dx12' : 'vulkan';


describe('composition FX run as a post-composite pass on the native core', () => {
  itIfNativeCore('accepts a composite-target graph and renders with it', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: { backend: nativeBackend, width: 160, height: 90, source_frame_size: 160, target_fps: 60 },
      }, 20000);
      expect(started?.backend_ready).toBe(true);

      // The core must advertise the phase, otherwise the TS side correctly
      // refuses to use it and composition FX stay on the old colour ops.
      const caps = await rpc.send('capabilities', {}, 5000);
      expect(caps?.features?.native_post_composite_graph).toBe(true);

      for (const command of buildNativeEffectPassPrecompileCommands()) {
        await rpc.send('submit_commands', { commands: [command] }, 20000);
      }

      // Blur is the case that could never work before: it samples
      // neighbouring pixels, which the compositor's inline path cannot do.
      const graph = buildCompositeEffectPassChainGraph({
        sourceId: 'composite-frame:0',
        targetSourceId: 'composite-frame:1',
        effects: [
          { effect: 'blur', amount: 0.6, mix: 1, params: {} },
          { effect: 'brightness', amount: 1.2, mix: 1, params: {} },
        ],
        width: 160,
        height: 90,
        time: 0.5,
        frameIndex: 30,
        seq: 480,
      });

      await rpc.send('submit_commands', {
        commands: [{ type: 'queue_compute_graph', ...(graph.config as Record<string, unknown>) }],
      }, 20000);
      // submit_commands already auto-presents, and frame_snapshot forces a
      // render and reads the result back, so this exercises the whole
      // post-composite path rather than just the queueing.
      await rpc.send('frame_snapshot', {}, 20000);

      const status = await rpc.send('status', {}, 5000);
      expect(status.last_shader_error, JSON.stringify(status.last_shader_error)).toBeNull();
      expect(status.last_frame_error ?? null, JSON.stringify(status.last_frame_error)).toBeNull();
    } finally {
      await rpc.close();
    }
  }, 60000);
});


itIfNativeCore('renders group effects after children and applies group opacity once', async () => {
  const rpc = createNativeRpc();
  try {
    await rpc.send('start', { config: { backend: nativeBackend, width: 32, height: 32, source_frame_size: 32, target_fps: 30 } }, 20000);
    await rpc.send('submit_commands', { commands: [...buildVJMixPrecompileCommands(), ...buildNativeEffectPassPrecompileCommands()] }, 20000);
    const commands: Record<string, unknown>[] = [];
    for (const [id, color] of [['group-red', [255, 0, 0, 255]], ['group-green', [0, 255, 0, 255]], ['group-black', [0, 0, 0, 255]]] as const) {
      commands.push(
        { type: 'upload_source_frame', source_id: id, width: 32, height: 32, seq: 1, rgba_b64: Buffer.from(Array.from({ length: 1024 }, () => [...color]).flat()).toString('base64') },
        { type: 'upsert_layer', layer_id: id, z_index: -1, opacity: 0 },
        { type: 'bind_media_source', layer_id: id, source_id: id, uri: `group-test://${id}`, source_type: 'image' },
        { type: 'set_layer_visibility', layer_id: id, visible: false },
      );
    }
    await rpc.send('submit_commands', { commands });
    const grouped = buildVJGroupedMixGraph({ outputSourceId: 'group-parent', width: 32, height: 32, time: 0, frameIndex: 1,
      rows: [{ frameId: 'group-black', opacity: 1, blendMode: 'normal' },
        { frameId: 'group-red', opacity: 1, blendMode: 'normal', groupId: 'g' },
        { frameId: 'group-green', opacity: 1, blendMode: 'normal', groupId: 'g' }],
      groups: [{ id: 'g', effects: [{ effect: 'invert', amount: 1, mix: 1 }], opacity: 0.25, blendMode: 'normal' }],
    });
    await rpc.send('submit_commands', { commands: [{ type: 'queue_compute_graph', ...grouped.config }] }, 20000);
    await expect.poll(async () => {
      await rpc.send('frame_snapshot', {});
      return (await rpc.send('get_source_frame_readiness', { source_id: 'group-parent' })).ready;
    }, { timeout: 5000, interval: 20 }).toBe(true);
    await rpc.send('submit_commands', { commands: [
      { type: 'upsert_layer', layer_id: 'group-display', z_index: 0, opacity: 1, blend_mode: 'normal', corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
      { type: 'bind_media_source', layer_id: 'group-display', source_id: 'group-parent', uri: 'group-test://output', source_type: 'image' },
      { type: 'set_layer_visibility', layer_id: 'group-display', visible: true },
    ] });
    // Opaque green covers red inside the group; inversion makes magenta.
    // Fading the combined group over black should yield quarter magenta.
    await expect.poll(async () => {
      const frame = await rpc.send('frame_snapshot', { include_pixels: true });
      const bytes = Buffer.from(frame.rgba_b64, 'base64');
      const pixel = [...bytes.subarray((16 * Number(frame.width) + 16) * 4, (16 * Number(frame.width) + 16) * 4 + 4)];
      if (String(frame.format).toLowerCase().startsWith('bgra')) [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
      return Math.abs(pixel[0] - 64) <= 2 && pixel[1] <= 2 && Math.abs(pixel[2] - 64) <= 2 && pixel[3] === 255;
    }, { timeout: 5000, interval: 20 }).toBe(true);
    // Two mapped slices share one resident group producer inside one output.
    // The readers intentionally sort before the producer lexically.
    await rpc.send('submit_commands', { commands: [
      { type: 'set_layer_visibility', layer_id: 'group-display', visible: false },
      { type: 'upsert_layer', layer_id: '__vj-mix__', z_index: -1, opacity: 0 },
      { type: 'set_native_graph_layer', layer_id: '__vj-mix__', kind: 'vj-mix', instrument_source_id: 'group-parent', composite_source_id: 'group-parent', effect_graph: grouped.config, params: {} },
    ] });
    for (const [id, left, right] of [['0-left-slice', 0, 0.5], ['1-right-slice', 0.5, 1]] as const) {
      const reader = buildVJMixGraph({ outputSourceId: `${id}-texture`, width: 32, height: 32, time: 0, frameIndex: 1,
        rows: [{ frameId: 'group-parent:group:g', opacity: 0.25, blendMode: 'normal' }] });
      await rpc.send('submit_commands', { commands: [
        { type: 'upsert_layer', layer_id: id, z_index: 1, opacity: 1, blend_mode: 'normal', corners: { topLeft: { x: left, y: 1 }, topRight: { x: right, y: 1 }, bottomRight: { x: right, y: 0 }, bottomLeft: { x: left, y: 0 } } },
        { type: 'bind_media_source', layer_id: id, source_id: `${id}-texture`, uri: `native-graph://vj-mix/${id}`, source_type: 'gpu:vj-mix' },
        { type: 'set_layer_visibility', layer_id: id, visible: true },
        { type: 'set_native_graph_layer', layer_id: id, kind: 'vj-mix', instrument_source_id: `${id}-texture`, composite_source_id: `${id}-texture`, effect_graph: reader.config, params: {} },
      ] });
    }
    await expect.poll(async () => {
      const frame = await rpc.send('frame_snapshot', { include_pixels: true });
      const bytes = Buffer.from(frame.rgba_b64, 'base64');
      return [8, 24].map(x => {
        const offset = (16 * Number(frame.width) + x) * 4;
        return [...bytes.subarray(offset, offset + 4)];
      });
    }, { timeout: 5000, interval: 20 }).toEqual([[64, 0, 64, 255], [64, 0, 64, 255]]);
  } finally { await rpc.close(); }
}, 60000);

itIfNativeCore('retains VJ composition FX with the mix graph and shares their processed frame with stage slices', async () => {
  const rpc = createNativeRpc();
  try {
    await rpc.send('start', { config: { backend: nativeBackend, width: 32, height: 32, source_frame_size: 32, target_fps: 30 } }, 20000);
    await rpc.send('submit_commands', { commands: [...buildVJMixPrecompileCommands(), ...buildNativeEffectPassPrecompileCommands(),
      { type: 'upload_source_frame', source_id: 'review-red', width: 32, height: 32, seq: 1,
        rgba_b64: Buffer.from(Array.from({ length: 1024 }, () => [255, 0, 0, 255]).flat()).toString('base64') },
    ] }, 20000);
    const mix = buildVJMixGraph({ outputSourceId: 'review-mix', width: 32, height: 32, time: 0, frameIndex: 0,
      rows: [{ frameId: 'review-red', opacity: 1, blendMode: 'normal' }] });
    const effects = buildNativeEffectPassChainGraph({ sourceId: 'review-mix', targetSourceId: 'review-fx',
      effects: [{ effect: 'invert', amount: 1, mix: 1 }], width: 32, height: 32, time: 0, frameIndex: 0 });
    const corners = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
    const producer = (withFx: boolean) => ({ type: 'set_native_graph_layer', layer_id: '__vj-mix__', kind: 'vj-mix',
      instrument_source_id: 'review-mix', composite_source_id: withFx ? 'review-fx' : 'review-mix',
      effect_graph: composeNativeGraphs(mix.config, withFx ? effects.config : null), params: {} });
    await rpc.send('submit_commands', { commands: [
      { type: 'upsert_layer', layer_id: '__vj-mix__', z_index: 0, opacity: 1, blend_mode: 'normal', corners },
      { type: 'bind_media_source', layer_id: '__vj-mix__', source_id: 'review-fx', uri: 'native-graph://vj-mix/review', source_type: 'gpu:vj-mix' },
      { type: 'set_layer_visibility', layer_id: '__vj-mix__', visible: true }, producer(true),
    ] });
    const pixel = async () => {
      const frame = await rpc.send('frame_snapshot', { include_pixels: true });
      const bytes = Buffer.from(frame.rgba_b64, 'base64');
      const p = [...bytes.subarray((16 * Number(frame.width) + 16) * 4, (16 * Number(frame.width) + 16) * 4 + 4)];
      if (String(frame.format).toLowerCase().startsWith('bgra')) [p[0], p[2]] = [p[2], p[0]];
      return p;
    };
    await expect.poll(pixel, { timeout: 5000, interval: 20 }).toEqual([0, 255, 255, 255]);
    for (const [mixAmount, expected] of [[0, [255, 0, 0, 255]], [0.25, [191, 64, 64, 255]]] as const) {
      const partial = buildNativeEffectPassChainGraph({ sourceId: 'review-mix', targetSourceId: 'review-fx',
        effects: [{ effect: 'invert', amount: 1, mix: mixAmount }], width: 32, height: 32, time: 0, frameIndex: 0 });
      await rpc.send('submit_commands', { commands: [{ ...producer(true), effect_graph: composeNativeGraphs(mix.config, partial.config) }] });
      await expect.poll(pixel, { timeout: 5000, interval: 20 }).toEqual([...expected]);
    }
    await rpc.send('submit_commands', { commands: [producer(true)] });
    const reader = buildVJMixGraph({ outputSourceId: 'review-slice', width: 32, height: 32, time: 0, frameIndex: 0,
      rows: [{ frameId: 'layer-frame:__vj-mix__', opacity: 1, blendMode: 'normal' }] });
    await rpc.send('submit_commands', { commands: [
      { type: 'upsert_layer', layer_id: '__vj-mix__', z_index: 0, opacity: 0 },
      { type: 'upsert_layer', layer_id: 'stage-reader', z_index: 1, opacity: 1, blend_mode: 'normal', corners },
      { type: 'bind_media_source', layer_id: 'stage-reader', source_id: 'review-slice', uri: 'native-graph://vj-mix/slice', source_type: 'gpu:vj-mix' },
      { type: 'set_layer_visibility', layer_id: 'stage-reader', visible: true },
      { type: 'set_native_graph_layer', layer_id: 'stage-reader', kind: 'vj-mix', instrument_source_id: 'review-slice', composite_source_id: 'review-slice', effect_graph: reader.config, params: {} },
    ] });
    await expect.poll(pixel, { timeout: 5000, interval: 20 }).toEqual([0, 255, 255, 255]);
    await rpc.send('submit_commands', { commands: [producer(false)] });
    await expect.poll(pixel, { timeout: 5000, interval: 20 }).toEqual([255, 0, 0, 255]);
  } finally { await rpc.close(); }
}, 60000);

itIfNativeCore('keeps warped mesh cells opaque across concave bends and distant grid cells', async () => {
  const rpc = createNativeRpc();
  try {
    await rpc.send('start', { config: { backend: nativeBackend, width: 64, height: 64, source_frame_size: 64, target_fps: 30 } }, 20000);
    const corners = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
    await rpc.send('submit_commands', { commands: [
      ...[['mesh-back', [0, 0, 255, 255]], ['mesh-front', [255, 0, 0, 255]]].flatMap(([id, color], index) => [
        { type: 'upload_source_frame', source_id: id, width: 64, height: 64, seq: 1,
          rgba_b64: Buffer.from(Array.from({ length: 4096 }, () => color).flat() as number[]).toString('base64') },
        { type: 'upsert_layer', layer_id: id, opacity: 1, z_index: 1 - index, corners },
        { type: 'bind_media_source', layer_id: id, source_id: id, source_type: 'image', uri: `memory://${id}` },
      ]),
    ] });
    for (const size of [3, 12]) {
      const points = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => ({
        x: size === 12 ? Math.pow(col / (size - 1), 4) : col / (size - 1), y: 1 - row / (size - 1),
      })));
      if (size === 3) points[1][1] = { x: 0.94, y: 0.08 };
      await rpc.send('submit_commands', { commands: [
        { type: 'upsert_layer', layer_id: 'mesh-front', opacity: 1, z_index: 0, corners, mesh_grid: { rows: size, cols: size, points } },
        { type: 'present' },
      ] });
      await expect.poll(async () => {
        const frame = await rpc.send('frame_snapshot', { include_pixels: true });
        const bytes = Buffer.from(frame.rgba_b64, 'base64');
        let exposed = 0;
        for (let y = 2; y < 62; y++) for (let x = 2; x < 62; x++) {
          const offset = (y * Number(frame.width) + x) * 4;
          const bgra = String(frame.format).toLowerCase().startsWith('bgra');
          if (bytes[offset + (bgra ? 2 : 0)] < 250 || bytes[offset + (bgra ? 0 : 2)] > 5) exposed++;
        }
        return exposed;
      }, { timeout: 3000, interval: 30, message: `${size}x${size} mesh must not expose the blue layer` }).toBe(0);
    }
  } finally { await rpc.close(); }
}, 60000);

itIfNativeCore('does not paint an affine duplicate outside a folded corner-warp surface', async () => {
  const rpc = createNativeRpc();
  try {
    await rpc.send('start', { config: { backend: nativeBackend, width: 64, height: 64, source_frame_size: 64, target_fps: 30 } }, 20000);
    await rpc.send('submit_commands', { commands: [
      { type: 'upload_source_frame', source_id: 'fold-red', width: 64, height: 64, seq: 1,
        rgba_b64: Buffer.from(Array.from({ length: 4096 }, () => [255, 0, 0, 255]).flat()).toString('base64') },
      { type: 'upsert_layer', layer_id: 'fold', opacity: 1, z_index: 0,
        corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0.9, y: 0.78 } } },
      { type: 'bind_media_source', layer_id: 'fold', source_id: 'fold-red', source_type: 'image', uri: 'memory://fold-red' },
      { type: 'present' },
    ] });
    await expect.poll(async () => {
      const frame = await rpc.send('frame_snapshot', { include_pixels: true });
      const bytes = Buffer.from(frame.rgba_b64, 'base64');
      const redAt = (x: number, y: number) => bytes[(y * Number(frame.width) + x) * 4 + (String(frame.format).toLowerCase().startsWith('bgra') ? 2 : 0)];
      // (0.60,0.45) is inside the fallback triangle but outside the actual
      // bilinear patch (negative inverse discriminant). The top still draws.
      return [redAt(38, 28), redAt(32, 3)];
    }, { timeout: 3000, interval: 30 }).toEqual([0, 255]);
  } finally { await rpc.close(); }
}, 60000);
