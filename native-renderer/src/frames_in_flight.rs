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
//! A second frame only helps when the GPU alone fits the frame budget but
//! CPU + GPU does not. When the GPU alone is over budget it adds a frame of
//! latency for no frame rate, so `AdaptiveGate` allows it only in the first
//! case and otherwise keeps the old one-at-a-time behaviour.
//! `GA_CORE_MAX_FRAMES_IN_FLIGHT` is the cap; 1 restores the old behaviour
//! exactly, without a rebuild.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
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
    /// Completed frames the frame loop has not looked at yet.
    pending: Mutex<VecDeque<GpuFrameSample>>,
}

/// What one completed frame says about the GPU.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GpuFrameSample {
    /// The frame was fully submitted before the previous one finished, so
    /// the GPU went straight from one to the other.
    pub queued: bool,
    /// Previous completion to this one. When `queued` this is exactly the
    /// GPU time of this frame (plus any decode upload between frames).
    pub interval_ms: f64,
    /// Last submit of the frame to its completion: GPU work still left once
    /// the CPU was done. Never more than the frame's GPU time when not queued.
    pub tail_ms: f64,
    /// Start of the frame's CPU work to its completion.
    pub latency_ms: f64,
}

const PENDING_SAMPLES_CAP: usize = 128;

impl FrameLatency {
    /// Completion thread: frame done at `done`; `previous_done` is when the
    /// frame before it finished.
    pub fn record_completion(&self, started: Instant, submitted: Instant, done: Instant, previous_done: Option<Instant>) {
        let ms = |later: Instant, earlier: Instant| later.saturating_duration_since(earlier).as_secs_f64() * 1000.0;
        let queued = previous_done.is_some_and(|previous| submitted <= previous);
        let sample = GpuFrameSample {
            queued,
            interval_ms: previous_done.map_or(0.0, |previous| ms(done, previous)),
            tail_ms: ms(done, submitted),
            latency_ms: ms(done, started),
        };
        if let Ok(mut pending) = self.pending.lock() {
            if pending.len() >= PENDING_SAMPLES_CAP {
                pending.pop_front();
            }
            pending.push_back(sample);
        }
        self.record_us(done.saturating_duration_since(started).as_micros().min(u128::from(u64::MAX)) as u64);
    }

    /// Frame loop: every completion since the last call, oldest first.
    pub fn take_samples(&self) -> Vec<GpuFrameSample> {
        self.pending.lock().map(|mut pending| pending.drain(..).collect()).unwrap_or_default()
    }

