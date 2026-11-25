#!/usr/bin/env node
// Packs the built renderer (dist/) as a signed app-code update:
//   dist-code-update/ghost-arcade-code-<version>.zip
//   dist-code-update/code-update-<version>.json   (signed manifest)
// Both go up as extra release assets; electron/updates/code-update.cjs
// installs them into apps whose shell id matches (scripts/code-update-shell.mjs).
//
// Key: CODE_UPDATE_SIGNING_KEY (from scripts/generate-update-key.mjs), key
// id CODE_UPDATE_KID (default code-2026-11). Without a key this prints a
// note and exits 0, so a release without the secret still ships its
// installers. --dev signs with the published development key instead
// (accepted only by an app that is not packaged).
//
//   node scripts/pack-code-update.mjs [--dist dist] [--out dist-code-update] [--version 2.2.1] [--dev]
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { computeShellId, dirtyShellPaths, SHELL_ID_FILE } from './code-update-shell.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(opt('dist', 'dist'));
const out = resolve(opt('out', 'dist-code-update'));
const version = opt('version', JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
const dev = args.includes('--dev');

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
/** The development key's seed is public on purpose: see electron/updates/keys.cjs. */
const DEV_SEED = createHash('sha256').update('ghost-arcade code-update development key v1').digest();

function loadKey() {
  if (dev) return { kid: 'code-dev', key: createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, DEV_SEED]), format: 'der', type: 'pkcs8' }) };
  const raw = String(process.env.CODE_UPDATE_SIGNING_KEY ?? '').trim();
  if (!raw) return null;
  const kid = String(process.env.CODE_UPDATE_KID ?? '').trim() || 'code-2026-11';
  let key;
  if (raw.includes('BEGIN')) key = createPrivateKey(raw);
  else if (/^[0-9a-f]{64}$/i.test(raw)) key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(raw, 'hex')]), format: 'der', type: 'pkcs8' });
  else key = createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('CODE_UPDATE_SIGNING_KEY is not an Ed25519 key');
  return { kid, key };
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function walk(dir, list = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink() || lstatSync(full).isSymbolicLink()) throw new Error(`links are not allowed in an update: ${full}`);
    if (entry.isDirectory()) walk(full, list);
    else list.push(full);
  }
  return list;
}

const signing = loadKey();
if (!signing) {
  console.log('[code-update] CODE_UPDATE_SIGNING_KEY is not set: no code update for this release (installers only).');
  process.exit(0);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a release version: ${version}`);
if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist}/index.html is missing: build the frontend first`);

const { shellId } = computeShellId(ROOT);
const baked = existsSync(join(ROOT, SHELL_ID_FILE)) ? JSON.parse(readFileSync(join(ROOT, SHELL_ID_FILE), 'utf8')).shellId : null;
if (baked && baked !== shellId) throw new Error(`${SHELL_ID_FILE} (${baked}) is not this commit's shell (${shellId}): rebuild`);
const dirty = dirtyShellPaths(ROOT);
if (dirty.length && !dev) throw new Error(`uncommitted shell changes (${dirty.slice(0, 5).join(', ')}): the update would name the wrong shell`);

const files = {};
for (const full of walk(dist).sort()) {
  const rel = relative(dist, full).split(sep).join('/');
  if (rel === '.code-update.json') continue;
  files[rel] = { size: statSync(full).size, sha256: sha256(full) };
}

mkdirSync(out, { recursive: true });
const archiveName = `ghost-arcade-code-${version}.zip`;
const archive = join(out, archiveName);
rmSync(archive, { force: true });
// -X: no extra attributes, -D: no directory entries, -q quiet. Run inside dist/ so paths are relative.
execFileSync('zip', ['-r', '-X', '-D', '-q', archive, '.', '-x', '.code-update.json'], { cwd: dist, stdio: 'inherit' });

const payload = JSON.stringify({
  v: 1,
  kid: signing.kid,
  version,
  shellId,
  created_at: new Date().toISOString(),
  archive: { name: archiveName, size: statSync(archive).size, sha256: sha256(archive) },
  files,
});
const envelope = {
  format: 'ghost-arcade-code-update',
  v: 1,
  kid: signing.kid,
  payload,
  signature: sign(null, Buffer.from(payload, 'utf8'), signing.key).toString('hex'),
};
const manifestPath = join(out, `code-update-${version}.json`);
writeFileSync(manifestPath, JSON.stringify(envelope));
const pub = createPublicKey(signing.key).export({ format: 'der', type: 'spki' });
// The apps that will install this carry keys.cjs: a key it does not list (or
// lists with another public key) would make an update nobody can install.
const { CODE_UPDATE_KEYS } = createRequire(import.meta.url)('../electron/updates/keys.cjs');
const listed = CODE_UPDATE_KEYS[signing.kid]?.publicKey;
const pubHex = pub.subarray(pub.length - 32).toString('hex');
if (!listed) console.warn(`[code-update] warning: ${signing.kid} is not in electron/updates/keys.cjs; only apps that carry it can install this update`);
else if (listed.toLowerCase() !== pubHex) throw new Error(`CODE_UPDATE_SIGNING_KEY does not match the public key of ${signing.kid} in electron/updates/keys.cjs`);
console.log(`[code-update] ${archiveName}: ${(statSync(archive).size / 1048576).toFixed(1)} MB, ${Object.keys(files).length} files, shell ${shellId}`);
console.log(`[code-update] signed with ${signing.kid} (public key ${pubHex})`);
