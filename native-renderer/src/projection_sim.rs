//! Map Sim (projection simulation): its scene, meshes, view and overlay.

use crate::*;

pub(crate) fn collect_projection_sim_mesh_items(
    scene: &Value,
    items: &mut Vec<Stage3DMeshItemGpu>,
    app: &App,
) {
    let projection_source_slot = projection_sim_source_slot(scene, app);
    if let Some(objects) = scene.get("objects").and_then(Value::as_array) {
        for object in objects {
            if items.len() >= MAX_STAGE3D_MESH_ITEMS {
                return;
            }
            if !bool_at(object, &["visible"]).unwrap_or(true) {
                continue;
            }
            let position = vec3_path_or(object, &["position"], [0.0, 1.0, 0.0]);
            let rotation = vec3_path_or(object, &["rotation"], [0.0, 0.0, 0.0]);
            let scale = vec3_path_or(object, &["scale"], [1.0, 1.0, 1.0]);
            let object_type = string_at(object, &["type"]).unwrap_or_default();
            let primitive = string_at(object, &["primitive"]).unwrap_or_default();
            let color = color_path_or(object, &["color"]).unwrap_or(match object_type.as_str() {
                "model" => [0.72, 0.82, 1.0],
                "pointcloud" => [1.0, 0.62, 0.94],
                _ => [0.86, 0.82, 0.72],
            });
            let projection_alpha = if bool_at(object, &["receiveProjection"]).unwrap_or(true) {
                0.66
            } else {
                0.34
            };
            let receive_projection = bool_at(object, &["receiveProjection"]).unwrap_or(true);
            let material = if receive_projection {
                stage3d_material(projection_source_slot, 1.35, 4.0, projection_alpha)
            } else {
                stage3d_material(None, 1.0, 0.0, projection_alpha)
            };
            items.push(stage3d_mesh_item(
                position,
                projection_sim_mesh_scale(&primitive, scale),
                rotation,
                [color[0], color[1], color[2], projection_alpha],
                projection_sim_shape_code(&object_type, &primitive),
                material,
                [0.0, 0.0, 1.0, 0.0],
            ));
        }
    }

    if let Some(projectors) = scene.get("projectors").and_then(Value::as_array) {
        for projector in projectors {
            if items.len() >= MAX_STAGE3D_MESH_ITEMS {
                return;
            }
            if !bool_at(projector, &["enabled"]).unwrap_or(true) {
                continue;
            }
            let position = vec3_path_or(projector, &["position"], [-4.0, 4.0, 6.0]);
            let color = color_path_or(projector, &["color"]).unwrap_or([1.0, 1.0, 1.0]);
            let intensity = number_at(projector, &["intensity"])
                .unwrap_or(1.0)
                .clamp(0.1, 4.0) as f32;
            let size = (0.24 + intensity * 0.07).clamp(0.26, 0.62);
            items.push(stage3d_mesh_item(
                position,
                [size, size, size],
                [0.0, 0.0, 0.0],
                [color[0], color[1], color[2], 0.58],
                2.0,
                stage3d_material(None, 1.0, 0.0, 1.0),
                [0.0, 0.0, 1.0, 0.0],
            ));
        }
    }
}

pub(crate) fn projection_sim_source_slot(scene: &Value, app: &App) -> Option<usize> {
    let projectors = scene.get("projectors").and_then(Value::as_array)?;
    for projector in projectors {
        if !bool_at(projector, &["enabled"]).unwrap_or(true) {
            continue;
        }
        let source = string_at(projector, &["source"]).unwrap_or_else(|| "master".to_string());
        if source == "slice" {
            if let Some(slice_id) = string_at(projector, &["sliceId"]) {
                if let Some(slot) = app.stage3d_source_slot_for_text(&slice_id) {
                    return Some(slot);
                }
            }
        }
        if let Some(slot) = app.first_visible_source_frame_slot() {
            return Some(slot);
        }
    }
    None
}

pub(crate) fn projection_sim_shape_code(object_type: &str, primitive: &str) -> f32 {
    if object_type == "pointcloud" {
        return 2.0;
    }
    if object_type == "model" {
        return 1.0;
    }
    stage3d_geometry_shape_code(primitive)
}

pub(crate) fn projection_sim_mesh_scale(primitive: &str, scale: [f32; 3]) -> [f32; 3] {
    let safe = [
        scale[0].abs().max(0.08),
        scale[1].abs().max(0.08),
        scale[2].abs().max(0.08),
    ];
    match primitive.trim().to_ascii_lowercase().as_str() {
        "plane" | "panel" | "quad" => [safe[0], safe[1], 0.04],
        "sphere" | "ball" => {
            let diameter = safe[0].max(safe[1]).max(safe[2]);
            [diameter, diameter, diameter]
        }
        "cylinder" | "column" | "cone" | "pyramid" => [safe[0], safe[1], safe[0].max(safe[2])],
        _ => safe,
    }
}

