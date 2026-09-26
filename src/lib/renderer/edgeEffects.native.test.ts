import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EdgeEffect, Layer, LayerShape, MeshWarpGrid, WarpCorners } from '../types';
import { nativeEdgeEffectPayload, buildEdgeEffectContext } from '../drawing/edgeEffects';
import { edgeTypeDefaults } from '../drawing/edgeEffectCatalog';
import { buildEdgeOutline } from '../drawing/edgeEffectGeometry';

/**
 * Edge Effects on the native compositor.
 *
 *  - Every classic stroke, fill and animation type is rendered by the native
 *    core and by the editor's WebGL DrawingRenderer (the reference, run in an
 *    offscreen Electron window) at the same clock, and compared. The native
 *    core draws edges analytically at output resolution, so edges may differ
 *    by a pixel; everything else (colour, motion, placement) must agree.
 *  - Crispness is measured directly: edge ramps, stroke widths under a
 *    perspective pin, sub-pixel lines and dash lengths along curves.
 *  - Every new type renders inside its layer's bounds, and the structural
 *    ones put their pixels where they belong.
 */

const require = createRequire(import.meta.url);
const nativeCoreBin = join(process.cwd(), 'native-renderer', 'target', 'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const hasNativeCore = existsSync(nativeCoreBin);
const itIfNativeCore = hasNativeCore ? it : it.skip;
const nativeBackend = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'dx12' : 'vulkan';
const DUMP_DIR = process.env.EDGE_FX_DUMP_DIR;

// ---------------------------------------------------------------------------
// Native RPC
// ---------------------------------------------------------------------------

type NativeRpc = { send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>; close(): Promise<void> };

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
        } catch { /* log line */ }
      }
      index = stdout.indexOf('\n');
    }
  });
  return {
    send(method, params = {}, timeoutMs = 20000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`native rpc timeout: ${method}`)); }, timeoutMs);
        pending.set(id, { timer, resolve, reject });
        child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    async close() {
      for (const [, wait] of pending) clearTimeout(wait.timer);
      pending.clear();
      child.kill();
    },
  };
}

interface Image { width: number; height: number; rgba: Uint8Array }

async function nativeSnapshot(rpc: NativeRpc): Promise<Image> {
  const frame = await rpc.send('frame_snapshot', { include_pixels: true }, 60000);
  const bytes = Buffer.from(frame.rgba_b64, 'base64');
  const bgra = String(frame.format).toLowerCase().startsWith('bgra');
  const rgba = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) {
    rgba[i] = bytes[i + (bgra ? 2 : 0)];
    rgba[i + 1] = bytes[i + 1];
    rgba[i + 2] = bytes[i + (bgra ? 0 : 2)];
    rgba[i + 3] = 255;
  }
  return { width: Number(frame.width), height: Number(frame.height), rgba };
}

async function startCore(rpc: NativeRpc, width: number, height: number) {
  const started = await rpc.send('start', { config: { backend: nativeBackend, width, height, source_frame_size: 64, target_fps: 30 } }, 30000);
  expect(started?.backend_ready).toBe(true);
}

const TRANSPARENT = Buffer.alloc(64 * 64 * 4).toString('base64');
const FULL: WarpCorners = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 0 } };

interface LayerSpec {
  id: string;
  corners: WarpCorners;
  layerShape?: LayerShape | null;
  meshGrid?: MeshWarpGrid | null;
  parentGroupId?: string;
  cornerRadius?: number;
  effects: EdgeEffect[];
}

function asLayer(spec: LayerSpec) {
  return {
    id: spec.id,
    layerShape: spec.layerShape ?? null,
    corners: spec.corners,
    warpMode: spec.meshGrid ? 'mesh' : 'corners',
    meshGrid: spec.meshGrid ?? null,
    parentGroupId: spec.parentGroupId,
    edgeEffects: { enabled: true, effects: spec.effects, cornerRadius: spec.cornerRadius },
  } as unknown as Layer & { parentGroupId?: string };
}

