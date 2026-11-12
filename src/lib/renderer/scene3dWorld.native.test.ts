import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';
import { buildScene3DGraph, SCENE3D_TIERS } from './scene3dNative';
import { scene3dPrecompileCommands } from './scene3dShaders';
import { defaultScene3D, identityTransform, material, type Scene3D, type SceneNode, type Vec3 } from '../scene3d/sceneModel';
import { snapshotPixels } from '../../../scripts/scene3d-spike/scene.mjs';

/**
 * A fixed Interactive 3D scene, drawn by the core as a `scene3d` layer over a
 * white layer: a box on a floor under a key light. Five pixels say it works:
 * the empty sky is transparent (white shows through), the box is drawn, the
 * floor is lit, the floor behind the box is in its shadow, and the shadow
 * goes when the light stops casting.
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
const node = (patch: Record<string, unknown>): SceneNode =>
  ({ id: String(patch.id), name: String(patch.id), transform: identityTransform(), visible: true, ...patch }) as SceneNode;
function world(shadows: boolean): Scene3D {
  return {
    ...defaultScene3D(),
    camera: { mode: 'free', fov: 40, position: [0, 4, 7], target: [0, 0.4, 0] },
    post: { ...defaultScene3D().post, grain: 0, bloom: 0 },
    react: { ...defaultScene3D().react, bloom: 0 },
    nodes: [
      node({ id: 'floor', kind: 'mesh', shape: 'plane', material: material('matte', { base: '#b0b0b0' }), collider: 'static', catcher: false, transform: { ...identityTransform(), scale: [8, 1, 8] } }),
      node({ id: 'block', kind: 'mesh', shape: 'box', material: material('matte', { base: '#c04020' }), collider: 'static', catcher: false, transform: { ...identityTransform(), position: [0, 0.5, 0] } }),
      node({ id: 'key', kind: 'light', light: 'key', color: '#ffffff', power: 3, shadows, orbit: 0, transform: { ...identityTransform(), position: [-1, 2, 1] } }),
    ],
  };
}

// Same maths as cs_frame: column-major, right-handed, depth 0..1.
function project(p: Vec3, scene: Scene3D): [number, number] {
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a: number[]) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const eye = scene.camera.position, f = nrm(sub(scene.camera.target, eye)), r = nrm(cross(f, [0, 1, 0])), u = cross(r, f);
  const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1];
  const k = 1 / Math.tan((scene.camera.fov * Math.PI) / 360), near = 0.05, far = 400;
  const proj = [k / (W / H), 0, 0, 0, 0, k, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0];
  const mul = (m: number[], v: number[]) => [0, 1, 2, 3].map((row) => m[row] * v[0] + m[4 + row] * v[1] + m[8 + row] * v[2] + m[12 + row] * v[3]);
  const clip = mul(proj, mul(view, [...p, 1]));
  return [(clip[0] / clip[3] * 0.5 + 0.5) * W, (0.5 - clip[1] / clip[3] * 0.5) * H];
}

// Layer corners are Y-up: the top edge is y = 1.
const full = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const suite = platform.runnable ? describe : describe.skip;
suite('Interactive 3D world', () => {
  it('draws a lit box with a real shadow, cut out over the layer below', async () => {
    const rpc = core();
    const source = 'scene3d:test:out';
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, target_fps: 60 } });
      await rpc.commands(scene3dPrecompileCommands());
      const compiled = await rpc.send('status');
      expect(String(compiled.last_shader_error || ''), 'shaders compile').toBe('');

      const shot = async (scene: Scene3D) => {
        const graph = buildScene3DGraph({ scene, sourceId: source, width: W, height: H, quality: SCENE3D_TIERS.performance });
        await rpc.commands([
          { type: 'upsert_layer', layer_id: 'white', z_index: 1, opacity: 1, blend_mode: 'normal', corners: full },
          { type: 'set_layer_color', layer_id: 'white', rgba: [1, 1, 1, 1] },
          { type: 'upsert_layer', layer_id: 'world', z_index: 0, opacity: 1, blend_mode: 'normal', corners: full },
          { type: 'set_layer_visibility', layer_id: 'world', visible: true },
          { type: 'set_native_graph_layer', layer_id: 'world', kind: 'scene3d', instrument_source_id: source, composite_source_id: source, input_source_id: null, effect_graph: graph.config, params: {} },
          { type: 'bind_media_source', layer_id: 'world', source_id: source, uri: 'native-graph://scene3d/test', source_type: 'video' },
        ]);
        for (let i = 0; i < 6; i++) { await wait(120); await rpc.commands([{ type: 'present' }]); }
        const status = await rpc.send('status');
        expect(String(status.last_shader_error || status.last_frame_error || '')).toBe('');
        return snapshotPixels(await rpc.send('frame_snapshot', { include_pixels: true }));
      };
      const at = (img: ReturnType<typeof snapshotPixels>, [x, y]: [number, number]) => {
        const i = (Math.round(y) * img.w + Math.round(x)) * 4;
        return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]].map((v) => v / 255);
      };
      const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

      const scene = world(true);
      const img = await shot(scene);
      const sky = at(img, [W * 0.5, 4]);
      const box = at(img, project([0, 0.5, 0.5], scene));
      const lit = at(img, project([-2, 0, 1.5], scene));
      const shadowPoint = project([0.8, 0, -0.8], scene);
      const shaded = at(img, shadowPoint);
      const report = JSON.stringify({ sky, box, lit, shaded });
      expect(Math.min(...sky), `void sky is see-through: ${report}`).toBeGreaterThan(0.95);
      expect(box[0], `box is drawn, red: ${report}`).toBeGreaterThan(box[2] + 0.15);
      expect(luma(lit), `lit floor: ${report}`).toBeGreaterThan(0.2);
      expect(luma(shaded), `shadowed floor: ${report}`).toBeLessThan(luma(lit) * 0.6);

      const noShadow = at(await shot(world(false)), shadowPoint);
      expect(luma(noShadow), `no shadow when the light casts none: ${report} ${noShadow}`).toBeGreaterThan(luma(shaded) * 1.5);
    } finally { await rpc.close(); }
  }, 90000);
});
