/**
 * What the editor does when the render core cannot start or stops.
 *
 * The workspace used to sit on "Native engine starting -- waiting for core
 * frame source" forever: a failed start only reached the console, the sync
 * lifecycle never tried again, and a core that exited (a wgpu panic on device
 * loss, a missing Windows DLL) was never restarted. These rules decide what
 * the user sees and when the editor restarts the core on its own.
 */
import type { RendererStatus } from '$lib/api/native-renderer';

export interface NativeCoreFailure {
  title: string;
  detail: string;
  hint: string;
}

/** Waits before each automatic restart of a core that stopped by itself.
 *  After the last one the error stays up with Retry. */
export const NATIVE_CORE_RESTART_DELAYS_MS = [1000, 3000, 8000] as const;

/** A core that has run this long without stopping again earns a fresh set of
 *  automatic restarts: faults far apart are separate incidents, not a loop. */
export const NATIVE_CORE_STABLE_RUN_MS = 60_000;

export function nativeCoreRestartDelay(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 0) return NATIVE_CORE_RESTART_DELAYS_MS[0];
  return NATIVE_CORE_RESTART_DELAYS_MS[Math.floor(attempt)] ?? null;
}

type CoreStatus = Pick<RendererStatus, 'running' | 'last_frame_error'>
  & Partial<Pick<RendererStatus, 'core_instance' | 'core_exited_unexpectedly' | 'core_failure_hint'>>;

/**
 * Why the core the editor started is gone, or null while it is fine.
 *
 * Two cases: the process stopped by itself (the broker marks it), or the
 * broker replaced it (after a GPU fault). The replacement starts empty, so
 * the editor must start a fresh sync either way to send its scene again.
 */
export function nativeCoreLossReason(
  status: CoreStatus | null | undefined,
  startedInstance: number | null,
): string | null {
  if (!status) return null;
  if (status.core_exited_unexpectedly && !status.running) {
    return status.last_frame_error || 'The render core stopped.';
  }
  const instance = Number(status.core_instance ?? 0);
  if (startedInstance && instance > 0 && instance !== startedInstance) {
    return 'The render core restarted.';
  }
  return null;
}

/** Electron wraps a rejected main-process call; keep only the core's words. */
export function stripIpcErrorPrefix(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^(?:Error:\s*)+/i, '')
    .trim();
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

/** The overlay text for a core that could not start, or stopped for good. */
export function describeNativeCoreFailure(
  error: unknown,
  status: CoreStatus | null | undefined,
  options: { stopped?: boolean } = {},
): NativeCoreFailure {
  const raw = stripIpcErrorPrefix(errorText(error ?? ''));
  const title = options.stopped ? 'Render core stopped' : 'Render core could not start';
  // The broker already explained an exit: its message and hint lead.
  if (status?.core_failure_hint) {
    return {
      title,
      detail: status.last_frame_error || raw || 'The render core stopped.',
      hint: status.core_failure_hint,
    };
  }
  if (/binary missing|ghost-render-core.*(not found|missing)|ENOENT/i.test(raw)) {
    return {
      title,
      detail: 'The render core is missing from this installation.',
      hint: 'Reinstall Ghost Arcade, then open it again.',
    };
  }
  if (/timed out|timeout/i.test(raw)) {
    return {
      title,
      detail: 'The render core did not answer in time.',
      hint: 'The first launch after an update can take a while as the graphics driver prepares shaders. Press Retry. If it keeps happening, update your graphics driver.',
    };
  }
  if (/backend reported not ready|no (suitable )?adapter|adapter/i.test(raw)) {
    return {
      title,
      detail: raw || 'The graphics card could not be used.',
      hint: 'Update your graphics driver, then press Retry.',
    };
  }
  return {
    title,
    detail: raw || status?.last_frame_error || 'Unknown error.',
    hint: 'Press Retry. If it keeps happening, open the log and send it to us.',
  };
}
