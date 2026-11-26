//! Native video streams: sessions, priming, eviction and hardware memory.

use crate::*;

impl App {
    pub(crate) fn drain_native_video_streams(&mut self) {
        for id in self.deferred_source_releases.iter().cloned().collect::<Vec<_>>() {
            self.release_media_source_if_orphaned(&id);
        }
        self.sweep_orphan_media_sources(Instant::now());
        self.refresh_link_phase();
        let now = Instant::now();
        let source_ids = self
            .native_video_streams
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut ready = Vec::new();
        let mut errors = Vec::new();
        for source_id in source_ids {
            if self
                .native_video_scrub_requests
                .get(&source_id)
                .is_some_and(|request| request.hold_until > now)
            {
                continue;
            }
            let Some(state) = self.native_video_streams.get_mut(&source_id) else {
                continue;
            };
            if state.phase_until.is_some_and(|deadline| now >= deadline) {
                state.stream.retime_hardware_clock(state.transport_rate);
                state.phase_until = None;
                state.phase_error_seconds = None;
            }
            if state.stream.hardware_fallback() && !state.fallback_counted {
                state.fallback_counted = true;
                self.stats.native_video_hardware_fallbacks += 1;
            }
            if !state.playing || now < state.next_frame_at {
                continue;
            }
            match state.stream.try_pop() {
                Some(Ok(frame)) => {
                    state.seq = state.seq.saturating_add(1);

                    state.last_used_frame = self.stats.frames_presented;
                    state.next_frame_at = if now.saturating_duration_since(state.next_frame_at)
                        > NATIVE_VIDEO_FRAME_INTERVAL.saturating_mul(2)
                    {
                        now + NATIVE_VIDEO_FRAME_INTERVAL
                    } else {
                        state.next_frame_at + NATIVE_VIDEO_FRAME_INTERVAL
                    };
                    ready.push((source_id, state.seq, frame));
                }
                Some(Err(err)) => errors.push(err),
                None => {
                    if state.frames_presented == 0 || state.stream.buffered_frames() > 0 {
                        // A queued frame ahead of the media clock is not starvation.
                        state.next_frame_at = now + Duration::from_millis(2);
                    } else {
                        self.stats.native_video_stream_underflows =
                            self.stats.native_video_stream_underflows.saturating_add(1);
                        state.next_frame_at = now + NATIVE_VIDEO_FRAME_INTERVAL;
                    }
                }
            }
        }
        for err in errors {
            self.stats.native_video_frame_decode_failures = self
                .stats
                .native_video_frame_decode_failures
                .saturating_add(1);
            self.stats.native_video_frame_decode_last_error = err;
        }
        // Each source occurs once in this drain. Its compressed texture can
        // therefore be written now and all HAP conversions submitted together.
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(renderer) = &self.renderer {
            *renderer.hap_upload_batch.lock().unwrap() = Some(NativeHapUploadBatch::default());
        }
        for (source_id, seq, frame) in ready {
            self.present_native_video_frame(&source_id, seq, frame, "native-video-stream");
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(renderer) = &self.renderer { renderer.flush_hap_upload_batch(); }
        self.refresh_clip_audio();
    }

    pub(crate) fn native_video_session_signature(
        state: &NativeMediaSourceState,
        width: usize,
        height: usize,
    ) -> String {
        let duration = state.duration_seconds.unwrap_or(0.0);
        format!(
            "{}:{width}x{height}:{:.6}:{:.6}:{:.6}:{:.6}:{}:{}",
            state.uri,
            if state.bounce_enabled { state.playback_rate.abs() } else { state.playback_rate },
            state.trim_start,
            state.trim_end,
            duration,
            state.loop_enabled,
            state.bounce_enabled,
        )
    }

    pub(crate) fn evict_native_video_session_for(&mut self, playing: bool) -> bool {
        let cap = if playing {
            // A clip fade retains its outgoing decoder until the new picture
            // is ready. Reserve bounded overlap without relaxing the shared
            // decoder memory budget or consuming the armed-session allowance.
            NATIVE_VIDEO_SESSION_MAX_PLAYING + self.native_graph_layers.values()
                .filter(|layer| layer.kind == NativeGraphLayerKind::VjCrossfade
                    && bool_at(&layer.params, &["vjclipTransitionActive"]).unwrap_or(false))
                .count().min(NATIVE_VIDEO_SESSION_MAX_PLAYING)
        } else {
            NATIVE_VIDEO_SESSION_MAX_ARMED
        };
        let count = self
            .native_video_streams
            .values()
            .filter(|state| state.playing == playing)
            .count();
        if count < cap {
            return true;
        }
        if let Some(source_id) = self
            .native_video_streams
            .iter()
            .filter(|(source_id, state)| {
                state.playing == playing
                    && !self.media_source_is_referenced(source_id)
                    && !self.prepared_launch_sources.get(*source_id).is_some_and(|expires| *expires > Instant::now())
            })
            .min_by_key(|(_, state)| state.last_used_frame)
            .map(|(source_id, _)| source_id.clone())
        {
            self.native_video_streams.remove(&source_id);
            // Retiring only the decoder leaves an active transport record.
            // The decode pump walks those records every frame and would
            // immediately recreate this session, evicting another preroll.
            // This churn is especially expensive for Media Foundation.
            self.media_sources.remove(&source_id);
            self.release_source_frame_slot(&source_id);
            self.source_frames.remove(&source_id);
            self.stats.native_video_session_evictions =
                self.stats.native_video_session_evictions.saturating_add(1);
            return true;
        }
        false
    }

    pub(crate) fn ensure_native_video_stream(
        &mut self,
        source_id: &str,
        state: &NativeMediaSourceState,
        fallback_width: usize,
        fallback_height: usize,
        playing: bool,
    ) {
        if state.playback_rate == 0.0 {
            return;
        }
        let Some(path) = local_media_path_from_uri(&state.uri) else {
            self.native_video_streams.remove(source_id);
            return;
        };
        let width = state.decode_width.unwrap_or(fallback_width);
        let height = state.decode_height.unwrap_or(fallback_height);
        let signature = Self::native_video_session_signature(state, width, height);
        // A video on a small slice decodes small. The cap comes from the
        // output size and the slice, the same for every caller, so a session
        // only restarts when its slice grows past what it decodes.
        let full_decode = self.native_video_decode_dimensions();
        let full_edge = full_decode.0.max(full_decode.1);
        let decode_max_edge = native_video_slice_edge_cap(full_decode, self.video_decode_scale(source_id));
        if let Some(session) = self.native_video_streams.get_mut(source_id) {
            if session.signature != signature && session.seek_generation == state.seek_generation {
                let mut previous_rate_state = state.clone();
                previous_rate_state.playback_rate = session.transport_rate;
                if Self::native_video_session_signature(&previous_rate_state, width, height) == session.signature
                    && session.stream.retime_hardware_clock(state.playback_rate) {
                    session.signature = signature.clone();
                    session.transport_rate = state.playback_rate;
                }
            }
        }
        let existing_stream_state = self
            .native_video_streams
            .get(source_id)
            .filter(|stream_state| stream_state.signature == signature
                && !native_video_decode_cap_needs_restart(stream_state.decode_max_edge, decode_max_edge,
                    full_edge, stream_state.decode_may_shrink))
            .map(|stream_state| (stream_state.playing, stream_state.seek_generation));
        // Prefer prepared frames to seeking a running decoder on a retrigger.
        // A column must not wait for three independent hardware seeks when
        // its next generations are already buffered. Unchanged transports
        // retain their current session; cold preparations retain their work.
        if let Some(warm_source_id) = self
            .native_video_streams
            .iter()
            .filter(|(candidate_id, candidate)| {
                existing_stream_state.map_or(true, |(_, generation)| generation != state.seek_generation)
                    && !source_id.starts_with("library:")
                    && candidate_id.starts_with("library:")
                    && !candidate.playing
                    && candidate.signature == signature
                    && !native_video_decode_cap_needs_restart(candidate.decode_max_edge, decode_max_edge, full_edge, false)
                    && (existing_stream_state.is_none() || candidate.stream.buffered_frames() > 0)
                    && (candidate.start_time_seconds - state.playback_time_seconds).abs() < 0.001
            })
            .max_by_key(|(_, candidate)| candidate.stream.buffered_frames())
            .map(|(candidate_id, _)| candidate_id.clone())
            && let Some(mut warm) = self.native_video_streams.remove(&warm_source_id)
        {
            if playing && existing_stream_state.map_or(true, |(was_playing, _)| !was_playing)
                && !self.evict_native_video_session_for(true) {
                self.native_video_streams.insert(warm_source_id, warm);
                self.stats.native_video_frame_decode_last_error = "playing video session limit reached".to_string();
                return;
            }
            warm.playing = playing;
            warm.decode_may_shrink = false;
            warm.seek_generation = state.seek_generation;
            warm.last_used_frame = self.stats.frames_presented;
            warm.next_frame_at = Instant::now();
            warm.triggered_at = playing.then(Instant::now);
            warm.stream.set_playing(playing);
            // Removing only the decoder leaves its library transport record
            // behind; the next pump would resurrect that consumed session.
            self.media_sources.remove(&warm_source_id);
            self.native_video_streams
                .insert(source_id.to_string(), warm);
            return;
        }


        if let Some((was_playing, existing_seek_generation)) = existing_stream_state {
            if existing_seek_generation != state.seek_generation {
                if let Some(session) = self.native_video_streams.get_mut(source_id) {
                    if session.stream.retrigger_with_rate(state.playback_time_seconds, !playing, state.playback_rate) {
                        session.start_time_seconds = state.playback_time_seconds;
                        session.start_reverse = state.playback_rate < 0.0;
                        session.stream.retime_hardware_clock(state.playback_rate);
                        session.phase_until = None;
                        session.phase_error_seconds = None;
                        session.seek_generation = state.seek_generation;
                        session.playing = playing;
                        session.frames_presented = 0;
                        session.next_frame_at = Instant::now();
                        session.triggered_at = playing.then(Instant::now);
                        session.stream.set_playing(playing);
                        return;
                    }
                }
            }
            if existing_seek_generation == state.seek_generation {
                if was_playing != playing {
                    if !self.evict_native_video_session_for(playing) { return; }
                }
                let Some(stream_state) = self.native_video_streams.get_mut(source_id) else {
                    return;
                };
                let was_playing = stream_state.playing;
                stream_state.playing = playing;
                stream_state.last_used_frame = self.stats.frames_presented;
                stream_state.stream.set_playing(playing);
                if playing && !was_playing {
                    stream_state.next_frame_at = Instant::now();
                    stream_state.triggered_at = Some(Instant::now());
                }
                return;
            }
        }
        self.native_video_streams.remove(source_id);

        // Arming under `library:<clip>:g<N>` supersedes every older
        // generation of the same clip. Without this reap, each trigger's
        // replenish stacked another live decoder (`g2`, `g3`, …) — observed
        // as frame rates collapsing the longer a VJ set ran.
        if let Some(base) = source_id
            .strip_prefix("library:")
            .and_then(|rest| rest.rsplit_once(":g").map(|(base, _)| base.to_string()))
        {
            let prefix = format!("library:{base}:g");
            let stale = self
                .native_video_streams
                .keys()
                .filter(|key| key.starts_with(&prefix) && key.as_str() != source_id)
                .cloned()
                .collect::<Vec<_>>();
            for key in stale {
                self.native_video_streams.remove(&key);
                self.media_sources.remove(&key);
                self.release_source_frame_slot(&key);
                self.source_frames.remove(&key);
            }
        }
        // Hard cap on the armed pool: beyond it, paused decode sessions cost
        // more in pump time than a cold start would. Evict the least recently
        // touched armed session first.
        if source_id.starts_with("library:") {
            let mut armed = self
                .native_video_streams
                .iter()
                .filter(|(key, session)| key.starts_with("library:") && !session.playing)
                .map(|(key, session)| (key.clone(), session.last_used_frame))
                .collect::<Vec<_>>();
            if armed.len() >= NATIVE_LIBRARY_SESSION_CAP {
                armed.sort_by_key(|(_, last_used)| *last_used);
                for (key, _) in armed.iter().take(armed.len() + 1 - NATIVE_LIBRARY_SESSION_CAP) {
                    self.native_video_streams.remove(key);
                    self.media_sources.remove(key);
                    self.release_source_frame_slot(key);
                    self.source_frames.remove(key);
                }
            }
        }


        if !self.evict_native_video_session_for(playing) {
            self.stats.native_video_frame_decode_last_error = "video session limit reached; active sessions preserved".to_string();
            return;
        }
        let start_time = state.current_time_seconds(Some(self.native_clock_seconds()));
        // Optional scratch history can yield to this decoder. Estimate only
        // mandatory resident bytes here, so history cannot reject a session
        // before its worker registers the required admission request. The
        // shared atomic budget still charges every retained GPU surface.
        let mut resident: usize = self.native_video_streams.values()
            .map(|s| s.stream.memory_bytes().saturating_sub(s.stream.optional_memory_bytes() as usize)).sum();
        // The budget in force: sized to the GPU unless the user chose one.
        let budget = self.video_memory_budget.limit_bytes() as usize;
        let (decode_width, decode_height) = fit_video_long_edge(
            width.min(u32::MAX as usize) as u32, height.min(u32::MAX as usize) as u32,
            decode_max_edge.map(|edge| edge.min(u32::MAX as usize) as u32));
        let (decode_width, decode_height) = (decode_width as usize, decode_height as usize);
        let frame_bytes = decode_width.clamp(16, 4096).saturating_mul(decode_height.clamp(16, 4096)).saturating_mul(4);
        // Speculative library preroll must never prevent an on-stage clip
        // from starting. Reclaim unused prepared sessions until the new
        // decoder has room for its minimum ring plus producer/consumer.
        while resident.saturating_add(frame_bytes.saturating_mul(4)) > budget {
            let victim = self.native_video_streams.iter()
                .filter(|(id, session)| id.starts_with("library:") && !session.playing
                    && !self.media_source_is_referenced(id))
                .min_by_key(|(_, session)| session.last_used_frame)
                .map(|(id, _)| id.clone());
            let Some(victim) = victim else { break; };
            if let Some(session) = self.native_video_streams.remove(&victim) {
                resident = resident.saturating_sub(session.stream.memory_bytes()
                    .saturating_sub(session.stream.optional_memory_bytes() as usize));
            }
            self.media_sources.remove(&victim);
            self.release_source_frame_slot(&victim);
            self.source_frames.remove(&victim);
            self.stats.native_video_session_evictions =
                self.stats.native_video_session_evictions.saturating_add(1);
        }
        // A shorter preroll ring leaves room to prepare the next hit for
        // every live row. Eight buffered RGBA frames per library entry
        // exhausted the default budget with only a few HD clips. Claimed
        // sessions keep this ring and refill continuously during playback.
        let target_capacity = if playing { 8 } else { 4 };
        let capacity = budget.saturating_sub(resident).checked_div(frame_bytes).unwrap_or(0).saturating_sub(2).min(target_capacity);
        if capacity < 2 {
            self.stats.native_video_frame_decode_last_error = "decoded video session budget exceeded".to_string();
            return;
        }
        let stream = spawn_native_video_stream(
            path,
            decode_width,
            decode_height,
            start_time,
            state.current_playback_rate(Some(self.native_clock_seconds())),
            state.loop_enabled,
            state.bounce_enabled,
            state.duration_seconds,
            state.trim_start,
            state.trim_end,
            capacity,
            self.video_memory_budget.clone(),
            self.renderer.as_ref().is_some_and(|r| r.device.features().contains(wgpu::Features::TEXTURE_COMPRESSION_BC)),
            decode_max_edge.map(|edge| edge.min(u32::MAX as usize) as u32),
            #[cfg(target_os = "windows")]
            self.renderer.as_ref().ok_or_else(|| "Renderer unavailable for hardware video".to_string())
                .and_then(|renderer| renderer.video_device.clone()),
        );
        stream.set_playing(playing);
        self.native_video_streams.insert(
            source_id.to_string(),
            NativeVideoStreamState {
                signature,
                transport_rate: state.playback_rate,
                start_reverse: state.current_playback_rate(Some(self.native_clock_seconds())) < 0.0,
                phase_until: None,
                phase_error_seconds: None,
                start_time_seconds: start_time,
                stream,
                seek_generation: state.seek_generation,
                seq: self
                    .source_frames
                    .get(source_id)
                    .map(|frame| frame.seq)
                    .unwrap_or(0),
                playing,
                next_frame_at: Instant::now(),
                last_used_frame: self.stats.frames_presented,
                frames_presented: 0,
                triggered_at: playing.then(Instant::now),
                fallback_counted: false,
                decode_max_edge,
                decode_may_shrink: !source_id.starts_with("library:"),
            },
        );
        if let Some(session) = self.native_video_streams.get(source_id) {
            session.stream.set_playing(playing);
        }
    }

    pub(crate) fn prime_native_video_source(&mut self, source_id: &str) -> bool {
        let Some(session) = self.native_video_streams.get_mut(source_id) else {
            return self.source_frames.contains_key(source_id);
        };
        let Some(result) = session.stream.try_pop() else {
            return self.source_frames.contains_key(source_id);
        };
        let frame = match result {
            Ok(frame) => frame,
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                return false;
            }
        };
        session.seq = session.seq.saturating_add(1);
        let seq = session.seq;
        self.present_native_video_frame(source_id, seq, frame, "native-video-preroll")
    }

