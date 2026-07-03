// Ghost WGSL stdlib: canonical audio uniform layout and shaping helpers.
//
// Layout schema v1:
//   audio0 = level, bass, mid, treble
//   audio1 = high, beat, beat_phase, bpm
//   audio2 = centroid, kick, snare, active

struct GhostAudioUniforms {
  audio0: vec4<f32>,
  audio1: vec4<f32>,
  audio2: vec4<f32>,
}

fn ghost_audio_from_vecs(audio0: vec4<f32>, audio1: vec4<f32>, audio2: vec4<f32>) -> GhostAudioUniforms {
  return GhostAudioUniforms(audio0, audio1, audio2);
}

fn ghost_audio_active(audio: GhostAudioUniforms) -> f32 {
  return clamp(audio.audio2.w, 0.0, 1.0);
}

fn ghost_audio_raw_level(audio: GhostAudioUniforms) -> f32 { return audio.audio0.x; }
fn ghost_audio_raw_bass(audio: GhostAudioUniforms) -> f32 { return audio.audio0.y; }
fn ghost_audio_raw_mid(audio: GhostAudioUniforms) -> f32 { return audio.audio0.z; }
fn ghost_audio_raw_treble(audio: GhostAudioUniforms) -> f32 { return audio.audio0.w; }
fn ghost_audio_raw_high(audio: GhostAudioUniforms) -> f32 { return audio.audio1.x; }
fn ghost_audio_raw_beat(audio: GhostAudioUniforms) -> f32 { return audio.audio1.y; }
fn ghost_audio_beat_phase(audio: GhostAudioUniforms) -> f32 { return audio.audio1.z; }
fn ghost_audio_bpm(audio: GhostAudioUniforms) -> f32 { return audio.audio1.w; }
fn ghost_audio_raw_centroid(audio: GhostAudioUniforms) -> f32 { return audio.audio2.x; }
fn ghost_audio_raw_kick(audio: GhostAudioUniforms) -> f32 { return audio.audio2.y; }
fn ghost_audio_raw_snare(audio: GhostAudioUniforms) -> f32 { return audio.audio2.z; }

fn ghost_audio_level(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_level(audio) * ghost_audio_active(audio); }
fn ghost_audio_bass(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_bass(audio) * ghost_audio_active(audio); }
fn ghost_audio_mid(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_mid(audio) * ghost_audio_active(audio); }
fn ghost_audio_treble(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_treble(audio) * ghost_audio_active(audio); }
fn ghost_audio_high(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_high(audio) * ghost_audio_active(audio); }
fn ghost_audio_beat(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_beat(audio) * ghost_audio_active(audio); }
fn ghost_audio_centroid(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_centroid(audio) * ghost_audio_active(audio); }
fn ghost_audio_kick(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_kick(audio) * ghost_audio_active(audio); }
fn ghost_audio_snare(audio: GhostAudioUniforms) -> f32 { return ghost_audio_raw_snare(audio) * ghost_audio_active(audio); }

fn ghost_audio_band_drive(bass: f32, mid: f32, treble: f32, weights: vec3<f32>) -> f32 {
  return clamp(dot(vec3<f32>(bass, mid, treble), weights), 0.0, 1.0);
}

fn ghost_audio_uniform_band_drive(audio: GhostAudioUniforms, weights: vec3<f32>) -> f32 {
  return ghost_audio_band_drive(
    ghost_audio_bass(audio),
    ghost_audio_mid(audio),
    ghost_audio_treble(audio),
    weights,
  );
}

fn ghost_audio_soft_gate(x: f32, threshold: f32, softness: f32) -> f32 {
  return smoothstep(threshold - softness, threshold + softness, x);
}

fn ghost_audio_pulse(phase: f32, width: f32) -> f32 {
  let p = abs(fract(phase) * 2.0 - 1.0);
  return 1.0 - smoothstep(0.0, max(width, 1e-4), p);
}
