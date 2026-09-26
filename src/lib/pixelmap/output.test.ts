import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import dgram from 'node:dgram';

const require = createRequire(import.meta.url);
const { createPixelMapOutput, normalizeFrame } = require('../../../electron/pixelmap-output.cjs');

const CID = '5f1b1c2e-8d3a-4c6b-9e0f-1a2b3c4d5e6f';
const sacn = { priority: 100, sourceName: 'Ghost Arcade', cid: CID };

interface SentPacket { packet: Buffer; port: number; host: string; done: (error?: Error | null) => void }

/** In-memory dgram: records packets, lets a test decide when sends complete. */
function fakeDgram(autoComplete = true) {
  const sent: SentPacket[] = [];
  let closed = 0;
  const api = {
    createSocket() {
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      return {
        on(event: string, listener: (...args: unknown[]) => void) {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        },
        once(event: string, listener: (...args: unknown[]) => void) { this.on(event, listener); },
        off(event: string, listener: (...args: unknown[]) => void) {
          listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener));
        },
        bind(_port: number, callback: () => void) { queueMicrotask(callback); },
        setBroadcast() {},
        send(packet: Buffer, _offset: number, _length: number, port: number, host: string, done: (error?: Error | null) => void) {
          const entry = { packet: Buffer.from(packet), port, host, done };
          sent.push(entry);
          if (autoComplete) queueMicrotask(() => done(null));
        },
        close() { closed += 1; },
      };
    },
  };
  return { api, sent, closedCount: () => closed };
}

const artDmx = (packet: Buffer) => packet.subarray(0, 8).toString('latin1') === 'Art-Net\0' && packet[9] === 0x50;
const artSync = (packet: Buffer) => packet.subarray(0, 8).toString('latin1') === 'Art-Net\0' && packet[9] === 0x52;

describe('frame validation', () => {
  const universe = (fields: Record<string, unknown>) => ({ universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: new Uint8Array(512), ...fields }] });

  it('accepts Art-Net, sACN multicast and sACN unicast targets', () => {
    const frame = normalizeFrame({
      fps: 40,
      sacn,
      universes: [
        { protocol: 'artnet', host: '10.0.0.255', universe: 3, data: new Uint8Array(512) },
        { protocol: 'sacn', host: null, universe: 1, data: new Uint8Array(512) },
        { protocol: 'sacn', host: '10.0.0.9', universe: 1, data: new Uint8Array(512) },
      ],
    });
    expect(frame.universes.map((u: { key: string }) => u.key)).toEqual([
      'artnet|10.0.0.255|3', 'sacn|multicast|1', 'sacn|10.0.0.9|1',
    ]);
  });

  it('clamps the frame rate to 1-60', () => {
    expect(normalizeFrame({ fps: 500, universes: [] }).fps).toBe(60);
    expect(normalizeFrame({ fps: 0, universes: [] }).fps).toBe(1);
    expect(normalizeFrame({ universes: [] }).fps).toBe(40);
  });

  it.each([
    [{ host: 'not-an-ip' }, /IPv4/],
    [{ host: '0.0.0.0' }, /IPv4/],
    [{ host: null }, /IPv4/],
    [{ universe: 32768 }, /0-32767/],
    [{ protocol: 'dmx' }, /Protocol/],
    [{ data: new Uint8Array(0) }, /1-512/],
    [{ data: new Uint8Array(600) }, /1-512/],
  ])('rejects %o', (fields, message) => {
    expect(() => normalizeFrame(universe(fields))).toThrow(message);
  });

  it('rejects bad sACN fields, duplicates and oversized frames', () => {
    const one = { protocol: 'sacn', host: null, universe: 1, data: new Uint8Array(4) };
    expect(() => normalizeFrame({ sacn, universes: [{ ...one, universe: 0 }] })).toThrow(/1-63999/);
    expect(() => normalizeFrame({ sacn: { ...sacn, priority: 250 }, universes: [one] })).toThrow(/priority/);
    expect(() => normalizeFrame({ sacn: { ...sacn, cid: 'x' }, universes: [one] })).toThrow(/CID/);
    expect(() => normalizeFrame({ sacn, universes: [one, one] })).toThrow(/twice/);
    const many = Array.from({ length: 1025 }, (_, index) => ({ ...one, universe: index + 1 }));
    expect(() => normalizeFrame({ sacn, universes: many })).toThrow(/1024/);
  });
});

