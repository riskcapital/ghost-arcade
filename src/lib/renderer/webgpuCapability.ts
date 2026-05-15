/**
 * webgpuCapability — WebGPU detection + adapter info caching for the
 * S4 pilot.
 *
 * Two questions this module answers, both before any user-visible UI
 * has the chance to need the answer:
 *
 *   1. `isWebGPUSupported()` — sync, cheap. True iff `navigator.gpu`
 *      exists AND `requestAdapter()` resolved successfully at least
 *      once. Used to gate the experimental layer-type from showing
 *      up in the layer-add menu (no point offering an effect that
 *      can't run). Default-false until `probeWebGPU()` resolves.
 *
 *   2. `getWebGPUInfo()` — async, returns the GPUAdapterInfo +
 *      feature flags so the diagnostics panel can show "Backend:
 *      WebGPU on D3D12 / Intel Iris Xe" instead of just a yes/no.
 *      Cached after first probe — no repeated `requestAdapter()`
 *      calls.
 *
 * Override hooks (dev-only):
 *
 *   - URL param `?webgpu-disable=1` forces `isWebGPUSupported()`
 *     to return false even on capable hardware. Useful for testing
 *     the WebGL2 fallback path on a machine that has WebGPU.
 *
 *   - URL param `?webgpu-force=1` skips the probe and asserts
 *     supported=true. The renderer instantiation will throw
 *     downstream if WebGPU genuinely isn't there — useful for
 *     proving error paths surface cleanly.
 *
 * Both overrides are read once at module load to keep the sync
 * isSupported check fast in hot animate-loop paths.
 *
 * S4-pilot-only: this module does NOT live in the production code
 * path until `settings.experimental.webgpuPilot` is true OR the URL
 * params above are set. Production users see no behavior change.
 */

import { writable, type Writable } from 'svelte/store';

let _cachedSupport: boolean | null = null;
let _cachedInfo: WebGPUInfo | null = null;
let _probePromise: Promise<boolean> | null = null;

/**
 * Reactive store that mirrors `_cachedSupport` so Svelte components can
 * subscribe and re-render when the probe completes asynchronously.
 *
 * Why this exists: `isWebGPUSupported()` is a synchronous function — when
 * components call it at component-init time (e.g. EffectPickerModal,
 * LayerPanel) the probe may not have finished yet, so they get back
 * `false` and hide the GPU-only features (gpuFluidSim, GPU Shader layer
 * button, etc.). The local snapshot then never updates, even after the
 * probe lands — the UI stays stuck saying "no WebGPU here" on machines
 * that actually support it.
 *
 * Components should subscribe to `$webgpuSupportedStore` instead of
 * snapshotting `isWebGPUSupported()` so they re-render the moment the
 * probe resolves.
 *
 * URL overrides honored at module-load: `?webgpu-disable=1` initializes
 * the store to false; `?webgpu-force=1` initializes it to true.
 */
export const webgpuSupportedStore: Writable<boolean> = writable(false);

// Honor `?webgpu-force=1` immediately so subscribers see `true` even
// before the probe runs (the URL override path skips the probe).
// `?webgpu-disable=1` keeps the default `false`.
// (URL_PARAMS is read once at module load further down — guarded by
// a typeof check so this file remains import-safe in non-browser test
// environments.)
if (typeof window !== 'undefined') {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('webgpu-force') !== null && params.get('webgpu-disable') === null) {
      webgpuSupportedStore.set(true);
    }
  } catch { /* ignore */ }
}

/** Single setter — keeps `_cachedSupport` and the store in lockstep. */
function setCachedSupport(v: boolean | null): void {
  _cachedSupport = v;
  webgpuSupportedStore.set(v === true);
}

