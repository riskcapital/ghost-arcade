import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeShaderSourceFromJavascript } from './nativeJsShaderSource';

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

type NativeRpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
};

function createNativeRpc(): NativeRpc {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error('native render-core stdio was not initialized');
  }

  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map<number, {
    method: string;
    timer: ReturnType<typeof setTimeout>;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        const message = JSON.parse(line) as {
          id?: number;
          ok?: boolean;
          result?: unknown;
          error?: string;
        };
        const wait = typeof message.id === 'number' ? pending.get(message.id) : null;
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(message.id as number);
          if (message.ok) wait.resolve(message.result);
          else wait.reject(new Error(message.error || `${wait.method} failed`));
        }
      }
      index = stdout.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const send: NativeRpc['send'] = (method, params = {}, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`native render-core timed out handling ${method}: ${stderr.trim()}`));
      }, timeoutMs);
      pending.set(id, { method, timer, resolve, reject });
      child.stdin?.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  return {
    send,
    async close() {
      try {
        await send('shutdown', {}, 1000);
      } catch {
        // The process may already be gone after an assertion failure.
      }
      child.kill();
    },
  };
}

function assertSnapshotPixels(label: string, snapshot: Record<string, unknown>): Uint8Array {
  expect(snapshot.includes_pixels, label).toBe(true);
  expect(String(snapshot.checksum ?? ''), label).toHaveLength(16);
  const width = Number(snapshot.width ?? 0);
  const height = Number(snapshot.height ?? 0);
  const data = typeof snapshot.rgba_b64 === 'string'
    ? Buffer.from(snapshot.rgba_b64, 'base64')
    : null;
  expect(data?.byteLength ?? 0, label).toBe(width * height * 4);
  return new Uint8Array(data ?? []);
}

function averagePixelDelta(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.byteLength, b.byteLength);
  if (length <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < length; i += 4) {
    sum += Math.abs(a[i] - b[i]);
    sum += Math.abs(a[i + 1] - b[i + 1]);
    sum += Math.abs(a[i + 2] - b[i + 2]);
  }
  return sum / Math.max(1, Math.floor(length / 4) * 3);
}

