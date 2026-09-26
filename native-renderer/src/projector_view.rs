//! Map Sim projector views: the image one physical projector must emit so
//! the content lands on the real object.
//!
//! The editor sends the Map Sim geometry once (`set_projection_sim_meshes`,
//! object-local triangles keyed by mesh) and the per-frame-cheap scene
//! description (`set_projection_sim_view`: object matrices plus every
//! projector's view and projection matrices). A Screen whose source is a
//! Map Sim projector is then rendered here instead of cropping the master:
//! the scene from that projector's lens, each surface taking the content
//! its mapping lens throws on it (the projector itself, or the projector
//! named by `content_from`), with that lens's occlusion and facing falloff.
//! The content is the live creative master, so VJ and mapping compositions
//! flow through at the core's frame rate.
//!
//! Matrices arrive column-major in the GL convention (clip z in [-1, 1],
//! as three.js builds them) and are remapped to wgpu's [0, 1] depth here.
use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use bytemuck::{Pod, Zeroable};
use serde_json::Value;
use wgpu::util::DeviceExt;

pub(crate) const PROJECTOR_VIEW_MAX_OBJECTS: usize = 256;
pub(crate) const PROJECTOR_VIEW_MAX_MARKERS: usize = 32;
const MAX_MESH_VERTICES: usize = 4_000_000;
const MAX_MESH_INDICES: usize = 12_000_000;
const MAP_DEPTH_SIZE: u32 = 2048;
/// Mesh key the editor uses for the Map Sim floor.
const FLOOR_MESH_KEY: &str = "floor";
pub(crate) const PROJECTOR_VIEW_DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
/// Occlusion bias along the mapping lens axis: 3 mm plus 0.2% of depth.
const MAP_DEPTH_BIAS_ABS: f32 = 0.003;
const MAP_DEPTH_BIAS_REL: f32 = 0.002;

type Mat4 = [[f64; 4]; 4];

/// Object-local triangles for one Map Sim mesh.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProjectorViewMeshData {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub indices: Vec<u32>,
}

impl ProjectorViewMeshData {
    #[cfg(test)]
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }
}

#[derive(Debug, Default)]
pub(crate) struct ProjectorViewMeshBatch {
    pub upserts: Vec<(String, Arc<ProjectorViewMeshData>)>,
    /// Keys to keep; everything else is dropped. None keeps every mesh.
    pub retain: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProjectorViewObject {
    pub mesh: String,
    /// Column-major model matrix.
    pub model: Mat4,
    pub receive: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProjectorViewCamera {
    pub id: String,
    /// Column-major view-projection with wgpu depth (0..1).
    pub view_proj: Mat4,
    pub position: [f64; 3],
    pub near: f64,
    pub far: f64,
    /// Content crop on the master, (x, y, w, h), y down.
    pub crop: [f32; 4],
    /// Edge blend widths (left, right, top, bottom).
    pub blend: [f32; 4],
    pub content_from: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ProjectorViewScene {
    pub objects: Vec<ProjectorViewObject>,
    pub cameras: Vec<ProjectorViewCamera>,
}

impl ProjectorViewScene {
    pub fn camera(&self, id: &str) -> Option<&ProjectorViewCamera> {
        self.cameras.iter().find(|camera| camera.id == id)
    }

    /// The lens whose mapping lays content onto the surfaces for `camera`.
    pub fn mapping_camera<'a>(&'a self, camera: &'a ProjectorViewCamera) -> &'a ProjectorViewCamera {
        camera
            .content_from
            .as_deref()
            .filter(|id| *id != camera.id)
            .and_then(|id| self.camera(id))
            .unwrap_or(camera)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProjectorViewMode {
    Content,
    Black,
    Model,
}

/// Calibration marks for one projector's output.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProjectorViewOverlay {
    pub mode: ProjectorViewMode,
    /// Crosshair position, uv with y down.
    pub cursor: Option<[f32; 2]>,
    /// Matched points: uv (y down) and whether the point is selected.
    pub markers: Vec<([f32; 2], bool)>,
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|v| v.is_finite())
}

fn numbers<const N: usize>(value: Option<&Value>) -> Option<[f64; N]> {
    let array = value?.as_array()?;
    if array.len() != N {
        return None;
    }
    let mut out = [0.0; N];
    for (slot, entry) in out.iter_mut().zip(array) {
        *slot = number(entry)?;
    }
    Some(out)
}

fn column_major(values: [f64; 16]) -> Mat4 {
    let mut out = [[0.0; 4]; 4];
    for col in 0..4 {
        for row in 0..4 {
            out[col][row] = values[col * 4 + row];
        }
    }
    out
}

pub(crate) fn mat4_mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [[0.0; 4]; 4];
    for col in 0..4 {
        for row in 0..4 {
            out[col][row] = (0..4).map(|k| a[k][row] * b[col][k]).sum();
        }
    }
    out
}

/// GL clip space (z in [-w, w]) to wgpu clip space (z in [0, w]).
pub(crate) fn gl_to_wgpu_clip() -> Mat4 {
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 0.5, 0.0],
        [0.0, 0.0, 0.5, 1.0],
    ]
}

