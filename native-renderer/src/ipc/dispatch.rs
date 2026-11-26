//! RPC dispatch: replies, published snapshots, and the command batches the
//! app sends.

use crate::*;

impl App {
    pub(crate) fn send_ok(&self, id: u64, result: Value) {
        if id == 0 {
            return;
        }
        let _ = self
            .response_tx
            .send(json!({ "id": id, "ok": true, "result": result }).to_string());
    }

    pub(crate) fn send_error(&self, id: u64, err: impl ToString) {
        if id == 0 {
            return;
        }
        let _ = self
            .response_tx
            .send(json!({ "id": id, "ok": false, "error": err.to_string() }).to_string());
    }

    /// Rebuild the payloads the stdin reader thread serves. Called after every
    /// main-thread RPC (before `applied` advances, so a reader that sees the
    /// core as idle can never read state older than the last applied command)
    /// and once per rendered frame to keep the counters live.
    pub(crate) fn publish_rpc_snapshot(&mut self) {
        // Background workers (video decode pre-roll, GPU completion) mutate the
        // state `status` reports without routing through `handle_rpc`, so the
        // snapshot has to be rebuilt from scratch here rather than patched.
        let stats = Arc::new(self.stats_payload());
        let status = Arc::new(json!(self.status()));
        self.rpc_snapshot_cache = Some((status.clone(), stats.clone(), Instant::now(), self.rpc_snapshot_watch_key()));
        self.fast_path.publish(PublishedRpcSnapshot {
            status,
            stats,
            output_shared_texture: self.output_shared_texture(),
        });
    }

    /// The per-frame and on-poll publish. The output texture is refreshed
    /// every time: its frame counter is what the preview and texture-share
    /// pumps follow. Status and stats are rebuilt at most ~15 Hz, or at once
    /// when something a poller waits on changed.
    pub(crate) fn refresh_rpc_snapshot(&mut self) {
        let key = self.rpc_snapshot_watch_key();
        let cached = self.rpc_snapshot_cache.as_ref()
            .filter(|(_, _, built_at, cached_key)| *cached_key == key && built_at.elapsed() < RPC_SNAPSHOT_REFRESH)
            .map(|(status, stats, _, _)| (status.clone(), stats.clone()));
        let Some((status, stats)) = cached else {
            self.publish_rpc_snapshot();
            return;
        };
        self.fast_path.publish(PublishedRpcSnapshot {
            status,
            stats,
            output_shared_texture: self.output_shared_texture(),
        });
    }

    /// Changes between RPCs that editor pollers wait on: a seek or frame step
    /// landing (first frame of a new seek generation), a session starting,
    /// stopping or failing, the backend coming up or going down.
    pub(crate) fn rpc_snapshot_watch_key(&self) -> u64 {
        let renderer_ok = self.renderer.as_ref().is_some_and(|renderer| renderer.last_frame_error.is_none());
        let mut key = u64::from(self.running) | u64::from(renderer_ok) << 1 | u64::from(self.stats.swapchain_presented > 0) << 2;
        for (source_id, session) in &self.native_video_streams {
            // Summed, so the map's iteration order does not matter.
            key = key.wrapping_add(stable_hash64(source_id)
                ^ session.seek_generation.wrapping_mul(0x9e37_79b9_7f4a_7c15)
                ^ u64::from(session.frames_presented > 0) << 3
                ^ u64::from(session.playing) << 4
                ^ u64::from(session.stream.backend() == "failed") << 5);
        }
        key
    }

