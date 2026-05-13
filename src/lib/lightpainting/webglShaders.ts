/**
 * webglShaders — GLSL source strings for the WebGL2 light-painting
 * renderer.
 *
 * Architecture
 * ────────────
 * Each light-painting stamp becomes one quad rendered via instanced
 * drawing — one draw call per stroke can stamp thousands of brush
 * points. Vertex shader positions each instance's quad in world
 * space (rotated, scaled, tapered). Fragment shader generates the
 * brush appearance procedurally from the local quad UV — every
 * brush type lives in a single mega-shader with a dispatch on
 * u_brushType.
 *
 * Brush types and their u_brushType uniform value:
 *   0  = glow          radial gradient, two-stop core + halo
 *   1  = neon          hard bright center + wide soft halo
 *   2  = laser         thin bright streak + wide colored shadow
 *   3  = calligraphy   ellipse, baked-in nib rotation
 *   4  = marker        rounded rectangle, semi-opaque
 *   5  = flame         warm gradient with time-driven flicker
 *   6  = electric      procedural sparks + pulsing core
 *   7  = ribbon        linear gradient strip, time-driven rotation
 *   8  = particle      procedural cluster of orbiting glow dots
 *   9  = smoke         soft wide gradient with stamp-id offset
 *  10 = spray          Gaussian dot cluster — procedural in fragment
 *  11 = paintbrush     parallel bristles — procedural in fragment
 *  12 = watercolor     3 wobbly translucent gradients stacked
 *  13 = sparkle        burst of N tiny twinkling stars
 *  14 = firefly        pulsing glow dots drifting around the stamp
 *  15 = plasma         animated electric ball with internal noise arcs
 *  16 = galaxy         spiral arms with star density
 *  17 = lightning      branching fractal bolts
 *  18 = vortex         swirling spiral with chromatic aberration
 *  19 = nebula         volumetric fbm clouds with star sparkles
 *  20 = kaleido        mirror-symmetric mandala bursts
 *  21 = ink            inky bloom with feathered edges + fibres
 *  22 = crystal        faceted gem with refraction + glints
 *  23 = aurora         flowing curtain of color bands
 *  24 = bubbles        cluster of bubbles that float upward and fade
 *
 * Phase-3 additions (Mar 2026):
 *   - v_glow wired into every WebGL2-only brush (outer halo).
 *   - v_internalGlow boosts inner core brightness on all procedural brushes.
 *   - v_noiseScale/v_noiseSpeed/v_noiseAmount drive procedural noise math.
 *   - v_complexity controls element counts (arms, bolts, dots).
 *   - v_progress is the stamp's position along the stroke (0..1) so
 *     draw-time animation can drive brush evolution.
 *   - New brushes: nebula, kaleido, ink, crystal, aurora, bubbles.
 */

/* ============================================================== */
/* SHARED GLSL HELPERS                                            */
/* ============================================================== */

const HELPERS = /* glsl */ `
// Mulberry32-flavored hash: stable per-stamp pseudo-randomness so
// procedural brushes produce the same per-stamp variation every
// frame — no flicker on paused renders. Seeded by per-instance i_seed.
float hash11(float x) {
  x = fract(x * 0.1031);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// Box-Muller from two uniform samples — used by spray brush for
// Gaussian dot distribution.
vec2 boxMuller(vec2 u) {
  float u1 = max(u.x, 0.001);
  float mag = sqrt(-2.0 * log(u1));
  float ang = 6.28318530718 * u.y;
  return vec2(mag * cos(ang), mag * sin(ang));
}
// Radial soft falloff — used as the basic brush envelope.
float radialFalloff(float d, float falloff) {
  return exp(-d * d * falloff);
}
// Simplex-ish value noise — cheap interpolated hash noise, plenty
// for brush effects.
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i + vec2(0.0, 0.0));
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// 4-octave fractal-brownian motion. Returns ~[0, 1.875] (sum of
// 1 + 0.5 + 0.25 + 0.125 weighted noise). Divide by ~1.875 if you
// need 0..1.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * valueNoise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}
// 2D rotation helper.
vec2 rot2(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
// Polar fold for kaleidoscope (n-way symmetry).
vec2 polarFold(vec2 uv, float symmetry) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float wedge = 6.28318530718 / max(symmetry, 1.0);
  a = mod(a, wedge);
  a = abs(a - wedge * 0.5);
  return vec2(cos(a), sin(a)) * r;
}
`;

/* ============================================================== */
/* STAMP VERTEX SHADER                                            */
/* ============================================================== */
export const STAMP_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

// Explicit attribute locations — WebGL2 / GLSL ES 3.00 does NOT
// guarantee compilers assign locations in declaration order, and
// the renderer's vertexAttribPointer calls reference fixed numeric
// locations. Without these qualifiers, attribute data is fed into
// the wrong shader inputs on some drivers and brush types render
// as garbage (often appearing identical to the default).
//
// HARD LIMIT: WebGL2 spec MAX_VERTEX_ATTRIBS minimum is 16 (locations
// 0..15). Chromium / ANGLE / D3D11 backends enforce this minimum
// strictly. Phase-3 added 6 new procedural params — we pack those
// into two vec3 attributes to stay inside the 16-location budget.
layout(location = 0)  in vec2 a_corner;            // (-1,-1), (1,-1), (-1,1), (1,1)

layout(location = 1)  in vec2  i_position;         // stamp center in canvas pixels
layout(location = 2)  in float i_size;             // brush diameter in pixels
layout(location = 3)  in float i_angle;            // stroke direction radians
layout(location = 4)  in vec3  i_color;            // 0..1 RGB tint
layout(location = 5)  in float i_alpha;            // per-stamp alpha
layout(location = 6)  in float i_glow;             // brush.glow (0..5)
layout(location = 7)  in float i_softness;         // brush.softness (0..1)
layout(location = 8)  in float i_seed;             // per-stamp seed
layout(location = 9)  in float i_time;             // animation phase (timeS * brush.speed)
layout(location = 10) in float i_progress;         // stamp position along stroke (0..1)
// Packed procedural params — see PROC_PACK_LAYOUT in webglRenderer.ts.
// pack1.x = particleSize, pack1.y = internalGlow, pack1.z = complexity
// pack2.x = noiseScale,   pack2.y = noiseSpeed,   pack2.z = noiseAmount
layout(location = 11) in vec3  i_pack1;
layout(location = 12) in vec3  i_pack2;

