// Audio data packet (audio_data.rs has the layout). The instrument declares
// `av: array<f32>` as a read-only storage binding.

const AV_EVENTS: u32 = 16u;
const AV_SPECTRUM: u32 = 144u;
const AV_SPECTRUM_BINS: u32 = 128u;
const AV_WAVEFORM: u32 = 272u;
const AV_WAVEFORM_SAMPLES: u32 = 512u;

fn av_header(index: u32) -> f32 {
  return av[index];
}

// Linear read of the log-spaced spectrum at s in 0..1.
fn av_spectrum(s: f32) -> f32 {
  let x = clamp(s, 0.0, 1.0) * f32(AV_SPECTRUM_BINS - 1u);
  let i = u32(floor(x));
  let j = min(i + 1u, AV_SPECTRUM_BINS - 1u);
  return mix(av[AV_SPECTRUM + i], av[AV_SPECTRUM + j], fract(x));
}

fn av_waveform(s: f32) -> f32 {
  let x = fract(s) * f32(AV_WAVEFORM_SAMPLES - 1u);
  let i = u32(floor(x));
  let j = min(i + 1u, AV_WAVEFORM_SAMPLES - 1u);
  return mix(av[AV_WAVEFORM + i], av[AV_WAVEFORM + j], fract(x));
}

// The spectrum softened over about five bins, for shapes that read it along
// their length (single bins make a jagged edge).
fn av_spectrum_smooth(s: f32) -> f32 {
  let d = 1.0 / f32(AV_SPECTRUM_BINS);
  return (av_spectrum(s - 2.0 * d) + av_spectrum(s + 2.0 * d)) * 0.15
    + (av_spectrum(s - d) + av_spectrum(s + d)) * 0.2
    + av_spectrum(s) * 0.3;
}
