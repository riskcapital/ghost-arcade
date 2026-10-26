#!/usr/bin/env node
// Measures every mobile candidate shader through the phone's renderer in a
// hidden Electron window (no window, no Dock icon) and checks it compiles with
// the audio patches. Writes native-mobile/shader-gpu-cost.json (lowest of two
// runs), then run scripts/mobile-shader-library.mjs to apply the limits.
//   node scripts/mobile-shader-bench.mjs [--check]   (--check: compile and report only)
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const folder = join(root, 'public/ISF');
const check = process.argv.includes('--check');
const excluded = new Set(JSON.parse(readFileSync(join(root, 'native-mobile/release-exclusions.json'), 'utf8')));

// Candidates as the library script sees them: shipped, with a thumbnail, no image input.
const paths = [];
(function visit(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'thumbnails') visit(file); continue; }
    if (!e.name.endsWith('.fs')) continue;
    const path = 'ISF/' + relative(folder, file).replaceAll('\\', '/');
    if (excluded.has(path)) continue;
    if (!existsSync(join(folder, 'thumbnails', path.slice(4, -3).replaceAll('/', '_') + '.jpg'))) continue;
    const header = readFileSync(file, 'utf8').match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//);
    try { if (!header || JSON.parse(header[1]).INPUTS?.some(i => String(i.TYPE).toLowerCase() === 'image')) continue; } catch { continue; }
    paths.push(path);
  }
})(folder);
paths.sort();
// --paths <file.json>: only these (for re-checking a few), no file written.
const only = process.argv.indexOf('--paths');
if (only > 0) { const chosen = new Set(JSON.parse(readFileSync(process.argv[only + 1], 'utf8'))); paths.splice(0, paths.length, ...paths.filter(p => chosen.has(p))); }

const port = 5199;
const server = await createServer({ root, configFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'ga-bench-vite-')), logLevel: 'error', optimizeDeps: { entries: ['scripts/mobile-shader-bench/index.html'] }, server: { port, strictPort: true } });
await server.listen();

const electron = createRequire(import.meta.url)('electron');
const mainFile = join(mkdtempSync(join(tmpdir(), 'ga-bench-electron-')), 'main.cjs');
writeFileSync(mainFile, `
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (event) => {
    const text = String(event.message ?? '');
    if (text.startsWith('BENCH_')) process.stdout.write(text + '\\n');
    if (text.startsWith('BENCH_DONE')) app.quit();
  });
  win.loadURL(process.env.BENCH_URL);
});
`);

function run() {
  return new Promise((resolveRun, reject) => {
    const extra = process.env.BENCH_QUERY ? '&' + process.env.BENCH_QUERY : '';
    const url = `http://localhost:${port}/scripts/mobile-shader-bench/index.html?paths=${encodeURIComponent(JSON.stringify(paths))}${extra}`;
    const child = spawn(electron, [mainFile], { env: { ...process.env, BENCH_URL: url }, stdio: ['ignore', 'pipe', 'inherit'] });
    let buffer = '', done = null, count = 0;
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (line.startsWith('BENCH_ONE ')) { count++; if (count % 40 === 0) process.stderr.write(`  ${count}/${paths.length}\n`); }
        if (line.startsWith('BENCH_DONE ')) done = JSON.parse(line.slice(11));
      }
    });
    child.on('exit', () => (done ? resolveRun(done) : reject(new Error('The bench window closed before finishing.'))));
  });
}

try {
  process.stderr.write(`Measuring ${paths.length} shaders...\n`);
  const first = await run();
  const errors = first.filter(r => r.error);
  for (const r of errors) console.log(`COMPILE ${r.path}: ${r.error}`);
  console.log(`${paths.length - errors.length} of ${paths.length} compile with the audio patches.`);
  if (only > 0) for (const r of first) console.log(`MS ${r.ms?.toFixed(2)} lit ${r.lit} ${r.path}`);
  if (!check && only < 0) {
    const second = await run();
    const ms = {};
    for (const r of first) {
      const again = second.find(s => s.path === r.path);
      const best = Math.min(r.ms ?? Infinity, again?.ms ?? Infinity);
      if (Number.isFinite(best)) ms[r.path] = Math.round(best * 100) / 100;
    }
    writeFileSync(join(root, 'native-mobile/shader-gpu-cost.json'), JSON.stringify({
      method: 'Time of one 1280x720 frame of each shader through the mobile WebGL renderer (audio patches on, a live audio signal), GPU-synchronised, averaged over 8 frames at each of 4 points of its timeline (0, 13, 37 and 91 s); lowest of two runs. Measured with scripts/mobile-shader-bench.mjs.',
      reference: 'Apple M1 Max (ANGLE Metal). Phones are several times slower; the numbers rank shaders, they are not phone frame times.',
      measured: new Date().toISOString().slice(0, 10),
      ms,
    }, null, 1) + '\n');
    console.log(`Wrote ${Object.keys(ms).length} measurements to native-mobile/shader-gpu-cost.json`);
  }
  process.exitCode = errors.length ? 1 : 0;
} finally {
  await server.close();
}
