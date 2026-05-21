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
// VIGNETTE EFFECT (HERO) — colored edge tint, shape modes, center offset,
// breathing animation, alpha-or-color falloff. Presets cover utility
// fade-to-edge, stage spotlight, oval portrait, and slow-breathing club.
// ============================================================================
export const vignetteShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSize;        // 0-1, how far vignette extends from center
  uniform float uSoftness;    // 0-1, edge softness
  uniform float uRoundness;   // 0-1, circular vs rectangular (legacy mix factor)
  // Hero-rewrite params
  uniform float uShape;       // 0=round, 1=oval, 2=square, 3=superellipse
  uniform float uAspect;      // 0.3-3.0 — oval/superellipse aspect ratio (X/Y)
  uniform float uCenterX;     // 0-1 — vignette center X (0.5 = frame center)
  uniform float uCenterY;     // 0-1 — vignette center Y
  uniform float uColorR;      // 0-1 tint R (used when uTintAmount > 0)
  uniform float uColorG;      // 0-1 tint G
  uniform float uColorB;      // 0-1 tint B
  uniform float uTintAmount;  // 0-1 — 0 = transparent fade (legacy), 1 = solid color fade
  uniform float uBreathing;   // 0-1 — animated size oscillation amplitude
  uniform float uBreathSpeed; // 0-2 — breathing speed (cycles per second / 2π)
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Animated breathing — size pulses around uSize. Smooth sine wave;
    // uBreathing=0 gives identical behavior to the legacy shader.
    float breath = sin(uTime * uBreathSpeed * 6.28318) * 0.5 + 0.5;
    float effectiveSize = uSize - uBreathing * 0.15 * (breath - 0.5);

    // Centered coordinates with user-movable center.
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 pos = vUv - center;

    // Compute distance based on shape selector.
    int shape = int(uShape + 0.5);
    float dist = 1.0;
    if (shape == 0) {
      // Round (legacy): mix between rectangular and circular via uRoundness.
      float rectDist = max(abs(pos.x), abs(pos.y)) * 2.0;
      float circDist = length(pos) * 2.0;
      dist = mix(rectDist, circDist, uRoundness);
    } else if (shape == 1) {
      // Oval — circular but stretched by uAspect on the X axis.
      float a = max(uAspect, 0.0001);
      dist = length(vec2(pos.x / a, pos.y)) * 2.0;
    } else if (shape == 2) {
      // Square — strict L∞ (max-axis) distance, ignores uAspect/uRoundness.
      dist = max(abs(pos.x), abs(pos.y)) * 2.0;
    } else {
      // Superellipse (squircle) — Lp norm with p=4 gives that rounded-rect
      // look you see in product photography. Stretched by uAspect.
      float a = max(uAspect, 0.0001);
      vec2 q = vec2(pos.x / a, pos.y) * 2.0;
      dist = pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25);
    }

    // Smooth falloff across the edge band.
    float vignette = 1.0 - smoothstep(effectiveSize - uSoftness * 0.5, effectiveSize + uSoftness * 0.5, dist);

    // Tint mode: when uTintAmount=0 we fade alpha (legacy behavior).
    // When uTintAmount=1 we KEEP alpha and blend the image toward the
    // tint color in the vignette region — perfect for "stage spotlight"
    // (black surround) or "warm portrait" (orange-brown surround).
    vec3 tint = vec3(uColorR, uColorG, uColorB);
    vec3 finalRgb = mix(texColor.rgb, tint, (1.0 - vignette) * uTintAmount);
    float finalA = texColor.a * mix(vignette, 1.0, uTintAmount);

    gl_FragColor = vec4(finalRgb, finalA);
  }
`;

// ============================================================================
// EDGE FEATHER EFFECT (HERO) — per-edge feather with gamma-aware falloff
// curve and a matte preview overlay for dialling in projection masks.
// "Projection cleanup" preset hits the common case where you need to fade
// off the four projector edges so blends with neighbouring projectors
// don't show hard seams.
// ============================================================================
export const edgeFeatherShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTop;          // 0-1 feather amount from top
  uniform float uBottom;       // 0-1 feather amount from bottom
  uniform float uLeft;         // 0-1 feather amount from left
  uniform float uRight;        // 0-1 feather amount from right
  uniform float uSoftness;     // 0-1 overall softness modifier
  // Hero-rewrite params
  uniform float uGamma;        // 0.2-3.0 — falloff curve (1.0 = linear, <1 = sharper, >1 = softer)
  uniform float uMattePreview; // 0=normal, 1=matte preview (alpha as red overlay)
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    float alpha = 1.0;

    if (uTop > 0.0)    alpha *= smoothstep(1.0, 1.0 - uTop, vUv.y);
    if (uBottom > 0.0) alpha *= smoothstep(0.0, uBottom, vUv.y);
    if (uLeft > 0.0)   alpha *= smoothstep(0.0, uLeft, vUv.x);
    if (uRight > 0.0)  alpha *= smoothstep(1.0, 1.0 - uRight, vUv.x);

    // Apply overall softness modifier (legacy behavior).
    alpha = pow(alpha, 1.0 / max(uSoftness + 0.5, 0.1));

    // Gamma-aware falloff. Projector edge-blending is GAMMA-space, not
    // linear. uGamma=2.2 produces the curve real projectors blend with
    // — falls off slowly in the bright zone then quickly at the edge.
    // uGamma=1 = current behavior; <1 sharpens for hard masks.
    alpha = pow(alpha, max(uGamma, 0.0001));

    // Matte preview: bypass the image and render alpha as a translucent
    // red overlay so the user can SEE the feather shape they're
    // dialling in. Same trick After Effects uses for shape masks.
    if (uMattePreview > 0.5) {
      vec3 matteR = vec3(1.0, 0.0, 0.0);
      vec3 inv = vec3(1.0) - matteR;
      // Show the feather as red opacity, opaque-black elsewhere.
      gl_FragColor = vec4(mix(vec3(0.0), matteR, 1.0 - alpha), 1.0);
      return;
    }

    gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
  }
`;

// ============================================================================
// COLORAMA EFFECT (HERO) — Cosine palette with named palettes, audio
// reactivity, posterized bands, hue shift, and a deep preset library.
// Uses the formula: color = a + b * cos(2π * (c * t + d))
// where t is the input luminance + time offset + audio modulation.
// ============================================================================
export const coloramaShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uPalette;       // 0-11 named palettes (Rainbow, Sunset, Ocean, Neon, Fire,
                                //   Forest, Ice, Psychedelic, Vaporwave, Club, Pastel, Mono)
  uniform float uOffset;        // 0-1 manual offset through palette
  uniform float uSpeed;         // 0-2 auto-cycle speed (0 = off)
  uniform float uContrast;      // 0.5-2 luminance contrast
  uniform float uMix;           // 0-1 blend with original
  uniform float uBands;         // 0 = smooth gradient, 1-32 = posterized into N bands
  uniform float uAudioReact;    // 0-1 how much audio modulates the cycling (0 = ignore audio)
  uniform float uHueShift;      // 0-1 fixed rotation through palette (separate from auto-cycle)
  uniform float uAudio;         // 0-1 live audio rms (set by renderer per frame)
  uniform float uTime;
  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  // Cosine palette function: a + b * cos(2π * (c * t + d))
  vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
  }

  // 12 named palettes — coefficients for the cosine-palette formula.
  // Indices here MUST match the dropdown labels in effectUX.ts.
  vec3 getPaletteColor(float t, int palette) {
    vec3 a, b, c, d;

    if (palette == 0) {
      // 0 — Rainbow (classic full-spectrum cycle)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.33, 0.67);
    }
    else if (palette == 1) {
      // 1 — Sunset (warm oranges, magentas, deep purples)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.1, 0.2);
    }
    else if (palette == 2) {
      // 2 — Ocean (teals and deep blues)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.3, 0.2, 0.2);
    }
    else if (palette == 3) {
      // 3 — Neon (vibrant pinks, cyans)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 0.5);
      d = vec3(0.8, 0.9, 0.3);
    }
    else if (palette == 4) {
      // 4 — Fire (reds → oranges → yellows)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 0.7, 0.4);
      d = vec3(0.0, 0.15, 0.2);
    }
    else if (palette == 5) {
      // 5 — Forest (greens with earthy browns)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.1, 0.0);
    }
    else if (palette == 6) {
      // 6 — Ice (whites, blues, cyan highlights)
      a = vec3(0.8, 0.8, 0.9);
      b = vec3(0.2, 0.4, 0.2);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.25, 0.25);
    }
    else if (palette == 7) {
      // 7 — Psychedelic (rapid hue swings)
      a = vec3(0.5, 0.5, 0.5);
      b = vec3(0.5, 0.5, 0.5);
      c = vec3(2.0, 1.0, 0.0);
      d = vec3(0.5, 0.2, 0.25);
    }
    else if (palette == 8) {
      // 8 — Vaporwave (hot pink → purple → teal — 80s synth aesthetic)
      a = vec3(0.6, 0.4, 0.7);
      b = vec3(0.4, 0.4, 0.4);
      c = vec3(1.0, 1.0, 0.5);
      d = vec3(0.0, 0.15, 0.50);
    }
    else if (palette == 9) {
      // 9 — Club (saturated cyan/magenta/yellow stage-light cycle)
      a = vec3(0.55, 0.45, 0.55);
      b = vec3(0.55, 0.5, 0.5);
      c = vec3(1.5, 1.5, 1.0);
      d = vec3(0.0, 0.5, 0.85);
    }
    else if (palette == 10) {
      // 10 — Pastel (soft pinks, mint, baby blue)
      a = vec3(0.85, 0.8, 0.85);
      b = vec3(0.15, 0.18, 0.15);
      c = vec3(1.0, 1.0, 1.0);
      d = vec3(0.0, 0.33, 0.67);
    }
    else {
      // 11 — Mono Glow (single-hue luminance ramp, hue picked by uHueShift)
      // Use uHueShift as a hue offset on a simple HSV-style cycle. We
      // approximate this with a cosine palette whose d-vector is shifted.
      float h = mod(uHueShift, 1.0);
      a = vec3(0.5);
      b = vec3(0.5);
      c = vec3(1.0);
      d = vec3(h, h + 0.33, h + 0.67);
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

    // Posterize: snap luminance to discrete bands BEFORE palette lookup.
    if (uBands >= 0.5) {
      float steps = floor(uBands + 0.5);
      lum = floor(lum * steps) / max(steps - 1.0, 1.0);
      lum = clamp(lum, 0.0, 1.0);
    }

    // Audio reactivity: live audio RMS modulates the cycling offset.
    float audioPunch = clamp(uAudio, 0.0, 1.5) * uAudioReact;

    // Total palette parameter: luminance + manual offset + auto-cycle
    // + hue shift + audio punch.
    float t = lum + uOffset + uTime * uSpeed + uHueShift + audioPunch;

    // Get palette color
    int paletteIndex = int(uPalette);
    vec3 paletteColor = getPaletteColor(t, paletteIndex);

    // Mix with original based on mix parameter
    vec3 finalColor = mix(color, paletteColor, uMix);

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`;

// ============================================================================
// INVERT EFFECT (HERO) — partial / luma-only / hue / strobe / threshold modes.
// Original full RGB invert is just mode 0 with amount=1.
// ============================================================================
export const invertShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uMode;        // 0=RGB,1=luma-only,2=hue,3=strobe,4=threshold-above
  uniform float uAmount;      // 0-1 invert strength (partial invert at <1)
  uniform float uThreshold;   // 0-1 — used in threshold mode (invert pixels brighter than this)
  uniform float uStrobeRate;  // 0-10 — strobe Hz when uMode=3
  uniform float uTime;
  varying vec2 vUv;

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
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;
    int mode = int(uMode + 0.5);

    vec3 inverted = src;

    if (mode == 0) {
      // RGB invert (legacy at amount=1)
      inverted = 1.0 - src;
    } else if (mode == 1) {
      // Luma-only — invert brightness, keep hue/saturation. Useful for
      // "x-ray" look where colors stay but light/dark flip.
      vec3 hsv = rgb2hsv(src);
      hsv.z = 1.0 - hsv.z;
      inverted = hsv2rgb(hsv);
    } else if (mode == 2) {
      // Hue invert — rotate hue 180° (complement colors). Keeps
      // brightness/saturation; red→cyan, green→magenta, blue→yellow.
      vec3 hsv = rgb2hsv(src);
      hsv.x = fract(hsv.x + 0.5);
      inverted = hsv2rgb(hsv);
    } else if (mode == 3) {
      // Strobe invert — alternates between original and inverted at
      // uStrobeRate Hz. Phase = floor(time * rate) % 2.
      float phase = mod(floor(uTime * max(uStrobeRate, 0.01)), 2.0);
      inverted = mix(src, 1.0 - src, phase);
    } else {
      // Threshold-above — invert pixels brighter than uThreshold,
      // leave shadows untouched. Great for crushing highlights.
      float lum = dot(src, vec3(0.299, 0.587, 0.114));
      float invertMask = smoothstep(uThreshold - 0.02, uThreshold + 0.02, lum);
      inverted = mix(src, 1.0 - src, invertMask);
    }

    // Partial-invert: blend toward the inverted result by uAmount.
    vec3 finalColor = mix(src, inverted, uAmount);

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`;

// ============================================================================
// DITHER EFFECT (HERO) — 5 distinct algorithms (Bayer / Blue Noise / Halftone /
// Atkinson / Floyd-Steinberg) plus palette-lock dropdown (mono / 4-color
// CGA / 8-color EGA / Game Boy / amber CRT) and pixel-lock scale so the
// dither pattern stays crisp at any output size.
// ============================================================================
export const ditherShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uType;        // 0=bayer, 1=blueNoise, 2=halftone, 3=atkinson, 4=floydSteinberg
  uniform float uIntensity;   // 0-1
  uniform float uScale;       // 1-16
  uniform float uColorDepth;  // 1-8 bits
  uniform float uPalette;     // 0=free, 1=mono, 2=CGA-4, 3=EGA-8, 4=GameBoy, 5=Amber-CRT
  uniform float uPixelLock;   // 0=continuous, 1=snap to integer pixel grid (no aliasing on resize)
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  // Snap to nearest fixed palette color. uses simple Euclidean distance.
  vec3 snapPalette(vec3 c, int pal) {
    if (pal == 1) {
      // 1-bit mono — snap to black or white by luma.
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      return lum > 0.5 ? vec3(1.0) : vec3(0.0);
    }
    if (pal == 2) {
      // CGA mode 4 palette 1 — black, cyan, magenta, white.
      vec3 P[4]; P[0]=vec3(0.0); P[1]=vec3(0.0,1.0,1.0); P[2]=vec3(1.0,0.0,1.0); P[3]=vec3(1.0);
      vec3 best = P[0]; float bd = 1e9;
      for (int i = 0; i < 4; i++) { float d = dot(c-P[i], c-P[i]); if (d < bd) { bd = d; best = P[i]; } }
      return best;
    }
    if (pal == 3) {
      // EGA 8-color (high-intensity).
      vec3 P[8];
      P[0]=vec3(0.0); P[1]=vec3(0.0,0.0,0.67); P[2]=vec3(0.0,0.67,0.0); P[3]=vec3(0.0,0.67,0.67);
      P[4]=vec3(0.67,0.0,0.0); P[5]=vec3(0.67,0.0,0.67); P[6]=vec3(0.67,0.33,0.0); P[7]=vec3(0.67);
      vec3 best = P[0]; float bd = 1e9;
      for (int i = 0; i < 8; i++) { float d = dot(c-P[i], c-P[i]); if (d < bd) { bd = d; best = P[i]; } }
      return best;
    }
    if (pal == 4) {
      // Game Boy 4-shade green.
      vec3 P[4];
      P[0]=vec3(0.06,0.22,0.06); P[1]=vec3(0.19,0.38,0.19); P[2]=vec3(0.55,0.67,0.06); P[3]=vec3(0.61,0.74,0.06);
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      int idx = int(clamp(floor(lum * 4.0), 0.0, 3.0));
      return P[idx];
    }
    if (pal == 5) {
      // Amber CRT — black, dim amber, mid amber, bright amber.
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      return mix(vec3(0.0), vec3(1.0, 0.65, 0.0), smoothstep(0.0, 1.0, lum));
    }
    return c; // pal == 0 free
  }

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

    // Calculate scaled pixel position. With pixel-lock, snap to integer
    // pixel coords so the pattern doesn't shimmer when the canvas resizes.
    vec2 pixelPos = vUv * uResolution / max(uScale, 0.5);
    if (uPixelLock > 0.5) pixelPos = floor(pixelPos);

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

    // Quantize to color depth, then optionally snap to a fixed palette.
    float levels = pow(2.0, uColorDepth);
    vec3 dithered = color + vec3(threshold) / levels;
    dithered = floor(dithered * levels + 0.5) / levels;
    int pal = int(uPalette + 0.5);
    if (pal > 0) dithered = snapPalette(dithered, pal);

    gl_FragColor = vec4(clamp(dithered, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// VHS EFFECT (HERO) — Full-deck VHS simulation: head-switch tear, tape wobble,
// dropout bands, chroma delay, tracking jumps, era preset library.
// ============================================================================
export const vhsShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTracking;
  uniform float uNoise;
  uniform float uDistortion;
  uniform float uColorBleed;
  uniform float uScanlines;
  uniform float uHeadSwitch;
  uniform float uTapeWobble;
  uniform float uDropout;
  uniform float uChromaDelay;
  uniform float uTrackingJump;
  uniform float uSaturation;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float hash11(float seed) { return fract(sin(seed * 12.9898) * 43758.5453123); }
  float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }
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

    // Tracking jump (vertical roll w/ snap).
    float jumpTrigger = step(0.985, hash11(floor(uTime * 1.3))) * uTrackingJump;
    float jumpAmount = uTrackingJump * 0.08 * (sin(uTime * 0.7) * 0.5 + 0.5);
    uv.y = fract(uv.y + jumpAmount + jumpTrigger * 0.4);

    // Tape wobble (capstan jitter).
    float wobble = sin(uv.y * 4.0 + uTime * 1.5) * 0.6
                 + sin(uv.y * 11.0 + uTime * 0.7) * 0.4;
    uv.x += wobble * uTapeWobble * 0.012;

    // Tracking distortion (legacy).
    float trackingOffset = sin(uv.y * 10.0 + uTime * 3.0) * uTracking * 0.02;
    trackingOffset += step(0.99, random(vec2(uTime * 0.1, uv.y))) * uTracking * 0.1;
    uv.x += trackingOffset;

    // Wave distortion (legacy).
    uv.x += sin(uv.y * 50.0 + uTime * 10.0) * uDistortion * 0.003;
    uv.y += sin(uv.x * 30.0 + uTime * 8.0) * uDistortion * 0.002;

    // Head-switch tear band at bottom of frame.
    float headBand = smoothstep(0.06, 0.0, uv.y);
    float headTear = (random(vec2(floor(uv.y * 200.0), floor(uTime * 30.0))) - 0.5)
                   * headBand * uHeadSwitch * 0.06;
    uv.x += headTear;

    // Sample with chroma bleed + delay.
    float bleedAmount = uColorBleed * 0.005;
    float chromaLag = uChromaDelay * 0.012;
    vec4 color;
    color.r = texture2D(uTexture, vec2(uv.x + bleedAmount + chromaLag, uv.y)).r;
    color.g = texture2D(uTexture, uv).g;
    color.b = texture2D(uTexture, vec2(uv.x - bleedAmount - chromaLag, uv.y)).b;
    color.a = texture2D(uTexture, uv).a;

    // Dropout bands.
    float dropoutSeed = floor(uv.y * uResolution.y * 0.5) + floor(uTime * 4.0);
    float dropoutHit = step(1.0 - uDropout * 0.04, hash11(dropoutSeed));
    if (dropoutHit > 0.5) {
      float dropoutKind = hash11(dropoutSeed + 7.3);
      if (dropoutKind > 0.5) color.rgb = mix(color.rgb, vec3(1.0), 0.85);
      else                    color.rgb = mix(color.rgb, vec3(0.0), 0.85);
    }

    // Luma noise.
    float n = noise(uv * uResolution * 0.5 + uTime * 100.0);
    color.rgb += (n - 0.5) * uNoise * 0.3;

    // Scanlines.
    float scanline = sin(vUv.y * uResolution.y * 2.0) * 0.5 + 0.5;
    color.rgb *= 1.0 - uScanlines * 0.3 * scanline;

    // Saturation pull-back.
    vec3 luminance = vec3(0.299, 0.587, 0.114);
    float lum = dot(color.rgb, luminance);
    float satMix = clamp(1.0 - uSaturation, 0.0, 1.0);
    color.rgb = mix(color.rgb, vec3(lum), satMix * 0.6 + uTracking * 0.2);

    gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
  }
`;

// ============================================================================
// GLITCH EFFECT (HERO) — trigger modes (constant/audio/beat-snap), block hold,
// vertical slice, freeze burst, RGB tear band. Audio-reactive via uAudio.
// ============================================================================
export const glitchShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uBlockSize;
  uniform float uRGBSplit;
  uniform float uJitter;
  uniform float uTriggerMode;
  uniform float uBlockHold;
  uniform float uVerticalSlice;
  uniform float uFreezeBurst;
  uniform float uTearChance;
  uniform float uAudio;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float random(float seed) { return fract(sin(seed * 12.9898) * 43758.5453); }
  float random2(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    float t = uTime * max(uSpeed, 0.01);

    float glitchTrigger = 0.0;
    int mode = int(uTriggerMode + 0.5);
    if (mode == 1) {
      glitchTrigger = clamp(uAudio * 1.6, 0.0, 1.0) * uIntensity;
    } else if (mode == 2) {
      float beatPhase = floor(uTime * 8.0);
      float beatHit = step(0.4, uAudio) * step(0.7, random(beatPhase));
      glitchTrigger = beatHit * uIntensity;
    } else {
      glitchTrigger = step(0.95, random(floor(t * 10.0))) * uIntensity;
    }

    float blockHeight = max(uBlockSize * 0.1, 0.01);
    float block = floor(uv.y / blockHeight);
    float blockTime = floor(t * mix(20.0, 1.0, uBlockHold));
    float blockRandom = random(block + blockTime);
    if (blockRandom > 1.0 - uIntensity * 0.3 && glitchTrigger > 0.0) {
      uv.x += (random(block + t) - 0.5) * uIntensity * 0.2;
    }

    float colSeed = floor(uv.x * uResolution.x / 12.0);
    float colHit = step(1.0 - uVerticalSlice * 0.2, random(colSeed + floor(t * 7.0)));
    if (colHit > 0.5 && glitchTrigger > 0.0) {
      uv.y += (random(colSeed + 13.7) - 0.5) * uVerticalSlice * 0.18;
      uv.y = fract(uv.y);
    }

    float lineJitter = (random2(vec2(floor(uv.y * uResolution.y), floor(t * 20.0))) - 0.5);
    uv.x += lineJitter * uJitter * 0.01 * glitchTrigger;

    float rgbAmount = uRGBSplit * 0.02 * (1.0 + glitchTrigger * 3.0);
    float tearBand = step(1.0 - uTearChance * 0.3, random(floor(uv.y * 50.0) + floor(t * 6.0)));
    if (tearBand > 0.5 && glitchTrigger > 0.0) rgbAmount *= 6.0;
    vec4 color;
    color.r = texture2D(uTexture, vec2(uv.x + rgbAmount, uv.y)).r;
    color.g = texture2D(uTexture, uv).g;
    color.b = texture2D(uTexture, vec2(uv.x - rgbAmount, uv.y)).b;
    color.a = texture2D(uTexture, uv).a;

    float freezeHit = step(1.0 - uFreezeBurst * 0.25, random(floor(t * 3.0))) * glitchTrigger;
    if (freezeHit > 0.5) {
      vec2 punchUv = vec2(fract(vUv.x + 0.37 + 0.13 * random(block)),
                          fract(vUv.y + 0.21 + 0.17 * random(block + 4.0)));
      vec4 punch = texture2D(uTexture, punchUv);
      color.rgb = mix(color.rgb, punch.rgb, 0.7);
    }

    if (random(floor(t * 15.0) + block) > 0.98 && glitchTrigger > 0.0) {
      color.rgb = 1.0 - color.rgb;
    }

    gl_FragColor = color;
  }
`;

// ============================================================================
// RGB SHIFT EFFECT (HERO) — modes: directional (legacy) / radial (lens
// fringe) / prism (rainbow split) / luma-dependent (only bright pixels
// shift) / edge-only. Center picker for radial/prism. Lens preset library.
// ============================================================================
export const rgbShiftShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;     // 0-50 pixels
  uniform float uAngle;      // 0-360 degrees (for directional mode)
  uniform float uMode;       // 0=directional, 1=radial, 2=prism, 3=luma-dep, 4=edge-only
  uniform float uCenterX;    // 0-1 — center for radial/prism
  uniform float uCenterY;
  uniform float uPrismSpread;// 0-2 — extra hue spread in prism mode
  uniform vec2 uResolution;
  varying vec2 vUv;

  float lumaRGB(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    int mode = int(uMode + 0.5);
    vec4 base = texture2D(uTexture, vUv);

    // Per-pixel shift direction & magnitude.
    vec2 dir = vec2(0.0);
    float amt = uAmount;

    if (mode == 0) {
      // Directional (legacy).
      float angle = uAngle * 3.14159 / 180.0;
      dir = vec2(cos(angle), sin(angle));
    } else if (mode == 1 || mode == 2) {
      // Radial / prism — direction = away from center, magnitude scales
      // with distance from center (lens-fringe behavior).
      vec2 center = vec2(uCenterX, uCenterY);
      vec2 d = vUv - center;
      float dist = length(d);
      dir = (dist > 1e-5) ? d / dist : vec2(1.0, 0.0);
      amt *= dist * 2.0;
    } else if (mode == 3) {
      // Luma-dependent — only shift on bright pixels (mimics lens flare).
      float lum = lumaRGB(base.rgb);
      float angle = uAngle * 3.14159 / 180.0;
      dir = vec2(cos(angle), sin(angle));
      amt *= smoothstep(0.4, 0.95, lum);
    } else {
      // Edge-only — shift only where image gradients are high.
      float angle = uAngle * 3.14159 / 180.0;
      dir = vec2(cos(angle), sin(angle));
      vec2 t = 2.0 / uResolution;
      float gx = lumaRGB(texture2D(uTexture, vUv + vec2(t.x, 0.0)).rgb)
               - lumaRGB(texture2D(uTexture, vUv - vec2(t.x, 0.0)).rgb);
      float gy = lumaRGB(texture2D(uTexture, vUv + vec2(0.0, t.y)).rgb)
               - lumaRGB(texture2D(uTexture, vUv - vec2(0.0, t.y)).rgb);
      float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);
      amt *= edge;
    }

    vec2 shift = dir * amt / uResolution;

    vec4 color;
    if (mode == 2) {
      // Prism: spread R/G/B across a wider arc, shifted toward rainbow
      // dispersion. uPrismSpread bumps the per-channel offset asymmetry.
      float k = 1.0 + uPrismSpread;
      color.r = texture2D(uTexture, vUv + shift * (1.0 + 0.4 * k)).r;
      color.g = texture2D(uTexture, vUv + shift * 0.0).g;
      color.b = texture2D(uTexture, vUv - shift * (1.0 + 0.4 * k)).b;
    } else {
      color.r = texture2D(uTexture, vUv + shift).r;
      color.g = texture2D(uTexture, vUv).g;
      color.b = texture2D(uTexture, vUv - shift).b;
    }
    color.a = base.a;

    gl_FragColor = color;
  }
`;

// ============================================================================
// SCANLINES EFFECT (HERO) — phosphor RGB sub-pixel mask, rolling brightness
// bar (refresh-rate beat), CRT barrel curvature, interlace jitter.
// ============================================================================
export const scanlinesShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;   // 0-1 scanline darkening strength
  uniform float uCount;       // 50-500 scanline count
  uniform float uSpeed;       // 0-2 scanline scroll speed
  uniform float uPhosphor;    // 0-1 RGB sub-pixel mask intensity
  uniform float uRollingBar;  // 0-1 brightness bar that rolls down the screen
  uniform float uCurvature;   // 0-1 barrel distortion (CRT bulge)
  uniform float uInterlace;   // 0-1 interlace flicker (alternating odd/even rows)
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // CRT barrel curvature — push UVs outward proportional to distance²
    // from center. Sample is clamped so we don't read off-texture.
    if (uCurvature > 0.001) {
      vec2 centered = uv - 0.5;
      float r2 = dot(centered, centered);
      uv = centered * (1.0 + r2 * uCurvature * 0.4) + 0.5;
      // Black mask outside the curved tube.
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(uTexture, vUv).a);
        return;
      }
    }

    vec4 texColor = texture2D(uTexture, uv);

    // Scanline darkening (legacy).
    float scanlinePos = uv.y * uCount + uTime * uSpeed * 50.0;
    float scanline = sin(scanlinePos * 3.14159) * 0.5 + 0.5;
    float darkness = 1.0 - uIntensity * scanline * 0.5;

    vec3 col = texColor.rgb * darkness;

    // Phosphor RGB sub-pixel mask — divides each row of pixels into RGB
    // triads, brightening each color channel only on its sub-cell.
    if (uPhosphor > 0.001) {
      float subpixel = mod(floor(uv.x * uResolution.x), 3.0);
      vec3 mask = vec3(
        subpixel < 0.5 ? 1.0 : 0.4,
        (subpixel >= 0.5 && subpixel < 1.5) ? 1.0 : 0.4,
        subpixel >= 1.5 ? 1.0 : 0.4
      );
      col *= mix(vec3(1.0), mask, uPhosphor);
    }

    // Rolling brightness bar — slow horizontal band that scrolls down.
    if (uRollingBar > 0.001) {
      float barPos = fract(uv.y - uTime * 0.15);
      float bar = smoothstep(0.0, 0.05, barPos) * smoothstep(0.15, 0.10, barPos);
      col *= 1.0 + bar * uRollingBar * 0.4;
    }

    // Interlace flicker — alternate-row brightness flicker at refresh rate.
    if (uInterlace > 0.001) {
      float row = floor(uv.y * uResolution.y);
      float frame = floor(uTime * 30.0);
      float flicker = mod(row + frame, 2.0);
      col *= mix(1.0, mix(0.85, 1.15, flicker), uInterlace);
    }

    gl_FragColor = vec4(col, texColor.a);
  }
`;

