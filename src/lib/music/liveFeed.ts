/**
 * Live tracks into the visual voices, while the studio plays with Ableton.
 *
 * Every track in the Live set feeds the voices that follow it by name
 * (`live:<track>`): a MIDI track sends its clip notes as they play (exact
 * pitch and length, on Live's song clock), and a drum track also sends each
 * note to its drum (`live:<track>/kick` and so on); an audio track sends its
 * level, both as a continuous envelope and as hits. A track given a studio
 * part ("feeds visuals as") also plays that part, as before. See
 * `liveControl.ts` and `visualVoices.ts`.
 *
 * While this feed is on, the Ableton connector's deck links and crossfader
 * stand down (see `abletonBridge.setStudioFeed`): the studio has its own setup.
 */

import { get } from 'svelte/store';
import { audioBpm, audioStore } from '../stores/audio';
import { launchClockFollowsLink } from '../stores/launchClock';
import { abletonBridge } from '../ableton/abletonBridge';
import { musicStudio } from './musicStudioStore';
import { applyLiveScene, noteLiveScene, keepLiveSources, pushLiveNote, pushOutsideNote, setLiveFeedActive, setLiveLevel } from './musicRuntime';
import { studioSceneForLive } from './scenes';
import { isDrumTrack, LevelHits, mappedTracks } from './liveControl';
import { gmDrum, liveSource, type AnySourceId, type VoiceSourceId } from './visualVoices';

/** Audio tracks have no pitch; their hits sit mid-range. */
const LEVEL_NOTE = 60;

interface FedTrack {
  name: string;
  midi: boolean;
  drums: boolean;
  role: VoiceSourceId | null;
}

let started = false;
let feedKey = '';
let fed = new Map<number, FedTrack>();
const hits = new Map<number, LevelHits>();

function onNotes(track: number, notes: { pitch: number; velocity: number; beats: number }[]): void {
  const t = fed.get(track);
  if (!t) return;
  const beatSeconds = 60 / Math.max(20, get(abletonBridge).tempo);
  for (const n of notes) {
    const length = Math.max(0.03, n.beats * beatSeconds);
    const velocity = n.velocity / 127;
    const drum = t.drums ? gmDrum(n.pitch) : null;
    const sources: AnySourceId[] = [liveSource(t.name)];
    if (drum) sources.push(liveSource(t.name, drum));
    pushLiveNote('on', n.pitch, velocity, sources, 0, t.drums);
    pushLiveNote('off', n.pitch, 0, sources, length, t.drums);
    if (t.role) {
      pushOutsideNote('on', n.pitch, velocity, t.role);
      // The off is queued now, for when Live ends the note.
      pushOutsideNote('off', n.pitch, 0, t.role, length);
    }
  }
}

function onLevel(track: number, level: number): void {
  const t = fed.get(track);
  if (!t) return;
  const source = liveSource(t.name);
  setLiveLevel(source, level);
  let tracker = hits.get(track);
  if (!tracker) {
    tracker = new LevelHits();
    hits.set(track, tracker);
  }
  const hit = tracker.step(level, performance.now() / 1000);
  if (!hit) return;
  pushLiveNote(hit.type, LEVEL_NOTE, hit.velocity, [source]);
  // A level hit has no pitch: it moves the visuals but does not tell the key.
  if (t.role) pushOutsideNote(hit.type, LEVEL_NOTE, hit.velocity, t.role, 0, false);
}

/** A Live scene launched: the studio scene that goes with it brings its visuals and sound. */
function onScene(scene: number): void {
  noteLiveScene(scene);
  const studio = get(musicStudio);
  const id = studioSceneForLive(studio.scenes, scene, get(abletonBridge).scenes.map((sc) => sc.name));
  if (id) applyLiveScene(id);
  else if (studio.queuedSceneId) musicStudio.setTransport({ queuedSceneId: null });
}

function sync(): void {
  const studio = get(musicStudio);
  const bridge = get(abletonBridge);
  // Only while the studio is open: closed, nothing plays (and Live stops streaming levels).
  const on = studio.isOpen && studio.liveControl && bridge.connected;
  // Live's tempo, for instruments played on top. Link does this exactly (tempo
  // and phase); without a Link peer, follow the tempo Live reports.
  if (on && bridge.tempo > 0 && !launchClockFollowsLink() && Math.abs(get(audioBpm) - bridge.tempo) > 0.01) audioStore.setManualBPM(bridge.tempo);
  const roles = new Map((on ? mappedTracks(bridge.tracks, studio.liveRoles) : []).map((m) => [m.index, m.role]));
  const next = new Map<number, FedTrack>();
  if (on) {
    bridge.tracks.forEach((track, index) => {
      const role = roles.get(index) ?? null;
      next.set(index, { name: track.name, midi: track.midi, drums: isDrumTrack(track, role), role });
    });
  }
  const key = JSON.stringify([on, [...next.entries()]]);
  if (key === feedKey) return;
  feedKey = key;
  const previous = fed;
  fed = next;
  setLiveFeedActive(on);
  for (const [track, tracker] of hits) {
    const now = next.get(track);
    if (now && !now.midi) continue;
    // A track let go mid-hit ends its note, or its voice stays lit.
    const was = previous.get(track);
    if (tracker.reset() && was) {
      pushLiveNote('off', LEVEL_NOTE, 0, [liveSource(was.name)]);
      if (was.role) pushOutsideNote('off', LEVEL_NOTE, 0, was.role, 0, false);
    }
    if (was) setLiveLevel(liveSource(was.name), 0);
    hits.delete(track);
  }
  const keep = new Set<string>();
  for (const t of next.values()) {
    keep.add(liveSource(t.name));
    if (t.drums) for (const d of ['kick', 'snare', 'hats', 'perc'] as const) keep.add(liveSource(t.name, d));
  }
  keepLiveSources(keep);
  const tracks = [...next.entries()];
  abletonBridge.setStudioFeed(on
    ? {
      noteTracks: tracks.filter(([, t]) => t.midi).map(([i]) => i),
      levelTracks: tracks.filter(([, t]) => !t.midi).map(([i]) => i),
      onNotes,
      onLevel,
      onScene,
    }
    : null);
}

/** Start following the studio's Live mapping. Safe to call repeatedly. */
export function ensureLiveFeed(): void {
  if (started) return;
  started = true;
  musicStudio.subscribe(sync);
  abletonBridge.subscribe(sync);
}
