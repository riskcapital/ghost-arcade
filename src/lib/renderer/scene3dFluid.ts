/**
 * The 3D world's Fluid: a real liquid, simulated with position-based fluids
 * (Macklin and Muller 2013) as Fluid Studio does it (its shaders/sort.wgsl and
 * shaders/pbf.wgsl, ported in scene3dWorldShaders.ts). This side owns the
 * grid, the constants derived from it, the buffers and the order of the passes.
 *
 * The constants are computed from the particle lattice, never guessed: Fluid
 * Studio found that rest density, the relaxation epsilon and the artificial
 * pressure all have to scale with the kernel and the spacing, and that the
 * solve needs about 16 iterations to converge rather than the paper's 4.
 */
import type { InteractiveScene } from '../mobile/studio/interactive';
import { effectParams, MOD_SOURCES, type InteractiveEffect } from '../mobile/studio/interactiveEffects';
import type { WorldGeo } from '../scene3d/worldGeometry';
import { DRIP_FLOATS, DRIP_KIND_FLOATS, DRIP_PARAM_KEYS, FLUID_MAX_NEIGHBOURS, FLUID_PARAM_FLOATS } from './scene3dWorldShaders';

/** Particles for all Fluid effects together, and the most one effect may have. */
export const MAX_FLUID = 16384;
export const MAX_FLUID_PER_EFFECT = 12288;
/** Particles per cell at rest. Four, as Fluid Studio seeds them. */
const PARTICLES_PER_CELL = 4;
/** Constraint iterations: below about 14 the solve does not converge (Fluid Studio's sweep). */
export const FLUID_ITERATIONS = 16;
/** The most cells the grid may have; a coarser cell beyond it. */
const MAX_CELLS = 262144;
/** Cells across the world's widest side, at the middle particle size. */
const CELLS_ACROSS = 120;

export type FluidLayout = { effects: InteractiveEffect[]; perEffect: number; count: number };

export function fluidLayout(scene: InteractiveScene): FluidLayout {
  const effects = (scene.effects ?? []).filter((e) => e.kind === 'fluid');
  const perEffect = effects.length ? Math.min(MAX_FLUID_PER_EFFECT, Math.floor(MAX_FLUID / effects.length)) : 0;
  return { effects, perEffect, count: perEffect * effects.length };
}

// ── The kernel maths, as the shader has it ──

function wPoly6(r2: number, h: number): number {
  const h2 = h * h;
  if (r2 >= h2) return 0;
  const t = h2 - r2;
  return (315 / (64 * Math.PI * h2 * h2 * h2 * h2 * h)) * t * t * t;
}

function gradSpikyMag(r: number, h: number): number {
  if (r >= h || r < 1e-9) return 0;
  const t = h - r;
  return (45 / (Math.PI * h ** 6)) * t * t;
}

/** The kernel summed over a lattice of this spacing: the density the solver treats as neutral. */
export function restDensityFor(spacing: number, h: number): number {
  const reach = Math.ceil(h / spacing);
  let sum = 0;
  for (let k = -reach; k <= reach; k++)
    for (let j = -reach; j <= reach; j++)
      for (let i = -reach; i <= reach; i++) sum += wPoly6((i * i + j * j + k * k) * spacing * spacing, h);
  return sum;
}

/** The constraint gradients summed over the lattice: what epsilon and s_corr scale with. */
function latticeGradientSum(spacing: number, h: number, rest: number): number {
  const reach = Math.ceil(h / spacing);
  let sumSq = 0;
  const self = [0, 0, 0];
  for (let k = -reach; k <= reach; k++)
    for (let j = -reach; j <= reach; j++)
      for (let i = -reach; i <= reach; i++) {
        if (!i && !j && !k) continue;
        const d = [i * spacing, j * spacing, k * spacing];
        const r = Math.hypot(d[0], d[1], d[2]);
        const m = gradSpikyMag(r, h) / rest;
        if (m <= 0) continue;
        for (let a = 0; a < 3; a++) self[a] += (-d[a] / r) * m;
        sumSq += m * m;
      }
  return Math.max(sumSq + self[0] ** 2 + self[1] ** 2 + self[2] ** 2, 1e-9);
}

// ── The grid ──

export type FluidGrid = { origin: [number, number, number]; h: number; n: [number, number, number] };

