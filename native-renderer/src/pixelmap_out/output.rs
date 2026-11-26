//! The UDP side of Art-Net / sACN output: a port of
//! `electron/pixelmap-output.cjs` (rate cap, per-universe sequence numbers,
//! black frame and sACN Stream_Terminated for a universe that goes away and
//! for every universe on stop, ArtSync, counters).
//!
//! Sends are synchronous on one socket: a UDP send only queues a datagram in
//! the kernel, so there is never a backlog to drop "busy" frames for. A send
//! the kernel refuses (buffer full, no route) is counted as a send error.

use std::collections::{HashMap, VecDeque};
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::packets::{self, E131Options};

const RATE_BURST: f64 = 2.0;
const SACN_TERMINATION_PACKETS: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Protocol {
    ArtNet,
    Sacn,
}

impl Protocol {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::ArtNet => "artnet",
            Self::Sacn => "sacn",
        }
    }
}

/// One universe of a frame, as `normalizeFrame` leaves it.
#[derive(Clone, Debug)]
pub(crate) struct UniverseFrame {
    pub key: String,
    pub protocol: Protocol,
    /// None: sACN multicast.
    pub host: Option<Ipv4Addr>,
    pub universe: u32,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct SacnSettings {
    pub priority: u8,
    pub source_name: [u8; 64],
    pub cid: [u8; 16],
}

pub(crate) struct OutFrame<'a> {
    pub fps: u32,
    pub art_sync: bool,
    pub sacn: &'a SacnSettings,
    pub universes: &'a [UniverseFrame],
}

#[derive(Clone, Debug)]
struct Target {
    key: String,
    protocol: Protocol,
    host: Option<Ipv4Addr>,
    universe: u32,
    length: usize,
    sacn: SacnSettings,
}

#[derive(Default, Clone, Debug)]
pub(crate) struct Stats {
    pub frames_sent: u64,
    pub packets_sent: u64,
    pub frames_dropped: u64,
    pub dropped_busy: u64,
    pub dropped_rate: u64,
    pub send_errors: u64,
    pub last_error: Option<String>,
}

pub(crate) struct Output {
    socket: Option<UdpSocket>,
    /// Kept after stop(), like the JS module, for DMX input's self-filter.
    bound_port: Option<u16>,
    artnet_port: u16,
    sacn_port: u16,
    last_frame_at: Option<Instant>,
    rate_credit: f64,
    sequences: HashMap<String, u8>,
    active: Vec<Target>,
    art_sync_active: bool,
    recent_frames: VecDeque<Instant>,
    pub(crate) stats: Stats,
}

/// What another sender needs to carry on without a black frame or a jump in
/// sequence numbers (handing output between the editor and the core).
#[derive(Clone, Debug, Default)]
pub(crate) struct Handover {
    pub sequences: Vec<(String, u8)>,
    pub active: Vec<(String, Protocol, Option<Ipv4Addr>, u32, usize)>,
}

impl Handover {
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "sequences": self.sequences.iter().map(|(key, seq)| json!([key, seq])).collect::<Vec<_>>(),
            "active": self.active.iter().map(|(key, protocol, host, universe, length)| json!({
                "key": key,
                "protocol": protocol.name(),
                "host": host.map(|h| h.to_string()),
                "universe": universe,
                "length": length,
            })).collect::<Vec<_>>(),
        })
    }

    pub(crate) fn from_json(value: &Value) -> Self {
        let mut out = Self::default();
        for entry in value.get("sequences").and_then(Value::as_array).into_iter().flatten() {
            if let (Some(key), Some(seq)) = (entry.get(0).and_then(Value::as_str), entry.get(1).and_then(Value::as_u64))
                && seq <= 255
            {
                out.sequences.push((key.to_string(), seq as u8));
            }
        }
        for entry in value.get("active").and_then(Value::as_array).into_iter().flatten() {
            let protocol = match entry.get("protocol").and_then(Value::as_str) {
                Some("artnet") => Protocol::ArtNet,
                Some("sacn") => Protocol::Sacn,
                _ => continue,
            };
            let host = entry.get("host").and_then(Value::as_str).and_then(|h| h.parse().ok());
            let (Some(key), Some(universe), Some(length)) = (
                entry.get("key").and_then(Value::as_str),
                entry.get("universe").and_then(Value::as_u64),
                entry.get("length").and_then(Value::as_u64),
            ) else { continue };
            if protocol == Protocol::ArtNet && host.is_none() {
                continue;
            }
            if !(1..=packets::DMX_SLOTS as u64).contains(&length) {
                continue;
            }
            out.active.push((key.to_string(), protocol, host, universe as u32, length as usize));
        }
        out
    }
}

