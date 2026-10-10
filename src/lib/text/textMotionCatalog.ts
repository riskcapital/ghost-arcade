import type { TextAnimationType, TextReader, TextTile, TextTileStyle } from '../types';

export const TEXT_ANIMATIONS: { value: TextAnimationType; label: string; description: string; group: 'Basics' | 'Kinetic' | 'Entrances' | 'Effects' }[] = [
  { value: 'none', label: 'None', description: 'Static text', group: 'Basics' },
  { value: 'ticker', label: 'Ticker', description: 'Horizontal scrolling marquee', group: 'Basics' },
  { value: 'waveY', label: 'Wave Y', description: 'Vertical sine wave', group: 'Basics' },
  { value: 'waveX', label: 'Wave X', description: 'Horizontal sine wave', group: 'Basics' },
  { value: 'stretchWave', label: 'Stretch Wave', description: 'A wave of width runs through the letters and pushes the line apart', group: 'Kinetic' },
  { value: 'elasticWide', label: 'Elastic Wide', description: 'One letter at a time balloons wide and springs back', group: 'Kinetic' },
  { value: 'tallStretch', label: 'Tall Stretch', description: 'Letters grow tall from the baseline in a wave', group: 'Kinetic' },
  { value: 'sizeCascade', label: 'Size Cascade', description: 'Large and small letters swell and shrink along the line', group: 'Kinetic' },
  { value: 'trackingBreathe', label: 'Tracking Breathe', description: 'Letter spacing opens wide and closes', group: 'Kinetic' },
  { value: 'echoStack', label: 'Echo Stack', description: 'Offset copies stack behind the text and breathe', group: 'Kinetic' },
  { value: 'drumRoll', label: 'Drum Roll', description: 'Letters turn over like a rotating drum', group: 'Kinetic' },
  { value: 'orbit', label: 'Orbit', description: 'The text runs around a turning circle', group: 'Kinetic' },
  { value: 'slam', label: 'Slam', description: 'Words land one after another from oversized', group: 'Entrances' },
  { value: 'riseStagger', label: 'Rise', description: 'Letters rise into place with a slight turn', group: 'Entrances' },
  { value: 'letterReveal', label: 'Letter Reveal', description: 'Letters appear with glow burst', group: 'Entrances' },
  { value: 'typewriter', label: 'Typewriter', description: 'Typing with cursor blink', group: 'Entrances' },
  { value: 'fadeInLetters', label: 'Fade In', description: 'Sequential letter fade', group: 'Entrances' },
  { value: 'elastic', label: 'Elastic', description: 'Bounce in with overshoot', group: 'Entrances' },
  { value: 'spiralIn', label: 'Spiral In', description: 'Letters spiral to position', group: 'Entrances' },
  { value: 'bounce', label: 'Bounce', description: 'Physics bounce from top', group: 'Entrances' },
  { value: 'scramble', label: 'Scramble', description: 'Random chars resolve', group: 'Effects' },
  { value: 'glitch3d', label: 'Glitch 3D', description: 'RGB split + skew + noise', group: 'Effects' },
  { value: 'perspective3d', label: 'Perspective 3D', description: 'Rotating faux-3D', group: 'Effects' },
  { value: 'flipLetters', label: 'Flip Letters', description: 'Y-axis letter rotation', group: 'Effects' },
  { value: 'explode', label: 'Explode', description: 'Burst out and reassemble', group: 'Effects' },
  { value: 'liquid', label: 'Liquid', description: 'Fluid distortion warping', group: 'Effects' },
  { value: 'neonPulse', label: 'Neon Pulse', description: 'Glowing neon with flicker', group: 'Effects' },
  { value: 'matrixRain', label: 'Matrix Rain', description: 'Digital rain cascade', group: 'Effects' },
];
export const TEXT_ANIMATION_GROUPS = ['Basics', 'Kinetic', 'Entrances', 'Effects'] as const;

export const TEXT_TILE_STYLES: { value: TextTileStyle; label: string; description: string }[] = [
  { value: 'grid', label: 'Grid', description: 'Even rows and columns' },
  { value: 'brick', label: 'Brick', description: 'Every other row sits half a tile across' },
  { value: 'sizes', label: 'Sizes', description: 'Some tiles larger, some smaller' },
  { value: 'vertical', label: 'Vertical', description: 'Some tiles stand on end' },
  { value: 'scroll', label: 'Scroll', description: 'Rows slide in opposite directions' },
  { value: 'flip', label: 'Flip', description: 'Every other row is upside down' },
  { value: 'steps', label: 'Steps', description: 'Rows step sideways down the frame and drift' },
  { value: 'mix', label: 'Mix', description: 'Sizes, upright tiles and brightness all vary' },
];

export const DEFAULT_TEXT_TILE: TextTile = { enabled: false, columns: 3, rows: 4, style: 'brick', scale: 1, speed: 0.3, variation: 0.7 };
export const DEFAULT_TEXT_READER: TextReader = { enabled: false, unit: 'phrase', wordsPerMinute: 220, wordsPerPhrase: 4, loop: true };

/** Text longer than this is not shown in the editing box: a book would make every keystroke slow. */
export const TEXT_EDIT_LIMIT = 20000;

export function wordCount(text: string): number {
  let count = 0, inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const space = text.charCodeAt(i) <= 32;
    if (!space && !inWord) count += 1;
    inWord = !space;
  }
  return count;
}

/** How long the reader takes to get through the text, as "4 min" or "2 h 10 min". */
export function readingTime(text: string, wordsPerMinute: number): string {
  const minutes = wordCount(text) / Math.max(1, wordsPerMinute);
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s`;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
}
