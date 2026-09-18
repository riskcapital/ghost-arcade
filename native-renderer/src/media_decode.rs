use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, Read},
    path::{Path, PathBuf},
    process::{Child, ChildStdout, Command, Stdio},
    sync::{
        Arc, Condvar, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

pub const MAX_NATIVE_IMAGE_DECODE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_NATIVE_IMAGE_DECODE_PIXELS: u64 = 8192 * 8192;
pub const MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION: usize = 4096;
pub const NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES: u32 = 4;
pub const NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS: f64 = 30.0;
pub const NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS: f64 = 1.0;
pub const NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS: f64 = 120.0;

#[derive(Debug)]
pub struct NativeVideoFrameDecodeOutput {
    pub width: usize,
    pub height: usize,
    pub frame_bucket: u64,
    pub signature: String,
    pub rgba: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct NativeVideoStreamFrame {
    pub presentation_frame: u64,
    pub source_time_seconds: Option<f64>,
    pub source_frame_duration_seconds: Option<f64>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub gpu: Option<crate::hardware_video::GpuVideoFrame>,
    /// Clones share this reservation; keep it with a native texture through GPU completion.
    pub memory_lease: Option<Arc<NativeVideoMemoryLease>>,
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

pub struct NativeVideoStream {
    frames: Arc<Mutex<VecDeque<Result<NativeVideoStreamFrame, String>>>>,
    stop: Arc<AtomicBool>,
    playing: Arc<AtomicBool>,
    play_state_changes: AtomicU64,
    children: Arc<Mutex<Vec<Child>>>,
    wake: Arc<Condvar>,
    clock: Mutex<Option<(Instant, u64)>>,
    next_frame: AtomicU64,
    wanted_frame: Arc<AtomicU64>,
    dropped_frames: Arc<AtomicU64>,
    /// Output frames per second as f64 bits: the clip's own rate times the
    /// playback rate, capped at 60. The producer sets it before its first frame.
    output_fps: Arc<AtomicU64>,
    /// Playback has started but no frame has been shown yet. The media clock
    /// is re-anchored to the first decoded frame, so the decoder's start-up
    /// time is not skipped out of the clip.
    awaiting_first_frame: AtomicBool,
    capacity: Arc<AtomicUsize>,
    frame_bytes: usize,
    playback_rate: f64,
    free_frames: Arc<Mutex<Vec<Vec<u8>>>>,
    backend: Arc<AtomicU64>,
    fallback_reason: Arc<Mutex<String>>,
    source_metadata: Arc<NativeVideoSourceMetadata>,
    memory_lease: Arc<NativeVideoMemoryLease>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    hardware_control: Arc<Mutex<HardwareStreamControl>>,
}

/// Decoder metadata and the last successfully uploaded source frame. NaN means
/// unavailable, so an unprepared source never claims an invented frame rate.
struct NativeVideoSourceMetadata {
    fps: AtomicU64,
    duration: AtomicU64,
    presented_time: AtomicU64,
    presented_duration: AtomicU64,
}

impl Default for NativeVideoSourceMetadata {
    fn default() -> Self {
        Self {
            fps: AtomicU64::new(f64::NAN.to_bits()),
            duration: AtomicU64::new(f64::NAN.to_bits()),
            presented_time: AtomicU64::new(f64::NAN.to_bits()),
            presented_duration: AtomicU64::new(f64::NAN.to_bits()),
        }
    }
}

fn optional_video_number(value: &AtomicU64) -> Option<f64> {
    let value = f64::from_bits(value.load(Ordering::Acquire));
    (value.is_finite() && value >= 0.0).then_some(value)
}

/// Shared admission for application-owned decoded pixels. The platform codec's
/// opaque internal reference pool is separate from this handoff budget.
#[derive(Debug)]
pub struct NativeVideoMemoryBudget {
    limit: AtomicU64,
    used: AtomicU64,
    optional_cache_allowed: AtomicBool,
}

impl NativeVideoMemoryBudget {
    pub fn new(limit: u64) -> Self {
        Self { limit: AtomicU64::new(limit), used: AtomicU64::new(0), optional_cache_allowed: AtomicBool::new(true) }
    }

    pub fn set_limit(&self, limit: u64) {
        // Lowering the cap preserves existing playback. Further admissions
        // wait for existing owners to release enough of the old reservation.
        self.limit.store(limit, Ordering::Release);
        if self.is_over_limit() {
            self.optional_cache_allowed.store(false, Ordering::Release);
        }
    }

    pub fn limit_bytes(&self) -> u64 { self.limit.load(Ordering::Acquire) }
    pub fn is_over_limit(&self) -> bool {
        self.used.load(Ordering::Acquire) > self.limit_bytes()
    }
    pub fn set_optional_cache_allowed(&self, allowed: bool) {
        // A lowered cap is itself pressure, even before another decoder has
        // registered an admission request. Keep yielding until owners shrink.
        self.optional_cache_allowed.store(allowed && !self.is_over_limit(), Ordering::Release);
    }

    fn lease(self: &Arc<Self>) -> Arc<NativeVideoMemoryLease> {
        Arc::new(NativeVideoMemoryLease { budget: self.clone(), bytes: AtomicU64::new(0), requested_bytes: AtomicU64::new(0), optional_bytes: AtomicU64::new(0), gpu_in_flight: AtomicUsize::new(0) })
    }
}

#[derive(Debug)]
pub struct NativeVideoMemoryLease {
    budget: Arc<NativeVideoMemoryBudget>,
    bytes: AtomicU64,
    requested_bytes: AtomicU64,
    optional_bytes: AtomicU64,
    gpu_in_flight: AtomicUsize,
}

impl NativeVideoMemoryLease {
    pub fn begin_gpu_work(self: &Arc<Self>) -> NativeVideoGpuLease {
        // The single render thread acquires this immediately after try_pop,
        // which admits no more than the two conversion surfaces we reserve.
        let previous = self.gpu_in_flight.fetch_add(1, Ordering::AcqRel);
        debug_assert!(previous < 2);
        NativeVideoGpuLease(self.clone())
    }

    /// Only the decoder worker resizes its lease; all other owners retain it.
    fn try_resize(&self, bytes: u64) -> bool {
        self.try_resize_inner(bytes, true)
    }

    fn try_grow_optional(&self, bytes: u64) -> bool {
        if bytes <= self.bytes.load(Ordering::Acquire) { return true; }
        self.try_resize_inner(bytes, false)
    }

    fn try_resize_inner(&self, bytes: u64, required: bool) -> bool {
        let previous = self.bytes.load(Ordering::Acquire);
        if bytes <= previous {
            self.bytes.store(bytes, Ordering::Release);
            self.budget.used.fetch_sub(previous - bytes, Ordering::AcqRel);
            self.requested_bytes.store(0, Ordering::Release);
            return true;
        }
        let additional = bytes - previous;
        let mut used = self.budget.used.load(Ordering::Acquire);
        loop {
            let Some(next) = used.checked_add(additional) else { return false; };
            if next > self.budget.limit.load(Ordering::Acquire) {
                if required { self.requested_bytes.store(bytes, Ordering::Release); }
                return false;
            }
            match self.budget.used.compare_exchange_weak(used, next, Ordering::AcqRel, Ordering::Acquire) {
                Ok(_) => {
                    self.bytes.store(bytes, Ordering::Release);
                    self.requested_bytes.store(0, Ordering::Release);
                    return true;
                }
                Err(actual) => used = actual,
            }
        }
    }
}

pub struct NativeVideoGpuLease(Arc<NativeVideoMemoryLease>);

impl Drop for NativeVideoGpuLease {
    fn drop(&mut self) {
        self.0.gpu_in_flight.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Drop for NativeVideoMemoryLease {
    fn drop(&mut self) {
        self.budget.used.fetch_sub(self.bytes.load(Ordering::Acquire), Ordering::AcqRel);
    }
}

fn wait_for_video_memory(lease: &NativeVideoMemoryLease, bytes: u64, stop: &AtomicBool) -> bool {
    loop {
        if stop.load(Ordering::Acquire) { return false; }
        if lease.try_resize(bytes) { return true; }
        // Retired workers and GPU submissions release asynchronously. Keep
        // the requested byte count visible to library-reclamation policy, and
        // do not launch a fresh decoder process before admission succeeds.
        thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Default)]
struct HardwareStreamControl {
    generation: u64,
    reset: Option<HardwareStreamReset>,
    cache_start: f64,
    // Paused scrubbing reuses the opening cache's reservation, rather than
    // retaining an additional history alongside the loop's opening surfaces.
    scrub_history: bool,
    history_capacity: usize,
    scrub_cache_hits: u64,
    scrub_cache_misses: u64,
    forward_continuations: u64,
    opening: Vec<NativeVideoStreamFrame>,
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
enum HardwareStreamReset {
    Seek { start: f64, resume: f64 },
    Step { reference: f64, direction: i32 },
}

const VIDEO_TIMESTAMP_EPSILON: f64 = 0.000001;
const NATIVE_VIDEO_FORWARD_SCAN_SECONDS: f64 = 0.5;
const NATIVE_VIDEO_SCRUB_CACHE_BYTES: u64 = 64 * 1024 * 1024;
const NATIVE_VIDEO_SCRUB_CACHE_FRAMES: usize = 96;

fn scrub_history_limit(surface_bytes: u64, minimum: usize) -> usize {
    if surface_bytes == 0 { return minimum; }
    ((NATIVE_VIDEO_SCRUB_CACHE_BYTES / surface_bytes) as usize)
        .min(NATIVE_VIDEO_SCRUB_CACHE_FRAMES).max(minimum)
}

/// Opportunistic admission never advertises a required waiter or grows past
/// the global cap. A concurrent decoder admission can only reduce this cache.
fn reserve_scrub_history(lease: &NativeVideoMemoryLease, surface_bytes: u64, ring: usize, decoder: usize) -> usize {
    let minimum = ring.min(4);
    if surface_bytes == 0 || !lease.budget.optional_cache_allowed.load(Ordering::Acquire) { return minimum; }
    let outside_cache = ring + decoder + 2;
    let available = lease.budget.limit_bytes().saturating_sub(lease.budget.used.load(Ordering::Acquire));
    let possible = ((lease.bytes.load(Ordering::Acquire).saturating_add(available) / surface_bytes) as usize)
        .saturating_sub(outside_cache).min(scrub_history_limit(surface_bytes, minimum));
    for count in (minimum + 1..=possible).rev() {
        let requested = surface_bytes.saturating_mul((outside_cache + count) as u64);
        if lease.try_grow_optional(requested) {
            let base = surface_bytes.saturating_mul((outside_cache + minimum) as u64);
            lease.optional_bytes.store(lease.bytes.load(Ordering::Acquire).saturating_sub(base), Ordering::Release);
            return count;
        }
    }
    minimum
}

/// Reuse only the actual containing frame and its contiguous decoded
/// successors. Gaps, VFR holds, and loop-wrap duplicates cannot skip pictures.
fn cached_video_suffix<'a>(
    candidates: impl Iterator<Item = &'a NativeVideoStreamFrame>,
    target: f64,
    playback_rate: f64,
    limit: usize,
) -> Vec<NativeVideoStreamFrame> {
    let mut candidates = candidates.filter_map(|frame| {
        let (Some(pts), Some(duration)) = (frame.source_time_seconds, frame.source_frame_duration_seconds) else { return None; };
        (pts.is_finite() && duration.is_finite() && duration > 0.0).then_some((pts, duration, frame))
    }).collect::<Vec<_>>();
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
    let Some(first) = candidates.iter().rposition(|(pts, duration, _)|
        *pts <= target + VIDEO_TIMESTAMP_EPSILON && *pts + *duration > target + VIDEO_TIMESTAMP_EPSILON)
    else { return Vec::new(); };
    let mut selected = Vec::new();
    let mut expected = candidates[first].0;
    let mut previous_pts = f64::NEG_INFINITY;
    for (pts, duration, frame) in candidates.into_iter().skip(first) {
        if selected.len() >= limit { break; }
        if pts <= previous_pts + VIDEO_TIMESTAMP_EPSILON { continue; }
        if (pts - expected).abs() > VIDEO_TIMESTAMP_EPSILON { break; }
        let mut replay = frame.clone();
        replay.presentation_frame = ((pts - target).max(0.0) / playback_rate.max(0.01) * 1_000_000.0).round() as u64;
        selected.push(replay);
        previous_pts = pts;
        expected = pts + duration;
    }
    selected
}

fn remember_scrub_frame(cache: &mut Vec<NativeVideoStreamFrame>, frame: &NativeVideoStreamFrame, limit: usize) {
    cache.retain(|cached| cached.source_time_seconds != frame.source_time_seconds);
    cache.push(frame.clone());
    if cache.len() > limit { cache.drain(..cache.len() - limit); }
}

fn can_continue_video_forward(cursor_end: Option<f64>, requested: f64) -> bool {
    cursor_end.is_some_and(|end| requested + VIDEO_TIMESTAMP_EPSILON >= end
        && requested - end <= NATIVE_VIDEO_FORWARD_SCAN_SECONDS)
}

impl NativeVideoStream {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        self.wake.notify_all();
        // Kill decoder processes immediately. Without this, a producer thread
        // blocked in read_exact() only notices the stop flag when ffmpeg emits
        // its next frame — which can be arbitrarily late right after a seek —
        // and rapid scrubbing piles up orphaned decoders until process slots
        // are exhausted. Killing here makes the pipe EOF instantly; reaping
        // (wait) stays on the producer thread.
        if let Ok(mut children) = self.children.lock() {
            for child in children.iter_mut() {
                let _ = child.kill();
            }
        }
    }

    pub fn set_playing(&self, playing: bool) {
        if self.playing.swap(playing, Ordering::AcqRel) != playing {
            self.play_state_changes.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut clock) = self.clock.lock() {
                if !playing && !self.awaiting_first_frame.load(Ordering::Acquire) {
                    if let Some((anchor, origin)) = clock.as_ref() {
                        let fps = f64::from_bits(self.output_fps.load(Ordering::Acquire));
                        self.next_frame.store(origin.saturating_add((anchor.elapsed().as_secs_f64() * fps).floor() as u64), Ordering::Release);
                    }
                }
                *clock = playing.then(|| (Instant::now(), self.next_frame.load(Ordering::Acquire)));
            }
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            if playing
                && let Ok(frames) = self.frames.lock()
                && let Ok(mut control) = self.hardware_control.lock()
                && control.scrub_history
            {
                // Restore normal loop/retrigger cache policy on resume. Only
                // keep a contiguous opening at the last requested in-point.
                control.opening = cached_video_suffix(
                    control.opening.iter().chain(frames.iter().filter_map(|frame| frame.as_ref().ok())),
                    control.cache_start, self.playback_rate, self.capacity.load(Ordering::Acquire).min(4));
                control.scrub_history = false;
            }
        }
    }

    pub fn recycle(&self, frame: Vec<u8>) {
        if frame.len() != self.frame_bytes {
            return;
        }
        if let Ok(mut free) = self.free_frames.lock() {
            if free.len() < 2 {
                free.push(frame);
            }
        }
    }

    pub fn memory_bytes(&self) -> usize {
        self.memory_lease.bytes.load(Ordering::Acquire) as usize
    }
    pub fn memory_waiting_bytes(&self) -> u64 {
        self.memory_lease.requested_bytes.load(Ordering::Acquire)
    }
    pub fn optional_memory_bytes(&self) -> u64 {
        self.memory_lease.optional_bytes.load(Ordering::Acquire)
    }
    pub fn backend(&self) -> &'static str {
        match self.backend.load(Ordering::Acquire) {
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            1 => crate::hardware_video::BACKEND, 2 | 3 => "ffmpeg", 4 => "failed", _ => "preparing",
        }
    }
    pub fn fallback_reason(&self) -> String {
        self.fallback_reason.lock().map(|s| s.clone()).unwrap_or_default()
    }
    pub fn hardware_fallback(&self) -> bool { self.backend.load(Ordering::Acquire) == 3 }

    pub fn scrub_cache_stats(&self) -> (u64, u64, u64) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Ok(control) = self.hardware_control.lock() {
            return (control.scrub_cache_hits, control.scrub_cache_misses, control.forward_continuations);
        }
        (0, 0, 0)
    }

    pub fn source_timing(&self) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
        (optional_video_number(&self.source_metadata.presented_time),
         optional_video_number(&self.source_metadata.presented_duration),
         optional_video_number(&self.source_metadata.fps).filter(|value| *value > 0.0),
         optional_video_number(&self.source_metadata.duration).filter(|value| *value > 0.0))
    }

    pub fn frame_step_exact(&self) -> bool { self.backend.load(Ordering::Acquire) == 1 }

    pub fn record_presented(&self, time: Option<f64>, duration: Option<f64>) {
        self.source_metadata.presented_duration.store(duration.unwrap_or(f64::NAN).to_bits(), Ordering::Release);
        self.source_metadata.presented_time.store(time.unwrap_or(f64::NAN).to_bits(), Ordering::Release);
    }

    /// Queue an exact adjacent-frame request on the existing decoder worker.
    /// The caller supplies the last presented PTS, never the playback clock.
    pub fn step_frame(&self, reference: f64, direction: i32) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if self.frame_step_exact() && reference.is_finite() && matches!(direction, -1 | 1) {
            self.set_playing(false);
            let Ok(mut frames) = self.frames.lock() else { return false; };
            let Ok(mut control) = self.hardware_control.lock() else { return false; };
            frames.clear();
            control.opening.clear();
            control.scrub_history = false;
            control.generation = control.generation.wrapping_add(1);
            control.reset = Some(HardwareStreamReset::Step { reference, direction });
            self.next_frame.store(0, Ordering::Release);
            self.wanted_frame.store(0, Ordering::Release);
            self.awaiting_first_frame.store(true, Ordering::Release);
            self.wake.notify_all();
            return true;
        }
        let _ = (reference, direction);
        false
    }

    /// Reset the prepared hardware session without touching the filesystem on
    /// the render thread. Opening surfaces are shared, never copied or mapped.
    pub fn retrigger(&self, start: f64, scrubbing: bool) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if self.backend.load(Ordering::Acquire) == 1 {
            let Ok(mut frames) = self.frames.lock() else { return false; };
            let Ok(mut control) = self.hardware_control.lock() else { return false; };
            let same_start = !control.scrub_history && (control.cache_start - start).abs() < 0.0001;
            let mut resume = start;
            if scrubbing {
                let history_limit = control.history_capacity.max(self.capacity.load(Ordering::Acquire).min(4));
                let replay = cached_video_suffix(
                    control.opening.iter().chain(frames.iter().filter_map(|frame| frame.as_ref().ok())),
                    start, self.playback_rate, self.capacity.load(Ordering::Acquire));
                frames.clear();
                if let Some(first) = replay.first() {
                    control.scrub_cache_hits = control.scrub_cache_hits.saturating_add(1);
                    remember_scrub_frame(&mut control.opening, first, history_limit);
                } else {
                    control.scrub_cache_misses = control.scrub_cache_misses.saturating_add(1);
                }
                let limit = history_limit;
                if control.opening.len() > limit {
                    let excess = control.opening.len() - limit;
                    control.opening.drain(..excess);
                }
                for frame in replay {
                    if let (Some(pts), Some(duration)) = (frame.source_time_seconds, frame.source_frame_duration_seconds) {
                        resume = resume.max(pts + duration);
                    }
                    frames.push_back(Ok(frame));
                }
                control.scrub_history = true;
                control.cache_start = start;
            } else if same_start {
                frames.clear();
                for frame in &control.opening {
                    if let Some(gpu) = &frame.gpu {
                        resume = resume.max(gpu.pts_seconds + gpu.duration_seconds);
                    }
                    frames.push_back(Ok(frame.clone()));
                }
            } else {
                frames.clear();
                control.opening.clear();
                control.scrub_history = false;
                control.cache_start = start;
            }
            control.generation = control.generation.wrapping_add(1);
            control.reset = Some(HardwareStreamReset::Seek { start, resume });
            self.next_frame.store(0, Ordering::Release);
            self.wanted_frame.store(0, Ordering::Release);
            self.awaiting_first_frame.store(true, Ordering::Release);
            if let Ok(mut clock) = self.clock.lock() {
                *clock = self.playing.load(Ordering::Acquire).then(|| (Instant::now(), 0));
            }
            self.wake.notify_all();
            return true;
        }
        let _ = (start, scrubbing);
        false
    }
    pub fn timing(&self) -> (f64, Option<f64>, u64) {
        let fps = f64::from_bits(self.output_fps.load(Ordering::Acquire)).max(0.01);
        let next = self.frames.lock().ok().and_then(|queue| queue.front()
            .and_then(|frame| frame.as_ref().ok()).map(|frame| frame.presentation_frame as f64 / fps));
        let clock = self.clock.lock().ok().and_then(|clock| clock.as_ref()
            .map(|(anchor, origin)| *origin as f64 / fps + anchor.elapsed().as_secs_f64()))
            .unwrap_or(self.next_frame.load(Ordering::Acquire) as f64 / fps);
        (clock, next, self.play_state_changes.load(Ordering::Relaxed))
    }
    pub fn ready_frames(&self) -> usize {
        self.capacity.load(Ordering::Acquire).saturating_sub(1).min(6).max(1)
    }
    pub fn dropped_frames(&self) -> u64 {
        self.dropped_frames.load(Ordering::Relaxed)
    }

    pub fn buffered_frames(&self) -> usize {
        self.frames.lock().map(|frames| frames.iter().filter(|frame| frame.is_ok()).count()).unwrap_or(0)
    }

    pub fn try_pop(&self) -> Option<Result<NativeVideoStreamFrame, String>> {
        if self.memory_lease.gpu_in_flight.load(Ordering::Acquire) >= 2 { return None; }
        let mut frames = self.frames.lock().ok()?;
        let target = {
            let mut clock = self.clock.lock().ok()?;
            if clock.is_some() && self.awaiting_first_frame.load(Ordering::Acquire) {
                match frames.front() {
                    Some(Ok(first)) => {
                        // Start the media clock when there is something to
                        // show, not when playback was requested. Timing from
                        // the request made the producer discard every frame
                        // decoded during ffmpeg's start-up, so a clip began
                        // part-way in.
                        *clock = Some((Instant::now(), first.presentation_frame));
                        self.awaiting_first_frame.store(false, Ordering::Release);
                    }
                    Some(Err(_)) => {}
                    None => return None,
                }
            }
            let fps = f64::from_bits(self.output_fps.load(Ordering::Acquire));
            clock.as_ref().map(|(anchor, origin)| {
                origin.saturating_add((anchor.elapsed().as_secs_f64() * fps).floor() as u64)
            })
        };
        let mut latest: Option<Result<NativeVideoStreamFrame, String>> = None;
        if let Some(target) = target {
            self.wanted_frame.store(target, Ordering::Release);
            while frames.front().is_some_and(|frame| {
                frame
                    .as_ref()
                    .map_or(true, |f| f.presentation_frame <= target)
            }) {
                if let Some(previous) = latest.take() {
                    self.dropped_frames.fetch_add(1, Ordering::Relaxed);
                    if let Ok(frame) = previous {
                        self.recycle(frame.rgba);
                    }
                }
                latest = frames.pop_front();
            }
        } else {
            latest = frames.pop_front();
        }
        if let Some(Ok(frame)) = &latest {
            self.next_frame
                .store(frame.presentation_frame + 1, Ordering::Release);
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            if let Ok(mut control) = self.hardware_control.lock()
                && control.scrub_history
            {
                let limit = control.history_capacity.max(self.capacity.load(Ordering::Acquire).min(4));
                remember_scrub_frame(&mut control.opening, frame, limit);
            }
        }
        self.wake.notify_one();
        latest
    }
}