// ============================================================================
// PIXELATE EFFECT (HERO) — modes (nearest / luma-mosaic / hex / circle),
// pixel grid outline (LED look), animated pixel size pulse.
// ============================================================================
export const pixelateShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSize;        // 1-64 pixel size
  uniform float uMode;        // 0=nearest, 1=luma mosaic, 2=hex, 3=circle/LED
  uniform float uGridLines;   // 0-1 dark grout lines between pixels (LED panel look)
  uniform float uAnimSpeed;   // 0-2 size pulse speed (0 = static)
  uniform float uAnimAmount;  // 0-1 size pulse amplitude
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);

    // Animated size — sin oscillation around uSize.
    float sz = uSize;
    if (uAnimSpeed > 0.001) {
      float w = sin(uTime * uAnimSpeed * 3.14159) * 0.5 + 0.5;
      sz = uSize * mix(1.0 - uAnimAmount * 0.5, 1.0 + uAnimAmount * 1.0, w);
    }
    sz = max(sz, 1.0);

    vec2 pixelSize = sz / uResolution;
    vec2 cellId = floor(vUv / pixelSize);
    vec2 cellUv = (cellId + 0.5) * pixelSize;
    vec2 cellLocal = (vUv - cellId * pixelSize) / pixelSize; // 0..1 inside cell

    vec4 sample0 = texture2D(uTexture, cellUv);

    if (mode == 1) {
      // Luma mosaic — each cell is rendered as a flat luma-step value
      // (3 steps per channel) so the image becomes a chunky comic look.
      vec3 q = floor(sample0.rgb * 4.0) / 3.0;
      gl_FragColor = vec4(q, sample0.a);
      return;
    }

    if (mode == 2) {
      // Hex — only pixels inside a hexagonal cell pass through;
      // approximate by clamping to a hex distance.
      vec2 d = cellLocal - 0.5;
      float hex = max(abs(d.x), max(abs(d.y), abs(d.x) * 0.5 + abs(d.y) * 0.866));
      if (hex > 0.5) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, sample0.a * 0.4);
        return;
      }
    }

    if (mode == 3) {
      // Circle / LED — pixels are circles with brightness = sampled luma.
      vec2 d = cellLocal - 0.5;
      float dist = length(d);
      float disc = smoothstep(0.5, 0.45, dist);
      gl_FragColor = vec4(sample0.rgb * disc, sample0.a);
      return;
    }

    // Grid lines (LED grout). Darken the cell edge.
    if (uGridLines > 0.001) {
      vec2 edge = abs(cellLocal - 0.5);
      float onEdge = step(0.46, max(edge.x, edge.y));
      sample0.rgb *= mix(1.0, 0.0, onEdge * uGridLines);
    }

    gl_FragColor = sample0;
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
// PLASMA EFFECT (HERO) — turbulence warp, blend modes, audio-reactive scale,
// 8 palettes (rainbow, fire, ocean, neon, matrix, lava, ice, storm).
// ============================================================================
export const plasmaShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSpeed;
  uniform float uScale;
  uniform float uComplexity;
  uniform float uPalette;
  uniform float uMode;
  uniform float uBlendMode;
  uniform float uMix;
  uniform float uWarpAmount;
  uniform float uAudioReact;
  uniform float uAudio;
  uniform float uTime;
  varying vec2 vUv;

  vec3 rainbowPalette(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
  vec3 firePalette(float t) { return vec3(smoothstep(0.0, 0.5, t), smoothstep(0.3, 0.7, t) * 0.7, smoothstep(0.7, 1.0, t) * 0.3); }
  vec3 oceanPalette(float t) { return vec3(smoothstep(0.5, 1.0, t) * 0.3, smoothstep(0.2, 0.8, t) * 0.6 + 0.2, 0.4 + 0.6 * t); }
  vec3 neonPalette(float t) {
    float r = sin(t * 6.28318) * 0.5 + 0.5;
    float g = sin(t * 6.28318 + 2.094) * 0.5 + 0.5;
    float b = sin(t * 6.28318 + 4.188) * 0.5 + 0.5;
    return pow(vec3(r, g, b), vec3(0.5));
  }
  vec3 matrixPalette(float t) { return vec3(0.0, t * 0.8 + 0.2, t * 0.3); }
  vec3 lavaPalette(float t) { return vec3(smoothstep(0.0, 0.4, t) * 1.0, smoothstep(0.3, 0.85, t) * 0.6, smoothstep(0.85, 1.0, t) * 0.4); }
  vec3 icePalette(float t) { return vec3(0.4 * t + smoothstep(0.7, 1.0, t) * 0.6, 0.2 + 0.6 * t, 0.5 + 0.5 * t); }
  vec3 stormPalette(float t) {
    vec3 dark = vec3(0.08, 0.08, 0.12);
    vec3 mid  = vec3(0.45, 0.35, 0.55);
    vec3 hi   = vec3(0.95, 0.95, 1.00);
    return mix(mix(dark, mid, smoothstep(0.0, 0.6, t)), hi, smoothstep(0.7, 1.0, t));
  }

  float plasmaField(vec2 p, float t, float complexity) {
    float plasma = 0.0;
    plasma += sin(p.x * 10.0 + t);
    plasma += sin(p.y * 10.0 + t * 1.1);
    plasma += sin((p.x + p.y) * 10.0 + t * 0.5);
    plasma += sin(sqrt(p.x * p.x + p.y * p.y) * 10.0 + t * 0.7);
    if (complexity > 1.0) plasma += sin(p.x * 5.0 + sin(p.y * 3.0 + t) * 2.0);
    if (complexity > 2.0) plasma += sin(p.y * 7.0 + sin(p.x * 5.0 + t * 1.3) * 2.0);
    if (complexity > 3.0) plasma += sin(length(p - vec2(0.5 * uScale)) * 8.0 - t * 2.0);
    if (complexity > 4.0) plasma += sin(atan(p.y - 0.5 * uScale, p.x - 0.5 * uScale) * 5.0 + t);
    return plasma / (4.0 + max(complexity - 1.0, 0.0)) * 0.5 + 0.5;
  }

  vec3 paletteLookup(int paletteType, float t) {
    if (paletteType == 0) return rainbowPalette(t);
    if (paletteType == 1) return firePalette(t);
    if (paletteType == 2) return oceanPalette(t);
    if (paletteType == 3) return neonPalette(t);
    if (paletteType == 4) return matrixPalette(t);
    if (paletteType == 5) return lavaPalette(t);
    if (paletteType == 6) return icePalette(t);
    return stormPalette(t);
  }

  vec3 applyBlend(vec3 base, vec3 plasmaCol, int mode) {
    if (mode == 0) return base * plasmaCol;
    if (mode == 1) return 1.0 - (1.0 - base) * (1.0 - plasmaCol);
    if (mode == 2) return min(base + plasmaCol, vec3(1.0));
    if (mode == 3) {
      vec3 lo = 2.0 * base * plasmaCol;
      vec3 hi = 1.0 - 2.0 * (1.0 - base) * (1.0 - plasmaCol);
      return mix(lo, hi, step(0.5, base));
    }
    return plasmaCol;
  }

  void main() {
    float audioPunch = clamp(uAudio, 0.0, 1.5) * uAudioReact;
    float effectiveScale = uScale * (1.0 + audioPunch * 0.6);
    float t = uTime * uSpeed;
    vec2 p = vUv * effectiveScale;
    int mode = int(uMode + 0.5);

    vec2 sampleUv = vUv;
    if (mode == 1 || mode == 2) {
      vec2 warpField = vec2(
        plasmaField(p * 0.5 + vec2(0.0, 1.7), t * 0.7, max(uComplexity, 2.0)),
        plasmaField(p * 0.5 + vec2(3.1, 0.0), t * 0.9, max(uComplexity, 2.0))
      ) - 0.5;
      sampleUv += warpField * uWarpAmount * 0.18;
    }
    vec4 texColor = texture2D(uTexture, sampleUv);

    if (mode == 1) {
      vec3 finalRgb = mix(texture2D(uTexture, vUv).rgb, texColor.rgb, uMix);
      gl_FragColor = vec4(finalRgb, texColor.a);
      return;
    }

    float plasma = plasmaField(p, t, uComplexity);
    int paletteType = int(uPalette);
    vec3 plasmaColor = paletteLookup(paletteType, plasma);
    int blendMode = int(uBlendMode + 0.5);
    vec3 blended = applyBlend(texColor.rgb, plasmaColor, blendMode);
    vec3 finalColor = mix(texColor.rgb, blended, uMix);
    gl_FragColor = vec4(finalColor, texColor.a);
  }
`;

// ============================================================================
// POSTERIZE EFFECT (HERO) — quantize colors with optional Bayer-ordered
// dither (breaks up banding), animated level stepping (cycles through
// quantization levels), and palette lock (snap to a fixed comic/thermal/
// retro palette instead of free-RGB quantization).
// ============================================================================
export const posterizeShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uLevels;        // 2-32 color levels per channel
  uniform float uDitherAmount;  // 0-1 — Bayer 4×4 ordered dither strength
  uniform float uAnimSpeed;     // 0-2 — animated level stepping speed (0 = static)
  uniform float uPaletteLock;   // 0=free RGB, 1=comic, 2=thermal, 3=retro 4-color
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  // Bayer 4×4 dither matrix in [0..1] range (after /16).
  float bayer4(vec2 pos) {
    int x = int(mod(pos.x, 4.0));
    int y = int(mod(pos.y, 4.0));
    int idx = x + y * 4;
    // Unrolled Bayer 4x4 (standard ordering scaled by 1/16).
    float m =
      idx == 0  ?  0.0 :
      idx == 1  ?  8.0 :
      idx == 2  ?  2.0 :
      idx == 3  ? 10.0 :
      idx == 4  ? 12.0 :
      idx == 5  ?  4.0 :
      idx == 6  ? 14.0 :
      idx == 7  ?  6.0 :
      idx == 8  ?  3.0 :
      idx == 9  ? 11.0 :
      idx == 10 ?  1.0 :
      idx == 11 ?  9.0 :
      idx == 12 ? 15.0 :
      idx == 13 ?  7.0 :
      idx == 14 ? 13.0 : 5.0;
    return (m + 0.5) / 16.0 - 0.5;
  }

  // Snap an RGB color to the nearest entry in a fixed palette.
  vec3 snapToPalette(vec3 c, int palette) {
    if (palette == 1) {
      // Comic: 6 bold flat colors — black, red, yellow, green, blue, white.
      vec3 palC[6];
      palC[0] = vec3(0.05, 0.05, 0.05);
      palC[1] = vec3(0.85, 0.10, 0.15);
      palC[2] = vec3(0.95, 0.85, 0.10);
      palC[3] = vec3(0.20, 0.65, 0.30);
      palC[4] = vec3(0.10, 0.30, 0.85);
      palC[5] = vec3(0.96, 0.96, 0.96);
      vec3 best = palC[0];
      float bestD = 1e9;
      for (int i = 0; i < 6; i++) {
        float d = dot(c - palC[i], c - palC[i]);
        if (d < bestD) { bestD = d; best = palC[i]; }
      }
      return best;
    } else if (palette == 2) {
      // Thermal: 5-stop heatmap — black, blue, magenta, orange, white.
      vec3 palT[5];
      palT[0] = vec3(0.0, 0.0, 0.05);
      palT[1] = vec3(0.05, 0.10, 0.55);
      palT[2] = vec3(0.65, 0.15, 0.55);
      palT[3] = vec3(0.95, 0.45, 0.10);
      palT[4] = vec3(0.98, 0.96, 0.85);
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      float idx = clamp(lum * 4.0, 0.0, 4.0);
      int i0 = int(floor(idx));
      int i1 = min(i0 + 1, 4);
      return mix(palT[i0], palT[i1], fract(idx));
    } else {
      // Retro 4-color (Game Boy / classic LCD): dark green, mid green, light green, cream.
      vec3 palR[4];
      palR[0] = vec3(0.10, 0.20, 0.10);
      palR[1] = vec3(0.30, 0.45, 0.25);
      palR[2] = vec3(0.55, 0.70, 0.40);
      palR[3] = vec3(0.85, 0.92, 0.70);
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      float idx = clamp(lum * 3.0, 0.0, 3.0);
      int i0 = int(floor(idx));
      int i1 = min(i0 + 1, 3);
      return mix(palR[i0], palR[i1], fract(idx));
    }
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // Animated stepping — levels oscillates between half and full
    // when uAnimSpeed > 0. Creates a pulsing posterize.
    float animLevels = uLevels;
    if (uAnimSpeed > 0.001) {
      float t = sin(uTime * uAnimSpeed * 3.14159) * 0.5 + 0.5;
      animLevels = mix(2.0, uLevels, t);
    }
    float levels = max(2.0, floor(animLevels));

    // Apply Bayer dither BEFORE quantization to break up banding.
    vec3 src = texColor.rgb;
    if (uDitherAmount > 0.001) {
      vec2 pxPos = vUv * uResolution;
      float d = bayer4(pxPos);
      src = clamp(src + d * uDitherAmount / levels, 0.0, 1.0);
    }

    vec3 posterized;
    int paletteMode = int(uPaletteLock + 0.5);
    if (paletteMode == 0) {
      // Free RGB quantization (legacy behavior).
      posterized = floor(src * levels) / (levels - 1.0);
    } else {
      // Snap to a fixed palette — uLevels controls smoothness of the
      // luma→palette interpolation indirectly through the dither.
      posterized = snapToPalette(src, paletteMode);
    }

    gl_FragColor = vec4(posterized, texColor.a);
  }
`;

// ============================================================================
// EDGE DETECTION EFFECT (HERO) — Sobel/Laplacian/Prewitt/Frei-Chen plus a
// COLOR-edge mode that detects per-channel edges. Colored edges (RGB tint),
// edge glow, edge-only alpha output (transparent body, only edges visible).
// "Laser outline" preset is the headline use.
// ============================================================================
export const edgeDetectShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uThreshold;   // 0-1 edge threshold
  uniform float uThickness;   // 0.5-3 line thickness
  uniform float uMode;        // 0=sobel, 1=laplacian, 2=prewitt, 3=frei-chen, 4=color-edge
  uniform float uInvert;      // 0=normal, 1=inverted
  uniform float uEdgeR;       // 0-1 edge tint R (when uTintEdges > 0)
  uniform float uEdgeG;
  uniform float uEdgeB;
  uniform float uTintEdges;   // 0-1 — 0=white edges (legacy), 1=full tint color
  uniform float uGlow;        // 0-1 — bloom-style glow around edges
  uniform float uEdgeOnly;    // 0=show image+edges, 1=transparent fill (edges-only alpha)
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

    // Color-edge mode (uMode=4) — compute Sobel per channel and combine.
    if (uMode > 3.5) {
      vec3 cTL = texture2D(uTexture, vUv + vec2(-texel.x, texel.y)).rgb;
      vec3 cTR = texture2D(uTexture, vUv + vec2(texel.x, texel.y)).rgb;
      vec3 cBL = texture2D(uTexture, vUv + vec2(-texel.x, -texel.y)).rgb;
      vec3 cBR = texture2D(uTexture, vUv + vec2(texel.x, -texel.y)).rgb;
      vec3 cML = texture2D(uTexture, vUv + vec2(-texel.x, 0.0)).rgb;
      vec3 cMR = texture2D(uTexture, vUv + vec2(texel.x, 0.0)).rgb;
      vec3 cTC = texture2D(uTexture, vUv + vec2(0.0, texel.y)).rgb;
      vec3 cBC = texture2D(uTexture, vUv + vec2(0.0, -texel.y)).rgb;
      vec3 gxV = -cTL - 2.0*cML - cBL + cTR + 2.0*cMR + cBR;
      vec3 gyV = -cTL - 2.0*cTC - cTR + cBL + 2.0*cBC + cBR;
      vec3 edgeRGB = sqrt(gxV*gxV + gyV*gyV);
      // Per-channel threshold + invert.
      edgeRGB = smoothstep(vec3(uThreshold * 0.3), vec3(uThreshold * 0.8 + 0.02), edgeRGB);
      if (uInvert > 0.5) edgeRGB = 1.0 - edgeRGB;
      vec4 texColor = texture2D(uTexture, vUv);
      vec3 finalCol = edgeRGB;
      float a = uEdgeOnly > 0.5 ? max(max(edgeRGB.r, edgeRGB.g), edgeRGB.b) : texColor.a;
      gl_FragColor = vec4(finalCol, a);
      return;
    }

    edge = smoothstep(uThreshold * 0.3, uThreshold * 0.8 + 0.02, edge);
    if (uInvert > 0.5) edge = 1.0 - edge;

    // Tint edges from white to user color. uTintEdges=0 keeps legacy
    // monochrome white edges; =1 fully replaces with the tint color.
    vec3 tint = mix(vec3(1.0), vec3(uEdgeR, uEdgeG, uEdgeB), uTintEdges);
    vec3 edgeColor = tint * edge;

    // Glow — sample a wider neighborhood and add a bloom around edges.
    if (uGlow > 0.001) {
      float glowSum = 0.0;
      for (int gi = -2; gi <= 2; gi++) {
        for (int gj = -2; gj <= 2; gj++) {
          vec2 off = vec2(float(gi), float(gj)) / uResolution * (2.0 + uGlow * 4.0);
          float l = edgeLum(texture2D(uTexture, vUv + off).rgb);
          glowSum += l;
        }
      }
      glowSum = (glowSum / 25.0) * uGlow * 0.6;
      edgeColor += tint * glowSum;
    }

    vec4 texColor = texture2D(uTexture, vUv);
    if (uEdgeOnly > 0.5) {
      // Transparent body, edges only — alpha proportional to edge strength.
      gl_FragColor = vec4(edgeColor, edge);
    } else {
      gl_FragColor = vec4(edgeColor, texColor.a);
    }
  }
`;

// ============================================================================
// OUTLINE EFFECT (HERO) — inner/outer/both, animated crawling outline,
// glow falloff control, alpha-aware (uses source alpha for clean masks).
// ============================================================================
export const outlineShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uThickness;   // 1-10 outline thickness
  uniform vec3 uColor;        // Outline color
  uniform float uOnly;        // 0=overlay, 1=outline only
  uniform float uGlow;        // 0-1 glow amount
  uniform float uPosition;    // 0=outer, 1=inner, 2=both (centered on edge)
  uniform float uCrawl;       // 0-1 — animated marching-ants crawl speed
  uniform float uGlowFalloff; // 0.5-3 — falloff power (lower=tighter, higher=softer)
  uniform float uAlphaAware;  // 0-1 — use source alpha as the boundary instead of luma
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float outlineLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec2 texel = uThickness / uResolution;
    // Boundary metric: luma by default, alpha when alpha-aware.
    float centerVal = mix(outlineLum(texColor.rgb), texColor.a, uAlphaAware);

    float edge = 0.0;
    float insideSum = 0.0;
    float outsideSum = 0.0;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        if (i == 0 && j == 0) continue;
        vec2 off = vec2(float(i), float(j)) * texel;
        vec4 nb4 = texture2D(uTexture, vUv + off);
        float nb = mix(outlineLum(nb4.rgb), nb4.a, uAlphaAware);
        edge += abs(nb - centerVal);
        // Inner = current pixel is brighter than neighbor, outer = darker.
        if (nb < centerVal) insideSum += (centerVal - nb);
        else                outsideSum += (nb - centerVal);
      }
    }
    edge = edge / 8.0;
    edge = smoothstep(0.05, 0.15, edge);

    // Inner / outer / both selection.
    int posMode = int(uPosition + 0.5);
    if (posMode == 0)      edge = edge * smoothstep(0.0, 0.1, outsideSum / 8.0); // outer
    else if (posMode == 1) edge = edge * smoothstep(0.0, 0.1, insideSum / 8.0);  // inner
    // posMode == 2 keeps both (no extra mask).

    // Animated crawling outline — modulate edge intensity with a moving
    // sine pattern along the gradient direction (marching ants style).
    if (uCrawl > 0.001) {
      float crawl = sin((vUv.x + vUv.y) * 80.0 - uTime * uCrawl * 6.0);
      edge *= 0.5 + 0.5 * crawl;
    }

    // Glow with adjustable falloff power.
    if (uGlow > 0.0) {
      float glowEdge = 0.0;
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          vec2 off = vec2(float(i), float(j)) * texel * 2.0;
          vec4 nb4 = texture2D(uTexture, vUv + off);
          float nb = mix(outlineLum(nb4.rgb), nb4.a, uAlphaAware);
          glowEdge += abs(nb - centerVal);
        }
      }
      glowEdge = glowEdge / 24.0;
      glowEdge = pow(smoothstep(0.02, 0.1, glowEdge), uGlowFalloff);
      edge = max(edge, glowEdge * uGlow * 0.7);
    }

    vec3 outColor = uColor * edge;
    vec3 finalColor;
    if (uOnly > 0.5) finalColor = outColor;
    else             finalColor = texColor.rgb + outColor;

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`;

// ============================================================================
// EMBOSS EFFECT (HERO) — relight controls (light angle + height), colored
// highlights and shadows, normal-map preview mode (RGB encodes surface
// normal). Metallic/plaster/bas-relief presets.
// ============================================================================
export const embossShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uStrength;        // 0-2 emboss strength
  uniform float uAngle;           // 0-360 light direction
  uniform float uHeight;          // 0-1 surface height exaggeration
  uniform float uHighlightR;      // 0-1 highlight tint
  uniform float uHighlightG;
  uniform float uHighlightB;
  uniform float uShadowR;         // 0-1 shadow tint
  uniform float uShadowG;
  uniform float uShadowB;
  uniform float uNormalMode;      // 0=emboss (relit), 1=normal-map preview
  uniform float uMetallicness;    // 0-1 boosts highlight reflectivity
  uniform vec2 uResolution;
  varying vec2 vUv;

  float embossLum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    float angle = uAngle * 3.14159265 / 180.0;
    vec2 dir = vec2(cos(angle), sin(angle));

    // Build a surface normal from luma gradients in 4 directions.
    float lL = embossLum(texture2D(uTexture, vUv - vec2(texel.x, 0.0)).rgb);
    float lR = embossLum(texture2D(uTexture, vUv + vec2(texel.x, 0.0)).rgb);
    float lD = embossLum(texture2D(uTexture, vUv - vec2(0.0, texel.y)).rgb);
    float lU = embossLum(texture2D(uTexture, vUv + vec2(0.0, texel.y)).rgb);
    float dx = (lR - lL) * (1.0 + uHeight * 4.0);
    float dy = (lU - lD) * (1.0 + uHeight * 4.0);
    vec3 normal = normalize(vec3(-dx, -dy, 1.0));

    // Normal-map preview — encode normal as RGB.
    if (uNormalMode > 0.5) {
      gl_FragColor = vec4(normal * 0.5 + 0.5, texture2D(uTexture, vUv).a);
      return;
    }

    // Light direction in 3D from uAngle (azimuth) and a fixed elevation.
    vec3 light = normalize(vec3(dir.x, dir.y, 0.5));
    float diff = max(dot(normal, light), 0.0);
    float spec = pow(diff, mix(8.0, 64.0, uMetallicness)) * uMetallicness;

    // Emboss intensity from gradient along light direction.
    float along = (lR - lL) * dir.x + (lU - lD) * dir.y;
    float emboss = clamp(along * uStrength + 0.5, 0.0, 1.0);

    vec4 texColor = texture2D(uTexture, vUv);
    vec3 hi = vec3(uHighlightR, uHighlightG, uHighlightB);
    vec3 lo = vec3(uShadowR, uShadowG, uShadowB);
    vec3 lit = mix(lo, hi, emboss);

    // Blend the lit surface with the source color so detail isn't lost.
    vec3 finalCol = texColor.rgb * 0.5 + lit + vec3(spec);

    gl_FragColor = vec4(clamp(finalCol, 0.0, 1.0), texColor.a);
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
// THERMAL EFFECT (HERO) — palettes (classic/ironbow/arctic/predator/medical),
// edge heat shimmer (heat haze near hot zones), animated sensor noise
// (rolling banding), per-temperature shimmer falloff.
// ============================================================================
export const thermalShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;   // 0-2 contrast / temperature curve sharpness
  uniform float uPalette;     // 0=classic, 1=ironbow, 2=arctic, 3=predator, 4=medical
  uniform float uShimmer;     // 0-1 — heat-haze shimmer on hot pixels
  uniform float uSensorNoise; // 0-1 — animated rolling sensor banding noise
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float thHash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

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

  // Predator palette — high-contrast green/yellow/red threat-detection look.
  vec3 predatorPalette(float t) {
    if (t < 0.3)      return mix(vec3(0.0, 0.05, 0.0), vec3(0.0, 0.6, 0.1), t / 0.3);
    else if (t < 0.6) return mix(vec3(0.0, 0.6, 0.1), vec3(0.95, 0.85, 0.0), (t - 0.3) / 0.3);
    else if (t < 0.85)return mix(vec3(0.95, 0.85, 0.0), vec3(0.95, 0.25, 0.05), (t - 0.6) / 0.25);
    else              return mix(vec3(0.95, 0.25, 0.05), vec3(1.0, 0.0, 0.6), (t - 0.85) / 0.15);
  }
  // Medical palette — clean black-to-white IR for diagnostic look.
  vec3 medicalPalette(float t) {
    return vec3(t);
  }

  void main() {
    vec2 uv = vUv;

    // Heat shimmer — hot pixels (sampled separately) drive a tiny UV
    // wobble so the image distorts where it's hot.
    if (uShimmer > 0.001) {
      vec3 sample0 = texture2D(uTexture, uv).rgb;
      float lum0 = dot(sample0, vec3(0.299, 0.587, 0.114));
      float wobble = sin(uv.y * 60.0 + uTime * 4.0) * 0.5 + sin(uv.x * 35.0 + uTime * 3.0) * 0.5;
      uv.x += wobble * uShimmer * lum0 * 0.006;
      uv.y += wobble * uShimmer * lum0 * 0.003;
    }

    vec4 texColor = texture2D(uTexture, uv);

    float temp = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    temp = pow(temp, 1.0 / max(uIntensity, 0.05));

    // Sensor noise — banded horizontal rolling noise like a cheap IR sensor.
    if (uSensorNoise > 0.001) {
      float band = thHash(vec2(floor(vUv.y * uResolution.y * 0.5), floor(uTime * 8.0)));
      temp += (band - 0.5) * uSensorNoise * 0.18;
      temp = clamp(temp, 0.0, 1.0);
    }

    vec3 thermalColor;
    int paletteType = int(uPalette);
    if (paletteType == 0)      thermalColor = classicThermal(temp);
    else if (paletteType == 1) thermalColor = ironbowPalette(temp);
    else if (paletteType == 2) thermalColor = arcticPalette(temp);
    else if (paletteType == 3) thermalColor = predatorPalette(temp);
    else                       thermalColor = medicalPalette(temp);

    gl_FragColor = vec4(thermalColor, texColor.a);
  }
`;

// ============================================================================
// NIGHT VISION EFFECT (HERO) — phosphor color picker (green/amber/white),
// adjustable scope mask (off / circle / scope-cross), bloom strength,
// rolling sensor noise, and tactical/ghost preset-ready knobs.
// ============================================================================
export const nightVisionShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2 brightness boost
  uniform float uNoise;         // 0-1 grain amount
  uniform float uVignette;      // 0-1 circular vignette intensity
  // Hero-rewrite params
  uniform float uPhosphor;      // 0=green, 1=amber, 2=white phosphor
  uniform float uBloom;         // 0-2 phosphor bloom strength
  uniform float uScopeMask;     // 0=off, 1=circle (legacy), 2=scope crosshairs
  uniform float uRollingNoise;  // 0-1 horizontal rolling noise band amplitude
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float nvRandom(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  vec3 phosphorTint(float lum, int phosphor) {
    if (phosphor == 0) return vec3(lum * 0.2, lum, lum * 0.2);   // green
    if (phosphor == 1) return vec3(lum, lum * 0.65, lum * 0.15); // amber (1980s NVGs)
    return vec3(lum);                                             // white phosphor (modern)
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    lum = pow(lum, 0.8) * uIntensity;

    int phos = int(uPhosphor + 0.5);
    vec3 nvColor = phosphorTint(lum, phos);

    // Scanlines (always on at low intensity).
    float scanline = sin(vUv.y * uResolution.y * 2.0) * 0.5 + 0.5;
    nvColor *= 0.95 + scanline * 0.05;

    // Rolling noise — horizontal bands that scroll downward over time.
    if (uRollingNoise > 0.001) {
      float bandY = floor((vUv.y + uTime * 0.15) * 80.0);
      float bandRand = nvRandom(vec2(bandY, floor(uTime * 4.0)));
      nvColor += vec3(bandRand - 0.5) * uRollingNoise * 0.4 * vec3(0.0, 1.0, 0.0);
    }

    // Sensor grain.
    float n = nvRandom(vUv * uResolution + uTime * 1000.0);
    nvColor += (n - 0.5) * uNoise * 0.2;

    // Phosphor bloom — ring sample around the pixel, weighted by tint.
    if (uBloom > 0.001) {
      float glowSum = 0.0;
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          vec2 offset = vec2(float(i), float(j)) / uResolution * (3.0 + uBloom * 2.0);
          float s = dot(texture2D(uTexture, vUv + offset).rgb, vec3(0.299, 0.587, 0.114));
          glowSum += s;
        }
      }
      glowSum /= 25.0;
      vec3 bloomTint = phosphorTint(glowSum * 0.5, phos);
      nvColor += bloomTint * uBloom;
    }

    // Scope mask.
    int scope = int(uScopeMask + 0.5);
    if (scope >= 1) {
      vec2 center = vec2(0.5);
      float dist = length(vUv - center);
      float vig = 1.0 - smoothstep(0.3, 0.7, dist * (1.0 + uVignette));
      float scopeEdge = smoothstep(0.48, 0.5, dist);
      vig *= 1.0 - scopeEdge;
      nvColor *= vig;
      // Crosshairs overlay for mode 2.
      if (scope == 2) {
        float cx = abs(vUv.x - 0.5);
        float cy = abs(vUv.y - 0.5);
        float cross = step(cx, 0.001) + step(cy, 0.001);
        // Tick marks every 0.05.
        float tick = step(mod(vUv.y, 0.05), 0.002) * step(cx, 0.012)
                   + step(mod(vUv.x, 0.05), 0.002) * step(cy, 0.012);
        nvColor = mix(nvColor, phosphorTint(0.85, phos), min(cross + tick, 1.0));
      }
    }

    gl_FragColor = vec4(clamp(nvColor, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// POLYGON MASK EFFECT - Click-point mask with feather and invert
// ============================================================================
export const polygonMaskShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uPoints[256];
  uniform int uPointCount;      // Actual number of points
  uniform float uFeather;       // Edge feather amount (0-1)
  uniform float uInvert;        // 0=normal, 1=inverted (show outside)
  varying vec2 vUv;

  // Check if point is inside polygon using ray casting algorithm
  float pointInPolygon(vec2 p) {
    if (uPointCount < 3) return 0.0;

    int crossings = 0;

    for (int i = 0; i < 256; i++) {
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

    for (int i = 0; i < 256; i++) {
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
  uniform vec2 uPoints[256];
  uniform int uPointCount;
  uniform float uFeather;
  varying vec2 vUv;

  float pointInPolygon(vec2 p) {
    if (uPointCount < 3) return 0.0;
    int crossings = 0;
    for (int i = 0; i < 256; i++) {
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
    for (int i = 0; i < 256; i++) {
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
// BLOOM (HERO) — dedicated multi-octave bloom shader.
// ============================================================================
export const bloomHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;
  uniform float uIntensity;
  uniform float uThreshold;
  uniform float uKnee;
  uniform float uRadius;
  uniform float uAnamorphic;
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 thresholdKnee(vec3 col, float threshold, float knee) {
    float br = max(max(col.r, col.g), col.b);
    float kneeAmt = max(knee, 0.0001);
    float soft = clamp(br - threshold + kneeAmt, 0.0, 2.0 * kneeAmt);
    soft = soft * soft / (4.0 * kneeAmt + 0.00001);
    float contribution = max(soft, br - threshold) / max(br, 0.00001);
    return col * contribution;
  }

  vec3 ringSample(sampler2D tex, vec2 uv, vec2 px, float radius) {
    vec3 acc = vec3(0.0);
    float aniso = clamp(uAnamorphic, 0.0, 1.0);
    vec2 r = px * radius * vec2(1.0, 1.0 - aniso * 0.92);
    acc += texture2D(tex, uv + r * vec2( 1.0,  0.0)).rgb;
    acc += texture2D(tex, uv + r * vec2(-1.0,  0.0)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.7,  0.7)).rgb;
    acc += texture2D(tex, uv + r * vec2(-0.7,  0.7)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.7, -0.7)).rgb;
    acc += texture2D(tex, uv + r * vec2(-0.7, -0.7)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.0,  1.0)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.0, -1.0)).rgb;
    acc += texture2D(tex, uv + r * vec2( 1.7,  0.0)).rgb;
    acc += texture2D(tex, uv + r * vec2(-1.7,  0.0)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.0,  1.7)).rgb;
    acc += texture2D(tex, uv + r * vec2( 0.0, -1.7)).rgb;
    acc += texture2D(tex, uv).rgb;
    return acc / 13.0;
  }

  void main() {
    vec4 baseColor = texture2D(uTexture, vUv);
    vec2 px = 1.0 / uResolution;
    float baseR = uRadius * 9.0 + 1.5;
    vec3 ring1 = ringSample(uTexture, vUv, px, baseR * 1.0);
    vec3 ring2 = ringSample(uTexture, vUv, px, baseR * 2.2);
    vec3 ring3 = ringSample(uTexture, vUv, px, baseR * 4.5);
    vec3 blurred = ring1 * 0.55 + ring2 * 0.3 + ring3 * 0.15;
    vec3 bloom = thresholdKnee(blurred, uThreshold, uKnee);
    bloom *= uIntensity;
    bloom *= vec3(uTintR, uTintG, uTintB);
    vec3 composited = 1.0 - (1.0 - baseColor.rgb) * (1.0 - bloom);
    vec3 finalColor = mix(baseColor.rgb, composited, uAmount);
    gl_FragColor = vec4(finalColor, baseColor.a);
  }
`;

// ============================================================================
// FEEDBACK ZOOM (HERO) — Real previous-frame feedback buffer.
// ============================================================================
export const feedbackZoomHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uAmount;
  uniform float uZoom;
  uniform float uRotation;
  uniform float uDecay;
  uniform float uHueShift;
  uniform float uMaskCenter;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

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
    vec4 src = texture2D(uTexture, vUv);
    if (uHasFeedback < 0.5) { gl_FragColor = src; return; }

    vec2 centered = vUv - 0.5;
    float c = cos(uRotation);
    float s = sin(uRotation);
    centered = mat2(c, -s, s, c) * centered;
    centered /= max(uZoom, 0.001);
    vec2 fbUv = centered + 0.5;
    vec3 fb = texture2D(uFeedback, fbUv).rgb;

    float keepFactor = clamp(1.0 - uDecay, 0.0, 1.0);
    fb *= keepFactor;

    if (uHueShift > 0.001) {
      vec3 hsv = rgb2hsv(fb);
      hsv.x = fract(hsv.x + uHueShift * 0.1);
      fb = hsv2rgb(hsv);
    }

    float maskFactor = 1.0;
    if (uMaskCenter > 0.001) {
      float distFromCenter = length(vUv - 0.5);
      maskFactor = 1.0 - smoothstep(0.3, 0.7, distFromCenter * uMaskCenter);
    }
    vec3 fbBlended = fb * maskFactor;
    vec3 composited = 1.0 - (1.0 - src.rgb) * (1.0 - fbBlended);
    vec3 finalColor = mix(src.rgb, composited, uAmount);
    gl_FragColor = vec4(finalColor, max(src.a, fbBlended.r * uAmount));
  }
`;

// ============================================================================
// EXPOSURE (HERO) — carved out of the multi-mode proPackShader so it can
// have proper photographic Exposure (-2..+2 stops), highlight Roll-off,
// and Highlight Protect controls. Roll-off softens the top end so blown
// whites compress instead of clipping; Highlight Protect dynamically
// reduces gain in already-bright pixels so you can lift shadows without
// losing the sky.
// ============================================================================
export const exposureHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uExposure;          // -2 to +2 stops (multiplied into the linear gain)
  uniform float uRollOff;           // 0-1 highlight shoulder softness (0 = hard clip, 1 = very soft)
  uniform float uHighlightProtect;  // 0-1 — reduce exposure gain on already-bright pixels
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    // Photographic exposure: each stop = 2× linear gain.
    float gain = pow(2.0, uExposure);

    // Highlight protect — reduce gain locally on bright pixels. Per-pixel
    // luminance feeds a smoothstep so dark/mid pixels get full gain and
    // bright pixels get less. uHighlightProtect=1 means highlights are
    // mostly preserved; =0 means uniform gain across the image.
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    float protect = 1.0 - uHighlightProtect * smoothstep(0.5, 1.0, lum);
    vec3 lifted = src * gain * protect;

    // Highlight roll-off — soft-knee compress the top end so values
    // above 1 fold back toward 1 instead of clipping. uRollOff=0 leaves
    // the legacy hard clip; uRollOff=1 gives a very soft shoulder.
    if (uRollOff > 0.001) {
      float k = mix(8.0, 1.0, uRollOff); // higher k = sharper knee
      // Reinhard-style: x / (1 + x/k) — smooth asymptote toward 1.
      lifted = lifted / (1.0 + max(lifted - 0.0, 0.0) / k);
    }

    gl_FragColor = vec4(clamp(lifted, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// GAMMA (HERO) — three-zone shadows / mids / highlights gamma instead of
// a single curve. Each zone gets its own gamma exponent, blended via
// luma-based weights so adjustments don't crush the other tonal regions.
// ============================================================================
export const gammaHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uShadows;     // 0.2-3.0 gamma for shadow region
  uniform float uMids;        // 0.2-3.0 gamma for midtones
  uniform float uHighlights;  // 0.2-3.0 gamma for highlights
  uniform float uMix;         // 0-1 wet/dry
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    // Three smoothstep weights centered on 0.15 / 0.5 / 0.85.
    float wS = 1.0 - smoothstep(0.0, 0.5, lum);
    float wH = smoothstep(0.5, 1.0, lum);
    float wM = 1.0 - wS - wH;
    // Blend the three gamma curves additively by weight.
    vec3 gS = pow(src, vec3(max(uShadows, 0.0001)));
    vec3 gM = pow(src, vec3(max(uMids, 0.0001)));
    vec3 gH = pow(src, vec3(max(uHighlights, 0.0001)));
    vec3 graded = gS * wS + gM * wM + gH * wH;
    gl_FragColor = vec4(mix(src, graded, uMix), texColor.a);
  }
`;

// ============================================================================
// VIBRANCE (HERO) — boost saturation with skin protect, highlight protect,
// saturation ceiling, negative range. Skin protect biases AGAINST orange-pink
// hues so faces don't get over-saturated; ceiling clamps the result.
// ============================================================================
export const vibranceHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uVibrance;        // -1..+1 — positive boosts muted colors, negative desaturates
  uniform float uSkinProtect;     // 0-1 — reduce vibrance push on skin-tone hues
  uniform float uHighlightProtect;// 0-1 — reduce vibrance push on bright pixels
  uniform float uCeiling;         // 0-1 — clamp final saturation (1 = no clamp)
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 hsv = rgb2hsv(texColor.rgb);

    // Skin tone protect — peak around hue ~0.05 (orange-pink ~30°),
    // gaussian falloff. Reduces the vibrance push by skinProtect there.
    float skinDist = abs(hsv.x - 0.05);
    if (skinDist > 0.5) skinDist = 1.0 - skinDist; // hue is circular
    float skinMask = exp(-(skinDist * skinDist) / 0.01); // ~σ=0.1
    float skinScale = 1.0 - uSkinProtect * skinMask;

    // Highlight protect — reduce push on already bright pixels.
    float hlScale = 1.0 - uHighlightProtect * smoothstep(0.6, 1.0, hsv.z);

    // Vibrance boost — non-linear so muted colors lift more than already
    // saturated ones (the classic Lightroom Vibrance behavior).
    float boost = uVibrance * (1.0 - hsv.y) * skinScale * hlScale;
    hsv.y = clamp(hsv.y + boost, 0.0, uCeiling);

    gl_FragColor = vec4(hsv2rgb(hsv), texColor.a);
  }
`;

// ============================================================================
// TEMPERATURE / TINT (HERO) — kelvin-style temp slider (~3000K-9000K mapped
// to -1..+1), green↔magenta tint, optional split-tone for shadows vs
// highlights. Auto-cycle drives a slow temperature oscillation for cinematic
// breathing color.
// ============================================================================
export const temperatureTintHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTemperature;   // -1..+1 — cool (blue) to warm (orange)
  uniform float uTint;          // -1..+1 — green to magenta
  uniform float uShadowTemp;    // -1..+1 — split-tone shadows (used when uSplitTone > 0)
  uniform float uHighlightTemp; // -1..+1 — split-tone highlights
  uniform float uSplitTone;     // 0-1 — blend factor between simple temp and split-tone
  uniform float uAutoCycle;     // 0-1 — auto temperature oscillation amplitude
  uniform float uTime;
  varying vec2 vUv;

  vec3 tempShift(float t) {
    // Approximate kelvin shift: warm = +R/-B, cool = -R/+B, slight G compensation.
    return vec3(t * 0.30, t * 0.05, -t * 0.30);
  }
  vec3 tintShift(float t) {
    // Green = +G/-RB, magenta = -G/+RB.
    return vec3(-t * 0.10, t * 0.18, -t * 0.10);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    // Auto-cycle adds a slow sine-wave temperature offset.
    float autoT = sin(uTime * 0.4) * uAutoCycle * 0.5;

    // Single-temp path (uSplitTone=0).
    vec3 simple = src + tempShift(uTemperature + autoT) + tintShift(uTint);

    // Split-tone path: per-pixel temperature based on luminance.
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    float perPixT = mix(uShadowTemp, uHighlightTemp, smoothstep(0.0, 1.0, lum));
    vec3 split = src + tempShift(perPixT + autoT) + tintShift(uTint);

    vec3 result = mix(simple, split, uSplitTone);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// COLOR BALANCE (HERO) — three-zone shadows / midtones / highlights, each
// with its own RGB shift. Mirrors DaVinci Resolve / Lightroom split toning.
// ============================================================================
export const colorBalanceHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uShadowR;     uniform float uShadowG;     uniform float uShadowB;     // -1..+1 each
  uniform float uMidR;        uniform float uMidG;        uniform float uMidB;
  uniform float uHighR;       uniform float uHighG;       uniform float uHighB;
  uniform float uPreserveLuma;// 0-1 keep luma stable while shifting hue
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;
    float lum = dot(src, vec3(0.299, 0.587, 0.114));

    // Three smoothstep weights matching Gamma hero's three-zone setup.
    float wS = 1.0 - smoothstep(0.0, 0.5, lum);
    float wH = smoothstep(0.5, 1.0, lum);
    float wM = 1.0 - wS - wH;

    vec3 shift = vec3(uShadowR, uShadowG, uShadowB) * wS * 0.3
               + vec3(uMidR,    uMidG,    uMidB)    * wM * 0.3
               + vec3(uHighR,   uHighG,   uHighB)   * wH * 0.3;

    vec3 graded = src + shift;

    if (uPreserveLuma > 0.001) {
      float newLum = dot(graded, vec3(0.299, 0.587, 0.114));
      graded += (lum - newLum) * uPreserveLuma;
    }

    gl_FragColor = vec4(clamp(mix(src, graded, uMix), 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// CURVES (HERO) — S-curve with toe and shoulder controls, plus a black-crush
// pre-process. Operates on luma to preserve hue. Way more useful than the
// stock 4-slider RGB curve.
// ============================================================================
export const curvesHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uContrast;    // 0-1 — S-curve strength (0 = linear, 1 = strong S)
  uniform float uToe;         // 0-1 — lift the dark end (anti-crush)
  uniform float uShoulder;    // 0-1 — soften the bright end (anti-blow-out)
  uniform float uBlackCrush;  // 0-1 — crush pixels below threshold to true black
  uniform float uMix;
  varying vec2 vUv;

  // Hermite-style S curve centered at 0.5.
  float sCurve(float x, float strength) {
    float t = smoothstep(0.0, 1.0, x);
    return mix(x, t * t * (3.0 - 2.0 * t), strength);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    // Pre-process: black crush — anything below threshold goes to 0.
    vec3 crushed = src;
    if (uBlackCrush > 0.001) {
      float th = uBlackCrush * 0.15;
      crushed = max(crushed - vec3(th), vec3(0.0)) / max(1.0 - th, 0.001);
    }

    // Apply S-curve per channel for contrast.
    vec3 sShaped;
    sShaped.r = sCurve(crushed.r, uContrast);
    sShaped.g = sCurve(crushed.g, uContrast);
    sShaped.b = sCurve(crushed.b, uContrast);

    // Toe lift — raise the dark pixels back up.
    vec3 toed = mix(sShaped, sShaped + (1.0 - sShaped) * 0.0, 0.0); // placeholder identity
    // Toe = subtle gamma lift on shadows only.
    if (uToe > 0.001) {
      float toeAmt = uToe * 0.5;
      sShaped = pow(sShaped, vec3(1.0 - toeAmt));
    }

    // Shoulder — soft compress highlights.
    if (uShoulder > 0.001) {
      vec3 sho = 1.0 - exp(-sShaped * (1.0 + uShoulder * 2.0));
      sShaped = mix(sShaped, sho, uShoulder);
    }

    gl_FragColor = vec4(mix(src, sShaped, uMix), texColor.a);
  }
`;

