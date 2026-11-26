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
        if conversion.flags.y != 0u && first_plane.a > 0.0 {
            // Premultiplied colour (HEVC with alpha): the compositor takes
            // straight alpha, like every other video source.
            return vec4<f32>(min(first_plane.rgb / first_plane.a, vec3<f32>(1.0)), first_plane.a);
        }
        return first_plane;
    }
    let uv = textureSample(chroma, plane_sampler, in.uv).rg;
    let ycbcr = vec4<f32>(first_plane.r, uv, 1.0);
    let rgb = vec3<f32>(dot(conversion.red, ycbcr), dot(conversion.green, ycbcr), dot(conversion.blue, ycbcr));
    return vec4<f32>(rgb, 1.0);
}

// ProRes 4444 with alpha: 16-bit big-endian A, R, G, B samples, read as
// integers (no GPU format is big-endian) and filtered here like the
// sampler above (bilinear, clamped to the edge). Straight alpha.
@group(0) @binding(4) var argb64: texture_2d<u32>;

fn argb64_texel(at: vec2<i32>) -> vec4<f32> {
    let last = vec2<i32>(textureDimensions(argb64)) - vec2<i32>(1);
    let v = textureLoad(argb64, clamp(at, vec2<i32>(0), last), 0);
    let swapped = ((v & vec4<u32>(0xffu)) << vec4<u32>(8u)) | (v >> vec4<u32>(8u));
    let argb = vec4<f32>(swapped) / 65535.0;
    return vec4<f32>(argb.y, argb.z, argb.w, argb.x);
}

@fragment
fn fs_argb64(in: VertexOutput) -> @location(0) vec4<f32> {
    let p = in.uv * vec2<f32>(textureDimensions(argb64)) - vec2<f32>(0.5);
    let base = floor(p);
    let f = p - base;
    let i = vec2<i32>(base);
    let top = mix(argb64_texel(i), argb64_texel(i + vec2<i32>(1, 0)), f.x);
    let bottom = mix(argb64_texel(i + vec2<i32>(0, 1)), argb64_texel(i + vec2<i32>(1, 1)), f.x);
    return mix(top, bottom, f.y);
}
