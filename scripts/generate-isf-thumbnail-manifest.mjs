#!/usr/bin/env node
/**
 * Build public/ISF/thumbnails/manifest.json.
 *
 * The shader tray looks its thumbnails up through this manifest
 * (MediaTray.svelte, MobileApp.svelte). Without it every fetch 404s, the
 * lookup map stays empty, and each shader falls through to the runtime
 * WebGL generator — recompiling and rendering ~350 shaders in the UI
 * renderer to recreate JPEGs that are already on disk. That saturates the
 * renderer and GPU processes and freezes the editor, and it did so silently,
 * because the missing manifest was swallowed by an empty catch.
 *
 * Key shape matters. The tray keys off the BASENAME of the shader's URL:
 *
 *   src   = './ISF/' + file.split('/').map(encodeURIComponent).join('/')
 *   key   = src.split('/').pop().replace('.fs', '')
 *
 * so the key is the URI-encoded basename without its extension, with any
 * subdirectory dropped. The value is the raw thumbnail filename — the tray
 * applies encodeURIComponent to it itself, so encoding it here would
 * double-encode.
 *
 * Thumbnails for shaders in subdirectories are stored flattened, with the
 * separator rewritten to an underscore:
 *
 *   cube shaders/ROOM_01_EmberDrift.fs -> cube shaders_ROOM_01_EmberDrift.jpg
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isfDir = path.join(root, 'public', 'ISF');
const thumbDir = path.join(isfDir, 'thumbnails');
const outFile = path.join(thumbDir, 'manifest.json');

const manifest = JSON.parse(readFileSync(path.join(isfDir, 'manifest.json'), 'utf8'));
const files = manifest.version === 2
  ? manifest.shaders.map((entry) => entry.file)
  : manifest.shaders;

// basename-without-extension -> actual filename on disk
const byStem = new Map();
for (const name of readdirSync(thumbDir)) {
  if (name === 'manifest.json') continue;
  byStem.set(name.replace(/\.[^.]+$/, ''), name);
}

const thumbnails = {};
const missing = [];
for (const file of files) {
  const stem = file.replace(/\.fs$/, '');
  const base = stem.split('/').pop();
  // Exact basename first, then the flattened subdirectory form.
  const hit = byStem.get(base) || byStem.get(stem.split('/').join('_'));
  if (!hit) {
    missing.push(file);
    continue;
  }
  thumbnails[encodeURIComponent(base)] = hit;
}

writeFileSync(outFile, `${JSON.stringify({ version: 1, thumbnails }, null, 2)}\n`);

const mapped = Object.keys(thumbnails).length;
console.log(`[isf-thumbnails] ${mapped}/${files.length} shaders mapped -> ${path.relative(root, outFile)}`);
if (missing.length) {
  // Not fatal: these still work, they just cost a runtime WebGL render each.
  console.warn(`[isf-thumbnails] ${missing.length} shader(s) have no pre-rendered thumbnail and will be generated at runtime:`);
  for (const file of missing) console.warn(`  ${file}`);
}
