/**
 * ✦ Auto show on the Timeline: reads the song on the Song row (the same
 * cached analysis Score and the lines use), finds its structure and style,
 * groups the mapping's pieces, and lays the draft down (autoShowDraft.ts) as
 * one undo step. Then it plays the show from the top.
 *
 * Changing the style or the content in the dialog re-drafts from the same
 * analysis (instant). Shuffle replaces the last draft with another (a new
 * seed, same style and content): what the last drafts laid down and the
 * user has not touched since comes out first, so an edited block stays.
 * "Looks only" is the old ✦ Score (scoreRuntime.ts).
 *
 * A draft is laid down only onto what it was worked out from (draftInputs.ts):
 * if the pieces or the Timeline changed since, or the song, Build refuses and
 * says why. Every step that waits takes a signal and stops when it fires.
 */
import { get } from 'svelte/store';
import type { Layer, ShowAudioTrack, ShowTempoMap } from '../../types';
import { onShowTimelineReset, showTimeline } from '../../stores/showTimeline';
import { project } from '../../stores/layers';
import { mediaLibrary } from '../../stores/media';
import { cachedShowAudioDecode, decodeShowAudio } from '../../audio/showAudio';
import { songFeaturesFor, type SongFeatures } from '../lines/songFeatures';
import { detectShowTempo } from '../../show/tempoDetect';
import { createTempoMap } from '../../show/tempoMap';
import { getTransformAspect } from '../../keyframes/layerParamKeys';
import { isLookTarget } from '../../looks/edgeLooks';
import { detectSongStructure, type SongStructure } from '../score/songStructure';
import { hashString } from '../score/scoreDraft';
import { scoreSongTrack, staleMessage, laidOnTimeline, type DraftCommitResult } from '../score/scoreRuntime';
import { draftInputsNow, draftStaleness, songInputKey, type DraftInputs, type DraftStaleness } from '../score/draftInputs';
import { ledSpotId } from '../where/spatialOrder';
import { generateUUID } from '../../utils/uuid';
import { readSongStyle, type ShowStyle, type StyleReading } from './songStyle';
import { autoDraftIsEmpty, draftAutoShow, stripDrafts, withAutoRows, type AutoShowDraft, type AutoShowStage } from './autoShowDraft';
import { AUTO_SHOW_CATALOG } from './catalogData';
import type { CastMember } from './catalog';
import { libraryCastDetailed } from './libraryVideos';

export type AutoShowSource = 'builtin' | 'library' | 'both';

export interface AutoShowPrep {
  track: ShowAudioTrack;
  tempo: ShowTempoMap;
  /** The tempo was found now (it goes in with the draft). */
  tempoDetected: boolean;
  /** The song has a steady beat (tempo detection found one, or the Timeline had a tempo). */
  pulse: boolean;
  features: SongFeatures;
  structure: SongStructure;
  reading: StyleReading;
  style: ShowStyle;
  source: AutoShowSource;
  /** Videos in My library (the dialog offers Both when there are some). */
  libraryVideos: number;
  draft: AutoShowDraft;
  seed: number;
  /** Milliseconds: reading the song (decode + analysis), and drafting. */
  timings: { analysisMs: number; draftMs: number };
  /** What the draft was worked out from (it is laid down only onto the same). */
  inputs: DraftInputs;
}

export type AutoShowPrepResult =
  | { ok: true; prep: AutoShowPrep }
  /** `cancelled`: the signal stopped it. `undone`: Shuffle found none of the show on the Timeline. */
  | { ok: false; reason: string; cancelled?: boolean; undone?: boolean };

const CANCELLED = { ok: false, reason: 'Stopped.', cancelled: true } as const;

// ── Content ────────────────────────────────────────────────────────────

const shaderSources = new Map<string, string | null>();

/** ISF sources of the catalog's shaders, fetched once. */
async function loadShaderSources(files: readonly string[]): Promise<void> {
  await Promise.all(files.filter((f) => !shaderSources.has(f)).map(async (file) => {
    try {
      const res = await fetch(`./ISF/${file.split('/').map(encodeURIComponent).join('/')}`);
      shaderSources.set(file, res.ok ? await res.text() : null);
    } catch {
      shaderSources.set(file, null);
    }
  }));
}

/** Test seam: shader sources without fetching. */
export function _setShaderSources(sources: Record<string, string>): void {
  for (const [k, v] of Object.entries(sources)) shaderSources.set(k, v);
}

