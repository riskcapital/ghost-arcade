import {makeEffect} from '../mobile/studio/interactiveEffects';
import {defaultInteractive,defaultMatter,validateScene} from '../mobile/studio/interactive';
// Runtime gate for the native plugin graphs: compiles every plugin shader
// through the real render core (naga validation, not string checks) and runs
// the GhostFX Liquid scene end-to-end for several simulated frames, asserting
// the fluid is actually VISIBLE and SHADED — the regression class behind
// "liquid barely shows anything".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildNativePluginGraph,
  buildNativePluginPrecompileCommands,
  type NativePluginGraphState,
} from './nativePluginGraphs';

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer/target/release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
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
  if(process.env.GA_SHADER_DEBUG)child.stderr.on('data',d=>process.stderr.write(d));else child.stderr.resume(); // drain, never block the core on stderr
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
    if(process.env.GA_SHADER_DEBUG){for(const cmd of buildNativePluginPrecompileCommands()){await rpc!.send('submit_commands',{commands:[cmd]});await new Promise(r=>setTimeout(r,35));const st=await rpc!.send('status');if(st.last_shader_error)console.error(cmd.shader_id,st.last_shader_error);}}else await rpc!.send('submit_commands', { commands: buildNativePluginPrecompileCommands() });
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

  itIfNativeCore('composites a live camera beneath HandFX, mirrors it and dims it independently', async () => {
    const cameraSourceId = 'hand-camera-test';
    const sourceId = 'hand-camera-output';
    const pixels = Buffer.from(Array.from({ length: 32 * 16 }, (_, i) => i % 32 < 16 ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat());
    await rpc!.send('submit_commands', { commands: [
      { type: 'upload_source_frame', source_id: cameraSourceId, width: 32, height: 16, seq: 1, rgba_b64: pixels.toString('base64') },
      { type: 'upsert_layer', layer_id: 'camera-test', opacity: 1, blend_mode: 'normal', corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
      { type: 'bind_media_source', layer_id: 'camera-test', source_id: sourceId, uri: 'camera-test://out', source_type: 'image' },
    ] });
    async function render(opacity: number, mirror = true, demo = false, showCamera = true) {
      const built = buildNativePluginGraph({ kind: 'handfx', sourceId, cameraSourceId, cameraMirror: mirror,
        params: { handfxMode: 'web', handfxInput: demo ? 'demo' : 'live', handfxCameraOpacity: opacity, handfxCameraOn: showCamera },
        width: 320, height: 180, time: 1, frameDelta: 1 / 60, frameIndex: 1, reset: true,
        audio: { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 } });
      await rpc!.send('compute_graph', built.config);
      await new Promise(resolve => setTimeout(resolve, 100));
      const shot = await rpc!.send('frame_snapshot', { include_pixels: true });
      const bytes = Buffer.from(shot.rgba_b64, 'base64');
      const offset = (Math.floor(shot.height / 2) * shot.width + Math.floor(shot.width / 4)) * 4;
      const rgb = Array.from(bytes.subarray(offset, offset + 3));
      if (String(shot.format).toLowerCase().startsWith('bgra')) [rgb[0], rgb[2]] = [rgb[2], rgb[0]];
      return { rgb, bytes, shot };
    }
    const full = await render(1);
    expect(full.rgb, JSON.stringify(full.rgb)).toEqual([0, 0, 255]);
    expect(full.rgb[0]).toBeLessThan(10);
    const normal = await render(1, false);
    expect(normal.rgb[0]).toBeGreaterThan(240);
    const dim = await render(0.5);
    expect(dim.rgb[2]).toBeGreaterThan(40);
    expect(dim.rgb[2]).toBeLessThan(full.rgb[2] - 30);
    const hidden = await render(0);
    expect(Math.max(...hidden.rgb)).toBeLessThan(5);
    const switchedOff = await render(1, true, false, false);
    expect(Math.max(...switchedOff.rgb)).toBeLessThan(5);
    const graphics = await render(1, true, true, false);
    expect(Number(graphics.shot.nonzero_pixels)).toBeGreaterThan(100);
    // A new input frame replaces the old camera image without reinstalling the shaders.
    await rpc!.send('submit_commands', { commands: [{ type: 'upload_source_frame', source_id: cameraSourceId,
      width: 32, height: 16, seq: 2, rgba_b64: Buffer.from(Array.from({ length: 512 }, () => [0, 255, 0, 255]).flat()).toString('base64') }] });
    expect((await render(1)).rgb[1]).toBeGreaterThan(240);
    await rpc!.send('submit_commands', { commands: [{ type: 'remove_layer', layer_id: 'camera-test' }] });
  }, 15000);

  itIfNativeCore.each(['bridge', 'orbit', 'lasers', 'portal', 'web', 'silk'])('renders HandFX %s without a camera', async (mode) => {
    const layerId = 'handfx-runtime';
    const sourceId = 'plugin:handfx:runtime';
    const params = { handfxMode: mode, handfxInput: 'demo', handfxCameraOn: false, handfxPalette: 'ocean' };
    const built = buildNativePluginGraph({
      kind: 'handfx', sourceId, params, width: 320, height: 180,
      time: 1, frameDelta: 1 / 60, frameIndex: 60, reset: true,
      audio: { active: true, bass: 0.7, mid: 0.4, treble: 0.3, energy: 0.6, beatPhase: 0.25, beatPulse: 0.5, amplitude: 0.5 },
    });
    await rpc!.send('submit_commands', { commands: [
      { type: 'upsert_layer', layer_id: layerId, z_index: 0, opacity: 1, blend_mode: 'normal',
        corners: { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } } },
      { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      { type: 'set_native_graph_layer', layer_id: layerId, kind: 'handfx', instrument_source_id: sourceId,
        composite_source_id: sourceId, input_source_id: null, effect_graph: built.config, params },
      { type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri: 'plugin://handfx', source_type: 'video' },
    ] });
    let snapshot: any = {};
    for (let attempt = 0; attempt < 80; attempt++) {
      snapshot = await rpc!.send('frame_snapshot', { include_pixels: !!process.env.HANDFX_CAPTURE_DIR });
      if (Number(snapshot.nonzero_pixels) > 576 && Number(snapshot.max_luma) > 0.05) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const status = await rpc!.send('status');
    expect(Number(status.shader_precompile_failed), String(status.last_shader_error ?? '')).toBe(0);
    expect(Number(snapshot.nonzero_pixels), mode).toBeGreaterThan(576);
    expect(Number(snapshot.max_luma), mode).toBeGreaterThan(0.05);
    if (process.env.HANDFX_CAPTURE_DIR) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(process.env.HANDFX_CAPTURE_DIR, { recursive: true });
      writeFileSync(join(process.env.HANDFX_CAPTURE_DIR, mode + '.json'), JSON.stringify(snapshot));
    }
    await rpc!.send('submit_commands', { commands: [{ type: 'remove_layer', layer_id: layerId }] });
    // Verify the next case cannot pass by seeing a previous mode's stale frame.
    for (let attempt = 0; attempt < 80; attempt++) {
      snapshot = await rpc!.send('frame_snapshot', { include_pixels: false });
      if (Number(snapshot.nonzero_pixels) === 0) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(Number(snapshot.nonzero_pixels)).toBe(0);
  }, 15000);

  itIfNativeCore.each(['hyperdrive', 'tidal', 'mandala', 'corona'])('renders GhostFX %s in the native renderer', async (mode) => {
    const layerId = 'ghostfx-voyage-runtime';
    const sourceId = 'plugin:ghostfx:voyage-runtime';
    const params = { ghostfxScenePreset: mode, ghostfxVignette: 0.15 };
    const built = buildNativePluginGraph({
      kind: 'ghostfx', sourceId, params, width: 320, height: 180,
      time: 1, frameDelta: 1 / 60, frameIndex: 60, reset: true,
      audio: { active: true, bass: 0.7, mid: 0.4, treble: 0.3, energy: 0.6, beatPhase: 0.25, beatPulse: 0.5, amplitude: 0.5 },
    });
    await rpc!.send('submit_commands', { commands: [
      { type: 'upsert_layer', layer_id: layerId, z_index: 0, opacity: 1, blend_mode: 'normal',
        corners: { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } } },
      { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      { type: 'set_native_graph_layer', layer_id: layerId, kind: 'ghostfx', instrument_source_id: sourceId,
        composite_source_id: sourceId, input_source_id: null, effect_graph: built.config, params },
      { type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri: 'plugin://ghostfx', source_type: 'video' },
    ] });
    let snapshot: any = {};
    for (let attempt = 0; attempt < 80; attempt++) {
      snapshot = await rpc!.send('frame_snapshot', { include_pixels: !!process.env.HANDFX_CAPTURE_DIR });
      if (Number(snapshot.nonzero_pixels) > 576 && Number(snapshot.max_luma) > 0.05) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const status = await rpc!.send('status');
    expect(Number(status.shader_precompile_failed), String(status.last_shader_error ?? '')).toBe(0);
    expect(Number(snapshot.nonzero_pixels), mode).toBeGreaterThan(576);
    expect(Number(snapshot.max_luma), mode).toBeGreaterThan(0.05);
    if (process.env.HANDFX_CAPTURE_DIR) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(process.env.HANDFX_CAPTURE_DIR, { recursive: true });
      writeFileSync(join(process.env.HANDFX_CAPTURE_DIR, mode + '.json'), JSON.stringify(snapshot));
    }
    await rpc!.send('submit_commands', { commands: [{ type: 'remove_layer', layer_id: layerId }] });
    // Verify the next case cannot pass by seeing a previous mode's stale frame.
    for (let attempt = 0; attempt < 80; attempt++) {
      snapshot = await rpc!.send('frame_snapshot', { include_pixels: false });
      if (Number(snapshot.nonzero_pixels) === 0) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(Number(snapshot.nonzero_pixels)).toBe(0);
  }, 15000);

  itIfNativeCore.each([0, 1 / 7, 1])('renders a visible Performer world with palette %s', async (palette) => {
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
        performerWorldParams: [0.65, 0.55, 0.7, 0.6, 0.75, 0.5, palette],
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
            performerWorldParams: [0.65, 0.55, 0.7, 0.6, 0.75, 0.5, palette],
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

    // Poll for the overlay instead of assuming 250 ms: the core warms pipelines
    // asynchronously, and under the full suite's parallel native cores a fixed
    // wait misses the first drawn frame intermittently.
    let snapshot: Record<string, any> = {};
    const deadline = Date.now() + 5000;
    do {
      snapshot = await rpc!.send('frame_snapshot', { include_pixels: false });
      if (Number(snapshot.nonzero_pixels ?? 0) > 320 * 180 * 0.01 && Number(snapshot.max_luma ?? 0) > 0.05) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    const status = await rpc!.send('status');
    expect(
      Number(status.shader_precompile_failed ?? -1),
      String(status.last_shader_error ?? status.last_frame_error ?? ''),
    ).toBe(0);
    expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(320 * 180 * 0.01);
    expect(Number(snapshot.max_luma ?? 0)).toBeGreaterThan(0.05);
  }, 30000);

  itIfNativeCore('runs every Interactive Studio movement on persistent native GPU buffers', async()=>{
    const images:string[]=[];
    for(const preset of ['architecture','garden','walls','ribbons','orbit','electric','light','balls','smoke','cloud','liquid','fire'] as const){
      const scene={...defaultInteractive(),preset,seed:['architecture','garden','walls','ribbons','orbit','electric','light','balls','smoke','cloud','liquid','fire'].indexOf(preset)+10};const sourceId='interactive-native-test',layerId='interactive-native-test';
      const params={interactiveScene:scene,interactiveInputs:[{id:'finger',point:{x:.7,y:.5},strength:1,mode:'vortex'}]};
      const graph=buildNativePluginGraph({kind:'performer-world',sourceId,params,width:320,height:180,time:1,frameDelta:1/60,frameIndex:1,reset:true,audio:{active:true,bass:.5,mid:.3,treble:.2,energy:.5,beatPhase:0,beatPulse:0,amplitude:.5}});
      await rpc!.send('submit_commands',{commands:[
        {type:'upsert_layer',layer_id:layerId,z_index:999,opacity:1,blend_mode:'normal',corners:{topLeft:{x:0,y:0},topRight:{x:1,y:0},bottomRight:{x:1,y:1},bottomLeft:{x:0,y:1}}},
        {type:'set_native_graph_layer',layer_id:layerId,kind:'performer-world',instrument_source_id:sourceId,composite_source_id:sourceId,input_source_id:null,effect_graph:graph.config,params},
        {type:'bind_media_source',layer_id:layerId,source_id:sourceId,uri:'plugin://performer-world',source_type:'video'}]});
      await new Promise(r=>setTimeout(r,900));
      const frame=await rpc!.send('frame_snapshot',{include_pixels:true});
      const status=await rpc!.send('status');if(process.env.GA_SHADER_DEBUG){console.log(preset,status.last_frame_error,status.last_shader_error);writeFileSync('/tmp/matter-'+preset+'.json',JSON.stringify({...frame,debugStatus:status}));}expect(status.shader_precompile_failed,String(status.last_shader_error)).toBe(0);
      expect(frame.nonzero_pixels,preset).toBeGreaterThan(320*180*.01);expect(frame.max_luma,preset).toBeGreaterThan(.08);images.push(frame.rgba_b64);
    }
    expect(new Set(images).size).toBe(12);
    await rpc!.send('submit_commands',{commands:[{type:'remove_layer',layer_id:'interactive-native-test'}]});
  },30000);

  itIfNativeCore.each(['balls', 'liquid'] as const)('keeps %s emitting across lifetimes and expires stopped or shortened emissions', async (kind) => {
    const effect = makeEffect(kind);
    Object.assign(effect.params, { lifetime: 1, flow: 1, x: .25, y: .12, radius: .01 });
    const scene = { ...defaultInteractive(), seed: 4567, surfaces: [], effects: [effect] };
    const sourceId = `interactive-lifecycle-${kind}`;
    let frame = 0;
    let paused = false;
    async function advance(seconds: number) {
      // Run the real GPU passes at a fixed 20 Hz, batching ten steps per RPC.
      // No native graph layer is installed, so the core cannot replay extra steps.
      let remaining = Math.round(seconds / .05);
      let result: any;
      let particleId = '', massId = '', emissionId = '';
      while (remaining > 0) {
        const count = Math.min(remaining, 10);
        const graph = buildNativePluginGraph({ kind: 'performer-world', sourceId,
          params: { interactiveScene: scene, interactivePaused: paused }, width: 320, height: 180,
          time: frame * .05, frameDelta: .05, frameIndex: frame, reset: frame === 0,
          audio: { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 } });
        const buffers = graph.config.buffers as any[];
        particleId = buffers.find(b => b.id.endsWith(':particles')).id;
        massId = buffers.find(b => b.id.endsWith(':mass')).id;
        emissionId = buffers.find(b => b.id.endsWith(':emission')).id;
        result = await rpc!.send('compute_graph', { ...graph.config,
          passes: Array.from({ length: count }, (_, i) => (graph.config.passes as any[]).map(p => ({ ...p, name: `${p.name}-${i}` }))).flat(),
          readbacks: remaining === count ? [particleId, massId, emissionId].map(id => ({ id, include_bytes: true })) : [],
        });
        frame += count; remaining -= count;
      }
      const bytes = Buffer.from(result.readbacks[particleId].bytes_b64, 'base64');
      const particles = Array.from({ length: kind === 'balls' ? 96 : 4096 }, (_, i) => ({
        x: bytes.readFloatLE(i * 32), y: bytes.readFloatLE(i * 32 + 4), age: bytes.readFloatLE(i * 32 + 16),
      })).filter(p => p.age > 0);
      return { bytes, particles, mass: Buffer.from(result.readbacks[massId].bytes_b64, 'base64'),
        emission: Buffer.from(result.readbacks[emissionId].bytes_b64, 'base64') };
    }
    let sample = await advance(4);
    expect(sample.particles.length).toBeGreaterThan(kind === 'balls' ? 5 : 500);
    expect(sample.particles.every(p => p.age < 1)).toBe(true);
    expect(sample.particles.some(p => p.age < .2 && p.y < .2)).toBe(true);
    effect.params.x = .75;
    sample = await advance(.5);
    expect(sample.particles.some(p => p.age < .2 && p.x > .7)).toBe(true);
    paused = true;
    const frozen = await advance(.5);
    expect(frozen.bytes.equals(sample.bytes)).toBe(true);
    expect(frozen.emission.equals(sample.emission)).toBe(true);
    paused = false;
    effect.params.lifetime = 6;
    sample = await advance(3);
    expect(sample.particles.some(p => p.age > 2)).toBe(true);
    effect.params.lifetime = 1;
    sample = await advance(.05);
    expect(sample.particles.every(p => p.age < 1)).toBe(true);
    effect.params.flow = 0;
    sample = await advance(2);
    expect(sample.particles).toHaveLength(0);
    expect(sample.mass.every(v => v === 0)).toBe(true);
    sample = await advance(2); // Expired particles must never resurrect in place.
    expect(sample.particles).toHaveLength(0);
    effect.params.flow = 1;
    effect.emission = 'burst';
    sample = await advance(1);
    expect(sample.particles).toHaveLength(0);
    effect.burst++;
    sample = await advance(.25);
    expect(sample.particles.length).toBeGreaterThan(0);
    sample = await advance(2);
    expect(sample.particles).toHaveLength(0);
    expect(sample.mass.every(v => v === 0)).toBe(true);
    effect.emission = 'pulse';
    effect.params.period = 2; effect.params.duration = .4;
    sample = await advance(4);
    // A pulse train must resume after previous particles have expired.
    const counts: number[] = [];
    for (let i = 0; i < 8; i++) counts.push((await advance(.5)).particles.length);
    expect(Math.max(...counts)).toBeGreaterThan(0);
    expect(Math.min(...counts)).toBe(0);
  }, 30000);

  itIfNativeCore('reconstructs a continuous liquid stream and renders the native surface', async () => {
    const effect = makeEffect('liquid');
    const scene = { ...defaultInteractive(), seed: 8893, surfaces: [], effects: [effect] };
    const sourceId = 'interactive-liquid-surface';
    await rpc!.send('submit_commands', { commands: [
      { type: 'upsert_layer', layer_id: sourceId, z_index: 99999, opacity: 1, blend_mode: 'normal', corners: { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } } },
      { type: 'bind_media_source', layer_id: sourceId, source_id: sourceId, uri: 'plugin://performer-world', source_type: 'video' },
    ] });
    let result: any, massId = '';
    for (let batch = 0; batch < 36; batch++) {
      const graph = buildNativePluginGraph({ kind: 'performer-world', sourceId, params: { interactiveScene: scene },
        width: 960, height: 540, time: batch / 6, frameDelta: 1 / 60, frameIndex: batch, reset: batch === 0,
        audio: { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 } });
      massId = (graph.config.buffers as any[]).find(b => b.id.endsWith(':mass')).id;
      result = await rpc!.send('compute_graph', { ...graph.config,
        passes: Array.from({ length: 10 }, (_, i) => (graph.config.passes as any[]).map(p => ({ ...p, name: `${p.name}-${i}` }))).flat(),
        readbacks: batch === 35 ? [{ id: massId, include_bytes: true }] : [],
      });
    }
    const density = Buffer.from(result.readbacks[massId].bytes_b64, 'base64');
    // Every row below the nozzle contains reconstructed water, not a sequence of isolated dots.
    let wetRows = 0;
    for (let y = 24; y < 100; y++) {
      let peak = 0;
      for (let x = 110; x < 146; x++) peak = Math.max(peak, density.readUInt32LE((y * 256 + x) * 4) / 4096);
      if (peak > .14) wetRows++;
    }
    expect(wetRows).toBeGreaterThan(65);
    const params = { interactiveScene: scene, interactivePaused: true };
    const frozen = buildNativePluginGraph({ kind: 'performer-world', sourceId, params,
      width: 960, height: 540, time: 6, frameDelta: 1 / 60, frameIndex: 37, reset: false,
      audio: { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 } });
    await rpc!.send('submit_commands', { commands: [{ type: 'set_native_graph_layer', layer_id: sourceId,
      kind: 'performer-world', instrument_source_id: sourceId, composite_source_id: sourceId,
      input_source_id: null, effect_graph: frozen.config, params }] });
    await new Promise(resolve => setTimeout(resolve, 100));
    const shot = await rpc!.send('frame_snapshot', { layer_id: sourceId, max_dim: 960, include_pixels: true });
    expect(shot.nonzero_pixels).toBeGreaterThan(1000);
    if (process.env.GA_SHADER_DEBUG) writeFileSync('/tmp/interactive-liquid-stream.json', JSON.stringify(shot));
    await rpc!.send('submit_commands', { commands: [{ type: 'remove_layer', layer_id: sourceId }] });
  }, 20000);

  itIfNativeCore('combines an effect stack and keeps manual bursts and GPU modulation live', async()=>{
    const layerId='interactive-stack-runtime',sourceId=layerId;
    const fire=makeEffect('fire');fire.emission='burst';fire.params.y=.65;fire.params.duration=2;fire.params.hue=15;
    const light=makeEffect('light');light.params.lightPower=0;light.params.haze=.5;light.params.ambient=0;
    const scene={...defaultInteractive(),surfaces:[],seed:812,effects:[fire,light]};
    async function publish(reset=false){const params={interactiveScene:scene};const graph=buildNativePluginGraph({kind:'performer-world',sourceId,params,width:320,height:180,time:1,frameDelta:1/60,frameIndex:1,reset,audio:{active:false,bass:0,mid:0,treble:0,energy:0,beatPhase:0,beatPulse:0,amplitude:0}});await rpc!.send('submit_commands',{commands:[{type:'upsert_layer',layer_id:layerId,z_index:99999,opacity:1,blend_mode:'normal',corners:{topLeft:{x:0,y:0},topRight:{x:1,y:0},bottomRight:{x:1,y:1},bottomLeft:{x:0,y:1}}},{type:'set_native_graph_layer',layer_id:layerId,kind:'performer-world',instrument_source_id:sourceId,composite_source_id:sourceId,input_source_id:null,effect_graph:graph.config,params},{type:'bind_media_source',layer_id:layerId,source_id:sourceId,uri:'plugin://performer-world',source_type:'video'}]});}
    await publish(true);await new Promise(r=>setTimeout(r,500));const idle=await rpc!.send('frame_snapshot',{include_pixels:true});
    fire.burst++;await publish();await new Promise(r=>setTimeout(r,1100));const burst=await rpc!.send('frame_snapshot',{include_pixels:true});expect(burst.average_luma).toBeGreaterThan(idle.average_luma+.001);
    light.params.lightPower=2;light.params.hue=210;fire.emission='continuous';const liquid=makeEffect('liquid');liquid.params.x=.72;liquid.params.y=.15;scene.effects.push(liquid);await publish();await new Promise(r=>setTimeout(r,2200));const mixed=await rpc!.send('frame_snapshot',{include_pixels:true});expect(mixed.nonzero_pixels).toBeGreaterThan(2000);expect(mixed.rgba_b64).not.toBe(burst.rgba_b64);
    const editor=await rpc!.send('frame_snapshot',{layer_id:layerId,max_dim:320,include_pixels:true});expect(editor.rgba_b64).toBeTruthy();expect(editor.width).toBeGreaterThan(0);expect(editor.nonzero_pixels).toBeGreaterThan(2000);
    light.mods.lightPower={source:'lfo-sine',speed:.5,amount:1,invert:false,rangeMin:0,rangeMax:1};await publish();await new Promise(r=>setTimeout(r,300));const mod1=await rpc!.send('frame_snapshot',{include_pixels:true});await new Promise(r=>setTimeout(r,850));const mod2=await rpc!.send('frame_snapshot',{include_pixels:true});expect(mod1.rgba_b64).not.toBe(mod2.rgba_b64);
    const status=await rpc!.send('status');expect(status.last_frame_error).toBeNull();expect(status.last_shader_error).toBeNull();if(process.env.GA_SHADER_DEBUG)writeFileSync('/tmp/interactive-stack-mixed.json',JSON.stringify(mixed));await rpc!.send('submit_commands',{commands:[{type:'remove_layer',layer_id:layerId}]});
  },30000);

  itIfNativeCore('lights extruded blockers and emits fire, smoke and liquid from an authored box', async()=>{
    const sourceId='interactive-material-test',layerId=sourceId;
    const initial=defaultInteractive();initial.surfaces=[{...initial.surfaces[0],points:[{x:.38,y:.4},{x:.62,y:.4},{x:.62,y:.65},{x:.38,y:.65}],height:.45}];
    async function render(material:'none'|'fire'|'smoke'|'liquid',height:number,power:number){
      const scene=validateScene({...initial,preset:material==='none'?'light':material,seed:123,surfaces:initial.surfaces.map(s=>({...s,material,height})),matter:{...defaultMatter(),lightX:.2,lightY:.12,lightPower:power,haze:.65}});
      const params={interactiveScene:scene};const graph=buildNativePluginGraph({kind:'performer-world',sourceId,params,width:320,height:180,time:1,frameDelta:1/60,frameIndex:1,reset:true,audio:{active:false,bass:0,mid:0,treble:0,energy:0,beatPhase:0,beatPulse:0,amplitude:0}});
      await rpc!.send('submit_commands',{commands:[{type:'upsert_layer',layer_id:layerId,z_index:9999,opacity:1,blend_mode:'normal',corners:{topLeft:{x:0,y:0},topRight:{x:1,y:0},bottomRight:{x:1,y:1},bottomLeft:{x:0,y:1}}},{type:'set_native_graph_layer',layer_id:layerId,kind:'performer-world',instrument_source_id:sourceId,composite_source_id:sourceId,input_source_id:null,effect_graph:graph.config,params},{type:'bind_media_source',layer_id:layerId,source_id:sourceId,uri:'plugin://performer-world',source_type:'video'}]});
      await new Promise(r=>setTimeout(r,material==='none'?700:2400));const frame=await rpc!.send('frame_snapshot',{include_pixels:true});const status=await rpc!.send('status');expect(status.last_frame_error).toBeNull();expect(status.last_shader_error).toBeNull();if(process.env.GA_SHADER_DEBUG)writeFileSync('/tmp/matter-box-'+material+'-'+height+'-'+power+'.json',JSON.stringify(frame));return Buffer.from(frame.rgba_b64,'base64');
    }
    const unlit=await render('none',.45,0),lit=await render('none',.45,2.4),flat=await render('none',.02,2.4);
    const mean=(b:Buffer)=>b.reduce((sum,v,i)=>sum+(i%4===3?0:v),0)/(320*180*3);
    expect(mean(lit)-mean(unlit),'authored light power survives native replay').toBeGreaterThan(5);
    let shadowPixels=0;for(let i=0;i<lit.length;i+=4)if(flat[i]+flat[i+1]+flat[i+2]>lit[i]+lit[i+1]+lit[i+2]+12)shadowPixels++;
    expect(shadowPixels,'blocker extrusion removes light behind the box').toBeGreaterThan(150);
    const flame=await render('fire',.45,1.4),smoke=await render('smoke',.45,1.4),liquid=await render('liquid',.45,1.4);
    let hot=0;for(let i=0;i<flame.length;i+=4)if(Math.max(flame[i],flame[i+2])>150&&Math.abs(flame[i]-flame[i+2])>60)hot++;
    expect(hot,'visible fire emission attached to the surface').toBeGreaterThan(80);
    expect(flame.equals(smoke)).toBe(false);expect(smoke.equals(liquid)).toBe(false);
    await rpc!.send('submit_commands',{commands:[{type:'remove_layer',layer_id:layerId}]});
  },30000);

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
