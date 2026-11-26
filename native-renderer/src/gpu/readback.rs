//! Texture readbacks and the pixel metrics taken from them.

use crate::*;

#[derive(Clone, Debug)]
pub(crate) struct SnapshotMetrics {
    pub(crate) checksum: String,
    pub(crate) nonzero_pixels: u64,
    pub(crate) bright_pixels: u64,
    pub(crate) transparent_pixels: u64,
    pub(crate) average_luma: f64,
    pub(crate) max_luma: f64,
    pub(crate) mean_rgba: [f64; 4],
    pub(crate) dark_frame: bool,
}

pub(crate) struct FrameSnapshotReadback {
    pub(crate) timestamp_ms: u128,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) format: wgpu::TextureFormat,
    pub(crate) bytes_per_row: u32,
    pub(crate) padded_bytes_per_row: u32,
    pub(crate) pixels: Vec<u8>,
    pub(crate) metrics: SnapshotMetrics,
}

impl FrameSnapshotReadback {
    pub(crate) fn to_json(&self, include_pixels: bool) -> Value {
        let mut value = json!({
            "timestamp_ms": self.timestamp_ms,
            "width": self.width,
            "height": self.height,
            "format": format!("{:?}", self.format),
            "byte_length": self.pixels.len(),
            "bytes_per_row": self.bytes_per_row,
            "padded_bytes_per_row": self.padded_bytes_per_row,
            "checksum": self.metrics.checksum.clone(),
            "nonzero_pixels": self.metrics.nonzero_pixels,
            "bright_pixels": self.metrics.bright_pixels,
            "transparent_pixels": self.metrics.transparent_pixels,
            "average_luma": self.metrics.average_luma,
            "max_luma": self.metrics.max_luma,
            "mean_rgba": self.metrics.mean_rgba,
            "dark_frame": self.metrics.dark_frame,
            "includes_pixels": include_pixels,
        });
        if include_pixels {
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "rgba_b64".to_string(),
                    Value::String(base64::engine::general_purpose::STANDARD.encode(&self.pixels)),
                );
            }
        }
        value
    }
}

pub(crate) fn read_texture_to_frame(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture,
    format: wgpu::TextureFormat, width: u32, height: u32, label: &str) -> Result<FrameSnapshotReadback, String> {
    prepare_texture_readback(device, queue, texture, format, width, height, label)?.finish()
}

pub(crate) fn prepare_texture_readback(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    format: wgpu::TextureFormat,
    width: u32,
    height: u32,
    label: &str,
) -> Result<PendingFrameReadback, String> {
    let width = width.max(1);
    let height = height.max(1);
    let bytes_per_pixel = 4_u32;
    let unpadded_bytes_per_row = width.saturating_mul(bytes_per_pixel);
    let padded_bytes_per_row =
        align_u32(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let padded_size = padded_bytes_per_row as u64 * height as u64;
    if padded_size > 128 * 1024 * 1024 { return Err("capture exceeds 128 MiB readback budget".to_string()); }
    let buffer_label = format!("{label} Readback");
    let encoder_label = format!("{label} Readback Encoder");
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(&buffer_label),
        size: padded_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some(&encoder_label),
    });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    churn_probe::submit(queue, Some(encoder.finish()));

    Ok(PendingFrameReadback { device: device.clone(), buffer, format, width, height, unpadded_bytes_per_row, padded_bytes_per_row })
}

pub(crate) struct PendingFrameReadback {
    pub(crate) device: wgpu::Device,
    pub(crate) buffer: wgpu::Buffer,
    pub(crate) format: wgpu::TextureFormat,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) unpadded_bytes_per_row: u32,
    pub(crate) padded_bytes_per_row: u32,
}

