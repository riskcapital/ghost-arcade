import { getNativeRendererStatus, submitNativeRendererCommands, type RendererCommand } from '../api/native-renderer';
import { showToast } from '../stores/errorToast';

export interface ScrubSource {
  id: string;
  src: string;
  durationSeconds?: number;
  playbackRate?: number;
  playbackMode?: string;
  trimStart?: number;
  trimEnd?: number;
  isPlaying?: boolean;
  audioPlayback?: boolean;
  videoElement?: HTMLVideoElement;
  _nativePlaybackTimeSeconds?: number;
  _nativePlaybackSeekSeq?: number;
}
export interface ScrubUpdate {
  isPlaying: boolean;
  _nativePlaybackTimeSeconds: number;
  _nativePlaybackUpdatedAtMs: number;
  _nativePlaybackSeekSeq: number;
}
type Commit = (update: ScrubUpdate) => void;
type SeekOptions = { playing?: boolean; flush?: boolean };
const generations = new Map<string, number>();

export function clampVideoScrubTime(source: ScrubSource, time: number): number {
  const duration = Number(source.durationSeconds ?? source.videoElement?.duration);
  const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (!(duration > 0 && Number.isFinite(duration))) return safeTime;
  const start = duration * Math.max(0, Math.min(1, source.trimStart ?? 0));
  const end = duration * Math.max(source.trimStart ?? 0, Math.min(1, source.trimEnd ?? 1));
  // The out-point is exclusive. Seeking exactly to it has no picture and can
  // wrap a loop to its beginning; stay inside the final containing frame.
  return Math.max(start, Math.min(Math.max(start, end - 0.00001), safeTime));
}

function nextGeneration(source: ScrubSource, nativeGeneration = 0): number {
  const key = `${source.id}:${source.src}`;
  const next = Math.max(generations.get(key) ?? 0,
    Number(source._nativePlaybackSeekSeq) || 0, nativeGeneration) + 1;
  generations.delete(key);
  generations.set(key, next);
  if (generations.size > 256) generations.delete(generations.keys().next().value!);
  return next;
}

function command(source: ScrubSource, time: number, playing: boolean, generation: number,
  step?: -1 | 1): RendererCommand {
  const duration = Number(source.durationSeconds ?? source.videoElement?.duration);
  return {
    type: 'set_media_source_playback', source_id: source.id, uri: source.src,
    source_type: 'video', time_seconds: time, clock_time_seconds: 0,
    playback_rate: Number(source.playbackRate) || 1, paused: !playing,
    loop_enabled: (source.playbackMode ?? 'loop') !== 'once',
    trim_start: source.trimStart ?? 0, trim_end: source.trimEnd ?? 1,
    duration_seconds: duration > 0 && Number.isFinite(duration) ? duration : undefined,
    seek_generation: generation, frame_step: step,
    seq: Math.max(1, Math.round(Date.now() * 1000)),
  };
}

function commitTime(source: ScrubSource, time: number, playing: boolean, generation: number, commit: Commit) {
  commit({ isPlaying: playing, _nativePlaybackTimeSeconds: time,
    _nativePlaybackUpdatedAtMs: performance.now(), _nativePlaybackSeekSeq: generation });
  // Silent clips use the native decoder exclusively. Audible clips still need
  // their audio element to follow the native transport.
  const video = source.videoElement;
  if (video && !playing) video.pause();
  if (video && source.audioPlayback === true) {
    try { video.currentTime = time; } catch { /* metadata may still be loading */ }
    if (playing) void video.play().catch(() => {});
  }
}

