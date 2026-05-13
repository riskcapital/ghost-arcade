// Basic dedicated effect shaders - each effect has its own GLSL implementation
// Organized: vertex, masking, color, stylize, blur, distort, generate, vj-simple

// Passthrough vertex shader for all effects
export const effectVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ============================================================================
// VIGNETTE EFFECT - Fades to TRANSPARENT at edges (not black)
// ============================================================================
export const vignetteShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSize;      // 0-1, how far vignette extends from center
  uniform float uSoftness;  // 0-1, edge softness
  uniform float uRoundness; // 0-1, circular vs rectangular
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Calculate distance from center
    vec2 center = vec2(0.5);
    vec2 pos = vUv - center;

    // Mix between rectangular and circular distance
    float rectDist = max(abs(pos.x), abs(pos.y)) * 2.0;
    float circDist = length(pos) * 2.0;
    float dist = mix(rectDist, circDist, uRoundness);

    // Calculate vignette factor with smooth falloff
    float vignette = 1.0 - smoothstep(uSize - uSoftness * 0.5, uSize + uSoftness * 0.5, dist);

    // Fade alpha to transparent (not darken to black)
    gl_FragColor = vec4(texColor.rgb, texColor.a * vignette);
  }
`;

// ============================================================================
// EDGE FEATHER EFFECT - Independent feathering on each side
// ============================================================================
export const edgeFeatherShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTop;       // 0-1 feather amount from top
  uniform float uBottom;    // 0-1 feather amount from bottom
  uniform float uLeft;      // 0-1 feather amount from left
  uniform float uRight;     // 0-1 feather amount from right
  uniform float uSoftness;  // 0-1 overall softness
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    float alpha = 1.0;

    // Top edge feather (y = 1 is top)
    if (uTop > 0.0) {
      alpha *= smoothstep(1.0, 1.0 - uTop, vUv.y);
    }

    // Bottom edge feather (y = 0 is bottom)
    if (uBottom > 0.0) {
      alpha *= smoothstep(0.0, uBottom, vUv.y);
    }

    // Left edge feather (x = 0 is left)
    if (uLeft > 0.0) {
      alpha *= smoothstep(0.0, uLeft, vUv.x);
    }

    // Right edge feather (x = 1 is right)
    if (uRight > 0.0) {
      alpha *= smoothstep(1.0, 1.0 - uRight, vUv.x);
    }

    // Apply overall softness modifier
    alpha = pow(alpha, 1.0 / max(uSoftness + 0.5, 0.1));

    gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
  }
`;

// ============================================================================
// COLORAMA EFFECT - Cosine palette with auto-cycling
// Uses the formula: color = a + b * cos(2π * (c * t + d))
// where t is the input luminance + time offset for animation
// ============================================================================
export const coloramaShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uPalette;       // 0-7 preset palettes
  uniform float uOffset;        // 0-1 manual offset through palette
  uniform float uSpeed;         // 0-2 auto-cycle speed (0 = off)
  uniform float uContrast;      // 0.5-2 luminance contrast
  uniform float uMix;           // 0-1 blend with original
  uniform float uTime;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  // Cosine palette function: a + b * cos(2π * (c * t + d))
  vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
  }

  // Preset palettes (a, b, c, d vectors for cosine palette)
  vec3 getPaletteColor(float t, int palette) {
    vec3 a, b, c, d;

    if (palette == 0) {
      // Rainbow (classic)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.33, 0.67);
    }
    else if (palette == 1) {
      // Sunset (warm oranges and purples)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.1, 0.2);
    }
    else if (palette == 2) {
      // Ocean (teals and blues)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.3, 0.2, 0.2);
    }
    else if (palette == 3) {
      // Neon (vibrant pinks and cyans)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 0.5);
      d = vec3(0.8, 0.9, 0.3);
    }
    else if (palette == 4) {
      // Fire (reds, oranges, yellows)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 0.7, 0.4);
      d = vec3(0.0, 0.15, 0.2);
    }
    else if (palette == 5) {
      // Forest (greens and browns)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.1, 0.0);
    }
    else if (palette == 6) {
      // Ice (whites, blues, cyans)
      a = vec3(0.8, 0.8, 0.9);
      b = vec3(0.2, 0.4, 0.2);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.25, 0.25);
    }
    else {
      // Psychedelic (rapid color changes)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(2.0, 1.0, 0.0);
      d = vec3(0.5, 0.2, 0.25);
    }

    return cosinePalette(t, a, b, c, d);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 color = texColor.rgb;

    // Calculate luminance
    float lum = dot(color, vec3(0.299, 0.587, 0.114));

    // Apply contrast to luminance
    lum = (lum - 0.5) * uContrast + 0.5;
    lum = clamp(lum, 0.0, 1.0);

    // Add manual offset and time-based cycling
    float t = lum + uOffset + uTime * uSpeed;

    // Get palette color
    int paletteIndex = int(uPalette);
    vec3 paletteColor = getPaletteColor(t, paletteIndex);

    // Mix with original based on mix parameter
    vec3 finalColor = mix(color, paletteColor, uMix);

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`;

// ============================================================================
// INVERT EFFECT - Simple color inversion
// ============================================================================
export const invertShader = /* glsl */ `
  uniform sampler2D uTexture;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    gl_FragColor = vec4(1.0 - texColor.rgb, texColor.a);
  }
