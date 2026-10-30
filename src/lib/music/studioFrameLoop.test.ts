/**
 * The music runtime's frame loop while a Music Studio clip or layer shows.
 *
 * Every frame bumps the studio tick, the renderer resyncs the scene on it,
 * and that resync wakes the loop again (it does not know the loop is
 * already running). The loop must stay one frame callback, never two: a
 * second one doubles every frame and freezes the app within a second.
 */

import { beforeAll, describe, expect, it } from 'vitest';

let runtime: typeof import('./musicRuntime');
let plugin: typeof import('./studioPlugin');

const queue: Array<(t: number) => void> = [];

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
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => queue.push(cb);
  (globalThis as any).cancelAnimationFrame = () => {};
}

/** Run the frame callbacks queued now; returns how many were the music runtime's loop. */
function runFrame(): number {
  const due = queue.splice(0);
  for (const cb of due) cb(performance.now());
  return due.filter((cb) => cb.name === 'frame').length;
}

beforeAll(async () => {
  installShim();
  runtime = await import('./musicRuntime');
  plugin = await import('./studioPlugin');
});

describe('the studio frame loop', () => {
  it('stays one frame while a studio shows, and stops when none does', () => {
    let ticks = 0;
    // What the renderer does on each tick: resync, which wakes the loop.
    const unsub = plugin.studioVisualTick.subscribe(() => {
      ticks++;
      plugin.noteStudioHosts(1);
      runtime.wakeStudioVisuals();
    });
    plugin.noteStudioHosts(1);
    runtime.wakeStudioVisuals();
    const before = ticks;
    for (let i = 0; i < 20; i++) expect(runFrame()).toBe(1);
    // The voices follow the clock even before the studio's audio exists.
    expect(ticks - before).toBe(20);

    unsub();
    plugin.noteStudioHosts(0);
    runFrame();
    expect(queue.filter((cb) => cb.name === 'frame')).toHaveLength(0);
  });
});
