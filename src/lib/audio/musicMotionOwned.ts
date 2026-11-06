/**
 * The shader params Music motion is driving this frame, so audio modulation
 * leaves them alone. A module of its own, with no imports, so modulation.ts
 * can ask without loading the engine (and the stores it reads).
 */

/** `map:<layer index>:<param>` and `<A|B>:<layer index>:<param>`. */
export const musicMotionOwned = new Set<string>();

/** True when Music motion drives this shader param, so audio modulation leaves it alone. */
export function musicMotionOwnsParam(target: 'map' | 'A' | 'B', layerIndex: number, paramName: string): boolean {
  return musicMotionOwned.size > 0 && musicMotionOwned.has(`${target}:${layerIndex}:${paramName}`);
}
