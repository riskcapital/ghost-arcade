/**
 * Runs one sample-by-sample studio effect (fxDsp.ts) on the audio thread.
 * The node is created with `processorOptions: { kind }`; settings arrive on
 * the port as `{ values, tempo }` and are smoothed inside the effect.
 */

import { FX_DSP, type FxDsp, type FxDspKind, type Values } from './fxDsp';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

class StudioFxProcessor extends AudioWorkletProcessor {
  private fx: FxDsp | null;
  private silent = new Float32Array(128);

  constructor(options: { processorOptions?: { kind?: FxDspKind } }) {
    super(options);
    const kind = options.processorOptions?.kind;
    this.fx = kind && FX_DSP[kind] ? new FX_DSP[kind](sampleRate) : null;
    this.port.onmessage = (event: MessageEvent<{ values: Values; tempo: number }>) => {
      if (event.data?.values) this.fx?.set(event.data.values, event.data.tempo);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const n = out[0].length;
    if (this.silent.length < n) this.silent = new Float32Array(n);
    const input = inputs[0] ?? [];
    // With nothing connected the effect still runs on silence, so tails ring out.
    const inL = input[0] ?? this.silent;
    const inR = input[1] ?? inL;
    const outL = out[0];
    const outR = out[1] ?? out[0];
    if (!this.fx) {
      outL.set(inL);
      if (outR !== outL) outR.set(inR);
      return true;
    }
    this.fx.process(inL, inR, outL, outR, n);
    return true;
  }
}

registerProcessor('ga-studio-fx', StudioFxProcessor);
