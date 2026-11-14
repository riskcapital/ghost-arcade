/**
 * Touches on a 3D world, per layer: what each held point does to the balls
 * this frame, and the balls it throws.
 *
 * Throw: a press throws a ball under the finger at once, and holding keeps
 * throwing one every THROW_EVERY seconds, each carrying the finger's speed,
 * so a flick flings it. Push sweeps balls along with the finger. Pour pours
 * paint where the finger is, which runs down what it lands on. Ignite sets
 * fire to what is under the finger, which burns on for IGNITE_HOLD seconds
 * after it lifts. Attract,
 * Repel and Vortex pull, push away and swirl, as they do the 2D effects.
 *
 * Everything here is in output space (0..1, y down); the graph turns points
 * into rays and hits on the blocks (scene3dWorld.ts). Every throw carries a
 * number that only grows, and stays listed for THROW_KEEP seconds: the GPU
 * sees the same list for several frames and spawns each number once.
 *
 * Live state only: never saved, never an undo step.
 */
import type { Interaction, Point, ZoneWorldAction } from '../mobile/studio/interactive';

export const WORLD_TOOLS = ['push', 'attract', 'repel', 'vortex', 'pour', 'ignite'] as const;
export type WorldForceTool = (typeof WORLD_TOOLS)[number];
/** The most points and listed throws the GPU reads. */
export const MAX_WORLD_POINTERS = 8;
export const MAX_WORLD_THROWS = 8;
export const THROW_EVERY = 0.12;
export const THROW_KEEP = 0.4;
/** How long a spot keeps burning after the finger lifts, in seconds. */
export const IGNITE_HOLD = 3;
/** The most spots burning at once. */
export const MAX_FIRES = 4;
/** How long a zone pours paint, in seconds, and how many balls it drops. */
export const ZONE_POUR = 1.5;
export const ZONE_BALLS = 8;

export type WorldPointer = { point: Point; velocity: Point; tool: WorldForceTool; strength: number };
export type WorldThrow = { point: Point; velocity: Point; number: number; at: number };
export type WorldInputState = { pointers: WorldPointer[]; throws: WorldThrow[] };

/** A held point. `press` tells presses of one finger apart: a mouse keeps its id. */
type Held = { point: Point; at: number; velocity: Point; nextThrow: number; press: number };

export class WorldInput {
  private held = new Map<string, Held>();
  private throws: WorldThrow[] = [];
  private count = 0;
  private presses = 0;
  /** Fires lit by Ignite, one per press: they burn on after the finger lifts. */
  private fires = new Map<string, { point: Point; until: number }>();
  /** Paint a zone is pouring. */
  private pours: { point: Point; until: number }[] = [];

