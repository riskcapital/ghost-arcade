import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { dismissToast, showToast, toasts } from './errorToast';

describe('error toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toasts.set([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives toasts shown in the same millisecond different ids', () => {
    showToast('a');
    showToast('b');
    const [first, second] = get(toasts);
    expect(first.id).not.toBe(second.id);
  });

  it('dismisses only the toast whose id is passed', () => {
    showToast('a');
    showToast('b');
    const [first, second] = get(toasts);
    dismissToast(first.id);
    expect(get(toasts)).toEqual([second]);
  });

  it('auto-dismisses each toast after 5 seconds', () => {
    showToast('a');
    showToast('b');
    vi.advanceTimersByTime(4999);
    expect(get(toasts)).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(get(toasts)).toHaveLength(0);
  });
});
