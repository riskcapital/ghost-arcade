/**
 * Which output-stage overlay the arrow keys belong to.
 *
 * The Master Warp handles and the Screen handles are on the canvas at the
 * same time and both nudge with the arrow keys. Without an owner one key
 * press moved the selected screen (or its mesh point) and the Master Warp
 * together, and landed as two undo steps. The overlay pressed last, or the
 * screen picked last in the panel, owns the keys; null (nothing touched
 * yet) leaves both listening as before.
 */
export type WarpKeyOwner = 'master' | 'screen' | null;

let owner: WarpKeyOwner = null;

export function claimWarpKeys(next: Exclude<WarpKeyOwner, null>): void {
  owner = next;
}

/** True unless the other overlay has claimed the arrow keys. */
export function ownsWarpKeys(who: Exclude<WarpKeyOwner, null>): boolean {
  return owner === null || owner === who;
}
