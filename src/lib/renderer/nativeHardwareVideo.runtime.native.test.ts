// Run after rebuilding the native core:
// npx vitest run --config vitest.native.config.ts src/lib/renderer/nativeHardwareVideo.runtime.native.test.ts
// Run on a macOS or Windows host with a real GPU and FFmpeg on PATH.
// A missing hardware decoder or silent software fallback fails on either
// supported platform with a built core; other platforms or missing builds skip.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
const scrubBridge = vi.hoisted(() => ({ status: vi.fn(), submit: vi.fn(), toast: vi.fn() }));
vi.mock('../api/native-renderer', () => ({
  getNativeRendererStatus: scrubBridge.status, submitNativeRendererCommands: scrubBridge.submit,
}));
vi.mock('../stores/errorToast', () => ({ showToast: scrubBridge.toast }));
import { createNativeVideoScrubber } from './nativeVideoScrubber';

const binary = platform.binary;
const hardwareDescribe = platform.runnable ? describe : describe.skip;
const WIDTH = 128;
const HEIGHT = 96;
const FPS = 30;
const FRAME_COUNT = 60;
const DURATION = FRAME_COUNT / FPS;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Command = Record<string, unknown>;
type Session = { source_id: string; state: string; backend: string; frames_presented: number; seek_generation?: number; source_time_seconds?: number; source_frame_step_exact?: boolean; scrub_cache_hits?: number };
type Status = Record<string, any> & { native_video_sessions: Session[] };
type Snapshot = {
  width: number; height: number; format: string; rgba_b64: string;
  includes_pixels: boolean; export_frame: number;
};
type Picture = { width: number; height: number; rgba: Uint8Array; exportFrame: number };
type Region = { x: number; y: number; width: number; height: number };

function core() {
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
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
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
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (error) fail(error);
      });
    });
  };
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}
type Core = ReturnType<typeof core>;

