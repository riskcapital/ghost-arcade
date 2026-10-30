/**
 * Live tracks into the visual voices, while Live is in control.
 *
 * Each Live track given a sound in the studio feeds the voices following that
 * sound. A MIDI track sends its clip notes as they play (exact pitch and
 * length, on Live's song clock); an audio track sends its level, which is
 * listened to for hits. See `liveControl.ts`.
 */

import { get } from 'svelte/store';
import { abletonBridge } from '../ableton/abletonBridge';
import { musicStudio } from './musicStudioStore';
import { pushOutsideNote } from './musicRuntime';
import { LevelHits, mappedTracks } from './liveControl';
import type { VoiceSourceId } from './visualVoices';

/** Audio tracks have no pitch; their hits sit mid-range. */
const LEVEL_NOTE = 60;

let started = false;
let feedKey = '';
let roles = new Map<number, VoiceSourceId>();
const hits = new Map<number, LevelHits>();

function onNotes(track: number, notes: { pitch: number; velocity: number; beats: number }[]): void {
  const role = roles.get(track);
  if (!role) return;
  const beatSeconds = 60 / Math.max(20, get(abletonBridge).tempo);
  for (const n of notes) {
    pushOutsideNote('on', n.pitch, n.velocity / 127, role);
    // The off is queued now, for when Live ends the note.
    pushOutsideNote('off', n.pitch, 0, role, Math.max(0.03, n.beats * beatSeconds));
  }
}

function onLevel(track: number, level: number): void {
  const role = roles.get(track);
  if (!role) return;
  let tracker = hits.get(track);
  if (!tracker) {
    tracker = new LevelHits();
    hits.set(track, tracker);
  }
  const hit = tracker.step(level, performance.now() / 1000);
  if (hit) pushOutsideNote(hit.type, LEVEL_NOTE, hit.velocity, role);
}

function sync(): void {
  const studio = get(musicStudio);
  const bridge = get(abletonBridge);
  const on = studio.liveControl && bridge.connected;
  const mapped = on ? mappedTracks(bridge.tracks, studio.liveRoles) : [];
  const noteTracks = mapped.filter((m) => bridge.tracks[m.index]?.midi).map((m) => m.index);
  const levelTracks = mapped.filter((m) => !bridge.tracks[m.index]?.midi).map((m) => m.index);
  const key = JSON.stringify(mapped.map((m) => [m.index, m.role, bridge.tracks[m.index]?.midi]));
  if (key === feedKey) return;
  feedKey = key;
  roles = new Map(mapped.map((m) => [m.index, m.role]));
  for (const [track, tracker] of hits) if (!levelTracks.includes(track)) {
    tracker.reset();
    hits.delete(track);
  }
  abletonBridge.setStudioFeed(mapped.length ? { noteTracks, levelTracks, onNotes, onLevel } : null);
}

/** Start following the studio's Live mapping. Safe to call repeatedly. */
export function ensureLiveFeed(): void {
  if (started) return;
  started = true;
  musicStudio.subscribe(sync);
  abletonBridge.subscribe(sync);
}
