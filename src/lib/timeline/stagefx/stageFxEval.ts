/**
 * The Stage group's block rows at one instant. Pure: the same inputs give
 * the same frame, so scrub = play = export.
 *
 * Screen FX row
 *   - no blocks on the row: `screenFx` is null and the project's own Screen
 *     FX (and their automation) carry on as before;
 *   - blocks on the row: the Timeline owns the Screen FX. Between blocks no
 *     Screen FX shows (every piece at its own brightness); inside a block
 *     each piece gets the block's effect, evaluated on the block's own copy
 *     with its control lines (`sfx:` keys) applied; overlapping blocks
 *     crossfade their outputs; a where line limits the pieces it touches.
 *   Each block runs on its own clock (show time − block start), except Beat
 *   Pulse, which flashes on the Timeline's beats, and Audio Reactive, which
 *   follows the Timeline's song (both pure functions of show time).
 * Effects row
 *   - the composition effects of the blocks under the playhead, each at its
 *     mix × its crossfade weight, with its lines (`fxb:` keys) applied. They
 *     run after the project's own composition effects.
 */
import type { Effect, Layer, ShowTempoMap, StageEffect } from '../../types';
import { chaseOrderIndices, stageEffectRawValue, stageEffectScreenOutput, type StageTint } from '../../stores/stageEffects';
import { beatAtSeconds } from '../../show/tempoMap';
import type { LineFrame } from '../lines/lineEvaluator';
import { stageClipWeights, type TimelineStageClip } from './stageClips';
import { applyEffectBlockLines, applyScreenFxLines } from './stageFxParams';

export interface ScreenFxPiece {
  id: string;
  /** Centre in 0..1 of the output, x right, y DOWN (the generators' space). */
  cx: number;
  cy: number;
}

export interface ScreenFxOut {
  brightness: number;
  tint: StageTint | null;
}

export interface StageFxInput {
  time: number;
  clips: readonly TimelineStageClip[];
  pieces: readonly ScreenFxPiece[];
  tempo: ShowTempoMap | null;
  lines: LineFrame | null;
  /** The Timeline song's level 0..1 at show time (Audio Reactive), when known. */
  level?: ((t: number) => number | null) | null;
  /** Screen FX blocks with a where line: block id → piece id → 0..1. */
  where?: ReadonlyMap<string, ReadonlyMap<string, number>> | null;
  /** Free-running offset of a block through section holds and loops. */
  freeRun?: ((start: number, end: number) => number) | null;
}

