import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(
  root,
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

const child = spawn(executable, [], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, RUST_BACKTRACE: '1' },
});
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.ok) waiter.resolve(message.result);
  else waiter.reject(new Error(message.error || 'native RPC failed'));
});

function rpc(method, params = {}, timeoutMs = 10_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let vite;

async function measureWorkload(label, warmupMs = 1_000, sampleMs = 5_000) {
  await delay(warmupMs);
  const before = await rpc('status');
  const started = performance.now();
  await delay(sampleMs);
  const after = await rpc('status');
  const elapsed = (performance.now() - started) / 1000;
  const submittedFrames =
    Number(after.gpu_frames_submitted || 0) - Number(before.gpu_frames_submitted || 0);
  const completedFrames =
    Number(after.gpu_frames_completed || 0) - Number(before.gpu_frames_completed || 0);
  const backpressureSkips =
    Number(after.gpu_backpressure_skips || 0) - Number(before.gpu_backpressure_skips || 0);
  return {
    workload: label,
    completed_fps: Number((completedFrames / elapsed).toFixed(1)),
    avg_cpu_ms: Number(Number(after.avg_render_cpu_ms || 0).toFixed(3)),
    last_gpu_ms: Number(Number(after.last_render_gpu_ms || 0).toFixed(3)),
    avg_gpu_ms: Number(Number(after.avg_render_gpu_ms || 0).toFixed(3)),
    gpu_samples: Number(after.gpu_timing_samples || 0),
    submitted_frames: submittedFrames,
    completed_frames: completedFrames,
    backpressure_skips: backpressureSkips,
  };
}

try {
  await rpc('start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width: 1920,
      height: 1080,
      target_fps: 120,
      native_quality_policy: 'fixed',
      present_mode: 'vsync',
      max_frame_latency: 1,
    },
  }, 20_000);
  await rpc('submit_commands', {
    commands: [
      {
        type: 'upsert_layer',
        layer_id: 'perf-color',
        z_index: 0,
        blend_mode: 'normal',
        opacity: 1,
        corners: {
          topLeft: { x: 0, y: 1 },
          topRight: { x: 1, y: 1 },
          bottomRight: { x: 1, y: 0 },
          bottomLeft: { x: 0, y: 0 },
        },
      },
      { type: 'set_layer_color', layer_id: 'perf-color', rgba: [0.1, 0.65, 1, 1] },
      { type: 'set_layer_visibility', layer_id: 'perf-color', visible: true },
    ],
  });

  const compositor = await measureWorkload('one-layer-compositor');

  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
  const planetModule = await vite.ssrLoadModule('/src/lib/renderer/shaders/webgpuPlanet.ts');
  const planetShader = planetModule.getPlanetNativeShaderSource();
  await rpc('submit_commands', {
    commands: [
      { type: 'remove_layer', layer_id: 'perf-color' },
      {
        type: 'precompile_shader',
        shader_id: planetShader.shaderId,
        stage: planetShader.stage,
        entry: planetShader.entry,
        source: planetShader.source,
      },
      {
        type: 'set_native_graph_layer',
        layer_id: 'perf-planet',
        kind: 'planet',
        source_id: 'native-graph://planet/perf',
        params: { planet: 'earth' },
      },
    ],
  }, 20_000);
  const planet = await measureWorkload('planet-native-graph', 2_000, 5_000);
  const after = await rpc('status');
  const result = {
    backend: after.backend,
    adapter: after.adapter_name,
    resolution: `${after.output_width}x${after.output_height}`,
    quality: `${after.native_quality?.active_tier}@${after.native_quality?.quality_scale}`,
    target_fps: after.target_fps,
    workloads: [compositor, planet],
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await vite?.close().catch(() => {});
  await rpc('shutdown', {}, 2_000).catch(() => {});
  child.stdin.end();
}
