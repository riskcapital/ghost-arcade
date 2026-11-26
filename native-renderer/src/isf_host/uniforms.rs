//! Shader uniforms: the native shader uniform block, ISF uniform state and
//! time anchors, and the frame index and delta shaders see.

use crate::*;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub(crate) struct NativeShaderUniforms {
    pub(crate) resolution_time: [f32; 4],
    pub(crate) frame_seed_inputs: [f32; 4],
    pub(crate) date: [f32; 4],
    pub(crate) audio0: [f32; 4],
    pub(crate) audio1: [f32; 4],
    pub(crate) params0: [f32; 4],
    pub(crate) params1: [f32; 4],
    // Append-only extension so older hosted shaders keep the params0/params1 offsets.
    pub(crate) audio2: [f32; 4],
    pub(crate) params_extra: [[f32; 4]; NATIVE_ISF_EXTRA_PARAM_VEC4S],
    // Pass-aware ISF host tail (see NATIVE_ISF_HOST_BLOCK_TAIL). Single-pass
    // shaders never declare it; it is still written so WGSL/legacy layouts
    // keep reading the same prefix.
    pub(crate) isf_pass: [f32; 4],
    pub(crate) isf_pass_sizes: [[f32; 4]; MAX_ISF_PASS_TARGETS / 2],
    pub(crate) isf_audio: [f32; 4],
}

pub(crate) fn effective_native_frame_index(
    render_clock_mode: &str,
    render_clock_frame_index: Option<u64>,
    gpu_frames_submitted: u64,
) -> u64 {
    if render_clock_mode == "manual" {
        render_clock_frame_index.unwrap_or(gpu_frames_submitted)
    } else {
        gpu_frames_submitted
    }
}

/// Where a bound ISF shader's FRAMEINDEX counts from.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct IsfFrameOrigin {
    pub(crate) first: u64,
    /// Set once a layer has actually drawn the shader. Until then (its
    /// pipeline building on the worker, a pass format still compiling) the
    /// count stays at 0, so the first frame that really renders sees
    /// FRAMEINDEX 0 and can seed its buffers.
    pub(crate) rendered: bool,
}

/// FRAMEINDEX for a shader this frame. A clock that went back past the first
/// frame (a new export starting again at frame 0) starts the count again
/// there instead of holding it at 0.
pub(crate) fn isf_frame_index_since(origin: &mut IsfFrameOrigin, frame_index: u64) -> u64 {
    if !origin.rendered || frame_index < origin.first {
        origin.first = frame_index;
    }
    frame_index - origin.first
}

pub(crate) fn effective_native_frame_delta(
    render_clock_mode: &str,
    render_clock_delta: f32,
    target_fps: u32,
) -> f32 {
    if render_clock_mode == "manual" {
        render_clock_delta.max(0.0)
    } else {
        1.0 / target_fps.max(1) as f32
    }
}

#[derive(Clone, Debug)]
pub(crate) struct IsfUniformState {
    pub(crate) time: f32,
    pub(crate) time_delta: f32,
    pub(crate) frame_index: u64,
    pub(crate) render_width: f32,
    pub(crate) render_height: f32,
    pub(crate) date: [f32; 4],
    pub(crate) audio0: [f32; 4],
    pub(crate) audio1: [f32; 4],
    pub(crate) audio2: [f32; 4],
    pub(crate) float_hash: u64,
    pub(crate) point_hash: u64,
    pub(crate) color_hash: u64,
    pub(crate) input_count: u32,
    pub(crate) input_params: [f32; MAX_NATIVE_ISF_PARAM_FLOATS],
    /// (param offset, source id) for bound image inputs; resolved to live
    /// source-frame slots at render time, never at apply time.
    pub(crate) image_sources: Vec<(usize, String)>,
    pub(crate) seq: u64,
}

/// A shader whose TIME follows a clock of its own (a show clip: its time
/// in the clip, paused with the show) instead of the render clock: TIME was
/// `time` when the render clock read `clock`, and runs at `rate` from there.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct IsfTimeAnchor {
    pub(crate) time: f64,
    pub(crate) clock: f64,
    pub(crate) rate: f64,
    pub(crate) paused: bool,
}

