//! Audio data for audio-reactive instruments: one small packet per analyser
//! frame, built by the editor next to its analyser (`audioVisualData.ts`) and
//! sent inside the existing `set_audio_spectrum` command as `visual_b64`.
//!
//! The packet is a flat little-endian `f32` array with a fixed layout, so the
//! core checks it once and copies it straight into a storage buffer. Shaders
//! read it as `array<f32>` with the offsets below (`audio_data.wgsl`).
//!
//! Layout, version 1 (all offsets in floats):
//!
//! | offset | size | content                                                  |
//! |--------|------|----------------------------------------------------------|
//! | 0      | 16   | header: see `H_*`                                        |
//! | 16     | 128  | onset ring: 32 events x (time, band, strength, seq)      |
//! | 144    | 128  | spectrum: log-spaced bins, 0..1                          |
//! | 272    | 512  | waveform: -1..1                                          |
//!
//! The ring is newest first. Times are in the editor's audio clock (the render
//! clock during an offline render), the same clock as `H_TIME`, so an event's
//! age is `H_TIME - time` whatever the core's own clock says.

pub const AV_VERSION: f32 = 1.0;
pub const AV_HEADER_FLOATS: usize = 16;
pub const AV_EVENT_CAPACITY: usize = 32;
pub const AV_EVENT_FLOATS: usize = 4;
pub const AV_SPECTRUM_BINS: usize = 128;
pub const AV_WAVEFORM_SAMPLES: usize = 512;

pub const AV_EVENTS_OFFSET: usize = AV_HEADER_FLOATS;
pub const AV_SPECTRUM_OFFSET: usize = AV_EVENTS_OFFSET + AV_EVENT_CAPACITY * AV_EVENT_FLOATS;
pub const AV_WAVEFORM_OFFSET: usize = AV_SPECTRUM_OFFSET + AV_SPECTRUM_BINS;
pub const AV_TOTAL_FLOATS: usize = AV_WAVEFORM_OFFSET + AV_WAVEFORM_SAMPLES;
pub const AV_TOTAL_BYTES: usize = AV_TOTAL_FLOATS * 4;

pub const H_VERSION: usize = 0;
pub const H_TIME: usize = 1;
pub const H_ACTIVE: usize = 2;
pub const H_EVENT_COUNT: usize = 3;
pub const H_LEVEL: usize = 4;
/// Onset envelopes: jump to a hit's strength, then decay.
pub const H_ENV_BASS: usize = 5;
pub const H_ENV_MID: usize = 6;
pub const H_ENV_HIGH: usize = 7;
/// Smoothed band levels, 0..1.
pub const H_BASS: usize = 8;
pub const H_MID: usize = 9;
pub const H_HIGH: usize = 10;
pub const H_BEAT_PHASE: usize = 11;
pub const H_BPM: usize = 12;
pub const H_SPECTRUM_BINS: usize = 13;
pub const H_WAVEFORM_SAMPLES: usize = 14;
/// Total events ever detected (the newest event's `seq`).
pub const H_EVENT_SEQ: usize = 15;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnsetBand {
    Bass = 0,
    Mid = 1,
    High = 2,
}

