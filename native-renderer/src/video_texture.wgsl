struct ColorConversion {
    red: vec4<f32>,
    green: vec4<f32>,
    blue: vec4<f32>,
    flags: vec4<u32>,
}

@group(0) @binding(0) var luma_or_bgra: texture_2d<f32>;
@group(0) @binding(1) var chroma: texture_2d<f32>;
@group(0) @binding(2) var plane_sampler: sampler;
@group(0) @binding(3) var<uniform> conversion: ColorConversion;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    var out: VertexOutput;
    let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    // Match the existing source blitter: top-left pixels use texture UV (0, 0).
    out.uv = vec2<f32>(uv.x, 1.0 - uv.y);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let first_plane = textureSample(luma_or_bgra, plane_sampler, in.uv);
    if conversion.flags.x != 0u {
        // Metal's BGRA view already presents channels in RGBA sampling order.
        return first_plane;
    }
    let uv = textureSample(chroma, plane_sampler, in.uv).rg;
    let ycbcr = vec4<f32>(first_plane.r, uv, 1.0);
    let rgb = vec3<f32>(dot(conversion.red, ycbcr), dot(conversion.green, ycbcr), dot(conversion.blue, ycbcr));
    return vec4<f32>(rgb, 1.0);
}
