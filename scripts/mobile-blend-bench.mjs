#!/usr/bin/env node
// Checks the phone's output compositor on a real GPU: every blend mode against the reference
// formula on layers and surfaces, old sets drawing byte for byte as before, and frame cost.
//   node scripts/mobile-blend-bench.mjs                         hidden Electron window (Chromium)
//   node scripts/mobile-blend-bench.mjs --ios-simulator <udid>  Safari on an iOS simulator: the phone's WebKit
//   --base <commit>   the compositor to compare with (default: the last commit before blend modes)
//   --notiming        pixel checks only
//   --frames <n> --rounds <n>   frames per timing round (60) and rounds (5, alternating before and now)
//   --port <n>        dev server port (5197)
// Exits 1 when a pixel check fails or an old set draws differently.
import { createServer } from 'vite';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const base = arg('--base') ?? '620c87ee';
const baseSource = execFileSync('git', ['show', `${base}:src/lib/mobile/studio/compositor.ts`], { cwd: root, encoding: 'utf8' });
// Served beside the real compositor so its own imports resolve the same way.
const baseId = join(root, 'src/lib/mobile/studio/compositor.before-blends.ts');
const port = Number(arg('--port') ?? 5197);
const posted = [];
const run = Math.random().toString(36).slice(2, 10);
const plugin = {
  name: 'blend-bench',
  resolveId: (id) => (id === 'virtual:base-compositor' ? baseId : null),
  load: (id) => (id === baseId ? baseSource : null),
  configureServer(dev) {
    dev.middlewares.use('/__bench-result', (req, res) => { let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { if (body.startsWith(run + ' ')) posted.push(body.slice(run.length + 1)); res.end('ok'); }); });
  },
};
const server = await createServer({ plugins: [plugin], root, configFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'ga-blend-vite-')), logLevel: 'error', optimizeDeps: { entries: ['scripts/mobile-blend-bench/index.html'], esbuildOptions: { plugins: [{ name: 'base-compositor', setup: (build) => build.onResolve({ filter: /^virtual:base-compositor$/ }, (a) => ({ path: a.path, external: true })) }] } }, server: { port, strictPort: true } });
await server.listen();
const query = ['report=1', `run=${run}`, process.argv.includes('--notiming') ? 'notiming=1' : '', arg('--frames') ? `frames=${arg('--frames')}` : '', arg('--rounds') ? `rounds=${arg('--rounds')}` : ''].filter(Boolean).join('&');
const url = `http://localhost:${port}/scripts/mobile-blend-bench/index.html?${query}`;

function summarise(result) {
  let failed = false;
  if (result.error) { console.log('ERROR ' + result.error); failed = true; }
  const c = result.compile;
  if (c) console.log(`Full blend shader (frames at 540p, after two plain frames; plain ${c.plainFrameMs} ms, with Overlay ${c.blendFrameMs} ms): background compile ${c.parallelCompile ? 'available' : 'not available'}; prepareBlends blocks ${c.prepareBlocksMs} ms, ready after ${c.backgroundReadyMs} ms; first Overlay frame after it ${c.firstBlendFrameAfterPrepareMs} ms; first Overlay frame without it ${c.firstBlendFrameColdMs} ms.`);
  const p = result.pixels;
  if (p) {
    console.log(`Pixel checks: ${p.checks - p.failures.length} of ${p.checks} within 2/255 of the reference.`);
    console.log('Largest difference per mode (of 255): ' + Object.entries(p.worst).map(([m, d]) => `${m} ${d}`).join(', '));
    for (const f of p.failures) console.log('  FAIL ' + f);
    if (p.failures.length) failed = true;
  }
  for (const s of result.sameAsBefore ?? []) {
    console.log(`${s.differing ? 'CHANGED' : 'Same as before'}: ${s.name}${s.differing ? ` (${s.differing} bytes, up to ${s.maxDiff})` : ''}`);
    if (s.differing) failed = true;
  }
  for (const [name, t] of Object.entries(result.timing ?? {}))
    console.log(`ms per 1080p frame, ${name}: ${t.before !== undefined ? `before ${t.before}, ` : ''}now ${t.after}`);
  return failed;
}

const simulator = arg('--ios-simulator');
try {
  if (simulator) {
    const simctl = (...args) => new Promise((done) => spawn('xcrun', ['simctl', ...args], { stdio: 'ignore' }).on('exit', done));
    await simctl('boot', simulator);
    await simctl('bootstatus', simulator, '-b');
    await simctl('openurl', simulator, url);
    const started = Date.now();
    while (!posted.some((l) => l.startsWith('BENCH_DONE')) && Date.now() - started < 10 * 60_000) await new Promise((r) => setTimeout(r, 500));
    for (const line of posted.filter((l) => l.startsWith('BENCH_START') || l.startsWith('BENCH_ERROR'))) console.log(line);
    const done = posted.find((l) => l.startsWith('BENCH_DONE'));
    if (!done) throw new Error('Safari did not finish the bench.');
    process.exitCode = summarise(JSON.parse(done.slice(11))) ? 1 : 0;
    await simctl('terminate', simulator, 'com.apple.mobilesafari');
  } else {
    const electron = createRequire(import.meta.url)('electron');
    const mainFile = join(mkdtempSync(join(tmpdir(), 'ga-blend-electron-')), 'main.cjs');
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
    const result = await new Promise((done, fail) => {
      const child = spawn(electron, [mainFile], { env: { ...process.env, BENCH_URL: url.replace('report=1', 'local=1') }, stdio: ['ignore', 'pipe', 'inherit'] });
      let buffer = '', last = null;
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          if (line.startsWith('BENCH_START') || line.startsWith('BENCH_ERROR')) console.log(line);
          if (line.startsWith('BENCH_DONE ')) last = JSON.parse(line.slice(11));
        }
      });
      child.on('exit', () => (last ? done(last) : fail(new Error('The bench window closed before finishing.'))));
    });
    process.exitCode = summarise(result) ? 1 : 0;
  }
} finally {
  await server.close();
}
process.exit();
