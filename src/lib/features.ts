/**
 * Build-time feature switches. Set in the environment when Vite builds (or
 * runs), so a release can leave a feature out entirely.
 *
 * VITE_MUSIC_STUDIO=off  leaves out the Music Studio (the VJ Music button,
 * the Studio view and deck strip, the Music Studio plugin and band-keys MIDI
 * input). Everything else still works; a project saved with Music Studio
 * layers opens, and those layers stay as they were. On by default.
 */

export const MUSIC_STUDIO = (import.meta.env.VITE_MUSIC_STUDIO ?? 'on') !== 'off';
