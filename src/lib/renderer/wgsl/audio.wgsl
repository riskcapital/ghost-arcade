// Ghost WGSL stdlib: audio shaping helpers.

fn ghost_audio_band_drive(bass: f32, mid: f32, treble: f32, weights: vec3<f32>) -> f32 {
  return clamp(dot(vec3<f32>(bass, mid, treble), weights), 0.0, 1.0);
}

fn ghost_audio_soft_gate(x: f32, threshold: f32, softness: f32) -> f32 {
  return smoothstep(threshold - softness, threshold + softness, x);
}

fn ghost_audio_pulse(phase: f32, width: f32) -> f32 {
  let p = abs(fract(phase) * 2.0 - 1.0);
  return 1.0 - smoothstep(0.0, max(width, 1e-4), p);
}