fn to_f32_mat(m: &Mat4) -> [[f32; 4]; 4] {
    m.map(|col| col.map(|v| v as f32))
}

/// Inverse-transpose of the model's upper 3x3, as three vec4 columns.
fn normal_matrix(model: &Mat4) -> [[f32; 4]; 3] {
    let a = |r: usize, c: usize| model[c][r];
    let m = [[a(0, 0), a(0, 1), a(0, 2)], [a(1, 0), a(1, 1), a(1, 2)], [a(2, 0), a(2, 1), a(2, 2)]];
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if det.abs() < 1e-20 {
        return [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]];
    }
    // Cofactor matrix / det = inverse transpose.
    let cof = |r: usize, c: usize| {
        let rows: Vec<usize> = (0..3).filter(|&i| i != r).collect();
        let cols: Vec<usize> = (0..3).filter(|&i| i != c).collect();
        let minor = m[rows[0]][cols[0]] * m[rows[1]][cols[1]] - m[rows[0]][cols[1]] * m[rows[1]][cols[0]];
        if (r + c) % 2 == 0 { minor } else { -minor }
    };
    let mut out = [[0.0f32; 4]; 3];
    for col in 0..3 {
        for row in 0..3 {
            out[col][row] = (cof(row, col) / det) as f32;
        }
    }
    out
}

fn decode_b64(command: &Value, key: &str) -> Result<Vec<u8>, String> {
    let text = command
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("projection sim mesh needs {key}"))?;
    base64::engine::general_purpose::STANDARD
        .decode(text.as_bytes())
        .map_err(|err| format!("projection sim mesh {key} is not base64: {err}"))
}