/** A box round the world, in cells one kernel radius wide. Particle size scales the cell. */
export function fluidGrid(geo: WorldGeo, size: number): FluidGrid {
  let lo: [number, number, number];
  let hi: [number, number, number];
  if (geo.mode === 'wall' && geo.frame) {
    const { W, H } = geo.frame;
    lo = [-W / 2 - 0.25, -H / 2 - 0.25, -0.05];
    // Fixed by the frame, not the blocks, so a block's depth is a value, not a rebuild.
    hi = [W / 2 + 0.25, H / 2 + 0.25, Math.max(W, H) * 0.75];
  } else {
    // What the projector sees, from the nearest a drop is poured to just past
    // the farthest face: fluid out of the picture is spent cells.
    const { pos, fwd, right, up } = geo.projector;
    const near = Math.max(0.05, geo.spawnRef - geo.deepest - 0.1);
    const far = geo.spawnRef + 0.4;
    lo = [Infinity, Infinity, Infinity];
    hi = [-Infinity, -Infinity, -Infinity];
    for (const t of [near, far]) {
      for (const sx of [-1.2, 1.2]) {
        for (const sy of [-1.2, 1.2]) {
          for (let a = 0; a < 3; a++) {
            const v = pos[a] + (fwd[a] + right[a] * sx + up[a] * sy) * t;
            lo[a] = Math.min(lo[a], v - 0.1);
            hi[a] = Math.max(hi[a], v + 0.1);
          }
        }
      }
    }
  }
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  let h = (Math.max(...span) / CELLS_ACROSS) * (0.6 + 1.2 * Math.max(0, Math.min(1, size)));
  const cells = (cell: number) => span.map((s) => Math.max(1, Math.ceil(s / cell))) as [number, number, number];
  while (cells(h).reduce((a, b) => a * b, 1) > MAX_CELLS) h *= 1.1;
  return { origin: lo, h, n: cells(h) };
}

/** The uniform the fluid's passes read (FluidParams in the shader). */
export function fluidParams(geo: WorldGeo, layout: FluidLayout): Float32Array {
  const first = layout.effects.find((e) => e.enabled) ?? layout.effects[0];
  const value = (key: string) => first?.params[key] ?? effectParams('fluid').find((d) => d.key === key)!.value;
  const grid = fluidGrid(geo, value('size'));
  const { h } = grid;
  const spacing = h / Math.cbrt(PARTICLES_PER_CELL);
  const rest = restDensityFor(spacing, h);
  const gradSum = latticeGradientSum(spacing, h, rest);
  const cells = grid.n[0] * grid.n[1] * grid.n[2];
  const out = new Float32Array(FLUID_PARAM_FLOATS);
  out.set([
    grid.n[0], grid.n[1], grid.n[2], cells,
    ...grid.origin, h,
    rest, Math.max(gradSum * 0.01, 1e-9), 0.0164 / (1.01 * gradSum), 4,
    // XSPH viscosity is the fraction of the neighbourhood's velocity blended in.
    0.2, 0.02 + 0.5 * Math.max(0, Math.min(1, value('viscosity'))), 2.5 * Math.max(0, value('swirl')), 1,
    layout.count, layout.effects.length, spacing * 0.55, Math.max(0, Math.min(1, value('cling'))),
    0, 0, 0, 0,
  ]);
  return out;
}

const EMISSIONS = ['continuous', 'pulse', 'burst'] as const;

/** Each Fluid effect as a drop kind: the liquid surface reads its color and gloss as it reads the paint's. */
export function fluidKinds(layout: FluidLayout): Float32Array {
  const kinds = new Float32Array(Math.max(1, layout.effects.length) * DRIP_KIND_FLOATS);
  const fluidDefs = effectParams('fluid');
  const dripDefs = effectParams('drips');
  layout.effects.forEach((e, k) => {
    const at = k * DRIP_KIND_FLOATS;
    kinds.set([k * layout.perEffect, layout.perEffect, EMISSIONS.indexOf(e.emission), e.burst], at);
    kinds.set([0, 0, 0, e.enabled ? 1 : 0], at + 4);
    DRIP_PARAM_KEYS.forEach((key, i) => {
      const d = fluidDefs.find((x) => x.key === key) ?? dripDefs[i];
      kinds[at + 8 + i] = e.params[key] ?? d.value;
      const mod = e.mods[key];
      if (!mod || mod.source === 'manual') return;
      const ranged = mod.rangeMin !== undefined && mod.rangeMax !== undefined;
      kinds.set([
        Math.max(0, (MOD_SOURCES as readonly string[]).indexOf(mod.source)), mod.amount, mod.speed, mod.invert ? 1 : 0,
        ranged ? d.min + mod.rangeMin! * (d.max - d.min) : d.min, ranged ? d.min + mod.rangeMax! * (d.max - d.min) : d.max, mod.bpmSync ? 1 : 0, ranged ? 1 : 0,
      ], at + 28 + i * 8);
    });
  });
  return kinds;
}

type Binding = { binding: number; resource?: string; kind: string };

/**
 * The fluid's buffers and compute passes, in Fluid Studio's order: the life
 * pass (age, take away, pour in), the counting sort into bins, then predict,
 * sixteen rounds of candidates, lambda, delta and apply, the velocity with
 * XSPH, vorticity confinement, and the commit.
 */
