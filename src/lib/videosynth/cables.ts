/**
 * Analog Synth's patch as cables to draw over the panel, in the same look as
 * Audio Lab's (music/cableLook). A cable runs from an output (`out:<source>`)
 * to an input (`in:<jack id>`); the panel measures where those jacks are.
 */
import { CABLE_COLORS, CABLE_LIVE_COLOR, cablePath, type DrawnCable } from '../music/cableLook';
import { INPUT_JACKS, VIDEOSYNTH_PARAMS, paramValue, type InputJack } from './patch';

export type Point = { x: number; y: number };

/** Each output keeps its own cable colour, so a source reads the same wherever it is patched. */
export const cableColor = (source: number): string => CABLE_COLORS[(source - 1 + CABLE_COLORS.length) % CABLE_COLORS.length];

/** Sources 5-12 (the LFOs and the music) are control signals; the rest are pictures. */
export const sourceKind = (source: number): 'control' | 'picture' => (source >= 5 && source <= 12 ? 'control' : 'picture');

const spec = (key: string) => VIDEOSYNTH_PARAMS.find((p) => p.key === key)!;

/**
 * The cables to draw. An empty input has none; an input on its normal has
 * one only when normals are shown (drawn faint, no plugs); the cable in the
 * hand (`carried`) leaves its input; a jack that is not on screen has none.
 * `floor` is the lowest a cable may hang.
 */
export function synthCables(
  params: Record<string, unknown>,
  centers: Record<string, Point>,
  opts: { showNormals?: boolean; carried?: InputJack | null; floor?: number; jacks?: InputJack[] } = {},
): DrawnCable[] {
  const out: DrawnCable[] = [];
  for (const j of opts.jacks ?? INPUT_JACKS) {
    if (opts.carried && opts.carried.id === j.id) continue;
    const from = paramValue(params, spec(j.srcKey));
    if (!from) continue;
    const normal = from === j.normal;
    if (normal && !opts.showNormals) continue;
    const a = centers[`out:${from}`];
    const b = centers[`in:${j.id}`];
    if (!a || !b) continue;
    out.push({ id: j.id, d: cablePath(a.x, a.y, b.x, b.y, opts.floor), color: cableColor(from), ends: [a.x, a.y, b.x, b.y], ...(normal ? { normal: true } : {}) });
  }
  return out;
}

/** The cable in the hand, from its output to `end` (the pointer, or the input it snaps to). */
export function liveCable(from: Point, end: Point, floor?: number): DrawnCable {
  return { id: 'live', d: cablePath(from.x, from.y, end.x, end.y, floor), color: CABLE_LIVE_COLOR, ends: [from.x, from.y, end.x, end.y], live: true };
}
