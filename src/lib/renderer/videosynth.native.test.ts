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
 * Phosphor drawn by the core as a `videosynth` layer: the shader compiles,
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
suite('Phosphor video synth', () => {
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
      for (const preset of VIDEOSYNTH_PRESETS) {
        const graph = buildVideoSynthGraph({ params: presetValues(preset.id), sourceId: source, width: W, height: H, maxSide: 960 });
        await rpc.commands([
          { type: 'upsert_layer', layer_id: 'synth', z_index: 0, opacity: 1, blend_mode: 'normal', corners: full },
          { type: 'set_layer_visibility', layer_id: 'synth', visible: true },
          { type: 'set_native_graph_layer', layer_id: 'synth', kind: 'videosynth', instrument_source_id: source, composite_source_id: source, input_source_id: null, effect_graph: graph.config, params: {} },
          { type: 'bind_media_source', layer_id: 'synth', source_id: source, uri: 'native-graph://videosynth/test', source_type: 'video' },
        ]);
        for (let i = 0; i < 8; i++) { await wait(80); await rpc.commands([{ type: 'present' }]); }
        const status = await rpc.send('status');
        expect(String(status.last_shader_error || status.last_frame_error || ''), preset.id).toBe('');
        const a = await shot();
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
});
