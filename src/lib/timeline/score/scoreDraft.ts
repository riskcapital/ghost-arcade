/**
 * Score the song: a first draft of a Timeline from the song's structure
 * (songStructure.ts). Pure; the same structure, stage and seed give the same
 * draft, and another seed (Shuffle) picks other looks and colours by the
 * same rules.
 *
 * What it lays down (each only where the Timeline has nothing yet, so it
 * never overwrites what the artist made):
 *
 *   Sections   named and coloured by what they are (all play through)
 *   Looks row  a look per section, from a tier that suits the section:
 *              calm for intros, breakdowns and outros, moving chasers for
 *              builds, the hardest looks for drops; never the same look
 *              twice in a row; cuts on section starts. Drops cut on every
 *              bar between two looks, and on every beat in their first bar.
 *   Where      (two or more pieces) a motion per section: sweep on builds,
 *              burst on drops, ping-pong in breakdowns and verses, a slow
 *              backwards sweep in the outro; intros light every piece.
 *   Energy     one line on All looks: look intensity follows the song's
 *              energy (drawn per section, builds ramp up) plus a little of
 *              its loudness, so quiet parts are dim and drops hit.
 *   Stage      a line on the first Stage FX's mix (or the LED controllers'
 *              brightness when there is no Stage FX) following the energy.
 *   LEDs       Follow the stage on every LED controller row.
 *   Screen FX  (one or more pieces, an empty Screen FX row) a Screen FX
 *              block per section, timed to the bar: beat pulse on drops,
 *              a linear sweep on builds, breathing in intros, breakdowns
 *              and outros, a travelling sine wave in verses, a chase in
 *              bridges.
 */
import type { ShowLookClip, ShowTempoMap } from '../../types';
import type { ControlLine, LinePoint } from '../lines/lineModel';
import type { TimelineLedClip } from '../leds/ledClips';
import type { TimelineStageClip } from '../stagefx/stageClips';
import type { StageEffect, StageEffectType } from '../../types';
import type { WhereMotion, WhereSpec } from '../where/whereModel';
import { SECTION_KIND_COLORS, type SectionKind, type TimelineSection } from '../sections/sectionModel';
import { ALL_LOOKS_ID } from '../lines/paramRegistry';
import type { DetectedSection, SongStructure } from './songStructure';
import { beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';

export const CALM_LOOKS = ['gradient-glow', 'halftone-breathe', 'wireframe-origami', 'radar-scan', 'clock-wipe', 'hypno-rings', 'marching-ants'] as const;
export const MID_LOOKS = ['mosaic-shimmer', 'flip-cards', 'echo-rings', 'electric-nodes', 'beat-step', 'stripe-sweep', 'twin-snakes', 'neon-pulse'] as const;
export const BUILD_LOOKS = ['comet-chase', 'stripe-sweep', 'zigzag', 'twin-snakes', 'beat-step', 'electric-nodes'] as const;
/** Drops: looks that fill the faces (they read big on the stage), plus the laser grid. */
export const DROP_LOOKS = ['kick-strobe', 'hue-hop', 'iris-pop', 'rush-hour', 'laser-grid'] as const;

const PALETTES: Record<SectionKind, readonly string[]> = {
  intro: ['ice', 'ocean', 'mono'],
  verse: ['candy', 'ocean', 'sunset', 'ice'],
  build: ['sunset', 'acid', 'candy'],
  drop: ['fire', 'neon', 'acid'],
  breakdown: ['ocean', 'ice', 'candy'],
  bridge: ['sunset', 'candy', 'ocean'],
  outro: ['mono', 'ice', 'ocean'],
  other: ['neon', 'ocean', 'sunset'],
};

/** Which looks suit a section, by what it is and how intense it is. */
export function lookTier(kind: SectionKind, energy: number): readonly string[] {
  switch (kind) {
    case 'drop': return DROP_LOOKS;
    case 'build': return BUILD_LOOKS;
    case 'intro':
    case 'outro':
    case 'breakdown': return CALM_LOOKS;
    default: return energy >= 0.75 ? DROP_LOOKS : energy <= 0.3 ? CALM_LOOKS : MID_LOOKS;
  }
}

/** Seeded random numbers (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface ScoreStage {
  /** Mapping pieces, any order (where motions need two or more). */
  pieces: ReadonlyArray<{ id: string; name: string }>;
  /** LED controller rows (`led:<id>`). */
  ledRows: readonly string[];
  /** Stage FX on the mapping stage (first is used for the stage line). */
  stageFx: ReadonlyArray<{ id: string; name: string }>;
  /** WLED controllers (for brightness lines when there is no Stage FX). */
  ledControllers: ReadonlyArray<{ id: string; name: string }>;
}

