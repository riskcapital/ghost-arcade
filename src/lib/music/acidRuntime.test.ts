/**
 * Switching sets never brings in a sound nobody started: in Berlin the acid
 * line plays with the beat only when it is switched on.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const calls: string[] = [];
vi.mock('./audioEngine', () => {
  class MusicAudioEngine {
    constructor() {
      return new Proxy(this, {
        get: (_t, prop) => (...args: unknown[]) => {
          if (prop === 'play') calls.push(String((args[0] as { instrument: string; type?: string }).instrument));
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

describe('the acid line', () => {
  const acidNotes = () => calls.filter((c) => c === 'acid').length;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('stays quiet when you switch to Berlin with the beat running', async () => {
    store.musicStudio.setSet('berlin');
    runtime.startSequencer();
    await wait(400);
    expect(acidNotes()).toBe(0);
    expect(calls).toContain('drums');
  });

  it('plays once switched on, and stops when switched off', async () => {
    store.musicStudio.setAcidOn(true);
    // It comes in on the next bar: give the clock time to get there.
    await wait(2300);
    expect(acidNotes()).toBeGreaterThan(0);
    store.musicStudio.setAcidOn(false);
    await wait(150);
    const after = acidNotes();
    await wait(400);
    expect(acidNotes()).toBe(after);
    runtime.killAll();
  });
});
