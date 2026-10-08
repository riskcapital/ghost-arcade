#!/usr/bin/env node
// End-to-end smoke run of the real desktop app, written for the Linux CI job
// (.github/workflows/linux-verify.yml) and runnable on any platform.
//
// It launches the app with a remote debugging port, drives it with real CDP
// mouse and keyboard input, and judges every step by numbers: core snapshots,
// screenshots decoded to pixel values, ffprobe frame counts, process lists.
// Screenshots, logs and report.json land in --out.
//
//   node scripts/linux-smoke.mjs --dev-url http://localhost:1420 --out linux-smoke-out
//   node scripts/linux-smoke.mjs --exec ./Ghost-Arcade.AppImage --exec-arg --appimage-extract-and-run --only a,b,h
//   node scripts/linux-smoke.mjs --attach --port 9234 --only c,d     (app already running)
//
// Steps: a handshake, b editor composite, c Screen, d calibration, e Interactive,
// f recording, g VJ mode, g2 clip with sound, h Output Window / fullscreen / quit.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, waitForTarget, sleep } from './linux-smoke-cdp.mjs';
import { stepHandshake, stepComposite } from './linux-smoke-steps.mjs';
import { stepScreen, stepCalibration } from './linux-smoke-screens.mjs';
import { stepInteractive } from './linux-smoke-live.mjs';
import { stepRecording, stepVj } from './linux-smoke-show.mjs';
import { stepClipAudio, stepOutputAndQuit } from './linux-smoke-output.mjs';

const STEPS = [stepHandshake, stepComposite, stepScreen, stepCalibration, stepInteractive, stepRecording, stepVj, stepClipAudio, stepOutputAndQuit];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = { port: 9333, out: 'linux-smoke-out', only: null, execArgs: [], attach: false, keepOpen: false, devUrl: '', exec: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i];
    if (a === '--port') args.port = Number(value());
    else if (a === '--out') args.out = value();
    else if (a === '--only') args.only = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dev-url') args.devUrl = value();
    else if (a === '--exec') args.exec = value();
    else if (a === '--exec-arg') args.execArgs.push(value());
    else if (a === '--attach') args.attach = true;
    else if (a === '--keep-open') args.keepOpen = true;
    else if (a === '--profile') args.profile = value();
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, 'smoke.log');
const log = (...parts) => {
  const line = `[smoke ${new Date().toISOString().slice(11, 23)}] ${parts.join(' ')}`;
  console.log(line);
  fs.appendFileSync(logFile, `${line}\n`);
};

/** Every process below `rootPid`, from one `ps` listing. */
function descendants(rootPid) {
  let listing = '';
  try { listing = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch { return []; }
  const rows = listing.split('\n').map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
  const found = [];
  const queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of rows) {
      if (row.ppid === parent && !found.some((f) => f.pid === row.pid)) { found.push(row); queue.push(row.pid); }
    }
  }
  return found;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