/** Transparent-content layers carrying only their edge effects. */
async function renderNative(rpc: NativeRpc, specs: LayerSpec[], width: number, height: number, time: number): Promise<Image> {
  const layers = specs.map(asLayer);
  const context = buildEdgeEffectContext(layers, width, height);
  const commands: unknown[] = [{ type: 'set_render_clock', mode: 'manual', time }];
  specs.forEach((spec, index) => {
    const payload = nativeEdgeEffectPayload(layers[index], width, height, context);
    commands.push(
      { type: 'upload_source_frame', source_id: spec.id, width: 64, height: 64, seq: 1, rgba_b64: TRANSPARENT },
      { type: 'upsert_layer', layer_id: spec.id, opacity: 1, z_index: index, corners: spec.corners, mesh_grid: null },
      { type: 'bind_media_source', layer_id: spec.id, source_id: spec.id, source_type: 'image', uri: `memory://${spec.id}` },
      {
        type: 'set_layer_edge_effects', layer_id: spec.id,
        edge_effects: payload?.effects ?? [], edge_outline: payload?.outline ?? [], edge_corners: payload?.corners ?? [],
        edge_diagonals: payload?.diagonals ?? [], edge_geometry: payload?.geometry ?? [0, 0, 0, 0],
        edge_seed: payload?.seed ?? 0, edge_bounds: payload?.bounds ?? [0, 0, 0, 0],
      },
    );
  });
  commands.push({ type: 'present' });
  await rpc.send('set_render_clock', { mode: 'manual', time });
  await rpc.send('submit_commands', { commands });
  await rpc.send('frame_snapshot', {});
  return nativeSnapshot(rpc);
}

async function clearLayers(rpc: NativeRpc, ids: string[]) {
  await rpc.send('submit_commands', { commands: [...ids.map((id) => ({ type: 'remove_layer', layer_id: id })), { type: 'present' }] });
}

// ---------------------------------------------------------------------------
// Reference (editor WebGL renderer in offscreen Electron)
// ---------------------------------------------------------------------------

interface ReferenceCase { id: string; width: number; height: number; time: number; layer: ReturnType<typeof asLayer>; effects: EdgeEffect[] }

