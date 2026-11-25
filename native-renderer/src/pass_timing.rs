//! Opt-in GPU time of each pass the core draws.
//!
//! `GA_CORE_PASS_TIMING=1` (and a GPU with timestamp queries) puts a begin
//! and end timestamp on each instrumented pass. The frame's timestamps are
//! resolved in its last encoder and read back without waiting; while one
//! readback is in flight, frames are not timed. The status then carries
//! `gpu_pass_timing`: per pass name, the average GPU milliseconds and how
//! many times timed frames ran it (running totals), plus the timed frames' total pass time.
//! Off (the default) `slot` is one flag check and nothing is recorded.

use serde::Serialize;
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::mpsc::{self, Receiver},
    sync::OnceLock,
};

const CAPACITY: u32 = 1024;

struct Timer {
    query_set: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    readback: wgpu::Buffer,
    period_ns: f64,
    /// Recording this frame (no readback pending at its start).
    active: bool,
    next: u32,
    labels: Vec<String>,
    pending: Option<(Vec<String>, Receiver<Result<(), wgpu::BufferAsyncError>>)>,
    stats: HashMap<String, (f64, u64)>,
    frames: u64,
    total_ms: f64,
}

static ENABLED: OnceLock<bool> = OnceLock::new();

fn enabled() -> bool {
    *ENABLED.get_or_init(|| std::env::var("GA_CORE_PASS_TIMING").is_ok_and(|v| v == "1"))
}

thread_local! {
    static TIMER: RefCell<Option<Timer>> = const { RefCell::new(None) };
}

/// Set up once the device exists (only when switched on and supported).
pub fn init(device: &wgpu::Device, queue: &wgpu::Queue) {
    if !enabled() || !device.features().contains(wgpu::Features::TIMESTAMP_QUERY) {
        return;
    }
    let bytes = u64::from(CAPACITY) * 8;
    let timer = Timer {
        query_set: device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("Ghost Pass Timing Queries"),
            ty: wgpu::QueryType::Timestamp,
            count: CAPACITY,
        }),
        resolve: device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Pass Timing Resolve"),
            size: bytes,
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        }),
        readback: device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Pass Timing Readback"),
            size: bytes,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        }),
        period_ns: queue.get_timestamp_period() as f64,
        active: false,
        next: 0,
        labels: Vec::new(),
        pending: None,
        stats: HashMap::new(),
        frames: 0,
        total_ms: 0.0,
    };
    TIMER.with(|cell| *cell.borrow_mut() = Some(timer));
}

/// Start a frame: collect a finished readback, and time this frame when none is pending.
pub fn begin_frame() {
    TIMER.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some(timer) = guard.as_mut() else { return };
        if let Some((labels, rx)) = timer.pending.take() {
            match rx.try_recv() {
                Ok(Ok(())) => {
                    if let Ok(data) = timer.readback.slice(..).get_mapped_range() {
                        let stamps: Vec<u64> = data
                            .chunks_exact(8)
                            .take(labels.len() * 2)
                            .map(|chunk| u64::from_le_bytes(chunk.try_into().unwrap()))
                            .collect();
                        let mut frame_ms = 0.0;
                        for (index, label) in labels.iter().enumerate() {
                            let (start, end) = (stamps[index * 2], stamps[index * 2 + 1]);
                            if end <= start {
                                continue;
                            }
                            let ms = (end - start) as f64 * timer.period_ns / 1.0e6;
                            frame_ms += ms;
                            let entry = timer.stats.entry(label.clone()).or_default();
                            entry.0 += ms;
                            entry.1 += 1;
                        }
                        timer.frames += 1;
                        timer.total_ms += frame_ms;
                    }
                    timer.readback.unmap();
                }
                Ok(Err(_)) => timer.readback.unmap(),
                Err(mpsc::TryRecvError::Empty) => {
                    timer.pending = Some((labels, rx));
                }
                Err(mpsc::TryRecvError::Disconnected) => {}
            }
        }
        timer.active = timer.pending.is_none();
        timer.next = 0;
        timer.labels.clear();
    });
}

/// Timestamp indices for one pass named `label`: (query set, begin index).
pub fn slot(label: &str) -> Option<(wgpu::QuerySet, u32)> {
    if !enabled() {
        return None;
    }
    TIMER.with(|cell| {
        let mut guard = cell.borrow_mut();
        let timer = guard.as_mut()?;
        if !timer.active || timer.next + 2 > CAPACITY {
            return None;
        }
        let index = timer.next;
        timer.next += 2;
        timer.labels.push(label.to_string());
        Some((timer.query_set.clone(), index))
    })
}

pub fn render_writes(slot: &Option<(wgpu::QuerySet, u32)>) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
    slot.as_ref().map(|(set, index)| wgpu::RenderPassTimestampWrites {
        query_set: set,
        beginning_of_pass_write_index: Some(*index),
        end_of_pass_write_index: Some(index + 1),
    })
}

pub fn compute_writes(slot: &Option<(wgpu::QuerySet, u32)>) -> Option<wgpu::ComputePassTimestampWrites<'_>> {
    slot.as_ref().map(|(set, index)| wgpu::ComputePassTimestampWrites {
        query_set: set,
        beginning_of_pass_write_index: Some(*index),
        end_of_pass_write_index: Some(index + 1),
    })
}

/// In the frame's last encoder: copy this frame's timestamps out. Passes
/// after this are not timed.
pub fn resolve(encoder: &mut wgpu::CommandEncoder) {
    TIMER.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some(timer) = guard.as_mut() else { return };
        if !timer.active || timer.next == 0 {
            timer.active = false;
            return;
        }
        encoder.resolve_query_set(&timer.query_set, 0..timer.next, &timer.resolve, 0);
        encoder.copy_buffer_to_buffer(&timer.resolve, 0, &timer.readback, 0, u64::from(timer.next) * 8);
    });
}

/// After the frame's last submit: start reading its timestamps back.
pub fn after_submit() {
    TIMER.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some(timer) = guard.as_mut() else { return };
        if !timer.active || timer.next == 0 {
            timer.active = false;
            return;
        }
        timer.active = false;
        let (tx, rx) = mpsc::channel();
        timer.readback.slice(..).map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        timer.pending = Some((std::mem::take(&mut timer.labels), rx));
    });
}

/// Running totals since start, per pass name: [sum of GPU ms, times run].
/// Diff two reads for a window.
#[derive(Clone, Debug, Serialize)]
pub struct PassTimingReport {
    pub frames: u64,
    pub total_ms: f64,
    pub passes: HashMap<String, (f64, u64)>,
}

pub fn report() -> Option<PassTimingReport> {
    TIMER.with(|cell| {
        let guard = cell.borrow();
        let timer = guard.as_ref()?;
        Some(PassTimingReport { frames: timer.frames, total_ms: timer.total_ms, passes: timer.stats.clone() })
    })
}
