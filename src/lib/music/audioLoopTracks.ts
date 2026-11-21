/**
 * Audio loop tracks: what the station (loopStation.ts) asks of them. The
 * recorder itself comes with the audio tracks.
 */

export type AudioTrackState = 'empty' | 'armed' | 'record' | 'play' | 'overdub' | 'stopped';

export interface AudioTrackInfo {
  bars: number;
  originBeat: number;
  layers: number;
  redo: number;
}

export interface AudioLoopTracks {
  canRecord(i: number): boolean;
  record(i: number, opts: { startBeat: number; bars: number; free: boolean }): boolean;
  /** Close a recording on its bar (free: the nearest one); the beat it ends on. */
  closeRecording(i: number): number | null;
  cancel(i: number): void;
  overdub(i: number, on: boolean): boolean;
  play(i: number): void;
  stop(i: number, fadeBars: number, now: boolean): void;
  setLevel(i: number, level: number): void;
  undo(i: number): boolean;
  redo(i: number): boolean;
  clear(i: number): void;
  kill(): void;
  clearAll(): void;
  state(i: number): AudioTrackState;
  info(i: number): AudioTrackInfo | null;
  layerCount(i: number): number;
  bars(i: number): number;
  onLayersChanged: ((i: number) => void) | null;
  layersOf(i: number): { layers: Array<[Float32Array, Float32Array]>; bars: number; beatMs: number; originBeat: number; sampleRate: number } | null;
  restoreLayers(i: number, layers: Array<[Float32Array, Float32Array]>, bars: number, beatMs: number, originBeat: number): void;
  /** The input latency applied to recordings, in ms (reported + manual). */
  latencyMs(): number;
  /** Loopback: a click out, heard back on track `i`'s input; the round trip in ms. */
  measureLatency(i: number): Promise<number | null>;
  /** Each layer's shape, `n` peaks 0-1, cached per layer. */
  layerPeaks(i: number, n?: number): Float32Array[];
  /** The loop's shape: `n` peak levels 0–1 across it. */
  peaks(i: number, n: number): number[];
  /** The tempo it was recorded at. */
  bpm(i: number): number;
  /** The loop as it plays, as a WAV file. */
  wav(i: number): Uint8Array | null;
  /** Put a WAV loop of `bars` bars on a track (stopped). */
  load(i: number, wav: Uint8Array, bars: number): Promise<boolean>;
}
