import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { resolveConversionFfmpeg, bundledFfmpegPaths } = createRequire(import.meta.url)('../../../electron/conversion-ffmpeg.cjs');

describe('conversion encoder selection', () => {
  it.runIf(process.platform === 'win32' && bundledFfmpegPaths().length > 0)('converts with the Windows bundle without an installed encoder on PATH', async () => {
    vi.stubEnv('PATH', '');
    vi.stubEnv('GA_FFMPEG_PATH', '');
    try {
      expect(await resolveConversionFfmpeg('missing-ffmpeg', 'hap')).toBe(bundledFfmpegPaths()[0]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('keeps the configured encoder for non-HAP conversions', async () => {
    expect(await resolveConversionFfmpeg('bundled', 'prores', () => { throw Error('unexpected probe'); })).toBe('bundled');
  });
  it('uses a HAP-capable preferred binary', async () => {
    expect(await resolveConversionFfmpeg('bundled', 'hap_alpha', async (path: string) => new Set(path === 'bundled' ? ['hap'] : []))).toBe('bundled');
  });
  it('falls back to a verified installed encoder when the bundled build lacks HAP', async () => {
    const installed = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    expect(await resolveConversionFfmpeg('bundled', 'hap_q', async (path: string) => new Set(path === installed ? ['hap'] : ['libx264']))).toBe(installed);
  });
  it('reports the missing encoder before starting a conversion', async () => {
    await expect(resolveConversionFfmpeg('bundled', 'hap', async () => new Set(['libx264']))).rejects.toThrow('HAP encoder');
  });
});
