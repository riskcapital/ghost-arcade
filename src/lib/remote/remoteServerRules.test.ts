import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { importPhoneServer, type PhoneServer } from './phoneServerUnderTest';
import { WebSocket } from 'ws';
import net from 'node:net';

/**
 * Rules of the remote server the other server tests do not pin down, held
 * for both servers (GA_TEST_PHONE_SERVER=rust runs them on the Rust one):
 * the QR cookie flow, CORS, the handshake checks, a reset reaching a phone
 * that stalls its close, the rate limit, host replacement, the state a later
 * phone is synced with, and thumbnails pointed at this machine for the app.
 */

const TOKEN = 'ABCD0EFGH1JKMN2P';
const HOST = 'host-secret-'.repeat(6);
const OTHER = 'QRST3VWXY4Z56789';

let server: PhoneServer;
let wsPort = 0;
let httpPort = 0;
const quiet: Array<{ mockRestore(): void }> = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  vi.stubEnv('GA_REMOTE_BIND_HOST', '127.0.0.1');
  vi.stubEnv('WS_PORT', '0');
  vi.stubEnv('HTTP_PORT', '0');
  vi.stubEnv('GA_PAIRING_TOKEN', '');
  quiet.push(vi.spyOn(console, 'log').mockImplementation(() => {}));
  quiet.push(vi.spyOn(console, 'warn').mockImplementation(() => {}));
  server = await importPhoneServer();
  ({ wsPort, httpPort } = await server.listening);
  await server.setDesktopCredential(HOST);
  await server.setPairingToken(TOKEN);
});

afterAll(() => {
  server?.shutdownServer({ force: true });
  for (const spy of quiet) spy.mockRestore();
  vi.unstubAllEnvs();
});

async function until<T>(find: () => T | undefined, ms = 2000): Promise<T> {
  for (let t = 0; t < ms; t += 10) {
    const hit = find();
    if (hit !== undefined) return hit;
    await pause(10);
  }
  throw new Error('timed out');
}

function open(headers: Record<string, string> = {}): Promise<{ ws: WebSocket; got: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/?pair=${TOKEN}`, { headers });
    const got: any[] = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    ws.once('open', () => resolve({ ws, got }));
    ws.once('error', reject);
  });
}

async function openDesktop() {
  const peer = await open();
  peer.ws.send(JSON.stringify({ type: 'register_desktop', credential: HOST }));
  await until(() => peer.got.find((m) => m.type === 'desktop_registered'));
  return peer;
}

const closed = (ws: WebSocket) => new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));

/** A raw request on the WebSocket port; resolves with the response head. */
function rawRequest(lines: string[]): Promise<string> {
  return new Promise((resolve) => {
    const sock = net.connect(wsPort, '127.0.0.1');
    let text = '';
    sock.on('data', (d) => { text += d.toString('latin1'); if (text.includes('\r\n\r\n')) { sock.destroy(); resolve(text); } });
    sock.on('close', () => resolve(text));
    sock.write(`${lines.join('\r\n')}\r\n\r\n`);
  });
}

const upgrade = (extra: string[] = [], query = `?pair=${TOKEN}`) => [
  `GET /${query} HTTP/1.1`, `Host: 127.0.0.1:${wsPort}`, 'Connection: Upgrade', 'Upgrade: websocket',
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13', ...extra,
];

describe('the QR link cookie', () => {
  it('is only handed out for a request that carried ?pair=, named after the configured port', async () => {
    const plain = await fetch(`http://127.0.0.1:${httpPort}/info`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(plain.headers.get('set-cookie')).toBeNull();
    const viaQr = await fetch(`http://127.0.0.1:${httpPort}/info?pair=${TOKEN.toLowerCase()}`);
    const cookie = viaQr.headers.get('set-cookie') ?? '';
    // The canonical token, not the spelling the link used.
    expect(cookie).toBe(`ga_pair_0=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
  });

  it('works for GET and HEAD only, and only with the right name and token', async () => {
    const at = (method: string, cookie: string) => fetch(`http://127.0.0.1:${httpPort}/info`, { method, headers: { Cookie: cookie } });
    expect((await at('GET', `ga_pair_0=${TOKEN}`)).status).toBe(200);
    expect((await at('HEAD', `other=1; ga_pair_0=${TOKEN.toLowerCase()}`)).status).toBe(200);
    expect((await at('GET', `ga_pair_9002=${TOKEN}`)).status).toBe(401);
    expect((await at('GET', `ga_pair_0=${OTHER}`)).status).toBe(401);
    expect((await at('DELETE', `ga_pair_0=${TOKEN}`)).status).toBe(401);
  });

  it('never stands in for the desktop credential', async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/api/shaders/abc`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}`, 'X-GA-Desktop': TOKEN },
    });
    expect(res.status).toBe(403);
  });
});