async function waitUntil<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value: T | undefined;
  do {
    value = await read();
    if (ready(value)) return value;
    await sleep(10);
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${JSON.stringify(value, (key, item) => key === 'rgba' ? '[pixel buffer]' : item)}`);
}

async function start(rpc: Core, width = WIDTH, height = HEIGHT): Promise<Status> {
  const status = await rpc.send('start', { config: {
    backend: platform.rendererBackend, width, height, source_frame_size: 256, target_fps: 60,
    native_quality_policy: 'fixed', decode_handoff_byte_cap_mb: 256,
  } });
  expect(status.backend_ready).toBe(true);
  expect(status.adapter_is_software).toBe(false);
  return status;
}

const full: Region = { x: 0, y: 0, width: 1, height: 1 };
function layer(layerId = 'video-layer', region = full): Command {
  const { x, y, width, height } = region;
  return { type: 'upsert_layer', layer_id: layerId, opacity: 1, z_index: 0, blend_mode: 'normal',
    corners: {
      topLeft: { x, y: 1 - y }, topRight: { x: x + width, y: 1 - y },
      bottomRight: { x: x + width, y: 1 - y - height }, bottomLeft: { x, y: 1 - y - height },
    } };
}

function picture(snapshot: Snapshot): Picture {
  expect(snapshot.includes_pixels).toBe(true);
  const rgba = Buffer.from(snapshot.rgba_b64, 'base64');
  expect(rgba.length).toBe(snapshot.width * snapshot.height * 4);
  // Diagnostic readback returns the texture's storage bytes, even though the
  // transport field is named rgba_b64. Shared output surfaces can be BGRA.
  if (snapshot.format.toLowerCase().startsWith('bgra')) {
    for (let offset = 0; offset < rgba.length; offset += 4) {
      [rgba[offset], rgba[offset + 2]] = [rgba[offset + 2], rgba[offset]];
    }
  }
  return { width: snapshot.width, height: snapshot.height, rgba, exportFrame: snapshot.export_frame };
}

async function presented(rpc: Core): Promise<Picture> {
  return picture(await rpc.send('output_shared_texture_snapshot', { include_pixels: true }));
}

function sample(frame: Picture, x: number, y: number, region = full): number[] {
  const px = Math.floor((region.x + x / WIDTH * region.width) * frame.width);
  const py = Math.floor((region.y + y / HEIGHT * region.height) * frame.height);
  const sum = [0, 0, 0];
  // Sample within flat patches, away from chroma subsampling/scale boundaries.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const offset = ((py + dy) * frame.width + px + dx) * 4;
      for (let channel = 0; channel < 3; channel++) sum[channel] += frame.rgba[offset + channel] / 9;
    }
  }
  return sum;
}

function frameNumber(frame: Picture, region = full): number {
  let code = 0;
  for (let bit = 0; bit < 8; bit++) {
    const top = sample(frame, 8 + 16 * bit, 12, region)[0];
    const bottom = sample(frame, 8 + 16 * bit, 84, region)[0];
    // Mirrored markers also detect an incomplete copy or incorrectly cropped
    // source rectangle. Code zero is reserved for an unrendered/black frame.
    if ((top > 128) !== (bottom > 128)) return -1;
    if (top > 128) code |= 1 << bit;
  }
  return code > 0 && code <= FRAME_COUNT ? code - 1 : -1;
}

function assertHardware(status: Status, baseline: Status, sourceIds: string[]) {
  for (const sourceId of sourceIds) {
    const session = status.native_video_sessions.find(entry => entry.source_id === sourceId);
    expect(session, `missing ${sourceId}: ${JSON.stringify(status.native_video_sessions)}`).toBeDefined();
    expect(session?.backend, `hardware required for ${sourceId}`).toBe(platform.decoderBackend);
    expect(session?.frames_presented).toBeGreaterThan(0);
  }
  expect(status.native_video_hardware_frames).toBeGreaterThan(0);
  expect(status.native_video_software_frames).toBe(0);
  expect(status.native_video_hardware_fallbacks).toBe(0);
  expect(status.source_frame_last_upload_transport).toBe(platform.uploadTransport);
  for (const counter of [
    'source_frame_input_bytes_uploaded', 'source_frame_cpu_fallback_uploads',
    'source_frame_file_uploads', 'source_frame_base64_uploads', 'source_frame_json_uploads',
  ]) {
    expect(typeof baseline[counter], `${counter} telemetry must exist`).toBe('number');
    expect(status[counter], `${counter}: video must not upload CPU pixels`).toBe(baseline[counter]);
  }
}

hardwareDescribe(`${platform.label} playback through the presented shared texture`, () => {
  let directory: string;
  let uri: string;
  let vfrUri: string;
  let vfrTimes: number[];
  let vfrDuration: number;
  let reference: Buffer;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'ghost-hardware-video-'));
    uri = join(directory, 'numbered-bframes-bt709.mp4');
    const patches = [
      [0, 0, 0], [64, 64, 64], [128, 128, 128], [255, 255, 255],
      [224, 24, 24], [24, 224, 24], [24, 24, 224], [224, 224, 24],
    ];
    const raw = Buffer.alloc(WIDTH * HEIGHT * 3 * FRAME_COUNT);
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const cell = Math.floor(x / 16);
          const bit = ((frame + 1) >> cell) & 1;
          const rgb = y < 24 || y >= 72 ? [bit ? 240 : 16, bit ? 240 : 16, bit ? 240 : 16] : patches[cell];
          const offset = ((frame * HEIGHT + y) * WIDTH + x) * 3;
          raw.set(rgb, offset);
        }
      }
    }
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
      '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', 'pipe:0',
      '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '10', '-pix_fmt', 'yuv420p',
      '-g', '120', '-bf', '3', '-x264-params', 'b-adapt=0:scenecut=0',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-movflags', '+faststart', uri,
    ], { input: raw, timeout: 15000 });
    const probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pict_type', '-of', 'json', uri,
    ], { encoding: 'utf8', timeout: 10000 }));
    expect(probe.frames.some((frame: { pict_type: string }) => frame.pict_type === 'B')).toBe(true);
    vfrUri = join(directory, 'numbered-vfr.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', uri,
      '-vf', "settb=1/90000,setpts='(floor(N/3)*7+mod(N,3)*mod(N,3))*3000'",
      '-fps_mode', 'vfr', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p',
      '-g', '120', '-bf', '3', '-video_track_timescale', '90000', vfrUri,
    ], { timeout: 15000 });
    const vfrProbe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'frame=best_effort_timestamp_time:stream=duration', '-of', 'json', vfrUri,
    ], { encoding: 'utf8', timeout: 10000 }));
    vfrTimes = vfrProbe.frames.map((frame: { best_effort_timestamp_time: string }) => Number(frame.best_effort_timestamp_time));
    vfrDuration = Number(vfrProbe.streams[0].duration);
    expect(vfrTimes).toHaveLength(FRAME_COUNT);
    expect(new Set(vfrTimes.slice(1).map((time, index) => Math.round((time - vfrTimes[index]) * 1000))).size).toBeGreaterThan(1);
    // Decode the fixture once as an independent color reference. This does
    // not run in the renderer process and cannot satisfy hardware telemetry.
    reference = execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', uri, '-frames:v', '1',
      '-vf', 'scale=in_range=tv:out_range=pc:in_color_matrix=bt709',
      '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
    ], { timeout: 10000, maxBuffer: WIDTH * HEIGHT * 4 * 2 });
    expect(reference.length).toBe(WIDTH * HEIGHT * 4);
  }, 30000);
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  const playback = (sourceId: string, overrides: Command = {}): Command => ({
    source_id: sourceId, uri, source_type: 'video', time_seconds: 0,
    // Exercise the hardware path's source dimensions and GPU atlas fitting:
    // the encoded source is 128x96, not these requested decode dimensions.
    decode_width: 1024, decode_height: 768, playback_rate: 1, loop_enabled: true,
    duration_seconds: DURATION, trim_start: 0, trim_end: 1, seek_generation: 1, seq: 1,
    ...overrides,
  });
  const bind = (sourceId: string, layerId = 'video-layer'): Command => ({
    type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri, source_type: 'video',
  });
  const arm = async (rpc: Core, sourceId: string, overrides: Command = {}) => {
    await rpc.send('prefetch_media', playback(sourceId, overrides));
    const status = await waitUntil<Status>(() => rpc.send('status'), next => next.native_video_sessions.some(
      session => session.source_id === sourceId && session.state === 'prerolled'), `hardware preroll ${sourceId}`);
    expect(status.native_video_sessions.find(session => session.source_id === sourceId)?.backend).toBe(platform.decoderBackend);
  };
  const trigger = (sourceId: string, overrides: Command = {}): Command => ({
    type: 'set_media_source_playback', ...playback(sourceId, overrides), paused: false,
  });
  const freezeWarmFrame = async (rpc: Core, sourceId: string, overrides: Command = {}) => {
    await arm(rpc, `library:${sourceId}:${overrides.seek_generation ?? 1}`, overrides);
    await rpc.commands([
      layer(), trigger(sourceId, overrides), bind(sourceId),
      { ...trigger(sourceId, overrides), paused: true },
    ]);
  };

  it.skipIf(!platform.windows)('keeps both Windows deck monitors moving when deck B has zero program opacity', async () => {
    const addon = createRequire(import.meta.url)(join(process.cwd(), 'electron/native/build/Release/dxgi_preview_addon.node'));
    const rpc = core();
    try {
      const baseline = await start(rpc);
      await rpc.commands(['a', 'b'].flatMap(bank => [
        { ...layer(`deck-${bank}`), opacity: bank === 'a' ? 1 : 0, deck_monitor_bank: bank, deck_monitor_opacity: 1 },
        trigger(`source-${bank}`), bind(`source-${bank}`, `deck-${bank}`),
      ]));
      const state = await waitUntil(() => rpc.send('deck_monitor_state'), s => s.available && s.banks.every((b: any) => b.frame > 0), 'deck exports');
      expect(state.platform).toBe('dxgi');
      expect(state.banks[0].shared_name).not.toBe(state.banks[1].shared_name);
      for (const bank of ['a', 'b']) {
        const numbers = new Set<number>();
        for (let attempt = 0; attempt < 80 && numbers.size < 4; attempt++) {
          const metadata = (await rpc.send('deck_monitor_state')).banks.find((b: any) => b.bank === bank);
          const pixels = addon.readSharedTexturePixels(metadata.shared_name, metadata.frame);
          if (pixels) {
            const rgba = Buffer.from(pixels.data);
            for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
            const number = frameNumber({ width: pixels.width, height: pixels.height, rgba, exportFrame: pixels.frame });
            if (number >= 0) numbers.add(number);
          }
          await sleep(25);
        }
        expect(numbers.size, `deck ${bank} must show changing decoded frames`).toBeGreaterThanOrEqual(4);
      }
      assertHardware(await rpc.send('status'), baseline, ['source-a', 'source-b']);
    } finally { addon.releaseReadback(); await rpc.close(); }
  }, 30000);

  it('presents the first B-frame clip picture with correct BT.709 limited-range NV12 conversion', async () => {
    const rpc = core();
    try {
      const baseline = await start(rpc);
      await freezeWarmFrame(rpc, 'color');
      const first = await waitUntil(() => presented(rpc), frame => frameNumber(frame) >= 0, 'first hardware picture');
      expect(frameNumber(first)).toBe(0);
      const expected: Picture = { width: WIDTH, height: HEIGHT, rgba: reference, exportFrame: 0 };
      for (let patch = 0; patch < 8; patch++) {
        const actualRgb = sample(first, 8 + patch * 16, 48);
        const expectedRgb = sample(expected, 8 + patch * 16, 48);
        for (let channel = 0; channel < 3; channel++) {
          expect(Math.abs(actualRgb[channel] - expectedRgb[channel]), `patch ${patch} channel ${channel}`).toBeLessThan(12);
        }
      }
      expect(sample(first, 8, 48)[0]).toBeLessThan(8);
      expect(sample(first, 56, 48)[0]).toBeGreaterThan(247);
      assertHardware(await rpc.send('status'), baseline, ['color']);
    } finally { await rpc.close(); }
  });

  it('seeks and retriggers at the requested numbered frame instead of reusing a stale picture', async () => {
    const rpc = core();
    try {
      const baseline = await start(rpc);
      for (const [index, target] of [0, 39, 15, 51, 0].entries()) {
        await freezeWarmFrame(rpc, 'seek', {
          time_seconds: target / FPS, seek_generation: index + 1, seq: index + 1,
        });
        const frame = await waitUntil(() => presented(rpc), next => frameNumber(next) === target,
          `seek generation ${index + 1} should present frame ${target}`);
        expect(frameNumber(frame)).toBe(target);
        assertHardware(await rpc.send('status'), baseline, ['seek']);
      }
    } finally { await rpc.close(); }
  });

  it('steps adjacent B-frames in both directions while paused and clamps to trim edges', async () => {
    const rpc = core();
    try {
      const baseline = await start(rpc);
      const settings = { time_seconds: 15 / FPS, trim_start: 15 / FRAME_COUNT, trim_end: 20 / FRAME_COUNT };
      await freezeWarmFrame(rpc, 'step', settings);
      await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 15, 'step start');
      let generation = 1;
      for (const [direction, target] of [[-1, 15], [1, 16], [1, 17], [-1, 16], [-1, 15], [1, 16], [1, 17], [1, 18], [1, 19], [1, 19]]) {
        await rpc.commands([{ ...trigger('step', settings), paused: true, frame_step: direction, seek_generation: ++generation }]);
        await waitUntil<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(session =>
          session.source_id === 'step' && session.seek_generation === generation && session.frames_presented > 0), 'stepped generation');
        const picture = await waitUntil(async () => {
          const frame = await presented(rpc);
          return { ...frame, number: frameNumber(frame), session: (await rpc.send('status')).native_video_sessions.find((item: Session) => item.source_id === 'step') };
        }, frame => frameNumber(frame) === target, `adjacent frame ${target}, direction ${direction}, generation ${generation}`);
        expect(frameNumber(picture)).toBe(target);
        const status: Status = await rpc.send('status');
        const session = status.native_video_sessions.find(item => item.source_id === 'step')!;
        expect(session.source_frame_step_exact).toBe(true);
        expect(session.source_time_seconds).toBeCloseTo(target / FPS, 6);
        assertHardware(status, baseline, ['step']);
      }
    } finally { await rpc.close(); }
  });

  it('keeps the last rapid paused scrub target and uses the existing hardware session', async () => {
    const rpc = core();
    try {
      const baseline = await start(rpc);
      await freezeWarmFrame(rpc, 'drag');
      await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 0, 'scrub start');
      const targets = [39, 4, 51, 8, 27, 12, 43, 29];
      await rpc.commands(targets.map((target, index) => ({
        ...trigger('drag', { time_seconds: target / FPS, seek_generation: index + 2 }), paused: true,
      })));
      await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 29, 'final scrub frame');
      const status: Status = await rpc.send('status');
      expect(status.native_video_sessions.find(session => session.source_id === 'drag')?.source_time_seconds).toBeCloseTo(29 / FPS, 6);
      expect(status.video_oneshot_decodes_during_playback).toBe(baseline.video_oneshot_decodes_during_playback);
      assertHardware(status, baseline, ['drag']);
    } finally { await rpc.close(); }
  });

  it('steps actual adjacent variable-rate frames and resumes with the following picture', async () => {
    const rpc = core();
    try {
      const baseline = await start(rpc);
      const settings = { uri: vfrUri, duration_seconds: vfrDuration, time_seconds: vfrTimes[15] };
      await arm(rpc, 'library:vfr', settings);
      await rpc.commands([
        layer(), { ...trigger('vfr', settings), paused: true }, { ...bind('vfr'), uri: vfrUri },
      ]);
      await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 15, 'VFR start');
      let generation = 1;
      for (const [direction, target] of [[1, 16], [1, 17], [1, 18], [-1, 17], [-1, 16]]) {
        await rpc.commands([{ ...trigger('vfr', settings), paused: true, frame_step: direction, seek_generation: ++generation }]);
        await waitUntil<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(session =>
          session.source_id === 'vfr' && session.seek_generation === generation && session.frames_presented > 0), 'VFR step confirmation');
        await waitUntil(() => presented(rpc), frame => frameNumber(frame) === target, `VFR adjacent frame ${target}`);
        const status: Status = await rpc.send('status');
        expect(status.native_video_sessions.find(session => session.source_id === 'vfr')?.source_time_seconds).toBeCloseTo(vfrTimes[target], 5);
        assertHardware(status, baseline, ['vfr']);
      }
      await rpc.commands([{ ...trigger('vfr', { ...settings, time_seconds: vfrTimes[16], seek_generation: generation }), paused: false }]);
      await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 17, 'VFR successor on resume');
    } finally { await rpc.close(); }
  });

  it('keeps showing new pictures during continuous forward and reverse scratching, then holds the final frame', async () => {
    const rpc = core();
    const scrubber = createNativeVideoScrubber();
    const callbacks = new Set<ReturnType<typeof setTimeout>>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const handle = setTimeout(() => { callbacks.delete(handle); callback(performance.now()); }, 16);
      callbacks.add(handle);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => {
      clearTimeout(handle); callbacks.delete(handle);
    });
    scrubBridge.status.mockImplementation(() => rpc.send('status'));
    scrubBridge.submit.mockImplementation(commands => rpc.commands(commands));
    scrubBridge.toast.mockClear();
    try {
      const baseline = await start(rpc);
      await freezeWarmFrame(rpc, 'scratch', { time_seconds: 4 / FPS });
      await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 4, 'scratch start');
      const source = { id: 'scratch', src: uri, durationSeconds: DURATION,
        isPlaying: false, playbackMode: 'loop', _nativePlaybackSeekSeq: 1 };
      const commit = (update: object) => { Object.assign(source, update); };
      const observed: number[][] = [];
      for (const direction of [1, -1]) {
        const pictures: number[] = [];
        for (let tick = 0; tick < 50; tick++) {
          const target = direction > 0 ? 4 + tick : 53 - tick;
          scrubber.seek(source, target / FPS, commit);
          await sleep(16);
          pictures.push(frameNumber(await presented(rpc)));
        }
        observed.push(pictures);
      }
      // Count pictures seen while the input was still moving, not only the
      // result after mouseup. Assert both directions reach live output.
      expect(new Set(observed[0].filter(frame => frame >= 0)).size).toBeGreaterThan(8);
      expect(new Set(observed[1].filter(frame => frame >= 0)).size).toBeGreaterThan(8);
      expect(observed[0].some((frame, index) => index > 0 && frame > observed[0][index - 1])).toBe(true);
      expect(observed[1].some((frame, index) => index > 0 && frame >= 0 && frame < observed[1][index - 1])).toBe(true);
      scrubber.seek(source, 23 / FPS, commit, { flush: true });
      await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 23, 'scratch final picture');
      await sleep(100);
      expect(frameNumber(await presented(rpc))).toBe(23);
      const status: Status = await rpc.send('status');
      expect(status.native_video_sessions.find(session => session.source_id === 'scratch')?.scrub_cache_hits).toBeGreaterThan(0);
      expect(status.video_oneshot_decodes_during_playback).toBe(baseline.video_oneshot_decodes_during_playback);
      assertHardware(status, baseline, ['scratch']);
      expect(scrubBridge.toast).not.toHaveBeenCalled();
      scrubber.cancel();
      await rpc.commands([{ ...trigger('scratch', { time_seconds: 23 / FPS,
        seek_generation: source._nativePlaybackSeekSeq }), paused: false }]);
      await waitUntil(() => presented(rpc), frame => frameNumber(frame) > 23 && frameNumber(frame) < 35,
        'resume advances from the held cached picture');
      await waitUntil<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(session =>
        session.source_id === 'scratch' && Number((session as any).optional_cache_bytes) === 0),
      'resume returns the extra scratch reservation');
    } finally {
      scrubber.cancel();
      for (const handle of callbacks) clearTimeout(handle);
      vi.unstubAllGlobals();
      await rpc.close();
    }
  });

  it('holds a paused picture through repeated unchanged commands and resumes from that position', async () => {
    const rpc = core();
    try {
      const baseline = await start(rpc);
      const settings = { time_seconds: 15 / FPS, playback_rate: 0.5 };
      await freezeWarmFrame(rpc, 'pause', settings);
      let held = await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 15, 'paused seek picture');
      const pausedStatus: Status = await rpc.send('status');
      const pausedFrames = pausedStatus.native_video_sessions.find(session => session.source_id === 'pause')?.frames_presented;
      for (let repeat = 0; repeat < 3; repeat++) {
        await rpc.commands([{ ...trigger('pause', settings), paused: true }]);
        const previousExportFrame = held.exportFrame;
        held = await waitUntil(() => presented(rpc), frame => frame.exportFrame >= previousExportFrame + 2,
          'renderer advances while media remains paused');
        expect(frameNumber(held)).toBe(15);
        const status: Status = await rpc.send('status');
        expect(status.native_video_sessions.find(session => session.source_id === 'pause')?.frames_presented).toBe(pausedFrames);
      }
      await rpc.commands([trigger('pause', settings)]);
      const advanced = await waitUntil(() => presented(rpc), frame => frameNumber(frame) >= 19, 'resumed media advances');
      expect(frameNumber(advanced), 'resume continues from the held position').toBeLessThan(30);
      assertHardware(await rpc.send('status'), baseline, ['pause']);
    } finally { await rpc.close(); }
  });

  // This is deliberately visible as a skip on macOS. It specifically exercises
  // D3D11 decoder/processor -> shared DXGI -> D3D12 resource ownership.
  it.runIf(platform.windows)('keeps a held DXGI texture immutable while three decoder queues continue advancing', async () => {
    const rpc = core();
    try {
      const baseline = await start(rpc, WIDTH * 2, HEIGHT * 2);
      const ids = ['held-dxgi', 'moving-dxgi-1', 'moving-dxgi-2', 'moving-dxgi-3'];
      const regions = ids.map((_, index): Region => ({
        x: index % 2 / 2, y: Math.floor(index / 2) / 2, width: 0.5, height: 0.5,
      }));
      for (let index = 0; index < ids.length; index++) await arm(rpc, `library:dxgi:${index}`);
      await rpc.commands(ids.flatMap((sourceId, index) => [
        layer(`dxgi-row-${index}`, regions[index]), trigger(sourceId), bind(sourceId, `dxgi-row-${index}`),
        ...(index === 0 ? [{ ...trigger(sourceId), paused: true }] : []),
      ]));
      await waitUntil(() => presented(rpc), frame => frameNumber(frame, regions[0]) === 0, 'held DXGI first frame');
      await waitUntil<Status>(() => rpc.send('status'), status => ids.slice(1).every(sourceId =>
        (status.native_video_sessions.find(session => session.source_id === sourceId)?.frames_presented ?? 0) >= 20),
      'other DXGI producer queues advance beyond their opening cache');
      expect(frameNumber(await presented(rpc), regions[0]), 'producer reuse must not overwrite a presented texture').toBe(0);
      const status: Status = await rpc.send('status');
      expect(status.native_video_sessions.find(session => session.source_id === ids[0])?.frames_presented).toBe(1);
      assertHardware(status, baseline, ids);
    } finally { await rpc.close(); }
  }, 25000);

  it.each([
    { name: 'full clip', startFrame: 0, endFrame: FRAME_COUNT, rate: 1 },
    { name: 'clip with stale host duration', startFrame: 0, endFrame: FRAME_COUNT, rate: 1, reportedDuration: DURATION * 3 },
    { name: 'trimmed half-speed clip', startFrame: 15, endFrame: 45, rate: 0.5 },
    { name: 'trimmed double-speed clip', startFrame: 15, endFrame: 45, rate: 2 },
  ])('keeps presentation order across two loops of the $name', async ({ startFrame, endFrame, rate, reportedDuration }) => {
    const rpc = core();
    try {
      const baseline = await start(rpc);
      const settings = { duration_seconds: reportedDuration ?? DURATION, time_seconds: startFrame / FPS, trim_start: startFrame / FRAME_COUNT,
        trim_end: endFrame / FRAME_COUNT, playback_rate: rate };
      await arm(rpc, 'library:loop:g1', settings);
      await rpc.commands([layer(), trigger('loop', settings), bind('loop')]);
      let previous = -1;
      let seams = 0;
      const seen = new Set<number>();
      // A generous failure deadline is only a hang guard. Assertions concern
      // numbered media frames, not machine-dependent startup/frame timings.
      await waitUntil(async () => {
        const frame = await presented(rpc);
        const number = frameNumber(frame);
        if (number < 0 && previous < 0) return seams;
        expect(number, 'presented frame must remain within the trim').toBeGreaterThanOrEqual(startFrame);
        expect(number, 'trim end is exclusive').toBeLessThan(endFrame);
        if (previous >= 0 && number < previous) {
          expect(previous, 'only the loop seam may go backwards').toBeGreaterThanOrEqual(endFrame - 5);
          expect(number, 'loop must restart at the trim in-point').toBeLessThan(startFrame + 5);
          seams++;
        }
        previous = number;
        seen.add(number);
        return seams;
      }, count => count >= 2, 'two ordered hardware loop seams', 20000);
      expect(seen.size).toBeGreaterThan((endFrame - startFrame) / 3);
      assertHardware(await rpc.send('status'), baseline, ['loop']);
    } finally { await rpc.close(); }
  }, 25000);

  it.each([
    { name: 'forward', direction: 1, bounce: false },
    { name: 'reverse', direction: -1, bounce: false },
    { name: 'bounce', direction: 1, bounce: true },
  ])('smoothly phase-locks $name playback and expires stale corrections', async ({ direction, bounce }) => {
    const rpc = core();
    try {
      await start(rpc, WIDTH, HEIGHT);
      const settings = { playback_rate: direction, bounce_enabled: bounce,
        time_seconds: direction < 0 ? DURATION : 0 };
      await rpc.commands([layer(), trigger('phase', settings), bind('phase')]);
      const initial = await waitUntil<Status>(() => rpc.send('status'), value =>
        (value.native_video_sessions.find(s => s.source_id === 'phase')?.frames_presented ?? 0) >= 4,
        'phase initial frames');
      const startSession = initial.native_video_sessions.find(s => s.source_id === 'phase')!;
      const cycle = DURATION * (bounce ? 2 : 1);
      const position = startSession.source_time_seconds ?? 0;
      const origin = (direction < 0 ? cycle - position : position) + 0.1;
      const started = performance.now();
      let status = initial;
      while (performance.now() - started < 5500) {
        const phase = (origin + (performance.now() - started) / 1000) % cycle;
        const reverse = bounce ? phase >= DURATION : direction < 0;
        await rpc.commands([{ type: 'set_media_source_phase', source_id: 'phase', uri,
          seek_generation: 1, time_seconds: reverse ? cycle - phase : phase, reverse }]);
        await sleep(100);
        status = await rpc.send('status');
      }
      const session = status.native_video_sessions.find(s => s.source_id === 'phase') as Session & { phase_error_seconds: number | null };
      expect(session.frames_presented).toBeGreaterThan(startSession.frames_presented + 60);
      expect(session.phase_error_seconds).not.toBeNull();
      expect(Math.abs(session.phase_error_seconds!)).toBeLessThan(0.025);
      await waitUntil<Status>(() => rpc.send('status'), value =>
        (value.native_video_sessions.find(s => s.source_id === 'phase') as any)?.phase_error_seconds === null,
        'phase correction expires');
    } finally { await rpc.close(); }
  }, 15000);

  it.each([
    { name: 'forward', direction: 1, bounce: false },
    { name: 'reverse', direction: -1, bounce: false },
    { name: 'bounce', direction: 1, bounce: true },
  ])('retimes $name playback without replacing the hardware session', async ({ direction, bounce }) => {
    const rpc = core();
    try {
      const baseline = await start(rpc, WIDTH, HEIGHT);
      const settings = { playback_rate: direction, bounce_enabled: bounce,
        time_seconds: direction < 0 ? DURATION : 0 };
      await arm(rpc, 'library:retime', settings);
      await rpc.commands([layer(), trigger('retime', settings), bind('retime')]);
      let status = await waitUntil<Status>(() => rpc.send('status'), value =>
        (value.native_video_sessions.find(s => s.source_id === 'retime')?.frames_presented ?? 0) >= 5,
        'initial retime frames');
      for (const speed of [1.04, 0.96, 1.0001, 0.75, 1.25]) {
        const previous = status.native_video_sessions.find(s => s.source_id === 'retime')!;
        await rpc.commands([trigger('retime', { ...settings, playback_rate: speed * direction,
          time_seconds: previous.source_time_seconds ?? 0 })]);
        status = await rpc.send('status');
        expect(status.native_video_sessions.find(s => s.source_id === 'retime')?.frames_presented,
          'rate changes must retain the session frame counter').toBeGreaterThanOrEqual(previous.frames_presented);
        status = await waitUntil<Status>(() => rpc.send('status'), value =>
          (value.native_video_sessions.find(s => s.source_id === 'retime')?.frames_presented ?? 0) >= previous.frames_presented + 2,
          'retimed playback continues');
      }
      assertHardware(status, baseline, ['retime']);
    } finally { await rpc.close(); }
  }, 20000);

  it('keeps four simultaneous clips on hardware through repeated prepared triggers', async () => {
    const rpc = core();
    try {
      const baseline = await start(rpc, WIDTH * 2, HEIGHT * 2);
      const ids = Array.from({ length: 4 }, (_, index) => `clip-${index}`);
      const regions = ids.map((_, index): Region => ({
        x: index % 2 / 2, y: Math.floor(index / 2) / 2, width: 0.5, height: 0.5,
      }));
      for (let generation = 1; generation <= 4; generation++) {
        const starts = ids.map((_, index) => (index * 13 + generation * 3) % 52);
        const settings = (index: number) => ({ time_seconds: starts[index] / FPS, playback_rate: 0.125,
          seek_generation: generation, seq: generation });
        for (let index = 0; index < ids.length; index++) {
          await arm(rpc, `library:row-${index}:g${generation}`, settings(index));
        }
        await rpc.commands(ids.flatMap((sourceId, index) => [
          layer(`row-${index}`, regions[index]), trigger(sourceId, settings(index)), bind(sourceId, `row-${index}`),
        ]));
        await waitUntil(() => presented(rpc), frame => ids.every((_, index) => {
          const number = frameNumber(frame, regions[index]);
          return number >= starts[index] && number <= starts[index] + 2;
        }), `all four prepared pictures for generation ${generation}`);
        const status: Status = await rpc.send('status');
        expect(status.native_video_sessions.filter(session => session.state === 'playing')).toHaveLength(4);
        assertHardware(status, baseline, ids);
      }
      // Let every row advance beyond its initial picture; a successful warm
      // trigger must leave all four decoder sessions running.
      await waitUntil<Status>(() => rpc.send('status'), status => ids.every(sourceId =>
        (status.native_video_sessions.find(session => session.source_id === sourceId)?.frames_presented ?? 0) >= 4),
      'four concurrently advancing hardware sessions');
      assertHardware(await rpc.send('status'), baseline, ids);
    } finally { await rpc.close(); }
  }, 45000);

  it.each([true, false])('replays a cached head covering an entire two-frame clip (loop=%s)', async loopEnabled => {
    const shortUri = join(directory, `two-frames-${loopEnabled}.mp4`);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', uri, '-frames:v', '2',
      '-c:v', 'libx264', '-preset', 'fast', '-bf', '0', '-pix_fmt', 'yuv420p', shortUri,
    ], { timeout: 15000 });
    const rpc = core();
    try {
      const baseline = await start(rpc);
      const settings = { uri: shortUri, duration_seconds: 2 / FPS, loop_enabled: loopEnabled, playback_rate: 0.125 };
      await arm(rpc, 'library:short:g1', settings);
      for (let generation = 1; generation <= 3; generation++) {
        await rpc.commands([
          layer(), trigger('short', { ...settings, seek_generation: generation, seq: generation }),
          { ...bind('short'), uri: shortUri },
        ]);
        await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 0, `short clip trigger ${generation}`);
        await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 1, `short clip second frame ${generation}`);
        if (loopEnabled) {
          await waitUntil(() => presented(rpc), frame => frameNumber(frame) === 0, `short clip loop ${generation}`);
        }
        const status = await rpc.send('status');
        expect(status.native_video_frame_decode_failures).toBe(0);
        assertHardware(status, baseline, ['short']);
      }
    } finally { await rpc.close(); }
  }, 30000);

  it('waits for actual 4K surface memory and resumes the same live session after its cap increases', async () => {
    const largeUri = join(directory, 'native-4k-memory.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'color=c=0x2060d0:s=3840x2160:r=2:d=1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-pix_fmt', 'yuv420p', largeUri,
    ], { timeout: 20000 });
    const rpc = core();
    try {
      const baseline = await start(rpc);
      await rpc.send('set_decode_handoff_policy', { decode_handoff_byte_cap_mb: 16 });
      await rpc.commands([
        layer(), trigger('large', {
          uri: largeUri, duration_seconds: 1, decode_width: 64, decode_height: 36,
        }), { ...bind('large'), uri: largeUri },
      ]);
      const waiting = await waitUntil<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(
        session => session.source_id === 'large' && Number((session as any).waiting_for_memory_bytes) > 16 * 1024 * 1024),
      'native 4K memory admission must use the source surface, not the requested 64x36 preview');
      const session = waiting.native_video_sessions.find(entry => entry.source_id === 'large');
      expect(session?.backend).toBe('preparing');
      expect(session?.frames_presented).toBe(0);
      expect(waiting.native_video_hardware_frames).toBe(0);
      expect(waiting.native_video_software_frames).toBe(0);
      expect(waiting.source_frame_input_bytes_uploaded).toBe(baseline.source_frame_input_bytes_uploaded);
      expect(waiting.native_video_sessions.reduce((sum, entry) => sum + Number((entry as any).reserved_bytes), 0))
        .toBeLessThanOrEqual(16 * 1024 * 1024);
      // No new play/seek command: the already waiting decoder must proceed
      // when actual memory is available, without being reopened or falling back.
      // Windows also retains GPU-converted bridge textures alongside NV12.
      const admittedCapMb = platform.windows ? 512 : 256;
      await rpc.send('set_decode_handoff_policy', { decode_handoff_byte_cap_mb: admittedCapMb });
      await waitUntil<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(
        entry => entry.source_id === 'large' && entry.frames_presented > 0), '4K playback after budget increase');
      const output = await waitUntil(() => presented(rpc), frame => sample(frame, 64, 48)[2] > 100, 'presented 4K picture');
      expect(sample(output, 64, 48)[2]).toBeGreaterThan(170);
      const playing = await rpc.send('status');
      expect(playing.source_frame_last_upload_width).toBe(3840);
      expect(playing.source_frame_last_upload_height).toBe(2160);
      expect(playing.native_video_sessions.find((entry: Session) => entry.source_id === 'large').waiting_for_memory_bytes).toBe(0);
      expect(playing.native_video_sessions.reduce((sum: number, entry: any) => sum + entry.reserved_bytes, 0))
        .toBeLessThanOrEqual(admittedCapMb * 1024 * 1024);
      assertHardware(playing, baseline, ['large']);
    } finally { await rpc.close(); }
  }, 40000);

  it.each(['unchanged cap', 'reduced cap', 'ample headroom'])('shares scratch memory with a newly launched live clip (%s)', async (capMode) => {
    const mediumUri = join(directory, `scratch-memory-960-${capMode.replace(' ', '-')}.mp4`);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', uri, '-vf', 'scale=960:540',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', mediumUri,
    ], { timeout: 15000 });
    const rpc = core();
    try {
      const baseline = await start(rpc);
      const settings = { uri: mediumUri };
      await arm(rpc, 'library:history-memory', settings);
      await rpc.commands([
        layer(), { ...trigger('history-memory', settings), paused: true },
        { ...bind('history-memory'), uri: mediumUri },
      ]);
      const prepared = await waitUntil<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(session =>
        session.source_id === 'history-memory' && session.frames_presented > 0), 'history initial frame');
      const baseBytes = Number((prepared.native_video_sessions.find(session => session.source_id === 'history-memory') as any).reserved_bytes);
      // Derive the cap from actual platform allocations, including the
      // Windows RGB bridge. It fits two base streams plus 4 MiB.
      const capMb = capMode === 'ample headroom' ? 256
        : Math.max(16, Math.ceil(baseBytes * 2 / (1024 * 1024)) + 4);
      if (capMode === 'unchanged cap') {
        await rpc.send('set_decode_handoff_policy', { decode_handoff_byte_cap_mb: capMb });
      }
      await rpc.commands([{ ...trigger('history-memory', { ...settings,
        time_seconds: 0.5, seek_generation: 2 }), paused: true }]);
      const expanded = await waitUntil<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(session =>
        session.source_id === 'history-memory' && Number((session as any).optional_cache_bytes) > 0),
      'scratch history grows within available budget');
      // A new stream cannot fit until the first yields optional history.
      // Exercise both ordinary admission and lowering a live budget.
      const expandedBytes = Number((expanded.native_video_sessions.find(session => session.source_id === 'history-memory') as any).reserved_bytes);
      if (capMode !== 'ample headroom') {
        expect(expandedBytes + baseBytes).toBeGreaterThan(capMb * 1024 * 1024);
      }
      if (capMode === 'reduced cap') {
        await rpc.send('set_decode_handoff_policy', { decode_handoff_byte_cap_mb: capMb });
      }
      await rpc.commands([
        layer('second-memory-layer'), trigger('admitted-after-scratch', settings),
        { ...bind('admitted-after-scratch', 'second-memory-layer'), uri: mediumUri },
      ]);
      const admitted = await waitUntil<Status>(() => rpc.send('status'), status => status.native_video_sessions.some(session =>
        session.source_id === 'admitted-after-scratch' && session.frames_presented > 0),
      'new live clip starts without increasing the cap or removing the scratched clip');
      expect(admitted.native_video_sessions.reduce((sum, session) => sum + Number((session as any).reserved_bytes), 0))
        .toBeLessThanOrEqual(capMb * 1024 * 1024);
      if (capMode === 'ample headroom') {
        // A harmless preparation must not force the active scratch window
        // back through keyframe seeks when both streams already fit.
        expect(Number((admitted.native_video_sessions.find(session => session.source_id === 'history-memory') as any).optional_cache_bytes)).toBeGreaterThan(0);
      }
      expect(admitted.native_video_frame_decode_failures).toBe(0);
      assertHardware(admitted, baseline, ['history-memory', 'admitted-after-scratch']);
    } finally { await rpc.close(); }
  }, 40000);
});
