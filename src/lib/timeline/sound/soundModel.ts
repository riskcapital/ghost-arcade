/**
 * Sound rows on the Timeline: the model and its pure maths.
 *
 * The Timeline's audio blocks stay `ShowAudioTrack`s (so playback, the
 * waveform, saving, the song analysis and the render mux keep working) and
 * their `lane` is the sound row they sit on. What a row is (its name,
 * volume, mute/solo, Music Studio effects, ducking, or the Live track it is
 * bound to) is the document's `sound.rows[lane]`; Live clip blocks and
 * build blocks are `sound.live` / `sound.builds`, also by lane.
 *
 * Rows the document has not stored yet (an old file's audio lanes) are
 * filled in with defaults (`soundRowsFor`), with ids that stay the same, so
 * a line drawn on such a row keeps its target when the row is first edited.
 *
 * Blocks on one row may overlap: the overlap is a crossfade, equal power,
 * like visual blocks. Fades are equal power too.
 */
import { createMacroFx, MACRO_FX, normalizeMacroFx, type MacroFxInstance, type MacroFxType } from '../../music/macroFx';
import { BUILD_FILTERS, BUILD_ROLLS, BUILD_STYLES, type BuildFilter, type BuildRoll, type BuildStyle } from '../../music/buildDrop';
import type { ShowAudioTrack } from '../../types';

export type SoundRowKind = 'audio' | 'live';
/** When Live starts a clip block: on the beat, on the bar, or the set's own launch quantise. */
export type LiveLaunch = 'beat' | 'bar' | 'set';
export const LIVE_LAUNCHES: readonly LiveLaunch[] = ['beat', 'bar', 'set'];

/** The row dips on each beat or under another row's kick. */
export interface SoundDuck {
  /** 'beat': every beat of the tempo map; otherwise a row id (that row's kick). */
  source: string;
  /** 0..1 */
  depth: number;
  /** Seconds back to full. */
  release: number;
}

export interface SoundRowLive {
  /** Track index in the Live set when bound (a fallback; the name finds it first). */
  track: number;
  trackName: string;
  launch: LiveLaunch;
  /** Extra time the fire command is sent early (network + audio interface). */
  latencyMs: number;
}

export interface SoundRow {
  id: string;
  name: string;
  kind: SoundRowKind;
  /** 0..1 */
  volume: number;
  muted: boolean;
  solo: boolean;
  /** Music Studio effects, in order (macroFx.ts); values 0..1. */
  fx: MacroFxInstance[];
  duck: SoundDuck | null;
  live?: SoundRowLive;
}

/** A Live clip on a Live row: fired in Live at its start, stopped at its end. */
export interface LiveClipBlock {
  id: string;
  lane: number;
  startTime: number;
  duration: number;
  /** Clip slot (scene row) on the row's Live track. */
  slot: number;
  /** What Live called the clip when it was picked (finds it again if it moved). */
  clipName: string;
  /** Live's colour, 0xRRGGBB. */
  color: number;
}

/** A build that lands on its end: the row's mix filters, opens its sends, rolls and rises into an impact. */
export interface BuildBlock {
  id: string;
  lane: number;
  startTime: number;
  duration: number;
  style: BuildStyle;
  roll: BuildRoll;
  filter: BuildFilter;
  riser: number;
  sends: number;
  gap: boolean;
  impact: number;
}

export interface SoundDoc {
  rows: SoundRow[];
  live: LiveClipBlock[];
  builds: BuildBlock[];
}

export const EMPTY_SOUND_DOC: SoundDoc = Object.freeze({ rows: [], live: [], builds: [] }) as SoundDoc;

export const SOUND_MIN_BLOCK_SECONDS = 0.25;
export const LIVE_DEFAULT_LATENCY_MS = 20;

// ── Normalising ────────────────────────────────────────────────────────────

const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown, d: number) => Math.max(0, Math.min(1, finite(v, d)));

/** The default row for lane `index` (stable id, so lines on it survive). */
export function defaultSoundRow(index: number, kind: SoundRowKind = 'audio'): SoundRow {
  return {
    id: `row-${index}`,
    name: kind === 'live' ? `Live ${index + 1}` : index === 0 ? 'Song' : `Sound ${index + 1}`,
    kind,
    volume: 1,
    muted: false,
    solo: false,
    fx: [],
    duck: null,
    ...(kind === 'live' ? { live: { track: -1, trackName: '', launch: 'beat' as LiveLaunch, latencyMs: LIVE_DEFAULT_LATENCY_MS } } : {}),
  };
}

