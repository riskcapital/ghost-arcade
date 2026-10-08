import { describe, expect, it, vi } from 'vitest';
import { keepAwake } from './wakeLock';

function host() {
  const listeners: Record<string, Array<() => void>> = {};
  const add = (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn); };
  const remove = (type: string, fn: () => void) => { listeners[type] = (listeners[type] ?? []).filter(l => l !== fn); };
  const sentinels: Array<{ release: ReturnType<typeof vi.fn>; systemRelease: () => void }> = [];
  const request = vi.fn(async () => {
    let onRelease = () => {};
    const sentinel = { release: vi.fn(async () => {}), addEventListener: (_type: 'release', fn: () => void) => { onRelease = fn; }, systemRelease: () => onRelease() };
    sentinels.push(sentinel);
    return sentinel;
  });
  const doc = { visibilityState: 'visible', addEventListener: add, removeEventListener: remove };
  const h = { nav: { wakeLock: { request } }, doc, win: { addEventListener: add, removeEventListener: remove } } as never;
  const fire = (type: string) => { for (const fn of [...(listeners[type] ?? [])]) fn(); };
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  return { h, doc, request, sentinels, fire, settle, listeners };
}

describe('screen wake lock', () => {
  it('asks again after the system releases it in the background', async () => {
    const t = host();
    const awake = keepAwake(t.h);
    await t.settle();
    expect(t.request).toHaveBeenCalledTimes(1);
    expect(awake.held).toBe(true);
    // App switcher: the page is hidden and the system drops the lock.
    t.doc.visibilityState = 'hidden';
    t.sentinels[0].systemRelease();
    t.fire('visibilitychange');
    await t.settle();
    expect(awake.held).toBe(false);
    expect(t.request).toHaveBeenCalledTimes(1);
    // Back in the app: the reviewed bug was that nothing asked for it again.
    t.doc.visibilityState = 'visible';
    t.fire('visibilitychange');
    await t.settle();
    expect(t.request).toHaveBeenCalledTimes(2);
    expect(awake.held).toBe(true);
    awake.stop();
  });
  it('does not stack requests while one is held or pending', async () => {
    const t = host();
    const awake = keepAwake(t.h);
    t.fire('focus'); t.fire('pointerdown'); t.fire('pageshow');
    await t.settle();
    t.fire('pointerdown');
    await t.settle();
    expect(t.request).toHaveBeenCalledTimes(1);
    awake.stop();
  });
  it('retries on the next touch when the first request is refused', async () => {
    const t = host();
    t.request.mockRejectedValueOnce(new Error('NotAllowedError'));
    const awake = keepAwake(t.h);
    await t.settle();
    expect(awake.held).toBe(false);
    t.fire('pointerdown');
    await t.settle();
    expect(awake.held).toBe(true);
    awake.stop();
  });
  it('releases the lock and stops listening when the studio closes', async () => {
    const t = host();
    const awake = keepAwake(t.h);
    await t.settle();
    awake.stop();
    expect(t.sentinels[0].release).toHaveBeenCalledOnce();
    expect(Object.values(t.listeners).flat()).toEqual([]);
    t.fire('visibilitychange');
    await t.settle();
    expect(t.request).toHaveBeenCalledTimes(1);
  });
  it('is a no-op where the API does not exist', () => {
    const t = host();
    (t.h as { nav: object }).nav = {};
    expect(() => keepAwake(t.h).stop()).not.toThrow();
  });
});
