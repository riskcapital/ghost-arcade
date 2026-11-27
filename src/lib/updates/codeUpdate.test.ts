/**
 * Signed app-code updates in the main process (electron/updates/code-update.cjs):
 * the manifest signature, the shell check, the boot/rollback state machine,
 * and download → verify → unpack → boot against a local stand-in for the
 * release server.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const require = createRequire(import.meta.url);
const cu = require('../../../electron/updates/code-update.cjs');
const { trustedCodeUpdateKeys } = require('../../../electron/updates/keys.cjs');

const SHELL = 'sh1-test-shell';

function keyPair(): { privateKey: KeyObject; publicHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return { privateKey, publicHex: der.subarray(der.length - 32).toString('hex') };
}
const pair = keyPair();
const KEYS = { 'code-test': pair.publicHex };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

type Files = Record<string, string>;
function envelopeFor(payload: object, privateKey = pair.privateKey, kid = 'code-test') {
  const text = JSON.stringify({ v: 1, kid, ...payload });
  return { format: 'ghost-arcade-code-update', v: 1, kid, payload: text, signature: sign(null, Buffer.from(text, 'utf8'), privateKey).toString('hex') };
}
function filesEntry(files: Files) {
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { size: Buffer.byteLength(v), sha256: sha(v) }]));
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ga-codeupd-'));
  dirs.push(d);
  return d;
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A zip of `files` and its signed envelope. */
function buildUpdate(version: string, files: Files, { shellId = SHELL, privateKey = pair.privateKey } = {}) {
  const src = tmp();
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(src, rel, '..'), { recursive: true });
    writeFileSync(join(src, rel), text);
  }
  const zip = join(tmp(), `ghost-arcade-code-${version}.zip`);
  // Windows has no zip command; its own tar (bsdtar, not Git's) writes a zip
  // from the name. Files by name: a '.' would add a './' entry, which unpacking refuses.
  if (process.platform === 'win32') execFileSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, ...Object.keys(files)], { cwd: src });
  else execFileSync('zip', ['-r', '-X', '-D', '-q', zip, '.'], { cwd: src });
  const bytes = readFileSync(zip);
  const envelope = envelopeFor({
    version, shellId, created_at: new Date().toISOString(),
    archive: { name: `ghost-arcade-code-${version}.zip`, size: bytes.length, sha256: sha(bytes) },
    files: filesEntry(files),
  }, privateKey);
  return { zip: bytes, envelope };
}

describe('verifyCodeManifest', () => {
  const good = envelopeFor({ version: '2.2.1', shellId: SHELL, archive: { name: 'a.zip', size: 10, sha256: sha('x') }, files: filesEntry({ 'index.html': 'hi' }) });

  it('accepts a signed manifest', () => {
    const r = cu.verifyCodeManifest(good, KEYS);
    expect(r.ok).toBe(true);
    expect(r.manifest.version).toBe('2.2.1');
  });
  it('refuses a changed payload, an unknown key, another key', () => {
    expect(cu.verifyCodeManifest({ ...good, payload: good.payload.replace('2.2.1', '2.2.9') }, KEYS).reason).toBe('signature');
    expect(cu.verifyCodeManifest(good, {}).reason).toBe('unknown_key');
    const other = keyPair();
    expect(cu.verifyCodeManifest(good, { 'code-test': other.publicHex }).reason).toBe('signature');
  });
  it('refuses unsafe file names and a manifest without index.html', () => {
    const cases: Files[] = [{ 'index.html': 'a', '../evil.js': 'b' }, { 'index.html': 'a', '/abs.js': 'b' }, { 'main.js': 'a' }];
    for (const files of cases) {
      const env = envelopeFor({ version: '2.2.1', shellId: SHELL, archive: { name: 'a.zip', size: 10, sha256: sha('x') }, files: filesEntry(files) });
      expect(cu.verifyCodeManifest(env, KEYS).reason).toBe('format');
    }
  });
  it('a packaged app never trusts the development key', () => {
    expect(Object.keys(trustedCodeUpdateKeys({ isPackaged: false }))).toContain('code-dev');
    expect(Object.keys(trustedCodeUpdateKeys({ isPackaged: true }))).not.toContain('code-dev');
  });
});

