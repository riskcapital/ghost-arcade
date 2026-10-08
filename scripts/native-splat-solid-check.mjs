/**
 * Point Cloud layer: occlusion proof and cost, on the real native core.
 *
 *   node scripts/native-splat-solid-check.mjs [--out <dir>] [--counts 500000,1500000] [--seconds 3]
 *
 * Builds a two-plane cloud: a small red plane near the camera and a large green
 * plane behind it. The green plane comes LAST in the buffer, which is the worst
 * case for an unsorted renderer: without depth writes it is painted over the
 * red one. Renders it through the same graph the app queues
 * (buildSplatNativeComputeGraph) with Solid Points off and on, reads the output
 * back, and checks pixels:
 *   - solid: the middle of the frame is red (the far plane does not show through)
 *   - solid: beside the near plane the far plane is still there (green)
 *   - soft:  the middle is green (documents what the old look does)
 * Then it measures GPU time per frame for each point count, soft and solid.
 * Exits non-zero when a pixel check fails.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = path.resolve(argValue('out', path.join(root, 'reports', 'splat-solid-check')));
const counts = argValue('counts', '500000,1500000').split(',').map(Number).filter((n) => n > 0);
const sampleSeconds = Number(argValue('seconds', '3'));
const width = 1920;
const height = 1080;
const executable = path.join(root, 'native-renderer', 'target', 'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');

const child = spawn(executable, [], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let stderrTail = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (text) => { stderrTail = (stderrTail + text).slice(-3000); });
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
function rpc(method, params = {}, timeoutMs = 30_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out: ${method}\n${stderrTail}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Near plane (red, 2x2 at z=+1) first, far plane (green, 4x4 at z=-1) last. */
function twoPlaneCloud(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const half = Math.floor(count / 2);
  const fill = (start, n, size, z, rgb) => {
    const side = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) {
      const o = (start + i) * 3;
      positions[o] = ((i % side) / (side - 1) - 0.5) * size;
      positions[o + 1] = (Math.floor(i / side) / (side - 1) - 0.5) * size;
      positions[o + 2] = z;
      colors[o] = rgb[0]; colors[o + 1] = rgb[1]; colors[o + 2] = rgb[2];
    }
  };
  fill(0, half, 2, 1, [1, 0, 0]);
  fill(half, count - half, 4, -1, [0, 1, 0]);
  return { positions, colors, sampleCount: count };
}

function pixelReader(snap) {
  const w = Number(snap.width), h = Number(snap.height);
  const stride = Number(snap.padded_bytes_per_row || snap.bytes_per_row || w * 4);
  const data = Buffer.from(String(snap.rgba_b64 || ''), 'base64');
  const bgra = /Bgra/i.test(String(snap.format || ''));
  /** Mean [r, g, b] of a box centred on (fx, fy), given as fractions of the frame. */
  return (fx, fy, radius = 6) => {
    const cx = Math.round(fx * (w - 1)), cy = Math.round(fy * (h - 1));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        const o = y * stride + x * 4;
        r += data[o + (bgra ? 2 : 0)]; g += data[o + 1]; b += data[o + (bgra ? 0 : 2)];
        n++;
      }
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };
}

