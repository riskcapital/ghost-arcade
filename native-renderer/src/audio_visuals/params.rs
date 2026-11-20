//! Param reading and colour presets shared by the audio-reactive instruments.
//! Colours are linear light with an HDR intensity in `.3`.

use serde_json::Value;

pub fn num(params: &Value, key: &str, fallback: f32) -> f32 {
    params
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .map(|v| v as f32)
        .unwrap_or(fallback)
}

pub fn text(params: &Value, key: &str) -> String {
    params
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '_'], "-")
}

/// Quality preset -> (particle budget, accumulation scale).
pub fn quality_from(params: &Value, budgets: [u32; 4]) -> (u32, f32) {
    match text(params, "quality").as_str() {
        "low" | "performance" => (budgets[0], 0.75),
        "high" => (budgets[2], 1.0),
        "ultra" | "insane" => (budgets[3], 1.0),
        _ => (budgets[1], 1.0),
    }
}

/// Two-tone strand palette: a burning core, a mid tone, a dark fringe.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palette3 {
    pub core: [f32; 4],
    pub mid: [f32; 4],
    pub fringe: [f32; 4],
}

pub const STRANDS_PALETTES: &[(&str, Palette3)] = &[
    (
        "ice-and-oxblood",
        Palette3 { core: [0.80, 0.95, 1.0, 5.0], mid: [0.10, 0.55, 1.0, 1.6], fringe: [0.45, 0.0, 0.006, 1.2] },
    ),
    (
        "molten-brass",
        Palette3 { core: [1.0, 0.85, 0.6, 6.0], mid: [1.0, 0.35, 0.04, 1.4], fringe: [0.3, 0.035, 0.0, 1.2] },
    ),
    (
        "verdigris",
        Palette3 { core: [0.75, 1.0, 0.9, 6.0], mid: [0.02, 0.7, 0.45, 1.4], fringe: [0.0, 0.025, 0.16, 1.6] },
    ),
    (
        "violet-hour",
        Palette3 { core: [0.95, 0.85, 1.0, 6.0], mid: [0.6, 0.08, 1.0, 1.4], fringe: [0.05, 0.0, 0.3, 1.6] },
    ),
];

pub fn palette_by_name(name: &str) -> Palette3 {
    STRANDS_PALETTES
        .iter()
        .find(|(id, _)| *id == name)
        .map(|(_, p)| *p)
        .unwrap_or(STRANDS_PALETTES[0].1)
}

/// Cloud Pulse colours: one per band wave, plus the dim tint of the scan.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CloudPalette {
    pub bass: [f32; 4],
    pub mid: [f32; 4],
    pub high: [f32; 4],
    /// rgb tint, `.3` = how much of the scan's own colour shows.
    pub base: [f32; 4],
}

pub const CLOUD_PALETTES: &[(&str, CloudPalette)] = &[
    (
        "survey",
        CloudPalette {
            bass: [1.0, 0.42, 0.08, 3.2],
            mid: [0.55, 0.88, 1.0, 3.0],
            high: [0.92, 0.88, 1.0, 4.0],
            base: [0.36, 0.42, 0.5, 0.65],
        },
    ),
    (
        "ice-and-oxblood",
        CloudPalette {
            bass: [0.62, 0.025, 0.035, 4.0],
            mid: [0.32, 0.78, 1.0, 3.0],
            high: [0.95, 0.98, 1.0, 4.5],
            base: [0.3, 0.33, 0.38, 0.45],
        },
    ),
    (
        "thermal",
        CloudPalette {
            bass: [1.0, 0.1, 0.02, 3.6],
            mid: [1.0, 0.62, 0.16, 3.0],
            high: [1.0, 0.97, 0.85, 4.2],
            base: [0.4, 0.3, 0.26, 0.55],
        },
    ),
    // Cloud Flock: a still scan in cool silver, moving points burn gold.
    (
        "starling",
        CloudPalette {
            bass: [1.0, 0.5, 0.1, 3.0],
            mid: [1.0, 0.62, 0.22, 2.4],
            high: [1.0, 0.93, 0.8, 5.0],
            base: [0.42, 0.5, 0.62, 0.35],
        },
    ),
    // Cloud Flock: ash-grey rest, embers in motion.
    (
        "ember-swarm",
        CloudPalette {
            bass: [1.0, 0.2, 0.04, 3.0],
            mid: [1.0, 0.16, 0.03, 2.6],
            high: [1.0, 0.6, 0.25, 4.5],
            base: [0.36, 0.34, 0.33, 0.25],
        },
    ),
    // Depth Lights: sodium near, cold white far, over a deep blue scan.
    (
        "harbour",
        CloudPalette {
            bass: [1.0, 0.45, 0.08, 3.0],
            mid: [1.0, 0.5, 0.1, 4.0],
            high: [0.7, 0.85, 1.0, 4.0],
            base: [0.12, 0.2, 0.45, 0.2],
        },
    ),
    // Depth Lights: ice blue near to violet far, over graphite.
    (
        "glacier",
        CloudPalette {
            bass: [0.4, 0.8, 1.0, 3.0],
            mid: [0.45, 0.85, 1.0, 4.0],
            high: [0.75, 0.35, 1.0, 4.0],
            base: [0.3, 0.32, 0.36, 0.25],
        },
    ),
];

pub fn cloud_palette_by_name(name: &str) -> CloudPalette {
    CLOUD_PALETTES
        .iter()
        .find(|(id, _)| *id == name)
        .map(|(_, p)| *p)
        .unwrap_or(CLOUD_PALETTES[0].1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_names_fall_back_to_the_first_preset() {
        assert_eq!(palette_by_name("nope"), STRANDS_PALETTES[0].1);
        assert_eq!(palette_by_name("verdigris"), STRANDS_PALETTES[2].1);
        assert_eq!(cloud_palette_by_name("thermal"), CLOUD_PALETTES[2].1);
        assert_eq!(text(&serde_json::json!({"p": "Ice and_Oxblood"}), "p"), "ice-and-oxblood");
    }

    #[test]
    fn every_strand_palette_has_a_core_hotter_than_its_fringe() {
        for (id, p) in STRANDS_PALETTES {
            assert!(p.core[3] > p.mid[3] && p.mid[3] > 0.5, "{id}");
            let luma = |c: [f32; 4]| (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * c[3];
            assert!(luma(p.core) > luma(p.mid) * 2.0 && luma(p.mid) > luma(p.fringe), "{id}");
        }
    }
}
