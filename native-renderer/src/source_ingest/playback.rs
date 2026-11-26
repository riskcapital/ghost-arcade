//! Media playback against the clock: phase and link updates, clip audio, and
//! the manual (offline export) clock.

use crate::*;

impl App {
    pub(crate) fn apply_media_source_phase(&mut self, command: &Value) {
        let Some(id) = string_at(command, &["source_id"]) else { return; };
        if bool_at(command, &["enabled"]) == Some(false) { self.link_phase_anchors.remove(&id); return; }
        if self.render_clock_mode != "live" { return; }
        let Some(media) = self.media_sources.get(&id) else { return; };
        if !bool_at(command, &["native_tick"]).unwrap_or(false) {
            if string_at(command, &["clock"]).as_deref() == Some("link") {
                self.link_phase_anchors.insert(id.clone(), command.clone());
            } else { self.link_phase_anchors.remove(&id); }
        }
        if media.paused || !media.loop_enabled || media.source_type != "video"
            || string_at(command, &["uri"]).as_deref() != Some(media.uri.as_str())
            || number_at(command, &["seek_generation"]) != Some(media.seek_generation as f64) { return; }
        let Some(duration) = media.duration_seconds else { return; };
        let span = duration * (media.trim_end - media.trim_start);
        if span <= 0.0 { return; }
        let Some(target_time) = number_at(command, &["time_seconds"]).filter(|n| n.is_finite()) else { return; };
        let Some(session) = self.native_video_streams.get_mut(&id) else { return; };
        if !session.playing || session.seek_generation != media.seek_generation { return; }
        let Some(elapsed) = session.stream.elapsed_source_seconds() else { return; };
        let lo = duration * media.trim_start;
        let cycle = span * if media.bounce_enabled { 2.0 } else { 1.0 };
        let actual = video_phase::phase_position(session.start_time_seconds, lo, span,
            session.start_reverse, media.bounce_enabled) + elapsed;
        let target = video_phase::phase_position(target_time, lo, span,
            bool_at(command, &["reverse"]).unwrap_or(media.playback_rate < 0.0), media.bounce_enabled);
        let error = video_phase::phase_error(target, actual, cycle);
        let rate = media.playback_rate * video_phase::correction(error, media.playback_rate);
        if session.stream.retime_hardware_clock(rate) {
            session.phase_until = Some(Instant::now() + Duration::from_millis(500));
            session.phase_error_seconds = Some(error);
        }
    }

    /// Recompute Link phase on the native pump even while the frontend is busy.
    pub(crate) fn refresh_link_phase(&mut self) {
        if self.render_clock_mode != "live" { return; }
        let Some((beat, tempo, at)) = self.link_clock else { return; };
        if at.elapsed() > Duration::from_millis(500) { return; }
        let beat = beat + at.elapsed().as_secs_f64() * tempo / 60.0;
        let anchors: Vec<_> = self.link_phase_anchors.iter().map(|(id, v)| (id.clone(), v.clone())).collect();
        for (id, anchor) in anchors {
            let Some(media) = self.media_sources.get_mut(&id) else { self.link_phase_anchors.remove(&id); continue; };
            if media.paused || !media.loop_enabled || number_at(&anchor, &["seek_generation"]) != Some(media.seek_generation as f64)
                || string_at(&anchor, &["uri"]).as_deref() != Some(media.uri.as_str()) { self.link_phase_anchors.remove(&id); continue; }
            let (Some(duration), Some(anchor_beat), Some(beats), Some(time)) = (media.duration_seconds,
                number_at(&anchor, &["beat_position"]), number_at(&anchor, &["beats_per_cycle"]), number_at(&anchor, &["time_seconds"])) else { continue; };
            let lo = duration * media.trim_start;
            let span = duration * (media.trim_end - media.trim_start);
            let cycle = span * if media.bounce_enabled { 2.0 } else { 1.0 };
            if span <= 0.0 || beats <= 0.0 { continue; }
            let rate = cycle * tempo / (60.0 * beats);
            if !(0.05..=8.0).contains(&rate) { continue; }
            let reverse = media.playback_rate < 0.0;
            let phase = (video_phase::phase_position(time, lo, span, bool_at(&anchor, &["reverse"]).unwrap_or(reverse), media.bounce_enabled)
                + (beat - anchor_beat) * cycle / beats).rem_euclid(cycle);
            let returning = if media.bounce_enabled { phase >= span } else { reverse };
            media.playback_rate = rate * if reverse { -1.0 } else { 1.0 };
            if let Some(session) = self.native_video_streams.get_mut(&id) { session.transport_rate = media.playback_rate; }
            let command = json!({ "source_id": id, "uri": media.uri, "seek_generation": media.seek_generation,
                "time_seconds": lo + if returning { cycle - phase } else { phase }, "reverse": returning, "native_tick": true });
            self.apply_media_source_phase(&command);
        }
    }

