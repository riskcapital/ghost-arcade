import type { AutoConfig } from '../types';
import { applyEasing } from '../keyframes/easing';

/**
 * Shape the sweep while respecting the user's Auto range, including elastic peaks.
 * `at` is the playhead to read (the engine keeps its own); the saved phase otherwise.
 */
export function resolveAutoValue(auto: AutoConfig, at?: number): number {
  const raw = at !== undefined && Number.isFinite(at) ? at : auto.phase;
  const phase = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  const position = auto.timing !== 'crossfader' && auto.timing !== 'clip' && auto.mode === 'pingpong' ? (phase < .5 ? phase * 2 : 2 - phase * 2) : phase;
  const shaped = Math.max(0, Math.min(1, applyEasing(position, auto.easing ?? 'linear')));
  const lo = Number.isFinite(auto.min) ? auto.min : 0;
  const hi = Number.isFinite(auto.max) ? auto.max : 1;
  return lo + shaped * (hi - lo);
}

/**
 * Beat mode rejoins the global grid on resume; free mode retains its phase.
 * `from` is the playhead to advance (the engine keeps its own); the saved phase otherwise.
 */
export function advanceAutoPhase(auto: AutoConfig, dt: number, beat: number, crossfader?: number, clipPosition?: number, from?: number): number {
  const start = from !== undefined && Number.isFinite(from) ? from : auto.phase;
  const previous = Number.isFinite(start) ? start : 0;
  if (!auto.playing) return previous;
  if (auto.timing === 'clip') {
    return Number.isFinite(clipPosition) ? Math.max(0, Math.min(1, clipPosition!)) : previous;
  }
  if (auto.timing === 'crossfader') {
    return Number.isFinite(crossfader) ? Math.max(0, Math.min(1, crossfader!)) : previous;
  }
  if (auto.timing === 'beat') {
    const period = Number.isFinite(auto.cycleBeats) && auto.cycleBeats! > 0 ? auto.cycleBeats! : 4;
    if (!Number.isFinite(beat)) return previous;
    return ((beat % period) + period) % period / period;
  }
  if (!Number.isFinite(dt) || dt <= 0 || dt > .1) return previous;
  const speed = Number.isFinite(auto.speedHz) ? auto.speedHz : .15;
  const next = (previous + speed * dt) % 1;
  return next < 0 ? next + 1 : next;
}
