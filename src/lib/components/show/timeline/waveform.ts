/**
 * The audio blocks' peak-envelope path, and a cache for it.
 *
 * Building the path is ~1000 number-to-string conversions for a 512-bucket
 * envelope. It depends only on the peaks and the slice of the source the
 * block shows (the SVG viewBox does the scaling, so zoom does not matter),
 * so moving a track or zooming reuses the string it already has.
 */

export const WAVE_VIEW_H = 40;

/** Mirror the peak envelope around the lane's midline. Only the visible
 *  [offset, offset+duration] slice of the source is drawn, so trimming a
 *  track scrolls the waveform rather than squashing it. */
export function wavePath(peaks: number[] | undefined, offset: number, duration: number, sourceDuration: number): string {
  if (!peaks || peaks.length === 0) return '';
  const total = sourceDuration > 0 ? sourceDuration : duration;
  if (total <= 0) return '';
  const from = Math.max(0, Math.floor((offset / total) * peaks.length));
  const to = Math.min(peaks.length, Math.max(from + 1, Math.ceil(((offset + duration) / total) * peaks.length)));
  const slice = peaks.slice(from, to);
  if (slice.length === 0) return '';
  const n = slice.length;
  const mid = WAVE_VIEW_H / 2;
  let top = '';
  let bottom = '';
  for (let i = 0; i < n; i++) {
    const x = (i / Math.max(1, n - 1)) * 1000;
    const amp = (slice[i] / 255) * (WAVE_VIEW_H / 2);
    top += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${(mid - amp).toFixed(2)}`;
    bottom = `L${x.toFixed(2)},${(mid + amp).toFixed(2)}` + bottom;
  }
  return `${top}${bottom}Z`;
}

const cache = new WeakMap<number[], { offset: number; duration: number; sourceDuration: number; path: string }>();

/** `wavePath`, remembered per peaks array (one entry each: the slice the
 *  track shows now). Peaks arrays are replaced, never mutated. */
export function cachedWavePath(peaks: number[] | undefined, offset: number, duration: number, sourceDuration: number): string {
  if (!peaks || peaks.length === 0) return '';
  const hit = cache.get(peaks);
  if (hit && hit.offset === offset && hit.duration === duration && hit.sourceDuration === sourceDuration) return hit.path;
  const path = wavePath(peaks, offset, duration, sourceDuration);
  cache.set(peaks, { offset, duration, sourceDuration, path });
  return path;
}
