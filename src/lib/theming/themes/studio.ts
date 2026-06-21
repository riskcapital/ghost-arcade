// Studio — the v10 reference design. Cool near-black depth ladder,
// matte/restrained accent palette, Space Grotesk + IBM Plex Mono.
// This is the default theme.

import type { Theme } from '../types';

export const STUDIO_THEME: Theme = {
  id: 'studio',
  name: 'Studio Coral',
  description: 'Cool near-black, soft restrained accents — the default Ghost Arcade look.',
  tokens: {
    fontUi:      "'Space Grotesk', system-ui, sans-serif",
    fontDisplay: "'Space Grotesk', system-ui, sans-serif",
    fontMono:    "'IBM Plex Mono', ui-monospace, monospace",

    void:  '#070809',
    bar:   '#0e1014',
    panel: '#0b0d11',
    card:  '#13161c',
    sub:   '#171a22',
    raise: '#1d212a',
    slot:  '#050607',

    line:  'rgba(255,255,255,.07)',
    line2: 'rgba(255,255,255,.12)',
    line3: 'rgba(255,255,255,.20)',

    ink0: '#eef0f4',
    ink1: '#9aa0ac',
    ink2: '#5e6571',
    ink3: '#3a404a',

    rHard: '2px',
    rSoft: '7px',
    rTile: '9px',
    rPill: '999px',

    violet:     '#ff7a66',
    violetSoft: 'rgba(255,122,102,.12)',
    violetLine: 'rgba(255,122,102,.42)',
    blue:       '#6cb6c9',
    blueSoft:   'rgba(108,182,201,.11)',
    blueLine:   'rgba(108,182,201,.34)',
    coral:      '#ff725f',
    coralSoft:  'rgba(255,114,95,.13)',
    coralLine:  'rgba(255,114,95,.46)',
    green:      '#46d18a',
    cyan:       '#2dd4d4',
    pink:       '#f472b6',
    rec:        '#ff4438',

    metalHi:   'rgba(255,255,255,.06)',
    coralGlow: 'rgba(255,114,95,.42)',
  },
  // Bridge — only the depth ladder + ink so the active Accent scheme
  // picker still owns the accent colours. Themes set the SURFACE
  // language (cool vs warm); accents stack on top of it.
  legacyVars: {
    '--bg-primary':       '#070809',
    '--bg-secondary':     '#0e1014',
    '--bg-tertiary':      '#13161c',
    '--bg-overlay':       'rgba(7,8,9,.85)',
    '--text-primary':     '#eef0f4',
    '--text-secondary':   '#9aa0ac',
    '--text-muted':       '#5e6571',
    '--border-secondary': 'rgba(255,255,255,.12)',
    '--accent-primary':   '#ff725f',
    '--accent-secondary': '#ff9a84',
    '--accent-hover':     '#ff5f4c',
    '--border-primary':   'rgba(255,114,95,.22)',
  },
};
