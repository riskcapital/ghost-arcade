/*
 * Chromium-rasterized SVG for the native SVG layer.
 *
 * The native path used to re-implement an SVG rasterizer inside one fragment
 * shader, which forced brutal caps (32 contours / 768 points — a third of a
 * real logo silently discarded) and reduced fidelity to a subset of a subset:
 * gradients became flat white, arcs became straight lines, <text>, masks and
 * patterns were unsupported, and "Original SVG" mode rendered nothing at all
 * for a typical dark logo.
 *
 * Chromium is sitting right here in the renderer process and rasterizes SVG
 * perfectly. So: draw the authored file into a canvas at the core's
 * source-frame slot resolution, hand the pixels to the core once per
 * source/size change (the same lifecycle the Text layer's glyph atlas uses),
 * and let the native shader sample the result. Fidelity is Chromium's problem,
 * which is to say solved.
 *
 * The raster is fitted into a SQUARE canvas (the core's slots are square) with
 * transparent letterboxing, using the same 0.78 margin the contour packer
 * applies — so shader-side geometry (outlines, glow, 3D) and the sampled
 * raster describe the same space. Pan / content-scale are deliberately NOT
 * baked in; the shader applies them to UVs so dragging a slider never forces a
 * re-rasterize + re-upload.
 */

export type SvgRaster = {
  /** Square edge in pixels — the core's source-frame slot size. */
  size: number;
  rgba: Uint8ClampedArray;
  /** Identity of (source, size); changes → re-upload. */
  signature: string;
};

/** Same margin the contour packer uses, so raster and geometry agree. */
export const SVG_RASTER_FIT = 0.78;

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function svgRasterSignature(
  svgSource: string,
  size: number,
  outputWidth: number,
  outputHeight: number,
): string {
  return `${size}:${outputWidth}x${outputHeight}:${svgSource.length}:${hashString(svgSource)}`;
}

/**
 * The SVG's intrinsic box, for the fit transform.
 *
 * viewBox wins; explicit width/height attributes are the fallback. Files with
 * neither get a 100×100 box, which Chromium also assumes — wrong size but not
 * a blank render.
 */
function intrinsicBox(svgSource: string): { width: number; height: number } {
  const viewBox = svgSource.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/);
  if (viewBox) {
    const width = Number(viewBox[3]);
    const height = Number(viewBox[4]);
    if (width > 0 && height > 0) return { width, height };
  }
  const widthAttr = svgSource.match(/<svg[^>]*\swidth\s*=\s*["']?([\d.]+)/i);
  const heightAttr = svgSource.match(/<svg[^>]*\sheight\s*=\s*["']?([\d.]+)/i);
  const width = Number(widthAttr?.[1]);
  const height = Number(heightAttr?.[1]);
  if (width > 0 && height > 0) return { width, height };
  return { width: 100, height: 100 };
}

/**
 * Rasterize `svgSource` into a size×size RGBA square, artwork centred with the
 * standard fit margin.
 *
 * Rejects only when the blob refuses to decode at all (malformed XML). An SVG
 * with no drawable content resolves to transparent pixels, which renders as an
 * empty layer rather than an error — matching what a browser shows for it.
 */
export async function rasterizeSvg(
  svgSource: string,
  size: number,
  outputWidth: number,
  outputHeight: number,
): Promise<SvgRaster> {
  const edge = Math.max(64, Math.round(size));
  const box = intrinsicBox(svgSource);

  /*
   * An <svg> without width/height decodes to 0×0 in some Chromium paths and
   * drawImage of a 0×0 image throws. Force explicit dimensions from the
   * intrinsic box before decoding — a plain attribute injection on the root
   * tag, everything else untouched.
   */
  let source = svgSource;
  const rootTag = source.match(/<svg\b[^>]*>/i)?.[0];
  if (rootTag) {
    let patched = rootTag;
    if (!/\swidth\s*=/i.test(patched)) patched = patched.replace(/<svg/i, `<svg width="${box.width}"`);
    if (!/\sheight\s*=/i.test(patched)) patched = patched.replace(/<svg/i, `<svg height="${box.height}"`);
    if (patched !== rootTag) source = source.replace(rootTag, patched);
  }

  const blob = new Blob([source], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG failed to decode'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2d context unavailable');
    /*
     * Fit in OUTPUT space, then map into the square slot.
     *
     * The core's slots are square and the compositor stretches them across
     * the project-aspect quad, so a square drawn square in the slot shows up
     * 16:9-wide on screen (measured: a 100x100 calibration SVG rendered
     * 1348x741). Fitting against the real output dimensions and compressing
     * each axis by slot/output makes the stretch land back on true
     * proportions -- and matches the contour path, which works in output
     * pixels and was measured screen-true.
     */
    const outW = Math.max(1, outputWidth);
    const outH = Math.max(1, outputHeight);
    const scale = Math.min(outW / box.width, outH / box.height) * SVG_RASTER_FIT;
    const drawWidth = box.width * scale * (edge / outW);
    const drawHeight = box.height * scale * (edge / outH);
    context.clearRect(0, 0, edge, edge);
    context.drawImage(image, (edge - drawWidth) / 2, (edge - drawHeight) / 2, drawWidth, drawHeight);
    return {
      size: edge,
      rgba: context.getImageData(0, 0, edge, edge).data,
      signature: svgRasterSignature(svgSource, edge, outW, outH),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
