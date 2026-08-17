/**
 * nativeGraphQuality — the single place where a GPU-instrument quality
 * TIER is resolved and turned into the params that reach the native core.
 *
 * Why this module exists
 * ----------------------
 * The declared per-instrument `qualityBudgets` in `gpuShaderCatalog` used
 * to have exactly one call site — `gpuLayerRenderer`, the in-browser
 * runner. The native path (the one that actually ships) never consulted
 * them. Instead it multiplied every graph instrument by one flat number
 * from `native_quality.quality_scale`, which meant:
 *
 *   - Ultra never reached any declared ceiling (gravity-wells' 500k
 *     particles were unreachable; it got 140k x scale at every tier),
 *   - the per-tier caps for smoke-riders / fluid-riders / smoke-3d were
 *     inert on the only path that ships,
 *   - and the flat scale silently overrode the operator's own per-layer
 *     `quality` choice on the riders instruments.
 *
 * Both runners now share `applyGpuShaderQualityBudget`, so a tier means
 * the same thing in the browser preview and in the native core.
 *
 * TIER RESOLUTION ORDER (highest priority first)
 * ----------------------------------------------
 *  1. The operator's explicit setting (`settings.performance
 *     .gpuInstrumentQuality`). A fixed tier WINS OUTRIGHT — it is never
 *     clamped to the device caps and never clawed back by adaptivity.
 *     Picking Ultra for a show means Ultra for the whole show.
 *  2. `auto` + deterministic (offline export / manual clock): the device
 *     caps tier, clamped to AUTO_MAX_TIER. Adaptive inputs are ignored
 *     entirely so an export is reproducible frame-for-frame.
 *  3. `auto` + the core running its own governor (`native_quality.policy
 *     === 'auto'`): the core's live `active_tier`, clamped to the caps
 *     tier and to AUTO_MAX_TIER. This is the only mode where the tier can
 *     move by itself, and it is reported in the status line.
 *  4. `auto` + the core NOT governing (policy `fixed`, which is what the
 *     main app sends): the device caps tier, clamped to AUTO_MAX_TIER.
 *
 * The continuous `qualityScale` is NO LONGER taken from the core's
 * `native_quality.quality_scale`. That number is a property of the tier
 * (0.56/0.72/0.90/1.0), not a measurement, so feeding it into a workload
 * multiplier flattened every tier into "whatever the core booted at".
 * A continuous trim is now applied only when the core has already stepped
 * down to its floor tier and is STILL over budget — a real, measured
 * overload — and it is surfaced rather than silent.
 */
import type { GhostGpuQualityTier } from './gpuCaps';
import type { GpuShaderDef, ParamControl } from './gpuShaderTypes';
import { applyGpuShaderQualityBudget, getShaderDef, gravityWellsDefaultParams } from './gpuShaderCatalog';
import { applyRidersColorPreset } from './shaders/webgpuSmokeRidersShader';

/** The core's own tier vocabulary, which is NOT the same as the TS one. */
export type NativeCoreTier = 'performance' | 'balanced' | 'ultra' | 'insane';

/** The operator-facing setting values. */
export type GpuInstrumentQualityMode = 'auto' | GhostGpuQualityTier;

const TIER_ORDER: GhostGpuQualityTier[] = ['low', 'balanced', 'high', 'ultra'];

/**
 * Highest tier `auto` will select on its own.
 *
 * Deliberately `balanced`, for two reasons:
 *
 *  - It mirrors the core's own `auto_start_tier`, which already refuses to
 *    boot above balanced no matter how good the GPU is. Auto meaning two
 *    different things on the two sides of the boundary is what produced
 *    the original mess.
 *  - Measured on an M1 Max at 1920x1080, every tier above balanced costs
 *    real frames on the volumetric instruments (smoke-riders: 30fps at
 *    balanced, 23 at high, 12 at ultra). Balanced is exactly the workload
 *    the native path was already running, so turning tiers on changes
 *    nothing for anyone who never opens the setting — no surprise
 *    framerate cliff on upgrade.
 *
 * High and Ultra are therefore a deliberate operator choice, made once for
 * a show, and never overridden afterwards.
 */
