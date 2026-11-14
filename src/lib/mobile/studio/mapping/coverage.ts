/**
 * Where a surface shows its picture: one coverage value per pixel of its
 * content (0–255, row 0 at the top), from a free-form outline and masks.
 *
 * Rasterised on the CPU, only when the outline or masks change: polygons
 * with anti-aliased edges (four sub-rows, exact coverage across each row),
 * an exact distance transform for inward feathering, and image masks read
 * from a decoded single-channel picture. Pure TypeScript, so it is tested
 * without a browser.
 */
import type { Point } from '../model';
import { flattenPath } from './pathGeometry';
import { maskPath, type SurfaceMask } from './masks';

/** A decoded image mask: one value 0–255 per pixel. */
export type GrayImage = { width: number; height: number; data: Uint8Array };

export type CoverageInput = {
  /** A free-form outline already in content space (flattened), or none. */
  outline?: Point[] | null;
  /** Inward softness of that outline, as a share of the shorter side. */
  outlineFeather?: number;
  masks?: SurfaceMask[];
  /** Decoded pictures of image masks, by mask id. A missing one is skipped until it arrives. */
  images?: Map<string, GrayImage>;
};

/** True when there is anything to cut: without it the surface draws as it always has. */
export function needsCoverage(input: CoverageInput): boolean {
  return !!(input.outline && input.outline.length >= 3) || !!input.masks?.some((m) => m.enabled);
}

/** Texture size for content shown `w`×`h` output pixels big: same shape, longest side at most `max`, width a multiple of 4. */
export function coverageSize(w: number, h: number, max = 1536): { width: number; height: number } {
  const W = Math.max(1, Number.isFinite(w) ? w : 1),
    H = Math.max(1, Number.isFinite(h) ? h : 1);
  const k = Math.min(1, max / Math.max(W, H));
  const width = Math.max(16, Math.round((W * k) / 4) * 4);
  const height = Math.max(16, Math.round(H * k));
  return { width, height };
}

/** Anti-aliased non-zero fill of a polygon given in pixels. Adds coverage (0–1) into `out`. */
export function fillPolygon(poly: Point[], width: number, height: number, out: Float32Array) {
  const n = poly.length;
  if (n < 3) return;
  const SUB = 4;
  const diff = new Float32Array(width + 1);
  const crossings: { x: number; d: number }[] = [];
  let minY = Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const rowStart = Math.max(0, Math.floor(minY)),
    rowEnd = Math.min(height - 1, Math.ceil(maxY));
  const add = (row: number, xa: number, xb: number, w: number) => {
    xa = Math.max(0, Math.min(width, xa));
    xb = Math.max(0, Math.min(width, xb));
    if (xb <= xa) return;
    const ia = Math.floor(xa),
      ib = Math.floor(xb);
    const base = row * width;
    if (ia === ib) {
      if (ia < width) out[base + ia] += (xb - xa) * w;
      return;
    }
    out[base + ia] += (ia + 1 - xa) * w;
    if (ib < width) out[base + ib] += (xb - ib) * w;
    diff[ia + 1] += w;
    diff[ib] -= w;
  };
  for (let row = rowStart; row <= rowEnd; row++) {
    diff.fill(0);
    let touched = false;
    for (let s = 0; s < SUB; s++) {
      const y = row + (s + 0.5) / SUB;
      crossings.length = 0;
      for (let i = 0; i < n; i++) {
        const a = poly[i],
          b = poly[(i + 1) % n];
        if (a.y === b.y) continue;
        const up = a.y < b.y;
        const y0 = up ? a.y : b.y,
          y1 = up ? b.y : a.y;
        if (y < y0 || y >= y1) continue;
        const t = (y - a.y) / (b.y - a.y);
        crossings.push({ x: a.x + (b.x - a.x) * t, d: up ? 1 : -1 });
      }
      if (crossings.length < 2) continue;
      crossings.sort((p, q) => p.x - q.x);
      let winding = 0;
      for (let k = 0; k < crossings.length - 1; k++) {
        winding += crossings[k].d;
        if (winding !== 0) {
          add(row, crossings[k].x, crossings[k + 1].x, 1 / SUB);
          touched = true;
        }
      }
    }
    if (!touched) continue;
    let run = 0;
    const base = row * width;
    for (let x = 0; x < width; x++) {
      run += diff[x];
      if (run) out[base + x] += run;
    }
  }
}