describe('boot state machine', () => {
  const usable = () => true;
  it('promotes a pending update, keeps the confirmed one as previous', () => {
    const plan = cu.planBoot({ v: 1, active: { version: '2.2.1', confirmed: true }, pending: { version: '2.2.2' }, bootAttempts: 0, bad: [] }, { usable });
    expect(plan.load).toBe('2.2.2');
    expect(plan.state.previous).toEqual({ version: '2.2.1', confirmed: true });
    expect(plan.state.bootAttempts).toBe(1);
  });
  it('gives an update up after two launches without a ready signal, back to the previous good one', () => {
    let s = cu.planBoot({ v: 1, active: { version: '2.2.1', confirmed: true }, pending: { version: '2.2.2' } }, { usable }).state;
    s = cu.planBoot(s, { usable }).state; // second launch, still no ready
    const third = cu.planBoot(s, { usable });
    expect(third.load).toBe('2.2.1');
    expect(third.state.bad).toContain('2.2.2');
  });
  it('falls back to the built-in code when there is no good previous update', () => {
    let s = cu.planBoot({ v: 1, pending: { version: '2.2.2' } }, { usable }).state;
    s = cu.planBoot(s, { usable }).state;
    const third = cu.planBoot(s, { usable });
    expect(third.load).toBe(null);
    expect(third.state.bad).toEqual(['2.2.2']);
  });
  it('a ready signal clears the count and confirms the update', () => {
    const s = cu.planBoot({ v: 1, pending: { version: '2.2.2' } }, { usable }).state;
    const r = cu.planReady(s);
    expect(r.bootAttempts).toBe(0);
    expect(r.active.confirmed).toBe(true);
    expect(cu.planBoot(r, { usable }).load).toBe('2.2.2');
  });
  it('a ready timeout on the second launch rolls back at once; on the first it only counts', () => {
    const first = cu.planBoot({ v: 1, pending: { version: '2.2.2' } }, { usable }).state;
    expect(cu.planReadyTimeout(first, { usable }).rollBack).toBe(false);
    const second = cu.planBoot(first, { usable }).state;
    const t = cu.planReadyTimeout(second, { usable });
    expect(t.rollBack).toBe(true);
    expect(t.load).toBe(null);
    expect(t.state.bad).toContain('2.2.2');
  });
  it('the builtin flag gives the active update up', () => {
    const plan = cu.planBoot({ v: 1, active: { version: '2.2.1', confirmed: true } }, { usable, builtinOnly: true });
    expect(plan.load).toBe(null);
    expect(plan.state.bad).toContain('2.2.1');
  });
  it('an update that is no longer usable (other shell, older than built-in) is dropped', () => {
    const plan = cu.planBoot({ v: 1, active: { version: '2.2.1', confirmed: true } }, { usable: () => false });
    expect(plan.load).toBe(null);
    expect(plan.state.active).toBe(null);
  });
});

// ─── Against a local release server ────────────────────────────────────────

let server: Server;
let base = '';
let routes: Record<string, Buffer | string> = {};
let rangeRequests = 0;
let cutAfter: number | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    const body = routes[url];
    if (body === undefined) { res.writeHead(404).end(); return; }
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const range = /^bytes=(\d+)-$/.exec(String(req.headers.range ?? ''));
    if (range) {
      rangeRequests++;
      const start = Number(range[1]);
      res.writeHead(206, { 'Content-Length': buf.length - start, 'Content-Range': `bytes ${start}-${buf.length - 1}/${buf.length}` });
      res.end(buf.subarray(start));
      return;
    }
    if (cutAfter !== null) {
      // Send part of the file, then drop the connection.
      res.writeHead(200, { 'Content-Length': buf.length });
      res.write(buf.subarray(0, cutAfter));
      cutAfter = null;
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.writeHead(200, { 'Content-Length': buf.length }).end(buf);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => { routes = {}; rangeRequests = 0; cutAfter = null; });

