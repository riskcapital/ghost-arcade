//! The particle director's camera tracks, as the particle visuals use them.

use crate::*;

/// Auto Camera state for one particle layer: the director itself, and where
/// its points of interest are in the readback cycle.
#[derive(Clone, Debug, Default)]
pub(crate) struct ParticleDirectorTrack {
    pub(crate) director: DirectorState,
    /// Frame time a contrast grid was last requested and has not landed yet.
    pub(crate) poi_pending_since: Option<f32>,
    /// Frame time the last grid landed.
    pub(crate) poi_received_at: Option<f32>,
    /// Input the points were read from; a new input reads again at once.
    pub(crate) poi_input: String,
}

/// Cells per side of the contrast grid; matches PARTICLE_DIRECTOR_POI_GRID in
/// particleDirector.ts.
pub(crate) const PARTICLE_DIRECTOR_POI_GRID: u32 = 24;

/// Pictures change; a live source is re-read this often.
pub(crate) const PARTICLE_DIRECTOR_POI_REFRESH_SECONDS: f32 = 20.0;

/// A grid that has not landed after this long (a warming pipeline dropped the
/// frame, say) is asked for again.
pub(crate) const PARTICLE_DIRECTOR_POI_RETRY_SECONDS: f32 = 2.0;

pub(crate) fn normalize_particle_director_params(params: &Value) -> DirectorParams {
    DirectorParams {
        enabled: params
            .get("directorEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        pace: match native_particle_field_enum(params, "directorPace", "medium").as_str() {
            "slow" => 0.6,
            "fast" => 1.7,
            _ => 1.0,
        },
        closeness: native_graph_param_f32(params, "directorCloseness", 0.0, 1.0, 0.7),
        depth_of_field: params
            .get("directorDepthOfField")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        beat_sync: params
            .get("directorBeatSync")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        seed: native_graph_param_u32(params, "directorSeed", 1, 99, 1),
    }
}

/// Point Pixel Particles' render camera where the director says. Only the
/// render camera moves: the cloud stays laid out by the operator's Camera
/// group (its anchors span that camera's view extent), which is what makes a
/// push-in bring the picture closer instead of rescaling it to fill the frame.
pub(crate) fn apply_director_to_pixel_particles(
    view: &mut NativePixelParticlesParams,
    base: &NativePixelParticlesParams,
    camera: &DirectorCamera,
    width: u32,
    height: u32,
    depth_of_field: bool,
) {
    view.fov_deg = director_fov_deg(base.fov_deg, camera.focal_mm).clamp(4.0, 120.0);
    view.camera_z = (base.camera_z * camera.distance).max(0.1);
    view.camera_yaw = base.camera_yaw + camera.orbit[0];
    view.camera_pitch = base.camera_pitch + camera.orbit[1];
    // The subject's world position comes from the operator's framing, and pan
    // is applied after rotation, so centre the rotated subject.
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let view_y = (base.fov_deg.to_radians() * 0.5).tan() * base.camera_z;
    let subject = [camera.target[0] * view_y * aspect, camera.target[1] * view_y];
    let (sy, cy) = view.camera_yaw.to_radians().sin_cos();
    let (sp, cp) = view.camera_pitch.to_radians().sin_cos();
    let x1 = cy * subject[0];
    let z1 = sy * subject[0];
    let y2 = cp * subject[1] - sp * z1;
    view.pan_x = base.pan_x - x1;
    view.pan_y = base.pan_y - y2;
    view.focus_depth = camera.focus;
    if depth_of_field {
        view.aperture = camera.aperture;
    }
}

/// Point Flythrough's camera where the director says: zoom by focal length,
/// aim into the slab ahead at the subject, and pull focus along the tunnel.
pub(crate) fn apply_director_to_flythrough(
    view: &mut NativeFlythroughParams,
    base: &NativeFlythroughParams,
    camera: &DirectorCamera,
    depth_of_field: bool,
) {
    view.fov_deg = director_fov_deg(base.fov_deg, camera.focal_mm).clamp(4.0, 140.0);
    view.focus_distance = 0.4 + camera.focus * 2.6;
    // Aim at the subject as it sits in the slab at the focus distance. The
    // 0.6 keeps a subject at the image edge inside the frame instead of
    // swinging the camera out past the slab.
    let ahead = view.focus_distance.max(0.3);
    let aim_yaw = (camera.target[0] * 0.6 / ahead).atan().to_degrees();
    let aim_pitch = -(camera.target[1] * 0.6 / ahead).atan().to_degrees();
    view.camera_yaw = base.camera_yaw + camera.orbit[0] + aim_yaw;
    view.camera_pitch = base.camera_pitch + camera.orbit[1] + aim_pitch;
    if depth_of_field {
        view.aperture = camera.aperture;
    }
}

