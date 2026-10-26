import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredRecorder } from './deferredRecorder';

describe('createDeferredRecorder', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('records once after a held key stops repeating', () => {
    const record = vi.fn();
    const r = createDeferredRecorder(record, 600);
    for (let i = 0; i < 40; i++) {
      r.schedule();
      vi.advanceTimersByTime(30);
    }
    expect(record).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(record).toHaveBeenCalledTimes(1);
    expect(r.pending()).toBe(false);
  });

  it('flush records a waiting edit at once, and only once', () => {
    const record = vi.fn();
    const r = createDeferredRecorder(record, 600);
    r.schedule();
    expect(r.pending()).toBe(true);
    r.flush();
    expect(record).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing waiting records nothing', () => {
    const record = vi.fn();
    const r = createDeferredRecorder(record, 600);
    r.flush();
    expect(record).not.toHaveBeenCalled();
  });

  it('separate runs are separate records', () => {
    const record = vi.fn();
    const r = createDeferredRecorder(record, 600);
    r.schedule();
    r.flush();
    r.schedule();
    vi.advanceTimersByTime(600);
    expect(record).toHaveBeenCalledTimes(2);
  });
});