impl Drop for NativeVideoStream {
    fn drop(&mut self) {
        self.stop();
    }
}

const NATIVE_VIDEO_PREROLL_FRAMES: usize = 8;
/// Streams never present faster than the render loop's 60 Hz video cadence.
const NATIVE_VIDEO_MAX_OUTPUT_FPS: f64 = 60.0;
/// Used when ffmpeg's stream summary has no frame rate.
const NATIVE_VIDEO_FALLBACK_FPS: f64 = 30.0;

fn video_debug() -> bool {
    static FLAG: OnceLock<bool> = OnceLock::new();
    *FLAG.get_or_init(|| std::env::var("GHOST_DEBUG_VIDEO").is_ok_and(|v| v == "1"))
}

/// The frame rate in one of ffmpeg's stream lines, e.g. "Stream #0:0: Video:
/// rawvideo (RGBA), rgba, 1024x576, q=2-31, 566231 kb/s, 30 fps, 30 tbn".
/// Prefers "fps" and falls back to "tbr".
fn parse_video_fps(line: &str) -> Option<f64> {
    if !line.contains("Video:") {
        return None;
    }
    let fields = line.split(',').map(str::trim);
    let mut tbr = None;
    for field in fields {
        let mut parts = field.split_whitespace();
        let (Some(value), Some(unit)) = (parts.next(), parts.next()) else {
            continue;
        };
        let Ok(value) = value.trim_end_matches('k').parse::<f64>() else {
            continue;
        };
        if !(value.is_finite() && value > 0.0 && value < 1000.0) {
            continue;
        }
        match unit {
            "fps" => return Some(value),
            "tbr" => tbr = Some(value),
            _ => {}
        }
    }
    tbr
}

