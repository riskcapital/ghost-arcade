//! WLED realtime output sampled and sent by the render core.
//!
//! The editor sends a plan (`wled_configure`) for the controllers it does
//! not have to compute itself: the sample points of each controller's map,
//! its brightness, gamma, calibration, test pattern and address, and the
//! install mode's force-black. The output thread samples the program picture
//! it already captures for pixel mapping, calibrates and sends one DRGB
//! packet per controller on its own clock, with the app's rules
//! (`src/lib/wled/sender.ts`): an unchanged frame is only sent again as a
//! once-a-second keep-alive, any change goes out at once.
//!
//! Each controller has its own connected UDP socket and link state, a port
//! of `electron/wled-link.cjs`: `unknown` until frames have gone out for
//! three seconds without an error (`up`), `down` on a send error, after
//! which the socket is made again after 1 s, 2 s, 4 s, then every 5 s. The
//! main process reads the states with `wled_state` for the install health
//! log and the UI, and hands them over in both directions so a controller
//! moving between the app and the core keeps its state.

use std::io;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::colour::{self, Frame, PixelOptions, SamplingMode, TestPattern};
use super::packets::{self, WLED_MAX_LEDS};
use super::plan::parse_options;

/// An unchanged frame is sent again this often (`WLED_KEEPALIVE_MS`); WLED
/// leaves realtime mode after the two-second timeout in every packet.
pub(crate) const KEEPALIVE: Duration = Duration::from_millis(1000);
/// Frames out for this long without an error: the link is up (`confirmMs`).
pub(crate) const CONFIRM: Duration = Duration::from_millis(3000);
/// Reconnect delays after a send error (`BACKOFF_MS`).
pub(crate) const BACKOFF_MS: [u64; 4] = [1000, 2000, 4000, 5000];
const DEFAULT_FPS: u32 = 20;
const MAX_FPS: u32 = 60;
pub(crate) const MAX_CONTROLLERS: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LinkState {
    Unknown,
    Up,
    Down,
}

impl LinkState {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Up => "up",
            Self::Down => "down",
        }
    }

    fn parse(text: Option<&str>) -> Self {
        match text {
            Some("up") => Self::Up,
            Some("down") => Self::Down,
            _ => Self::Unknown,
        }
    }
}

/// A link's state as `wledLinks.list()` reports it, to carry on from.
#[derive(Clone, Debug, Default)]
pub(crate) struct LinkSeed {
    pub state: Option<String>,
    pub down_since_ms: u64,
    pub last_ok_at_ms: u64,
    pub last_error: Option<String>,
    pub errors: u64,
    pub sent: u64,
}

impl LinkSeed {
    pub(crate) fn from_json(value: &Value) -> Option<(String, Self)> {
        let id = value.get("controllerId").and_then(Value::as_str)?.to_string();
        let ms = |key: &str| value.get(key).and_then(Value::as_f64).filter(|v| v.is_finite() && *v > 0.0).map_or(0, |v| v as u64);
        Some((id, Self {
            state: value.get("state").and_then(Value::as_str).map(str::to_string),
            down_since_ms: ms("downSince"),
            last_ok_at_ms: ms("lastOkAt"),
            last_error: value.get("lastError").and_then(Value::as_str).map(str::to_string),
            errors: value.get("errors").and_then(Value::as_u64).unwrap_or(0),
            sent: value.get("sent").and_then(Value::as_u64).unwrap_or(0),
        }))
    }
}

/// Node's error code names (`err.code`), which the install log and the UI show.
fn error_code(error: &io::Error) -> String {
    if let Some(code) = error.raw_os_error() {
        #[cfg(target_os = "macos")]
        let name = match code {
            61 => Some("ECONNREFUSED"),
            54 => Some("ECONNRESET"),
            64 => Some("EHOSTDOWN"),
            65 => Some("EHOSTUNREACH"),
            51 => Some("ENETUNREACH"),
            50 => Some("ENETDOWN"),
            49 => Some("EADDRNOTAVAIL"),
            55 => Some("ENOBUFS"),
            _ => None,
        };
        #[cfg(target_os = "linux")]
        let name = match code {
            111 => Some("ECONNREFUSED"),
            104 => Some("ECONNRESET"),
            112 => Some("EHOSTDOWN"),
            113 => Some("EHOSTUNREACH"),
            101 => Some("ENETUNREACH"),
            100 => Some("ENETDOWN"),
            99 => Some("EADDRNOTAVAIL"),
            105 => Some("ENOBUFS"),
            _ => None,
        };
        #[cfg(target_os = "windows")]
        let name = match code {
            10061 => Some("ECONNREFUSED"),
            10054 => Some("ECONNRESET"),
            10064 => Some("EHOSTDOWN"),
            10065 => Some("EHOSTUNREACH"),
            10051 => Some("ENETUNREACH"),
            10050 => Some("ENETDOWN"),
            10049 => Some("EADDRNOTAVAIL"),
            10055 => Some("ENOBUFS"),
            _ => None,
        };
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        let name: Option<&str> = None;
        if let Some(name) = name {
            return name.to_string();
        }
    }
    match error.kind() {
        io::ErrorKind::ConnectionRefused => "ECONNREFUSED".to_string(),
        io::ErrorKind::ConnectionReset => "ECONNRESET".to_string(),
        io::ErrorKind::AddrNotAvailable => "EADDRNOTAVAIL".to_string(),
        _ => error.to_string(),
    }
}

