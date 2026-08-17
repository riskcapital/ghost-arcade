#!/usr/bin/env node
/**
 * Windows only: put DXC beside the render core.
 *
 * The core selects `Dx12Compiler::DynamicDxc` and loads `dxcompiler.dll` /
 * `dxil.dll` at runtime. Windows resolves those from the directory of the
 * *executable being launched*, i.e. next to `ghost-render-core.exe` — not the
 * Electron app root. If they are missing, wgpu does NOT error: it silently
 * falls back to FXC, and the 63-shader warm-up goes from ~7s to ~50s on every
 * cold boot. That failure is invisible unless you are timing startup, which is
 * exactly why this is automated rather than left as a setup note.
 *
 * Electron ships both DLLs in its dist, so we copy from there and avoid
 * vendoring a 25 MB binary into the repo. (`static-dxc` would link DXC into
 * the core instead, but it needs ATL, which the VS Build Tools install used
 * here does not provide.)
 *
 * No-op on macOS/Linux. Never fails the build — a missing DLL degrades speed,
 * not correctness, and we would rather ship slow than not ship.
 */
import { existsSync, copyFileSync, mkdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DLLS = ['dxcompiler.dll', 'dxil.dll'];

if (process.platform !== 'win32') {
  process.exit(0);
}

const source = join(repoRoot, 'node_modules', 'electron', 'dist');
const targets = [
  join(repoRoot, 'native-renderer', 'target', 'release'),
  join(repoRoot, 'native-renderer', 'target', 'debug'),
].filter(existsSync);

if (!targets.length) {
  console.warn('[ensure-dxc] no cargo target dir yet — run after `cargo build`.');
  process.exit(0);
}

let copied = 0;
let skipped = 0;
for (const dll of DLLS) {
  const from = join(source, dll);
  if (!existsSync(from)) {
    console.warn(`[ensure-dxc] ${dll} not found in electron dist — DXC will be unavailable and `
      + 'wgpu will fall back to FXC (slow cold boot).');
    continue;
  }
  for (const targetDir of targets) {
    const to = join(targetDir, dll);
    // Copy only when absent or stale, so repeat builds stay quiet.
    if (existsSync(to) && statSync(to).size === statSync(from).size) {
      skipped += 1;
      continue;
    }
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(from, to);
    copied += 1;
  }
}

if (copied) console.log(`[ensure-dxc] copied ${copied} DXC dll(s) beside the render core.`);
else if (skipped) console.log('[ensure-dxc] DXC dlls already in place.');
