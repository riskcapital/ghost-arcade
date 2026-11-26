/**
 * Link's clock (microseconds, read in the main process) against this
 * window's performance.now() (milliseconds).
 *
 * Each state poll reads Link's clock somewhere inside the round trip to the
 * main process, so it is stamped at the round trip's midpoint. The two
 * clocks tick at the same rate, so all that has to be found is the offset
 * between them; the sample with the shortest round trip among the recent
 * ones bounds it best (its midpoint can be wrong by at most half of it).
 */

export interface LinkClockSample {
  /** performance.now() when the request went out and when the answer came back. */
  sentMs: number;
  receivedMs: number;
  /** Link's clock as read in between. */
  micros: number;
}

/** Samples kept: about 8 s of 4 Hz polls. */
const WINDOW = 32;

export class LinkClockMap {
  private samples: { rtt: number; offsetMs: number }[] = [];

  /** Add a poll. Returns false (and keeps nothing) for a sample that cannot be right. */
  add(s: LinkClockSample): boolean {
    const rtt = s.receivedMs - s.sentMs;
    if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(s.micros)) return false;
    const mid = s.sentMs + rtt / 2;
    this.samples.push({ rtt, offsetMs: mid - s.micros / 1000 });
    if (this.samples.length > WINDOW) this.samples.shift();
    return true;
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }

  /** The best sample's round trip (ms): how far off a mapped time can be, doubled. */
  get uncertaintyMs(): number {
    return this.best()?.rtt ?? Infinity;
  }

  /** performance.now() at Link time `micros`, or null before the first poll. */
  toPerfMs(micros: number): number | null {
    const b = this.best();
    return b && Number.isFinite(micros) ? micros / 1000 + b.offsetMs : null;
  }

  /** Link's clock (µs) at performance.now() `ms`, or null before the first poll. */
  toLinkMicros(ms: number): number | null {
    const b = this.best();
    return b && Number.isFinite(ms) ? (ms - b.offsetMs) * 1000 : null;
  }

  clear(): void {
    this.samples = [];
  }

  private best(): { rtt: number; offsetMs: number } | null {
    let best: { rtt: number; offsetMs: number } | null = null;
    for (const s of this.samples) if (!best || s.rtt < best.rtt) best = s;
    return best;
  }
}
