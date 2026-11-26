//! Source previews: the small pictures of each source the editor shows.

use crate::*;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub(crate) struct PreviewPixel {
    pub(crate) rgba: [f32; 4],
}

#[derive(Clone, Debug)]
pub(crate) struct SourcePreview {
    pub(crate) slot: usize,
    pub(crate) seq: u64,
    pub(crate) pixels: Vec<PreviewPixel>,
}

/// What an editor preview asked for: how big, and how to send it.
///
/// `width`/`height` give the size on screen, so a 16:9 preview is not read
/// back as the square source texture; without them `max_dim` scales the crop
/// uniformly as before. `encoding: "jpeg"` sends a JPEG a twentieth the size
/// of the raw pixels (no alpha: the frame as it looks over black).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SourcePreviewRequest {
    pub(crate) width: Option<u32>,
    pub(crate) height: Option<u32>,
    pub(crate) max_dim: u32,
    pub(crate) jpeg_quality: Option<u8>,
    pub(crate) include_pixels: bool,
}

impl SourcePreviewRequest {
    pub(crate) fn from_params(params: &Value) -> Self {
        let dimension = |key: &str| number_at(params, &[key])
            .filter(|value| value.is_finite() && *value >= 1.0)
            .map(|value| value.round().clamp(16.0, 1024.0) as u32);
        let jpeg = string_at(params, &["encoding"]).is_some_and(|value| value.eq_ignore_ascii_case("jpeg"));
        Self {
            width: dimension("width"),
            height: dimension("height"),
            max_dim: number_at(params, &["max_dim"]).unwrap_or(640.0).clamp(64.0, 1024.0) as u32,
            jpeg_quality: jpeg.then(|| number_at(params, &["quality"]).unwrap_or(82.0).clamp(30.0, 95.0) as u8),
            include_pixels: bool_at(params, &["include_pixels"]).unwrap_or(true),
        }
    }

    /// Size to render for a source crop of `width` x `height`. Never larger
    /// than the crop itself.
    pub(crate) fn target_size(&self, width: u32, height: u32) -> (u32, u32) {
        if let (Some(w), Some(h)) = (self.width, self.height) {
            return (w.min(width).max(1), h.min(height).max(1));
        }
        let scale = (self.max_dim as f32 / width.max(height) as f32).min(1.0);
        ((width as f32 * scale).round().max(1.0) as u32, (height as f32 * scale).round().max(1.0) as u32)
    }

    pub(crate) fn encode(&self, frame: &FrameSnapshotReadback) -> Result<Value, String> {
        let Some(quality) = self.jpeg_quality.filter(|_| self.include_pixels) else {
            return Ok(frame.to_json(self.include_pixels));
        };
        let bgra = matches!(frame.format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb);
        let mut rgb = Vec::with_capacity(frame.pixels.len() / 4 * 3);
        for px in frame.pixels.chunks_exact(4) {
            if bgra { rgb.extend_from_slice(&[px[2], px[1], px[0]]); } else { rgb.extend_from_slice(&px[..3]); }
        }
        let mut jpeg = Vec::with_capacity(rgb.len() / 8);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, quality)
            .encode(&rgb, frame.width, frame.height, image::ExtendedColorType::Rgb8)
            .map_err(|err| format!("preview JPEG encode failed: {err}"))?;
        let mut value = frame.to_json(false);
        value["encoding"] = json!("jpeg");
        value["jpeg_bytes"] = json!(jpeg.len());
        value["jpeg_b64"] = json!(base64::engine::general_purpose::STANDARD.encode(&jpeg));
        Ok(value)
    }
}

pub(crate) fn preview_rgba_at(rgba: &[Value], width: usize, height: usize, x: usize, y: usize) -> [f32; 4] {
    let sx = x.min(width.saturating_sub(1));
    let sy = y.min(height.saturating_sub(1));
    let index = (sy * width + sx) * 4;
    [
        json_channel_to_unit(&rgba[index]),
        json_channel_to_unit(&rgba[index + 1]),
        json_channel_to_unit(&rgba[index + 2]),
        json_channel_to_unit(&rgba[index + 3]),
    ]
}

pub(crate) fn resample_preview_pixel(
    rgba: &[Value],
    width: usize,
    height: usize,
    source_x: f32,
    source_y: f32,
) -> PreviewPixel {
    let x0 = source_x.floor().max(0.0) as usize;
    let y0 = source_y.floor().max(0.0) as usize;
    let x1 = (x0 + 1).min(width.saturating_sub(1));
    let y1 = (y0 + 1).min(height.saturating_sub(1));
    let tx = (source_x - x0 as f32).clamp(0.0, 1.0);
    let ty = (source_y - y0 as f32).clamp(0.0, 1.0);

    let top = mix_rgba(
        preview_rgba_at(rgba, width, height, x0, y0),
        preview_rgba_at(rgba, width, height, x1, y0),
        tx,
    );
    let bottom = mix_rgba(
        preview_rgba_at(rgba, width, height, x0, y1),
        preview_rgba_at(rgba, width, height, x1, y1),
        tx,
    );

    PreviewPixel {
        rgba: mix_rgba(top, bottom, ty),
    }
}

