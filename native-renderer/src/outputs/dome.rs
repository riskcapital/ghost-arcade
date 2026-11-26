//! The dome: mirror meshes, the dome rig and its renderer, and the dome
//! view.

use crate::*;

/// A mirror dome warp mesh (Paul Bourke's format; see
/// src/lib/output/mirrorMesh.ts), ready to draw: each vertex's place on the
/// projector's image (x across -aspect..aspect, y -1..1), the fisheye
/// (domemaster) point it shows (u, v, 0..1, v up) and its brightness, and
/// two triangles for every grid cell whose four corners are in use.
#[derive(Debug)]
pub(crate) struct MirrorMesh {
    pub(crate) id: String,
    pub(crate) vertices: Vec<[f32; 5]>,
    pub(crate) indices: Vec<u32>,
}

impl MirrorMesh {
    pub(crate) fn from_command(command: &Value) -> Result<Self, String> {
        let id = string_at(command, &["mesh_id"])
            .filter(|id| !id.is_empty())
            .ok_or("set_mirror_mesh needs a mesh_id")?;
        let count = |key: &str| command.get(key).and_then(Value::as_u64).unwrap_or(0) as usize;
        let (cols, rows) = (count("cols"), count("rows"));
        if cols < 2 || rows < 2 || cols * rows > 512 * 512 {
            return Err(format!("mirror mesh {id}: a {cols} by {rows} grid is not one this core draws"));
        }
        let nodes: Vec<f32> = command
            .get("nodes")
            .and_then(Value::as_array)
            .map(|values| values.iter().map(|v| v.as_f64().unwrap_or(f64::NAN) as f32).collect())
            .unwrap_or_default();
        if nodes.len() < cols * rows * 5 {
            return Err(format!("mirror mesh {id}: {} values for a {cols} by {rows} grid", nodes.len()));
        }
        let vertices: Vec<[f32; 5]> = (0..cols * rows)
            .map(|k| [nodes[k * 5], nodes[k * 5 + 1], nodes[k * 5 + 2], nodes[k * 5 + 3], nodes[k * 5 + 4]])
            .collect();
        // A node is unused when it is not drawn (brightness below 0) or
        // shows no point of the fisheye (u or v outside 0..1).
        let used = |k: usize| {
            let [x, y, u, v, i] = vertices[k];
            [x, y, u, v, i].iter().all(|value| value.is_finite())
                && i >= 0.0 && (0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&v)
        };
        // A polar mesh (type 1) wraps its columns round.
        let wrap = command.get("mesh_type").and_then(Value::as_u64) == Some(1);
        let across = if wrap { cols } else { cols - 1 };
        let mut indices = Vec::new();
        for r in 0..rows - 1 {
            for c in 0..across {
                let c1 = (c + 1) % cols;
                let corners = [r * cols + c, r * cols + c1, (r + 1) * cols + c1, (r + 1) * cols + c];
                if corners.iter().all(|&k| used(k)) {
                    let [a, b, e, d] = corners.map(|k| k as u32);
                    indices.extend_from_slice(&[a, b, e, a, e, d]);
                }
            }
        }
        if indices.is_empty() {
            return Err(format!("mirror mesh {id}: no cell of it is drawn"));
        }
        Ok(Self { id, vertices, indices })
    }
}

/// Every projector of a dome rig (`set_slice_outputs`' domeRig): ids in
/// rig order and their frusta packed as `OutputStage::dprojs`. A Screen
/// that is one of them blends against all of them, whether or not their
/// own outputs are open.
pub(crate) struct DomeRig {
    pub(crate) ids: Vec<String>,
    pub(crate) frusta: [[f32; 4]; 32],
    pub(crate) blend_width: f32,
    pub(crate) blend_gamma: f32,
}

