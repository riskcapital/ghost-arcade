/**
 * The main-process PJLink credential store (electron/pjlink-credentials.cjs)
 * with a fake safeStorage: encrypted on disk, round trips across restarts,
 * plain text never written anywhere under the store's directory, and the
 * session-only path when encryption is unavailable.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeSafeStorage } from './pjlinkHarness.testutil';

const require = createRequire(import.meta.url);
const { createPjlinkCredentials } = require('../../../electron/pjlink-credentials.cjs');

const SECRET = 'Pr0jector-S3cret!';
const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ga-pjlink-store-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Every byte under `dir`, as text, for a plain-text search. */
function everythingOnDisk(dir: string): string {
  if (!existsSync(dir)) return '';
  return readdirSync(dir).map((f) => readFileSync(join(dir, f)).toString('latin1')).join('\n');
}

describe('PJLink credential store', () => {
  it('encrypts each password with safeStorage and never writes plain text', () => {
    const dir = tempDir();
    const safe = fakeSafeStorage(true);
    const store = createPjlinkCredentials({ safeStorage: safe, dir });
    expect(store.set('proj-1', SECRET)).toEqual({ ok: true, persisted: true });
    expect(safe.state.encryptCalls).toBe(1);
    const disk = everythingOnDisk(dir);
    expect(disk).not.toContain(SECRET);
    expect(disk).not.toContain(Buffer.from(SECRET).toString('base64'));
    const saved = JSON.parse(readFileSync(store.file, 'utf8'));
    expect(Object.keys(saved.entries)).toEqual(['proj-1']);
    expect(safe.decryptString(Buffer.from(saved.entries['proj-1'], 'base64'))).toBe(SECRET);
    if (process.platform !== 'win32') expect(statSync(store.file).mode & 0o777).toBe(0o600);
    // No temp file left behind.
    expect(readdirSync(dir)).toEqual(['pjlink-credentials.json']);
  });

  it('round-trips across a restart, and an empty password deletes', () => {
    const dir = tempDir();
    const safe = fakeSafeStorage(true);
    createPjlinkCredentials({ safeStorage: safe, dir }).set('proj-1', SECRET);
    const restarted = createPjlinkCredentials({ safeStorage: safe, dir });
    expect(restarted.has('proj-1')).toEqual({ ok: true, has: true, persisted: true });
    expect(restarted.get('proj-1')).toBe(SECRET);
    expect(restarted.set('proj-1', '')).toEqual({ ok: true, persisted: true });
    expect(restarted.has('proj-1').has).toBe(false);
    expect(createPjlinkCredentials({ safeStorage: safe, dir }).get('proj-1')).toBe('');
  });

  it('without encryption keeps the password for the session only and writes nothing', () => {
    const dir = tempDir();
    const safe = fakeSafeStorage(false);
    const store = createPjlinkCredentials({ safeStorage: safe, dir });
    expect(store.set('proj-1', SECRET)).toEqual({ ok: true, persisted: false });
    expect(store.has('proj-1')).toEqual({ ok: true, has: true, persisted: false });
    expect(store.get('proj-1')).toBe(SECRET);
    expect(safe.state.encryptCalls).toBe(0);
    expect(everythingOnDisk(dir)).not.toContain(SECRET);
    const restarted = createPjlinkCredentials({ safeStorage: safe, dir });
    expect(restarted.get('proj-1')).toBe('');
    expect(restarted.has('proj-1').has).toBe(false);
  });

  it('falls back to session-only, not plain text, when encryption throws', () => {
    const dir = tempDir();
    const safe = fakeSafeStorage(true);
    safe.encryptString = () => { throw new Error('keychain locked'); };
    const store = createPjlinkCredentials({ safeStorage: safe, dir });
    const r = store.set('proj-1', SECRET);
    expect(r).toMatchObject({ ok: true, persisted: false });
    expect(store.get('proj-1')).toBe(SECRET);
    expect(everythingOnDisk(dir)).not.toContain(SECRET);
  });

  it('ciphertext it can no longer decrypt counts as no password', () => {
    const dir = tempDir();
    const safe = fakeSafeStorage(true);
    createPjlinkCredentials({ safeStorage: safe, dir }).set('proj-1', SECRET);
    safe.state.available = false;
    const later = createPjlinkCredentials({ safeStorage: safe, dir });
    expect(later.has('proj-1').has).toBe(false);
    expect(later.get('proj-1')).toBe('');
  });

  it('rejects bad ids and oversized or non-text passwords', () => {
    const store = createPjlinkCredentials({ safeStorage: fakeSafeStorage(true), dir: tempDir() });
    expect(store.set('', 'x').ok).toBe(false);
    expect(store.set('../../etc', 'x').ok).toBe(false);
    expect(store.set('p', 'x'.repeat(300)).ok).toBe(false);
    expect(store.set('p', 42 as unknown as string).ok).toBe(false);
    expect(store.has('../x')).toEqual({ ok: false, has: false, persisted: false });
    expect(store.get('nope')).toBe('');
  });
});