async function bundleReference(): Promise<string> {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [join(process.cwd(), 'src/lib/renderer/edgeEffectReference.browser.ts')],
    bundle: true, write: false, format: 'iife', globalName: '__edgeRef', platform: 'browser', target: 'es2020',
    alias: { $lib: join(process.cwd(), 'src/lib') },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

async function renderReferences(cases: ReferenceCase[]): Promise<Record<string, Uint8Array[]>> {
  const electronBin = require('electron') as unknown as string;
  const tmp = mkdtempSync(join(tmpdir(), 'ghost-edge-ref-'));
  try {
    const bundle = await bundleReference();
    writeFileSync(join(tmp, 'bundle.js'), bundle);
    writeFileSync(join(tmp, 'input.json'), JSON.stringify(cases.map((c) => ({ ...c, layer: { layerShape: c.layer.layerShape, corners: c.layer.corners, warpMode: c.layer.warpMode, meshGrid: c.layer.meshGrid } }))));
    writeFileSync(join(tmp, 'helper.cjs'), `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const dir = ${JSON.stringify(tmp)};
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true } });
    await win.loadURL('data:text/html,<html><body></body></html>');
    const code = fs.readFileSync(dir + '/bundle.js', 'utf8');
    const input = fs.readFileSync(dir + '/input.json', 'utf8');
    const result = await win.webContents.executeJavaScript(code + ';__edgeRef.renderEdgeEffectReferences(' + input + ')', true);
    fs.writeFileSync(dir + '/output.json', JSON.stringify({ ok: true, result }));
  } catch (err) {
    fs.writeFileSync(dir + '/output.json', JSON.stringify({ ok: false, error: String(err && err.stack || err) }));
  }
  app.quit();
});
`);
    const child = spawn(electronBin, [join(tmp, 'helper.cjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr!.on('data', (c) => { stderr += c; });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`reference renderer timed out: ${stderr}`)); }, 120000);
      child.on('exit', () => { clearTimeout(timer); resolve(); });
    });
    const payload = JSON.parse(readFileSync(join(tmp, 'output.json'), 'utf8'));
    if (!payload.ok) throw new Error(payload.error);
    const out: Record<string, Uint8Array[]> = {};
    for (const [id, images] of Object.entries(payload.result as Record<string, string[]>)) {
      out[id] = images.map((b64) => new Uint8Array(Buffer.from(b64, 'base64')));
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Composite premultiplied effect images onto a transparent layer and then
 *  onto black, with the same source-over-with-blend-mode math the native
 *  compositor uses. Normal blend is plain premultiplied source-over. */
function compositeReference(images: Uint8Array[], effects: EdgeEffect[], width: number, height: number): Image {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let cr = [0, 0, 0];
    let ca = 0;
    images.forEach((img, e) => {
      const a = (img[i * 4 + 3] / 255) * Math.max(0, Math.min(1, effects[e].opacity ?? 1));
      if (a <= 0) return;
      const straight = img[i * 4 + 3] > 0 ? [0, 1, 2].map((c) => Math.min(1, img[i * 4 + c] / img[i * 4 + 3])) : [0, 0, 0];
      const cb = ca > 1e-6 ? cr.map((c) => c / ca) : [0, 0, 0];
      const mode = effects[e].blendMode ?? 'normal';
      const blended = straight.map((cs, c) => mode === 'add' ? Math.min(1, cb[c] + cs) : mode === 'screen' ? 1 - (1 - cb[c]) * (1 - cs) : mode === 'multiply' ? cb[c] * cs : cs);
      cr = cr.map((c, k) => a * (1 - ca) * straight[k] + a * ca * blended[k] + (1 - a) * c);
      ca = a + ca * (1 - a);
    });
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(Math.min(1, cr[c]) * 255);
    out[i * 4 + 3] = 255;
  }
  return { width, height, rgba: out };
}

/** Shift-tolerant difference: each pixel is compared with the closest value
 *  in the other image's (2r + 1)^2 neighbourhood, both ways. Edges drawn a
 *  pixel apart match; wrong colour, motion or placement does not. */
function neighbourhoodDiff(a: Image, b: Image, radius = 3) {
  let total = 0;
  let worst = 0;
  let over = 0;
  const n = a.width * a.height;
  const oneWay = (x: Image, y: Image) => {
    for (let py = 0; py < x.height; py++) {
      for (let px = 0; px < x.width; px++) {
        let pixelErr = 0;
        for (let c = 0; c < 3; c++) {
          const v = x.rgba[(py * x.width + px) * 4 + c];
          let lo = 255, hi = 0;
          for (let dy = -radius; dy <= radius; dy++) {
            const yy = py + dy;
            if (yy < 0 || yy >= y.height) continue;
            for (let dx = -radius; dx <= radius; dx++) {
              const xx = px + dx;
              if (xx < 0 || xx >= y.width) continue;
              const w = y.rgba[(yy * y.width + xx) * 4 + c];
              if (w < lo) lo = w;
              if (w > hi) hi = w;
            }
          }
          pixelErr = Math.max(pixelErr, v < lo ? lo - v : v > hi ? v - hi : 0);
        }
        total += pixelErr;
        worst = Math.max(worst, pixelErr);
        if (pixelErr > 40) over++;
      }
    }
  };
  oneWay(a, b);
  oneWay(b, a);
  return { mean: total / (2 * n), worst, overFraction: over / (2 * n) };
}

function litPixels(img: Image, threshold = 24): number {
  let count = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    if (Math.max(img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]) > threshold) count++;
  }
  return count;
}

/** Debug output (EDGE_FX_DUMP_DIR): a plain RGBA PNG, no dependencies. */
async function dump(name: string, img: Image) {
  if (!DUMP_DIR) return;
  mkdirSync(DUMP_DIR, { recursive: true });
  const { deflateSync, crc32 } = await import('node:zlib');
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (img.width * 4 + 1)] = 0;
    raw.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * (img.width * 4 + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(join(DUMP_DIR, `${name}.png`), png);
}

let seq = 0;
function effect(stroke: Record<string, unknown>, fill: Record<string, unknown> = { type: 'none' }, animation: Record<string, unknown> = { type: 'none' }, extra: Partial<EdgeEffect> = {}): EdgeEffect {
  return { id: `fx-${++seq}`, enabled: true, opacity: 1, blendMode: 'normal', stroke, fill, animation, ...extra } as EdgeEffect;
}
const stroke = (type: string, over: Record<string, unknown> = {}) => ({ ...edgeTypeDefaults('stroke', type), ...over });
const fill = (type: string, over: Record<string, unknown> = {}) => ({ ...edgeTypeDefaults('fill', type), ...over });
const anim = (type: string, over: Record<string, unknown> = {}) => ({ ...edgeTypeDefaults('animation', type), ...over });

// ---------------------------------------------------------------------------
// Reference comparisons for every classic type
// ---------------------------------------------------------------------------

const REF_SIZE = 256;
const INNER: WarpCorners = {
  topLeft: { x: 0.18, y: 0.82 }, topRight: { x: 0.82, y: 0.82 },
  bottomLeft: { x: 0.18, y: 0.18 }, bottomRight: { x: 0.82, y: 0.18 },
};
const CIRCLE: LayerShape = { type: 'circle', enabled: true, params: { radiusX: 0.8, scale: 1 } } as LayerShape;
const HEX: LayerShape = { type: 'polygon', enabled: true, params: { sides: 6, scale: 1.1 } } as LayerShape;

interface ClassicCase { id: string; shape?: LayerShape | null; time: number; effects: EdgeEffect[]; tolerance?: { mean: number; over: number } }

const CLASSIC_CASES: ClassicCase[] = [
  { id: 'stroke-solid', time: 0.5, effects: [effect(stroke('solid', { width: 4, color: [1, 0.6, 0.2, 1] }))] },
  { id: 'stroke-glow', shape: CIRCLE, time: 0.7, effects: [effect(stroke('glow', { width: 3, glowSize: 18 }))] },
  { id: 'stroke-neon', shape: HEX, time: 1.1, effects: [effect(stroke('neon'))] },
  { id: 'stroke-snake', time: 0.9, effects: [effect(stroke('snake', { snakeCount: 3, width: 4 }))] },
  { id: 'stroke-pulse', shape: CIRCLE, time: 0.4, effects: [effect(stroke('pulse', { width: 4 }))] },
  { id: 'stroke-rainbow', shape: HEX, time: 1.3, effects: [effect(stroke('rainbow', { width: 5 }))] },
  { id: 'stroke-dashed', time: 0.6, effects: [effect(stroke('dashed', { width: 3 }))] },
  { id: 'stroke-electric', shape: CIRCLE, time: 0.8, effects: [effect(stroke('electric', { width: 3 }))] },
  { id: 'stroke-strobe', time: 0.1, effects: [effect(stroke('strobe', { width: 4 }))] },
  { id: 'stroke-scanner', shape: HEX, time: 2.2, effects: [effect(stroke('scanner', { width: 4 }))] },
  { id: 'stroke-fire', time: 1.7, effects: [effect(stroke('fire', { width: 5 }))] },
  { id: 'fill-solid', shape: HEX, time: 0, effects: [effect({ type: 'none' }, fill('solid', { color: [0.2, 0.5, 1, 1], opacity: 0.8 }))] },
  { id: 'fill-gradient', time: 0.5, effects: [effect({ type: 'none' }, fill('gradient', { speed: 0.4 }))] },
  { id: 'fill-gradient-radial', shape: CIRCLE, time: 0.5, effects: [effect({ type: 'none' }, fill('gradient', { gradientType: 'radial', speed: 0.3 }))] },
  { id: 'fill-gradient-angular', time: 0.5, effects: [effect({ type: 'none' }, fill('gradient', { gradientType: 'angular', speed: 0.3 }))] },
  { id: 'fill-plasma', time: 1.2, effects: [effect({ type: 'none' }, fill('plasma'))] },
  { id: 'fill-liquid', shape: CIRCLE, time: 0.9, effects: [effect({ type: 'none' }, fill('liquid'))] },
  { id: 'fill-fire', time: 0.7, effects: [effect({ type: 'none' }, fill('fire'))] },
  { id: 'fill-electric', shape: HEX, time: 0.35, effects: [effect({ type: 'none' }, fill('electric'))] },
  { id: 'fill-holographic', time: 0.6, effects: [effect({ type: 'none' }, fill('holographic'))] },
  { id: 'fill-noise', shape: CIRCLE, time: 1.4, effects: [effect({ type: 'none' }, fill('noise', { color1: [0.1, 0, 0.3, 1], color2: [1, 0.8, 0.2, 1] }))] },
  { id: 'anim-concentric', shape: HEX, time: 1.0, effects: [effect(stroke('solid', { width: 2 }), { type: 'none' }, anim('concentric', { count: 4, spacing: 0.05 }))] },
  { id: 'anim-concentric-in', shape: CIRCLE, time: 0.8, effects: [effect(stroke('solid', { width: 2 }), { type: 'none' }, anim('concentric', { count: 5, direction: 'in' }))] },
  { id: 'anim-breathe', shape: HEX, time: 0.3, effects: [effect(stroke('glow', { width: 3 }), { type: 'none' }, anim('breathe'))] },
  { id: 'anim-rotate', shape: HEX, time: 0.5, effects: [effect(stroke('solid', { width: 3 }), fill('solid', { opacity: 0.4 }), anim('rotate', { speed: 1 }))] },
  { id: 'anim-radiate', time: 0.6, effects: [effect(stroke('solid', { width: 2 }), { type: 'none' }, anim('radiate', { rays: 6 }))] },
  { id: 'anim-ripple', shape: CIRCLE, time: 1.5, effects: [effect(stroke('solid', { width: 2 }), { type: 'none' }, anim('ripple'))] },
  { id: 'anim-wave', time: 0.4, effects: [effect(stroke('solid', { width: 3 }), fill('solid', { opacity: 0.5 }), anim('wave', { amplitude: 1.5, frequency: 2 }))] },
  { id: 'anim-glitch', time: 1.25, effects: [effect(stroke('solid', { width: 3 }), { type: 'none' }, anim('glitch', { intensity: 2, blockSize: 0.5 }))] },
];

describe('Edge Effects match the editor renderer', () => {
  let rpc: NativeRpc;
  let references: Record<string, Uint8Array[]> = {};
  beforeAll(async () => {
    if (!hasNativeCore) return;
    rpc = createNativeRpc();
    await startCore(rpc, REF_SIZE, REF_SIZE);
    const cases: ReferenceCase[] = CLASSIC_CASES.map((c) => ({
      id: c.id, width: REF_SIZE, height: REF_SIZE, time: c.time,
      layer: asLayer({ id: c.id, corners: INNER, layerShape: c.shape ?? null, effects: c.effects }), effects: c.effects,
    }));
    const stack = STACK_EFFECTS();
    cases.push({ id: 'stack-8', width: REF_SIZE, height: REF_SIZE, time: 0.75, layer: asLayer({ id: 'stack-8', corners: INNER, layerShape: HEX, effects: stack }), effects: stack });
    references = await renderReferences(cases);
  }, 180000);
  afterAll(async () => { await rpc?.close(); });

  for (const c of CLASSIC_CASES) {
    itIfNativeCore(`draws ${c.id} like the editor`, async () => {
      const native = await renderNative(rpc, [{ id: c.id, corners: INNER, layerShape: c.shape ?? null, effects: c.effects }], REF_SIZE, REF_SIZE, c.time);
      await clearLayers(rpc, [c.id]);
      const reference = compositeReference(references[c.id], c.effects, REF_SIZE, REF_SIZE);
      await dump(`${c.id}-native`, native);
      await dump(`${c.id}-reference`, reference);
      const diff = neighbourhoodDiff(native, reference);
      if (DUMP_DIR) console.log(`[edge-ref] ${c.id} mean=${diff.mean.toFixed(3)} worst=${diff.worst} over=${(diff.overFraction * 100).toFixed(3)}%`);
      // Both draw something (a broken port would draw nothing or everything).
      expect(litPixels(reference)).toBeGreaterThan(30);
      expect(litPixels(native)).toBeGreaterThan(30);
      expect(diff.mean, `${c.id} mean ${diff.mean.toFixed(2)} worst ${diff.worst} over ${(diff.overFraction * 100).toFixed(2)}%`).toBeLessThan(c.tolerance?.mean ?? 1);
      expect(diff.overFraction, `${c.id} pixels off by more than 40: ${(diff.overFraction * 100).toFixed(2)}%`).toBeLessThan(c.tolerance?.over ?? 0.006);
    }, 60000);
  }

  itIfNativeCore('stacks 8 effects with blend modes and opacity like the editor', async () => {
    const stack = STACK_EFFECTS();
    const native = await renderNative(rpc, [{ id: 'stack-8', corners: INNER, layerShape: HEX, effects: stack }], REF_SIZE, REF_SIZE, 0.75);
    await clearLayers(rpc, ['stack-8']);
    const reference = compositeReference(references['stack-8'], stack, REF_SIZE, REF_SIZE);
    await dump('stack-8-native', native);
    await dump('stack-8-reference', reference);
    const diff = neighbourhoodDiff(native, reference);
    if (DUMP_DIR) console.log(`[edge-ref] stack-8 mean=${diff.mean.toFixed(3)} worst=${diff.worst} over=${(diff.overFraction * 100).toFixed(3)}%`);
    // A mismatched pair must fail the same metric: the check has teeth.
    const wrong = compositeReference(references['stack-8'].slice(0, 4), stack.slice(0, 4), REF_SIZE, REF_SIZE);
    expect(neighbourhoodDiff(native, wrong).mean).toBeGreaterThan(1);
    expect(diff.mean, `stack mean ${diff.mean.toFixed(2)} worst ${diff.worst}`).toBeLessThan(1);
    expect(diff.overFraction).toBeLessThan(0.006);
  }, 60000);
});

function STACK_EFFECTS(): EdgeEffect[] {
  return [
    effect({ type: 'none' }, fill('gradient', { color: [0.1, 0.05, 0.3, 1], color2: [0.3, 0.1, 0.1, 1] }), { type: 'none' }, { opacity: 0.9 }),
    effect(stroke('glow', { color: [0, 0.8, 1, 1], width: 3, glowSize: 14 }), { type: 'none' }, { type: 'none' }, { blendMode: 'add' as any }),
    effect(stroke('snake', { color: [1, 0.3, 0.1, 1], width: 5, snakeCount: 2 }), { type: 'none' }, { type: 'none' }, { blendMode: 'screen' as any }),
    effect(stroke('dashed', { color: [1, 1, 1, 1], width: 2 }), { type: 'none' }, { type: 'none' }, { opacity: 0.7 }),
    effect(stroke('solid', { color: [1, 1, 0.2, 1], width: 1.5 }), { type: 'none' }, anim('concentric', { count: 3, direction: 'in' })),
    effect(stroke('scanner', { color: [0.2, 1, 0.3, 1], width: 4 }), { type: 'none' }, { type: 'none' }, { blendMode: 'add' as any, opacity: 0.8 }),
    effect({ type: 'none' }, fill('solid', { color: [0.2, 0.2, 0.9, 1], opacity: 0.35 }), { type: 'none' }, { blendMode: 'multiply' as any }),
    effect(stroke('rainbow', { width: 2 }), { type: 'none' }, anim('ripple'), { opacity: 0.9 }),
  ];
}

// ---------------------------------------------------------------------------
// Crispness
// ---------------------------------------------------------------------------

/** Bilinear red channel (0-1) at output px (x right, y UP). */
function sample(img: Image, x: number, yUp: number): number {
  const y = img.height - yUp;
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const at = (xx: number, yy: number) => {
    if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) return 0;
    return img.rgba[(yy * img.width + xx) * 4] / 255;
  };
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/** Intensity profile across a stroke at `p` (px, y up) along unit normal `n`. */
function profile(img: Image, p: { x: number; y: number }, n: { x: number; y: number }, half = 14, step = 0.02) {
  const out: Array<[number, number]> = [];
  for (let t = -half; t <= half; t += step) out.push([t, sample(img, p.x + n.x * t, p.y + n.y * t)]);
  return out;
}

/** 10 to 90 percent distance of the first rising edge of a profile. */
function riseWidth(prof: Array<[number, number]>): number {
  const peak = Math.max(...prof.map(([, v]) => v));
  const cross = (level: number) => {
    for (let i = 1; i < prof.length; i++) {
      const [t0, v0] = prof[i - 1], [t1, v1] = prof[i];
      if (v0 < level && v1 >= level) return t0 + (level - v0) / (v1 - v0) * (t1 - t0);
    }
    return NaN;
  };
  return cross(peak * 0.9) - cross(peak * 0.1);
}

/**
 * 10 to 90 percent width of a stroke edge, measured on the pixels
 * themselves: each pixel centre near the edge is placed at its exact
 * distance from the ideal edge line, and the ramp is the least-squares line
 * through (distance, value). No resampling, so nothing blurs the answer.
 */
function edgeRamp(img: Image, a: { x: number; y: number }, b: { x: number; y: number }, normal: { x: number; y: number }, offset: number, outward = 1): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const pts: Array<[number, number]> = [];
  const minX = Math.floor(Math.min(a.x, b.x) - 8), maxX = Math.ceil(Math.max(a.x, b.x) + 8);
  const minY = Math.floor(Math.min(a.y, b.y) - 8), maxY = Math.ceil(Math.max(a.y, b.y) + 8);
  for (let yUp = minY; yUp <= maxY; yUp++) {
    for (let x = minX; x <= maxX; x++) {
      const cx = x + 0.5, cy = yUp + 0.5;
      const along = (cx - a.x) * dir.x + (cy - a.y) * dir.y;
      if (along < len * 0.2 || along > len * 0.8) continue;
      const u = (cx - a.x) * normal.x + (cy - a.y) * normal.y - offset;
      if (Math.abs(u) > 2.5) continue;
      const row = img.height - 1 - yUp;
      if (row < 0 || row >= img.height || x < 0 || x >= img.width) continue;
      const v = img.rgba[(row * img.width + x) * 4] / 255;
      if (v > 0.02 && v < 0.98) pts.push([u, v]);
    }
  }
  if (pts.length < 3) return NaN;
  const distinct = new Set(pts.map(([u]) => u.toFixed(3)));
  if (distinct.size < 2) {
    // An axis-aligned edge has a single partly covered column. It must hold
    // exactly the linear one-pixel ramp's value at its distance: 0.8 px 10-90.
    const [u, v] = pts[0];
    const expected = Math.min(1, Math.max(0, 0.5 - outward * u));
    return pts.every(([, value]) => Math.abs(value - expected) < 0.03) ? 0.8 : NaN;
  }
  const mu = pts.reduce((s, [u]) => s + u, 0) / pts.length;
  const mv = pts.reduce((s, [, v]) => s + v, 0) / pts.length;
  let num = 0, den = 0;
  for (const [u, v] of pts) { num += (u - mu) * (v - mv); den += (u - mu) ** 2; }
  const slope = num / den;
  return 0.8 / Math.abs(slope);
}

/** Integral of coverage across the stroke: its width in px. */
function strokeWidthAcross(prof: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 1; i < prof.length; i++) sum += (prof[i][1] + prof[i - 1][1]) / 2 * (prof[i][0] - prof[i - 1][0]);
  return sum;
}