function normalizeRow(raw: unknown, index: number): SoundRow {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const kind: SoundRowKind = r.kind === 'live' ? 'live' : 'audio';
  const base = defaultSoundRow(index, kind);
  const fx = normalizeMacroFx({ fx: r.fx }).fx ?? [];
  const duck = r.duck && typeof r.duck === 'object' && typeof r.duck.source === 'string'
    ? { source: r.duck.source, depth: unit(r.duck.depth, 0.5), release: Math.max(0.05, Math.min(2, finite(r.duck.release, 0.25))) }
    : null;
  const live = kind === 'live'
    ? {
        track: Math.round(finite(r.live?.track, -1)),
        trackName: typeof r.live?.trackName === 'string' ? r.live.trackName : '',
        launch: LIVE_LAUNCHES.includes(r.live?.launch) ? (r.live.launch as LiveLaunch) : 'beat',
        latencyMs: Math.max(0, Math.min(500, finite(r.live?.latencyMs, LIVE_DEFAULT_LATENCY_MS))),
      }
    : undefined;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : base.id,
    name: typeof r.name === 'string' && r.name ? r.name : base.name,
    kind,
    volume: unit(r.volume, 1),
    muted: r.muted === true,
    solo: r.solo === true,
    fx,
    duck,
    ...(live ? { live } : {}),
  };
}

function normalizeBlockTiming(r: Record<string, any>) {
  return {
    id: typeof r.id === 'string' && r.id ? r.id : '',
    lane: Math.max(0, Math.floor(finite(r.lane, 0))),
    startTime: Math.max(0, finite(r.startTime, 0)),
    duration: Math.max(SOUND_MIN_BLOCK_SECONDS, finite(r.duration, 4)),
  };
}

export function normalizeSoundDoc(raw: unknown): SoundDoc {
  if (!raw || typeof raw !== 'object') return EMPTY_SOUND_DOC;
  const r = raw as Record<string, unknown>;
  const rows = (Array.isArray(r.rows) ? r.rows : []).map((row, i) => normalizeRow(row, i));
  const live: LiveClipBlock[] = [];
  for (const item of Array.isArray(r.live) ? r.live : []) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, any>;
    const timing = normalizeBlockTiming(b);
    if (!timing.id) continue;
    live.push({
      ...timing,
      slot: Math.max(0, Math.round(finite(b.slot, 0))),
      clipName: typeof b.clipName === 'string' ? b.clipName : '',
      color: Math.max(0, Math.round(finite(b.color, 0))) & 0xffffff,
    });
  }
  const builds: BuildBlock[] = [];
  for (const item of Array.isArray(r.builds) ? r.builds : []) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, any>;
    const timing = normalizeBlockTiming(b);
    if (!timing.id) continue;
    const style = BUILD_STYLES.find((s) => s.id === b.style) ?? BUILD_STYLES[0];
    builds.push({
      ...timing,
      style: style.id,
      roll: BUILD_ROLLS.some((x) => x.id === b.roll) ? b.roll : style.settings.roll,
      filter: BUILD_FILTERS.some((x) => x.id === b.filter) ? b.filter : style.settings.filter,
      riser: unit(b.riser, style.settings.riser),
      sends: unit(b.sends, style.settings.sends),
      gap: typeof b.gap === 'boolean' ? b.gap : style.settings.gap,
      impact: unit(b.impact, style.settings.impact),
    });
  }
  if (!rows.length && !live.length && !builds.length) return EMPTY_SOUND_DOC;
  return { rows, live, builds };
}

export function soundDocIsEmpty(doc: SoundDoc): boolean {
  return !doc.rows.length && !doc.live.length && !doc.builds.length;
}

// ── Rows ───────────────────────────────────────────────────────────────────

/** How many rows the Timeline shows: stored ones, and enough for every block. */
export function soundRowCount(doc: SoundDoc, tracks: readonly Pick<ShowAudioTrack, 'lane'>[]): number {
  let n = Math.max(1, doc.rows.length);
  for (const t of tracks) n = Math.max(n, t.lane + 1);
  for (const b of doc.live) n = Math.max(n, b.lane + 1);
  for (const b of doc.builds) n = Math.max(n, b.lane + 1);
  return n;
}

/** Every row, stored or default. Same objects for stored rows. */
export function soundRowsFor(doc: SoundDoc, tracks: readonly Pick<ShowAudioTrack, 'lane'>[]): SoundRow[] {
  const n = soundRowCount(doc, tracks);
  if (n === doc.rows.length) return doc.rows;
  const out = doc.rows.slice();
  for (let i = out.length; i < n; i++) out.push(defaultSoundRow(i, doc.live.some((b) => b.lane === i) ? 'live' : 'audio'));
  return out;
}

