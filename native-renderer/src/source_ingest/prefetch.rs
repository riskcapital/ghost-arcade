//! Media prefetch and the decode capabilities report.

use crate::*;

impl App {
    pub(crate) fn start_timed_video_prefetch(&mut self, req: &RpcRequest) -> Result<(), String> {
        let params = &req.params;
        let source_id = string_at(params, &["source_id"]).or_else(|| string_at(params, &["sourceId"]))
            .ok_or_else(|| "video prefetch requires source_id".to_string())?;
        let uri = string_at(params, &["uri"]).or_else(|| string_at(params, &["src"]))
            .ok_or_else(|| "video prefetch requires uri".to_string())?;
        let path = local_media_path_from_uri(&uri).ok_or_else(|| "video prefetch requires a local file".to_string())?;
        let width = number_at(params, &["decode_width"]).or_else(|| number_at(params, &["decodeWidth"])).or_else(|| number_at(params, &["width"]))
            .unwrap_or(256.0).clamp(16.0, 4096.0) as usize;
        let height = number_at(params, &["decode_height"]).or_else(|| number_at(params, &["decodeHeight"])).or_else(|| number_at(params, &["height"]))
            .unwrap_or(width as f64).clamp(16.0, 4096.0) as usize;
        let explicit = number_at(params, &["time_seconds"]).or_else(|| number_at(params, &["timeSeconds"])).or_else(|| number_at(params, &["time"]));
        let time = explicit.or_else(|| self.media_sources.get(&source_id).map(|state| state.current_time_seconds(Some(self.native_clock_seconds()))))
            .unwrap_or(0.0).clamp(0.0, 3600.0);
        let seq = number_at(params, &["seq"]).unwrap_or(req.id as f64).max(1.0) as u64;
        let extra = number_at(params, &["prefetch_window_frames"]).unwrap_or(0.0).clamp(0.0, 4.0) as u32;
        let fps = number_at(params, &["prefetch_fps"]).unwrap_or(30.0).clamp(1.0, 120.0);
        let signature = native_video_frame_file_signature(&path, width, height, native_video_frame_bucket(time))?;
        // A timestamped preview must not race a stream that is still playing.
        if explicit.is_some() && self.render_clock_mode == "live" {
            self.native_video_streams.remove(&source_id);
            if let Some(state) = self.media_sources.get_mut(&source_id) {
                state.paused = true; state.playback_time_seconds = time; state.seq = 0;
            }
        }
        let mut work = Vec::new();
        for offset in 0..=extra {
            let frame_time = (time + offset as f64 / fps).min(3600.0);
            let bucket = native_video_frame_bucket(frame_time);
            let key = native_video_frame_file_signature(&path, width, height, bucket)?;
            if !self.native_video_frame_cache.contains_key(&key) { work.push((frame_time, bucket, key)); }
        }
        if work.is_empty() {
            self.video_prefetch_versions.remove(&source_id);
            if self.native_video_frame_signatures.get(&source_id) != Some(&signature) || !self.source_frames.contains_key(&source_id) {
                if let Some((w, h, rgba)) = self.cached_native_video_frame(&signature) {
                    let uploaded = self.upload_source_frame_pixels(source_id.clone(), seq, w, h, &rgba, "native-video-frame-cache", false);
                    self.stats.native_video_frame_decode_bytes_uploaded = self.stats.native_video_frame_decode_bytes_uploaded.saturating_add(uploaded as u64);
                    self.native_video_frame_signatures.insert(source_id, signature);
                    self.request_auto_present();
                }
            }
            if req.id != 0 { self.send_ok(req.id, json!(self.status())); }
            return Ok(());
        }
        let reserved_bytes = width as u64 * height as u64 * 4 * (work.len() as u64 + 2);
        if self.video_prefetch_active >= 2 || self.video_prefetch_bytes.saturating_add(reserved_bytes) > 256 * 1024 * 1024 {
            return Err("timestamped video prefetch budget exceeded".to_string());
        }
        self.video_prefetch_active += 1;
        self.video_prefetch_bytes += reserved_bytes;
        self.video_prefetch_versions.insert(source_id.clone(), req.id);
        let proxy = self.event_proxy.clone();
        let id = req.id;
        let deadline = Instant::now() + Duration::from_secs(5);
        thread::spawn(move || {
            let frames = (|| -> Result<Vec<NativeVideoFrameDecodeOutput>, String> {
                let mut frames = Vec::new();
                for (time, bucket, key) in work {
                    if Instant::now() >= deadline { return Err("timestamped video prefetch deadline exceeded".to_string()); }
                    let (width, height, rgba) = decode_native_video_frame_rgba(&path, width, height, time)?;
                    frames.push(NativeVideoFrameDecodeOutput { width, height, rgba, signature: key, frame_bucket: bucket });
                }
                Ok(frames)
            })();
            let _ = proxy.send_event(UserEvent::VideoPrefetched(VideoPrefetchResult { id, source_id, signature, seq, reserved_bytes, deadline, frames }));
        });
        Ok(())
    }

