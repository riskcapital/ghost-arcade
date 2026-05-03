import type { KeyframeEasing, Keyframe, BoolKeyframe, KeyframeTrack } from '../types';

// ── Easing functions ─────────────────────────────────────────────────────

function easeIn(t: number): number {
  return t * t;
}

function easeOut(t: number): number {
  return t * (2 - t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function step(t: number): number {
  return t < 1 ? 0 : 1;
}

export function applyEasing(t: number, easing: KeyframeEasing): number {
  switch (easing) {
    case 'ease-in': return easeIn(t);
    case 'ease-out': return easeOut(t);
    case 'ease-in-out': return easeInOut(t);
    case 'step': return step(t);
    case 'linear':
    default: return t;
  }
}

// ── Track evaluation (binary search + interpolation) ─────────────────────

export function evaluateNumericTrack(keyframes: Keyframe[], time: number): number | undefined {
  if (keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0].value;

  // Before first keyframe
  if (time <= keyframes[0].time) return keyframes[0].value;
  // After last keyframe
  if (time >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1].value;

  // Binary search for the bracket
  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= time) lo = mid;
    else hi = mid;
  }

  const prev = keyframes[lo];
  const next = keyframes[hi];
  const span = next.time - prev.time;
  if (span <= 0) return prev.value;

  const t = (time - prev.time) / span;
  const easedT = applyEasing(t, prev.easing);
  return prev.value + (next.value - prev.value) * easedT;
}

export function evaluateBoolTrack(boolKeyframes: BoolKeyframe[], time: number): boolean | undefined {
  if (boolKeyframes.length === 0) return undefined;

  // Find the most recent keyframe at or before time
  let result = boolKeyframes[0].value;
  for (const kf of boolKeyframes) {
    if (kf.time <= time) result = kf.value;
    else break;
  }
  return result;
}

export function evaluateTrack(track: KeyframeTrack, time: number): number | boolean | undefined {
  if (track.type === 'boolean') {
    return evaluateBoolTrack(track.boolKeyframes, time);
  }
  return evaluateNumericTrack(track.keyframes, time);
}
