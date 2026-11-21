#!/usr/bin/env node
/**
 * Bake the visual browser's pictures of the render core's instruments (the
 * Audio Lab engine voices) into public/ISF/voice-thumbs/engine-<id>.jpg, as
 * build-voice-thumbnails.mjs does for the VX voices: each instrument with its
 * default settings, through the real core, on a real track, frame-locked.
 * Cloud instruments read the core's bundled default scan.
 *
 *   node scripts/build-engine-voice-thumbnails.mjs [--wav track.wav]
 *
 * Needs a release core (cargo build --release in native-renderer).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const wavAt = args.indexOf('--wav');
const wav = wavAt >= 0 ? args[wavAt + 1] : join(root, '..', 'music-studio-auditions', 'jack-128bpm.wav');
// A moment in the track where each instrument reads well.
const AT = {
  strands: 2.92, 'cloud-pulse': 2.8, 'cloud-flock': 0.9, 'depth-lights': 3.1, 'ribbon-field': 5.2,
  'shockwave-rings': 3.0, 'fluid-ink': 5.4, 'lightning-arcs': 2.4, 'spectral-terrain': 5.3, 'mesh-shatter': 1.25,
};

const work = mkdtempSync(join(tmpdir(), 'engine-thumbs-'));
try {
  const plan = { wav, fps: 60, width: 640, height: 360, shots: Object.entries(AT).map(([kind, t]) => ({ name: kind, kind, params: {}, at: [t] })) };
  writeFileSync(join(work, 'plan.json'), JSON.stringify(plan));
  execFileSync(process.execPath, [join(root, 'scripts', 'native-audio-visuals-stills.mjs'), '--plan', join(work, 'plan.json'), '--out', work], { stdio: 'inherit' });
  const thumbs = join(root, 'public', 'ISF', 'voice-thumbs');
  const made = [];
  for (const kind of Object.keys(AT)) {
    const png = readdirSync(work).find((f) => f.startsWith(`${kind}-`) && f.endsWith('.png'));
    if (!png) throw new Error(`no still for ${kind}`);
    const name = `engine-${kind}.jpg`;
    execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', join(work, png), '-vf', 'scale=320:180', '-q:v', '4', join(thumbs, name)]);
    made.push(name);
  }
  const indexPath = join(thumbs, 'index.json');
  const index = new Set(JSON.parse(readFileSync(indexPath, 'utf8')));
  for (const name of made) index.add(name);
  writeFileSync(indexPath, JSON.stringify([...index].sort()));
  console.log(`baked ${made.length} engine voice pictures`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
