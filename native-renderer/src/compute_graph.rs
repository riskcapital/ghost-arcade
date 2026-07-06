use std::fs;

use base64::Engine;
use serde_json::Value;

#[derive(Clone, Copy, Debug)]
pub(crate) enum NativeComputeBufferBindingKind {
    Uniform,
    StorageRead,
    StorageReadWrite,
}

impl NativeComputeBufferBindingKind {
    pub(crate) fn signature(self) -> &'static str {
        match self {
            Self::Uniform => "uniform",
            Self::StorageRead => "storage-read",
            Self::StorageReadWrite => "storage-rw",
        }
    }

    pub(crate) fn buffer_usage(self) -> wgpu::BufferUsages {
        match self {
            Self::Uniform => {
                wgpu::BufferUsages::UNIFORM
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST
            }
            Self::StorageRead | Self::StorageReadWrite => {
                wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST
            }
        }
    }

    pub(crate) fn binding_type(self) -> wgpu::BindingType {
        match self {
            Self::Uniform => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            Self::StorageRead => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: true },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            Self::StorageReadWrite => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: false },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct NativeComputeBindingLayoutSpec {
    pub(crate) binding: u32,
    pub(crate) kind: NativeComputeGraphBindingKind,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum NativeComputeGraphTextureDimension {
    D2,
    D2Array,
}

impl NativeComputeGraphTextureDimension {
    pub(crate) fn signature(self) -> &'static str {
        match self {
            Self::D2 => "texture-2d",
            Self::D2Array => "texture-2d-array",
        }
    }

    pub(crate) fn view_dimension(self) -> wgpu::TextureViewDimension {
        match self {
            Self::D2 => wgpu::TextureViewDimension::D2,
            Self::D2Array => wgpu::TextureViewDimension::D2Array,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum NativeComputeGraphBindingKind {
    Buffer(NativeComputeBufferBindingKind),
    SourceFrameTexture(NativeComputeGraphTextureDimension),
    SourceFrameSampler,
}

impl NativeComputeGraphBindingKind {
    pub(crate) fn signature(self) -> &'static str {
        match self {
            Self::Buffer(kind) => kind.signature(),
            Self::SourceFrameTexture(dimension) => dimension.signature(),
            Self::SourceFrameSampler => "source-frame-sampler",
        }
    }

    pub(crate) fn binding_type(self) -> wgpu::BindingType {
        match self {
            Self::Buffer(kind) => kind.binding_type(),
            Self::SourceFrameTexture(dimension) => wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: dimension.view_dimension(),
                multisampled: false,
            },
            Self::SourceFrameSampler => {
                wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)
            }
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeComputeGraphBufferSpec {
    pub(crate) id: String,
    pub(crate) byte_length: u64,
    pub(crate) kind: NativeComputeBufferBindingKind,
    pub(crate) initial_bytes: Vec<u8>,
    pub(crate) persistent: bool,
    pub(crate) clear: bool,
    pub(crate) indirect: bool,
}

pub(crate) struct NativeComputeGraphGpuBuffer {
    pub(crate) buffer: wgpu::Buffer,
    pub(crate) byte_length: u64,
    pub(crate) kind: NativeComputeBufferBindingKind,
    pub(crate) indirect: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct NativeComputeGraphBindingSpec {
    pub(crate) binding: u32,
    pub(crate) resource_id: String,
    pub(crate) kind: NativeComputeGraphBindingKind,
    pub(crate) source_slot: Option<usize>,
}

#[derive(Clone, Debug)]
pub(crate) struct NativeComputeGraphPassPlan {
    pub(crate) name: String,
    pub(crate) cache_key: String,
    pub(crate) source: String,
    pub(crate) entry: String,
    pub(crate) dispatch: [u32; 3],
    pub(crate) bindings: Vec<NativeComputeGraphBindingSpec>,
}

#[derive(Clone, Debug)]
pub(crate) enum NativeComputeGraphRenderTarget {
    Snapshot,
    SourceFrame {
        source_id: String,
        slot: usize,
        seq: u64,
    },
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum NativeComputeGraphRenderBlend {
    Replace,
    Alpha,
    Add,
}

impl NativeComputeGraphRenderBlend {
    pub(crate) fn signature(self) -> &'static str {
        match self {
            Self::Replace => "replace",
            Self::Alpha => "alpha",
            Self::Add => "add",
        }
    }

    pub(crate) fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "alpha" | "alpha-blend" | "premul" | "premultiplied-alpha" => Self::Alpha,
            "add" | "additive" | "plus" => Self::Add,
            _ => Self::Replace,
        }
    }

    pub(crate) fn blend_state(self) -> wgpu::BlendState {
        match self {
            Self::Replace => wgpu::BlendState::REPLACE,
            Self::Alpha => wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING,
            Self::Add => wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
            },
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum NativeComputeGraphDepthCompare {
    Less,
    LessEqual,
    Always,
}

impl NativeComputeGraphDepthCompare {
    pub(crate) fn signature(self) -> &'static str {
        match self {
            Self::Less => "less",
            Self::LessEqual => "less-equal",
            Self::Always => "always",
        }
    }

    pub(crate) fn compare_function(self) -> wgpu::CompareFunction {
        match self {
            Self::Less => wgpu::CompareFunction::Less,
            Self::LessEqual => wgpu::CompareFunction::LessEqual,
            Self::Always => wgpu::CompareFunction::Always,
        }
    }

    pub(crate) fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "less-equal" | "less-or-equal" | "lequal" => Self::LessEqual,
            "always" | "off" | "none" => Self::Always,
            _ => Self::Less,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum NativeComputeGraphPrimitiveTopology {
    TriangleList,
    LineList,
}

impl NativeComputeGraphPrimitiveTopology {
    pub(crate) fn signature(self) -> &'static str {
        match self {
            Self::TriangleList => "triangle-list",
            Self::LineList => "line-list",
        }
    }

    pub(crate) fn topology(self) -> wgpu::PrimitiveTopology {
        match self {
            Self::TriangleList => wgpu::PrimitiveTopology::TriangleList,
            Self::LineList => wgpu::PrimitiveTopology::LineList,
        }
    }

    pub(crate) fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "line" | "lines" | "line-list" => Self::LineList,
            _ => Self::TriangleList,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeComputeGraphRenderPlan {
    pub(crate) name: String,
    pub(crate) cache_key: String,
    pub(crate) source: String,
    pub(crate) vertex_entry: String,
    pub(crate) fragment_entry: String,
    pub(crate) clear: bool,
    pub(crate) include_snapshot: bool,
    pub(crate) target: NativeComputeGraphRenderTarget,
    pub(crate) blend: NativeComputeGraphRenderBlend,
    pub(crate) vertex_count: u32,
    pub(crate) instance_count: u32,
    pub(crate) indirect_buffer_id: Option<String>,
    pub(crate) indirect_offset: u64,
    pub(crate) clear_color: [f64; 4],
    pub(crate) primitive_topology: NativeComputeGraphPrimitiveTopology,
    pub(crate) depth_enabled: bool,
    pub(crate) depth_write: bool,
    pub(crate) depth_compare: NativeComputeGraphDepthCompare,
    pub(crate) bindings: Vec<NativeComputeGraphBindingSpec>,
}

#[derive(Clone, Debug)]
pub(crate) struct NativeComputeGraphReadbackSpec {
    pub(crate) id: String,
    pub(crate) include_bytes: bool,
}

pub(crate) fn compute_graph_binding_resource_id(value: &Value) -> Option<String> {
    string_at(value, &["resource"])
        .or_else(|| string_at(value, &["resource_id"]))
        .or_else(|| string_at(value, &["buffer"]))
}

pub(crate) fn compute_graph_binding_kind_from_value(
    value: &Value,
) -> Option<NativeComputeGraphBindingKind> {
    for label in [
        string_at(value, &["resource_kind"]),
        string_at(value, &["resource_type"]),
        string_at(value, &["binding_kind"]),
        string_at(value, &["kind"]),
        string_at(value, &["type"]),
        compute_graph_binding_resource_id(value),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(kind) = compute_graph_binding_kind_from_str(&label) {
            return Some(kind);
        }
    }
    None
}

fn compute_graph_binding_kind_from_str(kind: &str) -> Option<NativeComputeGraphBindingKind> {
    let kind = kind
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .replace(' ', "-");
    match kind.as_str() {
        "source-frame-texture"
        | "source-frame-texture-2d"
        | "source-texture"
        | "source-texture-2d"
        | "texture-2d" => Some(NativeComputeGraphBindingKind::SourceFrameTexture(
            NativeComputeGraphTextureDimension::D2,
        )),
        "source-frame-texture-array"
        | "source-frame-texture-2d-array"
        | "source-texture-array"
        | "source-texture-2d-array"
        | "texture-2d-array" => Some(NativeComputeGraphBindingKind::SourceFrameTexture(
            NativeComputeGraphTextureDimension::D2Array,
        )),
        "source-frame-sampler" | "source-sampler" => {
            Some(NativeComputeGraphBindingKind::SourceFrameSampler)
        }
        _ => compute_binding_kind_from_str(&kind).map(NativeComputeGraphBindingKind::Buffer),
    }
}

pub(crate) fn compute_binding_kind_from_value(
    value: &Value,
) -> Option<NativeComputeBufferBindingKind> {
    string_at(value, &["kind"])
        .or_else(|| string_at(value, &["type"]))
        .or_else(|| string_at(value, &["buffer_type"]))
        .and_then(|kind| compute_binding_kind_from_str(&kind))
}

fn compute_binding_kind_from_str(kind: &str) -> Option<NativeComputeBufferBindingKind> {
    let kind = kind.trim().to_ascii_lowercase();
    match kind.as_str() {
        "uniform" | "uniform-buffer" | "uniform_buffer" => {
            Some(NativeComputeBufferBindingKind::Uniform)
        }
        "read" | "readonly" | "read-only" | "read_only" | "read-only-storage"
        | "read_only_storage" | "storage-read" | "storage_read" => {
            Some(NativeComputeBufferBindingKind::StorageRead)
        }
        "storage" | "readwrite" | "read-write" | "read_write" | "read_write_storage"
        | "read-write-storage" | "storage-rw" | "storage_rw" => {
            Some(NativeComputeBufferBindingKind::StorageReadWrite)
        }
        _ => None,
    }
}

pub(crate) fn parse_compute_graph_buffer(
    value: &Value,
) -> Result<NativeComputeGraphBufferSpec, String> {
    let Some(id) = string_at(value, &["id"])
        .or_else(|| string_at(value, &["name"]))
        .or_else(|| string_at(value, &["resource"]))
    else {
        return Err("compute_graph buffer missing id".to_string());
    };
    let kind = compute_binding_kind_from_value(value)
        .unwrap_or(NativeComputeBufferBindingKind::StorageReadWrite);
    let mut initial_bytes = compute_initial_bytes(value)?;
    let declared_size = number_at(value, &["byte_length"])
        .or_else(|| number_at(value, &["size"]))
        .or_else(|| number_at(value, &["bytes"]))
        .unwrap_or(initial_bytes.len().max(4) as f64)
        .round()
        .clamp(4.0, 512.0 * 1024.0 * 1024.0) as u64;
    let alignment = if matches!(kind, NativeComputeBufferBindingKind::Uniform) {
        16
    } else {
        4
    };
    let byte_length = align_u64(
        declared_size.max(initial_bytes.len() as u64).max(4),
        alignment,
    );
    if !initial_bytes.is_empty() {
        initial_bytes.resize(byte_length as usize, 0);
    }
    let persistent = bool_at(value, &["persistent"])
        .or_else(|| bool_at(value, &["persist"]))
        .or_else(|| bool_at(value, &["reuse"]))
        .unwrap_or(false);
    let clear = bool_at(value, &["clear"])
        .or_else(|| bool_at(value, &["reset"]))
        .unwrap_or(false);
    let indirect = bool_at(value, &["indirect"])
        .or_else(|| bool_at(value, &["draw_indirect"]))
        .or_else(|| bool_at(value, &["drawIndirect"]))
        .unwrap_or(false);
    Ok(NativeComputeGraphBufferSpec {
        id,
        byte_length,
        kind,
        initial_bytes,
        persistent,
        clear,
        indirect,
    })
}

fn compute_initial_bytes(value: &Value) -> Result<Vec<u8>, String> {
    if let Some(file_path) = string_at(value, &["initial_file"])
        .or_else(|| string_at(value, &["data_file"]))
        .or_else(|| string_at(value, &["bytes_file"]))
    {
        let bytes = fs::read(&file_path).map_err(|err| err.to_string())?;
        if bool_at(value, &["initial_file_delete"])
            .or_else(|| bool_at(value, &["data_file_delete"]))
            .or_else(|| bool_at(value, &["bytes_file_delete"]))
            .unwrap_or(false)
        {
            let _ = fs::remove_file(file_path);
        }
        let declared_len = number_at(value, &["initial_byte_length"])
            .or_else(|| number_at(value, &["data_byte_length"]))
            .or_else(|| number_at(value, &["bytes_byte_length"]))
            .unwrap_or(bytes.len() as f64)
            .round()
            .max(0.0) as usize;
        if bytes.len() < declared_len {
            return Err(format!(
                "compute_graph initial file payload is shorter than declared length: {} < {}",
                bytes.len(),
                declared_len
            ));
        }
        return Ok(bytes);
    }
    if let Some(encoded) = string_at(value, &["initial_b64"])
        .or_else(|| string_at(value, &["data_b64"]))
        .or_else(|| string_at(value, &["bytes_b64"]))
    {
        return base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|err| err.to_string());
    }
    if let Some(values) = value
        .get("initial_u32")
        .or_else(|| value.get("u32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value
                .as_f64()
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, u32::MAX as f64) as u32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    if let Some(values) = value
        .get("initial_i32")
        .or_else(|| value.get("i32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value
                .as_f64()
                .unwrap_or(0.0)
                .round()
                .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    if let Some(values) = value
        .get("initial_f32")
        .or_else(|| value.get("f32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value.as_f64().unwrap_or(0.0).clamp(-1.0e20, 1.0e20) as f32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    Ok(Vec::new())
}

pub(crate) fn dispatch_from_value(value: &Value) -> [u32; 3] {
    if let Some(values) = value.get("dispatch").and_then(Value::as_array) {
        return [
            values
                .first()
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
            values
                .get(1)
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
            values
                .get(2)
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
        ];
    }
    [
        number_at(value, &["dispatch_x"])
            .or_else(|| number_at(value, &["x"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
        number_at(value, &["dispatch_y"])
            .or_else(|| number_at(value, &["y"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
        number_at(value, &["dispatch_z"])
            .or_else(|| number_at(value, &["z"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
    ]
}

pub(crate) fn compute_graph_readbacks(
    params: &Value,
    buffers: &[NativeComputeGraphBufferSpec],
) -> Vec<NativeComputeGraphReadbackSpec> {
    if let Some(values) = params.get("readbacks").and_then(Value::as_array) {
        let mut out = Vec::new();
        for value in values {
            if let Some(id) = value.as_str() {
                out.push(NativeComputeGraphReadbackSpec {
                    id: id.to_string(),
                    include_bytes: false,
                });
            } else if let Some(id) =
                string_at(value, &["id"]).or_else(|| string_at(value, &["buffer"]))
            {
                out.push(NativeComputeGraphReadbackSpec {
                    id,
                    include_bytes: bool_at(value, &["include_bytes"])
                        .or_else(|| bool_at(value, &["includeBytes"]))
                        .or_else(|| bool_at(value, &["include_b64"]))
                        .or_else(|| bool_at(value, &["includeB64"]))
                        .or_else(|| bool_at(value, &["bytes"]))
                        .unwrap_or(false),
                });
            }
        }
        return out;
    }
    buffers
        .iter()
        .filter(|buffer| !matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform))
        .last()
        .map(|buffer| {
            vec![NativeComputeGraphReadbackSpec {
                id: buffer.id.clone(),
                include_bytes: false,
            }]
        })
        .unwrap_or_default()
}

fn number_at(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_f64()
}

fn bool_at(value: &Value, path: &[&str]) -> Option<bool> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_bool()
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToString::to_string)
}

fn align_u64(value: u64, alignment: u64) -> u64 {
    if alignment == 0 {
        return value;
    }
    value.div_ceil(alignment).saturating_mul(alignment)
}