impl Output {
    pub(crate) fn new(artnet_port: u16, sacn_port: u16) -> Self {
        Self {
            socket: None,
            bound_port: None,
            artnet_port,
            sacn_port,
            last_frame_at: None,
            rate_credit: 1.0,
            sequences: HashMap::new(),
            active: Vec::new(),
            art_sync_active: false,
            recent_frames: VecDeque::new(),
            stats: Stats::default(),
        }
    }

    pub(crate) fn ports(&self) -> (u16, u16) {
        (self.artnet_port, self.sacn_port)
    }

    pub(crate) fn local_port(&self) -> Option<u16> {
        self.bound_port
    }

    pub(crate) fn sending(&self) -> bool {
        !self.active.is_empty()
    }

    pub(crate) fn stats_json(&mut self, now: Instant) -> Value {
        while self.recent_frames.front().is_some_and(|t| now.duration_since(*t) > Duration::from_secs(1)) {
            self.recent_frames.pop_front();
        }
        json!({
            "framesSent": self.stats.frames_sent,
            "packetsSent": self.stats.packets_sent,
            "framesDropped": self.stats.frames_dropped,
            "droppedBusy": self.stats.dropped_busy,
            "droppedRate": self.stats.dropped_rate,
            "sendErrors": self.stats.send_errors,
            "lastError": self.stats.last_error,
            "fps": self.recent_frames.len(),
            "universes": self.active.len(),
            "sending": !self.active.is_empty(),
        })
    }

