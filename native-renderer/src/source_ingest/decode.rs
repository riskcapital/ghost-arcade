//! Image and video frame decodes: queues, scrubs, the frame cache and
//! presenting decoded frames.

use crate::*;

impl App {
    pub(crate) fn decode_native_image_source(&mut self, source_id: &str, uri: &str) {
        let Some(path) = local_media_path_from_uri(uri) else {
            return;
        };
        let signature = match native_image_file_signature(&path) {
            Ok(signature) => signature,
            Err(err) => {
                self.stats.native_image_decode_failures =
                    self.stats.native_image_decode_failures.saturating_add(1);
                self.stats.native_image_decode_last_error = err;
                self.source_frame_signatures.remove(source_id);
                return;
            }
        };
        if self
            .source_frame_signatures
            .get(source_id)
            .is_some_and(|existing| existing == &signature)
            && self.source_frames.contains_key(source_id)
        {
            return;
        }
        let pending_signature = format!("pending:{signature}");
        if self.source_frame_signatures.get(source_id) == Some(&pending_signature) { return; }
        if self.image_decode_queue.len() >= 64 {
            self.stats.native_image_decode_last_error = "image decode queue is full".to_string();
            return;
        }
        self.source_frame_signatures.insert(source_id.to_string(), pending_signature);
        if self.render_clock_mode == "manual" {
            self.image_decode_active += 1;
            self.finish_image_decode(source_id, signature, decode_native_image_rgba(&path));
            return;
        }
        self.image_decode_queue.push_back((source_id.to_string(), signature, path));
        self.pump_image_decodes();
    }

    pub(crate) fn pump_image_decodes(&mut self) {
        while self.image_decode_active < 2 {
            let Some((source_id, signature, path)) = self.image_decode_queue.pop_front() else { break; };
            if self.source_frame_signatures.get(&source_id) != Some(&format!("pending:{signature}")) { continue; }
            self.image_decode_active += 1;
            let proxy = self.event_proxy.clone();
            thread::spawn(move || {
                let result = decode_native_image_rgba(&path);
                let _ = proxy.send_event(UserEvent::NativeImageDecoded(source_id, signature, result));
            });
        }
    }

    pub(crate) fn finish_image_decode(&mut self, source_id: &str, signature: String, result: Result<(usize, usize, Vec<u8>), String>) {
        self.image_decode_active = self.image_decode_active.saturating_sub(1);
        self.pump_image_decodes();
        let waiters = self.image_prefetch_waiters.remove(&(source_id.to_string(), signature.clone())).unwrap_or_default();
        if self.source_frame_signatures.get(source_id) != Some(&format!("pending:{signature}")) {
            for (id, _) in waiters { self.send_error(id, "image prefetch superseded".to_string()); }
            return;
        }
        let decode_error = result.as_ref().err().cloned();
        let existing_seq = self.source_frames.get(source_id).map_or(0, |frame| frame.seq);
        match result {
            Ok((width, height, rgba)) => {
                let uploaded = self.upload_source_frame_pixels(
                    source_id.to_string(),
                    existing_seq.saturating_add(1),
                    width,
                    height,
                    &rgba,
                    "native-image",
                    false,
                );
                self.stats.native_image_decodes = self.stats.native_image_decodes.saturating_add(1);
                self.stats.native_image_decode_bytes_uploaded = self
                    .stats
                    .native_image_decode_bytes_uploaded
                    .saturating_add(uploaded as u64);
                self.stats.native_image_decode_last_error.clear();
                self.source_frame_signatures
                    .insert(source_id.to_string(), signature);
            }
            Err(err) => {
                self.stats.native_image_decode_failures =
                    self.stats.native_image_decode_failures.saturating_add(1);
                self.stats.native_image_decode_last_error = err;
                self.source_frame_signatures.remove(source_id);
            }
        }
        for (id, _) in waiters {
            if let Some(error) = decode_error.as_ref() { self.send_error(id, error.clone()); }
            else { self.send_ok(id, json!(self.status())); }
        }
    }

