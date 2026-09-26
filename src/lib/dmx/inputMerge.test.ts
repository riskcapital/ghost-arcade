import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import dgram from 'node:dgram';

const require = createRequire(import.meta.url);
const { createUniverseMerge, createDmxInput, normalizeInputConfig } = require('../../../electron/dmx-input.cjs');
const { buildArtDmxPacket, buildE131DataPacket } = require('../../../electron/pixelmap-packets.cjs');

const CID_A = '11111111-1111-4111-8111-111111111111';
const CID_B = '22222222-2222-4222-8222-222222222222';

function art(data: number[], universe = 0) {
  return { protocol: 'artnet', universe, sequence: 0, priority: null, terminated: false, data: Uint8Array.from(data) };
}
function sacn(data: number[], { priority = 100, sequence = 0, terminated = false } = {}) {
  return { protocol: 'sacn', universe: 1, sequence, priority, terminated, data: Uint8Array.from(data), sourceName: 'x' };
}
const head = (merge: { merged: Uint8Array }, count = 4) => Array.from(merge.merged.subarray(0, count));

describe('universe merge', () => {
  it('HTP takes the highest value per channel', () => {
    const merge = createUniverseMerge('htp');
    merge.receive('a', art([10, 200, 0, 50]), 0);
    merge.receive('b', art([100, 20, 0]), 0);
    expect(head(merge)).toEqual([100, 200, 0, 50]);
  });

  it('LTP gives each channel to the source that last changed it', () => {
    const merge = createUniverseMerge('ltp');
    merge.receive('a', art([10, 10, 10]), 0);
    merge.receive('b', art([20, 20, 20]), 1); // a new source claims every channel it sends
    expect(head(merge, 3)).toEqual([20, 20, 20]);
    merge.receive('a', art([10, 99, 10]), 2); // only channel 2 moved on A
    expect(head(merge, 3)).toEqual([20, 99, 20]);
    merge.receive('b', art([20, 20, 20]), 3); // B repeats itself: no change, A keeps channel 2
    expect(head(merge, 3)).toEqual([20, 99, 20]);
    merge.receive('b', art([5, 20, 20]), 4);
    expect(head(merge, 3)).toEqual([5, 99, 20]);
  });

  it('priority mode lets the highest sACN priority win and HTP-merges ties', () => {
    const merge = createUniverseMerge('priority');
    merge.receive('low', sacn([255, 255], { priority: 50 }), 0);
    merge.receive('high', sacn([10, 0], { priority: 150 }), 0);
    expect(head(merge, 2)).toEqual([10, 0]);
    merge.receive('tie', sacn([0, 40], { priority: 150 }), 0);
    expect(head(merge, 2)).toEqual([10, 40]);
    // Art-Net counts as priority 100.
    const mixed = createUniverseMerge('priority');
    mixed.receive('art', art([200]), 0);
    mixed.receive('s', sacn([30], { priority: 101 }), 0);
    expect(head(mixed, 1)).toEqual([30]);
  });

  it('switching the merge rule re-merges at once', () => {
    const merge = createUniverseMerge('htp');
    merge.receive('low', sacn([255], { priority: 50 }), 0);
    merge.receive('high', sacn([10], { priority: 150 }), 0);
    expect(head(merge, 1)).toEqual([255]);
    expect(merge.setMode('priority')).toBe(true);
    expect(head(merge, 1)).toEqual([10]);
  });

  it('drops stale sources, re-merges, and holds the look when the last one goes', () => {
    const merge = createUniverseMerge('htp');
    merge.receive('a', art([255, 0]), 0);
    merge.receive('b', art([0, 128]), 2000);
    expect(merge.expire(2400, 2500)).toEqual({ dropped: 0, changed: false });
    expect(merge.expire(2600, 2500)).toEqual({ dropped: 1, changed: true });
    expect(head(merge, 2)).toEqual([0, 128]);
    expect(merge.expire(10000, 2500).dropped).toBe(1);
    expect(merge.sources.size).toBe(0);
    expect(head(merge, 2)).toEqual([0, 128]);
  });

  it('sACN Stream_Terminated releases the source immediately', () => {
    const merge = createUniverseMerge('htp');
    merge.receive('a', sacn([255], { sequence: 1 }), 0);
    merge.receive('b', sacn([40], { sequence: 1 }), 0);
    const result = merge.receive('a', sacn([255], { sequence: 2, terminated: true }), 0);
    expect(result.terminated).toBe(true);
    expect(merge.sources.has('a')).toBe(false);
    expect(head(merge, 1)).toEqual([40]);
  });

  it('discards out-of-order sACN packets', () => {
    const merge = createUniverseMerge('htp');
    merge.receive('a', sacn([50], { sequence: 10 }), 0);
    expect(merge.receive('a', sacn([99], { sequence: 9 }), 0)).toMatchObject({ accepted: false, reason: 'out-of-order' });
    expect(head(merge, 1)).toEqual([50]);
    merge.receive('a', sacn([60], { sequence: 11 }), 0);
    expect(head(merge, 1)).toEqual([60]);
  });

  it('a shorter packet zeroes the channels it stopped sending', () => {
    const merge = createUniverseMerge('htp');
    merge.receive('a', art([9, 9, 9, 9]), 0);
    merge.receive('a', art([9, 9]), 1);
    expect(head(merge, 4)).toEqual([9, 9, 0, 0]);
  });

  it('caps the number of sources per universe', () => {
    const merge = createUniverseMerge('htp');
    for (let index = 0; index < 8; index += 1) expect(merge.receive(`s${index}`, art([1]), 0).accepted).toBe(true);
    expect(merge.receive('s8', art([1]), 0)).toMatchObject({ accepted: false, reason: 'too-many-sources' });
  });
});

