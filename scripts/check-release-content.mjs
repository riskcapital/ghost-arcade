#!/usr/bin/env node
// A release ships the paid add-ons (Audio Lab, Analog Synth) locked behind
// this computer's licence (src/lib/addons/addonAccess.ts, electron/addons/).
// Fail the build when the add-ons or their licence check are missing from
// the packaged app, or when no production key can check a licence (only the
// development key, which a packaged app refuses, would leave every buyer
// locked out).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const dist = process.argv[2] || 'dist';
const isf = join(dist, 'ISF');
const studioShader = /^(VX|NR|BG)-.*\.fs$/;
// Text found only in Analog Synth's shader (videosynth/shaders.ts) and its
// starting patches (videosynth/patch.ts): function names and preset ids.
const SYNTH_MARKERS = ['osc_phase', 'raw_source', 'videosynth/analog-synth', 'key-bars'];
// The renderer's licence gate: the IPC it asks and the product ids it checks.
const GATE_MARKERS = ['addons_status', 'addon.audio-lab', 'addon.analog-synth'];
const problems = [];

if (!existsSync(isf)) problems.push(`${isf} is missing: build the frontend first`);
else {
  const files = readdirSync(isf).filter((f) => studioShader.test(f));
  if (!files.length) problems.push(`no Audio Lab shaders in ${isf}`);
  if (!existsSync(join(isf, 'voice-thumbs'))) problems.push(`${isf}/voice-thumbs is missing`);
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
  const missing = new Set([...SYNTH_MARKERS, ...GATE_MARKERS]);
  for (const file of scripts(assets)) {
    const text = readFileSync(file, 'utf8');
    for (const marker of missing) if (text.includes(marker)) missing.delete(marker);
    if (!missing.size) break;
  }
  const synth = SYNTH_MARKERS.filter((m) => missing.has(m));
  const gate = GATE_MARKERS.filter((m) => missing.has(m));
  if (synth.length) problems.push(`Analog Synth is missing from the scripts (${synth.join(', ')})`);
  if (gate.length) problems.push(`the add-on licence check is missing from the scripts (${gate.join(', ')})`);
}

for (const file of ['electron/addons/entitlement.cjs', 'electron/addons/keys.cjs']) {
  if (!existsSync(file)) problems.push(`${file} is missing`);
}
if (existsSync('electron/addons/keys.cjs')) {
  const { productionLicenceKids } = createRequire(import.meta.url)('../electron/addons/keys.cjs');
  if (!productionLicenceKids().length) {
    problems.push('electron/addons/keys.cjs has no production licence key: a packaged app could not check any licence');
  }
}

if (problems.length) {
  console.error('Release content check failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('Release content check: Audio Lab and Analog Synth are in the build, behind the licence check.');
