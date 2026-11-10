import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINES_NATIVE_WGSL } from './linesNative';
import { LIGHT_PAINTING_NATIVE_WGSL } from './lightPaintingNative';
import { SVG_NATIVE_WGSL } from './svgNative';
import { MODEL3D_NATIVE_WGSL } from './model3dNative';
import { SPLAT_NATIVE_WGSL } from './splatNative';
import { MATTER_COMMON, MATTER_PARTICLES } from './nativeInteractiveMatter';

/**
 * Long uptime: the classic `fract(sin(x) * 43758.5453)` hash breaks once a
 * clock-driven x gets huge (f32 keeps no fraction, GPU sin of a big argument
 * is implementation-defined), so flicker, glitch bands and noise freeze or
 * pattern after hours. The time-driven sites now use a hybrid: the old sin
 * hash below a bound (so the look at normal times is bit-identical), an
 * integer PCG hash above it. Static per-element hashes are left alone.
 */

const HEARTBEAT_WGSL = readFileSync(join(process.cwd(), 'native-renderer', 'src', 'heartbeat.wgsl'), 'utf8');

// ── JS model of the WGSL helpers ────────────────────────────────────────────
const f = Math.fround;
const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);
const bits = (x: number) => { f32buf[0] = x; return u32buf[0]; };
const ibits = (x: number) => (Math.trunc(x) | 0) >>> 0; // bitcast<u32>(i32(x))
function pcg(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}
const unit = (k: number) => (k >>> 8) / 16777216;
const pcg01 = (a: number, b: number) => unit(pcg((a ^ pcg(b)) >>> 0));
const dot2 = (x: number, y: number) => f(f(x * 127.1) + f(y * 311.7));
const dot3 = (x: number, y: number, z: number) => f(f(f(x * 127.1) + f(y * 311.7)) + f(z * 74.7));

type Site = {
  name: string;
  bound: number;
  /** The quantity the hybrid compares with `bound` at t = 10 s, worst-case params. */
  atTenSeconds: number;
  /** 256 consecutive ticks / lattice points at t = 7 days: [branch value, hash]. */
  week: (step: number) => { gate: number; hash: number };
};

const WEEK = 7 * 24 * 3600;
const S = 8192; // longest stroke / path arc length assumed, px
const PX = 4096; // largest canvas side assumed, px


/** A 2D lattice / tick-pair site: worst |argument| at 10 s, and a week of ticks along the time axis. */
function lattice2(name: string, bound: number, x10: number, y10: number, rate: number): Site {
  return {
    name, bound,
    atTenSeconds: (Math.floor(x10) + 1) * 127.1 + (Math.floor(y10) + 1) * 311.7,
    week: (k) => {
      const lx = Math.floor(x10); const ly = Math.floor(rate * WEEK) + k;
      return { gate: Math.abs(dot2(lx, ly)), hash: pcg01(ibits(lx), ibits(ly)) };
    },
  };
}

