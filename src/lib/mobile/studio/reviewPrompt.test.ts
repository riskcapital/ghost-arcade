import { describe, expect, it, vi } from 'vitest';
import { MapSaveWatch, REVIEW_KEY, loadReviewState, markAsked, mayAskForReview, noteLaunch, reviewAfterSuccess, saveReviewState } from './reviewPrompt';
import { STORAGE_KEY } from './model';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}
/** One app start on `storage`, as MobileStudio does it. */
const launch = (storage: ReturnType<typeof memory>) => saveReviewState(noteLaunch(loadReviewState(storage)), storage);

describe('review prompt gating', () => {
  it('never asks in the first session on a new device', async () => {
    const storage = memory();
    launch(storage);
    const request = vi.fn(async () => true);
    expect(await reviewAfterSuccess('recording-saved', { version: async () => '1.2', request, storage })).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it('asks after a success moment from the second start on, once per version', async () => {
    const storage = memory();
    launch(storage); launch(storage);
    const request = vi.fn(async () => true);
    expect(await reviewAfterSuccess('map-saved', { version: async () => '1.2', request, storage })).toBe(true);
    expect(await reviewAfterSuccess('recording-shared', { version: async () => '1.2', request, storage })).toBe(false);
    launch(storage);
    expect(await reviewAfterSuccess('recording-saved', { version: async () => '1.2', request, storage })).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await reviewAfterSuccess('recording-saved', { version: async () => '1.3', request, storage })).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('treats a device that already holds a set (an update from 1.1) as past its first start', async () => {
    const storage = memory({ [STORAGE_KEY]: '{}' });
    launch(storage);
    const request = vi.fn(async () => true);
    expect(await reviewAfterSuccess('map-saved', { version: async () => '1.2', request, storage })).toBe(true);
  });
  it('asks only once when two moments land together', async () => {
    const storage = memory();
    launch(storage); launch(storage);
    const request = vi.fn(async () => true);
    const both = await Promise.all([
      reviewAfterSuccess('recording-saved', { version: async () => '1.2', request, storage }),
      reviewAfterSuccess('recording-shared', { version: async () => '1.2', request, storage }),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('a prompt iOS chose not to show still uses up the version', async () => {
    const storage = memory();
    launch(storage); launch(storage);
    const request = vi.fn(async () => false);
    await reviewAfterSuccess('map-saved', { version: async () => '1.2', request, storage });
    expect(JSON.parse(storage.data.get(REVIEW_KEY)!).askedVersion).toBe('1.2');
  });
  it('without a known version it never asks', () => {
    expect(mayAskForReview({ launches: 5, askedVersion: null }, '')).toBe(false);
    expect(mayAskForReview(markAsked({ launches: 5, askedVersion: null }, '1.2'), '1.2')).toBe(false);
  });
  it('repairs a damaged saved state', () => {
    expect(loadReviewState(memory({ [REVIEW_KEY]: '{"launches":"x","askedVersion":4}' }))).toEqual({ launches: 0, askedVersion: null });
    expect(loadReviewState(memory({ [REVIEW_KEY]: 'not json' }))).toEqual({ launches: 0, askedVersion: null });
  });
});

describe('map made', () => {
  const surface = (x: number) => ({ points: [{ x, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
  it('fires once when the person leaves Map with mapping on after moving a surface', () => {
    const watch = new MapSaveWatch();
    expect(watch.update('perform', true, [surface(0)])).toBe(false);
    expect(watch.update('map', true, [surface(0)])).toBe(false);
    expect(watch.update('map', true, [surface(0.2)])).toBe(false);
    expect(watch.update('perform', true, [surface(0.2)])).toBe(true);
    expect(watch.update('perform', true, [surface(0.2)])).toBe(false);
  });
  it('does not fire for a visit that changed nothing, or with mapping off', () => {
    const watch = new MapSaveWatch();
    watch.update('map', true, [surface(0)]);
    expect(watch.update('flux', true, [surface(0)])).toBe(false);
    watch.update('map', false, [surface(0)]);
    expect(watch.update('perform', false, [surface(0.3)])).toBe(false);
  });
});
