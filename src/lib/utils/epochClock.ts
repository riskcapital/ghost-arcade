/**
 * Wall-clock epoch milliseconds that two windows (renderer processes) agree
 * on, with sub-millisecond steps.
 *
 * `performance.timeOrigin + performance.now()` looks like this but is not:
 * `performance.now()` is a monotonic clock that stops while a Mac sleeps,
 * and `timeOrigin` is fixed when the process starts. A window opened before
 * a laptop sleep then runs behind one opened after it by the whole sleep
 * (minutes), so the Stage Sim's recordings took the wrong part of the song.
 *
 * Here `performance.now()` is anchored to `Date.now()`, which every process
 * reads from the same system clock. The anchor follows `Date.now()` slowly
 * (it only has whole milliseconds) and jumps when the two disagree by more
 * than a few milliseconds: after a sleep, or when the system clock is set.
 */

/** A disagreement larger than this is a jump (sleep, clock set), not jitter. */
const JUMP_MS = 4;
/** How much of the difference one reading takes while they agree. */
const FOLLOW = 0.002;

export interface EpochClockSources {
  /** Monotonic milliseconds (performance.now). */
  monotonic(): number;
  /** Wall-clock epoch milliseconds (Date.now). */
  wall(): number;
}

export interface EpochClock {
  /** Epoch milliseconds now. */
  now(): number;
  /** The epoch of a `performance.now()` reading taken in this window. */
  fromMonotonic(monotonicMs: number): number;
  /** `epoch - monotonic` as the clock holds it now. */
  offset(): number;
}

export function createEpochClock(sources: EpochClockSources): EpochClock {
  let offset: number | null = null;
  const sync = (): number => {
    const mono = sources.monotonic();
    // Date.now() truncates: the true offset is up to 1 ms above this reading.
    const measured = sources.wall() + 0.5 - mono;
    if (offset === null || Math.abs(measured - offset) > JUMP_MS) offset = measured;
    else offset += (measured - offset) * FOLLOW;
    return mono;
  };
  return {
    now() {
      const mono = sync();
      return mono + (offset as number);
    },
    fromMonotonic(monotonicMs: number) {
      sync();
      return monotonicMs + (offset as number);
    },
    offset() {
      sync();
      return offset as number;
    },
  };
}

const hasPerformance = typeof performance !== 'undefined' && typeof performance.now === 'function';
const defaultClock = createEpochClock({
  monotonic: () => (hasPerformance ? performance.now() : Date.now()),
  wall: () => Date.now(),
});

/** Epoch milliseconds now, comparable across windows. */
export function epochNow(): number {
  return defaultClock.now();
}

/** Epoch milliseconds of a `performance.now()` reading from this window. */
export function epochFromPerformance(performanceMs: number): number {
  return defaultClock.fromMonotonic(performanceMs);
}
