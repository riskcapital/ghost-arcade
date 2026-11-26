//! How many frames the CPU may queue ahead of the GPU, and how long a frame
//! takes from the start of its CPU work to the end of its GPU work.
//!
//! With one frame in flight the CPU could not start frame N+1 until the GPU
//! had finished frame N, so CPU and GPU time added up: 6 ms of CPU and 12 ms
//! of GPU gave an 18 ms frame. With two, the CPU prepares the next frame
//! while the GPU draws the current one and the frame costs the larger of the
//! two. Everything the CPU writes per frame goes through `queue.write_buffer`
//! / `write_texture` (staged and ordered by the queue), a `StagingBelt`
//! recalled on submit, or a readback/capture buffer that is not reused until
//! its own map or completion has landed, so a second frame never overwrites
//! what the first is still reading.
//!
//! The cost is latency when the GPU is the bottleneck: a queued frame waits
//! for the one ahead of it. `GA_CORE_MAX_FRAMES_IN_FLIGHT=1` restores the old
//! one-at-a-time behaviour exactly, without a rebuild.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

pub const DEFAULT_MAX_FRAMES_IN_FLIGHT: u64 = 2;
/// More than three only adds latency: the swapchain holds three at most.
pub const MAX_FRAMES_IN_FLIGHT_LIMIT: u64 = 3;
pub const ENV_VAR: &str = "GA_CORE_MAX_FRAMES_IN_FLIGHT";

/// The value of `GA_CORE_MAX_FRAMES_IN_FLIGHT`, or the default when it is
/// unset or not a whole number. Clamped to 1..=3.
pub fn parse(value: Option<&str>) -> u64 {
    value
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|value| value.clamp(1, MAX_FRAMES_IN_FLIGHT_LIMIT))
        .unwrap_or(DEFAULT_MAX_FRAMES_IN_FLIGHT)
}

pub fn from_env() -> u64 {
    parse(std::env::var(ENV_VAR).ok().as_deref())
}

/// Whether a new frame may start with `submitted` frames sent and
/// `completed` finished by the GPU.
pub fn slots_full(submitted: u64, completed: u64, max_in_flight: u64) -> bool {
    submitted.saturating_sub(completed) >= max_in_flight.max(1)
}

/// Start-of-CPU-work to GPU-done time per frame, written by the completion
/// thread and read by status.
#[derive(Default)]
pub struct FrameLatency {
    last_us: AtomicU64,
    max_us: AtomicU64,
    sum_us: AtomicU64,
    samples: AtomicU64,
}

impl FrameLatency {
    pub fn record(&self, started: Instant) {
        let us = started.elapsed().as_micros().min(u128::from(u64::MAX)) as u64;
        self.last_us.store(us, Ordering::Relaxed);
        self.max_us.fetch_max(us, Ordering::Relaxed);
        self.sum_us.fetch_add(us, Ordering::Relaxed);
        self.samples.fetch_add(1, Ordering::Relaxed);
    }

    /// (last ms, mean ms since start, max ms, samples). Diff two reads of
    /// sum/samples for a window.
    pub fn report(&self) -> FrameLatencyReport {
        let samples = self.samples.load(Ordering::Relaxed);
        let sum_us = self.sum_us.load(Ordering::Relaxed);
        FrameLatencyReport {
            last_ms: self.last_us.load(Ordering::Relaxed) as f64 / 1000.0,
            max_ms: self.max_us.load(Ordering::Relaxed) as f64 / 1000.0,
            sum_ms: sum_us as f64 / 1000.0,
            samples,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct FrameLatencyReport {
    pub last_ms: f64,
    pub max_ms: f64,
    pub sum_ms: f64,
    pub samples: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_two_and_one_restores_the_old_gate() {
        assert_eq!(parse(None), 2);
        assert_eq!(parse(Some("")), 2);
        assert_eq!(parse(Some("two")), 2);
        assert_eq!(parse(Some("1")), 1);
        assert_eq!(parse(Some(" 2 ")), 2);
        assert_eq!(parse(Some("0")), 1);
        assert_eq!(parse(Some("9")), 3);
    }

    #[test]
    fn one_in_flight_blocks_exactly_when_the_old_check_did() {
        for submitted in 0..6u64 {
            for completed in 0..=submitted {
                assert_eq!(slots_full(submitted, completed, 1), submitted > completed);
            }
        }
    }

    #[test]
    fn two_in_flight_lets_one_frame_queue_behind_the_gpu() {
        assert!(!slots_full(0, 0, 2));
        assert!(!slots_full(1, 0, 2));
        assert!(slots_full(2, 0, 2));
        assert!(!slots_full(5, 4, 2));
        assert!(slots_full(6, 4, 2));
        // A zero setting can never stall the frame loop for good.
        assert!(slots_full(1, 0, 0));
        assert!(!slots_full(1, 1, 0));
    }
}
