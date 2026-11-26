//! Art-Net / sACN pixel-map output sampled and sent by the render core.
//!
//! Before this, the editor sampled the composite mirror on a page timer,
//! packed DMX universes and sent them over IPC to the Electron main process,
//! which sent the UDP: three processes and two timers between a frame and the
//! wire. Here the editor sends the fixture plan once per change
//! (`pixelmap_configure`); the core copies a small downscale of every program
//! frame into a readback buffer inside the frame's own command buffer
//! (`capture.rs`), and one output thread samples it, calibrates, packs and
//! sends on its own steady clock.
//!
//! The output thread owns everything after the GPU: the latest picture, the
//! per-fixture buffers, the socket and its rate cap, sequence numbers and
//! the black-and-terminate on stop (`output.rs`, a port of
//! `electron/pixelmap-output.cjs`). The editor path stays as the fallback.

mod capture;
pub(crate) mod colour;
pub(crate) mod output;
pub(crate) mod packets;
pub(crate) mod plan;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub(crate) use capture::Capture;
use colour::{Frame, TestPattern};
use output::{Handover, OutFrame, Output, UniverseFrame};
use plan::Plan;

/// Set while a plan needs pictures: the only thing the frame loop reads
/// when pixel-map output is off.
static CAPTURE_WANTED: AtomicBool = AtomicBool::new(false);
static CAPTURE_MAX_DIM: AtomicU32 = AtomicU32::new(384);
/// Minimum time between captures, in microseconds.
static CAPTURE_INTERVAL_US: AtomicU64 = AtomicU64::new(12_500);

pub(crate) fn capture_wanted() -> bool {
    CAPTURE_WANTED.load(Ordering::Relaxed)
}

/// A readback buffer the GPU has filled and mapped, on its way to the
/// output thread, which copies it out, unmaps it and frees the slot.
pub(crate) struct MappedFrame {
    pub buffer: wgpu::Buffer,
    pub busy: Arc<AtomicBool>,
    pub width: u32,
    pub height: u32,
    pub padded_bytes_per_row: u32,
    pub bgra: bool,
    pub ok: bool,
}

enum Msg {
    Configure(Box<Plan>, Option<Handover>, Sender<Result<Value, String>>),
    Stop { handover: bool, reply: Sender<Value> },
    State { fixture: Option<String>, reply: Sender<Value> },
    Frame(MappedFrame),
}

fn channel() -> &'static Mutex<Option<Sender<Msg>>> {
    static TX: OnceLock<Mutex<Option<Sender<Msg>>>> = OnceLock::new();
    TX.get_or_init(|| Mutex::new(None))
}

fn sender() -> Result<Sender<Msg>, String> {
    let mut guard = channel().lock().map_err(|_| "pixel-map output lock poisoned".to_string())?;
    if let Some(tx) = guard.as_ref() {
        return Ok(tx.clone());
    }
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("ghost-pixelmap-out".to_string())
        .spawn(move || Worker::new().run(rx))
        .map_err(|error| format!("failed to start the pixel-map output thread: {error}"))?;
    *guard = Some(tx.clone());
    Ok(tx)
}

/// From a GPU map callback: hand a filled buffer to the output thread.
pub(crate) fn deliver_frame(frame: MappedFrame) {
    let tx = channel().lock().ok().and_then(|guard| guard.clone());
    match tx {
        Some(tx) => {
            if let Err(mpsc::SendError(Msg::Frame(frame))) = tx.send(Msg::Frame(frame)) {
                if frame.ok {
                    frame.buffer.unmap();
                }
                frame.busy.store(false, Ordering::Release);
            }
        }
        None => {
            if frame.ok {
                frame.buffer.unmap();
            }
            frame.busy.store(false, Ordering::Release);
        }
    }
}

