// What the mapping tools cost on the phone's output compositor: 16 surfaces as
// corner quads, dense and curved meshes, free-form shapes, masks and Looks,
// drawn through StudioCompositor (WebGL 1) at 720p and 1080p with a moving
// picture, GPU-synchronised. Also times the CPU work an edit costs (building a
// surface's coverage). Driven by scripts/mobile-mapping-bench.mjs.
import { StudioCompositor } from '../../src/lib/mobile/studio/compositor';
import { defaultShow, newSurface, type Show, type Surface } from '../../src/lib/mobile/studio/model';
import { latticeFromCorners } from '../../src/lib/mobile/studio/mapping/meshGrid';
import { bendEdge } from '../../src/lib/mobile/studio/mapping/meshGrid';
import { presetPath, shapeFromPath, contentOutline } from '../../src/lib/mobile/studio/mapping/surfaceShape';
import { newEllipseMask, newFreehandMask, newPolygonMask } from '../../src/lib/mobile/studio/mapping/masks';
import { rasterizeCoverage, coverageSize, buildCoverage } from '../../src/lib/mobile/studio/mapping/coverage';
import { ellipsePath } from '../../src/lib/mobile/studio/mapping/pathGeometry';

const params = new URLSearchParams(location.search);
const FRAMES = Number(params.get('frames') ?? 120);
const report = (line: string) => {
  console.log(line);
  if (params.has('report')) void fetch('/__bench-result', { method: 'POST', body: line }).catch(() => {});
};
addEventListener('error', (e) => report('BENCH_ERROR ' + e.message));

/** 16 cells of a 4×4 layout on the output, each a little inset. */
const cell = (i: number) => {
  const c = i % 4,
    r = Math.floor(i / 4);
  return [c / 4 + 0.01, r / 4 + 0.01, (c + 1) / 4 - 0.01, (r + 1) / 4 - 0.01] as const;
};
const quad = (i: number): Surface => {
  const [x0, y0, x1, y1] = cell(i);
  return { ...newSurface(i), id: 's' + i, points: latticeFromCorners([{ x: x0, y: y0 }, { x: x1, y: y0 + 0.01 }, { x: x1 - 0.01, y: y1 }, { x: x0, y: y1 }], { cols: 3, rows: 3 }) };
};
const mesh = (i: number, curved: boolean): Surface => {
  const [x0, y0, x1, y1] = cell(i);
  const g = { cols: 9, rows: 9 };
  let s: Surface = { ...newSurface(i), id: 's' + i, mode: 'mesh', grid: g, points: latticeFromCorners([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], g) };
  if (curved) s = { ...s, bezier: true, tangents: bendEdge(s, 0, 1, { x: s.points[0].x + 0.01, y: s.points[0].y - 0.01 }) };
  return s;
};
const shape = (i: number): Surface => {
  const [x0, y0, x1, y1] = cell(i);
  return { ...shapeFromPath(newSurface(i), presetPath('circle', { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, (y1 - y0) * 0.9)), id: 's' + i };
};
const masked = (s: Surface): Surface => ({
  ...s,
  masks: [
    newPolygonMask([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.15 }, { x: 0.8, y: 0.9 }, { x: 0.15, y: 0.85 }]),
    { ...newEllipseMask(16 / 9), op: 'subtract', feather: 0.05 },
    newFreehandMask(ellipsePath(0.3, 0.3, 0.15, 0.2, 8)),
  ],
});
const look = (s: Surface): Surface => ({ ...s, look: { id: 'neon-pulse', palette: 'neon', enabled: true, amount: 1, speed: 1, width: 1 } });

const CASES: [string, (i: number) => Surface][] = [
  ['16 corner quads', (i) => quad(i)],
  ['16 meshes 9x9', (i) => mesh(i, false)],
  ['16 meshes 9x9 curved', (i) => mesh(i, true)],
  ['16 circle shapes', (i) => shape(i)],
  ['16 quads, 3 masks each', (i) => masked(quad(i))],
  ['16 quads with a Look', (i) => look(quad(i))],
  ['16 circle shapes with a Look', (i) => look(shape(i))],
  ['16 curved 9x9 meshes, 3 masks and a Look each', (i) => look(masked(mesh(i, true)))],
];