export interface WebGPUInfo {
  /** Whether the probe succeeded. */
  supported: boolean;
  /** GPUAdapterInfo.vendor (e.g. "intel", "nvidia", "amd"). */
  vendor: string | null;
  /** GPUAdapterInfo.architecture (e.g. "rdna-3"). */
  architecture: string | null;
  /** GPUAdapterInfo.device (raw device identifier). */
  device: string | null;
  /** GPUAdapterInfo.description (human-readable, browser-provided). */
  description: string | null;
  /** Feature names the adapter supports — see WebGPU spec.
   *  Useful: 'timestamp-query', 'shader-f16', 'texture-compression-bc'. */
  features: string[];
  /** Whether this is a fallback / software adapter (slow). */
  isFallbackAdapter: boolean;
  /** When the probe ran. Used by diagnostics to show "WebGPU
   *  detected XXs ago" so a stale adapter (e.g. after GPU
   *  hot-unplug) is visually distinguishable. */
  probedAt: number;
  /** If `supported:false`, the reason. Empty string when
   *  supported. */
  failReason: string;
}

const DISABLED: WebGPUInfo = {
  supported: false,
  vendor: null,
  architecture: null,
  device: null,
  description: null,
  features: [],
  isFallbackAdapter: false,
  probedAt: 0,
  failReason: 'not yet probed',
};

/** Read once at module load — URL params don't change mid-session. */
const URL_PARAMS = (() => {
  if (typeof window === 'undefined') return new URLSearchParams();
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
})();

const DISABLE_OVERRIDE = URL_PARAMS.has('webgpu-disable');
const FORCE_OVERRIDE = URL_PARAMS.has('webgpu-force');
/** URL-only opt-in for the pilot itself (separate from
 *  `webgpu-force`, which only affects the capability probe).
 *  `?webgpu-pilot=1` flips the effective pilot flag on without
 *  the user having to toggle settings — useful for benchmarking
 *  and for the visual regression harness's pilot fixture. */
const PILOT_URL_OVERRIDE = URL_PARAMS.get('webgpu-pilot') === '1';

/**
 * Synchronous "is WebGPU available" check. Returns false until
 * `probeWebGPU()` has resolved successfully. Safe to call from
 * animate-loop hot paths — branch-predictable boolean check, no
 * allocations.
 *
 * For first-time-availability gating (e.g. layer-add menu), call
 * `probeWebGPU()` once at app boot then use this for every read.
 */
export function isWebGPUSupported(): boolean {
  if (DISABLE_OVERRIDE) return false;
  if (FORCE_OVERRIDE) return true;
  return _cachedSupport === true;
}

/**
 * Run the WebGPU adapter probe. Idempotent — concurrent callers
 * share one in-flight `requestAdapter()` Promise. Resolves to the
 * supported boolean; the full info object is available via
 * `getWebGPUInfo()` after this resolves.
 *
 * Failure modes that resolve `false` (not throw):
 *   - `navigator.gpu` undefined (unsupported browser / Electron build
 *     / disabled flag in chromium)
 *   - `requestAdapter()` returns null (no compatible adapter — happens
 *     on Linux/Mesa when WebGPU is fenced off, or when a sandboxed
 *     environment denies GPU access)
 *   - `requestAdapter()` throws (rare; some browsers throw when the
 *     adapter would require a feature the page didn't request)
 *
 * The failure reason is captured in `WebGPUInfo.failReason` so the
 * diagnostics panel can surface it without re-running the probe.
 */