describe('CORS and the info endpoint', () => {
  it('echoes local origins, answers others with null, and no origin with *', async () => {
    const corsFor = async (origin?: string) => (await fetch(`http://127.0.0.1:${httpPort}/info`, {
      headers: { Authorization: `Bearer ${TOKEN}`, ...(origin ? { Origin: origin } : {}) },
    })).headers.get('access-control-allow-origin');
    expect(await corsFor('http://192.168.1.20:5173')).toBe('http://192.168.1.20:5173');
    expect(await corsFor('http://172.20.0.1')).toBe('http://172.20.0.1');
    expect(await corsFor('https://evil.example')).toBe('null');
    expect(await corsFor('http://172.32.0.1')).toBe('null');
    expect(await corsFor()).toBe('*');
    // Refusals carry the same headers.
    const refused = await fetch(`http://127.0.0.1:${httpPort}/info`, { headers: { Origin: 'http://localhost:1420' } });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('access-control-allow-origin')).toBe('http://localhost:1420');
  });

  it('reports the configured ports as the JS server always has', async () => {
    const info = await (await fetch(`http://127.0.0.1:${httpPort}/info`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    expect(info).toMatchObject({ wsPort: '0', httpPort: '0' });
    expect(Array.isArray(info.ips)).toBe(true);
  });

  it('serves the app shell for unknown paths and refuses traversal spelled with backslashes or dots', async () => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const shell = await fetch(`http://127.0.0.1:${httpPort}/no/such/page`, { headers: auth });
    expect(shell.status).toBe(200);
    expect(shell.headers.get('content-type')).toMatch(/text\/html/);
    expect((await fetch(`http://127.0.0.1:${httpPort}/..%2f..%2fpackage.json`, { headers: auth })).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${httpPort}/%E0%A4%A`, { headers: auth })).status).toBe(400);
  });
});

describe('the WebSocket handshake', () => {
  it('checks the handshake before the token, as ws does', async () => {
    expect(await rawRequest(upgrade(['Sec-WebSocket-Version: 12']).filter((l) => l !== 'Sec-WebSocket-Version: 13'))).toMatch(/^HTTP\/1\.1 400[\s\S]*sec-websocket-version: 13, 8/i);
    expect(await rawRequest(upgrade().map((l) => l.startsWith('Sec-WebSocket-Key') ? 'Sec-WebSocket-Key: short' : l))).toMatch(/^HTTP\/1\.1 400/);
    expect(await rawRequest(upgrade([], ''))).toMatch(/^HTTP\/1\.1 401/);
    expect(await rawRequest(upgrade([], `?pair=${OTHER}`))).toMatch(/^HTTP\/1\.1 401/);
    expect(await rawRequest(upgrade())).toMatch(/^HTTP\/1\.1 101[\s\S]*sec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/i);
  });

  it('agrees on the first subprotocol a client offers', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/?pair=${TOKEN}`, ['ga.v1', 'ga.v0']);
    await new Promise((r) => ws.once('open', r));
    expect(ws.protocol).toBe('ga.v1');
    ws.close();
  });
});

describe('a pairing reset', () => {
  it('cuts off a phone that never finishes the closing handshake', async () => {
    const sock = net.connect(wsPort, '127.0.0.1');
    let head = '';
    await new Promise<void>((resolve) => {
      sock.on('data', (d) => { head += d.toString('latin1'); if (head.includes('\r\n\r\n')) resolve(); });
      sock.write(`${upgrade().join('\r\n')}\r\n\r\n`);
    });
    expect(head).toMatch(/^HTTP\/1\.1 101/);
    const gone = new Promise<number>((resolve) => { const t0 = Date.now(); sock.on('close', () => resolve(Date.now() - t0)); });
    await server.setPairingToken(OTHER);
    // It never answers the close frame; the server drops it anyway, soon.
    expect(await gone).toBeLessThan(3000);
    await server.setPairingToken(TOKEN);
  });
});

describe('the desktop', () => {
  it('is replaced by a newer registration, and dropped when its credential changes', async () => {
    const first = await openDesktop();
    const firstClosed = closed(first.ws);
    const second = await openDesktop();
    expect(await firstClosed).toBe(4409);
    const secondClosed = closed(second.ws);
    await server.setDesktopCredential('another-host-secret-'.repeat(3));
    expect(await secondClosed).toBe(4401);
    // The old credential no longer registers; a short one is never accepted.
    const late = await open();
    late.ws.send(JSON.stringify({ type: 'register_desktop', credential: HOST }));
    await until(() => late.got.find((m) => m.code === 'host_authorization_required'));
    await server.setDesktopCredential('short');
    late.ws.send(JSON.stringify({ type: 'register_desktop', credential: 'short' }));
    await until(() => late.got.filter((m) => m.code === 'host_authorization_required').length === 2 || undefined);
    late.ws.close();
    await server.setDesktopCredential(HOST);
  });
});

