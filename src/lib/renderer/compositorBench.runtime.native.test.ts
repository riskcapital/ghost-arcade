// Compositor scene set: the same scenes drawn by cores started with
// different compositor settings, compared pixel for pixel, and (with
// GA_CORE_COMPOSITOR_BENCH=1) timed.
//
// Scenes: plain image quads, Bezier mesh warps, polygon masks, Edge
// Effects, hierarchy masks, every blend mode, the dome output and minified
// pictures. The
// comparison runs by default and fails when a setting that must not change
// the picture does. The benchmark prints, per scene and setting, the GPU
// time of the composite pass (the frame timer) and the layer data the
// core uploads per frame while one layer moves (GA_CORE_CHURN_PROBE).
//
// GA_CORE_COMPOSITOR_BENCH_ENV='{"name":{"GA_X":"1"},...}' picks the
// settings the benchmark compares (default: source mips on and off).
// The raster compositor (GA_CORE_COMPOSITOR=raster) is compared with the
// legacy one on every scene too; the benchmark also prints the CPU time of
// the frame's render call.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { EdgeEffect, Layer, WarpCorners } from '../types';
import { buildEdgeEffectContext, nativeEdgeEffectPayload } from '../drawing/edgeEffects';
import { edgeTypeDefaults } from '../drawing/edgeEffectCatalog';
import { closeNativeTestCore, gpuTestPlatform as platform, rpcDeadlineScale } from './nativeHardwareTestPlatform';

type Command = Record<string, unknown>;
type Env = Record<string, string>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const bench = process.env.GA_CORE_COMPOSITOR_BENCH === '1';

/** `env.CORE_BINARY`, when set, names another core build to run (a
 *  before/after comparison); the rest is the core's environment. */
function core(env: Env) {
  const { CORE_BINARY: binary, ...rest } = env;
  const child = spawn(binary || platform.binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...rest },
  });
  let nextId = 0;
  let stderr = '';
  let stopped: Error | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    stopped = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('error', fail);
  child.stdin.on('error', () => { /* the exit handler reports why */ });
  child.on('exit', (code, signal) => fail(new Error(`native core exited (${code ?? signal}): ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch { /* non-JSON core output */ }
  });
  const send = (method: string, params: Command = {}, timeoutMs = 20000): Promise<any> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); },
        timeoutMs * rpcDeadlineScale);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      // A failed write means the core is gone: its exit handler says why.
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, () => {});
    });
  };
  return {
    send,
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}

// ---------------------------------------------------------------------------
// Pictures and scenes
// ---------------------------------------------------------------------------

/** Fine stripes and a checker: the pattern that shimmers when minified. */
function patternFrame(size: number, seed: number): string {
  const bytes = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const checker = ((x >> 1) + (y >> 1) + seed) & 1;
      bytes[i] = checker ? 240 : 20;
      bytes[i + 1] = Math.round(255 * x / Math.max(1, size - 1));
      bytes[i + 2] = ((x + y * 3 + seed * 7) % 9) < 4 ? 220 : 40;
      bytes[i + 3] = 255;
    }
  }
  return bytes.toString('base64');
}

const corners = (x: number, y: number, w: number, h: number): WarpCorners => ({
  // Native corners are y-up (0 bottom, 1 top).
  topLeft: { x, y: 1 - y }, topRight: { x: x + w, y: 1 - y },
  bottomRight: { x: x + w, y: 1 - y - h }, bottomLeft: { x, y: 1 - y - h },
});

function imageLayer(id: string, z: number, size: number, seed: number, layerCorners: WarpCorners, extra: Command = {}): Command[] {
  return [
    { type: 'upload_source_frame', source_id: id, width: size, height: size, seq: 1, rgba_b64: patternFrame(size, seed) },
    { type: 'upsert_layer', layer_id: id, opacity: 0.85, z_index: z, corners: layerCorners, ...extra },
    { type: 'bind_media_source', layer_id: id, source_id: id, source_type: 'image', uri: `memory://${id}` },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
  ];
}

/** A picture no larger than `fraction` of the canvas shows it: magnified,
 *  so source mips must not change it. */
function fit(width: number, height: number, fraction: number): number {
  const px = Math.min(width, height) * fraction * 0.6;
  return Math.max(8, Math.min(256, 2 ** Math.floor(Math.log2(Math.max(1, px)))));
}

function grid(count: number, fill: (index: number, x: number, y: number, w: number, h: number) => Command[]): Command[] {
  const side = Math.ceil(Math.sqrt(count));
  const w = 1 / side;
  const commands: Command[] = [];
  for (let i = 0; i < count; i++) {
    commands.push(...fill(i, (i % side) * w, Math.floor(i / side) * w, w, w));
  }
  return commands;
}

function bezierMesh(rows: number, cols: number, wobble: number, seed: number) {
  const points = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const inner = r > 0 && r < rows - 1 && c > 0 && c < cols - 1;
    const dx = inner ? wobble * Math.sin(seed + r * 1.7 + c * 0.9) / (cols - 1) : 0;
    const dy = inner ? wobble * Math.cos(seed + r * 0.8 + c * 1.3) / (rows - 1) : 0;
    return { x: c / (cols - 1) + dx, y: 1 - r / (rows - 1) + dy };
  }));
  const h = 1 / (cols - 1);
  const tangents = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({
    right: { x: h / 3, y: wobble * 0.3 * h * Math.sin(seed + r + c) },
    down: { x: wobble * 0.3 * h * Math.cos(seed + r - c), y: -h / 3 },
  })));
  return { rows, cols, points, bezier: true, tangents };
}

