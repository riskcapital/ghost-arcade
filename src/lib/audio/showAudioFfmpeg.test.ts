import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildShowAudioConvertArgs, buildShowAudioMuxArgs, convertedAudioPath } = require('../../../electron/show-audio.cjs');

function bundledFfmpeg(): string | null {
  try {
    const p = require('ffmpeg-static') as string;
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

const filterOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1];

describe('show audio mux arguments', () => {
  const base = { videoPath: '/r/render.mp4', outputPath: '/r/render.audio.mp4' };

  it('places, trims and levels each track, then pads to the show and cuts to the render', () => {
    const args = buildShowAudioMuxArgs({
      ...base,
      tracks: [
        { path: '/m/song.wav', startTime: 0, offset: 0, duration: 180, volume: 1 },
        { path: '/m/intro.mp3', startTime: 12.5, offset: 3, duration: 20, volume: 0.5 },
      ],
      showDuration: 180,
      renderDuration: 120,
    });
    expect(args.slice(0, 10)).toEqual(['-hide_banner', '-loglevel', 'error', '-y', '-i', '/r/render.mp4', '-i', '/m/song.wav', '-i', '/m/intro.mp3']);
    const filter = filterOf(args);
    expect(filter).toContain('[1:a]atrim=start=0.000000:duration=180.000000');
    expect(filter).toContain('[2:a]atrim=start=3.000000:duration=20.000000');
    expect(filter).toContain('volume=0.5000,adelay=delays=12500:all=1[t1]');
    expect(filter).toContain('[t0][t1]amix=inputs=2:duration=longest:normalize=0[mix]');
    expect(filter).toContain('[mix]apad=whole_dur=180.000000,atrim=end=180.000000[show]');
    expect(filter).toContain('[show]apad=whole_dur=120.000000,atrim=end=120.000000[aout]');
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-shortest']));
    expect(args[args.length - 1]).toBe('/r/render.audio.mp4');
  });

  it('loops the soundtrack like the show when the render is longer', () => {
    const filter = filterOf(buildShowAudioMuxArgs({
      ...base,
      tracks: [{ path: '/m/loop.wav', startTime: 0, offset: 0, duration: 8, volume: 1 }],
      showDuration: 10,
      renderDuration: 25,
      loop: true,
    }));
    expect(filter).toContain('[t0]apad=whole_dur=10.000000,atrim=end=10.000000[show]');
    expect(filter).toContain('[show]aloop=loop=-1:size=480000,atrim=end=25.000000[aout]');
  });

  it('pads with silence instead when the show does not loop', () => {
    const filter = filterOf(buildShowAudioMuxArgs({
      ...base,
      tracks: [{ path: '/m/a.wav', startTime: 0, offset: 0, duration: 8, volume: 1 }],
      showDuration: 10,
      renderDuration: 25,
    }));
    expect(filter).toContain('[show]apad=whole_dur=25.000000,atrim=end=25.000000[aout]');
    expect(filter).not.toContain('aloop');
  });

  it('uses the given audio codec (PCM for a .mov master)', () => {
    const args = buildShowAudioMuxArgs({
      ...base,
      tracks: [{ path: '/m/a.wav', startTime: 0, offset: 0, duration: 8, volume: 1 }],
      showDuration: 8,
      renderDuration: 8,
      audioCodecArgs: ['-c:a', 'pcm_s16le', '-ar', '48000'],
    });
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'pcm_s16le']));
  });

  it('refuses when there is no usable track', () => {
    expect(() => buildShowAudioMuxArgs({ ...base, tracks: [{ path: '', duration: 3 }], showDuration: 3, renderDuration: 3 })).toThrow();
  });
});

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
  const durationOf = (file: string, stream: 'Audio' | 'Video') => {
    const info = run(['-hide_banner', '-i', file]).stderr;
    if (!info.includes(`Stream #0:`) || !info.includes(`${stream}:`)) return null;
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  };

  it('converts AIFF and adds a looped two-track soundtrack to a rendered MP4', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ga-show-audio-'));
    try {
      const video = path.join(dir, 'render.mp4');
      const aiff = path.join(dir, 'song.aiff');
      const wav = path.join(dir, 'hit.wav');
      expect(run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]).status).toBe(0);
      expect(run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', aiff]).status).toBe(0);
      expect(run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', wav]).status).toBe(0);

      const flac = path.join(dir, 'song.flac');
      expect(run(buildShowAudioConvertArgs(aiff, flac)).status).toBe(0);
      expect(durationOf(flac, 'Audio')).toBeCloseTo(3, 1);

      const out = path.join(dir, 'render.audio.mp4');
      const result = run(buildShowAudioMuxArgs({
        videoPath: video,
        outputPath: out,
        tracks: [
          { path: flac, startTime: 0, offset: 0, duration: 3, volume: 1 },
          { path: wav, startTime: 1.5, offset: 0, duration: 1, volume: 0.5 },
        ],
        showDuration: 4,
        renderDuration: 6,
        loop: true,
      }));
      expect(result.status, result.stderr).toBe(0);
      const info = run(['-hide_banner', '-i', out]).stderr;
      expect(info).toMatch(/Stream #0:\d+.*Video: h264/);
      expect(info).toMatch(/Stream #0:\d+.*Audio: aac/);
      expect(durationOf(out, 'Audio')).toBeGreaterThan(5.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
