/**
 * Build-time feature switches. Set in the environment when Vite builds (or
 * runs). Audio Lab and Analog Synth are no longer build switches: they ship
 * in every build and unlock with a licence or trial (lib/addons).
 */

/**
 * The Interactive feature (Interactive and Interactive 3D layers, the
 * Interactive Studio editor and its room-scan Depth mode) is hidden in
 * releases: its entry points are not offered. All of its code stays, and a
 * project saved with Interactive layers opens, plays and saves them as they
 * were. Off by default; VITE_INTERACTIVE=1 (or on/true) turns it on for
 * development.
 */
export function interactiveFeatureEnabled(): boolean {
  return ['1', 'on', 'true'].includes(String(import.meta.env.VITE_INTERACTIVE ?? '').toLowerCase());
}
