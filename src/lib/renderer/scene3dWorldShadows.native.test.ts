import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';
import { defaultInteractive, type InteractiveScene } from '../mobile/studio/interactive';
import { makeEffect } from '../mobile/studio/interactiveEffects';
import { defaultReliefWorld } from '../scene3d/worldModel';
import { buildWorldPart } from './scene3dWorld';
import { scene3dWorldPrecompileCommands } from './scene3dWorldShaders';
import { scene3dPrecompileCommands } from './scene3dShaders';
import { snapshotPixels } from '../../../scripts/scene3d-spike/scene.mjs';

/**
 * The 3D world's two shadow passes share one shadow map: the blocks draw it,
 * then the balls add to it. The ball pass used to clear it first, so a world
 * with balls lost every block shadow. Drawn by the core as an Interactive
 * layer over a pale wall lit by the sun alone: the wall around a block must
 * darken where its shadow falls, and around a floating ball where the
 * ball's does, both in the same frame.
 */
type Command = Record<string, unknown>;
function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(String(message.error)));
  });
  const send = (method: string, params: Command = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() {
      try { await send('shutdown'); } catch { /* gone */ }
      await closeNativeTestCore(child);
    },
  };
}

const W = 960, H = 540;
const full = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BLOCK = { x0: 0.18, x1: 0.38, y0: 0.3, y1: 0.6 };
const BALL = { x: 0.72, y: 0.4 };

function scene(block: boolean, ball: boolean): InteractiveScene {
  const balls = makeEffect('balls3d', 'point', false);
  // No balls of its own: only the one thrown below.
  balls.params = { ...balls.params, flow: 0, amount: 1, size: 1, variety: 0, speed: 0, lifetime: 40 };
  return {
    ...defaultInteractive(),
    surfaces: block
      ? [{ id: 'block', name: 'Block', behavior: 'solid', height: 0.6, points: [{ x: BLOCK.x0, y: BLOCK.y0 }, { x: BLOCK.x1, y: BLOCK.y0 }, { x: BLOCK.x1, y: BLOCK.y1 }, { x: BLOCK.x0, y: BLOCK.y1 }] }]
      : [],
    effects: ball ? [balls] : [],
    world: {
      ...defaultReliefWorld(),
      // A pale wall in sunlight only, nothing moving: the shadows are all that differs.
      wall: { color: '#d8d8d8', rough: 0.9, catcher: false },
      gravity: 0,
      flat: 'off',
      bloom: 0,
      sun: { ...defaultReliefWorld().sun, color: '#ffffff', power: 2, sway: 0 },
      fill: { color: '#000000', power: 0 },
    },
  };
}

const suite = platform.runnable ? describe : describe.skip;
suite('3D world shadows', () => {
  it('keeps the blocks’ shadows when the balls add theirs', async () => {
    const rpc = core();
    const source = 'world-shadow-test';
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.commands([...scene3dPrecompileCommands(), ...scene3dWorldPrecompileCommands()]);

      const shot = async (s: InteractiveScene) => {
        const part = buildWorldPart({
          scene: s, world: s.world!, sourceId: source, width: W, height: H,
          input: { pointers: [], throws: s.effects?.length ? [{ point: BALL, velocity: { x: 0, y: 0 }, number: 1, at: 0 }] : [] },
        });
        const config = { textures: part.textures, buffers: part.buffers, passes: part.passes, render_passes: part.render_passes, readbacks: [] };
        await rpc.send('compute_graph', config);
        await rpc.commands([
          { type: 'upsert_layer', layer_id: 'w', z_index: 0, opacity: 1, blend_mode: 'normal', corners: full },
          { type: 'set_layer_visibility', layer_id: 'w', visible: true },
          { type: 'set_native_graph_layer', layer_id: 'w', kind: 'performer-world', instrument_source_id: source, composite_source_id: source, input_source_id: null, effect_graph: config, params: {} },
          { type: 'bind_media_source', layer_id: 'w', source_id: source, uri: `native-graph://performer-world/${source}`, source_type: 'video' },
        ]);
        for (let i = 0; i < 12; i++) { await wait(60); await rpc.commands([{ type: 'present' }]); }
        const status = await rpc.send('status');
        expect(String(status.last_shader_error || status.last_frame_error || '')).toBe('');
        return snapshotPixels(await rpc.send('frame_snapshot', { include_pixels: true }));
      };
      const luma = (img: ReturnType<typeof snapshotPixels>, x: number, y: number) => {
        const i = (y * img.w + x) * 4;
        return (0.2126 * img.rgba[i] + 0.7152 * img.rgba[i + 1] + 0.0722 * img.rgba[i + 2]) / 255;
      };
      /** Wall pixels within `reach` of a spot (but not on the object itself) that went at least 30% darker than on the bare wall. */
      const shadowed = (img: ReturnType<typeof snapshotPixels>, bare: ReturnType<typeof snapshotPixels>, own: (u: number, v: number) => boolean, near: (u: number, v: number) => boolean) => {
        let n = 0;
        for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
          const u = x / W, v = y / H;
          if (own(u, v) || !near(u, v)) continue;
          const base = luma(bare, x, y);
          if (base > 0.08 && luma(img, x, y) < base * 0.7) n++;
        }
        return n;
      };
      const pad = 0.02;
      const onBlock = (u: number, v: number) => u > BLOCK.x0 - pad && u < BLOCK.x1 + pad && v > BLOCK.y0 - pad && v < BLOCK.y1 + pad;
      const nearBlock = (u: number, v: number) => u > BLOCK.x0 - 0.2 && u < BLOCK.x1 + 0.2 && v > BLOCK.y0 - 0.2 && v < BLOCK.y1 + 0.25;
      const onBall = (u: number, v: number) => Math.hypot((u - BALL.x) * (W / H), v - BALL.y) < 0.09;
      const nearBall = (u: number, v: number) => Math.hypot((u - BALL.x) * (W / H), v - BALL.y) < 0.35;

      const bare = await shot(scene(false, false));
      const blockOnly = await shot(scene(true, false));
      const both = await shot(scene(true, true));
      const counts = {
        blockOnly: shadowed(blockOnly, bare, onBlock, nearBlock),
        blockWithBall: shadowed(both, bare, onBlock, nearBlock),
        ball: shadowed(both, bare, (u, v) => onBall(u, v) || onBlock(u, v), (u, v) => nearBall(u, v) && !nearBlock(u, v)),
        wallLuma: luma(bare, Math.round(W * 0.55), Math.round(H * 0.8)),
      };
      const report = JSON.stringify(counts);
      expect(counts.wallLuma, `the bare wall is lit: ${report}`).toBeGreaterThan(0.08);
      expect(counts.blockOnly, `a block casts a shadow: ${report}`).toBeGreaterThan(200);
      // The bug: the ball pass cleared the map, and the block's shadow went.
      expect(counts.blockWithBall, `the block's shadow stays with a ball in the world: ${report}`).toBeGreaterThan(counts.blockOnly * 0.7);
      expect(counts.ball, `the ball casts its own shadow too: ${report}`).toBeGreaterThan(20);
    } finally {
      await rpc.close();
    }
  }, 120000);
});
