/**
 * "Where" lines: choreography across the stage.
 *
 * A block (a look block, a content block on a piece's row, an LED block)
 * can carry a `WhereSpec`. The pieces (and LED fixtures) taking part are put
 * in a spatial order from where they sit on the stage (spatialOrder.ts); the
 * where line is two values over time along that order:
 *
 *   position  0..1 along the order (0 = the first piece, 1 = the last)
 *   spread    0..1 how wide the lit window is (0 = one piece, 1 = the whole
 *             order when centred)
 *
 * with a soft edge so neighbours fade into each other (whereWindow.ts).
 * Pieces inside the window wear the block; outside it they don't.
 *
 * Position comes from a motion picked instead of drawn (sweep, ping-pong,
 * centre burst, a random piece every beat or bar, a step on every kick) or
 * from the block's control lines (`where:position`, `where:spread`,
 * `where:soft`), so a where line can be drawn, follow the music or be
 * recorded from a MIDI knob like any other line. Everything is a pure
 * function of show time: scrub = play = export.
 *
 * Saved as plain JSON on the block (`where`); see normalizeWhere.
 */

export const WHERE_ORDERS = ['left-right', 'right-left', 'top-bottom', 'bottom-top', 'centre-out', 'around', 'hand'] as const;
export type WhereOrderKind = (typeof WHERE_ORDERS)[number];

export const WHERE_MOTIONS = ['drawn', 'sweep', 'pingpong', 'burst', 'random', 'kick', 'reveal'] as const;
export type WhereMotionKind = (typeof WHERE_MOTIONS)[number];

export type WhereMotion =
  /** Position (and spread) come from the block's lines, else `position`. */
  | { kind: 'drawn' }
  /** One pass along the order every `bars` bars. */
  | { kind: 'sweep'; bars: number; reverse?: boolean }
  /** There and back: one pass every `bars` bars. */
  | { kind: 'pingpong'; bars: number }
  /** The window grows from the middle of the order to all of it, every `bars` bars. */
  | { kind: 'burst'; bars: number }
  /** A random piece every beat or bar (seeded: the same every time). */
  | { kind: 'random'; every: 'beat' | 'bar'; seed: number }
  /** One step along the order on every kick of the song (every beat without one). */
  | { kind: 'kick' }
  /** Pieces light one after another along the order over `bars` bars from
   *  the block's start, then all stay lit; `reverse`: all lit at the start,
   *  then they go dark one after another (the last one stays). */
  | { kind: 'reveal'; bars: number; reverse?: boolean };

/** Which spots take part: the projected pieces, the LED fixtures, or both. */
export type WhereMembers = 'pieces' | 'leds' | 'both';

export interface WhereOrderSpec {
  order: WhereOrderKind;
  /** 'around': where the turn starts, degrees clockwise from 12 o'clock. */
  angle?: number;
  /** 'hand': spot ids in order (pieces by layer id, LEDs by `led:` id).
   *  Spots not listed follow, left to right. */
  hand?: string[];
  /** A group of pieces is one spot (its members light together). */
  groups?: boolean;
  /** The order as given: each entry is a slot of piece ids that light
   *  together (a set). Only the listed pieces take part. Named orders made
   *  from the mapping (Auto show's rows, columns, alternating sets) use it. */
  slots?: string[][];
}

export interface WhereSpec extends WhereOrderSpec {
  /** A per-show named order (`whereOrders` in the Timeline) used instead
   *  of `order` / `angle` / `hand`. */
  namedOrder?: string;
  members: WhereMembers;
  motion: WhereMotion;
  /** Resting values (a line on the block overrides them). */
  position: number;
  spread: number;
  soft: number;
  /** The order is a ring: the last piece neighbours the first. */
  wrap?: boolean;
  /** Content blocks: the pieces of its order are the block's while it
   *  plays. Their own content goes dark; the lit ones wear the block. */
  dark?: boolean;
  /** Content blocks: one picture across the pieces (each shows its part of
   *  it, where it sits on the stage) instead of the whole picture on each. */
  span?: boolean;
}

