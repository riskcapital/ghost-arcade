export interface VideoTrimPlaybackState {
  playbackMode?: 'loop' | 'once' | 'timelapse';
  trimStart?: number;
  trimEnd?: number;
  isPlaying?: boolean;
}

export interface VideoTrimBounds {
  start: number;
  end: number;
}

type VideoTrimAction = 'loop' | 'stop' | 'clamp-start' | null;

interface VideoTrimController {
  state: VideoTrimPlaybackState;
  onTimeUpdate: () => void;
  onEnded: () => void;
  onPlay: () => void;
  onPause: () => void;
  frameHandle: number | null;
}

const controllers = new WeakMap<HTMLVideoElement, VideoTrimController>();
const END_EPSILON_SECONDS = 0.04;
const START_EPSILON_SECONDS = 0.04;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function getVideoTrimBounds(
  duration: number,
  state: VideoTrimPlaybackState,
): VideoTrimBounds | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const startNormalized = clamp01(state.trimStart ?? 0);
  const endNormalized = Math.max(startNormalized, clamp01(state.trimEnd ?? 1));
  return {
    start: startNormalized * duration,
    end: endNormalized * duration,
  };
}

export function getVideoTrimAction(
  currentTime: number,
  duration: number,
  state: VideoTrimPlaybackState,
  ended = false,
): VideoTrimAction {
  const bounds = getVideoTrimBounds(duration, state);
  if (!bounds || state.playbackMode === 'timelapse') return null;

  const mode = state.playbackMode ?? 'loop';
  if (ended || currentTime >= bounds.end - END_EPSILON_SECONDS) {
    return mode === 'loop' ? 'loop' : 'stop';
  }
  if (currentTime < bounds.start - START_EPSILON_SECONDS) {
    return 'clamp-start';
  }
  return null;
}

function applyVideoTrimBoundary(video: HTMLVideoElement, state: VideoTrimPlaybackState, ended = false): void {
  const bounds = getVideoTrimBounds(video.duration, state);
  if (!bounds) return;

  const action = getVideoTrimAction(video.currentTime, video.duration, state, ended);
  if (action === 'loop' || action === 'clamp-start') {
    video.currentTime = bounds.start;
    if (action === 'loop' && state.isPlaying !== false && video.paused) {
      void video.play().catch(() => {});
    }
  } else if (action === 'stop') {
    video.currentTime = bounds.end;
    video.pause();
    state.isPlaying = false;
  }
}

function cancelVideoTrimFrame(video: HTMLVideoElement, controller: VideoTrimController): void {
  if (controller.frameHandle === null) return;
  if (typeof video.cancelVideoFrameCallback === 'function') {
    video.cancelVideoFrameCallback(controller.frameHandle);
  } else {
    cancelAnimationFrame(controller.frameHandle);
  }
  controller.frameHandle = null;
}

function scheduleVideoTrimFrame(video: HTMLVideoElement, controller: VideoTrimController): void {
  if (controller.frameHandle !== null || video.paused) return;

  const checkBoundary = () => {
    controller.frameHandle = null;
    applyVideoTrimBoundary(video, controller.state);
    if (!video.paused) scheduleVideoTrimFrame(video, controller);
  };

  if (typeof video.requestVideoFrameCallback === 'function') {
    controller.frameHandle = video.requestVideoFrameCallback(checkBoundary);
  } else {
    controller.frameHandle = requestAnimationFrame(checkBoundary);
  }
}

/**
 * Gives Ghost Arcade sole ownership of video loop boundaries.
 *
 * Native HTMLVideoElement looping always seeks to source time zero, so it
 * cannot coexist with normalized trim ranges. This controller keeps one
 * listener pair per element and refreshes its state as stores produce new
 * clip/source snapshots.
 */
export function syncTrimmedVideoPlayback(
  video: HTMLVideoElement,
  state: VideoTrimPlaybackState,
): void {
  video.loop = false;

  let controller = controllers.get(video);
  if (!controller) {
    const nextController: VideoTrimController = {
      state,
      onTimeUpdate: () => {
        const current = controllers.get(video);
        if (current) applyVideoTrimBoundary(video, current.state);
      },
      onEnded: () => {
        const current = controllers.get(video);
        if (current) applyVideoTrimBoundary(video, current.state, true);
      },
      onPlay: () => {
        const current = controllers.get(video);
        if (current) scheduleVideoTrimFrame(video, current);
      },
      onPause: () => {
        const current = controllers.get(video);
        if (current) cancelVideoTrimFrame(video, current);
      },
      frameHandle: null,
    };
    controller = nextController;
    controllers.set(video, controller);
    video.addEventListener('timeupdate', controller.onTimeUpdate);
    video.addEventListener('ended', controller.onEnded);
    video.addEventListener('play', controller.onPlay);
    video.addEventListener('pause', controller.onPause);
  } else {
    controller.state = state;
  }

  applyVideoTrimBoundary(video, state);
  scheduleVideoTrimFrame(video, controller);
}
