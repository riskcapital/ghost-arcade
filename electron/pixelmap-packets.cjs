// Art-Net 4 (ArtDmx, ArtSync) and ANSI E1.31 (sACN) packet builders.
// Pure functions: every field is validated here so the main-process
// sender can never put a malformed packet on the wire.

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;
const DMX_SLOTS = 512;
const ARTNET_MAX_UNIVERSE = 32767; // 15-bit Port-Address: Net(7) SubNet(4) Universe(4)
const SACN_MIN_UNIVERSE = 1;
const SACN_MAX_UNIVERSE = 63999;
const SACN_DEFAULT_PRIORITY = 100;
const SACN_MAX_PRIORITY = 200;
const SACN_SOURCE_NAME_BYTES = 64;

const ARTNET_ID = Buffer.from('Art-Net\0', 'latin1');
const ARTNET_PROTOCOL_VERSION = 14;
const OP_DMX = 0x5000;
const OP_SYNC = 0x5200;

const ACN_PACKET_IDENTIFIER = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);
const VECTOR_ROOT_E131_DATA = 0x00000004;
const VECTOR_E131_DATA_PACKET = 0x00000002;
const VECTOR_DMP_SET_PROPERTY = 0x02;
const SACN_HEADER_BYTES = 126; // Root 38 + Framing 77 + DMP 10 + start code 1

const SACN_OPTION_PREVIEW = 0x80;
const SACN_OPTION_TERMINATED = 0x40;
const SACN_OPTION_FORCE_SYNC = 0x20;

function isInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Copy DMX slot data into a Buffer, rejecting anything that is not 1-512 bytes. */
function dmxData(data) {
  if (!data || typeof data.length !== 'number' || data.length < 1 || data.length > DMX_SLOTS) {
    throw new Error('DMX data must be 1-512 channels');
  }
  // Uint8Array (and Buffer, which IPC delivers) can only hold 0-255.
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.length);
  const bytes = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (!isInteger(value, 0, 255)) throw new Error('DMX channel values must be integers 0-255');
    bytes[index] = value;
  }
  return bytes;
}

/**
 * ArtDmx (OpCode 0x5000). Header is 18 bytes; length must be even (2-512),
 * so odd channel counts are padded with one zero slot.
 */
function buildArtDmxPacket({ universe, sequence = 0, physical = 0, data }) {
  if (!isInteger(universe, 0, ARTNET_MAX_UNIVERSE)) throw new Error('Art-Net universe must be 0-32767');
  if (!isInteger(sequence, 0, 255)) throw new Error('Art-Net sequence must be 0-255');
  if (!isInteger(physical, 0, 255)) throw new Error('Art-Net physical port must be 0-255');
  const slots = dmxData(data);
  const length = Math.max(2, slots.length + (slots.length % 2));
  const packet = Buffer.alloc(18 + length);
  ARTNET_ID.copy(packet, 0);
  packet.writeUInt16LE(OP_DMX, 8);
  packet[10] = 0; // ProtVerHi
  packet[11] = ARTNET_PROTOCOL_VERSION; // ProtVerLo
  packet[12] = sequence;
  packet[13] = physical;
  packet[14] = universe & 0xff; // SubUni: SubNet (high nibble) + Universe (low nibble)
  packet[15] = (universe >> 8) & 0x7f; // Net
  packet.writeUInt16BE(length, 16);
  slots.copy(packet, 18);
  return packet;
}

/** ArtSync (OpCode 0x5200): tells nodes to output the ArtDmx frame they buffered. */
function buildArtSyncPacket() {
  const packet = Buffer.alloc(14);
  ARTNET_ID.copy(packet, 0);
  packet.writeUInt16LE(OP_SYNC, 8);
  packet[10] = 0;
  packet[11] = ARTNET_PROTOCOL_VERSION;
  packet[12] = 0; // Aux1
  packet[13] = 0; // Aux2
  return packet;
}

/** Art-Net sequence runs 1-255; 0 means "sequencing disabled", so it is skipped. */
function nextArtNetSequence(previous) {
  return previous >= 255 || previous < 1 ? 1 : previous + 1;
}

/** sACN sequence runs 0-255 and wraps. */
function nextSacnSequence(previous) {
  return (Number.isInteger(previous) ? previous + 1 : 0) & 0xff;
}

