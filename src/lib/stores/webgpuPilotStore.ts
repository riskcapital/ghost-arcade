/**
 * webgpuPilotStore — reactive readout of S4 pilot metrics for the
 * diagnostics panel.
 *
 * Why a store rather than a window global: the diagnostics panel
 * needs to update when metrics change without re-importing the pilot
 * (which would pull `three/webgpu` into the panel's chunk). A
 * Svelte store lets Canvas.svelte push numbers in and the panel
 * subscribe with $-prefix syntax — the WebGPU code stays isolated
 * to its own dynamic-imported chunk.
 *
 * The shape mirrors what the reviewer asked us to measure:
 *
 *   - `webgpuRenderMs` — pilot's own render cost (ema-smoothed)
 *   - `handoffUploadMs` — WebGPU canvas → WebGL2 texture upload time
 *   - `mainRenderMs` — main compositor render delta vs no-pilot
 *     baseline; useful for catching pilot-induced GL state pollution
 *   - `pilotFps` / `mainFps` — frame-rate readouts at the same
 *     wall-clock window so the user can read them side-by-side
 *   - `glContextCount` — number of WebGL-ish contexts the renderer
 *     subsystems are holding (S2 polished this down to 1; S4 must
 *     not silently regress that)
 *   - `gpuMemMb` — best-effort GPU memory readout via the
 *     `WEBGL_renderer_info` non-standard extension if available;
 *     null otherwise. Detects the case where the WebGPU device
 *     doubles up VRAM allocation alongside the WebGL context.
 *   - `outputWindowActive` / `viewportLabel` — environment context
 *     the numbers were sampled in. Lets the diagnostics panel show
 *     "Pilot at 4K with output window open" so users running
 *     comparable benchmarks share comparable conditions.
 *
 * Telemetry is always-on when the pilot is active (cheap), gated to
 * undefined / 0 when the pilot is off (so the panel can hide its
 * pilot section entirely).
 */

import { writable } from 'svelte/store';

export interface WebGPUPilotMetricsSnapshot {
  /** Whether the pilot is currently running. False when the flag is
   *  off OR the capability probe failed OR the pilot's create()
   *  threw. */
  active: boolean;
  /** Reason for inactivity. Empty string when active. Useful for
   *  the diagnostics panel: "WebGPU not supported on this adapter"
   *  vs "Pilot disabled in settings" vs "Pilot create failed: ..." */
  inactiveReason: string;
  /** Adapter description (vendor/device) or '' when unavailable. */
  adapter: string;
  /** Pilot render time per frame, ema-smoothed (ms). */
  webgpuRenderMs: number;
  /** WebGPU canvas → WebGL2 texture upload time, ema-smoothed (ms).
   *  THIS IS THE KEY MEASUREMENT for the S4 go/no-go decision. */
  handoffUploadMs: number;
  /** Main compositor render delta (ms). With pilot off vs on, the
   *  diagnostics panel can show this as a +ms overhead figure. */
  mainRenderMs: number;
  /** Pilot canvas dimensions ("512x512"). */
  pilotDims: string;
  /** Total pilot frames rendered + failed (separate counters). */
  pilotFramesRendered: number;
  pilotFramesFailed: number;
  /** Last error from the pilot, if any. */
  lastError: string | null;
  /** Number of separate WebGL/WebGPU contexts the app is holding.
   *  S2 reduced this to 1 main + N renderer-subsystem contexts.
   *  Adding the pilot must NOT regress this silently. */
  glContextCount: number;
  /** Approximate GPU memory used (MB) — best-effort, may be null on
   *  platforms without renderer-info access. */
  gpuMemMb: number | null;
  /** Active viewport label so users running comparison benchmarks
   *  can tag samples ("1080p / no output", "4K / output window"). */
  viewportLabel: string;
  /** Whether the output window is open during this measurement. */
  outputWindowActive: boolean;
  /** When the snapshot was last updated. */
  updatedAt: number;
}

const INITIAL: WebGPUPilotMetricsSnapshot = {
  active: false,
  inactiveReason: 'pilot not initialized',
  adapter: '',
  webgpuRenderMs: 0,
  handoffUploadMs: 0,
  mainRenderMs: 0,
  pilotDims: '',
  pilotFramesRendered: 0,
  pilotFramesFailed: 0,
  lastError: null,
  glContextCount: 0,
  gpuMemMb: null,
  viewportLabel: '',
  outputWindowActive: false,
  updatedAt: 0,
};

export const webgpuPilotMetrics = writable<WebGPUPilotMetricsSnapshot>({ ...INITIAL });

/** Reset to initial. Called by Canvas.svelte's onMount when the
 *  pilot is intentionally torn down (flag turned off, component
 *  unmount). */
export function resetWebgpuPilotMetrics(): void {
  webgpuPilotMetrics.set({ ...INITIAL });
}
