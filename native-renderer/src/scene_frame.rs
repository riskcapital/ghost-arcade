//! The scene frame block: one uniform buffer the core writes every frame for
//! a `scene3d` layer, so a scene graph reads time, audio and the beat without
//! the app resending anything.
//!
//! A graph opts in by naming a uniform buffer `<anything>:scene3d:frame` of at
//! least `BYTES` bytes. The layout is fixed and documented here only; the app
//! reads it from `src/lib/renderer/scene3dFrame.ts`, and a test there checks
//! the two agree. Add fields at the end, never reorder.
//!
//! | slot | field        | meaning                                              |
//! |------|--------------|------------------------------------------------------|
//! | 0    | time         | render clock, seconds                                |
//! | 1    | delta        | seconds since the last frame, at most 0.1            |
//! | 2    | frame        | frame index, wraps at 2^24 so it stays exact in f32  |
//! | 3    | audio_active | 1 while audio analysis is running, else 0            |
//! | 4    | bass         | smoothed band level, 0..1                            |
//! | 5    | mid          | smoothed band level, 0..1                            |
//! | 6    | treble       | smoothed band level, 0..1                            |
//! | 7    | energy       | smoothed overall level, 0..1                         |
//! | 8    | beat         | smoothed beat pulse, 0..1                            |
//! | 9    | kick         | kick hit as analysed, 0..1 (an impulse, not smoothed) |
//! | 10   | snare        | snare hit as analysed, 0..1 (an impulse)             |
//! | 11   | centroid     | spectral brightness, 0..1                            |
//! | 12   | tempo        | beats per minute, 0 when unknown                     |
//! | 13   | beat_phase   | position in the beat, 0..1                           |
//! | 14   | bar_phase    | position in the bar, 0..1                            |
//! | 15   | beats        | beats counted since the core started, wraps at 2^24  |

use serde_json::{json, Value};

pub(crate) const BUFFER_SUFFIX: &str = ":scene3d:frame";
pub(crate) const FIELDS: [&str; 16] = [
    "time",
    "delta",
    "frame",
    "audio_active",
    "bass",
    "mid",
    "treble",
    "energy",
    "beat",
    "kick",
    "snare",
    "centroid",
    "tempo",
    "beat_phase",
    "bar_phase",
    "beats",
];
pub(crate) const FLOATS: usize = FIELDS.len();
pub(crate) const BYTES: usize = FLOATS * 4;

/// Counts wrap past 2^24 so an f32 still holds every integer.
const COUNTER_WRAP: u64 = 1 << 24;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct SceneFrame {
    pub(crate) time: f32,
    pub(crate) delta: f32,
    pub(crate) frame: u64,
    pub(crate) audio_active: bool,
    pub(crate) bass: f32,
    pub(crate) mid: f32,
    pub(crate) treble: f32,
    pub(crate) energy: f32,
    pub(crate) beat: f32,
    pub(crate) kick: f32,
    pub(crate) snare: f32,
    pub(crate) centroid: f32,
    pub(crate) tempo: f32,
    pub(crate) beat_phase: f32,
    pub(crate) bar_phase: f32,
    pub(crate) beats: u64,
}

impl SceneFrame {
    pub(crate) fn values(&self) -> [f32; FLOATS] {
        let unit = |v: f32| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
        [
            self.time,
            self.delta,
            (self.frame % COUNTER_WRAP) as f32,
            if self.audio_active { 1.0 } else { 0.0 },
            unit(self.bass),
            unit(self.mid),
            unit(self.treble),
            unit(self.energy),
            unit(self.beat),
            unit(self.kick),
            unit(self.snare),
            unit(self.centroid),
            if self.tempo.is_finite() { self.tempo.clamp(0.0, 300.0) } else { 0.0 },
            unit(self.beat_phase),
            unit(self.bar_phase),
            (self.beats % COUNTER_WRAP) as f32,
        ]
    }

    /// Write the block at the start of a uniform buffer's bytes. A buffer
    /// shorter than `BYTES` is left alone.
    pub(crate) fn write(&self, bytes: &mut [u8]) -> bool {
        if bytes.len() < BYTES {
            return false;
        }
        for (slot, value) in self.values().iter().enumerate() {
            bytes[slot * 4..slot * 4 + 4].copy_from_slice(&value.to_le_bytes());
        }
        true
    }
}

/// Beats and bar position from the beat phase the app sends. The app may also
/// send where it is in the bar (`bar_phase`, from the Timeline's tempo map or
/// Live); without that, bars are counted from the first beat the core saw.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SceneClock {
    beats: u64,
    last_phase: Option<f32>,
    last_frame: Option<u64>,
    pub(crate) beats_per_bar: u32,
    /// Bar position from the app, when it knows it.
    pub(crate) bar_phase_hint: Option<f32>,
}

impl Default for SceneClock {
    fn default() -> Self {
        Self { beats: 0, last_phase: None, last_frame: None, beats_per_bar: 4, bar_phase_hint: None }
    }
}