    pub(crate) fn prime_armed_native_video_sources(&mut self) {
        self.prepared_launch_sources.retain(|_, expires| *expires > Instant::now());
        let pending_sources = self
            .pending_media_bindings
            .values()
            .map(|binding| binding.source_id.clone())
            .collect::<HashSet<_>>();
        let visible_sources = self
            .scene_layers
            .values()
            .filter(|layer| layer.visible)
            .filter_map(|layer| layer.source_id.clone())
            .collect::<HashSet<_>>();
        let source_ids = self
            .native_video_streams
            .iter()
            .filter(|(source_id, session)| {
                !session.playing
                    && (!self.source_frames.contains_key(*source_id) || session.frames_presented == 0)
                    && (pending_sources.contains(*source_id)
                        || visible_sources.contains(*source_id)
                        || self.prepared_launch_sources.contains_key(*source_id)
                        || self.launch_scheduler.references_source(source_id))
                    && session.stream.buffered_frames() > 0
            })
            .map(|(source_id, _)| source_id.clone())
            .collect::<Vec<_>>();
        for source_id in source_ids {
            self.prime_native_video_source(&source_id);
        }
    }

    pub(crate) fn reclaim_hardware_video_memory(&mut self) {
        let required_waiting = self.native_video_streams.values()
            .any(|session| session.stream.memory_waiting_bytes() > session.stream.memory_bytes() as u64);
        // Only actual admission pressure interrupts scratch history; a
        // library preload that fits available headroom need not discard it.
        let reclaim_optional = required_waiting || self.video_memory_budget.is_over_limit();
        self.video_memory_budget.set_optional_cache_allowed(!reclaim_optional);
        if reclaim_optional && self.native_video_streams.values()
            .any(|session| session.stream.optional_memory_bytes() > 0)
        {
            // Worker loops first release optional scratch history and unused
            // driver surfaces. Do not evict a prepared clip for those bytes.
            return;
        }
        let waiting: u64 = self.native_video_streams.values()
            .filter(|session| session.playing)
            .map(|session| session.stream.memory_waiting_bytes()
                .saturating_sub(session.stream.memory_bytes() as u64))
            .sum();
        if waiting == 0 { return; }
        // Retired workers/GPU submissions remain atomically charged until
        // completion. Their eventual release is already excluded from this
        // map, so do not evict extra library clips while that release is pending.
        let mut resident: u64 = self.native_video_streams.values()
            .map(|session| session.stream.memory_bytes() as u64).sum();
        while resident.saturating_add(waiting) > self.video_memory_budget.limit_bytes() {
            let victim = self.native_video_streams.iter()
                .filter(|(source_id, session)| source_id.starts_with("library:")
                    && !session.playing && !self.media_source_is_referenced(source_id))
                .min_by_key(|(_, session)| session.last_used_frame)
                .map(|(source_id, _)| source_id.clone());
            let Some(source_id) = victim else { break; };
            if let Some(session) = self.native_video_streams.remove(&source_id) {
                resident = resident.saturating_sub(session.stream.memory_bytes() as u64);
            }
            self.media_sources.remove(&source_id);
            self.release_source_frame_slot(&source_id);
            self.source_frames.remove(&source_id);
            self.stats.native_video_session_evictions = self.stats.native_video_session_evictions.saturating_add(1);
        }
    }

