import { defaultInteractive, validateScene, type InteractiveScene, type InteractiveSurface, type ZoneTrigger } from './interactive';
import { makeEffect, type EffectKind } from './interactiveEffects';
import { defaultReliefWorld, type SurfaceFinish } from '../../scene3d/worldModel';

export const INTERACTIVE_STARTERS = [
  {
    id: 'fire',
    name: 'Ignite',
    icon: 'smoke',
    color: '#ff9a5c',
    description: 'A burning box and drifting smoke. Touch the bellows above it for a flare.',
  },
  {
    id: 'light',
    name: 'After hours',
    icon: 'fx',
    color: '#e6c58a',
    description: 'Move a light through architectural shadows and haze.',
  },
  {
    id: 'balls',
    name: 'Kinetic play',
    icon: 'trails',
    color: '#b8eb88',
    description: 'Bouncing balls with gravity and obstacles. Touch the drop zone to release a handful.',
  },
  {
    id: 'orbit',
    name: 'Orbit garden',
    icon: 'flux',
    color: '#c8a6ff',
    description: 'Layered orbital trails and a point swarm. Touch to pull them in; the bloom zone bursts.',
  },
  {
    id: 'ribbons',
    name: 'Silk currents',
    icon: 'paint',
    color: '#79dccb',
    description: 'Soft trails and contour waves. Drag to bend the flow.',
  },
  {
    id: 'cascade',
    name: 'Cascade',
    icon: 'trails',
    color: '#8fb4ff',
    description: 'Balls bounce down a stack of ledges. Touch the top corner to drop a handful.',
    world: true,
  },
  {
    id: 'firewall',
    name: 'Fire wall',
    icon: 'smoke',
    color: '#ff9a5c',
    description: 'Four plinths burning, embers and smoke. Touch the band above them to set more alight.',
    world: true,
  },
  {
    id: 'gallery',
    name: 'Paint gallery',
    icon: 'paint',
    color: '#ff7ac8',
    description: 'Paint runs down three white panels. Touch the top band to pour more.',
    world: true,
  },
  {
    id: 'marbles',
    name: 'Marbles',
    icon: 'flux',
    color: '#9fe3e0',
    description: 'Glass and chrome marbles pile up in a bowl. Throw more in, or push them round.',
    world: true,
  },
] as const;
/** Starters with the 3D world on. */
export const isWorldStarter = (id: InteractiveStarter): boolean =>
  !!(INTERACTIVE_STARTERS.find((s) => s.id === id) as { world?: boolean } | undefined)?.world;
export type InteractiveStarter = (typeof INTERACTIVE_STARTERS)[number]['id'];
export function starterScene(id: InteractiveStarter): InteractiveScene {
  if (isWorldStarter(id)) return worldStarterScene(id);
  const scene = defaultInteractive();
  scene.name = INTERACTIVE_STARTERS.find((s) => s.id === id)!.name;
  scene.preset = id as InteractiveScene['preset'];
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
  const add = (kind: EffectKind, params: Record<string, number> = {}, target = 'point') => {
    const e = makeEffect(kind, target);
    Object.assign(e.params, params);
    return e;
  };
  /** A touch zone that releases a burst of the effects aimed at it. */
  const zone = (id: string, name: string, x: number, y: number, w: number, h: number): InteractiveSurface => ({
    id,
    name,
    behavior: 'trigger',
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    look: { fill: 'none', brightness: 0, scale: 0.5, speed: 0.5, outline: 0.35 },
    trigger: { actions: [{ kind: 'burst' }], rearm: 0.6 },
  });
  const burst = (kind: EffectKind, target: string, params: Record<string, number> = {}) => {
    const e = add(kind, params, target);
    e.emission = 'burst';
    // A touch should get the whole burst, not the quiet end of a sound sweep.
    delete e.mods.flow;
    return e;
  };
  if (id === 'fire') {
    scene.surfaces.push(zone('bellows', 'Bellows', 0.4, 0.32, 0.2, 0.14));
    scene.effects = [
      add('fire', { flow: 0.65, heat: 1.2, hue: 24 }, 'block'),
      add('smoke', { flow: 0.25, haze: 0.23, opacity: 0.35 }, 'block'),
      burst('fire', 'bellows', { heat: 2, duration: 0.6, hue: 18 }),
    ];
  }
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
    scene.effects = [
      add('light', { lightX: 0.2, lightY: 0.2, targetX: 0.6, targetY: 0.75, spread: 100, haze: 0.6, hue: 36 }),
    ];
  }
  if (id === 'balls') {
    scene.surfaces.push(zone('drop', 'Drop zone', 0.68, 0.1, 0.2, 0.16));
    scene.effects = [
      add('balls', { x: 0.28, y: 0.1, flow: 0.55, lifetime: 7, bounce: 0.8, size: 0.45, hue: 90 }),
      burst('balls', 'drop', { flow: 1, lifetime: 3.5, bounce: 0.85, size: 0.5, hue: 40, duration: 0.9 }),
    ];
  }
  if (id === 'orbit') {
    scene.surfaces.push(zone('bloom', 'Bloom', 0.72, 0.2, 0.16, 0.2));
    scene.effects = [
      add('orbit', { hue: 260, trails: 0.82 }),
      add('cloud', { flow: 0.3, lifetime: 4, opacity: 0.5, hue: 190 }),
      burst('cloud', 'bloom', { flow: 1, lifetime: 3, hue: 300, duration: 0.4 }),
    ];
  }
  if (id === 'ribbons')
    scene.effects = [add('walls', { hue: 220, opacity: 0.3 }), add('ribbons', { hue: 160, trails: 0.9 })];
  return validateScene(scene);
}

