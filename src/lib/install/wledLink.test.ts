/**
 * WLED links (electron/wled-link.cjs) against a fake controller: a real UDP
 * listener on localhost that is stopped and started again on the same port.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import dgram from 'node:dgram';

const require = createRequire(import.meta.url);
const { createWledLinks } = require('../../../electron/wled-link.cjs');
const { buildWLEDRealtimePacket } = require('../../../electron/wled-packet.cjs');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeWled(port = 0): Promise<{ port: number; packets: Buffer[]; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const packets: Buffer[] = [];
    sock.on('message', (m) => packets.push(m));
    sock.once('error', reject);
    sock.bind(port, '127.0.0.1', () => {
      resolve({ port: sock.address().port, packets, close: () => new Promise((r) => sock.close(() => r())) });
    });
  });
}

let links: ReturnType<typeof createWledLinks> | null = null;
afterEach(() => { links?.closeAll(); links = null; });

/** Keep sending frames like the renderer does, for `ms`. */
async function pump(ms: number, port: number, every = 50) {
  const packet = buildWLEDRealtimePacket(new Uint8Array([255, 0, 0, 0, 255, 0]));
  const end = Date.now() + ms;
  const results: Array<{ ok: boolean; error?: string }> = [];
  while (Date.now() < end) {
    results.push(await links!.send({ controllerId: 'strip', name: 'Strip', ip: '127.0.0.1', port, packet }));
    await sleep(every);
  }
  return results;
}

describe('WLED links', () => {
  it('delivers frames and reports the controller up', async () => {
    const wled = await fakeWled();
    const changes: any[] = [];
    links = createWledLinks({ confirmMs: 300, onChange: (c: any) => changes.push(c) });
    await pump(600, wled.port);
    expect(wled.packets.length).toBeGreaterThan(3);
    expect(wled.packets[0][0]).toBe(2);
    expect(links.list()[0]).toMatchObject({ name: 'Strip', state: 'up' });
    expect(changes.map((c) => c.state)).toEqual(['up']);
    await wled.close();
  });

  it('notices a controller drop off, and reconnects by itself when it comes back', async () => {
    const wled = await fakeWled();
    const port = wled.port;
    const changes: any[] = [];
    links = createWledLinks({ confirmMs: 300, onChange: (c: any) => changes.push(c) });
    await pump(500, port);
    expect(links.list()[0].state).toBe('up');

    await wled.close();
    await pump(800, port);
    expect(links.list()[0].state).toBe('down');
    expect(links.list()[0].lastError).toBe('ECONNREFUSED');

    // Back on the same address. The link is remade after its backoff and
    // frames reach the controller again without anyone doing anything.
    const back = await fakeWled(port);
    await pump(3500, port);
    expect(back.packets.length).toBeGreaterThan(5);
    expect(links.list()[0].state).toBe('up');
    expect(changes.map((c) => c.state)).toEqual(['up', 'down', 'up']);
    expect(changes[2].previous).toBe('down');
    expect(changes[2].downForMs).toBeGreaterThan(0);
    await back.close();
  }, 15_000);

  it('drops frames instead of queueing while sends are in flight', async () => {
    const wled = await fakeWled();
    links = createWledLinks({ confirmMs: 300, maxInFlight: 1 });
    const packet = buildWLEDRealtimePacket(new Uint8Array([1, 2, 3]));
    await links.send({ controllerId: 'a', ip: '127.0.0.1', port: wled.port, packet });
    await sleep(50);
    const burst = await Promise.all(Array.from({ length: 5 }, () => links!.send({ controllerId: 'a', ip: '127.0.0.1', port: wled.port, packet })));
    expect(burst.some((r: any) => r.dropped)).toBe(true);
    await wled.close();
  });

  it('starts a fresh link when the address changes, and closes cleanly', async () => {
    const a = await fakeWled();
    const b = await fakeWled();
    links = createWledLinks({ confirmMs: 100 });
    await pump(200, a.port);
    await pump(300, b.port);
    expect(b.packets.length).toBeGreaterThan(0);
    expect(links.list()[0].port).toBe(b.port);
    links.close('strip');
    expect(links.size()).toBe(0);
    await a.close();
    await b.close();
  });
});

describe('WLED links: late errors', () => {
  /** A dgram stand-in whose sends complete when the test says. */
  function fakeDgram() {
    const pending: Array<(err: Error | null) => void> = [];
    const dgram = {
      createSocket: () => ({
        on: () => {},
        connect: (_p: number, _ip: string, cb: (err?: Error) => void) => cb(),
        send: (_b: unknown, cb: (err: Error | null) => void) => { pending.push(cb); },
        close: () => {},
      }),
    };
    return { dgram, pending };
  }

  it('a second send failing on the socket the first error closed is not counted again', async () => {
    const { dgram, pending } = fakeDgram();
    const timers: Array<() => void> = [];
    const l = createWledLinks({ dgram, confirmMs: 0, setTimer: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
    const msg = { controllerId: 'strip', name: 'Strip', ip: '10.0.0.9', port: 21324, packet: Buffer.from([2]) };
    const a = l.send(msg);
    const b = l.send(msg);
    const err = Object.assign(new Error('unreachable'), { code: 'EHOSTUNREACH' });
    pending[0](err);
    pending[1](err);
    await Promise.all([a, b]);
    expect(l.list()[0]).toMatchObject({ state: 'down', errors: 1 });
    expect(timers).toHaveLength(1);
  });

  it('a late error after the link was closed does nothing', async () => {
    const { dgram, pending } = fakeDgram();
    const changes: unknown[] = [];
    const l = createWledLinks({ dgram, confirmMs: 0, onChange: (c: unknown) => changes.push(c) });
    const msg = { controllerId: 'strip', name: 'Strip', ip: '10.0.0.9', port: 21324, packet: Buffer.from([2]) };
    const a = l.send(msg);
    l.close('strip');
    pending[0](new Error('late'));
    await a;
    expect(l.size()).toBe(0);
    expect(changes).toEqual([]);
  });
});
