import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  SCAN_MIN_CHUNK_BYTES, ScanReceiver, bytesToBase64, crc32, scanTransferCapability, sendScan,
  type ScanSink, type ScanSocket, type ScanStatus,
} from '../mobile/studio/scanTransfer';

/**
 * A scan travelling phone -> real pairing server -> desktop receiver -> the
 * real main-process store (in a temp folder), over real sockets. What must
 * hold: the file arrives byte for byte; only the phone that offered it can add
 * to it; nothing a phone sends decides where the file goes; a damaged or
 * abandoned transfer leaves nothing behind.
 */
const require = createRequire(import.meta.url);
const { createPhoneScanStore } = require('../../../electron/phone-scan-store.cjs');
const { scanMessageAllowed } = require('../../../server/remote-access.cjs');

const TOKEN = 'ABCD0EFGH1JKMN2P';
const HOST = 'host-secret-'.repeat(6);
let server: typeof import('../../../server/ws-server.js');
let wsPort = 0;
let dir = '';
let store: ReturnType<typeof createPhoneScanStore>;
let host: WebSocket;
let receiver: ScanReceiver;
let decide: () => Promise<boolean> = async () => true;
const seenByDesktop: any[] = [];
const quiet: Array<{ mockRestore(): void }> = [];

function open(query = `?pair=${TOKEN}`): Promise<{ ws?: WebSocket; status?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/${query}`);
    ws.once('open', () => resolve({ ws }));
    ws.once('error', (err) => resolve({ status: Number(/Unexpected server response: (\d+)/.exec(err.message)?.[1] ?? -1) }));
  });
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
function samplePly(): Uint8Array {
  const sample = process.env.GA_SCAN_SAMPLE_DIR ? path.join(process.env.GA_SCAN_SAMPLE_DIR, 'room-balanced.ply') : '';
  if (sample && existsSync(sample)) return new Uint8Array(readFileSync(sample));
  // Same shape as a phone scan: header, then 15 bytes per point.
  const header = Buffer.from('ply\nformat binary_little_endian 1.0\ncomment voxel_size_m 0.0080\nelement vertex 20000\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n');
  const body = Buffer.alloc(20000 * 15);
  for (let i = 0; i < body.length; i++) body[i] = (i * 31 + (i >> 8)) & 0xff;
  return new Uint8Array(Buffer.concat([header, body]));
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const leftovers = () => readdirSync(dir).filter((name) => name.startsWith('.incoming-'));

beforeAll(async () => {
  vi.stubEnv('GA_REMOTE_BIND_HOST', '127.0.0.1');
  vi.stubEnv('WS_PORT', '0');
  vi.stubEnv('HTTP_PORT', '0');
  vi.stubEnv('GA_PAIRING_TOKEN', '');
  quiet.push(vi.spyOn(console, 'log').mockImplementation(() => {}));
  quiet.push(vi.spyOn(console, 'warn').mockImplementation(() => {}));
  server = await import('../../../server/ws-server.js');
  ({ wsPort } = await server.listening);
  server.setDesktopCredential(HOST);
  server.setPairingToken(TOKEN);
  dir = mkdtempSync(path.join(tmpdir(), 'ga-phone-scans-'));
  store = createPhoneScanStore(dir);
  const sink: ScanSink = {
    begin: async (name, bytes) => store.begin({ name, bytes }),
    write: async (id, offset, data) => { store.write({ id, offset, bytes: data }); },
    finish: async (id, sha256) => store.finish({ id, sha256 }),
    abort: async (id) => { store.abort({ id }); },
  };
  host = (await open()).ws!;
  const registered = new Promise<void>((resolve) => host.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'desktop_registered') resolve();
    if (message.type === 'studio_capabilities_request') host.send(JSON.stringify({ type: 'studio_capabilities', version: 1, visualFeeds: true, nativeInteractive: true, scanTransfer: { ...scanTransferCapability(), chunkBytes: 256 * 1024 } }));
    if (String(message.type).startsWith('studio_scan_')) { seenByDesktop.push(message); void receiver.handle(message); }
  }));
  receiver = new ScanReceiver({
    sink, confirm: () => decide(), onSaved: () => {},
    send: (status: ScanStatus) => host.send(JSON.stringify(status)),
  });
  host.send(JSON.stringify({ type: 'register_desktop', credential: HOST }));
  await registered;
});

afterAll(() => {
  server?.shutdownServer({ force: true });
  for (const spy of quiet) spy.mockRestore();
  vi.unstubAllEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('phone scan through the pairing server', () => {
  it('lands byte for byte in the scan folder, in messages under the server limit', async () => {
    const bytes = samplePly();
    const phone = (await open()).ws!;
    let largest = 0;
    const send = phone.send.bind(phone);
    phone.send = ((data: string) => { largest = Math.max(largest, data.length); send(data); }) as never;
    const outcome = await sendScan({ socket: phone as unknown as ScanSocket, bytes, name: 'Room 2026-10-08 1432.ply', points: 206947 }).done;
    expect(outcome).toMatchObject({ state: 'saved', name: 'Room 2026-10-08 1432.ply' });
    const saved = readFileSync(path.join(dir, 'Room 2026-10-08 1432.ply'));
    expect(saved.length).toBe(bytes.length);
    expect(sha(saved)).toBe(sha(bytes));
    expect(largest).toBeLessThan(10 * 1024 * 1024);
    expect(leftovers()).toEqual([]);
    expect(store.list()[0]).toMatchObject({ name: 'Room 2026-10-08 1432.ply', bytes: bytes.length });
    // Same name again: kept apart, never overwritten.
    expect((await sendScan({ socket: phone as unknown as ScanSocket, bytes, name: 'Room 2026-10-08 1432.ply', points: 1 }).done).name).toBe('Room 2026-10-08 1432 (2).ply');
    phone.close();
  });

  it('refuses a sender that is not paired', async () => {
    expect((await open('')).status).toBe(401);
    expect((await open('?pair=WRONGWRONGWRONG1')).status).toBe(401);
  });

  it('lets only the offering phone add to a transfer, and only the desktop answer', async () => {
    // Keep the offer open: the desktop is still asking its user.
    let answer: (ok: boolean) => void = () => {};
    decide = () => new Promise<boolean>((resolve) => { answer = resolve; });
    const a = (await open()).ws!, b = (await open()).ws!;
    const gotByA: any[] = [], gotByB: any[] = [];
    a.on('message', (d) => gotByA.push(JSON.parse(d.toString())));
    b.on('message', (d) => gotByB.push(JSON.parse(d.toString())));
    const before = seenByDesktop.length;
    const offer = { type: 'studio_scan_offer', requestId: 'own-a', version: 1, name: 'a.ply', bytes: 100_000, points: 1, sha256: 'a'.repeat(64), chunkBytes: SCAN_MIN_CHUNK_BYTES };
    a.send(JSON.stringify(offer));
    await pause(80);
    const part = new Uint8Array(SCAN_MIN_CHUNK_BYTES);
    // Another paired phone tries to write into A's transfer, to abort it, and to forge the desktop's answer.
    b.send(JSON.stringify({ type: 'studio_scan_chunk', requestId: 'own-a', index: 0, crc32: crc32(part), data: bytesToBase64(part) }));
    b.send(JSON.stringify({ type: 'studio_scan_abort', requestId: 'own-a' }));
    b.send(JSON.stringify({ type: 'studio_scan_status', requestId: 'own-a', state: 'saved', name: 'forged.ply' }));
    await pause(120);
    const reached = seenByDesktop.slice(before);
    expect(reached.map((m) => m.type)).toEqual(['studio_scan_offer']);
    expect(gotByA.filter((m) => m.type === 'studio_scan_status').map((m) => m.state)).toEqual(['waiting']);
    answer(false);
    await pause(80);
    expect(gotByA.filter((m) => m.type === 'studio_scan_status').map((m) => m.state)).toEqual(['waiting', 'declined']);
    expect(gotByB.some((m) => String(m.type).startsWith('studio_scan_'))).toBe(false);
    decide = async () => true;
    a.close(); b.close();
  });

  it('stops at the server what is not a scan message at all', async () => {
    const phone = (await open()).ws!;
    const before = seenByDesktop.length;
    const base = { type: 'studio_scan_offer', requestId: 'big', version: 1, name: 'x', bytes: 1000, points: 1, sha256: 'a'.repeat(64), chunkBytes: SCAN_MIN_CHUNK_BYTES };
    phone.send(JSON.stringify({ ...base, bytes: 65 * 1024 * 1024 }));
    phone.send(JSON.stringify({ ...base, requestId: '../../x' }));
    phone.send(JSON.stringify({ ...base, name: 'n'.repeat(400) }));
    phone.send(JSON.stringify({ type: 'studio_scan_chunk', requestId: 'big', index: -1, crc32: 0, data: '' }));
    await pause(120);
    expect(seenByDesktop.length).toBe(before);
    expect(scanMessageAllowed({ type: 'studio_scan_chunk', requestId: 'r', index: 0, data: 'x'.repeat(3 * 1024 * 1024) })).toBe(false);
    expect(scanMessageAllowed({ type: 'studio_scan_status', requestId: 'r', state: 'anything' })).toBe(false);
    phone.close();
  });

  it('keeps a hostile or oversized name inside the scan folder', async () => {
    const phone = (await open()).ws!;
    const bytes = samplePly().slice(0, 40_000);
    const raw = phone.send.bind(phone);
    // A modified phone app: it does not clean the name before offering it.
    phone.send = ((data: string) => {
      const message = JSON.parse(data);
      raw(message.type === 'studio_scan_offer' ? JSON.stringify({ ...message, name: `../../../../tmp/${'evil'.repeat(60)}/../.ssh/authorized_keys` }) : data);
    }) as never;
    const outcome = await sendScan({ socket: phone as unknown as ScanSocket, bytes, name: 'x', points: 1 }).done;
    expect(outcome).toMatchObject({ state: 'saved', name: 'authorized_keys.ply' });
    expect(existsSync(path.join(dir, 'authorized_keys.ply'))).toBe(true);
    for (const entry of store.list()) expect(path.dirname(entry.path)).toBe(dir);
    expect(() => store.begin({ name: 'x', bytes: 65 * 1024 * 1024 })).toThrow(/too large/);
    phone.close();
  });

  it('asks again for a damaged chunk, and rejects a file that is damaged for good', async () => {
    const bytes = samplePly().slice(0, 700_000);
    const phone = (await open()).ws!;
    const raw = phone.send.bind(phone);
    let damage = 1, chunkMessages = 0;
    phone.send = ((data: string) => {
      const message = JSON.parse(data);
      if (message.type !== 'studio_scan_chunk') { raw(data); return; }
      chunkMessages++;
      if (message.index === 1 && damage-- > 0) { raw(JSON.stringify({ ...message, data: `AAAAAAAA${message.data.slice(8)}` })); return; }
      raw(data);
    }) as never;
    const outcome = await sendScan({ socket: phone as unknown as ScanSocket, bytes, name: 'damaged once', points: 1 }).done;
    expect(outcome.state).toBe('saved');
    expect(chunkMessages).toBe(Math.ceil(bytes.length / (256 * 1024)) + 1);
    expect(sha(readFileSync(path.join(dir, 'damaged once.ply')))).toBe(sha(bytes));

    // Damage that also fools the per-chunk check (checksum recomputed): the whole-file hash still catches it.
    phone.send = ((data: string) => {
      const message = JSON.parse(data);
      if (message.type !== 'studio_scan_chunk' || message.index !== 1) { raw(data); return; }
      const part = new Uint8Array(Buffer.from(message.data, 'base64'));
      part[100] ^= 0xff;
      raw(JSON.stringify({ ...message, crc32: crc32(part), data: bytesToBase64(part) }));
    }) as never;
    const bad = await sendScan({ socket: phone as unknown as ScanSocket, bytes, name: 'damaged for good', points: 1 }).done;
    expect(bad).toMatchObject({ state: 'failed', message: 'The scan did not arrive intact. Send it again.' });
    expect(existsSync(path.join(dir, 'damaged for good.ply'))).toBe(false);
    expect(leftovers()).toEqual([]);
    phone.close();
  });

  it('leaves nothing behind when the phone aborts or drops part way', async () => {
    const bytes = samplePly().slice(0, 1_200_000);
    const phone = (await open()).ws!;
    const transfer = sendScan({ socket: phone as unknown as ScanSocket, bytes, name: 'aborted', points: 1, onProgress: (p) => { if (p.phase === 'sending' && p.sent >= 256 * 1024) transfer.abort(); } });
    expect((await transfer.done).state).toBe('aborted');
    // The abort crosses two sockets before the desktop drops the partial file.
    for (let i = 0; i < 100 && (store.openCount() > 0 || leftovers().length > 0); i++) await pause(30);
    expect(existsSync(path.join(dir, 'aborted.ply'))).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(store.openCount()).toBe(0);
    phone.close();
  });

  it('refuses a file that is not a point cloud, and out-of-order writes', () => {
    const junk = Buffer.from('MZ' + 'x'.repeat(100));
    const t = store.begin({ name: 'junk', bytes: junk.length });
    store.write({ id: t.id, offset: 0, bytes: junk });
    expect(() => store.finish({ id: t.id, sha256: sha(junk) })).toThrow(/not a point cloud/);
    const u = store.begin({ name: 'order', bytes: 100 });
    expect(() => store.write({ id: u.id, offset: 10, bytes: Buffer.alloc(10) })).toThrow(/out of order/);
    const v = store.begin({ name: 'over', bytes: 20 });
    expect(() => store.write({ id: v.id, offset: 0, bytes: Buffer.alloc(21) })).toThrow(/out of order/);
    expect(() => store.write({ id: '../../x', offset: 0, bytes: Buffer.alloc(1) })).toThrow(/no longer/);
    expect(leftovers()).toEqual([]);
    expect(existsSync(path.join(dir, 'junk.ply'))).toBe(false);
  });
});