function publish(version: string, update: ReturnType<typeof buildUpdate> | null, { manifestName = `code-update-${version}.json` } = {}) {
  const assets: { name: string; browser_download_url: string }[] = [];
  if (update) {
    routes[`/dl/${manifestName}`] = JSON.stringify(update.envelope);
    routes[`/dl/ghost-arcade-code-${version}.zip`] = update.zip;
    assets.push({ name: manifestName, browser_download_url: `${base}/dl/${manifestName}` });
    assets.push({ name: `ghost-arcade-code-${version}.zip`, browser_download_url: `${base}/dl/ghost-arcade-code-${version}.zip` });
  }
  routes['/repos/riskcapital/ghost-arcade-releases/releases/latest'] = JSON.stringify({ tag_name: `v${version}`, body: `Notes for ${version}`, assets });
}

function store(userDataDir: string, extra: Record<string, unknown> = {}) {
  const builtinDir = join(userDataDir, 'builtin');
  mkdirSync(builtinDir, { recursive: true });
  writeFileSync(join(builtinDir, 'index.html'), 'built-in');
  return cu.createCodeUpdates({
    userDataDir, builtinDir, builtinVersion: '2.2.0', shellId: SHELL, isPackaged: false,
    env: { GA_UPDATE_API: base }, argv: [], keys: KEYS, log: { log() {}, warn() {} }, ...extra,
  });
}

const V1 = { 'index.html': '<p>2.2.1</p>', 'assets/app.js': 'console.log("2.2.1")', 'ISF/a.fs': 'void main(){}' };

