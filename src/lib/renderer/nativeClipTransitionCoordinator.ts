export interface NativeClipTransitionTask {
  key: string;
  token: number;
  duration: number;
  startedAtMs: number | null;
  requiresSnapshot: boolean;
  frozenSourceId?: string;
}

interface Options<T extends NativeClipTransitionTask> {
  read: () => T[];
  capture: (task: T) => Promise<string | null>;
  ready: (task: T) => Promise<boolean>;
  release: (sourceId: string) => Promise<{ released?: boolean; referenced?: boolean } | null>;
  onFrozen: (task: T, sourceId: string) => void;
  onReady: (task: T, now: number) => void;
  onComplete: (task: T) => void;
  onFrame: () => void;
  onError: (message: string) => void;
}

/** One asynchronous readiness/capture operation per row, with generations
 * guarding late answers. The live transition clock starts with real pixels,
 * while a retrigger's snapshot holds the previous scene until it is copied.
 */
export function createNativeClipTransitionCoordinator<T extends NativeClipTransitionTask>(options: Options<T>) {
  let frame: number | null = null;
  let disposed = false;
  let lastError = -Infinity;
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  const flights = new Map<string, { token: number; kind: 'capture' | 'ready'; cancelled: boolean }>();
  const retryAt = new Map<string, number>();
  const waitingSince = new Map<string, number>();
  const retired = new Set<string>();
  const releasing = new Set<string>();
  const releaseRetryAt = new Map<string, number>();
  const current = (key: string) => options.read().find(task => task.key === key);
  const report = (message: string) => {
    const now = performance.now();
    if (now - lastError >= 5000) { lastError = now; options.onError(message); }
  };

  const wake = () => {
    if (!disposed && frame === null) frame = requestAnimationFrame(tick);
  };
  const scheduleCleanup = () => {
    if (!disposed || retired.size === 0 || cleanupTimer !== null) return;
    // Once the Canvas is gone there is no animation loop to drain captures
    // that resolve later. Keep this small cleanup loop until the scene has
    // dropped its readers and the native owner confirms retirement.
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null;
      drainRetired([]);
    }, 250);
  };
  const retire = (sourceId: string) => {
    retired.add(sourceId);
    if (disposed) drainRetired([]);
    else wake();
  };
  const drainRetired = (tasks: T[]) => {
    for (const sourceId of retired) {
      // IDs are reused per row. A delayed cleanup must never delete the
      // snapshot adopted by a more recent retrigger or being overwritten.
      if (tasks.some(task => task.frozenSourceId === sourceId)
        || Array.from(flights.values()).some(flight => flight.kind === 'capture')) continue;
      if (releasing.has(sourceId)) continue;
      if ((releaseRetryAt.get(sourceId) ?? 0) > performance.now()) continue;
      releasing.add(sourceId);
      void options.release(sourceId).then(result => {
        if (result?.released || result?.referenced === false) {
          retired.delete(sourceId);
          releaseRetryAt.delete(sourceId);
        }
      }).catch(() => { /* Retry after scene reconciliation removes the reader. */ })
        .finally(() => {
          releasing.delete(sourceId);
          if (retired.has(sourceId)) releaseRetryAt.set(sourceId, performance.now() + 250);
          if (disposed) scheduleCleanup();
          else wake();
        });
    }
    scheduleCleanup();
  };

  function tick(now: number) {
    frame = null;
    if (disposed) return;
    const tasks = options.read();
    const keys = new Set(tasks.map(task => task.key));
    const generations = new Set(tasks.map(task => `${task.key}:${task.token}`));
    for (const key of waitingSince.keys()) if (!generations.has(key)) waitingSince.delete(key);
    for (const key of retryAt.keys()) if (!generations.has(key)) retryAt.delete(key);
    for (const [key, flight] of flights) if (!keys.has(key)) flight.cancelled = true;
    for (const task of tasks) {
      if (task.startedAtMs !== null && !task.requiresSnapshot) {
        if (now - task.startedAtMs >= task.duration * 1000) options.onComplete(task);
        continue;
      }
      const waitKey = `${task.key}:${task.token}`;
      if (!waitingSince.has(waitKey)) waitingSince.set(waitKey, now);
      if (now - waitingSince.get(waitKey)! > 10000) {
        report('The next clip is still preparing. The previous picture is being held.');
      }
      if ((retryAt.get(waitKey) ?? 0) > now) continue;
      const prior = flights.get(task.key);
      // A stale poll may finish harmlessly before a new one starts. Never
      // build an RPC backlog by polling every rapid trigger concurrently.
      if (prior) continue;
      const flight = { token: task.token, kind: task.requiresSnapshot ? 'capture' as const : 'ready' as const, cancelled: false };
      flights.set(task.key, flight);
      void (async () => {
        try {
          if (flight.kind === 'capture') {
            const sourceId = await options.capture(task);
            const latest = !disposed && !flight.cancelled ? current(task.key) : undefined;
            if (!sourceId) throw new Error('The current transition picture could not be captured.');
            if (latest?.requiresSnapshot) {
              // While capture is pending the renderer keeps the same old
              // scene, so the result is also valid for the latest retrigger.
              options.onFrozen(latest, sourceId);
            } else retire(sourceId);
          } else {
            const ready = await options.ready(task);
            const latest = !disposed && !flight.cancelled ? current(task.key) : undefined;
            if (ready && latest?.token === task.token && !latest.requiresSnapshot) {
              options.onReady(latest, performance.now());
            }
          }
        } catch (error) {
          if (!disposed && !flight.cancelled && current(task.key)?.token === task.token) {
            retryAt.set(waitKey, performance.now() + 250);
            report(error instanceof Error ? error.message : 'The clip transition is waiting for the renderer.');
          }
        } finally {
          if (flights.get(task.key) === flight) flights.delete(task.key);
          if (disposed) drainRetired([]);
          else wake();
        }
      })();
    }
    options.onFrame();
    drainRetired(options.read());
    if (options.read().length || retired.size) wake();
  }

  return {
    refresh: wake,
    retire,
    destroy() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      for (const flight of flights.values()) flight.cancelled = true;
      for (const task of options.read()) if (task.frozenSourceId) retired.add(task.frozenSourceId);
      waitingSince.clear();
      retryAt.clear();
      drainRetired([]);
    },
  };
}