impl IsfTimeAnchor {
    /// The anchored time at `clock` (the unwrapped f64 render clock).
    pub(crate) fn time_at(&self, clock: f64) -> f64 {
        let time = if self.paused { self.time } else { self.time + (clock - self.clock) * self.rate };
        time.clamp(0.0, 1.0e9)
    }
}

impl IsfUniformState {
    pub(crate) fn native_params(&self, shader_id: &str) -> [f32; MAX_NATIVE_ISF_PARAM_FLOATS] {
        let seed = unit_from_hash(stable_hash64(shader_id));
        let float_seed = unit_from_hash(self.float_hash);
        let point_seed = unit_from_hash(self.point_hash);
        let color_seed = unit_from_hash(self.color_hash);
        let level = self.audio0[0].clamp(0.0, 1.0);
        let bass = self.audio0[1].clamp(0.0, 1.0);
        let high = self.audio1[0].clamp(0.0, 1.0);
        let beat = self.audio1[1].clamp(0.0, 1.0);
        let bpm = self.audio1[3].clamp(0.0, 300.0);
        let mut params = [0.0; MAX_NATIVE_ISF_PARAM_FLOATS];
        params[..8].copy_from_slice(&[
            (0.82 + level * 1.2 + beat * 0.35).clamp(0.0, 4.0),
            (0.52 + seed * 2.2 + float_seed * 0.8).clamp(0.18, 4.0),
            (0.24 + bass * 0.46 + point_seed * 0.30).clamp(0.0, 1.0),
            (0.16 + bpm / 180.0 + high * 0.45).clamp(0.0, 2.0),
            seed,
            (0.18 + color_seed * 0.72).clamp(0.0, 1.0),
            (0.20 + (self.input_count as f32 / 48.0) + float_seed * 0.24).clamp(0.0, 1.0),
            1.0,
        ]);
        params
    }

    pub(crate) fn declared_input_params(&self) -> [f32; MAX_NATIVE_ISF_PARAM_FLOATS] {
        self.input_params
    }
}

impl NativeShaderUniforms {
    pub(crate) fn from_isf(
        shader_id: &str,
        state: Option<&IsfUniformState>,
        fallback_width: u32,
        fallback_height: u32,
        params: [f32; MAX_NATIVE_ISF_PARAM_FLOATS],
        input_source_slot: usize,
    ) -> Self {
        let seed = unit_from_hash(stable_hash64(shader_id));
        let render_width = state
            .map(|state| state.render_width)
            .unwrap_or(fallback_width as f32)
            .max(1.0);
        let render_height = state
            .map(|state| state.render_height)
            .unwrap_or(fallback_height as f32)
            .max(1.0);
        let time = state.map(|state| state.time).unwrap_or(0.0);
        let time_delta = state.map(|state| state.time_delta).unwrap_or(1.0 / 60.0);
        let frame_index = state.map(|state| state.frame_index as f32).unwrap_or(0.0);
        let input_count = state.map(|state| state.input_count as f32).unwrap_or(0.0);
        let date = state.map(|state| state.date).unwrap_or([0.0; 4]);
        let audio0 = state.map(|state| state.audio0).unwrap_or([0.0; 4]);
        let audio1 = state.map(|state| state.audio1).unwrap_or([0.0; 4]);
        let audio2 = state.map(|state| state.audio2).unwrap_or([0.0; 4]);
        let mut params_extra = [[0.0; 4]; NATIVE_ISF_EXTRA_PARAM_VEC4S];
        for (index, chunk) in params[8..].chunks_exact(4).enumerate() {
            params_extra[index].copy_from_slice(chunk);
        }
        Self {
            resolution_time: [render_width, render_height, time, time_delta],
            frame_seed_inputs: [
                frame_index,
                seed,
                input_count,
                input_source_slot.min(NATIVE_SHADER_INPUT_LAYERS - 1) as f32,
            ],
            date,
            audio0,
            audio1,
            params0: [params[0], params[1], params[2], params[3]],
            params1: [params[4], params[5], params[6], params[7]],
            audio2,
            params_extra,
            isf_pass: [0.0, 1.0, render_width, render_height],
            isf_pass_sizes: [[0.0; 4]; MAX_ISF_PASS_TARGETS / 2],
            isf_audio: [0.0, 0.0, 0.0, 0.0],
        }
    }
}

