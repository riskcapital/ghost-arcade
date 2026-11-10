/**
 * The Live script and the Timeline's launch requests, run in Python against
 * a fake Live (tests/ableton/liveScriptHarness.py). Checks the new fields
 * (`q`, `pos`) work, that requests without them work as before, and that a
 * script from before them ignores them and still launches.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const harness = path.join(root, 'tests/ableton/liveScriptHarness.py');
const script = path.join(root, 'ableton/GhostArcade/GhostArcade.py');

function python(): string | null {
  for (const bin of ['python3', 'python']) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch { /* next */ }
  }
  return null;
}
const py = python();

function run(scriptPath: string, requests: unknown[], live10 = false): { protocol: number; calls: unknown[][] } {
  const out = execFileSync(py!, [harness, scriptPath, JSON.stringify(requests), ...(live10 ? ['--live10'] : [])], { encoding: 'utf8' });
  return JSON.parse(out);
}

/** The script as shipped before the Timeline's fields (protocol 4), when git has it. */
function oldScript(): string | null {
  try {
    const text = execFileSync('git', ['show', 'v2.1.11:ableton/GhostArcade/GhostArcade.py'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ga-live-')), 'GhostArcade.py');
    fs.writeFileSync(file, text);
    return file;
  } catch {
    return null;
  }
}

const requests = [
  { t: 'fire_clip', i: 0, s: 1 },
  { t: 'fire_clip', i: 1, s: 2, q: 7, pos: 3.5 },
  { t: '_tick' },
  { t: 'stop_track', i: 1, q: 0 },
  { t: 'stop_track', i: 0 },
  { t: 'stop_all', q: 0 },
  { t: 'stop_all' },
  { t: 'a_request_from_the_future', x: 1 },
];

describe.skipIf(!py)('the Live script and Timeline launches', () => {
  it('protocol 5: a launch quantise per fire, a jump to the block position once playing, unquantised stops', () => {
    const { protocol, calls } = run(script, requests);
    expect(protocol).toBe(5);
    expect(calls).toEqual([
      ['fire', 0, 1, [], {}, 4],
      ['fire', 1, 2, [], { launch_quantization: 7 }, 4],
      // The jump runs with the set's quantise off, then it is put back.
      ['set_quantize', 0],
      ['jump', 1, 2, 3.5, 0],
      ['set_quantize', 4],
      ['stop_track', 1, [false], 4],
      ['stop_track', 0, [], 4],
      ['stop_all', [false], 4],
      ['stop_all', [], 4],
    ]);
  });

  it('a Live without per-launch arguments: the set quantise is switched for the one launch and put back', () => {
    const { calls } = run(script, [{ t: 'fire_clip', i: 1, s: 2, q: 7 }, { t: 'stop_track', i: 1, q: 0 }], true);
    expect(calls).toEqual([
      ['set_quantize', 7],
      ['fire', 1, 2, [], {}, 7],
      ['set_quantize', 4],
      ['set_quantize', 0],
      ['stop_track', 1, [], 0],
      ['set_quantize', 4],
    ]);
  });

  it('a script from before the Timeline (protocol 4) ignores the new fields and still launches and stops', () => {
    const old = oldScript();
    if (!old) return;
    const { protocol, calls } = run(old, requests);
    expect(protocol).toBe(4);
    expect(calls).toEqual([
      ['fire', 0, 1, [], {}, 4],
      ['fire', 1, 2, [], {}, 4],
      ['stop_track', 1, [], 4],
      ['stop_track', 0, [], 4],
      ['stop_all', [], 4],
      ['stop_all', [], 4],
    ]);
  });
});
