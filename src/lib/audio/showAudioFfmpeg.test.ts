import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildShowAudioConvertArgs, convertedAudioPath } = require('../../../electron/show-audio.cjs');

function bundledFfmpeg(): string | null {
  try {
    const p = require('ffmpeg-static') as string;
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

describe('show audio conversion', () => {
  it('converts the first audio stream to FLAC', () => {
    expect(buildShowAudioConvertArgs('/m/song.aiff', '/c/song.flac')).toEqual([
      '-hide_banner', '-loglevel', 'error', '-y', '-i', '/m/song.aiff', '-map', '0:a:0', '-vn', '-c:a', 'flac', '/c/song.flac',
    ]);
  });

  it('names the converted copy after the source and changes it when the source changes', () => {
    const a = convertedAudioPath(path.posix, '/c', '/m/My Song!.aiff', { size: 10, mtimeMs: 1 });
    const b = convertedAudioPath(path.posix, '/c', '/m/My Song!.aiff', { size: 11, mtimeMs: 1 });
    expect(a).toMatch(/^\/c\/My Song_-[0-9a-f]{10}\.flac$/);
    expect(a).not.toBe(b);
  });
});

// The real thing, with the ffmpeg the app ships, when it is installed here.
describe.runIf(bundledFfmpeg() !== null)('with the bundled ffmpeg', () => {
  const ffmpeg = bundledFfmpeg()!;
  const run = (args: string[]) => spawnSync(ffmpeg, args, { encoding: 'utf8' });
  const durationOf = (file: string) => {
    const info = run(['-hide_banner', '-i', file]).stderr;
    if (!info.includes('Stream #0:') || !info.includes('Audio:')) return null;
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  };

  it('converts an AIFF song to a FLAC copy of the same length', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ga-show-audio-'));
    try {
      const aiff = path.join(dir, 'song.aiff');
      expect(run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', aiff]).status).toBe(0);
      const flac = path.join(dir, 'song.flac');
      const result = run(buildShowAudioConvertArgs(aiff, flac));
      expect(result.status, result.stderr).toBe(0);
      expect(run(['-hide_banner', '-i', flac]).stderr).toMatch(/Audio: flac/);
      expect(durationOf(flac)).toBeCloseTo(3, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
