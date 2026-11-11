/**
 * Switching Show↔Timeline (and reopening a show) gives a song's track its
 * old <audio> element back instead of a new one: an element wired into
 * WebAudio lives as long as the AudioContext, so a new one per switch piled up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const attached: HTMLMediaElement[] = [];
vi.mock('../audio/clipAudioBus', () => ({
  clipAudioBus: {
    attachClip: (_id: string, el: HTMLMediaElement) => { attached.push(el); return true; },
    detachClip: () => {},
    rewireClip: () => {},
    setClipVolume: () => {},
    setClipMuted: () => {},
    subscribe: (fn: (v: unknown) => void) => { fn({}); return () => {}; },
  },
}));

const created: unknown[] = [];
vi.stubGlobal('document', {
  createElement: (tag: string) => {
    const el = { tag, dataset: {} as Record<string, string>, pause() {}, load() {}, removeAttribute() {}, src: '', muted: false, loop: false, preload: '', crossOrigin: '' };
    created.push(el);
    return el;
  },
});

const { showTimeline, _spareShowAudioElementCount } = await import('./showTimeline');

afterEach(() => vi.unstubAllGlobals());

describe('show audio elements across document switches', () => {
  it('reuses the element of a song track', async () => {
    showTimeline.activateDoc('timeline');
    await showTimeline.addAudioTrack({ name: 'song.wav', url: 'ghost-asset://localhost/song.wav', startTime: 0, duration: 30 });
    const first = created.length;
    expect(new Set(attached).size).toBe(1);
    for (let i = 0; i < 5; i++) {
      showTimeline.activateDoc('show');
      showTimeline.activateDoc('timeline');
    }
    expect(created.length).toBe(first);
    expect(new Set(attached).size).toBe(1);
    expect(_spareShowAudioElementCount()).toBe(0);
    showTimeline.activateDoc('show');
    expect(_spareShowAudioElementCount()).toBe(1);
  });
});
