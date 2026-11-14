// Applying a mapping template to a set, and the set a first run opens on. Pure: the studio
// checkpoints, persists and starts audio around these.

import { defaultShow, newSurface, type Point, type Show, type Surface } from './model';
import { cornerIndices, gridOf } from './mapping/meshGrid';
import { isShape } from './mapping/surfaceShape';
import { libraryClip } from './surfaceClips';
import { DEMO_TEMPLATE_ID, findTemplate, templateSurfacePoints, type MappingTemplate } from './stageScenes';

/**
 * The set with `template`'s surfaces in place of its own, each playing its visual, mapping on and
 * the template's stage behind them in the preview. The deck, blocks and every existing clip are
 * left exactly as they were; only clips the set did not have yet are added (after the others).
 * `deckSurface` names a surface that plays the deck (the full composition) instead of a clip.
 */
export function applyTemplate(show: Show, template: MappingTemplate, deckSurface?: number): Show {
  let clips = [...show.clips];
  const surfaces: Surface[] = template.surfaces.slice(0, 16).map((spec, i) => {
    const surface: Surface = { ...newSurface(i), name: spec.name, points: templateSurfacePoints(template, i) };
    if (i === deckSurface) return surface;
    const found = libraryClip(clips, spec.shader);
    if (!found) return surface;
    if (found.added) clips = [...clips, found.clip];
    return { ...surface, clipId: found.clip.id };
  });
  return { ...show, clips, surfaces, mapping: true, stage: template.id };
}

/** Surface the first-run demo gives to the deck: the big box's front, so a launched pad shows there. */
export const DEMO_DECK_SURFACE = 0;

/**
 * The set a first run opens on: the usual starter set (three blocks of shaders, Layer 1 playing)
 * mapped onto the demo stage. Its biggest face plays the deck and the others play their own
 * visuals, so the very first screen shows what the app is for.
 */
export function mappingDemoShow(): Show {
  const show = defaultShow(true);
  const template = findTemplate(DEMO_TEMPLATE_ID);
  return template ? { ...applyTemplate(show, template, DEMO_DECK_SURFACE), name: 'Untitled set' } : show;
}

/**
 * True while the surfaces still sit exactly where the stage puts them, so the backdrop matches.
 * The studio also lets the stage go as soon as a point or a surface is dragged or nudged (a mesh's
 * inner points and curves move the picture without moving its corners).
 */
export function stageMatches(show: Pick<Show, 'stage' | 'surfaces' | 'mapping'>): boolean {
  const template = findTemplate(show.stage);
  if (!template || !show.mapping || show.surfaces.length !== template.surfaces.length) return false;
  return show.surfaces.every((surface, i) => onFace(surface, templateSurfacePoints(template, i)));
}

const near = (p: Point, q: Point, eps = 1e-4) => Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps;
/**
 * The surface still covers the template's face (its 3×3 lattice): its corners on the face's
 * corners, at any mesh density, and an outline, if it has one, that still runs straight along the
 * face's edges.
 */
function onFace(surface: Surface, face: Point[]): boolean {
  const corners: [Point, Point, Point, Point] = [face[0], face[2], face[8], face[6]];
  const g = gridOf(surface);
  if (surface.points.length !== g.cols * g.rows || !cornerIndices(g).every((i, k) => near(surface.points[i], corners[k]))) return false;
  if (!isShape(surface)) return true;
  const onEdge = (p: Point) =>
    corners.some((a, k) => {
      const b = corners[(k + 1) % 4];
      const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
      const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
      return near(p, { x: a.x + dx * t, y: a.y + dy * t }, 1e-3);
    });
  return surface.shape!.points.every((p) => !p.in && !p.out && onEdge(p));
}