function segmentAt(spec: LayerSpec, width: number, height: number, pick: (a: { x: number; y: number }, b: { x: number; y: number }) => number) {
  const outline = buildEdgeOutline(asLayer(spec), width, height, { cornerRadius: spec.cornerRadius })!;
  let best = { a: outline.points[0], b: outline.points[1], score: -Infinity };
  outline.points.forEach((a, i) => {
    const b = outline.points[(i + 1) % outline.points.length];
    const score = pick(a, b);
    if (score > best.score) best = { a, b, score };
  });
  const len = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y);
  const dir = { x: (best.b.x - best.a.x) / len, y: (best.b.y - best.a.y) / len };
  return { a: best.a, b: best.b, dir, normal: { x: -dir.y, y: dir.x }, outline };
}

const PINNED: WarpCorners = {
  topLeft: { x: 0.36, y: 0.9 }, topRight: { x: 0.64, y: 0.9 },
  bottomLeft: { x: 0.05, y: 0.08 }, bottomRight: { x: 0.95, y: 0.08 },
};
// A third of a pixel off the grid (at 1080p), so flat edges have a ramp to measure.
const PLAIN: WarpCorners = {
  topLeft: { x: 0.1 + 0.33 / 1920, y: 0.9 }, topRight: { x: 0.9 + 0.33 / 1920, y: 0.9 },
  bottomLeft: { x: 0.1 + 0.33 / 1920, y: 0.1 }, bottomRight: { x: 0.9 + 0.33 / 1920, y: 0.1 },
};
const WHITE = [1, 1, 1, 1];