function picture(gl: WebGLRenderingContext) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  const w = 640,
    h = 360,
    data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 7) & 255;
    data[i * 4 + 1] = (i >> 3) & 255;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture: t, width: w, height: h };
}

/** GPU time of one frame of a case, after warming up. */
async function measure(quality: 720 | 1080, make: (i: number) => Surface): Promise<{ ms: number; first: number; error: number }> {
  const canvas = document.createElement('canvas');
  const compositor = new StudioCompositor(canvas);
  const gl = compositor.context;
  const input = picture(gl);
  const show: Show = { ...defaultShow(), mapping: true, quality, surfaces: Array.from({ length: 16 }, (_, i) => make(i)) };
  const inputs = [input, null, null, null, null, null, null, null];
  const pixel = new Uint8Array(4);
  // Warm up: geometry, coverage and Look programs are built on the first frames.
  const warm = performance.now();
  compositor.render(show, inputs, false, false, 0, 0, 0);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  const first = performance.now() - warm;
  for (let k = 0; k < 10; k++) compositor.render(show, inputs, false, false, k / 60, 0.5, k / 30);
  gl.finish();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  const start = performance.now();
  for (let k = 0; k < FRAMES; k++) compositor.render(show, inputs, false, false, k / 60, 0.5, k / 30);
  gl.finish();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  const ms = (performance.now() - start) / FRAMES;
  const error = gl.getError();
  compositor.destroy();
  await new Promise((r) => setTimeout(r, 0));
  return { ms, first, error };
}

async function run() {
  const results: Record<string, unknown>[] = [];
  for (const quality of [720, 1080] as const) {
    // Three interleaved rounds; the quickest of each case counts (a busy machine only ever adds time).
    const best = new Map<string, { ms: number; first: number; error: number }>();
    for (let round = 0; round < 3; round++)
      for (const [name, make] of CASES) {
        const r = await measure(quality, make);
        const prev = best.get(name);
        best.set(name, !prev || r.ms < prev.ms ? { ...r, first: prev ? Math.min(prev.first, r.first) : r.first } : prev);
      }
    for (const [name] of CASES) {
      const r = best.get(name)!;
      const result = { quality, name, ms: Math.round(r.ms * 100) / 100, firstFrameMs: Math.round(r.first), error: r.error };
      results.push(result);
      report('BENCH_ONE ' + JSON.stringify(result));
    }
  }
  // The CPU work one edit costs: a full-size coverage (and its Look field) for one big surface.
  const big = masked(shapeFromPath(newSurface(0), presetPath('circle', { x: 0.5, y: 0.5 }, 0.95)));
  const size = coverageSize(1920 * 0.55, 1080 * 0.95);
  const outline = contentOutline(big);
  let t = performance.now();
  const data = rasterizeCoverage({ outline, masks: big.masks }, size.width, size.height)!;
  const raster = performance.now() - t;
  t = performance.now();
  buildCoverage({ key: '', width: size.width, height: size.height, outline, outlineFeather: 0, masks: big.masks!, images: [], field: { pixel: 1, line: outline!.map((p) => ({ x: p.x * size.width, y: p.y * size.height })) } });
  const field = performance.now() - t - raster;
  const draft = coverageSize(size.width, size.height, 256);
  t = performance.now();
  rasterizeCoverage({ outline, masks: big.masks }, draft.width, draft.height);
  const draftMs = performance.now() - t;
  report('BENCH_ONE ' + JSON.stringify({ name: 'CPU: coverage of one large shape with 3 masks', size, ms: Math.round(raster), fieldMs: Math.round(field), draftSize: draft, draftMs: Math.round(draftMs * 10) / 10 }));
  report('BENCH_DONE ' + JSON.stringify(results));
}
void run();
