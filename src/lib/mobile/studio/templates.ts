// Applying a mapping template to a set, and the set a first run opens on. Pure: the studio
// checkpoints, persists and starts audio around these.

import { defaultShow, newSurface, type Show, type Surface } from './model';
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

/** True while the surfaces still sit exactly where the stage puts them, so the backdrop matches. */
export function stageMatches(show: Pick<Show, 'stage' | 'surfaces' | 'mapping'>): boolean {
  const template = findTemplate(show.stage);
  if (!template || !show.mapping || show.surfaces.length !== template.surfaces.length) return false;
  return show.surfaces.every((surface, i) => {
    const points = templateSurfacePoints(template, i);
    return surface.points.every((p, k) => Math.abs(p.x - points[k].x) < 1e-4 && Math.abs(p.y - points[k].y) < 1e-4);
  });
}
