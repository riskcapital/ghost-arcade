//! Engine-native audio-reactive instruments and the groundwork they share:
//! the per-frame audio packet (spectrum, waveform, onset envelopes and a ring
//! of recent hits), emitter shapes, and an HDR feedback + bloom post chain.

// The packet layout is a protocol: every field is named even when no
// instrument reads it from the CPU yet.
#[allow(dead_code)]
pub mod audio_data;
pub mod cloud_pulse;
pub mod controls;
pub mod depth_lights;
// CPU reference of `wgsl/emitter.wgsl`; its tests pin what the GPU copy does.
#[allow(dead_code)]
pub mod emitter;
pub mod flock;
pub mod hdr_post;
pub mod jobs;
pub mod params;
pub mod ply_reader;
pub mod shaders;
pub mod strands;

#[cfg(test)]
mod param_tests;
