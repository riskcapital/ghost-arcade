import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseArtDmx, parseE131, isSacnSequenceStale } = require('../../../electron/dmx-input-packets.cjs');
const { buildArtDmxPacket, buildE131DataPacket } = require('../../../electron/pixelmap-packets.cjs');

const hex = (text: string) => Buffer.from(text.replace(/\s+/g, ''), 'hex');

// An ArtDmx frame as a desk puts it on the wire (captured layout): universe
// 0x0102 (Net 1, SubNet 0, Universe 2), sequence 0x2a, 4 channels.
const REAL_ARTDMX = hex(`
  41 72 74 2d 4e 65 74 00  00 50  00 0e  2a  00  02 01  00 04
  ff 80 00 11
`);

// An E1.31 data packet as a desk sends it: universe 1, priority 100,
// sequence 0x7b, source name "Desk". Field by field from the spec, so it
// does not depend on the pixel-map builder; layer lengths follow the size.
function realE131(slots = [0xff, 0x80, 0x00, 0x11]) {
  const size = 126 + slots.length;
  const bytes = Buffer.alloc(size);
  hex('0010 0000 4153432d45312e3137000000').copy(bytes, 0);
  bytes.writeUInt16BE(0x7000 | (size - 16), 16);
  hex('00000004').copy(bytes, 18);
  hex('a1b2c3d4e5f60718293a4b5c6d7e8f90').copy(bytes, 22); // CID
  bytes.writeUInt16BE(0x7000 | (size - 38), 38);
  hex('00000002').copy(bytes, 40);
  Buffer.from('Desk', 'utf8').copy(bytes, 44);
  bytes[108] = 100; // priority
  bytes.writeUInt16BE(0, 109); // sync address
  bytes[111] = 0x7b; // sequence
  bytes[112] = 0; // options
  bytes.writeUInt16BE(1, 113); // universe
  bytes.writeUInt16BE(0x7000 | (size - 115), 115);
  bytes[117] = 0x02;
  bytes[118] = 0xa1;
  bytes.writeUInt16BE(0, 119);
  bytes.writeUInt16BE(1, 121);
  bytes.writeUInt16BE(slots.length + 1, 123);
  bytes[125] = 0; // start code
  Buffer.from(slots).copy(bytes, 126);
  return bytes;
}

describe('ArtDmx parsing', () => {
  it('parses a real ArtDmx frame', () => {
    const packet = parseArtDmx(REAL_ARTDMX);
    expect(packet.ok).toBe(true);
    expect(packet.protocol).toBe('artnet');
    expect(packet.universe).toBe(0x0102);
    expect(packet.sequence).toBe(0x2a);
    expect(Array.from(packet.data)).toEqual([0xff, 0x80, 0x00, 0x11]);
  });

  it('round-trips the pixel-map builder for every universe bit', () => {
    const data = new Uint8Array(512).map((_, index) => (index * 7) & 0xff);
    for (const universe of [0, 15, 16, 255, 256, 0x1234, 32767]) {
      const parsed = parseArtDmx(buildArtDmxPacket({ universe, sequence: 9, data }));
      expect(parsed.ok).toBe(true);
      expect(parsed.universe).toBe(universe);
      expect(Array.from(parsed.data)).toEqual(Array.from(data));
    }
  });

  it('copies the slots instead of aliasing the socket buffer', () => {
    const buffer = Buffer.from(REAL_ARTDMX);
    const parsed = parseArtDmx(buffer);
    buffer[18] = 0;
    expect(parsed.data[0]).toBe(0xff);
  });

  it('rejects malformed, truncated and oversized frames', () => {
    const reason = (packet: Buffer | unknown) => parseArtDmx(packet).reason;
    expect(reason('Art-Net')).toBe('not-a-buffer');
    expect(reason(Buffer.alloc(4))).toBe('too-short');
    const badId = Buffer.from(REAL_ARTDMX); badId[3] = 0x78;
    expect(reason(badId)).toBe('bad-id');
    expect(reason(REAL_ARTDMX.subarray(0, 17))).toBe('too-short');
    const oldProtocol = Buffer.from(REAL_ARTDMX); oldProtocol[11] = 13;
    expect(reason(oldProtocol)).toBe('protocol-version');
    const zeroLength = Buffer.from(REAL_ARTDMX); zeroLength.writeUInt16BE(0, 16);
    expect(reason(zeroLength)).toBe('bad-length');
    const tooLong = Buffer.from(REAL_ARTDMX); tooLong.writeUInt16BE(513, 16);
    expect(reason(tooLong)).toBe('bad-length');
    const lies = Buffer.from(REAL_ARTDMX); lies.writeUInt16BE(64, 16);
    expect(reason(lies)).toBe('truncated');
    expect(reason(Buffer.concat([buildArtDmxPacket({ universe: 0, data: new Uint8Array(512) }), Buffer.alloc(1)]))).toBe('oversized');
  });

  it('reports other opcodes as non-DMX traffic', () => {
    const poll = Buffer.from(REAL_ARTDMX.subarray(0, 14)); poll.writeUInt16LE(0x2000, 8);
    expect(parseArtDmx(poll)).toMatchObject({ ok: false, reason: 'artnet-opcode', opcode: 0x2000 });
  });
});

