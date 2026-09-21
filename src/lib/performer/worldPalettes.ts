/** Stable order: saved world parameters store a normalized index. */
export const WORLD_PALETTES = [
  { name: 'Spectrum', colors: ['#ffffff', '#ffffff'] },
  { name: 'Ice Blue', colors: ['#123a9c', '#a3eeff'] },
  { name: 'Ember', colors: ['#b51b09', '#ffd27a'] },
  { name: 'Amethyst', colors: ['#42147a', '#e0a1ff'] },
  { name: 'Emerald', colors: ['#075a46', '#92ffd0'] },
  { name: 'Rose', colors: ['#991942', '#ffd2e0'] },
  { name: 'Gold', colors: ['#875214', '#fff0b0'] },
  { name: 'Monochrome', colors: ['#707070', '#ffffff'] },
] as const;
export function worldPaletteIndex(value = 0): number {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * (WORLD_PALETTES.length - 1));
}
