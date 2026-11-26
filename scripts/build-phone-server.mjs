#!/usr/bin/env node
/**
 * Build the phone remote server (phone-server/, the Rust replacement for
 * server/ws-server.js that GA_RUST_PHONE_SERVER=1 switches on).
 *
 * Same shapes as the render core (scripts/build-native-core.mjs, which runs
 * this too): a universal x86_64 + arm64 binary on macOS unless --arch=host,
 * a single host binary elsewhere. The result is always at
 * phone-server/target/release/ghost-phone-server[.exe], where
 * electron-builder.yml and server/phone-server-rust.js look for it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(root, 'phone-server', 'Cargo.toml');
const targetDir = path.join(root, 'phone-server', 'target');
const BIN = process.platform === 'win32' ? 'ghost-phone-server.exe' : 'ghost-phone-server';
const archFlag = (process.argv.find((a) => a.startsWith('--arch=')) || '').split('=')[1] || '';
const wantUniversal = process.platform === 'darwin' && archFlag !== 'host';
const MAC_TARGETS = [
  { triple: 'aarch64-apple-darwin' },
  { triple: 'x86_64-apple-darwin' },
];

function run(cmd, args) {
  console.log(`[phone-server-build] ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root });
}

function cargoBuild(triple) {
  const args = ['build', '--manifest-path', manifest, '--release', '--locked'];
  if (triple) args.push('--target', triple);
  run('cargo', args);
}

if (!wantUniversal) {
  cargoBuild(null);
  console.log(`[phone-server-build] host build -> phone-server/target/release/${BIN}`);
  process.exit(0);
}

for (const t of MAC_TARGETS) cargoBuild(t.triple);
const releaseDir = path.join(targetDir, 'release');
mkdirSync(releaseDir, { recursive: true });
const output = path.join(releaseDir, BIN);
const inputs = MAC_TARGETS.map((t) => path.join(targetDir, t.triple, 'release', BIN));
for (const input of inputs) {
  if (!existsSync(input)) {
    console.error(`[phone-server-build] expected slice missing: ${input}`);
    process.exit(1);
  }
}
rmSync(output, { force: true });
run('lipo', ['-create', '-output', output, ...inputs]);
try {
  run('codesign', ['--force', '--sign', '-', output]);
} catch {
  console.warn('[phone-server-build] ad-hoc codesign failed — release signing still applies');
}
run('lipo', ['-info', output]);
