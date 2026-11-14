// A surface's own clip and picture placement together with the pro geometry: free outlines,
// meshes of any density, masks, groups and welds. Both kinds of field live on the same surface
// and must survive saving, the stage check, span and the editing tools.
import { describe, expect, it } from 'vitest';
import { defaultShow, newSurface, normalizeShow, type Show, type Surface } from '../model';
import { applyTemplate, stageMatches } from '../templates';
import { findTemplate } from '../stageScenes';
import { spanPlacements, withControl } from '../placement';
import { MapSaveWatch } from '../reviewPrompt';
import { newEllipseMask, newPolygonMask } from './masks';
import { convertSurface, createSurface, setDensity } from './surfaceKinds';
import { addPathPoint, dragHandle, duplicateSurface, mirrorSurface } from './edit';
import { surfaceOutline } from './surfaceShape';

const reload = (show: Show) => normalizeShow(JSON.parse(JSON.stringify(show)));
const shaderClip = (show: Show) => show.clips.find((c) => c.kind === 'shader')!;

describe('own clip and placement on pro surfaces', () => {
  it('a masked free shape keeps its clip and placement through a save and load', () => {
    const show = defaultShow();
    show.mapping = true;
    const clip = shaderClip(show);
    const mask = { ...newEllipseMask(), feather: 0.2 };
    const shape: Surface = { ...createSurface('hexagon', 0), clipId: clip.id, placement: withControl(undefined, 'zoom', 2), masks: [mask] };
    const mesh: Surface = { ...setDensity(convertSurface(newSurface(1), 'mesh'), { cols: 5, rows: 4 }), clipId: clip.id, group: 'g', welds: [{ x: 0.08, y: 0.08 }] };
    show.surfaces = [shape, mesh];
    const loaded = reload(show);
    expect(loaded.surfaces[0].shape).toEqual(shape.shape);
    expect(loaded.surfaces[0].masks).toEqual([mask]);
    expect(loaded.surfaces[0].clipId).toBe(clip.id);
    expect(loaded.surfaces[0].placement).toEqual(shape.placement);
    expect(loaded.surfaces[1].grid).toEqual({ cols: 5, rows: 4 });
    expect(loaded.surfaces[1].points).toEqual(mesh.points);
    expect(loaded.surfaces[1].clipId).toBe(clip.id);
    expect(loaded.surfaces[1].group).toBe('g');
    expect(loaded.surfaces[1].welds).toEqual(mesh.welds);
    // And saving again changes nothing.
    expect(JSON.stringify(reload(loaded).surfaces)).toBe(JSON.stringify(loaded.surfaces));
  });
  it('drops a clip that left the set but keeps the geometry around it', () => {
    const show = defaultShow();
    show.mapping = true;
    show.surfaces = [{ ...createSurface('circle', 0), clipId: 'gone', masks: [newPolygonMask([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])] }];
    const loaded = reload(show).surfaces[0];
    expect('clipId' in loaded).toBe(false);
    expect(loaded.shape?.points.length).toBe(show.surfaces[0].shape!.points.length);
    expect(loaded.masks).toHaveLength(1);
  });
  it('a 1.1 surface gains neither content nor geometry fields', () => {
    const show = defaultShow();
    show.mapping = true;
    show.surfaces = [newSurface(0), { ...newSurface(1), mode: 'mesh' }];
    const saved = JSON.parse(JSON.stringify(show));
    const loaded = normalizeShow(saved);
    const extra = ['clipId', 'placement', 'grid', 'bezier', 'tangents', 'masks', 'group', 'shape', 'welds'];
    for (const s of loaded.surfaces) for (const key of extra) expect(key in s).toBe(false);
    expect(loaded.surfaces.map((s) => s.points)).toEqual(show.surfaces.map((s) => s.points));
    expect(JSON.stringify(reload(loaded).surfaces)).toBe(JSON.stringify(loaded.surfaces));
  });
  it('duplicate and mirror keep what the surface plays and where the picture sits', () => {
    const show = defaultShow();
    const placed: Surface = { ...createSurface('triangle', 0), clipId: shaderClip(show).id, placement: { x: 0.3, y: 0.6, w: 0.5, h: 0.5, angle: 0.4 } };
    for (const next of [duplicateSurface(placed), mirrorSurface(placed, true)]) {
      expect(next.clipId).toBe(placed.clipId);
      expect(next.placement).toEqual(placed.placement);
    }
  });
  it('span reads where each surface sits, free shapes and meshes included', () => {
    const shape = createSurface('circle', 0, { x: 0.25, y: 0.5 });
    const mesh = setDensity(convertSurface(newSurface(1), 'mesh'), { cols: 4, rows: 4 });
    const [a, b] = spanPlacements([shape, mesh], [0, 1]);
    // The circle's picture frame encloses its outline, so the span covers it.
    const outline = surfaceOutline(shape);
    const xs = outline.map((p) => p.x);
    expect(a.placement!.x - a.placement!.w / 2).toBeLessThanOrEqual(Math.min(...xs) + 1e-6);
    expect(a.placement!.x + a.placement!.w / 2).toBeGreaterThanOrEqual(Math.max(...xs) - 1e-6);
    expect(b.placement!.x).toBeCloseTo(0.5, 6);
    expect(b.placement!.y).toBeCloseTo(0.5, 6);
    expect(b.placement!.angle).toBe(0);
    expect(b.placement!.w).toBeCloseTo(0.84, 6);
  });
});

