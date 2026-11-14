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
import { canonicalJson, draftInputsNow, draftStaleness, scoreSongTrack, songInputKey, type DraftInputs, type DraftStaleness } from './draftInputs';

export { scoreSongTrack };

export interface ScorePrep {
  track: ShowAudioTrack;
  tempo: ShowTempoMap;
  /** The tempo was detected now (it goes in with the draft). */
  tempoDetected: boolean;
  structure: SongStructure;
  draft: ScoreDraft;
  seed: number;
  /** What the draft was worked out from (it is laid down only onto the same). */
  inputs: DraftInputs;
}

export type ScorePrepResult =
  | { ok: true; prep: ScorePrep }
  /** `cancelled`: the signal stopped it. `undone`: Shuffle found none of the draft on the Timeline. */
  | { ok: false; reason: string; cancelled?: boolean; undone?: boolean };

/** Laying a draft down: done, or refused and why. */
export type DraftCommitResult = { ok: true } | { ok: false; why: Exclude<DraftStaleness, null> | 'empty'; reason: string };

const CANCELLED = { ok: false, reason: 'Stopped.', cancelled: true } as const;

/** What to tell the user when a draft can no longer be laid down. */
export function staleMessage(why: Exclude<DraftStaleness, null>): string {
  if (why === 'doc') return 'Open the Timeline first.';
  if (why === 'song') return 'The song changed since it was read. Read it again.';
  return 'The pieces or the Timeline changed since this was worked out, so it was worked out again. Check it, then build.';
}

type LaidParts = { sections?: readonly { id: string }[]; lookClips?: readonly { id: string }[]; lines?: readonly { id: string }[]; ledClips?: readonly { id: string }[]; stageClips?: readonly { id: string }[]; layerTracks?: ReadonlyArray<{ clips: readonly { id: string }[] }> };

/**
 * Some of what these drafts laid down is on the Timeline (edited or not).
 * False after an undo took it all back; true when they laid nothing but a
 * tempo (there is nothing to tell).
 */
export function laidOnTimeline(s: LaidParts, laid: readonly LaidParts[]): boolean {
  const have = new Set<string>();
  const add = (list?: readonly { id: string }[]) => { for (const x of list ?? []) have.add(x.id); };
  add(s.sections); add(s.lookClips); add(s.lines); add(s.ledClips); add(s.stageClips);
  for (const t of s.layerTracks ?? []) add(t.clips);
  let any = false;
  const hit = (list?: readonly { id: string }[]) => (list ?? []).some((x) => { any = true; return have.has(x.id); });
  for (const d of laid) {
    if (hit(d.sections) || hit(d.lookClips) || hit(d.lines) || hit(d.ledClips) || hit(d.stageClips)) return true;
    for (const t of d.layerTracks ?? []) if (hit(t.clips)) return true;
  }
  return !any;
}

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
/** The last drafts laid down since the last Score of a new document: an
 *  undo can bring an earlier one back, and Shuffle takes that out too. */
let drafts: ScoreDraft[] = [];
export const MAX_SCORE_DRAFTS = 8;
/** Drafts already laid down: laying one again would put it on top of itself. */
const laidDrafts = new WeakSet<ScoreDraft>();

function remember(draft: ScoreDraft): void {
  laidDrafts.add(draft);
  drafts.push(draft);
  if (drafts.length > MAX_SCORE_DRAFTS) drafts = drafts.slice(-MAX_SCORE_DRAFTS);
}

/** Test seam: how many laid drafts Shuffle remembers. */
export function _scoreDraftCount(): number {
  return drafts.length;
}

// A new or reopened document: Shuffle starts over.
onShowTimelineReset(() => forgetLastScore());

function songKey(track: ShowAudioTrack): string {
  return `${track.name}|${Math.round((track.sourceDuration || track.duration) * 10)}|${track.startTime}`;
}

