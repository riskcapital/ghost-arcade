// WLED DRGB: protocol byte, timeout seconds, then RGB triples.
function buildWLEDRealtimePacket(pixels) {
  if (!pixels || !Number.isInteger(pixels.length) || pixels.length < 3 || pixels.length > 490 * 3 || pixels.length % 3 !== 0) {
    throw new Error('WLED requires 1–490 RGB LEDs per controller');
  }
  const payload = Buffer.from(pixels);
  const packet = Buffer.alloc(2 + payload.length);
  packet[0] = 2;
  packet[1] = 2; // Return to WLED's own effect after two seconds without frames.
  payload.copy(packet, 2);
  return packet;
}
module.exports = { buildWLEDRealtimePacket };
