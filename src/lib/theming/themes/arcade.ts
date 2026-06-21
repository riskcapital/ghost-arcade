// Arcade — retro faceplate. Warm-toned depths, same Space Grotesk +
// IBM Plex Mono type system, coral-on-black marquee accents.

import type { Theme } from '../types';

export const ARCADE_THEME: Theme = {
  id: 'arcade',
  name: 'Arcade',
  description: 'Retro arcade faceplate — warm depths, LED segment numerals, coral marquee.',
  tokens: {
    fontUi:      "'Space Grotesk', system-ui, sans-serif",
    fontDisplay: "'Space Grotesk', system-ui, sans-serif",
    fontMono:    "'IBM Plex Mono', ui-monospace, monospace",
    fontLed:     "'IBM Plex Mono', ui-monospace, monospace",

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

    // Arcade pushes coral as the only "live" accent — violet/blue/etc.
    // map onto coral or muted blue so the marquee reads warm.
    violet:     '#ff6f5e',
    violetSoft: 'rgba(255,111,94,.13)',
    violetLine: 'rgba(255,111,94,.50)',
    blue:       '#5278ff',
    blueSoft:   'rgba(82,120,255,.28)',
    blueLine:   'rgba(82,120,255,.10)',
    coral:      '#ff6f5e',
    coralSoft:  'rgba(255,111,94,.13)',
    coralLine:  'rgba(255,111,94,.50)',
    green:      '#46d18a',
    cyan:       '#5278ff',
    pink:       '#ff6f5e',
    rec:        '#ff3b30',

    metalHi:   'rgba(255,255,255,.16)',
    coralGlow: 'rgba(255,111,94,.50)',
  },
  // Bridge — only the depth ladder + ink so the Accent scheme picker
  // still owns the accent colours. The warm Arcade ladder reads great
  // with any of the existing accents (Midnight Coral, Cyberpunk, etc.).
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
};
