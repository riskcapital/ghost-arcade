/**
 * Auto show: a whole show on the existing mapping, cut to the song. Score
 * the song, grown up (AUTO-SHOW.md).
 *
 * From the song's structure (songStructure.ts), its style (songStyle.ts),
 * the mapping's piece groups (pieceGroups.ts) and a small cast of contents
 * (catalog.ts), the draft lays down ordinary Timeline material:
 *
 *   Score's part   sections, the energy line on All looks, the stage line,
 *                  LED follow (scoreDraft.ts, unchanged)
 *   Groups         the piece groups as named where orders (✦ Sets A | B,
 *                  ✦ Rows, ✦ Hero…), shown in every ⇄ Where
 *   Content rows   three or four rows added on the hero piece (✦ Stage,
 *                  ✦ Set A, ✦ Set B, ✦ Hero); their blocks travel across the
 *                  pieces through where lines on the group orders, so a
 *                  content covering eighty pieces is one block. Every block
 *                  is `dark`: the pieces it holds show nothing of their own,
 *                  only what the show lights.
 *   Looks row      a stroke look per section (worn over the content)
 *   Screen FX      one per section by style, a riser into each drop
 *   Effects row    hard and driving drops: an invert hit on the downbeats
 *
 * Recipes per section (by type, scaled by style):
 *   intro      one calm picture across the stage, pieces revealed by a
 *              slow sweep (rows or columns), fading in
 *   verse …    two contents on the two alternating sets, swapping every few
 *              bars; the hero keeps a third
 *   build      a picture travelling across the stage, faster each phrase;
 *              a strobe riser in its last bar
 *   drop       the hardest contents on the two sets, swapping on every beat
 *              of the first bar (two for Hard) then every bar
 *   breakdown  few pieces lit (the hero and one group), slow and darker,
 *              no Screen FX
 *   outro      the calm picture again, pieces dropping out in turn
 *
 * Never the same content twice running on a row, and the two sets never
 * show the same content together. Bounded: a handful of blocks a section,
 * whatever the number of pieces. Pure and deterministic (seed → draft).
 */