const SITES: Site[] = [
  // heartbeat.wgsl — Flux glitch: band ≤ 36, beat-synced clock at 200 BPM.
  {
    name: 'heartbeat flux_glitch_hash', bound: 32768,
    atTenSeconds: Math.abs(f(f(36 * 91.7) + f(Math.floor(((10 * 200) / 60) * 1.5707963 * 8) * 13.3))),
    week: (k) => {
      const band = 3; const tick = Math.floor(0.7 * WEEK * 8) + k;
      return { gate: Math.abs(f(f(band * 91.7) + f(tick * 13.3))), hash: unit(pcg((ibits(band) ^ pcg(ibits(tick))) >>> 0)) };
    },
  },
  // heartbeat.wgsl — edge_random: glitch anim (speed 5), electric (speed 3, intensity 3), dashed/neon
  // flicker. The week check runs at speed 1: at 48 ticks/s a week of ticks (2.9e7) is past where f32
  // holds consecutive integers, a limit of the f32 clock rather than of the hash.
  ...([
    ['edge glitch bands', (t: number) => [1.0, Math.floor(t * 5 * 4)]],
    ['edge electric flash', (t: number) => [Math.floor(t * 3 * (4 + 3 * 4)), 0]],
    ['edge dashed flicker', (t: number) => [Math.floor(t * 3 * 12), 5.0]],
    ['edge neon flicker', (t: number) => [Math.floor(t * 8), 0]],
  ] as Array<[string, (t: number) => [number, number]]>).map(([name, st]): Site => ({
    name, bound: 32768,
    atTenSeconds: Math.abs(f(f(st(10)[0] * 12.9898) + f(st(10)[1] * 78.233))),
    week: (k) => {
      const [x0, y0] = st(WEEK / (name === 'edge glitch bands' ? 5 : name === 'edge neon flicker' ? 1 : 3));
      const [x, y] = name === 'edge glitch bands' ? [x0, y0 + k] : [x0 + k, y0];
      return { gate: Math.abs(f(f(x * 12.9898) + f(y * 78.233))), hash: unit(pcg((bits(x) ^ pcg(bits(y))) >>> 0)) };
    },
  })),
  // linesNative.ts — ln_hash: neon flicker (speed 5), laser, Light Up value noise (speed 4, seed < 1).
  ...([
    ['lines neon flicker', (t: number) => Math.floor(t * 5 * 8)],
    ['lines laser flicker', (t: number) => Math.floor(t * 24)],
    ['lines light-up noise', (t: number) => Math.floor(t * 4 * 2 + 0.999 * 113) + 1],
  ] as Array<[string, (t: number) => number]>).map(([name, n]): Site => ({
    name, bound: 131072,
    atTenSeconds: Math.abs(f(n(10) * 127.1)),
    week: (k) => { const v = n(WEEK) + k; return { gate: Math.abs(f(v * 127.1)), hash: unit(pcg(ibits(v))) }; },
  })),
  // linesNative.ts — ln_hash2 lattice (electric, fire, fire n2, sparkle). [x at 10 s on an
  // 8k px path, |y| at 10 s at speed 5, y per second at speed 1 for the week check]
  ...([
    ['lines electric noise', S * 0.02 + 4 * 13.7, 10 * 5 * 3, 3],
    ['lines fire noise', S * 0.03, 10 * 5 * 4, 4],
    ['lines fire noise 2', S * 0.09 + 40, 10 * 5 * 7, 7],
    ['lines sparkle noise', S * 0.05, 10 * 4 * 6, 6],
  ] as Array<[string, number, number, number]>).map(([name, x, y, rate]) => lattice2(name, 1048576, x, y, rate)),
  // lightPaintingNative.ts — lp_hash_t(tick, seed): seed < 17, speed 5.
  ...([
    ['lp strobe', (t: number) => Math.floor(t * 24), 0],
    ['lp neon flicker', (t: number) => Math.floor(t * 5 * 9), 16.97],
    ['lp laser flicker', (t: number) => Math.floor(t * 30), 16.97],
    ['lp lightning strike', (t: number) => Math.floor(t * 5 * 3), 16.97],
  ] as Array<[string, (t: number) => number, number]>).map(([name, tick, seed]): Site => ({
    name, bound: 131072,
    atTenSeconds: Math.abs(f(f(tick(10) + seed) * 127.1)),
    week: (k) => {
      const tk = tick(WEEK) + k; const n = f(tk + f(seed));
      return { gate: Math.abs(f(n * 127.1)), hash: pcg01(ibits(tk), bits(seed)) };
    },
  })),
  // lightPaintingNative.ts — lp_hash2_t direct sites and lp_noise_t/lp_fbm_t lattice
  // (fbm octave 3 scales by 4.41); 8k px stroke, |sd| ≤ 512 px, d ≤ 1024 px, speed 5,
  // seed < 17. The last column is the time coordinate per second at speed 1.
  ...([
    ['lp flame sparks', S * 0.4, 512 * 0.4 + 10 * 5 * 3 * 8, 24],
    ['lp electric spurs', S * 0.08, 10 * 5 * 6, 6],
    ['lp lightning branches', S * 0.05, 10 * 5 * 8, 8],
    ['lp flame fbm', (S * 0.025 + 17) * 4.41, 10 * 5 * 3 * 4.41, 3],
    ['lp electric fbm', (S * 0.03 + 4 * 13.7 + 17) * 4.41, 10 * 5 * 2.6 * 4.41, 2.6],
    ['lp smoke fbm', (S * 0.012 + 10 * 5 * 1.4 * 1.5 * 0.3) * 4.41, (512 * 0.02 + 10 * 5 * 1.4 * 1.5) * 4.41, 0.7],
    ['lp smoke fbm 2', (S * 0.03 + 17) * 4.41, (512 * 0.05 + 10 * 5 * 1.4 * 1.5 * 1.7 + 17) * 4.41, 1.19],
    ['lp laser speck noise', S * 0.2, 10 * 14, 14],
    ['lp plasma fbm', (S * 0.02 + 10 * 5 * 0.5) * 4.41, (512 * 0.03 + 17) * 4.41, 0.5],
    ['lp lightning fbm', (S * 0.02 + 17) * 4.41, 10 * 5 * 8 * 4.41, 8],
    ['lp lightning noise', S * 0.09, 10 * 5 * 8 + 3, 8],
    ['lp nebula fbm', (S * 0.008 + 10 * 5 * 0.12 + 17) * 4.41, (512 * 0.012 + 17) * 4.41, 0.12],
    ['lp aurora noise', S * 0.03, 10 * 0.5, 0.5],
  ] as Array<[string, number, number, number]>).map(([name, x, y, rate]) => lattice2(name, 1048576, x, y, rate)),
  // lightPaintingNative.ts — sparkle overlay: cell = (s, sd) / 5, tick = floor(t * 8), seed < 17.
  {
    name: 'lp sparkle overlay', bound: 1048576,
    atTenSeconds: (S / 5 + 80 * 13.7) * 127.1 + (512 / 5 + 17) * 311.7,
    week: (k) => {
      const cx = 40; const cy = 3; const tick = Math.floor(WEEK * 8) + k; const seed = 4.5;
      const kk = pcg((ibits(tick) ^ pcg(bits(seed))) >>> 0);
      return { gate: Math.abs(dot2(f(cx + f(tick * 13.7)), f(cy + seed))), hash: pcg01(ibits(cx), (ibits(cy) ^ kk) >>> 0) };
    },
  },
  // svgNative.ts — hash2 / noise2 lattice on a 4K canvas with the UI maxima.
  ...([
    ['svg warp noise', PX * 0.008 + 10 * 5, PX * 0.008 + 10 * 5],
    ['svg noise fill', PX * 0.1 + 10 * 5, PX * 0.1 + 10 * 5],
    ['svg particles', PX / 5 + Math.floor(10 * 300 * 0.03), PX / 5 + Math.floor(10 * 300 * 0.03)],
    ['svg lightning', Math.floor(10 * 4 * 8), PX * 0.02],
    ['svg nebula noise', PX * 0.006 + 10 * 5, PX * 0.006 + 10 * 5],
  ] as Array<[string, number, number]>).map(([name, x, y]): Site => ({
    name, bound: 1048576,
    atTenSeconds: (Math.floor(x) + 1) * 127.1 + (Math.floor(y) + 1) * 311.7,
    week: (k) => {
      const lx = Math.floor(WEEK * 0.5); const ly = 12 + k;
      return { gate: Math.abs(dot2(lx, ly)), hash: unit(pcg((ibits(lx) ^ pcg(ibits(ly))) >>> 0)) };
    },
  })),
  // model3dNative.ts — m_hash3_t / m_noise3_t: |cp * scale| ≤ 20, speed 5, |world| ≤ 10.
  ...([
    ['model3d noise deform fbm', [45 * 8.2422, 45 * 8.2422, 45 * 8.2422]],
    ['model3d inflate noise', [65, 65, 65]],
    ['model3d melt noise', [50, 50, 50]],
    ['model3d lava noise', [25, 50, 25]],
    ['model3d hologram bands', [260, 180, 7]],
    ['model3d glitch bands', [200, 120, 1]],
  ] as Array<[string, [number, number, number]]>).map(([name, [x, y, z]]): Site => ({
    name, bound: 1048576,
    atTenSeconds: (Math.floor(x) + 1) * 127.1 + (Math.floor(y) + 1) * 311.7 + (Math.floor(z) + 1) * 74.7,
    week: (k) => {
      const lx = 4; const ly = Math.floor(WEEK * 12) + k; const lz = 1;
      return { gate: Math.abs(dot3(lx, ly, lz)), hash: unit(pcg((ibits(lx) ^ pcg((ibits(ly) ^ pcg(ibits(lz))) >>> 0)) >>> 0)) };
    },
  })),
  // splatNative.ts — sp_hash2_t direct (datamosh, speed 4, |wp| ≤ 10) and sp_noise2_t lattice.
  ...([
    ['splat datamosh glitch', Math.floor(10 * 10 * 4), 10],
    ['splat datamosh shift', 10 * 4, 10],
    ['splat fire fx noise', 5 * 3, 5 * 3 + 10 * 2],
    ['splat fog noise', 5 * 10 + 10 * 2 + 3, 5 * 10 + 10 * 2 * 0.63 + 3],
    ['splat haze noise', (0.5 * 1.78 * 6 * 10 + 20) * 2.3, (0.5 * 6 * 10 + 13) * 2.3],
  ] as Array<[string, number, number]>).map(([name, x, y]): Site => ({
    name, bound: 1048576,
    atTenSeconds: (Math.floor(x) + 1) * 127.1 + (Math.floor(y) + 1) * 311.7,
    week: (k) => {
      const px = Math.floor(WEEK * 10); const py = 2.5 + k;
      return { gate: Math.abs(dot2(px, py)), hash: pcg01(bits(px), bits(py)) };
    },
  })),
  // splatNative.ts — sp_noise3_t lattice: q = i.xy + 57 i.z, so arg = 127.1 x + 311.7 y + 25011.6 z.
  // |orig| ≤ 5, phase = t * 5 * 2π, |pos * dScale| ≤ 50, t * dSpeed ≤ 50; static offsets up to 400.
  ...([
    ['splat explode noise', [13.5 + 31.4, 13.5, 13.5 + 71]],
    ['splat gravity noise', [10, 10 + 25.1, 10 + 37]],
    ['splat swarm separation', [130, 130, 130]],
    ['splat swarm flow', [412, 412, 412]],
    ['splat drift noise', [3.5, 3.5 + 25.1, 3.5 + 41]],
    ['splat noise displacement', [100, 100, 200]],
    ['splat wind noise', [100, 100, 100]],
    ['splat curl noise', [100, 50 + 41.5, 50 + 56.5]],
    ['splat scanline noise', [150, 150, 150]],
  ] as Array<[string, [number, number, number]]>).map(([name, [x, y, z]]): Site => ({
    name, bound: 33554432,
    atTenSeconds: (Math.floor(x) + 1) * 127.1 + (Math.floor(y) + 1) * 311.7 + (Math.floor(z) + 1) * 57 * (127.1 + 311.7),
    week: (k) => {
      const iz = Math.floor(WEEK * 1.5) + k; const qx = f(2 + iz * 57); const qy = f(3 + iz * 57);
      return { gate: Math.abs(dot2(qx, qy)), hash: pcg01(bits(qx), bits(qy)) };
    },
  })),
  // splatNative.ts — glitch displacement: the bound is on the clock's share (vidx dominates).
  {
    name: 'splat glitch gate', bound: 32768, atTenSeconds: 10 * 100,
    week: (k) => {
      const tpart = f(f(WEEK + k) * 100); const vidx = 123456;
      return { gate: Math.abs(tpart), hash: pcg01((pcg(vidx) + 0) >>> 0, bits(tpart)) };
    },
  },
  {
    name: 'splat glitch offset', bound: 32768, atTenSeconds: 10,
    week: (k) => {
      const tpart = f(WEEK + k); const vidx = 123456;
      return { gate: Math.abs(tpart), hash: pcg01((pcg(vidx) + 1) >>> 0, bits(tpart)) };
    },
  },
  // nativeInteractiveMatter.ts — noise lattice index n (fbm octave 3: p * 4.13 + 7.2), uv in 0..1.
  ...([
    ['matter flame tongues', [65 * 4.13 + 7.2, (38 + 1.8 * 10) * 4.13 + 7.2, 0.6 * 10 * 4.13 + 7.2]],
    ['matter char grain', [60 * 4.13 + 7.2, 60 * 4.13 + 7.2, 0.3 * 10 * 4.13 + 7.2]],
    ['matter smoke grain', [35 * 4.13 + 7.2, 24 * 4.13 + 7.2, 0.23 * 10 * 4.13 + 7.2]],
    ['matter light grain', [12 * 4.13 + 7.2, 12 * 4.13 + 7.2, 7.6 * 4.13 + 7.2]],
  ] as Array<[string, [number, number, number]]>).map(([name, [x, y, z]]): Site => ({
    name, bound: 4194304,
    atTenSeconds: (Math.floor(x) + 57 * Math.floor(y) + 113 * Math.floor(z) + 171) * 127.1 + 311.7,
    week: (k) => {
      const n = 3 + 57 * 9 + 113 * (Math.floor(WEEK * 0.6) + k);
      return { gate: Math.abs(f(f(n * 127.1) + 311.7)), hash: unit(pcg(ibits(n))) };
    },
  })),
  // nativeInteractiveMatter.ts — birth seed: the bound is on the emission ticket's share.
  {
    name: 'matter birth seed', bound: 32768, atTenSeconds: Math.floor(10 * 11) * 127.1,
    week: (k) => {
      const tick = Math.floor(WEEK * 11) + k; const i = 777;
      return { gate: Math.abs(f(tick * 127.1)), hash: unit(pcg((i ^ pcg(ibits(tick))) >>> 0)) };
    },
  },
];

