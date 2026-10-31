/**
 * The parts of the studio a song keeps, by what calling it up puts back.
 * A module of its own (no imports) so the unsaved-changes check can use it.
 */
export const SONG_SETUP_GROUPS = {
  sound: [
    'set',
    'key',
    'scaleLock',
    'instrument',
    'synthPatch',
    'keysPatch',
    'volumes',
    'params',
    'mixer',
    'cables',
    'macroFx',
    'pattern',
    'acidSteps',
    'drumMutes',
    'bowlSlots',
    'fxPads',
    'dronePatch',
  ],
  band: ['liveInputs', 'bandFx'],
  visuals: ['visuals'],
} as const;