describe('pixel map output', () => {
  it('sends ArtDmx with rising sequence numbers, then ArtSync', async () => {
    let clock = 0;
    const fake = fakeDgram();
    const output = createPixelMapOutput({ dgram: fake.api, now: () => clock });
    const frame = {
      fps: 40,
      artSync: true,
      universes: [
        { protocol: 'artnet', host: '127.0.0.1', universe: 0, data: new Uint8Array(512).fill(1) },
        { protocol: 'artnet', host: '127.0.0.1', universe: 1, data: new Uint8Array(512).fill(2) },
      ],
    };
    expect((await output.sendFrame(frame)).ok).toBe(true);
    clock += 25;
    await output.sendFrame(frame);
    expect(fake.sent.map(entry => [artSync(entry.packet) ? 'sync' : entry.packet[14], entry.packet[12], entry.port]))
      .toEqual([[0, 1, 6454], [1, 1, 6454], ['sync', 0, 6454], [0, 2, 6454], [1, 2, 6454], ['sync', 0, 6454]]);
  });

  it('routes sACN to the universe multicast group or a unicast node', async () => {
    const fake = fakeDgram();
    const output = createPixelMapOutput({ dgram: fake.api, now: () => 0 });
    await output.sendFrame({
      sacn,
      universes: [
        { protocol: 'sacn', host: null, universe: 258, data: new Uint8Array(3) },
        { protocol: 'sacn', host: '192.168.1.20', universe: 7, data: new Uint8Array(3) },
      ],
    });
    expect(fake.sent.map(entry => [entry.host, entry.port, entry.packet.readUInt16BE(113)])).toEqual([
      ['239.255.1.2', 5568, 258],
      ['192.168.1.20', 5568, 7],
    ]);
  });

  it('drops frames faster than the configured rate and counts them', async () => {
    let clock = 1000;
    const fake = fakeDgram();
    const output = createPixelMapOutput({ dgram: fake.api, now: () => clock });
    const frame = { fps: 40, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: new Uint8Array(2) }] };
    await output.sendFrame(frame);
    clock += 10; // 10ms after a 40fps frame is too early
    const early = await output.sendFrame(frame);
    expect(early).toMatchObject({ ok: true, dropped: true, reason: 'rate' });
    clock += 15;
    expect((await output.sendFrame(frame)).dropped).toBeUndefined();
    const stats = output.stats();
    expect(stats).toMatchObject({ framesSent: 2, framesDropped: 1, droppedRate: 1, fps: 2 });
    // 60fps is the hard ceiling even if a caller asks for more.
    clock += 10;
    expect((await output.sendFrame({ ...frame, fps: 240 })).reason).toBe('rate');
  });

  it('accepts timer jitter but holds the long-run rate to the setting', async () => {
    let clock = 0;
    const fake = fakeDgram();
    const output = createPixelMapOutput({ dgram: fake.api, now: () => clock });
    const frame = { fps: 40, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: new Uint8Array(2) }] };
    // Late, early, late, early around the 25ms period: nothing is dropped.
    for (const gap of [0, 31, 19, 33, 17, 25, 25]) {
      clock += gap;
      expect((await output.sendFrame(frame)).dropped).toBeUndefined();
    }
    // A caller pushing 100fps for a second gets about 40 frames through.
    const before = output.stats().framesSent;
    for (let index = 0; index < 100; index += 1) {
      clock += 10;
      await output.sendFrame(frame);
    }
    const accepted = output.stats().framesSent - before;
    expect(accepted).toBeGreaterThanOrEqual(39);
    expect(accepted).toBeLessThanOrEqual(42);
  });

  it('drops a frame while the previous one is still draining', async () => {
    let clock = 0;
    const fake = fakeDgram(false);
    const output = createPixelMapOutput({ dgram: fake.api, now: () => clock });
    const frame = { fps: 60, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: new Uint8Array(2) }] };
    await output.sendFrame(frame);
    clock += 100;
    expect((await output.sendFrame(frame)).reason).toBe('busy');
    fake.sent[0].done(null);
    clock += 100;
    expect((await output.sendFrame(frame)).dropped).toBeUndefined();
    expect(output.stats()).toMatchObject({ droppedBusy: 1, framesSent: 2 });
  });

  it('blacks out and terminates a universe that leaves the frame', async () => {
    let clock = 0;
    const fake = fakeDgram();
    const output = createPixelMapOutput({ dgram: fake.api, now: () => clock });
    const lit = new Uint8Array(6).fill(200);
    await output.sendFrame({
      sacn,
      universes: [
        { protocol: 'sacn', host: '127.0.0.1', universe: 1, data: lit },
        { protocol: 'artnet', host: '127.0.0.1', universe: 5, data: lit },
      ],
    });
    fake.sent.length = 0;
    clock += 100;
    await output.sendFrame({ sacn, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 5, data: lit }] });
    const sacnPackets = fake.sent.filter(entry => entry.port === 5568).map(entry => entry.packet);
    expect(sacnPackets).toHaveLength(4);
    expect(sacnPackets.every(packet => packet.subarray(126).every(value => value === 0))).toBe(true);
    expect(sacnPackets.map(packet => packet[112])).toEqual([0, 0x40, 0x40, 0x40]);
    expect(sacnPackets.map(packet => packet[111])).toEqual([1, 2, 3, 4]);
    expect(output.stats().universes).toBe(1);
  });

  it('stop() blacks out every universe, syncs, terminates sACN and closes the socket', async () => {
    const fake = fakeDgram();
    const output = createPixelMapOutput({ dgram: fake.api, now: () => 0 });
    const lit = new Uint8Array(4).fill(255);
    await output.sendFrame({
      artSync: true,
      sacn,
      universes: [
        { protocol: 'artnet', host: '127.0.0.1', universe: 0, data: lit },
        { protocol: 'sacn', host: null, universe: 9, data: lit },
      ],
    });
    fake.sent.length = 0;
    const result = output.stop();
    expect(result.terminated).toBe(2);
    const dmx = fake.sent.filter(entry => artDmx(entry.packet));
    expect(dmx).toHaveLength(1);
    expect(Array.from(dmx[0].packet.subarray(18))).toEqual([0, 0, 0, 0]);
    expect(fake.sent.filter(entry => artSync(entry.packet))).toHaveLength(1);
    expect(fake.sent.filter(entry => entry.port === 5568).map(entry => entry.packet[112])).toEqual([0, 0x40, 0x40, 0x40]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fake.closedCount()).toBe(1);
    expect(output.stats()).toMatchObject({ sending: false, universes: 0 });
    // A second stop has nothing left to send.
    fake.sent.length = 0;
    expect(output.stop().terminated).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it('reports invalid frames without sending', async () => {
    const fake = fakeDgram();
    const output = createPixelMapOutput({ dgram: fake.api });
    const result = await output.sendFrame({ universes: [{ protocol: 'artnet', host: 'bad', universe: 0, data: [0, 0] }] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/IPv4/);
    expect(fake.sent).toHaveLength(0);
  });
});

describe('pixel map output over UDP on 127.0.0.1', () => {
  const sockets: dgram.Socket[] = [];
  afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); });

  async function receiver() {
    const socket = dgram.createSocket('udp4');
    sockets.push(socket);
    const messages: Buffer[] = [];
    socket.on('message', message => messages.push(message));
    await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', () => resolve()));
    return { port: socket.address().port, messages };
  }

  it('delivers ArtDmx, ArtSync and E1.31 packets byte for byte', async () => {
    const artnet = await receiver();
    const sacnReceiver = await receiver();
    const output = createPixelMapOutput({ dgram, artnetPort: artnet.port, sacnPort: sacnReceiver.port });
    const red = new Uint8Array(510);
    for (let offset = 0; offset < red.length; offset += 3) red[offset] = 255;
    const result = await output.sendFrame({
      artSync: true,
      sacn,
      universes: [
        { protocol: 'artnet', host: '127.0.0.1', universe: 0, data: red },
        { protocol: 'sacn', host: '127.0.0.1', universe: 1, data: red },
      ],
    });
    expect(result.ok).toBe(true);
    const deadline = Date.now() + 2000;
    while ((artnet.messages.length < 2 || sacnReceiver.messages.length < 1) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(artnet.messages).toHaveLength(2);
    expect(artDmx(artnet.messages[0])).toBe(true);
    expect(Array.from(artnet.messages[0].subarray(18, 528))).toEqual(Array.from(red));
    expect(artSync(artnet.messages[1])).toBe(true);
    expect(sacnReceiver.messages[0].length).toBe(126 + 510);
    expect(Array.from(sacnReceiver.messages[0].subarray(126))).toEqual(Array.from(red));
    output.stop();
  });
});
