/**
 * Analyse a song (tempo, beats, sections) in a worker, so a long mix does
 * not freeze the app: on the main thread a 1 h file blocked it for over a
 * second. The samples go over in slices, a few at a time, so neither side
 * holds a second copy of the whole song. The result is exactly
 * analyzeSong()'s. Where no worker can be started (tests, or a worker that
 * fails to load) the analysis runs here instead, with the same result.
 */
import { analyzeSong, songIsAnalysable, type SongAnalysis, type SongAnalysisOptions } from './songLayout';
import type { SongAnalysisReply, SongAnalysisRequest } from './songAnalysisProtocol';

/** Samples per slice: 8 MB of float32, a whole number of analysis frames. */
export const SONG_ANALYSIS_CHUNK = 512 * 4096;
/** Slices sent ahead of the worker's acknowledgements. */
const IN_FLIGHT = 4;

export interface SongAnalysisWorker {
  postMessage(message: SongAnalysisRequest, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SongAnalysisReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

function startWorker(): SongAnalysisWorker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./songAnalysis.worker.ts', import.meta.url), { type: 'module' }) as unknown as SongAnalysisWorker;
  } catch (err) {
    console.warn('[SongAnalysis] worker unavailable, analysing on the main thread:', err);
    return null;
  }
}

export function analyzeSongOffThread(
  mono: Float32Array,
  sampleRate: number,
  options: SongAnalysisOptions = {},
  makeWorker: () => SongAnalysisWorker | null = startWorker,
): Promise<SongAnalysis> {
  if (!songIsAnalysable(mono.length, sampleRate)) return Promise.resolve(analyzeSong(mono, sampleRate, options));
  const worker = makeWorker();
  if (!worker) return Promise.resolve().then(() => analyzeSong(mono, sampleRate, options));
  return new Promise<SongAnalysis>((resolve, reject) => {
    const total = mono.length;
    let next = 0;
    let inFlight = 0;
    let acked = false;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      fn();
    };
    const pump = () => {
      while (inFlight < IN_FLIGHT && next < total) {
        const end = Math.min(total, next + SONG_ANALYSIS_CHUNK);
        // A copy of just this slice, handed over without another copy.
        const samples = mono.slice(next, end);
        worker.postMessage({ type: 'chunk', samples }, [samples.buffer]);
        next = end;
        inFlight++;
      }
      if (next >= total && inFlight === 0) worker.postMessage({ type: 'finish' });
    };
    worker.onmessage = (event) => {
      const reply = event.data;
      if (reply.type === 'ack') {
        acked = true;
        inFlight--;
        pump();
      } else if (reply.type === 'done') {
        finish(() => resolve(reply.analysis));
      } else {
        finish(() => reject(new Error(reply.message)));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      // A worker that never ran (it failed to load): analyse here instead.
      if (!acked) {
        console.warn('[SongAnalysis] worker failed, analysing on the main thread:', event.message);
        finish(() => {
          try {
            resolve(analyzeSong(mono, sampleRate, options));
          } catch (err) {
            reject(err);
          }
        });
      } else {
        finish(() => reject(new Error(event.message || 'song analysis worker failed')));
      }
    };
    worker.postMessage({ type: 'start', length: total, sampleRate, options });
    pump();
  });
}