    /// Every media source a visible layer (or a visible graph's input, or a
    /// pending binding) is waiting on — the set the video decode pump admits.
    pub(crate) fn active_video_source_ids(&self) -> Vec<String> {
        let mut active_sources = Vec::new();
        for layer in self.scene_layers.values() {
            if !layer.visible {
                continue;
            }
            // A processed layer displays the effect texture, but its raw
            // video input still needs an advancing decoder. Retaining that
            // source prevents eviction; admitting it here prevents the live
            // pump from demoting it to a paused/prerolled session.
            for source_id in [layer.source_id.as_ref(), layer.effect_input_source_id.as_ref()]
                .into_iter().flatten()
            {
                if !active_sources.contains(source_id) {
                    active_sources.push(source_id.clone());
                }
            }
        }

        // Source-driven GPU shaders display their own graph output, so their
        // input video never appears as a scene layer's source_id. Admit that
        // input to the decode pump while the graph's layer is visible.
        // Otherwise still images work (they upload once), but video sources
        // remain permanently prerolled and the graph samples a frozen frame.
        for graph in self.native_graph_layers.values() {
            if graph.input_source_id.is_empty()
                || !self.scene_layers.get(&graph.layer_id).is_some_and(|layer| layer.visible)
            {
                continue;
            }
            if !active_sources.contains(&graph.input_source_id) {
                active_sources.push(graph.input_source_id.clone());
            }
        }

        // Pending bindings preserve the old visible source until this one is ready.
        // They must participate in decode admission or manual-clock first frames never arrive.
        for binding in self.pending_media_bindings.values() {
            if !active_sources.contains(&binding.source_id) { active_sources.push(binding.source_id.clone()); }
        }
        active_sources
    }
}
