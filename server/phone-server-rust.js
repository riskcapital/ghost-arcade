/**
 * The phone remote server as a separate process (phone-server/, Rust), with
 * the same interface as server/ws-server.js: import it and it starts, then
 * `listening`, `setPairingToken`, `setDesktopCredential`, `shutdownServer`.
 *
 * The wire protocol and every check are the same as ws-server.js; what
 * changes is where the work happens. Parsing, routing and relaying phone
 * traffic (light painting at 120 Hz, multi-megabyte scan and calibration
 * chunks) no longer runs on the editor's main thread, and a fault in it
 * cannot take the main process down.
 *
 * Opt-in for now (GA_RUST_PHONE_SERVER=1, see electron/main.js). The token
 * and the desktop credential go to the child on stdin, never in its
 * environment or arguments.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isPackaged = __dirname.includes('app.asar');
const BIN = process.platform === 'win32' ? 'ghost-phone-server.exe' : 'ghost-phone-server';

/** Where the server binary is, or null. */
export function findPhoneServerBinary(env = process.env) {
  if (env.GA_PHONE_SERVER_BIN) return fs.existsSync(env.GA_PHONE_SERVER_BIN) ? env.GA_PHONE_SERVER_BIN : null;
  const root = path.join(__dirname, '..');
  const candidates = [
    path.join(root, 'phone-server', 'target', 'release', BIN),
    path.join(root, 'phone-server', 'target', 'debug', BIN),
  ];
  if (isPackaged && process.resourcesPath) candidates.unshift(path.join(process.resourcesPath, 'phone-server', BIN));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const binary = findPhoneServerBinary();
let child = null;
let nextCommandId = 1;
const pendingAcks = new Map();
let shuttingDown = false;

function settleAcks() {
  for (const resolve of pendingAcks.values()) resolve();
  pendingAcks.clear();
}

/** Resolves when the child has applied it, so a caller can wait for a reset to take. */
function command(cmd, value) {
  if (!child || child.exitCode !== null || !child.stdin?.writable) return Promise.resolve();
  const id = nextCommandId++;
  return new Promise((resolve) => {
    pendingAcks.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ id, cmd, value })}\n`);
  });
}

let resolveExited;
/** Settles with the exit code when the child goes away, for whatever reason. */
export const exited = new Promise((resolve) => { resolveExited = resolve; });

export const listening = new Promise((resolve, reject) => {
  if (!binary) {
    reject(new Error('The phone server binary was not found (npm run phone-server:build)'));
    resolveExited(null);
    return;
  }
  const env = { ...process.env };
  // Secrets travel on stdin only.
  delete env.GA_PAIRING_TOKEN;
  delete env.GA_DESKTOP_CREDENTIAL;
  Object.assign(env, {
    WS_PORT: process.env.WS_PORT || '',
    HTTP_PORT: process.env.HTTP_PORT || '',
    GA_REMOTE_BIND_HOST: process.env.GA_REMOTE_BIND_HOST || '',
    GA_PHONE_DIST_DIR: path.join(__dirname, '..', 'dist'),
    GA_PHONE_PUBLIC_DIR: path.join(__dirname, '..', 'public'),
    GA_PHONE_SHADERS_DIR: isPackaged ? path.join(__dirname, '..', '..', 'user-shaders') : path.join(__dirname, '..', 'user-shaders'),
  });
  let ready = false;
  const timeout = setTimeout(() => fail(new Error('Phone server startup timed out')), 10000);
  timeout.unref?.();
  function fail(err) {
    if (ready) return;
    ready = true;
    clearTimeout(timeout);
    try { child?.kill(); } catch {}
    reject(err);
  }
  try {
    child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true, shell: false });
  } catch (err) {
    fail(err);
    resolveExited(null);
    return;
  }
  child.on('error', (err) => fail(err));
  child.on('exit', (code, signal) => {
    settleAcks();
    if (!shuttingDown) console.warn(`[PhoneServer] exited (${signal || code})`);
    fail(new Error(`Phone server exited before listening (${signal || code})`));
    resolveExited(code);
  });
  child.stdin.on('error', () => {});
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    out += chunk;
    let nl;
    while ((nl = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, nl);
      out = out.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.event === 'ready' && !ready) {
        ready = true;
        clearTimeout(timeout);
        resolve({ wsPort: msg.wsPort, httpPort: msg.httpPort });
      } else if (msg.event === 'ack') {
        const done = pendingAcks.get(msg.id);
        pendingAcks.delete(msg.id);
        done?.();
      } else if (msg.event === 'error') {
        console.error(`[PhoneServer] ${msg.what} server could not listen: ${msg.message}`);
        fail(Object.assign(new Error(msg.message), { code: msg.code }));
      }
    }
  });
  let err = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    err += chunk;
    let nl;
    while ((nl = err.indexOf('\n')) >= 0) {
      const line = err.slice(0, nl);
      err = err.slice(nl + 1);
      if (line.startsWith('[!]')) console.warn(`[PhoneServer] ${line}`);
      else console.log(`[PhoneServer] ${line}`);
    }
  });
  // Standalone use, as ws-server.js reads them.
  if (process.env.GA_PAIRING_TOKEN) command('token', process.env.GA_PAIRING_TOKEN);
  if (process.env.GA_DESKTOP_CREDENTIAL) command('credential', process.env.GA_DESKTOP_CREDENTIAL);
});
listening.catch(() => {});

/** Same as ws-server.js; resolves once every connection made with the old token is being closed. */
export function setPairingToken(token) {
  return command('token', typeof token === 'string' ? token : '');
}

export function setDesktopCredential(value) {
  return command('credential', value ?? null);
}

export function shutdownServer({ force = false } = {}) {
  if (!child || shuttingDown) return;
  shuttingDown = true;
  const proc = child;
  if (force || proc.exitCode !== null) {
    try { proc.kill(); } catch {}
    return;
  }
  try { proc.stdin.end(`${JSON.stringify({ cmd: 'shutdown' })}\n`); } catch {}
  const kill = setTimeout(() => { try { proc.kill(); } catch {} }, 2000);
  kill.unref?.();
}
