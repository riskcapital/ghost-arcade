//! Recording: the record target and native recording (macOS and Windows
//! encoders).

use crate::*;

/// Which layers the recording target renders.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum RecordTargetSource {
    /// Every layer, with composition effects: the composition itself, kept
    /// transparent where nothing is drawn.
    Composition,
    /// Mapping layers by id (a VJ clip transition can briefly add a second).
    Layers(Vec<String>),
    /// Every layer on one VJ row, including both sides of a clip transition.
    VjLayer(i32),
}

/// Editor request for a recording of one source, before or instead of the
/// program composite.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RecordTargetSpec {
    pub(crate) source: RecordTargetSource,
    /// Straight alpha out (transparent background). Off: the layer over black.
    pub(crate) alpha: bool,
}

impl RecordTargetSpec {
    pub(crate) fn kind(&self) -> &'static str {
        match self.source {
            RecordTargetSource::Composition => "composition",
            RecordTargetSource::Layers(_) => "layer",
            RecordTargetSource::VjLayer(_) => "vj_layer",
        }
    }

    pub(crate) fn includes(&self, layer: &SceneLayer) -> bool {
        match &self.source {
            RecordTargetSource::Composition => true,
            RecordTargetSource::Layers(ids) => ids.iter().any(|id| *id == layer.id),
            RecordTargetSource::VjLayer(index) => layer.vj_layer_index == Some(*index),
        }
    }
}

