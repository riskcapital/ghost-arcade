// Run after rebuilding the native core. A software fallback is a failure on
// macOS or Windows, as are NV12 decoder output or CPU uploads for Main10 input.
// Windows requires a hardware-capable HEVC decoder/codec extension installed.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';

const binary = platform.binary;
const hardwareDescribe = platform.runnable ? describe : describe.skip;
// Stay above the HEVC hardware decoder's minimum dimensions. On the RTX
// 4070/Windows MF path, 128x96 returns CPU-writable dynamic textures even
// with D3D-required output; 256x192 returns actual decoder-bound surfaces.
// Keep all strict GPU-only assertions below unchanged.
const WIDTH = 256;
const HEIGHT = 192;
const FRAMES = 12;
const FPS = 30;
// The two different rows make an upside-down shared texture fail the same color
// comparisons: top-left is black, while bottom-left is strongly blue.
const patches = [
  [0, 0, 0], [16, 16, 16], [64, 64, 64], [128, 128, 128],
  [192, 192, 192], [255, 255, 255], [224, 24, 24], [24, 224, 24],
  [24, 24, 224], [224, 224, 24], [224, 24, 224], [24, 224, 224],
  [48, 96, 176], [176, 96, 48], [4, 4, 4], [251, 251, 251],
];
const cases = [
  { label: 'limited', range: 'tv', fourcc: 'x420' },
  { label: 'full', range: 'pc', fourcc: 'xf20' },
] as const;
type Fixture = { uri: string; reference: Buffer };
type Command = Record<string, unknown>;
type Status = Record<string, any>;