impl DomeRig {
    pub(crate) fn from_params(rig: Option<&Value>) -> Self {
        let mut out = Self { ids: Vec::new(), frusta: [[0.0; 4]; 32], blend_width: 0.25, blend_gamma: 2.2 };
        let Some(rig) = rig else { return out };
        out.blend_width = number_at(rig, &["blendWidth"]).filter(|v| v.is_finite()).unwrap_or(0.25).clamp(0.0, 1.0) as f32;
        out.blend_gamma = number_at(rig, &["blendGamma"]).filter(|v| v.is_finite()).unwrap_or(2.2).clamp(0.1, 4.0) as f32;
        for projector in rig.get("projectors").and_then(Value::as_array).into_iter().flatten().take(8) {
            let Some(id) = string_at(projector, &["id"]) else { continue };
            let values: Vec<f32> = projector
                .get("frustum")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_f64).map(|v| v as f32).collect())
                .unwrap_or_default();
            if values.len() < 16 || values.iter().any(|v| !v.is_finite()) {
                continue;
            }
            let slot = out.ids.len() * 4;
            for row in 0..4 {
                out.frusta[slot + row] = [values[row * 4], values[row * 4 + 1], values[row * 4 + 2], values[row * 4 + 3]];
            }
            out.ids.push(id);
        }
        out
    }
}

/// The square domemaster a mirror dome Screen is drawn from: Paul Bourke
/// suggests 2048 for HD projectors.
pub(crate) const MIRROR_MASTER_SIZE: u32 = 2048;

pub(crate) const MIRROR_MESH_WGSL: &str = r#"
struct MirrorUniforms { aspect: vec4<f32> };
@group(0) @binding(0) var dome_master: texture_2d<f32>;
@group(0) @binding(1) var dome_sampler: sampler;
@group(0) @binding(2) var<uniform> mu: MirrorUniforms;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) intensity: f32,
};

@vertex
fn vs_mirror(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>, @location(2) intensity: f32) -> VsOut {
  var out: VsOut;
  // The mesh spans -aspect..aspect across, -1..1 up: the projector's frame.
  out.position = vec4<f32>(pos.x / max(mu.aspect.x, 0.01), pos.y, 0.0, 1.0);
  out.uv = uv;
  out.intensity = intensity;
  return out;
}

@fragment
fn fs_mirror(in: VsOut) -> @location(0) vec4<f32> {
  // v is up; the texture's rows run down.
  let color = textureSample(dome_master, dome_sampler, vec2<f32>(in.uv.x, 1.0 - in.uv.y)).rgb;
  return vec4<f32>(color * clamp(in.intensity, 0.0, 1.0), 1.0);
}
"#;

pub(crate) struct MirrorMeshGpu {
    pub(crate) vertices: wgpu::Buffer,
    pub(crate) indices: wgpu::Buffer,
    pub(crate) count: u32,
}

pub(crate) struct MirrorRenderer {
    pub(crate) pipeline: wgpu::RenderPipeline,
    pub(crate) uniform: wgpu::Buffer,
    pub(crate) bind_group: wgpu::BindGroup,
    pub(crate) _master: wgpu::Texture,
    pub(crate) master_view: wgpu::TextureView,
    pub(crate) meshes: HashMap<String, MirrorMeshGpu>,
}

impl MirrorRenderer {
    pub(crate) fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        Self::build(device, format, MIRROR_MASTER_SIZE)
    }

    /// Build the pipeline once and let it go (the master at one texel), so
    /// the driver's shader cache holds it before the first mirror dome
    /// Screen needs it. Any thread.
    pub(crate) fn prewarm(device: &wgpu::Device, format: wgpu::TextureFormat) {
        let _ = Self::build(device, format, 1);
    }

    pub(crate) fn build(device: &wgpu::Device, format: wgpu::TextureFormat, master_size: u32) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Mirror dome mesh"),
            source: wgpu::ShaderSource::Wgsl(MIRROR_MESH_WGSL.into()),
        });
        let master = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Mirror dome master"),
            size: wgpu::Extent3d { width: master_size, height: master_size, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let master_view = master.create_view(&Default::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Mirror dome master"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Mirror dome mesh uniforms"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Mirror dome mesh"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Mirror dome mesh"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&master_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) },
                wgpu::BindGroupEntry { binding: 2, resource: uniform.as_entire_binding() },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Mirror dome mesh"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Mirror dome mesh"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_mirror"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 20,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Float32],
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_mirror"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: pipeline_cache::for_device(device).as_ref(),
        });
        Self { pipeline, uniform, bind_group, _master: master, master_view, meshes: HashMap::new() }
    }
}