    pub(crate) fn finish_timed_video_prefetch(&mut self, result: VideoPrefetchResult) {
        self.video_prefetch_active = self.video_prefetch_active.saturating_sub(1);
        self.video_prefetch_bytes = self.video_prefetch_bytes.saturating_sub(result.reserved_bytes);
        let current = self.video_prefetch_versions.get(&result.source_id) == Some(&result.id);
        if current { self.video_prefetch_versions.remove(&result.source_id); }
        if !current || Instant::now() >= result.deadline {
            if result.id != 0 { self.send_error(result.id, "timestamped video prefetch expired or superseded".to_string()); }
            return;
        }
        match result.frames {
            Ok(frames) => {
                self.stats.native_video_frame_decodes = self.stats.native_video_frame_decodes.saturating_add(frames.len() as u64);
                for frame in frames { self.store_native_video_frame_cache(frame.signature, frame.width, frame.height, &frame.rgba); }
                if self.native_video_frame_signatures.get(&result.source_id) != Some(&result.signature) {
                    if let Some((w, h, rgba)) = self.cached_native_video_frame(&result.signature) {
                        let uploaded = self.upload_source_frame_pixels(result.source_id.clone(), result.seq, w, h, &rgba, "native-video-frame", false);
                        self.stats.native_video_frame_decode_bytes_uploaded = self.stats.native_video_frame_decode_bytes_uploaded.saturating_add(uploaded as u64);
                        self.native_video_frame_signatures.insert(result.source_id, result.signature);
                        self.request_auto_present();
                    }
                }
                if result.id != 0 { self.send_ok(result.id, json!(self.status())); }
            }
            Err(error) => {
                self.stats.native_video_frame_decode_failures = self.stats.native_video_frame_decode_failures.saturating_add(1);
                self.stats.native_video_frame_decode_last_error = error.clone();
                if result.id != 0 { self.send_error(result.id, error); }
            }
        }
    }

