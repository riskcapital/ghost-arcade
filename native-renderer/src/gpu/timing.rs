//! GPU timestamps, frames in flight and submission.

use crate::*;

pub(crate) const GPU_TIMESTAMP_READ_BYTES: u64 = 16;

pub(crate) struct GpuTimingState {
    pub(crate) query_set: wgpu::QuerySet,
    pub(crate) resolve_buffer: wgpu::Buffer,
    pub(crate) readback_buffer: wgpu::Buffer,
    pub(crate) timestamp_period_ns: f64,
    pub(crate) map_done_tx: Sender<Result<(), String>>,
    pub(crate) map_done_rx: Receiver<Result<(), String>>,
    pub(crate) map_pending: bool,
    pub(crate) last_render_gpu_ms: f64,
    pub(crate) sampled_at_ms: u128,
    pub(crate) avg_render_gpu_ms: f64,
    pub(crate) max_render_gpu_ms: f64,
    pub(crate) samples: u64,
    pub(crate) resolve_misses: u64,
    pub(crate) inside_encoders: bool,
}

impl GpuTimingState {
    pub(crate) fn new(device: &wgpu::Device, queue: &wgpu::Queue, inside_encoders: bool) -> Self {
        let query_set = device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Queries"),
            ty: wgpu::QueryType::Timestamp,
            count: 2,
        });
        let resolve_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Resolve"),
            size: wgpu::QUERY_RESOLVE_BUFFER_ALIGNMENT.max(GPU_TIMESTAMP_READ_BYTES),
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Readback"),
            size: GPU_TIMESTAMP_READ_BYTES,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let (map_done_tx, map_done_rx) = mpsc::channel();
        Self {
            query_set,
            resolve_buffer,
            readback_buffer,
            timestamp_period_ns: queue.get_timestamp_period() as f64,
            map_done_tx,
            map_done_rx,
            map_pending: false,
            last_render_gpu_ms: 0.0,
            sampled_at_ms: 0,
            avg_render_gpu_ms: 0.0,
            max_render_gpu_ms: 0.0,
            samples: 0,
            resolve_misses: 0,
            inside_encoders,
        }
    }

    pub(crate) fn timestamp_writes(&self) -> wgpu::RenderPassTimestampWrites<'_> {
        wgpu::RenderPassTimestampWrites {
            query_set: &self.query_set,
            beginning_of_pass_write_index: Some(0),
            end_of_pass_write_index: Some(1),
        }
    }

    pub(crate) fn can_record(&self) -> bool {
        !self.map_pending
    }

    pub(crate) fn resolve_to_readback(&self, encoder: &mut wgpu::CommandEncoder) {
        encoder.resolve_query_set(&self.query_set, 0..2, &self.resolve_buffer, 0);
        encoder.copy_buffer_to_buffer(
            &self.resolve_buffer,
            0,
            &self.readback_buffer,
            0,
            GPU_TIMESTAMP_READ_BYTES,
        );
    }

    pub(crate) fn begin_readback(&mut self) {
        if self.map_pending {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        self.map_pending = true;
        let tx = self.map_done_tx.clone();
        self.readback_buffer
            .slice(0..GPU_TIMESTAMP_READ_BYTES)
            .map_async(wgpu::MapMode::Read, move |result| {
                let _ = tx.send(result.map_err(|err| err.to_string()));
            });
    }

    pub(crate) fn poll_readback(&mut self) {
        if !self.map_pending {
            return;
        }
        let Ok(result) = self.map_done_rx.try_recv() else {
            return;
        };
        self.map_pending = false;
        if result.is_err() {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }

        let slice = self.readback_buffer.slice(0..GPU_TIMESTAMP_READ_BYTES);
        let Ok(mapped) = slice.get_mapped_range() else {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            self.readback_buffer.unmap();
            return;
        };
        let mut start_bytes = [0_u8; 8];
        let mut end_bytes = [0_u8; 8];
        start_bytes.copy_from_slice(&mapped[0..8]);
        end_bytes.copy_from_slice(&mapped[8..16]);
        drop(mapped);
        self.readback_buffer.unmap();

        let start = u64::from_le_bytes(start_bytes);
        let end = u64::from_le_bytes(end_bytes);
        if end <= start {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        let gpu_ms = ((end - start) as f64 * self.timestamp_period_ns) / 1_000_000.0;
        if !gpu_ms.is_finite() || gpu_ms <= 0.0 {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        self.last_render_gpu_ms = gpu_ms;
        self.sampled_at_ms = epoch_ms();
        self.avg_render_gpu_ms = if self.avg_render_gpu_ms <= 0.0 {
            gpu_ms
        } else {
            self.avg_render_gpu_ms * 0.94 + gpu_ms * 0.06
        };
        self.max_render_gpu_ms = self.max_render_gpu_ms.max(gpu_ms);
        self.samples = self.samples.saturating_add(1);
    }
}

pub(crate) fn completed_gpu_frame_schedule(last: Instant, now: Instant, period: Duration, retry: bool) -> Option<Instant> {
    let deadline = last + period;
    if now >= deadline { Some(scheduled_frame_start(deadline, now, period)) }
    // The missed slot was already charged when render() hit backpressure.
    // Retry it as soon as the GPU is free, without consuming the next slot.
    else if retry { Some(last) }
    else { None }
}

pub(crate) fn wait_for_gpu_map(device: &wgpu::Device, rx: &Receiver<Result<(), String>>) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        device.poll(wgpu::PollType::Poll).map_err(|error| error.to_string())?;
        match rx.recv_timeout(Duration::from_millis(2)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {}
            Err(_) => return Err("GPU mapping timed out or disconnected".to_string()),
        }
    }
}