/// A full send buffer: the frame is dropped (as the app drops one when two
/// are in flight), the link is not marked down for it.
fn is_backpressure(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::WouldBlock || error_code(error) == "ENOBUFS"
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Sent {
    Ok,
    Dropped,
    Reconnecting,
    Failed,
}

/// One controller's socket and state (`wled-link.cjs`).
pub(crate) struct Link {
    addr: SocketAddrV4,
    socket: Option<UdpSocket>,
    pub(crate) state: LinkState,
    pub(crate) down_since_ms: u64,
    ok_since: Option<Instant>,
    pub(crate) last_ok_at_ms: u64,
    pub(crate) last_error: Option<String>,
    pub(crate) errors: u64,
    pub(crate) sent: u64,
    attempt: usize,
    retry_at: Option<Instant>,
}

impl Link {
    pub(crate) fn new(addr: SocketAddrV4, clock: &Clock, now: Instant) -> Self {
        let mut link = Self {
            addr,
            socket: None,
            state: LinkState::Unknown,
            down_since_ms: 0,
            ok_since: None,
            last_ok_at_ms: 0,
            last_error: None,
            errors: 0,
            sent: 0,
            attempt: 0,
            retry_at: None,
        };
        link.open(clock, now);
        link
    }

    /// Carry on from the app's link: same state, no new "dropped" or
    /// "back" for what the app already reported.
    pub(crate) fn seed(&mut self, seed: &LinkSeed) {
        let state = LinkState::parse(seed.state.as_deref());
        if self.state == LinkState::Unknown {
            self.state = state;
        }
        if state == LinkState::Down && seed.down_since_ms > 0 {
            self.down_since_ms = seed.down_since_ms;
        }
        self.last_ok_at_ms = self.last_ok_at_ms.max(seed.last_ok_at_ms);
        if self.last_error.is_none() {
            self.last_error = seed.last_error.clone();
        }
        self.errors += seed.errors;
        self.sent += seed.sent;
    }

    fn open(&mut self, clock: &Clock, now: Instant) {
        self.socket = None;
        self.ok_since = None;
        let opened = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)).and_then(|socket| {
            // A full send buffer must never hold the output thread up.
            socket.set_nonblocking(true)?;
            socket.connect(self.addr)?;
            Ok(socket)
        });
        match opened {
            Ok(socket) => self.socket = Some(socket),
            Err(error) => self.mark_error(&error, clock, now),
        }
    }

    fn mark_error(&mut self, error: &io::Error, clock: &Clock, now: Instant) {
        self.errors += 1;
        self.last_error = Some(error_code(error));
        self.ok_since = None;
        self.socket = None;
        if self.state != LinkState::Down {
            self.state = LinkState::Down;
            self.down_since_ms = clock.epoch_ms(now);
            self.attempt = 0;
        }
        let delay = BACKOFF_MS[self.attempt.min(BACKOFF_MS.len() - 1)];
        self.attempt += 1;
        self.retry_at = Some(now + Duration::from_millis(delay));
    }

    fn mark_ok(&mut self, clock: &Clock, now: Instant) {
        self.sent += 1;
        self.last_ok_at_ms = clock.epoch_ms(now);
        let since = *self.ok_since.get_or_insert(now);
        if self.state != LinkState::Up && now.duration_since(since) >= CONFIRM {
            self.state = LinkState::Up;
            self.attempt = 0;
            self.down_since_ms = 0;
        }
    }

    /// Make the socket again once the backoff has passed.
    pub(crate) fn poll(&mut self, clock: &Clock, now: Instant) {
        if self.socket.is_none() && self.retry_at.is_some_and(|at| now >= at) {
            self.retry_at = None;
            self.open(clock, now);
        }
    }

    pub(crate) fn send(&mut self, packet: &[u8], clock: &Clock, now: Instant) -> Sent {
        let Some(socket) = self.socket.as_ref() else { return Sent::Reconnecting };
        // An ICMP answer to an earlier packet (nobody listening, host down)
        // is held on the socket until it is read.
        if let Ok(Some(error)) = socket.take_error() {
            if !is_backpressure(&error) {
                self.mark_error(&error, clock, now);
                return Sent::Failed;
            }
        }
        match socket.send(packet) {
            Ok(_) => {
                self.mark_ok(clock, now);
                Sent::Ok
            }
            Err(error) if is_backpressure(&error) => Sent::Dropped,
            Err(error) => {
                self.mark_error(&error, clock, now);
                Sent::Failed
            }
        }
    }

    pub(crate) fn local_port(&self) -> Option<u16> {
        self.socket.as_ref().and_then(|s| s.local_addr().ok()).map(|a| a.port())
    }
}

