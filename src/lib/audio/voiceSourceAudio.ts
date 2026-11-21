/**
 * Per-source audio for the render core's instruments when they play as Audio
 * Lab voices. A voice follows one sound (a studio part, a Live track or drum);
 * its instrument gets its own audio packet built from that sound: the
 * spectrum and waveform of the sound's mixer channel where it has one (the
 * master where it does not: a Live track, a drum inside the kit), and hits
 * and level from the sound's own notes, so a Strands following the kick
 * launches on kicks only.
 */
import type { AudioAnalysis } from './analyzer';

export interface VoiceSourceAudio {
  /** The sound's own analysis, or null to use the master's spectrum. */
  analysis: AudioAnalysis | null;
  /** The sound's hit flash (vxHit) and how strongly it plays (vxEnv), 0-1. */
  hit: number;
  env: number;
}

type Feed = (key: string) => VoiceSourceAudio | null;
let feed: Feed | null = null;

/** The studio runtime supplies each source's audio. */
export function setVoiceSourceAudioFeed(fn: Feed | null): void {
  feed = fn;
}

export function voiceSourceAudio(key: string): VoiceSourceAudio | null {
  return feed ? feed(key) : null;
}

/** The onset band a source's hits launch in: lows, mids or highs. */
export function sourceHitBand(key: string): 0 | 1 | 2 {
  const id = key.startsWith('live:') ? key.slice(key.lastIndexOf('/') + 1) : key;
  if (['kick', 'bass', 'dubbass', 'drone', 'acid', 'analog', 'bowls'].includes(id)) return 0;
  if (['hats', 'perc', 'fx', 'echo', 'xy'].includes(id)) return 2;
  return 1;
}

/** An analyser's current frame as the fields the packer reads. */
export function analysisFromAnalyser(node: AnalyserNode, master: AudioAnalysis | null): AudioAnalysis {
  const fft = new Float32Array(node.frequencyBinCount);
  node.getFloatFrequencyData(fft);
  const wave = new Float32Array(node.fftSize);
  node.getFloatTimeDomainData(wave);
  let sum = 0;
  for (const x of wave) sum += x * x;
  const rms = Math.sqrt(sum / Math.max(1, wave.length));
  return {
    ...(master ?? {}),
    fftData: fft,
    waveformData: wave,
    amplitude: Math.min(1, rms * 3),
    rms,
  } as AudioAnalysis;
}