impl App {
    /// Keeps a mirror dome warp mesh and attaches it to the Screens that
    /// name it. Meshes are few and kept by content, so a re-sent one is
    /// the same mesh.
    pub(crate) fn apply_mirror_mesh(&mut self, command: &Value) -> Result<(), String> {
        let mesh = Arc::new(MirrorMesh::from_command(command)?);
        for spec in Arc::make_mut(&mut self.slice_outputs).iter_mut() {
            if spec.mirror_mesh_id.as_deref() == Some(mesh.id.as_str()) {
                spec.mirror_mesh = Some(Arc::clone(&mesh));
            }
        }
        if self.mirror_meshes.len() >= 16 {
            let named: Vec<String> = self.slice_outputs.iter().filter_map(|spec| spec.mirror_mesh_id.clone()).collect();
            self.mirror_meshes.retain(|id, _| named.contains(id));
        }
        self.mirror_meshes.insert(mesh.id.clone(), mesh);
        Ok(())
    }

    /// The editor's view from inside the dome: on or off, where it looks
    /// (azimuth and elevation, degrees) and how wide (vertical, degrees).
    pub(crate) fn apply_dome_view(&mut self, command: &Value) {
        let enabled = bool_at(command, &["enabled"]).unwrap_or(false);
        let read = |key: &str, fallback: f64| number_at(command, &[key]).filter(|v| v.is_finite()).unwrap_or(fallback);
        self.dome_view = enabled.then(|| {
            [
                [
                    1.0,
                    read("azimuth", 0.0).to_radians() as f32,
                    read("elevation", 30.0).clamp(-89.0, 89.0).to_radians() as f32,
                    (read("fov", 80.0).clamp(10.0, 160.0) * 0.5).to_radians().tan() as f32,
                ],
                [
                    // Where the eye sits: 0 the dome's center, 1 the back
                    // of the room (in dome radii, along the look's back).
                    read("back", 0.0).clamp(0.0, 1.0) as f32,
                    if bool_at(command, &["room"]).unwrap_or(true) { 1.0 } else { 0.0 },
                    0.0,
                    0.0,
                ],
            ]
        });
    }

    /// Places a layer on the dome, or back on the canvas. Degrees in;
    /// stored as `LayerGpu::dome` (radians, half width as a tangent).
    pub(crate) fn apply_layer_dome(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let enabled = bool_at(command, &["enabled"]).unwrap_or(false);
        let read = |key: &str, fallback: f64| number_at(command, &[key]).unwrap_or(fallback);
        let place = enabled.then(|| dome_place_gpu(read("azimuth", 0.0), read("elevation", 90.0), read("size", 60.0), read("roll", 0.0)));
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.dome = place;
    }
}

impl RenderState {
    /// Shared-texture metadata for both deck monitors — same shape the
    /// output export uses so the electron presenter pump can reuse its
    /// import path.
    /// Gets a mirror mesh's buffers (and the mirror pass itself) ready to
    /// draw. Before the encoder, so drawing needs no mutable borrow.
    pub(crate) fn prepare_mirror_mesh(&mut self, mesh: &MirrorMesh) {
        if self.mirror.is_none() {
            self.mirror = Some(MirrorRenderer::new(&self.device, self.config.format));
        }
        let Some(mirror) = self.mirror.as_mut() else { return };
        if !mirror.meshes.contains_key(&mesh.id) {
            if mirror.meshes.len() >= 8 {
                mirror.meshes.clear();
            }
            let vertices = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Mirror mesh vertices"),
                contents: bytemuck::cast_slice(&mesh.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let indices = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Mirror mesh indices"),
                contents: bytemuck::cast_slice(&mesh.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
            mirror.meshes.insert(mesh.id.clone(), MirrorMeshGpu { vertices, indices, count: mesh.indices.len() as u32 });
        }
    }

    /// A mirror dome Screen: the dome picture is drawn as a square
    /// domemaster (the output stage with the Screen's dome, grade and dome
    /// layers, but none of its flat crop, warp, blend or masks), then
    /// through the warp mesh as geometry, each vertex taking its fisheye
    /// point and brightness, as Paul Bourke's players do.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn draw_mirror_dome(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        width: u32,
        height: u32,
        output_gate: f32,
        stage: OutputStage,
        time: f32,
        mesh_id: &str,
    ) {
        let Some(mirror) = self.mirror.as_ref() else { return };
        let Some(mesh) = mirror.meshes.get(mesh_id) else { return };
        let master_stage = OutputStage {
            out0: [0.0, 0.0, 1.0, 1.0],
            out1: [0.0, stage.out1[1], stage.out1[2], stage.out1[3]],
            edge: [0.0; 4],
            dome1: [stage.dome1[0], 0.0, 0.0, stage.dome1[3]],
            dome2: [stage.dome2[0], 2.2, 0.0, 0.0],
            ..OutputStage {
                dome0: stage.dome0,
                dome1: stage.dome1,
                dome3: stage.dome3,
                dome4: stage.dome4,
                dlayer: stage.dlayer,
                ..OutputStage::default()
            }
        };
        self.output_presenter.draw(&self.queue, encoder, &mirror.master_view, self.creative_frame_index,
            MIRROR_MASTER_SIZE, MIRROR_MASTER_SIZE, output_gate, master_stage, time);
        let aspect = width.max(1) as f32 / height.max(1) as f32;
        churn_probe::write_buffer(&self.queue, &mirror.uniform, 0, bytemuck::cast_slice(&[aspect, 0.0f32, 0.0, 0.0]));
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Mirror dome mesh"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&mirror.pipeline);
        pass.set_bind_group(0, &mirror.bind_group, &[]);
        pass.set_vertex_buffer(0, mesh.vertices.slice(..));
        pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..mesh.count, 0, 0..1);
    }

