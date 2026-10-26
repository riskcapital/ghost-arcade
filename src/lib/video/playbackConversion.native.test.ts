import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The Video Converter's Playback preset: the format every Mac and PC decodes
 * in hardware (8-bit 4:2:0 H.264, at most 1920 px and 60 fps, a keyframe a
 * second, rotation applied, HDR tone-mapped to SDR).
 */
const require = createRequire(import.meta.url);
const options = require('../../../electron/video-converter-options.cjs');
const ffmpeg: string = require('ffmpeg-static');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-playback-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const make = (name: string, args: string[]) => {
  const file = path.join(dir, name);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, file], { timeout: 60000 });
  return file;
};
const describeFile = (file: string) => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-vf', 'showinfo', '-f', 'null', '-'], { encoding: 'utf8', timeout: 60000 });
  const text = String(result.stderr);
  return { ...options.parsePlaybackProbe(text), keyframes: (text.match(/ type:I /g) ?? []).length, text };
};
async function convert(input: string, name: string, longEdge?: number) {
  const job = { cancelled: false, process: null };
  const probe = await options.probePlaybackInput(ffmpeg, input, job);
  const encoder = await options.choosePlaybackEncoder(ffmpeg);
  const tonemap = await options.playbackCanToneMap(ffmpeg);
  const output = path.join(dir, name);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
    ...options.conversionOutputArgs('playback', { playback: { probe, encoder, tonemap, longEdge } }), output], { timeout: 120000 });
  return { output, probe, encoder, tonemap };
}

describe('Playback preset', () => {
  let wide: string;
  beforeAll(() => {
    // 10-bit 4:2:2 H.264 at 90 fps: no hardware decoder takes this.
    wide = make('wide-422-10bit-90fps.mov', ['-f', 'lavfi', '-i', 'testsrc2=s=2400x1200:r=90:d=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv422p10le']);
  }, 60000);

  it('reads what it needs from ffmpeg: size, rate, HDR transfer and rotation', () => {
    const pq = options.parsePlaybackProbe('  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160 [SAR 1:1 DAR 16:9], 59.94 fps, 59.94 tbr');
    expect(pq).toMatchObject({ codec: 'hevc', width: 3840, height: 2160, fps: 59.94, transfer: 'pq' });
    expect(options.parsePlaybackProbe('Stream #0:0: Video: hevc, yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 25 fps\n      displaymatrix: rotation of -90.00 degrees'))
      .toMatchObject({ transfer: 'hlg', rotation: -90 });
    expect(options.parsePlaybackProbe('Stream #0:1: Audio: aac')).toBeNull();
  });

  it('chooses a proven encoder and only tone-maps when ffmpeg can', () => {
    const probe = { width: 3840, height: 2160, fps: 120, transfer: 'pq' };
    const withTonemap = options.playbackOutputArgs({ probe, tonemap: true }).join(' ');
    expect(withTonemap).toContain('tonemap=tonemap=hable');
    expect(withTonemap).toContain('-color_trc bt709');
    expect(withTonemap).toContain('-g 60');
    expect(withTonemap).toContain('-c:v libx264');
    expect(options.playbackOutputArgs({ probe, tonemap: false }).join(' ')).not.toContain('zscale');
    expect(options.playbackOutputArgs({ probe, encoder: 'h264_nvenc' }).join(' ')).toContain('-c:v h264_nvenc');
    expect(options.playbackOutputSize({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
    expect(options.playbackOutputSize({ width: 1081, height: 1921 })).toEqual({ width: 1080, height: 1920 });
  });

  it('names the copy beside the original without overwriting anything', () => {
    const taken = new Set(['/show/clip-playback.mp4']);
    expect(options.playbackOutputPath('/show/clip.mov', '/show', (p: string) => taken.has(p))).toBe(path.join('/show', 'clip-playback-2.mp4'));
    expect(options.playbackOutputPath('/show/clip-playback.mp4', '/show', () => false)).toBe(path.join('/show', 'clip-playback.mp4'));
  });

  it('converts 10-bit 4:2:2 high-rate video to 8-bit 4:2:0 H.264, 1920 px, 60 fps, a keyframe a second', async () => {
    const { output } = await convert(wide, 'wide-playback.mp4');
    const result = describeFile(output);
    expect(result.codec).toBe('h264');
    expect(result.description).toMatch(/yuv420p[(,]/);
    expect([result.width, result.height]).toEqual([1920, 960]);
    expect(result.fps).toBe(60);
    expect(result.keyframes).toBeGreaterThanOrEqual(2);
    expect(result.keyframes).toBeLessThanOrEqual(3);
  }, 120000);

  it('applies rotation, so a phone clip stands upright without metadata', async () => {
    const plain = make('phone.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    const rotated = path.join(dir, 'phone-rotated.mp4');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation:v:0', '90', '-i', plain, '-c', 'copy', rotated]);
    const { output } = await convert(rotated, 'phone-playback.mp4');
    const result = describeFile(output);
    expect([result.width, result.height]).toEqual([360, 640]);
    expect(result.rotation).toBe(0);
  }, 120000);

  it('tone-maps PQ HDR to SDR BT.709 when this ffmpeg has zscale and tonemap', async () => {
    const hdr = make('hdr-pq.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=1', '-c:v', 'libx265', '-x265-params', 'log-level=error',
      '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc']);
    const { output, probe, tonemap } = await convert(hdr, 'hdr-playback.mp4');
    expect(probe.transfer).toBe('pq');
    const result = describeFile(output);
    expect(result.description).toMatch(/yuv420p\(/);
    if (tonemap) expect(result.description).toMatch(/bt709/);
    else expect(result.transfer).toBe('pq');
  }, 120000);
});
