use serde_json::{Value, json};

/// Where an instrument's shaders come from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShaderSource {
    /// Shaders built into the core, listed in `shader_ids` and warmed up front.
    Builtin,
    /// Shaders the app sends with each graph (an Interactive 3D scene, a
    /// video synthesizer patch); `shader_ids` is empty by design.
    Runtime,
    /// Shaders compiled into the core itself: listed in `shader_ids`, nothing
    /// for the app to precompile.
    Core,
}

impl ShaderSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ShaderSource::Builtin => "builtin",
            ShaderSource::Runtime => "runtime",
            ShaderSource::Core => "core",
        }
    }
}

pub struct NativeGraphInstrumentSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub shader_source: ShaderSource,
    pub shader_ids: &'static [&'static str],
    pub features: &'static [&'static str],
    pub parity: &'static str,
}

pub const NATIVE_GRAPH_INSTRUMENT_SPECS: &[NativeGraphInstrumentSpec] = &[
    NativeGraphInstrumentSpec {
        id: "svg",
        label: "SVG",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["svg/render-v6", "svg/transform-v6"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "native_svg_graph",
        ],
        parity: "packed-contour-fill-and-outline",
    },
    NativeGraphInstrumentSpec {
        id: "lines",
        label: "Lines",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["lines/render"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "native_lines_graph",
        ],
        parity: "single-pass-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "light-painting",
        label: "Light Painting",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["light-painting/render-v8"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "native_light_painting_graph",
        ],
        parity: "shared-lines-wgsl-supported-brush-adapter",
    },
    NativeGraphInstrumentSpec {
        id: "text",
        label: "Text",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["text/render-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "native_text_graph",
        ],
        parity: "atlas-instanced-glyphs",
    },
    NativeGraphInstrumentSpec {
        id: "splat",
        label: "Splat / Point Cloud",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["splat/render-v1", "splat/shadowvol-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_instanced_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_splat_graph",
        ],
        parity: "instanced-point-quads",
    },
    NativeGraphInstrumentSpec {
        id: "model3d",
        label: "3D Model",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["model3d/render-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_texture_sampling",
            "compute_graph_depth_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_model3d_graph",
        ],
        parity: "flattened-mesh-storage-pull",
    },
    NativeGraphInstrumentSpec {
        id: "planet",
        label: "Planet",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["planet/render"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_instanced_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "native_planet_graph",
        ],
        parity: "single-pass-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "smoke-3d",
        label: "3D Smoke",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "3d-smoke/splat",
            "3d-smoke/advect-velocity",
            "3d-smoke/divergence",
            "3d-smoke/jacobi",
            "3d-smoke/subtract-gradient",
            "3d-smoke/advect-density",
            "3d-smoke/render",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_indirect_render",
            "compute_graph_texture_sampling",
            "compute_graph_depth_render",
            "compute_graph_line_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_3d_smoke_graph",
        ],
        parity: "fluid-sim-multipass-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "particle-field",
        label: "Particle Field",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "particle-field/behavior",
            "particle-field/edges",
            "particle-field/fog",
            "particle-field/render",
            "particle-field/lines",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_depth_render",
            "compute_graph_line_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_particle_field_graph",
        ],
        parity: "behavior-render-edges-and-media-source-frame-routing",
    },
    NativeGraphInstrumentSpec {
        id: "volumetric-spheres",
        label: "Volumetric Spheres",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "volumetric-spheres/sim",
            "volumetric-spheres/links",
            "volumetric-spheres/tiles",
            "volumetric-spheres/shadow",
            "volumetric-spheres/render",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_volumetric_spheres_graph",
        ],
        parity: "spatial-hash-links-opacity-volume-raytraced-render",
    },
    NativeGraphInstrumentSpec {
        id: "fluid-riders",
        label: "Fluid Riders",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "3d-smoke/splat",
            "3d-smoke/advect-velocity",
            "3d-smoke/divergence",
            "3d-smoke/jacobi",
            "3d-smoke/subtract-gradient",
            "3d-smoke/advect-density",
            "fluid-riders/vorticity",
            "fluid-riders/pressure",
            "fluid-riders/advect",
            "fluid-riders/surface",
            "fluid-riders/riders",
            "fluid-riders/tiles",
            "fluid-riders/shadowvol",
            "fluid-riders/render",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_3d_smoke_graph",
            "native_smoke_riders_graph",
        ],
        parity: "fluid-coupled-riders-single-raymarch-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "smoke-riders",
        label: "Smoke Riders",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "3d-smoke/splat",
            "3d-smoke/advect-velocity",
            "3d-smoke/divergence",
            "3d-smoke/jacobi",
            "3d-smoke/subtract-gradient",
            "3d-smoke/advect-density",
            "smoke-riders/vorticity",
            "smoke-riders/pressure",
            "smoke-riders/advect",
            "smoke-riders/surface",
            "smoke-riders/riders",
            "smoke-riders/tiles",
            "smoke-riders/shadowvol",
            "smoke-riders/render",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_3d_smoke_graph",
            "native_smoke_riders_graph",
        ],
        parity: "fluid-coupled-riders-single-raymarch-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "ink-cloud",
        label: "Ink Cloud",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["ink-cloud/sim", "ink-cloud/render", "ink-cloud/background"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_ink_cloud_graph",
        ],
        parity: "sim-background-render-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "flythrough",
        label: "Flythrough",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "flythrough/curl-bake",
            "flythrough/compute",
            "flythrough/render",
            "flythrough/render-lit",
            "particle-director/poi-grid",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_flythrough_graph",
        ],
        parity: "compute-render-source-frame-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "pixel-particles",
        label: "Pixel Particles",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "pixel-particles/compute",
            "pixel-particles/render",
            "pixel-particles/render-lit",
            "particle-director/poi-grid",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_pixel_particles_graph",
        ],
        parity: "compute-render-source-frame-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "point-cloud-fx",
        label: "Point Cloud FX",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "point-cloud-fx/compute",
            "point-cloud-fx/sort-fill",
            "point-cloud-fx/sort-step",
            "point-cloud-fx/render",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_point_cloud_fx_graph",
        ],
        parity: "native-point-cloud-gaussian-buffer-render-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "ghostfx",
        label: "GhostFX",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "ghostfx/drift-compute",
            "ghostfx/drift-render",
            "ghostfx/ribbons-compute",
            "ghostfx/ribbons-render",
            "ghostfx/spheres-compute",
            "ghostfx/spheres-render",
            "ghostfx/liquid-splat",
            "ghostfx/liquid-advect-vel",
            "ghostfx/liquid-divergence",
            "ghostfx/liquid-jacobi",
            "ghostfx/liquid-subtract",
            "ghostfx/liquid-advect-dye",
            "ghostfx/liquid-render",
            "ghostfx/liquid-bubbles-sim",
            "ghostfx/liquid-bubbles-render",
            "ghostfx/voyage",
            "ghostfx/post",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_ghostfx_graph",
        ],
        parity: "persistent-native-compute-render-plugin-graph",
    },
    NativeGraphInstrumentSpec {
        id: "vj-crossfade",
        label: "VJ Crossfade",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["vj-crossfade/render"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_vj_crossfade_graph",
        ],
        parity: "native-two-bank-transition-mix-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "vj-mix",
        label: "VJ Mix",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["vj-mix/render"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_vj_mix_graph",
        ],
        parity: "native-post-crossfade-row-stack-composite",
    },
    NativeGraphInstrumentSpec {
        id: "handfx",
        label: "HandFX",
        shader_source: ShaderSource::Builtin,
        shader_ids: &[
            "handfx/compute",
            "handfx/render",
            "handfx/field-sim",
            "handfx/field-fluid",
            "handfx/field-render",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_line_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_handfx_graph",
        ],
        parity: "persistent-native-mediapipe-input-render-graph",
    },
    NativeGraphInstrumentSpec {
        id: "performer-world",
        label: "Performer World Overlay",
        shader_source: ShaderSource::Builtin,
        shader_ids: &["performer-world/render"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_performer_world_graph",
        ],
        parity: "native-performer-world-overlay-with-xy-and-movement-spaces",
    },
    NativeGraphInstrumentSpec {
        id: "scene3d",
        label: "Interactive 3D",
        // A scene brings its own shaders with its graph; none are built in.
        shader_source: ShaderSource::Runtime,
        shader_ids: &[],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "compute_graph_textures",
            "persistent_compute_buffers",
            "native_scene3d_graph",
        ],
        parity: "native-scene3d-template-with-graph-textures-and-frame-block",
    },
    NativeGraphInstrumentSpec {
        id: "videosynth",
        label: "Video synthesizer",
        // Its shaders come with its graph.
        shader_source: ShaderSource::Runtime,
        shader_ids: &[],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_source_frame_target",
            "compute_graph_textures",
            "persistent_compute_buffers",
            "native_videosynth_graph",
        ],
        parity: "native-videosynth-template-with-feedback-textures-and-frame-block",
    },
    NativeGraphInstrumentSpec {
        id: "strands",
        label: "Strands",
        shader_source: ShaderSource::Core,
        shader_ids: &["strands/sim-v2", "strands/draw-v2", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_strands_graph",
        ],
        parity: "core-wgsl-onset-shapes-hdr-feedback-bloom",
    },
    NativeGraphInstrumentSpec {
        id: "cloud-pulse",
        label: "Cloud Pulse",
        shader_source: ShaderSource::Core,
        shader_ids: &["cloud-pulse/light-v2", "audio-visuals/sprite-draw-v1", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_cloud_pulse_graph",
        ],
        parity: "core-wgsl-point-cloud-band-waves-hdr-bloom",
    },
    NativeGraphInstrumentSpec {
        id: "cloud-flock",
        label: "Cloud Flock",
        shader_source: ShaderSource::Core,
        shader_ids: &["cloud-flock/sim-v3", "cloud-flock/grid-v1", "audio-visuals/sprite-draw-v1", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_cloud_flock_graph",
        ],
        parity: "core-wgsl-point-cloud-kick-scatter-spring-reform",
    },
    NativeGraphInstrumentSpec {
        id: "depth-lights",
        label: "Depth Lights",
        shader_source: ShaderSource::Core,
        shader_ids: &["depth-lights/light-v2", "audio-visuals/sprite-draw-v1", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_depth_lights_graph",
        ],
        parity: "core-wgsl-point-cloud-depth-slices-spectrum-onsets",
    },
    NativeGraphInstrumentSpec {
        id: "ribbon-field",
        label: "Ribbon Field",
        shader_source: ShaderSource::Core,
        shader_ids: &["ribbon-field/sim-v1", "ribbon-field/draw-v1", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_ribbon_field_graph",
        ],
        parity: "core-wgsl-curl-flow-ribbon-history-lit-silk",
    },
    NativeGraphInstrumentSpec {
        id: "shockwave-rings",
        label: "Shockwave Rings",
        shader_source: ShaderSource::Core,
        shader_ids: &["shockwave-rings/draw-v1", "shockwave-rings/refract-v1", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_shockwave_rings_graph",
        ],
        parity: "core-wgsl-onset-rings-refracted-feedback",
    },
    NativeGraphInstrumentSpec {
        id: "fluid-ink",
        label: "Fluid Ink",
        shader_source: ShaderSource::Core,
        shader_ids: &["fluid-ink/solve-v1", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_fluid_ink_graph",
        ],
        parity: "core-wgsl-2d-stable-fluid-onset-ink-bass-swirl",
    },
    NativeGraphInstrumentSpec {
        id: "lightning-arcs",
        label: "Lightning Arcs",
        shader_source: ShaderSource::Core,
        shader_ids: &["arcs/draw-v1", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_lightning_arcs_graph",
        ],
        parity: "core-wgsl-seeded-midpoint-arcs-hdr-afterimage",
    },
    NativeGraphInstrumentSpec {
        id: "spectral-terrain",
        label: "Spectral Terrain",
        shader_source: ShaderSource::Core,
        shader_ids: &["spectral-terrain/row-v1", "spectral-terrain/draw-v1", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_spectral_terrain_graph",
        ],
        parity: "core-wgsl-spectrogram-ring-heightfield-flyover",
    },
    NativeGraphInstrumentSpec {
        id: "mesh-shatter",
        label: "Mesh Shatter",
        shader_source: ShaderSource::Core,
        shader_ids: &["mesh-shatter/shards-v1", "mesh-shatter/points-v1", "mesh-shatter/draw-v2", "audio-visuals/hdr-post-v1"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_texture_sampling",
            "compute_graph_textures",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_audio_visual_data",
            "native_hdr_post_chain",
            "native_mesh_shatter_graph",
        ],
        parity: "core-wgsl-point-cloud-rigid-shards-break-reform",
    },
];

