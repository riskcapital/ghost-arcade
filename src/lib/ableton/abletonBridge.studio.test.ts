import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Inside the Music Studio, Live is played without decks: the connector's
 * deck mode, crossfader and links stand down while the studio hosts Live, and
 * come back when it lets go. Outside the studio, a two-sided set still links
 * its decks by itself.
 */

type Listener = (messages: Record<string, unknown>[]) => void;
let deliver: Listener = () => {};
const sent: Record<string, unknown>[] = [];

// The stores this test loads expect a browser; the same shim the layer tests use.
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
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).CustomEvent ??= class extends Event {
    detail: unknown;
    constructor(name: string, options: any) { super(name); this.detail = options.detail; }
  };
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(() => {
  installDomShim();
  (globalThis as any).window.ghostAbleton = {
    onMessage: (fn: Listener) => { deliver = fn; return () => {}; },
    onStatus: () => () => {},
    start: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true })),
    send: vi.fn(async (m: Record<string, unknown>) => { sent.push(m); }),
    scriptStatus: vi.fn(async () => ({})),
  };
});

async function load() {
  const { abletonBridge } = await import('./abletonBridge');
  const { vjClipLauncher, vjCrossfader: crossfaderPosition } = await import('../stores/vjClipLauncher');
  abletonBridge.initialize();
  return { abletonBridge, vjClipLauncher, crossfaderPosition };
}

const hello = (xf: number) => ({ t: 'hello', tempo: 120, num: 4, den: 4, playing: true, quantize: 4, beat: 0, xf });
const set = { t: 'set', scenes: [{ n: 'Intro', c: 0 }, { n: 'Drop', c: 0 }], count: 2, tracks: 2, cues: [] };
const track = (i: number, n: string, x: number) => ({ t: 'track', i, n, c: 0, midi: true, x, slots: [['Loop', 0, 4], null], count: 2, play: -1, fired: -1 });
const feed = { noteTracks: [0], levelTracks: [], onNotes: () => {}, onLevel: () => {} };

describe('the Ableton connector and the Music Studio', () => {
  it('links a two-sided set to the decks by itself, outside the studio', async () => {
    const { abletonBridge, vjClipLauncher, crossfaderPosition } = await load();
    deliver([hello(0.2), set, track(0, 'Deck A', 0), track(1, 'Deck B', 2)]);
    expect(get(abletonBridge).deckMode).toBe(true);
    expect(get(vjClipLauncher).crossfaderEnabled).toBe(true);
    // Live's crossfader leads Ghost Arcade's.
    deliver([hello(0.8)]);
    expect(get(crossfaderPosition)).toBeCloseTo(0.8, 5);
  });

  it('gives the studio one deck while it plays with Live, and hands back after', async () => {
    const { abletonBridge, vjClipLauncher, crossfaderPosition } = await load();
    abletonBridge.setStudioFeed(feed);
    // Deck mode turned the crossfader on, so the studio turns it off: one deck.
    expect(get(vjClipLauncher).crossfaderEnabled).toBe(false);
    // Live's crossfader no longer moves anything here.
    deliver([hello(0.1)]);
    expect(get(vjClipLauncher).crossfaderEnabled).toBe(false);
    abletonBridge.setStudioFeed(null);
    // Back to the decks: Live's crossfader leads again, where Live has it now.
    expect(get(vjClipLauncher).crossfaderEnabled).toBe(true);
    expect(get(crossfaderPosition)).toBeCloseTo(0.1, 5);
  });

  it('does not link decks by itself while the studio hosts Live', async () => {
    const { abletonBridge, vjClipLauncher } = await load();
    abletonBridge.setDeckMode?.(false);
    abletonBridge.setStudioFeed(feed);
    deliver([track(0, 'Deck A', 0), track(1, 'Deck B', 2)]);
    expect(get(vjClipLauncher).crossfaderEnabled).toBe(false);
    abletonBridge.setStudioFeed(null);
  });

  it('turns the crossfader off again when deck mode is turned off', async () => {
    const { abletonBridge, vjClipLauncher } = await load();
    abletonBridge.setDeckMode?.(true);
    expect(get(vjClipLauncher).crossfaderEnabled).toBe(true);
    abletonBridge.setDeckMode?.(false);
    expect(get(vjClipLauncher).crossfaderEnabled).toBe(false);
  });
});