// ============================================================================
// LIFT / GAMMA / GAIN (HERO) — three-zone color grading: lift shifts shadows,
// gamma shifts midtones, gain shifts highlights. Each takes an RGB color
// chip. Industry-standard color-grading tool. Bypassable luma-only mode
// keeps brightness shaping without color shift.
// ============================================================================
export const liftGammaGainHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uLiftR;   uniform float uLiftG;   uniform float uLiftB;   // -0.5..+0.5
  uniform float uGammaR;  uniform float uGammaG;  uniform float uGammaB;  // 0.5..1.5 (1 = neutral)
  uniform float uGainR;   uniform float uGainG;   uniform float uGainB;   // 0.5..2.0
  uniform float uLumaOnly;// 0-1 — bypass color shifts, apply intensity only
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    vec3 lift  = vec3(uLiftR,  uLiftG,  uLiftB);
    vec3 gamma = vec3(uGammaR, uGammaG, uGammaB);
    vec3 gain  = vec3(uGainR,  uGainG,  uGainB);

    if (uLumaOnly > 0.5) {
      // Average the channels for luma-only operation.
      float l = (lift.r + lift.g + lift.b) / 3.0;
      float g = (gamma.r + gamma.g + gamma.b) / 3.0;
      float gn = (gain.r + gain.g + gain.b) / 3.0;
      lift = vec3(l); gamma = vec3(g); gain = vec3(gn);
    }

    // Standard ASC-CDL-ish formula: out = pow((src - 0) * gain + lift * (1 - src), 1/gamma)
    // Simplified for our knob ranges — lift adds in shadows (multiplied by
    // 1-src so it doesn't blow out highlights), gain multiplies, gamma is
    // the inverse exponent.
    vec3 lifted = src + lift * (vec3(1.0) - src) * 0.5;
    vec3 gained = lifted * gain;
    vec3 graded = pow(max(gained, vec3(0.0)), vec3(1.0) / max(gamma, vec3(0.05)));

    gl_FragColor = vec4(clamp(mix(src, graded, uMix), 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// FILMIC TONEMAP (HERO) — multi-curve selector: ACES, Reinhard, Hable
// (Uncharted 2), bleach bypass, print film, soft clip. Each maps HDR-ish
// linear values down to 0..1 with its signature shoulder.
// ============================================================================
export const filmicTonemapHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uCurve;       // 0=ACES, 1=Reinhard, 2=Hable, 3=Bleach Bypass, 4=Print Film, 5=Soft Clip
  uniform float uExposure;    // 0.25-4.0 — pre-tonemap gain
  uniform float uContrast;    // 0-1 — post-tonemap S-curve
  uniform float uMix;
  varying vec2 vUv;

  // ACES Narkowicz approximation.
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 reinhard(vec3 x) { return x / (1.0 + x); }
  vec3 hable(vec3 x) {
    float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30, W = 11.2;
    vec3 n = ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
    float wn = ((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F;
    return n / wn;
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb * uExposure;
    int mode = int(uCurve + 0.5);
    vec3 mapped;

    if (mode == 0)      mapped = aces(src);
    else if (mode == 1) mapped = reinhard(src);
    else if (mode == 2) mapped = hable(src);
    else if (mode == 3) {
      // Bleach Bypass — desaturated / high-contrast film look.
      vec3 lum = vec3(dot(src, vec3(0.299, 0.587, 0.114)));
      mapped = clamp(mix(src, lum * 1.4, 0.5), 0.0, 1.0);
      mapped = aces(mapped);
    }
    else if (mode == 4) {
      // Print Film — soft toe, gentle shoulder, slightly cooled.
      mapped = aces(src * vec3(0.95, 0.97, 1.05));
      mapped = pow(mapped, vec3(1.0 / 1.1));
    }
    else {
      // Soft Clip — Reinhard with a sharper knee.
      mapped = src / (1.0 + src * 0.5);
    }

    // Optional post S-curve for extra punch.
    if (uContrast > 0.001) {
      vec3 t = smoothstep(0.0, 1.0, mapped);
      mapped = mix(mapped, t * t * (3.0 - 2.0 * t), uContrast);
    }

    gl_FragColor = vec4(mix(texColor.rgb, mapped, uMix), texColor.a);
  }
`;

// ============================================================================
// SELECTIVE COLOR (HERO) — pick a target hue, isolate-or-replace pixels in
// the hue range, with a width control and feather. Two modes: Isolate
// (desaturate everything outside the range) and Replace (shift target hue
// to a new hue while keeping luma/saturation).
// ============================================================================
export const selectiveColorHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTargetHue;    // 0-1 — hue to target (0=red, 0.33=green, 0.67=blue)
  uniform float uHueRange;     // 0-1 — width of the hue band (0.05 = narrow, 0.3 = wide)
  uniform float uFeather;      // 0-1 — soft falloff at the edge of the band
  uniform float uMode;         // 0=isolate (desat outside), 1=replace (hue shift target)
  uniform float uReplaceHue;   // 0-1 — destination hue for replace mode
  uniform float uSatBoost;     // 0-1 — saturation boost on targeted pixels (for color pop)
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 hsv = rgb2hsv(texColor.rgb);

    // Hue distance with circular wrap.
    float d = abs(hsv.x - uTargetHue);
    d = min(d, 1.0 - d);

    // Smooth falloff: 1.0 inside the band, 0.0 outside, soft at edges.
    float band = 1.0 - smoothstep(uHueRange, uHueRange + uFeather, d);

    int mode = int(uMode + 0.5);
    if (mode == 0) {
      // Isolate — desaturate everything OUTSIDE the band.
      hsv.y *= mix(0.0, 1.0, band);
      // Optional sat boost on pixels INSIDE the band.
      hsv.y = clamp(hsv.y + band * uSatBoost * 0.5, 0.0, 1.0);
    } else {
      // Replace — shift hue toward uReplaceHue for pixels INSIDE the band.
      float hueDelta = uReplaceHue - uTargetHue;
      // Take the shortest way around the hue circle.
      if (hueDelta > 0.5) hueDelta -= 1.0;
      if (hueDelta < -0.5) hueDelta += 1.0;
      hsv.x = fract(hsv.x + hueDelta * band);
      hsv.y = clamp(hsv.y + band * uSatBoost * 0.5, 0.0, 1.0);
    }

    gl_FragColor = vec4(hsv2rgb(hsv), texColor.a);
  }
`;

// ============================================================================
// HALFTONE (HERO) — CMYK color separation with per-channel dot angles, dot
// shape (round/square/line), animated drift. Newspaper / pop-art presets.
// ============================================================================
export const halftoneHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDotSize;     // 1-32 dot grid size
  uniform float uDotShape;    // 0=round, 1=square, 2=horizontal line, 3=vertical line
  uniform float uAngleC;      // 0-180° dot angle (cyan)
  uniform float uAngleM;      // magenta
  uniform float uAngleY;      // yellow
  uniform float uAngleK;      // black
  uniform float uMode;        // 0=greyscale halftone, 1=CMYK separation, 2=spot color
  uniform float uDriftSpeed;  // 0-2 animated grid drift speed
  uniform vec3 uSpotColor;    // for mode=2
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  // Single-channel halftone — returns 0..1 dot density at this position.
  float halftoneDot(vec2 pos, float angleDeg, float channelVal, float shape) {
    float a = radians(angleDeg);
    float c = cos(a);
    float s = sin(a);
    vec2 p = mat2(c, -s, s, c) * pos;
    p += vec2(uTime * uDriftSpeed * 0.5, uTime * uDriftSpeed * 0.3);
    vec2 cell = fract(p) - 0.5;
    int sh = int(shape + 0.5);
    float d;
    if (sh == 0) {
      // Round dot — radius proportional to channel value.
      d = length(cell) - mix(0.49, 0.0, channelVal);
    } else if (sh == 1) {
      // Square dot.
      d = max(abs(cell.x), abs(cell.y)) - mix(0.49, 0.0, channelVal);
    } else if (sh == 2) {
      // Horizontal line — line thickness is channel value.
      d = abs(cell.y) - mix(0.49, 0.0, channelVal) * 0.5;
    } else {
      // Vertical line.
      d = abs(cell.x) - mix(0.49, 0.0, channelVal) * 0.5;
    }
    return smoothstep(0.02, -0.02, d);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    int mode = int(uMode + 0.5);
    vec2 pos = vUv * uResolution / max(uDotSize, 1.0);

    if (mode == 1) {
      // CMYK separation: convert to CMY, then use K as min of CMY.
      vec3 c = 1.0 - texColor.rgb; // approximate CMY
      float k = min(c.r, min(c.g, c.b));
      vec3 cmy = (c - k) / max(1.0 - k, 0.001);
      float dotC = halftoneDot(pos, uAngleC, cmy.r, uDotShape);
      float dotM = halftoneDot(pos, uAngleM, cmy.g, uDotShape);
      float dotY = halftoneDot(pos, uAngleY, cmy.b, uDotShape);
      float dotK = halftoneDot(pos, uAngleK, k, uDotShape);
      // Convert back to RGB by subtracting CMYK from white.
      vec3 col = vec3(1.0)
               - vec3(dotC, 0.0, 0.0) * vec3(0.0, 1.0, 1.0)
               - vec3(0.0, dotM, 0.0) * vec3(1.0, 0.0, 1.0)
               - vec3(0.0, 0.0, dotY) * vec3(1.0, 1.0, 0.0)
               - vec3(dotK);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), texColor.a);
      return;
    }

    if (mode == 2) {
      // Spot color — single dot stamp at uSpotColor over white.
      float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
      float dotV = halftoneDot(pos, uAngleK, 1.0 - lum, uDotShape);
      gl_FragColor = vec4(mix(vec3(1.0), uSpotColor, dotV), texColor.a);
      return;
    }

    // Greyscale halftone — single dot density from luma.
    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    float dotV = halftoneDot(pos, uAngleK, 1.0 - lum, uDotShape);
    gl_FragColor = vec4(vec3(1.0 - dotV), texColor.a);
  }
`;

// ============================================================================
// TOON (HERO) — color quantization (3-5 ramp steps) PLUS built-in outline,
// shadow band hatching, smooth/hard ramp selector. Cel-shader presets.
// ============================================================================
export const toonHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSteps;         // 2-8 quantization steps per channel
  uniform float uOutline;       // 0-1 outline strength
  uniform float uOutlineColor;  // 0=black, 1=color from source
  uniform float uShadowBand;    // 0-1 darken shadow band intensity
  uniform float uRampSoftness;  // 0-1 smooth ramp (0=hard cel, 1=soft)
  uniform float uColorPop;      // 0-1 saturation boost
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 quantize(vec3 c, float steps, float soft) {
    vec3 hard = floor(c * steps) / max(steps - 1.0, 1.0);
    if (soft < 0.001) return hard;
    // Soft ramp: blend between hard and continuous via smoothstep on each
    // channel toward the next step.
    vec3 frac = fract(c * steps);
    vec3 smoothBlend = smoothstep(0.4, 0.6, frac);
    return mix(hard, hard + smoothBlend / max(steps - 1.0, 1.0), soft);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 src = texColor.rgb;

    // Color pop pre-process — bumps saturation slightly.
    if (uColorPop > 0.001) {
      float lum = dot(src, vec3(0.299, 0.587, 0.114));
      src = mix(vec3(lum), src, 1.0 + uColorPop * 0.6);
    }

    vec3 quant = quantize(clamp(src, 0.0, 1.0), uSteps, uRampSoftness);

    // Shadow band — darken the lowest quantization step further.
    if (uShadowBand > 0.001) {
      float lum = dot(quant, vec3(0.299, 0.587, 0.114));
      float shadow = smoothstep(0.35, 0.0, lum);
      quant *= 1.0 - shadow * uShadowBand * 0.5;
    }

    // Built-in outline — Sobel-ish luma gradient.
    if (uOutline > 0.001) {
      vec2 t = 1.5 / uResolution;
      float lL = dot(texture2D(uTexture, vUv - vec2(t.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
      float lR = dot(texture2D(uTexture, vUv + vec2(t.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
      float lD = dot(texture2D(uTexture, vUv - vec2(0.0, t.y)).rgb, vec3(0.299, 0.587, 0.114));
      float lU = dot(texture2D(uTexture, vUv + vec2(0.0, t.y)).rgb, vec3(0.299, 0.587, 0.114));
      float edge = clamp(length(vec2(lR - lL, lU - lD)) * 6.0, 0.0, 1.0);
      vec3 lineCol = mix(vec3(0.0), src * 0.4, uOutlineColor);
      quant = mix(quant, lineCol, edge * uOutline);
    }

    gl_FragColor = vec4(quant, texColor.a);
  }
`;

// ============================================================================
// KUWAHARA (HERO) — painterly oil-paint smoothing that preserves edges.
// 9-quadrant variant with adjustable radius, edge sharpness, color punch.
// Oil/anime/photo presets.
// ============================================================================
export const kuwaharaHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRadius;        // 1-8 pixel radius of each quadrant
  uniform float uEdgeSharpness; // 0-1 extra contrast on the chosen quadrant
  uniform float uColorPunch;    // 0-1 saturation boost on output
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 t = 1.0 / uResolution;
    float r = max(uRadius, 1.0);

    // 4-quadrant Kuwahara (cheap variant; 9-quadrant is too costly per
    // pixel for live preview). Sample mean + variance in each of TL/TR/BL/BR
    // quadrants, then pick the one with the lowest variance.
    vec3 means[4];
    float vars[4];
    for (int q = 0; q < 4; q++) {
      vec2 dir = vec2((q == 0 || q == 2) ? -1.0 : 1.0,
                       (q < 2) ? 1.0 : -1.0);
      vec3 sum = vec3(0.0);
      vec3 sumSq = vec3(0.0);
      float n = 0.0;
      // Sample a 3x3 stencil scaled by radius in the quadrant direction.
      for (int i = 0; i <= 2; i++) {
        for (int j = 0; j <= 2; j++) {
          vec2 off = (vec2(float(i), float(j))) * dir * r * t;
          vec3 c = texture2D(uTexture, vUv + off).rgb;
          sum += c;
          sumSq += c * c;
          n += 1.0;
        }
      }
      vec3 m = sum / n;
      vec3 v = sumSq / n - m * m;
      means[q] = m;
      vars[q] = v.r + v.g + v.b;
    }

    // Pick lowest-variance quadrant.
    int bestQ = 0;
    float bestV = vars[0];
    if (vars[1] < bestV) { bestV = vars[1]; bestQ = 1; }
    if (vars[2] < bestV) { bestV = vars[2]; bestQ = 2; }
    if (vars[3] < bestV) { bestV = vars[3]; bestQ = 3; }
    vec3 result = means[bestQ];

    // Edge sharpness — push toward the chosen mean by overshooting.
    if (uEdgeSharpness > 0.001) {
      vec3 center = texture2D(uTexture, vUv).rgb;
      result = mix(result, result + (result - center) * 0.5, uEdgeSharpness);
    }

    // Color punch — saturation boost on output.
    if (uColorPunch > 0.001) {
      float lum = dot(result, vec3(0.299, 0.587, 0.114));
      result = mix(vec3(lum), result, 1.0 + uColorPunch);
    }

    vec4 texColor = texture2D(uTexture, vUv);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), texColor.a);
  }
`;

// ============================================================================
// OIL PAINT HERO — Painterly bristle smoothing with directional brushes.
// Quantizes nearby colors into bins, picks the dominant bin, then jitters
// along a brush direction to give each "stroke" a length + bristle texture.
// ============================================================================
export const oilPaintHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRadius;        // 1-8 brush radius
  uniform float uIntensity;     // 4-32 quantization bins
  uniform float uBrushLength;   // 0-2 directional brush length
  uniform float uBristle;       // 0-1 bristle striations
  uniform float uColorPunch;    // 0-1 saturation pop
  uniform float uHighlight;     // 0-1 wet specular pop on bright bins
  uniform float uMode;          // 0=bin pick, 1=variance pick (kuwahara-style)
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 texel = 1.0 / uResolution;
    int radius = int(clamp(uRadius, 1.0, 8.0));
    float bins = max(2.0, uIntensity);
    int binCount = 24;

    float intensityCount[24];
    vec3  averageColor[24];
    for (int i = 0; i < 24; i++) { intensityCount[i] = 0.0; averageColor[i] = vec3(0.0); }

    // Brush direction = local gradient (sobel on luma)
    float gx = 0.0; float gy = 0.0;
    {
      float l00 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0, -1.0)).rgb);
      float l10 = luma(texture2D(uTexture, vUv + texel * vec2( 0.0, -1.0)).rgb);
      float l20 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0, -1.0)).rgb);
      float l01 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0,  0.0)).rgb);
      float l21 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0,  0.0)).rgb);
      float l02 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0,  1.0)).rgb);
      float l12 = luma(texture2D(uTexture, vUv + texel * vec2( 0.0,  1.0)).rgb);
      float l22 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0,  1.0)).rgb);
      gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
      gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    }
    float gradMag = length(vec2(gx, gy));
    vec2 brushDir = (gradMag > 0.001) ? vec2(-gy, gx) / gradMag : vec2(1.0, 0.0);

    for (int y = -8; y <= 8; y++) {
      if (abs(y) > radius) continue;
      for (int x = -8; x <= 8; x++) {
        if (abs(x) > radius) continue;
        vec2 sampleUv = vUv + vec2(float(x), float(y)) * texel * (1.0 + uBrushLength * abs(dot(normalize(vec2(float(x), float(y)) + 1e-6), brushDir)));
        vec3 c = texture2D(uTexture, sampleUv).rgb;
        // Bristle striation: subtly modulate sample weight along brush dir
        float bristleMod = 1.0;
        if (uBristle > 0.001) {
          float along = dot(vec2(float(x), float(y)), brushDir);
          bristleMod = mix(1.0, 0.5 + 0.5 * sin(along * 3.14159 * 2.0), uBristle);
        }
        int bin = int(luma(c) * (bins - 1.0));
        bin = int(clamp(float(bin), 0.0, float(binCount - 1)));
        intensityCount[bin] += bristleMod;
        averageColor[bin] += c * bristleMod;
      }
    }

    int maxIdx = 0;
    float maxCount = 0.0;
    for (int i = 0; i < 24; i++) {
      if (intensityCount[i] > maxCount) { maxCount = intensityCount[i]; maxIdx = i; }
    }
    vec3 result = averageColor[maxIdx] / max(maxCount, 1.0);

    if (uColorPunch > 0.001) {
      float lum = luma(result);
      result = mix(vec3(lum), result, 1.0 + uColorPunch * 0.6);
    }
    if (uHighlight > 0.001) {
      float lum = luma(result);
      float spec = smoothstep(0.7, 0.95, lum) * uHighlight;
      result += vec3(spec);
    }

    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// WATERCOLOR HERO — Soft pigment bleed + edge darken + paper texture.
// Blurs in two passes (pigment bleed), darkens edges (sobel-driven), then
// composites onto an animated paper noise.
// ============================================================================
export const watercolorHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uBleed;         // 0-1 pigment bleed radius
  uniform float uEdgeDarken;    // 0-1 sobel-driven edge darkening
  uniform float uPaperTexture;  // 0-1 paper noise strength
  uniform float uPaperScale;    // 1-32 paper noise scale
  uniform float uWetness;       // 0-1 colour saturation boost (wet pigment)
  uniform float uGranulation;   // 0-1 pigment granulation noise
  uniform float uPaperHue;      // 0=cream, 1=cool grey, 2=tea-stain
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 paperColor(float kind) {
    if (kind < 0.5) return vec3(0.96, 0.93, 0.86); // cream
    if (kind < 1.5) return vec3(0.88, 0.90, 0.93); // cool grey
    return vec3(0.82, 0.72, 0.55); // tea
  }

  void main() {
    vec2 texel = 1.0 / uResolution;

    // ── Pigment bleed: 9-tap blur with radius scaled by uBleed ──
    float r = uBleed * 6.0 + 1.0;
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 off = vec2(float(x), float(y)) * texel * r;
        float w = exp(-dot(off, off) * 100.0);
        sum += texture2D(uTexture, vUv + off).rgb * w;
        weight += w;
      }
    }
    vec3 bled = sum / weight;

    // ── Edge darken (sobel on luma) ──
    float l00 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0, -1.0)).rgb);
    float l10 = luma(texture2D(uTexture, vUv + texel * vec2( 0.0, -1.0)).rgb);
    float l20 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0, -1.0)).rgb);
    float l01 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0,  0.0)).rgb);
    float l21 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0,  0.0)).rgb);
    float l02 = luma(texture2D(uTexture, vUv + texel * vec2(-1.0,  1.0)).rgb);
    float l12 = luma(texture2D(uTexture, vUv + texel * vec2( 0.0,  1.0)).rgb);
    float l22 = luma(texture2D(uTexture, vUv + texel * vec2( 1.0,  1.0)).rgb);
    float gxL = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gyL = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float edge = clamp(length(vec2(gxL, gyL)), 0.0, 1.0);
    bled = mix(bled, bled * (1.0 - edge), uEdgeDarken);

    // ── Wetness (saturation boost) ──
    if (uWetness > 0.001) {
      float lum = luma(bled);
      bled = mix(vec3(lum), bled, 1.0 + uWetness * 0.5);
    }

    // ── Pigment granulation ──
    if (uGranulation > 0.001) {
      float gran = vnoise(vUv * uResolution * 0.6 + uTime * 0.05) - 0.5;
      bled += vec3(gran) * uGranulation * 0.15;
    }

    // ── Paper texture composite ──
    float paperN = vnoise(vUv * uPaperScale * 16.0) * 0.5 + vnoise(vUv * uPaperScale * 32.0) * 0.5;
    vec3 paper = paperColor(uPaperHue) * (0.85 + paperN * 0.3);
    vec3 result = bled * mix(vec3(1.0), paper, uPaperTexture);

    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// BLUR HERO — Multi-mode blur with quality + edge protect.
// Modes: 0=Box, 1=Gaussian, 2=Motion, 3=Bilateral (edge-aware).
// ============================================================================
export const blurHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRadius;        // 0-30 px
  uniform float uMode;          // 0=box, 1=gaussian, 2=motion, 3=bilateral
  uniform float uAngle;         // 0-360 degrees (motion blur direction)
  uniform float uQuality;       // 0=low (9-tap), 1=mid (17-tap), 2=high (25-tap)
  uniform float uEdgeProtect;   // 0-1 bilateral edge preservation
  uniform float uMix;           // 0-1 wet/dry
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    vec3 srcRgb = src.rgb;
    float srcL = luma(srcRgb);
    if (uRadius < 0.01) {
      gl_FragColor = src;
      return;
    }

    int mode = int(uMode + 0.5);
    int taps = (uQuality < 0.5) ? 4 : (uQuality < 1.5) ? 8 : 12;
    float r = uRadius;
    vec2 texel = 1.0 / uResolution;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    float ang = radians(uAngle);
    vec2 motionDir = vec2(cos(ang), sin(ang));

    for (int s = -12; s <= 12; s++) {
      if (abs(s) > taps) continue;
      float fs = float(s);
      vec2 off;
      float w = 1.0;

      if (mode == 0) {
        // Box blur — 1D pair (do twice)
        off = vec2(fs, 0.0) * texel * (r / float(taps));
        w = 1.0;
      } else if (mode == 1) {
        // Gaussian (separated horizontal-only here, ok for screen-space)
        off = vec2(fs, 0.0) * texel * (r / float(taps));
        float sigma = float(taps) * 0.5;
        w = exp(-(fs * fs) / (2.0 * sigma * sigma));
      } else if (mode == 2) {
        // Motion blur — directional
        off = motionDir * fs * texel * (r / float(taps));
        w = 1.0;
      } else {
        // Bilateral
        off = vec2(fs, 0.0) * texel * (r / float(taps));
        vec3 sCol = texture2D(uTexture, vUv + off).rgb;
        float dL = luma(sCol) - srcL;
        float spatial = exp(-(fs * fs) / (2.0 * float(taps * taps) * 0.25));
        float range = exp(-(dL * dL) / (2.0 * pow(0.1 + (1.0 - uEdgeProtect) * 0.5, 2.0)));
        w = spatial * range;
      }
      acc += texture2D(uTexture, vUv + off).rgb * w;
      wsum += w;
    }

    // Second pass for box/gaussian/bilateral (vertical), so output is roughly 2D
    if (mode != 2) {
      for (int s = -12; s <= 12; s++) {
        if (abs(s) > taps) continue;
        if (s == 0) continue;
        float fs = float(s);
        vec2 off = vec2(0.0, fs) * texel * (r / float(taps));
        float w = 1.0;
        if (mode == 1) {
          float sigma = float(taps) * 0.5;
          w = exp(-(fs * fs) / (2.0 * sigma * sigma));
        } else if (mode == 3) {
          vec3 sCol = texture2D(uTexture, vUv + off).rgb;
          float dL = luma(sCol) - srcL;
          float spatial = exp(-(fs * fs) / (2.0 * float(taps * taps) * 0.25));
          float range = exp(-(dL * dL) / (2.0 * pow(0.1 + (1.0 - uEdgeProtect) * 0.5, 2.0)));
          w = spatial * range;
        }
        acc += texture2D(uTexture, vUv + off).rgb * w;
        wsum += w;
      }
    }

    vec3 blurred = acc / max(wsum, 0.0001);
    vec3 result = mix(srcRgb, blurred, uMix);
    gl_FragColor = vec4(result, src.a);
  }
`;

// ============================================================================
// SHARPEN HERO — Multi-mode sharpen with radius + edge protect.
// Modes: 0=Laplacian (classic), 1=Unsharp Mask (gaussian-derived).
// ============================================================================
export const sharpenHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-3 sharpen strength
  uniform float uMode;          // 0=laplacian, 1=unsharp mask
  uniform float uRadius;        // 1-8 unsharp radius
  uniform float uEdgeProtect;   // 0-1 limit sharpening on flat areas
  uniform float uClarity;       // 0-1 mid-tone contrast pop
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec4 center = texture2D(uTexture, vUv);
    vec3 result = center.rgb;

    int mode = int(uMode + 0.5);

    if (mode == 0) {
      // Laplacian sharpen
      vec4 left   = texture2D(uTexture, vUv - vec2(texel.x, 0.0));
      vec4 right  = texture2D(uTexture, vUv + vec2(texel.x, 0.0));
      vec4 top    = texture2D(uTexture, vUv + vec2(0.0, texel.y));
      vec4 bottom = texture2D(uTexture, vUv - vec2(0.0, texel.y));
      vec3 avg = (left.rgb + right.rgb + top.rgb + bottom.rgb) * 0.25;
      vec3 highFreq = center.rgb - avg;
      // Edge protect: fade sharpen on flat regions
      float edgeAmp = 1.0;
      if (uEdgeProtect > 0.001) {
        float edgeMag = length(highFreq);
        edgeAmp = smoothstep(0.0, uEdgeProtect * 0.2, edgeMag);
      }
      result = center.rgb + highFreq * uAmount * edgeAmp;
    } else {
      // Unsharp mask: blur, subtract from original, add scaled back
      float r = max(1.0, uRadius);
      vec3 blurAcc = vec3(0.0);
      float wsum = 0.0;
      for (int y = -4; y <= 4; y++) {
        for (int x = -4; x <= 4; x++) {
          if (abs(x) + abs(y) > 4) continue;
          vec2 off = vec2(float(x), float(y)) * texel * (r * 0.5);
          float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));
          blurAcc += texture2D(uTexture, vUv + off).rgb * w;
          wsum += w;
        }
      }
      vec3 blurred = blurAcc / wsum;
      vec3 mask = center.rgb - blurred;
      float edgeAmp = 1.0;
      if (uEdgeProtect > 0.001) {
        float edgeMag = length(mask);
        edgeAmp = smoothstep(0.0, uEdgeProtect * 0.2, edgeMag);
      }
      result = center.rgb + mask * uAmount * edgeAmp;
    }

    // Clarity: mid-tone contrast pop
    if (uClarity > 0.001) {
      float lum = luma(result);
      float midMask = 4.0 * lum * (1.0 - lum); // peaks at lum=0.5
      vec3 popped = mix(vec3(0.5), result, 1.0 + uClarity * 0.6);
      result = mix(result, popped, midMask * uClarity);
    }

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), center.a);
  }
`;

// ============================================================================
// DIRECTIONAL BLUR HERO — Linear motion blur with samples + center bias + falloff.
// ============================================================================
export const directionalBlurHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 normalized blur length
  uniform float uAngle;         // 0-360 degrees
  uniform float uSamples;       // 4-32
  uniform float uFalloff;       // 0-1 weight falloff toward edges
  uniform float uCenterBias;    // 0-1 keep center sharper
  uniform float uMix;           // 0-1 wet/dry
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 2.0, 32.0));
    float ang = radians(uAngle);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 texel = 1.0 / uResolution;
    float maxOffset = uAmount * 0.3; // 30% of screen max

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = -32; i <= 32; i++) {
      if (abs(i) > samples) continue;
      float t = float(i) / float(samples);
      vec2 off = dir * t * maxOffset;
      // Falloff weight (1 at center, drops toward edges)
      float w = mix(1.0, 1.0 - abs(t), uFalloff);
      // Center bias: weight center heavier
      w *= mix(1.0, exp(-t * t * 8.0), uCenterBias);
      acc += texture2D(uTexture, vUv + off).rgb * w;
      wsum += w;
    }
    vec3 blurred = acc / wsum;
    gl_FragColor = vec4(mix(src.rgb, blurred, uMix), src.a);
  }
`;

// ============================================================================
// ZOOM BLUR HERO — Radial outward blur from a focal point.
// ============================================================================
export const zoomBlurHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 normalized blur length
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uSamples;       // 4-32
  uniform float uFalloff;       // 0-1 weight falloff
  uniform float uChromatic;     // 0-1 RGB split during zoom
  uniform float uMix;           // 0-1 wet/dry
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 2.0, 32.0));
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 dir = vUv - center;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i <= 32; i++) {
      if (i > samples) break;
      float t = float(i) / float(samples);
      vec2 sUv;
      vec3 c;
      if (uChromatic > 0.001) {
        // Channel-shift along zoom direction
        float rT = t * (1.0 + uChromatic * 0.05);
        float gT = t;
        float bT = t * (1.0 - uChromatic * 0.05);
        float rR = texture2D(uTexture, vUv - dir * uAmount * rT).r;
        float gG = texture2D(uTexture, vUv - dir * uAmount * gT).g;
        float bB = texture2D(uTexture, vUv - dir * uAmount * bT).b;
        c = vec3(rR, gG, bB);
      } else {
        sUv = vUv - dir * uAmount * t;
        c = texture2D(uTexture, sUv).rgb;
      }
      float w = mix(1.0, 1.0 - t, uFalloff);
      acc += c * w;
      wsum += w;
    }
    vec3 blurred = acc / wsum;
    gl_FragColor = vec4(mix(src.rgb, blurred, uMix), src.a);
  }
`;

// ============================================================================
// RADIAL BLUR HERO — Spin/swirl blur around a focal point.
// ============================================================================
export const radialBlurHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 spin angle (radians scale)
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uSamples;       // 4-32
  uniform float uFalloff;       // 0-1
  uniform float uRadiusInner;   // 0-1 unblurred inner radius
  uniform float uRadiusOuter;   // 0-1 fully blurred outer radius
  uniform float uMix;           // 0-1 wet/dry
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 2.0, 32.0));
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 d = vUv - center;
    float dist = length(d);

    // Mask: 0 inside inner radius, 1 outside outer radius
    float mask = smoothstep(uRadiusInner, uRadiusOuter, dist);
    if (mask < 0.001) { gl_FragColor = src; return; }

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    float maxAngle = uAmount * 1.2; // ~70° max spin
    for (int i = -32; i <= 32; i++) {
      if (abs(i) > samples) continue;
      float t = float(i) / float(samples);
      float a = t * maxAngle * mask;
      float ca = cos(a), sa = sin(a);
      vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      vec2 sUv = center + rd;
      float w = mix(1.0, 1.0 - abs(t), uFalloff);
      acc += texture2D(uTexture, sUv).rgb * w;
      wsum += w;
    }
    vec3 blurred = acc / wsum;
    gl_FragColor = vec4(mix(src.rgb, blurred, uMix * mask), src.a);
  }
`;

// ============================================================================
// TILT-SHIFT HERO — Selective focus band with smooth blur falloff.
// Modes: 0=Horizontal band, 1=Vertical band, 2=Radial spotlight, 3=Linear gradient.
// ============================================================================
export const tiltShiftHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=horizontal, 1=vertical, 2=radial, 3=linear gradient
  uniform float uFocusY;        // 0-1 focus center
  uniform float uFocusX;        // 0-1 (used by radial)
  uniform float uFocusBand;     // 0-1 sharp band width
  uniform float uFalloff;       // 0-1 transition softness
  uniform float uMaxBlur;       // 0-1 max blur amount
  uniform float uAngle;         // 0-360 (linear gradient direction)
  uniform float uSaturation;    // 0-2 saturation in defocused area (miniature look)
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 sampleBlur(vec2 uv, float r) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec2 texel = 1.0 / uResolution;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        vec2 off = vec2(float(x), float(y)) * texel * r;
        float w = exp(-(float(x*x + y*y)) / 8.0);
        acc += texture2D(uTexture, uv + off).rgb * w;
        wsum += w;
      }
    }
    return acc / wsum;
  }

  void main() {
    int mode = int(uMode + 0.5);
    float blurMask = 0.0;
    float band = max(0.001, uFocusBand);
    float falloff = max(0.001, uFalloff);

    if (mode == 0) {
      // Horizontal band
      float d = abs(vUv.y - uFocusY);
      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, d);
    } else if (mode == 1) {
      // Vertical band
      float d = abs(vUv.x - uFocusX);
      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, d);
    } else if (mode == 2) {
      // Radial spotlight focus
      vec2 d = vUv - vec2(uFocusX, uFocusY);
      float dist = length(d);
      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, dist);
    } else {
      // Linear gradient
      float ang = radians(uAngle);
      vec2 dir = vec2(cos(ang), sin(ang));
      float t = dot(vUv - vec2(uFocusX, uFocusY), dir);
      blurMask = smoothstep(-band * 0.5, band * 0.5 + falloff, abs(t));
    }

    vec4 src = texture2D(uTexture, vUv);
    float blurR = blurMask * uMaxBlur * 14.0;
    vec3 blurred = (blurR > 0.1) ? sampleBlur(vUv, blurR) : src.rgb;

    // Saturation tweak in defocused area (miniature/tilt-shift look)
    if (abs(uSaturation - 1.0) > 0.001) {
      float lum = luma(blurred);
      blurred = mix(vec3(lum), blurred, uSaturation);
    }

    vec3 result = mix(src.rgb, blurred, blurMask);
    gl_FragColor = vec4(result, src.a);
  }
`;

// ============================================================================
// DEFOCUS BOKEH HERO — Disc-kernel bokeh with chroma fringe + bright weight.
// ============================================================================
export const defocusBokehHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRadius;        // 0-30 disc radius
  uniform float uSamples;       // 12-48
  uniform float uBrightWeight;  // 0-2 boost on highlights (creates bokeh balls)
  uniform float uThreshold;     // 0-1 highlight threshold
  uniform float uChromaFringe;  // 0-1 RGB radial offset
  uniform float uShape;         // 0=disc, 1=hexagon, 2=octagon
  uniform float uRotation;      // 0-360 aperture rotation
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  // Aperture mask: returns 1 if (sx, sy) is inside the aperture shape
  float apertureMask(vec2 p, int shape) {
    float r = length(p);
    if (r > 1.0) return 0.0;
    if (shape == 0) return 1.0; // disc
    float ang = atan(p.y, p.x);
    int sides = (shape == 1) ? 6 : 8;
    float n = float(sides);
    float halfAng = 3.14159 / n;
    float folded = mod(ang + halfAng, 2.0 * halfAng) - halfAng;
    float polyR = cos(halfAng) / cos(folded);
    return r <= polyR ? 1.0 : 0.0;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uRadius < 0.5) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 8.0, 48.0));
    int shape = int(uShape + 0.5);
    float rot = radians(uRotation);
    float ca = cos(rot), sa = sin(rot);
    vec2 texel = 1.0 / uResolution;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;

    // Sample on golden-angle spiral inside aperture mask
    for (int i = 0; i < 48; i++) {
      if (i >= samples) break;
      float fi = float(i);
      float t = fi / float(samples);
      // Golden-angle spiral
      float angle = fi * 2.39996;
      float radius = sqrt(t);
      vec2 disc = vec2(cos(angle), sin(angle)) * radius;
      // Rotate to user-set aperture rotation
      vec2 rotDisc = vec2(disc.x * ca - disc.y * sa, disc.x * sa + disc.y * ca);
      float mask = apertureMask(rotDisc, shape);
      if (mask < 0.5) continue;

      vec2 off;
      vec3 c;
      if (uChromaFringe > 0.001) {
        // Per-channel offset for fringing
        vec2 dir = normalize(rotDisc + 1e-6);
        float rOff = uRadius * (1.0 + uChromaFringe * 0.05);
        float bOff = uRadius * (1.0 - uChromaFringe * 0.05);
        off = rotDisc * uRadius * texel;
        float r = texture2D(uTexture, vUv + dir * rOff * texel + (off - dir * uRadius * texel)).r;
        float g = texture2D(uTexture, vUv + off).g;
        float b = texture2D(uTexture, vUv + dir * bOff * texel + (off - dir * uRadius * texel)).b;
        c = vec3(r, g, b);
      } else {
        off = rotDisc * uRadius * texel;
        c = texture2D(uTexture, vUv + off).rgb;
      }

      // Bright-weight: boost highlights so they form crisp bokeh balls
      float w = 1.0;
      if (uBrightWeight > 0.001) {
        float l = luma(c);
        float hi = smoothstep(uThreshold, uThreshold + 0.2, l);
        w = mix(1.0, 1.0 + uBrightWeight * 6.0, hi);
      }
      acc += c * w;
      wsum += w;
    }

    vec3 result = (wsum > 0.0) ? acc / wsum : src.rgb;
    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`;

