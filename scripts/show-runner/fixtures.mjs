// Test media generated on demand with the bundled ffmpeg: solid-colour
// clips make colour checks exact, test bars give motion and detail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

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
