@group(0) @binding(0) var<storage, read_write> heads: array<Head>;
@group(0) @binding(1) var<storage, read_write> trail: array<TrailPoint>;
@group(0) @binding(2) var<uniform> U: RibbonU;

@compute @workgroup_size(64)
fn cs_ribbons(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(U.res.w)) {
    return;
  }
  let n = u32(U.clock.w);
  let head = u32(U.clock.z);
  let dt = U.clock.y;
  let band = rib_band(i);
  var h = heads[i];
  let step = U.kink.w;
  let span = U.motion.w;
  var respawn = h.v.w == 0.0;
  if (!respawn && h.p.x > span) {
    respawn = true;
  }
  if (respawn) {
    // Enter at the upstream edge (on the first frame: anywhere along the
    // river, so the field starts full), the whole ring collapsed onto it.
    let first = h.v.w == 0.0;
    let salt = select(pcg(u32(step) + i * 7u), 0u, first);
    let x = select(-span, mix(-span, span, hash11(i * 3u + 1u)), first);
    let p = vec3<f32>(x, (hash11(i * 5u + 2u ^ salt) - 0.5) * 1.3, (hash11(i * 7u + 3u ^ salt) - 0.5) * 2.0);
    let side = safe_normalize(vec3<f32>(0.0, 1.0, (hash11(i * 11u + salt) - 0.5)), vec3<f32>(0.0, 1.0, 0.0));
    h.p = vec4<f32>(p, step);
    h.v = vec4<f32>(U.motion.x * 0.5, 0.0, 0.0, 1.0);
    h.w = vec4<f32>(side, f32(band));
    h.k = vec4<f32>(0.0);
    for (var k = 0u; k < n; k = k + 1u) {
      trail[i * n + k] = TrailPoint(vec4<f32>(p, 0.0), vec4<f32>(side, 0.0));
    }
  }
  let lvl = U.level[band];
  let env = U.env[band];
  var p = h.p.xyz;
  var v = h.v.xyz;
  // One shared, slow field: neighbours move alike, so ribbons travel in
  // bundles and sheets rather than as a tangle.
  let flow = curl3(p * U.motion.y + vec3<f32>(1.3, 0.7, -2.1), U.clock.x * U.motion.z);
  let speed = U.motion.x * (0.4 + 0.9 * lvl + 0.6 * env) * (0.75 + 0.5 * U.seq.w) * (0.92 + 0.16 * hash11(i * 13u + 5u));
  // A river: downstream along +x, the curl flow lifts and folds it, soft
  // banks keep it in a slab.
  let banks = vec3<f32>(0.0, -smoothstep(0.55, 1.0, abs(p.y)) * sign(p.y), -smoothstep(0.9, 1.4, abs(p.z)) * sign(p.z)) * 2.0;
  let fl = length(flow);
  let swell = flow / max(fl, 1e-4) * min(fl, 1.5) * 0.45;
  let desired = safe_normalize(vec3<f32>(1.0, 0.0, 0.0) + swell + banks, vec3<f32>(1.0, 0.0, 0.0)) * speed;
  v = mix(v, desired, 1.0 - exp(-dt * 2.5));
  // A hit kinks every ribbon of its band the same way (with a little
  // spread), so the bend reads as one ripple that travels down the field.
  // The kick is spent over about a sixth of a second so the bend stays round.
  var kick = h.k.xyz;
  let impulse = U.kink[band];
  if (impulse > 0.0) {
    let t0 = safe_normalize(v, vec3<f32>(1.0, 0.0, 0.0));
    let shared_dir = rand_unit(pcg(u32(U.seq[band]) * 7u + band));
    let k = safe_normalize(shared_dir + rand_unit(i * 92821u ^ pcg(u32(U.seq[band]) + 17u)) * 0.35, shared_dir);
    let kp = safe_normalize(k - t0 * dot(k, t0), vec3<f32>(0.0, 1.0, 0.0));
    kick += kp * impulse * U.shape.z * speed;
  }
  let spend = 1.0 - exp(-dt * 6.0);
  v += kick * spend * 1.4;
  kick *= 1.0 - spend;
  p += v * dt;
  // Carry the side vector along (parallel transport), then spin it.
  let tangent = safe_normalize(v, flow);
  var s = h.w.xyz;
  s = safe_normalize(s - tangent * dot(s, tangent), safe_normalize(cross(tangent, vec3<f32>(0.0, 1.0, 0.0)), vec3<f32>(1.0, 0.0, 0.0)));
  let spin = (0.4 + U.spin[band] * U.shape.w) * dt;
  s = s * cos(spin) + cross(tangent, s) * sin(spin);
  h.p = vec4<f32>(p, h.p.w);
  h.v = vec4<f32>(v, 1.0);
  h.w = vec4<f32>(s, f32(band));
  h.k = vec4<f32>(kick, 0.0);
  heads[i] = h;
  let width = U.shape.y * (0.35 + 1.5 * lvl + 0.7 * env) * (1.0 + U.spin.w * (hash11(i * 17u + 9u) - 0.5));
  trail[i * n + head] = TrailPoint(vec4<f32>(p, width), vec4<f32>(s, min(impulse + env * env * env * env * 0.5, 2.0)));
}
