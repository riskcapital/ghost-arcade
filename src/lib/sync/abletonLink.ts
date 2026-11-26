/**
 * Ableton Link bridge — renderer side.
 *
 * The Link session lives in the main process (native addon, one
 * instance, own network threads). This store polls `link_get_state`
 * at 4 Hz and bridges tempo BOTH ways:
 *
 *   Link session → app:  session tempo writes audioStore.manualBPM
 *                        (same bridge MIDI clock-in uses), so LFOs
 *                        with bpmSync, quantized clip launches, and
 *                        the header readout all follow the Link peers.
 *   app → Link session:  a USER tempo change (tap tempo, manual BPM
 *                        entry) pushes link_set_tempo so Ghost Arcade
 *                        can drive the session like any Link app.
 *
 * Loop protection: both directions dedupe through `lastBridgedTempo`
 * with an epsilon — our own writes echo back equal and get skipped.
 *
 * Priority note: if MIDI clock-in is ALSO enabled and running, it
 * writes manualBPM too. Link's inbound bridge defers to a running
 * MIDI clock (hardware cable wins over WiFi) — same cascade the
 * clock-out path uses.
 */

import { writable, get } from 'svelte/store';
import { invoke, isElectron } from '$lib/bridge';
import { audioStore } from '../stores/audio';
import { midiStore } from '../midi/midiStore';
import { LinkClockMap } from './linkClock';

export interface AbletonLinkState {
  available: boolean;     // addon built + loadable
  enabled: boolean;       // user toggled on (and main confirmed)
  peers: number;
  tempo: number;
  playing: boolean;
  /** Beat phase 0..quantum at the LAST poll + extrapolation anchor. */
  phase: number;
  quantum: number;
  /** Output trim (ms) on top of the audio device's own latency: Audio Lab's
   *  loops play this much earlier while Link drives the clock. */
  offsetMs: number;
  /** Audio Lab's Start/Stop Sync: the session's transport starts and stops
   *  the studio, and the studio's Play and Stop start and stop the session. */
  startStopSync: boolean;
  error: string | null;
}

/** The session's transport started or stopped. */
export interface LinkTransportChange {
  playing: boolean;
  /** The session's beat (quantum 4) where it started or stopped; null from an addon without it. */
  beat: number | null;
  /** performance.now() of that moment, or null when the clocks are not mapped yet. */
  atMs: number | null;
  peers: number;
}

const INITIAL: AbletonLinkState = {
  available: false,
  enabled: false,
  peers: 0,
  tempo: 120,
  playing: false,
  phase: 0,
  quantum: 4,
  offsetMs: 0,
  startStopSync: false,
  error: null,
};

const STORAGE_KEY = 'ghost-arcade-ableton-link-enabled';
const OFFSET_KEY = 'ghost-arcade-ableton-link-offset-ms';
const START_STOP_KEY = 'ghost-arcade-ableton-link-start-stop-sync';
/** The output trim's range, in ms either way. */
export const LINK_OFFSET_LIMIT_MS = 100;

export function clampLinkOffset(ms: number): number {
  return Number.isFinite(ms) ? Math.max(-LINK_OFFSET_LIMIT_MS, Math.min(LINK_OFFSET_LIMIT_MS, Math.round(ms))) : 0;
}

function savedOffset(): number {
  try {
    return clampLinkOffset(Number(localStorage.getItem(OFFSET_KEY) ?? 0));
  } catch {
    return 0;
  }
}
function savedStartStop(): boolean {
  try {
    return localStorage.getItem(START_STOP_KEY) === '1';
  } catch {
    return false;
  }
}

const POLL_MS = 250;
const TEMPO_EPSILON = 0.01;