export const AUTO_MAX_TIER: GhostGpuQualityTier = 'balanced';

export interface NativeGraphQualityState {
  /** Resolved tier that drives the per-instrument budgets. */
  tier: GhostGpuQualityTier;
  /** What the device could sustain, in TS tier vocabulary. */
  capsTier: GhostGpuQualityTier;
  /** Where `tier` came from — surfaced in the status line. */
  source: 'operator' | 'auto-adaptive' | 'auto-caps' | 'auto-deterministic';
  /** True only while the core governor may still move the tier. */
  adaptive: boolean;
  /** Continuous degradation factor. 1 unless the core is pinned at its
   *  floor tier AND still over budget. */
  qualityScale: number;
  /** The core's raw view, for the status line / debugging. */
  coreTier: string | null;
  corePolicy: string | null;
}

export const DEFAULT_NATIVE_GRAPH_QUALITY: NativeGraphQualityState = Object.freeze({
  tier: 'balanced',
  capsTier: 'balanced',
  source: 'auto-caps',
  adaptive: false,
  qualityScale: 1,
  coreTier: null,
  corePolicy: null,
});

function tierIndex(tier: GhostGpuQualityTier): number {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 ? 1 : i;
}

function minTier(a: GhostGpuQualityTier, b: GhostGpuQualityTier): GhostGpuQualityTier {
  return TIER_ORDER[Math.min(tierIndex(a), tierIndex(b))];
}

/**
 * Map the core's tier names onto the TS tiers.
 *
 * The two vocabularies differ in both names AND count: the core has four
 * tiers topping out at `insane`, the UI has four topping out at `ultra`.
 * `native` is what the core reports when its own governor is switched off
 * (policy `fixed`) — it carries no tier information, so callers fall back
 * to the caps tier.
 */
export function nativeCoreTierToGpuTier(tier: string | null | undefined): GhostGpuQualityTier | null {
  switch (String(tier ?? '').trim().toLowerCase()) {
    case 'performance':
    case 'perf':
    case 'low':
      return 'low';
    case 'balanced':
    case 'balance':
      return 'balanced';
    case 'ultra':
      return 'high';
    case 'insane':
      return 'ultra';
    default:
      return null;
  }
}

/** Inverse of {@link nativeCoreTierToGpuTier}, for telling the core which
 *  tier the operator picked. */
export function gpuTierToNativeCoreTier(tier: GhostGpuQualityTier): NativeCoreTier {
  switch (tier) {
    case 'low': return 'performance';
    case 'balanced': return 'balanced';
    case 'high': return 'ultra';
    case 'ultra': return 'insane';
    default: return 'balanced';
  }
}