describe('the demo stage with pro edits', () => {
  const template = () => applyTemplate(defaultShow(), findTemplate('boxes')!);
  it('stays while a face only changes kind or density', () => {
    const show = template();
    show.surfaces[0] = setDensity(convertSurface(show.surfaces[0], 'mesh'), { cols: 6, rows: 5 });
    show.surfaces[1] = setDensity(show.surfaces[1], { cols: 4, rows: 4 });
    show.surfaces[2] = convertSurface(show.surfaces[2], 'shape');
    expect(stageMatches(show)).toBe(true);
    // A point added on a straight edge does not move the outline.
    show.surfaces = addPathPoint(show.surfaces, 2, 0).surfaces;
    expect(stageMatches(show)).toBe(true);
  });
  it('goes once a corner of a mesh or a point of an outline moves', () => {
    // (A mesh's inner points let it go from the canvas and the nudge pad, which clear the stage.)
    const meshed = template();
    meshed.surfaces[0] = setDensity(convertSurface(meshed.surfaces[0], 'mesh'), { cols: 5, rows: 5 });
    const p = meshed.surfaces[0].points[24];
    meshed.surfaces = dragHandle(meshed.surfaces, 0, { kind: 'point', index: 24 }, { x: p.x + 0.02, y: p.y });
    expect(stageMatches(meshed)).toBe(false);
    const shaped = template();
    shaped.surfaces[1] = convertSurface(shaped.surfaces[1], 'shape');
    const q = shaped.surfaces[1].shape!.points[0];
    shaped.surfaces = dragHandle(shaped.surfaces, 1, { kind: 'path', index: 0 }, { x: q.x - 0.03, y: q.y - 0.02 });
    expect(stageMatches(shaped)).toBe(false);
  });
  it('masks and clips leave it in place', () => {
    const show = template();
    show.surfaces[0] = { ...show.surfaces[0], masks: [newEllipseMask()], placement: withControl(undefined, 'degrees', 30) };
    expect(stageMatches(show)).toBe(true);
  });
});

describe('a map made, for the review prompt', () => {
  it('counts reshaping an outline as making a map', () => {
    const watch = new MapSaveWatch();
    let surfaces = [convertSurface(newSurface(0), 'shape')];
    expect(watch.update('map', true, surfaces)).toBe(false);
    const q = surfaces[0].shape!.points[1];
    surfaces = dragHandle(surfaces, 0, { kind: 'path', index: 1 }, { x: q.x, y: q.y + 0.05 });
    expect(watch.update('perform', true, surfaces)).toBe(true);
  });
});
