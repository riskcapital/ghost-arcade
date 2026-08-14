#!/usr/bin/env node
/**
 * Build the native render core.
 *
 * On macOS this produces a UNIVERSAL binary (x86_64 + arm64) by building each
 * target and lipo-ing them together — the same shape `electron/native/scripts/
 * build-native.mjs` produces for the C++ addons.
 *
 * Why it matters: `cargo build --release` only builds for the host arch, so an
 * Apple Silicon machine produced an arm64-only core while electron-builder was
 * configured to ship BOTH x64 and arm64 DMGs. The Intel DMG would have carried
 * a binary that cannot execute at all, and because the desktop app is
 * native-only (NATIVE_ENGINE_ONLY) there is no renderer to fall back to — the
 * app would open straight into NATIVE OFFLINE. Rosetta does not help; it
 * translates x86 to arm, not the reverse.
 *
 * Intel Mac support is EXPERIMENTAL: it is built and shipped, but the Metal
 * interop paths (IOSurface import/export, storage modes) have not been
 * validated on a discrete-GPU Intel Mac.
 *
 * Flags:
 *   --arch=host      Build only for this machine (fast; the dev default).
 *   --arch=universal Force the universal build even mid-iteration.
 * Non-macOS platforms always build a single host binary.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(root, 'native-renderer', 'Cargo.toml');
const targetDir = path.join(root, 'native-renderer', 'target');
const BIN = process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core';

const archFlag = (process.argv.find((a) => a.startsWith('--arch=')) || '').split('=')[1] || '';
const wantUniversal = process.platform === 'darwin' && archFlag !== 'host';

const MAC_TARGETS = [
  { triple: 'aarch64-apple-darwin', lipo: 'arm64' },
  { triple: 'x86_64-apple-darwin', lipo: 'x86_64' },
];

function run(cmd, args) {
  console.log(`[core-build] ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root });
}

function cargoBuild(triple) {
  const args = ['build', '--manifest-path', manifest, '--release'];
  if (triple) args.push('--target', triple);
  run('cargo', args);
}

function installedTargets() {
  try {
    return execFileSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

if (!wantUniversal) {
  cargoBuild(null);
  console.log(`[core-build] host build -> native-renderer/target/release/${BIN}`);
  process.exit(0);
}

const installed = installedTargets();
const missing = MAC_TARGETS.filter((t) => !installed.includes(t.triple));
if (missing.length) {
  // Don't silently produce a single-arch binary that would ship broken —
  // say exactly what to run.
  console.error('[core-build] missing Rust target(s) for the universal build:');
  for (const t of missing) console.error(`  rustup target add ${t.triple}`);
  console.error('[core-build] or build host-only with: npm run native:build -- --arch=host');
  process.exit(1);
}

for (const t of MAC_TARGETS) cargoBuild(t.triple);

// lipo into the plain release path, which is where the broker and the
// packaging step already look for the binary.
const releaseDir = path.join(targetDir, 'release');
mkdirSync(releaseDir, { recursive: true });
const output = path.join(releaseDir, BIN);
const inputs = MAC_TARGETS.map((t) => path.join(targetDir, t.triple, 'release', BIN));

for (const input of inputs) {
  if (!existsSync(input)) {
    console.error(`[core-build] expected slice missing: ${input}`);
    process.exit(1);
  }
}

// cargo may have left a host-arch binary here from a previous plain build.
rmSync(output, { force: true });
run('lipo', ['-create', '-output', output, ...inputs]);
// Ad-hoc sign so Gatekeeper accepts the freshly-lipo'd binary in dev;
// electron-builder re-signs it properly for release.
try {
  run('codesign', ['--force', '--sign', '-', output]);
} catch {
  console.warn('[core-build] ad-hoc codesign failed — release signing still applies');
}
run('lipo', ['-info', output]);
copyFileSync(output, path.join(releaseDir, `${BIN}.universal`));
console.log('[core-build] universal core built (Intel Mac support is experimental/untested)');
