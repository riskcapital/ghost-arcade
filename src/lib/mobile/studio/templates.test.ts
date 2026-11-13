import { describe, expect, it } from 'vitest';
import { defaultShow, normalizeShow, loadShow, STORAGE_KEY } from './model';
import { MOBILE_SHADERS } from '../standaloneShaderList';
import { standaloneShaderPaths } from './shaderAvailability';
import { mobileHeavyShaderPaths, mobileRemovedShaderPaths } from './shaderPerformance';
import { MAPPING_TEMPLATES, DEMO_TEMPLATE_ID, cameraBasis, projectPoint, templateSurfacePoints, faceCorners, findTemplate } from './stageScenes';
import { applyTemplate, mappingDemoShow, stageMatches, DEMO_DECK_SURFACE } from './templates';
import { planSurfaceClips } from './surfaceClips';
import { SURFACE_CLIP_CAP } from './qualityGovernor';
import gpuCost from '../../../../native-mobile/shader-gpu-cost.json';

const cost = (gpuCost as { ms: Record<string, number> }).ms;

describe('mapping templates', () => {
  it('offers the six objects from the brief, each with surfaces', () => {
    expect(MAPPING_TEMPLATES.map((t) => t.id)).toEqual(['boxes', 'window', 'doorway', 'facade', 'dj-booth', 'table-cake']);
    for (const t of MAPPING_TEMPLATES) expect(t.surfaces.length).toBeGreaterThanOrEqual(3);
  });
  it('uses only cheap, phone-safe library shaders, at most three different ones', () => {
    for (const t of MAPPING_TEMPLATES) {
      const ids = new Set(t.surfaces.map((s) => s.shader));
      expect(ids.size, t.id).toBeLessThanOrEqual(Math.min(...Object.values(SURFACE_CLIP_CAP)));
      for (const id of ids) {
        const shader = MOBILE_SHADERS.find((s) => s.id === id);
        expect(shader, `${t.id}: ${id}`).toBeTruthy();
        expect(standaloneShaderPaths.has(shader!.path), id).toBe(true);
        expect(mobileHeavyShaderPaths.has(shader!.path) || mobileRemovedShaderPaths.has(shader!.path), id).toBe(false);
        expect(shader!.requiresImage, id).toBeFalsy();
        // Measured at under half a millisecond per 720p frame on the reference GPU.
        expect(cost[shader!.path], id).toBeLessThan(0.5);
      }
    }
  });
  it('places every surface inside the frame as a convex, clockwise quad', () => {
    for (const t of MAPPING_TEMPLATES) {
      t.surfaces.forEach((_, i) => {
        const p = templateSurfacePoints(t, i);
        expect(p).toHaveLength(9);
        for (const q of p) {
          expect(q.x, `${t.id} ${i}`).toBeGreaterThan(-0.01);
          expect(q.x).toBeLessThan(1.01);
          expect(q.y).toBeGreaterThan(-0.01);
          expect(q.y).toBeLessThan(1.01);
        }
        const quad = [p[0], p[2], p[8], p[6]];
        for (let k = 0; k < 4; k++) {
          const a = quad[k], b = quad[(k + 1) % 4], c = quad[(k + 2) % 4];
          // y points down, so a clockwise quad on screen has a positive cross product.
          expect((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), `${t.id} ${t.surfaces[i].name}`).toBeGreaterThanOrEqual(0);
        }
      });
    }
  });
  it('projects with the same camera the stage shader uses', () => {
    const t = findTemplate('boxes')!;
    const basis = cameraBasis(t.scene);
    // The target sits in the middle of the frame.
    const centre = projectPoint(t.scene, t.scene.target, basis);
    expect(centre.x).toBeCloseTo(0.5, 6);
    expect(centre.y).toBeCloseTo(0.5, 6);
    // A face's top edge is above its bottom edge on screen.
    const [tl, , , bl] = faceCorners(t.scene.boxes[0], 'front').map((p) => projectPoint(t.scene, p, basis));
    expect(tl.y).toBeLessThan(bl.y);
  });
  it('replaces the surfaces, turns mapping on and adds only clips the set did not have', () => {
    const show = defaultShow(true);
    const before = show.clips.map((c) => c.id);
    for (const t of MAPPING_TEMPLATES) {
      const next = applyTemplate(show, t);
      expect(next.mapping).toBe(true);
      expect(next.stage).toBe(t.id);
      expect(next.surfaces.map((s) => s.name)).toEqual(t.surfaces.map((s) => s.name));
      expect(next.clips.slice(0, before.length).map((c) => c.id)).toEqual(before);
      expect(next.layers).toBe(show.layers);
      expect(next.launchGrid).toBe(show.launchGrid);
      next.surfaces.forEach((s, i) => expect(next.clips.find((c) => c.id === s.clipId)?.shaderId).toBe(t.surfaces[i].shader));
      // Every surface plays on every device tier.
      expect(planSurfaceClips(next, Math.min(...Object.values(SURFACE_CLIP_CAP))).capped).toEqual([]);
      expect(stageMatches(next)).toBe(true);
    }
  });
  it('survives a save and load with its surfaces, clips and stage', () => {
    const next = applyTemplate(defaultShow(true), findTemplate('dj-booth')!);
    const loaded = normalizeShow(JSON.parse(JSON.stringify(next)));
    expect(loaded.stage).toBe('dj-booth');
    expect(loaded.surfaces.map((s) => s.clipId)).toEqual(next.surfaces.map((s) => s.clipId));
    expect(stageMatches(loaded)).toBe(true);
  });
  it('hides the stage once a corner moves', () => {
    const next = applyTemplate(defaultShow(), findTemplate('window')!);
    next.surfaces[0] = { ...next.surfaces[0], points: next.surfaces[0].points.map((p) => ({ x: p.x + 0.01, y: p.y })) };
    expect(stageMatches(next)).toBe(false);
  });
});

describe('first run', () => {
  it('opens a mapping demo: the starter deck, the demo stage, the big face on the deck', () => {
    const demo = mappingDemoShow();
    const stock = defaultShow(true);
    expect(demo.stage).toBe(DEMO_TEMPLATE_ID);
    expect(demo.mapping).toBe(true);
    expect(demo.layers[0].clipId).toBe(stock.layers[0].clipId);
    expect(demo.scenes.length).toBe(stock.scenes.length);
    expect(demo.surfaces[DEMO_DECK_SURFACE].clipId).toBeUndefined();
    expect(demo.surfaces.filter((s) => s.clipId).length).toBe(demo.surfaces.length - 1);
    expect(stageMatches(demo)).toBe(true);
  });
  it('reloads as the same demo, not as the stock perform set', () => {
    const demo = mappingDemoShow();
    const store = new Map<string, string>([[STORAGE_KEY, JSON.stringify(demo)]]);
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: () => {} } });
    try {
      const loaded = loadShow();
      expect(loaded.stage).toBe(DEMO_TEMPLATE_ID);
      expect(loaded.surfaces.map((s) => s.clipId)).toEqual(demo.surfaces.map((s) => s.clipId));
      expect(stageMatches(loaded)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  });
});