let libraryMemo: { key: string; cast: CastMember[] } | null = null;
async function libraryMembers(signal?: AbortSignal): Promise<CastMember[]> {
  const items = get(mediaLibrary).filter((i) => i.type === 'video' && !i.broken && i.src);
  const key = items.map((i) => i.id).join('|');
  if (libraryMemo?.key === key) return libraryMemo.cast;
  const { cast, complete } = await libraryCastDetailed(items, undefined, { signal });
  // Kept only when every video was measured: the next read tries the rest.
  if (complete) libraryMemo = { key, cast };
  return cast;
}

// ── Stage ──────────────────────────────────────────────────────────────

function stageNow(): AutoShowStage {
  const s = get(showTimeline);
  const p = get(project) as { layers?: Layer[]; wledControllers?: Array<{ id: string; name?: string }>; mappingComposition?: { effects?: Array<{ id: string; type: string; enabled?: boolean }> } };
  const layers = (p.layers ?? []).filter(isLookTarget);
  const controllers = p.wledControllers ?? [];
  const fx = (p.mappingComposition?.effects ?? []).filter((e) => e.enabled !== false);
  return {
    pieces: s.layerTracks.filter((t) => !t.subRow).map((t) => ({ id: t.layerId, name: t.layerName })),
    ledRows: controllers.map((c) => ledSpotId(c.id)),
    stageFx: fx.map((e) => ({ id: e.id, name: e.type.charAt(0).toUpperCase() + e.type.slice(1) })),
    ledControllers: controllers.map((c) => ({ id: c.id, name: c.name || 'WLED' })),
    layers,
    aspect: getTransformAspect(),
  };
}

function songKey(track: ShowAudioTrack): string {
  return `${track.name}|${Math.round((track.sourceDuration || track.duration) * 10)}|${track.startTime}`;
}

// ── Drafts ─────────────────────────────────────────────────────────────

let shuffleCount = 0;
let lastPrep: AutoShowPrep | null = null;
/** What the drafts laid down since the last new document put on the
 *  Timeline (Shuffle takes it out): only the laid items, the last few. */
type LaidDraft = Pick<AutoShowDraft, 'sections' | 'lookClips' | 'lines' | 'ledClips' | 'stageClips' | 'layerTracks'>;
let drafts: LaidDraft[] = [];
/** Drafts remembered for Shuffle (an undo further back than this brings
 *  back a show Shuffle then leaves in place). */
export const MAX_AUTO_DRAFTS = 8;
/** Drafts already laid down: laying one again would put it on top of itself. */
const laidDrafts = new WeakSet<AutoShowDraft>();

onShowTimelineReset(() => forgetLastAutoShow());

export function forgetLastAutoShow(): void {
  lastPrep = null;
  drafts = [];
  shuffleCount = 0;
}

/** Let go of the last show's song analysis and draft (the dialog closed).
 *  What it laid stays remembered, so a later Shuffle still takes it out. */
export function releaseLastAutoShow(): void {
  lastPrep = null;
}

function rememberLaid(d: AutoShowDraft): void {
  laidDrafts.add(d);
  drafts.push({ sections: d.sections, lookClips: d.lookClips, lines: d.lines, ledClips: d.ledClips, stageClips: d.stageClips, layerTracks: d.layerTracks });
  if (drafts.length > MAX_AUTO_DRAFTS) drafts = drafts.slice(-MAX_AUTO_DRAFTS);
}

/** Test seam: how many laid drafts Shuffle remembers. */
export function _autoDraftCount(): number {
  return drafts.length;
}

export function hasLastAutoShow(): boolean {
  return lastPrep !== null;
}

function draftFor(prep: Omit<AutoShowPrep, 'draft' | 'timings' | 'inputs'> & { timings?: AutoShowPrep['timings'] }, library: CastMember[], existing = currentExisting(), keepEdited = false): { draft: AutoShowDraft; ms: number; inputs: DraftInputs } {
  const t0 = performance.now();
  // Read with the stage and the Timeline below, in the same task.
  const inputs = draftInputsNow();
  const draft = draftAutoShow({
    structure: prep.structure,
    tempo: prep.tempo,
    style: prep.style,
    stage: stageNow(),
    existing,
    catalog: AUTO_SHOW_CATALOG,
    library,
    source: prep.source,
    shaderCode: (file) => shaderSources.get(file) ?? null,
    seed: prep.seed,
    ids: { next: (prefix) => `${prefix}-${generateUUID()}` },
    keepEdited,
  });
  if (prep.tempoDetected) draft.adds.unshift(`Tempo ${Math.round(prep.tempo.segments[0].bpm * 10) / 10} BPM, from the song`);
  if (!prep.pulse) draft.skips.unshift('No steady beat in the song: cut to a 90 BPM grid, nothing cut on the beat.');
  return { draft, ms: performance.now() - t0, inputs };
}

