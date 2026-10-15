// Starts a hidden copy of Ghost Arcade for a show: its own throwaway
// profile, its own ports, the dev server if none is running, and on macOS
// the window is hidden as soon as it exists so a run never takes over the
// screen.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { waitForPage, PageSession } from './cdp.mjs';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function urlUp(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}

export async function ensureDevServer(root, port, log) {
  const url = `http://localhost:${port}/`;
  if (await urlUp(url)) return { url, stop() {} };
  log(`starting dev server on ${port}`);
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: root, stdio: 'ignore', detached: process.platform !== 'win32',
  });
  for (let i = 0; i < 120 && !(await urlUp(url)); i++) await sleep(500);
  if (!(await urlUp(url))) throw new Error('dev server did not start');
  return {
    url,
    stop() {
      try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid); } catch { /* gone */ }
    },
  };
}

function hideMacProcess(pid) {
  try {
    execFileSync('osascript', ['-e', `tell application "System Events" to set visible of (first process whose unix id is ${pid}) to false`], { stdio: 'ignore' });
  } catch { /* the process may not have a window yet */ }
}

function pidForPort(port) {
  try {
    return execFileSync('pgrep', ['-f', `remote-debugging-port=${port}`]).toString().trim().split('\n')[0] || null;
  } catch { return null; }
}

export async function launchApp({ root, devUrl, cdpPort, log }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-show-'));
  const env = {
    ...process.env,
    GA_USER_DATA_DIR: profile,
    VITE_DEV_SERVER_URL: devUrl.replace(/\/$/, ''),
    WS_PORT: String(cdpPort + 1),
    HTTP_PORT: String(cdpPort + 2),
  };
  const electronBinary = require(path.join(root, 'node_modules', 'electron'));
  let child = null;
  if (process.platform === 'darwin') {
    // `open -g -j` launches without focusing or showing a new window.
    const appBundle = path.resolve(electronBinary, '..', '..', '..');
    // Any GA_* setting in the runner's environment reaches the app too
    // (e.g. GA_NATIVE_RENDER_CORE_PATH to test against another core build).
    const keys = new Set(['GA_USER_DATA_DIR', 'VITE_DEV_SERVER_URL', 'WS_PORT', 'HTTP_PORT',
      ...Object.keys(process.env).filter((k) => k.startsWith('GA_'))]);
    const envArgs = [...keys].flatMap((k) => ['--env', `${k}=${env[k]}`]);
    execFileSync('open', ['-g', '-j', '-n', ...envArgs, '-a', appBundle, '--args', root, `--remote-debugging-port=${cdpPort}`]);
  } else {
    child = spawn(electronBinary, [root, `--remote-debugging-port=${cdpPort}`, '--no-sandbox'], { env, stdio: 'ignore' });
  }
  let hidden = false;
  const page = await waitForPage(cdpPort, (t) => t.url.startsWith(devUrl.replace(/\/$/, '')) && !t.url.includes('mode='), 90000);
  if (process.platform === 'darwin') {
    for (let i = 0; i < 10 && !hidden; i++) {
      const pid = pidForPort(cdpPort);
      if (pid) { hideMacProcess(pid); hidden = true; }
      else await sleep(300);
    }
  }
  const session = await new PageSession(page).connect();
  // Wait for the app's test hook (stores) to be ready.
  for (let i = 0; i < 120; i++) {
    if (await session.eval('!!window.__ghostArcade?.vjClipLauncher').catch(() => false)) break;
    await sleep(500);
  }
  return {
    session,
    profile,
    rehide() {
      if (process.platform === 'darwin') { const pid = pidForPort(cdpPort); if (pid) hideMacProcess(pid); }
    },
    async stop() {
      session.close();
      const pid = child?.pid ?? pidForPort(cdpPort);
      if (pid) { try { process.kill(Number(pid)); } catch { /* gone */ } }
      // Wait until the app (and its debug port) is really gone, so the next
      // show can never attach to a copy that is still shutting down.
      for (let i = 0; i < 40; i++) {
        const alive = pidForPort(cdpPort) || (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(() => true).catch(() => false));
        if (!alive) break;
        if (i === 20 && pid) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ } }
        await sleep(250);
      }
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}
