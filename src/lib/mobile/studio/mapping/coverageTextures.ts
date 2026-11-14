/**
 * GPU side of surface coverage: per surface that has a free-form outline or
 * masks, a single-channel coverage texture, plus (with a Look on) the edge
 * field the Look follows. Rebuilt only when the outline or masks change.
 *
 * A change is drawn at once from a small draft; the full-size textures are
 * built on a worker once the surface has stopped changing for a moment, so
 * neither dragging nor finishing an edit stalls the output.
 */
import type { Surface } from '../model';
import { cornerPoints } from './meshGrid';
import { contentOutline, isShape } from './surfaceShape';
import { buildCoverage, coverageSize, type CoverageJob, type CoverageResult, type GrayImage } from './coverage';
import { flattenPath } from './pathGeometry';
import { maskPath } from './masks';

const SETTLE_MS = 300;
const DRAFT_SIDE = 256;

type Entry = { key: string; coverage: WebGLTexture; field: WebGLTexture | null; perimeter: number; changed: number; draft: boolean; pending: string | null; seen: number };

/** Everything the coverage depends on, as a string, memoised per surface object. */
const keys = new WeakMap<Surface, string>();
function coverageKey(s: Surface): string {
  let key = keys.get(s);
  if (key !== undefined) return key;
  const masks = (s.masks ?? []).filter((m) => m.enabled);
  key = JSON.stringify([
    isShape(s) ? s.shape!.points : null,
    isShape(s) ? cornerPoints(s) : null,
    isShape(s) ? s.feather : 0,
    !!s.look?.enabled,
    masks.map((m) => [m.id, m.kind, m.op, m.invert, m.feather, m.points, m.ellipse, m.image ? [m.image.src.length, m.image.src.slice(-32), m.image.channel] : null]),
  ]);
  keys.set(s, key);
  return key;
}

/** Decode an image mask's picture into one channel, at most 512 px a side. Browser only. */
export async function decodeMaskImage(src: string, channel: 'alpha' | 'luma'): Promise<GrayImage> {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  await image.decode();
  const k = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight, 1));
  const width = Math.max(1, Math.round(image.naturalWidth * k)),
    height = Math.max(1, Math.round(image.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = channel === 'alpha' ? rgba[i * 4 + 3] : Math.round((0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) * (rgba[i * 4 + 3] / 255));
  }
  return { width, height, data };
}

export class CoverageTextures {
  private entries = new Map<string, Entry>();
  private images = new Map<string, GrayImage>();
  private loading = new Set<string>();
  private imageVersion = 0;
  private frame = 0;
  private worker: Worker | null = null;
  private workerFailed = false;
  constructor(private gl: WebGLRenderingContext) {}

  /** Call once per rendered frame before `get`. Drops textures of surfaces that went away. */
  begin() {
    this.frame++;
    if (this.frame % 120 === 0)
      for (const [id, e] of this.entries)
        if (this.frame - e.seen > 120) {
          this.release(e);
          this.entries.delete(id);
        }
  }

  private release(e: Entry) {
    this.gl.deleteTexture(e.coverage);
    if (e.field) this.gl.deleteTexture(e.field);
  }

  /** Image masks of this surface, decoded (and loading any that are not yet). */
  private imagesFor(s: Surface): [string, GrayImage][] {
    const out: [string, GrayImage][] = [];
    for (const m of s.masks ?? []) {
      if (m.kind !== 'image' || !m.image || !m.enabled) continue;
      const key = m.image.channel + ':' + m.image.src;
      const ready = this.images.get(key);
      if (ready) out.push([m.id, ready]);
      else if (!this.loading.has(key) && typeof Image !== 'undefined') {
        this.loading.add(key);
        decodeMaskImage(m.image.src, m.image.channel)
          .then((img) => {
            this.images.set(key, img);
            this.imageVersion++;
          })
          .catch(() => {})
          .finally(() => this.loading.delete(key));
      }
    }
    return out;
  }

