import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const nativeCoreBin = join(
  root,
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

const WIDTH = 160;
const HEIGHT = 90;
const FPS = 30;
const FRAME_COUNT = 6;

const FULLSCREEN_CORNERS = {
  topLeft: { x: 0, y: 1 },
  topRight: { x: 1, y: 1 },
  bottomRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 0 },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveFfmpegBin() {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (typeof ffmpegStatic === 'string' && ffmpegStatic.length > 0) return ffmpegStatic;
  } catch {
    // Fall through to PATH lookup.
  }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function rawPixelFormat(nativeFormat) {
  const format = String(nativeFormat || '').toLowerCase();
  if (format.includes('bgra')) return 'bgra';
  if (format.includes('rgba')) return 'rgba';
  throw new Error(`unsupported native raw frame format: ${nativeFormat || 'missing'}`);
}

function createRpcProcess() {
  if (!existsSync(nativeCoreBin)) {
    throw new Error(`native render-core binary is missing: ${nativeCoreBin}\nRun npm run native:build first.`);
  }

  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        const message = JSON.parse(line);
        const wait = pending.get(message.id);
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(message.id);
          if (message.ok) wait.resolve(message.result);
          else wait.reject(new Error(message.error || `${wait.method} failed`));
        }
      }
      index = stdout.indexOf('\n');
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const send = (method, params = {}, timeoutMs = 10000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`native render-core timed out handling ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });

  const close = async () => {
    try {
      await send('shutdown', {}, 1000);
    } catch {
      // The process may already be gone after a failed assertion.
    }
    child.kill();
    return stderr.trim();
  };

  return { send, close };
}

function assertFrame(label, snapshot) {
  const width = Number(snapshot?.width ?? 0);
  const height = Number(snapshot?.height ?? 0);
  const byteLength = Number(snapshot?.byte_length ?? 0);
  assert(width === WIDTH && height === HEIGHT, `${label} has wrong size: ${JSON.stringify(snapshot)}`);
  assert(byteLength === WIDTH * HEIGHT * 4, `${label} has wrong byte length: ${JSON.stringify(snapshot)}`);
  assert(Number(snapshot?.bytes_written ?? byteLength) === byteLength, `${label} wrote wrong byte length: ${JSON.stringify(snapshot)}`);
  assert(!snapshot?.includes_pixels && !snapshot?.rgba_b64, `${label} leaked pixels through JSON`);
  assert(!snapshot?.dark_frame, `${label} rendered dark: ${JSON.stringify(snapshot)}`);
  assert(Number(snapshot?.average_luma ?? 0) > 0.03, `${label} luma too low: ${JSON.stringify(snapshot)}`);
  assert(Number(snapshot?.nonzero_pixels ?? 0) > WIDTH * HEIGHT * 0.75, `${label} has too few lit pixels: ${JSON.stringify(snapshot)}`);
}

function assertJpeg(path) {
  assert(existsSync(path), `missing JPEG frame: ${path}`);
  const bytes = readFileSync(path);
  assert(bytes.length > 200, `JPEG frame is suspiciously small: ${path} (${bytes.length} bytes)`);
  assert(bytes[0] === 0xff && bytes[1] === 0xd8, `JPEG frame missing SOI marker: ${path}`);
  assert(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9, `JPEG frame missing EOI marker: ${path}`);
}

function encodeRawFramesToJpegs(rawFramePaths, pixFmt, outputPattern) {
  const ffmpegBin = resolveFfmpegBin();
  const input = Buffer.concat(rawFramePaths.map((path) => readFileSync(path)));
  const result = spawnSync(ffmpegBin, [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', pixFmt,
    '-s:v', `${WIDTH}x${HEIGHT}`,
    '-framerate', String(FPS),
    '-i', 'pipe:0',
    '-frames:v', String(rawFramePaths.length),
    '-c:v', 'mjpeg',
    '-q:v', '2',
    '-pix_fmt', 'yuvj444p',
    '-f', 'image2',
    '-start_number', '0',
    outputPattern,
  ], {
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg JPEG sequence encode failed (${result.status}): ${result.stderr || result.error?.message || 'no stderr'}`);
  }
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ghost-native-frame-sequence-'));
  const rpc = createRpcProcess();
  try {
    await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: WIDTH,
        height: HEIGHT,
        target_fps: FPS,
      },
    }, 12000);

    const capabilities = await rpc.send('capabilities', {}, 5000);
    assert(
      capabilities?.features?.render_clock &&
        capabilities?.features?.frame_snapshot_export &&
        capabilities?.features?.native_frame_sequence_export &&
        capabilities?.implemented_methods?.includes('export_frame_snapshot'),
      `native core does not advertise frame sequence prerequisites: ${JSON.stringify(capabilities)}`,
    );

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'sequence-color' },
        { type: 'upsert_layer', layer_id: 'sequence-color', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'sequence-color', visible: true },
      ],
    });

    const rawFramePaths = [];
    const checksums = [];
    let pixFmt = null;
    for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
      const time = frame / FPS;
      const rawPath = join(tempDir, `native-frame-${String(frame).padStart(6, '0')}.raw`);
      await rpc.send('submit_commands', {
        commands: [
          { type: 'set_render_clock', mode: 'manual', time, time_delta: 1 / FPS, frame_index: frame },
          {
            type: 'set_layer_color',
            layer_id: 'sequence-color',
            rgba: [
              0.12 + frame * 0.08,
              0.34 + frame * 0.035,
              0.92 - frame * 0.06,
              1,
            ],
          },
        ],
      });
      const snapshot = await rpc.send('export_frame_snapshot', {
        path: rawPath,
        time,
        time_delta: 1 / FPS,
        frame_index: frame,
      }, 10000);
      assertFrame(`native frame ${frame}`, snapshot);
      const fileBytes = statSync(rawPath).size;
      assert(fileBytes === WIDTH * HEIGHT * 4, `native raw frame ${frame} file size mismatch: ${fileBytes}`);
      pixFmt ||= rawPixelFormat(snapshot.format);
      assert(rawPixelFormat(snapshot.format) === pixFmt, `native raw frame format changed mid-sequence: ${snapshot.format}`);
      rawFramePaths.push(rawPath);
      checksums.push(snapshot.checksum);
    }

    assert(new Set(checksums).size > 1, `native frame sequence checksums did not change: ${checksums.join(', ')}`);

    const outputPattern = join(tempDir, 'jpeg-%06d.jpg');
    encodeRawFramesToJpegs(rawFramePaths, pixFmt, outputPattern);
    for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
      assertJpeg(join(tempDir, `jpeg-${String(frame).padStart(6, '0')}.jpg`));
    }

    const status = await rpc.send('status', {}, 5000);
    assert(Number(status?.render_clock_updates ?? 0) >= FRAME_COUNT, `render clock was not stepped for every frame: ${JSON.stringify(status)}`);

    console.log(
      `[native-frame-sequence] ok frames=${FRAME_COUNT} size=${WIDTH}x${HEIGHT} pixFmt=${pixFmt} first=${checksums[0]} last=${checksums[checksums.length - 1]}`,
    );
  } finally {
    const stderr = await rpc.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (stderr && process.env.NATIVE_FRAME_SEQUENCE_VERBOSE === '1') {
      console.warn(stderr);
    }
  }
}

main().catch((err) => {
  console.error(`[native-frame-sequence] ${err?.stack || err?.message || err}`);
  process.exitCode = 1;
});
