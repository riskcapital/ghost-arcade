// Frames in flight: the core lets the CPU prepare the next frame while the
// GPU draws the current one (GA_CORE_MAX_FRAMES_IN_FLIGHT, default 2). With
// one in flight CPU and GPU time added up per frame; with two a frame costs
// the larger of the two. This runs the same GPU-heavy scene, offscreen, with
// 1 and 2 in flight and checks the queue stays bounded and the output keeps
// advancing. GA_CORE_FIF_BENCH=1 prints frame rate and latency for both.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform, softwareVulkanRunner } from './nativeHardwareTestPlatform';

type Command = Record<string, unknown>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const bench = process.env.GA_CORE_FIF_BENCH === '1';
const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

function core(framesInFlight: number) {
  const child = spawn(platform.binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GA_CORE_MAX_FRAMES_IN_FLIGHT: String(framesInFlight) },
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
    } catch { /* non-JSON core output */ }
  });
  const send = (method: string, params: Command = {}, timeoutMs = 20000): Promise<any> => {
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
  return {
    send,
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}

// A per-pixel loop heavy enough to keep the GPU busy for several ms a frame.
const shader = (seed: number, iterations: number) => `/*{"ISFVSN":"2","INPUTS":[]}*/
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
  vec3 acc = vec3(0.0);
  vec2 p = uv * 3.0 + vec2(${seed}.0 * 0.37, TIME * 0.1);
  for (int i = 0; i < ${iterations}; i++) {
    p = vec2(sin(p.y * 1.7 + float(i) * 0.01), cos(p.x * 1.3 - TIME * 0.05)) * 1.02 + uv;
    acc += abs(vec3(p.x, p.y, p.x * p.y)) * 0.002;
  }
  gl_FragColor = vec4(fract(acc), 0.25);
}`;

type Sample = { fps: number; latencyMs: number; latencyMaxMs: number; cpuMs: number; gpuMs: number; maxQueued: number; skips: number };

async function measure(framesInFlight: number): Promise<Sample> {
  const width = envNumber('GA_CORE_FIF_WIDTH', 1920);
  const height = envNumber('GA_CORE_FIF_HEIGHT', 1080);
  const layers = envNumber('GA_CORE_FIF_LAYERS', 1);
  // Layers with no source: CPU work per frame (layer upload, tiling) at
  // little GPU cost.
  const plainLayers = Number(process.env.GA_CORE_FIF_PLAIN_LAYERS ?? (softwareVulkanRunner ? 8 : 400)) || 0;
  const iterations = envNumber('GA_CORE_FIF_ITERATIONS', softwareVulkanRunner ? 4 : 40);
  const targetFps = envNumber('GA_CORE_FIF_TARGET_FPS', 60);
  const seconds = envNumber('GA_CORE_FIF_SECONDS', bench ? 5 : 1.5);
  const rpc = core(framesInFlight);
  try {
    await rpc.send('start', { config: {
      backend: platform.rendererBackend, width, height, target_fps: targetFps, native_quality_policy: 'fixed',
    } });
    const commands: Command[] = [];
    for (let layer = 0; layer < layers; layer++) {
      const shaderId = `fif-shader-${layer}`;
      const layerId = `fif-layer-${layer}`;
      commands.push(
        { type: 'precompile_shader', shader_id: shaderId, stage: 'pixel', entry: 'main', source: shader(layer, iterations) },
        { type: 'upsert_layer', layer_id: layerId, z_index: layer, opacity: 1, blend_mode: 'add',
          corners: { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } } },
        { type: 'set_layer_visibility', layer_id: layerId, visible: true },
        { type: 'bind_isf_shader', layer_id: layerId, shader_id: shaderId },
        { type: 'update_isf_uniforms', shader_id: shaderId, time: 0, time_delta: 1 / targetFps, frame_index: 0,
          render_width: width, render_height: height, float_inputs: {}, point_inputs: {}, color_inputs: {} },
      );
    }
    for (let layer = 0; layer < plainLayers; layer++) {
      const layerId = `fif-plain-${layer}`;
      const x = (layer % 16) / 16;
      const y = Math.floor(layer / 16) % 16 / 16;
      commands.push(
        { type: 'upsert_layer', layer_id: layerId, z_index: layers + layer, opacity: 0.5, blend_mode: 'normal',
          corners: { topLeft: { x, y }, topRight: { x: x + 0.1, y }, bottomRight: { x: x + 0.1, y: y + 0.1 }, bottomLeft: { x, y: y + 0.1 } } },
        { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      );
    }
    await rpc.send('submit_commands', { commands });
    let status = await rpc.send('status');
    expect(status.max_frames_in_flight).toBe(framesInFlight);
    // Warm up: pipelines compiled and the frame loop at its steady rate.
    const warmUntil = Date.now() + 15000;
    let warmed = 0;
    while (Date.now() < warmUntil) {
      await sleep(100);
      status = await rpc.send('status');
      if (status.gpu_frames_completed > 30 && ++warmed >= 10) break;
    }
    expect(status.gpu_frames_completed).toBeGreaterThan(30);
    const before = status;
    const started = performance.now();
    let maxQueued = 0;
    let cpuSum = 0;
    let gpuSum = 0;
    let reads = 0;
    while (performance.now() - started < seconds * 1000) {
      await sleep(25);
      const now = await rpc.send('status');
      maxQueued = Math.max(maxQueued, now.gpu_frames_submitted - now.gpu_frames_completed);
      cpuSum += now.avg_render_cpu_ms;
      gpuSum += now.avg_render_gpu_ms;
      reads++;
      status = now;
    }
    const elapsed = (performance.now() - started) / 1000;
    const after = status;
    const frames = after.gpu_frames_completed - before.gpu_frames_completed;
    const latencySamples = after.gpu_frame_latency.samples - before.gpu_frame_latency.samples;
    return {
      fps: frames / elapsed,
      latencyMs: latencySamples > 0 ? (after.gpu_frame_latency.sum_ms - before.gpu_frame_latency.sum_ms) / latencySamples : 0,
      latencyMaxMs: after.gpu_frame_latency.max_ms,
      cpuMs: cpuSum / Math.max(1, reads),
      gpuMs: gpuSum / Math.max(1, reads),
      maxQueued,
      skips: after.gpu_backpressure_skips - before.gpu_backpressure_skips,
    };
  } finally {
    await rpc.close();
  }
}

const suite = platform.runnable ? describe : describe.skip;
suite('Native frames in flight', () => {
  it('keeps at most the configured frames queued and keeps drawing with 1 and 2 in flight', async () => {
    // Benchmark runs go 1, 2, 2, 1 so warm-up and heat do not favour one.
    const order = bench ? [1, 2, 2, 1] : [1, 2];
    const runs: Array<[number, Sample]> = [];
    for (const n of order) runs.push([n, await measure(n)]);
    const average = (n: number): Sample => {
      const of = runs.filter(([k]) => k === n).map(([, s]) => s);
      const mean = (key: keyof Sample) => of.reduce((sum, s) => sum + s[key], 0) / of.length;
      return { fps: mean('fps'), latencyMs: mean('latencyMs'), latencyMaxMs: Math.max(...of.map(s => s.latencyMaxMs)),
        cpuMs: mean('cpuMs'), gpuMs: mean('gpuMs'), maxQueued: Math.max(...of.map(s => s.maxQueued)), skips: mean('skips') };
    };
    const one = average(1);
    const two = average(2);
    if (bench) {
      const row = (n: number, s: Sample) => `  ${n} in flight: ${s.fps.toFixed(1)} fps, latency ${s.latencyMs.toFixed(2)} ms (session max ${s.latencyMaxMs.toFixed(1)}), cpu ${s.cpuMs.toFixed(2)} ms, gpu ${s.gpuMs.toFixed(2)} ms, max queued ${s.maxQueued}, backpressure skips ${s.skips.toFixed(0)}`;
      console.log(`frames in flight benchmark\n${row(1, one)}\n${row(2, two)}\n  runs: ${runs.map(([n, s]) => `${n}:${s.fps.toFixed(1)}`).join(' ')}`);
    }
    // The queue never grows past the setting: the output is never more
    // than that many frames behind the newest one.
    expect(one.maxQueued).toBeLessThanOrEqual(1);
    expect(two.maxQueued).toBeLessThanOrEqual(2);
    expect(one.fps).toBeGreaterThan(0);
    expect(two.fps).toBeGreaterThan(0);
  }, 120000);
});
