//! Frames drawn on the output display's refresh instead of a timer.
//!
//! With the Output Window shown, the frame loop used to wake on a
//! `ControlFlow::WaitUntil` timer at the display's rate. A timer is never in
//! phase with the display and drifts against it, so frames started at uneven
//! points in the refresh, the swapchain filled up and getting the next
//! drawable blocked for most of a refresh (two frames of queued latency), and
//! every few seconds the drift showed a frame twice.
//!
//! Now a display clock on the display the output window is on wakes the loop
//! once per refresh: `CVDisplayLink` on macOS, `IDXGIOutput::WaitForVBlank`
//! on a thread on Windows (the swapchain itself already waits on its frame
//! latency waitable object when a drawable is acquired, so the queue stays
//! bounded). The loop draws on every refresh, or every Nth when the target
//! frame rate is a fraction of the refresh rate. The clock follows the window
//! to another display, at that display's own rate.
//!
//! Phase. The drawable for a frame becomes free at a fixed point in the
//! refresh that depends on the compositor, not at the refresh itself: drawing
//! the moment the refresh came, frames waited ~8 ms of a 16.7 ms refresh for
//! a drawable on a Mac. `PhaseLock` learns that point from the frames' own
//! acquire times and starts each frame just before it, so getting the
//! drawable no longer blocks and the frame's time is sampled that much closer
//! to when it is shown. It walks back by itself when the point moves earlier.
//!
//! The timer stays as the fallback: with no output window, before the first
//! refresh arrives, when the refreshes stop coming (a sleeping display), on
//! Linux, or with `GA_CORE_DISPLAY_PACING=0`.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::monitor::MonitorHandle;

pub const ENV_VAR: &str = "GA_CORE_DISPLAY_PACING";

/// Whether `GA_CORE_DISPLAY_PACING` (unset = on) asks for display pacing.
pub fn enabled_by(value: Option<&str>) -> bool {
    !matches!(
        value.map(|value| value.trim().to_ascii_lowercase()).as_deref(),
        Some("0" | "off" | "false" | "no" | "timer")
    )
}

/// Display pacing is available on this platform and not turned off.
pub fn enabled() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows")) && enabled_by(std::env::var(ENV_VAR).ok().as_deref())
}

/// Refreshes between drawn frames for a target frame rate: the whole
/// fraction of the refresh rate nearest the target (see `paced_frame_rate`).
pub fn refresh_divisor(target_fps: u32, refresh_hz: f64) -> u64 {
    let target = target_fps.max(1) as f64;
    if !refresh_hz.is_finite() || refresh_hz <= 0.0 {
        return 1;
    }
    let mut best = 1u64;
    let mut best_error = f64::MAX;
    for divisor in 1..=8u64 {
        let rate = refresh_hz / divisor as f64;
        if rate < 20.0 && divisor > 1 {
            break;
        }
        let error = (rate - target).abs();
        if error < best_error - 1e-9 {
            best = divisor;
            best_error = error;
        }
    }
    best
}

/// Whether the refresh numbered `seq` is one to draw on, the last one drawn
/// on being `last` and frames due every `divisor` refreshes. A late wake-up
/// draws once, never a burst to catch up.
pub fn refresh_due(seq: u64, last: Option<u64>, divisor: u64) -> bool {
    last.is_none_or(|last| seq.wrapping_sub(last) >= divisor.max(1))
}

const PHASE_SAMPLES: usize = 32;
const PHASE_MIN_SAMPLES: usize = 8;
/// Ask for the drawable this long before it is expected to be free.
const PHASE_MARGIN_MS: f64 = 1.0;
/// Never start a frame later than this share of the refresh after it.
const PHASE_MAX_SHARE: f64 = 0.75;

/// Where in the refresh to start a frame (see the module notes).
#[derive(Clone, Debug, Default)]
pub struct PhaseLock {
    /// Refresh to drawable in hand, ms, for recent paced frames.
    ready_ms: VecDeque<f64>,
    /// Frame start to asking for the drawable, ms.
    lead_ms: VecDeque<f64>,
    offset_ms: f64,
}

fn percentile(values: &VecDeque<f64>, q: f64) -> f64 {
    let mut sorted: Vec<f64> = values.iter().copied().collect();
    sorted.sort_by(f64::total_cmp);
    sorted[((sorted.len() as f64 - 1.0) * q).round() as usize]
}

