'use strict';
/**
 * Add-on licences on this computer: Audio Lab and Analog Synth.
 *
 * ghostarcade.live signs an entitlement for one licence on one computer
 * (Ed25519 over the payload string; public keys by `kid` in keys.cjs). It
 * lives in userData/licence/entitlement.json and is checked here, offline,
 * on every look. The licence key sits beside it in licence.json; the
 * renderer only ever sees it masked.
 *
 *   - Refreshed quietly once `refresh_after` passes (7 days), when the app
 *     starts or opens a project; a failed refresh waits a few hours.
 *   - Good for 30 days without a refresh (`valid_until`); a warning from
 *     day 23; one 14-day emergency extension per licence on this computer.
 *   - Checked only when the app starts and when a project opens. An add-on
 *     that was usable in this run stays usable until the app quits, so
 *     nothing switches off in the middle of a show.
 *
 * Machine id: sha256 of the OS machine id and a random install id, so the
 * raw OS id never leaves the computer.
 */

const nodeCrypto = require('crypto');
const nodeFs = require('fs');
const nodeOs = require('os');
const nodePath = require('path');
const { execFileSync } = require('child_process');
const { writeFileAtomicSync } = require('../atomic-write.cjs');
const { trustedLicenceKeys } = require('./keys.cjs');

const DAY_MS = 86_400_000;
const ADDON_PRODUCTS = Object.freeze(['addon.audio-lab', 'addon.analog-synth']);
const WARN_AFTER_DAYS = 23;
const EMERGENCY_DAYS = 14;
/** After a quiet refresh fails (offline), wait this long before trying again. */
const REFRESH_RETRY_MS = 6 * 3_600_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PRODUCTION_API = 'https://ghostarcade.live';
const ENVELOPE_FORMAT = 'ghost-arcade-entitlement';
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_TRIALS_REMEMBERED = 16;

// ─── Signature ─────────────────────────────────────────────────────────────

/**
 * Check an envelope from the website. `{ ok: true, payload }` or
 * `{ ok: false, reason }` with reason 'format' | 'unknown_key' | 'signature'.
 */
function verifyEntitlement(envelope, keys) {
  const fail = (reason) => ({ ok: false, reason });
  if (!envelope || typeof envelope !== 'object') return fail('format');
  if (envelope.format !== ENVELOPE_FORMAT || envelope.v !== 2) return fail('format');
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
  let payload;
  try { payload = JSON.parse(envelope.payload); } catch { return fail('format'); }
  if (!payload || typeof payload !== 'object' || payload.v !== 2 || payload.kid !== envelope.kid) return fail('format');
  if (!Array.isArray(payload.products) || typeof payload.machine_id !== 'string') return fail('format');
  for (const field of ['issued_at', 'refresh_after', 'valid_until']) {
    if (!Number.isFinite(Date.parse(payload[field]))) return fail('format');
  }
  return { ok: true, payload };
}

// ─── State ─────────────────────────────────────────────────────────────────

/** Whole days left, rounded up: the last hours still count as one day. */
function daysLeft(until, now) {
  return Math.max(1, Math.ceil((until - now) / DAY_MS));
}

/**
 * One add-on's state from a verified payload (or none).
 *   locked                  no licence or trial for it here
 *   trial(daysLeft)         a time-limited entitlement that is running
 *   licensed                owned, checked in within the last 23 days
 *   offline-grace(daysLeft) owned, not checked in for 23 days or more
 *   expired(why)            the trial ended, or 30 days passed offline
 *
 * `emergencyUntil` (ms) extends valid_until; `trialEndsAt` (ms) is the end
 * of a trial this computer saw before (the website leaves ended trials out
 * of the entitlement, so it would otherwise read as never tried).
 */
