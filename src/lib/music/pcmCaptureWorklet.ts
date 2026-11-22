/**
 * Records what it hears as plain PCM, for WAV files: it posts its two
 * channels in blocks of about a quarter second.
 *
 * Every capture of a take is told the same start frame and, at stop, the
 * same stop frame on the audio clock, and keeps exactly the frames in
 * [start, stop): the mix and all its stems start together and hold the same
 * number of samples.
 */

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const BLOCK = 12288;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private left = new Float32Array(BLOCK);
  private right = new Float32Array(BLOCK);
  private fill = 0;
  private on = true;
  private start = Infinity;
  private stop = Infinity;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ start?: number; stop?: number }>) => {
      if (typeof e.data?.start === 'number') this.start = e.data.start;
      if (typeof e.data?.stop === 'number') this.stop = Math.max(this.start === Infinity ? 0 : this.start, e.data.stop);
    };
  }

  private flush(): void {
    if (!this.fill) return;
    this.port.postMessage({ left: this.left.slice(0, this.fill), right: this.right.slice(0, this.fill) });
    this.fill = 0;
  }

  private finish(): void {
    this.flush();
    this.on = false;
    this.port.postMessage({ done: true, sampleRate });
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    const input = inputs[0];
    const l = input?.[0];
    const r = input?.[1] ?? l;
    const n = l?.length ?? 128;
    for (let i = 0; i < n; i++) {
      const frame = currentFrame + i;
      if (frame >= this.stop) {
        this.finish();
        return false;
      }
      if (frame < this.start) continue;
      this.left[this.fill] = l ? l[i] : 0;
      this.right[this.fill] = r ? r[i] : 0;
      if (++this.fill === BLOCK) this.flush();
    }
    return true;
  }
}

registerProcessor('ghost-pcm-capture', PcmCaptureProcessor);

export {};
