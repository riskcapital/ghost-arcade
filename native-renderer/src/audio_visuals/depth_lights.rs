//! Depth Lights: the cloud as lights in space. Camera-relative depth slices
//! each follow a slice of the spectrum (near = low, far = high); a slice's
//! envelope jumps on its own onsets and decays, and the shader switches that
//! slice's points on one by one as the envelope rises.

use serde_json::Value;

use super::audio_data::AudioVisualData;
use super::params::num;

pub const MAX_SLICES: usize = 32;

#[derive(Clone, Debug, PartialEq)]
pub struct DepthLightParams {
    pub slices: usize,
    /// Seconds for a slice to go dark after a hit.
    pub decay: f32,
    pub gain: f32,
    /// How much of the slice's plain level keeps lights glowing between hits.
    pub hold: f32,
    /// Size of a lit point, times the point size (lights stay small and sharp).
    pub on_size: f32,
    /// Camera drift: slow up-down sway in degrees.
    pub sway: f32,
    /// Share of points that are lights (the rest are the dim scan).
    pub light_share: f32,
}

pub fn normalize_depth_light_params(params: &Value) -> DepthLightParams {
    DepthLightParams {
        slices: num(params, "slices", 24.0).round().clamp(4.0, MAX_SLICES as f32) as usize,
        decay: num(params, "decay", 0.35).clamp(0.02, 5.0),
        gain: num(params, "gain", 4.0).clamp(0.0, 50.0),
        hold: num(params, "hold", 0.05).clamp(0.0, 2.0),
        on_size: num(params, "lightSize", 1.6).clamp(0.0, 6.0),
        sway: num(params, "sway", 4.0).clamp(0.0, 45.0),
        light_share: num(params, "lights", 0.05).clamp(0.0, 1.0),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DepthSlices {
    pub average: [f32; MAX_SLICES],
    pub envelope: [f32; MAX_SLICES],
}

impl Default for DepthSlices {
    fn default() -> Self {
        Self { average: [0.0; MAX_SLICES], envelope: [0.0; MAX_SLICES] }
    }
}

impl DepthSlices {
    /// Advance by `dt` from the packet's spectrum. dt 0 (a repeat render of
    /// the same frame) changes nothing.
    pub fn step(&mut self, data: &AudioVisualData, dt: f32, params: &DepthLightParams) {
        if dt <= 0.0 {
            return;
        }
        let spectrum = data.spectrum();
        let n = params.slices.clamp(1, MAX_SLICES);
        let follow = 1.0 - (-dt / 0.6).exp();
        let fall = (-dt / params.decay).exp();
        for k in 0..MAX_SLICES {
            if k >= n {
                self.envelope[k] = 0.0;
                continue;
            }
            let lo = k * spectrum.len() / n;
            let hi = ((k + 1) * spectrum.len() / n).max(lo + 1);
            let level = spectrum[lo..hi].iter().sum::<f32>() / (hi - lo) as f32;
            let onset = (level - self.average[k] * 1.08).max(0.0) * params.gain;
            self.average[k] += (level - self.average[k]) * follow;
            let target = onset.max(level * params.hold).min(1.0);
            self.envelope[k] = (self.envelope[k] * fall).max(target);
        }
    }

    /// The `C.data` block: 32 envelopes, then near, far, slice count, on size.
    pub fn block(&self, near: f32, far: f32, params: &DepthLightParams) -> Vec<f32> {
        let mut block = self.envelope.to_vec();
        block.extend_from_slice(&[near, far, params.slices as f32, params.on_size]);
        block
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::audio_data::{AV_SPECTRUM_OFFSET, AV_TOTAL_FLOATS};

    fn spectrum_packet(low: f32, high: f32) -> AudioVisualData {
        let mut floats = vec![0.0_f32; AV_TOTAL_FLOATS];
        floats[0] = 1.0;
        floats[2] = 1.0;
        for bin in 0..128 {
            floats[AV_SPECTRUM_OFFSET + bin] = if bin < 64 { low } else { high };
        }
        let mut data = AudioVisualData::default();
        data.set_from_bytes(bytemuck::cast_slice(&floats)).unwrap();
        data
    }

    #[test]
    fn a_rise_in_a_slices_band_lights_only_that_slice_then_it_decays() {
        let params = normalize_depth_light_params(&serde_json::json!({ "slices": 8, "hold": 0.0 }));
        let mut slices = DepthSlices::default();
        for _ in 0..120 {
            slices.step(&spectrum_packet(0.2, 0.2), 1.0 / 60.0, &params);
        }
        let quiet = slices.envelope;
        slices.step(&spectrum_packet(0.8, 0.2), 1.0 / 60.0, &params);
        assert!(slices.envelope[0] > 0.9, "near slices follow the low end");
        assert!(slices.envelope[7] <= quiet[7] + 1e-4, "far slices did not move");
        for _ in 0..150 {
            slices.step(&spectrum_packet(0.8, 0.2), 1.0 / 60.0, &params);
        }
        assert!(slices.envelope[0] < 0.2, "a held level is not a hit");
    }

    #[test]
    fn repeat_frames_change_nothing_and_unused_slices_stay_dark() {
        let params = normalize_depth_light_params(&serde_json::json!({ "slices": 4 }));
        let mut slices = DepthSlices::default();
        slices.step(&spectrum_packet(0.9, 0.9), 1.0 / 60.0, &params);
        let before = slices.clone();
        slices.step(&spectrum_packet(0.0, 0.0), 0.0, &params);
        assert_eq!(slices, before);
        assert!(slices.envelope[4..].iter().all(|v| *v == 0.0));
        assert_eq!(slices.block(1.0, 2.0, &params).len(), MAX_SLICES + 4);
    }
}
