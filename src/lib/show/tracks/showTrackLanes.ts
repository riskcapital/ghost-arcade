/**
 * Keyframe lanes on a layer track.
 *
 * A lane is a `KeyframeTrack` (the type the per-preset Keyframes tray uses)
 * whose times are show seconds. Lanes are evaluated with the same
 * `evaluateTrack` and easings, and their values reach the layer through the
 * same override keys (`applyParamOverrides`), applied after the preset's own
 * keyframes so the show wins on a shared key. Clip fades and clip opacity
 * multiply on top of an opacity lane.
 *
 * Pure: every edit returns a new lane list.
 */
import type { KeyframeEasing, KeyframeTrack } from '../../types';
import { evaluateTrack } from '../../keyframes/easing';

/** Two keys closer than this are the same key. */
export const LANE_KEY_EPSILON = 1e-4;

export interface LaneParam {
  key: string;
  label: string;
  type: 'number' | 'boolean';
}

/** Values of every lane with keys at show time `t`, or null when none has any. */
export function evaluateLanes(lanes: readonly KeyframeTrack[], t: number): Record<string, number | boolean> | null {
  let out: Record<string, number | boolean> | null = null;
  for (const lane of lanes) {
    if (!lane.keyframes.length && !lane.boolKeyframes.length) continue;
    const value = evaluateTrack(lane, t);
    if (value === undefined) continue;
    (out ??= {})[lane.key] = value;
  }
  return out;
}

export function emptyLane(param: LaneParam): KeyframeTrack {
  return { key: param.key, label: param.label, type: param.type, keyframes: [], boolKeyframes: [] };
}

/** Add a lane for `param` (no-op when the track already has one). */
export function addLane(lanes: readonly KeyframeTrack[], param: LaneParam): KeyframeTrack[] {
  if (lanes.some((l) => l.key === param.key)) return lanes as KeyframeTrack[];
  return [...lanes, emptyLane(param)];
}

export function removeLane(lanes: readonly KeyframeTrack[], key: string): KeyframeTrack[] {
  return lanes.filter((l) => l.key !== key);
}

function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) < LANE_KEY_EPSILON;
}

function mapLane(lanes: readonly KeyframeTrack[], key: string, fn: (lane: KeyframeTrack) => KeyframeTrack): KeyframeTrack[] {
  return lanes.map((l) => (l.key === key ? fn(l) : l));
}

/** Set (or add) the key at `time` on lane `key`. */
export function setLaneKey(
  lanes: readonly KeyframeTrack[],
  key: string,
  time: number,
  value: number | boolean,
  easing?: KeyframeEasing,
): KeyframeTrack[] {
  const t = Math.max(0, time);
  return mapLane(lanes, key, (lane) => {
    if (lane.type === 'boolean') {
      const rest = lane.boolKeyframes.filter((k) => !sameTime(k.time, t));
      return { ...lane, boolKeyframes: [...rest, { time: t, value: !!value }].sort((a, b) => a.time - b.time) };
    }
    const existing = lane.keyframes.find((k) => sameTime(k.time, t));
    const rest = lane.keyframes.filter((k) => !sameTime(k.time, t));
    const next = { time: t, value: Number(value) || 0, easing: easing ?? existing?.easing ?? 'linear' };
    return { ...lane, keyframes: [...rest, next].sort((a, b) => a.time - b.time) };
  });
}

/**
 * Move the key at `from` to `to` (and, for a number lane, to `value`). A key
 * already at `to` is replaced.
 */
export function moveLaneKey(
  lanes: readonly KeyframeTrack[],
  key: string,
  from: number,
  to: number,
  value?: number | boolean,
): KeyframeTrack[] {
  const t = Math.max(0, to);
  return mapLane(lanes, key, (lane) => {
    if (lane.type === 'boolean') {
      const moving = lane.boolKeyframes.find((k) => sameTime(k.time, from));
      if (!moving) return lane;
      const rest = lane.boolKeyframes.filter((k) => k !== moving && !sameTime(k.time, t));
      return { ...lane, boolKeyframes: [...rest, { time: t, value: value === undefined ? moving.value : !!value }].sort((a, b) => a.time - b.time) };
    }
    const moving = lane.keyframes.find((k) => sameTime(k.time, from));
    if (!moving) return lane;
    const rest = lane.keyframes.filter((k) => k !== moving && !sameTime(k.time, t));
    const next = { ...moving, time: t, value: value === undefined ? moving.value : Number(value) };
    return { ...lane, keyframes: [...rest, next].sort((a, b) => a.time - b.time) };
  });
}

