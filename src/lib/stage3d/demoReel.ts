// Demo Reel — shot-based sizzle-reel recorder for the Stage 3D designer.
//
// A Shot = a saved camera move (from→to derived from the camera at
// save time by a move template) + a snapshot of the stage's visual
// state (lighting / screen overrides / scenery / venue) + a duration
// and easing. Shots line up in a sequence; the preview drives the live
// camera in real time, and the offline reel renderer
// (recording/stageReelRender.ts) steps the same evaluation
// deterministically frame-by-frame into an MP4 via the existing FFmpeg
// pipeline — so users get pro camera-move proposal footage of their
// design without realtime capture.

import { writable, get } from 'svelte/store';
import type { Stage3DScene, Vec3 } from './types';

export interface ReelCameraState {
  position: Vec3;
  target: Vec3;
  fov: number;
}

export type ReelEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface DemoShot {
  id: string;
  name: string;
  /** Small JPEG data URL captured at save time. */
  thumbnail?: string;
  durationSec: number;
  easing: ReelEasing;
  /** Move template id (see MOVE_TEMPLATES). 'custom' keeps from/to as-is. */
  moveId: string;
  /** Camera at the move's start / end. Derived from `baseCamera` by the
   *  move template; re-derived when the user switches templates. */
  from: ReelCameraState;
  to: ReelCameraState;
  /** True = interpolate the camera AROUND the target (spherical path —
   *  pans/orbits sweep an arc instead of cutting a straight chord). */
  arc: boolean;
  /** The camera as saved — the anchor every template derives from. */
  baseCamera: ReelCameraState;
  /** Full stage visual snapshot applied on shot entry (lighting,
   *  screen/scenery overrides, venue, user elements). */
  stage: Stage3DScene;
}

export interface DemoReelSettings {
  fps: 24 | 30 | 60;
  width: number;
  height: number;
  outputMode: 'mp4' | 'frames';
  quality: 'high' | 'web' | 'archive';
  transition: 'cut' | 'cross-dissolve';
  transitionDurationSec: number;
  filename: string;
}

export const DEFAULT_REEL_SETTINGS: DemoReelSettings = {
  fps: 30,
  width: 1920,
  height: 1080,
  outputMode: 'mp4',
  quality: 'high',
  transition: 'cut',
  transitionDurationSec: 0.75,
  filename: 'stage-reel',
};

// ── Camera math ─────────────────────────────────────────────────────────

function cloneCam(c: ReelCameraState): ReelCameraState {
  return { position: [...c.position] as Vec3, target: [...c.target] as Vec3, fov: c.fov };
}

/** Rotate the camera position around its target on the Y axis. */
function rotateAroundTarget(c: ReelCameraState, deg: number): ReelCameraState {
  const out = cloneCam(c);
  const rad = (deg * Math.PI) / 180;
  const dx = c.position[0] - c.target[0];
  const dz = c.position[2] - c.target[2];
  out.position[0] = c.target[0] + dx * Math.cos(rad) - dz * Math.sin(rad);
  out.position[2] = c.target[2] + dx * Math.sin(rad) + dz * Math.cos(rad);
  return out;
}

/** Move the camera along its view axis. factor > 1 pulls away from the
 *  target, < 1 pushes toward it. */
function dolly(c: ReelCameraState, factor: number): ReelCameraState {
  const out = cloneCam(c);
  for (let i = 0; i < 3; i++) {
    out.position[i] = c.target[i] + (c.position[i] - c.target[i]) * factor;
  }
  return out;
}

/** Drop (or raise) the camera toward floor height, keeping the target. */
function craneFrom(c: ReelCameraState, y: number): ReelCameraState {
  const out = cloneCam(c);
  out.position[1] = y;
  return out;
}

// ── Move templates ──────────────────────────────────────────────────────

export interface MoveTemplate {
  id: string;
  label: string;
  icon: string;
  arc: boolean;
  derive: (base: ReelCameraState) => { from: ReelCameraState; to: ReelCameraState };
}

