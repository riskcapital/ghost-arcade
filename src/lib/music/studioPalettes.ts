/**
 * The studio's colour: a palette of five colours per instance, which every
 * voice takes from by its role, so a scene is one coherent picture without
 * tuning each voice.
 *
 *   ground  the room: the atmosphere the pads and chords draw
 *   body    the main mass: the bass
 *   accent  events: kicks, snares, effects
 *   light   fine bright things: the lead, what you play, hats
 *   shadow  the darkest tint
 *
 * A voice's shader reads two colours, `ink` and `accent`; they come from the
 * slots for its role. All five also go to every voice as `palGround`,
 * `palBody`, `palAccent`, `palLight` and `palShadow` for shaders that use them.
 *
 * Twelve palettes ship. "Auto" is the set's own palette, "Key colour" takes
 * its hue from the song key (around the circle of fifths, so related keys get
 * related colours; a key change glides over about a bar), and "Classic" is
 * the set's original two colours, which older projects keep.
 */
import type { MusicKey, StudioSet } from './studioSets';
import type { VoiceSourceId } from './visualVoices';

export type RGB = [number, number, number];

export interface PaletteSlots {
  ground: RGB;
  body: RGB;
  accent: RGB;
  light: RGB;
  shadow: RGB;
}

export interface StudioPalette extends PaletteSlots {
  id: string;
  name: string;
}

export const STUDIO_PALETTE_LIST: readonly StudioPalette[] = [
  { id: 'tungsten', name: 'Tungsten', ground: [0.42, 0.24, 0.1], body: [1, 0.62, 0.28], accent: [1, 0.86, 0.55], light: [1, 0.93, 0.82], shadow: [0.07, 0.035, 0.015] },
  { id: 'sodium-street', name: 'Sodium street', ground: [0.4, 0.2, 0.04], body: [1, 0.55, 0.1], accent: [0.25, 0.55, 0.95], light: [1, 0.82, 0.5], shadow: [0.06, 0.03, 0] },
  { id: 'cobalt-chrome', name: 'Cobalt and chrome', ground: [0.1, 0.2, 0.5], body: [0.2, 0.42, 1], accent: [0.85, 0.9, 1], light: [0.92, 0.95, 1], shadow: [0.01, 0.02, 0.07] },
  { id: 'lavender-lab', name: 'Lavender lab', ground: [0.55, 0.5, 0.7], body: [0.72, 0.55, 1], accent: [1, 0.62, 0.85], light: [0.97, 0.95, 1], shadow: [0.18, 0.14, 0.28] },
  { id: 'blood-orange', name: 'Blood orange', ground: [0.45, 0.08, 0.05], body: [1, 0.35, 0.12], accent: [1, 0.15, 0.3], light: [1, 0.82, 0.7], shadow: [0.08, 0.01, 0.01] },
  { id: 'deep-sea', name: 'Deep sea', ground: [0.05, 0.32, 0.45], body: [0.1, 0.75, 0.8], accent: [0.45, 1, 0.75], light: [0.8, 1, 0.98], shadow: [0, 0.04, 0.07] },
  { id: 'forest-night', name: 'Forest night', ground: [0.1, 0.32, 0.16], body: [0.3, 0.85, 0.45], accent: [0.95, 0.85, 0.4], light: [0.85, 1, 0.88], shadow: [0.01, 0.04, 0.02] },
  { id: 'bone-ink', name: 'Bone and ink', ground: [0.3, 0.28, 0.25], body: [0.92, 0.88, 0.8], accent: [0.75, 0.2, 0.15], light: [1, 0.98, 0.94], shadow: [0.03, 0.03, 0.03] },
  { id: 'neon-fault', name: 'Neon fault', ground: [0.3, 0.06, 0.42], body: [1, 0.15, 0.6], accent: [0.1, 0.95, 1], light: [0.95, 0.85, 1], shadow: [0.03, 0, 0.06] },
  { id: 'rose-gold', name: 'Rose gold', ground: [0.45, 0.24, 0.24], body: [1, 0.62, 0.55], accent: [1, 0.82, 0.5], light: [1, 0.93, 0.9], shadow: [0.08, 0.04, 0.04] },
  { id: 'arctic', name: 'Arctic', ground: [0.14, 0.28, 0.45], body: [0.6, 0.85, 1], accent: [0.4, 1, 0.85], light: [0.95, 0.99, 1], shadow: [0.02, 0.04, 0.07] },
  { id: 'mono-accent', name: 'Mono with one accent', ground: [0.3, 0.3, 0.3], body: [0.85, 0.85, 0.85], accent: [1, 0.25, 0.15], light: [1, 1, 1], shadow: [0.03, 0.03, 0.03] },
];

/** The set's own palette. */
export const AUTO_PALETTE = 'auto';
/** The hue follows the song key. */
export const KEY_PALETTE = 'key';
/** The set's original two colours, as before palettes; older projects keep it. */
export const CLASSIC_PALETTE = 'classic';

export const SET_PALETTE: Record<StudioSet, string> = {
  bath: 'deep-sea',
  berlin: 'neon-fault',
  dub: 'sodium-street',
  analog: 'cobalt-chrome',
  machine: 'tungsten',
};

