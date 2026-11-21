//! Every declared control parses, clamps to its range and reaches what the
//! GPU reads: for each definition, its two ends (or each option) must change
//! the frames an instrument produces from the same audio.

use serde_json::{Value, json};

use super::audio_data::{AV_EVENTS_OFFSET, AV_SPECTRUM_OFFSET, AV_TOTAL_FLOATS, AV_WAVEFORM_OFFSET, AudioVisualData, H_ENV_BASS, H_EVENT_COUNT, H_EVENT_SEQ, H_LEVEL};
use super::cloud_pulse::{CloudKind, CloudSim, cloud_defs, normalize_cloud_params, step_cloud_frame};
use super::controls::{Defs, Kind};
use super::hdr_post::HdrPostSettings;
use super::strands::{ShapeQueue, normalize_strands_params, step_strands_frame, strands_defs};
use super::controls::AudioShaper;

const FRAMES: u32 = 90;

/// A track: hits on frames 6 (bass), 24 (mid), 42 (high), 46 (bass), 70
/// (bass), a spectrum that swells and a moving waveform.
fn packet(frame: u32, ring: &mut Vec<[f32; 4]>, seq: &mut u32) -> AudioVisualData {
    let t = frame as f32 / 60.0;
    let hit = match frame {
        6 | 46 | 70 => Some(0.0),
        24 => Some(1.0),
        42 => Some(2.0),
        _ => None,
    };
    if let Some(band) = hit {
        *seq += 1;
        ring.insert(0, [t, band, 0.9, *seq as f32]);
        ring.truncate(32);
    }
    let mut f = vec![0.0_f32; AV_TOTAL_FLOATS];
    f[0] = 1.0;
    f[1] = t;
    f[2] = 1.0;
    f[H_EVENT_COUNT] = ring.len() as f32;
    f[H_EVENT_SEQ] = *seq as f32;
    f[H_LEVEL] = 0.3 + 0.3 * (t * 4.0).sin().abs();
    for slot in 8..11 {
        f[slot] = 0.2 + 0.1 * slot as f32 * (t * 3.0).sin().abs();
    }
    f[H_ENV_BASS] = if hit.is_some() { 1.0 } else { 0.2 };
    for (i, ev) in ring.iter().enumerate() {
        f[AV_EVENTS_OFFSET + i * 4..AV_EVENTS_OFFSET + i * 4 + 4].copy_from_slice(ev);
    }
    for bin in 0..128 {
        f[AV_SPECTRUM_OFFSET + bin] = (0.5 + 0.45 * (t * 5.0 + bin as f32 * 0.21).sin()) * if hit.is_some() { 1.0 } else { 0.6 };
    }
    for i in 0..512 {
        f[AV_WAVEFORM_OFFSET + i] = (i as f32 * 0.07 + t * 9.0).sin() * 0.5;
    }
    let mut data = AudioVisualData::default();
    data.set_from_bytes(bytemuck::cast_slice(&f)).unwrap();
    data
}

fn post_floats(p: &HdrPostSettings) -> Vec<f32> {
    vec![p.decay, p.zoom, p.swirl, p.flow, p.bloom_strength, p.threshold, p.split, p.exposure, p.contrast, p.opacity,
        p.tint[0], p.tint[1], p.tint[2]]
}

/// Everything an instrument hands the GPU over 90 frames for these params.
/// `flip_trigger` toggles the Trigger control half way through.
fn probe(id: &str, params: &Value, flip_trigger: bool) -> Vec<f32> {
    let mut out = Vec::new();
    let (mut ring, mut seq) = (Vec::new(), 0);
    let at = |frame: u32| {
        let mut p = params.clone();
        if flip_trigger && frame >= 30 {
            let base = p.get("trigger").and_then(Value::as_bool).unwrap_or(false);
            p["trigger"] = json!(!base);
        }
        p
    };
    if id == "strands" {
        let (mut queue, mut shaper, mut clock) = (ShapeQueue::default(), AudioShaper::default(), 0.0);
        for frame in 0..FRAMES {
            let p = at(frame);
            let sp = normalize_strands_params(&p);
            let data = packet(frame, &mut ring, &mut seq);
            let (u, shaped) = step_strands_frame(&mut queue, &mut shaper, &mut clock, &sp, &data, 1.0 / 60.0, 1920, 1080, frame as u64);
            out.extend(u);
            out.extend(shaped.gpu_bytes().chunks(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])));
            out.extend(post_floats(&sp.post));
            out.extend([sp.particle_count as f32, sp.accum_scale]);
        }
    } else {
        let kind = match id {
            "cloud-pulse" => CloudKind::Pulse,
            "cloud-flock" => CloudKind::Flock,
            _ => CloudKind::DepthLights,
        };
        let mut sim = CloudSim::default();
        for frame in 0..FRAMES {
            let p = at(frame);
            let cp = normalize_cloud_params(&p, kind);
            let data = packet(frame, &mut ring, &mut seq);
            out.extend(step_cloud_frame(&mut sim, kind, &cp, &p, &data, 1.0 / 60.0, 1920, 1080, 500_000));
            out.extend(post_floats(&cp.post));
            out.extend([cp.max_points as f32, cp.accum_scale]);
        }
    }
    out
}

