/**
 * Setlist: the songs in a Live set, as a DJ sees them.
 *
 *  - A deck set (tracks on the A/B sides of Live's crossfader): clips on a
 *    deck track are songs, played on that deck. When a track names tempos,
 *    a clip with a tempo in its name ("Sunrise 122 BPM") starts a song and
 *    the clips after it ("Sunrise Build", "Sunrise Drop") are its sections;
 *    otherwise every clip is a song of its own.
 *  - A stems set (songs as blocks of scenes): a scene whose name carries a
 *    tempo ("Deep Hours Intro 122 BPM") starts a song; the scenes after it,
 *    up to the next such scene, are its sections.
 *
 * Songs are keyed by name so the order and played marks survive the set
 * being rearranged.
 */

import type { LiveScene, LiveTrack } from './abletonLinks';

export interface SetlistSection { scene: number; label: string }
export interface ClipSection { slot: number; label: string }

export type SetlistSong =
  | { key: string; kind: 'clip'; title: string; bpm: number | null; color: number; track: number; slot: number; side: 'A' | 'B' | null; sections: ClipSection[] }
  | { key: string; kind: 'scenes'; title: string; bpm: number | null; color: number; sections: SetlistSection[] };

const BPM = /(\d{2,3}(?:\.\d+)?)\s*-?\s*bpm/i;

/** Tempo written in a name: "Techno 130 BPM", "Garage-135bpm". */
export function parseBpm(name: string): number | null {
  const match = name.match(BPM);
  return match ? Number(match[1]) : null;
}

/** A name without its tempo, tidied. */
export function stripBpm(name: string): string {
  return name.replace(BPM, '').replace(/\s{2,}/g, ' ').replace(/[\s·-]+$/, '').trim();
}

function commonPrefixWords(names: string[]): string {
  const split = names.map(n => n.split(/\s+/).filter(Boolean));
  const first = split[0] ?? [];
  let count = 0;
  while (count < first.length && split.every(words => words[count]?.toLowerCase() === first[count].toLowerCase())) count++;
  return first.slice(0, count).join(' ');
}

/** Section labels: each name without the words the song's names share;
 *  a section named just for the song ("Sunrise") is where it starts. */
function sectionLabels(names: string[]): { title: string; labels: string[] } {
  if (names.length < 2) return { title: names[0], labels: names };
  const prefix = commonPrefixWords(names);
  return { title: prefix || names[0], labels: names.map(name => name.slice(prefix.length).trim() || 'Start') };
}

/** Same-named songs get "#2", "#3"… so every key is unique. */
function uniqueKeys(songs: SetlistSong[]): SetlistSong[] {
  const seen = new Map<string, number>();
  return songs.map(song => {
    const count = (seen.get(song.key) ?? 0) + 1;
    seen.set(song.key, count);
    return count === 1 ? song : { ...song, key: `${song.key}#${count}` };
  });
}

export function deriveSongs(scenes: LiveScene[], tracks: LiveTrack[]): SetlistSong[] {
  return uniqueKeys(songsIn(scenes, tracks));
}

