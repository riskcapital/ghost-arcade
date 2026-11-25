#!/usr/bin/env node
// The "shell id": a fingerprint of everything an app-code update cannot
// replace. A code update carries the renderer (vite's dist/) only, so it can
// install only into an app whose shell is exactly the one it was built
// against: the same Electron, main and preload code (electron/**), native
// addons, render core, bundled server, the shaders shipped as resources,
// packaging config and the production npm packages inside app.asar.
//
// Built from git's blob ids for HEAD, so every CI runner (Windows checkouts
// convert line endings) computes the same id from the same commit, and
// docs, tests and the renderer (src/, public/) never change it. The
// version number is left out: 2.2.1 can be a code update for 2.2.0.
//
//   node scripts/code-update-shell.mjs          writes electron/updates/shell-id.json
//   node scripts/code-update-shell.mjs --print  prints the id
//
// Runs before every `npm run build` (package.json prebuild), so the packaged
// app carries its id; scripts/pack-code-update.mjs stamps the same id into
// the update's manifest.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SHELL_ID_FILE = 'electron/updates/shell-id.json';
const FORMAT = 'ga-shell-v1';

/** Tracked paths whose contents end up in the app outside dist/. */
export const SHELL_PATHS = [
  'electron',
  'server',
  'native-renderer/src',
  'native-renderer/assets',
  'native-renderer/build.rs',
  'native-renderer/Cargo.toml',
  'native-renderer/Cargo.lock',
  'scripts/build-native-core.mjs',
  'scripts/ensure-dxc.mjs',
  'build-resources',
  'electron-builder.yml',
  'ISF',
  'CuratedISF',
  'user-shaders',
  'ableton/GhostArcade',
];

/** The fields of package.json the packaged app depends on (not the version). */
const PACKAGE_FIELDS = ['name', 'productName', 'main', 'type', 'dependencies', 'optionalDependencies'];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  }
  return value;
}

/** { shellId, electron, files } for the commit checked out in `root`. */
export function computeShellId(root = ROOT) {
  const tree = execFileSync('git', ['ls-tree', '-r', '--full-tree', 'HEAD', '--', ...SHELL_PATHS], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const lines = tree.split('\n').filter(Boolean)
    // The id file itself is generated (and untracked); never let it count.
    .filter((line) => !line.endsWith(`\t${SHELL_ID_FILE}`))
    .sort();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const electron = lock.packages?.['node_modules/electron']?.version ?? '';
  // Production packages ship inside app.asar (main requires them).
  const prodPackages = Object.entries(lock.packages ?? {})
    .filter(([path, entry]) => path && !entry.dev && !entry.devOptional)
    .map(([path, entry]) => `${path}@${entry.version ?? ''}`)
    .sort();
  const hash = createHash('sha256');
  hash.update(`${FORMAT}\n`);
  hash.update(`electron ${electron}\n`);
  hash.update(`package ${JSON.stringify(stable(Object.fromEntries(PACKAGE_FIELDS.map((f) => [f, pkg[f] ?? null]))))}\n`);
  for (const p of prodPackages) hash.update(`npm ${p}\n`);
  for (const line of lines) hash.update(`${line}\n`);
  return { shellId: `sh1-${hash.digest('hex').slice(0, 32)}`, electron, files: lines.length };
}

/** Shell paths with uncommitted changes: the id describes HEAD, not them. */
export function dirtyShellPaths(root = ROOT) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...SHELL_PATHS], { cwd: root, encoding: 'utf8' });
    return out.split('\n').filter(Boolean).map((l) => l.slice(3)).filter((p) => p !== SHELL_ID_FILE);
  } catch {
    return [];
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let result;
  try {
    result = computeShellId();
  } catch (err) {
    // No git (a source tarball): the app gets no id and offers no code updates.
    console.warn(`[shell-id] not computed (${err.message.split('\n')[0]}); this build installs no code updates`);
    process.exit(0);
  }
  if (process.argv.includes('--print')) {
    console.log(result.shellId);
  } else {
    const file = join(ROOT, SHELL_ID_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ format: 'ghost-arcade-shell', v: 1, shellId: result.shellId, electron: result.electron }, null, 2)}\n`);
    const dirty = dirtyShellPaths();
    console.log(`[shell-id] ${result.shellId} (electron ${result.electron}, ${result.files} files)`);
    if (dirty.length) console.warn(`[shell-id] uncommitted changes in ${dirty.length} shell file(s) are not in the id (it describes HEAD)`);
  }
}
