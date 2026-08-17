import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTO_MAX_TIER,
  coerceNativeGraphNumericParams,
  gpuTierToNativeCoreTier,
  nativeCoreTierToGpuTier,
  resolveNativeGraphInstrumentParams,
  resolveNativeGraphQuality,
} from './nativeGraphQuality';
import { getShaderDef } from './gpuShaderCatalog';
import { SMOKE_RIDERS_QUALITY_RESOLUTION } from './shaders/webgpuSmokeRidersShader';
import type { GhostGpuQualityTier } from './gpuCaps';

const M1_MAX_STATUS = {
  native_caps: { recommended_quality_tier: 'insane' },
  native_quality: {
    policy: 'fixed',
    caps_tier: 'insane',
    active_tier: 'native',
    quality_scale: 1,
  },
};

const AUTO_STATUS = {
  native_caps: { recommended_quality_tier: 'insane' },
  native_quality: {
    policy: 'auto',
    caps_tier: 'insane',
    active_tier: 'balanced',
    quality_scale: 0.72,
    target_frame_ms: 16.67,
    gpu_ema_ms: 8,
    cpu_ema_ms: 3,
    overload_frames: 0,
  },
};

describe('tier vocabulary mapping', () => {
  it('maps the core four-tier scale onto the UI four-tier scale', () => {
    expect(nativeCoreTierToGpuTier('performance')).toBe('low');
    expect(nativeCoreTierToGpuTier('balanced')).toBe('balanced');
    expect(nativeCoreTierToGpuTier('ultra')).toBe('high');
    expect(nativeCoreTierToGpuTier('insane')).toBe('ultra');
    // `native` is what the core reports with its governor switched off.
    // It carries no tier, so callers must fall back to caps.
    expect(nativeCoreTierToGpuTier('native')).toBeNull();
    expect(nativeCoreTierToGpuTier(undefined)).toBeNull();
  });

  it('round-trips back to the core vocabulary', () => {
    for (const tier of ['low', 'balanced', 'high', 'ultra'] as GhostGpuQualityTier[]) {
      expect(nativeCoreTierToGpuTier(gpuTierToNativeCoreTier(tier))).toBe(tier);
    }
  });
});

describe('resolveNativeGraphQuality', () => {
  it('lets an explicit operator tier beat the core recommendation', () => {
    const q = resolveNativeGraphQuality({ mode: 'ultra', status: AUTO_STATUS });
    expect(q.tier).toBe('ultra');
    expect(q.source).toBe('operator');
    expect(q.adaptive).toBe(false);
    expect(q.qualityScale).toBe(1);
  });

  it('never claws an explicit Ultra back down, even under sustained overload', () => {
    const overloaded = {
      ...AUTO_STATUS,
      native_quality: {
        ...AUTO_STATUS.native_quality,
        active_tier: 'performance',
        overload_frames: 5000,
        gpu_ema_ms: 60,
      },
    };
    const q = resolveNativeGraphQuality({ mode: 'ultra', status: overloaded });
    expect(q.tier).toBe('ultra');
    expect(q.qualityScale).toBe(1);
  });

  it('honours an explicit tier ABOVE what the device caps report', () => {
    const weak = {
      native_caps: { recommended_quality_tier: 'performance' },
      native_quality: { policy: 'auto', caps_tier: 'performance', active_tier: 'performance' },
    };
    expect(resolveNativeGraphQuality({ mode: 'ultra', status: weak }).tier).toBe('ultra');
  });

  it('follows the core governor in auto, bounded by the auto ceiling', () => {
    const q = resolveNativeGraphQuality({ mode: 'auto', status: AUTO_STATUS });
    expect(q.tier).toBe('balanced');
    expect(q.source).toBe('auto-adaptive');
    expect(q.adaptive).toBe(true);
  });

  it('never lets auto climb past Balanced on its own', () => {
    // Pinned deliberately: `auto` must reproduce the workload the native
    // path was already running, so switching tiers on cannot cost anyone
    // frames they had yesterday. Raising this is a perf decision that
    // needs new measurements, not a tweak.
    expect(AUTO_MAX_TIER).toBe('balanced');
    for (const coreTier of ['balanced', 'ultra', 'insane']) {
      const q = resolveNativeGraphQuality({
        mode: 'auto',
        status: { ...AUTO_STATUS, native_quality: { ...AUTO_STATUS.native_quality, active_tier: coreTier } },
      });
      expect(q.tier).toBe('balanced');
    }
  });

  it('clamps auto to AUTO_MAX_TIER even when caps and core say higher', () => {
    const q = resolveNativeGraphQuality({
      mode: 'auto',
      status: { ...AUTO_STATUS, native_quality: { ...AUTO_STATUS.native_quality, active_tier: 'insane' } },
    });
    expect(q.tier).toBe(AUTO_MAX_TIER);
  });

  it('uses the device caps when the core governor is switched off (policy fixed)', () => {
    const q = resolveNativeGraphQuality({ mode: 'auto', status: M1_MAX_STATUS });
    expect(q.capsTier).toBe('ultra');
    expect(q.tier).toBe(AUTO_MAX_TIER);
    expect(q.source).toBe('auto-caps');
    expect(q.adaptive).toBe(false);
  });

  it('ignores every adaptive input when rendering deterministically', () => {
    const q = resolveNativeGraphQuality({ mode: 'auto', status: AUTO_STATUS, deterministic: true });
    expect(q.source).toBe('auto-deterministic');
    expect(q.adaptive).toBe(false);
    expect(q.qualityScale).toBe(1);
    // Same project, same machine, same tier — twice.
    expect(resolveNativeGraphQuality({ mode: 'auto', status: AUTO_STATUS, deterministic: true })).toEqual(q);
  });

  it('does NOT read a continuous trim out of the tier scale', () => {
    // quality_scale 0.72 is simply what "balanced" means to the core, not
    // a measurement — treating it as a workload multiplier is the bug this
    // module exists to fix.
    expect(resolveNativeGraphQuality({ mode: 'auto', status: AUTO_STATUS }).qualityScale).toBe(1);
  });

  it('only trims continuously once the core is pinned at its floor tier AND over budget', () => {
    const floored = {
      ...AUTO_STATUS,
      native_quality: {
        ...AUTO_STATUS.native_quality,
        active_tier: 'performance',
        overload_frames: 90,
        target_frame_ms: 16.67,
        gpu_ema_ms: 33.34,
      },
    };
    const q = resolveNativeGraphQuality({ mode: 'auto', status: floored });
    expect(q.tier).toBe('low');
    expect(q.qualityScale).toBeCloseTo(0.5, 2);
  });
});

