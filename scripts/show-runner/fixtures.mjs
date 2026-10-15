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
 *  `<colour>.mp4`, `<colour>.mov` (HAP), `bars.mp4` (moving test bars). */
export function fixture(name) {
  const file = path.join(fixtureDir(), name);
  if (fs.existsSync(file)) return file;
  const ffmpeg = process.env.GA_FFMPEG_PATH || require('ffmpeg-static');
  const [base, ext] = name.split('.');
  let input;
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