    fn ensure_socket(&mut self) -> Result<(), String> {
        if self.socket.is_some() {
            return Ok(());
        }
        let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)).map_err(|e| e.to_string())?;
        // Art-Net broadcast targets need SO_BROADCAST.
        let _ = socket.set_broadcast(true);
        // A full send buffer must not hold the output thread up.
        let _ = socket.set_write_timeout(Some(Duration::from_millis(5)));
        self.bound_port = socket.local_addr().ok().map(|a| a.port());
        self.socket = Some(socket);
        Ok(())
    }

    fn send_packet(&mut self, packet: &[u8], port: u16, host: Ipv4Addr) {
        self.stats.packets_sent += 1;
        let Some(socket) = self.socket.as_ref() else { return };
        if let Err(error) = socket.send_to(packet, SocketAddrV4::new(host, port)) {
            self.stats.send_errors += 1;
            self.stats.last_error = Some(error.to_string());
        }
    }

    fn next_sequence(&mut self, key: &str, protocol: Protocol) -> u8 {
        let previous = self.sequences.get(key).copied();
        let sequence = match protocol {
            Protocol::ArtNet => packets::next_artnet_sequence(previous),
            Protocol::Sacn => packets::next_sacn_sequence(previous),
        };
        self.sequences.insert(key.to_string(), sequence);
        sequence
    }

    fn send_universe(&mut self, key: &str, protocol: Protocol, host: Option<Ipv4Addr>, universe: u32, data: &[u8], sacn: &SacnSettings, terminated: bool) -> Result<(), String> {
        let sequence = self.next_sequence(key, protocol);
        match protocol {
            Protocol::ArtNet => {
                let packet = packets::build_art_dmx(universe, sequence, 0, data)?;
                let host = host.ok_or("Art-Net needs a node or broadcast IPv4 address")?;
                self.send_packet(&packet, self.artnet_port, host);
            }
            Protocol::Sacn => {
                let packet = packets::build_e131(&E131Options {
                    universe,
                    sequence,
                    priority: sacn.priority,
                    source_name: &sacn.source_name,
                    cid: &sacn.cid,
                    preview: false,
                    terminated,
                    force_sync: false,
                    sync_address: 0,
                }, data)?;
                let host = match host {
                    Some(host) => host,
                    None => packets::sacn_multicast_address(universe)?,
                };
                self.send_packet(&packet, self.sacn_port, host);
            }
        }
        Ok(())
    }

    /// One black frame, then Stream_Terminated for sACN.
    fn send_terminal(&mut self, target: &Target) {
        let black = vec![0_u8; target.length];
        let _ = self.send_universe(&target.key, target.protocol, target.host, target.universe, &black, &target.sacn, false);
        if target.protocol == Protocol::Sacn {
            for _ in 0..SACN_TERMINATION_PACKETS {
                let _ = self.send_universe(&target.key, target.protocol, target.host, target.universe, &black, &target.sacn, true);
            }
        }
        self.sequences.remove(&target.key);
    }

    fn send_art_sync(&mut self, hosts: &[Ipv4Addr]) {
        let sync = packets::build_art_sync();
        for host in hosts {
            self.send_packet(&sync, self.artnet_port, *host);
        }
    }

    /// `sendFrame`. Returns false when the rate cap dropped the frame.
    pub(crate) fn send_frame(&mut self, frame: &OutFrame, time: Instant) -> Result<bool, String> {
        let credit = match self.last_frame_at {
            Some(last) => RATE_BURST.min(self.rate_credit + time.duration_since(last).as_secs_f64() * frame.fps as f64),
            None => 1.0,
        };
        if credit < 1.0 - 1e-9 {
            self.stats.frames_dropped += 1;
            self.stats.dropped_rate += 1;
            return Ok(false);
        }
        self.last_frame_at = Some(time);
        self.rate_credit = (credit - 1.0).max(0.0);

        if let Err(error) = self.ensure_socket() {
            self.stats.send_errors += 1;
            self.stats.last_error = Some(error.clone());
            return Err(error);
        }

        let next: Vec<Target> = frame.universes.iter().map(|u| Target {
            key: u.key.clone(),
            protocol: u.protocol,
            host: u.host,
            universe: u.universe,
            length: u.data.len(),
            sacn: frame.sacn.clone(),
        }).collect();

        let mut sync_hosts: Vec<Ipv4Addr> = Vec::new();
        let add_host = |hosts: &mut Vec<Ipv4Addr>, host: Option<Ipv4Addr>| {
            if let Some(host) = host
                && !hosts.contains(&host)
            {
                hosts.push(host);
            }
        };
        let gone: Vec<Target> = self.active.iter().filter(|t| !next.iter().any(|n| n.key == t.key)).cloned().collect();
        for target in &gone {
            self.send_terminal(target);
            if target.protocol == Protocol::ArtNet {
                add_host(&mut sync_hosts, target.host);
            }
        }
        for universe in frame.universes {
            if let Err(error) = self.send_universe(&universe.key, universe.protocol, universe.host, universe.universe, &universe.data, frame.sacn, false) {
                self.stats.send_errors += 1;
                self.stats.last_error = Some(error.clone());
                return Err(error);
            }
            if universe.protocol == Protocol::ArtNet {
                add_host(&mut sync_hosts, universe.host);
            }
        }
        if frame.art_sync && !sync_hosts.is_empty() {
            self.send_art_sync(&sync_hosts);
        }
        self.active = next;
        self.art_sync_active = frame.art_sync;
        self.stats.frames_sent += 1;
        self.recent_frames.push_back(time);
        if self.recent_frames.len() > 256 {
            self.recent_frames.pop_front();
        }
        Ok(true)
    }

    fn reset(&mut self) {
        self.active.clear();
        self.sequences.clear();
        self.last_frame_at = None;
        self.rate_credit = 1.0;
        self.art_sync_active = false;
        self.recent_frames.clear();
        self.socket = None;
    }

    /// `stop`: black out every active universe, terminate sACN streams,
    /// release the socket. Returns how many universes were terminated.
    pub(crate) fn stop(&mut self) -> usize {
        let mut terminated = 0;
        if self.socket.is_some() && !self.active.is_empty() {
            let mut sync_hosts: Vec<Ipv4Addr> = Vec::new();
            for target in self.active.clone() {
                self.send_terminal(&target);
                terminated += 1;
                if target.protocol == Protocol::ArtNet
                    && let Some(host) = target.host
                    && !sync_hosts.contains(&host)
                {
                    sync_hosts.push(host);
                }
            }
            if self.art_sync_active && !sync_hosts.is_empty() {
                self.send_art_sync(&sync_hosts);
            }
        }
        self.reset();
        terminated
    }

    /// Stop without the black frame or termination: another sender carries on.
    pub(crate) fn hand_over(&mut self) -> Handover {
        let handover = Handover {
            sequences: self.sequences.iter().map(|(k, v)| (k.clone(), *v)).collect(),
            active: self.active.iter().map(|t| (t.key.clone(), t.protocol, t.host, t.universe, t.length)).collect(),
        };
        self.reset();
        handover
    }

    /// Carry on from another sender's state. Universes it was sending that
    /// the first frame here no longer has get their black frame then.
    pub(crate) fn take_over(&mut self, handover: &Handover, sacn: &SacnSettings) {
        for (key, seq) in &handover.sequences {
            self.sequences.insert(key.clone(), *seq);
        }
        self.active = handover.active.iter().map(|(key, protocol, host, universe, length)| Target {
            key: key.clone(),
            protocol: *protocol,
            host: *host,
            universe: *universe,
            length: *length,
            sacn: sacn.clone(),
        }).collect();
    }
}
