import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

/**
 * Drives the real remote server (server/ws-server.js) over real sockets, the
 * way a phone or a stranger on the venue Wi-Fi would. The property worth
 * holding onto: nothing reaches the show without the pairing token, and a
 * reset cuts off whoever held the old one, including connections already open.
 */

const TOKEN = 'ABCD0EFGH1JKMN2P';
const NEW_TOKEN = 'QRST3VWXY4Z56789';

let server: typeof import('../../../server/ws-server.js');
let wsPort = 0;
let httpPort = 0;
const quiet: Array<{ mockRestore(): void }> = [];

beforeAll(async () => {
  // Ephemeral ports, so this never collides with a running copy of the app.
  vi.stubEnv('GA_REMOTE_BIND_HOST', '127.0.0.1');
  vi.stubEnv('WS_PORT', '0');
  vi.stubEnv('HTTP_PORT', '0');
  vi.stubEnv('GA_PAIRING_TOKEN', '');
  quiet.push(vi.spyOn(console, 'log').mockImplementation(() => {}));
  quiet.push(vi.spyOn(console, 'warn').mockImplementation(() => {}));
  server = await import('../../../server/ws-server.js');
  ({ wsPort, httpPort } = await server.listening);
});

afterAll(() => {
  server?.shutdownServer({ force: true });
  for (const spy of quiet) spy.mockRestore();
  vi.unstubAllEnvs();
});

/** Resolves with the open socket, or the HTTP status the upgrade was refused with. */
function openSocket(query = '', headers: Record<string, string> = {}): Promise<{ ws?: WebSocket; status?: number; received?: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/${query}`, { headers });
    // The server's greeting can arrive in the same read as the handshake, so
    // start listening before 'open' rather than after.
    const received: any[] = [];
    ws.on('message', (data) => received.push(JSON.parse(data.toString())));
    ws.once('open', () => resolve({ ws, received }));
    ws.once('error', (err) => {
      const status = /Unexpected server response: (\d+)/.exec(err.message)?.[1];
      resolve({ status: status ? Number(status) : -1 });
    });
  });
}

async function waitFor<T>(read: () => T | undefined, ms = 2000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

describe('before the desktop hands over a token', () => {
  it('refuses everyone', async () => {
    expect((await openSocket('?pair=')).status).toBe(401);
    const res = await fetch(`http://127.0.0.1:${httpPort}/info`);
    expect(res.status).toBe(401);
  });
});

describe('WebSocket upgrades', () => {
  beforeAll(() => server.setPairingToken(TOKEN));

  it('refuses an upgrade with no token or the wrong one', async () => {
    expect((await openSocket()).status).toBe(401);
    expect((await openSocket(`?pair=${NEW_TOKEN}`)).status).toBe(401);
    expect((await openSocket('', { Authorization: `Bearer ${NEW_TOKEN}` })).status).toBe(401);
  });

  it('never takes the token from a cookie', async () => {
    // Browsers attach cookies to sockets any page opens, so a cookie on this
    // path would let other sites' pages drive the show.
    expect((await openSocket('', { Cookie: `ga_pair_0=${TOKEN}; ga_pair_9002=${TOKEN}` })).status).toBe(401);
  });

  it('lets a paired device in, by query or bearer header, and syncs it', async () => {
    const byQuery = await openSocket(`?pair=${TOKEN.toLowerCase()}`);
    expect(byQuery.ws).toBeDefined();
    const sync = await waitFor(() => byQuery.received!.find((m) => m.type === 'sync'));
    expect(sync.project).toBeDefined();
    byQuery.ws!.close();

    const byHeader = await openSocket('', { Authorization: `Bearer ${TOKEN}` });
    expect(byHeader.ws).toBeDefined();
    byHeader.ws!.close();
  });

  it('relays control messages between paired devices', async () => {
    const desktop = await openSocket(`?pair=${TOKEN}`);
    const phone = (await openSocket(`?pair=${TOKEN}`)).ws!;
    phone.send(JSON.stringify({ type: 'set_vj_layer_opacity', layerIndex: 0, opacity: 0.25 }));
    const relayed = await waitFor(() => desktop.received!.find((m) => m.type === 'set_vj_layer_opacity'));
    expect(relayed).toMatchObject({ layerIndex: 0, opacity: 0.25 });
    desktop.ws!.close();
    phone.close();
  });

  it('still closes a connection that sends more than 10 MB at once', async () => {
    const { ws } = await openSocket(`?pair=${TOKEN}`);
    const code = closed(ws!);
    ws!.send('x'.repeat(10 * 1024 * 1024 + 1));
    expect(await code).toBe(1009); // Message Too Big
  });
});

