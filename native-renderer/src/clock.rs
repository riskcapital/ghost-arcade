//! The render clock: the beat clock, the wrapped shader clock and the native
//! frame clock commands.

use crate::*;

/// Beats wrap here so the f32 the shader reads keeps sub-beat precision for
/// days. 65520 divides evenly by every group size 1-10 and 12-16, so a beat
/// step chase does not skip a member when the count wraps.
pub(crate) const BEAT_CLOCK_WRAP: f64 = 65520.0;

/// Shader time wraps here (2^15 s, about 9 h 6 min). Uniforms carry time as
/// an f32, whose step grows with the value: 2 ms at 9 h, 4 ms at 12 h,
/// 62 ms after a week, so animation micro-stuttered on long installs and
/// ran at ~16 fps after a week. Below the wrap shader time is exactly the
/// live clock (nothing changes in a show shorter than that); past it time
/// restarts from 0, so the f32 step never exceeds 2 ms (the precision the
/// beat clock above already settles for). A power of two keeps whole-second
/// and dyadic periods (fract(t), t * 0.5, clock ticks) seamless across the
/// wrap. Bookkeeping that needs the real clock (video anchors, the beat
/// clock, manual export seeks) keeps the unwrapped f64. The editor wraps the
/// shader time it packs at the same value (NATIVE_SHADER_CLOCK_WRAP_SECONDS).
pub(crate) const SHADER_CLOCK_WRAP_SECONDS: f64 = 32768.0;

pub(crate) fn shader_clock_seconds(clock_seconds: f64) -> f32 {
    if !clock_seconds.is_finite() || clock_seconds <= 0.0 { return 0.0; }
    if clock_seconds < SHADER_CLOCK_WRAP_SECONDS { clock_seconds as f32 } else { clock_seconds.rem_euclid(SHADER_CLOCK_WRAP_SECONDS) as f32 }
}

/// The editor's launch clock at one moment: `beat` is the continuous beat
/// position at render time `time` (None: the next frame drawn).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct BeatClockAnchor {
    pub(crate) beat: f64,
    pub(crate) bpm: f32,
    pub(crate) time: Option<f64>,
}

impl BeatClockAnchor {
    pub(crate) fn from_command(command: &Value) -> Option<Self> {
        let beat = number_at(command, &["beat"]).filter(|value| value.is_finite())?;
        let bpm = number_at(command, &["bpm"]).filter(|value| value.is_finite() && *value > 0.0)?;
        let time = number_at(command, &["time"]).filter(|value| value.is_finite());
        Some(Self { beat, bpm: (bpm as f32).clamp(20.0, 400.0), time })
    }
}

/// Beat position for beat-synced Edge Effects (Looks). The editor anchors it
/// with `set_beat_clock` whenever its launch clock (tapped/typed tempo, audio
/// beats or Link) moves; between anchors it runs on the render clock at the
/// anchored tempo, so it keeps time between editor updates.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BeatClock {
    pub(crate) anchor_time: Option<f64>,
    pub(crate) anchor_beat: f64,
    pub(crate) bpm: f32,
    pub(crate) pending: Option<BeatClockAnchor>,
}

impl Default for BeatClock {
    fn default() -> Self {
        Self { anchor_time: None, anchor_beat: 0.0, bpm: 120.0, pending: None }
    }
}

impl BeatClock {
    pub(crate) fn rebase(&mut self, anchor: BeatClockAnchor) {
        self.pending = Some(anchor);
    }

    /// (beat position, bpm, _, _) at render time `time`.
    pub(crate) fn uniform(&mut self, time: f64) -> [f32; 4] {
        if let Some(anchor) = self.pending.take() {
            self.anchor_time = Some(anchor.time.unwrap_or(time));
            self.anchor_beat = anchor.beat;
            self.bpm = anchor.bpm;
        }
        let anchor_time = *self.anchor_time.get_or_insert(time);
        let beat = self.anchor_beat + (time - anchor_time) * f64::from(self.bpm) / 60.0;
        [beat.rem_euclid(BEAT_CLOCK_WRAP) as f32, self.bpm, 0.0, 0.0]
    }
}

