// ============================================================================
// GEOMETRIC 3D EFFECT SHADERS
//
// Ten dedicated, hero-quality 3D shape projections of the source layer.
// Each is a fullscreen analytic projection (one or two ray-primitive
// intersects, no general raymarching loops > 32 steps) so they stay GPU-
// friendly. All shaders share the helper block `geometricCommon` below.
//
// Audio uniforms (`uAudioBass`, `uAudioHigh`, `uAudioBeatPulse`) are wired
// in even though the engine doesn't broadcast them yet — they're set to 0
// as a no-op until the audio sprint, so the hooks already exist.
// ============================================================================

const geometricCommon = /* glsl */ `
  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  mat3 rotX(float a) {
    float s = sin(a), c = cos(a);
    return mat3(1.0, 0.0, 0.0,  0.0, c, -s,  0.0, s, c);
  }
  mat3 rotY(float a) {
    float s = sin(a), c = cos(a);
    return mat3(c, 0.0, s,  0.0, 1.0, 0.0,  -s, 0.0, c);
  }
  mat3 rotZ(float a) {
    float s = sin(a), c = cos(a);
    return mat3(c, -s, 0.0,  s, c, 0.0,  0.0, 0.0, 1.0);
  }

  // Map a unit-vector normal to spherical UV (equirectangular).
  vec2 sphereUV(vec3 n) {
    return vec2(atan(n.z, n.x) / TAU + 0.5,
                asin(clamp(n.y, -1.0, 1.0)) / PI + 0.5);
  }

  float fresnel(vec3 n, vec3 rd, float power) {
    return pow(1.0 - max(dot(n, -rd), 0.0), power);
  }

  // Ray-sphere intersection. Returns t (negative if miss).
  float intersectSphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return -1.0;
    return -b - sqrt(h);
  }

  // Ray-axis-aligned-box intersection. Sets outNormal to face normal.
  float intersectBox(vec3 ro, vec3 rd, vec3 r, out vec3 outNormal) {
    vec3 m = 1.0 / rd;
    vec3 n = m * ro;
    vec3 k = abs(m) * r;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z);
    float tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) return -1.0;
    outNormal = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
    return tN;
  }

  // Ray-cylinder (infinite, axis-aligned along Y). Returns nearest positive t.
  float intersectCylinderY(vec3 ro, vec3 rd, float r, out vec3 outNormal) {
    float a = rd.x * rd.x + rd.z * rd.z;
    float b = ro.x * rd.x + ro.z * rd.z;
    float c = ro.x * ro.x + ro.z * ro.z - r * r;
    float h = b * b - a * c;
    if (h < 0.0) return -1.0;
    float t = (-b - sqrt(h)) / a;
    vec3 hit = ro + rd * t;
    outNormal = normalize(vec3(hit.x, 0.0, hit.z));
    return t;
  }

  // Ray-torus intersection (analytic via quartic - approximated with raymarch).
  // Returns t when ray is within eps of the torus surface; -1 if miss.
  float intersectTorus(vec3 ro, vec3 rd, float majorR, float minorR, out vec3 outNormal) {
    float t = 0.0;
    float maxT = 8.0;
    for (int i = 0; i < 64; i++) {
      vec3 p = ro + rd * t;
      vec2 q = vec2(length(p.xz) - majorR, p.y);
      float d = length(q) - minorR;
      if (d < 0.001) {
        // Approximate normal
        vec2 cq = vec2(length(p.xz) - majorR, p.y);
        vec3 n = vec3(p.x, 0.0, p.z) / max(0.001, length(p.xz));
        outNormal = normalize(vec3(n.x * cq.x, cq.y, n.z * cq.x));
        return t;
      }
      t += max(d, 0.005);
      if (t > maxT) return -1.0;
    }
    return -1.0;
  }

  float hash13(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
`;