/** Work out the draft (nothing is changed yet). */
export async function prepareScore(opts: { shuffle?: number; signal?: AbortSignal } = {}): Promise<ScorePrepResult> {
  const { signal } = opts;
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  const track = scoreSongTrack(s.audioTracks);
  if (!track) return { ok: false, reason: 'Put a song on the Song row first (drop an audio file on it).' };
  let tempo = s.tempo;
  let tempoDetected = false;
  if (!tempo) {
    const detected = await detectShowTempo(track.id, { apply: false, signal });
    if (signal?.aborted) return CANCELLED;
    if (!detected.ok) return { ok: false, reason: detected.reason === 'no-pulse' ? 'No steady beat found in the song: set the tempo first (Tempo in the transport).' : 'The song could not be read.' };
    tempo = detected.map;
    tempoDetected = true;
  }
  const features: SongFeatures | null = await songFeaturesFor(track.url, async () => cachedShowAudioDecode(track.url) ?? (await decodeShowAudio(track.url)), signal);
  if (signal?.aborted) return CANCELLED;
  if (!features) return { ok: false, reason: 'The song could not be read.' };
  const place = { origin: track.startTime - track.offset, start: track.startTime, end: track.startTime + track.duration };
  const structure = detectSongStructure(features, tempo, place);
  if (!structure.sections.length) return { ok: false, reason: 'The song is too short to score (it needs a few bars).' };
  const seed = (hashString(songKey(track)) + (opts.shuffle ?? 0) * 7919) >>> 0;
  const cur = get(showTimeline);
  if (cur.doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  if (songInputKey(scoreSongTrack(cur.audioTracks)) !== songInputKey(track)) return { ok: false, reason: 'The song changed while it was being read. Try again.' };
  const inputs = draftInputsNow();
  const draft = draftScore(structure, tempo, stageNow(), {
    sections: cur.sections, lookClips: cur.lookClips, lines: cur.lines, ledClips: cur.ledClips, stageClips: cur.stageClips,
  }, seed, { next: (prefix) => `${prefix}-${generateUUID()}` });
  if (tempoDetected) draft.adds.unshift(`Tempo ${Math.round(tempo.segments[0].bpm * 10) / 10} BPM, from the song`);
  return { ok: true, prep: { track, tempo, tempoDetected, structure, draft, seed, inputs } };
}

/**
 * Lay the draft down: one undo step. Refused when the Timeline, the pieces
 * or the song changed since the draft was worked out (`why` says which).
 */
export function commitScore(prep: ScorePrep): DraftCommitResult {
  const d = prep.draft;
  const now = draftInputsNow();
  const stale = laidDrafts.has(d) ? (now.doc !== 'timeline' ? 'doc' : 'changed') : draftStaleness(prep.inputs, now);
  if (stale) return { ok: false, why: stale, reason: staleMessage(stale) };
  if (draftIsEmpty(d) && !prep.tempoDetected) return { ok: false, why: 'empty', reason: 'Nothing to add: the Timeline already has all of it.' };
  const s = get(showTimeline);
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
  return { ok: true };
}

/**
 * Another draft in place of the last one (a new seed). The last draft's
 * items that were not edited since come out; one undo step.
 */
export async function shuffleScore(opts: { signal?: AbortSignal } = {}): Promise<ScorePrepResult> {
  if (!lastDraft) return { ok: false, reason: 'Score the song first.' };
  if (get(showTimeline).doc !== 'timeline') return { ok: false, reason: 'Open the Timeline first.' };
  const first = get(showTimeline);
  const track = scoreSongTrack(first.audioTracks);
  if (!track || !first.tempo) return { ok: false, reason: 'Score the song first.' };
  const features = await songFeaturesFor(track.url, async () => cachedShowAudioDecode(track.url) ?? (await decodeShowAudio(track.url)), opts.signal);
  if (opts.signal?.aborted) return CANCELLED;
  if (!features) return { ok: false, reason: 'The song could not be read.' };
  // Read the document after the song's analysis: edits (or an undo, or the
  // other tab) made meanwhile are what the new draft goes into.
  const s = get(showTimeline);
  if (s.doc !== 'timeline' || !s.tempo) return { ok: false, reason: 'Open the Timeline first.' };
  if (!lastDraft) return { ok: false, reason: 'Score the song first.' };
  // Undone: nothing to replace, and a new draft on its own would be a Score the user did not ask for.
  if (!laidOnTimeline(s, drafts)) return { ok: false, undone: true, reason: 'The show was undone, so Shuffle had nothing to replace.' };
  shuffleCount++;
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
  return { ok: true, prep: { track, tempo: s.tempo, tempoDetected: false, structure, draft, seed, inputs: draftInputsNow() } };
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