describe('Edge Effects are crisp at output resolution', () => {
  const ramps: Record<string, number> = {};
  for (const [label, width, height] of [['1080p', 1920, 1080], ['4K', 3840, 2160]] as const) {
    itIfNativeCore(`keeps stroke edges within 1.5 px at ${label}, flat and corner pinned`, async () => {
      const rpc = createNativeRpc();
      try {
        await startCore(rpc, width, height);
        for (const [name, corners] of [['flat', PLAIN], ['pinned', PINNED]] as const) {
          const spec: LayerSpec = { id: `ramp-${name}`, corners, effects: [effect(stroke('solid', { width: 6, color: WHITE }))] };
          const img = await renderNative(rpc, [spec], width, height, 0);
          await clearLayers(rpc, [spec.id]);
          await dump(`ramp-${label}-${name}`, img);
          // The left side of the outline, measured square to it.
          const seg = segmentAt(spec, width, height, (a, b) => -(a.x + b.x) - Math.abs(a.y - b.y) * 0.001 + Math.abs(a.y - b.y) * 1e-6);
          // Both sides of the 6 px stroke, measured on the pixels themselves.
          const outer = edgeRamp(img, seg.a, seg.b, seg.normal, 3);
          const inner = edgeRamp(img, seg.a, seg.b, seg.normal, -3, -1);
          expect(outer, `${label} ${name} outer edge`).toBeGreaterThan(0.3);
          expect(outer, `${label} ${name} outer edge`).toBeLessThanOrEqual(1.5);
          expect(inner, `${label} ${name} inner edge`).toBeLessThanOrEqual(1.5);
          ramps[`${label}-${name}`] = Math.max(outer, inner);
          // Cross-check on a resampled profile across the edge.
          const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
          expect(riseWidth(profile(img, mid, seg.normal))).toBeLessThanOrEqual(1.8);
        }
        // The same edge is exactly as sharp on the warped layer as on the flat one.
        expect(Math.abs(ramps[`${label}-pinned`] - ramps[`${label}-flat`])).toBeLessThanOrEqual(0.3);
      } finally { await rpc.close(); }
    }, 120000);
  }

  itIfNativeCore('keeps a 4 px stroke 4 px wide along a perspective-warped edge', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc, 1920, 1080);
      const spec: LayerSpec = { id: 'width-pin', corners: PINNED, effects: [effect(stroke('solid', { width: 4, color: WHITE }))] };
      const img = await renderNative(rpc, [spec], 1920, 1080, 0);
      await dump('width-pinned', img);
      // The slanted left side runs from the wide bottom to the narrow top.
      const seg = segmentAt(spec, 1920, 1080, (a, b) => Math.abs(a.y - b.y) - (a.x + b.x));
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const p = { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
        const w = strokeWidthAcross(profile(img, p, seg.normal));
        expect(Math.abs(w - 4), `width at ${t}: ${w.toFixed(3)}`).toBeLessThanOrEqual(0.5);
      }
      // In surface mode the same stroke follows the perspective: the far
      // (top) end is thinner than the near (bottom) one.
      const surface: LayerSpec = { id: 'width-surface', corners: PINNED, effects: [effect(stroke('solid', { width: 4, color: WHITE, widthMode: 'surface' }))] };
      await clearLayers(rpc, [spec.id]);
      const img2 = await renderNative(rpc, [surface], 1920, 1080, 0);
      const top = seg.a.y > seg.b.y ? seg.a : seg.b;
      const bottom = seg.a.y > seg.b.y ? seg.b : seg.a;
      const near = strokeWidthAcross(profile(img2, { x: bottom.x + (top.x - bottom.x) * 0.1, y: bottom.y + (top.y - bottom.y) * 0.1 }, seg.normal));
      const far = strokeWidthAcross(profile(img2, { x: bottom.x + (top.x - bottom.x) * 0.9, y: bottom.y + (top.y - bottom.y) * 0.9 }, seg.normal));
      expect(far).toBeLessThan(near - 0.5);
    } finally { await rpc.close(); }
  }, 120000);

  itIfNativeCore('draws a 0.5 px line at about half alpha with no gaps along a diagonal', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc, 1024, 1024);
      const diamond: WarpCorners = {
        topLeft: { x: 0.5, y: 0.93 }, topRight: { x: 0.93, y: 0.5 },
        bottomLeft: { x: 0.07, y: 0.5 }, bottomRight: { x: 0.5, y: 0.07 },
      };
      const spec: LayerSpec = { id: 'hairline', corners: diamond, effects: [effect(stroke('solid', { width: 0.5, color: WHITE }))] };
      const img = await renderNative(rpc, [spec], 1024, 1024, 0);
      await dump('hairline', img);
      const seg = segmentAt(spec, 1024, 1024, (a, b) => Math.hypot(b.x - a.x, b.y - a.y));
      const integrals: number[] = [];
      const peaks: number[] = [];
      for (let i = 0; i < 80; i++) {
        const t = 0.1 + 0.8 * (i / 79);
        const p = { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
        const prof = profile(img, p, seg.normal, 4, 0.02);
        integrals.push(strokeWidthAcross(prof));
        peaks.push(Math.max(...prof.map(([, v]) => v)));
      }
      for (const w of integrals) expect(w).toBeGreaterThan(0.4), expect(w).toBeLessThan(0.6);
      // No gaps or beating along the line.
      expect(Math.max(...integrals) - Math.min(...integrals)).toBeLessThan(0.1);
      expect(Math.min(...peaks)).toBeGreaterThan(0.25);
    } finally { await rpc.close(); }
  }, 120000);

  itIfNativeCore('keeps dashes equal along a Bezier curve and a warped edge', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc, 1920, 1080);
      const blob: LayerShape = {
        type: 'custom', enabled: true,
        params: {
          customClosed: true,
          customPoints: [
            { x: 0.5, y: 0.95, cpIn: { x: 0.2, y: 0.95 }, cpOut: { x: 0.8, y: 0.95 } },
            { x: 0.95, y: 0.5, cpIn: { x: 0.95, y: 0.8 }, cpOut: { x: 0.95, y: 0.2 } },
            { x: 0.5, y: 0.05, cpIn: { x: 0.8, y: 0.05 }, cpOut: { x: 0.2, y: 0.05 } },
            { x: 0.05, y: 0.5, cpIn: { x: 0.05, y: 0.2 }, cpOut: { x: 0.05, y: 0.8 } },
          ],
        },
      } as LayerShape;
      for (const [name, corners] of [['bezier', PLAIN], ['bezier-pinned', PINNED]] as const) {
        const spec: LayerSpec = { id: `dash-${name}`, corners, layerShape: blob, effects: [effect(stroke('dashPattern', { width: 4, color: WHITE, dash1: 20, gap1: 14, speed: 0 }))] };
        const img = await renderNative(rpc, [spec], 1920, 1080, 0);
        await clearLayers(rpc, [spec.id]);
        await dump(`dash-${name}`, img);
        const outline = buildEdgeOutline(asLayer(spec), 1920, 1080)!;
        // Walk the centerline by arc length and find each dash's two ends.
        const samples: Array<[number, number]> = [];
        const pts = outline.points;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          for (let d = 0; d < len; d += 0.1) {
            samples.push([outline.cumulative[i] + d, sample(img, a.x + (b.x - a.x) * d / len, a.y + (b.y - a.y) * d / len)]);
          }
        }
        const edges: Array<{ s: number; up: boolean }> = [];
        for (let i = 1; i < samples.length; i++) {
          const [s0, v0] = samples[i - 1], [s1, v1] = samples[i];
          if ((v0 < 0.5) !== (v1 < 0.5)) edges.push({ s: s0 + (0.5 - v0) / (v1 - v0) * (s1 - s0), up: v1 >= 0.5 });
        }
        const lengths: number[] = [];
        for (let i = 0; i < edges.length - 1; i++) {
          if (edges[i].up && !edges[i + 1].up) lengths.push(edges[i + 1].s - edges[i].s);
        }
        expect(lengths.length).toBeGreaterThan(20);
        const mean = lengths.reduce((s, v) => s + v, 0) / lengths.length;
        const fit = outline.length / (Math.round(outline.length / 34) * 34);
        expect(Math.abs(mean - 20 * fit), `${name} mean dash ${mean.toFixed(3)}`).toBeLessThan(0.5);
        for (const len of lengths) expect(Math.abs(len - mean), `${name} dash ${len.toFixed(3)} vs ${mean.toFixed(3)}`).toBeLessThanOrEqual(0.5);
      }
    } finally { await rpc.close(); }
  }, 120000);
});
