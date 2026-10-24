/**
 * Lines on the native core: Light Up lights lines in a wave across them or
 * at random, the draw head can be feathered and tapered, and a layer draws
 * more than the old eight lines.
 */
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { gpuTestPlatform, rpcDeadlineScale } from './nativeHardwareTestPlatform';
import {
  createDefaultLinesContent,
  createDefaultPointClickLine,
  createLineElement,
  type LineElement,
  type LinesContent,
} from '../lines/types';
import { LINES_NATIVE_SHADER_ID, LINES_NATIVE_WGSL, buildLinesNativeComputeGraph } from './linesNative';

const PROBE_SHADER_ID = 'lines-light-up-test/probe';
const W = 320;
const H = 180;

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

type Rpc = { send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>; close(): Promise<void> };

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
          if (msg.ok) wait.resolve(msg.result); else wait.reject(new Error(msg.error || 'rpc failed'));
        }
      }
      nl = stdout.indexOf('\n');
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
  const send: Rpc['send'] = (method, params = {}, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`native core timed out on ${method}: ${stderr.trim()}`)); }, timeoutMs * rpcDeadlineScale);
    pending.set(id, { resolve, reject, timer });
    child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  return { send, async close() { try { await send('shutdown', {}, 1000); } catch { /* gone */ } child.kill(); } };
}

/** count vertical white lines spread evenly across the frame. */
function verticalLines(count: number): LineElement[] {
  return Array.from({ length: count }, (_, i) => {
    const x = (i + 0.5) / count;
    const element = createLineElement(createDefaultPointClickLine([{ x, y: 0.15 }, { x, y: 0.85 }]));
    element.id = `line-${i}`;
    element.zIndex = i;
    element.blendMode = 'normal';
    element.stroke = { type: 'solid', color: [1, 1, 1, 1], width: 6, cap: 'round', join: 'round' };
    return element;
  });
}

function horizontalLine(): LineElement {
  const element = createLineElement(createDefaultPointClickLine([{ x: 0.05, y: 0.5 }, { x: 0.95, y: 0.5 }]));
  element.id = 'drawn';
  element.blendMode = 'normal';
  element.stroke = { type: 'solid', color: [1, 1, 1, 1], width: 24, cap: 'round', join: 'round' };
  element.drawAnimation = { ...element.drawAnimation, enabled: true, loopMode: 'once', drawSpeed: 1, trailLength: 0 };
  return element;
}

