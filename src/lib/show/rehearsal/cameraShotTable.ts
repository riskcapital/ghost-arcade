/**
 * The show file's own copy of the Demo Reel shots its Stage camera lane
 * uses.
 *
 * Shots live in the Demo Reel, which is kept per machine (localStorage). A
 * show opened on another machine found none of them: every camera clip said
 * "Missing shot" and the Stage Sim camera stood still. The show now carries
 * the shots its lane uses (`cameraShots`, optional: older files load as
 * before), and opening it adds the ones this machine lacks to its reel.
 */
import type { ShowCameraClip } from '../../types';
import type { DemoShot, ReelCameraState, ReelEasing } from '../../stage3d/demoReel';
import { createEmptyScene, type Stage3DScene } from '../../stage3d/types';

const EASINGS: readonly ReelEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

/** The shots `lane` uses, in lane order, each once. */
export function cameraShotTable(lane: readonly ShowCameraClip[], shots: readonly DemoShot[]): DemoShot[] {
  const byId = new Map(shots.map((s) => [s.id, s]));
  const out: DemoShot[] = [];
  const seen = new Set<string>();
  for (const clip of lane) {
    if (seen.has(clip.shotId)) continue;
    seen.add(clip.shotId);
    const shot = byId.get(clip.shotId);
    if (shot) out.push(JSON.parse(JSON.stringify(shot)) as DemoShot);
  }
  return out;
}

function vec3(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const v = raw.slice(0, 3).map(Number);
  return v.every(Number.isFinite) ? (v as [number, number, number]) : null;
}

function camera(raw: unknown): ReelCameraState | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const position = vec3(c.position);
  const target = vec3(c.target);
  const fov = Number(c.fov);
  if (!position || !target || !Number.isFinite(fov)) return null;
  return { position, target, fov };
}

/** One shot from a show file, or null when it is not usable. */
export function normalizeCameraShot(raw: unknown): DemoShot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const from = camera(r.from);
  const to = camera(r.to);
  if (!from || !to) return null;
  const base = camera(r.baseCamera) ?? from;
  const duration = Number(r.durationSec);
  const stage = r.stage && typeof r.stage === 'object' && Array.isArray((r.stage as { nodes?: unknown }).nodes)
    ? (r.stage as Stage3DScene)
    : createEmptyScene();
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : 'Shot',
    ...(typeof r.thumbnail === 'string' && r.thumbnail.startsWith('data:image/') ? { thumbnail: r.thumbnail } : {}),
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : 5,
    easing: EASINGS.includes(r.easing as ReelEasing) ? (r.easing as ReelEasing) : 'ease-in-out',
    moveId: typeof r.moveId === 'string' && r.moveId ? r.moveId : 'custom',
    from,
    to,
    arc: r.arc === true,
    baseCamera: base,
    stage,
  };
}

/** The shot table read from a show file (anything unusable is left out). */
export function readCameraShotTable(raw: unknown): DemoShot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCameraShot).filter((s): s is DemoShot => s !== null);
}