/// Some controls only act in a mode; test them in it.
fn base_for(key: &str) -> Value {
    match key {
        "sides" => json!({ "shape": "polygon" }),
        "strataLines" => json!({ "shape": "strata" }),
        "colorA" | "colorB" => json!({ "customColors": true }),
        // A band's gain matters where that band's hits are used.
        "midGain" | "highGain" | "hitsFrom" => json!({ "hitsFrom": "all", "cooldown": 0.0 }),
        _ => json!({}),
    }
}

fn defs_for(id: &str) -> Defs {
    match id {
        "strands" => strands_defs(),
        "cloud-pulse" => cloud_defs(CloudKind::Pulse),
        "cloud-flock" => cloud_defs(CloudKind::Flock),
        _ => cloud_defs(CloudKind::DepthLights),
    }
}

fn with(mut base: Value, key: &str, value: Value) -> Value {
    base[key] = value;
    base
}

#[test]
fn every_declared_control_parses_clamps_and_reaches_the_gpu() {
    for id in ["strands", "cloud-pulse", "cloud-flock", "depth-lights"] {
        let defs = defs_for(id);
        let mut seen = std::collections::HashSet::new();
        for def in &defs.0 {
            assert!(seen.insert(def.key), "{id}: `{}` declared twice", def.key);
            let base = base_for(def.key);
            match def.kind {
                Kind::Slider { min, max, default, .. } => {
                    assert!(min < max && (min..=max).contains(&default), "{id}: `{}` default outside its range", def.key);
                    let lo = probe(id, &with(base.clone(), def.key, json!(min)), false);
                    let hi = probe(id, &with(base.clone(), def.key, json!(max)), false);
                    assert_ne!(lo, hi, "{id}: `{}` does not reach the GPU", def.key);
                    assert_eq!(hi, probe(id, &with(base.clone(), def.key, json!(max + 1000.0)), false), "{id}: `{}` not clamped", def.key);
                    assert_eq!(lo, probe(id, &with(base.clone(), def.key, json!(min - 1000.0)), false), "{id}: `{}` not clamped", def.key);
                }
                Kind::Toggle(_) if def.key == "trigger" => {
                    assert_ne!(probe(id, &base, false), probe(id, &base, true), "{id}: the trigger does nothing");
                }
                Kind::Toggle(_) => {
                    let off = probe(id, &with(base.clone(), def.key, json!(false)), false);
                    let on = probe(id, &with(base.clone(), def.key, json!(true)), false);
                    assert_ne!(off, on, "{id}: `{}` does not reach the GPU", def.key);
                }
                Kind::Select(options, default) => {
                    assert!(options.iter().any(|(v, _)| *v == default), "{id}: `{}` default is not an option", def.key);
                    let first = probe(id, &with(base.clone(), def.key, json!(options[0].0)), false);
                    for (value, _) in &options[1..] {
                        assert_ne!(first, probe(id, &with(base.clone(), def.key, json!(value)), false), "{id}: `{}` = {value} changes nothing", def.key);
                    }
                    assert_eq!(probe(id, &with(base.clone(), def.key, json!("not-an-option")), false),
                        probe(id, &with(base.clone(), def.key, json!(default)), false), "{id}: `{}` bad value is not the default", def.key);
                }
                Kind::Color(_) => {
                    let dark = probe(id, &with(base.clone(), def.key, json!([0.0, 0.0, 0.0])), false);
                    let light = probe(id, &with(base.clone(), def.key, json!("#ffffff")), false);
                    assert_ne!(dark, light, "{id}: `{}` does not reach the GPU", def.key);
                }
                Kind::File => assert!(def.resets, "{id}: a file change must be marked as a reset"),
            }
        }
    }
}

#[test]
fn the_manifest_publishes_every_definition_in_the_panel_shape() {
    for id in ["strands", "cloud-pulse", "cloud-flock", "depth-lights"] {
        let json = crate::native_graph_manifest::native_graph_param_defs(id);
        let list = json.as_array().unwrap();
        assert_eq!(list.len(), defs_for(id).0.len());
        for p in list {
            assert!(["slider", "toggle", "select", "color", "media-source"].contains(&p["kind"].as_str().unwrap()), "{p}");
            assert!(p["key"].is_string() && p["label"].is_string() && p["group"].is_string(), "{p}");
        }
    }
    assert_eq!(crate::native_graph_manifest::native_graph_param_defs("planet"), json!([]));
}