describe('long-uptime hybrid hashes (JS model)', () => {
  it('keeps the old sin hash at t = 10 s for every time-driven site', () => {
    for (const site of SITES) {
      expect(site.atTenSeconds, site.name).toBeLessThan(site.bound);
    }
  });

  it('switches to the integer hash after a week and stays well spread', () => {
    for (const site of SITES) {
      const values: number[] = [];
      for (let k = 0; k < 256; k++) {
        const { gate, hash } = site.week(k);
        expect(gate, site.name).toBeGreaterThanOrEqual(site.bound);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThan(1);
        values.push(hash);
      }
      const distinct = new Set(values).size;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      expect(distinct, site.name).toBeGreaterThan(200);
      expect(mean, site.name).toBeGreaterThan(0.4);
      expect(mean, site.name).toBeLessThan(0.6);
    }
  });

  it('splat dither keeps the old golden step early and uses integer math later', () => {
    const golden = (frame: number) => frame < 65536
      ? f(0.61803398875 * frame)
      : (((Math.imul(frame >>> 0, 2654435769) >>> 0) >>> 8) / 16777216);
    expect(10 * 60).toBeLessThan(65536);
    const frame = Math.floor(WEEK * 60);
    const values = Array.from({ length: 256 }, (_, k) => golden(frame + k));
    expect(new Set(values).size).toBeGreaterThan(200);
    // Same low-discrepancy sequence: consecutive steps advance by ~1/phi mod 1.
    const step = (values[1] - values[0] + 1) % 1;
    expect(Math.abs(step - 0.6180339887)).toBeLessThan(1e-6);
  });
});