describe('/pair/check on the WebSocket port', () => {
  beforeAll(() => server.setPairingToken(TOKEN));

  it('tells a browser whether its token is the problem', async () => {
    const refused = await fetch(`http://127.0.0.1:${wsPort}/pair/check?pair=${NEW_TOKEN}`);
    expect(refused.status).toBe(401);
    // Any page has to be able to read it: the phone's page is on another port.
    expect(refused.headers.get('access-control-allow-origin')).toBe('*');
    expect((await fetch(`http://127.0.0.1:${wsPort}/pair/check`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${wsPort}/pair/check?pair=${TOKEN}`)).status).toBe(204);
  });

  it('answers nothing else without a token', async () => {
    expect((await fetch(`http://127.0.0.1:${wsPort}/`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${wsPort}/?pair=${TOKEN}`)).status).toBe(426);
  });
});

describe('HTTP requests', () => {
  beforeAll(() => server.setPairingToken(TOKEN));

  it('refuses the API without a token', async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/info`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unpaired' });
    expect((await fetch(`http://127.0.0.1:${httpPort}/api/shaders`)).status).toBe(401);
  });

  it('shows a browser a page that says what to do', async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/`, { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(401);
    const page = await res.text();
    expect(page).toContain("This device isn't paired. Scan the QR code in Ghost Arcade to pair it again.");
    expect(page).toContain('name="pair"');
    expect(page).not.toContain(TOKEN);
  });

  it('accepts the desktop bearer header', async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/info`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('ips');
  });

  it('turns a QR link into a cookie so the rest of the page loads', async () => {
    const first = await fetch(`http://127.0.0.1:${httpPort}/?pair=${TOKEN}`, { headers: { Accept: 'text/html' } });
    expect(first.status).toBe(200);
    const cookie = first.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const pair = cookie.split(';')[0];
    expect(pair.endsWith(`=${TOKEN}`)).toBe(true);

    const asset = await fetch(`http://127.0.0.1:${httpPort}/info`, { headers: { Cookie: pair } });
    expect(asset.status).toBe(200);
  });

  it('refuses mutation requests with only a browser cookie', async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/api/shaders`, {
      method: 'POST', headers: { Cookie: `ga_pair_0=${TOKEN}`, 'Content-Type': 'text/plain' }, body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects malformed and escaping asset paths without crashing', async () => {
    for (const [path, status] of [['/%ZZ', 400], ['/%2e%2e%2fdist-other%2fsecret', 403]] as const) {
      const res = await fetch(`http://127.0.0.1:${httpPort}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(res.status).toBe(status);
    }
    expect((await fetch(`http://127.0.0.1:${httpPort}/info?pair=${TOKEN}`)).status).toBe(200);
  });

  it('answers a CORS preflight without a token and allows the Authorization header', async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/api/shaders`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:1420', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
  });
});

describe('resetting the token', () => {
  beforeAll(() => server.setPairingToken(TOKEN));

  it('disconnects devices paired with the old token, then refuses it', async () => {
    // Named after the configured port, which is '0' here.
    const cookie = `ga_pair_${process.env.HTTP_PORT}=${TOKEN}`;
    expect((await fetch(`http://127.0.0.1:${httpPort}/info`, { headers: { Cookie: cookie } })).status).toBe(200);
    const phone = (await openSocket(`?pair=${TOKEN}`)).ws!;
    const code = closed(phone);
    server.setPairingToken(NEW_TOKEN);
    expect(await code).toBe(4401);

    expect((await openSocket(`?pair=${TOKEN}`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${httpPort}/info`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${httpPort}/info`, { headers: { Cookie: cookie } })).status).toBe(401);

    const fresh = await openSocket(`?pair=${NEW_TOKEN}`);
    expect(fresh.ws).toBeDefined();
    fresh.ws!.close();
  });

  it('leaves connections alone when the token has not changed', async () => {
    const phone = (await openSocket(`?pair=${NEW_TOKEN}`)).ws!;
    server.setPairingToken(NEW_TOKEN.toLowerCase());
    await new Promise((r) => setTimeout(r, 50));
    expect(phone.readyState).toBe(WebSocket.OPEN);
    phone.close();
  });
});
