import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { encodeOSCMessage, parseOSCPacket } = require(
  join(process.cwd(), 'electron', 'osc-parser.cjs'),
);

/**
 * The encoder feeds real hardware, so the wire format has to be right — a
 * surface that cannot parse our packets simply goes quiet, with no error
 * anywhere to explain it. Round-tripping through our own parser checks that
 * both halves agree; the alignment assertions are what a third-party parser
 * would actually reject us for.
 */
describe('OSC encoding', () => {
  it('round-trips an address and a float', () => {
    const buf = encodeOSCMessage('/ghost/vj/a/layer/1/opacity', [0.75]);
    expect(parseOSCPacket(buf)).toEqual([
      { address: '/ghost/vj/a/layer/1/opacity', args: [0.75], tags: 'f', timeTag: null },
    ]);
  });

  it('pads every packet to a 4-byte boundary', () => {
    // OSC requires 4-byte alignment throughout. Addresses of different lengths
    // are what expose an off-by-one in the padding.
    for (const address of ['/a', '/ab', '/abc', '/abcd', '/abcde']) {
      const buf = encodeOSCMessage(address, [1]);
      expect(buf.length % 4, `${address} is misaligned`).toBe(0);
      expect(parseOSCPacket(buf)[0].address).toBe(address);
    }
  });

  it('carries strings alongside numbers', () => {
    const parsed = parseOSCPacket(encodeOSCMessage('/x', ['hi', 1]));
    expect(parsed[0].tags).toBe('sf');
    expect(parsed[0].args).toEqual(['hi', 1]);
  });

  it('sends zero rather than NaN', () => {
    // Surfaces tend to render a NaN as a jumped fader rather than ignore it,
    // so a bad read must not reach the wire as one.
    expect(parseOSCPacket(encodeOSCMessage('/x', [NaN]))[0].args).toEqual([0]);
    expect(parseOSCPacket(encodeOSCMessage('/x', [Infinity]))[0].args).toEqual([0]);
  });

  it('refuses an address that is not an OSC address', () => {
    expect(encodeOSCMessage('no-leading-slash', [1])).toBeNull();
    expect(encodeOSCMessage(null, [1])).toBeNull();
  });

  it('encodes a message with no arguments', () => {
    const parsed = parseOSCPacket(encodeOSCMessage('/ghost/vj/stop', []));
    expect(parsed[0].address).toBe('/ghost/vj/stop');
    expect(parsed[0].args).toEqual([]);
  });
});
