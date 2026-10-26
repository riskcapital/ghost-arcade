import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/bridge', () => ({ isDesktopApp: true }));
vi.mock('$lib/api/native-renderer', () => ({ probeNativeVideo: vi.fn() }));

import {
  checkVideoDecode,
  decodeBadge,
  decodeHealthFromProbe,
  noteVideoSessionBackends,
  plainDecodeReason,
  videoDecodeHealth,
  videoPathFromUri,
} from './videoDecodeHealth';

beforeEach(() => videoDecodeHealth.set({}));

describe('video decode health', () => {
  it('shows nothing for hardware or HAP decoding', () => {
    for (const backend of ['videotoolbox', 'media-foundation', 'hap-texture']) {
      expect(decodeBadge(decodeHealthFromProbe({ backend, hardware: true, reason: '', reverse_supported: true }))).toBeNull();
    }
  });

  it('marks software decoding with a plain reason and offers conversion', () => {
    const health = decodeHealthFromProbe({ backend: 'ffmpeg', hardware: false, reverse_supported: false,
      reason: 'A hardware video decoder is unavailable for this clip (-12906)',
      codec: 'prores (HQ) (apch / 0x68637061), yuv422p10le(tv, bt709), 3840x2160' });
    const badge = decodeBadge(health)!;
    expect(badge.tone).toBe('warn');
    expect(badge.title).toBe('Software decode — may lag: this computer has no hardware ProRes decoder. Reverse and bounce will not play.');
    expect(badge.canConvert).toBe(true);
  });

  it('marks a file that cannot play', () => {
    const badge = decodeBadge(decodeHealthFromProbe({ backend: 'failed', hardware: false, reverse_supported: false,
      reason: 'The video could not be decoded (Invalid data found when processing input)' }))!;
    expect(badge).toMatchObject({ tone: 'error', canConvert: false });
    expect(badge.title).toBe("Can't play: its video could not be decoded.");
  });

  it('explains the common reasons in words', () => {
    expect(plainDecodeReason('ffmpeg', 'x', 'h264 (High 10), yuv420p10le(tv), 1920x1080')).toMatch(/10-bit H.264/);
    expect(plainDecodeReason('ffmpeg', 'x', 'h264 (High 4:2:2), yuv422p(tv), 1920x1080')).toMatch(/4:2:2/);
    expect(plainDecodeReason('ffmpeg', 'Video with an alpha channel requires the compatibility decoder to preserve transparency', 'prores'))
      .toBe('it has transparency (alpha)');
    expect(plainDecodeReason('ffmpeg', 'Interlaced video requires the compatibility decoder', 'h264, yuv420p')).toBe('it is interlaced');
    expect(plainDecodeReason('ffmpeg', "Media Foundation is not installed on this PC ... Media Feature Pack", 'h264'))
      .toMatch(/Media Feature Pack/);
    expect(plainDecodeReason('ffmpeg', 'x', 'vp9 (Profile 0), yuv420p')).toBe('VP9 has no hardware decoder in this app');
    expect(plainDecodeReason('failed', 'The file was not found')).toBe('the file was not found');
  });

  it('shows conversion progress in place of the badge', () => {
    const health = { ...decodeHealthFromProbe({ backend: 'ffmpeg', hardware: false, reason: '', reverse_supported: false }),
      converting: { progress: 0.42, message: 'Encoding' } };
    expect(decodeBadge(health)).toMatchObject({ tone: 'busy', label: '42%', canConvert: false });
  });

  it('asks the core once per file and remembers the answer', async () => {
    const probe = vi.fn(async (uri: string) => ({ uri, backend: 'ffmpeg', hardware: false, reason: 'Interlaced video',
      codec: 'h264, yuv420p', width: 1, height: 1, fps: 25, duration_seconds: 1, reverse_supported: false }));
    await Promise.all([checkVideoDecode('/show/a.mov', { probe }), checkVideoDecode('/show/a.mov', { probe })]);
    await checkVideoDecode('/show/a.mov', { probe });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(get(videoDecodeHealth)['/show/a.mov']).toMatchObject({ state: 'software', reason: 'it is interlaced' });
  });

  it('forgets a check the core could not answer, so it runs again', async () => {
    const probe = vi.fn(async () => null);
    await checkVideoDecode('/show/b.mov', { probe });
    expect(get(videoDecodeHealth)['/show/b.mov']).toBeUndefined();
  });

  it('follows live playback, which can still fall back after the probe', () => {
    videoDecodeHealth.set({ '/show/c.mp4': decodeHealthFromProbe({ backend: 'videotoolbox', hardware: true, reason: '', reverse_supported: true }) });
    const failed = noteVideoSessionBackends([
      { uri: 'ghost-asset://localhost/show/c.mp4', backend: 'ffmpeg', fallback_reason: 'Hardware decoder did not preserve the 10-bit precision' },
      { uri: '/show/d.mp4', backend: 'preparing' },
      { uri: '/show/e.mp4', backend: 'failed', fallback_reason: 'native video stream read failed' },
      { uri: '/show/f.mp4', backend: 'failed', fallback_reason: 'Reverse playback requires the native hardware or HAP decoder' },
    ]);
    const all = get(videoDecodeHealth);
    expect(all['/show/c.mp4'].state).toBe('software');
    expect(all['/show/d.mp4']).toBeUndefined();
    expect(all['/show/e.mp4'].state).toBe('failed');
    // Forwards it plays; converting fixes reverse too.
    expect(all['/show/f.mp4']).toMatchObject({ state: 'software', reason: 'reverse and bounce play only with hardware decoding' });
    expect(failed).toEqual(['/show/e.mp4']);
    expect(noteVideoSessionBackends([{ uri: '/show/e.mp4', backend: 'failed', fallback_reason: 'again' }])).toEqual([]);
  });

  it('maps media URIs to file paths', () => {
    expect(videoPathFromUri('ghost-asset://localhost/Users/a/My%20Show/clip.mov')).toBe('/Users/a/My Show/clip.mov');
    expect(videoPathFromUri('file:///C:/shows/a.mov')).toBe('C:/shows/a.mov');
    expect(videoPathFromUri('C:\\shows\\a.mov')).toBe('C:\\shows\\a.mov');
    expect(videoPathFromUri('blob:abc')).toBeNull();
  });
});
