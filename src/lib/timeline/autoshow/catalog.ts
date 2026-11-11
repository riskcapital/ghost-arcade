/**
 * Auto show's content: the catalog's types and how a show picks its cast.
 *
 * The built-in pool is a curated catalog (catalogData.ts, data only): shaders
 * and shape Looks that read well on mapped pieces, each tagged with the
 * energy tiers it suits, its moods, texture, scale (per piece, across the
 * stage, or both), starting values and colour variants. A show picks a
 * small cast from it (4–8 contents) that returns through the song, so it
 * feels like one show rather than a shuffle of the library, and one mood
 * (palette family) for the whole show.
 *
 * The user's own videos (My library) join as cast members too, tiered by
 * how much they move and how bright they are (libraryVideos.ts).
 */
import type { SectionKind } from '../sections/sectionModel';
import type { ShowStyle } from './songStyle';

export type AutoShowTier = 'calm' | 'groove' | 'drive' | 'peak';
export type AutoShowMood = 'dark' | 'warm' | 'cool' | 'acid' | 'mono';
export interface AutoShowContent {
  id: string;                         // stable id
  kind: 'shader' | 'look';            // ISF file in public/ISF, or a shape Look id (edgeLooks)
  ref: string;                        // file name or Look id
  tiers: AutoShowTier[];
  moods: AutoShowMood[];
  texture: 'geometric' | 'organic' | 'glitch' | 'light';
  scale: Array<'piece' | 'span'>;     // good per face, across the stage, or both
  params?: Record<string, number | boolean | number[]>;            // starting values
  variants?: Array<{ mood: AutoShowMood; params: Record<string, number | boolean | number[]> }>; // colour variants
  cost?: 'low' | 'mid' | 'high';      // measured GPU cost
}

export const AUTO_SHOW_TIERS: readonly AutoShowTier[] = ['calm', 'groove', 'drive', 'peak'];
export const AUTO_SHOW_MOODS: readonly AutoShowMood[] = ['dark', 'warm', 'cool', 'acid', 'mono'];

/** A cast member: a catalog entry, or a video from the user's library. */
export interface CastMember {
  id: string;
  kind: 'shader' | 'look' | 'video';
  /** ISF file, Look id, or the video's library id. */
  ref: string;
  name: string;
  tiers: AutoShowTier[];
  texture: AutoShowContent['texture'];
  scale: Array<'piece' | 'span'>;
  /** Starting values with the show's mood applied. */
  params: Record<string, number | boolean | number[]>;
  /** The values for a mood other than the show's (a section that shifts colour). */
  paramsFor(mood: AutoShowMood): Record<string, number | boolean | number[]>;
  /** A video: its media (src, asset ref, length). */
  video?: { src: string; assetRef?: unknown; seconds?: number; width?: number; height?: number };
  cost: 'low' | 'mid' | 'high';
}

/** The show's palette family and the shift for builds and drops. */
export interface AutoShowPalette {
  mood: AutoShowMood;
  /** Builds and drops shift to this mood (the family's accent). */
  accent: AutoShowMood;
  /** Look palettes (edgeLooks) for calm sections and for the loud ones. */
  looks: { calm: string; loud: string };
}

/** Moods that suit a style, first the most likely; the show picks one (seeded). */
export const STYLE_MOODS: Record<ShowStyle, AutoShowMood[]> = {
  chill: ['warm', 'cool', 'mono'],
  groove: ['warm', 'cool', 'acid'],
  driving: ['cool', 'acid', 'dark'],
  hard: ['dark', 'acid', 'mono'],
  cinematic: ['dark', 'cool', 'warm'],
};

/** Each mood's accent for builds and drops, and its look palettes. */
const MOOD_FAMILY: Record<AutoShowMood, { accent: AutoShowMood; calm: string; loud: string }> = {
  dark: { accent: 'acid', calm: 'mono', loud: 'neon' },
  warm: { accent: 'acid', calm: 'sunset', loud: 'fire' },
  cool: { accent: 'warm', calm: 'ice', loud: 'ocean' },
  acid: { accent: 'cool', calm: 'candy', loud: 'acid' },
  mono: { accent: 'cool', calm: 'mono', loud: 'ice' },
};