// ============================================================================
// CHROMATIC ABERRATION HERO — Modes: Linear / Radial / Lens (cubic) / Prism.
// ============================================================================
export const chromaticAberrationHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 strength
  uniform float uMode;          // 0=linear, 1=radial, 2=lens (cubic), 3=prism
  uniform float uAngle;         // 0-360 (linear)
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uEdgeFalloff;   // 0-1 weight by distance from center
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 d = vUv - center;
    float dist = length(d);

    vec2 dirR, dirB;
    float strength = uAmount * 0.05;

    if (mode == 0) {
      // Linear (directional)
      float ang = radians(uAngle);
      vec2 dir = vec2(cos(ang), sin(ang));
      dirR =  dir * strength;
      dirB = -dir * strength;
    } else if (mode == 1) {
      // Radial outward
      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
      dirR =  nd * strength;
      dirB = -nd * strength;
    } else if (mode == 2) {
      // Lens (cubic falloff — like real glass)
      float k = strength * (dist * dist * 4.0);
      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
      dirR =  nd * k;
      dirB = -nd * k;
    } else {
      // Prism rainbow spread
      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
      dirR =  nd * strength * 1.5;
      dirB = -nd * strength * 1.5;
    }

    // Edge falloff weight (only push at the edges)
    float weight = mix(1.0, dist * 2.0, uEdgeFalloff);

    vec2 offR = dirR * weight;
    vec2 offB = dirB * weight;
    float r = texture2D(uTexture, vUv + offR).r;
    float g = texture2D(uTexture, vUv).g;
    float b = texture2D(uTexture, vUv + offB).b;
    vec3 result = vec3(r, g, b);

    // Prism mode adds extra mid-spectrum tints
    if (mode == 3) {
      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
      float yE = texture2D(uTexture, vUv + nd * strength * 0.7 * weight).r * 0.5
               + texture2D(uTexture, vUv + nd * strength * 0.7 * weight).g * 0.5;
      result.r = mix(result.r, max(result.r, yE), 0.3);
      result.g = mix(result.g, yE, 0.2);
    }

    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`;

// ============================================================================
// GOD RAYS HERO — Radial light shafts from a focal point.
// ============================================================================
export const godRaysHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uDecay;         // 0.85-1.0 sample decay
  uniform float uExposure;      // 0.1-1 exposure scale
  uniform float uDensity;       // 0-1 sample density
  uniform float uThreshold;     // 0-1 brightness gate
  uniform float uCenterX;       // 0-1 sun position
  uniform float uCenterY;       // 0-1
  uniform float uSamples;       // 16-128
  uniform float uTintR;         // 0-1
  uniform float uTintG;         // 0-1
  uniform float uTintB;         // 0-1
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uIntensity < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 8.0, 128.0));
    vec2 sun = vec2(uCenterX, uCenterY);
    vec2 deltaUv = (vUv - sun) * (uDensity / float(samples));
    vec2 cur = vUv;
    float illum = 1.0;
    vec3 acc = vec3(0.0);

    for (int i = 0; i < 128; i++) {
      if (i >= samples) break;
      cur -= deltaUv;
      vec3 s = texture2D(uTexture, cur).rgb;
      // Threshold gate — only bright pixels emit rays
      float gate = smoothstep(uThreshold, uThreshold + 0.15, luma(s));
      acc += s * gate * illum;
      illum *= uDecay;
    }
    acc *= uExposure * uIntensity;
    acc *= vec3(uTintR, uTintG, uTintB);

    vec3 result = src.rgb + acc * uMix;
    gl_FragColor = vec4(result, src.a);
  }
`;

// ============================================================================
// HALATION HERO — Warm bleed around bright areas (film print emulation).
// ============================================================================
export const halationHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-2 bleed strength
  uniform float uRadius;        // 0-30 bleed radius
  uniform float uThreshold;     // 0-1 highlight threshold
  uniform float uTintR;         // 0-1 bleed colour
  uniform float uTintG;         // 0-1
  uniform float uTintB;         // 0-1
  uniform float uMode;          // 0=screen, 1=add, 2=soft light
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    vec2 texel = 1.0 / uResolution;
    vec3 bleed = vec3(0.0);
    float wsum = 0.0;
    float r = max(1.0, uRadius);

    for (int y = -5; y <= 5; y++) {
      for (int x = -5; x <= 5; x++) {
        if (abs(x) + abs(y) > 7) continue;
        vec2 off = vec2(float(x), float(y)) * texel * r * 0.5;
        vec3 sampleCol = texture2D(uTexture, vUv + off).rgb;
        float gate = smoothstep(uThreshold, uThreshold + 0.2, luma(sampleCol));
        float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));
        bleed += sampleCol * gate * w;
        wsum += w;
      }
    }
    bleed = (wsum > 0.0) ? bleed / wsum : vec3(0.0);
    bleed *= vec3(uTintR, uTintG, uTintB) * uAmount;

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) {
      // Screen
      result = 1.0 - (1.0 - src.rgb) * (1.0 - bleed);
    } else if (mode == 1) {
      // Add
      result = src.rgb + bleed;
    } else {
      // Soft light
      vec3 a = 2.0 * src.rgb * bleed + src.rgb * src.rgb * (1.0 - 2.0 * bleed);
      vec3 b = sqrt(src.rgb) * (2.0 * bleed - 1.0) + 2.0 * src.rgb * (1.0 - bleed);
      result = mix(a, b, step(0.5, bleed));
    }

    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`;

// ============================================================================
// ANAMORPHIC STREAK HERO — Horizontal lens flare streaks.
// ============================================================================
export const anamorphicStreakHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uLength;        // 0-1 streak length (% of screen)
  uniform float uThreshold;     // 0-1 highlight threshold
  uniform float uTintR;         // 0-1 streak colour (typically blue)
  uniform float uTintG;         // 0-1
  uniform float uTintB;         // 0-1
  uniform float uAngle;         // 0-180 streak angle (default horizontal)
  uniform float uSamples;       // 16-64
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uIntensity < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 8.0, 64.0));
    float ang = radians(uAngle);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 texel = 1.0 / uResolution;

    vec3 streak = vec3(0.0);
    float wsum = 0.0;
    for (int i = -64; i <= 64; i++) {
      if (abs(i) > samples) continue;
      float t = float(i) / float(samples);
      vec2 off = dir * t * uLength;
      vec3 sCol = texture2D(uTexture, vUv + off).rgb;
      float gate = smoothstep(uThreshold, uThreshold + 0.15, luma(sCol));
      float w = exp(-abs(t) * 2.0);
      streak += sCol * gate * w;
      wsum += w;
    }
    streak = (wsum > 0.0) ? streak / wsum : vec3(0.0);
    streak *= vec3(uTintR, uTintG, uTintB) * uIntensity;

    // Screen blend
    vec3 result = 1.0 - (1.0 - src.rgb) * (1.0 - streak);
    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`;

// ============================================================================
// LENS DIRT HERO — Dust + scratch overlay on bright areas.
// ============================================================================
export const lensDirtHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 dirt overlay strength
  uniform float uScale;         // 1-32 noise pattern scale
  uniform float uThreshold;     // 0-1 dirt visibility threshold (only show on bright areas)
  uniform float uTintWarmth;    // 0-1 warm/cool dust colour
  uniform float uScratches;     // 0-1 vertical scratch overlay
  uniform float uSpots;         // 0-1 dust spot density
  uniform float uMode;          // 0=screen, 1=add, 2=multiply (debris)
  uniform float uTime;
  uniform float uAnimSpeed;     // 0-1 dirt drift
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    vec2 driftUv = vUv + vec2(uTime * uAnimSpeed * 0.01, uTime * uAnimSpeed * 0.005);

    // Dust spot field (low-frequency noise)
    float spots = 0.0;
    if (uSpots > 0.001) {
      float n1 = vnoise(driftUv * uScale * 4.0);
      float n2 = vnoise(driftUv * uScale * 8.0 + vec2(13.7, 9.1));
      float n3 = vnoise(driftUv * uScale * 12.0 + vec2(45.2, 71.3));
      spots = (n1 * n2 * n3) * 4.0;
      spots = smoothstep(0.3, 0.6, spots) * uSpots;
    }

    // Vertical scratches
    float scratches = 0.0;
    if (uScratches > 0.001) {
      float xn = hash21(vec2(floor(driftUv.x * uResolution.x * 0.05), 0.0));
      scratches = step(0.97, xn) * uScratches * 0.7;
    }

    float dirt = clamp(spots + scratches, 0.0, 1.0);
    float bright = smoothstep(uThreshold, uThreshold + 0.2, luma(src.rgb));
    dirt *= bright * uAmount;

    vec3 dustColor = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.85, 0.65), uTintWarmth);
    vec3 dirtRgb = dustColor * dirt;

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) {
      result = 1.0 - (1.0 - src.rgb) * (1.0 - dirtRgb);
    } else if (mode == 1) {
      result = src.rgb + dirtRgb;
    } else {
      result = src.rgb * (1.0 - dirt * 0.5);
    }
    gl_FragColor = vec4(result, src.a);
  }
`;

// ============================================================================
// DIFFUSION / PROMIST HERO — Soft glow + halation on highlights (filmic mist).
// ============================================================================
export const diffusionPromistHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 diffusion strength
  uniform float uRadius;        // 1-30 glow radius
  uniform float uThreshold;     // 0-1 highlight threshold
  uniform float uShadowLift;    // 0-1 lift shadows
  uniform float uHighlightBloom;// 0-1 bloom on highlights
  uniform float uHaze;          // 0-1 overall haze (lower contrast)
  uniform float uHazeWarmth;    // 0-1 warm haze tint
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    // Highlight-only blur for bloom
    vec2 texel = 1.0 / uResolution;
    vec3 bloom = vec3(0.0);
    float wsum = 0.0;
    float r = max(1.0, uRadius);
    for (int y = -5; y <= 5; y++) {
      for (int x = -5; x <= 5; x++) {
        if (abs(x) + abs(y) > 7) continue;
        vec2 off = vec2(float(x), float(y)) * texel * r * 0.4;
        vec3 sCol = texture2D(uTexture, vUv + off).rgb;
        float gate = smoothstep(uThreshold, uThreshold + 0.2, luma(sCol));
        float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));
        bloom += sCol * gate * w;
        wsum += w;
      }
    }
    bloom = (wsum > 0.0) ? bloom / wsum : vec3(0.0);
    bloom *= uHighlightBloom * 1.5;

    // Shadow lift (raises blacks)
    vec3 lifted = src.rgb + (1.0 - src.rgb) * uShadowLift * 0.15;

    // Haze: lower contrast + optional warm tint
    vec3 hazeColor = mix(vec3(0.7, 0.75, 0.8), vec3(0.95, 0.85, 0.7), uHazeWarmth);
    vec3 hazed = mix(lifted, hazeColor, uHaze * 0.3);

    // Combine: hazed base + screen-blended bloom
    vec3 result = 1.0 - (1.0 - hazed) * (1.0 - bloom);
    result = mix(src.rgb, result, uMix * uAmount);

    gl_FragColor = vec4(result, src.a);
  }
`;

// ============================================================================
// FILM GRAIN HERO — Multi-stock grain with size + tonal response + mono.
// ============================================================================
export const filmGrainHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 grain strength
  uniform float uSize;          // 0.5-4 grain size (px)
  uniform float uShadowGrain;   // 0-1 grain in shadows
  uniform float uMidGrain;      // 0-1 grain in midtones
  uniform float uHighGrain;     // 0-1 grain in highlights
  uniform float uMono;          // 0-1 monochrome grain (vs RGB)
  uniform float uStock;         // 0=fine, 1=35mm, 2=16mm, 3=Super8
  uniform float uColorJitter;   // 0-1 chroma noise
  uniform float uTime;
  uniform float uAnimSpeed;     // 0-1 anim speed (1 = per-frame)
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash13(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    int stock = int(uStock + 0.5);
    float grainScale = (stock == 0) ? 1.5 : (stock == 1) ? 1.0 : (stock == 2) ? 0.6 : 0.35;
    grainScale *= uSize;
    vec2 gPos = vUv * uResolution / max(0.5, grainScale);
    float t = floor(uTime * uAnimSpeed * 24.0) / 24.0;

    float n = hash13(vec3(gPos, t));
    vec3 noiseRgb;
    if (uMono > 0.5) {
      noiseRgb = vec3(n - 0.5);
    } else {
      float r = hash13(vec3(gPos, t + 0.1));
      float g = hash13(vec3(gPos, t + 0.3));
      float b = hash13(vec3(gPos, t + 0.7));
      noiseRgb = vec3(r - 0.5, g - 0.5, b - 0.5);
    }

    // Tonal response — different grain in shadows / mids / highs
    float l = luma(src.rgb);
    float shadowMask = 1.0 - smoothstep(0.0, 0.4, l);
    float midMask = (1.0 - abs(l - 0.5) * 2.0);
    float highMask = smoothstep(0.6, 1.0, l);
    float zoneAmp = shadowMask * uShadowGrain + midMask * uMidGrain + highMask * uHighGrain;

    float chromaJit = 0.0;
    if (uColorJitter > 0.001) {
      chromaJit = (hash13(vec3(gPos, t + 0.5)) - 0.5) * uColorJitter;
    }

    vec3 grain = noiseRgb * uAmount * zoneAmp + vec3(chromaJit, -chromaJit, chromaJit * 0.5) * 0.2;
    vec3 result = src.rgb + grain;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// HEAT HAZE HERO — Animated displacement with directional bias + falloff.
// ============================================================================
export const heatHazeHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 displacement strength
  uniform float uScale;         // 1-32 noise scale
  uniform float uSpeed;         // 0-3 animation speed
  uniform float uDirectionY;    // -1..1 vertical bias (rising heat)
  uniform float uTurbulence;    // 0-1 fbm turbulence
  uniform float uMode;          // 0=heat shimmer, 1=underwater, 2=glass distort
  uniform float uFocusY;        // 0-1 vertical position where haze peaks
  uniform float uFocusBand;     // 0-1 band width
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }

  void main() {
    if (uAmount < 0.001) { gl_FragColor = texture2D(uTexture, vUv); return; }

    int mode = int(uMode + 0.5);
    vec2 p = vUv * uScale + vec2(0.0, -uTime * uSpeed * 0.5);
    p.y += uDirectionY * uTime * uSpeed * 0.3;

    float nx, ny;
    if (uTurbulence > 0.001) {
      nx = fbm(p) - 0.5;
      ny = fbm(p + vec2(123.4, 56.7)) - 0.5;
    } else {
      nx = vnoise(p) - 0.5;
      ny = vnoise(p + vec2(123.4, 56.7)) - 0.5;
    }

    float strength = uAmount * 0.05;
    if (mode == 0) {
      // Heat shimmer — mostly horizontal, falls off above focusY
      ny *= 0.4;
      float bandMask = exp(-pow((vUv.y - uFocusY) / max(0.05, uFocusBand), 2.0));
      strength *= bandMask;
    } else if (mode == 1) {
      // Underwater — both directions, sinusoidal modulation
      float wave = sin(uTime * uSpeed + vUv.y * 8.0) * 0.5;
      nx *= (1.0 + wave * 0.5);
      ny *= (1.0 + wave * 0.5);
    } else {
      // Glass distort — strong, both directions
      strength *= 1.5;
    }

    vec2 off = vec2(nx, ny) * strength;
    vec4 src = texture2D(uTexture, vUv + off);
    gl_FragColor = src;
  }
`;

// ============================================================================
// NOISE HERO — multi-type generator (white / blue / value / fbm / cell) with
// blend modes, animated/static, and tonal weighting.
// ============================================================================
export const noiseHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1
  uniform float uType;          // 0=white, 1=blue, 2=value, 3=fbm, 4=cellular
  uniform float uMode;          // 0=overlay, 1=add, 2=multiply, 3=screen, 4=replace
  uniform float uScale;         // 0.5-32 noise scale
  uniform float uMono;          // 0=RGB noise, 1=mono
  uniform float uShadowAmt;     // 0-1
  uniform float uMidAmt;        // 0-1
  uniform float uHighAmt;       // 0-1
  uniform float uAnimSpeed;     // 0=static, 0-2=anim
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash13(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 5; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float cellular(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float minD = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));
        vec2 r = g + o - f;
        float d = dot(r, r);
        minD = min(minD, d);
      }
    }
    return sqrt(minD);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 sampleNoise(vec2 p, float t) {
    int type = int(uType + 0.5);
    if (uMono > 0.5) {
      float n;
      if (type == 0) n = hash13(vec3(p, t)) - 0.5;
      else if (type == 1) {
        // Blue-style: triangular distribution from two whites
        float a = hash13(vec3(p, t));
        float b = hash13(vec3(p + 1.0, t + 0.5));
        n = (a + b) * 0.5 - 0.5;
      }
      else if (type == 2) n = vnoise(p) - 0.5;
      else if (type == 3) n = fbm(p) - 0.5;
      else n = cellular(p) - 0.5;
      return vec3(n);
    } else {
      vec3 c;
      if (type == 0) c = vec3(hash13(vec3(p, t)), hash13(vec3(p, t + 0.31)), hash13(vec3(p, t + 0.71))) - 0.5;
      else if (type == 1) {
        c = vec3(
          (hash13(vec3(p, t)) + hash13(vec3(p + 1.0, t + 0.5))) * 0.5 - 0.5,
          (hash13(vec3(p + 7.0, t + 0.31)) + hash13(vec3(p + 8.0, t + 0.81))) * 0.5 - 0.5,
          (hash13(vec3(p + 17.0, t + 0.71)) + hash13(vec3(p + 18.0, t + 0.91))) * 0.5 - 0.5
        );
      }
      else if (type == 2) c = vec3(vnoise(p), vnoise(p + 13.7), vnoise(p + 71.3)) - 0.5;
      else if (type == 3) c = vec3(fbm(p), fbm(p + 13.7), fbm(p + 71.3)) - 0.5;
      else c = vec3(cellular(p), cellular(p + 13.7), cellular(p + 71.3)) - 0.5;
      return c;
    }
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uAmount < 0.001) { gl_FragColor = src; return; }

    float t = (uAnimSpeed > 0.001) ? floor(uTime * uAnimSpeed * 24.0) / 24.0 : 0.0;
    vec2 p = vUv * uResolution / max(0.5, 64.0 / uScale);
    vec3 noise = sampleNoise(p, t);

    // Tonal weighting
    float l = luma(src.rgb);
    float shadowMask = 1.0 - smoothstep(0.0, 0.4, l);
    float midMask = (1.0 - abs(l - 0.5) * 2.0);
    float highMask = smoothstep(0.6, 1.0, l);
    float zoneAmp = shadowMask * uShadowAmt + midMask * uMidAmt + highMask * uHighAmt;
    noise *= uAmount * zoneAmp;

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) {
      // Overlay: noise around 0.5, blend lightly
      result = src.rgb + noise;
    } else if (mode == 1) {
      result = src.rgb + abs(noise) * sign(noise);
    } else if (mode == 2) {
      result = src.rgb * (1.0 + noise);
    } else if (mode == 3) {
      vec3 n01 = noise + 0.5;
      result = 1.0 - (1.0 - src.rgb) * (1.0 - n01 * uAmount);
    } else {
      result = noise + 0.5;
    }
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// CRT HERO — Phosphor mask + scanlines + curvature + glow + barrel + vignette.
// ============================================================================
export const crtHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uScanlines;     // 0-1 scanline strength
  uniform float uScanCount;     // 100-1200 scanline count
  uniform float uMask;          // 0-1 phosphor mask strength
  uniform float uMaskType;      // 0=Trinitron stripe, 1=Aperture grille, 2=Shadow mask
  uniform float uCurvature;     // 0-1 barrel curvature
  uniform float uVignette;      // 0-1 corner darken
  uniform float uGlow;          // 0-1 phosphor glow bleed
  uniform float uRollingBar;    // 0-1 vertical roll
  uniform float uChromatic;     // 0-1 lens fringing
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 curveUv(vec2 uv, float k) {
    uv = uv * 2.0 - 1.0;
    vec2 offset = abs(uv.yx) / vec2(6.0, 4.0);
    uv = uv + uv * offset * offset * k;
    return uv * 0.5 + 0.5;
  }

  void main() {
    vec2 uv = uCurvature > 0.001 ? curveUv(vUv, uCurvature) : vUv;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Chromatic aberration on RGB channels
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 cd = (uv - 0.5) * uChromatic * 0.01;
      col.r = texture2D(uTexture, uv + cd).r;
      col.g = texture2D(uTexture, uv).g;
      col.b = texture2D(uTexture, uv - cd).b;
    } else {
      col = texture2D(uTexture, uv).rgb;
    }

    // Phosphor mask
    if (uMask > 0.001) {
      int mtype = int(uMaskType + 0.5);
      vec2 px = uv * uResolution;
      vec3 maskCol = vec3(1.0);
      if (mtype == 0) {
        // Trinitron vertical stripes (3-pixel R/G/B repeat)
        float stripe = mod(px.x, 3.0);
        if (stripe < 1.0) maskCol = vec3(1.4, 0.6, 0.6);
        else if (stripe < 2.0) maskCol = vec3(0.6, 1.4, 0.6);
        else maskCol = vec3(0.6, 0.6, 1.4);
      } else if (mtype == 1) {
        // Aperture grille (vertical stripes + horizontal damping wires)
        float stripe = mod(px.x, 3.0);
        if (stripe < 1.0) maskCol = vec3(1.5, 0.5, 0.5);
        else if (stripe < 2.0) maskCol = vec3(0.5, 1.5, 0.5);
        else maskCol = vec3(0.5, 0.5, 1.5);
        float wire = step(0.95, mod(px.y * 0.005, 1.0));
        maskCol *= 1.0 - wire * 0.3;
      } else {
        // Shadow mask (RGB triads on diamond)
        float u3 = mod(px.x, 6.0);
        float v3 = mod(px.y, 2.0);
        if (v3 < 1.0) {
          if (u3 < 2.0) maskCol = vec3(1.5, 0.5, 0.5);
          else if (u3 < 4.0) maskCol = vec3(0.5, 1.5, 0.5);
          else maskCol = vec3(0.5, 0.5, 1.5);
        } else {
          if (u3 < 1.0 || u3 >= 5.0) maskCol = vec3(0.5, 0.5, 1.5);
          else if (u3 < 3.0) maskCol = vec3(1.5, 0.5, 0.5);
          else maskCol = vec3(0.5, 1.5, 0.5);
        }
      }
      col = mix(col, col * maskCol, uMask);
    }

    // Scanlines
    if (uScanlines > 0.001) {
      float sl = sin(uv.y * uScanCount * 3.14159) * 0.5 + 0.5;
      col *= mix(1.0, sl, uScanlines);
    }

    // Glow (sample surrounding pixels weighted)
    if (uGlow > 0.001) {
      vec2 texel = 1.0 / uResolution;
      vec3 g = texture2D(uTexture, uv + vec2( texel.x,  0.0)).rgb
             + texture2D(uTexture, uv + vec2(-texel.x,  0.0)).rgb
             + texture2D(uTexture, uv + vec2( 0.0,  texel.y)).rgb
             + texture2D(uTexture, uv + vec2( 0.0, -texel.y)).rgb;
      col += g * uGlow * 0.05;
    }

    // Rolling sync bar
    if (uRollingBar > 0.001) {
      float bar = sin(uv.y * 6.0 - uTime * 1.5);
      bar = smoothstep(0.7, 1.0, bar);
      col += bar * uRollingBar * 0.15;
    }

    // Vignette
    if (uVignette > 0.001) {
      vec2 vc = uv - 0.5;
      float v = 1.0 - dot(vc, vc) * uVignette * 1.4;
      col *= clamp(v, 0.0, 1.0);
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// KALEIDOSCOPE HERO — N-segment radial mirror with rotation, mode, animated.
// ============================================================================
export const kaleidoscopeHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSegments;      // 2-32
  uniform float uAngle;         // 0-360 rotation
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uZoom;          // 0.25-4
  uniform float uMode;          // 0=mirror, 1=tile (no flip), 2=spiral
  uniform float uSpiralAmount;  // 0-2 spiral twist (used in mode 2)
  uniform float uAnimSpeed;     // 0-2 auto-rotate
  uniform float uMix;           // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 d = vUv - center;
    // Aspect correct
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float theta = atan(d.y, d.x);
    float baseAngle = radians(uAngle) + uTime * uAnimSpeed * 0.3;
    theta -= baseAngle;

    int mode = int(uMode + 0.5);
    float seg = max(2.0, uSegments);
    float wedge = 6.28318 / seg;

    if (mode == 0) {
      // Mirror — fold within wedge
      theta = mod(theta, wedge);
      theta = abs(theta - wedge * 0.5);
    } else if (mode == 1) {
      // Tile — modulo without flip
      theta = mod(theta, wedge);
    } else {
      // Spiral — fold + radial twist
      theta = mod(theta, wedge);
      theta = abs(theta - wedge * 0.5);
      theta += r * uSpiralAmount * 2.0;
    }

    float zoom = max(0.05, uZoom);
    vec2 mappedD = vec2(cos(theta), sin(theta)) * r / zoom;
    mappedD.x *= uResolution.y / uResolution.x;
    vec2 mappedUv = mappedD + center;
    mappedUv = clamp(mappedUv, vec2(0.0), vec2(1.0));

    vec4 src = texture2D(uTexture, vUv);
    vec4 mapped = texture2D(uTexture, mappedUv);
    gl_FragColor = vec4(mix(src.rgb, mapped.rgb, uMix), src.a);
  }
`;

// ============================================================================
// MIRROR HERO — Multi-mode mirror with axis + position + offset + flip.
// ============================================================================
export const mirrorHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=horizontal, 1=vertical, 2=quad, 3=diagonal
  uniform float uPosition;      // 0-1 mirror axis position
  uniform float uOffset;        // 0-1 source offset
  uniform float uFlipSide;      // 0=mirror right/bottom, 1=mirror left/top
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    int mode = int(uMode + 0.5);

    if (mode == 0) {
      // Horizontal axis (mirror along Y)
      float pos = uPosition;
      bool aboveAxis = (uv.x > pos) != (uFlipSide > 0.5);
      if (aboveAxis) {
        uv.x = pos * 2.0 - uv.x + (uOffset - 0.5) * 0.4;
      }
    } else if (mode == 1) {
      // Vertical axis (mirror along X)
      float pos = uPosition;
      bool aboveAxis = (uv.y > pos) != (uFlipSide > 0.5);
      if (aboveAxis) {
        uv.y = pos * 2.0 - uv.y + (uOffset - 0.5) * 0.4;
      }
    } else if (mode == 2) {
      // Quad mirror
      uv = abs(uv - 0.5) + 0.5;
      uv = abs(uv - vec2(uPosition, uPosition));
      uv = mix(uv, vUv, 0.0);
    } else {
      // Diagonal
      vec2 c = vec2(uPosition);
      vec2 d = uv - c;
      // Reflect across diagonal y=x going through center
      vec2 refl = c + vec2(d.y, d.x);
      uv = (uFlipSide > 0.5) ? refl : (uv.x + uv.y < 2.0 * uPosition ? uv : refl);
    }

    uv = clamp(uv, vec2(0.0), vec2(1.0));
    vec4 mirrored = texture2D(uTexture, uv);
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mix(src.rgb, mirrored.rgb, uMix), src.a);
  }
`;

// ============================================================================
// WAVE HERO — sin/cos/triangle/saw waveforms + mode + multiple axes + tile.
// ============================================================================
export const waveHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmplitude;     // 0-50 px
  uniform float uFrequency;     // 0.1-30
  uniform float uSpeed;         // 0-3
  uniform float uType;          // 0=horizontal, 1=vertical, 2=radial, 3=swirl
  uniform float uWaveform;      // 0=sin, 1=triangle, 2=saw, 3=square
  uniform float uPhase;         // 0-360 phase offset
  uniform float uSecondaryAmt;  // 0-1 second harmonic
  uniform float uChromaSplit;   // 0-1 RGB phase shift
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float waveform(float x, int kind) {
    if (kind == 0) return sin(x);
    if (kind == 1) return abs(mod(x / 3.14159, 2.0) - 1.0) * 2.0 - 1.0;
    if (kind == 2) return mod(x / 3.14159, 2.0) - 1.0;
    return sign(sin(x));
  }

  vec2 waveOffset(vec2 uv, float phaseShift) {
    int type = int(uType + 0.5);
    int wf = int(uWaveform + 0.5);
    float t = uTime * uSpeed + radians(uPhase) + phaseShift;
    float amp = uAmplitude / uResolution.y;
    float freq = uFrequency;
    vec2 off = vec2(0.0);

    if (type == 0) {
      // Horizontal — wave shifts X based on Y
      off.x = waveform(uv.y * freq + t, wf) * amp;
      if (uSecondaryAmt > 0.001) off.x += waveform(uv.y * freq * 2.5 + t * 1.7, wf) * amp * uSecondaryAmt * 0.5;
    } else if (type == 1) {
      off.y = waveform(uv.x * freq + t, wf) * amp;
      if (uSecondaryAmt > 0.001) off.y += waveform(uv.x * freq * 2.5 + t * 1.7, wf) * amp * uSecondaryAmt * 0.5;
    } else if (type == 2) {
      // Radial — push out/in based on distance
      vec2 d = uv - 0.5;
      float r = length(d);
      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
      off = dir * waveform(r * freq * 8.0 + t, wf) * amp;
    } else {
      // Swirl
      vec2 d = uv - 0.5;
      float r = length(d);
      float a = atan(d.y, d.x);
      float w = waveform(r * freq + t, wf) * amp * 4.0;
      a += w;
      off = vec2(cos(a), sin(a)) * r + 0.5 - uv;
    }
    return off;
  }

  void main() {
    vec2 baseOff = waveOffset(vUv, 0.0);
    vec3 col;
    if (uChromaSplit > 0.001) {
      vec2 offR = waveOffset(vUv, 0.5 * uChromaSplit);
      vec2 offB = waveOffset(vUv, -0.5 * uChromaSplit);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ============================================================================
// FISHEYE HERO — Barrel/pincushion + center pick + edge zoom + chromatic edge.
// ============================================================================
export const fisheyeHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uStrength;      // -1..1 (negative = pincushion)
  uniform float uRadius;        // 0.1-1
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uZoom;          // 0.5-2
  uniform float uMode;          // 0=spherize, 1=barrel, 2=pincushion
  uniform float uChromaEdge;    // 0-1 edge fringing
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 fisheyeMap(vec2 uv, float strength, float radius, float zoom) {
    vec2 d = uv - vec2(uCenterX, uCenterY);
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float radNorm = clamp(r / radius, 0.0, 1.0);
    int mode = int(uMode + 0.5);
    float distort;
    if (mode == 0) {
      // Spherize (smooth)
      distort = sin(radNorm * 1.5707963 * sign(strength)) * abs(strength);
    } else if (mode == 1) {
      // Barrel (cubic)
      distort = radNorm * radNorm * abs(strength) * sign(strength);
    } else {
      // Pincushion (always pulls in)
      distort = -radNorm * radNorm * abs(strength);
    }
    float scale = 1.0 + distort;
    d /= max(0.0001, scale);
    d /= zoom;
    d.x *= uResolution.y / uResolution.x;
    return d + vec2(uCenterX, uCenterY);
  }

  void main() {
    vec2 uvBase = fisheyeMap(vUv, uStrength, uRadius, uZoom);
    vec3 col;
    if (uChromaEdge > 0.001) {
      vec2 d = vUv - vec2(uCenterX, uCenterY);
      float r = length(d);
      float edgeAmp = smoothstep(uRadius * 0.4, uRadius, r) * uChromaEdge * 0.04;
      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
      vec2 uvR = fisheyeMap(vUv + dir * edgeAmp, uStrength, uRadius, uZoom);
      vec2 uvB = fisheyeMap(vUv - dir * edgeAmp, uStrength, uRadius, uZoom);
      col.r = texture2D(uTexture, clamp(uvR, vec2(0.0), vec2(1.0))).r;
      col.g = texture2D(uTexture, clamp(uvBase, vec2(0.0), vec2(1.0))).g;
      col.b = texture2D(uTexture, clamp(uvB, vec2(0.0), vec2(1.0))).b;
    } else {
      col = texture2D(uTexture, clamp(uvBase, vec2(0.0), vec2(1.0))).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ============================================================================
// LENS DISTORTION HERO — Multi-mode lens warp (barrel / pincushion / mustache /
// anamorphic stretch) with center + cubic + edge fade.
// ============================================================================
export const lensDistortionHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // -1..1
  uniform float uMode;          // 0=barrel, 1=pincushion, 2=mustache, 3=anamorphic
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uCubic;         // -0.5..0.5 cubic term (mustache uses both)
  uniform float uAnamorphicX;   // 0.5-2 horizontal stretch
  uniform float uEdgeFade;      // 0-1 fade at edges (transparent border)
  uniform float uChromaFringe;  // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 lensMap(vec2 uv, float k1, float k2) {
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r2 = dot(d, d);
    float factor = 1.0 + k1 * r2 + k2 * r2 * r2;
    d *= factor;
    d.x *= uResolution.y / uResolution.x;
    return d + c;
  }

  void main() {
    int mode = int(uMode + 0.5);
    float k1, k2;
    if (mode == 0) { k1 = uAmount; k2 = 0.0; }
    else if (mode == 1) { k1 = -uAmount; k2 = 0.0; }
    else if (mode == 2) { k1 = uAmount; k2 = uCubic; }
    else { k1 = 0.0; k2 = 0.0; }

    vec2 uv;
    if (mode == 3) {
      // Anamorphic stretch — no radial, just X scale
      vec2 c = vec2(uCenterX, uCenterY);
      vec2 d = vUv - c;
      d.x /= max(0.1, uAnamorphicX);
      uv = d + c;
    } else {
      uv = lensMap(vUv, k1, k2);
    }

    vec3 col;
    if (uChromaFringe > 0.001) {
      vec2 uvR = lensMap(vUv, k1 * (1.0 + uChromaFringe * 0.05), k2);
      vec2 uvB = lensMap(vUv, k1 * (1.0 - uChromaFringe * 0.05), k2);
      col.r = texture2D(uTexture, clamp(uvR, vec2(0.0), vec2(1.0))).r;
      col.g = texture2D(uTexture, clamp(uv, vec2(0.0), vec2(1.0))).g;
      col.b = texture2D(uTexture, clamp(uvB, vec2(0.0), vec2(1.0))).b;
    } else {
      col = texture2D(uTexture, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
    }

    // Edge fade — transparent border for OOB samples
    float oob = step(uv.x, 0.0) + step(1.0, uv.x) + step(uv.y, 0.0) + step(1.0, uv.y);
    oob = min(oob, 1.0);
    float aFade = mix(1.0, 0.0, oob * uEdgeFade);

    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a * aFade);
  }
`;

// ============================================================================
// CHROMA KEY HERO — Greenscreen with hue band + soft edge + spill suppression.
// ============================================================================
export const chromaKeyHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uKeyR;          // 0-1 key colour (default green)
  uniform float uKeyG;
  uniform float uKeyB;
  uniform float uTolerance;     // 0-1 hue band width
  uniform float uSoftness;      // 0-1 edge feather
  uniform float uSpillSuppress; // 0-1 reduce key colour on subject
  uniform float uMatte;         // 0=show matte (1-bit), 0=keyed result
  uniform float uMode;          // 0=hue distance, 1=YCbCr, 2=RGB distance
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 rgb2ycbcr(vec3 c) {
    float y  =  0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    float cb = -0.169 * c.r - 0.331 * c.g + 0.5   * c.b;
    float cr =  0.5   * c.r - 0.419 * c.g - 0.081 * c.b;
    return vec3(y, cb, cr);
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 key = vec3(uKeyR, uKeyG, uKeyB);
    int mode = int(uMode + 0.5);

    float dist;
    if (mode == 0) {
      // Hue distance
      vec3 hsvSrc = rgb2hsv(src);
      vec3 hsvKey = rgb2hsv(key);
      float hd = abs(hsvSrc.x - hsvKey.x);
      hd = min(hd, 1.0 - hd);
      dist = hd * 2.0 + (1.0 - hsvSrc.y) * 0.3;
    } else if (mode == 1) {
      // YCbCr (chroma plane)
      vec3 yc = rgb2ycbcr(src);
      vec3 yk = rgb2ycbcr(key);
      dist = length(yc.yz - yk.yz) * 2.0;
    } else {
      // RGB distance
      dist = length(src - key);
    }

    float matte = smoothstep(uTolerance, uTolerance + uSoftness + 0.001, dist);

    // Spill suppression
    vec3 result = src;
    if (uSpillSuppress > 0.001) {
      float keyMax = max(max(key.r, key.g), key.b);
      // Reduce dominant key channel
      if (key.g >= max(key.r, key.b)) {
        result.g = min(result.g, mix(result.g, (result.r + result.b) * 0.5, uSpillSuppress * (1.0 - matte)));
      } else if (key.r >= max(key.g, key.b)) {
        result.r = min(result.r, mix(result.r, (result.g + result.b) * 0.5, uSpillSuppress * (1.0 - matte)));
      } else {
        result.b = min(result.b, mix(result.b, (result.r + result.g) * 0.5, uSpillSuppress * (1.0 - matte)));
      }
    }

    if (uMatte > 0.5) {
      gl_FragColor = vec4(vec3(matte), 1.0);
    } else {
      gl_FragColor = vec4(result, matte);
    }
  }