`;

// ============================================================================
// PREMIUM DITHER EFFECT - Professional-grade dithering with error diffusion
// ============================================================================
export const ditherShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uType;       // 0=bayer, 1=blueNoise, 2=halftone, 3=atkinson, 4=floydSteinberg
  uniform float uIntensity;  // 0-1
  uniform float uScale;      // 1-16
  uniform float uColorDepth; // 1-8 bits
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  // High-quality Bayer 8x8 matrix with proper thresholds
  float bayer8(vec2 pos) {
    vec2 p = mod(pos, 8.0);
    float x = p.x;
    float y = p.y;

    // Recursive Bayer matrix calculation (much cleaner than lookup)
    float threshold = 0.0;
    float divisor = 64.0;

    // 8x8 Bayer using bit manipulation logic
    for (int i = 0; i < 3; i++) {
      float mx = mod(x, 2.0);
      float my = mod(y, 2.0);
      threshold += (mx + my * 2.0) * divisor / 4.0;
      divisor /= 4.0;
      x = floor(x / 2.0);
      y = floor(y / 2.0);
    }

    return threshold / 64.0;
  }

  // Blue noise approximation using layered randomness
  float blueNoise(vec2 pos) {
    float n = 0.0;
    float scale = 1.0;

    for (int i = 0; i < 4; i++) {
      vec2 p = pos * scale;
      float r = fract(sin(dot(floor(p), vec2(12.9898, 78.233) + float(i) * 100.0)) * 43758.5453);
      n += r / scale;
      scale *= 2.0;
    }

    return fract(n * 0.25 + uTime * 0.01);
  }

  // Premium halftone with angle and smooth dots
  float halftone(vec2 pos, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    mat2 rot = mat2(c, -s, s, c);
    vec2 p = rot * pos;

    vec2 nearest = floor(p) + 0.5;
    float dist = length(p - nearest);

    // Smooth dot with antialiasing
    return smoothstep(0.5, 0.3, dist);
  }

  // Atkinson-style dithering pattern (used by old Mac)
  float atkinsonPattern(vec2 pos) {
    vec2 p = mod(pos, 4.0);
    float pattern = 0.0;

    // Classic Atkinson-style sparse pattern
    if ((p.x < 2.0 && p.y < 2.0) || (p.x >= 2.0 && p.y >= 2.0)) {
      pattern = mod(p.x + p.y, 2.0);
    } else {
      pattern = 1.0 - mod(p.x + p.y, 2.0);
    }

    return pattern * 0.5 + bayer8(pos) * 0.5;
  }

  // Floyd-Steinberg style error propagation simulation
  float floydSteinberg(vec2 pos, vec3 color) {
    // Simulated error diffusion using neighbor sampling
    float lum = dot(color, vec3(0.299, 0.587, 0.114));

    // Sample neighbors to simulate error propagation
    vec2 offset1 = vec2(1.0, 0.0) / uResolution * uScale;
    vec2 offset2 = vec2(-1.0, 1.0) / uResolution * uScale;
    vec2 offset3 = vec2(0.0, 1.0) / uResolution * uScale;
    vec2 offset4 = vec2(1.0, 1.0) / uResolution * uScale;

    float n1 = dot(texture2D(uTexture, vUv + offset1).rgb, vec3(0.299, 0.587, 0.114));
    float n2 = dot(texture2D(uTexture, vUv + offset2).rgb, vec3(0.299, 0.587, 0.114));
    float n3 = dot(texture2D(uTexture, vUv + offset3).rgb, vec3(0.299, 0.587, 0.114));
    float n4 = dot(texture2D(uTexture, vUv + offset4).rgb, vec3(0.299, 0.587, 0.114));

    // Weighted average simulating error propagation
    float errorSim = (lum * 16.0 + n1 * 7.0 + n2 * 3.0 + n3 * 5.0 + n4 * 1.0) / 32.0;

    return fract(errorSim * 8.0 + bayer8(pos) * 0.5);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 color = texColor.rgb;

    // Calculate scaled pixel position
    vec2 pixelPos = vUv * uResolution / uScale;

    // Get threshold based on dither type - use float comparisons for WebGL compat
    float threshold = 0.0;

    if (uType < 0.5) {
      // Classic Bayer ordered dithering
      threshold = bayer8(pixelPos);
    } else if (uType < 1.5) {
      // Blue noise dithering (film-like grain)
      threshold = blueNoise(pixelPos);
    } else if (uType < 2.5) {
      // Halftone printing style
      float lumR = color.r;
      float lumG = color.g;
      float lumB = color.b;

      // CMYK-style halftone angles
      float hR = halftone(pixelPos, 0.261799);  // 15 degrees
      float hG = halftone(pixelPos, 1.309);     // 75 degrees
      float hB = halftone(pixelPos, 0.0);       // 0 degrees

      vec3 halftoneColor = vec3(
        step(1.0 - lumR, hR),
        step(1.0 - lumG, hG),
        step(1.0 - lumB, hB)
      );

      gl_FragColor = vec4(mix(color, halftoneColor, uIntensity), texColor.a);
      return;
    } else if (uType < 3.5) {
      // Atkinson dithering (classic Mac style)
      threshold = atkinsonPattern(pixelPos);
    } else {
      // Floyd-Steinberg simulation
      threshold = floydSteinberg(pixelPos, color);
    }

    // Apply threshold with intensity control
    threshold = (threshold - 0.5) * uIntensity;

    // Quantize to color depth
    float levels = pow(2.0, uColorDepth);
    vec3 dithered = color + vec3(threshold) / levels;
    dithered = floor(dithered * levels + 0.5) / levels;

    gl_FragColor = vec4(clamp(dithered, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// VHS EFFECT - Tracking, noise, distortion, color bleed, scanlines
// ============================================================================
export const vhsShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTracking;    // 0-1
  uniform float uNoise;       // 0-1
  uniform float uDistortion;  // 0-1
  uniform float uColorBleed;  // 0-1
  uniform float uScanlines;   // 0-1
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 uv = vUv;

    // Tracking distortion - horizontal offset that changes over time
    float trackingOffset = sin(uv.y * 10.0 + uTime * 3.0) * uTracking * 0.02;
    trackingOffset += step(0.99, random(vec2(uTime * 0.1, uv.y))) * uTracking * 0.1;
    uv.x += trackingOffset;

    // Wave distortion
    uv.x += sin(uv.y * 50.0 + uTime * 10.0) * uDistortion * 0.003;
    uv.y += sin(uv.x * 30.0 + uTime * 8.0) * uDistortion * 0.002;

    // Sample with color bleeding (chromatic aberration)
    float bleedAmount = uColorBleed * 0.005;
    vec4 color;
    color.r = texture2D(uTexture, vec2(uv.x + bleedAmount, uv.y)).r;
    color.g = texture2D(uTexture, uv).g;
    color.b = texture2D(uTexture, vec2(uv.x - bleedAmount, uv.y)).b;
    color.a = texture2D(uTexture, uv).a;

    // Add noise
    float n = noise(uv * uResolution * 0.5 + uTime * 100.0);
    color.rgb += (n - 0.5) * uNoise * 0.3;

    // Scanlines
    float scanline = sin(vUv.y * uResolution.y * 2.0) * 0.5 + 0.5;
    color.rgb *= 1.0 - uScanlines * 0.3 * scanline;

    // VHS color reduction and slight desaturation
    vec3 luminance = vec3(0.299, 0.587, 0.114);
    float lum = dot(color.rgb, luminance);
    color.rgb = mix(color.rgb, vec3(lum), uTracking * 0.2);

    gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
  }
`;