    pub(crate) fn handle_rpc(&mut self, event_loop: &ActiveEventLoop, req: RpcRequest) {
        // Own ingress accounting until the transaction has completely applied.
        struct IngressPermit(Arc<RpcFastPath>, u64);
        impl Drop for IngressPermit {
            fn drop(&mut self) {
                self.0.queued_bytes.fetch_sub(self.1, Ordering::Release);
                self.0.applied.fetch_add(1, Ordering::Release);
            }
        }
        let _ingress = IngressPermit(self.fast_path.clone(), req.ingress_bytes);
        if matches!(req.method.as_str(), "submit_commands" | "submit_batch") {
            let batch = req.params.get("batch").unwrap_or(&req.params);
            let count = batch.get("commands").unwrap_or(batch).as_array().map_or(0, Vec::len);
            if count > self.command_drain_limit as usize {
                self.stats.command_drain_limit_hits = self.stats.command_drain_limit_hits.saturating_add(1);
                if req.id != 0 { self.send_error(req.id, format!("transaction has {count} commands; maximum is {}. No commands applied", self.command_drain_limit)); }
                return;
            }
        }
        let config = req.params.get("config").unwrap_or(&req.params);
        let batch = req.params.get("batch").unwrap_or(&req.params);
        let output_commands: Vec<&Value> = if matches!(req.method.as_str(), "start" | "set_output" | "set_output_window") {
            vec![config]
        } else if matches!(req.method.as_str(), "submit_commands" | "submit_batch") {
            batch.get("commands").unwrap_or(batch).as_array().into_iter().flatten()
                .filter(|c| c.get("type").and_then(Value::as_str) == Some("set_output")).collect()
        } else { Vec::new() };
        for command in output_commands {
            let width = number_at(command, &["width"]).unwrap_or(self.pending_width as f64).max(1.0) as u32;
            let height = number_at(command, &["height"]).unwrap_or(self.pending_height as f64).max(1.0) as u32;
            if !output_dimensions_admitted(width, height) {
                if req.id != 0 { self.send_error(req.id, "output dimensions exceed the 512 MiB output texture budget; no commands applied".to_string()); }
                return;
            }
        }
        if matches!(req.method.as_str(), "stream_output_frame" | "output_shared_texture_snapshot" | "get_output_shared_texture_snapshot")
            || (req.method == "export_frame_snapshot" && string_at(&req.params, &["source"]).is_some_and(|v| live_capture_export_source(&v))) {
            let result = self.start_live_capture(&req);
            if let Err(error) = result { if req.id != 0 { self.send_error(req.id, error); } }
            return;
        }
        if matches!(req.method.as_str(), "frame_snapshot" | "get_frame_snapshot")
            && (req.params.get("source_id").is_some() || req.params.get("layer_id").is_some()) {
            if let Err(error) = self.start_source_preview(&req) { if req.id != 0 { self.send_error(req.id, error); } }
            return;
        }
        if matches!(req.method.as_str(), "frame_snapshot" | "get_frame_snapshot")
            && req.params.get("deck_monitor").is_some() {
            if let Err(error) = self.start_deck_monitor_preview(&req) { if req.id != 0 { self.send_error(req.id, error); } }
            return;
        }
        if matches!(req.method.as_str(), "frame_snapshot" | "get_frame_snapshot")
            && bool_at(&req.params, &["live_output"]).unwrap_or(false) {
            if let Err(error) = self.start_composite_preview(&req) { if req.id != 0 { self.send_error(req.id, error); } }
            return;
        }
        if req.method == "probe_video" {
            self.start_video_probe(&req);
            return;
        }
        if req.method == "prefetch_media" && string_at(&req.params, &["source_type"]).as_deref() == Some("image") {
            if self.image_prefetch_waiters.values().map(Vec::len).sum::<usize>() >= 256 {
                if req.id != 0 { self.send_error(req.id, "image prefetch request queue is full".to_string()); }
                return;
            }
            match self.prefetch_media(&req.params) {
                Ok(status) => {
                    let source = string_at(&req.params, &["source_id"]).or_else(|| string_at(&req.params, &["sourceId"])).unwrap_or_default();
                    let pending = self.source_frame_signatures.get(&source).and_then(|s| s.strip_prefix("pending:")).map(str::to_string);
                    if let Some(signature) = pending {
                        if req.id != 0 { self.image_prefetch_waiters.entry((source, signature)).or_default().push((req.id, Instant::now() + Duration::from_secs(5))); }
                    } else if req.id != 0 { self.send_ok(req.id, status); }
                }
                Err(error) => { if req.id != 0 { self.send_error(req.id, error); } }
            }
            return;
        }
        if req.method == "prefetch_media" && string_at(&req.params, &["source_type"]).as_deref() == Some("video")
            && (self.render_clock_mode == "manual" || (string_at(&req.params, &["prefetch_mode"]).as_deref() == Some("frame") && number_at(&req.params, &["time_seconds"]).or_else(|| number_at(&req.params, &["timeSeconds"])).or_else(|| number_at(&req.params, &["time"])).is_some())) {
            if let Err(error) = self.start_timed_video_prefetch(&req) { if req.id != 0 { self.send_error(req.id, error); } }
            return;
        }
        let result = match req.method.as_str() {
            "start" => {
                self.apply_start_config(&req.params);
                self.running = true;
                let now = Instant::now();
                self.last_redraw = now.checked_sub(self.frame_duration()).unwrap_or(now);
                self.ensure_renderer(event_loop).map(|_| {
                    if self.output_window_attached
                        && let Some(renderer) = self.renderer.as_ref()
                    {
                        renderer.window.request_redraw();
                    }
                    json!(self.status())
                })
            }
            "stop" => {
                self.launch_scheduler.clear(); self.scheduled_binding_guards.clear();
                self.running = false;
                self.refresh_clip_audio();
                Ok(json!(true))
            }
            "status" | "get_status" => Ok(json!(self.status())),
            // Ground truth for the Electron-side scene reconciler: what
            // geometry the core is ACTUALLY compositing with, so a lost or
            // misapplied upsert_layer can be detected and repaired instead of
            // wedging the picture until the next unrelated edit.
            "layers_snapshot" | "get_layers_snapshot" => Ok(self.layers_snapshot_payload()),
            "stats" | "get_stats" => Ok(self.stats_payload()),
            "memory_stats" => Ok(self.memory_stats()),
            "snapshot" | "get_snapshot" => Ok(json!({
                "timestamp_ms": epoch_ms(),
                "status": self.status(),
                "stats": self.stats,
                "shader_registry": self.shader_registry_snapshot(),
            })),
            "frame_snapshot" | "get_frame_snapshot" => self.frame_snapshot(&req.params),
            "capture_layer_source_frame" => self.capture_layer_source_frame(&req.params),
            "get_layer_source_readiness" => self.layer_source_readiness(&req.params),
            "get_source_frame_readiness" => self.source_frame_readiness(&req.params),
            "release_source_frame" => self.release_source_frame(&req.params),
            "export_frame_snapshot" => self.export_frame_snapshot(&req.params),
            "prefetch_media" => self.prefetch_media(&req.params),
            "clear_prefetch_cache" => Ok(self.clear_prefetch_cache()),
            "release_library_prerolls" => Ok(self.release_library_prerolls()),
            "clear_decode_preview_cache" => Ok(self.clear_decode_preview_cache()),
            "decode_capabilities" | "get_decode_capabilities" => Ok(self.decode_capabilities()),
            "upload_source_gpu_shared_texture" => {
                self.upload_source_gpu_shared_texture(&req.params)
            }
            "output_shared_texture" | "get_output_shared_texture" => {
                Ok(self.output_shared_texture())
            }
            "output_shared_texture_snapshot" | "get_output_shared_texture_snapshot" => {
                self.output_shared_texture_snapshot(&req.params)
            }
            "set_deck_monitor_width" => {
                let width = req.params.get("width").and_then(Value::as_u64).unwrap_or(480);
                self.deck_monitor_width = deck_monitor_width(width);
                Ok(json!({ "width": self.deck_monitor_width }))
            }
            "dome_view_texture" | "get_dome_view_texture" => Ok(self.tag_presenter_info(
                self.renderer
                    .as_ref()
                    .map(RenderState::dome_view_metadata)
                    .unwrap_or_else(|| json!({ "available": false })),
            )),
            "deck_monitor_state" | "get_deck_monitor_state" => Ok(self.tag_presenter_info(
                self.renderer
                    .as_ref()
                    .map(RenderState::deck_monitor_metadata)
                    .unwrap_or_else(|| json!({ "available": false })),
            )),
            "set_stage3d_scene" => self.set_stage3d_scene(&req.params),
            "get_stage3d_scene_summary" => Ok(json!(self.stage3d_scene_summary.clone())),
            "set_projection_sim_scene" => self.set_projection_sim_scene(&req.params),
            "set_projection_sim_meshes" => self.set_projection_sim_meshes(&req.params),
            "set_projection_sim_view" => self.set_projection_sim_view(&req.params),
            "set_projection_sim_overlay" => self.set_projection_sim_overlay(&req.params),
            "projection_sim_view_snapshot" => self.projection_sim_view_snapshot(&req.params),
            "get_projection_sim_scene_summary" => {
                Ok(json!(self.projection_sim_scene_summary.clone()))
            }
            "capabilities" | "get_capabilities" => Ok(self.capabilities()),
            "compute_probe" | "run_compute_probe" => self.compute_probe(&req.params),
            "take_graph_readbacks" => match self.renderer.as_mut() {
                Some(renderer) => graph_readbacks::take_readbacks(
                    &mut renderer.graph_readback_results,
                    &mut renderer.graph_live_readbacks,
                    &req.params,
                ),
                None => Ok(serde_json::json!({ "readbacks": {} })),
            },
            "compute_graph" | "run_compute_graph" => {
                let result = self.compute_graph(&req.params);
                if result.is_ok() {
                    self.request_auto_present();
                }
                result
            }
            "readiness" | "get_readiness_report" => {
                let capabilities = self.capabilities();
                let renderer_ready = self.renderer.is_some();
                let (compute_instrument_host_ok, compute_instrument_host_detail) =
                    native_compute_host_readiness(&capabilities, renderer_ready);
                let (
                    source_frame_shared_texture_import_ok,
                    source_frame_shared_texture_import_detail,
                ) = source_frame_shared_texture_import_readiness(&capabilities);
                let (output_shared_texture_export_ok, output_shared_texture_export_detail) =
                    output_shared_texture_export_readiness(&capabilities);
                let mut checks = vec![
                    json!({
                        "id": "wgpu-device",
                        "label": "Native wgpu device",
                        "ok": renderer_ready,
                        "detail": self.adapter_name.clone().unwrap_or_else(|| "not initialized".to_string())
                    }),
                    json!({
                        "id": "shared-texture-source-frame-upload",
                        "label": "Shared texture source-frame transport",
                        "ok": source_frame_shared_texture_import_ok,
                        "detail": source_frame_shared_texture_import_detail
                    }),
                    json!({
                        "id": "shared-texture-upload",
                        "label": "Shared texture media transport",
                        "ok": self.shared_texture_media_transport_ready(),
                        "detail": if self.shared_texture_media_transport_ready() {
                            shared_texture_media_transport_ready_detail()
                        } else { "full media shared texture transport is pending for this backend" }
                    }),
                    json!({
                        "id": "native-output-mirror",
                        "label": "Native offscreen output mirror",
                        "ok": renderer_ready,
                        "detail": if renderer_ready { "composite renders into a native offscreen output texture before swapchain present" } else { "native renderer has not created a wgpu device" }
                    }),
                    json!({
                        "id": "shared-texture-output-export",
                        "label": "Native output shared-texture export",
                        "ok": output_shared_texture_export_ok,
                        "detail": output_shared_texture_export_detail
                    }),
                    json!({
                        "id": "native-texture-share-sender",
                        "label": texture_share_sender_label(),
                        "ok": false,
                        "detail": if output_shared_texture_export_ok {
                            texture_share_sender_ready_detail()
                        } else {
                            texture_share_sender_pending_detail()
                        }
                    }),
                    json!({
                        "id": "compute-instrument-host",
                        "label": "Native compute/multi-pass instrument host",
                        "ok": compute_instrument_host_ok,
                        "detail": compute_instrument_host_detail
                    }),
                ];
                checks.extend(
                    native_graph_readiness_checks(&capabilities, renderer_ready)
                        .into_iter()
                        .map(|check| {
                            json!({
                                "id": check.id,
                                "label": check.label,
                                "ok": check.ok,
                                "detail": check.detail
                            })
                        }),
                );
                let status = self.status();
                let managed_output_has_scene =
                    status.scene_layers_active == 0 || status.output_last_presented_layer_count > 0;
                checks.extend([
                    json!({
                        "id": "native-frame-sequence-export",
                        "label": "Native frame sequence export",
                        "ok": renderer_ready,
                        "detail": if renderer_ready { "native output snapshots can be stepped by render clock and exported as raw frame files" } else { "native renderer has not created a wgpu device" }
                    }),
                    json!({
                        "id": "native-frame-export",
                        "label": "Native frame export",
                        "ok": renderer_ready,
                        "detail": if renderer_ready { "render core can export deterministic raw frame snapshots for MP4/JPEG encoders" } else { "native renderer has not created a wgpu device" }
                    }),
                    json!({
                        "id": "managed-output",
                        "label": "Managed output window",
                        "ok": status.output_present_healthy && managed_output_has_scene,
                        "detail": if !self.output_window_attached {
                            "native output window is detached/hidden".to_string()
                        } else if self.stats.swapchain_presented == 0 {
                            format!("waiting for first native swapchain present; last={}", if self.stats.swapchain_last_present_result.is_empty() { "none" } else { self.stats.swapchain_last_present_result.as_str() })
                        } else if status.scene_layers_active > 0 && status.output_last_presented_layer_count == 0 {
                            format!("native output is presenting, but the last presented frame had no scene layers (active scene layers={})", status.scene_layers_active)
                        } else if self.stats.swapchain_present_consecutive_failures > 0 {
                            format!("native output present has {} consecutive failure(s); last={}", self.stats.swapchain_present_consecutive_failures, if self.stats.swapchain_last_present_result.is_empty() { "none" } else { self.stats.swapchain_last_present_result.as_str() })
                        } else {
                            format!("native output presented {} frame(s), last layer count={}", self.stats.swapchain_presented, status.output_last_presented_layer_count)
                        }
                    }),
                    json!({
                        "id": "native-recording",
                        "label": "Native recording",
                        "ok": false,
                        "detail": if self.renderer.is_some() { "render core provides raw frame export only; query the Electron broker readiness for MP4/JPEG encoder sessions" } else { "native renderer has not created a wgpu device" }
                    }),
                ]);
                Ok(json!({
                "timestamp_ms": epoch_ms(),
                "overall_ready": renderer_ready,
                "blockers": if renderer_ready { Vec::<String>::new() } else { vec!["native renderer has not created a wgpu device".to_string()] },
                "capabilities": capabilities,
                "checks": checks
                }))
            }
            "reset_stats" => {
                self.stats = CoreStats::default();
                self.output_last_presented_layer_count = 0;
                self.render_cpu_ema_ms = 0.0;
                self.native_quality.cpu_ema_ms = 0.0;
                self.native_quality.overload_frames = 0;
                self.native_quality.recovery_frames = 0;
                self.native_quality.step_downs = 0;
                self.native_quality.step_ups = 0;
                Ok(json!(true))
            }
            "submit_batch" => {
                let summary = self.apply_batch(&req.params);
                let explicit_present = summary
                    .get("explicit_present_requested")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !explicit_present {
                    self.request_auto_present();
                }
                Ok(summary)
            }
            "schedule_launch" => {
                if !self.running || self.render_clock_mode != "live" { Err("scheduled launches require a running live renderer".into()) }
                else {
                    self.launch_scheduler.enqueue(&req.params, Instant::now(), self.command_drain_limit as usize)
                }
            }
            "cancel_launch" => {
                let lane = string_at(&req.params, &["lane"]).unwrap_or_default();
                let revision = req.params["revision"].as_u64().unwrap_or(0);
                match self.launch_scheduler.cancel(&lane, revision) {
                    Ok(()) => {
                        self.scheduled_binding_guards.retain(|_, (_, owner, _)| owner != &lane);
                        Ok(json!({"cancelled":true, "receipts":self.launch_scheduler.status()["receipts"]}))
                    }
                    Err(error) if error == "stale launch cancellation" && bool_at(&req.params, &["settle_superseded"]) == Some(true) => {
                        // The newer lane revision already replaced this intention.
                        // Acknowledge its outcome without cancelling the newer owner.
                        Ok(json!({"cancelled":true,"superseded":true,"receipts":self.launch_scheduler.status()["receipts"]}))
                    }
                    Err(error) => Err(error),
                }
            }
            "launch_status" => Ok(self.launch_scheduler.status()),
            "submit_commands" => {
                let summary =
                    self.apply_commands(req.params.get("commands").unwrap_or(&req.params));
                let explicit_present = summary
                    .get("explicit_present_requested")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !explicit_present {
                    self.request_auto_present();
                }
                Ok(summary)
            }
            "set_layer_interaction" => {
                self.apply_layer_interaction(&req.params);
                self.request_auto_present();
                Ok(json!(true))
            }
            "set_output" => {
                self.apply_output_config(&req.params);
                Ok(json!(true))
            }
            "set_output_state" => self.apply_output_state(&req.params),
            "set_composite_effects" => self.apply_composite_effects(&req.params),
            "set_output_stage" => self.apply_output_stage(&req.params),
            "set_slice_outputs" => self.apply_slice_outputs(&req.params),
            "slice_output_state" | "get_slice_output_state" => Ok(self.tag_presenter_info(
                self.renderer
                    .as_ref()
                    .map(RenderState::slice_output_metadata)
                    .unwrap_or_else(|| json!({ "available": false })),
            )),
            "set_record_target" => self.apply_record_target(&req.params),
            "record_target_state" | "get_record_target_state" => Ok(self.record_target_state()),
            // Linux Screens: Electron hands over its Screen window's X11 id and
            // the core presents into a child window inside it.
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            "attach_slice_window" => {
                let id = string_at(&req.params, &["slice_id"]).unwrap_or_default();
                let xid = req.params.get("x11_window").and_then(Value::as_u64).unwrap_or(0);
                let width = req.params.get("width").and_then(Value::as_u64).unwrap_or(1) as u32;
                let height = req.params.get("height").and_then(Value::as_u64).unwrap_or(1) as u32;
                match self.renderer.as_mut() {
                    Some(renderer) if !id.is_empty() => renderer.attach_linux_slice_window(event_loop, &id, xid, width, height),
                    Some(_) => Err("attach_slice_window needs a slice_id".to_string()),
                    None => Err("native renderer has not created a wgpu device".to_string()),
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            "resize_slice_window" => {
                let id = string_at(&req.params, &["slice_id"]).unwrap_or_default();
                let width = req.params.get("width").and_then(Value::as_u64).unwrap_or(1) as u32;
                let height = req.params.get("height").and_then(Value::as_u64).unwrap_or(1) as u32;
                match self.renderer.as_mut() {
                    Some(renderer) => renderer.resize_linux_slice_window(&id, width, height),
                    None => Err("native renderer has not created a wgpu device".to_string()),
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            "detach_slice_window" => {
                let id = string_at(&req.params, &["slice_id"]).unwrap_or_default();
                Ok(self
                    .renderer
                    .as_mut()
                    .map(|renderer| renderer.detach_linux_slice_window(&id))
                    .unwrap_or_else(|| json!({ "detached": false })))
            }
            // In-core GPU recording. The Electron recorder still exists and
            // still works; this is the path that skips the readback entirely.
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            "start_native_recording" => self.start_native_recording_rpc(&req.params),
            "texture_share_start" | "texture_share_stop" | "texture_share_state"
            | "texture_share_slices_start" | "texture_share_slices_stop" => {
                self.texture_share_rpc(req.method.as_str(), &req.params)
            }
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            "stop_native_recording" => self.stop_native_recording_rpc(),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            "native_recording_state" => Ok(self
                .renderer
                .as_ref()
                .map(RenderState::native_recording_state)
                .unwrap_or_else(|| json!({ "available": false, "active": false }))),
            "set_output_window" => {
                self.apply_output_window_config(&req.params);
                Ok(json!(self.status()))
            }
            "set_present_policy" => {
                self.apply_present_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_command_drain_policy" => {
                self.apply_command_drain_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_auto_present_policy" => {
                self.apply_auto_present_policy(&req.params);
                Ok(json!(self.status()))
            }
            "attach_output_window" => {
                self.apply_output_window_attached(true);
                Ok(json!(self.status()))
            }
            "detach_output_window" => {
                self.apply_output_window_attached(false);
                Ok(json!(self.status()))
            }
            "set_target_fps" => {
                self.target_fps = number_at(&req.params, &["config", "target_fps"])
                    .or_else(|| number_at(&req.params, &["target_fps"]))
                    .unwrap_or(self.target_fps as f64)
                    .round()
                    .clamp(1.0, 240.0) as u32;
                Ok(json!(true))
            }
            "set_native_quality_policy" => {
                self.apply_native_quality_policy(&req.params);
                Ok(json!(true))
            }
            "set_render_clock" => {
                self.apply_render_clock(&req.params);
                Ok(json!(true))
            }
            "set_shader_precompile_policy" => {
                self.apply_shader_precompile_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_texture_pool_cap" => {
                self.apply_texture_pool_cap(&req.params);
                Ok(json!(self.status()))
            }
            "set_vram_budget" => {
                self.apply_vram_budget(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_cpu_backup_policy" => {
                self.apply_decode_cpu_backup_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_synthetic_fallback_policy" => {
                self.apply_decode_synthetic_fallback_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_media_prefetch_policy" => {
                self.apply_media_prefetch_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_media_drop_policy" => {
                self.apply_media_drop_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_preview_policy" => {
                self.apply_decode_preview_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_target_policy" => {
                self.apply_decode_target_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_upload_policy" => {
                self.apply_decode_upload_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_handoff_policy" => {
                self.apply_decode_handoff_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_estimate_cache_policy" => {
                self.apply_decode_estimate_cache_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_metadata_cache_caps" => {
                self.apply_metadata_cache_caps(&req.params);
                Ok(json!(self.status()))
            }
            "clear_runtime_caches" => Ok(self.clear_runtime_caches(&req.params)),
            "audio_devices" => Ok(clip_audio::ClipAudio::devices()),
            "audio_status" => Ok(self.clip_audio.as_ref().map(|audio| audio.status()).unwrap_or_else(|| json!({"running": false, "assets": []}))),
            "audio_output" => {
                let name = string_at(&req.params, &["device"]).unwrap_or_else(|| "default".into());
                self.clip_audio.get_or_insert_with(clip_audio::ClipAudio::new).select_output(&name).map(|_| json!(true))
            }
            // Recording tap: the mixer streams its device mix to a loopback
            // sink owned by the app, silence included, until stopped.
            "audio_tap_start" => {
                let port = req.params.get("port").and_then(Value::as_u64).filter(|p| *p > 0 && *p <= 65535).map(|p| p as u16);
                let token = req.params.get("token").and_then(Value::as_str).filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()));
                match (port, token) {
                    (Some(port), Some(token)) => self.clip_audio.get_or_insert_with(clip_audio::ClipAudio::new).start_tap(port, token),
                    (None, _) => Err("invalid audio tap port".to_string()),
                    (_, None) => Err("invalid audio tap token".to_string()),
                }
            }
            // Analysis scope: the app's audio analyser follows the clip mix
            // through this when no live input is running.
            "audio_scope" => {
                let since = req.params.get("since").and_then(Value::as_u64).unwrap_or(0);
                let max_frames = req.params.get("max_frames").and_then(Value::as_u64).unwrap_or(4096).clamp(1, 8192) as usize;
                Ok(self.clip_audio.as_ref().map(|audio| audio.scope(since, max_frames))
                    .unwrap_or_else(|| json!({ "first": since, "next": since, "rate": 48000, "frames": 0, "active": false, "samples_b64": "" })))
            }
            "audio_tap_stop" => Ok(self.clip_audio.as_mut().map(|audio| audio.stop_tap()).unwrap_or_else(|| json!({ "active": false, "frames": 0, "dropped": 0 }))),
            "shutdown" => {
                self.running = false;
                if let Some(cache) = self.renderer.as_mut().and_then(|renderer| renderer.disk_pipeline_cache.as_mut()) {
                    cache.flush();
                }
                // Its decoded audio folder goes with it.
                self.clip_audio = None;
                event_loop.exit();
                Ok(json!(true))
            }
            _ => Err(format!(
                "unsupported native render-core RPC method `{}`",
                req.method
            )),
        };

        // Publish before acknowledging the mutation. Unordered status readers
        // may run immediately after the reply, even before this handler exits.
        self.fast_path
            .set_manual_clock(self.render_clock_mode == "manual");
        if RPC_READ_ONLY_METHODS.contains(&req.method.as_str()) {
            // Nothing changed, so the last full build still holds every applied command.
            if self.fast_path.wants_publish() {
                self.refresh_rpc_snapshot();
            }
        } else if self.fast_path.wants_publish() {
            self.publish_rpc_snapshot();
        } else {
            self.rpc_snapshot_cache = None;
        }
        if req.id != 0 {
            match result {
                Ok(value) => self.send_ok(req.id, value),
                Err(err) => self.send_error(req.id, err),
            }
        }
    }

    pub(crate) fn apply_batch(&mut self, params: &Value) -> Value {
        let mut summary = if let Some(commands) = params
            .pointer("/batch/commands")
            .or_else(|| params.get("commands"))
        {
            self.apply_commands(commands)
        } else {
            json!({
                "total": 0,
                "applied": 0,
                "dropped": 0,
                "unknown_types": [],
                "invalid_payload": true,
                "command_drain_limit": self.command_drain_limit,
            })
        };
        self.stats.frames_submitted = self.stats.frames_submitted.saturating_add(1);
        if let Some(object) = summary.as_object_mut() {
            object.insert(
                "frames_submitted".to_string(),
                json!(self.stats.frames_submitted),
            );
        }
        summary
    }

    pub(crate) fn apply_commands(&mut self, commands: &Value) -> Value {
        let Some(commands) = commands.as_array() else {
            return json!({
                "total": 0,
                "applied": 0,
                "dropped": 0,
                "unknown_types": [],
                "invalid_payload": true,
                "command_drain_limit": self.command_drain_limit,
            });
        };
        let count = commands.len() as u64;
        let mut applied = 0u64;
        let mut dropped = 0u64;
        let mut unknown_types = Vec::<String>::new();
        let mut errors = Vec::<Value>::new();
        let mut explicit_present_requested = false;
        self.stats.command_queue_peak = self.stats.command_queue_peak.max(count);
        if count > self.command_drain_limit as u64 {
            self.stats.command_drain_limit_hits =
                self.stats.command_drain_limit_hits.saturating_add(1);
            self.stats.queued_commands_after_drain = 0;
        }

        let owns_orphan_batch = self.batch_orphan_candidates.is_none();
        if owns_orphan_batch {
            self.batch_orphan_candidates = Some(Vec::new());
        }
        for command in commands {
            let command_type = command
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match command_type {
                "set_output" => self.apply_output_config(command),
                "set_output_state" => {
                    let _ = self.apply_output_state(command);
                }
                "set_composite_effects" => {
                    let _ = self.apply_composite_effects(command);
                }
                "set_output_stage" => {
                    let _ = self.apply_output_stage(command);
                }
                "set_mirror_mesh" => {
                    if let Err(error) = self.apply_mirror_mesh(command) {
                        if errors.len() < 16 { errors.push(json!({ "type": command_type, "message": error })); }
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "set_slice_outputs" => {
                    if let Err(error) = self.apply_slice_outputs(command) {
                        if errors.len() < 16 { errors.push(json!({ "type": command_type, "message": error })); }
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "upsert_layer" => self.apply_upsert_layer(command),
                "set_layer_visibility" => self.apply_layer_visibility(command),
                "set_layer_color" => self.apply_layer_color(command),
                "set_layer_tint" => self.apply_layer_tint(command),
                "set_layer_dome" => self.apply_layer_dome(command),
                "set_dome_view" => self.apply_dome_view(command),
                "set_output_flux" => {
                    // Flux from a paired phone. Absent or zero gain switches it off.
                    let number = |key: &str, fallback: f64| command.get(key).and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(fallback) as f32;
                    // Screens: boxes (x0, y0, x1, y1) in composition UV, y up.
                    // Flux plays inside each one; none means the whole frame.
                    let mut regions = [[0.0f32; 4]; MAX_FLUX_REGIONS];
                    let mut region_count = 0usize;
                    if let Some(list) = command.get("regions").and_then(Value::as_array) {
                        for item in list {
                            if region_count >= MAX_FLUX_REGIONS { break; }
                            let Some(v) = item.as_array() else { continue };
                            let at = |i: usize| v.get(i).and_then(Value::as_f64).filter(|n| n.is_finite()).map(|n| n as f32);
                            let (Some(x0), Some(y0), Some(x1), Some(y1)) = (at(0), at(1), at(2), at(3)) else { continue };
                            let (x0, x1) = (x0.min(x1).clamp(0.0, 1.0), x0.max(x1).clamp(0.0, 1.0));
                            let (y0, y1) = (y0.min(y1).clamp(0.0, 1.0), y0.max(y1).clamp(0.0, 1.0));
                            if x1 - x0 < 1e-4 || y1 - y0 < 1e-4 { continue; }
                            regions[region_count] = [x0, y0, x1, y1];
                            region_count += 1;
                        }
                    }
                    let flux = [
                        [number("x", 0.5).clamp(0.0, 1.0), number("y", 0.5).clamp(0.0, 1.0), number("energy", 0.0).clamp(0.0, 1.0), number("gain", 0.0).clamp(0.0, 1.0)],
                        [number("beat_lock", 0.0).clamp(0.0, 1.0), number("blend", 0.0).clamp(0.0, 6.0).round(), region_count as f32, number("modules", 0.0).clamp(0.0, 4095.0).round()],
                    ];
                    if let Some(renderer) = self.renderer.as_mut() {
                        renderer.output_flux = flux;
                        renderer.output_flux_regions = regions;
                    }
                }
                "set_beat_clock" => {
                    let Some(anchor) = BeatClockAnchor::from_command(command) else {
                        dropped = dropped.saturating_add(1);
                        continue;
                    };
                    self.beat_clock_request = Some(anchor);
                }
                "start_prepared_transition" => {
                    if !self.prepared_transition_ready(command) {
                        dropped = dropped.saturating_add(1); continue;
                    }
                    self.start_prepared_transition(command);
                }
                "set_layer_native_params" => self.apply_layer_native_params(command),
                "set_layer_edge_effects" => self.apply_layer_edge_effects(command),
                "set_layer_paint_mask" => {
                    if let Some(layer_id) = string_at(command, &["layer_id"]) {
                        self.paint_masks.apply_command(&layer_id, command);
                        self.pending_render_retry = true;
                    }
                }
                "set_layer_paint_preview" => {
                    if let Some(layer_id) = string_at(command, &["layer_id"]) {
                        self.paint_masks.apply_preview_command(&layer_id, command);
                        self.pending_render_retry = true;
                    }
                }
                "set_native_graph_layer" => self.apply_native_graph_layer(command),
                "update_native_graph_buffer" => {
                    if let Err(err) = self.apply_update_native_graph_buffer(command) {
                        self.last_shader_error = Some(err);
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "upload_native_point_cloud" => {
                    if self.apply_native_point_cloud(command).is_err() {
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "remove_native_graph_layer" => self.apply_remove_native_graph_layer(command),
                "queue_compute_graph" | "enqueue_compute_graph" => {
                    if let Err(err) = self.apply_queue_compute_graph(command) {
                        self.last_shader_error = Some(err);
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "clear_composite_graph" => {
                    self.pending_composite_graph_jobs = Arc::new(Vec::new());
                    self.pending_composite_output_index = 0;
                }
                "set_effect_chain" => self.apply_effect_chain(command),
                "set_present_policy" => self.apply_present_policy(command),
                "set_command_drain_policy" | "set_command_drain_limit" => {
                    self.apply_command_drain_policy(command)
                }
                "set_auto_present_policy" => self.apply_auto_present_policy(command),
                "set_vram_budget" => self.apply_vram_budget(command),
                "set_decode_cpu_backup_policy" => self.apply_decode_cpu_backup_policy(command),
                "set_decode_synthetic_fallback_policy" => {
                    self.apply_decode_synthetic_fallback_policy(command)
                }
                "set_media_prefetch_policy" => self.apply_media_prefetch_policy(command),
                "set_media_drop_policy" => self.apply_media_drop_policy(command),
                "set_decode_preview_policy" => self.apply_decode_preview_policy(command),
                "set_decode_target_policy" => self.apply_decode_target_policy(command),
                "set_decode_upload_policy" => self.apply_decode_upload_policy(command),
                "set_decode_handoff_policy" => self.apply_decode_handoff_policy(command),
                "set_decode_estimate_cache_policy" => {
                    self.apply_decode_estimate_cache_policy(command)
                }
                "set_texture_pool_cap" => self.apply_texture_pool_cap(command),
                "set_shader_precompile_policy" => self.apply_shader_precompile_policy(command),
                "set_metadata_cache_caps" => self.apply_metadata_cache_caps(command),
                "set_native_quality_policy" => self.apply_native_quality_policy(command),
                "present" => {
                    explicit_present_requested = true;
                    self.request_present();
                }
                "set_audio_state" => self.apply_audio_state(command),
                "set_audio_spectrum" => self.apply_audio_spectrum(command),
                "set_render_clock" => self.apply_render_clock(command),
                "set_clip_audio_mix" => {
                    self.clip_audio_mix = command.get("voices").cloned().unwrap_or_else(|| json!([]));
                    let sources = command.get("sources").and_then(Value::as_array).into_iter().flatten()
                        .filter_map(|value| value.as_str()).take(64)
                        .filter_map(|uri| local_media_path_from_uri(uri).map(|path| (uri.to_string(), path))).collect();
                    self.clip_audio.get_or_insert_with(clip_audio::ClipAudio::new).prepare(sources);
                    self.refresh_clip_audio();
                }
                "set_link_clock" => {
                    self.link_clock = match (number_at(command, &["beat"]), number_at(command, &["tempo"])) {
                        (Some(beat), Some(tempo)) if beat.is_finite() && tempo.is_finite() && tempo > 0.0 && bool_at(command, &["enabled"]).unwrap_or(false) => Some((beat, tempo, Instant::now())),
                        _ => None,
                    };
                }
                "set_media_source_phase" => self.apply_media_source_phase(command),
                "set_media_source_playback" => self.apply_media_source_playback(command),
                "bind_media_source" => self.apply_media_source(command),
                "decode_media_source" => self.apply_decode_media_source(command),
                "set_stage3d_scene" => {
                    if self.set_stage3d_scene(command).is_err() {
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "set_projection_sim_scene" => {
                    if self.set_projection_sim_scene(command).is_err() {
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "set_projection_sim_meshes" | "set_projection_sim_view" | "set_projection_sim_overlay" => {
                    let result = match command_type {
                        "set_projection_sim_meshes" => self.set_projection_sim_meshes(command),
                        "set_projection_sim_view" => self.set_projection_sim_view(command),
                        _ => self.set_projection_sim_overlay(command),
                    };
                    if let Err(error) = result {
                        if errors.len() < 16 { errors.push(json!({ "type": command_type, "message": error })); }
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "upload_source_preview" => self.apply_source_preview(command),
                "upload_source_frame" | "upload_source_gpu_shared_texture" => {
                    self.apply_source_frame(command)
                }
                "precompile_shader" => self.apply_precompile_shader(command),
                "bind_isf_shader" => self.apply_bind_isf_shader(command),
                "update_isf_uniforms" => self.apply_isf_uniforms(command),
                "set_isf_time_anchor" => self.apply_isf_time_anchor(command),
                "render_isf_to_layer" => self.apply_render_isf_to_layer(command),
                "remove_layer" => self.apply_remove_layer(command),
                _ => {
                    dropped = dropped.saturating_add(1);
                    if unknown_types.len() < 16 {
                        unknown_types.push(if command_type.is_empty() {
                            "<missing>".to_string()
                        } else {
                            command_type.to_string()
                        });
                    }
                    continue;
                }
            }
            applied = applied.saturating_add(1);
        }
        if owns_orphan_batch {
            for source_id in self.batch_orphan_candidates.take().unwrap_or_default() {
                self.release_media_source_if_orphaned(&source_id);
            }
        }
        self.stats.commands_applied = self.stats.commands_applied.saturating_add(applied);
        self.stats.commands_dropped = self.stats.commands_dropped.saturating_add(dropped);
        self.command_phase = (self.command_phase + applied as f32 * 0.031).fract();
        self.layers_seen = self.scene_layers.len().min(1024) as u32;
        json!({
            "total": count,
            "applied": applied,
            "dropped": dropped,
            "unknown_types": unknown_types,
            "errors": errors,
            "invalid_payload": false,
            "command_drain_limit": self.command_drain_limit,
            "command_queue_peak": self.stats.command_queue_peak,
            "explicit_present_requested": explicit_present_requested,
        })
    }
}
