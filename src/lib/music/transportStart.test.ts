/**
 * The studio's transport started for a beat, as a Link session start does:
 * nothing plays before it, a start just gone plays its downbeat at once, and
 * a start that only brings back what Stop stopped never starts a beat.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

const drums: number[] = [];
vi.mock('./audioEngine', () => {
  class MusicAudioEngine {
    constructor() {
      return new Proxy(this, {
        get: (_t, prop) => (...args: unknown[]) => {
          const ev = args[0] as { instrument?: string; type?: string; time?: number } | undefined;
          if (prop === 'play' && ev?.instrument === 'drums' && ev.type === 'on') drums.push(ev.time ?? 0);
          return 0;
        },
      });
    }
  }
  return { MusicAudioEngine };
});

const clock = { beat: 13, beatMs: 500 };
vi.mock('../stores/launchClock', async (orig) => ({
  ...(await orig<typeof import('../stores/launchClock')>()),
  launchClockPosition: () => ({ ...clock }),
  launchClockTempo: () => 120,
  launchClockFollowsLink: () => false,
}));

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
  store.musicStudio.setSet('berlin');
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('a transport start for a beat', () => {
  it('plays nothing before a start still to come, then comes in on it', async () => {
    drums.length = 0;
    clock.beat = 13;
    runtime.startSequencer(16);
    await wait(80);
    expect(drums).toEqual([]);
    // Just before beat 16 its downbeat is scheduled for 16, not earlier.
    clock.beat = 15.96;
    await wait(80);
    expect(drums.length).toBeGreaterThan(0);
    expect(Math.min(...drums)).toBeCloseTo(((16 - 15.96) * clock.beatMs) / 1000, 6);
    runtime.stopSequencer();
  });

  it('a start heard just after its beat plays the downbeat at once, not a bar later', async () => {
    drums.length = 0;
    clock.beat = 32.03;
    runtime.startSequencer(32);
    await wait(80);
    // Due at 32, gone already: it goes out now (time 0 is "now" here).
    expect(drums[0]).toBe(0);
    runtime.stopSequencer();
  });

  it('bringing back what Stop stopped never starts a beat by itself', async () => {
    runtime.killAll();
    expect(runtime.studioTransportPlaying()).toBe(false);
    runtime.playAll({ atBeat: 40, resumeOnly: true });
    expect(runtime.studioTransportPlaying()).toBe(false);
    // What Stop stopped comes back on the bar given.
    clock.beat = 41;
    runtime.startSequencer();
    expect(runtime.studioTransportPlaying()).toBe(true);
    runtime.stopAll();
    expect(runtime.studioTransportPlaying()).toBe(false);
    drums.length = 0;
    clock.beat = 45;
    runtime.playAll({ atBeat: 48, resumeOnly: true });
    expect(runtime.studioTransportPlaying()).toBe(true);
    await wait(80);
    expect(drums).toEqual([]);
    runtime.killAll();
  });
});
