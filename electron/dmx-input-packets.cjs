// Strict parsers for inbound Art-Net ArtDmx and ANSI E1.31 (sACN) data
// packets. Pure functions: nothing here throws on hostile input. Every
// header field that the sender controls is checked against the packet's
// real size before it is trusted, and anything malformed, truncated or
// oversized comes back as { ok: false, reason } so the listener can count
// it and move on.

const ARTNET_HEADER_BYTES = 18;
const DMX_SLOTS = 512;
const ARTNET_MAX_PACKET = ARTNET_HEADER_BYTES + DMX_SLOTS; // 530
const ARTNET_MIN_PROTOCOL = 14;
const OP_DMX = 0x5000;
const OP_POLL = 0x2000;
const OP_SYNC = 0x5200;
const ARTNET_ID = Buffer.from('Art-Net\0', 'latin1');

const SACN_HEADER_BYTES = 126; // Root 38 + Framing 77 + DMP 10 + start code 1
const SACN_MAX_PACKET = SACN_HEADER_BYTES + DMX_SLOTS; // 638
const ACN_PACKET_IDENTIFIER = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);
const VECTOR_ROOT_E131_DATA = 0x00000004;
const VECTOR_ROOT_E131_EXTENDED = 0x00000008;
const VECTOR_E131_DATA_PACKET = 0x00000002;
const VECTOR_DMP_SET_PROPERTY = 0x02;
const SACN_MIN_UNIVERSE = 1;
const SACN_MAX_UNIVERSE = 63999;
const SACN_MAX_PRIORITY = 200;
const SACN_OPTION_PREVIEW = 0x80;
const SACN_OPTION_TERMINATED = 0x40;

function reject(reason) {
  return { ok: false, reason };
}

function isBuffer(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * ArtDmx (OpCode 0x5000). Returns
 * { ok: true, protocol: 'artnet', universe, sequence, physical, data }
 * where `data` is a copy of the 1-512 slots, or { ok: false, reason }.
 * Other Art-Net OpCodes (ArtPoll, ArtSync, ...) come back as
 * reason 'artnet-opcode' with the opcode, so they are not counted as junk.
 */
function parseArtDmx(input) {
  if (!isBuffer(input)) return reject('not-a-buffer');
  const packet = asBuffer(input);
  if (packet.length < 12) return reject('too-short');
  if (packet.length > ARTNET_MAX_PACKET) return reject('oversized');
  if (!packet.subarray(0, 8).equals(ARTNET_ID)) return reject('bad-id');
  const opcode = packet.readUInt16LE(8);
  if (opcode !== OP_DMX) return { ok: false, reason: 'artnet-opcode', opcode };
  if (packet.length < ARTNET_HEADER_BYTES) return reject('too-short');
  const protocolVersion = packet.readUInt16BE(10);
  if (protocolVersion < ARTNET_MIN_PROTOCOL) return reject('protocol-version');
  const length = packet.readUInt16BE(16);
  // The spec asks for an even 2-512; odd lengths from lenient senders are
  // harmless, so 1-512 is accepted. The length must fit in the datagram.
  if (length < 1 || length > DMX_SLOTS) return reject('bad-length');
  if (packet.length < ARTNET_HEADER_BYTES + length) return reject('truncated');
  const universe = ((packet[15] & 0x7f) << 8) | packet[14];
  return {
    ok: true,
    protocol: 'artnet',
    universe,
    sequence: packet[12],
    physical: packet[13],
    priority: null,
    terminated: false,
    sourceName: null,
    cid: null,
    data: Uint8Array.from(packet.subarray(ARTNET_HEADER_BYTES, ARTNET_HEADER_BYTES + length)),
  };
}

function flagsAndLength(packet, offset, expectedLength) {
  const word = packet.readUInt16BE(offset);
  return (word & 0xf000) === 0x7000 && (word & 0x0fff) === expectedLength;
}

function decodeSourceName(field) {
  const end = field.indexOf(0);
  const text = field.subarray(0, end < 0 ? field.length : end).toString('utf8');
  // Strip control characters; the name is shown in the UI.
  return text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 63);
}

