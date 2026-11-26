//! The core's WLED output against the editor path: `testdata/vectors.json`
//! holds the DRGB packets `src/lib/pixelmap/coreVectors.test.ts` makes with
//! the editor's own sampling, calibration and `wled-packet.cjs`.

use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::Value;

use super::colour::Frame;
use super::wled::{self, Clock, Link, LinkSeed, LinkState, Sent, WledOutput};

fn vectors() -> Value {
    serde_json::from_str(include_str!("testdata/vectors.json")).expect("vectors.json parses")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn bgra_picture(vectors: &Value) -> (Vec<u8>, usize, usize) {
    let p = &vectors["picture"];
    let rgba = base64::engine::general_purpose::STANDARD.decode(p["rgba"].as_str().unwrap()).unwrap();
    let bgra = rgba.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], p[3]]).collect();
    (bgra, p["width"].as_u64().unwrap() as usize, p["height"].as_u64().unwrap() as usize)
}

/// Every packet that arrives on `socket` until it goes quiet.
fn drain(socket: &UdpSocket) -> Vec<String> {
    socket.set_read_timeout(Some(Duration::from_millis(150))).unwrap();
    let mut out = Vec::new();
    let mut buffer = [0_u8; 1600];
    while let Ok((size, _)) = socket.recv_from(&mut buffer) {
        out.push(hex(&buffer[..size]));
    }
    out
}

/// The vectors' plan with each controller pointed at its own local receiver.
fn plan_with_receivers(vectors: &Value) -> (Value, Vec<(String, UdpSocket)>) {
    let mut plan = vectors["wled"]["plan"].clone();
    let mut receivers = Vec::new();
    for controller in plan["controllers"].as_array_mut().unwrap() {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        controller["port"] = socket.local_addr().unwrap().port().into();
        receivers.push((controller["id"].as_str().unwrap().to_string(), socket));
    }
    (plan, receivers)
}

#[test]
fn wled_output_sends_the_editor_paths_packets() {
    let vectors = vectors();
    let (bgra, width, height) = bgra_picture(&vectors);
    let frame = Frame { pixels: &bgra, width, height, rgb: [2, 1, 0] };
    let ticks = vectors["wled"]["ticks"].as_array().unwrap();
    let (plan_json, receivers) = plan_with_receivers(&vectors);
    let plan = wled::parse_wled_plan(&plan_json).unwrap();
    assert_eq!(plan.fps, 20);
    assert_eq!(plan.max_dim, 192);
    let mut output = WledOutput::new();
    let t0 = Instant::now();
    output.configure(plan, &[], t0, true);

    // First tick: every controller sends what the editor path sends.
    output.tick(t0, t0, Some((&frame, 1)));
    for (id, socket) in &receivers {
        assert_eq!(drain(socket), vec![ticks[0][id].as_str().unwrap().to_string()], "controller {id}, first tick");
    }

    // Second tick on the same picture: only what changed (smoothing) goes out.
    let t1 = t0 + Duration::from_millis(50);
    output.tick(t1, t1, Some((&frame, 1)));
    let mut changed = 0;
    for (id, socket) in &receivers {
        let (first, second) = (ticks[0][id].as_str().unwrap(), ticks[1][id].as_str().unwrap());
        let want: Vec<String> = if first == second { Vec::new() } else { vec![second.to_string()] };
        changed += want.len();
        assert_eq!(drain(socket), want, "controller {id}, second tick");
    }
    assert!(changed >= 1, "the smoothed controller changes between ticks");

    // Install mode's force-black: black at once, whatever the picture.
    let mut black = plan_json.clone();
    black["forceBlack"] = true.into();
    output.configure(wled::parse_wled_plan(&black).unwrap(), &[], t1, true);
    let t2 = t1 + Duration::from_millis(50);
    output.tick(t2, t2, Some((&frame, 1)));
    for (id, socket) in &receivers {
        assert_eq!(drain(socket), vec![ticks[2][id].as_str().unwrap().to_string()], "controller {id}, forced black");
    }
    // ... and kept black with the keep-alive.
    let t3 = t2 + Duration::from_millis(500);
    output.tick(t3, t3, Some((&frame, 2)));
    assert!(receivers.iter().all(|(_, s)| drain(s).is_empty()), "unchanged black waits for the keep-alive");
    let t4 = t2 + wled::KEEPALIVE;
    output.tick(t4, t4, Some((&frame, 2)));
    for (id, socket) in &receivers {
        assert_eq!(drain(socket), vec![ticks[2][id].as_str().unwrap().to_string()], "controller {id}, keep-alive");
    }

    // Out of black with capture off meanwhile: nothing from before the
    // black goes out; the picture controllers wait for a new picture.
    output.configure(wled::parse_wled_plan(&plan_json).unwrap(), &[], t4, false);
    let t5 = t4 + Duration::from_millis(50);
    output.tick(t5, t5, None);
    for (id, socket) in &receivers {
        let packets = drain(socket);
        if id == "solid" {
            assert_eq!(packets.len(), 1);
        } else {
            assert!(packets.is_empty(), "controller {id} sent a stale frame after the black");
        }
    }
    let t6 = t5 + Duration::from_millis(50);
    output.tick(t6, t6, Some((&frame, 3)));
    assert_eq!(drain(&receivers[0].1).len(), 1, "the new picture goes out");
}