pub fn native_graph_instruments_note() -> &'static str {
    "Native graph instruments use shared WGSL, including persistent GhostFX, HandFX, Performer world overlay and Interactive 3D graphs; the legacy native lookalike proxy path is disabled."
}

pub fn native_graph_instrument_ids() -> Vec<&'static str> {
    NATIVE_GRAPH_INSTRUMENT_SPECS
        .iter()
        .map(|spec| spec.id)
        .collect()
}

/// Live control definitions an instrument publishes for the layer panel, in
/// the app's `ParamControl` shape (kind, key, label, group, range, default).
/// Instruments without any publish an empty list. Additive: an instrument
/// adds one provider line here.
const PARAM_DEF_PROVIDERS: &[fn(&str) -> Option<Value>] = &[crate::audio_visuals::controls::param_defs_json, crate::audio_visuals::jobs2::param_defs_json];

pub fn native_graph_param_defs(id: &str) -> Value {
    PARAM_DEF_PROVIDERS.iter().find_map(|provider| provider(id)).unwrap_or_else(|| Value::Array(Vec::new()))
}

pub fn native_graph_instrument_manifest() -> Value {
    Value::Array(
        NATIVE_GRAPH_INSTRUMENT_SPECS
            .iter()
            .map(|spec| {
                json!({
                    "id": spec.id,
                    "label": spec.label,
                    "source_uri_prefix": format!("native-graph://{}/", spec.id),
                    "shader_source": spec.shader_source.as_str(),
                    "shader_ids": spec.shader_ids,
                    "shader_count": spec.shader_ids.len(),
                    "features": spec.features,
                    "render_target": "source_frame",
                    "parity": spec.parity,
                    "param_defs": native_graph_param_defs(spec.id)
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_graph_manifest_matches_advertised_instrument_ids() {
        let manifest = native_graph_instrument_manifest();
        let ids = manifest
            .as_array()
            .expect("native graph manifest should be an array")
            .iter()
            .map(|entry| {
                entry
                    .get("id")
                    .and_then(Value::as_str)
                    .expect("native graph manifest entries should have string ids")
            })
            .collect::<Vec<_>>();

        assert_eq!(ids, native_graph_instrument_ids());
    }

    /// A builtin instrument lists the shaders it warms up; a runtime one gets
    /// its shaders with each graph and lists none. Either way the app's
    /// readiness check can tell a complete route from a broken one.
    #[test]
    fn every_instrument_says_where_its_shaders_come_from() {
        for spec in NATIVE_GRAPH_INSTRUMENT_SPECS {
            match spec.shader_source {
                ShaderSource::Builtin | ShaderSource::Core => assert!(!spec.shader_ids.is_empty(), "{} is builtin with no shaders", spec.id),
                ShaderSource::Runtime => assert!(spec.shader_ids.is_empty(), "{} gets its shaders at runtime but lists some", spec.id),
            }
        }
        let manifest = native_graph_instrument_manifest();
        for entry in manifest.as_array().unwrap() {
            let source = entry.get("shader_source").and_then(Value::as_str);
            assert!(matches!(source, Some("builtin") | Some("runtime") | Some("core")), "{entry}");
        }
    }

    /// Every feature an instrument needs must be one the core advertises in
    /// `get_capabilities`, or the route can never be ready and the Output
    /// Window never opens (scene3d and videosynth needed a feature name the
    /// core did not advertise).
    #[test]
    fn every_required_feature_is_advertised_by_the_core() {
        let main = include_str!("status.rs");
        let start = main.find("let features = json!({").expect("capabilities feature map");
        let block = &main[start..start + main[start..].find("\n        });").expect("end of feature map")];
        for spec in NATIVE_GRAPH_INSTRUMENT_SPECS {
            for feature in spec.features {
                assert!(
                    block.contains(&format!("\"{feature}\": true")) || block.contains(&format!("\"{feature}\":")),
                    "{} needs {feature}, which the core does not advertise",
                    spec.id,
                );
            }
        }
    }
}
