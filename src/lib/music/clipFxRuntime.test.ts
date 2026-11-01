/**
 * A clip's own effects are in its sound while it plays, including effects
 * added after it was launched.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const clipInserts: [string, number][] = [];
vi.mock('./audioEngine', () => {
  class MusicAudioEngine {
    constructor() {
      return new Proxy(this, {
        get: (_t, prop) => (...args: unknown[]) => {
          if (prop === 'setClipInserts') clipInserts.push([String(args[0]), (args[1] as unknown[] | null)?.length ?? 0]);
          return 0;
        },
      });
    }
  }
  return { MusicAudioEngine };
});

let runtime: typeof import('./musicRuntime');
let store: typeof import('./musicStudioStore');

beforeAll(async () => {
  const storage = new Map<string, string>();
  const g = globalThis as any;
  g.localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
  const el = (): any => ({ style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, appendChild: (c: any) => c, removeChild: (c: any) => c, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getContext: () => null });
  g.document = { documentElement: el(), body: el(), head: el(), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  g.window = globalThis;
  g.dispatchEvent = () => true;
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  runtime = await import('./musicRuntime');
  store = await import('./musicStudioStore');
  store.musicStudio.open();
});

describe('clip effects', () => {
  it('come in on a playing clip as they are added, on its instrument', async () => {
    const { clipFromPreset, clipFxKey } = await import('./session');
    const s = get(store.musicStudio);
    const clip = clipFromPreset('cur-chords-hilltop-skank', s.key, 'clip-test')!;
    const row = store.musicStudio.addSessionClip('chords', clip);
    runtime.launchClip('chords', row, true);
    await new Promise((r) => setTimeout(r, 30));
    const channel = clipInserts.at(-1)?.[0];
    expect(channel).toBeTruthy();
    store.musicStudio.addInsert(clipFxKey('clip-test'), 'fx-1', 'delay');
    await new Promise((r) => setTimeout(r, 10));
    expect(clipInserts.at(-1)).toEqual([channel, 1]);
    runtime.stopTrack('chords');
    expect(clipInserts.at(-1)).toEqual([channel, 0]);
  });
});
