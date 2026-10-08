import { nativeVideoTransportSnapshot, type NativeVideoTransportTarget } from '../media/nativeTransport';
import type { AutoConfig } from '../types';
export { resolveAutoValue, advanceAutoPhase } from './autoCurves';

/** Source position within the trimmed video range, using the shared transport anchor. */
export function autoClipPosition(source: (NativeVideoTransportTarget & { type: string }) | null | undefined, nowMs: number): number | undefined {
  if (!source || source.type !== 'video') return undefined;
  const duration = Number(source.durationSeconds ?? source.videoElement?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  if (!Number.isFinite(source._nativePlaybackTimeSeconds) && !Number.isFinite(source.videoElement?.currentTime)) return undefined;
  const lo = duration * Math.max(0, Math.min(1, source.trimStart ?? 0));
  const hi = duration * Math.max(0, Math.min(1, source.trimEnd ?? 1));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return undefined;
  const position = (nativeVideoTransportSnapshot(source, nowMs).timeSeconds - lo) / (hi - lo);
  return Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : undefined;
}
