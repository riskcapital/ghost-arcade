/**
 * The step-1 ◆ keyframe lanes become control lines (one concept on the
 * Timeline). A lane on a piece's row becomes a line on that piece; a lane on
 * a layer added on a piece (sub-row) becomes a line on that row's copy.
 * Same keys, same times, same values; each key's easing becomes the curve to
 * the next point (step = hold).
 *
 * The range is a first guess (0..1, widened to the values); the Timeline
 * fits it to the parameter's own range once the project is there
 * (fitLineRanges).
 */
import type { KeyframeEasing, KeyframeTrack, ShowLayerTrack } from '../../types';
import type { ControlLine, LineCurve, LinePoint } from './lineModel';
import { sameTarget, targetId, type ParamEntry, type ParamTarget } from './paramRegistry';

export function curveForEasing(easing: KeyframeEasing | undefined): LineCurve | undefined {
  if (!easing || easing === 'linear') return undefined;
  if (easing === 'step') return 'hold';
  return easing;
}

/** The target a row's lines drive: its piece, or for an added layer its own copy. */
export function rowLineTarget(track: Pick<ShowLayerTrack, 'id' | 'layerId' | 'subRow'>): ParamTarget {
  return { scope: 'layer', id: track.subRow ? `showsub::${track.layerId}::${track.id}` : track.layerId };
}

export function laneToLine(lane: KeyframeTrack, target: ParamTarget, id: string): ControlLine | null {
  if (lane.type === 'boolean') {
    const points: LinePoint[] = lane.boolKeyframes.map((k) => ({ t: Math.max(0, k.time), v: k.value ? 1 : 0, c: 'hold' }));
    if (!points.length) return null;
    return { id, target, key: lane.key, kind: 'bool', min: 0, max: 1, step: 1, points, label: lane.label };
  }
  if (!lane.keyframes.length) return null;
  const points: LinePoint[] = lane.keyframes.map((k) => {
    const c = curveForEasing(k.easing);
    return c ? { t: Math.max(0, k.time), v: k.value, c } : { t: Math.max(0, k.time), v: k.value };
  });
  const values = points.map((p) => p.v);
  return {
    id,
    target,
    key: lane.key,
    kind: 'continuous',
    min: Math.min(0, ...values),
    max: Math.max(1, ...values),
    points: points.sort((a, b) => a.t - b.t),
    label: lane.label,
  };
}

/**
 * Lines for every lane on `tracks`, and the tracks without their lanes.
 * A lane whose (target, key) already has a line is dropped (the line wins).
 * Ids are fixed per (track, key), so loading the same file twice gives the
 * same lines.
 */
export function lanesToLines(tracks: readonly ShowLayerTrack[], existing: readonly ControlLine[] = []): { tracks: ShowLayerTrack[]; lines: ControlLine[] } {
  if (!tracks.some((t) => t.lanes?.length)) return { tracks: tracks as ShowLayerTrack[], lines: [] };
  const taken = new Set(existing.map((l) => `${targetId(l.target)}|${l.key}`));
  const lines: ControlLine[] = [];
  const out = tracks.map((track) => {
    if (!track.lanes?.length) return track;
    const target = rowLineTarget(track);
    for (const lane of track.lanes) {
      const k = `${targetId(target)}|${lane.key}`;
      if (taken.has(k)) continue;
      const line = laneToLine(lane, target, `lane:${track.id}:${lane.key}`);
      if (!line) continue;
      taken.add(k);
      lines.push(line);
    }
    return { ...track, lanes: [] };
  });
  return { tracks: out, lines };
}

/**
 * Fit each line's range (and kind/step) to its parameter's, where the
 * registry knows it. Returns the same array when nothing changes.
 */
export function fitLineRanges(lines: readonly ControlLine[], describe: (target: ParamTarget, key: string) => ParamEntry | null): ControlLine[] {
  let changed = false;
  const out = lines.map((line) => {
    const entry = describe(line.target, line.key);
    if (!entry) return line;
    if (entry.min === line.min && entry.max === line.max && entry.kind === line.kind && (entry.step ?? undefined) === (line.step ?? entry.step)) return line;
    if (!(entry.max > entry.min)) return line;
    changed = true;
    return {
      ...line,
      kind: entry.kind,
      min: entry.min,
      max: entry.max,
      step: entry.step,
      default: typeof entry.default === 'number' ? entry.default : entry.default ? 1 : 0,
    };
  });
  return changed ? out : (lines as ControlLine[]);
}

/** Lines of `lines` on `target`. */
export function linesOn(lines: readonly ControlLine[], target: ParamTarget): ControlLine[] {
  return lines.filter((l) => sameTarget(l.target, target));
}
