/**
 * Changing sets is changing instruments, not songs: the beat, the loops and
 * the clock keep going (musicRuntime.changeSetSounds). Kill still stops it all.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// The audio engine needs Web Audio; a stand-in that answers every call is enough here.
vi.mock('./audioEngine', () => {
  class MusicAudioEngine {
    constructor() {
      return new Proxy(this, {
        get: (target, prop) => (prop in target ? (target as any)[prop] : prop === 'now' || prop === 'peekNow' ? () => 0 : () => 0),
      });
    }
  }
  return { MusicAudioEngine };
});

let runtime: typeof import('./musicRuntime');
let store: typeof import('./musicStudioStore');
let loops: typeof import('./loops');

function installShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const el = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], getContext: () => null,
  });
  (globalThis as any).document = {
    documentElement: el(), body: el(), head: el(), createElement: () => el(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).addEventListener = () => {};
  (globalThis as any).removeEventListener = () => {};
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = () => 0;
  (globalThis as any).cancelAnimationFrame = () => {};
}

beforeAll(async () => {
  installShim();
  runtime = await import('./musicRuntime');
  store = await import('./musicStudioStore');
  loops = await import('./loops');
});

describe('switching sets', () => {
  it('keeps the beat and the loops running', () => {
    const { musicStudio } = store;
    musicStudio.open();
    musicStudio.setSet('berlin');
    runtime.startSequencer();
    const bass = loops.MELODIC_LOOPS.find((l) => l.role === 'bass')!;
    runtime.launchLoop(bass.id, true);
    const before = get(musicStudio);
    const loopBefore = before.playingLoops.bass ?? before.queuedLoops.bass;
    expect(before.sequencerPlaying).toBe(true);
    expect(loopBefore).toBe(bass.id);
    const pattern = before.pattern;

    for (const set of ['dub', 'bath', 'analog', 'berlin'] as const) {
      musicStudio.setSet(set);
      const s = get(musicStudio);
      expect(s.sequencerPlaying, `beat after switching to ${set}`).toBe(true);
      expect(s.pattern, `the same beat in ${set}`).toBe(pattern);
      expect(s.playingLoops.bass ?? s.queuedLoops.bass, `bass loop in ${set}`).toBe(bass.id);
    }
  });

  it('still stops everything on Kill', () => {
    runtime.killAll();
    const s = get(store.musicStudio);
    expect(s.sequencerPlaying).toBe(false);
    expect(Object.keys(s.playingLoops)).toHaveLength(0);
  });
});
