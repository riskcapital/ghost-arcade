import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = process.cwd();
const localImport = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createNativeRendererBroker } = await localImport('electron/native-renderer-broker.js');
const broker = createNativeRendererBroker({ appRoot: root, platform: process.platform });
const blockedPipe = new Writable({ highWaterMark: 1024, write(_chunk, _encoding, _callback) {} });
broker.child = { stdin: blockedPipe };
const requests = Array.from({ length: 100 }, () => broker.send('submit_commands', { padding: 'x'.repeat(1024) }, { timeoutMs: 20 }).catch(() => {}));
await new Promise(r => setTimeout(r, 40));
await Promise.all(requests);
const results = { brokerBackpressure: { requests: 100, pendingAfterTimeout: broker.pending.size, bufferedBytesAfterTimeout: blockedPipe.writableLength, highWaterMark: blockedPipe.writableHighWaterMark } };
blockedPipe.destroy();
broker.child = null;

const child = spawn(path.join(root, 'native-renderer/target/release/ghost-render-core'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
let nextId = 1;
const pending = new Map();
child.stderr.on('data', chunk => process.stderr.write(chunk));
createInterface({ input: child.stdout }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const p = pending.get(m.id); if (!p) return;
  pending.delete(m.id); clearTimeout(p.timer);
  m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
});
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
const submit = commands => rpc('submit_commands', { commands });
const delay = ms => new Promise(r => setTimeout(r, ms));
const sample = s => ({ checksum: s.checksum, format: s.format, dark_frame: s.dark_frame, average_luma: s.average_luma, mean_rgba: s.mean_rgba, nonzero_pixels: s.nonzero_pixels, firstPixel: s.rgba_b64 ? [...Buffer.from(s.rgba_b64, 'base64').subarray(0, 4)] : null });
let vite;
try {
  const { createServer } = await localImport('node_modules/vite/dist/node/index.js');
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
  const fx = await vite.ssrLoadModule('/src/lib/renderer/nativeEffectPass.ts');
  const start = await rpc('start', { config: { backend: 'metal', width: 160, height: 90, target_fps: 60, native_quality_policy: 'performance' } });
  results.adapter = start.adapter_name;
  await submit(fx.buildNativeEffectPassPrecompileCommands());
  await submit([
    { type: 'upsert_layer', layer_id: 'review-color', z_index: 0, opacity: 1, blend_mode: 'normal', corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
    { type: 'set_layer_color', layer_id: 'review-color', rgba: [0.2, 0.4, 0.6, 1] },
  ]);
  const graph = fx.buildCompositeEffectPassChainGraph({ sourceId: 'composite-frame:0', targetSourceId: 'composite-frame:1', effects: [{ effect: 'invert', amount: 1, mix: 1, params: {} }], width: 160, height: 90, time: 0, frameIndex: 0, seq: 1 });
  const queue = { type: 'queue_compute_graph', ...graph.config };
  await submit([queue]);
  await delay(150);
  results.withInvert = { output: sample(await rpc('output_shared_texture_snapshot', { include_pixels: true })), snapshot: sample(await rpc('frame_snapshot', { include_pixels: true })) };
  await submit([{ type: 'set_output_state', blackout: true }, { type: 'present' }]);
  await delay(150);
  results.blackoutWithInvert = sample(await rpc('output_shared_texture_snapshot', { include_pixels: true }));
  await submit([{ type: 'clear_composite_graph' }, { type: 'present' }]);
  await delay(150);
  results.blackoutWithoutInvert = sample(await rpc('output_shared_texture_snapshot', { include_pixels: true }));
  await submit([{ type: 'set_output_state', blackout: false }]);
  await submit([{ type: 'set_slice_outputs', slices: [{ id: 'review-slice', width: 160, height: 90 }] }, { type: 'present' }]);
  await delay(150);
  results.sliceCleanup = { before: await rpc('slice_output_state') };
  await submit([{ type: 'set_slice_outputs', slices: [] }, { type: 'present' }]);
  await delay(150);
  results.sliceCleanup.afterRemove = await rpc('slice_output_state');
  await submit([{ type: 'set_metadata_cache_caps', pipeline_metadata_cache_cap: 2 }]);
  const precompile = fx.buildNativeEffectPassPrecompileCommands()[0];
  const count = async () => { await delay(80); return (await rpc('status')).pipeline_cache_entries; };
  results.pipelineVariants = { before: await count(), samples: [] };
  for (let i = 0; i < 8; i++) {
    await submit([{ ...precompile, source: precompile.source + `\n// review variant ${i}\n` }, queue, { type: 'present' }]);
    results.pipelineVariants.samples.push(await count());
  }
  await submit([{ type: 'clear_composite_graph' }, { type: 'remove_layer', layer_id: 'review-color' }, { type: 'present' }]);
  results.pipelineVariants.afterRemove = await count();
  await submit([{ type: 'set_command_drain_policy', command_drain_limit: 2 }]);
  results.commandDrain = await submit(Array.from({ length: 10 }, () => ({ type: 'set_layer_color', layer_id: 'review-color', rgba: [0, 0, 0, 1] })));
  if (process.argv.includes('--perf')) {
    const layer = i => ({ type: 'upsert_layer', layer_id: `perf-${i}`, z_index: i, opacity: 0.6, blend_mode: 'normal', corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } });
    await submit([{ type: 'set_output', width: 1920, height: 1080 }, layer(0), { type: 'set_layer_color', layer_id: 'perf-0', rgba: [0.2, 0.4, 0.6, 1] }]);
    const workloads = [];
    async function measure(label, readback = false) {
      await delay(1000);
      const before = await rpc('status');
      const started = performance.now();
      const readbackMs = [];
      while (performance.now() - started < 4000) {
        if (readback) {
          const t = performance.now();
          await rpc('output_shared_texture_snapshot', { include_pixels: false });
          readbackMs.push(performance.now() - t);
          await delay(Math.max(0, 1000 / 30 - (performance.now() - t)));
        } else await delay(200);
      }
      const after = await rpc('status');
      const seconds = (performance.now() - started) / 1000;
      workloads.push({ label, seconds, completedFps: (after.gpu_frames_completed - before.gpu_frames_completed) / seconds, backpressureSkips: after.gpu_backpressure_skips - before.gpu_backpressure_skips, cpuEmaMs: after.avg_render_cpu_ms, gpuEmaMs: after.avg_render_gpu_ms, sourceFrameSize: after.source_frame_size, quality: after.native_quality, readbackCount: readbackMs.length, readbackMaxMs: Math.max(0, ...readbackMs), readbackMeanMs: readbackMs.reduce((a,b) => a+b, 0) / Math.max(1, readbackMs.length), lastError: after.last_frame_error });
    }
    await measure('1080p / 1 translucent layer / 60fps target');
    await submit(Array.from({ length: 15 }, (_, i) => layer(i + 1)));
    await measure('1080p / 16 translucent layers');
    const perfGraph = fx.buildCompositeEffectPassChainGraph({ sourceId: 'composite-frame:0', targetSourceId: 'composite-frame:1', effects: ['blur', 'invert', 'pixelate', 'brightness'].map(effect => ({ effect, amount: 0.6, mix: 1, params: {} })), width: 1920, height: 1080, time: 0, frameIndex: 0, seq: 100 });
    await submit([{ type: 'queue_compute_graph', ...perfGraph.config }]);
    await measure('1080p / 16 layers / 4 composition FX');
    await measure('same + 30Hz full-output readback', true);
    await submit([{ type: 'set_slice_outputs', slices: [{ id: 'perf-a', width: 1920, height: 1080 }, { id: 'perf-b', width: 1920, height: 1080 }] }]);
    await measure('same / no readback / 2 extra 1080p slices');
    results.workloads = workloads;
  }
  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync('/tmp/ghost-native-review-probe-results.json', JSON.stringify(results, null, 2));
} finally {
  await vite?.close();
  await rpc('shutdown').catch(() => {});
  child.kill();
  for (const p of pending.values()) clearTimeout(p.timer);
}
