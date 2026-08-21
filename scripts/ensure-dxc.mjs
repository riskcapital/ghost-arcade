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
 * Electron ships both DLLs in its Windows dist, so we take them from there and
 * avoid vendoring a 25 MB binary into the repo. (`static-dxc` would link DXC
 * into the core instead, but it needs ATL, which the VS Build Tools install
 * used here does not provide.)
 *
 * Three sources, in order of cost:
 *   1. node_modules/electron/dist — populated on dev machines.
 *   2. The electron-builder / @electron/get download cache.
 *   3. The Electron release zip from GitHub.
 *
 * (2) and (3) exist because the electron npm package carries no postinstall
 * script, so `dist` is NEVER populated by a clean `npm ci` — which is exactly
 * what CI does. Relying on (1) alone meant the DLLs were silently absent on
 * every CI build, and afterPack.cjs then failed the Windows release.
 *
 * No-op on macOS/Linux. Never fails the build — a missing DLL degrades speed,
 * not correctness, and we would rather ship slow than not ship. afterPack.cjs
 * is the hard gate that decides whether a *release* may go out without them.
 */
import { existsSync, copyFileSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DLLS = ['dxcompiler.dll', 'dxil.dll'];

if (process.platform !== 'win32') {
  process.exit(0);
}

const targets = [
  join(repoRoot, 'native-renderer', 'target', 'release'),
  join(repoRoot, 'native-renderer', 'target', 'debug'),
].filter(existsSync);

if (!targets.length) {
  console.warn('[ensure-dxc] no cargo target dir yet — run after `cargo build`.');
  process.exit(0);
}

/** Electron version from the installed package, so the DXC matches the runtime. */
function electronVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
    );
    return pkg.version || null;
  } catch {
    return null;
  }
}

/** Electron publishes win32-x64 / win32-arm64; the core is built for the host. */
const electronArch = process.arch === 'arm64' ? 'arm64' : 'x64';

/**
 * Pull single entries out of a zip without extracting all 144 MB of it.
 * PowerShell ships with Windows and this path is Windows-only, so there is
 * no dependency to add.
 */
function extractFromZip(zipPath, outDir) {
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath}');`,
    `foreach ($n in @(${DLLS.map((d) => `'${d}'`).join(',')})) {`,
    '  $e = $zip.Entries | Where-Object { $_.FullName -eq $n } | Select-Object -First 1;',
    '  if ($e) {',
    `    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path '${outDir}' $n), $true);`,
    '  }',
    '}',
    '$zip.Dispose();',
  ].join(' ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'pipe',
  });
}

/** Where @electron/get and electron-builder park downloaded zips. */
function cachedZips(version) {
  const bases = [
    process.env.electron_config_cache,
    process.env.ELECTRON_CACHE,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'electron', 'Cache'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache'),
    process.env.USERPROFILE && join(process.env.USERPROFILE, '.cache', 'electron'),
  ].filter(Boolean);
  const name = `electron-v${version}-win32-${electronArch}.zip`;
  const found = [];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    // @electron/get nests under a hash dir; check both shapes.
    found.push(join(base, name));
    try {
      for (const sub of execFileSync('cmd.exe', ['/c', 'dir', '/b', base], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean)) {
        found.push(join(base, sub, name));
      }
    } catch {
      /* unreadable cache dir is not an error */
    }
  }
  return found.filter(existsSync);
}

async function download(version) {
  const url = `https://github.com/electron/electron/releases/download/v${version}`
    + `/electron-v${version}-win32-${electronArch}.zip`;
  const dest = join(tmpdir(), `electron-v${version}-win32-${electronArch}.zip`);
  if (existsSync(dest) && statSync(dest).size > 1024 * 1024) return dest;
  console.log(`[ensure-dxc] fetching DXC from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/** Resolve a directory that holds both DLLs, trying cheapest source first. */
async function resolveSource() {
  const dist = join(repoRoot, 'node_modules', 'electron', 'dist');
  if (DLLS.every((d) => existsSync(join(dist, d)))) return dist;

  const version = electronVersion();
  if (!version) {
    console.warn('[ensure-dxc] electron version unreadable — cannot locate DXC.');
    return null;
  }

  const staging = join(repoRoot, 'native-renderer', 'target', '.dxc');
  mkdirSync(staging, { recursive: true });
  if (DLLS.every((d) => existsSync(join(staging, d)))) return staging;

  for (const zip of cachedZips(version)) {
    try {
      extractFromZip(zip, staging);
      if (DLLS.every((d) => existsSync(join(staging, d)))) {
        console.log(`[ensure-dxc] took DXC from cached ${zip}`);
        return staging;
      }
    } catch {
      /* try the next candidate */
    }
  }

  try {
    extractFromZip(await download(version), staging);
    if (DLLS.every((d) => existsSync(join(staging, d)))) return staging;
  } catch (err) {
    console.warn(`[ensure-dxc] could not fetch DXC: ${err.message}`);
  }
  return null;
}

const source = await resolveSource();
if (!source) {
  console.warn('[ensure-dxc] DXC unavailable — wgpu will fall back to FXC (slow cold boot).');
  process.exit(0);
}

let copied = 0;
let skipped = 0;
for (const dll of DLLS) {
  const from = join(source, dll);
  if (!existsSync(from)) {
    console.warn(`[ensure-dxc] ${dll} not found in ${source} — wgpu will fall back to FXC.`);
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