/// On the way out of the process: black out and terminate whatever is being
/// sent, as the app's own sender does when it stops.
pub(crate) fn shutdown() {
    let Some(tx) = channel().lock().ok().and_then(|guard| guard.clone()) else { return };
    let (reply, rx) = mpsc::channel();
    if tx.send(Msg::Stop { handover: false, reply }).is_ok() {
        let _ = rx.recv_timeout(Duration::from_millis(500));
    }
}

/// `pixelmap_configure` / `pixelmap_stop` / `pixelmap_state`.
pub(crate) fn rpc(method: &str, params: &Value) -> Result<Value, String> {
    let timeout = Duration::from_secs(2);
    match method {
        "pixelmap_configure" => {
            let plan = plan::parse_plan(params.get("plan").unwrap_or(params))?;
            let handover = params.get("handover").filter(|v| !v.is_null()).map(Handover::from_json);
            let (reply, rx) = mpsc::channel();
            sender()?.send(Msg::Configure(Box::new(plan), handover, reply)).map_err(|_| "pixel-map output thread gone".to_string())?;
            rx.recv_timeout(timeout).map_err(|_| "pixel-map output thread did not answer".to_string())?
        }
        "pixelmap_stop" => {
            let handover = params.get("handover").and_then(Value::as_bool) == Some(true);
            let Some(tx) = channel().lock().ok().and_then(|guard| guard.clone()) else {
                return Ok(json!({ "ok": true, "terminated": 0, "configured": false }));
            };
            let (reply, rx) = mpsc::channel();
            tx.send(Msg::Stop { handover, reply }).map_err(|_| "pixel-map output thread gone".to_string())?;
            rx.recv_timeout(timeout).map_err(|_| "pixel-map output thread did not answer".to_string())
        }
        "pixelmap_state" => {
            let Some(tx) = channel().lock().ok().and_then(|guard| guard.clone()) else {
                return Ok(json!({ "configured": false }));
            };
            let fixture = params.get("fixture_id").and_then(Value::as_str).map(str::to_string);
            let (reply, rx) = mpsc::channel();
            tx.send(Msg::State { fixture, reply }).map_err(|_| "pixel-map output thread gone".to_string())?;
            rx.recv_timeout(timeout).map_err(|_| "pixel-map output thread did not answer".to_string())
        }
        _ => Err(format!("unknown pixel-map method {method}")),
    }
}

struct FixtureBuffers {
    id: String,
    source: Vec<u8>,
    rgb: Vec<u8>,
    previous: Vec<u8>,
}

struct Worker {
    plan: Option<Plan>,
    buffers: Vec<FixtureBuffers>,
    output: Output,
    frame: Vec<UniverseFrame>,
    /// The latest picture, RGBA-ordered per `rgb` offsets.
    picture: Vec<u8>,
    picture_size: (usize, usize),
    picture_bgra: bool,
    has_picture: bool,
    pictures: u64,
    started: Instant,
    next_tick: Option<Instant>,
    /// Late ticks (more than 2 ms after their deadline), for the stats.
    late_ticks: u64,
    max_late_us: u64,
    priority: &'static str,
    picture_dirty: bool,
    samples: u64,
    sample_us_total: u64,
    sample_us_max: u64,
}

impl Worker {
    fn new() -> Self {
        Self {
            plan: None,
            buffers: Vec::new(),
            output: Output::new(packets::ARTNET_PORT, packets::SACN_PORT),
            frame: Vec::new(),
            picture: Vec::new(),
            picture_size: (0, 0),
            picture_bgra: false,
            has_picture: false,
            pictures: 0,
            started: Instant::now(),
            next_tick: None,
            late_ticks: 0,
            max_late_us: 0,
            priority: "normal",
            picture_dirty: false,
            samples: 0,
            sample_us_total: 0,
            sample_us_max: 0,
        }
    }