export function paletteFor(mood: AutoShowMood): AutoShowPalette {
  const f = MOOD_FAMILY[mood];
  return { mood, accent: f.accent, looks: { calm: f.calm, loud: f.loud } };
}

/** The tier a section wants, by what it is and the song's style. */
export function sectionTier(kind: SectionKind, energy: number, style: ShowStyle): AutoShowTier {
  const base: AutoShowTier = kind === 'drop' ? 'peak'
    : kind === 'build' ? 'drive'
      : kind === 'intro' || kind === 'outro' || kind === 'breakdown' ? 'calm'
        : energy >= 0.75 ? 'drive' : energy <= 0.3 ? 'calm' : 'groove';
  const order = AUTO_SHOW_TIERS;
  const cap: Record<ShowStyle, AutoShowTier> = { chill: 'groove', groove: 'drive', driving: 'peak', hard: 'peak', cinematic: 'drive' };
  const floor: Record<ShowStyle, AutoShowTier> = { chill: 'calm', groove: 'calm', driving: 'calm', hard: kind === 'intro' || kind === 'outro' || kind === 'breakdown' ? 'calm' : 'drive', cinematic: 'calm' };
  const i = Math.min(order.indexOf(cap[style]), Math.max(order.indexOf(floor[style]), order.indexOf(base)));
  return order[i];
}

function variantParams(entry: AutoShowContent, mood: AutoShowMood): Record<string, number | boolean | number[]> {
  const v = entry.variants?.find((x) => x.mood === mood);
  return { ...(entry.params ?? {}), ...(v?.params ?? {}) };
}

/** A catalog entry as a cast member in the show's mood. */
export function castFromContent(entry: AutoShowContent, mood: AutoShowMood): CastMember {
  const name = entry.kind === 'shader' ? entry.ref.replace(/\.fs$/i, '').replace(/^(GA2|STAGE|LIVE|VX|DM|Featured)-/, '') : entry.ref;
  return {
    id: entry.id,
    kind: entry.kind,
    ref: entry.ref,
    name,
    tiers: [...entry.tiers],
    texture: entry.texture,
    scale: [...entry.scale],
    params: variantParams(entry, mood),
    paramsFor: (m) => variantParams(entry, m),
    cost: entry.cost ?? 'mid',
  };
}

/** How well a cast member suits a mood: a variant for it, or listed for it. */
function moodFit(entry: AutoShowContent, mood: AutoShowMood): number {
  if (entry.variants?.some((v) => v.mood === mood)) return 2;
  return entry.moods.includes(mood) ? 1 : 0;
}

export interface CastOptions {
  /** Tiers the song's sections want, with how much time each takes (any unit). */
  tiers: Partial<Record<AutoShowTier, number>>;
  /** Cast size (clamped to 4..8 and to what is available). */
  size?: number;
  /** Videos from the user's library to cast too (already in members form). */
  library?: readonly CastMember[];
  /** Built-in only, the library only, or both. */
  source?: 'builtin' | 'library' | 'both';
  /** Keep high-cost content to this many members. */
  maxHighCost?: number;
}

/**
 * The show's cast: a few contents per tier the song uses (more for the
 * tiers it spends longer in), suited to the mood, mixing textures, with at
 * least one that spreads across the stage when the song has calm parts.
 * Seeded (`rnd`): the same song and seed give the same cast.
 */
