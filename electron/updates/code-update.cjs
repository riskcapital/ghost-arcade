'use strict';
/**
 * Signed app-code updates: a new renderer (vite's dist/) without the full
 * installer, for releases whose shell did not change.
 *
 * A release carries `ghost-arcade-code-<version>.zip` and
 * `code-update-<version>.json`, an envelope like the add-on entitlements:
 * Ed25519 over the payload string, public keys by `kid` in keys.cjs. The
 * payload names the shell id it was built against (scripts/
 * code-update-shell.mjs), the archive's size and sha256, and the sha256 of
 * every file in it. An update installs only into an app with the same shell
 * id; anything else is a full download, as before.
 *
 * On disk, in userData/updates/:
 *   state.json          which update is active, pending, previous; bad ones
 *   downloads/          <version>.zip(.part) while downloading (resumable)
 *   <version>/          an unpacked update, with .code-update.json (the
 *                       signed envelope) beside index.html
 *
 * Launch (boot): a pending update becomes active; the active one is checked
 * file by file against its signed list, so nothing written into userData by
 * anything else ever loads. Every launch of an update counts a boot attempt
 * until the renderer says it is ready; two launches in a row without that
 * (a crash, a hang) mark it bad and the app falls back to the previous good
 * update or the built-in code. `--builtin-code` (or GA_BUILTIN_CODE=1) does
 * the same on purpose. Nothing restarts the app by itself: an installed
 * update waits for the user's "Restart now".
 */

const nodeCrypto = require('crypto');
const nodeFs = require('fs');
const nodePath = require('path');
const { writeFileAtomicSync } = require('../atomic-write.cjs');
const { trustedCodeUpdateKeys } = require('./keys.cjs');

const ENVELOPE_FORMAT = 'ghost-arcade-code-update';
const MARKER_FILE = '.code-update.json';
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const RELEASES_REPO = 'riskcapital/ghost-arcade-releases';
const PRODUCTION_API = 'https://api.github.com';
/** Launches in a row without a ready signal before an update counts as bad. */
const MAX_FAILED_BOOTS = 2;
/** How long the updated renderer has to say it is ready. */
const READY_TIMEOUT_MS = 60_000;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BAD_REMEMBERED = 20;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

// ─── Versions ──────────────────────────────────────────────────────────────

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}

// ─── Manifest ──────────────────────────────────────────────────────────────

/** A path inside the archive: relative, forward slashes, no `..`, no dot-files at the root marker. */
function safeRelativePath(p) {
  if (typeof p !== 'string' || !p || p.length > 512) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0') || /^[A-Za-z]:/.test(p)) return false;
  const parts = p.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..') && p !== MARKER_FILE;
}

/**
 * Check a `code-update-<version>.json` envelope. `{ ok: true, manifest }` or
 * `{ ok: false, reason }`: 'format' | 'unknown_key' | 'signature'.
 */
function verifyCodeManifest(envelope, keys) {
  const fail = (reason) => ({ ok: false, reason });
  if (!envelope || typeof envelope !== 'object') return fail('format');
  if (envelope.format !== ENVELOPE_FORMAT || envelope.v !== 1) return fail('format');
  if (typeof envelope.payload !== 'string' || typeof envelope.kid !== 'string') return fail('format');
  if (typeof envelope.signature !== 'string' || !/^[0-9a-f]{128}$/i.test(envelope.signature)) return fail('format');
  const publicKeyHex = Object.prototype.hasOwnProperty.call(keys, envelope.kid) ? keys[envelope.kid] : null;
  if (!publicKeyHex) return fail('unknown_key');
  let good = false;
  try {
    const key = nodeCrypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    good = nodeCrypto.verify(null, Buffer.from(envelope.payload, 'utf8'), key, Buffer.from(envelope.signature, 'hex'));
  } catch {
    good = false;
  }
  if (!good) return fail('signature');
  let m;
  try { m = JSON.parse(envelope.payload); } catch { return fail('format'); }
  if (!m || typeof m !== 'object' || m.v !== 1 || m.kid !== envelope.kid) return fail('format');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) return fail('format');
  if (typeof m.shellId !== 'string' || !m.shellId) return fail('format');
  const a = m.archive;
  if (!a || typeof a !== 'object' || typeof a.name !== 'string' || !/^[A-Za-z0-9._-]+\.zip$/.test(a.name)) return fail('format');
  if (!Number.isSafeInteger(a.size) || a.size <= 0 || a.size > MAX_ARCHIVE_BYTES) return fail('format');
  if (typeof a.sha256 !== 'string' || !SHA256_RE.test(a.sha256)) return fail('format');
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) return fail('format');
  const names = Object.keys(m.files);
  if (!names.length || !names.includes('index.html')) return fail('format');
  for (const name of names) {
    const f = m.files[name];
    if (!safeRelativePath(name) || !f || !SHA256_RE.test(String(f.sha256)) || !Number.isSafeInteger(f.size) || f.size < 0) return fail('format');
  }
  return { ok: true, manifest: m };
}

