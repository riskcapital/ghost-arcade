/**
 * LAN remote pairing, renderer side.
 *
 * The remote's servers (server/ws-server.js) only let in devices that present
 * the install's pairing token. The desktop gets it from main and presents it on
 * its own connection, shows it beside the Connect Mobile QR code, and puts it
 * in the QR link. The phone keeps it after the first scan so it reconnects on
 * its own, and asks the server whether a refused connection was the token's
 * fault, because a browser will not say why a WebSocket handshake failed.
 *
 * The server side, and the token format, are in server/pairing.cjs.
 */

export interface RemotePairingInfo {
  token: string;
  wsPort: number;
  httpPort: number;
}

/** Where the desktop app looks when main does not say otherwise. */
export const DEFAULT_REMOTE_WS_PORT = 9001;
export const DEFAULT_REMOTE_HTTP_PORT = 9002;

/** Query parameter the servers read the token from. Matches server/pairing.cjs. */
export const PAIRING_QUERY_PARAM = 'pair';

/** Close code the server sends every device when the token is reset.
 *  Matches server/pairing.cjs. */
export const PAIRING_RESET_CLOSE_CODE = 4401;

export const UNPAIRED_MESSAGE = "This device isn't paired. Scan the QR code in Ghost Arcade to pair it again.";

interface RemotePairingBridge {
  info(): Promise<unknown>;
  reset(): Promise<unknown>;
}

function bridge(): RemotePairingBridge | null {
  if (typeof window === 'undefined') return null;
  return ((window as any).ghostRemote as RemotePairingBridge | undefined) ?? null;
}

function portOr(value: unknown, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function toInfo(raw: unknown): RemotePairingInfo | null {
  const r = raw as Partial<RemotePairingInfo> | null;
  if (!r || typeof r.token !== 'string' || !r.token) return null;
  return {
    token: r.token,
    wsPort: portOr(r.wsPort, DEFAULT_REMOTE_WS_PORT),
    httpPort: portOr(r.httpPort, DEFAULT_REMOTE_HTTP_PORT),
  };
}

/** Browser-only development can pair through an explicit URL from its server. */
function browserPairingInfo(): RemotePairingInfo | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location?.search ?? '');
  const token = cleanPairingCode(params.get(PAIRING_QUERY_PARAM) || recallPairingToken());
  if (!token) return null;
  if (params.has(PAIRING_QUERY_PARAM)) rememberPairingToken(token);
  return { token, wsPort: portOr(params.get('ws'), DEFAULT_REMOTE_WS_PORT),
    httpPort: portOr(params.get('http'), DEFAULT_REMOTE_HTTP_PORT) };
}

let infoRequest: Promise<RemotePairingInfo | null> | null = null;

/** The token and ports from main, or null outside the desktop app. */
export function getRemotePairingInfo(): Promise<RemotePairingInfo | null> {
  if (!infoRequest) {
    const api = bridge();
    infoRequest = api
      ? api.info().then(toInfo, (err) => {
          console.warn('[Remote] Could not read the pairing token:', err);
          infoRequest = null; // let the next caller try again
          return null;
        })
      : Promise.resolve(browserPairingInfo());
  }
  return infoRequest;
}

/** Issue a new token. Every paired device is disconnected and has to pair again. */
export async function resetRemotePairing(): Promise<RemotePairingInfo | null> {
  const api = bridge();
  if (!api) return null;
  const info = toInfo(await api.reset());
  if (info) infoRequest = Promise.resolve(info);
  return info;
}

/** The token as a person reads and types it: XXXX-XXXX-XXXX-XXXX. */
export function formatPairingCode(token: string): string {
  return cleanPairingCode(token).replace(/(.{4})(?=.)/g, '$1-');
}

/** Strip what a person adds when typing a code. The server does the rest. */
export function cleanPairingCode(input: string): string {
  return String(input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** `url` with the token added as ?pair=, which is how a browser has to send it. */
export function withPairingToken(url: string, token: string | null | undefined): string {
  if (!token) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(PAIRING_QUERY_PARAM, token);
    return parsed.toString();
  } catch {
    // Not a URL; whoever opens it will report that.
    return url;
  }
}

/** The /pair/check URL on the same host and port as a remote WebSocket URL. */
export function pairingCheckUrl(wsUrl: string, token: string): string | null {
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/pair/check';
    url.search = '';
    url.hash = '';
    url.searchParams.set(PAIRING_QUERY_PARAM, token);
    return url.toString();
  } catch {
    return null;
  }
}

export type PairingCheck = 'paired' | 'unpaired' | 'unreachable';

/**
 * Ask the server whether `token` would be accepted. A browser reports a
 * refused WebSocket exactly like an unreachable one, so this is how a phone
 * tells "not paired any more" from "not on the same network".
 */
export async function checkPairing(wsUrl: string, token: string, timeoutMs = 4000): Promise<PairingCheck> {
  const url = pairingCheckUrl(wsUrl, token);
  if (!url) return 'unreachable';
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401) return 'unpaired';
    return res.ok ? 'paired' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * fetch() against this machine's remote HTTP server (the shader library API
 * and /info), with the token it now requires.
 */
export async function localServerFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const info = await getRemotePairingInfo();
  const headers = new Headers(init.headers);
  if (info) headers.set('Authorization', `Bearer ${info.token}`);
  const port = info?.httpPort ?? DEFAULT_REMOTE_HTTP_PORT;
  return fetch(`http://localhost:${port}${pathname}`, { ...init, headers });
}

// The phone keeps its token in localStorage so it survives reloads and
// reconnects without another scan. One slot is enough: in a browser each
// desktop serves the page from its own address and so gets its own storage,
// and the native app talks to one desktop at a time.
const TOKEN_STORAGE_KEY = 'ghost-arcade_pairing_token';

export function rememberPairingToken(token: string): boolean {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    return true;
  } catch {
    return false; // private browsing
  }
}

export function recallPairingToken(): string {
  try {
    return cleanPairingCode(localStorage.getItem(TOKEN_STORAGE_KEY) ?? '');
  } catch {
    return '';
  }
}

export function forgetPairingToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // private browsing
  }
}
