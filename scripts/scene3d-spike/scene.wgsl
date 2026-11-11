// Scene 3D spike: lit meshes with a real shadow map, plus colliding particles.
// Geometry is generated from the vertex index so the spike needs no mesh upload.

struct Scene {
  view_proj: mat4x4f,
  light_view_proj: mat4x4f,
  cam_pos: vec4f,     // xyz, time
  light_dir: vec4f,   // xyz towards the light, intensity
  params: vec4f,      // dt, particle count, shadows on, occluders on
  params2: vec4f,     // shadow map size, bloom strength, exposure, frame
  cam_right: vec4f,
  cam_up: vec4f,
}

struct Particle {
  pos: vec3f,
  life: f32,
  vel: vec3f,
  seed: f32,
}

const PI = 3.14159265;
const SPHERE_C = vec3f(0.0, 1.45, 0.0);
const SPHERE_R = 1.0;
const BOX_C = vec3f(2.3, 0.6, 0.6);
const BOX_H = vec3f(0.6, 0.6, 0.6);
const SEG_U = 64u;
const SEG_V = 32u;
const GROUND_VERTS = 6u;
const SPHERE_VERTS = 12288u; // SEG_U * SEG_V * 6
const BOX_VERTS = 36u;

@group(0) @binding(0) var<uniform> scene: Scene;

struct MeshVertex {
  pos: vec3f,
  normal: vec3f,
  material: f32,
}

fn quad_corner(i: u32) -> vec2f {
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
  );
  return corners[i % 6u];
}

fn sphere_point(u: f32, v: f32) -> vec3f {
  let theta = u * 2.0 * PI;
  let phi = v * PI;
  return vec3f(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
}

fn mesh_vertex(vi: u32) -> MeshVertex {
  var out: MeshVertex;
  if (vi < GROUND_VERTS) {
    let c = quad_corner(vi) * 2.0 - 1.0;
    out.pos = vec3f(c.x * 9.0, 0.0, c.y * 9.0);
    out.normal = vec3f(0.0, 1.0, 0.0);
    out.material = 0.0;
    return out;
  }
  if (vi < GROUND_VERTS + SPHERE_VERTS) {
    let i = vi - GROUND_VERTS;
    let cell = i / 6u;
    let c = quad_corner(i);
    let u = (f32(cell % SEG_U) + c.x) / f32(SEG_U);
    let v = (f32(cell / SEG_U) + c.y) / f32(SEG_V);
    let n = sphere_point(u, v);
    out.pos = SPHERE_C + n * SPHERE_R;
    out.normal = n;
    out.material = 1.0;
    return out;
  }
  let i = vi - GROUND_VERTS - SPHERE_VERTS;
  let face = i / 6u;
  let c = quad_corner(i) * 2.0 - 1.0;
  let axis = face / 2u;
  let dir = f32(face % 2u) * 2.0 - 1.0;
  var n = vec3f(0.0);
  var p = vec3f(0.0);
  if (axis == 0u) { n = vec3f(dir, 0.0, 0.0); p = vec3f(dir, c.x, c.y); }
  else if (axis == 1u) { n = vec3f(0.0, dir, 0.0); p = vec3f(c.x, dir, c.y); }
  else { n = vec3f(0.0, 0.0, dir); p = vec3f(c.x, c.y, dir); }
  out.pos = BOX_C + p * BOX_H;
  out.normal = n;
  out.material = 2.0;
  return out;
}

// ── shadow map ───────────────────────────────────────────────────────────

struct ShadowOut {
  @builtin(position) clip: vec4f,
}

@vertex
fn vs_shadow(@builtin(vertex_index) vi: u32) -> ShadowOut {
  let v = mesh_vertex(vi);
  var out: ShadowOut;
  out.clip = scene.light_view_proj * vec4f(v.pos, 1.0);
  if (scene.params.w < 0.5 && v.material > 0.5) { out.clip = vec4f(2.0, 2.0, 2.0, 1.0); }
  return out;
}

// ── lit opaque pass ──────────────────────────────────────────────────────

@group(0) @binding(1) var shadow_map: texture_depth_2d;

fn shadow_at(world: vec3f, normal: vec3f) -> f32 {
  if (scene.params.z < 0.5) { return 1.0; }
  let ndl = max(dot(normal, scene.light_dir.xyz), 0.0);
  let offset = normal * (0.02 + 0.05 * (1.0 - ndl));
  let lp = scene.light_view_proj * vec4f(world + offset, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0 || lp.z >= 1.0) { return 1.0; }
  let size = scene.params2.x;
  let texel = uv * size - 0.5;
  let base = vec2i(floor(texel));
  var lit = 0.0;
  for (var y = -1; y <= 2; y++) {
    for (var x = -1; x <= 2; x++) {
      let c = clamp(base + vec2i(x, y), vec2i(0), vec2i(i32(size) - 1));
      let d = textureLoad(shadow_map, c, 0);
      lit += select(0.0, 1.0, lp.z - 0.0006 <= d);
    }
  }
  return lit / 16.0;
}

struct LitOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) material: f32,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> LitOut {
  let v = mesh_vertex(vi);
  var out: LitOut;
  out.clip = scene.view_proj * vec4f(v.pos, 1.0);
  if (scene.params.w < 0.5 && v.material > 0.5) { out.clip = vec4f(2.0, 2.0, 2.0, 1.0); }
  out.world = v.pos;
  out.normal = v.normal;
  out.material = v.material;
  return out;
}

