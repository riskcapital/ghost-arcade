/**
 * The studio as a controller for Ableton Live.
 *
 * With Live in control, the studio's own instruments go quiet and the session
 * grid shows Live's clips and scenes: launching one fires it in Live, and Live
 * plays the audio. Each Live track can feed the visual voices as one of their
 * sounds (the kick, the bass, the chords...). A MIDI track's clip notes arrive
 * with their pitch on the song clock; an audio track's level is listened to
 * for hits, the way the live input is.
 *
 * Tracks are matched by name, so the mapping survives tracks being added or
 * moved in the Live set.
 */

import { VOICE_SOURCES, type VoiceSourceId } from './visualVoices';

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