impl App {
    /// Queue the GPU copy of one layer's source for an editor preview.
    pub(crate) fn prepare_source_preview(&mut self, params: &Value, request: &SourcePreviewRequest) -> Result<PendingFrameReadback, String> {
        let layer = string_at(params, &["layer_id"]).and_then(|id| self.scene_layers.get(&id));
        let source_id = layer.and_then(|layer| layer.shader_source_id.clone())
            .or_else(|| string_at(params, &["source_id"]))
            .or_else(|| layer.and_then(|layer| layer.source_id.clone()))
            .ok_or("Source preview is not ready")?;
        let slot = *self.source_frame_slots.get(&source_id).ok_or("Source preview is not ready")?;
        let rect = self.source_frames.get(&source_id).ok_or("Source preview is not ready")?.source_rect;
        let renderer = self.renderer.as_mut().ok_or("Native renderer is unavailable")?;
        let pending = renderer.prepare_source_crop_readback(slot, rect, request)?;
        self.stats.frame_snapshot_reads = self.stats.frame_snapshot_reads.saturating_add(1);
        self.stats.frame_health_checks = self.stats.frame_health_checks.saturating_add(1);
        self.stats.frame_snapshot_bytes_read = self.stats.frame_snapshot_bytes_read
            .saturating_add(pending.width as u64 * pending.height as u64 * 4);
        Ok(pending)
    }

    /// Editor preview of a layer's source. Only the copy is queued on the
    /// render thread; waiting for the GPU, measuring and encoding the pixels
    /// happen on a worker, so a preview refresh never holds up an output frame.
    pub(crate) fn start_source_preview(&mut self, req: &RpcRequest) -> Result<(), String> {
        let request = SourcePreviewRequest::from_params(&req.params);
        let pending = self.prepare_source_preview(&req.params, &request)?;
        let response_tx = self.response_tx.clone();
        let id = req.id;
        thread::spawn(move || {
            let result = pending.finish().and_then(|frame| request.encode(&frame));
            if id != 0 {
                let reply = match result { Ok(result) => json!({"id":id,"ok":true,"result":result}),
                    Err(error) => json!({"id":id,"ok":false,"error":error}) };
                let _ = response_tx.send(reply.to_string());
            }
        });
        Ok(())
    }

