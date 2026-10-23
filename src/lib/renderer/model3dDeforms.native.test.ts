/**
 * Every 3D model deformation, rendered by the native core: each control the
 * panel shows for a deformation must visibly change the picture, and each
 * control it hides must change nothing. The panel and the renderer read the
 * same table (model3dDeforms.ts), so this pins them together.
 */
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { gpuTestPlatform, rpcDeadlineScale } from './nativeHardwareTestPlatform';
import { createDefaultModel3DContent, type Model3DContent } from '../types';
import {
  MODEL3D_DEFORMATIONS,
  type Model3DDeformInfo,
} from '../model3d/model3dDeforms';
import {
  MODEL3D_NATIVE_SHADER_ID,
  MODEL3D_NATIVE_WGSL,
  MODEL3D_VERTEX_VEC4S,
  buildModel3DNativeComputeGraph,
} from './model3dNative';

const PROBE_SHADER_ID = 'model3d-deform-test/probe';
const WIDTH = 160;
const HEIGHT = 90;

const PROBE_WGSL = /* wgsl */`
struct ProbeUniforms { width: u32, height: u32, pixel_count: u32, _pad0: u32 }
@group(0) @binding(0) var<storage, read_write> output_words: array<u32>;
@group(0) @binding(1) var<uniform> probe: ProbeUniforms;
@group(0) @binding(2) var source_tex: texture_2d<f32>;
@group(0) @binding(3) var source_sampler: sampler;
fn pack_channel(v: f32) -> u32 { return u32(round(clamp(v, 0.0, 1.0) * 255.0)); }
@compute @workgroup_size(64)
fn cs_probe(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= probe.pixel_count) { return; }
  let uv = (vec2<f32>(f32(i % probe.width), f32(i / probe.width)) + vec2<f32>(0.5))
    / vec2<f32>(f32(probe.width), f32(probe.height));
  let c = textureSampleLevel(source_tex, source_sampler, uv, 0.0);
  output_words[i] = pack_channel(c.r) | (pack_channel(c.g) << 8u) | (pack_channel(c.b) << 16u) | (pack_channel(c.a) << 24u);
}
`;

type Rpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
};

function createRpc(): Rpc {
  const child = spawn(gpuTestPlatform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    stdout += chunk;
    let nl = stdout.indexOf('\n');
    while (nl >= 0) {
      const line = stdout.slice(0, nl).trim();
      stdout = stdout.slice(nl + 1);
      if (line) {
        const msg = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string };
        const wait = typeof msg.id === 'number' ? pending.get(msg.id) : undefined;
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(msg.id!);
          if (msg.ok) wait.resolve(msg.result);
          else wait.reject(new Error(msg.error || 'rpc failed'));
        }
      }
      nl = stdout.indexOf('\n');
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
  const send: Rpc['send'] = (method, params = {}, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`native core timed out on ${method}: ${stderr.trim()}`));
    }, timeoutMs * rpcDeadlineScale);
    pending.set(id, { resolve, reject, timer });
    child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  return {
    send,
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already gone */ }
      child.kill();
    },
  };
}

/** A subdivided box, 1 x 2 x 0.7, normalized the way the model loader does
 *  (longest side 4 units, centred). Not a sphere, so Spherify has work to do. */
function buildBoxMesh(n = 24) {
  const half = [0.5, 1, 0.35];
  const faces: Array<{ axis: number; sign: number }> = [];
  for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) faces.push({ axis, sign });
  const verts: number[][] = [];
  const indices: number[] = [];
  for (const { axis, sign } of faces) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const base = verts.length;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const p = [0, 0, 0];
        p[axis] = sign * half[axis];
        p[u] = (i / n * 2 - 1) * half[u];
        p[v] = (j / n * 2 - 1) * half[v];
        const nrm = [0, 0, 0];
        nrm[axis] = sign;
        verts.push([...p, ...nrm]);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        if (sign > 0) indices.push(a, b, d, a, d, c);
        else indices.push(a, d, b, a, c, d);
      }
    }
  }
  const norm = 4 / 2; // longest side (2) -> 4 units
  const buffer = new Float32Array(verts.length * MODEL3D_VERTEX_VEC4S * 4);
  const u32 = new Uint32Array(buffer.buffer);
  verts.forEach((vert, k) => {
    const o = k * MODEL3D_VERTEX_VEC4S * 4;
    buffer[o] = vert[0] * norm;
    buffer[o + 1] = vert[1] * norm;
    buffer[o + 2] = vert[2] * norm;
    u32[o + 3] = 0;
    buffer[o + 4] = vert[3];
    buffer[o + 5] = vert[4];
    buffer[o + 6] = vert[5];
    u32[o + 7] = 0x00d0d0d0;
  });
  const diagonal = Math.hypot(1, 2, 0.7) * norm;
  return { buffer, indices: new Uint32Array(indices), vertexCount: verts.length, diagonal };
}

const b64 = (view: ArrayBufferView) => Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');

