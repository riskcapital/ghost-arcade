/**
 * Ableton bridge — mirrors the Live set and drives Ghost Arcade from it.
 *
 *  - Ghost Arcade's Live control surface (ableton/GhostArcade) reports the
 *    set and every launch over loopback UDP; Electron main forwards each
 *    batch through `window.ghostAbleton.onMessage`.
 *  - The set is mirrored here: scenes, tracks, clip names and colours,
 *    locators, and which slots are playing or queued.
 *  - Links pair a scene, clip or locator with a visual. They fire the moment
 *    Live launches (or the song reaches the locator), not on Ghost Arcade's
 *    own launch quantize, because Live has already waited for the bar.
 *  - Visual score tracks: notes on a Live MIDI track fire visuals, scheduled
 *    against Live's song position by the conductor loop below.
 *  - Signals: Live knobs, track levels, loop progress and launch colours
 *    drive any Ghost Arcade control through the control router.
 *
 * Links, signals and the score map are saved with the project
 * (exportProject / importProject in src/lib/stores/layers.ts).
 */

import { derived, get, writable } from 'svelte/store';
import { generateUUID } from '../utils/uuid';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { snapshots } from '../stores/snapshots';
import { project } from '../stores/layers';
import { globalStagePresets } from '../stores/globalPresets';
import { midiRouter } from '../midi/midiRouter';
import {
  launchBeat,
  linksForClip,
  linksForLocator,
  linksForScene,
  positionFallback,
  quantizeBeats,
  relink,
  samePlace,
  sanitizeAction,
  sanitizeLinks,
  type AbletonLink,
  type AbletonSource,
  type LiveCue,
  type LiveScene,
  type LiveTrack,
  type ScoreNote,
  type VisualAction,
} from './abletonLinks';
import { DEFAULT_BEAT_SCRAMBLE, sanitizeBeatScramble, type BeatScrambleSettings } from './beatScramble';
import { scrambleNow } from './scrambleDecks';
import {
  colorHue,
  defaultScoreAction,
  isScoreTrackName,
  autoRange,
  locatorsReached,
  notesDue,
  sanitizeSignals,
  signalOutput,
  smoothToward,
  type LevelRange,
  type SignalLink,
  type SignalSource,
  type SignalTarget,
} from './abletonScore';
import {
  deriveSongs,
  mixPosition,
  autoEvents,
  nextSong,
  orderSongs,
  playingSection,
  sectionPlan,
  type PlayMode,
  type SetlistSong,
} from './abletonSetlist';

/** No heartbeat for this long means Live (or the script) went away. */
const CONNECTION_TIMEOUT_MS = 3500;
/** Track messages for one set arrive as a burst; relink once it settles. */
const RELINK_DELAY_MS = 150;
/** The conductor's tick: score notes land within this of their beat. */
const CONDUCTOR_MS = 6;
/** Signals reach their controls at most this often. */
const SIGNAL_MS = 16;
/** How long a launched control hit holds before it releases. */
const HIT_MS = 120;
const ACTIVITY_LENGTH = 8;
/** A song position this far from where it should be is a jump, not drift. */
const JUMP_BEATS = 0.25;
/** A scene's trigger clearing counts as a launch only with a clip of that
 *  scene starting within this window (ms); otherwise it was cancelled. */
const SCENE_CONFIRM_MS = 250;
/** A device list is asked for at most this often per track (ms). */
const DEVICE_REQUEST_MS = 2000;

export interface ScriptStatus {
  installed: boolean;
  current: boolean;
  path: string;
  libraryFound: boolean;
  available: boolean;
}

export interface LiveDevice { name: string; params: { name: string; value: number }[] }

export interface AbletonBridgeState {
  /** Start the listener with the project (saved). */
  enabled: boolean;
  links: AbletonLink[];
  signals: SignalLink[];
  /** Names of MIDI tracks marked as visual score tracks (saved). Tracks
   *  named "Ghost Arcade" or "Visuals" count without being marked. */
  scoreTracks: string[];
  /** Pitch → visual for score notes (saved); unmapped pitches use the
   *  default lanes. */
  scoreMap: Record<number, VisualAction>;
  /** Scramble what's on screen on a beat grid (saved). */
  beatScramble: BeatScrambleSettings;
  /** Live's A/B decks drive Ghost Arcade's decks and crossfader (saved). */
  deckMode: boolean;
  /** Song keys in the DJ's set order (saved). */
  setlistOrder: string[];
  /** Bars an auto-mix takes to sweep the crossfader; 0 cuts (saved). */
  autoMixBars: number;
  /** Who moves the set along: the DJ, each song's plan, or the whole set
   *  playing itself (saved). */
  playMode: PlayMode;
  /** Bars per section, by song key, where the DJ changed them (saved). */
  songPlans: Record<string, number[]>;
  // Runtime only.
  /** Keep the section playing now looping; autoplay waits. */
  hold: boolean;
  /** Songs that have played this session, and the one playing now. */
  played: string[];
  currentSong: string | null;
  /** A crossfader sweep in progress, in song beats. */
  mix: { from: number; to: number; startBeat: number; beats: number; title: string } | null;
  listening: boolean;
  error: string | null;
  connected: boolean;
  tempo: number;
  numerator: number;
  denominator: number;
  playing: boolean;
  quantize: number;
  scenes: LiveScene[];
  tracks: LiveTrack[];
  cues: LiveCue[];
  /** Device lists by track index, fetched on request. */
  devices: Record<number, LiveDevice[]>;
  /** Links that match nothing in the current set. */
  missing: string[];
  /** Last time each link fired (performance.now()), for the UI flash. */
  fired: Record<string, number>;
  /** Live's song position (beats) at `clockAt` (performance.now()). */
  clockBeat: number;
  clockAt: number;
  /** Recent launches, newest first, for the activity strip. */
  activity: { text: string; at: number }[];
  script: ScriptStatus | null;
}

const INITIAL: AbletonBridgeState = {
  enabled: false,
  links: [],
  signals: [],
  scoreTracks: [],
  scoreMap: {},
  beatScramble: DEFAULT_BEAT_SCRAMBLE,
  deckMode: false,
  setlistOrder: [],
  autoMixBars: 8,
  playMode: 'live',
  songPlans: {},
  hold: false,
  played: [],
  currentSong: null,
  mix: null,
  listening: false,
  error: null,
  connected: false,
  tempo: 120,
  numerator: 4,
  denominator: 4,
  playing: false,
  quantize: 4,
  scenes: [],
  tracks: [],
  cues: [],
  devices: {},
  missing: [],
  fired: {},
  clockBeat: 0,
  clockAt: 0,
  activity: [],
  script: null,
};

/** Live's song position now, run forward from the last report. */
export function songBeat(state: AbletonBridgeState, now = performance.now()): number {
  if (!state.playing) return state.clockBeat;
  return state.clockBeat + ((now - state.clockAt) / 1000) * (state.tempo / 60);
}

/** Track indices whose clips are visual scores. */
export function scoreTrackIndices(state: Pick<AbletonBridgeState, 'tracks' | 'scoreTracks'>): number[] {
  return state.tracks.flatMap((track, index) =>
    track.midi && (isScoreTrackName(track.name) || state.scoreTracks.includes(track.name)) ? [index] : []);
}

/** What a score pitch fires. */
export function scoreAction(state: Pick<AbletonBridgeState, 'scoreMap'>, pitch: number, columns: number): VisualAction | null {
  return state.scoreMap[pitch] ?? defaultScoreAction(pitch, columns);
}

/** Fraction through the playing clip's loop on `track` (0 when idle). */
export function loopProgress(state: AbletonBridgeState, track: number, beat: number): number {
  const t = state.tracks[track];
  if (!t || t.playing < 0 || !state.playing) return 0;
  const length = t.slots[t.playing]?.length || 4;
  return (Math.max(0, beat - t.startedBeat) % length) / length;
}

