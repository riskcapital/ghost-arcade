import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { formats, conversionOutputArgs, stageConversionOutput, sequenceConcatText, probeConversionInput } = require('../../../electron/video-converter-options.cjs');
let ffmpeg = require('ffmpeg-static');
beforeAll(async () => { ffmpeg = await require('../../../electron/conversion-ffmpeg.cjs').resolveConversionFfmpeg(ffmpeg, 'hap'); });
const { inspectVideoForImport } = require('../../../electron/video-import.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-converter-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
const rgba = Buffer.alloc(64 * 64 * 4 * 2);
for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 240; rgba[i + 1] = 24; rgba[i + 2] = 16; rgba[i + 3] = 102; }
const raw = path.join(dir, 'input.rgba'); fs.writeFileSync(raw, rgba);
describe('native VJ video conversion', () => {
  it.each(['vp8', 'vp9'])('preserves transparent %s WebM through HAP Alpha and ProRes 4444', async codec => {
    const source = path.join(dir, `alpha-${codec}.webm`);
    run(['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '64x64', '-framerate', '25', '-i', raw,
      '-c:v', codec === 'vp9' ? 'libvpx-vp9' : 'libvpx', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', source]);
    const decoderArgs = await probeConversionInput(ffmpeg, source, { cancelled: false });
    expect(decoderArgs).toEqual(['-c:v', codec === 'vp9' ? 'libvpx-vp9' : 'libvpx']);
    for (const format of ['hap_alpha', 'prores_alpha']) {
      const output = path.join(dir, `${codec}-${format}.mov`);
      run([...decoderArgs, '-i', source, ...conversionOutputArgs(format), output]);
      const decoded = run(['-i', output, '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']);
      expect(decoded.length).toBe(rgba.length);
      expect(decoded[3]).toBeCloseTo(102, -1);
    }
  });
  it.each(formats as Array<{ id: string; extension: string; alpha: boolean; label: string }>)('encodes and decodes $label with two independent input frames', async format => {
    const output = path.join(dir, `${format.id}.${format.extension}`);
    const staged = stageConversionOutput(output, format.id);
    try {
      run(['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '64x64', '-framerate', '25', '-i', raw,
        '-frames:v', '2', ...conversionOutputArgs(format.id), staged.temporaryPath]);
      expect(fs.existsSync(output)).toBe(false);
      staged.complete();
      const decoded = run(['-i', output, '-map', '0:v:0', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']);
      expect(decoded.length).toBe(rgba.length);
      expect(decoded[0]).toBeGreaterThan(210);
      expect(decoded[1]).toBeLessThan(50);
      expect(decoded[3]).toBeCloseTo(format.alpha ? 102 : 255, -1);
      const imported = await inspectVideoForImport(ffmpeg, output);
      expect(imported.durationSeconds).toBeCloseTo(.08, 2);
      expect(imported).toMatchObject({videoWidth:64,videoHeight:64});
      expect(imported.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    } finally { staged.cleanup(); }
  });
  it.each([24, 60, 59.94])('keeps every image once at %s fps, including a filename with an apostrophe', fps => {
    const images: string[] = [];
    for (let i = 0; i < 3; i++) {
      const image = path.join(dir, `frame '${i}.png`);
      if (!fs.existsSync(image)) run(['-f', 'lavfi', '-i', `color=${['red','green','blue'][i]}:s=64x64`, '-frames:v', '1', '-threads', '1', image]);
      images.push(image);
    }
    const list = path.join(dir, 'frames.ffconcat'); fs.writeFileSync(list, sequenceConcatText(images, fps));
    const output = path.join(dir, `sequence-${fps}.mov`);
    run(['-f', 'concat', '-safe', '0', '-i', list, '-r', String(fps), '-frames:v', '3', '-an', ...conversionOutputArgs('hap'), output]);
    const decoded = run(['-i', output, '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']);
    expect(decoded.length).toBe(3 * 64 * 64 * 4);
    expect(decoded[0]).toBeGreaterThan(200);
    expect(decoded[64 * 64 * 4 + 1]).toBeGreaterThan(100);
    expect(decoded[2 * 64 * 64 * 4 + 2]).toBeGreaterThan(200);
  });
  it('leaves existing files untouched and removes only its partial output on cancellation', () => {
    const existing = path.join(dir, 'keep.mov'); fs.writeFileSync(existing, 'keep');
    expect(() => stageConversionOutput(existing, 'hap')).toThrow('already exists');
    expect(fs.readFileSync(existing, 'utf8')).toBe('keep');
    const target = path.join(dir, 'cancel.mov'), staged = stageConversionOutput(target, 'hap');
    fs.writeFileSync(staged.temporaryPath, 'partial'); staged.cleanup();
    expect(fs.existsSync(target)).toBe(false); expect(fs.existsSync(staged.temporaryPath)).toBe(false);
  });
  it('refuses a target created during conversion and mismatched containers', () => {
    const target = path.join(dir, 'race.mov'), staged = stageConversionOutput(target, 'hap');
    try {
      fs.writeFileSync(staged.temporaryPath, 'encoded'); fs.writeFileSync(target, 'other');
      expect(() => staged.complete()).toThrow(); expect(fs.readFileSync(target, 'utf8')).toBe('other');
    } finally { staged.cleanup(); }
    expect(() => stageConversionOutput(path.join(dir, 'hap.mp4'), 'hap')).toThrow('.mov');
    expect(() => conversionOutputArgs('unknown')).toThrow('supported');
  });
});