describe('input config', () => {
  it('defaults to all interfaces, both protocols, HTP and a 2.5 s timeout', () => {
    expect(normalizeInputConfig({})).toMatchObject({
      bindAddress: '0.0.0.0', artnet: true, sacn: true, mergeMode: 'htp', timeoutMs: 2500, universes: [], artnetPort: 6454, sacnPort: 5568,
    });
  });

  it('rejects bad input', () => {
    expect(() => normalizeInputConfig({ bindAddress: 'example.com' })).toThrow(/IPv4/);
    expect(() => normalizeInputConfig({ bindAddress: '300.1.1.1' })).toThrow(/IPv4/);
    expect(() => normalizeInputConfig({ artnet: false, sacn: false })).toThrow();
    expect(() => normalizeInputConfig({ universes: [1.5] })).toThrow(/Universes/);
    expect(() => normalizeInputConfig({ universes: new Array(65).fill(0).map((_, i) => i) })).toThrow(/64/);
    expect(() => normalizeInputConfig({ mergeMode: 'max' })).toThrow(/Merge/);
    expect(normalizeInputConfig({ timeoutMs: 1 }).timeoutMs).toBe(250);
  });
});

/** Fake dgram that lets the test deliver datagrams. */
function fakeDgram() {
  const sockets: Array<{ bound: { port: number; address: string }; memberships: string[]; emit: (message: Buffer, rinfo: object) => void; closed: boolean }> = [];
  return {
    sockets,
    api: {
      createSocket() {
        const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
        const socket = {
          bound: { port: 0, address: '' },
          memberships: [] as string[],
          closed: false,
          emit(message: Buffer, rinfo: object) { for (const listener of listeners.get('message') ?? []) listener(message, rinfo); },
          on(event: string, listener: (...args: unknown[]) => void) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
          bind(options: { port: number; address: string }, callback: () => void) { socket.bound = options; queueMicrotask(callback); },
          addMembership(group: string) { socket.memberships.push(group); },
          close() { socket.closed = true; },
        };
        sockets.push(socket);
        return socket;
      },
    },
  };
}

function manualClock() {
  let time = 0;
  const timeouts: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => time,
    setTimeoutFn: (fn: () => void, wait: number) => { const entry = { at: time + wait, fn }; timeouts.push(entry); return entry; },
    clearTimeoutFn: (entry: unknown) => { const index = timeouts.indexOf(entry as never); if (index >= 0) timeouts.splice(index, 1); },
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    advance(ms: number) {
      time += ms;
      for (const entry of [...timeouts].sort((a, b) => a.at - b.at)) {
        if (entry.at <= time) { timeouts.splice(timeouts.indexOf(entry), 1); entry.fn(); }
      }
    },
  };
}

