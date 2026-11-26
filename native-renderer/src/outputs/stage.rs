//! The output stage (crop, warps, grade, blend, masks) and the commands that
//! set it, plus the output and present policies.

use crate::*;

/// Output-stage settings shared by every render entry point. Identity here
/// means "no output transform", which is what deck monitors always want: they
/// are cue displays, not the projector.
#[derive(Clone, Copy)]
pub(crate) struct OutputStage {
    /// Crop rect (x, y, width, height) in source UV.
    pub(crate) out0: [f32; 4],
    /// (rotation quarter-turns, brightness, contrast, gamma).
    pub(crate) out1: [f32; 4],
    /// Edge-blend widths (left, right, top, bottom) as UV fractions.
    pub(crate) edge: [f32; 4],
    /// (dome enabled, mode, fov radians, rotation radians).
    pub(crate) dome0: [f32; 4],
    /// (tilt radians, offset x, offset y, curvature).
    pub(crate) dome1: [f32; 4],
    /// (truncation, edge-blend gamma, slice mode, _).
    pub(crate) dome2: [f32; 4],
    /// How the canvas lies on the dome: (kind 0 flat view / 1 panorama /
    /// 2 domemaster, panorama bottom and top elevation, panorama span),
    /// radians. See dome_source_uv in heartbeat.wgsl.
    pub(crate) dome3: [f32; 4],
    /// (flat view width or domemaster canvas angle radians, dome grid
    /// strength, _, _).
    pub(crate) dome4: [f32; 4],
    /// Layers placed on the dome: (drawn by the dome pass, lens, dome
    /// angle radians, _). Set per frame by `sync_dome_layers`.
    pub(crate) dlayer: [f32; 4],
    /// The editor's view from inside the dome: (on, look azimuth, look
    /// elevation, tangent of half the vertical field of view), radians.
    /// Only the dome view target sets it (`render_dome_view`).
    pub(crate) dview: [f32; 4],
    pub(crate) dview1: [f32; 4],
    /// This Screen as one projector of a dome rig: (on, its index, rig
    /// size, blend width), (blend gamma, _, _, _), and the rig's projectors,
    /// four vec4 each. See `Uniforms.dproj0` in heartbeat.wgsl.
    pub(crate) dproj0: [f32; 4],
    pub(crate) dproj1: [f32; 4],
    pub(crate) dprojs: [[f32; 4]; 32],
    /// Per-edge blend gamma (left, right, top, bottom); slice mode only.
    pub(crate) edge_gamma: [f32; 4],
    /// Projector black-level lift (r, g, b, feather); slice mode only.
    pub(crate) black_level: [f32; 4],
    /// Per-slice screen warp: (mode, rows, cols, _) + corner quad.
    pub(crate) projector_calibration: [[f32; 4]; 5],
    pub(crate) swarp: [f32; 4],
    pub(crate) swarp_c0: [f32; 4],
    pub(crate) swarp_c1: [f32; 4],
    /// Master warp: (enabled, rows, cols, _) + corner quad.
    pub(crate) mwarp: [f32; 4],
    pub(crate) mwarp_c0: [f32; 4],
    pub(crate) mwarp_c1: [f32; 4],
    /// Control points, two per vec4, row-major, up to 16x16.
    pub(crate) swarp_mesh: [[f32; 4]; 128],
    pub(crate) mwarp_mesh: [[f32; 4]; 128],
    /// Bezier tangents of those meshes, read only while swarp.w / mwarp.w
    /// is 1. See WarpMesh.
    pub(crate) swarp_tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
    pub(crate) mwarp_tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
    /// Per-screen masks: (mask count, keep count, _, _), one info vec4 per
    /// mask and the packed vertices; slice mode only. See screen_masks_at.
    pub(crate) smask: [f32; 4],
    pub(crate) smask_info: [[f32; 4]; MAX_SCREEN_MASKS],
    pub(crate) smask_bounds: [[f32; 4]; MAX_SCREEN_MASKS],
    pub(crate) smask_pts: [[f32; 4]; MAX_SCREEN_MASK_VEC4S],
}

