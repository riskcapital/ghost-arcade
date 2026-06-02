// Stem router — builds an audio node graph that takes N stems and a
// routing matrix (per-stem × per-band gain) and produces a single mono
// output node. Downstream visualizers (Milkdrop / Butterchurn) connect
// to that output and "see" whatever weighted mix the user defined.
//
// Per stem we split into 3 frequency bands using BiquadFilter nodes
// (lowpass / bandpass / highpass), multiply each band by its matrix
// gain, then sum bass-of-all-stems + mid-of-all + treb-of-all into a
// single output gain. ~7 nodes per stem; 4 stems = ~28 nodes total.
// Negligible on any modern device.
//
// Why pre-split into frequency bands instead of letting Butterchurn's
// own analyser do it? Because Butterchurn's FFT can't be told "this
// stem's bass content gets weight 1.2, that one gets weight 0." We
// shape the signal *before* it reaches the FFT so its bass/mid/treb
// reactivity reflects the user's stem-routing intent.

import type { ActiveStem } from './multiStemAnalyzer';

export type RoutingBand = 'bass' | 'mid' | 'treb';

/** matrix[stemId][band] = gain (0..2). Stems not present in the matrix
 *  default to 0 — they contribute nothing to the output. */
export type RoutingMatrix = Record<string, Partial<Record<RoutingBand, number>>>;

interface StemChain {
  stemId: string;
  source: AudioNode;
  bassFilter: BiquadFilterNode;
  midFilter: BiquadFilterNode;
  trebFilter: BiquadFilterNode;
  bassGain: GainNode;
  midGain: GainNode;
  trebGain: GainNode;
}

/** Crossover frequencies for the 3-band split. 200 / 2000 Hz roughly
 *  matches Butterchurn's own band edges so the perceived effect of
 *  "drive only the bass band" matches what a VJ expects. */
const BAND_LOW_HZ  = 200;
const BAND_HIGH_HZ = 2000;

export class StemRouter {
  private audioCtx: AudioContext;
  private chains: StemChain[] = [];
  // Per-band summing nodes. Each chain's per-band gain connects here.
  private bassSum: GainNode;
  private midSum: GainNode;
  private trebSum: GainNode;
  // Final summed output that downstream visualizers connect to.
  private output: GainNode;
  private matrix: RoutingMatrix = {};

  constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
    this.bassSum = audioCtx.createGain();
    this.midSum  = audioCtx.createGain();
    this.trebSum = audioCtx.createGain();
    this.output  = audioCtx.createGain();
    this.bassSum.connect(this.output);
    this.midSum.connect(this.output);
    this.trebSum.connect(this.output);
  }

  /** Rebuild the per-stem chains for the current source set. Idempotent
   *  on identical stem lists (cheap) but the simplest correct path is
   *  to rebuild whenever the set changes; v1 ships that. */
  setStems(stems: ActiveStem[]): void {
    this.disposeChains();
    for (const stem of stems) {
      const bassFilter = this.audioCtx.createBiquadFilter();
      bassFilter.type = 'lowpass';
      bassFilter.frequency.value = BAND_LOW_HZ;
      bassFilter.Q.value = 0.7;

      const midFilter = this.audioCtx.createBiquadFilter();
      midFilter.type = 'bandpass';
      midFilter.frequency.value = Math.sqrt(BAND_LOW_HZ * BAND_HIGH_HZ);  // geo mean
      midFilter.Q.value = 0.7;

      const trebFilter = this.audioCtx.createBiquadFilter();
      trebFilter.type = 'highpass';
      trebFilter.frequency.value = BAND_HIGH_HZ;
      trebFilter.Q.value = 0.7;

      const bassGain = this.audioCtx.createGain();
      const midGain  = this.audioCtx.createGain();
      const trebGain = this.audioCtx.createGain();
      bassGain.gain.value = this._matGain(stem.id, 'bass');
      midGain.gain.value  = this._matGain(stem.id, 'mid');
      trebGain.gain.value = this._matGain(stem.id, 'treb');

      stem.sourceNode.connect(bassFilter);
      stem.sourceNode.connect(midFilter);
      stem.sourceNode.connect(trebFilter);

      bassFilter.connect(bassGain);
      midFilter.connect(midGain);
      trebFilter.connect(trebGain);

      bassGain.connect(this.bassSum);
      midGain.connect(this.midSum);
      trebGain.connect(this.trebSum);

      this.chains.push({
        stemId: stem.id, source: stem.sourceNode,
        bassFilter, midFilter, trebFilter,
        bassGain, midGain, trebGain,
      });
    }
  }

  /** Live-update the matrix without tearing down the node graph. */
  setMatrix(matrix: RoutingMatrix): void {
    this.matrix = matrix;
    for (const chain of this.chains) {
      const now = this.audioCtx.currentTime;
      try { chain.bassGain.gain.setTargetAtTime(this._matGain(chain.stemId, 'bass'), now, 0.03); } catch {}
      try { chain.midGain.gain.setTargetAtTime(this._matGain(chain.stemId, 'mid'), now, 0.03); } catch {}
      try { chain.trebGain.gain.setTargetAtTime(this._matGain(chain.stemId, 'treb'), now, 0.03); } catch {}
    }
  }

  /** The summed output. Connect to any downstream consumer (Butterchurn,
   *  another analyser, etc.). */
  getOutput(): AudioNode { return this.output; }

  dispose(): void {
    this.disposeChains();
    try { this.bassSum.disconnect(); } catch {}
    try { this.midSum.disconnect(); }  catch {}
    try { this.trebSum.disconnect(); } catch {}
    try { this.output.disconnect(); }  catch {}
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private disposeChains(): void {
    for (const c of this.chains) {
      try { c.source.disconnect(c.bassFilter); } catch {}
      try { c.source.disconnect(c.midFilter); }  catch {}
      try { c.source.disconnect(c.trebFilter); } catch {}
      try { c.bassFilter.disconnect(); } catch {}
      try { c.midFilter.disconnect(); }  catch {}
      try { c.trebFilter.disconnect(); } catch {}
      try { c.bassGain.disconnect(); }   catch {}
      try { c.midGain.disconnect(); }    catch {}
      try { c.trebGain.disconnect(); }   catch {}
    }
    this.chains = [];
  }

  private _matGain(stemId: string, band: RoutingBand): number {
    const row = this.matrix[stemId];
    if (!row) return 0;
    const g = row[band];
    return typeof g === 'number' ? Math.max(0, g) : 0;
  }
}
