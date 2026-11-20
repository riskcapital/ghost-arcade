/**
 * A reverb (convolver) that is built the first time it is used, not when
 * Audio Lab starts. Each convolver with a long impulse costs several MB of
 * FFT buffers in the editor, and the studio has a dozen of them (sends,
 * build-up, band, the rack's rooms): about 200 MB for a set that may never
 * touch a reverb.
 *
 * Its input and output are plain gains that exist from the start, so the
 * graph around it is wired once. Arming it builds the convolver behind them:
 * mid-playback the wet sound fades in over `ARM_FADE_SECONDS`, so switching
 * an effect on never clicks; when the engine is being set up (a saved
 * project with the effect already on) it is built at full level, before any
 * sound, so the project sounds as it always did.
 *
 * Its build state is explicit: none → building (the fade in) → ready. Once
 * built it stays for the session, like every other studio node.
 */

export const ARM_FADE_SECONDS = 0.05;

export type ConvolverBuild =
  | { kind: 'none' }
  | { kind: 'building'; readyAt: number }
  | { kind: 'ready' };

export type ConvolverBuildEvent =
  /** Something routed sound into it. `fadeSeconds` 0 = at full level now. */
  | { type: 'arm'; now: number; fadeSeconds: number }
  /** Time passed (read on demand, never per frame). */
  | { type: 'settle'; now: number };

export function nextConvolverBuild(state: ConvolverBuild, event: ConvolverBuildEvent): ConvolverBuild {
  switch (state.kind) {
    case 'none':
      if (event.type === 'settle') return state;
      return event.fadeSeconds > 0 ? { kind: 'building', readyAt: event.now + event.fadeSeconds } : { kind: 'ready' };
    case 'building':
      if (event.type === 'arm') return state;
      return event.now >= state.readyAt ? { kind: 'ready' } : state;
    case 'ready':
      return state;
  }
}

export class LazyConvolver {
  /** Where sound goes in; silent until armed. */
  readonly input: GainNode;
  readonly output: GainNode;
  private state: ConvolverBuild = { kind: 'none' };
  private node: ConvolverNode | null = null;
  private makeBuffer: () => AudioBuffer;
  private shape = '';

  /**
   * `makeBuffer` makes the impulse; it runs only when the convolver is built
   * (and again when `setImpulse` changes the shape after that).
   */
  constructor(private ctx: BaseAudioContext, makeBuffer: () => AudioBuffer, shape = '') {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.makeBuffer = makeBuffer;
    this.shape = shape;
  }

  get build(): ConvolverBuild {
    this.state = nextConvolverBuild(this.state, { type: 'settle', now: this.ctx.currentTime });
    return this.state;
  }

  /** Build it now if it is not built. `immediate`: at full level at once (engine setup). */
  arm(immediate = false): void {
    const now = this.ctx.currentTime;
    const fadeSeconds = immediate ? 0 : ARM_FADE_SECONDS;
    const next = nextConvolverBuild(this.state, { type: 'arm', now, fadeSeconds });
    if (this.state.kind === 'none' && next.kind !== 'none') {
      const node = this.ctx.createConvolver();
      node.buffer = this.makeBuffer();
      const fade = this.ctx.createGain();
      if (fadeSeconds > 0) {
        fade.gain.setValueAtTime(0, now);
        fade.gain.linearRampToValueAtTime(1, now + fadeSeconds);
      }
      this.input.connect(node).connect(fade).connect(this.output);
      this.node = node;
    }
    this.state = next;
  }

  /**
   * A new impulse (a room's size or decay changed). Made now only when the
   * convolver is built; otherwise kept for when it is.
   */
  setImpulse(shape: string, makeBuffer: () => AudioBuffer): void {
    if (shape === this.shape) return;
    this.shape = shape;
    this.makeBuffer = makeBuffer;
    if (this.node) this.node.buffer = makeBuffer();
  }
}
