/**
 * Records the band for the looper (bandLooper.ts). Asked for the frames
 * from one point of the audio clock to another (a bar line to a bar line),
 * it fills the buffers it is handed with exactly those frames, counted by
 * `currentFrame`, and hands them back when the last one has gone by. The
 * first half second goes back early as well, so the loop can start on the
 * bar line where the recording ends before the rest has arrived.
 *
 * It keeps the last half second as it goes, so a request that reaches it
 * just after its start still starts on the bar.
 *
 * Messages in:  { type: 'record', id, start, end, channels, head }
 *                 (two Float32Arrays of end - start frames, and two of the
 *                 head's length, transferred)
 *               { type: 'end', id, end }   stop sooner, at this frame
 *               { type: 'cancel', id }
 * Messages out: { type: 'head', id, channels }
 *               { type: 'take', id, start, end, channels, missed }
 *                 (missed: frames at the start that had already gone by)
 */

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const RING_SECONDS = 0.5;
const QUANTUM = 128;

interface Take {
  id: number;
  start: number;
  end: number;
  channels: Float32Array[];
  head: Float32Array[] | null;
  missed: number;
}

class LooperCaptureProcessor extends AudioWorkletProcessor {
  private readonly ring: Float32Array[];
  private ringWrite = 0;
  /** The frame just after the newest one in the ring, and how many it holds. */
  private ringEnd = -1;
  private ringFilled = 0;
  private take: Take | null = null;
  /** Let go by the page: the next process() call ends the processor. */
  private done = false;

  constructor() {
    super();
    const size = Math.ceil(sampleRate * RING_SECONDS);
    this.ring = [new Float32Array(size), new Float32Array(size)];
    this.port.onmessage = (event: MessageEvent) => this.onMessage(event.data);
  }

  private onMessage(data: { type?: string; id?: number; start?: number; end?: number; channels?: Float32Array[]; head?: Float32Array[] } | null): void {
    if (!data) return;
    if (data.type === 'dispose') {
      this.done = true;
      this.take = null;
    } else if (data.type === 'record') {
      const start = Math.round(Number(data.start));
      const end = Math.round(Number(data.end));
      const channels = data.channels;
      if (!(end > start) || !channels || channels.length !== 2 || channels.some((c) => c.length < end - start)) return;
      const head = data.head && data.head.length === 2 ? data.head : null;
      const take: Take = { id: Number(data.id), start, end, channels, head, missed: 0 };
      this.backfill(take);
      this.take = take;
      this.post(this.ringEnd);
    } else if (data.type === 'end' && this.take && this.take.id === data.id) {
      this.take.end = Math.max(this.take.start + 1, Math.min(this.take.end, Math.round(Number(data.end))));
      this.post(this.ringEnd);
    } else if (data.type === 'cancel' && this.take && this.take.id === data.id) {
      this.take = null;
    }
  }

  /** Frames of a new take that have already gone by come from the ring. */
  private backfill(take: Take): void {
    if (this.ringEnd < 0) return;
    const oldest = this.ringEnd - this.ringFilled;
    take.missed = Math.max(0, Math.min(take.end, oldest, this.ringEnd) - take.start);
    const from = Math.max(take.start, oldest);
    const to = Math.min(take.end, this.ringEnd);
    const size = this.ring[0].length;
    for (let f = from; f < to; f++) {
      const r = (((this.ringWrite - (this.ringEnd - f)) % size) + size) % size;
      this.write(take, f - take.start, this.ring[0][r], this.ring[1][r]);
    }
  }

  private write(take: Take, i: number, left: number, right: number): void {
    take.channels[0][i] = left;
    take.channels[1][i] = right;
    if (take.head && i < take.head[0].length) {
      take.head[0][i] = left;
      take.head[1][i] = right;
    }
  }

  /** Hand back the head once it is recorded, and the take once its last frame has gone by. */
  private post(frameNow: number): void {
    const take = this.take;
    if (!take) return;
    if (take.head && frameNow >= take.start + take.head[0].length) {
      const head = take.head;
      take.head = null;
      this.port.postMessage({ type: 'head', id: take.id, channels: head }, [head[0].buffer, head[1].buffer]);
    }
    if (frameNow < take.end) return;
    this.take = null;
    const { id, start, end, channels, missed } = take;
    this.port.postMessage({ type: 'take', id, start, end, channels, missed }, [channels[0].buffer, channels[1].buffer]);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    const left = input[0];
    const right = input[1] ?? left;
    const frames = left?.length ?? QUANTUM;
    const first = currentFrame;
    const size = this.ring[0].length;
    // A gap in the clock (the node was not run for a while): what the ring holds is not just before now.
    if (first !== this.ringEnd) this.ringFilled = 0;
    for (let i = 0; i < frames; i++) {
      this.ring[0][this.ringWrite] = left ? left[i] : 0;
      this.ring[1][this.ringWrite] = right ? right[i] : 0;
      this.ringWrite = this.ringWrite + 1 === size ? 0 : this.ringWrite + 1;
    }
    this.ringEnd = first + frames;
    this.ringFilled = Math.min(size, this.ringFilled + frames);
    const take = this.take;
    if (take && left) {
      const from = Math.max(take.start, first);
      const to = Math.min(take.end, first + frames);
      for (let f = from; f < to; f++) this.write(take, f - take.start, left[f - first], right[f - first]);
    }
    this.post(this.ringEnd);
    // An active processor is never collected while it asks to keep running.
    return !this.done;
  }
}

registerProcessor('ghost-looper-capture', LooperCaptureProcessor);

// A module, so the declarations above stay its own.
export {};
