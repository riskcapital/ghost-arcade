import { afterEach, expect, it, vi } from 'vitest';
import { createCoalescedWriter } from './coalescedWriter';
afterEach(() => vi.useRealTimers());
it('coalesces a burst into one preparation and commit', async () => {
  vi.useFakeTimers();
  const prepare = vi.fn(async (n: number) => n), commit = vi.fn();
  const writer = createCoalescedWriter(prepare, commit, vi.fn());
  for (let i = 0; i < 100; i++) writer.write(i);
  await vi.advanceTimersByTimeAsync(250);
  expect(prepare).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledWith(99);
});
it('never commits a stale asynchronous preparation', async () => {
  let finish!: (n: number) => void;
  const commit = vi.fn();
  const writer = createCoalescedWriter((n: number) => n === 1 ? new Promise<number>(r => finish = r) : Promise.resolve(n), commit, vi.fn());
  writer.write(1); const flushing = writer.flush();
  writer.write(2); finish(1); await flushing;
  expect(commit.mock.calls).toEqual([[2]]);
});
it('flushes explicit saves and bounds continuous-edit delay', async () => {
  vi.useFakeTimers(); const commit = vi.fn();
  const writer = createCoalescedWriter(async (n: number) => n, commit, vi.fn());
  for (let i = 0; i < 10; i++) { writer.write(i); await vi.advanceTimersByTimeAsync(100); }
  expect(commit).toHaveBeenCalledWith(9);
  writer.write(10); await writer.flush(); expect(commit).toHaveBeenLastCalledWith(10);
});