function circleMask(points: number) {
  const packed: Array<[number, number, number, number]> = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = 0.42 + 0.06 * Math.sin(a * 5);
    packed.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a), (i + 1) % points, 0]);
  }
  return { mask_info: [1, 0, 0.02, points], mask_points: packed };
}

const BLEND_MODES = ['normal', 'add', 'multiply', 'screen', 'overlay', 'subtract', 'difference', 'lighten', 'darken',
  'average', 'hardlight', 'softlight', 'exclusion', 'color-dodge', 'color-burn', 'hue', 'saturation', 'color',
  'luminosity', 'divide', 'negation', 'phoenix', 'linear-light', 'hard-mix', 'vivid-light', 'pin-light'];

type EdgeSpec = {
  id: string; corners: WarpCorners; stroke: string; fill?: string; effectBlend?: string;
  /** The layer's own blend mode and opacity; a colour layer when rgba is set. */
  extra?: Command; rgba?: [number, number, number, number];
};

function edgeLayersFrom(width: number, height: number, specs: EdgeSpec[]): Command[] {
  const effect = (spec: EdgeSpec) => ({
    id: `${spec.id}-fx`, enabled: true, opacity: 1, blendMode: spec.effectBlend ?? 'normal',
    stroke: { ...edgeTypeDefaults('stroke', spec.stroke), width: 3, ...(spec.stroke === 'glow' ? { glowSize: 14 } : {}) },
    fill: spec.fill ? edgeTypeDefaults('fill', spec.fill) : { type: 'none' }, animation: { type: 'none' },
  }) as unknown as EdgeEffect;
  const layers = specs.map(spec => ({
    id: spec.id, layerShape: null, corners: spec.corners, warpMode: 'corners', meshGrid: null,
    edgeEffects: { enabled: true, effects: [effect(spec)] },
  }) as unknown as Layer);
  const context = buildEdgeEffectContext(layers, width, height);
  const commands: Command[] = [];
  specs.forEach((spec, i) => {
    const payload = nativeEdgeEffectPayload(layers[i], width, height, context);
    commands.push(
      ...(spec.rgba
        ? colorLayer(spec.id, i, spec.rgba, spec.corners, spec.extra)
        : imageLayer(spec.id, i, fit(width, height, 0.2), i, spec.corners, spec.extra)),
      {
        type: 'set_layer_edge_effects', layer_id: spec.id,
        edge_effects: payload?.effects ?? [], edge_outline: payload?.outline ?? [], edge_corners: payload?.corners ?? [],
        edge_diagonals: payload?.diagonals ?? [], edge_geometry: payload?.geometry ?? [0, 0, 0, 0],
        edge_seed: payload?.seed ?? 0, edge_bounds: payload?.bounds ?? [0, 0, 0, 0],
      },
    );
  });
  return commands;
}

function edgeLayers(width: number, height: number, count: number): Command[] {
  return edgeLayersFrom(width, height, Array.from({ length: count }, (_, i) => {
    const side = Math.ceil(Math.sqrt(count));
    const w = 1 / side;
    const x = (i % side) * w + w * 0.15;
    const y = Math.floor(i / side) * w + w * 0.15;
    return { id: `edge-${i}`, corners: corners(x, y, w * 0.7, w * 0.7), stroke: 'glow' };
  }));
}

