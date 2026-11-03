/**
 * A Live set laid out for the Music Studio: a whole show in one set.
 *
 * Songs are blocks of scenes. A scene whose name carries a tempo ("Night
 * Drive Intro 124 BPM") starts a song (Live sets the tempo when it fires)
 * and the scenes after it, up to the next one, are its sections. This is the
 * convention the Ableton connector's setlist already reads.
 *
 * Tracks are lanes by role: drums, bass, chords, lead, pads and FX, vocals.
 * A lane tells the studio what the track is (a drum lane splits into kick,
 * snare and hats for the visuals), so visuals put on it make sense. Setting
 * a set up adds the lanes it lacks; it never renames, moves or deletes
 * anything the performer made.
 */

import type { LiveScene, LiveTrack } from '../ableton/abletonLinks';
import type { SetupPlan } from '../ableton/abletonBridge';
import type { VoiceSourceId } from './visualVoices';

export interface Lane {
  id: string;
  /** The track name the set-up gives it. */
  name: string;
  midi: boolean;
  /** 0xRRGGBB, as Live takes it. */
  color: number;
  /** The studio sound it plays as, for visuals following studio sounds. */
  role: VoiceSourceId;
  /** Names an existing track already answers to. */
  match: RegExp;
}

export const LANES: readonly Lane[] = [
  { id: 'drums', name: 'Drums', midi: true, color: 0xff5a3c, role: 'kick', match: /\b(drum|drums|kit|beat|beats|break|breaks|perc|percussion|808|909|rack)\b/i },
  { id: 'bass', name: 'Bass', midi: true, color: 0x3c8cff, role: 'bass', match: /\b(bass|sub|808 bass)\b/i },
  { id: 'chords', name: 'Chords', midi: true, color: 0xa87cff, role: 'chords', match: /\b(chord|chords|keys|piano|rhodes|organ|stab|stabs)\b/i },
  { id: 'lead', name: 'Lead', midi: true, color: 0xffc83c, role: 'lead', match: /\b(lead|melody|arp|synth|guitar|gtr|hook)\b/i },
  { id: 'pads', name: 'Pads & FX', midi: true, color: 0x3cd6a0, role: 'pad', match: /\b(pad|pads|fx|sfx|texture|ambient|atmos|drone|riser|strings)\b/i },
  { id: 'vocals', name: 'Vocals', midi: false, color: 0xff7cc0, role: 'lead', match: /\b(vox|vocal|vocals|voice|acapella|sing)\b/i },
];

/** The track that already plays each lane (the first whose name answers to it), or -1. */
export function laneTracks(tracks: readonly Pick<LiveTrack, 'name'>[]): Record<string, number> {
  const taken = new Set<number>();
  const out: Record<string, number> = {};
  for (const lane of LANES) {
    const index = tracks.findIndex((t, i) => !taken.has(i) && lane.match.test(t.name));
    out[lane.id] = index;
    if (index >= 0) taken.add(index);
  }
  return out;
}

/** What setting the set up would add: the lanes it has no track for. */
export function missingLanes(tracks: readonly Pick<LiveTrack, 'name'>[]): Lane[] {
  const found = laneTracks(tracks);
  return LANES.filter((lane) => found[lane.id] < 0);
}

/** Add the chosen lanes as tracks at the end of the set. */
export function lanePlan(lanes: readonly Lane[]): SetupPlan {
  return { tracks: lanes.map((l) => ({ name: l.name, midi: l.midi, color: l.color })) };
}

export const SECTION_NAMES = ['Intro', 'Verse', 'Build', 'Drop', 'Break', 'Outro'] as const;

/** A song colour per song, so blocks stand apart in Live. */
const SONG_COLORS = [0xff5a3c, 0x3c8cff, 0xffc83c, 0x3cd6a0, 0xa87cff, 0xff7cc0, 0x9ad04a, 0xff9a3c];

/**
 * A new song at the end of the set: its first section carries the tempo, so
 * Live sets it when the song starts; the rest are named for the song so the
 * setlist reads them as its sections.
 */
export function songPlan(title: string, bpm: number, sections: readonly string[], songIndex = 0): SetupPlan {
  const name = title.trim().replace(/\s*\d{2,3}(?:\.\d+)?\s*-?\s*bpm/i, '').slice(0, 80) || 'New song';
  const tempo = Math.round(Math.max(40, Math.min(300, Number.isFinite(bpm) ? bpm : 120)) * 100) / 100;
  const list = sections.map((s) => s.trim()).filter(Boolean);
  const parts = list.length ? list : ['Intro'];
  const color = SONG_COLORS[songIndex % SONG_COLORS.length];
  return {
    scenes: parts.map((section, i) => ({ name: i === 0 ? `${name} ${section} ${tempo} BPM` : `${name} ${section}`, color })),
  };
}

/** The index of the song a scene belongs to, for "where are we" and next/previous. */
export function songOfScene(songs: readonly { sections: readonly { scene: number }[] }[], scene: number): number {
  return songs.findIndex((song) => song.sections.some((s) => s.scene === scene));
}

/** True when a set reads as songs (at least one scene names a tempo). */
export function hasSongs(scenes: readonly Pick<LiveScene, 'name'>[]): boolean {
  return scenes.some((s) => /\d{2,3}(?:\.\d+)?\s*-?\s*bpm/i.test(s.name));
}