function currentExisting() {
  const s = get(showTimeline);
  return { sections: s.sections, lookClips: s.lookClips, lines: s.lines, ledClips: s.ledClips, stageClips: s.stageClips, layerTracks: s.layerTracks, whereOrders: s.whereOrders };
}

/** Read the song and work out the draft (nothing is changed yet). */
export async function prepareAutoShow(opts: { style?: ShowStyle; source?: AutoShowSource; shuffle?: number; signal?: AbortSignal } = {}): Promise<AutoShowPrepResult> {
  const t0 = performance.now();
  const { signal } = opts;
  // After each wait: stopped, or the Timeline is no longer the open document.
  const gone = (): AutoShowPrepResult | null => (signal?.aborted ? CANCELLED : get(showTimeline).doc !== 'timeline' ? { ok: false, reason: 'Open the Timeline first.' } : null);
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  const track = scoreSongTrack(s.audioTracks);
  if (!track) return { ok: false, reason: 'Drop a song on the Audio row first.' };
  let tempo = s.tempo;
  let tempoDetected = false;
  let pulse = true;
  if (!tempo) {
    const detected = await detectShowTempo(track.id, { apply: false, signal });
    const stop = gone();
    if (stop) return stop;
    if (detected.ok) {
      tempo = detected.map;
      tempoDetected = true;
    } else if (detected.reason === 'no-pulse') {
      // No steady beat: a grid to cut the sections to all the same.
      tempo = createTempoMap(90, track.startTime);
      tempoDetected = true;
      pulse = false;
    } else {
      return { ok: false, reason: 'The song could not be read.' };
    }
  }
  const features = await songFeaturesFor(track.url, async () => cachedShowAudioDecode(track.url) ?? (await decodeShowAudio(track.url)), signal);
  const stop = gone();
  if (stop) return stop;
  if (!features) return { ok: false, reason: 'The song could not be read.' };
  const origin = track.startTime - track.offset;
  const structure = detectSongStructure(features, tempo, { origin, start: track.startTime, end: track.startTime + track.duration });
  if (!structure.sections.length) return { ok: false, reason: 'The song is too short for a show (it needs a few bars).' };
  const reading = readSongStyle(features, tempo, structure, origin, pulse);
  await loadShaderSources(AUTO_SHOW_CATALOG.filter((c) => c.kind === 'shader').map((c) => c.ref));
  const library = await libraryMembers(signal);
  const after = gone();
  if (after) return after;
  // The song the analysis is of must still be the one on the Song row.
  if (songInputKey(scoreSongTrack(get(showTimeline).audioTracks)) !== songInputKey(track)) return { ok: false, reason: 'The song changed while it was being read. Try again.' };
  const source: AutoShowSource = opts.source ?? 'builtin';
  const seed = (hashString(songKey(track)) + (opts.shuffle ?? 0) * 7919) >>> 0;
  const analysisMs = performance.now() - t0;
  const base = { track, tempo, tempoDetected, pulse, features, structure, reading, style: opts.style ?? reading.style, source, libraryVideos: library.length, seed };
  const { draft, ms, inputs } = draftFor(base, library);
  const prep: AutoShowPrep = { ...base, draft, inputs, timings: { analysisMs, draftMs: ms } };
  // Reopened over a show it laid earlier (the dialog let go of it on close):
  // Shuffle works again, keeping the blocks edited since.
  if (!lastPrep && laidOnTimeline(get(showTimeline), drafts)) lastPrep = prep;
  return { ok: true, prep };
}

/**
 * The same song with another style or content (no new analysis), or with
 * no change, worked out again onto the Timeline and pieces as they are now.
 * Null when the signal stopped it.
 */
export async function redraftAutoShow(prep: AutoShowPrep, change: { style?: ShowStyle; source?: AutoShowSource }, opts: { signal?: AbortSignal } = {}): Promise<AutoShowPrep | null> {
  const library = await libraryMembers(opts.signal);
  if (opts.signal?.aborted) return null;
  const next = { ...prep, ...change };
  const { draft, ms, inputs } = draftFor(next, library);
  return { ...next, draft, inputs, timings: { ...prep.timings, draftMs: ms } };
}

export type { DraftCommitResult } from '../score/scoreRuntime';

