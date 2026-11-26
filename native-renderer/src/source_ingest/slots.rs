//! Source frame slots: uploads and shared-texture frames from the app, slot
//! assignment, slot sizes, formats and payload conversion.

use crate::*;

pub(crate) fn choose_source_frame_format(adapter: &wgpu::Adapter) -> wgpu::TextureFormat {
    if !source_frame_hdr_requested() {
        return SOURCE_FRAME_FORMAT_FALLBACK;
    }
    let features = adapter.get_texture_format_features(SOURCE_FRAME_FORMAT_HDR);
    let required_usages = wgpu::TextureUsages::TEXTURE_BINDING
        | wgpu::TextureUsages::COPY_DST
        | wgpu::TextureUsages::RENDER_ATTACHMENT;
    if features.allowed_usages.contains(required_usages)
        && features
            .flags
            .contains(wgpu::TextureFormatFeatureFlags::FILTERABLE)
    {
        SOURCE_FRAME_FORMAT_HDR
    } else {
        SOURCE_FRAME_FORMAT_FALLBACK
    }
}

pub(crate) fn source_frame_hdr_requested() -> bool {
    std::env::var("GHOST_NATIVE_SOURCE_FRAME_HDR")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Which picture-slot store this device gets. `GA_SOURCE_FRAMES=shared`
/// forces the shared array (to exercise the fallback on capable GPUs).
pub(crate) fn choose_source_frame_mode(features: wgpu::Features, bindings: usize) -> SourceFrameMode {
    let forced_shared = std::env::var("GA_SOURCE_FRAMES")
        .is_ok_and(|value| value.trim().eq_ignore_ascii_case("shared"));
    if !forced_shared && features.contains(PER_SOURCE_SLOT_FEATURES) && bindings >= INITIAL_SOURCE_FRAME_SLOTS {
        SourceFrameMode::PerSource
    } else {
        SourceFrameMode::Shared
    }
}

/// Most layers the shared array may grow to: the device's array-layer limit,
/// and twice the tier's slot budget at this slot size.
pub(crate) fn shared_source_frame_slot_ceiling(
    limits: &wgpu::Limits,
    size: usize,
    format: wgpu::TextureFormat,
    quality_policy: &str,
    features: wgpu::Features,
) -> usize {
    let tier = source_frame_tier_for_policy(quality_policy, native_quality_tier(limits, features));
    let texel = if format == SOURCE_FRAME_FORMAT_HDR { 8 } else { 4 };
    let per_slot = source_frame_slot_bytes(size, texel).max(1);
    let by_budget = source_frame_size_budget_bytes(tier).saturating_mul(2) / per_slot;
    by_budget
        .min(limits.max_texture_array_layers as usize)
        .max(INITIAL_SOURCE_FRAME_SLOTS)
}

/// The resource behind a `source_frames` binding: the shared array view, or
/// one view per slot. `views` keeps the per-slot views alive for the call.
pub(crate) fn source_frames_views(store: &SourceFrameStore, bindings: usize) -> Vec<wgpu::TextureView> {
    match store.mode() {
        SourceFrameMode::Shared => vec![store.shared_array_view().expect("shared source-frame array")],
        SourceFrameMode::PerSource => store.binding_array_views(bindings),
    }
}

pub(crate) fn source_frames_resource<'a>(
    mode: SourceFrameMode,
    views: &'a [wgpu::TextureView],
    refs: &'a [&'a wgpu::TextureView],
) -> wgpu::BindingResource<'a> {
    match mode {
        SourceFrameMode::Shared => wgpu::BindingResource::TextureView(&views[0]),
        SourceFrameMode::PerSource => wgpu::BindingResource::TextureViewArray(refs),
    }
}

pub(crate) fn build_source_frames_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    store: &SourceFrameStore,
    bindings: usize,
) -> wgpu::BindGroup {
    let views = source_frames_views(store, bindings);
    let refs = views.iter().collect::<Vec<_>>();
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Ghost Render Core Source Frames"),
        layout,
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: source_frames_resource(store.mode(), &views, &refs) }],
    })
}

