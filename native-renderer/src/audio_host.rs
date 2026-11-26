//! Audio from the app: spectrum, audio-visual source packets and audio state.

use crate::*;

/// A layer's `audioSource` packet, or the master packet when it follows none
/// (or its source has not been sent yet).
pub(crate) fn audio_visual_packet_for<'a>(
    master: &'a audio_visuals::audio_data::AudioVisualData,
    sources: &'a HashMap<String, audio_visuals::audio_data::AudioVisualData>,
    params: &Value,
) -> &'a audio_visuals::audio_data::AudioVisualData {
    params
        .get("audioSource")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
        .and_then(|key| sources.get(key))
        .unwrap_or(master)
}

#[cfg(test)]
mod audio_visual_source_tests {
    use super::*;
    use audio_visuals::audio_data::AudioVisualData;

    #[test]
    fn a_layer_reads_its_own_source_packet_or_the_master() {
        let master = AudioVisualData::default();
        let mut kick = AudioVisualData::default();
        kick.seq = 42;
        let mut sources = HashMap::new();
        sources.insert("kick".to_string(), kick);
        let pick = |p: Value| audio_visual_packet_for(&master, &sources, &p).seq;
        assert_eq!(pick(json!({ "audioSource": "kick" })), 42);
        assert_eq!(pick(json!({ "audioSource": "bass" })), master.seq, "unsent source falls back");
        assert_eq!(pick(json!({})), master.seq);
    }
}

impl App {
    /// Live analyser rows for ISF `audioFFT` / `audio` inputs:
    /// `{ active, fft_b64?, waveform_b64? }` as bytes (0..255 = 0..1), or
    /// `{ fft: [..], waveform: [..] }` as numbers in 0..1. Decoded into
    /// reused buffers; the GPU rows upload lazily at the next ISF render.
    pub(crate) fn apply_audio_spectrum(&mut self, command: &Value) {
        let active = bool_at(command, &["active"]).unwrap_or(true);
        let spectrum = &mut self.isf_audio_spectrum;
        for (key_b64, key_numbers, is_fft) in [("fft_b64", "fft", true), ("waveform_b64", "waveform", false)] {
            let target = if is_fft { &mut spectrum.fft } else { &mut spectrum.waveform };
            if let Some(encoded) = command.get(key_b64).and_then(Value::as_str) {
                let scratch = &mut self.isf_audio_decode_scratch;
                scratch.clear();
                if base64::engine::general_purpose::STANDARD.decode_vec(encoded, scratch).is_ok() {
                    IsfAudioSpectrum::set_from_bytes(target, scratch);
                }
            } else if let Some(values) = command.get(key_numbers).and_then(Value::as_array) {
                IsfAudioSpectrum::set_from_numbers(target, values);
            }
        }
        spectrum.active = active;
        spectrum.seq = spectrum.seq.wrapping_add(1);
        spectrum.received_at = Some(Instant::now());
        // Audio-reactive instruments: one fixed-size packet, only while a
        // layer that reads it is showing (the editor decides). Independent of
        // the ISF rows above: either can be live without the other.
        if bool_at(command, &["visual_active"]) == Some(false) {
            self.audio_visual.set_inactive();
            self.audio_visual_sources.clear();
        } else if let Some(encoded) = command.get("visual_b64").and_then(Value::as_str) {
            let scratch = &mut self.isf_audio_decode_scratch;
            scratch.clear();
            if base64::engine::general_purpose::STANDARD.decode_vec(encoded, scratch).is_ok()
                && let Err(err) = self.audio_visual.set_from_bytes(scratch)
                && self.last_shader_error.as_deref() != Some(err.as_str())
            {
                self.last_shader_error = Some(err);
            }
        }
        if bool_at(command, &["visual_active"]) != Some(false) {
            self.apply_audio_visual_sources(command);
        }
    }

    /// Per-source packets: every key sent is decoded into its own packet;
    /// keys no longer sent are dropped (nothing follows them any more).
    pub(crate) fn apply_audio_visual_sources(&mut self, command: &Value) {
        let Some(sources) = command.get("visual_sources").and_then(Value::as_object) else { return };
        self.audio_visual_sources.retain(|key, _| sources.contains_key(key));
        for (key, encoded) in sources.iter().take(64) {
            let Some(encoded) = encoded.as_str() else { continue };
            let scratch = &mut self.isf_audio_decode_scratch;
            scratch.clear();
            if base64::engine::general_purpose::STANDARD.decode_vec(encoded, scratch).is_err() {
                continue;
            }
            let packet = self.audio_visual_sources.entry(key.clone()).or_default();
            if let Err(err) = packet.set_from_bytes(scratch)
                && self.last_shader_error.as_deref() != Some(err.as_str())
            {
                self.last_shader_error = Some(err);
            }
        }
    }

    /// The packet an instrument layer reads: its own source's when it follows one.
    pub(crate) fn audio_visual_for(&self, params: &Value) -> &audio_visuals::audio_data::AudioVisualData {
        audio_visual_packet_for(&self.audio_visual, &self.audio_visual_sources, params)
    }

    pub(crate) fn apply_audio_state(&mut self, command: &Value) {
        let audio = GhostAudioUniforms::from_command(command);
        self.audio0 = audio.audio0;
        self.audio1 = audio.audio1;
        self.audio2 = audio.audio2;
        // Optional, for the scene frame block: where the app is in the bar.
        self.scene_clock.bar_phase_hint = number_at(command, &["bar_phase"]).map(|v| v as f32);
        if let Some(beats) = number_at(command, &["beats_per_bar"]).filter(|v| v.is_finite() && *v >= 1.0) {
            self.scene_clock.beats_per_bar = beats.min(32.0) as u32;
        }
    }
}
