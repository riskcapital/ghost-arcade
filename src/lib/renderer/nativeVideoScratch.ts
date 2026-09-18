import { createNativeVideoScrubber, type ScrubSource, type ScrubUpdate } from './nativeVideoScrubber';

interface ScratchTarget {
  source: ScrubSource;
  transport: string;
  scrubber: ReturnType<typeof createNativeVideoScrubber>;
}

function transportIdentity(source: ScrubSource): string {
  return JSON.stringify([source.id, source.src, source.isPlaying !== false,
    source._nativePlaybackSeekSeq ?? 0, source._nativePlaybackTimeSeconds ?? 0,
    source.trimStart ?? 0, source.trimEnd ?? 1, source.playbackRate ?? 1,
    source.playbackMode ?? 'loop', source.durationSeconds ?? source.videoElement?.duration]);
}

/** Absolute control holds the chosen picture until an explicit transport action.
 * Each target has its own coalescing queue, so controlling one deck never drops
 * a pending position on another. Store changes revoke stale queued work.
 */
export function createNativeVideoScratchController(
  readSource: (key: string) => ScrubSource | null,
  commit: (key: string, source: ScrubSource, patch: ScrubUpdate) => void,
) {
  const targets = new Map<string, ScratchTarget>();
  const cancel = (key: string) => {
    targets.get(key)?.scrubber.cancel();
    targets.delete(key);
  };
  const refresh = () => {
    for (const [key, target] of targets) {
      const source = readSource(key);
      if (!source || transportIdentity(source) !== target.transport) cancel(key);
      else target.source = source;
    }
  };
  return {
    cancel,
    refresh,
    seek(key: string, value: number) {
      refresh();
      const source = readSource(key);
      const duration = Number(source?.durationSeconds ?? source?.videoElement?.duration);
      if (!source || !Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return;
      let target = targets.get(key);
      if (!target) {
        target = { source, transport: transportIdentity(source), scrubber: createNativeVideoScrubber() };
        targets.set(key, target);
      }
      const currentTarget = target;
      const start = Math.max(0, Math.min(1, source.trimStart ?? 0));
      const end = Math.max(start, Math.min(1, source.trimEnd ?? 1));
      const time = duration * (start + Math.max(0, Math.min(1, value)) * (end - start));
      target.scrubber.seek(source, time, patch => {
        if (targets.get(key) !== currentTarget) return;
        // Set the expected transport before the synchronous store notification.
        // Our own anchor must not cancel a queued later knob position.
        currentTarget.transport = transportIdentity({ ...currentTarget.source, ...patch });
        commit(key, currentTarget.source, patch);
      }, { playing: false });
    },
  };
}
