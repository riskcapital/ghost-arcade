import { describe, expect, it } from 'vitest';
import { MAX_CUBE_LUT_TEXT_LENGTH, parseCubeLut } from './cubeLut';
import { buildNativeCubeLutGraph, packNativeCubeLutUniforms } from '../renderer/nativeCubeLut';

const rows = Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`).join('\n');
const identity = `LUT_3D_SIZE 2\n${rows}`;

describe('3D Cube LUT import', () => {
  it('reads BOM, comments, CRLF, quoted titles, and red-fastest table order', () => {
    const lut = parseCubeLut(`\uFEFF# test\r\nTITLE "Look #1" # notes\r\n${identity.replaceAll('\n', '\r\n')}`);
    expect(lut.title).toBe('Look #1');
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
    expect(lut.rgba.slice(4, 8)).toEqual([1, 0, 0, 0]);
    expect(lut.rgba.slice(8, 12)).toEqual([0, 1, 0, 0]);
    expect(lut.rgba.slice(16, 20)).toEqual([0, 0, 1, 0]);
    expect(Object.isFrozen(lut.rgba)).toBe(true);
  });
  it('supports per-channel domains and finite out-of-range table values', () => {
    const lut = parseCubeLut(`DOMAIN_MIN -1 -2 -3\nDOMAIN_MAX 1 2 3\n${identity.replace('0 0 0', '-2.5 +1e-1 2.0')}`);
    expect(lut.rgba.slice(0, 3)).toEqual([-2.5, Math.fround(.1), 2]);
    expect(packNativeCubeLutUniforms(lut, .5)).toEqual([-1, -2, -3, 0, .5, .25, 1 / 6, 0, 2, .5, 0, 0]);
  });
  it('supports the standalone Resolve input-range header', () => {
    expect(parseCubeLut(`LUT_3D_INPUT_RANGE -1 2\n${identity}`).domainMax).toEqual([2, 2, 2]);
  });
  it.each([
    ['size missing', rows], ['too small', identity.replace('SIZE 2', 'SIZE 1')],
    ['too large', identity.replace('SIZE 2', 'SIZE 66')], ['fractional size', identity.replace('SIZE 2', 'SIZE 2.0')],
    ['missing row', identity.slice(0, identity.lastIndexOf('\n'))], ['extra row', `${identity}\n0 0 0`],
    ['NaN', identity.replace('0 0 0', 'NaN 0 0')], ['infinity', identity.replace('0 0 0', '1e99 0 0')],
    ['hexadecimal', identity.replace('0 0 0', '0xFF 0 0')], ['two columns', identity.replace('0 0 0', '0 0')],
    ['duplicate', `LUT_3D_SIZE 2\n${identity}`], ['late header', `${identity}\nDOMAIN_MIN 0 0 0`],
    ['unknown header', `UNKNOWN 1\n${identity}`], ['1D', 'LUT_1D_SIZE 2\n0 0 0\n1 1 1'],
    ['combined shaper', `LUT_1D_SIZE 2\n${identity}`], ['mixed domains', `DOMAIN_MIN 0 0 0\nLUT_3D_INPUT_RANGE 0 1\n${identity}`],
    ['zero domain', `DOMAIN_MAX 0 1 1\n${identity}`], ['reversed domain', `DOMAIN_MIN 2 0 0\n${identity}`],
    ['underflow domain', `DOMAIN_MAX 1e-45 1 1\n${identity}`],
    ['collapsed float domain', `DOMAIN_MIN 1 0 0\nDOMAIN_MAX 1.000000001 1 1\n${identity}`],
    ['unquoted title', `TITLE bad\n${identity}`],
  ])('rejects %s before returning any LUT', (_, text) => expect(() => parseCubeLut(text)).toThrow());
  it('bounds text before parsing', () => {
    expect(() => parseCubeLut(' '.repeat(MAX_CUBE_LUT_TEXT_LENGTH + 1))).toThrow('32 MB');
  });
  it('packs the largest supported table without truncation', () => {
    const lut = parseCubeLut(`LUT_3D_SIZE 65\n${'0 0 0\n'.repeat(65 ** 3)}`);
    expect(lut.rgba.length).toBe(65 ** 3 * 4);
    const graph = buildNativeCubeLutGraph({ lut, sourceId: 'in', targetSourceId: 'out', strength: 2 });
    expect(graph.buffers[1].byte_length).toBe(65 ** 3 * 16);
    expect(Buffer.from(graph.buffers[1].initial_b64, 'base64').length).toBe(lut.rgba.length * 4);
    expect(Buffer.from(graph.buffers[0].initial_b64, 'base64').readFloatLE(36)).toBe(1);
  });
  it('refuses to read and overwrite the same GPU texture', () => {
    expect(() => buildNativeCubeLutGraph({ lut: parseCubeLut(identity), sourceId: 'same', targetSourceId: 'same' })).toThrow('distinct');
  });
});
