// Cloud Flock update. Block (C.data):
//   [0] dt, spring, curl strength, drag
//   [1] scatter impulse (this frame), cohesion, flow speed, time
//   [2] flock centre xyz, flow scale
@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read_write> flock: array<FlockPoint>;

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
    return;
  }
  if (dt <= 0.0) {
    // A repeat render of the same frame: leave every point as it is.
    return;
  }
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
  let flow = curl3(pos * C.data[2].w + vec3<f32>(seed * 0.05), C.data[1].w * C.data[1].z);
  // curl3 peaks around 4; scaled so "swarm" 1 is a strong but bounded flow.
  let acc = (rest - pos) * C.data[0].y + flow * (C.data[0].z * 0.25) + (center - pos) * C.data[1].y;
  vel = vel * exp(-C.data[0].w * dt) + acc * dt;
  pos += vel * dt;
  flock[i] = FlockPoint(vec4<f32>(pos, length(vel)), vec4<f32>(vel, seed));
}
