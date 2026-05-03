// Premium Pack 2 Shader - remaining 3D, depth, feedback, warp, and trail effects

export const premiumPack2Shader = `
  precision highp float;
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
  float hash1(float n) { return fract(sin(n) * 43758.5453); }

  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i); float b = hash(i + vec2(1,0));
    float c = hash(i + vec2(0,1)); float d = hash(i + vec2(1,1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p); p = rot * p * 2.0; a *= 0.5;
    }
    return v;
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p2 = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p2.xyw, c.r), vec4(c.r, p2.yzx), step(p2.x, c.r));
    float d2 = q.x - min(q.w, q.y); float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d2 + e)), d2 / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p2 = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p2 - K.xxx, 0.0, 1.0), c.y);
  }

  mat2 rot2d(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;
    int mode = int(uMode + 0.5);

    // ── Mode 0: Explode 3D ──
    if (mode == 0) {
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

      for (int ox = -1; ox <= 1; ox++) {
        for (int oy = -1; oy <= 1; oy++) {
          vec2 cellId = floor(uv * cellCount) + vec2(float(ox), float(oy));
          if (cellId.x < 0.0 || cellId.y < 0.0 || cellId.x >= cellCount.x || cellId.y >= cellCount.y) continue;

          vec2 cellCenter = (cellId + 0.5) * cellSize;
          vec4 cellColor = texture2D(uTexture, cellCenter);

          float rnd1 = hash(cellId);
          float rnd2 = hash(cellId + 137.0);
          float rnd3 = hash(cellId + 271.0);

          // Map cell position to 3D point on shape surface
          float theta = cellCenter.x * TAU;
          float phi = cellCenter.y * PI;
          vec3 shapePos;
          if (shapeId < 1.0) { // Sphere
            shapePos = vec3(sin(phi)*cos(theta), cos(phi), sin(phi)*sin(theta));
          } else if (shapeId < 2.0) { // Cube
            float face = floor(rnd1 * 6.0);
            vec3 p = vec3(cellCenter.x * 2.0 - 1.0, cellCenter.y * 2.0 - 1.0, 1.0);
            if (face < 1.0) shapePos = p;
            else if (face < 2.0) shapePos = vec3(-p.z, p.y, p.x);
            else if (face < 3.0) shapePos = vec3(p.z, p.y, -p.x);
            else if (face < 4.0) shapePos = vec3(p.x, p.z, -p.y);
            else if (face < 5.0) shapePos = vec3(p.x, -p.z, p.y);
            else shapePos = vec3(p.x, p.y, -p.z);
            shapePos = normalize(shapePos);
          } else if (shapeId < 3.0) { // Pyramid
            float h = cellCenter.y;
            float r = (1.0 - h) * 0.8;
            float a = cellCenter.x * TAU;
            float sides = floor(a / (TAU/4.0)) * (TAU/4.0) + TAU/8.0;
            shapePos = vec3(cos(sides)*r, h*2.0-1.0, sin(sides)*r);
          } else if (shapeId < 4.0) { // Torus
            float R = 0.7, r2 = 0.3;
            shapePos = vec3((R + r2*cos(phi))*cos(theta), r2*sin(phi), (R + r2*cos(phi))*sin(theta));
          } else if (shapeId < 5.0) { // Cylinder
            float r2 = 0.6;
            shapePos = vec3(r2*cos(theta), cellCenter.y*2.0-1.0, r2*sin(theta));
          } else { // Helix
            float t = cellCenter.y * 4.0 * PI;
            float r2 = 0.5;
            shapePos = vec3(r2*cos(t + theta), cellCenter.y*2.0-1.0, r2*sin(t + theta));
          }

          // Rotate shape
          float ca = cos(camAngle), sa = sin(camAngle);
          shapePos = vec3(shapePos.x*ca - shapePos.z*sa, shapePos.y, shapePos.x*sa + shapePos.z*ca);

          // Scatter away from shape
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
            // Lighting
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
        outColor.rgb = mix(src.rgb * (1.0 - scatter * 0.5), finalColor, clamp(totalWeight, 0.0, 1.0));
      } else {
        outColor.rgb = src.rgb * (1.0 - scatter * 0.5);
      }
    }

    // ── Mode 1: Terrain 3D (with full X/Y/Z camera rotation) ──
    else if (mode == 1) {
      float heightScale = uAmount * 0.4;
      float camHeight = 0.15 + uAmount2 * 0.5;
      float speed = uAmount3 * 0.5;
      float fogDensity = uThreshold * 3.0;
      float camYaw = uAngle;                    // Y rotation (horizontal)
      float camPitch = uCenter.x * PI * 0.5;    // X rotation: 0=horizon, 1=straight down
      float camRoll = uCenter.y * TAU;           // Z rotation: 0-1 maps to full 360
      vec3 fogColor = uColor;

      vec2 forward = vec2(cos(camYaw), sin(camYaw));
      vec2 camPos2D = forward * uTime * speed;

      vec3 color = vec3(0.0);
      float maxDist = 3.0;

      // Raycast through each pixel column
      vec2 screenPos = uv * 2.0 - 1.0;
      screenPos.x *= uResolution.x / uResolution.y;

      vec3 ro = vec3(camPos2D.x, camHeight, camPos2D.y);

      // Build ray direction with full rotation
      vec3 rd = normalize(vec3(screenPos.x, screenPos.y * 0.5, 1.5));

      // Roll (Z rotation) - applied first in view space
      float crl = cos(camRoll), srl = sin(camRoll);
      rd = vec3(crl * rd.x - srl * rd.y, srl * rd.x + crl * rd.y, rd.z);

      // Pitch (X rotation) - tilt camera down toward terrain
      float cp = cos(-camPitch), sp = sin(-camPitch);
      rd = vec3(rd.x, cp * rd.y - sp * rd.z, sp * rd.y + cp * rd.z);

      // Yaw (Y rotation) - horizontal rotation
      rd.xz = mat2(cos(camYaw), -sin(camYaw), sin(camYaw), cos(camYaw)) * rd.xz;

      float t = 0.01;
      bool hit = false;
      vec3 hitPos;
      for (int i = 0; i < 48; i++) {
        hitPos = ro + rd * t;
        vec2 sampleUV = fract(hitPos.xz * 0.3);
        float h = luma(texture2D(uTexture, sampleUV).rgb) * heightScale;
        if (hitPos.y < h) { hit = true; break; }
        t += max(0.01, (hitPos.y - h) * 0.5);
        if (t > maxDist) break;
      }

      if (hit) {
        vec2 sUV = fract(hitPos.xz * 0.3);
        vec3 texColor = texture2D(uTexture, sUV).rgb;
        // Normal via central differences
        float eps = 0.005;
        float hL = luma(texture2D(uTexture, fract((hitPos.xz + vec2(-eps,0.0))*0.3)).rgb) * heightScale;
        float hR = luma(texture2D(uTexture, fract((hitPos.xz + vec2(eps,0.0))*0.3)).rgb) * heightScale;
        float hD = luma(texture2D(uTexture, fract((hitPos.xz + vec2(0.0,-eps))*0.3)).rgb) * heightScale;
        float hU = luma(texture2D(uTexture, fract((hitPos.xz + vec2(0.0,eps))*0.3)).rgb) * heightScale;
        vec3 normal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
        vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
        float diff = max(dot(normal, lightDir), 0.0) * 0.8 + 0.2;
        color = texColor * diff;
        // Fog
        float fogFactor = 1.0 - exp(-t * fogDensity);
        color = mix(color, fogColor, fogFactor);
      } else {
        color = fogColor;
      }
      outColor.rgb = color;
    }

    // ── Mode 2: Sphere Projection ──
    else if (mode == 2) {
      float blend = uAmount;
      float roughness = uAmount2;
      float spinSpd = uAmount3 * 2.0;
      float rimGlow = uThreshold;

      vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      float r = length(centered);
      float sphereR = 0.45;

      if (r < sphereR) {
        // Ray-sphere: compute normal
        float z = sqrt(sphereR * sphereR - r * r);
        vec3 normal = normalize(vec3(centered, z));

        // Rotate for spinning
        float angle = uTime * spinSpd;
        float ca = cos(angle), sa = sin(angle);
        vec3 rotN = vec3(normal.x * ca - normal.z * sa, normal.y, normal.x * sa + normal.z * ca);

        // Equirectangular UV mapping
        vec2 sphereUV = vec2(atan(rotN.z, rotN.x) / TAU + 0.5, asin(clamp(rotN.y, -1.0, 1.0)) / PI + 0.5);
        vec3 texColor = texture2D(uTexture, sphereUV).rgb;

        // Lighting
        vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
        float diff = max(dot(normal, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, normal), vec3(0,0,1)), 0.0), mix(4.0, 64.0, roughness));

        // Fresnel rim
        float fresnel = pow(1.0 - abs(normal.z), 3.0) * rimGlow;

        vec3 lit = texColor * (diff * 0.7 + 0.3) * uColor + vec3(spec * 0.3) + vec3(fresnel) * uColor;
        outColor.rgb = mix(src.rgb, lit, blend);
      } else {
        // Soft edge fade
        float edgeFade = smoothstep(sphereR + 0.02, sphereR, r);
        outColor.rgb = mix(src.rgb, src.rgb * 0.3, edgeFade * blend * 0.5);
      }
    }

    // ── Mode 3: Cube Projection ──
    else if (mode == 3) {
      float cubeSize = 0.3 + uAmount * 0.5;
      float edgeGlow = uAmount2;
      float spinSpd = uAmount3 * 1.5;
      float manualRot = uAngle;

      vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      vec3 ro = vec3(0.0, 0.0, -2.5);
      vec3 rd = normalize(vec3(centered, 1.0));

      float angle = uTime * spinSpd + manualRot;
      float tilt = 0.4;
      // Y rotation
      rd.xz = rot2d(angle) * rd.xz;
      ro.xz = rot2d(angle) * ro.xz;
      // X tilt
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

        // Determine face and UV
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

        // Edge glow
        vec2 edgeDist = 1.0 - abs(faceUV * 2.0 - 1.0);
        float edgeMin = min(edgeDist.x, edgeDist.y);
        float edge = smoothstep(0.02, 0.08, edgeMin);
        lit += vec3(1.0 - edge) * edgeGlow * uColor;

        outColor.rgb = lit;
      } else {
        outColor.rgb = src.rgb * 0.15;
      }
    }

    // ── Mode 4: Tunnel Flight ──
    else if (mode == 4) {
      float tunnelWidth = 0.3 + uAmount * 0.7;
      float shapeMorph = uAmount2;
      float flightSpeed = uAmount3 * 2.0;
      float fogDepth = uThreshold * 2.0;
      float twist = uAngle;
      vec3 fogTint = uColor;

      vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      // Apply twist
      centered = rot2d(twist * centered.y) * centered;

      float r = length(centered);
      float circR = r;
      float hexR = r / (cos(mod(atan(centered.y, centered.x) + PI/6.0, PI/3.0) - PI/6.0));
      float sqR = max(abs(centered.x), abs(centered.y));
      float shapeR = mix(circR, mix(hexR, sqR, clamp(shapeMorph * 2.0 - 1.0, 0.0, 1.0)), clamp(shapeMorph * 2.0, 0.0, 1.0));

      float ang = atan(centered.y, centered.x) / TAU + 0.5;
      float depth = tunnelWidth / max(shapeR, 0.001) + uTime * flightSpeed;

      vec2 tunnelUV = vec2(ang, fract(depth * 0.2));
      vec3 texColor = texture2D(uTexture, tunnelUV).rgb;

      float fog = 1.0 - exp(-shapeR * fogDepth);
      texColor = mix(texColor, fogTint, fog);

      float shade = 1.0 / (1.0 + shapeR * 3.0);
      outColor.rgb = texColor * shade;
    }

    // ── Mode 5: Infinite Mirror ──
    else if (mode == 5) {
      float depth = 4.0 + uAmount * 8.0;
      float zoom = 0.7 + uAmount2 * 0.5;
      float twistAmt = uAmount3 * 0.3;
      float fadeRate = 0.3 + uThreshold * 0.5;
      vec3 tintShift = uColor;

      vec2 p = uv;
      vec3 accum = vec3(0.0);
      float totalFade = 0.0;
      int iDepth = int(depth);

      for (int i = 0; i < 12; i++) {
        if (i >= iDepth) break;
        float fi = float(i);
        float fade = pow(fadeRate, fi);

        vec3 sample3 = texture2D(uTexture, p).rgb;
        // Per-bounce hue shift
        vec3 hsv = rgb2hsv(sample3);
        hsv.x = fract(hsv.x + fi * 0.08 * (tintShift.r - 0.5 + tintShift.b - 0.5));
        sample3 = hsv2rgb(hsv);

        accum += sample3 * fade;
        totalFade += fade;

        // Transform for next bounce
        p = (p - 0.5) * zoom + 0.5;
        p = abs(mod(p * 2.0, 2.0) - 1.0);
        p = (p - 0.5) * rot2d(twistAmt) + vec2(0.5);
      }
      outColor.rgb = accum / max(totalFade, 0.001);
    }

    // ── Mode 6: Fractal Warp ──
    else if (mode == 6) {
      float blend = uAmount;
      float fractalType = uAmount2;
      float zoomSpeed = uAmount3 * 0.5;
      float maxIter = 16.0 + uThreshold * 48.0;
      vec2 seed = (uCenter - 0.5) * 4.0;
      vec3 borderTint = uColor;

      // Animated zoom
      float zoomLevel = 1.0 + uTime * zoomSpeed;
      vec2 c, z;

      vec2 pos = (uv - 0.5) * 3.0 / zoomLevel;

      if (fractalType < 0.5) {
        // Mandelbrot
        c = pos + vec2(-0.5, 0.0);
        z = vec2(0.0);
      } else {
        // Julia
        c = seed;
        z = pos;
      }

      float iter = 0.0;
      for (int i = 0; i < 64; i++) {
        if (float(i) >= maxIter) break;
        if (dot(z, z) > 4.0) break;
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        iter += 1.0;
      }

      // Smooth coloring
      if (dot(z, z) > 4.0) {
        iter = iter - log2(log2(dot(z, z))) + 4.0;
      }

      float normalizedIter = iter / maxIter;
      vec2 fractalUV = fract(vec2(normalizedIter * 3.0, normalizedIter * 2.0 + 0.3));
      vec3 fracColor = texture2D(uTexture, fractalUV).rgb;

      // Tint border regions
      float border = smoothstep(0.0, 0.1, normalizedIter) * smoothstep(1.0, 0.9, normalizedIter);
      fracColor = mix(fracColor * borderTint, fracColor, border);

      outColor.rgb = mix(src.rgb, fracColor, blend);
    }

    // ── Mode 7: Crystal Refract ──
    else if (mode == 7) {
      float crystalSize = 0.2 + uAmount * 0.6;
      float ior = 1.1 + uAmount2 * 0.8;
      float dispersion = uAmount3 * 0.15;
      float fresnelStr = uThreshold;
      float rotation = uAngle + uTime * 0.3;
      vec3 facetTint = uColor;

      vec2 centered = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      vec3 ro = vec3(0.0, 0.0, -2.0);
      vec3 rd = normalize(vec3(centered, 1.2));

      // Rotate
      rd.xz = rot2d(rotation) * rd.xz;
      ro.xz = rot2d(rotation) * ro.xz;
      rd.yz = rot2d(0.3) * rd.yz;
      ro.yz = rot2d(0.3) * ro.yz;

      // Octahedron SDF raymarching
      float t = 0.0;
      bool hit = false;
      vec3 hitPos;
      for (int i = 0; i < 32; i++) {
        hitPos = ro + rd * t;
        float d = (abs(hitPos.x) + abs(hitPos.y) + abs(hitPos.z)) - crystalSize;
        if (d < 0.001) { hit = true; break; }
        t += d;
        if (t > 5.0) break;
      }

      if (hit) {
        vec3 n = normalize(sign(hitPos));
        float fresnel = pow(1.0 - abs(dot(n, -rd)), 3.0) * fresnelStr;

        // Chromatic refraction
        vec3 refR = refract(rd, n, 1.0 / (ior - dispersion));
        vec3 refG = refract(rd, n, 1.0 / ior);
        vec3 refB = refract(rd, n, 1.0 / (ior + dispersion));

        vec2 uvR = uv + refR.xy * 0.2;
        vec2 uvG = uv + refG.xy * 0.2;
        vec2 uvB = uv + refB.xy * 0.2;

        float rChan = texture2D(uTexture, clamp(uvR, 0.0, 1.0)).r;
        float gChan = texture2D(uTexture, clamp(uvG, 0.0, 1.0)).g;
        float bChan = texture2D(uTexture, clamp(uvB, 0.0, 1.0)).b;

        vec3 refracted = vec3(rChan, gChan, bChan) * facetTint;
        vec3 reflected = texture2D(uTexture, reflect(rd, n).xy * 0.3 + 0.5).rgb;

        outColor.rgb = mix(refracted, reflected, fresnel);
      }
      // else keep src
    }

    // ── Mode 8: Feedback Zoom ──
    else if (mode == 8) {
      float zoomRate = 0.9 + uAmount * 0.15;
      float fbMix = uAmount2;
      float rotPerIter = (uAmount3 - 0.5) * 0.3;
      float hueCycle = uThreshold * 0.15;
      vec2 center = uCenter;

      vec2 p = uv;
      vec3 accum = vec3(0.0);
      float totalWeight = 0.0;

      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float weight = pow(fbMix, fi);
        if (weight < 0.01) break;

        vec3 s = texture2D(uTexture, clamp(p, 0.0, 1.0)).rgb;
        // Hue shift per iteration
        vec3 hsv = rgb2hsv(s);
        hsv.x = fract(hsv.x + fi * hueCycle);
        s = hsv2rgb(hsv);

        accum += s * weight;
        totalWeight += weight;

        // Transform for next iteration
        p = (p - center) * zoomRate + center;
        p = (p - center) * rot2d(rotPerIter) + center;
      }
      outColor.rgb = accum / max(totalWeight, 0.001);
    }

    // ── Mode 9: Fluid Distort ──
    else if (mode == 9) {
      float magnitude = uAmount * 0.08;
      float scale = 2.0 + uAmount2 * 8.0;
      float speed = uAmount3 * 2.0;
      float vorticity = uThreshold;
      float bias = uAngle;

      vec2 p = uv;
      vec2 biasDir = vec2(cos(bias), sin(bias)) * 0.01;

      for (int i = 0; i < 8; i++) {
        float fi = float(i);
        vec2 noisePos = p * scale + uTime * speed * 0.3 + fi * 1.3;

        // Flow field from FBM gradient
        float n0 = fbm(noisePos);
        float nx = fbm(noisePos + vec2(0.01, 0.0));
        float ny = fbm(noisePos + vec2(0.0, 0.01));
        vec2 grad = vec2(nx - n0, ny - n0) / 0.01;

        // Mix curl (rotational) and gradient (divergent) based on vorticity
        vec2 curl = vec2(-grad.y, grad.x);
        vec2 flow = mix(grad, curl, vorticity) + biasDir;

        p += flow * magnitude;
      }
      outColor.rgb = texture2D(uTexture, clamp(p, 0.0, 1.0)).rgb;
    }

    // ── Mode 10: Wormhole ──
    else if (mode == 10) {
      float mass = uAmount * 0.4;
      float ringRadius = 0.05 + uAmount2 * 0.3;
      float diskSpin = uAmount3 * 3.0;
      float glowStr = uThreshold;
      vec2 center = uCenter;
      vec3 diskColor = uColor;

      vec2 centered = uv - center;
      centered.x *= uResolution.x / uResolution.y;
      float dist = length(centered);
      float angle = atan(centered.y, centered.x);

      // Gravitational lensing
      float deflection = mass / max(dist, 0.01);
      vec2 lensedUV = uv + normalize(centered) * deflection * (uResolution.y / uResolution.x);

      vec3 color = texture2D(uTexture, clamp(lensedUV, 0.0, 1.0)).rgb;

      // Einstein ring
      float ringDist = abs(dist - ringRadius);
      float ring = exp(-ringDist * ringDist * 500.0) * glowStr;
      color += diskColor * ring;

      // Accretion disk
      float diskWidth = ringRadius * 0.8;
      float diskDist = abs(centered.y * cos(0.3) + centered.x * sin(0.3));
      if (dist > ringRadius * 0.5 && dist < ringRadius * 2.5 && diskDist < diskWidth * 0.3) {
        float diskAngle = angle + uTime * diskSpin;
        float diskPattern = sin(diskAngle * 8.0 + dist * 30.0) * 0.5 + 0.5;
        float diskAlpha = smoothstep(ringRadius * 2.5, ringRadius, dist) * smoothstep(ringRadius * 0.5, ringRadius, dist);
        color += diskColor * diskPattern * diskAlpha * glowStr * 0.5;
      }

      // Event horizon darkening
      float horizon = smoothstep(ringRadius * 0.3, ringRadius * 0.1, dist);
      color *= 1.0 - horizon;

      outColor.rgb = color;
    }

    // ── Mode 11: Geometric Tile ──
    else if (mode == 11) {
      float tileCount = 3.0 + uAmount * 15.0;
      float flipRange = uAmount2 * PI;
      float speed = uAmount3 * 2.0;
      float gapSize = uThreshold * 0.1;

      vec2 tileId = floor(uv * tileCount);
      vec2 tileUV = fract(uv * tileCount);

      // Gap between tiles
      vec2 border = step(vec2(gapSize), tileUV) * step(vec2(gapSize), 1.0 - tileUV);
      float inTile = border.x * border.y;

      if (inTile > 0.5) {
        // Per-tile random phase
        float rnd = hash(tileId);
        float flipAngle = sin(uTime * speed + rnd * TAU) * flipRange;

        // Center tile UV
        vec2 centered = tileUV - 0.5;

        // Apply 3D rotation (flip around Y axis)
        float cosA = cos(flipAngle);
        float perspX = centered.x * cosA;
        float perspScale = 1.0 / (1.0 + abs(centered.x * sin(flipAngle)) * 0.5);

        vec2 rotatedUV = vec2(perspX, centered.y) * perspScale + 0.5;

        // Map back to source UV
        vec2 srcUV = (tileId + clamp(rotatedUV, 0.01, 0.99)) / tileCount;
        vec3 tileColor = texture2D(uTexture, srcUV).rgb;

        // Per-tile lighting based on flip angle
        float lighting = 0.6 + 0.4 * cosA;
        outColor.rgb = tileColor * lighting;
      } else {
        outColor.rgb = vec3(0.02);
      }
    }

    // ── Mode 12: Motion Trails ──
    else if (mode == 12) {
      float trailLen = uAmount;
      float lumaGate = uAmount2;
      float fadeCurve = uAmount3;
      float intensity = uThreshold;
      float dir = uAngle;
      vec3 trailTint = uColor;

      vec2 trailDir = vec2(cos(dir), sin(dir));
      int steps = 4 + int(trailLen * 28.0);
      float stepSize = trailLen * 0.02;

      vec3 accum = src.rgb;
      float totalWeight = 1.0;

      for (int i = 1; i <= 32; i++) {
        if (i > steps) break;
        float fi = float(i);
        vec2 sampleUV = uv - trailDir * fi * stepSize;
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) break;

        vec3 s = texture2D(uTexture, sampleUV).rgb;
        float l = luma(s);

        if (l > lumaGate) {
          float weight = mix(1.0 - fi / float(steps), pow(0.85, fi), fadeCurve);
          accum += s * trailTint * weight * intensity;
          totalWeight += weight * intensity;
        }
      }
      outColor.rgb = accum / totalWeight;
    }

    // ── Mode 13: Echo Repeat ──
    else if (mode == 13) {
      float echoCount = 2.0 + uAmount * 10.0;
      float spacing = uAmount2 * 0.15;
      float scalePer = 0.8 + uAmount3 * 0.2;
      float fadeRate = 0.3 + uThreshold * 0.5;
      float dir = uAngle;
      vec3 echoTint = uColor;

      vec2 echoDir = vec2(cos(dir), sin(dir));
      int count = int(echoCount);

      vec3 accum = src.rgb;
      float totalWeight = 1.0;

      for (int i = 1; i <= 12; i++) {
        if (i >= count) break;
        float fi = float(i);
        float fade = pow(fadeRate, fi);

        // Offset and scale
        vec2 offset = echoDir * spacing * fi;
        float scl = pow(scalePer, fi);
        vec2 echoUV = (uv - 0.5 - offset) / scl + 0.5;

        if (echoUV.x >= 0.0 && echoUV.x <= 1.0 && echoUV.y >= 0.0 && echoUV.y <= 1.0) {
          vec3 s = texture2D(uTexture, echoUV).rgb;
          // Color shift per echo
          vec3 hsv = rgb2hsv(s);
          hsv.x = fract(hsv.x + fi * 0.05 * (echoTint.r - echoTint.b));
          s = hsv2rgb(hsv);

          accum += s * fade;
          totalWeight += fade;
        }
      }
      outColor.rgb = accum / totalWeight;
    }

    // ── Mode 14: Ghost Double ──
    else if (mode == 14) {
      float separation = uAmount * 0.15;
      float ghostCount = 2.0 + uAmount2 * 4.0;
      float chromaShift = uAmount3 * 0.03;
      float opacity = uThreshold;
      float spreadAngle = uAngle;

      int count = int(ghostCount);
      vec3 accum = src.rgb;
      float totalWeight = 1.0;

      for (int i = 1; i <= 6; i++) {
        if (i >= count) break;
        float fi = float(i);
        float angle = spreadAngle + fi * TAU / ghostCount;
        vec2 offset = vec2(cos(angle), sin(angle)) * separation * fi;
        float fade = opacity / fi;

        // Chromatic offset per ghost
        float rOff = chromaShift * fi;
        float rCh = texture2D(uTexture, clamp(uv + offset + vec2(rOff, 0.0), 0.0, 1.0)).r;
        float gCh = texture2D(uTexture, clamp(uv + offset, 0.0, 1.0)).g;
        float bCh = texture2D(uTexture, clamp(uv + offset - vec2(rOff, 0.0), 0.0, 1.0)).b;

        accum += vec3(rCh, gCh, bCh) * fade;
        totalWeight += fade;
      }
      outColor.rgb = accum / totalWeight;
    }

    // ── Mode 15: Strobe Flash ──
    else if (mode == 15) {
      float rate = 1.0 + uAmount * 19.0;
      float dutyCycle = uAmount2;
      float mode2 = uAmount3;
      float intensity = uThreshold;
      vec3 flashColor = uColor;

      float phase = fract(uTime * rate);
      float on = step(phase, dutyCycle);

      vec3 flashResult;
      if (mode2 < 0.25) {
        flashResult = vec3(1.0); // White flash
      } else if (mode2 < 0.5) {
        flashResult = vec3(0.0); // Black flash
      } else if (mode2 < 0.75) {
        flashResult = 1.0 - src.rgb; // Invert flash
      } else {
        flashResult = flashColor; // Color flash
      }

      outColor.rgb = mix(src.rgb, flashResult, on * intensity);
    }

    // ── Mode 16: Light Paint ──
    else if (mode == 16) {
      float trailLen = uAmount;
      float flowScale = 2.0 + uAmount2 * 8.0;
      float speed = uAmount3 * 2.0;
      float lumaGate = uThreshold;
      vec3 paintTint = uColor;

      vec2 p = uv;
      vec3 accum = vec3(0.0);
      float totalWeight = 0.0;
      int steps = 4 + int(trailLen * 12.0);

      for (int i = 0; i < 16; i++) {
        if (i >= steps) break;
        float fi = float(i);

        vec3 s = texture2D(uTexture, clamp(p, 0.0, 1.0)).rgb;
        float l = luma(s);

        if (l > lumaGate) {
          float weight = 1.0 - fi / float(steps);
          accum += s * paintTint * weight;
          totalWeight += weight;
        }

        // Advect along flow field
        vec2 noisePos = p * flowScale + uTime * speed * 0.3;
        float n0 = fbm(noisePos);
        float nx = fbm(noisePos + vec2(0.01, 0.0));
        float ny = fbm(noisePos + vec2(0.0, 0.01));
        vec2 flow = vec2(-(ny - n0), nx - n0) / 0.01;
        p += normalize(flow + 0.001) * 0.01;
      }

      if (totalWeight > 0.01) {
        vec3 painted = accum / totalWeight;
        outColor.rgb = max(src.rgb, painted * 0.8);
      }
    }

    // ── Mode 17: Recursive Echo ──
    else if (mode == 17) {
      float echoDepth = 4.0 + uAmount * 12.0;
      float offsetAmt = uAmount2 * 0.08;
      float scalePer = 0.85 + uAmount3 * 0.15;
      float fadeRate = 0.3 + uThreshold * 0.5;
      float dir = uAngle;
      vec3 colorShift = uColor;

      vec2 echoDir = vec2(cos(dir), sin(dir));
      int depth = int(echoDepth);

      vec2 p = uv;
      vec3 accum = vec3(0.0);
      float totalWeight = 0.0;

      for (int i = 0; i < 16; i++) {
        if (i >= depth) break;
        float fi = float(i);
        float fade = pow(fadeRate, fi);

        vec3 s = texture2D(uTexture, clamp(p, 0.0, 1.0)).rgb;
        // Per-echo hue shift
        vec3 hsv = rgb2hsv(s);
        hsv.x = fract(hsv.x + fi * 0.06 * (colorShift.r - 0.5 + colorShift.b - 0.5));
        hsv.y = min(1.0, hsv.y * (1.0 + fi * 0.05 * (colorShift.g - 0.5)));
        s = hsv2rgb(hsv);

        accum += s * fade;
        totalWeight += fade;

        // Translate and scale for next echo
        p = (p - 0.5) * scalePer + 0.5;
        p += echoDir * offsetAmt;
      }
      outColor.rgb = accum / max(totalWeight, 0.001);
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`;

// Mode mapping for premiumPack2Shader (18 new modes)
export const premiumPack2Modes: Record<string, number> = {
  explode3D: 0,
  terrain3D: 1,
  sphereProject: 2,
  cubeProject: 3,
  tunnelFlight: 4,
  infiniteMirror: 5,
  fractalWarp: 6,
  crystalRefract: 7,
  feedbackZoom: 8,
  fluidDistort: 9,
  wormhole: 10,
  geometricTile: 11,
  motionTrails: 12,
  echoRepeat: 13,
  ghostDouble: 14,
  strobeFlash: 15,
  lightPaint: 16,
  recursiveEcho: 17,
};