impl Default for OutputStage {
    fn default() -> Self {
        Self {
            out0: [0.0, 0.0, 1.0, 1.0],
            out1: [0.0, 1.0, 1.0, 1.0],
            edge: [0.0; 4],
            dome0: [0.0; 4],
            dome1: [0.0; 4],
            dome2: [1.0, 2.2, 0.0, 0.0],
            dome3: [0.0, 0.0, std::f32::consts::FRAC_PI_2, std::f32::consts::TAU],
            dome4: [std::f32::consts::FRAC_PI_2, 0.0, 0.0, 0.0],
            dlayer: [0.0; 4],
            dview: [0.0; 4],
            dview1: [0.0; 4],
            dproj0: [0.0; 4],
            dproj1: [0.0; 4],
            dprojs: [[0.0; 4]; 32],
            edge_gamma: [2.2; 4],
            black_level: [0.0; 4],
            projector_calibration: [[0.0; 4]; 5],
            swarp: [0.0; 4],
            swarp_c0: [0.0, 0.0, 1.0, 0.0],
            swarp_c1: [1.0, 1.0, 0.0, 1.0],
            mwarp: [0.0; 4],
            mwarp_c0: [0.0, 0.0, 1.0, 0.0],
            mwarp_c1: [1.0, 1.0, 0.0, 1.0],
            swarp_mesh: [[0.0; 4]; 128],
            mwarp_mesh: [[0.0; 4]; 128],
            swarp_tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
            mwarp_tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
            smask: [0.0; 4],
            smask_info: [[0.0; 4]; MAX_SCREEN_MASKS],
            smask_bounds: [[0.0; 4]; MAX_SCREEN_MASKS],
            smask_pts: [[0.0; 4]; MAX_SCREEN_MASK_VEC4S],
        }
    }
}

/// `export_frame_snapshot` sources served from an already-rendered shared
/// texture rather than by re-rendering the scene.
pub(crate) fn live_capture_export_source(source: &str) -> bool {
    source.eq_ignore_ascii_case("output") || source == "record_target" || source.starts_with("slice:")
}

/// Output stage for the recording pass: the untransformed composition, with
/// the compositor's straight-alpha output switched on when asked.
/// A dome placement in degrees as the compositor reads it: azimuth,
/// elevation, the tangent of half the angular width, roll, in radians.
/// The width stays short of 180 degrees, where a flat canvas has no edge.
pub(crate) fn dome_place_gpu(azimuth: f64, elevation: f64, size: f64, roll: f64) -> [f32; 4] {
    let finite = |v: f64, fallback: f64| if v.is_finite() { v } else { fallback };
    let half = (finite(size, 60.0).clamp(1.0, 170.0) * 0.5).to_radians();
    [
        finite(azimuth, 0.0).to_radians() as f32,
        finite(elevation, 90.0).clamp(-90.0, 90.0).to_radians() as f32,
        half.tan() as f32,
        finite(roll, 0.0).to_radians() as f32,
    ]
}

pub(crate) fn record_target_output_stage(alpha: bool) -> OutputStage {
    let mut stage = OutputStage::default();
    stage.smask[2] = if alpha { 1.0 } else { 0.0 };
    stage
}

/// Output stage for a slice fed by a Map Sim projector view. The view is
/// already the projector's whole image, so the master crop, screen warp,
/// master warp and dome (all sampling positions on the master) are
/// identity; rotation, colour grade, edge blend, black level and masks
/// still apply as for any Screen.
pub(crate) fn projector_view_output_stage(stage: OutputStage) -> OutputStage {
    OutputStage {
        out0: [0.0, 0.0, 1.0, 1.0],
        dome0: [0.0; 4],
        dlayer: [0.0; 4],
        projector_calibration: [[0.0; 4]; 5],
        swarp: [0.0; 4],
        swarp_c0: [0.0, 0.0, 1.0, 0.0],
        swarp_c1: [1.0, 1.0, 0.0, 1.0],
        mwarp: [0.0; 4],
        mwarp_c0: [0.0, 0.0, 1.0, 0.0],
        mwarp_c1: [1.0, 1.0, 0.0, 1.0],
        ..stage
    }
}

