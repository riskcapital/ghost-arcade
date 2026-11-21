// Fluid Ink: a 2D stable-fluid solve as fullscreen passes (fluid_ink.rs has
// the CPU side and the pass order). Velocity is in sim cells per second;
// uv (0,0) is the texture's first row, so +y points down the picture.

struct InkJet {
  a: vec4<f32>, // uv xy, direction xy (picture space, y down)
  b: vec4<f32>, // radius (picture heights), force, ink amount, which ink
}

struct InkU {
  sim: vec4<f32>,    // width, height, 1/width, 1/height
  dye: vec4<f32>,    // width, height, 1/width, 1/height
  clock: vec4<f32>,  // time, dt, aspect, jets
  solve: vec4<f32>,  // velocity kept per second, ink kept per second, vorticity, swirl
  look: vec4<f32>,   // density, relief, backlit, level
  view: View2,
  core: vec4<f32>,
  ink_a: vec4<f32>,
  ink_b: vec4<f32>,
  jets: array<InkJet, 8>,
}

@group(0) @binding(0) var<uniform> I: InkU;
@group(0) @binding(1) var src_tex: texture_2d<f32>;
@group(0) @binding(2) var ink_sampler: sampler;
@group(0) @binding(3) var aux_tex: texture_2d<f32>;

