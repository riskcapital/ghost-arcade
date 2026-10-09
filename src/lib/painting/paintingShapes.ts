// Places the shapes traced from a painting's photo onto the painting itself: each shape
// becomes a custom-shape mapping layer, grouped as a Stage so Stage effects can chase
// across them.
import { get } from 'svelte/store';
import type { TracedShape } from './vectorize';

export type Corners = { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } };

/** A point of the photo (0-1, y down) on the composition (0-1, y up), through the layer's corner pin. */
export function onComposition(corners: Corners, u: number, v: number): { x: number; y: number } {
  const top = { x: corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * u, y: corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * u };
  const bottom = { x: corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * u, y: corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}

/** The shapes as an SVG drawing in composition pixels, the form the Stage importer reads. */
export function shapesToSvg(shapes: TracedShape[], corners: Corners, width: number, height: number): string {
  const polygons = shapes.map((shape, index) => {
    const points = shape.points.map(p => { const c = onComposition(corners, p.x, p.y); return `${(c.x * width).toFixed(2)},${((1 - c.y) * height).toFixed(2)}`; }).join(' ');
    return `<polygon id="Shape ${index + 1}" points="${points}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${polygons.join('')}</svg>`;
}

/** Reads a picture's pixels, no larger than needed for tracing. */
export async function picturePixels(src: string, longest = 640): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The picture could not be read.')); image.src = src; });
  const scale = Math.min(1, longest / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The picture could not be read.');
  context.drawImage(image, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/** Makes one mapping layer per shape, laid over the layer the picture is pinned to. Returns how many. */
export async function createShapeLayers(shapes: TracedShape[], layerId: string): Promise<number> {
  const [{ project }, { surfaceStore }] = await Promise.all([import('../stores/layers'), import('../stores/surface')]);
  const current = get(project);
  const layer = current.layers.find(l => l.id === layerId);
  if (!layer?.corners) throw new Error('The painting layer is no longer there.');
  const width = Math.max(1, Math.round(current.width || 1920)), height = Math.max(1, Math.round(current.height || 1080));
  surfaceStore.createSurface(`${layer.name} shapes`, width, height);
  if (!surfaceStore.importSVG(shapesToSvg(shapes, layer.corners, width, height), { replace: true })) throw new Error('No shapes could be made from this picture.');
  if (!(await surfaceStore.applyStage({ stayInVJ: true }))) throw new Error('The shapes could not be turned into layers.');
  return shapes.length;
}
