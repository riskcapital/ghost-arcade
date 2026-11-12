import { defaultInteractive, validateScene, type InteractiveScene, type InteractiveSurface } from './interactive';
import { makeEffect, type EffectKind } from './interactiveEffects';

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
] as const;
export type InteractiveStarter = (typeof INTERACTIVE_STARTERS)[number]['id'];
export function starterScene(id: InteractiveStarter): InteractiveScene {
  const scene = defaultInteractive();
  scene.name = INTERACTIVE_STARTERS.find((s) => s.id === id)!.name;
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