fn parse_video_duration(line: &str) -> Option<f64> {
    let timestamp = line.trim().strip_prefix("Duration: ")?.split(',').next()?;
    let mut parts = timestamp.split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    let duration = hours * 3600.0 + minutes * 60.0 + seconds;
    (parts.next().is_none() && duration.is_finite() && duration > 0.0).then_some(duration)
}

pub fn spawn_native_video_stream(
    path: PathBuf,
    width: usize,
    height: usize,
    start_time_seconds: f64,
    playback_rate: f64,
    loop_enabled: bool,
    duration_seconds: Option<f64>,
    trim_start: f64,
    trim_end: f64,
    capacity: usize,
    memory_budget: Arc<NativeVideoMemoryBudget>,
    #[cfg(target_os = "windows")] video_device: Result<crate::windows_video_texture::WindowsVideoDevice, String>,
) -> NativeVideoStream {
    let capacity = capacity.clamp(2, NATIVE_VIDEO_PREROLL_FRAMES);
    let effective_capacity = Arc::new(AtomicUsize::new(capacity));
    let frame_bytes = width.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION)
        * height.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION)
        * 4;
    let wake = Arc::new(Condvar::new());
    let thread_wake = Arc::clone(&wake);
    let free_frames = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let thread_free = free_frames.clone();
    let wanted_frame = Arc::new(AtomicU64::new(0));
    let thread_wanted = Arc::clone(&wanted_frame);
    let dropped_frames = Arc::new(AtomicU64::new(0));
    let thread_dropped = Arc::clone(&dropped_frames);
    let output_fps = Arc::new(AtomicU64::new(NATIVE_VIDEO_FALLBACK_FPS.to_bits()));
    let thread_output_fps = Arc::clone(&output_fps);
    let frames = Arc::new(Mutex::new(VecDeque::with_capacity(capacity)));
    let stop = Arc::new(AtomicBool::new(false));
    let playing = Arc::new(AtomicBool::new(false));
    let children = Arc::new(Mutex::new(Vec::<Child>::new()));
    let thread_frames = frames.clone();
    let thread_stop = stop.clone();
    let thread_children = children.clone();
    let backend = Arc::new(AtomicU64::new(0));
    let thread_backend = backend.clone();
    let fallback_reason = Arc::new(Mutex::new(String::new()));
    let thread_fallback = fallback_reason.clone();
    let source_metadata = Arc::new(NativeVideoSourceMetadata::default());
    let thread_source_metadata = source_metadata.clone();
    let memory_lease = memory_budget.lease();
    let thread_memory_lease = memory_lease.clone();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let hardware_control = Arc::new(Mutex::new(HardwareStreamControl { cache_start: start_time_seconds, ..Default::default() }));
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let thread_control = hardware_control.clone();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let thread_capacity = effective_capacity.clone();
    thread::spawn(move || {
        let backend_policy = std::env::var("GA_NATIVE_VIDEO_BACKEND").unwrap_or_else(|_| "auto".into());
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if backend_policy != "software" {
            #[cfg(target_os = "macos")]
            let opened = crate::hardware_video::HardwareVideoDecoder::open(&path);
            #[cfg(target_os = "windows")]
            let opened = video_device.and_then(|device| {
                let mut decoder = crate::hardware_video::HardwareVideoDecoder::open_with_device(&path, &device)?;
                // Require real decoder output before reporting hardware. Admit the
                // bounded probe before it allocates its first GPU bridge surface.
                let metadata = decoder.metadata();
                let probe = (metadata.width as u64).saturating_mul(metadata.height as u64)
                    .saturating_mul(12).saturating_add(65_536).saturating_mul(2);
                if !wait_for_video_memory(&thread_memory_lease, probe, &thread_stop) {
                    return Err("Hardware video preparation cancelled".to_string());
                }
                decoder.set_queue_capacity(2)?;
                decoder.prime_hardware()?;
                Ok(decoder)
            });
            match opened {
                Ok(decoder) => {
                    thread_output_fps.store(1_000_000.0f64.to_bits(), Ordering::Release);
                    if let Err(error) = run_hardware_stream(decoder, start_time_seconds, playback_rate,
                        loop_enabled, duration_seconds, trim_start, trim_end, capacity,
                        &thread_frames, &thread_stop, &thread_wake, &thread_control,
                        &thread_memory_lease, &thread_capacity, &thread_backend, &thread_source_metadata) {
                        thread_backend.store(4, Ordering::Release);
                        if let Ok(mut reason) = thread_fallback.lock() { *reason = error.clone(); }
                        if let Ok(mut queue) = thread_frames.lock() { queue.push_back(Err(error)); }
                    }
                    return;
                }
                Err(error) => {
                    if let Ok(mut reason) = thread_fallback.lock() { *reason = error.clone(); }
                    if backend_policy == "hardware" {
                        thread_backend.store(4, Ordering::Release);
                        if let Ok(mut queue) = thread_frames.lock() { queue.push_back(Err(error)); }
                        return;
                    }
                    eprintln!("Native hardware video unavailable for {}: {error}; using software decoder", path.display());
                    thread_backend.store(3, Ordering::Release);
                }
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        if backend_policy == "hardware" {
            thread_backend.store(4, Ordering::Release);
            if let Ok(mut queue) = thread_frames.lock() { queue.push_back(Err("Hardware video backend is not implemented on this platform".into())); }
            return;
        }
        if thread_backend.load(Ordering::Acquire) == 0 { thread_backend.store(2, Ordering::Release); }
        if !wait_for_video_memory(&thread_memory_lease, (frame_bytes * (capacity + 2)) as u64, &thread_stop) {
            return;
        }

        let target_width = width.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
        let target_height = height.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
        let frame_bytes = target_width.saturating_mul(target_height).saturating_mul(4);
        let rate = playback_rate.clamp(0.01, 16.0);
        // ffmpeg converts to the clip's own frame rate times the playback
        // rate, capped at 60, and reports the rate it chose on stderr; the
        // stderr reader passes it to the consumer's clock. Asking ffmpeg
        // avoids launching a second process just to read the frame rate,
        // and launches are what is slow (the first run of an unsigned ffmpeg
        // was taking over a second while macOS assessed it).
        let range_start = duration_seconds
            .map(|duration| duration * trim_start.clamp(0.0, 1.0))
            .unwrap_or(0.0);
        let range_end = duration_seconds.map(|duration| duration * trim_end.clamp(trim_start, 1.0));
        let trimmed = range_start > 1e-3
            || range_end
                .zip(duration_seconds)
                .is_some_and(|(end, duration)| end < duration - 1e-3);
        // An untrimmed loop is one decoder that loops the file itself
        // (-stream_loop), which is seamless. Restarting ffmpeg for every pass
        // was not: each pass hung on the next process starting, which took
        // anywhere from 40 ms to over a second, then skipped ahead to catch up.
        let continuous_loop = loop_enabled && !trimmed;
        let mut segment_start = start_time_seconds.max(range_start).clamp(0.0, 3600.0);

        let t_origin = Instant::now();
        let spawn_segment = |seg_start: f64| -> Result<(u32, ChildStdout), String> {
            if video_debug() {
                eprintln!(
                    "[VIDEO_DEBUG] {:.3}s spawn {} at {seg_start:.3}",
                    t_origin.elapsed().as_secs_f64(),
                    if continuous_loop { "looping decoder" } else { "segment" }
                );
            }
            let ffmpeg = ffmpeg_binary();
            let scale = format!(
                "scale={target_width}:{target_height}:force_original_aspect_ratio=decrease"
            );
            let pad = format!("pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black");
            // Rate change, then frame-rate conversion, then scaling, so frames
            // the rate change drops are never scaled.
            let filter = format!(
                "setpts=PTS/{rate:.6},fps=fps='min(source_fps*{rate:.6}\\,{NATIVE_VIDEO_MAX_OUTPUT_FPS})',{scale},{pad},format=rgba"
            );
            let mut command = Command::new(&ffmpeg);
            // Info level for the output stream summary, which carries the
            // frame rate; -nostats keeps the progress line out of it.
            command
                .arg("-hide_banner")
                .arg("-loglevel")
                .arg("info")
                .arg("-nostats")
                .arg("-nostdin")
                // Streams already run in parallel. Per-process automatic
                // CPU-sized filter/codec pools oversubscribe a multi-layer
                // show and buffer extra frames before the first RGBA output.
                .arg("-filter_threads")
                .arg("1")
                .arg("-threads")
                .arg("2");
            if continuous_loop {
                command.arg("-stream_loop").arg("-1");
            }
            command.arg("-ss").arg(format!("{seg_start:.6}"));
            // An input-side limit bounds the source range, whatever the rate.
            if !continuous_loop && let Some(end) = range_end {
                command
                    .arg("-t")
                    .arg(format!("{:.6}", (end - seg_start).max(0.001)));
            }
            let mut child = command
                .arg("-i")
                .arg(&path)
                .arg("-an")
                .arg("-sn")
                .arg("-dn")
                .arg("-vf")
                .arg(filter)
                // Raw RGBA output needs no frame-threaded encoder queue.
                .arg("-threads")
                .arg("1")
                .arg("-f")
                .arg("rawvideo")
                .arg("-pix_fmt")
                .arg("rgba")
                .arg("pipe:1")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|err| {
                    format!(
                        "native video stream failed to launch `{ffmpeg}` for `{}`: {err}",
                        path.display()
                    )
                })?;
            let stdout = child.stdout.take().ok_or_else(|| {
                let _ = child.kill();
                format!(
                    "native video stream child had no stdout for `{}`",
                    path.display()
                )
            })?;
            // Drain stderr on a helper thread. ffmpeg blocks mid-stream once an
            // unread stderr pipe fills, which starves the frame ring after a
            // handful of frames and cascades into pre-roll never completing —
            // the observed "armed sessions stuck at buffered=0". Draining is
            // load-bearing; surfacing the text is diagnostics.
            if let Some(stderr) = child.stderr.take() {
                let stderr_pid = child.id();
                let output_fps = Arc::clone(&thread_output_fps);
                let source_metadata = Arc::clone(&thread_source_metadata);
                thread::spawn(move || {
                    let mut in_output_section = false;
                    let mut reported_fps = false;
                    let mut problems = Vec::new();
                    for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
                        if line.starts_with("Output #0") {
                            in_output_section = true;
                        } else if !in_output_section {
                            if let Some(fps) = parse_video_fps(&line) {
                                source_metadata.fps.store(fps.to_bits(), Ordering::Release);
                            }
                            if let Some(duration) = parse_video_duration(&line) {
                                source_metadata.duration.store(duration.to_bits(), Ordering::Release);
                            }
                        } else if in_output_section
                            && !reported_fps
                            && let Some(fps) = parse_video_fps(&line)
                        {
                            output_fps.store(fps.to_bits(), Ordering::Release);
                            reported_fps = true;
                            if video_debug() {
                                eprintln!("[VIDEO_DEBUG] pid {stderr_pid} outputs {fps:.3} fps");
                            }
                        }
                        let lower = line.to_ascii_lowercase();
                        if (lower.contains("error") || lower.contains("invalid") || lower.contains("failed"))
                            && problems.len() < 20
                        {
                            problems.push(line);
                        }
                    }
                    if !problems.is_empty() {
                        eprintln!("[native-video] ffmpeg stderr (pid {stderr_pid}): {}", problems.join(" | "));
                    }
                });
            }
            let pid = child.id();
            // Register in the shared table so stop() can kill it immediately
            // even while this thread is blocked reading the pipe.
            if let Ok(mut guard) = thread_children.lock() {
                guard.push(child);
            }
            Ok((pid, stdout))
        };
        let reap = |pid: u32| {
            if let Ok(mut guard) = thread_children.lock()
                && let Some(index) = guard.iter().position(|child| child.id() == pid)
            {
                let mut child = guard.swap_remove(index);
                let _ = child.kill();
                let _ = child.wait();
            }
        };

        // A trimmed loop still restarts ffmpeg each pass: -stream_loop always
        // seeks back to the start of the file, so it cannot loop a sub-range
        // without decoding everything outside it. The next pass's decoder is
        // started as soon as the current pass is running, giving it the whole
        // pass to seek and warm up rather than its last moments.
        let mut pending_standby: Option<(u32, ChildStdout)> = None;
        let mut presentation_frame = 0u64;
        'stream: loop {
            if thread_stop.load(Ordering::Acquire) {
                break;
            }
            let (pid, mut stdout) = match pending_standby.take() {
                Some(handoff) => handoff,
                None => match spawn_segment(segment_start) {
                    Ok(spawned) => spawned,
                    Err(err) => {
                        if let Ok(mut queue) = thread_frames.lock() {
                            queue.push_back(Err(err));
                        }
                        break;
                    }
                },
            };
            let mut emitted_frames = 0u64;
            let mut dropped_in_segment = 0u64;
            let segment_opened = Instant::now();
            loop {
                if thread_stop.load(Ordering::Acquire) {
                    reap(pid);
                    break 'stream;
                }
                let mut rgba = thread_free
                    .lock()
                    .ok()
                    .and_then(|mut free| free.pop())
                    .unwrap_or_else(|| vec![0u8; frame_bytes]);
                if let Err(err) = stdout.read_exact(&mut rgba) {
                    if err.kind() != std::io::ErrorKind::UnexpectedEof {
                        if let Ok(mut queue) = thread_frames.lock() {
                            queue.push_back(Err(format!(
                                "native video stream read failed for `{}`: {err}",
                                path.display()
                            )));
                        }
                    }
                    if video_debug() {
                        eprintln!(
                            "[VIDEO_DEBUG] {:.3}s end of pid {pid} after {emitted_frames} frames ({dropped_in_segment} dropped)",
                            t_origin.elapsed().as_secs_f64()
                        );
                    }
                    break;
                }
                if emitted_frames == 0 {
                    if video_debug() {
                        eprintln!(
                            "[VIDEO_DEBUG] {:.3}s first frame from pid {pid} after {:.1} ms, frame {presentation_frame}, wanted {}",
                            t_origin.elapsed().as_secs_f64(),
                            segment_opened.elapsed().as_secs_f64() * 1000.0,
                            thread_wanted.load(Ordering::Acquire)
                        );
                    }
                    if loop_enabled
                        && !continuous_loop
                        && pending_standby.is_none()
                        && let Ok(spawned) = spawn_segment(range_start)
                    {
                        pending_standby = Some(spawned);
                    }
                }
                emitted_frames = emitted_frames.saturating_add(1);
                let current_frame = presentation_frame;
                presentation_frame = presentation_frame.saturating_add(1);
                if current_frame.saturating_add(1) < thread_wanted.load(Ordering::Acquire) {
                    dropped_in_segment += 1;
                    thread_dropped.fetch_add(1, Ordering::Relaxed);
                    if let Ok(mut free) = thread_free.lock() {
                        if free.len() < 2 {
                            free.push(rgba);
                        }
                    }
                    continue;
                }

                // Decode ahead into a bounded ring. Presentation cadence is
                // owned by the native render clock, so producer/consumer phase
                // jitter cannot empty a healthy stream.
                loop {
                    if thread_stop.load(Ordering::Acquire) {
                        reap(pid);
                        break 'stream;
                    }
                    if let Ok(mut queue) = thread_frames.lock() {
                        if queue.len() < capacity {
                            queue.push_back(Ok(NativeVideoStreamFrame {
                                memory_lease: None,
                                presentation_frame: current_frame,
                                source_time_seconds: {
                                    let fps = f64::from_bits(thread_output_fps.load(Ordering::Acquire));
                                    let time = segment_start + (emitted_frames - 1) as f64 * rate / fps;
                                    let duration = optional_video_number(&thread_source_metadata.duration);
                                    Some(if continuous_loop {
                                        duration.filter(|duration| *duration > 0.0).map_or(time, |duration| time.rem_euclid(duration))
                                    } else { time })
                                },
                                source_frame_duration_seconds: optional_video_number(&thread_source_metadata.fps)
                                    .filter(|fps| *fps > 0.0).map(|fps| 1.0 / fps),
                                #[cfg(any(target_os = "macos", target_os = "windows"))]
                                gpu: None,
                                width: target_width,
                                height: target_height,
                                rgba,
                            }));
                            break;
                        }
                        let _ = thread_wake.wait_timeout(queue, Duration::from_millis(100));
                    }
                }
            }
            reap(pid);
            if !loop_enabled {
                break;
            }
            // A looping decoder only ends on an error; start it over.
            segment_start = range_start;
        }
        // Final sweep: kill and reap anything still registered (including an
        // unused standby) so no decoder outlives the stream.
        if let Ok(mut guard) = thread_children.lock() {
            for mut child in guard.drain(..) {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
    NativeVideoStream {
        frames,
        stop,
        playing,
        play_state_changes: AtomicU64::new(0),
        children,
        wake,
        clock: Mutex::new(None),
        next_frame: AtomicU64::new(0),
        wanted_frame,
        dropped_frames,
        output_fps,
        awaiting_first_frame: AtomicBool::new(true),
        capacity: effective_capacity,
        frame_bytes,
        playback_rate: playback_rate.clamp(0.01, 16.0),
        free_frames,
        backend, fallback_reason, memory_lease, source_metadata,
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        hardware_control,
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn run_hardware_stream(
    mut decoder: crate::hardware_video::HardwareVideoDecoder,
    start: f64, playback_rate: f64, loop_enabled: bool, _duration: Option<f64>,
    trim_start: f64, trim_end: f64, capacity: usize,
    frames: &Arc<Mutex<VecDeque<Result<NativeVideoStreamFrame, String>>>>,
    stop: &AtomicBool, wake: &Condvar, control: &Mutex<HardwareStreamControl>,
    memory_lease: &Arc<NativeVideoMemoryLease>,
    effective_capacity: &AtomicUsize,
    backend: &AtomicU64,
    source_metadata: &NativeVideoSourceMetadata,
) -> Result<(), String> {
    let metadata = decoder.metadata();
    if !metadata.hardware { return Err("Native decoder did not activate hardware decoding".into()); }
    source_metadata.fps.store(metadata.fps.to_bits(), Ordering::Release);
    source_metadata.duration.store(metadata.duration_seconds.to_bits(), Ordering::Release);
    // Hardware metadata is authoritative: stale UI duration (or a longer
    // audio track) must not add a frozen gap to every video loop/trim.
    let duration = metadata.duration_seconds;
    let range_start = duration * trim_start.clamp(0.0, 1.0);
    let range_end = duration * trim_end.clamp(trim_start, 1.0);
    let rate = playback_rate.clamp(0.01, 16.0);
    let mut segment_start = start.max(range_start).min(range_end);
    let mut timeline_origin = 0.0;
    let mut skip_before = segment_start;
    let mut generation = 0;
    let mut ended = false;
    let mut segment_frames = 0usize;
    let mut selected_frame = None;
    // This follows the decoder's logical cursor even when a superseded
    // generation discards its returned picture. Continuing is safe only after
    // that frame's end; a target inside it still needs a cache hit or a seek.
    let mut decoder_cursor_end = None;
    // Reserve a bounded format-probe batch before decoding. The native output
    // can be NV12 (1.5 bytes/pixel) or P010 (3); Windows also owns the
    // RGB bridge described below. Actual allocation replaces this estimate. Padding is
    // unknowable before the first output, so only this bounded probe may have
    // a small allocation-size discrepancy; no unadmitted frame is published.
    // Windows also owns an RGB bridge surface. Budget a float target plus
    // the native input until the driver reports its allocation requirements.
    let probe_bytes_per_pixel = if cfg!(target_os = "windows") { 12 } else { 3 };
    let probe_surface_bytes = (metadata.width as u64).saturating_mul(metadata.height as u64).saturating_mul(probe_bytes_per_pixel);
    let mut decoder_capacity = if cfg!(target_os = "windows") { 2 } else { 8 };
    if !memory_lease.try_resize(probe_surface_bytes.saturating_mul(decoder_capacity as u64)) {
        decoder_capacity = decoder_capacity.min(4);
        while !memory_lease.try_resize(probe_surface_bytes.saturating_mul(decoder_capacity as u64)) {
            if stop.load(Ordering::Acquire) { return Ok(()); }
            thread::sleep(Duration::from_millis(25));
        }
    }
    decoder.set_queue_capacity(decoder_capacity)?;
    let requested_capacity = capacity;
    let mut capacity = capacity;
    let mut accounted_surface_bytes = 0u64;
    let mut last_history_growth_generation = None;
    if segment_start < range_end {
        decoder.seek(segment_start, Some(range_end))?;
    } else {
        ended = true;
    }
    while !stop.load(Ordering::Acquire) {
        if accounted_surface_bytes > 0 {
            let mut queue = frames.lock().map_err(|_| "Video queue lock poisoned")?;
            let mut state = control.lock().map_err(|_| "Video control lock poisoned")?;
            let minimum = capacity.min(4);
            let retained_ring = capacity.max(queue.len());
            if !state.scrub_history || !memory_lease.budget.optional_cache_allowed.load(Ordering::Acquire) {
                last_history_growth_generation = Some(state.generation);
                state.history_capacity = minimum;
                if state.opening.len() > minimum {
                    let excess = state.opening.len() - minimum;
                    state.opening.drain(..excess);
                }
                drop(state);
                drop(queue);
                if memory_lease.optional_bytes.load(Ordering::Acquire) > 0 {
                    // Surviving ring, decoder, and renderer references fit the
                    // base reservation (including both GPU submissions). Free
                    // unreferenced driver pool slots before releasing its charge.
                    decoder.release_unused_gpu_surfaces()?;
                    let base = accounted_surface_bytes.saturating_mul((retained_ring + minimum + decoder_capacity + 2) as u64);
                    memory_lease.try_resize(base);
                    memory_lease.optional_bytes.store(0, Ordering::Release);
                }
            } else {
                if queue.len() <= capacity && last_history_growth_generation != Some(state.generation) {
                    last_history_growth_generation = Some(state.generation);
                    let admitted = reserve_scrub_history(memory_lease, accounted_surface_bytes, capacity, decoder_capacity);
                    if admitted > state.history_capacity {
                        for frame in queue.iter_mut().filter_map(|frame| frame.as_mut().ok()) {
                            remember_scrub_frame(&mut state.opening, frame, admitted);
                        }
                    }
                    state.history_capacity = admitted;
                }
            }
        }
        let reset = {
            let mut state = control.lock().map_err(|_| "Video control lock poisoned")?;
            state.reset.take().map(|request| (state.generation, request))
        };
        if let Some((next_generation, request)) = reset {
            generation = next_generation;
            timeline_origin = 0.0;
            segment_frames = 0;
            ended = false;
            selected_frame = None;
            match request {
                HardwareStreamReset::Step { reference, direction } => {
                    decoder_cursor_end = None;
                    selected_frame = decoder.step_frame(reference, direction, range_start, range_end)?;
                    if let Some(selected) = &selected_frame {
                        segment_start = selected.pts_seconds;
                        skip_before = segment_start;
                        let mut state = control.lock().map_err(|_| "Video control lock poisoned")?;
                        if state.generation != generation { continue; }
                        state.cache_start = segment_start;
                    } else {
                        return Err("Native video trim contains no frame to step to".into());
                    }
                }
                HardwareStreamReset::Seek { start: requested, resume } => {
                    segment_start = requested.max(range_start).min(range_end);
                    skip_before = resume.max(segment_start).min(range_end);
                    if skip_before >= range_end {
                        // A short clip may fit entirely in the retained opening.
                        // Continue after that replay without seeking (end, end).
                        if loop_enabled && range_start < range_end {
                            timeline_origin = (range_end - segment_start).max(0.0) / rate;
                            segment_start = range_start;
                            skip_before = range_start;
                            decoder_cursor_end = None;
                            decoder.seek(range_start, Some(range_end))?;
                        } else {
                            ended = true;
                        }
                    } else if can_continue_video_forward(decoder_cursor_end, skip_before) {
                        let mut state = control.lock().map_err(|_| "Video control lock poisoned")?;
                        state.forward_continuations = state.forward_continuations.saturating_add(1);
                    } else {
                        decoder_cursor_end = None;
                        decoder.seek(skip_before, Some(range_end))?;
                    }
                }
            }
        }
        {
            let queue = frames.lock().map_err(|_| "Video queue lock poisoned")?;
            if queue.len() >= capacity || ended {
                let _ = wake.wait_timeout(queue, Duration::from_millis(25));
                continue;
            }
        }
        let decoded = match selected_frame.take() {
            Some(selected) => Some(selected),
            None => decoder.next_frame()?,
        };
        decoder_cursor_end = decoded.as_ref().map(|frame| frame.pts_seconds
            + if frame.duration_seconds > 0.0 { frame.duration_seconds } else { 1.0 / metadata.fps.max(1.0) });
        // A trigger can arrive while the worker is in the decoder. Never put
        // a surface from the previous playback generation into its new queue.
        if control.lock().map_err(|_| "Video control lock poisoned")?.generation != generation { continue; }
        let Some(gpu) = decoded else {
            if !loop_enabled {
                // A finite clip shorter than the normal warm-up ring is still
                // completely prepared once its actual frames have reached EOF.
                effective_capacity.fetch_min(segment_frames.saturating_add(1).max(2), Ordering::AcqRel);
                ended = true;
                continue;
            }
            if segment_frames == 0 && skip_before <= segment_start {
                return Err("Hardware video trim contains no decodable frames".into());
            }
            timeline_origin += (range_end - segment_start).max(0.0) / rate;
            segment_start = range_start;
            skip_before = range_start;
            segment_frames = 0;
            {
                let mut queue = frames.lock().map_err(|_| "Video queue lock poisoned")?;
                let state = control.lock().map_err(|_| "Video control lock poisoned")?;
                if state.generation != generation { continue; }
                if !state.scrub_history && (state.cache_start - range_start).abs() < 0.0001 {
                    // The next loop can already be on the render queue while
                    // the persistent decoder repositions. These are shared
                    // opening surfaces, already charged to the cache budget;
                    // extending the queue here allocates no additional pixels.
                    for opening in &state.opening {
                        let mut replay = opening.clone();
                        replay.presentation_frame = replay.presentation_frame.saturating_add(
                            (timeline_origin * 1_000_000.0).round().max(0.0) as u64);
                        if let Some(gpu) = &replay.gpu {
                            skip_before = skip_before.max(gpu.pts_seconds + gpu.duration_seconds);
                        }
                        queue.push_back(Ok(replay));
                        segment_frames += 1;
                    }
                }
            }
            // Very short loops may live entirely in the opening cache. Wait
            // for the queued picture(s) before another pass, with no seek at all.
            if skip_before < range_end {
                decoder_cursor_end = None;
                decoder.seek(skip_before, Some(range_end))?;
            }
            continue;
        };
        // Platform allocation includes bit depth, bridge storage and padding. Never publish a GPU frame before admission has succeeded.
        let surface_bytes = crate::hardware_video::allocation_bytes(&gpu)?;
        if surface_bytes == 0 { return Err("Hardware video frame has an empty allocation".into()); }
        if surface_bytes > accounted_surface_bytes {
            {
                let mut state = control.lock().map_err(|_| "Video control lock poisoned")?;
                // A larger surface must never wait for an optional history
                // that this same worker owns. Release it before mandatory
                // admission; a subsequent scrub can reserve at the new size.
                state.history_capacity = 0;
                state.opening.clear();
            }
            decoder.release_unused_gpu_surfaces()?;
            memory_lease.optional_bytes.store(0, Ordering::Release);
            last_history_growth_generation = None;
            loop {
                let mut admitted = None;
                // Once frames exist, retain the admitted ring size across a
                // larger allocation. Reducing its charge while old queued or
                // cache-replayed frames remain would undercount those owners.
                let smallest_ring = if accounted_surface_bytes > 0 { capacity } else { 2 };
                for ring in (smallest_ring..=requested_capacity.min(capacity)).rev() {
                    // Native pending surfaces include submissions in flight. The
                    // opening cache shares frames while they remain in the ring,
                    // but reserves independent storage once playback advances.
                    let queued = frames.lock().map_err(|_| "Video queue lock poisoned")?.len();
                    let retained_surfaces = ring.max(queued) + ring.min(4) + decoder_capacity + 2;
                    if memory_lease.try_resize(surface_bytes.saturating_mul(retained_surfaces as u64)) {
                        admitted = Some(ring);
                        break;
                    }
                }
                if let Some(ring) = admitted { capacity = ring; break; }
                // Keep the same decoder while the app reclaims unused library
                // preroll. A live source never needs repeated open/seek storms
                // just because its real native surfaces need a larger budget.
                if stop.load(Ordering::Acquire) { return Ok(()); }
                thread::sleep(Duration::from_millis(25));
            }
            accounted_surface_bytes = surface_bytes;
            {
                let mut state = control.lock().map_err(|_| "Video control lock poisoned")?;
                state.history_capacity = state.history_capacity.max(capacity.min(4));
            }
            memory_lease.optional_bytes.store(0, Ordering::Release);
            effective_capacity.store(capacity, Ordering::Release);
            backend.store(1, Ordering::Release);
        }
        let frame_duration = if gpu.duration_seconds > 0.0 { gpu.duration_seconds } else { 1.0 / metadata.fps.max(1.0) };
        if gpu.pts_seconds >= range_end { continue; }
        let before_target = gpu.pts_seconds + frame_duration <= skip_before + VIDEO_TIMESTAMP_EPSILON;
        let pts = timeline_origin + (gpu.pts_seconds - segment_start).max(0.0) / rate;
        let frame = NativeVideoStreamFrame {
            memory_lease: Some(memory_lease.clone()),
            presentation_frame: (pts * 1_000_000.0).round().max(0.0) as u64,
            source_time_seconds: Some(gpu.pts_seconds),
            source_frame_duration_seconds: Some(frame_duration),
            width: gpu.width as usize, height: gpu.height as usize,
            rgba: Vec::new(), gpu: Some(gpu),
        };
        // Lock ordering matches retrigger(): queue before control. This makes
        // generation validation and insertion one atomic handoff.
        let mut queue = frames.lock().map_err(|_| "Video queue lock poisoned")?;
        let mut state = control.lock().map_err(|_| "Video control lock poisoned")?;
        if state.generation != generation { continue; }
        if state.scrub_history {
            let limit = state.history_capacity.max(capacity.min(4));
            remember_scrub_frame(&mut state.opening, &frame, limit);
        }
        if before_target { continue; }
        if !state.scrub_history && timeline_origin == 0.0 && state.opening.len() < capacity.min(4)
            && (state.cache_start - segment_start).abs() < 0.0001 {
            // Resume after a cached head must not append the same opening again.
            if state.opening.last().is_none_or(|last| last.presentation_frame < frame.presentation_frame) {
                state.opening.push(frame.clone());
            }
        }
        queue.push_back(Ok(frame));
        segment_frames += 1;
    }
    Ok(())
}

pub fn decode_native_image_rgba(path: &Path) -> Result<(usize, usize, Vec<u8>), String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native image decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native image decode rejected non-file path `{}`",
            path.display()
        ));
    }
    if metadata.len() > MAX_NATIVE_IMAGE_DECODE_BYTES {
        return Err(format!(
            "native image decode rejected `{}`: file is {} MB, cap is {} MB",
            path.display(),
            metadata.len() / (1024 * 1024),
            MAX_NATIVE_IMAGE_DECODE_BYTES / (1024 * 1024)
        ));
    }
    let (width, height) = image::image_dimensions(path).map_err(|err| {
        format!(
            "native image decode could not read dimensions for `{}`: {err}",
            path.display()
        )
    })?;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if width == 0 || height == 0 || pixels > MAX_NATIVE_IMAGE_DECODE_PIXELS {
        return Err(format!(
            "native image decode rejected `{}`: dimensions {}x{} exceed {} pixels",
            path.display(),
            width,
            height,
            MAX_NATIVE_IMAGE_DECODE_PIXELS
        ));
    }
    let image = image::ImageReader::open(path)
        .map_err(|err| {
            format!(
                "native image decode failed to open `{}`: {err}",
                path.display()
            )
        })?
        .with_guessed_format()
        .map_err(|err| {
            format!(
                "native image decode failed to sniff `{}`: {err}",
                path.display()
            )
        })?
        .decode()
        .map_err(|err| format!("native image decode failed for `{}`: {err}", path.display()))?
        .to_rgba8();
    Ok((
        image.width() as usize,
        image.height() as usize,
        image.into_raw(),
    ))
}