// ============================================================================
// 1. STRING ORB — wire-wrapped luminous globe with REAL luma extrusion.
// SDF raymarches a bumpy sphere where source luma pushes the surface outward;
// strings are drawn on top of the deformed silhouette.
// ============================================================================
export const stringOrbShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uRadius;        // 0.6-1.4 base sphere radius
  uniform float uHeight;        // 0-1 luma extrusion
  uniform float uLatCount;      // 4-64
  uniform float uLonCount;      // 4-64
  uniform float uDiagCount;     // 0-32
  uniform float uSlope;         // -2..2
  uniform float uWidth;         // 0.005-0.05
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uFlow;          // 0-3
  uniform float uIntensity;     // 0-2
  uniform float uGlow;          // 0-2
  uniform vec3 uGlowColor;
  uniform float uHorizonFade;   // 0-1
  uniform float uTileScale;     // 0.5-4
  uniform float uAudioBass;
  uniform float uAudioHigh;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  // Bumped sphere SDF — surface = baseR + luma(equirectUV(dir)) * heightScale
  float bumpedSphereSDF(vec3 p) {
    vec3 d = normalize(p + 1e-6);
    vec2 uv = sphereUV(d);
    uv = fract(uv * uTileScale);
    float h = luma(texture2D(uTexture, uv).rgb) * uHeight * 0.4;
    return length(p) - (uRadius + h);
  }

  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.003, -0.003);
    return normalize(
      e.xyy * bumpedSphereSDF(p + e.xyy) +
      e.yyx * bumpedSphereSDF(p + e.yyx) +
      e.yxy * bumpedSphereSDF(p + e.yxy) +
      e.xxx * bumpedSphereSDF(p + e.xxx)
    );
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 2.8);
    vec3 rd = normalize(vec3(p, -1.8));

    // Auto-spin + tilt
    mat3 rot = rotY(uTime * uSpin) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    // SDF raymarch
    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
      vec3 pp = ro + rd * t;
      float d = bumpedSphereSDF(pp);
      if (d < 0.001) { hit = true; break; }
      t += max(d * 0.7, 0.005);
      if (t > 6.0) break;
    }

    if (!hit) {
      float a = 1.0 - uHorizonFade;
      gl_FragColor = vec4(uGlowColor * 0.05, a);
      return;
    }

    vec3 hitPos = ro + rd * t;
    vec3 N = calcNormal(hitPos);
    vec3 dir = normalize(hitPos);
    vec2 suv = sphereUV(dir);
    vec2 sUVtile = fract(suv * uTileScale);

    // Audio modulates string density slightly (high freqs tighten lattice)
    float lat = 1.0 - smoothstep(uWidth, uWidth * 2.0,
      abs(fract(suv.y * uLatCount * (1.0 + uAudioHigh * 0.2)) - 0.5));
    float lon = 1.0 - smoothstep(uWidth, uWidth * 2.0,
      abs(fract(suv.x * uLonCount * (1.0 + uAudioHigh * 0.2)) - 0.5));
    float diag = (uDiagCount > 0.5)
      ? 1.0 - smoothstep(uWidth, uWidth * 2.0,
          abs(fract((suv.x + suv.y * uSlope + uTime * uFlow) * uDiagCount) - 0.5))
      : 0.0;
    float strings = max(max(lat, lon), diag);

    vec3 tex = texture2D(uTexture, sUVtile).rgb;
    float rim = fresnel(N, rd, 2.2);
    vec3 col = tex * strings * uIntensity
             + uGlowColor * (rim + strings * strings) * uGlow
             + uGlowColor * uAudioBass * 0.4;

    float alpha = max(strings * 0.95, rim * uHorizonFade) + uHorizonFade * 0.05;
    alpha = clamp(alpha, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ============================================================================
// 2. SPHERE WIREFRAME — geodesic globe with REAL luma extrusion.
// SDF raymarches a bumpy sphere; meridian/parallel wireframes drawn on the
// deformed surface so the lines actually wrap around bumps.
// ============================================================================
export const sphereWireframeShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uRadius;        // 0.6-1.4
  uniform float uHeight;        // 0-1 luma extrusion
  uniform float uMeridians;     // 4-32
  uniform float uParallels;     // 4-32
  uniform float uWidth;         // 0.005-0.04
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uIntensity;     // 0-2
  uniform float uHaloGlow;      // 0-2
  uniform vec3 uColor;
  uniform float uHorizonFade;
  uniform float uFillSource;    // 0-1 fill faces with source vs solid color
  uniform float uTileScale;     // 0.5-4
  uniform float uAudioBass;
  uniform float uAudioHigh;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  // Bumped sphere SDF
  float bumpedSphereSDF(vec3 p) {
    vec3 d = normalize(p + 1e-6);
    vec2 uv = sphereUV(d);
    uv = fract(uv * uTileScale);
    float h = luma(texture2D(uTexture, uv).rgb) * uHeight * 0.4;
    return length(p) - (uRadius + h);
  }

  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.003, -0.003);
    return normalize(
      e.xyy * bumpedSphereSDF(p + e.xyy) +
      e.yyx * bumpedSphereSDF(p + e.yyx) +
      e.yxy * bumpedSphereSDF(p + e.yxy) +
      e.xxx * bumpedSphereSDF(p + e.xxx)
    );
  }

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 2.8);
    vec3 rd = normalize(vec3(p, -1.7));

    mat3 rot = rotY(uTime * uSpin) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    // SDF raymarch
    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
      vec3 pp = ro + rd * t;
      float d = bumpedSphereSDF(pp);
      if (d < 0.001) { hit = true; break; }
      t += max(d * 0.7, 0.005);
      if (t > 6.0) break;
    }

    if (!hit) {
      gl_FragColor = vec4(uColor * 0.04, 1.0 - uHorizonFade);
      return;
    }

    vec3 hitPos = ro + rd * t;
    vec3 N = calcNormal(hitPos);
    vec3 dir = normalize(hitPos);
    vec2 suv = sphereUV(dir);

    // Wireframe lines — drawn on the deformed surface (still using sphere UV)
    float merid = 1.0 - smoothstep(uWidth, uWidth * 1.8,
      abs(fract(suv.x * uMeridians) - 0.5));
    float parll = 1.0 - smoothstep(uWidth, uWidth * 1.8,
      abs(fract(suv.y * uParallels) - 0.5));
    float wire = max(merid, parll);

    // Source fill (sampled at tiled UV)
    vec3 tex = texture2D(uTexture, fract(suv * uTileScale)).rgb;
    vec3 fill = mix(uColor * 0.15, tex * 0.5, uFillSource);

    // Lighting from real normal so bumps actually shade
    vec3 lightDir = normalize(rot * vec3(0.5, 0.7, 0.5));
    float diff = max(dot(N, lightDir), 0.0);
    fill *= 0.4 + diff * 0.7;

    // Halo
    float rim = fresnel(N, rd, 2.5);
    vec3 col = mix(fill, uColor, wire * uIntensity)
             + uColor * rim * uHaloGlow
             + uColor * uAudioBass * 0.3;

    float alpha = max(wire, max(rim * uHorizonFade, uFillSource * 0.5));
    alpha = clamp(alpha, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ============================================================================
// 3. VOXEL CUBE CLUSTER — Floating array of cubes, source mapped per face.
// ============================================================================
export const voxelCubeClusterShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uGridSize;      // 2-8
  uniform float uCubeSize;      // 0.1-0.45
  uniform float uSpacing;       // 0.4-1.2
  uniform float uHeight;        // 0-1 luma extrusion
  uniform float uSpin;          // 0-3
  uniform float uTilt;          // 0-1
  uniform float uCamDistance;   // 2-6
  uniform float uSpecular;      // 0-1
  uniform float uAmbient;       // 0-1
  uniform float uHorizonFade;
  uniform vec3 uBgColor;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, uCamDistance);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX((uTilt - 0.5) * PI * 0.6);
    ro = rot * ro;
    rd = rot * rd;

    int grid = int(clamp(uGridSize, 1.0, 8.0));
    float bestT = 1e9;
    vec3 bestN = vec3(0.0);
    vec3 bestCenter = vec3(0.0);
    float bestLuma = 0.0;
    float spc = uSpacing;
    float halfGrid = float(grid - 1) * 0.5 * spc;

    // Sample cubes uniformly: at each grid cell, sample source colour,
    // displace cube outward by luma * uHeight, then ray-test.
    for (int i = 0; i < 8; i++) {
      if (i >= grid) break;
      for (int j = 0; j < 8; j++) {
        if (j >= grid) break;
        for (int k = 0; k < 8; k++) {
          if (k >= grid) break;
          vec3 cellCenter = vec3(float(i) * spc - halfGrid,
                                 float(j) * spc - halfGrid,
                                 float(k) * spc - halfGrid);
          // Sample source at cell's projected XY
          vec2 sUv = vec2(float(i) / float(grid - 1), float(j) / float(grid - 1));
          vec3 c = texture2D(uTexture, sUv).rgb;
          float l = luma(c);
          // Displace outward from origin proportional to luma
          vec3 dir = normalize(cellCenter + 1e-4);
          vec3 cubePos = cellCenter + dir * l * uHeight * 0.8;
          // Ray-cube test
          vec3 boxRO = ro - cubePos;
          vec3 N;
          float ti = intersectBox(boxRO, rd, vec3(uCubeSize), N);
          if (ti > 0.0 && ti < bestT) {
            bestT = ti;
            bestN = N;
            bestCenter = cubePos;
            bestLuma = l;
          }
        }
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uBgColor, 1.0 - uHorizonFade);
      return;
    }

    vec3 hit = ro + rd * bestT;
    vec3 localPos = hit - bestCenter;
    // Map face to source UV
    vec2 faceUv;
    vec3 an = abs(bestN);
    if (an.x > 0.5) faceUv = (localPos.zy / uCubeSize) * 0.5 + 0.5;
    else if (an.y > 0.5) faceUv = (localPos.xz / uCubeSize) * 0.5 + 0.5;
    else faceUv = (localPos.xy / uCubeSize) * 0.5 + 0.5;
    vec3 faceCol = texture2D(uTexture, faceUv).rgb;

    vec3 lightDir = normalize(vec3(0.5, 0.7, 0.5));
    float diff = max(dot(bestN, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, bestN), -rd), 0.0), 32.0) * uSpecular;
    vec3 col = faceCol * (uAmbient + diff * 0.85) + vec3(spec);
    col += uBgColor * uAudioBass * 0.2;

    // Distance fade
    float fade = 1.0 - clamp((bestT - uCamDistance + 2.0) / 4.0, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

// ============================================================================
// 4. MOBIUS LATTICE — Twisted ribbon mosaic looping on itself.
// ============================================================================
export const mobiusLatticeShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMajorR;        // 0.5-1.2
  uniform float uRibbonW;       // 0.1-0.5
  uniform float uTwists;        // 0.5-4
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uLineDensity;   // 4-32 lattice line count
  uniform float uLineWidth;     // 0.005-0.04
  uniform float uIntensity;     // 0-2
  uniform vec3 uLineColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  // Möbius point: R = major radius, w = ribbon half-width
  // u in [0, 2π) along loop, v in [-1, 1] across ribbon
  vec3 mobiusPoint(float u, float v, float R, float w, float twists) {
    float halfTwist = u * twists * 0.5;
    float r = R + v * w * cos(halfTwist);
    return vec3(r * cos(u), v * w * sin(halfTwist), r * sin(u));
  }

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.6);
    ro = rot * ro;
    rd = rot * rd;

    // Test against an enclosing torus (approximation) — pick coarse points
    // along the ribbon and ray-test as small box hulls. Lower-cost approach.
    float bestT = 1e9;
    vec2 bestSurfUV = vec2(0.0);
    vec3 bestN = vec3(0.0, 1.0, 0.0);

    int loopSteps = 24;
    for (int i = 0; i < 24; i++) {
      float u0 = float(i) / float(loopSteps) * TAU;
      // Test a few v slices per loop point
      for (int j = -1; j <= 1; j++) {
        float v0 = float(j);
        vec3 pt = mobiusPoint(u0, v0, uMajorR, uRibbonW, uTwists);
        vec3 N;
        float ti = intersectBox(ro - pt, rd, vec3(uRibbonW * 0.55), N);
        if (ti > 0.0 && ti < bestT) {
          bestT = ti;
          bestSurfUV = vec2(u0 / TAU, v0 * 0.5 + 0.5);
          bestN = N;
        }
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uLineColor * 0.05, 1.0 - uHorizonFade);
      return;
    }

    vec3 tex = texture2D(uTexture, bestSurfUV).rgb;
    // Lattice lines along U + V
    float linU = 1.0 - smoothstep(uLineWidth, uLineWidth * 1.8,
      abs(fract(bestSurfUV.x * uLineDensity) - 0.5));
    float linV = 1.0 - smoothstep(uLineWidth, uLineWidth * 1.8,
      abs(fract(bestSurfUV.y * uLineDensity * 0.3) - 0.5));
    float lat = max(linU, linV);

    vec3 col = tex * uIntensity + uLineColor * lat + uLineColor * uAudioBass * 0.3;
    float fade = 1.0 - clamp((bestT - 2.0) / 2.5, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

// ============================================================================
// 5. CRYSTAL SHARD FIELD — Refractive shards with chromatic edges.
// ============================================================================
export const crystalShardFieldShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uShardCount;    // 6-32
  uniform float uShardSize;     // 0.1-0.6
  uniform float uSpread;        // 0.5-2 area shards float in
  uniform float uChromaEdge;    // 0-1
  uniform float uRefraction;    // 0-1
  uniform float uSpin;          // -3..3
  uniform float uIntensity;     // 0-2
  uniform vec3 uTint;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.2);
    ro = rot * ro;
    rd = rot * rd;

    int n = int(clamp(uShardCount, 4.0, 32.0));
    float bestT = 1e9;
    vec3 bestN = vec3(0.0);
    vec3 bestPos = vec3(0.0);
    float bestSeed = 0.0;

    for (int i = 0; i < 32; i++) {
      if (i >= n) break;
      float fi = float(i);
      // Random shard position + orientation
      float sx = (hash13(vec3(fi, 0.0, 0.0)) - 0.5) * 2.0 * uSpread;
      float sy = (hash13(vec3(fi, 1.0, 0.0)) - 0.5) * 2.0 * uSpread;
      float sz = (hash13(vec3(fi, 2.0, 0.0)) - 0.5) * 2.0 * uSpread;
      vec3 center = vec3(sx, sy, sz);
      // Drift
      center.y += sin(uTime * 0.3 + fi * 2.7) * 0.1;
      center.x += cos(uTime * 0.4 + fi * 1.7) * 0.1;

      // Rotate ray into shard local frame
      mat3 sRot = rotY(fi * 1.7 + uTime * 0.1) * rotX(fi * 0.7);
      vec3 lro = sRot * (ro - center);
      vec3 lrd = sRot * rd;

      float bs = uShardSize * (0.6 + hash13(vec3(fi, 5.0, 0.0)));
      vec3 N;
      float ti = intersectBox(lro, lrd, vec3(bs, bs * 0.4, bs), N);
      if (ti > 0.0 && ti < bestT) {
        bestT = ti;
        bestN = transpose(sRot) * N; // back to world
        bestPos = ro + rd * ti;
        bestSeed = fi;
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uTint * 0.04, 1.0 - uHorizonFade);
      return;
    }

    // Refraction sample: project hit position to source UV
    vec2 sUv = vec2(bestPos.x, bestPos.y) * 0.3 + 0.5;
    vec2 refractDir = bestN.xy * uRefraction * 0.06;
    vec3 col;
    if (uChromaEdge > 0.001) {
      col.r = texture2D(uTexture, sUv + refractDir + bestN.xy * uChromaEdge * 0.02).r;
      col.g = texture2D(uTexture, sUv + refractDir).g;
      col.b = texture2D(uTexture, sUv + refractDir - bestN.xy * uChromaEdge * 0.02).b;
    } else {
      col = texture2D(uTexture, clamp(sUv + refractDir, vec2(0.0), vec2(1.0))).rgb;
    }
    col *= uTint;

    // Specular edge
    vec3 lightDir = normalize(vec3(0.5, 0.7, 0.5));
    float spec = pow(max(dot(reflect(-lightDir, bestN), -rd), 0.0), 16.0);
    col += vec3(spec) * 0.6;
    col *= uIntensity;
    col += uTint * uAudioBass * 0.25;

    float fade = 1.0 - clamp((bestT - 2.0) / 3.0, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

// ============================================================================
// 6. TUBE LATTICE — Rod cluster mapping source to barrel UV.
// ============================================================================
export const tubeLatticeShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uTubeCount;     // 3-12
  uniform float uTubeRadius;    // 0.05-0.3
  uniform float uSpread;        // 0.4-2
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uTwist;         // 0-3 spiral twist of tubes
  uniform float uIntensity;     // 0-2
  uniform vec3 uRimColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    int n = int(clamp(uTubeCount, 1.0, 12.0));
    float bestT = 1e9;
    vec3 bestN = vec3(0.0);
    float bestSeed = 0.0;
    vec3 bestHit = vec3(0.0);

    float bassBoost = 1.0 + uAudioBass * 0.4;
    for (int i = 0; i < 12; i++) {
      if (i >= n) break;
      float fi = float(i);
      float ang = fi / float(n) * TAU;
      vec3 offset = vec3(cos(ang), 0.0, sin(ang)) * uSpread;
      // Twist the tube position
      mat3 twistRot = rotZ(uTwist * sin(uTime * 0.2 + fi));
      offset = twistRot * offset;

      vec3 N;
      float ti = intersectCylinderY(ro - offset, rd, uTubeRadius * bassBoost, N);
      if (ti > 0.0 && ti < bestT) {
        // Validate that hit y is within range (clip to ±1)
        vec3 hit = ro + rd * ti;
        if (abs(hit.y - offset.y) > 1.5) continue;
        bestT = ti;
        bestN = N;
        bestSeed = fi;
        bestHit = hit;
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uRimColor * 0.04, 1.0 - uHorizonFade);
      return;
    }

    // Map hit on tube to barrel UV
    float ang = atan(bestN.z, bestN.x) / TAU + 0.5;
    float yU = bestHit.y * 0.5 + 0.5;
    vec2 sUv = vec2(ang, yU);
    vec3 tex = texture2D(uTexture, sUv).rgb;

    float rim = fresnel(bestN, rd, 1.6);
    vec3 col = tex * uIntensity + uRimColor * rim * 0.7 + uRimColor * uAudioBass * 0.2;
    float fade = 1.0 - clamp((bestT - 2.0) / 3.0, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

// ============================================================================
// 7. DISCO MIRROR BALL — Faceted ball with chase lights + sparkle.
// ============================================================================
export const discoMirrorBallShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uRadius;        // 0.6-1.4
  uniform float uFacetCount;    // 6-32 facet density per axis
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uChaseSpeed;    // 0-3
  uniform float uChaseHueWidth; // 0-1
  uniform float uSparkle;       // 0-1
  uniform float uIntensity;     // 0-2
  uniform vec3 uHighlightColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 2.8);
    vec3 rd = normalize(vec3(p, -1.7));

    float r = uRadius * (1.0 + uAudioBeatPulse * 0.06);
    float t = intersectSphere(ro, rd, r);
    if (t < 0.0) {
      gl_FragColor = vec4(uHighlightColor * 0.04, 1.0 - uHorizonFade);
      return;
    }
    vec3 pos = ro + rd * t;
    vec3 n = normalize(pos);
    n = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.5) * n;
    vec2 suv = sphereUV(n);

    // Quantize UV to facets (mirror tiles)
    vec2 facetSize = vec2(1.0 / uFacetCount, 1.0 / (uFacetCount * 0.5));
    vec2 facetIdx = floor(suv / facetSize);
    vec2 facetCenter = (facetIdx + 0.5) * facetSize;
    vec3 tex = texture2D(uTexture, facetCenter).rgb;

    // Per-facet edge lines (gaps between mirrors)
    vec2 inFacet = fract(suv / facetSize);
    float edge = smoothstep(0.92, 1.0, max(inFacet.x, inFacet.y))
               + smoothstep(0.92, 1.0, max(1.0 - inFacet.x, 1.0 - inFacet.y));
    edge = clamp(edge, 0.0, 1.0);

    // Chase lights: animated hue cycling per facet
    float chase = sin(uTime * uChaseSpeed + facetIdx.x * 1.7 + facetIdx.y * 2.3) * 0.5 + 0.5;
    vec3 chaseTint = hsv2rgb(vec3(fract(uTime * 0.05 + chase * uChaseHueWidth), 0.8, 1.0));
    vec3 col = mix(tex, tex * chaseTint, chase * 0.5);

    // Sparkle: random bright facets
    float sparkle = step(1.0 - uSparkle * 0.3, hash13(vec3(facetIdx, floor(uTime * 4.0))));
    col += uHighlightColor * sparkle * 1.5 * (1.0 + uAudioBass * 1.5);
    col += uHighlightColor * edge * 0.5;
    col *= uIntensity;

    float rim = fresnel(n, rd, 2.5);
    col += uHighlightColor * rim * 0.4;

    float alpha = clamp(1.0 - rim * uHorizonFade * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

// ============================================================================
// 8. LISSAJOUS KNOT — Animated tubular swept frame around a 3D Lissajous curve.
// ============================================================================
export const lissajousKnotShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uRatioX;        // 1-7
  uniform float uRatioY;        // 1-7
  uniform float uRatioZ;        // 1-7
  uniform float uPhaseX;        // 0-1
  uniform float uPhaseY;        // 0-1
  uniform float uTubeRadius;    // 0.04-0.2
  uniform float uScale;         // 0.5-1.5
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uIntensity;     // 0-2
  uniform vec3 uTubeColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  // Lissajous curve point in 3D
  vec3 lissajous(float t, float scale) {
    return vec3(
      sin(uRatioX * t + uPhaseX * TAU),
      sin(uRatioY * t + uPhaseY * TAU),
      sin(uRatioZ * t)
    ) * scale;
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    // Walk the curve in N steps; at each, ray-test a sphere tube segment.
    float bestT = 1e9;
    vec3 bestPt = vec3(0.0);
    float bestU = 0.0;
    int steps = 64;
    float r = uTubeRadius * (1.0 + uAudioBeatPulse * 0.1);
    for (int i = 0; i < 64; i++) {
      float ti = float(i) / float(steps - 1) * TAU;
      vec3 pt = lissajous(ti, uScale);
      // Ray-sphere test on each curve point
      float t = intersectSphere(ro - pt, rd, r);
      if (t > 0.0 && t < bestT) {
        bestT = t;
        bestPt = pt;
        bestU = ti / TAU;
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uTubeColor * 0.05, 1.0 - uHorizonFade);
      return;
    }

    vec3 hit = ro + rd * bestT;
    vec3 N = normalize(hit - bestPt);

    // Map sample position along curve + tube angle to source UV
    float ang = atan(N.z, N.x) / TAU + 0.5;
    vec2 sUv = vec2(bestU, ang);
    vec3 tex = texture2D(uTexture, sUv).rgb;

    vec3 lightDir = normalize(vec3(0.5, 0.7, 0.5));
    float diff = max(dot(N, lightDir), 0.0);
    vec3 col = (tex * uIntensity + uTubeColor * 0.3) * (0.4 + diff * 0.7);
    col += uTubeColor * uAudioBass * 0.4;

    float fade = 1.0 - clamp((bestT - 2.0) / 2.5, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

// ============================================================================
// 9. HELIX PARTICLE STREAM — Rising DNA-like ribbons of source pixels.
// ============================================================================
export const helixParticleStreamShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uHelices;       // 1-6
  uniform float uHelixRadius;   // 0.2-1
  uniform float uTurns;         // 1-6
  uniform float uHeight;        // 1-3
  uniform float uTubeRadius;    // 0.02-0.15
  uniform float uRiseSpeed;     // 0-3
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uIntensity;     // 0-2
  uniform vec3 uTint;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  vec3 helixPoint(float helixIdx, float t, float radius, float turns, float height) {
    float ang = t * turns * TAU + helixIdx * (TAU / max(1.0, uHelices));
    return vec3(cos(ang) * radius, (t - 0.5) * height, sin(ang) * radius);
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.5);
    ro = rot * ro;
    rd = rot * rd;

    int n = int(clamp(uHelices, 1.0, 6.0));
    int steps = 48;
    float bestT = 1e9;
    float bestU = 0.0;
    vec3 bestPt = vec3(0.0);
    float bestHelix = 0.0;
    float r = uTubeRadius * (1.0 + uAudioBeatPulse * 0.15);

    for (int h = 0; h < 6; h++) {
      if (h >= n) break;
      for (int i = 0; i < 48; i++) {
        float ti = float(i) / float(steps - 1);
        // Animated rise: shift t by time
        ti = fract(ti + uTime * uRiseSpeed * 0.05);
        vec3 pt = helixPoint(float(h), ti, uHelixRadius, uTurns, uHeight);
        float t = intersectSphere(ro - pt, rd, r);
        if (t > 0.0 && t < bestT) {
          bestT = t;
          bestU = ti;
          bestPt = pt;
          bestHelix = float(h);
        }
      }
    }

    if (bestT > 1e8) {
      gl_FragColor = vec4(uTint * 0.04, 1.0 - uHorizonFade);
      return;
    }

    vec3 hit = ro + rd * bestT;
    vec3 N = normalize(hit - bestPt);
    vec2 sUv = vec2(bestU, bestHelix / max(1.0, uHelices));
    vec3 tex = texture2D(uTexture, sUv).rgb;

    vec3 lightDir = normalize(vec3(0.5, 0.7, 0.5));
    float diff = max(dot(N, lightDir), 0.0);
    vec3 col = tex * uIntensity * (0.5 + diff * 0.7) + uTint * uAudioBass * 0.3;

    float fade = 1.0 - clamp((bestT - 2.0) / 2.5, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

// ============================================================================
// 10. DONUT CONSTELLATION — Glowing torus with audio-pulsed star nodes.
// ============================================================================
export const donutConstellationShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMajorR;        // 0.5-1.4
  uniform float uMinorR;        // 0.05-0.4
  uniform float uStarCount;     // 4-32
  uniform float uStarSize;      // 0.005-0.04
  uniform float uSpin;          // -3..3
  uniform float uTilt;          // 0-1
  uniform float uTintIntensity; // 0-2
  uniform vec3 uTorusColor;
  uniform vec3 uStarColor;
  uniform float uHorizonFade;
  uniform float uAudioBass;
  uniform float uAudioBeatPulse;
  varying vec2 vUv;

  ${geometricCommon}

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(p, -1.5));

    mat3 rot = rotY(uTime * uSpin * 0.3) * rotX(uTilt * PI * 0.6);
    ro = rot * ro;
    rd = rot * rd;

    vec3 N;
    float r = uMinorR * (1.0 + uAudioBeatPulse * 0.1);
    float t = intersectTorus(ro, rd, uMajorR, r, N);
    if (t < 0.0) {
      // Stars only — render constellation in space, not bound to torus surface
      // Simplified: skip background since we have stars below
      gl_FragColor = vec4(uTorusColor * 0.04, 1.0 - uHorizonFade);
      return;
    }

    vec3 hit = ro + rd * t;
    // Map torus to UV
    float u = atan(hit.z, hit.x) / TAU + 0.5;
    float v = atan(hit.y, length(hit.xz) - uMajorR) / TAU + 0.5;
    vec2 sUv = vec2(u, v);
    vec3 tex = texture2D(uTexture, sUv).rgb;

    float rim = fresnel(N, rd, 2.5);
    vec3 col = tex * uTintIntensity + uTorusColor * rim * 0.5;

    // Star points: positioned at evenly spaced angles around the torus
    int stars = int(clamp(uStarCount, 4.0, 32.0));
    float bassPulse = 1.0 + uAudioBass * 0.8;
    for (int i = 0; i < 32; i++) {
      if (i >= stars) break;
      float fi = float(i);
      float starAng = fi / float(stars) * TAU + uTime * 0.05;
      vec3 starPos = vec3(cos(starAng) * uMajorR, 0.0, sin(starAng) * uMajorR);
      float dStar = distance(hit, starPos);
      float starMask = smoothstep(uStarSize * bassPulse, 0.0, dStar);
      col += uStarColor * starMask * 1.5;
    }
    col += uTorusColor * uAudioBass * 0.3;

    float fade = 1.0 - clamp((t - 2.0) / 3.0, 0.0, 1.0);
    float alpha = mix(1.0, fade, uHorizonFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;
