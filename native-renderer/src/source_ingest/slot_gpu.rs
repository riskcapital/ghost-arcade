//! Source frame slots on the GPU: readiness, writes, copies, mips and the
//! HAP upload batch.

use crate::*;

impl RenderState {
    pub(crate) fn mark_source_frame_slots_submitted(&self, slots: impl IntoIterator<Item = usize>) {
        let states = slots.into_iter().collect::<HashSet<_>>().into_iter().map(|slot| {
            let state = self.slot_readiness(slot);
            let epoch = state.epoch.load(Ordering::Acquire);
            state.submitted_epoch.store(epoch, Ordering::Release);
            (state, epoch)
        }).collect::<Vec<_>>();
        if !states.is_empty() {
            self.queue.on_submitted_work_done(move || {
                for (state, epoch) in states {
                    // Slot reuse invalidates old in-flight callbacks. An old
                    // completion must not make a new, still blank owner ready.
                    if state.epoch.load(Ordering::Acquire) == epoch {
                        // Polling can dispatch callbacks on another thread.
                        // A delayed older callback must not regress a newer
                        // completion after this epoch check races with reuse.
                        state.completed_epoch.fetch_max(epoch, Ordering::AcqRel);
                    }
                }
            });
        }
    }

    pub(crate) fn mark_graph_frames_submitted(&self, plans: impl Iterator<Item = usize>) {
        self.mark_source_frame_slots_submitted(plans);
    }

    /// Readiness of `slot`'s picture on the GPU; slots past the first ones
    /// get their tracker on first use.
    pub(crate) fn slot_readiness(&self, slot: usize) -> Arc<SourceFrameGpuReadiness> {
        let mut list = self.source_frame_gpu_readiness.borrow_mut();
        if slot >= list.len() {
            list.resize_with(slot + 1, || Arc::new(SourceFrameGpuReadiness::default()));
        }
        Arc::clone(&list[slot])
    }

    /// Size a generated picture (graph output, crossfade, mix) is rendered at:
    /// the shared slot edge, or the output resolution when slots have their
    /// own textures.
    pub(crate) fn generated_frame_size(&self) -> (u32, u32) {
        match self.slots.mode() {
            SourceFrameMode::Shared => (self.source_frame_size as u32, self.source_frame_size as u32),
            SourceFrameMode::PerSource => self.slots.fitted_size(self.config.width.max(1), self.config.height.max(1)),
        }
    }

    /// Size an imported GPU picture is stored at.
    pub(crate) fn imported_frame_size(&self, width: u32, height: u32) -> (u32, u32) {
        match self.slots.mode() {
            SourceFrameMode::Shared => (self.source_frame_size as u32, self.source_frame_size as u32),
            SourceFrameMode::PerSource => self.slots.fitted_size(width, height),
        }
    }

    /// Room for slot `slot`: grows the store when it is past the end.
    pub(crate) fn ensure_slot_capacity(&self, slot: usize) -> bool {
        slot < self.slots.capacity() || self.slots.grow(&self.queue, slot + 1).is_some_and(|cap| slot < cap)
    }

    /// Rebuild the compositor and Stage3D bind groups after the store
    /// replaced a backing texture.
    pub(crate) fn refresh_source_frame_bind_groups(&mut self) {
        let generation = self.slots.generation();
        if generation == self.source_frame_bind_generation {
            return;
        }
        self.source_frames_bind_group = build_source_frames_bind_group(
            &self.device, &self.source_frames_bind_group_layout, &self.slots, self.source_frame_bindings);
        self.source_frame_bind_generation = generation;
    }

