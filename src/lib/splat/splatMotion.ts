export interface SplatAnimationClockInput {
  time: number;
  speed: number;
  loop: boolean;
  pingPong: boolean;
  manualProgress: number;
}

export interface SplatAnimationClock {
  phase: number;
  progress: number;
}

const TAU = Math.PI * 2;

export function resolveSplatAnimationClock(input: SplatAnimationClockInput): SplatAnimationClock {
  const speed = Math.max(0, Number.isFinite(input.speed) ? input.speed : 0);
  const phase = Math.max(0, input.time) * speed * TAU;

  if (!input.loop) {
    return {
      phase,
      progress: Math.max(0, Math.min(1, input.manualProgress)),
    };
  }

  return {
    phase,
    progress: input.pingPong
      ? 0.5 - 0.5 * Math.cos(phase)
      : (phase / TAU) % 1,
  };
}

export function smoothSplatAudio(previous: number, target: number, smoothing: number): number {
  const safeTarget = Math.max(0, Number.isFinite(target) ? target : 0);
  const safePrevious = Math.max(0, Number.isFinite(previous) ? previous : 0);
  const retained = Math.max(0, Math.min(0.98, Number.isFinite(smoothing) ? smoothing : 0));
  return safePrevious * retained + safeTarget * (1 - retained);
}
