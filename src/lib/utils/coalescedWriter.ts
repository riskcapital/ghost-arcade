/** Serialize only the latest revision. Slow preparation cannot overwrite newer edits. */
export function createCoalescedWriter<T, R>(prepare: (value: T) => Promise<R>, commit: (value: R) => void,
  onError: (error: unknown) => void, delay = 250, maxWait = 1000) {
  let revision = 0;
  let pending: { value: T; revision: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | null = null;
  function clearTimers() { clearTimeout(timer); clearTimeout(deadline); timer = deadline = undefined; }
  async function flush(): Promise<void> {
    clearTimers();
    if (active) { await active; if (pending) return flush(); return; }
    const job = pending;
    if (!job) return;
    pending = null;
    active = (async () => {
      try { const prepared = await prepare(job.value); if (job.revision === revision) commit(prepared); }
      catch (error) { onError(error); }
    })();
    await active;
    active = null;
    if (pending) return flush();
  }
  return {
    write(value: T) {
      pending = { value, revision: ++revision };
      clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, delay);
      deadline ??= setTimeout(() => { void flush(); }, maxWait);
    },
    flush,
  };
}
