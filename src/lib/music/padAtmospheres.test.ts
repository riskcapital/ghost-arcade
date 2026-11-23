/**
 * The FX pads' atmospheres (Rain, Wind, Night...) switch on and off with a
 * press, whatever stopped them in between; the transport offers Stop while
 * one plays, and Stop, Kill and closing the pads panel silence them.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

/** What the fake engine has playing, as the real one tracks it. */
const engine = { loops: new Set<number>(), sounds: [] as string[], xyReleased: 0 };

vi.mock('./audioEngine', () => {
  class MusicAudioEngine {
    constructor() {
      const own: Record<string, (...args: any[]) => unknown> = {
        play: (event: { instrument: string; type: string; note: number }) => {
          if (event.instrument !== 'shots' || event.note >= 76) return;
          const index = event.note - 60;
          if (event.type === 'on') engine.loops.add(index);
          else engine.loops.delete(index);
        },
        padLoopPlaying: (index: number) => engine.loops.has(index),
        setPadSounds: (ids: string[]) => {
          ids.forEach((id, i) => { if (engine.sounds[i] !== id) engine.loops.delete(i); });
          engine.sounds = [...ids];
        },
        stopPadLoops: () => engine.loops.clear(),
        allNotesOff: () => engine.loops.clear(),
        releaseXy: () => { engine.xyReleased++; },
        now: () => 0,
        peekNow: () => 0,
      };
      return new Proxy(this, { get: (_t, prop) => own[prop as string] ?? (() => 0) });
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
  store.musicStudio.setSet('bath');
});

/** The bath's Wind pad. */
const WIND = 2;
const press = (index: number) => runtime.padDown(1, { kind: 'shot', index }, 0.8);
const lit = (index: number) => get(store.musicTransport).held.has(`shots:${60 + index}`);
const sustaining = () => !!get(store.musicTransport).sustaining;

describe('pad atmospheres', () => {
  it('start on one press and stop on the next', () => {
    expect(runtime.fxPadSound(WIND)?.id).toBe('wind');
    press(WIND);
    expect(engine.loops.has(WIND)).toBe(true);
    expect(lit(WIND)).toBe(true);
    expect(sustaining()).toBe(true);
    press(WIND);
    expect(engine.loops.has(WIND)).toBe(false);
    expect(lit(WIND)).toBe(false);
    expect(sustaining()).toBe(false);
  });

  it('still switch after the atmosphere stopped without its pad being pressed', () => {
    press(WIND);
    // Another sound on the pad and back again: the engine stopped it on its own.
    store.musicStudio.setFxPad(WIND, 'rain');
    store.musicStudio.setFxPad(WIND, 'wind');
    expect(engine.loops.has(WIND)).toBe(false);
    expect(lit(WIND)).toBe(false);
    press(WIND);
    expect(engine.loops.has(WIND)).toBe(true);
    press(WIND);
    expect(engine.loops.has(WIND)).toBe(false);
  });

  it('stop on Stop, Kill and when the pads panel goes', () => {
    press(WIND);
    runtime.stopAll();
    expect(engine.loops.size).toBe(0);
    expect(sustaining()).toBe(false);
    press(WIND);
    expect(engine.loops.has(WIND)).toBe(true);
    runtime.killAll();
    expect(engine.loops.size).toBe(0);
    press(WIND);
    runtime.stopPadAtmospheres();
    expect(engine.loops.size).toBe(0);
    expect(lit(WIND)).toBe(false);
    expect(sustaining()).toBe(false);
    // And the next press starts it again.
    press(WIND);
    expect(engine.loops.has(WIND)).toBe(true);
    runtime.stopAll();
  });
});

describe('the XY pad on a latched arp', () => {
  it('keeps the transport on Stop until Stop, and lets go when its panel goes', () => {
    runtime.playNote('xy', 60, 0.8, 'screen', 'arp.glass');
    runtime.releaseNote('xy', 60, 'screen', 'arp.glass');
    expect(sustaining()).toBe(true);
    runtime.stopAll();
    expect(sustaining()).toBe(false);
    runtime.playNote('xy', 62, 0.8, 'screen', 'arp.glass');
    runtime.releaseNote('xy', 62, 'screen', 'arp.glass');
    const before = engine.xyReleased;
    runtime.letGoXy();
    expect(engine.xyReleased).toBe(before + 1);
    expect(sustaining()).toBe(false);
  });
});