pub(crate) fn choose_source_frame_size(
    limits: &wgpu::Limits,
    features: wgpu::Features,
    format: wgpu::TextureFormat,
    quality_policy: &str,
) -> usize {
    let caps_tier = native_quality_tier(limits, features);
    let tier = source_frame_tier_for_policy(quality_policy, caps_tier);
    let target = match normalize_native_tier(tier) {
        "insane" => SOURCE_FRAME_SIZE_INSANE,
        "ultra" => SOURCE_FRAME_SIZE_DEFAULT,
        "balanced" => SOURCE_FRAME_SIZE_BALANCED,
        "performance" => SOURCE_FRAME_SIZE_PERFORMANCE,
        _ => SOURCE_FRAME_SIZE_DEFAULT,
    };
    let max_dimension = limits.max_texture_dimension_2d as usize;
    let budget_bytes = source_frame_size_budget_bytes(tier);
    let bytes_per_texel = if format == SOURCE_FRAME_FORMAT_HDR {
        8usize
    } else {
        4usize
    };
    [
        SOURCE_FRAME_SIZE_INSANE,
        SOURCE_FRAME_SIZE_DEFAULT,
        SOURCE_FRAME_SIZE_BALANCED,
        SOURCE_FRAME_SIZE_PERFORMANCE,
        512,
        256,
        128,
    ]
    .into_iter()
    .filter(|size| *size <= target)
    .filter(|size| *size <= max_dimension)
    .find(|size| estimate_source_frame_texture_bytes(*size, bytes_per_texel) <= budget_bytes)
    .unwrap_or(128.min(max_dimension.max(1)))
}

pub(crate) fn source_frame_tier_for_policy(policy: &str, caps_tier: &str) -> &'static str {
    let requested = policy.trim().to_ascii_lowercase();
    let requested_tier = if requested.is_empty() || requested == "auto" {
        // Native v2 is a live instrument first. Start at a real-time source
        // frame tier; explicit quality modes can opt into larger frame stores.
        "performance"
    } else {
        normalize_native_tier(&requested)
    };
    if native_tier_rank(requested_tier) <= native_tier_rank(caps_tier) {
        requested_tier
    } else {
        normalize_native_tier(caps_tier)
    }
}

pub(crate) fn native_tier_rank(tier: &str) -> u8 {
    match normalize_native_tier(tier) {
        "performance" => 0,
        "balanced" => 1,
        "ultra" => 2,
        "insane" => 3,
        _ => 1,
    }
}

/// GA_CORE_SOURCE_MIPS=1 turns on mip reads of minified pictures. Off by
/// default: they soften shimmer but cost frame time while a minified picture
/// is on screen, so they stay opt-in until judged on real shows.
pub(crate) fn source_mips_enabled() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| {
        std::env::var("GA_CORE_SOURCE_MIPS")
            .map_or(false, |value| matches!(value.trim(), "1" | "on" | "true" | "yes"))
    })
}

pub(crate) fn source_frame_mip_levels(size: usize) -> u32 {
    let mut levels = 1u32;
    let mut dimension = size.max(1) as u32;
    while dimension > 1 && levels < SOURCE_FRAME_MIP_LEVELS_MAX {
        dimension = (dimension / 2).max(1);
        levels += 1;
    }
    levels
}

pub(crate) fn source_frame_size_budget_bytes(tier: &str) -> usize {
    let mb = match normalize_native_tier(tier) {
        "insane" => 896usize,
        "ultra" => 768usize,
        // The sizing estimate (the first 48 shared slots with mips, plus two
        // stores of the same depth) is ~704 MiB at 1024 RGBA8; retain SDR
        // resolution during clip fades.
        "balanced" => 768usize,
        "performance" => 768usize,
        _ => 256usize,
    };
    mb * 1024 * 1024
}

/// One shared-array slot: every mip level.
pub(crate) fn source_frame_slot_bytes(size: usize, bytes_per_texel: usize) -> usize {
    (0..source_frame_mip_levels(size))
        .map(|level| (size >> level).max(1).pow(2))
        .sum::<usize>()
        .saturating_mul(bytes_per_texel)
}

/// Slot sizing budget: the shared array at its starting size with mips, and
/// room for two more stores of the same depth. The scratch stores are now
/// smaller, but keeping the original estimate keeps the slot edge (and so the
/// cost of every generated picture) where it was.
pub(crate) fn estimate_source_frame_texture_bytes(size: usize, bytes_per_texel: usize) -> usize {
    let base = size.saturating_mul(size).saturating_mul(bytes_per_texel).saturating_mul(INITIAL_SOURCE_FRAME_SLOTS);
    let mip_pixels: usize = (0..source_frame_mip_levels(size)).map(|level| (size >> level).max(1).pow(2)).sum();
    base.saturating_add(mip_pixels.saturating_mul(bytes_per_texel).saturating_mul(INITIAL_SOURCE_FRAME_SLOTS).saturating_mul(2))
}