    /// Picture-side state of the transition a voice config points at: the
    /// core's own clock when it exists (exact for scheduled launches), else
    /// the frontend's running flag.
    pub(crate) fn clip_transition_state(clocks: &HashMap<String, Option<transition_clock::TransitionClock>>, transition: &Value, now: Instant) -> (clip_audio::FadeRole, f64, bool, Option<f64>) {
        let role = if string_at(transition, &["role"]).as_deref() == Some("out") { clip_audio::FadeRole::Out } else { clip_audio::FadeRole::In };
        let duration = number_at(transition, &["duration"]).filter(|d| d.is_finite()).unwrap_or(0.0).clamp(0.0, 10.0);
        let progress = transition.get("token").and_then(Value::as_u64)
            .and_then(|token| clocks.values().flatten().find(|clock| clock.token() == token).map(|clock| clock.progress(now)));
        (role, duration, progress.is_some() || bool_at(transition, &["running"]).unwrap_or(false), progress)
    }

    pub(crate) fn refresh_clip_audio(&mut self) {
        if self.clip_audio.is_none() { return; }
        let now = Instant::now();
        let mut voices = Vec::new();
        let mut keep: HashSet<String> = HashSet::new();
        // Rows mid-transition, with the running state and duration their audio follows.
        let mut rows: HashMap<String, (bool, f64)> = HashMap::new();
        if self.running && self.render_clock_mode == "live" {
            for config in self.clip_audio_mix.as_array().into_iter().flatten().take(32) {
                let Some(source_id) = string_at(config, &["source_id"]) else { continue; };
                let id = string_at(config, &["id"]).unwrap_or_else(|| source_id.clone());
                let row = string_at(config, &["row"]).unwrap_or_default();
                let transition = config.get("transition").filter(|t| t.is_object())
                    .map(|transition| Self::clip_transition_state(&self.transition_clocks, transition, now));
                if let Some((_, fade_duration, running, _)) = transition { rows.insert(row.clone(), (running, fade_duration)); }
                // A listed voice without a live source is left to the ghost pass
                // below (its picture may already be a transition snapshot).
                let Some(media) = self.media_sources.get(&source_id) else { continue; };
                let Some(duration) = media.duration_seconds else { continue; };
                let Some(session) = self.native_video_streams.get(&source_id) else { continue; };
                let Some(elapsed) = session.stream.elapsed_source_seconds() else { continue; };
                let lo = duration * media.trim_start;
                let hi = duration * media.trim_end;
                let span = hi - lo;
                if span <= 0.0 { continue; }
                let cycle = span * if media.bounce_enabled { 2.0 } else { 1.0 };
                let origin = video_phase::phase_position(session.start_time_seconds, lo, span, session.start_reverse, media.bounce_enabled);
                let phase = if media.loop_enabled { (origin + elapsed).rem_euclid(cycle) } else { origin + elapsed };
                let reverse = if media.bounce_enabled { phase >= span } else { media.playback_rate < 0.0 };
                let time = lo + if reverse { cycle - phase } else { phase };
                let rate = session.stream.effective_rate().abs() * if reverse { -1.0 } else { 1.0 };
                let gain = number_at(config, &["gain"]).unwrap_or(1.0).clamp(0.0, 1.0) as f32;
                let pan = number_at(config, &["pan"]).unwrap_or(0.0).clamp(-1.0, 1.0) as f32;
                // Audio follows the picture transition: equal-power in/out from
                // the voice's current level, held while the picture waits.
                let level = match transition {
                    Some((role, fade_duration, running, progress)) => {
                        let fade = self.clip_audio_fades.entry(id.clone()).or_insert_with(|| ClipAudioFade {
                            theta: clip_audio::fade_start(role, progress), role, row: row.clone(), at: now, ghost: None });
                        fade.theta = clip_audio::advance_fade(fade.theta, role, fade_duration, running, now.duration_since(fade.at).as_secs_f64());
                        fade.role = role; fade.row = row.clone(); fade.at = now;
                        fade.ghost = Some(ClipAudioGhost { uri: media.uri.clone(), time, rate, lo, hi, looping: media.loop_enabled, bounce: media.bounce_enabled, gain, pan, at: now });
                        keep.insert(id.clone());
                        clip_audio::fade_level(fade.theta)
                    }
                    None => { self.clip_audio_fades.remove(&id); 1.0 }
                };
                voices.push(clip_audio::Voice { id, uri: media.uri.clone(), time, rate, lo, hi,
                    looping: media.loop_enabled, bounce: media.bounce_enabled, gain: gain * level, pan,
                    playing: session.playing && !media.paused });
            }
            // An interrupted fade replaces the outgoing picture with a snapshot
            // and releases its source. Its sound keeps fading out with the row's
            // new transition instead of cutting: a ghost voice on extrapolated time.
            for (id, fade) in self.clip_audio_fades.iter_mut() {
                if keep.contains(id) || fade.role != clip_audio::FadeRole::Out { continue; }
                let (Some(&(running, fade_duration)), Some(ghost)) = (rows.get(&fade.row), fade.ghost.as_ref()) else { continue; };
                fade.theta = clip_audio::advance_fade(fade.theta, clip_audio::FadeRole::Out, fade_duration, running, now.duration_since(fade.at).as_secs_f64());
                fade.at = now;
                let level = clip_audio::fade_level(fade.theta);
                if level <= 0.0001 || now.duration_since(ghost.at).as_secs_f64() > 10.0 { continue; }
                keep.insert(id.clone());
                voices.push(clip_audio::Voice { id: id.clone(), uri: ghost.uri.clone(), time: ghost.time + now.duration_since(ghost.at).as_secs_f64() * ghost.rate,
                    rate: ghost.rate, lo: ghost.lo, hi: ghost.hi, looping: ghost.looping, bounce: ghost.bounce, gain: ghost.gain * level, pan: ghost.pan, playing: true });
            }
        }
        self.clip_audio_fades.retain(|id, _| keep.contains(id));
        if let Some(audio) = self.clip_audio.as_mut() { audio.update(voices); }
    }