`;

// ============================================================================
// LUMA KEY HERO — Brightness-based key with low/high cut + invert.
// ============================================================================
export const lumaKeyHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uLowCut;        // 0-1 fade-in start
  uniform float uHighCut;       // 0-1 fade-in end
  uniform float uInvert;        // 0=keep bright, 1=keep dark
  uniform float uGamma;         // 0.2-3 matte gamma
  uniform float uMatte;         // 0=normal, 1=show matte
  uniform float uPremultiply;   // 0=straight alpha, 1=premultiplied
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float l = luma(src);
    float matte = smoothstep(uLowCut, max(uLowCut + 0.001, uHighCut), l);
    if (uInvert > 0.5) matte = 1.0 - matte;
    matte = pow(clamp(matte, 0.0, 1.0), max(0.001, uGamma));

    if (uMatte > 0.5) {
      gl_FragColor = vec4(vec3(matte), 1.0);
    } else {
      vec3 result = (uPremultiply > 0.5) ? src * matte : src;
      gl_FragColor = vec4(result, matte);
    }
  }
`;

// ============================================================================
// DIFFERENCE KEY HERO — Key based on difference from a reference colour.
// ============================================================================
export const differenceKeyHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRefR;          // 0-1 reference colour
  uniform float uRefG;
  uniform float uRefB;
  uniform float uTolerance;     // 0-1
  uniform float uSoftness;      // 0-1
  uniform float uInvert;        // 0=key matches, 1=key non-matches
  uniform float uMatte;         // 0=normal, 1=show matte
  uniform float uMode;          // 0=Euclidean, 1=Manhattan, 2=Max channel
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 ref = vec3(uRefR, uRefG, uRefB);
    vec3 diff = abs(src - ref);

    int mode = int(uMode + 0.5);
    float d;
    if (mode == 0) d = length(diff);
    else if (mode == 1) d = (diff.r + diff.g + diff.b);
    else d = max(max(diff.r, diff.g), diff.b);

    float matte = smoothstep(uTolerance, uTolerance + uSoftness + 0.001, d);
    if (uInvert > 0.5) matte = 1.0 - matte;

    if (uMatte > 0.5) {
      gl_FragColor = vec4(vec3(matte), 1.0);
    } else {
      gl_FragColor = vec4(src, matte);
    }
  }
`;

// ============================================================================
// ERODE HERO — Morphological min filter (shrinks bright regions).
// ============================================================================
export const erodeHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRadius;        // 1-8 pixel radius
  uniform float uShape;         // 0=cross, 1=square, 2=circle
  uniform float uChannel;       // 0=luma, 1=red, 2=green, 3=blue, 4=alpha
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float channelVal(vec4 c, int ch) {
    if (ch == 0) return dot(c.rgb, vec3(0.299, 0.587, 0.114));
    if (ch == 1) return c.r;
    if (ch == 2) return c.g;
    if (ch == 3) return c.b;
    return c.a;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uRadius < 0.5) { gl_FragColor = src; return; }

    int radius = int(clamp(uRadius, 1.0, 8.0));
    int shape = int(uShape + 0.5);
    int ch = int(uChannel + 0.5);
    vec2 texel = 1.0 / uResolution;

    vec4 minPx = vec4(1.0);
    float minVal = 1.0;
    for (int y = -8; y <= 8; y++) {
      if (abs(y) > radius) continue;
      for (int x = -8; x <= 8; x++) {
        if (abs(x) > radius) continue;
        if (shape == 0 && abs(x) + abs(y) > radius) continue;
        if (shape == 2 && (x*x + y*y) > radius * radius) continue;
        vec4 sCol = texture2D(uTexture, vUv + vec2(float(x), float(y)) * texel);
        float v = channelVal(sCol, ch);
        if (v < minVal) { minVal = v; minPx = sCol; }
      }
    }

    gl_FragColor = vec4(mix(src.rgb, minPx.rgb, uMix), mix(src.a, minPx.a, uMix));
  }
`;

// ============================================================================
// DILATE HERO — Morphological max filter (grows bright regions).
// ============================================================================
export const dilateHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRadius;        // 1-8
  uniform float uShape;         // 0=cross, 1=square, 2=circle
  uniform float uChannel;       // 0=luma, 1=red, 2=green, 3=blue, 4=alpha
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float channelVal(vec4 c, int ch) {
    if (ch == 0) return dot(c.rgb, vec3(0.299, 0.587, 0.114));
    if (ch == 1) return c.r;
    if (ch == 2) return c.g;
    if (ch == 3) return c.b;
    return c.a;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uRadius < 0.5) { gl_FragColor = src; return; }

    int radius = int(clamp(uRadius, 1.0, 8.0));
    int shape = int(uShape + 0.5);
    int ch = int(uChannel + 0.5);
    vec2 texel = 1.0 / uResolution;

    vec4 maxPx = vec4(0.0);
    float maxVal = 0.0;
    for (int y = -8; y <= 8; y++) {
      if (abs(y) > radius) continue;
      for (int x = -8; x <= 8; x++) {
        if (abs(x) > radius) continue;
        if (shape == 0 && abs(x) + abs(y) > radius) continue;
        if (shape == 2 && (x*x + y*y) > radius * radius) continue;
        vec4 sCol = texture2D(uTexture, vUv + vec2(float(x), float(y)) * texel);
        float v = channelVal(sCol, ch);
        if (v > maxVal) { maxVal = v; maxPx = sCol; }
      }
    }

    gl_FragColor = vec4(mix(src.rgb, maxPx.rgb, uMix), mix(src.a, maxPx.a, uMix));
  }
`;

// ============================================================================
// TWIRL HERO — Spiral warp around point with falloff + animated.
// ============================================================================
export const twirlHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAngle;         // radians of full twirl at center
  uniform float uRadius;        // 0.05-1 area of effect
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uFalloff;       // 0.5-4 power curve
  uniform float uAnimSpeed;     // 0-2 auto-rotation
  uniform float uMix;           // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 center = vec2(uCenterX, uCenterY);
    vec2 d = vUv - center;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float maxR = max(0.001, uRadius);
    float falloff = pow(clamp(1.0 - r / maxR, 0.0, 1.0), max(0.5, uFalloff));
    float a = uAngle * falloff + uTime * uAnimSpeed;
    float ca = cos(a), sa = sin(a);
    vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
    rd.x *= uResolution.y / uResolution.x;
    vec2 sUv = clamp(center + rd, vec2(0.0), vec2(1.0));
    vec4 warped = texture2D(uTexture, sUv);
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mix(src.rgb, warped.rgb, uMix), src.a);
  }
`;

// ============================================================================
// PINCH/BULGE HERO — Convex/concave warp with center + radius + chromatic.
// ============================================================================
export const pinchBulgeHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // -1..1 negative=pinch, positive=bulge
  uniform float uRadius;        // 0.1-1
  uniform float uCenterX;       // 0-1
  uniform float uCenterY;       // 0-1
  uniform float uFalloff;       // 0.5-4
  uniform float uChromatic;     // 0-1 RGB split
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 warp(vec2 uv, float amt) {
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float maxR = max(0.001, uRadius);
    float t = clamp(r / maxR, 0.0, 1.0);
    float fade = pow(1.0 - t, max(0.5, uFalloff));
    float k = 1.0 + amt * fade;
    if (k < 0.001) k = 0.001;
    d /= k;
    d.x *= uResolution.y / uResolution.x;
    return c + d;
  }

  void main() {
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 uvR = warp(vUv, uAmount * (1.0 + uChromatic * 0.05));
      vec2 uvG = warp(vUv, uAmount);
      vec2 uvB = warp(vUv, uAmount * (1.0 - uChromatic * 0.05));
      col.r = texture2D(uTexture, clamp(uvR, vec2(0.0), vec2(1.0))).r;
      col.g = texture2D(uTexture, clamp(uvG, vec2(0.0), vec2(1.0))).g;
      col.b = texture2D(uTexture, clamp(uvB, vec2(0.0), vec2(1.0))).b;
    } else {
      col = texture2D(uTexture, clamp(warp(vUv, uAmount), vec2(0.0), vec2(1.0))).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mix(src.rgb, col, uMix), src.a);
  }
`;

// ============================================================================
// DISPLACEMENT HERO — Procedural noise-driven displacement (no texture upload).
// ============================================================================
export const displacementHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1
  uniform float uScale;         // 1-32
  uniform float uSpeed;         // 0-3
  uniform float uMode;          // 0=fbm, 1=cellular, 2=sine grid, 3=ripple
  uniform float uTurbulence;    // 0-1
  uniform float uChromatic;     // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float cellular(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float minD = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));
        vec2 r = g + o - f;
        minD = min(minD, dot(r, r));
      }
    }
    return sqrt(minD);
  }

  vec2 dispOffset(vec2 uv, float t) {
    int mode = int(uMode + 0.5);
    vec2 p = uv * uScale + vec2(t, t * 0.7);
    float nx, ny;
    if (mode == 0) {
      nx = (uTurbulence > 0.5 ? fbm(p) : vnoise(p)) - 0.5;
      ny = (uTurbulence > 0.5 ? fbm(p + 71.3) : vnoise(p + 71.3)) - 0.5;
    } else if (mode == 1) {
      nx = cellular(p) - 0.5;
      ny = cellular(p + 71.3) - 0.5;
    } else if (mode == 2) {
      nx = sin(uv.y * uScale * 6.283 + t * 2.0);
      ny = sin(uv.x * uScale * 6.283 + t * 2.0);
    } else {
      vec2 d = uv - 0.5;
      float r = length(d);
      float ripple = sin(r * uScale * 6.283 - t * 3.0);
      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
      nx = dir.x * ripple;
      ny = dir.y * ripple;
    }
    return vec2(nx, ny) * uAmount * 0.05;
  }

  void main() {
    float t = uTime * uSpeed;
    vec2 baseOff = dispOffset(vUv, t);
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 offR = dispOffset(vUv, t + 0.3 * uChromatic);
      vec2 offB = dispOffset(vUv, t - 0.3 * uChromatic);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ============================================================================
// POLAR TRANSFORM HERO — Cartesian↔polar conversion with rotation + zoom.
// ============================================================================
export const polarTransformHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=cart→polar, 1=polar→cart, 2=log polar
  uniform float uRotation;      // 0-360
  uniform float uZoom;          // 0.25-4
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 sUv;

    if (mode == 0) {
      // Cart → polar (input becomes radial pattern)
      vec2 d = vUv - c;
      d.x *= uResolution.x / uResolution.y;
      float r = length(d) * 2.0;
      float a = atan(d.y, d.x) / 6.28318 + 0.5;
      a = fract(a + uRotation / 360.0);
      sUv = vec2(a, r * uZoom);
    } else if (mode == 1) {
      // Polar → cart (rectangular UV becomes radial)
      float a = (vUv.x - 0.5 + uRotation / 360.0) * 6.28318;
      float r = vUv.y * uZoom;
      vec2 d = vec2(cos(a), sin(a)) * r * 0.5;
      d.x *= uResolution.y / uResolution.x;
      sUv = c + d;
    } else {
      // Log polar
      vec2 d = vUv - c;
      d.x *= uResolution.x / uResolution.y;
      float r = log(length(d) * 2.0 + 1.0);
      float a = atan(d.y, d.x) / 6.28318 + 0.5;
      a = fract(a + uRotation / 360.0);
      sUv = vec2(a, r * uZoom);
    }

    sUv = clamp(sUv, vec2(0.0), vec2(1.0));
    vec4 mapped = texture2D(uTexture, sUv);
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mix(src.rgb, mapped.rgb, uMix), src.a);
  }
`;

// ============================================================================
// COMPRESSION ARTIFACTS HERO — Block DCT with quantization + chroma subsample.
// ============================================================================
export const compressionArtifactsHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uBlockSize;     // 4-32
  uniform float uQuality;       // 0-1 (low=more artifacts)
  uniform float uChromaSubsample; // 0-1
  uniform float uBlockNoise;    // 0-1 random per-block jitter
  uniform float uMode;          // 0=DCT-style block, 1=hard 8x8, 2=color banding
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec3 rgb2ycbcr(vec3 c) {
    return vec3(
       0.299 * c.r + 0.587 * c.g + 0.114 * c.b,
      -0.169 * c.r - 0.331 * c.g + 0.5   * c.b + 0.5,
       0.5   * c.r - 0.419 * c.g - 0.081 * c.b + 0.5
    );
  }
  vec3 ycbcr2rgb(vec3 c) {
    float y = c.x; float cb = c.y - 0.5; float cr = c.z - 0.5;
    return vec3(y + 1.402 * cr, y - 0.344 * cb - 0.714 * cr, y + 1.772 * cb);
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uMix < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    float bs = max(2.0, uBlockSize);
    vec2 px = vUv * uResolution;

    // Find block center
    vec2 blockId = floor(px / bs);
    vec2 blockCenter = (blockId + 0.5) * bs / uResolution;

    // Sample block average (proxy for low-frequency component)
    vec3 avg = vec3(0.0);
    int s = 0;
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) {
        vec2 sp = (blockId * bs + vec2(float(x), float(y)) * bs * 0.25) / uResolution;
        avg += texture2D(uTexture, sp).rgb;
        s++;
      }
    }
    avg /= float(s);

    vec3 result;
    if (mode == 0 || mode == 1) {
      // Quantize per block
      float qStep = mix(0.01, 0.2, 1.0 - uQuality);
      vec3 quant = floor(src.rgb / qStep) * qStep;
      // Mix block average with quantized
      float blockBias = (mode == 1) ? 0.65 : 0.45;
      result = mix(quant, avg, blockBias * (1.0 - uQuality));

      // Block-noise jitter
      if (uBlockNoise > 0.001) {
        float bn = (hash21(blockId) - 0.5) * uBlockNoise * 0.15;
        result += vec3(bn);
      }
    } else {
      // Color banding (luma-preserving bit reduction in chroma)
      vec3 ycc = rgb2ycbcr(src.rgb);
      float yStep = mix(0.005, 0.05, 1.0 - uQuality);
      ycc.x = floor(ycc.x / yStep) * yStep;
      float cStep = mix(0.02, 0.2, 1.0 - uQuality);
      ycc.yz = floor(ycc.yz / cStep) * cStep;
      result = ycbcr2rgb(ycc);
    }

    // Chroma subsample
    if (uChromaSubsample > 0.001) {
      vec3 subYcc = rgb2ycbcr(avg);
      vec3 hereYcc = rgb2ycbcr(result);
      hereYcc.yz = mix(hereYcc.yz, subYcc.yz, uChromaSubsample);
      result = ycbcr2rgb(hereYcc);
    }

    gl_FragColor = vec4(mix(src.rgb, clamp(result, 0.0, 1.0), uMix), src.a);
  }
`;

// ============================================================================
// FALSE COLOR HERO — Exposure-bracket false colour map (red=overexposed,
// blue=underexposed, green=midtone safe).
// ============================================================================
export const falseColorHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=DIT exposure, 1=zone heat, 2=Resolve, 3=histogram
  uniform float uMix;           // 0-1
  uniform float uShowOriginal;  // 0-1 fade overlay vs replace
  uniform float uMidpoint;      // 0-1 reference midtone (0.5 default)
  uniform float uRange;         // 0.05-0.5 zone width
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 ditExposure(float l) {
    if (l < 0.04) return vec3(0.5, 0, 0.7);  // Purple — clip black
    if (l < 0.18) return vec3(0, 0, 0.9);    // Blue — shadows
    if (l < 0.42) return vec3(0, 0.8, 0.6);  // Teal — low-mid
    if (l < 0.55) return vec3(0.4, 0.8, 0);  // Green — midtone (safe)
    if (l < 0.7)  return vec3(1, 1, 0);      // Yellow — high-mid
    if (l < 0.92) return vec3(1, 0.5, 0);    // Orange — highlights
    return vec3(1, 0, 0);                    // Red — clip white
  }

  vec3 zoneHeat(float l) {
    // Adams zone system 0-X mapped to 7-color gradient
    float n = l;
    return mix(
      mix(vec3(0,0,0.5), vec3(0,0.7,1), smoothstep(0.0, 0.4, n)),
      mix(vec3(0,1,0), vec3(1,1,0), smoothstep(0.4, 0.7, n)),
      smoothstep(0.4, 0.55, n)
    ) + smoothstep(0.85, 1.0, n) * vec3(1, 0.2, 0);
  }

  vec3 resolveStyle(float l) {
    // Two-color highlight/shadow warning (blue = underexposed, red = overexposed)
    if (l < 0.05) return vec3(0, 0, 1);
    if (l > 0.95) return vec3(1, 0, 0);
    return vec3(l); // grayscale otherwise
  }

  vec3 histogramStripes(float l) {
    // Map exposure to rainbow stripes for histogram-style preview
    float h = l;
    return vec3(
      sin(h * 9.42) * 0.5 + 0.5,
      sin(h * 9.42 + 2.094) * 0.5 + 0.5,
      sin(h * 9.42 + 4.189) * 0.5 + 0.5
    );
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    float l = luma(src.rgb);
    int mode = int(uMode + 0.5);
    vec3 fc;
    if (mode == 0) fc = ditExposure(l);
    else if (mode == 1) fc = zoneHeat(l);
    else if (mode == 2) fc = resolveStyle(l);
    else fc = histogramStripes(l);

    // Highlight zones around midpoint
    if (uRange > 0.001) {
      float zoneMask = smoothstep(uRange, 0.0, abs(l - uMidpoint));
      fc = mix(fc, vec3(0, 1, 0), zoneMask * 0.4); // green tint on safe zone
    }

    vec3 result = mix(src.rgb, fc, uShowOriginal);
    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`;

// ============================================================================
// SHADOW RECOVERY HERO — Lift shadows without crushing highlights.
// ============================================================================
export const shadowRecoveryHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 shadow lift
  uniform float uThreshold;     // 0-1 shadow zone
  uniform float uSoftness;      // 0-1 transition softness
  uniform float uColorRecovery; // 0-1 boost saturation in shadows
  uniform float uHighlightProtect; // 0-1
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    float l = luma(src.rgb);
    // Shadow weight: 1 at black, 0 above threshold (with softness)
    float w = 1.0 - smoothstep(uThreshold, uThreshold + uSoftness + 0.001, l);

    // Lift formula: pull shadows toward midtone using a power curve
    float liftPow = mix(1.0, 0.45, uAmount);
    vec3 lifted = pow(max(src.rgb, 0.0001), vec3(liftPow));

    // Highlight protect — fade lift back near 1.0
    float highW = smoothstep(0.7, 1.0, l);
    float effW = w * (1.0 - highW * uHighlightProtect);
    vec3 result = mix(src.rgb, lifted, effW);

    // Optional color recovery (boost saturation in lifted shadows)
    if (uColorRecovery > 0.001) {
      float rl = luma(result);
      vec3 boosted = mix(vec3(rl), result, 1.0 + uColorRecovery * 0.6);
      result = mix(result, boosted, effW);
    }

    gl_FragColor = vec4(mix(src.rgb, result, uMix), src.a);
  }
`;

// ============================================================================
// HIGHLIGHT ROLLOFF HERO — Soft compression of highlights (filmic shoulder).
// ============================================================================
export const highlightRolloffHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 rolloff strength
  uniform float uThreshold;     // 0-1 where rolloff begins
  uniform float uSoftness;      // 0-1
  uniform float uPreserveHue;   // 0-1 preserve hue while rolling off
  uniform float uMaxValue;      // 0.7-1.5 ceiling for compressed highlights
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 hueAwareRolloff(vec3 src, float threshold, float maxV, float amount) {
    float l = luma(src);
    // Rolloff curve: hyperbolic compress
    float over = max(0.0, l - threshold);
    float compressed = threshold + over / (1.0 + over * (4.0 * amount));
    compressed = min(compressed, maxV);
    float scale = (l > 0.001) ? compressed / l : 1.0;
    return src * scale;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    float l = luma(src.rgb);
    float w = smoothstep(uThreshold - uSoftness, uThreshold + uSoftness * 0.5 + 0.001, l);

    vec3 rolledHue = hueAwareRolloff(src.rgb, uThreshold, uMaxValue, uAmount);
    vec3 rolledRgb = vec3(
      min(src.r, mix(src.r, uThreshold + (src.r - uThreshold) / (1.0 + (src.r - uThreshold) * 4.0 * uAmount), w)),
      min(src.g, mix(src.g, uThreshold + (src.g - uThreshold) / (1.0 + (src.g - uThreshold) * 4.0 * uAmount), w)),
      min(src.b, mix(src.b, uThreshold + (src.b - uThreshold) / (1.0 + (src.b - uThreshold) * 4.0 * uAmount), w))
    );
    vec3 result = mix(rolledRgb, rolledHue, uPreserveHue);

    gl_FragColor = vec4(mix(src.rgb, result, uMix * w), src.a);
  }
`;

// ============================================================================
// ASCII HERO — Cell quantization with character-density mapping.
// ============================================================================
export const asciiHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uCellSize;      // 4-32 px
  uniform float uContrast;      // 0-2
  uniform float uColorMix;      // 0-1 keep colour
  uniform float uMode;          // 0=density, 1=stipple, 2=block, 3=line
  uniform float uInvert;        // 0/1
  uniform float uTintR;         // 0-1
  uniform float uTintG;
  uniform float uTintB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Approximate ASCII density via geometric primitives
  float charShape(vec2 cellUv, float density, int mode) {
    vec2 cu = cellUv - 0.5;
    float r = length(cu);
    if (mode == 0) {
      // Density: ramp through circle/dot/cross/dense
      if (density < 0.1) return 0.0; // .
      if (density < 0.25) return smoothstep(0.45, 0.35, r); // ·
      if (density < 0.45) return smoothstep(0.35, 0.25, r); // o
      if (density < 0.65) return max(smoothstep(0.05, 0.0, abs(cu.x)), smoothstep(0.05, 0.0, abs(cu.y))); // +
      if (density < 0.85) return smoothstep(0.45, 0.0, abs(cu.x) + abs(cu.y) - 0.4); // #
      return 1.0; // @
    } else if (mode == 1) {
      // Stipple: random dots scaled by density
      float h = hash21(floor(cellUv * 8.0));
      return step(1.0 - density, h);
    } else if (mode == 2) {
      // Solid block proportional to density
      return step(1.0 - density, 1.0);
    } else {
      // Line/diagonal hatching
      float ang = density * 3.14;
      float v = abs(sin((cu.x * cos(ang) + cu.y * sin(ang)) * 12.0));
      return step(1.0 - density, v);
    }
  }

  void main() {
    vec2 cell = floor(vUv * uResolution / uCellSize);
    vec2 cellOrigin = cell * uCellSize / uResolution;
    vec2 cellSize = vec2(uCellSize) / uResolution;
    vec2 cellUv = (vUv - cellOrigin) / cellSize;

    vec3 sampleCol = texture2D(uTexture, cellOrigin + cellSize * 0.5).rgb;
    float l = luma(sampleCol);
    if (uInvert > 0.5) l = 1.0 - l;
    l = clamp((l - 0.5) * uContrast + 0.5, 0.0, 1.0);

    float v = charShape(cellUv, l, int(uMode + 0.5));

    vec3 inkColor = mix(vec3(uTintR, uTintG, uTintB), sampleCol, uColorMix);
    vec3 result = vec3(v) * inkColor;
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// COMIC INK HERO — Bold sobel edges + posterize + halftone shadows.
// ============================================================================
export const comicInkHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uInkStrength;   // 0-2
  uniform float uInkThreshold;  // 0-1
  uniform float uPosterize;     // 2-12 levels
  uniform float uHalftoneShadow;// 0-1
  uniform float uHalftoneSize;  // 2-16
  uniform float uColorMix;      // 0-1
  uniform float uInkR;
  uniform float uInkG;
  uniform float uInkB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec3 src = texture2D(uTexture, vUv).rgb;

    // Sobel edges on luma
    float l00 = luma(texture2D(uTexture, vUv + texel * vec2(-1, -1)).rgb);
    float l10 = luma(texture2D(uTexture, vUv + texel * vec2( 0, -1)).rgb);
    float l20 = luma(texture2D(uTexture, vUv + texel * vec2( 1, -1)).rgb);
    float l01 = luma(texture2D(uTexture, vUv + texel * vec2(-1,  0)).rgb);
    float l21 = luma(texture2D(uTexture, vUv + texel * vec2( 1,  0)).rgb);
    float l02 = luma(texture2D(uTexture, vUv + texel * vec2(-1,  1)).rgb);
    float l12 = luma(texture2D(uTexture, vUv + texel * vec2( 0,  1)).rgb);
    float l22 = luma(texture2D(uTexture, vUv + texel * vec2( 1,  1)).rgb);
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float edge = clamp(length(vec2(gx, gy)) * uInkStrength, 0.0, 1.0);
    float ink = step(uInkThreshold, edge);

    // Posterize
    float steps = max(2.0, uPosterize);
    vec3 quant = floor(src * steps + 0.5) / steps;
    vec3 colored = mix(quant, src, uColorMix);

    // Halftone shadow overlay
    if (uHalftoneShadow > 0.001) {
      float l = luma(quant);
      vec2 px = vUv * uResolution / uHalftoneSize;
      vec2 cell = fract(px) - 0.5;
      float dot = smoothstep(0.45, 0.4, length(cell)) * (1.0 - l);
      colored *= 1.0 - dot * uHalftoneShadow;
    }

    vec3 result = mix(colored, vec3(uInkR, uInkG, uInkB), ink);
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// DATAMOSH LITE HERO — Block displacement + smear + persistence.
// ============================================================================
export const datamoshLiteHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-1
  uniform float uBlockSize;     // 4-32
  uniform float uSmear;         // 0-1
  uniform float uChannelSplit;  // 0-1
  uniform float uChaos;         // 0-1 random per-block displacement
  uniform float uMode;          // 0=horizontal, 1=any, 2=blocks only
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uIntensity < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    vec2 blockId = floor(vUv * uResolution / uBlockSize);
    float t = floor(uTime * 4.0) / 4.0;
    float h = hash21(blockId + t);

    // Trigger chance based on intensity and chaos
    float trigger = step(1.0 - uIntensity * 0.6, h);
    vec2 disp = vec2(0.0);
    if (trigger > 0.5) {
      float angle = (mode == 1) ? hash21(blockId + 17.3) * 6.28 : 0.0;
      vec2 dir = (mode == 0) ? vec2(1.0, 0.0) : vec2(cos(angle), sin(angle));
      disp = dir * (h - 0.5) * uSmear * 0.3;
      // Chaos: snap to random direction
      if (uChaos > 0.001) {
        float ch = hash21(blockId + 71.3);
        disp += vec2(ch - 0.5, hash21(blockId + 27.5) - 0.5) * uChaos * 0.15;
      }
    }

    vec3 col;
    if (uChannelSplit > 0.001 && trigger > 0.5) {
      float r = texture2D(uTexture, vUv + disp * (1.0 + uChannelSplit * 0.4)).r;
      float g = texture2D(uTexture, vUv + disp).g;
      float b = texture2D(uTexture, vUv + disp * (1.0 - uChannelSplit * 0.4)).b;
      col = vec3(r, g, b);
    } else if (mode == 2 && trigger < 0.5) {
      // Blocks-only mode: keep source
      col = src.rgb;
    } else {
      col = texture2D(uTexture, vUv + disp).rgb;
    }
    gl_FragColor = vec4(col, src.a);
  }
`;

// ============================================================================
// SCANLINE DRIFT HERO — Per-row horizontal jitter (VHS tape skew).
// ============================================================================
export const scanlineDriftHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-1
  uniform float uFrequency;     // 1-200 line frequency
  uniform float uSpeed;         // 0-3
  uniform float uWaveform;      // 0=sin, 1=noise, 2=sawtooth
  uniform float uChromaSplit;   // 0-1
  uniform float uChunkiness;    // 0-1 hold for N rows
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash11(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    if (uIntensity < 0.001) { gl_FragColor = texture2D(uTexture, vUv); return; }

    int wf = int(uWaveform + 0.5);
    float yLine = vUv.y;
    if (uChunkiness > 0.001) {
      float chunk = mix(1.0, 32.0, uChunkiness);
      yLine = floor(vUv.y * uResolution.y / chunk) * chunk / uResolution.y;
    }
    float t = uTime * uSpeed;
    float drift;
    if (wf == 0) drift = sin(yLine * uFrequency + t);
    else if (wf == 1) drift = (hash11(floor(yLine * uFrequency) + floor(t * 8.0)) - 0.5) * 2.0;
    else drift = mod(yLine * uFrequency + t, 1.0) * 2.0 - 1.0;
    drift *= uIntensity * 0.05;

    vec3 col;
    if (uChromaSplit > 0.001) {
      float r = texture2D(uTexture, vec2(vUv.x + drift * (1.0 + uChromaSplit * 0.3), vUv.y)).r;
      float g = texture2D(uTexture, vec2(vUv.x + drift, vUv.y)).g;
      float b = texture2D(uTexture, vec2(vUv.x + drift * (1.0 - uChromaSplit * 0.3), vUv.y)).b;
      col = vec3(r, g, b);
    } else {
      col = texture2D(uTexture, vec2(vUv.x + drift, vUv.y)).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ============================================================================
// TAPE DROPOUT HERO — Random horizontal noise stripes (broken VHS).
// ============================================================================
export const tapeDropoutHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uLength;        // 0-1 stripe length
  uniform float uColor;         // 0=white, 1=mono, 2=glitch hue
  uniform float uSpeed;         // 0-3
  uniform float uNoiseAmp;      // 0-1
  uniform float uMix;           // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uDensity < 0.001) { gl_FragColor = src; return; }

    float t = floor(uTime * uSpeed * 8.0) / 8.0;
    float yBucket = floor(vUv.y * 80.0);
    float trigger = hash21(vec2(yBucket, t));
    float lenH = hash21(vec2(yBucket + 13.0, t));
    float startX = hash21(vec2(yBucket + 27.0, t));
    float length = uLength * mix(0.05, 0.5, lenH);

    float inStripe = step(1.0 - uDensity * 0.4, trigger)
                   * step(startX, vUv.x)
                   * step(vUv.x, startX + length);

    if (inStripe < 0.5) { gl_FragColor = src; return; }

    int colorMode = int(uColor + 0.5);
    float n = hash21(vec2(vUv.x * uResolution.x, t * 100.0));
    vec3 stripe;
    if (colorMode == 0) stripe = vec3(n);
    else if (colorMode == 1) stripe = vec3(n * 0.6 + 0.2);
    else {
      float hue = hash21(vec2(yBucket, t * 13.0));
      stripe = mix(vec3(1, 0, 0.4), vec3(0, 1, 0.6), hue);
      stripe = mix(stripe, vec3(0.4, 0.4, 1), n);
    }
    stripe = mix(stripe, src.rgb, 1.0 - uNoiseAmp);

    gl_FragColor = vec4(mix(src.rgb, stripe, uMix * inStripe), src.a);
  }
`;

// ============================================================================
// RIPPLE CAUSTICS HERO — Animated caustic ripples (water/pool light).
// ============================================================================
export const rippleCausticsHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uScale;         // 1-32
  uniform float uSpeed;         // 0-3
  uniform float uRefraction;    // 0-1 distort source
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uMode;          // 0=overlay, 1=add, 2=screen
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  // Caustic via Voronoi ridge
  float caustic(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float minD1 = 9.0; float minD2 = 9.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(
          fract(sin(dot(i + g, vec2(127.1, 311.7))) * 43758.5453),
          fract(sin(dot(i + g, vec2(269.5, 183.3))) * 43758.5453)
        );
        o = 0.5 + 0.5 * sin(t + 6.28 * o);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < minD1) { minD2 = minD1; minD1 = d; }
        else if (d < minD2) minD2 = d;
      }
    }
    return sqrt(minD2) - sqrt(minD1);
  }

  void main() {
    vec2 p = vUv * uScale;
    float t = uTime * uSpeed;
    float c1 = caustic(p, t);
    float c2 = caustic(p + 17.3, t * 1.3 + 1.7);
    float c = pow(min(c1, c2), 1.5) * uIntensity;

    vec2 sUv = vUv;
    if (uRefraction > 0.001) {
      sUv += vec2(c1 - c2, c2 - c1) * uRefraction * 0.04;
    }
    vec3 src = texture2D(uTexture, sUv).rgb;

    vec3 caustColor = vec3(uTintR, uTintG, uTintB) * c;
    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = src + caustColor;
    else if (mode == 1) result = src + caustColor * 1.5;
    else result = 1.0 - (1.0 - src) * (1.0 - caustColor);

    gl_FragColor = vec4(result, texture2D(uTexture, vUv).a);
  }
`;

// ============================================================================
// SHOCKWAVE HERO — Expanding ring of distortion.
// ============================================================================
export const shockwaveHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTriggerTime;   // time when wave was triggered
  uniform float uSpeed;         // 0.1-3 expansion speed
  uniform float uAmplitude;     // 0-0.2 distortion strength
  uniform float uRingWidth;     // 0.01-0.5
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uChromatic;     // 0-1
  uniform float uMode;          // 0=looping continuous, 1=one-shot
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 shockOffset(vec2 uv, float waveTime) {
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float ringR = waveTime * uSpeed;
    float band = smoothstep(uRingWidth * 0.5, 0.0, abs(r - ringR));
    vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
    dir.x *= uResolution.y / uResolution.x;
    return dir * band * uAmplitude;
  }

  void main() {
    int mode = int(uMode + 0.5);
    float waveTime;
    if (mode == 0) {
      // Looping
      waveTime = mod(uTime, 2.0 / max(0.1, uSpeed));
    } else {
      // One-shot
      waveTime = max(0.0, uTime - uTriggerTime);
    }

    vec2 baseOff = shockOffset(vUv, waveTime);
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 offR = shockOffset(vUv, waveTime + 0.05 * uChromatic);
      vec2 offB = shockOffset(vUv, waveTime - 0.05 * uChromatic);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ============================================================================
// DROSTE RECURSIVE HERO — Recursive zoom/rotate within self (pic-in-pic).
// ============================================================================
export const drosteHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uZoom;          // 1.05-3 per-iteration zoom
  uniform float uRotation;      // 0-360 per-iteration rotation
  uniform float uIterations;    // 1-12
  uniform float uOffsetX;       // 0-1
  uniform float uOffsetY;       // 0-1
  uniform float uFrameSize;     // 0-0.5 mask region as fraction of screen
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 c = vec2(uOffsetX, uOffsetY);
    int iters = int(clamp(uIterations, 1.0, 12.0));
    vec2 uv = vUv;
    float ang = radians(uRotation);

    // Iteratively zoom toward c by uZoom each time, until uv falls in frame mask
    for (int i = 0; i < 12; i++) {
      if (i >= iters) break;
      vec2 d = uv - c;
      float r = length(d - 0.5 + c);
      // If outside frame band, zoom in further
      if (r > uFrameSize) {
        d *= uZoom;
        // Rotate
        float ca = cos(ang), sa = sin(ang);
        d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
        uv = c + d;
      }
    }
    uv = clamp(uv, vec2(0.0), vec2(1.0));
    vec4 src = texture2D(uTexture, vUv);
    vec4 droste = texture2D(uTexture, uv);
    gl_FragColor = vec4(mix(src.rgb, droste.rgb, uMix), src.a);
  }
`;