    pub(crate) fn cached_native_video_frame(&mut self, signature: &str) -> Option<(usize, usize, Vec<u8>)> {
        let entry = self.native_video_frame_cache.get(signature)?;
        let width = entry.width;
        let height = entry.height;
        let rgba = entry.rgba.clone();
        self.native_video_frame_cache_order
            .retain(|key| key != signature);
        self.native_video_frame_cache_order
            .push_back(signature.to_string());
        self.stats.native_video_frame_cache_hits =
            self.stats.native_video_frame_cache_hits.saturating_add(1);
        Some((width, height, rgba))
    }

    pub(crate) fn store_native_video_frame_cache(
        &mut self,
        signature: String,
        width: usize,
        height: usize,
        rgba: &[u8],
    ) {
        let byte_length = rgba.len();
        if byte_length == 0 || byte_length > NATIVE_VIDEO_FRAME_CACHE_MAX_BYTES {
            return;
        }
        if let Some(existing) = self.native_video_frame_cache.remove(&signature) {
            self.native_video_frame_cache_bytes = self
                .native_video_frame_cache_bytes
                .saturating_sub(existing.byte_length);
            self.native_video_frame_cache_order
                .retain(|key| key != &signature);
        }
        self.native_video_frame_cache.insert(
            signature.clone(),
            NativeVideoFrameCacheEntry {
                width,
                height,
                rgba: rgba.to_vec(),
                byte_length,
            },
        );
        self.native_video_frame_cache_order.push_back(signature);
        self.native_video_frame_cache_bytes = self
            .native_video_frame_cache_bytes
            .saturating_add(byte_length);
        while self.native_video_frame_cache_order.len() > NATIVE_VIDEO_FRAME_CACHE_MAX_ENTRIES
            || self.native_video_frame_cache_bytes > NATIVE_VIDEO_FRAME_CACHE_MAX_BYTES
        {
            let Some(oldest) = self.native_video_frame_cache_order.pop_front() else {
                break;
            };
            if let Some(entry) = self.native_video_frame_cache.remove(&oldest) {
                self.native_video_frame_cache_bytes = self
                    .native_video_frame_cache_bytes
                    .saturating_sub(entry.byte_length);
                self.stats.native_video_frame_cache_evictions = self
                    .stats
                    .native_video_frame_cache_evictions
                    .saturating_add(1);
            }
        }
    }

    pub(crate) fn clear_native_video_frame_cache(&mut self) -> (usize, usize) {
        let entries = self.native_video_frame_cache.len();
        let bytes = self.native_video_frame_cache_bytes;
        self.native_video_frame_cache.clear();
        self.native_video_frame_cache_order.clear();
        self.native_video_frame_cache_bytes = 0;
        (entries, bytes)
    }

    pub(crate) fn native_video_decode_dimensions(&self) -> (usize, usize) {
        // A shared slot caps the frame at its edge; a per-source slot holds
        // the frame at its own size up to the per-source limit.
        let renderer_limit = self
            .renderer
            .as_ref()
            .map(|renderer| match renderer.slots.mode() {
                SourceFrameMode::Shared => renderer.source_frame_size,
                SourceFrameMode::PerSource => renderer.slots.max_dimension() as usize,
            })
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT);
        let target = if self.decode_use_output_resolution {
            self.pending_width.max(self.pending_height) as usize
        } else {
            self.decode_preview_size as usize
        };
        let size = target
            .max(64)
            .min(renderer_limit)
            .min(MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
        let output_width = self.pending_width.max(1) as usize;
        let output_height = self.pending_height.max(1) as usize;
        if output_width >= output_height {
            (size, (size * output_height / output_width).max(16))
        } else {
            ((size * output_width / output_height).max(16), size)
        }
    }

    pub(crate) fn record_native_video_presentation(&mut self, source_id: &str, source_time: Option<f64>, source_duration: Option<f64>) {
        if let Some(session) = self.native_video_streams.get_mut(source_id) {
            session.stream.record_presented(source_time, source_duration);
            session.frames_presented += 1;
            if let Some(triggered_at) = session.triggered_at.take() {
                let latency = triggered_at.elapsed().as_micros().min(u64::MAX as u128) as u64;
                self.stats.native_video_trigger_last_latency_us = latency;
                self.stats.native_video_trigger_max_latency_us = self.stats.native_video_trigger_max_latency_us.max(latency);
            }
        }
        if let Some(state) = self.media_sources.get_mut(source_id)
            && state.paused
            && let Some(source_time) = source_time
        {
            state.playback_time_seconds = source_time;
        }
    }