// ─── Files ─────────────────────────────────────────────────────────────────

function sha256FileSync(file, fs = nodeFs) {
  const hash = nodeCrypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** Every file under `dir`, as forward-slash relative paths. Symlinks count as files (and then fail the check). */
function listFiles(dir, fs = nodeFs, prefix = '', out = []) {
  for (const entry of fs.readdirSync(nodePath.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(dir, fs, rel, out);
    else out.push({ rel, symlink: entry.isSymbolicLink() });
  }
  return out;
}

/**
 * The files in `dir` are exactly the signed list: same names, sizes and
 * sha256, nothing more (the marker aside), no links. `{ ok, reason? }`.
 */
function verifyTree(dir, manifest, fs = nodeFs) {
  let found;
  try { found = listFiles(dir, fs); } catch (err) { return { ok: false, reason: `unreadable: ${err.code || err.message}` }; }
  const expected = manifest.files;
  let count = 0;
  for (const { rel, symlink } of found) {
    if (rel === MARKER_FILE) continue;
    const want = Object.prototype.hasOwnProperty.call(expected, rel) ? expected[rel] : null;
    if (!want) return { ok: false, reason: `unexpected file ${rel}` };
    if (symlink) return { ok: false, reason: `link ${rel}` };
    const full = nodePath.join(dir, ...rel.split('/'));
    let size;
    try { size = fs.statSync(full).size; } catch { return { ok: false, reason: `unreadable ${rel}` }; }
    if (size !== want.size) return { ok: false, reason: `size of ${rel}` };
    if (sha256FileSync(full, fs) !== want.sha256) return { ok: false, reason: `contents of ${rel}` };
    count++;
  }
  if (count !== Object.keys(expected).length) return { ok: false, reason: 'missing files' };
  return { ok: true };
}

// ─── State machine ─────────────────────────────────────────────────────────
//
// state = { v: 1, active, pending, previous, bootAttempts, bad: [version] }
// active/pending/previous: { version, confirmed } | null

function emptyState() {
  return { v: 1, active: null, pending: null, previous: null, bootAttempts: 0, bad: [] };
}

function normalizeState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return s;
  const entry = (e) => (e && typeof e === 'object' && typeof e.version === 'string' && VERSION_RE.test(e.version)
    ? { version: e.version, confirmed: !!e.confirmed }
    : null);
  s.active = entry(raw.active);
  s.pending = entry(raw.pending);
  s.previous = entry(raw.previous);
  s.bootAttempts = Number.isSafeInteger(raw.bootAttempts) && raw.bootAttempts > 0 ? raw.bootAttempts : 0;
  s.bad = Array.isArray(raw.bad) ? raw.bad.filter((v) => typeof v === 'string' && VERSION_RE.test(v)).slice(-MAX_BAD_REMEMBERED) : [];
  return s;
}

function markBad(state, version) {
  if (version && !state.bad.includes(version)) state.bad = [...state.bad, version].slice(-MAX_BAD_REMEMBERED);
}

/**
 * Decide what this launch loads. Pure apart from `usable(version)`, which
 * says whether an unpacked update is there, intact and for this shell, and
 * newer than the built-in code.
 *
 * Returns { state, load: version | null, events: string[] }.
 */
function planBoot(input, { usable, builtinOnly = false }) {
  const state = normalizeState(input);
  const events = [];
  const ok = (entry) => !!entry && !state.bad.includes(entry.version) && usable(entry.version);

  if (state.pending) {
    if (ok(state.pending) && state.pending.version !== state.active?.version) {
      if (state.active?.confirmed && ok(state.active)) state.previous = { ...state.active };
      state.active = { version: state.pending.version, confirmed: false };
      state.bootAttempts = 0;
      events.push(`promoted ${state.pending.version}`);
    } else {
      events.push(`dropped pending ${state.pending.version}`);
    }
    state.pending = null;
  }

  if (builtinOnly && state.active) {
    events.push(`builtin requested: ${state.active.version} marked bad`);
    markBad(state, state.active.version);
    state.active = null;
    state.bootAttempts = 0;
    return { state, load: null, events };
  }

  if (state.active && state.bootAttempts >= MAX_FAILED_BOOTS) {
    events.push(`${state.active.version} did not start ${state.bootAttempts} times: marked bad`);
    markBad(state, state.active.version);
    state.active = null;
    state.bootAttempts = 0;
    if (ok(state.previous) && state.previous.confirmed) {
      state.active = { ...state.previous };
      state.previous = null;
      events.push(`back to ${state.active.version}`);
    }
  }

  if (state.active && !ok(state.active)) {
    events.push(`${state.active.version} is not usable here`);
    state.active = null;
    state.bootAttempts = 0;
    if (ok(state.previous) && state.previous.confirmed) {
      state.active = { ...state.previous };
      state.previous = null;
      events.push(`back to ${state.active.version}`);
    }
  }
  if (state.previous && !ok(state.previous)) state.previous = null;

  if (!state.active) {
    state.bootAttempts = 0;
    return { state, load: null, events };
  }
  state.bootAttempts += 1;
  return { state, load: state.active.version, events };
}

/** The renderer of this launch said it is ready. */
function planReady(input) {
  const state = normalizeState(input);
  state.bootAttempts = 0;
  if (state.active) state.active.confirmed = true;
  return state;
}

/**
 * The renderer did not say it was ready in time. On the last allowed try
 * the update is given up now (the caller reloads the built-in code),
 * otherwise the attempt simply stays counted for the next launch.
 * Returns { state, rollBack: boolean, load: version | null }.
 */
function planReadyTimeout(input, { usable }) {
  const state = normalizeState(input);
  if (!state.active || state.bootAttempts < MAX_FAILED_BOOTS) return { state, rollBack: false, load: state.active?.version ?? null };
  markBad(state, state.active.version);
  state.active = null;
  state.bootAttempts = 0;
  if (state.previous?.confirmed && !state.bad.includes(state.previous.version) && usable(state.previous.version)) {
    state.active = { ...state.previous };
    state.previous = null;
    // The previous code gets this launch as its first try.
    state.bootAttempts = 1;
  }
  return { state, rollBack: true, load: state.active?.version ?? null };
}

// ─── Download ──────────────────────────────────────────────────────────────

/** URLs we fetch: https only, except localhost in a development run. */
function allowedUrl(raw, { isPackaged }) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return !isPackaged && url.protocol === 'http:' && local;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const outer = init.signal;
  const onAbort = () => ctrl.abort();
  if (outer) outer.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onAbort);
  }
}

