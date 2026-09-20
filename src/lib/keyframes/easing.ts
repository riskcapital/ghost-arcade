import type { KeyframeEasing, Keyframe, BoolKeyframe, KeyframeTrack } from '../types';

/** Shared labels keep the inspector and context menu in sync. */
export const KEYFRAME_EASINGS: { value: KeyframeEasing; label: string; hint: string }[] = [
  { value: 'linear', label: 'Linear', hint: 'Constant speed' },
  { value: 'ease-in', label: 'Ease In', hint: 'Accelerate into the next value' },
  { value: 'ease-out', label: 'Ease Out', hint: 'Slow down into the next value' },
  { value: 'ease-in-out', label: 'Ease In-Out', hint: 'Accelerate then slow down' },
  { value: 'sine', label: 'Sine', hint: 'Smooth sinusoidal start and finish' },
  { value: 'exponential', label: 'Exponential Out', hint: 'Fast attack with a long settling tail' },
  { value: 'bounce', label: 'Bounce Out', hint: 'Bounce into the next value without overshoot' },
  { value: 'elastic', label: 'Elastic Out', hint: 'Spring past the next value, then settle; may overshoot' },
  { value: 'step', label: 'Hold', hint: 'Hold until the next keyframe' },
];

function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) { t -= 1.5 / d; return n * t * t + .75; }
  if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + .9375; }
  t -= 2.625 / d;
  return n * t * t + .984375;
}

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
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (easing) {
    case 'sine': return (1 - Math.cos(Math.PI * t)) / 2;
    case 'exponential': return 1 - Math.pow(2, -10 * t);
    case 'bounce': return bounceOut(t);
    case 'elastic': return 1 + Math.pow(2, -10 * t) * Math.sin((10 * t - .75) * (2 * Math.PI / 3));
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