function addonState({ payload, productId, now, emergencyUntil = 0, trialEndsAt = null }) {
  const product = payload && Array.isArray(payload.products)
    ? payload.products.find((p) => p && p.id === productId) ?? null
    : null;
  if (!product) {
    if (trialEndsAt !== null && Number.isFinite(trialEndsAt) && now >= trialEndsAt) return { kind: 'expired', why: 'trial-ended' };
    return { kind: 'locked' };
  }
  const issuedAt = Date.parse(payload.issued_at);
  const validUntil = Math.max(Date.parse(payload.valid_until), Number(emergencyUntil) || 0);
  if (product.kind === 'trial') {
    const endsAt = Date.parse(product.expires_at ?? '');
    if (!Number.isFinite(endsAt) || now >= endsAt) return { kind: 'expired', why: 'trial-ended' };
    if (now >= validUntil) return { kind: 'expired', why: 'offline' };
    return { kind: 'trial', daysLeft: daysLeft(Math.min(endsAt, validUntil), now), endsAt: new Date(endsAt).toISOString() };
  }
  if (product.kind !== 'perpetual') return { kind: 'locked' };
  if (now >= validUntil) return { kind: 'expired', why: 'offline' };
  if (now - issuedAt >= WARN_AFTER_DAYS * DAY_MS) return { kind: 'offline-grace', daysLeft: daysLeft(validUntil, now) };
  return { kind: 'licensed' };
}

function stateIsUsable(state) {
  return state.kind === 'trial' || state.kind === 'licensed' || state.kind === 'offline-grace';
}

// ─── Machine id ────────────────────────────────────────────────────────────

/** The operating system's own id for this computer, or '' when it can't be read. */
function readOsMachineId(platform = process.platform) {
  const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    if (platform === 'darwin') {
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']));
      return m ? m[1] : '';
    }
    if (platform === 'win32') {
      const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']));
      return m ? m[1] : '';
    }
    for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const id = nodeFs.readFileSync(file, 'utf8').trim();
        if (id) return id;
      } catch { /* try the next */ }
    }
  } catch { /* fall through */ }
  return '';
}

function hashMachineId(osId, installId) {
  return nodeCrypto.createHash('sha256').update(`ghost-arcade-machine-v1|${osId}|${installId}`).digest('hex');
}

// ─── Keys and URLs ─────────────────────────────────────────────────────────

/** A licence key as typed or pasted: trimmed, upper case, no spaces. Null if it can't be one. */
function normalizeLicenceKey(raw) {
  const key = String(raw ?? '').replace(/\s+/g, '').toUpperCase();
  return key.length >= 8 && key.length <= 200 && /^[A-Z0-9-]+$/.test(key) ? key : null;
}

function maskLicenceKey(key) {
  const parts = String(key).split('-');
  if (parts.length < 3) return `…${String(key).slice(-4)}`;
  return [parts[0], ...parts.slice(1, -1).map(() => '••••'), parts[parts.length - 1]].join('-');
}

/** The licence server: always ghostarcade.live in a packaged app; GA_LICENCE_API may point a development run elsewhere. */
function resolveApiBase({ isPackaged, env }) {
  const raw = !isPackaged ? String(env?.GA_LICENCE_API ?? '').trim() : '';
  if (!raw) return PRODUCTION_API;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin;
  } catch { /* not a URL */ }
  return PRODUCTION_API;
}

// ─── The store ─────────────────────────────────────────────────────────────

