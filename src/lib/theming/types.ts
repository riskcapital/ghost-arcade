// Theme template types. Each theme is just a bag of CSS variables that
// gets applied to :root at the document level. Components reference
// `var(--*)` rather than hard-coding colours, so any theme swaps the
// whole UI without changing markup.
//
// The token list intentionally mirrors the v10 / faceplate mock files —
// surfaces / lines / ink ladder / accent colours / corner ratio /
// fonts. New themes only need to fill these tokens to slot in.

export interface ThemeTokens {
  /** Font stacks. UI font carries the body, display is for headers /
   *  faceplate labels, mono is for indices / vals / status numerics.
   *  `led` is optional for retro segment readouts. */
  fontUi: string;
  fontDisplay?: string;
  fontMono: string;
  fontLed?: string;

  /** Depth ladder, dark to light. `void` is the app background, `bar`
   *  is the title/status bar, `panel` is rails, `card` is sub-surfaces
   *  inside rails, `sub` and `raise` give two more layers of contrast,
   *  `slot` is for sunken control insets (faders, fields). */
  void: string;
  bar: string;
  panel: string;
  card: string;
  sub: string;
  raise: string;
  slot: string;

  /** Hairlines at three opacities for separating zones. */
  line: string;
  line2: string;
  line3: string;

  /** Ink ladder: 0 = brightest text, 3 = barely visible disabled. */
  ink0: string;
  ink1: string;
  ink2: string;
  ink3: string;

  /** Corner radii. Hard for structure (chips/fields), soft for actions
   *  (buttons), tile for thumbnails, pill for badges. */
  rHard: string;
  rSoft: string;
  rTile: string;
  rPill: string;

  /** Functional accent palette. Each accent has the colour, a soft
   *  background tint, and an edge line tint. */
  violet: string;       violetSoft: string;       violetLine: string;
  blue:   string;       blueSoft:   string;       blueLine:   string;
  coral:  string;       coralSoft:  string;       coralLine:  string;
  green:  string;
  cyan:   string;
  pink:   string;
  rec:    string;

  /** Optional shadow / glow strings — themes can leave these blank and
   *  consumers fall back to the default. Retro themes use them for the
   *  CRT scanline glow. */
  metalHi?: string;
  coralGlow?: string;
}

export interface Theme {
  id: string;
  name: string;
  description?: string;
  /** Tokens that get written to :root as CSS custom properties. */
  tokens: ThemeTokens;
  /** Bridge to the legacy CSS variable system (--bg-primary,
   *  --text-primary, etc.). Components written before the token system
   *  reference these names; populating them from each theme means a
   *  theme swap instantly re-skins legacy components without per-file
   *  migration. Values are raw CSS strings (any colour notation OK). */
  legacyVars?: Record<string, string>;
  /** Optional extra CSS the theme wants applied at :root level (e.g.
   *  Arcade's grain noise / CRT layers). Kept opt-in so the default
   *  theme doesn't pay for it. */
  extraCss?: string;
}