    pub(crate) fn copy_source_frame_slot(&self, input_slot: usize, output_slot: usize) {
        self.slot_readiness(output_slot).invalidate();
        let source = self.slots.slot(input_slot);
        let target = self.slots.ensure(output_slot, source.width, source.height, source.mips > 1);
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Clip transition GPU source snapshot"),
        });
        for mip_level in 0..source.mips.min(target.mips) {
            let (width, height) = source.mip_size(mip_level);
            encoder.copy_texture_to_texture(
                source.copy_info(mip_level),
                target.copy_info(mip_level),
                wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            );
        }
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        // Every level came across: the copy's chain is as current as the original's.
        self.slots.set_mips_current(output_slot, source.mips <= target.mips && self.slots.mips_current(input_slot));
        self.mark_source_frame_slots_submitted([output_slot]);
    }

    pub(crate) fn write_source_frame_level_zero(&self, slot: usize, rgba: &[u8]) -> Option<usize> {
        let edge = self.source_frame_size;
        if rgba.len() < edge * edge * 4 {
            return None;
        }
        let safe_slot = self.slots.clamp_slot(slot);
        let target = self.slots.ensure(safe_slot, edge as u32, edge as u32, true);
        let (payload, bytes_per_row) =
            source_frame_upload_payload(rgba, edge, self.source_frame_format);
        self.queue.write_texture(
            target.copy_info(0),
            &payload,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(edge as u32),
            },
            wgpu::Extent3d { width: edge as u32, height: edge as u32, depth_or_array_layers: 1 },
        );
        Some(safe_slot)
    }

    /// Per-source store: a `width` x `height` picture becomes the slot's own
    /// texture at exactly that size. Live video skips the mip chain (it is
    /// sampled at level zero); stills build it.
    pub(crate) fn write_slot_pixels(&self, slot: usize, rgba: &[u8], width: usize, height: usize, with_mips: bool) -> Option<usize> {
        if width == 0 || height == 0 || rgba.len() < width.saturating_mul(height).saturating_mul(4) {
            return None;
        }
        let safe_slot = self.slots.clamp_slot(slot);
        let target = self.slots.ensure(safe_slot, width as u32, height as u32, with_mips);
        let (payload, bytes_per_row) =
            source_frame_upload_payload_dimensions(rgba, width, height, self.source_frame_format);
        self.queue.write_texture(
            target.copy_info(0),
            &payload,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(height as u32),
            },
            wgpu::Extent3d { width: width as u32, height: height as u32, depth_or_array_layers: 1 },
        );
        if with_mips && target.mips > 1 {
            let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Source Frame Mip Encoder"),
            });
            self.generate_source_frame_mips(&mut encoder, safe_slot);
            churn_probe::submit(&self.queue, Some(encoder.finish()));
        } else {
            churn_probe::submit(&self.queue, std::iter::empty());
        }
        self.mark_source_frame_slots_submitted([safe_slot]);
        Some(payload.len())
    }

    pub(crate) fn write_video_source_frame(
        &self,
        slot: usize,
        rgba: &[u8],
        width: usize,
        height: usize,
        origin_x: usize,
        origin_y: usize,
    ) -> Option<usize> {
        // Video frames are replaced every display tick. Generating a complete
        // mip chain per source per tick creates one command submission for
        // every active video and serializes the render loop. Upload the
        // decoder-sized image directly into its source rectangle as well:
        // resizing video on the render thread stalls every active session.
        let edge = self.source_frame_size;
        if width == 0
            || height == 0
            || origin_x.saturating_add(width) > edge
            || origin_y.saturating_add(height) > edge
            || rgba.len() < width.saturating_mul(height).saturating_mul(4)
        {
            return None;
        }
        let safe_slot = self.slots.clamp_slot(slot);
        let target = self.slots.ensure(safe_slot, edge as u32, edge as u32, true);
        let (payload, bytes_per_row) =
            source_frame_upload_payload_dimensions(rgba, width, height, self.source_frame_format);
        self.queue.write_texture(
            target.copy_info_at(0, origin_x as u32, origin_y as u32),
            &payload,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(height as u32),
            },
            wgpu::Extent3d {
                width: width as u32,
                height: height as u32,
                depth_or_array_layers: 1,
            },
        );
        churn_probe::submit(&self.queue, std::iter::empty());
        self.mark_source_frame_slots_submitted([safe_slot]);
        Some(payload.len())
    }

    pub(crate) fn write_source_frame(&self, slot: usize, rgba: &[u8]) {
        let Some(safe_slot) = self.write_source_frame_level_zero(slot, rgba) else {
            return;
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Source Frame Mip Encoder"),
            });
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted([safe_slot]);
    }

    /// Erase one source frame slot, every mip level, to transparent. A
    /// per-source slot simply lets its texture go: an empty slot reads as the
    /// transparent placeholder.
    pub(crate) fn clear_source_frame_slot(&self, slot: usize) {
        self.release_shared_texture_import(slot);
        self.slot_readiness(slot).invalidate();
        if self.slots.mode() == SourceFrameMode::PerSource {
            self.slots.release(slot);
            return;
        }
        let target = self.slots.slot(slot);
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Source Frame Slot Clear"),
            });
        for mip_level in 0..target.mips.max(1) {
            let view = target.target_view("Ghost Render Core Source Frame Slot Clear View", mip_level);
            // A pass with no draws is just its clear.
            drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Ghost Render Core Source Frame Slot Clear"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            }));
        }
        churn_probe::submit(&self.queue, Some(encoder.finish()));
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn flush_hap_upload_batch(&self) {
        let Some(batch) = self.hap_upload_batch.lock().unwrap().take() else { return; };
        let Some(encoder) = batch.encoder else { return; };
        self.hap_converter.finish_uploads(&encoder);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted(batch.slots);
        self.queue.on_submitted_work_done(move || drop(batch.frames));
    }

    pub(crate) fn generate_source_frame_mips(&self, encoder: &mut wgpu::CommandEncoder, slot: usize) {
        let target = self.slots.slot(slot);
        for mip_level in 1..target.mips {
            let source_view = target.target_view("Ghost Render Core Source Frame Mip Source", mip_level - 1);
            let target_view = target.target_view("Ghost Render Core Source Frame Mip Target", mip_level);
            self.source_frame_mips.encode(&self.device, encoder, &source_view, &target_view);
        }
        self.slots.set_mips_current(slot, true);
    }
}
