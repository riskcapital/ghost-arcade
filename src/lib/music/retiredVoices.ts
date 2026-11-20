/**
 * Audio shaders that are no longer shipped, and the one a saved project gets
 * in their place, so a layer that used one still shows something close.
 * A module of its own (no imports): both saved voices and saved clip stacks
 * are read through it.
 */
const RETIRED: Record<string, string> = {
  'VX-Northlight.fs': 'VX-Aurora.fs',
  'VX-AuroraWater.fs': 'VX-Aurora.fs',
  'VX-BeamOrgan.fs': 'VX-HazeBeams.fs',
  'VX-Lighthouse.fs': 'VX-HazeBeams.fs',
  'VX-Aperture.fs': 'VX-Breath.fs',
  'VX-LightRoom.fs': 'VX-Slabs.fs',
  'VX-ChromePool.fs': 'VX-MoltenChrome.fs',
  'VX-Prism.fs': 'VX-Slabs.fs',
  'VX-Harp.fs': 'VX-LightLines.fs',
  'VX-DiodeField.fs': 'VX-LedWall.fs',
};

/** The shader a saved file name stands for now. */
export const currentVoiceFile = (file: string): string => RETIRED[file] ?? file;

export const RETIRED_VOICE_FILES: readonly string[] = Object.keys(RETIRED);
