// Cuts a picture into the patches of colour it is made of, the way a tracing tool does, and
// returns each patch as an outline. Low detail gives a few broad shapes; high detail gives
// hundreds of small ones. Neighbouring outlines share their borders exactly, so the shapes
// tile the picture without gaps.

export type TracedShape = {
  /** Outline in picture space: x and y from 0 to 1, y down. */
  points: { x: number; y: number }[];
  /** Average colour of the patch, 0-255. */
  color: [number, number, number];
  /** Share of the picture the patch covers, 0-1. */
  area: number;
};

export type TraceOptions = {
  /** 0 = broad shapes, 1 = many detailed shapes. */
  detail: number;
  /** Never return more shapes than this; the smallest are merged into neighbours first. */
  maxShapes?: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Working size for a picture: detail decides how finely it is looked at. */
export function traceSize(width: number, height: number, detail: number): { width: number; height: number } {
  const longest = Math.round(lerp(96, 300, clamp01(detail)));
  const scale = Math.min(1, longest / Math.max(width, height));
  return { width: Math.max(8, Math.round(width * scale)), height: Math.max(8, Math.round(height * scale)) };
}

/** Box-averaged copy of an RGBA picture at a smaller size, as three float planes. */
function shrink(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, w: number, h: number): Float32Array[] {
  const planes = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor((y * height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor((x * width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy += 1) for (let sx = x0; sx < x1; sx += 1) {
        const o = (sy * width + sx) * 4;
        r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n += 1;
      }
      const i = y * w + x;
      planes[0][i] = r / n; planes[1][i] = g / n; planes[2][i] = b / n;
    }
  }
  return planes;
}

/** Smooths brush texture and photo noise without softening the borders between colours:
 *  each pixel is averaged only with neighbours that are already close to it. */
function soften(planes: Float32Array[], w: number, h: number): Float32Array[] {
  const out = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x;
    const r0 = planes[0][i], g0 = planes[1][i], b0 = planes[2][i];
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        const k = yy * w + xx;
        if (Math.abs(planes[0][k] - r0) + Math.abs(planes[1][k] - g0) + Math.abs(planes[2][k] - b0) > 60) continue;
        r += planes[0][k]; g += planes[1][k]; b += planes[2][k]; n += 1;
      }
    }
    out[0][i] = r / n; out[1][i] = g / n; out[2][i] = b / n;
  }
  return out;
}

class Groups {
  parent: Int32Array; size: Int32Array; inner: Float32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n); this.size = new Int32Array(n).fill(1); this.inner = new Float32Array(n);
    for (let i = 0; i < n; i += 1) this.parent[i] = i;
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== root) { const next = this.parent[i]; this.parent[i] = root; i = next; }
    return root;
  }
  join(a: number, b: number, weight: number): number {
    if (this.size[a] < this.size[b]) { const t = a; a = b; b = t; }
    this.parent[b] = a; this.size[a] += this.size[b]; this.inner[a] = Math.max(this.inner[a], this.inner[b], weight);
    return a;
  }
}

/**
 * Labels every pixel of a w x h picture with the patch it belongs to. Patches grow by joining
 * neighbours whose colours are closer than the variation already inside them (Felzenszwalb and
 * Huttenlocher's graph segmentation), then anything under `minSize` joins its closest neighbour.
 */
