/**
 * AudioWorklet that decodes LTC from one input channel and posts each frame
 * to the main thread. Loaded with `?worker&url` so Vite bundles the decoder
 * into it; see timecodeChase.ts.
 *
 * Messages in:  { type: 'channel', channel } | { type: 'reset' }
 * Messages out: { type: 'frame', frame, lagSamples, sampleRate }
 *               { type: 'level', peak }   about 10 times a second
 *
 * `lagSamples` is how far the end of the block is past the frame's end, so
 * the main thread can back-date the frame to when it really finished.
 */

import { LtcDecoder } from './ltc';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class GhostLtcDecoder extends AudioWorkletProcessor {
  private readonly decoder = new LtcDecoder(sampleRate);
  private channel = 0;
  private peak = 0;
  private sinceLevel = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; channel?: number } | null;
      if (data?.type === 'channel') this.channel = Math.max(0, Math.floor(Number(data.channel) || 0));
      if (data?.type === 'reset') this.decoder.reset();
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const samples = input[Math.min(this.channel, input.length - 1)];
    if (!samples) return true;
    const frames = this.decoder.process(samples);
    const blockEnd = this.decoder.position;
    for (const frame of frames) {
      this.port.postMessage({ type: 'frame', frame, lagSamples: blockEnd - frame.endSample, sampleRate });
    }
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > this.peak) this.peak = a;
    }
    this.sinceLevel += samples.length;
    if (this.sinceLevel >= sampleRate / 10) {
      this.port.postMessage({ type: 'level', peak: this.peak });
      this.peak = 0;
      this.sinceLevel = 0;
    }
    return true;
  }
}

registerProcessor('ghost-ltc-decoder', GhostLtcDecoder);