// ============================================================================
// SLIT SCAN HERO — Per-row time offset (analog/CCD slit-scan style).
// ============================================================================
export const slitScanHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-1 displacement amount
  uniform float uMode;          // 0=horizontal slits, 1=vertical, 2=radial, 3=stretch
  uniform float uPattern;       // 0=linear sweep, 1=sine, 2=noise
  uniform float uSpeed;         // 0-3
  uniform float uChromaSplit;   // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash11(float n) { return fract(sin(n) * 43758.5453); }

  vec2 slitOffset(vec2 uv, float phaseShift) {
    int mode = int(uMode + 0.5);
    int pattern = int(uPattern + 0.5);
    float coord = (mode == 1) ? uv.x : uv.y;
    float t = uTime * uSpeed + phaseShift;
    float p;
    if (pattern == 0) p = coord + t * 0.3;
    else if (pattern == 1) p = sin(coord * 8.0 + t * 2.0);
    else p = (hash11(floor(coord * 50.0) + floor(t * 8.0)) - 0.5) * 2.0;
    vec2 off = vec2(0.0);
    if (mode == 0) off.x = p * uIntensity * 0.3;
    else if (mode == 1) off.y = p * uIntensity * 0.3;
    else if (mode == 2) {
      vec2 d = uv - 0.5;
      float r = length(d);
      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);
      off = dir * p * uIntensity * 0.3;
    } else {
      // Stretch: each row sampled at different progressive UV
      off.x = (uv.y - 0.5) * uIntensity * 0.5;
      off.y = sin(t + uv.x * 6.28) * uIntensity * 0.1;
    }
    return off;
  }

  void main() {
    vec2 baseOff = slitOffset(vUv, 0.0);
    vec3 col;
    if (uChromaSplit > 0.001) {
      vec2 offR = slitOffset(vUv, 0.3 * uChromaSplit);
      vec2 offB = slitOffset(vUv, -0.3 * uChromaSplit);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ============================================================================
// VOLUMETRIC FOG OVERLAY HERO — Animated fog/mist overlay with depth.
// ============================================================================
export const volumetricFogHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uScale;         // 1-32
  uniform float uSpeed;         // 0-2
  uniform float uHeightFalloff; // -1..1 (positive=sky fog, negative=ground fog)
  uniform float uDepthSim;      // 0-1 (use luma as fake depth)
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uTurbulence;    // 0-1
  uniform float uMode;          // 0=add, 1=mix, 2=subtract
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uDensity < 0.001) { gl_FragColor = src; return; }

    vec2 p = vUv * uScale + vec2(uTime * uSpeed * 0.1, -uTime * uSpeed * 0.05);
    float fog = uTurbulence > 0.5 ? fbm(p) : vnoise(p);
    fog *= uDensity;

    // Height falloff
    float heightW = mix(1.0 - vUv.y, vUv.y, (uHeightFalloff + 1.0) * 0.5);
    fog *= heightW;

    // Depth-aware: brighter pixels = farther in fog (sim depth from luma)
    if (uDepthSim > 0.001) {
      float fakeDepth = 1.0 - luma(src.rgb);
      fog *= mix(1.0, fakeDepth, uDepthSim);
    }

    fog = clamp(fog, 0.0, 1.0);
    vec3 fogColor = vec3(uColorR, uColorG, uColorB);

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = src.rgb + fogColor * fog;
    else if (mode == 1) result = mix(src.rgb, fogColor, fog);
    else result = src.rgb - fogColor * fog * 0.5;

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// RAIN/FOG/SNOW OVERLAY HERO — Animated weather particles + fog wash.
// ============================================================================
export const rainFogSnowHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uType;          // 0=rain, 1=snow, 2=mist, 3=embers
  uniform float uDensity;       // 0-1
  uniform float uSpeed;         // 0-3
  uniform float uAngle;         // -45..45 degrees wind
  uniform float uSize;          // 0.5-3 particle size
  uniform float uFogAmount;     // 0-1 fog wash
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    int type = int(uType + 0.5);

    vec2 wind = vec2(sin(radians(uAngle)), -cos(radians(uAngle))); // base downward
    if (type == 2) wind *= 0.3; // mist drifts
    if (type == 3) wind *= -0.6; // embers rise

    float t = uTime * uSpeed;
    float scale = (type == 1) ? 80.0 : (type == 2) ? 30.0 : (type == 3) ? 90.0 : 120.0;
    scale *= 1.0 / max(0.5, uSize);

    vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * scale;
    vec2 cellId = floor(p);
    float lifeTime = hash21(cellId) * 10.0;
    float phase = mod(t * 0.5 + lifeTime, 1.0);

    // Particle position within cell, drifted by wind
    vec2 cellUv = fract(p) - 0.5;
    cellUv -= wind * phase * 1.5;
    cellUv = vec2(cellUv.x, fract(cellUv.y + 0.5) - 0.5);

    float d = length(cellUv);
    float particle = 0.0;

    if (type == 0) {
      // Rain — vertical streak
      float streak = smoothstep(0.05, 0.0, abs(cellUv.x)) * smoothstep(0.5, 0.0, abs(cellUv.y));
      particle = streak;
    } else if (type == 1) {
      // Snow — soft circle
      particle = smoothstep(0.15, 0.0, d);
    } else if (type == 2) {
      // Mist — large soft puff
      particle = smoothstep(0.3, 0.0, d) * 0.5;
    } else {
      // Embers — bright dot with glow
      particle = smoothstep(0.05, 0.0, d) + smoothstep(0.2, 0.05, d) * 0.3;
    }

    // Spawn probability gated by density
    float spawn = step(1.0 - uDensity, hash21(cellId + 17.0));
    particle *= spawn;

    vec3 partColor = vec3(uColorR, uColorG, uColorB);
    vec3 result = src.rgb + partColor * particle;

    // Fog wash
    if (uFogAmount > 0.001) {
      result = mix(result, partColor * 0.5, uFogAmount * 0.4);
    }
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// PARTICLE OVERLAY FX HERO — Generic procedural particle field overlay.
// ============================================================================
export const particleOverlayHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=stars, 1=bokeh, 2=sparkles, 3=fireflies, 4=dust
  uniform float uDensity;       // 0-1
  uniform float uSize;          // 0.5-4
  uniform float uSpeed;         // 0-3
  uniform float uTwinkle;       // 0-1
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uBlend;         // 0=add, 1=screen
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uDensity < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    float scale = (mode == 0) ? 60.0 : (mode == 1) ? 25.0 : (mode == 2) ? 80.0 : (mode == 3) ? 35.0 : 100.0;
    scale *= 1.0 / max(0.5, uSize);
    vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * scale;
    vec2 cellId = floor(p);
    vec2 cellUv = fract(p) - 0.5;

    float spawn = step(1.0 - uDensity, hash21(cellId));
    if (spawn < 0.5) { gl_FragColor = src; return; }

    // Drift
    float t = uTime * uSpeed;
    vec2 drift = vec2(
      hash21(cellId + 7.3) - 0.5,
      hash21(cellId + 13.7) - 0.5
    ) * t * 0.05;
    cellUv -= drift;

    float d = length(cellUv);
    float particle = 0.0;
    if (mode == 0) {
      // Stars — small bright dot + cross flare
      particle = smoothstep(0.05, 0.0, d);
      particle += smoothstep(0.02, 0.0, abs(cellUv.x)) * smoothstep(0.3, 0.0, abs(cellUv.y)) * 0.5;
      particle += smoothstep(0.02, 0.0, abs(cellUv.y)) * smoothstep(0.3, 0.0, abs(cellUv.x)) * 0.5;
    } else if (mode == 1) {
      // Bokeh — soft disc
      particle = smoothstep(0.4, 0.1, d) * 0.6 + smoothstep(0.45, 0.4, d) * 0.4;
    } else if (mode == 2) {
      // Sparkles — bright pinpoint
      particle = smoothstep(0.04, 0.0, d) * 1.5;
    } else if (mode == 3) {
      // Fireflies — flickering soft glow
      particle = smoothstep(0.15, 0.0, d) * 0.8;
    } else {
      // Dust — many tiny specks
      particle = smoothstep(0.025, 0.0, d) * 0.6;
    }

    // Twinkle
    if (uTwinkle > 0.001) {
      float blink = sin(t * 4.0 + hash21(cellId) * 6.28) * 0.5 + 0.5;
      particle *= mix(1.0, blink, uTwinkle);
    }

    vec3 partColor = vec3(uColorR, uColorG, uColorB);
    int blendMode = int(uBlend + 0.5);
    vec3 result;
    if (blendMode == 0) {
      result = src.rgb + partColor * particle;
    } else {
      result = 1.0 - (1.0 - src.rgb) * (1.0 - partColor * particle);
    }
    gl_FragColor = vec4(result, src.a);
  }
`;

// ============================================================================
// GLINT STARBURST HERO — Star/cross flares on highlights.
// ============================================================================
export const glintStarburstHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uThreshold;     // 0-1
  uniform float uLength;        // 0-1
  uniform float uPoints;        // 4-12 star points
  uniform float uRotation;      // 0-360
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uIntensity < 0.001) { gl_FragColor = src; return; }

    int points = int(clamp(uPoints, 2.0, 12.0)) * 2;
    float maxLen = uLength * 0.15;
    vec2 texel = 1.0 / uResolution;

    vec3 burst = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      if (i >= points) break;
      float ang = radians(uRotation) + float(i) * 6.28318 / float(points);
      vec2 dir = vec2(cos(ang), sin(ang));
      // March along ray
      for (int s = 1; s <= 12; s++) {
        float t = float(s) / 12.0;
        vec2 sp = vUv + dir * maxLen * t;
        vec3 sc = texture2D(uTexture, sp).rgb;
        float gate = smoothstep(uThreshold, uThreshold + 0.15, luma(sc));
        burst += sc * gate * (1.0 - t) * (1.0 - t);
      }
    }
    burst /= float(points);
    burst *= uIntensity * vec3(uColorR, uColorG, uColorB);

    vec3 result = 1.0 - (1.0 - src.rgb) * (1.0 - burst);
    gl_FragColor = vec4(result, src.a);
  }
`;

// ============================================================================
// EMBOSS RELIGHT HERO — Detail-enhanced emboss using high-frequency map.
// ============================================================================
export const embossRelightHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uStrength;      // 0-3
  uniform float uAngle;         // 0-360
  uniform float uHeight;        // 0-4
  uniform float uDetail;        // 0-2 sample radius
  uniform float uSpecular;      // 0-1
  uniform float uColorPreserve; // 0-1
  uniform float uAmbient;       // 0-1 base brightness
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 texel = 1.0 / uResolution;
    float d = max(1.0, uDetail);

    // Build height field from high-pass filter
    vec3 c = texture2D(uTexture, vUv).rgb;
    vec3 ll = texture2D(uTexture, vUv + texel * vec2(-d, 0)).rgb;
    vec3 rr = texture2D(uTexture, vUv + texel * vec2( d, 0)).rgb;
    vec3 tt = texture2D(uTexture, vUv + texel * vec2( 0, d)).rgb;
    vec3 bb = texture2D(uTexture, vUv + texel * vec2( 0,-d)).rgb;

    float h0 = luma(c);
    float gx = (luma(rr) - luma(ll)) * uHeight;
    float gy = (luma(tt) - luma(bb)) * uHeight;

    // Surface normal
    vec3 N = normalize(vec3(-gx, -gy, 1.0));
    float ang = radians(uAngle);
    vec3 L = normalize(vec3(cos(ang), sin(ang), 0.7));
    float diff = max(0.0, dot(N, L));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(0.0, dot(N, H)), 32.0) * uSpecular;

    float lit = uAmbient + diff * uStrength + spec;
    vec3 surfaceColor = mix(vec3(h0), c, uColorPreserve);
    vec3 result = surfaceColor * lit;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// DOT MATRIX HERO — LED/dot-matrix display.
// ============================================================================
export const dotMatrixHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDotSize;       // 4-32
  uniform float uDotShape;      // 0=circle, 1=square, 2=hex
  uniform float uGap;           // 0-1 gap between dots
  uniform float uPosterize;     // 1-8 quantize per channel
  uniform float uGlow;          // 0-1
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 cell = floor(vUv * uResolution / uDotSize);
    vec2 cellOrigin = cell * uDotSize / uResolution;
    vec2 cellSize = vec2(uDotSize) / uResolution;
    vec2 cellUv = (vUv - cellOrigin) / cellSize - 0.5;

    int shape = int(uDotShape + 0.5);
    float dotR = mix(0.45, 0.5 - uGap * 0.5, 0.5);
    float mask;
    if (shape == 0) {
      mask = smoothstep(dotR + 0.05, dotR - 0.05, length(cellUv));
    } else if (shape == 1) {
      vec2 ad = abs(cellUv);
      mask = smoothstep(dotR + 0.02, dotR - 0.02, max(ad.x, ad.y));
    } else {
      // Hex
      vec2 ad = abs(cellUv);
      float hex = max(ad.x * 0.866 + ad.y * 0.5, ad.y);
      mask = smoothstep(dotR + 0.02, dotR - 0.02, hex);
    }

    vec3 sampleCol = texture2D(uTexture, cellOrigin + cellSize * 0.5).rgb;
    if (uPosterize > 1.001) {
      float steps = max(1.0, uPosterize);
      sampleCol = floor(sampleCol * steps + 0.5) / steps;
    }

    vec3 bg = vec3(uBgR, uBgG, uBgB);
    vec3 result = mix(bg, sampleCol, mask);

    // Glow halo
    if (uGlow > 0.001) {
      float halo = smoothstep(0.7, 0.45, length(cellUv));
      result += sampleCol * halo * uGlow * 0.4;
    }
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// MATRIX RAIN HERO — Falling katakana characters (digital rain).
// ============================================================================
export const matrixRainHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uSpeed;         // 0-3
  uniform float uCellSize;      // 6-32
  uniform float uTrailLength;   // 0-1
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uBgMix;         // 0-1 keep underlying frame
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Fake glyph: bit pattern within sub-grid
  float glyph(vec2 cellUv, float seed) {
    vec2 g = floor(cellUv * 5.0);
    float bit = hash21(g + seed * 13.0);
    return step(0.55, bit);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;

    vec2 px = vUv * uResolution / uCellSize;
    vec2 col = floor(px);
    vec2 cellUv = fract(px);
    // Column-specific speed and seed
    float colSeed = hash21(vec2(col.x, 0.0));
    float fallSpeed = (0.5 + colSeed * 1.5) * uSpeed;
    float trailHead = mod(uTime * fallSpeed - colSeed * 50.0, uResolution.y / uCellSize + 30.0);
    float dist = trailHead - col.y;

    float trailLen = max(2.0, uTrailLength * 30.0);
    float intensity = 0.0;
    if (dist > 0.0 && dist < trailLen) {
      intensity = (1.0 - dist / trailLen);
      intensity *= step(1.0 - uDensity, hash21(col + floor(uTime * fallSpeed * 0.05)));
    }
    if (dist >= 0.0 && dist < 1.0) intensity = 1.5; // bright head

    // Glyph mask (changes over time for rain feel)
    float glyphSeed = hash21(col + floor(uTime * fallSpeed * 0.5 + col.y * 0.1));
    float gMask = glyph(cellUv, glyphSeed);

    vec3 rainColor = vec3(uColorR, uColorG, uColorB) * intensity * gMask;
    vec3 result = mix(rainColor, src + rainColor, uBgMix);
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// BINARY CODE HERO — Falling 0s and 1s (data terminal).
// ============================================================================
export const binaryCodeHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uSpeed;         // 0-3
  uniform float uCellSize;      // 6-32
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uBgMix;         // 0-1
  uniform float uContrast;      // 0-2 source pixel modulates char visibility
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  // Crude '0' / '1' mask
  float charZero(vec2 uv) {
    vec2 c = uv - 0.5;
    float r = length(c * vec2(1.0, 0.7));
    return smoothstep(0.42, 0.38, r) - smoothstep(0.30, 0.26, r);
  }
  float charOne(vec2 uv) {
    vec2 c = uv - 0.5;
    float bar = step(abs(c.x + 0.05), 0.05) * step(abs(c.y), 0.4);
    float foot = step(abs(c.y + 0.4), 0.05) * step(abs(c.x), 0.2);
    return max(bar, foot);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 px = vUv * uResolution / uCellSize;
    vec2 col = floor(px);
    vec2 cellUv = fract(px);
    float t = uTime * uSpeed;
    // Each column scrolls up at its own speed
    float colSeed = hash21(vec2(col.x, 0.0));
    float yOff = floor(t + colSeed * 50.0);
    float charSeed = hash21(vec2(col.x, col.y + yOff));
    float bit = step(0.5, charSeed);

    float charMask = bit > 0.5 ? charOne(cellUv) : charZero(cellUv);
    float spawn = step(1.0 - uDensity, hash21(col + yOff * 0.137));
    charMask *= spawn;
    // Tie character brightness to underlying source luma
    float srcL = luma(texture2D(uTexture, (col + 0.5) * uCellSize / uResolution).rgb);
    charMask *= mix(1.0, srcL, uContrast * 0.5);

    vec3 charColor = vec3(uColorR, uColorG, uColorB) * charMask;
    vec3 result = mix(charColor, src + charColor, uBgMix);
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// CROSSHATCH HERO — Pencil-style cross-hatching with 4 luma zones.
// ============================================================================
export const crosshatchHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDensity;       // 0-1
  uniform float uAngle;         // 0-180
  uniform float uLineWidth;     // 0.5-4
  uniform float uContrast;      // 0-2
  uniform float uPaperR;
  uniform float uPaperG;
  uniform float uPaperB;
  uniform float uInkR;
  uniform float uInkG;
  uniform float uInkB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  float hatchLine(vec2 uv, float ang, float spacing, float width) {
    float c = cos(ang); float s = sin(ang);
    float v = uv.x * c + uv.y * s;
    return smoothstep(width, width * 0.5, abs(fract(v / spacing) - 0.5));
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float l = luma(src);
    l = clamp((l - 0.5) * uContrast + 0.5, 0.0, 1.0);

    vec2 px = vUv * uResolution;
    float spacing = 8.0 / uDensity;
    float w = 0.5 / spacing * max(0.5, uLineWidth);
    float baseAng = radians(uAngle);

    // Build cross-hatching
    float h = 0.0;
    if (l < 0.85) h = max(h, hatchLine(px, baseAng,            spacing,       w));
    if (l < 0.65) h = max(h, hatchLine(px, baseAng + 1.5708,   spacing * 0.9, w));
    if (l < 0.45) h = max(h, hatchLine(px, baseAng + 0.7854,   spacing * 0.8, w));
    if (l < 0.25) h = max(h, hatchLine(px, baseAng + 2.3562,   spacing * 0.7, w));

    vec3 paper = vec3(uPaperR, uPaperG, uPaperB);
    vec3 ink = vec3(uInkR, uInkG, uInkB);
    vec3 result = mix(paper, ink, h);
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// BLOCK MOSAIC HERO — Voronoi/grid mosaic tiles with grout.
// ============================================================================
export const blockMosaicHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTileSize;      // 8-64
  uniform float uMode;          // 0=square, 1=voronoi, 2=hex, 3=brick
  uniform float uGrout;         // 0-1
  uniform float uColorJitter;   // 0-1
  uniform float uGroutR;
  uniform float uGroutG;
  uniform float uGroutB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    int mode = int(uMode + 0.5);
    vec2 px = vUv * uResolution / uTileSize;
    vec2 cell;
    vec2 cellUv;
    if (mode == 0) {
      cell = floor(px);
      cellUv = fract(px) - 0.5;
    } else if (mode == 1) {
      vec2 i = floor(px);
      vec2 f = fract(px);
      vec2 best = vec2(0.0);
      float minD = 9.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash21(i + g), hash21(i + g + 13.7));
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < minD) { minD = d; best = i + g; cellUv = r; }
        }
      }
      cell = best;
    } else if (mode == 2) {
      // Hex
      vec2 q = vec2(px.x * 1.1547, px.y);
      q.x += 0.5 * floor(q.y);
      vec2 i = floor(q);
      cell = vec2(i.x - floor(i.y / 2.0), i.y);
      cellUv = fract(q) - 0.5;
    } else {
      // Brick
      vec2 q = px;
      float row = floor(q.y);
      q.x += mod(row, 2.0) * 0.5;
      cell = vec2(floor(q.x), row);
      cellUv = fract(q) - 0.5;
    }

    vec2 cellCenter = (cell + 0.5) * uTileSize / uResolution;
    vec3 tileCol = texture2D(uTexture, cellCenter).rgb;

    // Grout band
    float dist = (mode == 1) ? sqrt(length(cellUv)) : max(abs(cellUv.x), abs(cellUv.y));
    float grout = step(0.5 - uGrout * 0.5, dist);

    // Color jitter
    if (uColorJitter > 0.001) {
      vec3 j = vec3(hash21(cell), hash21(cell + 7.3), hash21(cell + 13.7)) - 0.5;
      tileCol += j * uColorJitter * 0.4;
    }
    vec3 groutCol = vec3(uGroutR, uGroutG, uGroutB);
    vec3 result = mix(tileCol, groutCol, grout);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// TUNNEL FLIGHT HERO — Hyperspace tunnel zoom with rotating walls.
// ============================================================================
export const tunnelFlightHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSpeed;         // 0-3
  uniform float uTwist;         // 0-3
  uniform float uTunnelDepth;   // 0.5-3
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uMode;          // 0=cylinder, 1=funnel, 2=square
  uniform float uChromatic;     // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 tunnelMap(vec2 uv, float zOffset) {
    int mode = int(uMode + 0.5);
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float a = atan(d.y, d.x);
    a += uTwist * (uTime * uSpeed * 0.5);
    float depthScale = (mode == 1) ? r * uTunnelDepth : uTunnelDepth;
    float z = (uTime * uSpeed + zOffset) / max(0.05, r * depthScale);
    if (mode == 2) {
      // Square cross-section
      vec2 sq = abs(d);
      float side = max(sq.x, sq.y);
      r = side;
      z = (uTime * uSpeed + zOffset) / max(0.05, r);
    }
    vec2 sUv = vec2(a / 6.28318 + 0.5, fract(z));
    return sUv;
  }

  void main() {
    vec2 baseUv = tunnelMap(vUv, 0.0);
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 uvR = tunnelMap(vUv, 0.05 * uChromatic);
      vec2 uvB = tunnelMap(vUv, -0.05 * uChromatic);
      col.r = texture2D(uTexture, uvR).r;
      col.g = texture2D(uTexture, baseUv).g;
      col.b = texture2D(uTexture, uvB).b;
    } else {
      col = texture2D(uTexture, baseUv).rgb;
    }
    // Darken at far end
    vec2 c = vec2(uCenterX, uCenterY);
    float r = length(vUv - c);
    float fade = smoothstep(0.0, 0.7, r);
    col *= fade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================================
// INFINITE MIRROR HERO — Recursive UV reflection (room-of-mirrors).
// ============================================================================
export const infiniteMirrorHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIterations;    // 1-12
  uniform float uShrink;        // 0.5-0.95 per-iter shrink
  uniform float uRotation;      // 0-360 per-iter
  uniform float uTintFade;      // 0-1
  uniform float uHueShift;      // 0-1 per-iter
  uniform float uMode;          // 0=center, 1=offset
  uniform float uOffsetX;
  uniform float uOffsetY;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    int iters = int(clamp(uIterations, 1.0, 12.0));
    int mode = int(uMode + 0.5);
    vec2 c = (mode == 1) ? vec2(uOffsetX, uOffsetY) : vec2(0.5);
    vec3 acc = vec3(0.0);
    float weight = 0.0;
    float ang = radians(uRotation);
    float ca = cos(ang), sa = sin(ang);
    float scale = 1.0;
    float hueOff = 0.0;
    float tint = 1.0;

    for (int i = 0; i < 12; i++) {
      if (i >= iters) break;
      vec2 d = (vUv - c) / scale;
      d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      vec2 sUv = c + d;
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));
      vec3 sCol = texture2D(uTexture, sUv).rgb;
      if (uHueShift > 0.001) {
        vec3 hsv = rgb2hsv(sCol);
        hsv.x = fract(hsv.x + hueOff);
        sCol = hsv2rgb(hsv);
      }
      acc += sCol * tint;
      weight += tint;
      scale *= uShrink;
      hueOff += uHueShift;
      tint *= 1.0 - uTintFade * 0.5;
    }
    vec3 result = acc / max(weight, 0.0001);
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// FRACTAL WARP HERO — Domain-warp via fbm noise displacement.
// ============================================================================
export const fractalWarpHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1
  uniform float uScale;         // 0.5-16
  uniform float uOctaves;       // 2-6
  uniform float uSpeed;         // 0-3
  uniform float uChromatic;     // 0-1
  uniform float uMode;          // 0=fbm, 1=ridged, 2=hybrid
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p, int oct) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      v += vnoise(p) * amp; p *= 2.0; amp *= 0.5;
    }
    return v;
  }
  float ridged(vec2 p, int oct) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      v += (1.0 - abs(vnoise(p) - 0.5) * 2.0) * amp; p *= 2.0; amp *= 0.5;
    }
    return v;
  }

  vec2 warpOffset(vec2 uv, float t, float chromaShift) {
    int oct = int(clamp(uOctaves, 1.0, 6.0));
    int mode = int(uMode + 0.5);
    vec2 p = uv * uScale + t + chromaShift;
    float nx, ny;
    if (mode == 0) {
      nx = fbm(p, oct) - 0.5;
      ny = fbm(p + 31.7, oct) - 0.5;
    } else if (mode == 1) {
      nx = ridged(p, oct) - 0.5;
      ny = ridged(p + 31.7, oct) - 0.5;
    } else {
      nx = (fbm(p, oct) + ridged(p, oct)) * 0.5 - 0.5;
      ny = (fbm(p + 31.7, oct) + ridged(p + 31.7, oct)) * 0.5 - 0.5;
    }
    return vec2(nx, ny) * uAmount * 0.1;
  }

  void main() {
    float t = uTime * uSpeed * 0.2;
    vec2 baseOff = warpOffset(vUv, t, 0.0);
    vec3 col;
    if (uChromatic > 0.001) {
      vec2 offR = warpOffset(vUv, t, uChromatic * 0.5);
      vec2 offB = warpOffset(vUv, t, -uChromatic * 0.5);
      col.r = texture2D(uTexture, vUv + offR).r;
      col.g = texture2D(uTexture, vUv + baseOff).g;
      col.b = texture2D(uTexture, vUv + offB).b;
    } else {
      col = texture2D(uTexture, vUv + baseOff).rgb;
    }
    vec4 src = texture2D(uTexture, vUv);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ============================================================================
// CRYSTAL REFRACT HERO — Voronoi-cell faceted refraction (gem-like).
// ============================================================================
export const crystalRefractHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uScale;         // 1-16
  uniform float uRefraction;    // 0-1 displacement
  uniform float uSparkle;       // 0-1
  uniform float uEdgeGlow;      // 0-1
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uMode;          // 0=voronoi, 1=hex
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    int mode = int(uMode + 0.5);
    vec2 p = vUv * uScale;
    vec2 cellCenter; float minD = 9.0; float secondD = 9.0;

    if (mode == 0) {
      vec2 i = floor(p), f = fract(p);
      vec2 best = vec2(0.0);
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash21(i + g), hash21(i + g + 13.7));
          // Slight time wobble
          o = 0.5 + 0.45 * sin(uTime * 0.4 + 6.28 * o);
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < minD) { secondD = minD; minD = d; best = i + g; }
          else if (d < secondD) secondD = d;
        }
      }
      cellCenter = (best + 0.5) / uScale;
    } else {
      // Hex
      vec2 q = vec2(p.x * 1.1547, p.y); q.x += 0.5 * floor(q.y);
      vec2 i = floor(q);
      cellCenter = (vec2(i.x - floor(i.y / 2.0), i.y) + 0.5) / vec2(uScale * 1.1547, uScale);
      vec2 f = fract(q) - 0.5;
      minD = dot(f, f);
      secondD = minD + 0.3;
    }

    // Refraction: displace toward cell center
    vec2 dir = vUv - cellCenter;
    vec2 sUv = vUv - dir * uRefraction;
    sUv = clamp(sUv, vec2(0.0), vec2(1.0));
    vec3 col = texture2D(uTexture, sUv).rgb;

    // Edge glow (where two cells meet)
    float edge = smoothstep(0.04, 0.0, sqrt(secondD) - sqrt(minD));
    col += vec3(uTintR, uTintG, uTintB) * edge * uEdgeGlow;

    // Sparkle: bright dot at random cell centers
    if (uSparkle > 0.001) {
      float dCenter = length(vUv - cellCenter);
      float spark = step(1.0 - uSparkle * 0.3, hash21(floor(cellCenter * 100.0)));
      col += vec3(1.0) * smoothstep(0.04, 0.0, dCenter) * spark * uSparkle;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================================
// FLUID DISTORT HERO — Animated fluid-like UV distortion (curl noise).
// ============================================================================
export const fluidDistortHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1
  uniform float uScale;         // 1-16
  uniform float uSpeed;         // 0-3
  uniform float uTurbulence;    // 0-1
  uniform float uMode;          // 0=swirl, 1=push, 2=oil
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  vec2 curl(vec2 p) {
    float e = 0.05;
    float n1 = vnoise(p + vec2(0, e));
    float n2 = vnoise(p - vec2(0, e));
    float n3 = vnoise(p + vec2(e, 0));
    float n4 = vnoise(p - vec2(e, 0));
    return vec2(n1 - n2, -(n3 - n4));
  }

  void main() {
    vec2 p = vUv * uScale + uTime * uSpeed * 0.1;
    vec2 c = curl(p);
    if (uTurbulence > 0.001) c += curl(p * 2.0 + 13.7) * uTurbulence * 0.5;

    int mode = int(uMode + 0.5);
    vec2 off;
    if (mode == 0) off = c * uAmount * 0.1;
    else if (mode == 1) {
      vec2 d = vUv - 0.5;
      off = (c + normalize(d + 1e-6) * 0.3) * uAmount * 0.08;
    } else {
      // Oil — strong, clamped to range
      off = clamp(c, vec2(-0.5), vec2(0.5)) * uAmount * 0.15;
    }

    vec4 col = texture2D(uTexture, vUv + off);
    gl_FragColor = col;
  }
`;

// ============================================================================
// WORMHOLE HERO — Radial pull-into-center with rotation + chromatic.
// ============================================================================
export const wormholeHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uPullStrength;  // 0-1
  uniform float uRotation;      // 0-3 rotation per radius
  uniform float uCenterX;
  uniform float uCenterY;
  uniform float uTwist;         // 0-3
  uniform float uChromatic;     // 0-1
  uniform float uTime;
  uniform float uAnimSpeed;     // 0-2
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec2 wormholeMap(vec2 uv, float chromaShift) {
    vec2 c = vec2(uCenterX, uCenterY);
    vec2 d = uv - c;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float ang = atan(d.y, d.x);
    // Twist proportional to inverse radius
    ang += uTwist / max(0.05, r) + uTime * uAnimSpeed * 0.3 + chromaShift;
    // Pull toward center
    r *= mix(1.0, 0.5 + 0.5 * (r * r), uPullStrength);
    d = vec2(cos(ang), sin(ang)) * r;
    d.x *= uResolution.y / uResolution.x;
    return c + d;
  }

  void main() {
    vec3 col;
    vec2 baseUv = wormholeMap(vUv, 0.0);
    if (uChromatic > 0.001) {
      vec2 uvR = wormholeMap(vUv, uChromatic * 0.1);
      vec2 uvB = wormholeMap(vUv, -uChromatic * 0.1);
      col.r = texture2D(uTexture, clamp(uvR, vec2(0.0), vec2(1.0))).r;
      col.g = texture2D(uTexture, clamp(baseUv, vec2(0.0), vec2(1.0))).g;
      col.b = texture2D(uTexture, clamp(uvB, vec2(0.0), vec2(1.0))).b;
    } else {
      col = texture2D(uTexture, clamp(baseUv, vec2(0.0), vec2(1.0))).rgb;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================================
// GEOMETRIC TILE HERO — Repeating tile pattern with rotation/mirror options.
// ============================================================================
export const geometricTileHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTiles;         // 1-16
  uniform float uMode;          // 0=mirror, 1=rotate, 2=tile, 3=quilt
  uniform float uRotation;      // 0-360
  uniform float uOffsetX;       // 0-1 per-row offset
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);
    vec2 t = vUv * uTiles;
    vec2 cell = floor(t);
    vec2 cellUv = fract(t);

    if (mode == 0) {
      // Mirror — flip alternating
      if (mod(cell.x, 2.0) > 0.5) cellUv.x = 1.0 - cellUv.x;
      if (mod(cell.y, 2.0) > 0.5) cellUv.y = 1.0 - cellUv.y;
    } else if (mode == 1) {
      // Rotate — alternate cells rotated
      float rot = mod(cell.x + cell.y, 2.0) * radians(uRotation);
      vec2 d = cellUv - 0.5;
      float c = cos(rot), s = sin(rot);
      cellUv = vec2(d.x * c - d.y * s, d.x * s + d.y * c) + 0.5;
    } else if (mode == 2) {
      // Tile — straight repeat with row offset
      cellUv.x += mod(cell.y, 2.0) * uOffsetX;
      cellUv = fract(cellUv);
    } else {
      // Quilt — mix of mirror + rotate
      if (mod(cell.x, 2.0) > 0.5) cellUv.x = 1.0 - cellUv.x;
      float rot = mod(cell.y, 2.0) * radians(uRotation);
      vec2 d = cellUv - 0.5;
      float c = cos(rot), s = sin(rot);
      cellUv = vec2(d.x * c - d.y * s, d.x * s + d.y * c) + 0.5;
    }
    cellUv = clamp(cellUv, vec2(0.0), vec2(1.0));
    vec4 src = texture2D(uTexture, vUv);
    vec4 tiled = texture2D(uTexture, cellUv);
    gl_FragColor = vec4(mix(src.rgb, tiled.rgb, uMix), src.a);
  }
`;

// ============================================================================
// MOTION TRAILS HERO — Procedural directional smear (no history buffer).
// ============================================================================
export const motionTrailsHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uLength;        // 0-1
  uniform float uAngle;         // 0-360
  uniform float uSamples;       // 4-32
  uniform float uFalloff;       // 0-1
  uniform float uChromaSplit;   // 0-1
  uniform float uMode;          // 0=fade, 1=copy
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uLength < 0.001) { gl_FragColor = src; return; }

    int samples = int(clamp(uSamples, 4.0, 32.0));
    float ang = radians(uAngle);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 step = dir * uLength * 0.3;

    vec3 acc = src.rgb;
    float wsum = 1.0;
    for (int i = 1; i <= 32; i++) {
      if (i > samples) break;
      float t = float(i) / float(samples);
      vec2 sUv = vUv + step * t;
      vec3 sCol;
      if (uChromaSplit > 0.001) {
        sCol.r = texture2D(uTexture, sUv + dir * t * uChromaSplit * 0.02).r;
        sCol.g = texture2D(uTexture, sUv).g;
        sCol.b = texture2D(uTexture, sUv - dir * t * uChromaSplit * 0.02).b;
      } else {
        sCol = texture2D(uTexture, sUv).rgb;
      }
      float w = (uMode > 0.5) ? 1.0 : pow(1.0 - t, max(0.5, uFalloff * 4.0));
      acc += sCol * w;
      wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, src.a);
  }
`;

// ============================================================================
// ECHO REPEAT HERO — Discrete copies with offset / opacity.
// ============================================================================
export const echoRepeatHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uCount;         // 1-12
  uniform float uOffsetX;       // -0.5..0.5 per-step
  uniform float uOffsetY;       // -0.5..0.5
  uniform float uDecay;         // 0.5-0.95 per-step
  uniform float uHueShift;      // 0-1
  uniform float uMode;          // 0=add, 1=screen, 2=replace
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    int count = int(clamp(uCount, 1.0, 12.0));
    int mode = int(uMode + 0.5);
    vec3 acc = texture2D(uTexture, vUv).rgb;
    vec2 off = vec2(uOffsetX, uOffsetY);
    float opacity = uDecay;
    float hueOff = uHueShift;

    for (int i = 1; i < 12; i++) {
      if (i >= count) break;
      vec2 sUv = vUv - off * float(i);
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));
      vec3 sCol = texture2D(uTexture, sUv).rgb;
      if (uHueShift > 0.001) {
        vec3 hsv = rgb2hsv(sCol);
        hsv.x = fract(hsv.x + hueOff);
        sCol = hsv2rgb(hsv);
      }
      sCol *= opacity;
      if (mode == 0) acc += sCol;
      else if (mode == 1) acc = 1.0 - (1.0 - acc) * (1.0 - sCol);
      else acc = mix(acc, sCol, opacity);
      opacity *= uDecay;
      hueOff += uHueShift;
    }
    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// GHOST DOUBLE HERO — Two semi-transparent copies (ghost / double exposure).
// ============================================================================
export const ghostDoubleHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uOpacity;       // 0-1
  uniform float uOffsetX;       // -0.3..0.3
  uniform float uOffsetY;       // -0.3..0.3
  uniform float uMirror;        // 0/1 (mirror the ghost)
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uBlend;         // 0=screen, 1=add, 2=multiply
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 ghostUv = vUv - vec2(uOffsetX, uOffsetY);
    if (uMirror > 0.5) ghostUv.x = 1.0 - ghostUv.x;
    ghostUv = clamp(ghostUv, vec2(0.0), vec2(1.0));
    vec3 ghost = texture2D(uTexture, ghostUv).rgb * vec3(uTintR, uTintG, uTintB) * uOpacity;

    int mode = int(uBlend + 0.5);
    vec3 result;
    if (mode == 0) result = 1.0 - (1.0 - src) * (1.0 - ghost);
    else if (mode == 1) result = src + ghost;
    else result = src * (1.0 + ghost);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// STROBE FLASH HERO — Time-gated flash with hold/decay + color tint.
// ============================================================================
export const strobeFlashHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uRate;          // 0.5-30 Hz
  uniform float uDuty;           // 0-1 fraction of cycle bright
  uniform float uIntensity;     // 0-2
  uniform float uMode;          // 0=on/off, 1=invert flash, 2=tint flash
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float phase = mod(uTime * uRate, 1.0);
    float gate = step(phase, uDuty);

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) {
      result = mix(src, src + vec3(uIntensity * gate), gate);
    } else if (mode == 1) {
      result = mix(src, 1.0 - src, gate * uIntensity);
    } else {
      vec3 tint = vec3(uTintR, uTintG, uTintB);
      result = mix(src, src * tint + tint * 0.4, gate * uIntensity);
    }
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// LIGHT PAINT HERO — Long-exposure light streak simulation (procedural).
// ============================================================================
export const lightPaintHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uThreshold;     // 0-1 luma gate
  uniform float uTrailLength;   // 0-1
  uniform float uFlowAngle;     // 0-360 dominant flow direction
  uniform float uFlowScale;     // 1-16 noise warp scale
  uniform float uChromaShift;   // 0-1
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    if (uIntensity < 0.001) { gl_FragColor = vec4(src, 1.0); return; }

    // Build flow direction at this pixel (perturbed by noise)
    float baseAng = radians(uFlowAngle);
    float perturb = (vnoise(vUv * uFlowScale + uTime * 0.3) - 0.5) * 1.6;
    float ang = baseAng + perturb;
    vec2 dir = vec2(cos(ang), sin(ang));

    // March backward along flow accumulating bright pixels
    vec3 acc = src;
    float wsum = 1.0;
    float maxLen = uTrailLength * 0.4;
    for (int i = 1; i <= 24; i++) {
      float t = float(i) / 24.0;
      vec2 sUv = vUv - dir * maxLen * t;
      vec3 sCol;
      if (uChromaShift > 0.001) {
        sCol.r = texture2D(uTexture, sUv + dir * t * uChromaShift * 0.02).r;
        sCol.g = texture2D(uTexture, sUv).g;
        sCol.b = texture2D(uTexture, sUv - dir * t * uChromaShift * 0.02).b;
      } else {
        sCol = texture2D(uTexture, sUv).rgb;
      }
      float gate = smoothstep(uThreshold, uThreshold + 0.15, luma(sCol));
      float w = (1.0 - t) * gate;
      acc += sCol * vec3(uTintR, uTintG, uTintB) * w * uIntensity;
      wsum += w;
    }
    vec3 result = acc / wsum;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// RECURSIVE ECHO HERO — Recursive zoom + offset trail (no history buffer).
// ============================================================================
export const recursiveEchoHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDepth;         // 1-12
  uniform float uZoom;          // 0.85-1.15 per-step zoom factor
  uniform float uRotation;      // 0-360 per-step
  uniform float uOpacity;       // 0-1 per-step decay
  uniform float uHueShift;      // 0-1 per-step
  uniform float uOffsetX;
  uniform float uOffsetY;
  uniform float uMode;          // 0=recursive zoom, 1=mirror echo, 2=spiral
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int depth = int(clamp(uDepth, 1.0, 12.0));
    int mode = int(uMode + 0.5);
    vec3 acc = src;
    float opacity = uOpacity;
    float hueOff = uHueShift;
    vec2 offset = vec2(uOffsetX, uOffsetY);
    float ang = radians(uRotation);
    float ca = cos(ang), sa = sin(ang);
    float scale = uZoom;

    for (int i = 1; i < 12; i++) {
      if (i >= depth) break;
      vec2 c = vec2(0.5);
      vec2 d = (vUv - c) * pow(scale, float(i));
      d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      vec2 sUv = c + d - offset * float(i);
      if (mode == 1) sUv = vec2(1.0 - sUv.x, sUv.y);
      else if (mode == 2) {
        // Spiral: add radial twist
        vec2 dr = sUv - 0.5;
        float r = length(dr);
        float a2 = atan(dr.y, dr.x) + r * float(i) * 0.5;
        sUv = 0.5 + vec2(cos(a2), sin(a2)) * r;
      }
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));
      vec3 sCol = texture2D(uTexture, sUv).rgb;
      if (uHueShift > 0.001) {
        vec3 hsv = rgb2hsv(sCol);
        hsv.x = fract(hsv.x + hueOff);
        sCol = hsv2rgb(hsv);
      }
      acc = mix(acc, sCol, opacity);
      opacity *= uOpacity;
      hueOff += uHueShift;
    }
    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// OPTICAL FLOW DATAMOSH HERO — Frame-difference motion vectors displace prev frame.
// Uses uFeedback (previous frame) sampled via difference-derived flow.
// ============================================================================
export const opticalFlowDatamoshHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uIntensity;     // 0-1
  uniform float uMotionScale;   // 0-2 displacement magnitude
  uniform float uPersistence;   // 0-1 how much old frame survives
  uniform float uChromaSplit;   // 0-1
  uniform float uBlockSize;     // 4-32 motion-block size
  uniform float uFreeze;        // 0-1 freeze + repeat motion (no new I-frames)
  uniform float uMode;          // 0=normal, 1=glitch, 2=smooth
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec2 estimateFlow(vec2 uv) {
    if (uHasFeedback < 0.5) return vec2(0.0);
    vec2 cell = floor(uv * uResolution / uBlockSize);
    vec2 cellOrigin = (cell + 0.5) * uBlockSize / uResolution;
    vec2 texel = 1.0 / uResolution;

    vec3 cur = texture2D(uTexture, cellOrigin).rgb;
    float bestErr = 1e9;
    vec2 bestOff = vec2(0.0);
    // Search 5x5 block grid for best match in feedback frame
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 off = vec2(float(x), float(y)) * texel * uBlockSize * 0.5;
        vec3 prev = texture2D(uFeedback, cellOrigin + off).rgb;
        float err = dot(cur - prev, cur - prev);
        if (err < bestErr) { bestErr = err; bestOff = off; }
      }
    }
    return bestOff;
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    if (uHasFeedback < 0.5 || uIntensity < 0.001) { gl_FragColor = src; return; }

    int mode = int(uMode + 0.5);
    vec2 flow = estimateFlow(vUv) * uMotionScale * (mode == 1 ? 2.0 : 1.0);

    // Sample previous frame at flow-shifted UV
    vec3 prevSampled;
    if (uChromaSplit > 0.001) {
      prevSampled.r = texture2D(uFeedback, vUv + flow * (1.0 + uChromaSplit * 0.4)).r;
      prevSampled.g = texture2D(uFeedback, vUv + flow).g;
      prevSampled.b = texture2D(uFeedback, vUv + flow * (1.0 - uChromaSplit * 0.4)).b;
    } else {
      prevSampled = texture2D(uFeedback, vUv + flow).rgb;
    }

    // Mix: persistence blends old frame; freeze suppresses new frame
    vec3 newFrame = mix(src.rgb, vec3(luma(src.rgb)), uFreeze * 0.4);
    if (uFreeze > 0.001) newFrame = mix(newFrame, prevSampled, uFreeze);

    vec3 result;
    if (mode == 2) {
      // Smooth: time-blend
      result = mix(newFrame, prevSampled, uPersistence);
    } else {
      // Normal/glitch: hard mosh
      result = mix(newFrame, prevSampled, uPersistence * uIntensity);
    }

    gl_FragColor = vec4(result, src.a);
  }
`;

