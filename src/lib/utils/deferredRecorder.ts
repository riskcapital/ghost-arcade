/**
 * Record once a burst of edits stops.
 *
 * A held arrow key repeats many times a second; recording each press would
 * fill the undo list with one-pixel steps. `schedule()` after each edit
 * records `idleMs` after the last one, and `flush()` records straight away
 * when one is waiting (the key came up, or an undo needs the history to be
 * current).
 */
export interface DeferredRecorder {
  /** An edit happened: record once the edits stop. */
  schedule(): void;
  /** Record now if an edit is waiting. */
  flush(): void;
  /** True while an edit is waiting to be recorded. */
  pending(): boolean;
}

export function createDeferredRecorder(record: () => void, idleMs: number): DeferredRecorder {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    record();
  };
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, idleMs);
    },
    flush() {
      if (!timer) return;
      clearTimeout(timer);
      fire();
    },
    pending() {
      return timer !== null;
    },
  };
}