    pub(crate) fn present_native_video_frame(&mut self, source_id: &str, seq: u64,
        frame: NativeVideoStreamFrame, transport: &str) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(gpu) = frame.gpu {
            let slot = match self.assign_source_frame_slot(source_id) {
                Ok(slot) => slot,
                Err(error) => { self.stats.native_video_frame_decode_last_error = error; return false; }
            };
            self.stats.native_video_last_pixel_format = String::from_utf8_lossy(&gpu.pixel_format.to_be_bytes()).into_owned();
            let hap_bytes = match &gpu.storage { hardware_video::FrameStorage::Hap(hap) => hap.blocks.len() as u64, _ => 0 };
            let result = self.renderer.as_ref().ok_or_else(|| "Renderer unavailable".to_string())
                .and_then(|renderer| renderer.import_native_video_frame(slot, gpu, frame.memory_lease));
            let source_rect = match result {
                Ok(rect) => rect,
                Err(error) => {
                    self.stats.native_video_frame_decode_failures += 1;
                    self.stats.native_video_frame_decode_last_error = error;
                    return false;
                }
            };
            self.record_native_video_presentation(source_id, frame.source_time_seconds, frame.source_frame_duration_seconds);
            if hap_bytes > 0 { self.stats.native_video_hap_frames += 1; } else { self.stats.native_video_hardware_frames += 1; }
            self.stats.native_video_frame_decodes += 1;
            self.stats.source_frame_uploads += 1;
            if hap_bytes == 0 { self.stats.source_frame_shared_texture_uploads += 1; }
            self.stats.source_frame_bytes_uploaded = self.stats.source_frame_bytes_uploaded.saturating_add(hap_bytes);
            self.stats.source_frame_input_bytes_uploaded = self.stats.source_frame_input_bytes_uploaded.saturating_add(hap_bytes);
            self.stats.source_frame_last_input_bytes = hap_bytes;
            self.stats.source_frame_last_upload_bytes = hap_bytes;
            self.stats.source_frame_last_upload_width = frame.width as u32;
            self.stats.source_frame_last_upload_height = frame.height as u32;
            self.stats.source_frame_last_upload_transport = if hap_bytes > 0 { "native-video-hap-bc" } else { hardware_video::TRANSPORT }.into();
            self.stats.source_frame_last_reject_reason.clear();
            self.stats.native_video_frame_decode_last_error.clear();
            self.source_frame_signatures.remove(source_id);
            self.native_video_frame_signatures.remove(source_id);
            self.source_frames.insert(source_id.to_string(), SourceFrame::with_rect(seq, source_rect));
            for layer in self.scene_layers.values_mut() {
                if layer.source_id.as_deref() == Some(source_id) {
                    layer.frame_slot = Some(slot);
                    layer.source_rect = source_rect;
                }
            }
            self.commit_pending_media_bindings_for_source(source_id, slot, source_rect);
            return true;
        }
        let uploaded = self.upload_source_frame_pixels(source_id.to_string(), seq,
            frame.width, frame.height, &frame.rgba, transport, false);
        if let Some(session) = self.native_video_streams.get(source_id) { session.stream.recycle(frame.rgba); }
        if uploaded > 0 { self.record_native_video_presentation(source_id, frame.source_time_seconds, frame.source_frame_duration_seconds); }
        self.stats.native_video_software_frames += 1;
        self.stats.native_video_frame_decodes += 1;
        self.stats.native_video_frame_decode_bytes_uploaded += uploaded as u64;
        self.stats.native_video_frame_decode_last_error.clear();
        uploaded > 0
    }

    pub(crate) fn pump_native_video_decodes(&mut self) {
        if self.renderer.is_none() {
            return;
        }
        self.reclaim_hardware_video_memory();
        // An armed session is not ready until its first real frame is resident
        // in the GPU source texture. Keep at least the minimum pre-roll behind
        // it so triggering can immediately drain motion frames.
        self.prime_armed_native_video_sources();
        let (width, height) = self.native_video_decode_dimensions();
        let active_sources = self.active_video_source_ids();
        if self.render_clock_mode == "live" {
            let visible_sources = active_sources.iter().cloned().collect::<HashSet<_>>();
            let source_ids = self.media_sources.keys().cloned().collect::<Vec<_>>();
            for source_id in source_ids {
                let Some(state) = self.media_sources.get(&source_id).cloned() else {
                    continue;
                };
                if state.source_type == "video" && state.seq > 0 {
                    // Splat textures are owned auxiliary sources, not scene-layer bindings.
                    // Their owner explicitly releases them when the texture changes.
                    let playing = (visible_sources.contains(&source_id)
                        || source_id.starts_with("native-splat-video-")) && !state.paused;
                    // The slice's own size is applied inside, to every caller alike.
                    self.ensure_native_video_stream(&source_id, &state, width, height, playing);
                }
            }
            self.drain_native_video_streams();
            return;
        }
        self.native_video_streams.clear();
        if self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT {
            return;
        }

        let mut queued = 0usize;
        for source_id in active_sources {
            if queued >= NATIVE_VIDEO_DECODE_PUMP_PER_TICK
                || self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT
            {
                break;
            }
            let Some(state) = self.media_sources.get(&source_id).cloned() else {
                continue;
            };
            if state.source_type != "video" {
                continue;
            }
            if state.seq == 0 {
                continue;
            }
            let decode_width = state.decode_width.unwrap_or(width);
            let decode_height = state.decode_height.unwrap_or(height);
            if self.queue_native_video_decode_for_state(
                &source_id,
                &state,
                decode_width,
                decode_height,
            ) {
                queued += 1;
            }
        }
    }

    pub(crate) fn queue_native_video_decode_for_state(
        &mut self,
        source_id: &str,
        state: &NativeMediaSourceState,
        width: usize,
        height: usize,
    ) -> bool {
        let Some(path) = local_media_path_from_uri(&state.uri) else {
            return false;
        };
        let time_seconds = state.current_time_seconds(Some(self.native_clock_seconds()));
        let frame_bucket = native_video_frame_bucket(time_seconds);
        let signature = match native_video_frame_file_signature(&path, width, height, frame_bucket)
        {
            Ok(signature) => signature,
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                return false;
            }
        };
        if self
            .native_video_frame_signatures
            .get(source_id)
            .is_some_and(|existing| existing == &signature)
            && self.source_frames.contains_key(source_id)
        {
            return false;
        }
        if self.native_video_decode_failed.contains(&signature) {
            return false;
        }
        let seq = self.native_frame_index().max(
            self.source_frames
                .get(source_id)
                .map(|frame| frame.seq.saturating_add(1))
                .unwrap_or(1),
        );
        if let Some((decoded_width, decoded_height, rgba)) =
            self.cached_native_video_frame(&signature)
        {
            let uploaded = self.upload_source_frame_pixels(
                source_id.to_string(),
                seq,
                decoded_width,
                decoded_height,
                &rgba,
                "native-video-decode-pump-cache",
                false,
            );
            self.stats.native_video_frame_decode_bytes_uploaded = self
                .stats
                .native_video_frame_decode_bytes_uploaded
                .saturating_add(uploaded as u64);
            self.stats.native_video_frame_decode_last_error.clear();
            self.native_video_frame_signatures
                .insert(source_id.to_string(), signature);
            return false;
        }
        if self.native_video_decode_pending.contains(&signature) {
            return false;
        }
        if self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT {
            self.stats.decode_jobs_dropped = self.stats.decode_jobs_dropped.saturating_add(1);
            return false;
        }
        self.stats.native_video_frame_cache_misses =
            self.stats.native_video_frame_cache_misses.saturating_add(1);
        self.native_video_decode_pending.insert(signature.clone());
        self.stats.decode_jobs_submitted = self.stats.decode_jobs_submitted.saturating_add(1);
        self.stats.decode_queue_peak = self
            .stats
            .decode_queue_peak
            .max(self.native_video_decode_pending.len() as u64);
        spawn_native_video_frame_decode(
            self.event_proxy.clone(),
            NativeVideoFrameDecodeJob {
                source_id: source_id.to_string(),
                uri: state.uri.clone(),
                path,
                width,
                height,
                time_seconds,
                frame_bucket,
                pending_key: signature.clone(),
                signature,
                seq,
                exact_preview: false,
            },
        );
        true
    }

    pub(crate) fn queue_native_video_scrub_frame(
        &mut self,
        source_id: &str,
        uri: &str,
        width: usize,
        height: usize,
        time_seconds: f64,
        seq: u64,
    ) {
        self.native_video_scrub_requests.insert(
            source_id.to_string(),
            NativeVideoScrubRequest {
                seq,
                frame_bucket: native_video_frame_bucket(time_seconds),
                uri: uri.to_string(),
                width,
                height,
                time_seconds,
                hold_until: Instant::now() + Duration::from_millis(250),
            },
        );
        self.start_latest_native_video_scrub(source_id);
    }

    pub(crate) fn start_latest_native_video_scrub(&mut self, source_id: &str) {
        if self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT { return; }
        let pending_prefix = format!("scrub:{source_id}:");
        if self
            .native_video_decode_pending
            .iter()
            .any(|key| key.starts_with(&pending_prefix))
        {
            return;
        }
        let Some(request) = self.native_video_scrub_requests.get(source_id).cloned() else {
            return;
        };
        let Some(path) = local_media_path_from_uri(&request.uri) else {
            return;
        };
        let signature = match native_video_frame_file_signature(
            &path,
            request.width,
            request.height,
            request.frame_bucket,
        ) {
            Ok(signature) => signature,
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                return;
            }
        };
        if self.native_video_frame_signatures.get(source_id) == Some(&signature) && self.source_frames.contains_key(source_id) { return; }
        if self.native_video_decode_failed.contains(&signature) { return; }
        let upload_seq = request.seq.max(
            self.source_frames
                .get(source_id)
                .map(|frame| frame.seq.saturating_add(1))
                .unwrap_or(1),
        );
        if let Some((decoded_width, decoded_height, rgba)) =
            self.cached_native_video_frame(&signature)
        {
            let uploaded = self.upload_source_frame_pixels(
                source_id.to_string(),
                upload_seq,
                decoded_width,
                decoded_height,
                &rgba,
                "native-video-scrub-cache",
                false,
            );
            self.stats.native_video_frame_decode_bytes_uploaded = self
                .stats
                .native_video_frame_decode_bytes_uploaded
                .saturating_add(uploaded as u64);
            self.native_video_frame_signatures
                .insert(source_id.to_string(), signature);
            self.request_auto_present();
            return;
        }
        let pending_key = format!("{pending_prefix}{}", request.frame_bucket);
        self.native_video_decode_pending.insert(pending_key.clone());
        self.stats.decode_jobs_submitted = self.stats.decode_jobs_submitted.saturating_add(1);
        self.stats.decode_queue_peak = self
            .stats
            .decode_queue_peak
            .max(self.native_video_decode_pending.len() as u64);
        spawn_native_video_frame_decode(
            self.event_proxy.clone(),
            NativeVideoFrameDecodeJob {
                source_id: source_id.to_string(),
                uri: request.uri,
                path,
                width: request.width,
                height: request.height,
                time_seconds: request.time_seconds,
                frame_bucket: request.frame_bucket,
                signature,
                seq: upload_seq,
                pending_key,
                exact_preview: true,
            },
        );
    }

    pub(crate) fn apply_native_video_decode_result(&mut self, result: NativeVideoFrameDecodeResult) {
        self.native_video_decode_pending.remove(&result.pending_key);
        self.stats.decode_jobs_completed = self.stats.decode_jobs_completed.saturating_add(1);
        let source_id = result.source_id.clone();
        let latest_scrub = result
            .exact_preview
            .then(|| self.native_video_scrub_requests.get(&source_id).cloned())
            .flatten();
        let scrub_result_is_current = latest_scrub
            .as_ref()
            .is_some_and(|request| request.frame_bucket == result.frame_bucket);
        let should_start_next_scrub = result.exact_preview
            && latest_scrub
                .as_ref()
                .is_some_and(|request| request.frame_bucket != result.frame_bucket);
        match result.result {
            Ok(frames) => {
                self.native_video_decode_failed.remove(&result.signature);
                self.stats.native_video_frame_decodes = self
                    .stats
                    .native_video_frame_decodes
                    .saturating_add(frames.len() as u64);
                self.stats.native_video_frame_decode_last_error.clear();
                let current_bucket = if result.exact_preview {
                    result.frame_bucket
                } else {
                    self.media_sources
                        .get(&result.source_id)
                        .map(|state| {
                            native_video_frame_bucket(
                                state.current_time_seconds(Some(self.native_clock_seconds())),
                            )
                        })
                        .unwrap_or(result.frame_bucket)
                };
                let mut upload_frame = None;
                let mut upload_distance = u64::MAX;
                for frame in frames {
                    let distance = frame.frame_bucket.abs_diff(current_bucket);
                    let should_upload = distance < upload_distance;
                    self.store_native_video_frame_cache(
                        frame.signature.clone(),
                        frame.width,
                        frame.height,
                        &frame.rgba,
                    );
                    if should_upload {
                        upload_frame = Some(frame);
                        upload_distance = distance;
                    }
                }
                let source_still_bound = self
                    .media_sources
                    .get(&result.source_id)
                    .is_some_and(|state| state.uri == result.uri && state.source_type == "video");
                if source_still_bound
                    && (!result.exact_preview || scrub_result_is_current)
                    && let Some(frame) = upload_frame
                {
                    let upload_seq = latest_scrub
                        .as_ref()
                        .map(|request| request.seq)
                        .unwrap_or(result.seq)
                        .max(
                            self.source_frames
                                .get(&result.source_id)
                                .map(|source_frame| source_frame.seq.saturating_add(1))
                                .unwrap_or(1),
                        );
                    let uploaded = self.upload_source_frame_pixels(
                        result.source_id.clone(),
                        upload_seq,
                        frame.width,
                        frame.height,
                        &frame.rgba,
                        if result.exact_preview {
                            "native-video-scrub"
                        } else {
                            "native-video-decode-pump"
                        },
                        false,
                    );
                    self.stats.native_video_frame_decode_bytes_uploaded = self
                        .stats
                        .native_video_frame_decode_bytes_uploaded
                        .saturating_add(uploaded as u64);
                    self.native_video_frame_signatures
                        .insert(result.source_id.clone(), frame.signature);
                    self.request_auto_present();
                }
            }
            Err(err) => {
                self.native_video_decode_failed.insert(result.signature);
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
            }
        }
        if should_start_next_scrub {
            self.start_latest_native_video_scrub(&source_id);
        }
        for pending_source in self.native_video_scrub_requests.keys().cloned().collect::<Vec<_>>() {
            if self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT { break; }
            self.start_latest_native_video_scrub(&pending_source);
        }
    }

    pub(crate) fn prefetch_native_video_frame_window(
        &mut self,
        path: &Path,
        width: usize,
        height: usize,
        time_seconds: f64,
        prefetch_window_frames: u32,
        prefetch_fps: f64,
        primary_signature: &str,
    ) {
        let frame_count = prefetch_window_frames.min(NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES);
        if frame_count == 0 {
            return;
        }
        let frame_step = 1.0
            / prefetch_fps.clamp(
                NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS,
                NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS,
            );
        for frame_offset in 1..=frame_count {
            let prefetch_time =
                (time_seconds + frame_step * frame_offset as f64).clamp(0.0, 3600.0);
            let frame_bucket = native_video_frame_bucket(prefetch_time);
            let signature =
                match native_video_frame_file_signature(path, width, height, frame_bucket) {
                    Ok(signature) => signature,
                    Err(_) => continue,
                };
            if signature == primary_signature
                || self.native_video_frame_cache.contains_key(&signature)
            {
                continue;
            }
            self.stats.native_video_frame_cache_misses =
                self.stats.native_video_frame_cache_misses.saturating_add(1);
            let Ok((decoded_width, decoded_height, rgba)) =
                decode_native_video_frame_rgba(path, width, height, prefetch_time)
            else {
                break;
            };
            self.stats.native_video_frame_decodes =
                self.stats.native_video_frame_decodes.saturating_add(1);
            self.store_native_video_frame_cache(signature, decoded_width, decoded_height, &rgba);
        }
    }

    pub(crate) fn decode_native_video_frame_source(
        &mut self,
        source_id: &str,
        uri: &str,
        width: usize,
        height: usize,
        time_seconds: f64,
        seq: u64,
        prefetch_window_frames: u32,
        prefetch_fps: f64,
    ) {
        if self.render_clock_mode == "live"
            && self
                .media_sources
                .values()
                .any(|state| state.source_type == "video" && !state.paused)
        {
            self.stats.video_oneshot_decodes_during_playback = self
                .stats
                .video_oneshot_decodes_during_playback
                .saturating_add(1);
        }
        let Some(path) = local_media_path_from_uri(uri) else {
            return;
        };
        let frame_bucket = native_video_frame_bucket(time_seconds);
        let signature = match native_video_frame_file_signature(&path, width, height, frame_bucket)
        {
            Ok(signature) => signature,
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                self.native_video_frame_signatures.remove(source_id);
                return;
            }
        };
        if self
            .native_video_frame_signatures
            .get(source_id)
            .is_some_and(|existing| existing == &signature)
            && self.source_frames.contains_key(source_id)
        {
            self.prefetch_native_video_frame_window(
                &path,
                width,
                height,
                time_seconds,
                prefetch_window_frames,
                prefetch_fps,
                &signature,
            );
            return;
        }
        let existing_seq = self
            .source_frames
            .get(source_id)
            .map(|frame| frame.seq)
            .unwrap_or(0);
        let upload_seq = seq.max(existing_seq.saturating_add(1));
        if let Some((decoded_width, decoded_height, rgba)) =
            self.cached_native_video_frame(&signature)
        {
            let uploaded = self.upload_source_frame_pixels(
                source_id.to_string(),
                upload_seq,
                decoded_width,
                decoded_height,
                &rgba,
                "native-video-frame-cache",
                false,
            );
            self.stats.native_video_frame_decode_bytes_uploaded = self
                .stats
                .native_video_frame_decode_bytes_uploaded
                .saturating_add(uploaded as u64);
            self.stats.native_video_frame_decode_last_error.clear();
            self.native_video_frame_signatures
                .insert(source_id.to_string(), signature.clone());
            self.prefetch_native_video_frame_window(
                &path,
                width,
                height,
                time_seconds,
                prefetch_window_frames,
                prefetch_fps,
                &signature,
            );
            return;
        }
        self.stats.native_video_frame_cache_misses =
            self.stats.native_video_frame_cache_misses.saturating_add(1);
        match decode_native_video_frame_rgba(&path, width, height, time_seconds) {
            Ok((decoded_width, decoded_height, rgba)) => {
                let uploaded = self.upload_source_frame_pixels(
                    source_id.to_string(),
                    upload_seq,
                    decoded_width,
                    decoded_height,
                    &rgba,
                    "native-video-frame",
                    false,
                );
                self.stats.native_video_frame_decodes =
                    self.stats.native_video_frame_decodes.saturating_add(1);
                self.stats.native_video_frame_decode_bytes_uploaded = self
                    .stats
                    .native_video_frame_decode_bytes_uploaded
                    .saturating_add(uploaded as u64);
                self.stats.native_video_frame_decode_last_error.clear();
                self.store_native_video_frame_cache(
                    signature.clone(),
                    decoded_width,
                    decoded_height,
                    &rgba,
                );
                self.native_video_frame_signatures
                    .insert(source_id.to_string(), signature.clone());
                self.prefetch_native_video_frame_window(
                    &path,
                    width,
                    height,
                    time_seconds,
                    prefetch_window_frames,
                    prefetch_fps,
                    &signature,
                );
            }
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                self.native_video_frame_signatures.remove(source_id);
            }
        }
    }
}