  private job(s: Surface, key: string, width: number, height: number, side: number): CoverageJob {
    const shaped = isShape(s);
    const masks = s.masks?.filter((m) => m.enabled) ?? [];
    const xs = s.points.map((p) => p.x),
      ys = s.points.map((p) => p.y);
    const frameW = (Math.max(...xs) - Math.min(...xs)) * width,
      frameH = (Math.max(...ys) - Math.min(...ys)) * height;
    const size = coverageSize(frameW, frameH, side);
    const outline = shaped ? contentOutline(s) : null;
    let field: CoverageJob['field'] = null;
    if (s.look?.enabled) {
      // One outline to follow exactly: the shape's, or a single keeping mask's. Otherwise go by angle.
      const single = !shaped && masks.length === 1 && masks[0].kind !== 'image' && masks[0].op === 'add' && !masks[0].invert ? flattenPath(maskPath(masks[0]), 24) : null;
      const line = (shaped && !masks.length ? outline : single)?.map((p) => ({ x: p.x * size.width, y: p.y * size.height })) ?? null;
      field = { pixel: frameW / size.width, line };
    }
    return { key, width: size.width, height: size.height, outline, outlineFeather: shaped ? s.feather : 0, masks, images: this.imagesFor(s), field };
  }

  private upload(entry: Entry, r: CoverageResult) {
    const gl = this.gl;
    const put = (texture: WebGLTexture, format: number, w: number, h: number, data: Uint8Array) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, data);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    };
    put(entry.coverage, gl.LUMINANCE, r.width, r.height, r.coverage ?? new Uint8Array(r.width * r.height).fill(255));
    if (r.field) {
      entry.field ??= gl.createTexture()!;
      put(entry.field, gl.RGBA, r.field.width, r.field.height, r.field.data);
      entry.perimeter = r.field.perimeter;
    } else if (entry.field) {
      gl.deleteTexture(entry.field);
      entry.field = null;
    }
  }

  private startWorker(): Worker | null {
    if (this.worker || this.workerFailed || typeof Worker === 'undefined') return this.worker;
    try {
      this.worker = new Worker(new URL('./coverageWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<CoverageResult & { surface: string }>) => {
        const r = event.data;
        const entry = this.entries.get(r.surface);
        if (!entry || entry.pending !== r.key) return;
        entry.pending = null;
        if (entry.key !== r.key) return;
        this.upload(entry, r);
        entry.draft = false;
      };
      this.worker.onerror = () => {
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        for (const e of this.entries.values()) e.pending = null;
      };
    } catch {
      this.workerFailed = true;
      this.worker = null;
    }
    return this.worker;
  }

  /** The coverage texture of a surface, or null when nothing on it is cut. `width`/`height` are the output in pixels. */
  get(s: Surface, width: number, height: number, now = performance.now()): WebGLTexture | null {
    const shaped = isShape(s);
    if (!shaped && !s.masks?.some((m) => m.enabled)) return null;
    const key = coverageKey(s) + '|' + this.imageVersion;
    let entry = this.entries.get(s.id);
    if (!entry || entry.key !== key) {
      // Draw the change at once from a small draft; the full size follows when it settles.
      const draft = buildCoverage(this.job(s, key, width, height, DRAFT_SIDE));
      entry ??= { key, coverage: this.gl.createTexture()!, field: null, perimeter: 0, changed: now, draft: true, pending: null, seen: this.frame };
      this.entries.set(s.id, entry);
      entry.key = key;
      entry.changed = now;
      entry.draft = true;
      this.upload(entry, draft);
    } else if (entry.draft && !entry.pending && now - entry.changed > SETTLE_MS) {
      const job = this.job(s, key, width, height, 1536);
      const worker = this.startWorker();
      if (worker) {
        entry.pending = key;
        worker.postMessage({ ...job, surface: s.id });
      } else {
        this.upload(entry, buildCoverage(job));
        entry.draft = false;
      }
    }
    entry.seen = this.frame;
    return entry.coverage;
  }

  /** The edge field a Look follows on this surface (after `get`), or null to use the frame's edges. */
  field(s: Surface): { texture: WebGLTexture; perimeter: number } | null {
    const e = this.entries.get(s.id);
    return e?.field ? { texture: e.field, perimeter: e.perimeter } : null;
  }

  destroy() {
    for (const e of this.entries.values()) this.release(e);
    this.entries.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