/** Minimal shape this module needs out of the core's status payload. */
export interface NativeQualityStatusView {
  native_caps?: { recommended_quality_tier?: string } | null;
  native_quality?: {
    policy?: string;
    caps_tier?: string;
    active_tier?: string;
    target_frame_ms?: number;
    gpu_ema_ms?: number;
    cpu_ema_ms?: number;
    overload_frames?: number;
  } | null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Continuous trim, applied ONLY as a genuine last resort.
 *
 * By the time this returns below 1 the core has already stepped its own
 * tier down to the floor and is still missing the frame budget, so there
 * is no tier left to give up — the only remaining lever is a partial
 * workload cut. Derived from the measured EMA rather than a constant so
 * it cuts exactly as much as the overload demands.
 */
function overloadQualityScale(status: NativeQualityStatusView | null | undefined): number {
  const quality = status?.native_quality;
  if (!quality || String(quality.policy ?? '') !== 'auto') return 1;
  if (nativeCoreTierToGpuTier(quality.active_tier) !== 'low') return 1;
  if (Number(quality.overload_frames ?? 0) < 45) return 1;
  const target = Number(quality.target_frame_ms ?? 0);
  const ema = Number(quality.gpu_ema_ms ?? 0) > 0
    ? Number(quality.gpu_ema_ms)
    : Number(quality.cpu_ema_ms ?? 0);
  if (!(target > 0) || !(ema > 0) || ema <= target) return 1;
  return clampNumber(target / ema, 0.45, 1);
}

export interface ResolveNativeGraphQualityInput {
  /** `settings.performance.gpuInstrumentQuality`. */
  mode: GpuInstrumentQualityMode | null | undefined;
  status: NativeQualityStatusView | null | undefined;
  /** True while rendering off a manual clock (offline export). */
  deterministic?: boolean;
}

export function resolveNativeGraphQuality(
  input: ResolveNativeGraphQualityInput,
): NativeGraphQualityState {
  const status = input.status ?? null;
  const corePolicy = status?.native_quality?.policy ?? null;
  const coreTier = status?.native_quality?.active_tier ?? null;
  const capsTier = nativeCoreTierToGpuTier(
    status?.native_caps?.recommended_quality_tier ?? status?.native_quality?.caps_tier,
  ) ?? 'balanced';

  const mode = String(input.mode ?? 'auto').trim().toLowerCase();

  // 1. An explicit operator choice wins outright — not clamped to caps,
  //    not adaptive, no continuous trim. "Ultra" has to survive the show.
  if (mode !== 'auto' && TIER_ORDER.includes(mode as GhostGpuQualityTier)) {
    return {
      tier: mode as GhostGpuQualityTier,
      capsTier,
      source: 'operator',
      adaptive: false,
      qualityScale: 1,
      coreTier,
      corePolicy,
    };
  }

  const autoCeiling = minTier(capsTier, AUTO_MAX_TIER);

  // 2. Offline export: never let an adaptive signal in, or two renders of
  //    the same project stop matching.
  if (input.deterministic) {
    return {
      tier: autoCeiling,
      capsTier,
      source: 'auto-deterministic',
      adaptive: false,
      qualityScale: 1,
      coreTier,
      corePolicy,
    };
  }

  // 3. The core is running its own governor: follow it, bounded by caps.
  if (String(corePolicy ?? '') === 'auto') {
    const live = nativeCoreTierToGpuTier(coreTier);
    if (live) {
      return {
        tier: minTier(live, autoCeiling),
        capsTier,
        source: 'auto-adaptive',
        adaptive: true,
        qualityScale: overloadQualityScale(status),
        coreTier,
        corePolicy,
      };
    }
  }

  // 4. No governor (policy `fixed`, what the main app sends): the device
  //    caps decide, and nothing moves it afterwards.
  return {
    tier: autoCeiling,
    capsTier,
    source: 'auto-caps',
    adaptive: false,
    qualityScale: 1,
    coreTier,
    corePolicy,
  };
}

/** One-line summary for the native status line / debug overlay. */
export function describeNativeGraphQuality(quality: NativeGraphQualityState): string {
  const parts = [`tier=${quality.tier}`, `via=${quality.source}`, `caps=${quality.capsTier}`];
  if (quality.qualityScale < 1) parts.push(`overload-trim=${quality.qualityScale.toFixed(2)}`);
  if (quality.adaptive) parts.push('adaptive');
  return parts.join(' ');
}

/* ================================================================== */
/* PARAM COERCION                                                      */
/* ================================================================== */

/**
 * Params the core parses as NUMBERS, derived from each shader's own
 * paramSchema so the set can never go stale.
 *
 * This matters because the core's `native_graph_param_u32/f32` helpers
 * read JSON via `Value::as_f64`, which returns None for a STRING. A
 * select-backed numeric param like 3D Smoke's `gridSize` defaults to the
 * string `'48'` and stays a string all the way through the UI, so every
 * value the operator picked was silently discarded and the core fell back
 * to its own default of 48 — the Resolution picker did nothing on the
 * native path, and a tier that set `gridSize: 64` would have done nothing
 * either. Coercing here fixes both.
 */
const NUMERIC_PARAM_KEYS = new Map<string, Set<string>>();

function numericParamKeys(def: GpuShaderDef): Set<string> {
  const cached = NUMERIC_PARAM_KEYS.get(def.id);
  if (cached) return cached;
  const keys = new Set<string>();
  for (const control of def.paramSchema as ParamControl[]) {
    if (control.kind === 'slider' || control.kind === 'angle') {
      keys.add(control.key);
      continue;
    }
    // A select whose options are ALL numeric is a numeric control wearing
    // a dropdown; anything else (advection, style, tonemap) stays a string.
    if (control.kind === 'select') {
      const options = control.options ?? [];
      if (options.length && options.every((o) => Number.isFinite(Number(o.value)))) {
        keys.add(control.key);
      }
    }
  }
  NUMERIC_PARAM_KEYS.set(def.id, keys);
  return keys;
}

export function coerceNativeGraphNumericParams(
  def: GpuShaderDef | undefined,
  params: Record<string, any>,
): Record<string, any> {
  if (!def) return params;
  const keys = numericParamKeys(def);
  let out: Record<string, any> | null = null;
  for (const key of keys) {
    const value = params[key];
    if (typeof value !== 'string') continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    out = out ?? { ...params };
    out[key] = numeric;
  }
  return out ?? params;
}

/* ================================================================== */
/* CONTINUOUS DEGRADATION                                              */
/* ================================================================== */

export type NativeGraphWorkloadKind =
  | 'smoke-3d' | 'smoke-riders' | 'fluid-riders' | 'ink-cloud' | 'flythrough'
  | 'pixel-particles' | 'particle-field' | 'volumetric-spheres' | string;

function scaledIntegerParam(
  params: Record<string, any>,
  key: string,
  scale: number,
  fallback: number,
  min: number,
): number {
  const raw = Number(params[key]);
  const base = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(min, Math.round(base * scale));
}

function scaledSmokeGrid(gridSize: unknown, scale: number): 32 | 48 | 64 {
  const raw = Math.round(Number(gridSize));
  const base = raw === 32 || raw === 48 || raw === 64 ? raw : 48;
  if (scale <= 0.6) return 32;
  if (scale <= 0.8) return base >= 48 ? 48 : 32;
  return base === 64 ? 64 : base === 32 ? 32 : 48;
}

/**
 * Continuous workload trim for sustained overload.
 *
 * This is NOT the tier — the tier is applied by the declared
 * `qualityBudgets` before this runs. This only bites when
 * `resolveNativeGraphQuality` reports a measured overload at the floor
 * tier, i.e. when there is no tier left to drop.
 *
 * Deliberately does NOT touch the riders `quality` enum any more. That
 * used to be rewritten from the flat scale, which both flattened the tier
 * and overwrote the operator's own per-layer choice — and one of its
 * outputs (`'high'`) is not even a value the core recognises, so it
 * silently degraded to `balanced`.
 */
export function applyNativeGraphWorkloadScale(
  params: Record<string, any>,
  kind: NativeGraphWorkloadKind,
  scale: number,
): Record<string, any> {
  const safeScale = clampNumber(scale, 0.45, 1);
  if (safeScale >= 0.995) return params;
  const next = { ...params };
  switch (kind) {
    case 'smoke-3d':
      next.gridSize = scaledSmokeGrid(next.gridSize, safeScale);
      next.emitterCount = scaledIntegerParam(next, 'emitterCount', safeScale, 4, 1);
      next.shadowSteps = Math.max(0, Math.round((Number(next.shadowSteps) || 4) * safeScale));
      break;
    case 'smoke-riders':
    case 'fluid-riders':
      // The old code scaled `emitters` and `sphereCount` here, which have
      // not been params of these instruments since the riders redesign —
      // it was writing keys nothing reads. These are the real ones.
      next.riderCount = scaledIntegerParam(next, 'riderCount', safeScale, 220, 16);
      next.emitterCount = scaledIntegerParam(next, 'emitterCount', safeScale, 5, 1);
      next.marchSteps = scaledIntegerParam(next, 'marchSteps', safeScale, 72, 16);
      break;
    case 'ink-cloud':
      next.particleCount = scaledIntegerParam(next, 'particleCount', safeScale, 150_000, 1024);
      next.emitterCount = scaledIntegerParam(next, 'emitterCount', safeScale, 4, 1);
      break;
    case 'flythrough':
      next.particleCount = scaledIntegerParam(next, 'particleCount', safeScale, 250_000, 1024);
      next.slabCount = scaledIntegerParam(next, 'slabCount', Math.max(0.5, safeScale), 4, 1);
      break;
    case 'pixel-particles':
      next.particleCount = scaledIntegerParam(next, 'particleCount', safeScale, 250_000, 1024);
      break;
    case 'particle-field':
      next.particleCount = scaledIntegerParam(next, 'particleCount', safeScale, 80_000, 1024);
      next.partnerCount = scaledIntegerParam(next, 'partnerCount', safeScale, 6, 1);
      next.gravityWells = scaledIntegerParam(next, 'gravityWells', Math.max(0.65, safeScale), 3, 1);
      break;
    case 'volumetric-spheres':
      next.sphereCount = scaledIntegerParam(next, 'sphereCount', safeScale, 192, 1);
      break;
    default:
      break;
  }
  return next;
}

/* ================================================================== */
/* THE FUNNEL                                                          */
/* ================================================================== */

/**
 * Resolve one instrument layer's params for the native core.
 *
 * Order is deliberate:
 *   1. merge the instrument's defaults (gravity-wells rides the
 *      particle-field pipeline with its own default set),
 *   2. expand colour presets, so the core only ever sees concrete colours,
 *   3. apply the TIER budget — the same function the browser runner uses,
 *   4. coerce select-backed numerics so the core can actually read them,
 *   5. apply the continuous overload trim, if and only if one is active.
 */
export function resolveNativeGraphInstrumentParams(
  shaderId: string | null | undefined,
  kind: NativeGraphWorkloadKind,
  rawParams: Record<string, any>,
  quality: NativeGraphQualityState = DEFAULT_NATIVE_GRAPH_QUALITY,
): { params: Record<string, any>; applied: Record<string, { from: any; to: any; cap?: number }> } {
  const normalizedShaderId = String(shaderId ?? '').trim().toLowerCase();
  const def = getShaderDef(normalizedShaderId);

  let params: Record<string, any> = rawParams ?? {};
  if (kind === 'particle-field' && normalizedShaderId === 'gravity-wells') {
    params = {
      ...gravityWellsDefaultParams,
      ...params,
      mode: params.mode ?? gravityWellsDefaultParams.mode ?? 'gravity',
    };
  }
  if (kind === 'smoke-riders' || kind === 'fluid-riders') {
    // Colour presets are expanded HERE — the single funnel into the core —
    // so the Rust side only ever sees concrete colours and the preset
    // logic lives once, in TS.
    params = applyRidersColorPreset(params);
  }

  const budgeted = applyGpuShaderQualityBudget(def, params, {
    capsTier: quality.capsTier,
    suggestedTier: quality.tier,
    // The budget's own `scaleMaxParams` trimming is the browser runner's
    // continuous lever; on the native path the trim is applied once,
    // below, so the caps here stay at the tier's honest ceiling.
    qualityScale: 1,
    adaptive: quality.adaptive,
  });

  const coerced = coerceNativeGraphNumericParams(def, budgeted.params);
  const scaled = applyNativeGraphWorkloadScale(coerced, kind, quality.qualityScale);
  return { params: scaled, applied: budgeted.applied };
}
