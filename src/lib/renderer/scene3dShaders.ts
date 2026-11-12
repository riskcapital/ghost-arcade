/**
 * WGSL for Interactive 3D scenes (see scene3dNative.ts for the graph).
 *
 *   scene3d/sim    cs_frame: camera, key light and clock for this frame;
 *                  cs_sim: particles (emitters, fields, colliders)
 *   scene3d/world  vs_shadow: key light depth; vs_main + fs_main: lit opaque
 *                  meshes; fs_glass: see-through surfaces; vs_particle +
 *                  fs_particle: particles
 *   scene3d/post   bloom chain and the final composite
 *
 * Bindings (group 0): 0 scene settings (app), 1 frame block (core, see
 * scene3dFrame.ts), 2 view (written by cs_frame), 3 vertices, 4 materials,
 * 5 shadow map, 6 particles, 7 emitters, 8 fields, 9 point lights,
 * 10 colliders. Post: 0 scene, 1 frame, 2 source, 3 sampler, 4 bloom.
 */
import { SCENE3D_FRAME_WGSL } from './scene3dFrame';

/** Floats in the scene settings uniform (vec4 slots × 4). */
export const SCENE_UNIFORM_FLOATS = 12 * 4;
export const VIEW_FLOATS = 16 + 16 + 4 * 8;
export const MATERIAL_FLOATS = 8;
export const PARTICLE_FLOATS = 12;
export const EMITTER_FLOATS = 24;
export const FIELD_FLOATS = 12;
export const LIGHT_FLOATS = 12;
export const COLLIDER_FLOATS = 36;
export const MAX_EMITTERS = 16;
export const MAX_FIELDS = 16;
export const MAX_POINT_LIGHTS = 8;
export const MAX_COLLIDERS = 64;

const COMMON = /* wgsl */ `
${SCENE3D_FRAME_WGSL}

// Scene settings, written by the app when the scene changes.
struct Settings {
  cam_pos: vec4f,      // xyz, fov (degrees)
  cam_target: vec4f,   // xyz, mode (0 free, 1 director)
  key_color: vec4f,    // rgb, power
  key_dir: vec4f,      // xyz towards the light, orbit (degrees a second)
  key_opts: vec4f,     // shadows, present, shadow map size, 0
  env: vec4f,          // sky (0 void, 1 studio, 2 night), intensity, fog, aspect
  post_a: vec4f,       // bloom, exposure, contrast, saturation
  post_b: vec4f,       // temperature, grain, 0, 0
  react: vec4f,        // light, particles, bloom, camera
  counts: vec4f,       // vertices, particles, emitters, fields
  counts_b: vec4f,     // point lights, colliders, 0, 0
  bounds: vec4f,       // centre xyz, radius
}

// This frame's camera and light, worked out once on the GPU.
struct View {
  view_proj: mat4x4f,
  light_view_proj: mat4x4f,
  cam_pos: vec4f,      // xyz, time
  light: vec4f,        // direction towards the light, power after the music
  cam_right: vec4f,
  cam_up: vec4f,
  clock: vec4f,        // dt, frames, last time, director angle
  sky_top: vec4f,
  sky_low: vec4f,
  spare: vec4f,
}

struct Vertex { pos: vec3f, normal_x: f32, normal_yz: vec2f, material: f32, pad: f32 }
struct Material { base: vec3f, metal: f32, rough: f32, emissive: f32, opacity: f32, catcher: f32 }
struct Particle { pos: vec3f, life: f32, vel: vec3f, max_life: f32, info: vec4f } // info: emitter, generation, seed, size
struct Emitter {
  pos: vec4f,          // xyz, rate
  dir: vec4f,          // xyz, spread (radians)
  motion: vec4f,       // speed, life, size, glow
  color: vec4f,        // rgb, burst generation
  shape: vec4f,        // kind (0 point, 1 box, 2 sphere), extent xyz
  slots: vec4f,        // continuous start, count, burst start, count
}
struct Field { pos: vec4f, axis: vec4f, opts: vec4f } // pos.w kind, axis.w strength, opts.x radius
struct PointLight { pos: vec4f, color: vec4f, dir: vec4f } // pos.w kind (0 point, 1 spot), color.w power, dir.w cone cos
struct Collider { model: mat4x4f, inverse: mat4x4f, opts: vec4f } // opts.x shape (0 box, 1 sphere, 2 plane, 3 cylinder)

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<uniform> frame: SceneFrame;

const PI = 3.14159265;

fn hash1(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}
`;