    pub(crate) fn prefetch_media(&mut self, params: &Value) -> Result<Value, String> {
        let source_type = string_at(params, &["source_type"]).unwrap_or_else(|| "none".to_string());
        let source_id = string_at(params, &["source_id"])
            .or_else(|| string_at(params, &["sourceId"]))
            .ok_or_else(|| "native media prefetch requires source_id".to_string())?;
        let uri = string_at(params, &["uri"])
            .or_else(|| string_at(params, &["src"]))
            .ok_or_else(|| "native media prefetch requires uri".to_string())?;
        if source_type == "image" {
            self.decode_native_image_source(&source_id, &uri);
        } else if source_type == "video" {
            // Prefetch is advisory. A delayed scene warm-up must never
            // overwrite a transport command or replace its live decoder.
            if self.native_video_streams.get(&source_id).is_some_and(|s| s.playing)
                || (self.media_sources.get(&source_id).is_some_and(|s| s.seq > 0)
                    && self.media_source_is_referenced(&source_id))
            {
                return Ok(json!(self.status()));
            }
            let width = number_at(params, &["decode_width"])
                .or_else(|| number_at(params, &["decodeWidth"]))
                .or_else(|| number_at(params, &["width"]))
                .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
                .round()
                .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                as usize;
            let height = number_at(params, &["decode_height"])
                .or_else(|| number_at(params, &["decodeHeight"]))
                .or_else(|| number_at(params, &["height"]))
                .unwrap_or(width as f64)
                .round()
                .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                as usize;
            let explicit_time_seconds = number_at(params, &["time_seconds"])
                .or_else(|| number_at(params, &["timeSeconds"]))
                .or_else(|| number_at(params, &["time"]));
            let time_seconds = explicit_time_seconds
                .or_else(|| {
                    self.media_sources.get(&source_id).map(|state| {
                        state.current_time_seconds(Some(self.native_clock_seconds()))
                    })
                })
                .unwrap_or(0.0)
                .clamp(0.0, 3600.0);
            let seq = number_at(params, &["seq"])
                .unwrap_or((time_seconds * 1000.0).round())
                .round()
                .max(1.0) as u64;
            let render_clock_time = self.native_clock_seconds();
            let state = NativeMediaSourceState {
                uri: uri.clone(),
                source_type: "video".to_string(),
                playback_time_seconds: time_seconds,
                seek_generation: number_at(params, &["seek_generation"])
                    .or_else(|| number_at(params, &["seekGeneration"]))
                    .unwrap_or(0.0)
                    .round()
                    .max(0.0) as u64,
                playback_rate: number_at(params, &["playback_rate"])
                    .or_else(|| number_at(params, &["playbackRate"]))
                    .unwrap_or(1.0)
                    .clamp(-16.0, 16.0),
                paused: true,
                loop_enabled: bool_at(params, &["loop_enabled"])
                    .or_else(|| bool_at(params, &["loop"]))
                    .unwrap_or(true),
                bounce_enabled: bool_at(params, &["bounce_enabled"]).unwrap_or(false),
                duration_seconds: number_at(params, &["duration_seconds"])
                    .or_else(|| number_at(params, &["duration"]))
                    .filter(|duration| duration.is_finite() && *duration > 0.0),
                trim_start: number_at(params, &["trim_start"])
                    .or_else(|| number_at(params, &["trimStart"]))
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0),
                trim_end: number_at(params, &["trim_end"])
                    .or_else(|| number_at(params, &["trimEnd"]))
                    .unwrap_or(1.0)
                    .clamp(0.0, 1.0),
                decode_width: Some(width),
                decode_height: Some(height),
                clock_time_seconds: render_clock_time,
                seq,
            };
            self.media_sources.insert(source_id.clone(), state.clone());
            self.ensure_native_video_stream(&source_id, &state, width, height, false);
            // Arming is enqueue-only. Pre-roll fills on the decoder thread and
            // prime_armed_native_video_sources() uploads the first frame the
            // moment it lands; readiness is reported via
            // status.native_video_sessions (state == "prerolled"). Blocking
            // here stalled the command loop — and therefore every layer and
            // every RPC — for up to 3 s per source, which is the cadence
            // collapse documented in NATIVE_VIDEO_HANDOFF_2026-07-14.
        } else {
            return Err(
                "native media prefetch currently supports local static images and timestamped local video frames".to_string(),
            );
        }
        Ok(json!(self.status()))
    }

    pub(crate) fn clear_prefetch_cache(&mut self) -> Value {
        let cleared_source_frame_signatures = self.source_frame_signatures.len();
        self.source_frame_signatures.clear();
        let cleared_native_video_frame_signatures = self.native_video_frame_signatures.len();
        self.native_video_frame_signatures.clear();
        let cleared_native_video_decode_failures = self.native_video_decode_failed.len();
        self.native_video_decode_failed.clear();
        let (cleared_native_video_frame_cache_entries, cleared_native_video_frame_cache_bytes) =
            self.clear_native_video_frame_cache();
        json!({
            "cleared_source_frame_signatures": cleared_source_frame_signatures,
            "cleared_native_video_frame_signatures": cleared_native_video_frame_signatures,
            "cleared_native_video_decode_failures": cleared_native_video_decode_failures,
            "cleared_native_video_frame_cache_entries": cleared_native_video_frame_cache_entries,
            "cleared_native_video_frame_cache_bytes": cleared_native_video_frame_cache_bytes,
            "note": "native image/video-frame prefetch signatures and decoded video-frame cache cleared; resident bound source frames are preserved"
        })
    }

    pub(crate) fn clear_decode_preview_cache(&mut self) -> Value {
        json!({
            "cleared_decode_preview_entries": 0,
            "cleared_decode_preview_bytes": 0,
            "note": "native video decode preview cache is not allocated yet; clear acknowledged for policy symmetry"
        })
    }

    pub(crate) fn decode_capabilities(&self) -> Value {
        json!({
            "schema_version": 1,
            "native_static_image_decode": true,
            "native_static_image_prefetch": true,
            "native_video_frame_decode": true,
            "native_video_frame_prefetch": true,
            "native_video_frame_prefetch_window": true,
            "video_frame_prefetch": true,
            "native_media_source_playback_state": true,
            "native_video_decode_pump": true,
            "native_video_decode_pump_window": true,
            "decode_policy_controls": true,
            "decode_preview_cache_clear": true,
            "media_policy_controls": true,
            "vram_budget_policy": true,
            "vram_budget_enforcement": true,
            "native_media_decode": true,
            "media_prefetch": true,
            "video_decode": true,
            "source_frame_fallback": false,
            "shared_texture_source_frame_upload": cfg!(any(target_os = "macos", target_os = "windows")),
            "shared_texture_upload": self.shared_texture_media_transport_ready(),
            "supported_source_types": ["image", "video"],
            "supported_static_image_extensions": [
                "avif",
                "bmp",
                "gif",
                "jpg",
                "jpeg",
                "png",
                "tga",
                "tif",
                "tiff",
                "webp"
            ],
            "supported_video_extensions": ["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"],
            "notes": [
                "Local still images can decode directly into native source-frame textures.",
                "Local videos can prefetch bounded timestamped frames and adjacent-frame windows into native source-frame textures via FFmpeg.",
                "Visible local video layers decode continuously from the native render/media clock through the decode pump; shared media sources ingest IOSurfaceID handles on macOS and DXGI HANDLEs on Windows."
            ]
        })
    }
}