export const MOVE_TEMPLATES: MoveTemplate[] = [
  {
    id: 'static', label: 'Static Hold', icon: '⏸', arc: false,
    derive: (b) => ({ from: cloneCam(b), to: cloneCam(b) }),
  },
  {
    id: 'push-in', label: 'Push In', icon: '⤓', arc: false,
    derive: (b) => ({ from: dolly(b, 1.45), to: cloneCam(b) }),
  },
  {
    id: 'pull-back', label: 'Pull Back', icon: '⤒', arc: false,
    derive: (b) => ({ from: cloneCam(b), to: dolly(b, 1.45) }),
  },
  {
    id: 'pan-lr', label: 'Slow Pan L→R', icon: '⇉', arc: true,
    derive: (b) => ({ from: rotateAroundTarget(b, -9), to: rotateAroundTarget(b, 9) }),
  },
  {
    id: 'pan-rl', label: 'Slow Pan R→L', icon: '⇇', arc: true,
    derive: (b) => ({ from: rotateAroundTarget(b, 9), to: rotateAroundTarget(b, -9) }),
  },
  {
    id: 'orbit', label: 'Orbit 60°', icon: '↻', arc: true,
    derive: (b) => ({ from: rotateAroundTarget(b, -30), to: rotateAroundTarget(b, 30) }),
  },
  {
    id: 'crane-up', label: 'Crane Up (from floor)', icon: '⇪', arc: false,
    derive: (b) => ({ from: craneFrom(dolly(b, 1.1), 1.6), to: cloneCam(b) }),
  },
  {
    id: 'audience-sweep', label: 'Audience Sweep', icon: '∿', arc: true,
    derive: (b) => ({ from: dolly(rotateAroundTarget(b, 16), 0.85), to: rotateAroundTarget(b, -16) }),
  },
  {
    id: 'dome-lookup', label: 'Look-Up Reveal', icon: '☄', arc: false,
    derive: (b) => {
      const dist = Math.hypot(
        b.position[0] - b.target[0], b.position[1] - b.target[1], b.position[2] - b.target[2],
      );
      const to = cloneCam(b);
      to.target = [b.target[0], b.target[1] + dist * 0.9, b.target[2]] as Vec3;
      return { from: cloneCam(b), to };
    },
  },
  {
    id: 'custom', label: 'Custom (as saved)', icon: '✎', arc: false,
    derive: (b) => ({ from: cloneCam(b), to: cloneCam(b) }),
  },
];

export function moveTemplate(id: string): MoveTemplate {
  return MOVE_TEMPLATES.find(t => t.id === id) ?? MOVE_TEMPLATES[0];
}

// ── Evaluation ──────────────────────────────────────────────────────────

export function applyEasing(p: number, easing: ReelEasing): number {
  const t = Math.max(0, Math.min(1, p));
  switch (easing) {
    case 'ease-in':     return t * t;
    case 'ease-out':    return 1 - (1 - t) * (1 - t);
    case 'ease-in-out': return t * t * (3 - 2 * t);
    default:            return t;
  }
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Camera state at eased progress p (0..1) through a shot. Arc moves
 *  interpolate in spherical coordinates around the (lerped) target so
 *  pans and orbits sweep a real arc; linear moves lerp directly. */
export function evaluateShotCamera(shot: DemoShot, p: number): ReelCameraState {
  const e = applyEasing(p, shot.easing);
  const target: Vec3 = [
    lerp(shot.from.target[0], shot.to.target[0], e),
    lerp(shot.from.target[1], shot.to.target[1], e),
    lerp(shot.from.target[2], shot.to.target[2], e),
  ];
  const fov = lerp(shot.from.fov, shot.to.fov, e);

  if (!shot.arc) {
    return {
      position: [
        lerp(shot.from.position[0], shot.to.position[0], e),
        lerp(shot.from.position[1], shot.to.position[1], e),
        lerp(shot.from.position[2], shot.to.position[2], e),
      ],
      target, fov,
    };
  }

  // Spherical interpolation around the target (Y-up): radius, azimuth,
  // height each lerp; azimuth takes the short way around.
  const rel = (c: ReelCameraState) => {
    const dx = c.position[0] - c.target[0];
    const dz = c.position[2] - c.target[2];
    return {
      radius: Math.hypot(dx, dz),
      azimuth: Math.atan2(dx, dz),
      y: c.position[1] - c.target[1],
    };
  };
  const a = rel(shot.from);
  const b = rel(shot.to);
  let dAz = b.azimuth - a.azimuth;
  if (dAz > Math.PI) dAz -= Math.PI * 2;
  if (dAz < -Math.PI) dAz += Math.PI * 2;
  const radius = lerp(a.radius, b.radius, e);
  const azimuth = a.azimuth + dAz * e;
  const y = lerp(a.y, b.y, e);
  return {
    position: [
      target[0] + radius * Math.sin(azimuth),
      target[1] + y,
      target[2] + radius * Math.cos(azimuth),
    ],
    target, fov,
  };
}

export function sequenceDuration(shots: DemoShot[]): number {
  return shots.reduce((acc, s) => acc + Math.max(0.1, s.durationSec), 0);
}

/** Locate the active shot + local progress for a sequence time. */
export function shotAtTime(shots: DemoShot[], t: number):
  { index: number; shot: DemoShot; progress: number } | null {
  let acc = 0;
  for (let i = 0; i < shots.length; i++) {
    const d = Math.max(0.1, shots[i].durationSec);
    if (t < acc + d || i === shots.length - 1) {
      return { index: i, shot: shots[i], progress: Math.min(1, Math.max(0, (t - acc) / d)) };
    }
    acc += d;
  }
  return null;
}

// ── Store ───────────────────────────────────────────────────────────────

interface DemoReelState {
  shots: DemoShot[];
  settings: DemoReelSettings;
}

const STORAGE_KEY = 'ghost-arcade-demo-reel-v1';

function loadReel(): DemoReelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.shots)) {
        return { shots: parsed.shots, settings: { ...DEFAULT_REEL_SETTINGS, ...(parsed.settings ?? {}) } };
      }
    }
  } catch { /* corrupted store — start fresh */ }
  return { shots: [], settings: { ...DEFAULT_REEL_SETTINGS } };
}