impl SceneClock {
    /// Once per frame (later calls for the same frame are ignored): a beat is
    /// counted when the phase wraps from near 1 back to near 0.
    pub(crate) fn advance(&mut self, frame: u64, beat_phase: f32) {
        if self.last_frame == Some(frame) {
            return;
        }
        self.last_frame = Some(frame);
        let phase = if beat_phase.is_finite() { beat_phase.clamp(0.0, 1.0) } else { 0.0 };
        if let Some(last) = self.last_phase {
            if last - phase > 0.5 {
                self.beats = self.beats.wrapping_add(1);
            }
        }
        self.last_phase = Some(phase);
    }

    pub(crate) fn beats(&self) -> u64 {
        self.beats
    }

    pub(crate) fn bar_phase(&self, beat_phase: f32) -> f32 {
        if let Some(hint) = self.bar_phase_hint.filter(|v| v.is_finite()) {
            return hint.clamp(0.0, 1.0);
        }
        let per_bar = self.beats_per_bar.max(1) as u64;
        let phase = if beat_phase.is_finite() { beat_phase.clamp(0.0, 0.999_999) } else { 0.0 };
        ((self.beats % per_bar) as f32 + phase) / per_bar as f32
    }
}

/// The layout as data, for the core's capabilities.
pub(crate) fn layout() -> Value {
    json!({ "buffer_suffix": BUFFER_SUFFIX, "bytes": BYTES, "fields": FIELDS })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn float_at(bytes: &[u8], slot: usize) -> f32 {
        f32::from_le_bytes(bytes[slot * 4..slot * 4 + 4].try_into().unwrap())
    }

    #[test]
    fn writes_every_field_at_its_slot() {
        let frame = SceneFrame {
            time: 12.5,
            delta: 0.016,
            frame: 900,
            audio_active: true,
            bass: 0.1,
            mid: 0.2,
            treble: 0.3,
            energy: 0.4,
            beat: 0.5,
            kick: 0.6,
            snare: 0.7,
            centroid: 0.8,
            tempo: 128.0,
            beat_phase: 0.25,
            bar_phase: 0.5625,
            beats: 33,
        };
        let mut bytes = vec![0u8; BYTES + 8];
        assert!(frame.write(&mut bytes));
        let expected = [12.5, 0.016, 900.0, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 128.0, 0.25, 0.5625, 33.0];
        for (slot, value) in expected.iter().enumerate() {
            assert_eq!(float_at(&bytes, slot), *value, "slot {slot} ({})", FIELDS[slot]);
        }
        // Bytes past the block are not touched.
        assert_eq!(&bytes[BYTES..], &[0u8; 8]);
    }

    #[test]
    fn short_buffers_are_left_alone() {
        let mut bytes = vec![7u8; BYTES - 4];
        assert!(!SceneFrame::default().write(&mut bytes));
        assert!(bytes.iter().all(|b| *b == 7));
    }

    #[test]
    fn values_are_clamped_and_counters_wrap() {
        let frame = SceneFrame {
            bass: 3.0,
            mid: f32::NAN,
            tempo: 999.0,
            frame: COUNTER_WRAP + 5,
            beats: COUNTER_WRAP * 2 + 1,
            ..SceneFrame::default()
        };
        let v = frame.values();
        assert_eq!(v[4], 1.0);
        assert_eq!(v[5], 0.0);
        assert_eq!(v[12], 300.0);
        assert_eq!(v[2], 5.0);
        assert_eq!(v[15], 1.0);
    }

    #[test]
    fn beats_count_on_each_phase_wrap_once_per_frame() {
        let mut clock = SceneClock::default();
        let mut frame = 0;
        for phase in [0.1, 0.5, 0.9, 0.05, 0.5, 0.95, 0.02] {
            frame += 1;
            clock.advance(frame, phase);
            // A second layer reading the same frame does not count again.
            clock.advance(frame, phase);
        }
        assert_eq!(clock.beats(), 2);
    }

    #[test]
    fn bar_phase_counts_bars_or_uses_the_app_hint() {
        let mut clock = SceneClock::default();
        let mut frame = 0;
        // Five beats in: beat 1 of the second bar (0-based beat 5 % 4 = 1).
        for _ in 0..5 {
            for phase in [0.2, 0.9] {
                frame += 1;
                clock.advance(frame, phase);
            }
            frame += 1;
            clock.advance(frame, 0.0);
        }
        assert_eq!(clock.beats(), 5);
        assert!((clock.bar_phase(0.5) - (1.0 + 0.5) / 4.0).abs() < 1e-6);
        clock.beats_per_bar = 3;
        assert!((clock.bar_phase(0.0) - 2.0 / 3.0).abs() < 1e-6);
        clock.bar_phase_hint = Some(0.75);
        assert_eq!(clock.bar_phase(0.1), 0.75);
    }
}
