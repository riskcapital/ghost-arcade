#!/usr/bin/env node
// A release leaves the Music Studio out (VITE_MUSIC_STUDIO=off). Fail the
// build if any of its paid content reached the packaged frontend: its
// shaders, their thumbnails, or their entries in the shader manifest.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] || 'dist';
const isf = join(dist, 'ISF');
const studioShader = /^(VX|NR|BG)-.*\.fs$/;
const problems = [];
if (!existsSync(isf)) problems.push(`${isf} is missing: build the frontend first`);
else {
  const files = readdirSync(isf).filter((f) => studioShader.test(f));
  if (files.length) problems.push(`${files.length} Music Studio shaders in ${isf} (e.g. ${files.slice(0, 3).join(', ')})`);
  if (existsSync(join(isf, 'voice-thumbs'))) problems.push(`${isf}/voice-thumbs is present`);
  const manifest = JSON.parse(readFileSync(join(isf, 'manifest.json'), 'utf8'));
  const listed = (manifest.shaders ?? []).filter((s) => studioShader.test(String(s.file ?? '')));
  if (listed.length) problems.push(`${listed.length} Music Studio shaders listed in manifest.json`);
}
if (problems.length) {
  console.error('Release content check failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('Release content check: no Music Studio content in the frontend build.');
