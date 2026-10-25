// The core records every single-pass shader layer of a frame into one
// encoder and submits them together, each with its own slice of a uniform
// ring. Seventy layers (more than one batch holds), each its own shader with
// its own value: every stripe must show its own value, not a neighbour's.
import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

const COUNT = 70;
const W = 700;
const H = 40;
const SOURCE = `/*{"ISFVSN":"2","INPUTS":[{"NAME":"level","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.0}]}*/
void main() {
  gl_FragColor = vec4(level, 0.0, 1.0 - level, 1.0);
}`;
const level = (i: number) => (i + 0.5) / COUNT;

describe('batched shader layers', () => {
  itIfNativeCore('keep their own uniforms within one frame', async () => {
    const rpc = createRpc();
    try {
      await rpc.send('start', { config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: W, height: H, target_fps: 30, native_quality_policy: 'fixed',
      } }, 20000);
      const commands: Record<string, unknown>[] = [];
      for (let i = 0; i < COUNT; i++) {
        const shaderId = `batch-shader-${i}`;
        const layerId = `batch-layer-${i}`;
        const x0 = i / COUNT;
        const x1 = (i + 1) / COUNT;
        commands.push(
          { type: 'precompile_shader', shader_id: shaderId, stage: 'pixel', entry: 'main', source: SOURCE },
          { type: 'upsert_layer', layer_id: layerId, z_index: i, opacity: 1, blend_mode: 'normal',
            corners: { topLeft: { x: x0, y: 0 }, topRight: { x: x1, y: 0 }, bottomRight: { x: x1, y: 1 }, bottomLeft: { x: x0, y: 1 } } },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          { type: 'bind_isf_shader', layer_id: layerId, shader_id: shaderId },
          { type: 'update_isf_uniforms', shader_id: shaderId, time: 0, time_delta: 1 / 30, frame_index: 0,
            render_width: W, render_height: H, float_inputs: { level: level(i) }, point_inputs: {}, color_inputs: {} },
        );
      }
      await rpc.send('submit_commands', { commands }, 20000);

      // Wait for a frame in which every stripe has drawn.
      let px: Buffer | null = null;
      let width = 0;
      let height = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const snap = await rpc.send('frame_snapshot', { include_pixels: true }, 8000);
        const pixels = Buffer.from(snap.rgba_b64, 'base64');
        width = snap.width;
        height = snap.height;
        let drawn = 0;
        for (let i = 0; i < COUNT; i++) {
          const o = (Math.floor(height / 2) * width + Math.floor(((i + 0.5) / COUNT) * width)) * 4;
          if (pixels[o] + pixels[o + 2] > 200) drawn++;
        }
        if (drawn === COUNT) { px = pixels; break; }
      }
      expect(px, 'every stripe drew').not.toBeNull();

      // Snapshots may be BGRA: the first stripe is nearly pure blue.
      const first = (Math.floor(height / 2) * width + Math.floor((0.5 / COUNT) * width)) * 4;
      const [red, blue] = px![first] > px![first + 2] ? [2, 0] : [0, 2];
      for (let i = 0; i < COUNT; i++) {
        const o = (Math.floor(height / 2) * width + Math.floor(((i + 0.5) / COUNT) * width)) * 4;
        expect(px![o + red] / 255, `stripe ${i} red`).toBeCloseTo(level(i), 1);
        expect(px![o + blue] / 255, `stripe ${i} blue`).toBeCloseTo(1 - level(i), 1);
      }
    } finally {
      rpc.close();
    }
  }, 90000);
});