impl PendingFrameReadback {
    pub(crate) fn finish(self) -> Result<FrameSnapshotReadback, String> {
        let Self { device, buffer, format, width, height, unpadded_bytes_per_row, padded_bytes_per_row } = self;
    let slice = buffer.slice(..);
    let (tx, rx) = mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = tx.send(result.map_err(|err| err.to_string()));
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        device.poll(wgpu::PollType::Poll).map_err(|err| err.to_string())?;
        match rx.recv_timeout(Duration::from_millis(2)) {
            Ok(result) => { result?; break; }
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {}
            Err(_) => return Err("GPU readback timed out or disconnected".to_string()),
        }
    }

    let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
    let mut compact = vec![0_u8; unpadded_bytes_per_row as usize * height as usize];
    for y in 0..height as usize {
        let src_start = y * padded_bytes_per_row as usize;
        let dst_start = y * unpadded_bytes_per_row as usize;
        compact[dst_start..dst_start + unpadded_bytes_per_row as usize]
            .copy_from_slice(&mapped[src_start..src_start + unpadded_bytes_per_row as usize]);
    }
    drop(mapped);
    buffer.unmap();

    let metrics = snapshot_metrics(&compact, format);
    Ok(FrameSnapshotReadback {
        timestamp_ms: epoch_ms(),
        width,
        height,
        format,
        bytes_per_row: unpadded_bytes_per_row,
        padded_bytes_per_row,
        pixels: compact,
        metrics,
    })
}
}

pub(crate) fn align_u32(value: u32, alignment: u32) -> u32 {
    if alignment == 0 {
        return value;
    }
    value.div_ceil(alignment).saturating_mul(alignment)
}

pub(crate) fn align_u64(value: u64, alignment: u64) -> u64 {
    if alignment == 0 {
        return value;
    }
    value.div_ceil(alignment).saturating_mul(alignment)
}

pub(crate) fn snapshot_metrics(bytes: &[u8], format: wgpu::TextureFormat) -> SnapshotMetrics {
    let bgra = matches!(
        format,
        wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb
    );
    let mut checksum = 0xcbf29ce484222325_u64;
    let mut nonzero_pixels = 0_u64;
    let mut bright_pixels = 0_u64;
    let mut transparent_pixels = 0_u64;
    let mut luma_sum = 0.0_f64;
    let mut max_luma = 0.0_f64;
    let mut rgba_sum = [0.0_f64; 4];
    let mut pixel_count = 0_u64;
    for pixel in bytes.chunks_exact(4) {
        for byte in pixel {
            checksum ^= *byte as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        let (r, g, b, a) = if bgra {
            (pixel[2], pixel[1], pixel[0], pixel[3])
        } else {
            (pixel[0], pixel[1], pixel[2], pixel[3])
        };
        let luma = 0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64;
        if a > 0 && luma > 2.0 {
            nonzero_pixels = nonzero_pixels.saturating_add(1);
        }
        if a > 0 && luma > 96.0 {
            bright_pixels = bright_pixels.saturating_add(1);
        }
        if a == 0 {
            transparent_pixels = transparent_pixels.saturating_add(1);
        }
        rgba_sum[0] += r as f64;
        rgba_sum[1] += g as f64;
        rgba_sum[2] += b as f64;
        rgba_sum[3] += a as f64;
        luma_sum += luma;
        max_luma = max_luma.max(luma);
        pixel_count = pixel_count.saturating_add(1);
    }
    let average_luma = if pixel_count == 0 {
        0.0
    } else {
        luma_sum / pixel_count as f64 / 255.0
    };
    let mean_rgba = if pixel_count == 0 {
        [0.0; 4]
    } else {
        [
            rgba_sum[0] / pixel_count as f64 / 255.0,
            rgba_sum[1] / pixel_count as f64 / 255.0,
            rgba_sum[2] / pixel_count as f64 / 255.0,
            rgba_sum[3] / pixel_count as f64 / 255.0,
        ]
    };
    SnapshotMetrics {
        checksum: format!("{checksum:016x}"),
        nonzero_pixels,
        bright_pixels,
        transparent_pixels,
        average_luma,
        max_luma: max_luma / 255.0,
        mean_rgba,
        dark_frame: nonzero_pixels < (pixel_count / 200).max(1) || average_luma < 0.006,
    }
}
