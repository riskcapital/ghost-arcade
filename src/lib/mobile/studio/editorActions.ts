/**
 * Scene edits made by the Interactive Studio editor.
 *
 * Every function takes a scene and returns a new one; nothing here touches
 * component state, history or the DOM, so each edit can be unit tested.
 */
import type { Behavior, InteractiveScene, InteractiveSurface, Point } from './interactive';
import {
  MAX_INTERACTIVE_EFFECTS,
  makeEffect,
  reorderEffects,
  type EffectKind,
  type InteractiveEffect,
} from './interactiveEffects';
import { makeSurface, transformPoints, translatePoints } from './surfaceEditing';

export const MAX_SURFACES = 32;
export const MAX_DRAFT_POINTS = 64;

export type ShapeKind = 'box' | 'circle' | 'triangle';

function mapSurface(
  scene: InteractiveScene,
  id: string,
  change: (surface: InteractiveSurface) => InteractiveSurface,
): InteractiveScene {
  return { ...scene, surfaces: scene.surfaces.map((s) => (s.id === id ? change(s) : s)) };
}

// ── Effects ────────────────────────────────────────────────────────────────

export function patchEffect(scene: InteractiveScene, id: string, patch: Partial<InteractiveEffect>): InteractiveScene {
  return { ...scene, effects: scene.effects?.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Append an effect. Returns null when the stack is full. */
export function addEffect(
  scene: InteractiveScene,
  kind: EffectKind,
  target = 'point',
): { scene: InteractiveScene; effect: InteractiveEffect } | null {
  const effects = scene.effects ?? [];
  if (effects.length >= MAX_INTERACTIVE_EFFECTS) return null;
  const effect = makeEffect(kind, target);
  return { scene: { ...scene, effects: [...effects, effect] }, effect };
}

export function removeEffect(scene: InteractiveScene, id: string): InteractiveScene {
  return { ...scene, effects: (scene.effects ?? []).filter((e) => e.id !== id) };
}

export function toggleEffect(scene: InteractiveScene, id: string): InteractiveScene {
  return { ...scene, effects: (scene.effects ?? []).map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)) };
}

/** Move effect `from` to the position of effect `to`. */
export function moveEffect(scene: InteractiveScene, from: string, to: string): InteractiveScene {
  return { ...scene, effects: reorderEffects(scene.effects ?? [], from, to) };
}

/** Point an emitter (or a light) at a free position on the canvas. */
export function placeEmitter(scene: InteractiveScene, effect: InteractiveEffect, p: Point): InteractiveScene {
  if (effect.kind === 'light')
    return patchEffect(scene, effect.id, { params: { ...effect.params, lightX: p.x, lightY: p.y } });
  return patchEffect(scene, effect.id, { target: 'point', params: { ...effect.params, x: p.x, y: p.y } });
}

// ── Objects ────────────────────────────────────────────────────────────────

/** Add a ready-made shape. Returns null when the scene is full. */
export function addShape(
  scene: InteractiveScene,
  kind: ShapeKind,
): { scene: InteractiveScene; surface: InteractiveSurface } | null {
  if (scene.surfaces.length >= MAX_SURFACES) return null;
  const surface = makeSurface(kind, scene.surfaces.length);
  return { scene: { ...scene, surfaces: [...scene.surfaces, surface] }, surface };
}

/** Turn a drawn outline into a shape. Returns null for fewer than three points or a full scene. */
export function addDrawnSurface(
  scene: InteractiveScene,
  points: Point[],
): { scene: InteractiveScene; surface: InteractiveSurface } | null {
  if (points.length < 3 || scene.surfaces.length >= MAX_SURFACES) return null;
  const surface: InteractiveSurface = {
    id: crypto.randomUUID(),
    name: `Surface ${scene.surfaces.length + 1}`,
    behavior: 'solid',
    points,
  };
  return { scene: { ...scene, surfaces: [...scene.surfaces, surface] }, surface };
}

export function duplicateSurface(
  scene: InteractiveScene,
  id: string,
): { scene: InteractiveScene; surface: InteractiveSurface } | null {
  const source = scene.surfaces.find((s) => s.id === id);
  if (!source || scene.surfaces.length >= MAX_SURFACES) return null;
  const surface: InteractiveSurface = {
    ...structuredClone(source),
    id: crypto.randomUUID(),
    name: source.name + ' copy',
    points: translatePoints(source.points, 0.03, 0.03),
  };
  return { scene: { ...scene, surfaces: [...scene.surfaces, surface] }, surface };
}

/** Delete a shape. Effects that were emitting from it fall back to a free position. */
export function removeSurface(scene: InteractiveScene, id: string): InteractiveScene {
  return {
    ...scene,
    surfaces: scene.surfaces.filter((s) => s.id !== id),
    effects: (scene.effects ?? []).map((e) => (e.target === id ? { ...e, target: 'point' } : e)),
  };
}

export function transformSurface(scene: InteractiveScene, id: string, scale: number, angle = 0): InteractiveScene {
  return mapSurface(scene, id, (s) => ({ ...s, points: transformPoints(s.points, scale, angle) }));
}

export function setSurfacePoints(scene: InteractiveScene, id: string, points: Point[]): InteractiveScene {
  return mapSurface(scene, id, (s) => ({ ...s, points }));
}

export function moveSurfaceVertex(scene: InteractiveScene, id: string, index: number, p: Point): InteractiveScene {
  return mapSurface(scene, id, (s) => ({ ...s, points: s.points.map((v, i) => (i === index ? p : v)) }));
}

export function renameSurface(scene: InteractiveScene, id: string, name: string): InteractiveScene {
  return mapSurface(scene, id, (s) => ({ ...s, name: name.slice(0, 80) }));
}

export function setSurfaceBehavior(scene: InteractiveScene, id: string, behavior: Behavior): InteractiveScene {
  return mapSurface(scene, id, (s) => ({ ...s, behavior }));
}

export function setSurfaceHeight(scene: InteractiveScene, id: string, height: number): InteractiveScene {
  return mapSurface(scene, id, (s) => ({ ...s, height }));
}

/** New seed: every simulation starts over. */
export function reseed(scene: InteractiveScene): InteractiveScene {
  return { ...scene, seed: ((scene.seed ?? 0) + 1) % 1000000 };
}

// ── Labels ─────────────────────────────────────────────────────────────────

/** Effects that emit matter from a shape outline or from a free position. */
export const EMITTER_KINDS: EffectKind[] = ['fire', 'smoke', 'liquid', 'balls', 'cloud'];

export function isEmitter(kind: EffectKind): boolean {
  return EMITTER_KINDS.includes(kind);
}

/** One-line description of where an effect comes from, shown under its name. */
export function effectSourceLabel(effect: InteractiveEffect, surfaces: InteractiveSurface[]): string {
  if (effect.kind === 'light') return 'Light source';
  if (!isEmitter(effect.kind)) return 'Scene effect';
  if (effect.target === 'point') return 'Free emitter';
  return surfaces.find((s) => s.id === effect.target)?.name ?? 'Free emitter';
}
