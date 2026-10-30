/**
 * The band effects: the performer playing the band's sound back into the
 * room, the way a dub engineer works the desk.
 *
 * The live input (the band, from the desk's aux send or a mic) is sent into
 * an echo and a reverb of its own and only their wet sound comes back, so
 * the band's dry sound stays where it is (on the band's desk). A throw opens
 * the echo send fully while held and lets the repeats run on after; a wash
 * does the same with the reverb. The echo feeds the reverb a little, as on
 * a dub desk.
 *
 * Freeze takes the last moment of sound (the band, or the studio when
 * nothing comes in) and holds it as a texture: short overlapping grains
 * read from random points of that moment, an octave down, as played or an
 * octave up, until it is let go.
 */

import { ECHO_TIMES, type BandFxSettings } from './soundSlots';
import { impulse } from './fxRack';
import { holdAt, softCurve } from './sounds/kit';

const MAX_ECHO_SECONDS = 4;

export class BandFx {
  /** Where the band comes in (post EQ and pan, before the monitor gate). */
  readonly input: GainNode;
  /** What the freeze listens to: the band and the studio. */
  readonly freezeInput: GainNode;
  private readonly echoSend: GainNode;
  private readonly verbSend: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly loopTone: BiquadFilterNode;
  private readonly wowDepth: GainNode;
  private readonly wow: OscillatorNode;
  private readonly returnGain: GainNode;
  private readonly freezeGain: GainNode;
  private settings: BandFxSettings | null = null;
  private tempo = 120;
  private throwing = false;
  private washing = false;
  private capture: AudioWorkletNode | null = null;
  private captureLoading: Promise<AudioWorkletNode | null> | null = null;
  private freeze: { buffer: AudioBuffer; timer: ReturnType<typeof setInterval>; nextGrain: number; out: GainNode } | null = null;
  private snapshotSerial = 0;

  constructor(private readonly ctx: AudioContext, out: AudioNode) {
    this.input = ctx.createGain();
    this.freezeInput = ctx.createGain();
    this.input.connect(this.freezeInput);

    this.returnGain = ctx.createGain();
    this.returnGain.connect(out);

    // Echo: a tape-like delay whose repeats darken, saturate gently and wobble.
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.delay = ctx.createDelay(MAX_ECHO_SECONDS);
    this.feedback = ctx.createGain();
    this.loopTone = ctx.createBiquadFilter();
    this.loopTone.type = 'lowpass';
    const loopLow = ctx.createBiquadFilter();
    loopLow.type = 'highpass';
    loopLow.frequency.value = 140;
    const tape = ctx.createWaveShaper();
    tape.curve = softCurve(1.6);
    this.input.connect(this.echoSend).connect(this.delay);
    this.delay.connect(this.loopTone).connect(loopLow).connect(tape).connect(this.feedback).connect(this.delay);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.9;
    tape.connect(echoOut).connect(this.returnGain);
    this.wow = ctx.createOscillator();
    this.wow.frequency.value = 0.6;
    this.wowDepth = ctx.createGain();
    this.wowDepth.gain.value = 0.0018;
    this.wow.connect(this.wowDepth).connect(this.delay.delayTime);
    this.wow.start();

    // Reverb: a long, soft room.
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0;
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 4.5, 2.6, 0.45);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.8;
    this.input.connect(this.verbSend).connect(verb).connect(verbOut).connect(this.returnGain);
    // The repeats wash into the room a little.
    const echoToVerb = ctx.createGain();
    echoToVerb.gain.value = 0.25;
    tape.connect(echoToVerb).connect(verb);

