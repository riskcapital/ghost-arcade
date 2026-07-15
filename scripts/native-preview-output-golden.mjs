import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const bin = join(
  root,
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

const WIDTH = 160;
const HEIGHT = 90;
const TOLERANCE = 1;

const rect = (x0, y0, x1, y1) => ({
  topLeft: { x: x0, y: y1 },
  topRight: { x: x1, y: y1 },
  bottomRight: { x: x1, y: y0 },
  bottomLeft: { x: x0, y: y0 },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createRpcProcess() {
  assert(existsSync(bin), `native render-core binary missing at ${bin}; run npm run native:build first`);
  const child = spawn(bin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  child.stdin.setDefaultEncoding('utf8');
  child.stdout.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();

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

  const send = (method, params = {}, timeoutMs = 8000) => new Promise((resolve, reject) => {
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
      // Already gone.
    }
    child.kill();
    return stderr.trim();
  };

  return { send, close };
}

async function waitForExportFrame(rpc, beforeFrame) {
  await rpc.send('submit_commands', { commands: [{ type: 'present' }] }, 1000);
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const texture = await rpc.send('output_shared_texture', {}, 1000);
    if (Number(texture?.frame ?? 0) > beforeFrame) return texture;
  }
  throw new Error('native output export did not publish a frame for golden fixture');
}

function decodePixels(snapshot, label) {
  assert(snapshot?.includes_pixels, `${label} did not include pixels`);
  assert(typeof snapshot.rgba_b64 === 'string', `${label} is missing rgba_b64`);
  return Buffer.from(snapshot.rgba_b64, 'base64');
}

function comparePixels(a, b) {
  assert(a.length === b.length, `pixel byte length mismatch ${a.length} != ${b.length}`);
  let maxDelta = 0;
  let mismatchCount = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = Math.abs(a[i] - b[i]);
    if (delta > maxDelta) maxDelta = delta;
    if (delta > TOLERANCE) mismatchCount += 1;
  }
  return { maxDelta, mismatchCount };
}

async function main() {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    console.log('native preview/output golden skipped: shared output texture export is unsupported on this platform');
    return;
  }

  const rpc = createRpcProcess();
  try {
    const started = await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : 'd3d12',
        width: WIDTH,
        height: HEIGHT,
        target_fps: 30,
        auto_present_on_state_change: false,
      },
    }, 12000);
    assert(started?.backend_ready, `native render-core did not start: ${JSON.stringify(started)}`);
    await rpc.send('attach_output_window', { label: 'native-preview-output-golden' }, 5000);
    const outputWindowStatus = await rpc.send('set_output_window', {
      config: {
        title: 'Ghost Native Preview Golden',
        width: WIDTH,
        height: HEIGHT,
        attached: true,
        fullscreen: false,
        resizable: false,
        decorations: false,
      },
    }, 5000);
    assert(outputWindowStatus?.output_window_attached, `native output window did not attach: ${JSON.stringify(outputWindowStatus)}`);

    const capabilities = await rpc.send('capabilities', {}, 5000);
    const preview = capabilities?.native_editor_preview ?? {};
    assert(capabilities?.features?.native_editor_preview_frame_source === true, 'native editor preview frame-source feature is not active');
    assert(preview.source === 'core-output-composite' && preview.single_render === true, `native editor preview is not sourced from core composite: ${JSON.stringify(preview)}`);
    assert(capabilities?.output_shared_texture_export?.color_space === 'srgb', 'output export color_space is not srgb');
    assert(capabilities?.output_shared_texture_export?.storage_format === 'bgra8unorm', 'output export storage_format is not bgra8unorm');

    await rpc.send('set_render_clock', { config: { mode: 'manual', time: 0.5, frame_index: 15 } }, 1000);
    await rpc.send('submit_commands', {
      commands: [
        { type: 'set_output', width: WIDTH, height: HEIGHT },
        { type: 'upsert_layer', layer_id: 'golden-red', z_index: 0, blend_mode: 'normal', opacity: 1, corners: rect(0.0, 0.0, 0.25, 1.0) },
        { type: 'bind_media_source', layer_id: 'golden-red', source_id: 'golden-red-source', uri: 'color://red', source_type: 'color' },
        { type: 'set_layer_color', layer_id: 'golden-red', rgba: [1, 0, 0, 1] },
        { type: 'set_layer_visibility', layer_id: 'golden-red', visible: true },
        { type: 'upsert_layer', layer_id: 'golden-green', z_index: 0, blend_mode: 'normal', opacity: 1, corners: rect(0.25, 0.0, 0.5, 1.0) },
        { type: 'bind_media_source', layer_id: 'golden-green', source_id: 'golden-green-source', uri: 'color://green', source_type: 'color' },
        { type: 'set_layer_color', layer_id: 'golden-green', rgba: [0, 1, 0, 1] },
        { type: 'set_layer_visibility', layer_id: 'golden-green', visible: true },
        { type: 'upsert_layer', layer_id: 'golden-blue', z_index: 0, blend_mode: 'normal', opacity: 1, corners: rect(0.5, 0.0, 0.75, 1.0) },
        { type: 'bind_media_source', layer_id: 'golden-blue', source_id: 'golden-blue-source', uri: 'color://blue', source_type: 'color' },
        { type: 'set_layer_color', layer_id: 'golden-blue', rgba: [0, 0, 1, 1] },
        { type: 'set_layer_visibility', layer_id: 'golden-blue', visible: true },
        { type: 'upsert_layer', layer_id: 'golden-gray', z_index: 0, blend_mode: 'normal', opacity: 1, corners: rect(0.75, 0.0, 1.0, 1.0) },
        { type: 'bind_media_source', layer_id: 'golden-gray', source_id: 'golden-gray-source', uri: 'color://gray', source_type: 'color' },
        { type: 'set_layer_color', layer_id: 'golden-gray', rgba: [0.5, 0.5, 0.5, 1] },
        { type: 'set_layer_visibility', layer_id: 'golden-gray', visible: true },
      ],
    }, 5000);

    const before = await rpc.send('output_shared_texture', {}, 1000);
    const after = await waitForExportFrame(rpc, Number(before?.frame ?? 0));
    assert(after?.available === true, `golden fixture did not publish a native output export: ${JSON.stringify(after)}`);

    const outputSnapshot = await rpc.send('output_shared_texture_snapshot', { include_pixels: true }, 10000);
    const coreSnapshot = await rpc.send('frame_snapshot', { include_pixels: true, time: 0.5, frame_index: 15 }, 10000);

    assert(outputSnapshot?.format === coreSnapshot?.format, `snapshot formats differ: ${outputSnapshot?.format} != ${coreSnapshot?.format}`);
    assert(outputSnapshot?.width === coreSnapshot?.width && outputSnapshot?.height === coreSnapshot?.height, 'snapshot dimensions differ');
    assert(outputSnapshot?.color_space === 'srgb', 'output snapshot color_space is not srgb');
    assert(outputSnapshot?.storage_format === 'bgra8unorm', 'output snapshot storage_format is not bgra8unorm');
    assert(outputSnapshot?.single_render_source === 'core-output-composite', 'output snapshot source is not core-output-composite');

    const outputPixels = decodePixels(outputSnapshot, 'output shared texture snapshot');
    const corePixels = decodePixels(coreSnapshot, 'core frame snapshot');
    const diff = comparePixels(outputPixels, corePixels);
    assert(diff.mismatchCount === 0, `preview/output golden pixel mismatch: ${JSON.stringify(diff)}`);

    console.log(`native preview/output golden OK · ${WIDTH}x${HEIGHT} · checksum=${outputSnapshot.checksum} · maxDelta=${diff.maxDelta}`);
  } finally {
    const stderr = await rpc.close();
    if (stderr && process.env.GA_NATIVE_GOLDEN_VERBOSE === '1') {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
