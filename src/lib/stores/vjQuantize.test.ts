import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// Launch quantize: queued clips and columns fire on the shared launch clock,
// the grid the tempo display, Resync and Link use.

let launcher: typeof import('./vjClipLauncher');
let clock: typeof import('./launchClock');
let audio: typeof import('./audio');
let now = 1000;

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
    load() {}, play: () => Promise.resolve(), pause() {},
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
  (globalThis as any).matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  // One animation frame per call to step(); time only moves when the test moves it.
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(now), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

const clip = (id: string) => ({ id, type: 'image' as const, name: id, src: `/${id}.png` });
const active = (row: number) => get(launcher.vjClipLauncher).layerStates[row]?.activeClip?.id ?? null;
const pending = () => get(launcher.vjClipLauncher).pendingTriggers;

/** Move the clock to `ms` and run the frame the quantize tick waits on. */
async function stepTo(ms: number): Promise<void> {
  now = ms;
  await vi.advanceTimersByTimeAsync(1);
}

beforeAll(async () => {
  installDomShim();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  launcher = await import('./vjClipLauncher');
  clock = await import('./launchClock');
  audio = await import('./audio');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const vj = launcher.vjClipLauncher;
  vj.setQuantization('off');
  vj.setClip(0, 0, clip('a0') as any, 'A');
  vj.setClip(0, 1, clip('a1') as any, 'A');
  vj.setClip(1, 0, clip('b0') as any, 'A');
  vj.setClip(1, 1, clip('b1') as any, 'A');
  vj.triggerClipNow(0, 0, 'A');
  vj.triggerClipNow(1, 0, 'A');
  // 120 BPM (500 ms beats), with a downbeat at `now`.
  now += 10_000;
  audio.audioStore.setManualBPM(120);
  clock.resyncLaunchClock(now);
  vj.setQuantization('1bar');
});

afterEach(async () => {
  launcher.vjClipLauncher.setQuantization('off');
  // Let the quantize tick see the empty queue and stop, so the next test
  // starts its own tick.
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

describe('launch quantize', () => {
  it('fires a queued clip on the next bar of the launch clock', async () => {
    const bar = now;
    await stepTo(bar + 300);
    launcher.vjClipLauncher.triggerClip(0, 1, 'A');
    expect(pending()).toHaveLength(1);
    await stepTo(bar + 1990);
    expect(active(0)).toBe('a0');
    await stepTo(bar + 2000);
    expect(active(0)).toBe('a1');
    expect(pending()).toHaveLength(0);
  });

  it('follows a resync made while the clip is queued', async () => {
    const bar = now;
    await stepTo(bar + 300);
    launcher.vjClipLauncher.triggerClip(0, 1, 'A');
    // The performer resyncs half a second later: bars now start there.
    await stepTo(bar + 800);
    clock.resyncLaunchClock(now);
    await stepTo(bar + 2000);
    expect(active(0)).toBe('a0');
    await stepTo(bar + 2800);
    expect(active(0)).toBe('a1');
  });

  it('queues a column and fires every row of it together', async () => {
    const bar = now;
    await stepTo(bar + 100);
    launcher.vjClipLauncher.triggerColumn(1, 'A');
    expect(pending()).toEqual([expect.objectContaining({ kind: 'column', columnIndex: 1, bank: 'A' })]);
    expect([active(0), active(1)]).toEqual(['a0', 'b0']);
    await stepTo(bar + 2000);
    expect([active(0), active(1)]).toEqual(['a1', 'b1']);
  });

  it('cancels a queued column when it is launched again', async () => {
    await stepTo(now + 100);
    launcher.vjClipLauncher.triggerColumn(1, 'A');
    launcher.vjClipLauncher.triggerColumn(1, 'A');
    expect(pending()).toHaveLength(0);
  });

  it('lets a cell launch replace the queued column on its deck', async () => {
    const bar = now;
    await stepTo(bar + 100);
    launcher.vjClipLauncher.triggerColumn(1, 'A');
    launcher.vjClipLauncher.triggerClip(1, 1, 'A');
    expect(pending()).toEqual([expect.objectContaining({ kind: 'clip', layerIndex: 1, columnIndex: 1 })]);
    await stepTo(bar + 2000);
    expect([active(0), active(1)]).toEqual(['a0', 'b1']);
  });

  it('drops a queued clip whose cell changed before it fired', async () => {
    const bar = now;
    await stepTo(bar + 100);
    launcher.vjClipLauncher.triggerClip(0, 1, 'A');
    launcher.vjClipLauncher.setClip(0, 1, clip('replaced') as any, 'A');
    await stepTo(bar + 2000);
    expect(active(0)).toBe('a0');
  });

  it('fires at once with quantize off', () => {
    launcher.vjClipLauncher.setQuantization('off');
    launcher.vjClipLauncher.triggerColumn(1, 'A');
    expect(pending()).toHaveLength(0);
    expect([active(0), active(1)]).toEqual(['a1', 'b1']);
  });
});