import type { Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack, ShowLookClip, ShowTempoMap, StageEffect } from '../../types';
import type { TimelineStageClip } from '../stagefx/stageClips';
import type { WhereNamedOrder, WhereSpec } from '../where/whereModel';
import type { SectionKind } from '../sections/sectionModel';
import type { SongStructure } from '../score/songStructure';
import { draftScore, seededRandom, sequentialIds, type ScoreDraft, type ScoreExisting, type ScoreIds, type ScoreStage } from '../score/scoreDraft';
import { beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';
import { groupCount, groupOrders, pieceGroups, GROUP_ORDER_IDS, type PieceGroups } from './pieceGroups';
import { paletteFor, pickCast, pickMember, sectionTier, STYLE_MOODS, type AutoShowContent, type AutoShowMood, type AutoShowPalette, type AutoShowTier, type CastMember } from './catalog';
import { SHOW_STYLE_NAMES, type ShowStyle } from './songStyle';

export const AUTO_ROW_NAMES = { stage: '✦ Stage', a: '✦ Set A', b: '✦ Set B', hero: '✦ Hero' } as const;
export type AutoRowKey = keyof typeof AUTO_ROW_NAMES;
/** Named orders Auto show owns start with this. */
export const AUTO_ORDER_PREFIX = 'autoshow:';

/** How a style plays the recipes. */
interface StyleRules {
  /** Bars each set keeps its content in verses (then they swap). */
  swapBars: number;
  /** Bars of beat-by-beat swapping at the start of a drop (0: none). */
  dropBeatBars: number;
  /** Bars between swaps in the rest of a drop. */
  dropSwapBars: number;
  /** Bars a pass of the build's travelling picture takes, first phrase. */
  buildBars: number;
  /** Screen FX mix (0..1) for the loud sections. */
  fxMix: number;
  /** A strobe riser in the build's last bar. */
  riser: boolean;
  /** Invert hits on the drops' downbeats: none, the first, every phrase. */
  hits: 'none' | 'first' | 'phrase';
  /** Bars of the intro's reveal (at most the section). */
  revealBars: number;
}

export const STYLE_RULES: Record<ShowStyle, StyleRules> = {
  chill: { swapBars: 8, dropBeatBars: 0, dropSwapBars: 4, buildBars: 8, fxMix: 0.2, riser: false, hits: 'none', revealBars: 8 },
  groove: { swapBars: 4, dropBeatBars: 1, dropSwapBars: 2, buildBars: 4, fxMix: 0.3, riser: true, hits: 'none', revealBars: 8 },
  driving: { swapBars: 2, dropBeatBars: 1, dropSwapBars: 1, buildBars: 4, fxMix: 0.35, riser: true, hits: 'first', revealBars: 4 },
  hard: { swapBars: 2, dropBeatBars: 2, dropSwapBars: 1, buildBars: 2, fxMix: 0.45, riser: true, hits: 'phrase', revealBars: 4 },
  cinematic: { swapBars: 8, dropBeatBars: 0, dropSwapBars: 4, buildBars: 16, fxMix: 0.2, riser: false, hits: 'none', revealBars: 16 },
};

/** Stroke looks (they outline over the content rather than cover it), by tier. */
export const ACCENT_LOOKS: Record<AutoShowTier, readonly string[]> = {
  calm: ['echo-rings', 'marching-ants'],
  groove: ['echo-rings', 'twin-snakes', 'electric-nodes'],
  drive: ['comet-chase', 'zigzag', 'twin-snakes', 'electric-nodes'],
  peak: ['comet-chase', 'echo-rings', 'electric-nodes'],
};

/** Looks are accents over the content: the energy line runs them at this
 *  share of Score's intensity, so the outlines never outshine the picture. */
const LOOK_ACCENT = 0.65;

export interface AutoShowStage extends ScoreStage {
  /** The mapping layers (for the groups). */
  layers: readonly Layer[];
  /** Output width / height. */
  aspect: number;
}

export interface AutoShowExisting extends ScoreExisting {
  layerTracks: readonly ShowLayerTrack[];
  whereOrders: readonly import('../where/whereModel').WhereNamedOrder[];
}

export interface AutoShowInput {
  structure: Pick<SongStructure, 'sections' | 'barEnergy' | 'bars'>;
  tempo: ShowTempoMap;
  style: ShowStyle;
  stage: AutoShowStage;
  existing: AutoShowExisting;
  catalog: readonly AutoShowContent[];
  library?: readonly CastMember[];
  source?: 'builtin' | 'library' | 'both';
  /** ISF source of a shader file (fetched by the runtime); null: not available. */
  shaderCode: (file: string) => string | null;
  /** The mood (palette family); else picked for the style from the seed. */
  mood?: AutoShowMood;
  seed: number;
  ids?: ScoreIds;
}

export interface AutoShowPlanItem {
  start: number;
  end: number;
  kind: SectionKind;
  name: string;
  tier: AutoShowTier;
  /** What plays on the content rows (names). */
  content: string[];
  look: string | null;
}

export interface AutoShowDraft extends ScoreDraft {
  /** Rows added on the hero piece, with their blocks (insert after the hero's rows). */
  layerTracks: ShowLayerTrack[];
  /** The piece's id the rows are added on. */
  hostLayerId: string | null;
  /** Named where orders after the draft: the user's own, then the groups. */
  whereOrders: WhereNamedOrder[];
  groups: PieceGroups;
  cast: CastMember[];
  palette: AutoShowPalette;
  style: ShowStyle;
  /** The dialog's "Heard:" line, in parts. */
  heard: { bpm: number; style: string; sections: number; pieces: number; groups: number };
  autoPlan: AutoShowPlanItem[];
  /** Blocks laid down (content, looks, Screen FX, effects; not lines). */
  blockCount: number;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

function overlaps(a: { start: number; end: number }, start: number, end: number): boolean {
  return a.start < end - 1e-6 && a.end > start + 1e-6;
}

/** Show time of `bars` bars after `t` (the tempo map's bars of four quarters). */
function barsAfter(tempo: ShowTempoMap, t: number, bars: number): number {
  return secondsAtBeat(tempo, beatAtSeconds(tempo, t) + bars * 4);
}

/** Pieces with blocks of their own under the song: the show leaves them alone. */
function busyPieces(tracks: readonly ShowLayerTrack[], start: number, end: number): Set<string> {
  const out = new Set<string>();
  for (const t of tracks) {
    if (t.clips.some((c) => overlaps({ start: c.startTime, end: c.startTime + c.duration }, start, end) && !c.where?.namedOrder?.startsWith(AUTO_ORDER_PREFIX))) out.add(t.layerId);
  }
  return out;
}

/** An earlier Auto show's content is under the song already. */
function autoContentThere(tracks: readonly ShowLayerTrack[], start: number, end: number): boolean {
  return tracks.some((t) => t.clips.some((c) => c.where?.namedOrder?.startsWith(AUTO_ORDER_PREFIX) && overlaps({ start: c.startTime, end: c.startTime + c.duration }, start, end)));
}

export function draftAutoShow(input: AutoShowInput): AutoShowDraft {
  const { structure, tempo, style, stage, existing, seed } = input;
  const ids = input.ids ?? sequentialIds(`a${seed}`);
  const rnd = seededRandom(seed ^ 0x5bd1e995);
  const rules = STYLE_RULES[style];
  const songStart = structure.sections[0]?.start ?? 0;
  const songEnd = structure.sections[structure.sections.length - 1]?.end ?? 0;

  // ── Score's part: sections, lines, LEDs (its looks and Screen FX are replaced below) ──
  const base = draftScore(structure, tempo, stage, { ...existing, stageClips: existing.stageClips }, seed, ids);
  const adds = base.adds.filter((a) => !/look blocks|Where motions|Screen FX blocks/.test(a));
  const skips = base.skips.filter((s) => !/^Screen FX row/.test(s));

  // ── Groups (free pieces only) ──────────────────────────────────────────
  const busy = busyPieces(existing.layerTracks, songStart, songEnd);
  const free = stage.layers.filter((l) => !busy.has(l.id));
  const groups = pieceGroups(free, stage.aspect);
  if (busy.size) skips.push(`${busy.size} ${busy.size === 1 ? 'piece has' : 'pieces have'} blocks of their own under the song: the show leaves ${busy.size === 1 ? 'it' : 'them'} alone.`);
  const orders = groupOrders(groups);
  const whereOrders = [...existing.whereOrders.filter((o) => !o.id.startsWith(AUTO_ORDER_PREFIX)), ...orders];
  const orderIndex = (id: string) => orders.find((o) => o.id === id);

  // ── Palette and cast ───────────────────────────────────────────────────
  const moods = STYLE_MOODS[style];
  const mood = input.mood ?? moods[Math.floor(rnd() * moods.length) % moods.length];
  const palette = paletteFor(mood);
  const plan = base.plan;
  const tierTime: Partial<Record<AutoShowTier, number>> = {};
  for (const p of plan) {
    const t = sectionTier(p.kind, p.energy, style);
    tierTime[t] = (tierTime[t] ?? 0) + (p.end - p.start);
  }
  const usableCatalog = input.catalog.filter((c) => c.kind === 'look' || !!input.shaderCode(c.ref));
  const cast = pickCast(usableCatalog, mood, rnd, { tiers: tierTime, library: input.library, source: input.source ?? 'builtin' });
  const contentCast = cast.filter((c) => c.kind !== 'look');
  const lookCast = cast.filter((c) => c.kind === 'look');

  // ── Content rows on the hero piece ─────────────────────────────────────
  const host = groups.hero[0] ?? null;
  const hostRow = host ? existing.layerTracks.find((t) => t.layerId === host && !t.subRow) ?? null : null;
  const contentOn = !!host && !!hostRow && contentCast.length > 0 && groups.pieces.length > 0;
  const rows: Record<AutoRowKey, ShowLayerClip[]> = { stage: [], a: [], b: [], hero: [] };
  const heroBig = groups.hero.length > 0 && groups.pieces.length >= 3 && Math.max(...groups.pieces.filter((p) => groups.hero.includes(p.id)).map((p) => p.area)) >= 2.2 * median(groups.pieces.map((p) => p.area));
  if (autoContentThere(existing.layerTracks, songStart, songEnd)) {
    skips.push('Content: an earlier Auto show is on the Timeline under the song (Shuffle, or Cmd+Z it first).');
  } else if (!stage.layers.length || !groups.pieces.length) {
    skips.push('Content: no mapped pieces to put it on (map the stage first).');
  } else if (!contentCast.length) {
    skips.push('Content: nothing in the chosen content to play (built-in or My library).');
  } else if (!hostRow) {
    skips.push('Content: the hero piece has no row on the Timeline.');
  }

  const last: Record<AutoRowKey, string | null> = { stage: null, a: null, b: null, hero: null };
  const uses = new Map<string, number>();
  const use = (m: CastMember) => uses.set(m.id, (uses.get(m.id) ?? 0) + 1);
  const autoPlan: AutoShowPlanItem[] = [];
  const bar0 = structure.bars.length > 1 ? structure.bars[1] - structure.bars[0] : (240 / (tempo.segments[0]?.bpm ?? 120));

  const media = (m: CastMember, moodNow: AutoShowMood): ShowClipMedia | null => {
    if (m.kind === 'video' && m.video) {
      return { kind: 'video', name: m.name, src: m.video.src, ...(m.video.assetRef ? { _assetRef: m.video.assetRef as ShowClipMedia['_assetRef'] } : {}), ...(m.video.seconds ? { sourceDuration: m.video.seconds } : {}), ...(m.video.width ? { videoWidth: m.video.width, videoHeight: m.video.height } : {}) };
    }
    if (m.kind !== 'shader') return null;
    const code = input.shaderCode(m.ref);
    if (!code) return null;
    return { kind: 'shader', name: m.name, src: `./ISF/${m.ref.split('/').map(encodeURIComponent).join('/')}`, shaderCode: code, shaderValues: { ...m.paramsFor(moodNow) } };
  };

  /** A block on a content row; touching blocks of the same content carry its time on. */
  const block = (row: AutoRowKey, m: CastMember, moodNow: AutoShowMood, start: number, end: number, where: WhereSpec, extra: Partial<ShowLayerClip> = {}) => {
    if (end - start < 0.05) return;
    const mm = media(m, moodNow);
    if (!mm) return;
    const list = rows[row];
    const prev = list[list.length - 1];
    const continues = prev && Math.abs(prev.startTime + prev.duration - start) < 1e-6 && prev.media.name === mm.name && prev.media.kind === mm.kind && JSON.stringify(prev.media.shaderValues ?? {}) === JSON.stringify(mm.shaderValues ?? {});
    const media2 = continues ? prev.media : mm;
    list.push({
      id: ids.next('auto'), startTime: round(start), duration: round(end - start), media: media2,
      inPoint: continues ? round(prev.inPoint + prev.duration) : 0,
      endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, where: { ...where }, label: m.name, ...extra,
    });
    last[row] = m.id;
  };

  const whereOn = (orderId: string, motion: WhereSpec['motion'], more: Partial<WhereSpec> = {}): WhereSpec => ({
    order: 'left-right', members: 'pieces', namedOrder: orderId, motion, position: 0, spread: 0, soft: 0, dark: true, ...more,
  });

  /** Two contents on the two sets, swapping every `swap` bars (or beats for `beat`). */
  const setsSwap = (start: number, end: number, a: CastMember, b: CastMember, swapBars: number, moodNow: AutoShowMood) => {
    // A pass over the two sets lights each for half of it.
    const motion = { kind: 'sweep' as const, bars: Math.max(0.0625, 2 * swapBars) };
    block('a', a, moodNow, start, end, whereOn(GROUP_ORDER_IDS.sets, motion));
    block('b', b, moodNow, start, end, whereOn(GROUP_ORDER_IDS.sets, { ...motion, reverse: true }));
  };

  const twoForSets = (tier: AutoShowTier) => {
    const a = pickMember(contentCast, tier, rnd, { avoid: [last.a, last.b].filter(Boolean) as string[], scale: 'piece', uses });
    if (a) use(a);
    const b = pickMember(contentCast, tier, rnd, { avoid: [a?.id, last.b, last.a].filter(Boolean) as string[], scale: 'piece', uses });
    if (b) use(b);
    return a && b && a.id !== b.id ? [a, b] as const : null;
  };

  const facesTopIndex = (() => {
    const faces = orderIndex(GROUP_ORDER_IDS.faces);
    if (!faces?.slots || groups.how.faces !== 'names' || !groups.faces.top.length || faces.slots.length < 2) return null;
    const i = faces.slots.findIndex((s) => s.includes(groups.faces.top[0]));
    return i < 0 ? null : i / (faces.slots.length - 1);
  })();
  const rowsOrder = orderIndex(GROUP_ORDER_IDS.rows);
  const travelOrder = (k: number) => ((k + Math.floor(rnd() * 2)) % 2 === 0 ? GROUP_ORDER_IDS.rows : GROUP_ORDER_IDS.columns);

  if (contentOn && !autoContentThere(existing.layerTracks, songStart, songEnd)) {
    plan.forEach((p, k) => {
      const tier = sectionTier(p.kind, p.energy, style);
      const loud = p.kind === 'build' || p.kind === 'drop';
      const moodNow: AutoShowMood = loud ? palette.accent : p.kind === 'breakdown' ? 'dark' : palette.mood;
      const bars = Math.max(1, Math.round((beatAtSeconds(tempo, p.end) - beatAtSeconds(tempo, p.start)) / 4));
      const content: string[] = [];
      const pickStage = (t: AutoShowTier) => {
        const m = pickMember(contentCast, t, rnd, { avoid: [last.stage].filter(Boolean) as string[], scale: 'span', uses });
        if (m) { use(m); content.push(m.name); }
        return m;
      };
      switch (p.kind) {
        case 'intro': {
          const m = pickStage(tier);
          if (m) {
            const reveal = Math.max(1, Math.min(bars, rules.revealBars));
            block('stage', m, moodNow, p.start, p.end, whereOn(travelOrder(k), { kind: 'reveal', bars: reveal }, { soft: 0.6, span: m.scale.includes('span') }), { fadeIn: round(Math.min(bar0, (p.end - p.start) / 2)) });
          }
          break;
        }
        case 'outro': {
          const m = pickStage(tier);
          if (m) {
            const fade = Math.min(2 * bar0, (p.end - p.start) / 2);
            block('stage', m, moodNow, p.start, p.end, whereOn(travelOrder(k), { kind: 'reveal', bars: Math.max(1, bars - 2), reverse: true }, { soft: 0.6, span: m.scale.includes('span') }), { fadeOut: round(fade) });
          }
          break;
        }
        case 'build': {
          const m = pickStage(tier);
          if (m) {
            // Phrases of four bars (two in a short build), each pass twice as fast.
            const phrase = bars >= 8 ? 4 : 2;
            const order = travelOrder(k);
            let passBars = Math.max(0.5, Math.min(rules.buildBars, phrase));
            for (let t = p.start, i = 0; t < p.end - 1e-6 && i < 32; i++) {
              const next = Math.min(p.end, barsAfter(tempo, t, phrase));
              block('stage', m, moodNow, t, next, whereOn(order, { kind: 'sweep', bars: passBars }, { spread: 0.35, soft: 0.5, wrap: true, span: m.scale.includes('span') }));
              passBars = Math.max(0.25, passBars / 2);
              t = next;
            }
          }
          break;
        }
        case 'drop': {
          const pair = twoForSets(tier);
          if (pair) {
            content.push(pair[0].name, pair[1].name);
            const beatEnd = rules.dropBeatBars > 0 ? Math.min(p.end, barsAfter(tempo, p.start, rules.dropBeatBars)) : p.start;
            // Every beat: a pass over the two sets every two beats.
            if (beatEnd > p.start) setsSwap(p.start, beatEnd, pair[0], pair[1], 0.25, moodNow);
            setsSwap(beatEnd, p.end, pair[0], pair[1], rules.dropSwapBars, moodNow);
          }
          if (heroBig) {
            const h = pickMember(contentCast, tier, rnd, { avoid: [last.hero, pair?.[0].id, pair?.[1].id].filter(Boolean) as string[], uses });
            if (h) { use(h); content.push(h.name); block('hero', h, moodNow, p.start, p.end, whereOn(GROUP_ORDER_IDS.hero, { kind: 'drawn' }, { spread: 1, dark: false })); }
          }
          break;
        }
        case 'breakdown': {
          // Few pieces lit: the hero, and one group (the cube tops, else a row).
          const m = pickStage(tier);
          if (m) {
            const order = facesTopIndex !== null ? GROUP_ORDER_IDS.faces : GROUP_ORDER_IDS.rows;
            const position = facesTopIndex ?? (rowsOrder?.slots && rowsOrder.slots.length > 1 ? Math.floor(rowsOrder.slots.length / 3) / (rowsOrder.slots.length - 1) : 0);
            block('stage', m, moodNow, p.start, p.end, whereOn(order, { kind: 'drawn' }, { position, spread: 0, soft: 0.3, span: m.scale.includes('span') }), { fadeIn: round(Math.min(bar0, (p.end - p.start) / 4)) });
          }
          const h = pickMember(contentCast, 'calm', rnd, { avoid: [last.hero, m?.id].filter(Boolean) as string[], uses });
          if (h) { use(h); content.push(h.name); block('hero', h, moodNow, p.start, p.end, whereOn(GROUP_ORDER_IDS.hero, { kind: 'drawn' }, { spread: 1, dark: false })); }
          break;
        }
        default: {
          // Verse, bridge, other: the two sets, swapping every few bars.
          const pair = twoForSets(tier);
          if (pair) {
            content.push(pair[0].name, pair[1].name);
            const swap = Math.max(1, Math.min(rules.swapBars, Math.floor(bars / 2) || 1));
            setsSwap(p.start, p.end, pair[0], pair[1], swap, moodNow);
          }
          if (heroBig) {
            const h = pickMember(contentCast, tier, rnd, { avoid: [last.hero, pair?.[0].id, pair?.[1].id].filter(Boolean) as string[], uses });
            if (h) { use(h); content.push(h.name); block('hero', h, moodNow, p.start, p.end, whereOn(GROUP_ORDER_IDS.hero, { kind: 'drawn' }, { spread: 1, dark: false })); }
          }
        }
      }
      autoPlan.push({ start: p.start, end: p.end, kind: p.kind, name: p.name, tier, content, look: null });
    });
  }

  // ── Rows ───────────────────────────────────────────────────────────────
  const layerTracks: ShowLayerTrack[] = [];
  if (hostRow) {
    for (const key of ['stage', 'a', 'b', 'hero'] as AutoRowKey[]) {
      const clips = rows[key];
      if (!clips.length) continue;
      layerTracks.push({
        id: ids.next('row'), layerId: hostRow.layerId, layerName: AUTO_ROW_NAMES[key], template: hostRow.template,
        clips: clips.sort((a, b) => a.startTime - b.startTime), lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false, subRow: true,
      });
    }
  }
  const contentBlocks = layerTracks.reduce((n, t) => n + t.clips.length, 0);
  if (contentBlocks) {
    adds.push(`${contentBlocks} content blocks on ${layerTracks.length} rows added on ${hostRow!.layerName}: ${[...new Set(layerTracks.flatMap((t) => t.clips.map((c) => c.label ?? c.media.name)))].join(', ')}`);
    adds.push(`Pieces in groups (⇄ Where): ${orders.filter((o) => o.id !== GROUP_ORDER_IDS.ring).map((o) => o.name.replace('✦ ', '')).join(', ')}`);
  }

  // ── Looks row: a stroke look per section, worn over the content ────────
  const lookClips: ShowLookClip[] = [];
  const looksBusy = existing.lookClips.some((c) => overlaps({ start: c.startTime, end: c.startTime + c.duration }, songStart, songEnd));
  if (looksBusy) {
    skips.push('Looks row: it has blocks under the song already.');
  } else {
    let prevLook: string | null = null;
    plan.forEach((p, k) => {
      const tier = sectionTier(p.kind, p.energy, style);
      const loud = p.kind === 'build' || p.kind === 'drop';
      const fromCast = lookCast.filter((c) => c.tiers.includes(tier) && c.ref !== prevLook);
      const list = [...fromCast.map((c) => c.ref), ...ACCENT_LOOKS[tier]].filter((id) => id !== prevLook);
      const lookId = list.length ? (fromCast.length && rnd() < 0.6 ? fromCast[0].ref : list[Math.floor(rnd() * list.length) % list.length]) : ACCENT_LOOKS[tier][0];
      const paletteId = loud ? palette.looks.loud : palette.looks.calm;
      // Worn by every piece for the section; the energy line brings it in
      // and out a bar at a time (the content does the moving).
      lookClips.push({
        id: ids.next('look'), lookId, paletteId, startTime: round(p.start), duration: round(p.end - p.start), scope: 'all',
        fadeIn: 0, fadeOut: 0,
      });
      prevLook = lookId;
      const item = autoPlan[k];
      if (item) item.look = lookId;
    });
    if (lookClips.length) adds.push(`${lookClips.length} looks on the Looks row, one a section, outlined over the content`);
  }

  // ── Screen FX and Effects rows ─────────────────────────────────────────
  const stageClips: TimelineStageClip[] = [];
  const rowBusy = (row: 'screenfx' | 'effects') => (existing.stageClips ?? []).some((c) => c.row === row && overlaps({ start: c.startTime, end: c.startTime + c.duration }, songStart, songEnd));
  if (!groups.pieces.length) {
    skips.push('Screen FX row: no pieces on the stage to drive.');
  } else if (rowBusy('screenfx')) {
    skips.push('Screen FX row: it has blocks under the song already.');
  } else {
    const kinds = new Set<string>();
    for (const p of plan) {
      if (p.end - p.start < 0.1) continue;
      const fx = screenFxFor(p.kind, p.energy, bar0, style, rules, ids.next('screenfx'));
      if (fx) {
        kinds.add(fx.type);
        stageClips.push({
          id: ids.next('stage'), row: 'screenfx', startTime: round(p.start), duration: round(p.end - p.start),
          fadeIn: p.kind === 'intro' ? round(Math.min(bar0, (p.end - p.start) / 2)) : 0,
          fadeOut: p.kind === 'outro' ? round(Math.min(2 * bar0, (p.end - p.start) / 2)) : 0,
          screenFx: fx,
        });
      }
      if (p.kind === 'build' && rules.riser && p.end - p.start > bar0 * 1.5) {
        // The riser: a strobe that comes up through the last bar into the drop.
        const start = Math.max(p.start, p.end - bar0);
        stageClips.push({
          id: ids.next('stage'), row: 'screenfx', startTime: round(start), duration: round(p.end - start), fadeIn: round(p.end - start), fadeOut: 0,
          screenFx: { id: ids.next('screenfx'), type: 'strobe', enabled: true, opacity: Math.min(0.8, rules.fxMix + 0.2), params: { rate: round(Math.max(4, (tempo.segments[0]?.bpm ?? 120) / 15)), duty: 0.25 } },
          label: 'Riser',
        });
        kinds.add('riser');
      }
    }
    const screenCount = stageClips.length;
    if (screenCount) adds.push(`${screenCount} Screen FX blocks (${[...kinds].join(', ')})`);
  }
  if (rules.hits !== 'none' && groups.pieces.length && !rowBusy('effects')) {
    let hits = 0;
    for (const p of plan) {
      if (p.kind !== 'drop') continue;
      const beat = bar0 / 4;
      const phraseStarts: number[] = [];
      for (let t = p.start; t < p.end - 1e-6 && phraseStarts.length < 16; t = barsAfter(tempo, t, 4)) {
        phraseStarts.push(t);
        if (rules.hits === 'first') break;
      }
      for (const t of phraseStarts) {
        stageClips.push({
          id: ids.next('stage'), row: 'effects', startTime: round(t), duration: round(Math.min(beat / 2, p.end - t)), fadeIn: 0, fadeOut: round(beat / 4),
          effect: { id: ids.next('effect'), type: 'invert', enabled: true, params: {}, opacity: 1 },
          label: 'Hit',
        });
        hits++;
      }
    }
    if (hits) adds.push(`${hits} invert ${hits === 1 ? 'hit' : 'hits'} on the drops' downbeats (Effects row)`);
  }

  // The energy line steps once a bar (no audio follow): on eighty pieces a
  // line that moves every frame re-dresses every piece every frame.
  const lines = base.lines.map((l) => (l.key === 'look:intensity' && l.target.scope === 'look' ? steppedEnergyLine(l, plan, structure.bars) : l));
  const sections = base.sections;
  const draft: AutoShowDraft = {
    sections, lookClips, lines, ledClips: base.ledClips, stageClips, adds, skips, plan: base.plan,
    layerTracks, hostLayerId: hostRow?.layerId ?? null, whereOrders, groups, cast, palette, style,
    heard: { bpm: Math.round((tempo.segments[0]?.bpm ?? 0) * 10) / 10, style: SHOW_STYLE_NAMES[style], sections: plan.length, pieces: groups.pieces.length, groups: groupCount(groups) },
    autoPlan,
    blockCount: contentBlocks + lookClips.length + stageClips.length + base.ledClips.length,
  };
  return draft;
}

/** Score's energy line held a bar at a time: each bar takes the line's value
 *  at its start (builds climb bar by bar, the outro steps down), and it no
 *  longer follows the song's level frame by frame. */
export function steppedEnergyLine(line: import('../lines/lineModel').ControlLine, plan: ReadonlyArray<{ start: number; end: number }>, bars: readonly number[]): import('../lines/lineModel').ControlLine {
  const pts = line.points;
  const at = (t: number) => {
    if (!pts.length) return line.default ?? 1;
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) {
      if (t < pts[i].t) {
        const a = pts[i - 1];
        const b = pts[i];
        if (a.c === 'hold') return a.v;
        const f = (t - a.t) / Math.max(1e-9, b.t - a.t);
        return a.v + (b.v - a.v) * (a.c === 'ease-in' ? f * f : f);
      }
    }
    return pts[pts.length - 1].v;
  };
  const start = plan[0]?.start ?? 0;
  const end = plan[plan.length - 1]?.end ?? start;
  const times = [...new Set([...bars.filter((b) => b >= start - 1e-6 && b < end - 1e-6), ...plan.map((p) => p.start)].map((t) => round(t)))].sort((a, b) => a - b);
  const points = times.map((t) => ({ t, v: round(at(t + 1e-4) * LOOK_ACCENT), c: 'hold' as const }));
  if (times.length) points.push({ t: round(Math.max(times[times.length - 1], end - 0.01)), v: points[points.length - 1].v, c: 'hold' as const });
  const { follow: _follow, ...rest } = line;
  return { ...rest, points };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** The section's Screen FX by style (null: none, as in breakdowns). */
export function screenFxFor(kind: SectionKind, energy: number, bar: number, style: ShowStyle, rules: StyleRules, id: string): StageEffect | null {
  const b = Math.max(0.2, bar);
  const fx = (type: StageEffect['type'], params: Record<string, number>, opacity: number): StageEffect => ({ id, type, enabled: true, opacity: round(opacity), params });
  const mix = rules.fxMix;
  switch (kind) {
    case 'breakdown': return null;
    case 'drop':
      if (style === 'cinematic') return fx('breathing', { speed: round(1 / (2 * b)), depth: 0.5, heartbeat: 0.3 }, mix);
      if (style === 'chill') return fx('sine-wave', { speed: round(1 / b), phaseSpread: 1.6, depth: 0.5 }, mix);
      return fx('beat-pulse', { sensitivity: 1.4, decay: round(Math.max(0.08, (b / 4) * (style === 'hard' ? 0.45 : 0.6))), threshold: 0.08 }, mix);
    case 'build': return fx('linear-sweep', { angle: 0, speed: round(2 / b), bandWidth: 0.35, tail: 0.4 }, Math.max(0.3, mix - 0.05));
    case 'intro': return fx('breathing', { speed: round(1 / (4 * b)), depth: 0.4, heartbeat: 0 }, Math.min(0.35, mix));
    case 'outro': return fx('breathing', { speed: round(1 / (4 * b)), depth: 0.5, heartbeat: 0 }, Math.min(0.35, mix));
    case 'bridge': return fx('chase', { speed: round(1 / (2 * b)), width: 0.3 }, Math.min(0.4, mix));
    default: return fx('sine-wave', { speed: round(1 / (2 * b)), phaseSpread: 1.6, depth: round(0.3 + 0.3 * energy) }, Math.min(0.45, mix));
  }
}

/** Nothing to add. */
export function autoDraftIsEmpty(d: AutoShowDraft): boolean {
  return !d.sections.length && !d.lookClips.length && !d.lines.length && !d.ledClips.length && !d.stageClips.length && !d.layerTracks.length;
}

/** The rows a draft adds, inserted after the host piece's own rows. */
export function withAutoRows(tracks: readonly ShowLayerTrack[], hostLayerId: string | null, added: readonly ShowLayerTrack[]): ShowLayerTrack[] {
  if (!added.length || !hostLayerId) return [...tracks];
  let at = -1;
  tracks.forEach((t, i) => { if (t.layerId === hostLayerId) at = i; });
  if (at < 0) return [...tracks, ...added];
  const main = tracks.find((t) => t.layerId === hostLayerId && !t.subRow);
  const rowInfo = main?.row ? { row: { ...main.row, kind: 'sub' as const, depth: main.row.depth + 1 } } : {};
  return [...tracks.slice(0, at + 1), ...added.map((t) => ({ ...t, ...rowInfo })), ...tracks.slice(at + 1)];
}

/** JSON with every object's keys sorted. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

/** The document without what the drafts laid down and nobody touched since. */
export function stripDrafts(
  s: Pick<AutoShowExisting, 'sections' | 'lookClips' | 'lines' | 'ledClips' | 'layerTracks' | 'whereOrders'> & { stageClips: readonly TimelineStageClip[] },
  laid: readonly AutoShowDraft[],
) {
  const same = <T extends { id: string }>(list: readonly T[], pick: (d: AutoShowDraft) => readonly T[]) => {
    const byId = new Map<string, Set<string>>();
    for (const d of laid) for (const x of pick(d)) {
      const seen = byId.get(x.id) ?? new Set<string>();
      seen.add(canonicalJson(x));
      byId.set(x.id, seen);
    }
    return list.filter((x) => !(byId.get(x.id)?.has(canonicalJson(x)) ?? false));
  };
  // Rows the drafts added: their untouched blocks come out; a row left empty goes.
  const draftedRows = new Map<string, ShowLayerTrack>();
  const draftedClips = new Map<string, Set<string>>();
  for (const d of laid) for (const t of d.layerTracks) {
    draftedRows.set(t.id, t);
    for (const c of t.clips) {
      const seen = draftedClips.get(c.id) ?? new Set<string>();
      seen.add(canonicalJson(c));
      draftedClips.set(c.id, seen);
    }
  }
  const layerTracks: ShowLayerTrack[] = [];
  for (const t of s.layerTracks) {
    if (!draftedRows.has(t.id)) { layerTracks.push(t); continue; }
    const clips = t.clips.filter((c) => !(draftedClips.get(c.id)?.has(canonicalJson(c)) ?? false));
    if (clips.length) layerTracks.push({ ...t, clips });
  }
  return {
    sections: same(s.sections, (d) => d.sections),
    lookClips: same(s.lookClips, (d) => d.lookClips),
    lines: same(s.lines, (d) => d.lines),
    ledClips: same(s.ledClips, (d) => d.ledClips),
    stageClips: same(s.stageClips, (d) => d.stageClips),
    layerTracks,
    whereOrders: [...s.whereOrders],
  };
}

