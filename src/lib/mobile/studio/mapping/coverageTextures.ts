/**
 * GPU side of surface coverage: one single-channel texture per surface that
 * has a free-form outline or masks, rebuilt only when they change.
 *
 * While a surface is being edited (it changed within the last few hundred
 * milliseconds) the texture is rebuilt at a small draft size so dragging
 * stays smooth; once it settles it is rebuilt at full size.
 */
import type { Surface } from '../model';
import { cornerPoints } from './meshGrid';
import { contentOutline, isShape } from './surfaceShape';
import { coverageSize, needsCoverage, rasterizeCoverage, type GrayImage } from './coverage';

const SETTLE_MS = 350;
const DRAFT_SIDE = 320;

type Entry = { key: string; texture: WebGLTexture; changed: number; draft: boolean; seen: number; empty: boolean };

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
  constructor(private gl: WebGLRenderingContext) {}

  /** Call once per rendered frame before `get`. Drops textures of surfaces that went away. */
  begin() {
    this.frame++;
    if (this.frame % 120 === 0)
      for (const [id, e] of this.entries)
        if (this.frame - e.seen > 120) {
          this.gl.deleteTexture(e.texture);
          this.entries.delete(id);
        }
  }

  /** Image masks of this surface, decoded by mask id (and loading any that are not yet). */
  private imagesFor(s: Surface): Map<string, GrayImage> {
    const out = new Map<string, GrayImage>();
    for (const m of s.masks ?? []) {
      if (m.kind !== 'image' || !m.image || !m.enabled) continue;
      const key = m.image.channel + ':' + m.image.src;
      const ready = this.images.get(key);
      if (ready) out.set(m.id, ready);
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

  /** The coverage texture of a surface, or null when nothing on it is cut. `width`/`height` are the output in pixels. */
  get(s: Surface, width: number, height: number, now = performance.now()): WebGLTexture | null {
    const shaped = isShape(s);
    const masks = s.masks?.filter((m) => m.enabled) ?? [];
    if (!shaped && !masks.length) return null;
    const key = coverageKey(s) + '|' + this.imageVersion;
    let entry = this.entries.get(s.id);
    const changed = !entry || entry.key !== key;
    const settle = !!entry && !changed && entry.draft && now - entry.changed > SETTLE_MS;
    if (changed || settle) {
      const editing = !!entry && changed && now - entry.changed < SETTLE_MS;
      const xs = s.points.map((p) => p.x),
        ys = s.points.map((p) => p.y);
      const full = coverageSize((Math.max(...xs) - Math.min(...xs)) * width, (Math.max(...ys) - Math.min(...ys)) * height);
      const size = editing ? coverageSize(full.width, full.height, DRAFT_SIDE) : full;
      const outline = shaped ? contentOutline(s) : null;
      const data = needsCoverage({ outline, masks }) ? rasterizeCoverage({ outline, outlineFeather: shaped ? s.feather : 0, masks, images: this.imagesFor(s) }, size.width, size.height) : null;
      const gl = this.gl;
      const texture = entry?.texture ?? gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, size.width, size.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data ?? new Uint8Array(size.width * size.height).fill(255));
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      entry = { key, texture, changed: changed ? now : entry!.changed, draft: editing, seen: this.frame, empty: !data };
      this.entries.set(s.id, entry);
    }
    entry!.seen = this.frame;
    return entry!.texture;
  }

  destroy() {
    for (const e of this.entries.values()) this.gl.deleteTexture(e.texture);
    this.entries.clear();
  }
}
