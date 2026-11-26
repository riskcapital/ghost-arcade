//! Frame pacing: the frame period, display-paced frames and the present
//! decision.

use crate::*;

// Preserve the clock phase across ordinary wake-up / media-pump jitter.
// Rebase after a whole missed interval, so a stall never causes catch-up bursts.
pub(crate) fn scheduled_frame_start(deadline: Instant, now: Instant, period: Duration) -> Instant {
    if now.saturating_duration_since(deadline) < period { deadline } else { now }
}

/// A display's refresh rate in Hz. On Windows winit's figure is a whole
/// number (a 59.94 Hz display reads as 59), so the exact one is asked for
/// first; macOS and Linux already report fractional rates.
pub(crate) fn monitor_refresh_hz(monitor: &MonitorHandle) -> Option<f64> {
    #[cfg(target_os = "windows")]
    {
        use winit::platform::windows::MonitorHandleExtWindows;
        if let Some(hz) = windows_display_rate::exact_refresh_hz(&monitor.native_id()) {
            return Some(hz);
        }
    }
    monitor.refresh_rate_millihertz().map(|millihertz| millihertz as f64 / 1000.0)
}

/// The frame rate to draw at for a display: the whole fraction of its refresh
/// rate nearest the target, so every frame stays on screen for the same number
/// of refreshes. A fixed 60 dropped every sixth frame on a 50Hz projector and
/// held frames for alternately two and three refreshes at 144Hz -- both read
/// as stutter however fast the core is.
pub(crate) fn paced_frame_rate(target_fps: u32, refresh_hz: Option<f64>) -> f64 {
    let target = target_fps.max(1) as f64;
    let Some(refresh) = refresh_hz.filter(|hz| hz.is_finite() && *hz >= 20.0 && *hz <= 500.0) else {
        return target;
    };
    let mut best = target;
    let mut best_error = f64::MAX;
    for divisor in 1..=8 {
        let rate = refresh / divisor as f64;
        if rate < 20.0 {
            break;
        }
        let error = (rate - target).abs();
        if error < best_error - 1e-9 {
            best = rate;
            best_error = error;
        }
    }
    best
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum PresentAction {
    RenderNow { next_redraw: Instant },
    WithNextFrame,
}

pub(crate) fn present_action(frames_scheduled: bool, last_redraw: Instant, now: Instant, period: Duration) -> PresentAction {
    if !frames_scheduled {
        return PresentAction::RenderNow { next_redraw: now };
    }
    let due = last_redraw + period;
    if now >= due {
        PresentAction::RenderNow { next_redraw: scheduled_frame_start(due, now, period) }
    } else {
        PresentAction::WithNextFrame
    }
}

/// Draw directly rather than wait on the window: it is minimised (Windows
/// sends it no redraws), or the redraw asked for has not come for two frames.
pub(crate) fn output_redraw_stalled(minimized: bool, requested_at: Instant, now: Instant, period: Duration) -> bool {
    minimized || now.saturating_duration_since(requested_at) >= period * 2
}

impl App {
    pub(crate) fn output_pacing_report(&self) -> present_pacing::PacingReport {
        let frame_ms = self.frame_duration().as_secs_f64() * 1000.0;
        let refresh_ms = self.paced_refresh_hz().filter(|hz| *hz > 0.0).map(|hz| 1000.0 / hz);
        self.renderer.as_ref().map(|renderer| renderer.pacing.report(frame_ms, refresh_ms)).unwrap_or_default()
    }

    pub(crate) fn frame_duration(&self) -> Duration {
        let refresh = if self.output_window_attached { self.paced_refresh_hz() } else { None };
        Duration::from_secs_f64(1.0 / paced_frame_rate(self.target_fps, refresh))
    }

    /// The output display's refresh rate: the display clock's own period
    /// while it paces the frames, else the rate the display reports.
    pub(crate) fn paced_refresh_hz(&self) -> Option<f64> {
        self.display_clock.as_ref()
            .filter(|clock| clock.ticking(Instant::now()))
            .and_then(display_pacing::DisplayClock::refresh_hz)
            .or(self.output_refresh_hz)
    }

    /// Re-read the refresh rate of the display the output window is on.
    pub(crate) fn refresh_output_display_rate(&mut self) {
        let monitor = self.renderer.as_ref().and_then(|renderer| renderer.window.current_monitor());
        self.output_refresh_hz = monitor.as_ref().and_then(monitor_refresh_hz);
        self.output_refresh_monitor = monitor;
        self.sync_display_clock();
    }

    /// Run a refresh clock on the output window's display while the window
    /// is shown, following it to another display; none otherwise.
    pub(crate) fn sync_display_clock(&mut self) {
        self.phase_lock.reset();
        self.paced_refresh_at = None;
        self.paced_frame_at = None;
        let monitor = self.output_refresh_monitor.clone()
            .filter(|_| self.display_pacing_enabled && self.output_window_attached && self.renderer.is_some());
        let Some(monitor) = monitor else {
            self.display_clock = None;
            self.last_paced_refresh = None;
            return;
        };
        let result = match self.display_clock.as_mut() {
            Some(clock) => clock.follow(&monitor),
            None => {
                let proxy = std::sync::Mutex::new(self.event_proxy.clone());
                display_pacing::DisplayClock::start(&monitor, Box::new(move || {
                    if let Ok(proxy) = proxy.lock() {
                        let _ = proxy.send_event(UserEvent::DisplayRefresh);
                    }
                }))
                .map(|clock| self.display_clock = Some(clock))
            }
        };
        if let Err(error) = result {
            eprintln!("[GhostRenderCore] display pacing unavailable, using the frame timer: {error}");
            self.display_clock = None;
            self.display_clock_error = Some(error);
        } else {
            self.display_clock_error = None;
        }
    }

    /// Frames are paced by the output display's refreshes right now (not
    /// by the timer): the window is shown and its refreshes are arriving.
    pub(crate) fn display_paced(&self) -> bool {
        self.output_window_attached
            && self.display_clock.as_ref().is_some_and(|clock| clock.ticking(Instant::now()))
    }

    /// The output display refreshed: draw if a frame is due on this refresh.
    pub(crate) fn on_display_refresh(&mut self) {
        let Some(refresh) = self.display_clock.as_ref().map(display_pacing::DisplayClock::take_refresh) else {
            return;
        };
        if !self.output_window_attached {
            // Detached by closing the window: stop the clock.
            self.sync_display_clock();
            return;
        }
        if !self.running {
            return;
        }
        self.pump_frame_media();
        if !self.frames_scheduled() {
            return;
        }
        let hz = self.paced_refresh_hz();
        let period = hz.map_or(Duration::from_micros(16_667), |hz| Duration::from_secs_f64(1.0 / hz));
        self.observe_paced_phase(period);
        let now = Instant::now();
        if self.paced_frame_at.is_some() {
            // The last refresh's frame never got its turn: draw it now.
            self.draw_paced_frame(now);
        }
        let divisor = hz.map_or(1, |hz| display_pacing::refresh_divisor(self.target_fps, hz));
        // A frame skipped for backpressure is normally drawn when the GPU
        // frees up (GpuFrameCompleted); if that has not happened, now.
        if display_pacing::refresh_due(refresh, self.last_paced_refresh, divisor) || self.pending_render_retry {
            if self.last_paced_refresh.is_some_and(|last| refresh.wrapping_sub(last) > divisor) {
                self.late_paced_frames = self.late_paced_frames.saturating_add(1);
            }
            self.last_paced_refresh = Some(refresh);
            let refresh_at = self.display_clock.as_ref()
                .and_then(display_pacing::DisplayClock::last_refresh_at)
                .unwrap_or(now)
                .min(now);
            self.paced_refresh_at = Some(refresh_at);
            let start_at = refresh_at + self.phase_lock.offset();
            if self.pending_render_retry || start_at <= now + Duration::from_micros(500) {
                self.draw_paced_frame(now);
            } else {
                self.paced_frame_at = Some(start_at);
            }
        }
    }

    /// Draw the paced frame that is due.
    pub(crate) fn draw_paced_frame(&mut self, now: Instant) {
        self.paced_frame_at = None;
        self.last_redraw = now;
        self.drive_frame(now);
    }

    /// The paced frame's start is here (RPCs keep the loop busy, so this is
    /// checked between them as well as when the loop goes idle).
    pub(crate) fn paced_frame_ready(&self, now: Instant) -> bool {
        self.paced_frame_at.is_some_and(|at| now >= at)
    }

    /// Learn from the last paced frame when its drawable came.
    pub(crate) fn observe_paced_phase(&mut self, period: Duration) {
        let Some(times) = self.renderer.as_mut().and_then(|renderer| renderer.pacing.take_frame_times()) else {
            return;
        };
        if let Some(refresh_at) = self.paced_refresh_at {
            self.phase_lock.observe(refresh_at, times.started, times.acquire_started, times.acquired, period);
        }
    }

    pub(crate) fn display_pacing_report(&self) -> Value {
        let clock = self.display_clock.as_ref();
        json!({
            "enabled": self.display_pacing_enabled,
            "active": self.display_paced(),
            "source": if self.display_paced() { clock.map_or("timer", display_pacing::DisplayClock::source) } else { "timer" },
            "clock_refresh_hz": clock.and_then(display_pacing::DisplayClock::refresh_hz),
            "display_refresh_hz": self.output_refresh_hz,
            "refreshes": clock.map_or(0, display_pacing::DisplayClock::refreshes),
            "late_frames": self.late_paced_frames,
            "phase_offset_ms": self.phase_lock.offset_ms(),
            "frame_interval_ms": self.frame_duration().as_secs_f64() * 1000.0,
            "error": self.display_clock_error,
        })
    }

    /// Frames are wanted on a clock right now: the output window is shown,
    /// or there is something to draw for the other outputs.
    pub(crate) fn frames_scheduled(&self) -> bool {
        self.output_window_attached
            || (self.renderer.is_some()
                && (
                    // A requested frame that has not been drawn yet outranks the
                    // idle gate. Without this an empty scene goes to sleep still
                    // owing one clear-and-present, and the last picture stays
                    // resident in every output surface.
                    self.pending_render_retry
                        || self.present_pending
                        || self.launch_scheduler.has_pending()
                        || !self.scene_layers.is_empty()
                        || !self.native_graph_layers.is_empty()
                        || !self.pending_native_graph_jobs.is_empty()
                        || self.source_preview_dirty
                        || self.stage3d_scene.is_some()
                        || self.projection_sim_scene.is_some()
                ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_paced_to_a_whole_fraction_of_the_output_display() {
        use super::paced_frame_rate as rate;
        assert_eq!(rate(60, None), 60.0);
        assert_eq!(rate(60, Some(60.0)), 60.0);
        assert_eq!(rate(60, Some(50.0)), 50.0); // PAL projector
        assert!((rate(60, Some(59.94)) - 59.94).abs() < 1e-9);
        assert_eq!(rate(60, Some(120.0)), 60.0);
        assert_eq!(rate(60, Some(144.0)), 72.0); // every frame shown twice
        assert_eq!(rate(60, Some(165.0)), 55.0);
        assert_eq!(rate(60, Some(240.0)), 60.0);
        assert_eq!(rate(30, Some(60.0)), 30.0);
        // A nonsense report keeps the target.
        assert_eq!(rate(60, Some(0.0)), 60.0);
        assert_eq!(rate(60, Some(f64::NAN)), 60.0);
    }

    #[test]
    fn an_editor_present_does_not_move_the_frame_clock() {
        use super::{PresentAction, present_action};
        use std::time::{Duration, Instant};
        let period = Duration::from_millis(16);
        let last = Instant::now();
        // Idle core: draw now.
        assert_eq!(present_action(false, last, last + Duration::from_millis(3), period),
            PresentAction::RenderNow { next_redraw: last + Duration::from_millis(3) });
        // Drawing on schedule, next frame not due: it carries the change.
        assert_eq!(present_action(true, last, last + Duration::from_millis(3), period), PresentAction::WithNextFrame);
        // Due: draw now, on the existing schedule rather than from now.
        assert_eq!(present_action(true, last, last + Duration::from_millis(18), period),
            PresentAction::RenderNow { next_redraw: last + period });
    }

    #[test]
    fn a_minimised_or_silent_output_window_does_not_stop_the_core() {
        use std::time::{Duration, Instant};
        let period = Duration::from_millis(16);
        let asked = Instant::now();
        // A visible window that answers within a frame is waited for.
        assert!(!super::output_redraw_stalled(false, asked, asked + Duration::from_millis(15), period));
        // Minimised: Windows sends no redraw, so draw now.
        assert!(super::output_redraw_stalled(true, asked, asked, period));
        // Two frames without the redraw arriving: draw now, and keep doing so.
        assert!(super::output_redraw_stalled(false, asked, asked + period * 2, period));
        assert!(super::output_redraw_stalled(false, asked, asked + period * 5, period));
    }

    #[test]
    fn presentation_deadline_keeps_phase_but_does_not_catch_up_after_stalls() {
        let start = std::time::Instant::now();
        let period = std::time::Duration::from_millis(16);
        let mut scheduled = start;
        for frame in 1..=120 {
            let deadline = scheduled + period;
            scheduled = super::scheduled_frame_start(deadline, deadline + std::time::Duration::from_millis(3), period);
            assert_eq!(scheduled, start + period * frame);
        }
        let late = scheduled + period * 10;
        assert_eq!(super::scheduled_frame_start(scheduled + period, late, period), late);
    }
}