/** Move several keys on one lane by `delta` seconds together. */
export function shiftKeysOnLane(lanes: readonly KeyframeTrack[], key: string, times: readonly number[], delta: number): KeyframeTrack[] {
  const picked = (time: number) => times.some((x) => sameTime(x, time));
  return mapLane(lanes, key, (lane) => {
    if (lane.type === 'boolean') {
      const moved = lane.boolKeyframes.filter((k) => picked(k.time)).map((k) => ({ ...k, time: Math.max(0, k.time + delta) }));
      const rest = lane.boolKeyframes.filter((k) => !picked(k.time) && !moved.some((m) => sameTime(m.time, k.time)));
      return { ...lane, boolKeyframes: [...rest, ...moved].sort((a, b) => a.time - b.time) };
    }
    const moved = lane.keyframes.filter((k) => picked(k.time)).map((k) => ({ ...k, time: Math.max(0, k.time + delta) }));
    const rest = lane.keyframes.filter((k) => !picked(k.time) && !moved.some((m) => sameTime(m.time, k.time)));
    return { ...lane, keyframes: [...rest, ...moved].sort((a, b) => a.time - b.time) };
  });
}

export function removeLaneKeys(lanes: readonly KeyframeTrack[], key: string, times: readonly number[]): KeyframeTrack[] {
  const picked = (time: number) => times.some((x) => sameTime(x, time));
  return mapLane(lanes, key, (lane) => ({
    ...lane,
    keyframes: lane.keyframes.filter((k) => !picked(k.time)),
    boolKeyframes: lane.boolKeyframes.filter((k) => !picked(k.time)),
  }));
}

export function setLaneKeyEasing(lanes: readonly KeyframeTrack[], key: string, times: readonly number[], easing: KeyframeEasing): KeyframeTrack[] {
  const picked = (time: number) => times.some((x) => sameTime(x, time));
  return mapLane(lanes, key, (lane) => ({
    ...lane,
    keyframes: lane.keyframes.map((k) => (picked(k.time) ? { ...k, easing } : k)),
  }));
}

/**
 * Take the keys in [from, to) out of `source` lanes, shifted by `delta`,
 * and put them on `target` lanes (creating a lane with the same key where
 * the target has none). The keys a clip carries when it moves to another
 * track.
 */
export function carryKeysAcross(
  source: readonly KeyframeTrack[],
  target: readonly KeyframeTrack[],
  from: number,
  to: number,
  delta: number,
): { source: KeyframeTrack[]; target: KeyframeTrack[] } {
  const inside = (time: number) => time >= from - 1e-9 && time < to - 1e-9;
  let nextTarget = [...target];
  const nextSource = source.map((lane) => {
    const moving = lane.keyframes.filter((k) => inside(k.time));
    const movingBool = lane.boolKeyframes.filter((k) => inside(k.time));
    if (!moving.length && !movingBool.length) return lane;
    let dest = nextTarget.find((l) => l.key === lane.key);
    if (!dest) {
      dest = emptyLane(lane);
      nextTarget = [...nextTarget, dest];
    }
    const shifted = moving.map((k) => ({ ...k, time: Math.max(0, k.time + delta) }));
    const shiftedBool = movingBool.map((k) => ({ ...k, time: Math.max(0, k.time + delta) }));
    const merged: KeyframeTrack = {
      ...dest,
      keyframes: [...dest.keyframes.filter((k) => !shifted.some((s) => sameTime(s.time, k.time))), ...shifted].sort((a, b) => a.time - b.time),
      boolKeyframes: [...dest.boolKeyframes.filter((k) => !shiftedBool.some((s) => sameTime(s.time, k.time))), ...shiftedBool].sort((a, b) => a.time - b.time),
    };
    nextTarget = nextTarget.map((l) => (l.key === lane.key ? merged : l));
    return {
      ...lane,
      keyframes: lane.keyframes.filter((k) => !inside(k.time)),
      boolKeyframes: lane.boolKeyframes.filter((k) => !inside(k.time)),
    };
  });
  return { source: nextSource, target: nextTarget };
}
