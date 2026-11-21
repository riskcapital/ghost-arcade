// Cloud Flock: update every point and write its sprite, one pass.
// Block (C.data):
//   [0] dt, spring, curl strength, drag
//   [1] scatter impulse (this frame), cohesion, flow speed, time
//   [2] flock centre xyz, flow scale
//   [3] banding (pull toward the flow's ridges), alignment rate, cruise speed, 0
@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read_write> flock: array<FlockPoint>;
@group(0) @binding(3) var<storage, read_write> sprites: array<Sprite>;

// Uphill direction of a smooth 3D field built from three planar noises.
// Following it gathers points onto sheets: the dense bands of a murmuration
// with clear air between them (a curl flow alone keeps density even).
fn ridge3(p: vec3<f32>, t: f32) -> vec3<f32> {
  let a = gnoise2(p.xy + vec2<f32>(t * 0.2, 0.0), 41u);
  let b = gnoise2(p.yz + vec2<f32>(0.0, t * 0.17), 59u);
  let c = gnoise2(p.zx + vec2<f32>(t * 0.13, 3.0), 73u);
  return vec3<f32>(a.y + c.z, a.z + b.y, b.z + c.y);
}

fn flock_sprite(i: u32, f: FlockPoint) -> Sprite {
  let rgba = unpack_point_color(points[i].w);
  if (rgba.a <= 0.02) {
    return no_sprite();
  }
  let world = (C.model * vec4<f32>(f.p.xyz, 1.0)).xyz;
  let clip = C.view_proj * vec4<f32>(world, 1.0);
  if (clip.w <= 0.01) {
    return no_sprite();
  }
  let heat = clamp(f.p.w * C.look.w, 0.0, 1.0);
  let scan = mix(C.base.rgb, rgba.rgb * C.base.rgb * 2.0, C.base.w);
  let rest_col = scan * C.look.x;
  let hot = mix(C.mid.rgb * C.mid.w, C.high.rgb * C.high.w, smoothstep(0.5, 1.0, heat)) * C.look.y;
  let color = mix(rest_col, hot * 1.2, smoothstep(0.15, 0.9, heat)) * C.look.z * rgba.a * depth_fade(clip.w);
  // Moving points draw finer and fainter each, so the swarm reads as crisp
  // grain with dense bands, not an additive haze.
  return Sprite(clip, vec4<f32>(color, sprite_size(clip.w, mix(1.0, 0.45, heat))));
}

@compute @workgroup_size(64)
fn cs_flock(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(C.res.w)) {
    return;
  }
  let dt = C.data[0].x;
  let rest = points[i].xyz;
  var f = flock[i];
  if (f.v.w == 0.0) {
    // First frame of this cloud: start formed, at rest.
    f.p = vec4<f32>(rest, 0.0);
    f.v = vec4<f32>(0.0, 0.0, 0.0, 1.0 + hash11(i * 747796405u + 1u));
    flock[i] = f;
  } else if (dt > 0.0) {
    // dt 0 is a repeat render of the same frame: nothing moves.
    var pos = f.p.xyz;
    var vel = f.v.xyz;
    let seed = f.v.w;
    let center = C.data[2].xyz;
    let impulse = C.data[1].x;
    if (impulse > 0.0) {
      // A kick: burst out from the flock's centre, each point at its own pace.
      let jitter = vec3<f32>(hash11(i * 3u + 7u), hash11(i * 5u + 11u), hash11(i * 7u + 13u)) - 0.5;
      let out_dir = normalize(pos - center + jitter * 0.35);
      vel += out_dir * impulse * mix(0.4, 1.4, fract(seed * 7.13));
    }
    var acc = (rest - pos) * C.data[0].y + (center - pos) * C.data[1].y;
    // The swarm's flow is most of this pass's cost; a formed flock skips it.
    if (C.data[0].z > 0.0) {
      let t = C.data[1].w * C.data[1].z;
      let q = pos * C.data[2].w;
      // curl3 peaks around 4; scaled so "swarm" 1 is a strong but bounded flow.
      let flow = curl3(q, t);
      acc += flow * (C.data[0].z * 0.25);
      // Alignment: turn toward the local flow heading at cruise speed, so
      // nearby points share a direction and the swarm moves in sheets.
      let heading = flow / max(length(flow), 1e-3);
      vel += (heading * C.data[3].z - vel) * min(1.0, C.data[3].y * dt);
      if (C.data[3].x > 0.0) {
        // Drift straight onto the ridges (position, not force, so the
        // alignment above cannot smooth it away): dense bands, empty gaps.
        pos += ridge3(q * 6.0, t) * (C.data[3].x * 0.03 * dt);
      }
    }
    vel = vel * exp(-C.data[0].w * dt) + acc * dt;
    pos += vel * dt;
    f = FlockPoint(vec4<f32>(pos, length(vel)), vec4<f32>(vel, seed));
    flock[i] = f;
  }
  sprites[i] = flock_sprite(i, f);
}