export function labelPatches(planes: Float32Array[], w: number, h: number, coarseness: number, minSize: number, maxShapes = Infinity): { labels: Int32Array; count: number } {
  const n = w * h;
  const edgeCount = (w - 1) * h + w * (h - 1);
  const from = new Int32Array(edgeCount), to = new Int32Array(edgeCount), weight = new Float32Array(edgeCount);
  let e = 0;
  const distance = (a: number, b: number) => {
    const dr = planes[0][a] - planes[0][b], dg = planes[1][a] - planes[1][b], db = planes[2][a] - planes[2][b];
    return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.5 + db * db * 0.2);
  };
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x;
    if (x + 1 < w) { from[e] = i; to[e] = i + 1; weight[e] = distance(i, i + 1); e += 1; }
    if (y + 1 < h) { from[e] = i; to[e] = i + w; weight[e] = distance(i, i + w); e += 1; }
  }
  const order = new Int32Array(edgeCount);
  for (let i = 0; i < edgeCount; i += 1) order[i] = i;
  order.sort((a, b) => weight[a] - weight[b]);
  const groups = new Groups(n);
  let count = n;
  for (let k = 0; k < edgeCount; k += 1) {
    const i = order[k];
    const a = groups.find(from[i]), b = groups.find(to[i]);
    if (a === b) continue;
    const limit = Math.min(groups.inner[a] + coarseness / groups.size[a], groups.inner[b] + coarseness / groups.size[b]);
    if (weight[i] <= limit) { groups.join(a, b, weight[i]); count -= 1; }
  }
  // Small patches join the neighbour they most resemble; then, if there are still too many,
  // the size they must reach keeps rising until the count fits.
  let floor = Math.max(1, minSize);
  for (let round = 0; round < 24; round += 1) {
    for (let k = 0; k < edgeCount; k += 1) {
      const i = order[k];
      const a = groups.find(from[i]), b = groups.find(to[i]);
      if (a !== b && (groups.size[a] < floor || groups.size[b] < floor)) { groups.join(a, b, weight[i]); count -= 1; }
    }
    if (count <= maxShapes) break;
    floor = Math.ceil(floor * 1.5) + 1;
  }
  // A patch only a pixel or two thick is the blend along a border, not a shape: it joins a side.
  const border = new Int32Array(n);
  for (let i = 0; i < edgeCount; i += 1) {
    const a = groups.find(from[i]), b = groups.find(to[i]);
    if (a !== b) { border[a] += 1; border[b] += 1; }
  }
  const sliver = (root: number) => groups.size[root] < border[root] * 1.1;
  for (let k = 0; k < edgeCount; k += 1) {
    const i = order[k];
    const a = groups.find(from[i]), b = groups.find(to[i]);
    if (a === b || !(sliver(a) || sliver(b))) continue;
    const kept = groups.join(a, b, weight[i]);
    border[kept] = 0; // now part of a real shape
  }
  const labels = new Int32Array(n);
  const names = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const root = groups.find(i);
    let name = names.get(root);
    if (name === undefined) { name = names.size; names.set(root, name); }
    labels[i] = name;
  }
  return { labels, count: names.size };
}

type Point = { x: number; y: number };

/** Drops points that sit within `tolerance` of the line between the points kept (Douglas-Peucker). */
function thin(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a].x, ay = points[a].y, dx = points[b].x - ax, dy = points[b].y - ay;
    const length = Math.hypot(dx, dy);
    let worst = -1, far = tolerance;
    for (let i = a + 1; i < b; i += 1) {
      const d = length < 1e-9 ? Math.hypot(points[i].x - ax, points[i].y - ay) : Math.abs((points[i].x - ax) * dy - (points[i].y - ay) * dx) / length;
      if (d > far) { far = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const ringArea = (ring: Point[]) => {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) { const a = ring[i], b = ring[(i + 1) % ring.length]; sum += a.x * b.y - b.x * a.y; }
  return sum / 2;
};

/**
 * Outlines of labelled patches on the pixel-corner grid. A corner where three or more patches
 * (or the picture's edge) meet is kept fixed, and each stretch of border between two such
 * corners is thinned on its own, in a direction that does not depend on which side asks. Two
 * neighbours therefore get the very same border.
 */
export function outlinePatches(labels: Int32Array, w: number, h: number, count: number, tolerance: number): Point[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : labels[y * w + x]);
  const cw = w + 1;
  const fixed = new Uint8Array(cw * (h + 1));
  for (let y = 0; y <= h; y += 1) for (let x = 0; x <= w; x += 1) {
    const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x - 1, y), d = at(x, y);
    let kinds = 1;
    if (b !== a) kinds += 1;
    if (c !== a && c !== b) kinds += 1;
    if (d !== a && d !== b && d !== c) kinds += 1;
    // Diagonal pairs (a checker corner) pin the corner too, so a border never has to choose a way through.
    if (kinds >= 3 || (a === d && b === c && a !== b)) fixed[y * cw + x] = 1;
  }
  // Directed border steps for every patch, the patch always on the right-hand side.
  const next: Map<number, number[]>[] = Array.from({ length: count }, () => new Map());
  const add = (label: number, x0: number, y0: number, x1: number, y1: number) => {
    const key = y0 * cw + x0, list = next[label].get(key);
    if (list) list.push(y1 * cw + x1); else next[label].set(key, [y1 * cw + x1]);
  };
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const label = labels[y * w + x];
    if (at(x, y - 1) !== label) add(label, x, y, x + 1, y);
    if (at(x + 1, y) !== label) add(label, x + 1, y, x + 1, y + 1);
    if (at(x, y + 1) !== label) add(label, x + 1, y + 1, x, y + 1);
    if (at(x - 1, y) !== label) add(label, x, y + 1, x, y);
  }
  const outlines: Point[][] = [];
  for (let label = 0; label < count; label += 1) {
    const steps = next[label];
    let best: number[] = [], bestArea = 0;
    for (const start of [...steps.keys()]) {
      while ((steps.get(start)?.length ?? 0) > 0) {
        const ring: number[] = [start];
        let here = start;
        for (let guard = 0; guard < (w + 1) * (h + 1) * 4; guard += 1) {
          const options = steps.get(here);
          if (!options || options.length === 0) break;
          const to = options.pop()!;
          if (to === start) break;
          ring.push(to); here = to;
        }
        const area = Math.abs(ringArea(ring.map(k => ({ x: k % cw, y: Math.floor(k / cw) }))));
        if (area > bestArea) { bestArea = area; best = ring; }
      }
    }
    if (best.length < 4) { outlines.push([]); continue; }
    // Start the ring at a fixed corner when it has one, then thin each stretch between fixed corners.
    let first = best.findIndex(k => fixed[k] === 1);
    const ring = first > 0 ? [...best.slice(first), ...best.slice(0, first)] : best;
    const pts = ring.map(k => ({ x: k % cw, y: Math.floor(k / cw) }));
    const result: Point[] = [];
    if (first < 0) {
      // An island touching nothing else: pin its two most distant points instead.
      let far = 0;
      for (let i = 1; i < pts.length; i += 1) if (Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y) > Math.hypot(pts[far].x - pts[0].x, pts[far].y - pts[0].y)) far = i;
      result.push(...stretch(pts.slice(0, far + 1), tolerance).slice(0, -1), ...stretch([...pts.slice(far), pts[0]], tolerance).slice(0, -1));
    } else {
      let from = 0;
      for (let i = 1; i <= pts.length; i += 1) {
        const k = ring[i % ring.length];
        if (fixed[k] === 1 || i === pts.length) {
          const run = [...pts.slice(from, i), pts[i % pts.length]];
          result.push(...stretch(run, tolerance).slice(0, -1));
          from = i;
        }
      }
    }
    outlines.push(result.length >= 3 ? result : []);
  }
  return outlines;
}