async function readLimitedJson(res, limit) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new Error('response too large');
  return JSON.parse(buf.toString('utf8'));
}

/**
 * Stream `url` into `dest` (via dest.part), resuming a partial download with
 * a Range request. Stops past `expectedSize`. Resolves when the file is
 * complete; the caller checks its hash.
 */
async function downloadTo({ url, dest, expectedSize, fetchImpl, onProgress = () => {}, signal, fs = nodeFs }) {
  const part = `${dest}.part`;
  let have = 0;
  try { have = fs.statSync(part).size; } catch { have = 0; }
  if (have > expectedSize) { fs.rmSync(part, { force: true }); have = 0; }
  if (have === expectedSize && have > 0) {
    fs.renameSync(part, dest);
    return;
  }
  const headers = have > 0 ? { Range: `bytes=${have}-` } : {};
  // A large archive on a slow line: no overall timeout, only one for the response to start.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    signal.addEventListener('abort', onAbort, { once: true });
  }
  const startTimer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: ctrl.signal, redirect: 'follow' });
  } catch (err) {
    clearTimeout(startTimer);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    throw err;
  }
  clearTimeout(startTimer);
  try {
    if (res.status === 200) have = 0; // the server ignored Range: start over
    else if (res.status !== 206) throw new Error(`download failed (HTTP ${res.status})`);
    if (!res.body) throw new Error('download failed (no body)');
    const out = fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
    let written = have;
    onProgress(written, expectedSize);
    try {
      for await (const chunk of res.body) {
        written += chunk.length;
        if (written > expectedSize) throw new Error('download is larger than the update');
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
        onProgress(written, expectedSize);
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    if (written !== expectedSize) throw new Error('download ended early');
    fs.renameSync(part, dest);
  } catch (err) {
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    throw err;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// ─── The store ─────────────────────────────────────────────────────────────

/** The update API: GitHub, or GA_UPDATE_API in a development run (a local stand-in). */
function resolveApiBase({ isPackaged, env }) {
  const raw = !isPackaged ? String(env?.GA_UPDATE_API ?? '').trim() : '';
  if (!raw) return PRODUCTION_API;
  return allowedUrl(raw, { isPackaged }) ? raw.replace(/\/+$/, '') : PRODUCTION_API;
}

/** The running app's shell id, baked in at build time; null when the build has none. */
function readShellId(electronDir, fs = nodeFs) {
  try {
    const data = JSON.parse(fs.readFileSync(nodePath.join(electronDir, 'updates', 'shell-id.json'), 'utf8'));
    return typeof data?.shellId === 'string' && data.shellId ? data.shellId : null;
  } catch {
    return null;
  }
}

function createCodeUpdates({
  userDataDir,
  builtinDir,
  builtinVersion,
  shellId,
  isPackaged,
  argv = process.argv,
  env = process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
  extractZip = (zip, dir) => require('extract-zip')(zip, { dir }),
  fs = nodeFs,
  keys = null,
  log = console,
} = {}) {
  const root = nodePath.join(userDataDir, 'updates');
  const stateFile = nodePath.join(root, 'state.json');
  const downloads = nodePath.join(root, 'downloads');
  const trusted = keys ?? trustedCodeUpdateKeys({ isPackaged: !!isPackaged });
  const apiBase = resolveApiBase({ isPackaged: !!isPackaged, env });
  const enabled = !!shellId && Object.keys(trusted).length > 0;
  const builtinOnly = argv.includes('--builtin-code') || env.GA_BUILTIN_CODE === '1';

  let state = emptyState();
  /** What this launch loaded: null = the built-in code. */
  let loaded = null;
  let bootEvents = [];
  /** The newest release found by check(). */
  let latest = null;
  let lastError = null;
  /** { from, to } when this run gave an update up (to: null = the built-in code). */
  let rolledBack = null;
  /** { version, received, total } while downloading. */
  let progress = null;
  let installing = null;
  let abort = null;
  let readyTimer = null;
  let readySeen = false;
  /** Folders loaded at some point in this run: never removed under a window that may still read them. */
  const inUse = new Set();

  const versionDir = (version) => nodePath.join(root, version);
  const markerOf = (version) => nodePath.join(versionDir(version), MARKER_FILE);

  function readState() {
    try { return normalizeState(JSON.parse(fs.readFileSync(stateFile, 'utf8'))); } catch { return emptyState(); }
  }
  state = readState();

  function saveState() {
    try {
      fs.mkdirSync(root, { recursive: true });
      writeFileAtomicSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    } catch (err) {
      log.warn?.('[CodeUpdate] could not save state:', err.message);
    }
  }

  /** The signed manifest of an unpacked update, re-checked; null when it is not one for this app. */
  function installedManifest(version) {
    let envelope;
    try { envelope = JSON.parse(fs.readFileSync(markerOf(version), 'utf8')); } catch { return null; }
    const checked = verifyCodeManifest(envelope, trusted);
    if (!checked.ok) return null;
    const m = checked.manifest;
    if (m.version !== version || m.shellId !== shellId) return null;
    if (compareVersions(m.version, builtinVersion) <= 0) return null;
    return m;
  }

  /** Cheap check (marker + signature): used when planning, before the full file check. */
  const usable = (version) => !!installedManifest(version);

  function removeUnused() {
    const keep = new Set([state.active?.version, state.pending?.version, state.previous?.version, ...inUse].filter(Boolean));
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'downloads') continue;
      if (VERSION_RE.test(entry.name) && keep.has(entry.name)) continue;
      if (VERSION_RE.test(entry.name) || entry.name.startsWith('.staging-')) {
        try { fs.rmSync(nodePath.join(root, entry.name), { recursive: true, force: true }); } catch { /* next time */ }
      }
    }
  }

  /**
   * Called once, before any window loads: which renderer folder to use.
   * Returns the folder (the built-in dist/ when no update applies).
   */
  function boot() {
    if (!enabled) {
      loaded = null;
      return builtinDir;
    }
    const before = readState();
    let plan = planBoot(before, { usable, builtinOnly });
    // The full check, file by file, of what is about to load.
    while (plan.load) {
      const m = installedManifest(plan.load);
      const tree = m ? verifyTree(versionDir(plan.load), m, fs) : { ok: false, reason: 'manifest' };
      if (tree.ok) break;
      plan.events.push(`${plan.load} failed its file check (${tree.reason})`);
      const s = plan.state;
      markBad(s, plan.load);
      s.active = null;
      s.bootAttempts = 0;
      plan = planBoot(s, { usable, builtinOnly });
    }
    state = plan.state;
    bootEvents = plan.events;
    loaded = plan.load;
    if (loaded) inUse.add(loaded);
    const newlyBad = state.bad.filter((v) => !before.bad.includes(v));
    if (newlyBad.length && !builtinOnly) rolledBack = { from: newlyBad[newlyBad.length - 1], to: loaded };
    saveState();
    for (const e of bootEvents) log.log?.(`[CodeUpdate] ${e}`);
    log.log?.(`[CodeUpdate] renderer: ${loaded ? `update ${loaded}` : `built-in ${builtinVersion}`}`);
    return loaded ? versionDir(loaded) : builtinDir;
  }

  function codeVersion() {
    return loaded ?? builtinVersion;
  }

  /**
   * Start the ready timer for this launch. `onRollBack(dir)` is called when
   * the update is given up during this run; the caller reloads its windows
   * from `dir`.
   */
  function watchReady(onRollBack, timeoutMs = READY_TIMEOUT_MS) {
    if (!loaded || readySeen) return;
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (readySeen) return;
      const plan = planReadyTimeout(state, { usable });
      state = plan.state;
      saveState();
      if (!plan.rollBack) {
        log.warn?.(`[CodeUpdate] update ${loaded} has not said it is ready after ${Math.round(timeoutMs / 1000)} s`);
        return;
      }
      log.warn?.(`[CodeUpdate] update ${loaded} did not start twice: back to ${plan.load ?? 'the built-in code'}`);
      rolledBack = { from: loaded, to: plan.load };
      loaded = plan.load;
      onRollBack(loaded ? versionDir(loaded) : builtinDir);
    }, timeoutMs);
    readyTimer.unref?.();
  }

  /** The main window's renderer is up. */
  function ready() {
    readySeen = true;
    clearTimeout(readyTimer);
    if (!loaded) return status();
    state = planReady(state);
    saveState();
    removeUnused();
    return status();
  }

  function status() {
    return {
      enabled,
      shellId,
      builtinVersion,
      codeVersion: codeVersion(),
      source: loaded ? 'update' : 'builtin',
      pending: state.pending?.version ?? null,
      previous: state.previous?.confirmed ? state.previous.version : null,
      bad: [...state.bad],
      // The envelope and address stay in main.
      latest: latest ? { version: latest.version, notes: latest.notes ?? '', installable: latest.installable, reason: latest.reason ?? null, size: latest.size ?? null, installed: !!latest.installed } : null,
      progress,
      installing: !!installing,
      lastError,
      rolledBack,
      bootEvents: [...bootEvents],
    };
  }

  /** Fetch the latest release and, when it has one, its code-update manifest. */
  async function check() {
    if (!enabled) {
      latest = null;
      return status();
    }
    lastError = null;
    try {
      const res = await fetchWithTimeout(fetchImpl, `${apiBase}/repos/${RELEASES_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`release check failed (HTTP ${res.status})`);
      const release = await readLimitedJson(res, MAX_MANIFEST_BYTES);
      const version = String(release?.tag_name ?? '').replace(/^v/, '');
      if (!VERSION_RE.test(version) || compareVersions(version, codeVersion()) <= 0) {
        latest = null;
        return status();
      }
      const notes = typeof release.body === 'string' ? release.body.slice(0, 20_000) : '';
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const asset = (name) => assets.find((a) => a && a.name === name && typeof a.browser_download_url === 'string');
      const manifestAsset = asset(`code-update-${version}.json`);
      if (!manifestAsset) {
        latest = { version, notes, installable: false, reason: 'no-code-update' };
        return status();
      }
      if (!allowedUrl(manifestAsset.browser_download_url, { isPackaged })) throw new Error('update address refused');
      const mres = await fetchWithTimeout(fetchImpl, manifestAsset.browser_download_url, { headers: { Accept: 'application/octet-stream' } });
      if (!mres.ok) throw new Error(`update manifest failed (HTTP ${mres.status})`);
      const envelope = await readLimitedJson(mres, MAX_MANIFEST_BYTES);
      const checked = verifyCodeManifest(envelope, trusted);
      if (!checked.ok) {
        latest = { version, notes, installable: false, reason: `manifest-${checked.reason}` };
        return status();
      }
      const m = checked.manifest;
      const archiveAsset = asset(m.archive.name);
      if (m.version !== version) latest = { version, notes, installable: false, reason: 'manifest-version' };
      else if (m.shellId !== shellId) latest = { version, notes, installable: false, reason: 'needs-full-download' };
      else if (state.bad.includes(version)) latest = { version, notes, installable: false, reason: 'failed-before' };
      else if (!archiveAsset || !allowedUrl(archiveAsset.browser_download_url, { isPackaged })) latest = { version, notes, installable: false, reason: 'no-archive' };
      else {
        latest = {
          version,
          notes,
          installable: true,
          size: m.archive.size,
          installed: state.pending?.version === version,
          envelope,
          url: archiveAsset.browser_download_url,
        };
      }
    } catch (err) {
      lastError = err.message;
    }
    return status();
  }

  /** Download, check and unpack the update check() found. Never restarts. */
  function install({ onProgress = () => {} } = {}) {
    if (installing) return installing;
    installing = (async () => {
      const target = latest;
      if (!target?.installable) throw new Error('no update to install');
      const checked = verifyCodeManifest(target.envelope, trusted);
      if (!checked.ok || checked.manifest.shellId !== shellId) throw new Error('update manifest refused');
      const m = checked.manifest;
      if (state.pending?.version === m.version && usable(m.version)) return status();
      fs.mkdirSync(downloads, { recursive: true });
      const zip = nodePath.join(downloads, `${m.version}.zip`);
      abort = new AbortController();
      progress = { version: m.version, received: 0, total: m.archive.size };
      const report = (received, total) => { progress = { version: m.version, received, total }; onProgress(progress); };
      let zipOk = false;
      try { zipOk = fs.statSync(zip).size === m.archive.size && sha256FileSync(zip, fs) === m.archive.sha256; } catch { zipOk = false; }
      if (!zipOk) {
        fs.rmSync(zip, { force: true });
        await downloadTo({ url: target.url, dest: zip, expectedSize: m.archive.size, fetchImpl, onProgress: report, signal: abort.signal, fs });
        if (sha256FileSync(zip, fs) !== m.archive.sha256) {
          fs.rmSync(zip, { force: true });
          throw new Error('the download does not match the signed update');
        }
      }
      // Unpack beside the final folder, check every file, then rename into place.
      const staging = nodePath.join(root, `.staging-${m.version}-${nodeCrypto.randomBytes(4).toString('hex')}`);
      try {
        await extractZip(zip, staging);
        const tree = verifyTree(staging, m, fs);
        if (!tree.ok) throw new Error(`the update's files do not match (${tree.reason})`);
        writeFileAtomicSync(nodePath.join(staging, MARKER_FILE), JSON.stringify(target.envelope));
        const final = versionDir(m.version);
        if (loaded === m.version) throw new Error('this update is already running');
        fs.rmSync(final, { recursive: true, force: true });
        fs.renameSync(staging, final);
      } catch (err) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw err;
      }
      fs.rmSync(zip, { force: true });
      state.pending = { version: m.version, confirmed: false };
      state.bad = state.bad.filter((v) => v !== m.version);
      saveState();
      latest = { ...target, installed: true };
      return status();
    })();
    installing.then(
      () => { installing = null; abort = null; progress = null; },
      (err) => { installing = null; abort = null; progress = null; lastError = err.code === 'cancelled' ? null : err.message; },
    );
    return installing;
  }

  function cancel() {
    abort?.abort();
    return status();
  }

  /** Go back to the built-in code from the next launch. */
  function revert() {
    state.active = null;
    state.pending = null;
    state.bootAttempts = 0;
    saveState();
    return status();
  }

  return { boot, watchReady, ready, status, check, install, cancel, revert, codeVersion, get loaded() { return loaded; } };
}

module.exports = {
  ENVELOPE_FORMAT,
  MARKER_FILE,
  MAX_FAILED_BOOTS,
  READY_TIMEOUT_MS,
  compareVersions,
  verifyCodeManifest,
  verifyTree,
  planBoot,
  planReady,
  planReadyTimeout,
  normalizeState,
  downloadTo,
  allowedUrl,
  resolveApiBase,
  readShellId,
  createCodeUpdates,
};
