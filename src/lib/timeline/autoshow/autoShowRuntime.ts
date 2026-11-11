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
import { scoreSongTrack } from '../score/scoreRuntime';
import { ledSpotId } from '../where/spatialOrder';
import { generateUUID } from '../../utils/uuid';
import { readSongStyle, type ShowStyle, type StyleReading } from './songStyle';
import { autoDraftIsEmpty, draftAutoShow, stripDrafts, withAutoRows, type AutoShowDraft, type AutoShowStage } from './autoShowDraft';
import { AUTO_SHOW_CATALOG } from './catalogData';
import type { CastMember } from './catalog';
import { libraryCast } from './libraryVideos';

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
}

export type AutoShowPrepResult = { ok: true; prep: AutoShowPrep } | { ok: false; reason: string };

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
async function libraryMembers(): Promise<CastMember[]> {
  const items = get(mediaLibrary).filter((i) => i.type === 'video' && !i.broken && i.src);
  const key = items.map((i) => i.id).join('|');
  if (libraryMemo?.key === key) return libraryMemo.cast;
  const cast = await libraryCast(items);
  libraryMemo = { key, cast };
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
/** Every draft laid down since the last new document (Shuffle takes them out). */
let drafts: AutoShowDraft[] = [];
const MAX_DRAFTS = 32;

onShowTimelineReset(() => forgetLastAutoShow());

export function forgetLastAutoShow(): void {
  lastPrep = null;
  drafts = [];
  shuffleCount = 0;
}

export function hasLastAutoShow(): boolean {
  return lastPrep !== null;
}

function draftFor(prep: Omit<AutoShowPrep, 'draft' | 'timings'> & { timings?: AutoShowPrep['timings'] }, library: CastMember[], existing = currentExisting()): { draft: AutoShowDraft; ms: number } {
  const t0 = performance.now();
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
  });
  if (prep.tempoDetected) draft.adds.unshift(`Tempo ${Math.round(prep.tempo.segments[0].bpm * 10) / 10} BPM, from the song`);
  if (!prep.pulse) draft.skips.unshift('No steady beat in the song: cut to a 90 BPM grid, nothing cut on the beat.');
  return { draft, ms: performance.now() - t0 };
}

function currentExisting() {
  const s = get(showTimeline);
  return { sections: s.sections, lookClips: s.lookClips, lines: s.lines, ledClips: s.ledClips, stageClips: s.stageClips, layerTracks: s.layerTracks, whereOrders: s.whereOrders };
}

/** Read the song and work out the draft (nothing is changed yet). */
export async function prepareAutoShow(opts: { style?: ShowStyle; source?: AutoShowSource; shuffle?: number } = {}): Promise<AutoShowPrepResult> {
  const t0 = performance.now();
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  const track = scoreSongTrack(s.audioTracks);
  if (!track) return { ok: false, reason: 'Drop a song on the Song row first.' };
  let tempo = s.tempo;
  let tempoDetected = false;
  let pulse = true;
  if (!tempo) {
    const detected = await detectShowTempo(track.id, { apply: false });
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
  const features = await songFeaturesFor(track.url, async () => cachedShowAudioDecode(track.url) ?? (await decodeShowAudio(track.url)));
  if (!features) return { ok: false, reason: 'The song could not be read.' };
  const origin = track.startTime - track.offset;
  const structure = detectSongStructure(features, tempo, { origin, start: track.startTime, end: track.startTime + track.duration });
  if (!structure.sections.length) return { ok: false, reason: 'The song is too short for a show (it needs a few bars).' };
  const reading = readSongStyle(features, tempo, structure, origin, pulse);
  await loadShaderSources(AUTO_SHOW_CATALOG.filter((c) => c.kind === 'shader').map((c) => c.ref));
  const library = await libraryMembers();
  const source: AutoShowSource = opts.source ?? 'builtin';
  const seed = (hashString(songKey(track)) + (opts.shuffle ?? 0) * 7919) >>> 0;
  const analysisMs = performance.now() - t0;
  const base = { track, tempo, tempoDetected, pulse, features, structure, reading, style: opts.style ?? reading.style, source, libraryVideos: library.length, seed };
  const { draft, ms } = draftFor(base, library);
  return { ok: true, prep: { ...base, draft, timings: { analysisMs, draftMs: ms } } };
}

/** The same song with another style or content (no new analysis). */
export async function redraftAutoShow(prep: AutoShowPrep, change: { style?: ShowStyle; source?: AutoShowSource }): Promise<AutoShowPrep> {
  const library = await libraryMembers();
  const next = { ...prep, ...change };
  const { draft, ms } = draftFor(next, library);
  return { ...next, draft, timings: { ...prep.timings, draftMs: ms } };
}

/** Lay the draft down: one undo step. Then play from the top of the song. */
export function commitAutoShow(prep: AutoShowPrep, opts: { play?: boolean } = {}): boolean {
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return false;
  const d = prep.draft;
  if (autoDraftIsEmpty(d) && !prep.tempoDetected) return false;
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
  drafts.push(d);
  if (drafts.length > MAX_DRAFTS) drafts = drafts.slice(-MAX_DRAFTS);
  if (opts.play !== false) playFromTop(prep);
  return true;
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
export async function shuffleAutoShow(change: { style?: ShowStyle; source?: AutoShowSource } = {}): Promise<AutoShowPrepResult> {
  if (!lastPrep) return { ok: false, reason: 'Build the show first.' };
  if (get(showTimeline).doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  shuffleCount++;
  const library = await libraryMembers();
  const s = get(showTimeline);
  const stripped = stripDrafts(s, drafts);
  const prev = lastPrep;
  const tempo = s.tempo ?? prev.tempo;
  const next = { ...prev, ...change, tempo, tempoDetected: false, seed: (hashString(songKey(prev.track)) + shuffleCount * 7919) >>> 0 };
  const { draft, ms } = draftFor(next, library, stripped);
  showTimeline.replaceTimelineParts({
    sections: [...stripped.sections, ...draft.sections],
    lookClips: [...stripped.lookClips, ...draft.lookClips],
    lines: [...stripped.lines, ...draft.lines],
    ledClips: [...stripped.ledClips, ...draft.ledClips],
    stageClips: [...stripped.stageClips, ...draft.stageClips],
    layerTracks: withAutoRows(stripped.layerTracks, draft.hostLayerId, draft.layerTracks),
    whereOrders: draft.layerTracks.length ? draft.whereOrders : stripped.whereOrders,
  });
  const prep: AutoShowPrep = { ...next, draft, timings: { ...prev.timings, draftMs: ms } };
  lastPrep = prep;
  drafts.push(draft);
  if (drafts.length > MAX_DRAFTS) drafts = drafts.slice(-MAX_DRAFTS);
  playFromTop(prep);
  return { ok: true, prep };
}
