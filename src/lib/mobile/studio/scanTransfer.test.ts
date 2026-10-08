import { describe, expect, it } from 'vitest';
import {
  SCAN_MAX_BYTES, SCAN_MIN_CHUNK_BYTES, SCAN_UNSUPPORTED_MESSAGE, ScanReceiver,
  base64ToBytes, bytesToBase64, crc32, readScanTransferCapability, sanitizeScanName, scanTransferCapability,
  sendScan, sha256Hex, sha256HexSync, validScanOffer,
  type ReceivedScan, type ScanSink, type ScanSocket, type ScanStatus,
} from './scanTransfer';

function payload(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set([0x70, 0x6c, 0x79, 0x0a]); // "ply\n"
  let seed = 7;
  for (let i = 4; i < bytes; i++) { seed = (seed * 1103515245 + 12345) >>> 0; out[i] = seed >>> 24; }
  return out;
}

/** In-memory stand-in for the desktop's main-process store, with the same checks. */
function memorySink() {
  const open = new Map<string, { name: string; bytes: number; parts: Uint8Array[]; written: number }>();
  const saved = new Map<string, Uint8Array>();
  const log: string[] = [];
  let ids = 0;
  const sink: ScanSink = {
    async begin(name, bytes) { const id = `t${++ids}`; open.set(id, { name, bytes, parts: [], written: 0 }); log.push(`begin ${name}`); return { id, name }; },
    async write(id, offset, data) {
      const t = open.get(id);
      if (!t || offset !== t.written || t.written + data.length > t.bytes) throw new Error('Scan data arrived out of order.');
      t.parts.push(data.slice()); t.written += data.length;
    },
    async finish(id, sha256) {
      const t = open.get(id)!;
      open.delete(id);
      const all = new Uint8Array(t.written);
      let o = 0;
      for (const part of t.parts) { all.set(part, o); o += part.length; }
      if (t.written !== t.bytes || sha256HexSync(all) !== sha256) { log.push('rejected'); throw new Error('The scan did not arrive intact. Send it again.'); }
      saved.set(t.name, all);
      return { path: `/library/${t.name}`, name: t.name, bytes: t.bytes };
    },
    async abort(id) { if (open.delete(id)) log.push('abort'); },
  };
  return { sink, open, saved, log };
}

type Wire = { toDesktop?: (message: any) => any | null; capabilities?: Record<string, unknown> | null };
/** A phone socket wired straight to a ScanReceiver, as the relay server would. */
function link(receiver: ScanReceiver, statusOut: { fn: (s: ScanStatus) => void }, wire: Wire = {}) {
  const listeners = { message: new Set<(e: any) => void>(), close: new Set<(e: any) => void>() };
  const sent: any[] = [];
  const socket: ScanSocket & { close(): void } = {
    readyState: 1,
    send(text) {
      let message = JSON.parse(text);
      sent.push(message);
      if (message.type === 'studio_capabilities_request') {
        if (wire.capabilities !== null) deliver({ type: 'studio_capabilities', version: 1, visualFeeds: true, ...(wire.capabilities ?? { scanTransfer: { ...scanTransferCapability(), chunkBytes: SCAN_MIN_CHUNK_BYTES } }) });
        return;
      }
      if (wire.toDesktop) { message = wire.toDesktop(message); if (!message) return; }
      queueMicrotask(() => void receiver.handle(message));
    },
    addEventListener(type, fn) { listeners[type].add(fn); },
    removeEventListener(type, fn) { listeners[type].delete(fn); },
    close() { this.readyState = 3; for (const fn of [...listeners.close]) fn({}); },
  };
  const deliver = (message: unknown) => queueMicrotask(() => { if (socket.readyState === 1) for (const fn of [...listeners.message]) fn({ data: JSON.stringify(message) }); });
  statusOut.fn = deliver;
  return { socket, sent };
}
function desktop(confirm: (offer: any) => Promise<boolean> = async () => true) {
  const store = memorySink();
  const out = { fn: (_: ScanStatus) => {} };
  const savedScans: ReceivedScan[] = [];
  const offers: any[] = [];
  const receiver = new ScanReceiver({
    sink: store.sink, send: (status) => out.fn(status),
    confirm: (offer) => { offers.push(offer); return confirm(offer); },
    onSaved: (scan) => savedScans.push(scan),
  });
  return { ...store, receiver, out, savedScans, offers };
}
const chunksOf = (sent: any[]) => sent.filter((m) => m.type === 'studio_scan_chunk');

