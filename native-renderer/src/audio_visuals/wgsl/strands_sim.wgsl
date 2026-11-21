@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> U: StrandsU;
@group(0) @binding(2) var<storage, read> av: array<f32>;

fn shape_of(index: u32) -> EmitterShape {
  let s = U.shapes[index];
  var shape: EmitterShape;
  shape.kind = u32(s.a.x + 0.5);
  shape.sides = u32(s.a.y + 0.5);
  shape.count = u32(s.a.z + 0.5);
  shape.rotation = s.c.x;
  shape.center = s.b.xy;
  shape.size = s.b.zw;
  return shape;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let count = u32(U.res.w);
  if (i >= count) {
    return;
  }
  let dt = U.clock.y;
  if (dt <= 0.0) {
    // A repeat render of the same frame: leave every particle as it is.
    return;
  }
  var pt = particles[i];
  let frame = u32(U.clock.z);
  let age = pt.q.x + dt;
  if (age < pt.q.y) {
    // Alive: integrate. Fray grows with age so strands leave the shape tidy
    // and come apart further out.
    var pos = pt.p.xy;
    var vel = pt.p.zw;
    let t = pt.q.x / max(pt.q.y, 1e-3);
    let flow = curl2(pos * 1.5, U.clock.x * 0.3);
    vel += flow * U.motion.y * (0.25 + t * 1.5) * dt;
    vel *= exp(-U.motion.z * dt);
    pos += vel * dt;
    pt.p = vec4<f32>(pos, vel);
    pt.q.x = age;
    if (frame % TRAIL_STEP == 0u) {
      pt.trail[trail_head(frame)] = pos;
    }
    pt.col = particle_color(pt);
    particles[i] = pt;
    return;
  }
  // Dead: respawn with a chance proportional to how hard the shapes emit, so
  // a hit fires the whole idle pool at once and silence lets it drain.
  let total = U.clock.w;
  let roll = hash21(i, frame * 3u + 1u);
  if (roll >= min(total, 1.0) || u32(U.shape_count.x) == 0u) {
    pt.q = vec4<f32>(1.0, 0.0, 0.0, pt.q.w);
    pt.col = vec4<f32>(0.0);
    particles[i] = pt;
    return;
  }
  // Pick a shape by emission weight.
  var pick = hash21(i, frame * 3u + 2u) * total;
  var slot = 0u;
  let shapes = u32(U.shape_count.x);
  for (var s = 0u; s < shapes; s = s + 1u) {
    slot = s;
    pick -= U.shapes[s].c.y;
    if (pick <= 0.0) {
      break;
    }
  }
  let sh = U.shapes[slot];
  let shape = shape_of(slot);
  // Each particle belongs to one fibre for life, so consecutive births trace
  // the same path and read as a continuous strand, not dust.
  let fibres = max(U.fibre.x, 1.0);
  let fibre = floor(hash11(i * 2654435761u + 7u) * fibres);
  let fibre_id = u32(fibre);
  let jitter = (hash21(i, frame * 3u + 5u) - 0.5) * U.fibre.y;
  let is_core = hash11(i * 3266489917u + 11u) < U.shape_count.y;
  // Strands keep to their fibre; the contour itself is sampled smoothly.
  var u = (fibre + 0.5 + jitter) / fibres + sh.a.w * 0.618;
  if (is_core) {
    u = hash21(i, frame * 3u + 19u);
  }
  let at = emitter_sample(shape, u);
  let spec = av_spectrum_smooth(at.spectral);
  let wave = av_waveform(fract(u + sh.a.w));
  let strength = sh.c.z;
  let disp = U.motion.w * strength;
  // The burning contour: the shape pushed out by the spectrum read at this
  // place along it, and bent by the waveform.
  let closed = shape.kind == EMITTER_RING || shape.kind == EMITTER_POLYGON;
  var side = 1.0;
  let side_hash = hash11(fibre_id * 747796405u + u32(sh.a.w * 9973.0));
  if (closed) {
    side = select(1.0, -1.0, side_hash < U.shape_count.w);
  } else {
    side = select(-1.0, 1.0, side_hash < 0.5);
  }
  var push = select(side * spec, spec, closed);
  var speed_scale = 1.0;
  if (shape.kind == EMITTER_STRATA) {
    push *= 0.2;
    speed_scale = 0.6;
  }
  let contour = at.pos + at.normal * (push * disp + wave * U.fibre.w * disp * 0.5);
  var pos = contour;
  var vel = vec2<f32>(0.0);
  var life = 0.0;
  var heat = 0.0;
  if (is_core) {
    // Short-lived, nearly still: draws the hot line itself.
    // Sliding along the contour, so the streaks join into a line.
    let along = select(-1.0, 1.0, hash21(i, frame + 17u) < 0.5) * mix(0.05, 0.14, hash21(i, frame + 13u));
    vel = at.normal * side * 0.02 * spec + at.tangent * along;
    life = U.shape_count.z * mix(0.5, 1.3, hash21(i, frame * 3u + 7u));
    heat = (0.85 + spec * 1.1) * strength;
  } else {
    let fibre_speed = 0.45 + hash11(fibre_id * 2246822519u + 3u) * 1.1;
    let speed = U.motion.x * sh.d.z * speed_scale * fibre_speed * (0.12 + spec * 1.5) * (0.5 + strength * 0.5);
    vel = at.normal * side * speed + at.tangent * (hash11(fibre_id * 1597334677u + 5u) - 0.5) * speed * sh.d.w;
    life = U.look.w * sh.d.y * mix(0.4, 1.2, hash21(i, frame * 3u + 7u)) * (0.5 + spec);
    heat = (0.3 + spec * 0.7) * strength;
  }
  pt.p = vec4<f32>(pos, vel);
  pt.q = vec4<f32>(0.0, life, heat, f32(slot));
  pt.r = vec4<f32>(at.spectral, side, select(0.0, 1.0, is_core), 0.0);
  // A new life starts with its whole trail at the birth point.
  for (var k = 0u; k < TRAIL_POINTS; k = k + 1u) {
    pt.trail[k] = pos;
  }
  pt.col = particle_color(pt);
  particles[i] = pt;
}
