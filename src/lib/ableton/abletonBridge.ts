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

import { get, writable } from 'svelte/store';
import { generateUUID } from '../utils/uuid';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { snapshots } from '../stores/snapshots';
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
import { deriveSongs, mixPosition, nextSong, orderSongs, type SetlistSong } from './abletonSetlist';

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
  /** Live's A/B decks drive Ghost Arcade's decks and crossfader (saved). */
  deckMode: boolean;
  /** Song keys in the DJ's set order (saved). */
  setlistOrder: string[];
  /** Bars an auto-mix takes to sweep the crossfader; 0 cuts (saved). */
  autoMixBars: number;
  // Runtime only.
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
  /** Live's crossfader, 0 = full A, 1 = full B. */
  crossfader: number;
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
  deckMode: false,
  setlistOrder: [],
  autoMixBars: 8,
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
  crossfader: 0.5,
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
    const firing = state.tracks.find(t => t.fired === s);
    if (scene.queued || firing) consider(scene.name || `Scene ${s + 1}`, firing?.firedBeat ?? beat, linksForScene(state.links, s));
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

/** Live values per signal (0..1, after smoothing) for meters. */
export const abletonSignalLevels = writable<Record<string, number>>({});
/** Last time each score pitch fired (performance.now()), for lane flashes. */
export const abletonScoreHits = writable<Record<number, number>>({});

type LiveMessage = Record<string, any> & { t: string };