/** The next queued launch that will change the visuals, for countdowns. */
export function upcomingLaunch(state: AbletonBridgeState, beat: number): { label: string; beats: number } | null {
  if (!state.playing) return null;
  const step = quantizeBeats(state.quantize, state.numerator, state.denominator);
  let best: { label: string; beats: number } | null = null;
  const consider = (label: string, firedBeat: number, links: AbletonLink[]) => {
    if (!links.length) return;
    const beats = launchBeat(firedBeat, step) - beat;
    if (beats > 0 && (!best || beats < best.beats)) best = { label, beats };
  };
  state.scenes.forEach((scene, s) => {
    if (!scene.queued) return;
    const firing = state.tracks.find(t => t.fired === s);
    consider(scene.name || `Scene ${s + 1}`, firing?.firedBeat ?? beat, linksForScene(state.links, s));
  });
  state.tracks.forEach((track, t) => {
    if (track.fired >= 0) consider(track.slots[track.fired]?.name || track.name, track.firedBeat, linksForClip(state.links, t, track.fired));
  });
  return best;
}

/** The set's songs in the DJ's order. */
export function setlist(state: Pick<AbletonBridgeState, 'scenes' | 'tracks' | 'setlistOrder'>): SetlistSong[] {
  return orderSongs(deriveSongs(state.scenes, state.tracks), state.setlistOrder);
}

/** Live's crossfader, 0 = full A, 1 = full B. A store of its own, like
 *  vjCrossfader: riding the fader or an auto-mix sweep wakes only what
 *  shows the fader, not everything that watches the bridge. */
export const abletonCrossfader = writable(0.5);

/** Live values per signal (0..1, after smoothing) for meters. */
export const abletonSignalLevels = writable<Record<string, number>>({});
/** Last time each score pitch fired (performance.now()), for lane flashes. */
export const abletonScoreHits = writable<Record<number, number>>({});

type LiveMessage = Record<string, any> & { t: string };

const api = () => (typeof window !== 'undefined' ? (window as any).ghostAbleton : undefined);

/** Saved section plans, keeping only whole positive bar counts. */
function sanitizePlans(raw: unknown): Record<string, number[]> {
  const plans: Record<string, number[]> = {};
  if (!raw || typeof raw !== 'object') return plans;
  for (const [key, bars] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(bars)) continue;
    plans[key] = bars.map(b => (Number.isFinite(b) && (b as number) > 0 ? Math.min(256, Math.round(b as number)) : 0));
  }
  return plans;
}

/** Whether a new visual on a source takes the place of an existing one:
 *  only one column per deck, one snapshot and one Stage preset can show. */
function replaces(next: VisualAction, existing: VisualAction): boolean {
  if (next.kind === 'column' && existing.kind === 'column') return next.deck === existing.deck;
  return (next.kind === 'snapshot' || next.kind === 'stage') && existing.kind === next.kind;
}

