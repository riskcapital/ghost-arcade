'use strict';

/**
 * Pairing for the LAN remote, and the token checks the loopback MCP server
 * shares with it.
 *
 * The remote's WebSocket and HTTP servers listen on every interface so a phone
 * can reach them, which at a gig means everyone on the venue Wi-Fi can too.
 * A paired device proves itself with a token the desktop generates once per
 * install and shows beside the Connect Mobile QR code. It persists so a phone
 * paired last week still connects after a restart, and resetting it is how
 * every paired device gets cut off at once.
 *
 * CommonJS so the ESM server, the CommonJS MCP server and the tests can all
 * load the one copy.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Crockford base32. No I, L, O or U, so a code read off the screen and typed
// into a phone survives the usual misreadings (see normalizePairingToken).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// 16 characters is 80 bits. Guessing that over the network is not a thing
// anyone finishes, and it is still short enough to type from the popup when
// a phone cannot scan.
const TOKEN_LENGTH = 16;

/** Query parameter a browser presents the token in. It cannot set headers on
 *  a WebSocket, and a QR code can only carry a URL. */
const PAIRING_QUERY_PARAM = 'pair';

/** Close code sent to every device when the token is reset. Application codes
 *  live in 4000-4999; this one echoes HTTP 401. */
const PAIRING_RESET_CLOSE_CODE = 4401;

function generatePairingToken() {
  const bytes = crypto.randomBytes(TOKEN_LENGTH);
  let token = '';
  // 256 is a multiple of 32, so masking to five bits keeps every character
  // equally likely.
  for (const byte of bytes) token += ALPHABET[byte & 31];
  return token;
}

/**
 * The canonical form of a token someone presented, or '' if it cannot be one.
 * Accepts what a person types: lower case, spaces, the dashes the popup
 * groups it with, and O/I/L for 0/1.
 */
function normalizePairingToken(input) {
  if (typeof input !== 'string' || input.length > 64) return '';
  const token = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (token.length !== TOKEN_LENGTH) return '';
  for (const ch of token) {
    if (!ALPHABET.includes(ch)) return '';
  }
  return token;
}

/**
 * Constant-time string comparison. A plain === stops at the first differing
 * character, which over enough attempts tells a guesser how much of a guess
 * was right.
 */
function tokensEqual(expected, presented) {
  if (typeof expected !== 'string' || !expected || typeof presented !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length) {
    // timingSafeEqual throws on unequal lengths. The length is not the secret,
    // but the work is kept the same shape either way.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function pairingTokenMatches(expected, presented) {
  return tokensEqual(expected, normalizePairingToken(presented));
}

/** The credentials of an `Authorization: Bearer <token>` header, or ''. */
function bearerToken(header) {
  if (typeof header !== 'string') return '';
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return match ? match[1] : '';
}

function readCookie(header, name) {
  if (typeof header !== 'string' || !name) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

/**
 * Where a request carries its token, first found wins: an Authorization
 * header (the desktop and scripts), the `pair` query parameter (browsers and
 * QR links), then, only where the caller allows it, a cookie. Cookies stay off
 * the WebSocket path: a browser attaches them to connections any page opens,
 * and the HTTP server only needs one so a page's own assets load.
 */
function presentedPairingToken(req, { cookieName } = {}) {
  const fromHeader = bearerToken(req?.headers?.authorization);
  if (fromHeader) return fromHeader;
  let fromQuery = '';
  try {
    fromQuery = new URL(req?.url || '/', 'http://localhost').searchParams.get(PAIRING_QUERY_PARAM) || '';
  } catch {
    // A request line that is not a URL carries no token.
  }
  if (fromQuery) return fromQuery;
  return cookieName ? readCookie(req?.headers?.cookie, cookieName) : '';
}

function readPairingToken(filePath) {
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizePairingToken(saved?.token);
  } catch {
    return '';
  }
}

function writePairingToken(filePath, token) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Write then rename, so a crash mid-write cannot leave a half file that
  // reads as no token and quietly unpairs everything on the next launch.
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

/** The install's token, created on first use. Throws if it cannot be saved. */
function loadOrCreatePairingToken(filePath) {
  const existing = readPairingToken(filePath);
  if (existing) return existing;
  const token = generatePairingToken();
  writePairingToken(filePath, token);
  return token;
}

module.exports = {
  PAIRING_QUERY_PARAM,
  PAIRING_RESET_CLOSE_CODE,
  TOKEN_LENGTH,
  bearerToken,
  generatePairingToken,
  loadOrCreatePairingToken,
  normalizePairingToken,
  pairingTokenMatches,
  presentedPairingToken,
  readCookie,
  readPairingToken,
  tokensEqual,
  writePairingToken,
};