// ============================================================================
// GLITCH EFFECT - Digital glitching with RGB split and block displacement
// ============================================================================
export const glitchShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;   // 0-1
  uniform float uSpeed;       // 0-2
  uniform float uBlockSize;   // 0-1
  uniform float uRGBSplit;    // 0-1
  uniform float uJitter;      // 0-1
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float random(float seed) {
    return fract(sin(seed * 12.9898) * 43758.5453);
  }

  float random2(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime * uSpeed;

    // Random glitch trigger based on time
    float glitchTrigger = step(0.95, random(floor(t * 10.0))) * uIntensity;

    // Block displacement
    float blockHeight = max(uBlockSize * 0.1, 0.01);
    float block = floor(uv.y / blockHeight);
    float blockRandom = random(block + floor(t * 5.0));

    if (blockRandom > 1.0 - uIntensity * 0.3 && glitchTrigger > 0.0) {
      // Horizontal block shift
      uv.x += (random(block + t) - 0.5) * uIntensity * 0.2;
    }

    // Line jitter
    float lineJitter = (random2(vec2(floor(uv.y * uResolution.y), floor(t * 20.0))) - 0.5);
    uv.x += lineJitter * uJitter * 0.01 * glitchTrigger;

    // RGB split with glitch trigger
    float rgbAmount = uRGBSplit * 0.02 * (1.0 + glitchTrigger * 3.0);
    vec4 color;
    color.r = texture2D(uTexture, vec2(uv.x + rgbAmount, uv.y)).r;
    color.g = texture2D(uTexture, uv).g;
    color.b = texture2D(uTexture, vec2(uv.x - rgbAmount, uv.y)).b;
    color.a = texture2D(uTexture, uv).a;

    // Random color inversion on glitch
    if (random(floor(t * 15.0) + block) > 0.98 && glitchTrigger > 0.0) {
      color.rgb = 1.0 - color.rgb;
    }

    gl_FragColor = color;
  }
`;

// ============================================================================
// RGB SHIFT EFFECT - Chromatic aberration
// ============================================================================
export const rgbShiftShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0-50 pixels
  uniform float uAngle;   // 0-360 degrees
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    float angle = uAngle * 3.14159 / 180.0;
    vec2 dir = vec2(cos(angle), sin(angle)) * uAmount / uResolution;

    vec4 color;
    color.r = texture2D(uTexture, vUv + dir).r;
    color.g = texture2D(uTexture, vUv).g;
    color.b = texture2D(uTexture, vUv - dir).b;
    color.a = texture2D(uTexture, vUv).a;

    gl_FragColor = color;
  }
`;

// ============================================================================
// SCANLINES EFFECT - CRT-style scanlines
// ============================================================================
export const scanlinesShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity; // 0-1
  uniform float uCount;     // 50-500
  uniform float uSpeed;     // 0-2 (scroll speed)
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Animated scanlines
    float scanlinePos = vUv.y * uCount + uTime * uSpeed * 50.0;
    float scanline = sin(scanlinePos * 3.14159) * 0.5 + 0.5;

    // Apply scanline darkening
    float intensity = 1.0 - uIntensity * scanline * 0.5;

    gl_FragColor = vec4(texColor.rgb * intensity, texColor.a);
  }
`;

// ============================================================================
// PIXELATE EFFECT - Pixel mosaic
// ============================================================================
export const pixelateShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSize;  // 1-64 pixel size
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 pixelSize = uSize / uResolution;
    vec2 pixelatedUV = floor(vUv / pixelSize) * pixelSize + pixelSize * 0.5;

    gl_FragColor = texture2D(uTexture, pixelatedUV);
  }
`;

// ============================================================================
// BLUR EFFECT - Simple box blur (fast approximation)
// ============================================================================
export const blurShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRadius;  // 0-20
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 color = vec4(0.0);
    float total = 0.0;

    for (int x = -10; x <= 10; x++) {
      for (int y = -10; y <= 10; y++) {
        if (abs(float(x)) > uRadius || abs(float(y)) > uRadius) continue;

        vec2 offset = vec2(float(x), float(y)) / uResolution;
        color += texture2D(uTexture, vUv + offset);
        total += 1.0;
      }
    }

    gl_FragColor = color / total;
  }
`;

// ============================================================================
// SHARPEN EFFECT - Unsharp mask
// ============================================================================
export const sharpenShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0-2
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 texel = 1.0 / uResolution;

    vec4 center = texture2D(uTexture, vUv);
    vec4 left = texture2D(uTexture, vUv - vec2(texel.x, 0.0));
    vec4 right = texture2D(uTexture, vUv + vec2(texel.x, 0.0));
    vec4 top = texture2D(uTexture, vUv + vec2(0.0, texel.y));
    vec4 bottom = texture2D(uTexture, vUv - vec2(0.0, texel.y));

    // Laplacian sharpen kernel
    vec4 sharpened = center * (1.0 + 4.0 * uAmount) - (left + right + top + bottom) * uAmount;

    gl_FragColor = vec4(clamp(sharpened.rgb, 0.0, 1.0), center.a);
  }
`;