fn f32s(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err("projection sim mesh float data is not a multiple of 4 bytes".to_string());
    }
    Ok(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

fn u32s(bytes: &[u8]) -> Result<Vec<u32>, String> {
    if bytes.len() % 4 != 0 {
        return Err("projection sim mesh index data is not a multiple of 4 bytes".to_string());
    }
    Ok(bytes.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

/// Parse `set_projection_sim_meshes`: `{ meshes: [{ key, positions_b64,
/// normals_b64, indices_b64 }], retain?: [key] }`, little-endian f32/u32.
pub(crate) fn parse_projector_view_meshes(command: &Value) -> Result<ProjectorViewMeshBatch, String> {
    let mut batch = ProjectorViewMeshBatch::default();
    let mut total_vertices = 0usize;
    let mut total_indices = 0usize;
    if let Some(meshes) = command.get("meshes").and_then(Value::as_array) {
        for mesh in meshes {
            let key = mesh
                .get("key")
                .and_then(Value::as_str)
                .filter(|key| !key.trim().is_empty())
                .ok_or_else(|| "projection sim mesh needs a key".to_string())?;
            let positions = f32s(&decode_b64(mesh, "positions_b64")?)?;
            let normals = f32s(&decode_b64(mesh, "normals_b64")?)?;
            let indices = u32s(&decode_b64(mesh, "indices_b64")?)?;
            if positions.len() % 3 != 0 || normals.len() != positions.len() {
                return Err(format!("projection sim mesh {key}: positions and normals must be matching xyz lists"));
            }
            if indices.len() % 3 != 0 {
                return Err(format!("projection sim mesh {key}: indices must form triangles"));
            }
            let vertices = positions.len() / 3;
            if indices.iter().any(|&index| index as usize >= vertices) {
                return Err(format!("projection sim mesh {key}: an index points past the vertex list"));
            }
            if positions.iter().chain(normals.iter()).any(|v| !v.is_finite()) {
                return Err(format!("projection sim mesh {key}: non-finite vertex data"));
            }
            total_vertices += vertices;
            total_indices += indices.len();
            if total_vertices > MAX_MESH_VERTICES || total_indices > MAX_MESH_INDICES {
                return Err("Map Sim geometry is too large for the projector view (4M vertices, 4M triangles).".to_string());
            }
            batch.upserts.push((key.to_string(), Arc::new(ProjectorViewMeshData { positions, normals, indices })));
        }
    }
    if let Some(retain) = command.get("retain").and_then(Value::as_array) {
        batch.retain = Some(retain.iter().filter_map(Value::as_str).map(str::to_string).collect());
    }
    Ok(batch)
}

/// Parse `set_projection_sim_view`. `view: null` clears it.
pub(crate) fn parse_projector_view_scene(command: &Value) -> Result<Option<ProjectorViewScene>, String> {
    let view = command.get("view").unwrap_or(command);
    if view.is_null() {
        return Ok(None);
    }
    let mut scene = ProjectorViewScene::default();
    if let Some(objects) = view.get("objects").and_then(Value::as_array) {
        for object in objects.iter().take(PROJECTOR_VIEW_MAX_OBJECTS) {
            let mesh = object
                .get("mesh")
                .and_then(Value::as_str)
                .ok_or_else(|| "projection sim view object needs a mesh".to_string())?;
            let matrix = numbers::<16>(object.get("matrix"))
                .ok_or_else(|| format!("projection sim view object {mesh} needs a 16-number matrix"))?;
            scene.objects.push(ProjectorViewObject {
                mesh: mesh.to_string(),
                model: column_major(matrix),
                receive: object.get("receive").and_then(Value::as_bool).unwrap_or(true),
            });
        }
    }
    let clip = gl_to_wgpu_clip();
    if let Some(projectors) = view.get("projectors").and_then(Value::as_array) {
        for projector in projectors {
            let id = projector
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "projection sim view projector needs an id".to_string())?;
            let view_matrix = numbers::<16>(projector.get("view"))
                .ok_or_else(|| format!("projector {id} needs a 16-number view matrix"))?;
            let projection = numbers::<16>(projector.get("projection"))
                .ok_or_else(|| format!("projector {id} needs a 16-number projection matrix"))?;
            let position = numbers::<3>(projector.get("position"))
                .ok_or_else(|| format!("projector {id} needs a position"))?;
            let near = projector.get("near").and_then(number).unwrap_or(0.1).max(1e-4);
            let far = projector.get("far").and_then(number).unwrap_or(120.0).max(near * 2.0);
            let crop = numbers::<4>(projector.get("crop")).unwrap_or([0.0, 0.0, 1.0, 1.0]);
            let blend = numbers::<4>(projector.get("blend")).unwrap_or([0.0; 4]);
            scene.cameras.push(ProjectorViewCamera {
                id: id.to_string(),
                view_proj: mat4_mul(&clip, &mat4_mul(&column_major(projection), &column_major(view_matrix))),
                position,
                near,
                far,
                crop: crop.map(|v| v as f32),
                blend: blend.map(|v| v.clamp(0.0, 0.5) as f32),
                content_from: projector
                    .get("content_from")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            });
        }
    }
    Ok(Some(scene))
}

/// Parse `set_projection_sim_overlay`: `{ projector_id, overlay: null |
/// { mode, cursor: [u, v] | null, markers: [[u, v, selected]] } }`.
pub(crate) fn parse_projector_view_overlay(command: &Value) -> Result<(String, Option<ProjectorViewOverlay>), String> {
    let id = command
        .get("projector_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "projection sim overlay needs projector_id".to_string())?
        .to_string();
    let Some(overlay) = command.get("overlay").filter(|value| !value.is_null()) else {
        return Ok((id, None));
    };
    let mode = match overlay.get("mode").and_then(Value::as_str).unwrap_or("content") {
        "black" => ProjectorViewMode::Black,
        "model" => ProjectorViewMode::Model,
        _ => ProjectorViewMode::Content,
    };
    let cursor = numbers::<2>(overlay.get("cursor")).map(|c| [c[0] as f32, c[1] as f32]);
    let markers = overlay
        .get("markers")
        .and_then(Value::as_array)
        .map(|markers| {
            markers
                .iter()
                .filter_map(|marker| {
                    let values = marker.as_array()?;
                    let u = number(values.first()?)?;
                    let v = number(values.get(1)?)?;
                    let selected = values.get(2).and_then(number).unwrap_or(0.0) > 0.5;
                    Some(([u as f32, v as f32], selected))
                })
                .take(PROJECTOR_VIEW_MAX_MARKERS)
                .collect()
        })
        .unwrap_or_default();
    Ok((id, Some(ProjectorViewOverlay { mode, cursor, markers })))
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ViewUniformsGpu {
    view_proj: [[f32; 4]; 4],
    map_view_proj: [[f32; 4]; 4],
    map_position: [f32; 4],
    map_params: [f32; 4],
    crop: [f32; 4],
    blend: [f32; 4],
    params: [f32; 4],
    own_position: [f32; 4],
    overlay: [f32; 4],
    overlay2: [f32; 4],
    markers: [[f32; 4]; PROJECTOR_VIEW_MAX_MARKERS],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ObjectGpu {
    model: [[f32; 4]; 4],
    normal: [[f32; 4]; 3],
    flags: [f32; 4],
}

struct GpuMesh {
    source: Arc<ProjectorViewMeshData>,
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    index_count: u32,
}

/// Per-view inputs for one render.
pub(crate) struct ProjectorViewRequest<'a> {
    pub scene: &'a ProjectorViewScene,
    pub projector_id: &'a str,
    pub content: Option<&'a wgpu::TextureView>,
    pub overlay: Option<&'a ProjectorViewOverlay>,
    pub width: u32,
    pub height: u32,
}

pub(crate) struct ProjectorViewRenderer {
    format: wgpu::TextureFormat,
    color_pipeline: wgpu::RenderPipeline,
    depth_pipeline: wgpu::RenderPipeline,
    overlay_pipeline: wgpu::RenderPipeline,
    main_layout: wgpu::BindGroupLayout,
    depth_bind_group: wgpu::BindGroup,
    main_uniforms: wgpu::Buffer,
    depth_uniforms: wgpu::Buffer,
    objects: wgpu::Buffer,
    map_depth_view: wgpu::TextureView,
    _map_depth: wgpu::Texture,
    main_depth: Option<(wgpu::Texture, wgpu::TextureView, u32, u32)>,
    content_sampler: wgpu::Sampler,
    blank_content_view: wgpu::TextureView,
    _blank_content: wgpu::Texture,
    meshes: HashMap<String, GpuMesh>,
}

impl ProjectorViewRenderer {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Map Sim projector view"),
            source: wgpu::ShaderSource::Wgsl(include_str!("projector_view.wgsl").into()),
        });
        let uniform_entry = wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let objects_entry = wgpu::BindGroupLayoutEntry {
            binding: 1,
            visibility: wgpu::ShaderStages::VERTEX,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: true },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let depth_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Map Sim projector depth layout"),
            entries: &[uniform_entry, objects_entry],
        });
        let main_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Map Sim projector view layout"),
            entries: &[
                uniform_entry,
                objects_entry,
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let vertex_layout = wgpu::VertexBufferLayout {
            array_stride: 24,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
        };
        let depth_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Map Sim projector depth pipeline layout"),
            bind_group_layouts: &[Some(&depth_layout)],
            immediate_size: 0,
        });
        let main_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Map Sim projector view pipeline layout"),
            bind_group_layouts: &[Some(&main_layout)],
            immediate_size: 0,
        });
        let depth_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Map Sim projector depth"),
            layout: Some(&depth_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_depth"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[Some(vertex_layout.clone())],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: PROJECTOR_VIEW_DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: wgpu::StencilState::default(),
                // Push surfaces seen at a grazing angle back by a couple of
                // texels' worth of depth, so the nearest-texel lookup in the
                // view pass does not shadow a surface with itself.
                bias: wgpu::DepthBiasState { constant: 0, slope_scale: 2.0, clamp: 0.0 },
            }),
            multisample: wgpu::MultisampleState::default(),
            fragment: None,
            multiview_mask: None,
            cache: None,
        });
        let color_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Map Sim projector view"),
            layout: Some(&main_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[Some(vertex_layout.clone())],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: PROJECTOR_VIEW_DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let overlay_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Map Sim projector calibration overlay"),
            layout: Some(&main_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_overlay"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_overlay"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let uniform_size = std::mem::size_of::<ViewUniformsGpu>() as u64;
        let main_uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Map Sim projector view uniforms"),
            size: uniform_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let depth_uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Map Sim projector depth uniforms"),
            size: uniform_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let objects = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Map Sim projector view objects"),
            size: (std::mem::size_of::<ObjectGpu>() * PROJECTOR_VIEW_MAX_OBJECTS) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let depth_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Map Sim projector depth bind group"),
            layout: &depth_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: depth_uniforms.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: objects.as_entire_binding() },
            ],
        });
        let map_depth = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Map Sim mapping lens depth"),
            size: wgpu::Extent3d { width: MAP_DEPTH_SIZE, height: MAP_DEPTH_SIZE, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: PROJECTOR_VIEW_DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let map_depth_view = map_depth.create_view(&wgpu::TextureViewDescriptor::default());
        let content_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Map Sim projector content"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let blank_content = device.create_texture_with_data(
            queue,
            &wgpu::TextureDescriptor {
                label: Some("Map Sim projector blank content"),
                size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            &[0, 0, 0, 255],
        );
        let blank_content_view = blank_content.create_view(&wgpu::TextureViewDescriptor::default());
        Self {
            format,
            color_pipeline,
            depth_pipeline,
            overlay_pipeline,
            main_layout,
            depth_bind_group,
            main_uniforms,
            depth_uniforms,
            objects,
            map_depth_view,
            _map_depth: map_depth,
            main_depth: None,
            content_sampler,
            blank_content_view,
            _blank_content: blank_content,
            meshes: HashMap::new(),
        }
    }

    pub fn format(&self) -> wgpu::TextureFormat {
        self.format
    }

    /// Upload new or changed meshes and drop the ones the editor removed.
    pub fn sync_meshes(&mut self, device: &wgpu::Device, meshes: &HashMap<String, Arc<ProjectorViewMeshData>>) {
        self.meshes.retain(|key, mesh| meshes.get(key).is_some_and(|source| Arc::ptr_eq(source, &mesh.source)));
        for (key, source) in meshes {
            if self.meshes.contains_key(key) || source.indices.is_empty() {
                continue;
            }
            let mut interleaved = Vec::with_capacity(source.positions.len() * 2);
            for (p, n) in source.positions.chunks_exact(3).zip(source.normals.chunks_exact(3)) {
                interleaved.extend_from_slice(p);
                interleaved.extend_from_slice(n);
            }
            let vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Map Sim mesh vertices"),
                contents: bytemuck::cast_slice(&interleaved),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let indices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Map Sim mesh indices"),
                contents: bytemuck::cast_slice(&source.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
            self.meshes.insert(
                key.clone(),
                GpuMesh { source: Arc::clone(source), vertices, indices, index_count: source.indices.len() as u32 },
            );
        }
    }

    fn ensure_main_depth(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if self.main_depth.as_ref().is_some_and(|(_, _, w, h)| *w == width && *h == height) {
            return;
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Map Sim projector view depth"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: PROJECTOR_VIEW_DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.main_depth = Some((texture, view, width, height));
    }

    fn draw_objects<'p>(&self, pass: &mut wgpu::RenderPass<'p>, scene: &ProjectorViewScene) {
        for (index, object) in scene.objects.iter().take(PROJECTOR_VIEW_MAX_OBJECTS).enumerate() {
            let Some(mesh) = self.meshes.get(&object.mesh) else {
                continue;
            };
            pass.set_vertex_buffer(0, mesh.vertices.slice(..));
            pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
            let instance = index as u32;
            pass.draw_indexed(0..mesh.index_count, 0, instance..instance + 1);
        }
    }

    /// Render one projector's view into `target`. Returns false (after
    /// clearing to black) when the projector is not in the scene. The
    /// caller submits the encoder before rendering another view, since the
    /// uniforms are shared.
    pub fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        request: &ProjectorViewRequest<'_>,
    ) -> bool {
        let width = request.width.max(1);
        let height = request.height.max(1);
        self.ensure_main_depth(device, width, height);
        let scene = request.scene;
        let Some(camera) = scene.camera(request.projector_id) else {
            let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Map Sim projector view (missing)"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                ..Default::default()
            });
            return false;
        };
        let mapping = scene.mapping_camera(camera);
        let separate_mapping = mapping.id != camera.id;

        let objects: Vec<ObjectGpu> = scene
            .objects
            .iter()
            .take(PROJECTOR_VIEW_MAX_OBJECTS)
            .map(|object| ObjectGpu {
                model: to_f32_mat(&object.model),
                normal: normal_matrix(&object.model),
                flags: [
                    if object.receive { 1.0 } else { 0.0 },
                    // The floor stays dark in model shading so the object's
                    // up-facing surfaces stand out against it.
                    if object.mesh == FLOOR_MESH_KEY { 1.0 } else { 0.0 },
                    0.0,
                    0.0,
                ],
            })
            .collect();
        if !objects.is_empty() {
            queue.write_buffer(&self.objects, 0, bytemuck::cast_slice(&objects));
        }

        let mode = request.overlay.map(|overlay| overlay.mode).unwrap_or(ProjectorViewMode::Content);
        let mut uniforms = ViewUniformsGpu::zeroed();
        uniforms.view_proj = to_f32_mat(&camera.view_proj);
        uniforms.map_view_proj = to_f32_mat(&mapping.view_proj);
        uniforms.map_position = [
            mapping.position[0] as f32,
            mapping.position[1] as f32,
            mapping.position[2] as f32,
            if separate_mapping { 1.0 } else { 0.0 },
        ];
        uniforms.map_params = [mapping.near as f32, mapping.far as f32, MAP_DEPTH_BIAS_REL, MAP_DEPTH_BIAS_ABS];
        uniforms.crop = mapping.crop;
        uniforms.blend = camera.blend;
        uniforms.params = [
            match mode {
                ProjectorViewMode::Content => 0.0,
                ProjectorViewMode::Black => 1.0,
                ProjectorViewMode::Model => 2.0,
            },
            if request.content.is_some() { 1.0 } else { 0.0 },
            width as f32,
            height as f32,
        ];
        uniforms.own_position = [camera.position[0] as f32, camera.position[1] as f32, camera.position[2] as f32, 1.0];
        if let Some(overlay) = request.overlay {
            let cursor = overlay.cursor.unwrap_or([0.5, 0.5]);
            uniforms.overlay = [cursor[0], cursor[1], if overlay.cursor.is_some() { 1.0 } else { 0.0 }, overlay.markers.len().min(PROJECTOR_VIEW_MAX_MARKERS) as f32];
            for (slot, (uv, selected)) in uniforms.markers.iter_mut().zip(overlay.markers.iter()) {
                *slot = [uv[0], uv[1], if *selected { 1.0 } else { 0.0 }, 0.0];
            }
        }
        queue.write_buffer(&self.main_uniforms, 0, bytemuck::bytes_of(&uniforms));

        if separate_mapping {
            let mut depth_uniforms = ViewUniformsGpu::zeroed();
            depth_uniforms.view_proj = to_f32_mat(&mapping.view_proj);
            queue.write_buffer(&self.depth_uniforms, 0, bytemuck::bytes_of(&depth_uniforms));
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Map Sim mapping lens depth"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.map_depth_view,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.depth_pipeline);
            pass.set_bind_group(0, &self.depth_bind_group, &[]);
            self.draw_objects(&mut pass, scene);
        }

        let content = request.content.unwrap_or(&self.blank_content_view);
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Map Sim projector view bind group"),
            layout: &self.main_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: self.main_uniforms.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: self.objects.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&self.map_depth_view) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(content) },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::Sampler(&self.content_sampler) },
            ],
        });
        let depth_view = &self.main_depth.as_ref().expect("main depth allocated above").1;
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Map Sim projector view"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: depth_view,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.color_pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            self.draw_objects(&mut pass, scene);
        }
        if request.overlay.is_some_and(|overlay| overlay.cursor.is_some() || !overlay.markers.is_empty()) {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Map Sim projector calibration overlay"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.overlay_pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        true
    }
}

#[cfg(test)]
mod tests;
