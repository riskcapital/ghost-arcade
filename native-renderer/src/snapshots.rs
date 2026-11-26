//! Frame snapshots: manual-clock snapshot frames, composite and deck monitor
//! previews, live capture and the live frame stream, and frame exports.

use crate::*;

pub(crate) static LIVE_FRAME_STREAM: Mutex<Option<(u16, String, std::net::TcpStream)>> = Mutex::new(None);

/// Send a frame (`copies` times) to the main process's frame sink over the
/// loopback connection kept for it, and wait for the sink's "OK": the sink
/// answers once the encoder has taken the bytes, so a slow encoder slows the
/// sender instead of piling frames up.
pub(crate) fn send_to_frame_stream(port: u16, token: &str, pixels: &[u8], copies: u64) -> Result<(), String> {
    use std::io::{Read, Write};
    let mut cached = LIVE_FRAME_STREAM.lock().map_err(|_| "frame stream lock poisoned")?;
    if cached.as_ref().is_none_or(|(p, t, _)| *p != port || t != token) {
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        let mut stream = std::net::TcpStream::connect_timeout(&address, Duration::from_secs(2)).map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
        stream.set_read_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
        stream.set_nodelay(true).map_err(|e| e.to_string())?;
        stream.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
        *cached = Some((port, token.to_string(), stream));
    }
    let result = (|| -> Result<(), String> {
        let stream = &mut cached.as_mut().unwrap().2;
        for _ in 0..copies { stream.write_all(pixels).map_err(|e| e.to_string())?; }
        let mut ack = [0u8; 2]; stream.read_exact(&mut ack).map_err(|e| e.to_string())?;
        if &ack != b"OK" { return Err("encoder did not accept frame".to_string()); }
        Ok(())
    })();
    if result.is_err() { *cached = None; }
    result
}

/// A frame sink named in an RPC's params: `stream_port` + `stream_token`
/// (from the main process, never the editor: the broker strips them).
pub(crate) fn frame_stream_params(params: &Value) -> Result<Option<(u16, String)>, String> {
    let Some(port) = params.get("stream_port") else { return Ok(None) };
    let port = port.as_u64().filter(|p| *p > 0 && *p <= 65535).ok_or("invalid frame stream port")? as u16;
    let token = params.get("stream_token").and_then(Value::as_str)
        .filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("invalid frame stream token")?.to_string();
    Ok(Some((port, token)))
}

pub(crate) static LIVE_CAPTURE_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(crate) static LIVE_DIAGNOSTIC_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(crate) static LIVE_PREVIEW_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// One in-flight readback per deck monitor (bank A, bank B) and for the
/// dome's Inside view.
pub(crate) static LIVE_DECK_PREVIEW_BUSY: [std::sync::atomic::AtomicBool; 3] = [
    std::sync::atomic::AtomicBool::new(false),
    std::sync::atomic::AtomicBool::new(false),
    std::sync::atomic::AtomicBool::new(false),
];

