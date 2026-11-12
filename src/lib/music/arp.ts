/**
 * The arpeggiator: held keys become a run of notes on the beat grid. Pure
 * logic, counted in beats, so the tone engine can drive it from its own clock
 * at the shared tempo.
 */

export type ArpMode = 'up' | 'down' | 'updown' | 'random' | 'played';

export interface ArpSettings {
  mode: ArpMode;
  /** Beats per step: 0.25 is sixteenths. */
  rate: number;
  /** How many octaves the run climbs, 1-4. */
  octaves?: number;
  /** How long each note holds, as a share of its step. */
  gate?: number;
  /** Notes keep playing after the keys let go, until a new chord is pressed. */
  latch?: boolean;
}

export interface ArpStep {
  note: number;
  vel: number;
  /** Beats from the start of the window it was asked for. */
  at: number;
  /** Beats it holds. */
  len: number;
}

/** The notes of one pass, before up, down or random ordering. */
export function arpNotes(held: readonly number[], octaves: number, sorted: boolean): number[] {
  const base = sorted ? [...held].sort((a, b) => a - b) : [...held];
  const out: number[] = [];
  const oct = Math.max(1, Math.min(4, Math.round(octaves)));
  for (let o = 0; o < oct; o++) for (const n of base) if (n + o * 12 <= 127) out.push(n + o * 12);
  return out;
}

/** One full cycle of the pattern for a mode. */
export function arpCycle(held: readonly number[], mode: ArpMode, octaves = 1): number[] {
  const up = arpNotes(held, octaves, mode !== 'played');
  if (mode === 'down') return up.reverse();
  if (mode === 'updown') return up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
  return up;
}

export class Arpeggiator {
  settings: ArpSettings;
  /** Keys physically down. */
  private down = new Set<number>();
  /** Notes the run plays, in press order, with their velocities. */
  private notes = new Map<number, number>();
  private index = 0;
  /** Beats until the next step. */
  private pos = 0;
  private readonly rng: () => number;

  constructor(settings: ArpSettings, rng: () => number = Math.random) {
    this.settings = settings;
    this.rng = rng;
  }

  get active(): boolean {
    return this.notes.size > 0;
  }

  press(note: number, vel: number): void {
    // With latch, a fresh chord (every key had let go) replaces the held one.
    if (this.settings.latch && this.down.size === 0) this.notes.clear();
    if (this.notes.size === 0) {
      this.index = 0;
      this.pos = 0;
    }
    this.down.add(note);
    this.notes.delete(note);
    this.notes.set(note, vel);
  }

  release(note: number): void {
    this.down.delete(note);
    if (!this.settings.latch) this.notes.delete(note);
  }

  clear(): void {
    this.down.clear();
    this.notes.clear();
    this.index = 0;
    this.pos = 0;
  }

  /** Move on by `beats`, returning the steps that start in that window. */
  advance(beats: number): ArpStep[] {
    const steps: ArpStep[] = [];
    if (!this.notes.size) {
      this.pos = 0;
      this.index = 0;
      return steps;
    }
    const s = this.settings;
    const rate = Math.max(1 / 64, s.rate);
    const len = rate * Math.max(0.05, Math.min(1, s.gate ?? 0.5));
    const cycle = arpCycle([...this.notes.keys()], s.mode, s.octaves ?? 1);
    while (this.pos < beats) {
      const note = s.mode === 'random'
        ? cycle[Math.floor(this.rng() * cycle.length) % cycle.length]
        : cycle[this.index % cycle.length];
      const vel = this.notes.get(note) ?? this.notes.get(this.rootOf(note)) ?? 0.8;
      steps.push({ note, vel, at: this.pos, len });
      this.index++;
      this.pos += rate;
    }
    this.pos -= beats;
    return steps;
  }

  private rootOf(note: number): number {
    for (const n of this.notes.keys()) if ((note - n) % 12 === 0 && note >= n) return n;
    return note;
  }
}
