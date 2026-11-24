/**
 * The paid add-ons by the effect type their layers carry. A layer saved
 * with an add-on that is locked on this computer keeps its settings as they
 * are: it draws nothing, offers no controls, and comes back whole once the
 * add-on is unlocked (addons/addonAccess.ts).
 */
import { addonForEffectType, addonUsable, type AddonProductId } from '../addons/addonAccess';

export type AddonInfo = { id: AddonProductId; name: string; installed: boolean };

/** The add-on an effect type belongs to, or null for one that is built in. `installed`: usable now. */
export function addonFor(effectType: unknown): AddonInfo | null {
  const product = addonForEffectType(effectType);
  return product ? { id: product.id, name: product.name, installed: addonUsable(product.id) } : null;
}

/** The name of the add-on an effect type needs when it is locked here; null when usable (or built in). */
export function missingAddon(effectType: unknown): string | null {
  const addon = addonFor(effectType);
  return addon && !addon.installed ? addon.name : null;
}

/**
 * Whether the audio-reactive engine instruments (Strands, Cloud Pulse, Cloud
 * Flock, Depth Lights, and later ones) are offered. They are part of Audio
 * Lab, so they follow its gate; this is the one place to change when add-on
 * licensing replaces the build flag.
 */
export function audioReactiveInstrumentsAvailable(): boolean {
  return addonFor('music-studio')?.installed === true;
}
