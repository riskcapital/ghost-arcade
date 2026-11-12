import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';
import { buildVideoSynthGraph } from '../videosynth/graph';
import { presetValues, VIDEOSYNTH_PRESETS } from '../videosynth/patch';
import { videosynthPrecompileCommands } from '../videosynth/shaders';
import { snapshotPixels } from '../../../scripts/scene3d-spike/scene.mjs';

/**
 * Analog Synth drawn by the core as a `videosynth` layer: the shader compiles,
 * every preset makes a picture, and the picture moves on its own (the core
 * drives the clock; nothing is resent).
 */
type Command = Record<string, unknown>;
function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(String(message.error)));
  });
  const send = (method: string, params: Command = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() { try { await send('shutdown'); } catch { /* gone */ } await closeNativeTestCore(child); },
  };
}

const W = 960, H = 540;
const full = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const suite = platform.runnable ? describe : describe.skip;
suite('Analog Synth video synth', () => {
  it('draws every preset and keeps moving on its own', async () => {
    const rpc = core();
    const source = 'videosynth:test:out';
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.commands(videosynthPrecompileCommands());
      expect(String((await rpc.send('status')).last_shader_error || ''), 'shader compiles').toBe('');
      const shot = async () => {
        await rpc.commands([{ type: 'present' }]);
        return snapshotPixels(await rpc.send('frame_snapshot', { include_pixels: true }));
      };
      const stats = (img: ReturnType<typeof snapshotPixels>) => {
        let lit = 0, sum = 0;
        for (let i = 0; i < img.rgba.length; i += 4) { const v = img.rgba[i] + img.rgba[i + 1] + img.rgba[i + 2]; sum += v; if (v > 60) lit++; }
        return { lit: lit / (img.w * img.h), mean: sum / (img.w * img.h * 765) };
      };
      // The presets, then the still test card with a cable from LFO 1 into Picture rotate.
      const patched = { id: 'test-card+cable', name: 'Test card, patched', values: { ...VIDEOSYNTH_PRESETS.find((p) => p.id === 'test-card')!.values, vsRotateInSrc: 5, vsRotateInAmt: 1, vsLfo1Rate: 0.9 } };
      for (const preset of [...VIDEOSYNTH_PRESETS, patched]) {
        const values = preset === patched ? { ...presetValues('test-card'), ...patched.values } : presetValues(preset.id);
        const graph = buildVideoSynthGraph({ params: values, sourceId: source, width: W, height: H, maxSide: 960 });
        await rpc.commands([
          { type: 'upsert_layer', layer_id: 'synth', z_index: 0, opacity: 1, blend_mode: 'normal', corners: full },
          { type: 'set_layer_visibility', layer_id: 'synth', visible: true },
          { type: 'set_native_graph_layer', layer_id: 'synth', kind: 'videosynth', instrument_source_id: source, composite_source_id: source, input_source_id: null, effect_graph: graph.config, params: {} },
          { type: 'bind_media_source', layer_id: 'synth', source_id: source, uri: 'native-graph://videosynth/test', source_type: 'video' },
        ]);
        for (let i = 0; i < 8; i++) { await wait(80); await rpc.commands([{ type: 'present' }]); }
        const status = await rpc.send('status');
        expect(String(status.last_shader_error || status.last_frame_error || ''), preset.id).toBe('');
        // The first frames of a new graph can take a moment: wait for a picture.
        let a = await shot();
        for (let i = 0; i < 30 && stats(a).lit < 0.05; i++) { await wait(100); a = await shot(); }
        await wait(500);
        const b = await shot();
        if (process.env.VSYNTH_DUMP) writeFileSync(`${process.env.VSYNTH_DUMP}-${preset.id}.json`, JSON.stringify({ w: a.w, h: a.h, b64: Buffer.from(a.rgba).toString('base64') }));
        const sa = stats(a);
        expect(sa.lit, `${preset.id} draws a picture`).toBeGreaterThan(0.05);
        let changed = 0;
        for (let i = 0; i < a.rgba.length; i += 16) if (Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) > 12) changed++;
        // The test card is still by design: every oscillator synced, nothing modulating.
        if (preset.id !== 'test-card') expect(changed / (a.rgba.length / 16), `${preset.id} moves`).toBeGreaterThan(0.02);
      }
    } finally { await rpc.close(); }
  }, 120000);

  it('draws another layer as its input', async () => {
    const rpc = core();
    const source = 'videosynth:input:out';
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.commands(videosynthPrecompileCommands());
      const params = { ...presetValues('warm-up'), vsInputLayer: 'red', vsAInput: 1, vsASat: 0, vsAMod: 0, vsAFm: 0, vsBLevel: 0, vsCLevel: 0, vsFeedback: 0, vsScanlines: 0, vsBleed: 0, vsGlow: 0 };
      const graph = buildVideoSynthGraph({ params, sourceId: source, width: W, height: H, maxSide: 960 });
      // The input: a layer showing a red picture, under the synth (a higher z draws further down).
      const RED = `struct V { @builtin(position) p: vec4f }
@group(0) @binding(0) var<uniform> u: vec4f;
@vertex fn vs(@builtin(vertex_index) i: u32) -> V { let q = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return V(vec4f(q * 2.0 - 1.0, 0.0, 1.0)); }
@fragment fn fs(v: V) -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0) + u * 0.0; }`;
      await rpc.commands([{ type: 'precompile_shader', shader_id: 'test/red', stage: 'render', entry: 'fs', source: RED }]);
      await rpc.send('compute_graph', {
        buffers: [{ id: 'red:u', kind: 'uniform', byte_length: 16, initial_b64: Buffer.alloc(16).toString('base64') }], passes: [], readbacks: [],
        render_passes: [{ name: 'red', shader_id: 'test/red', vertex_entry: 'vs', fragment_entry: 'fs', target: 'source_frame', source_id: 'red:src', clear: true, vertex_count: 3, include_snapshot: false, bindings: [{ binding: 0, resource: 'red:u', kind: 'uniform' }] }],
      });
      await rpc.commands([
        { type: 'upsert_layer', layer_id: 'red', z_index: 5, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'set_layer_visibility', layer_id: 'red', visible: true },
        { type: 'bind_media_source', layer_id: 'red', source_id: 'red:src', uri: 'native-graph://test/red', source_type: 'image' },
        { type: 'upsert_layer', layer_id: 'synth', z_index: 0, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'set_layer_visibility', layer_id: 'synth', visible: true },
        { type: 'set_native_graph_layer', layer_id: 'synth', kind: 'videosynth', instrument_source_id: source, composite_source_id: source, input_source_id: null, effect_graph: graph.config, params: {} },
        { type: 'bind_media_source', layer_id: 'synth', source_id: source, uri: 'native-graph://videosynth/test', source_type: 'video' },
      ]);
      let img = await (async () => { await rpc.commands([{ type: 'present' }]); return snapshotPixels(await rpc.send('frame_snapshot', { include_pixels: true })); })();
      for (let i = 0; i < 20; i++) {
        await wait(100);
        await rpc.commands([{ type: 'present' }]);
        img = snapshotPixels(await rpc.send('frame_snapshot', { include_pixels: true }));
        const c = (img.h / 2 * img.w + img.w / 2) * 4;
        if (img.rgba[c] > 150 && img.rgba[c + 1] < 60) break;
      }
      const c = (img.h / 2 * img.w + img.w / 2) * 4;
      expect([img.rgba[c], img.rgba[c + 1], img.rgba[c + 2]], 'the input comes through').toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
      expect(img.rgba[c]).toBeGreaterThan(150);
      expect(img.rgba[c + 1]).toBeLessThan(60);
    } finally { await rpc.close(); }
  }, 60000);
});
