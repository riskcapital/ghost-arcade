#!/usr/bin/env node
// Runs the studio voices (public/ISF/VX-*.fs) through the phone's renderer and
// voice signals (scripts/mobile-voice-bench/), in a hidden Electron window or in
// Safari on an iOS simulator, driven by a song or a synthetic groove.
//   node scripts/mobile-voice-bench.mjs [--music <wav>] [--only A,B] [--out results.json]
//     Compile each voice, time a 1280x720 frame, measure how lit it is.
//   node scripts/mobile-voice-bench.mjs --ios-simulator <udid> [--only ...] [--out ...]
//     The same in Safari on a booted simulator: the phone's own WebKit compiler.
//   node scripts/mobile-voice-bench.mjs --render <dir> --music <wav> --at 30,52 [--size 640x360]
//     Play the song into each voice and save JPEG frames at those seconds.
//   node scripts/mobile-voice-bench.mjs --thumbnails --music <wav> --at 40 [--only ...]
//     The library thumbnails: each voice at that second of the song, drawn by the phone's
//     renderer at 640x360 and saved at 320x180 as public/ISF/thumbnails/VX-<name>.jpg.
//   node scripts/mobile-voice-bench.mjs --app-bundle [--music <wav>] [--only ...] [--moments 8,40]
//     Build the bench as the app's web content (dist-native-mobile), to measure on a
//     phone: `cd native-mobile && npx cap copy ios`, build and install the app, launch it
//     with `xcrun devicectl device process launch --console` and keep the BENCH_ lines.
//     Rebuild the real app afterwards (npm run native-mobile:sync).
import { build, createServer } from 'vite';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
let paths = readdirSync(join(root, 'public/ISF')).filter((f) => /^VX-.*\.fs$/.test(f)).sort().map((f) => `ISF/${f}`);
if (only) paths = paths.filter((p) => only.some((o) => p === `ISF/VX-${o}.fs` || p === `ISF/${o}` || p === o));
const music = arg('--music');
const thumbnails = process.argv.includes('--thumbnails');
const renderDir = thumbnails ? join(root, 'public/ISF/thumbnails') : arg('--render');
const [w, h] = (arg('--size') ?? (renderDir ? '640x360' : '1280x720')).split('x').map(Number);
const query = new URLSearchParams({ mode: renderDir ? 'render' : 'measure', w: String(w), h: String(h) });
if (music) query.set('music', '/__bench-music');
if (arg('--at')) query.set('at', JSON.stringify(arg('--at').split(',').map(Number)));
if (arg('--moments')) query.set('moments', JSON.stringify(arg('--moments').split(',').map(Number)));
if (process.argv.includes('--fps')) query.set('fps', '1');
if (thumbnails) query.set('out', '320x180');
if (arg('--step')) query.set('step', arg('--step'));
for (const name of ['fpsscale', 'fpssec', 'fpsfrom']) if (arg('--' + name)) query.set(name, name === 'fpsscale' ? JSON.stringify(arg('--' + name).split(',').map(Number)) : arg('--' + name));

