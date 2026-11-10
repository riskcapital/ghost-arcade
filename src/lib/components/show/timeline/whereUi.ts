/**
 * Drawing a where line in the Timeline: the spatial order of a block's
 * pieces (the mini strip), the band (position ± spread) over the block's
 * span, which pieces are lit at a time, and the stage highlight.
 */
import { get, writable } from 'svelte/store';
import type { Layer, ShowTempoMap, WLEDController } from '../../../types';
import { project } from '../../../stores/layers';
import { showTimeline } from '../../../stores/showTimeline';
import { lookTargetLayerIds } from '../../../looks/edgeLooks';
import { getTransformAspect } from '../../../keyframes/layerParamKeys';
import { lineValueAt } from '../../../timeline/lines/lineEvaluator';
import type { ControlLine } from '../../../timeline/lines/lineModel';
import type { ParamTarget } from '../../../timeline/lines/paramRegistry';
import { sameTarget } from '../../../timeline/lines/paramRegistry';
import { stageSpots, motionContext } from '../../../timeline/where/whereRuntime';
import { cachedOrder, whereMembers } from '../../../timeline/where/whereEval';
import { resolveOrderSpec, WHERE_KEYS, type WhereMembers, type WhereNamedOrder, type WhereSpec } from '../../../timeline/where/whereModel';
import { whereWindowAt, type WhereLineValues } from '../../../timeline/where/whereMotion';
import { slotWeight, windowSpan } from '../../../timeline/where/whereWindow';
import type { WhereSpot } from '../../../timeline/where/spatialOrder';

/** Spots lit on the stage preview while a where line is hovered or edited: id → 0..1. */
export const whereHighlight = writable<ReadonlyMap<string, number> | null>(null);

export interface WhereBlockInfo {
  /** The block's line target (its where lines live there). */
  target: ParamTarget;
  where: WhereSpec;
  start: number;
  duration: number;
  /** A look block's chosen pieces (null: every shape). */
  pieces?: ReadonlySet<string> | null;
}

export interface WhereOrderView {
  /** Slots in order: their spot ids and a label. */
  slots: Array<{ ids: string[]; label: string; kind: WhereSpot['kind'] }>;
}

export function stageNow(): { spots: WhereSpot[]; aspect: number; layers: readonly Layer[] } {
  const p = get(project) as { layers?: Layer[]; wledControllers?: WLEDController[] };
  const aspect = getTransformAspect();
  return { spots: stageSpots(p.layers ?? [], p.wledControllers ?? [], aspect), aspect, layers: p.layers ?? [] };
}

export function lookPieces(layers: readonly Layer[], scope: 'all' | 'pieces', layerIds: readonly string[] | undefined): Set<string> | null {
  return scope === 'pieces' ? new Set(lookTargetLayerIds(layers, layerIds ?? [], 'selected')) : null;
}

/** The order a block's where line runs along, with labels. */
export function whereOrderView(where: WhereSpec, pieces: ReadonlySet<string> | null | undefined, named: readonly WhereNamedOrder[]): WhereOrderView {
  const { spots, aspect } = stageNow();
  const members = whereMembers(where, spots, pieces ?? null);
  const order = cachedOrder(members, resolveOrderSpec(where, named), aspect);
  const byId = new Map(members.map((s) => [s.id, s]));
  return {
    slots: order.slots.map((ids) => ({
      ids,
      label: ids.map((id) => byId.get(id)?.label ?? id).join(' + '),
      kind: byId.get(ids[0])?.kind ?? 'piece',
    })),
  };
}

function whereLinesOf(lines: readonly ControlLine[], target: ParamTarget): Partial<Record<keyof WhereLineValues, ControlLine>> {
  const out: Partial<Record<keyof WhereLineValues, ControlLine>> = {};
  for (const l of lines) {
    if (!sameTarget(l.target, target) || l.enabled === false) continue;
    if (l.key === WHERE_KEYS.position) out.position = l;
    else if (l.key === WHERE_KEYS.spread) out.spread = l;
    else if (l.key === WHERE_KEYS.soft) out.soft = l;
  }
  return out;
}