pub(crate) struct LiveCapturePermit(pub(crate) &'static std::sync::atomic::AtomicBool);

impl Drop for LiveCapturePermit {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}

impl App {
    pub(crate) fn snapshot_clock_from_params(&self, params: &Value) -> (Option<f64>, u64) {
        let snapshot_time = number_at(params, &["time"])
            .or_else(|| number_at(params, &["time_seconds"]))
            .or_else(|| number_at(params, &["clock_time"]))
            .map(|value| value.clamp(0.0, 1.0e9))
            .or(self.render_clock_time);
        let snapshot_frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u64::MAX as f64) as u64)
            .unwrap_or_else(|| self.native_frame_index());
        (snapshot_time, snapshot_frame_index)
    }

    /// Manual clock (offline render) with `step_seconds`: advance every graph,
    /// simulation and bound shader to this frame's time by exactly one step,
    /// here, after the videos are settled and before the snapshot reads the
    /// composite. Without it the snapshot showed whatever the core's own
    /// timer-paced render last produced, which depended on how fast the
    /// export ran. A repeat snapshot of the same frame does not step again.
    pub(crate) fn step_manual_snapshot_frame(&mut self, params: &Value, clock: Option<f64>, frame: u64) -> Result<(), String> {
        if self.render_clock_mode != "manual" {
            return Ok(());
        }
        let Some(step) = number_at(params, &["step_seconds"]).filter(|s| s.is_finite() && *s > 0.0) else {
            return Ok(());
        };
        let Some(time) = clock else { return Ok(()); };
        self.render_clock_time = Some(time);
        self.render_clock_frame_index = Some(frame);
        self.render_clock_delta = step.clamp(0.0, 1.0) as f32;
        if self.last_native_graph_step_clock == Some(time) {
            return Ok(());
        }
        // render() skips a frame while the GPU has no room for another
        // (frames_in_flight.rs): wait for room (an export has all the time it
        // needs, a stall is a fault).
        let waited = Instant::now();
        while self.renderer.as_ref().is_some_and(RenderState::frame_in_flight) {
            if let Some(renderer) = self.renderer.as_mut() {
                let _ = renderer.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: Some(Duration::from_millis(50)) });
            }
            if waited.elapsed() > Duration::from_secs(60) {
                return Err("the GPU did not finish the previous frame for the render".to_string());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        self.manual_snapshot_stepping = true;
        self.render();
        self.manual_snapshot_stepping = false;
        if self.last_native_graph_step_clock != Some(time) && !self.output_frozen && self.output_gate() > 0.0 {
            return Err("the render core could not step this frame".to_string());
        }
        Ok(())
    }

    pub(crate) fn render_frame_snapshot_texture(
        &mut self,
        params: &Value,
    ) -> Result<(Option<f64>, u64), String> {
        let (snapshot_time, snapshot_frame_index) = self.snapshot_clock_from_params(params);
        self.sync_paint_masks_to_gpu();
        let gpu_layers = self.gpu_layer_data();
        let source_preview_pixels = if self.source_preview_dirty {
            Some(self.source_preview_pixel_data())
        } else {
            None
        };
        let stage3d_mesh_frame = self.stage3d_mesh_frame();
        let scene_overlay_items = self.scene_overlay_items();
        let output_gate = self.output_gate();
        let post_effects = self.composite_effect_slots();
        // `slice_id` reads one screen's output (its crop, warp, grade, blend
        // and masks) through the same presenter pass a slice display uses,
        // instead of the editor preview's master stage.
        let (output_stage, mirror_mesh) = match string_at(params, &["slice_id"]) {
            Some(slice_id) => self
                .slice_outputs
                .iter()
                .find(|spec| spec.id == slice_id)
                .map(|spec| (spec.stage, spec.mirror_mesh.clone()))
                .ok_or_else(|| format!("unknown screen output: {slice_id}"))?,
            None => (self.preview_output_stage(), None),
        };
        let Some(renderer) = self.renderer.as_mut() else {
            return Err("native renderer has not created a wgpu device".to_string());
        };
        renderer.poll_gpu_timing();
        if let Err(err) = renderer.render_snapshot(
            self.command_phase,
            gpu_layers.len() as u32,
            snapshot_time.map(shader_clock_seconds),
            snapshot_frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            stage3d_mesh_frame.as_ref(),
            &scene_overlay_items,
            self.audio0,
            self.audio1,
            self.audio2,
            self.output_frozen,
            output_gate,
            &post_effects,
            &self.pending_composite_graph_jobs,
            self.pending_composite_output_index,
            output_stage,
            mirror_mesh,
        ) {
            renderer.last_frame_error = Some(err.clone());
            return Err(err);
        }
        if source_preview_pixels.is_some() {
            self.source_preview_dirty = false;
        }
        Ok((snapshot_time, snapshot_frame_index))
    }

    pub(crate) fn refresh_renderer_timing_stats(&mut self) {
        let Some(renderer) = self.renderer.as_ref() else {
            return;
        };
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
    }

    pub(crate) fn note_frame_snapshot(&mut self, snapshot: &Value) {
        self.stats.frame_snapshot_reads = self.stats.frame_snapshot_reads.saturating_add(1);
        self.stats.frame_health_checks = self.stats.frame_health_checks.saturating_add(1);
        if bool_at(snapshot, &["dark_frame"]).unwrap_or(false) {
            self.stats.dark_frame_warnings = self.stats.dark_frame_warnings.saturating_add(1);
        }
        self.stats.frame_snapshot_bytes_read = self
            .stats
            .frame_snapshot_bytes_read
            .saturating_add(number_at(snapshot, &["byte_length"]).unwrap_or(0.0) as u64);
    }

    /// A UI mirror reads the last program frame, without advancing simulations
    /// or blocking the event loop while the GPU maps the readback buffer.
    pub(crate) fn start_composite_preview(&mut self, req: &RpcRequest) -> Result<(), String> {
        if LIVE_PREVIEW_BUSY.swap(true, Ordering::AcqRel) {
            return Err("composite preview busy; drop this preview frame".to_string());
        }
        let permit = LiveCapturePermit(&LIVE_PREVIEW_BUSY);
        let max_dim = number_at(&req.params, &["max_dim"]).unwrap_or(512.0).round().clamp(16.0, 2048.0) as u32;
        let include_pixels = bool_at(&req.params, &["include_pixels"]).unwrap_or(false);
        // `encoding: "jpeg"` sends a JPEG about a twentieth of the raw size.
        // A live mirror at 30 fps moved ~150 MB/s of base64 through the
        // broker and slowed every window; as JPEG it is a few MB/s.
        let jpeg_quality = string_at(&req.params, &["encoding"])
            .is_some_and(|value| value.eq_ignore_ascii_case("jpeg"))
            .then(|| number_at(&req.params, &["quality"]).unwrap_or(80.0).clamp(30.0, 95.0) as u8);
        let renderer = self.renderer.as_mut().ok_or("native renderer unavailable")?;
        let pending = renderer.prepare_frame_snapshot_scaled(max_dim, true)?;
        let frame_index = renderer.creative_frame_index as u64;
        let response_tx = self.response_tx.clone();
        let id = req.id;
        thread::spawn(move || {
            let _permit = permit;
            let result = pending.finish().and_then(|frame| {
                let mut value = match jpeg_quality.filter(|_| include_pixels) {
                    Some(quality) => SourcePreviewRequest {
                        width: None, height: None, max_dim, jpeg_quality: Some(quality), include_pixels: true,
                    }.encode(&frame)?,
                    None => frame.to_json(include_pixels),
                };
                value["frame_index"] = json!(frame_index);
                value["render_source"] = json!("core-output-mirror");
                Ok(value)
            });
            drop(_permit);
            if id != 0 {
                let reply = match result { Ok(result) => json!({"id":id,"ok":true,"result":result}),
                    Err(error) => json!({"id":id,"ok":false,"error":error}) };
                let _ = response_tx.send(reply.to_string());
            }
        });
        Ok(())
    }

    /// A deck confidence monitor read back for a panel with no presenter to
    /// show it (`deck_monitor`: "a" or "b"). Like the composite preview it
    /// reads what the last frame drew and maps the buffer off the event loop.
    pub(crate) fn start_deck_monitor_preview(&mut self, req: &RpcRequest) -> Result<(), String> {
        let bank = match string_at(&req.params, &["deck_monitor"]).as_deref() {
            Some("a") | Some("A") => 0,
            Some("b") | Some("B") => 1,
            // The dome's Inside view rides the same readback, for a panel or
            // test with no presenter to show it.
            Some("dome") => 2,
            _ => return Err("deck_monitor must be \"a\", \"b\" or \"dome\"".to_string()),
        };
        let busy = &LIVE_DECK_PREVIEW_BUSY[bank];
        if busy.swap(true, Ordering::AcqRel) {
            return Err("deck monitor preview busy; drop this preview frame".to_string());
        }
        let permit = LiveCapturePermit(busy);
        let include_pixels = bool_at(&req.params, &["include_pixels"]).unwrap_or(false);
        let renderer = self.renderer.as_ref().ok_or("native renderer unavailable")?;
        // No deck has drawn since the core started: answer with no pixels
        // rather than an error, so a panel polling an empty deck stays quiet.
        let Some(pending) = renderer.prepare_deck_monitor_readback(bank)? else {
            self.send_ok(req.id, json!({
                "render_source": "core-deck-monitor",
                "includes_pixels": false,
            }));
            return Ok(());
        };
        let response_tx = self.response_tx.clone();
        let id = req.id;
        thread::spawn(move || {
            let _permit = permit;
            let result = pending.finish().map(|frame| {
                let mut value = frame.to_json(include_pixels);
                value["render_source"] = json!("core-deck-monitor");
                value
            });
            drop(_permit);
            if id != 0 {
                let reply = match result { Ok(result) => json!({"id":id,"ok":true,"result":result}),
                    Err(error) => json!({"id":id,"ok":false,"error":error}) };
                let _ = response_tx.send(reply.to_string());
            }
        });
        Ok(())
    }

    pub(crate) fn frame_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        if params.get("source_id").is_some() || params.get("layer_id").is_some() {
            let request = SourcePreviewRequest::from_params(params);
            let pending = self.prepare_source_preview(params, &request)?;
            return request.encode(&pending.finish()?);
        }
        let include_pixels = bool_at(params, &["include_pixels"]).unwrap_or(false);
        let max_dim = number_at(params, &["max_dim"])
            .map(|value| value.round().clamp(0.0, 4096.0) as u32)
            .unwrap_or(0);
        self.render_frame_snapshot_texture(params)?;
        let snapshot = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let snapshot = renderer.frame_snapshot_scaled(include_pixels, max_dim)?;
            renderer.poll_gpu_timing();
            snapshot
        };
        self.refresh_renderer_timing_stats();
        self.note_frame_snapshot(&snapshot);
        Ok(snapshot)
    }

    // Compiled everywhere. It used to be macOS/Windows only because it read
    // the shared-texture export, so on Linux stream_output_frame did not
    // exist, every recording's encoder job was cancelled on its first frame,
    // and REC left a 261-byte MP4 with no frames in it. The readback itself is
    // plain wgpu; only the texture it reads differs by platform.
    pub(crate) fn start_live_capture(&mut self, req: &RpcRequest) -> Result<(), String> {
        let path = if req.method == "export_frame_snapshot" {
            Some(string_at(&req.params, &["path"]).or_else(|| string_at(&req.params, &["file_path"]))
                .or_else(|| string_at(&req.params, &["output_path"]))
                .ok_or_else(|| "export_frame_snapshot requires path".to_string())?)
        } else { None };
        let sink = if req.method == "stream_output_frame" {
            let port = req.params.get("port").and_then(Value::as_u64).filter(|p| *p > 0 && *p <= 65535).ok_or("invalid frame stream port")? as u16;
            let token = req.params.get("token").and_then(Value::as_str).filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())).ok_or("invalid frame stream token")?.to_string();
            let copies = req.params.get("copies").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= 120).ok_or("invalid frame repetition count")?;
            Some((port, token, copies))
        } else { None };
        let include_pixels = path.is_none() && bool_at(&req.params, &["include_pixels"])
            .or_else(|| bool_at(&req.params, &["pixels"])).unwrap_or(false);
        let format = string_at(&req.params, &["format"]).or_else(|| string_at(&req.params, &["storage_format"]))
            .unwrap_or_else(|| "raw-texture".to_string()).to_ascii_lowercase();
        if !matches!(format.as_str(), "raw" | "raw-texture" | "raw-rgba" | "raw-rgba8" | "rgba" | "rgba8") {
            return Err("unsupported frame snapshot export format".to_string());
        }
        // Diagnostic polling must not take the recording/export slot.
        let busy = if path.is_some() || sink.is_some() { &LIVE_CAPTURE_BUSY } else { &LIVE_DIAGNOSTIC_BUSY };
        if busy.swap(true, Ordering::AcqRel) { return Err("live readback busy; drop this capture frame".to_string()); }
        let permit = LiveCapturePermit(busy);
        let renderer = self.renderer.as_ref().ok_or_else(|| "native renderer unavailable".to_string())?;
        // Which shared texture to read: the program output (default), the
        // recording target (one layer / transparent composition) or one
        // Screen's slice output. export_frame_snapshot names it in `source`,
        // stream_output_frame in `capture_source`.
        let capture_source = if req.method == "export_frame_snapshot" {
            string_at(&req.params, &["source"])
        } else {
            string_at(&req.params, &["capture_source"])
        }.unwrap_or_else(|| "output".to_string());
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let (texture, format, width, height, export_frame, alpha_mode, render_source) = {
            let (export, alpha_mode, render_source) = match capture_source.as_str() {
                "record_target" => {
                    let target = renderer.record_target.as_ref().ok_or_else(|| "record target is not rendering".to_string())?;
                    (&target.export, if target.alpha { "straight" } else { "opaque" }, "core-record-target")
                }
                source if source.starts_with("slice:") => {
                    let id = &source["slice:".len()..];
                    let target = renderer.slice_targets.get(id).ok_or_else(|| format!("screen output {id} is not rendering"))?;
                    (&target.export, "opaque", "core-slice-output")
                }
                _ => (renderer.output_export.as_ref().ok_or_else(|| "output export unavailable".to_string())?, "opaque", "core-output-composite"),
            };
            (&export.texture, export.format, export.width, export.height, export.frame, alpha_mode, render_source)
        };
        // No shared-texture export here, but the export on the other platforms
        // is only a blit of this very texture (refresh_output_export), so read
        // the composite directly. Layer and Screen targets are built on the
        // export, so only the program output is recordable on this platform.
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let (texture, format, width, height, export_frame, alpha_mode, render_source) = {
            if let Some(id) = capture_source.strip_prefix("slice:") {
                let target = renderer.slice_targets.get(id).ok_or_else(|| format!("screen output {id} is not rendering"))?;
                (&target._render_texture, renderer.config.format, target.width, target.height,
                    target.frame, "opaque", "core-slice-output")
            } else if capture_source.eq_ignore_ascii_case("output") {
                (&renderer.output_mirror_texture, renderer.config.format, renderer.config.width, renderer.config.height,
                    renderer.creative_frame_index as u64, "opaque", "core-output-mirror")
            } else {
                return Err(format!("recording `{capture_source}` needs a shared-texture export, which this platform does not have"));
            }
        };
        if sink.is_some() && (req.params.get("width").and_then(Value::as_u64) != Some(width as u64)
            || req.params.get("height").and_then(Value::as_u64) != Some(height as u64)) {
            return Err("recording dimensions differ from native output".to_string());
        }
        // The encoder is told the pipe carries BGRA. The export is always
        // BGRA, but the composite is the swapchain format, which some drivers
        // make RGBA; red and blue would trade places in the file.
        let swizzle_to_bgra = matches!(format, wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Rgba8UnormSrgb);
        // Copy is enqueued now, preserving the requested frame while mapping,
        // metrics and storage execute away from the presentation loop.
        let pending = prepare_texture_readback(&renderer.device, &renderer.queue, texture,
            format, width, height, "Live capture")?;
        let response_tx = self.response_tx.clone();
        let id = req.id;
        let frame_index = self.native_frame_index();
        let time = self.render_clock_time;
        thread::spawn(move || {
            let _permit = permit;
            let result = (|| -> Result<Value, String> {
                let mut frame = pending.finish()?;
                if swizzle_to_bgra {
                    for px in frame.pixels.chunks_exact_mut(4) { px.swap(0, 2); }
                }
                let mut value = frame.to_json(include_pixels);
                // A straight-alpha target may be transparent on purpose.
                value["alpha_mode"] = json!(alpha_mode);
                if let Some((port, token, copies)) = sink {
                    send_to_frame_stream(port, &token, &frame.pixels, copies)?;
                    value["bytes_written"] = json!(frame.pixels.len());
                    value["storage_format"] = json!("raw-texture");
                    value["transport"] = json!("native-binary-stream");
                } else if let Some(path) = path {
                    let target = Path::new(&path);
                    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::write(target, &frame.pixels).map_err(|e| e.to_string())?;
                    value["path"] = json!(path);
                    value["bytes_written"] = json!(frame.pixels.len());
                    value["storage_format"] = json!("raw-texture");
                    value["frame_index"] = json!(frame_index);
                    value["time_seconds"] = json!(time);
                } else {
                    value["source"] = json!("output-shared-texture-export");
                    value["color_space"] = json!("srgb");
                    value["storage_format"] = json!("bgra8unorm");
                    value["storage_encoding"] = json!("srgb-encoded-bgra8unorm");
                    value["alpha_mode"] = json!(alpha_mode);
                    value["premultiplied_alpha"] = json!(false);
                    value["single_render_source"] = json!(render_source);
                    value["zero_conversions"] = json!(true);
                    value["export_frame"] = json!(export_frame);
                }
                Ok(value)
            })();
            drop(_permit);
            if id != 0 {
                let reply = match result { Ok(result) => json!({"id":id,"ok":true,"result":result}),
                    Err(error) => json!({"id":id,"ok":false,"error":error}) };
                let _ = response_tx.send(reply.to_string());
            }
        });
        Ok(())
    }

    pub(crate) fn export_frame_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        // An offline render's frame goes straight to the encoder through the
        // main process's frame sink; otherwise it is written to `path`.
        let stream = frame_stream_params(params)?;
        let output_path = string_at(params, &["path"])
            .or_else(|| string_at(params, &["file_path"]))
            .or_else(|| string_at(params, &["output_path"]));
        if stream.is_none() && output_path.is_none() {
            return Err("export_frame_snapshot requires path".to_string());
        }
        let storage_format = string_at(params, &["format"])
            .or_else(|| string_at(params, &["storage_format"]))
            .unwrap_or_else(|| "raw-texture".to_string())
            .to_ascii_lowercase();
        if !matches!(
            storage_format.as_str(),
            "raw" | "raw-texture" | "raw-rgba" | "raw-rgba8" | "rgba" | "rgba8"
        ) {
            return Err(format!(
                "unsupported frame snapshot export format '{storage_format}'; expected raw-texture"
            ));
        }
        // source: "output" reads the ALREADY-RENDERED output export texture
        // instead of re-rendering the scene into the snapshot target — live
        // REC uses this so each captured frame costs one readback, not a
        // second full composite pass (which visibly dropped the live fps).
        let use_output_export = string_at(params, &["source"])
            .map(|value| value.eq_ignore_ascii_case("output"))
            .unwrap_or(false);
        let (snapshot_time, snapshot_frame_index) = if use_output_export {
            (self.render_clock_time, self.native_frame_index())
        } else {
            let (clock, frame) = self.snapshot_clock_from_params(params);
            self.settle_manual_video_frames(clock)?;
            self.step_manual_snapshot_frame(params, clock, frame)?;
            self.render_frame_snapshot_texture(params)?
        };
        let (mut snapshot, pixels) = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let readback = if use_output_export {
                renderer.read_output_export_frame()?
            } else {
                renderer.read_frame_snapshot()?
            };
            let snapshot = readback.to_json(false);
            renderer.poll_gpu_timing();
            (snapshot, readback.pixels)
        };
        self.refresh_renderer_timing_stats();
        self.note_frame_snapshot(&snapshot);

        if let Some((port, token)) = stream.as_ref() {
            // The sink takes exactly one frame of the encoder's size: a frame
            // of any other size is refused before a byte is sent.
            if let Some(expected) = params.get("stream_bytes").and_then(Value::as_u64)
                && expected != pixels.len() as u64
            {
                return Err(format!("frame has {} bytes; the encoder takes {expected}", pixels.len()));
            }
            send_to_frame_stream(*port, token, &pixels, 1)?;
        } else if let Some(output_path) = output_path.as_ref() {
            let path = Path::new(output_path);
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
            {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::write(path, &pixels).map_err(|err| err.to_string())?;
        }

        if let Some(object) = snapshot.as_object_mut() {
            match (stream.is_some(), output_path) {
                (true, _) => { object.insert("transport".to_string(), json!("native-binary-stream")); }
                (false, Some(path)) => { object.insert("path".to_string(), Value::String(path)); }
                (false, None) => {}
            }
            object.insert("bytes_written".to_string(), json!(pixels.len()));
            object.insert(
                "storage_format".to_string(),
                Value::String("raw-texture".to_string()),
            );
            object.insert("frame_index".to_string(), json!(snapshot_frame_index));
            object.insert(
                "time_seconds".to_string(),
                snapshot_time.map_or(Value::Null, |time| json!(time)),
            );
            // What the render checks a frame by, instead of how dark it is (a
            // show may be black on purpose): the core drew this frame itself
            // (an opaque output, never transparent), on which clock, from how
            // many layers.
            object.insert("drawn".to_string(), json!(!use_output_export));
            object.insert("alpha_mode".to_string(), json!("opaque"));
            object.insert("render_clock".to_string(), json!(self.render_clock_mode));
            object.insert("layers".to_string(), json!(self.scene_layers.len()));
            if !use_output_export && self.render_clock_mode == "manual" {
                object.insert("videos".to_string(), Value::Array(self.manual_video_report.clone()));
            }
        }
        Ok(snapshot)
    }
}

