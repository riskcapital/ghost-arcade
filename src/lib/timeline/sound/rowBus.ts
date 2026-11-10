/**
 * One Timeline sound row's chain on the audio graph, built from the Music
 * Studio's own units:
 *
 *   input → (build FX, when the row has a build) → MacroFxChain → duck → level → out
 *
 * Shared by live playback (soundEngine) and the offline render (soundExport),
 * so a row sounds the same in both.
 */
import { MacroFxChain } from '../../music/macroFxAudio';
import type { MacroFxInstance } from '../../music/macroFx';
import { BuildFx } from '../../music/buildFx';
import { Ducker } from '../../music/ducking';
import { defaultBuildSettings, rollHits, type BuildSettings } from '../../music/buildDrop';
import { barBeatAt, beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';
import type { ShowTempoMap } from '../../types';
import type { BuildBlock, SoundRow } from './soundModel';

export const GAIN_TC = 0.012;

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // A fixed sequence, so a build sounds the same on every run.
  let seed = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

export function bpmAt(tempo: ShowTempoMap | null, t: number): number {
  return tempo ? barBeatAt(tempo, t).bpm : 120;
}

/** A build block's settings for the studio's BuildFx. */
export function buildSettingsFor(b: BuildBlock): BuildSettings {
  return { ...defaultBuildSettings(), style: b.style, roll: b.roll, filter: b.filter, riser: b.riser, sends: b.sends, gap: b.gap, impact: b.impact, kickOut: false };
}

/** The roll's hits for a build block, in show seconds. */
export function buildHitTimes(b: BuildBlock, tempo: ShowTempoMap | null): Array<{ time: number; velocity: number; pitch: number }> {
  const q = (t: number) => (tempo ? beatAtSeconds(tempo, t) : t * 2);
  const s = (beat: number) => (tempo ? secondsAtBeat(tempo, beat) : beat / 2);
  return rollHits(q(b.startTime), q(b.startTime + b.duration), b.gap).map((h) => ({ time: s(h.beat), velocity: h.velocity, pitch: h.pitch }));
}

/** One sound row's chain on the audio graph. */
export class RowBus {
  readonly input: GainNode;
  private buildFx: BuildFx | null = null;
  readonly chain: MacroFxChain;
  readonly ducker: Ducker;
  readonly level: GainNode;
  private fxSignature = '';
  private lastLevel = -1;

  constructor(private readonly ctx: AudioContext, master: AudioNode) {
    this.input = ctx.createGain();
    this.chain = new MacroFxChain(ctx);
    this.ducker = new Ducker(ctx);
    this.level = ctx.createGain();
    this.input.connect(this.chain.input);
    const ducked = this.ducker.after(this.chain.output);
    ducked.connect(this.level);
    this.level.connect(master);
  }

  /** The studio's build FX, put in front of the effects the first time a build plays here. */
  get build(): BuildFx {
    if (!this.buildFx) {
      this.buildFx = new BuildFx(this.ctx, makeNoise(this.ctx));
      try { this.input.disconnect(this.chain.input); } catch { /* none */ }
      this.input.connect(this.buildFx.input);
      this.buildFx.output.connect(this.chain.input);
    }
    return this.buildFx;
  }

  hasBuild(): boolean {
    return this.buildFx !== null;
  }

  setLevel(v: number): void {
    if (Math.abs(v - this.lastLevel) < 1e-4) return;
    this.lastLevel = v;
    this.level.gain.setTargetAtTime(v, this.ctx.currentTime, GAIN_TC);
  }

  setFx(row: SoundRow, values: Map<string, Record<string, number>>, bpm: number): void {
    let sig = `${Math.round(bpm * 100)}|`;
    for (const f of row.fx) {
      const v = values.get(f.id);
      sig += `${f.id}:${f.type}:${v ? Object.values(v).map((x) => Math.round(x * 1000)).join(',') : 'off'};`;
    }
    if (sig === this.fxSignature) return;
    this.fxSignature = sig;
    const effects: MacroFxInstance[] = row.fx.filter((f) => values.has(f.id)).map((f) => {
      const v = values.get(f.id)!;
      return { ...f, params: Object.fromEntries(Object.keys(f.params).map((k) => [k, { value: v[k] ?? f.params[k].value, depth: 0 }])) };
    });
    this.chain.sync([{ macroValue: 0, effects }], bpm);
  }

  dispose(): void {
    this.buildFx?.cancel();
    this.ducker.dispose();
    for (const n of [this.input, this.chain.input, this.chain.output, this.level, ...(this.buildFx ? [this.buildFx.output] : [])]) {
      try { n.disconnect(); } catch { /* gone */ }
    }
  }
}

