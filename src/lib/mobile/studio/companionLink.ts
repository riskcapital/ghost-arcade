// Desktop pairing links for the native app.
//
// A pairing link arrives from a QR scan, a paste or a ghostarcade:// deep link, any of which can be
// supplied by someone other than the performer. So a link is only ever decoded here (the WebView
// never navigates to it), it must point at a machine on the performer's own network, and the app
// asks "Connect to <host>?" before it leaves the standalone set. The wire protocol is untouched:
// the same http://<host>:<port>/?pair=<code>&ws=<port> link every released desktop shows.

const NOT_A_LINK = 'That is not a pairing link. Scan the QR code or paste the link from Connect Mobile on your desktop.';

function ipv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const bytes = parts.map(Number);
  return bytes.every((b) => b <= 255) ? bytes : null;
}

/**
 * True for a host that can only be on the performer's own machine or local network: loopback,
 * the private and link-local IPv4 ranges, carrier-grade NAT (100.64/10, used by mesh VPNs),
 * IPv6 loopback, unique-local and link-local, and .local (mDNS) names.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1') return true;
    const first = parseInt(v6.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  const v4 = ipv4(host);
  if (v4) {
    const [a, b] = v4;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  // Anything else that is all digits and dots is not an address we recognise.
  if (/^[\d.]+$/.test(host)) return false;
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
}

/** Decode only pairing links, never navigate the app WebView to supplied content. */
export function parseCompanionLink(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
    if (u.protocol === 'ghostarcade:') {
      if (u.hostname !== 'pair') throw Error('This is not a desktop pairing link.');
      u = new URL(u.searchParams.get('url') || '');
    }
  } catch (e) {
    // The platform's own message ("Failed to construct 'URL': Invalid URL") means nothing to a performer.
    throw Error(e instanceof Error && e.message === 'This is not a desktop pairing link.' ? e.message : NOT_A_LINK);
  }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || u.username || u.password) throw Error('Use the pairing link from Connect Mobile on your desktop.');
  const token = (u.searchParams.get('pair') || '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8,128}$/.test(token)) throw Error('The link is missing a valid desktop pairing code.');
  const port = u.searchParams.get('ws');
  if (port && (!/^\d+$/.test(port) || +port < 1 || +port > 65535)) throw Error('Invalid desktop connection port.');
  if (!isLocalNetworkHost(u.hostname)) throw Error(`This link points to ${u.hostname}, which is not on your local network. Ghost Arcade only pairs with a desktop on the same Wi-Fi.`);
  u.search = '';
  u.searchParams.set('pair', token);
  if (port) u.searchParams.set('ws', port);
  u.pathname = '/';
  u.hash = '/mobile';
  return u.toString();
}

/** The desktop's address as shown in "Connect to <host>?". */
export function companionHost(link: string): string {
  try { return new URL(link).hostname.replace(/^\[|\]$/g, ''); } catch { return ''; }
}

// The companion remembers one desktop: its WebSocket address and pairing code, both written only
// after a connection has succeeded (see MobileApp.svelte).
const TOKEN_KEY = 'ghost-arcade_pairing_token';
const SERVER_KEY = 'ghost-arcade_server_url';
type Store = Pick<Storage, 'getItem' | 'removeItem'>;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };

/** The desktop this device last connected to, as a pairing link ready to confirm, or null. */
export function rememberedDesktop(storage: Store | null = store()): { host: string; link: string } | null {
  try {
    const token = (storage?.getItem(TOKEN_KEY) || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const server = storage?.getItem(SERVER_KEY);
    if (!token || !server) return null;
    const ws = new URL(server);
    const page = new URL(`${ws.protocol === 'wss:' ? 'https' : 'http'}://${ws.host}/`);
    page.port = '';
    page.searchParams.set('pair', token);
    if (ws.port) page.searchParams.set('ws', ws.port);
    const link = parseCompanionLink(page.toString());
    return { host: companionHost(link), link };
  } catch {
    return null;
  }
}

/**
 * The remembered desktop's WebSocket address with its pairing code, for a short job of its own
 * (sending a saved scan) while the standalone studio stays on screen. Null when no desktop is
 * remembered or the stored address is not on the local network.
 */
export function rememberedDesktopSocket(storage: Store | null = store()): { host: string; url: string } | null {
  try {
    const token = (storage?.getItem(TOKEN_KEY) || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const server = storage?.getItem(SERVER_KEY);
    if (!/^[A-Z0-9]{8,128}$/.test(token) || !server) return null;
    const ws = new URL(server);
    if (!['ws:', 'wss:'].includes(ws.protocol) || ws.username || ws.password || !isLocalNetworkHost(ws.hostname)) return null;
    ws.pathname = '/';
    ws.hash = '';
    ws.search = '';
    ws.searchParams.set('pair', token);
    return { host: ws.hostname.replace(/^\[|\]$/g, ''), url: ws.toString() };
  } catch {
    return null;
  }
}

/** Remove the remembered desktop and its pairing code from this device. */
export function forgetDesktop(storage: Store | null = store()): void {
  try { storage?.removeItem(TOKEN_KEY); storage?.removeItem(SERVER_KEY); } catch { /* storage unavailable */ }
}
