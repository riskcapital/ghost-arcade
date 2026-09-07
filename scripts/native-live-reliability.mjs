import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

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

const child = spawn(path.join(root, 'native-renderer/target/release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  const start = await rpc('start', { config: { backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan', width: 160, height: 90, target_fps: 60, native_quality_policy: 'performance' } });
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
  const warmDeadline = Date.now() + 3000;
  let warmedOutput = await rpc('output_shared_texture_snapshot', { include_pixels: true });
  while (warmedOutput.average_luma < 0.7 && Date.now() < warmDeadline) {
    await delay(25);
    warmedOutput = await rpc('output_shared_texture_snapshot', { include_pixels: true });
  }
  assert.ok(warmedOutput.average_luma > 0.7, 'invert pipeline never became ready');
  results.withInvert = { output: sample(warmedOutput), snapshot: sample(await rpc('frame_snapshot', { include_pixels: true })) };
  const capturePath = path.join(os.tmpdir(), `ghost-live-reliability-capture-${process.pid}.rgba`);
  const capture = rpc('export_frame_snapshot', { source: 'output', path: capturePath });
  await submit([{ type: 'set_output_state', blackout: true }, { type: 'present' }]);
  results.capture = await capture;
  assert.equal(results.capture.checksum, results.withInvert.output.checksum);
  assert.equal(fs.statSync(capturePath).size, 160 * 90 * 4);
  fs.unlinkSync(capturePath);
  await delay(150);
  results.blackoutWithInvert = sample(await rpc('output_shared_texture_snapshot', { include_pixels: true }));
  await submit([{ type: 'set_output_state', frozen: true, blackout: true }, { type: 'present' }]);
  await delay(100);
  results.frozenBlackout = sample(await rpc('output_shared_texture_snapshot', { include_pixels: true }));
  await submit([{ type: 'set_output_state', frozen: false }]);
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
  await assert.rejects(submit(Array.from({ length: 10 }, () => ({ type: 'set_layer_color', layer_id: 'review-color', rgba: [0, 0, 0, 1] }))), /No commands applied/);
  results.commandDrain = { rejectedAtomically: true };
  await submit([{ type: 'set_command_drain_policy', command_drain_limit: 1024 }, { type: 'set_metadata_cache_caps', pipeline_metadata_cache_cap: 512 }]);
  const churnCount = Number(process.argv.find(arg => arg.startsWith('--churn='))?.split('=')[1] || 0);
  const soakSeconds = Number(process.argv.find(arg => arg.startsWith('--soak-seconds='))?.split('=')[1] || 0);
  if (!Number.isInteger(churnCount) || churnCount < 0 || churnCount > 100000 || !Number.isFinite(soakSeconds) || soakSeconds < 0 || soakSeconds > 86400) {
    throw new Error('Use --churn=0..100000 and --soak-seconds=0..86400');
  }
  if (churnCount || soakSeconds) {
    results.endurance = { churnCount, soakSeconds, samples: [] };
    await submit([{ type: 'set_metadata_cache_caps', pipeline_metadata_cache_cap: 8 },
      { type: 'upsert_layer', layer_id: 'review-color', opacity: 1 },
      { type: 'set_layer_color', layer_id: 'review-color', rgba: [0.2, 0.4, 0.6, 1] }]);
    const sampleResources = async iteration => {
      const stats = await rpc('stats');
      const status = await rpc('status');
      let rssKiB = null;
      if (process.platform !== 'win32') {
        rssKiB = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).trim());
      }
      assert.ok(status.pipeline_cache_entries <= 8, 'pipeline cache exceeded its endurance budget');
      const output = await rpc('output_shared_texture_snapshot', { include_pixels: false });
      const previous = results.endurance.samples.at(-1);
      if (previous && iteration > previous.iteration) {
        assert.ok(status.gpu_frames_submitted > previous.submittedFrames, 'program stopped presenting during shader churn');
        assert.notEqual(output.checksum, previous.outputChecksum, 'unrelated color layer stopped updating during shader churn');
      }
      results.endurance.samples.push({ iteration, at: Date.now(), rssKiB, outputChecksum: output.checksum, submittedFrames: status.gpu_frames_submitted, pipelines: status.pipeline_cache_entries,
        resources: stats.live_resources, submissionIntervals: stats.submission_intervals, lastError: status.last_frame_error });
    };
    for (let i = 0; i < churnCount; i++) {
      await submit([{ ...precompile, source: precompile.source + `\n// endurance revision ${i}\n` }, queue,
        { type: 'set_layer_color', layer_id: 'review-color', rgba: [0.1 + (i % 3) * 0.25, 0.4, 0.6, 1] },
        { type: 'set_slice_outputs', slices: i % 2 ? [] : [{ id: 'churn-slice', width: 160, height: 90 }] }]);
      await delay(60);
      if (i % 20 === 0) await sampleResources(i);
      if (i % 100 === 0) console.error(`Endurance: ${i}/${churnCount} revisions`);
    }
    await submit([{ type: 'set_slice_outputs', slices: [] }]);
    assert.deepEqual((await rpc('slice_output_state')).slices, []);
    const end = performance.now() + soakSeconds * 1000;
    while (performance.now() < end) {
      await delay(Math.min(5000, end - performance.now()));
      await sampleResources(churnCount);
    }
    await sampleResources(churnCount);
    await submit([{ type: 'clear_composite_graph' }, { type: 'remove_layer', layer_id: 'review-color' },
      { type: 'set_metadata_cache_caps', pipeline_metadata_cache_cap: 512 }]);
  }
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
  assert.equal(results.brokerBackpressure.pendingAfterTimeout, 0);
  assert.ok(results.brokerBackpressure.bufferedBytesAfterTimeout < 2048);
  assert.deepEqual(results.withInvert.output, results.withInvert.snapshot);
  assert.equal(results.blackoutWithInvert.nonzero_pixels, 0);
  assert.equal(results.frozenBlackout.nonzero_pixels, 0);
  assert.deepEqual(results.sliceCleanup.afterRemove.slices, []);
  assert.ok(results.pipelineVariants.samples.every(n => n <= 2), 'pipeline variants must respect cap');
  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(os.tmpdir(), 'ghost-native-live-reliability-results.json'), JSON.stringify(results, null, 2));
} finally {
  await vite?.close();
  await rpc('shutdown').catch(() => {});
  child.kill();
  for (const p of pending.values()) clearTimeout(p.timer);
}
