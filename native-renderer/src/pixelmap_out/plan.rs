//! The fixture plan the editor sends when the pixel-map configuration
//! changes, and the universe packing (`writeFixtureChannels` /
//! `buildPixelMapFrame` in `src/lib/pixelmap/fixtures.ts`).
//!
//! The editor resolves everything that does not change per frame (sample
//! points, DMX patch, readiness); the core samples, calibrates, packs and
//! sends every frame.

use std::net::Ipv4Addr;

use serde_json::Value;

use super::colour::{self, PixelOptions, SamplingMode, TestPattern};
use super::output::{Protocol, SacnSettings, UniverseFrame};
use super::packets;

pub(crate) const MAX_FIXTURE_PIXELS: usize = 8192;
pub(crate) const MAX_UNIVERSES_PER_FRAME: usize = 1024;
const MAX_FPS: u32 = 60;
const DEFAULT_FPS: u32 = 40;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Segment {
    pub universe: u32,
    /// First DMX channel, 1-based.
    pub channel: usize,
    pub first_pixel: usize,
    pub pixel_count: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct Fixture {
    pub id: String,
    pub points: Vec<[f64; 2]>,
    pub sample_radius: f64,
    pub sampling: SamplingMode,
    pub options: PixelOptions,
    pub test_pattern: TestPattern,
    pub test_color: [u8; 3],
    /// Channel slots: the index into [R, G, B, W] for each slot.
    pub order: Vec<usize>,
    pub protocol: Protocol,
    pub host: Option<Ipv4Addr>,
    pub segments: Vec<Segment>,
}

impl Fixture {
    pub(crate) fn pixel_count(&self) -> usize {
        self.points.len()
    }

    pub(crate) fn needs_picture(&self) -> bool {
        self.test_pattern == TestPattern::Off
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Plan {
    pub fps: u32,
    pub art_sync: bool,
    pub sacn: SacnSettings,
    /// Longest edge of the picture the fixtures sample (the editor path's
    /// composite mirror size).
    pub max_dim: u32,
    pub fixtures: Vec<Fixture>,
    /// Test hooks: send to these ports instead of 6454 / 5568.
    pub artnet_port: u16,
    pub sacn_port: u16,
}

impl Plan {
    pub(crate) fn needs_picture(&self) -> bool {
        self.fixtures.iter().any(Fixture::needs_picture)
    }
}

fn num(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn finite(value: &Value, key: &str) -> Option<f64> {
    num(value, key).filter(|v| v.is_finite())
}

fn color_order(order: &str) -> Result<Vec<usize>, String> {
    const ORDERS: [&str; 11] = ["RGB", "RBG", "GRB", "GBR", "BRG", "BGR", "RGBW", "GRBW", "BRGW", "RBGW", "WRGB"];
    if !ORDERS.contains(&order) {
        return Err(format!("unknown colour order {order}"));
    }
    Ok(order.chars().map(|c| "RGBW".find(c).unwrap_or(0)).collect())
}

fn parse_options(fixture: &Value) -> PixelOptions {
    let calibration = fixture.get("calibration").cloned().unwrap_or(Value::Null);
    PixelOptions {
        brightness: num(fixture, "brightness"),
        gamma: num(fixture, "gamma"),
        red_gain: num(&calibration, "redGain"),
        green_gain: num(&calibration, "greenGain"),
        blue_gain: num(&calibration, "blueGain"),
        saturation: num(&calibration, "saturation"),
        black_threshold: num(&calibration, "blackThreshold"),
        smoothing: num(&calibration, "smoothing"),
        color_matrix: calibration.get("colorMatrix").and_then(Value::as_array).map(|values| {
            values.iter().map(|v| v.as_f64().unwrap_or(f64::NAN)).collect()
        }),
    }
}

fn parse_fixture(value: &Value) -> Result<Fixture, String> {
    let id = value.get("id").and_then(Value::as_str).ok_or("fixture needs an id")?.to_string();
    let flat = value.get("points").and_then(Value::as_array).ok_or("fixture needs points")?;
    if flat.len() % 2 != 0 || flat.is_empty() || flat.len() / 2 > MAX_FIXTURE_PIXELS {
        return Err(format!("fixture {id}: points must be 1-{MAX_FIXTURE_PIXELS} x,y pairs"));
    }
    let points = flat.chunks_exact(2).map(|pair| [pair[0].as_f64().unwrap_or(0.5), pair[1].as_f64().unwrap_or(0.5)]).collect::<Vec<_>>();
    let protocol = match value.get("protocol").and_then(Value::as_str) {
        Some("artnet") => Protocol::ArtNet,
        Some("sacn") => Protocol::Sacn,
        _ => return Err("Protocol must be artnet or sacn".to_string()),
    };
    let host = match value.get("host") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => {
            let host: Ipv4Addr = text.trim().parse().map_err(|_| format!("fixture {id}: bad IPv4 address"))?;
            if host.is_unspecified() {
                return Err(format!("fixture {id}: bad IPv4 address"));
            }
            Some(host)
        }
        _ => return Err(format!("fixture {id}: bad host")),
    };
    if protocol == Protocol::ArtNet && host.is_none() {
        return Err("Art-Net needs a node or broadcast IPv4 address".to_string());
    }
    let order = color_order(value.get("colorOrder").and_then(Value::as_str).unwrap_or("RGB"))?;
    let mut segments = Vec::new();
    for segment in value.get("segments").and_then(Value::as_array).ok_or("fixture needs segments")? {
        let field = |key: &str| segment.get(key).and_then(Value::as_u64).ok_or_else(|| format!("fixture {id}: segment {key}"));
        let universe = field("universe")? as u32;
        let channel = field("channel")? as usize;
        let first_pixel = field("firstPixel")? as usize;
        let pixel_count = field("pixelCount")? as usize;
        let (min, max) = match protocol {
            Protocol::ArtNet => (0, packets::ARTNET_MAX_UNIVERSE),
            Protocol::Sacn => (packets::SACN_MIN_UNIVERSE, packets::SACN_MAX_UNIVERSE),
        };
        if universe < min || universe > max {
            return Err(match protocol {
                Protocol::ArtNet => "Art-Net universe must be 0-32767".to_string(),
                Protocol::Sacn => "sACN universe must be 1-63999".to_string(),
            });
        }
        if channel < 1 || channel - 1 + pixel_count * order.len() > packets::DMX_SLOTS {
            return Err(format!("fixture {id}: segment runs past channel 512"));
        }
        segments.push(Segment { universe, channel, first_pixel, pixel_count });
    }
    Ok(Fixture {
        id,
        points,
        sample_radius: finite(value, "sampleRadius").unwrap_or(0.0),
        sampling: SamplingMode::parse(value.get("samplingMode").and_then(Value::as_str)),
        options: parse_options(value),
        test_pattern: TestPattern::parse(value.get("testPattern").and_then(Value::as_str)),
        test_color: colour::parse_hex_color(value.get("testColor").and_then(Value::as_str)),
        order,
        protocol,
        host,
        segments,
    })
}

pub(crate) fn parse_plan(value: &Value) -> Result<Plan, String> {
    let fps = num(value, "fps").filter(|v| v.is_finite()).map_or(DEFAULT_FPS, |v| (v.round() as i64).clamp(1, MAX_FPS as i64) as u32);
    let sacn_value = value.get("sacn").cloned().unwrap_or(Value::Null);
    let fixtures = value
        .get("fixtures")
        .and_then(Value::as_array)
        .ok_or("plan needs fixtures")?
        .iter()
        .map(parse_fixture)
        .collect::<Result<Vec<_>, _>>()?;
    let uses_sacn = fixtures.iter().any(|f| f.protocol == Protocol::Sacn);
    let priority = num(&sacn_value, "priority").unwrap_or(packets::SACN_DEFAULT_PRIORITY as f64);
    if uses_sacn && (priority.fract() != 0.0 || !(0.0..=packets::SACN_MAX_PRIORITY as f64).contains(&priority)) {
        return Err("sACN priority must be 0-200".to_string());
    }
    let cid = match sacn_value.get("cid").and_then(Value::as_str) {
        Some(cid) => packets::parse_sacn_cid(cid)?,
        None if uses_sacn => return Err("sACN CID must be a UUID".to_string()),
        None => [0; 16],
    };
    let port = |key: &str, default: u16| num(value, key).filter(|p| (1.0..=65535.0).contains(p)).map_or(default, |p| p as u16);
    Ok(Plan {
        fps,
        art_sync: value.get("artSync").and_then(Value::as_bool) == Some(true),
        sacn: SacnSettings {
            priority: if uses_sacn { priority as u8 } else { packets::SACN_DEFAULT_PRIORITY },
            source_name: packets::encode_source_name(sacn_value.get("sourceName").and_then(Value::as_str)),
            cid,
        },
        max_dim: num(value, "maxDim").filter(|v| v.is_finite()).map_or(384, |v| v.round().clamp(16.0, 2048.0) as u32),
        fixtures,
        artnet_port: port("artnetPort", packets::ARTNET_PORT),
        sacn_port: port("sacnPort", packets::SACN_PORT),
    })
}

fn universe_key(protocol: Protocol, host: Option<Ipv4Addr>, universe: u32) -> String {
    format!("{}|{}|{}", protocol.name(), host.map_or_else(|| "multicast".to_string(), |h| h.to_string()), universe)
}

/// `writeFixtureChannels` for every fixture, in plan order, into full
/// 512-channel universes (`buildPixelMapFrame`). `rgb[i]` is fixture i's
/// pixels, 3 bytes each in physical order. `frame` is reused between calls.
pub(crate) fn pack(plan: &Plan, rgb: &[&[u8]], frame: &mut Vec<UniverseFrame>) {
    for universe in frame.iter_mut() {
        universe.data.fill(0);
    }
    let mut used = 0;
    for (fixture, pixels) in plan.fixtures.iter().zip(rgb) {
        let white = fixture.order.len() == 4;
        for segment in &fixture.segments {
            let key = universe_key(fixture.protocol, fixture.host, segment.universe);
            let index = match frame[..used].iter().position(|u| u.key == key) {
                Some(index) => index,
                None => {
                    if used == frame.len() {
                        frame.push(UniverseFrame { key: String::new(), protocol: fixture.protocol, host: None, universe: 0, data: vec![0; packets::DMX_SLOTS] });
                    }
                    let slot = &mut frame[used];
                    slot.key = key;
                    slot.protocol = fixture.protocol;
                    slot.host = fixture.host;
                    slot.universe = segment.universe;
                    slot.data.resize(packets::DMX_SLOTS, 0);
                    slot.data.fill(0);
                    used += 1;
                    used - 1
                }
            };
            let data = &mut frame[index].data;
            let mut offset = segment.channel - 1;
            for pixel in segment.first_pixel..segment.first_pixel + segment.pixel_count {
                let get = |i: usize| pixels.get(pixel * 3 + i).copied().unwrap_or(0);
                let (red, green, blue) = (get(0), get(1), get(2));
                let values = if white {
                    let w = red.min(green).min(blue);
                    [red - w, green - w, blue - w, w]
                } else {
                    [red, green, blue, 0]
                };
                for (slot, channel) in fixture.order.iter().enumerate() {
                    data[offset + slot] = values[*channel];
                }
                offset += fixture.order.len();
            }
        }
    }
    frame.truncate(used.min(MAX_UNIVERSES_PER_FRAME));
}