impl RenderState {
    pub(crate) fn poll_gpu_timing(&mut self) {
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(gpu_timing) = self.gpu_timing.as_mut() {
            gpu_timing.poll_readback();
        }
        self.poll_graph_readbacks();
    }

    pub(crate) fn gpu_frames_completed(&self) -> u64 {
        self.gpu_frames_completed.load(Ordering::Acquire)
    }

    /// No room for another frame: the GPU still has as many of ours queued
    /// as the gate allows now. At 1 this is the old "any frame in flight" gate.
    pub(crate) fn frame_in_flight(&self) -> bool {
        frames_in_flight::slots_full(self.gpu_frames_submitted, self.gpu_frames_completed(), self.frames_in_flight.allowed())
    }

    /// The GPU has finished every frame we sent: a frame encoded now starts
    /// on an idle GPU, so its timestamps measure its own work only.
    pub(crate) fn gpu_idle_for_frame(&self) -> bool {
        self.gpu_frames_submitted == self.gpu_frames_completed()
    }

    /// Feed completed frames to the frames-in-flight gate.
    pub(crate) fn update_frames_in_flight(&mut self, budget: Duration) {
        // The Windows recorder no longer needs one frame at a time: the next
        // frame's GPU work waits (on the GPU) for the encoder to have read
        // the export (windows_video_encoder.rs).
        let budget_ms = budget.as_secs_f64() * 1000.0;
        for sample in self.gpu_frame_latency.take_samples() {
            self.frames_in_flight.observe(sample, budget_ms);
        }
    }

    pub(crate) fn submit_frame(&mut self, encoder: wgpu::CommandEncoder) {
        self.frame_submission = Some(churn_probe::submit(&self.queue, Some(encoder.finish())));
    }

    /// The encoder deck monitors, Screens, the dome view and the record
    /// target record into after the program, sent once in `finish_frame`.
    /// Put it back in `outputs_encoder` when done.
    pub(crate) fn take_outputs_encoder(&mut self) -> wgpu::CommandEncoder {
        self.outputs_encoder.take().unwrap_or_else(|| {
            self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Outputs Encoder"),
            })
        })
    }

    /// Send what the outputs encoder holds, then present the Screens it drew
    /// (Linux). None when it held nothing.
    pub(crate) fn submit_outputs(&mut self) -> Option<wgpu::SubmissionIndex> {
        let encoder = self.outputs_encoder.take()?;
        let submission = churn_probe::submit(&self.queue, Some(encoder.finish()));
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        for frame in self.pending_slice_presents.drain(..) {
            self.queue.present(frame);
        }
        self.frame_submission = Some(submission.clone());
        Some(submission)
    }

    pub(crate) fn finish_frame(&mut self, frame_started: Instant) {
        self.frame_uniform_pool.truncate(self.frame_uniform_cursor);
        self.prune_composite_views();
        if let Some(cache) = self.disk_pipeline_cache.as_mut() {
            cache.maybe_save(Instant::now());
        }
        // Fence after program, confidence monitors and slices, not just
        // program: the outputs' submit is the frame's last, or else the
        // program's, when nothing was sent after it.
        let submission = self.submit_outputs()
            .or_else(|| self.frame_submission.take())
            .unwrap_or_else(|| churn_probe::submit(&self.queue, std::iter::empty()));
        self.frame_submission = None;
        self.slice_shares_submitted();
        self.gpu_frames_submitted = self.gpu_frames_submitted.saturating_add(1);
        let _ = self.gpu_completion_tx.send((submission, frame_started, Instant::now()));
        if self.test_device_loss.as_ref().is_some_and(|loss| loss.due(self.gpu_frames_submitted)) {
            if let Some(loss) = self.test_device_loss.take() {
                eprintln!("[ghost-core] TEST: destroying the GPU device after {} frames ({TEST_DEVICE_LOSS_ENV})", loss.after_frames);
                loss.fired.store(true, Ordering::Release);
                self.device.destroy();
            }
        }
    }

    pub(crate) fn last_render_gpu_ms(&self) -> Option<f64> {
        self.gpu_timing.as_ref().and_then(|timing| {
            (timing.last_render_gpu_ms > 0.0 && epoch_ms().saturating_sub(timing.sampled_at_ms) < 1000).then_some(timing.last_render_gpu_ms)
        })
    }

    pub(crate) fn gpu_timing_stats(&self) -> (bool, f64, f64, f64, u64, u64) {
        self.gpu_timing
            .as_ref()
            .map(|timing| {
                (
                    true,
                    timing.last_render_gpu_ms,
                    timing.avg_render_gpu_ms,
                    timing.max_render_gpu_ms,
                    timing.samples,
                    timing.resolve_misses,
                )
            })
            .unwrap_or((false, 0.0, 0.0, 0.0, 0, 0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_completion_retries_a_blocked_slot_without_skipping_the_next_one() {
        use std::time::{Duration, Instant};
        let start = Instant::now();
        let period = Duration::from_millis(16);
        let blocked_slot = start + period;
        assert_eq!(super::completed_gpu_frame_schedule(blocked_slot, start + Duration::from_millis(18), period, true), Some(blocked_slot));
        assert_eq!(super::completed_gpu_frame_schedule(blocked_slot, start + Duration::from_millis(22), period, false), None);
        assert_eq!(super::completed_gpu_frame_schedule(blocked_slot, start + period * 2, period, false), Some(start + period * 2));
        let stalled = start + period * 10;
        assert_eq!(super::completed_gpu_frame_schedule(blocked_slot, stalled, period, true), Some(stalled));
    }
}
