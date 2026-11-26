import { describe, expect, it } from 'vitest';
import { base64Bytes, snapshotBytes, snapshotHas } from './snapshotBytes';

describe('snapshot bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
  const b64 = Buffer.from(bytes).toString('base64');

  it('gives the same bytes from raw or base64 payloads', () => {
    expect(Array.from(snapshotBytes({ rgba_raw: bytes }, 'rgba')!)).toEqual(Array.from(bytes));
    expect(Array.from(snapshotBytes({ rgba_b64: b64 }, 'rgba')!)).toEqual(Array.from(bytes));
    expect(Array.from(snapshotBytes({ jpeg_raw: bytes.buffer }, 'jpeg')!)).toEqual(Array.from(bytes));
    expect(Array.from(base64Bytes(b64))).toEqual(Array.from(bytes));
  });

  it('prefers raw bytes and reports what is there', () => {
    expect(snapshotBytes({ rgba_raw: bytes, rgba_b64: 'AAAA' }, 'rgba')).toBe(bytes);
    expect(snapshotHas({ jpeg_raw: bytes }, 'jpeg')).toBe(true);
    expect(snapshotHas({ jpeg_raw: bytes }, 'rgba')).toBe(false);
    expect(snapshotHas({ rgba_raw: new Uint8Array(0) }, 'rgba')).toBe(false);
    expect(snapshotBytes(null, 'rgba')).toBeNull();
    expect(snapshotBytes({}, 'jpeg')).toBeNull();
  });
});