const api = () => (typeof window !== 'undefined' ? (window as any).ghostAbleton : undefined);

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
  /** Scenes whose trigger cleared in the batch being handled. */
  let launchedScenes: number[] = [];
  let sceneQueuedInBatch = false;
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
  /** A deck song waiting to land before the crossfader moves to it. */
  let pendingMix: { track: number; slot: number; side: 'A' | 'B'; bars: number; title: string } | null = null;
  let lastMixSentAt = 0;
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
    else {
      const value = action.release + (action.value - action.release) * (velocity / 127);
      const inputId = hold?.inputId ?? `ableton:hit:${action.path}`;
      midiRouter.dispatchPath(action.path, value, { inputId });
      if (hold) releases.push({ beat: hold.untilBeat, path: action.path, value: action.release, inputId });
      else setTimeout(() => midiRouter.dispatchPath(action.path, action.release, { inputId }), HIT_MS);
    }
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

  /** Mark the song a launch belongs to as played and current. */
  function markPlayed(match: (song: SetlistSong) => boolean) {
    const song = deriveSongs(read().scenes, read().tracks).find(match);
    if (!song) return;
    update(s => ({ ...s, currentSong: song.key, played: s.played.includes(song.key) ? s.played : [...s.played, song.key] }));
  }

  /** A deck song landed: start moving the crossfader to its side. */
  function startMix(mix: NonNullable<typeof pendingMix>) {
    const s = read();
    const perBar = s.numerator * (4 / s.denominator);
    update(st => ({
      ...st,
      mix: { from: st.crossfader, to: mix.side === 'A' ? 0 : 1, startBeat: st.clockBeat, beats: mix.bars * perBar, title: mix.title },
    }));
  }

  function sceneLabel(index: number) {
    return read().scenes[index]?.name || `Scene ${index + 1}`;
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
    const beat = songBeat(s, now);

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

    if (s.mix && now - lastMixSentAt >= 30) {
      lastMixSentAt = now;
      const v = mixPosition(s.mix.from, s.mix.to, s.mix.startBeat, s.mix.beats, beat);
      send({ t: 'crossfader', v });
      applyCrossfader(v);
      if (v === s.mix.to) update(st => ({ ...st, mix: null }));
    }

    if (now - lastSignalAt >= SIGNAL_MS && s.signals.length) {
      const dt = Math.min(0.1, (now - lastSignalAt) / 1000);
      lastSignalAt = now;
      driveSignals(s, beat, dt, now);
    }
  }

  function playNotes(s: AbletonBridgeState, t: number, track: LiveTrack, due: { note: ScoreNote; at: number }[], columns: number) {
    const hits: Record<number, number> = {};
    const now = performance.now();
    for (const { note, at } of due) {
      const [pitch, , duration, velocity] = note;
      const action = scoreAction(s, pitch, columns);
      if (!action) continue;
      runAction(action, velocity, { untilBeat: track.startedBeat + at + duration, inputId: `ableton:score:${t}:${pitch}` });
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

  /** Live's crossfader moved: mirror it, and move Ghost Arcade's in deck mode. */
  function applyCrossfader(value: number) {
    if (!Number.isFinite(value)) return;
    const v = Math.max(0, Math.min(1, value));
    if (Math.abs(read().crossfader - v) > 0.0005) update(s => ({ ...s, crossfader: v }));
    if (read().deckMode) vjClipLauncher.setCrossfaderValue(v);
  }

  function setTrack(index: number, patch: Partial<LiveTrack>) {
    update(s => {
      if (!s.tracks[index]) return s;
      const tracks = s.tracks.slice();
      tracks[index] = { ...tracks[index], ...patch };
      return { ...s, tracks };
    });
  }

  function parseSlot(slot: any) {
    if (!Array.isArray(slot)) return null;
    const notes = Array.isArray(slot[3])
      ? (slot[3] as any[]).filter(n => Array.isArray(n) && n.length >= 4).map(n => [Number(n[0]), Number(n[1]), Number(n[2]), Number(n[3])] as ScoreNote)
      : undefined;
    return { name: String(slot[0] ?? ''), color: Number(slot[1]) || 0, length: Number(slot[2]) || 4, ...(notes ? { notes } : {}) };
  }

  function handle(message: LiveMessage) {
    if (typeof message.beat === 'number' && Number.isFinite(message.beat)) {
      const beat = message.beat;
      update(s => ({ ...s, clockBeat: beat, clockAt: performance.now() }));
    }
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
        if (typeof message.xf === 'number') applyCrossfader(message.xf);
        if (!wasConnected) {
          sentWatch = '';
          send({ t: 'sync' });
          startConductor();
        }
        if (wasPlaying && !message.playing) releaseAll();
        break;
      }
      case 'bye':
        lastHello = 0;
        update(s => ({ ...s, connected: false }));
        stopConductor();
        break;
      case 'set': {
        const scenes: LiveScene[] = (Array.isArray(message.scenes) ? message.scenes : []).map((scene: any, index: number) => ({
          name: String(scene?.n ?? ''),
          color: Number(scene?.c) || 0,
          queued: read().scenes[index]?.queued ?? false,
        }));
        const cues: LiveCue[] = (Array.isArray(message.cues) ? message.cues : [])
          .filter((c: any) => Array.isArray(c))
          .map((c: any) => ({ name: String(c[0] ?? ''), time: Number(c[1]) || 0 }));
        const count = Math.max(0, Number(message.tracks) || 0);
        update(s => ({
          ...s,
          scenes,
          cues,
          tracks: Array.from({ length: count }, (_, i) => s.tracks[i]
            ?? { name: '', color: 0, midi: false, side: null, slots: [], playing: -1, fired: -1, startedBeat: 0, firedBeat: 0 }),
        }));
        scheduleRelink();
        break;
      }
      case 'track': {
        const index = Number(message.i);
        if (!Number.isInteger(index)) break;
        setTrack(index, {
          name: String(message.n ?? ''),
          color: Number(message.c) || 0,
          midi: !!message.midi,
          side: message.x === 0 ? 'A' : message.x === 2 ? 'B' : null,
          slots: (Array.isArray(message.slots) ? message.slots : []).map(parseSlot),
          playing: Number(message.play) >= 0 ? Number(message.play) : -1,
          fired: Number(message.fired) >= 0 ? Number(message.fired) : -1,
        });
        scheduleRelink();
        break;
      }
      case 'play': {
        const track = Number(message.i);
        const slot = Number(message.s) >= 0 ? Number(message.s) : -1;
        setTrack(track, { playing: slot, fired: -1, startedBeat: read().clockBeat });
        if (slot >= 0) {
          const t = read().tracks[track];
          const clip = t?.slots[slot];
          if (clip) colorValues.set(track, colorHue(clip.color));
          markPlayed(song => song.kind === 'clip' && song.track === track && song.slot === slot);
          if (pendingMix && pendingMix.track === track && pendingMix.slot === slot) {
            startMix(pendingMix);
            pendingMix = null;
          }
          fire(linksForClip(read().links, track, slot), `${t?.name || `Track ${track + 1}`} · ${clip?.name || 'Clip'}`);
        }
        break;
      }
      case 'fired': {
        setTrack(Number(message.i), { fired: Number(message.s) >= 0 ? Number(message.s) : -1, firedBeat: read().clockBeat });
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
        // Live clears the trigger the moment the scene launches. With the
        // transport stopped it launches at once and only the clear arrives.
        if (queued) sceneQueuedInBatch = true;
        else launchedScenes.push(index);
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
      case 'xf':
        applyCrossfader(Number(message.v));
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
        launchedScenes = [];
        sceneQueuedInBatch = false;
        for (const message of messages) {
          if (message && typeof message.t === 'string') handle(message);
        }
        // A trigger that clears while another scene queues was replaced,
        // not launched.
        if (!sceneQueuedInBatch) {
          for (const scene of launchedScenes) {
            const color = read().scenes[scene]?.color;
            if (color) colorValues.set(-1, colorHue(color));
            markPlayed(song => song.kind === 'scenes' && song.sections[0]?.scene === scene);
            fire(linksForScene(read().links, scene), sceneLabel(scene));
          }
        }
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
      return result as { ok: boolean; path?: string; error?: string; canceled?: boolean } | undefined;
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

    addLink(source: AbletonSource, action: VisualAction) {
      const link: AbletonLink = { id: generateUUID(), source, action };
      update(s => ({ ...s, links: [...s.links, link], missing: s.missing.filter(id => id !== link.id) }));
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
     *  the clip grid. Replaces those scenes' existing links. */
    linkScenesToColumns(deck: 'A' | 'B' = 'A') {
      const columns = get(vjClipLauncher).numColumns;
      update(s => {
        const count = Math.min(s.scenes.length, columns);
        const kept = s.links.filter(l => l.source.kind !== 'scene' || l.source.scene >= count);
        const added: AbletonLink[] = Array.from({ length: count }, (_, scene) => ({
          id: generateUUID(),
          source: { kind: 'scene', scene, name: s.scenes[scene].name },
          action: { kind: 'column', deck, column: scene },
        }));
        return { ...s, links: [...kept, ...added] };
      });
    },

    /** Mirror the Live grid onto deck `deck`: track N clip M launches VJ
     *  layer N column M, wherever both exist. Replaces those clips' links. */
    linkTracksToLayers(deck: 'A' | 'B' = 'A') {
      const launcher = get(vjClipLauncher);
      const grid = deck === 'B' ? launcher.bankBClipGrid : launcher.clipGrid;
      update(s => {
        const added: AbletonLink[] = [];
        s.tracks.forEach((track, t) => track.slots.forEach((clip, slot) => {
          if (!clip || !grid[t]?.[slot]) return;
          added.push({
            id: generateUUID(),
            source: { kind: 'clip', track: t, slot, trackName: track.name, name: clip.name },
            action: { kind: 'clip', deck, layer: t, column: slot },
          });
        }));
        const kept = s.links.filter(l => !added.some(a => samePlace(a.source, l.source)));
        return { ...s, links: [...kept, ...added] };
      });
    },

    // ── Decks ───────────────────────────────────────────────────────

    /** Link Live's A/B decks to Ghost Arcade's: the crossfader follows
     *  Live's, and Ghost Arcade's two decks go live. */
    setDeckMode(on: boolean) {
      update(s => ({ ...s, deckMode: on }));
      if (on) {
        vjClipLauncher.setCrossfaderEnabled(true);
        vjClipLauncher.setCrossfaderValue(read().crossfader);
      }
    },

    /** Move Live's crossfader (and Ghost Arcade's with it in deck mode).
     *  Taking the fader by hand cancels an auto-mix. */
    setCrossfader(value: number) {
      const v = Math.max(0, Math.min(1, value));
      pendingMix = null;
      if (read().mix) update(s => ({ ...s, mix: null }));
      send({ t: 'crossfader', v });
      applyCrossfader(v);
    },

    /** Put a Live track on a side of Live's crossfader. */
    assignTrack(track: number, side: 'A' | 'B' | null) {
      send({ t: 'assign', i: track, x: side === 'A' ? 0 : side === 'B' ? 2 : 1 });
    },

    /** Song N on a Live deck plays column N on the matching Ghost Arcade
     *  deck. Replaces those clips' links. */
    linkDecks() {
      const columns = get(vjClipLauncher).numColumns;
      update(s => {
        const added: AbletonLink[] = [];
        s.tracks.forEach((track, t) => {
          if (!track.side) return;
          track.slots.forEach((clip, slot) => {
            if (!clip || slot >= columns) return;
            added.push({
              id: generateUUID(),
              source: { kind: 'clip', track: t, slot, trackName: track.name, name: clip.name },
              action: { kind: 'column', deck: track.side!, column: slot },
            });
          });
        });
        const kept = s.links.filter(l => !added.some(a => samePlace(a.source, l.source)));
        return { ...s, links: [...kept, ...added] };
      });
    },

    // ── Setlist ─────────────────────────────────────────────────────

    /** Play a song in Live; it lands on the bar. In deck mode the
     *  crossfader then moves to the song's deck: a sweep over the auto-mix
     *  bars when the other deck is playing, otherwise a cut. */
    playSong(song: SetlistSong) {
      if (song.kind === 'scenes') {
        if (song.sections[0]) send({ t: 'fire_scene', s: song.sections[0].scene });
        return;
      }
      send({ t: 'fire_clip', i: song.track, s: song.slot });
      const s = read();
      if (!s.deckMode || !song.side) return;
      const otherPlaying = s.tracks.some(t => t.side && t.side !== song.side && t.playing >= 0);
      pendingMix = { track: song.track, slot: song.slot, side: song.side, bars: otherPlaying ? s.autoMixBars : 0, title: song.title };
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
      linkedCounts = null;
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
        deckMode: !!saved.deckMode,
        setlistOrder: Array.isArray(saved.setlistOrder) ? saved.setlistOrder.filter((k: unknown) => typeof k === 'string') : [],
        autoMixBars: Number.isFinite(saved.autoMixBars) ? Math.max(0, Math.min(32, saved.autoMixBars)) : 8,
        played: [],
        currentSong: null,
        mix: null,
        missing: [],
        fired: {},
      }));
      signalState.clear();
      if (saved.deckMode) vjClipLauncher.setCrossfaderEnabled(true);
      if (read().scenes.length || read().tracks.length) scheduleRelink();
      if (saved.enabled && !read().listening) void startListener();
    },

    serialize() {
      const { enabled, links, signals, scoreTracks, scoreMap, deckMode, setlistOrder, autoMixBars } = read();
      return { enabled, links, signals, scoreTracks, scoreMap, deckMode, setlistOrder, autoMixBars };
    },

    reset() {
      linkedCounts = null;
      signalState.clear();
      releaseAll();
      update(s => ({
        ...s, enabled: false, links: [], signals: [], scoreTracks: [], scoreMap: {}, deckMode: false,
        setlistOrder: [], played: [], currentSong: null, mix: null, missing: [], fired: {},
      }));
      syncWatch();
    },
  };
}

export const abletonBridge = createAbletonBridge();
