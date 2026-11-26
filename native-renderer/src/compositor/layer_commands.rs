//! Layer commands: upsert, interaction, visibility, colour, tint, native
//! params, edge effects and removal, and the layer data sent to the GPU.

use crate::*;

impl App {
    pub(crate) fn apply_upsert_layer(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        if std::env::var("GHOST_DEBUG_LAYERS").is_ok() {
            eprintln!("[layer-debug] upsert {layer_id}: {command}");
        }
        let z_index = number_at(command, &["z_index"])
            .unwrap_or(0.0)
            .round()
            .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, z_index));
        entry.z_index = z_index;
        if command_has_key(command, "vj_layer_index") || command_has_key(command, "vjLayerIndex") {
            entry.vj_layer_index = number_at_any(command, "vj_layer_index", "vjLayerIndex")
                .map(|value| value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32);
        }
        entry.opacity = number_at(command, &["opacity"])
            .unwrap_or(entry.opacity as f64)
            .clamp(0.0, 1.0) as f32;
        // Deck confidence monitors: VJ bank layers composite at opacity 0 in
        // the program mix (the crossfade pass samples their frames), but the
        // monitor passes re-render them at their true pre-crossfader level.
        if command_has_key(command, "deck_monitor_bank") {
            entry.deck_monitor_bank = string_at(command, &["deck_monitor_bank"])
                .and_then(|bank| match bank.as_str() {
                    "a" | "A" => Some(0u8),
                    "b" | "B" => Some(1u8),
                    _ => None,
                });
            entry.deck_monitor_opacity = number_at(command, &["deck_monitor_opacity"])
                .unwrap_or(1.0)
                .clamp(0.0, 1.0) as f32;
        }
        /* Absent means "leave as is", explicit null means "back to inherit" --
           the same contract as the other optional layer fields above. */
        if command_has_key(command, "render_quality") {
            entry.render_quality = number_at(command, &["render_quality"])
                .map(|value| (value as f32).clamp(0.2, 1.0));
        }
        if let Some(blend_mode) = string_at(command, &["blend_mode"]) {
            entry.blend_code = blend_mode_code(&blend_mode);
        }
        if let Some(corners) = corners_at(command, &["corners"]) {
            entry.corners = corners;
        }
        if let Some(perspective) = command.get("corner_perspective").and_then(|v| v.as_bool()) {
            entry.corner_perspective = perspective;
        }
        if let Some(uv_transform) = vec4_path_at(command, &["uv_transform"]) {
            entry.uv0 = [
                uv_transform[0].clamp(-8.0, 8.0),
                uv_transform[1].clamp(-8.0, 8.0),
                uv_transform[2].clamp(-8.0, 8.0),
                uv_transform[3].clamp(-8.0, 8.0),
            ];
        }
        if let Some(uv_flags) = vec4_path_at(command, &["uv_flags"]) {
            entry.uv1 = [
                uv_flags[0].clamp(0.0, 2.0),
                uv_flags[1].clamp(0.001, 128.0),
                uv_flags[2].clamp(0.0, 1.0),
                uv_flags[3].clamp(0.0, 1.0),
            ];
        }
        if let Some(shape) = vec4_path_at(command, &["shape"]) {
            entry.shape = [
                shape[0].clamp(0.0, 6.0),
                shape[1].clamp(0.0, 1.0),
                shape[2].clamp(-std::f32::consts::TAU, std::f32::consts::TAU),
                shape[3].clamp(0.0001, 8.0),
            ];
        }
        if let Some(shape2) = vec4_path_at(command, &["shape2"]) {
            // Primitive shapes: [radiusX, radiusY, sides, innerRadius].
            // Custom polygons: bounding box [minX, minY, sizeX, sizeY].
            let custom = entry.shape[0] >= 5.5;
            entry.shape2 = if custom {
                [
                    shape2[0].clamp(0.0, 1.0),
                    shape2[1].clamp(0.0, 1.0),
                    shape2[2].clamp(0.0001, 1.0),
                    shape2[3].clamp(0.0001, 1.0),
                ]
            } else {
                [
                    shape2[0].clamp(0.01, 4.0),
                    shape2[1].clamp(0.01, 4.0),
                    shape2[2].clamp(3.0, 12.0),
                    shape2[3].clamp(0.05, 1.0),
                ]
            };
        }
        if let Some(shape_meta) = vec4_path_at(command, &["shape_meta"]) {
            entry.shape_meta = [
                shape_meta[0].clamp(0.0, 64.0),
                shape_meta[1].clamp(0.0, 1.0),
                shape_meta[2].clamp(0.0, 2.0),
                shape_meta[3].clamp(0.0, 3.0),
            ];
        }
        if command_has_key(command, "shape_points") {
            entry.shape_pts.clear();
            if let Some(points) = command.get("shape_points").and_then(Value::as_array) {
                for point in points.iter().take(32) {
                    let Some(values) = point.as_array() else {
                        continue;
                    };
                    if values.len() < 4 {
                        continue;
                    }
                    let (Some(x0), Some(y0), Some(x1), Some(y1)) = (
                        values[0].as_f64(),
                        values[1].as_f64(),
                        values[2].as_f64(),
                        values[3].as_f64(),
                    ) else {
                        continue;
                    };
                    entry.shape_pts.push([
                        (x0 as f32).clamp(-1.0, 2.0),
                        (y0 as f32).clamp(-1.0, 2.0),
                        (x1 as f32).clamp(-1.0, 2.0),
                        (y1 as f32).clamp(-1.0, 2.0),
                    ]);
                }
            }
        }
        if let Some(mask_info) = vec4_path_at(command, &["mask_info"]) {
            entry.mask_info = [
                mask_info[0].clamp(0.0, 1.0),
                mask_info[1].clamp(0.0, 1.0),
                mask_info[2].clamp(0.0, 1.0),
                mask_info[3].clamp(0.0, MAX_LAYER_MASK_POINTS as f32),
            ];
        }
        if command_has_key(command, "mask_points") {
            entry.mask_points.clear();
            if let Some(points) = command.get("mask_points").and_then(Value::as_array) {
                for point in points.iter().take(MAX_LAYER_MASK_POINTS) {
                    let Some(values) = point.as_array() else {
                        continue;
                    };
                    if values.len() < 4 {
                        continue;
                    }
                    let Some(x) = values[0].as_f64() else {
                        continue;
                    };
                    let Some(y) = values[1].as_f64() else {
                        continue;
                    };
                    let Some(next) = values[2].as_f64() else {
                        continue;
                    };
                    let Some(shape) = values[3].as_f64() else {
                        continue;
                    };
                    entry.mask_points.push([
                        x.clamp(-8.0, 8.0) as f32,
                        y.clamp(-8.0, 8.0) as f32,
                        next.clamp(0.0, (MAX_LAYER_MASK_POINTS - 1) as f64) as f32,
                        shape.clamp(0.0, 7.0) as f32,
                    ]);
                }
                entry.mask_info[3] = entry.mask_points.len() as f32;
            }
        }
        if command_has_key(command, "mesh_grid") {
            apply_layer_mesh_grid(entry, command.get("mesh_grid"));
        }
    }

    pub(crate) fn apply_layer_interaction(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(entry) = self.scene_layers.get_mut(&layer_id) else {
            return;
        };
        if let Some(corners) = corners_at(command, &["corners"]) {
            entry.corners = corners;
        }
        if command_has_key(command, "mesh_grid") {
            apply_layer_mesh_grid(entry, command.get("mesh_grid"));
        }
    }

    pub(crate) fn apply_layer_visibility(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let visible = bool_at(command, &["visible"]).unwrap_or(true);
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.visible = visible;
    }

    pub(crate) fn apply_layer_color(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(rgba) = rgba_at(command, &["rgba"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        set_scene_layer_color(entry, rgba);
    }

    pub(crate) fn apply_layer_tint(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(rgba) = rgba_at(command, &["rgba"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.tint = [rgba[0].clamp(0.0, 1.0), rgba[1].clamp(0.0, 1.0), rgba[2].clamp(0.0, 1.0), 1.0];
    }

    pub(crate) fn apply_layer_native_params(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(params) = params8_at(command, &["params"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.native_params.copy_from_slice(&params[..8]);
    }

    pub(crate) fn apply_layer_edge_effects(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.edge = Box::new(parse_layer_edge_effects(command));
    }

    pub(crate) fn apply_remove_layer(&mut self, command: &Value) {
        if let Some(layer_id) = string_at(command, &["layer_id"]) {
            self.scheduled_binding_guards.remove(&layer_id);
            self.captured_graph_holds.remove(&layer_id);
            self.paint_masks.remove_layer(&layer_id);
            let (removed_source, removed_shader_output, removed_effect_input, removed_held) = self
                .scene_layers
                .remove(&layer_id)
                .map(|layer| (layer.source_id, layer.shader_source_id, layer.effect_input_source_id,
                    layer.held.map(|held| held.source_id)))
                .unwrap_or((None, None, None, None));
            let pending_source = self
                .pending_media_bindings
                .remove(&layer_id)
                .map(|binding| binding.source_id);
            self.isf_layer_bindings.remove(&layer_id);
            let graph_sources = self.release_native_graph_layer_state(&layer_id);
            self.native_point_cloud_assets.remove(&layer_id);
            let effect_output_id = format!("effect-pass:{layer_id}");
            let effect_prefix = format!("{effect_output_id}:");
            let gpu_prefix = format!("gpu:{layer_id}:");
            let plugin_prefix = format!("plugin:{layer_id}:");
            let owned_by_removed_layer = |id: &str| {
                id == effect_output_id || id.starts_with(&effect_prefix)
                    || id.starts_with(&gpu_prefix) || id.starts_with(&plugin_prefix)
            };
            // Externally queued effect chains have no NativeGraphLayer entry.
            // A still-pending chain otherwise keeps both its old media input
            // and output slots referenced after the layer has been deleted.
            self.pending_native_graph_jobs.retain(|job| {
                !job.render_plans.iter().any(|plan| match &plan.target {
                    NativeComputeGraphRenderTarget::SourceFrame { source_id, .. } =>
                        owned_by_removed_layer(source_id),
                    _ => false,
                })
            });
            if let Some(source_id) = removed_source {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = removed_effect_input {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = removed_shader_output {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = removed_held {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = pending_source {
                self.release_media_source_if_orphaned(&source_id);
            }
            // A GPU instrument's own instrument/input source frames are not
            // the layer's composite binding, so they survive the two calls
            // above. Left resident they are still sampleable by anything
            // that binds `layer-frame:<id>` (VJ crossfade/mix rows, ISF
            // image inputs) after the layer is gone.
            for source_id in graph_sources {
                self.release_media_source_if_orphaned(&source_id);
            }
            let owned_slots = self.source_frame_slots.keys()
                .filter(|id| owned_by_removed_layer(id))
                .cloned().collect::<Vec<_>>();
            for source_id in owned_slots {
                self.release_media_source_if_orphaned(&source_id);
            }
            // Removing a layer changes what the output should show, and this
            // may have been the last one. Arm a frame so the composite,
            // export texture, slices and swapchain are all repainted even if
            // the host never sends another present.
            self.pending_render_retry = true;
        }
    }

    pub(crate) fn gpu_layer_data(&self) -> Vec<LayerGpu> {
        let mut layers: Vec<&SceneLayer> = self.scene_layers.values().collect();
        // Editor layer index 0 is visually top-most, so send larger z first
        // and let z=0 blend last.
        layers.sort_by(|a, b| b.z_index.cmp(&a.z_index).then_with(|| a.id.cmp(&b.id)));
        layers
            .into_iter()
            .take(MAX_SCENE_LAYERS)
            .map(|layer| self.with_source_mips(layer, self.with_paint_mask(layer, layer.gpu())))
            .collect()
    }

    /// fast_flags.w bit 2: the layer's picture slot has a current mip chain,
    /// so the compositor reads minified pixels from the level they need
    /// (heartbeat.wgsl layer_source_lod). Never for live video, whose slot
    /// holds level zero only. Without GA_CORE_SOURCE_MIPS=1 every read stays at
    /// level zero. Only for a layer that can show its picture minified
    /// (`layer_may_minify`): the per-pixel level costs time, and a picture
    /// drawn at or above its size reads level zero anyway.
    pub(crate) fn with_source_mips(&self, layer: &SceneLayer, mut gpu: LayerGpu) -> LayerGpu {
        let code = gpu.meta[3];
        let live_video = gpu.meta[2] > 2.5 && gpu.meta[2] < 3.5;
        if !source_mips_enabled() || live_video || code < SOURCE_FRAME_SLOT_OFFSET + 1.0 {
            return gpu;
        }
        let Some(renderer) = self.renderer.as_ref() else { return gpu };
        let slot = (code - SOURCE_FRAME_SLOT_OFFSET - 1.0).floor().max(0.0) as usize;
        if !renderer.slots.mips_current(slot) {
            return gpu;
        }
        let stored = renderer.slots.slot(slot);
        let texels = [stored.width as f32 * gpu.source_rect[2], stored.height as f32 * gpu.source_rect[3]];
        if layer_may_minify(layer, texels, [renderer.config.width as f32, renderer.config.height as f32]) {
            gpu.fast_flags[3] |= 4;
        }
        gpu
    }

    /// Point a layer at its painted mask: fast_flags.z = texture array
    /// slot + 1 (0 = none), fast_flags.w bit 0 = inverted. A painted layer
    /// is never a plain rectangle fill.
    pub(crate) fn with_paint_mask(&self, layer: &SceneLayer, mut gpu: LayerGpu) -> LayerGpu {
        let (slot, flags) = self.paint_masks.gpu_flags(&layer.id);
        if slot != 0 {
            gpu.fast_flags[0] = 0;
            gpu.fast_flags[2] = slot;
            gpu.fast_flags[3] = flags | (gpu.fast_flags[3] & 2);
        }
        gpu
    }

    /// Bring the GPU paint-mask texture up to date: resolution for the
    /// current output, enough array layers, and the texels that changed.
    pub(crate) fn sync_paint_masks_to_gpu(&mut self) {
        let Some(renderer) = self.renderer.as_mut() else { return };
        let want = paint_mask::paint_mask_size_for_output(renderer.config.width, renderer.config.height);
        self.paint_masks.set_size(want);
        let needed = self.paint_masks.slots_needed();
        if needed == 0 {
            return;
        }
        if renderer.ensure_paint_mask_capacity(self.paint_masks.size(), needed) {
            self.paint_masks.mark_all_dirty();
        }
        for upload in self.paint_masks.drain_uploads() {
            renderer.write_paint_mask(&upload);
        }
    }
}
