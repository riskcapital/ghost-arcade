// Shader time on long installs. Uniforms carry time as an f32: after 12 h
// its step is 3.9 ms and after a week 62.5 ms, so animation stuttered and
// then ran at ~16 fps. The core now keeps its clock in f64 and gives
// shaders the clock wrapped at 2^15 s: identical below that, and never
// coarser than 2 ms above it. A shader that paints fract(TIME * 4) shows the
// time it was given; consecutive 60 fps frames must step by 4/60 of a turn.
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

const W = 64;
const H = 16;
const SOURCE = `/*{"ISFVSN":"2","INPUTS":[]}*/
void main() {
  gl_FragColor = vec4(fract(TIME * 4.0), fract(TIME * 0.25), 0.0, 1.0);
}`;

describe('shader clock', () => {
  itIfNativeCore('steps smoothly frame to frame a show, half a day and a week after launch', async () => {
    const rpc = createRpc();
    try {
      await rpc.send('start', { config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: W, height: H, target_fps: 30, native_quality_policy: 'fixed',
      } }, 20000);
      await rpc.send('submit_commands', { commands: [
        { type: 'precompile_shader', shader_id: 'clock-shader', stage: 'pixel', entry: 'main', source: SOURCE },
        { type: 'upsert_layer', layer_id: 'clock-layer', z_index: 0, opacity: 1, blend_mode: 'normal',
          corners: { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } } },
        { type: 'set_layer_visibility', layer_id: 'clock-layer', visible: true },
        { type: 'bind_isf_shader', layer_id: 'clock-layer', shader_id: 'clock-shader' },
        { type: 'update_isf_uniforms', shader_id: 'clock-shader', time: 0, time_delta: 1 / 60, frame_index: 0,
          render_width: W, render_height: H, float_inputs: {}, point_inputs: {}, color_inputs: {} },
      ] }, 20000);
      let frame = 1;
      let redIndex: number | null = null;
      const turnAt = async (time: number) => {
        await rpc.send('submit_commands', { commands: [{ type: 'set_render_clock', mode: 'manual', time, time_delta: 1 / 60, frame_index: frame }] });
        frame += 1;
        // The core's own frame loop applies the clock to the shader.
        await new Promise((resolve) => setTimeout(resolve, 150));
        let value = -1;
        for (let attempt = 0; attempt < 40; attempt++) {
          const snap = await rpc.send('frame_snapshot', { include_pixels: true, time, frame_index: frame }, 8000);
          const px = Buffer.from(snap.rgba_b64, 'base64');
          const o = (Math.floor(snap.height / 2) * snap.width + Math.floor(snap.width / 2)) * 4;
          // BGRA or RGBA: the blue byte is 0, find red as the other one.
          if (redIndex === null && px[o + 3] > 0) redIndex = px[o] === 0 ? 2 : px[o + 2] === 0 ? 0 : null;
          if (redIndex !== null && px[o + 3] > 0) { value = px[o + redIndex] / 255; break; }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return value;
      };
      // Wait until the shader has drawn once.
      for (let i = 0; i < 60 && (await turnAt(10)) < 0; i++) await new Promise((resolve) => setTimeout(resolve, 100));
      const results: Record<string, number[]> = {};
      for (const [name, start] of [['10 s', 10], ['12 h', 12 * 3600 + 0.01], ['7 days', 7 * 86400 + 0.01]] as const) {
        const steps: number[] = [];
        let previous = await turnAt(start);
        if (name === '10 s') expect(previous).toBeCloseTo((10 * 4) % 1, 1);
        for (let k = 1; k <= 8; k++) {
          const value = await turnAt(start + k / 60);
          steps.push(Number((((value - previous) % 1 + 1) % 1).toFixed(3)));
          previous = value;
        }
        results[name] = steps;
      }
      if (process.env.GA_CLOCK_LOG) (await import('node:fs')).writeFileSync(process.env.GA_CLOCK_LOG, JSON.stringify(results));
      // 4/60 of a turn per frame (= 0.067), give or take 8-bit rounding.
      for (const [name, steps] of Object.entries(results)) {
        for (const step of steps) expect(Math.abs(step - 4 / 60), `${name}: ${JSON.stringify(steps)}`).toBeLessThan(0.02);
      }
    } finally {
      rpc.close();
    }
  }, 120000);
});
