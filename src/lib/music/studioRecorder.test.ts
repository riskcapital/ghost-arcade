import { describe, expect, it } from 'vitest';

describe('the studio recorder', () => {
  it('writes a 16-bit stereo WAV that reads back', async () => {
    const { encodeWav } = await import('./wav');
    const left = new Float32Array([0, 0.5, -0.5, 1]);
    const right = new Float32Array([0, -1, 0.25, 0]);
    const wav = encodeWav(left, right, 48000);
    const v = new DataView(wav.buffer);
    const tag = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(4 * 4);
    expect(v.getInt16(44 + 4, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(v.getInt16(44 + 6, true)).toBe(-0x8000);
    expect(wav.length).toBe(44 + 16);
  });
});
