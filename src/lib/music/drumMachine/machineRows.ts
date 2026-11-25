/**
 * Which pads a step grid shows: the sequencer's tracks in their order, then
 * any other pad with hits on the part (recorded live, or from an older
 * beat), so every hit can be seen, edited and deleted. Pads with no hits
 * that are not on the sequencer stay hidden.
 */

import type { Part } from './machineBeat';

export function shownPads(trackPads: readonly number[], part: Pick<Part, 'tracks'>, padCount: number): number[] {
  const out = trackPads.filter((p) => p >= 0 && p < padCount);
  const seen = new Set(out);
  part.tracks.forEach((track, pad) => {
    if (pad < padCount && !seen.has(pad) && track.vel.some((v) => v > 0)) {
      out.push(pad);
      seen.add(pad);
    }
  });
  return out;
}
