/**
 * Setlist: the songs in a Live set, as a DJ sees them.
 *
 *  - A deck set (tracks on the A/B sides of Live's crossfader): every clip
 *    on a deck track is a song, played on that deck.
 *  - A stems set (songs as blocks of scenes): a scene whose name carries a
 *    tempo ("Deep Hours Intro 122 BPM") starts a song; the scenes after it,
 *    up to the next such scene, are its sections.
 *
 * Songs are keyed by name so the order and played marks survive the set
 * being rearranged.
 */

import type { LiveScene, LiveTrack } from './abletonLinks';

export interface SetlistSection { scene: number; label: string }

export type SetlistSong =
  | { key: string; kind: 'clip'; title: string; bpm: number | null; color: number; track: number; slot: number; side: 'A' | 'B' | null }
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

export function deriveSongs(scenes: LiveScene[], tracks: LiveTrack[]): SetlistSong[] {
  const deckTracks = tracks.map((t, i) => ({ t, i })).filter(x => x.t.side);
  if (deckTracks.length) {
    const songs: SetlistSong[] = [];
    for (const { t, i } of deckTracks) {
      t.slots.forEach((clip, slot) => {
        if (!clip) return;
        const title = stripBpm(clip.name) || `${t.name} ${slot + 1}`;
        songs.push({
          key: `clip:${t.name}:${clip.name || slot}`,
          kind: 'clip', title, bpm: parseBpm(clip.name), color: clip.color, track: i, slot, side: t.side,
        });
      });
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
    const prefix = group.length > 1 ? commonPrefixWords(names) : '';
    const title = prefix || names[0];
    return {
      key: `scenes:${title}`,
      kind: 'scenes' as const,
      title,
      bpm: parseBpm(scenes[group[0]].name),
      color: scenes[group[0]].color,
      sections: group.map((scene, i) => ({ scene, label: names[i].slice(prefix.length).trim() || names[i] })),
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