    pub(crate) fn apply_source_preview(&mut self, command: &Value) {
        let Some(source_id) = string_at(command, &["source_id"]) else {
            return;
        };
        let seq = number_at(command, &["seq"]).unwrap_or(0.0).round().max(0.0) as u64;
        if let Some(existing) = self.source_previews.get(&source_id) {
            if seq < existing.seq {
                return;
            }
        }
        let width = number_at(command, &["width"])
            .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
            .round()
            .clamp(1.0, 4096.0) as usize;
        let height = number_at(command, &["height"])
            .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
            .round()
            .clamp(1.0, 4096.0) as usize;
        let Some(rgba) = command.get("rgba").and_then(Value::as_array) else {
            return;
        };
        if rgba.len() < width.saturating_mul(height).saturating_mul(4) {
            return;
        }

        let slot = self.assign_source_preview_slot(&source_id);
        let mut pixels = vec![PreviewPixel::zeroed(); SOURCE_PREVIEW_PIXELS];
        let scale_x = width as f32 / SOURCE_PREVIEW_SIZE as f32;
        let scale_y = height as f32 / SOURCE_PREVIEW_SIZE as f32;
        for y in 0..SOURCE_PREVIEW_SIZE {
            let sy = ((y as f32 + 0.5) * scale_y - 0.5).clamp(0.0, (height - 1) as f32);
            for x in 0..SOURCE_PREVIEW_SIZE {
                let dst_index = y * SOURCE_PREVIEW_SIZE + x;
                let sx = ((x as f32 + 0.5) * scale_x - 0.5).clamp(0.0, (width - 1) as f32);
                pixels[dst_index] = resample_preview_pixel(rgba, width, height, sx, sy);
            }
        }

        self.source_previews
            .insert(source_id.clone(), SourcePreview { slot, seq, pixels });
        self.source_preview_dirty = true;
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.preview_slot = Some(slot);
            }
        }
    }

    pub(crate) fn assign_source_preview_slot(&mut self, source_id: &str) -> usize {
        if let Some(slot) = self.source_preview_slots.get(source_id).copied() {
            return slot;
        }
        let used: std::collections::HashSet<usize> =
            self.source_preview_slots.values().copied().collect();
        let slot = (0..MAX_SOURCE_PREVIEWS)
            .find(|candidate| !used.contains(candidate))
            .unwrap_or_else(|| stable_slot(source_id, MAX_SOURCE_PREVIEWS));
        if let Some(old_source_id) =
            self.source_preview_slots
                .iter()
                .find_map(|(id, existing_slot)| {
                    if *existing_slot == slot && id != source_id {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
        {
            self.source_preview_slots.remove(&old_source_id);
            self.source_previews.remove(&old_source_id);
            for layer in self.scene_layers.values_mut() {
                if layer.source_id.as_deref() == Some(old_source_id.as_str()) {
                    layer.preview_slot = None;
                }
            }
        }
        self.source_preview_slots
            .insert(source_id.to_string(), slot);
        slot
    }

    pub(crate) fn source_preview_pixel_data(&self) -> Vec<PreviewPixel> {
        let mut pixels = vec![PreviewPixel::zeroed(); MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS];
        for preview in self.source_previews.values() {
            let slot = preview.slot.min(MAX_SOURCE_PREVIEWS - 1);
            let offset = slot * SOURCE_PREVIEW_PIXELS;
            let end = offset + SOURCE_PREVIEW_PIXELS;
            pixels[offset..end].copy_from_slice(&preview.pixels[..SOURCE_PREVIEW_PIXELS]);
        }
        pixels
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_preview_request_follows_the_size_on_screen() {
        // A 16:9 preview is not read back as the square source texture.
        let sized = SourcePreviewRequest::from_params(&json!({"layer_id":"a","width":864,"height":486,"encoding":"jpeg"}));
        assert_eq!(sized.target_size(2048, 2048), (864, 486));
        assert_eq!(sized.jpeg_quality, Some(82));
        assert!(sized.include_pixels);
        // Never larger than the crop it reads, and never absurd.
        assert_eq!(sized.target_size(320, 180), (320, 180));
        let huge = SourcePreviewRequest::from_params(&json!({"width":90000,"height":2}));
        assert_eq!(huge.target_size(4096, 4096), (1024, 16));
        // Older callers send only max_dim and get the uniform scale and raw pixels.
        let legacy = SourcePreviewRequest::from_params(&json!({"layer_id":"a","max_dim":960}));
        assert_eq!(legacy.target_size(2048, 2048), (960, 960));
        assert_eq!(legacy.target_size(2048, 1024), (960, 480));
        assert_eq!(legacy.jpeg_quality, None);
        assert_eq!(SourcePreviewRequest::from_params(&json!({})).max_dim, 640);
        assert_eq!(SourcePreviewRequest::from_params(&json!({"encoding":"JPEG","quality":500})).jpeg_quality, Some(95));
    }

    #[test]
    fn source_preview_encodes_a_jpeg_without_alpha() {
        let width = 32u32;
        let height = 18u32;
        // Premultiplied frame: half-covered orange, so colour over black is (128, 64, 0).
        let pixels: Vec<u8> = (0..width * height).flat_map(|_| [128u8, 64, 0, 128]).collect();
        let frame = FrameSnapshotReadback {
            timestamp_ms: 0, width, height, format: wgpu::TextureFormat::Rgba8Unorm,
            bytes_per_row: width * 4, padded_bytes_per_row: 256,
            metrics: snapshot_metrics(&pixels, wgpu::TextureFormat::Rgba8Unorm), pixels,
        };
        let jpeg = SourcePreviewRequest::from_params(&json!({"encoding":"jpeg"})).encode(&frame).unwrap();
        assert!(jpeg.get("rgba_b64").is_none());
        let bytes = base64::engine::general_purpose::STANDARD.decode(jpeg["jpeg_b64"].as_str().unwrap()).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap().to_rgb8();
        assert_eq!((decoded.width(), decoded.height()), (width, height));
        let px = decoded.get_pixel(16, 9);
        assert!((px[0] as i32 - 128).abs() <= 4 && (px[1] as i32 - 64).abs() <= 4 && px[2] <= 6, "{px:?}");
        // The metrics still describe the real frame, alpha included.
        assert!((jpeg["mean_rgba"][3].as_f64().unwrap() - 128.0 / 255.0).abs() < 0.01);
        // Without the encoding the raw pixels are returned as before.
        let raw = SourcePreviewRequest::from_params(&json!({})).encode(&frame).unwrap();
        assert!(raw["rgba_b64"].as_str().is_some() && raw.get("jpeg_b64").is_none());
    }
}
