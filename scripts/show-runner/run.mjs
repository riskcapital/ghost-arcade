#!/usr/bin/env node
// Show Runner: plays a scripted show in a hidden copy of Ghost Arcade,
// checks what the render core actually outputs, records it, and writes a
// report.
//
//   npm run show -- [shows...] [--record] [--update-goldens]
//        [--out DIR] [--port 9480] [--dev-port 1420] [--keep-open]
//
// Shows are tests/shows/*.show.json (all of them when none are named; a
// bare name like `03-vj-reorder` works too). A show is
//   { "name", "description", "steps": [ step, ... ] }
// and each step may have
//   "do":     an action (see ACTION_NAMES in steps.mjs) plus its fields,
//   "wait":   seconds to wait after the action,
//   "expect": { checkName: spec, ... } (see CHECK_NAMES in steps.mjs),
//   "label":  how the step reads in the report.
// Clips named like "red.mp4", "white.mov" (HAP) or "bars.mp4" are generated
// on first use into ~/.ghost-arcade/show-runner/fixtures. Golden frames live
// in ~/.ghost-arcade/show-runner/goldens/<show>/ (a missing one is recorded;
// --update-goldens re-records them) and reports in .../reports/<time>/.
// Any GA_* variable set for the runner reaches the app, e.g.
// GA_NATIVE_RENDER_CORE_PATH to run the shows against another core build.
// Exit code: 0 all passed, 1 a show failed, 2 the runner itself failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { ensureDevServer, launchApp } from './app.mjs';
import { PageSession, waitForPage } from './cdp.mjs';
import { PAGE_HELPERS, runAction, runCheck } from './steps.mjs';
import { writeReport } from './report.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const opts = { shows: [], record: false, update: false, port: 9480, devPort: 1420, keepOpen: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--record') opts.record = true;
    else if (a === '--update-goldens') opts.update = true;
    else if (a === '--keep-open') opts.keepOpen = true;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--dev-port') opts.devPort = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else opts.shows.push(a);
  }
  if (!opts.shows.length) opts.shows.push(path.join(root, 'tests', 'shows'));
  return opts;
}

function resolveShows(inputs) {
  const files = [];
  for (const input of inputs) {
    const p = path.resolve(input);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) if (f.endsWith('.show.json')) files.push(path.join(p, f));
    } else if (fs.existsSync(p)) files.push(p);
    else {
      const named = path.join(root, 'tests', 'shows', `${input}.show.json`);
      if (fs.existsSync(named)) files.push(named);
      else throw new Error(`no show ${input}`);
    }
  }
  return files;
}

function stateDir(...parts) {
  const dir = path.join(os.homedir(), '.ghost-arcade', 'show-runner', ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function gitInfo() {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }).toString().trim().length > 0;
    return { commit, branch, dirty };
  } catch { return { commit: 'unknown', branch: 'unknown', dirty: false }; }
}

/** Raw RGBA of the core's output at a small size, for golden compares. */
async function outputPixels(session) {
  const snap = await session.eval(`window.electronAPI.invoke('native_renderer_get_frame_snapshot', { include_pixels: true, max_dim: 192 })`);
  if (!snap?.rgba_b64) throw new Error('no output frame to compare');
  const bytes = Buffer.from(snap.rgba_b64, 'base64');
  const { width, height } = snap;
  const stride = snap.bytes_per_row || width * 4;
  const bgra = /bgra/i.test(String(snap.format ?? ''));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * 4; const d = (y * width + x) * 4;
      rgba[d] = bytes[bgra ? s + 2 : s]; rgba[d + 1] = bytes[s + 1]; rgba[d + 2] = bytes[bgra ? s : s + 2]; rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function writePng(file, { width, height, rgba }) {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  fs.writeFileSync(file, PNG.sync.write(png));
}

function readPng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, rgba: png.data };
}

