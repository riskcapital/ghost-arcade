/**
 * Record lines from controllers while the show plays.
 *
 * Arm, play, move a control bound to a parameter (a MIDI knob, the panel
 * slider, OSC, a Live knob): each move is a sample at the show time. A
 * *pass* is one continuous gesture on one parameter:
 *
 *   touch  writes while the control moves; RELEASE_MS after it stops the
 *          pass ends and the line glides back to what it was
 *   latch  holds the last value until the show stops (or disarm)
 *
 * While a pass is open its live value replaces the line's (`touches()`, fed
 * to LineContext.touch) so the output shows what you are doing. When it ends
 * the samples are smoothed and thinned (lineDrawing.strokeToPoints) and
 * spliced into the line: one undo step per pass. A parameter without a line
 * gets one.
 *
 * Clocks are injected (`now`), so tests run on fake time.
 */
import type { ParamEntry, ParamTarget } from './paramRegistry';
import { targetId } from './paramRegistry';
import type { ControlLine, LinePoint } from './lineModel';
import { spliceStroke, strokeToPoints, type Sample } from './lineDrawing';
import { pointsValueAt } from './lineEvaluator';

export type RecordMode = 'touch' | 'latch';

/** Milliseconds a control must rest before a touch pass ends. */
export const RELEASE_MS = 300;
/** Seconds a touch pass takes to glide back to the line. */
export const RETURN_GLIDE = 0.12;
/** The show moving on more than this between two samples is a jump (a seek,
 *  a section jump), not play: the pass ends where it was (the evaluator's
 *  own jump rule). */
export const JUMP_SECONDS = 0.5;
/** Samples one open pass keeps at most. A longer pass is written to its line
 *  at that point and carries on as a new pass from there (nothing is lost:
 *  the open pass is the only thing in memory that grows). */
export const MAX_PASS_SAMPLES = 20_000;
/** Below this fraction of a parameter's range a value counts as unchanged
 *  while recording, so a held value is kept as two points (where the run
 *  started and how far it has got), not one sample per frame. Well under
 *  the thinning on commit (half a percent of the range). */
const FLAT_FRACTION = 0.0005;

export interface RecorderHost {
  lines(): readonly ControlLine[];
  /** One undo step: put this line (new or changed). */
  commit(label: string, line: ControlLine): void;
  /** The registry entry for a parameter (range, kind, default), or null. */
  describe(target: ParamTarget, key: string): ParamEntry | null;
  newId(): string;
}

interface Pass {
  lineId: string;
  target: ParamTarget;
  key: string;
  entry: ParamEntry;
  samples: Sample[];
  value: number;
  lastInputMs: number;
  start: number;
}

export function lineFor(lines: readonly ControlLine[], target: ParamTarget, key: string): ControlLine | undefined {
  const id = targetId(target);
  return lines.find((l) => l.key === key && targetId(l.target) === id);
}