/// Instants as the wall-clock milliseconds the app's link states carry.
pub(crate) struct Clock {
    anchor: Instant,
    anchor_ms: u64,
}

impl Clock {
    pub(crate) fn new() -> Self {
        let anchor_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        Self { anchor: Instant::now(), anchor_ms }
    }

    pub(crate) fn epoch_ms(&self, at: Instant) -> u64 {
        match at.checked_duration_since(self.anchor) {
            Some(after) => self.anchor_ms + after.as_millis() as u64,
            None => self.anchor_ms.saturating_sub(self.anchor.duration_since(at).as_millis() as u64),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct WledController {
    pub id: String,
    pub name: String,
    pub addr: SocketAddrV4,
    pub points: Vec<[f64; 2]>,
    pub sample_radius: f64,
    pub sampling: SamplingMode,
    pub options: PixelOptions,
    pub test_pattern: TestPattern,
    pub test_color: [u8; 3],
}

impl WledController {
    fn needs_picture(&self) -> bool {
        self.test_pattern == TestPattern::Off
    }
}

#[derive(Clone, Debug)]
pub(crate) struct WledPlan {
    pub fps: u32,
    /// Install mode's off periods: every controller sends black.
    pub force_black: bool,
    pub max_dim: u32,
    pub controllers: Vec<WledController>,
}

impl WledPlan {
    pub(crate) fn needs_picture(&self) -> bool {
        !self.force_black && self.controllers.iter().any(WledController::needs_picture)
    }
}

fn parse_controller(value: &Value) -> Result<WledController, String> {
    let id = value.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("controller needs an id")?.to_string();
    let ip: Ipv4Addr = value.get("ip").and_then(Value::as_str).map(str::trim).ok_or_else(|| format!("controller {id}: needs an IPv4 address"))?
        .parse().map_err(|_| format!("controller {id}: bad IPv4 address"))?;
    if ip.is_unspecified() {
        return Err(format!("controller {id}: bad IPv4 address"));
    }
    let port = value.get("port").and_then(Value::as_u64).unwrap_or(21324);
    if !(1..=65535).contains(&port) {
        return Err("Invalid WLED UDP port".to_string());
    }
    let flat = value.get("points").and_then(Value::as_array).ok_or_else(|| format!("controller {id}: needs points"))?;
    if flat.len() % 2 != 0 || flat.is_empty() || flat.len() / 2 > WLED_MAX_LEDS {
        return Err("WLED requires 1–490 RGB LEDs per controller".to_string());
    }
    let points = flat.chunks_exact(2).map(|pair| [pair[0].as_f64().unwrap_or(0.5), pair[1].as_f64().unwrap_or(0.5)]).collect();
    Ok(WledController {
        name: value.get("name").and_then(Value::as_str).unwrap_or(&id).to_string(),
        id,
        addr: SocketAddrV4::new(ip, port as u16),
        points,
        sample_radius: value.get("sampleRadius").and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(0.0),
        sampling: SamplingMode::parse(value.get("samplingMode").and_then(Value::as_str)),
        options: parse_options(value),
        test_pattern: TestPattern::parse(value.get("testPattern").and_then(Value::as_str)),
        test_color: colour::parse_hex_color(value.get("testColor").and_then(Value::as_str)),
    })
}

pub(crate) fn parse_wled_plan(value: &Value) -> Result<WledPlan, String> {
    let fps = value.get("fps").and_then(Value::as_f64).filter(|v| v.is_finite())
        .map_or(DEFAULT_FPS, |v| (v.round() as i64).clamp(1, MAX_FPS as i64) as u32);
    let list = value.get("controllers").and_then(Value::as_array).ok_or("plan needs controllers")?;
    if list.len() > MAX_CONTROLLERS {
        return Err(format!("at most {MAX_CONTROLLERS} WLED controllers"));
    }
    let controllers = list.iter().map(parse_controller).collect::<Result<Vec<_>, _>>()?;
    for (index, controller) in controllers.iter().enumerate() {
        if controllers[..index].iter().any(|other| other.id == controller.id) {
            return Err(format!("controller {} twice", controller.id));
        }
    }
    Ok(WledPlan {
        fps,
        force_black: value.get("forceBlack").and_then(Value::as_bool) == Some(true),
        max_dim: value.get("maxDim").and_then(Value::as_f64).filter(|v| v.is_finite()).map_or(192, |v| v.round().clamp(16.0, 2048.0) as u32),
        controllers,
    })
}

struct Runtime {
    controller: WledController,
    source: Vec<u8>,
    rgb: Vec<u8>,
    previous: Vec<u8>,
    sent: Vec<u8>,
    has_source: bool,
    last_wire: Option<Instant>,
    /// Send the next frame whatever it holds (settings changed, a send failed).
    force: bool,
    link: Link,
}

/// A link as `wledLinks.list()` reports one.
fn link_json(r: &Runtime) -> Value {
    let link = &r.link;
    json!({
        "controllerId": r.controller.id,
        "name": r.controller.name,
        "ip": r.controller.addr.ip().to_string(),
        "port": r.controller.addr.port(),
        "state": link.state.name(),
        "downSince": if link.down_since_ms > 0 { json!(link.down_since_ms) } else { Value::Null },
        "lastOkAt": if link.last_ok_at_ms > 0 { json!(link.last_ok_at_ms) } else { Value::Null },
        "lastError": link.last_error,
        "errors": link.errors,
        "sent": link.sent,
        "localPort": link.local_port(),
    })
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 15) as usize] as char);
    }
    out
}

