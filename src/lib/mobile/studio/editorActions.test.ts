import { describe, it, expect } from 'vitest';
import { defaultInteractive, type InteractiveScene } from './interactive';
import { MAX_INTERACTIVE_EFFECTS, makeEffect } from './interactiveEffects';
import * as edit from './editorActions';

function sceneWith(...kinds: Parameters<typeof makeEffect>[0][]): InteractiveScene {
  return { ...defaultInteractive(), effects: kinds.map((kind) => makeEffect(kind)) };
}

describe('editor effect edits', () => {
  it('appends an effect and reports it', () => {
    const scene = sceneWith('fire');
    const added = edit.addEffect(scene, 'liquid', 'stage')!;
    expect(added.scene.effects!.map((e) => e.kind)).toEqual(['fire', 'liquid']);
    expect(added.effect.target).toBe('stage');
    expect(scene.effects).toHaveLength(1);
  });

  it('refuses a ninth effect', () => {
    const scene = sceneWith(...Array(MAX_INTERACTIVE_EFFECTS).fill('fire'));
    expect(edit.addEffect(scene, 'smoke')).toBeNull();
  });

  it('removes, toggles and reorders by id', () => {
    const scene = sceneWith('fire', 'smoke', 'liquid');
    const [a, b, c] = scene.effects!.map((e) => e.id);
    expect(edit.removeEffect(scene, b).effects!.map((e) => e.id)).toEqual([a, c]);
    expect(edit.toggleEffect(scene, a).effects![0].enabled).toBe(false);
    expect(edit.moveEffect(scene, c, a).effects!.map((e) => e.id)).toEqual([c, a, b]);
  });

  it('places an emitter on a free point and a light on its own position', () => {
    const scene = sceneWith('fire', 'light');
    const [fire, light] = scene.effects!;
    const attached = edit.patchEffect(scene, fire.id, { target: 'stage' });
    const moved = edit.placeEmitter(attached, attached.effects![0], { x: 0.2, y: 0.3 }).effects![0];
    expect(moved.target).toBe('point');
    expect([moved.params.x, moved.params.y]).toEqual([0.2, 0.3]);
    const lit = edit.placeEmitter(scene, light, { x: 0.7, y: 0.1 }).effects![1];
    expect([lit.params.lightX, lit.params.lightY]).toEqual([0.7, 0.1]);
  });

  it('labels where an effect comes from', () => {
    const scene = defaultInteractive();
    expect(edit.effectSourceLabel(makeEffect('light'), scene.surfaces)).toBe('Light source');
    expect(edit.effectSourceLabel(makeEffect('orbit'), scene.surfaces)).toBe('Scene effect');
    expect(edit.effectSourceLabel(makeEffect('fire'), scene.surfaces)).toBe('Free emitter');
    expect(edit.effectSourceLabel(makeEffect('fire', scene.surfaces[0].id), scene.surfaces)).toBe(
      scene.surfaces[0].name,
    );
    expect(edit.effectSourceLabel(makeEffect('fire', 'gone'), scene.surfaces)).toBe('Free emitter');
  });
});

describe('editor object edits', () => {
  it('adds ready-made and drawn shapes up to the limit', () => {
    const scene = defaultInteractive();
    const box = edit.addShape(scene, 'box')!;
    expect(box.scene.surfaces).toHaveLength(scene.surfaces.length + 1);
    expect(box.surface.name).toBe(`Box ${scene.surfaces.length + 1}`);
    expect(
      edit.addDrawnSurface(scene, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toBeNull();
    const drawn = edit.addDrawnSurface(scene, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ])!;
    expect(drawn.surface.points).toHaveLength(3);
    const full = {
      ...scene,
      surfaces: Array.from({ length: edit.MAX_SURFACES }, (_, i) => ({ ...scene.surfaces[0], id: 's' + i })),
    };
    expect(edit.addShape(full, 'circle')).toBeNull();
    expect(edit.duplicateSurface(full, 's0')).toBeNull();
  });

  it('duplicates with a new id, a copy name and a small offset', () => {
    const scene = defaultInteractive();
    const source = scene.surfaces[0];
    const copy = edit.duplicateSurface(scene, source.id)!.surface;
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe(source.name + ' copy');
    expect(copy.points[0].x).toBeCloseTo(source.points[0].x + 0.03);
    expect(copy.points[0].y).toBeCloseTo(source.points[0].y + 0.03);
  });

  it('sends effects back to a free position when their shape is deleted', () => {
    const base = defaultInteractive();
    const id = base.surfaces[0].id;
    const scene = { ...base, effects: [makeEffect('fire', id), makeEffect('smoke')] };
    const next = edit.removeSurface(scene, id);
    expect(next.surfaces.some((s) => s.id === id)).toBe(false);
    expect(next.effects!.map((e) => e.target)).toEqual(['point', 'point']);
  });

  it('edits one shape and leaves the others untouched', () => {
    const scene = defaultInteractive();
    const [first, second] = scene.surfaces;
    const renamed = edit.renameSurface(scene, first.id, 'x'.repeat(200));
    expect(renamed.surfaces[0].name).toHaveLength(80);
    expect(renamed.surfaces[1]).toBe(second);
    expect(edit.setSurfaceBehavior(scene, first.id, 'attractor').surfaces[0].behavior).toBe('attractor');
    expect(edit.setSurfaceHeight(scene, first.id, 0.5).surfaces[0].height).toBe(0.5);
    expect(edit.moveSurfaceVertex(scene, first.id, 1, { x: 0.9, y: 0.9 }).surfaces[0].points[1]).toEqual({
      x: 0.9,
      y: 0.9,
    });
    expect(edit.transformSurface(scene, first.id, 0.5).surfaces[0].points).not.toEqual(first.points);
  });

  it('bumps the seed to restart simulations', () => {
    expect(edit.reseed({ ...defaultInteractive(), seed: 999999 }).seed).toBe(0);
    expect(edit.reseed(defaultInteractive()).seed).toBe(1);
  });
});
