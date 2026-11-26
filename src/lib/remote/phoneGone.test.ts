import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { importPhoneServer, type PhoneServer } from './phoneServerUnderTest';
import { WebSocket } from 'ws';
import { createRequire } from 'node:module';

/**
 * A phone that disconnects in the middle of an auto map, a room scan or a
 * scan transfer never sends its end. The pairing server says so to the
 * desktop at once, in the message each flow already treats as "over".
 */
const require = createRequire(import.meta.url);
const { HOST_MESSAGES, calibrationChunkAllowed } = require('../../../server/remote-access.cjs');

const TOKEN = 'ABCD0EFGH1JKMN2P';
const HOST = 'host-secret-'.repeat(6);
let server: PhoneServer;
let wsPort = 0;
let host: WebSocket;
const toDesktop: any[] = [];
const quiet: Array<{ mockRestore(): void }> = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/?pair=${TOKEN}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
async function until<T>(find: () => T | undefined, ms = 2000): Promise<T> {
  for (let t = 0; t < ms; t += 20) {
    const hit = find();
    if (hit !== undefined) return hit;
    await pause(20);
  }
  throw new Error('timed out');
}

beforeAll(async () => {
  vi.stubEnv('GA_REMOTE_BIND_HOST', '127.0.0.1');
  vi.stubEnv('WS_PORT', '0');
  vi.stubEnv('HTTP_PORT', '0');
  vi.stubEnv('GA_PAIRING_TOKEN', '');
  quiet.push(vi.spyOn(console, 'log').mockImplementation(() => {}));
  quiet.push(vi.spyOn(console, 'warn').mockImplementation(() => {}));
  server = await importPhoneServer();
  ({ wsPort } = await server.listening);
  await server.setDesktopCredential(HOST);
  await server.setPairingToken(TOKEN);
  host = await open();
  host.on('message', (d) => toDesktop.push(JSON.parse(d.toString())));
  host.send(JSON.stringify({ type: 'register_desktop', credential: HOST }));
  await until(() => toDesktop.find((m) => m.type === 'desktop_registered'));
});

afterAll(() => {
  server?.shutdownServer({ force: true });
  for (const spy of quiet) spy.mockRestore();
  vi.unstubAllEnvs();
});

describe('a phone that disconnects mid-task', () => {
  it('ends its auto map, room scan and scan transfer on the desktop at once', async () => {
    const phone = await open();
    phone.send(JSON.stringify({ type: 'studio_automap_request', requestId: 'am-1', seq: 1, op: 'screens' }));
    await until(() => toDesktop.find((m) => m.type === 'studio_automap_request' && m.requestId === 'am-1'));
    phone.send(JSON.stringify({ type: 'studio_scan_offer', requestId: 'sc-1', name: 'room.ply', bytes: 1000, sha256: 'a'.repeat(64), chunkBytes: 1000 }));
    await until(() => toDesktop.find((m) => m.type === 'studio_scan_offer' && m.requestId === 'sc-1'));
    phone.send(JSON.stringify({ type: 'studio_depth_scan_progress', requestId: 'dp-1', stage: 'ready' }));
    phone.send(JSON.stringify({ type: 'studio_depth_capture_offer', requestId: 'dp-2', capture: { version: 1 } }));
    await until(() => toDesktop.find((m) => m.type === 'studio_depth_capture_offer' && m.requestId === 'dp-2'));
    phone.close();
    expect(await until(() => toDesktop.find((m) => m.type === 'studio_automap_request' && m.requestId === 'am-1' && m.op === 'camera_gone'))).toMatchObject({ reason: 'phone-disconnected' });
    expect(await until(() => toDesktop.find((m) => m.type === 'studio_scan_abort' && m.requestId === 'sc-1'))).toMatchObject({ reason: 'phone-disconnected' });
    expect(await until(() => toDesktop.find((m) => m.type === 'studio_depth_scan_progress' && m.requestId === 'dp-2'))).toMatchObject({ stage: 'error' });
  });

  it('only the desktop answers an auto map; a large calibration may come in pieces', async () => {
    expect(HOST_MESSAGES.has('studio_automap_reply')).toBe(true);
    const phone = await open(), other = await open();
    const heard: any[] = [];
    other.on('message', (d) => heard.push(JSON.parse(d.toString())));
    other.send(JSON.stringify({ type: 'studio_automap_request', requestId: 'am-2', seq: 1, op: 'screens' }));
    await until(() => toDesktop.find((m) => m.requestId === 'am-2'));
    // Another phone cannot answer for the desktop.
    phone.send(JSON.stringify({ type: 'studio_automap_reply', requestId: 'am-2', seq: 1, screens: [] }));
    await pause(150);
    expect(heard.some((m) => m.type === 'studio_automap_reply')).toBe(false);
    host.send(JSON.stringify({ type: 'studio_automap_reply', requestId: 'am-2', seq: 1, screens: [] }));
    await until(() => heard.find((m) => m.type === 'studio_automap_reply'));
    expect(calibrationChunkAllowed({ type: 'studio_calibration_chunk', requestId: 'c1', index: 0, count: 2, data: 'x' })).toBe(true);
    expect(calibrationChunkAllowed({ type: 'studio_calibration_chunk', requestId: 'c1', index: 2, count: 2, data: 'x' })).toBe(false);
    expect(calibrationChunkAllowed({ type: 'studio_calibration_chunk', requestId: 'c1', index: 0, count: 2, data: 'x'.repeat(2 * 1024 * 1024) })).toBe(false);
    phone.send(JSON.stringify({ type: 'studio_calibration_chunk', requestId: 'cal-1', index: 0, count: 2, data: '{"a":' }));
    expect(await until(() => toDesktop.find((m) => m.type === 'studio_calibration_chunk' && m.requestId === 'cal-1'))).toMatchObject({ index: 0, count: 2 });
    phone.close(); other.close();
  });
});