/** Thins one stretch of border the same way whichever end it is walked from. */
function stretch(run: Point[], tolerance: number): Point[] {
  const a = run[0], b = run[run.length - 1];
  const forward = a.y < b.y || (a.y === b.y && a.x <= b.x);
  if (forward) return thin(run, tolerance);
  return thin(run.slice().reverse(), tolerance).reverse();
}

/** Cuts an RGBA picture into outlined patches of colour. Largest first. */
export function traceShapes(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, options: TraceOptions): TracedShape[] {
  const detail = clamp01(options.detail);
  const { width: w, height: h } = traceSize(width, height, detail);
  const planes = soften(shrink(rgba, width, height, w, h), w, h);
  const pixels = w * h;
  // Detail lowers both how alike neighbours must be to join and how small a shape may be.
  const coarseness = lerp(2600, 110, Math.pow(detail, 0.7));
  const minSize = Math.max(6, Math.round(pixels * lerp(0.02, 0.0004, Math.pow(detail, 0.6))));
  const { labels, count } = labelPatches(planes, w, h, coarseness, minSize, options.maxShapes ?? 600);
  const outlines = outlinePatches(labels, w, h, count, lerp(1.5, 0.75, detail));
  const sums = new Float64Array(count * 4);
  for (let i = 0; i < pixels; i += 1) {
    const o = labels[i] * 4;
    sums[o] += planes[0][i]; sums[o + 1] += planes[1][i]; sums[o + 2] += planes[2][i]; sums[o + 3] += 1;
  }
  const shapes: TracedShape[] = [];
  for (let label = 0; label < count; label += 1) {
    const ring = outlines[label];
    if (ring.length < 3) continue;
    const o = label * 4, n = Math.max(1, sums[o + 3]);
    shapes.push({
      points: ring.map(p => ({ x: p.x / w, y: p.y / h })),
      color: [Math.round(sums[o] / n), Math.round(sums[o + 1] / n), Math.round(sums[o + 2] / n)],
      area: sums[o + 3] / pixels,
    });
  }
  return shapes.sort((a, b) => b.area - a.area);
}