/** Squared Euclidean distance transform along one line (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance in pixels from every inside pixel to the nearest outside pixel (0 outside). The texture border is not an edge. */
export function insideDistance(inside: Uint8Array, width: number, height: number): Float32Array {
  const BIG = 1e20;
  const grid = new Float32Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = inside[i] ? BIG : 0;
  const n = Math.max(width, height);
  const f = new Float32Array(n),
    d = new Float32Array(n),
    z = new Float32Array(n + 1),
    v = new Int32Array(n);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }
  for (let i = 0; i < grid.length; i++) grid[i] = grid[i] >= BIG / 2 ? Infinity : Math.sqrt(grid[i]);
  return grid;
}

/**
 * Ramp coverage inward over `radius` pixels from its edge. A wide ramp is
 * smooth anyway, so its distances are measured on a coarser grid (a step
 * of at most a third of the ramp) and the crisp edge is kept from `cov`.
 */
export function featherInward(cov: Float32Array, width: number, height: number, radius: number) {
  if (!(radius >= 1)) return;
  const k = Math.max(1, Math.min(8, Math.floor(radius / 3)));
  const w = Math.ceil(width / k),
    h = Math.ceil(height / k);
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // A coarse cell is inside only when all of it is: the ramp never starts outside the line.
      let all = 1;
      for (let yy = y * k; yy < Math.min(height, (y + 1) * k) && all; yy++)
        for (let xx = x * k; xx < Math.min(width, (x + 1) * k); xx++)
          if (cov[yy * width + xx] < 0.5) {
            all = 0;
            break;
          }
      inside[y * w + x] = all;
    }
  const dist = insideDistance(inside, w, h);
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) / k - 0.5));
    const y0 = Math.floor(fy),
      y1 = Math.min(h - 1, y0 + 1),
      ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (cov[i] <= 0) continue;
      const fx = Math.max(0, Math.min(w - 1, (x + 0.5) / k - 0.5));
      const x0 = Math.floor(fx),
        x1 = Math.min(w - 1, x0 + 1),
        tx = fx - x0;
      const a = Math.min(dist[y0 * w + x0], 1e6),
        b = Math.min(dist[y0 * w + x1], 1e6),
        c = Math.min(dist[y1 * w + x0], 1e6),
        d = Math.min(dist[y1 * w + x1], 1e6);
      // Distances on the coarse grid count from cell centres: add back half a cell.
      const cells = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      const px = k === 1 ? cells : cells * k + (cells > 0 ? k / 2 : 0);
      const t = Math.min(1, Math.max(0, px / radius));
      cov[i] = Math.min(cov[i], t * t * (3 - 2 * t));
    }
  }
}

/** Halve a coverage map (box filter), for the Look field. */
export function halve(coverage: Uint8Array, width: number, height: number): { data: Uint8Array; width: number; height: number } {
  const w = Math.max(1, Math.ceil(width / 2)),
    h = Math.max(1, Math.ceil(height / 2));
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0,
        n = 0;
      for (let yy = y * 2; yy < Math.min(height, y * 2 + 2); yy++)
        for (let xx = x * 2; xx < Math.min(width, x * 2 + 2); xx++) {
          sum += coverage[yy * width + xx];
          n++;
        }
      data[y * w + x] = Math.round(sum / n);
    }
  return { data, width: w, height: h };
}

