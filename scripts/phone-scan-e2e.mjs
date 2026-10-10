/**
 * Phone scan, end to end against a RUNNING desktop dev app and its real
 * pairing server: a scripted phone (the same sendScan the app uses) sends a
 * real PLY from the phone's scan pipeline, the desktop prompt is answered with
 * real mouse input over CDP, and the result is checked on disk, in the Media
 * Library, as a Point Cloud layer and in the native output.
 *
 *   node scripts/phone-scan-e2e.mjs --profile <GA_USER_DATA_DIR> --ply <room.ply> \
 *        [--ws-port 19411] [--cdp 9284] [--url localhost:1474] [--out <dir>]
 *
 * Start the app first:
 *   GA_USER_DATA_DIR=<profile> VITE_DEV_SERVER_URL=http://localhost:<vite> WS_PORT=19411 HTTP_PORT=19412 \
 *     GA_REMOTE_BIND_HOST=127.0.0.1 npx electron . --remote-debugging-port=9284
 * Use a new, empty profile folder for each run: the script expects the welcome card or an empty project.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const profile = path.resolve(arg('profile', ''));
const plyPath = path.resolve(arg('ply', ''));
const wsPort = Number(arg('ws-port', '19411'));
const cdpPort = Number(arg('cdp', '9284'));
const pageMatch = arg('url', 'localhost:1474');
const outDir = path.resolve(arg('out', path.join(root, 'reports', 'phone-scan-e2e')));
if (!existsSync(path.join(profile, 'remote-pairing.json')) || !existsSync(plyPath)) {
  console.error('usage: node scripts/phone-scan-e2e.mjs --profile <running app profile> --ply <scan.ply>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const token = JSON.parse(readFileSync(path.join(profile, 'remote-pairing.json'), 'utf8')).token;
const scanDir = path.join(profile, 'project-assets', 'Phone Scans');
const ply = new Uint8Array(readFileSync(plyPath));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

/* ── CDP: read the page, and click with real mouse events ─────────────── */
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const target = targets.find((t) => t.type === 'page' && (t.url || '').includes(pageMatch));
if (!target) { console.error('desktop page not found on CDP port', cdpPort); process.exit(2); }
const cdp = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((res, rej) => { cdp.on('open', res); cdp.on('error', rej); });
let cdpId = 0;
const cdpWaiting = new Map();
cdp.on('message', (data) => { const m = JSON.parse(data.toString()); const w = cdpWaiting.get(m.id); if (w) { cdpWaiting.delete(m.id); w(m); } });
const cdpSend = (method, params = {}) => new Promise((resolve) => { const id = ++cdpId; cdpWaiting.set(id, resolve); cdp.send(JSON.stringify({ id, method, params })); });
async function page(expression) {
  const reply = await cdpSend('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || 'page evaluation failed');
  return reply.result?.result?.value;
}
async function waitFor(expression, ms = 15000, label = expression) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await page(expression);
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await delay(100);
  }
}
/** A real click in the middle of the first visible element matching the selector. */
async function click(selector, text = '') {
  const box = await waitFor(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getClientRects().length && (!${JSON.stringify(text)} || (e.innerText || '').trim().includes(${JSON.stringify(text)}))); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y); return { x, y, hit: !!top && (top === el || el.contains(top) || top.contains(el)) }; })()`, 15000, selector);
  if (!box.hit) throw new Error(`${selector} is covered by another element`);
  await cdpSend('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await cdpSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdpSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}

// Needs a freshly started app: an empty project and "Always accept" still off.
await waitFor(`!!(window.__ghostArcade && window.electronAPI)`, 30000, 'editor to load');
const fresh = await page(`(() => { let p; window.__ghostArcade.project.subscribe((v) => { p = v; })(); return p.layers.length === 0 && localStorage.getItem('ghost-arcade_auto_accept_phone_scans') !== '1'; })()`);
if (!fresh) { console.error('Start the app again on a new profile folder first: this run needs an empty project and "Always accept" off.'); process.exit(2); }
// A new profile opens on the welcome card: close it the way a person would.
if (await page(`!!document.querySelector('.welcome-overlay')`)) { await click('.welcome-overlay button', 'Get started'); await delay(500); }

/* ── The scripted phone ───────────────────────────────────────────────── */
const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', cacheDir: path.join(outDir, '.vite-cache') });
const scan = await vite.ssrLoadModule('/src/lib/mobile/studio/scanTransfer.ts');
function phone(query = `?pair=${token}`) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/${query}`, { maxPayload: 64 * 1024 * 1024 });
    ws.once('open', () => resolve({ ws }));
    ws.once('error', (err) => resolve({ status: Number(/Unexpected server response: (\d+)/.exec(err.message)?.[1] ?? -1) }));
  });
}
/** Let a test rewrite what the phone puts on the wire (a modified or faulty phone). */
function tamper(ws, rewrite) {
  const raw = ws.send.bind(ws);
  ws.send = (data) => { const out = rewrite(JSON.parse(data)); if (out) raw(JSON.stringify(out)); };
}
const filesNow = () => (existsSync(scanDir) ? readdirSync(scanDir).sort() : []);
const state = { root, profile, scanDir, ply, plyName: path.basename(plyPath), sha, delay, check, page, waitFor, click, phone, tamper, filesNow, scan, outDir, cdpSend };

try {
  const steps = await import('./phone-scan-e2e-steps.mjs');
  await steps.transferChecks(state);
  await steps.layerChecks(state);
  await steps.libraryChecks(state);
  await steps.faultChecks(state);
} catch (error) {
  check('run completed', false, error?.stack || error);
} finally {
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), failures, results }, null, 2));
  await vite.close().catch(() => {});
  cdp.close();
}
console.log(failures ? `FAILED (${failures})` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