export const SCENE3D_SIM_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(2) var<storage, read_write> view: View;
@group(0) @binding(6) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(7) var<storage, read> emitters: array<Emitter>;
@group(0) @binding(8) var<storage, read> fields: array<Field>;
@group(0) @binding(10) var<storage, read> colliders: array<Collider>;

fn look_at(eye: vec3f, aim: vec3f, up_hint: vec3f) -> mat4x4f {
  let f = normalize(aim - eye);
  var up = up_hint;
  if (abs(dot(f, up)) > 0.999) { up = vec3f(0.0, 0.0, 1.0); }
  let r = normalize(cross(f, up));
  let u = cross(r, f);
  return mat4x4f(
    vec4f(r.x, u.x, -f.x, 0.0),
    vec4f(r.y, u.y, -f.y, 0.0),
    vec4f(r.z, u.z, -f.z, 0.0),
    vec4f(-dot(r, eye), -dot(u, eye), dot(f, eye), 1.0),
  );
}
fn perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> mat4x4f {
  let f = 1.0 / tan(fov_y * 0.5);
  return mat4x4f(
    vec4f(f / aspect, 0.0, 0.0, 0.0),
    vec4f(0.0, f, 0.0, 0.0),
    vec4f(0.0, 0.0, far / (near - far), -1.0),
    vec4f(0.0, 0.0, near * far / (near - far), 0.0),
  );
}
fn ortho(half: f32, near: f32, far: f32) -> mat4x4f {
  return mat4x4f(
    vec4f(1.0 / half, 0.0, 0.0, 0.0),
    vec4f(0.0, 1.0 / half, 0.0, 0.0),
    vec4f(0.0, 0.0, 1.0 / (near - far), 0.0),
    vec4f(0.0, 0.0, near / (near - far), 1.0),
  );
}
fn rotate_y(v: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

@compute @workgroup_size(1)
fn cs_frame() {
  // Clock: the step since the last drawn frame (graphs can be dropped).
  let now = frame.time;
  var dt = select(clamp(now - view.clock.z, 0.0, 0.05), 1.0 / 60.0, view.clock.y < 0.5);
  if (frame.delta > 0.0) { dt = clamp(frame.delta, 0.0, 0.05); }
  view.clock = vec4f(dt, view.clock.y + 1.0, now, view.clock.w);

  // Camera. The director circles the target, faster as the music builds.
  var eye = settings.cam_pos.xyz;
  let aim = settings.cam_target.xyz;
  if (settings.cam_target.w > 0.5) {
    let speed = 0.12 + settings.react.w * (frame.energy * 0.5 + frame.beat * 0.2);
    view.clock.w = view.clock.w + dt * speed;
    eye = aim + rotate_y(eye - aim, view.clock.w);
  }
  let aspect = max(settings.env.w, 0.01);
  let cam_view = look_at(eye, aim, vec3f(0.0, 1.0, 0.0));
  view.view_proj = perspective(radians(settings.cam_pos.w), aspect, 0.05, 400.0) * cam_view;
  view.cam_pos = vec4f(eye, now);
  view.cam_right = vec4f(cam_view[0].x, cam_view[1].x, cam_view[2].x, 0.0);
  view.cam_up = vec4f(cam_view[0].y, cam_view[1].y, cam_view[2].y, 0.0);

  // Key light: turns around +Y by its orbit, breathes with the bass.
  let dir = normalize(rotate_y(settings.key_dir.xyz, radians(settings.key_dir.w) * now));
  let breathe = 1.0 + settings.react.x * (frame.bass * 0.8 + frame.kick * 0.4);
  view.light = vec4f(dir, settings.key_color.w * breathe);
  let c = settings.bounds.xyz;
  let r = max(settings.bounds.w, 0.5);
  view.light_view_proj = ortho(r, 0.05, r * 4.0) * look_at(c + dir * r * 2.0, c, vec3f(0.0, 1.0, 0.0));

  // Sky, top and horizon.
  let sky = settings.env.x;
  let k = settings.env.y;
  if (sky < 0.5) { view.sky_top = vec4f(0.0); view.sky_low = vec4f(0.0); }
  else if (sky < 1.5) { view.sky_top = vec4f(vec3f(0.30, 0.32, 0.36) * k, 1.0); view.sky_low = vec4f(vec3f(0.12, 0.12, 0.13) * k, 1.0); }
  else { view.sky_top = vec4f(vec3f(0.02, 0.03, 0.08) * k, 1.0); view.sky_low = vec4f(vec3f(0.06, 0.05, 0.10) * k, 1.0); }
}

fn local_point(c: Collider, p: vec3f) -> vec3f { return (c.inverse * vec4f(p, 1.0)).xyz; }
fn world_point(c: Collider, p: vec3f) -> vec3f { return (c.model * vec4f(p, 1.0)).xyz; }
fn world_normal(c: Collider, n: vec3f) -> vec3f { return normalize((transpose(c.inverse) * vec4f(n, 0.0)).xyz); }

// Push a particle out of a collider and bounce it. Shapes are unit sized in
// their own space, like the meshes.
fn collide(c: Collider, p: ptr<function, Particle>) {
  let q = local_point(c, (*p).pos);
  let shape = c.opts.x;
  var inside = false;
  var out_local = q;
  var n_local = vec3f(0.0, 1.0, 0.0);
  if (shape < 0.5) {
    let a = abs(q);
    if (a.x < 0.5 && a.y < 0.5 && a.z < 0.5) {
      inside = true;
      let d = vec3f(0.5) - a;
      if (d.x < d.y && d.x < d.z) { n_local = vec3f(sign(q.x), 0.0, 0.0); out_local.x = sign(q.x) * 0.5; }
      else if (d.y < d.z) { n_local = vec3f(0.0, sign(q.y), 0.0); out_local.y = sign(q.y) * 0.5; }
      else { n_local = vec3f(0.0, 0.0, sign(q.z)); out_local.z = sign(q.z) * 0.5; }
    }
  } else if (shape < 1.5) {
    let l = length(q);
    if (l < 0.5) { inside = true; n_local = q / max(l, 1e-4); out_local = n_local * 0.5; }
  } else if (shape < 2.5) {
    if (q.y < 0.0 && q.y > -0.25 && abs(q.x) < 0.5 && abs(q.z) < 0.5) { inside = true; out_local = vec3f(q.x, 0.0, q.z); }
  } else {
    let rl = length(q.xz);
    if (rl < 0.5 && abs(q.y) < 0.5) {
      inside = true;
      if (0.5 - abs(q.y) < 0.5 - rl) { n_local = vec3f(0.0, sign(q.y), 0.0); out_local.y = sign(q.y) * 0.5; }
      else { n_local = vec3f(q.x, 0.0, q.z) / max(rl, 1e-4); out_local = vec3f(n_local.x * 0.5, q.y, n_local.z * 0.5); }
    }
  }
  if (!inside) { return; }
  let n = world_normal(c, n_local);
  (*p).pos = world_point(c, out_local) + n * 0.003;
  let vn = dot((*p).vel, n);
  if (vn < 0.0) { (*p).vel = ((*p).vel - n * vn) * 0.92 - n * vn * 0.35; }
}

fn respawn(e: Emitter, i: u32, gen: u32) -> Particle {
  var p: Particle;
  let h1 = hash1(i * 7u + gen * 131u);
  let h2 = hash1(i * 13u + gen * 197u + 1u);
  let h3 = hash1(i * 29u + gen * 61u + 2u);
  var at = e.pos.xyz;
  if (e.shape.x > 0.5 && e.shape.x < 1.5) { at += (vec3f(h1, h2, h3) - 0.5) * 2.0 * e.shape.yzw; }
  else if (e.shape.x > 1.5) {
    let a = h1 * 2.0 * PI; let z = h2 * 2.0 - 1.0; let rr = pow(h3, 0.333);
    at += vec3f(sqrt(1.0 - z * z) * cos(a), z, sqrt(1.0 - z * z) * sin(a)) * rr * e.shape.yzw;
  }
  // A direction in the cone around the emitter's axis.
  let axis = normalize(e.dir.xyz);
  var side = cross(axis, vec3f(0.0, 0.0, 1.0));
  if (length(side) < 0.01) { side = cross(axis, vec3f(1.0, 0.0, 0.0)); }
  side = normalize(side);
  let other = cross(axis, side);
  let cos_t = mix(1.0, cos(e.dir.w), hash1(i * 31u + gen * 7u + 3u));
  let sin_t = sqrt(max(0.0, 1.0 - cos_t * cos_t));
  let phi = hash1(i * 37u + gen * 11u + 4u) * 2.0 * PI;
  let d = axis * cos_t + (side * cos(phi) + other * sin(phi)) * sin_t;
  p.pos = at;
  p.vel = d * e.motion.x * (0.8 + 0.4 * hash1(i * 41u + gen + 5u));
  p.max_life = e.motion.y * (0.75 + 0.5 * hash1(i * 43u + gen + 6u));
  p.life = p.max_life;
  p.info = vec4f(0.0, f32(gen), hash1(i * 47u + gen + 7u) + 0.0001, e.motion.z * (0.7 + 0.6 * hash1(i * 53u + gen + 8u)));
  return p;
}

const HIDDEN = vec3f(0.0, -1.0e4, 0.0);

@compute @workgroup_size(256)
fn cs_sim(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (f32(i) >= settings.counts.y) { return; }
  var p = particles[i];
  let dt = view.clock.x;
  let frames = u32(view.clock.y);
  // Which emitter owns this slot, and whether it is a burst slot.
  var owner = -1;
  var burst = false;
  var slot = 0u;
  var count = 0u;
  for (var k = 0u; k < u32(settings.counts.z); k++) {
    let s = emitters[k].slots;
    if (f32(i) >= s.x && f32(i) < s.x + s.y) { owner = i32(k); slot = i - u32(s.x); count = u32(s.y); break; }
    if (f32(i) >= s.z && f32(i) < s.z + s.w) { owner = i32(k); burst = true; break; }
  }
  if (owner < 0) { p.pos = HIDDEN; p.life = 0.0; particles[i] = p; return; }
  let e = emitters[u32(owner)];
  if (burst) {
    // A new burst generation restarts every burst slot at once.
    let gen = u32(e.color.w);
    if (gen > 0u && u32(p.info.y) != gen) { p = respawn(e, i, gen); p.info.x = f32(owner); }
  } else if (p.info.z == 0.0) {
    // First frame: start dead, staggered, so the stream is even from the start.
    p.pos = HIDDEN;
    p.info = vec4f(f32(owner), 0.0, hash1(i) + 0.0001, 0.0);
    p.life = -hash1(i * 3u + 1u) * e.motion.y;
  } else if (p.life <= 0.0) {
    p.life += dt;
    // Louder, more: the share of slots allowed to live follows the level.
    let share = clamp(1.0 - settings.react.y + settings.react.y * (frame.energy * 1.4 + frame.kick * 0.6), 0.0, 1.0);
    if (p.life >= 0.0 && f32(slot) < f32(count) * share) {
      p = respawn(e, i, frames + i);
      p.info.x = f32(owner);
    } else if (p.life >= 0.0) {
      p.life = -hash1(i + frames) * 0.2;
      p.pos = HIDDEN;
    }
  }
  if (p.life > 0.0 && p.pos.y > -1.0e3) {
    var acc = vec3f(0.0);
    for (var f = 0u; f < u32(settings.counts.w); f++) {
      let fd = fields[f];
      let to = fd.pos.xyz - p.pos;
      let dist = length(to);
      let w = select(1.0, clamp(1.0 - dist / fd.opts.x, 0.0, 1.0), fd.opts.x > 0.0);
      let kind = fd.pos.w;
      let s = fd.axis.w * w;
      if (kind < 0.5) { acc += -fd.axis.xyz * s; }                      // gravity, along the node's -Y
      else if (kind < 1.5) { acc += fd.axis.xyz * s; }                  // wind, along the node's +X
      else if (kind < 2.5) { acc += cross(fd.axis.xyz, -to) * s / max(dist * dist, 0.25); } // vortex about +Y
      else if (kind < 3.5) { acc += to / max(dist, 0.05) * s; }         // attract (negative repels)
      else {                                                            // curl
        let q = p.pos * 1.3 + vec3f(frame.time * 0.2);
        acc += vec3f(sin(q.y) - cos(q.z), sin(q.z) - cos(q.x), sin(q.x) - cos(q.y)) * s;
      }
    }
    p.vel += acc * dt;
    p.vel *= 1.0 - 0.2 * dt;
    p.pos += p.vel * dt;
    for (var c = 0u; c < u32(settings.counts_b.y); c++) { collide(colliders[c], &p); }
    p.life -= dt;
    if (p.life <= 0.0) {
      p.pos = HIDDEN;
      p.life = select(-hash1(i + frames) * 0.2, -1.0e9, burst);
    }
  }
  particles[i] = p;
}
`;

export const SCENE3D_WORLD_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(2) var<storage, read> view: View;
@group(0) @binding(3) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(4) var<storage, read> materials: array<Material>;
@group(0) @binding(5) var shadow_map: texture_depth_2d;
@group(0) @binding(6) var<storage, read> particles: array<Particle>;
@group(0) @binding(7) var<storage, read> emitters: array<Emitter>;
@group(0) @binding(9) var<storage, read> lights: array<PointLight>;

const OFFSCREEN = vec4f(2.0, 2.0, 2.0, 1.0);

fn vertex_normal(v: Vertex) -> vec3f { return vec3f(v.normal_x, v.normal_yz); }

struct ShadowOut { @builtin(position) clip: vec4f }

@vertex
fn vs_shadow(@builtin(vertex_index) vi: u32) -> ShadowOut {
  let v = vertices[vi];
  var out: ShadowOut;
  out.clip = view.light_view_proj * vec4f(v.pos, 1.0);
  // Glass lets the light through.
  if (materials[u32(v.material)].opacity < 0.999) { out.clip = OFFSCREEN; }
  return out;
}

fn shadow_at(world: vec3f, normal: vec3f) -> f32 {
  if (settings.key_opts.x < 0.5 || settings.key_opts.y < 0.5) { return 1.0; }
  let ndl = max(dot(normal, view.light.xyz), 0.0);
  let lp = view.light_view_proj * vec4f(world + normal * (0.01 + 0.04 * (1.0 - ndl)), 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0 || lp.z >= 1.0) { return 1.0; }
  let size = settings.key_opts.z;
  let base = vec2i(floor(uv * size - 0.5));
  var lit = 0.0;
  for (var y = -1; y <= 2; y++) {
    for (var x = -1; x <= 2; x++) {
      let c = clamp(base + vec2i(x, y), vec2i(0), vec2i(i32(size) - 1));
      lit += select(0.0, 1.0, lp.z - 0.0005 <= textureLoad(shadow_map, c, 0));
    }
  }
  return lit / 16.0;
}

struct LitOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) material: u32,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> LitOut {
  let v = vertices[vi];
  var out: LitOut;
  out.clip = view.view_proj * vec4f(v.pos, 1.0);
  out.world = v.pos;
  out.normal = vertex_normal(v);
  out.material = u32(v.material);
  return out;
}

fn sky_at(dir: vec3f) -> vec3f {
  return mix(view.sky_low.rgb, view.sky_top.rgb, clamp(dir.y * 0.5 + 0.5, 0.0, 1.0));
}

// Physically based: GGX specular, Schlick Fresnel, Lambert diffuse.
fn shade(m: Material, n: vec3f, v: vec3f, l: vec3f, radiance: vec3f) -> vec3f {
  let h = normalize(l + v);
  let ndl = max(dot(n, l), 0.0);
  let ndv = max(dot(n, v), 1e-3);
  let ndh = max(dot(n, h), 0.0);
  let a = max(m.rough * m.rough, 0.002);
  let a2 = a * a;
  let d = a2 / (PI * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
  let k = (m.rough + 1.0) * (m.rough + 1.0) / 8.0;
  let g = (ndv / (ndv * (1.0 - k) + k)) * (ndl / (ndl * (1.0 - k) + k));
  let f0 = mix(vec3f(0.04), m.base, m.metal);
  let f = f0 + (1.0 - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  let spec = d * g * f / max(4.0 * ndv * ndl, 1e-3);
  let diffuse = (1.0 - f) * (1.0 - m.metal) * m.base / PI;
  return (diffuse + spec) * radiance * ndl;
}

fn lighting(m: Material, world: vec3f, n: vec3f, v: vec3f) -> vec3f {
  var col = vec3f(0.0);
  // Key light with its shadow.
  if (settings.key_opts.y > 0.5) {
    col += shade(m, n, v, view.light.xyz, settings.key_color.rgb * view.light.w * PI) * shadow_at(world, n);
  }
  for (var i = 0u; i < u32(settings.counts_b.x); i++) {
    let pl = lights[i];
    let to = pl.pos.xyz - world;
    let d2 = max(dot(to, to), 0.01);
    let l = to / sqrt(d2);
    var cone = 1.0;
    if (pl.pos.w > 0.5) { cone = smoothstep(pl.dir.w, mix(pl.dir.w, 1.0, 0.25), dot(-l, pl.dir.xyz)); }
    col += shade(m, n, v, l, pl.color.rgb * pl.color.w * 10.0 / d2 * cone);
  }
  // The sky lights everything a little, and metals mirror it.
  let f0 = mix(vec3f(0.04), m.base, m.metal);
  let env_spec = sky_at(reflect(-v, n)) * mix(f0, vec3f(1.0), pow(1.0 - max(dot(n, v), 0.0), 5.0)) * (1.0 - m.rough * 0.7);
  col += m.base * (1.0 - m.metal) * sky_at(n) * 0.6 + env_spec;
  // A faint floor of light so unlit sides are not pure black.
  col += m.base * 0.015;
  return col + m.base * m.emissive;
}

fn fogged(col: vec3f, world: vec3f) -> vec3f {
  let dist = length(world - view.cam_pos.xyz);
  let k = 1.0 - exp(-dist * settings.env.z * 0.08);
  return mix(col, sky_at(normalize(world - view.cam_pos.xyz)), k);
}

@fragment
fn fs_main(in: LitOut) -> @location(0) vec4f {
  let m = materials[in.material];
  if (m.opacity < 0.999) { discard; }
  let n = normalize(in.normal);
  if (m.catcher > 0.5) {
    // The real room: nothing of its own, only the shadow it receives.
    let dark = 1.0 - shadow_at(in.world, n);
    return vec4f(0.0, 0.0, 0.0, dark * 0.85);
  }
  let v = normalize(view.cam_pos.xyz - in.world);
  return vec4f(fogged(lighting(m, in.world, n, v), in.world), 1.0);
}

// Glass: reflections and highlights added over what is behind it.
@fragment
fn fs_glass(in: LitOut) -> @location(0) vec4f {
  let m = materials[in.material];
  if (m.opacity >= 0.999 || m.catcher > 0.5) { discard; }
  var n = normalize(in.normal);
  let v = normalize(view.cam_pos.xyz - in.world);
  if (dot(n, v) < 0.0) { n = -n; }
  let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  let h = normalize(view.light.xyz + v);
  let spec = pow(max(dot(n, h), 0.0), mix(2000.0, 40.0, m.rough)) * view.light.w * 6.0 * shadow_at(in.world, n);
  let col = (sky_at(reflect(-v, n)) * fresnel + spec * settings.key_color.rgb + m.base * m.emissive) * (1.0 - m.rough * 0.5) + m.base * m.opacity * 0.08;
  return vec4f(col, clamp(fresnel + m.opacity * 0.3, 0.0, 1.0));
}

struct SpriteOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) colour: vec3f,
}

fn corner(i: u32) -> vec2f {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  return c[i % 6u];
}

@vertex
fn vs_particle(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SpriteOut {
  let p = particles[ii];
  var out: SpriteOut;
  if (p.life <= 0.0 || p.pos.y < -1.0e3) { out.clip = OFFSCREEN; return out; }
  let c = corner(vi);
  let world = p.pos + (view.cam_right.xyz * c.x + view.cam_up.xyz * c.y) * p.info.w;
  out.clip = view.view_proj * vec4f(world, 1.0);
  out.uv = c;
  let e = emitters[u32(p.info.x)];
  let age = 1.0 - p.life / max(p.max_life, 1e-3);
  let fade = smoothstep(0.0, 0.08, age) * smoothstep(1.0, 0.7, age);
  let lit = shadow_at(p.pos, view.light.xyz);
  let key = settings.key_color.rgb * view.light.w * (0.15 + 0.85 * lit) * 0.6;
  out.colour = e.color.rgb * (key + e.motion.w) * fade;
  return out;
}

@fragment
fn fs_particle(in: SpriteOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let a = (1.0 - r2) * (1.0 - r2);
  let c = in.colour * a;
  return vec4f(c, min(max(c.r, max(c.g, c.b)), 1.0) * 0.5);
}
`;

export const SCENE3D_POST_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var bloom: texture_2d<f32>;

struct VsOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f }

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: VsOut;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

