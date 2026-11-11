/**
 * "Score this song" on the Timeline: finds the song on the sound rows, reads
 * its offline analysis (the same cached features the lines follow), finds
 * its structure and lays down a draft (scoreDraft.ts) as one undo step.
 *
 * Shuffle replaces the last draft with another one (a new seed, same rules):
 * the draft's items the artist has not touched since are taken out first,
 * so an edited block stays and its row is then left alone.
 */
import { get } from 'svelte/store';
import type { ShowAudioTrack, ShowTempoMap } from '../../types';
import { onShowTimelineReset, showTimeline } from '../../stores/showTimeline';
import { project } from '../../stores/layers';
import { cachedShowAudioDecode, decodeShowAudio } from '../../audio/showAudio';
import { songFeaturesFor, type SongFeatures } from '../lines/songFeatures';
import { detectShowTempo } from '../../show/tempoDetect';
import { detectSongStructure, type SongStructure } from './songStructure';
import { draftIsEmpty, draftScore, hashString, type ScoreDraft, type ScoreStage } from './scoreDraft';
import { ledSpotId } from '../where/spatialOrder';
import { generateUUID } from '../../utils/uuid';

/** The song to score: the first block on the Song row (the first sound row), else the longest audio block. */
export function scoreSongTrack(tracks: readonly ShowAudioTrack[]): ShowAudioTrack | null {
  const usable = tracks.filter((t) => t.url && t.duration > 0);
  if (!usable.length) return null;
  const songRow = usable.filter((t) => t.lane === 0).sort((a, b) => b.duration - a.duration);
  if (songRow.length) return songRow[0];
  return usable.reduce((a, b) => (b.duration > a.duration ? b : a));
}

export interface ScorePrep {
  track: ShowAudioTrack;
  tempo: ShowTempoMap;
  /** The tempo was detected now (it goes in with the draft). */
  tempoDetected: boolean;
  structure: SongStructure;
  draft: ScoreDraft;
  seed: number;
}

export type ScorePrepResult = { ok: true; prep: ScorePrep } | { ok: false; reason: string };

function stageNow(): ScoreStage {
  const s = get(showTimeline);
  const p = get(project) as { wledControllers?: Array<{ id: string; name?: string }>; mappingComposition?: { effects?: Array<{ id: string; type: string; enabled?: boolean }> } };
  const pieces = s.layerTracks.filter((t) => !t.subRow).map((t) => ({ id: t.layerId, name: t.layerName }));
  const controllers = p.wledControllers ?? [];
  const fx = (p.mappingComposition?.effects ?? []).filter((e) => e.enabled !== false);
  return {
    pieces,
    ledRows: controllers.map((c) => ledSpotId(c.id)),
    stageFx: fx.map((e) => ({ id: e.id, name: e.type.charAt(0).toUpperCase() + e.type.slice(1) })),
    ledControllers: controllers.map((c) => ({ id: c.id, name: c.name || 'WLED' })),
  };
}

let shuffleCount = 0;
let lastDraft: { draft: ScoreDraft; songKey: string } | null = null;
/** Every draft laid down since the last Score of a new document: an undo
 *  can bring an earlier one back, and Shuffle takes that out too. */
let drafts: ScoreDraft[] = [];
const MAX_DRAFTS = 32;

/** JSON with every object's keys sorted. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

function remember(draft: ScoreDraft): void {
  drafts.push(draft);
  if (drafts.length > MAX_DRAFTS) drafts = drafts.slice(-MAX_DRAFTS);
}

// A new or reopened document: Shuffle starts over.
onShowTimelineReset(() => forgetLastScore());

function songKey(track: ShowAudioTrack): string {
  return `${track.name}|${Math.round((track.sourceDuration || track.duration) * 10)}|${track.startTime}`;
}

/** Work out the draft (nothing is changed yet). */
export async function prepareScore(opts: { shuffle?: number } = {}): Promise<ScorePrepResult> {
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  const track = scoreSongTrack(s.audioTracks);
  if (!track) return { ok: false, reason: 'Put a song on the Song row first (drop an audio file on it).' };
  let tempo = s.tempo;
  let tempoDetected = false;
  if (!tempo) {
    const detected = await detectShowTempo(track.id, { apply: false });
    if (!detected.ok) return { ok: false, reason: detected.reason === 'no-pulse' ? 'No steady beat found in the song: set the tempo first (Tempo in the transport).' : 'The song could not be read.' };
    tempo = detected.map;
    tempoDetected = true;
  }
  const features: SongFeatures | null = await songFeaturesFor(track.url, async () => cachedShowAudioDecode(track.url) ?? (await decodeShowAudio(track.url)));
  if (!features) return { ok: false, reason: 'The song could not be read.' };
  const place = { origin: track.startTime - track.offset, start: track.startTime, end: track.startTime + track.duration };
  const structure = detectSongStructure(features, tempo, place);
  if (!structure.sections.length) return { ok: false, reason: 'The song is too short to score (it needs a few bars).' };
  const seed = (hashString(songKey(track)) + (opts.shuffle ?? 0) * 7919) >>> 0;
  const cur = get(showTimeline);
  const draft = draftScore(structure, tempo, stageNow(), {
    sections: cur.sections, lookClips: cur.lookClips, lines: cur.lines, ledClips: cur.ledClips, stageClips: cur.stageClips,
  }, seed, { next: (prefix) => `${prefix}-${generateUUID()}` });
  if (tempoDetected) draft.adds.unshift(`Tempo ${Math.round(tempo.segments[0].bpm * 10) / 10} BPM, from the song`);
  return { ok: true, prep: { track, tempo, tempoDetected, structure, draft, seed } };
}

