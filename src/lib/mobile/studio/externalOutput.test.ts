import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalOutput, OUTPUT_PREFERENCES_KEY, defaultOutputPreferences, normalizeOutputPreferences, pictureStyle, retryDelay, type OutputStatus } from './externalOutput';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('output preferences', () => {
  it('choices saved by app 1.1 keep their values and the new ones start at their defaults', () => {
    const saved = { method: 'wired', frameRate: 60, enabled: false };
    expect(normalizeOutputPreferences(saved)).toEqual({ ...defaultOutputPreferences(), method: 'wired', frameRate: 60, enabled: false });
    expect(normalizeOutputPreferences({})).toEqual(defaultOutputPreferences());
    expect(normalizeOutputPreferences(null)).toEqual(defaultOutputPreferences());
  });
  it('defaults: whole picture, every pixel of the display, no turn, no mirror, the display picks its mode', () => {
    expect(defaultOutputPreferences()).toMatchObject({ rotation: 0, mirror: false, fit: 'contain', fullFrame: true, mode: null });
  });
  it('round-trips the picture settings and repairs bad values', () => {
    const good = { ...defaultOutputPreferences(), rotation: 270, mirror: true, fit: 'fill', fullFrame: false, mode: { width: 1280, height: 720 } };
    expect(normalizeOutputPreferences(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(normalizeOutputPreferences({ rotation: 45, fit: 'zoom', mirror: 'yes', fullFrame: 0, mode: { width: -1, height: 720 } }))
      .toEqual({ ...defaultOutputPreferences(), fullFrame: true });
    expect(normalizeOutputPreferences({ mode: { width: 1.5, height: 2 } }).mode).toBeNull();
  });
});

describe('picture on the display', () => {
  it('fits a level picture to the display box', () => {
    expect(pictureStyle({ rotation: 0, mirror: false, fit: 'contain' })).toBe('position:absolute;left:50%;top:50%;width:100vw;height:100vh;object-fit:contain;transform:translate(-50%,-50%) rotate(0deg);');
  });
  it('lays a sideways picture out in a swapped box before turning it, so it still fills the display', () => {
    const style = pictureStyle({ rotation: 90, mirror: true, fit: 'fill' });
    expect(style).toContain('width:100vh;height:100vw;');
    expect(style).toContain('rotate(90deg) scaleX(-1)');
    expect(style).toContain('object-fit:fill');
    expect(pictureStyle({ rotation: 180, mirror: false, fit: 'cover' })).toContain('width:100vw;height:100vh;');
  });
});

describe('recovery', () => {
  it('waits 1, 2, 4, then 8 seconds between automatic restarts', () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });

  function environment(open: () => unknown) {
    const win = new EventTarget() as EventTarget & Record<string, unknown>;
    const messages: unknown[] = [];
    Object.assign(win, { webkit: { messageHandlers: { ghostOutput: { postMessage: (m: unknown) => messages.push(m) } } }, open: vi.fn(open) });
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const store = new Map<string, string>();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const statuses: OutputStatus[] = [];
    const canvas = { captureStream: vi.fn(() => ({ getVideoTracks: () => [{}], getTracks: () => [] })) } as unknown as HTMLCanvasElement;
    const connect = (connected: boolean, revision = 1) => win.dispatchEvent(new CustomEvent('ghost-external-display', { detail: { connected, revision, display: { name: 'External display', width: 1920, height: 1080 }, modes: [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 'x' }] } }));
    return { win, doc, messages, statuses, canvas, store, connect };
  }

  it('tells the app the display settings at start and when they change', () => {
    const env = environment(() => null);
    const output = new ExternalOutput(env.canvas, (s) => env.statuses.push(s));
    expect(env.messages).toContainEqual({ type: 'display', fullFrame: true, width: 0, height: 0 });
    expect(env.messages).toContainEqual({ type: 'ready' });
    output.configure({ ...defaultOutputPreferences(), fullFrame: false, mode: { width: 1280, height: 720 } });
    expect(env.messages.at(-1)).toEqual({ type: 'display', fullFrame: false, width: 1280, height: 720 });
    expect(JSON.parse(env.store.get(OUTPUT_PREFERENCES_KEY)!)).toMatchObject({ fullFrame: false, mode: { width: 1280, height: 720 } });
    output.destroy();
  });

  it('keeps trying by itself while the display stays connected, and stops when it goes', () => {
    vi.useFakeTimers();
    const env = environment(() => null);
    const output = new ExternalOutput(env.canvas, (s) => env.statuses.push(s));
    env.connect(true);
    expect(env.win.open).toHaveBeenCalledTimes(1);
    const failed = env.statuses.at(-1)!;
    expect(failed).toMatchObject({ state: 'error', connected: true, modes: [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }] });
    expect(failed.message).toMatch(/Trying again/);
    vi.advanceTimersByTime(1000);
    expect(env.win.open).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2000);
    expect(env.win.open).toHaveBeenCalledTimes(3);
    env.connect(false);
    expect(env.statuses.at(-1)?.state).toBe('disconnected');
    vi.advanceTimersByTime(60000);
    expect(env.win.open).toHaveBeenCalledTimes(3);
    output.destroy();
  });

  it('starts the picture again when the app comes back to the front', () => {
    vi.useFakeTimers();
    const env = environment(() => null);
    const output = new ExternalOutput(env.canvas, (s) => env.statuses.push(s));
    env.connect(true);
    env.doc.visibilityState = 'hidden';
    env.doc.dispatchEvent(new Event('visibilitychange'));
    expect(env.win.open).toHaveBeenCalledTimes(1);
    env.doc.visibilityState = 'visible';
    env.doc.dispatchEvent(new Event('visibilitychange'));
    expect(env.win.open).toHaveBeenCalledTimes(2);
    output.destroy();
    env.doc.dispatchEvent(new Event('visibilitychange'));
    expect(env.win.open).toHaveBeenCalledTimes(2);
  });

  it('a display that connects while output is switched off stays black and says so', () => {
    const env = environment(() => null);
    const output = new ExternalOutput(env.canvas, (s) => env.statuses.push(s));
    output.configure({ ...defaultOutputPreferences(), enabled: false });
    env.connect(true);
    expect(env.statuses.at(-1)?.state).toBe('off');
    expect(env.win.open).not.toHaveBeenCalled();
    output.destroy();
  });
});