fn down13(uv: vec2f) -> vec3f {
  let t = 1.0 / vec2f(textureDimensions(src));
  let s = textureSampleLevel(src, samp, uv, 0.0).rgb * 0.125;
  var c = s;
  c += (textureSampleLevel(src, samp, uv + t * vec2f(-2.0, -2.0), 0.0).rgb + textureSampleLevel(src, samp, uv + t * vec2f(2.0, -2.0), 0.0).rgb
      + textureSampleLevel(src, samp, uv + t * vec2f(-2.0, 2.0), 0.0).rgb + textureSampleLevel(src, samp, uv + t * vec2f(2.0, 2.0), 0.0).rgb) * 0.03125;
  c += (textureSampleLevel(src, samp, uv + t * vec2f(0.0, -2.0), 0.0).rgb + textureSampleLevel(src, samp, uv + t * vec2f(-2.0, 0.0), 0.0).rgb
      + textureSampleLevel(src, samp, uv + t * vec2f(2.0, 0.0), 0.0).rgb + textureSampleLevel(src, samp, uv + t * vec2f(0.0, 2.0), 0.0).rgb) * 0.0625;
  c += (textureSampleLevel(src, samp, uv + t * vec2f(-1.0, -1.0), 0.0).rgb + textureSampleLevel(src, samp, uv + t * vec2f(1.0, -1.0), 0.0).rgb
      + textureSampleLevel(src, samp, uv + t * vec2f(-1.0, 1.0), 0.0).rgb + textureSampleLevel(src, samp, uv + t * vec2f(1.0, 1.0), 0.0).rgb) * 0.125;
  return c;
}