/** Lay the draft down: one undo step. */
export function commitScore(prep: ScorePrep): boolean {
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return false;
  const d = prep.draft;
  if (draftIsEmpty(d) && !prep.tempoDetected) return false;
  showTimeline.replaceTimelineParts({
    ...(prep.tempoDetected ? { tempo: prep.tempo } : {}),
    ...(d.sections.length ? { sections: [...s.sections, ...d.sections] } : {}),
    ...(d.lookClips.length ? { lookClips: [...s.lookClips, ...d.lookClips] } : {}),
    ...(d.lines.length ? { lines: [...s.lines, ...d.lines] } : {}),
    ...(d.ledClips.length ? { ledClips: [...s.ledClips, ...d.ledClips] } : {}),
    ...(d.stageClips.length ? { stageClips: [...s.stageClips, ...d.stageClips] } : {}),
  });
  lastDraft = { draft: d, songKey: songKey(prep.track) };
  remember(d);
  return true;
}

/**
 * Another draft in place of the last one (a new seed). The last draft's
 * items that were not edited since come out; one undo step.
 */
export async function shuffleScore(): Promise<ScorePrepResult> {
  if (!lastDraft) return { ok: false, reason: 'Score the song first.' };
  if (get(showTimeline).doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  shuffleCount++;
  const first = get(showTimeline);
  const track = scoreSongTrack(first.audioTracks);
  if (!track || !first.tempo) return { ok: false, reason: 'Score the song first.' };
  const features = await songFeaturesFor(track.url, async () => cachedShowAudioDecode(track.url) ?? (await decodeShowAudio(track.url)));
  if (!features) return { ok: false, reason: 'The song could not be read.' };
  // Read the document after the song's analysis: edits (or an undo, or the
  // other tab) made meanwhile are what the new draft goes into.
  const s = get(showTimeline);
  if (s.doc !== 'timeline' || !s.tempo) return { ok: false, reason: 'Open the Timeline first.' };
  // Compared without key order: a restore (undo) or a reopened file writes
  // the same item with its keys in another order.
  const same = <T extends { id: string }>(list: readonly T[], pick: (d: ScoreDraft) => readonly T[]) => {
    const byId = new Map<string, Set<string>>();
    for (const d of drafts) {
      for (const x of pick(d)) {
        const seen = byId.get(x.id) ?? new Set<string>();
        seen.add(canonicalJson(x));
        byId.set(x.id, seen);
      }
    }
    return list.filter((x) => !(byId.get(x.id)?.has(canonicalJson(x)) ?? false));
  };
  // Take every untouched drafted item out (quietly: the new draft is the one undo step).
  const stripped = {
    sections: same(s.sections, (d) => d.sections),
    lookClips: same(s.lookClips, (d) => d.lookClips),
    lines: same(s.lines, (d) => d.lines),
    ledClips: same(s.ledClips, (d) => d.ledClips),
    stageClips: same(s.stageClips, (d) => d.stageClips),
  };
  const structure = detectSongStructure(features, s.tempo, { origin: track.startTime - track.offset, start: track.startTime, end: track.startTime + track.duration });
  const seed = (hashString(songKey(track)) + shuffleCount * 7919) >>> 0;
  const draft = draftScore(structure, s.tempo, stageNow(), stripped, seed, { next: (prefix) => `${prefix}-${generateUUID()}` });
  showTimeline.replaceTimelineParts({
    sections: [...stripped.sections, ...draft.sections],
    lookClips: [...stripped.lookClips, ...draft.lookClips],
    lines: [...stripped.lines, ...draft.lines],
    ledClips: [...stripped.ledClips, ...draft.ledClips],
    stageClips: [...stripped.stageClips, ...draft.stageClips],
  });
  lastDraft = { draft, songKey: songKey(track) };
  remember(draft);
  return { ok: true, prep: { track, tempo: s.tempo, tempoDetected: false, structure, draft, seed } };
}

/** A new song or document: Shuffle starts over. */
export function forgetLastScore(): void {
  lastDraft = null;
  drafts = [];
  shuffleCount = 0;
}

export function hasLastScore(): boolean {
  return lastDraft !== null;
}
