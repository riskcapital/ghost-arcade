//! Picture slots. Every layer's current picture (a decoded video frame, an
//! image, a shader or graph output) lives in a numbered slot. Two stores sit
//! behind one API, picked once per device:
//!
//! - `Shared`: one 2D array texture, every slot the same square size. When
//!   every slot is taken the array is rebuilt with twice the layers and the
//!   pictures copied across, up to the device's array-layer limit and the
//!   memory budget. The fallback for GPUs without texture binding arrays.
//! - `PerSource`: each slot is its own texture at its picture's own size, so
//!   a 1080p clip stays 1080p and the slot count is bound only by memory. The
//!   compositor reads them through a binding array.
//!
//! Callers never index the backing textures directly: they ask for a
//! [`SlotRef`] (texture + array layer + size) and copy, render or sample
//! through it. `generation` changes whenever a backing texture object is
//! replaced, so bind groups holding views can be rebuilt lazily.

use std::cell::RefCell;

/// Mip levels kept for a picture: enough to soften minification, no more
/// (live video samples level 0 only).
pub(crate) const MAX_SLOT_MIPS: u32 = 5;

pub(crate) fn slot_mip_levels(width: u32, height: u32) -> u32 {
    let edge = width.max(height).max(1);
    (u32::BITS - edge.leading_zeros()).clamp(1, MAX_SLOT_MIPS)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourceFrameMode {
    Shared,
    PerSource,
}

impl SourceFrameMode {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Shared => "shared-array",
            Self::PerSource => "per-source",
        }
    }
}

/// One slot's backing storage: a texture and the array layer inside it.
#[derive(Clone, Debug)]
pub(crate) struct SlotRef {
    pub texture: wgpu::Texture,
    pub layer: u32,
    pub width: u32,
    pub height: u32,
    pub mips: u32,
}

impl SlotRef {
    pub(crate) fn mip_size(&self, mip: u32) -> (u32, u32) {
        ((self.width >> mip).max(1), (self.height >> mip).max(1))
    }

    pub(crate) fn copy_info(&self, mip_level: u32) -> wgpu::TexelCopyTextureInfo<'_> {
        self.copy_info_at(mip_level, 0, 0)
    }

    pub(crate) fn copy_info_at(&self, mip_level: u32, x: u32, y: u32) -> wgpu::TexelCopyTextureInfo<'_> {
        wgpu::TexelCopyTextureInfo {
            texture: &self.texture,
            mip_level,
            origin: wgpu::Origin3d { x, y, z: self.layer },
            aspect: wgpu::TextureAspect::All,
        }
    }

    /// A 2D view of this slot: `mip_count` levels from `base_mip`.
    pub(crate) fn view(&self, label: &str, base_mip: u32, mip_count: u32) -> wgpu::TextureView {
        self.texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some(label),
            format: Some(self.texture.format()),
            dimension: Some(wgpu::TextureViewDimension::D2),
            base_mip_level: base_mip.min(self.mips - 1),
            mip_level_count: Some(mip_count.clamp(1, self.mips - base_mip.min(self.mips - 1))),
            base_array_layer: self.layer,
            array_layer_count: Some(1),
            ..Default::default()
        })
    }

    /// Single-level view to render into.
    pub(crate) fn target_view(&self, label: &str, mip: u32) -> wgpu::TextureView {
        self.view(label, mip, 1)
    }

    /// Every level, for sampling.
    pub(crate) fn sample_view(&self, label: &str) -> wgpu::TextureView {
        self.view(label, 0, self.mips)
    }

}

struct Inner {
    capacity: usize,
    shared: Option<wgpu::Texture>,
    slots: Vec<Option<SlotRef>>,
    generation: u64,
}

pub(crate) struct SourceFrameStore {
    device: wgpu::Device,
    mode: SourceFrameMode,
    format: wgpu::TextureFormat,
    /// Shared mode: every slot's edge. PerSource: the edge of generated
    /// pictures that have no size of their own (cleared/empty slots).
    shared_size: u32,
    shared_mips: u32,
    max_capacity: usize,
    max_dimension: u32,
    inner: RefCell<Inner>,
    empty: SlotRef,
}

