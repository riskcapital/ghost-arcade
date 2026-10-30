/**
 * The scan synth: the picture plays music back.
 *
 * A line sweeps across the live output in time with the beat. Down that
 * line, each band of the picture is a partial tuned to a note of the key
 * (low notes at the bottom, high at the top), and how bright the band is sets
 * how loud its partial plays. Bright, busy pictures sing chords; dark ones go
 * quiet; a strobe pulses the sound.
 */

export const SCAN_PARTIALS = 24;

/** Sweep length in bars, from the "Sweep" knob: slow to fast. */
export const SCAN_BARS = [16, 8, 4, 2, 1];

export function scanBars(speed: number): number {
  return SCAN_BARS[Math.max(0, Math.min(SCAN_BARS.length - 1, Math.round(speed * (SCAN_BARS.length - 1))))];
}

/** Where the line is (0-1 across the picture) at `beat` on the launch clock. */
export function scanPosition(beat: number, speed: number): number {
  const length = scanBars(speed) * 4;
  return (((beat % length) + length) % length) / length;
}

/**
 * Brightness of the picture down one column, bottom band first. `pixels`
 * is RGBA (or BGRA; only the average of the colour channels is used).
 */
export function columnBands(pixels: Uint8Array, width: number, height: number, rowBytes: number, x: number, bands: number): number[] {
  const col = Math.max(0, Math.min(width - 1, Math.round(x * (width - 1))));
  const out: number[] = [];
  for (let b = 0; b < bands; b++) {
    // Band 0 is the bottom of the picture.
    const y0 = Math.floor(height - ((b + 1) * height) / bands);
    const y1 = Math.floor(height - (b * height) / bands);
    let sum = 0;
    let count = 0;
    for (let y = Math.max(0, y0); y < Math.min(height, Math.max(y1, y0 + 1)); y++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = Math.max(0, Math.min(width - 1, col + dx));
        const i = y * rowBytes + cx * 4;
        sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 765;
        count++;
      }
    }
    out.push(count ? sum / count : 0);
  }
  return out;
}

export class ScanSynth {
  private oscs: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private master: GainNode;
  private running = false;

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(out);
  }

  get playing(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const t = this.ctx.currentTime;
    for (let i = 0; i < SCAN_PARTIALS; i++) {
      const o = this.ctx.createOscillator();
      o.type = i % 3 === 0 ? 'triangle' : 'sine';
      const g = this.ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.master);
      o.start(t);
      this.oscs.push(o);
      this.gains.push(g);
    }
    this.master.gain.setTargetAtTime(1, t, 0.1);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0, t, 0.08);
    const oscs = this.oscs;
    const gains = this.gains;
    this.oscs = [];
    this.gains = [];
    for (const o of oscs) { try { o.stop(t + 0.5); } catch { /* stopped */ } }
    setTimeout(() => { for (const g of gains) { try { g.disconnect(); } catch { /* gone */ } } }, 700);
  }

  /** Tune the partials (Hz, bottom first) and set their levels (0-1). */
  play(frequencies: number[], levels: number[], level: number): void {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    // Many partials at once: share the level so a white frame does not clip.
    const norm = (level * 0.5) / Math.sqrt(SCAN_PARTIALS);
    for (let i = 0; i < this.oscs.length; i++) {
      const f = frequencies[i];
      if (f) this.oscs[i].frequency.setTargetAtTime(f, t, 0.03);
      const v = levels[i] ?? 0;
      // A curve so mid-greys stay soft and highlights ring out.
      this.gains[i].gain.setTargetAtTime(v * v * norm, t, 0.04);
    }
  }
}
