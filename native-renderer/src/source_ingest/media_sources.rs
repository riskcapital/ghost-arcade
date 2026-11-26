//! Media source commands: binding sources to layers, holds, orphan sweeps,
//! readiness, and playback and decode requests.

use crate::*;

impl App {
    pub(crate) fn apply_media_source(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let source_id = string_at(command, &["source_id"]);
        if self.scheduled_binding_guards.get(&layer_id).is_some_and(|(previous, _, generation)| {
            source_id.as_ref() == Some(previous) && generation.is_none_or(|expected|
                self.media_sources.get(previous).is_none_or(|media| media.seek_generation == expected))
        }) {
            return; // The editor has not yet acknowledged the scheduled handoff.
        }
        self.scheduled_binding_guards.remove(&layer_id);
        let outgoing_picture = self.layer_displayed_picture(&layer_id);
        let source_id_for_decode = source_id.clone();
        let uri_for_decode = string_at(command, &["uri"]);
        let source_type =
            string_at(command, &["source_type"]).unwrap_or_else(|| "none".to_string());
        self.pending_media_bindings.remove(&layer_id);
        if source_type == "video"
            && let Some(source_id) = source_id.as_deref()
            && !self.source_frames.contains_key(source_id)
        {
            self.prime_native_video_source(source_id);
        }
        let preview_slot = source_id
            .as_ref()
            .and_then(|id| self.source_preview_slots.get(id))
            .copied();
        let frame_slot = source_id
            .as_ref()
            .and_then(|id| self.source_frame_slots.get(id))
            .copied();
        let source_rect = source_id
            .as_ref()
            .and_then(|id| self.source_frames.get(id))
            .map(|frame| frame.source_rect)
            .unwrap_or([0.0, 0.0, 1.0, 1.0]);
        let effective_source_type = effective_scene_source_type(
            &source_type,
            uri_for_decode.as_deref(),
            frame_slot.is_some(),
        );
        if let (Some(source_id), Some(uri)) = (source_id.as_deref(), uri_for_decode.as_deref()) {
            self.upsert_media_source_binding(source_id, uri, &effective_source_type);
        }
        // Video source replacement is transactional. A decoder may be warm,
        // starting, or seeking, but the compositor never exposes a synthetic
        // placeholder between real frames. Retain the requested binding until
        // the decoder uploads its first frame, then commit it atomically.
        // A slot can exist before any pixel does (sessions allocate their slot
        // at spawn). Displaying such a slot shows the zero-filled video
        // texture — the "green first frame". Only commit when a REAL frame
        // has been delivered for this source.
        let has_delivered_frame = source_id
            .as_deref()
            .is_some_and(|id| self.source_frames.contains_key(id));
        if effective_source_type == "video" && (frame_slot.is_none() || !has_delivered_frame) {
            let entry = self.scene_layers.entry(layer_id.clone())
                .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
            if entry.source_id.is_none() && !entry.shader_rendered {
                // No outgoing picture exists on a new row. Mark it as
                // waiting media so gpu() cannot paint its debug fill.
                entry.source_kind = source_kind("video");
            }
            if let Some(source_id) = source_id {
                self.pending_media_bindings.insert(
                    layer_id,
                    PendingMediaBinding {
                        source_id,
                        source_type: effective_source_type,
                    },
                );
            }
            return;
        }
        // An effect-pass output displays ON the layer while the layer's bound
        // FS/ISF shader keeps rendering underneath as the chain's INPUT — the
        // shader binding must survive this display bind.
        let effect_pass_display = uri_for_decode
            .as_deref()
            .is_some_and(|uri| uri.starts_with("native-effect-pass://"));
        // The shader's output is let go below, once any hold on it is set.
        let release_shader_output = effective_source_type != "shader" && !effect_pass_display;
        if release_shader_output {
            self.isf_layer_bindings.remove(&layer_id);
        }
        let new_source_id = source_id.clone();
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
        let previous_source_id = entry.source_id.clone();
        let previous_effect_input = entry.effect_input_source_id.take();
        entry.effect_input_source_id = if effect_pass_display {
            string_at(command, &["effect_input_source_id"])
        } else { None };
        // An effect output may have a slot before the first graph pass has
        // rendered, or may still contain the previous clip after an input
        // switch. Keep showing the raw, resident input until the new pass has
        // actually been submitted. Otherwise the operator sees black or a
        // ghost frame while the pipeline warms.
        let effect_input_changed = previous_effect_input != entry.effect_input_source_id;
        let raw_input_slot = entry.effect_input_source_id.as_ref().and_then(|id| {
            if self.source_frames.contains_key(id) {
                self.source_frame_slots.get(id).copied()
            } else { None }
        }).or(entry.shader_frame_slot);
        let raw_input_rect = entry.effect_input_source_id.as_ref()
            .and_then(|id| self.source_frames.get(id).map(|frame| frame.source_rect));
        let hold_effect_input = effect_pass_display &&
            (effect_input_changed || !self.source_frames.contains_key(new_source_id.as_deref().unwrap_or("")));
        let held_slot = if hold_effect_input { raw_input_slot.or(entry.frame_slot) } else { frame_slot };
        let held_rect = if hold_effect_input { raw_input_rect.unwrap_or(entry.source_rect) } else { source_rect };
        let held_kind = if hold_effect_input && held_slot.is_some() {
            entry.effect_input_source_id.as_ref()
                .and_then(|id| self.media_sources.get(id))
                .map(|state| source_kind(&state.source_type))
                .unwrap_or_else(|| if entry.shader_frame_slot == held_slot && entry.shader_rendered {
                    NATIVE_SHADER_SOURCE_KIND
                } else { entry.source_kind })
        } else { source_kind(&effective_source_type) };
        entry.source_kind = held_kind;
        entry.source_id = source_id;
        entry.preview_slot = preview_slot;
        entry.frame_slot = held_slot;
        entry.source_rect = held_rect;
        if !effect_pass_display {
            entry.shader_rendered = false;
        }
        if effective_source_type != "shader" && !effect_pass_display {
            entry.shader_id = None;
        }
        if effective_source_type != "none" && entry.color[3] <= 0.0 {
            entry.color = stable_layer_color(&layer_id, 1.0);
        }
        if effective_source_type != "color" {
            entry.color = source_type_color(&effective_source_type, &layer_id);
        }
        // A page, shader or image that has no picture yet keeps the layer's
        // outgoing picture on screen until its first frame (see HeldPicture).
        let source_changed = new_source_id.as_deref() != previous_source_id.as_deref();
        let waits_for_picture = match effective_source_type.as_str() {
            "image" => entry.frame_slot.is_none(),
            "shader" => true,
            _ => false,
        };
        let mut dropped_hold = None;
        if source_changed && waits_for_picture && !effect_pass_display {
            if let Some(picture) = outgoing_picture {
                if entry.held.as_ref().is_some_and(|held| held.source_id != picture.source_id) {
                    dropped_hold = entry.held.take().map(|held| held.source_id);
                }
                entry.held = Some(picture);
            }
        } else if source_changed || !waits_for_picture {
            dropped_hold = entry.held.take().map(|held| held.source_id);
        }
        if release_shader_output {
            self.release_layer_shader_output(&layer_id, None);
        }
        if let Some(previous) = dropped_hold {
            self.release_replaced_media_source(previous);
        }
        if let Some(previous) = previous_source_id
            && new_source_id.as_deref() != Some(previous.as_str())
        {
            self.release_replaced_media_source(previous);
        }
        if let Some(previous) = previous_effect_input {
            self.release_replaced_media_source(previous);
        }
        if effective_source_type == "image" {
            if let (Some(source_id), Some(uri)) = (source_id_for_decode, uri_for_decode.as_deref())
            {
                self.decode_native_image_source(&source_id, uri);
            }
        }
    }

