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

describe('factory drum sound playback', () => {
  it('selects the designed kit on launch and keeps the full four-bar break', () => {
    runtime.killAll();
    store.musicStudio.setDrumKit('kit.boom');
    runtime.launchLoop('floor-oxide-beat', true);
    expect(get(store.musicStudio).drumKit).toBe('kit.chopped-room');
    expect(get(store.musicStudio).pattern.steps).toBe(64);
    runtime.killAll();
  });
  it('auditions a kit then restores the previous kit', () => {
    store.musicStudio.setDrumKit('kit.boom');
    runtime.previewLoop('floor-oxide-beat');
    expect(get(store.musicStudio).drumKit).toBe('kit.chopped-room');
    runtime.stopPreview();
    expect(get(store.musicStudio).drumKit).toBe('kit.boom');
  });
  it('does not undo a kit the performer chooses during an audition', () => {
    runtime.previewLoop('floor-oxide-beat');
    store.musicStudio.setDrumKit('kit.pixel-console');
    runtime.stopPreview();
    expect(get(store.musicStudio).drumKit).toBe('kit.pixel-console');
  });
  it('plays a saved beat clip with its kit', async () => {
    const {clipFromPreset,normalizeClip} = await import('./session');
    const clip=normalizeClip(JSON.parse(JSON.stringify(clipFromPreset('floor-blacksteel-beat',get(store.musicStudio).key,'industrial-test'))))!;
    const row=store.musicStudio.addSessionClip('beats',clip);
    runtime.launchClip('beats',row,true);
    expect(get(store.musicStudio).drumKit).toBe('kit.black-steel');
    runtime.killAll();
  });
});