/** A hierarchy mask: `points` ([x, y] in the layer, y down) as one shape. */
function maskLayer(id: string, z: number, layerCorners: WarpCorners, points: Array<[number, number]>, inverted = false,
  feather = 0, extra: Command = {}): Command[] {
  return [
    { type: 'upsert_layer', layer_id: id, opacity: 1, z_index: z, blend_mode: 'hierarchy-mask', corners: layerCorners,
      mask_info: [1, inverted ? 1 : 0, feather, points.length],
      mask_points: points.map(([x, y], i) => [x, y, (i + 1) % points.length, 0]), ...extra },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
  ];
}

function ring(count: number, radius: number, wobble: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = radius + wobble * Math.sin(a * 3);
    return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)] as [number, number];
  });
}

type Scene = {
  name: string;
  /** Pictures minified on screen: source mips may change these. */
  minified?: boolean;
  build(width: number, height: number): Command[];
  /** The layer moved once per frame in the upload measurement. */
  mover: string;
};

/** A spread of sizes (0.1 to 0.45 of the canvas) and places that is the
 *  same on every run. Pictures on these are fitted to the smallest size,
 *  so source mips leave them be. */
function scatter(count: number, seed: number) {
  let state = seed;
  const next = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  return Array.from({ length: count }, () => {
    const w = 0.1 + next() * 0.35;
    const h = 0.1 + next() * 0.35;
    return { x: next() * (1 - w), y: next() * (1 - h), w, h, a: next() };
  });
}

function colorLayer(id: string, z: number, rgba: [number, number, number, number], layerCorners: WarpCorners, extra: Command = {}): Command[] {
  return [
    { type: 'upsert_layer', layer_id: id, opacity: 0.8, z_index: z, corners: layerCorners, ...extra },
    { type: 'set_layer_color', layer_id: id, rgba },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
  ];
}

