//! The frame loop: present requests, scheduled launches and prepared
//! transitions, media pumping and the per-frame render.

use crate::*;

impl App {
    pub(crate) fn request_auto_present(&mut self) {
        if !self.auto_present_on_state_change {
            return;
        }
        self.auto_present_requested = true;
        self.request_present();
    }

    /// The editor flushed a change. Every flush used to draw at once and
    /// restart the frame clock from that moment, so while frames were being
    /// drawn on schedule their timing followed the editor's flushes and their
    /// jitter. Now an idle core draws at once, as before; one already drawing
    /// on schedule draws the change with its next frame, or now if that frame
    /// is due, without moving the schedule.
    pub(crate) fn request_present(&mut self) {
        if self.display_paced() {
            self.present_pending = true;
            return;
        }
        let now = Instant::now();
        let period = self.frame_duration();
        match present_action(self.frames_scheduled(), self.last_redraw, now, period) {
            PresentAction::RenderNow { next_redraw } => {
                self.last_redraw = next_redraw;
                self.drive_frame(now);
            }
            PresentAction::WithNextFrame => self.present_pending = true,
        }
    }

    /// Draw the next frame. With the output window attached that used to be a
    /// redraw request only, answered by RedrawRequested. Windows sends none to
    /// a minimised window, and since this one frame also feeds the editor
    /// preview, the Screens and texture sharing, minimising the Live Output
    /// stopped all of them. A minimised window, or a redraw that has not
    /// arrived within two frames, is drawn directly instead.
    pub(crate) fn drive_frame(&mut self, now: Instant) {
        if !self.output_window_attached {
            self.render();
            return;
        }
        let Some(renderer) = self.renderer.as_ref() else {
            return;
        };
        let minimized = renderer.window.is_minimized().unwrap_or(false);
        if !minimized {
            renderer.window.request_redraw();
        }
        let requested_at = *self.redraw_requested_at.get_or_insert(now);
        if output_redraw_stalled(minimized, requested_at, now, self.frame_duration()) {
            self.render();
        }
    }