pub(crate) fn collect_projection_sim_overlay_items(scene: &Value, items: &mut Vec<Stage3DOverlayItemGpu>) {
    if let Some(objects) = scene.get("objects").and_then(Value::as_array) {
        for object in objects {
            if items.len() >= MAX_STAGE3D_OVERLAY_ITEMS {
                return;
            }
            if !bool_at(object, &["visible"]).unwrap_or(true) {
                continue;
            }
            let position = vec3_path_or(object, &["position"], [0.0, 1.0, 0.0]);
            let rotation = vec3_path_or(object, &["rotation"], [0.0, 0.0, 0.0]);
            let scale = vec3_path_or(object, &["scale"], [1.0, 1.0, 1.0]);
            let object_type = string_at(object, &["type"]).unwrap_or_default();
            let primitive = string_at(object, &["primitive"]).unwrap_or_default();
            let color = color_path_or(object, &["color"]).unwrap_or(match object_type.as_str() {
                "model" => [0.72, 0.82, 1.0],
                "pointcloud" => [1.0, 0.62, 0.94],
                _ => [0.86, 0.82, 0.72],
            });
            let round = matches!(
                primitive.as_str(),
                "sphere" | "cylinder" | "cone" | "pyramid" | "column"
            ) || object_type == "pointcloud";
            let alpha = if bool_at(object, &["receiveProjection"]).unwrap_or(true) {
                0.38
            } else {
                0.22
            };
            items.push(stage3d_overlay_item(
                position,
                scale[0].abs().max(0.2),
                scale[1].abs().max(scale[2].abs()).max(0.2),
                [color[0], color[1], color[2], alpha],
                if round { 1.0 } else { 0.0 },
                rotation[2],
                1.0,
            ));
        }
    }

    if let Some(projectors) = scene.get("projectors").and_then(Value::as_array) {
        for projector in projectors {
            if items.len() >= MAX_STAGE3D_OVERLAY_ITEMS {
                return;
            }
            if !bool_at(projector, &["enabled"]).unwrap_or(true) {
                continue;
            }
            let position = vec3_path_or(projector, &["position"], [-4.0, 4.0, 6.0]);
            let target = vec3_path_or(projector, &["target"], [0.0, 2.0, 0.0]);
            let color = color_path_or(projector, &["color"]).unwrap_or([1.0, 1.0, 1.0]);
            let intensity = number_at(projector, &["intensity"])
                .unwrap_or(1.0)
                .clamp(0.1, 4.0) as f32;
            let opacity = number_at(projector, &["opacity"])
                .unwrap_or(1.0)
                .clamp(0.0, 1.0) as f32;
            items.push(stage3d_overlay_item(
                position,
                0.72,
                0.72,
                [color[0], color[1], color[2], 0.44 * opacity],
                1.0,
                0.0,
                intensity,
            ));
            if items.len() >= MAX_STAGE3D_OVERLAY_ITEMS {
                return;
            }
            let beam_center = [
                (position[0] + target[0]) * 0.5,
                (position[1] + target[1]) * 0.5,
                (position[2] + target[2]) * 0.5,
            ];
            let dx = target[0] - position[0];
            let dy = target[1] - position[1];
            let beam_len = (dx * dx + dy * dy).sqrt().max(1.0);
            items.push(stage3d_overlay_item(
                beam_center,
                beam_len,
                0.18,
                [color[0], color[1], color[2], 0.18 * opacity],
                0.0,
                dy.atan2(dx),
                intensity,
            ));
        }
    }
}

pub(crate) fn summarize_projection_sim_scene(scene: &Value) -> NativeSceneBridgeSummary {
    let mut summary = NativeSceneBridgeSummary::empty("projection-sim");
    summary.scene_id = string_at(scene, &["id"]).unwrap_or_default();
    summary.scene_name = string_at(scene, &["name"]).unwrap_or_default();
    summary.source_schema_version = number_at(scene, &["schemaVersion"])
        .unwrap_or(0.0)
        .round()
        .clamp(0.0, u32::MAX as f64) as u32;
    summary.payload_bytes = scene_payload_bytes(scene);
    summary.updated_at_ms = scene_bridge_epoch_ms();

    if let Some(projectors) = scene.get("projectors").and_then(Value::as_array) {
        summary.projector_count = projectors.len().min(u32::MAX as usize) as u32;
    }
    if let Some(objects) = scene.get("objects").and_then(Value::as_array) {
        summary.object_count = objects.len().min(u32::MAX as usize) as u32;
        for object in objects {
            match object
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "primitive" => summary.primitive_count = summary.primitive_count.saturating_add(1),
                "model" => summary.model_count = summary.model_count.saturating_add(1),
                "pointcloud" => {
                    summary.point_cloud_count = summary.point_cloud_count.saturating_add(1)
                }
                _ => {}
            }
        }
    }
    summary
}

