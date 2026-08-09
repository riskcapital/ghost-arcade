use serde_json::{Value, json};

pub struct NativeGraphInstrumentSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub shader_ids: &'static [&'static str],
    pub features: &'static [&'static str],
    pub parity: &'static str,
}

pub const NATIVE_GRAPH_INSTRUMENT_SPECS: &[NativeGraphInstrumentSpec] = &[
    NativeGraphInstrumentSpec {
        id: "svg",
        label: "SVG",
        shader_ids: &["svg/render-v5"],
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
        shader_ids: &["light-painting/render-v7"],
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
        shader_ids: &["splat/render-v1"],
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
        shader_ids: &["volumetric-spheres/sim", "volumetric-spheres/render"],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_instanced_render",
            "compute_graph_depth_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_volumetric_spheres_graph",
        ],
        parity: "sim-render-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "smoke-riders",
        label: "Smoke Riders",
        shader_ids: &[
            "3d-smoke/splat",
            "3d-smoke/advect-velocity",
            "3d-smoke/divergence",
            "3d-smoke/jacobi",
            "3d-smoke/subtract-gradient",
            "3d-smoke/advect-density",
            "3d-smoke/render",
            "volumetric-spheres/sim",
            "volumetric-spheres/render",
        ],
        features: &[
            "compute_graph_host",
            "compute_graph_render",
            "compute_graph_multi_render",
            "compute_graph_instanced_render",
            "compute_graph_depth_render",
            "compute_graph_clear_color",
            "compute_graph_source_frame_target",
            "persistent_compute_buffers",
            "native_3d_smoke_graph",
            "native_volumetric_spheres_graph",
            "native_smoke_riders_graph",
        ],
        parity: "composed-smoke-and-volumetric-spheres-shared-wgsl",
    },
    NativeGraphInstrumentSpec {
        id: "ink-cloud",
        label: "Ink Cloud",
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
        shader_ids: &["flythrough/compute", "flythrough/render"],
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
        shader_ids: &["pixel-particles/compute", "pixel-particles/render"],
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
        id: "handfx",
        label: "HandFX",
        shader_ids: &["handfx/compute", "handfx/render"],
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
];

pub fn native_graph_instruments_note() -> &'static str {
    "Native graph instruments use shared WGSL, including persistent GhostFX, HandFX, and Performer world overlay graphs; the legacy native lookalike proxy path is disabled."
}

pub fn native_graph_instrument_ids() -> Vec<&'static str> {
    NATIVE_GRAPH_INSTRUMENT_SPECS
        .iter()
        .map(|spec| spec.id)
        .collect()
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
                    "shader_ids": spec.shader_ids,
                    "shader_count": spec.shader_ids.len(),
                    "features": spec.features,
                    "render_target": "source_frame",
                    "parity": spec.parity
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
}