describe('scan transfer helpers', () => {
  it('hashes, checksums and encodes exactly', async () => {
    const abc = new TextEncoder().encode('abc');
    expect(sha256HexSync(abc)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256HexSync(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const big = payload(200_003);
    expect(sha256HexSync(big)).toBe(await sha256Hex(big));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
    expect(base64ToBytes('not base64!')).toBeNull();
    expect(base64ToBytes('abc')).toBeNull();
  });

  it('turns any offered name into a plain .ply file name', () => {
    expect(sanitizeScanName('Stage left 2026-10-08 1432.ply')).toBe('Stage left 2026-10-08 1432.ply');
    expect(sanitizeScanName('../../../etc/passwd')).toBe('passwd.ply');
    expect(sanitizeScanName('C:\\Windows\\System32\\drivers\\x.sys')).toBe('x.sys.ply');
    expect(sanitizeScanName('.bashrc')).toBe('bashrc.ply');
    expect(sanitizeScanName('..')).toBe('Scan.ply');
    expect(sanitizeScanName('nul.ply')).toBe('_nul.ply');
    expect(sanitizeScanName('a\u0000b\nc<>:"|?*.ply')).toBe('a_b_c.ply');
    const long = sanitizeScanName('x'.repeat(500));
    expect(long.length).toBe(84);
    for (const name of ['../../x', 'a/b\\c', '\u202Egnp.exe', '']) expect(sanitizeScanName(name)).toMatch(/^[A-Za-z0-9_(][A-Za-z0-9 ._()-]*\.ply$/);
  });

  it('reads what a desktop can receive, and nothing from an older desktop', () => {
    expect(readScanTransferCapability({ scanTransfer: scanTransferCapability() })).toEqual(scanTransferCapability());
    expect(readScanTransferCapability({ version: 1, visualFeeds: true, nativeInteractive: true })).toBeNull();
    expect(readScanTransferCapability({ scanTransfer: { version: 0 } })).toBeNull();
    expect(readScanTransferCapability({ scanTransfer: { version: 1, maxBytes: 10, chunkBytes: 1 } })!.chunkBytes).toBe(SCAN_MIN_CHUNK_BYTES);
  });

  it('refuses offers that are malformed or too large', () => {
    const good = { type: 'studio_scan_offer', requestId: 'r-1', version: 1, name: 'a.ply', bytes: 1000, points: 60, sha256: 'a'.repeat(64), chunkBytes: SCAN_MIN_CHUNK_BYTES };
    expect(validScanOffer(good)).not.toBeNull();
    expect(validScanOffer({ ...good, bytes: SCAN_MAX_BYTES + 1 })).toBeNull();
    expect(validScanOffer({ ...good, bytes: 3.5 })).toBeNull();
    expect(validScanOffer({ ...good, sha256: 'zz' })).toBeNull();
    expect(validScanOffer({ ...good, requestId: '../x' })).toBeNull();
    expect(validScanOffer({ ...good, chunkBytes: 5 })).toBeNull();
    expect(validScanOffer({ ...good, version: 2 })).toBeNull();
    expect(validScanOffer({ ...good, name: '../../evil' })!.name).toBe('evil.ply');
  });
});

describe('scan transfer, phone to desktop', () => {
  it('delivers a scan byte for byte, in chunks, with progress', async () => {
    const d = desktop();
    const bytes = payload(SCAN_MIN_CHUNK_BYTES * 3 + 1234);
    const { socket, sent } = link(d.receiver, d.out);
    const progress: string[] = [];
    const outcome = await sendScan({ socket, bytes, name: 'Room 2026-10-08 1432.ply', points: 4321, voxelMm: 8, onProgress: (p) => progress.push(`${p.phase}:${p.sent}`) }).done;
    expect(outcome).toMatchObject({ state: 'saved', name: 'Room 2026-10-08 1432.ply' });
    expect(d.saved.get('Room 2026-10-08 1432.ply')).toEqual(bytes);
    expect(chunksOf(sent).map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(Math.max(...sent.map((m) => JSON.stringify(m).length))).toBeLessThan(10 * 1024 * 1024);
    expect(progress[0]).toBe('checking:0');
    expect(progress).toContain('waiting:0');
    expect(progress.at(-1)).toBe(`sending:${bytes.length}`);
    expect(d.offers[0]).toMatchObject({ name: 'Room 2026-10-08 1432.ply', bytes: bytes.length, points: 4321, voxelMm: 8 });
    expect(d.savedScans[0]).toMatchObject({ path: '/library/Room 2026-10-08 1432.ply', points: 4321 });
  });

  it('falls back plainly when the desktop is too old to receive scans', async () => {
    const d = desktop();
    const old = link(d.receiver, d.out, { capabilities: { nativeInteractive: true } });
    expect(await sendScan({ socket: old.socket, bytes: payload(5000), name: 'a', points: 1 }).done).toEqual({ state: 'unsupported', message: SCAN_UNSUPPORTED_MESSAGE });
    const silent = link(d.receiver, d.out, { capabilities: null });
    expect((await sendScan({ socket: silent.socket, bytes: payload(5000), name: 'a', points: 1, capabilityMs: 30 }).done).state).toBe('unsupported');
    expect(old.sent.concat(silent.sent).every((m) => m.type === 'studio_capabilities_request')).toBe(true);
    expect(d.offers).toHaveLength(0);
  });

  it('asks again for a chunk that arrives damaged', async () => {
    const d = desktop();
    const bytes = payload(SCAN_MIN_CHUNK_BYTES * 2 + 77);
    let damaged = 0;
    const { socket, sent } = link(d.receiver, d.out, {
      toDesktop: (m) => (m.type === 'studio_scan_chunk' && m.index === 1 && damaged++ === 0 ? { ...m, data: `AAAA${m.data.slice(4)}` } : m),
    });
    const outcome = await sendScan({ socket, bytes, name: 'damaged', points: 9 }).done;
    expect(outcome.state).toBe('saved');
    expect(chunksOf(sent).map((c) => c.index)).toEqual([0, 1, 1, 2]);
    expect(d.saved.get('damaged.ply')).toEqual(bytes);
  });

  it('gives up, and keeps nothing, when chunks keep arriving damaged', async () => {
    const d = desktop();
    const { socket } = link(d.receiver, d.out, { toDesktop: (m) => (m.type === 'studio_scan_chunk' ? { ...m, crc32: 1 } : m) });
    const outcome = await sendScan({ socket, bytes: payload(40_000), name: 'bad', points: 9 }).done;
    expect(outcome.state).toBe('failed');
    await new Promise((r) => setTimeout(r, 5));
    expect(d.saved.size).toBe(0);
    expect(d.open.size).toBe(0);
  });

  it('rejects a file whose contents do not match the offered hash', async () => {
    const d = desktop();
    const { socket } = link(d.receiver, d.out, { toDesktop: (m) => (m.type === 'studio_scan_offer' ? { ...m, sha256: 'b'.repeat(64) } : m) });
    const outcome = await sendScan({ socket, bytes: payload(40_000), name: 'lie', points: 9 }).done;
    expect(outcome).toMatchObject({ state: 'failed', message: 'The scan did not arrive intact. Send it again.' });
    expect(d.saved.size).toBe(0);
  });

  it('stops cleanly when the phone aborts part way', async () => {
    const d = desktop();
    const bytes = payload(SCAN_MIN_CHUNK_BYTES * 6);
    const { socket, sent } = link(d.receiver, d.out);
    const transfer = sendScan({ socket, bytes, name: 'abort', points: 9, onProgress: (p) => { if (p.phase === 'sending' && p.sent >= SCAN_MIN_CHUNK_BYTES * 2) transfer.abort(); } });
    expect((await transfer.done).state).toBe('aborted');
    await new Promise((r) => setTimeout(r, 5));
    expect(sent.at(-1).type).toBe('studio_scan_abort');
    expect(chunksOf(sent).length).toBeLessThan(6);
    expect(d.log).toContain('abort');
    expect(d.saved.size).toBe(0);
    expect(d.open.size).toBe(0);
  });

  it('writes nothing when the desktop declines', async () => {
    const d = desktop(async () => false);
    const { socket, sent } = link(d.receiver, d.out);
    expect((await sendScan({ socket, bytes: payload(40_000), name: 'no', points: 9 }).done).state).toBe('declined');
    expect(chunksOf(sent)).toHaveLength(0);
    expect(d.log).toEqual([]);
  });

  it('hands the desktop a safe name whatever the phone sends', async () => {
    const d = desktop();
    const { socket } = link(d.receiver, d.out, { toDesktop: (m) => (m.type === 'studio_scan_offer' ? { ...m, name: '../../../Library/LaunchAgents/evil.plist' } : m) });
    expect((await sendScan({ socket, bytes: payload(20_000), name: 'x', points: 1 }).done).name).toBe('evil.plist.ply');
    expect(d.log[0]).toBe('begin evil.plist.ply');
  });

  it('carries on where it stopped after the phone reconnects', async () => {
    const d = desktop();
    const bytes = payload(SCAN_MIN_CHUNK_BYTES * 5 + 9);
    const first = link(d.receiver, d.out);
    const one = sendScan({ socket: first.socket, bytes, name: 'resume', points: 9, onProgress: (p) => { if (p.phase === 'sending' && p.sent >= SCAN_MIN_CHUNK_BYTES * 2) first.socket.close(); } });
    expect((await one.done).state).toBe('failed');
    await new Promise((r) => setTimeout(r, 5));
    const second = link(d.receiver, d.out);
    const outcome = await sendScan({ socket: second.socket, bytes, name: 'resume', points: 9, requestId: one.requestId }).done;
    expect(outcome.state).toBe('saved');
    expect(d.offers).toHaveLength(1); // not asked twice
    expect(chunksOf(second.sent)[0].index).toBeGreaterThanOrEqual(2);
    expect(chunksOf(first.sent).length + chunksOf(second.sent).length).toBeLessThanOrEqual(7);
    expect(d.saved.get('resume.ply')).toEqual(bytes);
  });

  it('drops a transfer that goes quiet and ignores chunks nobody offered', async () => {
    let now = 1000;
    const store = memorySink();
    const statuses: ScanStatus[] = [];
    const receiver = new ScanReceiver({ sink: store.sink, send: (s) => statuses.push(s), confirm: async () => true, onSaved: () => {}, now: () => now, idleMs: 500 });
    await receiver.handle({ type: 'studio_scan_chunk', requestId: 'ghost', index: 0, crc32: 0, data: '' });
    expect(statuses.at(-1)).toMatchObject({ requestId: 'ghost', state: 'failed' });
    await receiver.handle({ type: 'studio_scan_offer', requestId: 'quiet', version: 1, name: 'q', bytes: 50_000, points: 1, sha256: 'c'.repeat(64), chunkBytes: SCAN_MIN_CHUNK_BYTES });
    expect(statuses.at(-1)).toMatchObject({ requestId: 'quiet', state: 'ready', next: 0 });
    now += 1000;
    await receiver.sweep();
    expect(statuses.at(-1)).toMatchObject({ requestId: 'quiet', state: 'failed' });
    expect(store.open.size).toBe(0);
  });
});
