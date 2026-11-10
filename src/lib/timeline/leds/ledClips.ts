/**
 * LED rows on the Timeline: every WLED controller, and each of its named
 * ranges, is a row (an "LEDs" group, like the pieces). A row's id is its
 * spot id (`led:<controller>` or `led:<controller>#<range>`), the same id
 * the where lines use for the fixture.
 *
 * Blocks on an LED row (`TimelineLedClip`):
 *   follow    the projected picture sampled at the fixture's mapped region
 *   effect    a pattern from the WLED pattern catalog, with its params
 *   colour    one colour
 *   gradient  colour → second colour along the strip (moving with speed)
 *   chase     a runner of colour along the strip
 *   look      a shape Look's colours carried onto the strip
 *
 * An LED row with blocks is dark between them (black frames keep WLED from
 * falling back to its own effect); a row with no blocks anywhere leaves the
 * controller to the project's own LED output. Saved in the Timeline as
 * plain JSON (`ledClips`); see normalizeLedClip.
 */
import type { WLEDPatternId } from '../../types';
import { WLED_PATTERN_CATALOG } from '../../wled/effects';
import { normalizeWhere, type WhereSpec } from '../where/whereModel';
import { generateUUID } from '../../utils/uuid';

export const LED_BLOCK_KINDS = ['follow', 'effect', 'colour', 'gradient', 'chase', 'look'] as const;
export type LedBlockKind = (typeof LED_BLOCK_KINDS)[number];

export interface TimelineLedClip {
  id: string;
  /** The LED row: `led:<controllerId>` or `led:<controllerId>#<rangeId>`. */
  rowId: string;
  startTime: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  kind: LedBlockKind;
  /** '#rrggbb'. */
  color: string;
  color2: string;
  /** 0..1 multiplier on the block's light. */
  brightness: number;
  /** Cycles a second (gradient, chase, look); the pattern's own speed (effect). */
  speed: number;
  /** Chase: runner length, fraction of the strip. */
  width: number;
  /** Effect: how strongly the pattern applies, 0..1. */
  amount: number;
  pattern?: WLEDPatternId;
  params?: Record<string, number>;
  lookId?: string;
  paletteId?: string;
  where?: WhereSpec | null;
  label?: string;
}

export const LED_DEFAULT_SECONDS = 8;
const MIN_SECONDS = 0.05;

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const PATTERNS = new Set<string>(WLED_PATTERN_CATALOG.map((p) => p.id));

export function isLedRowId(id: string): boolean {
  return id.startsWith('led:') && id.length > 4;
}

export function normalizeLedClip(raw: unknown): TimelineLedClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.rowId !== 'string' || !isLedRowId(c.rowId)) return null;
  const kind = (LED_BLOCK_KINDS as readonly string[]).includes(String(c.kind)) ? (c.kind as LedBlockKind) : 'colour';
  const duration = Math.max(MIN_SECONDS, num(c.duration, LED_DEFAULT_SECONDS));
  const clip: TimelineLedClip = {
    id: typeof c.id === 'string' && c.id ? c.id : generateUUID(),
    rowId: c.rowId,
    startTime: Math.max(0, num(c.startTime, 0)),
    duration,
    fadeIn: clamp(num(c.fadeIn, 0), 0, duration),
    fadeOut: clamp(num(c.fadeOut, 0), 0, duration),
    kind,
    color: typeof c.color === 'string' && HEX.test(c.color) ? c.color.toLowerCase() : '#ff2bd6',
    color2: typeof c.color2 === 'string' && HEX.test(c.color2) ? c.color2.toLowerCase() : '#00e5ff',
    brightness: clamp(num(c.brightness, 1), 0, 1),
    speed: clamp(num(c.speed, kind === 'chase' ? 0.5 : kind === 'effect' ? 0.5 : 0), 0, 8),
    width: clamp(num(c.width, 0.15), 0.01, 1),
    amount: clamp(num(c.amount, 1), 0, 1),
  };
  if (typeof c.pattern === 'string' && PATTERNS.has(c.pattern)) clip.pattern = c.pattern as WLEDPatternId;
  if (c.params && typeof c.params === 'object') {
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(c.params as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
    if (Object.keys(params).length) clip.params = params;
  }
  if (typeof c.lookId === 'string' && c.lookId) clip.lookId = c.lookId;
  if (typeof c.paletteId === 'string' && c.paletteId) clip.paletteId = c.paletteId;
  const where = normalizeWhere(c.where);
  if (where) clip.where = { ...where, members: 'leds' };
  if (typeof c.label === 'string' && c.label) clip.label = c.label;
  return clip;
}

export function normalizeLedClips(raw: unknown): TimelineLedClip[] {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeLedClip)
    .filter((c): c is TimelineLedClip => c !== null)
    .sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1));
}

export function ledClipEnd(c: Pick<TimelineLedClip, 'startTime' | 'duration'>): number {
  return c.startTime + c.duration;
}

/** Fades in and out as a 0..1 gain at show time `t` (0 outside the block). */
export function ledClipGain(c: TimelineLedClip, t: number): number {
  if (t < c.startTime - 1e-9 || t >= ledClipEnd(c) - 1e-9) return 0;
  let fadeIn = c.fadeIn;
  let fadeOut = c.fadeOut;
  if (fadeIn + fadeOut > c.duration && fadeIn + fadeOut > 0) {
    const k = c.duration / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }
  let g = 1;
  if (fadeIn > 0) g = Math.min(g, (t - c.startTime) / fadeIn);
  if (fadeOut > 0) g = Math.min(g, (ledClipEnd(c) - t) / fadeOut);
  return clamp(g, 0, 1);
}

/** A display name for a block. */
export function ledClipName(c: TimelineLedClip): string {
  if (c.label) return c.label;
  switch (c.kind) {
    case 'follow': return 'Follow the stage';
    case 'effect': return WLED_PATTERN_CATALOG.find((p) => p.id === c.pattern)?.label ?? 'LED effect';
    case 'colour': return 'Colour';
    case 'gradient': return 'Gradient';
    case 'chase': return 'Chase';
    case 'look': return 'Look';
  }
}
