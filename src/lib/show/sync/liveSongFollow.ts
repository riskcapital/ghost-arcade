/**
 * Following Live's arrangement: the Ghost Arcade script in Live reports the
 * song position (beats from the arrangement start) about ten times a second
 * while Live plays, and once a second while it is stopped. Each report is an
 * anchor for the chase clock, like a timecode frame.
 *
 * With Ableton Link on (Live and Ghost Arcade in one session), Live's song
 * position and Link's beat move together while Live plays: their difference
 * is constant. The follower keeps that difference (the median of the last
 * few reports, so one late datagram does not move it) and between reports
 * reads the position off Link's own clock, which runs smoothly here. A jump
 * in Live (a locator, a loop wrap, a click in the arrangement) shows up as a
 * new difference and replaces the old one at once.
 *
 * Pure: reports and Link beats come in, positions to feed the chase go out.
 */

export interface LiveSongReport {
  /** Live's song position, quarter notes. */
  beat: number;
  /** performance.now() when the report arrived. */
  atMs: number;
  playing: boolean;
  tempo: number;
}

export interface LiveSongFeed {
  /** Song position, quarter notes from the arrangement start. */
  quarters: number;
  atMs: number;
  running: boolean;
  bpm: number;
}

/** A difference this far from the kept one is a jump in Live, not jitter. */
export const LIVE_JUMP_QUARTERS = 0.25;
const KEEP = 9;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class LiveSongFollower {
  /** Song position − Link beat, per recent report. */
  private diffs: number[] = [];
  private lastAt = Number.NaN;
  private parkedAt: number | null = null;
  private tempo = 120;
  private playing = false;

  /** The difference to Link in use, or null (no Link, or not settled). */
  get linkOffset(): number | null {
    return this.diffs.length >= 3 ? median(this.diffs) : null;
  }

  /**
   * A report from Live. `linkBeat` is Link's beat when it arrived (null
   * without a Link session). Returns what to feed the chase, or null when
   * the report says nothing new.
   */
  report(r: LiveSongReport, linkBeat: number | null): LiveSongFeed | null {
    if (!Number.isFinite(r.beat) || r.atMs === this.lastAt) return null;
    this.lastAt = r.atMs;
    if (r.tempo > 0) this.tempo = r.tempo;
    this.playing = r.playing;
    if (!r.playing) {
      this.diffs = [];
      // Parked: only a new position moves the playhead (the user can still
      // scrub the Timeline while Live sits still).
      if (this.parkedAt !== null && Math.abs(this.parkedAt - r.beat) < 1e-6) return null;
      this.parkedAt = r.beat;
      return { quarters: r.beat, atMs: r.atMs, running: false, bpm: this.tempo };
    }
    this.parkedAt = null;
    if (linkBeat !== null && Number.isFinite(linkBeat)) {
      const diff = r.beat - linkBeat;
      const kept = this.diffs.length ? median(this.diffs) : null;
      if (kept !== null && Math.abs(diff - kept) > LIVE_JUMP_QUARTERS) this.diffs = [];
      this.diffs.push(diff);
      if (this.diffs.length > KEEP) this.diffs.shift();
      // Settled on Link: Link's clock gives the position (poll), the report
      // only keeps the difference up to date.
      if (this.diffs.length >= 3) return { quarters: linkBeat + median(this.diffs), atMs: r.atMs, running: true, bpm: this.tempo };
    } else {
      this.diffs = [];
    }
    return { quarters: r.beat, atMs: r.atMs, running: true, bpm: this.tempo };
  }

  /** Between reports: the position off Link's clock while Live plays. */
  poll(nowMs: number, linkBeat: number | null): LiveSongFeed | null {
    const offset = this.linkOffset;
    if (!this.playing || offset === null || linkBeat === null || !Number.isFinite(linkBeat)) return null;
    return { quarters: linkBeat + offset, atMs: nowMs, running: true, bpm: this.tempo };
  }

  reset(): void {
    this.diffs = [];
    this.lastAt = Number.NaN;
    this.parkedAt = null;
    this.playing = false;
  }
}