impl OnsetBand {
    pub fn from_f32(value: f32) -> Option<Self> {
        match value.round() as i32 {
            0 => Some(Self::Bass),
            1 => Some(Self::Mid),
            2 => Some(Self::High),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OnsetEvent {
    pub time: f32,
    pub band: OnsetBand,
    pub strength: f32,
    pub seq: u32,
}

/// The latest packet. `Default` is silence: version set, everything else zero,
/// so a shader bound before any audio arrives reads a valid, quiet packet.
#[derive(Clone, Debug)]
pub struct AudioVisualData {
    floats: Vec<f32>,
    /// Bumped on every accepted packet.
    pub seq: u64,
}

impl Default for AudioVisualData {
    fn default() -> Self {
        let mut floats = vec![0.0; AV_TOTAL_FLOATS];
        floats[H_VERSION] = AV_VERSION;
        floats[H_SPECTRUM_BINS] = AV_SPECTRUM_BINS as f32;
        floats[H_WAVEFORM_SAMPLES] = AV_WAVEFORM_SAMPLES as f32;
        Self { floats, seq: 0 }
    }
}

impl AudioVisualData {
    /// Replace the packet from little-endian bytes. A wrong size or version,
    /// or a non-finite value, leaves the previous packet in place.
    pub fn set_from_bytes(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() != AV_TOTAL_BYTES {
            return Err(format!("audio visual packet is {} bytes, expected {AV_TOTAL_BYTES}", bytes.len()));
        }
        let version = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        if version != AV_VERSION {
            return Err(format!("audio visual packet version {version} is not {AV_VERSION}"));
        }
        if bytes
            .chunks_exact(4)
            .any(|chunk| !f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]).is_finite())
        {
            return Err("audio visual packet has a non-finite value".to_string());
        }
        for (slot, chunk) in self.floats.iter_mut().zip(bytes.chunks_exact(4)) {
            *slot = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        let count = self.floats[H_EVENT_COUNT].clamp(0.0, AV_EVENT_CAPACITY as f32).floor();
        self.floats[H_EVENT_COUNT] = count;
        self.seq = self.seq.wrapping_add(1);
        Ok(())
    }

    /// Back to silence (the producer stopped), keeping the ring's sequence so
    /// a restart does not replay old hits as new ones.
    pub fn set_inactive(&mut self) {
        let event_seq = self.floats[H_EVENT_SEQ];
        *self = Self { seq: self.seq.wrapping_add(1), ..Self::default() };
        self.floats[H_EVENT_SEQ] = event_seq;
    }

    /// The raw packet, for per-instrument shaping (controls.rs).
    pub fn floats_mut(&mut self) -> &mut [f32] {
        &mut self.floats
    }

    pub fn header(&self, index: usize) -> f32 {
        self.floats[index]
    }

    pub fn active(&self) -> bool {
        self.floats[H_ACTIVE] > 0.5
    }

    pub fn time(&self) -> f32 {
        self.floats[H_TIME]
    }

    pub fn event_count(&self) -> usize {
        self.floats[H_EVENT_COUNT] as usize
    }

    /// Ring event `index` (0 = newest), if it holds one.
    pub fn event(&self, index: usize) -> Option<OnsetEvent> {
        if index >= self.event_count() {
            return None;
        }
        let at = AV_EVENTS_OFFSET + index * AV_EVENT_FLOATS;
        let band = OnsetBand::from_f32(self.floats[at + 1])?;
        Some(OnsetEvent {
            time: self.floats[at],
            band,
            strength: self.floats[at + 2].clamp(0.0, 4.0),
            seq: self.floats[at + 3].max(0.0) as u32,
        })
    }

    /// Events newer than `after_seq`, oldest first, at most `limit`.
    pub fn events_after(&self, after_seq: u32, limit: usize) -> Vec<OnsetEvent> {
        let mut fresh: Vec<OnsetEvent> = (0..self.event_count())
            .filter_map(|index| self.event(index))
            .filter(|event| event.seq > after_seq)
            .collect();
        fresh.sort_by_key(|event| event.seq);
        // Keep the newest when more arrived than a frame may launch.
        let skip = fresh.len().saturating_sub(limit);
        fresh.drain(..skip);
        fresh
    }

    pub fn spectrum(&self) -> &[f32] {
        &self.floats[AV_SPECTRUM_OFFSET..AV_SPECTRUM_OFFSET + AV_SPECTRUM_BINS]
    }

    pub fn waveform(&self) -> &[f32] {
        &self.floats[AV_WAVEFORM_OFFSET..AV_WAVEFORM_OFFSET + AV_WAVEFORM_SAMPLES]
    }

    /// The packet as the GPU reads it.
    pub fn gpu_bytes(&self) -> Vec<u8> {
        bytemuck::cast_slice(&self.floats).to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(events: &[(f32, f32, f32, f32)]) -> Vec<u8> {
        let mut floats = vec![0.0_f32; AV_TOTAL_FLOATS];
        floats[H_VERSION] = AV_VERSION;
        floats[H_TIME] = 10.0;
        floats[H_ACTIVE] = 1.0;
        floats[H_EVENT_COUNT] = events.len() as f32;
        for (index, (time, band, strength, seq)) in events.iter().enumerate() {
            let at = AV_EVENTS_OFFSET + index * AV_EVENT_FLOATS;
            floats[at..at + 4].copy_from_slice(&[*time, *band, *strength, *seq]);
        }
        for bin in 0..AV_SPECTRUM_BINS {
            floats[AV_SPECTRUM_OFFSET + bin] = bin as f32 / AV_SPECTRUM_BINS as f32;
        }
        floats[AV_WAVEFORM_OFFSET] = -1.0;
        floats[AV_WAVEFORM_OFFSET + AV_WAVEFORM_SAMPLES - 1] = 1.0;
        bytemuck::cast_slice(&floats).to_vec()
    }

    #[test]
    fn layout_is_the_one_the_editor_packs() {
        // These numbers are mirrored in src/lib/audio/audioVisualData.ts and
        // audio_data.wgsl; changing one means changing all three.
        assert_eq!(AV_EVENTS_OFFSET, 16);
        assert_eq!(AV_SPECTRUM_OFFSET, 144);
        assert_eq!(AV_WAVEFORM_OFFSET, 272);
        assert_eq!(AV_TOTAL_FLOATS, 784);
        assert_eq!(AV_TOTAL_BYTES, 3136);
    }

    #[test]
    fn decodes_spectrum_waveform_and_round_trips_to_gpu_bytes() {
        let bytes = packet(&[]);
        let mut data = AudioVisualData::default();
        data.set_from_bytes(&bytes).unwrap();
        assert!(data.active());
        assert_eq!(data.time(), 10.0);
        assert_eq!(data.spectrum().len(), AV_SPECTRUM_BINS);
        assert!((data.spectrum()[64] - 0.5).abs() < 1e-6);
        assert_eq!(data.waveform()[0], -1.0);
        assert_eq!(data.waveform()[AV_WAVEFORM_SAMPLES - 1], 1.0);
        assert_eq!(data.gpu_bytes(), bytes);
        assert_eq!(data.seq, 1);
    }

    #[test]
    fn rejects_wrong_size_version_and_non_finite_keeping_the_last_packet() {
        let mut data = AudioVisualData::default();
        data.set_from_bytes(&packet(&[(9.5, 0.0, 1.0, 3.0)])).unwrap();
        assert!(data.set_from_bytes(&[0_u8; 16]).is_err());
        let mut wrong_version = packet(&[]);
        wrong_version[0..4].copy_from_slice(&2.0_f32.to_le_bytes());
        assert!(data.set_from_bytes(&wrong_version).is_err());
        let mut nan = packet(&[]);
        nan[400..404].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(data.set_from_bytes(&nan).is_err());
        assert_eq!(data.event_count(), 1);
        assert_eq!(data.seq, 1);
    }

    #[test]
    fn onset_ring_count_is_bounded_and_bad_bands_are_skipped() {
        let mut bytes = packet(&[(9.0, 0.0, 1.0, 1.0), (9.1, 7.0, 1.0, 2.0)]);
        bytes[H_EVENT_COUNT * 4..H_EVENT_COUNT * 4 + 4].copy_from_slice(&999.0_f32.to_le_bytes());
        let mut data = AudioVisualData::default();
        data.set_from_bytes(&bytes).unwrap();
        assert_eq!(data.event_count(), AV_EVENT_CAPACITY);
        assert!(data.event(0).is_some());
        assert!(data.event(1).is_none(), "band 7 is not a band");
        assert!(data.event(AV_EVENT_CAPACITY).is_none());
    }

    #[test]
    fn events_after_returns_new_hits_oldest_first_and_caps_them() {
        let ring = [
            (9.9, 2.0, 0.5, 12.0),
            (9.8, 1.0, 0.7, 11.0),
            (9.7, 0.0, 0.9, 10.0),
            (9.0, 0.0, 1.0, 9.0),
        ];
        let mut data = AudioVisualData::default();
        data.set_from_bytes(&packet(&ring)).unwrap();
        let fresh = data.events_after(9, 8);
        assert_eq!(fresh.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![10, 11, 12]);
        assert_eq!(fresh[0].band, OnsetBand::Bass);
        assert_eq!(fresh[2].band, OnsetBand::High);
        let capped = data.events_after(0, 2);
        assert_eq!(capped.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![11, 12]);
        assert!(data.events_after(12, 8).is_empty());
    }

    #[test]
    fn going_inactive_keeps_the_sequence_so_old_hits_do_not_replay() {
        let mut data = AudioVisualData::default();
        data.set_from_bytes(&packet(&[(9.0, 0.0, 1.0, 5.0)])).unwrap();
        let mut bytes = packet(&[(9.0, 0.0, 1.0, 5.0)]);
        bytes[H_EVENT_SEQ * 4..H_EVENT_SEQ * 4 + 4].copy_from_slice(&5.0_f32.to_le_bytes());
        data.set_from_bytes(&bytes).unwrap();
        data.set_inactive();
        assert!(!data.active());
        assert_eq!(data.event_count(), 0);
        assert_eq!(data.header(H_EVENT_SEQ), 5.0);
        assert_eq!(data.header(H_VERSION), AV_VERSION);
    }
}