struct FullOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_full(@builtin(vertex_index) index: u32) -> FullOut {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  var out: FullOut;
  out.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

fn load_src(p: vec2<i32>) -> vec4<f32> {
  let size = vec2<i32>(textureDimensions(src_tex));
  return textureLoad(src_tex, clamp(p, vec2<i32>(0), size - 1), 0);
}

fn load_aux(p: vec2<i32>) -> vec4<f32> {
  let size = vec2<i32>(textureDimensions(aux_tex));
  return textureLoad(aux_tex, clamp(p, vec2<i32>(0), size - 1), 0);
}

fn jet_falloff(uv: vec2<f32>, jet: InkJet) -> f32 {
  let d = (uv - jet.a.xy) * vec2<f32>(I.clock.z, 1.0);
  let r = max(jet.b.x, 1e-3);
  return exp(-dot(d, d) / (r * r));
}

@fragment
fn fs_splat_velocity(in: FullOut) -> @location(0) vec4<f32> {
  let p = vec2<i32>(in.position.xy);
  var v = load_src(p).xy;
  let dt = I.clock.y;
  for (var j = 0u; j < u32(I.clock.w); j = j + 1u) {
    let jet = I.jets[j];
    v += jet.a.zw * jet.b.y * jet_falloff(in.uv, jet) * dt * 10.0;
  }
  // The bass turns the tank: a broad vortex about the middle.
  let c = (in.uv - 0.5) * vec2<f32>(I.clock.z, 1.0);
  let around = vec2<f32>(-c.y, c.x);
  v += around * I.solve.w * exp(-dot(c, c) * 2.0) * I.sim.y * 0.6 * dt;
  return vec4<f32>(v, 0.0, 1.0);
}

@fragment
fn fs_advect_velocity(in: FullOut) -> @location(0) vec4<f32> {
  let v = load_src(vec2<i32>(in.position.xy)).xy;
  let back = in.uv - v * I.clock.y * I.sim.zw;
  let moved = textureSampleLevel(src_tex, ink_sampler, back, 0.0).xy;
  // Walls: the tank's sides stop the flow.
  let edge = smoothstep(0.0, 2.0 * I.sim.z, in.uv.x) * smoothstep(0.0, 2.0 * I.sim.z, 1.0 - in.uv.x)
    * smoothstep(0.0, 2.0 * I.sim.w, in.uv.y) * smoothstep(0.0, 2.0 * I.sim.w, 1.0 - in.uv.y);
  return vec4<f32>(moved * pow(I.solve.x, I.clock.y) * edge, 0.0, 1.0);
}

@fragment
fn fs_curl(in: FullOut) -> @location(0) vec4<f32> {
  let p = vec2<i32>(in.position.xy);
  let l = load_src(p - vec2<i32>(1, 0)).y;
  let r = load_src(p + vec2<i32>(1, 0)).y;
  let t = load_src(p - vec2<i32>(0, 1)).x;
  let b = load_src(p + vec2<i32>(0, 1)).x;
  return vec4<f32>(0.5 * ((r - l) - (b - t)), 0.0, 0.0, 1.0);
}

@fragment
fn fs_vorticity(in: FullOut) -> @location(0) vec4<f32> {
  let p = vec2<i32>(in.position.xy);
  let cl = abs(load_aux(p - vec2<i32>(1, 0)).x);
  let cr = abs(load_aux(p + vec2<i32>(1, 0)).x);
  let ct = abs(load_aux(p - vec2<i32>(0, 1)).x);
  let cb = abs(load_aux(p + vec2<i32>(0, 1)).x);
  let c = load_aux(p).x;
  var n = vec2<f32>(cr - cl, cb - ct);
  n = n / (length(n) + 1e-5);
  let force = vec2<f32>(n.y, -n.x) * c * I.solve.z;
  let v = load_src(p).xy + force * I.clock.y * 60.0;
  return vec4<f32>(v, 0.0, 1.0);
}

@fragment
fn fs_divergence(in: FullOut) -> @location(0) vec4<f32> {
  let p = vec2<i32>(in.position.xy);
  let l = load_src(p - vec2<i32>(1, 0)).x;
  let r = load_src(p + vec2<i32>(1, 0)).x;
  let t = load_src(p - vec2<i32>(0, 1)).y;
  let b = load_src(p + vec2<i32>(0, 1)).y;
  return vec4<f32>(0.5 * ((r - l) + (b - t)), 0.0, 0.0, 1.0);
}

@fragment
fn fs_jacobi(in: FullOut) -> @location(0) vec4<f32> {
  let p = vec2<i32>(in.position.xy);
  let l = load_src(p - vec2<i32>(1, 0)).x;
  let r = load_src(p + vec2<i32>(1, 0)).x;
  let t = load_src(p - vec2<i32>(0, 1)).x;
  let b = load_src(p + vec2<i32>(0, 1)).x;
  let div = load_aux(p).x;
  return vec4<f32>((l + r + t + b - div) * 0.25, 0.0, 0.0, 1.0);
}

@fragment
fn fs_gradient(in: FullOut) -> @location(0) vec4<f32> {
  let p = vec2<i32>(in.position.xy);
  let l = load_aux(p - vec2<i32>(1, 0)).x;
  let r = load_aux(p + vec2<i32>(1, 0)).x;
  let t = load_aux(p - vec2<i32>(0, 1)).x;
  let b = load_aux(p + vec2<i32>(0, 1)).x;
  let v = load_src(p).xy - 0.5 * vec2<f32>(r - l, b - t);
  return vec4<f32>(v, 0.0, 1.0);
}

// Ink: r = ink A, g = ink B, b = heat (fresh ink glows, then cools).
@fragment
fn fs_splat_dye(in: FullOut) -> @location(0) vec4<f32> {
  var d = load_src(vec2<i32>(in.position.xy));
  for (var j = 0u; j < u32(I.clock.w); j = j + 1u) {
    let jet = I.jets[j];
    // A fibrous jet: the falloff is broken up so the ink enters in strands.
    let g = jet_falloff(in.uv, jet);
    let grain = 0.55 + 0.45 * gnoise2(in.uv * vec2<f32>(I.clock.z, 1.0) * 22.0 + jet.a.xy * 91.0, 7u).x;
    let add = jet.b.z * g * grain * I.clock.y * 9.0;
    if (jet.b.w < 0.5) {
      d.r += add;
    } else {
      d.g += add;
    }
    d.b += add * 0.8;
  }
  return vec4<f32>(min(d.rgb, vec3<f32>(6.0)), 1.0);
}

@fragment
fn fs_advect_dye(in: FullOut) -> @location(0) vec4<f32> {
  let v = textureSampleLevel(aux_tex, ink_sampler, in.uv, 0.0).xy;
  let back = in.uv - v * I.clock.y * I.sim.zw;
  let d = textureSampleLevel(src_tex, ink_sampler, back, 0.0);
  // Ink that reaches the tank walls thins away instead of piling up there.
  let wall = smoothstep(0.0, 0.05, min(min(in.uv.x, 1.0 - in.uv.x), min(in.uv.y, 1.0 - in.uv.y)));
  let keep = pow(I.solve.y, I.clock.y) * pow(mix(0.03, 1.0, wall), I.clock.y);
  return vec4<f32>(d.r * keep, d.g * keep, d.b * pow(0.25, I.clock.y), 1.0);
}

fn ink_total(uv: vec2<f32>) -> f32 {
  let d = textureSampleLevel(src_tex, ink_sampler, uv, 0.0);
  return d.r + d.g;
}

@fragment
fn fs_display(in: FullOut) -> @location(0) vec4<f32> {
  // The camera: find the tank point this pixel sees.
  let aspect = I.clock.z;
  let sp = vec2<f32>((in.uv.x - 0.5) * 2.0 * aspect, (0.5 - in.uv.y) * 2.0);
  let tp = view2_invert(I.view, sp);
  let uv = vec2<f32>(tp.x / (2.0 * aspect) + 0.5, 0.5 - tp.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4<f32>(vec3<f32>(0.92, 0.94, 0.96) * I.look.z, 1.0);
  }
  return ink_shade(uv);
}

fn ink_shade(uv: vec2<f32>) -> vec4<f32> {
  let d = textureSampleLevel(src_tex, ink_sampler, uv, 0.0);
  let a = max(d.r, 0.0);
  let b = max(d.g, 0.0);
  let total = a + b;
  let texel = I.dye.zw * 1.5;
  // Relief: the ink's thickness as a height lit from the upper left.
  let gx = ink_total(uv + vec2<f32>(texel.x, 0.0)) - ink_total(uv - vec2<f32>(texel.x, 0.0));
  let gy = ink_total(uv + vec2<f32>(0.0, texel.y)) - ink_total(uv - vec2<f32>(0.0, texel.y));
  let n = normalize(vec3<f32>(-gx * I.look.y * 2.0, gy * I.look.y * 2.0, 1.0));
  let light = normalize(vec3<f32>(-0.45, 0.55, 0.7));
  let diffuse = 0.45 + 0.55 * max(dot(n, light), 0.0);
  let spec = pow(max(dot(n, normalize(light + vec3<f32>(0.0, 0.0, 1.0))), 0.0), 40.0);
  let mixc = (I.ink_a.rgb * I.ink_a.w * a + I.ink_b.rgb * I.ink_b.w * b) / max(total, 1e-4);
  let thick = 1.0 - exp(-total * I.look.x * 4.0);
  if (I.look.z > 0.5) {
    // Backlit tank: white light through two absorbing inks.
    let absorb_a = (vec3<f32>(1.0) - I.ink_a.rgb) * 0.85 + 0.15;
    let absorb_b = (vec3<f32>(1.0) - I.ink_b.rgb) * 0.85 + 0.15;
    let depth = (absorb_a * a + absorb_b * b) * I.look.x * 28.0;
    var col = vec3<f32>(0.92, 0.94, 0.96) * exp(-depth);
    col *= 0.8 + 0.2 * diffuse;
    col += vec3<f32>(spec * 0.25 * thick);
    return vec4<f32>(col, 1.0);
  }
  var col = mixc * thick * diffuse;
  // Dense, fresh ink burns toward the core light; thin edges stay dark.
  col += I.core.rgb * I.core.w * spec * thick * 0.2;
  col += I.core.rgb * I.core.w * min(d.b, 2.0) * thick * 0.16;
  // Keep the inks rich: lift saturation a little around their own luminance.
  let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3<f32>(luma), col, 1.3), vec3<f32>(0.0));
  return vec4<f32>(col, 1.0);
}

// A fresh tank (new layer, new size, or an offline render starting).
@fragment
fn fs_clear(in: FullOut) -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}
