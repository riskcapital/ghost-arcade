/**
 * Where lines and LED rows at show time: the glue between the Timeline
 * document, the stage (pieces and LED fixtures) and the outputs.
 *
 * On every evaluation of the Timeline (play, seek, scrub, export) the show
 * store calls the decorator installed here, after the control lines were
 * ticked, so a block's `where:*` line values at this instant are known:
 *
 *   begin   the where lines of look blocks and LED blocks, and the LED rows'
 *           state for the WLED sender (ledRuntime.ts)
 *   looks   look blocks wear their where weights (showLooks.applyShowLooks
 *           dresses only the lit shapes, by how lit they are)
 *   frame   content blocks with a where line: their own piece is scaled, and
 *           copies go over the other lit pieces (showTrackScene.ts)
 *
 * The maths is pure (`computeWhereStage`, `applyContentWhere`); this module
 * only gathers the inputs.
 */
import { get } from 'svelte/store';
import type { Layer, ShowLayerTrack, ShowLookClip, ShowTempoMap, WLEDController } from '../../types';
import { setShowWhereDecorator, showFreeRunOffset, type ShowTimelineState } from '../../stores/showTimeline';
import type { ShowLookState } from '../../show/tracks/showLooks';
import { evaluateShowLooks } from '../../show/tracks/showLooks';
import type { ShowTrackFrame } from '../../show/tracks/showTrackEval';
import { beatAtSeconds, barBeatAt } from '../../show/tempoMap';
import { lookTargetLayerIds } from '../../looks/edgeLooks';
import { project } from '../../stores/layers';
import { currentLineFrame } from '../lines/lineRuntime';
import type { LineFrame, OverrideRecord } from '../lines/lineEvaluator';
import { cachedSongFeatures, songFeaturesFor } from '../lines/songFeatures';
import { cachedShowAudioDecode, decodeShowAudio } from '../../audio/showAudio';
import { getTransformAspect } from '../../keyframes/layerParamKeys';
import { ledSpots, pieceSpots, type WhereSpot } from './spatialOrder';
import { evaluateWhere } from './whereEval';
import { WHERE_KEYS, type WhereNamedOrder, type WhereSpec } from './whereModel';
import { defaultBeatAt, kickOnsets, type WhereLineValues, type WhereMotionContext } from './whereMotion';
import type { TimelineLedClip } from '../leds/ledClips';
import type { LedLookOnStrips, LedLineValues } from '../leds/ledRender';
import { publishLedTimeline } from '../leds/ledRuntime';

export interface WhereStageInput {
  time: number;
  layers: readonly Layer[];
  controllers: readonly WLEDController[];
  aspect?: number;
  lookClips: readonly ShowLookClip[];
  ledClips: readonly TimelineLedClip[];
  named?: readonly WhereNamedOrder[];
  tempo: ShowTempoMap | null;
  kicks?: readonly number[] | null;
  lines: LineFrame | null;
  /** The look blocks under the playhead (evaluated here when not given). */
  looks?: readonly ShowLookState[];
}

export interface WhereStage {
  spots: WhereSpot[];
  /** Look block id → shape id → weight (look blocks with a where line). */
  lookPieces: Map<string, Map<string, number>>;
  /** Look blocks reaching LED fixtures. */
  lookStrips: LedLookOnStrips[];
  /** LED block id → fixture spot id → weight. */
  ledWhere: Map<string, Map<string, number>>;
  /** Something with a where line can reach the LEDs. */
  allDriven: boolean;
  ctx: WhereMotionContext;
}

export function whereLineValues(rec: OverrideRecord | undefined): WhereLineValues {
  if (!rec) return {};
  const n = (k: string) => (typeof rec[k] === 'number' ? (rec[k] as number) : undefined);
  return { position: n(WHERE_KEYS.position), spread: n(WHERE_KEYS.spread), soft: n(WHERE_KEYS.soft) };
}

export function motionContext(tempo: ShowTempoMap | null, kicks?: readonly number[] | null): WhereMotionContext {
  return { beatAt: tempo ? (t) => beatAtSeconds(tempo, t) : defaultBeatAt, kicks: kicks ?? null };
}

const spotsMemo: { layers: readonly Layer[] | null; controllers: readonly WLEDController[] | null; aspect: number; spots: WhereSpot[] } = { layers: null, controllers: null, aspect: 0, spots: [] };
export function stageSpots(layers: readonly Layer[], controllers: readonly WLEDController[], aspect: number): WhereSpot[] {
  if (spotsMemo.layers === layers && spotsMemo.controllers === controllers && spotsMemo.aspect === aspect) return spotsMemo.spots;
  const spots = [...pieceSpots(layers), ...ledSpots(controllers.filter((c) => c.enabled !== false), aspect)];
  Object.assign(spotsMemo, { layers, controllers, aspect, spots });
  return spots;
}

function lookScopePieces(clip: ShowLookClip, layers: readonly Layer[]): Set<string> | null {
  return clip.scope === 'pieces' ? new Set(lookTargetLayerIds(layers, clip.layerIds ?? [], 'selected')) : null;
}

