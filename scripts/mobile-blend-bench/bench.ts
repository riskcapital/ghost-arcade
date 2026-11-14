// Checks the phone's output compositor on a real GPU (driven by scripts/mobile-blend-bench.mjs):
//  1. every blend mode, on layers and on mapping surfaces, against the reference formula
//     (blendModes.ts, the desktop's own), on known colour pairs with picture alpha and opacity;
//  2. that sets using only the five older modes, and plain mapped sets, draw byte for byte what
//     the compositor before blend modes drew;
//  3. what a frame costs: a normal-only set before and after, and the newer paths beside it.
import { StudioCompositor, type TextureInput } from '../../src/lib/mobile/studio/compositor';
// The compositor as it was before blend modes, served by the runner from git.
import { StudioCompositor as BaseCompositor } from 'virtual:base-compositor';
import { cornerPoints, defaultShow, newSurface, type Show, type Surface } from '../../src/lib/mobile/studio/model';
import { BASIC_BLENDS, BLEND_MODES, compositeReference, type BlendMode, type RGB } from '../../src/lib/mobile/studio/blendModes';
import { CROSSFADE_BLENDS } from '../../src/lib/mobile/studio/crossfade';

const params = new URLSearchParams(location.search);
// Lines carry this run's token, so a tab Safari restores from an earlier run is not mistaken for this one.
const run = params.get('run') ?? '';
const status = document.body.appendChild(document.createElement('pre'));
status.style.cssText = 'color:#ccc;font:12px monospace;white-space:pre-wrap;margin:8px';
const report = (line: string) => {
  console.log(line);
  status.textContent = line.slice(0, 300);
  if (params.has('report')) void fetch('/__bench-result', { method: 'POST', body: run + ' ' + line }).catch(() => {});
};
addEventListener('error', (event) => report('BENCH_ERROR ' + event.message));
addEventListener('unhandledrejection', (event) => report('BENCH_ERROR ' + String(event.reason)));

type Compositor = { context: WebGLRenderingContext; render: StudioCompositor['render']; destroy(release?: boolean): void };
type Pixel = [number, number, number, number];
const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
const unq = (v: number) => v / 255;

