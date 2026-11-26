//! Media source state: playback state, held pictures, pending bindings, video
//! sessions and decode jobs, and the manual-clock video frame rules.

use crate::*;

#[derive(Clone, Debug)]
pub(crate) struct NativeVideoFrameDecodeJob {
    pub(crate) source_id: String,
    pub(crate) uri: String,
    pub(crate) path: PathBuf,
    pub(crate) width: usize,
    pub(crate) height: usize,
    pub(crate) time_seconds: f64,
    pub(crate) frame_bucket: u64,
    pub(crate) signature: String,
    pub(crate) seq: u64,
    pub(crate) pending_key: String,
    pub(crate) exact_preview: bool,
}

#[derive(Debug)]
pub(crate) struct NativeVideoFrameDecodeResult {
    pub(crate) source_id: String,
    pub(crate) uri: String,
    pub(crate) frame_bucket: u64,
    pub(crate) signature: String,
    pub(crate) seq: u64,
    pub(crate) pending_key: String,
    pub(crate) exact_preview: bool,
    pub(crate) result: Result<Vec<NativeVideoFrameDecodeOutput>, String>,
}

#[derive(Debug)]
pub(crate) struct VideoPrefetchResult {
    pub(crate) id: u64, pub(crate) source_id: String, pub(crate) signature: String, pub(crate) seq: u64, pub(crate) reserved_bytes: u64,
    pub(crate) deadline: Instant, pub(crate) frames: Result<Vec<NativeVideoFrameDecodeOutput>, String>,
}

#[derive(Clone, Debug)]
pub(crate) struct SourceFrame {
    pub(crate) seq: u64,
    pub(crate) source_rect: [f32; 4],
}

impl SourceFrame {
    pub(crate) fn full(seq: u64) -> Self {
        Self {
            seq,
            source_rect: [0.0, 0.0, 1.0, 1.0],
        }
    }

