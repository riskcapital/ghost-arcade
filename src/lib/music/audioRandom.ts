/**
 * Noise for effects that make it (reverb impulses, a build's bursts). Live it
 * is Math.random. On an OfflineAudioContext (the Timeline's soundtrack in a
 * render) it is a sequence seeded by what the noise is for, so the same
 * reverb makes the same impulse in every piece of the render and in every
 * render of the show.
 */

/** A small seeded random source (xorshift32), 0 ≤ x < 1. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

export function hashString(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function isOffline(ctx: BaseAudioContext): boolean {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  return !!Offline && ctx instanceof Offline;
}

/** Math.random for a live context; for an offline one, a sequence seeded by `key`. */
export function effectRandom(ctx: BaseAudioContext, key: string): () => number {
  return isOffline(ctx) ? seededRandom(hashString(key)) : Math.random;
}
