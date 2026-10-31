/**
 * The main thread's side of the tone engine: loads the worklet once and
 * gives each instrument its own node, fed by timed messages. Until the
 * worklet is ready (or where worklets are missing) `ready` is false and the
 * studio keeps playing its built-in sounds.
 */

import type { DrumKit, DrumTweak, TonePatch, ToneMessage } from './toneTypes';

export type ToneSlot = 'synth' | 'keys' | 'drums';

export class ToneHost {
  private ctx: AudioContext;
  private loading: Promise<boolean> | null = null;
  private loaded = false;
  private nodes = new Map<ToneSlot, AudioWorkletNode>();
  /** Engines for clips' own tones, by tone and the channel they play into. */
  private clipNodes = new Map<string, AudioWorkletNode>();
  private outputs: Record<ToneSlot, AudioNode>;
  private patches = new Map<ToneSlot, TonePatch | DrumKit>();
  private bpm = 120;

  constructor(ctx: AudioContext, outputs: Record<ToneSlot, AudioNode>) {
    this.ctx = ctx;
    this.outputs = outputs;
  }

  /** Start loading the worklet; resolves to whether tones can play. */
  load(): Promise<boolean> {
    if (this.loaded) return Promise.resolve(true);
    this.loading ??= (async () => {
      try {
        if (!this.ctx.audioWorklet) return false;
        const { default: url } = await import('./toneWorklet.ts?worker&url');
        await this.ctx.audioWorklet.addModule(url);
        this.loaded = true;
        for (const [slot, patch] of this.patches) this.send(slot, 'sounds' in patch ? { t: 'kit', kit: patch } : { t: 'patch', patch });
        return true;
      } catch (err) {
        console.warn('[Studio] The tone engine is not available:', err);
        return false;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  get ready(): boolean {
    return this.loaded;
  }

  private node(slot: ToneSlot): AudioWorkletNode | null {
    if (!this.loaded) return null;
    let node = this.nodes.get(slot);
    if (!node) {
      node = this.create(slot === 'drums' ? 'drums' : 'tone', this.outputs[slot]);
      this.nodes.set(slot, node);
    }
    return node;
  }

  private create(kind: 'tone' | 'drums', out: AudioNode): AudioWorkletNode {
    const node = new AudioWorkletNode(this.ctx, 'ghost-tone', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { kind },
    });
    node.connect(out);
    node.port.postMessage({ t: 'tempo', bpm: this.bpm });
    return node;
  }

  /**
   * A note on a clip's own tone, played into `out` (its instrument's channel).
   * Each tone in use gets one engine per channel. False until the worklet is ready.
   */
  clipNote(tone: string, patch: TonePatch, channel: string, out: AudioNode, msg: Extract<ToneMessage, { t: 'on' | 'off' }>): boolean {
    if (!this.loaded) {
      void this.load();
      return false;
    }
    const key = `${tone}@${channel}`;
    let node = this.clipNodes.get(key);
    // A note-off for a note this engine never started (it began before the worklet was ready) is not ours.
    if (!node && msg.t === 'off') return false;
    if (!node) {
      node = this.create('tone', out);
      node.port.postMessage({ t: 'patch', patch });
      this.clipNodes.set(key, node);
    }
    node.port.postMessage(msg);
    return true;
  }

  private send(slot: ToneSlot, msg: ToneMessage): void {
    this.node(slot)?.port.postMessage(msg);
  }

  setPatch(slot: 'synth' | 'keys', patch: TonePatch): void {
    if (this.patches.get(slot) === patch) return;
    this.patches.set(slot, patch);
    this.send(slot, { t: 'patch', patch });
  }

  setKit(kit: DrumKit): void {
    if (this.patches.get('drums') === kit) return;
    this.patches.set('drums', kit);
    this.send('drums', { t: 'kit', kit });
  }

  noteOn(slot: 'synth' | 'keys', note: number, vel: number, at: number): void {
    this.send(slot, { t: 'on', note, vel, at });
  }

  noteOff(slot: 'synth' | 'keys', note: number, at: number): void {
    this.send(slot, { t: 'off', note, at });
  }

  hit(slot: number, vel: number, at: number, tweak: DrumTweak): void {
    this.send('drums', { t: 'hit', slot, vel, at, tweak });
  }

  /** Mod wheel and aftertouch 0-1, bend -1..1, to both melodic engines. */
  expression(expr: { wheel?: number; pressure?: number; bend?: number }): void {
    for (const slot of ['synth', 'keys'] as const) if (this.nodes.has(slot)) this.send(slot, { t: 'expr', ...expr });
  }

  private all(): AudioWorkletNode[] {
    return [...this.nodes.values(), ...this.clipNodes.values()];
  }

  setTempo(bpm: number): void {
    if (Math.abs(bpm - this.bpm) < 0.01) return;
    this.bpm = bpm;
    for (const node of this.all()) node.port.postMessage({ t: 'tempo', bpm });
  }

  /** Silence one part's engine, or all of them. */
  panic(slot?: ToneSlot): void {
    for (const [s, node] of this.nodes) if (!slot || s === slot) node.port.postMessage({ t: 'panic' });
    if (!slot) for (const node of this.clipNodes.values()) node.port.postMessage({ t: 'panic' });
  }

  dispose(): void {
    for (const node of this.all()) {
      try { node.disconnect(); } catch { /* gone */ }
    }
    this.nodes.clear();
    this.clipNodes.clear();
  }
}
