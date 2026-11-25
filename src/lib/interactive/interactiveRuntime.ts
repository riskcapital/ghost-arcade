/**
 * The interactive layer while the show runs, with or without its editor open:
 * which points touch the scene (pointer, tracked hands, tracked body), and
 * which trigger zones they fire.
 *
 * Plain data in, plain data out. The renderer sync feeds it once per frame
 * and sends the points to the core and the fired actions to the show.
 */
import {
  inside,
  type InputForce,
  type InteractiveInput,
  type InteractiveScene,
  type Interaction,
  type Point,
  type TrackingSource,
  type ZoneAction,
} from '../mobile/studio/interactive';
import type { SignalFrame } from '../mediapipe/signals';

/** The core's touch buffer holds this many points. */
export const MAX_INPUT_POINTS = 8;

/** Hand landmarks: palm (the middle of the knuckles and wrist) and index fingertip. */
const PALM = [0, 5, 9, 13, 17];
const INDEX_TIP = 8;
/** Body landmarks: nose, wrists, feet. */
const BODY_POINTS: [string, number][] = [
  ['head', 0],
  ['wrist-l', 15],
  ['wrist-r', 16],
  ['foot-l', 31],
  ['foot-r', 32],
];
const VISIBLE = 0.5;

/** Tracked points in scene space (0..1, y down), mirrored like the camera view. */
export function trackedPoints(
  frame: SignalFrame | null | undefined,
  tracking: TrackingSource,
  mirrored: boolean,
): { id: string; point: Point }[] {
  if (!frame || tracking === 'off') return [];
  const place = (p: { x: number; y: number }): Point => ({
    x: Math.max(0, Math.min(1, mirrored ? 1 - p.x : p.x)),
    y: Math.max(0, Math.min(1, p.y)),
  });
  const out: { id: string; point: Point }[] = [];
  if (tracking === 'hands' || tracking === 'both') {
    frame.hands.slice(0, 2).forEach((hand, i) => {
      const side = hand.handedness || String(i);
      const marks = hand.landmarks;
      if (marks.length < 21) return;
      const palm = PALM.reduce((acc, k) => ({ x: acc.x + marks[k].x / PALM.length, y: acc.y + marks[k].y / PALM.length }), { x: 0, y: 0 });
      out.push({ id: `hand-${side}-palm`, point: place(palm) });
      out.push({ id: `hand-${side}-tip`, point: place(marks[INDEX_TIP]) });
    });
  }
  if ((tracking === 'body' || tracking === 'both') && frame.pose && frame.pose.length >= 33) {
    for (const [name, k] of BODY_POINTS) {
      const mark = frame.pose[k];
      if (mark && (mark.visibility ?? 1) >= VISIBLE) out.push({ id: `body-${name}`, point: place(mark) });
    }
  }
  return out;
}

/**
 * Smooths tracked points so they do not jitter, while a fast move still
 * arrives at once. Points not seen this frame are dropped.
 */
export class PointSmoother {
  private last = new Map<string, Point>();
  update(points: { id: string; point: Point }[], smoothing = 0.35): { id: string; point: Point }[] {
    const next = new Map<string, Point>();
    const out = points.map(({ id, point }) => {
      const prev = this.last.get(id);
      let p = point;
      if (prev) {
        const motion = Math.hypot(point.x - prev.x, point.y - prev.y);
        const alpha = Math.min(1, 1 - smoothing + motion * 25);
        p = { x: prev.x + (point.x - prev.x) * alpha, y: prev.y + (point.y - prev.y) * alpha };
      }
      next.set(id, p);
      return { id, point: p };
    });
    this.last = next;
    return out;
  }
  reset() {
    this.last.clear();
  }
}

/** Pointer touches first (they are deliberate), then tracked points, at most eight. */
export function combineInputs(
  pointer: Interaction[],
  tracked: { id: string; point: Point }[],
  input: Pick<InteractiveInput, 'force' | 'strength'>,
): Interaction[] {
  const force: InputForce = input.force;
  return [
    ...pointer,
    ...tracked.map(({ id, point }) => ({ id, point, strength: input.strength, mode: force })),
  ].slice(0, MAX_INPUT_POINTS);
}

/**
 * The core's touch buffer: x, y, strength, mode per point. Unused entries
 * sit far outside the scene with no strength, so a shader that reads all
 * eight sees nothing there and the count can stay fixed.
 */
export function touchBufferData(points: Interaction[]): Float32Array {
  const data = new Float32Array(MAX_INPUT_POINTS * 4);
  for (let i = 0; i < MAX_INPUT_POINTS; i++) {
    const p = points[i];
    if (!p) {
      data.set([-10, -10, 0, 0], i * 4);
      continue;
    }
    data.set(
      [
        Math.max(0, Math.min(1, p.point.x)),
        Math.max(0, Math.min(1, p.point.y)),
        Math.max(0, Math.min(1, p.strength)),
        p.mode === 'repel' ? 1 : p.mode === 'vortex' ? 2 : 0,
      ],
      i * 4,
    );
  }
  return data;
}

export type FiredZone = { surfaceId: string; actions: ZoneAction[] };

/**
 * Trigger zones for one layer. A zone fires when a point comes into it while
 * it is armed. A point that stays in the zone fires it once (a held touch, a
 * hand resting there); another point coming in fires it again once its
 * re-arm time has passed, so two hands or two people do not lock each other
 * out. Balls share the re-arm time (`arm`), so a zone set off by either
 * touches or balls does not fire twice for one moment.
 */
export class ZoneTriggers {
  /** Zone and point pairs inside last frame. */
  private occupied = new Set<string>();
  private lastFired = new Map<string, number>();

  update(scene: InteractiveScene, points: Interaction[], now: number): FiredZone[] {
    const fired: FiredZone[] = [];
    const occupied = new Set<string>();
    for (const surface of scene.surfaces) {
      if (surface.behavior !== 'trigger' || !surface.trigger || surface.trigger.when === 'ball') continue;
      let entered = false;
      for (const p of points) {
        if (!inside(p.point, surface.points)) continue;
        const key = `${surface.id}\u0000${p.id}`;
        occupied.add(key);
        if (!this.occupied.has(key)) entered = true;
      }
      if (!entered || !this.arm(surface.id, surface.trigger.rearm, now)) continue;
      if (surface.trigger.actions.length) fired.push({ surfaceId: surface.id, actions: surface.trigger.actions });
    }
    this.occupied = occupied;
    // Forget zones that are gone from the scene.
    for (const id of this.lastFired.keys()) if (!scene.surfaces.some((s) => s.id === id)) this.lastFired.delete(id);
    return fired;
  }

  /** Fire `surfaceId` now if its re-arm time has passed since it last fired (touch or ball). */
  arm(surfaceId: string, rearm: number, now: number): boolean {
    const last = this.lastFired.get(surfaceId);
    if (last !== undefined && now >= last && now - last < rearm) return false;
    this.lastFired.set(surfaceId, now);
    return true;
  }

  reset() {
    this.occupied.clear();
    this.lastFired.clear();
  }
}
