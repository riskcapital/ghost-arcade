import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ShowAudioTrack } from '../types';
import { buildShowAudioMuxArgs, showHasSoundtrack, showMuxInputName, showMuxTracks } from './showAudioExport';

const require = createRequire(import.meta.url);

function track(over: Partial<ShowAudioTrack>): ShowAudioTrack {
  return {
    id: 't', name: 'Song', url: '', startTime: 0, duration: 60, offset: 0, sourceDuration: 60,
    volume: 1, muted: false, lane: 0, ...over,
  } as ShowAudioTrack;
}

const filterOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1];

describe('show soundtrack for Render to Video', () => {
  it('keeps audible tracks that can play, with their place, trim and level', () => {
    const tracks = [
      track({ id: 'a', url: 'ghost-asset://localhost/m/a.wav', startTime: 4, offset: 2, duration: 30, volume: 0.8 }),
      track({ id: 'b', url: 'ghost-asset://localhost/m/b.wav', muted: true }),
      track({ id: 'c', url: 'ghost-asset://localhost/m/c.wav', volume: 0 }),
      track({ id: 'd', url: '' }),
    ];
    expect(showMuxTracks(tracks)).toEqual([{ url: 'ghost-asset://localhost/m/a.wav', startTime: 4, offset: 2, duration: 30, volume: 0.8 }]);
    expect(showHasSoundtrack(tracks)).toBe(true);
    expect(showHasSoundtrack([tracks[1], tracks[3]])).toBe(false);
  });

  it('names each copy with its file extension', () => {
    expect(showMuxInputName(0, 'ghost-asset://localhost/Users/me/My%20Song.AIFF')).toBe('show_audio_0.aiff');
    expect(showMuxInputName(1, 'blob:http://localhost/abc')).toBe('show_audio_1');
  });
});

describe('show audio mux arguments', () => {
  const base = { videoPath: 'render.mp4', outputPath: 'render.audio.mp4' };

  it('places, trims and levels each track, then pads to the show and cuts to the render', () => {
    const args = buildShowAudioMuxArgs({
      ...base,
      tracks: [
        { path: 'song.wav', startTime: 0, offset: 0, duration: 180, volume: 1 },
        { path: 'intro.mp3', startTime: 12.5, offset: 3, duration: 20, volume: 0.5 },
      ],
      showDuration: 180,
      renderDuration: 120,
    });
    expect(args.slice(0, 10)).toEqual(['-hide_banner', '-loglevel', 'error', '-y', '-i', 'render.mp4', '-i', 'song.wav', '-i', 'intro.mp3']);
    const filter = filterOf(args);
    expect(filter).toContain('[1:a]atrim=start=0.000000:duration=180.000000');
    expect(filter).toContain('[2:a]atrim=start=3.000000:duration=20.000000');
    expect(filter).toContain('volume=0.5000,adelay=delays=12500:all=1[t1]');
    expect(filter).toContain('[t0][t1]amix=inputs=2:duration=longest:normalize=0[mix]');
    expect(filter).toContain('[mix]apad=whole_dur=180.000000,atrim=end=180.000000[show]');
    expect(filter).toContain('[show]apad=whole_dur=120.000000,atrim=end=120.000000[aout]');
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-shortest']));
    expect(args[args.length - 1]).toBe('render.audio.mp4');
  });

  it('loops the soundtrack like the show when the render is longer', () => {
    const filter = filterOf(buildShowAudioMuxArgs({
      ...base,
      tracks: [{ path: 'loop.wav', startTime: 0, offset: 0, duration: 8, volume: 1 }],
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
      tracks: [{ path: 'a.wav', startTime: 0, offset: 0, duration: 8, volume: 1 }],
      showDuration: 10,
      renderDuration: 25,
    }));
    expect(filter).toContain('[show]apad=whole_dur=25.000000,atrim=end=25.000000[aout]');
    expect(filter).not.toContain('aloop');
  });

  it('refuses when there is no usable track', () => {
    expect(() => buildShowAudioMuxArgs({ ...base, tracks: [{ path: '', startTime: 0, offset: 0, duration: 3, volume: 1 }], showDuration: 3, renderDuration: 3 })).toThrow();
  });
});

function bundledFfmpeg(): string | null {
  try {
    const p = require('ffmpeg-static') as string;
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

// The same arguments with a native ffmpeg, when one is installed here (the
// app runs them in ffmpeg.wasm, which takes the same command line).
describe.runIf(bundledFfmpeg() !== null)('with a real ffmpeg', () => {
  const ffmpeg = bundledFfmpeg()!;
  const run = (args: string[], cwd?: string) => spawnSync(ffmpeg, args, { encoding: 'utf8', cwd });
  const durationOf = (file: string) => {
    const info = run(['-hide_banner', '-i', file]).stderr;
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  };

  it('adds a looped two-track soundtrack to a rendered MP4', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ga-show-audio-'));
    try {
      expect(run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'render.mp4'], dir).status).toBe(0);
      expect(run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'flac', 'show_audio_0.flac'], dir).status).toBe(0);
      expect(run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', 'show_audio_1.wav'], dir).status).toBe(0);

      const result = run(buildShowAudioMuxArgs({
        videoPath: 'render.mp4',
        outputPath: 'render.audio.mp4',
        tracks: [
          { path: 'show_audio_0.flac', startTime: 0, offset: 0, duration: 3, volume: 1 },
          { path: 'show_audio_1.wav', startTime: 1.5, offset: 0, duration: 1, volume: 0.5 },
        ],
        showDuration: 4,
        renderDuration: 6,
        loop: true,
      }), dir);
      expect(result.status, result.stderr).toBe(0);
      const info = run(['-hide_banner', '-i', path.join(dir, 'render.audio.mp4')]).stderr;
      expect(info).toMatch(/Stream #0:\d+.*Video: h264/);
      expect(info).toMatch(/Stream #0:\d+.*Audio: aac/);
      expect(durationOf(path.join(dir, 'render.audio.mp4'))).toBeGreaterThan(5.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