describe('E1.31 parsing', () => {
  it('parses a real E1.31 data packet', () => {
    const packet = parseE131(realE131());
    expect(packet.ok).toBe(true);
    expect(packet).toMatchObject({
      protocol: 'sacn',
      universe: 1,
      sequence: 0x7b,
      priority: 100,
      terminated: false,
      sourceName: 'Desk',
      cid: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    });
    expect(Array.from(packet.data)).toEqual([0xff, 0x80, 0x00, 0x11]);
  });

  it('round-trips the pixel-map builder, including termination', () => {
    const data = new Uint8Array(512).map((_, index) => 255 - (index & 0xff));
    const built = buildE131DataPacket({
      universe: 63999, sequence: 200, priority: 150, sourceName: 'Ghost Arcade',
      cid: '5f1b1c2e-8d3a-4c6b-9e0f-1a2b3c4d5e6f', data, terminated: true,
    });
    const parsed = parseE131(built);
    expect(parsed.ok).toBe(true);
    expect(parsed.universe).toBe(63999);
    expect(parsed.priority).toBe(150);
    expect(parsed.terminated).toBe(true);
    expect(parsed.sourceName).toBe('Ghost Arcade');
    expect(Array.from(parsed.data)).toEqual(Array.from(data));
  });

  it('rejects every inconsistent header field', () => {
    const mutate = (edit: (packet: Buffer) => void) => {
      const packet = realE131();
      edit(packet);
      return parseE131(packet).reason;
    };
    expect(mutate(p => p.writeUInt16BE(0x0011, 0))).toBe('bad-preamble');
    expect(mutate(p => { p[4] = 0x42; })).toBe('bad-id');
    expect(mutate(p => p.writeUInt32BE(0x00000003, 18))).toBe('bad-root-vector');
    expect(mutate(p => p.writeUInt16BE(0x7000 | 50, 16))).toBe('bad-root-length');
    expect(mutate(p => p.writeUInt16BE(0x6000 | (p.length - 16), 16))).toBe('bad-root-length');
    expect(mutate(p => p.writeUInt16BE(0x7000 | 50, 38))).toBe('bad-framing-length');
    expect(mutate(p => p.writeUInt32BE(0x00000001, 40))).toBe('bad-framing-vector');
    expect(mutate(p => { p[108] = 201; })).toBe('bad-priority');
    expect(mutate(p => p.writeUInt16BE(0, 113))).toBe('bad-universe');
    expect(mutate(p => p.writeUInt16BE(64000, 113))).toBe('bad-universe');
    expect(mutate(p => p.writeUInt16BE(0x7000 | 9, 115))).toBe('bad-dmp-length');
    expect(mutate(p => { p[117] = 0x03; })).toBe('bad-dmp-vector');
    expect(mutate(p => { p[118] = 0xa0; })).toBe('bad-address-type');
    expect(mutate(p => p.writeUInt16BE(1, 119))).toBe('bad-first-address');
    expect(mutate(p => p.writeUInt16BE(2, 121))).toBe('bad-increment');
    expect(mutate(p => p.writeUInt16BE(4, 123))).toBe('bad-property-count');
    expect(mutate(p => { p[112] = 0x80; })).toBe('preview');
    expect(mutate(p => { p[125] = 0xdd; })).toBe('start-code');
  });

  it('rejects truncated, oversized and extended packets', () => {
    expect(parseE131(realE131().subarray(0, 100)).reason).toBe('too-short');
    expect(parseE131(Buffer.alloc(10)).reason).toBe('too-short');
    expect(parseE131(realE131(new Array(513).fill(1))).reason).toBe('oversized');
    const sync = realE131(); sync.writeUInt32BE(0x00000008, 18);
    expect(parseE131(sync).reason).toBe('sacn-extended');
    expect(parseE131(REAL_ARTDMX).ok).toBe(false);
    expect(parseArtDmx(realE131()).ok).toBe(false);
  });

  it('strips control characters from the source name', () => {
    const packet = realE131();
    Buffer.from('De\u0007sk', 'utf8').copy(packet, 44);
    expect(parseE131(packet).sourceName).toBe('Desk');
  });

  it('never throws on random input', () => {
    let seed = 1;
    const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    for (let run = 0; run < 2000; run += 1) {
      const packet = run % 2 ? realE131() : Buffer.from(REAL_ARTDMX);
      const flips = 1 + (random() % 6);
      for (let flip = 0; flip < flips; flip += 1) packet[random() % packet.length] = random() & 0xff;
      const cut = random() % 3 === 0 ? packet.subarray(0, random() % packet.length) : packet;
      expect(() => { parseArtDmx(cut); parseE131(cut); }).not.toThrow();
    }
  });
});

describe('sACN sequence ordering (E1.31 6.7.2)', () => {
  it('discards duplicates and packets up to 19 behind, accepts wraps and restarts', () => {
    expect(isSacnSequenceStale(null, 5)).toBe(false);
    expect(isSacnSequenceStale(10, 11)).toBe(false);
    expect(isSacnSequenceStale(10, 10)).toBe(true);
    expect(isSacnSequenceStale(10, 1)).toBe(true);
    expect(isSacnSequenceStale(30, 10)).toBe(false); // 20 behind: treated as a restart
    expect(isSacnSequenceStale(255, 0)).toBe(false);
    expect(isSacnSequenceStale(2, 250)).toBe(true); // 8 behind across the wrap
  });
});
