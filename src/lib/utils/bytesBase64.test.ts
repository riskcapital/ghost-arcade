import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from './bytesBase64';

const reference = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
};

describe('bytesToBase64', () => {
  it('gives the same text as btoa for every length and byte', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 143, 144, 145, 8191, 8192, 8193, 8832, 70001]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 131 + (i >> 3) * 17) & 255);
      expect(bytesToBase64(bytes), `length ${length}`).toBe(reference(bytes));
    }
    const all = Uint8Array.from({ length: 256 * 3 }, (_, i) => i % 256);
    expect(bytesToBase64(all)).toBe(reference(all));
  });

  it('does not depend on what an earlier, longer call left behind', () => {
    bytesToBase64(new Uint8Array(30000).fill(255));
    expect(bytesToBase64(Uint8Array.of(1, 2))).toBe(btoa(String.fromCharCode(1, 2)));
  });
});
