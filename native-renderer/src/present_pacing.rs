//! How evenly the program output is drawn and presented.
//!
//! Three clocks per output window, each kept as the last few hundred
//! intervals so status can report their spread:
//! - `frame_start`: one frame's CPU work starting to the next one's;
//! - `present`: one `present()` of the output's swapchain to the next;
//! - `acquire_wait`: how long getting the next drawable blocked, which is how
//!   far the frame loop ran ahead of the display.
//!
//! `late` counts present intervals more than half a display refresh longer
//! than the frame period: a refresh that showed the previous frame again.

use serde::Serialize;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

const WINDOW: usize = 600;

#[derive(Clone, Debug, Default)]
pub struct IntervalWindow {
    samples: VecDeque<f64>,
    total: u64,
}

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq)]
pub struct IntervalReport {
    /// Intervals in the window (at most 600).
    pub samples: u64,
    /// Intervals recorded since the output was attached.
    pub total: u64,
    pub mean_ms: f64,
    pub stddev_ms: f64,
    pub p50_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

impl IntervalWindow {
    pub fn push(&mut self, ms: f64) {
        if !ms.is_finite() || ms < 0.0 {
            return;
        }
        if self.samples.len() >= WINDOW {
            self.samples.pop_front();
        }
        self.samples.push_back(ms);
        self.total = self.total.saturating_add(1);
    }

    pub fn clear(&mut self) {
        self.samples.clear();
    }

    pub fn report(&self) -> IntervalReport {
        let n = self.samples.len();
        if n == 0 {
            return IntervalReport { total: self.total, ..IntervalReport::default() };
        }
        let mean = self.samples.iter().sum::<f64>() / n as f64;
        let variance = self.samples.iter().map(|ms| (ms - mean) * (ms - mean)).sum::<f64>() / n as f64;
        let mut sorted: Vec<f64> = self.samples.iter().copied().collect();
        sorted.sort_by(f64::total_cmp);
        let at = |q: f64| sorted[((n as f64 - 1.0) * q).round() as usize];
        IntervalReport {
            samples: n as u64,
            total: self.total,
            mean_ms: mean,
            stddev_ms: variance.sqrt(),
            p50_ms: at(0.5),
            p99_ms: at(0.99),
            max_ms: sorted[n - 1],
        }
    }

    /// Intervals in the window longer than `limit_ms`.
    pub fn count_over(&self, limit_ms: f64) -> u64 {
        self.samples.iter().filter(|ms| **ms > limit_ms).count() as u64
    }
}

/// One output window's pacing record.
#[derive(Clone, Debug, Default)]
pub struct PacingProbe {
    last_frame_start: Option<Instant>,
    last_present: Option<Instant>,
    frame_start: IntervalWindow,
    present: IntervalWindow,
    acquire_wait: IntervalWindow,
    /// The latest frame: (CPU work started, acquire started, acquired).
    last_frame: Option<FrameTimes>,
    pending_start: Option<Instant>,
}

/// When one frame started, asked for a drawable and got it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameTimes {
    pub started: Instant,
    pub acquire_started: Instant,
    pub acquired: Instant,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct PacingReport {
    pub frame_start: IntervalReport,
    pub present: IntervalReport,
    pub acquire_wait: IntervalReport,
    /// Present intervals in the window more than half a refresh over the
    /// frame period: the display showed a frame twice.
    pub late_presents: u64,
}

/// A gap this long means the output was idle, not slow: start over.
const GAP: Duration = Duration::from_millis(250);

fn interval(last: &mut Option<Instant>, now: Instant) -> Option<f64> {
    let previous = last.replace(now)?;
    let gap = now.saturating_duration_since(previous);
    (gap < GAP).then(|| gap.as_secs_f64() * 1000.0)
}

impl PacingProbe {
    pub fn frame_started(&mut self, now: Instant) {
        self.pending_start = Some(now);
        if let Some(ms) = interval(&mut self.last_frame_start, now) {
            self.frame_start.push(ms);
        }
    }

    pub fn acquired(&mut self, started: Instant, done: Instant) {
        self.acquire_wait.push(done.saturating_duration_since(started).as_secs_f64() * 1000.0);
        if let Some(frame_started) = self.pending_start.take() {
            self.last_frame = Some(FrameTimes { started: frame_started, acquire_started: started, acquired: done });
        }
    }

    /// The latest frame's times, once.
    pub fn take_frame_times(&mut self) -> Option<FrameTimes> {
        self.last_frame.take()
    }

    pub fn presented(&mut self, now: Instant) {
        if let Some(ms) = interval(&mut self.last_present, now) {
            self.present.push(ms);
        }
    }

    /// The output went away: the next interval is not a frame interval.
    pub fn reset(&mut self) {
        self.last_frame_start = None;
        self.last_present = None;
        self.frame_start.clear();
        self.present.clear();
        self.acquire_wait.clear();
        self.last_frame = None;
        self.pending_start = None;
    }

    /// `frame_ms`: the frame period; `refresh_ms`: the display's refresh.
    pub fn report(&self, frame_ms: f64, refresh_ms: Option<f64>) -> PacingReport {
        let half_refresh = refresh_ms.unwrap_or(frame_ms) * 0.5;
        PacingReport {
            frame_start: self.frame_start.report(),
            present: self.present.report(),
            acquire_wait: self.acquire_wait.report(),
            late_presents: self.present.count_over(frame_ms + half_refresh),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_spread_and_percentiles_of_the_window() {
        let mut window = IntervalWindow::default();
        for i in 0..100 {
            window.push(if i == 99 { 33.0 } else { 16.0 });
        }
        let report = window.report();
        assert_eq!(report.samples, 100);
        assert_eq!(report.p50_ms, 16.0);
        assert_eq!(report.max_ms, 33.0);
        assert!((report.mean_ms - 16.17).abs() < 1e-9);
        assert!(report.stddev_ms > 1.0 && report.stddev_ms < 2.0);
        assert_eq!(window.count_over(24.0), 1);
    }

    #[test]
    fn keeps_only_the_last_window_of_samples() {
        let mut window = IntervalWindow::default();
        for _ in 0..(WINDOW + 50) {
            window.push(1.0);
        }
        let report = window.report();
        assert_eq!(report.samples, WINDOW as u64);
        assert_eq!(report.total, (WINDOW + 50) as u64);
    }

    #[test]
    fn keeps_the_latest_frames_acquire_times_once() {
        let mut probe = PacingProbe::default();
        let t0 = Instant::now();
        probe.frame_started(t0);
        probe.acquired(t0 + Duration::from_millis(1), t0 + Duration::from_millis(8));
        let times = probe.take_frame_times().unwrap();
        assert_eq!(times.acquired - times.started, Duration::from_millis(8));
        assert!(probe.take_frame_times().is_none());
        assert_eq!(probe.report(16.7, None).acquire_wait.p50_ms, 7.0);
    }

    #[test]
    fn an_idle_gap_is_not_an_interval() {
        let mut probe = PacingProbe::default();
        let t0 = Instant::now();
        probe.presented(t0);
        probe.presented(t0 + Duration::from_millis(16));
        probe.presented(t0 + Duration::from_secs(2));
        probe.presented(t0 + Duration::from_millis(2016));
        let report = probe.report(16.0, Some(16.0));
        assert_eq!(report.present.samples, 2);
        assert_eq!(report.late_presents, 0);
    }
}
