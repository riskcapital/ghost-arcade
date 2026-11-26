//! Deck monitors: the per-bank monitor targets and their readbacks.

use crate::*;

/// The deck monitors' texture width a caller may ask for: even, and between a
/// small pane's 240 and a full-HD tile's 1920.
pub(crate) fn deck_monitor_width(requested: u64) -> u32 {
    (requested.clamp(240, 1920) as u32) & !1
}

/// The deck monitors' texture size for the requested width on an output of
/// this shape: the output's aspect at that width, scaled down as a whole when
/// it would be more than 1024 tall (a portrait project), never squashed.
pub(crate) fn deck_monitor_size(width: u32, output: (u32, u32)) -> (u32, u32) {
    const MAX_HEIGHT: u64 = 1024;
    let (out_w, out_h) = (u64::from(output.0.max(1)), u64::from(output.1.max(1)));
    let width = u64::from(width);
    let height = width * out_h / out_w;
    let (width, height) = if height > MAX_HEIGHT {
        ((MAX_HEIGHT * out_w / out_h) & !1, MAX_HEIGHT)
    } else {
        (width, height)
    };
    (width.max(16) as u32, height.max(16) as u32)
}

impl RenderState {
    /// Lazily (re)create the two deck-monitor targets. Returns false when a
    /// shared-texture export cannot be made where the platform has one
    /// (monitor presentation is then simply unavailable — never an error
    /// path for the main render).
    pub(crate) fn ensure_deck_monitor_targets(&mut self, width: u32, height: u32) -> bool {
        let width = width.clamp(16, 1024);
        let height = height.clamp(16, 1024);
        if let Some(targets) = self.deck_monitor_targets.as_ref() {
            if targets[0].width == width && targets[0].height == height {
                return true;
            }
        }
        let labels: [&'static str; 2] = [
            "Ghost Deck Monitor A Render Target",
            "Ghost Deck Monitor B Render Target",
        ];
        let mut created: Vec<DeckMonitorTarget> = Vec::with_capacity(2);
        for label in labels {
            let (render_texture, render_view) = Self::create_offscreen_target(
                &self.device,
                width,
                height,
                self.config.format,
                label,
            );
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            let export = match Self::create_output_export_target(
                &self.device,
                width,
                height,
                native_output_export_format(self.config.format),
            ) {
                Ok(export) => export,
                Err(err) => {
                    eprintln!("[ghost-core] deck monitor export target failed: {err}");
                    self.deck_monitor_targets = None;
                    return false;
                }
            };
            created.push(DeckMonitorTarget {
                render_texture,
                render_view,
                width,
                height,
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                export,
            });
        }
        let bank_b = created.pop().expect("deck monitor target B");
        let bank_a = created.pop().expect("deck monitor target A");
        self.deck_monitor_targets = Some([bank_a, bank_b]);
        true
    }