function createAbletonLinkStore() {
  const { subscribe, update } = writable<AbletonLinkState>({ ...INITIAL, offsetMs: savedOffset(), startStopSync: savedStartStop() });
  /** Link's clock against performance.now(), from the polls. */
  const clock = new LinkClockMap();
  const transportListeners = new Set<(change: LinkTransportChange) => void>();
  /** The last transport state passed on: a change is told once, from a push or a poll. */
  let lastTransport: { playing: boolean } | null = null;
  let eventsUnsub: (() => void) | null = null;

  function noteTransport(s: any): void {
    const playing = !!s.playing;
    const micros = Number.isFinite(s.playingMicros) ? Number(s.playingMicros) : null;
    const prev = lastTransport;
    lastTransport = { playing };
    // The first reading is where the session is, not a change.
    if (!prev || prev.playing === playing) return;
    const change: LinkTransportChange = {
      playing,
      beat: Number.isFinite(s.playingBeat) ? Number(s.playingBeat) : null,
      atMs: micros === null ? null : clock.toPerfMs(micros),
      peers: Number(s.peers) || 0,
    };
    for (const fn of [...transportListeners]) {
      try { fn(change); } catch (err) { console.warn('[Link] transport listener', err); }
    }
  }

  /** A start/stop or peer change pushed from the main process: no wait for the next poll. */
  function onEvent(ev: any): void {
    if (!ev || !ev.enabled) return;
    const atMs = Number.isFinite(ev.micros) ? clock.toPerfMs(Number(ev.micros)) : null;
    if (atMs !== null && Number.isFinite(ev.beat) && ev.tempo > 0) {
      anchor = { beat: ev.beat, phase: ev.phase, tempo: ev.tempo, quantum: ev.quantum, atMs };
    }
    // Told before the store changes, so a listener still sees the old state there.
    noteTransport(ev);
    update(st => ({
      ...st,
      peers: ev.peers ?? st.peers,
      tempo: ev.tempo ?? st.tempo,
      playing: !!ev.playing,
    }));
  }

  function listenForEvents(): void {
    eventsUnsub?.();
    const on = typeof window !== 'undefined' ? (window as any).electronAPI?.on : null;
    eventsUnsub = typeof on === 'function' ? on('link-event', onEvent) ?? null : null;
  }
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastBridgedTempo: number | null = null;
  let audioUnsub: (() => void) | null = null;
  /** Anchor for beat-phase extrapolation between polls. */
  let anchor: { beat: number; phase: number; tempo: number; quantum: number; atMs: number } | null = null;

  async function poll() {
    try {
      // The state is read somewhere inside the round trip to the main
      // process: stamp it at the midpoint, not on arrival, so the delivery
      // delay does not push the phase late by a few ms on every poll.
      const sent = performance.now();
      const s: any = await invoke('link_get_state');
      const received = performance.now();
      const atMs = (sent + received) / 2;
      if (!s || !s.enabled) return;
      if (Number.isFinite(s.micros)) clock.add({ sentMs: sent, receivedMs: received, micros: Number(s.micros) });
      noteTransport(s);
      anchor = { beat: Number.isFinite(s.beat) ? s.beat : s.phase,
        phase: s.phase, tempo: s.tempo, quantum: s.quantum, atMs };
      update(st => ({
        ...st,
        available: true,
        peers: s.peers ?? 0,
        tempo: s.tempo ?? st.tempo,
        playing: !!s.playing,
        phase: s.phase ?? 0,
        quantum: s.quantum ?? 4,
      }));

      // Link → app. Defer to a RUNNING MIDI clock-in (hardware wins).
      const midi = get(midiStore);
      const midiClockActive = midi.clockInEnabled && midi.clockInRunning;
      if (!midiClockActive && typeof s.tempo === 'number') {
        const rounded = Math.round(s.tempo * 100) / 100;
        if (lastBridgedTempo === null || Math.abs(rounded - lastBridgedTempo) > TEMPO_EPSILON) {
          lastBridgedTempo = rounded;
          audioStore.setManualBPM(rounded);
        }
      }
    } catch {
      // main not ready / addon missing — surfaced via enable()'s error.
    }
  }

  function watchAppTempo() {
    audioUnsub?.();
    // app → Link: user tempo changes (tap / manual entry) push to the
    // session. Our own inbound writes set lastBridgedTempo first, so
    // they no-op here.
    let initialSnapshot = true;
    audioUnsub = audioStore.subscribe(a => {
      // Subscribing emits the existing value immediately; joining is not a user edit.
      if (initialSnapshot) { initialSnapshot = false; return; }
      const st = get({ subscribe });
      if (!st.enabled || a.manualBPM == null) return;
      const bpm = Math.round(a.manualBPM * 100) / 100;
      if (lastBridgedTempo !== null && Math.abs(bpm - lastBridgedTempo) <= TEMPO_EPSILON) return;
      lastBridgedTempo = bpm;
      invoke('link_set_tempo', { bpm }).catch(() => {});
    });
  }

  return {
    subscribe,

    /** Continuous session beats; unlike phaseNow this does not wrap each bar. */
    beatNow(): number {
      if (!anchor) return 0;
      return anchor.beat + (performance.now() - anchor.atMs) / 1000 * (anchor.tempo / 60);
    },

    /** Beat phase 0..quantum extrapolated to "now" from the last poll —
     *  frame-accurate between 4 Hz polls for visual phase consumers. */
    phaseNow(): number {
      if (!anchor) return 0;
      const elapsed = (performance.now() - anchor.atMs) / 1000;
      const beats = elapsed * (anchor.tempo / 60);
      return (anchor.phase + beats) % anchor.quantum;
    },

    /** Hear the session's transport start and stop (from a push, or the next poll). */
    onTransport(fn: (change: LinkTransportChange) => void): () => void {
      transportListeners.add(fn);
      return () => { transportListeners.delete(fn); };
    },

    /** performance.now() at Link clock time `micros`, or null before the first poll. */
    linkTimeToPerfMs(micros: number): number | null {
      return clock.toPerfMs(micros);
    },

    /** Turn Audio Lab's Start/Stop Sync on or off; kept for next time. */
    setStartStopSync(on: boolean): void {
      update(s => ({ ...s, startStopSync: on }));
      try { localStorage.setItem(START_STOP_KEY, on ? '1' : '0'); } catch { /* private mode */ }
    },

    /** Start or stop the session's transport. With `beat` (a bar line on the
     *  session's beats) it starts when the session gets there. */
    async setPlaying(playing: boolean, beat?: number): Promise<boolean> {
      if (!get({ subscribe }).enabled) return false;
      const res: any = playing && beat !== undefined && Number.isFinite(beat)
        ? await invoke('link_set_playing_at_beat', { playing: true, beat, quantum: 4 }).catch(() => null)
        : await invoke('link_set_playing', { playing }).catch(() => null);
      return !!res?.ok;
    },

    /** Set the output trim (clamped to ±LINK_OFFSET_LIMIT_MS; returns what was kept); kept for next time. */
    setOffsetMs(ms: number): number {
      const offsetMs = clampLinkOffset(ms);
      update(s => ({ ...s, offsetMs }));
      try { localStorage.setItem(OFFSET_KEY, String(offsetMs)); } catch { /* private mode */ }
      return offsetMs;
    },

    async enable(): Promise<boolean> {
      if (!isElectron) return false;
      const currentBpm = get(audioStore).manualBPM ?? get(audioStore).bpm ?? 120;
      const res: any = await invoke('link_enable', { bpm: currentBpm }).catch(e => ({ ok: false, error: String(e) }));
      if (!res?.ok) {
        update(s => ({ ...s, enabled: false, error: res?.error ?? 'Link enable failed' }));
        return false;
      }
      lastBridgedTempo = null;
      update(s => ({ ...s, enabled: true, available: true, error: null }));
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(poll, POLL_MS);
      void poll();
      watchAppTempo();
      listenForEvents();
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private mode */ }
      return true;
    },

    async disable(): Promise<void> {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      audioUnsub?.();
      audioUnsub = null;
      eventsUnsub?.();
      eventsUnsub = null;
      clock.clear();
      lastTransport = null;
      anchor = null;
      lastBridgedTempo = null;
      update(s => ({ ...s, enabled: false, peers: 0 }));
      try { localStorage.setItem(STORAGE_KEY, '0'); } catch { /* private mode */ }
      await invoke('link_disable').catch(() => {});
    },

    /** Re-enable on boot if the user had Link on last session. Call
     *  once from app init (no-op when the flag is off). */
    restore(): void {
      try {
        if (localStorage.getItem(STORAGE_KEY) === '1') void this.enable();
      } catch { /* private mode */ }
    },
  };
}

export const abletonLink = createAbletonLinkStore();