// ============================================================================
// NOISE EFFECT - Static or animated noise overlay
// ============================================================================
export const noiseShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0-1
  uniform float uType;    // 0=static, 1=animated
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    vec2 noiseSeed = vUv * uResolution;
    if (uType > 0.5) {
      noiseSeed += uTime * 100.0;
    }

    float n = random(noiseSeed);
    vec3 noisy = texColor.rgb + (n - 0.5) * uAmount;

    gl_FragColor = vec4(clamp(noisy, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// KALEIDOSCOPE EFFECT - Mirror segments around center
// ============================================================================
export const kaleidoscopeShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSegments;  // 2-16
  uniform float uAngle;     // 0-360 rotation offset
  varying vec2 vUv;

  void main() {
    vec2 center = vec2(0.5);
    vec2 pos = vUv - center;

    float angle = atan(pos.y, pos.x);
    float radius = length(pos);

    // Add rotation offset
    angle += uAngle * 3.14159 / 180.0;

    // Calculate segment angle
    float segmentAngle = 3.14159 * 2.0 / uSegments;

    // Mirror within segment
    angle = mod(angle, segmentAngle);
    if (angle > segmentAngle * 0.5) {
      angle = segmentAngle - angle;
    }

    // Convert back to UV coordinates
    vec2 newUV = center + vec2(cos(angle), sin(angle)) * radius;

    // Clamp to valid UV range
    newUV = clamp(newUV, 0.0, 1.0);

    gl_FragColor = texture2D(uTexture, newUV);
  }
`;

// ============================================================================
// MIRROR EFFECT - Simple axis mirroring
// ============================================================================
export const mirrorShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAxis;      // 0=horizontal, 1=vertical, 2=both
  uniform float uPosition;  // 0-1 mirror line position
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    int axis = int(uAxis);

    if (axis == 0 || axis == 2) {
      // Horizontal mirror (left-right)
      if (uv.x > uPosition) {
        uv.x = uPosition - (uv.x - uPosition);
      }
    }

    if (axis == 1 || axis == 2) {
      // Vertical mirror (top-bottom)
      if (uv.y > uPosition) {
        uv.y = uPosition - (uv.y - uPosition);
      }
    }

    gl_FragColor = texture2D(uTexture, clamp(uv, 0.0, 1.0));
  }
`;

// ============================================================================
// PLASMA EFFECT - Animated psychedelic color gradients
// ============================================================================
export const plasmaShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSpeed;       // 0-2 animation speed
  uniform float uScale;       // 1-20 pattern scale
  uniform float uComplexity;  // 1-5 pattern complexity
  uniform float uPalette;     // 0=rainbow, 1=fire, 2=ocean, 3=neon, 4=matrix
  uniform float uTime;
  varying vec2 vUv;

  vec3 rainbowPalette(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  }

  vec3 firePalette(float t) {
    return vec3(
      smoothstep(0.0, 0.5, t),
      smoothstep(0.3, 0.7, t) * 0.7,
      smoothstep(0.7, 1.0, t) * 0.3
    );
  }

  vec3 oceanPalette(float t) {
    return vec3(
      smoothstep(0.5, 1.0, t) * 0.3,
      smoothstep(0.2, 0.8, t) * 0.6 + 0.2,
      0.4 + 0.6 * t
    );
  }

  vec3 neonPalette(float t) {
    float r = sin(t * 6.28318) * 0.5 + 0.5;
    float g = sin(t * 6.28318 + 2.094) * 0.5 + 0.5;
    float b = sin(t * 6.28318 + 4.188) * 0.5 + 0.5;
    return pow(vec3(r, g, b), vec3(0.5)); // Boost brightness
  }

  vec3 matrixPalette(float t) {
    return vec3(0.0, t * 0.8 + 0.2, t * 0.3);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    float t = uTime * uSpeed;

    vec2 p = vUv * uScale;

    // Multi-layer plasma calculation
    float plasma = 0.0;

    // Base sine waves
    plasma += sin(p.x * 10.0 + t);
    plasma += sin(p.y * 10.0 + t * 1.1);
    plasma += sin((p.x + p.y) * 10.0 + t * 0.5);
    plasma += sin(sqrt(p.x * p.x + p.y * p.y) * 10.0 + t * 0.7);

    // Add complexity layers
    if (uComplexity > 1.0) {
      plasma += sin(p.x * 5.0 + sin(p.y * 3.0 + t) * 2.0);
    }
    if (uComplexity > 2.0) {
      plasma += sin(p.y * 7.0 + sin(p.x * 5.0 + t * 1.3) * 2.0);
    }
    if (uComplexity > 3.0) {
      plasma += sin(length(p - vec2(0.5 * uScale)) * 8.0 - t * 2.0);
    }
    if (uComplexity > 4.0) {
      plasma += sin(atan(p.y - 0.5 * uScale, p.x - 0.5 * uScale) * 5.0 + t);
    }

    // Normalize plasma value to 0-1
    plasma = plasma / (4.0 + max(uComplexity - 1.0, 0.0)) * 0.5 + 0.5;

    // Apply palette
    vec3 plasmaColor;
    int paletteType = int(uPalette);

    if (paletteType == 0) {
      plasmaColor = rainbowPalette(plasma);
    } else if (paletteType == 1) {
      plasmaColor = firePalette(plasma);
    } else if (paletteType == 2) {
      plasmaColor = oceanPalette(plasma);
    } else if (paletteType == 3) {
      plasmaColor = neonPalette(plasma);
    } else {
      plasmaColor = matrixPalette(plasma);
    }

    // Blend with original image
    vec3 finalColor = texColor.rgb * plasmaColor;

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`;

// ============================================================================
// POSTERIZE EFFECT - Reduce color levels
// ============================================================================
export const posterizeShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uLevels;  // 2-32 color levels
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    float levels = max(2.0, floor(uLevels));
    vec3 posterized = floor(texColor.rgb * levels) / (levels - 1.0);

    gl_FragColor = vec4(posterized, texColor.a);
  }
`;

// ============================================================================
// EDGE DETECTION EFFECT - Sobel, Laplacian, Prewitt, Frei-Chen
// ============================================================================
export const edgeDetectShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uThreshold;   // 0-1 edge threshold
  uniform float uThickness;   // 0.5-3 line thickness
  uniform float uMode;        // 0=sobel, 1=laplacian, 2=prewitt, 3=frei-chen
  uniform float uInvert;      // 0=normal, 1=inverted
  uniform vec2 uResolution;
  varying vec2 vUv;

  float edgeLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 texel = uThickness / uResolution;

    // Sample 3x3 neighborhood
    float tl = edgeLum(texture2D(uTexture, vUv + vec2(-texel.x, texel.y)).rgb);
    float tc = edgeLum(texture2D(uTexture, vUv + vec2(0.0, texel.y)).rgb);
    float tr = edgeLum(texture2D(uTexture, vUv + vec2(texel.x, texel.y)).rgb);
    float ml = edgeLum(texture2D(uTexture, vUv + vec2(-texel.x, 0.0)).rgb);
    float mc = edgeLum(texture2D(uTexture, vUv).rgb);
    float mr = edgeLum(texture2D(uTexture, vUv + vec2(texel.x, 0.0)).rgb);
    float bl = edgeLum(texture2D(uTexture, vUv + vec2(-texel.x, -texel.y)).rgb);
    float bc = edgeLum(texture2D(uTexture, vUv + vec2(0.0, -texel.y)).rgb);
    float br = edgeLum(texture2D(uTexture, vUv + vec2(texel.x, -texel.y)).rgb);

    float edge = 0.0;

    // Use float comparisons for WebGL compatibility
    if (uMode < 0.5) {
      // Sobel operator
      float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
      float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
      edge = sqrt(gx*gx + gy*gy);
    } else if (uMode < 1.5) {
      // Laplacian operator
      edge = abs(-4.0*mc + tc + ml + mr + bc);
    } else if (uMode < 2.5) {
      // Prewitt operator
      float gx = -tl - ml - bl + tr + mr + br;
      float gy = -tl - tc - tr + bl + bc + br;
      edge = sqrt(gx*gx + gy*gy);
    } else {
      // Frei-Chen operator (more isotropic)
      float sq2 = 1.41421;
      float gx = -tl - sq2*ml - bl + tr + sq2*mr + br;
      float gy = -tl - sq2*tc - tr + bl + sq2*bc + br;
      edge = sqrt(gx*gx + gy*gy) / (2.0 + sq2);
    }

    // Apply threshold - use a wider smoothstep for better visibility
    edge = smoothstep(uThreshold * 0.3, uThreshold * 0.8 + 0.02, edge);

    // Invert if requested
    if (uInvert > 0.5) {
      edge = 1.0 - edge;
    }

    vec4 texColor = texture2D(uTexture, vUv);
    gl_FragColor = vec4(vec3(edge), texColor.a);
  }
`;

// ============================================================================
// OUTLINE EFFECT - Cartoon-style outlines with glow
// ============================================================================
export const outlineShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uThickness;   // 1-10 outline thickness
  uniform vec3 uColor;        // Outline color
  uniform float uOnly;        // 0=overlay, 1=outline only
  uniform float uGlow;        // 0-1 glow amount
  uniform vec2 uResolution;
  varying vec2 vUv;

  float outlineLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec2 texel = uThickness / uResolution;
    float centerLum = outlineLum(texColor.rgb);

    // Multi-sample edge detection for thicker lines
    // GLSL ES requires int loop indices
    float edge = 0.0;

    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        if (i == 0 && j == 0) continue;

        vec2 off = vec2(float(i), float(j)) * texel;
        float nb = outlineLum(texture2D(uTexture, vUv + off).rgb);
        edge += abs(nb - centerLum);
      }
    }

    edge = edge / 8.0;
    edge = smoothstep(0.05, 0.15, edge);

    // Add glow effect
    if (uGlow > 0.0) {
      float glowEdge = 0.0;
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          vec2 off = vec2(float(i), float(j)) * texel * 2.0;
          float nb = outlineLum(texture2D(uTexture, vUv + off).rgb);
          glowEdge += abs(nb - centerLum);
        }
      }
      glowEdge = glowEdge / 24.0;
      glowEdge = smoothstep(0.02, 0.1, glowEdge);
      edge = max(edge, glowEdge * uGlow * 0.5);
    }

    vec3 outColor = uColor * edge;

    vec3 finalColor;
    if (uOnly > 0.5) {
      finalColor = outColor;
    } else {
      finalColor = texColor.rgb + outColor;
    }

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`;

// ============================================================================
// EMBOSS EFFECT - 3D relief effect
// ============================================================================
export const embossShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uStrength;  // 0-2 emboss strength
  uniform float uAngle;     // 0-360 light direction
  uniform vec2 uResolution;
  varying vec2 vUv;

  float embossLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    float angle = uAngle * 3.14159265 / 180.0;

    vec2 dir = vec2(cos(angle), sin(angle));

    // Sample multiple pixels along emboss direction for stronger effect
    float s1 = embossLum(texture2D(uTexture, vUv - texel * dir).rgb);
    float s2 = embossLum(texture2D(uTexture, vUv + texel * dir).rgb);
    float s3 = embossLum(texture2D(uTexture, vUv - texel * dir * 2.0).rgb);
    float s4 = embossLum(texture2D(uTexture, vUv + texel * dir * 2.0).rgb);

    // Calculate emboss value with multi-sample for more visible effect
    float diff = ((s2 - s1) + (s4 - s3) * 0.5) * uStrength;
    float emboss = diff + 0.5;

    vec4 texColor = texture2D(uTexture, vUv);

    // Blend emboss with original color
    vec3 embossColor = texColor.rgb * clamp(emboss * 2.0, 0.0, 2.0);

    gl_FragColor = vec4(clamp(embossColor, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// WAVE EFFECT - Animated wave distortion
// ============================================================================
export const waveShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmplitude;   // 0-50 wave amplitude in pixels
  uniform float uFrequency;   // 1-20 wave frequency
  uniform float uSpeed;       // 0-2 animation speed
  uniform float uType;        // 0=horizontal, 1=vertical, 2=radial
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    float t = uTime * uSpeed;
    float amp = uAmplitude / uResolution.x;

    int waveType = int(uType);

    if (waveType == 0) {
      // Horizontal waves
      uv.x += sin(uv.y * uFrequency * 10.0 + t * 5.0) * amp;
    } else if (waveType == 1) {
      // Vertical waves
      uv.y += sin(uv.x * uFrequency * 10.0 + t * 5.0) * amp;
    } else {
      // Radial waves — guard against normalize(0,0) at the exact center
      vec2 center = vec2(0.5);
      vec2 delta = uv - center;
      float dist = length(delta);
      float wave = sin(dist * uFrequency * 20.0 - t * 5.0) * amp;
      vec2 dir = dist > 1e-5 ? delta / dist : vec2(0.0);
      uv += dir * wave;
    }

    gl_FragColor = texture2D(uTexture, clamp(uv, 0.0, 1.0));
  }
`;

// ============================================================================
// FISHEYE EFFECT - Barrel/pincushion distortion
// ============================================================================
export const fisheyeShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uStrength;  // -1 to 1 (negative = pincushion)
  uniform float uRadius;    // 0-1 effect radius
  varying vec2 vUv;

  void main() {
    vec2 center = vec2(0.5);
    vec2 delta = vUv - center;
    float dist = length(delta);

    float effectRadius = uRadius * 0.7071; // sqrt(0.5) for corners

    if (dist < effectRadius && dist > 0.0) {
      float normalizedDist = dist / effectRadius;

      // Barrel/pincushion distortion formula
      float distortedDist;
      if (uStrength >= 0.0) {
        // Barrel (fisheye)
        distortedDist = pow(normalizedDist, 1.0 + uStrength) * effectRadius;
      } else {
        // Pincushion
        distortedDist = pow(normalizedDist, 1.0 / (1.0 - uStrength)) * effectRadius;
      }

      vec2 distortedUV = center + normalize(delta) * distortedDist;
      gl_FragColor = texture2D(uTexture, clamp(distortedUV, 0.0, 1.0));
    } else {
      gl_FragColor = texture2D(uTexture, vUv);
    }
  }
`;

// ============================================================================
// THERMAL EFFECT - Infrared/thermal camera look
// ============================================================================
export const thermalShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;   // 0-2 effect intensity
  uniform float uPalette;     // 0=classic, 1=ironbow, 2=arctic
  varying vec2 vUv;

  vec3 classicThermal(float t) {
    // Blue (cold) -> Cyan -> Green -> Yellow -> Red -> White (hot)
    vec3 color;
    if (t < 0.2) {
      color = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.5, 1.0), t * 5.0);
    } else if (t < 0.4) {
      color = mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.2) * 5.0);
    } else if (t < 0.6) {
      color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.4) * 5.0);
    } else if (t < 0.8) {
      color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.6) * 5.0);
    } else {
      color = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.8) * 5.0);
    }
    return color;
  }

  vec3 ironbowPalette(float t) {
    // Black -> Purple -> Blue -> Cyan -> Green -> Yellow -> Orange -> Red -> White
    vec3 color;
    if (t < 0.14) {
      color = mix(vec3(0.0), vec3(0.3, 0.0, 0.5), t * 7.14);
    } else if (t < 0.28) {
      color = mix(vec3(0.3, 0.0, 0.5), vec3(0.0, 0.0, 1.0), (t - 0.14) * 7.14);
    } else if (t < 0.42) {
      color = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), (t - 0.28) * 7.14);
    } else if (t < 0.57) {
      color = mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.42) * 6.67);
    } else if (t < 0.71) {
      color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.57) * 7.14);
    } else if (t < 0.85) {
      color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.5, 0.0), (t - 0.71) * 7.14);
    } else {
      color = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.85) * 6.67);
    }
    return color;
  }

  vec3 arcticPalette(float t) {
    // White (cold) -> Cyan -> Blue -> Purple -> Magenta (hot)
    vec3 color;
    if (t < 0.25) {
      color = mix(vec3(1.0, 1.0, 1.0), vec3(0.5, 1.0, 1.0), t * 4.0);
    } else if (t < 0.5) {
      color = mix(vec3(0.5, 1.0, 1.0), vec3(0.0, 0.5, 1.0), (t - 0.25) * 4.0);
    } else if (t < 0.75) {
      color = mix(vec3(0.0, 0.5, 1.0), vec3(0.5, 0.0, 1.0), (t - 0.5) * 4.0);
    } else {
      color = mix(vec3(0.5, 0.0, 1.0), vec3(1.0, 0.0, 0.5), (t - 0.75) * 4.0);
    }
    return color;
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Calculate luminance as "temperature"
    float temp = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    // Guard against intensity=0 (would give 1.0/0 = Inf inside pow)
    temp = pow(temp, 1.0 / max(uIntensity, 0.05)); // Adjust contrast

    // Apply palette
    vec3 thermalColor;
    int paletteType = int(uPalette);

    if (paletteType == 0) {
      thermalColor = classicThermal(temp);
    } else if (paletteType == 1) {
      thermalColor = ironbowPalette(temp);
    } else {
      thermalColor = arcticPalette(temp);
    }

    gl_FragColor = vec4(thermalColor, texColor.a);
  }