/** A named spatial order kept with the Timeline ("Facade sweep"). */
export interface WhereNamedOrder extends WhereOrderSpec {
  id: string;
  name: string;
}

/** Line keys of a block's where line (on the block's own target). */
export const WHERE_KEYS = {
  position: 'where:position',
  spread: 'where:spread',
  soft: 'where:soft',
} as const;

export function defaultWhere(members: WhereMembers = 'pieces'): WhereSpec {
  return {
    order: 'left-right',
    members,
    motion: { kind: 'sweep', bars: 1 },
    position: 0,
    spread: 0,
    soft: 0.5,
    wrap: true,
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function normalizeMotion(raw: unknown): WhereMotion {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bars = Math.max(0.0625, Math.min(64, num(m.bars, 1)));
  switch (m.kind) {
    case 'drawn': return { kind: 'drawn' };
    case 'pingpong': return { kind: 'pingpong', bars };
    case 'burst': return { kind: 'burst', bars };
    case 'random': return { kind: 'random', every: m.every === 'bar' ? 'bar' : 'beat', seed: Math.floor(Math.abs(num(m.seed, 1))) >>> 0 };
    case 'kick': return { kind: 'kick' };
    case 'reveal': return m.reverse === true ? { kind: 'reveal', bars, reverse: true } : { kind: 'reveal', bars };
    case 'sweep':
    default:
      return m.reverse === true ? { kind: 'sweep', bars, reverse: true } : { kind: 'sweep', bars };
  }
}

function normalizeOrderSpec(w: Record<string, unknown>): WhereOrderSpec {
  const order = (WHERE_ORDERS as readonly string[]).includes(String(w.order)) ? (w.order as WhereOrderKind) : 'left-right';
  const out: WhereOrderSpec = { order };
  if (typeof w.angle === 'number' && Number.isFinite(w.angle)) out.angle = ((w.angle % 360) + 360) % 360;
  if (Array.isArray(w.hand)) {
    const hand = [...new Set(w.hand.filter((id): id is string => typeof id === 'string' && !!id))];
    if (hand.length) out.hand = hand;
  }
  if (w.groups === true) out.groups = true;
  if (Array.isArray(w.slots)) {
    const seen = new Set<string>();
    const slots: string[][] = [];
    for (const slot of w.slots) {
      if (!Array.isArray(slot)) continue;
      const ids: string[] = [];
      for (const id of slot) {
        if (typeof id !== 'string' || !id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      if (ids.length) slots.push(ids);
    }
    if (slots.length) out.slots = slots;
  }
  return out;
}

/** A block's where from a file or an undo step (null: none). Never throws. */
export function normalizeWhere(raw: unknown): WhereSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  const members: WhereMembers = w.members === 'leds' || w.members === 'both' ? w.members : 'pieces';
  const spec: WhereSpec = {
    ...normalizeOrderSpec(w),
    members,
    motion: normalizeMotion(w.motion),
    position: clamp01(num(w.position, 0)),
    spread: clamp01(num(w.spread, 0)),
    soft: clamp01(num(w.soft, 0.5)),
  };
  if (w.wrap === true) spec.wrap = true;
  if (w.dark === true) spec.dark = true;
  if (w.span === true) spec.span = true;
  if (typeof w.namedOrder === 'string' && w.namedOrder) spec.namedOrder = w.namedOrder;
  return spec;
}

export function normalizeNamedOrders(raw: unknown): WhereNamedOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: WhereNamedOrder[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ ...normalizeOrderSpec(o), id: o.id, name: typeof o.name === 'string' && o.name ? o.name : 'Order' });
  }
  return out;
}

/** The order a block uses: its named order when that still exists. */
export function resolveOrderSpec(spec: WhereSpec, named: readonly WhereNamedOrder[] = []): WhereOrderSpec {
  if (spec.namedOrder) {
    const hit = named.find((o) => o.id === spec.namedOrder);
    if (hit) return hit;
  }
  return spec;
}
