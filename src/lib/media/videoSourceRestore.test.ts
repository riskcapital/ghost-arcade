import { describe, expect, it, vi } from 'vitest';
import type { MediaSource } from '../types';
import { restoreVideoSourceElement, videoSourceNeedsCors } from './videoSourceRestore';

function makeSource(src: string): MediaSource {
  return {
    id: 'saved-video',
    type: 'video',
    src,
    name: 'saved.mp4',
  };
}

function makeFakeVideo(events: string[]) {
  const listeners = new Map<string, EventListener>();
  const play = vi.fn(async () => {});
  let crossOrigin = '';
  let src = '';

  const video = {
    loop: true,
    muted: false,
    playsInline: false,
    preload: '',
    playbackRate: 1,
    paused: true,
    duration: Number.NaN,
    currentTime: 0,
    readyState: 0,
    play,
    pause: vi.fn(),
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      events.push(`listen:${name}`);
      listeners.set(name, listener);
    }),
    load: vi.fn(() => {
      events.push('load');
      listeners.get('loadeddata')?.(new Event('loadeddata'));
    }),
    set crossOrigin(value: string) {
      crossOrigin = value;
      events.push(`cors:${value}`);
    },
    get crossOrigin() {
      return crossOrigin;
    },
    set src(value: string) {
      src = value;
      events.push(`src:${value}`);
    },
    get src() {
      return src;
    },
  } as unknown as HTMLVideoElement;

  return { video, play };
}

describe('restoreVideoSourceElement', () => {
  it('opts ghost-asset videos into CORS before assigning src and starts playback when ready', () => {
    const events: string[] = [];
    const { video, play } = makeFakeVideo(events);
    const source = makeSource('ghost-asset://localhost/Users/test/saved.mp4');

    restoreVideoSourceElement(source, () => video);

    expect(source.videoElement).toBe(video);
    expect(source.isPlaying).toBe(true);
    expect(events.indexOf('cors:anonymous')).toBeLessThan(events.indexOf(`src:${source.src}`));
    expect(events.indexOf('listen:loadeddata')).toBeLessThan(events.indexOf(`src:${source.src}`));
    expect(play).toHaveBeenCalledOnce();
  });

  it('does not apply cross-origin mode to blob URLs', () => {
    const events: string[] = [];
    const { video } = makeFakeVideo(events);

    restoreVideoSourceElement(makeSource('blob:local-video'), () => video);

    expect(events.some((event) => event.startsWith('cors:'))).toBe(false);
  });
});

describe('videoSourceNeedsCors', () => {
  it('matches remote and custom-protocol video sources only', () => {
    expect(videoSourceNeedsCors('ghost-asset://localhost/tmp/a.mp4')).toBe(true);
    expect(videoSourceNeedsCors('https://example.com/a.mp4')).toBe(true);
    expect(videoSourceNeedsCors('blob:abc')).toBe(false);
    expect(videoSourceNeedsCors('data:video/mp4;base64,abc')).toBe(false);
  });
});