impl App {
    pub(crate) fn apply_render_clock(&mut self, params: &Value) {
        let params = params.get("config").unwrap_or(params);
        let mode = string_at(params, &["mode"])
            .unwrap_or_else(|| "live".to_string())
            .trim()
            .to_ascii_lowercase();
        if mode == "reset" {
            self.launch_scheduler.clear(); self.scheduled_binding_guards.clear();
            if self.render_clock_mode == "manual" { self.leave_manual_clock_media(); }
            self.render_clock_mode = "live".to_string();
            self.render_clock_time = None;
            self.render_clock_frame_index = None;
            self.render_clock_delta = 1.0 / self.target_fps.max(1) as f32;
            self.last_native_graph_step_clock = None;
            self.stats.render_clock_updates = self.stats.render_clock_updates.saturating_add(1);
            return;
        }
        let next_mode = if mode == "manual" { "manual" } else { "live" };
        if next_mode == "manual" { self.launch_scheduler.clear(); self.scheduled_binding_guards.clear(); }
        if next_mode != self.render_clock_mode {
            // Leaving or entering manual export: forget the last stepped
            // virtual frame so the next manual run always steps.
            self.last_native_graph_step_clock = None;
            if next_mode == "manual" {
                self.enter_manual_clock_media();
                self.reset_native_graph_simulations();
            } else {
                self.leave_manual_clock_media();
            }
        }
        self.render_clock_mode = next_mode.to_string();
        self.render_clock_time = number_at(params, &["time"])
            .or_else(|| number_at(params, &["time_seconds"]))
            .or_else(|| number_at(params, &["clock_time"]))
            .map(|value| value.clamp(0.0, 1.0e9));
        self.render_clock_delta = number_at(params, &["time_delta"])
            .or_else(|| number_at(params, &["delta"]))
            .unwrap_or(1.0 / self.target_fps.max(1) as f64)
            .clamp(0.0, 10.0) as f32;
        self.render_clock_frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u64::MAX as f64) as u64);
        self.stats.render_clock_updates = self.stats.render_clock_updates.saturating_add(1);
    }

    /// The render clock in seconds, unwrapped and in f64: video anchors and
    /// other bookkeeping. Shaders get native_graph_time_seconds().
    pub(crate) fn native_clock_seconds(&self) -> f64 {
        if self.render_clock_mode == "manual" {
            return self.render_clock_time.unwrap_or(0.0).max(0.0);
        }
        self.start_time.elapsed().as_secs_f64().max(0.0)
    }

    /// Shader time: the render clock wrapped at SHADER_CLOCK_WRAP_SECONDS.
    pub(crate) fn native_graph_time_seconds(&self) -> f32 {
        shader_clock_seconds(self.native_clock_seconds())
    }

    pub(crate) fn native_frame_index(&self) -> u64 {
        effective_native_frame_index(
            &self.render_clock_mode,
            self.render_clock_frame_index,
            self.stats.gpu_frames_submitted,
        )
    }

    pub(crate) fn native_frame_delta(&self) -> f32 {
        effective_native_frame_delta(
            &self.render_clock_mode,
            // Manual clock: the step this render actually claimed, which is
            // 0 when the frame has already been advanced once. See
            // claim_native_graph_step().
            self.native_graph_step_delta_this_render,
            self.target_fps,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beat_clock_runs_on_the_render_clock_between_anchors() {
        let mut clock = BeatClock::default();
        // Unanchored: 120 BPM from the first frame.
        assert_eq!(clock.uniform(10.0), [0.0, 120.0, 0.0, 0.0]);
        assert!((clock.uniform(10.5)[0] - 1.0).abs() < 1e-4);
        // An anchor without a time lands on the next frame drawn.
        clock.rebase(BeatClockAnchor { beat: 64.25, bpm: 90.0, time: None });
        assert!((clock.uniform(20.0)[0] - 64.25).abs() < 1e-3);
        assert!((clock.uniform(22.0)[0] - 67.25).abs() < 1e-3);
        // A timed anchor is exact, and positions wrap without going negative.
        clock.rebase(BeatClockAnchor { beat: BEAT_CLOCK_WRAP - 0.5, bpm: 60.0, time: Some(5.0) });
        assert!((clock.uniform(6.0)[0] - 0.5).abs() < 1e-3);
        assert!(clock.uniform(4.0)[0] >= 0.0);
        let parsed = BeatClockAnchor::from_command(&json!({ "beat": 3.5, "bpm": 1000.0 })).unwrap();
        assert_eq!((parsed.beat, parsed.bpm, parsed.time), (3.5, 400.0, None));
        assert!(BeatClockAnchor::from_command(&json!({ "beat": 1.0 })).is_none());
    }

    #[test]
    fn shader_clock_is_the_live_clock_in_a_show_and_stays_fine_grained_for_weeks() {
        // Below the wrap, exactly the old f32 clock: nothing changes in a show.
        for t in [0.0, 1.0 / 60.0, 10.0, 3600.25, 4.0 * 3600.0 + 0.1, 9.0 * 3600.0] {
            assert_eq!(shader_clock_seconds(t), t as f32, "{t}");
        }
        assert_eq!(shader_clock_seconds(-1.0), 0.0);
        assert_eq!(shader_clock_seconds(f64::NAN), 0.0);
        // Past it, consecutive 60 fps frames (and 120 fps frames) always
        // step forward by close to a frame. With the old f32 clock a frame at
        // 12 h stepped 0 or 2 f32 ulps (3.9 ms each) and after a week
        // 62.5 ms, so most 60 fps frames repeated the last time.
        for hours in [12.0_f64, 24.0, 7.0 * 24.0, 30.0 * 24.0, 365.0 * 24.0] {
            for fps in [60.0_f64, 120.0] {
                let start = hours * 3600.0 + 0.123;
                let mut worst = 0.0_f64;
                let mut moves = 0;
                for frame in 0..240 {
                    let a = start + frame as f64 / fps;
                    let b = a + 1.0 / fps;
                    let step = shader_clock_seconds(b) as f64 - shader_clock_seconds(a) as f64;
                    if step < 0.0 { continue; } // the one wrap moment
                    moves += 1;
                    worst = worst.max((step - 1.0 / fps).abs());
                }
                assert!(moves >= 239, "{hours} h {fps} fps");
                assert!(worst <= 0.002, "{hours} h at {fps} fps: frame step off by {worst} s");
                let old_step = (start + 1.0 / fps) as f32 - start as f32;
                if hours >= 24.0 * 7.0 { assert!((old_step as f64 - 1.0 / fps).abs() > 0.004, "the old clock was coarse"); }
            }
        }
        // Whole and dyadic periods are seamless across the wrap.
        let before = SHADER_CLOCK_WRAP_SECONDS - 0.25;
        let after = SHADER_CLOCK_WRAP_SECONDS + 0.25;
        assert_eq!(shader_clock_seconds(after), 0.25);
        assert_eq!((shader_clock_seconds(before) * 2.0).fract(), (shader_clock_seconds(after) * 2.0).fract());
    }

    #[test]
    fn beat_clock_and_video_time_keep_the_unwrapped_clock() {
        // The beat clock is fed the unwrapped f64 clock: across the shader
        // wrap it keeps counting.
        let mut clock = BeatClock::default();
        let t0 = SHADER_CLOCK_WRAP_SECONDS - 1.0;
        clock.rebase(BeatClockAnchor { beat: 8.0, bpm: 120.0, time: Some(t0) });
        assert!((clock.uniform(t0 + 2.0)[0] - 12.0).abs() < 1e-3);
        // A week in, video time still moves by the frame step.
        let state = NativeMediaSourceState {
            uri: "week://clip".to_string(), source_type: "video".to_string(),
            playback_time_seconds: 1.0, seek_generation: 0, playback_rate: 1.0,
            paused: false, loop_enabled: true, bounce_enabled: false,
            duration_seconds: Some(10.0), trim_start: 0.0, trim_end: 1.0,
            decode_width: None, decode_height: None,
            clock_time_seconds: 7.0 * 86400.0, seq: 0,
        };
        let a = state.current_time_seconds(Some(7.0 * 86400.0 + 0.5));
        let b = state.current_time_seconds(Some(7.0 * 86400.0 + 0.5 + 1.0 / 60.0));
        assert!((a - 1.5).abs() < 1e-6 && (b - a - 1.0 / 60.0).abs() < 1e-6, "{a} {b}");
    }
}
