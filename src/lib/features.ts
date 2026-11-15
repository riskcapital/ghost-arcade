/**
 * Build-time feature switches. Set in the environment when Vite builds (or
 * runs), so a release can leave a feature out entirely.
 *
 * VITE_MUSIC_STUDIO=off  leaves out Audio Lab (its VJ dock button, its
 * full view and deck strip, its plugin and band-keys MIDI input).
 * Everything else still works; a project saved with Audio Lab layers opens,
 * and those layers stay as they were. On by default.
 */

export const MUSIC_STUDIO = (import.meta.env.VITE_MUSIC_STUDIO ?? 'on') !== 'off';

/**
 * VITE_ANALOG_SYNTH=off leaves out Analog Synth, the video synthesizer
 * add-on: not offered, not drawn, not in the param pickers. Its saved layers
 * keep their settings (plugins/addons.ts). On by default.
 */
export const ANALOG_SYNTH = (import.meta.env.VITE_ANALOG_SYNTH ?? 'on') !== 'off';