export async function probeWebGPU(): Promise<boolean> {
  if (DISABLE_OVERRIDE) {
    setCachedSupport(false);
    _cachedInfo = { ...DISABLED, failReason: '?webgpu-disable URL override' };
    return false;
  }
  if (_cachedSupport !== null) return _cachedSupport;
  if (_probePromise) return _probePromise;

  _probePromise = (async () => {
    if (typeof navigator === 'undefined' || !(navigator as any).gpu) {
      setCachedSupport(false);
      _cachedInfo = { ...DISABLED, failReason: 'navigator.gpu undefined' };
      return false;
    }
    try {
      // GPU types aren't in our tsconfig lib (`@webgpu/types` would
      // pull them in, but it's not on dependencies and we don't want
      // to add it just for this pilot). Cast to any and rely on the
      // runtime navigator.gpu check above.
      const gpu = (navigator as any).gpu as any;
      // High-performance preference signals "use the discrete GPU
      // when one is available". Falls back to integrated on laptops
      // without a dedicated chip — same behavior as WebGL2's
      // `powerPreference: 'high-performance'`.
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        setCachedSupport(false);
        _cachedInfo = { ...DISABLED, failReason: 'requestAdapter returned null' };
        return false;
      }
      // GPUAdapterInfo is async in newer specs (`adapter.requestAdapterInfo()`)
      // and sync in older ones (`adapter.info`). Try both for forward-compat.
      let info: any = (adapter as any).info ?? null;
      if (!info && typeof (adapter as any).requestAdapterInfo === 'function') {
        try { info = await (adapter as any).requestAdapterInfo(); } catch { /* */ }
      }
      const features: string[] = [];
      try {
        const set = (adapter as any).features as Set<string> | undefined;
        if (set && typeof set.forEach === 'function') {
          set.forEach((f: string) => features.push(f));
        }
      } catch { /* */ }
      setCachedSupport(true);
      _cachedInfo = {
        supported: true,
        vendor: info?.vendor ?? null,
        architecture: info?.architecture ?? null,
        device: info?.device ?? null,
        description: info?.description ?? null,
        features,
        isFallbackAdapter: !!(adapter as any).isFallbackAdapter,
        probedAt: Date.now(),
        failReason: '',
      };
      return true;
    } catch (e: any) {
      setCachedSupport(false);
      _cachedInfo = { ...DISABLED, failReason: `requestAdapter threw: ${e?.message || e}` };
      return false;
    } finally {
      _probePromise = null;
    }
  })();
  return _probePromise;
}

/**
 * Get the full adapter info, including failure reason if the probe
 * decided WebGPU isn't usable. Returns DISABLED until `probeWebGPU()`
 * has resolved — caller should await `probeWebGPU()` first if it
 * needs current data.
 */
export function getWebGPUInfo(): WebGPUInfo {
  return _cachedInfo ?? DISABLED;
}

/**
 * Test-only reset hook. Clears the cached probe so the next
 * `probeWebGPU()` re-runs. Not exposed in production paths — but
 * useful in unit tests that want to assert the probe behavior under
 * different mocks. URL overrides still take effect on the next read.
 */
export function _resetWebGPUCapabilityForTesting(): void {
  setCachedSupport(null);
  _cachedInfo = null;
  _probePromise = null;
}

/**
 * Decide whether the S4 pilot should be active right now.
 *
 * Effective rule:
 *
 *   pilot = `?webgpu-pilot=1` URL override
 *           AND `isWebGPUSupported()`
 *
 * Pre-fix this honoured a persisted settings flag too, which meant a
 * stale persisted toggle would silently impose an extra 512×512
 * WebGPU render every animation frame. Codex flagged that as a P2
 * perf regression vs the Pro folder. The pilot is a benchmarking /
 * diagnostic tool, not a feature — gate it on an explicit URL opt-in
 * so it can never run "by accident".
 *
 * `settingsFlagOn` is now ignored. The parameter stays so existing
 * call sites compile, and the dev-preferences toggle still persists
 * its value (so a power user who wants it on by default can also
 * append `?webgpu-pilot=1` to their dev URL alias).
 *
 * Either disable hook (`?webgpu-disable=1` or the capability probe
 * failing) still overrides everything else and forces false.
 */
export function isPilotEffectivelyEnabled(_settingsFlagOn: boolean): boolean {
  if (DISABLE_OVERRIDE) return false;
  if (!isWebGPUSupported()) return false;
  return PILOT_URL_OVERRIDE;
}
