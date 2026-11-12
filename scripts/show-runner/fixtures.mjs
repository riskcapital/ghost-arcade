// Test media generated on demand with the bundled ffmpeg: solid-colour
// clips make colour checks exact, test bars give motion and detail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { styleSong, STYLE_SONGS } from './styleSongs.mjs';

const require = createRequire(import.meta.url);

export const FIXTURE_COLOURS = {
  white: 'white', red: 'red', yellow: 'yellow', green: '0x00ff00', blue: 'blue',
  cyan: 'cyan', magenta: 'magenta', orange: 'orange', black: 'black',
};

export function fixtureDir() {
  const dir = path.join(os.homedir(), '.ghost-arcade', 'show-runner', 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Path to a fixture clip, generating it the first time. Names:
 *  `<colour>.mp4`, `<colour>.mov` (HAP), `bars.mp4` (moving test bars),
 *  `ramp.mp4` (10 s grey ramp, brightness = time / 10), `framecode.mp4`
 *  (10 s, the frame number in binary bars), `flash.mp4` + `click.wav`
 *  (a white flash and a click at every whole second, for sync checks). */
export function fixture(name) {
  // An absolute path is a clip of the user's own (real-world decks).
  if (path.isAbsolute(name)) return name;
  const file = path.join(fixtureDir(), name);
  if (fs.existsSync(file)) return file;
  const ffmpeg = process.env.GA_FFMPEG_PATH || require('ffmpeg-static');
  let input;
  const [base, ext] = name.split('.');
  if (base === 'ramp') {
    // 10 s grey ramp: brightness = media time / 10, so a frame's mean says
    // which moment of the clip it is.
    execFileSync(process.env.GA_FFMPEG_PATH || require('ffmpeg-static'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30',
      '-vf', "geq=r='255*T/10':g='255*T/10':b='255*T/10'", '-t', '10',
      ...(ext === 'mov' ? ['-c:v', 'hap'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15']), '-an', file]);
    return file;
  }
  if (base === 'framecode') {
    // 10 s at 30 fps; nine black/white bars spell the frame number in
    // binary (left = lowest bit), so a decoded frame says exactly which
    // frame of the clip it is.
    execFileSync(process.env.GA_FFMPEG_PATH || require('ffmpeg-static'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:size=288x64:rate=30',
      '-vf', "geq=lum='if(mod(floor(N/pow(2,floor(X/32))),2),235,16)':cb=128:cr=128", '-t', '10',
      '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', '-g', '15', '-an', file]);
    return file;
  }
  if (base === 'flash') {
    // 10 s at 30 fps: black, white for the first two frames of every second.
    // With click.wav on the same start, picture and sound line up exactly.
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30',
      '-vf', "geq=lum='if(lt(mod(N,30),2),235,16)':cb=128:cr=128", '-t', '10',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15', '-an', file]);
    return file;
  }
  if (base === 'click') {
    // 10 s, 48 kHz: a 10 ms 1 kHz click at the start of every second.
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi',
      '-i', "aevalsrc='if(lt(mod(t,1),0.01),0.8*sin(2*PI*1000*t),0)':s=48000:d=10", '-ac', '2', file]);
    return file;
  }
  if (base === 'sections') {
    // A synthetic dance track with a known structure at 120 BPM (bar = 2 s):
    // intro 8 bars, build 8, drop 16, breakdown 8, build 4, drop 8, outro 8
    // (the same song as src/lib/timeline/score/synthSong.testutil.ts).
    fs.writeFileSync(file, wavMono16(synthSections(), 22050));
    return file;
  }
  if (base.startsWith('song-') && STYLE_SONGS[base.slice(5)]) {
    // A synthetic song in one of Auto show's five styles (styleSongs.mjs):
    // song-chill, song-groove, song-driving, song-hard, song-cinematic.
    fs.writeFileSync(file, wavMono16(styleSong(base.slice(5), 22050), 22050));
    return file;
  }
  if (base === 'bars') input = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30'];
  else if (FIXTURE_COLOURS[base]) input = ['-f', 'lavfi', '-i', `color=c=${FIXTURE_COLOURS[base]}:size=640x360:rate=30`];
  else throw new Error(`unknown fixture ${name}`);
  const codec = ext === 'mov' ? ['-c:v', 'hap'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...input, '-t', '4', ...codec, '-an', file]);
  return file;
}

/** Nominal RGB (0..1) of a solid fixture, for colour checks. */
export const NAMED_RGB = {
  white: [1, 1, 1], red: [1, 0, 0], yellow: [1, 1, 0], green: [0, 1, 0], blue: [0, 0, 1],
  cyan: [0, 1, 1], magenta: [1, 0, 1], orange: [1, 0.65, 0], black: [0, 0, 0],
};

/** The synthetic song of synthSong.testutil.ts (SYNTH_DEFAULT), mono at 22.05 kHz. */
export function synthSections(sampleRate = 22050) {
  const bpm = 120;
  const parts = [['intro', 8], ['build', 8], ['drop', 16], ['breakdown', 8], ['build', 4], ['drop', 8], ['outro', 8]];
  const beat = 60 / bpm;
  const bar = beat * 4;
  const totalBars = parts.reduce((n, p) => n + p[1], 0);
  const n = Math.ceil((totalBars * bar + 0.5) * sampleRate);
  const out = new Float32Array(n);
  let seed = 7 >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const add = (t0, dur, fn) => {
    const a = Math.max(0, Math.floor(t0 * sampleRate));
    const b = Math.min(n, Math.floor((t0 + dur) * sampleRate));
    for (let i = a; i < b; i++) out[i] += fn(i / sampleRate - t0);
  };
  const kick = (t0, amp) => add(t0, 0.2, (t) => amp * Math.exp(-t * 18) * Math.sin(2 * Math.PI * (45 * t + 40 * (1 - Math.exp(-t * 30)) / 30)));
  const noiseHit = (t0, amp, len) => add(t0, len, (t) => amp * Math.exp(-t * 5 / len) * rnd());
  const pad = (t0, dur, amp) => add(t0, dur, (t) => amp * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t)) / 3);
  const bass = (t0, dur, amp) => add(t0, dur, (t) => amp * Math.exp(-t * 6) * (((55 * t) % 1) * 2 - 1));
  let t = 0;
  for (const [part, bars] of parts) {
    for (let b = 0; b < bars; b++) {
      const bt = t + b * bar;
      const progress = bars > 1 ? b / (bars - 1) : 1;
      if (part === 'intro') { pad(bt, bar, 0.06); for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2, 0.015, 0.03); }
      else if (part === 'build') {
        pad(bt, bar, 0.07);
        const perBeat = progress < 0.4 ? 1 : progress < 0.75 ? 2 : 4;
        for (let k = 0; k < 4 * perBeat; k++) noiseHit(bt + k * beat / perBeat, 0.08 + 0.2 * progress, 0.06);
        add(bt, bar, (x) => (0.02 + 0.12 * (progress + x / bar / bars)) * rnd());
      } else if (part === 'drop') {
        pad(bt, bar, 0.08);
        for (let e = 0; e < 4; e++) kick(bt + e * beat, 0.9);
        for (let e = 0; e < 8; e++) bass(bt + e * beat / 2, beat / 2, 0.3);
        noiseHit(bt + beat, 0.35, 0.1); noiseHit(bt + 3 * beat, 0.35, 0.1);
        for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2 + beat / 4, 0.08, 0.03);
      } else if (part === 'breakdown') pad(bt, bar, 0.09);
      else if (part === 'outro') {
        const fade = 1 - 0.8 * progress;
        for (let e = 0; e < 4; e++) kick(bt + e * beat, 0.5 * fade);
        for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2, 0.05 * fade, 0.03);
      }
    }
    t += bars * bar;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.95) for (let i = 0; i < n; i++) out[i] *= 0.95 / peak;
  return out;
}

function wavMono16(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