#[derive(Default)]
pub(crate) struct WledStats {
    pub ticks: u64,
    pub packets_sent: u64,
    pub packets_skipped: u64,
    pub send_errors: u64,
    pub late_ticks: u64,
    pub max_late_us: u64,
}

/// Every controller the core sends to, and its clock.
pub(crate) struct WledOutput {
    plan: Option<(u32, bool)>,
    controllers: Vec<Runtime>,
    pub(crate) next_tick: Option<Instant>,
    picture_seen: u64,
    clock: Clock,
    started: Instant,
    pub(crate) stats: WledStats,
}

impl WledOutput {
    pub(crate) fn new() -> Self {
        Self { plan: None, controllers: Vec::new(), next_tick: None, picture_seen: u64::MAX, clock: Clock::new(), started: Instant::now(), stats: WledStats::default() }
    }

    pub(crate) fn fps(&self) -> Option<u32> {
        self.plan.map(|(fps, _)| fps)
    }

    /// Take a plan. Controllers that stay keep their socket, link state and
    /// smoothing; an address change makes a fresh link, as the app does.
    /// `seeds` are the app's link states for controllers it hands over.
    /// Without a current picture (capture was off, as during install mode's
    /// black), every controller waits for a new one instead of sending what
    /// it sampled before.
    pub(crate) fn configure(&mut self, plan: WledPlan, seeds: &[(String, LinkSeed)], now: Instant, picture_current: bool) -> Value {
        let mut old = std::mem::take(&mut self.controllers);
        for controller in plan.controllers.iter().cloned() {
            let length = controller.points.len() * 3;
            let index = old.iter().position(|r| r.controller.id == controller.id);
            let mut runtime = match index.map(|i| old.swap_remove(i)) {
                Some(mut kept) if kept.controller.addr == controller.addr => {
                    if kept.rgb.len() != length {
                        kept.source = vec![0; length];
                        kept.rgb = vec![0; length];
                        kept.previous = vec![0; length];
                        kept.sent = vec![0; length];
                        kept.has_source = false;
                    }
                    kept.controller = controller;
                    kept
                }
                _ => {
                    let mut link = Link::new(controller.addr, &self.clock, now);
                    if let Some((_, seed)) = seeds.iter().find(|(id, _)| *id == controller.id) {
                        link.seed(seed);
                    }
                    Runtime {
                        controller,
                        source: vec![0; length],
                        rgb: vec![0; length],
                        previous: vec![0; length],
                        sent: vec![0; length],
                        has_source: false,
                        last_wire: None,
                        force: true,
                        link,
                    }
                }
            };
            runtime.force = true;
            if !picture_current {
                runtime.has_source = false;
            }
            self.controllers.push(runtime);
        }
        // Controllers no longer in the plan: their link states go back to the app.
        let released: Vec<Value> = old.iter().map(link_json).collect();
        // A new picture is sampled for every controller at the next tick.
        self.picture_seen = u64::MAX;
        let fps_changed = self.plan.is_none_or(|(fps, _)| fps != plan.fps);
        self.plan = Some((plan.fps, plan.force_black));
        if fps_changed || self.next_tick.is_none() {
            self.next_tick = Some(now);
        }
        json!({ "ok": true, "configured": true, "links": self.links_json(false), "released": released })
    }

