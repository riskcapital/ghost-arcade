// Analyser frame -> the byte rows the native core feeds to ISF `audioFFT` /
// `audio` inputs (command `set_audio_spectrum`). FFT magnitudes use the same
// dB window as the browser audio textures (-90..-10 dB -> 0..1); waveform
// samples map -1..1 -> 0..1. Rows are capped so the per-frame payload stays
// a few KB; the core resamples each row to the width (MAX) a shader asks for.

export const ISF_AUDIO_ROW_MAX_SAMPLES = 1024;

export interface IsfAudioRowSource {
  fftData?: ArrayLike<number> | null;
  waveformData?: ArrayLike<number> | null;
}

export interface IsfAudioRowEncoder {
  /** Base64 rows for the current frame, or null when there is no data. */
  encode(source: IsfAudioRowSource | null | undefined): { fft_b64: string; waveform_b64: string } | null;
}

function bytesToBase64(bytes: Uint8Array, length: number): string {
  let binary = '';
  const chunk = 0x2000;
  for (let offset = 0; offset < length; offset += chunk) {
    // Typed arrays are valid apply() argument lists: no intermediate copy.
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(offset, Math.min(length, offset + chunk)) as unknown as number[],
    );
  }
  return btoa(binary);
}

/** Decimate into `out`: FFT keeps each group's peak, waveform point-samples. */
function fillRow(
  source: ArrayLike<number>,
  out: Uint8Array,
  count: number,
  normalize: (value: number) => number,
  peak: boolean,
): void {
  const n = source.length;
  for (let i = 0; i < count; i += 1) {
    let value: number;
    if (peak) {
      const start = Math.floor((i * n) / count);
      const end = Math.max(start + 1, Math.floor(((i + 1) * n) / count));
      value = 0;
      for (let j = start; j < end && j < n; j += 1) value = Math.max(value, normalize(source[j]));
    } else {
      value = normalize(source[Math.min(n - 1, Math.floor(((i + 0.5) * n) / count))]);
    }
    out[i] = Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 255);
  }
}

const normalizeFft = (db: number) => (db + 90) / 80;
const normalizeWave = (sample: number) => (sample + 1) * 0.5;

/** Reuses its byte buffers across frames. */
export function createIsfAudioRowEncoder(maxSamples = ISF_AUDIO_ROW_MAX_SAMPLES): IsfAudioRowEncoder {
  const fftBytes = new Uint8Array(maxSamples);
  const waveBytes = new Uint8Array(maxSamples);
  return {
    encode(source) {
      const fft = source?.fftData;
      const wave = source?.waveformData;
      if (!fft?.length && !wave?.length) return null;
      const fftCount = Math.min(maxSamples, fft?.length ?? 0);
      const waveCount = Math.min(maxSamples, wave?.length ?? 0);
      if (fft && fftCount) fillRow(fft, fftBytes, fftCount, normalizeFft, true);
      if (wave && waveCount) fillRow(wave, waveBytes, waveCount, normalizeWave, false);
      return {
        fft_b64: bytesToBase64(fftBytes, fftCount),
        waveform_b64: bytesToBase64(waveBytes, waveCount),
      };
    },
  };
}
