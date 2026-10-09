/**
 * Painting mode: find a painting in the scan photo, and cut it out as a
 * picture that lands exactly on the real painting when the desktop pins it
 * to the measured corners.
 *
 * A painting hangs flat on its wall, so the stripe scan cannot tell the two
 * apart (they are one plane). The photo can: a wall is one even tone and a
 * painting is not. Finding it is a starting point, never the last word: the
 * four corners stay draggable.
 */
import { convexHull, enclosingQuad, snapToEdges, type Photo } from './surfaceDetect';
import { applyHomography, invertHomography, type UV } from './structuredLight';

type Point = { x: number; y: number };

/**
 * The painting's four corners in the photo (normalised, clockwise from top
 * left), or null if nothing stands out from the wall. `lit` marks photo
 * pixels the projector reaches (the scan's valid map); only they are searched.
 */
export function findPainting(photo: Photo, lit?: Uint8Array | null): UV[] | null {
  const step = Math.max(1, Math.round(Math.max(photo.width, photo.height) / 240));
  const w = Math.floor(photo.width / step), h = Math.floor(photo.height / step);
  if (w < 16 || h < 16) return null;
  const tone = new Float32Array(w * h), inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, on = 0;
    for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) {
      const i = (y * step + dy) * photo.width + x * step + dx;
      sum += photo.luma[i];
      if (!lit || lit[i]) on++;
    }
    tone[y * w + x] = sum / (step * step);
    inside[y * w + x] = on >= step * step * 0.25 ? 1 : 0;
  }
  // The scan reads nothing right at a stripe edge, so its map is speckled: let "lit" spread a little.
  const reach = lit ? spread(inside, w, h, 3) : inside.fill(1);
  let count = 0, low = Infinity, high = -Infinity;
  for (let i = 0; i < tone.length; i++) if (reach[i]) { count++; low = Math.min(low, tone[i]); high = Math.max(high, tone[i]); }
  if (count < 200 || high - low < 8) return null;
  // The wall is the commonest tone in the lit area.
  const bins = new Uint32Array(48);
  const bin = (v: number) => Math.min(47, Math.floor(((v - low) / (high - low)) * 48));
  for (let i = 0; i < tone.length; i++) if (reach[i]) bins[bin(tone[i])]++;
  let mode = 0;
  for (let i = 1; i < 48; i++) if (bins[i] > bins[mode]) mode = i;
  const wall = low + ((mode + 0.5) / 48) * (high - low);
  // How unlike the wall each spot is: its tone, plus how busy it is.
  const odd = new Float32Array(w * h);
  let top = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!reach[i]) continue;
    const busy = Math.abs(tone[i + 1] - tone[i - 1]) + Math.abs(tone[i + w] - tone[i - w]);
    odd[i] = Math.abs(tone[i] - wall) + busy * 1.5;
    if (odd[i] > top) top = odd[i];
  }
  if (top <= 0) return null;
  const cut = Math.max((high - low) * 0.09, top * 0.12);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < odd.length; i++) mask[i] = odd[i] > cut ? 1 : 0;
  // Join the brush strokes into one shape, then take the biggest piece.
  const joined = shrink(spread(mask, w, h, 3), w, h, 3);
  const piece = largestPiece(joined, w, h);
  if (!piece || piece.length < Math.max(60, count * 0.02) || piece.length > count * 0.92) return null;
  const quad = enclosingQuad(convexHull(piece.map(i => ({ x: (i % w + 0.5) * step, y: (Math.floor(i / w) + 0.5) * step }))));
  if (!quad) return null;
  let snapped: Point[] = quad;
  for (let pass = 0; pass < 4; pass++) snapped = snapToEdges(snapped, photo);
  return clockwiseFromTopLeft(snapped).map(p => ({ x: clamp01(p.x / photo.width), y: clamp01(p.y / photo.height) }));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function spread(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  let out = mask;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      next[i] = out[i] || (x > 0 && out[i - 1]) || (x < w - 1 && out[i + 1]) || (y > 0 && out[i - w]) || (y < h - 1 && out[i + w]) ? 1 : 0;
    }
    out = next;
  }
  return out;
}
function shrink(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  let out = mask;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      next[i] = out[i] && out[i - 1] && out[i + 1] && out[i - w] && out[i + w] ? 1 : 0;
    }
    out = next;
  }
  return out;
}
function largestPiece(mask: Uint8Array, w: number, h: number): number[] | null {
  const seen = new Uint8Array(w * h);
  let best: number[] | null = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const piece: number[] = [], stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      const x = i % w;
      for (const n of [i - 1, i + 1, i - w, i + w]) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;
        if ((n === i - 1 && x === 0) || (n === i + 1 && x === w - 1)) continue;
        seen[n] = 1; stack.push(n);
      }
    }
    if (!best || piece.length > best.length) best = piece;
  }
  return best;
}
export function clockwiseFromTopLeft<T extends Point>(quad: T[]): T[] {
  const cx = quad.reduce((t, p) => t + p.x, 0) / quad.length, cy = quad.reduce((t, p) => t + p.y, 0) / quad.length;
  const around = [...quad].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  for (let i = 1; i < around.length; i++) if (around[i].x + around[i].y < around[first].x + around[first].y) first = i;
  return around.map((_, i) => around[(first + i) % around.length]);
}

/** A sensible picture size for a painting whose corners are at `quad` in projector pixels. */
export function paintingSize(quad: Point[], longest = 1600): { width: number; height: number } {
  const side = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const across = (side(quad[0], quad[1]) + side(quad[3], quad[2])) / 2, down = (side(quad[0], quad[3]) + side(quad[1], quad[2])) / 2;
  const scale = longest / Math.max(across, down, 1);
  return { width: Math.max(8, Math.round(across * scale)), height: Math.max(8, Math.round(down * scale)) };
}

/**
 * The painting cut out of the photo, as the picture the desktop will pin to
 * `quad` (the painting's corners in projector pixels, TL TR BR BL).
 *
 * The desktop stretches a pinned picture between its corners bilinearly, not
 * in perspective. So this is not a plain perspective crop: every pixel of
 * the result asks "where will the desktop put me on the projector?" and
 * then "what does the photo show there?". That makes every point of the
 * picture, not just its corners, land on the same point of the painting.
 */
export function rectifyPainting(
  source: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  photoToProjector: number[],
  quad: Point[],
  size: { width: number; height: number },
): Uint8ClampedArray {
  const toPhoto = invertHomography(photoToProjector);
  const out = new Uint8ClampedArray(size.width * size.height * 4);
  const [tl, tr, br, bl] = quad;
  for (let y = 0; y < size.height; y++) {
    const v = (y + 0.5) / size.height;
    for (let x = 0; x < size.width; x++) {
      const u = (x + 0.5) / size.width;
      const px = (1 - v) * ((1 - u) * tl.x + u * tr.x) + v * ((1 - u) * bl.x + u * br.x);
      const py = (1 - v) * ((1 - u) * tl.y + u * tr.y) + v * ((1 - u) * bl.y + u * br.y);
      const p = applyHomography(toPhoto, px, py);
      // Bilinear sample of the photo, clamped at its edges.
      const fx = Math.max(0, Math.min(source.width - 1.001, p.x - 0.5)), fy = Math.max(0, Math.min(source.height - 1.001, p.y - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const i = (y0 * source.width + x0) * 4, o = (y * size.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = source.data[i + c], b = source.data[i + 4 + c], d = source.data[i + source.width * 4 + c], e = source.data[i + source.width * 4 + 4 + c];
        out[o + c] = (a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
