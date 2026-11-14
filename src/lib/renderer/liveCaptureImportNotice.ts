/*
 * What to tell the user when the render core cannot open a camera's or a
 * screen capture's frames.
 *
 * On Windows each frame reaches the core as a shared texture, and a shared
 * texture only opens on the graphics adapter that made it. On a laptop with
 * two GPUs the capture device and the core could land on different ones: the
 * camera listed, started and produced frames, the core rejected every one,
 * and the only trace was a console warning. The layer just stayed blank.
 *
 * The capture device is now made on the core's adapter (electron/
 * live-capture-adapter.js). When that still fails -- no matching adapter, or
 * a driver that refuses -- the user is told once per source, not per frame.
 */

export type LiveCaptureKind = 'webcam' | 'capture';

export type LiveCaptureImportFailure = {
  kind: LiveCaptureKind;
  /** The adapter the capture device is on (from the addon), if known. */
  captureAdapterLuid?: string | null;
  /** The adapter the render core renders with, if known. */
  coreAdapterLuid?: string | null;
  /** The core's rejection reason. */
  reason?: string | null;
};

const GRAPHICS_SETTINGS_TIP =
  'In Windows Settings > System > Display > Graphics, set Ghost Arcade Pro to High performance, '
  + 'restart the app, then add it again.';

function luid(value: string | null | undefined): string {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{16}$/.test(text) ? text : '';
}

/** True when both adapters are known and they differ. */
export function liveCaptureAdaptersDiffer(failure: Pick<LiveCaptureImportFailure, 'captureAdapterLuid' | 'coreAdapterLuid'>): boolean {
  const capture = luid(failure.captureAdapterLuid);
  const core = luid(failure.coreAdapterLuid);
  return !!capture && !!core && capture !== core;
}

export function liveCaptureImportNotice(failure: LiveCaptureImportFailure): string {
  const noun = failure.kind === 'webcam' ? 'camera' : 'screen capture';
  if (liveCaptureAdaptersDiffer(failure)) {
    return `This ${noun} is on a different graphics chip than Ghost Arcade, so its picture cannot be shown. ${GRAPHICS_SETTINGS_TIP}`;
  }
  const reason = String(failure.reason ?? '').trim();
  // The Windows importer's failure when a texture is on another adapter. With
  // the capture adapter unknown (an older addon) that is still the likely cause.
  if (/OpenSharedHandle/i.test(reason) && !luid(failure.captureAdapterLuid)) {
    return `The ${noun}'s picture could not be opened. On a laptop with two graphics chips: ${GRAPHICS_SETTINGS_TIP}`;
  }
  const short = reason.length > 140 ? `${reason.slice(0, 137)}...` : reason;
  return `The ${noun}'s picture could not be opened by the graphics chip${short ? ` (${short})` : ''}. Updating the graphics driver may help.`;
}

/** Default: a failing source is mentioned again after five minutes at most. */
export const LIVE_CAPTURE_NOTICE_INTERVAL_MS = 5 * 60_000;
/** Sources remembered at once; the oldest is forgotten first. */
export const LIVE_CAPTURE_NOTICE_MAX_SOURCES = 32;

/**
 * Once per source until it recovers or the interval passes. Bounded: past
 * `maxSources` the source noted longest ago is dropped (and so may be
 * mentioned again sooner, which is harmless).
 */
export class LiveCaptureNoticeLimiter {
  private readonly noticedAt = new Map<string, number>();

  constructor(
    private readonly intervalMs = LIVE_CAPTURE_NOTICE_INTERVAL_MS,
    private readonly maxSources = LIVE_CAPTURE_NOTICE_MAX_SOURCES,
  ) {}

  shouldNotify(sourceId: string, nowMs: number): boolean {
    const at = this.noticedAt.get(sourceId);
    if (at !== undefined && nowMs - at < this.intervalMs) return false;
    // Re-inserted so Map order is oldest-noted first.
    this.noticedAt.delete(sourceId);
    this.noticedAt.set(sourceId, nowMs);
    while (this.noticedAt.size > this.maxSources) {
      const oldest = this.noticedAt.keys().next().value;
      if (oldest === undefined) break;
      this.noticedAt.delete(oldest);
    }
    return true;
  }

  /** The source works again: a later failure is mentioned straight away. */
  recovered(sourceId: string): boolean {
    return this.noticedAt.delete(sourceId);
  }

  has(sourceId: string): boolean {
    return this.noticedAt.has(sourceId);
  }

  get size(): number {
    return this.noticedAt.size;
  }

  clear(): void {
    this.noticedAt.clear();
  }
}
