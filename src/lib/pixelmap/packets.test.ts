import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const {
  buildArtDmxPacket,
  buildArtSyncPacket,
  buildE131DataPacket,
  nextArtNetSequence,
  nextSacnSequence,
  parseSacnCid,
  sacnMulticastAddress,
} = createRequire(import.meta.url)('../../../electron/pixelmap-packets.cjs');

const CID = '5f1b1c2e-8d3a-4c6b-9e0f-1a2b3c4d5e6f';
const bytes = (packet: Buffer, start: number, end: number) => Array.from(packet.subarray(start, end));

describe('ArtDmx (Art-Net 4, OpCode 0x5000)', () => {
  it('writes the 18-byte header and the channel data', () => {
    const data = new Uint8Array(512).map((_, index) => index & 0xff);
    const packet: Buffer = buildArtDmxPacket({ universe: 0, sequence: 7, data });
    expect(packet.length).toBe(18 + 512);
    expect(packet.subarray(0, 8).toString('latin1')).toBe('Art-Net\0');
    expect(bytes(packet, 8, 10)).toEqual([0x00, 0x50]); // OpCode, little-endian
    expect(bytes(packet, 10, 12)).toEqual([0, 14]); // ProtVerHi, ProtVerLo
    expect(packet[12]).toBe(7); // Sequence
    expect(packet[13]).toBe(0); // Physical
    expect(bytes(packet, 14, 16)).toEqual([0, 0]); // SubUni, Net
    expect(bytes(packet, 16, 18)).toEqual([0x02, 0x00]); // Length, big-endian
    expect(bytes(packet, 18, 530)).toEqual(Array.from(data));
  });

  it('splits the 15-bit Port-Address into SubUni and Net', () => {
    const packet: Buffer = buildArtDmxPacket({ universe: 0x1234, data: [1, 2] });
    expect(packet[14]).toBe(0x34); // SubNet 3, Universe 4
    expect(packet[15]).toBe(0x12); // Net 0x12
    const top: Buffer = buildArtDmxPacket({ universe: 32767, data: [0, 0] });
    expect(bytes(top, 14, 16)).toEqual([0xff, 0x7f]);
    const sixteen: Buffer = buildArtDmxPacket({ universe: 16, data: [0, 0] });
    expect(bytes(sixteen, 14, 16)).toEqual([0x10, 0x00]);
  });

  it('pads odd channel counts to an even length', () => {
    const packet: Buffer = buildArtDmxPacket({ universe: 1, data: [255, 128, 64] });
    expect(bytes(packet, 16, 18)).toEqual([0, 4]);
    expect(bytes(packet, 18, 22)).toEqual([255, 128, 64, 0]);
    const single: Buffer = buildArtDmxPacket({ universe: 1, data: [9] });
    expect(bytes(single, 16, 20)).toEqual([0, 2, 9, 0]);
  });

  it('rejects out-of-range universes, sequences and data', () => {
    expect(() => buildArtDmxPacket({ universe: -1, data: [0, 0] })).toThrow(/0-32767/);
    expect(() => buildArtDmxPacket({ universe: 32768, data: [0, 0] })).toThrow(/0-32767/);
    expect(() => buildArtDmxPacket({ universe: 1.5, data: [0, 0] })).toThrow(/0-32767/);
    expect(() => buildArtDmxPacket({ universe: 0, sequence: 256, data: [0, 0] })).toThrow(/sequence/);
    expect(() => buildArtDmxPacket({ universe: 0, data: [] })).toThrow(/1-512/);
    expect(() => buildArtDmxPacket({ universe: 0, data: new Uint8Array(513) })).toThrow(/1-512/);
    expect(() => buildArtDmxPacket({ universe: 0, data: [256, 0] })).toThrow(/0-255/);
    expect(() => buildArtDmxPacket({ universe: 0, data: [1.5, 0] })).toThrow(/0-255/);
    expect(() => buildArtDmxPacket({ universe: 0, data: null })).toThrow(/1-512/);
  });

  it('runs sequence numbers 1-255, skipping 0', () => {
    expect(nextArtNetSequence(0)).toBe(1);
    expect(nextArtNetSequence(1)).toBe(2);
    expect(nextArtNetSequence(254)).toBe(255);
    expect(nextArtNetSequence(255)).toBe(1);
  });
});

describe('ArtSync (OpCode 0x5200)', () => {
  it('is exactly 14 bytes', () => {
    expect(Array.from(buildArtSyncPacket() as Buffer)).toEqual([
      0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00, 0x00, 0x52, 0x00, 14, 0x00, 0x00,
    ]);
  });
});