function createAddonEntitlements({
  userDataDir,
  isPackaged,
  env = process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  osMachineId = () => readOsMachineId(),
  hostname = () => nodeOs.hostname(),
  fs = nodeFs,
  keys = null,
  log = console,
} = {}) {
  const dir = nodePath.join(userDataDir, 'licence');
  const file = (name) => nodePath.join(dir, name);
  const trusted = keys ?? trustedLicenceKeys({ isPackaged: !!isPackaged });
  const apiBase = resolveApiBase({ isPackaged: !!isPackaged, env });
  /** Add-ons usable at some point in this run: they stay usable until quit. */
  const usedThisRun = new Set();
  let machineIdCache = null;
  /** @type {Promise<unknown> | null} */
  let refreshing = null;

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  function readJson(name) {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return null; }
  }
  function writeJson(name, value) {
    ensureDir();
    writeFileAtomicSync(file(name), JSON.stringify(value, null, 2), { fs });
    try { fs.chmodSync(file(name), 0o600); } catch { /* not on every file system */ }
  }
  function remove(name) {
    try { fs.rmSync(file(name), { force: true }); } catch { /* already gone */ }
  }

  function machineId() {
    if (machineIdCache) return machineIdCache;
    let installId = '';
    try { installId = fs.readFileSync(file('install-id'), 'utf8').trim(); } catch { /* first run */ }
    if (!/^[0-9a-f]{32}$/.test(installId)) {
      installId = nodeCrypto.randomBytes(16).toString('hex');
      try {
        ensureDir();
        writeFileAtomicSync(file('install-id'), installId, { fs });
      } catch (err) {
        log.warn?.('[Add-ons] could not save the install id:', err?.message ?? err);
      }
    }
    let osId = '';
    try { osId = String(osMachineId() || ''); } catch { osId = ''; }
    machineIdCache = hashMachineId(osId, installId);
    return machineIdCache;
  }

  function readMeta() {
    const raw = readJson('meta.json') || {};
    const trials = raw.trials && typeof raw.trials === 'object' ? raw.trials : {};
    return {
      lastSeenAt: Number.isFinite(raw.lastSeenAt) ? raw.lastSeenAt : 0,
      lastRefreshAttemptAt: Number.isFinite(raw.lastRefreshAttemptAt) ? raw.lastRefreshAttemptAt : 0,
      emergency: raw.emergency && typeof raw.emergency.licenceId === 'string' && Number.isFinite(raw.emergency.until) ? raw.emergency : null,
      emergencyUsed: Array.isArray(raw.emergencyUsed) ? raw.emergencyUsed.filter((x) => typeof x === 'string').slice(-16) : [],
      trials: Object.fromEntries(Object.entries(trials).filter(([, v]) => Number.isFinite(v)).slice(-MAX_TRIALS_REMEMBERED)),
    };
  }
  function writeMeta(meta) {
    try { writeJson('meta.json', meta); } catch (err) { log.warn?.('[Add-ons] could not save licence state:', err?.message ?? err); }
  }

  function storedKey() {
    const raw = readJson('licence.json');
    return raw ? normalizeLicenceKey(raw.licenceKey) : null;
  }

  /** The stored entitlement, checked: `{ payload }`, or `{ payload: null, problem }`. */
  function storedEntitlement() {
    const raw = readJson('entitlement.json');
    if (!raw || !raw.entitlement) return { payload: null, problem: null };
    const checked = verifyEntitlement(raw.entitlement, trusted);
    if (!checked.ok) return { payload: null, problem: checked.reason };
    if (checked.payload.machine_id !== machineId()) return { payload: null, problem: 'other-computer' };
    return { payload: checked.payload, problem: null };
  }

  /** Never earlier than a time this computer already saw, so turning the clock back gains nothing. */
  function clock(meta) {
    return Math.max(now(), meta.lastSeenAt);
  }

  function rememberTrials(meta, payload) {
    for (const p of payload.products) {
      if (p && p.kind === 'trial' && typeof p.id === 'string') {
        const end = Date.parse(p.expires_at ?? '');
        if (Number.isFinite(end)) meta.trials[p.id] = end;
      }
    }
    const entries = Object.entries(meta.trials);
    if (entries.length > MAX_TRIALS_REMEMBERED) meta.trials = Object.fromEntries(entries.slice(-MAX_TRIALS_REMEMBERED));
  }

  /** Store a fresh entitlement from the website (already verified for this machine). */
  function accept(envelope, payload, key) {
    const meta = readMeta();
    writeJson('entitlement.json', { entitlement: envelope });
    if (key) writeJson('licence.json', { licenceKey: key });
    // The server's clock is the truth: a clock set wrongly ahead earlier no longer counts.
    meta.lastSeenAt = Date.parse(payload.issued_at);
    meta.lastRefreshAttemptAt = now();
    if (meta.emergency && meta.emergency.licenceId === payload.licence_id) meta.emergency = null;
    rememberTrials(meta, payload);
    writeMeta(meta);
  }

  function status() {
    const meta = readMeta();
    const at = clock(meta);
    const { payload, problem } = storedEntitlement();
    const key = storedKey();
    const emergencyUntil = payload && meta.emergency?.licenceId === payload.licence_id ? meta.emergency.until : 0;
    const products = {};
    let offlineDaysLeft = null;
    let needsExtension = false;
    for (const id of ADDON_PRODUCTS) {
      const state = addonState({ payload, productId: id, now: at, emergencyUntil, trialEndsAt: meta.trials[id] ?? null });
      if (stateIsUsable(state)) usedThisRun.add(id);
      if (state.kind === 'offline-grace') offlineDaysLeft = Math.min(offlineDaysLeft ?? Infinity, state.daysLeft);
      if (state.kind === 'offline-grace' || (state.kind === 'expired' && state.why === 'offline')) needsExtension = true;
      products[id] = { state, usable: stateIsUsable(state) || usedThisRun.has(id) };
    }
    const extensionUsed = !!payload && meta.emergencyUsed.includes(payload.licence_id);
    return {
      products,
      licence: payload || key ? {
        key: key ? maskLicenceKey(key) : null,
        email: payload?.email ?? null,
        checkedAt: payload?.issued_at ?? null,
        validUntil: payload ? new Date(Math.max(Date.parse(payload.valid_until), emergencyUntil)).toISOString() : null,
        emergency: {
          available: !!payload && needsExtension && !extensionUsed,
          until: emergencyUntil ? new Date(emergencyUntil).toISOString() : null,
        },
      } : null,
      problem,
      offlineDaysLeft,
      machine: { name: safeHostname(), id: machineId().slice(0, 8) },
      server: apiBase === PRODUCTION_API ? null : apiBase,
    };
  }

  function safeHostname() {
    try { return String(hostname() || '').slice(0, 120); } catch { return ''; }
  }

  async function post(path, body, extraHeaders = {}) {
    let res;
    try {
      res = await fetchImpl(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...extraHeaders },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { network: true, status: 0, body: null };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { network: false, status: res.status, body: data && typeof data === 'object' ? data : null };
  }

  /** A failed reply as the code the renderer words. */
  function failure(reply) {
    if (reply.network) return { ok: false, code: 'network' };
    const code = typeof reply.body?.code === 'string' ? reply.body.code : null;
    if (code === 'machine_limit') {
      const machines = Array.isArray(reply.body.machines) ? reply.body.machines.slice(0, 20).map((m) => ({
        id: String(m?.id ?? ''),
        hostname: m?.hostname ? String(m.hostname).slice(0, 120) : null,
        activatedAt: m?.activated_at ?? null,
        lastSeenAt: m?.last_seen_at ?? null,
      })).filter((m) => m.id) : [];
      return { ok: false, code, maxMachines: Number(reply.body.maxMachines) || 2, machines };
    }
    if (code) return { ok: false, code };
    if (reply.status === 404) return { ok: false, code: 'invalid_key' };
    if (reply.status === 400) return { ok: false, code: 'bad_request' };
    return { ok: false, code: 'server' };
  }

  /** Check a reply's entitlement before anything is stored. */
  function checkReply(envelope) {
    const checked = verifyEntitlement(envelope, trusted);
    if (!checked.ok) {
      log.warn?.('[Add-ons] the licence server sent an entitlement that does not check out:', checked.reason);
      return null;
    }
    if (checked.payload.machine_id !== machineId()) return null;
    return checked.payload;
  }

  async function activate(rawKey) {
    const key = normalizeLicenceKey(rawKey);
    if (!key) return { ok: false, code: 'bad_key' };
    const reply = await post('/api/license/activate', { licenseKey: key, machineId: machineId(), hostname: safeHostname(), v: 2 });
    if (reply.status !== 200 || !reply.body?.ok) return failure(reply);
    const payload = checkReply(reply.body.entitlement);
    if (!payload) return { ok: false, code: 'bad_reply' };
    accept(reply.body.entitlement, payload, key);
    return { ok: true, status: status() };
  }

  /** Free one of the licence's other computers (from a machine_limit reply), then activate here. */
  async function freeSeatAndActivate(rawKey, machineRecordId) {
    const key = normalizeLicenceKey(rawKey);
    if (!key) return { ok: false, code: 'bad_key' };
    if (!/^[0-9a-f-]{36}$/i.test(String(machineRecordId ?? ''))) return { ok: false, code: 'bad_request' };
    const reply = await post('/api/license/deactivate', { licenseKey: key, machineRecordId });
    if (reply.status !== 200 || !reply.body?.success) return failure(reply);
    return activate(key);
  }

  /** Ask the website again now. Keeps what is stored when it can't be reached. */
  async function validate() {
    const key = storedKey();
    if (!key) return { ok: false, code: 'no_key' };
    const meta = readMeta();
    meta.lastRefreshAttemptAt = now();
    writeMeta(meta);
    const reply = await post('/api/license/validate', { licenseKey: key, machineId: machineId(), v: 2 });
    if (reply.network || reply.status >= 500 || reply.status === 0) return { ok: false, code: reply.network ? 'network' : 'server' };
    if (reply.status === 200 && reply.body?.valid === true) {
      const payload = checkReply(reply.body.entitlement);
      if (!payload) return { ok: false, code: 'bad_reply' };
      accept(reply.body.entitlement, payload, null);
      return { ok: true, status: status() };
    }
    const code = typeof reply.body?.code === 'string' ? reply.body.code : 'server';
    if (code === 'invalid_key') {
      remove('entitlement.json');
      remove('licence.json');
    } else if (code === 'licence_inactive' || code === 'machine_not_activated') {
      remove('entitlement.json');
    }
    return { ok: false, code };
  }

  function refreshDue() {
    if (refreshing || !storedKey()) return false;
    const meta = readMeta();
    if (now() - meta.lastRefreshAttemptAt < REFRESH_RETRY_MS) return false;
    const { payload } = storedEntitlement();
    return !payload || clock(meta) >= Date.parse(payload.refresh_after);
  }

  /**
   * The look the app takes when it starts and when it opens a project: the
   * status now, and a quiet refresh in the background when one is due. What
   * the refresh brings counts from the next look.
   */
  function checkpoint() {
    const current = status();
    if (refreshDue()) {
      refreshing = validate()
        .catch((err) => { log.warn?.('[Add-ons] licence refresh failed:', err?.message ?? err); })
        .finally(() => { refreshing = null; });
    }
    const meta = readMeta();
    const at = clock(meta);
    if (at > meta.lastSeenAt) {
      meta.lastSeenAt = at;
      writeMeta(meta);
    }
    return current;
  }

  /** "Check again" in Settings and after a trial started on the website. */
  async function refresh() {
    if (refreshing) await refreshing;
    const result = await validate();
    return result.ok ? result : { ...result, status: status() };
  }

  async function deactivate() {
    const key = storedKey();
    if (!key) {
      remove('entitlement.json');
      return { ok: true, status: status() };
    }
    const reply = await post('/api/license/deactivate', { licenseKey: key, machineId: machineId() });
    if (!(reply.status === 200 && reply.body?.success) && reply.status !== 404) return failure(reply);
    remove('entitlement.json');
    remove('licence.json');
    return { ok: true, status: status() };
  }

  /** The one 14-day extension per licence, for a computer that has been offline too long. */
  function useEmergencyExtension() {
    const current = status();
    if (!current.licence?.emergency.available) return { ok: false, code: 'not_available' };
    const { payload } = storedEntitlement();
    const meta = readMeta();
    meta.emergency = { licenceId: payload.licence_id, until: clock(meta) + EMERGENCY_DAYS * DAY_MS };
    meta.emergencyUsed = [...meta.emergencyUsed.filter((id) => id !== payload.licence_id), payload.licence_id].slice(-16);
    writeMeta(meta);
    return { ok: true, status: status() };
  }

  return { status, checkpoint, activate, freeSeatAndActivate, refresh, deactivate, useEmergencyExtension, machineId, apiBase };
}

module.exports = {
  ADDON_PRODUCTS,
  DAY_MS,
  WARN_AFTER_DAYS,
  EMERGENCY_DAYS,
  PRODUCTION_API,
  addonState,
  stateIsUsable,
  verifyEntitlement,
  hashMachineId,
  normalizeLicenceKey,
  maskLicenceKey,
  resolveApiBase,
  readOsMachineId,
  createAddonEntitlements,
};