export function fluidGraph(
  layout: FluidLayout,
  grid: { cells: number },
  id: (name: string) => string,
  base: Binding[],
): { buffers: object[]; passes: object[] } {
  const n = layout.count;
  if (!n) return { buffers: [], passes: [] };
  const cells = grid.cells;
  const storage = (name: string, bytes: number) => ({ id: id(name), kind: 'storage', byte_length: Math.max(16, bytes), persistent: true });
  const buffers = [
    storage('fluid', n * DRIP_FLOATS * 4),
    storage('fluid-predicted', n * 16),
    storage('fluid-lambdas', n * 4),
    storage('fluid-deltas', n * 16),
    storage('fluid-curls', n * 16),
    storage('fluid-neighbours', n * FLUID_MAX_NEIGHBOURS * 4),
    storage('fluid-neighbour-counts', n * 4),
    storage('fluid-cell-counts', cells * 4),
    storage('fluid-cell-offset', cells * 4),
    storage('fluid-block-sums', Math.ceil(cells / 256) * 4),
    storage('fluid-sorted', n * 4),
    storage('fluid-cursor', cells * 4),
  ];
  const b = (binding: number, name: string, kind = 'storage'): Binding => ({ binding, resource: id(name), kind });
  const params = b(30, 'fluid-params', 'uniform');
  const P = Math.ceil(n / 256);
  const C = Math.ceil(cells / 256);
  const pass = (name: string, entry: string, groups: number, extra: Binding[]) => ({
    name, shader_id: 'scene3d/fluid', entry, dispatch: [Math.max(1, groups), 1, 1], bindings: [...base, params, ...extra],
  });
  const particles = b(21, 'fluid');
  const counts = b(37, 'fluid-cell-counts');
  const offsets = b(38, 'fluid-cell-offset');
  const sums = b(39, 'fluid-block-sums');
  const sorted = b(40, 'fluid-sorted');
  const cursor = b(41, 'fluid-cursor');
  const predicted = b(31, 'fluid-predicted');
  const lambdas = b(32, 'fluid-lambdas');
  const deltas = b(33, 'fluid-deltas');
  const curls = b(34, 'fluid-curls');
  const neighbours = b(35, 'fluid-neighbours');
  const ncounts = b(36, 'fluid-neighbour-counts');
  const kinds = b(22, 'fluid-kinds', 'read-only-storage');
  const blocks = b(16, 'ball-blocks', 'read-only-storage');
  const passes: object[] = [
    pass('fluid-life', 'cs_fluid_life', P, [particles, kinds, blocks]),
    pass('fluid-clear', 'cs_fluid_clear', C, [counts, cursor]),
    pass('fluid-count', 'cs_fluid_count', P, [particles, counts]),
    pass('fluid-scan', 'cs_fluid_scan', C, [counts, offsets, sums]),
    pass('fluid-scan-blocks', 'cs_fluid_scan_blocks', 1, [sums]),
    pass('fluid-offsets', 'cs_fluid_offsets', C, [offsets, sums]),
    pass('fluid-scatter', 'cs_fluid_scatter', P, [particles, counts, offsets, sorted, cursor]),
    pass('fluid-sort-bins', 'cs_fluid_sort_bins', C, [counts, offsets, sorted]),
    pass('fluid-predict', 'cs_fluid_predict', P, [particles, predicted]),
  ];
  for (let it = 0; it < FLUID_ITERATIONS; it++) {
    passes.push(
      pass(`fluid-neighbours-${it}`, 'cs_fluid_neighbours', P, [particles, predicted, counts, offsets, sorted, neighbours, ncounts]),
      pass(`fluid-lambda-${it}`, 'cs_fluid_lambda', P, [particles, predicted, lambdas, deltas, neighbours, ncounts]),
      pass(`fluid-delta-${it}`, 'cs_fluid_delta', P, [particles, predicted, lambdas, deltas, neighbours, ncounts]),
      pass(`fluid-apply-${it}`, 'cs_fluid_apply', P, [particles, predicted, deltas, blocks]),
    );
  }
  passes.push(
    pass('fluid-front', 'cs_fluid_front', P, [particles, predicted, blocks]),
    pass('fluid-finalise', 'cs_fluid_finalise', P, [particles, predicted, neighbours, ncounts, blocks]),
    pass('fluid-curl', 'cs_fluid_curl', P, [particles, predicted, curls, neighbours, ncounts]),
    pass('fluid-vorticity', 'cs_fluid_vorticity', P, [particles, predicted, curls, neighbours, ncounts]),
    pass('fluid-commit', 'cs_fluid_commit', P, [particles, predicted]),
  );
  return { buffers, passes };
}