let vite;
let failed = 0;
const report = { at: new Date().toISOString(), pixels: [], timing: [] };
mkdirSync(outDir, { recursive: true });
try {
  vite = await createServer({
    root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error',
    cacheDir: path.join(outDir, '.vite-cache'),
  });
  const splat = await vite.ssrLoadModule('/src/lib/renderer/splatNative.ts');
  const types = await vite.ssrLoadModule('/src/lib/types.ts');
  await rpc('start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width, height, target_fps: 120, native_quality_policy: 'fixed', present_mode: 'vsync', max_frame_latency: 1,
    },
  });
  await rpc('submit_commands', { commands: splat.buildSplatNativePrecompileCommands() }, 60_000);
  const compiled = await rpc('status');
  if (Number(compiled.shader_precompile_failed ?? 0) > 0) {
    throw new Error(`shader precompile failed: ${compiled.last_shader_error}`);
  }
  const fullFrame = {
    topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
  };
  let run = 0;
  for (const count of counts) {
    const packed = splat.packSplatNativePoints(twoPlaneCloud(count));
    const pointsB64 = splat.encodeSplatBufferBase64(packed.buffer);
    for (const solid of [false, true]) {
      run++;
      const layerId = `solid-check-${run}`;
      const sourceId = `gpu:solid-check-${run}:splat`;
      // The Point Size a scan with this spacing gets on import (it just closes
      // the gaps of the sparser, far plane), so the cost is a realistic one.
      const pointSize = splat.splatPointSizeForSpacing(4 / Math.sqrt(count / 2) * packed.norm, height);
      const content = {
        ...types.createDefaultSplatContent(), dataType: 'pointcloud', solidPoints: solid, pointSize,
        backgroundOpacity: 0, autoRotate: false,
      };
      let frame = 0;
      const graph = (withPoints) => ({
        type: 'queue_compute_graph',
        ...splat.buildSplatNativeComputeGraph({
          sourceId, content, pointCount: packed.pointCount, pointsBufferId: `splat:solid-check-${run}:points`,
          pointsB64: withPoints ? pointsB64 : null, width, height, time: 0, frameDelta: 1 / 60, frameIndex: ++frame,
        }).config,
      });
      await rpc('submit_commands', {
        commands: [
          { type: 'upsert_layer', layer_id: layerId, z_index: 0, opacity: 1, blend_mode: 'normal', corners: fullFrame },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          { type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri: `native-graph://${layerId}`, source_type: 'gpu:splat' },
          graph(true),
          { type: 'present' },
        ],
      }, 120_000);
      // Drive it the way the app does: one graph per frame.
      const gpu = [];
      const before = await rpc('status');
      const started = performance.now();
      const until = started + 1000 + sampleSeconds * 1000;
      while (performance.now() < until) {
        await rpc('submit_commands', { commands: [graph(false), { type: 'present' }] });
        if (performance.now() - started > 1000) {
          const s = await rpc('status');
          const ms = Number(s.last_render_gpu_ms || 0);
          if (ms > 0) gpu.push(ms);
        }
        await delay(4);
      }
      const after = await rpc('status');
      const error = String(after.last_shader_error || '');
      if (error && error !== String(before.last_shader_error || '')) throw new Error(`graph failed: ${error}`);
      gpu.sort((a, b) => a - b);
      const median = gpu.length ? gpu[Math.floor(gpu.length / 2)] : 0;
      const p90 = gpu.length ? gpu[Math.floor(gpu.length * 0.9)] : 0;
      report.timing.push({ points: count, solid, gpu_ms_median: +median.toFixed(3), gpu_ms_p90: +p90.toFixed(3), samples: gpu.length });
      console.log(`${String(count).padStart(8)} points  ${solid ? 'solid' : 'soft '}  gpu ${median.toFixed(3)} ms (p90 ${p90.toFixed(3)}, ${gpu.length} samples)`);

      const snap = await rpc('frame_snapshot', { include_pixels: true }, 30_000);
      const at = pixelReader(snap);
      const centre = at(0.5, 0.5);
      const beside = at(0.5, 0.245, 3); // above the near plane, still on the far one
      const corner = at(0.03, 0.5); // outside both planes
      if (args.includes('--debug')) {
        for (let y = 0.02; y < 1; y += 0.04) console.log(y.toFixed(2), at(0.5, y, 2).join(','), '|', at(y, 0.5, 2).join(','));
      }
      const row = { points: count, solid, pointSize, centre, beside, corner };
      const isRed = (c) => c[0] > 200 && c[1] < 80;
      const isGreen = (c) => c[1] > 200 && c[0] < 80;
      if (solid) {
        row.ok = isRed(centre) && isGreen(beside);
        if (!row.ok) failed++;
      } else {
        row.far_plane_shows_through = isGreen(centre);
      }
      report.pixels.push(row);
      console.log(`           centre rgb ${centre}  beside ${beside}  corner ${corner}${solid ? (row.ok ? '  PASS' : '  FAIL') : ''}`);
      await rpc('submit_commands', { commands: [{ type: 'remove_layer', layer_id: layerId }, { type: 'present' }] });
      await delay(200);
    }
  }
  // The one-time point upload must survive the core's coalescing. The app
  // queues a graph every frame; the core keeps only the newest pending graph
  // per source. When the graph that carries the points and the next one arrive
  // before the core renders, the upload used to be thrown away with the older
  // graph, and the layer stayed black for good.
  {
    const packed = splat.packSplatNativePoints(twoPlaneCloud(200_000));
    const layerId = 'solid-check-coalesce';
    const sourceId = 'gpu:solid-check-coalesce:splat';
    const content = { ...types.createDefaultSplatContent(), dataType: 'pointcloud', pointSize: 3, backgroundOpacity: 0, autoRotate: false };
    let frame = 0;
    const graph = (withPoints) => ({
      type: 'queue_compute_graph',
      ...splat.buildSplatNativeComputeGraph({
        sourceId, content, pointCount: packed.pointCount, pointsBufferId: 'splat:solid-check-coalesce:points',
        pointsB64: withPoints ? splat.encodeSplatBufferBase64(packed.buffer) : null, width, height, time: 0, frameDelta: 1 / 60, frameIndex: ++frame,
      }).config,
    });
    await rpc('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: layerId, z_index: 0, opacity: 1, blend_mode: 'normal', corners: fullFrame },
        { type: 'set_layer_visibility', layer_id: layerId, visible: true },
        { type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri: `native-graph://${layerId}`, source_type: 'gpu:splat' },
        graph(true), graph(false), graph(false),
        { type: 'present' },
      ],
    }, 60_000);
    for (let i = 0; i < 20; i++) { await rpc('submit_commands', { commands: [graph(false), { type: 'present' }] }); await delay(20); }
    const centre = pixelReader(await rpc('frame_snapshot', { include_pixels: true }, 30_000))(0.5, 0.5);
    const ok = centre[0] > 200;
    if (!ok) failed++;
    report.coalesce = { centre, ok };
    console.log(`upload followed at once by newer graphs: centre rgb ${centre}  ${ok ? 'PASS' : 'FAIL (points were dropped)'}`);
    await rpc('submit_commands', { commands: [{ type: 'remove_layer', layer_id: layerId }, { type: 'present' }] });
  }
  // Point Cloud FX, drawn by the core's own graph: the same two planes, Solid Points off and on.
  {
    const fx = await vite.ssrLoadModule('/src/lib/renderer/webgpuPointCloudFX.ts');
    await rpc('submit_commands', { commands: fx.buildPointCloudFXNativePrecompileCommands() }, 60_000);
    const cloud = twoPlaneCloud(200_000);
    report.pointCloudFx = [];
    for (const solid of [false, true]) {
      const pointData = fx.buildPointCloudFXNativePointData(cloud.positions, cloud.colors, { maxPoints: 200_000, signature: `solid-check-fx-${solid}`, pointSize: 0.012 });
      const layerId = `solid-check-fx-${solid}`;
      const b64 = (buffer) => Buffer.from(buffer).toString('base64');
      await rpc('submit_commands', {
        commands: [
          { type: 'upload_native_point_cloud', layer_id: layerId, signature: pointData.signature, point_count: pointData.pointCount, sort_count: pointData.sortCount,
            depth_sort_enabled: pointData.depthSortEnabled, home_b64: b64(pointData.homeInitialBuffer), live_b64: b64(pointData.liveInitialBuffer), sort_b64: b64(pointData.sortInitialBuffer) },
          { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: fullFrame },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          { type: 'set_native_graph_layer', layer_id: layerId, kind: 'point-cloud-fx', instrument_source_id: `${layerId}-output`, composite_source_id: `${layerId}-output`,
            input_source_id: null, effect_graph: null,
            params: { solidPoints: solid, pointSize: 0.012, windStrength: 0, audioReactive: false, colorMode: 'original', burstGain: 0, filterMode: 'none' } },
        ],
      }, 60_000);
      await delay(1500);
      const centre = pixelReader(await rpc('frame_snapshot', { include_pixels: true }, 30_000))(0.5, 0.5);
      const row = { solid, centre };
      // The instrument tints colours; what matters is which plane is on top (red = the near one).
      if (solid) { row.ok = centre[0] > 150 && centre[0] > centre[1] * 1.5; if (!row.ok) failed++; }
      else row.far_plane_shows_through = centre[1] > centre[0];
      report.pointCloudFx.push(row);
      console.log(`Point Cloud FX ${solid ? 'solid' : 'soft '}  centre rgb ${centre}${solid ? (row.ok ? '  PASS' : '  FAIL') : ''}`);
      await rpc('submit_commands', { commands: [{ type: 'remove_layer', layer_id: layerId }] });
      await delay(300);
    }
  }
  const status = await rpc('status');
  report.adapter = status.adapter_name;
  report.resolution = `${width}x${height}`;
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`${failed ? 'FAILED' : 'ALL PASSED'}  (${status.adapter_name})`);
} finally {
  await vite?.close().catch(() => {});
  await rpc('shutdown', {}, 2_000).catch(() => {});
  child.stdin.end();
}
process.exit(failed ? 1 : 0);