describe('DMX input listener', () => {
  const rinfo = { address: '10.0.0.5', port: 6454 };

  async function started(config: Record<string, unknown> = {}) {
    const fake = fakeDgram();
    const clock = manualClock();
    const batches: Array<{ universes: Array<{ protocol: string; universe: number; changes: number[] }> }> = [];
    const input = createDmxInput({ dgram: fake.api, ...clock, onChanges: (batch: never) => batches.push(batch), log: { warn() {} } });
    const result = await input.start({ bindAddress: '127.0.0.1', ...config });
    return { fake, clock, batches, input, result };
  }

  it('binds both sockets to the chosen address with the Art-Net and sACN ports', async () => {
    const { fake, result } = await started({ sacnMulticast: false });
    expect(result.ok).toBe(true);
    expect(fake.sockets.map(socket => socket.bound)).toEqual([
      { port: 6454, address: '127.0.0.1', exclusive: false },
      { port: 5568, address: '127.0.0.1', exclusive: false },
    ]);
  });

  it('joins sACN multicast groups for filtered universes', async () => {
    const { fake } = await started({ universes: [0, 1, 256] });
    expect(fake.sockets[1].memberships).toEqual(['239.255.0.1', '239.255.1.0']);
  });

  it('sends only changed channels, coalesced to the frame rate', async () => {
    const { fake, clock, batches, input } = await started({ rateHz: 40 });
    const artnet = fake.sockets[0];
    const data = new Uint8Array(512);
    data[0] = 10;
    artnet.emit(buildArtDmxPacket({ universe: 3, data }), rinfo);
    clock.advance(0);
    expect(batches).toEqual([{ universes: [{ protocol: 'artnet', universe: 3, changes: [0, 10] }] }]);

    // Three packets inside one 25 ms window become one batch with the latest values.
    for (const value of [20, 30, 40]) {
      data[0] = value;
      data[511] = value;
      artnet.emit(buildArtDmxPacket({ universe: 3, data }), rinfo);
    }
    clock.advance(10);
    expect(batches).toHaveLength(1);
    clock.advance(15);
    expect(batches[1]).toEqual({ universes: [{ protocol: 'artnet', universe: 3, changes: [0, 40, 511, 40] }] });

    // An identical frame sends nothing.
    artnet.emit(buildArtDmxPacket({ universe: 3, data }), rinfo);
    clock.advance(100);
    expect(batches).toHaveLength(2);
    expect(input.status().stats).toMatchObject({ received: 5, accepted: 5, malformed: 0 });
  });

  it('counts malformed and filtered packets and ignores them', async () => {
    const { fake, clock, batches, input } = await started({ universes: [1] });
    const [artnet, sacnSocket] = fake.sockets;
    artnet.emit(Buffer.from([...Buffer.from('Art-Net\0', 'latin1'), 0x00, 0x50, 0, 14]), rinfo); // truncated ArtDmx
    artnet.emit(buildArtDmxPacket({ universe: 2, data: [255, 255] }), rinfo);
    sacnSocket.emit(buildArtDmxPacket({ universe: 1, data: [255, 255] }), rinfo);
    clock.advance(100);
    expect(batches).toHaveLength(0);
    expect(input.status().stats).toMatchObject({ received: 3, malformed: 2, filtered: 1, accepted: 0 });
  });

  it('keeps Art-Net and sACN universes apart and merges sACN sources by CID', async () => {
    const { fake, clock, batches } = await started({ mergeMode: 'priority', sacnMulticast: false });
    const sacnSocket = fake.sockets[1];
    sacnSocket.emit(buildE131DataPacket({ universe: 1, cid: CID_A, priority: 100, data: [200] }), rinfo);
    sacnSocket.emit(buildE131DataPacket({ universe: 1, cid: CID_B, priority: 120, data: [50] }), { address: '10.0.0.6', port: 5568 });
    clock.advance(100);
    expect(batches.at(-1)).toEqual({ universes: [{ protocol: 'sacn', universe: 1, changes: [0, 50] }] });
  });

  it('expires silent sources on the stale timer', async () => {
    const { fake, clock, batches, input } = await started({ timeoutMs: 1000 });
    const artnet = fake.sockets[0];
    artnet.emit(buildArtDmxPacket({ universe: 0, data: [255, 0] }), rinfo);
    artnet.emit(buildArtDmxPacket({ universe: 0, data: [0, 99] }), { address: '10.0.0.9', port: 6454 });
    clock.advance(50);
    expect(batches.at(-1)!.universes[0].changes).toEqual([0, 255, 1, 99]);
    clock.advance(2000);
    artnet.emit(buildArtDmxPacket({ universe: 0, data: [0, 99] }), { address: '10.0.0.9', port: 6454 });
    input._expire();
    clock.advance(50);
    expect(batches.at(-1)!.universes[0].changes).toEqual([0, 0]);
    expect(input.status().universes[0].sources).toHaveLength(1);
  });

  it('ignores its own pixel-map output', async () => {
    const fake = fakeDgram();
    const clock = manualClock();
    const batches: unknown[] = [];
    const input = createDmxInput({
      dgram: fake.api, ...clock, onChanges: (batch: unknown) => batches.push(batch),
      isOwnPacket: (info: { port: number }) => info.port === 50000,
    });
    await input.start({});
    fake.sockets[0].emit(buildArtDmxPacket({ universe: 0, data: [1, 2] }), { address: '127.0.0.1', port: 50000 });
    clock.advance(100);
    expect(batches).toHaveLength(0);
    expect(input.status().stats.own).toBe(1);
  });

  it('resync resends every non-zero channel', async () => {
    const { fake, clock, batches, input } = await started();
    fake.sockets[0].emit(buildArtDmxPacket({ universe: 0, data: [0, 7] }), rinfo);
    clock.advance(50);
    input.resync();
    clock.advance(50);
    expect(batches).toHaveLength(2);
    expect(batches[1].universes[0].changes).toEqual([1, 7]);
    expect(input.snapshot({ protocol: 'artnet', universe: 0 })!.slice(0, 2)).toEqual([0, 7]);
  });

  it('stop closes both sockets and drops state', async () => {
    const { fake, input } = await started();
    input.stop();
    expect(fake.sockets.every(socket => socket.closed)).toBe(true);
    expect(input.status()).toMatchObject({ running: false, universes: [] });
  });
});