impl RenderState {
    /// Snapshot readback downscaled so the longest edge is `max_dim`.
    /// GPU-side blit before readback: a 1080p frame at max_dim=512 reads
    /// back ~590KB instead of ~8MB, which is what makes a continuous
    /// composite mirror affordable over the JSON transport.
    pub(crate) fn read_frame_snapshot_scaled(&mut self, max_dim: u32) -> Result<FrameSnapshotReadback, String> {
        // At full size the plain read also records the frame metrics.
        if max_dim == 0 || (self.config.width.max(1) <= max_dim && self.config.height.max(1) <= max_dim) {
            return self.read_frame_snapshot();
        }
        self.prepare_frame_snapshot_scaled(max_dim, false)?.finish()
    }

    pub(crate) fn prepare_frame_snapshot_scaled(&mut self, max_dim: u32, live_output: bool) -> Result<PendingFrameReadback, String> {
        let out_w = self.config.width.max(1);
        let out_h = self.config.height.max(1);
        if max_dim == 0 || (out_w <= max_dim && out_h <= max_dim) {
            let texture = if live_output { &self.output_mirror_texture } else { &self.snapshot_texture };
            return prepare_texture_readback(&self.device, &self.queue, texture,
                self.config.format, out_w, out_h, "Ghost Composite Preview");
        }
        let scale = max_dim as f32 / out_w.max(out_h) as f32;
        let w = ((out_w as f32 * scale).round() as u32).clamp(1, out_w);
        let h = ((out_h as f32 * scale).round() as u32).clamp(1, out_h);
        let needs_new = !matches!(&self.snapshot_preview, Some((_, _, pw, ph)) if *pw == w && *ph == h);
        if needs_new {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Ghost Snapshot Preview Target"),
                size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.config.format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let blitter = TextureBlitterBuilder::new(&self.device, self.config.format).build();
            self.snapshot_preview = Some((texture, blitter, w, h));
        }
        {
            let (texture, blitter, _, _) = self.snapshot_preview.as_ref().expect("snapshot preview just ensured");
            let source = if live_output { &self.output_mirror_texture } else { &self.snapshot_texture };
            let src_view = source.create_view(&wgpu::TextureViewDescriptor::default());
            let dst_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Snapshot Preview Blit"),
            });
            blitter.copy(&self.device, &mut encoder, &src_view, &dst_view);
            churn_probe::submit(&self.queue, Some(encoder.finish()));
        }
        let (texture, _, w, h) = self.snapshot_preview.as_ref().expect("snapshot preview present");
        prepare_texture_readback(
            &self.device,
            &self.queue,
            texture,
            self.config.format,
            *w,
            *h,
            "Ghost Snapshot Preview",
        )
    }

    // Read only the raw source, before layer crop/warp/FX. Reuse bounded
    // GPU targets and downsample before the modal's occasional readback.
    /// Copy one source frame slot, scaled to the preview size, into a readback
    /// buffer. Returns as soon as the copy is queued; `finish()` waits for it.
    pub(crate) fn prepare_source_crop_readback(&mut self, slot: usize, rect: [f32; 4], request: &SourcePreviewRequest) -> Result<PendingFrameReadback, String> {
        let source = self.slots.slot(slot);
        let (size_x, size_y) = (source.width, source.height);
        let x = ((rect[0] * size_x as f32).round().max(0.0) as u32).min(size_x - 1);
        let y = ((rect[1] * size_y as f32).round().max(0.0) as u32).min(size_y - 1);
        let width = ((rect[2] * size_x as f32).round() as u32).clamp(1, size_x - x);
        let height = ((rect[3] * size_y as f32).round() as u32).clamp(1, size_y - y);
        let (w, h) = request.target_size(width, height);
        if !matches!(&self.source_crop_preview, Some((raw, _, _, sw, sh, pw, ph)) if (*sw,*sh,*pw,*ph)==(width,height,w,h) && raw.format() == self.source_frame_format) {
            let make = |label, width, height, format, usage| self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label), size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
                format, usage, view_formats: &[],
            });
            let raw = make("Crop source", width, height, self.source_frame_format,
                wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING);
            let target = make("Crop preview", w, h, wgpu::TextureFormat::Rgba8Unorm,
                wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC);
            // The preview is smaller than the source: filter, do not point-sample.
            let blitter = TextureBlitterBuilder::new(&self.device, wgpu::TextureFormat::Rgba8Unorm)
                .sample_type(wgpu::FilterMode::Linear).build();
            self.source_crop_preview = Some((raw, target, blitter, width, height, w, h));
        }
        let (raw, target, blitter, _, _, _, _) = self.source_crop_preview.as_ref().unwrap();
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("Crop preview") });
        encoder.copy_texture_to_texture(
            source.copy_info_at(0, x, y),
            raw.as_image_copy(), wgpu::Extent3d { width, height, depth_or_array_layers: 1 });
        blitter.copy(&self.device, &mut encoder, &raw.create_view(&Default::default()), &target.create_view(&Default::default()));
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        prepare_texture_readback(&self.device, &self.queue, target, wgpu::TextureFormat::Rgba8Unorm, w, h, "Crop preview")
    }

    pub(crate) fn read_frame_snapshot(&mut self) -> Result<FrameSnapshotReadback, String> {
        let readback = read_texture_to_frame(
            &self.device,
            &self.queue,
            &self.snapshot_texture,
            self.config.format,
            self.config.width.max(1),
            self.config.height.max(1),
            "Ghost Render Core Snapshot",
        )?;
        self.last_frame_metrics = Some(readback.metrics.clone());
        Ok(readback)
    }

    pub(crate) fn frame_snapshot(&mut self, include_pixels: bool) -> Result<Value, String> {
        self.frame_snapshot_scaled(include_pixels, 0)
    }

    pub(crate) fn frame_snapshot_scaled(&mut self, include_pixels: bool, max_dim: u32) -> Result<Value, String> {
        let readback = self.read_frame_snapshot_scaled(max_dim)?;
        Ok(readback.to_json(include_pixels))
    }
}
