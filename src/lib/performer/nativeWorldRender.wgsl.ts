export const PERFORMER_WORLD_RENDER_WGSL = /* wgsl */ `
struct WorldUniform {
  resolution: vec2<f32>,
  time: f32,
  dt: f32,
  world: u32,
  space: u32,
  pointerDown: u32,
  pad0: u32,
  xy: vec2<f32>,
  audio: vec2<f32>,
  params0: vec4<f32>,
  params1: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: WorldUniform;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(3.0, 1.0),
    vec2<f32>(-1.0, 1.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[index], 0.0, 1.0);
  output.uv = positions[index] * 0.5 + vec2<f32>(0.5);
  return output;
}

fn hash21(p: vec2<f32>) -> f32 {
  let q = fract(p * vec2<f32>(123.34, 456.21));
  return fract((q.x + q.y) * (q.x + q.y + 45.32));
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
  let n = hash21(p);
  return vec2<f32>(n, hash21(p + vec2<f32>(n + 17.17, 31.73)));
}

fn rot(a: f32) -> mat2x2<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat2x2<f32>(c, -s, s, c);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.55 + 0.45 * cos(6.2831853 * (vec3<f32>(0.02, 0.28, 0.56) + t));
}

fn lineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), w.x),
    mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), w.x),
    w.y,
  );
}

fn fbm(inputP: vec2<f32>) -> f32 {
  var p = inputP;
  var value = 0.0;
  var amplitude = 0.5;
  for (var i = 0; i < 5; i = i + 1) {
    value += amplitude * noise(p);
    p = rot(0.53) * p * 2.03 + vec2<f32>(7.1, 3.7);
    amplitude *= 0.5;
  }
  return value;
}

fn spaceTransform(inputP: vec2<f32>) -> vec2<f32> {
  var p = inputP;
  let speed = 0.2 + u.params0.w * 1.8;
  let pointer = (u.xy - vec2<f32>(0.5)) * vec2<f32>(1.5, -1.5);
  switch u.space {
    case 0u: {
      p = rot(u.time * speed * 0.35 + pointer.x) * p;
    }
    case 1u: {
      let pulse = 0.78 + 0.22 * fract(u.time * speed * 0.3);
      p = p / pulse + pointer * 0.25;
    }
    case 2u: {
      p.x += pointer.x * (0.3 + abs(p.y));
      p.y = p.y * (0.72 + 0.34 * max(p.y + 0.5, 0.0)) + 0.18;
      p.y += u.time * speed * 0.12;
    }
    case 3u: {
      let r = max(length(p), 0.0001);
      let a = atan2(p.y, p.x) + u.time * speed * 0.4;
      p = vec2<f32>(a / 3.14159265, 0.24 / r + u.time * speed * 0.22);
    }
    case 4u: {
      p = rot(sin(u.time * 0.31) * 0.8 + pointer.y) * p;
      p += 0.08 * vec2<f32>(sin(u.time * 0.73), cos(u.time * 0.59));
    }
    default: {
      p.y += u.time * speed * 0.35;
      p.x += sin(p.y * 3.0 + u.time) * 0.08 + pointer.x * 0.2;
    }
  }
  return p;
}

fn particleWorld(p: vec2<f32>) -> vec4<f32> {
  let density = 7.0 + u.params0.x * 18.0;
  let cell = floor(p * density);
  let local = fract(p * density) - 0.5;
  let seed = hash22(cell);
  let drift = 0.24 * vec2<f32>(
    sin(u.time * (0.4 + seed.x) + seed.y * 10.0),
    cos(u.time * (0.5 + seed.y) + seed.x * 9.0),
  );
  let d = length(local - drift);
  let point = smoothstep(0.16 + u.params0.y * 0.12, 0.01, d);
  let trail = smoothstep(0.08, 0.0, lineSegment(local, drift, drift - vec2<f32>(0.0, 0.3 * u.params1.x)));
  let alpha = max(point, trail * 0.55) * step(0.18, seed.x);
  return vec4<f32>(palette(seed.y + u.params1.y), alpha);
}

fn cubeWorld(p: vec2<f32>) -> vec4<f32> {
  let scale = 3.0 + u.params0.x * 8.0;
  let q = fract(rot(u.time * u.params0.w * 0.2) * p * scale) - 0.5;
  let edge = min(abs(abs(q.x) - 0.34), abs(abs(q.y) - 0.34));
  let diagonal = abs(abs(q.x + q.y) - 0.34);
  let alpha = smoothstep(0.055 + u.params1.x * 0.035, 0.005, min(edge, diagonal));
  return vec4<f32>(palette(length(p) + u.params1.y), alpha);
}

fn fractalWorld(inputP: vec2<f32>) -> vec4<f32> {
  var p = inputP;
  var glow = 0.0;
  let depth = 3 + i32(round(u.params0.x * 5.0));
  for (var i = 0; i < 8; i = i + 1) {
    if (i >= depth) { break; }
    p = abs(p) / max(dot(p, p), 0.16) - vec2<f32>(0.72 + u.params0.y * 0.38);
    p = rot(u.params0.z * 0.8 + u.time * u.params1.y * 0.08) * p;
    glow += exp(-9.0 * abs(length(p) - (0.25 + u.params0.w * 0.18)));
  }
  let alpha = clamp(glow * (0.08 + u.params1.x * 0.18), 0.0, 1.0);
  return vec4<f32>(palette(glow * 0.08 + u.params1.z), alpha);
}

fn terrainWorld(p: vec2<f32>) -> vec4<f32> {
  let terrain = fbm(vec2<f32>(p.x * (2.0 + u.params0.y * 8.0), p.y * 2.0 - u.time * 0.25));
  let contour = smoothstep(0.08, 0.0, abs(fract(terrain * (5.0 + u.params0.x * 12.0)) - 0.5));
  let horizon = smoothstep(0.55, -0.3, p.y + terrain * 0.35);
  let alpha = max(contour * 0.8, horizon * (0.18 + u.params1.x * 0.32));
  return vec4<f32>(mix(vec3<f32>(0.04, 0.16, 0.24), palette(u.params1.w + terrain), terrain), alpha);
}

fn nodeWorld(p: vec2<f32>) -> vec4<f32> {
  let scale = 4.0 + u.params0.x * 8.0;
  let cell = floor(p * scale);
  let local = fract(p * scale) - 0.5;
  let center = hash22(cell) - 0.5;
  var d = length(local - center);
  var links = 0.0;
  for (var ox = -1; ox <= 1; ox = ox + 1) {
    for (var oy = -1; oy <= 1; oy = oy + 1) {
      let offset = vec2<f32>(f32(ox), f32(oy));
      let other = offset + hash22(cell + offset) - 0.5;
      let distanceToLink = lineSegment(local, center, other);
      links = max(links, smoothstep(0.035 + u.params1.x * 0.025, 0.003, distanceToLink)
        * step(length(other - center), 0.45 + u.params0.y));
    }
  }
  let pulse = 0.65 + 0.35 * sin(u.time * 3.0 + hash21(cell) * 9.0);
  let nodes = smoothstep(0.12 + u.params1.y * 0.08, 0.01, d) * pulse;
  let alpha = max(nodes, links * 0.7);
  return vec4<f32>(palette(hash21(cell) + u.params1.z), alpha);
}

fn fluidWorld(p: vec2<f32>) -> vec4<f32> {
  let flow = fbm(p * (2.0 + u.params0.z * 6.0) + vec2<f32>(u.time * u.params1.x, -u.time * 0.17));
  let warp = fbm(rot(flow * 2.0) * p * 5.0 - u.time * 0.11);
  let ribbons = 0.5 + 0.5 * sin((flow + warp) * (10.0 + u.params0.y * 20.0));
  let alpha = smoothstep(0.2, 0.9, ribbons) * (0.45 + u.params1.y * 0.45);
  return vec4<f32>(palette(flow + u.params0.w), alpha);
}

fn crystalWorld(p: vec2<f32>) -> vec4<f32> {
  let a = atan2(p.y, p.x);
  let r = length(p);
  let facets = 3.0 + floor(u.params0.x * 9.0);
  let angular = abs(fract(a / 6.2831853 * facets + u.time * u.params1.y * 0.08) - 0.5);
  let radial = abs(fract(r * (4.0 + u.params0.w * 9.0)) - 0.5);
  let edge = min(angular, radial);
  let alpha = smoothstep(0.08 + u.params1.x * 0.05, 0.005, edge);
  return vec4<f32>(palette(a / 6.2831853 + r + u.params1.z), alpha);
}

fn vortexWorld(p: vec2<f32>) -> vec4<f32> {
  let r = max(length(p), 0.001);
  let a = atan2(p.y, p.x);
  let arms = 2.0 + floor(u.params0.x * 9.0);
  let spiral = sin(a * arms - log(r) * (3.0 + u.params0.z * 8.0) - u.time * (0.5 + u.params0.y * 2.5));
  let ribbon = smoothstep(0.25 + u.params1.x * 0.3, 1.0, spiral);
  let core = exp(-r * (3.0 + u.params0.w * 6.0));
  let alpha = clamp(ribbon * smoothstep(1.2, 0.04, r) + core, 0.0, 1.0);
  return vec4<f32>(palette(a / 6.2831853 + r + u.params1.y), alpha);
}

fn starfieldWorld(p: vec2<f32>) -> vec4<f32> {
  var color = vec3<f32>(0.0);
  var alpha = 0.0;
  for (var layer = 0; layer < 4; layer = layer + 1) {
    let depth = fract(f32(layer) * 0.23 + u.time * (0.05 + u.params0.y * 0.25));
    let scale = mix(4.0, 24.0, depth);
    let cell = floor(p * scale);
    let local = fract(p * scale) - 0.5;
    let seed = hash22(cell + vec2<f32>(f32(layer) * 37.0));
    let star = smoothstep(0.08 + u.params0.z * 0.06, 0.005, length(local - (seed - 0.5)));
    let fade = sin(depth * 3.14159265);
    color += palette(seed.x + u.params1.x) * star * fade;
    alpha = max(alpha, star * fade);
  }
  return vec4<f32>(color, alpha);
}

fn organismWorld(p: vec2<f32>) -> vec4<f32> {
  let q = p * (3.0 + u.params0.x * 6.0);
  let cell = floor(q);
  let local = fract(q) - 0.5;
  let seed = hash22(cell);
  let wobble = 0.12 * vec2<f32>(sin(u.time + seed.x * 9.0), cos(u.time * 0.8 + seed.y * 8.0));
  let membrane = abs(length(local - wobble) - (0.16 + seed.x * 0.25));
  let veins = abs(sin((local.x + local.y + fbm(q * 0.35)) * 12.0));
  let alpha = max(smoothstep(0.045, 0.005, membrane), smoothstep(0.09, 0.0, veins) * u.params0.z * 0.45);
  return vec4<f32>(palette(seed.y + u.params0.w + u.params1.y), alpha);
}

fn auroraWorld(p: vec2<f32>) -> vec4<f32> {
  var color = vec3<f32>(0.0);
  var alpha = 0.0;
  let ribbons = 2 + i32(round(u.params0.x * 5.0));
  for (var i = 0; i < 7; i = i + 1) {
    if (i >= ribbons) { break; }
    let fi = f32(i);
    let wave = sin(p.x * (2.0 + u.params0.z * 8.0) + u.time * (0.4 + u.params1.x) + fi * 1.7);
    let y = (fi - f32(ribbons - 1) * 0.5) * (0.08 + u.params1.w * 0.12) + wave * (0.08 + u.params0.y * 0.22);
    let band = exp(-abs(p.y - y) * (8.0 + u.params0.w * 20.0));
    color += palette(fi * 0.17 + u.params1.z) * band;
    alpha = max(alpha, band);
  }
  return vec4<f32>(color, clamp(alpha, 0.0, 1.0));
}

fn dnaWorld(p: vec2<f32>) -> vec4<f32> {
  let speed = 0.3 + u.params0.w * 2.0;
  let phase = p.y * (5.0 + u.params0.x * 13.0) - u.time * speed;
  let radius = 0.12 + u.params0.z * 0.32;
  let x1 = sin(phase) * radius;
  let x2 = -x1;
  let strand = max(
    smoothstep(0.035 + u.params1.x * 0.03, 0.004, abs(p.x - x1)),
    smoothstep(0.035 + u.params1.x * 0.03, 0.004, abs(p.x - x2)),
  );
  let rungPhase = abs(fract(p.y * (8.0 + u.params1.y * 22.0)) - 0.5);
  let rung = smoothstep(0.06, 0.005, rungPhase) * step(abs(p.x), abs(x1));
  let alpha = max(strand, rung * 0.75);
  return vec4<f32>(palette(phase * 0.08 + u.params1.z), alpha);
}

fn swarmWorld(p: vec2<f32>) -> vec4<f32> {
  var color = vec3<f32>(0.0);
  var alpha = 0.0;
  let count = 8 + i32(round(u.params0.x * 24.0));
  for (var i = 0; i < 32; i = i + 1) {
    if (i >= count) { break; }
    let fi = f32(i);
    let seed = hash22(vec2<f32>(fi, fi * 3.17));
    let orbit = (0.15 + seed.x * (0.25 + u.params0.w * 0.5));
    let pos = vec2<f32>(
      cos(u.time * (0.3 + u.params0.z * 2.0) + fi * 2.4),
      sin(u.time * (0.25 + u.params0.z * 1.7) + fi * 1.9),
    ) * orbit + (seed - 0.5) * u.params1.x;
    let point = smoothstep(0.035 + u.params1.y * 0.04, 0.002, length(p - pos));
    color += palette(seed.y + u.params1.z) * point;
    alpha = max(alpha, point);
  }
  return vec4<f32>(color, alpha);
}

fn ringsWorld(p: vec2<f32>) -> vec4<f32> {
  let count = 3.0 + floor(u.params0.x * 12.0);
  let tilted = vec2<f32>(p.x, p.y / (0.25 + u.params0.w * 0.75));
  let r = length(rot(u.time * u.params0.z * 0.35) * tilted);
  let ring = abs(fract(r * count / max(0.35 + u.params0.y, 0.05)) - 0.5);
  let alpha = smoothstep(0.08 + u.params1.y * 0.08, 0.005, ring)
    * smoothstep(1.1, 0.08, r);
  return vec4<f32>(palette(r + u.params1.z + u.time * 0.03), alpha);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  var p = (input.uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0) * 2.0;
  p = spaceTransform(p);
  let pointer = (u.xy - vec2<f32>(0.5)) * vec2<f32>(aspect, -1.0) * 2.0;
  if (u.pointerDown != 0u) {
    let pull = exp(-length(p - pointer) * 3.0);
    p = mix(p, pointer, pull * 0.18);
  }

  var result: vec4<f32>;
  switch u.world {
    case 0u: { result = particleWorld(p); }
    case 1u: { result = cubeWorld(p); }
    case 2u: { result = fractalWorld(p); }
    case 3u: { result = terrainWorld(p); }
    case 4u: { result = nodeWorld(p); }
    case 5u: { result = fluidWorld(p); }
    case 6u: { result = crystalWorld(p); }
    case 7u: { result = vortexWorld(p); }
    case 8u: { result = starfieldWorld(p); }
    case 9u: { result = organismWorld(p); }
    case 10u: { result = auroraWorld(p); }
    case 11u: { result = dnaWorld(p); }
    case 12u: { result = swarmWorld(p); }
    default: { result = ringsWorld(p); }
  }

  let audioBoost = 0.75 + u.audio.x * 0.8 + u.audio.y * 0.9;
  let alpha = clamp(result.a * audioBoost, 0.0, 1.0);
  let color = result.rgb * (0.8 + u.audio.x * 1.2);
  return vec4<f32>(color * alpha, alpha);
}
`;
