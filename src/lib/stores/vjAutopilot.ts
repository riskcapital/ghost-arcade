export type AutopilotTarget = 'none' | 'next' | 'previous' | 'random' | 'random-other' | 'random-bag' | 'first' | 'last' | 'column';
export interface VJAutopilot {
  target: AutopilotTarget;
  unit: 'loops' | 'beats';
  count: number;
  column?: number;
}
export const autopilotTargets: { value: AutopilotTarget; label: string }[] = [
  { value: 'none', label: 'Off' }, { value: 'next', label: 'Next clip' },
  { value: 'previous', label: 'Previous clip' }, { value: 'random', label: 'Random' },
  { value: 'random-other', label: 'Random other' }, { value: 'random-bag', label: 'Random bag' },
  { value: 'first', label: 'First clip' }, { value: 'last', label: 'Last clip' },
  { value: 'column', label: 'Specific column' },
];
export function normalizeAutopilot(raw: unknown): VJAutopilot | undefined {
  const value = raw as Partial<VJAutopilot> | null;
  if (!value || !autopilotTargets.some(t => t.value === value.target) || value.target === 'none') return undefined;
  return { target: value.target!, unit: value.unit === 'loops' ? 'loops' : 'beats',
    count: Number.isFinite(value.count) ? Math.max(1, Math.min(999, Math.floor(value.count!))) : 1,
    ...(value.target === 'column' ? { column: Number.isInteger(value.column) && value.column! >= 0 ? value.column : 0 } : {}) };
}

/** Random bag tracks clip identities, so replacing a cell gives it a fresh turn. */
export function chooseAutopilotColumn(ids: (string | null)[], current: number | null,
  config: VJAutopilot, played: Set<string>, random = Math.random): number | null {
  const candidates = ids.flatMap((id, i) => id ? [i] : []);
  if (!candidates.length) return null;
  const pick = (values: number[]) => values.length ? values[Math.min(values.length - 1, Math.max(0, Math.floor(random() * values.length)))] : null;
  switch (config.target) {
    case 'next': return candidates.find(i => current === null || i > current) ?? candidates[0];
    case 'previous': return [...candidates].reverse().find(i => current === null || i < current) ?? candidates[candidates.length - 1];
    case 'first': return candidates[0];
    case 'last': return candidates[candidates.length - 1];
    case 'column': return candidates.includes(config.column ?? -1) ? config.column! : null;
    case 'random': return pick(candidates);
    case 'random-other': return pick(candidates.filter(i => i !== current));
    case 'random-bag': {
      for (const id of played) if (!ids.includes(id)) played.delete(id);
      if (current !== null && ids[current]) played.add(ids[current]!);
      let remaining = candidates.filter(i => !played.has(ids[i]!));
      if (!remaining.length) {
        played.clear();
        remaining = candidates.length > 1 ? candidates.filter(i => i !== current) : candidates;
      }
      const chosen = pick(remaining);
      if (chosen !== null) played.add(ids[chosen]!);
      return chosen;
    }
    default: return null;
  }
}

export interface AutopilotSample {
  key: string;
  token: string;
  scope: string;
  config: VJAutopilot;
  ids: (string | null)[];
  current: number | null;
  running: boolean;
  bpm: number;
  rate: number;
  rangeSeconds: number;
  video: boolean;
  once: boolean;
  initialLoopProgress?: number;
}
interface Run { sample: AutopilotSample; at: number; progress: number; fired: boolean }
/** Counts transport time, not rendered frames. State changes settle the old
 * rate/pause interval before adopting the new one. No catch-up launch bursts. */
export class VJAutopilotClock {
  private runs = new Map<string, Run>();
  private bags = new Map<string, { scope: string; played: Set<string> }>();
  sync(samples: AutopilotSample[], now: number) {
    const alive = new Set(samples.map(s => s.key));
    for (const key of this.runs.keys()) if (!alive.has(key)) { this.runs.delete(key); this.bags.delete(key); }
    for (const sample of samples) {
      let run = this.runs.get(sample.key);
      if (!run || run.sample.token !== sample.token) {
        run = { sample, at: now, progress: sample.config.unit === 'loops' ? Math.max(0, Math.min(1, sample.initialLoopProgress ?? 0)) : 0, fired: false };
        this.runs.set(sample.key, run);
      } else {
        const old = run.sample;
        if (old.running && !run.fired) {
          const seconds = Math.max(0, now - run.at) / 1000;
          if (old.config.unit === 'beats') run.progress += seconds * old.bpm / 60;
          else if (old.video && old.rangeSeconds > 0) {
            run.progress += seconds * Math.abs(old.rate) / old.rangeSeconds;
            if (old.once) run.progress = Math.min(1, run.progress);
          }
        }
        run.at = now;
        run.sample = sample;
      }
      if (this.bags.get(sample.key)?.scope !== sample.scope) this.bags.set(sample.key, { scope: sample.scope, played: new Set() });
    }
  }
  takeDue(): { key: string; token: string; column: number }[] {
    const due: { key: string; token: string; column: number }[] = [];
    for (const [key, run] of this.runs) {
      if (run.fired || !run.sample.running || run.progress + 1e-9 < run.sample.config.count) continue;
      run.fired = true;
      const column = chooseAutopilotColumn(run.sample.ids, run.sample.current, run.sample.config, this.bags.get(key)!.played);
      if (column !== null) due.push({ key, token: run.sample.token, column });
    }
    return due;
  }
  get active() { return [...this.runs.values()].some(run => !run.fired && run.sample.running); }
}