let app = null;
let appLog = null;
function launch() {
  const profile = path.resolve(args.profile || path.join(outDir, 'profile'));
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const packaged = !!args.exec;
  const command = packaged ? path.resolve(args.exec) : require('electron');
  const commandArgs = [
    ...args.execArgs, ...(packaged ? [] : [root]),
    `--remote-debugging-port=${args.port}`,
    // Packaged builds ignore GA_USER_DATA_DIR; Chromium's own switch moves the profile there.
    ...(packaged ? [`--user-data-dir=${profile}`] : []),
  ];
  const env = { ...process.env, GA_USER_DATA_DIR: profile, ELECTRON_ENABLE_LOGGING: '1' };
  if (args.devUrl) env.VITE_DEV_SERVER_URL = args.devUrl;
  appLog = fs.createWriteStream(path.join(outDir, 'app.log'));
  log(`launching ${command} ${commandArgs.join(' ')}`);
  app = spawn(command, commandArgs, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.pipe(appLog, { end: false });
  app.stderr.pipe(appLog, { end: false });
  app.exited = new Promise((resolve) => app.on('exit', (code, signal) => { app.exitInfo = { code, signal }; resolve(app.exitInfo); }));
  return app;
}

const results = [];
const context = {
  args, outDir, root, log, sleep,
  isLinux: process.platform === 'linux',
  packaged: !!args.exec,
  shared: {},
  appLogText: () => { try { return fs.readFileSync(path.join(outDir, 'app.log'), 'utf8'); } catch { return ''; } },
  descendants: () => (app ? descendants(app.pid) : []),
  alive,
  app: () => app,
  connectTo: async (match, timeoutMs = 30000) => connect(await waitForTarget(args.port, match, timeoutMs)),
};

async function runStep(step, c) {
  const record = { id: step.id, title: step.title, status: 'pass', checks: [], numbers: {}, notes: [] };
  const started = Date.now();
  const api = {
    ...context, c,
    /** Record one assertion. A failed check fails the step but the step goes on. */
    check(label, ok, detail = '') {
      record.checks.push({ label, ok: !!ok, detail: String(detail) });
      if (!ok) record.status = 'fail';
      log(`  ${ok ? 'PASS' : 'FAIL'} ${step.id}: ${label}${detail ? ` — ${detail}` : ''}`);
      return !!ok;
    },
    number(name, value) { record.numbers[name] = value; },
    note(text) { record.notes.push(text); log(`  note ${step.id}: ${text}`); },
    /** Not testable here: says why, and counts as neither pass nor fail. */
    skip(reason) { record.checks.push({ label: `skipped: ${reason}`, ok: true, skipped: true, detail: '' }); log(`  SKIP ${step.id}: ${reason}`); },
    shot: async (name) => { try { return await c.screenshot(path.join(outDir, `${name}.png`)); } catch (error) { log(`  screenshot ${name} failed: ${error.message}`); return null; } },
  };
  log(`step ${step.id}: ${step.title}`);
  try {
    await step.run(api);
  } catch (error) {
    record.status = 'fail';
    record.error = String(error?.stack || error).slice(0, 1500);
    log(`  ERROR ${step.id}: ${record.error.split('\n')[0]}`);
    await api.shot(`${step.id}-error`);
  }
  if (record.status === 'pass' && record.checks.length > 0 && record.checks.every((check) => check.skipped)) record.status = 'skip';
  record.durationMs = Date.now() - started;
  results.push(record);
  return record;
}

function writeReport() {
  const report = { platform: process.platform, arch: process.arch, packaged: context.packaged, when: new Date().toISOString(), steps: results };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const lines = ['| Step | Result | Numbers |', '| --- | --- | --- |'];
  for (const r of results) {
    const numbers = Object.entries(r.numbers).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
    const failed = r.checks.filter((check) => !check.ok).map((check) => `FAILED: ${check.label} ${check.detail}`).join('; ');
    lines.push(`| ${r.id} ${r.title} | ${r.status.toUpperCase()} | ${[failed, r.error ? `error: ${r.error.split('\n')[0]}` : '', numbers].filter(Boolean).join(' · ').replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`);
  return report;
}

async function main() {
  const wanted = STEPS.filter((step) => !args.only || args.only.includes(step.id));
  if (!args.attach) launch();
  const match = (t) => !/[?&]mode=/.test(String(t.url)) && (args.devUrl ? String(t.url).startsWith(args.devUrl) : /index\.html/.test(String(t.url)) || /^https?:\/\/localhost/.test(String(t.url)));
  let c;
  try {
    c = await connect(await waitForTarget(args.port, match, 120000));
  } catch (error) {
    results.push({ id: 'a', title: 'App window loads', status: 'fail', checks: [], numbers: {}, notes: [], error: String(error.message) });
    log(`could not reach the app window: ${error.message}`);
  }
  if (c) {
    for (const step of wanted) await runStep(step, c);
    fs.writeFileSync(path.join(outDir, 'renderer-console.log'), c.consoleLines.join('\n'));
    c.close();
  }
  if (app && !args.keepOpen && !app.exitInfo) {
    log('app still running after the steps; stopping it');
    app.kill('SIGTERM');
    await Promise.race([app.exited, sleep(8000)]);
    if (!app.exitInfo) app.kill('SIGKILL');
  }
  appLog?.end();
  const report = writeReport();
  const failed = report.steps.filter((step) => step.status === 'fail');
  log(`done: ${report.steps.length - failed.length}/${report.steps.length} steps passed${failed.length ? `; failed: ${failed.map((s) => s.id).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { log(`fatal: ${error?.stack || error}`); try { writeReport(); } catch { /* nothing to write */ } process.exit(2); });
