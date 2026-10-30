/**
 * The studio's instruments and their sounds, as the panel lists them.
 */

import type { InstrumentId } from './noteEvents';

export const INSTRUMENT_LABELS: Record<InstrumentId, string> = {
  synth: 'Synth',
  keys: 'Keys',
  drums: 'Drums',
  drone: 'Drone',
  bowls: 'Bowls',
  acid: 'Acid',
  xy: 'XY tone',
  dubbass: 'Dub bass',
  siren: 'Siren',
  shots: 'Shots',
  analog: 'Analog',
  scan: 'Scan synth',
};

export type SynthPatch = 'pad' | 'pluck' | 'bass' | 'lead';
export type KeysPatch = 'epiano' | 'organ' | 'bell';

export const SYNTH_PATCHES: { id: SynthPatch; label: string }[] = [
  { id: 'pad', label: 'Pad' },
  { id: 'pluck', label: 'Pluck' },
  { id: 'bass', label: 'Bass' },
  { id: 'lead', label: 'Lead' },
];

export const KEYS_PATCHES: { id: KeysPatch; label: string }[] = [
  { id: 'epiano', label: 'Electric piano' },
  { id: 'organ', label: 'Organ' },
  { id: 'bell', label: 'Bells' },
];
