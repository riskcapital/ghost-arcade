/**
 * Start the built render core, ask it for its status, and shut it down.
 *
 * Proves the binary runs on this machine. On Windows a program whose DLLs are
 * missing is stopped (0xC0000135) before it can answer, so a reply means every
 * DLL it imports was found. Starting the GPU is reported, not required:
 * hosted CI machines may have no usable graphics adapter.
 *
 * Usage: node scripts/native-core-start-check.mjs [path to ghost-render-core]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core';
const core = path.resolve(process.argv[2] || path.join(root, 'native-renderer', 'target', 'release', binary));
if (!existsSync(core)) {
  console.error(`[core-start] ${core} does not exist; build it first (npm run native:build)`);
  process.exit(2);
}

const child = spawn(core, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let exited = null;
const pending = new Map();
let buffered = '';
let stderr = '';
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
child.stdout.on('data', (chunk) => {
  buffered += chunk;
  let end;
  while ((end = buffered.indexOf('\n')) >= 0) {
    const line = buffered.slice(0, end).trim();
    buffered = buffered.slice(end + 1);
    if (!line.startsWith('{')) continue;
    try {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    } catch { /* not a reply */ }
  }
});
child.on('error', (error) => { exited = { error }; for (const settle of pending.values()) settle(null); });
child.on('exit', (code, signal) => { exited = { code, signal }; for (const settle of pending.values()) settle(null); });

let nextId = 1;
function send(method, params, timeoutMs) {
  return new Promise((resolve) => {
    if (exited) { resolve(null); return; }
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); resolve({ timedOut: true }); }, timeoutMs);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

function exitLabel() {
  if (!exited) return 'still running';
  if (exited.error) return `could not start: ${exited.error.code || exited.error.message}`;
  if (typeof exited.code === 'number') {
    const unsigned = exited.code >>> 0;
    return unsigned > 0xffff ? `exited with 0x${unsigned.toString(16).toUpperCase()}` : `exited with code ${exited.code}`;
  }
  return `stopped by ${exited.signal}`;
}

const status = await send('status', {}, 20000);
if (!status || status.timedOut || !status.ok) {
  console.error(`[core-start] FAIL: the core did not answer a status request (${status?.timedOut ? 'no reply in 20 s' : exitLabel()})`);
  if (stderr.trim()) console.error(stderr.trim());
  child.kill();
  process.exit(1);
}
console.log(`[core-start] the core runs and answers (status keys: ${Object.keys(status.result || {}).slice(0, 8).join(', ')}…)`);

const started = await send('start', { config: { width: 640, height: 360, target_fps: 30 } }, 60000);
if (started?.ok) {
  const after = await send('status', {}, 10000);
  const result = after?.result || {};
  console.log(`[core-start] the GPU started: ${result.adapter_name || result.adapter || result.backend || 'adapter not named'}`);
} else {
  console.log(`[core-start] note: the GPU did not start here (${started?.timedOut ? 'no reply in 60 s' : started?.error || exitLabel()}); fine on a machine without a graphics adapter`);
}

await send('shutdown', {}, 5000);
await new Promise((resolve) => { if (exited) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 5000).unref(); } });
if (!exited) child.kill();
console.log('[core-start] OK');
process.exit(0);