#[test]
fn nothing_is_sent_before_the_first_picture() {
    let vectors = vectors();
    let (plan_json, receivers) = plan_with_receivers(&vectors);
    let mut output = WledOutput::new();
    let t0 = Instant::now();
    output.configure(wled::parse_wled_plan(&plan_json).unwrap(), &[], t0, false);
    output.tick(t0, t0, None);
    for (id, socket) in &receivers {
        let packets = drain(socket);
        if id == "solid" {
            // A test pattern needs no picture.
            assert_eq!(packets, vec![vectors["wled"]["ticks"][0]["solid"].as_str().unwrap().to_string()]);
        } else {
            assert!(packets.is_empty(), "controller {id} sent before it had a picture");
        }
    }
}

#[test]
fn plans_reject_what_the_editor_keeps() {
    let base = serde_json::json!({ "controllers": [{ "id": "a", "ip": "10.0.0.2", "port": 21324, "points": [0.5, 0.5] }] });
    assert_eq!(wled::parse_wled_plan(&base).unwrap().fps, 20);
    let mut host = base.clone();
    host["controllers"][0]["ip"] = "wled-kitchen.local".into();
    assert!(wled::parse_wled_plan(&host).is_err());
    let mut port = base.clone();
    port["controllers"][0]["port"] = 70000.into();
    assert!(wled::parse_wled_plan(&port).is_err());
    let mut many = base.clone();
    many["controllers"][0]["points"] = serde_json::json!(vec![0.5; 491 * 2]);
    assert!(wled::parse_wled_plan(&many).is_err());
    let mut twice = base.clone();
    let first = twice["controllers"][0].clone();
    twice["controllers"].as_array_mut().unwrap().push(first);
    assert!(wled::parse_wled_plan(&twice).is_err());
}

#[test]
fn a_kept_controller_keeps_its_link_and_a_moved_one_starts_fresh() {
    let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
    let port = receiver.local_addr().unwrap().port();
    let plan = |ip: &str| wled::parse_wled_plan(&serde_json::json!({ "controllers": [{ "id": "a", "ip": ip, "port": port, "points": [0.5, 0.5], "testPattern": "solid" }] })).unwrap();
    let mut output = WledOutput::new();
    let t0 = Instant::now();
    let seed = LinkSeed { state: Some("down".into()), down_since_ms: 1234, errors: 3, ..Default::default() };
    output.configure(plan("127.0.0.1"), &[("a".to_string(), seed)], t0, false);
    let state = output.state(false);
    assert_eq!(state["controllers"][0]["state"], "down");
    assert_eq!(state["controllers"][0]["downSince"], 1234);
    // Frames get through: up after the confirm time, as wled-link.cjs.
    output.tick(t0, t0, None);
    let later = t0 + wled::CONFIRM;
    output.configure(plan("127.0.0.1"), &[], later, false);
    output.tick(later, later, None);
    assert_eq!(output.state(false)["controllers"][0]["state"], "up");
    assert_eq!(drain(&receiver).len(), 2);
    // A new address is a new link.
    output.configure(plan("127.0.0.2"), &[], later, false);
    assert_eq!(output.state(false)["controllers"][0]["state"], "unknown");
    assert_eq!(output.stop()["links"][0]["controllerId"], "a");
}

/// A controller that is up but not listening answers "port unreachable";
/// the link goes down, backs off, and comes up again once it listens.
#[cfg(not(windows))]
#[test]
fn a_link_goes_down_on_an_unreachable_port_and_comes_back() {
    let port = UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let clock = Clock::new();
    let t0 = Instant::now();
    let mut link = Link::new(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port), &clock, t0);
    let packet = [2_u8, 2, 1, 2, 3];
    assert_eq!(link.send(&packet, &clock, t0), Sent::Ok);
    // The ICMP answer arrives on the socket shortly after.
    let mut failed = false;
    for step in 1..40 {
        std::thread::sleep(Duration::from_millis(10));
        if link.send(&packet, &clock, t0 + Duration::from_millis(step * 10)) == Sent::Failed {
            failed = true;
            break;
        }
    }
    assert!(failed, "no error from an unreachable port");
    assert_eq!(link.state, LinkState::Down);
    assert_eq!(link.last_error.as_deref(), Some("ECONNREFUSED"));
    assert!(link.down_since_ms > 0);
    assert_eq!(link.send(&packet, &clock, t0 + Duration::from_millis(500)), Sent::Reconnecting);
    link.poll(&clock, t0 + Duration::from_millis(600));
    assert_eq!(link.send(&packet, &clock, t0 + Duration::from_millis(600)), Sent::Reconnecting, "still backing off");
    let listener = UdpSocket::bind(("127.0.0.1", port)).unwrap();
    let back = t0 + Duration::from_millis(1500);
    link.poll(&clock, back);
    assert_eq!(link.send(&packet, &clock, back), Sent::Ok);
    assert_eq!(link.state, LinkState::Down, "down until frames have gone out for the confirm time");
    assert_eq!(link.send(&packet, &clock, back + wled::CONFIRM), Sent::Ok);
    assert_eq!(link.state, LinkState::Up);
    assert_eq!(link.down_since_ms, 0);
    assert_eq!(drain(&listener).len(), 2);
}
