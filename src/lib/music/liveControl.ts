/**
 * The studio as a controller for Ableton Live.
 *
 * With Live in control, the studio's own loops and sequences stop and the
 * session grid shows Live's clips and scenes: launching one fires it in Live,
 * and Live plays the backing while the studio's instruments play on top. Each
 * Live track drives the visuals that follow it (see liveFeed.ts), and can also
 * stand in for one of the studio's sounds (the kick, the bass, the chords...). A MIDI track's clip notes arrive
 * with their pitch on the song clock; an audio track's level is listened to
 * for hits, the way the live input is.
 *
 * Tracks are matched by name, so the mapping survives tracks being added or
 * moved in the Live set.
 */

import { liveSource, VOICE_SOURCES, type LiveSourceId, type VoiceSourceId } from './visualVoices';

/** Live track name -> the sound it feeds the visuals as. */
export type LiveRoles = Record<string, VoiceSourceId>;

export function normalizeLiveRoles(raw: unknown): LiveRoles {
  if (!raw || typeof raw !== 'object') return {};
  const out: LiveRoles = {};
  for (const [name, role] of Object.entries(raw as Record<string, unknown>)) {
    if (name && VOICE_SOURCES.some((v) => v.id === role)) out[name] = role as VoiceSourceId;
  }
  return out;
}

/** A first guess at what a track is, from its name. */
export function guessRole(name: string): VoiceSourceId | null {
  const n = name.toLowerCase();
  const rules: [RegExp, VoiceSourceId][] = [
    [/\b(kick|kik|bd|bass ?drum)\b/, 'kick'],
    [/\b(snare|sn|clap|rim)\b/, 'snare'],
    [/\b(hat|hats|hh|hihat|hi-hat|shaker|ride)\b/, 'hats'],
    [/\b(tom|toms|crash|cymbal|perc|percussion)\b/, 'perc'],
    [/\b(drum|drums|beat|break|kit)\b/, 'kick'],
    [/\b(sub|bass|808)\b/, 'bass'],
    [/\b(lead|melody|guitar|gtr|vox|vocal|voice|sax|horn)\b/, 'lead'],
    [/\b(chord|chords|keys|piano|rhodes|organ|stab|stabs)\b/, 'chords'],
    [/\b(pad|pads|drone|texture|ambient|atmos|strings)\b/, 'pad'],
    [/\b(fx|sfx|riser|siren|noise|impact)\b/, 'fx'],
  ];
  for (const [re, role] of rules) if (re.test(n)) return role;
  return null;
}

/** Track indices in the set with a role, by their names. Duplicate names all count. */
/**
 * A MIDI track that plays a drum kit (by its name, or by the drum part it
 * stands in for): its notes split into kick, snare, hats and percussion.
 */
export function isDrumTrack(track: { name: string; midi: boolean }, role?: VoiceSourceId | null): boolean {
  if (!track.midi) return false;
  if (role && ['kick', 'snare', 'hats', 'perc'].includes(role)) return true;
  return /\b(drum|drums|kit|beat|beats|break|breaks|perc|percussion|808|909|707|606|rack)\b/i.test(track.name);
}

/**
 * A name per Live track that visuals follow it by: its own name, numbered
 * when Live has more than one of that name ("Deck B", "Deck B #2"; Live keeps
 * the name when a track is duplicated), or "Track N" when it has none.
 */
export function liveTrackKeys(tracks: readonly { name: string }[]): string[] {
  const seen = new Map<string, number>();
  return tracks.map((t, i) => {
    const base = t.name.trim() || `Track ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} #${n}`;
  });
}

export function mappedTracks(tracks: readonly { name: string }[], roles: LiveRoles): { index: number; role: VoiceSourceId }[] {
  const out: { index: number; role: VoiceSourceId }[] = [];
  tracks.forEach((t, index) => {
    const role = roles[t.name];
    if (role) out.push({ index, role });
  });
  return out;
}

/**
 * Hits from a Live track's level, which arrives up to fifty times a second
 * already scaled 0-1. A hit is a jump well over where the level has just been;
 * the note ends when the level falls away.
 */
export class LevelHits {
  private floor = 0;
  private lastHit = -Infinity;
  private lastTime: number | null = null;
  private sounding = false;

  step(level: number, time: number): { type: 'on' | 'off'; velocity: number } | null {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(0.25, time - this.lastTime));
    this.lastTime = time;
    const v = Math.max(0, Math.min(1, level));
    const rise = v - this.floor;
    // The floor falls away within about a fifth of a second and jumps up with the level.
    this.floor = Math.max(v, this.floor - 5 * dt);
    if (v > 0.12 && rise > 0.18 && time - this.lastHit > 0.07) {
      this.lastHit = time;
      this.sounding = true;
      return { type: 'on', velocity: Math.max(0.2, v) };
    }
    if (this.sounding && v < 0.06) {
      this.sounding = false;
      return { type: 'off', velocity: 0 };
    }
    return null;
  }

  /** Forget the track. True when a note was still sounding (its off is owed). */
  reset(): boolean {
    const was = this.sounding;
    this.floor = 0;
    this.sounding = false;
    this.lastTime = null;
    return was;
  }
}

/** The kind of Live track a set's own sounds belong to. */
const SOUND_ROLE: Partial<Record<VoiceSourceId, VoiceSourceId>> = {
  acid: 'bass', dubbass: 'bass', analog: 'lead', scan: 'lead', siren: 'fx', echo: 'fx', drop: 'fx', drone: 'pad', bowls: 'chords', xy: 'pad',
};
const DRUM_PARTS = new Set<VoiceSourceId>(['kick', 'snare', 'hats', 'perc']);

/**
 * The Live track (or drum of a drum track) a visual following one of the
 * studio's own sounds belongs on: Hats goes to the Hats track, Kick to the
 * Kick track or the kick of a drum track, Chords to Keys. Null when nothing
 * fits (Everything, What you play).
 */
export function liveMatchFor(
  source: VoiceSourceId,
  tracks: readonly { name: string; role: VoiceSourceId | null; drums: boolean }[],
): LiveSourceId | null {
  const want = SOUND_ROLE[source] ?? source;
  if (want === 'all' || want === 'played') return null;
  const roleOf = (t: { name: string; role: VoiceSourceId | null }) => t.role ?? guessRole(t.name);
  // A track of its own beats a drum track's part (a Kick track over Drums: kick).
  const own = tracks.find((t) => roleOf(t) === want && !(t.drums && DRUM_PARTS.has(want) && tracks.some((o) => o !== t && !o.drums && roleOf(o) === want)));
  if (own && !(own.drums && DRUM_PARTS.has(want))) return liveSource(own.name);
  if (DRUM_PARTS.has(want)) {
    const kit = tracks.find((t) => t.drums);
    if (kit) return liveSource(kit.name, want as 'kick' | 'snare' | 'hats' | 'perc');
  }
  return own ? liveSource(own.name) : null;
}
