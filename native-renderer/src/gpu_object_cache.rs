//! Reuse of texture views and bind groups from one frame to the next.
//!
//! The graph passes (effect chains, composition FX, ISF passes) asked wgpu
//! for a fresh view of every texture they read or wrote and a fresh bind
//! group for every pass, every frame: hundreds of driver objects a frame for
//! a deck with effects. Both are immutable descriptions of resources, so one
//! made from the same resources is interchangeable with the last one: this
//! hands back the one made before.
//!
//! Keys hold the resources themselves (wgpu compares them by identity), so a
//! resource that is replaced, resized or recreated after a device loss can
//! never match an old entry. An entry not used for `KEEP_FRAMES` frames is
//! dropped, which also releases what it holds. Main thread only, like the
//! renderer that uses it.

use std::{cell::RefCell, collections::HashMap, num::NonZeroU64};

/// Frames an unused entry is kept. Two covers ping-pong targets that are
/// read on alternate frames.
const KEEP_FRAMES: u64 = 2;

#[derive(Clone, PartialEq, Eq, Hash)]
struct ViewKey {
    texture: wgpu::Texture,
    format: Option<wgpu::TextureFormat>,
    dimension: Option<wgpu::TextureViewDimension>,
    usage: Option<wgpu::TextureUsages>,
    aspect: wgpu::TextureAspect,
    base_mip_level: u32,
    mip_level_count: Option<u32>,
    base_array_layer: u32,
    array_layer_count: Option<u32>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
enum ResourceKey {
    Buffer(wgpu::Buffer, u64, Option<NonZeroU64>),
    View(wgpu::TextureView),
    Sampler(wgpu::Sampler),
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct BindGroupKey {
    layout: wgpu::BindGroupLayout,
    entries: Vec<(u32, ResourceKey)>,
}

#[derive(Default)]
struct Cache {
    frame: u64,
    views: HashMap<ViewKey, (wgpu::TextureView, u64)>,
    bind_groups: HashMap<BindGroupKey, (wgpu::BindGroup, u64)>,
}

thread_local! {
    static CACHE: RefCell<Cache> = RefCell::new(Cache::default());
}

/// Start a frame: forget what the last frames did not use.
pub fn begin_frame() {
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        cache.frame = cache.frame.wrapping_add(1);
        let frame = cache.frame;
        cache.views.retain(|_, (_, used)| frame.wrapping_sub(*used) <= KEEP_FRAMES);
        cache.bind_groups.retain(|_, (_, used)| frame.wrapping_sub(*used) <= KEEP_FRAMES);
    });
}

/// A view of `texture` as `desc` describes it (its label aside).
pub fn view(texture: &wgpu::Texture, desc: &wgpu::TextureViewDescriptor) -> wgpu::TextureView {
    let key = ViewKey {
        texture: texture.clone(),
        format: desc.format,
        dimension: desc.dimension,
        usage: desc.usage,
        aspect: desc.aspect,
        base_mip_level: desc.base_mip_level,
        mip_level_count: desc.mip_level_count,
        base_array_layer: desc.base_array_layer,
        array_layer_count: desc.array_layer_count,
    };
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let frame = cache.frame;
        if let Some((view, used)) = cache.views.get_mut(&key) {
            *used = frame;
            return view.clone();
        }
        crate::churn_probe::texture_view();
        let view = texture.create_view(desc);
        cache.views.insert(key, (view.clone(), frame));
        view
    })
}

fn resource_key(resource: &wgpu::BindingResource) -> Option<ResourceKey> {
    match resource {
        wgpu::BindingResource::Buffer(binding) => {
            Some(ResourceKey::Buffer(binding.buffer.clone(), binding.offset, binding.size))
        }
        wgpu::BindingResource::TextureView(view) => Some(ResourceKey::View((*view).clone())),
        wgpu::BindingResource::Sampler(sampler) => Some(ResourceKey::Sampler((*sampler).clone())),
        // Arrays and the rest are made directly (none of them is per frame).
        _ => None,
    }
}

/// A bind group of `layout` with `entries`: the one made before for the
/// same resources, or a new one.
pub fn bind_group(
    device: &wgpu::Device,
    label: Option<&str>,
    layout: &wgpu::BindGroupLayout,
    entries: &[wgpu::BindGroupEntry],
) -> wgpu::BindGroup {
    let keys = entries
        .iter()
        .map(|entry| resource_key(&entry.resource).map(|key| (entry.binding, key)))
        .collect::<Option<Vec<_>>>();
    let create = || {
        crate::churn_probe::bind_group();
        device.create_bind_group(&wgpu::BindGroupDescriptor { label, layout, entries })
    };
    let Some(entries_key) = keys else { return create() };
    let key = BindGroupKey { layout: layout.clone(), entries: entries_key };
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let frame = cache.frame;
        if let Some((group, used)) = cache.bind_groups.get_mut(&key) {
            *used = frame;
            return group.clone();
        }
        let group = create();
        cache.bind_groups.insert(key, (group.clone(), frame));
        group
    })
}

#[cfg(test)]
pub fn sizes() -> (usize, usize) {
    CACHE.with(|cache| {
        let cache = cache.borrow();
        (cache.views.len(), cache.bind_groups.len())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> Option<wgpu::Device> {
        let instance = wgpu::Instance::default();
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).ok()?;
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok().map(|(device, _)| device)
    }

    fn texture(device: &wgpu::Device) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: 4, height: 4, depth_or_array_layers: 2 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
    }

    #[test]
    fn views_and_bind_groups_are_reused_only_for_the_same_resources() {
        // No adapter (a headless CI runner): nothing to check.
        let Some(device) = device() else { return };
        begin_frame();
        let a = texture(&device);
        let b = texture(&device);
        let layer = |n: u32| wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2),
            base_array_layer: n,
            array_layer_count: Some(1),
            ..Default::default()
        };
        let first = view(&a, &layer(0));
        assert!(first == view(&a, &wgpu::TextureViewDescriptor { label: Some("another label"), ..layer(0) }));
        assert!(first != view(&a, &layer(1)), "another layer is another view");
        assert!(first != view(&b, &layer(0)), "another texture is another view");

        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let group = |v: &wgpu::TextureView| bind_group(&device, None, &layout, &[wgpu::BindGroupEntry {
            binding: 0,
            resource: wgpu::BindingResource::TextureView(v),
        }]);
        let g0 = group(&first);
        let g1 = group(&first);
        let other = view(&b, &layer(0));
        let g2 = group(&other);
        // Same resources: the same bind group; others: a new one.
        assert!(g0 == g1);
        assert!(g0 != g2);
        assert_eq!(sizes(), (3, 2));

        // Unused for longer than KEEP_FRAMES: dropped.
        for _ in 0..=KEEP_FRAMES {
            begin_frame();
        }
        assert_eq!(sizes(), (0, 0));
    }
}