  /** One frame: the points touching the scene now, at `now` seconds. */
  update(points: Interaction[], now: number): WorldInputState {
    const seen = new Set<string>();
    const pointers: WorldPointer[] = [];
    for (const p of points) {
      if (!Number.isFinite(p?.point?.x) || !Number.isFinite(p?.point?.y)) continue;
      const id = String(p.id);
      seen.add(id);
      const point = { x: Math.max(0, Math.min(1, p.point.x)), y: Math.max(0, Math.min(1, p.point.y)) };
      let h = this.held.get(id);
      if (!h) {
        h = { point, at: now, velocity: { x: 0, y: 0 }, nextThrow: now, press: ++this.presses };
        this.held.set(id, h);
      } else {
        const dt = now - h.at;
        if (dt > 1e-4) {
          // Smoothed over about 60 ms, so one jittery frame does not fling.
          const k = Math.min(1, dt / 0.06);
          h.velocity = {
            x: h.velocity.x + ((point.x - h.point.x) / dt - h.velocity.x) * k,
            y: h.velocity.y + ((point.y - h.point.y) / dt - h.velocity.y) * k,
          };
        }
        h.point = point;
        h.at = now;
      }
      if (p.mode === 'throw') {
        // At most one a frame: a stalled frame does not release a backlog.
        if (h.nextThrow <= now) {
          this.throws.push({ point, velocity: { ...h.velocity }, number: ++this.count, at: now });
          h.nextThrow = h.nextThrow + THROW_EVERY > now ? h.nextThrow + THROW_EVERY : now + THROW_EVERY;
        }
        continue;
      }
      if (p.mode === 'ignite') {
        // Each press lights its own fire; the oldest goes out past MAX_FIRES.
        const key = `${id}#${h.press}`;
        if (!this.fires.has(key) && this.fires.size >= MAX_FIRES) this.fires.delete(this.fires.keys().next().value!);
        this.fires.set(key, { point, until: now + IGNITE_HOLD });
        continue;
      }
      const tool: WorldForceTool = p.mode === 'push' || p.mode === 'repel' || p.mode === 'vortex' || p.mode === 'pour' ? p.mode : 'attract';
      if (pointers.length < MAX_WORLD_POINTERS) {
        pointers.push({ point, velocity: { ...h.velocity }, tool, strength: Math.max(0, Math.min(1, Number(p.strength) || 0)) });
      }
    }
    for (const id of [...this.held.keys()]) if (!seen.has(id)) this.held.delete(id);
    this.throws = this.throws.filter((t) => now - t.at <= THROW_KEEP);
    this.pours = this.pours.filter((p) => p.until >= now);
    for (const pour of this.pours) {
      if (pointers.length < MAX_WORLD_POINTERS) pointers.push({ point: pour.point, velocity: { x: 0, y: 0 }, tool: 'pour', strength: 1 });
    }
    for (const [id, fire] of [...this.fires]) {
      if (fire.until < now) { this.fires.delete(id); continue; }
      // Strength: dies down over the last second.
      if (pointers.length < MAX_WORLD_POINTERS) pointers.push({ point: fire.point, velocity: { x: 0, y: 0 }, tool: 'ignite', strength: Math.min(1, fire.until - now) });
    }
    // The GPU reads the newest eight; each spawns the first frame it is listed.
    return { pointers, throws: this.throws.slice(-MAX_WORLD_THROWS) };
  }

  /** What a zone does to the world, at the zone (a point of the output). */
  trigger(what: ZoneWorldAction, point: Point, now: number): void {
    const at = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
    if (what === 'ignite') {
      if (this.fires.size >= MAX_FIRES) this.fires.delete(this.fires.keys().next().value!);
      this.fires.set(`zone#${++this.presses}`, { point: at, until: now + IGNITE_HOLD });
    } else if (what === 'pour') {
      this.pours = [...this.pours.slice(-3), { point: at, until: now + ZONE_POUR }];
    } else {
      // A handful, tossed up and out, so they spill over what is below.
      for (let i = 0; i < ZONE_BALLS; i++) {
        const a = ((this.count * 0.618034 + i / ZONE_BALLS) % 1) * Math.PI;
        this.throws.push({ point: at, velocity: { x: Math.cos(a) * 0.35, y: -0.25 - 0.2 * Math.sin(a) }, number: ++this.count, at: now });
      }
    }
  }

  reset(): void {
    this.held.clear();
    this.throws = [];
    this.fires.clear();
    this.pours = [];
  }
}

/** The state as the graph param, if it is sane. */
export function worldInputParam(raw: unknown): WorldInputState {
  const r = raw as Partial<WorldInputState> | null;
  const ok = (p: unknown): p is Point => Number.isFinite((p as Point)?.x) && Number.isFinite((p as Point)?.y);
  return {
    pointers: (Array.isArray(r?.pointers) ? r!.pointers : [])
      .filter((p) => ok(p?.point) && ok(p?.velocity) && (WORLD_TOOLS as readonly string[]).includes(p.tool))
      .slice(0, MAX_WORLD_POINTERS),
    throws: (Array.isArray(r?.throws) ? r!.throws : [])
      .filter((t) => ok(t?.point) && ok(t?.velocity) && Number.isSafeInteger(t.number) && t.number > 0)
      .slice(-MAX_WORLD_THROWS),
  };
}