const SCENES: Scene[] = [
  {
    name: 'plain-quads-64', mover: 'quad-0',
    build: (width, height) => grid(64, (i, x, y, w, h) => imageLayer(`quad-${i}`, i, fit(width, height, 1 / 8), i, corners(x, y, w, h))),
  },
  {
    name: 'plain-quads-256', mover: 'quad-0',
    build: (width, height) => grid(256, (i, x, y, w, h) => imageLayer(`quad-${i}`, i, fit(width, height, 1 / 16), i, corners(x, y, w, h))),
  },
  {
    name: 'perspective-quads', mover: 'persp-0',
    build: (width, height) => grid(16, (i, x, y, w, h) => imageLayer(`persp-${i}`, i, fit(width, height, 1 / 8), i, {
      topLeft: { x: x + w * 0.1, y: 1 - y }, topRight: { x: x + w * 0.9, y: 1 - y - h * 0.1 },
      bottomRight: { x: x + w, y: 1 - y - h }, bottomLeft: { x, y: 1 - y - h * 0.8 },
    }, { corner_perspective: true })),
  },
  {
    name: 'bezier-mesh', mover: 'mesh-0',
    build: (width, height) => grid(4, (i, x, y, w, h) => imageLayer(`mesh-${i}`, i, fit(width, height, 1 / 4), i, corners(x, y, w, h),
      { mesh_grid: bezierMesh(6, 6, 0.25, i) })),
  },
  {
    name: 'masked', mover: 'mask-0',
    build: (width, height) => grid(16, (i, x, y, w, h) => imageLayer(`mask-${i}`, i, fit(width, height, 1 / 4), i, corners(x, y, w, h), circleMask(48))),
  },
  { name: 'edge-effects', mover: 'edge-0', build: (width, height) => edgeLayers(width, height, 9) },
  {
    name: 'blend-modes', mover: 'blend-0',
    build: (width, height) => BLEND_MODES.flatMap((mode, i) => imageLayer(`blend-${i}`, i, fit(width, height, 0.9), i,
      corners(0.02 * (i % 5), 0.02 * Math.floor(i / 5), 0.9, 0.9), { blend_mode: mode, opacity: 0.6 })),
  },
  {
    name: 'dome', mover: 'dome-0',
    build: (width, height) => [
      { type: 'set_output_stage', domeEnabled: true, domeMode: 0, domeFOV: 180 },
      // The dome squeezes the canvas toward its rim: small pictures.
      ...grid(9, (i, x, y, w, h) => imageLayer(`dome-${i}`, i, fit(width, height, 1 / 24), i, corners(x, y, w, h))),
    ],
  },
  {
    // Many layers stacked on each other, each with its own opacity.
    name: 'overlap-quads-128', mover: 'over-0',
    build: (width, height) => scatter(128, 7).flatMap((r, i) => imageLayer(`over-${i}`, i, fit(width, height, 0.1), i,
      corners(r.x, r.y, r.w, r.h), { opacity: 0.25 + 0.7 * r.a })),
  },
  {
    // Bezier meshes and perspective pins lying across each other.
    name: 'overlap-warps', mover: 'warp-0',
    build: (width, height) => scatter(12, 11).flatMap((r, i) => imageLayer(`warp-${i}`, i, fit(width, height, 0.05), i,
      i % 2 ? {
        topLeft: { x: r.x + r.w * 0.2, y: 1 - r.y }, topRight: { x: r.x + r.w, y: 1 - r.y - r.h * 0.15 },
        bottomRight: { x: r.x + r.w * 0.9, y: 1 - r.y - r.h }, bottomLeft: { x: r.x, y: 1 - r.y - r.h * 0.85 },
      } : corners(r.x, r.y, r.w, r.h),
      i % 2 ? { corner_perspective: true, opacity: 0.7 } : { mesh_grid: bezierMesh(5, 5, 0.3, i), opacity: 0.7 })),
  },
  {
    // Feathered ellipses, stars and masked shapes: soft and anti-aliased edges.
    name: 'alpha-edges', mover: 'shape-0',
    build: (width, height) => scatter(24, 5).flatMap((r, i) => imageLayer(`shape-${i}`, i, fit(width, height, 0.1), i,
      corners(r.x, r.y, r.w, r.h), {
        opacity: 0.5 + 0.5 * r.a,
        ...(i % 3 === 0 ? { shape: [3, 0.04, 0, 1], shape2: [0.9, 0.7, 6, 0.4] }
          : i % 3 === 1 ? { shape: [5, 0, 0.3, 1], shape2: [1, 1, 5, 0.45] }
          : circleMask(24)),
      })),
  },
  {
    // Normal, Screen and Multiply in hardware, Add by reading the stack back.
    name: 'blend-common', mover: 'common-0',
    build: (width, height) => scatter(16, 3).flatMap((r, i) => imageLayer(`common-${i}`, i, fit(width, height, 0.1), i,
      corners(r.x, r.y, r.w, r.h), {
        blend_mode: i === 5 || i === 11 ? 'add' : ['normal', 'screen', 'multiply', 'normal'][i % 4],
        opacity: 0.5 + 0.5 * r.a,
      })),
  },
  {
    // Source-less colour rectangles (the plain-fill path) under pictures.
    name: 'color-layers', mover: 'color-0',
    build: (width, height) => scatter(32, 9).flatMap((r, i) => i % 2
      ? colorLayer(`color-${i}`, i, [r.a, 1 - r.a, 0.5, 1], corners(r.x, r.y, r.w, r.h), { blend_mode: i % 4 === 1 ? 'screen' : 'normal' })
      : imageLayer(`color-${i}`, i, fit(width, height, 0.1), i, corners(r.x, r.y, r.w, r.h), { opacity: 0.6 })),
  },
  {
    // Edge Effects of several kinds on overlapping layers that blend in
    // hardware and by reading the stack back, on pictures and colour layers.
    name: 'edge-effects-mixed', mover: 'edgemix-0',
    build: (width, height) => edgeLayersFrom(width, height, scatter(10, 13).map((r, i) => ({
      id: `edgemix-${i}`, corners: corners(r.x, r.y, r.w, r.h),
      stroke: ['neon', 'electric', 'dashed', 'offset', 'fire', 'solid'][i % 6],
      fill: i % 3 === 0 ? 'solid' : i % 3 === 1 ? 'gradient' : undefined,
      effectBlend: ['normal', 'screen', 'add', 'difference'][i % 4],
      extra: { blend_mode: ['normal', 'screen', 'overlay', 'normal', 'difference'][i % 5], opacity: 0.6 + 0.4 * r.a },
      rgba: i % 4 === 3 ? [r.a, 0.4, 1 - r.a, 1] as [number, number, number, number] : undefined,
    }))),
  },
  {
    // Edge Effects whose glow reaches past the canvas edge and over its
    // neighbours, with a mesh-warped and a perspective layer.
    name: 'edge-effects-warped', mover: 'edgewarp-0',
    build: (width, height) => [
      ...edgeLayersFrom(width, height, [
        { id: 'edgewarp-0', corners: corners(-0.05, 0.1, 0.5, 0.6), stroke: 'glow' },
        { id: 'edgewarp-1', corners: corners(0.3, 0.3, 0.5, 0.5), stroke: 'neon', extra: { corner_perspective: true } },
        { id: 'edgewarp-2', corners: corners(0.55, 0.05, 0.5, 0.5), stroke: 'glow', fill: 'solid',
          extra: { mesh_grid: bezierMesh(5, 5, 0.3, 2), blend_mode: 'screen' } },
      ]),
    ],
  },
  {
    // Hierarchy masks over the layers below them, one inside another: an
    // outer wobbly ring, an inverted feathered square inside it, a
    // perspective-pinned mask, with layers between them.
    name: 'group-masks', mover: 'gm-0',
    build: (width, height) => [
      ...colorLayer('gm-bg', 0, [0.2, 0.3, 0.8, 1], corners(0, 0, 1, 1)),
      ...scatter(8, 21).flatMap((r, i) => imageLayer(`gm-${i}`, 1 + i, fit(width, height, 0.1), i, corners(r.x, r.y, r.w, r.h),
        { opacity: 0.7, blend_mode: i % 3 === 2 ? 'overlay' : 'normal' })),
      ...maskLayer('gm-mask-outer', 9, corners(0.05, 0.05, 0.9, 0.9), ring(40, 0.42, 0.05), false, 0.03),
      ...scatter(6, 23).flatMap((r, i) => imageLayer(`gm-in-${i}`, 10 + i, fit(width, height, 0.1), 10 + i,
        corners(r.x, r.y, r.w, r.h), { opacity: 0.8, blend_mode: i % 2 ? 'screen' : 'normal' })),
      ...maskLayer('gm-mask-inner', 16, corners(0.3, 0.25, 0.4, 0.5), [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], true, 0.05),
      ...colorLayer('gm-top', 17, [1, 0.6, 0.1, 0.5], corners(0.4, 0.4, 0.3, 0.3)),
      ...maskLayer('gm-mask-persp', 18, {
        topLeft: { x: 0.1, y: 0.95 }, topRight: { x: 0.8, y: 0.9 },
        bottomRight: { x: 0.95, y: 0.1 }, bottomLeft: { x: 0.05, y: 0.05 },
      }, ring(24, 0.45, 0.0), false, 0, { corner_perspective: true }),
      ...imageLayer('gm-over', 19, fit(width, height, 0.3), 3, corners(0.6, 0.6, 0.35, 0.35), { blend_mode: 'difference' }),
    ],
  },
  {
    // Many read-back blends side by side: one pass reads them all.
    name: 'readback-tiles', mover: 'rbt-0',
    build: (width, height) => grid(48, (i, x, y, w, h) => imageLayer(`rbt-${i}`, i, fit(width, height, 1 / 8), i,
      corners(x + w * 0.05, y + w * 0.05, w * 0.9, h * 0.9), { blend_mode: BLEND_MODES[1 + (i % 25)], opacity: 0.7 })),
  },
  {
    // Read-back blends over pictures below them, a few at a time
    // overlapping: several passes.
    name: 'readback-layers', mover: 'rbl-0',
    build: (width, height) => [
      ...grid(16, (i, x, y, w, h) => imageLayer(`rbl-${i}`, i, fit(width, height, 1 / 4), i, corners(x, y, w, h))),
      ...scatter(12, 17).flatMap((r, i) => imageLayer(`rbl-top-${i}`, 16 + i, fit(width, height, 0.1), 16 + i,
        corners(r.x, r.y, r.w, r.h), { blend_mode: ['overlay', 'difference', 'softlight', 'hue', 'add', 'color-dodge'][i % 6],
          opacity: 0.5 + 0.5 * r.a })),
    ],
  },
  {
    // The worst case for passes: colour layers over the whole canvas, each
    // reading the stack the one before it changed.
    name: 'readback-colors', mover: 'rbc-0',
    build: () => Array.from({ length: 16 }, (_, i) => colorLayer(`rbc-${i}`, i,
      [(i * 37 % 16) / 16, (i * 11 % 16) / 16, 0.5, 1], corners(0, 0, 1, 1),
      { blend_mode: i === 0 ? 'normal' : ['overlay', 'difference', 'softlight', 'exclusion'][i % 4], opacity: 0.7 })).flat(),
  },
  {
    name: 'minified', minified: true, mover: 'mini-0',
    build: () => grid(16, (i, x, y, w, h) => imageLayer(`mini-${i}`, i, 1024, i, corners(x, y, w, h))),
  },
  {
    name: 'minified-mesh', minified: true, mover: 'minimesh-0',
    build: () => grid(4, (i, x, y, w, h) => imageLayer(`minimesh-${i}`, i, 1024, i, corners(x, y, w, h),
      { mesh_grid: bezierMesh(6, 6, 0.35, i) })),
  },
  {
    name: 'minified-perspective', minified: true, mover: 'minipersp-0',
    build: () => grid(4, (i, x, y, w, h) => imageLayer(`minipersp-${i}`, i, 1024, i, {
      topLeft: { x: x + w * 0.3, y: 1 - y }, topRight: { x: x + w * 0.7, y: 1 - y },
      bottomRight: { x: x + w, y: 1 - y - h }, bottomLeft: { x, y: 1 - y - h },
    }, { corner_perspective: true })),
  },
];