/// `set_record_target` params. `kind: "none"` (or no kind) clears it.
pub(crate) fn parse_record_target(params: &Value) -> Result<Option<RecordTargetSpec>, String> {
    let kind = string_at(params, &["kind"]).unwrap_or_default().to_ascii_lowercase();
    let alpha = bool_at(params, &["alpha"]).unwrap_or(false);
    let source = match kind.as_str() {
        "" | "none" | "off" => return Ok(None),
        "composition" => RecordTargetSource::Composition,
        "layer" => {
            let mut ids: Vec<String> = params
                .get("layer_ids")
                .and_then(Value::as_array)
                .map(|ids| ids.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            if let Some(id) = string_at(params, &["layer_id"]) {
                ids.push(id);
            }
            ids.retain(|id| !id.trim().is_empty());
            ids.dedup();
            if ids.is_empty() {
                return Err("record target layer needs layer_id".to_string());
            }
            RecordTargetSource::Layers(ids)
        }
        "vj_layer" => {
            let index = number_at(params, &["vj_layer_index"])
                .filter(|value| value.is_finite() && *value >= 0.0 && *value < 1024.0)
                .ok_or("record target vj_layer needs vj_layer_index")?;
            RecordTargetSource::VjLayer(index.round() as i32)
        }
        other => return Err(format!("unknown record target kind: {other}")),
    };
    Ok(Some(RecordTargetSpec { source, alpha }))
}

impl RenderState {
    /// Start encoding the composite in-core, straight off the output shared
    /// texture. No readback: the recorder opens the same surface the preview
    /// and Spout already read.
    #[cfg(target_os = "windows")]
    pub(crate) fn start_native_recording(
        &mut self,
        path: &std::path::Path,
        fps: u32,
        quality: &str,
    ) -> Result<(u32, u32), String> {
        if self.native_recorder.is_some() {
            return Err("a native recording is already running".into());
        }
        let export = self
            .output_export
            .as_ref()
            .ok_or_else(|| "native recording needs the output shared texture".to_string())?;
        let (width, height) = (export.width, export.height);
        // The encoder needs a D3D11 device on the renderer's own adapter, or
        // Media Foundation picks a software transform and the whole point is
        // lost. WindowsVideoDevice already builds exactly that.
        let worker_device = windows_video_texture::WindowsVideoDevice::new(&self.device)?;
        let worker = worker_device.create_worker()?;
        let encoder = windows_video_encoder::WindowsVideoEncoder::new(
            worker.device(),
            &self.device,
            path,
            width,
            height,
            fps,
            quality,
        )?;
        self.native_recorder = Some(encoder);
        self.native_recorder_error = None;
        Ok((width, height))
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn encode_native_recording_frame(&mut self) {
        let Some(shared_name) = self
            .output_export
            .as_ref()
            .map(|export| export.shared_name.clone())
        else {
            return;
        };
        let Some(recorder) = self.native_recorder.as_mut() else {
            return;
        };
        if let Err(err) = recorder.encode_shared_texture(&shared_name) {
            // Keep rendering: a recording that fails must not take the show
            // down. Stop the session and report it through status.
            self.native_recorder_error = Some(err);
            self.native_recorder = None;
        }
    }

    /// Finalize the MP4 and report how many frames it holds.
    #[cfg(target_os = "windows")]
    pub(crate) fn stop_native_recording(&mut self) -> Result<(u64, f64), String> {
        let mut recorder = self
            .native_recorder
            .take()
            .ok_or_else(|| "no native recording is running".to_string())?;
        // The encoder thread writes what is still queued before finalizing,
        // so the count is only final afterwards.
        recorder.finish()?;
        Ok((recorder.frames_encoded(), recorder.duration_seconds()))
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn start_native_recording(
        &mut self,
        path: &std::path::Path,
        fps: u32,
        quality: &str,
    ) -> Result<(u32, u32), String> {
        if self.native_recorder.is_some() {
            return Err("a native recording is already running".into());
        }
        let export = self
            .output_export
            .as_ref()
            .ok_or_else(|| "native recording needs the output shared texture".to_string())?;
        let (width, height, format) = (export.width, export.height, export.format);
        // A few surfaces so the encoder can still be reading one frame while
        // the GPU fills the next; a frame finding none free is dropped.
        const CAPTURE_SURFACES: usize = 4;
        let slots = (0..CAPTURE_SURFACES)
            .map(|_| {
                Self::create_iosurface_texture(
                    &self.device,
                    width,
                    height,
                    format,
                    "Ghost Render Core Recording Capture",
                    wgpu::TextureUsages::COPY_DST,
                    wgpu::TextureUses::COPY_DST,
                )
                .map(|(surface, texture)| mac_video_recorder::CaptureSlot { surface, texture })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let recorder =
            mac_video_recorder::MacVideoRecorder::new(path, width, height, fps, quality, slots)?;
        self.native_recorder = Some(recorder);
        self.native_recorder_error = None;
        Ok((width, height))
    }

    /// Inside the frame's encoder, after the export has been written: copy
    /// the composite into a capture surface the encoder will own.
    #[cfg(target_os = "macos")]
    pub(crate) fn capture_native_recording_frame(&mut self, encoder: &mut wgpu::CommandEncoder) {
        let (Some(recorder), Some(export)) =
            (self.native_recorder.as_mut(), self.output_export.as_ref())
        else {
            return;
        };
        recorder.capture(encoder, &export.texture, export.width, export.height);
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn encode_native_recording_frame(&mut self) {
        if let Some(recorder) = self.native_recorder.as_mut() {
            recorder.submitted(&self.queue);
        }
        self.drain_native_recording();
    }

    /// Append captures whose GPU work has completed. Runs after each frame
    /// and when a GPU completion arrives, so a take does not wait for the
    /// next render when the scene goes static.
    #[cfg(target_os = "macos")]
    pub(crate) fn drain_native_recording(&mut self) {
        let Some(recorder) = self.native_recorder.as_mut() else {
            return;
        };
        if let Err(err) = recorder.drain_completed() {
            // Keep rendering: a failed recording must not take the show down.
            self.native_recorder_error = Some(err);
            self.native_recorder = None;
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub(crate) fn drain_native_recording(&mut self) {}

    #[cfg(target_os = "macos")]
    pub(crate) fn stop_native_recording(&mut self) -> Result<(u64, f64), String> {
        if self.native_recorder.as_ref().is_some_and(|r| r.has_pending()) {
            // The last captures belong in the take: let the GPU finish them.
            let _ = self.device.poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(Duration::from_secs(2)),
            });
            self.drain_native_recording();
        }
        let mut recorder = self
            .native_recorder
            .take()
            .ok_or_else(|| "no native recording is running".to_string())?;
        let frames = recorder.frames_encoded();
        let duration = recorder.duration_seconds();
        recorder.finish()?;
        Ok((frames, duration))
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn native_recording_state(&self) -> Value {
        json!({
            "available": true,
            "active": self.native_recorder.is_some(),
            "frames": self.native_recorder.as_ref().map(|r| r.frames_encoded()).unwrap_or(0),
            "transport": "iosurface",
            "encoder": "videotoolbox-h264",
            "last_error": self.native_recorder_error.clone(),
        })
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn native_recording_state(&self) -> Value {
        json!({
            "available": true,
            "active": self.native_recorder.is_some(),
            "frames": self.native_recorder.as_ref().map(|r| r.frames_encoded()).unwrap_or(0),
            "transport": "d3d11-shared-texture",
            "encoder": "media-foundation-h264",
            // Frames skipped because the encoder still held every texture,
            // and what recording costs the render thread per frame.
            "dropped": self.native_recorder.as_ref().map(|r| r.frames_dropped()).unwrap_or(0),
            "render_thread_us": self.native_recorder.as_ref().map(|r| {
                let (mean, max) = r.render_thread_us();
                json!({ "mean": mean, "max": max })
            }),
            "last_error": self.native_recorder_error.clone(),
        })
    }

    /// Create (or resize) the recording target and its shared-texture export.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn ensure_record_target(&mut self, width: u32, height: u32, alpha: bool) -> bool {
        if let Some(existing) = self.record_target.as_mut() {
            if existing.export.width == width && existing.export.height == height {
                existing.alpha = alpha;
                return true;
            }
        }
        let (render_texture, render_view) = Self::create_offscreen_target(
            &self.device,
            width,
            height,
            self.config.format,
            "Ghost Record Target Render Target",
        );
        let export = match Self::create_output_export_target(
            &self.device,
            width,
            height,
            native_output_export_format(self.config.format),
        ) {
            Ok(export) => export,
            Err(err) => {
                eprintln!("[ghost-core] record target export failed: {err}");
                self.record_target = None;
                return false;
            }
        };
        self.record_target = Some(RecordOutputTarget {
            _render_texture: render_texture,
            render_view,
            export,
            alpha,
        });
        true
    }

    /// Render the recording target: one fullscreen composite pass over just
    /// the recorded layers, after the program render so every source frame
    /// it samples is already current (no extra decode or source render).
    /// With `alpha` the compositor returns straight colour plus coverage;
    /// without it the layers land over black exactly as a solo would look.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn render_record_target(
        &mut self,
        command_phase: f32,
        time_seconds: Option<f32>,
        frame_count: u64,
        layers: &[LayerGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        post_effects: &[[f32; 4]],
        alpha: bool,
    ) -> bool {
        let (width, height) = (self.config.width, self.config.height);
        if !self.ensure_record_target(width, height, alpha) {
            return false;
        }
        self.write_view_inputs(
            RECORD_TARGET_VIEW,
            (width, height),
            true,
            command_phase,
            layers.len() as u32,
            time_seconds,
            frame_count,
            layers,
            audio0,
            audio1,
            audio2,
            // A recording of a source is not the live output: blackout is
            // the projector kill switch and must not blank the take.
            1.0,
            post_effects,
            record_target_output_stage(alpha),
        );
        let mut encoder = self.take_outputs_encoder();
        if let Some(target) = self.record_target.as_ref() {
            self.draw_composite_view(&mut encoder, RECORD_TARGET_VIEW, &target.render_view, "Ghost Record Target Pass");
            target.export.blitter.copy(&self.device, &mut encoder, &target.render_view, &target.export.view);
        }
        self.outputs_encoder = Some(encoder);
        if let Some(target) = self.record_target.as_mut() {
            target.export.frame = target.export.frame.saturating_add(1);
        }
        true
    }

    /// Shared-texture metadata for the recording target, in the output
    /// export's shape so the main-process recorder reads it the same way.
    pub(crate) fn record_target_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        if let Some(target) = self.record_target.as_ref() {
            return json!({
                "available": true,
                "platform": "iosurface",
                "handle": target.export.surface.id().to_string(),
                "handle_encoding": "integer",
                "width": target.export.width,
                "height": target.export.height,
                "frame": target.export.frame,
                "alpha": target.alpha,
            });
        }
        #[cfg(target_os = "windows")]
        if let Some(target) = self.record_target.as_ref() {
            return json!({
                "available": true,
                "platform": "dxgi",
                "shared_name": target.export.shared_name,
                "width": target.export.width,
                "height": target.export.height,
                "frame": target.export.frame,
                "alpha": target.alpha,
            });
        }
        json!({ "available": false })
    }
}

impl App {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn start_native_recording_rpc(&mut self, params: &Value) -> Result<Value, String> {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "start_native_recording needs a path".to_string())?;
        let fps = params.get("fps").and_then(Value::as_u64).unwrap_or(30) as u32;
        let quality = params
            .get("quality")
            .and_then(Value::as_str)
            .unwrap_or("high");
        let renderer = self
            .renderer
            .as_mut()
            .ok_or_else(|| "native renderer has not created a wgpu device".to_string())?;
        let (width, height) =
            renderer.start_native_recording(std::path::Path::new(path), fps, quality)?;
        Ok(json!({ "started": true, "width": width, "height": height, "fps": fps }))
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn stop_native_recording_rpc(&mut self) -> Result<Value, String> {
        let renderer = self
            .renderer
            .as_mut()
            .ok_or_else(|| "native renderer has not created a wgpu device".to_string())?;
        let (frames, duration_seconds) = renderer.stop_native_recording()?;
        Ok(json!({ "stopped": true, "frames": frames, "duration_seconds": duration_seconds }))
    }

    /// Layer list for the recording target. A layer or VJ row renders on its
    /// own, pre-composite and pre-fader: its blend mode and opacity say how it
    /// meets the layers below, and there are none here, so it records as
    /// Normal at full opacity (hierarchy masks keep their code — they clip
    /// the recorded layers under them). Pre-fader matters for VJ rows: in MIX
    /// the row's carrier layer sits at opacity 0 and the VJ Mix graph applies
    /// the row fader, so a post-fader take of a row would always be empty.
    pub(crate) fn record_target_layer_data(&self, spec: &RecordTargetSpec) -> Vec<LayerGpu> {
        if spec.source == RecordTargetSource::Composition {
            return self.gpu_layer_data();
        }
        let mut layers: Vec<&SceneLayer> = self
            .scene_layers
            .values()
            .filter(|layer| spec.includes(layer))
            .collect();
        layers.sort_by(|a, b| b.z_index.cmp(&a.z_index).then_with(|| a.id.cmp(&b.id)));
        layers
            .into_iter()
            .take(MAX_SCENE_LAYERS)
            .map(|layer| {
                let mut solo = layer.clone();
                solo.opacity = 1.0;
                let mut gpu = solo.gpu();
                if gpu.style[0] != blend_mode_code("hierarchy-mask") {
                    gpu.style[0] = blend_mode_code("normal");
                }
                gpu
            })
            .collect()
    }

    pub(crate) fn apply_record_target(&mut self, params: &Value) -> Result<Value, String> {
        let spec = parse_record_target(params)?;
        if spec.is_some() && !cfg!(any(target_os = "macos", target_os = "windows")) {
            return Err("recording a single source needs the macOS or Windows shared-texture path".to_string());
        }
        self.record_target = spec;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if self.record_target.is_none() {
            // Release the target's VRAM as soon as the recording ends.
            if let Some(renderer) = self.renderer.as_mut() {
                renderer.record_target = None;
            }
        }
        self.pending_render_retry = true;
        Ok(self.record_target_state())
    }

    pub(crate) fn record_target_state(&self) -> Value {
        let mut state = self
            .renderer
            .as_ref()
            .map(RenderState::record_target_metadata)
            .unwrap_or_else(|| json!({ "available": false }));
        if let Some(spec) = self.record_target.as_ref() {
            state["kind"] = json!(spec.kind());
            state["alpha"] = json!(spec.alpha);
            state["layer_count"] = json!(self.scene_layers.values().filter(|layer| spec.includes(layer)).count());
        } else {
            state["kind"] = json!("none");
        }
        state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_target_parses_sources_and_selects_their_layers() {
        use super::{RecordTargetSource, parse_record_target, record_target_output_stage};
        assert_eq!(parse_record_target(&json!({})).unwrap(), None);
        assert_eq!(parse_record_target(&json!({ "kind": "none", "alpha": true })).unwrap(), None);
        let layer = parse_record_target(&json!({ "kind": "layer", "layer_id": "a", "layer_ids": ["b", "b"], "alpha": true }))
            .unwrap()
            .unwrap();
        assert_eq!(layer.source, RecordTargetSource::Layers(vec!["b".to_string(), "a".to_string()]));
        assert!(layer.alpha);
        assert!(parse_record_target(&json!({ "kind": "layer", "layer_ids": [" "] })).is_err());
        assert!(parse_record_target(&json!({ "kind": "vj_layer" })).is_err());
        assert!(parse_record_target(&json!({ "kind": "vj_layer", "vj_layer_index": -1 })).is_err());
        assert!(parse_record_target(&json!({ "kind": "screen" })).is_err());

        let row = parse_record_target(&json!({ "kind": "vj_layer", "vj_layer_index": 3 })).unwrap().unwrap();
        assert!(!row.alpha, "alpha is opt-in");
        let mut on_row = SceneLayer::new("clip-1".to_string(), 0);
        on_row.vj_layer_index = Some(3);
        let mut other_row = SceneLayer::new("clip-2".to_string(), 1);
        other_row.vj_layer_index = Some(1);
        assert!(row.includes(&on_row));
        assert!(!row.includes(&other_row));
        assert!(layer.includes(&SceneLayer::new("a".to_string(), 0)));
        assert!(!layer.includes(&on_row));
        let composition = parse_record_target(&json!({ "kind": "composition", "alpha": true })).unwrap().unwrap();
        assert!(composition.includes(&on_row) && composition.includes(&other_row));

        // Only the alpha pass flips the compositor's straight-alpha switch;
        // everything else is the untransformed composition.
        assert_eq!(record_target_output_stage(true).smask, [0.0, 0.0, 1.0, 0.0]);
        assert_eq!(record_target_output_stage(false).smask, [0.0; 4]);
        assert_eq!(record_target_output_stage(true).out0, [0.0, 0.0, 1.0, 1.0]);
        assert!(super::live_capture_export_source("record_target"));
        assert!(super::live_capture_export_source("slice:screen-2"));
        assert!(!super::live_capture_export_source("scene"));
    }
}
