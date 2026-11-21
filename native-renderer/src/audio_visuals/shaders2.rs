//! WGSL for the second set of audio-reactive instruments, compiled into the
//! core like `shaders.rs` (which falls back to this table).

use std::sync::OnceLock;

use super::shaders::CoreShader;

pub const RIBBON_SIM: &str = "ribbon-field/sim-v1";
pub const RIBBON_DRAW: &str = "ribbon-field/draw-v1";
pub const SHOCKWAVE_DRAW: &str = "shockwave-rings/draw-v1";
pub const SHOCKWAVE_REFRACT: &str = "shockwave-rings/refract-v1";
pub const FLUID_INK: &str = "fluid-ink/solve-v1";
pub const ARCS_DRAW: &str = "arcs/draw-v1";
pub const TERRAIN_ROW: &str = "spectral-terrain/row-v1";
pub const TERRAIN_DRAW: &str = "spectral-terrain/draw-v1";
pub const SHATTER_SHARDS: &str = "mesh-shatter/shards-v1";
pub const SHATTER_DRAW: &str = "mesh-shatter/draw-v1";
pub const AV2_FINISH: &str = "audio-visuals/finish-v1";

static NOISE: &str = include_str!("wgsl/noise.wgsl");
static AUDIO_DATA: &str = include_str!("wgsl/audio_data.wgsl");
static POST_SRC: &str = include_str!("wgsl/post.wgsl");
static CLOUD_COMMON: &str = include_str!("wgsl/cloud_common.wgsl");
static FINISH_SRC: &str = include_str!("wgsl/av2_finish.wgsl");
static RIBBON_COMMON: &str = include_str!("wgsl/ribbon_field.wgsl");
static RIBBON_SIM_SRC: &str = include_str!("wgsl/ribbon_sim.wgsl");
static RIBBON_DRAW_SRC: &str = include_str!("wgsl/ribbon_draw.wgsl");
static VIEW2: &str = include_str!("wgsl/view2.wgsl");
static SHOCK_COMMON: &str = include_str!("wgsl/shockwave_common.wgsl");
static SHOCK_DRAW_SRC: &str = include_str!("wgsl/shockwave_draw.wgsl");
static SHOCK_REFRACT_SRC: &str = include_str!("wgsl/shockwave_refract.wgsl");
static FLUID_SRC: &str = include_str!("wgsl/fluid_ink.wgsl");
static ARCS_SRC: &str = include_str!("wgsl/arcs.wgsl");
static TERRAIN_COMMON: &str = include_str!("wgsl/terrain_common.wgsl");
static TERRAIN_ROW_SRC: &str = include_str!("wgsl/terrain_row.wgsl");
static TERRAIN_DRAW_SRC: &str = include_str!("wgsl/terrain_draw.wgsl");
static SHATTER_COMMON: &str = include_str!("wgsl/shatter_common.wgsl");
static SHATTER_SHARDS_SRC: &str = include_str!("wgsl/shatter_shards.wgsl");
static SHATTER_DRAW_SRC: &str = include_str!("wgsl/shatter_draw.wgsl");

fn build(id: &'static str, parts: &[&str]) -> CoreShader {
    let source: String = parts.join("\n");
    let hash = crate::stable_hash64(&source);
    CoreShader { id, source: std::sync::Arc::from(source), hash }
}

pub(super) fn all() -> &'static [CoreShader] {
    static SHADERS: OnceLock<Vec<CoreShader>> = OnceLock::new();
    SHADERS.get_or_init(|| {
        vec![
            build(RIBBON_SIM, &[NOISE, RIBBON_COMMON, RIBBON_SIM_SRC]),
            build(RIBBON_DRAW, &[NOISE, RIBBON_COMMON, RIBBON_DRAW_SRC]),
            build(SHOCKWAVE_DRAW, &[NOISE, VIEW2, SHOCK_COMMON, SHOCK_DRAW_SRC]),
            build(SHOCKWAVE_REFRACT, &[POST_SRC, FINISH_SRC, VIEW2, SHOCK_COMMON, SHOCK_REFRACT_SRC]),
            build(AV2_FINISH, &[POST_SRC, FINISH_SRC]),
            build(FLUID_INK, &[NOISE, VIEW2, FLUID_SRC]),
            build(ARCS_DRAW, &[NOISE, VIEW2, ARCS_SRC]),
            build(TERRAIN_ROW, &[AUDIO_DATA, TERRAIN_COMMON, TERRAIN_ROW_SRC]),
            build(TERRAIN_DRAW, &[NOISE, TERRAIN_COMMON, TERRAIN_DRAW_SRC]),
            build(SHATTER_SHARDS, &[NOISE, CLOUD_COMMON, SHATTER_COMMON, SHATTER_SHARDS_SRC]),
            build(SHATTER_DRAW, &[NOISE, CLOUD_COMMON, SHATTER_COMMON, SHATTER_DRAW_SRC]),
        ]
    })
}

pub(super) fn find(id: &str) -> Option<&'static CoreShader> {
    all().iter().find(|shader| shader.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_second_set_shader_parses_and_validates() {
        for shader in all() {
            let module = naga::front::wgsl::parse_str(&shader.source)
                .unwrap_or_else(|err| panic!("{}: {}", shader.id, err.emit_to_string(&shader.source)));
            naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::all())
                .validate(&module)
                .unwrap_or_else(|err| panic!("{}: {err:?}", shader.id));
        }
    }

    #[test]
    fn entry_points_the_second_set_builders_use_exist() {
        let wants: &[(&str, &[&str])] = &[
            (RIBBON_SIM, &["cs_ribbons"]),
            (RIBBON_DRAW, &["vs_ribbon", "fs_ribbon"]),
            (SHOCKWAVE_DRAW, &["vs_ring", "vs_dust", "fs_soft"]),
            (AV2_FINISH, &["vs_full", "fs_composite_finish"]),
            (SHOCKWAVE_REFRACT, &["vs_full", "fs_composite_refract"]),
            (
                FLUID_INK,
                &[
                    "vs_full", "fs_splat_velocity", "fs_advect_velocity", "fs_curl", "fs_vorticity", "fs_divergence",
                    "fs_jacobi", "fs_gradient", "fs_splat_dye", "fs_advect_dye", "fs_display", "fs_clear",
                ],
            ),
            (ARCS_DRAW, &["vs_arc", "fs_arc", "vs_node", "fs_node"]),
            (TERRAIN_ROW, &["cs_row"]),
            (TERRAIN_DRAW, &["vs_terrain", "fs_terrain"]),
            (SHATTER_SHARDS, &["cs_shards"]),
            (SHATTER_DRAW, &["vs_shatter", "fs_point"]),
        ];
        for (id, entries) in wants {
            let shader = find(id).unwrap();
            let module = naga::front::wgsl::parse_str(&shader.source).unwrap();
            for entry in *entries {
                assert!(module.entry_points.iter().any(|e| e.name == *entry), "{id} lacks {entry}");
            }
        }
    }
}
