import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';
import { defaultInteractive, type InteractiveScene } from '../mobile/studio/interactive';
import { makeEffect } from '../mobile/studio/interactiveEffects';
import { blockDepth, reliefFrame, reliefSolids, unproject } from '../scene3d/relief';
import { defaultReliefWorld } from '../scene3d/worldModel';
import { buildWorldPart } from './scene3dWorld';
import { BALL_FLOATS, DRIP_FLOATS, scene3dWorldPrecompileCommands } from './scene3dWorldShaders';
import { scene3dPrecompileCommands } from './scene3dShaders';

/**
 * The relief world's balls on the GPU, without drawing: a ledge stands out
 * of the wall, balls rain onto it for ten simulated seconds, and the ball
 * buffer is read back. They must come to rest on the ledge's top, none
 * inside it, none lost to NaN; a thrown ball must appear where it was thrown.
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
    async close() {
      try { await send('shutdown'); } catch { /* gone */ }
      await closeNativeTestCore(child);
    },
  };
}

const W = 960, H = 540;
const LEDGE = { x0: 0.2, x1: 0.8, y0: 0.6, y1: 0.72 };

function scene(): InteractiveScene {
  const balls = makeEffect('balls3d', 'point', false);
  balls.params = { ...balls.params, x: 0.5, y: 0.1, radius: 0.2, flow: 1, amount: 64, lifetime: 40, size: 0.3, variety: 0, speed: 0, bounce: 0.1, friction: 0.9 };
  return {
    ...defaultInteractive(),
    surfaces: [{
      id: 'ledge', name: 'Ledge', behavior: 'solid', height: 0.3,
      points: [{ x: LEDGE.x0, y: LEDGE.y0 }, { x: LEDGE.x1, y: LEDGE.y0 }, { x: LEDGE.x1, y: LEDGE.y1 }, { x: LEDGE.x0, y: LEDGE.y1 }],
    }],
    effects: [balls],
    world: defaultReliefWorld(),
  };
}

/** The frame block the core writes for a layer, written here by hand. */
function frameBlock(n: number): string {
  const f = new Float32Array(16);
  f.set([n / 60, 1 / 60, n]);
  return Buffer.from(f.buffer).toString('base64');
}