    fn run(mut self, rx: Receiver<Msg>) {
        // The class the audio mixer runs in: ordinary load and timer
        // coalescing otherwise wake a 25 ms tick several ms late.
        let priority = crate::audio_priority::raise_current_thread(Duration::from_millis(25));
        self.priority = priority.priority.label();
        loop {
            let message = match self.next_tick {
                Some(deadline) => {
                    let now = Instant::now();
                    if now >= deadline {
                        self.tick(deadline, now);
                        continue;
                    }
                    match rx.recv_timeout(deadline - now) {
                        Ok(message) => message,
                        Err(RecvTimeoutError::Timeout) => continue,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                None => match rx.recv() {
                    Ok(message) => message,
                    Err(_) => return,
                },
            };
            self.handle(message);
        }
    }

    fn handle(&mut self, message: Msg) {
        match message {
            Msg::Configure(plan, handover, reply) => {
                let _ = reply.send(Ok(self.configure(*plan, handover)));
            }
            Msg::Stop { handover, reply } => {
                let result = if handover {
                    let handed = self.output.hand_over();
                    json!({ "ok": true, "handover": handed.to_json(), "stats": self.output.stats_json(Instant::now()) })
                } else {
                    let terminated = self.output.stop();
                    json!({ "ok": true, "terminated": terminated, "stats": self.output.stats_json(Instant::now()) })
                };
                self.plan = None;
                self.buffers.clear();
                self.next_tick = None;
                self.has_picture = false;
                CAPTURE_WANTED.store(false, Ordering::Relaxed);
                let _ = reply.send(result);
            }
            Msg::State { fixture, reply } => {
                let _ = reply.send(self.state(fixture.as_deref()));
            }
            Msg::Frame(frame) => self.receive_frame(frame),
        }
    }

    fn configure(&mut self, plan: Plan, handover: Option<Handover>) -> Value {
        // Ports only change in tests; an idle output is remade for them.
        if !self.output.sending() && self.output.ports() != (plan.artnet_port, plan.sacn_port) {
            self.output = Output::new(plan.artnet_port, plan.sacn_port);
        }
        if let Some(handover) = handover.as_ref() {
            self.output.take_over(handover, &plan.sacn);
        }
        // Keep each fixture's buffers (smoothing's previous frame) when its
        // size is unchanged, as the editor path does.
        let mut old = std::mem::take(&mut self.buffers);
        for fixture in &plan.fixtures {
            let length = fixture.pixel_count() * 3;
            let buffers = match old.iter().position(|b| b.id == fixture.id && b.rgb.len() == length) {
                Some(index) => old.swap_remove(index),
                None => FixtureBuffers { id: fixture.id.clone(), source: vec![0; length], rgb: vec![0; length], previous: vec![0; length] },
            };
            self.buffers.push(buffers);
        }
        let period = Duration::from_secs_f64(1.0 / plan.fps as f64);
        CAPTURE_MAX_DIM.store(plan.max_dim, Ordering::Relaxed);
        CAPTURE_INTERVAL_US.store((period.as_micros() / 2) as u64, Ordering::Relaxed);
        CAPTURE_WANTED.store(plan.needs_picture(), Ordering::Relaxed);
        let fps_changed = self.plan.as_ref().is_none_or(|p| p.fps != plan.fps);
        self.plan = Some(plan);
        self.sample_all();
        if fps_changed || self.next_tick.is_none() {
            self.next_tick = Some(Instant::now());
        }
        json!({ "ok": true, "configured": true, "local_port": self.output.local_port() })
    }

    fn receive_frame(&mut self, frame: MappedFrame) {
        if frame.ok {
            let width = frame.width as usize;
            let height = frame.height as usize;
            let row = width * 4;
            if let Ok(mapped) = frame.buffer.get_mapped_range(..) {
                self.picture.resize(row * height, 0);
                for y in 0..height {
                    let src = y * frame.padded_bytes_per_row as usize;
                    self.picture[y * row..(y + 1) * row].copy_from_slice(&mapped[src..src + row]);
                }
                drop(mapped);
                self.picture_size = (width, height);
                self.picture_bgra = frame.bgra;
                self.has_picture = true;
                self.pictures += 1;
            }
            frame.buffer.unmap();
        }
        frame.busy.store(false, Ordering::Release);
        // Sampled at the next tick: the GPU may deliver more pictures than
        // ticks, and only the newest is sent.
        if frame.ok {
            self.picture_dirty = true;
        }
    }

    /// Sample the latest picture for every fixture that follows it.
    fn sample_all(&mut self) {
        self.picture_dirty = false;
        let Some(plan) = self.plan.as_ref() else { return };
        if !self.has_picture {
            return;
        }
        let picture = Frame {
            pixels: &self.picture,
            width: self.picture_size.0,
            height: self.picture_size.1,
            rgb: if self.picture_bgra { [2, 1, 0] } else { [0, 1, 2] },
        };
        for (fixture, buffers) in plan.fixtures.iter().zip(self.buffers.iter_mut()) {
            if fixture.needs_picture() {
                colour::sample_points(&picture, &fixture.points, fixture.sample_radius, fixture.sampling, &mut buffers.source);
            }
        }
    }

    fn tick(&mut self, deadline: Instant, now: Instant) {
        if self.plan.is_none() {
            self.next_tick = None;
            return;
        }
        if self.picture_dirty {
            let started = Instant::now();
            self.sample_all();
            let took = started.elapsed().as_micros() as u64;
            self.sample_us_max = self.sample_us_max.max(took);
            self.sample_us_total += took;
            self.samples += 1;
        }
        let Some(plan) = self.plan.as_ref() else { return };
        let late = now.duration_since(deadline).as_micros() as u64;
        if late > 2000 {
            self.late_ticks += 1;
        }
        self.max_late_us = self.max_late_us.max(late);
        let now_ms = now.duration_since(self.started).as_secs_f64() * 1000.0;
        for (fixture, buffers) in plan.fixtures.iter().zip(self.buffers.iter_mut()) {
            if fixture.test_pattern != TestPattern::Off {
                colour::fill_test_pattern(fixture.test_pattern, fixture.test_color, now_ms, &mut buffers.rgb, &fixture.options, Some(&buffers.previous));
            } else {
                colour::calibrate(&buffers.source, &mut buffers.rgb, &fixture.options, Some(&buffers.previous));
            }
            buffers.previous.copy_from_slice(&buffers.rgb);
        }
        let rgb: Vec<&[u8]> = self.buffers.iter().map(|b| b.rgb.as_slice()).collect();
        plan::pack(plan, &rgb, &mut self.frame);
        let out = OutFrame { fps: plan.fps, art_sync: plan.art_sync, sacn: &plan.sacn, universes: &self.frame };
        // The rate cap counts on the tick clock: deadlines are exactly one
        // period apart, so a tick woken late never makes the next look early.
        let _ = self.output.send_frame(&out, deadline);
        // Absolute deadlines, so a late tick does not push every later one.
        let period = Duration::from_secs_f64(1.0 / plan.fps as f64);
        let mut next = deadline + period;
        if next + period < now {
            next = now + period;
        }
        self.next_tick = Some(next);
    }

    fn state(&mut self, fixture: Option<&str>) -> Value {
        let mut value = json!({
            "configured": self.plan.is_some(),
            "stats": self.output.stats_json(Instant::now()),
            "local_port": self.output.local_port(),
            "pictures": self.pictures,
            "picture_width": self.picture_size.0,
            "picture_height": self.picture_size.1,
            "late_ticks": self.late_ticks,
            "max_late_us": self.max_late_us,
            "thread_priority": self.priority,
            "sample_us_avg": self.sample_us_total.checked_div(self.samples).unwrap_or(0),
            "sample_us_max": self.sample_us_max,
        });
        if let Some(id) = fixture
            && let Some(buffers) = self.buffers.iter().find(|b| b.id == id)
        {
            value["fixture_id"] = json!(id);
            value["fixture_rgb"] = json!(buffers.rgb);
        }
        value
    }
}