describe('DMX input on a real loopback socket', () => {
  let input: ReturnType<typeof createDmxInput> | null = null;
  afterEach(() => { input?.stop(); input = null; });

  it('receives ArtDmx and E1.31 sent to 127.0.0.1', async () => {
    const batches: Array<{ universes: Array<{ protocol: string; universe: number; changes: number[] }> }> = [];
    input = createDmxInput({ dgram, onChanges: (batch: never) => batches.push(batch), log: { warn() {} } });
    // Ephemeral-ish high ports keep this clear of a real desk or another app.
    const artnetPort = 46454 + Math.floor(Math.random() * 500);
    const sacnPort = artnetPort + 600;
    const result = await input.start({ bindAddress: '127.0.0.1', artnetPort, sacnPort, sacnMulticast: false });
    expect(result.ok).toBe(true);
    const sender = dgram.createSocket('udp4');
    await new Promise<void>(resolve => sender.send(buildArtDmxPacket({ universe: 5, data: [1, 2, 3, 4] }), artnetPort, '127.0.0.1', () => resolve()));
    await new Promise<void>(resolve => sender.send(buildE131DataPacket({ universe: 7, cid: CID_A, data: [9] }), sacnPort, '127.0.0.1', () => resolve()));
    const deadline = Date.now() + 2000;
    while (batches.flatMap(batch => batch.universes).length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    sender.close();
    const seen = batches.flatMap(batch => batch.universes);
    expect(seen).toContainEqual({ protocol: 'artnet', universe: 5, changes: [0, 1, 1, 2, 2, 3, 3, 4] });
    expect(seen).toContainEqual({ protocol: 'sacn', universe: 7, changes: [0, 9] });
  });
});
