// Which surfaces play a clip of their own this frame. Pure, so the cap and the order are tested.
import { MOBILE_SHADERS } from '../standaloneShaderList';
import { forgetSurfaceClip, surfaceClipAllowed, uid, type Clip, type Show } from './model';

/** What can be put on a surface: the deck mix, a library visual, or a clip of this set. */
export type SurfaceChoice = { deck: true } | { shader: string } | { clip: string };

export type SurfaceClipPlan = {
  /** Clip ids that get a render, in the order their first surface appears. */
  playing: string[];
  /** Indexes of surfaces whose clip is over the cap: they show their deck source instead. */
  capped: number[];
  /** Different playable clips the surfaces ask for. */
  wanted: number;
  cap: number;
};

/**
 * Surfaces earlier in the list win: the first `cap` different clips play, and every surface
 * showing one of them shares its render. A clip this device cannot run, or a live camera, never
 * counts against the cap; its surface shows its deck source.
 */
export function planSurfaceClips(show: Pick<Show, 'mapping' | 'surfaces' | 'clips'>, cap: number): SurfaceClipPlan {
  const limit = Math.max(0, Math.floor(cap));
  if (!show.mapping) return { playing: [], capped: [], wanted: 0, cap: limit };
  const playing: string[] = [],
    capped: number[] = [],
    wanted = new Set<string>();
  show.surfaces.forEach((surface, index) => {
    const id = surface.clipId;
    if (!surface.enabled || !id || !surfaceClipAllowed(show.clips.find((c) => c.id === id))) return;
    wanted.add(id);
    if (playing.includes(id)) return;
    if (playing.length < limit) playing.push(id);
    else capped.push(index);
  });
  return { playing, capped, wanted: wanted.size, cap: limit };
}

/** Same plan, same answer: lets the owner skip work when nothing changed. */
export const planKey = (plan: SurfaceClipPlan) => `${plan.cap}|${plan.playing.join(',')}|${plan.capped.join(',')}`;

/** The line shown when the cap is reached, or '' when every surface clip plays. */
export function surfaceCapMessage(plan: SurfaceClipPlan, device = 'This device'): string {
  if (!plan.capped.length) return '';
  const surfaces = plan.capped.map((i) => i + 1);
  const list = surfaces.length === 1 ? `Surface ${surfaces[0]} shows` : `Surfaces ${surfaces.slice(0, -1).join(', ')} and ${surfaces.at(-1)} show`;
  return `${device} plays ${plan.cap} different surface clips at once. ${list} the deck instead.`;
}

/** The set's clip for a library shader: an existing plain one (no imported picture), or a new one. */
export function libraryClip(clips: Clip[], shaderId: string): { clip: Clip; added: boolean } | null {
  const shader = MOBILE_SHADERS.find((s) => s.id === shaderId);
  if (!shader || shader.requiresImage) return null;
  const existing = clips.find((c) => c.kind === 'shader' && c.shaderId === shaderId && !c.assetId);
  if (existing) return { clip: existing, added: false };
  return { clip: { id: uid(), shaderId, name: shader.name, kind: 'shader' }, added: true };
}

/**
 * The set with `choice` on surface `index`: the deck mix takes the surface's own clip off; a
 * library visual reuses (or adds) its clip; a clip of this set must be one a surface can play.
 * Returns the set unchanged when the choice cannot go there.
 */
export function putOnSurface(show: Pick<Show, 'clips' | 'surfaces'>, index: number, choice: SurfaceChoice): Pick<Show, 'clips' | 'surfaces'> {
  const surface = show.surfaces[index];
  if (!surface) return show;
  if ('deck' in choice) {
    if (!surface.clipId) return show;
    const surfaces = [...show.surfaces];
    surfaces[index] = forgetSurfaceClip([surface], surface.clipId)[0];
    return { clips: show.clips, surfaces };
  }
  let clips = show.clips;
  let clip: Clip | undefined;
  if ('shader' in choice) {
    const found = libraryClip(clips, choice.shader);
    if (!found) return show;
    clip = found.clip;
    if (found.added) clips = [...clips, clip];
  } else clip = clips.find((c) => c.id === choice.clip);
  if (!surfaceClipAllowed(clip)) return show;
  const surfaces = [...show.surfaces];
  surfaces[index] = { ...surface, clipId: clip.id };
  return { clips, surfaces };
}