// ============================================================================
// FLOW FIELD TRAILS HERO — UV streaks that follow a curl-noise field.
// ============================================================================
export const flowFieldTrailsHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uFlowScale;     // 0.5-16 noise scale
  uniform float uTrailLength;   // 0-1
  uniform float uSamples;       // 8-64 march steps
  uniform float uSpeed;         // 0-3 anim speed
  uniform float uChromaSplit;   // 0-1
  uniform float uContrast;      // 0-2
  uniform float uMode;          // 0=advect, 1=streak, 2=tendril
  uniform float uColorCycle;    // 0-1 hue rotation along trail
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  vec2 curl(vec2 p, float t) {
    float e = 0.04;
    float n1 = vnoise(p + vec2(0, e) + t);
    float n2 = vnoise(p - vec2(0, e) + t);
    float n3 = vnoise(p + vec2(e, 0) + t);
    float n4 = vnoise(p - vec2(e, 0) + t);
    return vec2(n1 - n2, -(n3 - n4)) * 4.0;
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 src = texture2D(uTexture, vUv);
    int mode = int(uMode + 0.5);
    int samples = int(clamp(uSamples, 4.0, 64.0));
    float t = uTime * uSpeed;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec2 pos = vUv;
    float stepLen = uTrailLength * 0.4 / float(samples);

    for (int i = 0; i < 64; i++) {
      if (i >= samples) break;
      float fi = float(i) / float(samples);
      vec2 v = curl(pos * uFlowScale, t * 0.1);
      if (mode == 1) v *= (1.0 + sin(fi * 6.28) * 0.5);
      else if (mode == 2) v *= (1.0 + cos(t + fi * 3.14) * 0.7);
      pos -= v * stepLen;
      vec3 sCol;
      if (uChromaSplit > 0.001) {
        sCol.r = texture2D(uTexture, pos + v * uChromaSplit * 0.01).r;
        sCol.g = texture2D(uTexture, pos).g;
        sCol.b = texture2D(uTexture, pos - v * uChromaSplit * 0.01).b;
      } else {
        sCol = texture2D(uTexture, pos).rgb;
      }
      // Optional hue cycle
      if (uColorCycle > 0.001) {
        float hueOff = fi * uColorCycle;
        sCol = mix(sCol, hsv2rgb(vec3(fract(hueOff), 1.0, max(max(sCol.r, sCol.g), sCol.b))), uColorCycle * 0.4);
      }
      float w = 1.0 - fi;
      acc += sCol * w;
      wsum += w;
    }
    vec3 result = acc / max(wsum, 0.0001);
    result = (result - 0.5) * uContrast + 0.5;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

// ============================================================================
// REACTION DIFFUSION HERO — Gray-Scott pattern via uFeedback simulation.
// ============================================================================
export const reactionDiffusionHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uFeedRate;      // 0-0.1 (typical 0.055)
  uniform float uKillRate;      // 0-0.1 (typical 0.062)
  uniform float uDiffusionA;    // 0.5-1.5
  uniform float uDiffusionB;    // 0.2-1
  uniform float uPatternScale;  // 0.5-4 size of grid in pattern
  uniform float uLumaMask;      // 0-1 how much source luma drives feed
  uniform float uMode;          // 0=spots, 1=stripes, 2=mitosis, 3=coral
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uMix;
  uniform float uReseed;        // 0-1 sprinkle chemical B at high-luma pixels
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = 1.0 / uResolution * uPatternScale;

    vec2 ab;
    if (uHasFeedback < 0.5) {
      // Initial seed: small dot at center
      float d = length(vUv - 0.5);
      ab = vec2(1.0, smoothstep(0.05, 0.0, d));
    } else {
      vec2 prev = texture2D(uFeedback, vUv).rg;
      // 5-tap Laplacian
      vec2 lap = vec2(0.0);
      lap += texture2D(uFeedback, vUv + texel * vec2(-1.0,  0.0)).rg * 0.2;
      lap += texture2D(uFeedback, vUv + texel * vec2( 1.0,  0.0)).rg * 0.2;
      lap += texture2D(uFeedback, vUv + texel * vec2( 0.0, -1.0)).rg * 0.2;
      lap += texture2D(uFeedback, vUv + texel * vec2( 0.0,  1.0)).rg * 0.2;
      lap += texture2D(uFeedback, vUv + texel * vec2(-1.0, -1.0)).rg * 0.05;
      lap += texture2D(uFeedback, vUv + texel * vec2( 1.0, -1.0)).rg * 0.05;
      lap += texture2D(uFeedback, vUv + texel * vec2(-1.0,  1.0)).rg * 0.05;
      lap += texture2D(uFeedback, vUv + texel * vec2( 1.0,  1.0)).rg * 0.05;
      lap -= prev;

      // Gray-Scott
      int mode = int(uMode + 0.5);
      float feed = uFeedRate;
      float kill = uKillRate;
      if (mode == 1) { feed = 0.039; kill = 0.058; } // stripes
      else if (mode == 2) { feed = 0.0367; kill = 0.0649; } // mitosis
      else if (mode == 3) { feed = 0.0545; kill = 0.062; } // coral

      // Luma modulates feed rate (image content drives growth)
      float srcL = luma(src);
      feed = mix(feed, feed * (0.6 + srcL * 1.0), uLumaMask);

      float a = prev.r, b = prev.g;
      float reaction = a * b * b;
      float dt = 1.0;
      float newA = a + (uDiffusionA * lap.r - reaction + feed * (1.0 - a)) * dt;
      float newB = b + (uDiffusionB * lap.g + reaction - (kill + feed) * b) * dt;
      ab = vec2(clamp(newA, 0.0, 1.0), clamp(newB, 0.0, 1.0));

      // Reseed B from bright source pixels
      if (uReseed > 0.001 && srcL > 0.7) {
        ab.g = max(ab.g, srcL * uReseed);
      }
    }

    // Visualise: B channel as colour overlay
    vec3 patColor = vec3(uColorR, uColorG, uColorB) * ab.g;
    vec3 disp = mix(src, src + patColor, uMix);
    // Encode chemical state in r,g; visible color in b
    gl_FragColor = vec4(ab, luma(disp), 1.0);
  }
`;

// ============================================================================
// NEON TUBE TRACE HERO — Edges become glowing animated neon tubes.
// ============================================================================
export const neonTubeTraceHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uEdgeThreshold; // 0-1
  uniform float uTubeWidth;     // 0.5-4
  uniform float uGlow;          // 0-2 glow intensity
  uniform float uGlowRadius;    // 1-12 px
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uChase;         // 0-1 marching-light along tube
  uniform float uChaseSpeed;    // 0-3
  uniform float uFlicker;       // 0-1 random tube flicker
  uniform float uBg;            // 0=black, 1=keep source, 2=darkened source
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float edgeStrength(vec2 uv, vec2 texel) {
    float l00 = luma(texture2D(uTexture, uv + texel * vec2(-1, -1)).rgb);
    float l10 = luma(texture2D(uTexture, uv + texel * vec2( 0, -1)).rgb);
    float l20 = luma(texture2D(uTexture, uv + texel * vec2( 1, -1)).rgb);
    float l01 = luma(texture2D(uTexture, uv + texel * vec2(-1,  0)).rgb);
    float l21 = luma(texture2D(uTexture, uv + texel * vec2( 1,  0)).rgb);
    float l02 = luma(texture2D(uTexture, uv + texel * vec2(-1,  1)).rgb);
    float l12 = luma(texture2D(uTexture, uv + texel * vec2( 0,  1)).rgb);
    float l22 = luma(texture2D(uTexture, uv + texel * vec2( 1,  1)).rgb);
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    return length(vec2(gx, gy));
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec3 src = texture2D(uTexture, vUv).rgb;
    float e = edgeStrength(vUv, texel);
    float tube = smoothstep(uEdgeThreshold, uEdgeThreshold + 0.05 * uTubeWidth, e);

    // Glow halo (sample edges in neighbourhood)
    float halo = 0.0;
    if (uGlow > 0.001) {
      float r = uGlowRadius;
      for (int y = -3; y <= 3; y++) {
        for (int x = -3; x <= 3; x++) {
          vec2 off = vec2(float(x), float(y)) * texel * r * 0.4;
          float ee = edgeStrength(vUv + off, texel);
          float w = exp(-(float(x*x + y*y)) / (2.0 * 4.0));
          halo += smoothstep(uEdgeThreshold, uEdgeThreshold + 0.1, ee) * w;
        }
      }
      halo *= uGlow / 16.0;
    }

    // Marching chase
    if (uChase > 0.001 && tube > 0.5) {
      float chase = sin(vUv.x * 60.0 + uTime * uChaseSpeed * 4.0) * 0.5 + 0.5;
      tube *= mix(0.5, 1.0 + chase * 0.6, uChase);
    }

    // Flicker
    if (uFlicker > 0.001) {
      float f = step(0.92, hash21(vec2(floor(uTime * 12.0))));
      tube *= 1.0 - f * uFlicker * 0.4;
    }

    vec3 tint = vec3(uTintR, uTintG, uTintB);
    vec3 neon = tint * (tube * 1.8 + halo);

    int bg = int(uBg + 0.5);
    vec3 baseColor;
    if (bg == 0) baseColor = vec3(0.0);
    else if (bg == 1) baseColor = src;
    else baseColor = src * 0.25;

    vec3 result = 1.0 - (1.0 - baseColor) * (1.0 - neon);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// DEPTH PARALLAX HERO — Fake depth from luma → push-in parallax layers.
// ============================================================================
export const depthParallaxHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDepthStrength; // 0-1
  uniform float uPushIn;        // 0-1 base zoom into depth
  uniform float uLayers;        // 1-8 depth layer count
  uniform float uChromatic;     // 0-1 RGB depth split
  uniform float uDepthBoost;    // 0-2 luma → depth response
  uniform float uMode;          // 0=push, 1=pan, 2=swing
  uniform float uPanX;          // -1..1
  uniform float uPanY;          // -1..1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec2 parallaxMap(vec2 uv, float depth, float layer) {
    int mode = int(uMode + 0.5);
    vec2 d = uv - 0.5;
    float scale = 1.0 + (depth - 0.5) * uDepthStrength * 0.5 + uPushIn * 0.3 * (1.0 + layer * 0.1);
    vec2 sUv;
    if (mode == 0) {
      sUv = 0.5 + d / scale;
    } else if (mode == 1) {
      sUv = uv + vec2(uPanX, uPanY) * (depth - 0.5) * uDepthStrength * 0.2 * (1.0 + layer * 0.2);
    } else {
      float sw = sin(uTime * 0.5 + layer * 0.3) * 0.5;
      sUv = uv + vec2(sw, sw * 0.4) * (depth - 0.5) * uDepthStrength * 0.15;
    }
    return clamp(sUv, vec2(0.0), vec2(1.0));
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float baseDepth = pow(luma(src), max(0.1, uDepthBoost));
    int layers = int(clamp(uLayers, 1.0, 8.0));

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= layers) break;
      float layer = float(i) / max(1.0, float(layers - 1));
      float sliceDepth = mix(0.2, 0.95, layer);
      // Estimate per-layer offset
      vec2 sUv = parallaxMap(vUv, sliceDepth, layer);
      vec3 sCol;
      if (uChromatic > 0.001) {
        vec2 cd = (sUv - 0.5) * uChromatic * 0.04 * (1.0 - layer);
        sCol.r = texture2D(uTexture, sUv + cd).r;
        sCol.g = texture2D(uTexture, sUv).g;
        sCol.b = texture2D(uTexture, sUv - cd).b;
      } else {
        sCol = texture2D(uTexture, sUv).rgb;
      }
      // Weight by closeness of source pixel depth to slice depth
      float pixDepth = pow(luma(sCol), max(0.1, uDepthBoost));
      float w = exp(-pow((pixDepth - sliceDepth) * 4.0, 2.0));
      acc += sCol * w;
      wsum += w;
    }
    vec3 result = (wsum > 0.0001) ? acc / wsum : src;
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// POINT CLOUD DISSOLVE HERO — Image becomes scattered dots that scatter/reform.
// ============================================================================
export const pointCloudDissolveHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uDissolve;      // 0-1 0=image, 1=fully scattered
  uniform float uDotSize;       // 1-12 px
  uniform float uScatterRadius; // 0-1 max scatter distance (% of screen)
  uniform float uAttract;       // 0-1 swirl-toward-center
  uniform float uTurbulence;    // 0-1 random per-dot direction
  uniform float uMode;          // 0=square dots, 1=circle, 2=cross
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform float uHueShift;      // 0-1 cycle hue along dissolve
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    // Raw source for dissolve = 0 fallback
    vec3 srcRaw = texture2D(uTexture, vUv).rgb;

    vec2 cell = floor(vUv * uResolution / uDotSize);
    vec2 cellOrigin = cell * uDotSize / uResolution;
    vec2 cellSize = vec2(uDotSize) / uResolution;

    // Each dot's home position is the cell origin + 0.5 of cell
    vec2 home = cellOrigin + cellSize * 0.5;

    // Sample source colour at the home position
    vec3 sampleCol = texture2D(uTexture, home).rgb;

    // Compute dot's drifted position based on dissolve amount
    vec2 dir = normalize(vec2(hash21(cell) - 0.5, hash21(cell + 13.7) - 0.5) + 1e-6);
    if (uAttract > 0.001) {
      vec2 toCenter = (vec2(0.5) - home);
      dir = mix(dir, normalize(toCenter + 1e-6), uAttract);
    }
    if (uTurbulence > 0.001) {
      float wob = sin(uTime + hash21(cell + 71.3) * 6.28) * uTurbulence;
      dir += vec2(wob * 0.3, wob * 0.4);
      dir = normalize(dir);
    }

    vec2 dotPos = home + dir * uDissolve * uScatterRadius;

    // Determine mask of dot at this UV. Dot radius = 0.71 covers full cell at
    // dissolve=0 (length(toDot) max is 0.707 at corner). Shrinks with dissolve
    // so scattered state shows BG between dots.
    vec2 toDot = (vUv - dotPos) / cellSize;
    int mode = int(uMode + 0.5);
    float dotR = mix(0.72, 0.42, uDissolve); // shrinks as dissolve grows
    float mask = 0.0;
    if (mode == 0) {
      // Square: cover full cell at dissolve=0
      vec2 ad = abs(toDot);
      mask = step(max(ad.x, ad.y), max(0.5, dotR));
    } else if (mode == 1) {
      // Circle: smooth falloff
      mask = smoothstep(dotR + 0.05, dotR - 0.05, length(toDot));
    } else {
      // Cross
      mask = max(
        step(abs(toDot.x), dotR * 0.2) * step(abs(toDot.y), dotR),
        step(abs(toDot.y), dotR * 0.2) * step(abs(toDot.x), dotR)
      );
    }

    if (uHueShift > 0.001) {
      vec3 hsv = rgb2hsv(sampleCol);
      hsv.x = fract(hsv.x + uDissolve * uHueShift);
      sampleCol = hsv2rgb(hsv);
    }

    vec3 bg = vec3(uBgR, uBgG, uBgB);
    vec3 dotResult = mix(bg, sampleCol, mask);
    // Crossfade with raw source so dissolve = 0 looks unchanged
    vec3 result = mix(srcRaw, dotResult, smoothstep(0.0, 0.05, uDissolve));
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// PIXEL SAND HERO — Bright pixels fall like sand with gravity + turbulence.
// Uses uFeedback for accumulated sand position memory.
// ============================================================================
export const pixelSandHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uGravity;       // 0-2 fall distance per frame
  uniform float uTurbulence;    // 0-1 random per-grain jitter
  uniform float uThreshold;     // 0-1 luma gate (bright pixels become sand)
  uniform float uPersistence;   // 0-1 how long sand stays before fading
  uniform float uMode;          // 0=fall, 1=rise, 2=swirl
  uniform float uReplenish;     // 0-1 how much new sand spawns each frame
  uniform float uChromaSplit;   // 0-1
  uniform float uGrainSize;     // 1-6 sand grain pixel size
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int mode = int(uMode + 0.5);

    // Snap to grain grid so sand looks pixelated/granular (not smooth)
    vec2 grain = floor(vUv * uResolution / max(1.0, uGrainSize));
    vec2 grainPos = grain * uGrainSize / uResolution;
    vec2 grainCenter = grainPos + vec2(uGrainSize) / uResolution * 0.5;
    float grainSeed = hash21(grain);

    // Direction of motion (texture-space y down)
    vec2 dir;
    if (mode == 0) dir = vec2(0.0, -1.0);                 // fall (sample above)
    else if (mode == 1) dir = vec2(0.0, 1.0);             // rise
    else dir = vec2(sin(uTime * 0.4 + grainCenter.y * 6.28), 0.6); // swirl

    if (uTurbulence > 0.001) {
      vec2 jit = vec2(hash21(grain + uTime * 0.05), hash21(grain * 1.3 + uTime * 0.05 + 7.3)) - 0.5;
      dir += jit * uTurbulence;
    }

    // Sample feedback at the cell this grain "fell from"
    float fallStep = uGravity * uGrainSize / uResolution.y;
    vec2 fbUv = grainCenter - dir * fallStep;
    vec3 fallen = vec3(0.0);
    float fallenAlpha = 0.0;
    if (uHasFeedback > 0.5) {
      vec3 prev;
      if (uChromaSplit > 0.001) {
        prev.r = texture2D(uFeedback, fbUv + dir * uChromaSplit * 0.003).r;
        prev.g = texture2D(uFeedback, fbUv).g;
        prev.b = texture2D(uFeedback, fbUv - dir * uChromaSplit * 0.003).b;
      } else {
        prev = texture2D(uFeedback, fbUv).rgb;
      }
      fallen = prev * uPersistence;
      // Snap to discrete particle: only kept if luma above gate
      fallenAlpha = step(0.05, luma(prev)) * uPersistence;
    }

    // Spawn new sand: only at bright source pixels, sparsely (granular)
    vec3 sampleCol = texture2D(uTexture, grainCenter).rgb;
    float lumaNow = luma(sampleCol);
    float sparkle = step(1.0 - uReplenish, grainSeed); // discrete spawn mask
    float spawnW = smoothstep(uThreshold, uThreshold + 0.05, lumaNow) * sparkle;
    vec3 newSand = sampleCol * spawnW;

    // Combine: take the brighter of the two (sand "wins" over old or new)
    vec3 sand = max(fallen, newSand);
    float sandAlpha = max(fallenAlpha, spawnW);

    // Composite: sand REPLACES source where present (granular look), source visible elsewhere.
    // Darken source slightly under sand for contrast.
    vec3 srcDimmed = src * (1.0 - sandAlpha * 0.4);
    vec3 disp = mix(srcDimmed, sand, sandAlpha);
    gl_FragColor = vec4(clamp(disp, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// LIQUID GLASS HERO — Refractive blob lens with caustics + chromatic + spec.
// ============================================================================
export const liquidGlassHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uBlobs;         // 1-8
  uniform float uBlobSize;      // 0.05-0.4
  uniform float uRefraction;    // 0-1
  uniform float uChromatic;     // 0-1
  uniform float uSpecular;      // 0-1
  uniform float uCausticAmount; // 0-1
  uniform float uSpeed;         // 0-3
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Compute summed signed-distance to N moving blobs
  float blobField(vec2 uv, out vec2 grad) {
    int n = int(clamp(uBlobs, 1.0, 8.0));
    float sum = 0.0;
    grad = vec2(0.0);
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      float fi = float(i);
      vec2 c = vec2(
        0.5 + 0.35 * sin(uTime * uSpeed * 0.3 + fi * 1.7),
        0.5 + 0.35 * cos(uTime * uSpeed * 0.4 + fi * 2.3)
      );
      vec2 d = uv - c;
      d.x *= uResolution.x / uResolution.y;
      float r = length(d);
      float w = exp(-r * r / (uBlobSize * uBlobSize));
      sum += w;
      grad -= d * w / (uBlobSize * uBlobSize) * 2.0;
    }
    return sum;
  }

  void main() {
    vec2 grad;
    float field = blobField(vUv, grad);
    float blob = smoothstep(0.7, 1.3, field);

    // Refract: bend rays inversely proportional to gradient
    vec2 refractDir = -grad * uRefraction * 0.04;
    vec3 col;
    if (uChromatic > 0.001) {
      col.r = texture2D(uTexture, vUv + refractDir * (1.0 + uChromatic * 0.5)).r;
      col.g = texture2D(uTexture, vUv + refractDir).g;
      col.b = texture2D(uTexture, vUv + refractDir * (1.0 - uChromatic * 0.5)).b;
    } else {
      col = texture2D(uTexture, vUv + refractDir).rgb;
    }
    col *= mix(vec3(1.0), vec3(uTintR, uTintG, uTintB), blob * 0.5);

    // Specular highlight on top of blob (top-left bias)
    if (uSpecular > 0.001) {
      vec3 N = normalize(vec3(grad, 1.0));
      vec3 L = normalize(vec3(-0.4, -0.6, 0.6));
      float spec = pow(max(0.0, dot(N, L)), 32.0);
      col += vec3(spec) * uSpecular * blob * 1.5;
    }

    // Caustics outside blob
    if (uCausticAmount > 0.001) {
      float caust = (1.0 - blob) * (sin(field * 30.0 + uTime) * 0.5 + 0.5);
      col += vec3(uCausticAmount) * vec3(uTintR, uTintG, uTintB) * caust * 0.4;
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// HOLOGRAM SCAN HERO — Projector grid + scanlines + RGB flicker + bands.
// ============================================================================
export const hologramScanHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-1
  uniform float uScanFreq;      // 50-500
  uniform float uScanSpeed;     // 0-3
  uniform float uGridSpacing;   // 4-32
  uniform float uRGBFlicker;    // 0-1
  uniform float uBrokenBands;   // 0-1 random horizontal dropouts
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uOpacityFlicker;// 0-1
  uniform float uEdgeGlow;      // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 tint = vec3(uTintR, uTintG, uTintB);
    vec3 col = src;

    // RGB channel flicker (each channel jitters independently)
    if (uRGBFlicker > 0.001) {
      float t = floor(uTime * 30.0);
      float r = (hash21(vec2(t, 0)) - 0.5) * uRGBFlicker * 0.04;
      float g = (hash21(vec2(t, 1)) - 0.5) * uRGBFlicker * 0.04;
      float b = (hash21(vec2(t, 2)) - 0.5) * uRGBFlicker * 0.04;
      col.r = texture2D(uTexture, vUv + vec2(r, 0)).r;
      col.g = texture2D(uTexture, vUv + vec2(g, 0)).g;
      col.b = texture2D(uTexture, vUv + vec2(b, 0)).b;
    }

    // Scanline + descending scan beam
    float scan = sin(vUv.y * uScanFreq * 3.14159 - uTime * uScanSpeed * 4.0);
    scan = mix(1.0, scan * 0.4 + 0.6, uIntensity);
    col *= scan;

    // Bright moving scan beam
    float beam = smoothstep(0.04, 0.0, abs(vUv.y - mod(uTime * uScanSpeed * 0.3, 1.0)));
    col += beam * tint * uIntensity * 1.5;

    // Grid overlay
    if (uGridSpacing > 0.5) {
      vec2 g = mod(vUv * uResolution, uGridSpacing);
      float gridLine = step(uGridSpacing - 1.0, max(g.x, g.y));
      col += gridLine * tint * 0.2 * uIntensity;
    }

    // Broken bands (horizontal dropouts)
    if (uBrokenBands > 0.001) {
      float bandY = floor(vUv.y * 60.0 + uTime * 2.0);
      float dropout = step(0.94, hash21(vec2(bandY, floor(uTime * 4.0))));
      col *= 1.0 - dropout * uBrokenBands * 0.6;
    }

    // Holographic tint
    col = mix(col, col * tint + tint * 0.15, uIntensity * 0.5);

    // Edge glow
    if (uEdgeGlow > 0.001) {
      vec2 texel = 1.0 / uResolution;
      float l = luma(src);
      float lN = luma(texture2D(uTexture, vUv + texel * vec2(0.0, 1.0)).rgb);
      float lE = luma(texture2D(uTexture, vUv + texel * vec2(1.0, 0.0)).rgb);
      float edge = abs(l - lN) + abs(l - lE);
      col += tint * edge * uEdgeGlow * 2.0;
    }

    // Overall opacity flicker
    if (uOpacityFlicker > 0.001) {
      float opf = 1.0 - (sin(uTime * 8.0) * 0.5 + 0.5) * uOpacityFlicker * 0.3;
      col *= opf;
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// LASER SLICE HERO — Moving scan plane with glow + sparks + erase trail.
// ============================================================================
export const laserSliceHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uMode;          // 0=horizontal, 1=vertical, 2=diagonal, 3=radial
  uniform float uSpeed;         // 0-3
  uniform float uBeamWidth;     // 0.005-0.1
  uniform float uGlow;          // 0-2
  uniform float uSparks;        // 0-1
  uniform float uEraseAmount;   // 0-1 (use feedback for erased trail)
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uReveal;        // 0=erase pre-beam, 1=reveal post-beam
  uniform float uPersistence;   // 0-1 trail decay
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    int mode = int(uMode + 0.5);
    float pos = mod(uTime * uSpeed * 0.3, 1.4) - 0.2; // beam pos 0..1 with sweep over edges

    // Distance from beam line
    float d;
    if (mode == 0) d = abs(vUv.y - pos);
    else if (mode == 1) d = abs(vUv.x - pos);
    else if (mode == 2) d = abs((vUv.x + vUv.y) * 0.5 - pos);
    else {
      // Radial: pos = ring radius
      vec2 rd = vUv - 0.5;
      d = abs(length(rd) - pos * 0.7);
    }

    float beam = smoothstep(uBeamWidth * 1.5, 0.0, d);
    float halo = exp(-d * d / (uBeamWidth * uBeamWidth * 8.0)) * uGlow;

    // Side relative to beam
    float side;
    if (mode == 0) side = step(vUv.y, pos);
    else if (mode == 1) side = step(vUv.x, pos);
    else if (mode == 2) side = step((vUv.x + vUv.y) * 0.5, pos);
    else side = step(length(vUv - 0.5), pos * 0.7);

    // Erase / reveal mask: 1 = show source, 0 = show feedback (trail)
    float mask = (uReveal > 0.5) ? side : (1.0 - side);

    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 prev = (uHasFeedback > 0.5) ? texture2D(uFeedback, vUv).rgb : vec3(0.0);
    vec3 base = mix(prev * uPersistence, src, mask);

    // Erase amount controls how much we wipe through to feedback
    base = mix(src, base, uEraseAmount);

    vec3 tint = vec3(uTintR, uTintG, uTintB);
    vec3 result = base + tint * (beam + halo);

    // Sparks at beam edge
    if (uSparks > 0.001 && beam > 0.001) {
      float sp = step(0.97, hash21(floor(vUv * 300.0) + floor(uTime * 30.0)));
      result += sp * tint * 2.0 * uSparks;
    }

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// AURA FIELD HERO — Soft color fields bloom from edges + audio peaks.
// ============================================================================
export const auraFieldHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uRadius;        // 4-32 px
  uniform float uEdgeAmount;    // 0-1 edge contribution
  uniform float uLumaAmount;    // 0-1 bright pixel contribution
  uniform float uAudio;
  uniform float uAudioReact;    // 0-2 audio scales aura
  uniform float uHueShift;      // 0-1
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uMode;          // 0=add, 1=screen, 2=replace
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = 1.0 / uResolution;

    // Compute aura from neighborhood: blur weighted by source brightness + edges
    vec3 aura = vec3(0.0);
    float wsum = 0.0;
    float r = uRadius * (1.0 + uAudio * uAudioReact * 0.6);
    for (int y = -4; y <= 4; y++) {
      for (int x = -4; x <= 4; x++) {
        if (abs(x) + abs(y) > 6) continue;
        vec2 off = vec2(float(x), float(y)) * texel * r * 0.4;
        vec3 s = texture2D(uTexture, vUv + off).rgb;
        // Edge component (delta from center)
        vec3 d = abs(s - src);
        float edgeW = (d.r + d.g + d.b) * uEdgeAmount;
        float lumaW = luma(s) * uLumaAmount;
        float w = exp(-(float(x*x + y*y)) / 8.0) * (edgeW + lumaW);
        aura += s * w;
        wsum += w;
      }
    }
    aura = (wsum > 0.0001) ? aura / wsum : vec3(0.0);
    aura *= uIntensity * (1.0 + uAudio * uAudioReact);

    // Optional hue cycle
    if (uHueShift > 0.001) {
      float l = luma(aura);
      vec3 hsvAura = hsv2rgb(vec3(fract(uTime * 0.1 + uHueShift), 1.0, l));
      aura = mix(aura, hsvAura, uHueShift);
    }
    aura *= vec3(uTintR, uTintG, uTintB);

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = src + aura;
    else if (mode == 1) result = 1.0 - (1.0 - src) * (1.0 - aura);
    else result = mix(src, aura, clamp(uIntensity * 0.5, 0.0, 1.0));

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// SMOKE DISINTEGRATE HERO — Luma-driven smoke wisps eat away the image.
// ============================================================================
export const smokeDisintegrateHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 0=intact, 1=fully gone
  uniform float uScale;         // 0.5-16 noise scale
  uniform float uSpeed;         // 0-3
  uniform float uDirection;     // 0-360 wind direction
  uniform float uEdgeFade;      // 0-1 fade at dissolve edge
  uniform float uSmokeColorR;
  uniform float uSmokeColorG;
  uniform float uSmokeColorB;
  uniform float uMode;          // 0=top-down, 1=center-out, 2=fbm-driven
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 5; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int mode = int(uMode + 0.5);
    float ang = radians(uDirection);
    vec2 windDir = vec2(cos(ang), sin(ang));

    // Base threshold field (where dissolve has reached)
    float threshold;
    if (mode == 0) threshold = vUv.y; // top-down
    else if (mode == 1) threshold = 1.0 - length(vUv - 0.5) * 1.4; // center-out
    else threshold = fbm(vUv * 2.0); // fbm-driven random

    // Animated smoke noise pattern
    vec2 p = vUv * uScale + windDir * uTime * uSpeed * 0.2;
    float smoke = fbm(p);
    smoke = smoke * 0.6 + fbm(p * 2.5 + uTime * uSpeed * 0.15) * 0.4;

    // Threshold + amount drives dissolve
    float dissolveEdge = uAmount + smoke * 0.5 - 0.5;
    float dissolveMask = smoothstep(threshold - uEdgeFade * 0.2, threshold + uEdgeFade * 0.2, dissolveEdge);

    // Smoke color in dissolve area (tint by smoke pattern)
    vec3 smokeColor = vec3(uSmokeColorR, uSmokeColorG, uSmokeColorB) * (0.6 + smoke * 0.4);
    vec3 result = mix(src, smokeColor, dissolveMask);
    // Apply alpha mask: high dissolve = transparent (or smoke-tinted)
    float alpha = 1.0 - dissolveMask * 0.6;

    gl_FragColor = vec4(result, alpha);
  }
`;

