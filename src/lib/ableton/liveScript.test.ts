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

interface RunResult { protocol: number; calls: unknown[][]; cues: [string, number][]; replies: Record<string, unknown>[]; song_time: number }

function run(scriptPath: string, requests: unknown[], live10 = false, opts: { stopped?: boolean; cues?: [string, number][] } = {}): RunResult {
  const args = [harness, scriptPath, JSON.stringify(requests), ...(live10 ? ['--live10'] : []), ...(opts.stopped ? ['--stopped'] : []), ...(opts.cues ? ['--cues', JSON.stringify(opts.cues)] : [])];
  const out = execFileSync(py!, args, { encoding: 'utf8' });
  return JSON.parse(out);
}

/** The script as shipped before the Timeline's fields (protocol 4), when git has it. */
function oldScript(ref = 'v2.1.11'): string | null {
  try {
    const text = execFileSync('git', ['show', `${ref}:ableton/GhostArcade/GhostArcade.py`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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
    expect(protocol).toBe(6);
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

  it('protocol 6: locators by name, moved or added, nothing deleted, the playhead put back', () => {
    const r = run(script, [
      { t: 'jump', time: 12 },
      { t: 'set_locators', id: 3, items: [{ name: 'Intro', beat: 0 }, { name: 'Drop', beat: 32 }, { name: 'Build', beat: 16 }, { name: 'Mine', beat: 8 }] },
    ], false, { stopped: true, cues: [['Drop', 64], ['Mine', 8]] });
    expect(r.protocol).toBe(6);
    expect(r.cues).toEqual([['Intro', 0], ['Mine', 8], ['Build', 16], ['Drop', 32]]);
    expect(r.replies).toEqual([{ t: 'locators_done', id: 3, added: 2, moved: 1, kept: 1, errors: [] }]);
    expect(r.song_time).toBe(12);
  });

  it('protocol 6: a locator on the beat of another one renames it rather than toggling it away', () => {
    const r = run(script, [{ t: 'set_locators', id: 1, items: [{ name: 'Drop', beat: 16 }] }], false, { stopped: true, cues: [['16', 16]] });
    expect(r.cues).toEqual([['Drop', 16]]);
    expect(r.replies[0]).toMatchObject({ added: 1, errors: [] });
  });

  it('protocol 6: while Live plays, locators are left alone and the app is told why', () => {
    const r = run(script, [{ t: 'set_locators', id: 2, items: [{ name: 'Drop', beat: 16 }] }], false, { cues: [['Intro', 0]] });
    expect(r.cues).toEqual([['Intro', 0]]);
    expect(r.replies).toEqual([{ t: 'locators_done', id: 2, added: 0, moved: 0, kept: 0, errors: ['playing'] }]);
  });

  it('protocol 6: a scene fires with its own launch quantise, then the set\'s is put back; without q as before', () => {
    const { calls } = run(script, [{ t: 'fire_scene', s: 1, q: 7 }, { t: 'fire_scene', s: 2 }, { t: 'fire_scene', s: 9, q: 7 }]);
    expect(calls).toEqual([
      ['set_quantize', 7],
      ['fire_scene', 1, [], 7],
      ['set_quantize', 4],
      ['fire_scene', 2, [], 4],
    ]);
  });

  for (const [ref, protocol] of [['v2.1.11', 4], ['507e62b0', 5]] as const) {
    it(`an older script (protocol ${protocol}) ignores locators and the scene quantise: scenes still fire on the set's`, () => {
      const old = oldScript(ref);
      if (!old) return;
      const r = run(old, [
        { t: 'set_locators', id: 1, items: [{ name: 'Drop', beat: 16 }] },
        { t: 'fire_scene', s: 1, q: 7 },
        { t: 'fire_clip', i: 0, s: 1 },
      ], false, { stopped: true, cues: [['Intro', 0]] });
      expect(r.protocol).toBe(protocol);
      expect(r.cues).toEqual([['Intro', 0]]);
      expect(r.replies).toEqual([]);
      expect(r.calls).toEqual([
        ['fire_scene', 1, [], 4],
        ['fire', 0, 1, [], {}, 4],
      ]);
    });
  }
});
