// GPU integration: source ownership, readiness, and same-kind nested transition graphs.
import { describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLayer } from '../types';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
import { buildVJClipTransitionGraph, buildVJClipTransitionPrecompileCommands, type VJClipTransitionBranch } from './vjClipTransitionNative';
import { buildVJCrossfadePrecompileCommands } from './vjCrossfadeNative';
import { buildVJMixGraph, buildVJMixPrecompileCommands } from './vjMixNative';

const nativeCoreBin = platform.binary;
const itIfNativeCore = platform.runnable ? it : it.skip;

type Rpc = {
  send: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
  close: () => Promise<void>;
};

function createRpc(): Rpc {
  const child: ChildProcessWithoutNullStreams = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware' } });
  child.stderr.resume();
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  let nextId = 1;
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const entry = message.id ? pending.get(message.id) : undefined;
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.rej(new Error(JSON.stringify(message.error)));
      else entry.res(message.result);
    } catch {
      /* non-JSON core output */
    }
  });
  return {
    send(method, params = {}, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`native core RPC timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, {
          res: (v) => { clearTimeout(timer); res(v); },
          rej: (e) => { clearTimeout(timer); rej(e); },
        });
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    async close() {
      try {
        child.stdin.write(JSON.stringify({ id: nextId++, method: 'shutdown', params: {} }) + '\n');
      } catch {
        /* already gone */
      }
      await closeNativeTestCore(child);
    },
  };
}

const W = 64;
const H = 36;
const FULL = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const COLOURS: Record<string, [number, number, number]> = {
  'src:red': [255, 0, 0],
  'src:green': [0, 255, 0],
  'src:blue': [0, 0, 255],
};

function solidB64([r, g, b]: [number, number, number], width = 16, height = 16): string {
  const px = Buffer.alloc(width * height * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  return px.toString('base64');
}

function mediaLayer(id: string, z: number, source: string, opacity: number) {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, blend_mode: 'normal', opacity, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    { type: 'upload_source_frame', source_id: source, width: 16, height: 16, rgba_b64: solidB64(COLOURS[source]), seq: 1 },
    { type: 'bind_media_source', layer_id: id, source_id: source, uri: `upload://${source}`, source_type: 'image' },
  ];
}

function graphLayer(id: string, z: number, kind: 'vj-crossfade' | 'vj-mix', config: unknown, opacity: number) {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, blend_mode: 'normal', opacity, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    {
      type: 'set_native_graph_layer',
      layer_id: id,
      kind,
      instrument_source_id: `plugin:${id}:${kind}`,
      composite_source_id: `plugin:${id}:${kind}`,
      input_source_id: null,
      effect_graph: config,
      params: {},
    },
  ];
}

/** 'red' | 'green' | 'blue' | 'black' | 'other', from a snapshot's mean colour. */
function colourOf(snapshot: { mean_rgba: number[] }): string {
  const [r, g, b] = snapshot.mean_rgba;
  if (r > 0.4 && g < 0.05 && b < 0.05) return 'red';
  if (g > 0.4 && r < 0.05 && b < 0.05) return 'green';
  if (b > 0.4 && r < 0.05 && g < 0.05) return 'blue';
  if (r < 0.02 && g < 0.02 && b < 0.02) return 'black';
  return 'other';
}

async function settleOn(rpc: Rpc, colour: string) {
  for (let i = 0; i < 400; i++) {
    if (colourOf(await rpc.send('frame_snapshot', {})) === colour) return;
  }
  throw new Error(`output never settled on ${colour}`);
}

async function startCore(rpc: Rpc, targetFps: number) {
  await rpc.send('start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width: W,
      height: H,
      target_fps: targetFps,
      native_quality_policy: 'fixed',
    },
  }, 20000);
  await rpc.send('submit_commands', {
    commands: [...buildVJCrossfadePrecompileCommands(), ...buildVJMixPrecompileCommands(), ...buildVJClipTransitionPrecompileCommands()],
  });
}


async function ready(rpc: Rpc, layerId: string, sourceId?: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await rpc.send('get_layer_source_readiness', { layer_id: layerId, source_id: sourceId });
    if (result.ready) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const status = await rpc.send('status');
  throw new Error(`layer never had a completed picture: ${layerId}; ${JSON.stringify({
    readiness: await rpc.send('get_layer_source_readiness', { layer_id: layerId, source_id: sourceId }),
    sessions: status.native_video_sessions, error: status.native_video_frame_decode_last_error,
  })}`);
}

