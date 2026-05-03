// Premium Pack Shader - 30 modes for premium color, stylize, warp, atmosphere, and text effects

export const premiumPackShader = /* glsl */ `
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

  // Pseudo-random hash
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Value noise
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Fractal Brownian Motion
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  // Directional blur helper
  vec4 sampleDir(vec2 uv, vec2 dir, float radius) {
    vec4 acc = vec4(0.0);
    float w = 0.0;
    for (int i = -8; i <= 8; i++) {
      float t = float(i) / 8.0;
      float ww = 1.0 - abs(t);
      acc += texture2D(uTexture, clamp(uv + dir * t * radius, 0.0, 1.0)) * ww;
      w += ww;
    }
    return acc / max(w, 0.0001);
  }

  // HSV conversion
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = vUv;
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;
    int mode = int(uMode + 0.5);

    // ── Mode 0: Filmic Tonemap (ACES) ──
    if (mode == 0) {
      float intensity = uAmount;
      float shoulder = 0.5 + uAmount2 * 2.0;
      float toe = uAmount3 * 0.5;
      float whitePoint = 0.5 + uThreshold * 1.5;
      vec3 x = src.rgb * (1.0 + intensity);
      // ACES-like curve: (x * (a*x + b)) / (x * (c*x + d) + e)
      float a = shoulder;
      float b = toe;
      float cCoeff = shoulder - 0.3;
      float d = 0.2;
      float e = 0.02;
      vec3 mapped = (x * (a * x + vec3(b))) / (x * (cCoeff * x + vec3(d)) + vec3(e));
      mapped /= (vec3(whitePoint) * (a * whitePoint + b)) / (whitePoint * (cCoeff * whitePoint + d) + e);
      outColor.rgb = mix(src.rgb, clamp(mapped, 0.0, 1.0), intensity);
    }
    // ── Mode 1: Selective Color (hue targeting) ──
    else if (mode == 1) {
      vec3 hsv = rgb2hsv(src.rgb);
      float targetHue = uColor.r;
      float hueWidth = max(0.01, uAmount2 * 0.3);
      float dist = min(abs(hsv.x - targetHue), min(abs(hsv.x - targetHue + 1.0), abs(hsv.x - targetHue - 1.0)));
      float mask = 1.0 - smoothstep(0.0, hueWidth, dist);
      mask *= uAmount;
      float hueShift = (uColor.g - 0.5) * 0.5;
      float satShift = (uAmount3 - 0.5) * 2.0;
      float lumShift = (uColor.b - 0.5) * 0.5;
      hsv.x = fract(hsv.x + hueShift * mask);
      hsv.y = clamp(hsv.y + satShift * mask, 0.0, 1.0);
      hsv.z = clamp(hsv.z + lumShift * mask, 0.0, 1.0);
      outColor.rgb = hsv2rgb(hsv);
    }
    // ── Mode 2: False Color (IRE exposure zebra) ──
    else if (mode == 2) {
      float l = luma(src.rgb);
      float intensity = uAmount;
      float bands = 3.0 + uAmount2 * 12.0;
      // Map luminance to false color rainbow
      vec3 fc;
      float t = l * bands;
      fc.r = 0.5 + 0.5 * sin(t * 2.1 + 0.0);
      fc.g = 0.5 + 0.5 * sin(t * 2.1 + 2.094);
      fc.b = 0.5 + 0.5 * sin(t * 2.1 + 4.188);
      // Overexposure warning: flash red above threshold
      if (l > uThreshold) {
        fc = vec3(1.0, 0.0, 0.0) * (0.5 + 0.5 * sin(uTime * 8.0));
      }
      outColor.rgb = mix(src.rgb, fc, intensity);
    }
    // ── Mode 3: Shadow Recovery ──
    else if (mode == 3) {
      float l = luma(src.rgb);
      float lift = uAmount * 0.5;
      float range = uAmount2;
      float protect = uThreshold;
      // Only affect shadows, leave highlights alone
      float shadowMask = 1.0 - smoothstep(0.0, max(0.01, range), l);
      float highlightProtect = smoothstep(protect, 1.0, l);
      float recovery = lift * shadowMask * (1.0 - highlightProtect);
      outColor.rgb = src.rgb + vec3(recovery);
    }
    // ── Mode 4: Highlight Roll-off ──
    else if (mode == 4) {
      float rolloff = uAmount;
      float knee = max(0.01, uAmount2 * 0.5);
      float thresh = uThreshold;
      vec3 c = src.rgb;
      // Soft-clip highlights with smooth knee
      for (int i = 0; i < 3; i++) {
        float v = c[i];
        if (v > thresh) {
          float excess = v - thresh;
          c[i] = thresh + excess / (1.0 + excess * rolloff / knee);
        }
      }
      outColor.rgb = c;
    }
    // ── Mode 5: Halation (warm highlight bleed) ──
    else if (mode == 5) {
      float l = luma(src.rgb);
      float gate = smoothstep(uThreshold, uThreshold + 0.15, l);
      // Blur bright areas
      vec4 blur = sampleDir(uv, vec2(px.x, 0.0), mix(10.0, 60.0, uAmount2) * px.x)
        + sampleDir(uv, vec2(0.0, px.y), mix(10.0, 60.0, uAmount2) * px.y);
      blur *= 0.5;
      // Tint with warm color
      vec3 halGlow = blur.rgb * gate * uColor * 2.0;
      outColor.rgb = src.rgb + halGlow * uAmount;
    }
    // ── Mode 6: Anamorphic Streak ──
    else if (mode == 6) {
      float l = luma(src.rgb);
      float gate = smoothstep(uThreshold, uThreshold + 0.15, l);
      // Horizontal-only blur for streaks
      vec4 streak = sampleDir(uv, vec2(px.x, 0.0), mix(20.0, 120.0, uAmount) * px.x);
      vec3 streakTint = streak.rgb * gate * uColor * 2.0;
      outColor.rgb = src.rgb + streakTint * uAmount2;
    }
    // ── Mode 7: Lens Dirt (procedural) ──
    else if (mode == 7) {
      float l = luma(src.rgb);
      float gate = smoothstep(uThreshold, uThreshold + 0.2, l);
      // Procedural dirt pattern using noise
      float scale = 2.0 + uAmount2 * 8.0;
      float complexity = 2.0 + uAmount3 * 4.0;
      float dirt = 0.0;
      for (int i = 0; i < 4; i++) {
        float s = scale * (1.0 + float(i) * 0.7);
        dirt += vnoise(uv * s + float(i) * 13.7) * (1.0 / (1.0 + float(i)));
      }
      dirt = smoothstep(0.3, 0.8, dirt);
      // Glow where bright and dirty
      vec3 glow = src.rgb * gate * dirt * 2.0;
      outColor.rgb = src.rgb + glow * uAmount;
    }
    // ── Mode 8: Defocus Bokeh (hexagonal) ──
    else if (mode == 8) {
      float radius = uAmount * 15.0;
      float shape = uAmount2;
      float highlightBoost = uThreshold;
      float ringWidth = uAmount3;
      vec4 acc = vec4(0.0);
      float w = 0.0;
      // Sample in hexagonal pattern
      for (int i = -4; i <= 4; i++) {
        for (int j = -4; j <= 4; j++) {
          vec2 off = vec2(float(i), float(j) + float(i) * 0.5 * shape);
          float r = length(off);
          if (r > 4.5) continue;
          // Ring-shaped weight for bokeh look
          float ringW = mix(1.0, smoothstep(2.0, 4.0, r), ringWidth);
          vec4 s = texture2D(uTexture, uv + off * px * radius);
          // Boost bright samples for highlight bokeh
          float lum = luma(s.rgb);
          float boost = 1.0 + smoothstep(0.5, 1.0, lum) * highlightBoost * 3.0;
          acc += s * ringW * boost;
          w += ringW * boost;
        }
      }
      outColor = acc / max(w, 0.001);
    }
    // ── Mode 9: Diffusion / Pro-Mist ──
    else if (mode == 9) {
      float l = luma(src.rgb);
      // Soft glow from highlights
      vec4 blur = sampleDir(uv, vec2(px.x, px.y), mix(15.0, 80.0, uAmount2) * max(px.x, px.y))
        + sampleDir(uv, vec2(px.x, -px.y), mix(15.0, 80.0, uAmount2) * max(px.x, px.y));
      blur *= 0.5;
      float gate = smoothstep(uThreshold, uThreshold + 0.3, l);
      // Warm shift
      vec3 warmBlur = blur.rgb * (1.0 + vec3(uAmount3 * 0.2, uAmount3 * 0.1, -uAmount3 * 0.1));
      outColor.rgb = src.rgb + warmBlur * gate * uAmount;
      // Slight desaturation for dreamy feel
      float outL = luma(outColor.rgb);
      outColor.rgb = mix(outColor.rgb, vec3(outL), uAmount * 0.15);
    }
    // ── Mode 10: ASCII Art ──
    else if (mode == 10) {
      float cellSize = mix(4.0, 24.0, uAmount);
      float contrast = 0.5 + uAmount2 * 1.5;
      float colorMix = uAmount3;
      // Sample at cell center
      vec2 cell = floor(uv * uResolution / cellSize);
      vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, cellUv);
      float l = luma(cellColor.rgb);
      l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
      // Simulate character density with patterns
      vec2 local = fract(uv * uResolution / cellSize);
      // Character-like patterns based on luminance
      float charMask;
      if (l > 0.9) { charMask = 1.0; } // '@' or '#' - full block
      else if (l > 0.7) { charMask = step(0.2, local.x) * step(local.x, 0.8) * step(0.2, local.y) * step(local.y, 0.8) > 0.0 ? 1.0 : 0.0; }
      else if (l > 0.5) { charMask = step(0.3, local.x) * step(local.x, 0.7) > 0.0 ? 1.0 : (step(0.3, local.y) * step(local.y, 0.7) > 0.0 ? 1.0 : 0.0); } // '+' cross
      else if (l > 0.3) { charMask = step(0.4, local.x) * step(local.x, 0.6) > 0.0 ? 1.0 : 0.0; } // '|' or ':'
      else if (l > 0.15) { charMask = (step(0.4, local.x) * step(local.x, 0.6) * step(0.6, local.y) > 0.0) ? 1.0 : 0.0; } // '.'
      else { charMask = 0.0; } // space
      vec3 asciiColor = mix(vec3(charMask), cellColor.rgb * charMask, colorMix);
      outColor.rgb = asciiColor;
    }
    // ── Mode 11: Comic Ink (edges + halftone) ──
    else if (mode == 11) {
      float inkThickness = 1.0 + uAmount * 3.0;
      float halftoneSize = 3.0 + uAmount2 * 12.0;
      float con = 0.5 + uAmount3;
      float edgeThresh = uThreshold;
      // Edge detection (Sobel)
      float tl = luma(texture2D(uTexture, uv + vec2(-px.x, px.y) * inkThickness).rgb);
      float t  = luma(texture2D(uTexture, uv + vec2(0.0, px.y) * inkThickness).rgb);
      float tr = luma(texture2D(uTexture, uv + vec2(px.x, px.y) * inkThickness).rgb);
      float l  = luma(texture2D(uTexture, uv + vec2(-px.x, 0.0) * inkThickness).rgb);
      float r  = luma(texture2D(uTexture, uv + vec2(px.x, 0.0) * inkThickness).rgb);
      float bl = luma(texture2D(uTexture, uv + vec2(-px.x, -px.y) * inkThickness).rgb);
      float b  = luma(texture2D(uTexture, uv + vec2(0.0, -px.y) * inkThickness).rgb);
      float br = luma(texture2D(uTexture, uv + vec2(px.x, -px.y) * inkThickness).rgb);
      float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
      float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
      float edge = sqrt(gx*gx + gy*gy);
      float ink = smoothstep(edgeThresh, edgeThresh + 0.15, edge);
      // Halftone dots
      vec2 grid = floor(uv * uResolution / halftoneSize);
      vec2 guv = (grid + 0.5) * halftoneSize / uResolution;
      float cellL = luma(texture2D(uTexture, guv).rgb);
      cellL = clamp((cellL - 0.5) * con + 0.5, 0.0, 1.0);
      vec2 local = fract(uv * uResolution / halftoneSize) - 0.5;
      float dot = 1.0 - step(cellL * 0.5, length(local));
      // Combine: white bg, halftone shading, ink lines on top
      outColor.rgb = vec3(mix(dot, 0.0, ink));
    }
    // ── Mode 12: Datamosh Lite (pixel sort by luminance bands) ──
    else if (mode == 12) {
      float intensity = uAmount;
      float bandWidth = 5.0 + uAmount2 * 30.0;
      float colorShift = uAmount3;
      // Sort-like horizontal offset based on luminance bands
      float l = luma(src.rgb);
      float band = floor(l * bandWidth) / bandWidth;
      float sortOffset = (band - 0.5) * intensity * 0.15;
      // Add time-based jitter
      float jitter = hash(vec2(floor(uv.y * uResolution.y * 0.5), floor(uTime * 3.0))) * 0.02 * intensity;
      vec2 sampleUv = uv + vec2(sortOffset + jitter, 0.0);
      outColor = texture2D(uTexture, clamp(sampleUv, 0.0, 1.0));
      // Color channel separation
      if (colorShift > 0.01) {
        outColor.r = texture2D(uTexture, clamp(sampleUv + vec2(colorShift * 0.01, 0.0), 0.0, 1.0)).r;
        outColor.b = texture2D(uTexture, clamp(sampleUv - vec2(colorShift * 0.01, 0.0), 0.0, 1.0)).b;
      }
    }
    // ── Mode 13: Scanline Drift ──
    else if (mode == 13) {
      float drift = uAmount * 0.1;
      float bandH = 5.0 + uAmount2 * 50.0;
      float speed = uAmount3 * 3.0;
      // Horizontal bands that drift over time
      float row = floor(uv.y * bandH);
      float bandPhase = hash(vec2(row, 0.0)) * TAU;
      float offset = sin(uTime * speed + bandPhase) * drift;
      // Some bands drift more than others
      float bandIntensity = hash(vec2(row, 1.0));
      offset *= bandIntensity;
      vec2 sampleUv = vec2(uv.x + offset, uv.y);
      outColor = texture2D(uTexture, clamp(sampleUv, 0.0, 1.0));
      // Slight brightness variation per band
      outColor.rgb *= 0.9 + bandIntensity * 0.2;
    }
    // ── Mode 14: Tape Dropout ──
    else if (mode == 14) {
      float dropoutRate = uAmount;
      float bandHeight = 2.0 + uAmount2 * 15.0;
      float noiseAmt = uAmount3;
      float row = floor(uv.y * uResolution.y / bandHeight);
      float dropHash = hash(vec2(row, floor(uTime * 6.0)));
      // Random dropout bands
      if (dropHash < dropoutRate * 0.3) {
        // White noise band
        float n = hash(uv * uResolution + uTime);
        outColor.rgb = vec3(n) * noiseAmt;
        // Offset horizontally
        float hOff = (hash(vec2(row, uTime)) - 0.5) * 0.1;
        vec4 shifted = texture2D(uTexture, clamp(vec2(uv.x + hOff, uv.y), 0.0, 1.0));
        outColor.rgb = mix(outColor.rgb, shifted.rgb, 0.3);
      }
    }
    // ── Mode 15: Polar Transform ──
    else if (mode == 15) {
      float amount = uAmount;
      vec2 center = uCenter;
      float rotation = uAmount2 * TAU;
      vec2 d = uv - center;
      float r = length(d);
      float theta = atan(d.y, d.x) + rotation;
      // Map polar to rectangular or vice versa
      vec2 polarUv = vec2(theta / TAU + 0.5, r * 2.0);
      vec2 finalUv = mix(uv, polarUv, amount);
      outColor = texture2D(uTexture, clamp(fract(finalUv), 0.0, 1.0));
    }
    // ── Mode 16: Ripple Caustics ──
    else if (mode == 16) {
      float dist = uAmount * 0.03;
      float scale = 3.0 + uAmount2 * 15.0;
      float speed = uAmount3 * 2.0;
      // Multiple overlapping sine waves for caustic pattern
      float caustic = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float phase = uTime * speed * (0.8 + fi * 0.3);
        vec2 dir = vec2(cos(fi * 2.094), sin(fi * 2.094));
        caustic += sin(dot(uv * scale, dir) + phase) * 0.33;
      }
      // Use caustic pattern to distort UV
      vec2 offset = vec2(
        sin(caustic * PI) * dist,
        cos(caustic * PI * 1.3) * dist
      );
      outColor = texture2D(uTexture, clamp(uv + offset, 0.0, 1.0));
      // Add subtle caustic lighting
      float brightness = 1.0 + caustic * 0.15 * uAmount;
      outColor.rgb *= brightness;
    }
    // ── Mode 17: Shockwave ──
    else if (mode == 17) {
      float ringWidth = 0.02 + uAmount * 0.15;
      float distortion = uAmount2 * 0.15;
      float speed = uAmount3 * 2.0;
      vec2 center = uCenter;
      vec2 d = uv - center;
      float r = length(d);
      // Expanding ring
      float ringPos = fract(uTime * speed * 0.3);
      float ring = smoothstep(ringPos - ringWidth, ringPos, r) *
                   (1.0 - smoothstep(ringPos, ringPos + ringWidth, r));
      // Distort along radius
      vec2 offset = normalize(d + vec2(0.0001)) * ring * distortion;
      outColor = texture2D(uTexture, clamp(uv + offset, 0.0, 1.0));
    }
    // ── Mode 18: Droste Recursive (log-polar spiral) ──
    else if (mode == 18) {
      vec2 center = uCenter;
      float zoom = 1.0 + uAmount * 4.0;
      float spiral = uAmount2 * 2.0;
      float branches = 1.0 + uAmount3 * 3.0;
      vec2 d = uv - center;
      float r = length(d);
      float theta = atan(d.y, d.x);
      // Log-polar transform
      float logR = log(max(r, 0.001)) / log(zoom);
      // Add spiral
      logR += theta * spiral / TAU;
      // Repeat
      vec2 drosteUv = center + vec2(
        cos(theta * branches) * exp(fract(logR) * log(zoom)),
        sin(theta * branches) * exp(fract(logR) * log(zoom))
      );
      outColor = texture2D(uTexture, clamp(fract(drosteUv), 0.0, 1.0));
    }
    // ── Mode 19: Slit-Scan ──
    else if (mode == 19) {
      float slitWidth = uAmount;
      float scanSpeed = uAmount2 * 2.0;
      float direction = uAmount3; // 0=horizontal, 1=vertical
      // Each row/column samples from a different time offset
      float pos = mix(uv.y, uv.x, direction);
      float timeOffset = pos * slitWidth * 3.0;
      // Simulate temporal offset by spatial offset
      float xOff = sin(pos * 20.0 + uTime * scanSpeed) * slitWidth * 0.1;
      float yOff = cos(pos * 15.0 + uTime * scanSpeed * 0.7) * slitWidth * 0.1;
      vec2 sampleUv = uv + vec2(xOff, yOff);
      outColor = texture2D(uTexture, clamp(sampleUv, 0.0, 1.0));
    }
    // ── Mode 20: Volumetric Fog ──
    else if (mode == 20) {
      float density = uAmount;
      float scale = 2.0 + uAmount2 * 8.0;
      float speed = uAmount3;
      vec3 fogColor = uColor;
      // Layered noise for volumetric look
      float fog = 0.0;
      fog += fbm(uv * scale + vec2(uTime * speed * 0.3, uTime * speed * 0.2)) * 0.6;
      fog += fbm(uv * scale * 2.0 + vec2(-uTime * speed * 0.2, uTime * speed * 0.15)) * 0.3;
      fog += fbm(uv * scale * 4.0 + vec2(uTime * speed * 0.1)) * 0.1;
      // Fade stronger at bottom
      fog *= (1.0 - uv.y * 0.5);
      fog = smoothstep(0.2, 0.8, fog) * density;
      outColor.rgb = mix(src.rgb, fogColor, fog);
    }
    // ── Mode 21: Rain/Snow Overlay ──
    else if (mode == 21) {
      float density = uAmount * 200.0;
      float speed = uAmount2 * 5.0;
      float size = 0.002 + uAmount3 * 0.008;
      float windAngle = uAngle;
      vec2 windDir = vec2(sin(windAngle), -cos(windAngle));
      // Multiple layers of particles for depth
      float particles = 0.0;
      for (int layer = 0; layer < 3; layer++) {
        float fl = float(layer);
        float layerScale = 1.0 + fl * 0.5;
        float layerSpeed = speed * (0.7 + fl * 0.3);
        vec2 cellUv = uv * vec2(density * layerScale * 0.3, density * layerScale);
        cellUv += windDir * uTime * layerSpeed;
        vec2 cellId = floor(cellUv);
        vec2 cellLocal = fract(cellUv) - 0.5;
        // Random offset per cell
        vec2 offset = vec2(hash(cellId) - 0.5, hash(cellId + 100.0) - 0.5) * 0.4;
        float d = length(cellLocal - offset);
        float particle = smoothstep(size * layerScale, 0.0, d);
        // Fade with depth
        particles += particle * (1.0 - fl * 0.25);
      }
      particles = clamp(particles, 0.0, 1.0);
      outColor.rgb = src.rgb + vec3(particles);
    }
    // ── Mode 22: 3D Particle Dissolve ──
    else if (mode == 22) {
      float scatter = uAmount;         // 0=solid image, 1=fully scattered
      float pSize = 0.3 + uAmount2 * 1.5; // particle size multiplier
      float speed = uAmount3 * 2.0;
      float bright = 0.5 + uThreshold;
      // Grid resolution — each cell becomes one "particle"
      float gridRes = mix(30.0, 100.0, 1.0 - uAmount2 * 0.5);
      vec2 cellCount = vec2(gridRes, gridRes * uResolution.y / uResolution.x);
      vec2 cellSize = 1.0 / cellCount;
      // Find which grid cell this pixel belongs to
      vec2 cellId = floor(uv * cellCount);
      vec2 cellLocal = fract(uv * cellCount) - 0.5; // -0.5 to 0.5 within cell
      // Per-particle random values
      float rnd1 = hash(cellId);
      float rnd2 = hash(cellId + 137.0);
      float rnd3 = hash(cellId + 271.0);
      float rnd4 = hash(cellId + 419.0);
      // Source color at cell center
      vec2 cellCenter = (cellId + 0.5) * cellSize;
      vec4 cellColor = texture2D(uTexture, cellCenter);
      float cellLuma = luma(cellColor.rgb);
      // 3D displacement — particles fly out based on scatter amount
      float phase = rnd1 * TAU + uTime * speed * (0.5 + rnd2 * 0.5);
      float scatterAmt = scatter * (0.5 + rnd3 * 0.5);
      vec2 displacement = vec2(
        sin(phase) * scatterAmt * 0.3,
        cos(phase * 0.7 + rnd2 * TAU) * scatterAmt * 0.3
      );
      // Z depth — particles move toward/away from camera
      float zDepth = sin(phase * 0.5 + rnd4 * TAU) * scatter;
      float zScale = 1.0 / (1.0 + abs(zDepth) * 2.0); // perspective size
      // Displaced cell center for this particle
      vec2 particleCenter = cellCenter + displacement;
      // Distance from this pixel to the displaced particle center
      vec2 toParticle = uv - particleCenter;
      // Apply perspective scaling to distance check
      float particleRadius = cellSize.x * pSize * zScale * 0.5;
      float dist = length(toParticle / vec2(1.0, uResolution.x / uResolution.y));
      // Soft circular particle with glow
      float core = smoothstep(particleRadius, particleRadius * 0.3, dist);
      float glow = smoothstep(particleRadius * 2.5, particleRadius * 0.5, dist) * 0.3;
      float particle = core + glow;
      // 3D lighting — key light from top-right + fill from left
      vec3 normal = vec3(toParticle / max(particleRadius, 0.001), sqrt(max(0.0, 1.0 - dot(cellLocal, cellLocal) * 4.0)));
      normal = normalize(normal);
      vec3 lightDir = normalize(vec3(0.5, 0.7, 1.0));
      float diffuse = max(dot(normal, lightDir), 0.0);
      float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 16.0);
      float fillLight = max(dot(normal, normalize(vec3(-0.5, 0.3, 0.8))), 0.0) * 0.3;
      // Depth-based fade (farther particles are dimmer)
      float depthFade = 1.0 - abs(zDepth) * 0.5;
      // Combine
      vec3 lit = cellColor.rgb * (diffuse * 0.7 + fillLight + 0.3) + vec3(specular * 0.5);
      lit *= bright * depthFade;
      // Also check a few neighboring particles to fill gaps
      vec3 finalColor = vec3(0.0);
      float totalWeight = 0.0;
      for (int ox = -1; ox <= 1; ox++) {
        for (int oy = -1; oy <= 1; oy++) {
          vec2 nId = cellId + vec2(float(ox), float(oy));
          if (nId.x < 0.0 || nId.y < 0.0 || nId.x >= cellCount.x || nId.y >= cellCount.y) continue;
          vec2 nCenter = (nId + 0.5) * cellSize;
          float nr1 = hash(nId);
          float nr2 = hash(nId + 137.0);
          float nr3 = hash(nId + 271.0);
          float nr4 = hash(nId + 419.0);
          float nPhase = nr1 * TAU + uTime * speed * (0.5 + nr2 * 0.5);
          float nScatter = scatter * (0.5 + nr3 * 0.5);
          vec2 nDisp = vec2(sin(nPhase) * nScatter * 0.3, cos(nPhase * 0.7 + nr2 * TAU) * nScatter * 0.3);
          float nz = sin(nPhase * 0.5 + nr4 * TAU) * scatter;
          float nzScale = 1.0 / (1.0 + abs(nz) * 2.0);
          vec2 nPos = nCenter + nDisp;
          float nRadius = cellSize.x * pSize * nzScale * 0.5;
          float nDist = length((uv - nPos) / vec2(1.0, uResolution.x / uResolution.y));
          float nCore = smoothstep(nRadius, nRadius * 0.2, nDist);
          float nGlow = smoothstep(nRadius * 2.0, nRadius * 0.5, nDist) * 0.2;
          float nParticle = nCore + nGlow;
          if (nParticle > 0.01) {
            vec4 nColor = texture2D(uTexture, nCenter);
            float nDepthFade = 1.0 - abs(nz) * 0.5;
            float nDiffuse = 0.7 + 0.3 * (1.0 - nDist / nRadius);
            vec3 nLit = nColor.rgb * nDiffuse * bright * nDepthFade;
            // Z-sort: particles closer to camera draw on top
            float zWeight = 1.0 + nz;
            finalColor += nLit * nParticle * zWeight;
            totalWeight += nParticle * zWeight;
          }
        }
      }
      if (totalWeight > 0.01) {
        finalColor /= totalWeight;
        float alpha = clamp(totalWeight, 0.0, 1.0);
        outColor.rgb = mix(src.rgb * (1.0 - scatter * 0.7), finalColor, alpha);
      } else {
        outColor.rgb = src.rgb * (1.0 - scatter * 0.7);
      }
    }
    // ── Mode 23: Glint / Starburst ──
    else if (mode == 23) {
      float intensity = uAmount;
      float spikeLen = uAmount2 * 0.05;
      float thresh = uThreshold;
      float rotation = uAngle;
      float l = luma(src.rgb);
      float gate = smoothstep(thresh, thresh + 0.1, l);
      if (gate > 0.01) {
        // 6 directional spikes
        vec3 spikes = vec3(0.0);
        for (int i = 0; i < 6; i++) {
          float angle = float(i) * PI / 3.0 + rotation;
          vec2 dir = vec2(cos(angle), sin(angle)) * px;
          // Sample along spike direction
          vec3 spike = vec3(0.0);
          for (int j = 1; j <= 8; j++) {
            float t = float(j) / 8.0;
            float w = 1.0 - t;
            spike += texture2D(uTexture, clamp(uv + dir * t * spikeLen * uResolution.x, 0.0, 1.0)).rgb * w;
          }
          spike /= 4.0;
          spikes += spike;
        }
        spikes /= 6.0;
        outColor.rgb = src.rgb + spikes * gate * intensity;
      }
    }
    // ── Mode 24: Emboss Relight ──
    else if (mode == 24) {
      float strength = uAmount * 2.0;
      float angle = uAngle;
      vec3 lightColor = uColor;
      vec2 dir = vec2(cos(angle), sin(angle)) * px;
      float s1 = luma(texture2D(uTexture, uv - dir * 2.0).rgb);
      float s2 = luma(texture2D(uTexture, uv + dir * 2.0).rgb);
      float emboss = (s2 - s1) * strength;
      vec3 lit = src.rgb + emboss * lightColor;
      outColor.rgb = clamp(lit, 0.0, 1.0);
    }
    // ── Mode 25: Dot Matrix (hexagonal stagger + shape morph + per-cell rotation) ──
    else if (mode == 25) {
      float cellSize = mix(4.0, 20.0, uAmount);
      float spacing = 0.3 + uAmount2 * 0.5;
      float colorMix = uAmount3;

      // Hexagonal stagger: offset every other row by half a cell
      vec2 pxCoord = uv * uResolution / cellSize;
      float row = floor(pxCoord.y);
      float stagger = mod(row, 2.0) * 0.5;
      vec2 cell = floor(vec2(pxCoord.x + stagger, pxCoord.y));
      vec2 cellUv = (cell + 0.5 - vec2(stagger, 0.0)) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, clamp(cellUv, 0.0, 1.0));
      float l = luma(cellColor.rgb);
      vec2 local = fract(vec2(pxCoord.x + stagger, pxCoord.y)) - 0.5;

      // Per-cell rotation driven by hue
      float hAngle = atan(cellColor.g - cellColor.b, cellColor.r - 0.5) * 0.3;
      float ca = cos(hAngle), sa = sin(hAngle);
      local = vec2(local.x * ca - local.y * sa, local.x * sa + local.y * ca);

      // Shape morph: circle → rounded-square based on brightness
      float morph = smoothstep(0.3, 0.8, l);
      float circDist = length(local);
      float sqDist = max(abs(local.x), abs(local.y));
      float dist = mix(circDist, sqDist, morph);
      float dotRadius = l * spacing;
      float dot = 1.0 - smoothstep(dotRadius - 0.04, dotRadius + 0.04, dist);

      // Edge glow: subtle luminance halo
      float glow = exp(-max(0.0, dist - dotRadius) * 18.0) * l * 0.25;
      vec3 dotColor = mix(vec3(dot + glow), cellColor.rgb * (dot + glow), colorMix);
      outColor.rgb = dotColor;
    }
    // ── Mode 26: Matrix Rain (multi-stream cascade + procedural glyphs + color-reactive) ──
    else if (mode == 26) {
      float density = mix(6.0, 24.0, uAmount);
      float speed = 0.5 + uAmount2 * 3.0;
      float glow = uAmount3;
      float fadeDepth = uThreshold;

      vec2 cell = floor(uv * vec2(density, density * 2.0));
      float colId = hash(vec2(cell.x, 0.0));

      // Multi-stream: 3 overlapping cascades per column at different speeds
      float totalAlpha = 0.0;
      vec3 totalColor = vec3(0.0);
      for (int s = 0; s < 3; s++) {
        float streamOff = float(s) * 0.33;
        float fallSpeed = (0.3 + colId * 0.7 + streamOff * 0.4) * speed;
        float yOff = fract(colId * 137.0 + streamOff * 53.0 + uTime * fallSpeed * 0.1);
        float charY = fract(cell.y / (density * 2.0) + yOff);
        float brightness = pow(1.0 - charY, mix(2.0, 6.0, fadeDepth));

        // Procedural 5-segment glyph per cell (unique per stream)
        vec2 local = fract(uv * vec2(density, density * 2.0));
        float charSeed = hash(cell + floor(uTime * fallSpeed) + float(s) * 7.0);
        float cx = (local.x - 0.15) / 0.7;
        float cy = (local.y - 0.1) / 0.8;
        float inBounds = step(0.0, cx) * step(cx, 1.0) * step(0.0, cy) * step(cy, 1.0);

        // 5 horizontal segments (like a 7-segment display minus 2 verticals)
        float seg = 0.0;
        float segW = 0.12;
        if (fract(charSeed * 3.0) > 0.4) seg += step(abs(cy - 0.0) , segW) * step(0.15, cx) * step(cx, 0.85);
        if (fract(charSeed * 5.0) > 0.35) seg += step(abs(cy - 0.25), segW) * step(0.15, cx) * step(cx, 0.85);
        if (fract(charSeed * 7.0) > 0.3) seg += step(abs(cy - 0.5) , segW) * step(0.15, cx) * step(cx, 0.85);
        if (fract(charSeed * 11.0) > 0.35) seg += step(abs(cy - 0.75), segW) * step(0.15, cx) * step(cx, 0.85);
        if (fract(charSeed * 13.0) > 0.4) seg += step(abs(cy - 1.0) , segW) * step(0.15, cx) * step(cx, 0.85);
        // Verticals
        if (fract(charSeed * 17.0) > 0.5) seg += step(abs(cx - 0.15), 0.08) * step(0.0, cy) * step(cy, 0.5);
        if (fract(charSeed * 19.0) > 0.5) seg += step(abs(cx - 0.85), 0.08) * step(0.5, cy) * step(cy, 1.0);

        float combined = clamp(seg, 0.0, 1.0) * inBounds;

        float streamAlpha = combined * brightness * (1.0 - streamOff * 0.5);
        totalAlpha += streamAlpha;
        totalColor += streamAlpha * vec3(0.08 + streamOff * 0.1, 0.85 - streamOff * 0.2, 0.25 + streamOff * 0.15);
      }
      totalAlpha = clamp(totalAlpha, 0.0, 1.0);
      totalColor = totalAlpha > 0.001 ? totalColor / max(totalAlpha, 0.001) : vec3(0.0);

      // Source image color tints the rain
      vec4 srcCell = texture2D(uTexture, (cell + 0.5) / vec2(density, density * 2.0));
      float srcLuma = luma(srcCell.rgb);
      totalColor += totalColor * glow * totalAlpha;
      outColor.rgb = mix(src.rgb * 0.08, totalColor * (0.6 + srcLuma * 0.4), 0.4 + totalAlpha * 0.6);
    }
    // ── Mode 27: Binary Code (8-bit columns + wave animation + phosphor glow) ──
    else if (mode == 27) {
      float cellSize = mix(4.0, 20.0, uAmount);
      float contrast = 0.5 + uAmount2 * 1.5;
      float colorMix = uAmount3;

      // Each cell is part of an 8-bit column (byte display)
      vec2 cell = floor(uv * uResolution / cellSize);
      vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, cellUv);
      float l = luma(cellColor.rgb);
      l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
      vec2 local = fract(uv * uResolution / cellSize);

      // Map luminance to 8-bit value (0-255), display as column of 8 bits
      int byteVal = int(l * 255.0);
      int bitRow = int(mod(cell.y, 8.0));
      // Wave animation: bits shift through columns over time
      float wavePhase = sin(cell.x * 0.3 + uTime * 1.5) * 2.0;
      bitRow = int(mod(float(bitRow) + wavePhase, 8.0));
      int bitVal = int(mod(floor(float(byteVal) / pow(2.0, float(bitRow))), 2.0));
      float isOne = float(bitVal);

      // Draw '1': filled rounded rect with notch
      float rx = smoothstep(0.0, 0.12, local.x) * smoothstep(1.0, 0.88, local.x);
      float ry = smoothstep(0.0, 0.12, local.y) * smoothstep(1.0, 0.88, local.y);
      float one = rx * ry * 0.9;
      // Notch in top-right corner to distinguish from 0
      one *= 1.0 - step(0.7, local.x) * step(0.7, local.y) * 0.7;

      // Draw '0': hollow rounded rect (border only)
      float border = rx * ry;
      float inner = smoothstep(0.15, 0.25, local.x) * smoothstep(0.85, 0.75, local.x)
                   * smoothstep(0.15, 0.25, local.y) * smoothstep(0.85, 0.75, local.y);
      float zero = border * (1.0 - inner * 0.85);

      float charMask = mix(zero * 0.3, one, isOne);

      // Phosphor glow: brighter bits bleed into neighbors
      float glowR = exp(-length(local - 0.5) * 4.0) * isOne * l * 0.2;
      charMask += glowR;
      charMask *= 0.3 + l * 0.7;

      // Tint: ones are warm, zeros are cool
      vec3 tint = mix(vec3(0.4, 0.6, 1.0), vec3(1.0, 0.85, 0.5), isOne);
      vec3 binColor = mix(tint * charMask, cellColor.rgb * charMask, colorMix);
      outColor.rgb = binColor;
    }
    // ── Mode 28: Crosshatch (gradient-aligned strokes + variable width + ink pooling) ──
    else if (mode == 28) {
      float lineDensity = mix(20.0, 120.0, uAmount);
      float lineThick = 0.02 + uAmount2 * 0.08;
      float angleSpread = 0.5 + uAmount3;
      float darkThresh = uThreshold;

      // Compute local image gradient to align strokes with edges
      float lC = luma(src.rgb);
      float lR = luma(texture2D(uTexture, uv + vec2(1.0 / uResolution.x, 0.0)).rgb);
      float lU = luma(texture2D(uTexture, uv + vec2(0.0, 1.0 / uResolution.y)).rgb);
      float gx = lR - lC;
      float gy = lU - lC;
      float gradMag = length(vec2(gx, gy));
      float gradAngle = atan(gy, gx);

      // 4 hatch layers: 2 aligned with gradient, 2 perpendicular
      vec2 p = uv * lineDensity;
      float a1 = gradAngle + 0.0;
      float a2 = gradAngle + 1.5708;
      float a3 = angleSpread * 0.78;
      float a4 = -angleSpread * 0.78;

      // Variable line width: thicker in darker areas
      float thickScale = 1.0 + (1.0 - lC) * 0.8;
      float lt = lineThick * thickScale;

      float h1 = abs(fract(p.x * cos(a1) + p.y * sin(a1)) - 0.5);
      float h2 = abs(fract(p.x * cos(a2) + p.y * sin(a2)) - 0.5);
      float h3 = abs(fract(p.x * cos(a3) + p.y * sin(a3) + 0.3) - 0.5);
      float h4 = abs(fract(p.x * cos(a4) + p.y * sin(a4) + 0.6) - 0.5);

      float line1 = 1.0 - smoothstep(0.0, lt, h1);
      float line2 = 1.0 - smoothstep(0.0, lt * 0.9, h2);
      float line3 = 1.0 - smoothstep(0.0, lt * 0.7, h3);
      float line4 = 1.0 - smoothstep(0.0, lt * 0.5, h4);

      // Accumulate hatch: gradient-aligned strokes appear first
      float hatch = 0.0;
      hatch += line1 * step(lC, darkThresh) * (0.7 + gradMag * 3.0);
      hatch += line2 * step(lC, darkThresh * 0.65);
      hatch += line3 * step(lC, darkThresh * 0.35);
      hatch += line4 * step(lC, darkThresh * 0.15);

      // Ink pooling: darken intersections of crossing lines
      float pooling = line1 * line2 * 0.15 + line3 * line4 * 0.1;
      hatch += pooling * step(lC, darkThresh * 0.5);

      hatch = clamp(hatch, 0.0, 1.0);

      // Paper tone: slight warm tint instead of pure white
      vec3 paper = vec3(0.98, 0.96, 0.92);
      vec3 ink = vec3(0.08, 0.06, 0.12);
      outColor.rgb = mix(paper, ink, hatch);
    }
    // ── Mode 29: Block Mosaic (directional fill + Bayer dither + edge-aware borders) ──
    else if (mode == 29) {
      float cellSize = mix(4.0, 20.0, uAmount);
      float contrast = 0.5 + uAmount2 * 1.5;
      float colorMix = uAmount3;
      vec2 cell = floor(uv * uResolution / cellSize);
      vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, cellUv);
      float l = luma(cellColor.rgb);
      l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
      vec2 local = fract(uv * uResolution / cellSize);

      // Directional fill: fill direction based on local gradient
      vec4 neighborR = texture2D(uTexture, cellUv + vec2(cellSize / uResolution.x, 0.0));
      vec4 neighborU = texture2D(uTexture, cellUv + vec2(0.0, cellSize / uResolution.y));
      float gradX = luma(neighborR.rgb) - l;
      float gradY = luma(neighborU.rgb) - l;
      float gradDir = atan(gradY, gradX);
      // Rotate local coords by gradient direction to vary fill orientation
      float rc = cos(gradDir), rs = sin(gradDir);
      vec2 rl = vec2(local.x * rc - local.y * rs, local.x * rs + local.y * rc);
      float fillAxis = rl.x * 0.5 + 0.5; // 0-1 along gradient

      // Smooth multi-level fill with Bayer-like ordered dither
      int bx = int(mod(local.x * 4.0, 4.0));
      int by = int(mod(local.y * 4.0, 4.0));
      // 4x4 Bayer matrix thresholds (normalized 0-1)
      float bayerThresholds[16];
      bayerThresholds[0] = 0.0/16.0;  bayerThresholds[1] = 8.0/16.0;
      bayerThresholds[2] = 2.0/16.0;  bayerThresholds[3] = 10.0/16.0;
      bayerThresholds[4] = 12.0/16.0; bayerThresholds[5] = 4.0/16.0;
      bayerThresholds[6] = 14.0/16.0; bayerThresholds[7] = 6.0/16.0;
      bayerThresholds[8] = 3.0/16.0;  bayerThresholds[9] = 11.0/16.0;
      bayerThresholds[10] = 1.0/16.0; bayerThresholds[11] = 9.0/16.0;
      bayerThresholds[12] = 15.0/16.0;bayerThresholds[13] = 7.0/16.0;
      bayerThresholds[14] = 13.0/16.0;bayerThresholds[15] = 5.0/16.0;
      float bayer = bayerThresholds[by * 4 + bx];

      float blockFill = step(bayer, l);

      // Edge-aware borders: draw thin gap between cells at high-contrast edges
      float edgeX = abs(luma(neighborR.rgb) - l);
      float edgeY = abs(luma(neighborU.rgb) - l);
      float borderX = smoothstep(0.95, 1.0, local.x) * smoothstep(0.08, 0.15, edgeX);
      float borderY = smoothstep(0.95, 1.0, local.y) * smoothstep(0.08, 0.15, edgeY);
      float border = max(borderX, borderY);
      blockFill *= 1.0 - border * 0.7;

      vec3 blockColor = mix(vec3(blockFill), cellColor.rgb * blockFill, colorMix);
      outColor.rgb = blockColor;
    }
    // ── Mode 30: Number Grid ──
    else if (mode == 30) {
      float cellSize = mix(6.0, 24.0, uAmount);
      float contrast = 0.5 + uAmount2 * 1.5;
      float colorMix = uAmount3;
      vec2 cell = floor(uv * uResolution / cellSize);
      vec2 cellUv = (cell + 0.5) * cellSize / uResolution;
      vec4 cellColor = texture2D(uTexture, cellUv);
      float l = luma(cellColor.rgb);
      l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
      vec2 local = fract(uv * uResolution / cellSize);
      // Map luminance 0-1 to digit 0-9, each digit is a procedural pattern
      int digit = int(l * 9.99);
      float charMask = 0.0;
      float cx = local.x;
      float cy = 1.0 - local.y; // flip y for natural reading
      // Simplified 3x5 grid digit rendering
      float gx = floor(cx * 3.0);
      float gy = floor(cy * 5.0);
      float gi = gy * 3.0 + gx;
      // Segment lookup per digit (each digit encoded as filled cells in a 3x5 grid)
      if (digit == 0) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==5.0||gi==6.0||gi==8.0||gi==9.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 1) { charMask = (gi==1.0||gi==4.0||gi==7.0||gi==10.0||gi==13.0) ? 1.0 : 0.0; }
      else if (digit == 2) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==9.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 3) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 4) { charMask = (gi==0.0||gi==2.0||gi==3.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==11.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 5) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==6.0||gi==7.0||gi==8.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 6) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==6.0||gi==7.0||gi==8.0||gi==9.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 7) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==5.0||gi==8.0||gi==11.0||gi==14.0) ? 1.0 : 0.0; }
      else if (digit == 8) { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==9.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; }
      else { charMask = (gi==0.0||gi==1.0||gi==2.0||gi==3.0||gi==5.0||gi==6.0||gi==7.0||gi==8.0||gi==11.0||gi==12.0||gi==13.0||gi==14.0) ? 1.0 : 0.0; } // 9
      // Padding: only show if within inner cell area
      float inCell = step(0.1, cx) * step(cx, 0.9) * step(0.05, cy) * step(cy, 0.95);
      charMask *= inCell;
      vec3 numColor = mix(vec3(charMask), cellColor.rgb * charMask, colorMix);
      outColor.rgb = numColor;
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`;

// Mode mapping for premiumPackShader (25 new unique modes)
export const premiumEffectModes: Record<string, number> = {
  filmicTonemap: 0,
  selectiveColor: 1,
  falseColor: 2,
  shadowRecovery: 3,
  highlightRolloff: 4,
  halation: 5,
  anamorphicStreak: 6,
  lensDirt: 7,
  defocusBokeh: 8,
  diffusionPromist: 9,
  ascii: 10,
  comicInk: 11,
  datamoshLite: 12,
  scanlineDrift: 13,
  tapeDropout: 14,
  polarTransform: 15,
  rippleCaustics: 16,
  shockwave: 17,
  drosteRecursive: 18,
  slitScan: 19,
  volumetricFogOverlay: 20,
  rainFogSnowOverlay: 21,
  particleOverlayFx: 22,
  glintStarburst: 23,
  embossRelight: 24,
  dotMatrix: 25,
  matrixRain: 26,
  binaryCode: 27,
  crosshatch: 28,
  blockMosaic: 29,
  numberGrid: 30,
};