export function createNativeVideoScrubber() {
  let raf: number | null = null;
  let pending: { source: ScrubSource; time: number; commit: Commit; playing: boolean } | null = null;
  let revision = 0;
  let steppingRevision: number | null = null;
  let activeSeek: { sourceKey: string; generation: number } | null = null;
  let lastErrorAt = -Infinity;
  const report = (error: unknown) => {
    if (performance.now() - lastErrorAt < 3000) return;
    lastErrorAt = performance.now();
    showToast(error instanceof Error ? error.message : 'The video seek failed.');
  };
  const clearPending = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    pending = null;
  };
  const submitLatest = () => {
    raf = null;
    if (activeSeek) return;
    const request = pending;
    pending = null;
    if (!request) return;
    const { source, time, commit, playing } = request;
    const generation = nextGeneration(source);
    const flight = { sourceKey: `${source.id}:${source.src}`, generation };
    activeSeek = flight;
    // Send transport first. Store sync may echo the same generation, but must
    // never launch a separate preview decode or replace this seek afterward.
    const submitted = submitNativeRendererCommands([command(source, time, playing, generation)]);
    commitTime(source, time, playing, generation, commit);
    // Repeatedly cancelling an inter-frame decode can prevent ANY picture
    // from arriving while a mouse/fader moves. Allow one target to reach the
    // renderer, then take the latest pending target (never a backlog). A final
    // mouseup may supersede that target once, and cancellation/source changes
    // invalidate the old flight without blocking the new source.
    void (async () => {
      try {
        await submitted;
        const deadline = performance.now() + 5000;
        while (activeSeek === flight) {
          const status = await getNativeRendererStatus();
          if (activeSeek !== flight) return;
          const session = status.native_video_sessions.find(item => item.source_id === source.id);
          if ((session?.seek_generation ?? 0) > generation) {
            // A newer transport action (for example Play or Restart) won.
            clearPending();
            return;
          }
          if (session?.seek_generation === generation && session.frames_presented > 0) return;
          if (session?.backend === 'failed') throw new Error(session.fallback_reason || 'Native video scrubbing failed.');
          if (performance.now() >= deadline) throw new Error('The native player did not finish the video seek.');
          await new Promise(resolve => setTimeout(resolve, 16));
        }
      } catch (error) {
        if (activeSeek === flight) report(error);
      } finally {
        if (activeSeek === flight) {
          activeSeek = null;
          if (pending) {
            if (raf !== null) cancelAnimationFrame(raf);
            submitLatest();
          }
        }
      }
    })();
  };
  return {
    seek(source: ScrubSource, time: number, commit: Commit, options: SeekOptions = {}) {
      revision += 1;
      pending = { source, time: clampVideoScrubTime(source, time), commit, playing: options.playing ?? false };
      if (activeSeek?.sourceKey !== `${source.id}:${source.src}`) activeSeek = null;
      if (options.flush) {
        activeSeek = null;
        if (raf !== null) cancelAnimationFrame(raf);
        submitLatest();
      } else if (raf === null) raf = requestAnimationFrame(submitLatest);
    },
    async step(source: ScrubSource, direction: -1 | 1, commit: Commit): Promise<void> {
      if (steppingRevision === revision) return;
      clearPending();
      activeSeek = null;
      const requestRevision = ++revision;
      steppingRevision = requestRevision;
      try {
        let status = await getNativeRendererStatus();
        if (requestRevision !== revision) return;
        let session = status.native_video_sessions.find(item => item.source_id === source.id);
        const readyDeadline = performance.now() + 5000;
        while (session?.source_frame_step_exact && session.frames_presented === 0 && performance.now() < readyDeadline) {
          await new Promise(resolve => setTimeout(resolve, 16));
          status = await getNativeRendererStatus();
          if (requestRevision !== revision) return;
          session = status.native_video_sessions.find(item => item.source_id === source.id);
        }
        if (!session?.source_frame_step_exact || session.source_time_seconds == null || session.frames_presented === 0) {
          throw new Error('Frame stepping needs a prepared native video frame. Play or seek the clip first.');
        }
        const generation = nextGeneration(source, session.seek_generation);
        const time = session.source_time_seconds;
        await submitNativeRendererCommands([command(source, time, false, generation, direction)]);
        if (requestRevision !== revision) return;
        commitTime(source, time, false, generation, commit);
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const next = await getNativeRendererStatus();
          if (requestRevision !== revision) return;
          const frame = next.native_video_sessions.find(item => item.source_id === source.id);
          if ((frame?.seek_generation ?? 0) > generation) return; // A newer transport action owns the source.
          if (frame?.seek_generation === generation && frame.frames_presented > 0 && frame.source_time_seconds != null) {
            commitTime(source, frame.source_time_seconds, false, generation, commit);
            return;
          }
          if (frame?.backend === 'failed') throw new Error(frame.fallback_reason || 'Native frame stepping failed.');
          await new Promise(resolve => setTimeout(resolve, 16));
        }
        throw new Error('The native player did not finish the frame step.');
      } finally {
        if (steppingRevision === requestRevision) steppingRevision = null;
      }
    },
    cancel() { revision += 1; activeSeek = null; clearPending(); },
  };
}