/** Where every look block and LED block with a where line is at `time`. Pure. */
export function computeWhereStage(input: WhereStageInput): WhereStage {
  const aspect = input.aspect ?? 16 / 9;
  const spots = stageSpots(input.layers, input.controllers, aspect);
  const ctx = motionContext(input.tempo, input.kicks);
  const lookPieces = new Map<string, Map<string, number>>();
  const lookStrips: LedLookOnStrips[] = [];
  const ledWhere = new Map<string, Map<string, number>>();
  let allDriven = input.ledClips.some((c) => !!c.where);
  const looks = input.looks ?? (input.lookClips.some((c) => c.where) ? evaluateShowLooks(input.lookClips, input.time) : []);
  for (const clip of input.lookClips) {
    if (!clip.where) continue;
    if (clip.where.members !== 'pieces') allDriven = true;
    const state = looks.find((l) => l.clipId === clip.id);
    if (!state) continue;
    const rec = input.lines?.looks?.get(clip.id);
    const result = evaluateWhere({
      spec: clip.where, named: input.named, spots, pieces: lookScopePieces(clip, input.layers), aspect,
      time: input.time, start: clip.startTime, ctx, lines: whereLineValues(rec),
    });
    const pieces = new Map<string, number>();
    const strips = new Map<string, number>();
    for (const [id, w] of result.weights) (id.startsWith('led:') ? strips : pieces).set(id, w);
    lookPieces.set(clip.id, pieces);
    if (strips.size) {
      const intensity = typeof rec?.['look:intensity'] === 'number' ? Math.max(0, rec['look:intensity'] as number) : 1;
      lookStrips.push({ clipId: clip.id, paletteId: clip.paletteId, weight: state.weight * Math.min(1, intensity), localTime: input.time - clip.startTime, spots: strips });
    }
  }
  for (const clip of input.ledClips) {
    if (!clip.where) continue;
    if (input.time < clip.startTime || input.time >= clip.startTime + clip.duration) continue;
    const result = evaluateWhere({
      spec: { ...clip.where, members: 'leds' }, named: input.named, spots, aspect,
      time: input.time, start: clip.startTime, ctx, lines: whereLineValues(input.lines?.blocks?.get(clip.id)),
    });
    ledWhere.set(clip.id, result.weights);
  }
  return { spots, lookPieces, lookStrips, ledWhere, allDriven, ctx };
}

/** Look states wear their where weights. */
export function applyLookWhere(looks: ShowLookState[], stage: Pick<WhereStage, 'lookPieces'>): void {
  for (const look of looks) {
    const where = stage.lookPieces.get(look.clipId);
    if (where) look.where = where;
  }
}

function findClipWhere(tracks: readonly ShowLayerTrack[], clipId: string): { where: WhereSpec; startTime: number } | null {
  for (const t of tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) return c.where ? { where: c.where, startTime: c.startTime } : null;
  }
  return null;
}

/**
 * Content blocks with a where line: the block's own piece is scaled by its
 * weight, and copies go over the other pieces of its order (every member
 * has its copy, at no opacity while it is not lit, so the scene keeps its
 * layers while the window moves and only their opacities change).
 *
 * A block marked `dark` takes its pieces over while it plays: their own
 * content goes dark (`frame.darkPieces`), so only what the Timeline lights
 * shows on them. A piece whose own row plays a block keeps it. A `span`
 * block shows one picture across its pieces (`state.span`). Pure.
 */
export function applyContentWhere(
  frame: ShowTrackFrame,
  input: { time: number; tracks: readonly ShowLayerTrack[]; spots: readonly WhereSpot[]; named?: readonly WhereNamedOrder[]; aspect?: number; ctx: WhereMotionContext; lines: LineFrame | null },
): void {
  let dark: Set<string> | null = null;
  for (const state of frame.tracks) {
    if (!state.clip) continue;
    const found = findClipWhere(input.tracks, state.clip.clipId);
    if (!found) continue;
    const result = evaluateWhere({
      spec: { ...found.where, members: 'pieces' }, named: input.named, spots: input.spots, aspect: input.aspect,
      time: input.time, start: found.startTime, ctx: input.ctx, lines: whereLineValues(input.lines?.blocks?.get(state.clip.clipId)),
    });
    const base = state.opacity;
    state.opacity = base * (result.weights.get(state.layerId) ?? 0);
    const copies: Array<{ pieceId: string; opacity: number }> = [];
    for (const slot of result.order.slots) {
      for (const pieceId of slot) {
        if (pieceId === state.layerId) continue;
        copies.push({ pieceId, opacity: base * (result.weights.get(pieceId) ?? 0) });
      }
    }
    state.whereCopies = copies;
    if (found.where.span) state.span = true;
    if (found.where.dark && base > 0) {
      dark ??= new Set(frame.darkPieces ?? []);
      for (const slot of result.order.slots) for (const id of slot) dark.add(id);
    }
  }
  if (dark) {
    // A piece whose own row plays a block is that row's.
    for (const state of frame.tracks) if (!state.sub && state.clip) dark.delete(state.layerId);
    frame.darkPieces = [...dark].sort();
  }
}