export interface ScoreExisting {
  sections: readonly TimelineSection[];
  lookClips: readonly ShowLookClip[];
  lines: readonly ControlLine[];
  ledClips: readonly TimelineLedClip[];
  stageClips?: readonly TimelineStageClip[];
}

export interface ScoreDraft {
  sections: TimelineSection[];
  lookClips: ShowLookClip[];
  lines: ControlLine[];
  ledClips: TimelineLedClip[];
  /** Screen FX row blocks. */
  stageClips: TimelineStageClip[];
  /** What it adds, one line each (the confirm lists these). */
  adds: string[];
  /** What it leaves alone and why. */
  skips: string[];
  /** The sections the draft followed (detected, or the Timeline's own). */
  plan: Array<{ start: number; end: number; kind: SectionKind; energy: number; name: string; lookIds: string[]; motion: WhereMotion['kind'] | null }>;
}

/** Look block ids, line ids… come from here so a test can fix them. */
export interface ScoreIds { next(prefix: string): string }

export function sequentialIds(base = 'score'): ScoreIds {
  let n = 0;
  return { next: (prefix) => `${base}-${prefix}-${++n}` };
}

function overlaps(a: { start: number; end: number }, start: number, end: number): boolean {
  return a.start < end - 1e-6 && a.end > start + 1e-6;
}

function beatTimes(tempo: ShowTempoMap, start: number, end: number): number[] {
  const out: number[] = [];
  let q = Math.ceil(beatAtSeconds(tempo, start) - 1e-6);
  for (let guard = 0; guard < 100000; guard++) {
    const t = secondsAtBeat(tempo, q);
    if (t >= end - 1e-6) break;
    out.push(Math.round(t * 1e6) / 1e6);
    q++;
  }
  return out;
}

function pick<T>(list: readonly T[], rnd: () => number, avoid: ReadonlySet<T> = new Set()): T {
  const ok = list.filter((x) => !avoid.has(x));
  const from = ok.length ? ok : list;
  return from[Math.floor(rnd() * from.length) % from.length];
}

function whereFor(kind: SectionKind, energy: number, barsLong: number): WhereSpec | null {
  const base = { order: 'left-right' as const, members: 'pieces' as const, position: 0, wrap: true };
  switch (kind) {
    case 'build': return { ...base, motion: { kind: 'sweep', bars: barsLong >= 8 ? 2 : 1 }, spread: 0.35, soft: 0.5 };
    case 'drop': return { ...base, motion: { kind: 'burst', bars: 1 }, spread: 1, soft: 0.3 };
    case 'breakdown': return { ...base, motion: { kind: 'pingpong', bars: 4 }, spread: 0.5, soft: 0.7 };
    case 'verse':
    case 'bridge':
    case 'other': return energy >= 0.6 ? { ...base, motion: { kind: 'sweep', bars: 1 }, spread: 0.5, soft: 0.5 } : { ...base, motion: { kind: 'pingpong', bars: 2 }, spread: 0.6, soft: 0.6 };
    case 'outro': return { ...base, motion: { kind: 'sweep', bars: 4, reverse: true }, spread: 0.7, soft: 0.7 };
    default: return null;
  }
}

