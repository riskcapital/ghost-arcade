/**
 * What a Score or Auto show draft was worked out from, as a few numbers: the
 * document, the song, the pieces (and LED controllers, Screen FX, output
 * shape) and the Timeline's parts it fills around. A draft is laid down only
 * when these still match; else the Timeline or the pieces changed since, and
 * the draft would land on something it never saw.
 *
 * Read once when a draft is made and once when it is laid down, never per
 * frame. Keys are sorted before hashing, so an undo that brings the same
 * items back with their keys in another order still matches.
 */
import { get } from 'svelte/store';
import type { Layer, ShowAudioTrack } from '../../types';
import { showTimeline, type ShowDocKind } from '../../stores/showTimeline';
import { project } from '../../stores/layers';
import { getTransformAspect } from '../../keyframes/layerParamKeys';
import { isLookTarget } from '../../looks/edgeLooks';
import { hashString } from './scoreDraft';

export interface DraftInputs {
  doc: ShowDocKind;
  /** The song's file and place (null: no song). */
  song: string | null;
  /** The pieces, LED controllers, Screen FX and output shape. */
  stage: number;
  /** The Timeline's parts the draft fills around (and its tempo). */
  timeline: number;
}

/** Why a draft can no longer be laid down as it is (null: it still can). */
export type DraftStaleness = 'doc' | 'song' | 'changed' | null;

/** JSON with every object's keys sorted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

const partHash = (part: unknown): number => hashString(canonicalJson(part ?? null));

/** The song a draft follows, as a key (its file and where it sits). */
export function songInputKey(track: Pick<ShowAudioTrack, 'url' | 'startTime' | 'offset' | 'duration'> | null): string | null {
  return track ? `${track.url}|${track.startTime}|${track.offset}|${track.duration}` : null;
}

/** The song to score: the first block on the Song row (the first sound row), else the longest audio block. */
export function scoreSongTrack(tracks: readonly ShowAudioTrack[]): ShowAudioTrack | null {
  const usable = tracks.filter((t) => t.url && t.duration > 0);
  if (!usable.length) return null;
  const songRow = usable.filter((t) => t.lane === 0).sort((a, b) => b.duration - a.duration);
  if (songRow.length) return songRow[0];
  return usable.reduce((a, b) => (b.duration > a.duration ? b : a));
}

const r4 = (n: number) => Math.round((Number(n) || 0) * 1e4);

/** The inputs as they are now (the song: the one Score and Auto show follow). */
export function draftInputsNow(): DraftInputs {
  const s = get(showTimeline);
  const song = scoreSongTrack(s.audioTracks);
  const p = get(project) as { layers?: Layer[]; wledControllers?: Array<{ id: string; name?: string }>; mappingComposition?: { effects?: Array<{ id: string; type: string; enabled?: boolean }> } };
  // Only what the drafts read of a layer: which pieces there are, their names and their places.
  const pieces = (p.layers ?? []).filter(isLookTarget).map((l) => {
    const c = l.corners!;
    return `${l.id}:${l.name ?? ''}:${l.type}:${[c.topLeft, c.topRight, c.bottomRight, c.bottomLeft].map((q) => `${r4(q?.x)},${r4(q?.y)}`).join(';')}`;
  });
  const controllers = (p.wledControllers ?? []).map((c) => `${c.id}:${c.name ?? ''}`);
  const fx = (p.mappingComposition?.effects ?? []).filter((e) => e.enabled !== false).map((e) => `${e.id}:${e.type}`);
  const stage = hashString(`${pieces.join('|')}#${controllers.join('|')}#${fx.join('|')}#${r4(getTransformAspect())}`);
  const timeline = hashString([
    s.sections, s.lookClips, s.lines, s.ledClips, s.stageClips, s.layerTracks, s.whereOrders,
  ].map(partHash).join(',') + `|${partHash(s.tempo)}`);
  return { doc: s.doc, song: songInputKey(song), stage, timeline };
}

/** What changed between a draft's inputs and now. */
export function draftStaleness(then: DraftInputs, now: DraftInputs): DraftStaleness {
  if (now.doc !== 'timeline' || then.doc !== now.doc) return 'doc';
  if (then.song !== now.song) return 'song';
  if (then.stage !== now.stage || then.timeline !== now.timeline) return 'changed';
  return null;
}
