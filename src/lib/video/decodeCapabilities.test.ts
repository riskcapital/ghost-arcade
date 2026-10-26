import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/bridge', () => ({ isDesktopApp: true, invoke: vi.fn() }));
vi.mock('$lib/api/native-renderer', () => ({ probeNativeVideo: vi.fn() }));

import { checkDecodeCapabilities, decodeVerdict } from './decodeCapabilities';

describe('Settings video decoding readout', () => {
  it('reports the core verdict per format, with the reason for software decoding', async () => {
    const answers: Record<string, any> = {
      '/t/h264.mp4': { backend: 'videotoolbox', hardware: true, reason: '', reverse_supported: true },
      '/t/hap.mov': { backend: 'hap-texture', hardware: true, reason: '', reverse_supported: true },
      '/t/vp9.webm': { backend: 'ffmpeg', hardware: false, reason: 'The asset has no readable video track', codec: 'vp9 (Profile 0), yuv420p', reverse_supported: false },
    };
    const rows = await checkDecodeCapabilities({
      clips: async () => [
        { id: 'h264', label: 'H.264', path: '/t/h264.mp4' },
        { id: 'hap', label: 'HAP', path: '/t/hap.mov' },
        { id: 'vp9', label: 'VP9', path: '/t/vp9.webm' },
        { id: 'av1', label: 'AV1', path: '/t/av1.mp4' },
      ],
      probe: async (path: string) => answers[path] ?? null,
    });
    expect(rows.map(row => [row.id, row.verdict])).toEqual([
      ['h264', 'Hardware'], ['hap', 'GPU (HAP)'], ['vp9', 'Software — may lag'], ['av1', 'Not checked'],
    ]);
    expect(rows[2].reason).toBe('VP9 has no hardware decoder in this app');
    expect(rows[3].reason).toMatch(/not running/);
  });

  it('names every state', () => {
    expect(decodeVerdict('failed', 'failed')).toBe("Can't play");
  });
});
