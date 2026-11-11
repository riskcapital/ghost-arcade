/**
 * The song analysis as a worker runs it: the samples arrive a slice at a
 * time and only the envelope is kept, so the worker never holds the whole
 * song. Shared by the worker (songAnalysis.worker.ts) and the tests.
 */
import { SongEnvelopeBuilder, analyzeSongEnvelope, songIsAnalysable, type Envelope, type SongAnalysis, type SongAnalysisOptions } from './songLayout';

export type SongAnalysisRequest =
  /** `envelope`: answer with the envelope itself (for the song features)
   *  instead of the tempo/section analysis. */
  | { type: 'start'; length: number; sampleRate: number; options?: SongAnalysisOptions; envelope?: boolean }
  | { type: 'chunk'; samples: Float32Array }
  | { type: 'finish' };

export type SongAnalysisReply =
  | { type: 'ack' }
  | { type: 'done'; analysis: SongAnalysis }
  | { type: 'envelope'; envelope: Envelope }
  | { type: 'error'; message: string };

/** One analysis job: feed it the requests in order; it answers through `reply`. */
export function createSongAnalysisJob(reply: (message: SongAnalysisReply, transfer?: Transferable[]) => void): (request: SongAnalysisRequest) => void {
  let start: Extract<SongAnalysisRequest, { type: 'start' }> | null = null;
  let builder: SongEnvelopeBuilder | null = null;
  return (request) => {
    try {
      if (request.type === 'start') {
        start = request;
        builder = request.envelope || songIsAnalysable(request.length, request.sampleRate) ? new SongEnvelopeBuilder(request.length, request.sampleRate) : null;
      } else if (request.type === 'chunk') {
        builder?.push(request.samples);
        reply({ type: 'ack' });
      } else {
        if (!start) throw new Error('song analysis finished before it started');
        if (start.envelope && builder) {
          const envelope = builder.finish();
          builder = null;
          const arrays = [envelope.onset, envelope.beatOnset, envelope.lowOnset, envelope.midOnset, ...envelope.bands];
          reply({ type: 'envelope', envelope }, [...new Set(arrays.map((a) => a.buffer))]);
          return;
        }
        reply({ type: 'done', analysis: analyzeSongEnvelope(builder?.finish() ?? null, start.length, start.sampleRate, start.options) });
        builder = null;
      }
    } catch (err) {
      reply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };
}