function sampleImage(img: GrayImage, u: number, v: number): number {
  const x = Math.max(0, Math.min(img.width - 1, u * img.width - 0.5)),
    y = Math.max(0, Math.min(img.height - 1, v * img.height - 0.5));
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const x1 = Math.min(img.width - 1, x0 + 1),
    y1 = Math.min(img.height - 1, y0 + 1);
  const fx = x - x0,
    fy = y - y0;
  const at = (xx: number, yy: number) => img.data[yy * img.width + xx];
  return ((at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy) / 255;
}

/** One shape (polygon or picture) as coverage 0–1 over the whole content. */
function shapeCoverage(poly: Point[] | null, image: GrayImage | null, width: number, height: number): Float32Array {
  const cov = new Float32Array(width * height);
  if (poly) fillPolygon(poly.map((p) => ({ x: p.x * width, y: p.y * height })), width, height, cov);
  else if (image) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cov[y * width + x] = sampleImage(image, (x + 0.5) / width, (y + 0.5) / height);
  }
  for (let i = 0; i < cov.length; i++) cov[i] = Math.min(1, cov[i]);
  return cov;
}

/**
 * The surface's coverage at `width`×`height`, or null when nothing is cut
 * (the renderer then skips the lookup entirely).
 */
export function rasterizeCoverage(input: CoverageInput, width: number, height: number): Uint8Array | null {
  if (!needsCoverage(input)) return null;
  const short = Math.min(width, height);
  let base: Float32Array | null = null;
  if (input.outline && input.outline.length >= 3) {
    base = shapeCoverage(input.outline, null, width, height);
    featherInward(base, width, height, (input.outlineFeather ?? 0) * short);
  }
  const masks = (input.masks ?? []).filter((m) => m.enabled);
  let acc: Float32Array | null = null;
  if (masks.length) {
    const adds = masks.some((m) => m.op === 'add');
    acc = new Float32Array(width * height).fill(adds ? 0 : 1);
    for (const m of masks) {
      const image = m.kind === 'image' ? input.images?.get(m.id) ?? null : null;
      if (m.kind === 'image' && !image) continue;
      const poly = m.kind === 'image' ? null : flattenPath(maskPath(m), 24);
      const cov = shapeCoverage(poly, image, width, height);
      if (m.invert) for (let i = 0; i < cov.length; i++) cov[i] = 1 - cov[i];
      featherInward(cov, width, height, m.feather * short);
      if (m.op === 'add') for (let i = 0; i < cov.length; i++) acc[i] = Math.max(acc[i], cov[i]);
      else for (let i = 0; i < cov.length; i++) acc[i] *= 1 - cov[i];
    }
  }
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const v = (base ? base[i] : 1) * (acc ? acc[i] : 1);
    out[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  return out;
}

// ── The edge field Looks draw with ─────────────────────────────────────────

/** Squared distance transform along one line that also says where each nearest site is. */
function edt1dArg(f: Float32Array, n: number, d: Float32Array, arg: Int32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    arg[q] = v[k];
  }
}

/** Largest inward distance the field stores, in output pixels. */
export const FIELD_MAX_PX = 256;

/**
 * What a Look needs to follow an outline that is not the surface's frame:
 * per pixel, how much shows (R), how far inside the visible edge it is in
 * output pixels (G, square-root coded up to FIELD_MAX_PX), and where along
 * the edge its nearest point is, 0–1 (B high byte, A low byte). The frame's
 * own border counts as an edge too. `pixel` is output pixels per texel;
 * `outline` (texels) gives exact positions along a single outline, else the
 * position is the angle around the visible area's centre.
 */
