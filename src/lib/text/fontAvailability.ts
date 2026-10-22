/**
 * Which font families this computer can actually draw.
 *
 * Text is rasterized with Canvas 2D, which silently swaps a family it does
 * not have for its default font. A menu that offers fonts from another
 * platform (Segoe UI on a Mac, Futura on Windows) then has several entries
 * that all look the same, and picking one appears to do nothing.
 */
const cache = new Map<string, boolean>();
let ctx: CanvasRenderingContext2D | null | undefined;

function measureContext(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  return ctx;
}

/**
 * True when the family is installed. Measured against two different generic
 * fallbacks: an installed family draws the same width with either, a missing
 * one takes each fallback's width.
 */
export function isFontInstalled(family: string): boolean {
  const name = family.trim();
  if (!name) return false;
  const known = cache.get(name);
  if (known !== undefined) return known;
  const c = measureContext();
  if (!c) return true; // cannot tell; do not hide anything
  const sample = 'GHOST arcade 0123 WMiil@#';
  const width = (fallback: string) => {
    c.font = `40px "${name.replace(/"/g, '')}", ${fallback}`;
    return c.measureText(sample).width;
  };
  const installed = Math.abs(width('monospace') - width('serif')) < 0.01;
  cache.set(name, installed);
  return installed;
}

/**
 * The installed fonts from a list, in order. The current choice stays in the
 * list even when it is missing, so a project made on another computer still
 * shows what it asked for.
 */
export function installedFontChoices(fonts: readonly string[], current?: string | null): string[] {
  const out = fonts.filter(isFontInstalled);
  if (current && !out.includes(current)) out.unshift(current);
  return out;
}
