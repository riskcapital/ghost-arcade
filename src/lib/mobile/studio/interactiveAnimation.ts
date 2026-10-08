import type { KeyframeTrack } from '../../types';
import type { InteractiveEffect } from './interactiveEffects';
import { effectParams } from './interactiveEffects';
import { KEYFRAME_EASINGS } from '../../keyframes/easing';
export type InteractiveAnimation = { duration: number; loop: boolean; tracks: KeyframeTrack[] };
export function validateInteractiveAnimation(
  raw: unknown,
  effects: InteractiveEffect[],
): InteractiveAnimation | undefined {
  if (raw === undefined) return undefined;
  const a = raw as InteractiveAnimation;
  if (
    !a ||
    !Number.isFinite(a.duration) ||
    a.duration <= 0 ||
    a.duration > 86400 ||
    !Array.isArray(a.tracks) ||
    a.tracks.length > 256
  )
    throw Error('Invalid interactive animation.');
  const tracks: KeyframeTrack[] = [],
    seen = new Set<string>();
  for (const t of a.tracks) {
    const [prefix, id, key] = String(t.key).split(':');
    const e = effects.find((e) => e.id === id);
    if (prefix !== 'interactive' || !e) continue;
    const d = effectParams(e.kind).find((d) => d.key === key);
    if (!d && key !== 'enabled') continue;
    if (
      seen.has(t.key) ||
      t.type !== (key === 'enabled' ? 'boolean' : 'number') ||
      !Array.isArray(t.keyframes) ||
      !Array.isArray(t.boolKeyframes) ||
      t.keyframes.length + t.boolKeyframes.length > 4096
    )
      throw Error('Invalid interactive keyframe track.');
    seen.add(t.key);
    const keyframes = t.keyframes
      .map((k) => {
        if (
          !Number.isFinite(k.time) ||
          k.time < 0 ||
          k.time > a.duration ||
          !Number.isFinite(k.value) ||
          !KEYFRAME_EASINGS.some((e) => e.value === k.easing)
        )
          throw Error('Invalid interactive keyframe.');
        return { time: k.time, value: Math.max(d?.min ?? 0, Math.min(d?.max ?? 1, k.value)), easing: k.easing };
      })
      .sort((a, b) => a.time - b.time);
    const boolKeyframes = t.boolKeyframes
      .map((k) => {
        if (!Number.isFinite(k.time) || k.time < 0 || k.time > a.duration || typeof k.value !== 'boolean')
          throw Error('Invalid interactive toggle keyframe.');
        return { time: k.time, value: k.value };
      })
      .sort((a, b) => a.time - b.time);
    tracks.push({ key: t.key, label: String(t.label).slice(0, 100), type: t.type, keyframes, boolKeyframes });
  }
  return { duration: a.duration, loop: a.loop !== false, tracks };
}