const branch: VJClipTransitionBranch = {
  layer: createLayer('branch', 'Branch', 'media'), opacity: 1, premultiplied: false,
  uvTransform: [0, 0, 1, 1], uvFlags: [0, 1, 0, 0],
};
function clipConfig(output: string, inputA: string, inputB: string, mix: number) {
  return buildVJClipTransitionGraph({ outputSourceId: output, sourceAId: inputA, sourceBId: inputB,
    width: W, height: H, mix, transition: 'dissolve', branchA: branch, branchB: branch,
    time: 0, frameIndex: 0 }).config;
}

describe('native clip transition graph ownership', () => {
  itIfNativeCore('requires a real picture and retains an independent GPU snapshot after source replacement', async () => {
    const rpc = createRpc();
    try {
      await startCore(rpc, 60);
      await expect(rpc.send('capture_layer_source_frame', { layer_id: 'absent', source_id: 'vj-clip-snapshot-A-0' }))
        .rejects.toThrow(/no completed source frame/);
      await rpc.send('submit_commands', { commands: mediaLayer('row', 0, 'src:red', 1) });
      const state = await ready(rpc, 'row', 'src:red');
      expect(state.gpu_ready).toBe(true);
      expect(state.actual_source_id).toBe('src:red');
      expect(await rpc.send('get_source_frame_readiness', { source_id: 'src:red' })).toMatchObject({ source_id: 'src:red', ready: true, gpu_ready: true });
      expect((await rpc.send('get_source_frame_readiness', { source_id: 'missing' })).ready).toBe(false);
      expect((await rpc.send('get_source_frame_readiness', { source_id: 'src:red', seek_generation: 12 })).ready).toBe(false);
      expect((await rpc.send('get_layer_source_readiness', { layer_id: 'row', source_id: 'src:blue' })).ready).toBe(false);
      expect((await rpc.send('get_layer_source_readiness', { layer_id: 'row', source_id: 'src:red', seek_generation: 12 })).ready).toBe(false);
      const before = await rpc.send('status');
      const capture = await rpc.send('capture_layer_source_frame', { layer_id: 'row', source_id: 'vj-clip-snapshot-A-0' });
      expect(capture).toMatchObject({ captured: true, transport: 'gpu-copy', source_id: 'vj-clip-snapshot-A-0' });
      const after = await rpc.send('status');
      expect(after.source_frame_cpu_fallback_uploads).toBe(before.source_frame_cpu_fallback_uploads);
      expect(after.source_frame_bytes_uploaded).toBe(before.source_frame_bytes_uploaded);
      await rpc.send('submit_commands', { commands: [
        { type: 'upload_source_frame', source_id: 'src:red', width: 16, height: 16, rgba_b64: solidB64([0, 0, 255]), seq: 2 },
        { type: 'bind_media_source', layer_id: 'row', source_id: 'vj-clip-snapshot-A-0', uri: 'gpu-snapshot://row', source_type: 'image' },
      ] });
      await ready(rpc, 'row', 'vj-clip-snapshot-A-0');
      await settleOn(rpc, 'red');
      expect(await rpc.send('release_source_frame', { source_id: 'vj-clip-snapshot-A-0' })).toMatchObject({ released: false, referenced: true });
      await rpc.send('submit_commands', { commands: [{ type: 'remove_layer', layer_id: 'row' }] });
      expect(await rpc.send('release_source_frame', { source_id: 'vj-clip-snapshot-A-0' })).toMatchObject({ released: true });
      await expect(rpc.send('capture_layer_source_frame', { layer_id: 'row', source_id: 'vj-clip-snapshot-A-32' }))
        .rejects.toThrow(/bounded/);
    } finally { await rpc.close(); }
  }, 45000);

  itIfNativeCore('only acknowledges the completed picture for the requested hardware-video seek generation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ghost-transition-readiness-'));
    const file = join(directory, 'readiness.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'color=c=red:s=128x96:r=30:d=1', '-an', '-c:v', 'libx264', '-preset', 'fast', '-g', '30', '-bf', '3', '-pix_fmt', 'yuv420p', file]);
    const rpc = createRpc();
    try {
      await startCore(rpc, 60);
      const uri = pathToFileURL(file).href;
      const source = 'video:readiness';
      await rpc.send('submit_commands', { commands: [
        { type: 'upsert_layer', layer_id: 'video', opacity: 1, corners: FULL },
        { type: 'set_media_source_playback', source_id: source, uri, source_type: 'video',
          time_seconds: 0, duration_seconds: 1, paused: false, seek_generation: 1 },
        { type: 'bind_media_source', layer_id: 'video', source_id: source, uri, source_type: 'video' },
      ] });
      await ready(rpc, 'video', source);
      expect(await rpc.send('get_source_frame_readiness', { source_id: source, seek_generation: 1 }))
        .toMatchObject({ ready: true, gpu_ready: true, seek_generation: 1 });
      await rpc.send('stop');
      await rpc.send('submit_commands', { commands: [
        { type: 'set_media_source_playback', source_id: source, uri, source_type: 'video',
          time_seconds: 0.5, duration_seconds: 1, paused: true, seek_generation: 2 },
      ] });
      expect(await rpc.send('get_source_frame_readiness', { source_id: source, seek_generation: 2 }))
        .toMatchObject({ ready: false, gpu_ready: false, seek_generation: 2 });
      await startCore(rpc, 60);
      await ready(rpc, 'video', source);
      expect(await rpc.send('get_source_frame_readiness', { source_id: source, seek_generation: 2 }))
        .toMatchObject({ ready: true, gpu_ready: true, seek_generation: 2 });
      expect((await rpc.send('get_source_frame_readiness', { source_id: source, seek_generation: 1 })).ready).toBe(false);
      const status = await rpc.send('status');
      expect(status.native_video_hardware_fallbacks).toBe(0);
      expect(status.native_video_hardware_frames).toBeGreaterThan(0);
    } finally { await rpc.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 45000);

  itIfNativeCore('requires another completed graph frame after input identity changes, while uniform updates retain readiness', async () => {
    const rpc = createRpc();
    try {
      await startCore(rpc, 60);
      const source = 'plugin:carrier:vj-crossfade';
      await rpc.send('submit_commands', { commands: [
        ...mediaLayer('outgoing', 0, 'src:red', 0), ...mediaLayer('incoming', 1, 'src:blue', 0),
        ...mediaLayer('carrier', 2, 'src:red', 0),
        { type: 'upload_source_frame', source_id: 'src:red', width: 32, height: 16,
          rgba_b64: solidB64([255, 0, 0], 32, 16), seq: 2, placement: 'rect' },
        ...graphLayer('carrier', 2, 'vj-crossfade', clipConfig(source, 'layer-frame:outgoing', 'layer-frame:incoming', 0.5), 1),
      ] });
      expect((await ready(rpc, 'carrier', source)).source_rect).toEqual([0, 0, 1, 1]);
      await rpc.send('stop');
      const uniformOnly = clipConfig(source, 'layer-frame:outgoing', 'layer-frame:incoming', 0.75);
      uniformOnly.render_passes[0].seq = 99;
      await rpc.send('submit_commands', { commands: graphLayer('carrier', 2, 'vj-crossfade', uniformOnly, 1) });
      expect((await rpc.send('get_layer_source_readiness', { layer_id: 'carrier', source_id: source })).ready).toBe(true);
      await rpc.send('submit_commands', { commands: graphLayer('carrier', 2, 'vj-crossfade',
        clipConfig(source, 'layer-frame:incoming', 'layer-frame:outgoing', 0.75), 1) });
      expect((await rpc.send('get_layer_source_readiness', { layer_id: 'carrier', source_id: source })).ready).toBe(false);
      await expect(rpc.send('capture_layer_source_frame', { layer_id: 'carrier', source_id: 'vj-clip-snapshot-A-0' }))
        .rejects.toThrow(/no completed source frame/);
    } finally { await rpc.close(); }
  }, 30000);

  itIfNativeCore('refuses excess sources and optional snapshots without displacing live pictures', async () => {
    const rpc = createRpc();
    try {
      await startCore(rpc, 60);
      const capacity = (await rpc.send('status')).source_frame_slots;
      const commands: Record<string, unknown>[] = [];
      // Slot zero is the permanently reserved transparent input.
      for (let index = 1; index < capacity; index++) {
        const id = `capacity-${index}`;
        commands.push(
          { type: 'upsert_layer', layer_id: id, z_index: index, opacity: index === 1 ? 1 : 0, corners: FULL },
          { type: 'upload_source_frame', source_id: id, width: 16, height: 16, rgba_b64: solidB64([255, 0, 0]), seq: 1 },
          { type: 'bind_media_source', layer_id: id, source_id: id, uri: `upload://${id}`, source_type: 'image' },
        );
      }
      await rpc.send('submit_commands', { commands }, 30000);
      await ready(rpc, 'capacity-1', 'capacity-1');
      const before = await rpc.send('status');
      await rpc.send('submit_commands', { commands: [
        { type: 'upload_source_frame', source_id: 'overflow', width: 16, height: 16, rgba_b64: solidB64([0, 0, 255]), seq: 1 },
      ] });
      const after = await rpc.send('status');
      expect(after.source_frame_rejected_uploads).toBe(before.source_frame_rejected_uploads + 1);
      expect(after.source_frame_last_reject_reason).toMatch(/capacity reached/);
      expect((await rpc.send('get_layer_source_readiness', { layer_id: 'capacity-1', source_id: 'capacity-1' })).ready).toBe(true);
      await expect(rpc.send('capture_layer_source_frame', { layer_id: 'capacity-1', source_id: 'vj-clip-snapshot-A-0' }))
        .rejects.toThrow(/no free GPU source slot/);
      await settleOn(rpc, 'red');
    } finally { await rpc.close(); }
  }, 60000);

  itIfNativeCore('orders clip fade → deck fade → VJ Mix → Screen and captures a mid-fade picture for the next clip', async () => {
    const rpc = createRpc();
    try {
      await startCore(rpc, 60);
      const clipId = 'z-clip-fade';
      const deckId = 'a-deck-fade';
      const mixId = 'z-vj-mix';
      const screenId = 'a-screen';
      const source = (id: string) => `plugin:${id}:vj-crossfade`;
      await rpc.send('submit_commands', { commands: [
        ...mediaLayer('outgoing', 0, 'src:red', 0), ...mediaLayer('incoming', 1, 'src:blue', 0),
        ...graphLayer(clipId, 2, 'vj-crossfade', clipConfig(source(clipId), 'layer-frame:outgoing', 'layer-frame:incoming', 0.5), 0),
        ...graphLayer(deckId, 3, 'vj-crossfade', clipConfig(source(deckId), `layer-frame:${clipId}`, `layer-frame:${clipId}`, 0), 0),
        ...graphLayer(mixId, 4, 'vj-mix', buildVJMixGraph({ outputSourceId: `plugin:${mixId}:vj-mix`,
          rows: [{ frameId: `layer-frame:${deckId}`, opacity: 1, blendMode: 'normal' }], width: W, height: H, time: 0, frameIndex: 0 }).config, 0),
        ...graphLayer(screenId, 5, 'vj-mix', buildVJMixGraph({ outputSourceId: `plugin:${screenId}:vj-mix`,
          rows: [{ frameId: `layer-frame:${mixId}`, opacity: 1, blendMode: 'normal' }], width: W, height: H, time: 0, frameIndex: 0 }).config, 1),
      ] });
      await ready(rpc, screenId);
      let snapshot: any;
      for (let i = 0; i < 40; i++) {
        snapshot = await rpc.send('frame_snapshot');
        if (snapshot.mean_rgba[0] > 0.2 && snapshot.mean_rgba[2] > 0.2) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(snapshot.mean_rgba[0]).toBeGreaterThan(0.2);
      expect(snapshot.mean_rgba[2]).toBeGreaterThan(0.2);
      expect(snapshot.mean_rgba[1]).toBeLessThan(0.04);
      const held = await rpc.send('capture_layer_source_frame', { layer_id: clipId, source_id: 'vj-clip-snapshot-B-1' });
      expect(held.source_rect).toEqual([0, 0, 1, 1]);
      await rpc.send('submit_commands', { commands: [
        ...mediaLayer('third', 6, 'src:green', 0),
        ...graphLayer(clipId, 2, 'vj-crossfade', clipConfig(source(clipId), 'vj-clip-snapshot-B-1', 'layer-frame:third', 0), 0),
      ] });
      // The snapshot is referenced only by a graph input, not a scene layer.
      expect(await rpc.send('release_source_frame', { source_id: 'vj-clip-snapshot-B-1' })).toMatchObject({ released: false, referenced: true });
      await new Promise(resolve => setTimeout(resolve, 100));
      const continued = await rpc.send('frame_snapshot');
      expect(continued.mean_rgba[0]).toBeCloseTo(snapshot.mean_rgba[0], 1);
      expect(continued.mean_rgba[2]).toBeCloseTo(snapshot.mean_rgba[2], 1);
      expect(continued.mean_rgba[1]).toBeLessThan(0.04);
      // A second interruption reuses the same snapshot the current fade
      // already samples. Leave a real native-frame gap before the host binds
      // the next clip: the old carrier must not blend that snapshot again.
      await rpc.send('submit_commands', { commands: graphLayer(clipId, 2, 'vj-crossfade',
        clipConfig(source(clipId), 'vj-clip-snapshot-B-1', 'layer-frame:third', 0.5), 0) });
      await new Promise(resolve => setTimeout(resolve, 100));
      const beforeSecondCapture = await rpc.send('frame_snapshot');
      await rpc.send('capture_layer_source_frame', { layer_id: clipId, source_id: 'vj-clip-snapshot-B-1' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const whileHostRebinds = await rpc.send('frame_snapshot');
      for (let channel = 0; channel < 3; channel++) {
        expect(whileHostRebinds.mean_rgba[channel]).toBeCloseTo(beforeSecondCapture.mean_rgba[channel], 2);
      }
      await rpc.send('submit_commands', { commands: [{ type: 'remove_layer', layer_id: clipId }] });
      expect(await rpc.send('release_source_frame', { source_id: 'vj-clip-snapshot-B-1' })).toMatchObject({ released: true });
    } finally { await rpc.close(); }
  }, 60000);
});
