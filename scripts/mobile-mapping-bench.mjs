#!/usr/bin/env node
// Measures what the mapping tools cost in the phone's output compositor (corner
// quads, 9x9 and curved meshes, free-form shapes, masks, Looks; 16 surfaces at
// 720p and 1080p) and what one edit costs on the CPU. Reports only.
//   node scripts/mobile-mapping-bench.mjs                      hidden Electron window (Mac GPU)
//   node scripts/mobile-mapping-bench.mjs --ios-simulator <udid>  Safari on an iOS simulator
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const port = 5198;
const posted = [];
const collect = { name: 'bench-results', configureServer(dev) { dev.middlewares.use('/__bench-result', (req, res) => { let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { posted.push(body); res.end('ok'); }); }); } };
const server = await createServer({ plugins: [collect], root, configFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'ga-mapbench-vite-')), logLevel: 'error', optimizeDeps: { entries: ['scripts/mobile-shader-bench/mapping.html'] }, server: { port, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const page = `http://localhost:${port}/scripts/mobile-shader-bench/mapping.html`;
const print = (lines) => {
  for (const line of lines.filter((l) => l.startsWith('BENCH_ONE '))) {
    const r = JSON.parse(line.slice(10));
    console.log(r.quality ? `${String(r.quality).padStart(4)}p  ${r.ms.toFixed(2).padStart(6)} ms/frame  (first frame ${r.firstFrameMs} ms)  ${r.name}` : `${r.name}: ${r.ms} ms at ${r.size.width}x${r.size.height} (+${r.fieldMs} ms Look field); while dragging ${r.draftMs} ms at ${r.draftSize.width}x${r.draftSize.height}`);
  }
  for (const line of lines.filter((l) => l.startsWith('BENCH_ERROR'))) console.log(line);
};
try {
  const simulator = process.argv.indexOf('--ios-simulator');
  if (simulator > 0) {
    const udid = process.argv[simulator + 1];
    const simctl = (...args) => new Promise((done) => spawn('xcrun', ['simctl', ...args], { stdio: 'ignore' }).on('exit', done));
    await simctl('boot', udid);
    await simctl('bootstatus', udid, '-b');
    await simctl('openurl', udid, `${page}?report=1`);
    const started = Date.now();
    while (!posted.some((l) => l.startsWith('BENCH_DONE')) && Date.now() - started < 10 * 60_000) await new Promise((r) => setTimeout(r, 1000));
    console.log('WebKit (iOS simulator; the Mac GPU behind it):');
    print(posted);
    await simctl('terminate', udid, 'com.apple.mobilesafari');
  } else {
    const electron = createRequire(import.meta.url)('electron');
    const mainFile = join(mkdtempSync(join(tmpdir(), 'ga-mapbench-electron-')), 'main.cjs');
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
});`);
    const lines = await new Promise((done) => {
      const child = spawn(electron, [mainFile], { env: { ...process.env, BENCH_URL: page }, stdio: ['ignore', 'pipe', 'inherit'] });
      let buffer = '';
      const out = [];
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) { out.push(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
      });
      child.on('exit', () => done(out));
    });
    console.log('Hidden Electron window (Mac GPU, ANGLE Metal):');
    print(lines);
  }
} finally {
  await server.close();
}
process.exit();