    fn record_us(&self, us: u64) {
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


/// Decides, frame by frame, whether a second frame may be in flight.
///
/// Starts at one. Allows the cap only once one-at-a-time frames run clearly
/// over budget (latency, CPU start to GPU done, 5% over the frame period)
/// while the GPU work left after the CPU is done stays well inside it (tail
/// under 85%): then CPU and GPU can overlap and the GPU still keeps up.
/// With frames overlapping, a queued frame's completion interval is its exact
/// GPU time; when most recent queued frames take 95% of the budget or more the
/// GPU is saturated, and the gate drops back to one, remembering the tail it
/// promoted at. It goes up again only once the tail is clearly (15%) below
/// that, or the frame budget changes, so it does not flap on a steady scene.
///
/// A GPU-bound scene whose tail is already over 85% of the budget never gets
/// a second frame at all: it runs exactly as with the cap at one.
#[derive(Clone, Debug)]
pub struct AdaptiveGate {
    cap: u64,
    allowed: u64,
    budget_ms: f64,
    latency_ema_ms: f64,
    tail_ema_ms: f64,
    saturation_score: f64,
    samples_since_change: u32,
    latched_tail_ms: Option<f64>,
    saturations: u64,
}

const EMA: f64 = 0.1;
const OVER_BUDGET: f64 = 1.05;
const TAIL_HEADROOM: f64 = 0.85;
const SATURATED: f64 = 0.95;
const SATURATION_SCORE_DECAY: f64 = 0.8;
const SATURATION_SCORE_TRIP: f64 = 0.6;
const RELATCH_MARGIN: f64 = 0.85;
const MIN_SAMPLES: u32 = 16;

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct AdaptiveGateReport {
    pub cap: u64,
    pub allowed: u64,
    pub budget_ms: f64,
    pub latency_ema_ms: f64,
    pub tail_ema_ms: f64,
    pub latched_tail_ms: Option<f64>,
    pub saturations: u64,
}

impl AdaptiveGate {
    pub fn new(cap: u64) -> Self {
        Self {
            cap: cap.max(1),
            allowed: 1,
            budget_ms: 0.0,
            latency_ema_ms: 0.0,
            tail_ema_ms: 0.0,
            saturation_score: 0.0,
            samples_since_change: 0,
            latched_tail_ms: None,
            saturations: 0,
        }
    }

    pub fn allowed(&self) -> u64 {
        self.allowed
    }

    pub fn report(&self) -> AdaptiveGateReport {
        AdaptiveGateReport {
            cap: self.cap,
            allowed: self.allowed,
            budget_ms: self.budget_ms,
            latency_ema_ms: self.latency_ema_ms,
            tail_ema_ms: self.tail_ema_ms,
            latched_tail_ms: self.latched_tail_ms,
            saturations: self.saturations,
        }
    }

    /// Hold one frame at a time now, even with no new completion to look at.
    pub fn observe_force_single(&mut self) {
        if self.allowed != 1 {
            self.allowed = 1;
            self.samples_since_change = 0;
        }
    }

    /// `force_single`: something reads the frame right behind its completion
    /// (the Windows recorder), so no second frame may follow it closely.
    pub fn observe(&mut self, sample: GpuFrameSample, budget_ms: f64, force_single: bool) {
        if self.cap <= 1 {
            self.allowed = 1;
            return;
        }
        if budget_ms.is_finite() && budget_ms > 0.0
            && (self.budget_ms <= 0.0 || (budget_ms - self.budget_ms).abs() > self.budget_ms * 0.05)
        {
            self.budget_ms = budget_ms;
            self.latched_tail_ms = None;
            self.samples_since_change = 0;
        }
        let ema = |old: f64, new: f64| if old <= 0.0 { new } else { old * (1.0 - EMA) + new * EMA };
        self.samples_since_change = self.samples_since_change.saturating_add(1);
        if !sample.queued {
            // Only an unqueued frame's numbers mean what they say: a queued
            // frame also waited for the one ahead of it.
            self.latency_ema_ms = ema(self.latency_ema_ms, sample.latency_ms);
            self.tail_ema_ms = ema(self.tail_ema_ms, sample.tail_ms);
        }
        if force_single || self.budget_ms <= 0.0 {
            if self.allowed != 1 {
                self.allowed = 1;
                self.samples_since_change = 0;
            }
            return;
        }
        let budget = self.budget_ms;
        if self.allowed > 1 {
            let saturated = sample.queued && sample.interval_ms >= budget * SATURATED;
            self.saturation_score = self.saturation_score * SATURATION_SCORE_DECAY
                + if saturated { 1.0 - SATURATION_SCORE_DECAY } else { 0.0 };
            if self.saturation_score >= SATURATION_SCORE_TRIP {
                self.allowed = 1;
                self.saturation_score = 0.0;
                self.samples_since_change = 0;
                self.saturations = self.saturations.saturating_add(1);
                self.latched_tail_ms = Some(self.tail_ema_ms);
            }
            return;
        }
        let over_budget = self.latency_ema_ms >= budget * OVER_BUDGET;
        let gpu_has_room = self.tail_ema_ms < budget * TAIL_HEADROOM;
        let below_latch = self.latched_tail_ms.is_none_or(|tail| self.tail_ema_ms < tail * RELATCH_MARGIN);
        if self.samples_since_change >= MIN_SAMPLES && over_budget && gpu_has_room && below_latch {
            self.allowed = self.cap;
            self.saturation_score = 0.0;
            self.samples_since_change = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(queued: bool, interval_ms: f64, tail_ms: f64, latency_ms: f64) -> GpuFrameSample {
        GpuFrameSample { queued, interval_ms, tail_ms, latency_ms }
    }

    const BUDGET: f64 = 1000.0 / 60.0;

    #[test]
    fn a_gpu_bound_scene_never_gets_a_second_frame() {
        let mut gate = AdaptiveGate::new(2);
        for _ in 0..1000 {
            // 58 ms of GPU, 2 ms of CPU.
            gate.observe(frame(false, 60.0, 57.0, 60.0), BUDGET, false);
            assert_eq!(gate.allowed(), 1);
        }
    }

    #[test]
    fn cpu_plus_gpu_over_budget_with_gpu_room_gets_two() {
        let mut gate = AdaptiveGate::new(2);
        for _ in 0..MIN_SAMPLES { gate.observe(frame(false, 18.5, 12.0, 18.0), BUDGET, false); }
        assert_eq!(gate.allowed(), 2);
        // Overlapped and keeping up: an occasional queued frame inside budget.
        for i in 0..1000 { gate.observe(frame(i % 5 == 0, 13.0, 12.0, 15.0), BUDGET, false); }
        assert_eq!(gate.allowed(), 2);
    }

    #[test]
    fn a_frame_that_fits_or_only_just_misses_stays_at_one() {
        let mut gate = AdaptiveGate::new(2);
        for _ in 0..1000 { gate.observe(frame(false, 16.7, 8.0, 11.0), BUDGET, false); }
        assert_eq!(gate.allowed(), 1);
        // At the budget a second frame buys a frame a second for more latency.
        for _ in 0..1000 { gate.observe(frame(false, 16.9, 12.0, 16.9), BUDGET, false); }
        assert_eq!(gate.allowed(), 1);
    }

    #[test]
    fn saturation_drops_to_one_and_does_not_flap() {
        let mut gate = AdaptiveGate::new(2);
        // Tail looks small (GPU work ran while the CPU encoded) but the GPU
        // is really 19 ms a frame.
        for _ in 0..MIN_SAMPLES { gate.observe(frame(false, 23.0, 12.0, 23.0), BUDGET, false); }
        assert_eq!(gate.allowed(), 2);
        for _ in 0..10 { gate.observe(frame(true, 19.0, 30.0, 38.0), BUDGET, false); }
        assert_eq!(gate.allowed(), 1);
        for _ in 0..1000 {
            gate.observe(frame(false, 23.0, 12.0, 23.0), BUDGET, false);
            assert_eq!(gate.allowed(), 1, "flapped back up on the same scene");
        }
        // A lighter scene earns it back; so does a new frame budget.
        for _ in 0..200 { gate.observe(frame(false, 20.0, 8.0, 18.0), BUDGET, false); }
        assert_eq!(gate.allowed(), 2);
    }

    #[test]
    fn cap_one_and_force_single_hold_one() {
        let mut gate = AdaptiveGate::new(1);
        for _ in 0..100 { gate.observe(frame(false, 18.5, 12.0, 18.0), BUDGET, false); }
        assert_eq!(gate.allowed(), 1);
        let mut gate = AdaptiveGate::new(2);
        for _ in 0..MIN_SAMPLES { gate.observe(frame(false, 18.5, 12.0, 18.0), BUDGET, false); }
        assert_eq!(gate.allowed(), 2);
        gate.observe(frame(false, 18.5, 12.0, 18.0), BUDGET, true);
        assert_eq!(gate.allowed(), 1);
    }

    #[test]
    fn a_queued_frame_is_one_submitted_before_the_previous_finished() {
        let latency = FrameLatency::default();
        let t0 = Instant::now();
        let ms = |n: u64| t0 + std::time::Duration::from_millis(n);
        latency.record_completion(ms(0), ms(4), ms(20), None);
        latency.record_completion(ms(17), ms(19), ms(38), Some(ms(20)));
        latency.record_completion(ms(40), ms(44), ms(58), Some(ms(38)));
        let samples = latency.take_samples();
        assert_eq!(samples.len(), 3);
        assert!(!samples[0].queued);
        assert!(samples[1].queued);
        assert!((samples[1].interval_ms - 18.0).abs() < 1e-6);
        assert!(!samples[2].queued);
        assert!((samples[2].tail_ms - 14.0).abs() < 1e-6);
        assert!(latency.take_samples().is_empty());
    }

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