    /// Offline export takes the world clock: every playing video restarts
    /// from its launch point at virtual time 0, so frame N of an export
    /// always shows the clip at N/fps and two renders of the same project
    /// match. The live transport is stashed and handed back on exit.
    pub(crate) fn enter_manual_clock_media(&mut self) {
        self.manual_video_readers.clear();
        self.manual_clock_media_stash = Some(self.media_sources.clone());
        for state in self.media_sources.values_mut() {
            if state.source_type != "video" || state.paused { continue; }
            let duration = state.duration_seconds.filter(|duration| *duration > 0.0);
            state.playback_time_seconds = match duration {
                Some(duration) if state.playback_rate < 0.0 => duration * state.trim_end.clamp(0.0, 1.0),
                Some(duration) => duration * state.trim_start.clamp(0.0, 1.0),
                None => 0.0,
            };
            state.clock_time_seconds = 0.0;
        }
    }

    pub(crate) fn leave_manual_clock_media(&mut self) {
        // The render's decoders end with it.
        self.manual_video_readers.clear();
        let Some(stash) = self.manual_clock_media_stash.take() else { return; };
        for (source_id, state) in stash {
            if let Some(current) = self.media_sources.get_mut(&source_id)
                && current.uri == state.uri
            {
                *current = state;
            }
        }
    }

