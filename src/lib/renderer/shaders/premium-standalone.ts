// Dedicated standalone shaders extracted from pack shaders for GPU compatibility
// These effects were previously modes inside mega-shaders that exceeded GPU instruction limits

// ============================================================================
// Dedicated Number Grid Shader (extracted from premiumPackShader mode 30)
// ============================================================================
export const numberGridShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float cellSize = mix(6.0, 24.0, uAmount);
    float contrast = 0.5 + uAmount2 * 1.5;
    float colorMix = uAmount3;

    vec2 cell = floor(uv * uResolution / cellSize);
    vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
    vec4 cellColor = texture2D(uTexture, cellUv);
    float l = luma(cellColor.rgb);
    l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);

    vec2 local = fract(uv * uResolution / cellSize);

    // Map luminance to digit 0-9
    int digit = int(l * 9.99);
    float charMask = 0.0;
    float cx = local.x;
    float cy = 1.0 - local.y;

    // 3x5 grid cell index (use int to avoid float comparison issues)
    int gx = int(floor(cx * 3.0));
    int gy = int(floor(cy * 5.0));
    int gi = gy * 3 + gx;

    // Segment lookup per digit (3x5 grid encoding)
    if (digit == 0) {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==5||gi==6||gi==8||gi==9||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 1) {
      charMask = (gi==1||gi==4||gi==7||gi==10||gi==13) ? 1.0 : 0.0;
    } else if (digit == 2) {
      charMask = (gi==0||gi==1||gi==2||gi==5||gi==6||gi==7||gi==8||gi==9||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 3) {
      charMask = (gi==0||gi==1||gi==2||gi==5||gi==6||gi==7||gi==8||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 4) {
      charMask = (gi==0||gi==2||gi==3||gi==5||gi==6||gi==7||gi==8||gi==11||gi==14) ? 1.0 : 0.0;
    } else if (digit == 5) {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==6||gi==7||gi==8||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 6) {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==6||gi==7||gi==8||gi==9||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else if (digit == 7) {
      charMask = (gi==0||gi==1||gi==2||gi==5||gi==8||gi==11||gi==14) ? 1.0 : 0.0;
    } else if (digit == 8) {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==5||gi==6||gi==7||gi==8||gi==9||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    } else {
      charMask = (gi==0||gi==1||gi==2||gi==3||gi==5||gi==6||gi==7||gi==8||gi==11||gi==12||gi==13||gi==14) ? 1.0 : 0.0;
    }

    // Padding: only show within inner cell area
    float inCell = step(0.1, cx) * step(cx, 0.9) * step(0.05, cy) * step(cy, 0.95);
    charMask *= inCell;

    vec3 numColor = mix(vec3(charMask), cellColor.rgb * charMask, colorMix);
    gl_FragColor = vec4(clamp(numColor, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Dedicated Explode 3D Shader (extracted from premiumPack2Shader mode 0)
// ============================================================================
export const explode3DShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float scatter = uAmount;
    float shapeId = floor(uAmount2 * 5.99);
    float spinSpeed = uAmount3 * 2.0;
    float bright = 0.5 + uThreshold;
    float camAngle = uAngle + uTime * spinSpeed;

    float gridRes = mix(25.0, 70.0, 1.0 - uAmount2 * 0.3);
    vec2 cellCount = vec2(gridRes, gridRes * uResolution.y / uResolution.x);
    vec2 cellSize = 1.0 / cellCount;

    vec3 finalColor = vec3(0.0);
    float totalWeight = 0.0;

    // Expanded search radius for 3D projection
    for (int ox = -3; ox <= 3; ox++) {
      for (int oy = -3; oy <= 3; oy++) {
        vec2 cellId = floor(uv * cellCount) + vec2(float(ox), float(oy));
        if (cellId.x < 0.0 || cellId.y < 0.0 || cellId.x >= cellCount.x || cellId.y >= cellCount.y) continue;

        vec2 cellCenter = (cellId + 0.5) * cellSize;
        vec4 cellColor = texture2D(uTexture, cellCenter);

        float rnd1 = hash(cellId);
        float rnd2 = hash(cellId + 137.0);
        float rnd3 = hash(cellId + 271.0);

        float theta = cellCenter.x * TAU;
        float phi = cellCenter.y * PI;
        vec3 shapePos;

        if (shapeId < 1.0) {
          shapePos = vec3(sin(phi)*cos(theta), cos(phi), sin(phi)*sin(theta));
        } else if (shapeId < 2.0) {
          float face = floor(rnd1 * 6.0);
          vec3 p = vec3(cellCenter.x * 2.0 - 1.0, cellCenter.y * 2.0 - 1.0, 1.0);
          if (face < 1.0) shapePos = p;
          else if (face < 2.0) shapePos = vec3(-p.z, p.y, p.x);
          else if (face < 3.0) shapePos = vec3(p.z, p.y, -p.x);
          else if (face < 4.0) shapePos = vec3(p.x, p.z, -p.y);
          else if (face < 5.0) shapePos = vec3(p.x, -p.z, p.y);
          else shapePos = vec3(p.x, p.y, -p.z);
          shapePos = normalize(shapePos);
        } else if (shapeId < 3.0) {
          float h = cellCenter.y;
          float r = (1.0 - h) * 0.8;
          float a = cellCenter.x * TAU;
          float sides = floor(a / (TAU/4.0)) * (TAU/4.0) + TAU/8.0;
          shapePos = vec3(cos(sides)*r, h*2.0-1.0, sin(sides)*r);
        } else if (shapeId < 4.0) {
          float R = 0.7, r2 = 0.3;
          shapePos = vec3((R + r2*cos(phi))*cos(theta), r2*sin(phi), (R + r2*cos(phi))*sin(theta));
        } else if (shapeId < 5.0) {
          float r2 = 0.6;
          shapePos = vec3(r2*cos(theta), cellCenter.y*2.0-1.0, r2*sin(theta));
        } else {
          float t = cellCenter.y * 4.0 * PI;
          float r2 = 0.5;
          shapePos = vec3(r2*cos(t + theta), cellCenter.y*2.0-1.0, r2*sin(t + theta));
        }

        // Rotate shape
        float ca = cos(camAngle), sa = sin(camAngle);
        shapePos = vec3(shapePos.x*ca - shapePos.z*sa, shapePos.y, shapePos.x*sa + shapePos.z*ca);

        // Scatter
        vec3 scatterDir = normalize(shapePos + vec3(rnd1-0.5, rnd2-0.5, rnd3-0.5)*0.5);
        vec3 pos3d = shapePos + scatterDir * scatter * (0.5 + rnd1) * 1.5;

        // Project to 2D
        float z = pos3d.z + 3.0;
        vec2 proj = pos3d.xy / z * 0.5 + 0.5;
        float pSize = cellSize.x * (1.0 + uAmount2) / max(z * 0.4, 0.1);

        vec2 diff = (uv - proj) / vec2(1.0, uResolution.x / uResolution.y);
        float dist = length(diff);
        float particle = smoothstep(pSize, pSize * 0.2, dist);

        if (particle > 0.01) {
          vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
          float diffuse = max(dot(normalize(shapePos), lightDir), 0.0) * 0.7 + 0.3;
          vec3 lit = cellColor.rgb * diffuse * bright * uColor;
          float depthFade = 1.0 / (1.0 + max(z - 2.0, 0.0) * 0.3);
          finalColor += lit * particle * depthFade;
          totalWeight += particle * depthFade;
        }
      }
    }

    if (totalWeight > 0.01) {
      finalColor /= totalWeight;
      gl_FragColor = vec4(mix(src.rgb * (1.0 - scatter * 0.5), finalColor, clamp(totalWeight, 0.0, 1.0)), src.a);
    } else {
      gl_FragColor = vec4(src.rgb * (1.0 - scatter * 0.5), src.a);
    }
  }
`;

// ============================================================================
// Dedicated Terrain 3D Shader (extracted from premiumPack2Shader mode 1)
// ============================================================================
export const terrain3DShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;          // 0=opaque sky, 1=fade horizon to transparent, 2=blend with source
  uniform float uAmount;        // height scale
  uniform float uAmount2;       // camera height
  uniform float uAmount3;       // speed
  uniform float uThreshold;     // fog density
  uniform float uAngle;         // yaw
  uniform vec2 uCenter;         // pitch/roll
  uniform vec3 uColor;          // fog colour
  uniform float uHorizonFade;   // 0-1 fade terrain alpha at horizon
  uniform float uSourceMix;     // 0-1 blend with original source layer
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float heightScale = uAmount * 0.8;
    float camHeight = 0.08 + uAmount2 * 0.35;
    float speed = uAmount3 * 0.5;
    float fogDensity = uThreshold * 3.0;
    float camYaw = uAngle;
    float camPitch = (uCenter.x - 0.5) * PI * 0.5;
    float camRoll = uCenter.y * TAU;
    vec3 fogColor = uColor;

    vec2 forward = vec2(cos(camYaw), sin(camYaw));
    vec2 camPos2D = forward * uTime * speed;

    vec3 color = vec3(0.0);
    float maxDist = 8.0;

    vec2 screenPos = uv * 2.0 - 1.0;
    screenPos.x *= uResolution.x / uResolution.y;

    vec3 ro = vec3(camPos2D.x, camHeight, camPos2D.y);
    vec3 rd = normalize(vec3(screenPos.x, screenPos.y * 0.5 - 0.3, 1.5));

    float crl = cos(camRoll), srl = sin(camRoll);
    rd = vec3(crl * rd.x - srl * rd.y, srl * rd.x + crl * rd.y, rd.z);
    float cp = cos(camPitch), sp = sin(camPitch);
    rd = vec3(rd.x, cp * rd.y - sp * rd.z, sp * rd.y + cp * rd.z);
    rd.xz = mat2(cos(camYaw), -sin(camYaw), sin(camYaw), cos(camYaw)) * rd.xz;

    float t = 0.01;
    bool hit = false;
    vec3 hitPos;
    for (int i = 0; i < 80; i++) {
      hitPos = ro + rd * t;
      vec2 sampleUV = fract(hitPos.xz * 0.3);
      float h = luma(texture2D(uTexture, sampleUV).rgb) * heightScale;
      if (hitPos.y < h) { hit = true; break; }
      t += max(0.005, (hitPos.y - h) * 0.4);
      if (t > maxDist) break;
    }

    // Horizon fade: alpha drops as ray points up (toward sky) or distance grows
    float horizonW = smoothstep(0.0, 0.4, rd.y); // 0 below horizon, 1 well above
    float distFade = clamp(t / maxDist, 0.0, 1.0);
    float terrainAlpha = 1.0;
    int mode = int(uMode + 0.5);

    if (hit) {
      vec2 sUV = fract(hitPos.xz * 0.3);
      vec3 texColor = texture2D(uTexture, sUV).rgb;
      float eps = 0.005;
      float hL = luma(texture2D(uTexture, fract((hitPos.xz + vec2(-eps,0.0))*0.3)).rgb) * heightScale;
      float hR = luma(texture2D(uTexture, fract((hitPos.xz + vec2(eps,0.0))*0.3)).rgb) * heightScale;
      float hD = luma(texture2D(uTexture, fract((hitPos.xz + vec2(0.0,-eps))*0.3)).rgb) * heightScale;
      float hU = luma(texture2D(uTexture, fract((hitPos.xz + vec2(0.0,eps))*0.3)).rgb) * heightScale;
      vec3 normal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
      vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
      float diff = max(dot(normal, lightDir), 0.0) * 0.8 + 0.2;
      color = texColor * diff;
      float fogFactor = 1.0 - exp(-t * fogDensity * 0.5);
      color = mix(color, fogColor, fogFactor);
      // Distance-based alpha fade
      terrainAlpha = mix(1.0, 1.0 - distFade, uHorizonFade * 0.85);
    } else {
      // Sky / miss
      float skyGrad = max(rd.y, 0.0);
      color = mix(fogColor, fogColor * 1.3, skyGrad);
      // Mode 0: opaque sky. Mode 1+: alpha falls off above horizon for transparent reveal.
      if (mode != 0) terrainAlpha = mix(1.0, 1.0 - horizonW, uHorizonFade);
    }

    // Mode 2: also blend final result with the underlying source colour
    vec4 srcLayer = src;
    if (mode == 2 && uSourceMix > 0.001) {
      color = mix(color, srcLayer.rgb, uSourceMix * (mode == 2 ? 1.0 : 0.0));
    }

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), terrainAlpha * src.a);
  }
`;

// ============================================================================
// WRAPPED TERRAIN (LEGACY) — kept for reference; actual export is the SDF
// raymarched version below.
// ============================================================================
const wrappedTerrainShader_LEGACY = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uShape;         // 0=sphere, 1=cube, 2=pyramid
  uniform float uHeight;        // 0-1 extrusion amount (luma → outward push)
  uniform float uRotateX;       // 0-1 (mapped to 0..2π)
  uniform float uRotateY;       // 0-1
  uniform float uAutoRotate;    // 0-2 spin speed
  uniform float uCamDistance;   // 1-5
  uniform float uSpecular;      // 0-1
  uniform float uAmbient;       // 0-1
  uniform float uFogDistance;   // 0-1 distance fog factor
  uniform vec3 uFogColor;
  uniform float uHorizonFade;   // 0-1 alpha fade past silhouette
  uniform float uSourceMix;     // 0-1 blend with raw source layer
  uniform float uTileScale;     // 0.5-4 tile UV repeat
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  mat3 rotX(float a) { float s = sin(a), c = cos(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
  mat3 rotY(float a) { float s = sin(a), c = cos(a); return mat3(c,0,s, 0,1,0, -s,0,c); }

  // Sphere intersect
  float intersectSphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return -1.0;
    return -b - sqrt(h);
  }

  // Box intersect (returns near hit; sets normal via outNormal)
  float intersectBox(vec3 ro, vec3 rd, float r, out vec3 outNormal) {
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

  // Pyramid (4-sided) — analytic intersect via plane equations
  float intersectPyramid(vec3 ro, vec3 rd, float r, out vec3 outNormal) {
    // 4 side planes meeting at apex (0, r, 0), base at y = -r/3
    float bestT = 1e9;
    vec3 bestN = vec3(0.0);
    vec3 normals[5];
    float ds[5];
    float baseY = -r * 0.33;
    float apexY = r;
    // Normalize: each side plane normal points outward, slope from base edge to apex
    normals[0] = normalize(vec3( 1.0,  0.4,  0.0)); ds[0] = r * 0.5;
    normals[1] = normalize(vec3(-1.0,  0.4,  0.0)); ds[1] = r * 0.5;
    normals[2] = normalize(vec3( 0.0,  0.4,  1.0)); ds[2] = r * 0.5;
    normals[3] = normalize(vec3( 0.0,  0.4, -1.0)); ds[3] = r * 0.5;
    normals[4] = vec3(0.0, -1.0, 0.0); ds[4] = -baseY;
    for (int i = 0; i < 5; i++) {
      float denom = dot(rd, normals[i]);
      if (abs(denom) < 1e-4) continue;
      float ti = (ds[i] - dot(ro, normals[i])) / denom;
      if (ti < 0.0) continue;
      vec3 hit = ro + rd * ti;
      // Validate inside other planes (with small epsilon)
      bool inside = true;
      for (int j = 0; j < 5; j++) {
        if (i == j) continue;
        if (dot(hit, normals[j]) > ds[j] + 0.01) { inside = false; break; }
      }
      if (inside && ti < bestT) { bestT = ti; bestN = normals[i]; }
    }
    if (bestT > 1e8) return -1.0;
    outNormal = bestN;
    return bestT;
  }

  // Map a world-space point on the surface to a UV coord on the source texture
  vec2 surfaceUV(vec3 p, int shape, vec3 n) {
    if (shape == 0) {
      // Sphere → equirectangular
      vec3 d = normalize(p);
      return vec2(atan(d.z, d.x) / TAU + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
    } else if (shape == 1) {
      // Cube → pick face from largest |normal| component
      vec3 an = abs(n);
      vec2 uv;
      if (an.x > an.y && an.x > an.z) uv = vec2(p.z, p.y) * 0.5 + 0.5;
      else if (an.y > an.z) uv = vec2(p.x, p.z) * 0.5 + 0.5;
      else uv = vec2(p.x, p.y) * 0.5 + 0.5;
      return uv;
    } else {
      // Pyramid → triplanar approx
      vec3 d = normalize(p);
      return vec2(atan(d.z, d.x) / TAU + 0.5, p.y * 0.5 + 0.5);
    }
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    int shape = int(uShape + 0.5);
    vec2 screenPos = vUv * 2.0 - 1.0;
    screenPos.x *= uResolution.x / uResolution.y;

    // Camera setup
    float dist = max(1.5, uCamDistance);
    vec3 ro = vec3(0.0, 0.0, dist);
    vec3 rd = normalize(vec3(screenPos, -1.5));

    // Auto + manual rotation
    float angY = uRotateY * TAU + uTime * uAutoRotate * 0.4;
    float angX = (uRotateX - 0.5) * PI;
    mat3 rotMat = rotY(angY) * rotX(angX);

    ro = rotMat * ro;
    rd = rotMat * rd;

    float radius = 1.0;
    float t = -1.0;
    vec3 normal = vec3(0.0, 0.0, 1.0);

    if (shape == 0) {
      t = intersectSphere(ro, rd, radius);
      if (t > 0.0) normal = normalize(ro + rd * t);
    } else if (shape == 1) {
      t = intersectBox(ro, rd, radius, normal);
    } else {
      t = intersectPyramid(ro, rd, radius, normal);
    }

    if (t < 0.0) {
      // Miss — show fog colour with horizon fade
      float alpha = 1.0 - uHorizonFade;
      vec3 col = mix(uFogColor, srcRaw, uSourceMix);
      gl_FragColor = vec4(col, alpha);
      return;
    }

    vec3 hitPos = ro + rd * t;
    vec2 sUV = fract(surfaceUV(hitPos, shape, normal) * uTileScale);
    vec3 texCol = texture2D(uTexture, sUV).rgb;
    float l = luma(texCol);

    // Extrude outward by luma * uHeight along normal
    vec3 extrudedPos = hitPos + normal * l * uHeight * 0.4;
    // Re-derive surface UV for the extruded position (small wiggle)
    vec2 sUV2 = fract(surfaceUV(extrudedPos, shape, normal) * uTileScale);
    vec3 finalCol = texture2D(uTexture, sUV2).rgb;

    // Lighting
    vec3 lightDir = normalize(rotMat * vec3(0.5, 0.7, 0.5));
    float diff = max(dot(normal, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, normal), -rd), 0.0), 32.0) * uSpecular;
    vec3 lit = finalCol * (uAmbient + diff * 0.85) + vec3(spec);

    // Distance fog (smooth falloff away from camera at silhouette)
    float fogFactor = 1.0 - exp(-t * uFogDistance * 0.3);
    lit = mix(lit, uFogColor, fogFactor);

    // Silhouette-edge fade (Fresnel-like) for nice fade into BG
    float fres = 1.0 - max(dot(normal, -rd), 0.0);
    float silAlpha = 1.0 - smoothstep(0.7, 1.0, fres) * uHorizonFade;

    // Source mix
    vec3 disp = mix(lit, srcRaw, uSourceMix);
    gl_FragColor = vec4(clamp(disp, 0.0, 1.0), silAlpha);
  }
`;

// ============================================================================
// WRAPPED TERRAIN — SDF raymarched bumpy sphere/cube/pyramid.
// Source luma physically pushes the surface outward along its normal — the
// silhouette deforms, not just the texture. Uses standard SDF raymarch +
// 4-tap normal estimate for shading.
// ============================================================================
export const wrappedTerrainShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uShape;         // 0=sphere, 1=cube, 2=pyramid
  uniform float uHeight;        // 0-1 extrusion amount
  uniform float uRotateX;
  uniform float uRotateY;
  uniform float uAutoRotate;
  uniform float uCamDistance;
  uniform float uSpecular;
  uniform float uAmbient;
  uniform float uFogDistance;
  uniform vec3 uFogColor;
  uniform float uHorizonFade;
  uniform float uSourceMix;
  uniform float uTileScale;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  mat3 rotX(float a) { float s = sin(a), c = cos(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
  mat3 rotY(float a) { float s = sin(a), c = cos(a); return mat3(c,0,s, 0,1,0, -s,0,c); }

  // SDF for an axis-aligned box.
  float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
  }

  // SDF for a 4-sided pyramid (apex up). h = height. baseHalf = base half-width.
  float sdPyramid(vec3 p, float h, float baseHalf) {
    p.y += baseHalf * 0.4;
    p.xz = abs(p.xz);
    float m2 = h * h + baseHalf * baseHalf;
    vec3 q = vec3(p.z, h * p.y - baseHalf * p.x, h * p.x + baseHalf * p.y);
    float s = max(-q.x, 0.0);
    float t = clamp((q.y - baseHalf * p.z) / (m2 + baseHalf * baseHalf), 0.0, 1.0);
    float a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
    float b = m2 * (q.x + 0.5 * t) * (q.x + 0.5 * t) + (q.y - m2 * t) * (q.y - m2 * t);
    float d2 = min(q.y, -q.x * m2 - q.y * baseHalf) > 0.0 ? 0.0 : min(a, b);
    return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y));
  }

  // Map a point in surface space to a UV coordinate based on shape.
  vec2 surfaceUV(vec3 p, int shape) {
    if (shape == 0) {
      // Sphere — equirectangular
      vec3 d = normalize(p + 1e-6);
      return vec2(atan(d.z, d.x) / TAU + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
    } else if (shape == 1) {
      // Cube — pick face from largest |axis|, project remaining two
      vec3 ap = abs(p);
      vec2 uv;
      if (ap.x > ap.y && ap.x > ap.z) {
        uv = vec2(p.z * sign(p.x), p.y) * 0.5 + 0.5;
      } else if (ap.y > ap.z) {
        uv = vec2(p.x, p.z * sign(p.y)) * 0.5 + 0.5;
      } else {
        uv = vec2(p.x * sign(p.z), p.y) * 0.5 + 0.5;
      }
      return clamp(uv, 0.0, 1.0);
    } else {
      // Pyramid — wrap U around base, V vertical
      vec3 d = normalize(p + 1e-6);
      return vec2(atan(d.z, d.x) / TAU + 0.5, p.y * 0.5 + 0.5);
    }
  }

  // Sample heightfield from source luma at given surface point.
  float heightAt(vec3 p, int shape) {
    vec2 uv = fract(surfaceUV(p, shape) * uTileScale);
    return luma(texture2D(uTexture, uv).rgb);
  }

  // Bumped SDF — base shape minus luma height along outward direction.
  float bumpedSDF(vec3 p) {
    int shape = int(uShape + 0.5);
    float baseR = 0.85;
    float h = heightAt(p, shape) * uHeight * 0.5;
    float baseSDF;
    if (shape == 0) {
      baseSDF = length(p) - baseR;
    } else if (shape == 1) {
      baseSDF = sdBox(p, vec3(baseR));
    } else {
      baseSDF = sdPyramid(p, baseR * 1.2, baseR);
    }
    return baseSDF - h;
  }

  // 4-tap normal estimation
  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.0025, -0.0025);
    return normalize(
      e.xyy * bumpedSDF(p + e.xyy) +
      e.yyx * bumpedSDF(p + e.yyx) +
      e.yxy * bumpedSDF(p + e.yxy) +
      e.xxx * bumpedSDF(p + e.xxx)
    );
  }

  void main() {
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;
    vec2 screenPos = vUv * 2.0 - 1.0;
    screenPos.x *= uResolution.x / uResolution.y;

    float dist = max(1.5, uCamDistance);
    vec3 ro = vec3(0.0, 0.0, dist);
    vec3 rd = normalize(vec3(screenPos, -1.5));

    float angY = uRotateY * TAU + uTime * uAutoRotate * 0.4;
    float angX = (uRotateX - 0.5) * PI;
    mat3 rotMat = rotY(angY) * rotX(angX);
    ro = rotMat * ro;
    rd = rotMat * rd;

    // SDF raymarch
    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
      vec3 p = ro + rd * t;
      float d = bumpedSDF(p);
      if (d < 0.001) { hit = true; break; }
      t += max(d * 0.7, 0.005);
      if (t > 8.0) break;
    }

    if (!hit) {
      float alpha = 1.0 - uHorizonFade;
      vec3 col = mix(uFogColor, srcRaw, uSourceMix);
      gl_FragColor = vec4(col, alpha);
      return;
    }

    vec3 hitPos = ro + rd * t;
    vec3 N = calcNormal(hitPos);
    int shape = int(uShape + 0.5);
    vec2 sUV = fract(surfaceUV(hitPos, shape) * uTileScale);
    vec3 texCol = texture2D(uTexture, sUV).rgb;

    // Lighting
    vec3 lightDir = normalize(rotMat * vec3(0.5, 0.7, 0.5));
    float diff = max(dot(N, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, N), -rd), 0.0), 32.0) * uSpecular;
    vec3 lit = texCol * (uAmbient + diff * 0.85) + vec3(spec);

    // Distance fog
    float fogFactor = 1.0 - exp(-t * uFogDistance * 0.3);
    lit = mix(lit, uFogColor, fogFactor);

    // Fresnel-like silhouette fade for clean transparent BG
    float fres = 1.0 - max(dot(N, -rd), 0.0);
    float silAlpha = 1.0 - smoothstep(0.7, 1.0, fres) * uHorizonFade;

    vec3 disp = mix(lit, srcRaw, uSourceMix);
    gl_FragColor = vec4(clamp(disp, 0.0, 1.0), silAlpha);
  }
`;

// ============================================================================
// Dedicated Sphere Projection Shader (extracted from premiumPack2Shader mode 2)
// ============================================================================
export const sphereProjectShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;

    float blend = uAmount;
    float roughness = uAmount2;
    float spinSpd = uAmount3 * 2.0;
    float rimGlow = uThreshold;

    vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float r = length(centered);
    float sphereR = 0.45;

    if (r < sphereR) {
      float z = sqrt(sphereR * sphereR - r * r);
      vec3 normal = normalize(vec3(centered, z));

      float angle = uTime * spinSpd;
      float ca = cos(angle), sa = sin(angle);
      vec3 rotN = vec3(normal.x * ca - normal.z * sa, normal.y, normal.x * sa + normal.z * ca);

      vec2 sphereUV = vec2(atan(rotN.z, rotN.x) / TAU + 0.5, asin(clamp(rotN.y, -1.0, 1.0)) / PI + 0.5);
      vec3 texColor = texture2D(uTexture, sphereUV).rgb;

      vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
      float diff = max(dot(normal, lightDir), 0.0);
      float spec = pow(max(dot(reflect(-lightDir, normal), vec3(0,0,1)), 0.0), mix(4.0, 64.0, roughness));
      float fresnel = pow(1.0 - abs(normal.z), 3.0) * rimGlow;

      vec3 lit = texColor * (diff * 0.7 + 0.3) * uColor + vec3(spec * 0.3) + vec3(fresnel) * uColor;
      outColor.rgb = mix(src.rgb, lit, blend);
    } else {
      float edgeFade = smoothstep(sphereR + 0.02, sphereR, r);
      outColor.rgb = mix(src.rgb, src.rgb * 0.3, edgeFade * blend * 0.5);
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`;

// ============================================================================
// Dedicated Cube Projection Shader (extracted from premiumPack2Shader mode 3)
// ============================================================================
export const cubeProjectShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  mat2 rot2d(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;

    float cubeSize = 0.3 + uAmount * 0.5;
    float edgeGlow = uAmount2;
    float spinSpd = uAmount3 * 1.5;
    float manualRot = uAngle;

    vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    vec3 ro = vec3(0.0, 0.0, -2.5);
    vec3 rd = normalize(vec3(centered, 1.0));

    float angle = uTime * spinSpd + manualRot;
    float tilt = 0.4;

    rd.xz = rot2d(angle) * rd.xz;
    ro.xz = rot2d(angle) * ro.xz;
    rd.yz = rot2d(tilt) * rd.yz;
    ro.yz = rot2d(tilt) * ro.yz;

    // Ray-AABB intersection
    vec3 boxMin = vec3(-cubeSize);
    vec3 boxMax = vec3(cubeSize);
    vec3 invRd = 1.0 / rd;
    vec3 t1 = (boxMin - ro) * invRd;
    vec3 t2 = (boxMax - ro) * invRd;
    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);
    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar = min(min(tMax.x, tMax.y), tMax.z);

    if (tNear < tFar && tFar > 0.0) {
      float t = tNear > 0.0 ? tNear : tFar;
      vec3 hitPos = ro + rd * t;
      vec3 absHit = abs(hitPos);

      vec2 faceUV;
      vec3 normal;
      if (absHit.x > absHit.y - 0.001 && absHit.x > absHit.z - 0.001) {
        faceUV = hitPos.yz / cubeSize * 0.5 + 0.5;
        normal = vec3(sign(hitPos.x), 0.0, 0.0);
      } else if (absHit.y > absHit.z - 0.001) {
        faceUV = hitPos.xz / cubeSize * 0.5 + 0.5;
        normal = vec3(0.0, sign(hitPos.y), 0.0);
      } else {
        faceUV = hitPos.xy / cubeSize * 0.5 + 0.5;
        normal = vec3(0.0, 0.0, sign(hitPos.z));
      }

      vec3 texColor = texture2D(uTexture, clamp(faceUV, 0.0, 1.0)).rgb;
      vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
      float diff = max(dot(normal, lightDir), 0.0) * 0.7 + 0.3;
      vec3 lit = texColor * diff * uColor;

      vec2 edgeDist = 1.0 - abs(faceUV * 2.0 - 1.0);
      float edgeMin = min(edgeDist.x, edgeDist.y);
      float edge = smoothstep(0.02, 0.08, edgeMin);
      lit += vec3(1.0 - edge) * edgeGlow * uColor;

      outColor.rgb = lit;
    } else {
      outColor.rgb = src.rgb * 0.15;
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`;

// ============================================================================
// Cylinder Wrap — Wraps image around a rotating cylinder
// ============================================================================
export const cylinderWrapShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float radius = 0.2 + uAmount2 * 0.8;
    float spinSpeed = uAmount3 * 2.0;
    float perspective = 0.5 + uThreshold * 2.0;

    // Center UV
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    // Cylinder rotation angle
    float angle = uTime * spinSpeed;

    // Ray from camera
    vec3 ro = vec3(0.0, 0.0, -2.0 - perspective);
    vec3 rd = normalize(vec3(p, 2.0));

    // Cylinder along Y axis at origin
    // Ray-cylinder intersection: (ro.x + t*rd.x)^2 + (ro.z + t*rd.z)^2 = r^2
    float a = rd.x * rd.x + rd.z * rd.z;
    float b = 2.0 * (ro.x * rd.x + ro.z * rd.z);
    float c = ro.x * ro.x + ro.z * ro.z - radius * radius;
    float disc = b * b - 4.0 * a * c;

    vec3 col = src.rgb * 0.1;

    if (disc > 0.0) {
      float t = (-b - sqrt(disc)) / (2.0 * a);
      if (t > 0.0) {
        vec3 hit = ro + t * rd;

        // Check if within cylinder height
        if (abs(hit.y) < 1.0) {
          // Map to texture UV
          float theta = atan(hit.x, hit.z) + angle;
          float texU = fract(theta / TAU);
          float texV = hit.y * 0.5 + 0.5;

          vec3 texCol = texture2D(uTexture, vec2(texU, texV)).rgb;

          // Lighting
          vec3 normal = normalize(vec3(hit.x, 0.0, hit.z));
          vec3 lightDir = normalize(vec3(0.5, 0.7, -1.0));
          float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;

          // Specular
          vec3 viewDir = normalize(-rd);
          vec3 halfDir = normalize(lightDir + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.5;

          col = texCol * diff + vec3(spec);
        }
      }
    }

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Torus Tunnel — Camera flies through a torus donut hole
// ============================================================================
export const torusTunnelShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float sdTorus(vec3 p, float R, float r) {
    vec2 q = vec2(length(p.xz) - R, p.y);
    return length(q) - r;
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float tubeRadius = 0.3 + uAmount2 * 0.7;
    float flySpeed = uAmount3 * 1.5;
    float twist = uThreshold * 4.0;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float majorR = 1.5;
    float t = uTime * flySpeed;

    // Camera position on the ring path
    float camAngle = t;
    vec3 camPos = vec3(cos(camAngle) * majorR, 0.0, sin(camAngle) * majorR);

    // Camera forward tangent to ring
    vec3 camFwd = normalize(vec3(-sin(camAngle), 0.0, cos(camAngle)));
    vec3 camUp = vec3(0.0, 1.0, 0.0);
    vec3 camRight = normalize(cross(camFwd, camUp));
    camUp = cross(camRight, camFwd);

    // Apply twist
    float tw = t * twist;
    vec3 tRight = camRight * cos(tw) + camUp * sin(tw);
    vec3 tUp = -camRight * sin(tw) + camUp * cos(tw);

    vec3 rd = normalize(camFwd + p.x * tRight * 0.8 + p.y * tUp * 0.8);

    // Move camera slightly inside the tube
    camPos += camFwd * 0.01;

    // Raymarch the inner surface of the torus
    vec3 col = vec3(0.0);
    float totalDist = 0.0;
    bool hit = false;

    for (int i = 0; i < 60; i++) {
      vec3 pos = camPos + rd * totalDist;
      float d = -sdTorus(pos, majorR, tubeRadius);
      if (d < 0.002) {
        hit = true;
        break;
      }
      if (totalDist > 10.0) break;
      totalDist += max(d, 0.005);
    }

    if (hit) {
      vec3 hitPos = camPos + rd * totalDist;

      // Map hit to texture coordinates
      float ringAngle = atan(hitPos.z, hitPos.x);
      vec2 localP = vec2(length(hitPos.xz) - majorR, hitPos.y);
      float tubeAngle = atan(localP.y, localP.x);

      vec2 texUV = vec2(
        fract(ringAngle / TAU + 0.5),
        fract(tubeAngle / TAU + 0.5)
      );

      vec3 texCol = texture2D(uTexture, texUV).rgb;

      // Simple depth fog
      float fog = exp(-totalDist * 0.3);
      col = texCol * fog;

      // Subtle ambient
      col += vec3(0.02, 0.01, 0.03);
    }

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Diamond Gem — Faceted diamond with fake refraction highlights
// ============================================================================
export const diamondGemShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float facets = 4.0 + uAmount2 * 16.0;
    float rotSpeed = uAmount3 * 2.0;
    float sparkle = uThreshold;

    // Centered coords with aspect ratio
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * rotSpeed;

    // Diamond shape using analytical geometry (no raymarching)
    // Rotate the 2D point to spin the diamond
    float ca = cos(t), sa = sin(t);
    vec2 rp = vec2(p.x * ca - p.y * sa * 0.3, p.x * sa * 0.3 + p.y * ca);

    // Diamond silhouette: top and bottom cones
    float ax = abs(rp.x);
    float topHalf = step(rp.y, 0.0);   // 1.0 if in top half (y<0 = bottom of diamond)
    float botHalf = 1.0 - topHalf;

    // Diamond outline: narrower at top, wider at equator, pointed at bottom
    float topWidth = 0.6;   // half-width at crown
    float equatorY = -0.15; // equator position
    float crownY = -0.55;   // top of diamond
    float pointY = 0.75;    // bottom point

    // Compute diamond boundary
    float diamondDist = 1.0;
    // Above equator (crown facets)
    float tCrown = clamp((rp.y - equatorY) / (crownY - equatorY), 0.0, 1.0);
    float crownWidth = mix(topWidth, topWidth * 0.7, tCrown);
    // Below equator (pavilion - tapers to point)
    float tPav = clamp((rp.y - equatorY) / (pointY - equatorY), 0.0, 1.0);
    float pavWidth = mix(topWidth, 0.0, tPav);

    float halfWidth = mix(pavWidth, crownWidth, step(rp.y, equatorY));
    float inDiamond = step(ax, halfWidth) * step(crownY, rp.y) * step(rp.y, pointY);

    // Faceted normal based on quantized angle
    float angle = atan(rp.y - equatorY, rp.x);
    float qAngle = floor(angle * facets / TAU + 0.5) * TAU / facets;
    vec2 facetN2 = vec2(cos(qAngle), sin(qAngle));
    vec3 facetNormal = normalize(vec3(facetN2.x, facetN2.y, 0.6));

    // Texture sampling through refraction (always compute, use outside branches)
    vec3 refDir = vec3(facetN2 * 0.4, 1.0);
    vec2 texUV = uv + refDir.xy * 0.15;
    vec3 texCol = texture2D(uTexture, clamp(texUV, 0.0, 1.0)).rgb;

    // Also sample with different offsets for RGB dispersion
    vec3 texR = texture2D(uTexture, clamp(uv + refDir.xy * 0.20, 0.0, 1.0)).rgb;
    vec3 texB = texture2D(uTexture, clamp(uv + refDir.xy * 0.10, 0.0, 1.0)).rgb;
    vec3 dispersed = vec3(texR.r, texCol.g, texB.b);

    // Lighting
    vec3 lightDir = normalize(vec3(0.5, -0.8, 1.0));
    float diff = max(dot(facetNormal, lightDir), 0.0);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfV = normalize(lightDir + viewDir);
    float spec = pow(max(dot(facetNormal, halfV), 0.0), 80.0);

    // Fresnel
    float fresnel = pow(1.0 - max(dot(viewDir, facetNormal), 0.0), 3.0);

    // Rainbow caustics
    float causticAngle = angle + t * 0.5;
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (causticAngle / TAU + vec3(0.0, 0.33, 0.67)));

    // Compose diamond
    vec3 gemCol = dispersed * (diff * 0.6 + 0.4);
    gemCol += rainbow * fresnel * 0.4;
    gemCol += vec3(spec) * sparkle * 3.0;
    gemCol += rainbow * spec * sparkle * 0.5;

    // Edge highlight
    float edgeDist = abs(ax - halfWidth * 0.97);
    float edge = smoothstep(0.02, 0.0, edgeDist) * inDiamond;
    gemCol += vec3(0.8, 0.85, 1.0) * edge * 0.5;

    // Mix with background
    vec3 col = mix(src.rgb * 0.15, gemCol, inDiamond);
    col = mix(src.rgb, col, blend);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Shatter 3D — Image fractures into triangular shards that explode/reassemble
// ============================================================================
export const shatter3DShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float force = uAmount * 2.0;
    float shardSize = mix(4.0, 20.0, uAmount2);
    float speed = 0.5 + uAmount3 * 2.0;
    float gravity = uThreshold * 0.5;

    // Oscillating explosion factor (0 = assembled, 1 = exploded)
    float phase = sin(uTime * speed) * 0.5 + 0.5;
    float explode = phase * force;

    // Voronoi-based shard pattern
    vec2 cellSize = vec2(shardSize) / uResolution;
    vec2 cellId = floor(uv / cellSize);
    vec2 cellUv = fract(uv / cellSize);

    // Find closest Voronoi center for shard identity
    float minDist = 10.0;
    vec2 closestId = cellId;
    vec2 closestCenter = vec2(0.5);

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = cellId + vec2(float(x), float(y));
        vec2 point = hash2(neighbor);
        vec2 diff = neighbor + point - uv / cellSize;
        float d = dot(diff, diff);
        if (d < minDist) {
          minDist = d;
          closestId = neighbor;
          closestCenter = neighbor + point;
        }
      }
    }

    // Shard properties based on ID
    vec2 shardHash = hash2(closestId);
    float shardAngle = shardHash.x * TAU;
    float shardDelay = shardHash.y * 0.5;

    // Offset for this shard
    float localExplode = max(explode - shardDelay, 0.0);
    vec2 dir = normalize(closestCenter * cellSize - vec2(0.5));
    vec2 offset = dir * localExplode * 0.3;
    offset.y -= gravity * localExplode * localExplode; // gravity pull

    // Rotation per shard
    float rot = localExplode * shardAngle * 2.0;
    vec2 center = closestCenter * cellSize;
    vec2 rotUv = uv - center;
    float cs = cos(rot), sn = sin(rot);
    rotUv = vec2(rotUv.x * cs - rotUv.y * sn, rotUv.x * sn + rotUv.y * cs);
    rotUv += center;

    vec2 sampleUv = rotUv - offset;

    // Edge detection for shard borders
    float edge = smoothstep(0.01, 0.03, sqrt(minDist));

    // Depth shading based on explode
    float depth = 1.0 - localExplode * 0.3;

    vec3 col = texture2D(uTexture, clamp(sampleUv, 0.0, 1.0)).rgb;
    col *= depth;
    col *= edge; // Darken edges

    // Shard edge highlight
    float edgeHighlight = 1.0 - smoothstep(0.02, 0.06, sqrt(minDist));
    col += edgeHighlight * vec3(0.3) * localExplode;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Mobius Strip — Texture mapped on a Mobius strip (twisted band)
// ============================================================================
export const mobiusStripShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float stripW = 0.1 + uAmount2 * 0.5;
    float rotSpeed = uAmount3 * 1.5;
    float twistAmt = 1.0 + uThreshold * 4.0;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * rotSpeed;

    // Camera setup
    vec3 ro = vec3(0.0, 1.2, -3.0);
    vec3 target = vec3(0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + p.x * right + p.y * up);

    // Brute-force closest point on Mobius strip
    float minDist = 100.0;
    float bestU = 0.0;
    float bestV = 0.0;

    for (int i = 0; i < 64; i++) {
      float u = float(i) / 64.0 * TAU;
      for (int j = 0; j < 8; j++) {
        float v = float(j) / 7.0 * 2.0 - 1.0;

        float halfTwist = u * twistAmt * 0.5;
        float R = 1.2;
        vec3 mp = vec3(
          (R + v * stripW * cos(halfTwist)) * cos(u + t),
          v * stripW * sin(halfTwist),
          (R + v * stripW * cos(halfTwist)) * sin(u + t)
        );

        // Project onto ray and check distance
        vec3 diff = mp - ro;
        float along = dot(diff, rd);
        if (along > 0.0) {
          vec3 closest = ro + rd * along;
          float d = length(mp - closest);
          if (d < minDist) {
            minDist = d;
            bestU = u;
            bestV = v;
          }
        }
      }
    }

    vec3 col = src.rgb * 0.08;

    if (minDist < 0.08) {
      vec2 texUV = vec2(fract(bestU / TAU), bestV * 0.5 + 0.5);
      vec3 texCol = texture2D(uTexture, texUV).rgb;

      // Shading based on proximity
      float shade = smoothstep(0.08, 0.01, minDist);

      // Simple lighting approximation
      float light = 0.5 + 0.5 * sin(bestU * 2.0 + t);
      texCol *= (0.6 + 0.4 * light);

      col = texCol * shade;
    }

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Voxel Displace — Raymarched 3D voxel grid, brightness = height
// ============================================================================
export const voxelDisplaceShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float depthScale = 0.3 + uAmount * 1.5;
    float gridRes = floor(mix(6.0, 32.0, uAmount2));
    float rotAngle = uTime * uAmount3 * 0.8;
    float gap = uThreshold * 0.3;

    // Isometric-style projection: tilt the grid
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    // Apply rotation
    float ca = cos(rotAngle), sa = sin(rotAngle);
    vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);

    // Isometric tilt: compress Y to simulate looking down at an angle
    float tiltAngle = 0.65; // ~37 degrees
    vec2 isoP = vec2(rp.x, rp.y / tiltAngle);

    // Map to grid coordinates
    vec2 gridUV = isoP * 0.5 + 0.5;

    // Quantize to voxel grid
    vec2 voxelID = floor(gridUV * gridRes);
    vec2 cellUV = fract(gridUV * gridRes); // position within cell 0..1

    // Texture coordinate for this voxel
    vec2 texCoord = (voxelID + 0.5) / gridRes;

    // Sample texture (always, outside any branches)
    vec3 texCol = texture2D(uTexture, clamp(texCoord, 0.0, 1.0)).rgb;
    float height = luma(texCol) * depthScale;

    // Check if we're inside the grid
    vec3 col = vec3(0.02, 0.02, 0.04);

    float inGrid = step(0.0, gridUV.x) * step(gridUV.x, 1.0) * step(0.0, gridUV.y) * step(gridUV.y, 1.0);

    // Gap between voxels
    float halfGap = gap * 0.5;
    float inCell = step(halfGap, cellUV.x) * step(cellUV.x, 1.0 - halfGap) *
                   step(halfGap, cellUV.y) * step(cellUV.y, 1.0 - halfGap);

    // Simulate 3D block: the cell's vertical offset shifts it up
    // The "side" of the block is visible when neighboring cells are shorter
    // We fake the 3D look by using height to shift the cell and color the faces

    // Top face color (lit from above-left)
    vec3 topCol = texCol * 1.1;

    // Side faces: check neighbors for depth
    vec2 leftTexCoord = (voxelID + vec2(-0.5, 0.5)) / gridRes;
    vec2 frontTexCoord = (voxelID + vec2(0.5, 1.5)) / gridRes;
    vec3 leftTex = texture2D(uTexture, clamp(leftTexCoord, 0.0, 1.0)).rgb;
    vec3 frontTex = texture2D(uTexture, clamp(frontTexCoord, 0.0, 1.0)).rgb;
    float leftH = luma(leftTex) * depthScale;
    float frontH = luma(frontTex) * depthScale;

    // Height difference creates visible side faces
    float sideExposureX = max(height - leftH, 0.0);
    float sideExposureY = max(height - frontH, 0.0);

    // Isometric pixel offset based on height
    float pixelH = height * 0.15;

    // Determine which face we're seeing
    // The "top" of the voxel block
    float topFace = inCell;

    // Right-side face (visible when left neighbor is shorter)
    float rightSide = step(0.0, sideExposureX) * step(cellUV.x, halfGap * 3.0) * (1.0 - step(halfGap, cellUV.x));
    // Front face (visible when front neighbor is shorter)
    float frontSide = step(0.0, sideExposureY) * step(1.0 - halfGap * 3.0, cellUV.y) * step(cellUV.y, 1.0);

    // Light direction simulation
    vec3 rightCol = texCol * 0.6;  // darker side
    vec3 frontCol = texCol * 0.4;  // darkest side

    // Compose the voxel
    vec3 voxelCol = topCol * topFace + rightCol * rightSide + frontCol * frontSide;

    // Apply height as vertical UV offset for parallax effect
    vec2 shiftedUV = uv + vec2(0.0, pixelH);
    vec3 shiftedSrc = texture2D(uTexture, clamp(shiftedUV, 0.0, 1.0)).rgb;

    // Final: blend voxelized look with height-shifted source
    float showVoxel = inGrid * max(topFace, max(rightSide, frontSide));
    col = mix(vec3(0.02), voxelCol, showVoxel);

    // Add subtle ambient occlusion at gaps
    float ao = smoothstep(0.0, halfGap * 2.0, min(cellUV.x, min(cellUV.y, min(1.0 - cellUV.x, 1.0 - cellUV.y))));
    col *= mix(0.7, 1.0, ao);

    // Add height-based shadow
    col *= 0.6 + height * 0.6;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Wave Surface — Image on animated ocean wave surface with lighting
// ============================================================================
export const waveSurfaceShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float waveHeight(vec2 p, float t, float amp, float freq) {
    float h = 0.0;
    h += sin(p.x * freq + t * 1.3) * 0.5;
    h += sin(p.y * freq * 0.7 + t * 0.9) * 0.3;
    h += sin((p.x + p.y) * freq * 0.5 + t * 1.7) * 0.2;
    h += sin((p.x - p.y) * freq * 0.8 + t * 2.1) * 0.15;
    h += sin(p.x * freq * 2.0 + p.y * freq * 1.5 + t * 2.5) * 0.1;
    return h * amp;
  }

  vec3 waveNormal(vec2 p, float t, float amp, float freq) {
    float eps = 0.01;
    float hL = waveHeight(p - vec2(eps, 0.0), t, amp, freq);
    float hR = waveHeight(p + vec2(eps, 0.0), t, amp, freq);
    float hD = waveHeight(p - vec2(0.0, eps), t, amp, freq);
    float hU = waveHeight(p + vec2(0.0, eps), t, amp, freq);
    return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float amp = 0.05 + uAmount * 0.3;
    float freq = 2.0 + uAmount2 * 10.0;
    float speed = 0.5 + uAmount3 * 3.0;
    float specular = uThreshold;

    float t = uTime * speed;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    // Camera looking down at the wave surface
    vec3 ro = vec3(0.0, 2.0, -1.5);
    vec3 rd = normalize(vec3(p.x, -1.2, p.y + 0.5));

    // Intersect with approximate plane y = 0
    float tPlane = -ro.y / rd.y;
    vec3 col = vec3(0.01, 0.02, 0.05);

    if (tPlane > 0.0) {
      vec3 hitPos = ro + rd * tPlane;
      vec2 surfaceUv = hitPos.xz;

      // Wave displacement
      float h = waveHeight(surfaceUv, t, amp, freq);
      vec3 normal = waveNormal(surfaceUv, t, amp, freq);

      // Refracted texture lookup
      vec3 refr = refract(rd, normal, 0.75);
      vec2 texUV = surfaceUv * 0.3 + 0.5 + refr.xz * 0.1;
      texUV = fract(texUV);

      vec3 texCol = texture2D(uTexture, texUV).rgb;

      // Lighting
      vec3 lightDir = normalize(vec3(0.3, 1.0, -0.5));
      float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;

      // Specular
      vec3 viewDir = normalize(-rd);
      vec3 reflDir = reflect(-lightDir, normal);
      float spec = pow(max(dot(viewDir, reflDir), 0.0), 32.0) * specular;

      // Fresnel
      float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0) * 0.3;

      col = texCol * diff + vec3(0.4, 0.6, 0.9) * fresnel + vec3(spec);

      // Depth fog
      float fog = exp(-tPlane * 0.15);
      col *= fog;
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Prism Split — RGB chromatic dispersion through a triangular prism
// ============================================================================
export const prismSplitShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  // Signed distance to a triangle prism cross-section (2D)
  float sdTriangle(vec2 p, float r) {
    float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float separation = uAmount * 0.15;
    float prismAngle = uAmount2 * PI;
    float rotation = uAmount3 * TAU;
    float tintIntensity = uThreshold;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime;

    // Rotate space
    p = rot2(rotation + t * 0.3) * p;

    // Prism shape
    float prismSize = 0.4 + prismAngle * 0.3;
    float dist = sdTriangle(p, prismSize);

    // Amount of refraction based on distance to prism
    float inPrism = smoothstep(0.02, -0.02, dist);

    // Each color channel gets a different refraction angle
    float baseAngle = atan(p.y, p.x);
    float baseDist = length(p);

    // Chromatic separation offsets
    vec2 redOffset = vec2(cos(baseAngle - separation), sin(baseAngle - separation)) * separation * baseDist;
    vec2 greenOffset = vec2(0.0);
    vec2 blueOffset = vec2(cos(baseAngle + separation), sin(baseAngle + separation)) * separation * baseDist;

    // Scale up separation when inside prism
    redOffset *= (1.0 + inPrism * 4.0);
    blueOffset *= (1.0 + inPrism * 4.0);

    // Sample each channel with offset
    float r = texture2D(uTexture, uv + redOffset).r;
    float g = texture2D(uTexture, uv + greenOffset).g;
    float b = texture2D(uTexture, uv + blueOffset).b;

    vec3 col = vec3(r, g, b);

    // Glass tint from prism
    vec3 tint = mix(vec3(1.0), uColor, tintIntensity * inPrism);
    col *= tint;

    // Edge highlight (caustic-like on prism edges)
    float edgeGlow = smoothstep(0.05, 0.0, abs(dist)) * 0.6;
    // Rainbow on edge
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (baseAngle / TAU + vec3(0.0, 0.33, 0.67)));
    col += rainbow * edgeGlow * separation * 5.0;

    // Subtle prism surface reflection
    float highlight = pow(max(1.0 - abs(dist) * 5.0, 0.0), 8.0) * 0.2;
    col += vec3(highlight);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Origami Fold — Paper-fold creases with 3D depth shading
// ============================================================================
export const origamiFoldShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float foldDepth = 0.1 + uAmount * 0.9;
    float foldCount = 2.0 + floor(uAmount2 * 10.0);
    float speed = 0.5 + uAmount3 * 2.0;
    float creaseSharpen = 2.0 + uThreshold * 20.0;

    float t = uTime * speed;

    // Animated fold intensity
    float foldAnim = (sin(t) * 0.5 + 0.5) * foldDepth;

    // Horizontal folds
    float hFold = uv.y * foldCount;
    float hFoldId = floor(hFold);
    float hFoldFrac = fract(hFold);

    // Vertical folds
    float vFold = uv.x * foldCount;
    float vFoldId = floor(vFold);
    float vFoldFrac = fract(vFold);

    // Triangle fold: fold direction alternates
    float hDir = mod(hFoldId, 2.0) * 2.0 - 1.0;
    float vDir = mod(vFoldId, 2.0) * 2.0 - 1.0;

    // Fold angle — creates a V shape within each strip
    float hAngle = (hFoldFrac - 0.5) * 2.0 * hDir;
    float vAngle = (vFoldFrac - 0.5) * 2.0 * vDir;

    // Combined fold normal (simplified 3D fold)
    float foldNormalZ = cos(hAngle * foldAnim * PI * 0.5) * cos(vAngle * foldAnim * PI * 0.5);
    float foldNormalX = sin(vAngle * foldAnim * PI * 0.5) * 0.5;
    float foldNormalY = sin(hAngle * foldAnim * PI * 0.5) * 0.5;
    vec3 normal = normalize(vec3(foldNormalX, foldNormalY, foldNormalZ));

    // Lighting
    vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
    float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;

    // Specular for paper sheen
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 16.0) * 0.3;

    // UV displacement from fold
    vec2 dispUv = uv;
    dispUv.x += foldNormalX * foldAnim * 0.02;
    dispUv.y += foldNormalY * foldAnim * 0.02;

    vec3 texCol = texture2D(uTexture, clamp(dispUv, 0.0, 1.0)).rgb;

    // Crease darkening
    float hCrease = pow(abs(hFoldFrac - 0.5) * 2.0, creaseSharpen);
    float vCrease = pow(abs(vFoldFrac - 0.5) * 2.0, creaseSharpen);
    float crease = min(hCrease, vCrease);
    float creaseDark = mix(0.6, 1.0, crease);

    // Shadow on folded parts
    float shadow = mix(1.0, foldNormalZ, foldAnim);

    vec3 col = texCol * diff * creaseDark * shadow + vec3(spec) * foldAnim;

    // Paper edge highlight at creases
    float edgeDist = min(abs(hFoldFrac - 0.5), abs(vFoldFrac - 0.5));
    float edgeLine = smoothstep(0.02, 0.0, edgeDist) * foldAnim * 0.4;
    col += vec3(edgeLine);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Mirror Room — Infinite mirrored box with camera inside
// ============================================================================
export const mirrorRoomShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float roomSize = 0.5 + uAmount2 * 2.0;
    float camSpeed = uAmount3 * 0.5;
    float reflFade = 0.3 + uThreshold * 0.65;

    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime;

    // Camera inside the box, gently moving
    vec3 ro = vec3(
      sin(t * camSpeed * 0.7) * roomSize * 0.3,
      sin(t * camSpeed * 0.5) * roomSize * 0.2,
      cos(t * camSpeed * 0.6) * roomSize * 0.3
    );

    // Look direction slowly rotating
    float lookAngle = t * camSpeed * 0.4;
    vec3 lookDir = vec3(cos(lookAngle), sin(t * camSpeed * 0.2) * 0.3, sin(lookAngle));
    vec3 fwd = normalize(lookDir);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + p.x * right * 0.8 + p.y * up * 0.8);

    // Box bounds
    vec3 boxMin = vec3(-roomSize);
    vec3 boxMax = vec3(roomSize);

    vec3 col = vec3(0.0);
    float energy = 1.0;

    vec3 rayPos = ro;
    vec3 rayDir = rd;

    // Bounce reflections
    for (int bounce = 0; bounce < 8; bounce++) {
      // Ray-box intersection (from inside)
      vec3 tMin = (boxMin - rayPos) / rayDir;
      vec3 tMax = (boxMax - rayPos) / rayDir;
      vec3 t1 = min(tMin, tMax);
      vec3 t2 = max(tMin, tMax);

      float tFar = min(min(t2.x, t2.y), t2.z);

      // We want the first positive intersection
      float hitT = tFar;
      if (hitT < 0.001) hitT = 0.001;

      // Find which face we hit
      vec3 hitPos = rayPos + rayDir * hitT;
      vec3 absHit = abs(hitPos);
      vec3 normal;
      vec2 faceUV;

      if (absHit.x >= absHit.y - 0.001 && absHit.x >= absHit.z - 0.001) {
        normal = vec3(-sign(rayDir.x), 0.0, 0.0);
        faceUV = hitPos.yz / roomSize * 0.5 + 0.5;
      } else if (absHit.y >= absHit.z - 0.001) {
        normal = vec3(0.0, -sign(rayDir.y), 0.0);
        faceUV = hitPos.xz / roomSize * 0.5 + 0.5;
      } else {
        normal = vec3(0.0, 0.0, -sign(rayDir.z));
        faceUV = hitPos.xy / roomSize * 0.5 + 0.5;
      }

      // Sample texture on this wall
      vec3 texCol = texture2D(uTexture, clamp(faceUV, 0.0, 1.0)).rgb;

      // Add contribution
      col += texCol * energy * 0.35;

      // Fade energy per bounce
      energy *= reflFade;
      if (energy < 0.01) break;

      // Reflect
      rayPos = hitPos + normal * 0.01;
      rayDir = reflect(rayDir, normal);
    }

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Hex Grid — Honeycomb hexagonal tiles that pop/rotate with depth lighting
// ============================================================================
export const hexGridShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718
  #define SQRT3 1.7320508

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float tileSize = mix(4.0, 20.0, uAmount2);
    float popSpeed = uAmount3 * 3.0;
    float gapSize = uThreshold * 0.15;

    // Hex grid math
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 p = uv * aspect * tileSize;

    // Two candidate hex centers (offset rows)
    vec2 a = mod(p, vec2(1.0, SQRT3)) - vec2(0.5, SQRT3 * 0.5);
    vec2 b = mod(p - vec2(0.5, SQRT3 * 0.5), vec2(1.0, SQRT3)) - vec2(0.5, SQRT3 * 0.5);

    // Pick the closer hex center
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 hexId = floor(p - gv + 0.5);

    // Distance to hex edge (approximate with max of 3 axis distances)
    float dx = abs(gv.x);
    float dy = abs(gv.y);
    float hexDist = max(dx, (dx * 0.5 + dy * SQRT3 * 0.5));
    float hexEdge = 0.5 - gapSize;
    float inHex = smoothstep(hexEdge + 0.01, hexEdge - 0.01, hexDist);

    // Per-hex animation
    float rnd = hash21(hexId);
    float phase = rnd * TAU;
    float pop = sin(uTime * popSpeed + phase) * 0.5 + 0.5;

    // Hex-local UV for texture sampling
    vec2 hexUV = (hexId / tileSize) / aspect;
    vec2 localOffset = gv / tileSize / aspect;

    // Slight rotation per hex
    float rotA = sin(uTime * popSpeed * 0.5 + phase) * 0.3 * uAmount3;
    float cr = cos(rotA), sr = sin(rotA);
    vec2 rotOffset = vec2(localOffset.x * cr - localOffset.y * sr,
                          localOffset.x * sr + localOffset.y * cr);

    vec2 texCoord = clamp(hexUV + rotOffset, 0.0, 1.0);
    vec3 texCol = texture2D(uTexture, texCoord).rgb;

    // Lighting: raised hexes are brighter
    float lighting = 0.6 + pop * 0.5;

    // Edge highlight
    float edgeGlow = smoothstep(hexEdge, hexEdge - 0.06, hexDist) -
                     smoothstep(hexEdge - 0.06, hexEdge - 0.12, hexDist);

    vec3 col = texCol * lighting * inHex;
    col += vec3(0.4, 0.5, 0.7) * edgeGlow * 0.3 * pop;

    // Dark background in gaps
    col = mix(vec3(0.01), col, inHex);

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Spiral Tiles — Logarithmic spiral sectors with animated spin
// ============================================================================
export const spiralTileShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float arms = floor(3.0 + uAmount2 * 9.0);
    float spinSpeed = uAmount3 * 2.0;
    float gap = uThreshold * 0.08;

    vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float r = length(centered);
    float a = atan(centered.y, centered.x);

    // Logarithmic spiral: angle depends on log of radius
    float spiralTwist = 3.0;
    float spiralA = a + log(max(r, 0.001)) * spiralTwist - uTime * spinSpeed;

    // Divide into sectors
    float sectorAngle = TAU / arms;
    float sectorId = floor(spiralA / sectorAngle);
    float sectorFrac = fract(spiralA / sectorAngle);

    // Radial rings
    float ringCount = 6.0 + uAmount2 * 10.0;
    float ringId = floor(r * ringCount);
    float ringFrac = fract(r * ringCount);

    // Combined tile ID
    float tileId = sectorId * 100.0 + ringId;
    float rnd = hash11(tileId);

    // Gaps
    float sectorGap = smoothstep(0.0, gap, sectorFrac) * smoothstep(1.0, 1.0 - gap, sectorFrac);
    float ringGap = smoothstep(0.0, gap * 2.0, ringFrac) * smoothstep(1.0, 1.0 - gap * 2.0, ringFrac);
    float inTile = sectorGap * ringGap;

    // Per-tile animation
    float tilePhase = rnd * TAU;
    float tileFlip = sin(uTime * spinSpeed * 1.5 + tilePhase);

    // Map tile center back to source UV
    float centerA = (sectorId + 0.5) * sectorAngle - log(max(r, 0.001)) * spiralTwist + uTime * spinSpeed;
    float centerR = (ringId + 0.5) / ringCount;
    vec2 tileCenterUV = vec2(cos(centerA), sin(centerA)) * centerR;
    tileCenterUV.x /= uResolution.x / uResolution.y;
    vec2 texCoord = clamp(tileCenterUV + 0.5, 0.0, 1.0);

    vec3 texCol = texture2D(uTexture, texCoord).rgb;

    // Perspective flip effect
    float lighting = 0.5 + 0.5 * abs(cos(tileFlip * PI * 0.5));

    vec3 col = texCol * lighting * inTile;
    col = mix(vec3(0.015), col, inTile);

    // Radial fade at center and edges
    float radialFade = smoothstep(0.0, 0.05, r) * smoothstep(1.2, 0.8, r);
    col *= radialFade;

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Shingle Stack — Overlapping tiles with parallax depth like roof shingles
// ============================================================================
export const shingleStackShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float tileCount = floor(mix(3.0, 14.0, uAmount2));
    float slideSpeed = uAmount3 * 2.0;
    float overlap = 0.2 + uThreshold * 0.4;

    // Grid with row offsets (brick pattern)
    vec2 scaled = uv * tileCount;
    float row = floor(scaled.y);
    float rowOffset = mod(row, 2.0) * 0.5;
    scaled.x += rowOffset;

    vec2 tileId = floor(scaled);
    vec2 tileFrac = fract(scaled);

    // Per-tile random values
    float rnd = hash21(tileId);
    float rnd2 = hash21(tileId + 100.0);

    // Animated shingle lift
    float liftPhase = rnd * TAU + uTime * slideSpeed;
    float lift = sin(liftPhase) * 0.5 + 0.5;

    // Parallax offset
    float parallaxAmount = lift * overlap * 0.3;
    vec2 parallaxOffset = vec2(
      (rnd2 - 0.5) * parallaxAmount,
      -parallaxAmount * 0.5
    );

    // Tile source UV
    vec2 tileUV = (tileId - vec2(rowOffset, 0.0) + tileFrac) / tileCount;
    vec2 texCoord = clamp(tileUV + parallaxOffset, 0.0, 1.0);
    vec3 texCol = texture2D(uTexture, texCoord).rgb;

    // Shadows
    float shadowFromAbove = smoothstep(overlap, 0.0, tileFrac.y) * 0.4;
    float shadowFromSide = smoothstep(overlap * 0.5, 0.0, tileFrac.x) * 0.2;

    // Lighting based on lift
    float lighting = 0.5 + lift * 0.5;

    // Edge bevel
    float edgeX = min(tileFrac.x, 1.0 - tileFrac.x);
    float edgeY = min(tileFrac.y, 1.0 - tileFrac.y);
    float bevel = smoothstep(0.0, 0.08, min(edgeX, edgeY));
    float edgeHighlight = (1.0 - bevel) * lift * 0.3;

    vec3 col = texCol * lighting;
    col *= (1.0 - shadowFromAbove - shadowFromSide);
    col += vec3(edgeHighlight);
    col *= bevel * 0.3 + 0.7;

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// Voronoi Shatter — Organic cell fragmentation with random drift
// ============================================================================
export const voronoiShatterShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);

    float blend = uAmount;
    float cellCount = mix(4.0, 24.0, uAmount2);
    float driftSpeed = uAmount3 * 1.5;
    float gap = uThreshold * 0.06;

    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 p = uv * aspect * cellCount;

    // Find nearest Voronoi cell
    float minDist = 10.0;
    float secondDist = 10.0;
    vec2 nearestId = vec2(0.0);
    vec2 nearestPoint = vec2(0.0);

    // Check 3x3 neighborhood
    vec2 ip = floor(p);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = ip + vec2(float(x), float(y));
        vec2 rnd = hash22(neighbor);

        // Animate cell centers
        vec2 cellPoint = neighbor + 0.5 + 0.35 * sin(uTime * driftSpeed + rnd * TAU);

        float d = length(p - cellPoint);
        if (d < minDist) {
          secondDist = minDist;
          minDist = d;
          nearestId = neighbor;
          nearestPoint = cellPoint;
        } else if (d < secondDist) {
          secondDist = d;
        }
      }
    }

    // Edge detection
    float edgeDist = secondDist - minDist;
    float edge = smoothstep(gap, gap + 0.04, edgeDist);

    // Map cell center to texture UV
    vec2 cellUV = nearestPoint / cellCount / aspect;

    // Per-cell rotation
    vec2 cellRnd = hash22(nearestId);
    float cellAngle = sin(uTime * driftSpeed * 0.7 + cellRnd.x * TAU) * 0.2;
    float cca = cos(cellAngle), csa = sin(cellAngle);

    // Local offset with rotation
    vec2 localP = (p - nearestPoint) / cellCount / aspect;
    vec2 rotLocal = vec2(localP.x * cca - localP.y * csa,
                         localP.x * csa + localP.y * cca);

    vec2 texCoord = clamp(cellUV + rotLocal, 0.0, 1.0);
    vec3 texCol = texture2D(uTexture, texCoord).rgb;

    // Depth lighting
    float depth = cellRnd.y;
    float lighting = 0.6 + depth * 0.4;
    float shadowSide = (nearestPoint.x - p.x) * 0.2;
    lighting += shadowSide;

    vec3 col = texCol * lighting * edge;

    // Edge highlight
    float edgeHighlight = smoothstep(gap + 0.06, gap + 0.01, edgeDist) * edge;
    col += vec3(0.3, 0.35, 0.5) * edgeHighlight * 0.4;

    col = mix(vec3(0.01), col, edge);

    col = mix(src.rgb, col, blend);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
  }
`;