async function runShow(file, opts, app, reportDir) {
  const show = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = path.basename(file).replace(/\.show\.json$/, '');
  const showDir = path.join(reportDir, id);
  fs.mkdirSync(showDir, { recursive: true });
  const goldenDir = stateDir('goldens', id);
  const session = app.session;
  await session.eval(PAGE_HELPERS);

  const result = { id, name: show.name ?? id, description: show.description ?? '', steps: [], perf: [], images: [], video: null, pass: true };
  const ctx = {
    session, vars: {}, perf: result.perf, startedAt: Date.now(), stepLabel: '', mapsim: null,
    eval: (js, t) => session.eval(js, t),
    async openPage(match) {
      const port = opts.port;
      const target = await waitForPage(port, match, 30000);
      app.rehide();
      const page = await new PageSession(target).connect();
      return page;
    },
    async measurePerf(seconds) {
      return session.eval(`(async () => {
        const a = await window.electronAPI.invoke('native_renderer_get_status');
        const t0 = performance.now(); let frames = 0;
        await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 < ${seconds * 1000}) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
        const b = await window.electronAPI.invoke('native_renderer_get_status');
        const secs = (performance.now() - t0) / 1000;
        const title = document.querySelector('.fps-counter')?.title ?? '';
        const gpu = title.match(/GPU average: ([0-9.]+) ms/);
        return { coreFps: Math.round((b.frames_presented - a.frames_presented) / secs), editorFps: Math.round(frames / secs), gpuMs: gpu ? Number(gpu[1]) : null };
      })()`, (seconds + 10) * 1000);
    },
    async compareGolden(name, maxDiff) {
      const current = await outputPixels(session);
      const goldenFile = path.join(goldenDir, `${name}.png`);
      const currentFile = path.join(showDir, `${name}.png`);
      writePng(currentFile, current);
      const image = { name, current: path.relative(reportDir, currentFile) };
      result.images.push(image);
      if (opts.update || !fs.existsSync(goldenFile)) {
        writePng(goldenFile, current);
        image.note = opts.update ? 'golden updated' : 'new golden recorded';
        return { pass: true, detail: image.note };
      }
      const golden = readPng(goldenFile);
      fs.copyFileSync(goldenFile, path.join(showDir, `${name}.golden.png`));
      image.golden = `${id}/${name}.golden.png`;
      if (golden.width !== current.width || golden.height !== current.height) {
        return { pass: false, detail: `size changed: ${golden.width}x${golden.height} -> ${current.width}x${current.height}` };
      }
      const diff = { width: current.width, height: current.height, rgba: Buffer.alloc(current.rgba.length) };
      let total = 0;
      for (let i = 0; i < current.rgba.length; i += 4) {
        const d = (Math.abs(current.rgba[i] - golden.rgba[i]) + Math.abs(current.rgba[i + 1] - golden.rgba[i + 1]) + Math.abs(current.rgba[i + 2] - golden.rgba[i + 2])) / 3;
        total += d;
        const v = Math.min(255, d * 4);
        diff.rgba[i] = v; diff.rgba[i + 1] = v * 0.3; diff.rgba[i + 2] = v * 0.3; diff.rgba[i + 3] = 255;
      }
      const meanDiff = total / (current.rgba.length / 4) / 255;
      writePng(path.join(showDir, `${name}.diff.png`), diff);
      image.diff = `${id}/${name}.diff.png`;
      image.meanDiff = meanDiff;
      return { pass: meanDiff <= maxDiff, detail: `difference ${(meanDiff * 100).toFixed(2)}% (limit ${(maxDiff * 100).toFixed(1)}%)` };
    },
  };

  // Recorder: the core's own output, sampled as JPEG while the show runs.
  let recording = false;
  const frameDir = path.join(showDir, 'frames');
  let frameCount = 0;
  const recordLoop = async () => {
    fs.mkdirSync(frameDir, { recursive: true });
    while (recording) {
      const t = Date.now();
      try {
        const snap = await session.eval(`window.electronAPI.invoke('native_renderer_get_frame_snapshot', { include_pixels: true, max_dim: 960, live_output: true, encoding: 'jpeg', quality: 80 })`);
        if (snap?.jpeg_b64) fs.writeFileSync(path.join(frameDir, `f${String(frameCount++).padStart(5, '0')}.jpg`), Buffer.from(snap.jpeg_b64, 'base64'));
      } catch { /* frame skipped */ }
      await sleep(Math.max(0, 100 - (Date.now() - t)));
    }
  };
  let recorder = null;
  if (opts.record) { recording = true; recorder = recordLoop(); }

  const t0 = Date.now();
  for (const [index, step] of (show.steps ?? []).entries()) {
    const label = step.label ?? step.do ?? Object.keys(step.expect ?? {}).join(', ');
    ctx.stepLabel = label;
    const entry = { index: index + 1, label, action: step.do ?? null, at: ((Date.now() - t0) / 1000).toFixed(1), checks: [], error: null };
    try {
      if (step.do) await runAction(ctx, step);
      if (step.wait) await sleep(step.wait * 1000);
      for (const [name, spec] of Object.entries(step.expect ?? {})) {
        const r = await runCheck(ctx, name, spec);
        entry.checks.push({ name, ...r });
        if (!r.pass) result.pass = false;
      }
    } catch (err) {
      entry.error = err.message;
      result.pass = false;
    }
    result.steps.push(entry);
    const failed = entry.error || entry.checks.some((c) => !c.pass);
    console.log(`  ${failed ? '✗' : '✓'} ${entry.index}. ${label}${entry.error ? ` — ${entry.error}` : ''}${entry.checks.filter((c) => !c.pass).map((c) => ` — ${c.name}: ${c.detail}`).join('')}`);
    if (entry.error && show.stopOnError !== false) break;
  }
  await ctx.mapsim?.eval('window.close()').catch(() => {});

  if (recorder) {
    recording = false;
    await recorder;
    if (frameCount > 1) {
      const ffmpeg = process.env.GA_FFMPEG_PATH || require('ffmpeg-static');
      const video = path.join(showDir, `${id}.mp4`);
      try {
        execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(frameDir, 'f%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', video]);
        result.video = `${id}/${id}.mp4`;
      } catch (err) { console.warn('  recording failed:', err.message); }
    }
    fs.rmSync(frameDir, { recursive: true, force: true });
  }
  result.seconds = ((Date.now() - t0) / 1000).toFixed(1);
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const shows = resolveShows(opts.shows);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportDir = opts.out ? path.resolve(opts.out) : stateDir('reports', stamp);
  fs.mkdirSync(reportDir, { recursive: true });
  const log = (m) => console.log(`[show-runner] ${m}`);
  log(`${shows.length} show(s); report in ${reportDir}`);

  const dev = await ensureDevServer(root, opts.devPort, log);
  const results = [];
  let machine = {};
  try {
    for (const [index, file] of shows.entries()) {
      log(`▶ ${path.basename(file)}`);
      // Each show gets a fresh app, profile and set of ports, so shows never
      // leak state or talk to the previous show's app.
      const showOpts = { ...opts, port: opts.port + (index % 20) * 4 };
      const app = await launchApp({ root, devUrl: dev.url, cdpPort: showOpts.port, log });
      try {
        if (!machine.adapter) {
          const st = await app.session.eval(`window.electronAPI.invoke('native_renderer_get_status')`).catch(() => null);
          machine = { adapter: st?.adapter_name ?? 'unknown', backend: st?.backend ?? 'unknown', platform: `${process.platform} ${os.release()}`, cpu: os.cpus()[0]?.model ?? '' };
        }
        results.push(await runShow(file, showOpts, app, reportDir));
      } catch (err) {
        results.push({ id: path.basename(file), name: path.basename(file), pass: false, steps: [], perf: [], images: [], error: err.message });
        console.error(`  show failed: ${err.message}`);
      } finally {
        if (!opts.keepOpen) await app.stop();
      }
    }
  } finally {
    dev.stop();
  }

  const command = `node scripts/show-runner/run.mjs ${process.argv.slice(2).join(' ')}`.trim();
  const reportFile = writeReport(reportDir, { results, machine, git: gitInfo(), command, when: new Date().toISOString() });
  const failed = results.filter((r) => !r.pass);
  log(`${results.length - failed.length}/${results.length} shows passed`);
  log(`report: ${reportFile}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