impl PhaseLock {
    /// A paced frame for the refresh at `refresh` started at `started`,
    /// asked for its drawable at `acquire_started` and had it at `acquired`.
    pub fn observe(&mut self, refresh: Instant, started: Instant, acquire_started: Instant, acquired: Instant, period: Duration) {
        let ms = |later: Instant, earlier: Instant| later.saturating_duration_since(earlier).as_secs_f64() * 1000.0;
        let ready = ms(acquired, refresh);
        // A frame drawn a whole refresh late says nothing about the phase.
        if started < refresh || ready > period.as_secs_f64() * 1000.0 * 1.5 {
            return;
        }
        for (window, value) in [(&mut self.ready_ms, ready), (&mut self.lead_ms, ms(acquire_started, started))] {
            if window.len() >= PHASE_SAMPLES {
                window.pop_front();
            }
            window.push_back(value);
        }
        if self.ready_ms.len() >= PHASE_MIN_SAMPLES {
            let offset = percentile(&self.ready_ms, 0.2) - percentile(&self.lead_ms, 0.8) - PHASE_MARGIN_MS;
            self.offset_ms = offset.clamp(0.0, period.as_secs_f64() * 1000.0 * PHASE_MAX_SHARE);
        }
    }

    /// How long after the refresh to start the frame.
    pub fn offset(&self) -> Duration {
        Duration::from_secs_f64(self.offset_ms.max(0.0) / 1000.0)
    }

