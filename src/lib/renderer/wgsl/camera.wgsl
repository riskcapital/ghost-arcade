// Ghost WGSL stdlib: camera and fullscreen helpers.

struct GhostCameraBasis {
  right: vec3<f32>,
  up: vec3<f32>,
  forward: vec3<f32>,
};

struct GhostRay {
  origin: vec3<f32>,
  dir: vec3<f32>,
};

fn ghost_safe_normalize(v: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let l = length(v);
  if (l < 1e-6) {
    return fallback;
  }
  return v / l;
}

fn ghost_camera_basis(origin: vec3<f32>, look_at: vec3<f32>, worldUp: vec3<f32>) -> GhostCameraBasis {
  let forward = ghost_safe_normalize(look_at - origin, vec3<f32>(0.0, 0.0, -1.0));
  let right = ghost_safe_normalize(cross(forward, worldUp), vec3<f32>(1.0, 0.0, 0.0));
  let up = ghost_safe_normalize(cross(right, forward), vec3<f32>(0.0, 1.0, 0.0));
  return GhostCameraBasis(right, up, forward);
}

fn ghost_fullscreen_triangle_pos(vid: u32) -> vec4<f32> {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  return vec4<f32>(positions[vid], 0.0, 1.0);
}