/** The doc with every shown row stored (so one of them can be edited). */
export function materializeRows(doc: SoundDoc, tracks: readonly Pick<ShowAudioTrack, 'lane'>[]): SoundDoc {
  const rows = soundRowsFor(doc, tracks);
  return rows === doc.rows ? doc : { ...doc, rows };
}

export function updateSoundRow(doc: SoundDoc, tracks: readonly Pick<ShowAudioTrack, 'lane'>[], rowId: string, patch: Partial<SoundRow>): SoundDoc {
  const full = materializeRows(doc, tracks);
  let changed = false;
  const rows = full.rows.map((r) => {
    if (r.id !== rowId) return r;
    changed = true;
    return { ...r, ...patch };
  });
  return changed ? { ...full, rows } : doc;
}

/** A new row at the bottom. A Live row starts bound to nothing. */
export function addSoundRow(doc: SoundDoc, tracks: readonly Pick<ShowAudioTrack, 'lane'>[], kind: SoundRowKind, id: string, name?: string): SoundDoc {
  const full = materializeRows(doc, tracks);
  const row = { ...defaultSoundRow(full.rows.length, kind), id, ...(name ? { name } : {}) };
  return { ...full, rows: [...full.rows, row] };
}

/**
 * Remove a row and everything on it; rows below move up one lane.
 * Returns the doc and the audio blocks left (lanes shifted).
 */
export function removeSoundRow<T extends Pick<ShowAudioTrack, 'lane'>>(doc: SoundDoc, tracks: readonly T[], rowId: string): { doc: SoundDoc; tracks: T[] } {
  const full = materializeRows(doc, tracks);
  const lane = full.rows.findIndex((r) => r.id === rowId);
  if (lane < 0) return { doc, tracks: tracks.slice() };
  const shift = <B extends { lane: number }>(list: readonly B[]): B[] =>
    list.filter((b) => b.lane !== lane).map((b) => (b.lane > lane ? { ...b, lane: b.lane - 1 } : b));
  return {
    doc: { rows: full.rows.filter((r) => r.id !== rowId), live: shift(full.live), builds: shift(full.builds) },
    tracks: shift(tracks),
  };
}

/** Mute and solo: a soloed row plays alone (with other soloed rows); a muted row never plays. */
export function rowAudible(row: Pick<SoundRow, 'muted' | 'solo'>, rows: readonly Pick<SoundRow, 'solo'>[]): boolean {
  if (row.muted) return false;
  const anySolo = rows.some((r) => r.solo);
  return !anySolo || row.solo;
}

// ── Effects ────────────────────────────────────────────────────────────────

export function addRowFx(row: SoundRow, type: MacroFxType, id: string): SoundRow {
  const fx = createMacroFx(id, type);
  // On a row the effect is heard as set (no macro moving it): open its mix.
  if (fx.params.mix && fx.params.mix.value === 0) fx.params.mix.value = 0.35;
  return { ...row, fx: [...row.fx, fx] };
}

export function setRowFxParam(row: SoundRow, fxId: string, key: string, value: number): SoundRow {
  const v = Math.max(0, Math.min(1, value));
  return {
    ...row,
    fx: row.fx.map((f) => (f.id === fxId && f.params[key] ? { ...f, params: { ...f.params, [key]: { ...f.params[key], value: v } } } : f)),
  };
}

export const ROW_FX_TYPES: readonly MacroFxType[] = MACRO_FX.map((d) => d.type);

// ── Fades and crossfades ───────────────────────────────────────────────────

export interface FadeBlock {
  id: string;
  startTime: number;
  duration: number;
  fadeIn?: number;
  fadeOut?: number;
}

/** Equal-power fade curve, 0..1 → 0..1. */
export function fadeCurve(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return Math.sin((x * Math.PI) / 2);
}

/**
 * A block's fades on its row: its own, lengthened where it overlaps the
 * block before (fade in over the overlap) or after (fade out over it), so
 * an overlap is an equal-power crossfade.
 */
export function effectiveFades(block: FadeBlock, rowBlocks: readonly FadeBlock[]): { fadeIn: number; fadeOut: number } {
  const start = block.startTime;
  const end = start + block.duration;
  let fadeIn = Math.max(0, block.fadeIn ?? 0);
  let fadeOut = Math.max(0, block.fadeOut ?? 0);
  for (const o of rowBlocks) {
    if (o.id === block.id) continue;
    const oStart = o.startTime;
    const oEnd = oStart + o.duration;
    if (oStart < start && oEnd > start && oEnd < end) fadeIn = Math.max(fadeIn, oEnd - start);
    else if (oStart > start && oStart < end && oEnd > end) fadeOut = Math.max(fadeOut, end - oStart);
  }
  const room = block.duration;
  if (fadeIn + fadeOut > room) {
    const k = room / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }
  return { fadeIn, fadeOut };
}