const suite = platform.runnable ? describe : describe.skip;
suite('Relief world balls on the GPU', () => {
  it('rain onto a ledge and come to rest on its top, and a throw lands where it was thrown', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.send('submit_commands', { commands: [...scene3dPrecompileCommands(), ...scene3dWorldPrecompileCommands()] });
      const s = scene();
      const world = s.world!;
      const step = async (n: number, throwAt?: { x: number; y: number }, read = false) => {
        const part = buildWorldPart({
          scene: s, world, sourceId: 'balls-test', width: W, height: H,
          input: throwAt ? { pointers: [], throws: [{ point: throwAt, velocity: { x: 0, y: 0 }, number: 1, at: 0 }] } : undefined,
        });
        const buffers = part.buffers.map((b) => (b.id.endsWith(':scene3d:frame') ? { ...b, initial_b64: frameBlock(n) } : b));
        const balls = part.buffers.find((b) => b.id.endsWith(':balls'))!.id;
        const result = await rpc.send('compute_graph', {
          buffers, passes: part.passes, render_passes: [], textures: [],
          readbacks: read ? [{ id: balls, include_bytes: true }] : [],
        });
        if (!read) return null;
        const bytes = Buffer.from(result.readbacks[balls].bytes_b64, 'base64');
        return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      };
      for (let n = 1; n < 600; n++) await step(n);
      const state = (await step(600, undefined, true))!;

      const frame = reliefFrame(W / H, world.lens);
      const d = blockDepth(reliefSolids(s)[0], world, frame);
      const top = unproject(frame, { x: 0.5, y: LEDGE.y0 }, d).y;
      const bottom = unproject(frame, { x: 0.5, y: LEDGE.y1 }, d).y;
      const left = unproject(frame, { x: LEDGE.x0, y: 0.5 }, d).x, right = unproject(frame, { x: LEDGE.x1, y: 0.5 }, d).x;
      const live: { x: number; y: number; z: number; r: number; speed: number }[] = [];
      let nan = 0;
      for (let i = 0; i < state.length / BALL_FLOATS; i++) {
        const b = state.subarray(i * BALL_FLOATS, i * BALL_FLOATS + BALL_FLOATS);
        if (![...b].every(Number.isFinite)) { nan++; continue; }
        if (b[3] > 0) live.push({ x: b[0], y: b[1], z: b[2], r: b[3], speed: Math.hypot(b[4], b[5], b[6]) });
      }
      const inside = live.filter((b) => b.x > left && b.x < right && b.y < top - 0.02 && b.y > bottom && b.z < d - 0.02);
      const resting = live.filter((b) => b.x > left && b.x < right && Math.abs(b.y - (top + b.r)) < b.r * 0.6 && b.speed < 0.6);
      const report = JSON.stringify({ live: live.length, nan, inside: inside.length, resting: resting.length, top, sample: live.slice(0, 4) });
      expect(nan, report).toBe(0);
      expect(live.length, report).toBeGreaterThan(40);
      expect(inside.length, report).toBe(0);
      expect(resting.length, report).toBeGreaterThan(live.length * 0.4);

      // A throw over the wall, away from the ledge: a ball starts right there.
      const thrown = (await step(601, { x: 0.15, y: 0.2 }, true))!;
      const want = unproject(frame, { x: 0.15, y: 0.2 }, 0);
      // Throw number 1 takes thrown slot 1.
      const ball = thrown.subarray(BALL_FLOATS, 2 * BALL_FLOATS);
      const k = 1 - ball[2] / frame.camZ;
      expect(ball[3], `thrown ball in play: ${[...ball]}`).toBeGreaterThan(0);
      expect(ball[0] / k, `under the finger: ${[...ball]} want ${JSON.stringify(want)}`).toBeCloseTo(want.x, 1);
      expect(ball[1] / k, `under the finger: ${[...ball]} want ${JSON.stringify(want)}`).toBeCloseTo(want.y, 1);
    } finally {
      await rpc.close();
    }
  }, 120000);

  it('runs paint down the front of a block, off its bottom edge onto the floor, and pours where a finger pours', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.send('submit_commands', { commands: [...scene3dPrecompileCommands(), ...scene3dWorldPrecompileCommands()] });
      const paint = { ...makeEffect('drips', 'tall', false) };
      paint.params = { ...paint.params, flow: 0.9, viscosity: 0, stick: 1, lifetime: 40, amount: 600, size: 0.4 };
      const s: InteractiveScene = {
        ...defaultInteractive(),
        surfaces: [{ id: 'tall', name: 'Tall', behavior: 'solid', height: 0.3, points: [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.7 }, { x: 0.4, y: 0.7 }] }],
        effects: [paint],
        world: defaultReliefWorld(),
      };
      const world = s.world!;
      const step = async (n: number, pourAt?: { x: number; y: number }, read = false) => {
        const part = buildWorldPart({
          scene: s, world, sourceId: 'drips-test', width: W, height: H,
          input: pourAt ? { pointers: [{ point: pourAt, velocity: { x: 0, y: 0 }, tool: 'pour', strength: 1 }], throws: [] } : undefined,
        });
        const buffers = part.buffers.map((b) => (b.id.endsWith(':scene3d:frame') ? { ...b, initial_b64: frameBlock(n) } : b));
        const drips = part.buffers.find((b) => b.id.endsWith(':drips'))!.id;
        const result = await rpc.send('compute_graph', {
          buffers, passes: part.passes, render_passes: [], textures: [],
          readbacks: read ? [{ id: drips, include_bytes: true }] : [],
        });
        if (!read) return null;
        const bytes = Buffer.from(result.readbacks[drips].bytes_b64, 'base64');
        return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      };
      for (let n = 1; n < 360; n++) await step(n);
      const state = (await step(360, undefined, true))!;
      const frame = reliefFrame(W / H, world.lens);
      const d = blockDepth(reliefSolids(s)[0], world, frame);
      const top = unproject(frame, { x: 0.5, y: 0.3 }, d).y, bottom = unproject(frame, { x: 0.5, y: 0.7 }, d).y;
      const floor = -frame.H / 2;
      const drops: { x: number; y: number; z: number; r: number; state: number }[] = [];
      let nan = 0;
      for (let i = 0; i < state.length / DRIP_FLOATS; i++) {
        const q = state.subarray(i * DRIP_FLOATS, i * DRIP_FLOATS + DRIP_FLOATS);
        if (![...q].every(Number.isFinite)) { nan++; continue; }
        if (q[3] > 0) drops.push({ x: q[0], y: q[1], z: q[2], r: q[3], state: q[10] });
      }
      const onFront = drops.filter((q) => q.state === 2 && Math.abs(q.z - d) < q.r * 1.5 && q.y < top - 0.05 && q.y > bottom);
      const onFloor = drops.filter((q) => q.y < floor + q.r * 3 && q.z > 0.02);
      const inside = drops.filter((q) => q.z < d - 0.03 && q.y < top - 0.03 && q.y > bottom + 0.03 && Math.abs(q.x) < unproject(frame, { x: 0.6, y: 0.5 }, d).x - 0.03);
      const report = JSON.stringify({ drops: drops.length, nan, onFront: onFront.length, onFloor: onFloor.length, inside: inside.length, sample: drops.slice(0, 3) });
      expect(nan, report).toBe(0);
      expect(onFront.length, report).toBeGreaterThan(10);
      expect(onFloor.length, report).toBeGreaterThan(5);
      expect(inside.length, report).toBe(0);

      // Pour on the bare wall, away from the block: drops start there.
      for (let n = 361; n < 366; n++) await step(n, { x: 0.15, y: 0.25 });
      const poured = (await step(366, { x: 0.15, y: 0.25 }, true))!;
      const want = unproject(frame, { x: 0.15, y: 0.25 }, 0);
      let near = 0;
      for (let i = 0; i < 4096; i++) {
        const q = poured.subarray(i * DRIP_FLOATS, i * DRIP_FLOATS + DRIP_FLOATS);
        // On the wall, running down it, not falling in front of it.
        if (q[3] > 0 && Math.hypot(q[0] - want.x, q[1] - want.y) < 0.4 && q[10] === 2 && q[2] < 0.15) near++;
      }
      expect(near, 'drops poured onto the wall under the finger').toBeGreaterThanOrEqual(12);
    } finally {
      await rpc.close();
    }
  }, 120000);
});