@fragment
fn fs_main(in: LitOut) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let l = scene.light_dir.xyz;
  let v = normalize(scene.cam_pos.xyz - in.world);
  let h = normalize(l + v);
  let ndl = max(dot(n, l), 0.0);
  let shadow = shadow_at(in.world, n);

  var albedo = vec3f(0.5);
  var rough = 0.6;
  var emissive = vec3f(0.0);
  if (in.material < 0.5) {
    // Ground: dark stage floor with a faint metre grid.
    let g = abs(fract(in.world.xz) - 0.5);
    let line = smoothstep(0.47, 0.5, max(g.x, g.y));
    albedo = mix(vec3f(0.055, 0.06, 0.07), vec3f(0.11, 0.12, 0.14), line);
    rough = 0.45;
  } else if (in.material < 1.5) {
    albedo = vec3f(0.58, 0.57, 0.55);
    rough = 0.22;
  } else {
    albedo = vec3f(0.5, 0.2, 0.07);
    rough = 0.5;
    // A glowing band, bright enough to bloom.
    let band = smoothstep(0.06, 0.02, abs(in.world.y - 0.6));
    emissive = vec3f(6.0, 2.2, 0.6) * band;
  }
  let shininess = mix(220.0, 12.0, rough);
  let spec = pow(max(dot(n, h), 0.0), shininess) * (1.0 - rough) * 4.0;
  let sky = mix(vec3f(0.03, 0.035, 0.05), vec3f(0.10, 0.13, 0.2), n.y * 0.5 + 0.5);
  let sun = vec3f(1.0, 0.95, 0.88) * scene.light_dir.w;
  var colour = albedo * sky + (albedo * ndl + spec) * sun * shadow + emissive;
  // Distance fade into the void.
  let dist = length(in.world.xz);
  colour *= 1.0 - smoothstep(6.0, 9.0, dist);
  return vec4f(colour, 1.0);
}

// ── particles: simulation ────────────────────────────────────────────────

@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;

// Wall-clock step. The sender stamps each graph with the time it was built,
// but only some graphs are drawn, so the step is worked out here, once per
// drawn frame, from the time the previous drawn frame carried.
struct Clock {
  last: f32,
  dt: f32,
  frames: f32,
  pad: f32,
}
@group(0) @binding(4) var<storage, read_write> clock: Clock;

@compute @workgroup_size(1)
fn cs_clock() {
  let now = scene.cam_pos.w;
  let step = now - clock.last;
  clock.dt = select(clamp(step, 0.0, 0.05), 1.0 / 60.0, clock.frames < 0.5);
  clock.last = now;
  clock.frames += 1.0;
}