/** The block's gain at show time `t` (0 outside it). */
export function blockGainAt(block: FadeBlock, t: number, fades = { fadeIn: block.fadeIn ?? 0, fadeOut: block.fadeOut ?? 0 }): number {
  const local = t - block.startTime;
  if (local < 0 || local >= block.duration) return 0;
  let g = 1;
  if (fades.fadeIn > 0 && local < fades.fadeIn) g *= fadeCurve(local / fades.fadeIn);
  const left = block.duration - local;
  if (fades.fadeOut > 0 && left < fades.fadeOut) g *= fadeCurve(left / fades.fadeOut);
  return g;
}

// ── Block edits (overlap allowed: it crossfades) ───────────────────────────

export interface MovableAudio extends FadeBlock {
  lane: number;
  offset: number;
  sourceDuration: number;
}

/** Move a block to `startTime` (already snapped) and maybe another row. */
export function moveSoundBlock<T extends MovableAudio>(block: T, startTime: number, lane = block.lane): T {
  const s = Math.max(0, Number.isFinite(startTime) ? startTime : block.startTime);
  const l = Math.max(0, Math.floor(lane));
  if (Math.abs(s - block.startTime) < 1e-9 && l === block.lane) return block;
  return { ...block, startTime: s, lane: l };
}

/**
 * Trim a block's edge to `time` (already snapped). The left edge moves the
 * in-point with it so the sound under it stays put; neither edge goes past
 * the file. Fades shorten with the block.
 */
export function trimSoundBlock<T extends MovableAudio>(block: T, edge: 'start' | 'end', time: number): T {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  let { startTime, duration, offset } = block;
  if (edge === 'end') {
    const remaining = block.sourceDuration > 0 ? block.sourceDuration - block.offset : Infinity;
    duration = Math.max(SOUND_MIN_BLOCK_SECONDS, Math.min(t - block.startTime, remaining));
  } else {
    const right = block.startTime + block.duration;
    const earliest = Math.max(0, block.startTime - block.offset);
    startTime = Math.max(earliest, Math.min(t, right - SOUND_MIN_BLOCK_SECONDS));
    offset = Math.max(0, block.offset + (startTime - block.startTime));
    duration = right - startTime;
  }
  if (Math.abs(startTime - block.startTime) < 1e-9 && Math.abs(duration - block.duration) < 1e-9) return block;
  const fadeIn = Math.min(block.fadeIn ?? 0, duration);
  const fadeOut = Math.min(block.fadeOut ?? 0, Math.max(0, duration - fadeIn));
  return { ...block, startTime, duration, offset, ...(block.fadeIn !== undefined ? { fadeIn } : {}), ...(block.fadeOut !== undefined ? { fadeOut } : {}) };
}

/** Set a fade length (seconds), kept inside the block with the other fade. */
export function setBlockFade<T extends FadeBlock>(block: T, edge: 'in' | 'out', seconds: number): T {
  const other = edge === 'in' ? block.fadeOut ?? 0 : block.fadeIn ?? 0;
  const v = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, block.duration - other));
  const key = edge === 'in' ? 'fadeIn' : 'fadeOut';
  if (Math.abs((block[key] ?? 0) - v) < 1e-6) return block;
  return { ...block, [key]: v };
}

/** Move/trim a timed block that has no file (Live clip, build). */
export function retimeBlock<T extends { startTime: number; duration: number }>(block: T, edge: 'move' | 'start' | 'end', time: number): T {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  if (edge === 'move') return Math.abs(t - block.startTime) < 1e-9 ? block : { ...block, startTime: t };
  const end = block.startTime + block.duration;
  if (edge === 'end') {
    const duration = Math.max(SOUND_MIN_BLOCK_SECONDS, t - block.startTime);
    return Math.abs(duration - block.duration) < 1e-9 ? block : { ...block, duration };
  }
  const startTime = Math.min(t, end - SOUND_MIN_BLOCK_SECONDS);
  return { ...block, startTime, duration: end - startTime };
}

/** The furthest edge of the doc's own blocks (Live and builds). */
export function soundDocEnd(doc: SoundDoc): number {
  let end = 0;
  for (const b of doc.live) end = Math.max(end, b.startTime + b.duration);
  for (const b of doc.builds) end = Math.max(end, b.startTime + b.duration);
  return end;
}
