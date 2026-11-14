/**
 * The faint trace of a line that follows a live source (MIDI, a Live knob or
 * level): the source's values over the last few seconds of show time.
 *
 * A trace only grows at its end and drops samples from its front, so it is a
 * window over an endless run of samples, each with a fixed number (its
 * absolute index). The view draws it in parts by that number, and a part that
 * is complete never has to be drawn again (lineUi.ts createLiveTraceDrawer).
 */
import type { ControlLine, FollowSource } from './lineModel';

/** Most samples a trace keeps, whatever the frame rate (30 s at 240 fps). */
export const MAX_TRACE_SAMPLES = 7200;

type LiveSource = Extract<FollowSource, { kind: 'midi' | 'live-param' | 'live-level' }>;

export function isLiveTraceSource(src: FollowSource | undefined): src is LiveSource {
  return !!src && (src.kind === 'midi' || src.kind === 'live-param' || src.kind === 'live-level');
}

export class LiveTrace {
  private ts: number[] = [];
  private vs: number[] = [];
  /** Index in ts of the oldest kept sample. */
  private head = 0;
  /** Samples dropped from the front since this run began. */
  private dropped = 0;
  /** A new run each time the trace starts over (time went back): drawings of the old one are dropped. */
  run = 0;
  /** Moves on every change. */
  version = 0;

  constructor(readonly seconds: number, readonly cap = MAX_TRACE_SAMPLES) {}

  /** Absolute index of the oldest kept sample. */
  get first(): number { return this.dropped; }
  /** Absolute index after the newest sample. */
  get end(): number { return this.dropped + this.ts.length - this.head; }
  get size(): number { return this.ts.length - this.head; }
  /** Time and value of the sample at absolute index `i` (first <= i < end). */
  t(i: number): number { return this.ts[i - this.dropped + this.head]; }
  v(i: number): number { return this.vs[i - this.dropped + this.head]; }

  push(t: number, v: number): void {
    if (this.size && t < this.ts[this.ts.length - 1]) this.restart();
    this.ts.push(t);
    this.vs.push(v);
    const cut = t - this.seconds;
    while (this.head < this.ts.length && (this.ts[this.head] < cut || this.ts.length - this.head > this.cap)) {
      this.head++;
      this.dropped++;
    }
    // Drop what has gone off the front now and then (each sample is moved at most once).
    if (this.head >= 512 && this.head * 2 >= this.ts.length) {
      this.ts.splice(0, this.head);
      this.vs.splice(0, this.head);
      this.head = 0;
    }
    this.version++;
  }

  /** The kept samples, oldest first (a copy). */
  samples(): Array<{ t: number; v: number }> {
    const out: Array<{ t: number; v: number }> = [];
    for (let i = this.head; i < this.ts.length; i++) out.push({ t: this.ts[i], v: this.vs[i] });
    return out;
  }

  private restart(): void {
    this.ts = [];
    this.vs = [];
    this.head = 0;
    this.dropped = 0;
    this.run++;
  }
}

/**
 * The traces of every line that follows a live source. The lines that do
 * are worked out again only when the list of lines changes (not per frame),
 * and then the traces of lines that no longer follow one are dropped.
 */
export class LiveTraceTable {
  private traces = new Map<string, LiveTrace>();
  private linesSeen: readonly ControlLine[] | null = null;
  private following: Array<{ id: string; source: LiveSource }> = [];

  constructor(readonly seconds: number) {}

  get(id: string): LiveTrace | undefined { return this.traces.get(id); }
  get size(): number { return this.traces.size; }
  keys(): IterableIterator<string> { return this.traces.keys(); }

  /** One sample per following line at `time`; `read` gives a source's value now (null: none). True when any trace grew. */
  record(lines: readonly ControlLine[], time: number, read: (src: LiveSource) => number | null): boolean {
    if (lines !== this.linesSeen) this.useLines(lines);
    let any = false;
    for (const { id, source } of this.following) {
      const v = read(source);
      if (v === null) continue;
      let trace = this.traces.get(id);
      if (!trace) this.traces.set(id, (trace = new LiveTrace(this.seconds)));
      trace.push(time, v);
      any = true;
    }
    return any;
  }

  clear(): void {
    this.traces.clear();
    this.linesSeen = null;
    this.following = [];
  }

  private useLines(lines: readonly ControlLine[]): void {
    this.linesSeen = lines;
    this.following = [];
    for (const line of lines) {
      const src = line.follow?.source;
      if (isLiveTraceSource(src)) this.following.push({ id: line.id, source: src });
    }
    const keep = new Set(this.following.map((f) => f.id));
    for (const id of [...this.traces.keys()]) if (!keep.has(id)) this.traces.delete(id);
  }
}
