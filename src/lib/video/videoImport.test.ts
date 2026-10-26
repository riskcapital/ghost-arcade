import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isVideoFile, releaseVideoElement, videoLoadFailureMessage, waitForVideoData } from './videoImport';

/** Just enough of an HTMLVideoElement to drive the waits. */
class FakeVideo {
  readyState = 0;
  error: { code: number } | null = null;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  listenerCount() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

describe('isVideoFile', () => {
  it('trusts a video MIME type', () => {
    expect(isVideoFile({ name: 'clip', type: 'video/mp4' })).toBe(true);
  });
  it('falls back to the extension when the OS reports no type', () => {
    expect(isVideoFile({ name: 'show.MKV', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'master.mxf' })).toBe(true);
    expect(isVideoFile({ name: 'loop.mov', type: 'application/octet-stream' })).toBe(true);
  });
  it('does not take images or audio for video', () => {
    expect(isVideoFile({ name: 'photo.png', type: 'image/png' })).toBe(false);
    expect(isVideoFile({ name: 'song.mp4', type: 'audio/mp4' })).toBe(false);
    expect(isVideoFile({ name: 'notes.txt', type: '' })).toBe(false);
  });
});

describe('waitForVideoData', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves at once for a video that already has a frame', async () => {
    const v = new FakeVideo();
    v.readyState = 2;
    await expect(waitForVideoData(v as any)).resolves.toEqual({ ok: true });
  });

  it('resolves when the first frame arrives, and cleans up', async () => {
    const v = new FakeVideo();
    const pending = waitForVideoData(v as any);
    v.readyState = 2;
    v.emit('loadeddata');
    await expect(pending).resolves.toEqual({ ok: true });
    expect(v.listenerCount()).toBe(0);
  });

  it('reports a decode error instead of waiting forever', async () => {
    const v = new FakeVideo();
    const pending = waitForVideoData(v as any);
    v.error = { code: 4 };
    v.emit('error');
    await expect(pending).resolves.toEqual({ ok: false, reason: 'error', code: 4 });
  });

  it('gives up after the timeout when nothing happens', async () => {
    const v = new FakeVideo();
    const pending = waitForVideoData(v as any, { timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(v.listenerCount()).toBe(0);
  });

  it('reports an element that had already failed', async () => {
    const v = new FakeVideo();
    v.error = { code: 3 };
    await expect(waitForVideoData(v as any)).resolves.toEqual({ ok: false, reason: 'error', code: 3 });
  });
});

describe('videoLoadFailureMessage', () => {
  it('points an unplayable format at the Video Converter', () => {
    const msg = videoLoadFailureMessage('show.mov', { ok: false, reason: 'error', code: 4 });
    expect(msg).toContain('show.mov');
    expect(msg).toContain('File › Video Converter');
  });
  it('says a missing file is missing', () => {
    expect(videoLoadFailureMessage('a.mp4', { ok: false, reason: 'error', code: 2 })).toContain('could not be read');
  });
  it('explains a timeout', () => {
    expect(videoLoadFailureMessage('a.avi', { ok: false, reason: 'timeout' })).toContain('did not load');
  });
});

describe('releaseVideoElement', () => {
  it('pauses and unloads, and never throws', () => {
    const calls: string[] = [];
    releaseVideoElement({ pause: () => calls.push('pause'), removeAttribute: () => calls.push('src'), load: () => calls.push('load') } as any);
    expect(calls).toEqual(['pause', 'src', 'load']);
    expect(() => releaseVideoElement({ pause: () => { throw new Error('gone'); } } as any)).not.toThrow();
  });
});
