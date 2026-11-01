/**
 * The parts of the studio a song keeps, by what calling it up puts back.
 * A module of its own (no imports) so the unsaved-changes check can use it.
 */
export const SONG_SETUP_GROUPS = {
  sound: [
    'set',
    'key',
    'scaleLock',
    'keyMode',
    'instrument',
    'synthPatch',
    'keysPatch',
    'synthTone',
    'keysTone',
    'drumKit',
    'volumes',
    'params',
    'mixer',
    'returns',
    'cables',
    'macroFx',
    'inserts',
    'dress',
    'pattern',
    'acidSteps',
    'acidOn',
    'drumMutes',
    'bowlSlots',
    'fxPads',
    'dubShots',
    'build',
    'dronePatch',
  ],
  band: ['liveInputs', 'bandFx'],
  visuals: ['visuals'],
} as const;
