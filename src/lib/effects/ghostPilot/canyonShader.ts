// Ghost Pilot — neon canyon world shader.
//
// A heightfield raymarch: the camera flies forward (+Z) through an
// infinite noise canyon that EVOLVES over time (morphing ridges, hue
// churn) and breathes between a wide open valley and constricted "wild
// tunnel" sections. Audio builds the terrain and spawns neon gates +
// streaming particles; verbs arrive as uniforms (pulse shockwave, flip,
// bloom) so they land on-beat when the JS scheduler commits them.
//
// Fullscreen-quad fragment shader; camera basis vectors are computed in
// JS (ghostPilotVisualizer) so all the banking/pitch/yaw physics lives
// in one place and the shader just builds rays from the basis.

export const CANYON_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const CANYON_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec3  uCamPos;
  uniform vec3  uCamFwd;
  uniform vec3  uCamRight;
  uniform vec3  uCamUp;
  uniform float uTanHalfFov;

  // Audio drive (smoothed in JS).
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uEnergy;
  uniform float uLevel;

  // Look / verbs.
  uniform float uHue;        // palette rotation 0..1
  uniform float uFlip;       // 0 = floor world, 1 = ceiling world
  uniform float uBloom;      // 0..1 palette-storm boost
  uniform float uPulseZ;     // world-Z of the pulse ring (<0 = inactive)
  uniform float uPulseStr;   // 0..1 ring strength
  uniform float uBeat;       // 0..1 beat-onset flash (spawns/flares gates)
  uniform float uShock;      // 0..1 spacebar shockwave envelope
  uniform float uSpeed;      // ~0..1 normalized forward speed (particle drive)
  uniform float uStreaks;    // 1 = background line-vortex on, 0 = off

  // ── noise ──────────────────────────────────────────────────────────
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) {
      v += amp * vnoise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return v;
  }

  // Full-spectrum cosine palette (Inigo Quilez) — rainbow phase offsets
  // for an unapologetically psychedelic colour field; uHue spins it.
  vec3 palette(float t) {
    t = fract(t + uHue);
    vec3 a = vec3(0.5);
    vec3 b = vec3(0.5);
    vec3 c = vec3(1.0);
    vec3 d = vec3(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
  }

  // Hue rotation about the (1,1,1) luma axis (Rodrigues) — cheap full-RGB
  // spin used for the trippy radial shimmer + shock spectral split.
  vec3 hueRotate(vec3 col, float a) {
    const vec3 k = vec3(0.57735026);
    float cs = cos(a), sn = sin(a);
    return col * cs + cross(k, col) * sn + k * dot(k, col) * (1.0 - cs);
  }

  // ── world evolution ─────────────────────────────────────────────────
  // 0 = wide open valley, 1 = constricted wild tunnel. Drifts along the
  // canyon AND slowly in time, so you fly into and out of tunnels.
  float tunnelness(float z) {
    return smoothstep(0.25, 0.85, 0.5 + 0.5 * sin(z * 0.011 + uTime * 0.06));
  }

  // World height at (x, z) packed as p=(x,z). Walls climb with |x|. The
  // ridge field DRIFTS in time (morphing, not just scrolling). In tunnel
  // sections the walls constrict inward and tower, enclosing the flight.
  float terrainH(vec2 p) {
    float drive = 0.35 + uBass;
    float tn = tunnelness(p.y);
    float wallStart = mix(3.2, 1.9, tn);              // wide valley → tight tunnel
    float wall = smoothstep(wallStart, wallStart + 4.2, abs(p.x));
    float wallH = wall * (12.0 + drive * 15.0 + tn * 10.0);
    // Evolving ridges: domain drifts over time so the terrain morphs.
    vec2 q = p * 0.12 + vec2(uTime * 0.04, uTime * 0.02);
    float ridge = fbm(q) * (2.4 + drive * 3.5) + sin(p.y * 0.18 + uTime * 0.6) * 0.6;
    float fine = fbm(p * 0.5 + uTime * 0.1) * (0.5 + uTreble * 0.7);
    float h = wallH + ridge + fine - 3.0;
    return mix(h, -h, uFlip);
  }

  // ── aurora ──────────────────────────────────────────────────────────
  // Flowing colour curtains high in the sky; also tints the distance haze.
  vec3 aurora(vec3 rd) {
    float h = clamp(rd.y * 1.6 + 0.15, 0.0, 1.0);
    float a = atan(rd.x, rd.z);
    float c = fbm(vec2(a * 2.2 + uTime * 0.06, rd.y * 3.5 - uTime * 0.12));
    c += 0.5 * fbm(vec2(a * 5.0 - uTime * 0.1, rd.y * 6.0 + uTime * 0.08));
    c = pow(clamp(c, 0.0, 1.0), 2.2);
    vec3 col = mix(palette(0.42 + uHue), palette(0.72 + uHue), c);
    return col * c * h * (0.7 + uEnergy * 1.1);
  }

  // A fixed retrowave sun down-canyon (+Z, just above the horizon) plus an
  // aurora curtain — the scene's focal point and colour anchor.
  vec3 sunSky(vec3 rd) {
    vec3 sunDir = normalize(vec3(0.0, 0.06, 1.0));
    float sd = clamp(dot(rd, sunDir), -1.0, 1.0);
    float ang = acos(sd);

    float g = clamp((rd.y - (sunDir.y - 0.22)) / 0.44, 0.0, 1.0);
    vec3 sunCol = mix(palette(0.02 + uHue) * 1.4, vec3(1.0, 0.92, 0.55), g);

    float disc = smoothstep(0.22, 0.205, ang);
    float bands = smoothstep(0.45, 0.55, fract(rd.y * 46.0));
    disc *= 1.0 - bands * step(g, 0.52) * 0.85;

    float up = clamp(rd.y, 0.0, 1.0);
    vec3 sky = mix(palette(0.58 + uEnergy * 0.2) * 0.3, vec3(0.015, 0.01, 0.05), pow(up, 0.55));
    sky += aurora(rd);
    sky += sunCol * disc * (2.2 + uBass * 2.0);
    sky += palette(0.02 + uHue) * pow(max(sd, 0.0), 18.0) * (0.8 + uBass);
    sky += palette(0.55 + uHue) * exp(-abs(rd.y) * 9.0) * (0.5 + uBass * 1.2);

    float star = step(0.9965, hash21(floor(rd.xy * 240.0)));
    sky += vec3(star) * up * 0.6;
    return sky;
  }

  // ── audio-spawned gates ─────────────────────────────────────────────
  // Neon rings on planes spaced down the canyon, rushing at the camera.
  // Cheap analytic ray-plane intersection. Brightness rides energy and
  // FLARES on the beat; tunnel sections turn them into dense ribs.
  vec3 gates(vec3 ro, vec3 rd, float maxT) {
    if (rd.z <= 0.001) return vec3(0.0);
    const float GS = 13.0;
    vec3 acc = vec3(0.0);
    float z0 = ceil(ro.z / GS) * GS;
    for (int i = 0; i < 6; i++) {
      float zp = z0 + float(i) * GS;
      float td = (zp - ro.z) / rd.z;
      if (td < 0.0 || td > maxT) continue;
      vec3 hp = ro + rd * td;
      vec2 q = vec2(hp.x, hp.y - 2.4);
      float r = length(q);
      float ph = zp * 0.21;
      float tn = tunnelness(zp);
      float radius = 3.6 + sin(ph) * 0.7;
      float ring = smoothstep(0.30, 0.0, abs(r - radius))
                 + smoothstep(0.14, 0.0, abs(r - radius * 0.55)) * 0.6;
      float ang = atan(q.y, q.x) + uTime * 0.8 + ph;
      float spokes = smoothstep(0.7, 1.0, abs(sin(ang * 6.0))) * smoothstep(radius + 0.4, 0.0, r) * 0.5;
      float life = (0.4 + uEnergy * 1.3 + uBeat * 2.0) * (1.0 + tn * 1.6);
      vec3 c = palette(0.15 + zp * 0.017) * (ring + spokes) * life;
      c *= exp(-td * 0.022);
      acc += c * 2.8;
    }
    return acc;
  }

  // ── streaming particles ─────────────────────────────────────────────
  // Hyperspace streaks emanating from the vanishing point and accelerating
  // outward (toward the viewer). Density/length/speed ride forward speed
  // and energy, so they BLAST past on the drop.
  vec3 streaks(vec2 uv) {
    float r = length(uv);
    float a = atan(uv.y, uv.x);
    float lanes = 140.0;
    float lane = floor((a / 6.28318 + 0.5) * lanes);
    float h = hash21(vec2(lane, 7.0));
    float h2 = hash21(vec2(lane, 19.0));
    float vel = 0.5 + uSpeed * 2.6 + uEnergy * 1.5;
    float v = fract(r * 0.5 - uTime * vel - h * 9.0);
    // streak gets longer/brighter the further out (closer to you)
    float head = smoothstep(0.86, 1.0, v);
    float tail = smoothstep(0.0, 0.5, v) * 0.4;
    float streak = (head + tail) * smoothstep(0.04, 0.45, r);
    streak *= step(0.35, h2);                       // only some lanes active
    vec3 c = palette(0.2 + h + uTime * 0.1) * streak;
    return c * (0.5 + uSpeed * 1.2 + uEnergy * 1.2);
  }

  void main() {
    vec2 uv = (vUv * 2.0 - 1.0);
    uv.x *= uResolution.x / uResolution.y;
    vec2 uv0 = uv;                                  // pre-warp (for streaks)

    // ── psychedelic ray warp ──
    float psy = 0.55 + uEnergy * 1.6;
    float rr = length(uv);
    float swirl = sin(rr * 3.0 - uTime * 0.8) * 0.05 * psy;
    float cs = cos(swirl), sn = sin(swirl);
    uv = mat2(cs, -sn, sn, cs) * uv;
    vec2 dir = uv / max(rr, 1e-4);
    uv += dir * sin(rr * 13.0 - uTime * 5.0) * 0.008 * psy;
    float shockFront = (1.0 - uShock) * 2.3;
    float shockRing = exp(-pow((rr - shockFront) * 2.4, 2.0));
    uv += dir * shockRing * uShock * 0.62;

    vec3 ro = uCamPos;
    vec3 rd = normalize(uCamFwd + uCamRight * uv.x * uTanHalfFov + uCamUp * uv.y * uTanHalfFov);

    // Heightfield march — step proportional to height above terrain.
    float t = 0.2;
    bool hit = false;
    vec3 p = ro;
    for (int i = 0; i < 130; i++) {
      p = ro + rd * t;
      float dh = p.y - terrainH(vec2(p.x, p.z));
      if (dh < 0.002 * t) { hit = true; break; }
      t += max(0.06, dh * 0.45);
      if (t > 170.0) break;
    }

    vec3 sun = sunSky(rd);
    vec3 col;
    float fog = 1.0 - exp(-t * 0.010);

    if (hit) {
      vec2 e = vec2(0.06, 0.0);
      float hC = terrainH(vec2(p.x, p.z));
      float hX = terrainH(vec2(p.x + e.x, p.z));
      float hZ = terrainH(vec2(p.x, p.z + e.x));
      vec3 n = normalize(vec3(hC - hX, e.x, hC - hZ));

      float height01 = clamp((hC + 3.0) / 16.0, 0.0, 1.0);
      // Colour evolves along the canyon + with height + energy.
      vec3 base = palette(height01 * 0.5 + uEnergy * 0.25 + p.z * 0.006);

      // WIREFRAME: near-black facets, blazing multi-scale wire lattice.
      vec2 g1 = abs(fract(vec2(p.x, p.z) * 0.5) - 0.5);
      float w1 = smoothstep(0.040, 0.0, min(g1.x, g1.y));
      vec2 g2 = abs(fract(vec2(p.x, p.z) * 1.5) - 0.5);
      float w2 = smoothstep(0.022, 0.0, min(g2.x, g2.y)) * 0.65;
      vec2 g3 = abs(fract(vec2(p.x, p.z) * 6.0) - 0.5);
      float w3 = smoothstep(0.012, 0.0, min(g3.x, g3.y)) * 0.35;
      float wire = max(w1, max(w2, w3));
      vec3 wireCol = palette(0.5 + height01 * 0.3 + p.z * 0.012);

      float rim = pow(clamp(1.0 - dot(n, -rd), 0.0, 1.0), 2.0);
      float toSun = pow(max(dot(rd, normalize(vec3(0.0, 0.06, 1.0))), 0.0), 4.0);

      col  = base * 0.07;                               // dark fill → wireframe read
      col += wireCol * wire * (2.8 + uTreble * 2.2);     // glowing wire
      col += base * rim * (0.4 + uMid);                  // edge glow
      col += palette(0.05 + uHue) * toSun * 0.3;

      if (uPulseZ > 0.0) {
        float ring = smoothstep(3.0, 0.0, abs(p.z - uPulseZ));
        col += palette(0.15) * ring * uPulseStr * 3.5;
      }
    } else {
      col = sun;
      fog = 0.0;
    }

    // Aurora-tinted distance haze (depth without washing pale).
    vec3 haze = mix(aurora(rd) * 0.4 + palette(0.68 + uHue) * (0.05 + uEnergy * 0.12), sun, 0.22);
    col = mix(col, haze, fog * 0.85);

    // Neon gates rushing at you, then streaming particles on top.
    col += gates(ro, rd, hit ? t : 170.0);
    col += streaks(uv0) * uStreaks;

    // ── spacebar shockwave — a DIFFERENT blend (photo-negative + screen) ──
    // The passing ring inverts the scene beneath it, then a spectral edge
    // is screen-blended over the top and a hot core sparks.
    float sMask = clamp(shockRing * uShock * 1.5, 0.0, 1.0);
    col = mix(col, 1.0 - col, sMask);                              // difference/invert
    vec3 edge = palette(0.1 + rr * 0.8 + uTime * 0.2) * pow(shockRing, 1.4) * uShock;
    col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - edge * 1.6); // screen blend
    col += vec3(1.0) * pow(shockRing, 3.0) * uShock * 1.2;         // hot core spark

    // Beat punch.
    col *= 1.0 + uBeat * 0.5;

    // Bloom storm.
    col *= 1.0 + uBloom * 1.8;
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.0 + uBloom * 0.6 + uShock);

    // Energy/level lift with a high floor.
    col *= 0.92 + uLevel * 0.5 + uEnergy * 0.3;

    // Psychedelic hue shimmer (rainbow rings drifting; kicked by shock).
    float hueSpin = (uTime * 0.04 + rr * 0.12 * psy + uShock * 0.7 + shockRing * uShock * 1.5);
    col = hueRotate(col, hueSpin * 6.28318);

    // Filmic curve + gamma.
    col = col / (col + 0.6);
    col = pow(max(col, 0.0), vec3(0.4545));

    // Cinematic vignette.
    float vig = smoothstep(1.5, 0.35, length(vUv * 2.0 - 1.0));
    col *= mix(0.55, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;