describe('tier -> params that actually reach the core', () => {
  const tierParams = (shaderId: string, kind: string, tier: GhostGpuQualityTier, raw: Record<string, any> = {}) =>
    resolveNativeGraphInstrumentParams(shaderId, kind, raw, {
      tier,
      capsTier: 'ultra',
      source: 'operator',
      adaptive: false,
      qualityScale: 1,
      coreTier: null,
      corePolicy: null,
    }).params;

  it('gravity-wells reaches its declared 500k ceiling at Ultra', () => {
    expect(tierParams('gravity-wells', 'particle-field', 'ultra').particleCount).toBe(500000);
    expect(tierParams('gravity-wells', 'particle-field', 'ultra').partnerCount).toBe(24);
  });

  it('gravity-wells keeps its stock 140k / 16 partners at Balanced', () => {
    const p = tierParams('gravity-wells', 'particle-field', 'balanced');
    expect(p.particleCount).toBe(140000);
    expect(p.partnerCount).toBe(16);
  });

  it('gravity-wells particle count is strictly monotonic across tiers', () => {
    const counts = (['low', 'balanced', 'high', 'ultra'] as GhostGpuQualityTier[])
      .map((t) => tierParams('gravity-wells', 'particle-field', t).particleCount);
    expect(counts).toEqual([90000, 140000, 260000, 500000]);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  it('never raises a param the operator authored, but still caps it', () => {
    // Authored well below the tier target: left alone, not inflated.
    expect(tierParams('gravity-wells', 'particle-field', 'ultra', { particleCount: 25000 }).particleCount)
      .toBe(25000);
    // Authored above the tier ceiling: clamped.
    expect(tierParams('gravity-wells', 'particle-field', 'low', { particleCount: 400000 }).particleCount)
      .toBe(90000);
  });

  it('drives the riders grid through the quality enum the core actually reads', () => {
    for (const [tier, quality] of [
      ['low', 'performance'], ['balanced', 'balanced'], ['high', 'ultra'], ['ultra', 'ultra'],
    ] as [GhostGpuQualityTier, string][]) {
      expect(tierParams('smoke-riders', 'smoke-riders', tier).quality).toBe(quality);
      expect(tierParams('fluid-riders', 'fluid-riders', tier).quality).toBe(quality);
    }
  });

  it('authors riders march/rider counts so the core multiplier lands on the ceiling', () => {
    const p = tierParams('smoke-riders', 'smoke-riders', 'ultra');
    const scales = SMOKE_RIDERS_QUALITY_RESOLUTION.ultra;
    // The core re-derives these from `quality`; what we author has to be
    // pre-divided so the post-multiply value is the number we want.
    expect(Math.round(p.marchSteps * scales.marchScale)).toBe(160);
    expect(Math.round(p.riderCount * scales.countScale)).toBe(900);
    expect(Math.round(p.shadowSteps * scales.shadowScale)).toBe(10);
  });

  it('leaves the riders instruments on their shader defaults at Balanced', () => {
    const def = getShaderDef('smoke-riders')!;
    // A real gpu layer stores a DENSE param object seeded from the shader
    // defaults, so drive this the way the app does.
    const p = tierParams('smoke-riders', 'smoke-riders', 'balanced', { ...def.defaultParams });
    expect(p.quality).toBe('balanced');
    expect(p.marchSteps).toBe(def.defaultParams.marchSteps);
    expect(p.shadowSteps).toBe(def.defaultParams.shadowSteps);
    expect(p.riderCount).toBe(def.defaultParams.riderCount);
  });

  it('moves the smoke-3d grid per tier and sends it as a NUMBER', () => {
    for (const [tier, grid] of [['low', 32], ['balanced', 48], ['high', 64], ['ultra', 64]] as const) {
      const p = tierParams('smoke-3d', 'smoke-3d', tier);
      expect(p.gridSize).toBe(grid);
      // The core parses params with serde `as_f64`, which returns None for
      // a JSON string — a string here is silently discarded.
      expect(typeof p.gridSize).toBe('number');
    }
  });

  it('coerces select-backed numeric params the core would otherwise ignore', () => {
    const def = getShaderDef('smoke-3d')!;
    // This is the shape the UI actually produces: the select round-trips
    // its option value as a string.
    const coerced = coerceNativeGraphNumericParams(def, { gridSize: '64', shadowSteps: 4 });
    expect(coerced.gridSize).toBe(64);
    // Non-numeric selects must stay strings.
    const riders = getShaderDef('smoke-riders')!;
    expect(coerceNativeGraphNumericParams(riders, { quality: 'ultra' }).quality).toBe('ultra');
    expect(coerceNativeGraphNumericParams(riders, { advection: 'maccormack' }).advection).toBe('maccormack');
  });

  it('expands riders colour presets before anything reaches the core', () => {
    const p = tierParams('smoke-riders', 'smoke-riders', 'balanced', { colorPreset: 'molten' });
    expect(Array.isArray(p.colorA)).toBe(true);
  });

  it('passes effect-graph kinds through untouched', () => {
    const raw = { someEffectParam: 3 };
    expect(resolveNativeGraphInstrumentParams(null, 'ghostfx', raw).params).toEqual(raw);
  });
});

describe('TS <-> Rust riders quality resolution', () => {
  // The core owns the riders graph and re-derives grid size, pressure
  // sweeps, rider hits and the march/rider/shadow multipliers from the
  // `quality` enum INDEPENDENTLY of TS. The TS budget authors params on
  // the assumption those multipliers are what Rust says they are, so a
  // one-sided edit has to fail here rather than silently mismatch.
  const rust = readFileSync(
    resolve(__dirname, '../../../native-renderer/src/main.rs'),
    'utf8',
  );
  const body = rust.slice(
    rust.indexOf('fn normalize_smoke_riders_native_params('),
    rust.indexOf('fn normalize_smoke_riders_native_params(') + 6000,
  );

  /** Pull `"ultra" => X, "performance" => Y, _ => Z` out of a match on quality. */
  function matchArms(binding: string): { ultra: number; performance: number; balanced: number } {
    const re = new RegExp(
      `let ${binding}[^=]*= match quality\\.as_str\\(\\) \\{([\\s\\S]*?)\\};`,
    );
    const block = body.match(re);
    if (!block) throw new Error(`no match block for ${binding}`);
    const grab = (key: string) => {
      const m = block[1].match(new RegExp(`"${key}" => ([0-9.]+)`));
      if (!m) throw new Error(`no ${key} arm for ${binding}`);
      return Number(m[1]);
    };
    const fallback = block[1].match(/_ => ([0-9.]+)/);
    if (!fallback) throw new Error(`no default arm for ${binding}`);
    return { ultra: grab('ultra'), performance: grab('performance'), balanced: Number(fallback[1]) };
  }

  /** Pull `if quality == "X" { A } else { B }`. */
  function ifArms(binding: string, key: string): { match: number; other: number } {
    const re = new RegExp(
      `let ${binding}[^=]*= if quality == "${key}" \\{\\s*([0-9.]+)\\s*\\} else \\{\\s*([0-9.]+)\\s*\\};`,
    );
    const m = body.match(re);
    if (!m) throw new Error(`no if block for ${binding}`);
    return { match: Number(m[1]), other: Number(m[2]) };
  }

  it('grid size matches', () => {
    const arms = matchArms('grid_size');
    expect(arms.performance).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.performance.gridSize);
    expect(arms.balanced).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.balanced.gridSize);
    expect(arms.ultra).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.ultra.gridSize);
  });

  it('count and march multipliers match', () => {
    const count = matchArms('count_scale');
    expect(count.performance).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.performance.countScale);
    expect(count.balanced).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.balanced.countScale);
    expect(count.ultra).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.ultra.countScale);

    const march = matchArms('march_scale');
    expect(march.performance).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.performance.marchScale);
    expect(march.balanced).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.balanced.marchScale);
    expect(march.ultra).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.ultra.marchScale);
  });

  it('rider hits match', () => {
    const hits = matchArms('rider_hits');
    expect(hits.performance).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.performance.riderHits);
    expect(hits.balanced).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.balanced.riderHits);
    expect(hits.ultra).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.ultra.riderHits);
  });

  it('pressure iterations and shadow scale match', () => {
    const pressure = ifArms('pressure_iterations', 'ultra');
    expect(pressure.match).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.ultra.pressureIterations);
    expect(pressure.other).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.balanced.pressureIterations);

    const shadow = ifArms('shadow_scale', 'performance');
    expect(shadow.match).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.performance.shadowScale);
    expect(shadow.other).toBe(SMOKE_RIDERS_QUALITY_RESOLUTION.balanced.shadowScale);
  });
});
