import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';
import { defaultInteractive, type InteractiveScene } from '../mobile/studio/interactive';
import { makeEffect } from '../mobile/studio/interactiveEffects';
import { blockDepth, reliefFrame, reliefSolids, unproject } from '../scene3d/relief';
import { defaultReliefWorld } from '../scene3d/worldModel';
import { buildWorldPart } from './scene3dWorld';
import { BALL_FLOATS, DRIP_FLOATS, FLAME_FLOATS, scene3dWorldPrecompileCommands } from './scene3dWorldShaders';
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
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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

  it('burns on a block: flames rise above it, embers fall back, and Ignite lights a fire under the finger', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.send('submit_commands', { commands: [...scene3dPrecompileCommands(), ...scene3dWorldPrecompileCommands()] });
      const fire = { ...makeEffect('flames', 'plinth', false) };
      fire.params = { ...fire.params, flow: 0.9, embers: 1, lifetime: 2, amount: 2000 };
      const s: InteractiveScene = {
        ...defaultInteractive(),
        surfaces: [{ id: 'plinth', name: 'Plinth', behavior: 'solid', height: 0.3, points: [{ x: 0.4, y: 0.6 }, { x: 0.6, y: 0.6 }, { x: 0.6, y: 0.9 }, { x: 0.4, y: 0.9 }] }],
        effects: [fire],
        world: defaultReliefWorld(),
      };
      const world = s.world!;
      const step = async (n: number, igniteAt?: { x: number; y: number }, read = false) => {
        const part = buildWorldPart({
          scene: s, world, sourceId: 'flames-test', width: W, height: H,
          input: igniteAt ? { pointers: [{ point: igniteAt, velocity: { x: 0, y: 0 }, tool: 'ignite', strength: 1 }], throws: [] } : undefined,
        });
        const buffers = part.buffers.map((b) => (b.id.endsWith(':scene3d:frame') ? { ...b, initial_b64: frameBlock(n) } : b));
        const flames = part.buffers.find((b) => b.id.endsWith(':flames'))!.id;
        const result = await rpc.send('compute_graph', {
          buffers, passes: part.passes, render_passes: [], textures: [],
          readbacks: read ? [{ id: flames, include_bytes: true }] : [],
        });
        if (!read) return null;
        const bytes = Buffer.from(result.readbacks[flames].bytes_b64, 'base64');
        return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      };
      for (let n = 1; n < 240; n++) await step(n);
      const state = (await step(240, undefined, true))!;
      const frame = reliefFrame(W / H, world.lens);
      const d = blockDepth(reliefSolids(s)[0], world, frame);
      const top = unproject(frame, { x: 0.5, y: 0.6 }, d).y;
      const flames: number[][] = [], embers: number[][] = [];
      let nan = 0;
      for (let i = 0; i < state.length / FLAME_FLOATS; i++) {
        const q = state.subarray(i * FLAME_FLOATS, i * FLAME_FLOATS + FLAME_FLOATS);
        if (![...q].every(Number.isFinite)) { nan++; continue; }
        if (q[3] <= 0) continue;
        (q[10] > 1.5 ? embers : flames).push([...q]);
      }
      const above = flames.filter((q) => q[1] > top + 0.1);
      const report = JSON.stringify({ flames: flames.length, embers: embers.length, above: above.length, nan, top });
      expect(nan, report).toBe(0);
      expect(flames.length, report).toBeGreaterThan(100);
      expect(above.length, report).toBeGreaterThan(flames.length * 0.4);
      // Embers come back down: some are falling.
      expect(embers.filter((q) => q[5] < 0).length, report).toBeGreaterThan(0);

      for (let n = 241; n < 250; n++) await step(n, { x: 0.15, y: 0.3 });
      const lit = (await step(250, { x: 0.15, y: 0.3 }, true))!;
      const want = unproject(frame, { x: 0.15, y: 0.3 }, 0);
      let near = 0;
      for (let i = 0; i < 2048; i++) {
        const q = lit.subarray(i * FLAME_FLOATS, i * FLAME_FLOATS + FLAME_FLOATS);
        if (q[3] > 0 && Math.hypot(q[0] - want.x, q[1] - want.y) < 0.6) near++;
      }
      expect(near, 'a fire under the finger').toBeGreaterThan(40);
    } finally {
      await rpc.close();
    }
  }, 120000);

  it('counts a ball each time it comes into a zone', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.send('submit_commands', { commands: [...scene3dPrecompileCommands(), ...scene3dWorldPrecompileCommands()] });
      const s: InteractiveScene = {
        ...defaultInteractive(),
        surfaces: [{
          id: 'zone', name: 'Zone', behavior: 'trigger',
          points: [{ x: 0.05, y: 0.4 }, { x: 0.3, y: 0.4 }, { x: 0.3, y: 0.6 }, { x: 0.05, y: 0.6 }],
          trigger: { actions: [{ kind: 'burst' }], rearm: 1, when: 'ball' },
        }],
        effects: [],
        world: defaultReliefWorld(),
      };
      const world = s.world!;
      let hitsId = '';
      const step = async (n: number, throwAt?: { x: number; y: number }, number = 1, read = false) => {
        const part = buildWorldPart({
          scene: s, world, sourceId: 'zones-test', width: W, height: H,
          input: throwAt ? { pointers: [], throws: [{ point: throwAt, velocity: { x: 0, y: 0 }, number, at: 0 }] } : undefined,
        });
        hitsId = part.zoneHits!.bufferId;
        const buffers = part.buffers.map((b) => (b.id.endsWith(':scene3d:frame') ? { ...b, initial_b64: frameBlock(n) } : b));
        const result = await rpc.send('compute_graph', {
          buffers, passes: part.passes, render_passes: [], textures: [],
          readbacks: read ? [{ id: hitsId, include_bytes: true }] : [],
        });
        if (!read) return [];
        const bytes = Buffer.from(result.readbacks[hitsId].bytes_b64, 'base64');
        return Array.from(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
      };
      // Two balls dropped above the zone fall through it; one far from it does not.
      await step(1, { x: 0.17, y: 0.2 }, 1);
      await step(2, { x: 0.8, y: 0.2 }, 2);
      for (let n = 3; n < 40; n++) await step(n);
      await step(40, { x: 0.18, y: 0.15 }, 3);
      for (let n = 41; n < 100; n++) await step(n);
      const counts = await step(100, undefined, 1, true);
      expect(counts[0], `zone counts: ${counts.slice(0, 2)}`).toBe(2);
    } finally {
      await rpc.close();
    }
  }, 120000);

  it('reads a layer’s zone counts back live with take_graph_readbacks', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.send('submit_commands', { commands: [...scene3dPrecompileCommands(), ...scene3dWorldPrecompileCommands()] });
      const s: InteractiveScene = {
        ...defaultInteractive(),
        surfaces: [{
          id: 'zone', name: 'Zone', behavior: 'trigger',
          points: [{ x: 0.05, y: 0.4 }, { x: 0.3, y: 0.4 }, { x: 0.3, y: 0.6 }, { x: 0.05, y: 0.6 }],
          trigger: { actions: [{ kind: 'burst' }], rearm: 1, when: 'ball' },
        }],
        effects: [],
        world: defaultReliefWorld(),
      };
      const part = (throws: { point: { x: number; y: number }; number: number }[] = []) => buildWorldPart({
        scene: s, world: s.world!, sourceId: 'live-test', width: W, height: H,
        input: { pointers: [], throws: throws.map((t) => ({ ...t, velocity: { x: 0, y: 0 }, at: 0 })) },
      });
      const first = part();
      const config = { textures: first.textures, buffers: first.buffers, passes: first.passes, render_passes: first.render_passes, readbacks: [], live_readbacks: [first.zoneHits!.bufferId] };
      // Compile the graph's pipelines once before installing it.
      await rpc.send('compute_graph', { ...config, live_readbacks: undefined });
      const full = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
      await rpc.send('submit_commands', { commands: [
        { type: 'upsert_layer', layer_id: 'w', z_index: 0, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'set_layer_visibility', layer_id: 'w', visible: true },
        { type: 'set_native_graph_layer', layer_id: 'w', kind: 'performer-world', instrument_source_id: 'live-test', composite_source_id: 'live-test', input_source_id: null, effect_graph: config, params: {} },
        { type: 'bind_media_source', layer_id: 'w', source_id: 'live-test', uri: 'native-graph://performer-world/live-test', source_type: 'video' },
      ] });
      const input = (throws: { point: { x: number; y: number }; number: number }[]) => {
        const v = part(throws).values.find((x) => x.id.endsWith(':ball-input'))!;
        return { type: 'update_native_graph_buffer', layer_id: 'w', buffer_id: v.id, initial_b64: v.initial_b64 };
      };
      const frames = async (n: number) => { for (let i = 0; i < n; i++) { await rpc.send('submit_commands', { commands: [{ type: 'present' }] }); await wait(20); } };
      await frames(10);
      await rpc.send('submit_commands', { commands: [input([{ point: { x: 0.17, y: 0.2 }, number: 1 }, { point: { x: 0.2, y: 0.15 }, number: 2 }])] });
      await frames(5);
      await rpc.send('submit_commands', { commands: [input([])] });
      let counts: number[] = [];
      for (let tries = 0; tries < 60 && !(counts[0] >= 2); tries++) {
        await frames(3);
        const taken = await rpc.send('take_graph_readbacks', { ids: [first.zoneHits!.bufferId] });
        const b64 = taken.readbacks[first.zoneHits!.bufferId];
        if (b64) { const bytes = Buffer.from(b64, 'base64'); counts = Array.from(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)); }
      }
      const status = await rpc.send('status');
      expect(counts[0], `live counts ${counts.slice(0, 2)} runs ${status.compute_graph_runs} err ${status.last_shader_error} ${status.last_frame_error}`).toBe(2);
    } finally {
      await rpc.close();
    }
  }, 120000);
});
