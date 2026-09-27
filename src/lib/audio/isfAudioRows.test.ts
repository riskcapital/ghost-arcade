import { describe, expect, it } from 'vitest';
import { createIsfAudioRowEncoder } from './isfAudioRows';

const decode = (b64: string) => Array.from(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe('createIsfAudioRowEncoder', () => {
  it('maps dB magnitudes and waveform samples into 0..255 rows', () => {
    const encoder = createIsfAudioRowEncoder();
    const rows = encoder.encode({
      fftData: new Float32Array([-100, -90, -50, -10, 0]),
      waveformData: new Float32Array([-1, 0, 1]),
    });
    expect(rows).not.toBeNull();
    expect(decode(rows!.fft_b64)).toEqual([0, 0, 128, 255, 255]);
    expect(decode(rows!.waveform_b64)).toEqual([0, 128, 255]);
  });

  it('caps long rows, keeping FFT peaks and point-sampled waveform', () => {
    const encoder = createIsfAudioRowEncoder(4);
    const fft = new Float32Array(8).fill(-90);
    fft[5] = -10;
    const wave = new Float32Array([-1, -1, 1, 1, -1, -1, 1, 1]);
    const rows = encoder.encode({ fftData: fft, waveformData: wave })!;
    expect(decode(rows.fft_b64)).toEqual([0, 0, 255, 0]);
    expect(decode(rows.waveform_b64)).toEqual([0, 255, 0, 255]);
  });

  it('returns null without analyser data', () => {
    const encoder = createIsfAudioRowEncoder();
    expect(encoder.encode(null)).toBeNull();
    expect(encoder.encode({ fftData: new Float32Array(0) })).toBeNull();
  });
});
