// Runtime gate for the native plugin graphs: compiles every plugin shader
// through the real render core (naga validation, not string checks) and runs
// the GhostFX Liquid scene end-to-end for several simulated frames, asserting
// the fluid is actually VISIBLE and SHADED — the regression class behind
// "liquid barely shows anything".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildNativePluginGraph,
  buildNativePluginPrecompileCommands,
  type NativePluginGraphState,
} from './nativePluginGraphs';

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer/target/release/ghost-render-core',
);
const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;

type Rpc = {
  send: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
  close: () => void;
};

function createRpc(): Rpc {
  const child: ChildProcessWithoutNullStreams = spawn(nativeCoreBin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume(); // drain, never block the core on stderr
  const rl = createInterface({ input: child.stdout });
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  let nextId = 1;
  rl.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id)!;
        pending.delete(message.id);
        if (message.error) entry.rej(new Error(JSON.stringify(message.error)));
        else entry.res(message.result);
      }
    } catch {
      /* non-JSON core output */
    }
  });
  return {
    send(method, params = {}, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`native core RPC timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, {
          res: (v) => {
            clearTimeout(timer);
            res(v);
          },
          rej: (e) => {
            clearTimeout(timer);
            rej(e);
          },
        });
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    close() {
      try {
        child.stdin.write(JSON.stringify({ id: nextId++, method: 'shutdown', params: {} }) + '\n');
      } catch {
        /* already gone */
      }
      child.kill();
    },
  };
}

describe('native plugin graphs (runtime, real core)', () => {
  let rpc: Rpc | null = null;

  beforeAll(async () => {
    if (!existsSync(nativeCoreBin)) return;
    rpc = createRpc();
    const started = await rpc.send('start', {
      config: { width: 320, height: 180, source_frame_size: 512, target_fps: 60 },
    });
    expect(started?.backend_ready).toBe(true);
  });

  afterAll(() => {
    rpc?.close();
  });

  itIfNativeCore('compiles every plugin shader through the core with zero failures', async () => {
    await rpc!.send('submit_commands', { commands: buildNativePluginPrecompileCommands() });
    // Precompiles drain through the per-frame queue; poll until settled.
    const expected = buildNativePluginPrecompileCommands().length;
    let status: any = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = await rpc!.send('status');
      const done =
        Number(status.shader_precompile_compiled ?? 0) +
        Number(status.shader_precompile_failed ?? 0);
      if (done >= expected) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(
      Number(status.shader_precompile_failed ?? -1),
      String(status.last_shader_error ?? ''),
    ).toBe(0);
    expect(Number(status.shader_precompile_compiled ?? 0)).toBeGreaterThanOrEqual(expected);
  }, 30000);

  itIfNativeCore('renders an original Performer world as a visible native overlay', async () => {
    const layerId = 'performer-world-runtime';
    const sourceId = 'plugin:performer-world:A:0';
    const built = buildNativePluginGraph({
      kind: 'performer-world',
      sourceId,
      params: {
        performerWorldIndex: 7,
        performerWorldSpace: 3,
        performerWorldX: 0.72,
        performerWorldY: 0.38,
        performerWorldPointerDown: true,
        performerWorldParams: [0.65, 0.55, 0.7, 0.6, 0.75, 0.5],
        performerWorldPump: 0.4,
      },
      width: 320,
      height: 180,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 60,
      audio: {
        active: true,
        bass: 0.7,
        mid: 0.45,
        treble: 0.3,
        energy: 0.65,
        beatPhase: 0.25,
        beatPulse: 0.4,
        amplitude: 0.55,
      },
      reset: true,
    });

    await rpc!.send('submit_commands', {
      commands: [
        {
          type: 'upsert_layer',
          layer_id: layerId,
          z_index: 0,
          opacity: 1,
          blend_mode: 'add',
          corners: {
            topLeft: { x: 0, y: 0 },
            topRight: { x: 1, y: 0 },
            bottomRight: { x: 1, y: 1 },
            bottomLeft: { x: 0, y: 1 },
          },
        },
        { type: 'set_layer_visibility', layer_id: layerId, visible: true },
        {
          type: 'set_native_graph_layer',
          layer_id: layerId,
          kind: 'performer-world',
          instrument_source_id: sourceId,
          composite_source_id: sourceId,
          input_source_id: null,
          effect_graph: built.config,
          params: {
            performerWorldIndex: 7,
            performerWorldSpace: 3,
            performerWorldX: 0.72,
            performerWorldY: 0.38,
            performerWorldPointerDown: true,
            performerWorldParams: [0.65, 0.55, 0.7, 0.6, 0.75, 0.5],
            performerWorldPump: 0.4,
          },
        },
        {
          type: 'bind_media_source',
          layer_id: layerId,
          source_id: sourceId,
          uri: 'plugin://performer-world',
          source_type: 'video',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    const snapshot = await rpc!.send('frame_snapshot', { include_pixels: false });
    const status = await rpc!.send('status');
    expect(
      Number(status.shader_precompile_failed ?? -1),
      String(status.last_shader_error ?? status.last_frame_error ?? ''),
    ).toBe(0);
    expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(320 * 180 * 0.01);
    expect(Number(snapshot.max_luma ?? 0)).toBeGreaterThan(0.05);
  }, 30000);

  itIfNativeCore('renders GhostFX Liquid visibly with specular highlights', async () => {
    const sourceId = 'plugin:layer:ghostfx';
    await rpc!.send('submit_commands', {
      commands: [
        {
          type: 'upsert_layer',
          layer_id: 'plugin-liquid',
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
        { type: 'set_layer_visibility', layer_id: 'plugin-liquid', visible: true },
      ],
    });

    // Install the plugin graph exactly the way the app does: as a persistent
    // template on a native graph layer. The core then re-runs it EVERY frame
    // itself, regenerating audio uniforms and liquid splats in Rust — this is
    // the path that was broken ("liquid barely shows anything": the template's
    // frame-zero splats replayed forever).
    const built = buildNativePluginGraph({
      kind: 'ghostfx',
      sourceId,
      params: { ghostfxScenePreset: 'liquid' },
      width: 320,
      height: 180,
      time: 0,
      frameDelta: 1 / 60,
      frameIndex: 0,
      audio: {
        active: true,
        bass: 0.7,
        mid: 0.45,
        treble: 0.3,
        energy: 0.6,
        beatPhase: 0,
        beatPulse: 0.1,
        amplitude: 0.5,
      },
      reset: true,
    });
    await rpc!.send('submit_commands', {
      commands: [
        {
          type: 'set_audio_state',
          audio0: [0.6, 0.7, 0.45, 0.3],
          audio1: [0.2, 0.1, 0.25, 120],
          audio2: [0.5, 0.4, 0.2, 1],
        },
        {
          type: 'set_native_graph_layer',
          layer_id: 'plugin-liquid',
          kind: 'ghostfx',
          instrument_source_id: sourceId,
          composite_source_id: sourceId,
          input_source_id: null,
          effect_graph: built.config,
          params: { ghostfxScenePreset: 'liquid' },
        },
      ],
    });
    // Let the core simulate a couple of seconds of fluid on its own frame
    // cadence, with a real beat edge mid-run (rising pulse fires the native
    // vortex-ring burst in native_plugin_graph_frame_job).
    await new Promise((resolve) => setTimeout(resolve, 900));
    await rpc!.send('submit_commands', {
      commands: [
        { type: 'set_audio_state', audio0: [0.9, 0.95, 0.6, 0.4], audio1: [0.3, 0.95, 0.5, 120], audio2: [0.5, 0.8, 0.3, 1] },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await rpc!.send('submit_commands', {
      commands: [
        { type: 'set_audio_state', audio0: [0.6, 0.7, 0.45, 0.3], audio1: [0.2, 0.1, 0.7, 120], audio2: [0.5, 0.4, 0.2, 1] },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    // Bind the plugin's rendered source frame to the layer and read back.
    await rpc!.send('submit_commands', {
      commands: [
        {
          type: 'bind_media_source',
          layer_id: 'plugin-liquid',
          source_id: sourceId,
          uri: 'plugin://ghostfx',
          source_type: 'video',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const snapshot = await rpc!.send('frame_snapshot', { include_pixels: false });
    const status = await rpc!.send('status');
    // eslint-disable-next-line no-console
    console.log('[liquid-runtime-graph-keys]', JSON.stringify(
      Object.fromEntries(Object.entries(status).filter(([k]) => /graph|frame_index|frames_presented/.test(k))),
    ));
    // Execution diagnostics — visible in the failure output.
    // eslint-disable-next-line no-console
    console.log('[liquid-runtime]', JSON.stringify({
      graphRuns: status.compute_graph_runs,
      graphPasses: status.compute_graph_passes,
      renderPasses: status.compute_graph_render_passes,
      sourceFrameRenders: status.compute_graph_source_frame_renders,
      persistentBuffers: status.compute_graph_persistent_buffers,
      framesActive: status.source_frames_active,
      lastError: status.last_frame_error ?? null,
      presentResult: status.swapchain_last_present_result,
      presentError: status.swapchain_last_present_error,
      validationErrors: status.swapchain_present_validation_errors,
      backpressureSkips: status.gpu_backpressure_skips,
      autoFrames: status.frames_presented_auto,
      explicitFrames: status.frames_presented_explicit,
      snapshotRenders: status.frame_snapshot_reads,
      shaderError: status.last_shader_error ?? null,
      nonzero: snapshot.nonzero_pixels,
      meanLuma: snapshot.average_luma,
      maxLuma: snapshot.max_luma,
    }));
    expect(Number(status.shader_precompile_failed ?? -1), String(status.last_shader_error ?? '')).toBe(0);
    // Visible: a healthy pool covers a meaningful share of the frame.
    expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(320 * 180 * 0.05);
    expect(Number(snapshot.average_luma ?? 0)).toBeGreaterThan(0.01);
    // Shaded: glossy speculars push HDR pixels toward white — the old flat
    // dye render never produced bright pixels without loud audio.
    expect(Number(snapshot.max_luma ?? 0)).toBeGreaterThan(0.35);
  }, 60000);

  itIfNativeCore('renders GhostFX Spheres visibly with shaded orbs', async () => {
    const sourceId = 'plugin:layer:ghostfx-spheres';
    await rpc!.send('submit_commands', {
      commands: [
        {
          type: 'upsert_layer',
          layer_id: 'plugin-spheres',
          z_index: 1,
          opacity: 1,
          blend_mode: 'normal',
          corners: {
            topLeft: { x: 0, y: 0 },
            topRight: { x: 1, y: 0 },
            bottomRight: { x: 1, y: 1 },
            bottomLeft: { x: 0, y: 1 },
          },
        },
        { type: 'set_layer_visibility', layer_id: 'plugin-spheres', visible: true },
      ],
    });
    const built = buildNativePluginGraph({
      kind: 'ghostfx',
      sourceId,
      params: { ghostfxScenePreset: 'spheres' },
      width: 320,
      height: 180,
      time: 0,
      frameDelta: 1 / 60,
      frameIndex: 0,
      audio: {
        active: true,
        bass: 0.7,
        mid: 0.45,
        treble: 0.3,
        energy: 0.6,
        beatPhase: 0,
        beatPulse: 0.1,
        amplitude: 0.5,
      },
      reset: true,
    });
    await rpc!.send('submit_commands', {
      commands: [
        {
          type: 'set_native_graph_layer',
          layer_id: 'plugin-spheres',
          kind: 'ghostfx',
          instrument_source_id: sourceId,
          composite_source_id: sourceId,
          input_source_id: null,
          effect_graph: built.config,
          params: { ghostfxScenePreset: 'spheres' },
        },
      ],
    });
    // Give the flow field time to scatter and settle the orb pool.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await rpc!.send('submit_commands', {
      commands: [
        {
          type: 'bind_media_source',
          layer_id: 'plugin-spheres',
          source_id: sourceId,
          uri: 'plugin://ghostfx',
          source_type: 'video',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const snapshot = await rpc!.send('frame_snapshot', { include_pixels: false });
    const status = await rpc!.send('status');
    // eslint-disable-next-line no-console
    console.log('[spheres-runtime]', JSON.stringify({
      lastError: status.last_frame_error ?? null,
      shaderError: status.last_shader_error ?? null,
      nonzero: snapshot.nonzero_pixels,
      meanLuma: snapshot.average_luma,
      maxLuma: snapshot.max_luma,
    }));
    expect(Number(status.shader_precompile_failed ?? -1), String(status.last_shader_error ?? '')).toBe(0);
    // Visible: backdrop + fluid puffs + orbs fill a large share of the
    // frame (threshold leaves headroom for flow-timing variance).
    expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(320 * 180 * 0.35);
    expect(Number(snapshot.average_luma ?? 0)).toBeGreaterThan(0.02);
    // Shaded: studio-lit orbs carry bright specular cores.
    expect(Number(snapshot.max_luma ?? 0)).toBeGreaterThan(0.3);
  }, 60000);
});