pub fn decode_native_video_frame_rgba(
    path: &Path,
    width: usize,
    height: usize,
    time_seconds: f64,
) -> Result<(usize, usize, Vec<u8>), String> {
    decode_native_video_frame_rgba_with_seek(path, width, height, time_seconds, false)
}

pub fn decode_native_video_frame_exact_rgba(
    path: &Path,
    width: usize,
    height: usize,
    time_seconds: f64,
) -> Result<(usize, usize, Vec<u8>), String> {
    decode_native_video_frame_rgba_with_seek(path, width, height, time_seconds, true)
}

fn decode_native_video_frame_rgba_with_seek(
    path: &Path,
    width: usize,
    height: usize,
    time_seconds: f64,
    accurate_seek: bool,
) -> Result<(usize, usize, Vec<u8>), String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let target_width = width.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let target_height = height.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let expected_bytes = target_width.saturating_mul(target_height).saturating_mul(4);
    let ffmpeg = ffmpeg_binary();
    let scale =
        format!("scale={target_width}:{target_height}:force_original_aspect_ratio=decrease");
    let pad = format!("pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black");
    let mut command = Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin");
    let seek_time = format!("{:.6}", time_seconds.clamp(0.0, 3600.0));
    if accurate_seek {
        command.arg("-i").arg(path).arg("-ss").arg(seek_time);
    } else {
        command.arg("-ss").arg(seek_time).arg("-i").arg(path);
    }
    let output = bounded_output(
        command
            .arg("-frames:v")
            .arg("1")
            .arg("-vf")
            .arg(format!("{scale},{pad},format=rgba"))
            .arg("-f")
            .arg("rawvideo")
            .arg("-pix_fmt")
            .arg("rgba")
            .arg("pipe:1"),
        expected_bytes,
    )
    .map_err(|err| {
        format!(
            "native video frame decode failed to launch `{ffmpeg}` for `{}`: {err}",
            path.display()
        )
    })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame decode ffmpeg failed for `{}`: {}",
            path.display(),
            if detail.is_empty() {
                output.status.to_string()
            } else {
                detail
            }
        ));
    }
    if output.stdout.len() < expected_bytes {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame decode produced {}/{} bytes for `{}`{}",
            output.stdout.len(),
            expected_bytes,
            path.display(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }
    let mut rgba = output.stdout;
    rgba.truncate(expected_bytes);
    Ok((target_width, target_height, rgba))
}