// ── Starters in the 3D world ──────────────────────────────────────────────

type Pt = { x: number; y: number };
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const solid = (id: string, name: string, points: Pt[], height: number, finish: SurfaceFinish): InteractiveSurface => ({ id, name, behavior: 'solid', points, height, finish });
/** A touch zone, drawn as a faint outline, that does something to the world. */
const worldZone = (id: string, name: string, points: Pt[], what: 'ignite' | 'pour' | 'balls'): InteractiveSurface => ({
  id, name, behavior: 'trigger', points,
  look: { fill: 'none', brightness: 0, scale: 0.5, speed: 0.5, outline: 0.35 },
  trigger: { actions: [{ kind: 'world', what }], rearm: 0.8 } satisfies ZoneTrigger,
});

function worldStarterScene(id: InteractiveStarter): InteractiveScene {
  const scene = defaultInteractive();
  scene.name = INTERACTIVE_STARTERS.find((s) => s.id === id)!.name;
  scene.world = defaultReliefWorld();
  const effect = (kind: EffectKind, params: Record<string, number> = {}, target = 'point') => {
    const e = makeEffect(kind, target);
    Object.assign(e.params, params);
    return e;
  };
  // A faint glow on the outlines, thrown onto the world.
  const glow = effect('architecture', { opacity: 0.45, hue: 210 });
  const stone: SurfaceFinish = { preset: 'stone', color: '#7a746c' };
  if (id === 'cascade') {
    // Ledges that slope one way, then the other, down the wall; each ends
    // just above the next, so balls drop from one to the next.
    const ledges = Array.from({ length: 5 }, (_, i) => {
      const left = i % 2 === 0, y = 0.12 + i * 0.16, tilt = left ? 0.08 : -0.08;
      const [x0, x1] = left ? [0.16, 0.56] : [0.44, 0.84];
      const pts = [{ x: x0, y }, { x: x1, y: y + tilt }, { x: x1, y: y + tilt + 0.035 }, { x: x0, y: y + 0.035 }];
      return solid(`ledge-${i}`, `Ledge ${i + 1}`, pts, 0.4, i % 2 ? { preset: 'chrome', color: '#d8dce4' } : stone);
    });
    scene.surfaces = [...ledges, worldZone('drop', 'Drop', box(0.86, 0.03, 0.98, 0.15), 'balls')];
    scene.effects = [effect('balls3d', { x: 0.24, y: 0.02, radius: 0.05, flow: 0.6, size: 0.28, bounce: 0.5, friction: 0.08, variety: 0.8, clear: 0.3 }), glow];
  } else if (id === 'firewall') {
    scene.surfaces = [0.2, 0.4, 0.6, 0.8].map((x, i) => solid(`plinth-${i}`, `Plinth ${i + 1}`, box(x - 0.06, 0.55, x + 0.06, 0.9), 0.3, stone));
    scene.surfaces.push(worldZone('band', 'Ignite', box(0.1, 0.08, 0.9, 0.2), 'ignite'));
    scene.effects = [
      ...[24, 12, 36, 200].map((hue, i) => effect('flames', { hue, flow: 0.55, embers: i === 1 ? 0.8 : 0.4, amount: 1100 }, `plinth-${i}`)),
      glow,
    ];
  } else if (id === 'gallery') {
    const panels = [[0.16, 0.36], [0.4, 0.6], [0.64, 0.84]];
    scene.surfaces = panels.map(([x0, x1], i) => solid(`panel-${i}`, `Panel ${i + 1}`, box(x0, 0.18, x1, 0.82), 0.2, { preset: 'matte', color: '#e8e4dc' }));
    scene.surfaces.push(worldZone('pour', 'Pour', box(0.12, 0.04, 0.88, 0.14), 'pour'));
    scene.effects = [
      ...[318, 190, 46].map((hue, i) => effect('drips', { hue, flow: 0.35, amount: 500, gloss: 0.9 }, `panel-${i}`)),
      glow,
    ];
  } else {
    // A bowl: two walls and a base, a bump in the middle.
    scene.surfaces = [
      solid('left', 'Left wall', box(0.22, 0.42, 0.27, 0.86), 0.45, stone),
      solid('right', 'Right wall', box(0.73, 0.42, 0.78, 0.86), 0.45, stone),
      solid('base', 'Base', box(0.22, 0.86, 0.78, 0.92), 0.45, stone),
      solid('bump', 'Bump', [{ x: 0.44, y: 0.86 }, { x: 0.5, y: 0.74 }, { x: 0.56, y: 0.86 }], 0.45, { preset: 'chrome', color: '#d8dce4' }),
      worldZone('more', 'More', box(0.4, 0.04, 0.6, 0.16), 'balls'),
    ];
    scene.effects = [effect('balls3d', { x: 0.5, y: 0.05, radius: 0.18, flow: 0.7, amount: 220, size: 0.18, bounce: 0.25, friction: 0.5, variety: 0.9, clear: 0.5, lifetime: 40 }), glow];
  }
  return validateScene(scene);
}