    /// Stop sending (WLED goes back to its own effect after its timeout, as
    /// when the app stops) and hand the link states back.
    pub(crate) fn stop(&mut self) -> Value {
        let links = self.links_json(false);
        self.controllers.clear();
        self.plan = None;
        self.next_tick = None;
        json!({ "ok": true, "links": links })
    }

    /// One tick: sample a new picture if there is one, then compute and send
    /// every controller. `picture` is the latest program picture and its
    /// sequence number, if any arrived since output started.
    pub(crate) fn tick(&mut self, deadline: Instant, now: Instant, picture: Option<(&Frame, u64)>) {
        let Some((fps, force_black)) = self.plan else {
            self.next_tick = None;
            return;
        };
        self.stats.ticks += 1;
        let late = now.duration_since(deadline).as_micros() as u64;
        if late > 2000 {
            self.stats.late_ticks += 1;
        }
        self.stats.max_late_us = self.stats.max_late_us.max(late);
        let fresh = picture.filter(|(_, seq)| *seq != self.picture_seen);
        if let Some((frame, seq)) = fresh {
            self.picture_seen = seq;
            for runtime in self.controllers.iter_mut().filter(|r| r.controller.needs_picture()) {
                let c = &runtime.controller;
                colour::sample_points(frame, &c.points, c.sample_radius, c.sampling, &mut runtime.source);
                runtime.has_source = true;
            }
        }
        let now_ms = now.duration_since(self.started).as_secs_f64() * 1000.0;
        for runtime in self.controllers.iter_mut() {
            runtime.link.poll(&self.clock, now);
            let c = &runtime.controller;
            if force_black {
                runtime.rgb.fill(0);
            } else if c.test_pattern != TestPattern::Off {
                colour::fill_test_pattern(c.test_pattern, c.test_color, now_ms, &mut runtime.rgb, &c.options, Some(&runtime.previous));
            } else if runtime.has_source {
                colour::calibrate(&runtime.source, &mut runtime.rgb, &c.options, Some(&runtime.previous));
            } else {
                // No picture yet: send nothing rather than black or an old
                // frame; the strip holds what the app sent last.
                continue;
            }
            runtime.previous.copy_from_slice(&runtime.rgb);
            let unchanged = runtime.rgb == runtime.sent;
            if !runtime.force && unchanged && runtime.last_wire.is_some_and(|at| now.duration_since(at) < KEEPALIVE) {
                self.stats.packets_skipped += 1;
                continue;
            }
            let Ok(packet) = packets::build_wled_realtime(&runtime.rgb) else { continue };
            runtime.sent.copy_from_slice(&runtime.rgb);
            runtime.last_wire = Some(now);
            runtime.force = false;
            match runtime.link.send(&packet, &self.clock, now) {
                Sent::Ok => self.stats.packets_sent += 1,
                Sent::Failed => {
                    self.stats.send_errors += 1;
                    runtime.force = true;
                }
                Sent::Dropped | Sent::Reconnecting => runtime.force = true,
            }
        }
        let period = Duration::from_secs_f64(1.0 / fps as f64);
        let mut next = deadline + period;
        if next + period < now {
            next = now + period;
        }
        self.next_tick = Some(next);
    }

    fn links_json(&self, pixels: bool) -> Vec<Value> {
        self.controllers.iter().map(|r| {
            let mut value = link_json(r);
            if pixels {
                let test = r.controller.test_pattern != TestPattern::Off;
                value["source"] = json!(hex(if test { &r.rgb } else { &r.source }));
                value["rgb"] = json!(hex(&r.rgb));
                value["live"] = json!(r.has_source || test || self.plan.is_some_and(|(_, black)| black));
            }
            value
        }).collect()
    }

    pub(crate) fn state(&self, pixels: bool) -> Value {
        json!({
            "configured": self.plan.is_some(),
            "fps": self.fps(),
            "controllers": self.links_json(pixels),
            "ticks": self.stats.ticks,
            "packetsSent": self.stats.packets_sent,
            "packetsSkipped": self.stats.packets_skipped,
            "sendErrors": self.stats.send_errors,
            "lateTicks": self.stats.late_ticks,
            "maxLateUs": self.stats.max_late_us,
        })
    }
}