pub fn decode_native_video_frame_window_rgba(
    path: &Path,
    width: usize,
    height: usize,
    time_seconds: f64,
    fps: f64,
    frame_count: u32,
) -> Result<Vec<NativeVideoFrameDecodeOutput>, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame window decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame window decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let target_width = width.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let target_height = height.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let expected_bytes = target_width.saturating_mul(target_height).saturating_mul(4);
    let count = frame_count
        .max(1)
        .min(NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES.saturating_add(1));
    let sample_fps = fps.clamp(
        NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS,
        NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS,
    );
    let ffmpeg = ffmpeg_binary();
    let scale =
        format!("scale={target_width}:{target_height}:force_original_aspect_ratio=decrease");
    let pad = format!("pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black");
    let output = bounded_output(
        Command::new(&ffmpeg)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin")
            .arg("-ss")
            .arg(format!("{:.3}", time_seconds.clamp(0.0, 3600.0)))
            .arg("-i")
            .arg(path)
            .arg("-frames:v")
            .arg(count.to_string())
            .arg("-vf")
            .arg(format!("{scale},{pad},fps={sample_fps:.3},format=rgba"))
            .arg("-f")
            .arg("rawvideo")
            .arg("-pix_fmt")
            .arg("rgba")
            .arg("pipe:1"),
        expected_bytes.saturating_mul(count as usize),
    )
    .map_err(|err| {
        format!(
            "native video frame window decode failed to launch `{ffmpeg}` for `{}`: {err}",
            path.display()
        )
    })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame window decode ffmpeg failed for `{}`: {}",
            path.display(),
            if detail.is_empty() {
                output.status.to_string()
            } else {
                detail
            }
        ));
    }
    let decoded_count = output.stdout.len() / expected_bytes;
    if decoded_count == 0 {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame window decode produced {}/{} bytes for `{}`{}",
            output.stdout.len(),
            expected_bytes,
            path.display(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }
    let frame_step = 1.0 / sample_fps;
    let mut frames = Vec::with_capacity(decoded_count.min(count as usize));
    for frame_index in 0..decoded_count.min(count as usize) {
        let start = frame_index.saturating_mul(expected_bytes);
        let end = start.saturating_add(expected_bytes);
        let frame_time = (time_seconds + frame_step * frame_index as f64).clamp(0.0, 3600.0);
        let frame_bucket = native_video_frame_bucket(frame_time);
        let signature =
            native_video_frame_file_signature(path, target_width, target_height, frame_bucket)?;
        frames.push(NativeVideoFrameDecodeOutput {
            width: target_width,
            height: target_height,
            frame_bucket,
            signature,
            rgba: output.stdout[start..end].to_vec(),
        });
    }
    if frames.is_empty() {
        return Err(format!(
            "native video frame window decode produced no usable frames for `{}`",
            path.display()
        ));
    }
    Ok(frames)
}