function songsIn(scenes: LiveScene[], tracks: LiveTrack[]): SetlistSong[] {
  const deckTracks = tracks.map((t, i) => ({ t, i })).filter(x => x.t.side);
  if (deckTracks.length) {
    const songs: SetlistSong[] = [];
    for (const { t, i } of deckTracks) {
      const sectioned = t.slots.some(clip => clip && parseBpm(clip.name) !== null);
      const groups: number[][] = [];
      t.slots.forEach((clip, slot) => {
        if (!clip) return;
        if (!groups.length || !sectioned || parseBpm(clip.name) !== null) groups.push([slot]);
        else groups[groups.length - 1].push(slot);
      });
      for (const group of groups) {
        const first = t.slots[group[0]]!;
        const names = group.map(slot => stripBpm(t.slots[slot]!.name) || `${t.name} ${slot + 1}`);
        const { title, labels } = sectionLabels(names);
        songs.push({
          key: `clip:${t.name}:${first.name || group[0]}`,
          kind: 'clip', title, bpm: parseBpm(first.name), color: first.color, track: i, slot: group[0], side: t.side,
          sections: group.map((slot, n) => ({ slot, label: labels[n] })),
        });
      }
    }
    return songs;
  }

  // Stems set: group scenes into songs.
  const groups: number[][] = [];
  scenes.forEach((scene, index) => {
    const hasClips = tracks.some(t => t.slots[index]);
    if (!hasClips && !scene.name) return;
    if (!groups.length || parseBpm(scene.name) !== null) groups.push([index]);
    else groups[groups.length - 1].push(index);
  });
  return groups.map(group => {
    const names = group.map(index => stripBpm(scenes[index].name) || `Scene ${index + 1}`);
    const { title, labels } = sectionLabels(names);
    return {
      key: `scenes:${title}`,
      kind: 'scenes' as const,
      title,
      bpm: parseBpm(scenes[group[0]].name),
      color: scenes[group[0]].color,
      sections: group.map((scene, i) => ({ scene, label: labels[i] })),
    };
  });
}

/**
 * Songs in set order: the saved order first (by key), then any songs it
 * doesn't mention. A deck set with no saved order alternates decks —
 * A1, B1, A2, B2 — so stepping through it mixes back and forth.
 */
export function orderSongs(songs: SetlistSong[], order: string[]): SetlistSong[] {
  const byKey = new Map(songs.map(s => [s.key, s]));
  const ordered = order.flatMap(key => byKey.get(key) ?? []);
  const rest = songs.filter(s => !order.includes(s.key));
  if (!order.length && rest.every(s => s.kind === 'clip')) {
    const a = rest.filter(s => s.kind === 'clip' && s.side === 'A');
    const b = rest.filter(s => s.kind === 'clip' && s.side !== 'A');
    const alternated: SetlistSong[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) alternated.push(a[i]);
      if (b[i]) alternated.push(b[i]);
    }
    return alternated;
  }
  return [...ordered, ...rest];
}

/** The section of a song playing now, by index, or -1. */
export function playingSection(song: SetlistSong, tracks: LiveTrack[]): number {
  if (song.kind === 'clip') {
    const slot = tracks[song.track]?.playing ?? -1;
    return song.sections.findIndex(sec => sec.slot === slot);
  }
  return song.sections.findIndex(sec => tracks.some(t => t.playing === sec.scene));
}

/** The section of a song waiting to launch, by index, or -1. */
export function queuedSection(song: SetlistSong, tracks: LiveTrack[], scenes: LiveScene[]): number {
  if (song.kind === 'clip') {
    const slot = tracks[song.track]?.fired ?? -1;
    return song.sections.findIndex(sec => sec.slot === slot);
  }
  return song.sections.findIndex(sec => !!scenes[sec.scene]?.queued || tracks.some(t => t.fired === sec.scene));
}

/** The song after `current` in set order that hasn't played yet. */
export function nextSong(ordered: SetlistSong[], current: string | null, played: Set<string>): SetlistSong | null {
  const start = current ? ordered.findIndex(s => s.key === current) + 1 : 0;
  for (let i = 0; i < ordered.length; i++) {
    const song = ordered[(start + i) % ordered.length];
    if (!played.has(song.key) && song.key !== current) return song;
  }
  return null;
}

/** Crossfader position partway through an auto-mix. */
export function mixPosition(from: number, to: number, startBeat: number, beats: number, beat: number): number {
  if (beats <= 0) return to;
  const t = Math.max(0, Math.min(1, (beat - startBeat) / beats));
  // Ease in and out so the blend starts and lands gently.
  const eased = t * t * (3 - 2 * t);
  return from + (to - from) * eased;
}