/// Field of view for a director focal length, relative to the operator's: 45 mm
/// reproduces `base_fov_deg` exactly, 90 mm halves the frame.
pub(crate) fn director_fov_deg(base_fov_deg: f32, focal_mm: f32) -> f32 {
    let half = (base_fov_deg.to_radians() * 0.5).tan() * 45.0 / focal_mm.max(1.0);
    (2.0 * half.atan()).to_degrees()
}

impl App {
    /// Advance one layer's Auto Camera and, when due, schedule a contrast grid of
    /// its input so the director has real subjects. Returns this frame's
    /// camera (the rest camera when Auto Camera is off).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn step_particle_director(
        &mut self,
        track: &mut ParticleDirectorTrack,
        director_params: &DirectorParams,
        buffer_prefix: &str,
        input_source_id: &str,
        input_slot: usize,
        time: f32,
        buffers: &mut Vec<NativeComputeGraphBufferSpec>,
        pass_plans: &mut Vec<NativeComputeGraphPassPlan>,
        readback_buffer_ids: &mut Vec<String>,
    ) -> Result<DirectorCamera, String> {
        if !director_params.enabled {
            track.poi_pending_since = None;
            return Ok(track.director.camera_at(director_params, time, 0.0));
        }
        let grid_id = format!("{buffer_prefix}:poi-grid");
        if let Some(bytes) = self
            .renderer
            .as_mut()
            .and_then(|renderer| renderer.graph_readback_results.remove(&grid_id))
        {
            let scores: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|word| f32::from_le_bytes([word[0], word[1], word[2], word[3]]))
                .collect();
            let points = points_of_interest_from_grid(&scores, PARTICLE_DIRECTOR_POI_GRID as usize);
            if std::env::var("GHOST_DEBUG_DIRECTOR").is_ok() {
                eprintln!("[director] {grid_id} points {points:?}");
            }
            track.director.set_points(points);
            track.poi_pending_since = None;
            track.poi_received_at = Some(time);
        }
        if track.poi_input != input_source_id {
            track.poi_input = input_source_id.to_string();
            track.poi_received_at = None;
            track.poi_pending_since = None;
        }
        let stale = track
            .poi_received_at
            .map_or(true, |at| time - at >= PARTICLE_DIRECTOR_POI_REFRESH_SECONDS);
        let waiting = track
            .poi_pending_since
            .is_some_and(|since| time - since < PARTICLE_DIRECTOR_POI_RETRY_SECONDS);
        if stale && !waiting {
            let shader_id = "particle-director/poi-grid";
            let (hash, source) = self.native_graph_shader_source(shader_id, "cs_poi")?;
            let uniform_id = format!("{buffer_prefix}:poi-uniform");
            let cells = u64::from(PARTICLE_DIRECTOR_POI_GRID * PARTICLE_DIRECTOR_POI_GRID);
            let mut uniform = vec![0_u8; 16];
            write_u32_le(&mut uniform, 0, PARTICLE_DIRECTOR_POI_GRID);
            buffers.push(NativeComputeGraphBufferSpec {
                id: grid_id.clone(),
                byte_length: cells * 4,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: Vec::new(),
                persistent: false,
                clear: false,
                indirect: false,
            });
            buffers.push(NativeComputeGraphBufferSpec {
                id: uniform_id.clone(),
                byte_length: 16,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: uniform,
                persistent: false,
                clear: false,
                indirect: false,
            });
            let bindings = vec![
                NativeComputeGraphBindingSpec {
                    binding: 0,
                    resource_id: grid_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 1,
                    resource_id: uniform_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 2,
                    resource_id: input_source_id.to_string(),
                    kind: NativeComputeGraphBindingKind::SourceFrameTexture(
                        NativeComputeGraphTextureDimension::D2,
                    ),
                    source_slot: Some(input_slot),
                },
                NativeComputeGraphBindingSpec {
                    binding: 3,
                    resource_id: "source-frame-sampler".to_string(),
                    kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                    source_slot: None,
                },
            ];
            let layout = native_graph_binding_layout_signature(&bindings);
            let groups = PARTICLE_DIRECTOR_POI_GRID.div_ceil(8);
            pass_plans.push(NativeComputeGraphPassPlan {
                name: "particle-director-poi-grid".to_string(),
                cache_key: format!("graph:{shader_id}:{hash}:cs_poi:{layout}"),
                source,
                entry: "cs_poi".to_string(),
                dispatch: [groups, groups, 1],
                bindings,
            });
            if let Some(renderer) = self.renderer.as_mut() {
                renderer.graph_live_readbacks.ask(&grid_id);
            }
            readback_buffer_ids.push(grid_id);
            track.poi_pending_since = Some(time);
        }
        let bpm = self.audio1[3];
        Ok(track.director.camera_at(director_params, time, bpm))
    }
}