@fragment
fn fs_down_first(in: VsOut) -> @location(0) vec4f {
  // Only what is brighter than white glows.
  let c = down13(in.uv);
  let luma = max(c.r, max(c.g, c.b));
  let w = max(luma - 1.0, 0.0) / max(luma, 1e-4);
  return vec4f(c * w, 1.0);
}

@fragment
fn fs_down(in: VsOut) -> @location(0) vec4f { return vec4f(down13(in.uv), 1.0); }

@fragment
fn fs_up(in: VsOut) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  var c = textureSampleLevel(src, samp, in.uv, 0.0).rgb * 4.0;
  c += (textureSampleLevel(src, samp, in.uv + t * vec2f(-1.0, 0.0), 0.0).rgb + textureSampleLevel(src, samp, in.uv + t * vec2f(1.0, 0.0), 0.0).rgb
      + textureSampleLevel(src, samp, in.uv + t * vec2f(0.0, -1.0), 0.0).rgb + textureSampleLevel(src, samp, in.uv + t * vec2f(0.0, 1.0), 0.0).rgb) * 2.0;
  c += textureSampleLevel(src, samp, in.uv + t * vec2f(-1.0, -1.0), 0.0).rgb + textureSampleLevel(src, samp, in.uv + t * vec2f(1.0, -1.0), 0.0).rgb
      + textureSampleLevel(src, samp, in.uv + t * vec2f(-1.0, 1.0), 0.0).rgb + textureSampleLevel(src, samp, in.uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  return vec4f(c / 16.0, 0.0);
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

// Exposure, bloom (flaring on the beat), tone map, grade and grain. The
// result is premultiplied: where the scene is empty and the sky is the void,
// the layer is transparent and cuts out over what is below it.
@fragment
fn fs_composite(in: VsOut) -> @location(0) vec4f {
  let s = textureSampleLevel(src, samp, in.uv, 0.0);
  let glow = textureSampleLevel(bloom, samp, in.uv, 0.0).rgb;
  let flare = 1.0 + settings.react.z * (frame.beat * 0.8 + frame.kick * 0.6);
  var hdr = (s.rgb + glow * settings.post_a.x * flare) * exp2(settings.post_a.y);
  var col = aces(hdr);
  // Temperature, saturation, contrast.
  col *= vec3f(1.0 + settings.post_b.x * 0.12, 1.0, 1.0 - settings.post_b.x * 0.12);
  let luma = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(vec3f(luma), col, settings.post_a.w);
  col = clamp((col - 0.5) * settings.post_a.z + 0.5, vec3f(0.0), vec3f(1.0));
  col = pow(col, vec3f(1.0 / 2.2));
  let px = vec2u(in.clip.xy);
  let n = hash1(px.x * 1973u + px.y * 9277u + u32(frame.frame) * 26699u) - 0.5;
  col = clamp(col + n * settings.post_b.y * 0.08, vec3f(0.0), vec3f(1.0));
  // Coverage: what the meshes and particles drew, and the light they give off.
  var alpha = clamp(max(s.a, max(col.r, max(col.g, col.b))), 0.0, 1.0);
  if (settings.env.x > 0.5) { alpha = 1.0; }
  return vec4f(min(col, vec3f(alpha)), alpha);
}
`;

/** The shader modules a scene graph uses, by id. */
export const SCENE3D_SHADERS: { id: string; stage: 'compute' | 'render'; entry: string; source: string }[] = [
  { id: 'scene3d/sim', stage: 'compute', entry: 'cs_sim', source: SCENE3D_SIM_WGSL },
  { id: 'scene3d/world', stage: 'render', entry: 'fs_main', source: SCENE3D_WORLD_WGSL },
  { id: 'scene3d/post', stage: 'render', entry: 'fs_composite', source: SCENE3D_POST_WGSL },
];

/** Commands that compile the scene shaders ahead of the first frame. */
export const scene3dPrecompileCommands = () =>
  SCENE3D_SHADERS.map((s) => ({ type: 'precompile_shader' as const, shader_id: s.id, stage: s.stage, entry: s.entry, source: s.source }));