describe('E1.31 data packet', () => {
  it('writes the root, framing and DMP layers for a full universe', () => {
    const data = new Uint8Array(512).map((_, index) => (index * 7) & 0xff);
    const packet: Buffer = buildE131DataPacket({
      universe: 1,
      sequence: 42,
      priority: 100,
      sourceName: 'Ghost Arcade',
      cid: CID,
      data,
    });
    expect(packet.length).toBe(638);
    // Root layer
    expect(bytes(packet, 0, 4)).toEqual([0x00, 0x10, 0x00, 0x00]);
    expect(bytes(packet, 4, 16)).toEqual([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0, 0, 0]);
    expect(bytes(packet, 16, 18)).toEqual([0x72, 0x6e]); // flags 0x7, length 622
    expect(bytes(packet, 18, 22)).toEqual([0, 0, 0, 0x04]); // VECTOR_ROOT_E131_DATA
    expect(bytes(packet, 22, 38)).toEqual(Array.from(parseSacnCid(CID) as Buffer));
    expect(Buffer.from(packet.subarray(22, 38)).toString('hex')).toBe(CID.replace(/-/g, ''));
    // Framing layer
    expect(bytes(packet, 38, 40)).toEqual([0x72, 0x58]); // length 600
    expect(bytes(packet, 40, 44)).toEqual([0, 0, 0, 0x02]); // VECTOR_E131_DATA_PACKET
    expect(packet.subarray(44, 56).toString('utf8')).toBe('Ghost Arcade');
    expect(packet.subarray(56, 108).every(value => value === 0)).toBe(true);
    expect(packet[108]).toBe(100); // priority
    expect(bytes(packet, 109, 111)).toEqual([0, 0]); // sync address
    expect(packet[111]).toBe(42); // sequence
    expect(packet[112]).toBe(0); // options
    expect(bytes(packet, 113, 115)).toEqual([0, 1]); // universe
    // DMP layer
    expect(bytes(packet, 115, 117)).toEqual([0x72, 0x0b]); // length 523
    expect(packet[117]).toBe(0x02); // VECTOR_DMP_SET_PROPERTY
    expect(packet[118]).toBe(0xa1); // address and data type
    expect(bytes(packet, 119, 121)).toEqual([0, 0]); // first property address
    expect(bytes(packet, 121, 123)).toEqual([0, 1]); // address increment
    expect(bytes(packet, 123, 125)).toEqual([0x02, 0x01]); // 513 property values
    expect(packet[125]).toBe(0x00); // DMX start code
    expect(bytes(packet, 126, 638)).toEqual(Array.from(data));
  });

  it('sizes every layer from the slot count', () => {
    const packet: Buffer = buildE131DataPacket({ universe: 0x1234, cid: CID, data: [10, 20, 30] });
    expect(packet.length).toBe(129);
    expect(packet.readUInt16BE(16)).toBe(0x7000 | (129 - 16));
    expect(packet.readUInt16BE(38)).toBe(0x7000 | (129 - 38));
    expect(packet.readUInt16BE(115)).toBe(0x7000 | (129 - 115));
    expect(packet.readUInt16BE(123)).toBe(4);
    expect(bytes(packet, 113, 115)).toEqual([0x12, 0x34]);
    expect(bytes(packet, 125, 129)).toEqual([0, 10, 20, 30]);
  });

  it('sets the preview, stream terminated and force sync option bits', () => {
    expect(buildE131DataPacket({ universe: 1, cid: CID, data: [0], terminated: true })[112]).toBe(0x40);
    expect(buildE131DataPacket({ universe: 1, cid: CID, data: [0], preview: true })[112]).toBe(0x80);
    expect(buildE131DataPacket({ universe: 1, cid: CID, data: [0], forceSync: true })[112]).toBe(0x20);
  });

  it('null-terminates and truncates the source name on a UTF-8 boundary', () => {
    const long: Buffer = buildE131DataPacket({ universe: 1, cid: CID, data: [0], sourceName: 'x'.repeat(80) });
    expect(long.subarray(44, 107).toString('utf8')).toBe('x'.repeat(63));
    expect(long[107]).toBe(0);
    const accented: Buffer = buildE131DataPacket({ universe: 1, cid: CID, data: [0], sourceName: `${'a'.repeat(62)}é` });
    // é is two bytes; it would end at byte 64, so it is dropped rather than split.
    expect(accented.subarray(44, 108).toString('utf8').replace(/\0+$/, '')).toBe('a'.repeat(62));
    const fallback: Buffer = buildE131DataPacket({ universe: 1, cid: CID, data: [0], sourceName: '  ' });
    expect(fallback.subarray(44, 56).toString('utf8')).toBe('Ghost Arcade');
  });

  it('rejects out-of-range fields', () => {
    expect(() => buildE131DataPacket({ universe: 0, cid: CID, data: [0] })).toThrow(/1-63999/);
    expect(() => buildE131DataPacket({ universe: 64000, cid: CID, data: [0] })).toThrow(/1-63999/);
    expect(() => buildE131DataPacket({ universe: 1, cid: CID, data: [0], priority: 201 })).toThrow(/priority/);
    expect(() => buildE131DataPacket({ universe: 1, cid: CID, data: [0], sequence: -1 })).toThrow(/sequence/);
    expect(() => buildE131DataPacket({ universe: 1, cid: 'nope', data: [0] })).toThrow(/CID/);
    expect(() => buildE131DataPacket({ universe: 1, cid: CID, data: new Uint8Array(513) })).toThrow(/1-512/);
  });

  it('wraps sequence numbers through 0', () => {
    expect(nextSacnSequence(undefined)).toBe(0);
    expect(nextSacnSequence(0)).toBe(1);
    expect(nextSacnSequence(255)).toBe(0);
  });

  it('derives the multicast group from the universe', () => {
    expect(sacnMulticastAddress(1)).toBe('239.255.0.1');
    expect(sacnMulticastAddress(255)).toBe('239.255.0.255');
    expect(sacnMulticastAddress(256)).toBe('239.255.1.0');
    expect(sacnMulticastAddress(0x1234)).toBe('239.255.18.52');
    expect(sacnMulticastAddress(63999)).toBe('239.255.249.255');
    expect(() => sacnMulticastAddress(0)).toThrow();
    expect(() => sacnMulticastAddress(64000)).toThrow();
  });
});
