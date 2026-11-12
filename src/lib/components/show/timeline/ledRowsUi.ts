/**
 * The Timeline's LEDs group: one row per WLED controller and one per named
 * range under it (made from the project's WLED setup, never saved), their
 * heights, and the pure maths the LED lanes use.
 */
import { derived, writable, type Readable } from 'svelte/store';
import type { WLEDController } from '../../../types';
import { project } from '../../../stores/layers';
import { ledSpotId } from '../../../timeline/where/spatialOrder';
import type { LedBlockKind, TimelineLedClip } from '../../../timeline/leds/ledClips';
import { lookPalette } from '../../../looks/edgeLooks';
import { WLED_PATTERN_CATALOG } from '../../../wled/effects';

export const LED_GROUP_HEADER_HEIGHT = 24;
export const LED_ROW_HEIGHT = 32;

export interface LedRow {
  /** The row's id = the fixture's spot id (`led:<controller>[#<range>]`). */
  id: string;
  name: string;
  kind: 'controller' | 'range';
  controllerId: string;
  rangeId?: string;
  ledCount: number;
  enabled: boolean;
}

export function ledRowsFor(controllers: readonly WLEDController[]): LedRow[] {
  const out: LedRow[] = [];
  for (const c of controllers) {
    out.push({ id: ledSpotId(c.id), name: c.name || 'WLED', kind: 'controller', controllerId: c.id, ledCount: c.ledCount, enabled: c.enabled !== false });
    for (const r of c.ranges ?? []) {
      if (!(r.count > 0)) continue;
      out.push({ id: ledSpotId(c.id, r.id), name: r.name || 'Range', kind: 'range', controllerId: c.id, rangeId: r.id, ledCount: r.count, enabled: c.enabled !== false });
    }
  }
  return out;
}

/** The LED rows, from the project's WLED controllers. */
export const ledRows: Readable<LedRow[]> = derived(project, ($p, set) => {
  const controllers = ($p as { wledControllers?: WLEDController[] }).wledControllers ?? [];
  set(ledRowsFor(controllers));
}, [] as LedRow[]);

/** The LEDs group is folded away (session only). */
export const ledGroupFolded = writable(false);

/** Height of the LEDs group (0 when there are no controllers). */
export function ledGroupHeight(rows: readonly LedRow[], folded: boolean): number {
  if (!rows.length) return 0;
  return LED_GROUP_HEADER_HEIGHT + (folded ? 0 : rows.length * LED_ROW_HEIGHT);
}

export const LED_KIND_LABELS: Record<LedBlockKind, string> = {
  follow: 'Follow the stage',
  effect: 'LED effect',
  colour: 'Color',
  gradient: 'Gradient',
  chase: 'Chase',
  look: 'Look',
};

/** A new block's fields per kind. */
export function newLedBlockFields(kind: LedBlockKind): Partial<TimelineLedClip> {
  switch (kind) {
    case 'effect': return { kind, pattern: 'comet', speed: 0.5, color: '#ff2bd6', color2: '#00e5ff' };
    case 'chase': return { kind, speed: 0.5, width: 0.15, color: '#ffffff' };
    case 'gradient': return { kind, color: '#ff2bd6', color2: '#00e5ff', speed: 0 };
    case 'look': return { kind, paletteId: 'neon', speed: 0.25 };
    case 'follow': return { kind };
    default: return { kind: 'colour', color: '#ff2bd6' };
  }
}

/** CSS background that tells a block's kind at a glance. */
export function ledBlockBackground(c: TimelineLedClip): string {
  const css = (v: number[]) => `rgb(${Math.round(v[0] * 255)} ${Math.round(v[1] * 255)} ${Math.round(v[2] * 255)})`;
  switch (c.kind) {
    case 'colour': return c.color;
    case 'gradient': return `linear-gradient(90deg, ${c.color}, ${c.color2})`;
    case 'chase': return `repeating-linear-gradient(90deg, ${c.color} 0 6px, #000 6px 22px)`;
    case 'look': {
      const p = lookPalette(c.paletteId).colors;
      return `linear-gradient(90deg, ${css(p[0])}, ${css(p[1])}, ${css(p[2])})`;
    }
    case 'effect': return `repeating-linear-gradient(135deg, ${c.color}55 0 6px, ${c.color2}55 6px 12px)`;
    case 'follow': return 'linear-gradient(180deg, rgba(92,225,230,0.35), rgba(92,225,230,0.12))';
  }
}

export const LED_PATTERNS = WLED_PATTERN_CATALOG;

/** The LED row under a client y, given the lanes' top and the rows. */
export function ledRowAtY(y: number, rows: readonly LedRow[]): LedRow | null {
  if (y < LED_GROUP_HEADER_HEIGHT) return null;
  const i = Math.floor((y - LED_GROUP_HEADER_HEIGHT) / LED_ROW_HEIGHT);
  return rows[i] ?? null;
}
