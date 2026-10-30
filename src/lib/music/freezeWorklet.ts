/**
 * Keeps the last few seconds of what it hears, so a freeze can take a
 * moment of the band (or the studio) and hold it as a texture. Asked for a
 * snapshot, it posts the most recent samples, oldest first.
 */

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const SECONDS = 4;

class FreezeCaptureProcessor extends AudioWorkletProcessor {
  private ring: Float32Array;
  private write = 0;
  private filled = 0;

  constructor() {
    super();
    this.ring = new Float32Array(Math.ceil(sampleRate * SECONDS));
    this.port.onmessage = (event: MessageEvent<{ type: 'snapshot'; seconds: number; id: number }>) => {
      if (event.data?.type !== 'snapshot') return;
      const want = Math.min(this.filled, Math.max(1, Math.round(event.data.seconds * sampleRate)));
      const out = new Float32Array(want);
      let read = (this.write - want + this.ring.length) % this.ring.length;
      for (let i = 0; i < want; i++) {
        out[i] = this.ring[read];
        read = read + 1 === this.ring.length ? 0 : read + 1;
      }
      this.port.postMessage({ id: event.data.id, samples: out, sampleRate }, [out.buffer]);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    const channels = input.length;
    for (let i = 0; i < frames; i++) {
      let v = 0;
      for (let c = 0; c < channels; c++) v += input[c][i];
      this.ring[this.write] = v / channels;
      this.write = this.write + 1 === this.ring.length ? 0 : this.write + 1;
    }
    this.filled = Math.min(this.ring.length, this.filled + frames);
    return true;
  }
}

registerProcessor('ghost-freeze-capture', FreezeCaptureProcessor);
