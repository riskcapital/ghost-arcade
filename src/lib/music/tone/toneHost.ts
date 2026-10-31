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
      node = new AudioWorkletNode(this.ctx, 'ghost-tone', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { kind: slot === 'drums' ? 'drums' : 'tone' },
      });
      node.connect(this.outputs[slot]);
      node.port.postMessage({ t: 'tempo', bpm: this.bpm });
      this.nodes.set(slot, node);
    }
    return node;
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

  setTempo(bpm: number): void {
    if (Math.abs(bpm - this.bpm) < 0.01) return;
    this.bpm = bpm;
    for (const node of this.nodes.values()) node.port.postMessage({ t: 'tempo', bpm });
  }

  panic(): void {
    for (const node of this.nodes.values()) node.port.postMessage({ t: 'panic' });
  }

  dispose(): void {
    for (const node of this.nodes.values()) {
      try { node.disconnect(); } catch { /* gone */ }
    }
    this.nodes.clear();
  }
}