/// What the slice pass needs to draw Map Sim projector views.
pub(crate) struct ProjectorViewInputs<'a> {
    pub(crate) scene: Option<&'a projector_view::ProjectorViewScene>,
    pub(crate) meshes: &'a HashMap<String, Arc<projector_view::ProjectorViewMeshData>>,
    pub(crate) overlays: &'a HashMap<String, projector_view::ProjectorViewOverlay>,
}

impl App {
    /// Master output gate. Blackout is a live-performance kill switch, so it
    /// must act on the composite the projector sees — the editor's DOM
    /// overlay only ever covered the preview.
    pub(crate) fn output_gate(&self) -> f32 {
        if self.output_blackout { 0.0 } else { 1.0 }
    }

    /// Blackout / freeze state from the editor's output settings.
    pub(crate) fn apply_output_state(&mut self, params: &Value) -> Result<Value, String> {
        if let Some(blackout) = bool_at(params, &["blackout"]) {
            self.output_blackout = blackout;
        }
        if let Some(frozen) = bool_at(params, &["frozen"]) {
            self.output_frozen = frozen;
        }
        Ok(json!({
            "blackout": self.output_blackout,
            "frozen": self.output_frozen,
        }))
    }

    /// Stage for the editor preview / capture path. The WebGL build gated
    /// crop, rotation and colour grade behind output mode, so the editor
    /// canvas (and anything recorded from it) showed the untransformed
    /// composite; dome and edge blend were drawn in both. Mirror that.
    pub(crate) fn preview_output_stage(&self) -> OutputStage {
        OutputStage {
            out0: [0.0, 0.0, 1.0, 1.0],
            out1: [0.0, 1.0, 1.0, 1.0],
            ..self.output_stage
        }
    }

    /// Effects applied to the blended frame, capped at the uniform's 8 slots.
    pub(crate) fn composite_effect_slots(&self) -> Vec<[f32; 4]> {
        self.composite_effects.iter().copied().take(8).collect()
    }

