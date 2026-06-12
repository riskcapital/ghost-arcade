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

export interface AbletonLinkState {
  available: boolean;     // addon built + loadable
  enabled: boolean;       // user toggled on (and main confirmed)
  peers: number;
  tempo: number;
  playing: boolean;
  /** Beat phase 0..quantum at the LAST poll + extrapolation anchor. */
  phase: number;
  quantum: number;
  error: string | null;
}

const INITIAL: AbletonLinkState = {
  available: false,
  enabled: false,
  peers: 0,
  tempo: 120,
  playing: false,
  phase: 0,
  quantum: 4,
  error: null,
};

const STORAGE_KEY = 'ghost-arcade-ableton-link-enabled';
const POLL_MS = 250;
const TEMPO_EPSILON = 0.01;

function createAbletonLinkStore() {
  const { subscribe, update, set } = writable<AbletonLinkState>({ ...INITIAL });
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastBridgedTempo: number | null = null;
  let audioUnsub: (() => void) | null = null;
  /** Anchor for beat-phase extrapolation between polls. */
  let anchor: { phase: number; tempo: number; quantum: number; atMs: number } | null = null;

  async function poll() {
    try {
      const s: any = await invoke('link_get_state');
      if (!s || !s.enabled) return;
      anchor = { phase: s.phase, tempo: s.tempo, quantum: s.quantum, atMs: performance.now() };
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
    audioUnsub = audioStore.subscribe(a => {
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

    /** Beat phase 0..quantum extrapolated to "now" from the last poll —
     *  frame-accurate between 4 Hz polls for visual phase consumers. */
    phaseNow(): number {
      if (!anchor) return 0;
      const elapsed = (performance.now() - anchor.atMs) / 1000;
      const beats = elapsed * (anchor.tempo / 60);
      return (anchor.phase + beats) % anchor.quantum;
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
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private mode */ }
      return true;
    },

    async disable(): Promise<void> {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      audioUnsub?.();
      audioUnsub = null;
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
