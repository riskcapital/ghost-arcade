#!/usr/bin/env node
/**
 * The remote server tests (src/lib/remote) against the Rust phone server:
 * builds it, then runs the same suites with GA_TEST_PHONE_SERVER=rust.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-phone-server.mjs'), '--arch=host'], { stdio: 'inherit', cwd: root });
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
execFileSync(process.execPath, [vitest, 'run', 'src/lib/remote', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, GA_TEST_PHONE_SERVER: 'rust' },
});