    /// Render both deck confidence monitors. Each is one small fullscreen
    /// composite pass over the bank's tagged layers — it samples the same
    /// source frames the program mix uses (no extra source render or decode)
    /// and, where there is one, blits into the bank's shared-texture export.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn render_deck_monitors(
        &mut self,
        command_phase: f32,
        time_seconds: Option<f32>,
        frame_count: u64,
        bank_a: &[LayerGpu],
        bank_b: &[LayerGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        width: u32,
        height: u32,
    ) -> bool {
        if !self.ensure_deck_monitor_targets(width, height) {
            return false;
        }
        for (index, layers) in [bank_a, bank_b].into_iter().enumerate() {
            let key = DECK_MONITOR_VIEWS[index];
            self.write_view_inputs(
                key,
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
                // Deck monitors are cue displays, never the live output:
                // blackout must not blank them.
                1.0,
                &[],
                OutputStage::default(),
            );
            let mut encoder = self.take_outputs_encoder();
            if let Some(target) = self.deck_monitor_targets.as_ref().map(|targets| &targets[index]) {
                self.draw_composite_view(
                    &mut encoder,
                    key,
                    &target.render_view,
                    "Ghost Deck Monitor Pass",
                );
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                target.export.blitter.copy(
                    &self.device,
                    &mut encoder,
                    &target.render_view,
                    &target.export.view,
                );
            }
            self.outputs_encoder = Some(encoder);
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(targets) = self.deck_monitor_targets.as_mut() {
            for target in targets.iter_mut() {
                target.export.frame = target.export.frame.saturating_add(1);
            }
        }
        true
    }

    /// Queue a readback of one deck monitor (0 = bank A, 1 = bank B) for a
    /// panel that cannot import its shared texture. Returns as soon as the
    /// copy is queued; `finish()` waits for it. `None` until the monitors
    /// have been drawn once.
    pub(crate) fn prepare_deck_monitor_readback(&self, bank: usize) -> Result<Option<PendingFrameReadback>, String> {
        let target = if bank == 2 {
            self.dome_view_target.as_ref()
        } else {
            self.deck_monitor_targets.as_ref().and_then(|targets| targets.get(bank))
        };
        let Some(target) = target else {
            return Ok(None);
        };
        prepare_texture_readback(&self.device, &self.queue, &target.render_texture,
            self.config.format, target.width, target.height, "Ghost Deck Monitor Preview").map(Some)
    }

    pub(crate) fn deck_monitor_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            if let Some(targets) = self.deck_monitor_targets.as_ref() {
                let bank = |target: &DeckMonitorTarget, name: &str| {
                    json!({
                        "bank": name,
                        "handle": target.export.surface.id().to_string(),
                        "handle_encoding": "integer",
                        "width": target.export.width,
                        "height": target.export.height,
                        "frame": target.export.frame,
                    })
                };
                return json!({
                    "available": true,
                    "platform": "iosurface",
                    "banks": [bank(&targets[0], "a"), bank(&targets[1], "b")],
                });
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(targets) = self.deck_monitor_targets.as_ref() {
                let bank = |target: &DeckMonitorTarget, name: &str| {
                    json!({
                        "bank": name,
                        "shared_name": target.export.shared_name,
                        "width": target.export.width,
                        "height": target.export.height,
                        "frame": target.export.frame,
                    })
                };
                return json!({
                    "available": true,
                    "platform": "dxgi",
                    "banks": [bank(&targets[0], "a"), bank(&targets[1], "b")],
                });
            }
        }
        json!({ "available": false })
    }
}

impl App {
    /// Layer list for one deck confidence monitor: only the layers tagged for
    /// this bank, rendered at their true pre-crossfader opacity. Samples the
    /// same source frames the program mix uses — no extra source render or
    /// decode, just one more tiny composite pass.
    pub(crate) fn deck_monitor_layer_data(&self, bank: u8) -> Vec<LayerGpu> {
        let mut layers: Vec<&SceneLayer> = self
            .scene_layers
            .values()
            .filter(|layer| layer.deck_monitor_bank == Some(bank))
            .collect();
        layers.sort_by(|a, b| b.z_index.cmp(&a.z_index).then_with(|| a.id.cmp(&b.id)));
        layers
            .into_iter()
            .take(MAX_SCENE_LAYERS)
            .map(|layer| {
                let mut monitor_layer = layer.clone();
                monitor_layer.opacity = layer.deck_monitor_opacity;
                self.with_source_mips(layer, self.with_paint_mask(layer, monitor_layer.gpu()))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deck_monitor_width_is_even_and_bounded() {
        assert_eq!(super::deck_monitor_width(480), 480);
        assert_eq!(super::deck_monitor_width(961), 960);
        assert_eq!(super::deck_monitor_width(10), 240);
        assert_eq!(super::deck_monitor_width(8000), 1920);
    }

    #[test]
    fn deck_monitors_keep_the_output_shape() {
        use super::deck_monitor_size as size;
        assert_eq!(size(960, (1920, 1080)), (960, 540));
        assert_eq!(size(480, (1920, 1080)), (480, 270));
        // Portrait: 960 wide would be 1706 tall, so both come down together.
        assert_eq!(size(960, (1080, 1920)), (576, 1024));
        assert_eq!(size(480, (1080, 1920)), (480, 853));
        // Square at the height limit and an extreme strip stay sane.
        assert_eq!(size(1920, (1000, 1000)), (1024, 1024));
        assert_eq!(size(1920, (100, 4000)), (24, 1024));
        assert_eq!(size(240, (4000, 100)), (240, 16));
    }
}
