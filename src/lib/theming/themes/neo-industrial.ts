import type { Theme } from '../types';
import skin from './neo-industrial.css?raw';

/** Optional instrument-panel skin. No scene/output or layout changes. */
export const NEO_INDUSTRIAL_THEME: Theme = {
  id: 'neo-industrial',
  name: 'Neo Industrial',
  description: 'Graphite instrument panels, silver typography, signal-orange selections and cobalt faders.',
  tokens: {
    fontUi: "'Space Grotesk', 'Satoshi', system-ui, sans-serif",
    fontDisplay: "'Space Grotesk', 'Satoshi', system-ui, sans-serif",
    fontMono: "'Geist Mono', ui-monospace, monospace",
    fontLed: "'Geist Mono', ui-monospace, monospace",
    void: '#111211', bar: '#20221f', panel: '#191b19', card: '#232622',
    sub: '#292d28', raise: '#333830', slot: '#0c0e0c',
    line: '#343a32', line2: '#4b5347', line3: '#75806e',
    ink0: '#eeefe8', ink1: '#c3c7bc', ink2: '#a3ab9b', ink3: '#727b6b',
    rHard: '2px', rSoft: '3px', rTile: '3px', rPill: '2px',
    violet: '#ff975a', violetSoft: '#38271c', violetLine: '#b5683a',
    blue: '#819cff', blueSoft: '#202d58', blueLine: '#5874c6',
    coral: '#ff975a', coralSoft: '#38271c', coralLine: '#b5683a',
    green: '#8bd99b', cyan: '#96cbd4', pink: '#e4a0c4', rec: '#ff5b53',
    icon: '#c3c7bc', metalHi: 'rgba(238,239,232,.08)', coralGlow: 'none',
  },
  // Same surface bridge as Arcade. Accent overrides live in scoped CSS,
  // so leaving this theme cannot leave orange values in another skin.
  legacyVars: {
    '--bg-primary': '#111211', '--bg-secondary': '#191b19', '--bg-tertiary': '#232622',
    '--bg-overlay': 'rgba(12,14,12,.94)', '--text-primary': '#eeefe8',
    '--text-secondary': '#c3c7bc', '--text-muted': '#a3ab9b', '--border-secondary': '#4b5347',
  },
  extraCss: skin,
};