    pub fn offset_ms(&self) -> f64 {
        self.offset_ms
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// State the display clock's thread shares with the frame loop.
pub struct Shared {
    base: Instant,
    seq: AtomicU64,
    /// Nanoseconds after `base` of the latest refresh, 0 before the first.
    last_tick_ns: AtomicU64,
    /// The display's refresh period as the clock reports it, 0 if unknown.
    period_ns: AtomicU64,
    /// A wake-up is on its way to the frame loop; refreshes until it is
    /// taken only advance `seq`, so a busy loop is never flooded.
    wake_pending: AtomicBool,
    wake: Box<dyn Fn() + Send + Sync>,
}

impl Shared {
    fn new(wake: Box<dyn Fn() + Send + Sync>) -> Self {
        Self {
            base: Instant::now(),
            seq: AtomicU64::new(0),
            last_tick_ns: AtomicU64::new(0),
            period_ns: AtomicU64::new(0),
            wake_pending: AtomicBool::new(false),
            wake,
        }
    }

    /// Display clock thread: a refresh happened.
    #[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
    fn tick(&self, period: Option<Duration>) {
        if let Some(period) = period.filter(|period| !period.is_zero()) {
            self.period_ns.store(period.as_nanos().min(u64::MAX as u128) as u64, Ordering::Relaxed);
        }
        self.seq.fetch_add(1, Ordering::AcqRel);
        let ns = self.base.elapsed().as_nanos().min(u64::MAX as u128) as u64;
        self.last_tick_ns.store(ns.max(1), Ordering::Release);
        if !self.wake_pending.swap(true, Ordering::AcqRel) {
            (self.wake)();
        }
    }

    fn period(&self) -> Option<Duration> {
        match self.period_ns.load(Ordering::Relaxed) {
            0 => None,
            ns => Some(Duration::from_nanos(ns)),
        }
    }

    fn last_tick(&self) -> Option<Instant> {
        match self.last_tick_ns.load(Ordering::Acquire) {
            0 => None,
            ns => Some(self.base + Duration::from_nanos(ns)),
        }
    }
}

/// A display's refresh clock, running while it exists.
pub struct DisplayClock {
    shared: Arc<Shared>,
    link: imp::Link,
    display: imp::DisplayId,
}

impl DisplayClock {
    /// Start a clock on `monitor`; `wake` is called (from the clock's
    /// thread) when a refresh happens and no earlier one is still untaken.
    pub fn start(monitor: &MonitorHandle, wake: Box<dyn Fn() + Send + Sync>) -> Result<Self, String> {
        let display = imp::display_id(monitor).ok_or("no display id for the output window's monitor")?;
        let shared = Arc::new(Shared::new(wake));
        let link = imp::Link::start(&display, Arc::clone(&shared))?;
        Ok(Self { shared, link, display })
    }

    /// Follow the output window onto `monitor`.
    pub fn follow(&mut self, monitor: &MonitorHandle) -> Result<(), String> {
        let display = imp::display_id(monitor).ok_or("no display id for the output window's monitor")?;
        if display != self.display {
            self.link.set_display(&display)?;
            // The old display's period no longer applies.
            self.shared.period_ns.store(0, Ordering::Relaxed);
            self.display = display;
        }
        Ok(())
    }

    /// Frame loop: take the pending wake-up; the number of the latest refresh.
    pub fn take_refresh(&self) -> u64 {
        self.shared.wake_pending.store(false, Ordering::Release);
        self.shared.seq.load(Ordering::Acquire)
    }

    pub fn refresh_period(&self) -> Option<Duration> {
        self.shared.period().or_else(|| self.link.nominal_period())
    }

    pub fn refresh_hz(&self) -> Option<f64> {
        self.refresh_period().map(|period| 1.0 / period.as_secs_f64()).filter(|hz| hz.is_finite() && (20.0..=500.0).contains(hz))
    }

    /// No refresh for this long and the frame loop goes back to its timer.
    pub fn stall_after(&self) -> Duration {
        (self.refresh_period().unwrap_or(Duration::from_micros(16_667)) * 4).max(Duration::from_millis(40))
    }

    /// Refreshes are arriving: the frame loop is paced by them.
    pub fn ticking(&self, now: Instant) -> bool {
        self.shared.last_tick().is_some_and(|last| now.saturating_duration_since(last) < self.stall_after())
    }

    /// When the frame loop should look again if no refresh wakes it first.
    pub fn stall_deadline(&self, now: Instant) -> Instant {
        self.shared.last_tick().map_or(now, |last| last + self.stall_after()).max(now + Duration::from_millis(1))
    }

    /// When the latest refresh came.
    pub fn last_refresh_at(&self) -> Option<Instant> {
        self.shared.last_tick()
    }

    pub fn refreshes(&self) -> u64 {
        self.shared.seq.load(Ordering::Relaxed)
    }

    pub fn source(&self) -> &'static str {
        imp::SOURCE
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::Shared;
    use std::ffi::c_void;
    use std::sync::Arc;
    use std::time::Duration;
    use winit::monitor::MonitorHandle;

    pub const SOURCE: &str = "cvdisplaylink";
    pub type DisplayId = u32;

    type CVDisplayLinkRef = *mut c_void;
    type CVReturn = i32;

    #[repr(C)]
    struct CVSMPTETime {
        subframes: i16,
        subframe_divisor: i16,
        counter: u32,
        kind: u32,
        flags: u32,
        hours: i16,
        minutes: i16,
        seconds: i16,
        frames: i16,
    }

    #[repr(C)]
    struct CVTimeStamp {
        version: u32,
        video_time_scale: i32,
        video_time: i64,
        host_time: u64,
        rate_scalar: f64,
        video_refresh_period: i64,
        smpte_time: CVSMPTETime,
        flags: u64,
        reserved: u64,
    }

    #[repr(C)]
    struct CVTime {
        time_value: i64,
        time_scale: i32,
        flags: i32,
    }

    type OutputCallback = extern "C" fn(
        CVDisplayLinkRef,
        *const CVTimeStamp,
        *const CVTimeStamp,
        u64,
        *mut u64,
        *mut c_void,
    ) -> CVReturn;

    #[link(name = "CoreVideo", kind = "framework")]
    unsafe extern "C" {
        fn CVDisplayLinkCreateWithCGDisplay(display: u32, link: *mut CVDisplayLinkRef) -> CVReturn;
        fn CVDisplayLinkSetOutputCallback(link: CVDisplayLinkRef, callback: OutputCallback, context: *mut c_void) -> CVReturn;
        fn CVDisplayLinkSetCurrentCGDisplay(link: CVDisplayLinkRef, display: u32) -> CVReturn;
        fn CVDisplayLinkGetNominalOutputVideoRefreshPeriod(link: CVDisplayLinkRef) -> CVTime;
        fn CVDisplayLinkStart(link: CVDisplayLinkRef) -> CVReturn;
        fn CVDisplayLinkStop(link: CVDisplayLinkRef) -> CVReturn;
        fn CVDisplayLinkRelease(link: CVDisplayLinkRef);
    }

    extern "C" fn on_refresh(
        _link: CVDisplayLinkRef,
        _now: *const CVTimeStamp,
        output_time: *const CVTimeStamp,
        _flags_in: u64,
        _flags_out: *mut u64,
        context: *mut c_void,
    ) -> CVReturn {
        // SAFETY: `context` is the `Arc<Shared>` leaked in `Link::start`,
        // released only after `CVDisplayLinkStop` (which waits for a running
        // callback) in `Drop`. `output_time` is valid for the call.
        let shared = unsafe { &*(context as *const Shared) };
        let period = unsafe { output_time.as_ref() }.and_then(|time| {
            (time.video_time_scale > 0 && time.video_refresh_period > 0)
                .then(|| Duration::from_secs_f64(time.video_refresh_period as f64 / time.video_time_scale as f64))
        });
        shared.tick(period);
        0
    }

    pub struct Link {
        raw: CVDisplayLinkRef,
        context: *const Shared,
    }

    impl Link {
        pub fn start(display: &DisplayId, shared: Arc<Shared>) -> Result<Self, String> {
            let mut raw: CVDisplayLinkRef = std::ptr::null_mut();
            // SAFETY: plain CoreVideo calls on a link this function owns.
            unsafe {
                let status = CVDisplayLinkCreateWithCGDisplay(*display, &mut raw);
                if status != 0 || raw.is_null() {
                    return Err(format!("CVDisplayLinkCreateWithCGDisplay failed: {status}"));
                }
                let context = Arc::into_raw(shared);
                let link = Self { raw, context };
                let status = CVDisplayLinkSetOutputCallback(raw, on_refresh, context as *mut c_void);
                if status != 0 {
                    return Err(format!("CVDisplayLinkSetOutputCallback failed: {status}"));
                }
                let status = CVDisplayLinkStart(raw);
                if status != 0 {
                    return Err(format!("CVDisplayLinkStart failed: {status}"));
                }
                Ok(link)
            }
        }

        pub fn set_display(&mut self, display: &DisplayId) -> Result<(), String> {
            // SAFETY: `raw` is a live link owned by `self`.
            let status = unsafe { CVDisplayLinkSetCurrentCGDisplay(self.raw, *display) };
            if status == 0 { Ok(()) } else { Err(format!("CVDisplayLinkSetCurrentCGDisplay failed: {status}")) }
        }

        pub fn nominal_period(&self) -> Option<Duration> {
            // SAFETY: `raw` is a live link owned by `self`.
            let time = unsafe { CVDisplayLinkGetNominalOutputVideoRefreshPeriod(self.raw) };
            (time.time_scale > 0 && time.time_value > 0)
                .then(|| Duration::from_secs_f64(time.time_value as f64 / time.time_scale as f64))
        }
    }

    impl Drop for Link {
        fn drop(&mut self) {
            // SAFETY: stop waits for a callback in progress, so nothing uses
            // `context` once it returns.
            unsafe {
                CVDisplayLinkStop(self.raw);
                CVDisplayLinkRelease(self.raw);
                drop(Arc::from_raw(self.context));
            }
        }
    }

    pub fn display_id(monitor: &MonitorHandle) -> Option<DisplayId> {
        use winit::platform::macos::MonitorHandleExtMacOS;
        Some(monitor.native_id())
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::Shared;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput};
    use winit::monitor::MonitorHandle;

    pub const SOURCE: &str = "dxgi-vblank";
    /// The GDI device name ("\\.\DISPLAY1"), as winit and DXGI both give it.
    pub type DisplayId = String;

    pub struct Link {
        stop: Arc<AtomicBool>,
        display: Arc<Mutex<(DisplayId, Option<Duration>)>>,
    }

    fn period_of(display: &str) -> Option<Duration> {
        crate::windows_display_rate::exact_refresh_hz(display).map(|hz| Duration::from_secs_f64(1.0 / hz))
    }

    fn find_output(display: &str) -> Option<IDXGIOutput> {
        // SAFETY: plain DXGI enumeration; every interface is reference counted.
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
            for adapter_index in 0.. {
                let Ok(adapter) = factory.EnumAdapters1(adapter_index) else { break };
                for output_index in 0.. {
                    let Ok(output) = adapter.EnumOutputs(output_index) else { break };
                    let Ok(desc) = output.GetDesc() else { continue };
                    let len = desc.DeviceName.iter().position(|&c| c == 0).unwrap_or(desc.DeviceName.len());
                    if String::from_utf16_lossy(&desc.DeviceName[..len]).eq_ignore_ascii_case(display) {
                        return Some(output);
                    }
                }
            }
        }
        None
    }

    impl Link {
        pub fn start(display: &DisplayId, shared: Arc<Shared>) -> Result<Self, String> {
            let stop = Arc::new(AtomicBool::new(false));
            let target = Arc::new(Mutex::new((display.clone(), period_of(display))));
            let thread_stop = Arc::clone(&stop);
            let thread_target = Arc::clone(&target);
            std::thread::Builder::new()
                .name("ghost-display-vblank".to_string())
                .spawn(move || {
                    let mut current: Option<(DisplayId, IDXGIOutput)> = None;
                    let mut last_ok: Option<Instant> = None;
                    let mut instant_returns = 0u32;
                    while !thread_stop.load(Ordering::Acquire) {
                        let (wanted, period) = thread_target.lock().map(|target| target.clone()).unwrap_or_default();
                        if current.as_ref().is_none_or(|(name, _)| *name != wanted) {
                            current = find_output(&wanted).map(|output| (wanted.clone(), output));
                        }
                        let Some((_, output)) = current.as_ref() else {
                            // No such output (unplugged, or a remote session):
                            // no refreshes, so the frame loop uses its timer.
                            std::thread::sleep(Duration::from_millis(250));
                            continue;
                        };
                        // SAFETY: a live output interface.
                        if unsafe { output.WaitForVBlank() }.is_err() {
                            current = None;
                            std::thread::sleep(Duration::from_millis(100));
                            continue;
                        }
                        let now = Instant::now();
                        // A wait that returns at once is not a refresh (some
                        // remote and virtual displays): back off rather than spin.
                        if last_ok.is_some_and(|last| now.saturating_duration_since(last) < Duration::from_millis(2)) {
                            instant_returns += 1;
                            if instant_returns >= 3 {
                                std::thread::sleep(Duration::from_millis(100));
                                last_ok = None;
                                continue;
                            }
                        } else {
                            instant_returns = 0;
                        }
                        last_ok = Some(now);
                        shared.tick(period);
                    }
                })
                .map_err(|err| format!("could not start the vblank thread: {err}"))?;
            Ok(Self { stop, display: target })
        }

        pub fn set_display(&mut self, display: &DisplayId) -> Result<(), String> {
            if let Ok(mut target) = self.display.lock() {
                *target = (display.clone(), period_of(display));
            }
            Ok(())
        }

        pub fn nominal_period(&self) -> Option<Duration> {
            self.display.lock().ok().and_then(|target| target.1)
        }
    }

    impl Drop for Link {
        fn drop(&mut self) {
            // Not joined: the thread ends after its current refresh, and a
            // display that has gone to sleep must not hold up the frame loop.
            self.stop.store(true, Ordering::Release);
        }
    }

    pub fn display_id(monitor: &MonitorHandle) -> Option<DisplayId> {
        use winit::platform::windows::MonitorHandleExtWindows;
        Some(monitor.native_id())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use super::Shared;
    use std::sync::Arc;
    use std::time::Duration;
    use winit::monitor::MonitorHandle;

    pub const SOURCE: &str = "none";
    pub type DisplayId = ();

    pub struct Link;

    impl Link {
        pub fn start(_display: &DisplayId, _shared: Arc<Shared>) -> Result<Self, String> {
            Err("display pacing is not available on this platform".to_string())
        }
        pub fn set_display(&mut self, _display: &DisplayId) -> Result<(), String> {
            Ok(())
        }
        pub fn nominal_period(&self) -> Option<Duration> {
            None
        }
    }

    pub fn display_id(_monitor: &MonitorHandle) -> Option<DisplayId> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_escape_hatch_turns_display_pacing_off() {
        assert!(enabled_by(None));
        assert!(enabled_by(Some("1")));
        assert!(enabled_by(Some("")));
        for off in ["0", "off", "FALSE", " no ", "timer"] {
            assert!(!enabled_by(Some(off)), "{off}");
        }
    }

    #[test]
    fn draws_every_refresh_or_the_whole_fraction_nearest_the_target() {
        assert_eq!(refresh_divisor(60, 60.0), 1);
        assert_eq!(refresh_divisor(60, 59.94), 1);
        assert_eq!(refresh_divisor(60, 120.0), 2);
        assert_eq!(refresh_divisor(120, 120.0), 1);
        assert_eq!(refresh_divisor(240, 120.0), 1);
        assert_eq!(refresh_divisor(30, 120.0), 4);
        assert_eq!(refresh_divisor(60, 144.0), 2);
        assert_eq!(refresh_divisor(60, 50.0), 1);
        assert_eq!(refresh_divisor(25, 50.0), 2);
        assert_eq!(refresh_divisor(60, f64::NAN), 1);
        assert_eq!(refresh_divisor(1, 60.0), 3);
    }

    #[test]
    fn a_late_wake_up_draws_once_without_catching_up() {
        assert!(refresh_due(5, None, 2));
        assert!(!refresh_due(11, Some(10), 2));
        assert!(refresh_due(12, Some(10), 2));
        assert!(refresh_due(17, Some(10), 2));
        assert!(refresh_due(11, Some(10), 1));
        assert!(!refresh_due(10, Some(10), 1));
    }

    #[test]
    fn starts_frames_just_before_the_drawable_is_free_and_follows_it() {
        let period = Duration::from_micros(16_683);
        let ms = |v: f64| Duration::from_secs_f64(v / 1000.0);
        let mut lock = PhaseLock::default();
        let t0 = Instant::now();
        // Drawn at the refresh, the drawable comes 8 ms after it.
        for i in 0..PHASE_MIN_SAMPLES as u32 {
            let refresh = t0 + period * i;
            assert_eq!(lock.offset(), Duration::ZERO);
            lock.observe(refresh, refresh, refresh + ms(0.5), refresh + ms(8.0), period);
        }
        assert!((lock.offset_ms() - 6.5).abs() < 1e-6, "{}", lock.offset_ms());
        // Started at the offset, the drawable is in hand at once: the
        // refresh-to-drawable time stays where it is, and so does the offset.
        for i in 10..40u32 {
            let refresh = t0 + period * i;
            let start = refresh + lock.offset();
            lock.observe(refresh, start, start + ms(0.5), (start + ms(0.6)).max(refresh + ms(8.0)), period);
        }
        assert!((lock.offset_ms() - 6.5).abs() < 0.2, "{}", lock.offset_ms());
        // The drawable now comes at once: the offset walks back.
        for i in 40..200u32 {
            let refresh = t0 + period * i;
            let start = refresh + lock.offset();
            lock.observe(refresh, start, start + ms(0.5), start + ms(0.6), period);
        }
        assert!(lock.offset_ms() < 0.5, "{}", lock.offset_ms());
        // Never past most of the refresh; late frames are ignored.
        let mut lock = PhaseLock::default();
        for i in 0..20u32 {
            let refresh = t0 + period * i;
            lock.observe(refresh, refresh, refresh, refresh + ms(16.0), period);
            lock.observe(refresh, refresh, refresh, refresh + ms(40.0), period);
        }
        assert!(lock.offset_ms() <= 16.683 * PHASE_MAX_SHARE + 1e-9);
        lock.reset();
        assert_eq!(lock.offset(), Duration::ZERO);
    }

    #[test]
    fn coalesces_refreshes_until_the_frame_loop_takes_one() {
        let wakes = Arc::new(AtomicU64::new(0));
        let counter = Arc::clone(&wakes);
        let shared = Shared::new(Box::new(move || {
            counter.fetch_add(1, Ordering::Relaxed);
        }));
        shared.tick(Some(Duration::from_micros(8_333)));
        shared.tick(None);
        shared.tick(None);
        assert_eq!(wakes.load(Ordering::Relaxed), 1);
        assert_eq!(shared.seq.load(Ordering::Relaxed), 3);
        assert_eq!(shared.period(), Some(Duration::from_micros(8_333)));
        shared.wake_pending.store(false, Ordering::Release);
        shared.tick(None);
        assert_eq!(wakes.load(Ordering::Relaxed), 2);
        assert!(shared.last_tick().is_some());
    }
}