function startCore() {
  const child = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware' },
  });
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
  const send = (method: string, params: Command = {}, timeoutMs = 15000): Promise<any> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, timeoutMs);
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

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, description: string): Promise<T> {
  const deadline = Date.now() + 15000;
  let value: T | undefined;
  do {
    value = await read();
    if (ready(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  throw new Error(`${description}: ${JSON.stringify(value)}`);
}

function sample(rgba: Uint8Array, width: number, height: number, patch: number): number[] {
  const x = Math.floor(((patch % 8) + 0.5) * width / 8);
  const y = Math.floor((Math.floor(patch / 8) + 0.5) * height / 2);
  const sum = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const offset = ((y + dy) * width + x + dx) * 4;
      for (let channel = 0; channel < 3; channel++) sum[channel] += rgba[offset + channel] / 9;
    }
  }
  return sum;
}

hardwareDescribe('Native P010 conversion for HEVC Main10 SDR', () => {
  let directory: string;
  const fixtures = new Map<string, Fixture>();

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'ghost-hardware-main10-'));
    const rgb48 = Buffer.alloc(WIDTH * HEIGHT * 6 * FRAMES);
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const rgb = patches[Math.floor(y / (HEIGHT / 2)) * 8 + Math.floor(x / (WIDTH / 8))];
          const offset = ((frame * HEIGHT + y) * WIDTH + x) * 6;
          rgb.forEach((channel, index) => rgb48.writeUInt16LE(channel * 257, offset + index * 2));
        }
      }
    }
    for (const entry of cases) {
      const uri = join(directory, `main10-bt709-${entry.label}.mp4`);
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb48le',
        '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', 'pipe:0',
        '-vf', `scale=in_range=pc:out_range=${entry.range}:out_color_matrix=bt709`,
        '-c:v', 'libx265', '-preset', 'ultrafast', '-profile:v', 'main10', '-pix_fmt', 'yuv420p10le',
        '-x265-params', `crf=10:log-level=error:pools=1:frame-threads=1:bframes=2:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=${entry.range === 'pc' ? 'full' : 'limited'}`,
        '-tag:v', 'hvc1', '-color_range', entry.range,
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-movflags', '+faststart', uri,
      ], { input: rgb48, timeout: 15000 });
      const probe = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_entries',
        'stream=codec_name,profile,pix_fmt,color_range,color_space:frame=color_transfer', '-of', 'json', uri,
      ], { encoding: 'utf8', timeout: 10000 }));
      expect(probe.streams[0].codec_name).toBe('hevc');
      expect(probe.streams[0].profile).toBe('Main 10');
      expect(probe.streams[0].pix_fmt).toBe('yuv420p10le');
      expect(probe.streams[0].color_range).toBe(entry.range);
      expect(probe.streams[0].color_space).toBe('bt709');
      expect(probe.frames[0].color_transfer).toBe('bt709');
      // This reference process is independent of native renderer telemetry and
      // cannot satisfy the hardware-only or zero-upload assertions below.
      const reference = execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-i', uri, '-frames:v', '1',
        '-vf', `scale=in_range=${entry.range}:out_range=pc:in_color_matrix=bt709`,
        '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
      ], { timeout: 10000, maxBuffer: WIDTH * HEIGHT * 4 * 2 });
      expect(reference.length).toBe(WIDTH * HEIGHT * 4);
      fixtures.set(entry.label, { uri, reference });
    }
  }, 45000);
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  it.each(cases)('renders $label range P010 with reference colors and no CPU pixel uploads', async entry => {
    const { uri, reference } = fixtures.get(entry.label)!;
    const rpc = startCore();
    try {
      const baseline: Status = await rpc.send('start', { config: {
        backend: platform.rendererBackend, width: WIDTH, height: HEIGHT, source_frame_size: 256,
        target_fps: 60, native_quality_policy: 'fixed',
      } });
      expect(baseline.backend_ready).toBe(true);
      expect(baseline.adapter_is_software).toBe(false);
      const playback = {
        uri, source_type: 'video', time_seconds: 0, decode_width: WIDTH, decode_height: HEIGHT,
        playback_rate: 1, loop_enabled: true, duration_seconds: FRAMES / FPS,
        trim_start: 0, trim_end: 1, seek_generation: 1, seq: 1,
      };
      await rpc.send('prefetch_media', { ...playback, source_id: 'library:main10' });
      await until<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(
        (session: Status) => session.source_id === 'library:main10' && session.state === 'prerolled'), 'Main10 preroll');
      const trigger = { type: 'set_media_source_playback', ...playback, source_id: 'main10', paused: false };
      await rpc.send('submit_commands', { commands: [
        { type: 'upsert_layer', layer_id: 'main10-layer', opacity: 1, z_index: 0, blend_mode: 'normal',
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 },
            bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        trigger,
        { type: 'bind_media_source', layer_id: 'main10-layer', source_id: 'main10', uri, source_type: 'video' },
        { ...trigger, paused: true },
      ] });
      const status: Status = await until<Status>(() => rpc.send('status'), next => next.native_video_hardware_frames > 0, 'P010 presentation');
      expect(status.native_video_sessions.find((session: Status) => session.source_id === 'main10')?.backend).toBe(platform.decoderBackend);
      expect(status.native_video_last_pixel_format, 'Main10 decoder output must retain ten-bit samples')
        .toBe(platform.windows ? 'P010' : entry.fourcc);
      expect(status.native_video_software_frames).toBe(0);
      expect(status.native_video_hardware_fallbacks).toBe(0);
      expect(status.source_frame_last_upload_transport).toBe(platform.uploadTransport);
      for (const counter of [
        'source_frame_input_bytes_uploaded', 'source_frame_cpu_fallback_uploads',
        'source_frame_file_uploads', 'source_frame_base64_uploads', 'source_frame_json_uploads',
      ]) {
        expect(typeof baseline[counter], `${counter} telemetry must exist`).toBe('number');
        expect(status[counter], `${counter}: Main10 must not upload CPU pixels`).toBe(baseline[counter]);
      }
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
      }, frame => sample(frame.rgba, frame.width, frame.height, 5)[0] > 200, 'presented Main10 snapshot');
      for (let patch = 0; patch < patches.length; patch++) {
        const actual = sample(picture.rgba, picture.width, picture.height, patch);
        const expected = sample(reference, WIDTH, HEIGHT, patch);
        for (let channel = 0; channel < 3; channel++) {
          expect(Math.abs(actual[channel] - expected[channel]), `${entry.label} patch ${patch} channel ${channel}`).toBeLessThan(8);
        }
      }
      expect(sample(picture.rgba, picture.width, picture.height, 0)[0]).toBeLessThan(4);
      expect(sample(picture.rgba, picture.width, picture.height, 5)[0]).toBeGreaterThan(251);
      expect(sample(picture.rgba, picture.width, picture.height, 8)[2]).toBeGreaterThan(200);
    } finally { await rpc.close(); }
  }, 30000);
});
