// Run with a rebuilt native core on macOS or Windows. Alpha video must use the explicit
// compatibility decoder in auto mode and fail visibly in hardware-only mode.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';

const binary = platform.binary;
const nativeDescribe = platform.runnable ? describe : describe.skip;
const WIDTH = 96;
const HEIGHT = 64;
// Windows may reject the unsupported ProRes container/codec before exposing
// its alpha media type. macOS must retain the more specific alpha diagnosis.
const compatibilityReason = platform.windows
  ? /Open native video source reader|alpha.*preserve transparency|codec requires the compatibility decoder/i
  : /alpha.*preserve transparency/i;
type Command = Record<string, unknown>;
type Status = Record<string, any>;
const corners = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 },
  bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

function core(backend: 'auto' | 'hardware') {
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: backend } });
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
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch (error) { fail(new Error(`invalid native response: ${String(error)}: ${line}`)); }
  });
  const send = (method: string, params: Command = {}, timeoutMs = 15000): Promise<any> => {
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
  return { send, async close() {
    try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
    await closeNativeTestCore(child);
  } };
}

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 15000;
  let value: T | undefined;
  do {
    value = await read();
    if (ready(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}

function sample(rgba: Uint8Array, width: number, height: number, third: number): number[] {
  const x = Math.floor((third + 0.5) * width / 3);
  const y = Math.floor(height / 2);
  return Array.from(rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
}

nativeDescribe('Native video compatibility fallback preserves transparency', () => {
  let directory: string;
  let uri: string;
  let reference: Buffer;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'ghost-video-alpha-'));
    uri = join(directory, 'transparent-prores4444.mov');
    const raw = Buffer.alloc(WIDTH * HEIGHT * 4 * 15);
    for (let offset = 0; offset < raw.length; offset += 4) {
      const x = (offset / 4) % WIDTH;
      raw.set([220, 20, 30, [0, 128, 255][Math.floor(x / (WIDTH / 3))]], offset);
    }
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba',
      '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', '30', '-i', 'pipe:0',
      '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', uri,
    ], { input: raw, timeout: 15000 });
    const probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,pix_fmt',
      '-of', 'json', uri,
    ], { encoding: 'utf8', timeout: 10000 })).streams[0];
    expect(probe.codec_name).toBe('prores');
    expect(probe.profile).toContain('4444');
    expect(probe.pix_fmt).toMatch(/^yuva/);
    reference = execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', uri, '-frames:v', '1',
      '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
    ], { timeout: 10000, maxBuffer: WIDTH * HEIGHT * 4 * 2 });
    expect(reference.length).toBe(WIDTH * HEIGHT * 4);
    expect(sample(reference, WIDTH, HEIGHT, 0)[3]).toBeLessThan(3);
    expect(sample(reference, WIDTH, HEIGHT, 1)[3]).toBeGreaterThan(124);
    expect(sample(reference, WIDTH, HEIGHT, 1)[3]).toBeLessThan(132);
    expect(sample(reference, WIDTH, HEIGHT, 2)[3]).toBeGreaterThan(252);
  }, 30000);
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  const playback = (source_id: string) => ({ source_id, uri, source_type: 'video', time_seconds: 0,
    decode_width: WIDTH, decode_height: HEIGHT, playback_rate: 1, loop_enabled: true,
    duration_seconds: 0.5, trim_start: 0, trim_end: 1, seek_generation: 1, seq: 1 });
  const scene = (paused: boolean): Command[] => [
    // Higher z is underneath. The red source must reveal this green through
    // its transparent area and mix with it through its half-alpha area.
    { type: 'upsert_layer', layer_id: 'backdrop', opacity: 1, z_index: 1, blend_mode: 'normal', corners },
    { type: 'set_layer_color', layer_id: 'backdrop', rgba: [0, 1, 0, 1] },
    { type: 'upsert_layer', layer_id: 'alpha-layer', opacity: 1, z_index: 0, blend_mode: 'normal', corners },
    { type: 'set_media_source_playback', ...playback('alpha'), paused: false },
    { type: 'bind_media_source', layer_id: 'alpha-layer', source_id: 'alpha', uri, source_type: 'video' },
    ...(paused ? [{ type: 'set_media_source_playback', ...playback('alpha'), paused: true }] : []),
  ];
  const start = (rpc: ReturnType<typeof core>) => rpc.send('start', { config: {
    backend: platform.rendererBackend, width: WIDTH, height: HEIGHT, source_frame_size: 128, target_fps: 60,
    native_quality_policy: 'fixed',
  } });

  it('reports one FFmpeg fallback and composites transparent, half-alpha and opaque pixels correctly', async () => {
    const rpc = core('auto');
    try {
      await start(rpc);
      await rpc.send('prefetch_media', playback('library:alpha'));
      await until<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(
        (session: Status) => session.source_id === 'library:alpha' && session.state === 'prerolled'), 'alpha preroll');
      await rpc.send('submit_commands', { commands: scene(true) });
      const status = await until<Status>(() => rpc.send('status'), next => next.native_video_software_frames > 0, 'alpha compatibility presentation');
      const session = status.native_video_sessions.find((entry: Status) => entry.source_id === 'alpha');
      expect(session?.backend).toBe('ffmpeg');
      expect(session?.fallback_reason).toMatch(compatibilityReason);
      expect(session?.frames_presented).toBeGreaterThan(0);
      expect(status.native_video_hardware_fallbacks).toBe(1);
      expect(status.native_video_hardware_frames).toBe(0);
      const picture = await until(async () => {
        const snapshot = await rpc.send('output_shared_texture_snapshot', { include_pixels: true });
        expect(snapshot.includes_pixels).toBe(true);
        const rgba = Buffer.from(snapshot.rgba_b64, 'base64');
        expect(rgba.length).toBe(snapshot.width * snapshot.height * 4);
        if (snapshot.format.toLowerCase().startsWith('bgra')) {
          for (let offset = 0; offset < rgba.length; offset += 4) {
            [rgba[offset], rgba[offset + 2]] = [rgba[offset + 2], rgba[offset]];
          }
        }
        return { rgba, width: snapshot.width, height: snapshot.height };
      }, frame => sample(frame.rgba, frame.width, frame.height, 2)[0] > 150, 'alpha output snapshot');
      // Read the backdrop from the fully transparent region. Plain color
      // layers have their own fill strength; the alpha test should use the
      // actual presented background, without depending on that UI setting.
      const backdrop = sample(picture.rgba, picture.width, picture.height, 0).slice(0, 3);
      expect(backdrop[0]).toBeLessThan(4);
      expect(backdrop[1]).toBeGreaterThan(120);
      expect(backdrop[2]).toBeLessThan(4);
      for (let third = 0; third < 3; third++) {
        const decoded = sample(reference, WIDTH, HEIGHT, third);
        const alpha = decoded[3] / 255;
        const expected = decoded.slice(0, 3).map((value, channel) => value * alpha + backdrop[channel] * (1 - alpha));
        const actual = sample(picture.rgba, picture.width, picture.height, third);
        for (let channel = 0; channel < 3; channel++) {
          expect(Math.abs(actual[channel] - expected[channel]), `alpha region ${third}, channel ${channel}`).toBeLessThan(8);
        }
      }
    } finally { await rpc.close(); }
  }, 25000);

  it('rejects alpha video in hardware-only mode with a clear error and zero software frames', async () => {
    const rpc = core('hardware');
    try {
      const baseline = await start(rpc);
      await rpc.send('submit_commands', { commands: scene(false) });
      const status = await until<Status>(() => rpc.send('status'), next => next.native_video_frame_decode_failures > 0, 'strict hardware rejection');
      expect(status.native_video_frame_decode_last_error).toMatch(compatibilityReason);
      const session = status.native_video_sessions.find((entry: Status) => entry.source_id === 'alpha');
      expect(session?.backend).toBe('failed');
      expect(session?.fallback_reason).toMatch(compatibilityReason);
      expect(session?.frames_presented).toBe(0);
      expect(status.native_video_hardware_frames).toBe(0);
      expect(status.native_video_software_frames).toBe(0);
      expect(status.native_video_hardware_fallbacks).toBe(0);
      expect(status.source_frame_input_bytes_uploaded).toBe(baseline.source_frame_input_bytes_uploaded);
      expect(status.source_frame_cpu_fallback_uploads).toBe(baseline.source_frame_cpu_fallback_uploads);
    } finally { await rpc.close(); }
  }, 20000);
});
