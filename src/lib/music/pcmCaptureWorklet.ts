/**
 * Records what it hears as plain PCM, for WAV files: it posts its two
 * channels in blocks of about a quarter second until told to stop.
 */

declare const sampleRate: number;
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

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ stop?: boolean }>) => {
      if (!e.data?.stop) return;
      this.flush();
      this.on = false;
      this.port.postMessage({ done: true, sampleRate });
    };
  }

  private flush(): void {
    if (!this.fill) return;
    this.port.postMessage({ left: this.left.slice(0, this.fill), right: this.right.slice(0, this.fill) });
    this.fill = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    const input = inputs[0];
    const l = input?.[0];
    const r = input?.[1] ?? l;
    const n = l?.length ?? 128;
    for (let i = 0; i < n; i++) {
      this.left[this.fill] = l ? l[i] : 0;
      this.right[this.fill] = r ? r[i] : 0;
      if (++this.fill === BLOCK) this.flush();
    }
    return true;
  }
}

registerProcessor('ghost-pcm-capture', PcmCaptureProcessor);

export {};