    pub(crate) fn with_rect(seq: u64, source_rect: [f32; 4]) -> Self {
        Self { seq, source_rect }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeMediaSourceState {
    pub(crate) uri: String,
    pub(crate) source_type: String,
    pub(crate) playback_time_seconds: f64,
    pub(crate) seek_generation: u64,
    pub(crate) playback_rate: f64,
    pub(crate) paused: bool,
    pub(crate) loop_enabled: bool,
    pub(crate) bounce_enabled: bool,
    pub(crate) duration_seconds: Option<f64>,
    pub(crate) trim_start: f64,
    pub(crate) trim_end: f64,
    pub(crate) decode_width: Option<usize>,
    pub(crate) decode_height: Option<usize>,
    pub(crate) clock_time_seconds: f64,
    pub(crate) seq: u64,
}

impl NativeMediaSourceState {
    pub(crate) fn current_playback_rate(&self, render_clock_time: Option<f64>) -> f64 {
        if !self.bounce_enabled || self.paused { return self.playback_rate; }
        let Some(duration) = self.duration_seconds.filter(|duration| *duration > 0.0) else {
            return self.playback_rate;
        };
        let lo = duration * self.trim_start;
        let span = (duration * self.trim_end - lo).max(f64::EPSILON);
        let elapsed = render_clock_time.map_or(0.0, |clock| (clock - self.clock_time_seconds).max(0.0));
        let phase = (self.playback_time_seconds + elapsed * self.playback_rate - lo).rem_euclid(2.0 * span);
        if phase.abs() < 1e-9 { self.playback_rate.abs() }
        else if (phase - span).abs() < 1e-9 { -self.playback_rate.abs() }
        else if phase < span { self.playback_rate } else { -self.playback_rate }
    }

    pub(crate) fn current_time_seconds(&self, render_clock_time: Option<f64>) -> f64 {
        let clock_delta = render_clock_time
            .map(|clock| clock - self.clock_time_seconds)
            .unwrap_or(0.0);
        let mut time = if self.paused {
            self.playback_time_seconds
        } else {
            self.playback_time_seconds + clock_delta * self.playback_rate
        };
        if let Some(duration) = self.duration_seconds.filter(|duration| *duration > 0.0) {
            let range_start = duration * self.trim_start.clamp(0.0, 1.0);
            let range_end = duration * self.trim_end.clamp(self.trim_start, 1.0);
            let range_duration = (range_end - range_start).max(f64::EPSILON);
            if self.bounce_enabled {
                let phase = (time - range_start).rem_euclid(2.0 * range_duration);
                time = range_start + if phase <= range_duration { phase } else { 2.0 * range_duration - phase };
            } else if self.loop_enabled && !(self.playback_rate < 0.0 && (time - range_end).abs() < 1e-9) {
                time = range_start + (time - range_start) % range_duration;
                if time < range_start {
                    time += range_duration;
                }
            } else {
                time = time.clamp(range_start, range_end);
            }
        }
        time.clamp(0.0, 3600.0)
    }
}

/// One video in a manual-clock snapshot: the media time and frame it shows,
/// and whether its playback should be moving it (playing, at a rate, and not
/// held at the far end of a clip that does not loop). A render fails when a
/// moving one stops changing frame.
pub(crate) fn manual_video_report_entry(id: &str, state: &NativeMediaSourceState, clock: f64, time: f64, fps: Option<f64>) -> Value {
    let rate = state.current_playback_rate(Some(clock));
    let mut moving = !state.paused && rate.abs() > 1e-9;
    if moving && !state.loop_enabled && !state.bounce_enabled
        && let Some(duration) = state.duration_seconds.filter(|d| *d > 0.0)
    {
        let lo = duration * state.trim_start.clamp(0.0, 1.0);
        let hi = duration * state.trim_end.clamp(state.trim_start, 1.0);
        let last = hi - fps.filter(|f| *f > 0.0).map_or(1.0e-3, |f| 1.0 / f);
        moving = if rate > 0.0 { time < last } else { time > lo };
    }
    // A loop shorter than two of its frames may show one frame throughout.
    if moving && (state.loop_enabled || state.bounce_enabled)
        && let (Some(duration), Some(fps)) = (state.duration_seconds.filter(|d| *d > 0.0), fps.filter(|f| *f > 0.0))
        && duration * (state.trim_end - state.trim_start).max(0.0) * fps < 2.0
    {
        moving = false;
    }
    json!({
        "id": id,
        "uri": state.uri,
        "time": time,
        "frame": fps.filter(|f| *f > 0.0).map(|f| (time * f + 1.0e-6).floor() as i64),
        "fps": fps,
        "rate": rate,
        "moving": moving,
        "paused": state.paused,
        "anchor_time": state.playback_time_seconds,
        "anchor_clock": state.clock_time_seconds,
        "seek_generation": state.seek_generation,
    })
}

/// The start of the source frame showing at media time `time_seconds`:
/// frame `floor(t * fps)` (with a hair for float error), or the time itself
/// when the rate is unknown.
pub(crate) fn manual_video_frame_time(time_seconds: f64, source_fps: Option<f64>) -> f64 {
    match source_fps.filter(|fps| fps.is_finite() && *fps > 0.0) {
        Some(fps) => ((time_seconds.max(0.0) * fps + 1.0e-6).floor()) / fps,
        None => time_seconds,
    }
}

/// Cache key for a manual-clock (offline export) video frame: the file,
/// decode size and the exact timestamp in microseconds, so frames closer
/// together than the live prefetch's 1/30 s buckets never alias.
pub(crate) fn manual_video_frame_signature(path: &Path, width: usize, height: usize, time_seconds: f64) -> Result<String, String> {
    let micros = (time_seconds.max(0.0) * 1_000_000.0).round() as u64;
    native_video_frame_file_signature(path, width, height, micros).map(|base| format!("manual-us:{base}"))
}

/// The picture a layer showed before its source changed. It stays on screen
/// until the new source delivers a picture of its own, so switching a layer
/// to a page, shader or image that is still starting never flashes the
/// loading fill or the layers underneath.
#[derive(Clone, Debug)]
pub(crate) struct HeldPicture {
    pub(crate) source_id: String,
    pub(crate) slot: usize,
    pub(crate) rect: [f32; 4],
    pub(crate) kind: f32,
    pub(crate) since: Instant,
}

/// How long a layer may hold its outgoing picture. A source that has not
/// delivered by then (a page that failed to load, a broken file) shows its
/// loading state instead of leaving the old content up.
pub(crate) const LAYER_HOLD_MAX: Duration = Duration::from_millis(1500);

#[derive(Clone, Debug)]
pub(crate) struct PendingMediaBinding {
    pub(crate) source_id: String,
    pub(crate) source_type: String,
}

pub(crate) fn is_clip_snapshot_source_id(source_id: &str) -> bool {
    source_id.strip_prefix("vj-clip-snapshot-")
        .and_then(|suffix| suffix.split_once('-'))
        .is_some_and(|(deck, row)| matches!(deck, "A" | "B")
            && row.parse::<u8>().is_ok_and(|index| index < 32 && row == index.to_string()))
}

#[derive(Default)]
pub(crate) struct SourceFrameGpuReadiness {
    pub(crate) epoch: AtomicU64,
    pub(crate) submitted_epoch: AtomicU64,
    pub(crate) completed_epoch: AtomicU64,
}

impl SourceFrameGpuReadiness {
    pub(crate) fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
    }

    pub(crate) fn ready(&self) -> bool {
        let epoch = self.epoch.load(Ordering::Acquire);
        epoch > 0 && self.completed_epoch.load(Ordering::Acquire) == epoch
    }

    pub(crate) fn submitted(&self) -> bool {
        let epoch = self.epoch.load(Ordering::Acquire);
        epoch > 0 && self.submitted_epoch.load(Ordering::Acquire) == epoch
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Default)]
pub(crate) struct NativeHapUploadBatch {
    pub(crate) encoder: Option<wgpu::CommandEncoder>,
    pub(crate) frames: Vec<(hardware_video::GpuVideoFrame, Option<media_decode::NativeVideoGpuLease>)>,
    pub(crate) slots: Vec<usize>,
}

#[derive(Clone)]
pub(crate) struct NativeVideoFrameCacheEntry {
    pub(crate) width: usize,
    pub(crate) height: usize,
    pub(crate) rgba: Vec<u8>,
    pub(crate) byte_length: usize,
}

/// Longest edge a video needs on the slice it is shown on, or None when the
/// slice fills the output (or more) and the full requested size is right.
///
/// 2.1.10 computed this size but only used it when the editor sent no decode
/// size, which it always does, and the hardware decoders ignored it: a 4K clip
/// on a small slice still decoded and held 4K frames, used up the video memory
/// budget and stalled the other decoders.
pub(crate) fn native_video_slice_edge_cap(output: (usize, usize), scale: f32) -> Option<usize> {
    if !scale.is_finite() || scale >= 1.0 || scale <= 0.0 {
        return None;
    }
    let scaled = |edge: usize| (((edge as f32 * scale) as usize) / 2 * 2).max(64);
    Some(scaled(output.0).max(scaled(output.1)))
}

/// Whether a running session's decode size no longer suits its slice.
///
/// It restarts when its slice grows past what it decodes, and when the slice
/// needs half the pixels per edge or fewer: a session usually starts before
/// its layer is bound (at full size), and must still come down to the slice
/// size. The gap between the two thresholds keeps a slice resized back and
/// forth from restarting its decoder at every step. A session handed over
/// warm from a VJ library preroll never shrinks: that would cost the instant
/// trigger it was prepared for.
pub(crate) fn native_video_decode_cap_needs_restart(
    current: Option<usize>,
    wanted: Option<usize>,
    full_edge: usize,
    allow_shrink: bool,
) -> bool {
    let full_edge = full_edge.max(1);
    let current_edge = current.unwrap_or(full_edge).min(full_edge);
    let wanted_edge = wanted.unwrap_or(full_edge).min(full_edge);
    wanted_edge > current_edge || (allow_shrink && wanted_edge.saturating_mul(2) <= current_edge)
}

pub(crate) struct NativeVideoStreamState {
    pub(crate) start_reverse: bool,
    pub(crate) phase_until: Option<Instant>,
    pub(crate) phase_error_seconds: Option<f64>,
    pub(crate) signature: String,
    pub(crate) transport_rate: f64,
    pub(crate) start_time_seconds: f64,
    pub(crate) stream: NativeVideoStream,
    pub(crate) seek_generation: u64,
    pub(crate) seq: u64,
    pub(crate) playing: bool,
    pub(crate) next_frame_at: Instant,
    pub(crate) last_used_frame: u64,
    pub(crate) frames_presented: u64,
    pub(crate) triggered_at: Option<Instant>,
    pub(crate) fallback_counted: bool,
    /// Longest edge this session decodes at, set by the slice it is shown on
    /// (None = the full requested size). See native_video_slice_edge_cap.
    pub(crate) decode_max_edge: Option<usize>,
    /// False for a session adopted warm from a library preroll.
    pub(crate) decode_may_shrink: bool,
}

#[derive(Clone)]
pub(crate) struct NativeVideoScrubRequest {
    pub(crate) seq: u64,
    pub(crate) frame_bucket: u64,
    pub(crate) uri: String,
    pub(crate) width: usize,
    pub(crate) height: usize,
    pub(crate) time_seconds: f64,
    pub(crate) hold_until: Instant,
}

/// Audio follower of one clip voice across picture transitions (see
/// `refresh_clip_audio`). The fade angle is the state; `ghost` is the last
/// transport seen, so a voice whose source was replaced by a transition
/// snapshot can finish fading out.
pub(crate) struct ClipAudioFade { pub(crate) theta: f64, pub(crate) role: clip_audio::FadeRole, pub(crate) row: String, pub(crate) at: Instant, pub(crate) ghost: Option<ClipAudioGhost> }

pub(crate) struct ClipAudioGhost { pub(crate) uri: String, pub(crate) time: f64, pub(crate) rate: f64, pub(crate) lo: f64, pub(crate) hi: f64, pub(crate) looping: bool, pub(crate) bounce: bool, pub(crate) gain: f32, pub(crate) pan: f32, pub(crate) at: Instant }

pub(crate) fn spawn_native_video_frame_decode(
    proxy: EventLoopProxy<UserEvent>,
    job: NativeVideoFrameDecodeJob,
) {
    thread::spawn(move || {
        let result = if job.exact_preview {
            decode_native_video_frame_exact_rgba(&job.path, job.width, job.height, job.time_seconds)
                .map(|(width, height, rgba)| {
                    vec![NativeVideoFrameDecodeOutput {
                        width,
                        height,
                        frame_bucket: job.frame_bucket,
                        signature: job.signature.clone(),
                        rgba,
                    }]
                })
        } else {
            decode_native_video_frame_window_rgba(
                &job.path,
                job.width,
                job.height,
                job.time_seconds,
                NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS,
                NATIVE_VIDEO_DECODE_PUMP_WINDOW_FRAMES.saturating_add(1),
            )
        };
        let _ = proxy.send_event(UserEvent::NativeVideoFrameDecoded(
            NativeVideoFrameDecodeResult {
                source_id: job.source_id,
                uri: job.uri,
                frame_bucket: job.frame_bucket,
                signature: job.signature,
                seq: job.seq,
                pending_key: job.pending_key,
                exact_preview: job.exact_preview,
                result,
            },
        ));
    });
}

#[cfg(test)]
mod manual_video_frame_tests {
    use super::manual_video_frame_time;

