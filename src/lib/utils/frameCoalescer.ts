// Run a pointer handler at most once per display frame, with the latest
// arguments. Mice report moves faster than the screen redraws; applying
// each one ran the whole project-store cascade several times per frame.
// `flush` applies a waiting call now (on release, before the undo step is
// recorded), `cancel` drops it.

export interface FrameCoalescer<A extends unknown[]> {
  schedule(...args: A): void;
  flush(): void;
  cancel(): void;
}

export function createFrameCoalescer<A extends unknown[]>(run: (...args: A) => void): FrameCoalescer<A> {
  let pending: A | null = null;
  let frame: number | null = null;
  const hasRaf = () => typeof requestAnimationFrame === 'function';

  function fire() {
    frame = null;
    const args = pending;
    pending = null;
    if (args) run(...args);
  }

  return {
    schedule(...args: A) {
      pending = args;
      if (!hasRaf()) { fire(); return; }
      if (frame === null) frame = requestAnimationFrame(fire);
    },
    flush() {
      if (frame !== null && hasRaf()) cancelAnimationFrame(frame);
      fire();
    },
    cancel() {
      if (frame !== null && hasRaf()) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    },
  };
}
