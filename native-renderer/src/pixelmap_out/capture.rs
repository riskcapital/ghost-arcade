//! The program picture for pixel-map sampling, copied inside the frame's own
//! command buffer: the same nearest-neighbour downscale of the output mirror
//! the editor's composite mirror reads (`prepare_frame_snapshot_scaled` with
//! `live_output`), into one of a few readback buffers that the GPU maps once
//! the frame completes. No extra submit, no wait on the render thread; the
//! map callback hands the buffer to the output thread.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use wgpu::util::{TextureBlitter, TextureBlitterBuilder};

use super::{CAPTURE_INTERVAL_US, CAPTURE_MAX_DIM, MappedFrame};
use crate::RenderState;
use crate::gpu::align_u32;

const SLOTS: usize = 3;
/// A buffer whose frame never completed (encoder dropped, device lost) is
/// given up after this long.
const SLOT_TIMEOUT: Duration = Duration::from_secs(3);

struct Slot {
    buffer: wgpu::Buffer,
    busy: Arc<AtomicBool>,
    marked_at: Instant,
}

#[derive(Default)]
pub(crate) struct Capture {
    target: Option<(wgpu::Texture, TextureBlitter, wgpu::TextureFormat, u32, u32)>,
    slots: Vec<Slot>,
    slot_size: (u32, u32),
    last_capture: Option<Instant>,
    pub(crate) captured: u64,
    pub(crate) skipped_busy: u64,
}

/// The snapshot preview's size rule: longest edge `max_dim`, or the full
/// output when it already fits.
pub(crate) fn capture_size(out_w: u32, out_h: u32, max_dim: u32) -> (u32, u32, bool) {
    let out_w = out_w.max(1);
    let out_h = out_h.max(1);
    if max_dim == 0 || (out_w <= max_dim && out_h <= max_dim) {
        return (out_w, out_h, false);
    }
    let scale = max_dim as f32 / out_w.max(out_h) as f32;
    let w = ((out_w as f32 * scale).round() as u32).clamp(1, out_w);
    let h = ((out_h as f32 * scale).round() as u32).clamp(1, out_h);
    (w, h, true)
}

impl RenderState {
    /// Called with the frame's encoder right after the output mirror is drawn.
    pub(crate) fn capture_pixelmap_frame(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if !super::capture_wanted() {
            if self.pixelmap_capture.target.is_some() || !self.pixelmap_capture.slots.is_empty() {
                self.pixelmap_capture = Capture::default();
            }
            return;
        }
        let now = Instant::now();
        let interval = Duration::from_micros(CAPTURE_INTERVAL_US.load(Ordering::Relaxed));
        if self.pixelmap_capture.last_capture.is_some_and(|last| now.duration_since(last) < interval) {
            return;
        }
        let format = self.config.format;
        if !matches!(format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb
            | wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Rgba8UnormSrgb) {
            return;
        }
        let (w, h, scaled) = capture_size(self.config.width, self.config.height, CAPTURE_MAX_DIM.load(Ordering::Relaxed));
        let capture = &mut self.pixelmap_capture;
        if capture.slot_size != (w, h) {
            capture.slots.clear();
            capture.slot_size = (w, h);
        }
        let padded = align_u32(w * 4, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        while capture.slots.len() < SLOTS {
            capture.slots.push(Slot {
                buffer: self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("Ghost Pixel Map Readback"),
                    size: padded as u64 * h as u64,
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                }),
                busy: Arc::new(AtomicBool::new(false)),
                marked_at: now,
            });
        }
        for slot in capture.slots.iter_mut() {
            if slot.busy.load(Ordering::Acquire) && now.duration_since(slot.marked_at) > SLOT_TIMEOUT {
                *slot = Slot {
                    buffer: self.device.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("Ghost Pixel Map Readback"),
                        size: padded as u64 * h as u64,
                        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                        mapped_at_creation: false,
                    }),
                    busy: Arc::new(AtomicBool::new(false)),
                    marked_at: now,
                };
            }
        }
        let Some(index) = capture.slots.iter().position(|slot| !slot.busy.load(Ordering::Acquire)) else {
            capture.skipped_busy += 1;
            return;
        };
        let source = if scaled {
            if !matches!(&capture.target, Some((_, _, f, tw, th)) if *f == format && *tw == w && *th == h) {
                let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Ghost Pixel Map Target"),
                    size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                    view_formats: &[],
                });
                // The snapshot preview's blitter: nearest, as the editor path reads.
                let blitter = TextureBlitterBuilder::new(&self.device, format).build();
                capture.target = Some((texture, blitter, format, w, h));
            }
            let (texture, blitter, _, _, _) = capture.target.as_ref().expect("pixel-map target just ensured");
            let src_view = self.output_mirror_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let dst_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            blitter.copy(&self.device, encoder, &src_view, &dst_view);
            texture
        } else {
            capture.target = None;
            &self.output_mirror_texture
        };
        let slot = &mut capture.slots[index];
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: source, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo {
                buffer: &slot.buffer,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        slot.busy.store(true, Ordering::Release);
        slot.marked_at = now;
        let buffer = slot.buffer.clone();
        let busy = Arc::clone(&slot.busy);
        let bgra = matches!(format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb);
        encoder.map_buffer_on_submit(&slot.buffer, wgpu::MapMode::Read, .., move |result| {
            super::deliver_frame(MappedFrame { buffer, busy, width: w, height: h, padded_bytes_per_row: padded, bgra, ok: result.is_ok() });
        });
        capture.last_capture = Some(now);
        capture.captured += 1;
    }
}