    /// Composition effects + macro effect bundles. Each entry carries a
    /// compositor descriptor ("hue:0.25") and a `mix` wet/dry weight — the
    /// macro knob value for bundle effects, 1.0 for composition effects.
    pub(crate) fn apply_composite_effects(&mut self, params: &Value) -> Result<Value, String> {
        let mut slots: Vec<[f32; 4]> = Vec::new();
        let mut skipped: Vec<String> = Vec::new();
        if let Some(entries) = params.get("effects").and_then(Value::as_array) {
            for entry in entries {
                if slots.len() >= 8 {
                    break;
                }
                let Some(descriptor) = entry
                    .get("descriptor")
                    .and_then(Value::as_str)
                    .or_else(|| entry.as_str())
                else {
                    continue;
                };
                let Some(mut slot) = effect_descriptor_code(descriptor) else {
                    // Descriptors outside the compositor's in-shader op set
                    // (blur, colorama, …) need a real post pass; report them
                    // instead of silently dropping the operator's effect.
                    skipped.push(descriptor.to_string());
                    continue;
                };
                let mix = entry
                    .get("mix")
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0)
                    .clamp(0.0, 1.0) as f32;
                if mix <= 0.0005 {
                    continue;
                }
                slot[3] = mix;
                slots.push(slot);
            }
        }
        self.composite_effects = slots;
        Ok(json!({
            "applied": self.composite_effects.len(),
            "skipped": skipped,
        }))
    }

    /// Projector output transform from the editor's output settings.
    pub(crate) fn apply_output_stage(&mut self, params: &Value) -> Result<Value, String> {
        let read = |keys: &[&str], fallback: f64| number_at(params, keys).unwrap_or(fallback);
        // A phone's auto map stripe frame on the main output: (frame, planned width, planned height).
        let structured_light = params.get("structuredLight").and_then(|v| v.as_f64()).filter(|f| f.is_finite() && *f >= 0.0 && *f < 500.0).map(|frame| {
            (frame.round() as f32, read(&["structuredLightWidth"], 0.0).clamp(0.0, 16384.0) as f32, read(&["structuredLightHeight"], 0.0).clamp(0.0, 16384.0) as f32)
        });
        let crop_x = read(&["cropX"], 0.0).clamp(0.0, 0.99) as f32;
        let crop_y = read(&["cropY"], 0.0).clamp(0.0, 0.99) as f32;
        let crop_w = read(&["cropWidth"], 1.0).clamp(0.01, 1.0 - crop_x as f64) as f32;
        let crop_h = read(&["cropHeight"], 1.0).clamp(0.01, 1.0 - crop_y as f64) as f32;
        let rotation = (((read(&["rotation"], 0.0) % 360.0) + 360.0) % 360.0 / 90.0).round();
        let dome_enabled = bool_at(params, &["domeEnabled"]).unwrap_or(false);
        // Master warp: destination-semantics quad plus an optional mesh that
        // deforms inside it. Only the mesh belonging to the declared mode is
        // read, so switching modes in the editor can't leave a stale grid on.
        let warp = params.get("masterWarp");
        let warp_enabled = warp
            .map(|value| bool_at(value, &["enabled"]).unwrap_or(false))
            .unwrap_or(false);
        let warp_mode = warp
            .and_then(|value| string_at(value, &["mode"]))
            .unwrap_or_else(|| "corners".to_string());
        let (master_c0, master_c1) = warp_corners_at(warp.and_then(|v| v.get("corners")));
        let master_mesh = if warp_enabled && warp_mode == "mesh" {
            warp_mesh_at(warp.and_then(|v| v.get("meshGrid")))
        } else {
            WarpMesh::none()
        };
        let master_warp = [
            if warp_enabled { 1.0 } else { 0.0 },
            master_mesh.rows,
            master_mesh.cols,
            // Bezier cells are inverted as Coons patches (mwarp_mesh_uv_bezier).
            if master_mesh.bezier { 1.0 } else { 0.0 },
        ];
        self.output_stage = OutputStage {
            out0: [crop_x, crop_y, crop_w, crop_h],
            out1: [
                rotation.clamp(0.0, 3.0) as f32,
                read(&["brightness"], 1.0).max(0.0) as f32,
                read(&["contrast"], 1.0).max(0.0) as f32,
                read(&["gamma"], 1.0).max(0.001) as f32,
            ],
            edge: [
                read(&["edgeBlendLeft"], 0.0).clamp(0.0, 0.5) as f32,
                read(&["edgeBlendRight"], 0.0).clamp(0.0, 0.5) as f32,
                read(&["edgeBlendTop"], 0.0).clamp(0.0, 0.5) as f32,
                read(&["edgeBlendBottom"], 0.0).clamp(0.0, 0.5) as f32,
            ],
            dome0: [
                if dome_enabled { 1.0 } else { 0.0 },
                read(&["domeMode"], 0.0).clamp(0.0, 3.0) as f32,
                read(&["domeFOV"], 180.0).to_radians() as f32,
                read(&["domeRotation"], 0.0).to_radians() as f32,
            ],
            dome1: [
                read(&["domeTilt"], 0.0).to_radians() as f32,
                read(&["domeOffsetX"], 0.0) as f32,
                read(&["domeOffsetY"], 0.0) as f32,
                read(&["domeCurvature"], 1.0).clamp(0.0, 1.0) as f32,
            ],
            dome2: [
                read(&["domeTruncation"], 1.0).clamp(0.01, 2.0) as f32,
                read(&["edgeBlendGamma"], 2.2).clamp(0.05, 8.0) as f32,
                // Slice mode off: the main output uses the single-projector
                // grade, not blendRenderer's multi-projector one.
                0.0,
                // Alignment test pattern code (TestPatternType index), or 9
                // while a phone's auto map shows its stripes on the main output.
                if structured_light.is_some() { 9.0 } else { read(&["testPattern"], 0.0).clamp(0.0, 6.0) as f32 },
            ],
            dome3: [
                read(&["domeSource"], 0.0).round().clamp(0.0, 2.0) as f32,
                read(&["domePanoBottom"], 0.0).clamp(-90.0, 89.0).to_radians() as f32,
                read(&["domePanoTop"], 90.0).clamp(-89.0, 90.0).to_radians() as f32,
                read(&["domePanoSpan"], 360.0).clamp(10.0, 360.0).to_radians() as f32,
            ],
            dome4: [
                read(&["domeSourceAngle"], 90.0).clamp(10.0, 360.0).to_radians() as f32,
                read(&["domeGrid"], 0.0).clamp(0.0, 1.0) as f32,
                read(&["domePanoSeam"], 0.0).clamp(0.0, 0.3) as f32,
                0.0,
            ],
            dlayer: [0.0; 4],
            dview: [0.0; 4],
            dview1: [0.0; 4],
            dproj0: [0.0; 4],
            dproj1: [0.0; 4],
            dprojs: [[0.0; 4]; 32],
            edge_gamma: [2.2; 4],
            black_level: [0.0; 4],
            // The main output never carries a per-slice screen warp; that is
            // a projector-alignment transform and belongs to the slice. While
            // a phone maps the main output, row 0 names the raster size it
            // planned for and row 4 w the stripe frame (calibration stays off).
            projector_calibration: match structured_light {
                Some((frame, width, height)) => [[width, height, 0.0, 0.0], [0.0; 4], [0.0; 4], [0.0; 4], [0.0, 0.0, 0.0, frame]],
                None => [[0.0; 4]; 5],
            },
            swarp: [0.0; 4],
            swarp_c0: [0.0, 0.0, 1.0, 0.0],
            swarp_c1: [1.0, 1.0, 0.0, 1.0],
            mwarp: master_warp,
            mwarp_c0: master_c0,
            mwarp_c1: master_c1,
            swarp_mesh: [[0.0; 4]; 128],
            mwarp_mesh: master_mesh.points,
            swarp_tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
            mwarp_tangents: master_mesh.tangents,
            // Masks are cut per screen, so the main output carries none.
            smask: [0.0; 4],
            smask_info: [[0.0; 4]; MAX_SCREEN_MASKS],
            smask_bounds: [[0.0; 4]; MAX_SCREEN_MASKS],
            smask_pts: [[0.0; 4]; MAX_SCREEN_MASK_VEC4S],
        };
        self.refresh_slice_master_stage();
        Ok(json!({ "domeEnabled": dome_enabled, "masterWarp": master_warp[0] > 0.5 }))
    }

    pub(crate) fn apply_output_config(&mut self, params: &Value) {
        if number_at(params, &["width"]).is_some() && number_at(params, &["height"]).is_some() {
            self.output_size_configured = true;
        }
        let width = number_at(params, &["width"]).unwrap_or(self.pending_width as f64);
        let height = number_at(params, &["height"]).unwrap_or(self.pending_height as f64);
        self.pending_width = width.round().clamp(64.0, 16384.0) as u32;
        self.pending_height = height.round().clamp(64.0, 16384.0) as u32;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.resize(PhysicalSize::new(self.pending_width, self.pending_height));
            self.pending_width = renderer.config.width;
            self.pending_height = renderer.config.height;
        }
    }

    pub(crate) fn apply_present_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        if let Some(mode) = string_at(config, &["present_mode"]) {
            let normalized = mode.trim().to_ascii_lowercase();
            self.present_mode =
                if normalized == "immediate" || normalized == "no-vsync" || normalized == "novsync"
                {
                    "immediate".to_string()
                } else {
                    "vsync".to_string()
                };
        }
        self.allow_tearing = bool_at(config, &["allow_tearing"]).unwrap_or(self.allow_tearing);
        self.max_frame_latency = number_at(config, &["max_frame_latency"])
            .unwrap_or(self.max_frame_latency as f64)
            .round()
            .clamp(1.0, 8.0) as u32;
        self.use_waitable_object = false;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.set_present_policy(
                &self.present_mode,
                self.allow_tearing,
                self.max_frame_latency,
            );
        }
    }

    pub(crate) fn apply_command_drain_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.command_queue_capacity = number_at(config, &["command_queue_capacity"])
            .unwrap_or(self.command_queue_capacity as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.command_drain_limit = number_at(config, &["max_commands_per_tick"])
            .or_else(|| number_at(config, &["command_drain_limit"]))
            .unwrap_or(self.command_drain_limit as f64)
            .round()
            .clamp(1.0, self.command_queue_capacity.max(1) as f64)
            as u32;
    }

    pub(crate) fn apply_auto_present_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.auto_present_on_state_change = bool_at(config, &["auto_present_on_state_change"])
            .unwrap_or(self.auto_present_on_state_change);
    }
}