// ---------------------------------------------------------------------------
// Running a scene
// ---------------------------------------------------------------------------

type Run = {
  pixels: Buffer; width: number; height: number; bgra: boolean; gpuMs: number | null; gpuP10: number | null;
  cpuMs: number | null; passes: string; layerBytesPerFrame: number | null;
  /** GA_CORE_COMPOSITOR=raster: frames it drew and why it last did not. */
  raster: { frames: number; fallback_frames: number; last_fallback: string; last_passes?: number } | null;
};

async function renderScene(env: Env, scene: Scene, width: number, height: number, timed: boolean): Promise<Run> {
  // Timed runs keep one frame in flight, so each reading is one frame's own GPU work.
  const rpc = core({ ...env, ...(timed ? { GA_CORE_CHURN_PROBE: '1', GA_CORE_MAX_FRAMES_IN_FLIGHT: '1' } : {}) });
  try {
    const started = await rpc.send('start', { config: {
      backend: platform.rendererBackend, width, height, target_fps: 60, native_quality_policy: 'fixed',
    } }, 30000);
    expect(started?.backend_ready).toBe(true);
    // The compositor build with source mips is made on a worker after start.
    if (env.GA_CORE_SOURCE_MIPS === '1' && !env.CORE_BINARY) {
      const ready = Date.now() + 30000;
      while (!(await rpc.send('capabilities'))?.features?.compositor_source_mips_ready && Date.now() < ready) await sleep(50);
    }
    // So is the raster compositor.
    if (env.GA_CORE_COMPOSITOR === 'raster' && !env.CORE_BINARY) {
      const ready = Date.now() + 30000;
      while (!(await rpc.send('capabilities'))?.features?.compositor_raster_ready && Date.now() < ready) await sleep(50);
    }
    await rpc.send('set_render_clock', { mode: 'manual', time: 1.25 });
    const commands = [...scene.build(width, height), { type: 'present' }];
    // The core takes at most 1024 commands and 64 MiB a message.
    let batch: Command[] = [];
    let bytes = 0;
    for (const command of commands) {
      const size = JSON.stringify(command).length;
      if (batch.length && (batch.length >= 1000 || bytes + size > 24 << 20)) {
        await rpc.send('submit_commands', { commands: batch });
        batch = [];
        bytes = 0;
      }
      batch.push(command);
      bytes += size;
    }
    if (batch.length) await rpc.send('submit_commands', { commands: batch });
    // Settle: pipelines built, every picture uploaded and drawn.
    await sleep(400);
    await rpc.send('submit_commands', { commands: [{ type: 'present' }] });
    await rpc.send('frame_snapshot', {});
    const frame = await rpc.send('frame_snapshot', { include_pixels: true });
    const pixels = Buffer.from(frame.rgba_b64, 'base64');
    let gpuMs: number | null = null;
    let gpuP10: number | null = null;
    let cpuMs: number | null = null;
    let passes = '';
    let layerBytesPerFrame: number | null = null;
    if (timed) {
      const seconds = Number(process.env.GA_CORE_COMPOSITOR_BENCH_SECONDS ?? 3);
      // GPU time of the composite: the frame timer's last reading (the
      // output composite pass), sampled while the scene stands still.
      const samples: number[] = [];
      const cpuSamples: number[] = [];
      let lastSampled = 0;
      const timeEnd = performance.now() + seconds * 1000;
      while (performance.now() < timeEnd) {
        await sleep(20);
        const status = await rpc.send('status');
        const sampled = Number(status.gpu_timing_samples ?? 0);
        const ms = Number(status.last_render_gpu_ms ?? 0);
        if (ms > 0 && sampled !== lastSampled) { samples.push(ms); lastSampled = sampled; }
        // CPU time of the render call (encoding and submitting the frame),
        // the core's running average.
        const cpu = Number(status.avg_render_cpu_ms ?? 0);
        if (cpu > 0) cpuSamples.push(cpu);
      }
      cpuSamples.sort((a, b) => a - b);
      cpuMs = cpuSamples.length ? cpuSamples[Math.floor(cpuSamples.length / 2)] : null;
      samples.sort((a, b) => a - b);
      gpuMs = samples.length ? samples[Math.floor(samples.length / 2)] : null;
      gpuP10 = samples.length ? samples[Math.floor(samples.length * 0.1)] : null;
      passes = `${samples.length} samples, p10 ${samples[Math.floor(samples.length * 0.1)]?.toFixed(3)} p90 ${samples[Math.floor(samples.length * 0.9)]?.toFixed(3)}`;
      // Layer data uploaded per frame while one layer moves.
      const before = await rpc.send('status');
      const moveEnd = performance.now() + 1500;
      let step = 0;
      while (performance.now() < moveEnd) {
        const dx = 0.002 * (step++ % 10);
        await rpc.send('submit_commands', { commands: [{ type: 'upsert_layer', layer_id: scene.mover, opacity: 0.85,
          corners: corners(dx, 0, 0.1, 0.1) }] });
        await sleep(8);
      }
      const after = await rpc.send('status');
      const frames = Math.max(1, after.gpu_frames_submitted - before.gpu_frames_submitted);
      if (before.gpu_object_churn?.layer_bytes !== undefined && after.gpu_object_churn?.layer_bytes !== undefined) {
        layerBytesPerFrame = (after.gpu_object_churn.layer_bytes - before.gpu_object_churn.layer_bytes) / frames;
      }
    }
    const raster = (await rpc.send('stats'))?.compositor_raster ?? null;
    return { pixels, width: Number(frame.width), height: Number(frame.height),
      bgra: String(frame.format).toLowerCase().startsWith('bgra'), gpuMs, gpuP10, cpuMs, passes, layerBytesPerFrame, raster };
  } finally {
    await rpc.close();
  }
}

