// Run after rebuilding the native core. Offline export (manual render clock)
// must be frame-accurate for video layers: export frame N shows the clip at
// N/fps from its launch point, identically on every run.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';

const runtimeDescribe = platform.runnable ? describe : describe.skip;
const WIDTH = 320;
const HEIGHT = 180;
const SOURCE_FPS = 60;
const EXPORT_FPS = 30;
const BITS = 10;
const EXPORT_FRAMES = 24;

type Status = Record<string, any>;

function startCore() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  let stderr = '';
  let stopped: Error | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    stopped = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`native core exited (${code ?? signal}): ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    try {
      const response = JSON.parse(line);
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.ok) request.resolve(response.result);
      else request.reject(new Error(`${response.error}: ${stderr}`));
    } catch (error) {
      fail(new Error(`invalid native core response: ${String(error)}: ${line}`));
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<any> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => { if (error) fail(error); });
    });
  };
  return {
    send,
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}

/** Read the binary frame counter burnt into the fixture (one column per bit). */
function decodeCounter(raw: Buffer, width: number, height: number): number {
  let value = 0;
  const y = Math.floor(height / 2);
  for (let bit = 0; bit < BITS; bit++) {
    const x = Math.floor((bit + 0.5) * width / BITS);
    const offset = (y * width + x) * 4;
    if (raw[offset + 1] > 128) value |= 1 << bit;
  }
  return value;
}

runtimeDescribe('Native manual-clock video export', () => {
  let directory: string;
  let uri: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'ghost-manual-clock-video-'));
    uri = join(directory, 'counter60.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `nullsrc=s=${WIDTH}x${HEIGHT}:r=${SOURCE_FPS}:d=4`,
      '-vf', `geq=lum='255*mod(floor(N/pow(2,floor(X/(W/${BITS})))),2)':cb=128:cr=128,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-g', '60', uri,
    ], { timeout: 30000 });
  }, 45000);
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  it('shows the clip frame for N/fps on every exported frame, identically across runs', async () => {
    const rpc = startCore();
    try {
      const started: Status = await rpc.send('start', { config: {
        backend: platform.rendererBackend, width: WIDTH, height: HEIGHT, source_frame_size: 512,
        target_fps: 60, native_quality_policy: 'fixed',
      } });
      expect(started.backend_ready).toBe(true);
      const playback = {
        type: 'set_media_source_playback', source_id: 'counter', uri, source_type: 'video',
        time_seconds: 0.5, clock_time_seconds: 0, playback_rate: 1, paused: false, loop_enabled: true,
        duration_seconds: 4, trim_start: 0, trim_end: 1, decode_width: WIDTH, decode_height: HEIGHT,
        seek_generation: 1, seq: 1,
      };
      await rpc.send('submit_commands', { commands: [
        { type: 'set_render_clock', mode: 'live', time: 7.25 },
        { type: 'upsert_layer', layer_id: 'counter-layer', opacity: 1, z_index: 0, blend_mode: 'normal',
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 },
            bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        playback,
        { type: 'bind_media_source', layer_id: 'counter-layer', source_id: 'counter', uri, source_type: 'video' },
      ] });
      // Let the live transport run so the export must re-anchor, not inherit.
      await new Promise(resolve => setTimeout(resolve, 400));

      const exportRun = async (run: number) => {
        const counters: number[] = [];
        for (let frame = 0; frame < EXPORT_FRAMES; frame++) {
          const time = frame / EXPORT_FPS;
          await rpc.send('submit_commands', { commands: [
            { type: 'set_render_clock', mode: 'manual', time, time_delta: 1 / EXPORT_FPS, frame_index: frame },
          ] });
          const path = join(directory, `run${run}_${frame}.raw`);
          const snapshot = await rpc.send('export_frame_snapshot', { path, time, frame_index: frame }, 20000);
          counters.push(decodeCounter(readFileSync(path), snapshot.width, snapshot.height));
        }
        await rpc.send('submit_commands', { commands: [{ type: 'set_render_clock', mode: 'live', time: 30 + run }] });
        return counters;
      };

      const expected = Array.from({ length: EXPORT_FRAMES }, (_, frame) => frame * SOURCE_FPS / EXPORT_FPS);
      const first = await exportRun(1);
      expect(first).toEqual(expected);
      await new Promise(resolve => setTimeout(resolve, 250));
      const second = await exportRun(2);
      expect(second).toEqual(expected);
    } finally { await rpc.close(); }
  }, 90000);
});
