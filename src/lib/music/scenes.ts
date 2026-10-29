/**
 * Scenes: one press changes the music and the pictures together.
 *
 * A scene holds a beat pattern (and whether the beat plays), a take to loop
 * and a VJ column to launch. Launching lands on the next bar of the VJ launch
 * clock, so the beat, the loop and the visuals all change on the downbeat.
 * A scene is captured from whatever is playing, so building a set is: make a
 * beat, record a loop, pick the visuals, capture.
 */

import { normalizePattern, type DrumPattern } from './drumPattern';

export interface MusicScene {
  id: string;
  name: string;
  /** The beat to load, or null to keep whatever pattern is loaded. */
  pattern: DrumPattern | null;
  /** Whether the beat plays in this scene. */
  beat: boolean;
  /** Take looped in this scene, or null for none. */
  takeId: string | null;
  /** VJ deck A column launched with the scene, or null to leave the visuals. */
  vjColumn: number | null;
}

export const SCENE_NAMES = ['Arrival', 'Breath', 'Bloom', 'Drift', 'Release', 'Dawn', 'Pressure', 'Peak', 'Break', 'Return'];

/** The next free name from the list, then "Scene N". */
export function nextSceneName(scenes: MusicScene[]): string {
  const used = new Set(scenes.map((s) => s.name));
  const free = SCENE_NAMES.find((n) => !used.has(n));
  if (free) return free;
  let n = scenes.length + 1;
  while (used.has(`Scene ${n}`)) n++;
  return `Scene ${n}`;
}

export interface PlayingNow {
  pattern: DrumPattern;
  beat: boolean;
  takeId: string | null;
  /** The column most of deck A's layers are playing, or null. */
  vjColumn: number | null;
}

export function captureScene(id: string, name: string, now: PlayingNow): MusicScene {
  return {
    id,
    name,
    pattern: normalizePattern(now.pattern),
    beat: now.beat,
    takeId: now.takeId,
    vjColumn: now.vjColumn,
  };
}

/** The column most playing layers share, so a scene captures "the look" even with one odd layer. */
export function dominantColumn(activeColumns: Array<number | null | undefined>): number | null {
  const counts = new Map<number, number>();
  for (const c of activeColumns) if (typeof c === 'number' && c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [column, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && column < best)) {
      best = column;
      bestCount = count;
    }
  }
  return best;
}

export type SceneAction =
  | { kind: 'pattern'; pattern: DrumPattern }
  | { kind: 'beat'; play: boolean }
  | { kind: 'take'; takeId: string | null }
  | { kind: 'visuals'; column: number };

/**
 * What launching `scene` changes, given what is playing. Only differences
 * become actions, so a scene that shares the beat keeps it running unbroken.
 * A take that no longer exists is treated as none.
 */
export function sceneLaunchActions(scene: MusicScene, now: PlayingNow, takeIds: ReadonlySet<string>): SceneAction[] {
  const actions: SceneAction[] = [];
  if (scene.pattern && JSON.stringify(scene.pattern) !== JSON.stringify(normalizePattern(now.pattern))) {
    actions.push({ kind: 'pattern', pattern: scene.pattern });
  }
  if (scene.beat !== now.beat) actions.push({ kind: 'beat', play: scene.beat });
  const take = scene.takeId && takeIds.has(scene.takeId) ? scene.takeId : null;
  if (take !== now.takeId) actions.push({ kind: 'take', takeId: take });
  if (scene.vjColumn !== null && scene.vjColumn !== now.vjColumn) actions.push({ kind: 'visuals', column: scene.vjColumn });
  return actions;
}

export function normalizeScene(raw: unknown): MusicScene | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<MusicScene>;
  if (typeof s.id !== 'string' || !s.id) return null;
  const column = Number(s.vjColumn);
  return {
    id: s.id,
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : 'Scene',
    pattern: s.pattern ? normalizePattern(s.pattern) : null,
    beat: s.beat === true,
    takeId: typeof s.takeId === 'string' && s.takeId ? s.takeId : null,
    vjColumn: s.vjColumn !== null && s.vjColumn !== undefined && Number.isInteger(column) && column >= 0 ? column : null,
  };
}
