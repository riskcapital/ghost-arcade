// Audio Reactive Store
// Svelte store that bridges the AudioAnalyzer engine to reactive UI and VJ systems
// Provides real-time audio data, beat events, and BPM for the entire app

import { writable, derived, get } from 'svelte/store';
import { audioAnalyzer, type AudioAnalysis, type AudioBands, type BeatState, type BandKickSnare } from '../audio/analyzer';

// Cache raw analysis for audio texture updates (textures need Float32Array data)
let _lastRawAnalysis: AudioAnalysis | null = null;
export function getLastRawAnalysis(): AudioAnalysis | null {
  return _lastRawAnalysis;
}

// Audio input source configuration
export type AudioInputType = 'none' | 'microphone' | 'file' | 'system';

/** Minimal shape we need from MediaDeviceInfo, kept separate so the store
 *  doesn't leak the full DOM type to consumers that don't want it. */
export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface AudioState {
  // Connection
  inputType: AudioInputType;
  isActive: boolean;
  error: string | null;

  // Device selection (for `microphone` input type)
  availableInputDevices: AudioInputDevice[];
  preferredInputDeviceId: string | null;  // null → system default

  // Real-time analysis data (updated every frame)
  bands: AudioBands;
  amplitude: number;
  peak: number;
  rms: number;

  // Beat (energy-based, generic)
  beat: BeatState;

  // Kick + snare onsets (band-specific) — fire on a frame when the band's
  // energy spikes above its rolling average. Useful for visual events that
  // should react ONLY to the kick or ONLY to the snare, not both.
  kickSnare: {
    isKick: boolean;
    kickIntensity: number;
    timeSinceLastKick: number;
    isSnare: boolean;
    snareIntensity: number;
    timeSinceLastSnare: number;
  };

  // Per-band gain multipliers (8 real bands; the synthetic `high` alias is
  // derived). Lets users boost the kick band or cut harsh treble without
  // touching the global sensitivity. 1.0 = unity, range 0..3.
  bandGain: {
    sub: number;
    bass: number;
    lowMid: number;
    mid: number;
    highMid: number;
    treble: number;
    air: number;
    presence: number;
  };

  // BPM
  bpm: number;
  bpmConfidence: number;
  beatPhase: number;

  // Spectral centroid (0-1, brightness/timbre)
  spectralCentroid: number;

  // Manual BPM override (tap tempo)
  manualBPM: number | null;  // null = use auto-detected
  tapTimes: number[];        // timestamps for tap tempo

  // Settings
  sensitivity: number;   // 0-2 multiplier for all bands
  smoothing: number;      // 0-1 smoothing factor
}

const PREFERRED_INPUT_KEY = 'ghostarcade.audio.preferredInputDeviceId';

function loadPreferredInputDeviceId(): string | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFERRED_INPUT_KEY) : null;
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function savePreferredInputDeviceId(id: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (id) localStorage.setItem(PREFERRED_INPUT_KEY, id);
    else localStorage.removeItem(PREFERRED_INPUT_KEY);
  } catch {}
}

function createDefaultState(): AudioState {
  return {
    inputType: 'none',
    isActive: false,
    error: null,
    availableInputDevices: [],
    preferredInputDeviceId: loadPreferredInputDeviceId(),
    bands: { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, air: 0, presence: 0, high: 0 },
    amplitude: 0,
    peak: 0,
    rms: 0,
    beat: { isBeat: false, beatIntensity: 0, timeSinceLastBeat: 0, beatCount: 0 },
    kickSnare: {
      isKick: false, kickIntensity: 0, timeSinceLastKick: 0,
      isSnare: false, snareIntensity: 0, timeSinceLastSnare: 0,
    },
    bandGain: { sub: 1, bass: 1, lowMid: 1, mid: 1, highMid: 1, treble: 1, air: 1, presence: 1 },
    bpm: 0,
    bpmConfidence: 0,
    beatPhase: 0,
    spectralCentroid: 0,
    manualBPM: null,
    tapTimes: [],
    sensitivity: 1.0,
    smoothing: 0.3,
  };
}

