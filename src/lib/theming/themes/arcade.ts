// Arcade — retro faceplate. Warm-toned depths, same Geist +
// Geist Mono type system, ghost-chrome marquee accents: ghostly
// white with a metallic light blue-grey gradient.

import type { Theme } from '../types';

export const ARCADE_THEME: Theme = {
  id: 'arcade',
  name: 'Arcade',
  description: 'Retro arcade faceplate — warm depths, LED segment numerals, ghost-chrome marquee.',
  tokens: {
    fontUi:      "'Geist', system-ui, sans-serif",
    fontDisplay: "'Geist', system-ui, sans-serif",
    fontMono:    "'Geist Mono', ui-monospace, monospace",
    fontLed:     "'Geist Mono', ui-monospace, monospace",

    void:  '#0a0908',
    bar:   '#100f0d',
    panel: '#100f0d',
    card:  '#16140f',
    sub:   '#1e1b16',
    raise: '#26221c',
    slot:  '#060504',

    line:  'rgba(245,236,222,.07)',
    line2: 'rgba(245,236,222,.13)',
    line3: 'rgba(245,236,222,.24)',

    ink0: '#f2ede4',
    ink1: '#998f81',
    ink2: '#5e564a',
    ink3: '#39342c',

    rHard: '3px',
    rSoft: '3px',
    rTile: '3px',
    rPill: '3px',

    // Ghost chrome is the single "live" accent — a ghostly white core
    // with metallic light blue-grey support. violet/pink map onto it
    // so every accent surface reads as the same cold marquee metal.
    violet:     '#e7eef5',
    violetSoft: 'rgba(206,222,236,.12)',
    violetLine: 'rgba(206,222,236,.45)',
    blue:       '#5278ff',
    blueSoft:   'rgba(82,120,255,.28)',
    blueLine:   'rgba(82,120,255,.10)',
    coral:      '#e7eef5',
    coralSoft:  'rgba(206,222,236,.12)',
    coralLine:  'rgba(206,222,236,.45)',
    green:      '#46d18a',
    cyan:       '#9fb6c9',
    pink:       '#e7eef5',
    rec:        '#ff3b30',

    metalHi:   'rgba(255,255,255,.16)',
    coralGlow: 'rgba(176,200,222,.45)',
  },
  // Bridge — only the depth ladder + ink so the Accent scheme picker
  // still owns the accent colours. The warm Arcade ladder reads great
  // with any of the existing accents.
  legacyVars: {
    '--bg-primary':       '#0a0908',
    '--bg-secondary':     '#100f0d',
    '--bg-tertiary':      '#16140f',
    '--bg-overlay':       'rgba(10,9,8,.88)',
    '--text-primary':     '#f2ede4',
    '--text-secondary':   '#998f81',
    '--text-muted':       '#5e564a',
    '--border-secondary': 'rgba(245,236,222,.13)',
  },
  // Metallic gradient pass — solid accent FILLS pick up the chrome
  // gradient (a flat CSS color var can't hold a gradient, so the
  // handful of filled controls get it here). Text/line accents stay
  // the solid ghost white from the tokens above.
  extraCss: `
[data-theme="arcade"] {
  --ga-accent-gradient: linear-gradient(135deg, #f6fafd 0%, #cfdde9 42%, #92aabf 100%);
}
html[data-theme="arcade"] .vj-btn {
  background: var(--ga-accent-gradient) !important;
  border-color: rgba(214,228,240,.65) !important;
  color: #16202b !important;
}
html[data-theme="arcade"] input[type="checkbox"]:checked {
  background: var(--ga-accent-gradient) !important;
}
html[data-theme="arcade"] .toggle input:checked + .toggle-slider::before {
  background: var(--ga-accent-gradient) !important;
}
html[data-theme="arcade"] .paint-sheet-handle {
  background: var(--ga-accent-gradient) !important;
}
html[data-theme="arcade"] .layer-item.selected::before,
html[data-theme="arcade"] .layer-item.active::before {
  background: var(--ga-accent-gradient) !important;
}
`,
};
