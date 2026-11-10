/**
 * The song analysis runs in a worker fed a slice at a time. Whatever the
 * slicing, the result is exactly analyzeSong()'s on the whole song.
 */
import { describe, expect, it } from 'vitest';
import { analyzeSong, SongEnvelopeBuilder, analyzeSongEnvelope } from './songLayout';
import { createSongAnalysisJob, type SongAnalysisReply, type SongAnalysisRequest } from './songAnalysisProtocol';
import { analyzeSongOffThread, SONG_ANALYSIS_CHUNK, type SongAnalysisWorker } from './songAnalysisClient';

const RATE = 22050;

/** Kick-like thumps at `bpm` with a little noise, `seconds` long (plus a few odd samples). */
function song(seconds: number, bpm: number, seed = 3): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE) + 37);
  let s = seed;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = 0.02 * (s / 0xffffffff - 0.5);
  }
  const period = 60 / bpm;
  for (let t = 0.1; t < seconds; t += period) {
    const start = Math.round(t * RATE);
    for (let i = 0; i < 0.06 * RATE && start + i < out.length; i++) out[start + i] += 0.8 * Math.exp(-i / (0.012 * RATE)) * Math.sin((2 * Math.PI * 70 * i) / RATE);
  }
  // A louder second half: a section change.
  for (let i = Math.floor(out.length / 2); i < out.length; i++) out[i] *= 1.8;
  return out;
}

/** A worker that runs the job in this thread, a message at a time. */
class InProcessWorker implements SongAnalysisWorker {
  onmessage: ((event: MessageEvent<SongAnalysisReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  chunks: number[] = [];
  maxInFlight = 0;
  private inFlight = 0;
  terminated = false;
  private job = createSongAnalysisJob((reply) => {
    if (reply.type === 'ack') this.inFlight--;
    queueMicrotask(() => this.onmessage?.({ data: reply } as MessageEvent<SongAnalysisReply>));
  });
  postMessage(message: SongAnalysisRequest, transfer?: Transferable[]) {
    if (message.type === 'chunk') {
      this.chunks.push(message.samples.length);
      expect(transfer).toEqual([message.samples.buffer]);
      this.inFlight++;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    }
    setTimeout(() => this.job(message), 0);
  }
  terminate() { this.terminated = true; }
}

describe('song analysis off the main thread', () => {
  it('gives the same envelope analysis however the samples are sliced', () => {
    const mono = song(40, 126);
    const whole = analyzeSong(mono, RATE);
    expect(whole.tempo).not.toBeNull();
    for (const sizes of [[1], [511, 513, 1000], [4096], [77777]]) {
      const builder = new SongEnvelopeBuilder(mono.length, RATE);
      let at = 0;
      for (let k = 0; at < mono.length; k++) {
        const n = sizes[k % sizes.length];
        builder.push(mono.subarray(at, Math.min(mono.length, at + n)));
        at += n;
      }
      expect(analyzeSongEnvelope(builder.finish(), mono.length, RATE)).toEqual(whole);
    }
  });

  it('analyses in a worker, a few slices at a time, with analyzeSong()\'s result', async () => {
    const mono = song(130, 97, 9);
    const worker = new InProcessWorker();
    const result = await analyzeSongOffThread(mono, RATE, {}, () => worker);
    expect(result).toEqual(analyzeSong(mono, RATE));
    expect(worker.chunks.reduce((a, b) => a + b, 0)).toBe(mono.length);
    expect(Math.max(...worker.chunks)).toBe(SONG_ANALYSIS_CHUNK);
    expect(worker.maxInFlight).toBeLessThanOrEqual(4);
    expect(worker.terminated).toBe(true);
  });

  it('analyses here when no worker starts or it fails to load', async () => {
    const mono = song(20, 140);
    expect(await analyzeSongOffThread(mono, RATE, {}, () => null)).toEqual(analyzeSong(mono, RATE));
    const broken: SongAnalysisWorker = {
      onmessage: null,
      onerror: null,
      postMessage() { setTimeout(() => this.onerror?.({ message: 'load failed', preventDefault() {} } as ErrorEvent), 0); },
      terminate() {},
    };
    expect(await analyzeSongOffThread(mono, RATE, {}, () => broken)).toEqual(analyzeSong(mono, RATE));
    // No Worker in this environment: the default falls back the same way.
    expect(await analyzeSongOffThread(mono, RATE)).toEqual(analyzeSong(mono, RATE));
  });

  it('reports an analysis error from the worker', async () => {
    const failing: SongAnalysisWorker = {
      onmessage: null,
      onerror: null,
      postMessage(message: SongAnalysisRequest) {
        if (message.type === 'start') setTimeout(() => this.onmessage?.({ data: { type: 'error', message: 'boom' } } as MessageEvent<SongAnalysisReply>), 0);
      },
      terminate() {},
    };
    await expect(analyzeSongOffThread(song(10, 120), RATE, {}, () => failing)).rejects.toThrow('boom');
  });
});