    /// The real picture a layer is showing now, if any: a held picture, a
    /// rendered shader frame, or a delivered media frame. Placeholders and
    /// the empty input frame do not count.
    pub(crate) fn layer_displayed_picture(&self, layer_id: &str) -> Option<HeldPicture> {
        let layer = self.scene_layers.get(layer_id)?;
        if let Some(held) = &layer.held {
            return Some(held.clone());
        }
        if layer.shader_rendered
            && let (Some(slot), Some(source_id)) = (layer.shader_frame_slot, layer.shader_source_id.as_ref())
            && layer.frame_slot == Some(slot)
        {
            return Some(HeldPicture {
                source_id: source_id.clone(),
                slot,
                rect: [0.0, 0.0, 1.0, 1.0],
                kind: NATIVE_SHADER_SOURCE_KIND,
                since: Instant::now(),
            });
        }
        let source_id = layer.source_id.as_ref()?;
        let slot = layer.frame_slot?;
        if source_id == EMPTY_SOURCE_FRAME_ID
            || source_id.starts_with("effect-pass:")
            || layer.source_kind < 0.5
            || !self.source_frames.contains_key(source_id)
            || self.source_frame_slots.get(source_id) != Some(&slot)
        {
            return None;
        }
        Some(HeldPicture {
            source_id: source_id.clone(),
            slot,
            rect: layer.source_rect,
            kind: if layer.shader_rendered { NATIVE_SHADER_SOURCE_KIND } else { layer.source_kind },
            since: Instant::now(),
        })
    }

    /// The layer has its own picture now: stop showing the held one.
    pub(crate) fn end_layer_hold(&mut self, layer_id: &str) {
        let held = self.scene_layers.get_mut(layer_id).and_then(|layer| layer.held.take());
        if let Some(held) = held {
            self.release_replaced_media_source(held.source_id);
        }
    }