/** The set's original two colours. */
export const CLASSIC_COLORS: Record<StudioSet, { ink: RGB; accent: RGB }> = {
  bath: { ink: [0.72, 0.82, 1.0], accent: [1.0, 0.8, 0.45] },
  berlin: { ink: [0.94, 0.95, 0.97], accent: [1.0, 0.16, 0.1] },
  dub: { ink: [1.0, 0.72, 0.36], accent: [0.25, 0.9, 0.62] },
  analog: { ink: [0.75, 1.0, 0.92], accent: [1.0, 0.45, 0.12] },
  machine: { ink: [1.0, 0.93, 0.82], accent: [1.0, 0.5, 0.1] },
};

export function isPaletteId(id: unknown): id is string {
  return id === AUTO_PALETTE || id === KEY_PALETTE || id === CLASSIC_PALETTE || STUDIO_PALETTE_LIST.some((p) => p.id === id);
}

function hsl(h: number, s: number, l: number): RGB {
  const hue = ((h % 1) + 1) % 1;
  const k = (n: number) => (n + hue * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/** Where a key sits on the circle of fifths, as a hue 0-1: C, G, D… step round it. */
export function keyHue(key: MusicKey): number {
  return (((key.root * 7) % 12) + 12) % 12 / 12;
}

/**
 * Five colours from one hue. Major and Lydian keys sit warmer and brighter,
 * minor and Dorian cooler and deeper.
 */
export function paletteFromHue(hue: number, scale: MusicKey['scale']): PaletteSlots {
  const bright = scale === 'major' || scale === 'lydian' || scale === 'pentatonic';
  const lift = bright ? 0.04 : -0.03;
  const sat = bright ? 0.85 : 0.75;
  return {
    ground: hsl(hue, sat * 0.65, 0.3 + lift),
    body: hsl(hue, sat, 0.56 + lift),
    accent: hsl(hue + 0.45, 0.85, 0.6 + lift),
    light: hsl(hue, 0.45, 0.9),
    shadow: hsl(hue, 0.5, 0.06),
  };
}

/** The five colours for an instance. `keyHueNow` is the key's hue as it glides (see KeyHueGlide). */
export function resolvePalette(id: string, set: StudioSet, key: MusicKey, keyHueNow = keyHue(key)): PaletteSlots {
  if (id === KEY_PALETTE) return paletteFromHue(keyHueNow, key.scale);
  if (id === CLASSIC_PALETTE) {
    const c = CLASSIC_COLORS[set] ?? CLASSIC_COLORS.berlin;
    return { ground: c.ink, body: c.ink, accent: c.accent, light: c.ink, shadow: [0.02, 0.02, 0.02] };
  }
  const named = STUDIO_PALETTE_LIST.find((p) => p.id === (id === AUTO_PALETTE ? SET_PALETTE[set] : id));
  return named ?? STUDIO_PALETTE_LIST.find((p) => p.id === SET_PALETTE[set])!;
}

type Role = 'ground' | 'body' | 'accent' | 'light';
const ROLE: Partial<Record<VoiceSourceId, Role>> = {
  all: 'ground', pad: 'ground', chords: 'ground', drone: 'ground', bowls: 'ground',
  bass: 'body', dubbass: 'body', acid: 'body', analog: 'body', siren: 'body',
  kick: 'accent', snare: 'accent', perc: 'accent', fx: 'accent', drop: 'accent', echo: 'accent',
  lead: 'light', played: 'light', hats: 'light', xy: 'light', scan: 'light',
};

/**
 * A colour at full brightness, its hue and saturation kept. A voice's ink
 * multiplies what it draws, so a dark ink would only dim it: the ground's
 * darkness belongs to the room (the shaders that read palGround), not to the
 * voice drawing in its colour.
 */
export function atFullBrightness(rgb: RGB): RGB {
  const top = Math.max(rgb[0], rgb[1], rgb[2]);
  return top > 0 ? [rgb[0] / top, rgb[1] / top, rgb[2] / top] : [1, 1, 1];
}

/** A voice's two colours, by the role its sound plays. Classic keeps the set's two colours for every voice. */
export function voiceColors(id: string, slots: PaletteSlots, source: VoiceSourceId): { ink: RGB; accent: RGB } {
  if (id === CLASSIC_PALETTE) return { ink: slots.body, accent: slots.accent };
  const role = ROLE[source] ?? 'body';
  const pick = role === 'ground' ? { ink: slots.ground, accent: slots.body }
    : role === 'body' ? { ink: slots.body, accent: slots.accent }
      : role === 'accent' ? { ink: slots.accent, accent: slots.light }
        : { ink: slots.light, accent: slots.accent };
  return { ink: atFullBrightness(pick.ink), accent: pick.accent };
}

/**
 * The key's hue as shown: a key change glides there over about a bar,
 * the short way round the colour wheel.
 */
export class KeyHueGlide {
  private hue: number | null = null;
  private at = 0;

  step(target: number, now: number, seconds = 2): number {
    if (this.hue === null) {
      this.hue = target;
      this.at = now;
      return target;
    }
    const dt = Math.max(0, Math.min(0.25, (now - this.at) / 1000));
    this.at = now;
    let d = target - this.hue;
    d -= Math.round(d);
    const k = 1 - Math.exp(-dt / (seconds / 4));
    this.hue = (((this.hue + d * k) % 1) + 1) % 1;
    if (Math.abs(d) < 0.001) this.hue = target;
    return this.hue;
  }
}