    /// At 120 fps a 30 fps clip shows each of its frames on exactly four
    /// render frames, starting when the frame starts (floor), never early.
    #[test]
    fn a_30_fps_clip_at_120_fps_repeats_each_frame_four_times() {
        let mut counts = std::collections::BTreeMap::new();
        for i in 0..1200u32 {
            let t = f64::from(i) / 120.0;
            let shown = (manual_video_frame_time(t, Some(30.0)) * 30.0).round() as i64;
            assert!(f64::from(shown as i32) / 30.0 <= t + 1e-9, "frame {shown} shown early at {t}");
            *counts.entry(shown).or_insert(0) += 1;
        }
        assert!(counts.values().all(|&n| n == 4), "{counts:?}");
        assert_eq!(counts.len(), 300);
    }

    #[test]
    fn ntsc_and_odd_ratios_never_skip_or_go_back() {
        let src = 30000.0 / 1001.0;
        let mut last = -1i64;
        for i in 0..6000u32 {
            let t = f64::from(i) * 1001.0 / 60000.0; // 59.94 render
            let k = (manual_video_frame_time(t, Some(src)) * src).round() as i64;
            assert!(k == last || k == last + 1, "jump {last} -> {k} at frame {i}");
            last = k;
        }
        // 25 fps clip at 120: 4.8 render frames per source frame, 4 or 5 each.
        let mut counts = std::collections::BTreeMap::new();
        for i in 0..1200u32 {
            let k = (manual_video_frame_time(f64::from(i) / 120.0, Some(25.0)) * 25.0).round() as i64;
            *counts.entry(k).or_insert(0) += 1;
        }
        assert!(counts.values().all(|&n| n == 4 || n == 5), "{counts:?}");
        assert_eq!(manual_video_frame_time(1.234, None), 1.234);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn videos_on_small_slices_decode_at_the_slice_size() {
        use super::{fit_video_long_edge, native_video_slice_edge_cap};
        // A full-frame slice keeps the editor's requested size.
        assert_eq!(native_video_slice_edge_cap((1920, 1080), 1.0), None);
        assert_eq!(native_video_slice_edge_cap((1920, 1080), f32::NAN), None);
        // A quarter-size slice of a 1080p output needs a 480-pixel edge.
        let cap = native_video_slice_edge_cap((1920, 1080), 0.25);
        assert_eq!(cap, Some(480));
        // The decode size is the smaller of what the editor asked for and
        // what the slice needs: a 2048x1152 request on that slice is 480x270.
        assert_eq!(fit_video_long_edge(2048, 1152, cap.map(|edge| edge as u32)), (480, 270));
        // A portrait clip keeps its shape and even sizes.
        assert_eq!(fit_video_long_edge(1080, 1920, Some(480)), (270, 480));
        assert_eq!(fit_video_long_edge(1001, 563, Some(500)), (500, 280));
        // A request already inside the cap is unchanged.
        assert_eq!(fit_video_long_edge(320, 180, Some(480)), (320, 180));
        // Never a degenerate size.
        assert_eq!(fit_video_long_edge(4096, 16, Some(64)), (64, 16));
        // The floor keeps tiny slices decodable.
        assert_eq!(native_video_slice_edge_cap((1920, 1080), 0.01), Some(64));
    }

    #[test]
    fn a_cropped_video_tile_decodes_at_the_size_of_the_part_it_shows() {
        use super::{SceneLayer, native_video_slice_edge_cap, video_decode_scale_for_layers};
        let tile = |crop: [f32; 4]| {
            let mut layer = SceneLayer::new("tile".to_string(), 0);
            // A quarter of a 1920x1080 output each way.
            layer.corners = [[0.0, 0.0], [0.25, 0.0], [0.25, 0.25], [0.0, 0.25]];
            layer.uv0 = crop;
            layer
        };
        // Uncropped, a quarter-size tile decodes small (480 on the long edge).
        let whole = tile([0.0, 0.0, 1.0, 1.0]);
        let scale = video_decode_scale_for_layers(std::iter::once(&whole));
        assert_eq!(native_video_slice_edge_cap((1920, 1080), scale), Some(720));
        // One tile of a 4x4 wall shows a sixteenth of the clip over a
        // sixteenth of the output: it needs the full decode, not 720.
        let wall = tile([0.25, 0.5, 0.25, 0.25]);
        let scale = video_decode_scale_for_layers(std::iter::once(&wall));
        assert_eq!(native_video_slice_edge_cap((1920, 1080), scale), None);
        // Half the clip on that tile needs half again as much as uncropped.
        let half = tile([0.0, 0.0, 0.5, 0.5]);
        let scale = video_decode_scale_for_layers(std::iter::once(&half));
        assert_eq!(native_video_slice_edge_cap((1920, 1080), scale), Some(1440));
        // Fill on a wide clip crops its sides: the shown width counts.
        let mut filled = tile([0.0, 0.0, 1.0, 1.0]);
        filled.uv1 = [1.0, 4.0, 0.0, 0.0];
        let scale = video_decode_scale_for_layers(std::iter::once(&filled));
        assert_eq!(native_video_slice_edge_cap((1920, 1080), scale), None);
        // A video no layer shows decodes in full.
        assert_eq!(video_decode_scale_for_layers(std::iter::empty()), 1.0);
    }

    #[test]
    fn a_session_restarts_when_its_slice_grows_or_halves_but_not_on_small_changes() {
        use super::native_video_decode_cap_needs_restart as restart;
        let full = 1920;
        assert!(!restart(None, None, full, true));
        assert!(restart(Some(480), None, full, true), "a slice grown to full frame needs the full size");
        assert!(restart(Some(480), Some(720), full, true));
        assert!(!restart(Some(480), Some(480), full, true));
        // Started before its layer was bound: comes down to a quarter slice.
        assert!(restart(None, Some(480), full, true));
        // Small reductions keep the running decoder (no churn while dragging).
        assert!(!restart(None, Some(1440), full, true));
        assert!(!restart(Some(960), Some(720), full, true));
        assert!(restart(Some(960), Some(480), full, true));
        // A warm library session handed to a layer never shrinks.
        assert!(!restart(None, Some(480), full, false));
        assert!(restart(Some(480), None, full, false));
    }

    #[test]
    fn native_video_clock_loops_and_clamps_inside_trim_bounds() {
        let mut state = NativeMediaSourceState {
            uri: "/tmp/clip.mp4".to_string(),
            source_type: "video".to_string(),
            playback_time_seconds: 2.0,
            seek_generation: 0,
            playback_rate: 1.0,
            paused: false,
            loop_enabled: true,
            bounce_enabled: false,
            duration_seconds: Some(10.0),
            trim_start: 0.2,
            trim_end: 0.6,
            decode_width: Some(1024),
            decode_height: Some(576),
            clock_time_seconds: 0.0,
            seq: 1,
        };
        assert!((state.current_time_seconds(Some(5.0)) - 3.0).abs() < 0.0001);

        state.loop_enabled = false;
        assert!((state.current_time_seconds(Some(20.0)) - 6.0).abs() < 0.0001);
        state.playback_rate = -1.0;
        state.playback_time_seconds = 6.0;
        state.loop_enabled = true;
        assert_eq!(state.current_time_seconds(Some(0.0)), 6.0);
        assert_eq!(state.current_time_seconds(Some(1.0)), 5.0);
        assert_eq!(state.current_time_seconds(Some(5.0)), 5.0);
        state.loop_enabled = false;
        assert_eq!(state.current_time_seconds(Some(20.0)), 2.0);

        state.bounce_enabled = true;
        state.playback_rate = 1.0;
        state.playback_time_seconds = 2.0;
        for (clock, time, direction) in [(0.0, 2.0, 1.0), (4.0, 6.0, -1.0), (5.0, 5.0, -1.0), (8.0, 2.0, 1.0), (600.0, 2.0, 1.0)] {
            assert_eq!(state.current_time_seconds(Some(clock)), time);
            assert_eq!(state.current_playback_rate(Some(clock)), direction);
        }
        state.playback_time_seconds = state.current_time_seconds(Some(5.0));
        state.playback_rate = -1.0;
        state.clock_time_seconds = 5.0;
        state.paused = true;
        assert_eq!(state.current_time_seconds(Some(50.0)), 5.0);
        assert_eq!(state.current_playback_rate(Some(50.0)), -1.0);
        state.paused = false;
        state.clock_time_seconds = 50.0;
        assert_eq!(state.current_time_seconds(Some(51.0)), 4.0);
        assert_eq!(state.current_time_seconds(Some(54.0)), 3.0);
        assert_eq!(state.current_playback_rate(Some(54.0)), 1.0);

    }
}