/** Why the draft can no longer be laid down as it is (null: it can). A draft already laid counts as changed. */
export function draftStalenessOf(prep: AutoShowPrep): DraftStaleness {
  const now = draftInputsNow();
  if (laidDrafts.has(prep.draft)) return now.doc !== 'timeline' ? 'doc' : 'changed';
  return draftStaleness(prep.inputs, now);
}

/**
 * Lay the draft down: one undo step. Then play from the top of the song.
 * Refused when the Timeline, the pieces or the song changed since the draft
 * was worked out (`why` says which; redraft and show it again).
 */
export function commitAutoShow(prep: AutoShowPrep, opts: { play?: boolean } = {}): DraftCommitResult {
  const d = prep.draft;
  const stale = draftStalenessOf(prep);
  if (stale) return { ok: false, why: stale, reason: staleMessage(stale) };
  if (autoDraftIsEmpty(d) && !prep.tempoDetected) return { ok: false, why: 'empty', reason: 'Nothing to add: the Timeline already has all of it.' };
  const s = get(showTimeline);
  showTimeline.replaceTimelineParts({
    ...(prep.tempoDetected ? { tempo: prep.tempo } : {}),
    ...(d.sections.length ? { sections: [...s.sections, ...d.sections] } : {}),
    ...(d.lookClips.length ? { lookClips: [...s.lookClips, ...d.lookClips] } : {}),
    ...(d.lines.length ? { lines: [...s.lines, ...d.lines] } : {}),
    ...(d.ledClips.length ? { ledClips: [...s.ledClips, ...d.ledClips] } : {}),
    ...(d.stageClips.length ? { stageClips: [...s.stageClips, ...d.stageClips] } : {}),
    ...(d.layerTracks.length ? { layerTracks: withAutoRows(s.layerTracks, d.hostLayerId, d.layerTracks), whereOrders: d.whereOrders } : {}),
  });
  lastPrep = prep;
  rememberLaid(d);
  if (opts.play !== false) playFromTop(prep);
  return { ok: true };
}

/** Play the song from its first section. */
export function playFromTop(prep: Pick<AutoShowPrep, 'structure' | 'track'>): void {
  const start = prep.structure.sections[0]?.start ?? prep.track.startTime;
  showTimeline.seek(start);
  showTimeline.play();
}

/**
 * Another draft in place of the last one: a new seed, the same style and
 * content. The last drafts' untouched items come out first; one undo step.
 */
export async function shuffleAutoShow(change: { style?: ShowStyle; source?: AutoShowSource } = {}, opts: { signal?: AbortSignal } = {}): Promise<AutoShowPrepResult> {
  if (!lastPrep) return { ok: false, reason: 'Build the show first.' };
  if (get(showTimeline).doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  const prev = lastPrep;
  const library = await libraryMembers(opts.signal);
  if (opts.signal?.aborted) return CANCELLED;
  // Read the document after the wait: edits (or an undo) made meanwhile count.
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  if (lastPrep !== prev) return { ok: false, reason: 'Build the show first.' };
  if (songInputKey(scoreSongTrack(s.audioTracks)) !== songInputKey(prev.track)) return { ok: false, reason: 'The song changed: open Auto show again to read it.' };
  // The show was undone: there is nothing to replace, and a new one on its
  // own would be a Build the user did not ask for.
  if (!laidOnTimeline(s, drafts)) return { ok: false, undone: true, reason: 'The show was undone, so Shuffle had nothing to replace.' };
  shuffleCount++;
  const stripped = stripDrafts(s, drafts);
  const tempo = s.tempo ?? prev.tempo;
  const next = { ...prev, ...change, tempo, tempoDetected: false, seed: (hashString(songKey(prev.track)) + shuffleCount * 7919) >>> 0 };
  const { draft, ms, inputs } = draftFor(next, library, stripped, true);
  showTimeline.replaceTimelineParts({
    sections: [...stripped.sections, ...draft.sections],
    lookClips: [...stripped.lookClips, ...draft.lookClips],
    lines: [...stripped.lines, ...draft.lines],
    ledClips: [...stripped.ledClips, ...draft.ledClips],
    stageClips: [...stripped.stageClips, ...draft.stageClips],
    layerTracks: withAutoRows(stripped.layerTracks, draft.hostLayerId, draft.layerTracks),
    whereOrders: draft.layerTracks.length ? draft.whereOrders : stripped.whereOrders,
  });
  const prep: AutoShowPrep = { ...next, draft, inputs, timings: { ...prev.timings, draftMs: ms } };
  lastPrep = prep;
  rememberLaid(draft);
  playFromTop(prep);
  return { ok: true, prep };
}
