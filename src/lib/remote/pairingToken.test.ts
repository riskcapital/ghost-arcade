import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pairing = require(join(process.cwd(), 'server', 'pairing.cjs'));

/**
 * The pairing token is the only thing standing between a venue's Wi-Fi and
 * the show's output, so these pin down the properties that matter: codes a
 * person can type still match, near misses do not, a comparison never
 * short-circuits, and a token survives a restart until someone resets it.
 */

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/;

describe('pairing token format', () => {
  it('generates 16 Crockford base32 characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(pairing.generatePairingToken()).toMatch(CROCKFORD);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => pairing.generatePairingToken()));
    expect(seen.size).toBe(500);
  });

  it('accepts a code the way a person types it', () => {
    const token = 'ABCD0EFGH1JKMN2P';
    expect(pairing.normalizePairingToken('abcd-0efg-h1jk-mn2p')).toBe(token);
    expect(pairing.normalizePairingToken(' ABCD 0EFG H1JK MN2P ')).toBe(token);
    // O for zero and I or L for one: the alphabet has none of them, so a
    // misread can only mean the digit.
    expect(pairing.normalizePairingToken('ABCDOEFGHIJKMN2P')).toBe(token);
    expect(pairing.normalizePairingToken('ABCDoEFGHlJKMN2P')).toBe(token);
  });

  it('rejects anything that cannot be a token', () => {
    expect(pairing.normalizePairingToken('')).toBe('');
    expect(pairing.normalizePairingToken('ABCD')).toBe('');
    expect(pairing.normalizePairingToken('ABCD0EFGH1JKMN2PQ')).toBe('');
    expect(pairing.normalizePairingToken('ABCD0EFGH1JKMN2U')).toBe(''); // U is not in the alphabet
    expect(pairing.normalizePairingToken('ABCD0EFGH1JKMN2!')).toBe('');
    expect(pairing.normalizePairingToken('A'.repeat(10_000))).toBe('');
    expect(pairing.normalizePairingToken(null)).toBe('');
    expect(pairing.normalizePairingToken({ toString: () => 'ABCD0EFGH1JKMN2P' })).toBe('');
  });
});

describe('pairing token comparison', () => {
  afterEach(() => vi.restoreAllMocks());

  const token = pairing.generatePairingToken();

  it('matches the token and its typed forms', () => {
    expect(pairing.pairingTokenMatches(token, token)).toBe(true);
    expect(pairing.pairingTokenMatches(token, token.toLowerCase().replace(/(.{4})(?=.)/g, '$1-'))).toBe(true);
  });

  it('refuses a near miss, a wrong length and a missing token without throwing', () => {
    const lastChar = token.endsWith('0') ? '1' : '0';
    expect(pairing.pairingTokenMatches(token, token.slice(0, -1) + lastChar)).toBe(false);
    expect(pairing.pairingTokenMatches(token, token.slice(0, -1))).toBe(false);
    expect(pairing.pairingTokenMatches(token, '')).toBe(false);
    expect(pairing.pairingTokenMatches(token, undefined)).toBe(false);
    // No token configured yet matches nothing, not even an empty one.
    expect(pairing.pairingTokenMatches(null, '')).toBe(false);
    expect(pairing.pairingTokenMatches('', '')).toBe(false);
  });

  it('compares equal-length tokens with crypto.timingSafeEqual', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    const wrong = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    expect(pairing.tokensEqual(token, wrong)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    const [a, b] = spy.mock.calls[0];
    expect(Buffer.isBuffer(a) && Buffer.isBuffer(b)).toBe(true);
    expect((a as Buffer).length).toBe((b as Buffer).length);
  });
});

describe('where a request carries its token', () => {
  const req = (headers: Record<string, string>, url = '/') => ({ headers, url });

  it('reads a bearer header first, then ?pair=, then a cookie only when allowed', () => {
    expect(pairing.presentedPairingToken(req({ authorization: 'Bearer H' }, '/?pair=Q'))).toBe('H');
    expect(pairing.presentedPairingToken(req({ authorization: 'bearer   H  ' }))).toBe('H');
    expect(pairing.presentedPairingToken(req({}, '/x?pair=Q'))).toBe('Q');
    expect(pairing.presentedPairingToken(req({ cookie: 'a=1; ga_pair_9002=C' }), { cookieName: 'ga_pair_9002' })).toBe('C');
    // A browser attaches cookies to WebSockets any page opens, so the
    // WebSocket path never asks for them.
    expect(pairing.presentedPairingToken(req({ cookie: 'ga_pair_9002=C' }))).toBe('');
  });

  it('ignores other auth schemes and malformed request lines', () => {
    expect(pairing.presentedPairingToken(req({ authorization: 'Basic abc' }))).toBe('');
    expect(pairing.presentedPairingToken(req({}, 'http://['))).toBe('');
    expect(pairing.presentedPairingToken({})).toBe('');
  });
});

describe('pairing token persistence', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ga-pairing-test-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('creates a token once and returns it on every later start', () => {
    const file = join(dir, 'nested', 'remote-pairing.json');
    const first = pairing.loadOrCreatePairingToken(file);
    expect(first).toMatch(CROCKFORD);
    expect(pairing.loadOrCreatePairingToken(file)).toBe(first);
    expect(pairing.readPairingToken(file)).toBe(first);
  });

  it('keeps the file private to the user', () => {
    if (process.platform === 'win32') return; // POSIX modes only
    const file = join(dir, 'private.json');
    pairing.loadOrCreatePairingToken(file);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('replaces the token on reset', () => {
    const file = join(dir, 'reset.json');
    const before = pairing.loadOrCreatePairingToken(file);
    const after = pairing.generatePairingToken();
    pairing.writePairingToken(file, after);
    expect(pairing.loadOrCreatePairingToken(file)).toBe(after);
    expect(after).not.toBe(before);
  });

  it('starts over from a damaged file rather than accepting it', () => {
    const file = join(dir, 'damaged.json');
    fs.writeFileSync(file, '{"token": "not-a-token"');
    expect(pairing.loadOrCreatePairingToken(file)).toMatch(CROCKFORD);
  });
});