// Arming is enqueue-only in the core (pre-roll fills on the decoder thread;
// the command loop never blocks on it). Instant-trigger latency is promised
// for ARMED clips, so tests that assert it must first wait for the session
// to report `prerolled` via status — the same signal the app uses.
async function waitForPrerolledSession(
  rpc: NativeRpc,
  sourceId: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await rpc.send('status', {}, 5000);
    const sessions = Array.isArray(status?.native_video_sessions)
      ? status.native_video_sessions
      : [];
    const session = sessions.find(
      (entry: { source_id?: string }) => entry?.source_id === sourceId,
    );
    if (session && session.state === 'prerolled') {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `native video session ${sourceId} did not pre-roll in ${timeoutMs}ms: ${JSON.stringify(sessions)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('Native render-core RPC contract', () => {
  const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;
  const nativeBackend =
    process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan';
  const nativeSharedTexturePlatform =
    process.platform === 'darwin' ? 'iosurface' : process.platform === 'win32' ? 'dxgi' : null;
  const nativeSharedTextureDetail =
    process.platform === 'darwin' ? 'IOSurfaceID' : process.platform === 'win32' ? 'DXGI shared HANDLE' : '';

  itIfNativeCore('advances bound ISF shaders on the core clock while Electron is idle', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: { backend: nativeBackend, width: 128, height: 72, target_fps: 30 },
      }, 15000);
      expect(started?.backend_ready).toBe(true);
      const shaderId = 'native-idle-isf';
      const layerId = 'native-idle-isf-layer';
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'precompile_shader',
            shader_id: shaderId,
            stage: 'pixel',
            entry: 'main',
            source: `/*{"ISFVSN":"2","INPUTS":[]}*/
void main() {
  float pulse = 0.5 + 0.5 * sin(TIME * 5.0);
  gl_FragColor = vec4(pulse, isf_FragNormCoord.x, isf_FragNormCoord.y, 1.0);
}`,
          },
          {
            type: 'upsert_layer',
            layer_id: layerId,
            z_index: 0,
            opacity: 1,
            blend_mode: 'normal',
            corners: {
              topLeft: { x: 0, y: 0 },
              topRight: { x: 1, y: 0 },
              bottomRight: { x: 1, y: 1 },
              bottomLeft: { x: 0, y: 1 },
            },
          },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          { type: 'bind_isf_shader', layer_id: layerId, shader_id: shaderId },
          {
            type: 'update_isf_uniforms',
            shader_id: shaderId,
            time: 0,
            time_delta: 1 / 30,
            frame_index: 0,
            render_width: 128,
            render_height: 72,
            float_inputs: {},
            point_inputs: {},
            color_inputs: {},
          },
          { type: 'render_isf_to_layer', layer_id: layerId },
        ],
      }, 10000);
      await new Promise((resolve) => setTimeout(resolve, 90));
      const first = await rpc.send('frame_snapshot', { include_pixels: false }, 8000);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const second = await rpc.send('frame_snapshot', { include_pixels: false }, 8000);
      expect(first.nonzero_pixels).toBeGreaterThan(0);
      expect(second.nonzero_pixels).toBeGreaterThan(0);
      expect(second.checksum).not.toBe(first.checksum);
    } finally {
      await rpc.close();
    }
  }, 25000);

  itIfNativeCore('renders shader-backed JavaScript media entirely in the native core', async () => {
    const htmlCode = readFileSync(join(process.cwd(), 'public', 'threejs', 'embryo', 'index.html'), 'utf8');
    const nativeSource = nativeShaderSourceFromJavascript({
      animationType: 'threejs',
      htmlCode,
      params: [
        { name: 'speed', type: 'number', default: 1, min: 0, max: 3 },
        { name: 'cameraDistance', type: 'number', default: 8, min: 4, max: 16 },
        { name: 'fov', type: 'number', default: 1.6, min: 0.6, max: 2.6 },
        { name: 'particleGlow', type: 'number', default: 1, min: 0, max: 3 },
        { name: 'lineGlow', type: 'number', default: 1, min: 0, max: 3 },
        { name: 'nucleusIntensity', type: 'number', default: 1, min: 0, max: 3 },
        { name: 'vignette', type: 'number', default: 0.35, min: 0, max: 1 },
        { name: 'electronColor', type: 'color', default: [0.4, 0.7, 1] },
      ],
    });
    expect(nativeSource).not.toBeNull();

    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: { backend: nativeBackend, width: 160, height: 90, target_fps: 30 },
      }, 15000);
      expect(started?.backend_ready).toBe(true);
      const shaderId = 'native-js-embryo';
      const layerId = 'native-js-embryo-layer';
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'precompile_shader',
            shader_id: shaderId,
            stage: 'pixel',
            entry: 'main',
            source: nativeSource!.shaderCode,
          },
          {
            type: 'upsert_layer',
            layer_id: layerId,
            z_index: 0,
            opacity: 1,
            blend_mode: 'normal',
            corners: {
              topLeft: { x: 0, y: 0 },
              topRight: { x: 1, y: 0 },
              bottomRight: { x: 1, y: 1 },
              bottomLeft: { x: 0, y: 1 },
            },
          },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          { type: 'bind_isf_shader', layer_id: layerId, shader_id: shaderId },
          {
            type: 'update_isf_uniforms',
            shader_id: shaderId,
            time: 0.5,
            time_delta: 1 / 30,
            frame_index: 15,
            render_width: 160,
            render_height: 90,
            float_inputs: {
              speed: 1,
              cameraDistance: 8,
              fov: 1.6,
              particleGlow: 1,
              lineGlow: 1,
              nucleusIntensity: 1,
              vignette: 0.35,
            },
            color_inputs: { electronColor: [0.4, 0.7, 1, 1] },
          },
          { type: 'render_isf_to_layer', layer_id: layerId },
        ],
      }, 15000);
      await new Promise((resolve) => setTimeout(resolve, 140));
      const snapshot = await rpc.send('frame_snapshot', { include_pixels: false }, 10000);
      const status = await rpc.send('status', {}, 5000);
      expect(snapshot.nonzero_pixels).toBeGreaterThan(0);
      expect(String(snapshot.checksum ?? '')).toHaveLength(16);
      expect(status.last_shader_error).toBeNull();
      expect(Number(status.native_shader_layers ?? 0)).toBe(1);
    } finally {
      await rpc.close();
    }
  }, 35000);

  itIfNativeCore('decodes still images and advances video frames on the core clock', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'ghost-native-media-'));
    const imagePath = join(fixtureDir, 'still.png');
    const videoPath = join(fixtureDir, 'motion.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'color=c=0xFF3040:s=64x36', '-frames:v', '1', imagePath,
    ]);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=64x36:rate=24:duration=1',
      '-c:v', 'mpeg4', '-q:v', '2', '-pix_fmt', 'yuv420p', videoPath,
    ]);

    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 128,
          height: 72,
          source_frame_size: 128,
          target_fps: 60,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);
      const layerId = 'native-media-layer';
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'upsert_layer',
            layer_id: layerId,
            z_index: 0,
            opacity: 1,
            blend_mode: 'normal',
            corners: {
              topLeft: { x: 0, y: 0 },
              topRight: { x: 1, y: 0 },
              bottomRight: { x: 1, y: 1 },
              bottomLeft: { x: 0, y: 1 },
            },
          },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          {
            type: 'bind_media_source',
            layer_id: layerId,
            source_id: 'native-still',
            uri: imagePath,
            source_type: 'image',
          },
        ],
      }, 10000);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const imageSnapshot = await rpc.send('frame_snapshot', { include_pixels: false }, 10000);
      const imageStatus = await rpc.send('status', {}, 5000);
      expect(imageSnapshot.nonzero_pixels).toBeGreaterThan(0);
      expect(Number(imageStatus.native_image_decodes ?? 0)).toBeGreaterThan(0);

      await rpc.send('prefetch_media', {
        source_id: 'native-video',
        uri: videoPath,
        source_type: 'video',
        time_seconds: 0,
        decode_width: 128,
        decode_height: 72,
        playback_rate: 1,
        loop_enabled: true,
        duration_seconds: 1,
        trim_start: 0,
        trim_end: 1,
        seq: 1,
      }, 10000);
      await waitForPrerolledSession(rpc, 'native-video');
      const armedVideoStatus = await rpc.send('status', {}, 5000);
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'bind_media_source',
            layer_id: layerId,
            source_id: 'native-video',
            uri: videoPath,
            source_type: 'video',
          },
          {
            type: 'set_media_source_playback',
            source_id: 'native-video',
            uri: videoPath,
            source_type: 'video',
            time_seconds: 0,
            playback_rate: 1,
            paused: false,
            loop_enabled: true,
            duration_seconds: 1,
            trim_start: 0,
            trim_end: 1,
            seq: 1,
          },
        ],
      }, 10000);
      const immediateVideoStatus = await rpc.send('status', {}, 5000);
      expect(
        Number(immediateVideoStatus.native_video_trigger_last_latency_us ?? Number.MAX_SAFE_INTEGER),
        JSON.stringify(immediateVideoStatus.native_video_sessions),
      ).toBeLessThan(16_000);
      expect(
        Number(immediateVideoStatus.native_video_sessions?.[0]?.frames_presented ?? 0),
        JSON.stringify({
          armed: armedVideoStatus.native_video_sessions,
          triggered: immediateVideoStatus.native_video_sessions,
        }),
      ).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const firstVideo = await rpc.send('frame_snapshot', { include_pixels: false }, 10000);
      await new Promise((resolve) => setTimeout(resolve, 950));
      const secondVideo = await rpc.send('frame_snapshot', { include_pixels: false }, 10000);
      const videoStatus = await rpc.send('status', {}, 5000);
      expect(firstVideo.nonzero_pixels).toBeGreaterThan(0);
      expect(secondVideo.nonzero_pixels).toBeGreaterThan(0);
      expect(secondVideo.checksum).not.toBe(firstVideo.checksum);
      expect(Number(videoStatus.native_video_frame_decodes ?? 0)).toBeGreaterThanOrEqual(5);
      expect(videoStatus.source_frame_last_upload_transport).toBe('native-video-stream');
      expect(Number(videoStatus.video_oneshot_decodes_during_playback ?? -1)).toBe(0);
      expect(Number(videoStatus.native_video_sessions_playing ?? 0)).toBe(1);
      expect(
        Number(videoStatus.native_video_trigger_last_latency_us ?? Number.MAX_SAFE_INTEGER),
        JSON.stringify({
          triggerLatencyUs: videoStatus.native_video_trigger_last_latency_us,
          sessions: videoStatus.native_video_sessions,
          framesPresented: videoStatus.frames_presented,
          gpuSubmitted: videoStatus.gpu_frames_submitted,
          gpuCompleted: videoStatus.gpu_frames_completed,
        }),
      ).toBeLessThan(16_000);
      expect(Number(videoStatus.native_video_stream_underflows ?? -1)).toBe(0);
      expect(Number(videoStatus.native_video_sessions?.[0]?.frames_presented ?? 0)).toBeGreaterThanOrEqual(60);
      expect(Number(videoStatus.source_frame_last_upload_width ?? 0)).toBe(128);
      expect(Number(videoStatus.source_frame_last_upload_height ?? 0)).toBe(72);
    } finally {
      await rpc.close();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 45000);

  itIfNativeCore('commits a video binding when pre-roll finishes after the bind command', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'ghost-native-video-bind-race-'));
    const videoPath = join(fixtureDir, 'motion.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=64x36:rate=30:duration=1',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', videoPath,
    ]);

    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 128,
          height: 72,
          source_frame_size: 128,
          target_fps: 60,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);
      await rpc.send('prefetch_media', {
        source_id: 'late-video',
        uri: videoPath,
        source_type: 'video',
        time_seconds: 0,
        decode_width: 128,
        decode_height: 72,
        playback_rate: 1,
        loop_enabled: true,
        duration_seconds: 1,
        trim_start: 0,
        trim_end: 1,
        seq: 1,
      }, 10000);
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'upsert_layer',
            layer_id: 'late-video-layer',
            z_index: 0,
            opacity: 1,
            blend_mode: 'normal',
            corners: {
              topLeft: { x: 0, y: 0 },
              topRight: { x: 1, y: 0 },
              bottomRight: { x: 1, y: 1 },
              bottomLeft: { x: 0, y: 1 },
            },
          },
          { type: 'set_layer_visibility', layer_id: 'late-video-layer', visible: true },
          {
            type: 'bind_media_source',
            layer_id: 'late-video-layer',
            source_id: 'late-video',
            uri: videoPath,
            source_type: 'video',
          },
        ],
      }, 10000);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const snapshot = await rpc.send('frame_snapshot', { include_pixels: false }, 10000);
      expect(snapshot.nonzero_pixels).toBeGreaterThan(0);
      expect(snapshot.dark_frame).toBe(false);
    } finally {
      await rpc.close();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 45000);

  itIfNativeCore('triggers a prerolled long-GOP video within one frame while four sessions play', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'ghost-native-video-arm-'));
    const videoPath = join(fixtureDir, 'long-gop.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=96x54:rate=60:duration=2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-g', '120', '-keyint_min', '120',
      '-sc_threshold', '0', '-pix_fmt', 'yuv420p', videoPath,
    ]);

    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 96,
          height: 54,
          source_frame_size: 96,
          target_fps: 60,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);

      for (let index = 0; index < 5; index += 1) {
        await rpc.send('prefetch_media', {
          source_id: `armed-video-${index}`,
          uri: videoPath,
          source_type: 'video',
          time_seconds: 0,
          decode_width: 96,
          decode_height: 54,
          playback_rate: 1,
          loop_enabled: true,
          duration_seconds: 2,
          trim_start: 0,
          trim_end: 1,
          seq: 1,
        }, 10000);
      }
      for (let index = 0; index < 5; index += 1) {
        await waitForPrerolledSession(rpc, `armed-video-${index}`);
      }

      const commands: any[] = [];
      for (let index = 0; index < 5; index += 1) {
        commands.push({
          type: 'upsert_layer',
          layer_id: `armed-layer-${index}`,
          z_index: index,
          opacity: 1,
          blend_mode: 'normal',
          corners: {
            topLeft: { x: 0, y: 0 },
            topRight: { x: 1, y: 0 },
            bottomRight: { x: 1, y: 1 },
            bottomLeft: { x: 0, y: 1 },
          },
        });
        commands.push({
          type: 'bind_media_source',
          layer_id: `armed-layer-${index}`,
          source_id: `armed-video-${index}`,
          uri: videoPath,
          source_type: 'video',
        });
        commands.push({
          type: 'set_layer_visibility',
          layer_id: `armed-layer-${index}`,
          visible: index < 4,
        });
        commands.push({
          type: 'set_media_source_playback',
          source_id: `armed-video-${index}`,
          uri: videoPath,
          source_type: 'video',
          time_seconds: 0,
          playback_rate: 1,
          paused: index === 4,
          loop_enabled: true,
          duration_seconds: 2,
          trim_start: 0,
          trim_end: 1,
          decode_width: 96,
          decode_height: 54,
          seq: 1,
        });
      }
      await rpc.send('submit_commands', { commands }, 10000);
      await new Promise((resolve) => setTimeout(resolve, 120));

      await rpc.send('submit_commands', {
        commands: [
          { type: 'set_layer_visibility', layer_id: 'armed-layer-4', visible: true },
          {
            type: 'set_media_source_playback',
            source_id: 'armed-video-4',
            uri: videoPath,
            source_type: 'video',
            time_seconds: 0,
            playback_rate: 1,
            paused: false,
            loop_enabled: true,
            duration_seconds: 2,
            trim_start: 0,
            trim_end: 1,
            decode_width: 96,
            decode_height: 54,
            seq: 2,
          },
        ],
      }, 10000);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const status = await rpc.send('status', {}, 5000);
      expect(Number(status.native_video_sessions_playing ?? 0)).toBe(5);
      expect(Number(status.native_video_trigger_last_latency_us ?? Number.MAX_SAFE_INTEGER)).toBeLessThan(16_000);
      expect(Number(status.video_oneshot_decodes_during_playback ?? -1)).toBe(0);
      expect(Number(status.native_video_stream_underflows ?? -1)).toBe(0);
      expect(status.native_video_sessions).toHaveLength(5);
      const presentedFrames = status.native_video_sessions.map((session: any) => session.frames_presented);
      expect(Math.min(...presentedFrames), JSON.stringify({
        presentedFrames,
        targetFps: status.target_fps,
        framesPresented: status.frames_presented,
        gpuSubmitted: status.gpu_frames_submitted,
        gpuCompleted: status.gpu_frames_completed,
        underflows: status.native_video_stream_underflows,
      })).toBeGreaterThanOrEqual(60);
    } finally {
      await rpc.close();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 60000);

  itIfNativeCore('renders native edge fill and animated stroke payloads in the layer compositor', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: { backend: nativeBackend, width: 128, height: 72, target_fps: 30 },
      }, 15000);
      expect(started?.backend_ready).toBe(true);
      const layerId = 'native-edge-fixture';
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'upsert_layer',
            layer_id: layerId,
            z_index: 0,
            opacity: 1,
            blend_mode: 'normal',
            corners: {
              topLeft: { x: 0.12, y: 0.88 },
              topRight: { x: 0.88, y: 0.88 },
              bottomRight: { x: 0.88, y: 0.12 },
              bottomLeft: { x: 0.12, y: 0.12 },
            },
            shape: [0, 0, 0, 1],
          },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          { type: 'set_layer_color', layer_id: layerId, rgba: [0.08, 0.1, 0.14, 1] },
        ],
      }, 5000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const baseline = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 1,
        frame_index: 30,
      }, 8000);
      const baselinePixels = assertSnapshotPixels('native edge baseline', baseline);

      await rpc.send('submit_commands', {
        commands: [{
          type: 'set_layer_edge_effects',
          layer_id: layerId,
          edge_effects: [[
            [1, 1, 1, 2],
            [0.05, 1, 0.65, 1],
            [5, 24, 1.4, 1.2],
            [1, 0.32, 0, 0],
            [0.8, 0.04, 0.25, 0.7],
            [0.05, 0.15, 0.8, 0.6],
            [2, 1.5, 0.82, 1.18],
          ]],
        }],
      }, 5000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const effected = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 1,
        frame_index: 30,
      }, 8000);
      const effectedPixels = assertSnapshotPixels('native edge effected', effected);
      expect(effected.checksum).not.toBe(baseline.checksum);
      expect(averagePixelDelta(effectedPixels, baselinePixels)).toBeGreaterThan(2);
    } finally {
      await rpc.close();
    }
  }, 20000);

  itIfNativeCore('advertises implemented methods and rejects unknown RPC methods', async () => {
    const rpc = createNativeRpc();
    try {
      const capabilities = await rpc.send('get_capabilities');
      expect(capabilities?.implemented_methods).toEqual(expect.arrayContaining([
        'get_capabilities',
        'submit_commands',
        'compute_graph',
        'shutdown',
      ]));
      expect(capabilities?.implemented_methods).not.toContain('definitely_not_a_real_rpc');
      expect(capabilities?.features?.native_instrument_proxies).toBe(false);

      await expect(rpc.send('definitely_not_a_real_rpc')).rejects.toThrow(
        'unsupported native render-core RPC method `definitely_not_a_real_rpc`',
      );
    } finally {
      await rpc.close();
    }
  }, 10000);

  itIfNativeCore('keeps raw frame export distinct from Electron recording readiness', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 96,
          height: 54,
          target_fps: 30,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);

      await rpc.send('submit_commands', {
        time: 0.1,
        frame_index: 1,
        layers: [],
      }, 8000);

      const capabilities = await rpc.send('get_capabilities');
      expect(capabilities?.features?.frame_snapshot_export).toBe(true);
      expect(capabilities?.features?.native_frame_export).toBe(true);
      expect(capabilities?.features?.native_frame_sequence_export).toBe(true);
      expect(capabilities?.features?.native_recording).toBe(false);
      if (nativeSharedTexturePlatform) {
        expect(capabilities?.features?.shared_texture_source_frame_upload).toBe(true);
        expect(capabilities?.features?.shared_texture_upload).toBe(true);
        expect(capabilities?.features?.shared_texture_output_export).toBe(true);
      } else {
        expect(capabilities?.features?.shared_texture_upload).toBe(false);
      }

      const readiness = await rpc.send('get_readiness_report');
      const checks = new Map<string, any>((readiness?.checks ?? []).map((check: any) => [check?.id, check]));
      expect(checks.get('native-frame-export')?.ok).toBe(true);
      expect(checks.get('native-frame-sequence-export')?.ok).toBe(true);
      expect(checks.get('native-recording')?.ok).toBe(false);
      expect(String(checks.get('native-recording')?.detail ?? '')).toContain('Electron broker');
      if (nativeSharedTexturePlatform) {
        expect(checks.get('shared-texture-source-frame-upload')?.ok).toBe(true);
        expect(checks.get('shared-texture-upload')?.ok).toBe(true);
        expect(String(checks.get('shared-texture-upload')?.detail ?? '')).toContain(nativeSharedTextureDetail);
        expect(checks.get('shared-texture-output-export')?.ok).toBe(true);
        const outputTexture = await rpc.send('output_shared_texture');
        expect(outputTexture?.available).toBe(true);
        expect(outputTexture?.platform).toBe(nativeSharedTexturePlatform);
        expect(Number(outputTexture?.handle ?? 0)).toBeGreaterThan(0);
        expect(Number(outputTexture?.handle_byte_length ?? 0)).toBe(
          nativeSharedTexturePlatform === 'iosurface' ? 4 : 8,
        );
        expect(outputTexture?.handle_scope).toBe(
          nativeSharedTexturePlatform === 'iosurface' ? 'global-id' : 'process-local',
        );
	        expect(outputTexture?.preferred_transport).toBe(
	          nativeSharedTexturePlatform === 'iosurface' ? 'handle' : 'shared_name',
	        );
	        expect(outputTexture?.format).toBe('bgra8unorm');
	        expect(outputTexture?.color_space).toBe('srgb');
	        expect(outputTexture?.storage_format).toBe('bgra8unorm');
	        expect(outputTexture?.storage_encoding).toBe('srgb-encoded-bgra8unorm');
	        expect(outputTexture?.alpha_mode).toBe('opaque');
	        expect(outputTexture?.premultiplied_alpha).toBe(false);
	        expect(outputTexture?.single_render_source).toBe('core-output-composite');
	        expect(outputTexture?.zero_conversions).toBe(true);
	        if (nativeSharedTexturePlatform === 'dxgi') {
          expect(String(outputTexture?.shared_name ?? '')).toContain('GhostArcadeNativeOutput');
        }
        expect(Number(outputTexture?.frame ?? 0)).toBeGreaterThan(0);
        expect(Number(outputTexture?.width ?? 0)).toBeGreaterThan(0);
        expect(Number(outputTexture?.height ?? 0)).toBeGreaterThan(0);
      } else {
        expect(checks.get('shared-texture-upload')?.ok).toBe(false);
      }
    } finally {
      await rpc.close();
    }
  }, 20000);

  itIfNativeCore('captures Stage3D mesh scenes through the native frame snapshot path', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 128,
          height: 72,
          target_fps: 30,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);

      const capabilities = await rpc.send('get_capabilities');
      expect(capabilities?.features?.native_stage3d_output_renderer).toBe(true);
      expect(capabilities?.features?.native_stage3d_recording_parity).toBe(true);

      const baseline = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 3.25,
        frame_index: 88,
      }, 8000);
      const baselinePixels = assertSnapshotPixels('baseline stage snapshot', baseline);

      const summary = await rpc.send('set_stage3d_scene', {
        stage3d: {
          id: 'native-stage-recording-parity',
          name: 'Native Stage Recording Parity',
          schemaVersion: 1,
          camera: {
            position: [0, 3.4, 10.5],
            target: [0, 2.1, 0],
            fov: 46,
          },
          lighting: {
            roomDarkness: 0,
            screenBoost: 1.4,
            exposure: 1.1,
            roomIntensity: 1,
          },
          atmosphere: {
            haze: false,
            hazeDensity: 0,
          },
          nodes: [
            {
              id: 'native-stage-test-screen',
              type: 'led-screen',
              visible: true,
              position: [0, 2.1, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              width: 10,
              height: 5.6,
              brightness: 2.4,
            },
            {
              id: 'native-stage-test-riser',
              type: 'primitive',
              visible: true,
              position: [0, 0.35, 1.25],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              dimensions: [4.2, 0.7, 2.2],
              geometry: 'box',
              material: {
                color: '#20242c',
                roughness: 0.7,
                metalness: 0,
                emissive: '#38445f',
              },
            },
          ],
          userElements: [
            {
              id: 'native-stage-test-orb',
              type: 'visualsphere',
              position: [0, 1.2, -0.9],
              rotationX: 0,
              rotationY: 0,
              rotationZ: 0,
              scale: 1,
              params: {
                radius: 1.2,
                color: '#ff6a3d',
                brightness: 2.2,
                opacity: 1,
              },
            },
          ],
        },
      }, 5000);
      expect(summary?.screen_count).toBe(1);
      expect(summary?.primitive_count).toBeGreaterThanOrEqual(1);
      expect(summary?.user_element_count).toBe(1);

      const sceneSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 3.25,
        frame_index: 88,
      }, 8000);
      const scenePixels = assertSnapshotPixels('stage scene snapshot', sceneSnapshot);
      expect(sceneSnapshot.dark_frame).toBe(false);
      expect(Number(sceneSnapshot.average_luma ?? 0)).toBeGreaterThan(0.01);
      expect(sceneSnapshot.checksum).not.toBe(baseline.checksum);
      expect(averagePixelDelta(scenePixels, baselinePixels)).toBeGreaterThan(1.5);
    } finally {
      await rpc.close();
    }
  }, 30000);

  itIfNativeCore('captures Projection Sim mesh scenes through the native frame snapshot path', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 128,
          height: 72,
          target_fps: 30,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);

      const capabilities = await rpc.send('get_capabilities');
      expect(capabilities?.features?.native_projection_sim_output_renderer).toBe(true);
      expect(capabilities?.features?.native_projection_sim_recording_parity).toBe(true);

      const baseline = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 5.5,
        frame_index: 132,
      }, 8000);
      const baselinePixels = assertSnapshotPixels('baseline projection snapshot', baseline);

      const summary = await rpc.send('set_projection_sim_scene', {
        projection_sim: {
          id: 'native-projection-recording-parity',
          name: 'Native Projection Recording Parity',
          schemaVersion: 1,
          environment: {
            background: '#05070b',
            ambient: 0.35,
            roomExposure: 1.2,
            surfaceStyle: 'light-gray',
            floorColor: '#12151a',
            showFloorProjection: true,
            showGrid: false,
            shadows: true,
            shadowStrength: 1,
          },
          camera: {
            position: [7.5, 4.8, 8.5],
            target: [0, 1.7, 0],
            fov: 44,
          },
          objects: [
            {
              id: 'native-projection-test-box',
              name: 'Native Projection Box',
              type: 'primitive',
              primitive: 'box',
              position: [0, 1.4, 0],
              rotation: [0, 0.18, 0],
              scale: [4.6, 2.8, 1.2],
              color: '#26c6ff',
              roughness: 0.5,
              visible: true,
              locked: false,
              castShadow: true,
              receiveProjection: true,
            },
            {
              id: 'native-projection-test-sphere',
              name: 'Native Projection Sphere',
              type: 'primitive',
              primitive: 'sphere',
              position: [-2.6, 1.0, -1.5],
              rotation: [0, 0, 0],
              scale: [1.8, 1.8, 1.8],
              color: '#ff4f93',
              roughness: 0.35,
              visible: true,
              locked: false,
              castShadow: true,
              receiveProjection: false,
            },
          ],
          projectors: [
            {
              id: 'native-projection-test-projector',
              name: 'Native Projector',
              enabled: true,
              locked: false,
              position: [-4.5, 4.2, 6.5],
              target: [0, 1.5, 0],
              fov: 34,
              aspect: 1.7777777778,
              intensity: 1.4,
              opacity: 1,
              color: '#ffffff',
              source: 'master',
              sliceId: null,
              crop: [0, 0, 1, 1],
              edgeBlend: [0, 0, 0, 0],
              showFrustum: true,
            },
          ],
        },
      }, 5000);
      expect(summary?.object_count).toBe(2);
      expect(summary?.primitive_count).toBe(2);
      expect(summary?.projector_count).toBe(1);

      const sceneSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 5.5,
        frame_index: 132,
      }, 8000);
      const scenePixels = assertSnapshotPixels('projection scene snapshot', sceneSnapshot);
      expect(sceneSnapshot.dark_frame).toBe(false);
      expect(Number(sceneSnapshot.average_luma ?? 0)).toBeGreaterThan(0.01);
      expect(sceneSnapshot.checksum).not.toBe(baseline.checksum);
      expect(averagePixelDelta(scenePixels, baselinePixels)).toBeGreaterThan(1.5);
    } finally {
      await rpc.close();
    }
  }, 30000);
});