    this.freezeGain = ctx.createGain();
    this.freezeGain.gain.value = 0;
    this.freezeGain.connect(this.returnGain);
    const freezeToVerb = ctx.createGain();
    freezeToVerb.gain.value = 0.35;
    this.freezeGain.connect(freezeToVerb).connect(verb);
  }

  setSettings(settings: BandFxSettings, tempo: number): void {
    const before = this.settings;
    this.settings = settings;
    this.tempo = tempo;
    const t = this.ctx.currentTime;
    const beats = ECHO_TIMES.find((e) => e.id === settings.echoTime)?.beats ?? 0.75;
    const seconds = Math.min(MAX_ECHO_SECONDS - 0.05, (beats * 60) / Math.max(30, tempo));
    if (Math.abs(this.delay.delayTime.value - seconds) > 0.0005) this.delay.delayTime.setTargetAtTime(seconds, t, 0.08);
    this.feedback.gain.setTargetAtTime(Math.min(0.92, settings.feedback) * (this.throwing ? 1.04 : 1), t, 0.05);
    this.loopTone.frequency.setTargetAtTime(700 + Math.pow(settings.echoTone, 2) * 7000, t, 0.05);
    this.returnGain.gain.setTargetAtTime(settings.returnLevel * 1.2, t, 0.05);
    if (!this.throwing) this.echoSend.gain.setTargetAtTime(settings.echoSend, t, 0.03);
    if (!this.washing) this.verbSend.gain.setTargetAtTime(settings.verbSend * 0.9, t, 0.03);
    if (this.freeze && (!before || before.freezeLevel !== settings.freezeLevel)) this.freezeGain.gain.setTargetAtTime(settings.freezeLevel * 0.9, t, 0.15);
  }

  /** Throw the band into the echo while held; the repeats run on after. */
  setThrow(on: boolean): void {
    this.throwing = on;
    const t = this.ctx.currentTime;
    holdAt(this.echoSend.gain, t);
    this.echoSend.gain.setTargetAtTime(on ? 1 : (this.settings?.echoSend ?? 0), t, on ? 0.01 : 0.04);
    this.feedback.gain.setTargetAtTime(Math.min(0.92, this.settings?.feedback ?? 0.55) * (on ? 1.04 : 1), t, 0.05);
  }

  /** Wash the band into the reverb while held. */
  setWash(on: boolean): void {
    this.washing = on;
    const t = this.ctx.currentTime;
    holdAt(this.verbSend.gain, t);
    this.verbSend.gain.setTargetAtTime(on ? 1 : (this.settings?.verbSend ?? 0) * 0.9, t, on ? 0.02 : 0.3);
  }

  get frozen(): boolean {
    return this.freeze !== null;
  }

  /**
   * Hold the last moment as a texture (true), or let it go (false). Resolves
   * false when nothing could be captured (no audio worklets here).
   */
  async setFreeze(on: boolean): Promise<boolean> {
    if (!on) {
      this.releaseFreeze();
      return true;
    }
    const capture = await this.ensureCapture();
    if (!capture) return false;
    const samples = await this.snapshot(capture, 1.6);
    if (!samples || samples.length < this.ctx.sampleRate * 0.3) return false;
    this.releaseFreeze(0.4);
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const out = this.ctx.createGain();
    out.connect(this.freezeGain);
    const t = this.ctx.currentTime;
    holdAt(this.freezeGain.gain, t);
    this.freezeGain.gain.setTargetAtTime((this.settings?.freezeLevel ?? 0.7) * 0.9, t, 0.4);
    const state = { buffer, timer: setInterval(() => this.scheduleGrains(), 40), nextGrain: t + 0.02, out };
    this.freeze = state;
    this.scheduleGrains();
    return true;
  }

  /** Stop everything now (the kill switch). */
  kill(): void {
    this.setThrow(false);
    this.setWash(false);
    this.releaseFreeze(0.05);
    const t = this.ctx.currentTime;
    holdAt(this.feedback.gain, t);
    this.feedback.gain.setValueAtTime(0, t);
    this.feedback.gain.setTargetAtTime(Math.min(0.92, this.settings?.feedback ?? 0.55), t + 0.3, 0.05);
  }

  dispose(): void {
    this.releaseFreeze(0.02);
    try { this.wow.stop(); } catch { /* stopped */ }
    try { this.returnGain.disconnect(); } catch { /* gone */ }
    try { this.capture?.disconnect(); } catch { /* gone */ }
    this.capture = null;
  }

  private releaseFreeze(fade = 2.5): void {
    const state = this.freeze;
    if (!state) return;
    this.freeze = null;
    clearInterval(state.timer);
    const t = this.ctx.currentTime;
    holdAt(state.out.gain, t);
    state.out.gain.setTargetAtTime(0, t, Math.max(0.01, fade / 4));
    setTimeout(() => { try { state.out.disconnect(); } catch { /* gone */ } }, fade * 1000 + 1500);
  }

  /** Grains a little ahead of the clock: overlapping, from random points of the moment, spread across the stereo field. */
  private scheduleGrains(): void {
    const state = this.freeze;
    if (!state) return;
    const ctx = this.ctx;
    const horizon = ctx.currentTime + 0.15;
    const pitch = this.settings?.freezePitch ?? 0;
    const rate = Math.pow(2, pitch / 12);
    const length = state.buffer.duration;
    while (state.nextGrain < horizon) {
      const start = Math.max(ctx.currentTime, state.nextGrain);
      const grain = 0.16 + Math.random() * 0.22;
      const span = grain * rate;
      const offset = Math.random() * Math.max(0.01, length - span - 0.02);
      const src = ctx.createBufferSource();
      src.buffer = state.buffer;
      src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 0.008);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(0.42, start + grain * 0.5);
      env.gain.linearRampToValueAtTime(0, start + grain);
      const pan = ctx.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.7;
      src.connect(env).connect(pan).connect(state.out);
      src.start(start, offset, span + 0.01);
      src.stop(start + grain + 0.02);
      src.onended = () => { try { pan.disconnect(); } catch { /* gone */ } };
      state.nextGrain += grain * 0.3;
    }
  }

  private ensureCapture(): Promise<AudioWorkletNode | null> {
    if (this.capture) return Promise.resolve(this.capture);
    this.captureLoading ??= (async () => {
      try {
        if (!this.ctx.audioWorklet) return null;
        const { default: url } = await import('./freezeWorklet.ts?worker&url');
        await this.ctx.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(this.ctx, 'ghost-freeze-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
        this.freezeInput.connect(node);
        this.capture = node;
        return node;
      } catch (err) {
        console.warn('[BandFx] Freeze is not available:', err);
        return null;
      } finally {
        this.captureLoading = null;
      }
    })();
    return this.captureLoading;
  }

  private snapshot(node: AudioWorkletNode, seconds: number): Promise<Float32Array | null> {
    const id = ++this.snapshotSerial;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { node.port.removeEventListener('message', onMessage); resolve(null); }, 1000);
      const onMessage = (event: MessageEvent<{ id: number; samples: Float32Array }>) => {
        if (event.data?.id !== id) return;
        clearTimeout(timeout);
        node.port.removeEventListener('message', onMessage);
        resolve(event.data.samples);
      };
      node.port.addEventListener('message', onMessage);
      node.port.start();
      node.port.postMessage({ type: 'snapshot', seconds, id });
    });
  }

  /** Start capturing ahead of the first freeze, so the moment is already there. */
  prepare(): void {
    void this.ensureCapture();
  }
}