type SceneStorage = Pick<Storage, 'getItem' | 'setItem'>;
const DRAFT = 'ghost-interactive-draft-v2',
  BANK = 'ghost-interactive-presets-v2';
export type SavedInteractiveScene = { id: string; updated: number; scene: InteractiveScene };
export function readInteractiveDraft(storage: SceneStorage): InteractiveScene | null {
  for (const key of [DRAFT, 'ghost-interactive-scene-v1']) {
    try {
      const raw = storage.getItem(key);
      if (raw) return validateScene(JSON.parse(raw));
    } catch {
      /* Try previous single-scene save before starting fresh. */
    }
  }
  return null;
}
export function writeInteractiveDraft(storage: SceneStorage, scene: InteractiveScene) {
  storage.setItem(DRAFT, JSON.stringify(validateScene(scene)));
}
export function readInteractivePresets(storage: SceneStorage): SavedInteractiveScene[] {
  try {
    const rows = JSON.parse(storage.getItem(BANK) || '[]');
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 24).flatMap((v) => {
      try {
        if (typeof v.id !== 'string' || !Number.isFinite(v.updated)) return [];
        return [{ id: v.id, updated: v.updated, scene: validateScene(v.scene) }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
export function saveInteractivePreset(storage: SceneStorage, scene: InteractiveScene): SavedInteractiveScene[] {
  const rows = readInteractivePresets(storage);
  if (rows.length >= 24) throw Error('Your 24 saved scenes are full. Export a scene before removing it.');
  const next = [{ id: crypto.randomUUID(), updated: Date.now(), scene: validateScene(scene) }, ...rows];
  storage.setItem(BANK, JSON.stringify(next));
  return next;
}
export function removeInteractivePreset(storage: SceneStorage, id: string): SavedInteractiveScene[] {
  const rows = readInteractivePresets(storage).filter((s) => s.id !== id);
  storage.setItem(BANK, JSON.stringify(rows));
  return rows;
}
export function restoreInteractivePreset(storage: SceneStorage, saved: SavedInteractiveScene): SavedInteractiveScene[] {
  const rows = readInteractivePresets(storage);
  if (rows.some((s) => s.id === saved.id)) return rows;
  if (rows.length >= 24) throw Error('Remove another saved scene to restore this one.');
  const next = [saved, ...rows];
  storage.setItem(BANK, JSON.stringify(next));
  return next;
}
