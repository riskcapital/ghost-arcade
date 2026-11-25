/**
 * Build-time feature switches. Set in the environment when Vite builds (or
 * runs). Audio Lab and Analog Synth are no longer build switches: they ship
 * in every build and unlock with a licence or trial (lib/addons).
 */

/**
 * The Interactive feature: Interactive and Interactive 3D layers in Add
 * layer, their layer panels, the Interactive Studio editor and its room-scan
 * Depth mode. On by default; VITE_INTERACTIVE=0 (or off/false) hides its entry
 * points again. Hidden, all of its code stays, and a project saved with
 * Interactive layers opens, plays and saves them as they were.
 */
export function interactiveFeatureEnabled(): boolean {
  return !['0', 'off', 'false'].includes(String(import.meta.env.VITE_INTERACTIVE ?? '').toLowerCase());
}