fn slot_usage() -> wgpu::TextureUsages {
    wgpu::TextureUsages::TEXTURE_BINDING
        | wgpu::TextureUsages::COPY_DST
        | wgpu::TextureUsages::COPY_SRC
        | wgpu::TextureUsages::RENDER_ATTACHMENT
}

fn create_texture(device: &wgpu::Device, label: &str, format: wgpu::TextureFormat,
    width: u32, height: u32, layers: u32, mips: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: layers },
        mip_level_count: mips,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: slot_usage(),
        view_formats: &[],
    })
}

impl SourceFrameStore {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        mode: SourceFrameMode,
        format: wgpu::TextureFormat,
        shared_size: u32,
        shared_mips: u32,
        initial_capacity: usize,
        max_capacity: usize,
        max_dimension: u32,
    ) -> Self {
        let max_capacity = max_capacity.max(initial_capacity).max(1);
        let initial_capacity = initial_capacity.clamp(1, max_capacity);
        let shared = (mode == SourceFrameMode::Shared).then(|| create_texture(
            device, "Ghost Render Core Source Frames", format, shared_size, shared_size,
            initial_capacity as u32, shared_mips));
        // A transparent 1x1 picture for every per-source slot with nothing in it.
        let empty_texture = create_texture(device, "Ghost Render Core Empty Source Frame", format, 1, 1, 1, 1);
        let texel = vec![0u8; wgpu_texel_bytes(format) as usize];
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &empty_texture, mip_level: 0,
                origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &texel,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(texel.len() as u32), rows_per_image: Some(1) },
            wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
        );
        Self {
            device: device.clone(),
            mode,
            format,
            shared_size,
            shared_mips,
            max_capacity,
            max_dimension: max_dimension.max(1),
            inner: RefCell::new(Inner {
                capacity: initial_capacity,
                shared,
                slots: vec![None; initial_capacity],
                generation: 1,
            }),
            empty: SlotRef { texture: empty_texture, layer: 0, width: 1, height: 1, mips: 1 },
        }
    }

    pub(crate) fn mode(&self) -> SourceFrameMode { self.mode }
    pub(crate) fn capacity(&self) -> usize { self.inner.borrow().capacity }
    pub(crate) fn max_capacity(&self) -> usize { self.max_capacity }
    pub(crate) fn generation(&self) -> u64 { self.inner.borrow().generation }
    pub(crate) fn max_dimension(&self) -> u32 { self.max_dimension }

    pub(crate) fn clamp_slot(&self, slot: usize) -> usize {
        slot.min(self.capacity().saturating_sub(1))
    }

    /// Where `slot` lives now. A per-source slot with no picture yet reads as
    /// the transparent 1x1 placeholder.
    pub(crate) fn slot(&self, slot: usize) -> SlotRef {
        let inner = self.inner.borrow();
        let slot = slot.min(inner.capacity.saturating_sub(1));
        match self.mode {
            SourceFrameMode::Shared => SlotRef {
                texture: inner.shared.clone().expect("shared source-frame array"),
                layer: slot as u32,
                width: self.shared_size,
                height: self.shared_size,
                mips: self.shared_mips,
            },
            SourceFrameMode::PerSource => inner.slots[slot].clone().unwrap_or_else(|| self.empty.clone()),
        }
    }

    /// The size a picture of `width` x `height` is stored at in a slot.
    pub(crate) fn fitted_size(&self, width: u32, height: u32) -> (u32, u32) {
        let (width, height) = (width.max(1), height.max(1));
        let limit = match self.mode {
            SourceFrameMode::Shared => self.shared_size,
            SourceFrameMode::PerSource => self.max_dimension,
        };
        let scale = (limit as f32 / width as f32).min(limit as f32 / height as f32).min(1.0);
        (((width as f32 * scale).round() as u32).clamp(1, limit),
            ((height as f32 * scale).round() as u32).clamp(1, limit))
    }

    /// Storage for a `width` x `height` picture in `slot`. Shared mode always
    /// answers the slot's layer (the picture goes in a sub-rectangle);
    /// PerSource (re)allocates a texture of exactly that size, keeping the
    /// existing one when it already matches.
    pub(crate) fn ensure(&self, slot: usize, width: u32, height: u32, with_mips: bool) -> SlotRef {
        if self.mode == SourceFrameMode::Shared {
            return self.slot(slot);
        }
        let (width, height) = self.fitted_size(width, height);
        let mips = if with_mips { slot_mip_levels(width, height) } else { 1 };
        let mut inner = self.inner.borrow_mut();
        let index = slot.min(inner.capacity.saturating_sub(1));
        if let Some(existing) = &inner.slots[index]
            && existing.width == width && existing.height == height && existing.mips >= mips
        {
            return existing.clone();
        }
        let texture = create_texture(&self.device, "Ghost Render Core Source Frame", self.format,
            width, height, 1, mips);
        let slot_ref = SlotRef { texture, layer: 0, width, height, mips };
        inner.slots[index] = Some(slot_ref.clone());
        inner.generation += 1;
        slot_ref
    }

    /// Storage for a picture the core generates (a graph or shader output).
    pub(crate) fn ensure_generated(&self, slot: usize, width: u32, height: u32) -> SlotRef {
        self.ensure(slot, width, height, true)
    }

    /// Forget a per-source slot's texture (its picture is gone).
    pub(crate) fn release(&self, slot: usize) {
        if self.mode != SourceFrameMode::PerSource {
            return;
        }
        let mut inner = self.inner.borrow_mut();
        if let Some(entry) = inner.slots.get_mut(slot)
            && entry.take().is_some()
        {
            inner.generation += 1;
        }
    }

    /// Room for at least `wanted` slots. Shared mode rebuilds the array and
    /// copies every picture across. Returns the new capacity, or None at the
    /// limit.
    pub(crate) fn grow(&self, queue: &wgpu::Queue, wanted: usize) -> Option<usize> {
        let current = self.capacity();
        if wanted <= current {
            return Some(current);
        }
        if current >= self.max_capacity {
            return None;
        }
        let next = wanted.max(current.saturating_mul(2)).min(self.max_capacity);
        let mut inner = self.inner.borrow_mut();
        if self.mode == SourceFrameMode::Shared {
            let old = inner.shared.take().expect("shared source-frame array");
            let new = create_texture(&self.device, "Ghost Render Core Source Frames", self.format,
                self.shared_size, self.shared_size, next as u32, self.shared_mips);
            let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Source Frame Grow"),
            });
            for mip_level in 0..self.shared_mips {
                let edge = (self.shared_size >> mip_level).max(1);
                encoder.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo { texture: &old, mip_level, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                    wgpu::TexelCopyTextureInfo { texture: &new, mip_level, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                    wgpu::Extent3d { width: edge, height: edge, depth_or_array_layers: current as u32 },
                );
            }
            queue.submit(Some(encoder.finish()));
            inner.shared = Some(new);
        }
        inner.slots.resize(next, None);
        inner.capacity = next;
        inner.generation += 1;
        Some(next)
    }

    /// One view per slot (placeholder for empty ones), padded with the
    /// placeholder to `count`: the compositor's binding array.
    pub(crate) fn binding_array_views(&self, count: usize) -> Vec<wgpu::TextureView> {
        let inner = self.inner.borrow();
        (0..count)
            .map(|index| inner.slots.get(index).cloned().flatten().unwrap_or_else(|| self.empty.clone())
                .sample_view("Ghost Render Core Source Frame Binding"))
            .collect()
    }

    /// The whole shared array as one view (Shared mode).
    pub(crate) fn shared_array_view(&self) -> Option<wgpu::TextureView> {
        self.inner.borrow().shared.as_ref().map(|texture| texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Source Frame View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        }))
    }

    /// Bytes the store holds on the GPU now.
    pub(crate) fn resident_bytes(&self) -> u64 {
        let texel = wgpu_texel_bytes(self.format) as u64;
        let level_bytes = |w: u32, h: u32, mips: u32| -> u64 {
            (0..mips).map(|m| ((w >> m).max(1) as u64) * ((h >> m).max(1) as u64) * texel).sum()
        };
        let inner = self.inner.borrow();
        match self.mode {
            SourceFrameMode::Shared => level_bytes(self.shared_size, self.shared_size, self.shared_mips) * inner.capacity as u64,
            SourceFrameMode::PerSource => inner.slots.iter().flatten().map(|s| level_bytes(s.width, s.height, s.mips)).sum(),
        }
    }
}

