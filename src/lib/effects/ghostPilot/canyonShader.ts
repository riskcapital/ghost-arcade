// Ghost Pilot — neon canyon world shader.
//
// A heightfield raymarch: the camera flies forward (+Z) through an
// infinite noise canyon. The AUDIO builds the terrain (bass raises the
// walls + ridge amplitude, treble brightens, energy rotates the
// palette) — the player only steers the camera. Verbs come in as
// uniforms (pulse ring, world flip, bloom storm) so they land on-beat
// when the JS scheduler commits them.
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

  // Look.
  uniform float uHue;        // palette rotation 0..1
  uniform float uFlip;       // 0 = floor world, 1 = ceiling world
  uniform float uBloom;      // 0..1 palette-storm boost
  uniform float uPulseZ;     // world-Z of the pulse ring (<0 = inactive)
  uniform float uPulseStr;   // 0..1 ring strength

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

  // ── terrain ────────────────────────────────────────────────────────
  // World height at (x, z). Valley near x=0; walls climb with |x|. Bass
  // raises wall height + ridge amplitude. uFlip mirrors to a ceiling.
  float terrainH(vec2 p) {
    // Walls start close (|x|>1.8) and tower, so they frame the view on
    // both sides as you fly the valley center. Bass drives their height.
    float wall = smoothstep(1.8, 6.5, abs(p.x));
    float wallH = wall * (10.0 + uBass * 13.0);
    float ridge = fbm(p * 0.12) * (1.6 + uBass * 4.0);
    float fine = fbm(p * 0.55) * 0.5;
    // Valley floor sits ~2 units below the camera's cruise altitude.
    float h = wallH + ridge + fine - 3.0;
    return mix(h, -h, uFlip);
  }

  // Cosine palette (Inigo Quilez). Neon cyan→magenta canyon.
  vec3 palette(float t) {
    t = fract(t + uHue);
    vec3 a = vec3(0.55, 0.42, 0.62);
    vec3 b = vec3(0.45, 0.40, 0.45);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0, 0.18, 0.42);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    vec2 uv = (vUv * 2.0 - 1.0);
    uv.x *= uResolution.x / uResolution.y;

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
      if (t > 160.0) break;
    }

    vec3 col;
    float fog = 1.0 - exp(-t * 0.018);

    if (hit) {
      // Surface gradient → cheap normal for shading.
      vec2 e = vec2(0.06, 0.0);
      float hC = terrainH(vec2(p.x, p.z));
      float hX = terrainH(vec2(p.x + e.x, p.z));
      float hZ = terrainH(vec2(p.x, p.z + e.x));
      vec3 n = normalize(vec3(hC - hX, e.x, hC - hZ));

      float height01 = clamp((hC + 3.0) / 16.0, 0.0, 1.0);
      vec3 base = palette(height01 * 0.5 + uEnergy * 0.25 + t * 0.004);

      // Neon grid lines etched into the surface (world-space).
      vec2 g = abs(fract(vec2(p.x, p.z) * 0.5) - 0.5);
      float grid = smoothstep(0.06, 0.0, min(g.x, g.y));
      vec3 gridCol = palette(0.5 + uHue + height01 * 0.3) * 2.2;

      // Soft top-down key + rim from the direction of travel.
      float key = clamp(dot(n, normalize(vec3(0.2, 1.0, -0.3))), 0.0, 1.0);
      float rim = pow(clamp(1.0 - dot(n, -rd), 0.0, 1.0), 2.0);

      col = base * (0.25 + key * 0.85) + gridCol * grid * (0.6 + uTreble * 1.6);
      col += base * rim * (0.5 + uMid);

      // Pulse ring — a bright band racing down the canyon at uPulseZ.
      if (uPulseZ > 0.0) {
        float ring = smoothstep(3.0, 0.0, abs(p.z - uPulseZ));
        col += palette(0.15 + uHue) * ring * uPulseStr * 3.0;
      }
    } else {
      // Sky: deep gradient + horizon glow + a few drifting stars.
      float up = clamp(rd.y, 0.0, 1.0);
      vec3 sky = mix(palette(0.62 + uEnergy * 0.2) * 0.18, vec3(0.01, 0.01, 0.04), up);
      float horizon = exp(-abs(rd.y) * 7.0) * (0.6 + uBass * 1.2);
      sky += palette(0.1 + uHue) * horizon;
      float star = step(0.997, hash21(floor(rd.xy * 220.0)));
      sky += vec3(star) * up * 0.5;
      col = sky;
      fog = 0.0;
    }

    // Distance fog to a palette-tinted haze.
    vec3 haze = palette(0.7 + uHue) * (0.10 + uEnergy * 0.15);
    col = mix(col, haze, fog);

    // Bloom storm: lift + saturate.
    col *= 1.0 + uBloom * 1.8;
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.0 + uBloom * 0.6);

    // Overall energy/level lift so quiet passages dim, drops blaze.
    col *= 0.75 + uLevel * 0.5 + uEnergy * 0.3;

    // Gentle filmic-ish curve + gamma.
    col = col / (col + 0.7);
    col = pow(max(col, 0.0), vec3(0.4545));

    gl_FragColor = vec4(col, 1.0);
  }
`;
