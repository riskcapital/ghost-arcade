// The one blue, for code that cannot use CSS variables (canvas 2D, three.js, QR images).
// Same steps and mixes as src/lib/mobile/studio/blueScale.css: everything is worked out from the
// active theme's --ga-blue token, so a theme changes these by changing that one token.

export type BlueStep =
  | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  | 'mute-300' | 'mute-600' | 'mute-800';

type Rgb = [number, number, number];

const BASE: Rgb = [0x52, 0x78, 0xff];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** Percent of the blue, and what it is mixed with. Keep in step with blueScale.css. */
const MIX: Record<string, [number, Rgb]> = {
  '100': [25, WHITE],
  '200': [50, WHITE],
  '300': [75, WHITE],
  '400': [100, WHITE],
  '500': [80, BLACK],
  '600': [60, BLACK],
  '700': [40, BLACK],
  '800': [25, BLACK],
  '900': [12, BLACK],
  'mute-300': [35, [0x9a, 0x9a, 0x9a]],
  'mute-600': [25, [0x3a, 0x3a, 0x3a]],
  'mute-800': [14, [0x15, 0x15, 0x15]],
};

export function parseBlueToken(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(text);
  if (rgb) {
    const parts = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as Rgb;
    return parts.every((n) => n <= 255) ? parts : null;
  }
  return null;
}

let cachedToken = '';
let cachedBase: Rgb = BASE;

function activeBase(): Rgb {
  if (typeof document === 'undefined') return BASE;
  // The theme store writes tokens as inline properties on <html>, so this read is cheap
  // enough for a draw loop (no style recalculation).
  const token = document.documentElement.style.getPropertyValue('--ga-blue');
  if (token !== cachedToken) {
    cachedToken = token;
    cachedBase = parseBlueToken(token) ?? BASE;
  }
  return cachedBase;
}

export function blueRgb(step: BlueStep = 400, base: Rgb = activeBase()): Rgb {
  const [percent, other] = MIX[String(step)];
  return base.map((channel, i) => Math.round((channel * percent + other[i] * (100 - percent)) / 100)) as Rgb;
}

/** A step of the blue as a colour string: "#rrggbb", or "rgba(...)" when alpha is below 1. */
export function blue(step: BlueStep = 400, alpha = 1): string {
  const [r, g, b] = blueRgb(step);
  if (alpha >= 1) return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, alpha)})`;
}
