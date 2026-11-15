#!/usr/bin/env node
// A release leaves the paid add-ons out (VITE_MUSIC_STUDIO=off and
// VITE_ANALOG_SYNTH=off, src/lib/features.ts). Fail the build if any of
// their content reached the packaged frontend: Audio Lab's shaders, their
// thumbnails or their entries in the shader manifest, and Analog Synth's
// shader and presets in the scripts.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] || 'dist';
const isf = join(dist, 'ISF');
const studioShader = /^(VX|NR|BG)-.*\.fs$/;
// Text found only in Analog Synth's shader (videosynth/shaders.ts) and its
// starting patches (videosynth/patch.ts): function names and preset ids.
const SYNTH_MARKERS = ['osc_phase', 'raw_source', 'videosynth/analog-synth', 'key-bars'];
const problems = [];
if (!existsSync(isf)) problems.push(`${isf} is missing: build the frontend first`);
else {
  const files = readdirSync(isf).filter((f) => studioShader.test(f));
  if (files.length) problems.push(`${files.length} Audio Lab shaders in ${isf} (e.g. ${files.slice(0, 3).join(', ')})`);
  if (existsSync(join(isf, 'voice-thumbs'))) problems.push(`${isf}/voice-thumbs is present`);
  const manifest = JSON.parse(readFileSync(join(isf, 'manifest.json'), 'utf8'));
  const listed = (manifest.shaders ?? []).filter((s) => studioShader.test(String(s.file ?? '')));
  if (listed.length) problems.push(`${listed.length} Audio Lab shaders listed in manifest.json`);
}

/** Every script in the build, at any depth. */
function scripts(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scripts(path, out);
    else if (/\.(m?js)$/.test(entry.name)) out.push(path);
  }
  return out;
}
const assets = join(dist, 'assets');
if (!existsSync(assets)) problems.push(`${assets} is missing: build the frontend first`);
else {
  for (const file of scripts(assets)) {
    const text = readFileSync(file, 'utf8');
    const found = SYNTH_MARKERS.filter((marker) => text.includes(marker));
    if (found.length) problems.push(`Analog Synth content in ${file} (${found.join(', ')})`);
  }
}

if (problems.length) {
  console.error('Release content check failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('Release content check: no Audio Lab or Analog Synth content in the frontend build.');
