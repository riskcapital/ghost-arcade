// Native audio for the visuals on the iPhone and iPad app (GhostAudio.swift).
// The app analyses one source at a time (the microphone without stopping other
// apps' music, its own player, or other apps' sound through a screen broadcast)
// exactly like the web AnalyserNode, and this module reads those analysis frames
// from ghostcapture://audio/frame for StandaloneAudio.

export type AudioSourceKind = 'off' | 'mic' | 'player' | 'phone';
export type AudioTrack = { id: string; name: string; duration: number };
export type NativeAudioStatus = {
  source: AudioSourceKind;
  arriving: boolean;
  playing: boolean;
  loop: boolean;
  tracks: AudioTrack[];
  trackId?: string;
  position?: number;
  /** Seconds since the screen broadcast last sent sound; missing when it never has. */
  phoneSilentFor?: number;
  added?: number;
  skipped?: string[];
};
export type AudioFrame = {
  sequence: number;
  source: AudioSourceKind;
  sampleRate: number;
  arriving: boolean;
  spectrum: Uint8Array<ArrayBuffer>;
  waveform: Uint8Array<ArrayBuffer>;
};

const MAGIC = 0x47414146; // "GAAF"
const HEADER = 20;
export const AUDIO_BINS = 512;
export const AUDIO_WAVE = 1024;
const SOURCES: AudioSourceKind[] = ['off', 'mic', 'player', 'phone'];

/** One analysis frame: header, 512 spectrum bytes, 1024 waveform bytes. */
export function parseAudioFrame(buffer: ArrayBuffer): AudioFrame {
  if (buffer.byteLength !== HEADER + AUDIO_BINS + AUDIO_WAVE) throw new Error('Incomplete audio frame.');
  const view = new DataView(buffer);
  const code = view.getUint32(8, true);
  if (view.getUint32(0, true) !== MAGIC || code < 1 || code > 3) throw new Error('Invalid audio frame.');
  return {
    sequence: view.getUint32(4, true),
    source: SOURCES[code],
    sampleRate: view.getFloat32(12, true),
    arriving: (view.getUint32(16, true) & 1) === 1,
    spectrum: new Uint8Array(buffer, HEADER, AUDIO_BINS),
    waveform: new Uint8Array(buffer, HEADER + AUDIO_BINS, AUDIO_WAVE),
  };
}

type Cap = { getPlatform?: () => string; nativePromise?: (plugin: string, method: string, args: Record<string, unknown>) => Promise<unknown> };
const cap = () => (globalThis as unknown as { Capacitor?: Cap }).Capacitor;
/** The installed iPhone or iPad app analyses audio natively; elsewhere the web microphone is used. */
export const hasNativeAudio = () => cap()?.getPlatform?.() === 'ios' && !!cap()?.nativePromise;
function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const c = cap();
  if (!hasNativeAudio() || !c?.nativePromise) return Promise.reject(new Error('This audio source needs the iPhone or iPad app.'));
  return c.nativePromise('StudioCapture', method, args) as Promise<T>;
}

export const nativeAudioStatus = () => call<NativeAudioStatus>('audioStatus');
export type PlayerAction = 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'loop';
export const audioPlayer = (action: PlayerAction, options: { id?: string; position?: number; loop?: boolean } = {}) =>
  call<NativeAudioStatus>('audioPlayer', { action, ...options });
/** Pick audio files or videos (their soundtrack is used) to add to the player. */
export const importAudioTracks = () => call<NativeAudioStatus>('audioImport');
export const removeAudioTrack = (id: string) => call<NativeAudioStatus>('audioRemoveTrack', { id });
/** Show the system sheet that starts the screen broadcast carrying other apps' sound. */
export const startPhoneAudio = () => call<void>('audioPhoneBroadcast');

/** A listener's hold on the native source. */
export type NativeAudioHandle = { frame(): AudioFrame | null; release(): void };

// Every listener shares one poll of the native frames. The source is the one most
// recently asked for; it switches off when the last listener lets go.
let users = 0;
let current: AudioSourceKind = 'off';
let latest: AudioFrame | null = null;
let latestAt = 0;
let polling = false;
let serial: Promise<unknown> = Promise.resolve();
function queue<T>(task: () => Promise<T>): Promise<T> {
  const next = serial.then(task, task);
  serial = next.catch(() => {});
  return next;
}

const listening = () => users > 0 && current !== 'off';

async function poll() {
  if (!listening()) { polling = false; return; }
  if (typeof document === 'undefined' || !document.hidden) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 1000);
    try {
      const response = await fetch('ghostcapture://audio/frame', { cache: 'no-store', signal: abort.signal });
      if (response.status === 200) { latest = parseAudioFrame(await response.arrayBuffer()); latestAt = performance.now(); }
      else latest = null;
    } catch { /* the next poll tries again; stale frames read as silence */ }
    finally { clearTimeout(timeout); }
  }
  if (listening()) setTimeout(() => void poll(), 16);
  else polling = false;
}

function startPolling() {
  if (polling) return;
  polling = true;
  void poll();
}

/** Switch the native source and hold it until `release`. Rejects with the app's message (for example a declined microphone). */
export function acquireNativeAudio(source: Exclude<AudioSourceKind, 'off'>): Promise<NativeAudioHandle> {
  return queue(async () => {
    if (current !== source) {
      await call<NativeAudioStatus>('audioSetSource', { source });
      current = source;
      latest = null;
    }
    users++;
    startPolling();
    let released = false;
    return {
      frame: () => (!released && latest && performance.now() - latestAt < 1000 ? latest : null),
      release: () => {
        if (released) return;
        released = true;
        users = Math.max(0, users - 1);
        // Wait a moment before switching off: the visuals restarting take the
        // source back at once, and the player should not stop for that.
        setTimeout(() => void queue(async () => {
          if (users > 0 || current === 'off') return;
          current = 'off';
          latest = null;
          // A pending poll sees no listeners and stops on its own.
          await call('audioSetSource', { source: 'off' }).catch(() => {});
        }), 500);
      },
    };
  });
}

/** The source the visuals hear right now (shared by every screen). */
export const nativeAudioSource = () => current;
