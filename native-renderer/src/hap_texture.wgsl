@group(0) @binding(0) var blocks: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
@group(0) @binding(2) var<uniform> settings: vec4<f32>;
// HAP Q Alpha's RGTC1 image (a 1x1 placeholder for the other formats).
@group(0) @binding(3) var alpha_blocks: texture_2d<f32>;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Vertex {
    let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    var out: Vertex;
    out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(uv.x, 1.0 - uv.y) * settings.xy;
    return out;
}
@fragment fn fs_main(in: Vertex) -> @location(0) vec4<f32> {
    let value = textureSample(blocks, image_sampler, in.uv);
    if settings.z > 1.5 {
        let scale = value.b * (255.0 / 8.0) + 1.0;
        let co = (value.r - 128.0 / 255.0) / scale;
        let cg = (value.g - 128.0 / 255.0) / scale;
        let rgb = vec3<f32>(value.a + co - cg, value.a + cg, value.a - co - cg);
        if settings.z > 2.5 {
            // Straight (not premultiplied) alpha, like HAP Alpha and HAP R.
            return vec4<f32>(rgb, textureSample(alpha_blocks, image_sampler, in.uv).r);
        }
        return vec4<f32>(rgb, 1.0);
    }
    if settings.z < 0.5 { return vec4<f32>(value.rgb, 1.0); }
    return value;
}