function createAbletonBridge() {
  const store = writable<AbletonBridgeState>({ ...INITIAL });
  const { subscribe, update } = store;
  const read = () => get(store);

  let unsubscribeMessages: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let conductor: ReturnType<typeof setInterval> | null = null;
  let relinkTimer: ReturnType<typeof setTimeout> | null = null;
  let lastHello = 0;
  /** Scene and track counts the links were last resolved against. */
  let linkedCounts: { scenes: number; tracks: number } | null = null;
  /** Scenes whose trigger cleared, waiting for one of their clips to start
   *  (ms timestamps), and when each scene row last had a clip start. */
  const sceneClears = new Map<number, number>();
  const sceneStarts = new Map<number, number>();
  /** Each track's last clip start, so one launch reported two ways (the
   *  queue clearing and the playing slot) fires its links once. */
  const lastStarts = new Map<number, { slot: number; at: number }>();
  /** When each track's devices were last asked for. */
  const deviceRequests = new Map<number, number>();
  /** Live's crossfader as last reported, to push only real moves. */
  let liveCrossfader = Number.NaN;
  /** When Ghost Arcade last moved Live's crossfader: Live echoes each value
   *  back a moment later, and a late echo must not pull the fader back. */
  let ownCrossfaderAt = 0;
  /** Echoes arrive within this window (ms); a bigger jump is the DJ. */
  const ECHO_MS = 250;
  const ECHO_RANGE = 0.05;
  /** The last watch request sent, to avoid repeating it. */
  let sentWatch = '';

  // High-rate values stay out of the store.
  const paramValues = new Map<string, number>();
  /** Track levels, already auto-ranged to 0..1. */
  const levelValues = new Map<number, number>();
  const levelRanges = new Map<number, LevelRange>();
  const colorValues = new Map<number, number>();
  const signalState = new Map<string, { value: number; sent: number }>();
  /** Elapsed beats each playing score clip has been scheduled up to. */
  const scorePlayhead = new Map<string, number>();
  /** Control releases due at a song position. */
  let releases: { beat: number; path: string; value: number; inputId: string }[] = [];
  let conductorBeat = 0;
  /** A deck song waiting to land before the crossfader moves to it; it
   *  lapses if the song hasn't landed by `deadline` (song beats). */
  let pendingMix: { track: number; slot: number; side: 'A' | 'B'; bars: number; title: string; deadline: number } | null = null;
  /** Whether this project has said if Live's decks drive Ghost Arcade's;
   *  until it has, a set with decks on both sides links them. */
  let deckModeChosen = false;
  /** The beat-scramble grid step last seen, to fire on each new one. */
  let lastScrambleStep: number | null = null;
  /** Autoplay steps already taken, so each fires once. */
  const autoDone = new Set<string>();
  /** Tracks to stop when an outgoing song's last section ends. */
  let pendingStops: { track: number; at: number }[] = [];
  /** A song mixing out under the next one, still following its plan. */
  let outgoingSong: string | null = null;
  let lastMixSentAt = 0;
  let lastMixValue = Number.NaN;
  let lastSignalAt = 0;
  let lastMeterAt = 0;

  function send(message: LiveMessage) {
    void api()?.send(message);
  }

  // ── Firing ──────────────────────────────────────────────────────────

  function runAction(action: VisualAction, velocity = 127, hold?: { untilBeat: number; inputId: string }) {
    if (action.kind === 'column') vjClipLauncher.triggerColumnNow(action.column, action.deck);
    else if (action.kind === 'clip') vjClipLauncher.triggerClipNow(action.layer, action.column, action.deck);
    else if (action.kind === 'snapshot') snapshots.recall(action.slot);
    else if (action.kind === 'stage') loadStage(action);
    else {
      const value = action.release + (action.value - action.release) * (velocity / 127);
      const inputId = hold?.inputId ?? `ableton:hit:${action.path}`;
      midiRouter.dispatchPath(action.path, value, { inputId });
      if (hold) releases.push({ beat: hold.untilBeat, path: action.path, value: action.release, inputId });
      else setTimeout(() => midiRouter.dispatchPath(action.path, action.release, { inputId }), HIT_MS);
    }
  }

  /** Recall a Stage preset the way the VJ panel's preset list does. */
  function loadStage(action: Extract<VisualAction, { kind: 'stage' }>) {
    const presets = action.scope === 'global' ? get(globalStagePresets) : get(project).stagePresets ?? [];
    const preset = presets.find(p => p.id === action.presetId) ?? presets.find(p => !!action.name && p.name === action.name);
    if (!preset) return;
    if (action.scope === 'global') project.loadStagePresetSnapshot(preset);
    else project.loadStagePreset(preset.id);
  }

  function fire(links: AbletonLink[], label: string) {
    const { missing } = read();
    const live = links.filter(link => !missing.includes(link.id));
    if (!live.length) return;
    for (const link of live) runAction(link.action);
    const now = performance.now();
    update(s => ({
      ...s,
      fired: { ...s.fired, ...Object.fromEntries(live.map(l => [l.id, now])) },
      activity: [{ text: label, at: now }, ...s.activity].slice(0, ACTIVITY_LENGTH),
    }));
  }

  /** Mark the song a launch belongs to as played and current. A later
   *  section (a song mixing out reaching its outro) takes over only when
   *  the current song has stopped. */
  function markPlayed(match: (song: SetlistSong) => boolean, slot?: number) {
    const s = read();
    const songs = deriveSongs(s.scenes, s.tracks);
    const song = songs.find(match);
    if (!song) return;
    const opening = song.kind !== 'clip' || song.sections[0]?.slot === slot;
    const current = songs.find(x => x.key === s.currentSong);
    if (!opening && current && current.key !== song.key && playingSection(current, s.tracks) >= 0) return;
    update(s => ({ ...s, currentSong: song.key, played: s.played.includes(song.key) ? s.played : [...s.played, song.key] }));
  }

  /** A deck song landed: start moving the crossfader to its side. */
  function startMix(mix: NonNullable<typeof pendingMix>) {
    const s = read();
    const perBar = s.numerator * (4 / s.denominator);
    update(st => ({
      ...st,
      mix: { from: get(abletonCrossfader), to: mix.side === 'A' ? 0 : 1, startBeat: st.clockBeat, beats: mix.bars * perBar, title: mix.title },
    }));
  }

  function sceneLabel(index: number) {
    return read().scenes[index]?.name || `Scene ${index + 1}`;
  }

  /** A clip started (or restarted) on a track: fire its links. */
  function clipStarted(track: number, slot: number) {
    const now = performance.now();
    const last = lastStarts.get(track);
    if (last && last.slot === slot && now - last.at < SCENE_CONFIRM_MS) return;
    lastStarts.set(track, { slot, at: now });
    setTrack(track, { playing: slot, fired: -1, startedBeat: read().clockBeat });
    sceneStarts.set(slot, performance.now());
    const t = read().tracks[track];
    const clip = t?.slots[slot];
    if (clip) colorValues.set(track, colorHue(clip.color));
    markPlayed(song => song.kind === 'clip' && song.track === track && song.sections.some(sec => sec.slot === slot), slot);
    if (pendingMix && pendingMix.track === track && pendingMix.slot === slot) {
      startMix(pendingMix);
      pendingMix = null;
    }
    fire(linksForClip(read().links, track, slot), `${t?.name || `Track ${track + 1}`} · ${clip?.name || 'Clip'}`);
  }

  function sceneLaunched(scene: number) {
    const color = read().scenes[scene]?.color;
    if (color) colorValues.set(-1, colorHue(color));
    markPlayed(song => song.kind === 'scenes' && song.sections[0]?.scene === scene);
    fire(linksForScene(read().links, scene), sceneLabel(scene));
  }

  /** Resolve scene triggers that cleared: launched if one of the scene's
   *  clips started around the same moment, cancelled otherwise. */
  function confirmScenes() {
    if (!sceneClears.size) return;
    const now = performance.now();
    for (const [scene, at] of sceneClears) {
      const started = sceneStarts.get(scene);
      if (started !== undefined && Math.abs(started - at) <= SCENE_CONFIRM_MS) {
        sceneClears.delete(scene);
        sceneLaunched(scene);
      } else if (now - at > SCENE_CONFIRM_MS) {
        sceneClears.delete(scene);
      }
    }
  }

  /** Live's song position: corrects drift, and on a jump (a locator, an
   *  arrangement loop wrapping) keeps every timing in step with it. */
  function applyClock(beat: number) {
    const s = read();
    const now = performance.now();
    const shift = s.playing && s.clockAt > 0 ? beat - songBeat(s, now) : 0;
    const jumped = Math.abs(shift) > JUMP_BEATS;
    update(st => {
      const next = { ...st, clockBeat: beat, clockAt: now };
      if (!jumped) return next;
      // Session clips keep their own time when the song position jumps.
      next.tracks = st.tracks.map(t => ({ ...t, startedBeat: t.startedBeat + shift, firedBeat: t.firedBeat + shift }));
      if (st.mix) next.mix = { ...st.mix, startBeat: st.mix.startBeat + shift };
      return next;
    });
    if (jumped) {
      releases = releases.map(r => ({ ...r, beat: r.beat + shift }));
      if (pendingMix) pendingMix = { ...pendingMix, deadline: pendingMix.deadline + shift };
    }
  }

  function cancelMix() {
    pendingMix = null;
    if (read().mix) update(s => ({ ...s, mix: null }));
  }

  function releaseAll() {
    for (const r of releases) midiRouter.dispatchPath(r.path, r.value, { inputId: r.inputId });
    releases = [];
    midiRouter.releaseInputs('ableton:');
  }

  // ── Conductor: score notes, locators, signals ───────────────────────

  function tick() {
    const s = read();
    const now = performance.now();
    let beat = songBeat(s, now);
    // A small step back is a clock correction, not a jump: hold position so
    // nothing near it fires twice.
    if (beat < conductorBeat && conductorBeat - beat < 0.5) beat = conductorBeat;
    confirmScenes();
    if (pendingMix && s.playing && beat > pendingMix.deadline) pendingMix = null;

    if (s.playing) {
      const columns = get(vjClipLauncher).numColumns;
      const active = new Set<string>();
      for (const t of scoreTrackIndices(s)) {
        const track = s.tracks[t];
        const clip = track.playing >= 0 ? track.slots[track.playing] : null;
        if (!clip?.notes?.length) continue;
        const key = `${t}:${track.playing}:${track.startedBeat}`;
        active.add(key);
        const elapsed = beat - track.startedBeat;
        // A clip found already playing (or a long stall) picks up from now
        // rather than replaying every note it missed.
        const known = scorePlayhead.get(key);
        const from = known === undefined ? (elapsed > 0.5 ? elapsed : -1e-6) : (elapsed - known > 8 ? elapsed : known);
        if (elapsed <= from) { scorePlayhead.set(key, from); continue; }
        scorePlayhead.set(key, elapsed);
        const due = notesDue(clip.notes, from, elapsed, clip.length);
        if (due.length) playNotes(s, t, track, due, columns);
      }
      if (scorePlayhead.size > active.size) {
        for (const key of scorePlayhead.keys()) if (!active.has(key)) scorePlayhead.delete(key);
      }
      for (const index of locatorsReached(s.cues, conductorBeat, beat)) {
        fire(linksForLocator(s.links, index), s.cues[index]?.name || `Locator ${index + 1}`);
      }
    }
    conductorBeat = beat;

    if (releases.length) {
      const due = releases.filter(r => !s.playing || beat >= r.beat);
      if (due.length) {
        releases = releases.filter(r => !due.includes(r));
        for (const r of due) midiRouter.dispatchPath(r.path, r.value, { inputId: r.inputId });
      }
    }

    if (s.mix && s.playing && now - lastMixSentAt >= 30) {
      lastMixSentAt = now;
      const v = mixPosition(s.mix.from, s.mix.to, s.mix.startBeat, s.mix.beats, beat);
      lastMixValue = v;
      sendCrossfader(v);
      if (v === s.mix.to) {
        update(st => ({ ...st, mix: null }));
        // In song mode, once the room has fully moved over, the deck it left
        // stops so its last section doesn't loop on unheard. (Set mode stops
        // each outgoing song as its own plan ends.)
        if (s.playMode === 'song') stopSide(s.mix.to === 0 ? 'B' : 'A');
      }
    }

    if (s.playing) autoPlay(s, beat);

    // Beat scramble: on each multiple of `every` beats of the song.
    if (s.beatScramble.on && s.playing) {
      const step = Math.floor(beat / s.beatScramble.every + 1e-6);
      if (step !== lastScrambleStep) {
        if (lastScrambleStep !== null && step > lastScrambleStep) scrambleNow(s.beatScramble.target, s.beatScramble.amount);
        lastScrambleStep = step;
      }
    } else lastScrambleStep = null;

    if (now - lastSignalAt >= SIGNAL_MS && s.signals.length) {
      const dt = Math.min(0.1, (now - lastSignalAt) / 1000);
      lastSignalAt = now;
      driveSignals(s, beat, dt, now);
    }
  }

  // ── Autoplay ────────────────────────────────────────────────────────

  /** The track timing a song's section. */
  function sectionTrack(s: AbletonBridgeState, song: SetlistSong, index: number): LiveTrack | undefined {
    if (song.kind === 'clip') return s.tracks[song.track];
    const scene = song.sections[index]?.scene;
    return s.tracks.find(t => t.playing === scene);
  }

  /** Beats before a step is due to send it, so Live's launch quantization
   *  lands it on time: half a quantize step, or a hair with none. */
  function sendLead(s: AbletonBridgeState): number {
    const step = quantizeBeats(s.quantize, s.numerator, s.denominator);
    return step > 0 ? step / 2 : 0.05;
  }

  /** Stop a deck's tracks, sparing any holding the current song or about
   *  to launch one. */
  function stopSide(side: 'A' | 'B') {
    const s = read();
    const current = setlist(s).find(x => x.key === s.currentSong);
    s.tracks.forEach((t, i) => {
      if (t.side !== side || t.playing < 0 || t.fired >= 0 || pendingMix?.track === i) return;
      if (current?.kind === 'clip' && current.track === i) return;
      send({ t: 'stop_track', i });
    });
  }

  /** Move the set along by the songs' plans: the next section when one's
   *  bars are up and, in set mode, the next song mixed in to finish as the
   *  last section ends. A song mixing out keeps following its plan. */
  function autoPlay(s: AbletonBridgeState, beat: number) {
    const lead = sendLead(s);
    if (pendingStops.length) {
      const due = pendingStops.filter(p => beat >= p.at - lead);
      pendingStops = pendingStops.filter(p => !due.includes(p));
      for (const p of due) send({ t: 'stop_track', i: p.track });
    }
    if (s.playMode === 'live') return;
    const songs = setlist(s);
    // Until the next song lands, the outgoing one is still current; it is
    // let go once it stops playing.
    const out = outgoingSong && outgoingSong !== s.currentSong ? songs.find(x => x.key === outgoingSong) : undefined;
    if (out) advance(s, out, beat, lead, songs, true);
    else if (outgoingSong && outgoingSong !== s.currentSong) outgoingSong = null;
    const song = songs.find(x => x.key === s.currentSong);
    if (song) advance(s, song, beat, lead, songs, false);
  }

  function advance(s: AbletonBridgeState, song: SetlistSong, beat: number, lead: number, songs: SetlistSong[], outgoing: boolean) {
    const index = playingSection(song, s.tracks);
    const track = sectionTrack(s, song, index);
    if (index < 0 || !track) {
      if (outgoing) outgoingSong = null;
      return;
    }
    const perBar = s.numerator * (4 / s.denominator);
    const upNext = outgoing ? null : nextSong(songs, song.key, new Set(s.played));
    const events = autoEvents({
      // A song mixing out only finishes its own sections.
      mode: outgoing ? 'song' : s.playMode, hold: !outgoing && s.hold, plan: sectionPlan(s.songPlans, song), index,
      startedBeat: track.startedBeat, perBar, hasNext: !!upNext,
      mixBars: s.deckMode && upNext?.kind === 'clip' && song.kind === 'clip' && upNext.track !== song.track ? s.autoMixBars : 0,
    });
    for (const event of events) {
      if (beat < event.at - lead) break;
      // Already mixing into the next song: that launch happened.
      if (event.kind === 'next' && outgoingSong === song.key) continue;
      const key = `${song.key}:${index}:${track.startedBeat.toFixed(3)}:${event.kind}`;
      if (autoDone.has(key)) continue;
      if (autoDone.size > 256) autoDone.clear();
      autoDone.add(key);
      if (event.kind === 'section') launchSection(song, event.index);
      else if (event.kind === 'next' && upNext) {
        launchSong(upNext);
        outgoingSong = song.key;
        // The outgoing song stops as its last section ends, unless the next
        // one replaces it on the same track anyway.
        if (song.kind === 'clip' && !(upNext.kind === 'clip' && upNext.track === song.track)) {
          pendingStops.push({ track: song.track, at: event.stopAt });
        }
      } else if (event.kind === 'end') {
        if (song.kind === 'clip') pendingStops.push({ track: song.track, at: event.at });
        else send({ t: 'stop_all' });
        update(st => ({ ...st, activity: [{ text: 'End of set', at: performance.now() }, ...st.activity].slice(0, ACTIVITY_LENGTH) }));
      }
    }
  }

  /** Play a song in Live; it lands on Live's launch quantization. In deck
   *  mode the crossfader then moves to the song's deck: a sweep over the
   *  auto-mix bars when the other deck is playing, otherwise a cut. */
  function launchSong(song: SetlistSong) {
    if (song.kind === 'scenes') {
      if (song.sections[0]) send({ t: 'fire_scene', s: song.sections[0].scene });
      return;
    }
    // A stop waiting for this track would cancel the launch in Live; the
    // song replaces whatever plays there on the bar anyway.
    pendingStops = pendingStops.filter(p => p.track !== song.track);
    send({ t: 'fire_clip', i: song.track, s: song.slot });
    const s = read();
    if (!s.deckMode || !song.side) return;
    const otherPlaying = s.tracks.some(t => t.side && t.side !== song.side && t.playing >= 0);
    const perBar = s.numerator * (4 / s.denominator);
    const step = quantizeBeats(s.quantize, s.numerator, s.denominator);
    pendingMix = {
      track: song.track, slot: song.slot, side: song.side, bars: otherPlaying ? s.autoMixBars : 0, title: song.title,
      // If it hasn't landed a bar after its launch point, it isn't coming.
      deadline: launchBeat(songBeat(s), step) + perBar,
    };
  }

  /** Jump to a section of a song; it loops until the next one. */
  function launchSection(song: SetlistSong, index: number) {
    if (song.kind === 'scenes') {
      const section = song.sections[index];
      if (section) send({ t: 'fire_scene', s: section.scene });
      return;
    }
    if (index === 0) {
      launchSong(song);
      return;
    }
    const section = song.sections[index];
    if (section) send({ t: 'fire_clip', i: song.track, s: section.slot });
  }

  function playNotes(s: AbletonBridgeState, t: number, track: LiveTrack, due: { note: ScoreNote; at: number }[], columns: number) {
    const hits: Record<number, number> = {};
    const now = performance.now();
    for (const { note, at } of due) {
      const [pitch, , duration, velocity] = note;
      const action = scoreAction(s, pitch, columns);
      if (!action) continue;
      // Each note holds its own input, so overlapping notes don't cut each other short.
      runAction(action, velocity, { untilBeat: track.startedBeat + at + duration, inputId: `ableton:score:${t}:${pitch}:${at}` });
      hits[pitch] = now;
    }
    if (Object.keys(hits).length) abletonScoreHits.update(h => ({ ...h, ...hits }));
  }

  function signalInput(s: AbletonBridgeState, source: SignalSource, beat: number): number {
    switch (source.kind) {
      case 'param': return paramValues.get(`${source.track}:${source.device}:${source.param}`) ?? 0;
      case 'level': return levelValues.get(source.track) ?? 0;
      case 'phrase': return loopProgress(s, source.track, beat);
      case 'color': return colorValues.get(source.track) ?? 0;
    }
  }

  function driveSignals(s: AbletonBridgeState, beat: number, dt: number, now: number) {
    const meters: Record<string, number> = {};
    for (const link of s.signals) {
      const input = signalInput(s, link.source, beat);
      const state = signalState.get(link.id) ?? { value: input, sent: Number.NaN };
      // Colour jumps between hues; gliding through the wheel would pass
      // every colour in between.
      state.value = link.source.kind === 'color' ? input : smoothToward(state.value, input, link.smooth, dt);
      const output = signalOutput(state.value, link);
      const range = Math.abs(link.target.max - link.target.min) || 1;
      if (!(Math.abs(output - state.sent) < range * 0.002)) {
        state.sent = output;
        midiRouter.dispatchPath(link.target.path, output, { inputId: `ableton:signal:${link.id}` });
      }
      signalState.set(link.id, state);
      meters[link.id] = state.value;
    }
    if (now - lastMeterAt > 50) {
      lastMeterAt = now;
      abletonSignalLevels.set(meters);
    }
  }

  function startConductor() {
    if (conductor) return;
    conductorBeat = songBeat(read());
    lastSignalAt = performance.now();
    conductor = setInterval(tick, CONDUCTOR_MS);
  }

  function stopConductor() {
    if (conductor) clearInterval(conductor);
    conductor = null;
    releaseAll();
  }

  // ── Watching: what Live streams to us ───────────────────────────────

  function syncWatch(force = false) {
    const s = read();
    if (!s.connected) return;
    const params = s.signals.flatMap(l => l.source.kind === 'param' ? [[l.source.track, l.source.device, l.source.param]] : []);
    const levels = [...new Set(s.signals.flatMap(l => l.source.kind === 'level' ? [l.source.track] : []))];
    const score = scoreTrackIndices(s);
    const watch = JSON.stringify({ params, levels, score });
    if (!force && watch === sentWatch) return;
    sentWatch = watch;
    send({ t: 'watch', params, levels, score });
  }

  /** Re-point param signals at their device and parameter by name once a
   *  track's devices are known. */
  function relinkParams(track: number, devices: LiveDevice[]) {
    update(s => {
      let changed = false;
      const signals = s.signals.map(link => {
        const src = link.source;
        if (src.kind !== 'param' || src.track !== track) return link;
        let device = devices[src.device]?.name === src.deviceName ? src.device : devices.findIndex(d => d.name === src.deviceName);
        if (device < 0) device = src.device;
        const params = devices[device]?.params ?? [];
        let param = params[src.param]?.name === src.paramName ? src.param : params.findIndex(p => p.name === src.paramName);
        if (param < 0) param = src.param;
        if (device === src.device && param === src.param) return link;
        changed = true;
        return { ...link, source: { ...src, device, param } };
      });
      return changed ? { ...s, signals } : s;
    });
  }

  /** Re-point signals at their tracks by name after the set changes. */
  function relinkSignalTracks(s: AbletonBridgeState): SignalLink[] {
    return s.signals.map(link => {
      const src = link.source;
      if (src.track < 0 || !src.trackName) return link;
      if (s.tracks[src.track]?.name === src.trackName) return link;
      const track = s.tracks.findIndex(t => t.name === src.trackName);
      return track < 0 ? link : { ...link, source: { ...src, track } };
    });
  }

  function scheduleRelink() {
    if (relinkTimer) clearTimeout(relinkTimer);
    relinkTimer = setTimeout(() => {
      relinkTimer = null;
      update(s => {
        const counts = { scenes: s.scenes.length, tracks: s.tracks.length };
        const { links, missing } = relink(s.links, s.scenes, s.tracks, positionFallback(linkedCounts, counts), s.cues);
        linkedCounts = counts;
        return { ...s, links, missing, signals: relinkSignalTracks(s) };
      });
      syncWatch();
      // Param signals need their tracks' devices to follow renames.
      const tracks = new Set(read().signals.flatMap(l => l.source.kind === 'param' ? [l.source.track] : []));
      for (const track of tracks) send({ t: 'devices', i: track });
    }, RELINK_DELAY_MS);
  }

  /** The crossfader moved: mirror it, and move Ghost Arcade's in deck mode.
   *  Reports from Live push only when its fader actually moved, so the
   *  heartbeat never snaps Ghost Arcade's crossfader back. */
  function applyCrossfader(value: number, fromLive = true) {
    if (!Number.isFinite(value)) return;
    const v = Math.max(0, Math.min(1, value));
    if (fromLive && Math.abs(v - liveCrossfader) <= 0.0005) return;
    liveCrossfader = v;
    if (Math.abs(get(abletonCrossfader) - v) > 0.0005) abletonCrossfader.set(v);
    if (read().deckMode) vjClipLauncher.setCrossfaderValue(v);
  }

  /** Move Live's crossfader from here, and Ghost Arcade's with it. */
  function sendCrossfader(v: number) {
    ownCrossfaderAt = performance.now();
    send({ t: 'crossfader', v });
    applyCrossfader(v, false);
  }

  /** Live reported a value close to one we just sent: it's our own echo. */
  function isEcho(v: number) {
    return performance.now() - ownCrossfaderAt < ECHO_MS && Math.abs(v - get(abletonCrossfader)) < ECHO_RANGE;
  }

  function setTrack(index: number, patch: Partial<LiveTrack>) {
    update(s => {
      if (!s.tracks[index]) return s;
      const tracks = s.tracks.slice();
      tracks[index] = { ...tracks[index], ...patch };
      return { ...s, tracks };
    });
  }

  /** A two-deck set links its decks to Ghost Arcade's by itself, unless
   *  the project turned that off. */
  function autoLinkDecks() {
    const s = read();
    if (deckModeChosen || s.deckMode) return;
    if (!s.tracks.some(t => t.side === 'A') || !s.tracks.some(t => t.side === 'B')) return;
    applyDeckMode(true);
    update(st => ({ ...st, activity: [{ text: "Linked Live's decks to Ghost Arcade's", at: performance.now() }, ...st.activity].slice(0, ACTIVITY_LENGTH) }));
  }

  function applyDeckMode(on: boolean) {
    update(s => ({ ...s, deckMode: on }));
    if (on) {
      vjClipLauncher.setCrossfaderEnabled(true);
      vjClipLauncher.setCrossfaderValue(get(abletonCrossfader));
    }
  }

  function parseSlot(slot: any) {
    if (!Array.isArray(slot)) return null;
    const notes = Array.isArray(slot[3])
      ? (slot[3] as any[]).filter(n => Array.isArray(n) && n.length >= 4).map(n => [Number(n[0]), Number(n[1]), Number(n[2]), Number(n[3])] as ScoreNote)
      : undefined;
    return { name: String(slot[0] ?? ''), color: Number(slot[1]) || 0, length: Number(slot[2]) || 4, ...(notes ? { notes } : {}) };
  }

  const emptyTrack = (): LiveTrack =>
    ({ name: '', color: 0, midi: false, side: null, slots: [], playing: -1, fired: -1, startedBeat: 0, firedBeat: 0 });

  function handle(message: LiveMessage) {
    if (typeof message.beat === 'number' && Number.isFinite(message.beat)) applyClock(message.beat);
    switch (message.t) {
      case 'hello': {
        const wasConnected = read().connected;
        const wasPlaying = read().playing;
        lastHello = performance.now();
        update(s => ({
          ...s,
          connected: true,
          tempo: Number(message.tempo) || s.tempo,
          numerator: Number(message.num) || s.numerator,
          denominator: Number(message.den) || s.denominator,
          playing: !!message.playing,
          quantize: Number.isInteger(message.quantize) ? message.quantize : s.quantize,
        }));
        if (typeof message.xf === 'number' && !isEcho(message.xf)) applyCrossfader(message.xf);
        if (!wasConnected) {
          sentWatch = '';
          send({ t: 'sync' });
          startConductor();
        }
        // Starting from a locator still fires it.
        if (!wasPlaying && message.playing) conductorBeat = read().clockBeat - 0.001;
        if (wasPlaying && !message.playing) {
          releaseAll();
          cancelMix();
        }
        break;
      }
      case 'bye':
        lastHello = 0;
        update(s => ({ ...s, connected: false }));
        stopConductor();
        break;
      case 'set': {
        // Scenes arrive in parts: this one first, the rest as 'scenes'.
        const part = Array.isArray(message.scenes) ? message.scenes : [];
        const total = Number.isInteger(message.count) ? Math.max(part.length, message.count) : part.length;
        const scenes: LiveScene[] = Array.from({ length: total }, (_, index) => {
          const scene = part[index];
          const known = read().scenes[index];
          return scene
            ? { name: String(scene?.n ?? ''), color: Number(scene?.c) || 0, queued: known?.queued ?? false }
            : known ?? { name: '', color: 0, queued: false };
        });
        const cues: LiveCue[] = (Array.isArray(message.cues) ? message.cues : [])
          .filter((c: any) => Array.isArray(c))
          .map((c: any) => ({ name: String(c[0] ?? ''), time: Number(c[1]) || 0 }));
        const count = Math.max(0, Number(message.tracks) || 0);
        update(s => ({
          ...s,
          scenes,
          cues,
          tracks: Array.from({ length: count }, (_, i) => s.tracks[i] ?? emptyTrack()),
        }));
        scheduleRelink();
        break;
      }
      case 'scenes': {
        const offset = Number(message.o);
        if (!Number.isInteger(offset) || !Array.isArray(message.scenes)) break;
        update(s => {
          const scenes = s.scenes.slice();
          message.scenes.forEach((scene: any, i: number) => {
            scenes[offset + i] = { name: String(scene?.n ?? ''), color: Number(scene?.c) || 0, queued: scenes[offset + i]?.queued ?? false };
          });
          return { ...s, scenes };
        });
        scheduleRelink();
        break;
      }
      case 'track': {
        // Slots arrive in parts: this one first, the rest as 'slots'.
        const index = Number(message.i);
        if (!Number.isInteger(index)) break;
        const part = (Array.isArray(message.slots) ? message.slots : []).map(parseSlot);
        const total = Number.isInteger(message.count) ? Math.max(part.length, message.count) : part.length;
        const known = read().tracks[index];
        const playing = Number(message.play) >= 0 ? Number(message.play) : -1;
        const patch: Partial<LiveTrack> = {
          name: String(message.n ?? ''),
          color: Number(message.c) || 0,
          midi: !!message.midi,
          side: message.x === 0 ? 'A' : message.x === 2 ? 'B' : null,
          slots: Array.from({ length: total }, (_, i) => (i < part.length ? part[i] : known?.slots[i] ?? null)),
          playing,
          fired: Number(message.fired) >= 0 ? Number(message.fired) : -1,
        };
        // A clip found already playing: line its loop up with the song.
        if (playing >= 0 && typeof message.pos === 'number' && (known?.playing !== playing || !known?.startedBeat)) {
          patch.startedBeat = songBeat(read()) - message.pos;
        }
        setTrack(index, patch);
        scheduleRelink();
        autoLinkDecks();
        break;
      }
      case 'slots': {
        const index = Number(message.i);
        const offset = Number(message.o);
        if (!Number.isInteger(index) || !Number.isInteger(offset) || !Array.isArray(message.slots)) break;
        const track = read().tracks[index];
        if (!track) break;
        const slots = track.slots.slice();
        message.slots.forEach((slot: any, i: number) => { slots[offset + i] = parseSlot(slot); });
        setTrack(index, { slots });
        scheduleRelink();
        break;
      }
      case 'play': {
        const track = Number(message.i);
        const slot = Number(message.s) >= 0 ? Number(message.s) : -1;
        if (slot >= 0) clipStarted(track, slot);
        else setTrack(track, { playing: -1, fired: -1 });
        break;
      }
      case 'fired': {
        const index = Number(message.i);
        const slot = Number(message.s) >= 0 ? Number(message.s) : -1;
        const track = read().tracks[index];
        if (!track) break;
        // Relaunching the playing clip changes no playing slot: its queue
        // clearing while that same clip plays is the restart.
        if (slot === -1 && track.fired >= 0 && track.fired === track.playing) {
          clipStarted(index, track.fired);
          break;
        }
        if (pendingMix && pendingMix.track === index && slot >= 0 && slot !== pendingMix.slot) pendingMix = null;
        setTrack(index, { fired: slot, firedBeat: read().clockBeat });
        break;
      }
      case 'scene': {
        const index = Number(message.s);
        if (!read().scenes[index]) break;
        const queued = !!message.trig;
        update(s => {
          const scenes = s.scenes.slice();
          scenes[index] = { ...scenes[index], queued };
          return { ...s, scenes };
        });
        // Live clears the trigger the moment the scene launches, or when it
        // is cancelled or replaced. An empty scene can only be told by the
        // clear; otherwise one of its clips must start with it.
        if (!queued) {
          const empty = !read().tracks.some(t => t.slots[index]);
          if (empty) sceneLaunched(index);
          else sceneClears.set(index, performance.now());
        }
        break;
      }
      case 'devices': {
        const track = Number(message.i);
        if (!Number.isInteger(track)) break;
        const devices: LiveDevice[] = (Array.isArray(message.devices) ? message.devices : []).map((d: any) => ({
          name: String(d?.n ?? ''),
          params: (Array.isArray(d?.p) ? d.p : []).map((p: any) => ({ name: String(p?.[0] ?? ''), value: Number(p?.[1]) || 0 })),
        }));
        update(s => ({ ...s, devices: { ...s.devices, [track]: devices } }));
        relinkParams(track, devices);
        syncWatch();
        break;
      }
      case 'xf': {
        const v = Number(message.v);
        if (isEcho(v)) break;
        // Live's own fader moved away from the sweep: the DJ took over.
        if (read().mix && Number.isFinite(lastMixValue) && Math.abs(v - lastMixValue) > ECHO_RANGE) cancelMix();
        applyCrossfader(v);
        break;
      }
      case 'error':
        if (message.what === 'create_score_track') {
          const now = performance.now();
          update(s => ({ ...s, activity: [{ text: "Live couldn't add a track (track limit?)", at: now }, ...s.activity].slice(0, ACTIVITY_LENGTH) }));
        }
        break;
      case 'param':
        paramValues.set(`${message.i}:${message.j}:${message.k}`, Math.max(0, Math.min(1, Number(message.v) || 0)));
        break;
      case 'lvl': {
        const track = Number(message.i);
        const level = Math.max(0, Number(message.v) || 0);
        const range = levelRanges.get(track) ?? { lo: level, hi: level };
        levelRanges.set(track, range);
        levelValues.set(track, autoRange(range, level));
        break;
      }
    }
  }

  async function startListener() {
    const bridge = api();
    if (!bridge) return;
    const result = await bridge.start();
    update(s => ({ ...s, listening: !!result?.ok, error: result?.ok ? null : result?.error ?? null }));
    if (result?.ok) send({ t: 'sync' });
  }

  async function stopListener() {
    await api()?.stop();
    lastHello = 0;
    stopConductor();
    update(s => ({ ...s, listening: false, connected: false }));
  }

  return {
    subscribe,

    initialize() {
      const bridge = api();
      if (!bridge || unsubscribeMessages) return;
      unsubscribeMessages = bridge.onMessage((messages: LiveMessage[]) => {
        for (const message of messages) {
          if (message && typeof message.t === 'string') handle(message);
        }
        confirmScenes();
      });
      unsubscribeStatus = bridge.onStatus((status: { listening: boolean; error: string | null }) => {
        update(s => ({ ...s, listening: status.listening, error: status.error, connected: status.listening && s.connected }));
      });
      watchdog = setInterval(() => {
        if (read().connected && performance.now() - lastHello > CONNECTION_TIMEOUT_MS) {
          update(s => ({ ...s, connected: false }));
          stopConductor();
        }
      }, 1000);
    },

    destroy() {
      unsubscribeMessages?.();
      unsubscribeStatus?.();
      unsubscribeMessages = unsubscribeStatus = null;
      if (watchdog) clearInterval(watchdog);
      if (relinkTimer) clearTimeout(relinkTimer);
      watchdog = relinkTimer = null;
      stopConductor();
    },

    /** Turn the bridge on for this project and start listening. */
    async enable() {
      update(s => ({ ...s, enabled: true }));
      if (!read().listening) await startListener();
    },

    async disable() {
      update(s => ({ ...s, enabled: false }));
      await stopListener();
    },

    resync() {
      send({ t: 'sync' });
    },

    async refreshScript() {
      const script = await api()?.scriptStatus();
      if (script) update(s => ({ ...s, script }));
      return script as ScriptStatus | undefined;
    },

    async installScript(chooseFolder = false) {
      const result = await api()?.installScript({ chooseFolder });
      await this.refreshScript();
      return result as { ok: boolean; path?: string; paths?: string[]; error?: string; canceled?: boolean } | undefined;
    },

    revealScript() {
      void api()?.revealScript();
    },

    // ── Live remote ─────────────────────────────────────────────────

    launchScene(scene: number) {
      send({ t: 'fire_scene', s: scene });
    },
    launchClip(track: number, slot: number) {
      send({ t: 'fire_clip', i: track, s: slot });
    },
    play() {
      send({ t: read().clockBeat > 0 ? 'continue' : 'play' });
    },
    stop() {
      send({ t: 'stop' });
    },
    stopAllClips() {
      send({ t: 'stop_all' });
    },
    stopTrack(track: number) {
      send({ t: 'stop_track', i: track });
    },
    /** Move Live's song position (arrangement locators). */
    jump(beat: number) {
      send({ t: 'jump', time: beat });
    },
    /** Add or remove a locator at Live's song position. */
    toggleLocator() {
      send({ t: 'toggle_cue' });
    },
    /** Add a MIDI track named "Ghost Arcade" to the Live set. */
    createScoreTrack() {
      send({ t: 'create_score_track' });
    },
    /** Ask Live for a track's devices and their parameters. */
    requestDevices(track: number) {
      const now = performance.now();
      if (now - (deviceRequests.get(track) ?? -Infinity) < DEVICE_REQUEST_MS) return;
      deviceRequests.set(track, now);
      send({ t: 'devices', i: track });
    },

    // ── Links ───────────────────────────────────────────────────────

    /** Run a link's visual now, as if Live had launched it. */
    preview(link: AbletonLink) {
      runAction(link.action);
      update(s => ({ ...s, fired: { ...s.fired, [link.id]: performance.now() } }));
    },

    /** Run any visual now. */
    previewAction(action: VisualAction) {
      runAction(action);
    },

    /** Link a visual to a moment in Live. A source shows one column per
     *  deck, one snapshot and one Stage preset, so a new one of those
     *  replaces the old; clip triggers and control hits add up. */
    addLink(source: AbletonSource, action: VisualAction) {
      const link: AbletonLink = { id: generateUUID(), source, action };
      update(s => ({
        ...s,
        links: [...s.links.filter(l => !(samePlace(l.source, source) && replaces(action, l.action))), link],
        missing: s.missing.filter(id => id !== link.id),
      }));
      return link;
    },

    removeLink(id: string) {
      update(s => ({ ...s, links: s.links.filter(l => l.id !== id), missing: s.missing.filter(m => m !== id) }));
    },

    clearLinks() {
      update(s => ({ ...s, links: [], missing: [] }));
    },

    /** Remove every link on one scene, clip or locator. */
    clearSource(source: AbletonSource) {
      update(s => ({ ...s, links: s.links.filter(l => !samePlace(l.source, source)) }));
    },

    /** Scene N launches VJ column N on `deck`, for every scene that fits in
     *  the clip grid. Replaces those scenes' column links; returns how many
     *  scenes were linked. */
    linkScenesToColumns(deck: 'A' | 'B' = 'A'): number {
      const columns = get(vjClipLauncher).numColumns;
      let count = 0;
      update(s => {
        count = Math.min(s.scenes.length, columns);
        // Only the scenes' column links are replaced; other visuals stay.
        const kept = s.links.filter(l => l.source.kind !== 'scene' || l.source.scene >= count || l.action.kind !== 'column');
        const added: AbletonLink[] = Array.from({ length: count }, (_, scene) => ({
          id: generateUUID(),
          source: { kind: 'scene', scene, name: s.scenes[scene].name },
          action: { kind: 'column', deck, column: scene },
        }));
        return { ...s, links: [...kept, ...added] };
      });
      return count;
    },

    /** Mirror the Live grid onto deck `deck`: track N clip M launches VJ
     *  layer N column M, wherever both exist. A track on a side of Live's
     *  crossfader fills that side's deck instead, its first track on layer
     *  1. Replaces those clips' clip links; other visuals on them stay. */
    linkTracksToLayers(deck: 'A' | 'B' = 'A'): number {
      const launcher = get(vjClipLauncher);
      let count = 0;
      update(s => {
        const added: AbletonLink[] = [];
        s.tracks.forEach((track, t) => {
          const target = track.side ?? deck;
          const layer = track.side ? s.tracks.slice(0, t).filter(o => o.side === track.side).length : t;
          const grid = target === 'B' ? launcher.bankBClipGrid : launcher.clipGrid;
          track.slots.forEach((clip, slot) => {
            if (!clip || !grid[layer]?.[slot]) return;
            added.push({
              id: generateUUID(),
              source: { kind: 'clip', track: t, slot, trackName: track.name, name: clip.name },
              action: { kind: 'clip', deck: target, layer, column: slot },
            });
          });
        });
        const kept = s.links.filter(l => l.action.kind !== 'clip' || !added.some(a => samePlace(a.source, l.source)));
        count = added.length;
        return { ...s, links: [...kept, ...added] };
      });
      return count;
    },

    // ── Decks ───────────────────────────────────────────────────────

    /** Link Live's A/B decks to Ghost Arcade's: the crossfader follows
     *  Live's, and Ghost Arcade's two decks go live. */
    setDeckMode(on: boolean) {
      deckModeChosen = true;
      applyDeckMode(on);
    },

    /** Move Live's crossfader (and Ghost Arcade's with it in deck mode).
     *  Taking the fader by hand cancels an auto-mix. */
    setCrossfader(value: number) {
      const v = Math.max(0, Math.min(1, value));
      cancelMix();
      sendCrossfader(v);
    },

    /** Put a Live track on a side of Live's crossfader. */
    assignTrack(track: number, side: 'A' | 'B' | null) {
      send({ t: 'assign', i: track, x: side === 'A' ? 0 : side === 'B' ? 2 : 1 });
    },

    /** Song N on a Live deck plays column N on the matching Ghost Arcade
     *  deck, from its first section on. Replaces the column links on the
     *  decks' clips; other visuals stay. */
    linkDecks(): number {
      const columns = get(vjClipLauncher).numColumns;
      let count = 0;
      update(s => {
        const added: AbletonLink[] = [];
        const perDeck = new Map<number, number>();
        for (const song of deriveSongs(s.scenes, s.tracks)) {
          if (song.kind !== 'clip' || !song.side) continue;
          const column = perDeck.get(song.track) ?? 0;
          perDeck.set(song.track, column + 1);
          if (column >= columns) continue;
          const track = s.tracks[song.track];
          added.push({
            id: generateUUID(),
            source: { kind: 'clip', track: song.track, slot: song.slot, trackName: track.name, name: track.slots[song.slot]?.name ?? '' },
            action: { kind: 'column', deck: song.side, column },
          });
        }
        const onDeck = (l: AbletonLink) => l.source.kind === 'clip' && !!s.tracks[l.source.track]?.side;
        const kept = s.links.filter(l => l.action.kind !== 'column' || !onDeck(l));
        count = added.length;
        return { ...s, links: [...kept, ...added] };
      });
      return count;
    },

    /** Every part of every song gets a column of its own on the song's
     *  deck, in set order: Sunrise's Start, Build, Drop and Outro play
     *  columns 1 to 4, the next song on that deck carries on from 5. So
     *  the visuals change with each part. Replaces the column and clip
     *  links on the decks' clips; returns how many parts were linked. */
    linkSections(): number {
      const columns = get(vjClipLauncher).numColumns;
      let count = 0;
      update(s => {
        const added: AbletonLink[] = [];
        const next = new Map<'A' | 'B', number>();
        for (const song of setlist(s)) {
          if (song.kind !== 'clip' || !song.side) continue;
          const track = s.tracks[song.track];
          for (const section of song.sections) {
            const column = next.get(song.side) ?? 0;
            if (column >= columns) break;
            next.set(song.side, column + 1);
            added.push({
              id: generateUUID(),
              source: { kind: 'clip', track: song.track, slot: section.slot, trackName: track.name, name: track.slots[section.slot]?.name ?? '' },
              action: { kind: 'column', deck: song.side, column },
            });
          }
        }
        const onDeck = (l: AbletonLink) => l.source.kind === 'clip' && !!s.tracks[l.source.track]?.side;
        const kept = s.links.filter(l => (l.action.kind !== 'column' && l.action.kind !== 'clip') || !onDeck(l));
        count = added.length;
        return { ...s, links: [...kept, ...added] };
      });
      return count;
    },

    // ── Setlist ─────────────────────────────────────────────────────

    /** Play a song in Live; it lands on the bar. In deck mode the
     *  crossfader then moves to the song's deck: a sweep over the auto-mix
     *  bars when the other deck is playing, otherwise a cut. */
    playSong(song: SetlistSong) {
      launchSong(song);
    },

    /** Jump to a section of a song (Intro, Build, Drop…). It lands on
     *  Live's launch quantization and loops until the next one. */
    playSection(song: SetlistSong, index: number) {
      launchSection(song, index);
    },

    /** Who moves the set along: 'live' (the DJ), 'song' (each song's
     *  plan) or 'set' (the whole setlist plays itself). */
    setPlayMode(mode: PlayMode) {
      update(s => ({ ...s, playMode: mode, hold: false }));
    },

    /** Keep the section playing now looping until released. */
    setHold(on: boolean) {
      update(s => ({ ...s, hold: on }));
    },

    /** How many bars a section plays before autoplay moves on. */
    setSectionBars(song: SetlistSong, index: number, bars: number) {
      update(s => {
        const plan = sectionPlan(s.songPlans, song);
        plan[index] = Math.max(1, Math.min(256, Math.round(bars)));
        return { ...s, songPlans: { ...s.songPlans, [song.key]: plan } };
      });
    },

    /** Play the next unplayed song in set order. */
    playNext() {
      const s = read();
      const song = nextSong(setlist(s), s.currentSong, new Set(s.played));
      if (song) this.playSong(song);
      return song;
    },

    setSetlistOrder(keys: string[]) {
      update(s => ({ ...s, setlistOrder: keys }));
    },

    setAutoMixBars(bars: number) {
      update(s => ({ ...s, autoMixBars: Math.max(0, Math.min(32, Math.round(bars))) }));
    },

    resetPlayed() {
      update(s => ({ ...s, played: [], currentSong: null }));
    },

    // ── Visual score ────────────────────────────────────────────────

    setScoreTrack(name: string, on: boolean) {
      update(s => ({
        ...s,
        scoreTracks: on ? [...new Set([...s.scoreTracks, name])] : s.scoreTracks.filter(n => n !== name),
      }));
      syncWatch();
    },

    /** Turn the beat scramble on or off, or change its grid, target or
     *  amount. */
    setBeatScramble(patch: Partial<BeatScrambleSettings>) {
      update(s => ({ ...s, beatScramble: sanitizeBeatScramble({ ...s.beatScramble, ...patch }) }));
    },

    /** Scramble what's on screen right now, as the beat scramble would. */
    scrambleNow() {
      const { target, amount } = read().beatScramble;
      scrambleNow(target, amount);
    },

    setScoreLane(pitch: number, action: VisualAction | null) {
      update(s => {
        const scoreMap = { ...s.scoreMap };
        if (action) scoreMap[pitch] = action;
        else delete scoreMap[pitch];
        return { ...s, scoreMap };
      });
    },

    // ── Signals ─────────────────────────────────────────────────────

    addSignal(source: SignalSource, target: SignalTarget) {
      const link: SignalLink = { id: generateUUID(), source, target, invert: false, smooth: source.kind === 'level' ? 0.15 : 0 };
      update(s => ({ ...s, signals: [...s.signals, link] }));
      syncWatch();
      return link;
    },

    updateSignal(id: string, patch: Partial<Pick<SignalLink, 'invert' | 'smooth' | 'target'>>) {
      update(s => ({ ...s, signals: s.signals.map(l => l.id === id ? { ...l, ...patch } : l) }));
      signalState.delete(id);
    },

    removeSignal(id: string) {
      update(s => ({ ...s, signals: s.signals.filter(l => l.id !== id) }));
      signalState.delete(id);
      midiRouter.releaseInputs(`ableton:signal:${id}`);
      syncWatch();
    },

    // ── Project ─────────────────────────────────────────────────────

    hydrate(raw: unknown) {
      const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
      // The set the links were made against; position matching is only
      // trusted when the open set has the same shape.
      const counts = saved.linkedCounts;
      linkedCounts = counts && Number.isInteger(counts.scenes) && Number.isInteger(counts.tracks)
        ? { scenes: counts.scenes, tracks: counts.tracks }
        : null;
      cancelMix();
      releaseAll();
      scorePlayhead.clear();
      const scoreMap: Record<number, VisualAction> = {};
      for (const [pitch, action] of Object.entries(saved.scoreMap ?? {})) {
        const clean = sanitizeAction(action);
        if (clean && Number.isInteger(Number(pitch))) scoreMap[Number(pitch)] = clean;
      }
      update(s => ({
        ...s,
        enabled: !!saved.enabled,
        links: sanitizeLinks(saved.links),
        signals: sanitizeSignals(saved.signals),
        scoreTracks: Array.isArray(saved.scoreTracks) ? saved.scoreTracks.filter((n: unknown) => typeof n === 'string') : [],
        scoreMap,
        beatScramble: sanitizeBeatScramble(saved.beatScramble),
        deckMode: !!saved.deckMode,
        setlistOrder: Array.isArray(saved.setlistOrder) ? saved.setlistOrder.filter((k: unknown) => typeof k === 'string') : [],
        autoMixBars: Number.isFinite(saved.autoMixBars) ? Math.max(0, Math.min(32, saved.autoMixBars)) : 8,
        playMode: saved.playMode === 'song' || saved.playMode === 'set' ? saved.playMode : 'live',
        songPlans: sanitizePlans(saved.songPlans),
        hold: false,
        played: [],
        currentSong: null,
        mix: null,
        missing: [],
        fired: {},
      }));
      signalState.clear();
      deckModeChosen = !!saved.deckModeChosen || !!saved.deckMode;
      if (saved.deckMode) vjClipLauncher.setCrossfaderEnabled(true);
      else autoLinkDecks();
      if (read().scenes.length || read().tracks.length) scheduleRelink();
      if (saved.enabled && !read().listening) void startListener();
    },

    serialize() {
      const { enabled, links, signals, scoreTracks, scoreMap, beatScramble, deckMode, setlistOrder, autoMixBars, playMode, songPlans } = read();
      return { enabled, links, signals, scoreTracks, scoreMap, beatScramble, deckMode, deckModeChosen, setlistOrder, autoMixBars, playMode, songPlans, linkedCounts };
    },

    reset() {
      linkedCounts = null;
      signalState.clear();
      cancelMix();
      releaseAll();
      scorePlayhead.clear();
      update(s => ({
        ...s, enabled: false, links: [], signals: [], scoreTracks: [], scoreMap: {}, beatScramble: DEFAULT_BEAT_SCRAMBLE, deckMode: false,
        setlistOrder: [], autoMixBars: 8, playMode: 'live', songPlans: {}, hold: false,
        played: [], currentSong: null, mix: null, missing: [], fired: {},
      }));
      pendingStops = [];
      outgoingSong = null;
      autoDone.clear();
      deckModeChosen = false;
      syncWatch();
      // The connection stays open across projects, so the open set can
      // link its decks right away.
      autoLinkDecks();
    },
  };
}

export const abletonBridge = createAbletonBridge();

/** Just whether Live is connected: for chrome like the dock button, which
 *  shouldn't wake on every message from Live. */
export const abletonConnected = derived(abletonBridge, s => s.connected);

// A hot reload builds a fresh store; retire the old one's listener and
// timers so links don't fire twice.
if (import.meta.hot) import.meta.hot.dispose(() => abletonBridge.destroy());