    /// Give up holds that have waited too long for their new source.
    pub(crate) fn expire_layer_holds(&mut self) {
        let expired = self.scene_layers.values()
            .filter(|layer| layer.held.as_ref().is_some_and(|held| held.since.elapsed() >= LAYER_HOLD_MAX))
            .map(|layer| layer.id.clone())
            .collect::<Vec<_>>();
        for layer_id in expired {
            self.end_layer_hold(&layer_id);
        }
    }

    pub(crate) fn commit_pending_media_bindings_for_source(
        &mut self,
        source_id: &str,
        frame_slot: usize,
        source_rect: [f32; 4],
    ) {
        // Layers already bound to this source have their picture now.
        let delivered = self.scene_layers.values()
            .filter(|layer| layer.held.is_some() && layer.source_id.as_deref() == Some(source_id))
            .map(|layer| layer.id.clone())
            .collect::<Vec<_>>();
        for layer_id in delivered {
            self.end_layer_hold(&layer_id);
        }
        let ready_layers = self
            .pending_media_bindings
            .iter()
            .filter(|(_, binding)| binding.source_id == source_id)
            .map(|(layer_id, binding)| (layer_id.clone(), binding.clone()))
            .collect::<Vec<_>>();
        let mut replaced_sources = Vec::new();
        for (layer_id, binding) in ready_layers {
            self.pending_media_bindings.remove(&layer_id);
            self.isf_layer_bindings.remove(&layer_id);
            self.release_layer_shader_output(&layer_id, None);
            let entry = self
                .scene_layers
                .entry(layer_id.clone())
                .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
            if let Some(previous) = entry.source_id.clone()
                && previous != binding.source_id
            {
                replaced_sources.push(previous);
            }
            if let Some(previous_input) = entry.effect_input_source_id.take() {
                replaced_sources.push(previous_input);
            }
            entry.source_kind = source_kind(&binding.source_type);
            entry.source_id = Some(binding.source_id);
            entry.preview_slot = None;
            entry.frame_slot = Some(frame_slot);
            entry.source_rect = source_rect;
            entry.shader_rendered = false;
            entry.shader_id = None;
            entry.color = source_type_color(&binding.source_type, &layer_id);
            if let Some(held) = entry.held.take() {
                replaced_sources.push(held.source_id);
            }
        }
        // The commit just unbound these sources from their layers; free their
        // sessions/slots unless something else still references them.
        for previous in replaced_sources {
            self.release_media_source_if_orphaned(&previous);
        }
    }