pub(crate) fn source_frame_upload_payload<'a>(
    rgba: &'a [u8],
    frame_size: usize,
    format: wgpu::TextureFormat,
) -> (Cow<'a, [u8]>, u32) {
    source_frame_upload_payload_dimensions(rgba, frame_size, frame_size, format)
}

pub(crate) fn source_frame_upload_payload_dimensions<'a>(
    rgba: &'a [u8],
    width: usize,
    height: usize,
    format: wgpu::TextureFormat,
) -> (Cow<'a, [u8]>, u32) {
    if format != SOURCE_FRAME_FORMAT_HDR {
        return (
            Cow::Borrowed(&rgba[..width.saturating_mul(height).saturating_mul(4)]),
            (width * 4) as u32,
        );
    }

    let channel_count = width * height * 4;
    let mut payload = Vec::with_capacity(channel_count * 2);
    for channel in rgba.iter().take(channel_count) {
        payload.extend_from_slice(&unorm8_to_f16_bits(*channel).to_le_bytes());
    }
    (Cow::Owned(payload), (width * 8) as u32)
}

pub(crate) fn unorm8_to_f16_bits(channel: u8) -> u16 {
    if channel == 0 {
        return 0;
    }
    f32_to_f16_bits(channel as f32 / 255.0)
}

pub(crate) fn f32_to_f16_bits(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    let mantissa = bits & 0x7f_ffff;

    if exponent <= 0 {
        if exponent < -10 {
            return sign;
        }
        let normalized = mantissa | 0x80_0000;
        let shift = (14 - exponent) as u32;
        let mut half = (normalized >> shift) as u16;
        if ((normalized >> (shift - 1)) & 1) != 0 {
            half = half.saturating_add(1);
        }
        sign | half
    } else if exponent >= 31 {
        sign | 0x7c00
    } else {
        let mut half = sign | ((exponent as u16) << 10) | ((mantissa >> 13) as u16);
        if (mantissa & 0x1000) != 0 {
            half = half.saturating_add(1);
        }
        half
    }
}

pub(crate) fn source_kind(source_type: &str) -> f32 {
    if source_type.starts_with("gpu:") {
        return 9.0;
    }
    match source_type {
        "color" => 1.0,
        "shader" => 2.0,
        "video" => 3.0,
        "image" => 4.0,
        _ => 0.0,
    }
}

pub(crate) fn effective_scene_source_type(
    source_type: &str,
    uri: Option<&str>,
    _has_source_frame: bool,
) -> String {
    // Effect passes preserve straight RGBA (including decoded HAP alpha).
    // GPU instruments use premultiplied coverage; treating effect output as
    // one of those divides RGB by alpha a second time and washes it out.
    if source_type == "image" && uri.is_some_and(|value| value.starts_with("native-effect-pass://")) {
        return "image".to_string();
    }
    if source_type == "image"
        && uri.is_some_and(|value| is_native_generated_source_frame_uri(value))
    {
        return "gpu:native-graph".to_string();
    }
    source_type.to_string()
}

pub(crate) fn is_native_generated_source_frame_uri(uri: &str) -> bool {
    uri.starts_with("native-graph://")
        || uri.starts_with("native-graph-reactivity://")
        || uri.starts_with("native-graph-fixture://")
        || uri.starts_with("native-effect-pass://")
}

pub(crate) fn source_type_color(source_type: &str, id: &str) -> [f32; 4] {
    if source_type.starts_with("gpu:") {
        return match source_type {
            "gpu:planet" => [0.22, 0.62, 1.0, 1.0],
            "gpu:pixel-particles" | "gpu:flythrough" | "gpu:point-cloud-fx" => {
                [1.0, 0.35, 0.82, 1.0]
            }
            "gpu:particle-field" | "gpu:gravity-wells" => [0.25, 1.0, 0.78, 1.0],
            "gpu:volumetric-balls" => [0.78, 0.58, 1.0, 1.0],
            "gpu:smoke-riders" | "gpu:ink-cloud" | "gpu:smoke-3d" => [0.62, 0.82, 1.0, 1.0],
            _ => stable_layer_color(id, 1.0),
        };
    }
    match source_type {
        "shader" => [0.45, 0.92, 1.0, 1.0],
        "video" => [0.28, 1.0, 0.55, 1.0],
        "image" => [1.0, 0.62, 0.26, 1.0],
        "none" => [0.3, 0.34, 0.42, 0.35],
        _ => stable_layer_color(id, 1.0),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SourceFrameTransport {
    File,
    Base64,
    Json,
    SharedTexture,
    Unknown,
}

impl SourceFrameTransport {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Base64 => "base64",
            Self::Json => "json",
            Self::SharedTexture => "shared-texture",
            Self::Unknown => "unknown",
        }
    }

    pub(crate) fn is_cpu_fallback(self) -> bool {
        matches!(self, Self::File | Self::Base64 | Self::Json)
    }
}

