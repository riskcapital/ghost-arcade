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
}