pub fn native_video_frame_bucket(time_seconds: f64) -> u64 {
    (time_seconds * NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS)
        .round()
        .max(0.0) as u64
}

pub fn native_image_file_signature(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native image decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native image decode rejected non-file path `{}`",
            path.display()
        ));
    }
    Ok(file_signature(path, &metadata))
}

pub fn native_video_frame_file_signature(
    path: &Path,
    width: usize,
    height: usize,
    frame_bucket: u64,
) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let base = file_signature(path, &metadata);
    Ok(format!("{base}:{width}:{height}:{frame_bucket}"))
}

pub fn local_media_path_from_uri(uri: &str) -> Option<PathBuf> {
    let trimmed = uri.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("blob:")
        || trimmed.starts_with("data:")
    {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("ghost-asset://") {
        return local_path_from_hierarchical_uri_rest(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("file://") {
        return local_path_from_hierarchical_uri_rest(rest);
    }
    absolute_path_from_uri_path(trimmed)
}

fn ffmpeg_binary() -> String {
    std::env::var("GA_FFMPEG_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "ffmpeg.exe".to_string()
            } else {
                "ffmpeg".to_string()
            }
        })
}

fn file_signature(path: &Path, metadata: &fs::Metadata) -> String {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| format!("{}:{}", duration.as_secs(), duration.subsec_nanos()))
        .unwrap_or_else(|| "unknown".to_string());
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    format!("{}:{}:{}", canonical.display(), metadata.len(), modified)
}

fn local_path_from_hierarchical_uri_rest(rest: &str) -> Option<PathBuf> {
    let path_part = if rest.starts_with('/') {
        rest
    } else {
        let slash = rest.find('/')?;
        &rest[slash..]
    };
    absolute_path_from_uri_path(path_part)
}

fn absolute_path_from_uri_path(path: &str) -> Option<PathBuf> {
    let decoded = percent_decode_uri_path(path)?;
    let normalized = if decoded.starts_with('/') && windows_drive_path(&decoded[1..]) {
        decoded[1..].to_string()
    } else {
        decoded
    };
    let path = PathBuf::from(&normalized);
    if path.is_absolute() || windows_drive_path(&normalized) {
        Some(path)
    } else {
        None
    }
}

fn percent_decode_uri_path(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hi = *bytes.get(index + 1)?;
            let lo = *bytes.get(index + 2)?;
            out.push(
                hex_value(hi)?
                    .saturating_mul(16)
                    .saturating_add(hex_value(lo)?),
            );
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
        && bytes[0].is_ascii_alphabetic()
}

// Keep diagnostics useful without retaining a process's entire error history.
fn read_tail(reader: &mut impl Read, cap: usize) -> Vec<u8> {
    let mut tail = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let Ok(n) = reader.read(&mut chunk) else {
            break;
        };
        if n == 0 {
            break;
        }
        tail.extend_from_slice(&chunk[..n]);
        if tail.len() > cap {
            tail.drain(..tail.len() - cap);
        }
    }
    tail
}