function createDemoReelStore() {
  const { subscribe, update, set } = writable<DemoReelState>(loadReel());

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(get({ subscribe })));
    } catch (e) {
      console.warn('[DemoReel] persist failed (storage full?):', e);
    }
  }

  return {
    subscribe,

    /** Create a shot from the current camera + stage state. The move
     *  template derives from/to from the camera as saved. */
    addShot(camera: ReelCameraState, stage: Stage3DScene, moveId = 'static', thumbnail?: string): DemoShot {
      const tpl = moveTemplate(moveId);
      const { from, to } = tpl.derive(camera);
      const shot: DemoShot = {
        id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        thumbnail,
        durationSec: 5,
        easing: 'ease-in-out',
        moveId: tpl.id,
        from, to,
        arc: tpl.arc,
        baseCamera: cloneCam(camera),
        stage: JSON.parse(JSON.stringify(stage)) as Stage3DScene,
      };
      update(s => {
        shot.name = `Shot ${s.shots.length + 1}`;
        return { ...s, shots: [...s.shots, shot] };
      });
      persist();
      return shot;
    },

    removeShot(id: string) {
      update(s => ({ ...s, shots: s.shots.filter(sh => sh.id !== id) }));
      persist();
    },

    /** Reorder: move the shot with `id` to `toIndex`. */
    reorderShot(id: string, toIndex: number) {
      update(s => {
        const idx = s.shots.findIndex(sh => sh.id === id);
        if (idx < 0) return s;
        const shots = [...s.shots];
        const [shot] = shots.splice(idx, 1);
        shots.splice(Math.max(0, Math.min(shots.length, toIndex)), 0, shot);
        return { ...s, shots };
      });
      persist();
    },

    updateShot(id: string, patch: Partial<Pick<DemoShot, 'name' | 'durationSec' | 'easing'>>) {
      update(s => ({
        ...s,
        shots: s.shots.map(sh => (sh.id === id ? { ...sh, ...patch } : sh)),
      }));
      persist();
    },

    /** Switch the shot's move template — re-derives from/to from the
     *  shot's saved base camera. */
    setShotMove(id: string, moveId: string) {
      const tpl = moveTemplate(moveId);
      update(s => ({
        ...s,
        shots: s.shots.map(sh => {
          if (sh.id !== id) return sh;
          const { from, to } = tpl.derive(sh.baseCamera);
          return { ...sh, moveId: tpl.id, from, to, arc: tpl.arc };
        }),
      }));
      persist();
    },

    /** Re-snapshot the shot's camera + visuals from the current state. */
    updateShotCapture(id: string, camera: ReelCameraState, stage: Stage3DScene, thumbnail?: string) {
      update(s => ({
        ...s,
        shots: s.shots.map(sh => {
          if (sh.id !== id) return sh;
          const tpl = moveTemplate(sh.moveId);
          const { from, to } = tpl.derive(camera);
          return {
            ...sh,
            from, to,
            arc: tpl.arc,
            baseCamera: cloneCam(camera),
            stage: JSON.parse(JSON.stringify(stage)) as Stage3DScene,
            thumbnail: thumbnail ?? sh.thumbnail,
          };
        }),
      }));
      persist();
    },

    setSettings(patch: Partial<DemoReelSettings>) {
      update(s => ({ ...s, settings: { ...s.settings, ...patch } }));
      persist();
    },

    clear() {
      update(s => ({ ...s, shots: [] }));
      persist();
    },
  };
}

export const demoReel = createDemoReelStore();