`;

// ============================================================================
// NIGHT VISION EFFECT - Military night vision look
// ============================================================================
export const nightVisionShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;   // 0-2 brightness boost
  uniform float uNoise;       // 0-1 noise amount
  uniform float uVignette;    // 0-1 circular vignette
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float nvRandom(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Convert to luminance and boost
    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    lum = pow(lum, 0.8) * uIntensity; // Boost dark areas

    // Night vision green tint
    vec3 nvColor = vec3(lum * 0.2, lum, lum * 0.2);

    // Add scanline effect
    float scanline = sin(vUv.y * uResolution.y * 2.0) * 0.5 + 0.5;
    nvColor *= 0.95 + scanline * 0.05;

    // Add noise
    float n = nvRandom(vUv * uResolution + uTime * 1000.0);
    nvColor += (n - 0.5) * uNoise * 0.2;

    // Add phosphor glow (slight bloom around bright areas)
    float glowSum = 0.0;
    for (int i = -2; i <= 2; i++) {
      for (int j = -2; j <= 2; j++) {
        vec2 offset = vec2(float(i), float(j)) / uResolution * 3.0;
        float s = dot(texture2D(uTexture, vUv + offset).rgb, vec3(0.299, 0.587, 0.114));
        glowSum += s;
      }
    }
    glowSum /= 25.0;
    nvColor += vec3(0.0, glowSum * 0.3, 0.0);

    // Circular vignette (night vision scope look)
    vec2 center = vec2(0.5);
    float dist = length(vUv - center);
    float vig = 1.0 - smoothstep(0.3, 0.7, dist * (1.0 + uVignette));

    // Hard circular edge for scope effect
    float scopeEdge = smoothstep(0.48, 0.5, dist);
    vig *= 1.0 - scopeEdge;

    nvColor *= vig;

    gl_FragColor = vec4(clamp(nvColor, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// POLYGON MASK EFFECT - Click-point mask with feather and invert
// ============================================================================
export const polygonMaskShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uPoints[64];     // Up to 64 polygon points (normalized 0-1)
  uniform int uPointCount;      // Actual number of points
  uniform float uFeather;       // Edge feather amount (0-1)
  uniform float uInvert;        // 0=normal, 1=inverted (show outside)
  varying vec2 vUv;

  // Check if point is inside polygon using ray casting algorithm
  float pointInPolygon(vec2 p) {
    if (uPointCount < 3) return 0.0;

    int crossings = 0;

    for (int i = 0; i < 64; i++) {
      if (i >= uPointCount) break;

      int j = i + 1;
      if (j >= uPointCount) j = 0;

      vec2 p1 = uPoints[i];
      vec2 p2 = uPoints[j];

      // Ray casting: count horizontal ray intersections
      if (((p1.y <= p.y && p2.y > p.y) || (p1.y > p.y && p2.y <= p.y)) &&
          (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
        crossings++;
      }
    }

    return mod(float(crossings), 2.0);
  }

  // Calculate distance to polygon edge for feathering
  float distToPolygonEdge(vec2 p) {
    if (uPointCount < 3) return 1.0;

    float minDist = 1000.0;

    for (int i = 0; i < 64; i++) {
      if (i >= uPointCount) break;

      int j = i + 1;
      if (j >= uPointCount) j = 0;

      vec2 a = uPoints[i];
      vec2 b = uPoints[j];

      // Distance to line segment
      vec2 ab = b - a;
      vec2 ap = p - a;
      float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
      vec2 closest = a + t * ab;
      float dist = length(p - closest);

      minDist = min(minDist, dist);
    }

    return minDist;
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    if (uPointCount < 3) {
      // No valid polygon, show full texture (or hide if inverted)
      float alpha = uInvert > 0.5 ? 0.0 : 1.0;
      gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
      return;
    }

    float inside = pointInPolygon(vUv);

    // Apply feathering — one-sided: only fades the INSIDE edge.
    // Outside the polygon stays hard-transparent so the feather doesn't
    // bleed/halo into surrounding pixels.
    float alpha;
    if (uFeather > 0.001 && inside > 0.5) {
      float dist = distToPolygonEdge(vUv);
      alpha = smoothstep(0.0, uFeather, dist);
    } else {
      alpha = inside;
    }

    // Apply invert
    if (uInvert > 0.5) {
      alpha = 1.0 - alpha;
    }

    gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
  }
`;