// ============================================================================
// SHIMMER CLOTH HERO — Image becomes waving fabric with thread highlights.
// ============================================================================
export const shimmerClothHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmplitude;     // 0-1
  uniform float uFrequency;     // 1-30
  uniform float uSpeed;         // 0-3
  uniform float uThreadDensity; // 1-200 thread weave count
  uniform float uThreadDepth;   // 0-1 thread shadow depth
  uniform float uShimmer;       // 0-2 silk shimmer intensity
  uniform float uMode;          // 0=horizontal weave, 1=plaid, 2=satin
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    // Wave the UV
    float t = uTime * uSpeed;
    vec2 wave;
    wave.x = sin(vUv.y * uFrequency + t) * uAmplitude * 0.04;
    wave.y = cos(vUv.x * uFrequency * 0.8 + t * 0.7) * uAmplitude * 0.03;
    vec2 sUv = vUv + wave;
    sUv = clamp(sUv, vec2(0.0), vec2(1.0));
    vec3 col = texture2D(uTexture, sUv).rgb;

    // Thread weave overlay
    int mode = int(uMode + 0.5);
    vec2 px = sUv * uResolution;
    float thread;
    if (mode == 0) {
      // Horizontal weave
      thread = sin(px.y * uThreadDensity * 0.1) * 0.5 + 0.5;
    } else if (mode == 1) {
      // Plaid (both axes)
      thread = (sin(px.x * uThreadDensity * 0.07) + sin(px.y * uThreadDensity * 0.07)) * 0.25 + 0.5;
    } else {
      // Satin (45-degree weave)
      thread = sin((px.x + px.y) * uThreadDensity * 0.06) * 0.5 + 0.5;
    }
    col *= mix(1.0, thread, uThreadDepth * 0.4);

    // Shimmer (silk highlights)
    if (uShimmer > 0.001) {
      float specular = pow(max(0.0, sin(px.x * 0.1 + px.y * 0.05 + t * 1.5)), 8.0);
      col += vec3(specular) * uShimmer * 0.3;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================================
// GLITCH QUILT HERO — Tiles reorder/rotate/delay independently.
// ============================================================================
export const glitchQuiltHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uTileSize;      // 8-128
  uniform float uShuffleAmount; // 0-1
  uniform float uRotateAmount;  // 0-1
  uniform float uDelayAmount;   // 0-1 (only with feedback)
  uniform float uChromaSplit;   // 0-1
  uniform float uTriggerRate;   // 0-3 reshuffle frequency
  uniform float uMode;          // 0=quilt, 1=swap, 2=mosh
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 cell = floor(vUv * uResolution / uTileSize);
    vec2 cellOrigin = cell * uTileSize / uResolution;
    vec2 cellSize = vec2(uTileSize) / uResolution;
    vec2 cellUv = (vUv - cellOrigin) / cellSize;

    // Per-cell randomness, refreshed at trigger rate
    float t = floor(uTime * uTriggerRate * 2.0);
    float h = hash21(cell + t);
    float h2 = hash21(cell + t + 13.7);

    // Shuffle: replace this tile with one elsewhere
    vec2 srcCell = cell;
    if (h < uShuffleAmount) {
      srcCell.x = floor(hash21(cell + t + 7.3) * uResolution.x / uTileSize);
      srcCell.y = floor(hash21(cell + t + 17.5) * uResolution.y / uTileSize);
    }

    // Rotate: per-cell quad rotation
    vec2 sUv = cellUv;
    if (h2 < uRotateAmount) {
      int rot = int(hash21(cell + t + 27.3) * 4.0);
      if (rot == 1) sUv = vec2(sUv.y, 1.0 - sUv.x);
      else if (rot == 2) sUv = vec2(1.0 - sUv.x, 1.0 - sUv.y);
      else if (rot == 3) sUv = vec2(1.0 - sUv.y, sUv.x);
    }
    vec2 finalUv = (srcCell * uTileSize + sUv * uTileSize) / uResolution;
    finalUv = clamp(finalUv, vec2(0.0), vec2(1.0));

    int mode = int(uMode + 0.5);
    vec3 col;
    if (uChromaSplit > 0.001) {
      vec2 cd = vec2(uChromaSplit * 0.005, 0.0);
      col.r = texture2D(uTexture, finalUv + cd).r;
      col.g = texture2D(uTexture, finalUv).g;
      col.b = texture2D(uTexture, finalUv - cd).b;
    } else {
      col = texture2D(uTexture, finalUv).rgb;
    }

    // Delay: blend with feedback
    if (uDelayAmount > 0.001 && uHasFeedback > 0.5) {
      float useFb = step(0.5, hash21(cell + 71.3));
      vec3 prev = texture2D(uFeedback, finalUv).rgb;
      col = mix(col, prev, useFb * uDelayAmount);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================================
// CELLULAR AUTOMATA BURN HERO — Game-of-life style cells spread.
// ============================================================================
export const cellularAutomataBurnHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uCellSize;      // 1-8 px
  uniform float uBirthThreshold;// 0-1 luma threshold for new cell
  uniform float uSurvivalLow;   // 0-8 neighbor count low end
  uniform float uSurvivalHigh;  // 0-8 high end
  uniform float uColorR;
  uniform float uColorG;
  uniform float uColorB;
  uniform float uMode;          // 0=Conway, 1=Brian's Brain, 2=Burn
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = vec2(uCellSize) / uResolution;

    float alive = 0.0;
    if (uHasFeedback > 0.5) {
      // Sample 8 neighbors
      float n = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          if (x == 0 && y == 0) continue;
          n += texture2D(uFeedback, vUv + texel * vec2(float(x), float(y))).r;
        }
      }
      float self = texture2D(uFeedback, vUv).r;
      int mode = int(uMode + 0.5);
      if (mode == 0) {
        // Conway: birth on 3, survive on 2-3
        if (self > 0.5 && n >= uSurvivalLow && n <= uSurvivalHigh) alive = 1.0;
        else if (self < 0.5 && n >= 2.5 && n <= 3.5) alive = 1.0;
      } else if (mode == 1) {
        // Brian's Brain: alive→dying→dead, only birth on 2
        if (self < 0.4 && n >= 1.5 && n <= 2.5) alive = 1.0;
        else if (self > 0.5) alive = 0.5; // dying
      } else {
        // Burn: cells expand into bright neighbors, decay
        if (self > 0.5) alive = self * 0.92;
        else if (n > 0.5 && luma(src) > uBirthThreshold) alive = 1.0;
      }
    } else {
      // First frame: seed from luma
      alive = step(uBirthThreshold, luma(src));
    }

    // Inject birth from current source brightness
    if (luma(src) > uBirthThreshold + 0.2) alive = max(alive, 1.0);

    vec3 cellColor = vec3(uColorR, uColorG, uColorB) * alive;
    vec3 disp = mix(src, src + cellColor, uMix);
    // Encode alive in r-channel for next frame, color in display
    gl_FragColor = vec4(alive, alive * 0.5, alive * 0.25, luma(disp));
  }
`;

// ============================================================================
// RORSCHACH MIRROR HERO — Bilateral ink symmetry with animated edges.
// ============================================================================
export const rorschachMirrorHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uMode;          // 0=vertical, 1=horizontal, 2=both, 3=4-fold
  uniform float uInkAmount;     // 0-1 contrast/threshold for ink
  uniform float uFluidEdges;    // 0-1 animated noise on mirror seam
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform float uMixOriginal;   // 0-1
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    int mode = int(uMode + 0.5);
    vec2 sUv = vUv;
    // Animated edge wobble at fold seam
    float wobble = uFluidEdges * (vnoise(vUv * 8.0 + uTime * 0.5) - 0.5) * 0.04;

    if (mode == 0 || mode == 2 || mode == 3) {
      // Vertical fold (mirror left↔right)
      if (sUv.x > 0.5 + wobble) sUv.x = 1.0 - sUv.x;
    }
    if (mode == 1 || mode == 2 || mode == 3) {
      if (sUv.y > 0.5 + wobble) sUv.y = 1.0 - sUv.y;
    }
    if (mode == 3) {
      // 4-fold: also diagonal mirror
      if (sUv.x > sUv.y) {
        float tmp = sUv.x; sUv.x = sUv.y; sUv.y = tmp;
      }
    }
    sUv = clamp(sUv, vec2(0.0), vec2(1.0));
    vec3 mirrored = texture2D(uTexture, sUv).rgb;
    float ink = smoothstep(uInkAmount, 1.0, luma(mirrored));
    vec3 inkColor = mix(vec3(uBgR, uBgG, uBgB), vec3(uTintR, uTintG, uTintB), ink);

    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 result = mix(inkColor, src, uMixOriginal);
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// SPECTRAL PRISM TUNNEL HERO — Refracts image into recursive rainbow tunnel.
// ============================================================================
export const spectralPrismTunnelHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTunnelDepth;   // 0.5-3
  uniform float uPrismSpread;   // 0-2 chromatic per-slice
  uniform float uRotation;      // 0-3
  uniform float uSpeed;         // 0-3
  uniform float uSlices;        // 4-32 number of recursive slices
  uniform float uFade;          // 0-1 darken with depth
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 d = vUv - 0.5;
    d.x *= uResolution.x / uResolution.y;
    float r = length(d);
    float a = atan(d.y, d.x);
    int slices = int(clamp(uSlices, 4.0, 32.0));
    float t = uTime * uSpeed;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 32; i++) {
      if (i >= slices) break;
      float fi = float(i) / float(slices);
      // Tunnel UV: depth shrinks r
      float depth = exp(-fi * uTunnelDepth);
      vec2 td = d / depth;
      td.x *= uResolution.y / uResolution.x;
      float ang = a + uRotation * fi + t * 0.3;
      vec2 rotD = vec2(cos(ang), sin(ang)) * length(td);
      rotD.x *= uResolution.y / uResolution.x;
      vec2 sUv = 0.5 + rotD;
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));

      // Per-slice prism shift: hue offset
      vec3 sCol = texture2D(uTexture, sUv).rgb;
      vec3 prismTint = hsv2rgb(vec3(fract(fi * uPrismSpread + t * 0.1), 1.0, 1.0));
      vec3 c = mix(sCol, sCol * prismTint, uPrismSpread * 0.5);
      float w = 1.0 - fi * uFade;
      acc += c * w;
      wsum += w;
    }
    vec3 result = acc / max(wsum, 0.0001);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// LED VOLUME HERO — 3D LED voxel wall with depth pulse.
// ============================================================================
export const ledVolumeHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uVoxelSize;     // 8-32 px
  uniform float uDepthPulse;    // 0-1 pulses depth
  uniform float uDepthSpeed;    // 0-3
  uniform float uPosterize;     // 1-8 colour quantization
  uniform float uGlow;          // 0-1
  uniform float uPerspective;   // 0-1 fake 3D push
  uniform float uMode;          // 0=square, 1=round, 2=hex
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    // Voxel grid with depth pulse animation
    vec2 cell = floor(vUv * uResolution / uVoxelSize);
    vec2 cellOrigin = cell * uVoxelSize / uResolution;
    vec2 cellSize = vec2(uVoxelSize) / uResolution;
    vec2 cellUv = (vUv - cellOrigin) / cellSize - 0.5;

    // Sample center colour, posterize
    vec3 sampleCol = texture2D(uTexture, cellOrigin + cellSize * 0.5).rgb;
    float steps = max(1.0, uPosterize);
    sampleCol = floor(sampleCol * steps + 0.5) / steps;

    // Depth pulse: brightness sized
    float depth = luma(sampleCol);
    if (uDepthPulse > 0.001) {
      depth += sin(uTime * uDepthSpeed * 2.0 + depth * 8.0) * uDepthPulse * 0.2;
    }

    // Voxel size scales with depth (perspective)
    float scale = mix(0.45, 0.45 - uPerspective * 0.3 * (1.0 - depth), 1.0);
    float r = length(cellUv);
    int mode = int(uMode + 0.5);
    float voxel;
    if (mode == 0) {
      vec2 ad = abs(cellUv);
      voxel = step(max(ad.x, ad.y), scale);
    } else if (mode == 1) {
      voxel = smoothstep(scale + 0.05, scale - 0.05, r);
    } else {
      // Hex
      vec2 ad = abs(cellUv);
      voxel = step(max(ad.x * 0.866 + ad.y * 0.5, ad.y), scale);
    }

    vec3 bg = vec3(uBgR, uBgG, uBgB);
    vec3 result = mix(bg, sampleCol, voxel);

    // Glow halo
    if (uGlow > 0.001) {
      float halo = smoothstep(scale * 1.6, scale, r);
      result += sampleCol * halo * uGlow * 0.4;
    }
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// POSTER TEAR HERO — Ripping mask reveals duplicated/offset layers beneath.
// ============================================================================
export const posterTearHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTearAmount;    // 0-1 progress
  uniform float uTearAngle;     // 0-360
  uniform float uTearJitter;    // 0-1 ragged-edge noise
  uniform float uShiftBelow;    // 0-1 offset of underneath layer
  uniform float uOffsetX;       // -0.3..0.3
  uniform float uOffsetY;       // -0.3..0.3
  uniform float uTearGlow;      // 0-1 highlight along rip
  uniform float uMode;          // 0=line, 1=arc, 2=rectangle
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    int mode = int(uMode + 0.5);
    float ang = radians(uTearAngle);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 norm = vec2(-dir.y, dir.x);

    // Distance from tear path
    vec2 d = vUv - 0.5;
    float distToLine = dot(d, norm);
    float jit = uTearJitter * (vnoise(vUv * 30.0) - 0.5) * 0.05;
    float teared;
    if (mode == 0) {
      teared = step(uTearAmount * 1.0 - 0.5, distToLine + jit);
    } else if (mode == 1) {
      // Arc tear
      float r = length(d);
      teared = step(uTearAmount * 0.7, r + jit);
    } else {
      // Rectangle (corner tear)
      vec2 ad = abs(d);
      teared = step(uTearAmount * 0.5, max(ad.x, ad.y) + jit);
    }

    // Below layer = offset & faded source
    vec2 belowUv = vUv + vec2(uOffsetX, uOffsetY) * uShiftBelow;
    belowUv = clamp(belowUv, vec2(0.0), vec2(1.0));
    vec3 above = texture2D(uTexture, vUv).rgb;
    vec3 below = texture2D(uTexture, belowUv).rgb * 0.7;

    vec3 result = mix(above, below, 1.0 - teared);

    // Glow along tear edge
    if (uTearGlow > 0.001) {
      float edge = smoothstep(0.04, 0.0, abs(distToLine - (uTearAmount - 0.5)));
      result += vec3(1.0, 0.95, 0.7) * edge * uTearGlow;
    }

    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// PAINT PEEL HERO — Edges curl/flake away based on noise + luma.
// ============================================================================
export const paintPeelHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;        // 0-1 peel progress
  uniform float uScale;         // 1-16 noise scale
  uniform float uLumaBias;      // 0-1 (peel darks vs lights)
  uniform float uCurl;          // 0-1 curl shading
  uniform float uShadow;        // 0-1 dark crack edge
  uniform float uBgR;
  uniform float uBgG;
  uniform float uBgB;
  uniform float uMode;          // 0=fbm, 1=cellular, 2=cracks
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }
    return v;
  }
  float cellular(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float minD = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));
        vec2 r = g + o - f;
        minD = min(minD, dot(r, r));
      }
    }
    return sqrt(minD);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 p = vUv * uScale;
    int mode = int(uMode + 0.5);
    float field;
    if (mode == 0) field = fbm(p + uTime * 0.05);
    else if (mode == 1) field = cellular(p);
    else {
      // Cracks: combine noises into thin lines
      float n1 = fbm(p);
      float n2 = fbm(p + 13.7);
      field = abs(n1 - n2) * 4.0;
    }
    float l = luma(src);
    float lumaWeight = mix(l, 1.0 - l, uLumaBias);
    float peel = step(field, uAmount * lumaWeight + 0.1);

    // Curl shading: gradient of field acts as fake highlight
    float lift = smoothstep(uAmount - 0.05, uAmount + 0.05, field) * uCurl;
    vec3 above = src * (1.0 - lift * 0.4);

    // Shadow at peel boundary
    float shadowEdge = smoothstep(0.05, 0.0, abs(field - uAmount));
    above *= 1.0 - shadowEdge * uShadow * 0.6;

    vec3 below = vec3(uBgR, uBgG, uBgB);
    vec3 result = mix(above, below, peel);
    gl_FragColor = vec4(result, 1.0);
  }
`;

// ============================================================================
// AUDIO SHOCK BLOOM HERO — Beat-triggered bloom + shockwave + chroma + strobe.
// All-in-one performance effect. Reads uAudio.
// ============================================================================
export const audioShockBloomHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uBloomThreshold;// 0-1
  uniform float uBloomRadius;   // 1-30
  uniform float uShockSpeed;    // 0.1-3
  uniform float uShockAmplitude;// 0-0.2
  uniform float uChromaSplit;   // 0-1
  uniform float uStrobeAmount;  // 0-1
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uAudio;
  uniform float uAudioGate;     // 0-1 minimum audio to trigger
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float audio = max(0.0, uAudio - uAudioGate) * (1.0 / max(0.01, 1.0 - uAudioGate));
    float kick = audio * uIntensity;

    // Shockwave displacement (driven by audio)
    vec2 d = vUv - 0.5;
    float dist = length(d);
    float ringR = mod(uTime * uShockSpeed * 0.5, 1.4) - 0.2;
    float band = smoothstep(0.06, 0.0, abs(dist - ringR));
    vec2 dir = normalize(d + 1e-6);
    vec2 shockOff = dir * band * uShockAmplitude * (0.4 + kick);

    // Chroma split (kick-driven)
    vec3 col;
    float cs = uChromaSplit * (0.4 + kick * 0.8);
    if (cs > 0.001) {
      col.r = texture2D(uTexture, vUv + dir * cs * 0.025 + shockOff).r;
      col.g = texture2D(uTexture, vUv + shockOff).g;
      col.b = texture2D(uTexture, vUv - dir * cs * 0.025 + shockOff).b;
    } else {
      col = texture2D(uTexture, vUv + shockOff).rgb;
    }

    // Bloom (highlight blur)
    vec2 texel = 1.0 / uResolution;
    vec3 bloom = vec3(0.0);
    float wsum = 0.0;
    float br = uBloomRadius * (0.5 + kick * 1.5);
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        if (abs(x) + abs(y) > 4) continue;
        vec2 off = vec2(float(x), float(y)) * texel * br * 0.4;
        vec3 s = texture2D(uTexture, vUv + off).rgb;
        float gate = smoothstep(uBloomThreshold, uBloomThreshold + 0.15, luma(s));
        float w = exp(-(float(x*x + y*y)) / 8.0);
        bloom += s * gate * w;
        wsum += w;
      }
    }
    bloom = (wsum > 0.001) ? bloom / wsum : vec3(0.0);
    bloom *= vec3(uTintR, uTintG, uTintB) * (1.0 + kick * 2.0);

    // Strobe pulse
    float strobe = 1.0 + uStrobeAmount * kick * 1.2;
    col *= strobe;

    vec3 result = 1.0 - (1.0 - col) * (1.0 - bloom);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// VHS FULL DECK HERO — Combines head switch + tracking + chroma + dropout.
// ============================================================================
export const vhsFullDeckHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTracking;      // 0-1 vertical sync drift
  uniform float uHeadSwitch;    // 0-1 head switching noise band
  uniform float uChromaBleed;   // 0-1
  uniform float uDropouts;      // 0-1
  uniform float uTapeNoise;     // 0-1
  uniform float uScanlines;     // 0-1
  uniform float uColorBleed;    // 0-1
  uniform float uSaturation;    // 0-1.5
  uniform float uTrackingJump;  // 0-1
  uniform float uMode;          // 0=clean, 1=worn, 2=destroyed
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 uv = vUv;
    int mode = int(uMode + 0.5);
    float modeBoost = (mode == 1) ? 1.3 : (mode == 2) ? 1.8 : 1.0;

    // Vertical tracking drift
    float trackJit = sin(uv.y * 30.0 + uTime * 2.0) * 0.005 * uTracking * modeBoost;
    uv.x += trackJit;

    // Tracking jump: occasional offset
    if (uTrackingJump > 0.001) {
      float jump = step(0.97, hash21(vec2(floor(uTime * 4.0), 0.0))) * uTrackingJump;
      if (uv.y < 0.4) uv.x += jump * 0.05;
    }

    // Head switch noise band at bottom
    float headBand = smoothstep(0.05, 0.0, uv.y) * uHeadSwitch * modeBoost;
    if (headBand > 0.01) {
      uv.x += (hash21(vec2(uv.y * 100.0, floor(uTime * 8.0))) - 0.5) * 0.04;
    }

    // Sample with chroma bleed
    vec3 col;
    float cb = uChromaBleed * modeBoost * 0.04;
    col.r = texture2D(uTexture, uv + vec2(cb, 0.0)).r;
    col.g = texture2D(uTexture, uv).g;
    col.b = texture2D(uTexture, uv - vec2(cb, 0.0)).b;

    // Color bleed (horizontal smear)
    if (uColorBleed > 0.001) {
      float bleed = uColorBleed * modeBoost;
      col.r = mix(col.r, texture2D(uTexture, uv + vec2(0.02 * bleed, 0)).r, 0.4);
    }

    // Saturation
    float l = luma(col);
    col = mix(vec3(l), col, uSaturation);

    // Tape noise (added grain)
    if (uTapeNoise > 0.001) {
      float n = (hash21(vUv * uResolution + uTime * 60.0) - 0.5) * uTapeNoise * modeBoost * 0.4;
      col += vec3(n);
    }

    // Scanlines
    if (uScanlines > 0.001) {
      float sl = sin(uv.y * 800.0) * 0.5 + 0.5;
      col *= mix(1.0, sl * 0.6 + 0.4, uScanlines * modeBoost);
    }

    // Dropouts: random horizontal bright stripes
    if (uDropouts > 0.001) {
      float yB = floor(uv.y * 60.0);
      float drop = step(0.93, hash21(vec2(yB, floor(uTime * 6.0))));
      col += vec3(drop * uDropouts * modeBoost * 0.6);
    }

    // Head band overlay (washes color)
    col += vec3(headBand * 0.5);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// ANALOG FEEDBACK RACK HERO — Real feedback buffer with zoom/rotate/hue/decay.
// ============================================================================
export const analogFeedbackRackHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uMix;           // 0-1 fresh-vs-feedback
  uniform float uZoom;          // 0.85-1.15
  uniform float uRotation;      // -0.2..0.2 radians per frame
  uniform float uDecay;         // 0-1
  uniform float uHueShift;      // 0-1 per frame
  uniform float uMaskCenter;    // 0-1 vignette around center
  uniform float uChromaSplit;   // 0-1
  uniform float uOffsetX;       // -0.1..0.1 per frame translate
  uniform float uOffsetY;       // -0.1..0.1
  uniform float uMode;          // 0=normal, 1=invert blend, 2=multiply
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    if (uHasFeedback < 0.5) { gl_FragColor = vec4(src, 1.0); return; }

    // Sample feedback at zoomed/rotated/translated UV
    vec2 d = (vUv - 0.5) * uZoom;
    float ca = cos(uRotation), sa = sin(uRotation);
    d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
    vec2 fbUv = 0.5 + d - vec2(uOffsetX, uOffsetY);

    vec3 fb;
    if (uChromaSplit > 0.001) {
      fb.r = texture2D(uFeedback, fbUv + vec2(uChromaSplit * 0.005, 0)).r;
      fb.g = texture2D(uFeedback, fbUv).g;
      fb.b = texture2D(uFeedback, fbUv - vec2(uChromaSplit * 0.005, 0)).b;
    } else {
      fb = texture2D(uFeedback, fbUv).rgb;
    }
    fb *= 1.0 - uDecay;

    if (uHueShift > 0.001) {
      vec3 hsv = rgb2hsv(fb);
      hsv.x = fract(hsv.x + uHueShift);
      fb = hsv2rgb(hsv);
    }

    // Center mask: only feedback in center, fade edges
    if (uMaskCenter > 0.001) {
      float mask = 1.0 - smoothstep(0.2, 0.8, length(vUv - 0.5));
      fb *= mix(1.0, mask, uMaskCenter);
    }

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = mix(src, src + fb, uMix);
    else if (mode == 1) result = mix(src, 1.0 - (1.0 - src) * (1.0 - fb), uMix);
    else result = mix(src, src * (1.0 + fb), uMix);

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// CLUB LASER GRID HERO — Perspective grid with audio-reactive intersections.
// ============================================================================
export const clubLaserGridHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uIntensity;     // 0-2
  uniform float uGridDensity;   // 4-32
  uniform float uPerspective;   // 0-1 fake 3D depth
  uniform float uSpeed;         // 0-3
  uniform float uIntersectionGlow; // 0-1
  uniform float uLineWidth;     // 0.5-4
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uAudio;
  uniform float uAudioReact;    // 0-2
  uniform float uMode;          // 0=floor grid, 1=ceiling, 2=tunnel
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int mode = int(uMode + 0.5);

    // Perspective transform
    vec2 uv = vUv;
    if (mode == 0) {
      // Floor: bottom is closer, top is further
      float persp = mix(1.0, 0.2, uv.y * uPerspective);
      uv.x = (uv.x - 0.5) / persp + 0.5;
      uv.y = mix(uv.y, pow(uv.y, 2.0), uPerspective);
    } else if (mode == 1) {
      // Ceiling: inverted floor
      float persp = mix(1.0, 0.2, (1.0 - uv.y) * uPerspective);
      uv.x = (uv.x - 0.5) / persp + 0.5;
      uv.y = mix(uv.y, 1.0 - pow(1.0 - uv.y, 2.0), uPerspective);
    } else {
      // Tunnel: radial perspective
      vec2 d = uv - 0.5;
      float r = length(d);
      uv = 0.5 + d / max(0.01, r * uPerspective + (1.0 - uPerspective));
    }

    // Animated grid lines
    float t = uTime * uSpeed;
    float audioBoost = 1.0 + uAudio * uAudioReact;
    vec2 grid = abs(fract(uv * uGridDensity * audioBoost - vec2(0.0, t * 0.3)) - 0.5);
    float lineX = smoothstep(uLineWidth * 0.02, 0.0, grid.x);
    float lineY = smoothstep(uLineWidth * 0.02, 0.0, grid.y);
    float gridLine = max(lineX, lineY);

    // Intersection brightness
    float intersect = lineX * lineY * uIntersectionGlow * (1.0 + audioBoost);

    vec3 grid3 = vec3(uTintR, uTintG, uTintB) * (gridLine + intersect * 2.0) * uIntensity;
    vec3 result = 1.0 - (1.0 - src) * (1.0 - grid3);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// MIRROR SHARDS HERO — Kaleidoscopic shard field with delay + rotation.
// ============================================================================
export const mirrorShardsHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uShards;        // 4-32
  uniform float uShardSize;     // 0.05-0.5
  uniform float uRotation;      // 0-360 max per-shard rotation
  uniform float uDelayAmount;   // 0-1 (uses feedback)
  uniform float uChromatic;     // 0-1
  uniform float uMode;          // 0=voronoi, 1=hex, 2=triangular
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    int mode = int(uMode + 0.5);
    vec2 cellId; vec2 cellCenter; vec2 cellUv;

    if (mode == 0) {
      // Voronoi shards
      vec2 p = vUv * uShards;
      vec2 i = floor(p), f = fract(p);
      float minD = 9.0;
      vec2 best = vec2(0.0);
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash21(i + g), hash21(i + g + 13.7));
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < minD) { minD = d; best = i + g; cellUv = r; }
        }
      }
      cellId = best;
      cellCenter = (best + 0.5) / uShards;
    } else if (mode == 1) {
      // Hex
      vec2 q = vec2(vUv.x * 1.1547, vUv.y) * uShards;
      q.x += 0.5 * floor(q.y);
      vec2 i = floor(q);
      cellId = vec2(i.x - floor(i.y / 2.0), i.y);
      cellCenter = (cellId + 0.5) / uShards;
      cellUv = fract(q) - 0.5;
    } else {
      // Triangular
      vec2 p = vUv * uShards;
      vec2 i = floor(p);
      cellId = i;
      cellCenter = (i + 0.5) / uShards;
      cellUv = fract(p) - 0.5;
    }

    // Per-shard rotation + delay
    float ang = (hash21(cellId) - 0.5) * radians(uRotation);
    ang += uTime * 0.1 * (hash21(cellId + 7.3) - 0.5);
    float ca = cos(ang), sa = sin(ang);
    vec2 sUv = cellCenter + vec2(cellUv.x * ca - cellUv.y * sa, cellUv.x * sa + cellUv.y * ca) * uShardSize;
    sUv = clamp(sUv, vec2(0.0), vec2(1.0));

    vec3 col;
    if (uChromatic > 0.001) {
      vec2 cd = vec2(uChromatic * 0.005, 0.0);
      col.r = texture2D(uTexture, sUv + cd).r;
      col.g = texture2D(uTexture, sUv).g;
      col.b = texture2D(uTexture, sUv - cd).b;
    } else {
      col = texture2D(uTexture, sUv).rgb;
    }

    // Delay with feedback (random per-shard mix)
    if (uDelayAmount > 0.001 && uHasFeedback > 0.5) {
      float useFb = step(0.5, hash21(cellId + 71.3));
      vec3 prev = texture2D(uFeedback, sUv).rgb;
      col = mix(col, prev, useFb * uDelayAmount);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================================
// GHOST EXPOSURE HERO — Long exposure accumulation via uFeedback.
// ============================================================================
export const ghostExposureHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uFeedback;
  uniform float uHasFeedback;
  uniform float uExposure;      // 0-1 how much new frame contributes
  uniform float uDecay;         // 0-1 how fast old fades
  uniform float uHueShiftPerFrame; // 0-0.05
  uniform float uIntensity;     // 0-2
  uniform float uMode;          // 0=add, 1=max, 2=screen
  uniform float uClamp;         // 0-1 (limit accumulation)
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec3 prev = (uHasFeedback > 0.5) ? texture2D(uFeedback, vUv).rgb : vec3(0.0);
    prev *= 1.0 - uDecay;

    // Hue shift per frame
    if (uHueShiftPerFrame > 0.001 && uHasFeedback > 0.5) {
      vec3 hsv = rgb2hsv(prev);
      hsv.x = fract(hsv.x + uHueShiftPerFrame);
      prev = hsv2rgb(hsv);
    }

    int mode = int(uMode + 0.5);
    vec3 result;
    if (mode == 0) result = prev + src * uExposure;
    else if (mode == 1) result = max(prev, src * uExposure);
    else result = 1.0 - (1.0 - prev) * (1.0 - src * uExposure);

    if (uClamp > 0.001) result = clamp(result, vec3(0.0), vec3(uClamp + 1.0 - uClamp));
    result *= uIntensity;
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// THERMAL CONTOUR HERO — Thermal palette + contour isolines + tracking blobs.
// ============================================================================
export const thermalContourHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uPalette;       // 0=ironbow, 1=jet, 2=viridis, 3=inferno
  uniform float uContourCount;  // 1-12 isolines
  uniform float uContourWidth;  // 0.001-0.02
  uniform float uContourGlow;   // 0-1
  uniform float uIntensity;     // 0-2
  uniform float uTrackBlobs;    // 0-1 highlight bright clusters
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 paletteCol(float t) {
    int p = int(uPalette + 0.5);
    if (p == 0) {
      // Ironbow
      vec3 c = mix(vec3(0, 0, 0.3), vec3(0.5, 0, 0.5), smoothstep(0.0, 0.25, t));
      c = mix(c, vec3(1, 0.3, 0), smoothstep(0.25, 0.55, t));
      c = mix(c, vec3(1, 1, 0.2), smoothstep(0.55, 0.85, t));
      c = mix(c, vec3(1, 1, 1), smoothstep(0.85, 1.0, t));
      return c;
    } else if (p == 1) {
      // Jet
      return vec3(
        smoothstep(0.35, 0.65, t) - smoothstep(0.85, 1.0, t),
        smoothstep(0.0, 0.35, t) - smoothstep(0.65, 1.0, t),
        smoothstep(0.0, 0.15, t) - smoothstep(0.5, 0.7, t)
      );
    } else if (p == 2) {
      // Viridis
      return vec3(0.27 + 0.5 * t, 0.005 + 0.9 * t, 0.33 + 0.5 * (1.0 - t));
    } else {
      // Inferno
      vec3 c = mix(vec3(0, 0, 0), vec3(0.4, 0, 0.4), smoothstep(0.0, 0.3, t));
      c = mix(c, vec3(0.95, 0.4, 0.1), smoothstep(0.3, 0.65, t));
      c = mix(c, vec3(1, 1, 0.6), smoothstep(0.65, 1.0, t));
      return c;
    }
  }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    float l = luma(src);
    vec3 thermal = paletteCol(l) * uIntensity;

    // Contour isolines
    float cw = max(0.001, uContourWidth);
    float bands = max(1.0, uContourCount);
    float bandPos = fract(l * bands);
    float contour = smoothstep(cw, 0.0, abs(bandPos - 0.5)) * uContourGlow;
    thermal += vec3(1.0) * contour;

    // Track blobs: highlight luma clusters
    if (uTrackBlobs > 0.001) {
      vec2 texel = 1.0 / uResolution;
      float lN = luma(texture2D(uTexture, vUv + texel * vec2(0, 4)).rgb);
      float lS = luma(texture2D(uTexture, vUv + texel * vec2(0, -4)).rgb);
      float lE = luma(texture2D(uTexture, vUv + texel * vec2(4, 0)).rgb);
      float lW = luma(texture2D(uTexture, vUv + texel * vec2(-4, 0)).rgb);
      float gradMag = abs(l - lN) + abs(l - lS) + abs(l - lE) + abs(l - lW);
      thermal += vec3(0.2, 1.0, 0.8) * smoothstep(0.6, 1.0, l) * uTrackBlobs * (1.0 - gradMag);
    }

    vec3 result = mix(src, thermal, uMix);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// DREAM DIFFUSION LOOK HERO — Soft bloom + halation + chromatic blur + pastel.
// ============================================================================
export const dreamDiffusionHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uBloomAmount;   // 0-2
  uniform float uBloomRadius;   // 1-30
  uniform float uHalation;      // 0-1
  uniform float uChromaticBlur; // 0-1
  uniform float uPastelRolloff; // 0-1 desaturate highlights toward pastel
  uniform float uShadowLift;    // 0-0.5
  uniform float uSoftness;      // 0-1 overall softness
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = 1.0 / uResolution;

    // Chromatic blur per channel
    vec3 cbCol = src;
    if (uChromaticBlur > 0.001) {
      float cb = uChromaticBlur * 6.0;
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
          vec2 off = vec2(float(x), float(y)) * texel * cb;
          float w = exp(-(float(x*x + y*y)) / 4.0);
          acc.r += texture2D(uTexture, vUv + off * 1.05).r * w;
          acc.g += texture2D(uTexture, vUv + off).g * w;
          acc.b += texture2D(uTexture, vUv + off * 0.95).b * w;
          wsum += w;
        }
      }
      cbCol = acc / wsum;
    }

    // Bloom on highlights
    vec3 bloom = vec3(0.0);
    float wsum2 = 0.0;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        if (abs(x) + abs(y) > 4) continue;
        vec2 off = vec2(float(x), float(y)) * texel * uBloomRadius * 0.4;
        vec3 s = texture2D(uTexture, vUv + off).rgb;
        float gate = smoothstep(0.55, 0.85, luma(s));
        float w = exp(-(float(x*x + y*y)) / 8.0);
        bloom += s * gate * w;
        wsum2 += w;
      }
    }
    bloom = (wsum2 > 0.001) ? bloom / wsum2 : vec3(0.0);
    bloom *= uBloomAmount;

    // Halation (warm bleed around highlights)
    vec3 halo = bloom * vec3(1.0, 0.6, 0.4) * uHalation;

    // Pastel rolloff: desaturate highlights toward white
    float l = luma(cbCol);
    if (uPastelRolloff > 0.001) {
      vec3 pastel = mix(cbCol, vec3(1.0), smoothstep(0.7, 1.0, l) * uPastelRolloff);
      cbCol = pastel;
    }

    // Shadow lift
    cbCol += vec3(uShadowLift) * (1.0 - smoothstep(0.0, 0.4, l));

    // Combine
    vec3 result = cbCol + bloom + halo;
    result *= vec3(uTintR, uTintG, uTintB);
    // Overall softness via slight blur mix
    result = mix(result, mix(result, src, 0.5), uSoftness * 0.3);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// TOPO DEPTH WARP HERO — Luma-derived contour lines become displacement ridges.
// ============================================================================
export const topoWarpHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uContourCount;  // 4-32
  uniform float uContourWidth;  // 0.001-0.05
  uniform float uDisplacement;  // 0-1
  uniform float uChromaticEdge; // 0-1
  uniform float uColorR;        // contour line color
  uniform float uColorG;
  uniform float uColorB;
  uniform float uShadowRidges;  // 0-1
  uniform float uMix;           // 0-1
  uniform vec2 uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    vec2 texel = 1.0 / uResolution;

    // Estimate gradient of luma
    float l = luma(src);
    float lE = luma(texture2D(uTexture, vUv + texel * vec2(1, 0)).rgb);
    float lN = luma(texture2D(uTexture, vUv + texel * vec2(0, 1)).rgb);
    vec2 grad = vec2(lE - l, lN - l);

    // Contour bands
    float bands = max(1.0, uContourCount);
    float bandPos = fract(l * bands);
    float ridge = smoothstep(uContourWidth * 5.0, 0.0, abs(bandPos - 0.5));

    // Displacement: shift sample along gradient by ridge
    vec2 disp = grad * ridge * uDisplacement * 0.3;
    vec3 col;
    if (uChromaticEdge > 0.001) {
      col.r = texture2D(uTexture, vUv + disp * (1.0 + uChromaticEdge * 0.5)).r;
      col.g = texture2D(uTexture, vUv + disp).g;
      col.b = texture2D(uTexture, vUv + disp * (1.0 - uChromaticEdge * 0.5)).b;
    } else {
      col = texture2D(uTexture, vUv + disp).rgb;
    }

    // Contour line overlay
    vec3 contour = vec3(uColorR, uColorG, uColorB) * ridge;

    // Shadow ridges (darker on one side of contour)
    if (uShadowRidges > 0.001) {
      float side = step(0.5, bandPos);
      col *= 1.0 - side * ridge * uShadowRidges * 0.5;
    }

    vec3 result = mix(src, col + contour, uMix);
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
  }
`;

// ============================================================================
// STROBE SEQUENCER HERO — Patterned strobe gates with editable rhythmic steps.
// ============================================================================
export const strobeSequencerHeroShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uBPM;           // 30-240
  uniform float uSteps;         // 4-16 step count per bar
  uniform float uPattern;       // bit-encoded pattern (0..(2^16-1))
  uniform float uMode;          // 0=on/off, 1=invert, 2=tint, 3=zoom
  uniform float uIntensity;     // 0-2
  uniform float uTintR;
  uniform float uTintG;
  uniform float uTintB;
  uniform float uSwing;         // 0-0.5 (offbeat shift)
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec3 src = texture2D(uTexture, vUv).rgb;
    int steps = int(clamp(uSteps, 1.0, 16.0));
    float beatLen = 60.0 / max(1.0, uBPM);
    float stepLen = beatLen / float(steps) * 4.0; // 16 steps = 1 bar @4/4
    float t = uTime;
    float stepF = mod(t / stepLen, float(steps));
    int stepIdx = int(stepF);
    // Apply swing on odd steps
    float frac = fract(stepF);
    if (stepIdx % 2 == 1) frac = clamp(frac - uSwing, 0.0, 1.0);

    // Decode pattern bit (uPattern is treated as bitmask)
    float patternF = uPattern;
    float bitVal = mod(floor(patternF / pow(2.0, float(stepIdx))), 2.0);
    float gate = (bitVal > 0.5 && frac < 0.5) ? 1.0 : 0.0;

    int mode = int(uMode + 0.5);
    vec3 tint = vec3(uTintR, uTintG, uTintB);
    vec3 result = src;
    if (mode == 0) {
      result = mix(src, src + tint * uIntensity, gate);
    } else if (mode == 1) {
      result = mix(src, 1.0 - src, gate * uIntensity);
    } else if (mode == 2) {
      result = mix(src, src * tint + tint * 0.4, gate * uIntensity);
    } else {
      // Zoom-on-beat
      vec2 d = vUv - 0.5;
      float zoom = 1.0 + gate * uIntensity * 0.1;
      vec2 sUv = 0.5 + d / zoom;
      sUv = clamp(sUv, vec2(0.0), vec2(1.0));
      result = texture2D(uTexture, sUv).rgb;
    }
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
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