function createAudioStore() {
  const { subscribe, update } = writable<AudioState>(createDefaultState());

  // Wire up the analyzer callback. Each frame we apply the global
  // sensitivity multiplier AND the per-band gain (so users can boost the
  // kick or cut harsh treble independently). The legacy `high` band is
  // re-derived as the average of the gained treble+air+presence so old
  // shaders that read `bands.high` reflect the user's tuning.
  audioAnalyzer.setCallback((analysis: AudioAnalysis) => {
    _lastRawAnalysis = analysis; // Cache for audio texture manager
    update(state => {
      const sens = state.sensitivity;
      const g = state.bandGain;
      const gainedSub      = Math.min(1, analysis.bands.sub      * sens * g.sub);
      const gainedBass     = Math.min(1, analysis.bands.bass     * sens * g.bass);
      const gainedLowMid   = Math.min(1, analysis.bands.lowMid   * sens * g.lowMid);
      const gainedMid      = Math.min(1, analysis.bands.mid      * sens * g.mid);
      const gainedHighMid  = Math.min(1, analysis.bands.highMid  * sens * g.highMid);
      const gainedTreble   = Math.min(1, analysis.bands.treble   * sens * g.treble);
      const gainedAir      = Math.min(1, analysis.bands.air      * sens * g.air);
      const gainedPresence = Math.min(1, analysis.bands.presence * sens * g.presence);
      return {
        ...state,
        bands: {
          sub: gainedSub,
          bass: gainedBass,
          lowMid: gainedLowMid,
          mid: gainedMid,
          highMid: gainedHighMid,
          treble: gainedTreble,
          air: gainedAir,
          presence: gainedPresence,
          // Synthetic legacy alias — re-derived from gained values so old
          // shaders see consistent behavior with the EQ tweaks panel.
          high: (gainedTreble + gainedAir + gainedPresence) / 3,
        },
        amplitude: Math.min(1, analysis.amplitude * sens),
        peak: Math.min(1, analysis.peak * sens),
        rms: analysis.rms,
        beat: analysis.beat,
        kickSnare: analysis.kickSnare,
        bpm: state.manualBPM ?? analysis.bpm,
        bpmConfidence: state.manualBPM ? 1.0 : analysis.bpmConfidence,
        beatPhase: analysis.beatPhase,
        spectralCentroid: analysis.spectralCentroid,
      };
    });
  });

  return {
    subscribe,

    /** Start listening to microphone. Uses the store's preferredInputDeviceId
     *  if set; pass `null` to force the system default, or a specific id to
     *  override for this session only (doesn't touch the stored preference). */
    async startMicrophone(deviceIdOverride?: string | null) {
      const state = get({ subscribe });
      const deviceId = deviceIdOverride !== undefined ? deviceIdOverride : state.preferredInputDeviceId;
      try {
        update(s => ({ ...s, error: null, inputType: 'microphone' }));
        await audioAnalyzer.startMicrophone(deviceId);
        update(s => ({ ...s, isActive: true }));
        // Once we have a live stream the browser reveals real device labels
        // (labels are empty until the user has granted permission at least
        // once), so refresh the list so the picker UI can show names.
        void this.refreshInputDevices();
      } catch (err: any) {
        // If a specific device was requested and it's gone, fall back to the
        // system default rather than leaving the user stuck — clear the
        // stored preference so the next toggle doesn't repeat the failure.
        const msg = err?.message || 'Microphone access denied';
        if (deviceId && /OverconstrainedError|Requested device not found|NotFoundError/i.test(String(err))) {
          savePreferredInputDeviceId(null);
          update(s => ({ ...s, preferredInputDeviceId: null, error: `Input device not available (${msg}), falling back to default`, isActive: false, inputType: 'none' }));
          try {
            await audioAnalyzer.startMicrophone(null);
            update(s => ({ ...s, error: null, isActive: true, inputType: 'microphone' }));
            void this.refreshInputDevices();
            return;
          } catch (fallbackErr: any) {
            update(s => ({ ...s, error: fallbackErr?.message || msg, isActive: false, inputType: 'none' }));
            return;
          }
        }
        update(s => ({ ...s, error: msg, isActive: false, inputType: 'none' }));
      }
    },

    /** Enumerate audio input devices and update the store's device list.
     *  Labels require a live getUserMedia grant — before the user has clicked
     *  the mic button once, MediaDeviceInfo.label is an empty string. We
     *  substitute a generic placeholder so the picker still functions, and
     *  real names appear on the next refresh after the mic has been started. */
    async refreshInputDevices() {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const all = await navigator.mediaDevices.enumerateDevices();
        const inputs: AudioInputDevice[] = all
          .filter(d => d.kind === 'audioinput')
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Input ${i + 1}`,
          }));
        update(s => ({ ...s, availableInputDevices: inputs }));
      } catch (err) {
        console.warn('[audio] enumerateDevices failed:', err);
      }
    },

    /** Select a preferred input device. Persists to localStorage and, if the
     *  mic is currently live, swaps streams in place. Pass null to return to
     *  the system default. */
    async setPreferredInputDevice(deviceId: string | null) {
      savePreferredInputDeviceId(deviceId);
      const wasActive = get({ subscribe }).inputType === 'microphone' && get({ subscribe }).isActive;
      update(s => ({ ...s, preferredInputDeviceId: deviceId }));
      if (wasActive) {
        await audioAnalyzer.stop();
        await this.startMicrophone(deviceId);
      }
    },

    /** Start analyzing a media element */
    async startMediaElement(element: HTMLAudioElement | HTMLVideoElement) {
      try {
        update(s => ({ ...s, error: null, inputType: 'file' }));
        await audioAnalyzer.startMediaElement(element);
        update(s => ({ ...s, isActive: true }));
      } catch (err: any) {
        update(s => ({ ...s, error: err.message || 'Failed to analyze media', isActive: false, inputType: 'none' }));
      }
    },

    /** Start analyzing system/desktop audio (DAW, Spotify, etc.) */
    async startSystemAudio() {
      try {
        update(s => ({ ...s, error: null, inputType: 'system' }));
        await audioAnalyzer.startSystemAudio();
        update(s => ({ ...s, isActive: true }));
      } catch (err: any) {
        update(s => ({ ...s, error: err.message || 'System audio capture failed', isActive: false, inputType: 'none' }));
      }
    },

    /** Stop audio analysis */
    async stop() {
      await audioAnalyzer.stop();
      update(s => ({
        ...createDefaultState(),
        sensitivity: s.sensitivity,
        smoothing: s.smoothing,
        manualBPM: s.manualBPM,
        // Keep the device list warm and the user's device preference
        // across start/stop cycles — toggling the mic off shouldn't
        // forget which device they picked.
        availableInputDevices: s.availableInputDevices,
        preferredInputDeviceId: s.preferredInputDeviceId,
      }));
    },

    /** Tap tempo - call this on each tap */
    tapTempo() {
      const now = performance.now();
      update(state => {
        let taps = [...state.tapTimes, now];

        // Remove taps older than 3 seconds
        taps = taps.filter(t => now - t < 3000);

        if (taps.length < 2) {
          return { ...state, tapTimes: taps };
        }

        // Calculate average interval
        const intervals: number[] = [];
        for (let i = 1; i < taps.length; i++) {
          intervals.push(taps[i] - taps[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const bpm = Math.round(60000 / avgInterval);

        // Clamp to reasonable range
        const clampedBPM = Math.max(30, Math.min(300, bpm));

        return {
          ...state,
          tapTimes: taps,
          manualBPM: clampedBPM,
          bpm: clampedBPM,
          bpmConfidence: 1.0,
        };
      });
    },

    /** Clear manual BPM (return to auto-detection) */
    clearManualBPM() {
      update(s => ({ ...s, manualBPM: null, tapTimes: [] }));
    },

    /** Set manual BPM directly */
    setManualBPM(bpm: number) {
      update(s => ({ ...s, manualBPM: Math.max(30, Math.min(300, bpm)), bpm: Math.max(30, Math.min(300, bpm)), bpmConfidence: 1.0 }));
    },

    /** Set sensitivity multiplier */
    setSensitivity(value: number) {
      update(s => ({ ...s, sensitivity: Math.max(0, Math.min(3, value)) }));
    },

    /** Set smoothing */
    setSmoothing(value: number) {
      audioAnalyzer.setSmoothing(value);
      update(s => ({ ...s, smoothing: value }));
    },

    /** Set per-band gain (0..3 multiplier). Applied on top of the global
     *  sensitivity. 1.0 = unity (no boost / no cut). */
    setBandGain(band: keyof AudioState['bandGain'], value: number) {
      const clamped = Math.max(0, Math.min(3, value));
      update(s => ({ ...s, bandGain: { ...s.bandGain, [band]: clamped } }));
    },

    /** Reset every per-band gain back to 1.0 — useful as a "panic" button
     *  when the user wants to start fresh on the EQ. */
    resetBandGain() {
      update(s => ({
        ...s,
        bandGain: { sub: 1, bass: 1, lowMid: 1, mid: 1, highMid: 1, treble: 1, air: 1, presence: 1 },
      }));
    },

    /** Get current state snapshot */
    getState(): AudioState {
      return get({ subscribe });
    },

    /**
     * Get a MediaStream containing the current audio output for recording.
     * Returns { stream, cleanup } or null if no audio source is active.
     * Caller MUST call cleanup() when done recording.
     */
    getAudioStream(): { stream: MediaStream; cleanup: () => void } | null {
      return audioAnalyzer.getAudioStream();
    },

    /**
     * Inject an audio frame received over BroadcastChannel from the editor
     * window. Used by output / Spout OSR windows that have no microphone
     * access of their own. Populates _lastRawAnalysis so getLastRawAnalysis()
     * works for the audioTextures upload, and writes bands / amplitude /
     * beat into the store so any UI or shader uniform that reads
     * $audioStore sees live values.
     *
     * No-op in windows where a real analyzer has already produced a frame —
     * the local analyzer always wins. Output windows never start the
     * analyzer, so the receiver feeds them exclusively.
     */
    injectBroadcastedFrame(frame: {
      isActive: boolean;
      fft: Float32Array;
      waveform: Float32Array;
      bands: AudioBands;
      amplitude: number;
      peak: number;
      rms: number;
      beat: BeatState;
      kickSnare: BandKickSnare;
      bpm: number;
      bpmConfidence: number;
      beatPhase: number;
      spectralCentroid: number;
    }): void {
      _lastRawAnalysis = {
        fftData: frame.fft as unknown as Float32Array<ArrayBuffer>,
        waveformData: frame.waveform as unknown as Float32Array<ArrayBuffer>,
        bands: frame.bands,
        amplitude: frame.amplitude,
        peak: frame.peak,
        rms: frame.rms,
        beat: frame.beat,
        kickSnare: frame.kickSnare,
        bpm: frame.bpm,
        bpmConfidence: frame.bpmConfidence,
        beatPhase: frame.beatPhase,
        spectralCentroid: frame.spectralCentroid,
      } as AudioAnalysis;
      update(state => ({
        ...state,
        isActive: frame.isActive,
        bands: frame.bands,
        amplitude: frame.amplitude,
        peak: frame.peak,
        rms: frame.rms,
        beat: frame.beat,
        kickSnare: frame.kickSnare,
        bpm: frame.bpm,
        bpmConfidence: frame.bpmConfidence,
        beatPhase: frame.beatPhase,
        spectralCentroid: frame.spectralCentroid,
      }));
    },
  };
}

export const audioStore = createAudioStore();

// Derived: is a beat happening right now?
export const isBeat = derived(audioStore, $a => $a.beat.isBeat);

// Derived: current BPM (manual or auto)
export const currentBPM = derived(audioStore, $a => $a.bpm);

// Derived: beat phase (0-1 smooth ramp between beats)
export const beatPhase = derived(audioStore, $a => $a.beatPhase);

// Derived: frequency bands
export const audioBands = derived(audioStore, $a => $a.bands);