// ── Source checks: hybrids at the time-driven sites, static sites untouched ──
const OLD = '43758.5453';

describe('long-uptime hybrid hashes (shader source)', () => {
  it('heartbeat: Flux glitch and edge flicker use the hybrid', () => {
    expect(HEARTBEAT_WGSL).toContain('fn flux_glitch_hash(band: f32, tick: f32) -> f32');
    expect(HEARTBEAT_WGSL).toContain('let h = flux_glitch_hash(band, tick);');
    expect(HEARTBEAT_WGSL).not.toContain('fract(sin(band * 91.7 + tick * 13.3)');
    expect(HEARTBEAT_WGSL).toContain('let a = band * 91.7 + tick * 13.3;');
    expect(HEARTBEAT_WGSL).toContain('fract(sin(a) * 43758.5), abs(a) < 32768.0)');
    expect(HEARTBEAT_WGSL).toContain('let a = dot(st, vec2<f32>(12.9898, 78.233));');
    expect(HEARTBEAT_WGSL).toContain('fract(sin(a) * 43758.5453123), abs(a) < 32768.0)');
    // Static hashes: star field / proxy noise keep their form.
    expect(HEARTBEAT_WGSL).toContain('return fract(sin(q.x + q.y) * 43758.5453123);');
  });

  it('lines: both base hashes are hybrids (every caller is clock-driven)', () => {
    expect(LINES_NATIVE_WGSL).toContain('fn ln_pcg(v: u32) -> u32');
    expect(LINES_NATIVE_WGSL).toContain(`fract(sin(a) * ${OLD}), abs(a) < 131072.0)`);
    expect(LINES_NATIVE_WGSL).toContain(`fract(sin(a) * ${OLD}), abs(a) < 1048576.0)`);
    expect(LINES_NATIVE_WGSL).toContain('let a = n * 127.1;');
    expect(LINES_NATIVE_WGSL).toContain('let a = dot(p, vec2<f32>(127.1, 311.7));');
    expect(LINES_NATIVE_WGSL).toContain('ln_hash(floor(t * 24.0))');
  });

  it('light painting: time sites use _t variants, brush hashes stay static', () => {
    const src = LIGHT_PAINTING_NATIVE_WGSL;
    expect(src).toContain('fn lp_hash(n: f32) -> f32 { return fract(sin(n * 127.1) * 43758.5453); }');
    expect(src).toContain('fn lp_hash2(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }');
    for (const site of [
      'lp_hash_t(floor(t * 24.0), 0.0)',
      'lp_hash_t(floor(t * speed * 9.0), seed)',
      'lp_hash_t(floor(t * 30.0), seed)',
      'lp_hash_t(floor(t * speed * 3.0), seed)',
      'lp_fbm_t(vec2<f32>(s * 0.025 + seed, d * 0.05 - rise))',
      'lp_noise_t(vec2<f32>(s * 0.09, d * 0.11 - rise * 1.8))',
      'lp_hash2_t(floor(vec2<f32>(s * 0.4, sd * 0.4) + vec2<f32>(0.0, -rise * 8.0)))',
      'lp_fbm_t(vec2<f32>(s * 0.03 + f32(k) * 13.7 + seed, t * speed * 2.6))',
      'lp_hash2_t(vec2<f32>(floor(s * 0.08), floor(t * speed * 6.0)))',
      'lp_fbm_t(vec2<f32>(s * 0.012 + drift * 0.3, sd * 0.02 - drift))',
      'lp_noise_t(vec2<f32>(s * 0.2, t * 14.0))',
      'lp_fbm_t(vec2<f32>(s * 0.02, sd * 0.03) + vec2<f32>(t * speed * 0.5, seed))',
      'lp_fbm_t(vec2<f32>(s * 0.02 + seed, floor(t * speed * 8.0)))',
      'lp_noise_t(vec2<f32>(s * 0.09, floor(t * speed * 8.0) + 3.0))',
      'lp_hash2_t(vec2<f32>(floor(s * 0.05), floor(t * speed * 8.0)))',
      'lp_fbm_t(vec2<f32>(s * 0.008 + drift, sd * 0.012) + vec2<f32>(seed))',
      'lp_noise_t(vec2<f32>(s * 0.03, t * 0.5))',
      'lp_sparkle_hash(floor(sp_uv), floor(t * 8.0), seed)',
    ]) expect(src, site).toContain(site);
    expect(src).not.toMatch(/lp_(hash|hash2|noise|fbm)\([^)]*\bt\b/);
    expect(src).toContain('let h1 = lp_hash(cell + seed);');
    expect(src).toContain('let facet = lp_hash2(cell + vec2<f32>(seed));');
    expect(src).toContain('lp_noise(vec2<f32>(s * 0.15, sd * 0.3))');
    expect(src).toContain(`fract(sin(n * 127.1) * ${OLD}), abs(n * 127.1) < 131072.0)`);
  });

  it('svg: hash2 is the hybrid (every caller is clock-driven)', () => {
    expect(SVG_NATIVE_WGSL).toContain('fn svg_pcg(v: u32) -> u32');
    expect(SVG_NATIVE_WGSL).toContain(`fract(sin(a) * ${OLD}), abs(a) < 1048576.0)`);
    expect(SVG_NATIVE_WGSL).toContain('hash2(cell+floor(time*svg.h11.x*0.03))');
  });

  it('model3d: time sites use m_hash3_t / m_noise3_t, static ones keep the old hash', () => {
    const src = MODEL3D_NATIVE_WGSL;
    expect(src).toContain('fn m_hash3(p: vec3<f32>) -> f32 { return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453); }');
    expect(src).toContain('m_hash3_t(vec3<f32>(floor(in.world.y * 26.0), floor(t * 18.0), 7.0))');
    expect(src).toContain('m_hash3_t(vec3<f32>(floor(in.world.y * 20.0), floor(t * 12.0), 1.0))');
    expect(src).toContain('m_noise3_t(cp * dsc * 2.0 + vec3<f32>(tt * 0.5))');
    expect(src).toContain('m_noise3_t(cp * dsc + vec3<f32>(tt * 0.6))');
    expect(src).toContain('m_noise3_t(in.world * 2.5 + vec3<f32>(0.0, -t * mp.mat3.x * 0.5, 0.0))');
    expect(src).toContain('var f = 0.5 * m_noise3_t(p);');
    expect(src).toContain('let h = m_hash3(floor(in.world * 14.0));');
    expect(src).toContain('m_noise3(chunk * 5.0 + vec3<f32>(200.0))');
    expect(src).toContain('let h1 = fract(sin(k * 12.9898) * 43758.5453);');
  });

  it('splat: time sites use the hybrids, per-vertex and static hashes stay', () => {
    const src = SPLAT_NATIVE_WGSL;
    expect(src).toContain('fn sp_hash(n: f32) -> f32 { return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }');
    expect(src).toContain('sp_glitch_hash(t * 100.0 + vidx, t * 100.0, vidx, 0u)');
    expect(src).toContain('sp_glitch_hash(vidx * 12.9898 + t, t, vidx, 1u)');
    expect(src).not.toContain('fract(sin(t * 100.0 + vidx)');
    expect(src).toContain('sp_hash2_t(vec2<f32>(floor(t * 10.0 * dms), wp.y), 1048576.0)');
    expect(src).toContain('sp_hash2_t(vec2<f32>(t * dms, wp.x), 1048576.0)');
    expect(src).toContain('sp_noise3_t(orig * 0.8 + t * 0.8 + 400.0)');
    expect(src).toContain('sp_noise3_t(orig * 2.7 + vec3<f32>(19.0, 0.0, phase * 0.12))');
    expect(src).toContain('sp_noise2_t(wp.xy * 3.0 + vec2<f32>(0.0, -t * 2.0))');
    expect(src).not.toMatch(/sp_noise[23]\([^;]*\b(t|phase|ph|nt)\b[^;]*\)/);
    expect(src).toContain('let delay = sp_hash(vidx * 12.9898) * 0.35;');
    expect(src).toContain('let gp = floor(sp_noise3(orig * 0.5) * 4.0) * 1.57;');
    expect(src).toContain('sp_noise2(uv * 0.47)');
    expect(src).toContain('fract(sp_hash2(in.position.xy) + golden)');
  });

  it('matter: fbm noise and birth seeds use the hybrid, static seeds stay', () => {
    expect(MATTER_COMMON).toContain('fn noiseHash(n:f32)->f32');
    expect(MATTER_COMMON).toContain('fn hash(v:f32)->f32{return fract(sin(v*127.1+311.7)*43758.5453);}');
    expect(MATTER_COMMON).toContain('mix(noiseHash(n),noiseHash(n+1.),w.x)');
    expect(MATTER_PARTICLES).toContain('let birthSeed=birthHash(i,floor(ticket.w*11.));');
    expect(MATTER_PARTICLES).toContain('let seed=hash(f32(i)+u.flags.x*53.);');
    expect(MATTER_PARTICLES).toContain('origin=vec2<f32>(hash(f32(i)*2.4),hash(f32(i)*3.9));');
  });
});