if (process.argv.includes('--app-bundle')) {
  const out = join(root, 'dist-native-mobile');
  await build({ root, configFile: false, base: './', publicDir: join(root, 'public'), logLevel: 'warn', build: { outDir: out, emptyOutDir: true, target: 'safari16', rollupOptions: { input: join(root, 'scripts/mobile-voice-bench/index.html') } } });
  writeFileSync(join(out, 'bench-paths.json'), JSON.stringify(paths));
  query.set('fps', '1');
  query.set('list', '/bench-paths.json');
  if (music) { copyFileSync(music, join(out, 'bench-music' + music.slice(music.lastIndexOf('.')))); query.set('music', '/bench-music' + music.slice(music.lastIndexOf('.'))); }
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><script>location.replace('scripts/mobile-voice-bench/index.html?${query}')</script>`);
  console.log(`Bench bundle for ${paths.length} voices in dist-native-mobile.`);
  process.exit(0);
}

const port = Number(arg('--port') ?? 5207);
const posted = [];
const routes = { name: 'voice-bench', configureServer(dev) {
  dev.middlewares.use('/__bench-paths', (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(paths)); });
  dev.middlewares.use('/__bench-music', (req, res) => { res.end(readFileSync(music)); });
  dev.middlewares.use('/__bench-result', (req, res) => { let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { posted.push(body); res.end('ok'); }); });
} };
const server = await createServer({ plugins: [routes], root, configFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'ga-voice-vite-')), logLevel: 'error', optimizeDeps: { entries: ['scripts/mobile-voice-bench/index.html'] }, server: { port, strictPort: true, host: true, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const page = `http://localhost:${port}/scripts/mobile-voice-bench/index.html?${query}`;

const results = [];
let started = null;
function take(line) {
  if (line.startsWith('BENCH_START ')) { started = JSON.parse(line.slice(12)); process.stderr.write(`${started.renderer}; ${paths.length} voices\n`); }
  if (line.startsWith('BENCH_ERROR')) console.log(line);
  if (line.startsWith('BENCH_ONE ')) {
    const r = JSON.parse(line.slice(10));
    results.push(r);
    if (renderDir && r.shots) for (const shot of r.shots) writeFileSync(join(renderDir, thumbnails ? `${r.path.slice(4, -3)}.jpg` : `${r.path.slice(4, -3)}@${shot.at}.jpg`), Buffer.from(shot.jpeg.split(',')[1], 'base64'));
    process.stderr.write(`  ${results.length}/${paths.length} ${r.path.slice(7, -3)} ${r.error ? 'ERROR ' + r.error.split('\n')[0].slice(0, 160) : renderDir ? 'rendered' : `${r.ms} ms, lit ${r.lit}, luma ${r.luma}${r.fps ? ', fps ' + JSON.stringify(r.fps) : ''}`}\n`);
  }
}

try {
  if (renderDir) mkdirSync(renderDir, { recursive: true });
  const simulator = arg('--ios-simulator');
  if (simulator) {
    query.set('report', '1');
    const simctl = (...args) => new Promise((done) => spawn('xcrun', ['simctl', ...args], { stdio: 'ignore' }).on('exit', done));
    await simctl('boot', simulator);
    await simctl('bootstatus', simulator, '-b');
    await simctl('openurl', simulator, `http://localhost:${port}/scripts/mobile-voice-bench/index.html?${query}`);
    const begin = Date.now();
    let seen = 0;
    while (!posted.some((l) => l === 'BENCH_DONE') && Date.now() - begin < 40 * 60_000) {
      while (seen < posted.length) take(posted[seen++]);
      await new Promise((r) => setTimeout(r, 500));
    }
    while (seen < posted.length) take(posted[seen++]);
    await simctl('terminate', simulator, 'com.apple.mobilesafari');
  } else {
    const electron = createRequire(import.meta.url)('electron');
    const mainFile = join(mkdtempSync(join(tmpdir(), 'ga-voice-electron-')), 'main.cjs');
    writeFileSync(mainFile, `
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  const win = new BrowserWindow({ show: false, width: 1280, height: 760, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (event) => {
    const text = String(event.message ?? '');
    if (text.startsWith('BENCH_')) process.stdout.write(text + '\\n');
    if (text === 'BENCH_DONE') app.quit();
  });
  win.loadURL(process.env.BENCH_URL);
});`);
    await new Promise((done, fail) => {
      const child = spawn(electron, [mainFile], { env: { ...process.env, BENCH_URL: page }, stdio: ['ignore', 'pipe', 'inherit'] });
      let buffer = '';
      child.stdout.on('data', (chunk) => { buffer += chunk; let at; while ((at = buffer.indexOf('\n')) >= 0) { take(buffer.slice(0, at)); buffer = buffer.slice(at + 1); } });
      child.on('exit', () => (results.length ? done() : fail(new Error('The bench window closed before any result.'))));
    });
  }
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify({ renderer: started?.renderer, extensions: started?.extensions, size: [w, h], music: music ?? null, results: results.map(({ shots, ...r }) => r) }, null, 1) + '\n');
  const failed = results.filter((r) => r.error);
  console.log(`${results.length - failed.length} of ${paths.length} voices ${renderDir ? 'rendered' : 'compile and draw'}.`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await server.close();
}