/**
 * E1.31 data packet. Every layer length must agree with the datagram size,
 * vectors must be the data-packet vectors, and the DMP layer must describe
 * exactly the slots present. Returns
 * { ok: true, protocol: 'sacn', universe, sequence, priority, terminated,
 *   sourceName, cid, data } or { ok: false, reason }.
 * Preview packets (option bit 7) are rejected with reason 'preview':
 * E1.31 6.2.6 says live receivers ignore them. Non-zero start codes
 * (for example 0xDD per-address priority) come back as 'start-code'.
 */
function parseE131(input) {
  if (!isBuffer(input)) return reject('not-a-buffer');
  const packet = asBuffer(input);
  if (packet.length > SACN_MAX_PACKET) return reject('oversized');
  if (packet.length < 22) return reject('too-short');
  if (packet.readUInt16BE(0) !== 0x0010 || packet.readUInt16BE(2) !== 0x0000) return reject('bad-preamble');
  if (!packet.subarray(4, 16).equals(ACN_PACKET_IDENTIFIER)) return reject('bad-id');
  const rootVector = packet.readUInt32BE(18);
  if (rootVector === VECTOR_ROOT_E131_EXTENDED) return reject('sacn-extended');
  if (rootVector !== VECTOR_ROOT_E131_DATA) return reject('bad-root-vector');
  if (packet.length < SACN_HEADER_BYTES) return reject('too-short');
  if (!flagsAndLength(packet, 16, packet.length - 16)) return reject('bad-root-length');
  if (!flagsAndLength(packet, 38, packet.length - 38)) return reject('bad-framing-length');
  if (packet.readUInt32BE(40) !== VECTOR_E131_DATA_PACKET) return reject('bad-framing-vector');
  const priority = packet[108];
  if (priority > SACN_MAX_PRIORITY) return reject('bad-priority');
  const sequence = packet[111];
  const options = packet[112];
  const universe = packet.readUInt16BE(113);
  if (universe < SACN_MIN_UNIVERSE || universe > SACN_MAX_UNIVERSE) return reject('bad-universe');
  if (!flagsAndLength(packet, 115, packet.length - 115)) return reject('bad-dmp-length');
  if (packet[117] !== VECTOR_DMP_SET_PROPERTY) return reject('bad-dmp-vector');
  if (packet[118] !== 0xa1) return reject('bad-address-type');
  if (packet.readUInt16BE(119) !== 0x0000) return reject('bad-first-address');
  if (packet.readUInt16BE(121) !== 0x0001) return reject('bad-increment');
  const count = packet.readUInt16BE(123);
  if (count !== packet.length - 125 || count < 1 || count > DMX_SLOTS + 1) return reject('bad-property-count');
  if (options & SACN_OPTION_PREVIEW) return reject('preview');
  if (packet[125] !== 0x00) return reject('start-code');
  return {
    ok: true,
    protocol: 'sacn',
    universe,
    sequence,
    physical: null,
    priority,
    terminated: (options & SACN_OPTION_TERMINATED) !== 0,
    sourceName: decodeSourceName(packet.subarray(44, 108)),
    cid: packet.subarray(22, 38).toString('hex'),
    data: Uint8Array.from(packet.subarray(126)),
  };
}

/**
 * E1.31 6.7.2: a packet whose sequence is 1-20 behind the last one from the
 * same source is out of order and discarded. Anything else, including a
 * wrap from 255 to 0 or a big jump after a restart, is accepted.
 */
function isSacnSequenceStale(previous, next) {
  if (!Number.isInteger(previous)) return false;
  let delta = next - previous;
  if (delta > 127) delta -= 256;
  if (delta < -128) delta += 256;
  return delta <= 0 && delta > -20;
}

module.exports = {
  ARTNET_MAX_PACKET,
  SACN_MAX_PACKET,
  DMX_SLOTS,
  OP_DMX,
  OP_POLL,
  OP_SYNC,
  parseArtDmx,
  parseE131,
  isSacnSequenceStale,
};