export function edgeField(coverage: Uint8Array, width: number, height: number, pixel: number, outline: Point[] | null): { data: Uint8Array; perimeter: number } {
  // Pad by one texel of outside so the border is an edge.
  const W = width + 2,
    H = height + 2;
  const BIG = 1e20;
  const grid = new Float32Array(W * H);
  let cx = 0,
    cy = 0,
    mass = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inside = x > 0 && y > 0 && x <= width && y <= height && coverage[(y - 1) * width + (x - 1)] >= 128;
      grid[y * W + x] = inside ? BIG : 0;
      if (inside) {
        cx += x;
        cy += y;
        mass++;
      }
    }
  cx /= Math.max(1, mass);
  cy /= Math.max(1, mass);
  const n = Math.max(W, H);
  const f = new Float32Array(n),
    d = new Float32Array(n),
    z = new Float32Array(n + 1),
    v = new Int32Array(n),
    arg = new Int32Array(n);
  const rowOf = new Int32Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1dArg(f, H, d, arg, v, z);
    for (let y = 0; y < H; y++) {
      grid[y * W + x] = d[y];
      rowOf[y * W + x] = arg[y];
    }
  }
  const site = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1dArg(f, W, d, arg, v, z);
    for (let x = 0; x < W; x++) {
      grid[y * W + x] = d[x];
      const sx = arg[x];
      site[y * W + x] = rowOf[y * W + sx] * W + sx;
    }
  }
  // Position along the edge for each site that is used.
  let perimeter = 0;
  const lengths: number[] = [];
  if (outline && outline.length >= 3) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      lengths.push(perimeter);
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  const cache = new Map<number, number>();
  const along = (s: number): number => {
    let t = cache.get(s);
    if (t !== undefined) return t;
    const px = (s % W) - 1 + 0.5,
      py = Math.floor(s / W) - 1 + 0.5;
    if (outline && perimeter > 0) {
      let best = Infinity;
      t = 0;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i],
          b = outline[(i + 1) % outline.length];
        const ex = b.x - a.x,
          ey = b.y - a.y;
        const len2 = ex * ex + ey * ey || 1e-9;
        const u = Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / len2));
        const dist = Math.hypot(px - (a.x + ex * u), py - (a.y + ey * u));
        if (dist < best) {
          best = dist;
          t = (lengths[i] + u * Math.sqrt(len2)) / perimeter;
        }
      }
    } else t = (Math.atan2(py + 1 - cy, px + 1 - cx) / (Math.PI * 2) + 1.25) % 1;
    cache.set(s, t);
    return t;
  };
  if (!(outline && perimeter > 0)) {
    // Perimeter of the visible area: edge texels counted once.
    let edges = 0;
    for (let y = 1; y <= height; y++)
      for (let x = 1; x <= width; x++)
        if (grid[y * W + x] > 0 && grid[y * W + x] < 1.5) edges++;
    perimeter = edges;
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        g = (y + 1) * W + (x + 1);
      const c = coverage[i];
      data[i * 4] = c;
      if (c < 128) continue;
      const dist = Math.min(FIELD_MAX_PX, Math.sqrt(grid[g]) * pixel);
      data[i * 4 + 1] = Math.round(Math.sqrt(dist / FIELD_MAX_PX) * 255);
      const t = Math.round(along(site[g]) * 65535);
      data[i * 4 + 2] = t >> 8;
      data[i * 4 + 3] = t & 255;
    }
  return { data, perimeter: perimeter * pixel };
}

// ── One surface's textures, built in one go (on a worker when there is one) ──

export type CoverageJob = {
  key: string;
  width: number;
  height: number;
  outline: Point[] | null;
  outlineFeather: number;
  masks: SurfaceMask[];
  images: [string, GrayImage][];
  /** Build the Look field too: output pixels per coverage texel, and the outline to measure along (texels). */
  field: { pixel: number; line: Point[] | null } | null;
};
export type CoverageResult = {
  key: string;
  width: number;
  height: number;
  coverage: Uint8Array | null;
  field: { data: Uint8Array; width: number; height: number; perimeter: number } | null;
};

/** Coverage at full size and, when asked, the Look field at half size. */
export function buildCoverage(job: CoverageJob): CoverageResult {
  const coverage = rasterizeCoverage({ outline: job.outline, outlineFeather: job.outlineFeather, masks: job.masks, images: new Map(job.images) }, job.width, job.height);
  let field: CoverageResult['field'] = null;
  if (job.field && coverage) {
    const half = halve(coverage, job.width, job.height);
    const line = job.field.line?.map((p) => ({ x: p.x / 2, y: p.y / 2 })) ?? null;
    const built = edgeField(half.data, half.width, half.height, job.field.pixel * 2, line);
    field = { data: built.data, width: half.width, height: half.height, perimeter: built.perimeter };
  }
  return { key: job.key, width: job.width, height: job.height, coverage, field };
}