fn hash1(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

fn sd_box(p: vec3f) -> f32 {
  let q = abs(p - BOX_C) - BOX_H;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn box_normal(p: vec3f) -> vec3f {
  let q = (p - BOX_C) / BOX_H;
  let a = abs(q);
  if (a.x > a.y && a.x > a.z) { return vec3f(sign(q.x), 0.0, 0.0); }
  if (a.y > a.z) { return vec3f(0.0, sign(q.y), 0.0); }
  return vec3f(0.0, 0.0, sign(q.z));
}

@compute @workgroup_size(256)
fn cs_sim(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (f32(i) >= scene.params.y) { return; }
  var p = particles[i];
  let dt = clock.dt;
  let frame = u32(clock.frames);
  if (p.seed == 0.0) {
    // First frame: stagger the start so the stream is continuous.
    p.seed = hash1(i) + 0.0001;
    p.life = hash1(i + 7919u) * 7.0;
    p.pos = vec3f(0.0, -100.0, 0.0);
    p.vel = vec3f(0.0);
  }
  p.life -= dt;
  if (p.life <= 0.0) {
    let a = hash1(i * 3u + frame) * 2.0 * PI;
    let r = sqrt(hash1(i * 5u + frame * 13u)) * 0.55;
    p.pos = vec3f(cos(a) * r, 5.2 + hash1(i + frame) * 0.4, sin(a) * r);
    p.vel = vec3f(cos(a) * 0.15, -0.6 - hash1(i * 11u + frame), sin(a) * 0.15);
    p.life = 5.0 + hash1(i * 17u + frame) * 3.0;
  } else if (p.pos.y > -50.0) {
    let t = scene.cam_pos.w;
    // Gentle swirling wind so the stream is not a rigid column.
    let wind = vec3f(
      sin(p.pos.y * 1.7 + t * 0.9 + p.seed * 6.0),
      0.0,
      cos(p.pos.y * 1.3 - t * 0.7 + p.seed * 4.0),
    ) * 0.35;
    p.vel += (vec3f(0.0, -3.2, 0.0) + wind) * dt;
    p.vel *= 1.0 - 0.25 * dt;
    p.pos += p.vel * dt;

    if (scene.params.w > 0.5) {
      // Sphere.
      let d = p.pos - SPHERE_C;
      let len = length(d);
      if (len < SPHERE_R + 0.012) {
        let n = d / max(len, 1e-4);
        p.pos = SPHERE_C + n * (SPHERE_R + 0.012);
        let vn = dot(p.vel, n);
        if (vn < 0.0) { p.vel = (p.vel - n * vn) * 0.985 - n * vn * 0.28; }
      }
      // Box.
      if (sd_box(p.pos) < 0.012) {
        let n = box_normal(p.pos);
        p.pos += n * (0.012 - sd_box(p.pos));
        let vn = dot(p.vel, n);
        if (vn < 0.0) { p.vel = (p.vel - n * vn) * 0.97 - n * vn * 0.25; }
      }
    }
    // Ground.
    if (p.pos.y < 0.012) {
      p.pos.y = 0.012;
      if (p.vel.y < 0.0) {
        p.vel = vec3f(p.vel.x * 0.9, -p.vel.y * 0.32, p.vel.z * 0.9);
      }
    }
  }
  particles[i] = p;
}

// ── particles: draw ──────────────────────────────────────────────────────

@group(0) @binding(3) var<storage, read> particles_ro: array<Particle>;

struct SpriteOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) colour: vec3f,
}

@vertex
fn vs_particle(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SpriteOut {
  let p = particles_ro[ii];
  let c = quad_corner(vi) * 2.0 - 1.0;
  var out: SpriteOut;
  if (p.pos.y < -50.0) {
    out.clip = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }
  let size = 0.011 + p.seed * 0.006;
  let world = p.pos + (scene.cam_right.xyz * c.x + scene.cam_up.xyz * c.y) * size;
  out.clip = scene.view_proj * vec4f(world, 1.0);
  out.uv = c;
  let speed = length(p.vel);
  let cool = vec3f(0.25, 0.55, 1.0);
  let hot = vec3f(1.0, 0.75, 0.45);
  let fade = smoothstep(0.0, 0.6, p.life);
  // One shadow lookup per grain: grains inside the sphere's shadow go dark.
  let lit = shadow_at(p.pos, scene.light_dir.xyz);
  out.colour = mix(cool, hot, clamp(speed * 0.28, 0.0, 1.0)) * (0.05 + 0.6 * lit) * fade;
  return out;
}

@fragment
fn fs_particle(in: SpriteOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let a = (1.0 - r2);
  return vec4f(in.colour * a * a, 0.0);
}