export function pickCast(catalog: readonly AutoShowContent[], mood: AutoShowMood, rnd: () => number, opts: CastOptions): CastMember[] {
  const source = opts.source ?? 'builtin';
  const pool: CastMember[] = [];
  const fit = new Map<string, number>();
  if (source !== 'library') {
    for (const entry of catalog) {
      pool.push(castFromContent(entry, mood));
      fit.set(entry.id, moodFit(entry, mood));
    }
  }
  if (source !== 'builtin') for (const v of opts.library ?? []) { pool.push(v); fit.set(v.id, 1); }
  if (!pool.length) return [];
  const used = AUTO_SHOW_TIERS.filter((t) => (opts.tiers[t] ?? 0) > 0);
  const total = used.reduce((n, t) => n + (opts.tiers[t] ?? 0), 0) || 1;
  const size = Math.max(Math.min(4, pool.length), Math.min(8, pool.length, opts.size ?? Math.max(4, used.length * 2)));
  const maxHigh = opts.maxHighCost ?? 3;
  const cast: CastMember[] = [];
  const has = (id: string) => cast.some((c) => c.id === id);
  const textures = () => new Set(cast.map((c) => c.texture));
  const score = (c: CastMember, tier: AutoShowTier) => {
    if (has(c.id)) return -Infinity;
    if (c.cost === 'high' && cast.filter((x) => x.cost === 'high').length >= maxHigh) return -Infinity;
    let s = (c.tiers.includes(tier) ? 3 : 0) + (fit.get(c.id) ?? 0) + (textures().has(c.texture) ? 0 : 0.8) + rnd() * 1.5;
    if (c.kind === 'video') s += 0.5;
    return s;
  };
  // Each used tier gets members in proportion to its time (at least one).
  const want = new Map<AutoShowTier, number>();
  for (const t of used) want.set(t, Math.max(1, Math.round((size * (opts.tiers[t] ?? 0)) / total)));
  let guard = 0;
  while (cast.length < size && guard++ < 64) {
    // The tier most short of its share.
    let tier: AutoShowTier = used[0] ?? 'groove';
    let short = -Infinity;
    for (const t of used.length ? used : (['groove'] as AutoShowTier[])) {
      const have = cast.filter((c) => c.tiers.includes(t)).length;
      const gap = (want.get(t) ?? 1) - have;
      if (gap > short) { short = gap; tier = t; }
    }
    let best: CastMember | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      const s = score(c, tier);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best || !Number.isFinite(bestScore)) break;
    cast.push(best);
  }
  // Calm parts want a picture across the stage: make sure one can.
  if ((opts.tiers.calm ?? 0) > 0 && !cast.some((c) => c.scale.includes('span'))) {
    const span = pool.find((c) => !has(c.id) && c.scale.includes('span') && c.tiers.includes('calm'));
    if (span) cast[cast.length - 1 < 7 ? cast.length : cast.length - 1] = span;
  }
  return cast;
}

/**
 * The cast member for a section: of the tier it wants (else the nearest
 * tier), fit for the scale asked when possible, never one of `avoid` (the
 * content that played last on the same row, or on the other set now), the
 * least used so far first, then by `rnd`.
 */
export function pickMember(
  cast: readonly CastMember[],
  tier: AutoShowTier,
  rnd: () => number,
  opts: { avoid?: Iterable<string>; scale?: 'piece' | 'span'; uses?: Map<string, number>; kinds?: Array<CastMember['kind']> } = {},
): CastMember | null {
  const avoid = new Set(opts.avoid ?? []);
  const order = AUTO_SHOW_TIERS;
  const dist = (c: CastMember) => Math.min(...c.tiers.map((t) => Math.abs(order.indexOf(t) - order.indexOf(tier))));
  const usable = cast.filter((c) => !avoid.has(c.id) && (!opts.kinds || opts.kinds.includes(c.kind)));
  const from = usable.length ? usable : cast.filter((c) => !opts.kinds || opts.kinds.includes(c.kind));
  if (!from.length) return null;
  let best: CastMember | null = null;
  let bestKey = Infinity;
  for (const c of from) {
    const key = dist(c) * 10
      + (opts.scale && !c.scale.includes(opts.scale) ? 3 : 0)
      + (opts.uses?.get(c.id) ?? 0) * 1.5
      + rnd();
    if (key < bestKey) { bestKey = key; best = c; }
  }
  return best;
}
