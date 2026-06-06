// Registry of built-in preset stages. Add new presets by importing
// them here; the picker UI iterates `STAGE_PRESETS` directly.

import type { Stage3DScene } from '../types';
import { FESTIVAL_PRESET } from './festival';
import { ARENA_PRESET } from './arena';
import { CLUB_PRESET } from './club';

export interface StagePresetEntry {
  preset: Stage3DScene;
  /** Short tagline for the preset card. */
  description: string;
  /** Cosmetic gradient colours for the preset card's thumbnail
   *  placeholder until we ship real renders. */
  thumbnailGradient: [string, string];
}

export const STAGE_PRESETS: StagePresetEntry[] = [
  {
    preset: FESTIVAL_PRESET,
    description: 'Wide curved backdrop, side stacks, delay walls. Outdoor mainstage.',
    thumbnailGradient: ['#FF8577', '#BB86FC'],
  },
  {
    preset: ARENA_PRESET,
    description: 'Hero wall + IMAG, stage ribbons, riser screen. Indoor venue.',
    thumbnailGradient: ['#1A5C8E', '#69F0AE'],
  },
  {
    preset: CLUB_PRESET,
    description: 'Wrap-around booth, ceiling strip, pillar screens. Dancefloor intimacy.',
    thumbnailGradient: ['#5A1A8E', '#FF6E6E'],
  },
];

export function clonePreset(id: string): Stage3DScene | null {
  const entry = STAGE_PRESETS.find(p => p.preset.id === id);
  if (!entry) return null;
  // Deep clone via JSON so the active scene doesn't share refs with
  // the immutable template — otherwise edits would mutate the preset.
  return JSON.parse(JSON.stringify(entry.preset));
}