    /// What keeps a media source referenced, by name (empty when nothing
    /// does): the same checks as `media_source_is_referenced`.
    pub(crate) fn media_source_holders(&self, source_id: &str) -> Vec<&'static str> {
        let mut holders = Vec::new();
        if self.launch_scheduler.references_source(source_id) { holders.push("launch_scheduler"); }
        if self.scene_layers.values().any(|layer| layer.source_id.as_deref() == Some(source_id)) { holders.push("layer_source"); }
        if self.scene_layers.values().any(|layer| layer.effect_input_source_id.as_deref() == Some(source_id)
            || layer.shader_source_id.as_deref() == Some(source_id)) { holders.push("layer_effect_or_shader"); }
        if self.scene_layers.values().any(|layer| layer.held.as_ref().is_some_and(|held| held.source_id == source_id)) { holders.push("layer_held"); }
        if self.pending_media_bindings.values().any(|binding| binding.source_id == source_id) { holders.push("pending_binding"); }
        if self.native_graph_layers.values().any(|layer| layer.input_source_id == source_id || layer.source_id == source_id
            || layer.effect_job_template.as_ref().is_some_and(|job| graph_job_references_source(job, source_id))) { holders.push("graph_layer"); }
        if self.pending_native_graph_jobs.iter().any(|job| graph_job_references_source(job, source_id)) { holders.push("pending_graph_job"); }
        if self.prepared_launch_sources.contains_key(source_id) { holders.push("prepared_launch"); }
        if self.native_video_streams.contains_key(source_id) { holders.push("has_session"); }
        if self.source_frames.contains_key(source_id) { holders.push("has_frame"); }
        holders
    }

    pub(crate) fn media_source_is_referenced(&self, source_id: &str) -> bool {
        if source_id == EMPTY_SOURCE_FRAME_ID {
            return true;
        }
        self.launch_scheduler.references_source(source_id) || self.scene_layers.values().any(|layer| {
            layer.source_id.as_deref() == Some(source_id)
                || layer.effect_input_source_id.as_deref() == Some(source_id)
                || layer.shader_source_id.as_deref() == Some(source_id)
                || layer.held.as_ref().is_some_and(|held| held.source_id == source_id)
        })
            || self
                .pending_media_bindings
                .values()
                .any(|binding| binding.source_id == source_id)
            || self
                .native_graph_layers
                .values()
                .any(|layer| layer.input_source_id == source_id || layer.source_id == source_id
                    || layer.effect_job_template.as_ref().is_some_and(|job| graph_job_references_source(job, source_id)))
            || self.pending_native_graph_jobs.iter().any(|job| graph_job_references_source(job, source_id))
    }

    /// Let go of the frame a shader layer rendered, unless it is `keep`.
    /// Every shader (and every edit of one) renders under its own
    /// `native-shader:` id, so each clip switch or content swap would
    /// otherwise strand a slot until the pool is full.
    pub(crate) fn release_layer_shader_output(&mut self, layer_id: &str, keep: Option<&str>) {
        let Some(layer) = self.scene_layers.get_mut(layer_id) else {
            return;
        };
        let Some(previous) = layer.shader_source_id.clone() else {
            return;
        };
        if keep == Some(previous.as_str()) {
            return;
        }
        layer.shader_source_id = None;
        let previous_slot = self.source_frame_slots.get(&previous).copied();
        if previous_slot.is_some() && layer.shader_frame_slot == previous_slot {
            layer.shader_frame_slot = None;
        }
        self.release_media_source_if_orphaned(&previous);
    }

    /// Free every per-source resource for a media source that no layer,
    /// pending binding, or graph input references anymore. Without this,
    /// replaced sources accumulate until the armed-session cap and the
    /// source-frame slots fill; per-frame ensure() then refreshes every
    /// session's last_used_frame, LRU eviction degrades to effectively
    /// random churn, and the *incoming* source's session can be evicted
    /// before it pre-rolls — observed as "switching clips stops working
    /// after several swaps" with the layer stuck on PENDING.
    pub(crate) fn release_source_frame_slot(&mut self, source_id: &str) {
        if let Some(slot) = self.source_frame_slots.remove(source_id) {
            if let Some(renderer) = &self.renderer {
                renderer.hap_converter.release(slot);
                renderer.release_shared_texture_import(slot);
                // A per-source slot gives its texture back.
                renderer.slots.release(slot);
            }
        }
    }

    /// Release a source a layer just let go of. Inside a command batch the
    /// check waits for the end of the batch, where a later bind may have
    /// given the source a new layer.
    pub(crate) fn release_replaced_media_source(&mut self, source_id: String) {
        match self.batch_orphan_candidates.as_mut() {
            Some(candidates) => candidates.push(source_id),
            None => self.release_media_source_if_orphaned(&source_id),
        }
    }

    /// Release plain media sources nothing has referenced for
    /// `media_orphans::ORPHAN_GRACE` (at most once a second).
    pub(crate) fn sweep_orphan_media_sources(&mut self, now: Instant) {
        if !self.orphan_sweep.due(now) {
            return;
        }
        let sources = self.media_sources.keys()
            .map(|id| (id.clone(), self.media_source_is_referenced(id)
                || self.prepared_launch_sources.get(id).is_some_and(|expires| *expires > now)))
            .collect::<Vec<_>>();
        let release = self.orphan_sweep.pass(
            sources.iter().map(|(id, referenced)| (id.as_str(), *referenced)), EMPTY_SOURCE_FRAME_ID, now);
        for id in release {
            self.release_media_source_if_orphaned(&id);
        }
    }

    pub(crate) fn release_media_source_if_orphaned(&mut self, source_id: &str) {
        if source_id.is_empty()
            || source_id.starts_with("library:")
            || self.media_source_is_referenced(source_id)
        {
            return;
        }
        self.drop_media_source(source_id);
        self.stats.media_source_orphan_releases =
            self.stats.media_source_orphan_releases.saturating_add(1);
    }

    /// Every per-source record and resource of one media source.
    pub(crate) fn drop_media_source(&mut self, source_id: &str) {
        self.media_sources.remove(source_id);
        self.link_phase_anchors.remove(source_id);
        self.deferred_source_releases.remove(source_id);
        self.native_video_streams.remove(source_id);
        self.native_video_scrub_requests.remove(source_id);
        self.live_capture.unbind(source_id);
        self.release_source_frame_slot(source_id);
        self.source_frames.remove(source_id);
        self.source_frame_signatures.remove(source_id);
        self.native_video_frame_signatures.remove(source_id);
    }

    /// File > New and opening a project: the media tray's pre-rolled videos
    /// (`library:` sources, up to `NATIVE_LIBRARY_SESSION_CAP`, ~100 MB of
    /// decoded frames) belong to the project that was open. Release every one
    /// no layer is playing or using; the tray arms them again on hover.
    pub(crate) fn release_library_prerolls(&mut self) -> Value {
        let ids = self.media_sources.keys().chain(self.native_video_streams.keys())
            .map(|id| id.as_str())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .map(|id| media_orphans::LibraryPreroll {
                id,
                playing: self.native_video_streams.get(id).is_some_and(|session| session.playing),
                referenced: self.media_source_is_referenced(id),
            })
            .collect::<Vec<_>>();
        let release = media_orphans::library_prerolls_to_release(&ids);
        for id in &release {
            self.drop_media_source(id);
        }
        let kept = self.native_video_streams.keys().filter(|id| id.starts_with("library:")).count();
        json!({ "released": release.len(), "kept": kept })
    }

    pub(crate) fn source_frame_readiness(&self, params: &Value) -> Result<Value, String> {
        let source_id = string_at(params, &["source_id"])
            .ok_or_else(|| "get_source_frame_readiness requires source_id".to_string())?;
        let expected_generation = params.get("seek_generation").and_then(Value::as_u64);
        let slot = self.source_frame_slots.get(&source_id).copied();
        let frame = self.source_frames.get(&source_id);
        let session = self.native_video_streams.get(&source_id);
        let generation = session.map(|session| session.seek_generation)
            .or_else(|| self.media_sources.get(&source_id).map(|state| state.seek_generation));
        let gpu_ready = self.renderer.as_ref().is_some_and(|renderer| {
            let _ = renderer.device.poll(wgpu::PollType::Poll);
            slot.is_some_and(|slot| renderer.slot_readiness(slot).ready())
        });
        let ready = frame.is_some() && gpu_ready
            && expected_generation.is_none_or(|expected| generation == Some(expected))
            && session.is_none_or(|session| session.frames_presented > 0);
        Ok(json!({ "source_id": source_id, "ready": ready, "gpu_ready": gpu_ready,
            "source_slot": slot, "frame_sequence": frame.map(|frame| frame.seq),
            "seek_generation": generation, "frames_presented": session.map(|session| session.frames_presented) }))
    }

    pub(crate) fn layer_source_readiness(&self, params: &Value) -> Result<Value, String> {
        let layer_id = string_at(params, &["layer_id"])
            .ok_or_else(|| "get_layer_source_readiness requires layer_id".to_string())?;
        let expected_source = string_at(params, &["source_id"]);
        let expected_generation = params.get("seek_generation").and_then(Value::as_u64);
        let layer = self.scene_layers.get(&layer_id);
        let actual_source = layer.and_then(|layer| {
            if layer.shader_rendered && layer.frame_slot == layer.shader_frame_slot {
                layer.shader_source_id.as_deref()
            } else { layer.source_id.as_deref() }
        });
        let pending = self.pending_media_bindings.get(&layer_id);
        let slot = layer.and_then(|layer| layer.frame_slot);
        let source_frame = actual_source.and_then(|source| self.source_frames.get(source));
        let session = actual_source.and_then(|source| self.native_video_streams.get(source));
        let media = actual_source.and_then(|source| self.media_sources.get(source));
        let seek_generation = session.map(|session| session.seek_generation)
            .or_else(|| media.map(|state| state.seek_generation));
        let gpu_ready = self.renderer.as_ref().is_some_and(|renderer| {
            let _ = renderer.device.poll(wgpu::PollType::Poll);
            slot.is_some_and(|slot| renderer.slot_readiness(slot).ready())
        });
        let ready = pending.is_none() && source_frame.is_some() && gpu_ready
            && expected_source.as_deref().is_none_or(|expected| actual_source == Some(expected))
            && expected_generation.is_none_or(|expected| seek_generation == Some(expected))
            && session.is_none_or(|session| session.frames_presented > 0);
        Ok(json!({
            "layer_id": layer_id, "ready": ready,
            "actual_source_id": actual_source,
            "requested_source_id": pending.map(|binding| binding.source_id.as_str()).or(expected_source.as_deref()),
            "pending": pending.is_some(), "gpu_ready": gpu_ready,
            "source_slot": slot, "source_rect": layer.map(|layer| layer.source_rect),
            "frame_sequence": source_frame.map(|frame| frame.seq),
            "seek_generation": seek_generation,
            "frames_presented": session.map(|session| session.frames_presented),
        }))
    }

    pub(crate) fn capture_layer_source_frame(&mut self, params: &Value) -> Result<Value, String> {
        let layer_id = string_at(params, &["layer_id"])
            .ok_or_else(|| "capture_layer_source_frame requires layer_id".to_string())?;
        let source_id = string_at(params, &["source_id"])
            .filter(|source| is_clip_snapshot_source_id(source))
            .ok_or_else(|| "capture_layer_source_frame requires a bounded vj-clip-snapshot-{A|B}-{0..31} source_id".to_string())?;
        let readiness = self.layer_source_readiness(&json!({"layer_id": layer_id}))?;
        if readiness["ready"] != true {
            return Err(format!("layer `{layer_id}` has no completed source frame to capture"));
        }
        let layer = self.scene_layers.get(&layer_id).expect("ready layer exists");
        let input_slot = layer.frame_slot.expect("ready layer has a slot");
        let source_rect = layer.source_rect;
        let seq = readiness["frame_sequence"].as_u64().unwrap_or(0);
        let output_slot = if let Some(slot) = self.source_frame_slots.get(&source_id) {
            *slot
        } else {
            // A transition must never evict the incoming or outgoing live
            // picture to make room for its optional interruption snapshot.
            let slot = self.free_source_frame_slot()
                .ok_or_else(|| "no free GPU source slot for clip transition snapshot".to_string())?;
            self.source_frame_slots.insert(source_id.clone(), slot);
            self.clear_new_source_frame_slot(slot);
            slot
        };
        if input_slot == output_slot {
            return Err("cannot capture a snapshot into its own source slot".to_string());
        }
        self.renderer.as_ref().ok_or_else(|| "renderer unavailable".to_string())?
            .copy_source_frame_slot(input_slot, output_slot);
        // Reusing a row's snapshot can overwrite an input of its old fade.
        // Freeze that carrier's last output until the host installs the new
        // fade, or a native tick in the RPC gap would blend the picture twice.
        if self.native_graph_layers.contains_key(&layer_id) {
            self.captured_graph_holds.insert(layer_id.clone());
        }
        self.source_frames.insert(source_id.clone(), SourceFrame::with_rect(seq, source_rect));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(&source_id) {
                layer.frame_slot = Some(output_slot);
                layer.source_rect = source_rect;
            }
        }
        Ok(json!({ "captured": true, "layer_id": layer_id, "source_id": source_id,
            "source_slot": output_slot, "source_rect": source_rect, "frame_sequence": seq,
            "transport": "gpu-copy" }))
    }

    pub(crate) fn release_source_frame(&mut self, params: &Value) -> Result<Value, String> {
        let source_id = string_at(params, &["source_id"])
            .filter(|source| is_clip_snapshot_source_id(source) || source.starts_with("native-splat-video-"))
            .ok_or_else(|| "release_source_frame requires an owned temporary source_id".to_string())?;
        if self.media_source_is_referenced(&source_id) {
            if source_id.starts_with("native-splat-video-") { self.deferred_source_releases.insert(source_id.clone()); }
            return Ok(json!({ "released": false, "referenced": true, "source_id": source_id, "reason": "source is still referenced" }));
        }
        self.release_media_source_if_orphaned(&source_id);
        Ok(json!({ "released": true, "referenced": false, "source_id": source_id }))
    }

    pub(crate) fn upsert_media_source_binding(&mut self, source_id: &str, uri: &str, source_type: &str) {
        if source_id.trim().is_empty() || uri.trim().is_empty() || source_type == "none" {
            return;
        }
        let render_clock_time = self.native_clock_seconds();
        self.media_sources
            .entry(source_id.to_string())
            .and_modify(|state| {
                state.uri = uri.to_string();
                state.source_type = source_type.to_string();
            })
            .or_insert_with(|| NativeMediaSourceState {
                uri: uri.to_string(),
                source_type: source_type.to_string(),
                playback_time_seconds: 0.0,
                seek_generation: 0,
                playback_rate: 1.0,
                paused: true,
                loop_enabled: false,
                bounce_enabled: false,
                duration_seconds: None,
                trim_start: 0.0,
                trim_end: 1.0,
                decode_width: None,
                decode_height: None,
                clock_time_seconds: render_clock_time,
                seq: 0,
            });
    }

    pub(crate) fn apply_media_source_playback(&mut self, command: &Value) {
        let Some(source_id) = string_at(command, &["source_id"]) else {
            return;
        };
        if bool_at(command, &["prepare_for_launch"]) == Some(true) && self.prepared_launch_sources.len() < 64 {
            self.prepared_launch_sources.insert(source_id.clone(), Instant::now() + Duration::from_secs(2));
        }
        let existing = self.media_sources.get(&source_id).cloned();
        // Prepared scene snapshots can arrive after a scheduled fade started.
        // Only ignore preparation writes for that exact running generation;
        // deliberate transport changes and newer preparations remain valid.
        if command["prepare_for_launch"] == true && existing.as_ref().is_some_and(|media|
            command["seek_generation"].as_u64() == Some(media.seek_generation)
                && command["uri"].as_str().is_none_or(|uri| uri == media.uri))
            && self.scheduled_transition_tokens.iter().any(|(layer_id, token)| {
                self.native_graph_layers.get(layer_id).is_some_and(|graph|
                    graph.params["vjclipClockToken"].as_u64() == Some(*token)
                    && graph.effect_job_template.as_ref().is_some_and(|template|
                        template.render_plans.iter().flat_map(|plan| plan.bindings.iter()).any(|binding| {
                            if binding.binding != 3 { return false; }
                            if let Some(input) = binding.resource_id.strip_prefix("layer-frame:") {
                                self.scene_layers.get(input).and_then(|layer| layer.source_id.as_deref()) == Some(source_id.as_str())
                            } else { binding.resource_id == source_id }
                        })))
            }) { return; }

        let uri = string_at(command, &["uri"])
            .or_else(|| existing.as_ref().map(|state| state.uri.clone()))
            .unwrap_or_default();
        let source_type = string_at(command, &["source_type"])
            .or_else(|| existing.as_ref().map(|state| state.source_type.clone()))
            .unwrap_or_else(|| "video".to_string());
        if uri.trim().is_empty() || source_type == "none" {
            return;
        }
        let render_clock_time = self.native_clock_seconds();
        let mut playback_time_seconds = number_at(command, &["time_seconds"])
            .or_else(|| number_at(command, &["time"]))
            .or_else(|| existing.as_ref().map(|state| state.current_time_seconds(Some(render_clock_time))))
            .unwrap_or(0.0)
            .clamp(0.0, 3600.0);
        let mut seek_generation = number_at(command, &["seek_generation"])
            .or_else(|| number_at(command, &["seekGeneration"]))
            .or_else(|| existing.as_ref().map(|state| state.seek_generation as f64))
            .unwrap_or(0.0)
            .round()
            .max(0.0) as u64;
        let playback_rate = number_at(command, &["playback_rate"])
            .or_else(|| number_at(command, &["rate"]))
            .or_else(|| existing.as_ref().map(|state| state.current_playback_rate(Some(render_clock_time))))
            .unwrap_or(1.0)
            .clamp(-16.0, 16.0);
        let duration_seconds = number_at(command, &["duration_seconds"])
            .or_else(|| number_at(command, &["duration"]))
            .filter(|duration| duration.is_finite() && *duration > 0.0)
            .or_else(|| existing.as_ref().and_then(|state| state.duration_seconds));
        let trim_start = number_at(command, &["trim_start"])
            .or_else(|| number_at(command, &["trimStart"]))
            .or_else(|| existing.as_ref().map(|state| state.trim_start))
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let trim_end = number_at(command, &["trim_end"])
            .or_else(|| number_at(command, &["trimEnd"]))
            .or_else(|| existing.as_ref().map(|state| state.trim_end))
            .unwrap_or(1.0)
            .clamp(trim_start, 1.0);
        let decode_width = number_at(command, &["decode_width"])
            .or_else(|| number_at(command, &["decodeWidth"]))
            .map(|value| {
                value
                    .round()
                    .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                    as usize
            })
            .or_else(|| existing.as_ref().and_then(|state| state.decode_width));
        let decode_height = number_at(command, &["decode_height"])
            .or_else(|| number_at(command, &["decodeHeight"]))
            .map(|value| {
                value
                    .round()
                    .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                    as usize
            })
            .or_else(|| existing.as_ref().and_then(|state| state.decode_height));
        let seq = number_at(command, &["seq"])
            .or_else(|| existing.as_ref().map(|state| state.seq as f64 + 1.0))
            .unwrap_or(1.0)
            .round()
            .max(0.0) as u64;
        let frame_step = number_at(command, &["frame_step"]);
        if frame_step.is_some_and(|step| step != -1.0 && step != 1.0)
            || (command.get("frame_step").is_some_and(|value| !value.is_null()) && frame_step.is_none())
        {
            self.stats.native_video_frame_decode_last_error = "Native video frame_step must be -1 or +1".into();
            return;
        }
        if frame_step.is_some() && (self.render_clock_mode != "live" || source_type != "video") {
            self.stats.native_video_frame_decode_last_error = "Native frame stepping requires a live video source".into();
            return;
        }
        let mut exact_step_reference = None;
        if let Some(direction) = frame_step {
            let session = self.native_video_streams.get(&source_id);
            let timing = session.map(|session| session.stream.source_timing());
            let reference = timing.and_then(|timing| timing.0).unwrap_or(playback_time_seconds);
            if session.is_some_and(|session| session.stream.frame_step_exact()) {
                exact_step_reference = Some(reference);
                playback_time_seconds = reference;
            } else if let Some(fps) = timing.and_then(|timing| timing.2) {
                // Compatibility decoding advertises estimated stepping. The
                // input FPS is separate from its capped/rate-adjusted output.
                let duration = timing.and_then(|timing| timing.3).or(duration_seconds);
                let start = duration.map_or(0.0, |duration| duration * trim_start);
                let end = duration.map_or(3600.0, |duration| (duration * trim_end - 1.0 / fps).max(start));
                playback_time_seconds = (reference + direction / fps).clamp(start, end);
            } else {
                self.stats.native_video_frame_decode_last_error = "Native video frame timing is unavailable; wait for the source to prepare before stepping".into();
                return;
            }
            seek_generation = seek_generation.max(existing.as_ref().map_or(1, |state| state.seek_generation.saturating_add(1)));
        }
        let next_state = NativeMediaSourceState {
            uri,
            source_type,
            playback_time_seconds,
            seek_generation,
            playback_rate,
            paused: frame_step.is_some() || bool_at(command, &["paused"])
                .unwrap_or_else(|| existing.as_ref().map(|state| state.paused).unwrap_or(false)),
            loop_enabled: bool_at(command, &["loop_enabled"])
                .or_else(|| bool_at(command, &["loop"]))
                .unwrap_or_else(|| {
                    existing
                        .as_ref()
                        .map(|state| state.loop_enabled)
                        .unwrap_or(false)
                }),
            bounce_enabled: bool_at(command, &["bounce_enabled"])
                .unwrap_or_else(|| existing.as_ref().is_some_and(|state| state.bounce_enabled)),
            duration_seconds,
            trim_start,
            trim_end,
            decode_width,
            decode_height,
            clock_time_seconds: if self.render_clock_mode == "manual" {
                number_at(command, &["clock_time_seconds"])
                    .or_else(|| number_at(command, &["clock_time"]))
                    .unwrap_or(render_clock_time)
            } else {
                render_clock_time
            }
            .clamp(0.0, 1.0e9),
            seq,
        };
        if existing.as_ref().is_some_and(|state| state.seek_generation != next_state.seek_generation)
            && let Some(slot) = self.source_frame_slots.get(&source_id).copied()
            && let Some(renderer) = self.renderer.as_ref()
        {
            // A completed frame from the previous seek is still a valid
            // held picture, but cannot satisfy readiness for the new seek.
            renderer.slot_readiness(slot).invalidate();
        }
        if self.render_clock_mode == "live" && next_state.source_type == "video" {
            let (width, height) = self.native_video_decode_dimensions();
            if let (Some(direction), Some(reference)) = (frame_step, exact_step_reference) {
                let signature = Self::native_video_session_signature(&next_state,
                    next_state.decode_width.unwrap_or(width), next_state.decode_height.unwrap_or(height));
                if let Some(session) = self.native_video_streams.get_mut(&source_id)
                    .filter(|session| session.signature == signature)
                    && session.stream.step_frame(reference, direction as i32, next_state.playback_rate)
                {
                    session.start_time_seconds = reference;
                    session.start_reverse = next_state.playback_rate < 0.0;
                    session.stream.retime_hardware_clock(next_state.playback_rate);
                    session.phase_until = None;
                    session.phase_error_seconds = None;
                    session.seek_generation = seek_generation;
                    session.playing = false;
                    session.frames_presented = 0;
                    session.next_frame_at = Instant::now();
                    session.triggered_at = None;
                    self.media_sources.insert(source_id.clone(), next_state);
                    self.stats.native_video_frame_decode_last_error.clear();
                    return;
                }
                self.stats.native_video_frame_decode_last_error = "Native video session changed before the frame step; prepare it again".into();
                return;
            }
        }
        self.media_sources.insert(source_id.clone(), next_state.clone());
        if self.render_clock_mode == "live" && next_state.source_type == "video" {
            let (width, height) = self.native_video_decode_dimensions();
            self.ensure_native_video_stream(
                &source_id,
                &next_state,
                width,
                height,
                !next_state.paused,
            );
            if !next_state.paused {
                self.drain_native_video_streams();
            }
        }
    }

    pub(crate) fn apply_decode_media_source(&mut self, command: &Value) {
        let source_type =
            string_at(command, &["source_type"]).unwrap_or_else(|| "none".to_string());
        let (Some(source_id), Some(uri)) = (
            string_at(command, &["source_id"]),
            string_at(command, &["uri"]),
        ) else {
            return;
        };
        if source_type == "image" {
            self.decode_native_image_source(&source_id, &uri);
        } else if source_type == "video" {
            let width = number_at(command, &["decode_width"])
                .or_else(|| number_at(command, &["decodeWidth"]))
                .or_else(|| number_at(command, &["width"]))
                .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
                .round()
                .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                as usize;
            let height = number_at(command, &["decode_height"])
                .or_else(|| number_at(command, &["decodeHeight"]))
                .or_else(|| number_at(command, &["height"]))
                .unwrap_or(width as f64)
                .round()
                .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                as usize;
            let explicit_time_seconds = number_at(command, &["time_seconds"])
                .or_else(|| number_at(command, &["timeSeconds"]))
                .or_else(|| number_at(command, &["time"]));
            let time_seconds = explicit_time_seconds
                .or_else(|| {
                    self.media_sources.get(&source_id).map(|state| {
                        state.current_time_seconds(Some(self.native_clock_seconds()))
                    })
                })
                .unwrap_or(0.0)
                .clamp(0.0, 3600.0);
            let seq = number_at(command, &["seq"])
                .unwrap_or((time_seconds * 1000.0).round())
                .round()
                .max(0.0) as u64;
            let prefetch_window_frames = number_at(command, &["prefetch_window_frames"])
                .or_else(|| number_at(command, &["prefetchWindowFrames"]))
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES as f64)
                as u32;
            let prefetch_fps = number_at(command, &["prefetch_fps"])
                .or_else(|| number_at(command, &["prefetchFps"]))
                .unwrap_or(NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS)
                .clamp(
                    NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS,
                    NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS,
                );
            if bool_at(command, &["scrub_preview", "scrubPreview"]).unwrap_or(false) {
                self.queue_native_video_scrub_frame(
                    &source_id,
                    &uri,
                    width,
                    height,
                    time_seconds,
                    seq,
                );
            } else {
                self.decode_native_video_frame_source(
                    &source_id,
                    &uri,
                    width,
                    height,
                    time_seconds,
                    seq,
                    prefetch_window_frames,
                    prefetch_fps,
                );
            }
        }
    }
}