/** Accepts a UUID string or 32 hex digits and returns the 16-byte CID. */
function parseSacnCid(cid) {
  const hex = typeof cid === 'string' ? cid.replace(/-/g, '') : '';
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('sACN CID must be a UUID');
  return Buffer.from(hex, 'hex');
}

/** UTF-8 source name, truncated on a character boundary to leave a null terminator. */
function encodeSourceName(name) {
  const text = typeof name === 'string' && name.trim() ? name.trim() : 'Ghost Arcade';
  let encoded = Buffer.from(text, 'utf8');
  if (encoded.length > SACN_SOURCE_NAME_BYTES - 1) {
    let end = SACN_SOURCE_NAME_BYTES - 1;
    while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
    encoded = encoded.subarray(0, end);
  }
  const field = Buffer.alloc(SACN_SOURCE_NAME_BYTES);
  encoded.copy(field, 0);
  return field;
}

function flagsAndLength(length) {
  return 0x7000 | (length & 0x0fff);
}

/** E1.31 data packet: Root layer, Framing layer, DMP layer, start code, slots. */
function buildE131DataPacket({
  universe,
  sequence = 0,
  priority = SACN_DEFAULT_PRIORITY,
  sourceName,
  cid,
  data,
  preview = false,
  terminated = false,
  forceSync = false,
  syncAddress = 0,
}) {
  if (!isInteger(universe, SACN_MIN_UNIVERSE, SACN_MAX_UNIVERSE)) throw new Error('sACN universe must be 1-63999');
  if (!isInteger(sequence, 0, 255)) throw new Error('sACN sequence must be 0-255');
  if (!isInteger(priority, 0, SACN_MAX_PRIORITY)) throw new Error('sACN priority must be 0-200');
  if (!isInteger(syncAddress, 0, SACN_MAX_UNIVERSE)) throw new Error('sACN sync address must be 0-63999');
  const cidBytes = parseSacnCid(cid);
  const slots = dmxData(data);
  const length = SACN_HEADER_BYTES + slots.length;
  const packet = Buffer.alloc(length);

  // Root layer
  packet.writeUInt16BE(0x0010, 0); // Preamble size
  packet.writeUInt16BE(0x0000, 2); // Post-amble size
  ACN_PACKET_IDENTIFIER.copy(packet, 4);
  packet.writeUInt16BE(flagsAndLength(length - 16), 16);
  packet.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18);
  cidBytes.copy(packet, 22);

  // Framing layer
  packet.writeUInt16BE(flagsAndLength(length - 38), 38);
  packet.writeUInt32BE(VECTOR_E131_DATA_PACKET, 40);
  encodeSourceName(sourceName).copy(packet, 44);
  packet[108] = priority;
  packet.writeUInt16BE(syncAddress, 109);
  packet[111] = sequence;
  packet[112] = (preview ? SACN_OPTION_PREVIEW : 0)
    | (terminated ? SACN_OPTION_TERMINATED : 0)
    | (forceSync ? SACN_OPTION_FORCE_SYNC : 0);
  packet.writeUInt16BE(universe, 113);

  // DMP layer
  packet.writeUInt16BE(flagsAndLength(length - 115), 115);
  packet[117] = VECTOR_DMP_SET_PROPERTY;
  packet[118] = 0xa1; // Address type and data type
  packet.writeUInt16BE(0x0000, 119); // First property address
  packet.writeUInt16BE(0x0001, 121); // Address increment
  packet.writeUInt16BE(slots.length + 1, 123); // Property value count, including the start code
  packet[125] = 0x00; // DMX512-A null start code
  slots.copy(packet, 126);
  return packet;
}

/** E1.31 multicast group for a universe: 239.255.{hi}.{lo}. */
function sacnMulticastAddress(universe) {
  if (!isInteger(universe, SACN_MIN_UNIVERSE, SACN_MAX_UNIVERSE)) throw new Error('sACN universe must be 1-63999');
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

module.exports = {
  ARTNET_PORT,
  SACN_PORT,
  DMX_SLOTS,
  ARTNET_MAX_UNIVERSE,
  SACN_MIN_UNIVERSE,
  SACN_MAX_UNIVERSE,
  SACN_DEFAULT_PRIORITY,
  SACN_MAX_PRIORITY,
  buildArtDmxPacket,
  buildArtSyncPacket,
  buildE131DataPacket,
  nextArtNetSequence,
  nextSacnSequence,
  parseSacnCid,
  sacnMulticastAddress,
};