    pub(crate) fn sync_gpu_frame_stats(&mut self) {
        let budget = self.frame_duration();
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.poll_gpu_timing();
            renderer.update_frames_in_flight(budget);
            self.stats.gpu_frames_submitted = renderer.gpu_frames_submitted;
            self.stats.gpu_frames_completed = renderer.gpu_frames_completed();
            self.stats.frames_presented = self.stats.gpu_frames_completed;
            // Graph textures no graph used for a while are freed.
            renderer.native_graph_textures.end_frame();
        }
    }

    pub(crate) fn prepared_transition_ready(&self, command: &Value) -> bool {
        if !self.running || self.render_clock_mode != "live" { return false; }
        let Some(id) = command["layer_id"].as_str() else { return false; };
        let Some(graph) = self.native_graph_layers.get(id) else { return false; };
        let Some(token) = command["token"].as_u64().filter(|token| *token > 0) else { return false; };
        if graph.kind != NativeGraphLayerKind::VjCrossfade || graph.params["vjclipTransition"] != true
            || Some(token) != graph.params["vjclipClockToken"].as_u64()
            || graph.params["vjclipClockRunning"] == true
            || graph.params["vjclipClockDuration"].as_f64().is_none_or(|d| !d.is_finite() || d <= 0.0 || d > 10.0) { return false; }
        if !self.source_frame_readiness(&json!({"source_id":graph.source_id})).ok()
            .is_some_and(|ready| ready["ready"] == true) { return false; }
        let Some(template) = graph.effect_job_template.as_ref() else { return false; };
        if !template.buffers.iter().any(|buffer| buffer.initial_bytes.len() == 224) { return false; }
        let Some(sources) = command["sources"].as_array().filter(|s| s.len() == 2) else { return false; };
        sources.iter().enumerate().all(|(index, expected)| {
            let Some(source_id) = expected["source_id"].as_str() else { return false; };
            let binding = template.render_plans.iter().flat_map(|plan| plan.bindings.iter())
                .find(|binding| binding.binding == (index + 2) as u32);
            let Some(binding) = binding else { return false; };
            let actual = if let Some(layer) = binding.resource_id.strip_prefix("layer-frame:") {
                self.scene_layers.get(layer).and_then(|layer| layer.source_id.as_deref())
            } else { Some(binding.resource_id.as_str()) };
            if actual != Some(source_id) { return false; }
            if let Some(media) = self.media_sources.get(source_id) {
                if media.source_type == "video" && expected["seek_generation"].as_u64() != Some(media.seek_generation) { return false; }
            }
            self.source_frame_readiness(expected).ok().is_some_and(|ready| ready["ready"] == true)
        })
    }

    pub(crate) fn start_prepared_transition(&mut self, command: &Value) {
        let id = command["layer_id"].as_str().unwrap();
        let token = command["token"].as_u64().unwrap();
        let graph = self.native_graph_layers.get_mut(id).unwrap();
        let duration = graph.params["vjclipClockDuration"].as_f64().unwrap();
        graph.params["vjclipClockRunning"] = json!(true);
        graph.params["vjxfadeMix"] = json!(0);
        let mut clock = None;
        transition_clock::TransitionClock::sample(&mut clock, token, 0.0, duration, Instant::now());
        self.transition_clocks.insert(id.to_string(), clock);
        self.scheduled_transition_tokens.insert(id.to_string(), token);
    }

    pub(crate) fn pump_scheduled_launches(&mut self) {
        if !self.running || self.render_clock_mode != "live" { self.scheduled_transition_tokens.clear(); self.transition_clocks.clear(); self.launch_scheduler.clear(); self.scheduled_binding_guards.clear(); return; }
        let now = Instant::now();
        let beat = self.link_clock.filter(|(_, _, at)| at.elapsed() <= Duration::from_millis(500))
            .map(|(beat, tempo, at)| beat + at.elapsed().as_secs_f64() * tempo / 60.0);
        for launch in self.launch_scheduler.take_due(now, beat) {
            // Validate the whole transaction before mutating any participating row.
            let guards_valid = launch.expected_sources.as_object().is_none_or(|guards| guards.iter().all(|(layer, expected)| {
                self.scene_layers.get(layer).and_then(|l| l.source_id.as_deref()) == expected["source_id"].as_str()
                    && expected["seek_generation"].as_u64().is_none_or(|generation|
                        expected["source_id"].as_str().and_then(|id| self.media_sources.get(id)).is_some_and(|m| m.seek_generation == generation))
            }));
            let valid = guards_valid && launch.commands.as_array().unwrap().iter().all(|command| {
                let kind = command["type"].as_str().unwrap_or("");
                if kind != "set_media_source_playback" && !self.scene_layers.contains_key(command["layer_id"].as_str().unwrap_or("")) { return false; }
                if kind == "start_prepared_transition" {
                    if !self.prepared_transition_ready(command) { return false; }
                    let graph = &self.native_graph_layers[command["layer_id"].as_str().unwrap()];
                    // A cut on another row is safe. Rebinding this carrier or
                    // one of its prepared inputs would invalidate the readiness
                    // check, so reject the entire transaction before mutations.
                    return !launch.commands.as_array().unwrap().iter().any(|other| {
                        if other["type"] != "bind_media_source" { return false; }
                        let layer = other["layer_id"].as_str().unwrap_or("");
                        layer == graph.layer_id || graph.effect_job_template.as_ref().is_some_and(|template|
                            template.render_plans.iter().flat_map(|plan| plan.bindings.iter()).any(|binding|
                                binding.resource_id.strip_prefix("layer-frame:") == Some(layer)))
                    });
                }
                if matches!(kind, "bind_media_source" | "set_media_source_playback") {
                    let id = command["source_id"].as_str().unwrap_or("");
                    let Some(media) = self.media_sources.get(id) else { return false; };
                    if command["uri"].as_str().is_some_and(|uri| uri != media.uri) { return false; }
                    if command["source_type"].as_str().is_some_and(|kind| kind != media.source_type) { return false; }
                    // A ready texture may belong to a newer seek than the
                    // frame prepared for this launch. Never rewind that intent.
                    if command["seek_generation"].as_u64().is_some_and(|generation| generation != media.seek_generation) { return false; }
                    return self.source_frame_readiness(&json!({"source_id":id,"seek_generation":media.seek_generation})).ok()
                        .is_some_and(|value| value["ready"] == true);
                }
                true
            });
            if !valid { self.launch_scheduler.reject(&launch, "prepared layer/source is no longer ready"); continue; }
            let lateness_ms = now.saturating_duration_since(launch.due).as_secs_f64() * 1000.0;
            let summary = self.apply_commands(&launch.commands);
            if let Some(guards) = launch.expected_sources.as_object() {
                for (layer, expected) in guards {
                    if let Some(previous) = expected["source_id"].as_str() {
                        if self.scene_layers.get(layer).and_then(|l| l.source_id.as_deref()) != Some(previous) {
                            self.scheduled_binding_guards.insert(layer.clone(), (previous.to_string(), launch.lane.clone(), expected["seek_generation"].as_u64()));
                        }
                    }
                }
            }
            self.pending_render_retry = true;
            self.launch_scheduler.complete(&launch, json!({"summary":summary,"estimated_deadline_lateness_ms":lateness_ms}));
        }
    }

    pub(crate) fn render(&mut self) {
        let started = Instant::now();
        if !self.running {
            return;
        }
        self.pump_scheduled_launches();
        self.expire_layer_holds();
        self.sync_gpu_frame_stats();
        if self
            .renderer
            .as_ref()
            .is_some_and(RenderState::frame_in_flight)
        {
            self.stats.gpu_backpressure_skips = self.stats.gpu_backpressure_skips.saturating_add(1);
            // Do NOT drop the request. Skipping a mid-stream frame is
            // harmless because another one follows 16ms later, but the
            // final frame of a scene teardown has no successor: the editor
            // has already torn down its RAF and an empty scene puts
            // `about_to_wait` to sleep. Losing that one frame is what left
            // a removed layer's picture stuck in the output export texture,
            // the slice windows and the swapchain.
            self.pending_render_retry = true;
            return;
        }
        self.present_pending = false;
        let graph_budget = self.native_graph_buffer_budget_bytes();
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.allow_async_compile = self.render_clock_mode != "manual";
            renderer.frame_epoch = renderer.frame_epoch.wrapping_add(1);
            gpu_object_cache::begin_frame();
            pass_timing::begin_frame(renderer.gpu_idle_for_frame());
            renderer.pipeline_cap = self.pipeline_metadata_cache_cap.max(1) as usize;
            renderer.graph_budget_bytes = graph_budget;
        }
        let mut native_graph_jobs = Vec::new();
        let mut generated_graph_jobs = 0;
        if !self.output_frozen && self.output_gate() > 0.0 {
            self.claim_native_graph_step();
            self.render_bound_isf_layers();
            native_graph_jobs = self.run_native_graph_layers();
            generated_graph_jobs = native_graph_jobs.len();
            native_graph_jobs.append(&mut self.pending_native_graph_jobs);
        }
        // Sharing the immutable chain avoids cloning its buffers each frame.
        let composite_graph_jobs =
            self.pending_composite_graph_jobs.clone();
        let composite_output_index = self.pending_composite_output_index;
        let render_time = if self.render_clock_mode == "manual" {
            self.render_clock_time.map(shader_clock_seconds)
        } else {
            None
        };
        let frame_index = self.native_frame_index();
        self.sync_paint_masks_to_gpu();
        let gpu_layers = self.gpu_layer_data();
        let deck_monitor_a = self.deck_monitor_layer_data(0);
        let deck_monitor_b = self.deck_monitor_layer_data(1);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let record_target = self.record_target.as_ref().map(|spec| {
            let post = if spec.source == RecordTargetSource::Composition {
                self.composite_effect_slots()
            } else {
                Vec::new()
            };
            (self.record_target_layer_data(spec), post, spec.alpha)
        });
        let source_preview_pixels = if self.source_preview_dirty {
            Some(self.source_preview_pixel_data())
        } else {
            None
        };
        let stage3d_mesh_frame = self.stage3d_mesh_frame();
        let scene_overlay_items = self.scene_overlay_items();
        let native_graph_buffer_budget_bytes = self.native_graph_buffer_budget_bytes();
        let native_graph_job_count = (native_graph_jobs.len() + composite_graph_jobs.len()) as u64;
        let native_graph_compute_pass_count = native_graph_jobs
            .iter().chain(composite_graph_jobs.iter())
            .map(|job| job.pass_plans.len() as u64)
            .fold(0u64, u64::saturating_add);
        let native_graph_render_pass_count = native_graph_jobs
            .iter().chain(composite_graph_jobs.iter())
            .map(|job| job.render_plans.len() as u64)
            .fold(0u64, u64::saturating_add);
        let native_graph_source_frame_render_count = native_graph_jobs
            .iter()
            .flat_map(|job| job.render_plans.iter())
            .filter(|render| {
                matches!(
                    render.target,
                    NativeComputeGraphRenderTarget::SourceFrame { .. }
                )
            })
            .count() as u64;
        let native_task_count = gpu_layers
            .len()
            .saturating_add(native_graph_job_count.min(usize::MAX as u64) as usize)
            .saturating_add(native_graph_compute_pass_count.min(usize::MAX as u64) as usize)
            .saturating_add(native_graph_render_pass_count.min(usize::MAX as u64) as usize);
        // Read before borrowing the renderer mutably.
        let output_gate = self.output_gate();
        let post_effects = self.composite_effect_slots();
        let output_stage = self.output_stage;
        let slice_specs = Arc::clone(&self.slice_outputs);
        let deck_monitors_have_content = !deck_monitor_a.is_empty() || !deck_monitor_b.is_empty();
        let deck_monitors_were_lit = self.deck_monitors_lit;
        let mut deck_monitors_rendered = false;
        if self.renderer.is_none() {
            // Renderer not created yet; keep the retry armed so the frame
            // lands as soon as `ensure_renderer` succeeds.
            return;
        }
        // Past every early-out: this frame is being drawn, so whatever was
        // waiting on a retry is served by it.
        self.pending_render_retry = false;
        let Some(renderer) = self.renderer.as_mut() else {
            return;
        };
        if let Some(anchor) = self.beat_clock_request.take() {
            renderer.beat_clock.rebase(anchor);
        }
        let present_surface = self.output_window_attached;
        if present_surface {
            renderer.pacing.frame_started(started);
            self.stats.swapchain_present_attempts =
                self.stats.swapchain_present_attempts.saturating_add(1);
        }
        let mut render_result = renderer.render(
            self.command_phase,
            gpu_layers.len() as u32,
            render_time,
            frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            stage3d_mesh_frame.as_ref(),
            &scene_overlay_items,
            &native_graph_jobs,
            &composite_graph_jobs,
            composite_output_index,
            self.audio0,
            self.audio1,
            self.audio2,
            present_surface,
            self.output_frozen,
            output_gate,
            &post_effects,
            output_stage,
        );
        let pipeline_warming = render_result.as_ref().err().is_some_and(|error| error.starts_with("native pipeline is warming"));
        if pipeline_warming {
            // Keep unrelated live sources, transforms and output controls moving
            // while a new graph warms. A graph that has rendered before keeps its
            // cached source frame; a new one composites as transparent, because
            // its slot was cleared when it was assigned. Composition uses the
            // most recent chain that actually rendered.
            self.pending_native_graph_jobs.extend(native_graph_jobs.split_off(generated_graph_jobs));
            // No immediate retry: a retry runs "as soon as the GPU is free",
            // which for a warming pipeline is a hot loop of a thousand-plus
            // frames a second. On D3D12 that starved the worker compiling the
            // pipeline, so it never finished and the effect never appeared.
            // The pending jobs keep the loop alive (has_offscreen_work), and
            // the next frame slot picks the pipeline up once it is built.
            render_result = renderer.render(
                self.command_phase, gpu_layers.len() as u32, render_time, frame_index,
                &gpu_layers, source_preview_pixels.as_deref(), stage3d_mesh_frame.as_ref(),
                &scene_overlay_items, &[], &self.ready_composite_graph_jobs,
                self.ready_composite_output_index, self.audio0, self.audio1, self.audio2,
                present_surface, self.output_frozen, output_gate, &post_effects, output_stage,
            );
        } else if render_result.is_ok() {
            // The master is rendered even if the swapchain has no drawable.
            self.ready_composite_graph_jobs = composite_graph_jobs.clone();
            self.ready_composite_output_index = composite_output_index;
        }
        // Deck confidence monitors ride the same frame: two small composite
        // passes over the bank-tagged layers, after the program render so
        // every source frame they sample is already current.
        //
        // Both banks going empty is exactly when the monitors MUST still be
        // drawn once: skipping the pass leaves the deleted clip's last frame
        // resident in the monitors' own textures. `deck_monitors_lit` buys
        // that one clearing pass and then lets the monitors idle again.
        if render_result.is_ok() && (deck_monitors_have_content || deck_monitors_were_lit) {
            let (monitor_width, monitor_height) = deck_monitor_size(
                self.deck_monitor_width,
                (renderer.config.width, renderer.config.height),
            );
            renderer.render_deck_monitors(
                self.command_phase,
                render_time,
                frame_index,
                &deck_monitor_a,
                &deck_monitor_b,
                self.audio0,
                self.audio1,
                self.audio2,
                monitor_width,
                monitor_height,
            );
            deck_monitors_rendered = true;
        }
        // Slice displays ride the same frame for the same reason: every
        // source frame they sample is already current after the program
        // render, so a slice costs one composite pass and no extra decode.
        renderer.retain_slice_shares(&slice_specs);
        renderer.retain_slice_ndi(&slice_specs);
        if render_result.is_ok() && !slice_specs.is_empty() {
            renderer.render_slice_outputs(
                self.command_phase,
                render_time,
                frame_index,
                &gpu_layers,
                self.audio0,
                self.audio1,
                self.audio2,
                output_gate,
                &post_effects,
                &slice_specs,
                composite_graph_jobs.is_empty() && stage3d_mesh_frame.is_none() && scene_overlay_items.is_empty() && !self.output_frozen && output_gate > 0.0,
                &ProjectorViewInputs {
                    scene: self.projection_sim_view.as_ref(),
                    meshes: &self.projection_sim_meshes,
                    overlays: &self.projection_sim_overlays,
                },
            );
        }
        // The editor's Inside view of the dome rides the frame too: one more
        // output-stage pass over the master the program render just made.
        if render_result.is_ok() {
            let view = self.dome_view.filter(|_| self.output_stage.dome0[0] > 0.5);
            renderer.render_dome_view(
                view.map(|[dview, dview1]| OutputStage {
                    out0: [0.0, 0.0, 1.0, 1.0],
                    out1: [0.0, 1.0, 1.0, 1.0],
                    dview,
                    dview1,
                    ..self.output_stage
                }),
                output_gate,
                render_time,
            );
        }
        // The recording target rides the same frame, after the program render,
        // for the same reason: it samples the source frames just made current.
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if render_result.is_ok() {
            if let Some((layers, post, alpha)) = record_target.as_ref() {
                renderer.render_record_target(
                    self.command_phase,
                    render_time,
                    frame_index,
                    layers,
                    self.audio0,
                    self.audio1,
                    self.audio2,
                    post,
                    *alpha,
                );
            }
        }
        if render_result.is_ok() && !pipeline_warming {
            for plan in native_graph_jobs.iter().flat_map(|job| job.render_plans.iter()) {
                let NativeComputeGraphRenderTarget::SourceFrame { source_id, slot, .. } = &plan.target else { continue; };
                if !source_id.starts_with("effect-pass:") { continue; }
                for layer in self.scene_layers.values_mut() {
                    if layer.source_id.as_deref() == Some(source_id.as_str()) {
                        layer.frame_slot = Some(*slot);
                        layer.source_rect = [0.0, 0.0, 1.0, 1.0];
                        layer.source_kind = source_kind("image");
                    }
                }
            }
        }
        if render_result.is_ok() {
            renderer.finish_frame(started);
            let now = Instant::now();
            if let Some(previous) = self.last_submission_at.replace(now) {
                self.submitted_intervals_ms.push(now.duration_since(previous).as_secs_f64() * 1000.0);
            }
        }
        if render_result.is_ok() && !pipeline_warming && native_graph_job_count > 0 {
            self.stats.compute_graph_runs = self
                .stats
                .compute_graph_runs
                .saturating_add(native_graph_job_count);
            self.stats.compute_graph_passes = self
                .stats
                .compute_graph_passes
                .saturating_add(native_graph_compute_pass_count);
            self.stats.compute_graph_render_passes = self
                .stats
                .compute_graph_render_passes
                .saturating_add(native_graph_render_pass_count);
            self.stats.compute_graph_source_frame_renders = self
                .stats
                .compute_graph_source_frame_renders
                .saturating_add(native_graph_source_frame_render_count);
            let (evicted_buffers, evicted_bytes) = renderer
                .prune_native_compute_graph_buffers_to_budget(native_graph_buffer_budget_bytes);
            if evicted_buffers > 0 || evicted_bytes > 0 {
                self.stats.vram_evictions = self
                    .stats
                    .vram_evictions
                    .saturating_add(evicted_buffers as u64);
                self.stats.vram_evicted_bytes =
                    self.stats.vram_evicted_bytes.saturating_add(evicted_bytes);
            }
            self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
        }
        match render_result {
            Ok(outcome) if outcome.presented() => {
                self.output_last_presented_layer_count = gpu_layers.len().min(1024) as u32;
                self.stats.output_last_presented_layer_count =
                    self.output_last_presented_layer_count;
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.gpu_frames_submitted = renderer.gpu_frames_submitted;
                self.stats.swapchain_presented = self.stats.swapchain_presented.saturating_add(1);
                self.stats.swapchain_present_consecutive_failures = 0;
                if self.auto_present_requested {
                    self.stats.frames_presented_auto =
                        self.stats.frames_presented_auto.saturating_add(1);
                    self.auto_present_requested = false;
                } else {
                    self.stats.frames_presented_explicit =
                        self.stats.frames_presented_explicit.saturating_add(1);
                }
                self.stats.draw_calls = self.stats.draw_calls.saturating_add(1);
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                self.stats.last_render_cpu_ms = ms;
                self.render_cpu_ema_ms = if self.render_cpu_ema_ms <= 0.0 {
                    ms
                } else {
                    self.render_cpu_ema_ms * 0.94 + ms * 0.06
                };
                let gpu_ms = renderer.last_render_gpu_ms();
                let (
                    gpu_timing_supported,
                    last_render_gpu_ms,
                    avg_render_gpu_ms,
                    max_render_gpu_ms,
                    gpu_timing_samples,
                    gpu_timing_resolve_misses,
                ) = renderer.gpu_timing_stats();
                self.stats.gpu_timing_supported = gpu_timing_supported;
                self.stats.last_render_gpu_ms = last_render_gpu_ms;
                self.stats.avg_render_gpu_ms = avg_render_gpu_ms;
                self.stats.max_render_gpu_ms = max_render_gpu_ms;
                self.stats.gpu_timing_samples = gpu_timing_samples;
                self.stats.gpu_timing_resolve_misses = gpu_timing_resolve_misses;
                // An offline render takes as long as it takes: its slow frames
                // must not lower the quality tier part way through the file.
                if self.render_clock_mode != "manual" {
                    self.native_quality
                        .observe_frame(ms + self.media_pump_ms, gpu_ms, self.target_fps, if self.output_frozen || output_gate <= 0.0 { 0 } else { native_task_count });
                }
                if source_preview_pixels.is_some() {
                    self.source_preview_dirty = false;
                }
            }
            Ok(outcome) if outcome.offscreen() => {
                self.output_last_presented_layer_count = gpu_layers.len().min(1024) as u32;
                self.stats.output_last_presented_layer_count =
                    self.output_last_presented_layer_count;
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.swapchain_present_consecutive_failures = 0;
                self.stats.gpu_frames_submitted = renderer.gpu_frames_submitted;
                if self.auto_present_requested {
                    self.stats.frames_presented_auto =
                        self.stats.frames_presented_auto.saturating_add(1);
                    self.auto_present_requested = false;
                } else {
                    self.stats.frames_presented_explicit =
                        self.stats.frames_presented_explicit.saturating_add(1);
                }
                self.stats.draw_calls = self.stats.draw_calls.saturating_add(1);
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                self.stats.last_render_cpu_ms = ms;
                self.render_cpu_ema_ms = if self.render_cpu_ema_ms <= 0.0 {
                    ms
                } else {
                    self.render_cpu_ema_ms * 0.94 + ms * 0.06
                };
                let gpu_ms = renderer.last_render_gpu_ms();
                let (
                    gpu_timing_supported,
                    last_render_gpu_ms,
                    avg_render_gpu_ms,
                    max_render_gpu_ms,
                    gpu_timing_samples,
                    gpu_timing_resolve_misses,
                ) = renderer.gpu_timing_stats();
                self.stats.gpu_timing_supported = gpu_timing_supported;
                self.stats.last_render_gpu_ms = last_render_gpu_ms;
                self.stats.avg_render_gpu_ms = avg_render_gpu_ms;
                self.stats.max_render_gpu_ms = max_render_gpu_ms;
                self.stats.gpu_timing_samples = gpu_timing_samples;
                self.stats.gpu_timing_resolve_misses = gpu_timing_resolve_misses;
                self.native_quality
                    .observe_frame(ms, gpu_ms, self.target_fps, native_task_count);
                if source_preview_pixels.is_some() {
                    self.source_preview_dirty = false;
                }
            }
            Ok(outcome) => {
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.swapchain_present_failures =
                    self.stats.swapchain_present_failures.saturating_add(1);
                match outcome {
                    SurfacePresentOutcome::Outdated => {
                        self.stats.swapchain_present_outdated =
                            self.stats.swapchain_present_outdated.saturating_add(1);
                    }
                    SurfacePresentOutcome::Timeout => {
                        self.stats.swapchain_present_timeouts =
                            self.stats.swapchain_present_timeouts.saturating_add(1);
                    }
                    SurfacePresentOutcome::Occluded => {
                        self.stats.swapchain_present_occluded =
                            self.stats.swapchain_present_occluded.saturating_add(1);
                    }
                    SurfacePresentOutcome::Presented
                    | SurfacePresentOutcome::Offscreen
                    | SurfacePresentOutcome::SuboptimalPresented => {}
                }
                self.stats.swapchain_present_consecutive_failures = self
                    .stats
                    .swapchain_present_consecutive_failures
                    .saturating_add(1);
                self.stats.swapchain_present_max_consecutive_failures = self
                    .stats
                    .swapchain_present_max_consecutive_failures
                    .max(self.stats.swapchain_present_consecutive_failures);
                self.stats.frames_without_swapchain_present = self
                    .stats
                    .frames_without_swapchain_present
                    .saturating_add(1);
            }
            Err(err) if err.starts_with("native pipeline is warming") => {
                if !pipeline_warming {
                    self.pending_native_graph_jobs.extend(native_graph_jobs.split_off(generated_graph_jobs));
                }
                // Wait for the next frame slot rather than spinning; see the
                // warming branch above.
            }
            Err(err) => {
                self.stats.swapchain_last_present_result = if err.contains("surface lost") {
                    self.stats.swapchain_present_lost =
                        self.stats.swapchain_present_lost.saturating_add(1);
                    "lost".to_string()
                } else if err.contains("validation") {
                    self.stats.swapchain_present_validation_errors = self
                        .stats
                        .swapchain_present_validation_errors
                        .saturating_add(1);
                    "validation-error".to_string()
                } else {
                    "error".to_string()
                };
                self.stats.swapchain_last_present_error = err.clone();
                self.stats.swapchain_present_failures =
                    self.stats.swapchain_present_failures.saturating_add(1);
                self.stats.swapchain_present_consecutive_failures = self
                    .stats
                    .swapchain_present_consecutive_failures
                    .saturating_add(1);
                self.stats.swapchain_present_max_consecutive_failures = self
                    .stats
                    .swapchain_present_max_consecutive_failures
                    .max(self.stats.swapchain_present_consecutive_failures);
                self.stats.frames_without_swapchain_present = self
                    .stats
                    .frames_without_swapchain_present
                    .saturating_add(1);
                renderer.last_frame_error = Some(err);
            }
        }
        if deck_monitors_rendered {
            self.deck_monitors_lit = deck_monitors_have_content;
        }
        // Refresh what the reader thread serves. The output-export frame counter
        // in particular only changes here, and it is what the editor's preview
        // display-link watches to decide the core is still alive.
        if self.fast_path.wants_publish() {
            self.refresh_rpc_snapshot();
        }
    }

    /// Scheduled launches and video sessions advance with the frame clock.
    pub(crate) fn pump_frame_media(&mut self) {
        self.last_frame_service = Instant::now();
        self.pump_scheduled_launches();
        let pump_started = Instant::now();
        self.pump_native_video_decodes();
        self.pump_live_captures();
        self.media_pump_ms = pump_started.elapsed().as_secs_f64() * 1000.0;
    }

    /// One turn of the frame clock: media, then the frame when it is due.
    /// Returns when the next frame is due, or None when nothing is scheduled.
    pub(crate) fn service_frame(&mut self) -> Option<Instant> {
        let frame_duration = self.frame_duration();
        self.pump_frame_media();
        if !self.frames_scheduled() {
            return None;
        }
        if self.display_paced() {
            // The refreshes draw the frames; wake for a frame starting a
            // little after its refresh, or to fall back to the timer if the
            // refreshes stop.
            let now = Instant::now();
            if self.paced_frame_ready(now) {
                self.draw_paced_frame(now);
            }
            let stall = self.display_clock.as_ref().map(|clock| clock.stall_deadline(now));
            return match (self.paced_frame_at, stall) {
                (Some(at), Some(stall)) => Some(at.min(stall)),
                (at, stall) => at.or(stall),
            };
        }
        let next_frame_at = self.last_redraw + frame_duration;
        let now = Instant::now();
        if now >= next_frame_at {
            self.drive_frame(now);
            self.last_redraw = scheduled_frame_start(next_frame_at, now, frame_duration);
            Some(self.last_redraw + frame_duration)
        } else {
            Some(next_frame_at)
        }
    }
}
