/**
 * Where the Timeline's Screen FX and Effects rows meet the renderer.
 *
 * On every evaluation of the Timeline (each frame while playing, every seek
 * and scrub, every frame of an offline render) the frame at show time is
 * worked out (stageFxEval.ts, pure) and published here:
 *
 *   - Screen FX: Canvas's Screen FX driver multiplies each piece's opacity
 *     (and tint) by `timelineScreenFx()` instead of running the project's
 *     own Screen FX, and does not advance the project's automation cycle.
 *     Null: the Timeline does not drive Screen FX (another tab is active,
 *     the Timeline is closed and stopped, or its Screen FX row is empty) and
 *     the project's own Screen FX carry on where they were.
 *   - Effects: nativeRendererSync's composite chain appends
 *     `timelineCompositionEffects()` after the project's composition effects.
 *
 * Nothing writes the project.
 */
import { get } from 'svelte/store';
import type { Layer, ShowTempoMap } from '../../types';
import { onShowFrame, showFreeRunOffset, showTimeline, type ShowTimelineState } from '../../stores/showTimeline';
import { project } from '../../stores/layers';
import { currentLineFrame } from '../lines/lineRuntime';
import { cachedSongFeatures, sampleFeature } from '../lines/songFeatures';
import { getTransformAspect } from '../../keyframes/layerParamKeys';
import { pieceSpots } from '../where/spatialOrder';
import { evaluateWhere } from '../where/whereEval';
import { motionContext, whereLineValues } from '../where/whereRuntime';
import { stageClipEnd, type TimelineStageClip } from './stageClips';
import { evaluateStageFx, screenFxPieces, type ScreenFxPiece, type StageFxFrame } from './stageFxEval';
import { publishStageFx, resetStageFxState } from './stageFxState';
export { timelineScreenFx, timelineScreenFxFor, timelineCompositionEffects, timelineStageFxFrame, publishStageFx, type TimelineStageFxState } from './stageFxState';

/** The Timeline drives its Stage rows now: its tab is active and it is open or playing. */
export function stageRowsDrive(s: Pick<ShowTimelineState, 'doc' | 'isOpen' | 'isPlaying' | 'stageClips'>): boolean {
  return s.doc === 'timeline' && (s.isOpen || s.isPlaying) && s.stageClips.length > 0;
}

const piecesMemo: { layers: readonly Layer[] | null; pieces: ScreenFxPiece[] } = { layers: null, pieces: [] };
function piecesOf(layers: readonly Layer[]): ScreenFxPiece[] {
  if (piecesMemo.layers !== layers) Object.assign(piecesMemo, { layers, pieces: screenFxPieces(layers) });
  return piecesMemo.pieces;
}

function songLevel(s: ShowTimelineState): ((t: number) => number | null) | null {
  for (const track of s.audioTracks) {
    if (!track.url || track.muted) continue;
    const features = cachedSongFeatures(track.url);
    if (!features) continue;
    return (t) => {
      const local = t - track.startTime + (track.offset ?? 0);
      if (local < 0 || t > track.startTime + track.duration) return null;
      return sampleFeature(features, 'level', local);
    };
  }
  return null;
}

/** Where weights of the Screen FX blocks with a where line, at `time`. */
function whereWeights(clips: readonly TimelineStageClip[], layers: readonly Layer[], time: number, tempo: ShowTempoMap | null, named: ShowTimelineState['whereOrders']) {
  const out = new Map<string, Map<string, number>>();
  const spots = pieceSpots(layers);
  const ctx = motionContext(tempo, null);
  const lines = currentLineFrame();
  for (const clip of clips) {
    if (!clip.where || time < clip.startTime || time >= stageClipEnd(clip)) continue;
    const result = evaluateWhere({
      spec: { ...clip.where, members: 'pieces' }, named, spots, aspect: getTransformAspect(),
      time, start: clip.startTime, ctx, lines: whereLineValues(lines?.blocks?.get(clip.id)),
    });
    out.set(clip.id, result.weights);
  }
  return out;
}

/** The frame at `time` for a Timeline state (pure apart from the project read). */
export function stageFxFrameFor(s: ShowTimelineState, time: number, layers: readonly Layer[]): StageFxFrame {
  return evaluateStageFx({
    time,
    clips: s.stageClips,
    pieces: piecesOf(layers),
    tempo: s.tempo,
    lines: currentLineFrame(),
    level: songLevel(s),
    where: s.stageClips.some((c) => c.where) ? whereWeights(s.stageClips, layers, time, s.tempo, s.whereOrders) : null,
    freeRun: showFreeRunOffset,
  });
}

function evaluateAt(time: number): void {
  const s = get(showTimeline);
  if (!stageRowsDrive(s)) {
    publishStageFx(null);
    return;
  }
  const layers = ((get(project) as { layers?: Layer[] }).layers ?? []) as Layer[];
  const frame = stageFxFrameFor(s, time, layers);
  publishStageFx({ time, screenFx: frame.screenFx, effects: frame.effects, screenFxBlocks: frame.screenFxBlocks });
}

/** Wire the rows into the show's evaluation (once, at start). */
export function installStageFxRuntime(): () => void {
  const offFrame = onShowFrame((tick) => {
    try {
      evaluateAt(tick.time);
    } catch (err) {
      console.warn('[TimelineStageFx] evaluation failed:', err);
    }
  });
  // Opening/closing the tray, switching tabs or loading a project changes
  // who drives without an evaluation: settle it here.
  let lastKey = '';
  const unsub = showTimeline.subscribe((s) => {
    const key = `${stageRowsDrive(s)}|${s.stageClips.length}`;
    if (key === lastKey) return;
    lastKey = key;
    queueMicrotask(() => {
      try { evaluateAt(get(showTimeline).currentTime); } catch { /* evaluated on the next frame */ }
    });
  });
  return () => {
    offFrame();
    unsub();
    publishStageFx(null);
  };
}

/** Test seam. */
export function _resetStageFxRuntime(): void {
  resetStageFxState();
  piecesMemo.layers = null;
}
