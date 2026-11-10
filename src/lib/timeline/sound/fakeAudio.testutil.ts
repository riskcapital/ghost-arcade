/**
 * A stand-in AudioContext for tests: every create* gives a node that
 * connects and holds AudioParams that remember their last value and
 * scheduled calls. Enough for the studio's effect units and the sound rows.
 */
export class FakeParam {
  value: number;
  calls: Array<[string, number, number?]> = [];
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v: number, t: number) { this.value = v; this.calls.push(['set', v, t]); return this; }
  setTargetAtTime(v: number, t: number) { this.value = v; this.calls.push(['target', v, t]); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.value = v; this.calls.push(['linear', v, t]); return this; }
  exponentialRampToValueAtTime(v: number, t: number) { this.value = v; this.calls.push(['exp', v, t]); return this; }
  cancelScheduledValues(t: number) { this.calls.push(['cancel', 0, t]); return this; }
  cancelAndHoldAtTime(t: number) { this.calls.push(['hold', this.value, t]); return this; }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode | FakeParam>();
  readonly params = new Map<string, FakeParam>();
  constructor(readonly kind: string, readonly ctx: FakeAudioContext) {
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop !== 'string') return undefined;
        if (['gain', 'frequency', 'Q', 'delayTime', 'detune', 'pan', 'playbackRate', 'threshold', 'ratio', 'attack', 'release', 'knee', 'offset'].includes(prop)) {
          let p = target.params.get(prop);
          if (!p) { p = new FakeParam(prop === 'gain' ? 1 : 0); target.params.set(prop, p); }
          return p;
        }
        if (prop === 'port') return { postMessage() {}, close() {}, onmessage: null };
        if (prop === 'start' || prop === 'stop') return () => {};
        return undefined;
      },
      set(target, prop, value) { (target as any)[prop] = value; return true; },
    });
  }
  connect<T extends FakeNode | FakeParam>(dest: T): T { this.outputs.add(dest); return dest; }
  disconnect(dest?: FakeNode | FakeParam) { if (dest) this.outputs.delete(dest); else this.outputs.clear(); }
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  readonly created: FakeNode[] = [];
  readonly destination = new FakeNode('destination', this);
  audioWorklet = undefined;
  private node(kind: string): any {
    const n = new FakeNode(kind, this);
    this.created.push(n);
    return n;
  }
  createGain() { return this.node('gain'); }
  createBiquadFilter() { return this.node('biquad'); }
  createDelay() { return this.node('delay'); }
  createConvolver() { return this.node('convolver'); }
  createWaveShaper() { return this.node('waveshaper'); }
  createOscillator() { return this.node('oscillator'); }
  createBufferSource() { return this.node('buffersource'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createStereoPanner() { return this.node('panner'); }
  createChannelSplitter() { return this.node('splitter'); }
  createChannelMerger() { return this.node('merger'); }
  createConstantSource() { return this.node('constant'); }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] };
  }
  kinds(): string[] { return this.created.map((n) => n.kind); }
}