/** Look intensity at a section's start and end (builds ramp up). */
function intensityAt(kind: SectionKind, energy: number): [number, number] {
  const v = 0.6 + 0.55 * energy;
  if (kind === 'build') return [Math.max(0.35, v - 0.25), Math.min(1.3, v + 0.35)];
  if (kind === 'drop') return [Math.max(1, v), Math.max(1, v)];
  if (kind === 'outro') return [v, 0.15];
  if (kind === 'intro') return [Math.max(0.4, v - 0.15), v];
  return [v, v];
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** The Screen FX for a section, timed to its bar (`bar` seconds). Accents
 *  over the looks: mixed at 40–55 %, so a piece never drops below about half
 *  its brightness and the looks stay readable. */
export function screenFxFor(kind: SectionKind, energy: number, bar: number, id: string): StageEffect {
  const fx = (type: StageEffectType, params: Record<string, number>, opacity = 0.4): StageEffect => ({ id, type, enabled: true, opacity, params });
  const b = Math.max(0.2, bar);
  switch (kind) {
    // A flash on every beat, decaying over a third of it.
    case 'drop': return fx('beat-pulse', { sensitivity: 1.4, decay: round(Math.max(0.08, (b / 4) * 0.6)), threshold: 0.08 }, 0.55);
    // One pass across the stage per bar.
    case 'build': return fx('linear-sweep', { angle: 0, speed: round(2 / b), bandWidth: 0.35, tail: 0.4 }, 0.45);
    case 'intro': return fx('breathing', { speed: round(1 / (4 * b)), depth: 0.45, heartbeat: 0 });
    case 'outro': return fx('breathing', { speed: round(1 / (4 * b)), depth: 0.6, heartbeat: 0 });
    case 'breakdown': return fx('breathing', { speed: round(1 / (2 * b)), depth: 0.55, heartbeat: 0.3 });
    case 'bridge': return fx('chase', { speed: round(1 / (2 * b)), width: 0.3 });
    default: return fx('sine-wave', { speed: round(1 / (2 * b)), phaseSpread: 1.6, depth: round(0.35 + 0.3 * energy) });
  }
}

export const SCREEN_FX_NAMES: Partial<Record<StageEffectType, string>> = {
  'beat-pulse': 'beat pulse', 'linear-sweep': 'sweep', breathing: 'breathing', chase: 'chase', 'sine-wave': 'sine wave',
};

/**
 * The draft for `structure` on a Timeline that already has `existing`.
 * `seed`: the same seed gives the same draft (the song's own hash, plus a
 * Shuffle count).
 */
export function draftScore(
  structure: Pick<SongStructure, 'sections' | 'barEnergy' | 'bars'>,
  tempo: ShowTempoMap,
  stage: ScoreStage,
  existing: ScoreExisting,
  seed: number,
  ids: ScoreIds = sequentialIds(`s${seed}`),
): ScoreDraft {
  const rnd = seededRandom(seed);
  const adds: string[] = [];
  const skips: string[] = [];
  const songStart = structure.sections[0]?.start ?? 0;
  const songEnd = structure.sections[structure.sections.length - 1]?.end ?? 0;

  // ── Sections ───────────────────────────────────────────────────────────
  // The Timeline's own sections win: the draft follows them (what each one
  // is comes from the detected section it overlaps most).
  const own = existing.sections.filter((s) => overlaps(s, songStart, songEnd));
  let plan: Array<{ start: number; end: number; kind: SectionKind; energy: number; name: string }>;
  const sections: TimelineSection[] = [];
  if (own.length) {
    skips.push(`Sections: the Timeline has ${own.length} already; the draft follows them.`);
    plan = own.map((s) => {
      let best: DetectedSection | null = null;
      let bestOverlap = 0;
      for (const d of structure.sections) {
        const o = Math.min(d.end, s.end) - Math.max(d.start, s.start);
        if (o > bestOverlap) { bestOverlap = o; best = d; }
      }
      return { start: s.start, end: s.end, kind: s.kind ?? best?.kind ?? 'other', energy: s.energy ?? best?.energy ?? 0.5, name: s.name };
    });
  } else {
    plan = structure.sections.map((d) => ({ start: d.start, end: d.end, kind: d.kind, energy: d.energy, name: d.name }));
    for (const d of structure.sections) {
      sections.push({ id: ids.next('section'), name: d.name, color: SECTION_KIND_COLORS[d.kind], start: d.start, end: d.end, action: 'through', kind: d.kind, energy: d.energy });
    }
    if (sections.length) adds.push(`${sections.length} sections: ${sections.map((s) => s.name).join(', ')}`);
  }

  // ── Looks row ──────────────────────────────────────────────────────────
  const lookClips: ShowLookClip[] = [];
  const planOut: ScoreDraft['plan'] = [];
  const looksFree = !existing.lookClips.some((c) => overlaps({ start: c.startTime, end: c.startTime + c.duration }, songStart, songEnd));
  const withWhere = stage.pieces.length >= 2;
  const motions = new Set<string>();
  let prevLook = null as string | null;
  const kindLooks = new Map<SectionKind, string>();
  const kindPalettes = new Map<SectionKind, string>();
  for (const p of plan) {
    const barsLong = structure.bars.filter((b) => b >= p.start - 1e-6 && b < p.end - 1e-6).length;
    const where = withWhere ? whereFor(p.kind, p.energy, barsLong) : null;
    const tier = lookTier(p.kind, p.energy);
    // A drop that comes back keeps its colours; its look changes.
    const palette = kindPalettes.get(p.kind) ?? pick(PALETTES[p.kind], rnd);
    kindPalettes.set(p.kind, palette);
    const avoid: Set<string> = new Set([prevLook, kindLooks.get(p.kind)].filter((x): x is string => !!x));
    const lookA: string = pick(tier, rnd, avoid);
    const lookIds: string[] = [lookA];
    if (looksFree) {
      const block = (start: number, end: number, lookId: string, extra: Partial<ShowLookClip> = {}) => {
        lookClips.push({
          id: ids.next('look'), lookId, paletteId: palette, startTime: round(start), duration: round(end - start),
          scope: 'all', fadeIn: 0, fadeOut: 0, ...(where ? { where: { ...where } } : {}), ...extra,
        });
      };
      if (p.kind === 'drop') {
        const lookB = pick(tier, rnd, new Set([lookA, ...avoid]));
        lookIds.push(lookB);
        const barTimes = structure.bars.filter((b) => b >= p.start - 1e-6 && b < p.end - 1e-6);
        const edges = [...barTimes, p.end];
        if (Math.abs(edges[0] - p.start) > 1e-6) edges.unshift(p.start);
        // The first bar cuts on every beat, then every bar.
        const firstBarEnd = edges[1] ?? p.end;
        const beats = [...beatTimes(tempo, p.start, firstBarEnd), firstBarEnd];
        let flip = 0;
        for (let i = 0; i < beats.length - 1; i++) block(beats[i], beats[i + 1], flip++ % 2 === 0 ? lookA : lookB);
        for (let i = 1; i < edges.length - 1; i++) block(edges[i], edges[i + 1], flip++ % 2 === 0 ? lookA : lookB);
      } else {
        const bar = structure.bars.length > 1 ? structure.bars[1] - structure.bars[0] : 2;
        block(p.start, p.end, lookA, {
          ...(p.kind === 'intro' ? { fadeIn: Math.min(bar, (p.end - p.start) / 2) } : {}),
          ...(p.kind === 'outro' ? { fadeOut: Math.min(2 * bar, (p.end - p.start) / 2) } : {}),
        });
      }
      if (where) motions.add(`${where.motion.kind}`);
    }
    prevLook = lookIds[lookIds.length - 1];
    kindLooks.set(p.kind, lookA);
    planOut.push({ ...p, lookIds, motion: looksFree && where ? where.motion.kind : null });
  }
  if (looksFree && lookClips.length) {
    const drops = plan.filter((p) => p.kind === 'drop').length;
    adds.push(`${lookClips.length} look blocks on the Looks row: a look per section${drops ? ', drops cut on the beat then every bar' : ''}`);
    if (motions.size) adds.push(`Where motions across the pieces: ${[...motions].map((m) => MOTION_NAMES[m] ?? m).join(', ')}`);
  } else if (!looksFree) {
    skips.push('Looks row: it has blocks under the song already.');
  }

  // ── Lines ──────────────────────────────────────────────────────────────
  const lines: ControlLine[] = [];
  const energyPoints: LinePoint[] = [];
  for (const p of plan) {
    const [a, b] = intensityAt(p.kind, p.energy);
    const last = energyPoints[energyPoints.length - 1];
    // A cut at the section start: the previous section's value holds to here.
    if (last && Math.abs(last.t - p.start) < 1e-6) last.c = 'hold';
    energyPoints.push({ t: round(p.start), v: round(a), c: p.kind === 'build' ? 'ease-in' : 'linear' });
    energyPoints.push({ t: round(Math.max(p.start, p.end - 0.01)), v: round(b), c: 'linear' });
  }
  const hasAllLooks = existing.lines.some((l) => l.target.scope === 'look' && l.target.id === ALL_LOOKS_ID && l.key === 'look:intensity');
  const anyLooks = lookClips.length > 0 || existing.lookClips.length > 0;
  if (anyLooks && !hasAllLooks && energyPoints.length) {
    lines.push({
      id: ids.next('line'), target: { scope: 'look', id: ALL_LOOKS_ID }, key: 'look:intensity', kind: 'continuous',
      min: 0, max: 2, step: 0.01, default: 1, points: energyPoints,
      follow: { source: { kind: 'audio', feature: 'level' }, depth: 0.15, smooth: 0.05 },
      label: 'Energy · look intensity',
    });
    adds.push('An energy line on All looks: look intensity follows the song');
  } else if (hasAllLooks) {
    skips.push('Energy line: All looks has an intensity line already.');
  }
  const stagePoints = plan.flatMap((p) => {
    const v = round(0.35 + 0.65 * p.energy);
    return [{ t: round(p.start), v, c: 'linear' as const }, { t: round(Math.max(p.start, p.end - 0.01)), v, c: 'linear' as const }];
  });
  if (stage.stageFx.length) {
    const fx = stage.stageFx[0];
    const key = `stage:fx:${fx.id}:opacity`;
    if (existing.lines.some((l) => l.target.scope === 'stage' && l.key === key)) skips.push(`Stage line: ${fx.name} mix has a line already.`);
    else {
      lines.push({ id: ids.next('line'), target: { scope: 'stage' }, key, kind: 'continuous', min: 0, max: 1, step: 0.01, default: 1, points: stagePoints, label: `Energy · ${fx.name} mix` });
      adds.push(`A Stage FX line: ${fx.name} mix follows the energy`);
    }
  } else if (stage.ledControllers.length) {
    let added = 0;
    for (const c of stage.ledControllers) {
      const key = `led:${c.id}:brightness`;
      if (existing.lines.some((l) => l.target.scope === 'led' && l.key === key)) continue;
      lines.push({ id: ids.next('line'), target: { scope: 'led' }, key, kind: 'continuous', min: 0, max: 1, step: 0.01, default: 1, points: stagePoints, label: `Energy · ${c.name} brightness` });
      added++;
    }
    if (added) adds.push(`LED brightness ${added === 1 ? 'line' : 'lines'} following the energy (${added} ${added === 1 ? 'controller' : 'controllers'})`);
  } else {
    skips.push('Stage line: no Stage FX or LED controller to drive (add a Stage FX for a brightness line).');
  }

  // ── LEDs ───────────────────────────────────────────────────────────────
  const ledClips: TimelineLedClip[] = [];
  for (const rowId of stage.ledRows) {
    if (existing.ledClips.some((c) => c.rowId === rowId && overlaps({ start: c.startTime, end: c.startTime + c.duration }, songStart, songEnd))) continue;
    ledClips.push({
      id: ids.next('led'), rowId, startTime: round(songStart), duration: round(songEnd - songStart), fadeIn: 0, fadeOut: 0, kind: 'follow',
      color: '#ff2bd6', color2: '#00e5ff', brightness: 1, speed: 0, width: 0.15, amount: 1, label: 'Follow the stage',
    });
  }
  if (ledClips.length) adds.push(`Follow the stage on ${ledClips.length} LED ${ledClips.length === 1 ? 'row' : 'rows'}`);

  // ── Screen FX ──────────────────────────────────────────────────────────
  const stageClips: TimelineStageClip[] = [];
  const screenFxBusy = (existing.stageClips ?? []).some((c) => c.row === 'screenfx' && overlaps({ start: c.startTime, end: c.startTime + c.duration }, songStart, songEnd));
  if (!stage.pieces.length) {
    skips.push('Screen FX row: no pieces on the stage to drive.');
  } else if (screenFxBusy) {
    skips.push('Screen FX row: it has blocks under the song already.');
  } else {
    const bar = structure.bars.length > 1 ? structure.bars[1] - structure.bars[0] : 2;
    const kinds = new Set<string>();
    for (const p of plan) {
      if (p.end - p.start < 0.1) continue;
      const screenFx = screenFxFor(p.kind, p.energy, bar, ids.next('screenfx'));
      kinds.add(SCREEN_FX_NAMES[screenFx.type] ?? screenFx.type);
      stageClips.push({
        id: ids.next('stage'), row: 'screenfx', startTime: round(p.start), duration: round(p.end - p.start),
        fadeIn: p.kind === 'intro' ? round(Math.min(bar, (p.end - p.start) / 2)) : 0,
        fadeOut: p.kind === 'outro' ? round(Math.min(2 * bar, (p.end - p.start) / 2)) : 0,
        screenFx,
      });
    }
    if (stageClips.length) adds.push(`${stageClips.length} Screen FX blocks, one per section: ${[...kinds].join(', ')}`);
  }

  return { sections, lookClips, lines, ledClips, stageClips, adds, skips, plan: planOut };
}

const MOTION_NAMES: Record<string, string> = { sweep: 'sweep', burst: 'burst', pingpong: 'ping-pong', random: 'random', kick: 'kick', drawn: 'drawn' };

/** Nothing to add. */
export function draftIsEmpty(d: Pick<ScoreDraft, 'sections' | 'lookClips' | 'lines' | 'ledClips'> & { stageClips?: readonly TimelineStageClip[] }): boolean {
  return !d.sections.length && !d.lookClips.length && !d.lines.length && !d.ledClips.length && !(d.stageClips?.length);
}
