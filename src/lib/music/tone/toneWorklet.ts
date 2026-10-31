/**
 * The tone engine in an AudioWorklet: one processor per instrument, a
 * polyphonic tone engine or a drum kit, played by timed messages.
 */

import { DrumEngine, ToneEngine, softClip } from './toneDsp';
import type { ToneMessage } from './toneTypes';

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

class GhostToneProcessor extends AudioWorkletProcessor {
  private engine: ToneEngine | DrumEngine;

  constructor(options?: { processorOptions?: { kind?: string } }) {
    super(options);
    this.engine = options?.processorOptions?.kind === 'drums' ? new DrumEngine(sampleRate) : new ToneEngine(sampleRate);
    this.port.onmessage = (e: MessageEvent<ToneMessage | ToneMessage[]>) => {
      const list = Array.isArray(e.data) ? e.data : [e.data];
      for (const msg of list) this.engine.message(msg, currentTime);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    this.engine.process(L, R, L.length, currentTime);
    // A last soft ceiling, so a stack of resonant voices can never hard-clip the bus. A value
    // that is not a number would stick in the bus compressor and silence the whole studio,
    // so a block that has one is dropped and the engine starts clean.
    let bad = false;
    for (let i = 0; i < L.length; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) {
        bad = true;
        break;
      }
    }
    if (bad) {
      L.fill(0);
      if (R !== L) R.fill(0);
      this.engine.message({ t: 'panic' }, currentTime);
      return true;
    }
    for (let i = 0; i < L.length; i++) {
      if (L[i] > 0.9 || L[i] < -0.9) L[i] = softClip(L[i]);
      if (R !== L && (R[i] > 0.9 || R[i] < -0.9)) R[i] = softClip(R[i]);
    }
    return true;
  }
}

registerProcessor('ghost-tone', GhostToneProcessor);