pub(crate) fn source_frame_transport_from_command(command: &Value) -> SourceFrameTransport {
    if command.get("shared_handle").is_some()
        || command.get("handle").is_some()
        || command.get("shared_texture").is_some()
    {
        return SourceFrameTransport::SharedTexture;
    }
    if command.get("rgba_file").is_some() {
        return SourceFrameTransport::File;
    }
    if command.get("rgba_b64").is_some() {
        return SourceFrameTransport::Base64;
    }
    if command.get("rgba").is_some() {
        return SourceFrameTransport::Json;
    }
    SourceFrameTransport::Unknown
}

pub(crate) fn rgba_bytes_from_command(command: &Value, width: usize, height: usize) -> Option<Vec<u8>> {
    let expected = width.saturating_mul(height).saturating_mul(4);
    if let Some(file_path) = command.get("rgba_file").and_then(Value::as_str) {
        let bytes = fs::read(file_path).ok()?;
        if command
            .get("rgba_file_delete")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let _ = fs::remove_file(file_path);
        }
        let declared_len = command
            .get("rgba_byte_length")
            .and_then(Value::as_u64)
            .unwrap_or(bytes.len() as u64) as usize;
        if bytes.len() < declared_len || bytes.len() < expected {
            return None;
        }
        return Some(bytes);
    }
    if let Some(encoded) = command.get("rgba_b64").and_then(Value::as_str) {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .ok()?;
        return (decoded.len() >= expected).then_some(decoded);
    }
    let rgba = command.get("rgba").and_then(Value::as_array)?;
    if rgba.len() < expected {
        return None;
    }
    let mut bytes = Vec::with_capacity(expected);
    for value in rgba.iter().take(expected) {
        let n = value.as_f64().unwrap_or(0.0);
        bytes.push(n.round().clamp(0.0, 255.0) as u8);
    }
    Some(bytes)
}

pub(crate) fn frame_rgba_at(rgba: &[u8], width: usize, height: usize, x: usize, y: usize) -> [f32; 4] {
    let sx = x.min(width.saturating_sub(1));
    let sy = y.min(height.saturating_sub(1));
    let index = (sy * width + sx) * 4;
    [
        rgba[index] as f32,
        rgba[index + 1] as f32,
        rgba[index + 2] as f32,
        rgba[index + 3] as f32,
    ]
}

