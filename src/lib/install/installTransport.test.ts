/**
 * Install mode plays the Show or the Timeline through its transport adapter:
 * acting on a document makes it the active one, and the parked one reports
 * its own playhead.
 */

import { beforeAll, describe, expect, it } from 'vitest';

function installDomShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const makeEl = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => null,
  });
  (globalThis as any).document = {
    documentElement: makeEl(), body: makeEl(), head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

let show: typeof import('../stores/showTimeline');
let transport: typeof import('./installTransport');

beforeAll(async () => {
  installDomShim();
  show = await import('../stores/showTimeline');
  transport = await import('./installTransport');
});

describe('install transport', () => {
  it('switches the active document and reads the parked one', async () => {
    const t = await transport.defaultInstallTransport();
    t.setActiveDocument('show');
    expect(show.showTimeline.activeDoc()).toBe('show');
    t.seek('timeline', 0);
    expect(show.showTimeline.activeDoc()).toBe('timeline');
    const parked = t.state('show');
    expect(parked.playing).toBe(false);
    expect(Number.isFinite(parked.time)).toBe(true);
    t.stop('show'); // not active: leaves the Timeline alone
    expect(show.showTimeline.activeDoc()).toBe('timeline');
  });
});
