/**
 * PJLink passwords, kept on this computer and out of project files.
 *
 * Projects travel between machines and people, so a projector in a project
 * carries only `hasPassword`. The secret lives here, keyed by projector id,
 * in userData/pjlink-credentials.json, each value encrypted with Electron's
 * safeStorage (Keychain on macOS, DPAPI on Windows, the secret service on
 * Linux).
 *
 * When encryption is not available (Linux without a keyring) the password is
 * held in memory for this session only and reported as persisted: false.
 * Plain text is never written to disk.
 *
 * Nothing here ever hands a password back to the renderer: the IPC surface
 * is set and has; only the PJLink client in this process reads them.
 */

'use strict';

const nodeFs = require('fs');
const nodePath = require('path');

const FILE_NAME = 'pjlink-credentials.json';
const MAX_PASSWORD_LENGTH = 256;

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[\w.:-]+$/.test(id);
}

function createPjlinkCredentials({ safeStorage, dir, fs = nodeFs, path = nodePath } = {}) {
  const file = path.join(dir, FILE_NAME);
  /** id -> base64 ciphertext, as on disk. Loaded on first use. */
  let entries = null;
  /** id -> password, for the session only (no encryption available). */
  const memory = new Map();

  function encryptionAvailable() {
    try {
      return !!(safeStorage && safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function load() {
    if (entries) return entries;
    entries = {};
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') {
        for (const [id, value] of Object.entries(raw.entries)) {
          if (validId(id) && typeof value === 'string' && value) entries[id] = value;
        }
      }
    } catch {
      /* no file yet, or unreadable: start empty */
    }
    return entries;
  }

  function save() {
    const body = JSON.stringify({ version: 1, entries: load() }, null, 2);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    file,

    /** Store (or, with an empty password, delete) a projector's password. */
    set(projectorId, password) {
      if (!validId(projectorId)) return { ok: false, persisted: false, error: 'invalid projector id' };
      if (password !== undefined && password !== null && typeof password !== 'string') {
        return { ok: false, persisted: false, error: 'password must be text' };
      }
      const pw = password || '';
      if (pw.length > MAX_PASSWORD_LENGTH) return { ok: false, persisted: false, error: 'password too long' };
      const store = load();
      if (!pw) {
        memory.delete(projectorId);
        if (store[projectorId]) {
          delete store[projectorId];
          try { save(); } catch (err) { return { ok: false, persisted: false, error: String(err && err.message || err) }; }
        }
        return { ok: true, persisted: true };
      }
      if (encryptionAvailable()) {
        try {
          store[projectorId] = safeStorage.encryptString(pw).toString('base64');
          save();
          memory.delete(projectorId);
          return { ok: true, persisted: true };
        } catch (err) {
          delete store[projectorId];
          // Fall through to session-only rather than lose the password.
          memory.set(projectorId, pw);
          return { ok: true, persisted: false, error: String(err && err.message || err) };
        }
      }
      // No encryption: session only. Drop any stale ciphertext we could not
      // decrypt anyway, so has() tells the truth.
      memory.set(projectorId, pw);
      return { ok: true, persisted: false };
    },

    /** Whether a password is stored, and whether it survives a restart. */
    has(projectorId) {
      if (!validId(projectorId)) return { ok: false, has: false, persisted: false };
      if (memory.has(projectorId)) return { ok: true, has: true, persisted: false };
      // Ciphertext we cannot decrypt (keyring gone) is as good as none.
      const stored = !!load()[projectorId] && encryptionAvailable();
      return { ok: true, has: stored, persisted: stored };
    },

    /** Main process only: the password for a PJLink session, or ''. */
    get(projectorId) {
      if (!validId(projectorId)) return '';
      if (memory.has(projectorId)) return memory.get(projectorId);
      const cipher = load()[projectorId];
      if (!cipher || !encryptionAvailable()) return '';
      try {
        return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
      } catch {
        return '';
      }
    },
  };
}

module.exports = { createPjlinkCredentials, FILE_NAME };