function solid(gl: WebGLRenderingContext, colors: Pixel[], width = colors.length, height = 1): TextureInput {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(colors[i % colors.length], i * 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return { texture: t, width: 16, height: 9 };
}
function noise(gl: WebGLRenderingContext, seed: number): TextureInput {
  const w = 1280, h = 720, data = new Uint8Array(w * h * 4);
  let x = seed * 2654435761;
  for (let i = 0; i < data.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; data[i] = (i & 3) === 3 ? 255 : x & 255; }
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return { texture: t, width: w, height: h };
}
function read(gl: WebGLRenderingContext, x: number, y: number): Pixel {
  // x, y as fractions of the output, y from the top.
  const p = new Uint8Array(4);
  gl.readPixels(Math.floor(x * gl.drawingBufferWidth), Math.floor((1 - y) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
  return [p[0], p[1], p[2], p[3]];
}
function readAll(gl: WebGLRenderingContext): Uint8Array {
  const p = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, p);
  return p;
}
const sync = (gl: WebGLRenderingContext) => read(gl, 0, 0.999);

/** A show with every row off but the ones given: row 3 at the bottom, row 0 on top. */
function baseShow(quality: Show['quality'] = 540): Show {
  const show = defaultShow();
  show.quality = quality;
  show.layers.forEach((l) => { l.fit = 'stretch'; l.blend = 'normal'; l.opacity = 1; l.enabled = true; l.clipId = null; });
  show.surfaces = [];
  return show;
}

// Known pairs: the hand-worked pairs of blendModes.test.ts, then seeded random ones.
const PAIRS: [RGB, RGB][] = [[[0.2, 0.7, 0.5], [0.6, 0.3, 0.9]], [[0, 1, 0.5], [1, 0, 0.25]]];
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 6; i++) PAIRS.push([[rand(), rand(), rand()], [rand(), rand(), rand()]]);
// Picture alpha (in the texture) and opacity (layer fader or surface opacity).
const COVERAGE: [number, number][] = [[1, 1], [0.5, 1], [1, 0.6], [0.75, 0.5]];
const TOLERANCE = 2;

function expected(mode: BlendMode, beneath: RGB, picture: RGB, alpha: number, opacity: number): Pixel {
  const b = beneath.map((v) => unq(q(v))) as unknown as RGB, s = picture.map((v) => unq(q(v))) as unknown as RGB;
  const c = compositeReference(mode, b, s, unq(q(alpha)) * opacity);
  return [q(c[0]), q(c[1]), q(c[2]), 255];
}
const toPixel = (c: RGB, a = 1): Pixel => [q(c[0]), q(c[1]), q(c[2]), q(a)];
const diff = (a: Pixel, b: Pixel) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

function pixelTests(compositor: StudioCompositor) {
  const gl = compositor.context;
  const failures: string[] = [];
  const worst: Record<string, number> = {};
  let checks = 0;
  const check = (label: string, mode: BlendMode, got: Pixel, want: Pixel) => {
    checks++;
    const d = diff(got, want);
    worst[mode] = Math.max(worst[mode] ?? 0, d);
    if (d > TOLERANCE && failures.length < 40) failures.push(`${label} ${mode}: got ${got.slice(0, 3)} want ${want.slice(0, 3)}`);
  };
  for (const [beneath, picture] of PAIRS)
    for (const [alpha, opacity] of COVERAGE) {
      const under = solid(gl, [toPixel(beneath)]), over = solid(gl, [toPixel(picture, alpha)]);
      for (const mode of BLEND_MODES) {
        const want = expected(mode, beneath, picture, alpha, opacity);
        // Layers: row 3 is the backdrop, row 2 blends over it.
        const show = baseShow();
        show.layers[2].blend = mode;
        show.layers[2].opacity = opacity;
        const inputs: (TextureInput | null)[] = [null, null, over, under];
        compositor.render(show, inputs);
        check('layer', mode, read(gl, 0.5, 0.5), want);
        // Surfaces: one full-frame surface shows row 3; an inset one shows row 2 with the blend.
        show.layers[2].blend = 'normal';
        show.layers[2].opacity = 1;
        show.mapping = true;
        const inset: Surface = { ...newSurface(1), source: 2, points: cornerPoints({ x: 0.3, y: 0.2 }, { x: 0.8, y: 0.25 }, { x: 0.75, y: 0.8 }, { x: 0.25, y: 0.7 }), opacity, blend: mode };
        show.surfaces = [{ ...newSurface(0, true), source: 3 }, inset];
        compositor.render(show, inputs);
        check('surface', mode, read(gl, 0.52, 0.5), want);
        check('surface-outside', mode, read(gl, 0.1, 0.1), toPixel(beneath));
      }
      gl.deleteTexture(under.texture);
      gl.deleteTexture(over.texture);
    }
  // A surface reads what is beneath where it lands on the output, not by its own uv: a mirrored
  // surface over a backdrop that is one colour on the left and another on the right.
  {
    const left: RGB = [0.9, 0.2, 0.1], right: RGB = [0.1, 0.3, 0.9], picture: RGB = [0.5, 0.5, 0.5];
    const under = solid(gl, [toPixel(left), toPixel(right)]), over = solid(gl, [toPixel(picture)]);
    for (const mode of ['multiply', 'overlay', 'difference', 'hue'] as BlendMode[]) {
      const show = baseShow();
      show.mapping = true;
      const mirrored: Surface = { ...newSurface(1), source: 2, points: cornerPoints({ x: 0.95, y: 0.05 }, { x: 0.05, y: 0.05 }, { x: 0.05, y: 0.95 }, { x: 0.95, y: 0.95 }), blend: mode };
      show.surfaces = [{ ...newSurface(0, true), source: 3 }, mirrored];
      compositor.render(show, [null, null, over, under]);
      check('mirrored-left', mode, read(gl, 0.1, 0.5), expected(mode, left, picture, 1, 1));
      check('mirrored-right', mode, read(gl, 0.9, 0.5), expected(mode, right, picture, 1, 1));
    }
    gl.deleteTexture(under.texture);
    gl.deleteTexture(over.texture);
  }
  // The crossfade's own blends are the same formulas: halfway across, deck B blends over deck A.
  for (const [beneath, picture] of PAIRS) {
    const a = solid(gl, [toPixel(beneath)]), b = solid(gl, [toPixel(picture)]);
    for (const mode of CROSSFADE_BLENDS) {
      if (mode === 'normal') continue;
      const show = baseShow();
      show.dualDeck = true;
      show.crossfade = 0.5;
      show.crossfadeSettings = { transition: 'dissolve', blend: mode, curve: 'linear' };
      compositor.render(show, [null, null, null, a, null, null, null, b]);
      check('crossfade', mode, read(gl, 0.5, 0.5), expected(mode, beneath, picture, 1, 1));
    }
    gl.deleteTexture(a.texture);
    gl.deleteTexture(b.texture);
  }
  const error = gl.getError();
  if (error !== gl.NO_ERROR) failures.push(`GL error ${error}`);
  return { checks, failures, worst };
}

/** Sets an older app could make draw exactly what the compositor before blend modes drew. */
function sameAsBefore(make: () => Compositor, makeBase: () => Compositor) {
  const scenes: { name: string; show: (gl: WebGLRenderingContext) => { show: Show; inputs: (TextureInput | null)[] } }[] = [];
  for (const mode of BASIC_BLENDS)
    scenes.push({
      name: `layers ${mode}`,
      show: (gl) => {
        const show = baseShow(720);
        show.layers[0].blend = mode; show.layers[0].opacity = 0.7;
        show.layers[1].blend = mode;
        show.layers[2].blend = 'screen'; show.layers[2].opacity = 0.5;
        return { show, inputs: [noise(gl, 1), noise(gl, 2), noise(gl, 3), noise(gl, 4)] };
      },
    });
  scenes.push({
    name: 'mapped, four normal surfaces with fade and placement',
    show: (gl) => {
      const show = baseShow(720);
      show.mapping = true;
      show.layers[1].blend = 'add';
      show.surfaces = [0, 1, 2, 3].map((i) => ({
        ...newSurface(i),
        source: i === 0 ? 'mix' : i,
        feather: i * 0.05,
        points: cornerPoints({ x: 0.05 + i * 0.2, y: 0.1 }, { x: 0.3 + i * 0.2, y: 0.15 }, { x: 0.28 + i * 0.2, y: 0.9 }, { x: 0.02 + i * 0.2, y: 0.8 }),
        ...(i === 2 ? { placement: { x: 0.4, y: 0.5, w: 0.5, h: 0.5, angle: 0.3 } } : {}),
      }));
      return { show, inputs: [noise(gl, 5), noise(gl, 6), noise(gl, 7), noise(gl, 8)] };
    },
  });
  const results: { name: string; differing: number; maxDiff: number }[] = [];
  for (const scene of scenes) {
    const frames: Uint8Array[] = [];
    for (const build of [makeBase, make]) {
      const c = build();
      const { show, inputs } = scene.show(c.context);
      c.render(show, inputs);
      frames.push(readAll(c.context));
      for (const input of inputs) if (input) c.context.deleteTexture(input.texture);
      c.destroy(true);
    }
    let differing = 0, maxDiff = 0;
    for (let i = 0; i < frames[0].length; i++) {
      const d = Math.abs(frames[0][i] - frames[1][i]);
      if (d) { differing++; maxDiff = Math.max(maxDiff, d); }
    }
    results.push({ name: scene.name, differing, maxDiff });
  }
  return results;
}

/** Milliseconds per frame, GPU-synchronised: median of rounds that alternate the compositors. */
function timing(make: () => Compositor, makeBase: () => Compositor) {
  const FRAMES = Number(params.get('frames') ?? 60), ROUNDS = Number(params.get('rounds') ?? 5);
  const cases: { name: string; base: boolean; build: (show: Show) => void }[] = [
    { name: 'normal-only set: 4 layers, 4 surfaces', base: true, build: (show) => { show.mapping = true; show.surfaces = [0, 1, 2, 3].map((i) => ({ ...newSurface(i), source: i === 0 ? 'mix' : i })); } },
    { name: 'normal-only set: 4 layers, no mapping', base: true, build: () => {} },
    { name: 'four layers in Overlay, Soft light, Hue, Pin light', base: false, build: (show) => { (['overlay', 'softlight', 'hue', 'pin-light'] as BlendMode[]).forEach((m, i) => (show.layers[i].blend = m)); } },
    { name: 'four surfaces, three blending (Multiply, Overlay, Screen)', base: false, build: (show) => { show.mapping = true; show.surfaces = [0, 1, 2, 3].map((i) => ({ ...newSurface(i), source: i === 0 ? 'mix' : i, ...(i ? { blend: (['multiply', 'overlay', 'screen'] as BlendMode[])[i - 1], opacity: 0.8 } : {}) })); } },
  ];
  const out: Record<string, { before?: number; after: number }> = {};
  for (const item of cases) {
    const runs: Record<'before' | 'after', number[]> = { before: [], after: [] };
    const pairs = (item.base ? [['before', makeBase], ['after', make]] : [['after', make]]) as ['before' | 'after', () => Compositor][];
    const live = pairs.map(([key, build]) => {
      const c = build();
      const show = baseShow(1080);
      item.build(show);
      const inputs = [noise(c.context, 11), noise(c.context, 12), noise(c.context, 13), noise(c.context, 14)];
      for (let i = 0; i < 10; i++) c.render(show, inputs);
      sync(c.context);
      return { key, c, show, inputs };
    });
    for (let round = 0; round < ROUNDS; round++)
      for (const { key, c, show, inputs } of round % 2 ? [...live].reverse() : live) {
        sync(c.context);
        const start = performance.now();
        for (let i = 0; i < FRAMES; i++) c.render(show, inputs);
        sync(c.context);
        runs[key].push((performance.now() - start) / FRAMES);
      }
    for (const { c, inputs } of live) { for (const t of inputs) c.context.deleteTexture(t.texture); c.destroy(true); }
    const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    out[item.name] = { ...(item.base ? { before: Math.round(median(runs.before) * 1000) / 1000 } : {}), after: Math.round(median(runs.after) * 1000) / 1000 };
  }
  return out;
}

/**
 * The wait for the full blend shader. Each compositor first draws two plain frames, so its own
 * start-up is not counted. "Early": prepareBlends (as the blend sheet opens), then the first
 * Overlay frame. "Cold": the first Overlay frame compiles it on the spot. Early runs first, as a
 * browser may cache the compiled shader for the second.
 */
async function compileTime(make: () => StudioCompositor) {
  const frame = (c: StudioCompositor, blend: BlendMode) => {
    const tex = solid(c.context, [[200, 100, 50, 255]]);
    const show = baseShow();
    show.layers[2].blend = blend;
    const start = performance.now();
    c.render(show, [null, null, tex, tex]);
    sync(c.context);
    c.context.deleteTexture(tex.texture);
    return performance.now() - start;
  };
  const round = (v: number) => Math.round(v * 100) / 100;
  const warm = (c: StudioCompositor) => { frame(c, 'normal'); frame(c, 'normal'); return frame(c, 'normal'); };

  const early = make();
  const plainFrameMs = warm(early);
  const parallel = !!early.context.getExtension('KHR_parallel_shader_compile');
  const start = performance.now();
  early.prepareBlends();
  const prepareMs = performance.now() - start;
  // How long the background compile takes to report itself done (polled; nothing waits on it).
  let readyMs = -1;
  const pending = (early as unknown as { pendingBlends?: { program: WebGLProgram } }).pendingBlends;
  if (pending && parallel) {
    const ext = early.context.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number };
    while (performance.now() - start < 5000 && !early.context.getProgramParameter(pending.program, ext.COMPLETION_STATUS_KHR)) await new Promise((r) => setTimeout(r, 5));
    readyMs = performance.now() - start;
  }
  await new Promise((r) => setTimeout(r, 200));
  const earlyFirstMs = frame(early, 'overlay');
  const blendFrameMs = frame(early, 'overlay');
  early.destroy(true);

  const cold = make();
  warm(cold);
  const coldFirstMs = frame(cold, 'overlay');
  cold.destroy(true);
  return { plainFrameMs: round(plainFrameMs), blendFrameMs: round(blendFrameMs), parallelCompile: parallel, prepareBlocksMs: round(prepareMs), backgroundReadyMs: round(readyMs), firstBlendFrameAfterPrepareMs: round(earlyFirstMs), firstBlendFrameColdMs: round(coldFirstMs) };
}

(async () => {
  report('BENCH_START ' + navigator.userAgent);
  const canvas = () => document.body.appendChild(document.createElement('canvas'));
  const make = () => {
    const c = new StudioCompositor(canvas());
    c.onBlendError = (message) => report('BENCH_ERROR ' + message);
    return c;
  };
  const makeBase = () => new BaseCompositor(canvas()) as unknown as Compositor;
  const result: Record<string, unknown> = {};
  try {
    result.compile = await compileTime(make);
    report('BENCH_ONE ' + JSON.stringify({ compile: result.compile }));
    const c = make();
    result.pixels = pixelTests(c);
    c.destroy(true);
    report('BENCH_ONE ' + JSON.stringify({ pixels: result.pixels }));
    result.sameAsBefore = sameAsBefore(make, makeBase);
    report('BENCH_ONE ' + JSON.stringify({ sameAsBefore: result.sameAsBefore }));
    if (!params.has('notiming')) {
      result.timing = timing(make, makeBase);
      report('BENCH_ONE ' + JSON.stringify({ timing: result.timing }));
    }
  } catch (error) {
    result.error = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  }
  report('BENCH_DONE ' + JSON.stringify(result));
})();
