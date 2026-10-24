// The A/B fader with a blend mode runs one transition from A to B. B comes in
// combined with A by the blend mode and settles into plain B by the end; the
// picture never passes through a whole-frame blend at the midpoint (which
// looked like two transitions, A to the blend and then the blend to B).
import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLayer } from '../types';
import { buildVJClipTransitionGraph, buildVJClipTransitionPrecompileCommands } from './vjClipTransitionNative';
import { buildVJCrossfadeGraph, buildVJCrossfadePrecompileCommands } from './vjCrossfadeNative';

const nativeCoreBin = join(process.cwd(), 'native-renderer/target/release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;

type Rpc = { send: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<any>; close: () => void };

function createRpc(): Rpc {
  const child: ChildProcessWithoutNullStreams = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
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
        const timer = setTimeout(() => { pending.delete(id); rej(new Error(`native core RPC timed out: ${method}`)); }, timeoutMs);
        pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    close() {
      try { child.stdin.write(JSON.stringify({ id: nextId++, method: 'shutdown', params: {} }) + '\n'); } catch { /* gone */ }
      child.kill();
    },
  };
}

const W = 64;
const H = 36;
const FULL = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const GREEN: [number, number, number] = [0, 255, 0];
const BLUE: [number, number, number] = [0, 0, 255];

function solidB64([r, g, b]: [number, number, number]): string {
  const px = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; }
  return px.toString('base64');
}

function mediaLayer(id: string, z: number, source: string, colour: [number, number, number]) {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, blend_mode: 'normal', opacity: 0, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    { type: 'upload_source_frame', source_id: source, width: 16, height: 16, rgba_b64: solidB64(colour), seq: 1 },
    { type: 'bind_media_source', layer_id: id, source_id: source, uri: `upload://${source}`, source_type: 'image' },
  ];
}

function graphLayer(id: string, config: unknown) {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: 3, blend_mode: 'normal', opacity: 1, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    { type: 'set_native_graph_layer', layer_id: id, kind: 'vj-crossfade', instrument_source_id: `plugin:${id}:vj-crossfade`,
      composite_source_id: `plugin:${id}:vj-crossfade`, input_source_id: null, effect_graph: config, params: {} },
  ];
}

type Sample = { left: { g: number; b: number }; right: { g: number; b: number } };

describe('A/B blend modes run one transition', () => {
  const shaders = [
    {
      name: 'deck crossfade',
      precompile: buildVJCrossfadePrecompileCommands,
      config: (mix: number) => buildVJCrossfadeGraph({
        outputSourceId: 'plugin:xf:vj-crossfade', sourceAId: 'layer-frame:deck-a', sourceBId: 'layer-frame:deck-b',
        width: W, height: H, mix, transition: 'wipe', blendMode: 'difference', opacityA: 1, opacityB: 1, time: 0, frameIndex: Math.round(mix * 1000),
      }).config,
    },
    {
      name: 'row carrier',
      precompile: buildVJClipTransitionPrecompileCommands,
      config: (mix: number) => {
        const branch = (id: string) => ({ layer: createLayer(id, '', 'media'), opacity: 1, premultiplied: false, uvTransform: [0, 0, 1, 1], uvFlags: [0, 1, 0, 0] });
        return buildVJClipTransitionGraph({
          outputSourceId: 'plugin:xf:vj-crossfade', sourceAId: 'layer-frame:deck-a', sourceBId: 'layer-frame:deck-b',
          width: W, height: H, mix, transition: 'wipe', blendMode: 'difference',
          branchA: branch('deck-a'), branchB: branch('deck-b'), time: 0, frameIndex: Math.round(mix * 1000),
        }).config;
      },
    },
  ];

  for (const shader of shaders) {
    itIfNativeCore(`${shader.name}: difference comes in with B and settles into B`, async () => {
      const rpc = createRpc();
      try {
        await rpc.send('start', { config: {
          backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
          width: W, height: H, target_fps: 60, native_quality_policy: 'fixed',
        } }, 20000);
        await rpc.send('submit_commands', { commands: [
          ...shader.precompile(),
          ...mediaLayer('deck-a', 0, 'src:green', GREEN),
          ...mediaLayer('deck-b', 1, 'src:blue', BLUE),
        ] });
        // Snapshot channel order (RGBA or BGRA) is read off the all-B frame.
        let blueChannel = 2;
        const sampleAt = async (mix: number): Promise<Sample> => {
          await rpc.send('submit_commands', { commands: graphLayer('xf', shader.config(mix)) });
          // Wait for a lit picture that has held still for a few frames (the
          // first frames after the graph lands can still be black).
          let last: Sample | null = null;
          let still = 0;
          for (let i = 0; i < 300; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            const snap = await rpc.send('frame_snapshot', { include_pixels: true });
            const px = Buffer.from(snap.rgba_b64, 'base64');
            if (mix === 1) blueChannel = px[0] > px[2] ? 0 : 2;
            const at = (x: number) => {
              const o = (Math.floor(snap.height / 2) * snap.width + Math.round(x * (snap.width - 1))) * 4;
              return { g: px[o + 1] / 255, b: px[o + blueChannel] / 255 };
            };
            const next = { left: at(0.1), right: at(0.9) };
            const lit = Math.max(next.left.g, next.left.b) > 0.3 && Math.max(next.right.g, next.right.b) > 0.3;
            const same = !!last && Math.abs(last.left.g - next.left.g) < 0.01 && Math.abs(last.left.b - next.left.b) < 0.01
              && Math.abs(last.right.g - next.right.g) < 0.01 && Math.abs(last.right.b - next.right.b) < 0.01;
            still = lit && same ? still + 1 : 0;
            last = next;
            if (still >= 6) return next;
          }
          throw new Error(`picture never settled at mix ${mix}: ${JSON.stringify(last)}`);
        };
        await sampleAt(1);
        const end = await sampleAt(1);
        expect(end.left.b).toBeGreaterThan(0.9);
        expect(end.left.g).toBeLessThan(0.05);

        // Wipe brings B in from the left. Where it hasn't reached, A shows
        // untouched, all the way through the middle of the throw.
        const quarter = await sampleAt(0.25);
        const half = await sampleAt(0.5);
        const threeQuarter = await sampleAt(0.75);
        for (const step of [quarter, half, threeQuarter]) {
          expect(step.right.g).toBeGreaterThan(0.9);
          expect(step.right.b).toBeLessThan(0.05);
        }
        // Where B has come in, it arrives as the difference with A (green +
        // blue = cyan) and settles toward plain blue as the fader moves on.
        expect(quarter.left.b).toBeGreaterThan(0.9);
        expect(quarter.left.g).toBeGreaterThan(0.7);
        expect(half.left.g).toBeLessThan(quarter.left.g - 0.2);
        expect(threeQuarter.left.g).toBeLessThan(half.left.g - 0.2);
        expect(threeQuarter.left.b).toBeGreaterThan(0.9);
      } finally {
        rpc.close();
      }
    }, 60000);
  }
});