describe('check, install and boot', () => {
  it('offers a matching update with its size; another shell needs the full download', async () => {
    const ud = tmp();
    publish('2.2.1', buildUpdate('2.2.1', V1));
    const s = await store(ud).check();
    expect(s.latest).toMatchObject({ version: '2.2.1', installable: true, notes: 'Notes for 2.2.1' });
    expect(s.latest.size).toBeGreaterThan(0);

    publish('2.2.1', buildUpdate('2.2.1', V1, { shellId: 'sh1-other' }));
    expect((await store(tmp()).check()).latest).toMatchObject({ installable: false, reason: 'needs-full-download' });

    publish('2.2.1', null);
    expect((await store(tmp()).check()).latest).toMatchObject({ installable: false, reason: 'no-code-update' });

    publish('2.2.0', buildUpdate('2.2.0', V1));
    expect((await store(tmp()).check()).latest).toBe(null);
  });

  it('refuses a manifest signed by an unknown key', async () => {
    publish('2.2.1', buildUpdate('2.2.1', V1, { privateKey: keyPair().privateKey }));
    expect((await store(tmp()).check()).latest).toMatchObject({ installable: false, reason: 'manifest-signature' });
  });

  it('downloads, checks, unpacks; the next launch loads it; ready confirms it', async () => {
    const ud = tmp();
    publish('2.2.1', buildUpdate('2.2.1', V1));
    const a = store(ud);
    expect(a.boot()).toBe(join(ud, 'builtin'));
    await a.check();
    const seen: number[] = [];
    const after = await a.install({ onProgress: (p: { received: number }) => seen.push(p.received) });
    expect(after.pending).toBe('2.2.1');
    expect(seen.length).toBeGreaterThan(0);
    expect(readFileSync(join(ud, 'updates', '2.2.1', 'assets', 'app.js'), 'utf8')).toContain('2.2.1');
    expect(existsSync(join(ud, 'updates', 'downloads', '2.2.1.zip'))).toBe(false);

    const b = store(ud);
    expect(b.boot()).toBe(join(ud, 'updates', '2.2.1'));
    expect(b.status()).toMatchObject({ source: 'update', codeVersion: '2.2.1' });
    b.ready();
    const c = store(ud);
    expect(c.boot()).toBe(join(ud, 'updates', '2.2.1'));
  });

  it('resumes a broken download with a Range request', async () => {
    const ud = tmp();
    const upd = buildUpdate('2.2.1', V1);
    publish('2.2.1', upd);
    const a = store(ud);
    await a.check();
    cutAfter = Math.floor(upd.zip.length / 2);
    const first = await a.install().catch((e: Error) => e);
    expect(first).toBeInstanceOf(Error);
    expect(statSync(join(ud, 'updates', 'downloads', '2.2.1.zip.part')).size).toBe(cutAfter ?? Math.floor(upd.zip.length / 2));
    const second = await a.install();
    expect(second.pending).toBe('2.2.1');
    expect(rangeRequests).toBe(1);
  });

  it('refuses an archive that does not match the signed hash', async () => {
    const ud = tmp();
    const upd = buildUpdate('2.2.1', V1);
    publish('2.2.1', upd);
    const bad = Buffer.from(upd.zip);
    bad[bad.length - 30] ^= 0xff;
    routes['/dl/ghost-arcade-code-2.2.1.zip'] = bad;
    const a = store(ud);
    await a.check();
    await expect(a.install()).rejects.toThrow(/does not match/);
    expect(a.status().pending).toBe(null);
  });

  it('a file changed on disk after install keeps the update from loading', async () => {
    const ud = tmp();
    publish('2.2.1', buildUpdate('2.2.1', V1));
    const a = store(ud);
    await a.check();
    await a.install();
    writeFileSync(join(ud, 'updates', '2.2.1', 'assets', 'app.js'), 'tampered');
    const b = store(ud);
    expect(b.boot()).toBe(join(ud, 'builtin'));
    expect(b.status().bad).toContain('2.2.1');
  });

  it('an extra file planted beside the update keeps it from loading', async () => {
    const ud = tmp();
    publish('2.2.1', buildUpdate('2.2.1', V1));
    const a = store(ud);
    await a.check();
    await a.install();
    writeFileSync(join(ud, 'updates', '2.2.1', 'assets', 'extra.js'), 'planted');
    expect(store(ud).boot()).toBe(join(ud, 'builtin'));
  });

  it('a different shell (a new full install) ignores an installed update', async () => {
    const ud = tmp();
    publish('2.2.1', buildUpdate('2.2.1', V1));
    const a = store(ud);
    await a.check();
    await a.install();
    expect(store(ud, { shellId: 'sh1-newer-app' }).boot()).toBe(join(ud, 'builtin'));
  });

  it('two launches without ready roll back; the ready timer rolls back live on the second', async () => {
    const ud = tmp();
    publish('2.2.1', buildUpdate('2.2.1', V1));
    const a = store(ud);
    await a.check();
    await a.install();
    expect(store(ud).boot()).toContain('2.2.1'); // launch 1: crashes, no ready
    const second = store(ud);
    expect(second.boot()).toContain('2.2.1'); // launch 2
    const rolled = await new Promise<string>((resolve) => second.watchReady(resolve, 20));
    expect(rolled).toBe(join(ud, 'builtin'));
    expect(second.status()).toMatchObject({ source: "builtin", bad: ["2.2.1"], rolledBack: { from: "2.2.1", to: null } });
    expect(store(ud).boot()).toBe(join(ud, 'builtin'));
    // It is no longer offered.
    expect((await store(ud).check()).latest).toMatchObject({ installable: false, reason: 'failed-before' });
  });

  it('revert goes back to the built-in code from the next launch', async () => {
    const ud = tmp();
    publish('2.2.1', buildUpdate('2.2.1', V1));
    const a = store(ud);
    await a.check();
    await a.install();
    const b = store(ud);
    b.boot();
    b.ready();
    b.revert();
    expect(store(ud).boot()).toBe(join(ud, 'builtin'));
  });

  it('is off without a shell id', async () => {
    const ud = tmp();
    publish('2.2.1', buildUpdate('2.2.1', V1));
    const a = store(ud, { shellId: null });
    expect(a.boot()).toBe(join(ud, 'builtin'));
    expect((await a.check()).enabled).toBe(false);
  });
});

describe('allowed addresses', () => {
  it('https always; plain http only to localhost in a development run', () => {
    expect(cu.allowedUrl('https://github.com/x', { isPackaged: true })).toBe(true);
    expect(cu.allowedUrl('http://127.0.0.1:9/x', { isPackaged: true })).toBe(false);
    expect(cu.allowedUrl('http://127.0.0.1:9/x', { isPackaged: false })).toBe(true);
    expect(cu.allowedUrl('http://example.com/x', { isPackaged: false })).toBe(false);
    expect(cu.resolveApiBase({ isPackaged: true, env: { GA_UPDATE_API: 'http://localhost:1' } })).toBe('https://api.github.com');
  });
});
