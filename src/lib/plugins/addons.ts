/**
 * The add-ons a build can leave out (src/lib/features.ts), by the effect type
 * their layers carry. A layer saved with an add-on this build does not have
 * keeps its settings as they are: it draws nothing, offers no controls, and
 * comes back whole in a build that has the add-on.
 */
import { ANALOG_SYNTH, MUSIC_STUDIO } from '../features';

export type AddonInfo = { name: string; installed: boolean };

const ADDONS: Readonly<Record<string, AddonInfo>> = {
  'music-studio': { name: 'Audio Lab', installed: MUSIC_STUDIO },
  videosynth: { name: 'Analog Synth', installed: ANALOG_SYNTH },
};

/** The add-on an effect type belongs to, or null for one that is built in. */
export function addonFor(effectType: unknown): AddonInfo | null {
  return ADDONS[String(effectType ?? '').trim().toLowerCase()] ?? null;
}

/** The name of the add-on an effect type needs when this build lacks it; null when it is here (or built in). */
export function missingAddon(effectType: unknown): string | null {
  const addon = addonFor(effectType);
  return addon && !addon.installed ? addon.name : null;
}
