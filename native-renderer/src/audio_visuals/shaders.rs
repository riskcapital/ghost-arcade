//! WGSL for the audio-reactive instruments, compiled into the core. Each
//! module is a few shared files (noise, emitter shapes, the audio packet)
//! joined with the instrument's own; the core hands the joined source to the
//! graph like any other shader, so nothing has to be precompiled by the app.

use std::sync::{Arc, OnceLock};

pub const STRANDS_SIM: &str = "strands/sim-v2";
pub const STRANDS_DRAW: &str = "strands/draw-v2";
pub const CLOUD_PULSE_LIGHT: &str = "cloud-pulse/light-v2";
pub const HDR_POST: &str = "audio-visuals/hdr-post-v1";
pub const FLOCK_SIM: &str = "cloud-flock/sim-v2";
pub const DEPTH_LIGHTS_LIGHT: &str = "depth-lights/light-v2";
pub const SPRITE_DRAW: &str = "audio-visuals/sprite-draw-v1";

static NOISE: &str = include_str!("wgsl/noise.wgsl");
static EMITTER: &str = include_str!("wgsl/emitter.wgsl");
static AUDIO_DATA: &str = include_str!("wgsl/audio_data.wgsl");
static STRANDS_COMMON: &str = include_str!("wgsl/strands_common.wgsl");
static STRANDS_SIM_SRC: &str = include_str!("wgsl/strands_sim.wgsl");
static STRANDS_DRAW_SRC: &str = include_str!("wgsl/strands_draw.wgsl");
static CLOUD_SRC: &str = include_str!("wgsl/cloud_pulse.wgsl");
static POST_SRC: &str = include_str!("wgsl/post.wgsl");
static CLOUD_COMMON: &str = include_str!("wgsl/cloud_common.wgsl");
static FLOCK_COMMON: &str = include_str!("wgsl/flock_common.wgsl");
static FLOCK_SIM_SRC: &str = include_str!("wgsl/flock_sim.wgsl");
static SPRITE_SRC: &str = include_str!("wgsl/sprite_draw.wgsl");
static DEPTH_SRC: &str = include_str!("wgsl/depth_lights.wgsl");

pub struct CoreShader {
    pub id: &'static str,
    pub source: Arc<str>,
    pub hash: u64,
}

fn build(id: &'static str, parts: &[&str]) -> CoreShader {
    let source: String = parts.join("\n");
    let hash = crate::stable_hash64(&source);
    CoreShader { id, source: Arc::from(source), hash }
}

fn all() -> &'static [CoreShader; 7] {
    static SHADERS: OnceLock<[CoreShader; 7]> = OnceLock::new();
    SHADERS.get_or_init(|| {
        [
            build(STRANDS_SIM, &[NOISE, EMITTER, AUDIO_DATA, STRANDS_COMMON, STRANDS_SIM_SRC]),
            build(STRANDS_DRAW, &[STRANDS_COMMON, STRANDS_DRAW_SRC]),
            build(CLOUD_PULSE_LIGHT, &[NOISE, CLOUD_COMMON, CLOUD_SRC]),
            build(HDR_POST, &[POST_SRC]),
            build(FLOCK_SIM, &[NOISE, CLOUD_COMMON, FLOCK_COMMON, FLOCK_SIM_SRC]),
            build(DEPTH_LIGHTS_LIGHT, &[NOISE, CLOUD_COMMON, DEPTH_SRC]),
            build(SPRITE_DRAW, &[CLOUD_COMMON, SPRITE_SRC]),
        ]
    })
}

pub fn core_shader(id: &str) -> &'static CoreShader {
    all().iter().find(|shader| shader.id == id).expect("audio visual shader id")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parse and validate every module the way the GPU compiler will see it,
    /// so a WGSL mistake fails here instead of as a black layer.
    #[test]
    fn every_core_shader_parses_and_validates() {
        for shader in all() {
            let module = naga::front::wgsl::parse_str(&shader.source)
                .unwrap_or_else(|err| panic!("{}: {}", shader.id, err.emit_to_string(&shader.source)));
            naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::all())
                .validate(&module)
                .unwrap_or_else(|err| panic!("{}: {err:?}", shader.id));
        }
    }

    #[test]
    fn entry_points_the_builders_use_exist() {
        let wants: &[(&str, &[&str])] = &[
            (STRANDS_SIM, &["cs_main"]),
            (STRANDS_DRAW, &["vs_trail", "fs_trail"]),
            (CLOUD_PULSE_LIGHT, &["cs_pulse"]),
            (FLOCK_SIM, &["cs_flock"]),
            (DEPTH_LIGHTS_LIGHT, &["cs_depth"]),
            (SPRITE_DRAW, &["vs_sprite", "fs_point"]),
            (HDR_POST, &["vs_full", "fs_feedback", "fs_down_first", "fs_down", "fs_up", "fs_composite"]),
        ];
        for (id, entries) in wants {
            let shader = core_shader(id);
            let module = naga::front::wgsl::parse_str(&shader.source).unwrap();
            for entry in *entries {
                assert!(module.entry_points.iter().any(|e| e.name == *entry), "{id} lacks {entry}");
            }
        }
    }

    #[test]
    fn manifest_core_shader_ids_are_the_ones_compiled_in() {
        for spec in crate::native_graph_manifest::NATIVE_GRAPH_INSTRUMENT_SPECS {
            if spec.shader_source == crate::native_graph_manifest::ShaderSource::Core {
                for id in spec.shader_ids {
                    assert!(all().iter().any(|shader| shader.id == *id), "{} lists {id}", spec.id);
                }
            }
        }
    }
}