describe('Lines Light Up and draw head on the native core', () => {
  const itIfCore = gpuTestPlatform.runnable ? it : it.skip;

  itIfCore('lights lines in a wave or at random, feathers and tapers the head, and draws more than eight', async () => {
    const rpc = createRpc();
    let frame = 0;
    try {
      await rpc.send('start', { config: { backend: gpuTestPlatform.rendererBackend, width: W, height: H, target_fps: 30 } }, 12000);
      await rpc.send('submit_commands', {
        commands: [
          { type: 'precompile_shader', shader_id: LINES_NATIVE_SHADER_ID, stage: 'render', entry: 'fs_lines', source: LINES_NATIVE_WGSL },
          { type: 'precompile_shader', shader_id: PROBE_SHADER_ID, stage: 'compute', entry: 'cs_probe', source: PROBE_WGSL },
        ],
      }, 15000);

      const render = async (content: LinesContent, time: number): Promise<Uint8Array> => {
        frame += 1;
        const sourceId = 'lines-light-up-test';
        const graph = buildLinesNativeComputeGraph({ sourceId, content, width: W, height: H, time, frameDelta: 1 / 30, frameIndex: frame });
        await rpc.send('compute_graph', graph.config as Record<string, unknown>, 15000);
        const pixels = W * H;
        const out = 'lines-light-up-test:probe';
        const result = await rpc.send('compute_graph', {
          buffers: [
            { id: out, kind: 'storage', byte_length: pixels * 4 },
            { id: `${out}:u`, kind: 'uniform', byte_length: 16, initial_u32: [W, H, pixels, 0] },
          ],
          passes: [{
            name: 'lines-light-up-probe', shader_id: PROBE_SHADER_ID, entry: 'cs_probe',
            dispatch: [Math.ceil(pixels / 64), 1, 1],
            bindings: [
              { binding: 0, resource: out, kind: 'storage' },
              { binding: 1, resource: `${out}:u`, kind: 'uniform' },
              { binding: 2, kind: 'source-frame-texture', source_id: sourceId },
              { binding: 3, kind: 'source-frame-sampler' },
            ],
          }],
          readbacks: [{ id: out, include_bytes: true }],
        }, 10000);
        return new Uint8Array(Buffer.from(result.readbacks[out].bytes_b64, 'base64'));
      };
      // Brightest alpha in a small box (pixels, y down).
      const peak = (px: Uint8Array, x0: number, x1: number, y0: number, y1: number) => {
        let best = 0;
        for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
          for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
            best = Math.max(best, px[(y * W + x) * 4 + 3]);
          }
        }
        return best / 255;
      };
      // Peak brightness of each vertical line across the frame.
      const columns = (px: Uint8Array, count: number) => Array.from({ length: count }, (_, i) => {
        const x = ((i + 0.5) / count) * W;
        return peak(px, x - 4, x + 4, H * 0.4, H * 0.6);
      });

      const base = (elements: LineElement[], extra: Partial<LinesContent> = {}): LinesContent => ({
        ...createDefaultLinesContent(),
        elements,
        ...extra,
      });

      // Off: every line lit, and more than eight lines draw.
      const twelve = verticalLines(12);
      const off = columns(await render(base(twelve), 1), 12);
      expect(off.every((v) => v > 0.9), `all twelve lines lit: ${off.map((v) => v.toFixed(2))}`).toBe(true);

      // Wave left to right, early in a sweep: the left lines are lit, the right dark.
      const five = verticalLines(5);
      const wave = { revealMode: 'waveRight' as const, revealSpeed: 0.25, revealWidth: 0.3, revealFade: 0.5, revealFloor: 0 };
      const early = columns(await render(base(five, wave), 0.6), 5);
      expect(early[0]).toBeGreaterThan(0.8);
      expect(early[4]).toBeLessThan(0.05);
      // Later the band has moved right.
      const later = columns(await render(base(five, wave), 2.6), 5);
      expect(later[3]).toBeGreaterThan(0.8);
      expect(later[0]).toBeLessThan(0.05);
      // Right to left mirrors it.
      const leftward = columns(await render(base(five, { ...wave, revealMode: 'waveLeft' }), 0.6), 5);
      expect(leftward[4]).toBeGreaterThan(0.8);
      expect(leftward[0]).toBeLessThan(0.05);
      // Dim to: unlit lines stay at that level.
      const dimmed = columns(await render(base(five, { ...wave, revealFloor: 0.5 }), 0.6), 5);
      expect(dimmed[4]).toBeGreaterThan(0.4);
      expect(dimmed[4]).toBeLessThan(0.6);

      // Random: lines light at different times, so the lit set changes and
      // over a while every line has been lit and dark.
      const random = { ...wave, revealMode: 'random' as const, revealSpeed: 0.5, revealWidth: 0.4 };
      const patterns = new Set<string>();
      const everLit = new Array(5).fill(false);
      const everDark = new Array(5).fill(false);
      for (let k = 0; k < 40; k++) {
        const cols = columns(await render(base(five, random), k * 0.7), 5);
        patterns.add(cols.map((v) => (v > 0.5 ? 1 : 0)).join(''));
        cols.forEach((v, i) => { if (v > 0.5) everLit[i] = true; if (v < 0.1) everDark[i] = true; });
      }
      expect(patterns.size).toBeGreaterThan(5);
      expect(everLit.every(Boolean) && everDark.every(Boolean)).toBe(true);

      // Draw head, halfway through drawing (once, speed 1: 2 s is half).
      const at = 2;
      const headX = (0.05 + 0.9 * 0.5) * W;
      const plain = horizontalLine();
      const hard = await render(base([plain]), at);
      const feathered = await render(base([{ ...plain, drawAnimation: { ...plain.drawAnimation, headFeather: 1 } }]), at);
      const tapered = await render(base([{ ...plain, drawAnimation: { ...plain.drawAnimation, headTaper: 1 } }]), at);
      const nearHead = (px: Uint8Array) => peak(px, headX - 18, headX - 6, H * 0.5 - 2, H * 0.5 + 2);
      const farBack = (px: Uint8Array) => peak(px, headX - 120, headX - 100, H * 0.5 - 2, H * 0.5 + 2);
      // Hard: full strength right up to the head.
      expect(nearHead(hard)).toBeGreaterThan(0.9);
      // Feathered: faded at the head, full further back.
      expect(nearHead(feathered)).toBeLessThan(0.6);
      expect(farBack(feathered)).toBeGreaterThan(0.9);
      // Tapered: thinner at the head than further back.
      const thickness = (px: Uint8Array, x: number) => {
        let n = 0;
        for (let y = 0; y < H; y++) if (px[(y * W + Math.round(x)) * 4 + 3] > 128) n++;
        return n;
      };
      expect(thickness(tapered, headX - 10)).toBeLessThan(thickness(tapered, headX - 110));
      expect(thickness(hard, headX - 10)).toBe(thickness(hard, headX - 110));
    } finally {
      await rpc.close();
    }
  }, 120000);
});
