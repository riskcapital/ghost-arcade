import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';
import { SCENE3D_FRAME_WGSL, scene3dFrameBuffer } from './scene3dFrame';
import { snapshotPixels } from '../../../scripts/scene3d-spike/scene.mjs';

/**
 * An Interactive 3D layer is installed once and drawn by the core every frame:
 * the core fills the scene frame block (tempo, beat and bar, time) without the
 * app resending the graph, and a graph texture freed while the layer was
 * hidden is declared again when it comes back.
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

const SHADER = 'scene3d-test/frame';
// Left half: tempo / 300, beat phase, audio active. Right half: a clock that
// moves (time), bar phase. Drawn into a graph texture, then copied out.
const SOURCE = `${SCENE3D_FRAME_WGSL}
@group(0) @binding(0) var<uniform> f: SceneFrame;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
struct VsOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f }
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: VsOut;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
@fragment fn fs_paint(in: VsOut) -> @location(0) vec4f {
  if (in.uv.x < 0.5) { return vec4f(f.tempo / 300.0, f.beat_phase, f.audio_active, 1.0); }
  return vec4f(fract(f.time * 0.5), f.bar_phase, 0.0, 1.0);
}
@fragment fn fs_out(in: VsOut) -> @location(0) vec4f {
  return textureSampleLevel(src, samp, in.uv, 0.0);
}`;

function sceneGraph(layer: string, sourceId: string) {
  const frame = scene3dFrameBuffer(`scene3d:${layer}`);
  const tex = `scene3d:${layer}:paint`;
  const frameBinding = { binding: 0, resource: frame.id, kind: 'uniform' };
  return {
    textures: [{ id: tex, size: 64, format: 'rgba8unorm' }],
    buffers: [frame],
    passes: [],
    readbacks: [],
    render_passes: [
      {
        name: 'paint', shader_id: SHADER, vertex_entry: 'vs_main', fragment_entry: 'fs_paint',
        target: 'texture', texture: tex, clear: true, clear_color: [0, 0, 0, 1], vertex_count: 3,
        bindings: [frameBinding],
      },
      {
        name: 'out', shader_id: SHADER, vertex_entry: 'vs_main', fragment_entry: 'fs_out',
        target: 'source_frame', source_id: sourceId, clear: true, clear_color: [0, 0, 0, 0], vertex_count: 3,
        bindings: [frameBinding, { binding: 1, kind: 'graph-texture', texture: tex }, { binding: 2, kind: 'source-frame-sampler' }],
      },
    ],
  };
}

const W = 320, H = 180;
const full = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const suite = platform.runnable ? describe : describe.skip;
suite('Interactive 3D layer', () => {
  it('is drawn every frame with the scene frame block, and survives its textures being freed', async () => {
    const rpc = core();
    const layer = 's3d-layer';
    const sourceId = 'scene3d:s3d-layer:out';
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      const capabilities = await rpc.send('capabilities');
      expect(capabilities.features?.native_scene3d_graph).toBe(true);
      expect(capabilities.scene3d_frame_layout?.bytes).toBe(64);

      await rpc.commands([{ type: 'precompile_shader', shader_id: SHADER, stage: 'render', entry: 'fs_out', source: SOURCE }]);
      await rpc.commands([
        { type: 'set_audio_state', active: true, level: 0.5, bass: 0.5, mid: 0.5, treble: 0.5, bpm: 150, beat_phase: 0.5, bar_phase: 0.25 },
        { type: 'upsert_layer', layer_id: layer, z_index: 0, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'set_layer_visibility', layer_id: layer, visible: true },
        { type: 'set_native_graph_layer', layer_id: layer, kind: 'scene3d', instrument_source_id: sourceId,
          composite_source_id: sourceId, input_source_id: null, effect_graph: sceneGraph(layer, sourceId), params: {} },
        { type: 'bind_media_source', layer_id: layer, source_id: sourceId, uri: 'native-graph://scene3d/test', source_type: 'video' },
      ]);

      const shot = async () => {
        await rpc.commands([{ type: 'present' }]);
        return snapshotPixels(await rpc.send('frame_snapshot', { include_pixels: true }));
      };
      const at = (img: ReturnType<typeof snapshotPixels>, x: number, y: number) => {
        const i = (Math.round(y * img.h) * img.w + Math.round(x * img.w)) * 4;
        return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]].map(v => v / 255);
      };
      const drawn = async (ready: (rgb: number[]) => boolean) => {
        for (let attempt = 0; attempt < 60; attempt++) {
          const img = await shot();
          if (ready(at(img, 0.25, 0.5))) return img;
          await wait(50);
        }
        const status = await rpc.send('status');
        throw new Error(`scene3d layer never drew: ${status.last_shader_error || status.last_frame_error || 'no error'}`);
      };

      const first = await drawn(([, , active]) => active > 0.5);
      const [tempo, beat, active] = at(first, 0.25, 0.5);
      // rgba8unorm stores the values as written; allow for the output's encoding.
      expect(tempo, 'tempo 150 / 300').toBeGreaterThan(0.35);
      expect(tempo).toBeLessThan(0.75);
      expect(beat, 'beat phase 0.5').toBeGreaterThan(0.35);
      expect(beat).toBeLessThan(0.75);
      expect(active).toBeGreaterThan(0.9);
      const [, bar] = at(first, 0.75, 0.5);
      expect(bar, 'bar phase 0.25 from the app').toBeGreaterThan(0.15);
      expect(bar).toBeLessThan(0.6);

      // Nothing is resent, yet the clock in the picture moves.
      await wait(400);
      const later = await shot();
      expect(Math.abs(at(later, 0.75, 0.5)[0] - at(first, 0.75, 0.5)[0])).toBeGreaterThan(0.02);

      // Hidden past the two-second grace period, then shown with a new tempo:
      // the template's texture is declared again and the layer draws the new
      // value (so the frame left on screen can't pass for it).
      await rpc.commands([{ type: 'set_layer_visibility', layer_id: layer, visible: false }]);
      for (let i = 0; i < 18; i++) { await wait(150); await rpc.commands([{ type: 'present' }]); }
      await rpc.commands([
        { type: 'set_layer_visibility', layer_id: layer, visible: true },
        { type: 'set_audio_state', active: true, bpm: 270, beat_phase: 0.5, bar_phase: 0.25 },
      ]);
      await drawn(([red, , active]) => active > 0.5 && red > tempo + 0.15);
      const status = await rpc.send('status');
      expect(String(status.last_shader_error || status.last_frame_error || '')).toBe('');
      expect(status.graph_textures).toBeGreaterThan(0);
    } finally { await rpc.close(); }
  }, 60000);

  it('builds a mip chain for a graph texture that asks for one', async () => {
    const rpc = core();
    const shader = 'scene3d-test/mips';
    const source = `${SCENE3D_FRAME_WGSL}
@group(0) @binding(0) var<uniform> f: SceneFrame;
@group(0) @binding(1) var src: texture_2d<f32>;
struct VsOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f }
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: VsOut;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
// Half white, half black.
@fragment fn fs_paint(in: VsOut) -> @location(0) vec4f {
  return select(vec4f(0.0, 0.0, 0.0, 1.0), vec4f(1.0), in.uv.x < 0.5 + f.delta * 0.0);
}
// The last level (1x1) is the average of the whole picture. Read directly:
// the shared sampler stays on level 0.
@fragment fn fs_out(in: VsOut) -> @location(0) vec4f {
  let last = i32(textureNumLevels(src)) - 1;
  return vec4f(textureLoad(src, vec2i(0, 0), last).rgb, 1.0);
}`;
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.commands([{ type: 'precompile_shader', shader_id: shader, stage: 'render', entry: 'fs_out', source }]);
      const tex = 'mips-test:paint';
      const out = 'mips-test:out';
      // Every pass needs a binding; the paint pass reads the (zeroed) frame block.
      const frame = scene3dFrameBuffer('mips-test');
      const pass = (name: string, entry: string, extra: Record<string, unknown>) => ({
        name, shader_id: shader, vertex_entry: 'vs_main', fragment_entry: entry, clear: true, clear_color: [0, 0, 0, 1], vertex_count: 3, ...extra,
      });
      await rpc.send('compute_graph', {
        textures: [{ id: tex, size: 64, format: 'rgba8unorm', mips: true }],
        buffers: [frame], passes: [], readbacks: [],
        render_passes: [
          pass('paint', 'fs_paint', { target: 'texture', texture: tex, bindings: [{ binding: 0, resource: frame.id, kind: 'uniform' }] }),
          pass('out', 'fs_out', { target: 'source_frame', source_id: out, include_snapshot: false,
            bindings: [{ binding: 1, kind: 'graph-texture', texture: tex }] }),
        ],
      });
      await rpc.commands([
        { type: 'upsert_layer', layer_id: 'mips', z_index: 0, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'set_layer_visibility', layer_id: 'mips', visible: true },
        { type: 'bind_media_source', layer_id: 'mips', source_id: out, uri: 'native-graph://scene3d/mips', source_type: 'image' },
        { type: 'present' },
      ]);
      await wait(250);
      const status = await rpc.send('status');
      expect(String(status.last_shader_error || status.last_frame_error || '')).toBe('');
      const img = snapshotPixels(await rpc.send('frame_snapshot', { include_pixels: true }));
      const i = (Math.round(img.h / 2) * img.w + Math.round(img.w / 4)) * 4;
      const grey = img.rgba[i] / 255;
      // Without the chain the last level would be empty (black).
      expect(grey).toBeGreaterThan(0.25);
      expect(grey).toBeLessThan(0.85);
      expect(Math.abs(img.rgba[i] - img.rgba[(Math.round(img.h / 2) * img.w + Math.round(img.w * 0.75)) * 4])).toBeLessThan(6);
    } finally { await rpc.close(); }
  }, 60000);
});
