/**
 * Effects on a layer group reach the native core.
 *
 * The bug this guards: in Mapping mode, grouping layers and adding a regular
 * effect to the group did nothing on the native renderer, while the group's
 * edge effects and Looks did. The native path drops the group container and
 * renders its children flat, and only carried the group's effects onto them
 * when "Override effects" was on, so an ordinary group effect never reached
 * the core. The editor's group pass runs each child's own effects followed by
 * the group's (or the group's alone with Override on); the native path now
 * does the same.
 *
 * This drives a real NativeRendererSync flush into a real render core and
 * reads the composite back: two grouped colour layers with an invert on the
 * group, and a single layer with its own invert as the control.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../types';
import { rpcDeadlineScale } from './nativeHardwareTestPlatform';

const nativeCoreBin = process.env.GA_NATIVE_CORE_BIN || join(
  process.cwd(), 'native-renderer', 'target', 'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);
const hasNativeCore = existsSync(nativeCoreBin);
const itIfNativeCore = hasNativeCore ? it : it.skip;
const nativeBackend = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'dx12' : 'vulkan';

type NativeRpc = { send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>; close(): void };

function createNativeRpc(): NativeRpc {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let stdout = '';
  const pending = new Map<number, { timer: ReturnType<typeof setTimeout>; resolve(v: unknown): void; reject(e: Error): void }>();
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string };
          const wait = typeof message.id === 'number' ? pending.get(message.id) : null;
          if (wait) {
            clearTimeout(wait.timer);
            pending.delete(message.id as number);
            if (message.ok) wait.resolve(message.result);
            else wait.reject(new Error(message.error || 'native rpc error'));
          }
        } catch { /* a log line */ }
      }
      index = stdout.indexOf('\n');
    }
  });
  return {
    send(method, params = {}, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`native rpc timeout: ${method}`)); }, timeoutMs * rpcDeadlineScale);
        pending.set(id, { timer, resolve, reject });
        child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    close() {
      for (const [, wait] of pending) clearTimeout(wait.timer);
      pending.clear();
      child.kill();
    },
  };
}

let createLayer: typeof import('../types').createLayer;
let createGroupLayer: typeof import('../types').createGroupLayer;
let NativeRendererSyncCtor: typeof import('../sync/nativeRendererSync').NativeRendererSync;
let api: typeof import('../api/native-renderer');

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k), clear: () => storage.clear() } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { style: { setProperty: () => {} } } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: () => {}, removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 0 });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class { src = ''; } });
  ({ createLayer, createGroupLayer } = await import('../types'));
  ({ NativeRendererSync: NativeRendererSyncCtor } = await import('../sync/nativeRendererSync'));
  api = await import('../api/native-renderer');
});

const W = 96;
const H = 32;
type RGB = [number, number, number];

/** A canvas-space column band, corners y-up. */
const band = (x0: number, x1: number) => ({
  topLeft: { x: x0, y: 1 }, topRight: { x: x1, y: 1 },
  bottomLeft: { x: x0, y: 0 }, bottomRight: { x: x1, y: 0 },
});

function colourLayer(id: string, hue: number, x0: number, x1: number, effects: Layer['effects'] = []): Layer {
  const layer = createLayer(id, id, 'color');
  layer.colorContent = { hue, saturation: 100, lightness: 50, alpha: 1 };
  layer.corners = band(x0, x1);
  layer.effects = effects;
  return layer;
}

const invert = (id: string) => [{ id, type: 'invert', enabled: true, params: {} }] as unknown as Layer['effects'];

/** Sends every command the sync submits straight to the core. */
function forwardingSync(rpc: NativeRpc) {
  const forward = async (commands: any[]) => {
    await rpc.send('submit_commands', { commands });
    return { applied: commands.length, dropped: 0, errors: [] } as any;
  };
  vi.spyOn(api, 'submitNativeRendererCommands').mockImplementation((commands: any) => forward(commands));
  vi.spyOn(api, 'submitNativeRendererBatch').mockImplementation((batch: any) => forward(batch.commands));
  vi.spyOn(api, 'getNativeRendererLayersSnapshot').mockResolvedValue(null as any);
  vi.spyOn(api, 'prefetchNativeRendererMedia').mockResolvedValue(undefined as any);
  const sync = new NativeRendererSyncCtor() as any;
  sync.running = true;
  sync.startupReady = true;
  return sync;
}

