import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';
import {
  HEIGHT,
  SHADOW_TEST_CASES,
  WIDTH,
  shaderSources,
  shadowTestGraph,
  shadowTestResult,
  snapshotPixels,
  type Pixels,
  type SceneState,
} from '../../../scripts/scene3d-spike/scene.mjs';

/**
 * A 3D scene drawn by a compute graph casts a real shadow: graph-owned colour
 * and depth textures, a shadow map pass, and a lit pass that samples it. The
 * ground point behind the sphere darkens with the shadow map on, while a point
 * outside the shadow (and the same point with nothing casting) stays the same.
 */
type Command = Record<string, unknown>;
function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(String(message.error)));
  });
  const send = (method: string, params: Command = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() { try { await send('shutdown'); } catch { /* gone */ } await closeNativeTestCore(child); },
  };
}

const full = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const suite = platform.runnable ? describe : describe.skip;
suite('Scene 3D graph textures', () => {
  it('draws a shadow that darkens only the shadowed ground', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: {
        backend: platform.rendererBackend, width: WIDTH, height: HEIGHT, target_fps: 60, native_quality_policy: 'fixed',
      } });
      await rpc.commands(Object.entries(shaderSources()).map(([shader_id, source]) => ({
        type: 'precompile_shader', shader_id, stage: 'render', entry: shader_id.endsWith('/post') ? 'fs_composite' : 'fs_main', source,
      })));
      const compiled = await rpc.send('status');
      expect(compiled.last_shader_error || '').toBe('');

      const shots: Record<string, Pixels> = {};
      let state: SceneState | undefined;
      for (const name of Object.keys(SHADOW_TEST_CASES)) {
        const graph = shadowTestGraph(name);
        state = graph.state;
        await rpc.send('compute_graph', graph.config);
        await rpc.commands([
          { type: 'upsert_layer', layer_id: 's3d', z_index: 0, blend_mode: 'normal', opacity: 1, corners: full },
          { type: 'set_layer_visibility', layer_id: 's3d', visible: true },
          { type: 'bind_media_source', layer_id: 's3d', source_id: graph.out, uri: 'native-graph://scene3d', source_type: 'image' },
          { type: 'present' },
        ]);
        const status = await rpc.send('status');
        expect(String(status.last_shader_error || status.last_frame_error || ''), name).toBe('');
        await wait(250);
        shots[name] = snapshotPixels(await rpc.send('frame_snapshot', { include_pixels: true }));
      }
      const result = shadowTestResult(shots, state!, shots.lit.w, shots.lit.h);
      expect(result.shadow_point_lit, JSON.stringify(result)).toBeGreaterThan(0.05);
      expect(result.darkening, JSON.stringify(result)).toBeLessThan(0.6);
      expect(result.control_change, JSON.stringify(result)).toBeLessThan(0.02);
      expect(result.no_occluder_change, JSON.stringify(result)).toBeLessThan(0.02);

      // The core holds the graph's textures and reports them.
      const held = await rpc.send('status');
      expect(held.graph_textures).toBeGreaterThan(0);
      expect(held.graph_texture_bytes).toBeGreaterThan(0);

      // With the layer gone and no graph drawing into them, they are freed
      // after the two-second grace period, even with the core idle.
      await rpc.commands([{ type: 'remove_layer', layer_id: 's3d' }, { type: 'present' }]);
      let released = held;
      for (let i = 0; i < 40 && released.graph_textures > 0; i++) {
        await wait(150);
        await rpc.commands([{ type: 'present' }]);
        released = await rpc.send('status');
      }
      expect(released.graph_textures).toBe(0);
      expect(released.graph_texture_bytes).toBe(0);
    } finally { await rpc.close(); }
  }, 60000);
});