/** GA_CORE_COMPOSITOR_BENCH_DUMP=<dir>: write each run as a PNG there. */
function dump(name: string, run: Run, bgra: boolean) {
  const dir = process.env.GA_CORE_COMPOSITOR_BENCH_DUMP;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const png = new PNG({ width: run.width, height: run.height });
  for (let i = 0; i < run.width * run.height; i++) {
    png.data[i * 4] = run.pixels[i * 4 + (bgra ? 2 : 0)];
    png.data[i * 4 + 1] = run.pixels[i * 4 + 1];
    png.data[i * 4 + 2] = run.pixels[i * 4 + (bgra ? 0 : 2)];
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(join(dir, `${name}.png`), PNG.sync.write(png));
}

function difference(a: Run, b: Run) {
  let max = 0;
  let differing = 0;
  for (let i = 0; i < Math.min(a.pixels.length, b.pixels.length); i++) {
    const d = Math.abs(a.pixels[i] - b.pixels[i]);
    if (d > 0) differing++;
    if (d > max) max = d;
  }
  return { max, differing: differing / Math.max(1, a.pixels.length) };
}

/** Where two runs differ by more than the raster tolerance, and by how much. */
function differenceOver(a: Run, b: Run, tolerance: number) {
  let over = 0;
  for (let i = 0; i < Math.min(a.pixels.length, b.pixels.length); i++) {
    if (Math.abs(a.pixels[i] - b.pixels[i]) > tolerance) over++;
  }
  return over;
}

function rasterNote(run: Run) {
  if (!run.raster) return '';
  return run.raster.fallback_frames > 0 && run.raster.frames === 0
    ? `, legacy (${run.raster.last_fallback})`
    : `, raster ${run.raster.frames}/${run.raster.frames + run.raster.fallback_frames} frames`
      + `${run.raster.last_passes ? ` (${run.raster.last_passes} pass${run.raster.last_passes > 1 ? 'es' : ''})` : ''}`
      + `${run.raster.fallback_frames > 0 ? `, last fallback: ${run.raster.last_fallback}` : ''}`;
}

function compareEnvs(): Record<string, Env> {
  const raw = process.env.GA_CORE_COMPOSITOR_BENCH_ENV;
  if (raw) return JSON.parse(raw);
  return { default: {}, 'mips-on': { GA_CORE_SOURCE_MIPS: '1' } };
}

const suite = platform.runnable ? describe : describe.skip;
suite('Compositor scene set', () => {
  it('draws every scene the same with source mips on and off, except minified pictures', async () => {
    const width = 640;
    const height = 360;
    for (const scene of SCENES) {
      if (process.env.GA_CORE_COMPOSITOR_BENCH_TRACE) console.log(`scene ${scene.name}`);
      const off = await renderScene({ GA_CORE_SOURCE_MIPS: '0' }, scene, width, height, false);
      const on = await renderScene({ GA_CORE_SOURCE_MIPS: '1' }, scene, width, height, false);
      dump(`${scene.name}-mips-off`, off, off.bgra);
      dump(`${scene.name}-mips-on`, on, on.bgra);
      const diff = difference(off, on);
      if (scene.minified) {
        // Mips soften what level 0 aliases: the picture changes.
        expect(diff.differing, `${scene.name}: mips change minified pictures`).toBeGreaterThan(0.05);
      } else {
        expect(diff.max, `${scene.name}: max channel difference`).toBe(0);
      }
    }
  }, 240000);

  // The raster compositor draws what the legacy one does. Its hardware
  // blends compute the blend in a different order, which can round a value
  // on an 8-bit step boundary to the next step (RASTER_TOLERANCE_LSB), so a
  // channel may differ by 1 on a few pixels; never by more.
  it('draws every scene the same with the raster compositor as with the legacy one', async () => {
    const width = 640;
    const height = 360;
    // Minified pictures are compared with source mips on too, where both
    // read the mips.
    const runs = SCENES.flatMap(scene => [{ scene, env: {} as Env, tag: '' },
      ...(scene.minified ? [{ scene, env: { GA_CORE_SOURCE_MIPS: '1' } as Env, tag: '-mips' }] : [])]);
    for (const { scene, env, tag } of runs) {
      const legacy = await renderScene(env, scene, width, height, false);
      const raster = await renderScene({ ...env, GA_CORE_COMPOSITOR: 'raster' }, scene, width, height, false);
      dump(`${scene.name}${tag}-legacy`, legacy, legacy.bgra);
      dump(`${scene.name}${tag}-raster`, raster, raster.bgra);
      const diff = difference(legacy, raster);
      if (process.env.GA_CORE_COMPOSITOR_BENCH_TRACE) {
        console.log(`scene ${scene.name}${tag}: max diff ${diff.max}, differing ${(diff.differing * 100).toFixed(4)}%${rasterNote(raster)}`);
      }
      expect(diff.max, `${scene.name}${tag}: max channel difference`).toBeLessThanOrEqual(1);
      expect(diff.differing, `${scene.name}${tag}: share of channels off by one`).toBeLessThan(0.001);
      expect(differenceOver(legacy, raster, 1)).toBe(0);
    }
  }, 420000);

  (bench ? it : it.skip)('benchmark: composite GPU time and layer upload per frame', async () => {
    const width = Number(process.env.GA_CORE_COMPOSITOR_BENCH_WIDTH ?? 1920);
    const height = Number(process.env.GA_CORE_COMPOSITOR_BENCH_HEIGHT ?? 1080);
    const envs = compareEnvs();
    const lines: string[] = [`compositor benchmark ${width}x${height}`];
    // GA_CORE_COMPOSITOR_BENCH_SCENES=a,b times only those scenes.
    const only = (process.env.GA_CORE_COMPOSITOR_BENCH_SCENES ?? '').split(',').filter(Boolean);
    for (const scene of SCENES.filter(scene => !only.length || only.includes(scene.name))) {
      // Each setting runs twice, interleaved (A B A B), and keeps its
      // better median: other GPU work on the machine only ever adds time.
      const runs: Array<[string, Run]> = [];
      const rounds = Number(process.env.GA_CORE_COMPOSITOR_BENCH_ROUNDS ?? 2);
      const best = new Map<string, Run>();
      for (let round = 0; round < rounds; round++) {
        for (const [name, env] of Object.entries(envs)) {
          const run = await renderScene(env, scene, width, height, true);
          const kept = best.get(name);
          if (!kept || (run.gpuMs ?? Infinity) < (kept.gpuMs ?? Infinity)) best.set(name, run);
        }
      }
      for (const [name, run] of best) {
        runs.push([name, run]);
        lines.push(`  ${scene.name.padEnd(20)} ${name.padEnd(12)} gpu median ${run.gpuMs?.toFixed(2) ?? 'n/a'} ms, p10 ${run.gpuP10?.toFixed(2) ?? 'n/a'} ms, cpu median ${run.cpuMs?.toFixed(2) ?? 'n/a'} ms, layer upload ${run.layerBytesPerFrame?.toFixed(0) ?? 'n/a'} B/frame${rasterNote(run)}`);
      }
      for (const [name, run] of runs.slice(1)) {
        const diff = difference(runs[0][1], run);
        lines.push(`  ${''.padEnd(20)} ${runs[0][0]} vs ${name}: max diff ${diff.max}, differing ${(diff.differing * 100).toFixed(3)}%`);
      }
    }
    console.log(lines.join('\n'));
    if (process.env.GA_CORE_COMPOSITOR_BENCH_OUT) writeFileSync(process.env.GA_CORE_COMPOSITOR_BENCH_OUT, `${lines.join('\n')}\n`);
  }, 900000);
});