// ============================================================================
// MASK SHAPE TO ALPHA - Renders a single polygon's silhouette into a buffer's
// alpha channel. Used when building a UNION of multiple sub-polygons: this
// shader gets called once per shape with THREE.MaxEquation blending so the
// destination alpha accumulates `max(prevAlpha, thisShapeAlpha)`.
// RGB output is unused — the consumer only reads .a.
// ============================================================================
export const polygonMaskAlphaShader = /* glsl */ `
  uniform vec2 uPoints[64];
  uniform int uPointCount;
  uniform float uFeather;
  varying vec2 vUv;

  float pointInPolygon(vec2 p) {
    if (uPointCount < 3) return 0.0;
    int crossings = 0;
    for (int i = 0; i < 64; i++) {
      if (i >= uPointCount) break;
      int j = i + 1;
      if (j >= uPointCount) j = 0;
      vec2 p1 = uPoints[i];
      vec2 p2 = uPoints[j];
      if (((p1.y <= p.y && p2.y > p.y) || (p1.y > p.y && p2.y <= p.y)) &&
          (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
        crossings++;
      }
    }
    return mod(float(crossings), 2.0);
  }

  float distToPolygonEdge(vec2 p) {
    if (uPointCount < 3) return 1.0;
    float minDist = 1000.0;
    for (int i = 0; i < 64; i++) {
      if (i >= uPointCount) break;
      int j = i + 1;
      if (j >= uPointCount) j = 0;
      vec2 a = uPoints[i];
      vec2 b = uPoints[j];
      vec2 ab = b - a;
      vec2 ap = p - a;
      float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
      vec2 closest = a + t * ab;
      minDist = min(minDist, length(p - closest));
    }
    return minDist;
  }

  void main() {
    float inside = pointInPolygon(vUv);
    float alpha;
    if (uFeather > 0.001 && inside > 0.5) {
      float dist = distToPolygonEdge(vUv);
      alpha = smoothstep(0.0, uFeather, dist);
    } else {
      alpha = inside;
    }
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
  }
`;

