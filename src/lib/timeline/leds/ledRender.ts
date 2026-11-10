/**
 * What the Timeline's LED rows send to one controller at show time `t`.
 * Pure: the same inputs give the same pixels (scrub = play).
 *
 * Layers, bottom to top, each mixed over what is below by its fade gain:
 *   1. blocks on the controller's own row (the whole strip)
 *   2. blocks on its range rows (that range)
 *   3. LED blocks with a where line, from any LED row: on every lit fixture,
 *      × the fixture's where weight
 *   4. look blocks whose where line reaches the LEDs: the look's colours on
 *      every lit fixture, × weight
 * Starts black: an LED row with blocks is dark between them. Returns false
 * when nothing on the Timeline reaches the controller (it keeps the project's
 * own LED output).
 */
import type { WLEDController, WLEDEffect } from '../../types';
import { applyWLEDEffects, getWLEDPatternDefinition } from '../../wled/effects';
import { parseWLEDHexColor } from '../../wled/mapping';
import { lookPalette } from '../../looks/edgeLooks';
import { ledSpotId } from '../where/spatialOrder';
import { ledClipGain, type TimelineLedClip } from './ledClips';

export type LedLineValues = Record<string, number | boolean>;

/** A look block reaching LED fixtures through its where line. */
export interface LedLookOnStrips {
  clipId: string;
  paletteId: string;
  /** Fade/crossfade weight of the block × its intensity. */
  weight: number;
  /** Block-local seconds (drives the colour drift). */
  localTime: number;
  /** Fixture spot id → where weight. */
  spots: ReadonlyMap<string, number>;
}

export interface LedRenderContext {
  time: number;
  bpm: number;
  /** The stage picture sampled at the controller's LEDs (ledCount × 3). */
  source: Uint8Array | null;
  /** A block's line values (`ledblock:` / `where:` keys). */
  lines?: (clipId: string) => LedLineValues | undefined;
  /** LED blocks with a where line: block id → fixture spot id → weight. */
  where?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  looks?: readonly LedLookOnStrips[];
  /** Something on the Timeline can reach every LED fixture (a where line on
   *  LEDs exists), so every controller is the Timeline's. */
  allDriven?: boolean;
  /** Seconds a block spanning [start, end) runs ahead through section holds
   *  and loops (free-running effects; live only). */
  freeRun?: (start: number, end: number) => number;
}

/** Line keys of an LED block (absolute values, the line wins). */
export const LED_BLOCK_KEYS = {
  brightness: 'ledblock:brightness',
  speed: 'ledblock:speed',
  amount: 'ledblock:amount',
  width: 'ledblock:width',
  color: 'ledblock:color',
  color2: 'ledblock:color2',
  paramPrefix: 'ledblock:param:',
} as const;

interface Span {
  spotId: string;
  start: number;
  count: number;
}

function spansOf(controller: WLEDController): { whole: Span; ranges: Span[] } {
  const count = Math.max(1, Math.floor(controller.ledCount) || 1);
  return {
    whole: { spotId: ledSpotId(controller.id), start: 0, count },
    ranges: (controller.ranges ?? [])
      .filter((r) => r.count > 0)
      .map((r) => ({ spotId: ledSpotId(controller.id, r.id), start: Math.max(0, Math.floor(r.start)), count: Math.floor(r.count) })),
  };
}