uniform vec2  u_resolution;   // canvas size in pixels
uniform int   u_brushType;
uniform float u_useAngle;     // 1.0 if brush uses stroke direction
uniform float u_extentScale;  // multiplier on size for quad extent

out vec2  v_uv;
out vec3  v_color;
out float v_alpha;
out float v_glow;
out float v_softness;
out float v_seed;
out float v_time;
out float v_size;
out float v_progress;
out float v_particleSize;
out float v_internalGlow;
out float v_noiseScale;
out float v_noiseSpeed;
out float v_noiseAmount;
out float v_complexity;

void main() {
  float extent = i_size * 0.5 * u_extentScale;

  float c = cos(i_angle * u_useAngle);
  float s = sin(i_angle * u_useAngle);
  mat2 rot = mat2(c, s, -s, c);

  vec2 cornerWorld = i_position + rot * (a_corner * extent);

  vec2 ndc = (cornerWorld / u_resolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;

  gl_Position = vec4(ndc, 0.0, 1.0);
  v_uv            = a_corner;
  v_color         = i_color;
  v_alpha         = i_alpha;
  v_glow          = i_glow;
  v_softness      = i_softness;
  v_seed          = i_seed;
  v_time          = i_time;
  v_size          = i_size;
  v_progress      = i_progress;
  // Unpack procedural params from the two vec3 attributes.
  v_particleSize  = i_pack1.x;
  v_internalGlow  = i_pack1.y;
  v_complexity    = i_pack1.z;
  v_noiseScale    = i_pack2.x;
  v_noiseSpeed    = i_pack2.y;
  v_noiseAmount   = i_pack2.z;
}
`;

/* ============================================================== */
/* STAMP FRAGMENT SHADER                                          */
/* ============================================================== */
export const STAMP_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2  v_uv;
in vec3  v_color;
in float v_alpha;
in float v_glow;
in float v_softness;
in float v_seed;
in float v_time;
in float v_size;
in float v_progress;
in float v_particleSize;
in float v_internalGlow;
in float v_noiseScale;
in float v_noiseSpeed;
in float v_noiseAmount;
in float v_complexity;

uniform int u_brushType;

out vec4 outColor;

${HELPERS}

// ─────────────────────────────────────────────────────────────────
// PHASE 1 — Canvas2D-parity brushes
// ─────────────────────────────────────────────────────────────────

vec4 brushGlow(vec2 uv) {
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  // Halo gradient — fills the entire quad (which the renderer sizes
  // as 1 + 2*glow so high-glow strokes get a wider footprint, matching
  // Canvas2D's glowRadius = radius * (1 + glow * 2) formula).
  // Softness pushed further than before — at softness=1 the falloff
  // is 0.5 instead of 1.2 (much wider, more diffuse halo).
  float haloFalloff = mix(2.5, 0.5, v_softness);
  float halo = radialFalloff(d, haloFalloff);
  // Core gradient — should stay at a FIXED pixel size regardless of
  // glow, so as glow grows the core looks proportionally smaller
  // inside the larger halo. v_uv is normalized to the quad extent =
  // (1 + 2*glow) * radius, so a fixed-pixel core occupies a
  // shrinking v_uv range as glow rises. coreEnd = 0.5 / (1 + 2*glow).
  float coreEnd = 0.5 / (1.0 + 2.0 * v_glow);
  float core = radialFalloff(d / max(coreEnd, 0.05), 6.0);
  // Color: tint = brush color, core lifts toward white.
  vec3 col = mix(v_color, vec3(1.0), core * 0.7);
  float alpha = (halo * 0.85 + core * 0.5) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushNeon(vec2 uv) {
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  float halo = radialFalloff(d, 1.2 / max(v_glow, 0.1));
  float core = radialFalloff(d * 4.0, 12.0);
  vec3 col = mix(v_color * 0.95, vec3(1.0), core * 0.95);
  float alpha = (halo * 0.7 + core * 0.95) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushLaser(vec2 uv) {
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  float coreR = 0.18;
  float core = radialFalloff(d / coreR, 6.0);
  float halo = radialFalloff(d, max(0.2, 1.5 / v_glow));
  vec3 col = mix(v_color, vec3(1.0), core);
  float alpha = (halo * 0.5 + core) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushCalligraphy(vec2 uv) {
  vec2 scaled = vec2(uv.x, uv.y * 8.0);
  float d = length(scaled);
  if (d > 1.0) return vec4(0.0);
  float edge = 1.0 - smoothstep(0.85, 1.0, d);
  return vec4(v_color, edge * v_alpha);
}

vec4 brushMarker(vec2 uv) {
  vec2 halfSize = vec2(1.0, 0.25);
  vec2 d2 = abs(uv) - halfSize;
  vec2 d2Pos = max(d2, vec2(0.0));
  float outside = length(d2Pos);
  float softEdge = 0.05;
  float alpha = (1.0 - smoothstep(0.0, softEdge, outside)) * 0.7 * v_alpha;
  return vec4(v_color, alpha);
}

vec4 brushFlame(vec2 uv) {
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  float t = v_time * 4.0;
  float flicker = 0.7
    + 0.3 * (sin(t * 2.7) * 0.5 + 0.5)
    + 0.15 * (sin(t * 5.3) * 0.5 + 0.5)
    + 0.15 * hash11(v_seed);
  float yOff = 0.1 * sin(t * 1.8);
  vec2 uvShifted = vec2(uv.x, uv.y + yOff);
  float dS = length(uvShifted);
  vec3 col;
  float alpha;
  if (dS < 0.2) {
    col = vec3(1.0, 1.0, 0.78);
    alpha = flicker;
  } else if (dS < 0.6) {
    float k = (dS - 0.2) / 0.4;
    col = mix(vec3(1.0, 1.0, 0.78), v_color, k);
    alpha = mix(flicker, flicker * 0.8, k);
  } else if (dS < 1.0) {
    float k = (dS - 0.6) / 0.4;
    vec3 dark = vec3(v_color.r * 0.5, 0.0, 0.0);
    col = mix(v_color, dark, k);
    alpha = mix(flicker * 0.4, 0.0, k);
  } else {
    return vec4(0.0);
  }
  return vec4(col, alpha * v_alpha);
}

vec4 brushElectric(vec2 uv) {
  float t = v_time * 6.0;
  float radius = length(uv);
  if (radius > 1.0) return vec4(0.0);
  float angle = atan(uv.y, uv.x);
  float corePulse = 0.35 + 0.05 * sin(t * 5.0);
  float core = radialFalloff(radius / corePulse, 6.0);
  float sparkAlpha = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float baseAng = (fi / 6.0) * 6.28318530718;
    float wobble = sin(t * 2.1 + fi * 1.7) * 0.8;
    float sparkAng = baseAng + wobble;
    float da = angle - sparkAng;
    da = mod(da + 3.14159265, 6.28318530718) - 3.14159265;
    float angCloseness = exp(-da * da * 80.0);
    float lenMod = 0.5 + 0.5 * sin(t * 3.7 + fi * 2.3);
    float sparkLen = 0.5 + lenMod * v_glow * 0.5;
    float withinSpark = smoothstep(sparkLen + 0.1, sparkLen - 0.05, radius);
    sparkAlpha = max(sparkAlpha, angCloseness * withinSpark * 0.7);
  }
  vec3 col = mix(v_color, vec3(1.0), core);
  float alpha = (core + sparkAlpha) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushRibbon(vec2 uv) {
  // Linear gradient strip. Time-driven rotation handled in the
  // vertex shader's i_angle (we feed time-based rotation in via the
  // CPU side for ribbons). Strip extends along X axis here.
  // Strip is full width × 0.15 height.
  if (abs(uv.y) > 0.075 * 6.667) return vec4(0.0);  // 0.5 in normalized space
  if (abs(uv.y) > 0.5) return vec4(0.0);
  if (abs(uv.x) > 1.0) return vec4(0.0);
  // Horizontal alpha taper: fade at the ends.
  float xFade = 1.0 - smoothstep(0.7, 1.0, abs(uv.x));
  float yFade = 1.0 - smoothstep(0.3, 0.5, abs(uv.y));
  return vec4(v_color, xFade * yFade * v_alpha);
}

vec4 brushParticle(vec2 uv) {
  float t = v_time * 3.0;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  int count = 4;
  for (int i = 0; i < 5; i++) {
    if (i >= count) break;
    float fi = float(i);
    float ang = (fi / float(count)) * 6.28318530718
              + sin(t * 2.3 + fi * 1.1) * 1.5;
    float dist = (0.3 + 0.7 * abs(sin(t * 1.9 + fi * 2.7))) * 0.5;
    vec2 pCenter = vec2(cos(ang), sin(ang)) * dist;
    float pSize = 0.05 + abs(sin(t * 3.1 + fi * 0.8)) * 0.15;
    float pSize2 = pSize * (1.0 + v_glow * 0.5);
    float d = length(uv - pCenter) / pSize2;
    if (d < 1.0) {
      float pAlpha = radialFalloff(d * 1.0, 3.0);
      float core = radialFalloff(d * 4.0, 8.0);
      col += mix(v_color, vec3(1.0), core) * pAlpha;
      alpha += pAlpha;
    }
  }
  if (alpha > 0.0) col /= alpha;
  return vec4(col, min(1.0, alpha) * v_alpha);
}

vec4 brushSmoke(vec2 uv) {
  vec2 off = (hash22(vec2(v_seed, v_seed * 1.7)) - 0.5) * 0.3;
  vec2 uvShifted = uv - off;
  float d = length(uvShifted);
  if (d > 1.0) return vec4(0.0);
  float wideFalloff = mix(0.8, 0.3, v_softness);
  float alpha = radialFalloff(d, wideFalloff) * 0.3 * v_alpha;
  return vec4(v_color, alpha);
}

vec4 brushSpray(vec2 uv) {
  // Gaussian cluster of dots — entirely procedural in the fragment.
  // We sample N "virtual dots" around the stamp center, compute how
  // close uv is to each, accumulate alpha. This replaces Canvas2D's
  // for-loop with a single fragment evaluation. With 24 dots we
  // match the visual density of the original.
  float density = 24.0;
  float spread = 0.3 + v_softness * 0.7;
  float alpha = 0.0;
  for (float i = 0.0; i < 24.0; i++) {
    vec2 u1u2 = hash22(vec2(v_seed * 73.1 + i, v_seed * 31.7 + i * 1.3));
    vec2 g = boxMuller(u1u2) * 0.5 * spread;
    if (length(g) > 1.0) continue;
    // Each "dot" is a tiny disc. Render its contribution at this uv.
    float dotSize = 0.02 + hash11(v_seed * 11.0 + i * 1.7) * 0.03;
    float d = length(uv - g);
    if (d < dotSize) {
      alpha += 0.15 * (1.0 - d / dotSize);
    }
  }
  return vec4(v_color, min(1.0, alpha) * v_alpha);
}

vec4 brushPaintbrush(vec2 uv) {
  int bristleCount = int(5.0 + min(15.0, v_size * 0.15));
  float maxAlpha = 0.0;
  for (int i = 0; i < 20; i++) {
    if (i >= bristleCount) break;
    float fi = float(i);
    float t = fi / float(bristleCount - 1) - 0.5;
    float jitter = (hash11(v_seed * 23.0 + fi) - 0.5) * 0.1;
    float bx = t + jitter;
    float by = (hash11(v_seed * 31.0 + fi) - 0.5) * 0.05;
    float bSize = 0.02 + hash11(v_seed * 41.0 + fi) * 0.04;
    float d = length(uv - vec2(bx, by)) / bSize;
    if (d < 1.0) {
      float a = (1.0 - d) * (0.3 + 0.7 * (1.0 - abs(t) * 2.0));
      maxAlpha = max(maxAlpha, a);
    }
  }
  return vec4(v_color, maxAlpha * (0.3 + v_softness * 0.7) * v_alpha);
}

vec4 brushWatercolor(vec2 uv) {
  vec3 col = v_color;
  float alpha = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float spread = 1.0 + fl * 0.4 * v_softness;
    vec2 off = (hash22(vec2(v_seed * 11.0 + fl, v_seed * 17.0 + fl * 1.3)) - 0.5) * 0.2;
    vec2 uvL = uv - off;
    float d = length(uvL);
    if (d > spread) continue;
    float ang = atan(uvL.y, uvL.x);
    float wobble = 0.85 + 0.3 * hash11(v_seed * 7.0 + fl * 13.0 + ang * 2.0);
    float effective = spread * wobble;
    if (d > effective) continue;
    // Per-layer alpha bumped 3× from the original (0.08/0.06/0.04).
    // The original values produced a stamp so faint that it was
    // effectively invisible until many stamps overlapped — users
    // report the brush appears to do nothing. The 3× bump gives
    // single stamps a clearly visible translucent wash while still
    // allowing pleasant accumulation across overlapping stamps.
    float layerAlpha = (0.24 - fl * 0.06);
    float k = d / effective;
    float aMul;
    if (k < 0.6) aMul = mix(1.0, 0.5, k / 0.6);
    else aMul = mix(0.5, 0.0, (k - 0.6) / 0.4);
    alpha += layerAlpha * aMul;
  }
  return vec4(col, min(1.0, alpha) * v_alpha);
}

// ─────────────────────────────────────────────────────────────────
// PHASE 2 — WebGL2-only procedural brushes
// These match the original Phase 2 versions exactly — they do NOT
// read the Phase-3 per-instance varyings (v_particleSize,
// v_internalGlow, v_noiseScale, v_noiseSpeed, v_noiseAmount,
// v_complexity, v_progress). Those varyings are still passed
// through but only the Phase-3 brushes (nebula..bubbles) consume
// them.
// ─────────────────────────────────────────────────────────────────

vec4 brushSparkle(vec2 uv) {
  // Burst of twinkling stars with cross-shaped beams.
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  const int STAR_COUNT = 9;
  for (int i = 0; i < STAR_COUNT; i++) {
    float fi = float(i);
    vec2 sPos = (hash22(vec2(v_seed * 13.7 + fi, v_seed * 7.3 + fi * 1.1)) - 0.5) * 1.4;
    float twinklePhase = hash11(v_seed * 23.0 + fi);
    float twinkle = 0.5 + 0.5 * (0.5 + 0.5 * sin(v_time * 6.0 + twinklePhase * 6.28));
    float sSize = 0.12 + hash11(v_seed * 31.0 + fi) * 0.18;
    vec2 d = uv - sPos;
    float rot = v_time * 0.4 + twinklePhase * 6.28;
    float c = cos(rot), s = sin(rot);
    vec2 r = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    float horizontal = exp(-(r.x * r.x) / (sSize * sSize * 0.04) - (r.y * r.y) / (sSize * sSize));
    float vertical   = exp(-(r.y * r.y) / (sSize * sSize * 0.04) - (r.x * r.x) / (sSize * sSize));
    float core       = exp(-dot(d, d) / (sSize * sSize * 0.15));
    float starAlpha = max(max(horizontal, vertical), core * 1.5) * twinkle;
    col += mix(v_color, vec3(1.0, 1.0, 0.95), core * 0.9) * starAlpha;
    alpha = max(alpha, starAlpha);
  }
  if (alpha > 0.0) col /= alpha;
  return vec4(col, alpha * v_alpha);
}

vec4 brushFirefly(vec2 uv) {
  // Pulsing glow dots drifting around the stamp.
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  const int FLY_COUNT = 4;
  for (int i = 0; i < FLY_COUNT; i++) {
    float fi = float(i);
    float driftPhase = hash11(v_seed * 41.0 + fi) * 6.28;
    vec2 driftAmp = (hash22(vec2(v_seed * 17.0 + fi, v_seed * 19.0 + fi * 1.3)) - 0.5) * 0.6;
    vec2 fPos = driftAmp + vec2(
      sin(v_time * 1.5 + driftPhase) * 0.3,
      cos(v_time * 1.2 + driftPhase * 1.3) * 0.3
    );
    float pulse = 0.4 + 0.6 * (0.5 + 0.5 * sin(v_time * 4.0 + driftPhase));
    float d = length(uv - fPos);
    float fSize = 0.08 + 0.04 * pulse;
    if (d > fSize * 3.0) continue;
    float halo = radialFalloff(d / fSize, 1.5) * pulse;
    float core = radialFalloff(d / (fSize * 0.3), 4.0) * pulse;
    col += mix(v_color, vec3(1.0, 1.0, 0.7), core * 0.8) * (halo + core);
    alpha += (halo + core) * 0.5;
  }
  if (alpha > 0.0) col /= alpha;
  return vec4(col, min(1.0, alpha) * v_alpha);
}

vec4 brushPlasma(vec2 uv) {
  // Animated electric ball with internal noise arcs.
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  float radialMask = radialFalloff(d, 2.5);
  float n1 = sin(uv.x * 7.0 + v_time * 2.0) * cos(uv.y * 7.0 + v_time * 1.7);
  float n2 = sin(uv.x * 15.0 - v_time * 2.7) * cos(uv.y * 13.0 + v_time * 3.1);
  float n3 = hash12(uv * 30.0 + vec2(v_time, v_time * 0.7)) - 0.5;
  float arcs = abs(n1 * 0.6 + n2 * 0.3 + n3 * 0.1);
  float arcMask = pow(1.0 - arcs, 4.0) * radialMask;
  float core = radialFalloff(d * 3.0, 4.0);
  vec3 col = mix(v_color, vec3(1.0, 1.0, 1.0), arcMask + core);
  float alpha = (arcMask * 0.8 + radialMask * 0.3 + core * 0.7) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushGalaxy(vec2 uv) {
  // Spiral arms with star density.
  float r = length(uv);
  if (r > 1.0) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  float spiralArg = ang - log(r + 0.1) * 3.0 + v_time * 0.5;
  float arms = max(0.0, sin(spiralArg * 3.0));
  float coreEnvelope = radialFalloff(r * 2.5, 3.0);
  float armEnvelope = radialFalloff(r * 0.9, 0.6);
  float starsRaw = hash12(uv * 50.0 + vec2(v_seed * 100.0));
  float stars = step(0.97, starsRaw) * (arms * 0.5 + 0.5);
  vec3 col = mix(v_color, vec3(1.0), coreEnvelope * 0.9 + stars);
  float alpha = (arms * armEnvelope * 0.6 + coreEnvelope * 0.7 + stars * 0.9) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushLightning(vec2 uv) {
  // Branching fractal bolts.
  float r = length(uv);
  if (r > 1.0) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  float spineWobble = sin(r * 8.0 + v_time * 6.0) * 0.5;
  float baseSpine = sin(v_time * 1.7 + v_seed * 6.28) * 1.5;
  float maxBolt = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float spineAng = baseSpine + fi * (6.28 / 4.0);
    float da = ang - spineAng - spineWobble;
    da = mod(da + 3.14159265, 6.28318530718) - 3.14159265;
    float boltShape = exp(-da * da * 80.0);
    float fade = (1.0 - r) * (0.5 + 0.5 * sin(r * 20.0 + v_time * 8.0));
    maxBolt = max(maxBolt, boltShape * fade);
  }
  float core = radialFalloff(r * 6.0, 8.0);
  vec3 col = mix(v_color, vec3(1.0), maxBolt * 0.85 + core * 0.9);
  float alpha = (maxBolt + core * 0.6) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushVortex(vec2 uv) {
  // Swirling spiral with chromatic aberration.
  float r = length(uv);
  if (r > 1.0) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  float spiralR = ang - log(r + 0.1) * 2.5 + v_time * 1.2;
  float spiralG = spiralR + 0.15;
  float spiralB = spiralR + 0.3;
  float armR = max(0.0, sin(spiralR * 4.0));
  float armG = max(0.0, sin(spiralG * 4.0));
  float armB = max(0.0, sin(spiralB * 4.0));
  float envelope = radialFalloff(r * 1.5, 1.2);
  vec3 perChannel = vec3(armR, armG, armB);
  vec3 col = mix(v_color, vec3(1.0), envelope * 0.4) * (1.0 + perChannel);
  float alpha = ((armR + armG + armB) / 3.0) * envelope * v_alpha;
  return vec4(col, alpha);
}

// ─────────────────────────────────────────────────────────────────
// PHASE 3 — New brushes
// ─────────────────────────────────────────────────────────────────

vec4 brushNebula(vec2 uv) {
  // Volumetric fbm cloud with star sparkles. Noise scale = cloud
  // frequency; noise amount = density contrast; complexity = octave
  // count multiplier (more wisps); glow = outer halo; internal glow
  // = bright hot pockets.
  float r = length(uv);
  if (r > 1.1) return vec4(0.0);
  float t = v_time * 0.3 * v_noiseSpeed;
  vec2 p = uv * 2.0 * v_noiseScale + vec2(t, t * 0.7);
  float cloud = fbm(p);
  // Extra warp pass for that "swirling nebula" feel.
  vec2 warp = vec2(fbm(p + 1.7), fbm(p + 5.3)) - 0.5;
  cloud = fbm(p + warp * v_noiseAmount * 2.0 * v_complexity);
  // Radial envelope so the cloud doesn't bleed past quad bounds.
  float envelope = radialFalloff(r, 1.4);
  float density = clamp(cloud * v_noiseAmount + 0.3, 0.0, 1.0) * envelope;
  // Bright hot pockets.
  float hot = smoothstep(0.55, 0.85, cloud) * v_internalGlow * envelope;
  // Star sparkles.
  float starRaw = hash12(uv * 70.0 + vec2(v_seed * 100.0));
  float stars = step(0.985, starRaw) * envelope;
  // Outer glow halo.
  float halo = radialFalloff(r * 1.3, 0.6) * v_glow * 0.4;
  vec3 col = mix(v_color, vec3(1.0, 1.0, 0.95), hot * 0.7 + stars);
  col += v_color * halo * 0.5;
  float alpha = (density * 0.7 + hot * 0.6 + stars * 1.0 + halo * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushKaleido(vec2 uv) {
  // Mirror-symmetric mandala. Complexity controls symmetry (3..12).
  // Noise drives the inner pattern; glow halos the outside; internal
  // glow brightens the core star.
  float r = length(uv);
  if (r > 1.05) return vec4(0.0);
  float sym = clamp(floor(v_complexity * 3.0 + 2.0), 3.0, 12.0);
  vec2 folded = polarFold(uv, sym);
  // Pattern: rotated fbm sampled in the folded coordinate space.
  vec2 p = folded * 3.0 * v_noiseScale + vec2(v_time * 0.4 * v_noiseSpeed);
  float n = fbm(p);
  // Petal shape: radial sin × angular pattern.
  float petalAng = atan(folded.y, folded.x);
  float petals = pow(max(0.0, cos(petalAng * sym * 0.5 + v_time * v_noiseSpeed)), mix(8.0, 2.0, v_softness));
  float pattern = petals * (0.4 + 0.6 * n * v_noiseAmount);
  float core = radialFalloff(r * 3.0, 4.0) * v_internalGlow;
  float halo = radialFalloff(r * 1.2, 0.6) * v_glow * 0.35;
  float envelope = radialFalloff(r, 1.6);
  vec3 col = mix(v_color, vec3(1.0), core * 0.85 + pattern * 0.3);
  col += v_color * halo * 0.4;
  float alpha = (pattern * envelope * 0.85 + core * 0.7 + halo * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushInk(vec2 uv) {
  // Inky bloom: irregular soft disc edge with radiating fibres and
  // a few darker concentration pockets. Noise drives edge roughness;
  // glow widens outer bleed; internal glow brightens the dark core
  // (counter-intuitive but useful for "wet ink" highlight).
  float r = length(uv);
  if (r > 1.1) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  // Wobbly edge.
  float edge = 0.7 + 0.25 * fbm(vec2(ang * 4.0, r * 5.0) * v_noiseScale + v_seed * 10.0);
  float bleed = 1.0 - smoothstep(edge - 0.15 - v_glow * 0.05, edge + 0.1, r);
  // Inner density: concentration pockets driven by fbm so the ink
  // looks "wet" rather than uniform.
  float pockets = fbm(uv * 4.0 * v_noiseScale + vec2(v_seed));
  float inner = smoothstep(0.0, edge, edge - r) * (0.55 + 0.45 * pockets * v_noiseAmount);
  // Radiating fibres (the "feathered" ink streaks at edges).
  float fibres = 0.0;
  int fibreCount = int(clamp(6.0 + v_complexity * 6.0, 4.0, 14.0));
  for (int i = 0; i < 14; i++) {
    if (i >= fibreCount) break;
    float fi = float(i);
    float fa = (fi / float(fibreCount)) * 6.28318530718 + hash11(v_seed * 41.0 + fi) * 0.5;
    float da = ang - fa;
    da = mod(da + 3.14159265, 6.28318530718) - 3.14159265;
    float beam = exp(-da * da * 200.0);
    float reach = 0.85 + 0.25 * hash11(v_seed * 53.0 + fi);
    float within = smoothstep(reach + 0.1, edge, r);
    fibres = max(fibres, beam * within);
  }
  float core = radialFalloff(r * 4.0, 6.0) * v_internalGlow * 0.6;
  vec3 col = mix(v_color, vec3(1.0), core);
  float alpha = (bleed * 0.5 + inner * 0.9 + fibres * 0.7 + core * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushCrystal(vec2 uv) {
  // Faceted gem appearance via discrete polar wedges + edge highlights.
  // Complexity = facet count; noise = facet color variation; internal
  // glow = bright glints at facet edges; glow = halo around crystal.
  float r = length(uv);
  if (r > 1.05) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  float facets = clamp(floor(v_complexity * 3.0 + 3.0), 4.0, 16.0);
  float wedge = 6.28318530718 / facets;
  float wedgeIdx = floor((ang + 3.14159265) / wedge);
  float wedgeAng = (wedgeIdx + 0.5) * wedge - 3.14159265;
  // Distance from current pixel to the wedge centerline (in radians).
  float da = abs(ang - wedgeAng);
  da = min(da, abs(ang - wedgeAng - 6.28318530718));
  da = min(da, abs(ang - wedgeAng + 6.28318530718));
  // Per-facet brightness variation.
  float facetVal = hash11(wedgeIdx * 1.3 + v_seed * 7.0);
  float facetShade = mix(0.55, 1.0, facetVal);
  // Edge highlights at the seams between facets.
  float edgeGlint = smoothstep(wedge * 0.5, wedge * 0.5 - 0.05, da) * v_internalGlow;
  // Animated highlight that "rotates" around the crystal.
  float rotHighlight = 0.5 + 0.5 * sin(ang * facets + v_time * 2.0 * v_noiseSpeed);
  rotHighlight = pow(rotHighlight, 8.0) * 0.6;
  // Slight outward fade.
  float envelope = 1.0 - smoothstep(0.85, 1.0, r);
  // Inner core glow.
  float core = radialFalloff(r * 3.0, 4.0) * v_internalGlow * 0.5;
  // Outer halo.
  float halo = radialFalloff(r * 1.2, 0.7) * v_glow * 0.3;
  vec3 col = v_color * facetShade + vec3(1.0) * (edgeGlint + rotHighlight + core);
  col += v_color * halo * 0.4;
  float alpha = (envelope * 0.85 + edgeGlint * 0.5 + rotHighlight * 0.4 + halo * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushAurora(vec2 uv) {
  // Flowing curtain — vertical bands shifted by fbm in X with
  // brightness pulses traveling left→right. Noise drives ripple
  // frequency and amount. Internal glow brightens the curtain core;
  // glow halos the edges.
  float r = length(uv);
  if (r > 1.1) return vec4(0.0);
  float t = v_time * v_noiseSpeed;
  // Horizontal ripple — vertical band centerline wobbles in X.
  float ripple = fbm(vec2(uv.y * 3.0 * v_noiseScale, t * 0.5)) - 0.5;
  float bandX = uv.x - ripple * v_noiseAmount * 1.5;
  // Vertical curtain shape (taller than wide).
  float curtainWidth = mix(0.18, 0.5, v_softness);
  float curtain = exp(-bandX * bandX / (curtainWidth * curtainWidth));
  // Brightness bands traveling along the curtain.
  float bands = 0.5 + 0.5 * sin(uv.y * 4.0 * v_noiseScale + t * 2.0);
  // Secondary curtain for depth.
  float bandX2 = uv.x - ripple * v_noiseAmount * 1.5 - 0.35;
  float curtain2 = exp(-bandX2 * bandX2 / (curtainWidth * 0.6 * curtainWidth * 0.6)) * 0.5;
  float curtainTotal = max(curtain, curtain2);
  // Vertical fade so the curtain "hangs" — brighter at top.
  float vFade = 1.0 - smoothstep(0.3, 1.0, uv.y);
  // Outer envelope.
  float envelope = 1.0 - smoothstep(0.9, 1.05, r);
  // Color shift across vertical so it goes from main color → bright top.
  vec3 col = mix(v_color * 0.7, vec3(1.0), curtainTotal * bands * v_internalGlow);
  // Halo.
  float halo = curtainTotal * v_glow * 0.3 * envelope;
  col += v_color * halo;
  float alpha = (curtainTotal * (0.4 + 0.6 * bands) * vFade * envelope + halo * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushBubbles(vec2 uv) {
  // Cluster of bubbles that float upward through the stamp and fade
  // out near the top — like effervescence rising through liquid.
  //
  // Each bubble has its own life cycle (0..1, looping). At life=0 it
  // spawns near the bottom of the stamp with a random horizontal
  // offset; over the cycle it drifts upward (negative-Y in our UV
  // space — see the y-flip note in the vertex shader header), with
  // small sideways wobble; near the end of the cycle it fades to 0.
  //
  // Cycle period scales with noiseSpeed; horizontal wobble amount
  // scales with noiseAmount. Particle size = per-bubble radius.
  // Complexity = bubble count (3..14). Internal glow brightens rim
  // and refractive highlight; glow adds an outer halo.
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  int count = int(clamp(4.0 + v_complexity * 5.0, 3.0, 14.0));
  float bubR = 0.15 * v_particleSize;
  float t = v_time * 0.35 * max(0.1, v_noiseSpeed);
  for (int i = 0; i < 14; i++) {
    if (i >= count) break;
    float fi = float(i);
    // Per-bubble phase + cycle position. Each bubble has its own
    // start offset so they don't all spawn at the same time.
    float phaseOff = hash11(v_seed * 41.0 + fi);
    float speedJ = 0.7 + 0.6 * hash11(v_seed * 59.0 + fi);    // some bubbles rise faster
    float life = fract(t * speedJ + phaseOff);                  // 0..1, loops
    // Horizontal start position (-0.9..0.9), unique per bubble + seed.
    float startX = (hash11(v_seed * 13.7 + fi) - 0.5) * 1.8;
    // Sideways wobble grows with life so the path looks gentle.
    float wobbleFreq = 2.0 + 3.0 * hash11(v_seed * 29.0 + fi);
    float wobble = sin(life * 6.28 * wobbleFreq + phaseOff * 6.28)
                 * 0.18 * v_noiseAmount * life;
    float cx = startX + wobble;
    // Floating: y goes from +1 (bottom of stamp in v_uv space) up to
    // -1 (top). Total travel = 2.0 over life=0..1.
    float cy = 0.9 - life * 1.9;
    vec2 c = vec2(cx, cy);
    // Per-bubble radius variation.
    float br = bubR * (0.65 + 0.7 * hash11(v_seed * 31.0 + fi));
    // Fade in quickly at the start, hold, then fade out near the top.
    float fadeIn  = smoothstep(0.0, 0.12, life);
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, life);
    float lifeAlpha = fadeIn * fadeOut;
    float d = length(uv - c);
    if (d > br * (1.3 + v_glow * 0.3)) continue;
    // Shell: bright ring near d == br.
    float rim = exp(-pow((d - br * 0.85) / max(br * 0.10, 0.001), 2.0)) * v_internalGlow;
    // Faint interior so bubbles aren't completely hollow.
    float inner = (1.0 - smoothstep(0.0, br, d)) * 0.12;
    // Refractive highlight (upper-left-ish).
    vec2 hlOff = c + vec2(-br * 0.35, -br * 0.35);
    float hl = exp(-pow(length(uv - hlOff) / max(br * 0.22, 0.001), 2.0))
             * 0.8 * v_internalGlow;
    // Outer halo for glow param.
    float halo = smoothstep(br * 1.3, br * 1.0, d) * v_glow * 0.3;
    vec3 bubbleCol = v_color * (0.55 + 0.45 * rim) + vec3(1.0) * (hl + rim * 0.5);
    float bubA = (rim + inner + hl + halo * 0.5) * lifeAlpha;
    col += bubbleCol * bubA;
    alpha = max(alpha, bubA);
  }
  if (alpha > 0.0) col /= max(alpha, 0.001);
  return vec4(col, min(1.0, alpha) * v_alpha);
}

void main() {
  // Independent if statements (no else cascade) — some drivers fail
  // to honor long else-if chains; some fail to honor switch with
  // many cases. Independent if-tests compile to a series of
  // conditional moves which every driver handles reliably.
  vec4 c = vec4(0.0);
  if (u_brushType == 0)  c = brushGlow(v_uv);
  if (u_brushType == 1)  c = brushNeon(v_uv);
  if (u_brushType == 2)  c = brushLaser(v_uv);
  if (u_brushType == 3)  c = brushCalligraphy(v_uv);
  if (u_brushType == 4)  c = brushMarker(v_uv);
  if (u_brushType == 5)  c = brushFlame(v_uv);
  if (u_brushType == 6)  c = brushElectric(v_uv);
  if (u_brushType == 7)  c = brushRibbon(v_uv);
  if (u_brushType == 8)  c = brushParticle(v_uv);
  if (u_brushType == 9)  c = brushSmoke(v_uv);
  if (u_brushType == 10) c = brushSpray(v_uv);
  if (u_brushType == 11) c = brushPaintbrush(v_uv);
  if (u_brushType == 12) c = brushWatercolor(v_uv);
  if (u_brushType == 13) c = brushSparkle(v_uv);
  if (u_brushType == 14) c = brushFirefly(v_uv);
  if (u_brushType == 15) c = brushPlasma(v_uv);
  if (u_brushType == 16) c = brushGalaxy(v_uv);
  if (u_brushType == 17) c = brushLightning(v_uv);
  if (u_brushType == 18) c = brushVortex(v_uv);
  if (u_brushType == 19) c = brushNebula(v_uv);
  if (u_brushType == 20) c = brushKaleido(v_uv);
  if (u_brushType == 21) c = brushInk(v_uv);
  if (u_brushType == 22) c = brushCrystal(v_uv);
  if (u_brushType == 23) c = brushAurora(v_uv);
  if (u_brushType == 24) c = brushBubbles(v_uv);

  if (c.a < 0.001) discard;
  // Output premultiplied alpha for clean additive-over compositing.
  outColor = vec4(c.rgb * c.a, c.a);
}
`;

/* ============================================================== */
/* COMPOSITE SHADER — fullscreen blit                              */
/* ============================================================== */
export const COMPOSITE_VERT = /* glsl */ `#version 300 es
// Pin a_pos to location 0 — same reasoning as the stamp vertex
// shader. The composite pass uses enableVertexAttribArray(0).
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform vec2  u_offsetPx;       // UV-space sample offset (translate output)
uniform float u_alpha;
uniform vec3  u_tint;
uniform float u_useHueShift;
uniform float u_hueShift;
// Output zoom/scale around UV center (0.5, 0.5). 1.0 = identity,
// > 1 = output appears larger (zoom in), < 1 = output appears smaller.
// Used by the breathe effect.
uniform float u_outputScale;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // Apply output scale around UV center 0.5. Sampling UV is the
  // INVERSE of the output scale: if we want the output to appear 2×
  // larger, we sample the inner half of the source.
  float invScale = u_outputScale > 0.0 ? 1.0 / u_outputScale : 1.0;
  vec2 sampleUV = (v_uv - 0.5) * invScale + 0.5 - u_offsetPx;
  // Clamp behavior — sample 0 outside the source rectangle.
  if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  vec4 col = texture(u_tex, sampleUV);
  if (u_useHueShift > 0.5 && col.a > 0.001) {
    vec3 rgb = col.rgb / col.a;
    vec3 hsv = rgb2hsv(rgb);
    hsv.x = fract(hsv.x + u_hueShift / 6.28318530718);
    rgb = hsv2rgb(hsv);
    col.rgb = rgb * col.a;
  }
  col.rgb *= u_tint;
  col.a *= u_alpha;
  col.rgb *= u_alpha;
  outColor = col;
}
`;

export const CLEAR_FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec4 u_color;
void main() {
  outColor = u_color;
}
`;

/* ============================================================== */
/* SPARKLE SHADER — random bright pinpoints where alpha is non-zero */
/* ============================================================== */
// The sparkle slider scatters bright points along painted strokes
// each frame. Implementation: each pixel in the source gets a hash-
// noise value based on (uv, frame); pixels where noise exceeds a
// threshold (controlled by sparkle amount) AND the source alpha is
// significant produce a bright additive flash.
//
// Output is premultiplied additive color, blended on top of the
// already-composited canvas with gl.ONE / gl.ONE.
export const SPARKLE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;        // the rendered light painting
uniform float u_amount;         // sparkle slider value (0..1)
uniform float u_time;           // animation seconds (drives randomness)

// Hash function — good enough sub-pixel noise.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  // Only sparkle where the trail is actually painted.
  if (src.a < 0.05) discard;
  // Per-pixel per-frame noise, quantized to mostly-empty so only a
  // few pixels per region light up at once (= stars, not a fog).
  // Higher u_amount lowers the threshold = more sparkles.
  float noise = hash12(v_uv * 1500.0 + vec2(u_time * 60.0));
  float threshold = mix(0.998, 0.95, u_amount);  // 0.5%..5% of pixels
  if (noise < threshold) discard;
  // Bright sparkle, tinted slightly toward the source color so it
  // doesn't read as "alien white dots" but as bright sparkles of the
  // stroke's hue.
  vec3 rgb = src.rgb;
  if (src.a > 0.001) rgb = src.rgb / src.a;     // unpremultiply
  vec3 col = mix(rgb, vec3(1.0), 0.7);
  float a = u_amount * 0.9;
  outColor = vec4(col * a, a);
}
`;

/* ============================================================== */
/* BLUR SHADER — separable Gaussian, used by the bloom post-process */
/* ============================================================== */
// Single-axis Gaussian blur. Two passes (horizontal then vertical)
// produce a true 2D Gaussian blur without the O(N²) cost of a single
// 2D pass. Used by the bloom effect: downscale the rendered light
// painting to a low-res texture, blur both axes, then composite the
// blurred result back on top with `bloom × 0.4` intensity (matches
// Canvas2D's box-blur bloom approach but with much higher quality).
//
// 9-tap kernel = 4 taps each side + center. Sigma matched to the
// kernel so the contribution at the edges is ~0. Larger blurs are
// achieved by setting u_radius = N pixels apart per tap (spread the
// taps further on the same image, effectively a wider blur with the
// same number of samples).
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform vec2  u_texelSize;     // 1.0 / textureWidth, 1.0 / textureHeight
uniform vec2  u_direction;     // (1, 0) for horizontal pass, (0, 1) for vertical
uniform float u_radius;        // tap spacing in pixels (controls blur width)

void main() {
  // Gaussian weights for sigma = 4 (so taps at ±4 are still significant).
  const float w0 = 0.227027;   // center
  const float w1 = 0.1945946;  // ±1
  const float w2 = 0.1216216;  // ±2
  const float w3 = 0.054054;   // ±3
  const float w4 = 0.016216;   // ±4
  vec2 step = u_direction * u_texelSize * u_radius;
  vec4 sum = texture(u_tex, v_uv) * w0;
  sum += texture(u_tex, v_uv + step * 1.0) * w1;
  sum += texture(u_tex, v_uv - step * 1.0) * w1;
  sum += texture(u_tex, v_uv + step * 2.0) * w2;
  sum += texture(u_tex, v_uv - step * 2.0) * w2;
  sum += texture(u_tex, v_uv + step * 3.0) * w3;
  sum += texture(u_tex, v_uv - step * 3.0) * w3;
  sum += texture(u_tex, v_uv + step * 4.0) * w4;
  sum += texture(u_tex, v_uv - step * 4.0) * w4;
  outColor = sum;
}
`;

/* ============================================================== */
/* OVERLAY SHADERS — segment-distance bright line for glow/neon/laser */
/* ============================================================== */
// True port of Canvas2D's bezier line overlay. Each polyline segment
// becomes one INSTANCED quad whose fragment shader computes the
// geometric distance from each pixel to that segment. No triangle
// strips, no miter joints, no spike artifacts — every pixel just
// measures its distance to the line segment using the standard
// `t = clamp(dot(P-A, B-A) / |B-A|², 0, 1)` formula and applies a
// soft brightness falloff.
//
// Key advantages over the previous strip approach:
//
//  • Adjacent segments overlap at their shared endpoint. Each pixel
//    near that endpoint computes distance to BOTH segments and gets
//    additive contributions from both → naturally rounded joints
//    (matches Canvas2D's `lineJoin: 'round'`).
//
//  • Segment endpoints have round caps for free, because the
//    distance-clamp t = clamp(...) means pixels beyond the endpoint
//    are at distance from the endpoint itself, not the projected
//    line — that's a literal round cap (matches `lineCap: 'round'`).
//
//  • No fragility at sharp turns. The distance computation is
//    independent per segment, so direction reversals and degenerate
//    geometry can't produce spike artifacts.
//
// One instanced draw call rasterizes all segments. Used for glow,
// neon, and laser brushes on top of the stamp pass.
export const STRIP_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2  a_corner;    // unit quad corner (-1..+1, -1..+1)
layout(location = 1) in vec2  i_endA;      // segment start in canvas px
layout(location = 2) in vec2  i_endB;      // segment end in canvas px
layout(location = 3) in float i_alpha;     // per-segment alpha (taper-modulated avg)

uniform vec2  u_resolution;
uniform float u_halfWidth;                 // overlay half-width in pixels

out vec2  v_pixel;
out vec2  v_endA;
out vec2  v_endB;
out float v_alpha;

void main() {
  // Build a segment-aligned bounding rectangle that fully contains
  // the segment plus a halfWidth margin on every side (so endpoint
  // round caps and side soft-edges have room to render).
  vec2 ab = i_endB - i_endA;
  float segLen = length(ab);
  vec2 t = segLen > 0.0001 ? ab / segLen : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);

  vec2 center = (i_endA + i_endB) * 0.5;
  float halfLen = segLen * 0.5 + u_halfWidth;
  vec2 worldPos = center + t * (a_corner.x * halfLen) + n * (a_corner.y * u_halfWidth);

  vec2 ndc = (worldPos / u_resolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);

  v_pixel = worldPos;
  v_endA  = i_endA;
  v_endB  = i_endB;
  v_alpha = i_alpha;
}
`;

export const STRIP_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec2  v_pixel;
in vec2  v_endA;
in vec2  v_endB;
in float v_alpha;

uniform vec3  u_color;          // brush color (0..1)
uniform float u_intensity;      // overlay brightness multiplier (0..1)
uniform float u_halfWidth;      // half-width in pixels (matches vertex shader)
uniform float u_softness;       // brush.softness — controls edge feathering

out vec4 outColor;

void main() {
  // Standard distance-to-segment: project pixel onto segment, clamp
  // to [0, 1] for round caps at endpoints, distance from projection
  // is the segment distance.
  vec2 ab = v_endB - v_endA;
  float lenSq = dot(ab, ab);
  float t = lenSq > 0.0001
    ? clamp(dot(v_pixel - v_endA, ab) / lenSq, 0.0, 1.0)
    : 0.0;
  vec2 closest = v_endA + t * ab;
  float dist = length(v_pixel - closest);

  if (dist > u_halfWidth) discard;

  // Cross-section brightness profile. Edge feathering scales with
  // softness: at softness=0 the bright line has crisp edges
  // (smoothstep 0.7..1.0), at softness=1 the line is fully feathered
  // (smoothstep 0.0..1.0) so it dissolves smoothly into the halo.
  float d = dist / u_halfWidth;
  float edgeStart = mix(0.7, 0.0, u_softness);
  float coreShape = 1.0 - smoothstep(edgeStart, 1.0, d);
  float a = coreShape * u_intensity * v_alpha;
  if (a < 0.001) discard;

  // White-tinted bright line — mimics Canvas2D's stroke + shadow combo.
  vec3 col = mix(u_color, vec3(1.0), 0.7);
  // Premultiplied output. Renderer uses gl.ONE/gl.ONE additive blend
  // for this pass so contributions from overlapping segments build up.
  outColor = vec4(col * a, a);
}
`;