pub(crate) fn wgpu_texel_bytes(format: wgpu::TextureFormat) -> u32 {
    format.block_copy_size(None).unwrap_or(4)
}

/// WGSL that declares `source_frames` and the slot readers the compositor
/// uses, for either store. `binding` is the texture binding index; `count`
/// the binding-array length (PerSource).
pub(crate) fn compositor_source_frames_wgsl(mode: SourceFrameMode, group: u32, binding: u32, count: usize) -> String {
    match mode {
        SourceFrameMode::Shared => format!(r#"
@group({group}) @binding({binding})
var source_frames: texture_2d_array<f32>;
fn source_frame_count() -> i32 {{ return i32(textureNumLayers(source_frames)); }}
fn source_frame_dims(slot: i32) -> vec2<i32> {{ return vec2<i32>(textureDimensions(source_frames, 0)); }}
fn source_frame_load(slot: i32, xy: vec2<i32>) -> vec4<f32> {{ return textureLoad(source_frames, xy, slot, 0); }}
fn source_frame_sample(slot: i32, smp: sampler, uv: vec2<f32>) -> vec4<f32> {{ return textureSampleLevel(source_frames, smp, uv, slot, 0.0); }}
"#),
        SourceFrameMode::PerSource => format!(r#"
@group({group}) @binding({binding})
var source_frames: binding_array<texture_2d<f32>, {count}>;
fn source_frame_count() -> i32 {{ return {count}; }}
fn source_frame_dims(slot: i32) -> vec2<i32> {{ return vec2<i32>(textureDimensions(source_frames[slot], 0)); }}
fn source_frame_load(slot: i32, xy: vec2<i32>) -> vec4<f32> {{ return textureLoad(source_frames[slot], xy, 0); }}
fn source_frame_sample(slot: i32, smp: sampler, uv: vec2<f32>) -> vec4<f32> {{ return textureSampleLevel(source_frames[slot], smp, uv, 0.0); }}
"#),
    }
}

/// Directive a shader needs at its very top to declare the per-source
/// binding array.
pub(crate) fn source_frames_enable(mode: SourceFrameMode) -> &'static str {
    match mode {
        SourceFrameMode::Shared => "",
        SourceFrameMode::PerSource => "enable wgpu_binding_array;\n",
    }
}

/// Binding layout entry matching [`compositor_source_frames_wgsl`].
pub(crate) fn source_frames_layout_entry(mode: SourceFrameMode, binding: u32, count: usize,
    visibility: wgpu::ShaderStages) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: match mode {
                SourceFrameMode::Shared => wgpu::TextureViewDimension::D2Array,
                SourceFrameMode::PerSource => wgpu::TextureViewDimension::D2,
            },
            multisampled: false,
        },
        count: match mode {
            SourceFrameMode::Shared => None,
            SourceFrameMode::PerSource => std::num::NonZeroU32::new(count as u32),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mip_levels_follow_the_longest_edge() {
        assert_eq!(slot_mip_levels(1, 1), 1);
        assert_eq!(slot_mip_levels(16, 2), 5);
        assert_eq!(slot_mip_levels(1920, 1080), MAX_SLOT_MIPS);
    }

    #[test]
    fn both_store_preludes_parse() {
        for mode in [SourceFrameMode::Shared, SourceFrameMode::PerSource] {
            let source = format!("{}{}\n@group(0) @binding(4) var smp: sampler;\n@fragment fn main() -> @location(0) vec4<f32> {{ return source_frame_sample(1, smp, vec2<f32>(0.5)) + source_frame_load(0, vec2<i32>(0)) + vec4<f32>(f32(source_frame_count() + source_frame_dims(0).x)); }}",
                source_frames_enable(mode), compositor_source_frames_wgsl(mode, 0, 3, 64));
            naga::front::wgsl::parse_str(&source).unwrap_or_else(|error| panic!("{mode:?}: {error}"));
        }
    }
}