describe('3D model deformations on the native core', () => {
  const itIfCore = gpuTestPlatform.runnable ? it : it.skip;

  itIfCore('every control shown for a deformation changes the picture, and hidden ones do not', async () => {
    const rpc = createRpc();
    const mesh = buildBoxMesh();
    let frame = 0;
    try {
      await rpc.send('start', {
        config: { backend: gpuTestPlatform.rendererBackend, width: WIDTH, height: HEIGHT, target_fps: 30, native_quality_policy: 'performance' },
      }, 12000);
      await rpc.send('submit_commands', {
        commands: [
          { type: 'precompile_shader', shader_id: MODEL3D_NATIVE_SHADER_ID, stage: 'render', entry: 'fs_mesh', source: MODEL3D_NATIVE_WGSL },
          { type: 'precompile_shader', shader_id: PROBE_SHADER_ID, stage: 'compute', entry: 'cs_probe', source: PROBE_WGSL },
        ],
      }, 15000);

      const render = async (content: Model3DContent): Promise<Uint8Array> => {
        frame += 1;
        const sourceId = 'model3d-deform-test';
        const graph = buildModel3DNativeComputeGraph({
          sourceId,
          content,
          vertexCount: mesh.vertexCount,
          indexCount: mesh.indices.length,
          meshBufferId: 'model3d-deform-test:mesh',
          meshB64: frame === 1 ? b64(mesh.buffer) : null,
          meshByteLength: mesh.buffer.byteLength,
          indexBufferId: 'model3d-deform-test:indices',
          indexB64: frame === 1 ? b64(mesh.indices) : null,
          indexByteLength: mesh.indices.byteLength,
          textureSourceId: 'model3d-deform-test:texture',
          hasTexture: false,
          width: WIDTH,
          height: HEIGHT,
          time: 1.3,
          frameDelta: 1 / 30,
          frameIndex: frame,
          meshDiagonal: mesh.diagonal,
        });
        await rpc.send('compute_graph', graph.config as Record<string, unknown>, 15000);
        const pixelCount = WIDTH * HEIGHT;
        const outputId = 'model3d-deform-test:probe-out';
        const result = await rpc.send('compute_graph', {
          buffers: [
            { id: outputId, kind: 'storage', byte_length: pixelCount * 4 },
            { id: 'model3d-deform-test:probe-u', kind: 'uniform', byte_length: 16, initial_u32: [WIDTH, HEIGHT, pixelCount, 0] },
          ],
          passes: [{
            name: 'model3d-deform-test-probe',
            shader_id: PROBE_SHADER_ID,
            entry: 'cs_probe',
            dispatch: [Math.ceil(pixelCount / 64), 1, 1],
            bindings: [
              { binding: 0, resource: outputId, kind: 'storage' },
              { binding: 1, resource: 'model3d-deform-test:probe-u', kind: 'uniform' },
              { binding: 2, kind: 'source-frame-texture', source_id: sourceId },
              { binding: 3, kind: 'source-frame-sampler' },
            ],
          }],
          readbacks: [{ id: outputId, include_bytes: true }],
        }, 10000);
        return new Uint8Array(Buffer.from(result.readbacks[outputId].bytes_b64, 'base64'));
      };

      /** Share of pixels that changed by more than a few levels. */
      const changed = (a: Uint8Array, b: Uint8Array) => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++;
        }
        return n / (a.length / 4);
      };

      const base = (info: Model3DDeformInfo): Model3DContent => ({
        ...createDefaultModel3DContent(),
        materialType: 'standard',
        deformationType: info.value,
        deformationIntensity: 0.5,
        deformationSpeed: 1,
        deformationScale: 2,
        deformationSpread: 1,
        deformationAxis: 'all',
      });

      // The undeformed box must be on screen for any of this to mean anything.
      const plain = await render(base(MODEL3D_DEFORMATIONS[0]));
      let lit = 0;
      for (let i = 0; i < plain.length; i += 4) if (plain[i] + plain[i + 1] + plain[i + 2] > 30) lit++;
      expect(lit / (plain.length / 4)).toBeGreaterThan(0.05);

      // Hidden controls measure exactly zero; shown ones well above this.
      const VISIBLE = 0.0025;
      const NOTHING = 0.0005;
      const report: string[] = [];
      const failures: string[] = [];
      for (const info of MODEL3D_DEFORMATIONS.slice(1)) {
        const start = base(info);
        const ref = await render(start);
        const row: string[] = [];
        const check = async (control: string, patch: Partial<Model3DContent>, shown: boolean) => {
          const share = changed(ref, await render({ ...start, ...patch }));
          row.push(`${control}=${(share * 100).toFixed(2)}%${shown ? '' : '(hidden)'}`);
          if (shown && share < VISIBLE) failures.push(`${info.value}: ${control} does nothing (${(share * 100).toFixed(3)}%)`);
          if (!shown && share > NOTHING) failures.push(`${info.value}: hidden ${control} changes the picture (${(share * 100).toFixed(3)}%)`);
        };
        await check('type', { deformationType: 'none' }, true);
        await check('intensity', { deformationIntensity: 1.2 }, true);
        await check('speed', { deformationSpeed: 2.7 }, info.speed);
        await check('scale', { deformationScale: 4.5 }, info.scale);
        await check('spread', { deformationSpread: 1.8 }, info.spread);
        for (const axis of ['x', 'y', 'z'] as const) {
          await check(`axis-${axis}`, { deformationAxis: axis }, info.axes.includes(axis));
        }
        report.push(`${info.value.padEnd(9)} ${row.join(' ')}`);
      }
      console.log(report.join('\n'));
      expect(failures).toEqual([]);
    } finally {
      await rpc.close();
    }
  }, 180000);
});
