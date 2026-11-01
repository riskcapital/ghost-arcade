/**
 * Build, drop and cancel in the runtime: a build lands on a bar line, and a
 * cancel (or Kill) puts the mix back.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const calls: string[] = [];
vi.mock('./audioEngine', () => {
  class MusicAudioEngine {
    constructor() {
      return new Proxy(this, {
        get: (_t, prop) => (...args: unknown[]) => {
          if (prop === 'startBuild' || prop === 'cancelBuild') calls.push(String(prop));
          void args;
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

describe('build and drop', () => {
  it('builds to a bar line and cancels back to rest', () => {
    store.musicStudio.setBuild({ bars: 2 });
    runtime.startBuild();
    const st = get(runtime.buildState);
    expect(st.phase).toBe('building');
    expect(st.land % 4).toBe(0);
    expect(st.land - st.start).toBeGreaterThanOrEqual(8);
    expect(calls).toContain('startBuild');
    runtime.toggleBuild();
    expect(get(runtime.buildState)).toEqual({ phase: 'idle', start: 0, land: 0, progress: 0 });
    expect(calls[calls.length - 1]).toBe('cancelBuild');
  });

  it('drops on the next bar line', () => {
    runtime.dropNow();
    const st = get(runtime.buildState);
    expect(st.land % 4).toBe(0);
    expect(st.land - st.start).toBeLessThanOrEqual(8);
    runtime.killAll();
    expect(get(runtime.buildState).phase).toBe('idle');
  });

  it('switching style brings that style’s sound', () => {
    store.musicStudio.setBuild({ style: 'dub' });
    const b = get(store.musicStudio).build;
    expect(b).toMatchObject({ style: 'dub', roll: 'clap', filter: 'lowpass', bars: 2 });
  });
});