fn bounded_output(command: &mut Command, expected: usize) -> std::io::Result<std::process::Output> {
    if expected > 256 * 1024 * 1024 {
        return Err(std::io::Error::other(
            "decode output exceeds 256 MiB job budget",
        ));
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let out = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(expected as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let err = thread::spawn(move || read_tail(&mut stderr, 16 * 1024));
    let deadline = Instant::now() + Duration::from_secs(10);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(error) => break Err(error),
            _ if Instant::now() >= deadline => {
                break Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "video decode exceeded 10 seconds",
                ));
            }
            _ => thread::sleep(Duration::from_millis(5)),
        }
    };
    if status.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    let stdout = out
        .join()
        .map_err(|_| std::io::Error::other("decode stdout worker failed"))??;
    let stderr = err
        .join()
        .map_err(|_| std::io::Error::other("decode stderr worker failed"))?;
    Ok(std::process::Output {
        status: status?,
        stdout,
        stderr,
    })
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    fn test_stream() -> NativeVideoStream {
        let memory_lease = Arc::new(NativeVideoMemoryBudget::new(40)).lease();
        assert!(memory_lease.try_resize(40));
        NativeVideoStream {
            frames: Arc::new(Mutex::new(
                (0..8)
                    .map(|index| {
                        Ok(NativeVideoStreamFrame {
                            presentation_frame: index,
                            source_time_seconds: Some(index as f64 / 24.0),
                            source_frame_duration_seconds: Some(1.0 / 24.0),
                            memory_lease: None,
                            #[cfg(any(target_os = "macos", target_os = "windows"))]
                            gpu: None,
                            width: 1,
                            height: 1,
                            rgba: vec![index as u8; 4],
                        })
                    })
                    .collect(),
            )),
            stop: Arc::new(AtomicBool::new(false)),
            playing: Arc::new(AtomicBool::new(true)),
            play_state_changes: AtomicU64::new(0),
            children: Arc::new(Mutex::new(Vec::new())),
            wake: Arc::new(Condvar::new()),
            clock: Mutex::new(Some((Instant::now() - Duration::from_millis(500), 0))),
            next_frame: AtomicU64::new(0),
            wanted_frame: Arc::new(AtomicU64::new(0)),
            dropped_frames: Arc::new(AtomicU64::new(0)),
            output_fps: Arc::new(AtomicU64::new(60.0f64.to_bits())),
            awaiting_first_frame: AtomicBool::new(false),
            capacity: Arc::new(AtomicUsize::new(8)),
            frame_bytes: 4,
            playback_rate: 1.0,
            free_frames: Arc::new(Mutex::new(Vec::new())),
            backend: Arc::new(AtomicU64::new(2)),
            fallback_reason: Arc::new(Mutex::new(String::new())),
            source_metadata: Arc::new(NativeVideoSourceMetadata::default()),
            memory_lease,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            hardware_control: Arc::new(Mutex::new(HardwareStreamControl::default())),
        }
    }
    #[test]
    fn shared_memory_admission_is_atomic_across_decoder_workers() {
        let budget = Arc::new(NativeVideoMemoryBudget::new(100));
        let arrived = Arc::new(std::sync::Barrier::new(21));
        let release = Arc::new(std::sync::Barrier::new(21));
        let admitted = AtomicUsize::new(0);
        thread::scope(|scope| {
            for _ in 0..20 {
                let (budget, arrived, release) = (budget.clone(), arrived.clone(), release.clone());
                let admitted = &admitted;
                scope.spawn(move || {
                    let lease = budget.lease();
                    if lease.try_resize(10) { admitted.fetch_add(1, Ordering::AcqRel); }
                    arrived.wait();
                    release.wait();
                    drop(lease);
                });
            }
            arrived.wait();
            assert_eq!(admitted.load(Ordering::Acquire), 10);
            assert_eq!(budget.used.load(Ordering::Acquire), 100);
            release.wait();
        });
        assert_eq!(budget.used.load(Ordering::Acquire), 0);
    }

    #[test]
    fn memory_reservation_outlives_a_removed_stream_until_gpu_completion() {
        let budget = Arc::new(NativeVideoMemoryBudget::new(100));
        let lease = budget.lease();
        assert!(lease.try_resize(80));
        let submission = lease.begin_gpu_work();
        drop(lease);
        let replacement = budget.lease();
        assert!(!replacement.try_resize(30));
        drop(submission);
        assert!(replacement.try_resize(30));
        assert_eq!(budget.used.load(Ordering::Acquire), 30);
    }

    #[test]
    fn conversion_backpressure_preserves_the_queued_frame() {
        let stream = test_stream();
        let first = stream.memory_lease.begin_gpu_work();
        let second = stream.memory_lease.begin_gpu_work();
        assert!(stream.try_pop().is_none());
        assert_eq!(stream.buffered_frames(), 8);
        drop(first);
        assert!(stream.try_pop().is_some());
        drop(second);
    }

    #[test]
    fn failed_admission_never_counts_as_prerolled_pixels() {
        let stream = test_stream();
        let mut queue = stream.frames.lock().unwrap();
        queue.clear();
        queue.push_back(Err("no hardware decoder".into()));
        drop(queue);
        assert_eq!(stream.buffered_frames(), 0);
    }

    #[test]
    fn lowering_the_budget_preserves_existing_owners_and_blocks_growth() {
        let budget = Arc::new(NativeVideoMemoryBudget::new(100));
        let first = budget.lease();
        assert!(first.try_resize(80));
        budget.set_limit(50);
        let second = budget.lease();
        assert!(!second.try_resize(10));
        assert_eq!(first.bytes.load(Ordering::Acquire), 80);
        assert!(first.try_resize(40));
        assert!(second.try_resize(10));
    }

    #[test]
    fn replacement_admission_waits_for_a_retired_gpu_reservation() {
        let budget = Arc::new(NativeVideoMemoryBudget::new(100));
        let retired = budget.lease();
        assert!(retired.try_resize(80));
        let submission = retired.begin_gpu_work();
        drop(retired);
        let replacement = budget.lease();
        let stop = AtomicBool::new(false);
        let (admitted_tx, admitted_rx) = std::sync::mpsc::channel();
        thread::scope(|scope| {
            let replacement = &replacement;
            let stop = &stop;
            scope.spawn(move || {
                let admitted = wait_for_video_memory(replacement, 40, stop);
                admitted_tx.send(admitted).unwrap();
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            while replacement.requested_bytes.load(Ordering::Acquire) != 40 {
                assert!(Instant::now() < deadline, "replacement did not request admission");
                thread::yield_now();
            }
            assert!(matches!(admitted_rx.try_recv(), Err(std::sync::mpsc::TryRecvError::Empty)));
            assert_eq!(budget.used.load(Ordering::Acquire), 80);
            drop(submission);
            assert!(admitted_rx.recv_timeout(Duration::from_secs(2)).unwrap());
        });
        assert_eq!(budget.used.load(Ordering::Acquire), 40);
        assert_eq!(replacement.requested_bytes.load(Ordering::Acquire), 0);
    }

    #[test]
    fn waiting_admission_can_be_cancelled_without_claiming_memory() {
        let budget = Arc::new(NativeVideoMemoryBudget::new(10));
        let replacement = budget.lease();
        let stop = AtomicBool::new(true);
        assert!(!wait_for_video_memory(&replacement, 40, &stop));
        assert_eq!(budget.used.load(Ordering::Acquire), 0);
    }
    #[test]
    fn stalled_playback_discards_obsolete_frames() {
        let stream = test_stream();
        assert_eq!(stream.try_pop().unwrap().unwrap().presentation_frame, 7);
        assert_eq!(stream.dropped_frames(), 7);
        assert_eq!(stream.buffered_frames(), 0);
    }
    #[test]
    fn armed_playback_does_not_skip_preroll() {
        let stream = test_stream();
        stream.set_playing(false);
        assert_eq!(stream.try_pop().unwrap().unwrap().presentation_frame, 0);
        assert_eq!(stream.buffered_frames(), 7);
        assert_eq!(stream.dropped_frames(), 0);
        assert_eq!(stream.memory_bytes(), 40);
    }
    #[test]
    fn playback_starts_at_the_first_decoded_frame() {
        // Playback was requested 500 ms ago but nothing had decoded yet: the
        // first frame must be shown, not skipped past to where the clock went.
        let stream = test_stream();
        stream.awaiting_first_frame.store(true, Ordering::Release);
        assert_eq!(stream.try_pop().unwrap().unwrap().presentation_frame, 0);
        assert_eq!(stream.dropped_frames(), 0);
        assert_eq!(stream.buffered_frames(), 7);
    }
    #[test]
    fn nothing_decoded_yet_does_not_move_the_clock() {
        let stream = test_stream();
        stream.frames.lock().unwrap().clear();
        stream.awaiting_first_frame.store(true, Ordering::Release);
        assert!(stream.try_pop().is_none());
        assert_eq!(stream.wanted_frame.load(Ordering::Acquire), 0);
    }
    #[test]
    fn source_timing_is_unknown_until_decoded_and_presented() {
        let stream = test_stream();
        assert_eq!(stream.source_timing(), (None, None, None, None));
        stream.source_metadata.fps.store(24.0f64.to_bits(), Ordering::Release);
        stream.source_metadata.duration.store(9.5f64.to_bits(), Ordering::Release);
        stream.set_playing(false);
        let frame = stream.try_pop().unwrap().unwrap();
        // Dequeuing cannot claim that a failed GPU upload was displayed.
        assert_eq!(stream.source_timing(), (None, None, Some(24.0), Some(9.5)));
        stream.record_presented(frame.source_time_seconds, frame.source_frame_duration_seconds);
        assert_eq!(stream.source_timing(), (Some(0.0), Some(1.0 / 24.0), Some(24.0), Some(9.5)));
        assert_eq!(f64::from_bits(stream.output_fps.load(Ordering::Acquire)), 60.0);
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn exact_step_pauses_and_replaces_the_old_generation_queue() {
        let stream = test_stream();
        stream.backend.store(1, Ordering::Release);
        stream.record_presented(Some(0.417), Some(0.083));
        assert!(stream.step_frame(0.417, -1));
        assert!(!stream.playing.load(Ordering::Acquire));
        assert_eq!(stream.buffered_frames(), 0);
        assert_eq!(stream.source_timing().0, Some(0.417));
        let control = stream.hardware_control.lock().unwrap();
        assert_eq!(control.generation, 1);
        assert!(matches!(control.reset, Some(HardwareStreamReset::Step { reference, direction: -1 }) if reference == 0.417));
        drop(control);
        assert!(!stream.step_frame(0.417, 2));
    }
    #[test]
    fn source_duration_parsing_never_invents_unknown_metadata() {
        assert_eq!(parse_video_duration("  Duration: 01:02:03.45, start: 0.000000, bitrate: 500 kb/s"), Some(3723.45));
        assert_eq!(parse_video_duration("  Duration: N/A, start: 0.0"), None);
        assert_eq!(parse_video_duration("  Duration: 00:00:00.00, start: 0.0"), None);
    }
    fn timed_frame(pts: f64, duration: f64) -> NativeVideoStreamFrame {
        NativeVideoStreamFrame {
            presentation_frame: 0,
            source_time_seconds: Some(pts),
            source_frame_duration_seconds: Some(duration),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            gpu: None,
            memory_lease: None,
            width: 1, height: 1, rgba: vec![0; 4],
        }
    }
    #[test]
    fn scrub_cache_uses_vfr_containment_and_stops_at_missing_frames() {
        let frames = [timed_frame(0.0, 0.08), timed_frame(0.08, 0.12),
            timed_frame(0.20, 0.04), timed_frame(0.30, 0.10)];
        let suffix = cached_video_suffix(frames.iter(), 0.11, 2.0, 8);
        assert_eq!(suffix.iter().map(|frame| frame.source_time_seconds.unwrap()).collect::<Vec<_>>(), vec![0.08, 0.20]);
        assert_eq!(suffix[0].presentation_frame, 0);
        assert_eq!(suffix[1].presentation_frame, 45_000);
        assert_eq!(cached_video_suffix(frames.iter(), 0.08, 1.0, 8)[0].source_time_seconds, Some(0.08));
        assert_eq!(cached_video_suffix(frames.iter(), 0.08 - 2.0 * VIDEO_TIMESTAMP_EPSILON, 1.0, 8)[0].source_time_seconds, Some(0.0));
        assert_eq!(cached_video_suffix(frames.iter(), 0.08 - 0.5 * VIDEO_TIMESTAMP_EPSILON, 1.0, 8)[0].source_time_seconds, Some(0.08));
        assert!(cached_video_suffix(frames.iter(), 0.27, 1.0, 8).is_empty());
        assert!(cached_video_suffix(frames.iter(), 0.40, 1.0, 8).is_empty());
    }
    #[test]
    fn scrub_cache_preserves_source_trim_coordinates_at_slow_playback_rate() {
        let trim_frames = [timed_frame(1.0, 0.04), timed_frame(1.04, 0.04), timed_frame(1.08, 0.04)];
        let suffix = cached_video_suffix(trim_frames.iter(), 1.06, 0.5, 2);
        assert_eq!(suffix.len(), 2);
        assert_eq!(suffix[0].source_time_seconds, Some(1.04));
        assert_eq!(suffix[0].presentation_frame, 0);
        assert_eq!(suffix[1].source_time_seconds, Some(1.08));
        assert_eq!(suffix[1].presentation_frame, 40_000);
        assert!(cached_video_suffix(trim_frames.iter(), 0.8, 0.5, 2).is_empty());
        assert!(cached_video_suffix(trim_frames.iter(), 1.12, 0.5, 2).is_empty());
    }
    #[test]
    fn forward_continuation_requires_known_cursor_and_bounded_distance() {
        assert!(can_continue_video_forward(Some(2.1), 2.1));
        assert!(can_continue_video_forward(Some(2.1), 2.5));
        assert!(!can_continue_video_forward(Some(2.1), 2.099));
        assert!(!can_continue_video_forward(Some(2.1), 3.0));
        assert!(!can_continue_video_forward(None, 2.1));
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn nearby_scrubs_reuse_ring_and_history_without_growing_memory() {
        let stream = test_stream();
        stream.backend.store(1, Ordering::Release);
        stream.set_playing(false);
        let reserved = stream.memory_bytes();
        for target in [4.0 / 24.0, 5.0 / 24.0, 4.0 / 24.0] {
            assert!(stream.retrigger(target, true));
            let chosen = stream.try_pop().unwrap().unwrap();
            assert_eq!(chosen.source_time_seconds, Some(target));
            assert_eq!(chosen.presentation_frame, 0);
            assert_eq!(stream.memory_bytes(), reserved);
        }
        assert_eq!(stream.scrub_cache_stats(), (3, 0, 0));
        assert!(stream.hardware_control.lock().unwrap().opening.len() <= 4);
        stream.set_playing(true);
        let control = stream.hardware_control.lock().unwrap();
        assert!(!control.scrub_history);
        assert_eq!(control.opening.first().unwrap().source_time_seconds, Some(4.0 / 24.0));
        assert_eq!(control.opening.first().unwrap().presentation_frame, 0);
        drop(control);
        stream.set_playing(false);
        assert!(stream.retrigger(5.0, true));
        assert!(stream.try_pop().is_none(), "a cache miss must never present an obsolete generation");
        assert_eq!(stream.scrub_cache_stats(), (3, 1, 0));
    }
    #[test]
    fn scrub_history_retains_only_the_reserved_number_of_recent_surfaces() {
        let mut cache = Vec::new();
        for index in 0..100 {
            remember_scrub_frame(&mut cache, &timed_frame(index as f64, 1.0), 4);
            assert!(cache.len() <= 4);
        }
        assert_eq!(cache.iter().map(|frame| frame.source_time_seconds.unwrap()).collect::<Vec<_>>(), vec![96.0, 97.0, 98.0, 99.0]);
        remember_scrub_frame(&mut cache, &timed_frame(97.0, 1.0), 4);
        assert_eq!(cache.len(), 4);
        assert_eq!(cache.last().unwrap().source_time_seconds, Some(97.0));
        remember_scrub_frame(&mut cache, &timed_frame(100.0, 1.0), 2);
        assert_eq!(cache.len(), 2, "a smaller admitted ring also reduces its cache allowance");
    }
    #[test]
    fn optional_scrub_history_is_capped_and_never_creates_a_waiter() {
        const MIB: u64 = 1024 * 1024;
        let budget = Arc::new(NativeVideoMemoryBudget::new(100 * MIB));
        let lease = budget.lease();
        assert!(lease.try_resize(18 * MIB)); // ring4 + cache4 + decoder8 + GPU2
        assert_eq!(reserve_scrub_history(&lease, MIB, 4, 8), 64);
        assert_eq!(lease.bytes.load(Ordering::Acquire), 78 * MIB);
        assert_eq!(lease.optional_bytes.load(Ordering::Acquire), 60 * MIB);
        assert_eq!(lease.requested_bytes.load(Ordering::Acquire), 0);
        let other = budget.lease();
        assert!(other.try_resize(22 * MIB));
        assert!(!lease.try_grow_optional(79 * MIB));
        assert_eq!(lease.requested_bytes.load(Ordering::Acquire), 0);
        assert_eq!(budget.used.load(Ordering::Acquire), 100 * MIB);
        assert_eq!(scrub_history_limit(1, 4), 96);
        assert_eq!(scrub_history_limit(32 * MIB, 4), 4);
    }
    #[test]
    fn required_admission_succeeds_after_optional_reclaim_with_gpu_frames_held() {
        const MIB: u64 = 1024 * 1024;
        let budget = Arc::new(NativeVideoMemoryBudget::new(80 * MIB));
        let scratch = budget.lease();
        assert!(scratch.try_resize(18 * MIB));
        assert_eq!(reserve_scrub_history(&scratch, MIB, 4, 8), 64);
        let in_flight = scratch.begin_gpu_work();
        let next = budget.lease();
        assert!(!next.try_resize(20 * MIB));
        assert_eq!(next.requested_bytes.load(Ordering::Acquire), 20 * MIB);
        budget.set_optional_cache_allowed(false);
        assert_eq!(reserve_scrub_history(&scratch, MIB, 4, 8), 4);
        // The worker has dropped excess cache refs and purged free driver
        // surfaces. Its base reservation still includes both renderer holds.
        assert!(scratch.try_resize(18 * MIB));
        scratch.optional_bytes.store(0, Ordering::Release);
        assert!(next.try_resize(20 * MIB));
        assert_eq!(next.requested_bytes.load(Ordering::Acquire), 0);
        assert_eq!(budget.used.load(Ordering::Acquire), 38 * MIB);
        drop(scratch);
        assert_eq!(budget.used.load(Ordering::Acquire), 38 * MIB);
        drop(in_flight);
        assert_eq!(budget.used.load(Ordering::Acquire), 20 * MIB);
    }
    #[test]
    fn lowering_budget_reclaims_optional_history_before_another_worker_exists() {
        const MIB: u64 = 1024 * 1024;
        let budget = Arc::new(NativeVideoMemoryBudget::new(100 * MIB));
        let scratch = budget.lease();
        assert!(scratch.try_resize(18 * MIB));
        assert_eq!(reserve_scrub_history(&scratch, MIB, 4, 8), 64);
        let in_flight = scratch.begin_gpu_work();
        budget.set_limit(40 * MIB);
        assert!(budget.is_over_limit());
        assert!(!budget.optional_cache_allowed.load(Ordering::Acquire));
        // Main's next pump sees no waiting worker yet. That must not undo
        // the lower limit's reclamation signal.
        budget.set_optional_cache_allowed(true);
        assert_eq!(reserve_scrub_history(&scratch, MIB, 4, 8), 4);
        assert_eq!(scratch.requested_bytes.load(Ordering::Acquire), 0);
        // After dropping cache refs and unused pool slots, both GPU holds
        // remain charged in the base, and the second decoder can enter.
        assert!(scratch.try_resize(18 * MIB));
        scratch.optional_bytes.store(0, Ordering::Release);
        assert!(!budget.is_over_limit());
        let next = budget.lease();
        assert!(next.try_resize(20 * MIB));
        assert_eq!(budget.used.load(Ordering::Acquire), 38 * MIB);
        budget.set_optional_cache_allowed(true);
        assert!(budget.optional_cache_allowed.load(Ordering::Acquire));
        drop(in_flight);
    }
    #[test]
    fn dense_scrub_history_can_replay_intermediate_frames_in_reverse() {
        let mut cache = Vec::new();
        for index in 0..60 {
            remember_scrub_frame(&mut cache, &timed_frame(index as f64 / 30.0, 1.0 / 30.0), 64);
        }
        // These timestamps were decoded between control requests; they need
        // not have been previously selected or displayed to be reusable.
        for index in (0..60).rev() {
            let target = (index as f64 + 0.4) / 30.0;
            let replay = cached_video_suffix(cache.iter(), target, 1.0, 4);
            assert_eq!(replay[0].source_time_seconds, Some(index as f64 / 30.0));
        }
    }
    #[test]
    fn frame_rate_comes_from_ffmpegs_stream_line() {
        assert_eq!(parse_video_fps("  Stream #0:0(und): Video: rawvideo (RGBA / 0x41424752), rgba(pc, gbr/unknown/unknown, progressive), 1024x576 [SAR 1:1 DAR 16:9], q=2-31, 566231 kb/s, 30 fps, 30 tbn (default)"), Some(30.0));
        assert_eq!(parse_video_fps("  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 960x540 [SAR 1:1 DAR 16:9], 14066 kb/s, 30 fps, 30 tbr, 15360 tbn (default)"), Some(30.0));
        assert_eq!(parse_video_fps("Stream #0:0: Video: prores, yuv422p10le, 1920x1080, 29.97 fps, 29.97 tbr, 30k tbn"), Some(29.97));
        assert_eq!(parse_video_fps("Stream #0:0: Video: vp9, yuv420p, 1280x720, 25 tbr, 1k tbn"), Some(25.0));
        assert_eq!(parse_video_fps("Stream #0:0: Video: rawvideo, rgba, 64x36, 0.3 fps, 0.3 tbn"), Some(0.3));
        assert_eq!(parse_video_fps("Stream #0:0: Audio: aac, 48000 Hz, stereo"), None);
    }
    #[test]
    fn diagnostics_keep_only_a_bounded_tail() {
        let mut bytes = std::io::Cursor::new(vec![42; 100_000]);
        assert_eq!(read_tail(&mut bytes, 16384), vec![42; 16384]);
    }
}