describe('relaying', () => {
  it('keeps the mapping state a later phone is synced with, within its bounds', async () => {
    const host = await openDesktop();
    const phone = await open();
    try {
      host.ws.send(JSON.stringify({ type: 'sync', project: { id: 'p', layers: [{ id: 'L1', corners: { topLeft: { x: 0, y: 0 } }, opacity: 1 }] } }));
      await until(() => phone.got.find((m) => m.type === 'sync' && m.project?.id === 'p'));
      phone.ws.send(JSON.stringify({ type: 'control_point', layerId: 'L1', corner: 'topLeft', position: { x: 0.25, y: 0.75 } }));
      phone.ws.send(JSON.stringify({ type: 'control_point', layerId: 'L1', corner: '__proto__', position: { x: 1, y: 1 } }));
      phone.ws.send(JSON.stringify({ type: 'parameter', layerId: 'L1', param: 'opacity', value: 7 }));
      phone.ws.send(JSON.stringify({ type: 'mesh_resize', layerId: 'L1', rows: 99999, cols: 99999 }));
      phone.ws.send(JSON.stringify({ type: 'mesh_resize', layerId: 'L1', rows: 3, cols: 2 }));
      phone.ws.send(JSON.stringify({ type: 'select_layer', layerId: 'L1' }));
      await until(() => host.got.find((m) => m.type === 'select_layer'));
      expect(host.got.filter((m) => m.type === 'control_point')).toHaveLength(1);
      expect(host.got.filter((m) => m.type === 'mesh_resize').map((m) => m.rows)).toEqual([3]);
      // The sender hears its own mapping edits too (broadcastAll).
      await until(() => phone.got.find((m) => m.type === 'select_layer'));
      const later = await open();
      const sync = await until(() => later.got.find((m) => m.type === 'sync'));
      expect(sync.project.selectedLayerId).toBe('L1');
      expect(sync.project.layers[0].corners.topLeft).toEqual({ x: 0.25, y: 0.75 });
      expect(sync.project.layers[0].opacity).toBe(1);
      expect(sync.project.layers[0].meshGrid).toMatchObject({ rows: 3, cols: 2 });
      expect(sync.project.layers[0].meshGrid.points[2][1]).toEqual({ x: 1, y: 1 });
      expect(later.got.find((m) => m.type === 'client_count')?.count).toBeGreaterThanOrEqual(3);
      later.ws.close();
    } finally { host.ws.close(); phone.ws.close(); }
  });

  it('drops a phone\'s messages past 200 a second', async () => {
    const host = await openDesktop();
    const phone = await open();
    try {
      for (let i = 0; i < 260; i++) phone.ws.send(JSON.stringify({ type: 'lightpainting_stroke_point', i }));
      await pause(400);
      const points = host.got.filter((m) => m.type === 'lightpainting_stroke_point');
      expect(points).toHaveLength(200);
      expect(points[199].i).toBe(199);
      // Neither a non-object nor an absurd type is passed on.
      await pause(700);
      phone.ws.send('[1,2]');
      phone.ws.send(JSON.stringify({ type: 'x'.repeat(65) }));
      phone.ws.send(JSON.stringify({ type: 'lightpainting_undo', layerId: 'after' }));
      await until(() => host.got.find((m) => m.type === 'lightpainting_undo'));
      expect(host.got.some((m) => typeof m.type === 'string' && m.type.length > 64)).toBe(false);
    } finally { host.ws.close(); phone.ws.close(); }
  });

  it('points the phone app\'s thumbnails at this machine, with the token', async () => {
    const host = await openDesktop();
    const app = await open({ Origin: 'capacitor://localhost' });
    const browser = await open();
    try {
      host.ws.send(JSON.stringify({ type: 'library_sync', library: [{ src: 'v.mp4', thumbnail: './thumbs/v.png' }, { src: 'w.mp4', thumbnail: '//cdn/w.png' }] }));
      const forApp = await until(() => app.got.find((m) => m.type === 'library_sync'));
      expect(forApp.library[0].thumbnail).toBe(`http://127.0.0.1:0/thumbs/v.png?pair=${TOKEN}`);
      expect(forApp.library[1].thumbnail).toBe('//cdn/w.png');
      const forBrowser = await until(() => browser.got.find((m) => m.type === 'library_sync'));
      expect(forBrowser.library[0].thumbnail).toBe('./thumbs/v.png');
    } finally { host.ws.close(); app.ws.close(); browser.ws.close(); }
  });

  it('forgets the show state when the desktop goes', async () => {
    const host = await openDesktop();
    host.ws.send(JSON.stringify({ type: 'show_state', state: { time: 3 } }));
    const phone = await open();
    await until(() => phone.got.find((m) => m.type === 'show_state'));
    const gone = closed(host.ws); host.ws.close(); await gone;
    await pause(50);
    const later = await open();
    await until(() => later.got.find((m) => m.type === 'output_freeze_state'));
    await pause(50);
    expect(later.got.some((m) => m.type === 'show_state')).toBe(false);
    phone.ws.close(); later.ws.close();
  });
});