    /// The Inside view's texture, described like the program output's
    /// (output_export_metadata) so the editor preview can show either.
    pub(crate) fn dome_view_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            if let Some(target) = self.dome_view_target.as_ref() {
                let export = &target.export;
                return json!({
                    "available": true,
                    "platform": "iosurface",
                    "handle": export.surface.id().to_string(),
                    "handle_encoding": "integer",
                    "handle_scope": "global-id",
                    "preferred_transport": "handle",
                    "handle_byte_length": 4,
                    "width": export.width,
                    "height": export.height,
                    "format": texture_format_label(export.format),
                    "color_space": "srgb",
                    "alpha_mode": "opaque",
                    "single_render_source": "core-dome-view",
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(target) = self.dome_view_target.as_ref() {
                let export = &target.export;
                return json!({
                    "available": true,
                    "platform": "dxgi",
                    "handle": (export.shared_handle.0 as usize).to_string(),
                    "handle_encoding": "integer",
                    "handle_scope": "process-local",
                    "preferred_transport": "shared_name",
                    "handle_byte_length": 8,
                    "name": export.shared_name.clone(),
                    "shared_name": export.shared_name.clone(),
                    "width": export.width,
                    "height": export.height,
                    "format": texture_format_label(export.format),
                    "color_space": "srgb",
                    "alpha_mode": "opaque",
                    "single_render_source": "core-dome-view",
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        json!({ "available": false })
    }

    /// Draws the editor's Inside view of the dome (`stage.dview`), or drops
    /// its target when the view is off. Same pass as a Screen's, from the
    /// same master, at the composition's size so it fills the editor canvas.
    pub(crate) fn render_dome_view(&mut self, stage: Option<OutputStage>, output_gate: f32, time_seconds: Option<f32>) {
        let Some(stage) = stage else {
            self.dome_view_target = None;
            return;
        };
        let width = self.config.width.clamp(16, 4096);
        let height = self.config.height.clamp(16, 4096);
        if self.dome_view_target.as_ref().map(|target| (target.width, target.height)) != Some((width, height)) {
            let (render_texture, render_view) = Self::create_offscreen_target(
                &self.device,
                width,
                height,
                self.config.format,
                "Ghost Dome View Render Target",
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
                    eprintln!("[ghost-core] dome view export target failed: {err}");
                    self.dome_view_target = None;
                    return;
                }
            };
            self.dome_view_target = Some(DeckMonitorTarget {
                render_texture,
                render_view,
                width,
                height,
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                export,
            });
        }
        let stage = OutputStage { dlayer: self.dome_layer_pass, ..stage };
        let mut encoder = self.take_outputs_encoder();
        if let Some(target) = self.dome_view_target.as_ref() {
            self.output_presenter.draw(&self.queue, &mut encoder, &target.render_view,
                self.creative_frame_index, width, height, output_gate, stage, time_seconds.unwrap_or(0.0));
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            target.export.blitter.copy(&self.device, &mut encoder, &target.render_view, &target.export.view);
        }
        self.outputs_encoder = Some(encoder);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(target) = self.dome_view_target.as_mut() {
            target.export.frame = target.export.frame.saturating_add(1);
        }
    }

    /// Layers placed on the dome get their own pass while a dome output is
    /// on: route them there (dlayer, which also tells the canvas composite
    /// to skip them) and keep the output presenter's dome picture sized to
    /// the composition's long side.
    pub(crate) fn sync_dome_layers(&mut self, stage: &OutputStage, scene_layers: &[LayerGpu]) {
        let dome = stage.dome0;
        let routed = dome[0] > 0.5 && scene_layers.iter().any(|layer| layer.fast_flags[2] == 1);
        self.dome_layer_pass = if routed { [1.0, dome[1], dome[2], 0.0] } else { [0.0; 4] };
        let size = routed.then(|| self.config.width.max(self.config.height).clamp(1024, 4096));
        self.output_presenter.set_dome_layers(&self.device, &self.composite_frame_textures, size);
    }

    /// The compositor's dome pass (draw instance 1, see fs_main).
    pub(crate) fn draw_dome_layers(&self, encoder: &mut wgpu::CommandEncoder) {
        if self.dome_layer_pass[0] < 0.5 {
            return;
        }
        let Some(view) = self.output_presenter.dome_layers_view() else {
            return;
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Ghost Render Core Dome Layers Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(self.compositor_pipeline_for(self.program_wants_mips));
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_bind_group(1, &self.source_frames_bind_group, &[]);
        pass.draw(0..3, 1..2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirror_mesh_draws_only_the_cells_it_uses() {
        // 3 by 2 nodes, the top-right one unused: of the two cells only the left one draws.
        let nodes: Vec<f64> = vec![
            -1.0, -1.0, 0.0, 0.0, 1.0,   0.0, -1.0, 0.5, 0.0, 1.0,   1.0, -1.0, 1.0, 0.0, 1.0,
            -1.0, 1.0, 0.0, 1.0, 1.0,    0.0, 1.0, 0.5, 1.0, 0.8,    1.0, 1.0, 1.0, 1.0, -1.0,
        ];
        let mesh = MirrorMesh::from_command(&json!({ "mesh_id": "m", "cols": 3, "rows": 2, "nodes": nodes })).unwrap();
        assert_eq!(mesh.vertices.len(), 6);
        assert_eq!(mesh.indices, vec![0, 1, 4, 0, 4, 3]);
        // A polar mesh wraps its last column round to the first.
        let polar = MirrorMesh::from_command(&json!({ "mesh_id": "p", "mesh_type": 1, "cols": 3, "rows": 2,
            "nodes": nodes.iter().enumerate().map(|(k, v)| if k == 29 { 1.0 } else { *v }).collect::<Vec<_>>() })).unwrap();
        assert_eq!(polar.indices.len(), 18);
        assert!(MirrorMesh::from_command(&json!({ "mesh_id": "x", "cols": 3, "rows": 2, "nodes": [0.0] })).is_err());
    }

    #[test]
    fn dome_rig_reads_its_projectors_in_order() {
        let frustum: Vec<f64> = (0..16).map(|v| v as f64).collect();
        let rig = DomeRig::from_params(Some(&json!({ "blendWidth": 0.3, "blendGamma": 2.0,
            "projectors": [{ "id": "a", "frustum": frustum }, { "id": "bad", "frustum": [1.0] }, { "id": "b", "frustum": frustum }] })));
        assert_eq!(rig.ids, vec!["a", "b"]);
        assert_eq!(rig.frusta[4], [0.0, 1.0, 2.0, 3.0]);
        assert_eq!(rig.frusta[7], [12.0, 13.0, 14.0, 15.0]);
        assert!((rig.blend_width - 0.3).abs() < 1e-6);
        assert!(DomeRig::from_params(None).ids.is_empty());
    }

    #[test]
    fn mirror_mesh_shader_validates() {
        let module = naga::front::wgsl::parse_str(MIRROR_MESH_WGSL)
            .unwrap_or_else(|error| panic!("mirror mesh parse: {}", error.emit_to_string(MIRROR_MESH_WGSL)));
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap_or_else(|error| panic!("mirror mesh validation: {error:?}"));
    }
}