// ── Runtime ────────────────────────────────────────────────────────────────

/** Kick onsets of the Timeline's song (show seconds), when it was analysed. */
const kickMemo = new Map<string, number[]>();
const analysing = new Set<string>();
function songKicks(s: ShowTimelineState, wanted: boolean): number[] | null {
  for (const t of s.audioTracks) {
    if (!t.url || t.muted) continue;
    const features = cachedSongFeatures(t.url);
    if (!features) {
      // A where line follows the kick: analyse the song once, in the background.
      if (wanted && !analysing.has(t.url)) {
        analysing.add(t.url);
        const url = t.url;
        // Analysed: forget the mark, so a song the features cache later lets
        // go of is analysed again (a song that cannot be read is not retried).
        void songFeaturesFor(url, async () => cachedShowAudioDecode(url) ?? (await decodeShowAudio(url)))
          .then((features) => { if (features) analysing.delete(url); })
          .catch((err) => console.warn('[Where] song analysis failed:', err));
      }
      continue;
    }
    const key = `${t.url}|${t.startTime}|${t.offset ?? 0}`;
    let kicks = kickMemo.get(key);
    if (!kicks) {
      kicks = kickOnsets(features.features.kick, features.frameRate, t.startTime - (t.offset ?? 0));
      if (kickMemo.size > 8) kickMemo.clear();
      kickMemo.set(key, kicks);
    }
    return kicks;
  }
  return null;
}

function wantsKicks(s: ShowTimelineState): boolean {
  const kick = (w: WhereSpec | null | undefined) => w?.motion.kind === 'kick';
  return s.lookClips.some((c) => kick(c.where)) || s.ledClips.some((c) => kick(c.where)) || s.layerTracks.some((t) => t.clips.some((c) => kick(c.where)));
}

function bpmAt(tempo: ShowTempoMap | null, t: number): number {
  if (!tempo) return 120;
  try {
    return barBeatAt(tempo, t).bpm || 120;
  } catch {
    return 120;
  }
}

let lastStage: { time: number; stage: WhereStage; aspect: number } | null = null;

/** The where lines of the last evaluation (for the Timeline's own drawing). */
export function lastWhereStage(): WhereStage | null {
  return lastStage?.stage ?? null;
}

function blockLines(frame: LineFrame | null, clips: readonly TimelineLedClip[]): Map<string, LedLineValues> {
  const out = new Map<string, LedLineValues>();
  if (!frame?.blocks?.size) return out;
  for (const c of clips) {
    const rec = frame.blocks.get(c.id);
    if (rec) out.set(c.id, rec);
  }
  return out;
}

export function installWhereRuntime(): () => void {
  setShowWhereDecorator({
    begin(s, time) {
      if (s.doc !== 'timeline') {
        lastStage = null;
        publishLedTimeline(null);
        return;
      }
      const p = get(project) as { layers?: Layer[]; wledControllers?: WLEDController[] };
      const aspect = getTransformAspect();
      const lines = currentLineFrame();
      const hasWhere = s.lookClips.some((c) => c.where) || s.ledClips.some((c) => c.where) || s.layerTracks.some((t) => t.clips.some((c) => c.where));
      if (!hasWhere && !s.ledClips.length) {
        lastStage = null;
        publishLedTimeline(null);
        return;
      }
      const stage = computeWhereStage({
        time, layers: p.layers ?? [], controllers: p.wledControllers ?? [], aspect,
        lookClips: s.lookClips, ledClips: s.ledClips, named: s.whereOrders, tempo: s.tempo,
        kicks: hasWhere ? songKicks(s, wantsKicks(s)) : null, lines,
      });
      lastStage = { time, stage, aspect };
      publishLedTimeline({
        time, bpm: bpmAt(s.tempo, time), clips: s.ledClips, lines: blockLines(lines, s.ledClips),
        where: stage.ledWhere, looks: stage.lookStrips, allDriven: stage.allDriven, freeRun: showFreeRunOffset,
      });
    },
    looks(_s, time, looks) {
      if (lastStage && lastStage.time === time) applyLookWhere(looks, lastStage.stage);
    },
    frame(s, time, frame) {
      if (!lastStage || lastStage.time !== time) return;
      if (!s.layerTracks.some((t) => t.clips.some((c) => c.where))) return;
      applyContentWhere(frame, {
        time, tracks: s.layerTracks, spots: lastStage.stage.spots, named: s.whereOrders, aspect: lastStage.aspect,
        ctx: lastStage.stage.ctx, lines: currentLineFrame(),
      });
    },
  });
  // Edits while paused: the store republishes the frame itself.
  return () => {
    setShowWhereDecorator(null);
    publishLedTimeline(null);
    lastStage = null;
  };
}

/** Test seam. */
export function _resetWhereRuntime(): void {
  lastStage = null;
  kickMemo.clear();
  publishLedTimeline(null);
}