/** The controller has blocks on its own rows (anywhere along the Timeline). */
export function controllerHasLedBlocks(controller: WLEDController, clips: readonly TimelineLedClip[]): boolean {
  const own = ledSpotId(controller.id);
  return clips.some((c) => c.rowId === own || c.rowId.startsWith(own + '#'));
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const frac = (v: number) => v - Math.floor(v);
const num = (v: number | boolean | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : d);
function unpack(v: number): [number, number, number] {
  const n = Math.round(v) >>> 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Stable seed from a block id. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** One block's light into `px` (span-local, count × 3). */
export function renderLedBlock(clip: TimelineLedClip, span: { start: number; count: number }, ctx: LedRenderContext, px: Uint8Array): void {
  const n = span.count;
  const lines = ctx.lines?.(clip.id) ?? {};
  const local = Math.max(0, ctx.time + (ctx.freeRun?.(clip.startTime, clip.startTime + clip.duration) ?? 0) - clip.startTime);
  const brightness = clamp01(num(lines[LED_BLOCK_KEYS.brightness], clip.brightness));
  const speed = Math.max(0, num(lines[LED_BLOCK_KEYS.speed], clip.speed));
  const c1: [number, number, number] = lines[LED_BLOCK_KEYS.color] !== undefined ? unpack(num(lines[LED_BLOCK_KEYS.color], 0)) : parseWLEDHexColor(clip.color);
  const c2: [number, number, number] = lines[LED_BLOCK_KEYS.color2] !== undefined ? unpack(num(lines[LED_BLOCK_KEYS.color2], 0)) : parseWLEDHexColor(clip.color2);
  const put = (i: number, r: number, g: number, b: number) => {
    px[i * 3] = Math.round(Math.max(0, Math.min(255, r * brightness)));
    px[i * 3 + 1] = Math.round(Math.max(0, Math.min(255, g * brightness)));
    px[i * 3 + 2] = Math.round(Math.max(0, Math.min(255, b * brightness)));
  };
  switch (clip.kind) {
    case 'follow': {
      for (let i = 0; i < n; i++) {
        const o = (span.start + i) * 3;
        const src = ctx.source;
        put(i, src?.[o] ?? 0, src?.[o + 1] ?? 0, src?.[o + 2] ?? 0);
      }
      return;
    }
    case 'colour':
      for (let i = 0; i < n; i++) put(i, c1[0], c1[1], c1[2]);
      return;
    case 'gradient': {
      for (let i = 0; i < n; i++) {
        const u = n <= 1 ? 0 : i / (n - 1);
        const k = speed > 0 ? 1 - Math.abs(2 * frac(u * 0.5 + speed * local) - 1) : u;
        put(i, c1[0] + (c2[0] - c1[0]) * k, c1[1] + (c2[1] - c1[1]) * k, c1[2] + (c2[2] - c1[2]) * k);
      }
      return;
    }
    case 'chase': {
      const width = clamp01(num(lines[LED_BLOCK_KEYS.width], clip.width)) || 0.01;
      const head = frac(speed * local);
      for (let i = 0; i < n; i++) {
        const u = n <= 1 ? 0 : i / n;
        let d = Math.abs(u - head);
        d = Math.min(d, 1 - d);
        const k = d <= width / 2 ? 1 : clamp01(1 - (d - width / 2) / Math.max(1e-6, width / 2));
        put(i, c1[0] * k, c1[1] * k, c1[2] * k);
      }
      return;
    }
    case 'look': {
      const pal = lookPalette(clip.paletteId).colors;
      const cols = pal.map((c) => [c[0] * 255, c[1] * 255, c[2] * 255]);
      const drift = (speed > 0 ? speed : 0.25) * local;
      for (let i = 0; i < n; i++) {
        const u = frac((n <= 1 ? 0 : i / n) + drift) * cols.length;
        const a = cols[Math.floor(u) % cols.length];
        const b = cols[(Math.floor(u) + 1) % cols.length];
        const k = u - Math.floor(u);
        put(i, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
      }
      return;
    }
    case 'effect': {
      const def = getWLEDPatternDefinition(clip.pattern ?? 'chase');
      const params: Record<string, number> = { ...def.params, ...(clip.params ?? {}) };
      for (const key in lines) {
        if (key.startsWith(LED_BLOCK_KEYS.paramPrefix)) params[key.slice(LED_BLOCK_KEYS.paramPrefix.length)] = num(lines[key], 0);
      }
      const content = def.category === 'content';
      const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
      const effect: WLEDEffect = {
        id: clip.id,
        name: def.label,
        pattern: def.id,
        enabled: true,
        active: true,
        amount: clamp01(num(lines[LED_BLOCK_KEYS.amount], clip.amount)),
        speed: speed > 0 ? speed : def.speed,
        speedMode: def.category === 'rhythmic' ? 'bpm' : 'manual',
        beatDivision: 1,
        blendMode: content ? def.blendMode : 'replace',
        colorSource: content ? 'shader' : 'custom',
        color: hex(c1),
        secondaryColor: hex(c2),
        target: { mode: 'all' },
        params,
        seed: seedOf(clip.id),
      };
      const base = new Uint8Array(n * 3);
      if (content && ctx.source) base.set(ctx.source.subarray(span.start * 3, (span.start + n) * 3));
      const out = new Uint8Array(n * 3);
      applyWLEDEffects(base, out, { id: clip.id, ledCount: n, ranges: [] }, [], [effect], undefined, local * 1000, ctx.bpm);
      for (let i = 0; i < n; i++) put(i, out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
      return;
    }
  }
}

function mixInto(out: Uint8Array, start: number, px: Uint8Array, count: number, k: number): void {
  if (k <= 0) return;
  const a = Math.min(1, k);
  for (let i = 0; i < count; i++) {
    const o = (start + i) * 3;
    if (o + 2 >= out.length) break;
    for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.round(out[o + ch] * (1 - a) + px[i * 3 + ch] * a);
  }
}

/**
 * Render the Timeline's LED light for one controller into `out`
 * (ledCount × 3, sRGB bytes before the controller's calibration).
 */
export function renderTimelineLeds(
  controller: WLEDController,
  clips: readonly TimelineLedClip[],
  ctx: LedRenderContext,
  out: Uint8Array,
): boolean {
  const { whole, ranges } = spansOf(controller);
  const own = controllerHasLedBlocks(controller, clips);
  if (!own && !ctx.allDriven) return false;
  out.fill(0);
  const t = ctx.time;
  let scratch = new Uint8Array(whole.count * 3);
  const draw = (clip: TimelineLedClip, span: Span, k: number) => {
    if (k <= 0) return;
    if (scratch.length < span.count * 3) scratch = new Uint8Array(span.count * 3);
    renderLedBlock(clip, span, ctx, scratch);
    mixInto(out, span.start, scratch, span.count, k);
  };
  const active = clips.filter((c) => !c.where && ledClipGain(c, t) > 0);
  for (const c of active) if (c.rowId === whole.spotId) draw(c, whole, ledClipGain(c, t));
  for (const r of ranges) for (const c of active) if (c.rowId === r.spotId) draw(c, r, ledClipGain(c, t));
  if (ctx.where?.size) {
    const spans = ranges.length ? ranges : [whole];
    for (const c of clips) {
      if (!c.where) continue;
      const weights = ctx.where.get(c.id);
      const g = ledClipGain(c, t);
      if (!weights || g <= 0) continue;
      for (const s of spans) draw(c, s, g * (weights.get(s.spotId) ?? 0));
    }
  }
  if (ctx.looks?.length) {
    const spans = ranges.length ? ranges : [whole];
    for (const look of ctx.looks) {
      for (const s of spans) {
        const w = look.spots.get(s.spotId) ?? 0;
        if (w <= 0) continue;
        const clip: TimelineLedClip = {
          id: look.clipId, rowId: s.spotId, startTime: t - look.localTime, duration: Infinity, fadeIn: 0, fadeOut: 0,
          kind: 'look', color: '#ffffff', color2: '#000000', brightness: 1, speed: 0, width: 0.15, amount: 1, paletteId: look.paletteId,
        };
        draw(clip, s, look.weight * w);
      }
    }
  }
  return true;
}