// ============================================================================
// APPLY EXTERNAL MASK - Multiplies a source texture's alpha by another
// texture's alpha channel. Used to apply a pre-built union mask to a layer's
// source. Supports the same `uInvert` flag as the inline polygon mask.
// ============================================================================
export const applyExternalMaskShader = /* glsl */ `
  uniform sampler2D uSource;
  uniform sampler2D uMask;
  uniform float uInvert;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uSource, vUv);
    float maskA = texture2D(uMask, vUv).a;
    float a = uInvert > 0.5 ? (1.0 - maskA) : maskA;
    gl_FragColor = vec4(src.rgb, src.a * a);
  }
`;

// ============================================================================
// LAYER SHAPE MASK - Circle, ellipse, polygon, star, triangle, line shapes
// ============================================================================
export const layerShapeMaskShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform int uShapeType;       // 0=rect, 1=circle, 2=ellipse, 3=triangle, 4=polygon, 5=star, 6=line
  uniform float uRadiusX;       // For circle/ellipse
  uniform float uRadiusY;       // For ellipse
  uniform int uSides;           // For polygon/star
  uniform float uInnerRadius;   // For star
  uniform float uRotation;      // Rotation in radians
  uniform float uFeather;       // Edge feather amount
  uniform float uScale;         // Zoom/scale (1.0 = default)
  uniform float uLineWidth;     // For line shape
  uniform vec2 uLineStart;      // Line start point
  uniform vec2 uLineEnd;        // Line end point
  uniform int uHasControlPoints;
  uniform int uControlPointCount;
  uniform vec2 uControlPoints[5];
  uniform int uInvert;
  varying vec2 vUv;

  #define PI 3.14159265359

  // Rotate a point around center
  vec2 rotate(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  // Distance to circle
  float sdCircle(vec2 p, float r) {
    return length(p) - r;
  }

  // Distance to ellipse (approximate)
  float sdEllipse(vec2 p, vec2 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
  }

  // Distance to line segment
  float sdLine(vec2 p, vec2 a, vec2 b, float width) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - width;
  }

  float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  bool pointInTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = c - a;
    vec2 v1 = b - a;
    vec2 v2 = p - a;
    float dot00 = dot(v0, v0);
    float dot01 = dot(v0, v1);
    float dot02 = dot(v0, v2);
    float dot11 = dot(v1, v1);
    float dot12 = dot(v1, v2);
    float invDenom = 1.0 / (dot00 * dot11 - dot01 * dot01);
    float u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    float v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return (u >= 0.0) && (v >= 0.0) && (u + v <= 1.0);
  }

  float sdTriangleFromPoints(vec2 p, vec2 a, vec2 b, vec2 c) {
    float d = min(min(distToSegment(p, a, b), distToSegment(p, b, c)), distToSegment(p, c, a));
    return pointInTriangle(p, a, b, c) ? -d : d;
  }

  vec3 barycentric(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = b - a;
    vec2 v1 = c - a;
    vec2 v2 = p - a;
    float d00 = dot(v0, v0);
    float d01 = dot(v0, v1);
    float d11 = dot(v1, v1);
    float d20 = dot(v2, v0);
    float d21 = dot(v2, v1);
    float denom = d00 * d11 - d01 * d01;
    float v = (d11 * d20 - d01 * d21) / denom;
    float w = (d00 * d21 - d01 * d20) / denom;
    float u = 1.0 - v - w;
    return vec3(u, v, w);
  }

  // Inverse bilinear interpolation - find source UV from a warped quad
  vec2 inverseWarp(vec2 p, vec2 tl, vec2 tr, vec2 bl, vec2 br) {
    vec2 uv = vec2(0.5, 0.5);
    for (int i = 0; i < 6; i++) {
      vec2 top = mix(tl, tr, uv.x);
      vec2 bottom = mix(bl, br, uv.x);
      vec2 predicted = mix(top, bottom, uv.y);
      vec2 error = p - predicted;

      vec2 dTop = tr - tl;
      vec2 dBottom = br - bl;
      vec2 dX = mix(dTop, dBottom, uv.y);
      vec2 dY = bottom - top;

      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.00001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );
      uv += delta;
    }
    return uv;
  }

  // Distance to regular polygon
  float sdPolygon(vec2 p, float r, int n) {
    float an = PI / float(n);
    float he = r * tan(an);
    float a = atan(p.y, p.x);
    float bn = mod(a, 2.0 * an) - an;
    vec2 q = length(p) * vec2(cos(bn), abs(sin(bn)));
    return q.x - r;
  }

  // Distance to star shape
  float sdStar(vec2 p, float r, float innerR, int n) {
    float an = PI / float(n);
    float en = PI / float(n * 2);
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));

    float bn = mod(atan(p.y, p.x), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));

    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
  }

  void main() {
    vec2 sampleUv = vUv;

    // Transform UV to centered coordinates (-0.5 to 0.5)
    vec2 p = vUv - 0.5;

    // Apply scale (zoom) - dividing makes shape larger (zoom in)
    p = p / uScale;

    // Apply rotation
    p = rotate(p, -uRotation);

    // Shape-specific source UV warping for editable control points
    if (uShapeType == 1 && uHasControlPoints == 1 && uControlPointCount >= 5) {
      vec2 tl = uControlPoints[0];
      vec2 tr = uControlPoints[1];
      vec2 bl = uControlPoints[2];
      vec2 br = uControlPoints[3];
      vec2 center = uControlPoints[4];

      sampleUv = inverseWarp(vUv, tl, tr, bl, br);
      vec2 centerOffset = center - vec2(0.5);
      float centerWeight = 1.0 - smoothstep(0.0, 0.5, length(vUv - vec2(0.5)));
      sampleUv -= centerOffset * centerWeight * 0.6;
    } else if (uShapeType == 3 && uHasControlPoints == 1 && uControlPointCount >= 3) {
      vec2 a = uControlPoints[0];
      vec2 b = uControlPoints[1];
      vec2 c = uControlPoints[2];
      vec3 bc = barycentric(vUv, a, b, c);
      if (bc.x >= 0.0 && bc.y >= 0.0 && bc.z >= 0.0) {
        vec2 d0 = vec2(0.5, 0.9);
        vec2 d1 = vec2(0.1, 0.1);
        vec2 d2 = vec2(0.9, 0.1);
        sampleUv = d0 * bc.x + d1 * bc.y + d2 * bc.z;
      }
    }

    sampleUv = clamp(sampleUv, 0.0, 1.0);
    vec4 texColor = texture2D(uTexture, sampleUv);

    float dist = 0.0;
    float mask = 1.0;

    if (uShapeType == 0) {
      // Rectangle - no masking (default)
      mask = 1.0;
    }
    else if (uShapeType == 1) {
      // Circle
      dist = sdCircle(p, uRadiusX * 0.5);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 2) {
      // Ellipse
      dist = sdEllipse(p, vec2(uRadiusX, uRadiusY) * 0.5);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 3) {
      // Triangle (equilateral)
      if (uHasControlPoints == 1 && uControlPointCount >= 3) {
        vec2 a = uControlPoints[0];
        vec2 b = uControlPoints[1];
        vec2 c = uControlPoints[2];
        dist = sdTriangleFromPoints(vUv, a, b, c);
      } else {
        dist = sdPolygon(p, 0.4, 3);
      }
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 4) {
      // Regular polygon
      dist = sdPolygon(p, 0.4, uSides);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 5) {
      // Star
      dist = sdStar(p, 0.4, uInnerRadius * 0.4, uSides);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }
    else if (uShapeType == 6) {
      // Line
      vec2 a = uLineStart - 0.5;
      vec2 b = uLineEnd - 0.5;
      dist = sdLine(p, a, b, uLineWidth * 0.5);
      mask = uFeather > 0.001 ? 1.0 - smoothstep(-uFeather, uFeather, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }

    if (uInvert == 1) {
      mask = 1.0 - mask;
    }

    gl_FragColor = vec4(texColor.rgb, texColor.a * mask);
  }
`;

// ============================================================================
// BRIGHTNESS EFFECT - Adjusts overall brightness
// ============================================================================
export const brightnessShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;  // -1 to 1, brightness adjustment
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    texColor.rgb += uAmount;
    gl_FragColor = vec4(clamp(texColor.rgb, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// CONTRAST EFFECT - Adjusts color contrast
// ============================================================================
export const contrastShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0.5 to 2.0, contrast adjustment
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    texColor.rgb = (texColor.rgb - 0.5) * uAmount + 0.5;
    gl_FragColor = vec4(clamp(texColor.rgb, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// SATURATION EFFECT - Adjusts color saturation
// ============================================================================
export const saturationShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0 to 2, saturation adjustment
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Convert RGB to HSL for saturation adjustment
    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 adjusted = mix(vec3(lum), texColor.rgb, uAmount);

    gl_FragColor = vec4(adjusted, texColor.a);
  }
`;

// ============================================================================
// HUE EFFECT - Adjusts color hue rotation
// ============================================================================
export const hueShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;  // 0 to 1, hue rotation (0-360 degrees)
  varying vec2 vUv;

  vec3 rotateHue(vec3 color, float hueShift) {
    const vec3 k = vec3(0.57735, 0.57735, 0.57735);
    float cosAngle = cos(hueShift);
    return color * cosAngle + cross(k, color) * sin(hueShift) + k * dot(k, color) * (1.0 - cosAngle);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Rotate hue (uAmount is 0-1, convert to 0-2π)
    float hueRotation = uAmount * 6.28318530718;
    vec3 adjusted = rotateHue(texColor.rgb, hueRotation);

    gl_FragColor = vec4(clamp(adjusted, 0.0, 1.0), texColor.a);
  }
`;
