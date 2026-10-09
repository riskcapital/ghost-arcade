// HandFX body and face modes on the real render core: every mode has to show
// a picture from a cold start, follow the rehearsal body or face, survive an
// empty camera, and come back when the performer does.
//
// HANDFX_CAPTURE_DIR=<dir> also writes each measured frame as a PNG.
// HANDFX_BENCH=1 runs the 1920x1080 frame-time measurement.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import {
  buildNativeHandInputUpdate,
  buildNativePluginGraph,
  buildNativePluginPrecompileCommands,
  type NativePluginGraphState,
} from './nativePluginGraphs';
import { HAND_FX_FIELD_MODES, HAND_FX_QUALITY_PARTICLES } from './nativeHandFxField';
import { softwareVulkanRunner } from './nativeHardwareTestPlatform';
import type { SignalFrame } from '../mediapipe/signals';

const nativeCoreBin = join(process.cwd(), 'native-renderer/target/release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
// These tests watch a simulation settle in real time, which a software GPU cannot do.
const itLive = existsSync(nativeCoreBin) && !softwareVulkanRunner ? it : it.skip;
const itBench = existsSync(nativeCoreBin) && process.env.HANDFX_BENCH ? it : it.skip;
const itShots = existsSync(nativeCoreBin) && process.env.HANDFX_SHOTS ? it : it.skip;
const audioOff = { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Rpc = { send: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<any>; close: () => void };

function createRpc(): Rpc {
  const child: ChildProcessWithoutNullStreams = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (process.env.GA_SHADER_DEBUG) child.stderr.on('data', (d) => process.stderr.write(d)); else child.stderr.resume();
  const rl = createInterface({ input: child.stdout });
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  let nextId = 1;
  rl.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.rej(new Error(JSON.stringify(message.error))); else entry.res(message.result);
    } catch { /* non-JSON core output */ }
  });
  return {
    send(method, params = {}, timeoutMs = 20000) {
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

type Picture = {
  width: number; height: number;
  /** Share of pixels that are not black. */
  coverage: number;
  /** Mean brightness, 0..1. */
  mean: number;
  /** Brightness-weighted centre, 0..1 from the left and from the top. */
  centreX: number; centreY: number;
  /** Distinct colours after rounding each channel to 16 levels. */
  colours: number;
  /** Share of pixels at full white: a blown-out picture. */
  blown: number;
  /** Brightness of a coarse 32x18 grid, for comparing two pictures. */
  cells: Float32Array;
  rgba: Buffer;
};

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function writePng(path: string, picture: Picture) {
  const { width, height, rgba } = picture;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      raw[row + 1 + x * 3] = rgba[from]; raw[row + 2 + x * 3] = rgba[from + 1]; raw[row + 3 + x * 3] = rgba[from + 2];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

class Stage {
  rpc = createRpc();
  state: NativePluginGraphState | null = null;
  params: Record<string, any> = {};
  started = 0;
  /** Rehearsal clock. `null` follows real time; a number holds the body still there. */
  holdTime: number | null = null;
  audio = audioOff;
  /** Hands the live camera sees. Empty: nobody in view. */
  hands: SignalFrame['hands'] = [];
  frame = 0;
  readonly layerId = 'handfx-field';
  readonly sourceId = 'plugin:handfx:field';
  constructor(readonly width = 640, readonly height = 360) {}

  async start(precompileFirst = true) {
    const started = await this.rpc.send('start', { config: { width: this.width, height: this.height, source_frame_size: this.width > 1024 ? 2048 : 512, target_fps: 60 } });
    expect(started?.backend_ready).toBe(true);
    if (precompileFirst) await this.precompile();
    this.started = performance.now();
  }

  async precompile() {
    const commands = buildNativePluginPrecompileCommands().filter((command) => command.shader_id.startsWith('handfx/'));
    await this.rpc.send('submit_commands', { commands });
    let status: any = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      status = await this.rpc.send('status');
      if (Number(status.shader_precompile_compiled ?? 0) + Number(status.shader_precompile_failed ?? 0) >= commands.length) break;
      await wait(25);
    }
    expect(Number(status.shader_precompile_failed ?? -1), String(status.last_shader_error ?? '')).toBe(0);
  }

  now() { return this.holdTime ?? 1 + (performance.now() - this.started) / 1000; }

  options() {
    return { sourceId: this.sourceId, params: this.params, width: this.width, height: this.height, time: this.now(),
      frameDelta: 1 / 60, frameIndex: ++this.frame, audio: this.audio, state: this.state,
      // A live camera that sees nobody: hands, body and face all absent.
      handFrame: { timestamp: performance.now(), values: {}, confidence: {}, gestures: { 'gesture.right': '', 'gesture.left': '' }, hands: this.hands } as SignalFrame };
  }

  /** Install the graph the way the app does on a mode or setting change. */
  async install(params: Record<string, any>, extraCommands: Record<string, unknown>[] = []) {
    this.params = { handfxInput: 'demo', handfxCameraOn: false, ...params };
    const built = buildNativePluginGraph({ ...this.options(), kind: 'handfx', reset: !this.state });
    this.state = built.state;
    await this.rpc.send('submit_commands', { commands: [
      ...extraCommands,
      { type: 'upsert_layer', layer_id: this.layerId, z_index: 0, opacity: 1, blend_mode: 'normal',
        // Corners are y-up; snapshots are top-down.
        corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
      { type: 'set_layer_visibility', layer_id: this.layerId, visible: true },
      { type: 'set_native_graph_layer', layer_id: this.layerId, kind: 'handfx', instrument_source_id: this.sourceId,
        composite_source_id: this.sourceId, input_source_id: null, effect_graph: built.config, params: this.params },
      { type: 'bind_media_source', layer_id: this.layerId, source_id: this.sourceId, uri: 'plugin://handfx', source_type: 'video' },
    ] });
  }

  /** Run for a while, sending only the small input buffers each tick, as the app does. */
  async run(seconds: number) {
    const until = performance.now() + seconds * 1000;
    while (performance.now() < until) {
      const update = buildNativeHandInputUpdate(this.options());
      this.state = update.state;
      await this.rpc.send('submit_commands', { commands: update.buffers.map((buffer) => ({
        type: 'update_native_graph_buffer', layer_id: this.layerId, buffer_id: buffer.id, initial_b64: buffer.initialB64 })) });
      await wait(12);
    }
  }

  async picture(name?: string): Promise<Picture> {
    const shot = await this.rpc.send('frame_snapshot', { include_pixels: true }, 30000);
    const bytes = Buffer.from(shot.rgba_b64, 'base64');
    const width = Number(shot.width), height = Number(shot.height);
    const bgra = String(shot.format).toLowerCase().startsWith('bgra');
    const rgba = Buffer.alloc(width * height * 4);
    const cells = new Float32Array(32 * 18);
    const colours = new Set<number>();
    let lit = 0, sum = 0, sumX = 0, sumY = 0, blown = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        const r = bytes[bgra ? o + 2 : o], g = bytes[o + 1], b = bytes[bgra ? o : o + 2];
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
        const luma = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        if (Math.max(r, g, b) > 10) lit += 1;
        if (Math.min(r, g, b) > 250) blown += 1;
        sum += luma; sumX += luma * (x + 0.5); sumY += luma * (y + 0.5);
        cells[Math.min(17, Math.floor(y * 18 / height)) * 32 + Math.min(31, Math.floor(x * 32 / width))] += luma;
        colours.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
    const pixels = width * height;
    const picture: Picture = { width, height, coverage: lit / pixels, mean: sum / pixels, colours: colours.size, blown: blown / pixels,
      centreX: sum > 0 ? sumX / sum / width : 0.5, centreY: sum > 0 ? sumY / sum / height : 0.5, cells, rgba };
    if (name && process.env.HANDFX_CAPTURE_DIR) {
      mkdirSync(process.env.HANDFX_CAPTURE_DIR, { recursive: true });
      writePng(join(process.env.HANDFX_CAPTURE_DIR, `${name}.png`), picture);
      console.log(`[handfx] ${name} coverage=${picture.coverage.toFixed(3)} mean=${picture.mean.toFixed(3)} colours=${picture.colours} blown=${picture.blown.toFixed(4)} centre=${picture.centreX.toFixed(3)},${picture.centreY.toFixed(3)}`);
    }
    return picture;
  }
}

/** How different two pictures are: mean absolute brightness change over the coarse grid, relative to the brighter one. */
function change(a: Picture, b: Picture): number {
  let difference = 0, total = 0;
  for (let i = 0; i < a.cells.length; i += 1) { difference += Math.abs(a.cells[i] - b.cells[i]); total += Math.max(a.cells[i], b.cells[i]); }
  return total > 0 ? difference / total : 0;
}

describe('HandFX body and face modes (runtime, real core)', () => {
  let stage: Stage | null = null;
  afterEach(() => { stage?.rpc.close(); stage = null; });

  itLive.each([...HAND_FX_FIELD_MODES])('%s shows a picture from a cold start', async (mode) => {
    // Cold: the shaders are sent in the same batch as the graph, so the first
    // frames run while pipelines are still compiling and passes get skipped.
    stage = new Stage();
    await stage.start(false);
    const precompile = buildNativePluginPrecompileCommands().filter((command) => command.shader_id.startsWith('handfx/'));
    await stage.install({ handfxMode: mode, handfxQuality: 'medium' }, precompile);
    await stage.run(2.5);
    const picture = await stage.picture(`cold-${mode}`);
    const status = await stage.rpc.send('status');
    expect(Number(status.shader_precompile_failed), String(status.last_shader_error ?? '')).toBe(0);
    expect(picture.coverage, mode).toBeGreaterThan(0.01);
    expect(picture.mean, mode).toBeGreaterThan(0.002);
    expect(picture.colours, mode).toBeGreaterThan(24);
    // A picture, not a white-out.
    expect(picture.blown, mode).toBeLessThan(0.2);
  }, 30000);

  itLive.each(['bodyswarm', 'bodyaura'])('%s follows the body across the frame', async (mode) => {
    stage = new Stage();
    await stage.start();
    // The rehearsal figure's hips sit at 0.5 + 0.17 sin(0.47 t).
    stage.holdTime = Math.PI * 1.5 / 0.47;
    await stage.install({ handfxMode: mode, handfxQuality: 'medium', handfxTrails: 0.2 });
    await stage.run(1.6);
    const left = await stage.picture(`${mode}-left`);
    stage.holdTime = Math.PI * 0.5 / 0.47;
    await stage.run(2.2);
    const right = await stage.picture(`${mode}-right`);
    expect(left.centreX, mode).toBeLessThan(0.42);
    expect(right.centreX, mode).toBeGreaterThan(0.58);
  }, 30000);

  itLive('bodyswarm sheds particles when the body moves', async () => {
    stage = new Stage();
    await stage.start();
    stage.holdTime = 2;
    await stage.install({ handfxMode: 'bodyswarm', handfxQuality: 'medium' });
    await stage.run(2);
    const still = await stage.picture('bodyswarm-still');
    stage.holdTime = null;
    await stage.run(2.5);
    const moving = await stage.picture('bodyswarm-moving');
    // A still body holds its particles close; a moving one throws them wide.
    expect(moving.coverage).toBeGreaterThan(still.coverage * 1.25);
  }, 30000);

  itLive('bodyflow lights up where the body stirs the field', async () => {
    stage = new Stage();
    await stage.start();
    stage.holdTime = 2;
    await stage.install({ handfxMode: 'bodyflow', handfxQuality: 'medium' });
    await stage.run(2.5);
    const still = await stage.picture('bodyflow-still');
    stage.holdTime = null;
    await stage.run(3);
    const moving = await stage.picture('bodyflow-moving');
    expect(still.coverage).toBeGreaterThan(0.3);
    expect(moving.mean).toBeGreaterThan(still.mean * 1.3);
  }, 30000);

  itLive('facemask follows the face and breaks apart when the expression jumps', async () => {
    stage = new Stage();
    await stage.start();
    // The rehearsal face sits at 0.5 + 0.07 sin(0.4 t).
    stage.holdTime = Math.PI * 1.5 / 0.4;
    await stage.install({ handfxMode: 'facemask', handfxQuality: 'medium', handfxTrails: 0.1 });
    await stage.run(2);
    const left = await stage.picture('facemask-left');
    stage.holdTime = Math.PI * 0.5 / 0.4;
    await stage.run(2);
    const right = await stage.picture('facemask-right');
    expect(right.centreX - left.centreX).toBeGreaterThan(0.08);
    // That jump was itself a sudden change, so let the mask settle first.
    await stage.run(1.5);
    const whole = await stage.picture('facemask-whole');
    // Mouth snaps open: sin(1.3 t) = 1.
    stage.holdTime = Math.PI * 0.5 / 1.3 + (Math.PI * 2 / 1.3) * 3;
    await stage.run(0.45);
    const broken = await stage.picture('facemask-broken');
    expect(broken.coverage).toBeGreaterThan(whole.coverage * 1.3);
    await stage.run(3.5);
    const reformed = await stage.picture('facemask-reformed');
    expect(reformed.coverage).toBeLessThan(broken.coverage * 0.85);
  }, 40000);

  itLive('facestream only breathes out while the mouth is open', async () => {
    stage = new Stage();
    await stage.start();
    // Mouth shut: sin(1.3 t) < 0.
    stage.holdTime = Math.PI * 1.5 / 1.3;
    await stage.install({ handfxMode: 'facestream', handfxQuality: 'medium' });
    await stage.run(2);
    const shut = await stage.picture('facestream-shut');
    stage.holdTime = Math.PI * 0.5 / 1.3;
    await stage.run(2.5);
    const open = await stage.picture('facestream-open');
    expect(shut.coverage).toBeGreaterThan(0.004);
    expect(open.coverage).toBeGreaterThan(shut.coverage * 1.6);
    expect(open.mean).toBeGreaterThan(shut.mean * 1.5);
  }, 30000);

  itLive.each([...HAND_FX_FIELD_MODES])('%s keeps running with nobody in view and recovers', async (mode) => {
    stage = new Stage();
    await stage.start();
    await stage.install({ handfxMode: mode, handfxQuality: 'medium', handfxInput: 'live' });
    await stage.run(1.5);
    const empty = await stage.picture(`empty-${mode}`);
    expect(Number.isFinite(empty.mean)).toBe(true);
    expect(empty.blown).toBeLessThan(0.05);
    // The performer walks in: same graph, same buffers, no reinstall.
    stage.params = { ...stage.params, handfxInput: 'demo' };
    await stage.run(2.5);
    const back = await stage.picture(`back-${mode}`);
    expect(back.coverage, mode).toBeGreaterThan(0.01);
    expect(back.coverage, mode).toBeGreaterThan(empty.coverage * (mode === 'bodyflow' ? 0.5 : 1.5));
    // And leaves again: the picture must not freeze.
    stage.params = { ...stage.params, handfxInput: 'live' };
    await stage.run(3.5);
    const gone = await stage.picture(`gone-${mode}`);
    expect(change(back, gone), mode).toBeGreaterThan(0.1);
    const status = await stage.rpc.send('status');
    expect(Number(status.shader_precompile_failed), String(status.last_shader_error ?? '')).toBe(0);
  }, 40000);

  itLive('switches between hand, body and face modes on one layer', async () => {
    stage = new Stage();
    await stage.start();
    for (const mode of ['bodyswarm', 'trails', 'facemask', 'bridge', 'bodyflow', 'skeleton', 'facestream', 'bodyaura']) {
      await stage.install({ handfxMode: mode, handfxQuality: 'low' });
      await stage.run(1.3);
      const picture = await stage.picture(`switch-${mode}`);
      expect(picture.coverage, mode).toBeGreaterThan(0.002);
    }
  }, 40000);

  itLive.each(['trails', 'aurora', 'bursts', 'skeleton', 'panel'])('still renders the %s hand mode', async (mode) => {
    stage = new Stage();
    await stage.start();
    if (mode === 'bursts') {
      // The rehearsal hands never pinch, and this mode only sprays from a pinch.
      const landmarks = Array.from({ length: 21 }, (_, index) => index === 0 ? { x: 0.5, y: 0.7, z: 0 }
        : index === 4 ? { x: 0.52, y: 0.45, z: 0 } : index === 8 ? { x: 0.53, y: 0.45, z: 0 } : { x: 0.5, y: 0.55, z: 0 });
      stage.hands = [{ handedness: 'Right', landmarks }];
    }
    await stage.install({ handfxMode: mode, handfxPalette: 'ocean', handfxInput: mode === 'bursts' ? 'live' : 'demo' });
    await stage.run(1.5);
    const picture = await stage.picture(`hand-${mode}`);
    expect(picture.coverage, mode).toBeGreaterThan(0.001);
    // Panel is a white card by design, and ink blobs are sized in pixels, so they flood this small test frame.
    if (mode !== 'panel' && mode !== 'aurora') expect(picture.blown, mode).toBeLessThan(0.2);
  }, 30000);

  // HANDFX_SHOTS=1 HANDFX_CAPTURE_DIR=<dir>: a few 1080p frames of each mode, a second apart, for review.
  itShots('captures review frames at 1920x1080', async () => {
    for (const mode of (process.env.HANDFX_SHOT_MODES ?? HAND_FX_FIELD_MODES.join(',')).split(',')) {
      stage = new Stage(1920, 1080);
      await stage.start();
      await stage.install({ handfxMode: mode, handfxQuality: process.env.HANDFX_SHOT_QUALITY ?? 'high', handfxPalette: process.env.HANDFX_SHOT_PALETTE ?? 'legacy' });
      await stage.run(3.2);
      for (let shot = 0; shot < 5; shot += 1) {
        await stage.picture(`shot-${mode}-${shot}`);
        await stage.run(0.8);
      }
      stage.rpc.close(); stage = null;
    }
  }, 300000);

  itBench('measures frame time at 1920x1080', async () => {
    const results: string[] = [];
    // The skeleton hand mode is the yardstick: one cheap pass, same output path.
    for (const mode of ['skeleton', ...HAND_FX_FIELD_MODES]) {
      for (const quality of mode === 'skeleton' ? ['none'] : (process.env.HANDFX_BENCH_QUALITIES ?? 'high').split(',')) {
        stage = new Stage(1920, 1080);
        await stage.start();
        await stage.install({ handfxMode: mode, handfxQuality: quality });
        await stage.run(3);
        // First the honest number: the core's own GPU time for whole frames
        // while the layer runs the way it does in the app.
        const first = await stage.rpc.send('status');
        const samples: number[] = [];
        const sampleStart = performance.now();
        for (let sample = 0; sample < 30; sample += 1) {
          await stage.run(0.05);
          samples.push(Number((await stage.rpc.send('status')).last_render_gpu_ms ?? 0));
        }
        const last = await stage.rpc.send('status');
        const fps = (Number(last.frames_presented) - Number(first.frames_presented)) / ((performance.now() - sampleStart) / 1000);
        samples.sort((a, b) => a - b);
        // Each compute_graph call runs the whole graph once. The snapshot at
        // the end waits for the GPU, so the total is real GPU time, not queue time.
        const frames = 240;
        const built = buildNativePluginGraph({ ...stage.options(), kind: 'handfx', reset: false });
        await stage.rpc.send('frame_snapshot', { include_pixels: false });
        const before = performance.now();
        const calls: Promise<any>[] = [];
        for (let frame = 0; frame < frames; frame += 1) calls.push(stage.rpc.send('compute_graph', built.config, 60000));
        await Promise.all(calls);
        await stage.rpc.send('frame_snapshot', { include_pixels: true }, 60000);
        const perFrame = (performance.now() - before) / frames;
        const status = await stage.rpc.send('status');
        const picture = await stage.picture(`bench-${mode}-${quality}`);
        if (process.env.HANDFX_STATUS_DUMP) writeFileSync(process.env.HANDFX_STATUS_DUMP, JSON.stringify(status, null, 1));
        results.push(`${mode} ${quality} particles=${HAND_FX_QUALITY_PARTICLES[quality] ?? 0} frame_gpu_ms median=${samples[15].toFixed(2)} worst=${samples[29].toFixed(2)} fps=${fps.toFixed(1)} source_frame=${status.source_frame_size} graph_only_ms=${perFrame.toFixed(2)} coverage=${picture.coverage.toFixed(3)}`);
        stage.rpc.close(); stage = null;
      }
    }
    console.log('[handfx-bench]\n' + results.join('\n'));
    if (process.env.HANDFX_CAPTURE_DIR) writeFileSync(join(process.env.HANDFX_CAPTURE_DIR, 'bench.txt'), results.join('\n') + '\n');
  }, 600000);
});