export interface WhereSampler {
  n: number;
  /** The window at show time `t`: centre and half-width in slots, soft edge, wrap. */
  at(t: number): { centre: number; half: number; soft: number; wrap: boolean };
  /** How lit each slot is at `t`. */
  weights(t: number): number[];
}

/** Samples a block's where line over time (drawn lines included; live sources read as their base). */
export function whereSampler(info: WhereBlockInfo, n: number, tempo: ShowTempoMap | null, lines: readonly ControlLine[]): WhereSampler {
  const ctx = motionContext(tempo, null);
  const own = whereLinesOf(lines, info.target);
  const lineCtx = { tempo };
  const values = (t: number): WhereLineValues => {
    const v = (l: ControlLine | undefined) => {
      if (!l || (!l.points.length && !l.follow)) return undefined;
      const x = lineValueAt(l, t, lineCtx);
      return typeof x === 'number' ? x : undefined;
    };
    return { position: v(own.position), spread: v(own.spread), soft: v(own.soft) };
  };
  const windowAt = (t: number) => whereWindowAt(info.where, t, info.start, n, ctx, values(t));
  return {
    n,
    at(t) {
      const w = windowAt(t);
      const span = windowSpan(n, w);
      return { ...span, soft: w.soft, wrap: !!w.wrap };
    },
    weights(t) {
      const w = windowAt(t);
      return Array.from({ length: n }, (_, i) => slotWeight(i, n, w));
    },
  };
}

/** Which spots are lit at `t` (id → weight), for the hover readout and the stage. */
export function litSpotsAt(info: WhereBlockInfo, t: number): { lit: Map<string, number>; labels: string[] } {
  const s = get(showTimeline);
  const view = whereOrderView(info.where, info.pieces, s.whereOrders);
  const sampler = whereSampler(info, view.slots.length, s.tempo, s.lines);
  const weights = sampler.weights(t);
  const lit = new Map<string, number>();
  const labels: string[] = [];
  view.slots.forEach((slot, i) => {
    if (weights[i] <= 0.001) return;
    for (const id of slot.ids) lit.set(id, weights[i]);
    labels.push(weights[i] >= 0.999 ? slot.label : `${slot.label} ${Math.round(weights[i] * 100)}%`);
  });
  return { lit, labels };
}

export const WHERE_ORDER_LABELS: Record<WhereSpec['order'], string> = {
  'left-right': 'Left → right',
  'right-left': 'Right → left',
  'top-bottom': 'Top → bottom',
  'bottom-top': 'Bottom → top',
  'centre-out': 'Centre out',
  around: 'Around',
  hand: 'By hand',
};

export const WHERE_MOTION_LABELS: Record<WhereSpec['motion']['kind'], string> = {
  sweep: 'Sweep',
  pingpong: 'Ping-pong',
  burst: 'Centre burst',
  random: 'Random piece',
  kick: 'Follow the kick',
  drawn: 'Drawn',
};

export const WHERE_MEMBER_LABELS: Record<WhereMembers, string> = {
  pieces: 'Pieces',
  leds: 'LEDs',
  both: 'Pieces + LEDs',
};

/** One line summary for a block's where ("Sweep · 1 bar · Left → right"). */
export function whereSummary(where: WhereSpec, named: readonly WhereNamedOrder[]): string {
  const m = where.motion;
  const motion = WHERE_MOTION_LABELS[m.kind];
  const extra = m.kind === 'sweep' || m.kind === 'pingpong' || m.kind === 'burst'
    ? ` · ${m.bars} bar${m.bars === 1 ? '' : 's'}`
    : m.kind === 'random' ? ` · every ${m.every}` : '';
  const order = where.namedOrder ? named.find((o) => o.id === where.namedOrder)?.name ?? WHERE_ORDER_LABELS[where.order] : WHERE_ORDER_LABELS[where.order];
  return `${motion}${extra} · ${order}`;
}