pub(crate) fn resample_frame_bytes(
    rgba: &[u8],
    width: usize,
    height: usize,
    dst_width: usize,
    dst_height: usize,
) -> Vec<u8> {
    if width == dst_width
        && height == dst_height
        && rgba.len() >= width.saturating_mul(height).saturating_mul(4)
    {
        return rgba[..width * height * 4].to_vec();
    }
    let mut out = vec![0u8; dst_width.saturating_mul(dst_height).saturating_mul(4)];
    let scale_x = width as f32 / dst_width.max(1) as f32;
    let scale_y = height as f32 / dst_height.max(1) as f32;
    for y in 0..dst_height {
        let source_y = ((y as f32 + 0.5) * scale_y - 0.5).clamp(0.0, (height - 1) as f32);
        let y0 = source_y.floor().max(0.0) as usize;
        let y1 = (y0 + 1).min(height.saturating_sub(1));
        let ty = (source_y - y0 as f32).clamp(0.0, 1.0);
        for x in 0..dst_width {
            let source_x = ((x as f32 + 0.5) * scale_x - 0.5).clamp(0.0, (width - 1) as f32);
            let x0 = source_x.floor().max(0.0) as usize;
            let x1 = (x0 + 1).min(width.saturating_sub(1));
            let tx = (source_x - x0 as f32).clamp(0.0, 1.0);
            let top = mix_rgba(
                frame_rgba_at(rgba, width, height, x0, y0),
                frame_rgba_at(rgba, width, height, x1, y0),
                tx,
            );
            let bottom = mix_rgba(
                frame_rgba_at(rgba, width, height, x0, y1),
                frame_rgba_at(rgba, width, height, x1, y1),
                tx,
            );
            let mixed = mix_rgba(top, bottom, ty);
            let dst = (y * dst_width + x) * 4;
            out[dst] = mixed[0].round().clamp(0.0, 255.0) as u8;
            out[dst + 1] = mixed[1].round().clamp(0.0, 255.0) as u8;
            out[dst + 2] = mixed[2].round().clamp(0.0, 255.0) as u8;
            out[dst + 3] = mixed[3].round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

pub(crate) fn mix_rgba(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    let mix = |x: f32, y: f32| x + (y - x) * t;
    [
        mix(a[0], b[0]),
        mix(a[1], b[1]),
        mix(a[2], b[2]),
        mix(a[3], b[3]),
    ]
}

impl App {
    pub(crate) fn upload_source_gpu_shared_texture(&mut self, params: &Value) -> Result<Value, String> {
        if string_at(params, &["source_id"]).is_none() {
            return Err("native shared texture source-frame upload requires source_id".to_string());
        }
        let rejected_before = self.stats.source_frame_rejected_uploads;
        let uploaded_before = self.stats.source_frame_uploads;
        self.apply_source_frame(params);
        let rejected_after = self.stats.source_frame_rejected_uploads;
        let uploaded_after = self.stats.source_frame_uploads;
        if rejected_after > rejected_before && uploaded_after == uploaded_before {
            let reason = if self.stats.source_frame_last_reject_reason.is_empty() {
                "native shared texture source-frame upload was rejected".to_string()
            } else {
                self.stats.source_frame_last_reject_reason.clone()
            };
            return Err(reason);
        }
        Ok(json!(self.status()))
    }

    pub(crate) fn upload_source_frame_pixels(
        &mut self,
        source_id: String,
        seq: u64,
        width: usize,
        height: usize,
        rgba: &[u8],
        transport: &str,
        count_cpu_fallback: bool,
    ) -> usize {
        let input_byte_len = rgba.len() as u64;
        let slot = match self.assign_source_frame_slot(&source_id) {
            Ok(slot) => slot,
            Err(error) => { self.reject_source_frame_upload(width, height, transport, &error); return 0; }
        };
        if let Some(renderer) = &self.renderer { renderer.hap_converter.release(slot); }
        let dst_size = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.source_frame_size)
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT);
        let is_native_video = transport.starts_with("native-video");
        // Rect placement only applies when the frame fits the slot as sent;
        // a larger frame still has to be resampled down or it would clip.
        let is_rect_placement =
            transport.ends_with("-rect") && width <= dst_size && height <= dst_size;
        let per_source = self.renderer.as_ref()
            .is_some_and(|renderer| renderer.slots.mode() == SourceFrameMode::PerSource);
        let (uploaded_bytes, source_rect) = if per_source {
            // Each slot is its own texture: the picture keeps its size (up to
            // the per-source limit) and fills the slot.
            let renderer = self.renderer.as_ref().expect("per-source renderer");
            let (fit_width, fit_height) = renderer.slots.fitted_size(width as u32, height as u32);
            let (fit_width, fit_height) = (fit_width as usize, fit_height as usize);
            let resampled;
            let pixels = if (fit_width, fit_height) == (width, height) {
                rgba
            } else {
                resampled = resample_frame_bytes(rgba, width, height, fit_width, fit_height);
                resampled.as_slice()
            };
            let uploaded = renderer
                .write_slot_pixels(slot, pixels, fit_width, fit_height, !is_native_video)
                .unwrap_or(0);
            (uploaded, [0.0, 0.0, 1.0, 1.0])
        } else if is_native_video || is_rect_placement {
            let upload_width = width.min(dst_size);
            let upload_height = height.min(dst_size);
            let origin_x = (dst_size.saturating_sub(upload_width)) / 2;
            let origin_y = (dst_size.saturating_sub(upload_height)) / 2;
            let source_rect = [
                origin_x as f32 / dst_size.max(1) as f32,
                origin_y as f32 / dst_size.max(1) as f32,
                upload_width as f32 / dst_size.max(1) as f32,
                upload_height as f32 / dst_size.max(1) as f32,
            ];
            let uploaded = self
                .renderer
                .as_ref()
                .and_then(|renderer| {
                    renderer.write_video_source_frame(
                        slot,
                        rgba,
                        upload_width,
                        upload_height,
                        origin_x,
                        origin_y,
                    )
                })
                .unwrap_or(0);
            (uploaded, source_rect)
        } else {
            let pixels = resample_frame_bytes(rgba, width, height, dst_size, dst_size);
            if let Some(renderer) = self.renderer.as_ref() {
                renderer.write_source_frame(slot, &pixels);
            }
            (pixels.len(), [0.0, 0.0, 1.0, 1.0])
        };
        self.stats.source_frame_uploads = self.stats.source_frame_uploads.saturating_add(1);
        self.stats.source_frame_bytes_uploaded = self
            .stats
            .source_frame_bytes_uploaded
            .saturating_add(uploaded_bytes as u64);
        self.stats.source_frame_input_bytes_uploaded = self
            .stats
            .source_frame_input_bytes_uploaded
            .saturating_add(input_byte_len);
        self.stats.source_frame_resampled_bytes_uploaded = self
            .stats
            .source_frame_resampled_bytes_uploaded
            .saturating_add(if per_source || is_native_video || is_rect_placement {
                0
            } else {
                uploaded_bytes as u64
            });
        if count_cpu_fallback {
            self.stats.source_frame_cpu_fallback_uploads = self
                .stats
                .source_frame_cpu_fallback_uploads
                .saturating_add(1);
        }
        self.stats.source_frame_last_input_bytes = input_byte_len;
        self.stats.source_frame_last_upload_bytes = uploaded_bytes as u64;
        self.stats.source_frame_last_upload_width = width.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_height = height.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_transport = transport.to_string();
        self.stats.source_frame_last_reject_reason.clear();
        if transport != "native-image" {
            self.source_frame_signatures.remove(&source_id);
        }
        if transport != "native-video-frame" {
            self.native_video_frame_signatures.remove(&source_id);
        }
        self.source_frames
            .insert(source_id.clone(), SourceFrame::with_rect(seq, source_rect));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
                layer.source_rect = source_rect;
            }
        }
        self.commit_pending_media_bindings_for_source(&source_id, slot, source_rect);
        uploaded_bytes
    }

    pub(crate) fn apply_source_frame(&mut self, command: &Value) {
        let Some(source_id) = string_at(command, &["source_id"]) else {
            return;
        };
        let seq = number_at(command, &["seq"]).unwrap_or(0.0).round().max(0.0) as u64;
        if let Some(existing) = self.source_frames.get(&source_id) {
            if seq < existing.seq {
                return;
            }
        }
        let width = number_at(command, &["width"])
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT as f64)
            .round()
            .clamp(1.0, SOURCE_FRAME_SIZE_INSANE as f64) as usize;
        let height = number_at(command, &["height"])
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT as f64)
            .round()
            .clamp(1.0, SOURCE_FRAME_SIZE_INSANE as f64) as usize;
        let transport = source_frame_transport_from_command(command);
        if transport == SourceFrameTransport::SharedTexture {
            self.apply_shared_texture_source_frame(source_id, seq, command, width, height);
            return;
        }
        let Some(mut rgba) = rgba_bytes_from_command(command, width, height) else {
            self.reject_source_frame_upload(
                width,
                height,
                transport.as_str(),
                "missing or invalid source-frame pixel payload",
            );
            return;
        };
        // Pages captured offscreen (three.js / p5 sources) arrive in the
        // compositor's BGRA order. Swap here: doing it in the Electron main
        // process would be a per-frame JS loop over megabytes, on the thread
        // that answers every editor IPC call.
        // Offscreen pages also arrive premultiplied (Chromium paints that
        // way); the compositor expects straight alpha, so a transparent
        // page's soft edges and glows would come out too dark. Opaque
        // pixels (alpha 255) are left as they are.
        let bgra = string_at(command, &["pixel_format"]).as_deref() == Some("bgra");
        let premultiplied = command.get("premultiplied").and_then(Value::as_bool).unwrap_or(false);
        if bgra || premultiplied {
            for pixel in rgba.chunks_exact_mut(4) {
                if bgra {
                    pixel.swap(0, 2);
                }
                if premultiplied {
                    let alpha = pixel[3] as u32;
                    if alpha > 0 && alpha < 255 {
                        for channel in &mut pixel[..3] {
                            *channel = ((*channel as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
                        }
                    }
                }
            }
        }
        // `placement: "rect"` writes the frame into its slot as sent, the way
        // decoded video is, instead of resampling it to the square slot and
        // rebuilding the mip chain. Continuous sources need this: the
        // resample runs on the render thread and grows with frame size.
        let rect_transport;
        let transport_label = if string_at(command, &["placement"]).as_deref() == Some("rect") {
            rect_transport = format!("{}-rect", transport.as_str());
            rect_transport.as_str()
        } else {
            transport.as_str()
        };
        self.upload_source_frame_pixels(
            source_id,
            seq,
            width,
            height,
            &rgba,
            transport_label,
            transport.is_cpu_fallback(),
        );
        match transport {
            SourceFrameTransport::File => {
                self.stats.source_frame_file_uploads =
                    self.stats.source_frame_file_uploads.saturating_add(1);
            }
            SourceFrameTransport::Base64 => {
                self.stats.source_frame_base64_uploads =
                    self.stats.source_frame_base64_uploads.saturating_add(1);
            }
            SourceFrameTransport::Json => {
                self.stats.source_frame_json_uploads =
                    self.stats.source_frame_json_uploads.saturating_add(1);
            }
            SourceFrameTransport::SharedTexture => {
                self.stats.source_frame_shared_texture_uploads = self
                    .stats
                    .source_frame_shared_texture_uploads
                    .saturating_add(1);
            }
            SourceFrameTransport::Unknown => {}
        }
    }

    pub(crate) fn apply_shared_texture_source_frame(
        &mut self,
        source_id: String,
        seq: u64,
        command: &Value,
        width: usize,
        height: usize,
    ) {
        let Some(descriptor) =
            SharedTextureSourceFrameDescriptor::from_command(command, width, height)
        else {
            self.reject_shared_texture_source_frame(
                width,
                height,
                "shared texture source-frame upload is missing a shared texture handle",
            );
            return;
        };

        if self.renderer.is_none() {
            let reason = format!(
                "{}; native renderer is not running",
                descriptor.unsupported_reason(native_backend_name())
            );
            self.reject_shared_texture_source_frame(width, height, &reason);
            return;
        }

        let slot = match self.assign_source_frame_slot(&source_id) {
            Ok(slot) => slot,
            Err(error) => { self.reject_shared_texture_source_frame(width, height, &error); return; }
        };
        let renderer = self
            .renderer
            .as_ref()
            .expect("renderer checked before shared texture import");
        let uploaded_bytes = match renderer.import_shared_texture_source_frame(slot, &descriptor) {
            Ok(uploaded_bytes) => uploaded_bytes,
            Err(err) => {
                self.release_source_frame_slot(&source_id);
                self.reject_shared_texture_source_frame(width, height, &err);
                return;
            }
        };

        self.stats.source_frame_uploads = self.stats.source_frame_uploads.saturating_add(1);
        self.stats.source_frame_shared_texture_uploads = self
            .stats
            .source_frame_shared_texture_uploads
            .saturating_add(1);
        self.stats.source_frame_bytes_uploaded = self
            .stats
            .source_frame_bytes_uploaded
            .saturating_add(uploaded_bytes);
        self.stats.source_frame_resampled_bytes_uploaded = self
            .stats
            .source_frame_resampled_bytes_uploaded
            .saturating_add(uploaded_bytes);
        self.stats.source_frame_last_input_bytes = descriptor.handle_byte_length.unwrap_or(0);
        self.stats.source_frame_last_upload_bytes = uploaded_bytes;
        self.stats.source_frame_last_upload_width = descriptor.width;
        self.stats.source_frame_last_upload_height = descriptor.height;
        self.stats.source_frame_last_upload_transport = "shared-texture".to_string();
        self.stats.source_frame_last_reject_reason.clear();
        self.source_frame_signatures.remove(&source_id);
        self.native_video_frame_signatures.remove(&source_id);
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        self.commit_pending_media_bindings_for_source(&source_id, slot, [0.0, 0.0, 1.0, 1.0]);
    }

    pub(crate) fn reject_shared_texture_source_frame(&mut self, width: usize, height: usize, reason: &str) {
        self.stats.source_frame_shared_texture_rejected_uploads = self
            .stats
            .source_frame_shared_texture_rejected_uploads
            .saturating_add(1);
        self.reject_source_frame_upload(width, height, "shared-texture-unsupported", reason);
    }

    pub(crate) fn reject_source_frame_upload(
        &mut self,
        width: usize,
        height: usize,
        transport: &str,
        reason: &str,
    ) {
        self.stats.source_frame_rejected_uploads =
            self.stats.source_frame_rejected_uploads.saturating_add(1);
        self.stats.source_frame_last_input_bytes = 0;
        self.stats.source_frame_last_upload_bytes = 0;
        self.stats.source_frame_last_upload_width = width.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_height = height.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_transport = transport.to_string();
        self.stats.source_frame_last_reject_reason = reason.to_string();
    }

    /// A slot handed to a new source still holds its previous owner's last
    /// image. Graph sources count as having a frame the moment their job is
    /// queued, and while a cold pipeline warms the compositor samples the slot
    /// anyway, so a deleted Lines layer showed through a new Light Painting
    /// layer for several frames. Every new assignment starts transparent.
    pub(crate) fn clear_new_source_frame_slot(&self, slot: usize) {
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.clear_source_frame_slot(slot);
        }
    }

    pub(crate) fn ensure_empty_source_frame_slot(&mut self) -> usize {
        // Slot zero is reserved at App construction and never released.
        let slot = self.source_frame_slots[EMPTY_SOURCE_FRAME_ID];
        if self.source_frames.contains_key(EMPTY_SOURCE_FRAME_ID) {
            return slot;
        }
        if let Some(renderer) = self.renderer.as_ref() {
            // The empty sentinel frame must be fully transparent: shader
            // layers bind it as their input, and any visible fill (the old
            // debug checkerboard) bleeds into the composite as ghost washes.
            let size = renderer.source_frame_size;
            let pixels = vec![0u8; size.saturating_mul(size).saturating_mul(4)];
            renderer.write_source_frame(slot, &pixels);
        }
        self.source_frames
            .insert(EMPTY_SOURCE_FRAME_ID.to_string(), SourceFrame::full(0));
        slot
    }

    pub(crate) fn assign_source_frame_slot(&mut self, source_id: &str) -> Result<usize, String> {
        if let Some(slot) = self.source_frame_slots.get(source_id).copied() {
            return Ok(slot);
        }
        if let Some(slot) = self.unused_source_frame_slot() {
            self.source_frame_slots.insert(source_id.to_string(), slot);
            self.clear_new_source_frame_slot(slot);
            return Ok(slot);
        }

        // All slots occupied: evict an occupant nothing references anymore.
        // Live sources and explicit transition snapshots are never displaced.
        // A caller that cannot acquire a slot must retain its prior picture.
        if let Some((old_source_id, slot)) = self
            .source_frame_slots
            .iter()
            .filter(|(id, _)| id.as_str() != source_id && !is_clip_snapshot_source_id(id) && !self.media_source_is_referenced(id))
            .min_by_key(|(_, slot)| **slot)
            .map(|(id, slot)| (id.clone(), *slot))
        {
            self.release_source_frame_slot(&old_source_id);
            self.source_frames.remove(&old_source_id);
            self.source_frame_signatures.remove(&old_source_id);
            self.native_video_frame_signatures.remove(&old_source_id);
            self.source_frame_slots.insert(source_id.to_string(), slot);
            self.clear_new_source_frame_slot(slot);
            return Ok(slot);
        }

        // Nothing to evict: add slots.
        if let Some(slot) = self.free_source_frame_slot() {
            self.source_frame_slots.insert(source_id.to_string(), slot);
            self.clear_new_source_frame_slot(slot);
            return Ok(slot);
        }

        Err(format!("GPU source-frame capacity reached ({} slots); retaining existing live pictures",
            self.source_frame_capacity()))
    }

    pub(crate) fn source_frame_capacity(&self) -> usize {
        self.renderer.as_ref().map(|renderer| renderer.slots.capacity()).unwrap_or(INITIAL_SOURCE_FRAME_SLOTS)
    }

    /// The lowest slot no source holds, within the current capacity.
    pub(crate) fn unused_source_frame_slot(&self) -> Option<usize> {
        let used: HashSet<usize> = self.source_frame_slots.values().copied().collect();
        (0..self.source_frame_capacity()).find(|slot| !used.contains(slot))
    }

    /// An unused slot, growing the store when every slot is taken.
    pub(crate) fn free_source_frame_slot(&mut self) -> Option<usize> {
        if let Some(slot) = self.unused_source_frame_slot() {
            return Some(slot);
        }
        let next = self.source_frame_capacity();
        let renderer = self.renderer.as_ref()?;
        renderer.ensure_slot_capacity(next).then_some(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_frame_auto_policy_uses_realtime_tier() {
        assert_eq!(
            source_frame_tier_for_policy("auto", "insane"),
            "performance"
        );
        assert_eq!(source_frame_tier_for_policy("", "ultra"), "performance");
        assert_eq!(source_frame_tier_for_policy("insane", "ultra"), "ultra");
        assert_eq!(
            source_frame_tier_for_policy("performance", "insane"),
            "performance"
        );
    }

    #[test]
    fn native_generated_sources_are_gpu_backed_before_first_frame() {
        for uri in [
            "native-graph://planet/layer-a",
            "native-graph-reactivity://smoke/layer-a",
            "native-graph-fixture://probe",
        ] {
            assert_eq!(
                effective_scene_source_type("image", Some(uri), false),
                "gpu:native-graph"
            );
        }

        assert_eq!(
            effective_scene_source_type("image", Some("native-effect-pass://layer-a"), false),
            "image"
        );
        assert_eq!(
            effective_scene_source_type("image", Some("file:///tmp/still.png"), false),
            "image"
        );
        assert_eq!(
            effective_scene_source_type("video", Some("native-effect-pass://layer-a"), false),
            "video"
        );
    }
}