    /// Manual clock only: make every active video source hold the exact
    /// frame for this virtual time before a snapshot reads the composite.
    /// Decodes synchronously (each decode is bounded by the ffmpeg job's
    /// 10 s limit) and caches by exact timestamp, so the export waits for
    /// the right picture instead of capturing whatever the async pump last
    /// uploaded. A frame that cannot be decoded fails the export loudly.
    pub(crate) fn settle_manual_video_frames(&mut self, clock_seconds: Option<f64>) -> Result<u32, String> {
        if self.render_clock_mode != "manual" || self.renderer.is_none() { return Ok(0); }
        let clock = clock_seconds.unwrap_or_else(|| self.native_clock_seconds());
        let (width, height) = self.native_video_decode_dimensions();
        let mut settled = 0u32;
        self.manual_video_report.clear();
        for source_id in self.active_video_source_ids() {
            let Some(state) = self.media_sources.get(&source_id).cloned() else { continue; };
            if state.source_type != "video" || state.seq == 0 { continue; }
            let Some(path) = local_media_path_from_uri(&state.uri) else { continue; };
            let (decode_width, decode_height) =
                (state.decode_width.unwrap_or(width), state.decode_height.unwrap_or(height));
            // The frame live playback would show at this time: the last one
            // that started by then (floor), never the next one.
            let source_fps = self.video_source_fps_for(&path);
            let time_seconds = manual_video_frame_time(state.current_time_seconds(Some(clock)), source_fps);
            self.manual_video_report.push(manual_video_report_entry(&source_id, &state, clock, time_seconds, source_fps));
            let signature = manual_video_frame_signature(&path, decode_width, decode_height, time_seconds)?;
            if self.native_video_frame_signatures.get(&source_id) == Some(&signature)
                && self.source_frames.contains_key(&source_id)
            {
                continue;
            }
            let (frame_width, frame_height, rgba) = match self.cached_native_video_frame(&signature) {
                Some(frame) => frame,
                None => {
                    let frame = match self.read_manual_video_frame(&source_id, &path, decode_width, decode_height, time_seconds) {
                        Some(frame) => frame,
                        None => {
                            // ffmpeg's input seek returns the first frame at or after
                            // the requested time; back off a hair so float rounding
                            // of an exact frame boundary cannot skip to the next one.
                            let seek = (time_seconds - 1.0e-4).max(0.0);
                            self.stats.manual_video_decoder_starts = self.stats.manual_video_decoder_starts.saturating_add(1);
                            decode_native_video_frame_rgba(&path, decode_width, decode_height, seek)
                                .map_err(|err| format!("video frame at {time_seconds:.3}s could not be decoded for export: {err}"))?
                        }
                    };
                    self.stats.native_video_frame_decodes = self.stats.native_video_frame_decodes.saturating_add(1);
                    self.store_native_video_frame_cache(signature.clone(), frame.0, frame.1, &frame.2);
                    frame
                }
            };
            let seq = self.native_frame_index().max(
                self.source_frames.get(&source_id).map_or(1, |frame| frame.seq.saturating_add(1)),
            );
            let uploaded = self.upload_source_frame_pixels(
                source_id.clone(), seq, frame_width, frame_height, &rgba, "native-video-manual-clock", false,
            );
            self.stats.native_video_frame_decode_bytes_uploaded =
                self.stats.native_video_frame_decode_bytes_uploaded.saturating_add(uploaded as u64);
            self.native_video_frame_signatures.insert(source_id, signature);
            settled += 1;
        }
        // A video that stopped playing gives its decoder back.
        if !self.manual_video_readers.is_empty() {
            let active = self.active_video_source_ids();
            self.manual_video_readers.retain(|id, _| active.contains(id));
        }
        Ok(settled)
    }

    /// The frame at `time_seconds` from this source's long-running decoder
    /// (started, or started again at this time, when it cannot get there by
    /// reading on). None: fall back to a one-frame decode (the reader could
    /// not start, or the file ended before this time).
    pub(crate) fn read_manual_video_frame(
        &mut self,
        source_id: &str,
        path: &Path,
        width: usize,
        height: usize,
        time_seconds: f64,
    ) -> Option<(usize, usize, Vec<u8>)> {
        const MAX_READERS: usize = 8;
        let reusable = self
            .manual_video_readers
            .get(source_id)
            .is_some_and(|reader| reader.matches(path, width, height) && reader.can_reach(time_seconds));
        if !reusable {
            self.manual_video_readers.remove(source_id);
            if self.manual_video_readers.len() >= MAX_READERS {
                let victim = self.manual_video_readers.keys().next().cloned();
                if let Some(victim) = victim { self.manual_video_readers.remove(&victim); }
            }
            let seek = (time_seconds - 1.0e-4).max(0.0);
            self.stats.manual_video_decoder_starts = self.stats.manual_video_decoder_starts.saturating_add(1);
            match media_decode::SequentialVideoReader::open(path, width, height, seek) {
                Ok(reader) => { self.manual_video_readers.insert(source_id.to_string(), reader); }
                Err(err) => {
                    self.stats.native_video_frame_decode_last_error = err;
                    return None;
                }
            }
        }
        let reader = self.manual_video_readers.get_mut(source_id)?;
        match reader.frame_at(time_seconds) {
            Ok(Some(frame)) => Some(frame),
            Ok(None) => { self.manual_video_readers.remove(source_id); None }
            Err(err) => {
                self.stats.native_video_frame_decode_last_error = err;
                self.manual_video_readers.remove(source_id);
                None
            }
        }
    }

    pub(crate) fn video_source_fps_for(&mut self, path: &Path) -> Option<f64> {
        if let Some(fps) = self.video_source_fps.get(path) {
            return *fps;
        }
        let fps = media_decode::probe_video_source_fps(path);
        if self.video_source_fps.len() >= 256 {
            self.video_source_fps.clear();
        }
        self.video_source_fps.insert(path.to_path_buf(), fps);
        fps
    }
}