/** Centre pixel of each column band, as [r, g, b]. */
async function sample(rpc: NativeRpc, bands: Array<[number, number]>): Promise<RGB[]> {
  await rpc.send('submit_commands', { commands: [{ type: 'present' }] });
  const frame = await rpc.send('frame_snapshot', { include_pixels: true }, 30000);
  const bytes = Buffer.from(frame.rgba_b64, 'base64');
  const width = Number(frame.width);
  const height = Number(frame.height);
  const row = Math.floor(bytes.length / height);
  const bgra = String(frame.format ?? 'bgra').toLowerCase().startsWith('bgra');
  return bands.map(([x0, x1]) => {
    const p = Math.floor(height / 2) * row + Math.floor(((x0 + x1) / 2) * width) * 4;
    return [bytes[p + (bgra ? 2 : 0)], bytes[p + 1], bytes[p + (bgra ? 0 : 2)]];
  });
}

const near = (px: RGB, rgb: RGB) => px.every((v, i) => Math.abs(v - rgb[i]) < 48);
const RED: RGB = [255, 0, 0];
const GREEN: RGB = [0, 255, 0];
const CYAN: RGB = [0, 255, 255];
const MAGENTA: RGB = [255, 0, 255];

/** Flushes until the composite settles on `want` (effect pipelines build in the background). */
async function settle(rpc: NativeRpc, sync: any, layers: Layer[], bands: Array<[number, number]>, want: RGB[]) {
  let got: RGB[] = [];
  const deadline = Date.now() + 20000 * rpcDeadlineScale;
  while (Date.now() < deadline) {
    await sync.flushOnce(W, H, layers);
    got = await sample(rpc, bands);
    if (got.every((px, i) => near(px, want[i]))) return got;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return got;
}

describe('group effects on the native renderer', () => {
  let rpc: NativeRpc;
  beforeAll(async () => {
    if (!hasNativeCore) return;
    rpc = createNativeRpc();
    const started = await rpc.send('start', { config: { backend: nativeBackend, width: W, height: H, target_fps: 30 } }, 30000);
    expect(started?.backend_ready).toBe(true);
  }, 60000);
  afterAll(() => { vi.restoreAllMocks(); rpc?.close(); });

  const LEFT: [number, number] = [0, 1 / 3];
  const MID: [number, number] = [1 / 3, 2 / 3];
  const RIGHT: [number, number] = [2 / 3, 1];

  itIfNativeCore('inverts the whole group, as the same effect does on a single layer', async () => {
    const sync = forwardingSync(rpc);
    const group = createGroupLayer('grp', 'Group');
    group.effects = invert('grp-invert');
    const red = { ...colourLayer('red', 0, ...LEFT), parentGroupId: group.id } as Layer;
    const green = { ...colourLayer('green', 120, ...MID), parentGroupId: group.id } as Layer;
    // Control: a single layer with its own invert.
    const solo = colourLayer('solo', 0, ...RIGHT, invert('solo-invert'));
    const got = await settle(rpc, sync, [group, red, green, solo], [LEFT, MID, RIGHT], [CYAN, MAGENTA, CYAN]);
    expect(near(got[2], CYAN)).toBe(true); // the control works
    expect(near(got[0], CYAN)).toBe(true);
    expect(near(got[1], MAGENTA)).toBe(true);

    // Turning the group effect off brings the original colours back.
    group.effects = [{ ...group.effects[0], enabled: false }];
    const off = await settle(rpc, sync, [group, red, green, solo], [LEFT, MID, RIGHT], [RED, GREEN, CYAN]);
    expect(near(off[0], RED)).toBe(true);
    expect(near(off[1], GREEN)).toBe(true);
  }, 90000);

  itIfNativeCore('runs a child\'s own effects first, then the group\'s; Override replaces them', async () => {
    const sync = forwardingSync(rpc);
    const group = createGroupLayer('grp2', 'Group');
    group.effects = invert('grp2-invert');
    // Own invert, then the group's: inverted twice, back to red.
    const red = { ...colourLayer('red2', 0, ...LEFT, invert('red2-invert')), parentGroupId: group.id } as Layer;
    const green = { ...colourLayer('green2', 120, ...MID), parentGroupId: group.id } as Layer;
    const both = await settle(rpc, sync, [group, red, green], [LEFT, MID], [RED, MAGENTA]);
    expect(near(both[0], RED)).toBe(true);
    expect(near(both[1], MAGENTA)).toBe(true);

    group.groupConfig = { ...group.groupConfig!, overrideStyles: true };
    const replaced = await settle(rpc, sync, [group, red, green], [LEFT, MID], [CYAN, MAGENTA]);
    expect(near(replaced[0], CYAN)).toBe(true);
    expect(near(replaced[1], MAGENTA)).toBe(true);
  }, 90000);
});