pub(crate) fn default_native_params() -> [f32; 8] {
    [1.0, 1.0, 0.5, 0.125, 0.0, 0.5, 0.25, 1.0]
}

pub(crate) fn default_native_isf_params() -> [f32; MAX_NATIVE_ISF_PARAM_FLOATS] {
    let mut params = [0.0; MAX_NATIVE_ISF_PARAM_FLOATS];
    params[..8].copy_from_slice(&default_native_params());
    params
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ghost_audio_uniform_layout_documents_the_native_slots() {
        let layout = ghost_audio_uniform_layout();
        assert_eq!(layout["schema_version"], json!(1));
        assert_eq!(layout["audio0"], json!(["level", "bass", "mid", "treble"]));
        assert_eq!(
            layout["audio1"],
            json!(["high", "beat", "beat_phase", "bpm"])
        );
        assert_eq!(
            layout["audio2"],
            json!(["centroid", "kick", "snare", "active"])
        );
    }

    #[test]
    fn ghost_audio_uniforms_pack_and_clamp_command_fields() {
        let audio = GhostAudioUniforms::from_command(&json!({
            "active": true,
            "level": 1.2,
            "bass": 0.54,
            "mid": 0.35,
            "treble": 0.45,
            "high": 0.55,
            "beat": 0.65,
            "beat_phase": -1.0,
            "bpm": 900.0,
            "centroid": 0.42,
            "kick": 0.8,
            "snare": 0.15,
        }));

        assert_eq!(audio.audio0, [1.0, 0.54, 0.35, 0.45]);
        assert_eq!(audio.audio1, [0.55, 0.65, 0.0, 300.0]);
        assert_eq!(audio.audio2, [0.42, 0.8, 0.15, 1.0]);
    }

    #[test]
    fn isf_audio_uniforms_accept_canonical_and_legacy_fields() {
        let canonical = GhostAudioUniforms::from_isf_command(&json!({
            "active": true,
            "level": 0.1,
            "bass": 0.2,
            "mid": 0.3,
            "treble": 0.4,
            "high": 0.5,
            "beat": 0.6,
            "beat_phase": 0.7,
            "bpm": 128,
            "centroid": 0.8,
            "kick": 0.9,
            "snare": 1.2,
        }));
        assert_eq!(canonical.audio0, [0.1, 0.2, 0.3, 0.4]);
        assert_eq!(canonical.audio1, [0.5, 0.6, 0.7, 128.0]);
        assert_eq!(canonical.audio2, [0.8, 0.9, 1.0, 1.0]);

        let legacy = GhostAudioUniforms::from_isf_command(&json!({
            "audio_level": 0.11,
            "audio_bass": 0.22,
            "audio_mid": 0.33,
            "audio_high": 0.44,
            "audio_beat": 0.55,
            "audio_beat_phase": 0.66,
            "audio_bpm": 92,
            "audio_spectral_centroid": 0.77,
            "audio_kick": 0.88,
            "audio_snare": 0.99,
        }));
        assert_eq!(legacy.audio0, [0.11, 0.22, 0.33, 0.44]);
        assert_eq!(legacy.audio1, [0.44, 0.55, 0.66, 92.0]);
        assert_eq!(legacy.audio2, [0.77, 0.88, 0.99, 1.0]);
    }

    #[test]
    fn native_shader_uniforms_append_audio2_without_moving_params() {
        assert!(
            std::mem::offset_of!(NativeShaderUniforms, audio2)
                > std::mem::offset_of!(NativeShaderUniforms, params1)
        );

        let state = IsfUniformState {
            time: 1.25,
            time_delta: 1.0 / 30.0,
            frame_index: 7,
            render_width: 320.0,
            render_height: 180.0,
            date: [2026.0, 7.0, 3.0, 123.0],
            audio0: [0.1, 0.2, 0.3, 0.4],
            audio1: [0.5, 0.6, 0.7, 128.0],
            audio2: [0.8, 0.9, 1.0, 1.0],
            float_hash: 0,
            point_hash: 0,
            color_hash: 0,
            input_count: 0,
            input_params: [0.0; MAX_NATIVE_ISF_PARAM_FLOATS],
            image_sources: Vec::new(),
            seq: 1,
        };
        let uniforms = NativeShaderUniforms::from_isf(
            "shader",
            Some(&state),
            640,
            360,
            [0.0; MAX_NATIVE_ISF_PARAM_FLOATS],
            0,
        );
        assert_eq!(uniforms.audio0, state.audio0);
        assert_eq!(uniforms.audio1, state.audio1);
        assert_eq!(uniforms.audio2, state.audio2);
        assert_eq!(uniforms.params0, [0.0; 4]);
        assert_eq!(uniforms.params1, [0.0; 4]);
        assert_eq!(
            uniforms.params_extra,
            [[0.0; 4]; NATIVE_ISF_EXTRA_PARAM_VEC4S]
        );
    }

    #[test]
    fn live_native_cadence_ignores_external_browser_clock_values() {
        assert_eq!(effective_native_frame_index("live", Some(7), 42), 42);
        assert_eq!(effective_native_frame_delta("live", 0.5, 60), 1.0 / 60.0);
    }

    #[test]
    fn manual_native_cadence_honors_external_render_clock_values() {
        assert_eq!(effective_native_frame_index("manual", Some(7), 42), 7);
        assert_eq!(effective_native_frame_delta("manual", 0.5, 60), 0.5);
    }

    #[test]
    fn isf_frame_index_counts_from_the_first_frame_and_restarts_on_a_rewound_clock() {
        // Bound mid-session on the live clock.
        let mut origin = IsfFrameOrigin { first: 5_000, rendered: true };
        assert_eq!(isf_frame_index_since(&mut origin, 5_000), 0);
        assert_eq!(isf_frame_index_since(&mut origin, 5_003), 3);
        // An export starting again at frame 0 counts 0, 1, 2...
        assert_eq!(isf_frame_index_since(&mut origin, 0), 0);
        assert_eq!(isf_frame_index_since(&mut origin, 1), 1);
        assert_eq!(isf_frame_index_since(&mut origin, 2), 2);
    }

    #[test]
    fn isf_time_anchor_runs_from_its_clock_and_holds_when_paused() {
        // A show clip 2 s in when the render clock read 100, at half speed.
        let anchor = IsfTimeAnchor { time: 2.0, clock: 100.0, rate: 0.5, paused: false };
        assert_eq!(anchor.time_at(100.0), 2.0);
        assert_eq!(anchor.time_at(104.0), 4.0);
        let paused = IsfTimeAnchor { paused: true, ..anchor };
        assert_eq!(paused.time_at(1000.0), 2.0);
        // Never before the start of the clip.
        assert_eq!(anchor.time_at(0.0), 0.0);
    }

    #[test]
    fn isf_time_anchor_is_smooth_across_the_shader_clock_wrap() {
        // Anchored on the unwrapped clock just before the wrap: a clip's TIME
        // keeps counting up through it instead of jumping back.
        let wrap = SHADER_CLOCK_WRAP_SECONDS;
        let anchor = IsfTimeAnchor { time: 10.0, clock: wrap - 1.0, rate: 1.0, paused: false };
        assert_eq!(shader_clock_seconds(anchor.time_at(wrap - 0.5)), 10.5);
        assert_eq!(shader_clock_seconds(anchor.time_at(wrap + 0.5)), 11.5);
    }

    #[test]
    fn isf_frame_index_holds_at_zero_until_the_shader_first_renders() {
        let mut origin = IsfFrameOrigin::default();
        // Pipeline warming on the worker for two frames.
        assert_eq!(isf_frame_index_since(&mut origin, 100), 0);
        assert_eq!(isf_frame_index_since(&mut origin, 101), 0);
        // The first frame that draws sees 0, then the count runs.
        assert_eq!(isf_frame_index_since(&mut origin, 102), 0);
        origin.rendered = true;
        assert_eq!(isf_frame_index_since(&mut origin, 103), 1);
        assert_eq!(isf_frame_index_since(&mut origin, 104), 2);
    }
}
