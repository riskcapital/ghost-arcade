// Audio analysis broadcast: editor → output windows
//
// Why this exists:
//   Each Electron BrowserWindow runs its own JS context with its own audio
//   analyzer instance. Only the editor window has microphone permission +
//   the user-configured input device, so output windows (SpoutOutputApp,
//   OutputSharedTextureDisplayApp) have a *silent* analyzer. Their ISF
//   shaders read uniforms like `audioLevel`, `audioBass`, `audioFFT`,
//   `audioWaveform` — all zeroed because nothing populates them.
//
//   The user-visible symptom: audio reactivity shows in the editor preview
//   but not on the projector / Spout sender.
//
//   Fix: editor pushes raw analysis bytes (FFT + waveform Float32Arrays,
//   bands, levels, beat state) over a BroadcastChannel. Output windows
//   subscribe, populate their own audioTextures singleton, and shim an
//   `isActive` audio state on the audioStore so the per-shader uniform
//   plumbing in isf/renderer.ts treats audio as live.
//
//   Cost: at 60Hz with 1024-bin FFT + 1024-sample waveform Float32s, this
//   is ~16KB/message ≈ 1MB/s on the channel. Within budget — BroadcastChannel
//   uses structured clone over a shared message bus and is far cheaper than
//   the per-frame canvas-blit the Spout window is already doing.

import type { AudioAnalysis, AudioBands, BeatState } from '../audio/analyzer';

const CHANNEL_NAME = 'ghostarcade-audio-sync';

// Throttle to ~60Hz. Audio analyzer fires faster (every requestAnimationFrame),
// but the cost of posting + receiving + texture update is non-trivial. 60Hz
// matches typical projector refresh and keeps headroom for the actual render.
const BROADCAST_INTERVAL_MS = 1000 / 60;

// ---- Editor side ----

let senderChannel: BroadcastChannel | null = null;
let lastBroadcastAt = 0;

/** Start broadcasting audio analysis from this window. Call once from the
 *  editor's Canvas (or wherever the analyzer feeds audioTextures). Safe to
 *  call multiple times — second call is a no-op. */
export function startAudioBroadcast(): void {
  if (senderChannel) return;
  try {
    senderChannel = new BroadcastChannel(CHANNEL_NAME);
    console.log('[AudioSync] Editor: broadcasting audio analysis');
  } catch (err) {
    console.warn('[AudioSync] BroadcastChannel unavailable:', err);
  }
}

/** Stop broadcasting. Closes the channel. */
export function stopAudioBroadcast(): void {
  if (!senderChannel) return;
  try { senderChannel.close(); } catch { /* */ }
  senderChannel = null;
  lastBroadcastAt = 0;
}

/** Push one frame of analysis to all listeners. The editor's per-frame
 *  audio update loop calls this; we throttle internally. */
export function broadcastAudioFrame(analysis: AudioAnalysis, isActive: boolean): void {
  if (!senderChannel) return;
  const now = performance.now();
  if (now - lastBroadcastAt < BROADCAST_INTERVAL_MS) return;
  lastBroadcastAt = now;
  try {
    senderChannel.postMessage({
      type: 'audio-frame',
      isActive,
      // Float32Arrays clone natively through structured clone — no copy here
      // beyond what BroadcastChannel internally requires.
      fft: analysis.fftData,
      waveform: analysis.waveformData,
      bands: analysis.bands,
      amplitude: analysis.amplitude,
      peak: analysis.peak,
      rms: analysis.rms,
      beat: analysis.beat,
    });
  } catch (err) {
    // Channel might be closed mid-send (window closing). Don't spam.
    console.warn('[AudioSync] broadcast failed:', err);
  }
}

// ---- Receiver side ----

let receiverChannel: BroadcastChannel | null = null;

export interface AudioReceiverHooks {
  /** Called every received frame. Implementer should update audioTextures
   *  and any audioStore state so shaders see live values. */
  onFrame: (frame: ReceivedAudioFrame) => void;
}

export interface ReceivedAudioFrame {
  isActive: boolean;
  fft: Float32Array;
  waveform: Float32Array;
  bands: AudioBands;
  amplitude: number;
  peak: number;
  rms: number;
  beat: BeatState;
}

/** Start receiving audio frames. Call once from output/OSR windows. Returns
 *  a stop function. */
export function startAudioBroadcastReceiver(hooks: AudioReceiverHooks): () => void {
  if (receiverChannel) {
    console.warn('[AudioSync] receiver already started');
    return () => {};
  }
  try {
    receiverChannel = new BroadcastChannel(CHANNEL_NAME);
  } catch (err) {
    console.warn('[AudioSync] BroadcastChannel unavailable on receiver:', err);
    return () => {};
  }
  const ch = receiverChannel;
  ch.onmessage = (ev) => {
    const m = ev.data;
    if (!m || m.type !== 'audio-frame') return;
    try {
      hooks.onFrame({
        isActive: !!m.isActive,
        fft: m.fft,
        waveform: m.waveform,
        bands: m.bands,
        amplitude: m.amplitude,
        peak: m.peak,
        rms: m.rms,
        beat: m.beat,
      });
    } catch (err) {
      console.error('[AudioSync] receiver hook threw:', err);
    }
  };
  console.log('[AudioSync] Receiver started');
  return () => {
    try { ch.close(); } catch { /* */ }
    if (receiverChannel === ch) receiverChannel = null;
  };
}