export function createLineRecorder(host: RecorderHost, opts: { now?: () => number; releaseMs?: number; tolerance?: number } = {}) {
  const now = opts.now ?? (() => performance.now());
  const releaseMs = opts.releaseMs ?? RELEASE_MS;
  let armed = false;
  let mode: RecordMode = 'touch';
  let lastShowTime = 0;
  const passes = new Map<string, Pass>();
  const touchMap = new Map<string, number>();
  /** Lines made for a parameter that had none, shown while their first pass is open. */
  const provisional = new Map<string, ControlLine>();
  let overlayIn: readonly ControlLine[] | null = null;
  let overlayOut: readonly ControlLine[] = [];
  let overlayCount = -1;

  const passKey = (target: ParamTarget, key: string) => `${targetId(target)}|${key}`;
  const lastT = (pass: Pass) => pass.samples[pass.samples.length - 1].t;
  /** Show time `t` is not where play from the pass's last sample goes (back, or far ahead). */
  const jumped = (pass: Pass, t: number) => t < lastT(pass) - 1e-9 || t - lastT(pass) > JUMP_SECONDS;
  /** Where an open pass ends when the show is at `t`. */
  const endAt = (pass: Pass, t: number) => (jumped(pass, t) ? lastT(pass) : Math.max(t, lastT(pass)));

  /** How far a value may move and still be "the same" for a pass's flat runs. */
  const flatTol = (e: ParamEntry) => (e.kind === 'continuous' ? Math.abs(e.max - e.min) * FLAT_FRACTION : 0);

  /**
   * A sample onto an open pass. A run of the same value is kept as its first
   * and latest sample: the latest moves on instead of a new one being added
   * (the error stays under flatTol of where the run started).
   */
  function append(pass: Pass, t: number, v: number): void {
    const s = pass.samples;
    const n = s.length;
    if (n >= 2) {
      const tol = flatTol(pass.entry);
      const anchor = s[n - 2].v;
      if (Math.abs(s[n - 1].v - anchor) <= tol && Math.abs(v - anchor) <= tol) {
        s[n - 1] = { t, v };
        return;
      }
    }
    s.push({ t, v });
    if (s.length >= MAX_PASS_SAMPLES) carryOn(pass);
  }

  /** A pass at its sample cap: written to its line, and on from there as a new pass. */
  function carryOn(pass: Pass): void {
    const last = pass.samples[pass.samples.length - 1];
    commitPass(pass, last.t, true);
    const line = lineFor(host.lines(), pass.target, pass.key);
    const next: Pass = { ...pass, lineId: line?.id ?? pass.lineId, samples: [{ t: last.t, v: last.v }], start: last.t };
    passes.set(passKey(pass.target, pass.key), next);
    touchMap.set(next.lineId, next.value);
  }

  /** `carried`: the pass goes on (its cap), so no glide back to the line at its end. */
  function commitPass(pass: Pass, endTime: number, carried = false): void {
    passes.delete(passKey(pass.target, pass.key));
    touchMap.delete(pass.lineId);
    const existing = host.lines().find((l) => l.id === pass.lineId) ?? provisional.get(pass.lineId);
    provisional.delete(pass.lineId);
    if (!existing) return;
    const e = pass.entry;
    const discrete = e.kind === 'bool' || e.kind === 'stepped' || e.kind === 'colour';
    const samples = pass.samples.slice();
    if (endTime > samples[samples.length - 1].t) samples.push({ t: endTime, v: pass.value });
    const stroke: LinePoint[] = discrete
      ? holdStroke(samples)
      : strokeToPoints(samples, { min: e.min, max: e.max, smooth: 0.03, tolerance: (opts.tolerance ?? 0.005) * Math.abs(e.max - e.min) });
    const fresh = !host.lines().some((l) => l.id === pass.lineId);
    const points = spliceStroke(fresh ? [] : existing.points, stroke, { glide: mode === 'touch' && !fresh && !carried ? RETURN_GLIDE : 0, colour: e.kind === 'colour' });
    // A brand-new line keeps the parameter's own value outside the pass.
    if (fresh) {
      const base = Number(existing.points[0]?.v ?? e.default);
      if (points[0].t > 0) points.unshift({ t: Math.max(0, points[0].t - 1e-4), v: base });
      if (mode === 'touch' && !carried) points.push({ t: points[points.length - 1].t + RETURN_GLIDE, v: base });
    }
    host.commit(fresh ? 'Record line' : 'Record into line', { ...existing, points });
  }

  function holdStroke(samples: Sample[]): LinePoint[] {
    const out: LinePoint[] = [];
    for (const s of samples) {
      if (out.length && out[out.length - 1].v === s.v) continue;
      if (out.length && s.t - out[out.length - 1].t < 1e-4) out.pop();
      out.push({ t: s.t, v: s.v, c: 'hold' });
    }
    const last = samples[samples.length - 1];
    if (out[out.length - 1].t < last.t) out.push({ t: last.t, v: last.v, c: 'hold' });
    return out;
  }

  return {
    arm(nextMode: RecordMode = mode): void {
      mode = nextMode;
      armed = true;
    },
    /** Disarm: every open pass ends where the show is. */
    disarm(showTime = lastShowTime): void {
      this.stop(showTime);
      armed = false;
    },
    get armed() { return armed; },
    get mode() { return mode; },
    setMode(next: RecordMode): void { mode = next; },

    /**
     * A bound control moved to `value` (parameter units) at show time
     * `showTime`. Ignored while disarmed. Returns true when it was recorded.
     */
    input(target: ParamTarget, key: string, value: number | boolean, showTime: number): boolean {
      if (!armed) return false;
      const entry = host.describe(target, key);
      if (!entry) return false;
      const v = typeof value === 'boolean' ? (value ? 1 : 0) : Math.max(entry.min, Math.min(entry.max, Number(value)));
      if (!Number.isFinite(v)) return false;
      lastShowTime = showTime;
      const k = passKey(target, key);
      let pass = passes.get(k);
      if (!pass) {
        let line = lineFor(host.lines(), target, key);
        if (!line) {
          line = {
            id: host.newId(), target, key, label: entry.label, kind: entry.kind, min: entry.min, max: entry.max,
            ...(entry.kind === 'stepped' ? { step: entry.step } : {}),
            default: Number(entry.default), points: [{ t: 0, v: Number(entry.default) }],
          };
          provisional.set(line.id, line);
        }
        // The line's value just before the gesture, so the stroke starts from it.
        const before = pointsValueAt(line.points, showTime, 'linear', entry.kind === 'colour') ?? Number(entry.default);
        pass = { lineId: line.id, target, key, entry, samples: [], value: before, lastInputMs: now(), start: showTime };
        passes.set(k, pass);
      }
      const last = pass.samples[pass.samples.length - 1];
      if (last && jumped(pass, showTime)) {
        // The show jumped (loop, seek, section jump): the old pass ends where
        // it was, and what the playhead skipped is left as it was.
        commitPass(pass, last.t);
        return this.input(target, key, value, showTime);
      }
      pass.value = v;
      pass.lastInputMs = now();
      append(pass, showTime, v);
      touchMap.set(passes.get(k)!.lineId, v);
      return true;
    },

    /** Every frame while armed: ends touch passes whose control has rested. */
    tick(showTime: number): void {
      lastShowTime = showTime;
      if (!passes.size) return;
      const t = now();
      for (const pass of [...passes.values()]) {
        if (jumped(pass, showTime)) {
          // A jump: the pass ends where the show was. A latched control
          // keeps writing its value from the new place (the next lap of a
          // loop records too).
          commitPass(pass, lastT(pass));
          if (mode === 'latch') this.input(pass.target, pass.key, pass.value, showTime);
        } else if (mode === 'touch' && t - pass.lastInputMs >= releaseMs) {
          // The value held while the control rested, as it was seen, then
          // the glide back to the line.
          commitPass(pass, Math.max(showTime, lastT(pass)));
        } else if (mode === 'latch' && showTime > pass.samples[pass.samples.length - 1].t) {
          // Latched: keep writing the held value (for the live view). A
          // flat run stays two points: its start, and how far it has got.
          append(pass, showTime, pass.value);
        }
      }
    },

    /** The show stopped: every open pass (latch ones included) ends at `showTime`. */
    stop(showTime = lastShowTime): void {
      for (const pass of [...passes.values()]) commitPass(pass, endAt(pass, showTime));
    },

    /** Live values of open passes by line id (LineContext.touch). */
    touches(): ReadonlyMap<string, number> {
      return touchMap;
    },

    /** The lines to evaluate: the document's plus any first-pass line. */
    overlay(lines: readonly ControlLine[]): readonly ControlLine[] {
      if (!provisional.size) return lines;
      if (overlayIn === lines && overlayCount === provisional.size) return overlayOut;
      overlayIn = lines;
      overlayCount = provisional.size;
      overlayOut = [...lines, ...provisional.values()];
      return overlayOut;
    },

    openPasses(): number {
      return passes.size;
    },

    /** What open passes have written so far, by line id (drawn live). */
    passSamples(): Map<string, readonly Sample[]> {
      const out = new Map<string, readonly Sample[]>();
      for (const pass of passes.values()) out.set(pass.lineId, pass.samples);
      return out;
    },
  };
}

export type LineRecorder = ReturnType<typeof createLineRecorder>;