export interface StageFxFrame {
  /** Piece id → output; null = the row has no blocks (the project's own run). */
  screenFx: Map<string, ScreenFxOut> | null;
  /** The Screen FX blocks under the playhead and their weights. */
  screenFxBlocks: { clipId: string; weight: number }[];
  /** Composition effects from the Effects row (copies, at their mixes). */
  effects: Effect[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The pieces Screen FX reach: visible mapping layers, not group containers or VJ feeds. */
export function screenFxPieces(layers: readonly Layer[]): ScreenFxPiece[] {
  const out: ScreenFxPiece[] = [];
  const seen = new Set<string>();
  for (const layer of layers) {
    if (!layer.visible) continue;
    if (String(layer.type) === 'group') continue;
    if (String(layer.id).startsWith('vj-')) continue;
    if (seen.has(layer.id)) continue;
    seen.add(layer.id);
    const c = layer.corners;
    let x = 0.5;
    let y = 0.5;
    if (c) {
      const pts = [c.topLeft, c.topRight, c.bottomLeft, c.bottomRight];
      x = clamp(pts.reduce((s, p) => s + (p?.x ?? 0.5), 0) / 4, 0, 1);
      y = clamp(pts.reduce((s, p) => s + (p?.y ?? 0.5), 0) / 4, 0, 1);
    }
    // Corners are y-up; the generators work y-down (as the mapping engine does).
    out.push({ id: layer.id, cx: x, cy: 1 - y });
  }
  return out;
}

function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function beatsAt(tempo: ShowTempoMap | null, t: number): { beat: number; perSecond: number } {
  if (!tempo) return { beat: t * 2, perSecond: 2 };
  try {
    const beat = beatAtSeconds(tempo, t);
    const perSecond = Math.max(1e-3, (beatAtSeconds(tempo, t + 0.01) - beat) / 0.01);
    return { beat, perSecond };
  } catch {
    return { beat: t * 2, perSecond: 2 };
  }
}

/**
 * A generator's 0..1 value as a pure function of time. The live-only
 * generators get Timeline versions: Beat Pulse on the Timeline's beats,
 * Audio Reactive on the song's level, Random Hits seeded per piece and slot.
 */
export function timelineScreenFxValue(
  fx: StageEffect,
  piece: ScreenFxPiece,
  index: number,
  count: number,
  local: number,
  absolute: number,
  ctx: Pick<StageFxInput, 'tempo' | 'level'>,
): number {
  const p = fx.params;
  switch (fx.type) {
    case 'beat-pulse': {
      const decay = Math.max(0.01, p.decay ?? 0.25);
      const { beat, perSecond } = beatsAt(ctx.tempo, absolute);
      const since = (((beat % 1) + 1) % 1) / perSecond;
      return Math.max(0, 1 - since / decay);
    }
    case 'audio-rms-intensity': {
      const level = ctx.level?.(absolute) ?? 0;
      const gain = p.gain ?? 3;
      const floor = clamp(p.floor ?? 0.05, 0, 1);
      return clamp(floor + (1 - floor) * clamp((level * gain) / 3, 0, 1), 0, 1);
    }
    case 'random-hits': {
      const rate = Math.max(0.01, p.rate ?? 3);
      const duration = Math.max(0.01, p.duration ?? 0.18);
      const peak = p.peak ?? 1;
      const slot = Math.floor(local / duration);
      const chance = Math.min(1, (rate / Math.max(1, count)) * duration);
      if (hash01(index + 1, slot, 7919) >= chance) return 0;
      const k = 1 - (local - slot * duration) / duration;
      return peak * k * k;
    }
    default:
      return stageEffectRawValue(fx, piece.cx, piece.cy, local, { _sliceIndex: index, _sliceCount: count });
  }
}

const NO_TINT: StageTint = [1, 1, 1];

export function evaluateStageFx(input: StageFxInput): StageFxFrame {
  const t = input.time;
  const hasScreenFx = input.clips.some((c) => c.row === 'screenfx');
  const frame: StageFxFrame = { screenFx: null, screenFxBlocks: [], effects: [] };
  if (hasScreenFx) {
    const out = new Map<string, ScreenFxOut>();
    const pieces = input.pieces;
    const count = pieces.length;
    const blocks = stageClipWeights(input.clips, 'screenfx', t);
    frame.screenFxBlocks = blocks.map((b) => ({ clipId: b.clip.id, weight: b.weight }));
    const acc = pieces.map(() => ({ w: 0, b: 0, r: 0, g: 0, bl: 0, tinted: false }));
    for (const { clip, weight } of blocks) {
      const fx = applyScreenFxLines(clip.screenFx!, input.lines?.blocks?.get(clip.id));
      const local = t - clip.startTime + (input.freeRun?.(clip.startTime, clip.startTime + clip.duration) ?? 0);
      const order = chaseOrderIndices(pieces.map((p) => [p.id]), fx.order);
      const where = clip.where ? input.where?.get(clip.id) ?? null : null;
      for (let i = 0; i < count; i++) {
        const w = weight * (clip.where ? where?.get(pieces[i].id) ?? 0 : 1);
        if (w <= 0) continue;
        const v = timelineScreenFxValue(fx, pieces[i], order[i], count, local, t, input);
        const o = stageEffectScreenOutput(fx, v, order[i], count, local);
        const a = acc[i];
        a.w += w;
        a.b += w * o.brightness;
        const tint = o.tint ?? NO_TINT;
        a.r += w * tint[0];
        a.g += w * tint[1];
        a.bl += w * tint[2];
        if (o.tint) a.tinted = true;
      }
    }
    for (let i = 0; i < count; i++) {
      const a = acc[i];
      const rest = Math.max(0, 1 - a.w);
      out.set(pieces[i].id, {
        brightness: clamp(a.b + rest, 0, 1),
        tint: a.tinted ? [clamp(a.r + rest, 0, 1), clamp(a.g + rest, 0, 1), clamp(a.bl + rest, 0, 1)] : null,
      });
    }
    frame.screenFx = out;
  }
  for (const { clip, weight } of stageClipWeights(input.clips, 'effects', t)) {
    const effect = applyEffectBlockLines(clip.effect!, input.lines?.blocks?.get(clip.id));
    frame.effects.push({ ...effect, id: `timeline-fx:${clip.id}`, enabled: true, opacity: clamp((effect.opacity ?? 1) * weight, 0, 1) });
  }
  return frame;
}

export { scenePieceId } from './stageFxState';
