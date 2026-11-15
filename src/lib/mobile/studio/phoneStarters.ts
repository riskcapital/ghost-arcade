/**
 * The starter scenes as the phone has offered them since 1.1: one block or
 * a few columns and the effects, no touch zones, effects that do not follow
 * the music until someone sets a Mod. The phone uses these on its own and
 * with a desktop that does not advertise the 3D world (`interactiveWorld`),
 * where they behave exactly as before. With a desktop that has the world the
 * editor uses the shared starters (interactiveLibrary.ts), zones and world
 * starters included, the same ones the desktop offers.
 */
import { defaultInteractive, validateScene, type InteractiveScene } from './interactive';
import { makeEffect, type EffectKind } from './interactiveEffects';
import { INTERACTIVE_STARTERS, starterScene, type InteractiveStarter } from './interactiveLibrary';

export const CLASSIC_STARTERS = [
  { id: 'fire', name: 'Ignite', icon: 'smoke', color: '#ff9a5c', description: 'A burning box, drifting smoke. Drag the box to move the source.' },
  { id: 'light', name: 'After hours', icon: 'fx', color: '#e6c58a', description: 'Move a light through architectural shadows and haze.' },
  { id: 'balls', name: 'Kinetic play', icon: 'trails', color: '#b8eb88', description: 'Bouncing balls with gravity, obstacles and a finite lifetime.' },
  { id: 'orbit', name: 'Orbit garden', icon: 'flux', color: '#c8a6ff', description: 'Layered orbital trails and a point swarm. Touch to pull them in.' },
  { id: 'ribbons', name: 'Silk currents', icon: 'paint', color: '#79dccb', description: 'Soft trails and contour waves. Drag to bend the flow.' },
] as const;
export type ClassicStarter = (typeof CLASSIC_STARTERS)[number]['id'];

export type StarterCard = { id: InteractiveStarter; name: string; icon: string; color: string; description: string; world?: boolean };

/** The starters the editor offers: the shared ones with a world desktop, else the classic ones. */
export function phoneStarters(world: boolean): readonly StarterCard[] {
  return world ? (INTERACTIVE_STARTERS as readonly StarterCard[]) : CLASSIC_STARTERS;
}

/** A starter scene for the phone (see phoneStarters). */
export function phoneStarterScene(id: InteractiveStarter, world: boolean): InteractiveScene {
  if (world || !CLASSIC_STARTERS.some((s) => s.id === id)) return starterScene(id);
  return classicStarterScene(id as ClassicStarter);
}

export function classicStarterScene(id: ClassicStarter): InteractiveScene {
  const scene = defaultInteractive();
  scene.name = CLASSIC_STARTERS.find((s) => s.id === id)!.name;
  scene.preset = id;
  scene.surfaces = [
    {
      id: 'block',
      name: 'Main block',
      behavior: 'solid',
      height: 0.3,
      points: [
        { x: 0.35, y: 0.55 },
        { x: 0.65, y: 0.55 },
        { x: 0.65, y: 0.72 },
        { x: 0.35, y: 0.72 },
      ],
    },
  ];
  // As before the music defaults: no Mods until someone sets one.
  const add = (kind: EffectKind, params: Record<string, number> = {}, target = 'point') => {
    const e = makeEffect(kind, target, false);
    Object.assign(e.params, params);
    return e;
  };
  if (id === 'fire')
    scene.effects = [add('fire', { flow: 0.65, heat: 1.2, hue: 24 }, 'block'), add('smoke', { flow: 0.25, haze: 0.23, opacity: 0.35 }, 'block')];
  if (id === 'light') {
    scene.surfaces = [0.25, 0.5, 0.75].map((x, i) => ({
      id: `column-${i}`,
      name: `Column ${i + 1}`,
      behavior: 'solid',
      height: 0.38,
      points: [
        { x: x - 0.025, y: 0.42 },
        { x: x + 0.025, y: 0.42 },
        { x: x + 0.025, y: 0.7 },
        { x: x - 0.025, y: 0.7 },
      ],
    }));
    scene.effects = [add('light', { lightX: 0.2, lightY: 0.2, targetX: 0.6, targetY: 0.75, spread: 100, haze: 0.6, hue: 36 })];
  }
  if (id === 'balls') scene.effects = [add('balls', { x: 0.28, y: 0.1, flow: 0.55, lifetime: 7, bounce: 0.8, size: 0.45, hue: 90 })];
  if (id === 'orbit') scene.effects = [add('orbit', { hue: 260, trails: 0.82 }), add('cloud', { flow: 0.3, lifetime: 4, opacity: 0.5, hue: 190 })];
  if (id === 'ribbons') scene.effects = [add('walls', { hue: 220, opacity: 0.3 }), add('ribbons', { hue: 160, trails: 0.9 })];
  return validateScene(scene);
}