impl App {
    pub(crate) fn set_projection_sim_scene(&mut self, params: &Value) -> Result<Value, String> {
        let scene_value = params
            .get("scene")
            .or_else(|| params.get("projection_sim"))
            .unwrap_or(params);
        if scene_value.is_null() {
            eprintln!("[ghost-core] projection-sim scene CLEARED");
            self.projection_sim_scene = None;
            self.projection_sim_scene_summary = NativeSceneBridgeSummary::empty("projection_sim");
            return Ok(json!(self.projection_sim_scene_summary.clone()));
        }
        let scene = scene_payload(params, "projection_sim")?;
        let summary = summarize_projection_sim_scene(scene);
        eprintln!("[ghost-core] projection-sim scene SET");
        self.projection_sim_scene = Some(scene.clone());
        self.projection_sim_scene_summary = summary.clone();
        Ok(json!(summary))
    }

    /// Map Sim geometry for projector views: upserts meshes by key, then
    /// drops any key not in `retain` (when given).
    pub(crate) fn set_projection_sim_meshes(&mut self, params: &Value) -> Result<Value, String> {
        let batch = projector_view::parse_projector_view_meshes(params)?;
        if let Some(retain) = batch.retain {
            let keep: HashSet<String> = retain.into_iter().collect();
            self.projection_sim_meshes.retain(|key, _| keep.contains(key));
        }
        let uploaded = batch.upserts.len();
        for (key, mesh) in batch.upserts {
            self.projection_sim_meshes.insert(key, mesh);
        }
        Ok(json!({ "meshes": self.projection_sim_meshes.len(), "uploaded": uploaded }))
    }

    pub(crate) fn set_projection_sim_view(&mut self, params: &Value) -> Result<Value, String> {
        self.projection_sim_view = projector_view::parse_projector_view_scene(params)?;
        let (objects, projectors) = self
            .projection_sim_view
            .as_ref()
            .map(|view| (view.objects.len(), view.cameras.len()))
            .unwrap_or((0, 0));
        let missing: Vec<&str> = self
            .projection_sim_view
            .as_ref()
            .map(|view| {
                view.objects
                    .iter()
                    .filter(|object| !self.projection_sim_meshes.contains_key(&object.mesh))
                    .map(|object| object.mesh.as_str())
                    .collect()
            })
            .unwrap_or_default();
        Ok(json!({ "objects": objects, "projectors": projectors, "missing_meshes": missing }))
    }

    pub(crate) fn set_projection_sim_overlay(&mut self, params: &Value) -> Result<Value, String> {
        let (projector_id, overlay) = projector_view::parse_projector_view_overlay(params)?;
        match overlay {
            Some(overlay) => {
                self.projection_sim_overlays.insert(projector_id, overlay);
            }
            None => {
                self.projection_sim_overlays.remove(&projector_id);
            }
        }
        Ok(json!({ "overlays": self.projection_sim_overlays.len() }))
    }

    /// Render and read back one Map Sim projector view:
    /// `{ projector_id, width?, height?, include_pixels? }`.
    pub(crate) fn projection_sim_view_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        let projector_id = string_at(params, &["projector_id"])
            .ok_or_else(|| "projection_sim_view_snapshot requires projector_id".to_string())?;
        let width = number_at(params, &["width"]).unwrap_or(640.0).round().clamp(16.0, 4096.0) as u32;
        let height = number_at(params, &["height"]).unwrap_or(360.0).round().clamp(16.0, 4096.0) as u32;
        let include_pixels = bool_at(params, &["include_pixels"]).unwrap_or(false);
        let inputs = ProjectorViewInputs {
            scene: self.projection_sim_view.as_ref(),
            meshes: &self.projection_sim_meshes,
            overlays: &self.projection_sim_overlays,
        };
        let renderer = self.renderer.as_mut().ok_or_else(|| "native renderer has not created a wgpu device".to_string())?;
        let readback = renderer.projector_view_snapshot(&inputs, &projector_id, width, height)?;
        let mut value = readback.to_json(include_pixels);
        if let Some(object) = value.as_object_mut() {
            object.insert("source".to_string(), json!("map-sim-projector-view"));
            object.insert("projector_id".to_string(), json!(projector_id));
        }
        Ok(value)
    }
}
