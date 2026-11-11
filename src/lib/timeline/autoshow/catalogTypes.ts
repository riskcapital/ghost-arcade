// The shape of an Auto show catalog entry: one piece of built-in content the
// Auto show can put on the mapping, tagged so the engine can cast a show from
// it (energy tier, mood, texture, how it reads on pieces vs. across the stage).

export type AutoShowTier = 'calm' | 'groove' | 'drive' | 'peak';
export type AutoShowMood = 'dark' | 'warm' | 'cool' | 'acid' | 'mono';

export interface AutoShowContent {
  id: string;
  kind: 'shader' | 'look';
  /** An ISF file in public/ISF (as listed in its manifest), or a shape Look id (edgeLooks). */
  ref: string;
  tiers: AutoShowTier[];
  moods: AutoShowMood[];
  texture: 'geometric' | 'organic' | 'glitch' | 'light';
  /** 'piece' = the whole picture on every piece; 'span' = one picture across the stage. */
  scale: Array<'piece' | 'span'>;
  /** Starting values: shader inputs by name. For a Look, `palette` is an index into LOOK_PALETTES. */
  params?: Record<string, number | boolean | number[]>;
  /** Per-mood colour presets, applied over `params`. */
  variants?: Array<{ mood: AutoShowMood; params: Record<string, number | boolean | number[]> }>;
  cost?: 'low' | 'mid' | 'high';
}
