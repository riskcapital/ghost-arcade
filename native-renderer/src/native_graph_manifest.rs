use serde_json::{Value, json};

pub const NATIVE_GRAPH_INSTRUMENTS: &[&str] = &[
    "planet",
    "smoke-3d",
    "particle-field",
    "volumetric-spheres",
    "smoke-riders",
    "ink-cloud",
    "flythrough",
    "pixel-particles",
    "point-cloud-fx",
];

pub fn native_graph_instruments_note() -> &'static str {
    "Native graph instruments use shared WGSL for 3D Smoke, Particle Field, Volumetric Spheres, Ink Cloud, Flythrough, Pixel Particles, and Point Cloud FX; the legacy native lookalike proxy path is disabled."
}

pub fn native_graph_instrument_manifest() -> Value {
    json!([
        {
            "id": "planet",
            "label": "Planet",
            "source_uri_prefix": "native-graph://planet/",
            "shader_ids": [
                "planet/render"
            ],
            "features": [
                "compute_graph_host",
                "compute_graph_render",
                "compute_graph_instanced_render",
                "compute_graph_clear_color",
                "compute_graph_source_frame_target",
                "native_planet_graph"
            ],
            "render_target": "source_frame",
            "parity": "single-pass-shared-wgsl"
        },
        {
            "id": "smoke-3d",
            "label": "3D Smoke",
            "source_uri_prefix": "native-graph://smoke-3d/",
            "shader_ids": [
                "3d-smoke/splat",
                "3d-smoke/advect-velocity",
                "3d-smoke/divergence",
                "3d-smoke/jacobi",
                "3d-smoke/subtract-gradient",
                "3d-smoke/advect-density",
                "3d-smoke/render"
            ],
            "features": [
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
                "native_3d_smoke_graph"
            ],
            "render_target": "source_frame",
            "parity": "fluid-sim-multipass-shared-wgsl"
        },
        {
            "id": "particle-field",
            "label": "Particle Field",
            "source_uri_prefix": "native-graph://particle-field/",
            "shader_ids": [
                "particle-field/behavior",
                "particle-field/edges",
                "particle-field/fog",
                "particle-field/render",
                "particle-field/lines"
            ],
            "features": [
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
                "native_particle_field_graph"
            ],
            "render_target": "source_frame",
            "parity": "behavior-render-edges-and-media-source-frame-routing"
        },
        {
            "id": "volumetric-spheres",
            "label": "Volumetric Spheres",
            "source_uri_prefix": "native-graph://volumetric-spheres/",
            "shader_ids": [
                "volumetric-spheres/sim",
                "volumetric-spheres/render"
            ],
            "features": [
                "compute_graph_host",
                "compute_graph_render",
                "compute_graph_instanced_render",
                "compute_graph_depth_render",
                "compute_graph_clear_color",
                "compute_graph_source_frame_target",
                "persistent_compute_buffers",
                "native_volumetric_spheres_graph"
            ],
            "render_target": "source_frame",
            "parity": "sim-render-shared-wgsl"
        },
        {
            "id": "smoke-riders",
            "label": "Smoke Riders",
            "source_uri_prefix": "native-graph://smoke-riders/",
            "shader_ids": [
                "3d-smoke/splat",
                "3d-smoke/advect-velocity",
                "3d-smoke/divergence",
                "3d-smoke/jacobi",
                "3d-smoke/subtract-gradient",
                "3d-smoke/advect-density",
                "3d-smoke/render",
                "volumetric-spheres/sim",
                "volumetric-spheres/render"
            ],
            "features": [
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
                "native_smoke_riders_graph"
            ],
            "render_target": "source_frame",
            "parity": "composed-smoke-and-volumetric-spheres-shared-wgsl"
        },
        {
            "id": "ink-cloud",
            "label": "Ink Cloud",
            "source_uri_prefix": "native-graph://ink-cloud/",
            "shader_ids": [
                "ink-cloud/sim",
                "ink-cloud/render",
                "ink-cloud/background"
            ],
            "features": [
                "compute_graph_host",
                "compute_graph_render",
                "compute_graph_multi_render",
                "compute_graph_instanced_render",
                "compute_graph_clear_color",
                "compute_graph_source_frame_target",
                "persistent_compute_buffers",
                "native_ink_cloud_graph"
            ],
            "render_target": "source_frame",
            "parity": "sim-background-render-shared-wgsl"
        },
        {
            "id": "flythrough",
            "label": "Flythrough",
            "source_uri_prefix": "native-graph://flythrough/",
            "shader_ids": [
                "flythrough/compute",
                "flythrough/render"
            ],
            "features": [
                "compute_graph_host",
                "compute_graph_render",
                "compute_graph_instanced_render",
                "compute_graph_texture_sampling",
                "compute_graph_clear_color",
                "compute_graph_source_frame_target",
                "persistent_compute_buffers",
                "native_flythrough_graph"
            ],
            "render_target": "source_frame",
            "parity": "compute-render-source-frame-shared-wgsl"
        },
        {
            "id": "pixel-particles",
            "label": "Pixel Particles",
            "source_uri_prefix": "native-graph://pixel-particles/",
            "shader_ids": [
                "pixel-particles/compute",
                "pixel-particles/render"
            ],
            "features": [
                "compute_graph_host",
                "compute_graph_render",
                "compute_graph_instanced_render",
                "compute_graph_texture_sampling",
                "compute_graph_clear_color",
                "compute_graph_source_frame_target",
                "persistent_compute_buffers",
                "native_pixel_particles_graph"
            ],
            "render_target": "source_frame",
            "parity": "compute-render-source-frame-shared-wgsl"
        },
        {
            "id": "point-cloud-fx",
            "label": "Point Cloud FX",
            "source_uri_prefix": "native-graph://point-cloud-fx/",
            "shader_ids": [
                "point-cloud-fx/compute",
                "point-cloud-fx/sort-fill",
                "point-cloud-fx/sort-step",
                "point-cloud-fx/render"
            ],
            "features": [
                "compute_graph_host",
                "compute_graph_render",
                "compute_graph_instanced_render",
                "compute_graph_clear_color",
                "compute_graph_source_frame_target",
                "persistent_compute_buffers",
                "native_point_cloud_fx_graph"
            ],
            "render_target": "source_frame",
            "parity": "compute-render-point-buffer-shared-wgsl"
        }
    ])
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

        assert_eq!(ids.as_slice(), NATIVE_GRAPH_INSTRUMENTS);
    }
}
