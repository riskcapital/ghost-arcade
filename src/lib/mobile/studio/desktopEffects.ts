// Portable single-pass shaders and controls from desktop 57b366b8. No desktop stores or native dependencies.
import type { MobileEffectDef } from "../standaloneEffects";
export const DESKTOP_MOBILE_EFFECTS: MobileEffectDef[] = [
  {
    "type": "vignette",
    "label": "Vignette",
    "category": "Masking",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float vignetteSize;        // 0-1, how far vignette extends from center\n  uniform float vignetteSoftness;    // 0-1, edge softness\n  uniform float vignetteRoundness;   // 0-1, circular vs rectangular (legacy mix factor)\n  // Hero-rewrite params\n  uniform float vignetteShape;       // 0=round, 1=oval, 2=square, 3=superellipse\n  uniform float vignetteAspect;      // 0.3-3.0 — oval/superellipse aspect ratio (X/Y)\n  uniform float vignetteCenterX;     // 0-1 — vignette center X (0.5 = frame center)\n  uniform float vignetteCenterY;     // 0-1 — vignette center Y\n  uniform float vignetteColorR;      // 0-1 tint R (used when vignetteTintAmount > 0)\n  uniform float vignetteColorG;      // 0-1 tint G\n  uniform float vignetteColorB;      // 0-1 tint B\n  uniform float vignetteTintAmount;  // 0-1 — 0 = transparent fade (legacy), 1 = solid color fade\n  uniform float vignetteBreathing;   // 0-1 — animated size oscillation amplitude\n  uniform float vignetteBreathSpeed; // 0-2 — breathing speed (cycles per second / 2π)\n  uniform float uTime;\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n\n    // Animated breathing — size pulses around vignetteSize. Smooth sine wave;\n    // vignetteBreathing=0 gives identical behavior to the legacy shader.\n    float breath = sin(uTime * vignetteBreathSpeed * 6.28318) * 0.5 + 0.5;\n    float effectiveSize = vignetteSize - vignetteBreathing * 0.15 * (breath - 0.5);\n\n    // Centered coordinates with user-movable center.\n    vec2 center = vec2(vignetteCenterX, vignetteCenterY);\n    vec2 pos = vUv - center;\n\n    // Compute distance based on shape selector.\n    int shape = int(vignetteShape + 0.5);\n    float dist = 1.0;\n    if (shape == 0) {\n      // Round (legacy): mix between rectangular and circular via vignetteRoundness.\n      float rectDist = max(abs(pos.x), abs(pos.y)) * 2.0;\n      float circDist = length(pos) * 2.0;\n      dist = mix(rectDist, circDist, vignetteRoundness);\n    } else if (shape == 1) {\n      // Oval — circular but stretched by vignetteAspect on the X axis.\n      float a = max(vignetteAspect, 0.0001);\n      dist = length(vec2(pos.x / a, pos.y)) * 2.0;\n    } else if (shape == 2) {\n      // Square — strict L∞ (max-axis) distance, ignores vignetteAspect/vignetteRoundness.\n      dist = max(abs(pos.x), abs(pos.y)) * 2.0;\n    } else {\n      // Superellipse (squircle) — Lp norm with p=4 gives that rounded-rect\n      // look you see in product photography. Stretched by vignetteAspect.\n      float a = max(vignetteAspect, 0.0001);\n      vec2 q = vec2(pos.x / a, pos.y) * 2.0;\n      dist = pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25);\n    }\n\n    // Smooth falloff across the edge band.\n    float vignette = 1.0 - smoothstep(effectiveSize - vignetteSoftness * 0.5, effectiveSize + vignetteSoftness * 0.5, dist);\n\n    // Tint mode: when vignetteTintAmount=0 we fade alpha (legacy behavior).\n    // When vignetteTintAmount=1 we KEEP alpha and blend the image toward the\n    // tint color in the vignette region — perfect for \"stage spotlight\"\n    // (black surround) or \"warm portrait\" (orange-brown surround).\n    vec3 tint = vec3(vignetteColorR, vignetteColorG, vignetteColorB);\n    vec3 finalRgb = mix(texColor.rgb, tint, (1.0 - vignette) * vignetteTintAmount);\n    float finalA = texColor.a * mix(vignette, 1.0, vignetteTintAmount);\n\n    gl_FragColor = vec4(finalRgb, finalA);\n  }\n",
    "defaults": {
      "vignetteSize": 0.8,
      "vignetteSoftness": 0.4,
      "vignetteRoundness": 0.5,
      "vignetteShape": 0,
      "vignetteAspect": 1,
      "vignetteCenterX": 0.5,
      "vignetteCenterY": 0.5,
      "vignetteColorR": 0,
      "vignetteColorG": 0,
      "vignetteColorB": 0,
      "vignetteTintAmount": 0,
      "vignetteBreathing": 0,
      "vignetteBreathSpeed": 0.5
    },
    "controls": [
      {
        "name": "Size",
        "param": "vignetteSize",
        "min": 0,
        "max": 1.5,
        "step": 0.01,
        "default": 0.8
      },
      {
        "name": "Softness",
        "param": "vignetteSoftness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Roundness",
        "param": "vignetteRoundness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Shape",
        "param": "vignetteShape",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Round (legacy)"
          },
          {
            "value": 1,
            "label": "Oval"
          },
          {
            "value": 2,
            "label": "Square"
          },
          {
            "value": 3,
            "label": "Superellipse"
          }
        ]
      },
      {
        "name": "Aspect",
        "param": "vignetteAspect",
        "min": 0.3,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Center X",
        "param": "vignetteCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "vignetteCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Tint R",
        "param": "vignetteColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tint G",
        "param": "vignetteColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tint B",
        "param": "vignetteColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tint Amount",
        "param": "vignetteTintAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Breathing",
        "param": "vignetteBreathing",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Breath Speed",
        "param": "vignetteBreathSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.5
      }
    ],
    "integerParams": []
  },
  {
    "type": "edgeFeather",
    "label": "Edge Feather",
    "category": "Masking",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float featherTop;          // 0-1 feather amount from top\n  uniform float featherBottom;       // 0-1 feather amount from bottom\n  uniform float featherLeft;         // 0-1 feather amount from left\n  uniform float featherRight;        // 0-1 feather amount from right\n  uniform float featherSoftness;     // 0-1 overall softness modifier\n  // Hero-rewrite params\n  uniform float featherGamma;        // 0.2-3.0 — falloff curve (1.0 = linear, <1 = sharper, >1 = softer)\n  uniform float featherMattePreview; // 0=normal, 1=matte preview (alpha as red overlay)\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n\n    float alpha = 1.0;\n\n    if (featherTop > 0.0)    alpha *= smoothstep(1.0, 1.0 - featherTop, vUv.y);\n    if (featherBottom > 0.0) alpha *= smoothstep(0.0, featherBottom, vUv.y);\n    if (featherLeft > 0.0)   alpha *= smoothstep(0.0, featherLeft, vUv.x);\n    if (featherRight > 0.0)  alpha *= smoothstep(1.0, 1.0 - featherRight, vUv.x);\n\n    // Apply overall softness modifier (legacy behavior).\n    alpha = pow(alpha, 1.0 / max(featherSoftness + 0.5, 0.1));\n\n    // Gamma-aware falloff. Projector edge-blending is GAMMA-space, not\n    // linear. featherGamma=2.2 produces the curve real projectors blend with\n    // — falls off slowly in the bright zone then quickly at the edge.\n    // featherGamma=1 = current behavior; <1 sharpens for hard masks.\n    alpha = pow(alpha, max(featherGamma, 0.0001));\n\n    // Matte preview: bypass the image and render alpha as a translucent\n    // red overlay so the user can SEE the feather shape they're\n    // dialling in. Same trick After Effects uses for shape masks.\n    if (featherMattePreview > 0.5) {\n      vec3 matteR = vec3(1.0, 0.0, 0.0);\n      vec3 inv = vec3(1.0) - matteR;\n      // Show the feather as red opacity, opaque-black elsewhere.\n      gl_FragColor = vec4(mix(vec3(0.0), matteR, 1.0 - alpha), 1.0);\n      return;\n    }\n\n    gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);\n  }\n",
    "defaults": {
      "featherTop": 0,
      "featherBottom": 0,
      "featherLeft": 0,
      "featherRight": 0,
      "featherSoftness": 0.5,
      "featherGamma": 1,
      "featherMattePreview": 0
    },
    "controls": [
      {
        "name": "Top",
        "param": "featherTop",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Bottom",
        "param": "featherBottom",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Left",
        "param": "featherLeft",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Right",
        "param": "featherRight",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Softness",
        "param": "featherSoftness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Gamma Curve",
        "param": "featherGamma",
        "min": 0.2,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Matte Preview",
        "param": "featherMattePreview",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Off (normal render)"
          },
          {
            "value": 1,
            "label": "On (red overlay)"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "colorama",
    "label": "Colorama",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float coloramaPalette;       // 0-11 named palettes (Rainbow, Sunset, Ocean, Neon, Fire,\n                                //   Forest, Ice, Psychedelic, Vaporwave, Club, Pastel, Mono)\n  uniform float coloramaOffset;        // 0-1 manual offset through palette\n  uniform float coloramaSpeed;         // 0-2 auto-cycle speed (0 = off)\n  uniform float coloramaContrast;      // 0.5-2 luminance contrast\n  uniform float coloramaMix;           // 0-1 blend with original\n  uniform float coloramaBands;         // 0 = smooth gradient, 1-32 = posterized into N bands\n  uniform float coloramaAudioReact;    // 0-1 how much audio modulates the cycling (0 = ignore audio)\n  uniform float coloramaHueShift;      // 0-1 fixed rotation through palette (separate from auto-cycle)\n  uniform float uAudio;         // 0-1 live audio rms (set by renderer per frame)\n  uniform float uTime;\n  varying vec2 vUv;\n\n  #define PI 3.14159265359\n  #define TAU 6.28318530718\n\n  // Cosine palette function: a + b * cos(2π * (c * t + d))\n  vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {\n    return a + b * cos(TAU * (c * t + d));\n  }\n\n  // 12 named palettes — coefficients for the cosine-palette formula.\n  // Indices here MUST match the dropdown labels in effectUX.ts.\n  vec3 getPaletteColor(float t, int palette) {\n    vec3 a, b, c, d;\n\n    if (palette == 0) {\n      // 0 — Rainbow (classic full-spectrum cycle)\n      a = vec3(0.5, 0.5, 0.5);\n      b = vec3(0.5, 0.5, 0.5);\n      c = vec3(1.0, 1.0, 1.0);\n      d = vec3(0.0, 0.33, 0.67);\n    }\n    else if (palette == 1) {\n      // 1 — Sunset (warm oranges, magentas, deep purples)\n      a = vec3(0.5, 0.5, 0.5);\n      b = vec3(0.5, 0.5, 0.5);\n      c = vec3(1.0, 1.0, 1.0);\n      d = vec3(0.0, 0.1, 0.2);\n    }\n    else if (palette == 2) {\n      // 2 — Ocean (teals and deep blues)\n      a = vec3(0.5, 0.5, 0.5);\n      b = vec3(0.5, 0.5, 0.5);\n      c = vec3(1.0, 1.0, 1.0);\n      d = vec3(0.3, 0.2, 0.2);\n    }\n    else if (palette == 3) {\n      // 3 — Neon (vibrant pinks, cyans)\n      a = vec3(0.5, 0.5, 0.5);\n      b = vec3(0.5, 0.5, 0.5);\n      c = vec3(1.0, 1.0, 0.5);\n      d = vec3(0.8, 0.9, 0.3);\n    }\n    else if (palette == 4) {\n      // 4 — Fire (reds → oranges → yellows)\n      a = vec3(0.5, 0.5, 0.5);\n      b = vec3(0.5, 0.5, 0.5);\n      c = vec3(1.0, 0.7, 0.4);\n      d = vec3(0.0, 0.15, 0.2);\n    }\n    else if (palette == 5) {\n      // 5 — Forest (greens with earthy browns)\n      a = vec3(0.5, 0.5, 0.5);\n      b = vec3(0.5, 0.5, 0.5);\n      c = vec3(1.0, 1.0, 1.0);\n      d = vec3(0.0, 0.1, 0.0);\n    }\n    else if (palette == 6) {\n      // 6 — Ice (whites, blues, cyan highlights)\n      a = vec3(0.8, 0.8, 0.9);\n      b = vec3(0.2, 0.4, 0.2);\n      c = vec3(1.0, 1.0, 1.0);\n      d = vec3(0.0, 0.25, 0.25);\n    }\n    else if (palette == 7) {\n      // 7 — Psychedelic (rapid hue swings)\n      a = vec3(0.5, 0.5, 0.5);\n      b = vec3(0.5, 0.5, 0.5);\n      c = vec3(2.0, 1.0, 0.0);\n      d = vec3(0.5, 0.2, 0.25);\n    }\n    else if (palette == 8) {\n      // 8 — Vaporwave (hot pink → purple → teal — 80s synth aesthetic)\n      a = vec3(0.6, 0.4, 0.7);\n      b = vec3(0.4, 0.4, 0.4);\n      c = vec3(1.0, 1.0, 0.5);\n      d = vec3(0.0, 0.15, 0.50);\n    }\n    else if (palette == 9) {\n      // 9 — Club (saturated cyan/magenta/yellow stage-light cycle)\n      a = vec3(0.55, 0.45, 0.55);\n      b = vec3(0.55, 0.5, 0.5);\n      c = vec3(1.5, 1.5, 1.0);\n      d = vec3(0.0, 0.5, 0.85);\n    }\n    else if (palette == 10) {\n      // 10 — Pastel (soft pinks, mint, baby blue)\n      a = vec3(0.85, 0.8, 0.85);\n      b = vec3(0.15, 0.18, 0.15);\n      c = vec3(1.0, 1.0, 1.0);\n      d = vec3(0.0, 0.33, 0.67);\n    }\n    else {\n      // 11 — Mono Glow (single-hue luminance ramp, hue picked by coloramaHueShift)\n      // Use coloramaHueShift as a hue offset on a simple HSV-style cycle. We\n      // approximate this with a cosine palette whose d-vector is shifted.\n      float h = mod(coloramaHueShift, 1.0);\n      a = vec3(0.5);\n      b = vec3(0.5);\n      c = vec3(1.0);\n      d = vec3(h, h + 0.33, h + 0.67);\n    }\n\n    return cosinePalette(t, a, b, c, d);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 color = texColor.rgb;\n\n    // Calculate luminance\n    float lum = dot(color, vec3(0.299, 0.587, 0.114));\n\n    // Apply contrast to luminance\n    lum = (lum - 0.5) * coloramaContrast + 0.5;\n    lum = clamp(lum, 0.0, 1.0);\n\n    // Posterize: snap luminance to discrete bands BEFORE palette lookup.\n    if (coloramaBands >= 0.5) {\n      float steps = floor(coloramaBands + 0.5);\n      lum = floor(lum * steps) / max(steps - 1.0, 1.0);\n      lum = clamp(lum, 0.0, 1.0);\n    }\n\n    // Audio reactivity: live audio RMS modulates the cycling offset.\n    float audioPunch = clamp(uAudio, 0.0, 1.5) * coloramaAudioReact;\n\n    // Total palette parameter: luminance + manual offset + auto-cycle\n    // + hue shift + audio punch.\n    float t = lum + coloramaOffset + uTime * coloramaSpeed + coloramaHueShift + audioPunch;\n\n    // Get palette color\n    int paletteIndex = int(coloramaPalette);\n    vec3 paletteColor = getPaletteColor(t, paletteIndex);\n\n    // Mix with original based on mix parameter\n    vec3 finalColor = mix(color, paletteColor, coloramaMix);\n\n    gl_FragColor = vec4(finalColor, texColor.a);\n  }\n",
    "defaults": {
      "coloramaPalette": 0,
      "coloramaOffset": 0,
      "coloramaSpeed": 0.2,
      "coloramaContrast": 1,
      "coloramaMix": 1,
      "coloramaBands": 0,
      "coloramaAudioReact": 0,
      "coloramaHueShift": 0
    },
    "controls": [
      {
        "name": "Palette",
        "param": "coloramaPalette",
        "min": 0,
        "max": 11,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Rainbow"
          },
          {
            "value": 1,
            "label": "Sunset"
          },
          {
            "value": 2,
            "label": "Ocean"
          },
          {
            "value": 3,
            "label": "Neon"
          },
          {
            "value": 4,
            "label": "Fire"
          },
          {
            "value": 5,
            "label": "Forest"
          },
          {
            "value": 6,
            "label": "Ice"
          },
          {
            "value": 7,
            "label": "Psychedelic"
          },
          {
            "value": 8,
            "label": "Vaporwave"
          },
          {
            "value": 9,
            "label": "Club"
          },
          {
            "value": 10,
            "label": "Pastel"
          },
          {
            "value": 11,
            "label": "Mono Glow"
          }
        ]
      },
      {
        "name": "Offset",
        "param": "coloramaOffset",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Speed",
        "param": "coloramaSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Contrast",
        "param": "coloramaContrast",
        "min": 0.5,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mix",
        "param": "coloramaMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Posterize Bands",
        "param": "coloramaBands",
        "min": 0,
        "max": 32,
        "step": 1,
        "default": 0
      },
      {
        "name": "Audio Reactivity",
        "param": "coloramaAudioReact",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Hue Shift",
        "param": "coloramaHueShift",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "plasma",
    "label": "Plasma",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float plasmaSpeed;\n  uniform float plasmaScale;\n  uniform float plasmaComplexity;\n  uniform float plasmaPalette;\n  uniform float plasmaMode;\n  uniform float plasmaBlendMode;\n  uniform float plasmaMix;\n  uniform float plasmaWarpAmount;\n  uniform float plasmaAudioReact;\n  uniform float uAudio;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  vec3 rainbowPalette(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }\n  vec3 firePalette(float t) { return vec3(smoothstep(0.0, 0.5, t), smoothstep(0.3, 0.7, t) * 0.7, smoothstep(0.7, 1.0, t) * 0.3); }\n  vec3 oceanPalette(float t) { return vec3(smoothstep(0.5, 1.0, t) * 0.3, smoothstep(0.2, 0.8, t) * 0.6 + 0.2, 0.4 + 0.6 * t); }\n  vec3 neonPalette(float t) {\n    float r = sin(t * 6.28318) * 0.5 + 0.5;\n    float g = sin(t * 6.28318 + 2.094) * 0.5 + 0.5;\n    float b = sin(t * 6.28318 + 4.188) * 0.5 + 0.5;\n    return pow(vec3(r, g, b), vec3(0.5));\n  }\n  vec3 matrixPalette(float t) { return vec3(0.0, t * 0.8 + 0.2, t * 0.3); }\n  vec3 lavaPalette(float t) { return vec3(smoothstep(0.0, 0.4, t) * 1.0, smoothstep(0.3, 0.85, t) * 0.6, smoothstep(0.85, 1.0, t) * 0.4); }\n  vec3 icePalette(float t) { return vec3(0.4 * t + smoothstep(0.7, 1.0, t) * 0.6, 0.2 + 0.6 * t, 0.5 + 0.5 * t); }\n  vec3 stormPalette(float t) {\n    vec3 dark = vec3(0.08, 0.08, 0.12);\n    vec3 mid  = vec3(0.45, 0.35, 0.55);\n    vec3 hi   = vec3(0.95, 0.95, 1.00);\n    return mix(mix(dark, mid, smoothstep(0.0, 0.6, t)), hi, smoothstep(0.7, 1.0, t));\n  }\n\n  float plasmaField(vec2 p, float t, float complexity) {\n    float plasma = 0.0;\n    plasma += sin(p.x * 10.0 + t);\n    plasma += sin(p.y * 10.0 + t * 1.1);\n    plasma += sin((p.x + p.y) * 10.0 + t * 0.5);\n    plasma += sin(sqrt(p.x * p.x + p.y * p.y) * 10.0 + t * 0.7);\n    if (complexity > 1.0) plasma += sin(p.x * 5.0 + sin(p.y * 3.0 + t) * 2.0);\n    if (complexity > 2.0) plasma += sin(p.y * 7.0 + sin(p.x * 5.0 + t * 1.3) * 2.0);\n    if (complexity > 3.0) plasma += sin(length(p - vec2(0.5 * plasmaScale)) * 8.0 - t * 2.0);\n    if (complexity > 4.0) plasma += sin(atan(p.y - 0.5 * plasmaScale, p.x - 0.5 * plasmaScale) * 5.0 + t);\n    return plasma / (4.0 + max(complexity - 1.0, 0.0)) * 0.5 + 0.5;\n  }\n\n  vec3 paletteLookup(int paletteType, float t) {\n    if (paletteType == 0) return rainbowPalette(t);\n    if (paletteType == 1) return firePalette(t);\n    if (paletteType == 2) return oceanPalette(t);\n    if (paletteType == 3) return neonPalette(t);\n    if (paletteType == 4) return matrixPalette(t);\n    if (paletteType == 5) return lavaPalette(t);\n    if (paletteType == 6) return icePalette(t);\n    return stormPalette(t);\n  }\n\n  vec3 applyBlend(vec3 base, vec3 plasmaCol, int mode) {\n    if (mode == 0) return base * plasmaCol;\n    if (mode == 1) return 1.0 - (1.0 - base) * (1.0 - plasmaCol);\n    if (mode == 2) return min(base + plasmaCol, vec3(1.0));\n    if (mode == 3) {\n      vec3 lo = 2.0 * base * plasmaCol;\n      vec3 hi = 1.0 - 2.0 * (1.0 - base) * (1.0 - plasmaCol);\n      return mix(lo, hi, step(0.5, base));\n    }\n    return plasmaCol;\n  }\n\n  void main() {\n    float audioPunch = clamp(uAudio, 0.0, 1.5) * plasmaAudioReact;\n    float effectiveScale = plasmaScale * (1.0 + audioPunch * 0.6);\n    float t = uTime * plasmaSpeed;\n    vec2 p = vUv * effectiveScale;\n    int mode = int(plasmaMode + 0.5);\n\n    vec2 sampleUv = vUv;\n    if (mode == 1 || mode == 2) {\n      vec2 warpField = vec2(\n        plasmaField(p * 0.5 + vec2(0.0, 1.7), t * 0.7, max(plasmaComplexity, 2.0)),\n        plasmaField(p * 0.5 + vec2(3.1, 0.0), t * 0.9, max(plasmaComplexity, 2.0))\n      ) - 0.5;\n      sampleUv += warpField * plasmaWarpAmount * 0.18;\n    }\n    vec4 texColor = texture2D(uInput, sampleUv);\n\n    if (mode == 1) {\n      vec3 finalRgb = mix(texture2D(uInput, vUv).rgb, texColor.rgb, plasmaMix);\n      gl_FragColor = vec4(finalRgb, texColor.a);\n      return;\n    }\n\n    float plasma = plasmaField(p, t, plasmaComplexity);\n    int paletteType = int(plasmaPalette);\n    vec3 plasmaColor = paletteLookup(paletteType, plasma);\n    int blendMode = int(plasmaBlendMode + 0.5);\n    vec3 blended = applyBlend(texColor.rgb, plasmaColor, blendMode);\n    vec3 finalColor = mix(texColor.rgb, blended, plasmaMix);\n    gl_FragColor = vec4(finalColor, texColor.a);\n  }\n",
    "defaults": {
      "plasmaSpeed": 1,
      "plasmaScale": 5,
      "plasmaComplexity": 3,
      "plasmaPalette": 0,
      "plasmaMode": 0,
      "plasmaBlendMode": 0,
      "plasmaMix": 1,
      "plasmaWarpAmount": 0.4,
      "plasmaAudioReact": 0
    },
    "controls": [
      {
        "name": "Speed",
        "param": "plasmaSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Scale",
        "param": "plasmaScale",
        "min": 1,
        "max": 20,
        "step": 0.1,
        "default": 5
      },
      {
        "name": "Complexity",
        "param": "plasmaComplexity",
        "min": 1,
        "max": 5,
        "step": 1,
        "default": 3
      },
      {
        "name": "Palette",
        "param": "plasmaPalette",
        "min": 0,
        "max": 7,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Rainbow"
          },
          {
            "value": 1,
            "label": "Fire"
          },
          {
            "value": 2,
            "label": "Ocean"
          },
          {
            "value": 3,
            "label": "Neon"
          },
          {
            "value": 4,
            "label": "Matrix"
          },
          {
            "value": 5,
            "label": "Lava"
          },
          {
            "value": 6,
            "label": "Ice"
          },
          {
            "value": 7,
            "label": "Storm"
          }
        ]
      },
      {
        "name": "Mode",
        "param": "plasmaMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Color Overlay"
          },
          {
            "value": 1,
            "label": "Turbulence Warp"
          },
          {
            "value": 2,
            "label": "Color + Warp"
          }
        ]
      },
      {
        "name": "Blend",
        "param": "plasmaBlendMode",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Multiply"
          },
          {
            "value": 1,
            "label": "Screen"
          },
          {
            "value": 2,
            "label": "Add"
          },
          {
            "value": 3,
            "label": "Overlay"
          },
          {
            "value": 4,
            "label": "Replace"
          }
        ]
      },
      {
        "name": "Mix",
        "param": "plasmaMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Warp Amount",
        "param": "plasmaWarpAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Audio Reactivity",
        "param": "plasmaAudioReact",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "invert",
    "label": "Invert",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float invertMode;        // 0=RGB,1=luma-only,2=hue,3=strobe,4=threshold-above\n  uniform float invertAmount;      // 0-1 invert strength (partial invert at <1)\n  uniform float invertThreshold;   // 0-1 — used in threshold mode (invert pixels brighter than this)\n  uniform float invertStrobeRate;  // 0-10 — strobe Hz when invertMode=3\n  uniform float uTime;\n  varying vec2 vUv;\n\n  vec3 rgb2hsv(vec3 c) {\n    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);\n    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n    float d = q.x - min(q.w, q.y);\n    float e = 1.0e-10;\n    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);\n  }\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb;\n    int mode = int(invertMode + 0.5);\n\n    vec3 inverted = src;\n\n    if (mode == 0) {\n      // RGB invert (legacy at amount=1)\n      inverted = 1.0 - src;\n    } else if (mode == 1) {\n      // Luma-only — invert brightness, keep hue/saturation. Useful for\n      // \"x-ray\" look where colors stay but light/dark flip.\n      vec3 hsv = rgb2hsv(src);\n      hsv.z = 1.0 - hsv.z;\n      inverted = hsv2rgb(hsv);\n    } else if (mode == 2) {\n      // Hue invert — rotate hue 180° (complement colors). Keeps\n      // brightness/saturation; red→cyan, green→magenta, blue→yellow.\n      vec3 hsv = rgb2hsv(src);\n      hsv.x = fract(hsv.x + 0.5);\n      inverted = hsv2rgb(hsv);\n    } else if (mode == 3) {\n      // Strobe invert — alternates between original and inverted at\n      // invertStrobeRate Hz. Phase = floor(time * rate) % 2.\n      float phase = mod(floor(uTime * max(invertStrobeRate, 0.01)), 2.0);\n      inverted = mix(src, 1.0 - src, phase);\n    } else {\n      // Threshold-above — invert pixels brighter than invertThreshold,\n      // leave shadows untouched. Great for crushing highlights.\n      float lum = dot(src, vec3(0.299, 0.587, 0.114));\n      float invertMask = smoothstep(invertThreshold - 0.02, invertThreshold + 0.02, lum);\n      inverted = mix(src, 1.0 - src, invertMask);\n    }\n\n    // Partial-invert: blend toward the inverted result by invertAmount.\n    vec3 finalColor = mix(src, inverted, invertAmount);\n\n    gl_FragColor = vec4(finalColor, texColor.a);\n  }\n",
    "defaults": {
      "invertMode": 0,
      "invertAmount": 1,
      "invertThreshold": 0.5,
      "invertStrobeRate": 4
    },
    "controls": [
      {
        "name": "Mode",
        "param": "invertMode",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "RGB Invert"
          },
          {
            "value": 1,
            "label": "Luma Only (X-ray)"
          },
          {
            "value": 2,
            "label": "Hue (180° rotate)"
          },
          {
            "value": 3,
            "label": "Strobe"
          },
          {
            "value": 4,
            "label": "Threshold (highlights only)"
          }
        ]
      },
      {
        "name": "Amount",
        "param": "invertAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Threshold",
        "param": "invertThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Strobe Rate (Hz)",
        "param": "invertStrobeRate",
        "min": 0,
        "max": 10,
        "step": 0.1,
        "default": 4
      }
    ],
    "integerParams": []
  },
  {
    "type": "dither",
    "label": "Dither",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float ditherType;        // 0=bayer, 1=blueNoise, 2=halftone, 3=atkinson, 4=floydSteinberg\n  uniform float ditherIntensity;   // 0-1\n  uniform float ditherScale;       // 1-16\n  uniform float ditherColorDepth;  // 1-8 bits\n  uniform float ditherPalette;     // 0=free, 1=mono, 2=CGA-4, 3=EGA-8, 4=GameBoy, 5=Amber-CRT\n  uniform float ditherPixelLock;   // 0=continuous, 1=snap to integer pixel grid (no aliasing on resize)\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  // Snap to nearest fixed palette color. uses simple Euclidean distance.\n  vec3 snapPalette(vec3 c, int pal) {\n    if (pal == 1) {\n      // 1-bit mono — snap to black or white by luma.\n      float lum = dot(c, vec3(0.299, 0.587, 0.114));\n      return lum > 0.5 ? vec3(1.0) : vec3(0.0);\n    }\n    if (pal == 2) {\n      // CGA mode 4 palette 1 — black, cyan, magenta, white.\n      vec3 P[4]; P[0]=vec3(0.0); P[1]=vec3(0.0,1.0,1.0); P[2]=vec3(1.0,0.0,1.0); P[3]=vec3(1.0);\n      vec3 best = P[0]; float bd = 1e9;\n      for (int i = 0; i < 4; i++) { float d = dot(c-P[i], c-P[i]); if (d < bd) { bd = d; best = P[i]; } }\n      return best;\n    }\n    if (pal == 3) {\n      // EGA 8-color (high-intensity).\n      vec3 P[8];\n      P[0]=vec3(0.0); P[1]=vec3(0.0,0.0,0.67); P[2]=vec3(0.0,0.67,0.0); P[3]=vec3(0.0,0.67,0.67);\n      P[4]=vec3(0.67,0.0,0.0); P[5]=vec3(0.67,0.0,0.67); P[6]=vec3(0.67,0.33,0.0); P[7]=vec3(0.67);\n      vec3 best = P[0]; float bd = 1e9;\n      for (int i = 0; i < 8; i++) { float d = dot(c-P[i], c-P[i]); if (d < bd) { bd = d; best = P[i]; } }\n      return best;\n    }\n    if (pal == 4) {\n      // Game Boy 4-shade green.\n      vec3 P[4];\n      P[0]=vec3(0.06,0.22,0.06); P[1]=vec3(0.19,0.38,0.19); P[2]=vec3(0.55,0.67,0.06); P[3]=vec3(0.61,0.74,0.06);\n      float lum = dot(c, vec3(0.299, 0.587, 0.114));\n      int idx = int(clamp(floor(lum * 4.0), 0.0, 3.0));\n      return (idx==0?P[0]:idx==1?P[1]:idx==2?P[2]:P[3]);\n    }\n    if (pal == 5) {\n      // Amber CRT — black, dim amber, mid amber, bright amber.\n      float lum = dot(c, vec3(0.299, 0.587, 0.114));\n      return mix(vec3(0.0), vec3(1.0, 0.65, 0.0), smoothstep(0.0, 1.0, lum));\n    }\n    return c; // pal == 0 free\n  }\n\n  // High-quality Bayer 8x8 matrix with proper thresholds\n  float bayer8(vec2 pos) {\n    vec2 p = mod(pos, 8.0);\n    float x = p.x;\n    float y = p.y;\n\n    // Recursive Bayer matrix calculation (much cleaner than lookup)\n    float threshold = 0.0;\n    float divisor = 64.0;\n\n    // 8x8 Bayer using bit manipulation logic\n    for (int i = 0; i < 3; i++) {\n      float mx = mod(x, 2.0);\n      float my = mod(y, 2.0);\n      threshold += (mx + my * 2.0) * divisor / 4.0;\n      divisor /= 4.0;\n      x = floor(x / 2.0);\n      y = floor(y / 2.0);\n    }\n\n    return threshold / 64.0;\n  }\n\n  // Blue noise approximation using layered randomness\n  float blueNoise(vec2 pos) {\n    float n = 0.0;\n    float scale = 1.0;\n\n    for (int i = 0; i < 4; i++) {\n      vec2 p = pos * scale;\n      float r = fract(sin(dot(floor(p), vec2(12.9898, 78.233) + float(i) * 100.0)) * 43758.5453);\n      n += r / scale;\n      scale *= 2.0;\n    }\n\n    return fract(n * 0.25 + uTime * 0.01);\n  }\n\n  // Premium halftone with angle and smooth dots\n  float halftone(vec2 pos, float angle) {\n    float c = cos(angle);\n    float s = sin(angle);\n    mat2 rot = mat2(c, -s, s, c);\n    vec2 p = rot * pos;\n\n    vec2 nearest = floor(p) + 0.5;\n    float dist = length(p - nearest);\n\n    // Smooth dot with antialiasing\n    return smoothstep(0.5, 0.3, dist);\n  }\n\n  // Atkinson-style dithering pattern (used by old Mac)\n  float atkinsonPattern(vec2 pos) {\n    vec2 p = mod(pos, 4.0);\n    float pattern = 0.0;\n\n    // Classic Atkinson-style sparse pattern\n    if ((p.x < 2.0 && p.y < 2.0) || (p.x >= 2.0 && p.y >= 2.0)) {\n      pattern = mod(p.x + p.y, 2.0);\n    } else {\n      pattern = 1.0 - mod(p.x + p.y, 2.0);\n    }\n\n    return pattern * 0.5 + bayer8(pos) * 0.5;\n  }\n\n  // Floyd-Steinberg style error propagation simulation\n  float floydSteinberg(vec2 pos, vec3 color) {\n    // Simulated error diffusion using neighbor sampling\n    float lum = dot(color, vec3(0.299, 0.587, 0.114));\n\n    // Sample neighbors to simulate error propagation\n    vec2 offset1 = vec2(1.0, 0.0) / uResolution * ditherScale;\n    vec2 offset2 = vec2(-1.0, 1.0) / uResolution * ditherScale;\n    vec2 offset3 = vec2(0.0, 1.0) / uResolution * ditherScale;\n    vec2 offset4 = vec2(1.0, 1.0) / uResolution * ditherScale;\n\n    float n1 = dot(texture2D(uInput, vUv + offset1).rgb, vec3(0.299, 0.587, 0.114));\n    float n2 = dot(texture2D(uInput, vUv + offset2).rgb, vec3(0.299, 0.587, 0.114));\n    float n3 = dot(texture2D(uInput, vUv + offset3).rgb, vec3(0.299, 0.587, 0.114));\n    float n4 = dot(texture2D(uInput, vUv + offset4).rgb, vec3(0.299, 0.587, 0.114));\n\n    // Weighted average simulating error propagation\n    float errorSim = (lum * 16.0 + n1 * 7.0 + n2 * 3.0 + n3 * 5.0 + n4 * 1.0) / 32.0;\n\n    return fract(errorSim * 8.0 + bayer8(pos) * 0.5);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 color = texColor.rgb;\n\n    // Calculate scaled pixel position. With pixel-lock, snap to integer\n    // pixel coords so the pattern doesn't shimmer when the canvas resizes.\n    vec2 pixelPos = vUv * uResolution / max(ditherScale, 0.5);\n    if (ditherPixelLock > 0.5) pixelPos = floor(pixelPos);\n\n    // Get threshold based on dither type - use float comparisons for WebGL compat\n    float threshold = 0.0;\n\n    if (ditherType < 0.5) {\n      // Classic Bayer ordered dithering\n      threshold = bayer8(pixelPos);\n    } else if (ditherType < 1.5) {\n      // Blue noise dithering (film-like grain)\n      threshold = blueNoise(pixelPos);\n    } else if (ditherType < 2.5) {\n      // Halftone printing style\n      float lumR = color.r;\n      float lumG = color.g;\n      float lumB = color.b;\n\n      // CMYK-style halftone angles\n      float hR = halftone(pixelPos, 0.261799);  // 15 degrees\n      float hG = halftone(pixelPos, 1.309);     // 75 degrees\n      float hB = halftone(pixelPos, 0.0);       // 0 degrees\n\n      vec3 halftoneColor = vec3(\n        step(1.0 - lumR, hR),\n        step(1.0 - lumG, hG),\n        step(1.0 - lumB, hB)\n      );\n\n      gl_FragColor = vec4(mix(color, halftoneColor, ditherIntensity), texColor.a);\n      return;\n    } else if (ditherType < 3.5) {\n      // Atkinson dithering (classic Mac style)\n      threshold = atkinsonPattern(pixelPos);\n    } else {\n      // Floyd-Steinberg simulation\n      threshold = floydSteinberg(pixelPos, color);\n    }\n\n    // Apply threshold with intensity control\n    threshold = (threshold - 0.5) * ditherIntensity;\n\n    // Quantize to color depth, then optionally snap to a fixed palette.\n    float levels = pow(2.0, ditherColorDepth);\n    vec3 dithered = color + vec3(threshold) / levels;\n    dithered = floor(dithered * levels + 0.5) / levels;\n    int pal = int(ditherPalette + 0.5);\n    if (pal > 0) dithered = snapPalette(dithered, pal);\n\n    gl_FragColor = vec4(clamp(dithered, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "ditherType": 0,
      "ditherIntensity": 1,
      "ditherScale": 1,
      "ditherColorDepth": 2,
      "ditherPalette": 0,
      "ditherPixelLock": 0
    },
    "controls": [
      {
        "name": "Algorithm",
        "param": "ditherType",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Bayer 4×4"
          },
          {
            "value": 1,
            "label": "Bayer 8×8"
          },
          {
            "value": 2,
            "label": "Blue Noise"
          },
          {
            "value": 3,
            "label": "Ordered"
          },
          {
            "value": 4,
            "label": "Hash"
          }
        ]
      },
      {
        "name": "Intensity",
        "param": "ditherIntensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Pattern Scale",
        "param": "ditherScale",
        "min": 1,
        "max": 16,
        "step": 1,
        "default": 1
      },
      {
        "name": "Color Depth",
        "param": "ditherColorDepth",
        "min": 1,
        "max": 8,
        "step": 1,
        "default": 2
      },
      {
        "name": "Palette",
        "param": "ditherPalette",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Free RGB"
          },
          {
            "value": 1,
            "label": "GameBoy Green"
          },
          {
            "value": 2,
            "label": "CGA"
          },
          {
            "value": 3,
            "label": "Mono 1-bit"
          },
          {
            "value": 4,
            "label": "C64"
          }
        ]
      },
      {
        "name": "Pixel Lock",
        "param": "ditherPixelLock",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "posterize",
    "label": "Posterize",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float posterizeLevels;        // 2-32 color levels per channel\n  uniform float posterizeDither;  // 0-1 — Bayer 4×4 ordered dither strength\n  uniform float posterizeAnimSpeed;     // 0-2 — animated level stepping speed (0 = static)\n  uniform float posterizePalette;   // 0=free RGB, 1=comic, 2=thermal, 3=retro 4-color\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  // Bayer 4×4 dither matrix in [0..1] range (after /16).\n  float bayer4(vec2 pos) {\n    int x = int(mod(pos.x, 4.0));\n    int y = int(mod(pos.y, 4.0));\n    int idx = x + y * 4;\n    // Unrolled Bayer 4x4 (standard ordering scaled by 1/16).\n    float m =\n      idx == 0  ?  0.0 :\n      idx == 1  ?  8.0 :\n      idx == 2  ?  2.0 :\n      idx == 3  ? 10.0 :\n      idx == 4  ? 12.0 :\n      idx == 5  ?  4.0 :\n      idx == 6  ? 14.0 :\n      idx == 7  ?  6.0 :\n      idx == 8  ?  3.0 :\n      idx == 9  ? 11.0 :\n      idx == 10 ?  1.0 :\n      idx == 11 ?  9.0 :\n      idx == 12 ? 15.0 :\n      idx == 13 ?  7.0 :\n      idx == 14 ? 13.0 : 5.0;\n    return (m + 0.5) / 16.0 - 0.5;\n  }\n\n  // Snap an RGB color to the nearest entry in a fixed palette.\n  vec3 snapToPalette(vec3 c, int palette) {\n    if (palette == 1) {\n      // Comic: 6 bold flat colors — black, red, yellow, green, blue, white.\n      vec3 palC[6];\n      palC[0] = vec3(0.05, 0.05, 0.05);\n      palC[1] = vec3(0.85, 0.10, 0.15);\n      palC[2] = vec3(0.95, 0.85, 0.10);\n      palC[3] = vec3(0.20, 0.65, 0.30);\n      palC[4] = vec3(0.10, 0.30, 0.85);\n      palC[5] = vec3(0.96, 0.96, 0.96);\n      vec3 best = palC[0];\n      float bestD = 1e9;\n      for (int i = 0; i < 6; i++) {\n        float d = dot(c - palC[i], c - palC[i]);\n        if (d < bestD) { bestD = d; best = palC[i]; }\n      }\n      return best;\n    } else if (palette == 2) {\n      // Thermal: 5-stop heatmap — black, blue, magenta, orange, white.\n      vec3 palT[5];\n      palT[0] = vec3(0.0, 0.0, 0.05);\n      palT[1] = vec3(0.05, 0.10, 0.55);\n      palT[2] = vec3(0.65, 0.15, 0.55);\n      palT[3] = vec3(0.95, 0.45, 0.10);\n      palT[4] = vec3(0.98, 0.96, 0.85);\n      float lum = dot(c, vec3(0.299, 0.587, 0.114));\n      float idx = clamp(lum * 4.0, 0.0, 4.0);\n      int i0 = int(floor(idx));\n      int i1 = min(i0 + 1, 4);\n      return mix((i0==0?palT[0]:i0==1?palT[1]:i0==2?palT[2]:i0==3?palT[3]:palT[4]), (i1==0?palT[0]:i1==1?palT[1]:i1==2?palT[2]:i1==3?palT[3]:palT[4]), fract(idx));\n    } else {\n      // Retro 4-color (Game Boy / classic LCD): dark green, mid green, light green, cream.\n      vec3 palR[4];\n      palR[0] = vec3(0.10, 0.20, 0.10);\n      palR[1] = vec3(0.30, 0.45, 0.25);\n      palR[2] = vec3(0.55, 0.70, 0.40);\n      palR[3] = vec3(0.85, 0.92, 0.70);\n      float lum = dot(c, vec3(0.299, 0.587, 0.114));\n      float idx = clamp(lum * 3.0, 0.0, 3.0);\n      int i0 = int(floor(idx));\n      int i1 = min(i0 + 1, 3);\n      return mix((i0==0?palR[0]:i0==1?palR[1]:i0==2?palR[2]:palR[3]), (i1==0?palR[0]:i1==1?palR[1]:i1==2?palR[2]:palR[3]), fract(idx));\n    }\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n\n    // Animated stepping — levels oscillates between half and full\n    // when posterizeAnimSpeed > 0. Creates a pulsing posterize.\n    float animLevels = posterizeLevels;\n    if (posterizeAnimSpeed > 0.001) {\n      float t = sin(uTime * posterizeAnimSpeed * 3.14159) * 0.5 + 0.5;\n      animLevels = mix(2.0, posterizeLevels, t);\n    }\n    float levels = max(2.0, floor(animLevels));\n\n    // Apply Bayer dither BEFORE quantization to break up banding.\n    vec3 src = texColor.rgb;\n    if (posterizeDither > 0.001) {\n      vec2 pxPos = vUv * uResolution;\n      float d = bayer4(pxPos);\n      src = clamp(src + d * posterizeDither / levels, 0.0, 1.0);\n    }\n\n    vec3 posterized;\n    int paletteMode = int(posterizePalette + 0.5);\n    if (paletteMode == 0) {\n      // Free RGB quantization (legacy behavior).\n      posterized = floor(src * levels) / (levels - 1.0);\n    } else {\n      // Snap to a fixed palette — posterizeLevels controls smoothness of the\n      // luma→palette interpolation indirectly through the dither.\n      posterized = snapToPalette(src, paletteMode);\n    }\n\n    gl_FragColor = vec4(posterized, texColor.a);\n  }\n",
    "defaults": {
      "posterizeLevels": 8,
      "posterizeDither": 0,
      "posterizeAnimSpeed": 0,
      "posterizePalette": 0
    },
    "controls": [
      {
        "name": "Levels",
        "param": "posterizeLevels",
        "min": 2,
        "max": 32,
        "step": 1,
        "default": 8
      },
      {
        "name": "Dither",
        "param": "posterizeDither",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Anim Speed",
        "param": "posterizeAnimSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Palette Lock",
        "param": "posterizePalette",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Free RGB (legacy)"
          },
          {
            "value": 1,
            "label": "Comic (6-color)"
          },
          {
            "value": 2,
            "label": "Thermal (heatmap)"
          },
          {
            "value": 3,
            "label": "Retro 4-color (Game Boy)"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "edgeDetect",
    "label": "Edge Detect",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float edgeThreshold;   // 0-1 edge threshold\n  uniform float edgeThickness;   // 0.5-3 line thickness\n  uniform float edgeMode;        // 0=sobel, 1=laplacian, 2=prewitt, 3=frei-chen, 4=color-edge\n  uniform float edgeInvert;      // 0=normal, 1=inverted\n  uniform float edgeTintR;       // 0-1 edge tint R (when edgeTintEdges > 0)\n  uniform float edgeTintG;\n  uniform float edgeTintB;\n  uniform float edgeTintEdges;   // 0-1 — 0=white edges (legacy), 1=full tint color\n  uniform float edgeGlow;        // 0-1 — bloom-style glow around edges\n  uniform float edgeOnlyAlpha;    // 0=show image+edges, 1=transparent fill (edges-only alpha)\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float edgeLum(vec3 c) {\n    return dot(c, vec3(0.299, 0.587, 0.114));\n  }\n\n  void main() {\n    vec2 texel = edgeThickness / uResolution;\n\n    // Sample 3x3 neighborhood\n    float tl = edgeLum(texture2D(uInput, vUv + vec2(-texel.x, texel.y)).rgb);\n    float tc = edgeLum(texture2D(uInput, vUv + vec2(0.0, texel.y)).rgb);\n    float tr = edgeLum(texture2D(uInput, vUv + vec2(texel.x, texel.y)).rgb);\n    float ml = edgeLum(texture2D(uInput, vUv + vec2(-texel.x, 0.0)).rgb);\n    float mc = edgeLum(texture2D(uInput, vUv).rgb);\n    float mr = edgeLum(texture2D(uInput, vUv + vec2(texel.x, 0.0)).rgb);\n    float bl = edgeLum(texture2D(uInput, vUv + vec2(-texel.x, -texel.y)).rgb);\n    float bc = edgeLum(texture2D(uInput, vUv + vec2(0.0, -texel.y)).rgb);\n    float br = edgeLum(texture2D(uInput, vUv + vec2(texel.x, -texel.y)).rgb);\n\n    float edge = 0.0;\n\n    // Use float comparisons for WebGL compatibility\n    if (edgeMode < 0.5) {\n      // Sobel operator\n      float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;\n      float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;\n      edge = sqrt(gx*gx + gy*gy);\n    } else if (edgeMode < 1.5) {\n      // Laplacian operator\n      edge = abs(-4.0*mc + tc + ml + mr + bc);\n    } else if (edgeMode < 2.5) {\n      // Prewitt operator\n      float gx = -tl - ml - bl + tr + mr + br;\n      float gy = -tl - tc - tr + bl + bc + br;\n      edge = sqrt(gx*gx + gy*gy);\n    } else {\n      // Frei-Chen operator (more isotropic)\n      float sq2 = 1.41421;\n      float gx = -tl - sq2*ml - bl + tr + sq2*mr + br;\n      float gy = -tl - sq2*tc - tr + bl + sq2*bc + br;\n      edge = sqrt(gx*gx + gy*gy) / (2.0 + sq2);\n    }\n\n    // Color-edge mode (edgeMode=4) — compute Sobel per channel and combine.\n    if (edgeMode > 3.5) {\n      vec3 cTL = texture2D(uInput, vUv + vec2(-texel.x, texel.y)).rgb;\n      vec3 cTR = texture2D(uInput, vUv + vec2(texel.x, texel.y)).rgb;\n      vec3 cBL = texture2D(uInput, vUv + vec2(-texel.x, -texel.y)).rgb;\n      vec3 cBR = texture2D(uInput, vUv + vec2(texel.x, -texel.y)).rgb;\n      vec3 cML = texture2D(uInput, vUv + vec2(-texel.x, 0.0)).rgb;\n      vec3 cMR = texture2D(uInput, vUv + vec2(texel.x, 0.0)).rgb;\n      vec3 cTC = texture2D(uInput, vUv + vec2(0.0, texel.y)).rgb;\n      vec3 cBC = texture2D(uInput, vUv + vec2(0.0, -texel.y)).rgb;\n      vec3 gxV = -cTL - 2.0*cML - cBL + cTR + 2.0*cMR + cBR;\n      vec3 gyV = -cTL - 2.0*cTC - cTR + cBL + 2.0*cBC + cBR;\n      vec3 edgeRGB = sqrt(gxV*gxV + gyV*gyV);\n      // Per-channel threshold + invert.\n      edgeRGB = smoothstep(vec3(edgeThreshold * 0.3), vec3(edgeThreshold * 0.8 + 0.02), edgeRGB);\n      if (edgeInvert > 0.5) edgeRGB = 1.0 - edgeRGB;\n      vec4 texColor = texture2D(uInput, vUv);\n      vec3 finalCol = edgeRGB;\n      float a = edgeOnlyAlpha > 0.5 ? max(max(edgeRGB.r, edgeRGB.g), edgeRGB.b) : texColor.a;\n      gl_FragColor = vec4(finalCol, a);\n      return;\n    }\n\n    edge = smoothstep(edgeThreshold * 0.3, edgeThreshold * 0.8 + 0.02, edge);\n    if (edgeInvert > 0.5) edge = 1.0 - edge;\n\n    // Tint edges from white to user color. edgeTintEdges=0 keeps legacy\n    // monochrome white edges; =1 fully replaces with the tint color.\n    vec3 tint = mix(vec3(1.0), vec3(edgeTintR, edgeTintG, edgeTintB), edgeTintEdges);\n    vec3 edgeColor = tint * edge;\n\n    // Glow — sample a wider neighborhood and add a bloom around edges.\n    if (edgeGlow > 0.001) {\n      float glowSum = 0.0;\n      for (int gi = -2; gi <= 2; gi++) {\n        for (int gj = -2; gj <= 2; gj++) {\n          vec2 off = vec2(float(gi), float(gj)) / uResolution * (2.0 + edgeGlow * 4.0);\n          float l = edgeLum(texture2D(uInput, vUv + off).rgb);\n          glowSum += l;\n        }\n      }\n      glowSum = (glowSum / 25.0) * edgeGlow * 0.6;\n      edgeColor += tint * glowSum;\n    }\n\n    vec4 texColor = texture2D(uInput, vUv);\n    if (edgeOnlyAlpha > 0.5) {\n      // Transparent body, edges only — alpha proportional to edge strength.\n      gl_FragColor = vec4(edgeColor, edge);\n    } else {\n      gl_FragColor = vec4(edgeColor, texColor.a);\n    }\n  }\n",
    "defaults": {
      "edgeThreshold": 0.1,
      "edgeThickness": 1,
      "edgeMode": 0,
      "edgeInvert": 0,
      "edgeTintR": 1,
      "edgeTintG": 1,
      "edgeTintB": 1,
      "edgeTintEdges": 0,
      "edgeGlow": 0,
      "edgeOnlyAlpha": 0
    },
    "controls": [
      {
        "name": "Threshold",
        "param": "edgeThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      },
      {
        "name": "Thickness",
        "param": "edgeThickness",
        "min": 0.5,
        "max": 3,
        "step": 0.1,
        "default": 1
      },
      {
        "name": "Algorithm",
        "param": "edgeMode",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Sobel"
          },
          {
            "value": 1,
            "label": "Laplacian"
          },
          {
            "value": 2,
            "label": "Prewitt"
          },
          {
            "value": 3,
            "label": "Frei-Chen"
          },
          {
            "value": 4,
            "label": "Color Edge"
          }
        ]
      },
      {
        "name": "Invert",
        "param": "edgeInvert",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Tint R",
        "param": "edgeTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "edgeTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint B",
        "param": "edgeTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint Edges",
        "param": "edgeTintEdges",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Edge Glow",
        "param": "edgeGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Edges Only (alpha)",
        "param": "edgeOnlyAlpha",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "emboss",
    "label": "Emboss",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float embossStrength;        // 0-2 emboss strength\n  uniform float embossAngle;           // 0-360 light direction\n  uniform float embossHeight;          // 0-1 surface height exaggeration\n  uniform float embossHighlightR;      // 0-1 highlight tint\n  uniform float embossHighlightG;\n  uniform float embossHighlightB;\n  uniform float embossShadowR;         // 0-1 shadow tint\n  uniform float embossShadowG;\n  uniform float embossShadowB;\n  uniform float embossNormalMode;      // 0=emboss (relit), 1=normal-map preview\n  uniform float embossMetallicness;    // 0-1 boosts highlight reflectivity\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float embossLum(vec3 c) {\n    return dot(c, vec3(0.299, 0.587, 0.114));\n  }\n\n  void main() {\n    vec2 texel = 1.0 / uResolution;\n    float angle = embossAngle * 3.14159265 / 180.0;\n    vec2 dir = vec2(cos(angle), sin(angle));\n\n    // Build a surface normal from luma gradients in 4 directions.\n    float lL = embossLum(texture2D(uInput, vUv - vec2(texel.x, 0.0)).rgb);\n    float lR = embossLum(texture2D(uInput, vUv + vec2(texel.x, 0.0)).rgb);\n    float lD = embossLum(texture2D(uInput, vUv - vec2(0.0, texel.y)).rgb);\n    float lU = embossLum(texture2D(uInput, vUv + vec2(0.0, texel.y)).rgb);\n    float dx = (lR - lL) * (1.0 + embossHeight * 4.0);\n    float dy = (lU - lD) * (1.0 + embossHeight * 4.0);\n    vec3 normal = normalize(vec3(-dx, -dy, 1.0));\n\n    // Normal-map preview — encode normal as RGB.\n    if (embossNormalMode > 0.5) {\n      gl_FragColor = vec4(normal * 0.5 + 0.5, texture2D(uInput, vUv).a);\n      return;\n    }\n\n    // Light direction in 3D from embossAngle (azimuth) and a fixed elevation.\n    vec3 light = normalize(vec3(dir.x, dir.y, 0.5));\n    float diff = max(dot(normal, light), 0.0);\n    float spec = pow(diff, mix(8.0, 64.0, embossMetallicness)) * embossMetallicness;\n\n    // Emboss intensity from gradient along light direction.\n    float along = (lR - lL) * dir.x + (lU - lD) * dir.y;\n    float emboss = clamp(along * embossStrength + 0.5, 0.0, 1.0);\n\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 hi = vec3(embossHighlightR, embossHighlightG, embossHighlightB);\n    vec3 lo = vec3(embossShadowR, embossShadowG, embossShadowB);\n    vec3 lit = mix(lo, hi, emboss);\n\n    // Blend the lit surface with the source color so detail isn't lost.\n    vec3 finalCol = texColor.rgb * 0.5 + lit + vec3(spec);\n\n    gl_FragColor = vec4(clamp(finalCol, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "embossStrength": 1,
      "embossAngle": 135,
      "embossHeight": 1,
      "embossHighlightR": 1,
      "embossHighlightG": 1,
      "embossHighlightB": 1,
      "embossShadowR": 0,
      "embossShadowG": 0,
      "embossShadowB": 0,
      "embossNormalMode": 0,
      "embossMetallicness": 0
    },
    "controls": [
      {
        "name": "Strength",
        "param": "embossStrength",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Light Angle",
        "param": "embossAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 135
      },
      {
        "name": "Height",
        "param": "embossHeight",
        "min": 0,
        "max": 4,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Hi R",
        "param": "embossHighlightR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Hi G",
        "param": "embossHighlightG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Hi B",
        "param": "embossHighlightB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Sh R",
        "param": "embossShadowR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Sh G",
        "param": "embossShadowG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Sh B",
        "param": "embossShadowB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mode",
        "param": "embossNormalMode",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Relight"
          },
          {
            "value": 1,
            "label": "Normal Preview"
          }
        ]
      },
      {
        "name": "Metallic",
        "param": "embossMetallicness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "vhs",
    "label": "VHS",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float vhsTracking;\n  uniform float vhsNoise;\n  uniform float vhsDistortion;\n  uniform float vhsColorBleed;\n  uniform float vhsScanlines;\n  uniform float vhsHeadSwitch;\n  uniform float vhsTapeWobble;\n  uniform float vhsDropout;\n  uniform float vhsChromaDelay;\n  uniform float vhsTrackingJump;\n  uniform float vhsSaturation;\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  float hash11(float seed) { return fract(sin(seed * 12.9898) * 43758.5453123); }\n  float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }\n  float noise(vec2 st) {\n    vec2 i = floor(st);\n    vec2 f = fract(st);\n    float a = random(i);\n    float b = random(i + vec2(1.0, 0.0));\n    float c = random(i + vec2(0.0, 1.0));\n    float d = random(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;\n  }\n\n  void main() {\n    vec2 uv = vUv;\n\n    // Tracking jump (vertical roll w/ snap).\n    float jumpTrigger = step(0.985, hash11(floor(uTime * 1.3))) * vhsTrackingJump;\n    float jumpAmount = vhsTrackingJump * 0.08 * (sin(uTime * 0.7) * 0.5 + 0.5);\n    uv.y = fract(uv.y + jumpAmount + jumpTrigger * 0.4);\n\n    // Tape wobble (capstan jitter).\n    float wobble = sin(uv.y * 4.0 + uTime * 1.5) * 0.6\n                 + sin(uv.y * 11.0 + uTime * 0.7) * 0.4;\n    uv.x += wobble * vhsTapeWobble * 0.012;\n\n    // Tracking distortion (legacy).\n    float trackingOffset = sin(uv.y * 10.0 + uTime * 3.0) * vhsTracking * 0.02;\n    trackingOffset += step(0.99, random(vec2(uTime * 0.1, uv.y))) * vhsTracking * 0.1;\n    uv.x += trackingOffset;\n\n    // Wave distortion (legacy).\n    uv.x += sin(uv.y * 50.0 + uTime * 10.0) * vhsDistortion * 0.003;\n    uv.y += sin(uv.x * 30.0 + uTime * 8.0) * vhsDistortion * 0.002;\n\n    // Head-switch tear band at bottom of frame.\n    float headBand = smoothstep(0.06, 0.0, uv.y);\n    float headTear = (random(vec2(floor(uv.y * 200.0), floor(uTime * 30.0))) - 0.5)\n                   * headBand * vhsHeadSwitch * 0.06;\n    uv.x += headTear;\n\n    // Sample with chroma bleed + delay.\n    float bleedAmount = vhsColorBleed * 0.005;\n    float chromaLag = vhsChromaDelay * 0.012;\n    vec4 color;\n    color.r = texture2D(uInput, vec2(uv.x + bleedAmount + chromaLag, uv.y)).r;\n    color.g = texture2D(uInput, uv).g;\n    color.b = texture2D(uInput, vec2(uv.x - bleedAmount - chromaLag, uv.y)).b;\n    color.a = texture2D(uInput, uv).a;\n\n    // Dropout bands.\n    float dropoutSeed = floor(uv.y * uResolution.y * 0.5) + floor(uTime * 4.0);\n    float dropoutHit = step(1.0 - vhsDropout * 0.04, hash11(dropoutSeed));\n    if (dropoutHit > 0.5) {\n      float dropoutKind = hash11(dropoutSeed + 7.3);\n      if (dropoutKind > 0.5) color.rgb = mix(color.rgb, vec3(1.0), 0.85);\n      else                    color.rgb = mix(color.rgb, vec3(0.0), 0.85);\n    }\n\n    // Luma noise.\n    float n = noise(uv * uResolution * 0.5 + uTime * 100.0);\n    color.rgb += (n - 0.5) * vhsNoise * 0.3;\n\n    // Scanlines.\n    float scanline = sin(vUv.y * uResolution.y * 2.0) * 0.5 + 0.5;\n    color.rgb *= 1.0 - vhsScanlines * 0.3 * scanline;\n\n    // Saturation pull-back.\n    vec3 luminance = vec3(0.299, 0.587, 0.114);\n    float lum = dot(color.rgb, luminance);\n    float satMix = clamp(1.0 - vhsSaturation, 0.0, 1.0);\n    color.rgb = mix(color.rgb, vec3(lum), satMix * 0.6 + vhsTracking * 0.2);\n\n    gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);\n  }\n",
    "defaults": {
      "vhsTracking": 0.5,
      "vhsNoise": 0.3,
      "vhsDistortion": 0.3,
      "vhsColorBleed": 0.5,
      "vhsScanlines": 0.3,
      "vhsHeadSwitch": 0,
      "vhsTapeWobble": 0,
      "vhsDropout": 0,
      "vhsChromaDelay": 0,
      "vhsTrackingJump": 0,
      "vhsSaturation": 1
    },
    "controls": [
      {
        "name": "Tracking",
        "param": "vhsTracking",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Noise",
        "param": "vhsNoise",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Distortion",
        "param": "vhsDistortion",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Color Bleed",
        "param": "vhsColorBleed",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Scanlines",
        "param": "vhsScanlines",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Head Switch",
        "param": "vhsHeadSwitch",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tape Wobble",
        "param": "vhsTapeWobble",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Dropouts",
        "param": "vhsDropout",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Chroma Delay",
        "param": "vhsChromaDelay",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tracking Jump",
        "param": "vhsTrackingJump",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Saturation",
        "param": "vhsSaturation",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "glitch",
    "label": "Glitch",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float glitchIntensity;\n  uniform float glitchSpeed;\n  uniform float glitchBlockSize;\n  uniform float glitchRGBSplit;\n  uniform float glitchJitter;\n  uniform float glitchTriggerMode;\n  uniform float glitchBlockHold;\n  uniform float glitchVerticalSlice;\n  uniform float glitchFreezeBurst;\n  uniform float glitchTearChance;\n  uniform float uAudio;\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  float random(float seed) { return fract(sin(seed * 12.9898) * 43758.5453); }\n  float random2(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453); }\n\n  void main() {\n    vec2 uv = vUv;\n    float t = uTime * max(glitchSpeed, 0.01);\n\n    float glitchTrigger = 0.0;\n    int mode = int(glitchTriggerMode + 0.5);\n    if (mode == 1) {\n      glitchTrigger = clamp(uAudio * 1.6, 0.0, 1.0) * glitchIntensity;\n    } else if (mode == 2) {\n      float beatPhase = floor(uTime * 8.0);\n      float beatHit = step(0.4, uAudio) * step(0.7, random(beatPhase));\n      glitchTrigger = beatHit * glitchIntensity;\n    } else {\n      glitchTrigger = step(0.95, random(floor(t * 10.0))) * glitchIntensity;\n    }\n\n    float blockHeight = max(glitchBlockSize * 0.1, 0.01);\n    float block = floor(uv.y / blockHeight);\n    float blockTime = floor(t * mix(20.0, 1.0, glitchBlockHold));\n    float blockRandom = random(block + blockTime);\n    if (blockRandom > 1.0 - glitchIntensity * 0.3 && glitchTrigger > 0.0) {\n      uv.x += (random(block + t) - 0.5) * glitchIntensity * 0.2;\n    }\n\n    float colSeed = floor(uv.x * uResolution.x / 12.0);\n    float colHit = step(1.0 - glitchVerticalSlice * 0.2, random(colSeed + floor(t * 7.0)));\n    if (colHit > 0.5 && glitchTrigger > 0.0) {\n      uv.y += (random(colSeed + 13.7) - 0.5) * glitchVerticalSlice * 0.18;\n      uv.y = fract(uv.y);\n    }\n\n    float lineJitter = (random2(vec2(floor(uv.y * uResolution.y), floor(t * 20.0))) - 0.5);\n    uv.x += lineJitter * glitchJitter * 0.01 * glitchTrigger;\n\n    float rgbAmount = glitchRGBSplit * 0.02 * (1.0 + glitchTrigger * 3.0);\n    float tearBand = step(1.0 - glitchTearChance * 0.3, random(floor(uv.y * 50.0) + floor(t * 6.0)));\n    if (tearBand > 0.5 && glitchTrigger > 0.0) rgbAmount *= 6.0;\n    vec4 color;\n    color.r = texture2D(uInput, vec2(uv.x + rgbAmount, uv.y)).r;\n    color.g = texture2D(uInput, uv).g;\n    color.b = texture2D(uInput, vec2(uv.x - rgbAmount, uv.y)).b;\n    color.a = texture2D(uInput, uv).a;\n\n    float freezeHit = step(1.0 - glitchFreezeBurst * 0.25, random(floor(t * 3.0))) * glitchTrigger;\n    if (freezeHit > 0.5) {\n      vec2 punchUv = vec2(fract(vUv.x + 0.37 + 0.13 * random(block)),\n                          fract(vUv.y + 0.21 + 0.17 * random(block + 4.0)));\n      vec4 punch = texture2D(uInput, punchUv);\n      color.rgb = mix(color.rgb, punch.rgb, 0.7);\n    }\n\n    if (random(floor(t * 15.0) + block) > 0.98 && glitchTrigger > 0.0) {\n      color.rgb = 1.0 - color.rgb;\n    }\n\n    gl_FragColor = color;\n  }\n",
    "defaults": {
      "glitchIntensity": 0.5,
      "glitchSpeed": 1,
      "glitchBlockSize": 0.3,
      "glitchRGBSplit": 0.5,
      "glitchJitter": 0.3,
      "glitchTriggerMode": 0,
      "glitchBlockHold": 0.3,
      "glitchVerticalSlice": 0,
      "glitchFreezeBurst": 0,
      "glitchTearChance": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "glitchIntensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Speed",
        "param": "glitchSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Block Size",
        "param": "glitchBlockSize",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "RGB Split",
        "param": "glitchRGBSplit",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Jitter",
        "param": "glitchJitter",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Trigger",
        "param": "glitchTriggerMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Constant (random)"
          },
          {
            "value": 1,
            "label": "Audio Reactive"
          },
          {
            "value": 2,
            "label": "Beat Snap"
          }
        ]
      },
      {
        "name": "Block Hold",
        "param": "glitchBlockHold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Vertical Slice",
        "param": "glitchVerticalSlice",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Freeze Burst",
        "param": "glitchFreezeBurst",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tear Bands",
        "param": "glitchTearChance",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "rgbShift",
    "label": "RGB Shift",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float rgbShiftAmount;     // 0-50 pixels\n  uniform float rgbShiftAngle;      // 0-360 degrees (for directional mode)\n  uniform float rgbShiftMode;       // 0=directional, 1=radial, 2=prism, 3=luma-dep, 4=edge-only\n  uniform float rgbShiftCenterX;    // 0-1 — center for radial/prism\n  uniform float rgbShiftCenterY;\n  uniform float rgbShiftPrismSpread;// 0-2 — extra hue spread in prism mode\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float lumaRGB(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    int mode = int(rgbShiftMode + 0.5);\n    vec4 base = texture2D(uInput, vUv);\n\n    // Per-pixel shift direction & magnitude.\n    vec2 dir = vec2(0.0);\n    float amt = rgbShiftAmount;\n\n    if (mode == 0) {\n      // Directional (legacy).\n      float angle = rgbShiftAngle * 3.14159 / 180.0;\n      dir = vec2(cos(angle), sin(angle));\n    } else if (mode == 1 || mode == 2) {\n      // Radial / prism — direction = away from center, magnitude scales\n      // with distance from center (lens-fringe behavior).\n      vec2 center = vec2(rgbShiftCenterX, rgbShiftCenterY);\n      vec2 d = vUv - center;\n      float dist = length(d);\n      dir = (dist > 1e-5) ? d / dist : vec2(1.0, 0.0);\n      amt *= dist * 2.0;\n    } else if (mode == 3) {\n      // Luma-dependent — only shift on bright pixels (mimics lens flare).\n      float lum = lumaRGB(base.rgb);\n      float angle = rgbShiftAngle * 3.14159 / 180.0;\n      dir = vec2(cos(angle), sin(angle));\n      amt *= smoothstep(0.4, 0.95, lum);\n    } else {\n      // Edge-only — shift only where image gradients are high.\n      float angle = rgbShiftAngle * 3.14159 / 180.0;\n      dir = vec2(cos(angle), sin(angle));\n      vec2 t = 2.0 / uResolution;\n      float gx = lumaRGB(texture2D(uInput, vUv + vec2(t.x, 0.0)).rgb)\n               - lumaRGB(texture2D(uInput, vUv - vec2(t.x, 0.0)).rgb);\n      float gy = lumaRGB(texture2D(uInput, vUv + vec2(0.0, t.y)).rgb)\n               - lumaRGB(texture2D(uInput, vUv - vec2(0.0, t.y)).rgb);\n      float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);\n      amt *= edge;\n    }\n\n    vec2 shift = dir * amt / uResolution;\n\n    vec4 color;\n    if (mode == 2) {\n      // Prism: spread R/G/B across a wider arc, shifted toward rainbow\n      // dispersion. rgbShiftPrismSpread bumps the per-channel offset asymmetry.\n      float k = 1.0 + rgbShiftPrismSpread;\n      color.r = texture2D(uInput, vUv + shift * (1.0 + 0.4 * k)).r;\n      color.g = texture2D(uInput, vUv + shift * 0.0).g;\n      color.b = texture2D(uInput, vUv - shift * (1.0 + 0.4 * k)).b;\n    } else {\n      color.r = texture2D(uInput, vUv + shift).r;\n      color.g = texture2D(uInput, vUv).g;\n      color.b = texture2D(uInput, vUv - shift).b;\n    }\n    color.a = base.a;\n\n    gl_FragColor = color;\n  }\n",
    "defaults": {
      "rgbShiftAmount": 5,
      "rgbShiftAngle": 0,
      "rgbShiftMode": 0,
      "rgbShiftCenterX": 0.5,
      "rgbShiftCenterY": 0.5,
      "rgbShiftPrismSpread": 1
    },
    "controls": [
      {
        "name": "Amount",
        "param": "rgbShiftAmount",
        "min": 0,
        "max": 50,
        "step": 0.5,
        "default": 5
      },
      {
        "name": "Angle",
        "param": "rgbShiftAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Mode",
        "param": "rgbShiftMode",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Directional"
          },
          {
            "value": 1,
            "label": "Radial"
          },
          {
            "value": 2,
            "label": "Prism Spread"
          },
          {
            "value": 3,
            "label": "Luma-driven"
          },
          {
            "value": 4,
            "label": "Edge-driven"
          }
        ]
      },
      {
        "name": "Center X",
        "param": "rgbShiftCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "rgbShiftCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Prism Spread",
        "param": "rgbShiftPrismSpread",
        "min": 0,
        "max": 3,
        "step": 0.05,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "scanlines",
    "label": "Scanlines",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float scanlinesIntensity;   // 0-1 scanline darkening strength\n  uniform float scanlinesCount;       // 50-500 scanline count\n  uniform float scanlinesSpeed;       // 0-2 scanline scroll speed\n  uniform float scanlinesPhosphor;    // 0-1 RGB sub-pixel mask intensity\n  uniform float scanlinesRollingBar;  // 0-1 brightness bar that rolls down the screen\n  uniform float scanlinesCurvature;   // 0-1 barrel distortion (CRT bulge)\n  uniform float scanlinesInterlace;   // 0-1 interlace flicker (alternating odd/even rows)\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  void main() {\n    vec2 uv = vUv;\n\n    // CRT barrel curvature — push UVs outward proportional to distance²\n    // from center. Sample is clamped so we don't read off-texture.\n    if (scanlinesCurvature > 0.001) {\n      vec2 centered = uv - 0.5;\n      float r2 = dot(centered, centered);\n      uv = centered * (1.0 + r2 * scanlinesCurvature * 0.4) + 0.5;\n      // Black mask outside the curved tube.\n      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {\n        gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(uInput, vUv).a);\n        return;\n      }\n    }\n\n    vec4 texColor = texture2D(uInput, uv);\n\n    // Scanline darkening (legacy).\n    float scanlinePos = uv.y * scanlinesCount + uTime * scanlinesSpeed * 50.0;\n    float scanline = sin(scanlinePos * 3.14159) * 0.5 + 0.5;\n    float darkness = 1.0 - scanlinesIntensity * scanline * 0.5;\n\n    vec3 col = texColor.rgb * darkness;\n\n    // Phosphor RGB sub-pixel mask — divides each row of pixels into RGB\n    // triads, brightening each color channel only on its sub-cell.\n    if (scanlinesPhosphor > 0.001) {\n      float subpixel = mod(floor(uv.x * uResolution.x), 3.0);\n      vec3 mask = vec3(\n        subpixel < 0.5 ? 1.0 : 0.4,\n        (subpixel >= 0.5 && subpixel < 1.5) ? 1.0 : 0.4,\n        subpixel >= 1.5 ? 1.0 : 0.4\n      );\n      col *= mix(vec3(1.0), mask, scanlinesPhosphor);\n    }\n\n    // Rolling brightness bar — slow horizontal band that scrolls down.\n    if (scanlinesRollingBar > 0.001) {\n      float barPos = fract(uv.y - uTime * 0.15);\n      float bar = smoothstep(0.0, 0.05, barPos) * smoothstep(0.15, 0.10, barPos);\n      col *= 1.0 + bar * scanlinesRollingBar * 0.4;\n    }\n\n    // Interlace flicker — alternate-row brightness flicker at refresh rate.\n    if (scanlinesInterlace > 0.001) {\n      float row = floor(uv.y * uResolution.y);\n      float frame = floor(uTime * 30.0);\n      float flicker = mod(row + frame, 2.0);\n      col *= mix(1.0, mix(0.85, 1.15, flicker), scanlinesInterlace);\n    }\n\n    gl_FragColor = vec4(col, texColor.a);\n  }\n",
    "defaults": {
      "scanlinesIntensity": 0.5,
      "scanlinesCount": 200,
      "scanlinesSpeed": 0,
      "scanlinesPhosphor": 0,
      "scanlinesRollingBar": 0,
      "scanlinesCurvature": 0,
      "scanlinesInterlace": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "scanlinesIntensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Line Count",
        "param": "scanlinesCount",
        "min": 50,
        "max": 500,
        "step": 10,
        "default": 200
      },
      {
        "name": "Scroll Speed",
        "param": "scanlinesSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "RGB Phosphor",
        "param": "scanlinesPhosphor",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Rolling Bar",
        "param": "scanlinesRollingBar",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "CRT Curvature",
        "param": "scanlinesCurvature",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Interlace",
        "param": "scanlinesInterlace",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "fmScanlines",
    "label": "FM Lines",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\nprecision highp float;\n\nuniform sampler2D uInput;   // layer content (image / video / shader)\nuniform vec2 uResolution;\nuniform float uTime;\n\nuniform float fmLinesMode;       // 0 = horizontal, 1 = vertical, 2 = concentric\nuniform float fmLinesCount;      // number of lines (density)\nuniform float fmLinesWidth;      // line thickness 0..1\nuniform float fmLinesFreq;       // base wave frequency 0..1\nuniform float fmLinesFmDepth;    // brightness -> frequency 0..1  (the \"FM\")\nuniform float fmLinesAmp;        // brightness -> amplitude  0..1\nuniform float fmLinesSpeed;      // animation speed 0..2\nuniform float fmLinesColorMix;   // 0 = white lines, 1 = source-tinted lines\nuniform float fmLinesInvert;     // 0 = bright lines on black, 1 = dark lines on field\n\nvarying vec2 vUv;\n\nfloat luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\nvoid main() {\n  vec2 uv = vUv;\n  vec4 srcRGBA = texture2D(uInput, uv);\n  vec3 src = srcRGBA.rgb;\n  float lum = luma(src);\n\n  float numLines = max(4.0, fmLinesCount);\n  float spacing = 1.0 / numLines;\n\n  // Brightness modulates BOTH the wave frequency (the \"FM\") and its\n  // amplitude. Amplitude is expressed in units of line-spacing so the look\n  // stays coherent at any density.\n  float baseFreq = fmLinesFreq * 40.0;\n  float freq = baseFreq + lum * fmLinesFmDepth * 140.0;\n  float amp  = spacing * (0.25 + lum * fmLinesAmp * 6.0);\n  float phase = uTime * fmLinesSpeed * 3.0;\n\n  // 'coord' is sampled across the lines; 'along' runs along each line and\n  // carries the travelling wave.\n  float coord, along;\n  if (fmLinesMode < 0.5) {            // horizontal lines, displaced vertically\n    coord = uv.y;\n    along = uv.x;\n  } else if (fmLinesMode < 1.5) {     // vertical lines, displaced horizontally\n    coord = uv.x;\n    along = uv.y;\n  } else {                      // concentric rings, displaced radially\n    vec2 c = uv - 0.5;\n    c.x *= uResolution.x / max(uResolution.y, 1.0);  // keep circles round\n    coord = length(c) * 1.4;\n    along = coord;             // radial wave — seam-free (no atan wrap)\n  }\n\n  float disp = sin(along * freq + phase) * amp;\n  float linePos = (coord + disp) * numLines;\n  float tri = abs(fract(linePos) - 0.5);            // 0 at a line centre\n\n  // Thickness: higher fmLinesWidth = thicker lines. Soft edges = cheap AA.\n  float w = mix(0.04, 0.5, clamp(fmLinesWidth, 0.0, 1.0));\n  float lineMask = 1.0 - smoothstep(w * 0.6, w, tri);\n\n  vec3 lineCol = mix(vec3(1.0), src, clamp(fmLinesColorMix, 0.0, 1.0));\n\n  bool inv = fmLinesInvert > 0.5;\n  vec3 col = inv ? lineCol * (1.0 - lineMask) : lineCol * lineMask;\n  // Non-invert: transparent gaps (lines only) so it composites cleanly.\n  // Invert: solid field with dark lines cut out.\n  float a = inv ? srcRGBA.a : lineMask * srcRGBA.a;\n\n  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(a, 0.0, 1.0));\n}\n",
    "defaults": {
      "fmLinesMode": 0,
      "fmLinesCount": 140,
      "fmLinesWidth": 0.32,
      "fmLinesFreq": 0.25,
      "fmLinesFmDepth": 0.55,
      "fmLinesAmp": 0.5,
      "fmLinesSpeed": 0.6,
      "fmLinesColorMix": 0,
      "fmLinesInvert": 0
    },
    "controls": [
      {
        "name": "Layout",
        "param": "fmLinesMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Horizontal"
          },
          {
            "value": 1,
            "label": "Vertical"
          },
          {
            "value": 2,
            "label": "Concentric"
          }
        ]
      },
      {
        "name": "Lines",
        "param": "fmLinesCount",
        "min": 20,
        "max": 400,
        "step": 1,
        "default": 140
      },
      {
        "name": "Thickness",
        "param": "fmLinesWidth",
        "min": 0.02,
        "max": 1,
        "step": 0.01,
        "default": 0.32
      },
      {
        "name": "Base Freq",
        "param": "fmLinesFreq",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.25
      },
      {
        "name": "FM Depth",
        "param": "fmLinesFmDepth",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.55
      },
      {
        "name": "Amplitude",
        "param": "fmLinesAmp",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Speed",
        "param": "fmLinesSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Source Tint",
        "param": "fmLinesColorMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Invert",
        "param": "fmLinesInvert",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Lines on Black"
          },
          {
            "value": 1,
            "label": "Field w/ Cutouts"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "phaseLab",
    "label": "Phase Lab",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  precision highp float;\n\n  uniform sampler2D uInput;\n  uniform vec2 uResolution;\n  uniform float uTime;\n  uniform float phaseLabMode;\n  uniform float phaseLabIntensity;\n  uniform float phaseLabScale;\n  uniform float phaseLabSpeed;\n  uniform float phaseLabPhase;\n  uniform float phaseLabMix;\n  uniform float phaseLabColorGain;\n  uniform float phaseLabSourceBleed;\n  uniform float phaseLabEdgeBoost;\n  uniform float phaseLabDistortion;\n  uniform float phaseLabLineDensity;\n  uniform float phaseLabPolarizerAngle;\n  uniform float phaseLabSpectralShift;\n  uniform float phaseLabFocus;\n  uniform float phaseLabMirrorRadius;\n  uniform float phaseLabConeLift;\n  uniform float phaseLabAudioReactive;\n  uniform float phaseLabAudioDrive;\n  uniform float uAudio;\n  uniform float uAudioBass;\n  varying vec2 vUv;\n\n  const float PI = 3.141592653589793;\n  const float TAU = 6.283185307179586;\n\n  float saturate(float v) { return clamp(v, 0.0, 1.0); }\n  vec3 sat3(vec3 v) { return clamp(v, vec3(0.0), vec3(1.0)); }\n  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }\n\n  float hash21(vec2 p) {\n    vec2 q = fract(p * vec2(123.34, 456.21));\n    return fract((q.x + q.y) * (q.x + 34.345));\n  }\n\n  float hash31(vec3 p) {\n    vec3 q = fract(p * vec3(443.897, 441.423, 437.195));\n    return fract((q.x + q.y + q.z) * (q.x + 19.19));\n  }\n\n  float noise2(vec2 p) {\n    vec2 i = floor(p);\n    vec2 f = fract(p);\n    vec2 s = f * f * (3.0 - 2.0 * f);\n    float a = hash21(i);\n    float b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0));\n    float d = hash21(i + vec2(1.0, 1.0));\n    return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);\n  }\n\n  float fbm2(vec2 p) {\n    float a = 0.5;\n    float v = 0.0;\n    for (int i = 0; i < 5; i++) {\n      v += a * noise2(p);\n      p = mat2(1.62, 1.18, -1.18, 1.62) * p + vec2(9.1, 2.7);\n      a *= 0.5;\n    }\n    return v;\n  }\n\n  vec3 hsv2rgb(vec3 c) {\n    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);\n    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);\n  }\n\n  vec3 phasePalette(float x) {\n    float h = fract(x);\n    vec3 a = vec3(0.55, 0.48, 0.42);\n    vec3 b = vec3(0.48, 0.54, 0.58);\n    vec3 c = vec3(1.0);\n    vec3 d = vec3(0.00, 0.22, 0.58);\n    return sat3(a + b * cos(TAU * (c * h + d)));\n  }\n\n  vec4 sampleSrc(vec2 uv) {\n    return texture2D(uInput, clamp(uv, vec2(0.0), vec2(1.0)));\n  }\n\n  float sampleLum(vec2 uv) {\n    return lum(sampleSrc(uv).rgb);\n  }\n\n  vec2 px() {\n    return 1.0 / max(uResolution, vec2(2.0));\n  }\n\n  vec2 gradient(vec2 uv, float radius) {\n    vec2 p = px() * max(1.0, radius);\n    float l = sampleLum(uv - vec2(p.x, 0.0));\n    float r = sampleLum(uv + vec2(p.x, 0.0));\n    float d = sampleLum(uv - vec2(0.0, p.y));\n    float up = sampleLum(uv + vec2(0.0, p.y));\n    return vec2(r - l, up - d) * 0.5;\n  }\n\n  float laplace(vec2 uv, float radius) {\n    vec2 p = px() * max(1.0, radius);\n    float c = sampleLum(uv);\n    float l = sampleLum(uv - vec2(p.x, 0.0));\n    float r = sampleLum(uv + vec2(p.x, 0.0));\n    float d = sampleLum(uv - vec2(0.0, p.y));\n    float up = sampleLum(uv + vec2(0.0, p.y));\n    return l + r + d + up - 4.0 * c;\n  }\n\n  vec3 bosMode(vec2 uv) {\n    float t = uTime;\n    float audioLift = phaseLabAudioReactive * phaseLabAudioDrive * max(uAudio, uAudioBass);\n    float intensity = phaseLabIntensity * (1.0 + audioLift * 0.65);\n    vec2 g = gradient(uv, 1.0 + phaseLabScale * 0.08) * phaseLabEdgeBoost * 4.0;\n    vec2 curl = vec2(\n      fbm2(uv * phaseLabScale + vec2(0.0, t * phaseLabSpeed)) - 0.5,\n      fbm2(uv.yx * phaseLabScale + vec2(4.7, -t * phaseLabSpeed * 0.77)) - 0.5\n    );\n    vec2 flow = g + 0.18 * curl;\n    vec3 refracted = sampleSrc(uv + flow * phaseLabDistortion * intensity).rgb;\n    float edge = pow(saturate(length(g) * intensity * 5.0 + abs(laplace(uv, 1.0)) * 2.0), 0.55);\n    float angle = atan(flow.y, flow.x) / TAU + 0.5;\n    vec3 falseColor = phasePalette(angle + edge * 0.32 + phaseLabPhase + t * phaseLabSpeed * 0.05);\n    vec3 ca = vec3(\n      sampleSrc(uv + flow * phaseLabDistortion * 1.35).r,\n      sampleSrc(uv + flow * phaseLabDistortion * 0.70).g,\n      sampleSrc(uv - flow * phaseLabDistortion * 1.10).b\n    );\n    vec3 sci = falseColor * edge * phaseLabColorGain + ca * (0.25 + 0.55 * edge);\n    return sat3(mix(refracted, sci, phaseLabMix));\n  }\n\n  vec3 photoelasticMode(vec2 uv) {\n    float t = uTime;\n    vec3 src = sampleSrc(uv).rgb;\n    vec2 g = gradient(uv, 1.5) * phaseLabEdgeBoost;\n    float angle = atan(g.y, g.x) + radians(phaseLabPolarizerAngle);\n    float stress = length(g) * phaseLabIntensity * 14.0 + fbm2(uv * phaseLabScale + t * phaseLabSpeed * vec2(0.15, 0.0)) * 2.2;\n    float phase = stress * phaseLabLineDensity + phaseLabPhase + 1.8 * sin(angle * 2.0 + t * phaseLabSpeed);\n    vec3 iso = 0.5 + 0.5 * cos(vec3(0.0, 2.15, 4.32) + phase);\n    float isoclinic = pow(abs(sin(2.0 * angle)), 0.55);\n    vec3 fringe = sat3(iso * (0.25 + 0.85 * isoclinic));\n    float dark = smoothstep(0.04, 0.42, abs(sin(phase * 0.5)));\n    vec3 stressGlow = phasePalette(phase / TAU + phaseLabSpectralShift) * (0.25 + length(g) * 3.0);\n    return sat3(mix(src, fringe * dark + stressGlow * 0.28, phaseLabMix) * phaseLabColorGain);\n  }\n\n  vec3 lippmannMode(vec2 uv) {\n    float t = uTime;\n    vec3 src = sampleSrc(uv).rgb;\n    float l = lum(src);\n    float view = (uv.x - 0.5) * 2.0 + sin(t * phaseLabSpeed) * 0.25 + phaseLabSpectralShift;\n    float micro = fbm2(uv * phaseLabScale * 2.0 + vec2(t * phaseLabSpeed * 0.05, 0.0));\n    vec3 standing = vec3(\n      cos(l * 42.0 + view * 5.5 + micro * 6.0 + phaseLabPhase),\n      cos(l * 55.0 + view * 7.0 + micro * 4.5 + phaseLabPhase + 1.8),\n      cos(l * 69.0 + view * 8.5 + micro * 3.5 + phaseLabPhase + 3.4)\n    ) * 0.5 + 0.5;\n    vec3 spectral = phasePalette(l * 1.8 + view * 0.22 + micro * 0.35);\n    vec3 irid = sat3(src * (0.35 + 0.9 * standing) + spectral * 0.45);\n    float glint = pow(saturate(standing.r * standing.g * standing.b), 3.0);\n    return sat3(mix(src, irid + glint * vec3(0.9, 0.95, 1.0), phaseLabMix) * phaseLabColorGain);\n  }\n\n  vec3 insarMode(vec2 uv) {\n    float t = uTime;\n    vec3 src = sampleSrc(uv).rgb;\n    vec2 p = (uv - 0.5) * vec2(uResolution.x / max(1.0, uResolution.y), 1.0);\n    float l = sampleLum(uv);\n    float elev = l * phaseLabIntensity * 7.0\n      + fbm2(uv * phaseLabScale + vec2(t * phaseLabSpeed * 0.08, 1.7)) * 2.0\n      + length(p) * 5.0;\n    float phase = elev * phaseLabLineDensity + phaseLabPhase + t * phaseLabSpeed;\n    float wrapped = fract(phase / TAU);\n    vec3 fringe = hsv2rgb(vec3(wrapped, 0.86, 1.0));\n    float contour = 1.0 - smoothstep(0.0, 0.055, abs(fract(phase / TAU) - 0.5));\n    float speckle = pow(hash31(vec3(floor(uv * uResolution / max(1.0, phaseLabScale * 0.25)), floor(t * 12.0))), 1.8);\n    vec3 radar = fringe * (0.62 + speckle * 0.55) + contour * vec3(0.9, 1.0, 1.0) * 0.35;\n    return sat3(mix(src, radar, phaseLabMix) * phaseLabColorGain);\n  }\n\n  vec3 catoptricMode(vec2 uv, bool cone) {\n    float t = uTime;\n    vec3 src = sampleSrc(uv).rgb;\n    vec2 p = uv - 0.5;\n    float r = length(p);\n    float a = atan(p.y, p.x);\n    float radius = clamp(phaseLabMirrorRadius, 0.03, 0.46);\n    float ringStart = radius * 1.05;\n    float ringEnd = 0.72;\n    float ringT = saturate((r - ringStart) / max(0.001, ringEnd - ringStart));\n    float y = cone ? pow(ringT, max(0.08, phaseLabConeLift)) : pow(ringT, max(0.08, phaseLabFocus));\n    float x = fract(a / TAU + 0.5 + 0.03 * sin(t * phaseLabSpeed + y * TAU));\n    vec2 prewarpUV = vec2(x, 1.0 - y);\n    float annulus = smoothstep(ringStart, ringStart + 0.02, r) * (1.0 - smoothstep(ringEnd - 0.02, ringEnd, r));\n    float mirrorBody = 1.0 - smoothstep(radius * 0.85, radius, r);\n    vec3 warped = sampleSrc(prewarpUV).rgb;\n    vec3 metal = vec3(0.78, 0.82, 0.86) * (0.35 + 0.65 * pow(1.0 - saturate(r / radius), 1.8));\n    vec3 reflected = sampleSrc(vec2(fract(a / TAU + 0.5), saturate(r / radius))).rgb;\n    float grid = 0.18 * (1.0 - smoothstep(0.01, 0.035, abs(fract(x * 24.0) - 0.5)));\n    vec3 field = warped * annulus + (mix(metal, reflected, 0.35) + phasePalette(a / TAU + t * 0.02) * 0.18) * mirrorBody;\n    vec3 glow = phasePalette(x + y + phaseLabPhase) * grid * annulus;\n    return sat3(mix(src, field + glow, phaseLabMix) * phaseLabColorGain);\n  }\n\n  vec3 dtiMode(vec2 uv) {\n    float t = uTime;\n    vec3 src = sampleSrc(uv).rgb;\n    vec2 g = gradient(uv, 1.2) * phaseLabEdgeBoost;\n    float n = fbm2(uv * phaseLabScale + vec2(t * phaseLabSpeed * 0.08, 0.0));\n    float angle = atan(g.y, g.x) + (n - 0.5) * PI * 1.2 + phaseLabPhase;\n    vec2 dir = vec2(cos(angle), sin(angle));\n    vec2 normal = vec2(-dir.y, dir.x);\n    float along = dot(uv - 0.5, dir);\n    float across = dot(uv - 0.5, normal);\n    float ribbonPhase = across * phaseLabLineDensity + sin(along * phaseLabScale * 8.0 + t * phaseLabSpeed) * 0.9;\n    float stripe = pow(1.0 - smoothstep(0.0, 0.42, abs(fract(ribbonPhase) - 0.5)), 1.7);\n    float anisotropy = saturate(length(g) * phaseLabIntensity * 7.0 + n * 0.4);\n    float twist = 0.5 + 0.5 * sin(along * phaseLabLineDensity * 0.7 + t * phaseLabSpeed + angle * 2.0);\n    vec3 fiber = phasePalette(angle / TAU + twist * 0.18 + phaseLabSpectralShift) * stripe * (0.25 + anisotropy);\n    vec3 body = src * (0.18 + phaseLabSourceBleed) + fiber * (1.0 + anisotropy);\n    return sat3(mix(src, body, phaseLabMix) * phaseLabColorGain);\n  }\n\n  vec3 compositeMode(vec2 uv) {\n    vec3 a = bosMode(uv);\n    vec3 b = photoelasticMode(uv);\n    vec3 c = insarMode(uv);\n    vec3 d = lippmannMode(uv);\n    float w = 0.5 + 0.5 * sin(uTime * phaseLabSpeed + phaseLabPhase);\n    return sat3(mix(mix(a, b, 0.5), mix(c, d, 0.5), w));\n  }\n\n  void main() {\n    vec4 src = sampleSrc(vUv);\n    int mode = int(floor(phaseLabMode + 0.5));\n    vec3 col;\n    if (mode == 0) {\n      col = bosMode(vUv);\n    } else if (mode == 1) {\n      col = photoelasticMode(vUv);\n    } else if (mode == 2) {\n      col = lippmannMode(vUv);\n    } else if (mode == 3) {\n      col = insarMode(vUv);\n    } else if (mode == 4) {\n      col = catoptricMode(vUv, false);\n    } else if (mode == 5) {\n      col = catoptricMode(vUv, true);\n    } else if (mode == 6) {\n      col = dtiMode(vUv);\n    } else {\n      col = compositeMode(vUv);\n    }\n\n    col = mix(col, src.rgb, clamp(phaseLabSourceBleed, 0.0, 1.0));\n    gl_FragColor = vec4(sat3(col), src.a);\n  }\n",
    "defaults": {
      "phaseLabMode": 0,
      "phaseLabIntensity": 1.35,
      "phaseLabScale": 6,
      "phaseLabSpeed": 0.35,
      "phaseLabPhase": 0,
      "phaseLabMix": 0.92,
      "phaseLabColorGain": 1.25,
      "phaseLabSourceBleed": 0.22,
      "phaseLabEdgeBoost": 2.4,
      "phaseLabDistortion": 0.04,
      "phaseLabLineDensity": 18,
      "phaseLabPolarizerAngle": 35,
      "phaseLabSpectralShift": 0.35,
      "phaseLabFocus": 1.45,
      "phaseLabMirrorRadius": 0.16,
      "phaseLabConeLift": 1.2,
      "phaseLabAudioReactive": 1,
      "phaseLabAudioDrive": 0.65
    },
    "controls": [
      {
        "name": "Mode",
        "param": "phaseLabMode",
        "min": 0,
        "max": 7,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "BOS / Schlieren"
          },
          {
            "value": 1,
            "label": "Photoelastic"
          },
          {
            "value": 2,
            "label": "Lippmann"
          },
          {
            "value": 3,
            "label": "InSAR"
          },
          {
            "value": 4,
            "label": "Catoptric Cylinder"
          },
          {
            "value": 5,
            "label": "Catoptric Cone"
          },
          {
            "value": 6,
            "label": "DTI Ribbons"
          },
          {
            "value": 7,
            "label": "Composite"
          }
        ]
      },
      {
        "name": "Intensity",
        "param": "phaseLabIntensity",
        "min": 0,
        "max": 4,
        "step": 0.01,
        "default": 1.35
      },
      {
        "name": "Scale",
        "param": "phaseLabScale",
        "min": 0.25,
        "max": 24,
        "step": 0.05,
        "default": 6
      },
      {
        "name": "Speed",
        "param": "phaseLabSpeed",
        "min": -4,
        "max": 4,
        "step": 0.01,
        "default": 0.35
      },
      {
        "name": "Phase",
        "param": "phaseLabPhase",
        "min": -6.283,
        "max": 6.283,
        "step": 0.001,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "phaseLabMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.92
      },
      {
        "name": "Color Gain",
        "param": "phaseLabColorGain",
        "min": 0.2,
        "max": 4,
        "step": 0.01,
        "default": 1.25
      },
      {
        "name": "Source Bleed",
        "param": "phaseLabSourceBleed",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.22
      },
      {
        "name": "Gradient Boost",
        "param": "phaseLabEdgeBoost",
        "min": 0,
        "max": 8,
        "step": 0.01,
        "default": 2.4
      },
      {
        "name": "Refraction",
        "param": "phaseLabDistortion",
        "min": -0.25,
        "max": 0.25,
        "step": 0.001,
        "default": 0.04
      },
      {
        "name": "Fringe Density",
        "param": "phaseLabLineDensity",
        "min": 1,
        "max": 80,
        "step": 0.1,
        "default": 18
      },
      {
        "name": "Polarizer",
        "param": "phaseLabPolarizerAngle",
        "min": 0,
        "max": 180,
        "step": 1,
        "default": 35
      },
      {
        "name": "Spectral Shift",
        "param": "phaseLabSpectralShift",
        "min": -2,
        "max": 2,
        "step": 0.005,
        "default": 0.35
      },
      {
        "name": "Mirror Focus",
        "param": "phaseLabFocus",
        "min": 0.1,
        "max": 4,
        "step": 0.01,
        "default": 1.45
      },
      {
        "name": "Mirror Radius",
        "param": "phaseLabMirrorRadius",
        "min": 0.03,
        "max": 0.45,
        "step": 0.005,
        "default": 0.16
      },
      {
        "name": "Cone Lift",
        "param": "phaseLabConeLift",
        "min": 0.2,
        "max": 3,
        "step": 0.01,
        "default": 1.2
      },
      {
        "name": "Audio Reactive",
        "param": "phaseLabAudioReactive",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Off"
          },
          {
            "value": 1,
            "label": "On"
          }
        ]
      },
      {
        "name": "Audio Drive",
        "param": "phaseLabAudioDrive",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.65
      }
    ],
    "integerParams": []
  },
  {
    "type": "pixelate",
    "label": "Pixelate",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float pixelateSize;        // 1-64 pixel size\n  uniform float pixelateMode;        // 0=nearest, 1=luma mosaic, 2=hex, 3=circle/LED\n  uniform float pixelateGrid;   // 0-1 dark grout lines between pixels (LED panel look)\n  uniform float pixelateAnimSpeed;   // 0-2 size pulse speed (0 = static)\n  uniform float pixelateAnimAmount;  // 0-1 size pulse amplitude\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  void main() {\n    int mode = int(pixelateMode + 0.5);\n\n    // Animated size — sin oscillation around pixelateSize.\n    float sz = pixelateSize;\n    if (pixelateAnimSpeed > 0.001) {\n      float w = sin(uTime * pixelateAnimSpeed * 3.14159) * 0.5 + 0.5;\n      sz = pixelateSize * mix(1.0 - pixelateAnimAmount * 0.5, 1.0 + pixelateAnimAmount * 1.0, w);\n    }\n    sz = max(sz, 1.0);\n\n    vec2 pixelSize = sz / uResolution;\n    vec2 cellId = floor(vUv / pixelSize);\n    vec2 cellUv = (cellId + 0.5) * pixelSize;\n    vec2 cellLocal = (vUv - cellId * pixelSize) / pixelSize; // 0..1 inside cell\n\n    vec4 sample0 = texture2D(uInput, cellUv);\n\n    if (mode == 1) {\n      // Luma mosaic — each cell is rendered as a flat luma-step value\n      // (3 steps per channel) so the image becomes a chunky comic look.\n      vec3 q = floor(sample0.rgb * 4.0) / 3.0;\n      gl_FragColor = vec4(q, sample0.a);\n      return;\n    }\n\n    if (mode == 2) {\n      // Hex — only pixels inside a hexagonal cell pass through;\n      // approximate by clamping to a hex distance.\n      vec2 d = cellLocal - 0.5;\n      float hex = max(abs(d.x), max(abs(d.y), abs(d.x) * 0.5 + abs(d.y) * 0.866));\n      if (hex > 0.5) {\n        gl_FragColor = vec4(0.0, 0.0, 0.0, sample0.a * 0.4);\n        return;\n      }\n    }\n\n    if (mode == 3) {\n      // Circle / LED — pixels are circles with brightness = sampled luma.\n      vec2 d = cellLocal - 0.5;\n      float dist = length(d);\n      float disc = smoothstep(0.5, 0.45, dist);\n      gl_FragColor = vec4(sample0.rgb * disc, sample0.a);\n      return;\n    }\n\n    // Grid lines (LED grout). Darken the cell edge.\n    if (pixelateGrid > 0.001) {\n      vec2 edge = abs(cellLocal - 0.5);\n      float onEdge = step(0.46, max(edge.x, edge.y));\n      sample0.rgb *= mix(1.0, 0.0, onEdge * pixelateGrid);\n    }\n\n    gl_FragColor = sample0;\n  }\n",
    "defaults": {
      "pixelateSize": 8,
      "pixelateMode": 0,
      "pixelateGrid": 0,
      "pixelateAnimSpeed": 0,
      "pixelateAnimAmount": 0
    },
    "controls": [
      {
        "name": "Pixel Size",
        "param": "pixelateSize",
        "min": 1,
        "max": 64,
        "step": 1,
        "default": 8
      },
      {
        "name": "Pattern",
        "param": "pixelateMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Square"
          },
          {
            "value": 1,
            "label": "Hex"
          },
          {
            "value": 2,
            "label": "Triangle"
          },
          {
            "value": 3,
            "label": "Voronoi"
          }
        ]
      },
      {
        "name": "Grid Lines",
        "param": "pixelateGrid",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Anim Speed",
        "param": "pixelateAnimSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Anim Amount",
        "param": "pixelateAnimAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "blur",
    "label": "Blur",
    "category": "Blur & Focus",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float blurRadius;        // 0-30 px\n  uniform float blurMode;          // 0=box, 1=gaussian, 2=motion, 3=bilateral\n  uniform float blurAngle;         // 0-360 degrees (motion blur direction)\n  uniform float blurQuality;       // 0=low (9-tap), 1=mid (17-tap), 2=high (25-tap)\n  uniform float blurEdgeProtect;   // 0-1 bilateral edge preservation\n  uniform float blurMix;           // 0-1 wet/dry\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    vec3 srcRgb = src.rgb;\n    float srcL = luma(srcRgb);\n    if (blurRadius < 0.01) {\n      gl_FragColor = src;\n      return;\n    }\n\n    int mode = int(blurMode + 0.5);\n    int taps = (blurQuality < 0.5) ? 4 : (blurQuality < 1.5) ? 8 : 12;\n    float r = blurRadius;\n    vec2 texel = 1.0 / uResolution;\n\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n    float ang = radians(blurAngle);\n    vec2 motionDir = vec2(cos(ang), sin(ang));\n\n    for (int s = -12; s <= 12; s++) {\n      if (abs(s) > taps) continue;\n      float fs = float(s);\n      vec2 off;\n      float w = 1.0;\n\n      if (mode == 0) {\n        // Box blur — 1D pair (do twice)\n        off = vec2(fs, 0.0) * texel * (r / float(taps));\n        w = 1.0;\n      } else if (mode == 1) {\n        // Gaussian (separated horizontal-only here, ok for screen-space)\n        off = vec2(fs, 0.0) * texel * (r / float(taps));\n        float sigma = float(taps) * 0.5;\n        w = exp(-(fs * fs) / (2.0 * sigma * sigma));\n      } else if (mode == 2) {\n        // Motion blur — directional\n        off = motionDir * fs * texel * (r / float(taps));\n        w = 1.0;\n      } else {\n        // Bilateral\n        off = vec2(fs, 0.0) * texel * (r / float(taps));\n        vec3 sCol = texture2D(uInput, vUv + off).rgb;\n        float dL = luma(sCol) - srcL;\n        float spatial = exp(-(fs * fs) / (2.0 * float(taps * taps) * 0.25));\n        float range = exp(-(dL * dL) / (2.0 * pow(0.1 + (1.0 - blurEdgeProtect) * 0.5, 2.0)));\n        w = spatial * range;\n      }\n      acc += texture2D(uInput, vUv + off).rgb * w;\n      wsum += w;\n    }\n\n    // Second pass for box/gaussian/bilateral (vertical), so output is roughly 2D\n    if (mode != 2) {\n      for (int s = -12; s <= 12; s++) {\n        if (abs(s) > taps) continue;\n        if (s == 0) continue;\n        float fs = float(s);\n        vec2 off = vec2(0.0, fs) * texel * (r / float(taps));\n        float w = 1.0;\n        if (mode == 1) {\n          float sigma = float(taps) * 0.5;\n          w = exp(-(fs * fs) / (2.0 * sigma * sigma));\n        } else if (mode == 3) {\n          vec3 sCol = texture2D(uInput, vUv + off).rgb;\n          float dL = luma(sCol) - srcL;\n          float spatial = exp(-(fs * fs) / (2.0 * float(taps * taps) * 0.25));\n          float range = exp(-(dL * dL) / (2.0 * pow(0.1 + (1.0 - blurEdgeProtect) * 0.5, 2.0)));\n          w = spatial * range;\n        }\n        acc += texture2D(uInput, vUv + off).rgb * w;\n        wsum += w;\n      }\n    }\n\n    vec3 blurred = acc / max(wsum, 0.0001);\n    vec3 result = mix(srcRgb, blurred, blurMix);\n    gl_FragColor = vec4(result, src.a);\n  }\n",
    "defaults": {
      "blurRadius": 5,
      "blurMode": 1,
      "blurAngle": 0,
      "blurQuality": 1,
      "blurEdgeProtect": 0.3,
      "blurMix": 1
    },
    "controls": [
      {
        "name": "Radius",
        "param": "blurRadius",
        "min": 0,
        "max": 30,
        "step": 0.5,
        "default": 5
      },
      {
        "name": "Algorithm",
        "param": "blurMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Box"
          },
          {
            "value": 1,
            "label": "Gaussian"
          },
          {
            "value": 2,
            "label": "Motion"
          },
          {
            "value": 3,
            "label": "Bilateral (edge-aware)"
          }
        ]
      },
      {
        "name": "Motion Angle",
        "param": "blurAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Quality",
        "param": "blurQuality",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Low (4 taps)"
          },
          {
            "value": 1,
            "label": "Mid (8 taps)"
          },
          {
            "value": 2,
            "label": "High (12 taps)"
          }
        ]
      },
      {
        "name": "Edge Protect",
        "param": "blurEdgeProtect",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Mix",
        "param": "blurMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "sharpen",
    "label": "Sharpen",
    "category": "Blur & Focus",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float sharpenAmount;        // 0-3 sharpen strength\n  uniform float sharpenMode;          // 0=laplacian, 1=unsharp mask\n  uniform float sharpenRadius;        // 1-8 unsharp radius\n  uniform float sharpenEdgeProtect;   // 0-1 limit sharpening on flat areas\n  uniform float sharpenClarity;       // 0-1 mid-tone contrast pop\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec2 texel = 1.0 / uResolution;\n    vec4 center = texture2D(uInput, vUv);\n    vec3 result = center.rgb;\n\n    int mode = int(sharpenMode + 0.5);\n\n    if (mode == 0) {\n      // Laplacian sharpen\n      vec4 left   = texture2D(uInput, vUv - vec2(texel.x, 0.0));\n      vec4 right  = texture2D(uInput, vUv + vec2(texel.x, 0.0));\n      vec4 top    = texture2D(uInput, vUv + vec2(0.0, texel.y));\n      vec4 bottom = texture2D(uInput, vUv - vec2(0.0, texel.y));\n      vec3 avg = (left.rgb + right.rgb + top.rgb + bottom.rgb) * 0.25;\n      vec3 highFreq = center.rgb - avg;\n      // Edge protect: fade sharpen on flat regions\n      float edgeAmp = 1.0;\n      if (sharpenEdgeProtect > 0.001) {\n        float edgeMag = length(highFreq);\n        edgeAmp = smoothstep(0.0, sharpenEdgeProtect * 0.2, edgeMag);\n      }\n      result = center.rgb + highFreq * sharpenAmount * edgeAmp;\n    } else {\n      // Unsharp mask: blur, subtract from original, add scaled back\n      float r = max(1.0, sharpenRadius);\n      vec3 blurAcc = vec3(0.0);\n      float wsum = 0.0;\n      for (int y = -4; y <= 4; y++) {\n        for (int x = -4; x <= 4; x++) {\n          if (abs(x) + abs(y) > 4) continue;\n          vec2 off = vec2(float(x), float(y)) * texel * (r * 0.5);\n          float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));\n          blurAcc += texture2D(uInput, vUv + off).rgb * w;\n          wsum += w;\n        }\n      }\n      vec3 blurred = blurAcc / wsum;\n      vec3 mask = center.rgb - blurred;\n      float edgeAmp = 1.0;\n      if (sharpenEdgeProtect > 0.001) {\n        float edgeMag = length(mask);\n        edgeAmp = smoothstep(0.0, sharpenEdgeProtect * 0.2, edgeMag);\n      }\n      result = center.rgb + mask * sharpenAmount * edgeAmp;\n    }\n\n    // Clarity: mid-tone contrast pop\n    if (sharpenClarity > 0.001) {\n      float lum = luma(result);\n      float midMask = 4.0 * lum * (1.0 - lum); // peaks at lum=0.5\n      vec3 popped = mix(vec3(0.5), result, 1.0 + sharpenClarity * 0.6);\n      result = mix(result, popped, midMask * sharpenClarity);\n    }\n\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), center.a);\n  }\n",
    "defaults": {
      "sharpenAmount": 0.5,
      "sharpenMode": 0,
      "sharpenRadius": 2,
      "sharpenEdgeProtect": 0.2,
      "sharpenClarity": 0
    },
    "controls": [
      {
        "name": "Amount",
        "param": "sharpenAmount",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Algorithm",
        "param": "sharpenMode",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Laplacian"
          },
          {
            "value": 1,
            "label": "Unsharp Mask"
          }
        ]
      },
      {
        "name": "Radius",
        "param": "sharpenRadius",
        "min": 1,
        "max": 8,
        "step": 0.5,
        "default": 2
      },
      {
        "name": "Edge Protect",
        "param": "sharpenEdgeProtect",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Clarity",
        "param": "sharpenClarity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "noise",
    "label": "Noise",
    "category": "Generate & Texture",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float noiseAmount;        // 0-1\n  uniform float noiseType;          // 0=white, 1=blue, 2=value, 3=fbm, 4=cellular\n  uniform float noiseMode;          // 0=overlay, 1=add, 2=multiply, 3=screen, 4=replace\n  uniform float noiseScale;         // 0.5-32 noise scale\n  uniform float noiseMono;          // 0=RGB noise, 1=mono\n  uniform float noiseShadow;     // 0-1\n  uniform float noiseMid;        // 0-1\n  uniform float noiseHigh;       // 0-1\n  uniform float noiseAnimSpeed;     // 0=static, 0-2=anim\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash13(vec3 p) {\n    p = fract(p * vec3(443.8975, 397.2973, 491.1871));\n    p += dot(p, p.yzx + 19.19);\n    return fract((p.x + p.y) * p.z);\n  }\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float fbm(vec2 p) {\n    float v = 0.0; float amp = 0.5;\n    for (int i = 0; i < 5; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }\n    return v;\n  }\n  float cellular(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float minD = 1.0;\n    for (int y = -1; y <= 1; y++) {\n      for (int x = -1; x <= 1; x++) {\n        vec2 g = vec2(float(x), float(y));\n        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));\n        vec2 r = g + o - f;\n        float d = dot(r, r);\n        minD = min(minD, d);\n      }\n    }\n    return sqrt(minD);\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  vec3 sampleNoise(vec2 p, float t) {\n    int type = int(noiseType + 0.5);\n    if (noiseMono > 0.5) {\n      float n;\n      if (type == 0) n = hash13(vec3(p, t)) - 0.5;\n      else if (type == 1) {\n        // Blue-style: triangular distribution from two whites\n        float a = hash13(vec3(p, t));\n        float b = hash13(vec3(p + 1.0, t + 0.5));\n        n = (a + b) * 0.5 - 0.5;\n      }\n      else if (type == 2) n = vnoise(p) - 0.5;\n      else if (type == 3) n = fbm(p) - 0.5;\n      else n = cellular(p) - 0.5;\n      return vec3(n);\n    } else {\n      vec3 c;\n      if (type == 0) c = vec3(hash13(vec3(p, t)), hash13(vec3(p, t + 0.31)), hash13(vec3(p, t + 0.71))) - 0.5;\n      else if (type == 1) {\n        c = vec3(\n          (hash13(vec3(p, t)) + hash13(vec3(p + 1.0, t + 0.5))) * 0.5 - 0.5,\n          (hash13(vec3(p + 7.0, t + 0.31)) + hash13(vec3(p + 8.0, t + 0.81))) * 0.5 - 0.5,\n          (hash13(vec3(p + 17.0, t + 0.71)) + hash13(vec3(p + 18.0, t + 0.91))) * 0.5 - 0.5\n        );\n      }\n      else if (type == 2) c = vec3(vnoise(p), vnoise(p + 13.7), vnoise(p + 71.3)) - 0.5;\n      else if (type == 3) c = vec3(fbm(p), fbm(p + 13.7), fbm(p + 71.3)) - 0.5;\n      else c = vec3(cellular(p), cellular(p + 13.7), cellular(p + 71.3)) - 0.5;\n      return c;\n    }\n  }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (noiseAmount < 0.001) { gl_FragColor = src; return; }\n\n    float t = (noiseAnimSpeed > 0.001) ? floor(uTime * noiseAnimSpeed * 24.0) / 24.0 : 0.0;\n    vec2 p = vUv * uResolution / max(0.5, 64.0 / noiseScale);\n    vec3 noise = sampleNoise(p, t);\n\n    // Tonal weighting\n    float l = luma(src.rgb);\n    float shadowMask = 1.0 - smoothstep(0.0, 0.4, l);\n    float midMask = (1.0 - abs(l - 0.5) * 2.0);\n    float highMask = smoothstep(0.6, 1.0, l);\n    float zoneAmp = shadowMask * noiseShadow + midMask * noiseMid + highMask * noiseHigh;\n    noise *= noiseAmount * zoneAmp;\n\n    int mode = int(noiseMode + 0.5);\n    vec3 result;\n    if (mode == 0) {\n      // Overlay: noise around 0.5, blend lightly\n      result = src.rgb + noise;\n    } else if (mode == 1) {\n      result = src.rgb + abs(noise) * sign(noise);\n    } else if (mode == 2) {\n      result = src.rgb * (1.0 + noise);\n    } else if (mode == 3) {\n      vec3 n01 = noise + 0.5;\n      result = 1.0 - (1.0 - src.rgb) * (1.0 - n01 * noiseAmount);\n    } else {\n      result = noise + 0.5;\n    }\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);\n  }\n",
    "defaults": {
      "noiseAmount": 0.2,
      "noiseType": 0,
      "noiseMode": 0,
      "noiseScale": 1,
      "noiseMono": 0,
      "noiseShadow": 1,
      "noiseMid": 1,
      "noiseHigh": 1,
      "noiseAnimSpeed": 1
    },
    "controls": [
      {
        "name": "Amount",
        "param": "noiseAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Type",
        "param": "noiseType",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "White"
          },
          {
            "value": 1,
            "label": "Blue"
          },
          {
            "value": 2,
            "label": "Value"
          },
          {
            "value": 3,
            "label": "fBm"
          },
          {
            "value": 4,
            "label": "Cellular"
          }
        ]
      },
      {
        "name": "Blend",
        "param": "noiseMode",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Overlay"
          },
          {
            "value": 1,
            "label": "Add"
          },
          {
            "value": 2,
            "label": "Multiply"
          },
          {
            "value": 3,
            "label": "Screen"
          },
          {
            "value": 4,
            "label": "Replace"
          }
        ]
      },
      {
        "name": "Pattern Scale",
        "param": "noiseScale",
        "min": 0.5,
        "max": 32,
        "step": 0.5,
        "default": 1
      },
      {
        "name": "Mono",
        "param": "noiseMono",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Shadow Amount",
        "param": "noiseShadow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mid Amount",
        "param": "noiseMid",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Highlight Amount",
        "param": "noiseHigh",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Anim Speed",
        "param": "noiseAnimSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "kaleidoscope",
    "label": "Kaleidoscope",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float kaleidoscopeSegments;      // 2-32\n  uniform float kaleidoscopeAngle;         // 0-360 rotation\n  uniform float kaleidoscopeCenterX;       // 0-1\n  uniform float kaleidoscopeCenterY;       // 0-1\n  uniform float kaleidoscopeZoom;          // 0.25-4\n  uniform float kaleidoscopeMode;          // 0=mirror, 1=tile (no flip), 2=spiral\n  uniform float kaleidoscopeSpiral;  // 0-2 spiral twist (used in mode 2)\n  uniform float kaleidoscopeAnimSpeed;     // 0-2 auto-rotate\n  uniform float kaleidoscopeMix;           // 0-1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec2 center = vec2(kaleidoscopeCenterX, kaleidoscopeCenterY);\n    vec2 d = vUv - center;\n    // Aspect correct\n    d.x *= uResolution.x / uResolution.y;\n    float r = length(d);\n    float theta = atan(d.y, d.x);\n    float baseAngle = radians(kaleidoscopeAngle) + uTime * kaleidoscopeAnimSpeed * 0.3;\n    theta -= baseAngle;\n\n    int mode = int(kaleidoscopeMode + 0.5);\n    float seg = max(2.0, kaleidoscopeSegments);\n    float wedge = 6.28318 / seg;\n\n    if (mode == 0) {\n      // Mirror — fold within wedge\n      theta = mod(theta, wedge);\n      theta = abs(theta - wedge * 0.5);\n    } else if (mode == 1) {\n      // Tile — modulo without flip\n      theta = mod(theta, wedge);\n    } else {\n      // Spiral — fold + radial twist\n      theta = mod(theta, wedge);\n      theta = abs(theta - wedge * 0.5);\n      theta += r * kaleidoscopeSpiral * 2.0;\n    }\n\n    float zoom = max(0.05, kaleidoscopeZoom);\n    vec2 mappedD = vec2(cos(theta), sin(theta)) * r / zoom;\n    mappedD.x *= uResolution.y / uResolution.x;\n    vec2 mappedUv = mappedD + center;\n    mappedUv = clamp(mappedUv, vec2(0.0), vec2(1.0));\n\n    vec4 src = texture2D(uInput, vUv);\n    vec4 mapped = texture2D(uInput, mappedUv);\n    gl_FragColor = vec4(mix(src.rgb, mapped.rgb, kaleidoscopeMix), src.a);\n  }\n",
    "defaults": {
      "kaleidoscopeSegments": 6,
      "kaleidoscopeAngle": 0,
      "kaleidoscopeCenterX": 0.5,
      "kaleidoscopeCenterY": 0.5,
      "kaleidoscopeZoom": 1,
      "kaleidoscopeMode": 0,
      "kaleidoscopeSpiral": 0,
      "kaleidoscopeAnimSpeed": 0,
      "kaleidoscopeMix": 1
    },
    "controls": [
      {
        "name": "Segments",
        "param": "kaleidoscopeSegments",
        "min": 2,
        "max": 32,
        "step": 1,
        "default": 6
      },
      {
        "name": "Rotation",
        "param": "kaleidoscopeAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Center X",
        "param": "kaleidoscopeCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "kaleidoscopeCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Zoom",
        "param": "kaleidoscopeZoom",
        "min": 0.25,
        "max": 4,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Mode",
        "param": "kaleidoscopeMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Mirror"
          },
          {
            "value": 1,
            "label": "Tile (no flip)"
          },
          {
            "value": 2,
            "label": "Spiral"
          }
        ]
      },
      {
        "name": "Spiral Twist",
        "param": "kaleidoscopeSpiral",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Auto-rotate",
        "param": "kaleidoscopeAnimSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "kaleidoscopeMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "mirror",
    "label": "Mirror",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float mirrorMode;          // 0=horizontal, 1=vertical, 2=quad, 3=diagonal\n  uniform float mirrorPosition;      // 0-1 mirror axis position\n  uniform float mirrorOffset;        // 0-1 source offset\n  uniform float mirrorFlipSide;      // 0=mirror right/bottom, 1=mirror left/top\n  uniform float mirrorMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec2 uv = vUv;\n    int mode = int(mirrorMode + 0.5);\n\n    if (mode == 0) {\n      // Horizontal axis (mirror along Y)\n      float pos = mirrorPosition;\n      bool aboveAxis = (uv.x > pos) != (mirrorFlipSide > 0.5);\n      if (aboveAxis) {\n        uv.x = pos * 2.0 - uv.x + (mirrorOffset - 0.5) * 0.4;\n      }\n    } else if (mode == 1) {\n      // Vertical axis (mirror along X)\n      float pos = mirrorPosition;\n      bool aboveAxis = (uv.y > pos) != (mirrorFlipSide > 0.5);\n      if (aboveAxis) {\n        uv.y = pos * 2.0 - uv.y + (mirrorOffset - 0.5) * 0.4;\n      }\n    } else if (mode == 2) {\n      // Quad mirror\n      uv = abs(uv - 0.5) + 0.5;\n      uv = abs(uv - vec2(mirrorPosition, mirrorPosition));\n      uv = mix(uv, vUv, 0.0);\n    } else {\n      // Diagonal\n      vec2 c = vec2(mirrorPosition);\n      vec2 d = uv - c;\n      // Reflect across diagonal y=x going through center\n      vec2 refl = c + vec2(d.y, d.x);\n      uv = (mirrorFlipSide > 0.5) ? refl : (uv.x + uv.y < 2.0 * mirrorPosition ? uv : refl);\n    }\n\n    uv = clamp(uv, vec2(0.0), vec2(1.0));\n    vec4 mirrored = texture2D(uInput, uv);\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(mix(src.rgb, mirrored.rgb, mirrorMix), src.a);\n  }\n",
    "defaults": {
      "mirrorMode": 0,
      "mirrorPosition": 0.5,
      "mirrorOffset": 0.5,
      "mirrorFlipSide": 0,
      "mirrorMix": 1
    },
    "controls": [
      {
        "name": "Mode",
        "param": "mirrorMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Horizontal"
          },
          {
            "value": 1,
            "label": "Vertical"
          },
          {
            "value": 2,
            "label": "Quad"
          },
          {
            "value": 3,
            "label": "Diagonal"
          }
        ]
      },
      {
        "name": "Position",
        "param": "mirrorPosition",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Offset",
        "param": "mirrorOffset",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Flip Side",
        "param": "mirrorFlipSide",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "mirrorMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "wave",
    "label": "Wave",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float waveAmplitude;     // 0-50 px\n  uniform float waveFrequency;     // 0.1-30\n  uniform float waveSpeed;         // 0-3\n  uniform float waveType;          // 0=horizontal, 1=vertical, 2=radial, 3=swirl\n  uniform float waveWaveform;      // 0=sin, 1=triangle, 2=saw, 3=square\n  uniform float wavePhase;         // 0-360 phase offset\n  uniform float waveSecondary;  // 0-1 second harmonic\n  uniform float waveChromaSplit;   // 0-1 RGB phase shift\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float waveform(float x, int kind) {\n    if (kind == 0) return sin(x);\n    if (kind == 1) return abs(mod(x / 3.14159, 2.0) - 1.0) * 2.0 - 1.0;\n    if (kind == 2) return mod(x / 3.14159, 2.0) - 1.0;\n    return sign(sin(x));\n  }\n\n  vec2 waveOffset(vec2 uv, float phaseShift) {\n    int type = int(waveType + 0.5);\n    int wf = int(waveWaveform + 0.5);\n    float t = uTime * waveSpeed + radians(wavePhase) + phaseShift;\n    float amp = waveAmplitude / uResolution.y;\n    float freq = waveFrequency;\n    vec2 off = vec2(0.0);\n\n    if (type == 0) {\n      // Horizontal — wave shifts X based on Y\n      off.x = waveform(uv.y * freq + t, wf) * amp;\n      if (waveSecondary > 0.001) off.x += waveform(uv.y * freq * 2.5 + t * 1.7, wf) * amp * waveSecondary * 0.5;\n    } else if (type == 1) {\n      off.y = waveform(uv.x * freq + t, wf) * amp;\n      if (waveSecondary > 0.001) off.y += waveform(uv.x * freq * 2.5 + t * 1.7, wf) * amp * waveSecondary * 0.5;\n    } else if (type == 2) {\n      // Radial — push out/in based on distance\n      vec2 d = uv - 0.5;\n      float r = length(d);\n      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);\n      off = dir * waveform(r * freq * 8.0 + t, wf) * amp;\n    } else {\n      // Swirl\n      vec2 d = uv - 0.5;\n      float r = length(d);\n      float a = atan(d.y, d.x);\n      float w = waveform(r * freq + t, wf) * amp * 4.0;\n      a += w;\n      off = vec2(cos(a), sin(a)) * r + 0.5 - uv;\n    }\n    return off;\n  }\n\n  void main() {\n    vec2 baseOff = waveOffset(vUv, 0.0);\n    vec3 col;\n    if (waveChromaSplit > 0.001) {\n      vec2 offR = waveOffset(vUv, 0.5 * waveChromaSplit);\n      vec2 offB = waveOffset(vUv, -0.5 * waveChromaSplit);\n      col.r = texture2D(uInput, vUv + offR).r;\n      col.g = texture2D(uInput, vUv + baseOff).g;\n      col.b = texture2D(uInput, vUv + offB).b;\n    } else {\n      col = texture2D(uInput, vUv + baseOff).rgb;\n    }\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(col, src.a);\n  }\n",
    "defaults": {
      "waveAmplitude": 10,
      "waveFrequency": 5,
      "waveSpeed": 1,
      "waveType": 0,
      "waveWaveform": 0,
      "wavePhase": 0,
      "waveSecondary": 0,
      "waveChromaSplit": 0
    },
    "controls": [
      {
        "name": "Amplitude",
        "param": "waveAmplitude",
        "min": 0,
        "max": 50,
        "step": 0.5,
        "default": 10
      },
      {
        "name": "Frequency",
        "param": "waveFrequency",
        "min": 0.5,
        "max": 30,
        "step": 0.5,
        "default": 5
      },
      {
        "name": "Speed",
        "param": "waveSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Direction",
        "param": "waveType",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Horizontal"
          },
          {
            "value": 1,
            "label": "Vertical"
          },
          {
            "value": 2,
            "label": "Radial"
          },
          {
            "value": 3,
            "label": "Swirl"
          }
        ]
      },
      {
        "name": "Waveform",
        "param": "waveWaveform",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Sine"
          },
          {
            "value": 1,
            "label": "Triangle"
          },
          {
            "value": 2,
            "label": "Saw"
          },
          {
            "value": 3,
            "label": "Square"
          }
        ]
      },
      {
        "name": "Phase",
        "param": "wavePhase",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Harmonic",
        "param": "waveSecondary",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Chroma Split",
        "param": "waveChromaSplit",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "fisheye",
    "label": "Fisheye",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float fisheyeStrength;      // -1..1 (negative = pincushion)\n  uniform float fisheyeRadius;        // 0.1-1\n  uniform float fisheyeCenterX;       // 0-1\n  uniform float fisheyeCenterY;       // 0-1\n  uniform float fisheyeZoom;          // 0.5-2\n  uniform float fisheyeMode;          // 0=spherize, 1=barrel, 2=pincushion\n  uniform float fisheyeChromaEdge;    // 0-1 edge fringing\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec2 fisheyeMap(vec2 uv, float strength, float radius, float zoom) {\n    vec2 d = uv - vec2(fisheyeCenterX, fisheyeCenterY);\n    d.x *= uResolution.x / uResolution.y;\n    float r = length(d);\n    float radNorm = clamp(r / radius, 0.0, 1.0);\n    int mode = int(fisheyeMode + 0.5);\n    float distort;\n    if (mode == 0) {\n      // Spherize (smooth)\n      distort = sin(radNorm * 1.5707963 * sign(strength)) * abs(strength);\n    } else if (mode == 1) {\n      // Barrel (cubic)\n      distort = radNorm * radNorm * abs(strength) * sign(strength);\n    } else {\n      // Pincushion (always pulls in)\n      distort = -radNorm * radNorm * abs(strength);\n    }\n    float scale = 1.0 + distort;\n    d /= max(0.0001, scale);\n    d /= zoom;\n    d.x *= uResolution.y / uResolution.x;\n    return d + vec2(fisheyeCenterX, fisheyeCenterY);\n  }\n\n  void main() {\n    vec2 uvBase = fisheyeMap(vUv, fisheyeStrength, fisheyeRadius, fisheyeZoom);\n    vec3 col;\n    if (fisheyeChromaEdge > 0.001) {\n      vec2 d = vUv - vec2(fisheyeCenterX, fisheyeCenterY);\n      float r = length(d);\n      float edgeAmp = smoothstep(fisheyeRadius * 0.4, fisheyeRadius, r) * fisheyeChromaEdge * 0.04;\n      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);\n      vec2 uvR = fisheyeMap(vUv + dir * edgeAmp, fisheyeStrength, fisheyeRadius, fisheyeZoom);\n      vec2 uvB = fisheyeMap(vUv - dir * edgeAmp, fisheyeStrength, fisheyeRadius, fisheyeZoom);\n      col.r = texture2D(uInput, clamp(uvR, vec2(0.0), vec2(1.0))).r;\n      col.g = texture2D(uInput, clamp(uvBase, vec2(0.0), vec2(1.0))).g;\n      col.b = texture2D(uInput, clamp(uvB, vec2(0.0), vec2(1.0))).b;\n    } else {\n      col = texture2D(uInput, clamp(uvBase, vec2(0.0), vec2(1.0))).rgb;\n    }\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(col, src.a);\n  }\n",
    "defaults": {
      "fisheyeStrength": 0.5,
      "fisheyeRadius": 1,
      "fisheyeCenterX": 0.5,
      "fisheyeCenterY": 0.5,
      "fisheyeZoom": 1,
      "fisheyeMode": 0,
      "fisheyeChromaEdge": 0
    },
    "controls": [
      {
        "name": "Strength",
        "param": "fisheyeStrength",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Radius",
        "param": "fisheyeRadius",
        "min": 0.1,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Center X",
        "param": "fisheyeCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "fisheyeCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Zoom",
        "param": "fisheyeZoom",
        "min": 0.5,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mode",
        "param": "fisheyeMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Spherize"
          },
          {
            "value": 1,
            "label": "Barrel"
          },
          {
            "value": 2,
            "label": "Pincushion"
          }
        ]
      },
      {
        "name": "Edge Fringe",
        "param": "fisheyeChromaEdge",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "thermal",
    "label": "Thermal",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float thermalIntensity;   // 0-2 contrast / temperature curve sharpness\n  uniform float thermalPalette;     // 0=classic, 1=ironbow, 2=arctic, 3=predator, 4=medical\n  uniform float thermalShimmer;     // 0-1 — heat-haze shimmer on hot pixels\n  uniform float thermalSensorNoise; // 0-1 — animated rolling sensor banding noise\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  float thHash(vec2 p) {\n    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);\n  }\n\n  vec3 classicThermal(float t) {\n    // Blue (cold) -> Cyan -> Green -> Yellow -> Red -> White (hot)\n    vec3 color;\n    if (t < 0.2) {\n      color = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.5, 1.0), t * 5.0);\n    } else if (t < 0.4) {\n      color = mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.2) * 5.0);\n    } else if (t < 0.6) {\n      color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.4) * 5.0);\n    } else if (t < 0.8) {\n      color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.6) * 5.0);\n    } else {\n      color = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.8) * 5.0);\n    }\n    return color;\n  }\n\n  vec3 ironbowPalette(float t) {\n    // Black -> Purple -> Blue -> Cyan -> Green -> Yellow -> Orange -> Red -> White\n    vec3 color;\n    if (t < 0.14) {\n      color = mix(vec3(0.0), vec3(0.3, 0.0, 0.5), t * 7.14);\n    } else if (t < 0.28) {\n      color = mix(vec3(0.3, 0.0, 0.5), vec3(0.0, 0.0, 1.0), (t - 0.14) * 7.14);\n    } else if (t < 0.42) {\n      color = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), (t - 0.28) * 7.14);\n    } else if (t < 0.57) {\n      color = mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.42) * 6.67);\n    } else if (t < 0.71) {\n      color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.57) * 7.14);\n    } else if (t < 0.85) {\n      color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.5, 0.0), (t - 0.71) * 7.14);\n    } else {\n      color = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.85) * 6.67);\n    }\n    return color;\n  }\n\n  vec3 arcticPalette(float t) {\n    // White (cold) -> Cyan -> Blue -> Purple -> Magenta (hot)\n    vec3 color;\n    if (t < 0.25) {\n      color = mix(vec3(1.0, 1.0, 1.0), vec3(0.5, 1.0, 1.0), t * 4.0);\n    } else if (t < 0.5) {\n      color = mix(vec3(0.5, 1.0, 1.0), vec3(0.0, 0.5, 1.0), (t - 0.25) * 4.0);\n    } else if (t < 0.75) {\n      color = mix(vec3(0.0, 0.5, 1.0), vec3(0.5, 0.0, 1.0), (t - 0.5) * 4.0);\n    } else {\n      color = mix(vec3(0.5, 0.0, 1.0), vec3(1.0, 0.0, 0.5), (t - 0.75) * 4.0);\n    }\n    return color;\n  }\n\n  // Predator palette — high-contrast green/yellow/red threat-detection look.\n  vec3 predatorPalette(float t) {\n    if (t < 0.3)      return mix(vec3(0.0, 0.05, 0.0), vec3(0.0, 0.6, 0.1), t / 0.3);\n    else if (t < 0.6) return mix(vec3(0.0, 0.6, 0.1), vec3(0.95, 0.85, 0.0), (t - 0.3) / 0.3);\n    else if (t < 0.85)return mix(vec3(0.95, 0.85, 0.0), vec3(0.95, 0.25, 0.05), (t - 0.6) / 0.25);\n    else              return mix(vec3(0.95, 0.25, 0.05), vec3(1.0, 0.0, 0.6), (t - 0.85) / 0.15);\n  }\n  // Medical palette — clean black-to-white IR for diagnostic look.\n  vec3 medicalPalette(float t) {\n    return vec3(t);\n  }\n\n  void main() {\n    vec2 uv = vUv;\n\n    // Heat shimmer — hot pixels (sampled separately) drive a tiny UV\n    // wobble so the image distorts where it's hot.\n    if (thermalShimmer > 0.001) {\n      vec3 sample0 = texture2D(uInput, uv).rgb;\n      float lum0 = dot(sample0, vec3(0.299, 0.587, 0.114));\n      float wobble = sin(uv.y * 60.0 + uTime * 4.0) * 0.5 + sin(uv.x * 35.0 + uTime * 3.0) * 0.5;\n      uv.x += wobble * thermalShimmer * lum0 * 0.006;\n      uv.y += wobble * thermalShimmer * lum0 * 0.003;\n    }\n\n    vec4 texColor = texture2D(uInput, uv);\n\n    float temp = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));\n    temp = pow(temp, 1.0 / max(thermalIntensity, 0.05));\n\n    // Sensor noise — banded horizontal rolling noise like a cheap IR sensor.\n    if (thermalSensorNoise > 0.001) {\n      float band = thHash(vec2(floor(vUv.y * uResolution.y * 0.5), floor(uTime * 8.0)));\n      temp += (band - 0.5) * thermalSensorNoise * 0.18;\n      temp = clamp(temp, 0.0, 1.0);\n    }\n\n    vec3 thermalColor;\n    int paletteType = int(thermalPalette);\n    if (paletteType == 0)      thermalColor = classicThermal(temp);\n    else if (paletteType == 1) thermalColor = ironbowPalette(temp);\n    else if (paletteType == 2) thermalColor = arcticPalette(temp);\n    else if (paletteType == 3) thermalColor = predatorPalette(temp);\n    else                       thermalColor = medicalPalette(temp);\n\n    gl_FragColor = vec4(thermalColor, texColor.a);\n  }\n",
    "defaults": {
      "thermalIntensity": 1,
      "thermalPalette": 0,
      "thermalShimmer": 0,
      "thermalSensorNoise": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "thermalIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Palette",
        "param": "thermalPalette",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Classic"
          },
          {
            "value": 1,
            "label": "Ironbow"
          },
          {
            "value": 2,
            "label": "Arctic"
          },
          {
            "value": 3,
            "label": "Predator"
          },
          {
            "value": 4,
            "label": "Medical (B/W)"
          }
        ]
      },
      {
        "name": "Heat Shimmer",
        "param": "thermalShimmer",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Sensor Noise",
        "param": "thermalSensorNoise",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "nightVision",
    "label": "Night Vision",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float nightVisionIntensity;     // 0-2 brightness boost\n  uniform float nightVisionNoise;         // 0-1 grain amount\n  uniform float nightVisionVignette;      // 0-1 circular vignette intensity\n  // Hero-rewrite params\n  uniform float nightVisionPhosphor;      // 0=green, 1=amber, 2=white phosphor\n  uniform float nightVisionBloom;         // 0-2 phosphor bloom strength\n  uniform float nightVisionScopeMask;     // 0=off, 1=circle (legacy), 2=scope crosshairs\n  uniform float nightVisionRollingNoise;  // 0-1 horizontal rolling noise band amplitude\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  float nvRandom(vec2 st) {\n    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);\n  }\n\n  vec3 phosphorTint(float lum, int phosphor) {\n    if (phosphor == 0) return vec3(lum * 0.2, lum, lum * 0.2);   // green\n    if (phosphor == 1) return vec3(lum, lum * 0.65, lum * 0.15); // amber (1980s NVGs)\n    return vec3(lum);                                             // white phosphor (modern)\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n\n    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));\n    lum = pow(lum, 0.8) * nightVisionIntensity;\n\n    int phos = int(nightVisionPhosphor + 0.5);\n    vec3 nvColor = phosphorTint(lum, phos);\n\n    // Scanlines (always on at low intensity).\n    float scanline = sin(vUv.y * uResolution.y * 2.0) * 0.5 + 0.5;\n    nvColor *= 0.95 + scanline * 0.05;\n\n    // Rolling noise — horizontal bands that scroll downward over time.\n    if (nightVisionRollingNoise > 0.001) {\n      float bandY = floor((vUv.y + uTime * 0.15) * 80.0);\n      float bandRand = nvRandom(vec2(bandY, floor(uTime * 4.0)));\n      nvColor += vec3(bandRand - 0.5) * nightVisionRollingNoise * 0.4 * vec3(0.0, 1.0, 0.0);\n    }\n\n    // Sensor grain.\n    float n = nvRandom(vUv * uResolution + uTime * 1000.0);\n    nvColor += (n - 0.5) * nightVisionNoise * 0.2;\n\n    // Phosphor bloom — ring sample around the pixel, weighted by tint.\n    if (nightVisionBloom > 0.001) {\n      float glowSum = 0.0;\n      for (int i = -2; i <= 2; i++) {\n        for (int j = -2; j <= 2; j++) {\n          vec2 offset = vec2(float(i), float(j)) / uResolution * (3.0 + nightVisionBloom * 2.0);\n          float s = dot(texture2D(uInput, vUv + offset).rgb, vec3(0.299, 0.587, 0.114));\n          glowSum += s;\n        }\n      }\n      glowSum /= 25.0;\n      vec3 bloomTint = phosphorTint(glowSum * 0.5, phos);\n      nvColor += bloomTint * nightVisionBloom;\n    }\n\n    // Scope mask.\n    int scope = int(nightVisionScopeMask + 0.5);\n    if (scope >= 1) {\n      vec2 center = vec2(0.5);\n      float dist = length(vUv - center);\n      float vig = 1.0 - smoothstep(0.3, 0.7, dist * (1.0 + nightVisionVignette));\n      float scopeEdge = smoothstep(0.48, 0.5, dist);\n      vig *= 1.0 - scopeEdge;\n      nvColor *= vig;\n      // Crosshairs overlay for mode 2.\n      if (scope == 2) {\n        float cx = abs(vUv.x - 0.5);\n        float cy = abs(vUv.y - 0.5);\n        float cross = step(cx, 0.001) + step(cy, 0.001);\n        // Tick marks every 0.05.\n        float tick = step(mod(vUv.y, 0.05), 0.002) * step(cx, 0.012)\n                   + step(mod(vUv.x, 0.05), 0.002) * step(cy, 0.012);\n        nvColor = mix(nvColor, phosphorTint(0.85, phos), min(cross + tick, 1.0));\n      }\n    }\n\n    gl_FragColor = vec4(clamp(nvColor, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "nightVisionIntensity": 1.5,
      "nightVisionNoise": 0.3,
      "nightVisionVignette": 0.5,
      "nightVisionPhosphor": 0,
      "nightVisionBloom": 0.6,
      "nightVisionScopeMask": 1,
      "nightVisionRollingNoise": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "nightVisionIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1.5
      },
      {
        "name": "Grain",
        "param": "nightVisionNoise",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Vignette",
        "param": "nightVisionVignette",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Phosphor",
        "param": "nightVisionPhosphor",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Green (classic)"
          },
          {
            "value": 1,
            "label": "Amber (1980s)"
          },
          {
            "value": 2,
            "label": "White (modern)"
          }
        ]
      },
      {
        "name": "Phosphor Bloom",
        "param": "nightVisionBloom",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Scope Mask",
        "param": "nightVisionScopeMask",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Off (full frame)"
          },
          {
            "value": 1,
            "label": "Circle"
          },
          {
            "value": 2,
            "label": "Scope + Crosshairs"
          }
        ]
      },
      {
        "name": "Rolling Bands",
        "param": "nightVisionRollingNoise",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "brightness",
    "label": "brightness",
    "category": "Effects",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float brightnessAmount;  // -1 to 1, brightness adjustment\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    texColor.rgb += brightnessAmount;\n    gl_FragColor = vec4(clamp(texColor.rgb, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "brightnessAmount": 0
    },
    "controls": [
      {
        "name": "Amount",
        "param": "brightnessAmount",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "contrast",
    "label": "contrast",
    "category": "Effects",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float contrastAmount;  // 0.5 to 2.0, contrast adjustment\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    texColor.rgb = (texColor.rgb - 0.5) * contrastAmount + 0.5;\n    gl_FragColor = vec4(clamp(texColor.rgb, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "contrastAmount": 0
    },
    "controls": [
      {
        "name": "Amount",
        "param": "contrastAmount",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "saturation",
    "label": "saturation",
    "category": "Effects",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float saturationAmount;  // 0 to 2, saturation adjustment\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n\n    // Convert RGB to HSL for saturation adjustment\n    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));\n    vec3 adjusted = mix(vec3(lum), texColor.rgb, saturationAmount);\n\n    gl_FragColor = vec4(adjusted, texColor.a);\n  }\n",
    "defaults": {
      "saturationAmount": 0
    },
    "controls": [
      {
        "name": "Amount",
        "param": "saturationAmount",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "hue",
    "label": "hue",
    "category": "Effects",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float hueShift;  // 0 to 1, hue rotation (0-360 degrees)\n  varying vec2 vUv;\n\n  vec3 rotateHue(vec3 color, float hueShift) {\n    const vec3 k = vec3(0.57735, 0.57735, 0.57735);\n    float cosAngle = cos(hueShift);\n    return color * cosAngle + cross(k, color) * sin(hueShift) + k * dot(k, color) * (1.0 - cosAngle);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n\n    // Rotate hue (hueShift is 0-1, convert to 0-2π)\n    float hueRotation = hueShift * 6.28318530718;\n    vec3 adjusted = rotateHue(texColor.rgb, hueRotation);\n\n    gl_FragColor = vec4(clamp(adjusted, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "hueShift": 0
    },
    "controls": [
      {
        "name": "Shift",
        "param": "hueShift",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "curves",
    "label": "Curves",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float curvesContrast;    // 0-1 — S-curve strength (0 = linear, 1 = strong S)\n  uniform float curvesToe;         // 0-1 — lift the dark end (anti-crush)\n  uniform float curvesShoulder;    // 0-1 — soften the bright end (anti-blow-out)\n  uniform float curvesBlackCrush;  // 0-1 — crush pixels below threshold to true black\n  uniform float curvesMix;\n  varying vec2 vUv;\n\n  // Hermite-style S curve centered at 0.5.\n  float sCurve(float x, float strength) {\n    float t = smoothstep(0.0, 1.0, x);\n    return mix(x, t * t * (3.0 - 2.0 * t), strength);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb;\n\n    // Pre-process: black crush — anything below threshold goes to 0.\n    vec3 crushed = src;\n    if (curvesBlackCrush > 0.001) {\n      float th = curvesBlackCrush * 0.15;\n      crushed = max(crushed - vec3(th), vec3(0.0)) / max(1.0 - th, 0.001);\n    }\n\n    // Apply S-curve per channel for contrast.\n    vec3 sShaped;\n    sShaped.r = sCurve(crushed.r, curvesContrast);\n    sShaped.g = sCurve(crushed.g, curvesContrast);\n    sShaped.b = sCurve(crushed.b, curvesContrast);\n\n    // Toe lift — raise the dark pixels back up.\n    vec3 toed = mix(sShaped, sShaped + (1.0 - sShaped) * 0.0, 0.0); // placeholder identity\n    // Toe = subtle gamma lift on shadows only.\n    if (curvesToe > 0.001) {\n      float toeAmt = curvesToe * 0.5;\n      sShaped = pow(sShaped, vec3(1.0 - toeAmt));\n    }\n\n    // Shoulder — soft compress highlights.\n    if (curvesShoulder > 0.001) {\n      vec3 sho = 1.0 - exp(-sShaped * (1.0 + curvesShoulder * 2.0));\n      sShaped = mix(sShaped, sho, curvesShoulder);\n    }\n\n    gl_FragColor = vec4(mix(src, sShaped, curvesMix), texColor.a);\n  }\n",
    "defaults": {
      "curvesContrast": 0.4,
      "curvesToe": 0,
      "curvesShoulder": 0,
      "curvesBlackCrush": 0,
      "curvesMix": 1
    },
    "controls": [
      {
        "name": "S-Curve",
        "param": "curvesContrast",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Toe (lift darks)",
        "param": "curvesToe",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Shoulder (soft hi)",
        "param": "curvesShoulder",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Black Crush",
        "param": "curvesBlackCrush",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "curvesMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "liftGammaGain",
    "label": "Lift / Gamma / Gain",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float lggLiftR;   uniform float lggLiftG;   uniform float lggLiftB;   // -0.5..+0.5\n  uniform float lggGammaR;  uniform float lggGammaG;  uniform float lggGammaB;  // 0.5..1.5 (1 = neutral)\n  uniform float lggGainR;   uniform float lggGainG;   uniform float lggGainB;   // 0.5..2.0\n  uniform float lggLumaOnly;// 0-1 — bypass color shifts, apply intensity only\n  uniform float lggMix;\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb;\n\n    vec3 lift  = vec3(lggLiftR,  lggLiftG,  lggLiftB);\n    vec3 gamma = vec3(lggGammaR, lggGammaG, lggGammaB);\n    vec3 gain  = vec3(lggGainR,  lggGainG,  lggGainB);\n\n    if (lggLumaOnly > 0.5) {\n      // Average the channels for luma-only operation.\n      float l = (lift.r + lift.g + lift.b) / 3.0;\n      float g = (gamma.r + gamma.g + gamma.b) / 3.0;\n      float gn = (gain.r + gain.g + gain.b) / 3.0;\n      lift = vec3(l); gamma = vec3(g); gain = vec3(gn);\n    }\n\n    // Standard ASC-CDL-ish formula: out = pow((src - 0) * gain + lift * (1 - src), 1/gamma)\n    // Simplified for our knob ranges — lift adds in shadows (multiplied by\n    // 1-src so it doesn't blow out highlights), gain multiplies, gamma is\n    // the inverse exponent.\n    vec3 lifted = src + lift * (vec3(1.0) - src) * 0.5;\n    vec3 gained = lifted * gain;\n    vec3 graded = pow(max(gained, vec3(0.0)), vec3(1.0) / max(gamma, vec3(0.05)));\n\n    gl_FragColor = vec4(clamp(mix(src, graded, lggMix), 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "lggLiftR": 0,
      "lggLiftG": 0,
      "lggLiftB": 0,
      "lggGammaR": 1,
      "lggGammaG": 1,
      "lggGammaB": 1,
      "lggGainR": 1,
      "lggGainG": 1,
      "lggGainB": 1,
      "lggLumaOnly": 0,
      "lggMix": 1
    },
    "controls": [
      {
        "name": "Lift R",
        "param": "lggLiftR",
        "min": -0.5,
        "max": 0.5,
        "step": 0.005,
        "default": 0
      },
      {
        "name": "Lift G",
        "param": "lggLiftG",
        "min": -0.5,
        "max": 0.5,
        "step": 0.005,
        "default": 0
      },
      {
        "name": "Lift B",
        "param": "lggLiftB",
        "min": -0.5,
        "max": 0.5,
        "step": 0.005,
        "default": 0
      },
      {
        "name": "Gamma R",
        "param": "lggGammaR",
        "min": 0.5,
        "max": 1.5,
        "step": 0.005,
        "default": 1
      },
      {
        "name": "Gamma G",
        "param": "lggGammaG",
        "min": 0.5,
        "max": 1.5,
        "step": 0.005,
        "default": 1
      },
      {
        "name": "Gamma B",
        "param": "lggGammaB",
        "min": 0.5,
        "max": 1.5,
        "step": 0.005,
        "default": 1
      },
      {
        "name": "Gain R",
        "param": "lggGainR",
        "min": 0.5,
        "max": 2,
        "step": 0.005,
        "default": 1
      },
      {
        "name": "Gain G",
        "param": "lggGainG",
        "min": 0.5,
        "max": 2,
        "step": 0.005,
        "default": 1
      },
      {
        "name": "Gain B",
        "param": "lggGainB",
        "min": 0.5,
        "max": 2,
        "step": 0.005,
        "default": 1
      },
      {
        "name": "Luma Only",
        "param": "lggLumaOnly",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Color (RGB shifts)"
          },
          {
            "value": 1,
            "label": "Luma only"
          }
        ]
      },
      {
        "name": "Mix",
        "param": "lggMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "exposure",
    "label": "Exposure",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float exposureStops;          // -2 to +2 stops (multiplied into the linear gain)\n  uniform float exposureRollOff;           // 0-1 highlight shoulder softness (0 = hard clip, 1 = very soft)\n  uniform float exposureHighlightProtect;  // 0-1 — reduce exposure gain on already-bright pixels\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb;\n\n    // Photographic exposure: each stop = 2× linear gain.\n    float gain = pow(2.0, exposureStops);\n\n    // Highlight protect — reduce gain locally on bright pixels. Per-pixel\n    // luminance feeds a smoothstep so dark/mid pixels get full gain and\n    // bright pixels get less. exposureHighlightProtect=1 means highlights are\n    // mostly preserved; =0 means uniform gain across the image.\n    float lum = dot(src, vec3(0.299, 0.587, 0.114));\n    float protect = 1.0 - exposureHighlightProtect * smoothstep(0.5, 1.0, lum);\n    vec3 lifted = src * gain * protect;\n\n    // Highlight roll-off — soft-knee compress the top end so values\n    // above 1 fold back toward 1 instead of clipping. exposureRollOff=0 leaves\n    // the legacy hard clip; exposureRollOff=1 gives a very soft shoulder.\n    if (exposureRollOff > 0.001) {\n      float k = mix(8.0, 1.0, exposureRollOff); // higher k = sharper knee\n      // Reinhard-style: x / (1 + x/k) — smooth asymptote toward 1.\n      lifted = lifted / (1.0 + max(lifted - 0.0, 0.0) / k);\n    }\n\n    gl_FragColor = vec4(clamp(lifted, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "exposureStops": 0,
      "exposureRollOff": 0,
      "exposureHighlightProtect": 0
    },
    "controls": [
      {
        "name": "Exposure (stops)",
        "param": "exposureStops",
        "min": -2,
        "max": 2,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Highlight Roll-off",
        "param": "exposureRollOff",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Highlight Protect",
        "param": "exposureHighlightProtect",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "gamma",
    "label": "Gamma",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float gammaShadows;     // 0.2-3.0 gamma for shadow region\n  uniform float gammaMids;        // 0.2-3.0 gamma for midtones\n  uniform float gammaHighlights;  // 0.2-3.0 gamma for highlights\n  uniform float gammaMix;         // 0-1 wet/dry\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb;\n    float lum = dot(src, vec3(0.299, 0.587, 0.114));\n    // Three smoothstep weights centered on 0.15 / 0.5 / 0.85.\n    float wS = 1.0 - smoothstep(0.0, 0.5, lum);\n    float wH = smoothstep(0.5, 1.0, lum);\n    float wM = 1.0 - wS - wH;\n    // Blend the three gamma curves additively by weight.\n    vec3 gS = pow(src, vec3(max(gammaShadows, 0.0001)));\n    vec3 gM = pow(src, vec3(max(gammaMids, 0.0001)));\n    vec3 gH = pow(src, vec3(max(gammaHighlights, 0.0001)));\n    vec3 graded = gS * wS + gM * wM + gH * wH;\n    gl_FragColor = vec4(mix(src, graded, gammaMix), texColor.a);\n  }\n",
    "defaults": {
      "gammaShadows": 1,
      "gammaMids": 1,
      "gammaHighlights": 1,
      "gammaMix": 1
    },
    "controls": [
      {
        "name": "Shadows γ",
        "param": "gammaShadows",
        "min": 0.2,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mids γ",
        "param": "gammaMids",
        "min": 0.2,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Highlights γ",
        "param": "gammaHighlights",
        "min": 0.2,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mix",
        "param": "gammaMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "temperatureTint",
    "label": "Temperature / Tint",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float tempTemperature;   // -1..+1 — cool (blue) to warm (orange)\n  uniform float tempTint;          // -1..+1 — green to magenta\n  uniform float tempShadow;    // -1..+1 — split-tone shadows (used when tempSplitTone > 0)\n  uniform float tempHighlight; // -1..+1 — split-tone highlights\n  uniform float tempSplitTone;     // 0-1 — blend factor between simple temp and split-tone\n  uniform float tempAutoCycle;     // 0-1 — auto temperature oscillation amplitude\n  uniform float uTime;\n  varying vec2 vUv;\n\n  vec3 tempShift(float t) {\n    // Approximate kelvin shift: warm = +R/-B, cool = -R/+B, slight G compensation.\n    return vec3(t * 0.30, t * 0.05, -t * 0.30);\n  }\n  vec3 tintShift(float t) {\n    // Green = +G/-RB, magenta = -G/+RB.\n    return vec3(-t * 0.10, t * 0.18, -t * 0.10);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb;\n\n    // Auto-cycle adds a slow sine-wave temperature offset.\n    float autoT = sin(uTime * 0.4) * tempAutoCycle * 0.5;\n\n    // Single-temp path (tempSplitTone=0).\n    vec3 simple = src + tempShift(tempTemperature + autoT) + tintShift(tempTint);\n\n    // Split-tone path: per-pixel temperature based on luminance.\n    float lum = dot(src, vec3(0.299, 0.587, 0.114));\n    float perPixT = mix(tempShadow, tempHighlight, smoothstep(0.0, 1.0, lum));\n    vec3 split = src + tempShift(perPixT + autoT) + tintShift(tempTint);\n\n    vec3 result = mix(simple, split, tempSplitTone);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "tempTemperature": 0,
      "tempTint": 0,
      "tempShadow": 0,
      "tempHighlight": 0,
      "tempSplitTone": 0,
      "tempAutoCycle": 0
    },
    "controls": [
      {
        "name": "Temperature (cool↔warm)",
        "param": "tempTemperature",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tint (green↔magenta)",
        "param": "tempTint",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Shadow Temp (split)",
        "param": "tempShadow",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Highlight Temp (split)",
        "param": "tempHighlight",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Split-Tone Mix",
        "param": "tempSplitTone",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Auto Cycle",
        "param": "tempAutoCycle",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "vibrance",
    "label": "Vibrance",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float vibranceAmount;        // -1..+1 — positive boosts muted colors, negative desaturates\n  uniform float vibranceSkinProtect;     // 0-1 — reduce vibrance push on skin-tone hues\n  uniform float vibranceHighlightProtect;// 0-1 — reduce vibrance push on bright pixels\n  uniform float vibranceCeiling;         // 0-1 — clamp final saturation (1 = no clamp)\n  varying vec2 vUv;\n\n  vec3 rgb2hsv(vec3 c) {\n    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);\n    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n    float d = q.x - min(q.w, q.y);\n    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);\n  }\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 hsv = rgb2hsv(texColor.rgb);\n\n    // Skin tone protect — peak around hue ~0.05 (orange-pink ~30°),\n    // gaussian falloff. Reduces the vibrance push by skinProtect there.\n    float skinDist = abs(hsv.x - 0.05);\n    if (skinDist > 0.5) skinDist = 1.0 - skinDist; // hue is circular\n    float skinMask = exp(-(skinDist * skinDist) / 0.01); // ~σ=0.1\n    float skinScale = 1.0 - vibranceSkinProtect * skinMask;\n\n    // Highlight protect — reduce push on already bright pixels.\n    float hlScale = 1.0 - vibranceHighlightProtect * smoothstep(0.6, 1.0, hsv.z);\n\n    // Vibrance boost — non-linear so muted colors lift more than already\n    // saturated ones (the classic Lightroom Vibrance behavior).\n    float boost = vibranceAmount * (1.0 - hsv.y) * skinScale * hlScale;\n    hsv.y = clamp(hsv.y + boost, 0.0, vibranceCeiling);\n\n    gl_FragColor = vec4(hsv2rgb(hsv), texColor.a);\n  }\n",
    "defaults": {
      "vibranceAmount": 0.3,
      "vibranceSkinProtect": 0.5,
      "vibranceHighlightProtect": 0.3,
      "vibranceCeiling": 1
    },
    "controls": [
      {
        "name": "Vibrance",
        "param": "vibranceAmount",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Skin Protect",
        "param": "vibranceSkinProtect",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Highlight Protect",
        "param": "vibranceHighlightProtect",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Saturation Ceiling",
        "param": "vibranceCeiling",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "colorBalance",
    "label": "Color Balance",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float cbShadowR;     uniform float cbShadowG;     uniform float cbShadowB;     // -1..+1 each\n  uniform float cbMidR;        uniform float cbMidG;        uniform float cbMidB;\n  uniform float cbHighR;       uniform float cbHighG;       uniform float cbHighB;\n  uniform float cbPreserveLuma;// 0-1 keep luma stable while shifting hue\n  uniform float cbMix;\n  varying vec2 vUv;\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb;\n    float lum = dot(src, vec3(0.299, 0.587, 0.114));\n\n    // Three smoothstep weights matching Gamma hero's three-zone setup.\n    float wS = 1.0 - smoothstep(0.0, 0.5, lum);\n    float wH = smoothstep(0.5, 1.0, lum);\n    float wM = 1.0 - wS - wH;\n\n    vec3 shift = vec3(cbShadowR, cbShadowG, cbShadowB) * wS * 0.3\n               + vec3(cbMidR,    cbMidG,    cbMidB)    * wM * 0.3\n               + vec3(cbHighR,   cbHighG,   cbHighB)   * wH * 0.3;\n\n    vec3 graded = src + shift;\n\n    if (cbPreserveLuma > 0.001) {\n      float newLum = dot(graded, vec3(0.299, 0.587, 0.114));\n      graded += (lum - newLum) * cbPreserveLuma;\n    }\n\n    gl_FragColor = vec4(clamp(mix(src, graded, cbMix), 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "cbShadowR": 0,
      "cbShadowG": 0,
      "cbShadowB": 0,
      "cbMidR": 0,
      "cbMidG": 0,
      "cbMidB": 0,
      "cbHighR": 0,
      "cbHighG": 0,
      "cbHighB": 0,
      "cbPreserveLuma": 1,
      "cbMix": 1
    },
    "controls": [
      {
        "name": "Shadow R",
        "param": "cbShadowR",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Shadow G",
        "param": "cbShadowG",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Shadow B",
        "param": "cbShadowB",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mid R",
        "param": "cbMidR",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mid G",
        "param": "cbMidG",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mid B",
        "param": "cbMidB",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Highlight R",
        "param": "cbHighR",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Highlight G",
        "param": "cbHighG",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Highlight B",
        "param": "cbHighB",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Preserve Luma",
        "param": "cbPreserveLuma",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mix",
        "param": "cbMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "filmGrain",
    "label": "Film Grain",
    "category": "Generate & Texture",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float grainAmount;        // 0-1 grain strength\n  uniform float grainSize;          // 0.5-4 grain size (px)\n  uniform float grainShadow;   // 0-1 grain in shadows\n  uniform float grainMid;      // 0-1 grain in midtones\n  uniform float grainHigh;     // 0-1 grain in highlights\n  uniform float grainMono;          // 0-1 monochrome grain (vs RGB)\n  uniform float grainStock;         // 0=fine, 1=35mm, 2=16mm, 3=Super8\n  uniform float grainColorJitter;   // 0-1 chroma noise\n  uniform float uTime;\n  uniform float grainAnimSpeed;     // 0-1 anim speed (1 = per-frame)\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash13(vec3 p) {\n    p = fract(p * vec3(443.8975, 397.2973, 491.1871));\n    p += dot(p, p.yzx + 19.19);\n    return fract((p.x + p.y) * p.z);\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (grainAmount < 0.001) { gl_FragColor = src; return; }\n\n    int stock = int(grainStock + 0.5);\n    float grainScale = (stock == 0) ? 1.5 : (stock == 1) ? 1.0 : (stock == 2) ? 0.6 : 0.35;\n    grainScale *= grainSize;\n    vec2 gPos = vUv * uResolution / max(0.5, grainScale);\n    float t = floor(uTime * grainAnimSpeed * 24.0) / 24.0;\n\n    float n = hash13(vec3(gPos, t));\n    vec3 noiseRgb;\n    if (grainMono > 0.5) {\n      noiseRgb = vec3(n - 0.5);\n    } else {\n      float r = hash13(vec3(gPos, t + 0.1));\n      float g = hash13(vec3(gPos, t + 0.3));\n      float b = hash13(vec3(gPos, t + 0.7));\n      noiseRgb = vec3(r - 0.5, g - 0.5, b - 0.5);\n    }\n\n    // Tonal response — different grain in shadows / mids / highs\n    float l = luma(src.rgb);\n    float shadowMask = 1.0 - smoothstep(0.0, 0.4, l);\n    float midMask = (1.0 - abs(l - 0.5) * 2.0);\n    float highMask = smoothstep(0.6, 1.0, l);\n    float zoneAmp = shadowMask * grainShadow + midMask * grainMid + highMask * grainHigh;\n\n    float chromaJit = 0.0;\n    if (grainColorJitter > 0.001) {\n      chromaJit = (hash13(vec3(gPos, t + 0.5)) - 0.5) * grainColorJitter;\n    }\n\n    vec3 grain = noiseRgb * grainAmount * zoneAmp + vec3(chromaJit, -chromaJit, chromaJit * 0.5) * 0.2;\n    vec3 result = src.rgb + grain;\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);\n  }\n",
    "defaults": {
      "grainAmount": 0.3,
      "grainSize": 1,
      "grainShadow": 0.7,
      "grainMid": 1,
      "grainHigh": 0.5,
      "grainMono": 0,
      "grainStock": 1,
      "grainColorJitter": 0,
      "grainAnimSpeed": 1
    },
    "controls": [
      {
        "name": "Amount",
        "param": "grainAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Grain Size",
        "param": "grainSize",
        "min": 0.5,
        "max": 4,
        "step": 0.1,
        "default": 1
      },
      {
        "name": "Shadow Grain",
        "param": "grainShadow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Mid Grain",
        "param": "grainMid",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Highlight Grain",
        "param": "grainHigh",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Mono",
        "param": "grainMono",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Stock",
        "param": "grainStock",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Fine"
          },
          {
            "value": 1,
            "label": "35mm"
          },
          {
            "value": 2,
            "label": "16mm"
          },
          {
            "value": 3,
            "label": "Super 8"
          }
        ]
      },
      {
        "name": "Color Jitter",
        "param": "grainColorJitter",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Anim Speed",
        "param": "grainAnimSpeed",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "bloom",
    "label": "Bloom",
    "category": "Light & Glow",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float amount;\n  uniform float bloomIntensity;\n  uniform float threshold;\n  uniform float bloomKnee;\n  uniform float bloomRadius;\n  uniform float bloomAnamorphic;\n  uniform float red;\n  uniform float green;\n  uniform float blue;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec3 thresholdKnee(vec3 col, float threshold, float knee) {\n    float br = max(max(col.r, col.g), col.b);\n    float kneeAmt = max(knee, 0.0001);\n    float soft = clamp(br - threshold + kneeAmt, 0.0, 2.0 * kneeAmt);\n    soft = soft * soft / (4.0 * kneeAmt + 0.00001);\n    float contribution = max(soft, br - threshold) / max(br, 0.00001);\n    return col * contribution;\n  }\n\n  vec3 ringSample(sampler2D tex, vec2 uv, vec2 px, float radius) {\n    vec3 acc = vec3(0.0);\n    float aniso = clamp(bloomAnamorphic, 0.0, 1.0);\n    vec2 r = px * radius * vec2(1.0, 1.0 - aniso * 0.92);\n    acc += texture2D(tex, uv + r * vec2( 1.0,  0.0)).rgb;\n    acc += texture2D(tex, uv + r * vec2(-1.0,  0.0)).rgb;\n    acc += texture2D(tex, uv + r * vec2( 0.7,  0.7)).rgb;\n    acc += texture2D(tex, uv + r * vec2(-0.7,  0.7)).rgb;\n    acc += texture2D(tex, uv + r * vec2( 0.7, -0.7)).rgb;\n    acc += texture2D(tex, uv + r * vec2(-0.7, -0.7)).rgb;\n    acc += texture2D(tex, uv + r * vec2( 0.0,  1.0)).rgb;\n    acc += texture2D(tex, uv + r * vec2( 0.0, -1.0)).rgb;\n    acc += texture2D(tex, uv + r * vec2( 1.7,  0.0)).rgb;\n    acc += texture2D(tex, uv + r * vec2(-1.7,  0.0)).rgb;\n    acc += texture2D(tex, uv + r * vec2( 0.0,  1.7)).rgb;\n    acc += texture2D(tex, uv + r * vec2( 0.0, -1.7)).rgb;\n    acc += texture2D(tex, uv).rgb;\n    return acc / 13.0;\n  }\n\n  void main() {\n    vec4 baseColor = texture2D(uInput, vUv);\n    vec2 px = 1.0 / uResolution;\n    float baseR = bloomRadius * 9.0 + 1.5;\n    vec3 ring1 = ringSample(uInput, vUv, px, baseR * 1.0);\n    vec3 ring2 = ringSample(uInput, vUv, px, baseR * 2.2);\n    vec3 ring3 = ringSample(uInput, vUv, px, baseR * 4.5);\n    vec3 blurred = ring1 * 0.55 + ring2 * 0.3 + ring3 * 0.15;\n    vec3 bloom = thresholdKnee(blurred, threshold, bloomKnee);\n    bloom *= bloomIntensity;\n    bloom *= vec3(red, green, blue);\n    vec3 composited = 1.0 - (1.0 - baseColor.rgb) * (1.0 - bloom);\n    vec3 finalColor = mix(baseColor.rgb, composited, amount);\n    gl_FragColor = vec4(finalColor, baseColor.a);\n  }\n",
    "defaults": {
      "amount": 0.6,
      "bloomIntensity": 1,
      "threshold": 0.6,
      "bloomKnee": 0.4,
      "bloomRadius": 0.5,
      "bloomAnamorphic": 0,
      "red": 1,
      "green": 1,
      "blue": 1
    },
    "controls": [
      {
        "name": "Mix",
        "param": "amount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Intensity",
        "param": "bloomIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Threshold",
        "param": "threshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Knee Softness",
        "param": "bloomKnee",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Radius",
        "param": "bloomRadius",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Anamorphic",
        "param": "bloomAnamorphic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tint R",
        "param": "red",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "green",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint B",
        "param": "blue",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "chromaticAberration",
    "label": "Chromatic Aberration",
    "category": "Light & Glow",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float caAmount;        // 0-1 strength\n  uniform float caMode;          // 0=linear, 1=radial, 2=lens (cubic), 3=prism\n  uniform float caAngle;         // 0-360 (linear)\n  uniform float caCenterX;       // 0-1\n  uniform float caCenterY;       // 0-1\n  uniform float caEdgeFalloff;   // 0-1 weight by distance from center\n  uniform float caMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (caAmount < 0.001) { gl_FragColor = src; return; }\n\n    int mode = int(caMode + 0.5);\n    vec2 center = vec2(caCenterX, caCenterY);\n    vec2 d = vUv - center;\n    float dist = length(d);\n\n    vec2 dirR, dirB;\n    float strength = caAmount * 0.05;\n\n    if (mode == 0) {\n      // Linear (directional)\n      float ang = radians(caAngle);\n      vec2 dir = vec2(cos(ang), sin(ang));\n      dirR =  dir * strength;\n      dirB = -dir * strength;\n    } else if (mode == 1) {\n      // Radial outward\n      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);\n      dirR =  nd * strength;\n      dirB = -nd * strength;\n    } else if (mode == 2) {\n      // Lens (cubic falloff — like real glass)\n      float k = strength * (dist * dist * 4.0);\n      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);\n      dirR =  nd * k;\n      dirB = -nd * k;\n    } else {\n      // Prism rainbow spread\n      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);\n      dirR =  nd * strength * 1.5;\n      dirB = -nd * strength * 1.5;\n    }\n\n    // Edge falloff weight (only push at the edges)\n    float weight = mix(1.0, dist * 2.0, caEdgeFalloff);\n\n    vec2 offR = dirR * weight;\n    vec2 offB = dirB * weight;\n    float r = texture2D(uInput, vUv + offR).r;\n    float g = texture2D(uInput, vUv).g;\n    float b = texture2D(uInput, vUv + offB).b;\n    vec3 result = vec3(r, g, b);\n\n    // Prism mode adds extra mid-spectrum tints\n    if (mode == 3) {\n      vec2 nd = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);\n      float yE = texture2D(uInput, vUv + nd * strength * 0.7 * weight).r * 0.5\n               + texture2D(uInput, vUv + nd * strength * 0.7 * weight).g * 0.5;\n      result.r = mix(result.r, max(result.r, yE), 0.3);\n      result.g = mix(result.g, yE, 0.2);\n    }\n\n    gl_FragColor = vec4(mix(src.rgb, result, caMix), src.a);\n  }\n",
    "defaults": {
      "caAmount": 0.4,
      "caMode": 1,
      "caAngle": 0,
      "caCenterX": 0.5,
      "caCenterY": 0.5,
      "caEdgeFalloff": 0.5,
      "caMix": 1
    },
    "controls": [
      {
        "name": "Amount",
        "param": "caAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Mode",
        "param": "caMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Linear"
          },
          {
            "value": 1,
            "label": "Radial"
          },
          {
            "value": 2,
            "label": "Lens (cubic)"
          },
          {
            "value": 3,
            "label": "Prism"
          }
        ]
      },
      {
        "name": "Angle",
        "param": "caAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Center X",
        "param": "caCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "caCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Edge Falloff",
        "param": "caEdgeFalloff",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Mix",
        "param": "caMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "lensDistortion",
    "label": "Lens Distortion",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float lensDistAmount;        // -1..1\n  uniform float lensDistMode;          // 0=barrel, 1=pincushion, 2=mustache, 3=anamorphic\n  uniform float lensDistCenterX;\n  uniform float lensDistCenterY;\n  uniform float lensDistCubic;         // -0.5..0.5 cubic term (mustache uses both)\n  uniform float lensDistAnamorphicX;   // 0.5-2 horizontal stretch\n  uniform float lensDistEdgeFade;      // 0-1 fade at edges (transparent border)\n  uniform float lensDistChromaFringe;  // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec2 lensMap(vec2 uv, float k1, float k2) {\n    vec2 c = vec2(lensDistCenterX, lensDistCenterY);\n    vec2 d = uv - c;\n    d.x *= uResolution.x / uResolution.y;\n    float r2 = dot(d, d);\n    float factor = 1.0 + k1 * r2 + k2 * r2 * r2;\n    d *= factor;\n    d.x *= uResolution.y / uResolution.x;\n    return d + c;\n  }\n\n  void main() {\n    int mode = int(lensDistMode + 0.5);\n    float k1, k2;\n    if (mode == 0) { k1 = lensDistAmount; k2 = 0.0; }\n    else if (mode == 1) { k1 = -lensDistAmount; k2 = 0.0; }\n    else if (mode == 2) { k1 = lensDistAmount; k2 = lensDistCubic; }\n    else { k1 = 0.0; k2 = 0.0; }\n\n    vec2 uv;\n    if (mode == 3) {\n      // Anamorphic stretch — no radial, just X scale\n      vec2 c = vec2(lensDistCenterX, lensDistCenterY);\n      vec2 d = vUv - c;\n      d.x /= max(0.1, lensDistAnamorphicX);\n      uv = d + c;\n    } else {\n      uv = lensMap(vUv, k1, k2);\n    }\n\n    vec3 col;\n    if (lensDistChromaFringe > 0.001) {\n      vec2 uvR = lensMap(vUv, k1 * (1.0 + lensDistChromaFringe * 0.05), k2);\n      vec2 uvB = lensMap(vUv, k1 * (1.0 - lensDistChromaFringe * 0.05), k2);\n      col.r = texture2D(uInput, clamp(uvR, vec2(0.0), vec2(1.0))).r;\n      col.g = texture2D(uInput, clamp(uv, vec2(0.0), vec2(1.0))).g;\n      col.b = texture2D(uInput, clamp(uvB, vec2(0.0), vec2(1.0))).b;\n    } else {\n      col = texture2D(uInput, clamp(uv, vec2(0.0), vec2(1.0))).rgb;\n    }\n\n    // Edge fade — transparent border for OOB samples\n    float oob = step(uv.x, 0.0) + step(1.0, uv.x) + step(uv.y, 0.0) + step(1.0, uv.y);\n    oob = min(oob, 1.0);\n    float aFade = mix(1.0, 0.0, oob * lensDistEdgeFade);\n\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(col, src.a * aFade);\n  }\n",
    "defaults": {
      "lensDistAmount": 0.4,
      "lensDistMode": 0,
      "lensDistCenterX": 0.5,
      "lensDistCenterY": 0.5,
      "lensDistCubic": 0,
      "lensDistAnamorphicX": 1.3,
      "lensDistEdgeFade": 1,
      "lensDistChromaFringe": 0
    },
    "controls": [
      {
        "name": "Amount",
        "param": "lensDistAmount",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Mode",
        "param": "lensDistMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Barrel"
          },
          {
            "value": 1,
            "label": "Pincushion"
          },
          {
            "value": 2,
            "label": "Mustache"
          },
          {
            "value": 3,
            "label": "Anamorphic"
          }
        ]
      },
      {
        "name": "Center X",
        "param": "lensDistCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "lensDistCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Cubic Term",
        "param": "lensDistCubic",
        "min": -0.5,
        "max": 0.5,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "X Stretch",
        "param": "lensDistAnamorphicX",
        "min": 0.5,
        "max": 2,
        "step": 0.01,
        "default": 1.3
      },
      {
        "name": "Edge Fade",
        "param": "lensDistEdgeFade",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Chroma Fringe",
        "param": "lensDistChromaFringe",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "tiltShift",
    "label": "Tilt Shift",
    "category": "Blur & Focus",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float tiltShiftMode;          // 0=horizontal, 1=vertical, 2=radial, 3=linear gradient\n  uniform float tiltShiftFocusY;        // 0-1 focus center\n  uniform float tiltShiftFocusX;        // 0-1 (used by radial)\n  uniform float tiltShiftFocusBand;     // 0-1 sharp band width\n  uniform float tiltShiftFalloff;       // 0-1 transition softness\n  uniform float tiltShiftMaxBlur;       // 0-1 max blur amount\n  uniform float tiltShiftAngle;         // 0-360 (linear gradient direction)\n  uniform float tiltShiftSaturation;    // 0-2 saturation in defocused area (miniature look)\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  vec3 sampleBlur(vec2 uv, float r) {\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n    vec2 texel = 1.0 / uResolution;\n    for (int y = -3; y <= 3; y++) {\n      for (int x = -3; x <= 3; x++) {\n        vec2 off = vec2(float(x), float(y)) * texel * r;\n        float w = exp(-(float(x*x + y*y)) / 8.0);\n        acc += texture2D(uInput, uv + off).rgb * w;\n        wsum += w;\n      }\n    }\n    return acc / wsum;\n  }\n\n  void main() {\n    int mode = int(tiltShiftMode + 0.5);\n    float blurMask = 0.0;\n    float band = max(0.001, tiltShiftFocusBand);\n    float falloff = max(0.001, tiltShiftFalloff);\n\n    if (mode == 0) {\n      // Horizontal band\n      float d = abs(vUv.y - tiltShiftFocusY);\n      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, d);\n    } else if (mode == 1) {\n      // Vertical band\n      float d = abs(vUv.x - tiltShiftFocusX);\n      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, d);\n    } else if (mode == 2) {\n      // Radial spotlight focus\n      vec2 d = vUv - vec2(tiltShiftFocusX, tiltShiftFocusY);\n      float dist = length(d);\n      blurMask = smoothstep(band * 0.5, band * 0.5 + falloff, dist);\n    } else {\n      // Linear gradient\n      float ang = radians(tiltShiftAngle);\n      vec2 dir = vec2(cos(ang), sin(ang));\n      float t = dot(vUv - vec2(tiltShiftFocusX, tiltShiftFocusY), dir);\n      blurMask = smoothstep(-band * 0.5, band * 0.5 + falloff, abs(t));\n    }\n\n    vec4 src = texture2D(uInput, vUv);\n    float blurR = blurMask * tiltShiftMaxBlur * 14.0;\n    vec3 blurred = (blurR > 0.1) ? sampleBlur(vUv, blurR) : src.rgb;\n\n    // Saturation tweak in defocused area (miniature/tilt-shift look)\n    if (abs(tiltShiftSaturation - 1.0) > 0.001) {\n      float lum = luma(blurred);\n      blurred = mix(vec3(lum), blurred, tiltShiftSaturation);\n    }\n\n    vec3 result = mix(src.rgb, blurred, blurMask);\n    gl_FragColor = vec4(result, src.a);\n  }\n",
    "defaults": {
      "tiltShiftMode": 0,
      "tiltShiftFocusY": 0.5,
      "tiltShiftFocusX": 0.5,
      "tiltShiftFocusBand": 0.2,
      "tiltShiftFalloff": 0.3,
      "tiltShiftMaxBlur": 0.5,
      "tiltShiftAngle": 0,
      "tiltShiftSaturation": 1.2
    },
    "controls": [
      {
        "name": "Mode",
        "param": "tiltShiftMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Horizontal Band"
          },
          {
            "value": 1,
            "label": "Vertical Band"
          },
          {
            "value": 2,
            "label": "Radial Spotlight"
          },
          {
            "value": 3,
            "label": "Linear Gradient"
          }
        ]
      },
      {
        "name": "Focus Y",
        "param": "tiltShiftFocusY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Focus X",
        "param": "tiltShiftFocusX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Sharp Band",
        "param": "tiltShiftFocusBand",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Falloff",
        "param": "tiltShiftFalloff",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Max Blur",
        "param": "tiltShiftMaxBlur",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Angle",
        "param": "tiltShiftAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Defocus Sat",
        "param": "tiltShiftSaturation",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1.2
      }
    ],
    "integerParams": []
  },
  {
    "type": "godRays",
    "label": "God Rays",
    "category": "Light & Glow",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float godRaysIntensity;     // 0-2\n  uniform float godRaysDecay;         // 0.85-1.0 sample decay\n  uniform float godRaysExposure;      // 0.1-1 exposure scale\n  uniform float godRaysDensity;       // 0-1 sample density\n  uniform float godRaysThreshold;     // 0-1 brightness gate\n  uniform float godRaysCenterX;       // 0-1 sun position\n  uniform float godRaysCenterY;       // 0-1\n  uniform float godRaysSamples;       // 16-128\n  uniform float godRaysTintR;         // 0-1\n  uniform float godRaysTintG;         // 0-1\n  uniform float godRaysTintB;         // 0-1\n  uniform float godRaysMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (godRaysIntensity < 0.001) { gl_FragColor = src; return; }\n\n    int samples = int(clamp(godRaysSamples, 8.0, 128.0));\n    vec2 sun = vec2(godRaysCenterX, godRaysCenterY);\n    vec2 deltaUv = (vUv - sun) * (godRaysDensity / float(samples));\n    vec2 cur = vUv;\n    float illum = 1.0;\n    vec3 acc = vec3(0.0);\n\n    for (int i = 0; i < 128; i++) {\n      if (i >= samples) break;\n      cur -= deltaUv;\n      vec3 s = texture2D(uInput, cur).rgb;\n      // Threshold gate — only bright pixels emit rays\n      float gate = smoothstep(godRaysThreshold, godRaysThreshold + 0.15, luma(s));\n      acc += s * gate * illum;\n      illum *= godRaysDecay;\n    }\n    acc *= godRaysExposure * godRaysIntensity;\n    acc *= vec3(godRaysTintR, godRaysTintG, godRaysTintB);\n\n    vec3 result = src.rgb + acc * godRaysMix;\n    gl_FragColor = vec4(result, src.a);\n  }\n",
    "defaults": {
      "godRaysIntensity": 0.7,
      "godRaysDecay": 0.95,
      "godRaysExposure": 0.4,
      "godRaysDensity": 0.95,
      "godRaysThreshold": 0.7,
      "godRaysCenterX": 0.5,
      "godRaysCenterY": 0.2,
      "godRaysSamples": 64,
      "godRaysTintR": 1,
      "godRaysTintG": 0.95,
      "godRaysTintB": 0.85,
      "godRaysMix": 1
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "godRaysIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Decay",
        "param": "godRaysDecay",
        "min": 0.85,
        "max": 1,
        "step": 0.001,
        "default": 0.95
      },
      {
        "name": "Exposure",
        "param": "godRaysExposure",
        "min": 0.1,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Density",
        "param": "godRaysDensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Threshold",
        "param": "godRaysThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Sun X",
        "param": "godRaysCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Sun Y",
        "param": "godRaysCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Samples",
        "param": "godRaysSamples",
        "min": 16,
        "max": 128,
        "step": 4,
        "default": 64
      },
      {
        "name": "Tint R",
        "param": "godRaysTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "godRaysTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Tint B",
        "param": "godRaysTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Mix",
        "param": "godRaysMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "heatHaze",
    "label": "Heat Haze",
    "category": "Generate & Texture",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float hazeAmount;        // 0-1 displacement strength\n  uniform float hazeScale;         // 1-32 noise scale\n  uniform float hazeSpeed;         // 0-3 animation speed\n  uniform float hazeDirectionY;    // -1..1 vertical bias (rising heat)\n  uniform float hazeTurbulence;    // 0-1 fbm turbulence\n  uniform float hazeMode;          // 0=heat shimmer, 1=underwater, 2=glass distort\n  uniform float hazeFocusY;        // 0-1 vertical position where haze peaks\n  uniform float hazeFocusBand;     // 0-1 band width\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float fbm(vec2 p) {\n    float v = 0.0; float amp = 0.5;\n    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }\n    return v;\n  }\n\n  void main() {\n    if (hazeAmount < 0.001) { gl_FragColor = texture2D(uInput, vUv); return; }\n\n    int mode = int(hazeMode + 0.5);\n    vec2 p = vUv * hazeScale + vec2(0.0, -uTime * hazeSpeed * 0.5);\n    p.y += hazeDirectionY * uTime * hazeSpeed * 0.3;\n\n    float nx, ny;\n    if (hazeTurbulence > 0.001) {\n      nx = fbm(p) - 0.5;\n      ny = fbm(p + vec2(123.4, 56.7)) - 0.5;\n    } else {\n      nx = vnoise(p) - 0.5;\n      ny = vnoise(p + vec2(123.4, 56.7)) - 0.5;\n    }\n\n    float strength = hazeAmount * 0.05;\n    if (mode == 0) {\n      // Heat shimmer — mostly horizontal, falls off above focusY\n      ny *= 0.4;\n      float bandMask = exp(-pow((vUv.y - hazeFocusY) / max(0.05, hazeFocusBand), 2.0));\n      strength *= bandMask;\n    } else if (mode == 1) {\n      // Underwater — both directions, sinusoidal modulation\n      float wave = sin(uTime * hazeSpeed + vUv.y * 8.0) * 0.5;\n      nx *= (1.0 + wave * 0.5);\n      ny *= (1.0 + wave * 0.5);\n    } else {\n      // Glass distort — strong, both directions\n      strength *= 1.5;\n    }\n\n    vec2 off = vec2(nx, ny) * strength;\n    vec4 src = texture2D(uInput, vUv + off);\n    gl_FragColor = src;\n  }\n",
    "defaults": {
      "hazeAmount": 0.4,
      "hazeScale": 8,
      "hazeSpeed": 1,
      "hazeDirectionY": 0.5,
      "hazeTurbulence": 0.5,
      "hazeMode": 0,
      "hazeFocusY": 0.5,
      "hazeFocusBand": 0.4
    },
    "controls": [
      {
        "name": "Distortion",
        "param": "hazeAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Pattern Scale",
        "param": "hazeScale",
        "min": 1,
        "max": 32,
        "step": 0.5,
        "default": 8
      },
      {
        "name": "Speed",
        "param": "hazeSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Vertical Bias",
        "param": "hazeDirectionY",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Turbulence",
        "param": "hazeTurbulence",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Mode",
        "param": "hazeMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Heat Shimmer"
          },
          {
            "value": 1,
            "label": "Underwater"
          },
          {
            "value": 2,
            "label": "Glass Distort"
          }
        ]
      },
      {
        "name": "Heat Band Y",
        "param": "hazeFocusY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Heat Band Width",
        "param": "hazeFocusBand",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      }
    ],
    "integerParams": []
  },
  {
    "type": "directionalBlur",
    "label": "Directional Blur",
    "category": "Blur & Focus",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float dirBlurAmount;        // 0-1 normalized blur length\n  uniform float dirBlurAngle;         // 0-360 degrees\n  uniform float dirBlurSamples;       // 4-32\n  uniform float dirBlurFalloff;       // 0-1 weight falloff toward edges\n  uniform float dirBlurCenterBias;    // 0-1 keep center sharper\n  uniform float dirBlurMix;           // 0-1 wet/dry\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (dirBlurAmount < 0.001) { gl_FragColor = src; return; }\n\n    int samples = int(clamp(dirBlurSamples, 2.0, 32.0));\n    float ang = radians(dirBlurAngle);\n    vec2 dir = vec2(cos(ang), sin(ang));\n    vec2 texel = 1.0 / uResolution;\n    float maxOffset = dirBlurAmount * 0.3; // 30% of screen max\n\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n    for (int i = -32; i <= 32; i++) {\n      if (abs(i) > samples) continue;\n      float t = float(i) / float(samples);\n      vec2 off = dir * t * maxOffset;\n      // Falloff weight (1 at center, drops toward edges)\n      float w = mix(1.0, 1.0 - abs(t), dirBlurFalloff);\n      // Center bias: weight center heavier\n      w *= mix(1.0, exp(-t * t * 8.0), dirBlurCenterBias);\n      acc += texture2D(uInput, vUv + off).rgb * w;\n      wsum += w;\n    }\n    vec3 blurred = acc / wsum;\n    gl_FragColor = vec4(mix(src.rgb, blurred, dirBlurMix), src.a);\n  }\n",
    "defaults": {
      "dirBlurAmount": 0.25,
      "dirBlurAngle": 0,
      "dirBlurSamples": 16,
      "dirBlurFalloff": 0.3,
      "dirBlurCenterBias": 0,
      "dirBlurMix": 1
    },
    "controls": [
      {
        "name": "Blur Amount",
        "param": "dirBlurAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.25
      },
      {
        "name": "Angle",
        "param": "dirBlurAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Samples",
        "param": "dirBlurSamples",
        "min": 4,
        "max": 32,
        "step": 2,
        "default": 16
      },
      {
        "name": "Falloff",
        "param": "dirBlurFalloff",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Center Bias",
        "param": "dirBlurCenterBias",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "dirBlurMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "zoomBlur",
    "label": "Zoom Blur",
    "category": "Blur & Focus",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float zoomBlurAmount;        // 0-1 normalized blur length\n  uniform float zoomBlurCenterX;       // 0-1\n  uniform float zoomBlurCenterY;       // 0-1\n  uniform float zoomBlurSamples;       // 4-32\n  uniform float zoomBlurFalloff;       // 0-1 weight falloff\n  uniform float zoomBlurChromatic;     // 0-1 RGB split during zoom\n  uniform float zoomBlurMix;           // 0-1 wet/dry\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (zoomBlurAmount < 0.001) { gl_FragColor = src; return; }\n\n    int samples = int(clamp(zoomBlurSamples, 2.0, 32.0));\n    vec2 center = vec2(zoomBlurCenterX, zoomBlurCenterY);\n    vec2 dir = vUv - center;\n\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n    for (int i = 0; i <= 32; i++) {\n      if (i > samples) break;\n      float t = float(i) / float(samples);\n      vec2 sUv;\n      vec3 c;\n      if (zoomBlurChromatic > 0.001) {\n        // Channel-shift along zoom direction\n        float rT = t * (1.0 + zoomBlurChromatic * 0.05);\n        float gT = t;\n        float bT = t * (1.0 - zoomBlurChromatic * 0.05);\n        float rR = texture2D(uInput, vUv - dir * zoomBlurAmount * rT).r;\n        float gG = texture2D(uInput, vUv - dir * zoomBlurAmount * gT).g;\n        float bB = texture2D(uInput, vUv - dir * zoomBlurAmount * bT).b;\n        c = vec3(rR, gG, bB);\n      } else {\n        sUv = vUv - dir * zoomBlurAmount * t;\n        c = texture2D(uInput, sUv).rgb;\n      }\n      float w = mix(1.0, 1.0 - t, zoomBlurFalloff);\n      acc += c * w;\n      wsum += w;\n    }\n    vec3 blurred = acc / wsum;\n    gl_FragColor = vec4(mix(src.rgb, blurred, zoomBlurMix), src.a);\n  }\n",
    "defaults": {
      "zoomBlurAmount": 0.25,
      "zoomBlurCenterX": 0.5,
      "zoomBlurCenterY": 0.5,
      "zoomBlurSamples": 16,
      "zoomBlurFalloff": 0.3,
      "zoomBlurChromatic": 0,
      "zoomBlurMix": 1
    },
    "controls": [
      {
        "name": "Blur Amount",
        "param": "zoomBlurAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.25
      },
      {
        "name": "Center X",
        "param": "zoomBlurCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "zoomBlurCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Samples",
        "param": "zoomBlurSamples",
        "min": 4,
        "max": 32,
        "step": 2,
        "default": 16
      },
      {
        "name": "Falloff",
        "param": "zoomBlurFalloff",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Chromatic Split",
        "param": "zoomBlurChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "zoomBlurMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "radialBlur",
    "label": "Radial Blur",
    "category": "Blur & Focus",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float radialBlurAmount;        // 0-1 spin angle (radians scale)\n  uniform float radialBlurCenterX;       // 0-1\n  uniform float radialBlurCenterY;       // 0-1\n  uniform float radialBlurSamples;       // 4-32\n  uniform float radialBlurFalloff;       // 0-1\n  uniform float radialBlurRadiusInner;   // 0-1 unblurred inner radius\n  uniform float radialBlurRadiusOuter;   // 0-1 fully blurred outer radius\n  uniform float radialBlurMix;           // 0-1 wet/dry\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (radialBlurAmount < 0.001) { gl_FragColor = src; return; }\n\n    int samples = int(clamp(radialBlurSamples, 2.0, 32.0));\n    vec2 center = vec2(radialBlurCenterX, radialBlurCenterY);\n    vec2 d = vUv - center;\n    float dist = length(d);\n\n    // Mask: 0 inside inner radius, 1 outside outer radius\n    float mask = smoothstep(radialBlurRadiusInner, radialBlurRadiusOuter, dist);\n    if (mask < 0.001) { gl_FragColor = src; return; }\n\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n    float maxAngle = radialBlurAmount * 1.2; // ~70° max spin\n    for (int i = -32; i <= 32; i++) {\n      if (abs(i) > samples) continue;\n      float t = float(i) / float(samples);\n      float a = t * maxAngle * mask;\n      float ca = cos(a), sa = sin(a);\n      vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);\n      vec2 sUv = center + rd;\n      float w = mix(1.0, 1.0 - abs(t), radialBlurFalloff);\n      acc += texture2D(uInput, sUv).rgb * w;\n      wsum += w;\n    }\n    vec3 blurred = acc / wsum;\n    gl_FragColor = vec4(mix(src.rgb, blurred, radialBlurMix * mask), src.a);\n  }\n",
    "defaults": {
      "radialBlurAmount": 0.25,
      "radialBlurCenterX": 0.5,
      "radialBlurCenterY": 0.5,
      "radialBlurSamples": 16,
      "radialBlurFalloff": 0.3,
      "radialBlurRadiusInner": 0,
      "radialBlurRadiusOuter": 0.7,
      "radialBlurMix": 1
    },
    "controls": [
      {
        "name": "Spin Amount",
        "param": "radialBlurAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.25
      },
      {
        "name": "Center X",
        "param": "radialBlurCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "radialBlurCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Samples",
        "param": "radialBlurSamples",
        "min": 4,
        "max": 32,
        "step": 2,
        "default": 16
      },
      {
        "name": "Falloff",
        "param": "radialBlurFalloff",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Inner Radius",
        "param": "radialBlurRadiusInner",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Outer Radius",
        "param": "radialBlurRadiusOuter",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Mix",
        "param": "radialBlurMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "toon",
    "label": "Toon",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float toonSteps;         // 2-8 quantization steps per channel\n  uniform float toonOutline;       // 0-1 outline strength\n  uniform float uOutlineColor;  // 0=black, 1=color from source\n  uniform float toonShadowBand;    // 0-1 darken shadow band intensity\n  uniform float toonRampSoftness;  // 0-1 smooth ramp (0=hard cel, 1=soft)\n  uniform float toonColorPop;      // 0-1 saturation boost\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec3 quantize(vec3 c, float steps, float soft) {\n    vec3 hard = floor(c * steps) / max(steps - 1.0, 1.0);\n    if (soft < 0.001) return hard;\n    // Soft ramp: blend between hard and continuous via smoothstep on each\n    // channel toward the next step.\n    vec3 frac = fract(c * steps);\n    vec3 smoothBlend = smoothstep(0.4, 0.6, frac);\n    return mix(hard, hard + smoothBlend / max(steps - 1.0, 1.0), soft);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb;\n\n    // Color pop pre-process — bumps saturation slightly.\n    if (toonColorPop > 0.001) {\n      float lum = dot(src, vec3(0.299, 0.587, 0.114));\n      src = mix(vec3(lum), src, 1.0 + toonColorPop * 0.6);\n    }\n\n    vec3 quant = quantize(clamp(src, 0.0, 1.0), toonSteps, toonRampSoftness);\n\n    // Shadow band — darken the lowest quantization step further.\n    if (toonShadowBand > 0.001) {\n      float lum = dot(quant, vec3(0.299, 0.587, 0.114));\n      float shadow = smoothstep(0.35, 0.0, lum);\n      quant *= 1.0 - shadow * toonShadowBand * 0.5;\n    }\n\n    // Built-in outline — Sobel-ish luma gradient.\n    if (toonOutline > 0.001) {\n      vec2 t = 1.5 / uResolution;\n      float lL = dot(texture2D(uInput, vUv - vec2(t.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));\n      float lR = dot(texture2D(uInput, vUv + vec2(t.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));\n      float lD = dot(texture2D(uInput, vUv - vec2(0.0, t.y)).rgb, vec3(0.299, 0.587, 0.114));\n      float lU = dot(texture2D(uInput, vUv + vec2(0.0, t.y)).rgb, vec3(0.299, 0.587, 0.114));\n      float edge = clamp(length(vec2(lR - lL, lU - lD)) * 6.0, 0.0, 1.0);\n      vec3 lineCol = mix(vec3(0.0), src * 0.4, uOutlineColor);\n      quant = mix(quant, lineCol, edge * toonOutline);\n    }\n\n    gl_FragColor = vec4(quant, texColor.a);\n  }\n",
    "defaults": {
      "toonSteps": 4,
      "toonOutline": 0.6,
      "uOutlineColor": 0,
      "toonShadowBand": 0.3,
      "toonRampSoftness": 0,
      "toonColorPop": 0.3
    },
    "controls": [
      {
        "name": "Quantize Steps",
        "param": "toonSteps",
        "min": 2,
        "max": 12,
        "step": 1,
        "default": 4
      },
      {
        "name": "Outline",
        "param": "toonOutline",
        "min": 0,
        "max": 2,
        "step": 0.05,
        "default": 0.6
      },
      {
        "name": "Shadow Band",
        "param": "toonShadowBand",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Ramp Softness",
        "param": "toonRampSoftness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Color Pop",
        "param": "toonColorPop",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      }
    ],
    "integerParams": []
  },
  {
    "type": "kuwahara",
    "label": "Kuwahara",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float kuwaharaRadius;        // 1-8 pixel radius of each quadrant\n  uniform float kuwaharaEdgeSharpness; // 0-1 extra contrast on the chosen quadrant\n  uniform float kuwaharaColorPunch;    // 0-1 saturation boost on output\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec2 t = 1.0 / uResolution;\n    float r = max(kuwaharaRadius, 1.0);\n\n    // 4-quadrant Kuwahara (cheap variant; 9-quadrant is too costly per\n    // pixel for live preview). Sample mean + variance in each of TL/TR/BL/BR\n    // quadrants, then pick the one with the lowest variance.\n    vec3 means[4];\n    float vars[4];\n    for (int q = 0; q < 4; q++) {\n      vec2 dir = vec2((q == 0 || q == 2) ? -1.0 : 1.0,\n                       (q < 2) ? 1.0 : -1.0);\n      vec3 sum = vec3(0.0);\n      vec3 sumSq = vec3(0.0);\n      float n = 0.0;\n      // Sample a 3x3 stencil scaled by radius in the quadrant direction.\n      for (int i = 0; i <= 2; i++) {\n        for (int j = 0; j <= 2; j++) {\n          vec2 off = (vec2(float(i), float(j))) * dir * r * t;\n          vec3 c = texture2D(uInput, vUv + off).rgb;\n          sum += c;\n          sumSq += c * c;\n          n += 1.0;\n        }\n      }\n      vec3 m = sum / n;\n      vec3 v = sumSq / n - m * m;\n      means[q] = m;\n      vars[q] = v.r + v.g + v.b;\n    }\n\n    // Pick lowest-variance quadrant.\n    int bestQ = 0;\n    float bestV = vars[0];\n    if (vars[1] < bestV) { bestV = vars[1]; bestQ = 1; }\n    if (vars[2] < bestV) { bestV = vars[2]; bestQ = 2; }\n    if (vars[3] < bestV) { bestV = vars[3]; bestQ = 3; }\n    vec3 result = (bestQ==0?means[0]:bestQ==1?means[1]:bestQ==2?means[2]:means[3]);\n\n    // Edge sharpness — push toward the chosen mean by overshooting.\n    if (kuwaharaEdgeSharpness > 0.001) {\n      vec3 center = texture2D(uInput, vUv).rgb;\n      result = mix(result, result + (result - center) * 0.5, kuwaharaEdgeSharpness);\n    }\n\n    // Color punch — saturation boost on output.\n    if (kuwaharaColorPunch > 0.001) {\n      float lum = dot(result, vec3(0.299, 0.587, 0.114));\n      result = mix(vec3(lum), result, 1.0 + kuwaharaColorPunch);\n    }\n\n    vec4 texColor = texture2D(uInput, vUv);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), texColor.a);\n  }\n",
    "defaults": {
      "kuwaharaRadius": 3,
      "kuwaharaEdgeSharpness": 0.3,
      "kuwaharaColorPunch": 0.2
    },
    "controls": [
      {
        "name": "Radius",
        "param": "kuwaharaRadius",
        "min": 1,
        "max": 8,
        "step": 1,
        "default": 3
      },
      {
        "name": "Edge Sharpness",
        "param": "kuwaharaEdgeSharpness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Color Punch",
        "param": "kuwaharaColorPunch",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      }
    ],
    "integerParams": []
  },
  {
    "type": "watercolor",
    "label": "Watercolor",
    "category": "Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float watercolorBleed;         // 0-1 pigment bleed radius\n  uniform float watercolorEdgeDarken;    // 0-1 sobel-driven edge darkening\n  uniform float watercolorPaperTexture;  // 0-1 paper noise strength\n  uniform float watercolorPaperScale;    // 1-32 paper noise scale\n  uniform float watercolorWetness;       // 0-1 colour saturation boost (wet pigment)\n  uniform float watercolorGranulation;   // 0-1 pigment granulation noise\n  uniform float watercolorPaperHue;      // 0=cream, 1=cool grey, 2=tea-stain\n  uniform vec2 uResolution;\n  uniform float uTime;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  vec3 paperColor(float kind) {\n    if (kind < 0.5) return vec3(0.96, 0.93, 0.86); // cream\n    if (kind < 1.5) return vec3(0.88, 0.90, 0.93); // cool grey\n    return vec3(0.82, 0.72, 0.55); // tea\n  }\n\n  void main() {\n    vec2 texel = 1.0 / uResolution;\n\n    // ── Pigment bleed: 9-tap blur with radius scaled by watercolorBleed ──\n    float r = watercolorBleed * 6.0 + 1.0;\n    vec3 sum = vec3(0.0);\n    float weight = 0.0;\n    for (int y = -2; y <= 2; y++) {\n      for (int x = -2; x <= 2; x++) {\n        vec2 off = vec2(float(x), float(y)) * texel * r;\n        float w = exp(-dot(off, off) * 100.0);\n        sum += texture2D(uInput, vUv + off).rgb * w;\n        weight += w;\n      }\n    }\n    vec3 bled = sum / weight;\n\n    // ── Edge darken (sobel on luma) ──\n    float l00 = luma(texture2D(uInput, vUv + texel * vec2(-1.0, -1.0)).rgb);\n    float l10 = luma(texture2D(uInput, vUv + texel * vec2( 0.0, -1.0)).rgb);\n    float l20 = luma(texture2D(uInput, vUv + texel * vec2( 1.0, -1.0)).rgb);\n    float l01 = luma(texture2D(uInput, vUv + texel * vec2(-1.0,  0.0)).rgb);\n    float l21 = luma(texture2D(uInput, vUv + texel * vec2( 1.0,  0.0)).rgb);\n    float l02 = luma(texture2D(uInput, vUv + texel * vec2(-1.0,  1.0)).rgb);\n    float l12 = luma(texture2D(uInput, vUv + texel * vec2( 0.0,  1.0)).rgb);\n    float l22 = luma(texture2D(uInput, vUv + texel * vec2( 1.0,  1.0)).rgb);\n    float gxL = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);\n    float gyL = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);\n    float edge = clamp(length(vec2(gxL, gyL)), 0.0, 1.0);\n    bled = mix(bled, bled * (1.0 - edge), watercolorEdgeDarken);\n\n    // ── Wetness (saturation boost) ──\n    if (watercolorWetness > 0.001) {\n      float lum = luma(bled);\n      bled = mix(vec3(lum), bled, 1.0 + watercolorWetness * 0.5);\n    }\n\n    // ── Pigment granulation ──\n    if (watercolorGranulation > 0.001) {\n      float gran = vnoise(vUv * uResolution * 0.6 + uTime * 0.05) - 0.5;\n      bled += vec3(gran) * watercolorGranulation * 0.15;\n    }\n\n    // ── Paper texture composite ──\n    float paperN = vnoise(vUv * watercolorPaperScale * 16.0) * 0.5 + vnoise(vUv * watercolorPaperScale * 32.0) * 0.5;\n    vec3 paper = paperColor(watercolorPaperHue) * (0.85 + paperN * 0.3);\n    vec3 result = bled * mix(vec3(1.0), paper, watercolorPaperTexture);\n\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);\n  }\n",
    "defaults": {
      "watercolorBleed": 0.5,
      "watercolorEdgeDarken": 0.5,
      "watercolorPaperTexture": 0.4,
      "watercolorPaperScale": 8,
      "watercolorWetness": 0.3,
      "watercolorGranulation": 0.2,
      "watercolorPaperHue": 0
    },
    "controls": [
      {
        "name": "Pigment Bleed",
        "param": "watercolorBleed",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Edge Darken",
        "param": "watercolorEdgeDarken",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Paper Texture",
        "param": "watercolorPaperTexture",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Paper Scale",
        "param": "watercolorPaperScale",
        "min": 1,
        "max": 32,
        "step": 0.5,
        "default": 8
      },
      {
        "name": "Wetness",
        "param": "watercolorWetness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Granulation",
        "param": "watercolorGranulation",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Paper Tone",
        "param": "watercolorPaperHue",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Cream"
          },
          {
            "value": 1,
            "label": "Cool Grey"
          },
          {
            "value": 2,
            "label": "Tea Stain"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "crt",
    "label": "CRT",
    "category": "Generate & Texture",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float crtScanlines;     // 0-1 scanline strength\n  uniform float crtScanCount;     // 100-1200 scanline count\n  uniform float crtMask;          // 0-1 phosphor mask strength\n  uniform float crtMaskType;      // 0=Trinitron stripe, 1=Aperture grille, 2=Shadow mask\n  uniform float crtCurvature;     // 0-1 barrel curvature\n  uniform float crtVignette;      // 0-1 corner darken\n  uniform float crtGlow;          // 0-1 phosphor glow bleed\n  uniform float crtRollingBar;    // 0-1 vertical roll\n  uniform float crtChromatic;     // 0-1 lens fringing\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec2 curveUv(vec2 uv, float k) {\n    uv = uv * 2.0 - 1.0;\n    vec2 offset = abs(uv.yx) / vec2(6.0, 4.0);\n    uv = uv + uv * offset * offset * k;\n    return uv * 0.5 + 0.5;\n  }\n\n  void main() {\n    vec2 uv = crtCurvature > 0.001 ? curveUv(vUv, crtCurvature) : vUv;\n    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {\n      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\n      return;\n    }\n\n    // Chromatic aberration on RGB channels\n    vec3 col;\n    if (crtChromatic > 0.001) {\n      vec2 cd = (uv - 0.5) * crtChromatic * 0.01;\n      col.r = texture2D(uInput, uv + cd).r;\n      col.g = texture2D(uInput, uv).g;\n      col.b = texture2D(uInput, uv - cd).b;\n    } else {\n      col = texture2D(uInput, uv).rgb;\n    }\n\n    // Phosphor mask\n    if (crtMask > 0.001) {\n      int mtype = int(crtMaskType + 0.5);\n      vec2 px = uv * uResolution;\n      vec3 maskCol = vec3(1.0);\n      if (mtype == 0) {\n        // Trinitron vertical stripes (3-pixel R/G/B repeat)\n        float stripe = mod(px.x, 3.0);\n        if (stripe < 1.0) maskCol = vec3(1.4, 0.6, 0.6);\n        else if (stripe < 2.0) maskCol = vec3(0.6, 1.4, 0.6);\n        else maskCol = vec3(0.6, 0.6, 1.4);\n      } else if (mtype == 1) {\n        // Aperture grille (vertical stripes + horizontal damping wires)\n        float stripe = mod(px.x, 3.0);\n        if (stripe < 1.0) maskCol = vec3(1.5, 0.5, 0.5);\n        else if (stripe < 2.0) maskCol = vec3(0.5, 1.5, 0.5);\n        else maskCol = vec3(0.5, 0.5, 1.5);\n        float wire = step(0.95, mod(px.y * 0.005, 1.0));\n        maskCol *= 1.0 - wire * 0.3;\n      } else {\n        // Shadow mask (RGB triads on diamond)\n        float u3 = mod(px.x, 6.0);\n        float v3 = mod(px.y, 2.0);\n        if (v3 < 1.0) {\n          if (u3 < 2.0) maskCol = vec3(1.5, 0.5, 0.5);\n          else if (u3 < 4.0) maskCol = vec3(0.5, 1.5, 0.5);\n          else maskCol = vec3(0.5, 0.5, 1.5);\n        } else {\n          if (u3 < 1.0 || u3 >= 5.0) maskCol = vec3(0.5, 0.5, 1.5);\n          else if (u3 < 3.0) maskCol = vec3(1.5, 0.5, 0.5);\n          else maskCol = vec3(0.5, 1.5, 0.5);\n        }\n      }\n      col = mix(col, col * maskCol, crtMask);\n    }\n\n    // Scanlines\n    if (crtScanlines > 0.001) {\n      float sl = sin(uv.y * crtScanCount * 3.14159) * 0.5 + 0.5;\n      col *= mix(1.0, sl, crtScanlines);\n    }\n\n    // Glow (sample surrounding pixels weighted)\n    if (crtGlow > 0.001) {\n      vec2 texel = 1.0 / uResolution;\n      vec3 g = texture2D(uInput, uv + vec2( texel.x,  0.0)).rgb\n             + texture2D(uInput, uv + vec2(-texel.x,  0.0)).rgb\n             + texture2D(uInput, uv + vec2( 0.0,  texel.y)).rgb\n             + texture2D(uInput, uv + vec2( 0.0, -texel.y)).rgb;\n      col += g * crtGlow * 0.05;\n    }\n\n    // Rolling sync bar\n    if (crtRollingBar > 0.001) {\n      float bar = sin(uv.y * 6.0 - uTime * 1.5);\n      bar = smoothstep(0.7, 1.0, bar);\n      col += bar * crtRollingBar * 0.15;\n    }\n\n    // Vignette\n    if (crtVignette > 0.001) {\n      vec2 vc = uv - 0.5;\n      float v = 1.0 - dot(vc, vc) * crtVignette * 1.4;\n      col *= clamp(v, 0.0, 1.0);\n    }\n\n    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "crtScanlines": 0.5,
      "crtScanCount": 480,
      "crtMask": 0.5,
      "crtMaskType": 0,
      "crtCurvature": 0.3,
      "crtVignette": 0.4,
      "crtGlow": 0.5,
      "crtRollingBar": 0,
      "crtChromatic": 0.3
    },
    "controls": [
      {
        "name": "Scanlines",
        "param": "crtScanlines",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Scan Count",
        "param": "crtScanCount",
        "min": 100,
        "max": 1200,
        "step": 10,
        "default": 480
      },
      {
        "name": "Phosphor Mask",
        "param": "crtMask",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Mask",
        "param": "crtMaskType",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Trinitron Stripe"
          },
          {
            "value": 1,
            "label": "Aperture Grille"
          },
          {
            "value": 2,
            "label": "Shadow Mask"
          }
        ]
      },
      {
        "name": "Curvature",
        "param": "crtCurvature",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Vignette",
        "param": "crtVignette",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Phosphor Glow",
        "param": "crtGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Rolling Bar",
        "param": "crtRollingBar",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Lens Fringe",
        "param": "crtChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      }
    ],
    "integerParams": []
  },
  {
    "type": "compressionArtifacts",
    "label": "Compression Artifacts",
    "category": "Advanced Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float compArtBlockSize;     // 4-32\n  uniform float compArtQuality;       // 0-1 (low=more artifacts)\n  uniform float compArtChromaSubsample; // 0-1\n  uniform float compArtBlockNoise;    // 0-1 random per-block jitter\n  uniform float compArtMode;          // 0=DCT-style block, 1=hard 8x8, 2=color banding\n  uniform float compArtMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  vec3 rgb2ycbcr(vec3 c) {\n    return vec3(\n       0.299 * c.r + 0.587 * c.g + 0.114 * c.b,\n      -0.169 * c.r - 0.331 * c.g + 0.5   * c.b + 0.5,\n       0.5   * c.r - 0.419 * c.g - 0.081 * c.b + 0.5\n    );\n  }\n  vec3 ycbcr2rgb(vec3 c) {\n    float y = c.x; float cb = c.y - 0.5; float cr = c.z - 0.5;\n    return vec3(y + 1.402 * cr, y - 0.344 * cb - 0.714 * cr, y + 1.772 * cb);\n  }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (compArtMix < 0.001) { gl_FragColor = src; return; }\n\n    int mode = int(compArtMode + 0.5);\n    float bs = max(2.0, compArtBlockSize);\n    vec2 px = vUv * uResolution;\n\n    // Find block center\n    vec2 blockId = floor(px / bs);\n    vec2 blockCenter = (blockId + 0.5) * bs / uResolution;\n\n    // Sample block average (proxy for low-frequency component)\n    vec3 avg = vec3(0.0);\n    int s = 0;\n    for (int y = 0; y < 4; y++) {\n      for (int x = 0; x < 4; x++) {\n        vec2 sp = (blockId * bs + vec2(float(x), float(y)) * bs * 0.25) / uResolution;\n        avg += texture2D(uInput, sp).rgb;\n        s++;\n      }\n    }\n    avg /= float(s);\n\n    vec3 result;\n    if (mode == 0 || mode == 1) {\n      // Quantize per block\n      float qStep = mix(0.01, 0.2, 1.0 - compArtQuality);\n      vec3 quant = floor(src.rgb / qStep) * qStep;\n      // Mix block average with quantized\n      float blockBias = (mode == 1) ? 0.65 : 0.45;\n      result = mix(quant, avg, blockBias * (1.0 - compArtQuality));\n\n      // Block-noise jitter\n      if (compArtBlockNoise > 0.001) {\n        float bn = (hash21(blockId) - 0.5) * compArtBlockNoise * 0.15;\n        result += vec3(bn);\n      }\n    } else {\n      // Color banding (luma-preserving bit reduction in chroma)\n      vec3 ycc = rgb2ycbcr(src.rgb);\n      float yStep = mix(0.005, 0.05, 1.0 - compArtQuality);\n      ycc.x = floor(ycc.x / yStep) * yStep;\n      float cStep = mix(0.02, 0.2, 1.0 - compArtQuality);\n      ycc.yz = floor(ycc.yz / cStep) * cStep;\n      result = ycbcr2rgb(ycc);\n    }\n\n    // Chroma subsample\n    if (compArtChromaSubsample > 0.001) {\n      vec3 subYcc = rgb2ycbcr(avg);\n      vec3 hereYcc = rgb2ycbcr(result);\n      hereYcc.yz = mix(hereYcc.yz, subYcc.yz, compArtChromaSubsample);\n      result = ycbcr2rgb(hereYcc);\n    }\n\n    gl_FragColor = vec4(mix(src.rgb, clamp(result, 0.0, 1.0), compArtMix), src.a);\n  }\n",
    "defaults": {
      "compArtBlockSize": 8,
      "compArtQuality": 0.4,
      "compArtChromaSubsample": 0.6,
      "compArtBlockNoise": 0.2,
      "compArtMode": 0,
      "compArtMix": 1
    },
    "controls": [
      {
        "name": "Block Size",
        "param": "compArtBlockSize",
        "min": 4,
        "max": 32,
        "step": 1,
        "default": 8
      },
      {
        "name": "Quality",
        "param": "compArtQuality",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Chroma Subsample",
        "param": "compArtChromaSubsample",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Block Noise",
        "param": "compArtBlockNoise",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Mode",
        "param": "compArtMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "DCT Block"
          },
          {
            "value": 1,
            "label": "Hard 8x8"
          },
          {
            "value": 2,
            "label": "Color Banding"
          }
        ]
      },
      {
        "name": "Mix",
        "param": "compArtMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "chromaKey",
    "label": "Chroma Key",
    "category": "Keying",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float chromaKeyR;          // 0-1 key colour (default green)\n  uniform float chromaKeyG;\n  uniform float chromaKeyB;\n  uniform float chromaKeyTolerance;     // 0-1 hue band width\n  uniform float chromaKeySoftness;      // 0-1 edge feather\n  uniform float chromaKeySpill; // 0-1 reduce key colour on subject\n  uniform float chromaKeyMatte;         // 0=show matte (1-bit), 0=keyed result\n  uniform float chromaKeyMode;          // 0=hue distance, 1=YCbCr, 2=RGB distance\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec3 rgb2ycbcr(vec3 c) {\n    float y  =  0.299 * c.r + 0.587 * c.g + 0.114 * c.b;\n    float cb = -0.169 * c.r - 0.331 * c.g + 0.5   * c.b;\n    float cr =  0.5   * c.r - 0.419 * c.g - 0.081 * c.b;\n    return vec3(y, cb, cr);\n  }\n\n  vec3 rgb2hsv(vec3 c) {\n    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);\n    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n    float d = q.x - min(q.w, q.y);\n    float e = 1.0e-10;\n    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);\n  }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec3 key = vec3(chromaKeyR, chromaKeyG, chromaKeyB);\n    int mode = int(chromaKeyMode + 0.5);\n\n    float dist;\n    if (mode == 0) {\n      // Hue distance\n      vec3 hsvSrc = rgb2hsv(src);\n      vec3 hsvKey = rgb2hsv(key);\n      float hd = abs(hsvSrc.x - hsvKey.x);\n      hd = min(hd, 1.0 - hd);\n      dist = hd * 2.0 + (1.0 - hsvSrc.y) * 0.3;\n    } else if (mode == 1) {\n      // YCbCr (chroma plane)\n      vec3 yc = rgb2ycbcr(src);\n      vec3 yk = rgb2ycbcr(key);\n      dist = length(yc.yz - yk.yz) * 2.0;\n    } else {\n      // RGB distance\n      dist = length(src - key);\n    }\n\n    float matte = smoothstep(chromaKeyTolerance, chromaKeyTolerance + chromaKeySoftness + 0.001, dist);\n\n    // Spill suppression\n    vec3 result = src;\n    if (chromaKeySpill > 0.001) {\n      float keyMax = max(max(key.r, key.g), key.b);\n      // Reduce dominant key channel\n      if (key.g >= max(key.r, key.b)) {\n        result.g = min(result.g, mix(result.g, (result.r + result.b) * 0.5, chromaKeySpill * (1.0 - matte)));\n      } else if (key.r >= max(key.g, key.b)) {\n        result.r = min(result.r, mix(result.r, (result.g + result.b) * 0.5, chromaKeySpill * (1.0 - matte)));\n      } else {\n        result.b = min(result.b, mix(result.b, (result.r + result.g) * 0.5, chromaKeySpill * (1.0 - matte)));\n      }\n    }\n\n    if (chromaKeyMatte > 0.5) {\n      gl_FragColor = vec4(vec3(matte), 1.0);\n    } else {\n      gl_FragColor = vec4(result, matte);\n    }\n  }\n",
    "defaults": {
      "chromaKeyR": 0,
      "chromaKeyG": 1,
      "chromaKeyB": 0,
      "chromaKeyTolerance": 0.25,
      "chromaKeySoftness": 0.15,
      "chromaKeySpill": 0.6,
      "chromaKeyMatte": 0,
      "chromaKeyMode": 1
    },
    "controls": [
      {
        "name": "Key R",
        "param": "chromaKeyR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Key G",
        "param": "chromaKeyG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Key B",
        "param": "chromaKeyB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tolerance",
        "param": "chromaKeyTolerance",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.25
      },
      {
        "name": "Edge Softness",
        "param": "chromaKeySoftness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.15
      },
      {
        "name": "Spill Suppression",
        "param": "chromaKeySpill",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Show Matte",
        "param": "chromaKeyMatte",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Algorithm",
        "param": "chromaKeyMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Hue Distance"
          },
          {
            "value": 1,
            "label": "YCbCr (chroma plane)"
          },
          {
            "value": 2,
            "label": "RGB Distance"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "lumaKey",
    "label": "Luma Key",
    "category": "Keying",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float lumaKeyLowCut;        // 0-1 fade-in start\n  uniform float lumaKeyHighCut;       // 0-1 fade-in end\n  uniform float lumaKeyInvert;        // 0=keep bright, 1=keep dark\n  uniform float lumaKeyGamma;         // 0.2-3 matte gamma\n  uniform float lumaKeyMatte;         // 0=normal, 1=show matte\n  uniform float lumaKeyPremultiply;   // 0=straight alpha, 1=premultiplied\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    float l = luma(src);\n    float matte = smoothstep(lumaKeyLowCut, max(lumaKeyLowCut + 0.001, lumaKeyHighCut), l);\n    if (lumaKeyInvert > 0.5) matte = 1.0 - matte;\n    matte = pow(clamp(matte, 0.0, 1.0), max(0.001, lumaKeyGamma));\n\n    if (lumaKeyMatte > 0.5) {\n      gl_FragColor = vec4(vec3(matte), 1.0);\n    } else {\n      vec3 result = (lumaKeyPremultiply > 0.5) ? src * matte : src;\n      gl_FragColor = vec4(result, matte);\n    }\n  }\n",
    "defaults": {
      "lumaKeyLowCut": 0.4,
      "lumaKeyHighCut": 0.6,
      "lumaKeyInvert": 0,
      "lumaKeyGamma": 1,
      "lumaKeyMatte": 0,
      "lumaKeyPremultiply": 0
    },
    "controls": [
      {
        "name": "Low Cut",
        "param": "lumaKeyLowCut",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "High Cut",
        "param": "lumaKeyHighCut",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Invert",
        "param": "lumaKeyInvert",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Matte Gamma",
        "param": "lumaKeyGamma",
        "min": 0.2,
        "max": 3,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Show Matte",
        "param": "lumaKeyMatte",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Premultiply",
        "param": "lumaKeyPremultiply",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "differenceKey",
    "label": "Difference Key",
    "category": "Keying",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float diffKeyR;          // 0-1 reference colour\n  uniform float diffKeyG;\n  uniform float diffKeyB;\n  uniform float diffKeyTolerance;     // 0-1\n  uniform float diffKeySoftness;      // 0-1\n  uniform float diffKeyInvert;        // 0=key matches, 1=key non-matches\n  uniform float diffKeyMatte;         // 0=normal, 1=show matte\n  uniform float diffKeyMode;          // 0=Euclidean, 1=Manhattan, 2=Max channel\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec3 ref = vec3(diffKeyR, diffKeyG, diffKeyB);\n    vec3 diff = abs(src - ref);\n\n    int mode = int(diffKeyMode + 0.5);\n    float d;\n    if (mode == 0) d = length(diff);\n    else if (mode == 1) d = (diff.r + diff.g + diff.b);\n    else d = max(max(diff.r, diff.g), diff.b);\n\n    float matte = smoothstep(diffKeyTolerance, diffKeyTolerance + diffKeySoftness + 0.001, d);\n    if (diffKeyInvert > 0.5) matte = 1.0 - matte;\n\n    if (diffKeyMatte > 0.5) {\n      gl_FragColor = vec4(vec3(matte), 1.0);\n    } else {\n      gl_FragColor = vec4(src, matte);\n    }\n  }\n",
    "defaults": {
      "diffKeyR": 0,
      "diffKeyG": 0,
      "diffKeyB": 0,
      "diffKeyTolerance": 0.3,
      "diffKeySoftness": 0.15,
      "diffKeyInvert": 0,
      "diffKeyMatte": 0,
      "diffKeyMode": 0
    },
    "controls": [
      {
        "name": "Reference R",
        "param": "diffKeyR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Reference G",
        "param": "diffKeyG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Reference B",
        "param": "diffKeyB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tolerance",
        "param": "diffKeyTolerance",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Softness",
        "param": "diffKeySoftness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.15
      },
      {
        "name": "Invert",
        "param": "diffKeyInvert",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Show Matte",
        "param": "diffKeyMatte",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Distance",
        "param": "diffKeyMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Euclidean"
          },
          {
            "value": 1,
            "label": "Manhattan"
          },
          {
            "value": 2,
            "label": "Max Channel"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "erode",
    "label": "Erode Matte",
    "category": "Keying",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float erodeRadius;        // 1-8 pixel radius\n  uniform float erodeShape;         // 0=cross, 1=square, 2=circle\n  uniform float erodeChannel;       // 0=luma, 1=red, 2=green, 3=blue, 4=alpha\n  uniform float erodeMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float channelVal(vec4 c, int ch) {\n    if (ch == 0) return dot(c.rgb, vec3(0.299, 0.587, 0.114));\n    if (ch == 1) return c.r;\n    if (ch == 2) return c.g;\n    if (ch == 3) return c.b;\n    return c.a;\n  }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (erodeRadius < 0.5) { gl_FragColor = src; return; }\n\n    int radius = int(clamp(erodeRadius, 1.0, 8.0));\n    int shape = int(erodeShape + 0.5);\n    int ch = int(erodeChannel + 0.5);\n    vec2 texel = 1.0 / uResolution;\n\n    vec4 minPx = vec4(1.0);\n    float minVal = 1.0;\n    for (int y = -8; y <= 8; y++) {\n      if (abs(y) > radius) continue;\n      for (int x = -8; x <= 8; x++) {\n        if (abs(x) > radius) continue;\n        if (shape == 0 && abs(x) + abs(y) > radius) continue;\n        if (shape == 2 && (x*x + y*y) > radius * radius) continue;\n        vec4 sCol = texture2D(uInput, vUv + vec2(float(x), float(y)) * texel);\n        float v = channelVal(sCol, ch);\n        if (v < minVal) { minVal = v; minPx = sCol; }\n      }\n    }\n\n    gl_FragColor = vec4(mix(src.rgb, minPx.rgb, erodeMix), mix(src.a, minPx.a, erodeMix));\n  }\n",
    "defaults": {
      "erodeRadius": 2,
      "erodeShape": 1,
      "erodeChannel": 0,
      "erodeMix": 1
    },
    "controls": [
      {
        "name": "Radius",
        "param": "erodeRadius",
        "min": 1,
        "max": 8,
        "step": 1,
        "default": 2
      },
      {
        "name": "Kernel",
        "param": "erodeShape",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Cross"
          },
          {
            "value": 1,
            "label": "Square"
          },
          {
            "value": 2,
            "label": "Circle"
          }
        ]
      },
      {
        "name": "Channel",
        "param": "erodeChannel",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Luma"
          },
          {
            "value": 1,
            "label": "Red"
          },
          {
            "value": 2,
            "label": "Green"
          },
          {
            "value": 3,
            "label": "Blue"
          },
          {
            "value": 4,
            "label": "Alpha"
          }
        ]
      },
      {
        "name": "Mix",
        "param": "erodeMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "dilate",
    "label": "Dilate Matte",
    "category": "Keying",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float dilateRadius;        // 1-8\n  uniform float dilateShape;         // 0=cross, 1=square, 2=circle\n  uniform float dilateChannel;       // 0=luma, 1=red, 2=green, 3=blue, 4=alpha\n  uniform float dilateMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float channelVal(vec4 c, int ch) {\n    if (ch == 0) return dot(c.rgb, vec3(0.299, 0.587, 0.114));\n    if (ch == 1) return c.r;\n    if (ch == 2) return c.g;\n    if (ch == 3) return c.b;\n    return c.a;\n  }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (dilateRadius < 0.5) { gl_FragColor = src; return; }\n\n    int radius = int(clamp(dilateRadius, 1.0, 8.0));\n    int shape = int(dilateShape + 0.5);\n    int ch = int(dilateChannel + 0.5);\n    vec2 texel = 1.0 / uResolution;\n\n    vec4 maxPx = vec4(0.0);\n    float maxVal = 0.0;\n    for (int y = -8; y <= 8; y++) {\n      if (abs(y) > radius) continue;\n      for (int x = -8; x <= 8; x++) {\n        if (abs(x) > radius) continue;\n        if (shape == 0 && abs(x) + abs(y) > radius) continue;\n        if (shape == 2 && (x*x + y*y) > radius * radius) continue;\n        vec4 sCol = texture2D(uInput, vUv + vec2(float(x), float(y)) * texel);\n        float v = channelVal(sCol, ch);\n        if (v > maxVal) { maxVal = v; maxPx = sCol; }\n      }\n    }\n\n    gl_FragColor = vec4(mix(src.rgb, maxPx.rgb, dilateMix), mix(src.a, maxPx.a, dilateMix));\n  }\n",
    "defaults": {
      "dilateRadius": 2,
      "dilateShape": 1,
      "dilateChannel": 0,
      "dilateMix": 1
    },
    "controls": [
      {
        "name": "Radius",
        "param": "dilateRadius",
        "min": 1,
        "max": 8,
        "step": 1,
        "default": 2
      },
      {
        "name": "Kernel",
        "param": "dilateShape",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Cross"
          },
          {
            "value": 1,
            "label": "Square"
          },
          {
            "value": 2,
            "label": "Circle"
          }
        ]
      },
      {
        "name": "Channel",
        "param": "dilateChannel",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Luma"
          },
          {
            "value": 1,
            "label": "Red"
          },
          {
            "value": 2,
            "label": "Green"
          },
          {
            "value": 3,
            "label": "Blue"
          },
          {
            "value": 4,
            "label": "Alpha"
          }
        ]
      },
      {
        "name": "Mix",
        "param": "dilateMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "displacement",
    "label": "Displacement",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float dispAmount;        // 0-1\n  uniform float dispScale;         // 1-32\n  uniform float dispSpeed;         // 0-3\n  uniform float dispMode;          // 0=fbm, 1=cellular, 2=sine grid, 3=ripple\n  uniform float dispTurbulence;    // 0-1\n  uniform float dispChromatic;     // 0-1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float fbm(vec2 p) {\n    float v = 0.0; float amp = 0.5;\n    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }\n    return v;\n  }\n  float cellular(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float minD = 1.0;\n    for (int y = -1; y <= 1; y++) {\n      for (int x = -1; x <= 1; x++) {\n        vec2 g = vec2(float(x), float(y));\n        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));\n        vec2 r = g + o - f;\n        minD = min(minD, dot(r, r));\n      }\n    }\n    return sqrt(minD);\n  }\n\n  vec2 dispOffset(vec2 uv, float t) {\n    int mode = int(dispMode + 0.5);\n    vec2 p = uv * dispScale + vec2(t, t * 0.7);\n    float nx, ny;\n    if (mode == 0) {\n      nx = (dispTurbulence > 0.5 ? fbm(p) : vnoise(p)) - 0.5;\n      ny = (dispTurbulence > 0.5 ? fbm(p + 71.3) : vnoise(p + 71.3)) - 0.5;\n    } else if (mode == 1) {\n      nx = cellular(p) - 0.5;\n      ny = cellular(p + 71.3) - 0.5;\n    } else if (mode == 2) {\n      nx = sin(uv.y * dispScale * 6.283 + t * 2.0);\n      ny = sin(uv.x * dispScale * 6.283 + t * 2.0);\n    } else {\n      vec2 d = uv - 0.5;\n      float r = length(d);\n      float ripple = sin(r * dispScale * 6.283 - t * 3.0);\n      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);\n      nx = dir.x * ripple;\n      ny = dir.y * ripple;\n    }\n    return vec2(nx, ny) * dispAmount * 0.05;\n  }\n\n  void main() {\n    float t = uTime * dispSpeed;\n    vec2 baseOff = dispOffset(vUv, t);\n    vec3 col;\n    if (dispChromatic > 0.001) {\n      vec2 offR = dispOffset(vUv, t + 0.3 * dispChromatic);\n      vec2 offB = dispOffset(vUv, t - 0.3 * dispChromatic);\n      col.r = texture2D(uInput, vUv + offR).r;\n      col.g = texture2D(uInput, vUv + baseOff).g;\n      col.b = texture2D(uInput, vUv + offB).b;\n    } else {\n      col = texture2D(uInput, vUv + baseOff).rgb;\n    }\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(col, src.a);\n  }\n",
    "defaults": {
      "dispAmount": 0.4,
      "dispScale": 6,
      "dispSpeed": 1,
      "dispMode": 0,
      "dispTurbulence": 0.5,
      "dispChromatic": 0
    },
    "controls": [
      {
        "name": "Displacement",
        "param": "dispAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Pattern Scale",
        "param": "dispScale",
        "min": 1,
        "max": 32,
        "step": 0.5,
        "default": 6
      },
      {
        "name": "Speed",
        "param": "dispSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Pattern",
        "param": "dispMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "fBm Noise"
          },
          {
            "value": 1,
            "label": "Cellular"
          },
          {
            "value": 2,
            "label": "Sine Grid"
          },
          {
            "value": 3,
            "label": "Ripple"
          }
        ]
      },
      {
        "name": "Turbulence",
        "param": "dispTurbulence",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Chromatic Split",
        "param": "dispChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "twirl",
    "label": "Twirl",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float twirlAngle;         // radians of full twirl at center\n  uniform float twirlRadius;        // 0.05-1 area of effect\n  uniform float twirlCenterX;       // 0-1\n  uniform float twirlCenterY;       // 0-1\n  uniform float twirlFalloff;       // 0.5-4 power curve\n  uniform float twirlAnimSpeed;     // 0-2 auto-rotation\n  uniform float twirlMix;           // 0-1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec2 center = vec2(twirlCenterX, twirlCenterY);\n    vec2 d = vUv - center;\n    d.x *= uResolution.x / uResolution.y;\n    float r = length(d);\n    float maxR = max(0.001, twirlRadius);\n    float falloff = pow(clamp(1.0 - r / maxR, 0.0, 1.0), max(0.5, twirlFalloff));\n    float a = twirlAngle * falloff + uTime * twirlAnimSpeed;\n    float ca = cos(a), sa = sin(a);\n    vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);\n    rd.x *= uResolution.y / uResolution.x;\n    vec2 sUv = clamp(center + rd, vec2(0.0), vec2(1.0));\n    vec4 warped = texture2D(uInput, sUv);\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(mix(src.rgb, warped.rgb, twirlMix), src.a);\n  }\n",
    "defaults": {
      "twirlAngle": 1.5,
      "twirlRadius": 0.5,
      "twirlCenterX": 0.5,
      "twirlCenterY": 0.5,
      "twirlFalloff": 1.5,
      "twirlAnimSpeed": 0,
      "twirlMix": 1
    },
    "controls": [
      {
        "name": "Twirl Angle",
        "param": "twirlAngle",
        "min": -6.28,
        "max": 6.28,
        "step": 0.01,
        "default": 1.5
      },
      {
        "name": "Radius",
        "param": "twirlRadius",
        "min": 0.05,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center X",
        "param": "twirlCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "twirlCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Falloff",
        "param": "twirlFalloff",
        "min": 0.5,
        "max": 4,
        "step": 0.05,
        "default": 1.5
      },
      {
        "name": "Auto-rotate",
        "param": "twirlAnimSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "twirlMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "pinchBulge",
    "label": "Pinch / Bulge",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float pinchAmount;        // -1..1 negative=pinch, positive=bulge\n  uniform float pinchRadius;        // 0.1-1\n  uniform float pinchCenterX;       // 0-1\n  uniform float pinchCenterY;       // 0-1\n  uniform float pinchFalloff;       // 0.5-4\n  uniform float pinchChromatic;     // 0-1 RGB split\n  uniform float pinchMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec2 warp(vec2 uv, float amt) {\n    vec2 c = vec2(pinchCenterX, pinchCenterY);\n    vec2 d = uv - c;\n    d.x *= uResolution.x / uResolution.y;\n    float r = length(d);\n    float maxR = max(0.001, pinchRadius);\n    float t = clamp(r / maxR, 0.0, 1.0);\n    float fade = pow(1.0 - t, max(0.5, pinchFalloff));\n    float k = 1.0 + amt * fade;\n    if (k < 0.001) k = 0.001;\n    d /= k;\n    d.x *= uResolution.y / uResolution.x;\n    return c + d;\n  }\n\n  void main() {\n    vec3 col;\n    if (pinchChromatic > 0.001) {\n      vec2 uvR = warp(vUv, pinchAmount * (1.0 + pinchChromatic * 0.05));\n      vec2 uvG = warp(vUv, pinchAmount);\n      vec2 uvB = warp(vUv, pinchAmount * (1.0 - pinchChromatic * 0.05));\n      col.r = texture2D(uInput, clamp(uvR, vec2(0.0), vec2(1.0))).r;\n      col.g = texture2D(uInput, clamp(uvG, vec2(0.0), vec2(1.0))).g;\n      col.b = texture2D(uInput, clamp(uvB, vec2(0.0), vec2(1.0))).b;\n    } else {\n      col = texture2D(uInput, clamp(warp(vUv, pinchAmount), vec2(0.0), vec2(1.0))).rgb;\n    }\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(mix(src.rgb, col, pinchMix), src.a);\n  }\n",
    "defaults": {
      "pinchAmount": 0.4,
      "pinchRadius": 0.5,
      "pinchCenterX": 0.5,
      "pinchCenterY": 0.5,
      "pinchFalloff": 1.5,
      "pinchChromatic": 0,
      "pinchMix": 1
    },
    "controls": [
      {
        "name": "Amount",
        "param": "pinchAmount",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Radius",
        "param": "pinchRadius",
        "min": 0.1,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center X",
        "param": "pinchCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "pinchCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Falloff",
        "param": "pinchFalloff",
        "min": 0.5,
        "max": 4,
        "step": 0.05,
        "default": 1.5
      },
      {
        "name": "Chromatic",
        "param": "pinchChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "pinchMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "filmicTonemap",
    "label": "Filmic Tonemap",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float tonemapCurve;       // 0=ACES, 1=Reinhard, 2=Hable, 3=Bleach Bypass, 4=Print Film, 5=Soft Clip\n  uniform float tonemapExposure;    // 0.25-4.0 — pre-tonemap gain\n  uniform float tonemapContrast;    // 0-1 — post-tonemap S-curve\n  uniform float tonemapMix;\n  varying vec2 vUv;\n\n  // ACES Narkowicz approximation.\n  vec3 aces(vec3 x) {\n    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);\n  }\n  vec3 reinhard(vec3 x) { return x / (1.0 + x); }\n  vec3 hable(vec3 x) {\n    float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30, W = 11.2;\n    vec3 n = ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;\n    float wn = ((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F;\n    return n / wn;\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 src = texColor.rgb * tonemapExposure;\n    int mode = int(tonemapCurve + 0.5);\n    vec3 mapped;\n\n    if (mode == 0)      mapped = aces(src);\n    else if (mode == 1) mapped = reinhard(src);\n    else if (mode == 2) mapped = hable(src);\n    else if (mode == 3) {\n      // Bleach Bypass — desaturated / high-contrast film look.\n      vec3 lum = vec3(dot(src, vec3(0.299, 0.587, 0.114)));\n      mapped = clamp(mix(src, lum * 1.4, 0.5), 0.0, 1.0);\n      mapped = aces(mapped);\n    }\n    else if (mode == 4) {\n      // Print Film — soft toe, gentle shoulder, slightly cooled.\n      mapped = aces(src * vec3(0.95, 0.97, 1.05));\n      mapped = pow(mapped, vec3(1.0 / 1.1));\n    }\n    else {\n      // Soft Clip — Reinhard with a sharper knee.\n      mapped = src / (1.0 + src * 0.5);\n    }\n\n    // Optional post S-curve for extra punch.\n    if (tonemapContrast > 0.001) {\n      vec3 t = smoothstep(0.0, 1.0, mapped);\n      mapped = mix(mapped, t * t * (3.0 - 2.0 * t), tonemapContrast);\n    }\n\n    gl_FragColor = vec4(mix(texColor.rgb, mapped, tonemapMix), texColor.a);\n  }\n",
    "defaults": {
      "tonemapCurve": 0,
      "tonemapExposure": 1,
      "tonemapContrast": 0,
      "tonemapMix": 1
    },
    "controls": [
      {
        "name": "Curve",
        "param": "tonemapCurve",
        "min": 0,
        "max": 5,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "ACES"
          },
          {
            "value": 1,
            "label": "Reinhard"
          },
          {
            "value": 2,
            "label": "Hable (Uncharted 2)"
          },
          {
            "value": 3,
            "label": "Bleach Bypass"
          },
          {
            "value": 4,
            "label": "Print Film"
          },
          {
            "value": 5,
            "label": "Soft Clip"
          }
        ]
      },
      {
        "name": "Pre-Exposure",
        "param": "tonemapExposure",
        "min": 0.25,
        "max": 4,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Post Contrast",
        "param": "tonemapContrast",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "tonemapMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "selectiveColor",
    "label": "Selective Color",
    "category": "Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float selColorTargetHue;    // 0-1 — hue to target (0=red, 0.33=green, 0.67=blue)\n  uniform float selColorRange;     // 0-1 — width of the hue band (0.05 = narrow, 0.3 = wide)\n  uniform float selColorFeather;      // 0-1 — soft falloff at the edge of the band\n  uniform float selColorMode;         // 0=isolate (desat outside), 1=replace (hue shift target)\n  uniform float selColorReplaceHue;   // 0-1 — destination hue for replace mode\n  uniform float selColorSatBoost;     // 0-1 — saturation boost on targeted pixels (for color pop)\n  varying vec2 vUv;\n\n  vec3 rgb2hsv(vec3 c) {\n    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);\n    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n    float d = q.x - min(q.w, q.y);\n    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);\n  }\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n\n  void main() {\n    vec4 texColor = texture2D(uInput, vUv);\n    vec3 hsv = rgb2hsv(texColor.rgb);\n\n    // Hue distance with circular wrap.\n    float d = abs(hsv.x - selColorTargetHue);\n    d = min(d, 1.0 - d);\n\n    // Smooth falloff: 1.0 inside the band, 0.0 outside, soft at edges.\n    float band = 1.0 - smoothstep(selColorRange, selColorRange + selColorFeather, d);\n\n    int mode = int(selColorMode + 0.5);\n    if (mode == 0) {\n      // Isolate — desaturate everything OUTSIDE the band.\n      hsv.y *= mix(0.0, 1.0, band);\n      // Optional sat boost on pixels INSIDE the band.\n      hsv.y = clamp(hsv.y + band * selColorSatBoost * 0.5, 0.0, 1.0);\n    } else {\n      // Replace — shift hue toward selColorReplaceHue for pixels INSIDE the band.\n      float hueDelta = selColorReplaceHue - selColorTargetHue;\n      // Take the shortest way around the hue circle.\n      if (hueDelta > 0.5) hueDelta -= 1.0;\n      if (hueDelta < -0.5) hueDelta += 1.0;\n      hsv.x = fract(hsv.x + hueDelta * band);\n      hsv.y = clamp(hsv.y + band * selColorSatBoost * 0.5, 0.0, 1.0);\n    }\n\n    gl_FragColor = vec4(hsv2rgb(hsv), texColor.a);\n  }\n",
    "defaults": {
      "selColorTargetHue": 0,
      "selColorRange": 0.1,
      "selColorFeather": 0.1,
      "selColorMode": 0,
      "selColorReplaceHue": 0.33,
      "selColorSatBoost": 0
    },
    "controls": [
      {
        "name": "Target Hue",
        "param": "selColorTargetHue",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Hue Range",
        "param": "selColorRange",
        "min": 0,
        "max": 0.5,
        "step": 0.005,
        "default": 0.1
      },
      {
        "name": "Feather",
        "param": "selColorFeather",
        "min": 0,
        "max": 0.5,
        "step": 0.005,
        "default": 0.1
      },
      {
        "name": "Mode",
        "param": "selColorMode",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Isolate (desat outside)"
          },
          {
            "value": 1,
            "label": "Replace (shift hue)"
          }
        ]
      },
      {
        "name": "Replace Hue",
        "param": "selColorReplaceHue",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.33
      },
      {
        "name": "Sat Boost (target)",
        "param": "selColorSatBoost",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "falseColor",
    "label": "False Color",
    "category": "Advanced Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float falseColorMode;          // 0=DIT exposure, 1=zone heat, 2=Resolve, 3=histogram\n  uniform float falseColorMix;           // 0-1\n  uniform float falseColorShowOriginal;  // 0-1 fade overlay vs replace\n  uniform float falseColorMidpoint;      // 0-1 reference midtone (0.5 default)\n  uniform float falseColorRange;         // 0.05-0.5 zone width\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  vec3 ditExposure(float l) {\n    if (l < 0.04) return vec3(0.5, 0, 0.7);  // Purple — clip black\n    if (l < 0.18) return vec3(0, 0, 0.9);    // Blue — shadows\n    if (l < 0.42) return vec3(0, 0.8, 0.6);  // Teal — low-mid\n    if (l < 0.55) return vec3(0.4, 0.8, 0);  // Green — midtone (safe)\n    if (l < 0.7)  return vec3(1, 1, 0);      // Yellow — high-mid\n    if (l < 0.92) return vec3(1, 0.5, 0);    // Orange — highlights\n    return vec3(1, 0, 0);                    // Red — clip white\n  }\n\n  vec3 zoneHeat(float l) {\n    // Adams zone system 0-X mapped to 7-color gradient\n    float n = l;\n    return mix(\n      mix(vec3(0,0,0.5), vec3(0,0.7,1), smoothstep(0.0, 0.4, n)),\n      mix(vec3(0,1,0), vec3(1,1,0), smoothstep(0.4, 0.7, n)),\n      smoothstep(0.4, 0.55, n)\n    ) + smoothstep(0.85, 1.0, n) * vec3(1, 0.2, 0);\n  }\n\n  vec3 resolveStyle(float l) {\n    // Two-color highlight/shadow warning (blue = underexposed, red = overexposed)\n    if (l < 0.05) return vec3(0, 0, 1);\n    if (l > 0.95) return vec3(1, 0, 0);\n    return vec3(l); // grayscale otherwise\n  }\n\n  vec3 histogramStripes(float l) {\n    // Map exposure to rainbow stripes for histogram-style preview\n    float h = l;\n    return vec3(\n      sin(h * 9.42) * 0.5 + 0.5,\n      sin(h * 9.42 + 2.094) * 0.5 + 0.5,\n      sin(h * 9.42 + 4.189) * 0.5 + 0.5\n    );\n  }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    float l = luma(src.rgb);\n    int mode = int(falseColorMode + 0.5);\n    vec3 fc;\n    if (mode == 0) fc = ditExposure(l);\n    else if (mode == 1) fc = zoneHeat(l);\n    else if (mode == 2) fc = resolveStyle(l);\n    else fc = histogramStripes(l);\n\n    // Highlight zones around midpoint\n    if (falseColorRange > 0.001) {\n      float zoneMask = smoothstep(falseColorRange, 0.0, abs(l - falseColorMidpoint));\n      fc = mix(fc, vec3(0, 1, 0), zoneMask * 0.4); // green tint on safe zone\n    }\n\n    vec3 result = mix(src.rgb, fc, falseColorShowOriginal);\n    gl_FragColor = vec4(mix(src.rgb, result, falseColorMix), src.a);\n  }\n",
    "defaults": {
      "falseColorMode": 0,
      "falseColorMix": 1,
      "falseColorShowOriginal": 1,
      "falseColorMidpoint": 0.5,
      "falseColorRange": 0
    },
    "controls": [
      {
        "name": "Mode",
        "param": "falseColorMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "DIT Exposure"
          },
          {
            "value": 1,
            "label": "Zone Heat"
          },
          {
            "value": 2,
            "label": "Resolve Style"
          },
          {
            "value": 3,
            "label": "Histogram Stripes"
          }
        ]
      },
      {
        "name": "Mix",
        "param": "falseColorMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Show Original",
        "param": "falseColorShowOriginal",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mid Reference",
        "param": "falseColorMidpoint",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Safe Zone Range",
        "param": "falseColorRange",
        "min": 0,
        "max": 0.5,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "shadowRecovery",
    "label": "Shadow Recovery",
    "category": "Advanced Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float shadowAmount;        // 0-1 shadow lift\n  uniform float shadowThreshold;     // 0-1 shadow zone\n  uniform float shadowSoftness;      // 0-1 transition softness\n  uniform float shadowColorRecovery; // 0-1 boost saturation in shadows\n  uniform float shadowHighlightProtect; // 0-1\n  uniform float shadowMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    float l = luma(src.rgb);\n    // Shadow weight: 1 at black, 0 above threshold (with softness)\n    float w = 1.0 - smoothstep(shadowThreshold, shadowThreshold + shadowSoftness + 0.001, l);\n\n    // Lift formula: pull shadows toward midtone using a power curve\n    float liftPow = mix(1.0, 0.45, shadowAmount);\n    vec3 lifted = pow(max(src.rgb, 0.0001), vec3(liftPow));\n\n    // Highlight protect — fade lift back near 1.0\n    float highW = smoothstep(0.7, 1.0, l);\n    float effW = w * (1.0 - highW * shadowHighlightProtect);\n    vec3 result = mix(src.rgb, lifted, effW);\n\n    // Optional color recovery (boost saturation in lifted shadows)\n    if (shadowColorRecovery > 0.001) {\n      float rl = luma(result);\n      vec3 boosted = mix(vec3(rl), result, 1.0 + shadowColorRecovery * 0.6);\n      result = mix(result, boosted, effW);\n    }\n\n    gl_FragColor = vec4(mix(src.rgb, result, shadowMix), src.a);\n  }\n",
    "defaults": {
      "shadowAmount": 0.5,
      "shadowThreshold": 0.4,
      "shadowSoftness": 0.3,
      "shadowColorRecovery": 0.3,
      "shadowHighlightProtect": 0.6,
      "shadowMix": 1
    },
    "controls": [
      {
        "name": "Shadow Lift",
        "param": "shadowAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Shadow Threshold",
        "param": "shadowThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Transition",
        "param": "shadowSoftness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Color Recovery",
        "param": "shadowColorRecovery",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Highlight Protect",
        "param": "shadowHighlightProtect",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Mix",
        "param": "shadowMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "highlightRolloff",
    "label": "Highlight Roll-off",
    "category": "Advanced Color",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float highRolloffAmount;        // 0-1 rolloff strength\n  uniform float highRolloffThreshold;     // 0-1 where rolloff begins\n  uniform float highRolloffSoftness;      // 0-1\n  uniform float highRolloffPreserveHue;   // 0-1 preserve hue while rolling off\n  uniform float highRolloffMaxValue;      // 0.7-1.5 ceiling for compressed highlights\n  uniform float highRolloffMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  vec3 hueAwareRolloff(vec3 src, float threshold, float maxV, float amount) {\n    float l = luma(src);\n    // Rolloff curve: hyperbolic compress\n    float over = max(0.0, l - threshold);\n    float compressed = threshold + over / (1.0 + over * (4.0 * amount));\n    compressed = min(compressed, maxV);\n    float scale = (l > 0.001) ? compressed / l : 1.0;\n    return src * scale;\n  }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    float l = luma(src.rgb);\n    float w = smoothstep(highRolloffThreshold - highRolloffSoftness, highRolloffThreshold + highRolloffSoftness * 0.5 + 0.001, l);\n\n    vec3 rolledHue = hueAwareRolloff(src.rgb, highRolloffThreshold, highRolloffMaxValue, highRolloffAmount);\n    vec3 rolledRgb = vec3(\n      min(src.r, mix(src.r, highRolloffThreshold + (src.r - highRolloffThreshold) / (1.0 + (src.r - highRolloffThreshold) * 4.0 * highRolloffAmount), w)),\n      min(src.g, mix(src.g, highRolloffThreshold + (src.g - highRolloffThreshold) / (1.0 + (src.g - highRolloffThreshold) * 4.0 * highRolloffAmount), w)),\n      min(src.b, mix(src.b, highRolloffThreshold + (src.b - highRolloffThreshold) / (1.0 + (src.b - highRolloffThreshold) * 4.0 * highRolloffAmount), w))\n    );\n    vec3 result = mix(rolledRgb, rolledHue, highRolloffPreserveHue);\n\n    gl_FragColor = vec4(mix(src.rgb, result, highRolloffMix * w), src.a);\n  }\n",
    "defaults": {
      "highRolloffAmount": 0.5,
      "highRolloffThreshold": 0.7,
      "highRolloffSoftness": 0.2,
      "highRolloffPreserveHue": 0.5,
      "highRolloffMaxValue": 1,
      "highRolloffMix": 1
    },
    "controls": [
      {
        "name": "Rolloff",
        "param": "highRolloffAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Threshold",
        "param": "highRolloffThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Knee Softness",
        "param": "highRolloffSoftness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Preserve Hue",
        "param": "highRolloffPreserveHue",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Ceiling",
        "param": "highRolloffMaxValue",
        "min": 0.7,
        "max": 1.5,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mix",
        "param": "highRolloffMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "halation",
    "label": "Halation",
    "category": "Light & Glow",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float halationAmount;        // 0-2 bleed strength\n  uniform float halationRadius;        // 0-30 bleed radius\n  uniform float halationThreshold;     // 0-1 highlight threshold\n  uniform float halationTintR;         // 0-1 bleed colour\n  uniform float halationTintG;         // 0-1\n  uniform float halationTintB;         // 0-1\n  uniform float halationMode;          // 0=screen, 1=add, 2=soft light\n  uniform float halationMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (halationAmount < 0.001) { gl_FragColor = src; return; }\n\n    vec2 texel = 1.0 / uResolution;\n    vec3 bleed = vec3(0.0);\n    float wsum = 0.0;\n    float r = max(1.0, halationRadius);\n\n    for (int y = -5; y <= 5; y++) {\n      for (int x = -5; x <= 5; x++) {\n        if (abs(x) + abs(y) > 7) continue;\n        vec2 off = vec2(float(x), float(y)) * texel * r * 0.5;\n        vec3 sampleCol = texture2D(uInput, vUv + off).rgb;\n        float gate = smoothstep(halationThreshold, halationThreshold + 0.2, luma(sampleCol));\n        float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));\n        bleed += sampleCol * gate * w;\n        wsum += w;\n      }\n    }\n    bleed = (wsum > 0.0) ? bleed / wsum : vec3(0.0);\n    bleed *= vec3(halationTintR, halationTintG, halationTintB) * halationAmount;\n\n    int mode = int(halationMode + 0.5);\n    vec3 result;\n    if (mode == 0) {\n      // Screen\n      result = 1.0 - (1.0 - src.rgb) * (1.0 - bleed);\n    } else if (mode == 1) {\n      // Add\n      result = src.rgb + bleed;\n    } else {\n      // Soft light\n      vec3 a = 2.0 * src.rgb * bleed + src.rgb * src.rgb * (1.0 - 2.0 * bleed);\n      vec3 b = sqrt(src.rgb) * (2.0 * bleed - 1.0) + 2.0 * src.rgb * (1.0 - bleed);\n      result = mix(a, b, step(0.5, bleed));\n    }\n\n    gl_FragColor = vec4(mix(src.rgb, result, halationMix), src.a);\n  }\n",
    "defaults": {
      "halationAmount": 0.6,
      "halationRadius": 12,
      "halationThreshold": 0.65,
      "halationTintR": 0.9,
      "halationTintG": 0.45,
      "halationTintB": 0.2,
      "halationMode": 0,
      "halationMix": 1
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "halationAmount",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Bleed Radius",
        "param": "halationRadius",
        "min": 1,
        "max": 30,
        "step": 0.5,
        "default": 12
      },
      {
        "name": "Highlight Threshold",
        "param": "halationThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.65
      },
      {
        "name": "Tint R",
        "param": "halationTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.9
      },
      {
        "name": "Tint G",
        "param": "halationTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.45
      },
      {
        "name": "Tint B",
        "param": "halationTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Blend",
        "param": "halationMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Screen"
          },
          {
            "value": 1,
            "label": "Add"
          },
          {
            "value": 2,
            "label": "Soft Light"
          }
        ]
      },
      {
        "name": "Mix",
        "param": "halationMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "anamorphicStreak",
    "label": "Anamorphic Streak",
    "category": "Light & Glow",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float anaIntensity;     // 0-2\n  uniform float anaLength;        // 0-1 streak length (% of screen)\n  uniform float anaThreshold;     // 0-1 highlight threshold\n  uniform float anaTintR;         // 0-1 streak colour (typically blue)\n  uniform float anaTintG;         // 0-1\n  uniform float anaTintB;         // 0-1\n  uniform float anaAngle;         // 0-180 streak angle (default horizontal)\n  uniform float anaSamples;       // 16-64\n  uniform float anaMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (anaIntensity < 0.001) { gl_FragColor = src; return; }\n\n    int samples = int(clamp(anaSamples, 8.0, 64.0));\n    float ang = radians(anaAngle);\n    vec2 dir = vec2(cos(ang), sin(ang));\n    vec2 texel = 1.0 / uResolution;\n\n    vec3 streak = vec3(0.0);\n    float wsum = 0.0;\n    for (int i = -64; i <= 64; i++) {\n      if (abs(i) > samples) continue;\n      float t = float(i) / float(samples);\n      vec2 off = dir * t * anaLength;\n      vec3 sCol = texture2D(uInput, vUv + off).rgb;\n      float gate = smoothstep(anaThreshold, anaThreshold + 0.15, luma(sCol));\n      float w = exp(-abs(t) * 2.0);\n      streak += sCol * gate * w;\n      wsum += w;\n    }\n    streak = (wsum > 0.0) ? streak / wsum : vec3(0.0);\n    streak *= vec3(anaTintR, anaTintG, anaTintB) * anaIntensity;\n\n    // Screen blend\n    vec3 result = 1.0 - (1.0 - src.rgb) * (1.0 - streak);\n    gl_FragColor = vec4(mix(src.rgb, result, anaMix), src.a);\n  }\n",
    "defaults": {
      "anaIntensity": 0.6,
      "anaLength": 0.5,
      "anaThreshold": 0.7,
      "anaTintR": 0.6,
      "anaTintG": 0.75,
      "anaTintB": 1,
      "anaAngle": 0,
      "anaSamples": 32,
      "anaMix": 1
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "anaIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Streak Length",
        "param": "anaLength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Threshold",
        "param": "anaThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Tint R",
        "param": "anaTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Tint G",
        "param": "anaTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.75
      },
      {
        "name": "Tint B",
        "param": "anaTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Angle",
        "param": "anaAngle",
        "min": 0,
        "max": 180,
        "step": 1,
        "default": 0
      },
      {
        "name": "Samples",
        "param": "anaSamples",
        "min": 8,
        "max": 64,
        "step": 2,
        "default": 32
      },
      {
        "name": "Mix",
        "param": "anaMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "lensDirt",
    "label": "Lens Dirt",
    "category": "Light & Glow",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float dirtAmount;        // 0-1 dirt overlay strength\n  uniform float dirtScale;         // 1-32 noise pattern scale\n  uniform float dirtThreshold;     // 0-1 dirt visibility threshold (only show on bright areas)\n  uniform float dirtTintWarmth;    // 0-1 warm/cool dust colour\n  uniform float dirtScratches;     // 0-1 vertical scratch overlay\n  uniform float dirtSpots;         // 0-1 dust spot density\n  uniform float dirtMode;          // 0=screen, 1=add, 2=multiply (debris)\n  uniform float uTime;\n  uniform float dirtAnimSpeed;     // 0-1 dirt drift\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (dirtAmount < 0.001) { gl_FragColor = src; return; }\n\n    vec2 driftUv = vUv + vec2(uTime * dirtAnimSpeed * 0.01, uTime * dirtAnimSpeed * 0.005);\n\n    // Dust spot field (low-frequency noise)\n    float spots = 0.0;\n    if (dirtSpots > 0.001) {\n      float n1 = vnoise(driftUv * dirtScale * 4.0);\n      float n2 = vnoise(driftUv * dirtScale * 8.0 + vec2(13.7, 9.1));\n      float n3 = vnoise(driftUv * dirtScale * 12.0 + vec2(45.2, 71.3));\n      spots = (n1 * n2 * n3) * 4.0;\n      spots = smoothstep(0.3, 0.6, spots) * dirtSpots;\n    }\n\n    // Vertical scratches\n    float scratches = 0.0;\n    if (dirtScratches > 0.001) {\n      float xn = hash21(vec2(floor(driftUv.x * uResolution.x * 0.05), 0.0));\n      scratches = step(0.97, xn) * dirtScratches * 0.7;\n    }\n\n    float dirt = clamp(spots + scratches, 0.0, 1.0);\n    float bright = smoothstep(dirtThreshold, dirtThreshold + 0.2, luma(src.rgb));\n    dirt *= bright * dirtAmount;\n\n    vec3 dustColor = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.85, 0.65), dirtTintWarmth);\n    vec3 dirtRgb = dustColor * dirt;\n\n    int mode = int(dirtMode + 0.5);\n    vec3 result;\n    if (mode == 0) {\n      result = 1.0 - (1.0 - src.rgb) * (1.0 - dirtRgb);\n    } else if (mode == 1) {\n      result = src.rgb + dirtRgb;\n    } else {\n      result = src.rgb * (1.0 - dirt * 0.5);\n    }\n    gl_FragColor = vec4(result, src.a);\n  }\n",
    "defaults": {
      "dirtAmount": 0.5,
      "dirtScale": 8,
      "dirtThreshold": 0.6,
      "dirtTintWarmth": 0.4,
      "dirtScratches": 0.2,
      "dirtSpots": 0.6,
      "dirtMode": 0,
      "dirtAnimSpeed": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "dirtAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Pattern Scale",
        "param": "dirtScale",
        "min": 1,
        "max": 32,
        "step": 0.5,
        "default": 8
      },
      {
        "name": "Highlight Threshold",
        "param": "dirtThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Warm Tint",
        "param": "dirtTintWarmth",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Scratches",
        "param": "dirtScratches",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Spots",
        "param": "dirtSpots",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Blend",
        "param": "dirtMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Screen"
          },
          {
            "value": 1,
            "label": "Add"
          },
          {
            "value": 2,
            "label": "Multiply (debris)"
          }
        ]
      },
      {
        "name": "Drift Speed",
        "param": "dirtAnimSpeed",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "defocusBokeh",
    "label": "Defocus Bokeh",
    "category": "Blur & Focus",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float bokehRadius;        // 0-30 disc radius\n  uniform float bokehSamples;       // 12-48\n  uniform float bokehBrightWeight;  // 0-2 boost on highlights (creates bokeh balls)\n  uniform float bokehThreshold;     // 0-1 highlight threshold\n  uniform float bokehChromaFringe;  // 0-1 RGB radial offset\n  uniform float bokehShape;         // 0=disc, 1=hexagon, 2=octagon\n  uniform float bokehRotation;      // 0-360 aperture rotation\n  uniform float bokehMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  // Aperture mask: returns 1 if (sx, sy) is inside the aperture shape\n  float apertureMask(vec2 p, int shape) {\n    float r = length(p);\n    if (r > 1.0) return 0.0;\n    if (shape == 0) return 1.0; // disc\n    float ang = atan(p.y, p.x);\n    int sides = (shape == 1) ? 6 : 8;\n    float n = float(sides);\n    float halfAng = 3.14159 / n;\n    float folded = mod(ang + halfAng, 2.0 * halfAng) - halfAng;\n    float polyR = cos(halfAng) / cos(folded);\n    return r <= polyR ? 1.0 : 0.0;\n  }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (bokehRadius < 0.5) { gl_FragColor = src; return; }\n\n    int samples = int(clamp(bokehSamples, 8.0, 48.0));\n    int shape = int(bokehShape + 0.5);\n    float rot = radians(bokehRotation);\n    float ca = cos(rot), sa = sin(rot);\n    vec2 texel = 1.0 / uResolution;\n\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n\n    // Sample on golden-angle spiral inside aperture mask\n    for (int i = 0; i < 48; i++) {\n      if (i >= samples) break;\n      float fi = float(i);\n      float t = fi / float(samples);\n      // Golden-angle spiral\n      float angle = fi * 2.39996;\n      float radius = sqrt(t);\n      vec2 disc = vec2(cos(angle), sin(angle)) * radius;\n      // Rotate to user-set aperture rotation\n      vec2 rotDisc = vec2(disc.x * ca - disc.y * sa, disc.x * sa + disc.y * ca);\n      float mask = apertureMask(rotDisc, shape);\n      if (mask < 0.5) continue;\n\n      vec2 off;\n      vec3 c;\n      if (bokehChromaFringe > 0.001) {\n        // Per-channel offset for fringing\n        vec2 dir = normalize(rotDisc + 1e-6);\n        float rOff = bokehRadius * (1.0 + bokehChromaFringe * 0.05);\n        float bOff = bokehRadius * (1.0 - bokehChromaFringe * 0.05);\n        off = rotDisc * bokehRadius * texel;\n        float r = texture2D(uInput, vUv + dir * rOff * texel + (off - dir * bokehRadius * texel)).r;\n        float g = texture2D(uInput, vUv + off).g;\n        float b = texture2D(uInput, vUv + dir * bOff * texel + (off - dir * bokehRadius * texel)).b;\n        c = vec3(r, g, b);\n      } else {\n        off = rotDisc * bokehRadius * texel;\n        c = texture2D(uInput, vUv + off).rgb;\n      }\n\n      // Bright-weight: boost highlights so they form crisp bokeh balls\n      float w = 1.0;\n      if (bokehBrightWeight > 0.001) {\n        float l = luma(c);\n        float hi = smoothstep(bokehThreshold, bokehThreshold + 0.2, l);\n        w = mix(1.0, 1.0 + bokehBrightWeight * 6.0, hi);\n      }\n      acc += c * w;\n      wsum += w;\n    }\n\n    vec3 result = (wsum > 0.0) ? acc / wsum : src.rgb;\n    gl_FragColor = vec4(mix(src.rgb, result, bokehMix), src.a);\n  }\n",
    "defaults": {
      "bokehRadius": 12,
      "bokehSamples": 24,
      "bokehBrightWeight": 0.8,
      "bokehThreshold": 0.7,
      "bokehChromaFringe": 0,
      "bokehShape": 0,
      "bokehRotation": 0,
      "bokehMix": 1
    },
    "controls": [
      {
        "name": "Radius",
        "param": "bokehRadius",
        "min": 0,
        "max": 30,
        "step": 0.5,
        "default": 12
      },
      {
        "name": "Samples",
        "param": "bokehSamples",
        "min": 8,
        "max": 48,
        "step": 2,
        "default": 24
      },
      {
        "name": "Bright Boost",
        "param": "bokehBrightWeight",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.8
      },
      {
        "name": "Highlight Threshold",
        "param": "bokehThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Chroma Fringe",
        "param": "bokehChromaFringe",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Aperture",
        "param": "bokehShape",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Disc"
          },
          {
            "value": 1,
            "label": "Hexagon"
          },
          {
            "value": 2,
            "label": "Octagon"
          }
        ]
      },
      {
        "name": "Aperture Rotation",
        "param": "bokehRotation",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "bokehMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "diffusionPromist",
    "label": "Diffusion / Pro-Mist",
    "category": "Light & Glow",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float diffAmount;        // 0-1 diffusion strength\n  uniform float diffRadius;        // 1-30 glow radius\n  uniform float diffThreshold;     // 0-1 highlight threshold\n  uniform float diffShadowLift;    // 0-1 lift shadows\n  uniform float diffHighlightBloom;// 0-1 bloom on highlights\n  uniform float diffHaze;          // 0-1 overall haze (lower contrast)\n  uniform float diffHazeWarmth;    // 0-1 warm haze tint\n  uniform float diffMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (diffAmount < 0.001) { gl_FragColor = src; return; }\n\n    // Highlight-only blur for bloom\n    vec2 texel = 1.0 / uResolution;\n    vec3 bloom = vec3(0.0);\n    float wsum = 0.0;\n    float r = max(1.0, diffRadius);\n    for (int y = -5; y <= 5; y++) {\n      for (int x = -5; x <= 5; x++) {\n        if (abs(x) + abs(y) > 7) continue;\n        vec2 off = vec2(float(x), float(y)) * texel * r * 0.4;\n        vec3 sCol = texture2D(uInput, vUv + off).rgb;\n        float gate = smoothstep(diffThreshold, diffThreshold + 0.2, luma(sCol));\n        float w = exp(-(float(x*x + y*y)) / (2.0 * r * r));\n        bloom += sCol * gate * w;\n        wsum += w;\n      }\n    }\n    bloom = (wsum > 0.0) ? bloom / wsum : vec3(0.0);\n    bloom *= diffHighlightBloom * 1.5;\n\n    // Shadow lift (raises blacks)\n    vec3 lifted = src.rgb + (1.0 - src.rgb) * diffShadowLift * 0.15;\n\n    // Haze: lower contrast + optional warm tint\n    vec3 hazeColor = mix(vec3(0.7, 0.75, 0.8), vec3(0.95, 0.85, 0.7), diffHazeWarmth);\n    vec3 hazed = mix(lifted, hazeColor, diffHaze * 0.3);\n\n    // Combine: hazed base + screen-blended bloom\n    vec3 result = 1.0 - (1.0 - hazed) * (1.0 - bloom);\n    result = mix(src.rgb, result, diffMix * diffAmount);\n\n    gl_FragColor = vec4(result, src.a);\n  }\n",
    "defaults": {
      "diffAmount": 0.5,
      "diffRadius": 12,
      "diffThreshold": 0.6,
      "diffShadowLift": 0.3,
      "diffHighlightBloom": 0.5,
      "diffHaze": 0.3,
      "diffHazeWarmth": 0.5,
      "diffMix": 1
    },
    "controls": [
      {
        "name": "Strength",
        "param": "diffAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Glow Radius",
        "param": "diffRadius",
        "min": 1,
        "max": 30,
        "step": 0.5,
        "default": 12
      },
      {
        "name": "Highlight Threshold",
        "param": "diffThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Shadow Lift",
        "param": "diffShadowLift",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Highlight Bloom",
        "param": "diffHighlightBloom",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Haze",
        "param": "diffHaze",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Haze Warmth",
        "param": "diffHazeWarmth",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Mix",
        "param": "diffMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "ascii",
    "label": "ASCII",
    "category": "Advanced Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float asciiCellSize;      // 4-32 px\n  uniform float asciiContrast;      // 0-2\n  uniform float asciiColorMix;      // 0-1 keep colour\n  uniform float asciiMode;          // 0=density, 1=stipple, 2=block, 3=line\n  uniform float asciiInvert;        // 0/1\n  uniform float asciiTintR;         // 0-1\n  uniform float asciiTintG;\n  uniform float asciiTintB;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  // Approximate ASCII density via geometric primitives\n  float charShape(vec2 cellUv, float density, int mode) {\n    vec2 cu = cellUv - 0.5;\n    float r = length(cu);\n    if (mode == 0) {\n      // Density: ramp through circle/dot/cross/dense\n      if (density < 0.1) return 0.0; // .\n      if (density < 0.25) return smoothstep(0.45, 0.35, r); // ·\n      if (density < 0.45) return smoothstep(0.35, 0.25, r); // o\n      if (density < 0.65) return max(smoothstep(0.05, 0.0, abs(cu.x)), smoothstep(0.05, 0.0, abs(cu.y))); // +\n      if (density < 0.85) return smoothstep(0.45, 0.0, abs(cu.x) + abs(cu.y) - 0.4); // #\n      return 1.0; // @\n    } else if (mode == 1) {\n      // Stipple: random dots scaled by density\n      float h = hash21(floor(cellUv * 8.0));\n      return step(1.0 - density, h);\n    } else if (mode == 2) {\n      // Solid block proportional to density\n      return step(1.0 - density, 1.0);\n    } else {\n      // Line/diagonal hatching\n      float ang = density * 3.14;\n      float v = abs(sin((cu.x * cos(ang) + cu.y * sin(ang)) * 12.0));\n      return step(1.0 - density, v);\n    }\n  }\n\n  void main() {\n    vec2 cell = floor(vUv * uResolution / asciiCellSize);\n    vec2 cellOrigin = cell * asciiCellSize / uResolution;\n    vec2 cellSize = vec2(asciiCellSize) / uResolution;\n    vec2 cellUv = (vUv - cellOrigin) / cellSize;\n\n    vec3 sampleCol = texture2D(uInput, cellOrigin + cellSize * 0.5).rgb;\n    float l = luma(sampleCol);\n    if (asciiInvert > 0.5) l = 1.0 - l;\n    l = clamp((l - 0.5) * asciiContrast + 0.5, 0.0, 1.0);\n\n    float v = charShape(cellUv, l, int(asciiMode + 0.5));\n\n    vec3 inkColor = mix(vec3(asciiTintR, asciiTintG, asciiTintB), sampleCol, asciiColorMix);\n    vec3 result = vec3(v) * inkColor;\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "asciiCellSize": 12,
      "asciiContrast": 1.2,
      "asciiColorMix": 0.3,
      "asciiMode": 0,
      "asciiInvert": 0,
      "asciiTintR": 0,
      "asciiTintG": 1,
      "asciiTintB": 0.4
    },
    "controls": [
      {
        "name": "Cell Size",
        "param": "asciiCellSize",
        "min": 4,
        "max": 32,
        "step": 1,
        "default": 12
      },
      {
        "name": "Contrast",
        "param": "asciiContrast",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1.2
      },
      {
        "name": "Color Mix",
        "param": "asciiColorMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Style",
        "param": "asciiMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Density Ramp"
          },
          {
            "value": 1,
            "label": "Stipple"
          },
          {
            "value": 2,
            "label": "Solid Block"
          },
          {
            "value": 3,
            "label": "Line Hatching"
          }
        ]
      },
      {
        "name": "Invert",
        "param": "asciiInvert",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Tint R",
        "param": "asciiTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Tint G",
        "param": "asciiTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint B",
        "param": "asciiTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      }
    ],
    "integerParams": []
  },
  {
    "type": "comicInk",
    "label": "Comic Ink",
    "category": "Advanced Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float comicInkStrength;   // 0-2\n  uniform float comicInkThreshold;  // 0-1\n  uniform float comicInkPosterize;     // 2-12 levels\n  uniform float comicInkHalftone;// 0-1\n  uniform float comicInkHalftoneSize;  // 2-16\n  uniform float comicInkColorMix;      // 0-1\n  uniform float comicInkR;\n  uniform float comicInkG;\n  uniform float comicInkB;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec2 texel = 1.0 / uResolution;\n    vec3 src = texture2D(uInput, vUv).rgb;\n\n    // Sobel edges on luma\n    float l00 = luma(texture2D(uInput, vUv + texel * vec2(-1, -1)).rgb);\n    float l10 = luma(texture2D(uInput, vUv + texel * vec2( 0, -1)).rgb);\n    float l20 = luma(texture2D(uInput, vUv + texel * vec2( 1, -1)).rgb);\n    float l01 = luma(texture2D(uInput, vUv + texel * vec2(-1,  0)).rgb);\n    float l21 = luma(texture2D(uInput, vUv + texel * vec2( 1,  0)).rgb);\n    float l02 = luma(texture2D(uInput, vUv + texel * vec2(-1,  1)).rgb);\n    float l12 = luma(texture2D(uInput, vUv + texel * vec2( 0,  1)).rgb);\n    float l22 = luma(texture2D(uInput, vUv + texel * vec2( 1,  1)).rgb);\n    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);\n    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);\n    float edge = clamp(length(vec2(gx, gy)) * comicInkStrength, 0.0, 1.0);\n    float ink = step(comicInkThreshold, edge);\n\n    // Posterize\n    float steps = max(2.0, comicInkPosterize);\n    vec3 quant = floor(src * steps + 0.5) / steps;\n    vec3 colored = mix(quant, src, comicInkColorMix);\n\n    // Halftone shadow overlay\n    if (comicInkHalftone > 0.001) {\n      float l = luma(quant);\n      vec2 px = vUv * uResolution / comicInkHalftoneSize;\n      vec2 cell = fract(px) - 0.5;\n      float dot = smoothstep(0.45, 0.4, length(cell)) * (1.0 - l);\n      colored *= 1.0 - dot * comicInkHalftone;\n    }\n\n    vec3 result = mix(colored, vec3(comicInkR, comicInkG, comicInkB), ink);\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "comicInkStrength": 1.2,
      "comicInkThreshold": 0.3,
      "comicInkPosterize": 5,
      "comicInkHalftone": 0.4,
      "comicInkHalftoneSize": 6,
      "comicInkColorMix": 0.3,
      "comicInkR": 0,
      "comicInkG": 0,
      "comicInkB": 0
    },
    "controls": [
      {
        "name": "Ink Strength",
        "param": "comicInkStrength",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1.2
      },
      {
        "name": "Edge Threshold",
        "param": "comicInkThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Posterize",
        "param": "comicInkPosterize",
        "min": 2,
        "max": 12,
        "step": 1,
        "default": 5
      },
      {
        "name": "Halftone Shadow",
        "param": "comicInkHalftone",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Halftone Size",
        "param": "comicInkHalftoneSize",
        "min": 2,
        "max": 16,
        "step": 0.5,
        "default": 6
      },
      {
        "name": "Color Mix",
        "param": "comicInkColorMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Ink R",
        "param": "comicInkR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Ink G",
        "param": "comicInkG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Ink B",
        "param": "comicInkB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "scanlineDrift",
    "label": "Scanline Drift",
    "category": "Advanced Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float scanDriftIntensity;     // 0-1\n  uniform float scanDriftFrequency;     // 1-200 line frequency\n  uniform float scanDriftSpeed;         // 0-3\n  uniform float scanDriftWaveform;      // 0=sin, 1=noise, 2=sawtooth\n  uniform float scanDriftChromaSplit;   // 0-1\n  uniform float scanDriftChunkiness;    // 0-1 hold for N rows\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash11(float n) { return fract(sin(n) * 43758.5453); }\n\n  void main() {\n    if (scanDriftIntensity < 0.001) { gl_FragColor = texture2D(uInput, vUv); return; }\n\n    int wf = int(scanDriftWaveform + 0.5);\n    float yLine = vUv.y;\n    if (scanDriftChunkiness > 0.001) {\n      float chunk = mix(1.0, 32.0, scanDriftChunkiness);\n      yLine = floor(vUv.y * uResolution.y / chunk) * chunk / uResolution.y;\n    }\n    float t = uTime * scanDriftSpeed;\n    float drift;\n    if (wf == 0) drift = sin(yLine * scanDriftFrequency + t);\n    else if (wf == 1) drift = (hash11(floor(yLine * scanDriftFrequency) + floor(t * 8.0)) - 0.5) * 2.0;\n    else drift = mod(yLine * scanDriftFrequency + t, 1.0) * 2.0 - 1.0;\n    drift *= scanDriftIntensity * 0.05;\n\n    vec3 col;\n    if (scanDriftChromaSplit > 0.001) {\n      float r = texture2D(uInput, vec2(vUv.x + drift * (1.0 + scanDriftChromaSplit * 0.3), vUv.y)).r;\n      float g = texture2D(uInput, vec2(vUv.x + drift, vUv.y)).g;\n      float b = texture2D(uInput, vec2(vUv.x + drift * (1.0 - scanDriftChromaSplit * 0.3), vUv.y)).b;\n      col = vec3(r, g, b);\n    } else {\n      col = texture2D(uInput, vec2(vUv.x + drift, vUv.y)).rgb;\n    }\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(col, src.a);\n  }\n",
    "defaults": {
      "scanDriftIntensity": 0.5,
      "scanDriftFrequency": 80,
      "scanDriftSpeed": 1,
      "scanDriftWaveform": 0,
      "scanDriftChromaSplit": 0.3,
      "scanDriftChunkiness": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "scanDriftIntensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Frequency",
        "param": "scanDriftFrequency",
        "min": 1,
        "max": 200,
        "step": 1,
        "default": 80
      },
      {
        "name": "Speed",
        "param": "scanDriftSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Waveform",
        "param": "scanDriftWaveform",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Sine"
          },
          {
            "value": 1,
            "label": "Noise"
          },
          {
            "value": 2,
            "label": "Sawtooth"
          }
        ]
      },
      {
        "name": "Chroma Split",
        "param": "scanDriftChromaSplit",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Chunkiness",
        "param": "scanDriftChunkiness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "tapeDropout",
    "label": "Tape Dropout",
    "category": "Advanced Stylize",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float tapeDropoutDensity;       // 0-1\n  uniform float tapeDropoutLength;        // 0-1 stripe length\n  uniform float tapeDropoutColor;         // 0=white, 1=mono, 2=glitch hue\n  uniform float tapeDropoutSpeed;         // 0-3\n  uniform float tapeDropoutNoise;      // 0-1\n  uniform float tapeDropoutMix;           // 0-1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (tapeDropoutDensity < 0.001) { gl_FragColor = src; return; }\n\n    float t = floor(uTime * tapeDropoutSpeed * 8.0) / 8.0;\n    float yBucket = floor(vUv.y * 80.0);\n    float trigger = hash21(vec2(yBucket, t));\n    float lenH = hash21(vec2(yBucket + 13.0, t));\n    float startX = hash21(vec2(yBucket + 27.0, t));\n    float length = tapeDropoutLength * mix(0.05, 0.5, lenH);\n\n    float inStripe = step(1.0 - tapeDropoutDensity * 0.4, trigger)\n                   * step(startX, vUv.x)\n                   * step(vUv.x, startX + length);\n\n    if (inStripe < 0.5) { gl_FragColor = src; return; }\n\n    int colorMode = int(tapeDropoutColor + 0.5);\n    float n = hash21(vec2(vUv.x * uResolution.x, t * 100.0));\n    vec3 stripe;\n    if (colorMode == 0) stripe = vec3(n);\n    else if (colorMode == 1) stripe = vec3(n * 0.6 + 0.2);\n    else {\n      float hue = hash21(vec2(yBucket, t * 13.0));\n      stripe = mix(vec3(1, 0, 0.4), vec3(0, 1, 0.6), hue);\n      stripe = mix(stripe, vec3(0.4, 0.4, 1), n);\n    }\n    stripe = mix(stripe, src.rgb, 1.0 - tapeDropoutNoise);\n\n    gl_FragColor = vec4(mix(src.rgb, stripe, tapeDropoutMix * inStripe), src.a);\n  }\n",
    "defaults": {
      "tapeDropoutDensity": 0.4,
      "tapeDropoutLength": 0.5,
      "tapeDropoutColor": 0,
      "tapeDropoutSpeed": 1,
      "tapeDropoutNoise": 0.7,
      "tapeDropoutMix": 1
    },
    "controls": [
      {
        "name": "Density",
        "param": "tapeDropoutDensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Stripe Length",
        "param": "tapeDropoutLength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Color",
        "param": "tapeDropoutColor",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "White"
          },
          {
            "value": 1,
            "label": "Mono"
          },
          {
            "value": 2,
            "label": "Glitch Hue"
          }
        ]
      },
      {
        "name": "Speed",
        "param": "tapeDropoutSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Noise",
        "param": "tapeDropoutNoise",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Mix",
        "param": "tapeDropoutMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "polarTransform",
    "label": "Polar Transform",
    "category": "Distort",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float polarMode;          // 0=cart→polar, 1=polar→cart, 2=log polar\n  uniform float polarRotation;      // 0-360\n  uniform float polarZoom;          // 0.25-4\n  uniform float polarCenterX;\n  uniform float polarCenterY;\n  uniform float polarMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    int mode = int(polarMode + 0.5);\n    vec2 c = vec2(polarCenterX, polarCenterY);\n    vec2 sUv;\n\n    if (mode == 0) {\n      // Cart → polar (input becomes radial pattern)\n      vec2 d = vUv - c;\n      d.x *= uResolution.x / uResolution.y;\n      float r = length(d) * 2.0;\n      float a = atan(d.y, d.x) / 6.28318 + 0.5;\n      a = fract(a + polarRotation / 360.0);\n      sUv = vec2(a, r * polarZoom);\n    } else if (mode == 1) {\n      // Polar → cart (rectangular UV becomes radial)\n      float a = (vUv.x - 0.5 + polarRotation / 360.0) * 6.28318;\n      float r = vUv.y * polarZoom;\n      vec2 d = vec2(cos(a), sin(a)) * r * 0.5;\n      d.x *= uResolution.y / uResolution.x;\n      sUv = c + d;\n    } else {\n      // Log polar\n      vec2 d = vUv - c;\n      d.x *= uResolution.x / uResolution.y;\n      float r = log(length(d) * 2.0 + 1.0);\n      float a = atan(d.y, d.x) / 6.28318 + 0.5;\n      a = fract(a + polarRotation / 360.0);\n      sUv = vec2(a, r * polarZoom);\n    }\n\n    sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n    vec4 mapped = texture2D(uInput, sUv);\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(mix(src.rgb, mapped.rgb, polarMix), src.a);\n  }\n",
    "defaults": {
      "polarMode": 0,
      "polarRotation": 0,
      "polarZoom": 1,
      "polarCenterX": 0.5,
      "polarCenterY": 0.5,
      "polarMix": 1
    },
    "controls": [
      {
        "name": "Mode",
        "param": "polarMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Cart → Polar"
          },
          {
            "value": 1,
            "label": "Polar → Cart"
          },
          {
            "value": 2,
            "label": "Log Polar"
          }
        ]
      },
      {
        "name": "Rotation",
        "param": "polarRotation",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Zoom",
        "param": "polarZoom",
        "min": 0.25,
        "max": 4,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Center X",
        "param": "polarCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "polarCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Mix",
        "param": "polarMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "rippleCaustics",
    "label": "Ripple Caustics",
    "category": "Advanced Warp",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float causticsIntensity;     // 0-2\n  uniform float causticsScale;         // 1-32\n  uniform float causticsSpeed;         // 0-3\n  uniform float causticsRefraction;    // 0-1 distort source\n  uniform float causticsTintR;\n  uniform float causticsTintG;\n  uniform float causticsTintB;\n  uniform float causticsMode;          // 0=overlay, 1=add, 2=screen\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  // Caustic via Voronoi ridge\n  float caustic(vec2 p, float t) {\n    vec2 i = floor(p), f = fract(p);\n    float minD1 = 9.0; float minD2 = 9.0;\n    for (int y = -1; y <= 1; y++) {\n      for (int x = -1; x <= 1; x++) {\n        vec2 g = vec2(float(x), float(y));\n        vec2 o = vec2(\n          fract(sin(dot(i + g, vec2(127.1, 311.7))) * 43758.5453),\n          fract(sin(dot(i + g, vec2(269.5, 183.3))) * 43758.5453)\n        );\n        o = 0.5 + 0.5 * sin(t + 6.28 * o);\n        vec2 r = g + o - f;\n        float d = dot(r, r);\n        if (d < minD1) { minD2 = minD1; minD1 = d; }\n        else if (d < minD2) minD2 = d;\n      }\n    }\n    return sqrt(minD2) - sqrt(minD1);\n  }\n\n  void main() {\n    vec2 p = vUv * causticsScale;\n    float t = uTime * causticsSpeed;\n    float c1 = caustic(p, t);\n    float c2 = caustic(p + 17.3, t * 1.3 + 1.7);\n    float c = pow(min(c1, c2), 1.5) * causticsIntensity;\n\n    vec2 sUv = vUv;\n    if (causticsRefraction > 0.001) {\n      sUv += vec2(c1 - c2, c2 - c1) * causticsRefraction * 0.04;\n    }\n    vec3 src = texture2D(uInput, sUv).rgb;\n\n    vec3 caustColor = vec3(causticsTintR, causticsTintG, causticsTintB) * c;\n    int mode = int(causticsMode + 0.5);\n    vec3 result;\n    if (mode == 0) result = src + caustColor;\n    else if (mode == 1) result = src + caustColor * 1.5;\n    else result = 1.0 - (1.0 - src) * (1.0 - caustColor);\n\n    gl_FragColor = vec4(result, texture2D(uInput, vUv).a);\n  }\n",
    "defaults": {
      "causticsIntensity": 0.6,
      "causticsScale": 8,
      "causticsSpeed": 0.6,
      "causticsRefraction": 0.4,
      "causticsTintR": 0.6,
      "causticsTintG": 0.85,
      "causticsTintB": 1,
      "causticsMode": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "causticsIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Scale",
        "param": "causticsScale",
        "min": 1,
        "max": 32,
        "step": 0.5,
        "default": 8
      },
      {
        "name": "Speed",
        "param": "causticsSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Refraction",
        "param": "causticsRefraction",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Tint R",
        "param": "causticsTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Tint G",
        "param": "causticsTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Tint B",
        "param": "causticsTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Blend",
        "param": "causticsMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Overlay"
          },
          {
            "value": 1,
            "label": "Add"
          },
          {
            "value": 2,
            "label": "Screen"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "shockwave",
    "label": "Shockwave",
    "category": "Advanced Warp",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float shockTriggerTime;   // time when wave was triggered\n  uniform float shockSpeed;         // 0.1-3 expansion speed\n  uniform float shockAmplitude;     // 0-0.2 distortion strength\n  uniform float shockRingWidth;     // 0.01-0.5\n  uniform float shockCenterX;\n  uniform float shockCenterY;\n  uniform float shockChromatic;     // 0-1\n  uniform float shockMode;          // 0=looping continuous, 1=one-shot\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec2 shockOffset(vec2 uv, float waveTime) {\n    vec2 c = vec2(shockCenterX, shockCenterY);\n    vec2 d = uv - c;\n    d.x *= uResolution.x / uResolution.y;\n    float r = length(d);\n    float ringR = waveTime * shockSpeed;\n    float band = smoothstep(shockRingWidth * 0.5, 0.0, abs(r - ringR));\n    vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);\n    dir.x *= uResolution.y / uResolution.x;\n    return dir * band * shockAmplitude;\n  }\n\n  void main() {\n    int mode = int(shockMode + 0.5);\n    float waveTime;\n    if (mode == 0) {\n      // Looping\n      waveTime = mod(uTime, 2.0 / max(0.1, shockSpeed));\n    } else {\n      // One-shot\n      waveTime = max(0.0, uTime - shockTriggerTime);\n    }\n\n    vec2 baseOff = shockOffset(vUv, waveTime);\n    vec3 col;\n    if (shockChromatic > 0.001) {\n      vec2 offR = shockOffset(vUv, waveTime + 0.05 * shockChromatic);\n      vec2 offB = shockOffset(vUv, waveTime - 0.05 * shockChromatic);\n      col.r = texture2D(uInput, vUv + offR).r;\n      col.g = texture2D(uInput, vUv + baseOff).g;\n      col.b = texture2D(uInput, vUv + offB).b;\n    } else {\n      col = texture2D(uInput, vUv + baseOff).rgb;\n    }\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(col, src.a);\n  }\n",
    "defaults": {
      "shockTriggerTime": 0,
      "shockSpeed": 0.6,
      "shockAmplitude": 0.06,
      "shockRingWidth": 0.15,
      "shockCenterX": 0.5,
      "shockCenterY": 0.5,
      "shockChromatic": 0.3,
      "shockMode": 0
    },
    "controls": [
      {
        "name": "Trigger Time",
        "param": "shockTriggerTime",
        "min": 0,
        "max": 999,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Expansion Speed",
        "param": "shockSpeed",
        "min": 0.1,
        "max": 3,
        "step": 0.05,
        "default": 0.6
      },
      {
        "name": "Distortion",
        "param": "shockAmplitude",
        "min": 0,
        "max": 0.2,
        "step": 0.005,
        "default": 0.06
      },
      {
        "name": "Ring Width",
        "param": "shockRingWidth",
        "min": 0.01,
        "max": 0.5,
        "step": 0.01,
        "default": 0.15
      },
      {
        "name": "Center X",
        "param": "shockCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "shockCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Chromatic",
        "param": "shockChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Mode",
        "param": "shockMode",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Looping"
          },
          {
            "value": 1,
            "label": "One-shot"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "drosteRecursive",
    "label": "Droste Recursive",
    "category": "Advanced Warp",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float drosteZoom;          // 1.05-3 per-iteration zoom\n  uniform float drosteRotation;      // 0-360 per-iteration rotation\n  uniform float drosteIterations;    // 1-12\n  uniform float drosteOffsetX;       // 0-1\n  uniform float drosteOffsetY;       // 0-1\n  uniform float drosteFrameSize;     // 0-0.5 mask region as fraction of screen\n  uniform float drosteMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec2 c = vec2(drosteOffsetX, drosteOffsetY);\n    int iters = int(clamp(drosteIterations, 1.0, 12.0));\n    vec2 uv = vUv;\n    float ang = radians(drosteRotation);\n\n    // Iteratively zoom toward c by drosteZoom each time, until uv falls in frame mask\n    for (int i = 0; i < 12; i++) {\n      if (i >= iters) break;\n      vec2 d = uv - c;\n      float r = length(d - 0.5 + c);\n      // If outside frame band, zoom in further\n      if (r > drosteFrameSize) {\n        d *= drosteZoom;\n        // Rotate\n        float ca = cos(ang), sa = sin(ang);\n        d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);\n        uv = c + d;\n      }\n    }\n    uv = clamp(uv, vec2(0.0), vec2(1.0));\n    vec4 src = texture2D(uInput, vUv);\n    vec4 droste = texture2D(uInput, uv);\n    gl_FragColor = vec4(mix(src.rgb, droste.rgb, drosteMix), src.a);\n  }\n",
    "defaults": {
      "drosteZoom": 1.5,
      "drosteRotation": 5,
      "drosteIterations": 6,
      "drosteOffsetX": 0.5,
      "drosteOffsetY": 0.5,
      "drosteFrameSize": 0.4,
      "drosteMix": 1
    },
    "controls": [
      {
        "name": "Per-step Zoom",
        "param": "drosteZoom",
        "min": 1.05,
        "max": 3,
        "step": 0.05,
        "default": 1.5
      },
      {
        "name": "Per-step Rotation",
        "param": "drosteRotation",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 5
      },
      {
        "name": "Iterations",
        "param": "drosteIterations",
        "min": 1,
        "max": 12,
        "step": 1,
        "default": 6
      },
      {
        "name": "Center X",
        "param": "drosteOffsetX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "drosteOffsetY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Frame Size",
        "param": "drosteFrameSize",
        "min": 0.05,
        "max": 0.5,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Mix",
        "param": "drosteMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "slitScan",
    "label": "Slit-Scan",
    "category": "Advanced Warp",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float slitScanIntensity;     // 0-1 displacement amount\n  uniform float slitScanMode;          // 0=horizontal slits, 1=vertical, 2=radial, 3=stretch\n  uniform float slitScanPattern;       // 0=linear sweep, 1=sine, 2=noise\n  uniform float slitScanSpeed;         // 0-3\n  uniform float slitScanChromaSplit;   // 0-1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash11(float n) { return fract(sin(n) * 43758.5453); }\n\n  vec2 slitOffset(vec2 uv, float phaseShift) {\n    int mode = int(slitScanMode + 0.5);\n    int pattern = int(slitScanPattern + 0.5);\n    float coord = (mode == 1) ? uv.x : uv.y;\n    float t = uTime * slitScanSpeed + phaseShift;\n    float p;\n    if (pattern == 0) p = coord + t * 0.3;\n    else if (pattern == 1) p = sin(coord * 8.0 + t * 2.0);\n    else p = (hash11(floor(coord * 50.0) + floor(t * 8.0)) - 0.5) * 2.0;\n    vec2 off = vec2(0.0);\n    if (mode == 0) off.x = p * slitScanIntensity * 0.3;\n    else if (mode == 1) off.y = p * slitScanIntensity * 0.3;\n    else if (mode == 2) {\n      vec2 d = uv - 0.5;\n      float r = length(d);\n      vec2 dir = (r > 0.001) ? d / r : vec2(1.0, 0.0);\n      off = dir * p * slitScanIntensity * 0.3;\n    } else {\n      // Stretch: each row sampled at different progressive UV\n      off.x = (uv.y - 0.5) * slitScanIntensity * 0.5;\n      off.y = sin(t + uv.x * 6.28) * slitScanIntensity * 0.1;\n    }\n    return off;\n  }\n\n  void main() {\n    vec2 baseOff = slitOffset(vUv, 0.0);\n    vec3 col;\n    if (slitScanChromaSplit > 0.001) {\n      vec2 offR = slitOffset(vUv, 0.3 * slitScanChromaSplit);\n      vec2 offB = slitOffset(vUv, -0.3 * slitScanChromaSplit);\n      col.r = texture2D(uInput, vUv + offR).r;\n      col.g = texture2D(uInput, vUv + baseOff).g;\n      col.b = texture2D(uInput, vUv + offB).b;\n    } else {\n      col = texture2D(uInput, vUv + baseOff).rgb;\n    }\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(col, src.a);\n  }\n",
    "defaults": {
      "slitScanIntensity": 0.5,
      "slitScanMode": 0,
      "slitScanPattern": 0,
      "slitScanSpeed": 1,
      "slitScanChromaSplit": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "slitScanIntensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Direction",
        "param": "slitScanMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Horizontal Slits"
          },
          {
            "value": 1,
            "label": "Vertical Slits"
          },
          {
            "value": 2,
            "label": "Radial"
          },
          {
            "value": 3,
            "label": "Stretch"
          }
        ]
      },
      {
        "name": "Pattern",
        "param": "slitScanPattern",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Linear Sweep"
          },
          {
            "value": 1,
            "label": "Sine"
          },
          {
            "value": 2,
            "label": "Noise"
          }
        ]
      },
      {
        "name": "Speed",
        "param": "slitScanSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Chroma Split",
        "param": "slitScanChromaSplit",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "volumetricFogOverlay",
    "label": "Volumetric Fog",
    "category": "Advanced Atmosphere",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float fogDensity;       // 0-1\n  uniform float fogScale;         // 1-32\n  uniform float fogSpeed;         // 0-2\n  uniform float fogHeightFalloff; // -1..1 (positive=sky fog, negative=ground fog)\n  uniform float fogDepthSim;      // 0-1 (use luma as fake depth)\n  uniform float fogColorR;\n  uniform float fogColorG;\n  uniform float fogColorB;\n  uniform float fogTurbulence;    // 0-1\n  uniform float fogMode;          // 0=add, 1=mix, 2=subtract\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float fbm(vec2 p) {\n    float v = 0.0; float amp = 0.5;\n    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }\n    return v;\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (fogDensity < 0.001) { gl_FragColor = src; return; }\n\n    vec2 p = vUv * fogScale + vec2(uTime * fogSpeed * 0.1, -uTime * fogSpeed * 0.05);\n    float fog = fogTurbulence > 0.5 ? fbm(p) : vnoise(p);\n    fog *= fogDensity;\n\n    // Height falloff\n    float heightW = mix(1.0 - vUv.y, vUv.y, (fogHeightFalloff + 1.0) * 0.5);\n    fog *= heightW;\n\n    // Depth-aware: brighter pixels = farther in fog (sim depth from luma)\n    if (fogDepthSim > 0.001) {\n      float fakeDepth = 1.0 - luma(src.rgb);\n      fog *= mix(1.0, fakeDepth, fogDepthSim);\n    }\n\n    fog = clamp(fog, 0.0, 1.0);\n    vec3 fogColor = vec3(fogColorR, fogColorG, fogColorB);\n\n    int mode = int(fogMode + 0.5);\n    vec3 result;\n    if (mode == 0) result = src.rgb + fogColor * fog;\n    else if (mode == 1) result = mix(src.rgb, fogColor, fog);\n    else result = src.rgb - fogColor * fog * 0.5;\n\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);\n  }\n",
    "defaults": {
      "fogDensity": 0.5,
      "fogScale": 6,
      "fogSpeed": 0.5,
      "fogHeightFalloff": -0.3,
      "fogDepthSim": 0.5,
      "fogColorR": 0.85,
      "fogColorG": 0.9,
      "fogColorB": 0.95,
      "fogTurbulence": 1,
      "fogMode": 1
    },
    "controls": [
      {
        "name": "Density",
        "param": "fogDensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Scale",
        "param": "fogScale",
        "min": 1,
        "max": 32,
        "step": 0.5,
        "default": 6
      },
      {
        "name": "Drift Speed",
        "param": "fogSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Height Bias",
        "param": "fogHeightFalloff",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": -0.3
      },
      {
        "name": "Depth Sim",
        "param": "fogDepthSim",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Fog R",
        "param": "fogColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Fog G",
        "param": "fogColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.9
      },
      {
        "name": "Fog B",
        "param": "fogColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Turbulence",
        "param": "fogTurbulence",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Blend",
        "param": "fogMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Add"
          },
          {
            "value": 1,
            "label": "Mix"
          },
          {
            "value": 2,
            "label": "Subtract"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "rainFogSnowOverlay",
    "label": "Rain / Snow",
    "category": "Advanced Atmosphere",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float weatherType;          // 0=rain, 1=snow, 2=mist, 3=embers\n  uniform float weatherDensity;       // 0-1\n  uniform float weatherSpeed;         // 0-3\n  uniform float weatherAngle;         // -45..45 degrees wind\n  uniform float weatherSize;          // 0.5-3 particle size\n  uniform float weatherFog;     // 0-1 fog wash\n  uniform float weatherColorR;\n  uniform float weatherColorG;\n  uniform float weatherColorB;\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    int type = int(weatherType + 0.5);\n\n    vec2 wind = vec2(sin(radians(weatherAngle)), -cos(radians(weatherAngle))); // base downward\n    if (type == 2) wind *= 0.3; // mist drifts\n    if (type == 3) wind *= -0.6; // embers rise\n\n    float t = uTime * weatherSpeed;\n    float scale = (type == 1) ? 80.0 : (type == 2) ? 30.0 : (type == 3) ? 90.0 : 120.0;\n    scale *= 1.0 / max(0.5, weatherSize);\n\n    vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * scale;\n    vec2 cellId = floor(p);\n    float lifeTime = hash21(cellId) * 10.0;\n    float phase = mod(t * 0.5 + lifeTime, 1.0);\n\n    // Particle position within cell, drifted by wind\n    vec2 cellUv = fract(p) - 0.5;\n    cellUv -= wind * phase * 1.5;\n    cellUv = vec2(cellUv.x, fract(cellUv.y + 0.5) - 0.5);\n\n    float d = length(cellUv);\n    float particle = 0.0;\n\n    if (type == 0) {\n      // Rain — vertical streak\n      float streak = smoothstep(0.05, 0.0, abs(cellUv.x)) * smoothstep(0.5, 0.0, abs(cellUv.y));\n      particle = streak;\n    } else if (type == 1) {\n      // Snow — soft circle\n      particle = smoothstep(0.15, 0.0, d);\n    } else if (type == 2) {\n      // Mist — large soft puff\n      particle = smoothstep(0.3, 0.0, d) * 0.5;\n    } else {\n      // Embers — bright dot with glow\n      particle = smoothstep(0.05, 0.0, d) + smoothstep(0.2, 0.05, d) * 0.3;\n    }\n\n    // Spawn probability gated by density\n    float spawn = step(1.0 - weatherDensity, hash21(cellId + 17.0));\n    particle *= spawn;\n\n    vec3 partColor = vec3(weatherColorR, weatherColorG, weatherColorB);\n    vec3 result = src.rgb + partColor * particle;\n\n    // Fog wash\n    if (weatherFog > 0.001) {\n      result = mix(result, partColor * 0.5, weatherFog * 0.4);\n    }\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);\n  }\n",
    "defaults": {
      "weatherType": 0,
      "weatherDensity": 0.5,
      "weatherSpeed": 1,
      "weatherAngle": 10,
      "weatherSize": 1,
      "weatherFog": 0.2,
      "weatherColorR": 0.85,
      "weatherColorG": 0.9,
      "weatherColorB": 1
    },
    "controls": [
      {
        "name": "Type",
        "param": "weatherType",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Rain"
          },
          {
            "value": 1,
            "label": "Snow"
          },
          {
            "value": 2,
            "label": "Mist"
          },
          {
            "value": 3,
            "label": "Embers"
          }
        ]
      },
      {
        "name": "Density",
        "param": "weatherDensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Speed",
        "param": "weatherSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Wind Angle",
        "param": "weatherAngle",
        "min": -45,
        "max": 45,
        "step": 1,
        "default": 10
      },
      {
        "name": "Particle Size",
        "param": "weatherSize",
        "min": 0.5,
        "max": 3,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Fog Wash",
        "param": "weatherFog",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Color R",
        "param": "weatherColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Color G",
        "param": "weatherColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.9
      },
      {
        "name": "Color B",
        "param": "weatherColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "particleOverlayFx",
    "label": "3D Particles",
    "category": "Advanced Atmosphere",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float partMode;          // 0=stars, 1=bokeh, 2=sparkles, 3=fireflies, 4=dust\n  uniform float partDensity;       // 0-1\n  uniform float partSize;          // 0.5-4\n  uniform float partSpeed;         // 0-3\n  uniform float partTwinkle;       // 0-1\n  uniform float partColorR;\n  uniform float partColorG;\n  uniform float partColorB;\n  uniform float partBlend;         // 0=add, 1=screen\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (partDensity < 0.001) { gl_FragColor = src; return; }\n\n    int mode = int(partMode + 0.5);\n    float scale = (mode == 0) ? 60.0 : (mode == 1) ? 25.0 : (mode == 2) ? 80.0 : (mode == 3) ? 35.0 : 100.0;\n    scale *= 1.0 / max(0.5, partSize);\n    vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * scale;\n    vec2 cellId = floor(p);\n    vec2 cellUv = fract(p) - 0.5;\n\n    float spawn = step(1.0 - partDensity, hash21(cellId));\n    if (spawn < 0.5) { gl_FragColor = src; return; }\n\n    // Drift\n    float t = uTime * partSpeed;\n    vec2 drift = vec2(\n      hash21(cellId + 7.3) - 0.5,\n      hash21(cellId + 13.7) - 0.5\n    ) * t * 0.05;\n    cellUv -= drift;\n\n    float d = length(cellUv);\n    float particle = 0.0;\n    if (mode == 0) {\n      // Stars — small bright dot + cross flare\n      particle = smoothstep(0.05, 0.0, d);\n      particle += smoothstep(0.02, 0.0, abs(cellUv.x)) * smoothstep(0.3, 0.0, abs(cellUv.y)) * 0.5;\n      particle += smoothstep(0.02, 0.0, abs(cellUv.y)) * smoothstep(0.3, 0.0, abs(cellUv.x)) * 0.5;\n    } else if (mode == 1) {\n      // Bokeh — soft disc\n      particle = smoothstep(0.4, 0.1, d) * 0.6 + smoothstep(0.45, 0.4, d) * 0.4;\n    } else if (mode == 2) {\n      // Sparkles — bright pinpoint\n      particle = smoothstep(0.04, 0.0, d) * 1.5;\n    } else if (mode == 3) {\n      // Fireflies — flickering soft glow\n      particle = smoothstep(0.15, 0.0, d) * 0.8;\n    } else {\n      // Dust — many tiny specks\n      particle = smoothstep(0.025, 0.0, d) * 0.6;\n    }\n\n    // Twinkle\n    if (partTwinkle > 0.001) {\n      float blink = sin(t * 4.0 + hash21(cellId) * 6.28) * 0.5 + 0.5;\n      particle *= mix(1.0, blink, partTwinkle);\n    }\n\n    vec3 partColor = vec3(partColorR, partColorG, partColorB);\n    int blendMode = int(partBlend + 0.5);\n    vec3 result;\n    if (blendMode == 0) {\n      result = src.rgb + partColor * particle;\n    } else {\n      result = 1.0 - (1.0 - src.rgb) * (1.0 - partColor * particle);\n    }\n    gl_FragColor = vec4(result, src.a);\n  }\n",
    "defaults": {
      "partMode": 0,
      "partDensity": 0.4,
      "partSize": 1,
      "partSpeed": 1,
      "partTwinkle": 0.5,
      "partColorR": 1,
      "partColorG": 1,
      "partColorB": 0.9,
      "partBlend": 0
    },
    "controls": [
      {
        "name": "Type",
        "param": "partMode",
        "min": 0,
        "max": 4,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Stars"
          },
          {
            "value": 1,
            "label": "Bokeh"
          },
          {
            "value": 2,
            "label": "Sparkles"
          },
          {
            "value": 3,
            "label": "Fireflies"
          },
          {
            "value": 4,
            "label": "Dust"
          }
        ]
      },
      {
        "name": "Density",
        "param": "partDensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Size",
        "param": "partSize",
        "min": 0.5,
        "max": 4,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Drift Speed",
        "param": "partSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Twinkle",
        "param": "partTwinkle",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Color R",
        "param": "partColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Color G",
        "param": "partColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Color B",
        "param": "partColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.9
      },
      {
        "name": "Blend",
        "param": "partBlend",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Add"
          },
          {
            "value": 1,
            "label": "Screen"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "glintStarburst",
    "label": "Glint / Starburst",
    "category": "Advanced Atmosphere",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float glintIntensity;     // 0-2\n  uniform float glintThreshold;     // 0-1\n  uniform float glintLength;        // 0-1\n  uniform float glintPoints;        // 4-12 star points\n  uniform float glintRotation;      // 0-360\n  uniform float glintColorR;\n  uniform float glintColorG;\n  uniform float glintColorB;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (glintIntensity < 0.001) { gl_FragColor = src; return; }\n\n    int points = int(clamp(glintPoints, 2.0, 12.0)) * 2;\n    float maxLen = glintLength * 0.15;\n    vec2 texel = 1.0 / uResolution;\n\n    vec3 burst = vec3(0.0);\n    for (int i = 0; i < 24; i++) {\n      if (i >= points) break;\n      float ang = radians(glintRotation) + float(i) * 6.28318 / float(points);\n      vec2 dir = vec2(cos(ang), sin(ang));\n      // March along ray\n      for (int s = 1; s <= 12; s++) {\n        float t = float(s) / 12.0;\n        vec2 sp = vUv + dir * maxLen * t;\n        vec3 sc = texture2D(uInput, sp).rgb;\n        float gate = smoothstep(glintThreshold, glintThreshold + 0.15, luma(sc));\n        burst += sc * gate * (1.0 - t) * (1.0 - t);\n      }\n    }\n    burst /= float(points);\n    burst *= glintIntensity * vec3(glintColorR, glintColorG, glintColorB);\n\n    vec3 result = 1.0 - (1.0 - src.rgb) * (1.0 - burst);\n    gl_FragColor = vec4(result, src.a);\n  }\n",
    "defaults": {
      "glintIntensity": 0.7,
      "glintThreshold": 0.75,
      "glintLength": 0.4,
      "glintPoints": 4,
      "glintRotation": 0,
      "glintColorR": 1,
      "glintColorG": 0.95,
      "glintColorB": 0.85
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "glintIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Threshold",
        "param": "glintThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.75
      },
      {
        "name": "Length",
        "param": "glintLength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Points",
        "param": "glintPoints",
        "min": 4,
        "max": 12,
        "step": 2,
        "default": 4
      },
      {
        "name": "Rotation",
        "param": "glintRotation",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Tint R",
        "param": "glintColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "glintColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Tint B",
        "param": "glintColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      }
    ],
    "integerParams": []
  },
  {
    "type": "embossRelight",
    "label": "Emboss Relight",
    "category": "Advanced Atmosphere",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float embRelStrength;      // 0-3\n  uniform float embRelAngle;         // 0-360\n  uniform float embRelHeight;        // 0-4\n  uniform float embRelDetail;        // 0-2 sample radius\n  uniform float embRelSpecular;      // 0-1\n  uniform float embRelColorPreserve; // 0-1\n  uniform float embRelAmbient;       // 0-1 base brightness\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec2 texel = 1.0 / uResolution;\n    float d = max(1.0, embRelDetail);\n\n    // Build height field from high-pass filter\n    vec3 c = texture2D(uInput, vUv).rgb;\n    vec3 ll = texture2D(uInput, vUv + texel * vec2(-d, 0)).rgb;\n    vec3 rr = texture2D(uInput, vUv + texel * vec2( d, 0)).rgb;\n    vec3 tt = texture2D(uInput, vUv + texel * vec2( 0, d)).rgb;\n    vec3 bb = texture2D(uInput, vUv + texel * vec2( 0,-d)).rgb;\n\n    float h0 = luma(c);\n    float gx = (luma(rr) - luma(ll)) * embRelHeight;\n    float gy = (luma(tt) - luma(bb)) * embRelHeight;\n\n    // Surface normal\n    vec3 N = normalize(vec3(-gx, -gy, 1.0));\n    float ang = radians(embRelAngle);\n    vec3 L = normalize(vec3(cos(ang), sin(ang), 0.7));\n    float diff = max(0.0, dot(N, L));\n    vec3 V = vec3(0.0, 0.0, 1.0);\n    vec3 H = normalize(L + V);\n    float spec = pow(max(0.0, dot(N, H)), 32.0) * embRelSpecular;\n\n    float lit = embRelAmbient + diff * embRelStrength + spec;\n    vec3 surfaceColor = mix(vec3(h0), c, embRelColorPreserve);\n    vec3 result = surfaceColor * lit;\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "embRelStrength": 1,
      "embRelAngle": 135,
      "embRelHeight": 1,
      "embRelDetail": 1,
      "embRelSpecular": 0.3,
      "embRelColorPreserve": 0.5,
      "embRelAmbient": 0.3
    },
    "controls": [
      {
        "name": "Strength",
        "param": "embRelStrength",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Light Angle",
        "param": "embRelAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 135
      },
      {
        "name": "Height",
        "param": "embRelHeight",
        "min": 0,
        "max": 4,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Detail Radius",
        "param": "embRelDetail",
        "min": 0,
        "max": 2,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Specular",
        "param": "embRelSpecular",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Color Preserve",
        "param": "embRelColorPreserve",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Ambient",
        "param": "embRelAmbient",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      }
    ],
    "integerParams": []
  },
  {
    "type": "dotMatrix",
    "label": "Dot Matrix",
    "category": "Advanced Text & Pattern",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float dmDotSize;       // 4-32\n  uniform float dmDotShape;      // 0=circle, 1=square, 2=hex\n  uniform float dmGap;           // 0-1 gap between dots\n  uniform float dmPosterize;     // 1-8 quantize per channel\n  uniform float dmGlow;          // 0-1\n  uniform float dmBgR;\n  uniform float dmBgG;\n  uniform float dmBgB;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec2 cell = floor(vUv * uResolution / dmDotSize);\n    vec2 cellOrigin = cell * dmDotSize / uResolution;\n    vec2 cellSize = vec2(dmDotSize) / uResolution;\n    vec2 cellUv = (vUv - cellOrigin) / cellSize - 0.5;\n\n    int shape = int(dmDotShape + 0.5);\n    float dotR = mix(0.45, 0.5 - dmGap * 0.5, 0.5);\n    float mask;\n    if (shape == 0) {\n      mask = smoothstep(dotR + 0.05, dotR - 0.05, length(cellUv));\n    } else if (shape == 1) {\n      vec2 ad = abs(cellUv);\n      mask = smoothstep(dotR + 0.02, dotR - 0.02, max(ad.x, ad.y));\n    } else {\n      // Hex\n      vec2 ad = abs(cellUv);\n      float hex = max(ad.x * 0.866 + ad.y * 0.5, ad.y);\n      mask = smoothstep(dotR + 0.02, dotR - 0.02, hex);\n    }\n\n    vec3 sampleCol = texture2D(uInput, cellOrigin + cellSize * 0.5).rgb;\n    if (dmPosterize > 1.001) {\n      float steps = max(1.0, dmPosterize);\n      sampleCol = floor(sampleCol * steps + 0.5) / steps;\n    }\n\n    vec3 bg = vec3(dmBgR, dmBgG, dmBgB);\n    vec3 result = mix(bg, sampleCol, mask);\n\n    // Glow halo\n    if (dmGlow > 0.001) {\n      float halo = smoothstep(0.7, 0.45, length(cellUv));\n      result += sampleCol * halo * dmGlow * 0.4;\n    }\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "dmDotSize": 12,
      "dmDotShape": 0,
      "dmGap": 0.2,
      "dmPosterize": 4,
      "dmGlow": 0.4,
      "dmBgR": 0,
      "dmBgG": 0,
      "dmBgB": 0
    },
    "controls": [
      {
        "name": "Dot Size",
        "param": "dmDotSize",
        "min": 4,
        "max": 32,
        "step": 1,
        "default": 12
      },
      {
        "name": "Shape",
        "param": "dmDotShape",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Circle"
          },
          {
            "value": 1,
            "label": "Square"
          },
          {
            "value": 2,
            "label": "Hex"
          }
        ]
      },
      {
        "name": "Gap",
        "param": "dmGap",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Posterize",
        "param": "dmPosterize",
        "min": 1,
        "max": 8,
        "step": 1,
        "default": 4
      },
      {
        "name": "Glow",
        "param": "dmGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "BG R",
        "param": "dmBgR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "BG G",
        "param": "dmBgG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "BG B",
        "param": "dmBgB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "matrixRain",
    "label": "Matrix Rain",
    "category": "Advanced Text & Pattern",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float matrixDensity;       // 0-1\n  uniform float matrixSpeed;         // 0-3\n  uniform float matrixCellSize;      // 6-32\n  uniform float matrixTrailLength;   // 0-1\n  uniform float matrixColorR;\n  uniform float matrixColorG;\n  uniform float matrixColorB;\n  uniform float matrixBgMix;         // 0-1 keep underlying frame\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  // Fake glyph: bit pattern within sub-grid\n  float glyph(vec2 cellUv, float seed) {\n    vec2 g = floor(cellUv * 5.0);\n    float bit = hash21(g + seed * 13.0);\n    return step(0.55, bit);\n  }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n\n    vec2 px = vUv * uResolution / matrixCellSize;\n    vec2 col = floor(px);\n    vec2 cellUv = fract(px);\n    // Column-specific speed and seed\n    float colSeed = hash21(vec2(col.x, 0.0));\n    float fallSpeed = (0.5 + colSeed * 1.5) * matrixSpeed;\n    float trailHead = mod(uTime * fallSpeed - colSeed * 50.0, uResolution.y / matrixCellSize + 30.0);\n    float dist = trailHead - col.y;\n\n    float trailLen = max(2.0, matrixTrailLength * 30.0);\n    float intensity = 0.0;\n    if (dist > 0.0 && dist < trailLen) {\n      intensity = (1.0 - dist / trailLen);\n      intensity *= step(1.0 - matrixDensity, hash21(col + floor(uTime * fallSpeed * 0.05)));\n    }\n    if (dist >= 0.0 && dist < 1.0) intensity = 1.5; // bright head\n\n    // Glyph mask (changes over time for rain feel)\n    float glyphSeed = hash21(col + floor(uTime * fallSpeed * 0.5 + col.y * 0.1));\n    float gMask = glyph(cellUv, glyphSeed);\n\n    vec3 rainColor = vec3(matrixColorR, matrixColorG, matrixColorB) * intensity * gMask;\n    vec3 result = mix(rainColor, src + rainColor, matrixBgMix);\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "matrixDensity": 0.6,
      "matrixSpeed": 1,
      "matrixCellSize": 14,
      "matrixTrailLength": 0.5,
      "matrixColorR": 0,
      "matrixColorG": 1,
      "matrixColorB": 0.4,
      "matrixBgMix": 0.5
    },
    "controls": [
      {
        "name": "Density",
        "param": "matrixDensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Fall Speed",
        "param": "matrixSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Cell Size",
        "param": "matrixCellSize",
        "min": 6,
        "max": 32,
        "step": 1,
        "default": 14
      },
      {
        "name": "Trail Length",
        "param": "matrixTrailLength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Color R",
        "param": "matrixColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Color G",
        "param": "matrixColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Color B",
        "param": "matrixColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "BG Mix",
        "param": "matrixBgMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      }
    ],
    "integerParams": []
  },
  {
    "type": "binaryCode",
    "label": "Binary Code",
    "category": "Advanced Text & Pattern",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float binDensity;       // 0-1\n  uniform float binSpeed;         // 0-3\n  uniform float binCellSize;      // 6-32\n  uniform float binColorR;\n  uniform float binColorG;\n  uniform float binColorB;\n  uniform float binBgMix;         // 0-1\n  uniform float binContrast;      // 0-2 source pixel modulates char visibility\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  // Crude '0' / '1' mask\n  float charZero(vec2 uv) {\n    vec2 c = uv - 0.5;\n    float r = length(c * vec2(1.0, 0.7));\n    return smoothstep(0.42, 0.38, r) - smoothstep(0.30, 0.26, r);\n  }\n  float charOne(vec2 uv) {\n    vec2 c = uv - 0.5;\n    float bar = step(abs(c.x + 0.05), 0.05) * step(abs(c.y), 0.4);\n    float foot = step(abs(c.y + 0.4), 0.05) * step(abs(c.x), 0.2);\n    return max(bar, foot);\n  }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec2 px = vUv * uResolution / binCellSize;\n    vec2 col = floor(px);\n    vec2 cellUv = fract(px);\n    float t = uTime * binSpeed;\n    // Each column scrolls up at its own speed\n    float colSeed = hash21(vec2(col.x, 0.0));\n    float yOff = floor(t + colSeed * 50.0);\n    float charSeed = hash21(vec2(col.x, col.y + yOff));\n    float bit = step(0.5, charSeed);\n\n    float charMask = bit > 0.5 ? charOne(cellUv) : charZero(cellUv);\n    float spawn = step(1.0 - binDensity, hash21(col + yOff * 0.137));\n    charMask *= spawn;\n    // Tie character brightness to underlying source luma\n    float srcL = luma(texture2D(uInput, (col + 0.5) * binCellSize / uResolution).rgb);\n    charMask *= mix(1.0, srcL, binContrast * 0.5);\n\n    vec3 charColor = vec3(binColorR, binColorG, binColorB) * charMask;\n    vec3 result = mix(charColor, src + charColor, binBgMix);\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "binDensity": 0.7,
      "binSpeed": 0.5,
      "binCellSize": 12,
      "binColorR": 0,
      "binColorG": 1,
      "binColorB": 0.3,
      "binBgMix": 0.5,
      "binContrast": 1
    },
    "controls": [
      {
        "name": "Density",
        "param": "binDensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Scroll Speed",
        "param": "binSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Cell Size",
        "param": "binCellSize",
        "min": 6,
        "max": 32,
        "step": 1,
        "default": 12
      },
      {
        "name": "Color R",
        "param": "binColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Color G",
        "param": "binColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Color B",
        "param": "binColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "BG Mix",
        "param": "binBgMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Source Contrast",
        "param": "binContrast",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "crosshatch",
    "label": "Crosshatch",
    "category": "Advanced Text & Pattern",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float hatchDensity;       // 0-1\n  uniform float hatchAngle;         // 0-180\n  uniform float hatchLineWidth;     // 0.5-4\n  uniform float hatchContrast;      // 0-2\n  uniform float hatchPaperR;\n  uniform float hatchPaperG;\n  uniform float hatchPaperB;\n  uniform float hatchInkR;\n  uniform float hatchInkG;\n  uniform float hatchInkB;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  float hatchLine(vec2 uv, float ang, float spacing, float width) {\n    float c = cos(ang); float s = sin(ang);\n    float v = uv.x * c + uv.y * s;\n    return smoothstep(width, width * 0.5, abs(fract(v / spacing) - 0.5));\n  }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    float l = luma(src);\n    l = clamp((l - 0.5) * hatchContrast + 0.5, 0.0, 1.0);\n\n    vec2 px = vUv * uResolution;\n    float spacing = 8.0 / hatchDensity;\n    float w = 0.5 / spacing * max(0.5, hatchLineWidth);\n    float baseAng = radians(hatchAngle);\n\n    // Build cross-hatching\n    float h = 0.0;\n    if (l < 0.85) h = max(h, hatchLine(px, baseAng,            spacing,       w));\n    if (l < 0.65) h = max(h, hatchLine(px, baseAng + 1.5708,   spacing * 0.9, w));\n    if (l < 0.45) h = max(h, hatchLine(px, baseAng + 0.7854,   spacing * 0.8, w));\n    if (l < 0.25) h = max(h, hatchLine(px, baseAng + 2.3562,   spacing * 0.7, w));\n\n    vec3 paper = vec3(hatchPaperR, hatchPaperG, hatchPaperB);\n    vec3 ink = vec3(hatchInkR, hatchInkG, hatchInkB);\n    vec3 result = mix(paper, ink, h);\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "hatchDensity": 1,
      "hatchAngle": 30,
      "hatchLineWidth": 1,
      "hatchContrast": 1,
      "hatchPaperR": 0.95,
      "hatchPaperG": 0.93,
      "hatchPaperB": 0.88,
      "hatchInkR": 0.1,
      "hatchInkG": 0.1,
      "hatchInkB": 0.1
    },
    "controls": [
      {
        "name": "Density",
        "param": "hatchDensity",
        "min": 0.1,
        "max": 2,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Angle",
        "param": "hatchAngle",
        "min": 0,
        "max": 180,
        "step": 1,
        "default": 30
      },
      {
        "name": "Line Width",
        "param": "hatchLineWidth",
        "min": 0.5,
        "max": 4,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Contrast",
        "param": "hatchContrast",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Paper R",
        "param": "hatchPaperR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Paper G",
        "param": "hatchPaperG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.93
      },
      {
        "name": "Paper B",
        "param": "hatchPaperB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.88
      },
      {
        "name": "Ink R",
        "param": "hatchInkR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      },
      {
        "name": "Ink G",
        "param": "hatchInkG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      },
      {
        "name": "Ink B",
        "param": "hatchInkB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      }
    ],
    "integerParams": []
  },
  {
    "type": "blockMosaic",
    "label": "Block Mosaic",
    "category": "Advanced Text & Pattern",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float mosaicTileSize;      // 8-64\n  uniform float mosaicMode;          // 0=square, 1=voronoi, 2=hex, 3=brick\n  uniform float mosaicGrout;         // 0-1\n  uniform float mosaicColorJitter;   // 0-1\n  uniform float mosaicGroutR;\n  uniform float mosaicGroutG;\n  uniform float mosaicGroutB;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  void main() {\n    int mode = int(mosaicMode + 0.5);\n    vec2 px = vUv * uResolution / mosaicTileSize;\n    vec2 cell;\n    vec2 cellUv;\n    if (mode == 0) {\n      cell = floor(px);\n      cellUv = fract(px) - 0.5;\n    } else if (mode == 1) {\n      vec2 i = floor(px);\n      vec2 f = fract(px);\n      vec2 best = vec2(0.0);\n      float minD = 9.0;\n      for (int y = -1; y <= 1; y++) {\n        for (int x = -1; x <= 1; x++) {\n          vec2 g = vec2(float(x), float(y));\n          vec2 o = vec2(hash21(i + g), hash21(i + g + 13.7));\n          vec2 r = g + o - f;\n          float d = dot(r, r);\n          if (d < minD) { minD = d; best = i + g; cellUv = r; }\n        }\n      }\n      cell = best;\n    } else if (mode == 2) {\n      // Hex\n      vec2 q = vec2(px.x * 1.1547, px.y);\n      q.x += 0.5 * floor(q.y);\n      vec2 i = floor(q);\n      cell = vec2(i.x - floor(i.y / 2.0), i.y);\n      cellUv = fract(q) - 0.5;\n    } else {\n      // Brick\n      vec2 q = px;\n      float row = floor(q.y);\n      q.x += mod(row, 2.0) * 0.5;\n      cell = vec2(floor(q.x), row);\n      cellUv = fract(q) - 0.5;\n    }\n\n    vec2 cellCenter = (cell + 0.5) * mosaicTileSize / uResolution;\n    vec3 tileCol = texture2D(uInput, cellCenter).rgb;\n\n    // Grout band\n    float dist = (mode == 1) ? sqrt(length(cellUv)) : max(abs(cellUv.x), abs(cellUv.y));\n    float grout = step(0.5 - mosaicGrout * 0.5, dist);\n\n    // Color jitter\n    if (mosaicColorJitter > 0.001) {\n      vec3 j = vec3(hash21(cell), hash21(cell + 7.3), hash21(cell + 13.7)) - 0.5;\n      tileCol += j * mosaicColorJitter * 0.4;\n    }\n    vec3 groutCol = vec3(mosaicGroutR, mosaicGroutG, mosaicGroutB);\n    vec3 result = mix(tileCol, groutCol, grout);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "mosaicTileSize": 24,
      "mosaicMode": 0,
      "mosaicGrout": 0.15,
      "mosaicColorJitter": 0.1,
      "mosaicGroutR": 0.1,
      "mosaicGroutG": 0.1,
      "mosaicGroutB": 0.1
    },
    "controls": [
      {
        "name": "Tile Size",
        "param": "mosaicTileSize",
        "min": 8,
        "max": 64,
        "step": 1,
        "default": 24
      },
      {
        "name": "Pattern",
        "param": "mosaicMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Square"
          },
          {
            "value": 1,
            "label": "Voronoi"
          },
          {
            "value": 2,
            "label": "Hex"
          },
          {
            "value": 3,
            "label": "Brick"
          }
        ]
      },
      {
        "name": "Grout",
        "param": "mosaicGrout",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.15
      },
      {
        "name": "Color Jitter",
        "param": "mosaicColorJitter",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      },
      {
        "name": "Grout R",
        "param": "mosaicGroutR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      },
      {
        "name": "Grout G",
        "param": "mosaicGroutG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      },
      {
        "name": "Grout B",
        "param": "mosaicGroutB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      }
    ],
    "integerParams": []
  },
  {
    "type": "tunnelFlight",
    "label": "Tunnel Flight",
    "category": "Advanced Depth",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float tunnelSpeed;         // 0-3\n  uniform float tunnelTwist;         // 0-3\n  uniform float tunnelDepth;   // 0.5-3\n  uniform float tunnelCenterX;\n  uniform float tunnelCenterY;\n  uniform float tunnelMode;          // 0=cylinder, 1=funnel, 2=square\n  uniform float tunnelChromatic;     // 0-1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec2 tunnelMap(vec2 uv, float zOffset) {\n    int mode = int(tunnelMode + 0.5);\n    vec2 c = vec2(tunnelCenterX, tunnelCenterY);\n    vec2 d = uv - c;\n    d.x *= uResolution.x / uResolution.y;\n    float r = length(d);\n    float a = atan(d.y, d.x);\n    a += tunnelTwist * (uTime * tunnelSpeed * 0.5);\n    float depthScale = (mode == 1) ? r * tunnelDepth : tunnelDepth;\n    float z = (uTime * tunnelSpeed + zOffset) / max(0.05, r * depthScale);\n    if (mode == 2) {\n      // Square cross-section\n      vec2 sq = abs(d);\n      float side = max(sq.x, sq.y);\n      r = side;\n      z = (uTime * tunnelSpeed + zOffset) / max(0.05, r);\n    }\n    vec2 sUv = vec2(a / 6.28318 + 0.5, fract(z));\n    return sUv;\n  }\n\n  void main() {\n    vec2 baseUv = tunnelMap(vUv, 0.0);\n    vec3 col;\n    if (tunnelChromatic > 0.001) {\n      vec2 uvR = tunnelMap(vUv, 0.05 * tunnelChromatic);\n      vec2 uvB = tunnelMap(vUv, -0.05 * tunnelChromatic);\n      col.r = texture2D(uInput, uvR).r;\n      col.g = texture2D(uInput, baseUv).g;\n      col.b = texture2D(uInput, uvB).b;\n    } else {\n      col = texture2D(uInput, baseUv).rgb;\n    }\n    // Darken at far end\n    vec2 c = vec2(tunnelCenterX, tunnelCenterY);\n    float r = length(vUv - c);\n    float fade = smoothstep(0.0, 0.7, r);\n    col *= fade;\n    gl_FragColor = vec4(col, 1.0);\n  }\n",
    "defaults": {
      "tunnelSpeed": 1,
      "tunnelTwist": 0.5,
      "tunnelDepth": 1.5,
      "tunnelCenterX": 0.5,
      "tunnelCenterY": 0.5,
      "tunnelMode": 0,
      "tunnelChromatic": 0.2
    },
    "controls": [
      {
        "name": "Flight Speed",
        "param": "tunnelSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Twist",
        "param": "tunnelTwist",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Depth",
        "param": "tunnelDepth",
        "min": 0.5,
        "max": 3,
        "step": 0.05,
        "default": 1.5
      },
      {
        "name": "Center X",
        "param": "tunnelCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "tunnelCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Cross-section",
        "param": "tunnelMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Cylinder"
          },
          {
            "value": 1,
            "label": "Funnel"
          },
          {
            "value": 2,
            "label": "Square"
          }
        ]
      },
      {
        "name": "Chromatic",
        "param": "tunnelChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      }
    ],
    "integerParams": []
  },
  {
    "type": "infiniteMirror",
    "label": "Infinite Mirror",
    "category": "Advanced Depth",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float infMirrorIterations;    // 1-12\n  uniform float infMirrorShrink;        // 0.5-0.95 per-iter shrink\n  uniform float infMirrorRotation;      // 0-360 per-iter\n  uniform float infMirrorTintFade;      // 0-1\n  uniform float infMirrorHueShift;      // 0-1 per-iter\n  uniform float infMirrorMode;          // 0=center, 1=offset\n  uniform float infMirrorOffsetX;\n  uniform float infMirrorOffsetY;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n  vec3 rgb2hsv(vec3 c) {\n    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);\n    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n    float d = q.x - min(q.w, q.y);\n    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);\n  }\n\n  void main() {\n    int iters = int(clamp(infMirrorIterations, 1.0, 12.0));\n    int mode = int(infMirrorMode + 0.5);\n    vec2 c = (mode == 1) ? vec2(infMirrorOffsetX, infMirrorOffsetY) : vec2(0.5);\n    vec3 acc = vec3(0.0);\n    float weight = 0.0;\n    float ang = radians(infMirrorRotation);\n    float ca = cos(ang), sa = sin(ang);\n    float scale = 1.0;\n    float hueOff = 0.0;\n    float tint = 1.0;\n\n    for (int i = 0; i < 12; i++) {\n      if (i >= iters) break;\n      vec2 d = (vUv - c) / scale;\n      d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);\n      vec2 sUv = c + d;\n      sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n      vec3 sCol = texture2D(uInput, sUv).rgb;\n      if (infMirrorHueShift > 0.001) {\n        vec3 hsv = rgb2hsv(sCol);\n        hsv.x = fract(hsv.x + hueOff);\n        sCol = hsv2rgb(hsv);\n      }\n      acc += sCol * tint;\n      weight += tint;\n      scale *= infMirrorShrink;\n      hueOff += infMirrorHueShift;\n      tint *= 1.0 - infMirrorTintFade * 0.5;\n    }\n    vec3 result = acc / max(weight, 0.0001);\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "infMirrorIterations": 5,
      "infMirrorShrink": 0.8,
      "infMirrorRotation": 5,
      "infMirrorTintFade": 0.4,
      "infMirrorHueShift": 0.05,
      "infMirrorMode": 0,
      "infMirrorOffsetX": 0.5,
      "infMirrorOffsetY": 0.5
    },
    "controls": [
      {
        "name": "Iterations",
        "param": "infMirrorIterations",
        "min": 1,
        "max": 12,
        "step": 1,
        "default": 5
      },
      {
        "name": "Shrink / Step",
        "param": "infMirrorShrink",
        "min": 0.5,
        "max": 0.95,
        "step": 0.01,
        "default": 0.8
      },
      {
        "name": "Rotation / Step",
        "param": "infMirrorRotation",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 5
      },
      {
        "name": "Tint Fade",
        "param": "infMirrorTintFade",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Hue Shift / Step",
        "param": "infMirrorHueShift",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.05
      },
      {
        "name": "Mode",
        "param": "infMirrorMode",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Center"
          },
          {
            "value": 1,
            "label": "Off-center"
          }
        ]
      },
      {
        "name": "Offset X",
        "param": "infMirrorOffsetX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Offset Y",
        "param": "infMirrorOffsetY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      }
    ],
    "integerParams": []
  },
  {
    "type": "fractalWarp",
    "label": "Fractal Warp",
    "category": "Advanced Warp",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float fractalWarpAmount;        // 0-1\n  uniform float fractalWarpScale;         // 0.5-16\n  uniform float fractalWarpOctaves;       // 2-6\n  uniform float fractalWarpSpeed;         // 0-3\n  uniform float fractalWarpChromatic;     // 0-1\n  uniform float fractalWarpMode;          // 0=fbm, 1=ridged, 2=hybrid\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float fbm(vec2 p, int oct) {\n    float v = 0.0; float amp = 0.5;\n    for (int i = 0; i < 6; i++) {\n      if (i >= oct) break;\n      v += vnoise(p) * amp; p *= 2.0; amp *= 0.5;\n    }\n    return v;\n  }\n  float ridged(vec2 p, int oct) {\n    float v = 0.0; float amp = 0.5;\n    for (int i = 0; i < 6; i++) {\n      if (i >= oct) break;\n      v += (1.0 - abs(vnoise(p) - 0.5) * 2.0) * amp; p *= 2.0; amp *= 0.5;\n    }\n    return v;\n  }\n\n  vec2 warpOffset(vec2 uv, float t, float chromaShift) {\n    int oct = int(clamp(fractalWarpOctaves, 1.0, 6.0));\n    int mode = int(fractalWarpMode + 0.5);\n    vec2 p = uv * fractalWarpScale + t + chromaShift;\n    float nx, ny;\n    if (mode == 0) {\n      nx = fbm(p, oct) - 0.5;\n      ny = fbm(p + 31.7, oct) - 0.5;\n    } else if (mode == 1) {\n      nx = ridged(p, oct) - 0.5;\n      ny = ridged(p + 31.7, oct) - 0.5;\n    } else {\n      nx = (fbm(p, oct) + ridged(p, oct)) * 0.5 - 0.5;\n      ny = (fbm(p + 31.7, oct) + ridged(p + 31.7, oct)) * 0.5 - 0.5;\n    }\n    return vec2(nx, ny) * fractalWarpAmount * 0.1;\n  }\n\n  void main() {\n    float t = uTime * fractalWarpSpeed * 0.2;\n    vec2 baseOff = warpOffset(vUv, t, 0.0);\n    vec3 col;\n    if (fractalWarpChromatic > 0.001) {\n      vec2 offR = warpOffset(vUv, t, fractalWarpChromatic * 0.5);\n      vec2 offB = warpOffset(vUv, t, -fractalWarpChromatic * 0.5);\n      col.r = texture2D(uInput, vUv + offR).r;\n      col.g = texture2D(uInput, vUv + baseOff).g;\n      col.b = texture2D(uInput, vUv + offB).b;\n    } else {\n      col = texture2D(uInput, vUv + baseOff).rgb;\n    }\n    vec4 src = texture2D(uInput, vUv);\n    gl_FragColor = vec4(col, src.a);\n  }\n",
    "defaults": {
      "fractalWarpAmount": 0.5,
      "fractalWarpScale": 4,
      "fractalWarpOctaves": 4,
      "fractalWarpSpeed": 0.7,
      "fractalWarpChromatic": 0.2,
      "fractalWarpMode": 0
    },
    "controls": [
      {
        "name": "Distortion",
        "param": "fractalWarpAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Scale",
        "param": "fractalWarpScale",
        "min": 0.5,
        "max": 16,
        "step": 0.25,
        "default": 4
      },
      {
        "name": "Octaves",
        "param": "fractalWarpOctaves",
        "min": 1,
        "max": 6,
        "step": 1,
        "default": 4
      },
      {
        "name": "Speed",
        "param": "fractalWarpSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Chromatic",
        "param": "fractalWarpChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Noise",
        "param": "fractalWarpMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "fBm"
          },
          {
            "value": 1,
            "label": "Ridged"
          },
          {
            "value": 2,
            "label": "Hybrid"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "crystalRefract",
    "label": "Crystal Refract",
    "category": "Advanced Depth",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float crystalScale;         // 1-16\n  uniform float crystalRefraction;    // 0-1 displacement\n  uniform float crystalSparkle;       // 0-1\n  uniform float crystalEdgeGlow;      // 0-1\n  uniform float crystalTintR;\n  uniform float crystalTintG;\n  uniform float crystalTintB;\n  uniform float crystalMode;          // 0=voronoi, 1=hex\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  void main() {\n    int mode = int(crystalMode + 0.5);\n    vec2 p = vUv * crystalScale;\n    vec2 cellCenter; float minD = 9.0; float secondD = 9.0;\n\n    if (mode == 0) {\n      vec2 i = floor(p), f = fract(p);\n      vec2 best = vec2(0.0);\n      for (int y = -1; y <= 1; y++) {\n        for (int x = -1; x <= 1; x++) {\n          vec2 g = vec2(float(x), float(y));\n          vec2 o = vec2(hash21(i + g), hash21(i + g + 13.7));\n          // Slight time wobble\n          o = 0.5 + 0.45 * sin(uTime * 0.4 + 6.28 * o);\n          vec2 r = g + o - f;\n          float d = dot(r, r);\n          if (d < minD) { secondD = minD; minD = d; best = i + g; }\n          else if (d < secondD) secondD = d;\n        }\n      }\n      cellCenter = (best + 0.5) / crystalScale;\n    } else {\n      // Hex\n      vec2 q = vec2(p.x * 1.1547, p.y); q.x += 0.5 * floor(q.y);\n      vec2 i = floor(q);\n      cellCenter = (vec2(i.x - floor(i.y / 2.0), i.y) + 0.5) / vec2(crystalScale * 1.1547, crystalScale);\n      vec2 f = fract(q) - 0.5;\n      minD = dot(f, f);\n      secondD = minD + 0.3;\n    }\n\n    // Refraction: displace toward cell center\n    vec2 dir = vUv - cellCenter;\n    vec2 sUv = vUv - dir * crystalRefraction;\n    sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n    vec3 col = texture2D(uInput, sUv).rgb;\n\n    // Edge glow (where two cells meet)\n    float edge = smoothstep(0.04, 0.0, sqrt(secondD) - sqrt(minD));\n    col += vec3(crystalTintR, crystalTintG, crystalTintB) * edge * crystalEdgeGlow;\n\n    // Sparkle: bright dot at random cell centers\n    if (crystalSparkle > 0.001) {\n      float dCenter = length(vUv - cellCenter);\n      float spark = step(1.0 - crystalSparkle * 0.3, hash21(floor(cellCenter * 100.0)));\n      col += vec3(1.0) * smoothstep(0.04, 0.0, dCenter) * spark * crystalSparkle;\n    }\n    gl_FragColor = vec4(col, 1.0);\n  }\n",
    "defaults": {
      "crystalScale": 6,
      "crystalRefraction": 0.4,
      "crystalSparkle": 0.4,
      "crystalEdgeGlow": 0.5,
      "crystalTintR": 0.85,
      "crystalTintG": 0.95,
      "crystalTintB": 1,
      "crystalMode": 0
    },
    "controls": [
      {
        "name": "Cell Scale",
        "param": "crystalScale",
        "min": 1,
        "max": 16,
        "step": 0.5,
        "default": 6
      },
      {
        "name": "Refraction",
        "param": "crystalRefraction",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Sparkle",
        "param": "crystalSparkle",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Edge Glow",
        "param": "crystalEdgeGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Edge R",
        "param": "crystalTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Edge G",
        "param": "crystalTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Edge B",
        "param": "crystalTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Cells",
        "param": "crystalMode",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Voronoi"
          },
          {
            "value": 1,
            "label": "Hex"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "fluidDistort",
    "label": "Fluid Distort",
    "category": "Advanced Warp",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float fluidDistAmount;        // 0-1\n  uniform float fluidDistScale;         // 1-16\n  uniform float fluidDistSpeed;         // 0-3\n  uniform float fluidDistTurbulence;    // 0-1\n  uniform float fluidDistMode;          // 0=swirl, 1=push, 2=oil\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n\n  vec2 curl(vec2 p) {\n    float e = 0.05;\n    float n1 = vnoise(p + vec2(0, e));\n    float n2 = vnoise(p - vec2(0, e));\n    float n3 = vnoise(p + vec2(e, 0));\n    float n4 = vnoise(p - vec2(e, 0));\n    return vec2(n1 - n2, -(n3 - n4));\n  }\n\n  void main() {\n    vec2 p = vUv * fluidDistScale + uTime * fluidDistSpeed * 0.1;\n    vec2 c = curl(p);\n    if (fluidDistTurbulence > 0.001) c += curl(p * 2.0 + 13.7) * fluidDistTurbulence * 0.5;\n\n    int mode = int(fluidDistMode + 0.5);\n    vec2 off;\n    if (mode == 0) off = c * fluidDistAmount * 0.1;\n    else if (mode == 1) {\n      vec2 d = vUv - 0.5;\n      off = (c + normalize(d + 1e-6) * 0.3) * fluidDistAmount * 0.08;\n    } else {\n      // Oil — strong, clamped to range\n      off = clamp(c, vec2(-0.5), vec2(0.5)) * fluidDistAmount * 0.15;\n    }\n\n    vec4 col = texture2D(uInput, vUv + off);\n    gl_FragColor = col;\n  }\n",
    "defaults": {
      "fluidDistAmount": 0.5,
      "fluidDistScale": 4,
      "fluidDistSpeed": 0.8,
      "fluidDistTurbulence": 0.5,
      "fluidDistMode": 0
    },
    "controls": [
      {
        "name": "Distortion",
        "param": "fluidDistAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Scale",
        "param": "fluidDistScale",
        "min": 1,
        "max": 16,
        "step": 0.25,
        "default": 4
      },
      {
        "name": "Speed",
        "param": "fluidDistSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.8
      },
      {
        "name": "Turbulence",
        "param": "fluidDistTurbulence",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Mode",
        "param": "fluidDistMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Swirl"
          },
          {
            "value": 1,
            "label": "Push"
          },
          {
            "value": 2,
            "label": "Oil"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "wormhole",
    "label": "Wormhole",
    "category": "Advanced Warp",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float wormholePullStrength;  // 0-1\n  uniform float wormholeRotation;      // 0-3 rotation per radius\n  uniform float wormholeCenterX;\n  uniform float wormholeCenterY;\n  uniform float wormholeTwist;         // 0-3\n  uniform float wormholeChromatic;     // 0-1\n  uniform float uTime;\n  uniform float wormholeAnimSpeed;     // 0-2\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec2 wormholeMap(vec2 uv, float chromaShift) {\n    vec2 c = vec2(wormholeCenterX, wormholeCenterY);\n    vec2 d = uv - c;\n    d.x *= uResolution.x / uResolution.y;\n    float r = length(d);\n    float ang = atan(d.y, d.x);\n    // Twist proportional to inverse radius\n    ang += wormholeTwist / max(0.05, r) + uTime * wormholeAnimSpeed * 0.3 + chromaShift;\n    // Pull toward center\n    r *= mix(1.0, 0.5 + 0.5 * (r * r), wormholePullStrength);\n    d = vec2(cos(ang), sin(ang)) * r;\n    d.x *= uResolution.y / uResolution.x;\n    return c + d;\n  }\n\n  void main() {\n    vec3 col;\n    vec2 baseUv = wormholeMap(vUv, 0.0);\n    if (wormholeChromatic > 0.001) {\n      vec2 uvR = wormholeMap(vUv, wormholeChromatic * 0.1);\n      vec2 uvB = wormholeMap(vUv, -wormholeChromatic * 0.1);\n      col.r = texture2D(uInput, clamp(uvR, vec2(0.0), vec2(1.0))).r;\n      col.g = texture2D(uInput, clamp(baseUv, vec2(0.0), vec2(1.0))).g;\n      col.b = texture2D(uInput, clamp(uvB, vec2(0.0), vec2(1.0))).b;\n    } else {\n      col = texture2D(uInput, clamp(baseUv, vec2(0.0), vec2(1.0))).rgb;\n    }\n    gl_FragColor = vec4(col, 1.0);\n  }\n",
    "defaults": {
      "wormholePullStrength": 0.5,
      "wormholeRotation": 1,
      "wormholeCenterX": 0.5,
      "wormholeCenterY": 0.5,
      "wormholeTwist": 0.5,
      "wormholeChromatic": 0.3,
      "wormholeAnimSpeed": 0.5
    },
    "controls": [
      {
        "name": "Pull Strength",
        "param": "wormholePullStrength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Rotation",
        "param": "wormholeRotation",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Center X",
        "param": "wormholeCenterX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Center Y",
        "param": "wormholeCenterY",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Twist",
        "param": "wormholeTwist",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Chromatic",
        "param": "wormholeChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Spin Speed",
        "param": "wormholeAnimSpeed",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.5
      }
    ],
    "integerParams": []
  },
  {
    "type": "geometricTile",
    "label": "Geometric Tile",
    "category": "Advanced 3D",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float geomTiles;         // 1-16\n  uniform float geomMode;          // 0=mirror, 1=rotate, 2=tile, 3=quilt\n  uniform float geomRotation;      // 0-360\n  uniform float geomOffsetX;       // 0-1 per-row offset\n  uniform float geomMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    int mode = int(geomMode + 0.5);\n    vec2 t = vUv * geomTiles;\n    vec2 cell = floor(t);\n    vec2 cellUv = fract(t);\n\n    if (mode == 0) {\n      // Mirror — flip alternating\n      if (mod(cell.x, 2.0) > 0.5) cellUv.x = 1.0 - cellUv.x;\n      if (mod(cell.y, 2.0) > 0.5) cellUv.y = 1.0 - cellUv.y;\n    } else if (mode == 1) {\n      // Rotate — alternate cells rotated\n      float rot = mod(cell.x + cell.y, 2.0) * radians(geomRotation);\n      vec2 d = cellUv - 0.5;\n      float c = cos(rot), s = sin(rot);\n      cellUv = vec2(d.x * c - d.y * s, d.x * s + d.y * c) + 0.5;\n    } else if (mode == 2) {\n      // Tile — straight repeat with row offset\n      cellUv.x += mod(cell.y, 2.0) * geomOffsetX;\n      cellUv = fract(cellUv);\n    } else {\n      // Quilt — mix of mirror + rotate\n      if (mod(cell.x, 2.0) > 0.5) cellUv.x = 1.0 - cellUv.x;\n      float rot = mod(cell.y, 2.0) * radians(geomRotation);\n      vec2 d = cellUv - 0.5;\n      float c = cos(rot), s = sin(rot);\n      cellUv = vec2(d.x * c - d.y * s, d.x * s + d.y * c) + 0.5;\n    }\n    cellUv = clamp(cellUv, vec2(0.0), vec2(1.0));\n    vec4 src = texture2D(uInput, vUv);\n    vec4 tiled = texture2D(uInput, cellUv);\n    gl_FragColor = vec4(mix(src.rgb, tiled.rgb, geomMix), src.a);\n  }\n",
    "defaults": {
      "geomTiles": 4,
      "geomMode": 0,
      "geomRotation": 90,
      "geomOffsetX": 0,
      "geomMix": 1
    },
    "controls": [
      {
        "name": "Tile Count",
        "param": "geomTiles",
        "min": 1,
        "max": 16,
        "step": 1,
        "default": 4
      },
      {
        "name": "Mode",
        "param": "geomMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Mirror"
          },
          {
            "value": 1,
            "label": "Rotate"
          },
          {
            "value": 2,
            "label": "Tile"
          },
          {
            "value": 3,
            "label": "Quilt"
          }
        ]
      },
      {
        "name": "Rotation",
        "param": "geomRotation",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 90
      },
      {
        "name": "Row Offset",
        "param": "geomOffsetX",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Mix",
        "param": "geomMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "motionTrails",
    "label": "Motion Trails",
    "category": "Advanced Trails",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float motionTrailsLength;        // 0-1\n  uniform float motionTrailsAngle;         // 0-360\n  uniform float motionTrailsSamples;       // 4-32\n  uniform float motionTrailsFalloff;       // 0-1\n  uniform float motionTrailsChromaSplit;   // 0-1\n  uniform float motionTrailsMode;          // 0=fade, 1=copy\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    if (motionTrailsLength < 0.001) { gl_FragColor = src; return; }\n\n    int samples = int(clamp(motionTrailsSamples, 4.0, 32.0));\n    float ang = radians(motionTrailsAngle);\n    vec2 dir = vec2(cos(ang), sin(ang));\n    vec2 step = dir * motionTrailsLength * 0.3;\n\n    vec3 acc = src.rgb;\n    float wsum = 1.0;\n    for (int i = 1; i <= 32; i++) {\n      if (i > samples) break;\n      float t = float(i) / float(samples);\n      vec2 sUv = vUv + step * t;\n      vec3 sCol;\n      if (motionTrailsChromaSplit > 0.001) {\n        sCol.r = texture2D(uInput, sUv + dir * t * motionTrailsChromaSplit * 0.02).r;\n        sCol.g = texture2D(uInput, sUv).g;\n        sCol.b = texture2D(uInput, sUv - dir * t * motionTrailsChromaSplit * 0.02).b;\n      } else {\n        sCol = texture2D(uInput, sUv).rgb;\n      }\n      float w = (motionTrailsMode > 0.5) ? 1.0 : pow(1.0 - t, max(0.5, motionTrailsFalloff * 4.0));\n      acc += sCol * w;\n      wsum += w;\n    }\n    gl_FragColor = vec4(acc / wsum, src.a);\n  }\n",
    "defaults": {
      "motionTrailsLength": 0.4,
      "motionTrailsAngle": 0,
      "motionTrailsSamples": 16,
      "motionTrailsFalloff": 0.5,
      "motionTrailsChromaSplit": 0.2,
      "motionTrailsMode": 0
    },
    "controls": [
      {
        "name": "Length",
        "param": "motionTrailsLength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Direction",
        "param": "motionTrailsAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Samples",
        "param": "motionTrailsSamples",
        "min": 4,
        "max": 32,
        "step": 2,
        "default": 16
      },
      {
        "name": "Falloff",
        "param": "motionTrailsFalloff",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Chroma Split",
        "param": "motionTrailsChromaSplit",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Mode",
        "param": "motionTrailsMode",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Fade"
          },
          {
            "value": 1,
            "label": "Copy"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "echoRepeat",
    "label": "Echo Repeat",
    "category": "Advanced Trails",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float echoCount;         // 1-12\n  uniform float echoOffsetX;       // -0.5..0.5 per-step\n  uniform float echoOffsetY;       // -0.5..0.5\n  uniform float echoDecay;         // 0.5-0.95 per-step\n  uniform float echoHueShift;      // 0-1\n  uniform float echoMode;          // 0=add, 1=screen, 2=replace\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n  vec3 rgb2hsv(vec3 c) {\n    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);\n    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n    float d = q.x - min(q.w, q.y);\n    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);\n  }\n\n  void main() {\n    int count = int(clamp(echoCount, 1.0, 12.0));\n    int mode = int(echoMode + 0.5);\n    vec3 acc = texture2D(uInput, vUv).rgb;\n    vec2 off = vec2(echoOffsetX, echoOffsetY);\n    float opacity = echoDecay;\n    float hueOff = echoHueShift;\n\n    for (int i = 1; i < 12; i++) {\n      if (i >= count) break;\n      vec2 sUv = vUv - off * float(i);\n      sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n      vec3 sCol = texture2D(uInput, sUv).rgb;\n      if (echoHueShift > 0.001) {\n        vec3 hsv = rgb2hsv(sCol);\n        hsv.x = fract(hsv.x + hueOff);\n        sCol = hsv2rgb(hsv);\n      }\n      sCol *= opacity;\n      if (mode == 0) acc += sCol;\n      else if (mode == 1) acc = 1.0 - (1.0 - acc) * (1.0 - sCol);\n      else acc = mix(acc, sCol, opacity);\n      opacity *= echoDecay;\n      hueOff += echoHueShift;\n    }\n    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "echoCount": 5,
      "echoOffsetX": 0.05,
      "echoOffsetY": 0.05,
      "echoDecay": 0.7,
      "echoHueShift": 0.02,
      "echoMode": 0
    },
    "controls": [
      {
        "name": "Echo Count",
        "param": "echoCount",
        "min": 1,
        "max": 12,
        "step": 1,
        "default": 5
      },
      {
        "name": "Offset X",
        "param": "echoOffsetX",
        "min": -0.5,
        "max": 0.5,
        "step": 0.005,
        "default": 0.05
      },
      {
        "name": "Offset Y",
        "param": "echoOffsetY",
        "min": -0.5,
        "max": 0.5,
        "step": 0.005,
        "default": 0.05
      },
      {
        "name": "Decay / Step",
        "param": "echoDecay",
        "min": 0.1,
        "max": 0.95,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Hue Shift / Step",
        "param": "echoHueShift",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.02
      },
      {
        "name": "Blend",
        "param": "echoMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Add"
          },
          {
            "value": 1,
            "label": "Screen"
          },
          {
            "value": 2,
            "label": "Replace"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "ghostDouble",
    "label": "Ghost Double",
    "category": "Advanced Trails",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float ghostOpacity;       // 0-1\n  uniform float ghostOffsetX;       // -0.3..0.3\n  uniform float ghostOffsetY;       // -0.3..0.3\n  uniform float ghostMirror;        // 0/1 (mirror the ghost)\n  uniform float ghostTintR;\n  uniform float ghostTintG;\n  uniform float ghostTintB;\n  uniform float ghostBlend;         // 0=screen, 1=add, 2=multiply\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec2 ghostUv = vUv - vec2(ghostOffsetX, ghostOffsetY);\n    if (ghostMirror > 0.5) ghostUv.x = 1.0 - ghostUv.x;\n    ghostUv = clamp(ghostUv, vec2(0.0), vec2(1.0));\n    vec3 ghost = texture2D(uInput, ghostUv).rgb * vec3(ghostTintR, ghostTintG, ghostTintB) * ghostOpacity;\n\n    int mode = int(ghostBlend + 0.5);\n    vec3 result;\n    if (mode == 0) result = 1.0 - (1.0 - src) * (1.0 - ghost);\n    else if (mode == 1) result = src + ghost;\n    else result = src * (1.0 + ghost);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "ghostOpacity": 0.5,
      "ghostOffsetX": 0.05,
      "ghostOffsetY": 0,
      "ghostMirror": 0,
      "ghostTintR": 1,
      "ghostTintG": 1,
      "ghostTintB": 1,
      "ghostBlend": 0
    },
    "controls": [
      {
        "name": "Opacity",
        "param": "ghostOpacity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Offset X",
        "param": "ghostOffsetX",
        "min": -0.3,
        "max": 0.3,
        "step": 0.005,
        "default": 0.05
      },
      {
        "name": "Offset Y",
        "param": "ghostOffsetY",
        "min": -0.3,
        "max": 0.3,
        "step": 0.005,
        "default": 0
      },
      {
        "name": "Mirror",
        "param": "ghostMirror",
        "min": 0,
        "max": 1,
        "step": 1,
        "default": 0
      },
      {
        "name": "Tint R",
        "param": "ghostTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "ghostTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint B",
        "param": "ghostTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Blend",
        "param": "ghostBlend",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Screen"
          },
          {
            "value": 1,
            "label": "Add"
          },
          {
            "value": 2,
            "label": "Multiply"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "strobeFlash",
    "label": "Strobe Flash",
    "category": "Advanced Trails",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float strobeRate;          // 0.5-30 Hz\n  uniform float strobeDuty;           // 0-1 fraction of cycle bright\n  uniform float strobeIntensity;     // 0-2\n  uniform float strobeMode;          // 0=on/off, 1=invert flash, 2=tint flash\n  uniform float strobeTintR;\n  uniform float strobeTintG;\n  uniform float strobeTintB;\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    float phase = mod(uTime * strobeRate, 1.0);\n    float gate = step(phase, strobeDuty);\n\n    int mode = int(strobeMode + 0.5);\n    vec3 result;\n    if (mode == 0) {\n      result = mix(src, src + vec3(strobeIntensity * gate), gate);\n    } else if (mode == 1) {\n      result = mix(src, 1.0 - src, gate * strobeIntensity);\n    } else {\n      vec3 tint = vec3(strobeTintR, strobeTintG, strobeTintB);\n      result = mix(src, src * tint + tint * 0.4, gate * strobeIntensity);\n    }\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "strobeRate": 4,
      "strobeDuty": 0.5,
      "strobeIntensity": 1,
      "strobeMode": 0,
      "strobeTintR": 1,
      "strobeTintG": 1,
      "strobeTintB": 1
    },
    "controls": [
      {
        "name": "Rate (Hz)",
        "param": "strobeRate",
        "min": 0.5,
        "max": 30,
        "step": 0.5,
        "default": 4
      },
      {
        "name": "Duty Cycle",
        "param": "strobeDuty",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Intensity",
        "param": "strobeIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mode",
        "param": "strobeMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "On/Off"
          },
          {
            "value": 1,
            "label": "Invert Flash"
          },
          {
            "value": 2,
            "label": "Tint Flash"
          }
        ]
      },
      {
        "name": "Tint R",
        "param": "strobeTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "strobeTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint B",
        "param": "strobeTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "lightPaint",
    "label": "Light Paint",
    "category": "Advanced Trails",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float lightPaintIntensity;     // 0-2\n  uniform float lightPaintThreshold;     // 0-1 luma gate\n  uniform float lightPaintTrailLength;   // 0-1\n  uniform float lightPaintFlowAngle;     // 0-360 dominant flow direction\n  uniform float lightPaintFlowScale;     // 1-16 noise warp scale\n  uniform float lightPaintChromaShift;   // 0-1\n  uniform float lightPaintTintR;\n  uniform float lightPaintTintG;\n  uniform float lightPaintTintB;\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    if (lightPaintIntensity < 0.001) { gl_FragColor = vec4(src, 1.0); return; }\n\n    // Build flow direction at this pixel (perturbed by noise)\n    float baseAng = radians(lightPaintFlowAngle);\n    float perturb = (vnoise(vUv * lightPaintFlowScale + uTime * 0.3) - 0.5) * 1.6;\n    float ang = baseAng + perturb;\n    vec2 dir = vec2(cos(ang), sin(ang));\n\n    // March backward along flow accumulating bright pixels\n    vec3 acc = src;\n    float wsum = 1.0;\n    float maxLen = lightPaintTrailLength * 0.4;\n    for (int i = 1; i <= 24; i++) {\n      float t = float(i) / 24.0;\n      vec2 sUv = vUv - dir * maxLen * t;\n      vec3 sCol;\n      if (lightPaintChromaShift > 0.001) {\n        sCol.r = texture2D(uInput, sUv + dir * t * lightPaintChromaShift * 0.02).r;\n        sCol.g = texture2D(uInput, sUv).g;\n        sCol.b = texture2D(uInput, sUv - dir * t * lightPaintChromaShift * 0.02).b;\n      } else {\n        sCol = texture2D(uInput, sUv).rgb;\n      }\n      float gate = smoothstep(lightPaintThreshold, lightPaintThreshold + 0.15, luma(sCol));\n      float w = (1.0 - t) * gate;\n      acc += sCol * vec3(lightPaintTintR, lightPaintTintG, lightPaintTintB) * w * lightPaintIntensity;\n      wsum += w;\n    }\n    vec3 result = acc / wsum;\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "lightPaintIntensity": 0.7,
      "lightPaintThreshold": 0.5,
      "lightPaintTrailLength": 0.4,
      "lightPaintFlowAngle": 0,
      "lightPaintFlowScale": 6,
      "lightPaintChromaShift": 0.3,
      "lightPaintTintR": 1,
      "lightPaintTintG": 0.8,
      "lightPaintTintB": 0.3
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "lightPaintIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Luma Gate",
        "param": "lightPaintThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Trail Length",
        "param": "lightPaintTrailLength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Flow Angle",
        "param": "lightPaintFlowAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 0
      },
      {
        "name": "Flow Scale",
        "param": "lightPaintFlowScale",
        "min": 1,
        "max": 16,
        "step": 0.5,
        "default": 6
      },
      {
        "name": "Chroma Shift",
        "param": "lightPaintChromaShift",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Tint R",
        "param": "lightPaintTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "lightPaintTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.8
      },
      {
        "name": "Tint B",
        "param": "lightPaintTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      }
    ],
    "integerParams": []
  },
  {
    "type": "recursiveEcho",
    "label": "Recursive Echo",
    "category": "Advanced Trails",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float recEchoDepth;         // 1-12\n  uniform float recEchoZoom;          // 0.85-1.15 per-step zoom factor\n  uniform float recEchoRotation;      // 0-360 per-step\n  uniform float recEchoOpacity;       // 0-1 per-step decay\n  uniform float recEchoHueShift;      // 0-1 per-step\n  uniform float recEchoOffsetX;\n  uniform float recEchoOffsetY;\n  uniform float recEchoMode;          // 0=recursive zoom, 1=mirror echo, 2=spiral\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n  vec3 rgb2hsv(vec3 c) {\n    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);\n    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n    float d = q.x - min(q.w, q.y);\n    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);\n  }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    int depth = int(clamp(recEchoDepth, 1.0, 12.0));\n    int mode = int(recEchoMode + 0.5);\n    vec3 acc = src;\n    float opacity = recEchoOpacity;\n    float hueOff = recEchoHueShift;\n    vec2 offset = vec2(recEchoOffsetX, recEchoOffsetY);\n    float ang = radians(recEchoRotation);\n    float ca = cos(ang), sa = sin(ang);\n    float scale = recEchoZoom;\n\n    for (int i = 1; i < 12; i++) {\n      if (i >= depth) break;\n      vec2 c = vec2(0.5);\n      vec2 d = (vUv - c) * pow(scale, float(i));\n      d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);\n      vec2 sUv = c + d - offset * float(i);\n      if (mode == 1) sUv = vec2(1.0 - sUv.x, sUv.y);\n      else if (mode == 2) {\n        // Spiral: add radial twist\n        vec2 dr = sUv - 0.5;\n        float r = length(dr);\n        float a2 = atan(dr.y, dr.x) + r * float(i) * 0.5;\n        sUv = 0.5 + vec2(cos(a2), sin(a2)) * r;\n      }\n      sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n      vec3 sCol = texture2D(uInput, sUv).rgb;\n      if (recEchoHueShift > 0.001) {\n        vec3 hsv = rgb2hsv(sCol);\n        hsv.x = fract(hsv.x + hueOff);\n        sCol = hsv2rgb(hsv);\n      }\n      acc = mix(acc, sCol, opacity);\n      opacity *= recEchoOpacity;\n      hueOff += recEchoHueShift;\n    }\n    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "recEchoDepth": 5,
      "recEchoZoom": 0.95,
      "recEchoRotation": 5,
      "recEchoOpacity": 0.6,
      "recEchoHueShift": 0.05,
      "recEchoOffsetX": 0.02,
      "recEchoOffsetY": 0.02,
      "recEchoMode": 0
    },
    "controls": [
      {
        "name": "Echo Depth",
        "param": "recEchoDepth",
        "min": 1,
        "max": 12,
        "step": 1,
        "default": 5
      },
      {
        "name": "Zoom / Step",
        "param": "recEchoZoom",
        "min": 0.85,
        "max": 1.15,
        "step": 0.005,
        "default": 0.95
      },
      {
        "name": "Rotation / Step",
        "param": "recEchoRotation",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 5
      },
      {
        "name": "Opacity / Step",
        "param": "recEchoOpacity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Hue Shift / Step",
        "param": "recEchoHueShift",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.05
      },
      {
        "name": "Offset X / Step",
        "param": "recEchoOffsetX",
        "min": -0.2,
        "max": 0.2,
        "step": 0.005,
        "default": 0.02
      },
      {
        "name": "Offset Y / Step",
        "param": "recEchoOffsetY",
        "min": -0.2,
        "max": 0.2,
        "step": 0.005,
        "default": 0.02
      },
      {
        "name": "Mode",
        "param": "recEchoMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Recursive Zoom"
          },
          {
            "value": 1,
            "label": "Mirror Echo"
          },
          {
            "value": 2,
            "label": "Spiral"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "flowFieldTrails",
    "label": "Flow Field Trails",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float fftFlowScale;     // 0.5-16 noise scale\n  uniform float fftTrailLength;   // 0-1\n  uniform float fftSamples;       // 8-64 march steps\n  uniform float fftSpeed;         // 0-3 anim speed\n  uniform float fftChromaSplit;   // 0-1\n  uniform float fftContrast;      // 0-2\n  uniform float fftMode;          // 0=advect, 1=streak, 2=tendril\n  uniform float fftColorCycle;    // 0-1 hue rotation along trail\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  vec2 curl(vec2 p, float t) {\n    float e = 0.04;\n    float n1 = vnoise(p + vec2(0, e) + t);\n    float n2 = vnoise(p - vec2(0, e) + t);\n    float n3 = vnoise(p + vec2(e, 0) + t);\n    float n4 = vnoise(p - vec2(e, 0) + t);\n    return vec2(n1 - n2, -(n3 - n4)) * 4.0;\n  }\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n\n  void main() {\n    vec4 src = texture2D(uInput, vUv);\n    int mode = int(fftMode + 0.5);\n    int samples = int(clamp(fftSamples, 4.0, 64.0));\n    float t = uTime * fftSpeed;\n\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n    vec2 pos = vUv;\n    float stepLen = fftTrailLength * 0.4 / float(samples);\n\n    for (int i = 0; i < 64; i++) {\n      if (i >= samples) break;\n      float fi = float(i) / float(samples);\n      vec2 v = curl(pos * fftFlowScale, t * 0.1);\n      if (mode == 1) v *= (1.0 + sin(fi * 6.28) * 0.5);\n      else if (mode == 2) v *= (1.0 + cos(t + fi * 3.14) * 0.7);\n      pos -= v * stepLen;\n      vec3 sCol;\n      if (fftChromaSplit > 0.001) {\n        sCol.r = texture2D(uInput, pos + v * fftChromaSplit * 0.01).r;\n        sCol.g = texture2D(uInput, pos).g;\n        sCol.b = texture2D(uInput, pos - v * fftChromaSplit * 0.01).b;\n      } else {\n        sCol = texture2D(uInput, pos).rgb;\n      }\n      // Optional hue cycle\n      if (fftColorCycle > 0.001) {\n        float hueOff = fi * fftColorCycle;\n        sCol = mix(sCol, hsv2rgb(vec3(fract(hueOff), 1.0, max(max(sCol.r, sCol.g), sCol.b))), fftColorCycle * 0.4);\n      }\n      float w = 1.0 - fi;\n      acc += sCol * w;\n      wsum += w;\n    }\n    vec3 result = acc / max(wsum, 0.0001);\n    result = (result - 0.5) * fftContrast + 0.5;\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);\n  }\n",
    "defaults": {
      "fftFlowScale": 4,
      "fftTrailLength": 0.4,
      "fftSamples": 24,
      "fftSpeed": 0.8,
      "fftChromaSplit": 0.3,
      "fftContrast": 1,
      "fftMode": 0,
      "fftColorCycle": 0
    },
    "controls": [
      {
        "name": "Flow Scale",
        "param": "fftFlowScale",
        "min": 0.5,
        "max": 16,
        "step": 0.25,
        "default": 4
      },
      {
        "name": "Trail Length",
        "param": "fftTrailLength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Samples",
        "param": "fftSamples",
        "min": 8,
        "max": 64,
        "step": 2,
        "default": 24
      },
      {
        "name": "Speed",
        "param": "fftSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.8
      },
      {
        "name": "Chroma Split",
        "param": "fftChromaSplit",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Contrast",
        "param": "fftContrast",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Mode",
        "param": "fftMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Advect"
          },
          {
            "value": 1,
            "label": "Streak"
          },
          {
            "value": 2,
            "label": "Tendril"
          }
        ]
      },
      {
        "name": "Color Cycle",
        "param": "fftColorCycle",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "neonTubeTrace",
    "label": "Neon Tube Trace",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float ntEdgeThreshold; // 0-1\n  uniform float ntTubeWidth;     // 0.5-4\n  uniform float ntGlow;          // 0-2 glow intensity\n  uniform float ntGlowRadius;    // 1-12 px\n  uniform float ntTintR;\n  uniform float ntTintG;\n  uniform float ntTintB;\n  uniform float ntChase;         // 0-1 marching-light along tube\n  uniform float ntChaseSpeed;    // 0-3\n  uniform float ntFlicker;       // 0-1 random tube flicker\n  uniform float ntBg;            // 0=black, 1=keep source, 2=darkened source\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  float edgeStrength(vec2 uv, vec2 texel) {\n    float l00 = luma(texture2D(uInput, uv + texel * vec2(-1, -1)).rgb);\n    float l10 = luma(texture2D(uInput, uv + texel * vec2( 0, -1)).rgb);\n    float l20 = luma(texture2D(uInput, uv + texel * vec2( 1, -1)).rgb);\n    float l01 = luma(texture2D(uInput, uv + texel * vec2(-1,  0)).rgb);\n    float l21 = luma(texture2D(uInput, uv + texel * vec2( 1,  0)).rgb);\n    float l02 = luma(texture2D(uInput, uv + texel * vec2(-1,  1)).rgb);\n    float l12 = luma(texture2D(uInput, uv + texel * vec2( 0,  1)).rgb);\n    float l22 = luma(texture2D(uInput, uv + texel * vec2( 1,  1)).rgb);\n    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);\n    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);\n    return length(vec2(gx, gy));\n  }\n\n  void main() {\n    vec2 texel = 1.0 / uResolution;\n    vec3 src = texture2D(uInput, vUv).rgb;\n    float e = edgeStrength(vUv, texel);\n    float tube = smoothstep(ntEdgeThreshold, ntEdgeThreshold + 0.05 * ntTubeWidth, e);\n\n    // Glow halo (sample edges in neighbourhood)\n    float halo = 0.0;\n    if (ntGlow > 0.001) {\n      float r = ntGlowRadius;\n      for (int y = -3; y <= 3; y++) {\n        for (int x = -3; x <= 3; x++) {\n          vec2 off = vec2(float(x), float(y)) * texel * r * 0.4;\n          float ee = edgeStrength(vUv + off, texel);\n          float w = exp(-(float(x*x + y*y)) / (2.0 * 4.0));\n          halo += smoothstep(ntEdgeThreshold, ntEdgeThreshold + 0.1, ee) * w;\n        }\n      }\n      halo *= ntGlow / 16.0;\n    }\n\n    // Marching chase\n    if (ntChase > 0.001 && tube > 0.5) {\n      float chase = sin(vUv.x * 60.0 + uTime * ntChaseSpeed * 4.0) * 0.5 + 0.5;\n      tube *= mix(0.5, 1.0 + chase * 0.6, ntChase);\n    }\n\n    // Flicker\n    if (ntFlicker > 0.001) {\n      float f = step(0.92, hash21(vec2(floor(uTime * 12.0))));\n      tube *= 1.0 - f * ntFlicker * 0.4;\n    }\n\n    vec3 tint = vec3(ntTintR, ntTintG, ntTintB);\n    vec3 neon = tint * (tube * 1.8 + halo);\n\n    int bg = int(ntBg + 0.5);\n    vec3 baseColor;\n    if (bg == 0) baseColor = vec3(0.0);\n    else if (bg == 1) baseColor = src;\n    else baseColor = src * 0.25;\n\n    vec3 result = 1.0 - (1.0 - baseColor) * (1.0 - neon);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "ntEdgeThreshold": 0.15,
      "ntTubeWidth": 1.5,
      "ntGlow": 1,
      "ntGlowRadius": 6,
      "ntTintR": 1,
      "ntTintG": 0.2,
      "ntTintB": 0.7,
      "ntChase": 0,
      "ntChaseSpeed": 1,
      "ntFlicker": 0,
      "ntBg": 2
    },
    "controls": [
      {
        "name": "Edge Threshold",
        "param": "ntEdgeThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.15
      },
      {
        "name": "Tube Width",
        "param": "ntTubeWidth",
        "min": 0.5,
        "max": 4,
        "step": 0.05,
        "default": 1.5
      },
      {
        "name": "Glow",
        "param": "ntGlow",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Glow Radius",
        "param": "ntGlowRadius",
        "min": 1,
        "max": 12,
        "step": 0.5,
        "default": 6
      },
      {
        "name": "Tint R",
        "param": "ntTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "ntTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Tint B",
        "param": "ntTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Marching Chase",
        "param": "ntChase",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Chase Speed",
        "param": "ntChaseSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Flicker",
        "param": "ntFlicker",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Background",
        "param": "ntBg",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 2,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Black"
          },
          {
            "value": 1,
            "label": "Source"
          },
          {
            "value": 2,
            "label": "Darkened Source"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "depthParallax",
    "label": "Depth Parallax (Fake)",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float dpDepthStrength; // 0-1\n  uniform float dpPushIn;        // 0-1 base zoom into depth\n  uniform float dpLayers;        // 1-8 depth layer count\n  uniform float dpChromatic;     // 0-1 RGB depth split\n  uniform float dpDepthBoost;    // 0-2 luma → depth response\n  uniform float dpMode;          // 0=push, 1=pan, 2=swing\n  uniform float dpPanX;          // -1..1\n  uniform float dpPanY;          // -1..1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  vec2 parallaxMap(vec2 uv, float depth, float layer) {\n    int mode = int(dpMode + 0.5);\n    vec2 d = uv - 0.5;\n    float scale = 1.0 + (depth - 0.5) * dpDepthStrength * 0.5 + dpPushIn * 0.3 * (1.0 + layer * 0.1);\n    vec2 sUv;\n    if (mode == 0) {\n      sUv = 0.5 + d / scale;\n    } else if (mode == 1) {\n      sUv = uv + vec2(dpPanX, dpPanY) * (depth - 0.5) * dpDepthStrength * 0.2 * (1.0 + layer * 0.2);\n    } else {\n      float sw = sin(uTime * 0.5 + layer * 0.3) * 0.5;\n      sUv = uv + vec2(sw, sw * 0.4) * (depth - 0.5) * dpDepthStrength * 0.15;\n    }\n    return clamp(sUv, vec2(0.0), vec2(1.0));\n  }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    float baseDepth = pow(luma(src), max(0.1, dpDepthBoost));\n    int layers = int(clamp(dpLayers, 1.0, 8.0));\n\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n    for (int i = 0; i < 8; i++) {\n      if (i >= layers) break;\n      float layer = float(i) / max(1.0, float(layers - 1));\n      float sliceDepth = mix(0.2, 0.95, layer);\n      // Estimate per-layer offset\n      vec2 sUv = parallaxMap(vUv, sliceDepth, layer);\n      vec3 sCol;\n      if (dpChromatic > 0.001) {\n        vec2 cd = (sUv - 0.5) * dpChromatic * 0.04 * (1.0 - layer);\n        sCol.r = texture2D(uInput, sUv + cd).r;\n        sCol.g = texture2D(uInput, sUv).g;\n        sCol.b = texture2D(uInput, sUv - cd).b;\n      } else {\n        sCol = texture2D(uInput, sUv).rgb;\n      }\n      // Weight by closeness of source pixel depth to slice depth\n      float pixDepth = pow(luma(sCol), max(0.1, dpDepthBoost));\n      float w = exp(-pow((pixDepth - sliceDepth) * 4.0, 2.0));\n      acc += sCol * w;\n      wsum += w;\n    }\n    vec3 result = (wsum > 0.0001) ? acc / wsum : src;\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "dpDepthStrength": 0.5,
      "dpPushIn": 0.3,
      "dpLayers": 4,
      "dpChromatic": 0.3,
      "dpDepthBoost": 1,
      "dpMode": 0,
      "dpPanX": 0,
      "dpPanY": 0
    },
    "controls": [
      {
        "name": "Depth Strength",
        "param": "dpDepthStrength",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Push In",
        "param": "dpPushIn",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Layers",
        "param": "dpLayers",
        "min": 1,
        "max": 8,
        "step": 1,
        "default": 4
      },
      {
        "name": "Chromatic",
        "param": "dpChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Depth Boost",
        "param": "dpDepthBoost",
        "min": 0,
        "max": 2,
        "step": 0.05,
        "default": 1
      },
      {
        "name": "Mode",
        "param": "dpMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Push"
          },
          {
            "value": 1,
            "label": "Pan"
          },
          {
            "value": 2,
            "label": "Swing"
          }
        ]
      },
      {
        "name": "Pan X",
        "param": "dpPanX",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Pan Y",
        "param": "dpPanY",
        "min": -1,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "pointCloudDissolve",
    "label": "Point Cloud Dissolve",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float pcdDissolve;      // 0-1 0=image, 1=fully scattered\n  uniform float pcdDotSize;       // 1-12 px\n  uniform float pcdScatterRadius; // 0-1 max scatter distance (% of screen)\n  uniform float pcdAttract;       // 0-1 swirl-toward-center\n  uniform float pcdTurbulence;    // 0-1 random per-dot direction\n  uniform float pcdMode;          // 0=square dots, 1=circle, 2=cross\n  uniform float pcdBgR;\n  uniform float pcdBgG;\n  uniform float pcdBgB;\n  uniform float pcdHueShift;      // 0-1 cycle hue along dissolve\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n  vec3 rgb2hsv(vec3 c) {\n    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);\n    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n    float d = q.x - min(q.w, q.y);\n    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);\n  }\n\n  void main() {\n    // Raw source for dissolve = 0 fallback\n    vec3 srcRaw = texture2D(uInput, vUv).rgb;\n\n    vec2 cell = floor(vUv * uResolution / pcdDotSize);\n    vec2 cellOrigin = cell * pcdDotSize / uResolution;\n    vec2 cellSize = vec2(pcdDotSize) / uResolution;\n\n    // Each dot's home position is the cell origin + 0.5 of cell\n    vec2 home = cellOrigin + cellSize * 0.5;\n\n    // Sample source colour at the home position\n    vec3 sampleCol = texture2D(uInput, home).rgb;\n\n    // Compute dot's drifted position based on dissolve amount\n    vec2 dir = normalize(vec2(hash21(cell) - 0.5, hash21(cell + 13.7) - 0.5) + 1e-6);\n    if (pcdAttract > 0.001) {\n      vec2 toCenter = (vec2(0.5) - home);\n      dir = mix(dir, normalize(toCenter + 1e-6), pcdAttract);\n    }\n    if (pcdTurbulence > 0.001) {\n      float wob = sin(uTime + hash21(cell + 71.3) * 6.28) * pcdTurbulence;\n      dir += vec2(wob * 0.3, wob * 0.4);\n      dir = normalize(dir);\n    }\n\n    vec2 dotPos = home + dir * pcdDissolve * pcdScatterRadius;\n\n    // Determine mask of dot at this UV. Dot radius = 0.71 covers full cell at\n    // dissolve=0 (length(toDot) max is 0.707 at corner). Shrinks with dissolve\n    // so scattered state shows BG between dots.\n    vec2 toDot = (vUv - dotPos) / cellSize;\n    int mode = int(pcdMode + 0.5);\n    float dotR = mix(0.72, 0.42, pcdDissolve); // shrinks as dissolve grows\n    float mask = 0.0;\n    if (mode == 0) {\n      // Square: cover full cell at dissolve=0\n      vec2 ad = abs(toDot);\n      mask = step(max(ad.x, ad.y), max(0.5, dotR));\n    } else if (mode == 1) {\n      // Circle: smooth falloff\n      mask = smoothstep(dotR + 0.05, dotR - 0.05, length(toDot));\n    } else {\n      // Cross\n      mask = max(\n        step(abs(toDot.x), dotR * 0.2) * step(abs(toDot.y), dotR),\n        step(abs(toDot.y), dotR * 0.2) * step(abs(toDot.x), dotR)\n      );\n    }\n\n    if (pcdHueShift > 0.001) {\n      vec3 hsv = rgb2hsv(sampleCol);\n      hsv.x = fract(hsv.x + pcdDissolve * pcdHueShift);\n      sampleCol = hsv2rgb(hsv);\n    }\n\n    vec3 bg = vec3(pcdBgR, pcdBgG, pcdBgB);\n    vec3 dotResult = mix(bg, sampleCol, mask);\n    // Crossfade with raw source so dissolve = 0 looks unchanged\n    vec3 result = mix(srcRaw, dotResult, smoothstep(0.0, 0.05, pcdDissolve));\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "pcdDissolve": 0,
      "pcdDotSize": 4,
      "pcdScatterRadius": 0.4,
      "pcdAttract": 0,
      "pcdTurbulence": 0.3,
      "pcdMode": 1,
      "pcdBgR": 0,
      "pcdBgG": 0,
      "pcdBgB": 0,
      "pcdHueShift": 0
    },
    "controls": [
      {
        "name": "Dissolve",
        "param": "pcdDissolve",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Dot Size",
        "param": "pcdDotSize",
        "min": 1,
        "max": 12,
        "step": 0.5,
        "default": 4
      },
      {
        "name": "Scatter Radius",
        "param": "pcdScatterRadius",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Attract to Center",
        "param": "pcdAttract",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Turbulence",
        "param": "pcdTurbulence",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Dot Shape",
        "param": "pcdMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Square"
          },
          {
            "value": 1,
            "label": "Circle"
          },
          {
            "value": 2,
            "label": "Cross"
          }
        ]
      },
      {
        "name": "BG R",
        "param": "pcdBgR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "BG G",
        "param": "pcdBgG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "BG B",
        "param": "pcdBgB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Hue Shift",
        "param": "pcdHueShift",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "liquidGlass",
    "label": "Liquid Glass",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float lgBlobs;         // 1-8\n  uniform float lgBlobSize;      // 0.05-0.4\n  uniform float lgRefraction;    // 0-1\n  uniform float lgChromatic;     // 0-1\n  uniform float lgSpecular;      // 0-1\n  uniform float lgCausticAmount; // 0-1\n  uniform float lgSpeed;         // 0-3\n  uniform float lgTintR;\n  uniform float lgTintG;\n  uniform float lgTintB;\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n\n  // Compute summed signed-distance to N moving blobs\n  float blobField(vec2 uv, out vec2 grad) {\n    int n = int(clamp(lgBlobs, 1.0, 8.0));\n    float sum = 0.0;\n    grad = vec2(0.0);\n    for (int i = 0; i < 8; i++) {\n      if (i >= n) break;\n      float fi = float(i);\n      vec2 c = vec2(\n        0.5 + 0.35 * sin(uTime * lgSpeed * 0.3 + fi * 1.7),\n        0.5 + 0.35 * cos(uTime * lgSpeed * 0.4 + fi * 2.3)\n      );\n      vec2 d = uv - c;\n      d.x *= uResolution.x / uResolution.y;\n      float r = length(d);\n      float w = exp(-r * r / (lgBlobSize * lgBlobSize));\n      sum += w;\n      grad -= d * w / (lgBlobSize * lgBlobSize) * 2.0;\n    }\n    return sum;\n  }\n\n  void main() {\n    vec2 grad;\n    float field = blobField(vUv, grad);\n    float blob = smoothstep(0.7, 1.3, field);\n\n    // Refract: bend rays inversely proportional to gradient\n    vec2 refractDir = -grad * lgRefraction * 0.04;\n    vec3 col;\n    if (lgChromatic > 0.001) {\n      col.r = texture2D(uInput, vUv + refractDir * (1.0 + lgChromatic * 0.5)).r;\n      col.g = texture2D(uInput, vUv + refractDir).g;\n      col.b = texture2D(uInput, vUv + refractDir * (1.0 - lgChromatic * 0.5)).b;\n    } else {\n      col = texture2D(uInput, vUv + refractDir).rgb;\n    }\n    col *= mix(vec3(1.0), vec3(lgTintR, lgTintG, lgTintB), blob * 0.5);\n\n    // Specular highlight on top of blob (top-left bias)\n    if (lgSpecular > 0.001) {\n      vec3 N = normalize(vec3(grad, 1.0));\n      vec3 L = normalize(vec3(-0.4, -0.6, 0.6));\n      float spec = pow(max(0.0, dot(N, L)), 32.0);\n      col += vec3(spec) * lgSpecular * blob * 1.5;\n    }\n\n    // Caustics outside blob\n    if (lgCausticAmount > 0.001) {\n      float caust = (1.0 - blob) * (sin(field * 30.0 + uTime) * 0.5 + 0.5);\n      col += vec3(lgCausticAmount) * vec3(lgTintR, lgTintG, lgTintB) * caust * 0.4;\n    }\n\n    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "lgBlobs": 3,
      "lgBlobSize": 0.18,
      "lgRefraction": 0.5,
      "lgChromatic": 0.4,
      "lgSpecular": 0.5,
      "lgCausticAmount": 0.3,
      "lgSpeed": 0.5,
      "lgTintR": 0.85,
      "lgTintG": 0.95,
      "lgTintB": 1
    },
    "controls": [
      {
        "name": "Blob Count",
        "param": "lgBlobs",
        "min": 1,
        "max": 8,
        "step": 1,
        "default": 3
      },
      {
        "name": "Blob Size",
        "param": "lgBlobSize",
        "min": 0.05,
        "max": 0.4,
        "step": 0.005,
        "default": 0.18
      },
      {
        "name": "Refraction",
        "param": "lgRefraction",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Chromatic",
        "param": "lgChromatic",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Specular",
        "param": "lgSpecular",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Caustics",
        "param": "lgCausticAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Speed",
        "param": "lgSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Tint R",
        "param": "lgTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Tint G",
        "param": "lgTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Tint B",
        "param": "lgTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      }
    ],
    "integerParams": []
  },
  {
    "type": "hologramScan",
    "label": "Hologram Scan",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float hsIntensity;     // 0-1\n  uniform float hsScanFreq;      // 50-500\n  uniform float hsScanSpeed;     // 0-3\n  uniform float hsGridSpacing;   // 4-32\n  uniform float hsRGBFlicker;    // 0-1\n  uniform float hsBrokenBands;   // 0-1 random horizontal dropouts\n  uniform float hsTintR;\n  uniform float hsTintG;\n  uniform float hsTintB;\n  uniform float hsOpacityFlicker;// 0-1\n  uniform float hsEdgeGlow;      // 0-1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec3 tint = vec3(hsTintR, hsTintG, hsTintB);\n    vec3 col = src;\n\n    // RGB channel flicker (each channel jitters independently)\n    if (hsRGBFlicker > 0.001) {\n      float t = floor(uTime * 30.0);\n      float r = (hash21(vec2(t, 0)) - 0.5) * hsRGBFlicker * 0.04;\n      float g = (hash21(vec2(t, 1)) - 0.5) * hsRGBFlicker * 0.04;\n      float b = (hash21(vec2(t, 2)) - 0.5) * hsRGBFlicker * 0.04;\n      col.r = texture2D(uInput, vUv + vec2(r, 0)).r;\n      col.g = texture2D(uInput, vUv + vec2(g, 0)).g;\n      col.b = texture2D(uInput, vUv + vec2(b, 0)).b;\n    }\n\n    // Scanline + descending scan beam\n    float scan = sin(vUv.y * hsScanFreq * 3.14159 - uTime * hsScanSpeed * 4.0);\n    scan = mix(1.0, scan * 0.4 + 0.6, hsIntensity);\n    col *= scan;\n\n    // Bright moving scan beam\n    float beam = smoothstep(0.04, 0.0, abs(vUv.y - mod(uTime * hsScanSpeed * 0.3, 1.0)));\n    col += beam * tint * hsIntensity * 1.5;\n\n    // Grid overlay\n    if (hsGridSpacing > 0.5) {\n      vec2 g = mod(vUv * uResolution, hsGridSpacing);\n      float gridLine = step(hsGridSpacing - 1.0, max(g.x, g.y));\n      col += gridLine * tint * 0.2 * hsIntensity;\n    }\n\n    // Broken bands (horizontal dropouts)\n    if (hsBrokenBands > 0.001) {\n      float bandY = floor(vUv.y * 60.0 + uTime * 2.0);\n      float dropout = step(0.94, hash21(vec2(bandY, floor(uTime * 4.0))));\n      col *= 1.0 - dropout * hsBrokenBands * 0.6;\n    }\n\n    // Holographic tint\n    col = mix(col, col * tint + tint * 0.15, hsIntensity * 0.5);\n\n    // Edge glow\n    if (hsEdgeGlow > 0.001) {\n      vec2 texel = 1.0 / uResolution;\n      float l = luma(src);\n      float lN = luma(texture2D(uInput, vUv + texel * vec2(0.0, 1.0)).rgb);\n      float lE = luma(texture2D(uInput, vUv + texel * vec2(1.0, 0.0)).rgb);\n      float edge = abs(l - lN) + abs(l - lE);\n      col += tint * edge * hsEdgeGlow * 2.0;\n    }\n\n    // Overall opacity flicker\n    if (hsOpacityFlicker > 0.001) {\n      float opf = 1.0 - (sin(uTime * 8.0) * 0.5 + 0.5) * hsOpacityFlicker * 0.3;\n      col *= opf;\n    }\n\n    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "hsIntensity": 0.7,
      "hsScanFreq": 200,
      "hsScanSpeed": 1,
      "hsGridSpacing": 12,
      "hsRGBFlicker": 0.4,
      "hsBrokenBands": 0.3,
      "hsTintR": 0.4,
      "hsTintG": 0.95,
      "hsTintB": 1,
      "hsOpacityFlicker": 0.3,
      "hsEdgeGlow": 0.6
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "hsIntensity",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Scan Freq",
        "param": "hsScanFreq",
        "min": 50,
        "max": 500,
        "step": 5,
        "default": 200
      },
      {
        "name": "Scan Speed",
        "param": "hsScanSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Grid Spacing",
        "param": "hsGridSpacing",
        "min": 4,
        "max": 32,
        "step": 1,
        "default": 12
      },
      {
        "name": "RGB Flicker",
        "param": "hsRGBFlicker",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Broken Bands",
        "param": "hsBrokenBands",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Tint R",
        "param": "hsTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Tint G",
        "param": "hsTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Tint B",
        "param": "hsTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Opacity Flicker",
        "param": "hsOpacityFlicker",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Edge Glow",
        "param": "hsEdgeGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      }
    ],
    "integerParams": []
  },
  {
    "type": "smokeDisintegrate",
    "label": "Smoke Disintegrate",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float smokeAmount;        // 0-1 0=intact, 1=fully gone\n  uniform float smokeScale;         // 0.5-16 noise scale\n  uniform float smokeSpeed;         // 0-3\n  uniform float smokeDirection;     // 0-360 wind direction\n  uniform float smokeEdgeFade;      // 0-1 fade at dissolve edge\n  uniform float smokeColorR;\n  uniform float smokeColorG;\n  uniform float smokeColorB;\n  uniform float smokeMode;          // 0=top-down, 1=center-out, 2=fbm-driven\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float fbm(vec2 p) {\n    float v = 0.0; float amp = 0.5;\n    for (int i = 0; i < 5; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }\n    return v;\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    int mode = int(smokeMode + 0.5);\n    float ang = radians(smokeDirection);\n    vec2 windDir = vec2(cos(ang), sin(ang));\n\n    // Base threshold field (where dissolve has reached)\n    float threshold;\n    if (mode == 0) threshold = vUv.y; // top-down\n    else if (mode == 1) threshold = 1.0 - length(vUv - 0.5) * 1.4; // center-out\n    else threshold = fbm(vUv * 2.0); // fbm-driven random\n\n    // Animated smoke noise pattern\n    vec2 p = vUv * smokeScale + windDir * uTime * smokeSpeed * 0.2;\n    float smoke = fbm(p);\n    smoke = smoke * 0.6 + fbm(p * 2.5 + uTime * smokeSpeed * 0.15) * 0.4;\n\n    // Threshold + amount drives dissolve\n    float dissolveEdge = smokeAmount + smoke * 0.5 - 0.5;\n    float dissolveMask = smoothstep(threshold - smokeEdgeFade * 0.2, threshold + smokeEdgeFade * 0.2, dissolveEdge);\n\n    // Smoke color in dissolve area (tint by smoke pattern)\n    vec3 smokeColor = vec3(smokeColorR, smokeColorG, smokeColorB) * (0.6 + smoke * 0.4);\n    vec3 result = mix(src, smokeColor, dissolveMask);\n    // Apply alpha mask: high dissolve = transparent (or smoke-tinted)\n    float alpha = 1.0 - dissolveMask * 0.6;\n\n    gl_FragColor = vec4(result, alpha);\n  }\n",
    "defaults": {
      "smokeAmount": 0.4,
      "smokeScale": 4,
      "smokeSpeed": 1,
      "smokeDirection": 90,
      "smokeEdgeFade": 0.5,
      "smokeColorR": 0.85,
      "smokeColorG": 0.85,
      "smokeColorB": 0.9,
      "smokeMode": 0
    },
    "controls": [
      {
        "name": "Dissolve",
        "param": "smokeAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Scale",
        "param": "smokeScale",
        "min": 0.5,
        "max": 16,
        "step": 0.25,
        "default": 4
      },
      {
        "name": "Speed",
        "param": "smokeSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Wind Direction",
        "param": "smokeDirection",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 90
      },
      {
        "name": "Edge Fade",
        "param": "smokeEdgeFade",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Smoke R",
        "param": "smokeColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Smoke G",
        "param": "smokeColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Smoke B",
        "param": "smokeColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.9
      },
      {
        "name": "Direction",
        "param": "smokeMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Top-down"
          },
          {
            "value": 1,
            "label": "Center-out"
          },
          {
            "value": 2,
            "label": "fBm Driven"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "shimmerCloth",
    "label": "Shimmer Cloth",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float clothAmplitude;     // 0-1\n  uniform float clothFrequency;     // 1-30\n  uniform float clothSpeed;         // 0-3\n  uniform float clothThreadDensity; // 1-200 thread weave count\n  uniform float clothThreadDepth;   // 0-1 thread shadow depth\n  uniform float clothShimmer;       // 0-2 silk shimmer intensity\n  uniform float clothMode;          // 0=horizontal weave, 1=plaid, 2=satin\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    // Wave the UV\n    float t = uTime * clothSpeed;\n    vec2 wave;\n    wave.x = sin(vUv.y * clothFrequency + t) * clothAmplitude * 0.04;\n    wave.y = cos(vUv.x * clothFrequency * 0.8 + t * 0.7) * clothAmplitude * 0.03;\n    vec2 sUv = vUv + wave;\n    sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n    vec3 col = texture2D(uInput, sUv).rgb;\n\n    // Thread weave overlay\n    int mode = int(clothMode + 0.5);\n    vec2 px = sUv * uResolution;\n    float thread;\n    if (mode == 0) {\n      // Horizontal weave\n      thread = sin(px.y * clothThreadDensity * 0.1) * 0.5 + 0.5;\n    } else if (mode == 1) {\n      // Plaid (both axes)\n      thread = (sin(px.x * clothThreadDensity * 0.07) + sin(px.y * clothThreadDensity * 0.07)) * 0.25 + 0.5;\n    } else {\n      // Satin (45-degree weave)\n      thread = sin((px.x + px.y) * clothThreadDensity * 0.06) * 0.5 + 0.5;\n    }\n    col *= mix(1.0, thread, clothThreadDepth * 0.4);\n\n    // Shimmer (silk highlights)\n    if (clothShimmer > 0.001) {\n      float specular = pow(max(0.0, sin(px.x * 0.1 + px.y * 0.05 + t * 1.5)), 8.0);\n      col += vec3(specular) * clothShimmer * 0.3;\n    }\n    gl_FragColor = vec4(col, 1.0);\n  }\n",
    "defaults": {
      "clothAmplitude": 0.3,
      "clothFrequency": 8,
      "clothSpeed": 0.7,
      "clothThreadDensity": 60,
      "clothThreadDepth": 0.5,
      "clothShimmer": 0.5,
      "clothMode": 0
    },
    "controls": [
      {
        "name": "Wave Amplitude",
        "param": "clothAmplitude",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Wave Frequency",
        "param": "clothFrequency",
        "min": 1,
        "max": 30,
        "step": 0.5,
        "default": 8
      },
      {
        "name": "Wave Speed",
        "param": "clothSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Thread Density",
        "param": "clothThreadDensity",
        "min": 1,
        "max": 200,
        "step": 1,
        "default": 60
      },
      {
        "name": "Thread Depth",
        "param": "clothThreadDepth",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Shimmer",
        "param": "clothShimmer",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Weave",
        "param": "clothMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Horizontal"
          },
          {
            "value": 1,
            "label": "Plaid"
          },
          {
            "value": 2,
            "label": "Satin"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "rorschachMirror",
    "label": "Rorschach Mirror",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float rmMode;          // 0=vertical, 1=horizontal, 2=both, 3=4-fold\n  uniform float rmInkAmount;     // 0-1 contrast/threshold for ink\n  uniform float rmFluidEdges;    // 0-1 animated noise on mirror seam\n  uniform float rmTintR;\n  uniform float rmTintG;\n  uniform float rmTintB;\n  uniform float rmBgR;\n  uniform float rmBgG;\n  uniform float rmBgB;\n  uniform float rmMixOriginal;   // 0-1\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    int mode = int(rmMode + 0.5);\n    vec2 sUv = vUv;\n    // Animated edge wobble at fold seam\n    float wobble = rmFluidEdges * (vnoise(vUv * 8.0 + uTime * 0.5) - 0.5) * 0.04;\n\n    if (mode == 0 || mode == 2 || mode == 3) {\n      // Vertical fold (mirror left↔right)\n      if (sUv.x > 0.5 + wobble) sUv.x = 1.0 - sUv.x;\n    }\n    if (mode == 1 || mode == 2 || mode == 3) {\n      if (sUv.y > 0.5 + wobble) sUv.y = 1.0 - sUv.y;\n    }\n    if (mode == 3) {\n      // 4-fold: also diagonal mirror\n      if (sUv.x > sUv.y) {\n        float tmp = sUv.x; sUv.x = sUv.y; sUv.y = tmp;\n      }\n    }\n    sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n    vec3 mirrored = texture2D(uInput, sUv).rgb;\n    float ink = smoothstep(rmInkAmount, 1.0, luma(mirrored));\n    vec3 inkColor = mix(vec3(rmBgR, rmBgG, rmBgB), vec3(rmTintR, rmTintG, rmTintB), ink);\n\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec3 result = mix(inkColor, src, rmMixOriginal);\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "rmMode": 0,
      "rmInkAmount": 0.4,
      "rmFluidEdges": 0.3,
      "rmTintR": 0.05,
      "rmTintG": 0.05,
      "rmTintB": 0.05,
      "rmBgR": 0.95,
      "rmBgG": 0.95,
      "rmBgB": 0.92,
      "rmMixOriginal": 0
    },
    "controls": [
      {
        "name": "Symmetry",
        "param": "rmMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Vertical"
          },
          {
            "value": 1,
            "label": "Horizontal"
          },
          {
            "value": 2,
            "label": "Both"
          },
          {
            "value": 3,
            "label": "4-Fold"
          }
        ]
      },
      {
        "name": "Ink Threshold",
        "param": "rmInkAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Fluid Edges",
        "param": "rmFluidEdges",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Ink R",
        "param": "rmTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.05
      },
      {
        "name": "Ink G",
        "param": "rmTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.05
      },
      {
        "name": "Ink B",
        "param": "rmTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.05
      },
      {
        "name": "Paper R",
        "param": "rmBgR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Paper G",
        "param": "rmBgG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Paper B",
        "param": "rmBgB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.92
      },
      {
        "name": "Mix Original",
        "param": "rmMixOriginal",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "spectralPrismTunnel",
    "label": "Spectral Prism Tunnel",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float sptTunnelDepth;   // 0.5-3\n  uniform float sptPrismSpread;   // 0-2 chromatic per-slice\n  uniform float sptRotation;      // 0-3\n  uniform float sptSpeed;         // 0-3\n  uniform float sptSlices;        // 4-32 number of recursive slices\n  uniform float sptFade;          // 0-1 darken with depth\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  vec3 hsv2rgb(vec3 c) {\n    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);\n    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n  }\n\n  void main() {\n    vec2 d = vUv - 0.5;\n    d.x *= uResolution.x / uResolution.y;\n    float r = length(d);\n    float a = atan(d.y, d.x);\n    int slices = int(clamp(sptSlices, 4.0, 32.0));\n    float t = uTime * sptSpeed;\n\n    vec3 acc = vec3(0.0);\n    float wsum = 0.0;\n    for (int i = 0; i < 32; i++) {\n      if (i >= slices) break;\n      float fi = float(i) / float(slices);\n      // Tunnel UV: depth shrinks r\n      float depth = exp(-fi * sptTunnelDepth);\n      vec2 td = d / depth;\n      td.x *= uResolution.y / uResolution.x;\n      float ang = a + sptRotation * fi + t * 0.3;\n      vec2 rotD = vec2(cos(ang), sin(ang)) * length(td);\n      rotD.x *= uResolution.y / uResolution.x;\n      vec2 sUv = 0.5 + rotD;\n      sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n\n      // Per-slice prism shift: hue offset\n      vec3 sCol = texture2D(uInput, sUv).rgb;\n      vec3 prismTint = hsv2rgb(vec3(fract(fi * sptPrismSpread + t * 0.1), 1.0, 1.0));\n      vec3 c = mix(sCol, sCol * prismTint, sptPrismSpread * 0.5);\n      float w = 1.0 - fi * sptFade;\n      acc += c * w;\n      wsum += w;\n    }\n    vec3 result = acc / max(wsum, 0.0001);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "sptTunnelDepth": 1.5,
      "sptPrismSpread": 1,
      "sptRotation": 1,
      "sptSpeed": 1,
      "sptSlices": 12,
      "sptFade": 0.5
    },
    "controls": [
      {
        "name": "Tunnel Depth",
        "param": "sptTunnelDepth",
        "min": 0.5,
        "max": 3,
        "step": 0.05,
        "default": 1.5
      },
      {
        "name": "Prism Spread",
        "param": "sptPrismSpread",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Rotation",
        "param": "sptRotation",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Speed",
        "param": "sptSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Recursive Slices",
        "param": "sptSlices",
        "min": 4,
        "max": 32,
        "step": 1,
        "default": 12
      },
      {
        "name": "Depth Fade",
        "param": "sptFade",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      }
    ],
    "integerParams": []
  },
  {
    "type": "ledVolume",
    "label": "LED Volume",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float ledVoxelSize;     // 8-32 px\n  uniform float ledDepthPulse;    // 0-1 pulses depth\n  uniform float ledDepthSpeed;    // 0-3\n  uniform float ledPosterize;     // 1-8 colour quantization\n  uniform float ledGlow;          // 0-1\n  uniform float ledPerspective;   // 0-1 fake 3D push\n  uniform float ledMode;          // 0=square, 1=round, 2=hex\n  uniform float ledBgR;\n  uniform float ledBgG;\n  uniform float ledBgB;\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    // Voxel grid with depth pulse animation\n    vec2 cell = floor(vUv * uResolution / ledVoxelSize);\n    vec2 cellOrigin = cell * ledVoxelSize / uResolution;\n    vec2 cellSize = vec2(ledVoxelSize) / uResolution;\n    vec2 cellUv = (vUv - cellOrigin) / cellSize - 0.5;\n\n    // Sample center colour, posterize\n    vec3 sampleCol = texture2D(uInput, cellOrigin + cellSize * 0.5).rgb;\n    float steps = max(1.0, ledPosterize);\n    sampleCol = floor(sampleCol * steps + 0.5) / steps;\n\n    // Depth pulse: brightness sized\n    float depth = luma(sampleCol);\n    if (ledDepthPulse > 0.001) {\n      depth += sin(uTime * ledDepthSpeed * 2.0 + depth * 8.0) * ledDepthPulse * 0.2;\n    }\n\n    // Voxel size scales with depth (perspective)\n    float scale = mix(0.45, 0.45 - ledPerspective * 0.3 * (1.0 - depth), 1.0);\n    float r = length(cellUv);\n    int mode = int(ledMode + 0.5);\n    float voxel;\n    if (mode == 0) {\n      vec2 ad = abs(cellUv);\n      voxel = step(max(ad.x, ad.y), scale);\n    } else if (mode == 1) {\n      voxel = smoothstep(scale + 0.05, scale - 0.05, r);\n    } else {\n      // Hex\n      vec2 ad = abs(cellUv);\n      voxel = step(max(ad.x * 0.866 + ad.y * 0.5, ad.y), scale);\n    }\n\n    vec3 bg = vec3(ledBgR, ledBgG, ledBgB);\n    vec3 result = mix(bg, sampleCol, voxel);\n\n    // Glow halo\n    if (ledGlow > 0.001) {\n      float halo = smoothstep(scale * 1.6, scale, r);\n      result += sampleCol * halo * ledGlow * 0.4;\n    }\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "ledVoxelSize": 16,
      "ledDepthPulse": 0.4,
      "ledDepthSpeed": 1,
      "ledPosterize": 4,
      "ledGlow": 0.5,
      "ledPerspective": 0.4,
      "ledMode": 1,
      "ledBgR": 0,
      "ledBgG": 0,
      "ledBgB": 0
    },
    "controls": [
      {
        "name": "Voxel Size",
        "param": "ledVoxelSize",
        "min": 8,
        "max": 32,
        "step": 1,
        "default": 16
      },
      {
        "name": "Depth Pulse",
        "param": "ledDepthPulse",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Pulse Speed",
        "param": "ledDepthSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Posterize",
        "param": "ledPosterize",
        "min": 1,
        "max": 8,
        "step": 1,
        "default": 4
      },
      {
        "name": "Glow",
        "param": "ledGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Fake 3D",
        "param": "ledPerspective",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Voxel Shape",
        "param": "ledMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Square"
          },
          {
            "value": 1,
            "label": "Round"
          },
          {
            "value": 2,
            "label": "Hex"
          }
        ]
      },
      {
        "name": "BG R",
        "param": "ledBgR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "BG G",
        "param": "ledBgG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "BG B",
        "param": "ledBgB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  },
  {
    "type": "posterTear",
    "label": "Poster Tear",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float ptTearAmount;    // 0-1 progress\n  uniform float ptTearAngle;     // 0-360\n  uniform float ptTearJitter;    // 0-1 ragged-edge noise\n  uniform float ptShiftBelow;    // 0-1 offset of underneath layer\n  uniform float ptOffsetX;       // -0.3..0.3\n  uniform float ptOffsetY;       // -0.3..0.3\n  uniform float ptTearGlow;      // 0-1 highlight along rip\n  uniform float ptMode;          // 0=line, 1=arc, 2=rectangle\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n\n  void main() {\n    int mode = int(ptMode + 0.5);\n    float ang = radians(ptTearAngle);\n    vec2 dir = vec2(cos(ang), sin(ang));\n    vec2 norm = vec2(-dir.y, dir.x);\n\n    // Distance from tear path\n    vec2 d = vUv - 0.5;\n    float distToLine = dot(d, norm);\n    float jit = ptTearJitter * (vnoise(vUv * 30.0) - 0.5) * 0.05;\n    float teared;\n    if (mode == 0) {\n      teared = step(ptTearAmount * 1.0 - 0.5, distToLine + jit);\n    } else if (mode == 1) {\n      // Arc tear\n      float r = length(d);\n      teared = step(ptTearAmount * 0.7, r + jit);\n    } else {\n      // Rectangle (corner tear)\n      vec2 ad = abs(d);\n      teared = step(ptTearAmount * 0.5, max(ad.x, ad.y) + jit);\n    }\n\n    // Below layer = offset & faded source\n    vec2 belowUv = vUv + vec2(ptOffsetX, ptOffsetY) * ptShiftBelow;\n    belowUv = clamp(belowUv, vec2(0.0), vec2(1.0));\n    vec3 above = texture2D(uInput, vUv).rgb;\n    vec3 below = texture2D(uInput, belowUv).rgb * 0.7;\n\n    vec3 result = mix(above, below, 1.0 - teared);\n\n    // Glow along tear edge\n    if (ptTearGlow > 0.001) {\n      float edge = smoothstep(0.04, 0.0, abs(distToLine - (ptTearAmount - 0.5)));\n      result += vec3(1.0, 0.95, 0.7) * edge * ptTearGlow;\n    }\n\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "ptTearAmount": 0.3,
      "ptTearAngle": 35,
      "ptTearJitter": 0.5,
      "ptShiftBelow": 0.5,
      "ptOffsetX": 0.05,
      "ptOffsetY": 0.02,
      "ptTearGlow": 0.3,
      "ptMode": 0
    },
    "controls": [
      {
        "name": "Tear Progress",
        "param": "ptTearAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Tear Angle",
        "param": "ptTearAngle",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 35
      },
      {
        "name": "Edge Jitter",
        "param": "ptTearJitter",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Below Shift",
        "param": "ptShiftBelow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Offset X",
        "param": "ptOffsetX",
        "min": -0.3,
        "max": 0.3,
        "step": 0.005,
        "default": 0.05
      },
      {
        "name": "Offset Y",
        "param": "ptOffsetY",
        "min": -0.3,
        "max": 0.3,
        "step": 0.005,
        "default": 0.02
      },
      {
        "name": "Tear Glow",
        "param": "ptTearGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Tear Shape",
        "param": "ptMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Line"
          },
          {
            "value": 1,
            "label": "Arc"
          },
          {
            "value": 2,
            "label": "Rectangle"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "paintPeel",
    "label": "Paint Peel",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float ppAmount;        // 0-1 peel progress\n  uniform float ppScale;         // 1-16 noise scale\n  uniform float ppLumaBias;      // 0-1 (peel darks vs lights)\n  uniform float ppCurl;          // 0-1 curl shading\n  uniform float ppShadow;        // 0-1 dark crack edge\n  uniform float ppBgR;\n  uniform float ppBgG;\n  uniform float ppBgB;\n  uniform float ppMode;          // 0=fbm, 1=cellular, 2=cracks\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float vnoise(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));\n    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));\n    vec2 u = f * f * (3.0 - 2.0 * f);\n    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n  }\n  float fbm(vec2 p) {\n    float v = 0.0; float amp = 0.5;\n    for (int i = 0; i < 4; i++) { v += vnoise(p) * amp; p *= 2.0; amp *= 0.5; }\n    return v;\n  }\n  float cellular(vec2 p) {\n    vec2 i = floor(p), f = fract(p);\n    float minD = 1.0;\n    for (int y = -1; y <= 1; y++) {\n      for (int x = -1; x <= 1; x++) {\n        vec2 g = vec2(float(x), float(y));\n        vec2 o = vec2(hash21(i + g), hash21(i + g + 13.0));\n        vec2 r = g + o - f;\n        minD = min(minD, dot(r, r));\n      }\n    }\n    return sqrt(minD);\n  }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec2 p = vUv * ppScale;\n    int mode = int(ppMode + 0.5);\n    float field;\n    if (mode == 0) field = fbm(p + uTime * 0.05);\n    else if (mode == 1) field = cellular(p);\n    else {\n      // Cracks: combine noises into thin lines\n      float n1 = fbm(p);\n      float n2 = fbm(p + 13.7);\n      field = abs(n1 - n2) * 4.0;\n    }\n    float l = luma(src);\n    float lumaWeight = mix(l, 1.0 - l, ppLumaBias);\n    float peel = step(field, ppAmount * lumaWeight + 0.1);\n\n    // Curl shading: gradient of field acts as fake highlight\n    float lift = smoothstep(ppAmount - 0.05, ppAmount + 0.05, field) * ppCurl;\n    vec3 above = src * (1.0 - lift * 0.4);\n\n    // Shadow at peel boundary\n    float shadowEdge = smoothstep(0.05, 0.0, abs(field - ppAmount));\n    above *= 1.0 - shadowEdge * ppShadow * 0.6;\n\n    vec3 below = vec3(ppBgR, ppBgG, ppBgB);\n    vec3 result = mix(above, below, peel);\n    gl_FragColor = vec4(result, 1.0);\n  }\n",
    "defaults": {
      "ppAmount": 0.3,
      "ppScale": 4,
      "ppLumaBias": 0.5,
      "ppCurl": 0.5,
      "ppShadow": 0.5,
      "ppBgR": 0.15,
      "ppBgG": 0.13,
      "ppBgB": 0.1,
      "ppMode": 0
    },
    "controls": [
      {
        "name": "Peel Progress",
        "param": "ppAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Scale",
        "param": "ppScale",
        "min": 1,
        "max": 16,
        "step": 0.25,
        "default": 4
      },
      {
        "name": "Luma Bias",
        "param": "ppLumaBias",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Curl Shading",
        "param": "ppCurl",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Edge Shadow",
        "param": "ppShadow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "BG R",
        "param": "ppBgR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.15
      },
      {
        "name": "BG G",
        "param": "ppBgG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.13
      },
      {
        "name": "BG B",
        "param": "ppBgB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      },
      {
        "name": "Pattern",
        "param": "ppMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "fBm"
          },
          {
            "value": 1,
            "label": "Cellular"
          },
          {
            "value": 2,
            "label": "Cracks"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "audioShockBloom",
    "label": "Audio Shock Bloom",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float asbIntensity;     // 0-2\n  uniform float asbBloomThreshold;// 0-1\n  uniform float asbBloomRadius;   // 1-30\n  uniform float asbShockSpeed;    // 0.1-3\n  uniform float asbShockAmplitude;// 0-0.2\n  uniform float asbChromaSplit;   // 0-1\n  uniform float asbStrobeAmount;  // 0-1\n  uniform float asbTintR;\n  uniform float asbTintG;\n  uniform float asbTintB;\n  uniform float uAudio;\n  uniform float asbAudioGate;     // 0-1 minimum audio to trigger\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    float audio = max(0.0, uAudio - asbAudioGate) * (1.0 / max(0.01, 1.0 - asbAudioGate));\n    float kick = audio * asbIntensity;\n\n    // Shockwave displacement (driven by audio)\n    vec2 d = vUv - 0.5;\n    float dist = length(d);\n    float ringR = mod(uTime * asbShockSpeed * 0.5, 1.4) - 0.2;\n    float band = smoothstep(0.06, 0.0, abs(dist - ringR));\n    vec2 dir = normalize(d + 1e-6);\n    vec2 shockOff = dir * band * asbShockAmplitude * (0.4 + kick);\n\n    // Chroma split (kick-driven)\n    vec3 col;\n    float cs = asbChromaSplit * (0.4 + kick * 0.8);\n    if (cs > 0.001) {\n      col.r = texture2D(uInput, vUv + dir * cs * 0.025 + shockOff).r;\n      col.g = texture2D(uInput, vUv + shockOff).g;\n      col.b = texture2D(uInput, vUv - dir * cs * 0.025 + shockOff).b;\n    } else {\n      col = texture2D(uInput, vUv + shockOff).rgb;\n    }\n\n    // Bloom (highlight blur)\n    vec2 texel = 1.0 / uResolution;\n    vec3 bloom = vec3(0.0);\n    float wsum = 0.0;\n    float br = asbBloomRadius * (0.5 + kick * 1.5);\n    for (int y = -3; y <= 3; y++) {\n      for (int x = -3; x <= 3; x++) {\n        if (abs(x) + abs(y) > 4) continue;\n        vec2 off = vec2(float(x), float(y)) * texel * br * 0.4;\n        vec3 s = texture2D(uInput, vUv + off).rgb;\n        float gate = smoothstep(asbBloomThreshold, asbBloomThreshold + 0.15, luma(s));\n        float w = exp(-(float(x*x + y*y)) / 8.0);\n        bloom += s * gate * w;\n        wsum += w;\n      }\n    }\n    bloom = (wsum > 0.001) ? bloom / wsum : vec3(0.0);\n    bloom *= vec3(asbTintR, asbTintG, asbTintB) * (1.0 + kick * 2.0);\n\n    // Strobe pulse\n    float strobe = 1.0 + asbStrobeAmount * kick * 1.2;\n    col *= strobe;\n\n    vec3 result = 1.0 - (1.0 - col) * (1.0 - bloom);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "asbIntensity": 1,
      "asbBloomThreshold": 0.6,
      "asbBloomRadius": 12,
      "asbShockSpeed": 0.8,
      "asbShockAmplitude": 0.05,
      "asbChromaSplit": 0.4,
      "asbStrobeAmount": 0.4,
      "asbTintR": 1,
      "asbTintG": 0.95,
      "asbTintB": 0.85,
      "asbAudioGate": 0.3
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "asbIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Bloom Threshold",
        "param": "asbBloomThreshold",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Bloom Radius",
        "param": "asbBloomRadius",
        "min": 1,
        "max": 30,
        "step": 0.5,
        "default": 12
      },
      {
        "name": "Shock Speed",
        "param": "asbShockSpeed",
        "min": 0.1,
        "max": 3,
        "step": 0.05,
        "default": 0.8
      },
      {
        "name": "Shock Amplitude",
        "param": "asbShockAmplitude",
        "min": 0,
        "max": 0.2,
        "step": 0.005,
        "default": 0.05
      },
      {
        "name": "Chroma Split",
        "param": "asbChromaSplit",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Strobe",
        "param": "asbStrobeAmount",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Tint R",
        "param": "asbTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "asbTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.95
      },
      {
        "name": "Tint B",
        "param": "asbTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Audio Gate",
        "param": "asbAudioGate",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      }
    ],
    "integerParams": []
  },
  {
    "type": "vhsFullDeck",
    "label": "VHS Full Deck",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float vhsFdTracking;      // 0-1 vertical sync drift\n  uniform float vhsFdHeadSwitch;    // 0-1 head switching noise band\n  uniform float vhsFdChromaBleed;   // 0-1\n  uniform float vhsFdDropouts;      // 0-1\n  uniform float vhsFdTapeNoise;     // 0-1\n  uniform float vhsFdScanlines;     // 0-1\n  uniform float vhsFdColorBleed;    // 0-1\n  uniform float vhsFdSaturation;    // 0-1.5\n  uniform float vhsFdTrackingJump;  // 0-1\n  uniform float vhsFdMode;          // 0=clean, 1=worn, 2=destroyed\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec2 uv = vUv;\n    int mode = int(vhsFdMode + 0.5);\n    float modeBoost = (mode == 1) ? 1.3 : (mode == 2) ? 1.8 : 1.0;\n\n    // Vertical tracking drift\n    float trackJit = sin(uv.y * 30.0 + uTime * 2.0) * 0.005 * vhsFdTracking * modeBoost;\n    uv.x += trackJit;\n\n    // Tracking jump: occasional offset\n    if (vhsFdTrackingJump > 0.001) {\n      float jump = step(0.97, hash21(vec2(floor(uTime * 4.0), 0.0))) * vhsFdTrackingJump;\n      if (uv.y < 0.4) uv.x += jump * 0.05;\n    }\n\n    // Head switch noise band at bottom\n    float headBand = smoothstep(0.05, 0.0, uv.y) * vhsFdHeadSwitch * modeBoost;\n    if (headBand > 0.01) {\n      uv.x += (hash21(vec2(uv.y * 100.0, floor(uTime * 8.0))) - 0.5) * 0.04;\n    }\n\n    // Sample with chroma bleed\n    vec3 col;\n    float cb = vhsFdChromaBleed * modeBoost * 0.04;\n    col.r = texture2D(uInput, uv + vec2(cb, 0.0)).r;\n    col.g = texture2D(uInput, uv).g;\n    col.b = texture2D(uInput, uv - vec2(cb, 0.0)).b;\n\n    // Color bleed (horizontal smear)\n    if (vhsFdColorBleed > 0.001) {\n      float bleed = vhsFdColorBleed * modeBoost;\n      col.r = mix(col.r, texture2D(uInput, uv + vec2(0.02 * bleed, 0)).r, 0.4);\n    }\n\n    // Saturation\n    float l = luma(col);\n    col = mix(vec3(l), col, vhsFdSaturation);\n\n    // Tape noise (added grain)\n    if (vhsFdTapeNoise > 0.001) {\n      float n = (hash21(vUv * uResolution + uTime * 60.0) - 0.5) * vhsFdTapeNoise * modeBoost * 0.4;\n      col += vec3(n);\n    }\n\n    // Scanlines\n    if (vhsFdScanlines > 0.001) {\n      float sl = sin(uv.y * 800.0) * 0.5 + 0.5;\n      col *= mix(1.0, sl * 0.6 + 0.4, vhsFdScanlines * modeBoost);\n    }\n\n    // Dropouts: random horizontal bright stripes\n    if (vhsFdDropouts > 0.001) {\n      float yB = floor(uv.y * 60.0);\n      float drop = step(0.93, hash21(vec2(yB, floor(uTime * 6.0))));\n      col += vec3(drop * vhsFdDropouts * modeBoost * 0.6);\n    }\n\n    // Head band overlay (washes color)\n    col += vec3(headBand * 0.5);\n\n    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "vhsFdTracking": 0.5,
      "vhsFdHeadSwitch": 0.4,
      "vhsFdChromaBleed": 0.5,
      "vhsFdDropouts": 0.3,
      "vhsFdTapeNoise": 0.4,
      "vhsFdScanlines": 0.4,
      "vhsFdColorBleed": 0.3,
      "vhsFdSaturation": 0.85,
      "vhsFdTrackingJump": 0.1,
      "vhsFdMode": 1
    },
    "controls": [
      {
        "name": "Tracking",
        "param": "vhsFdTracking",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Head Switch",
        "param": "vhsFdHeadSwitch",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Chroma Bleed",
        "param": "vhsFdChromaBleed",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Dropouts",
        "param": "vhsFdDropouts",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Tape Noise",
        "param": "vhsFdTapeNoise",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Scanlines",
        "param": "vhsFdScanlines",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Color Bleed",
        "param": "vhsFdColorBleed",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Saturation",
        "param": "vhsFdSaturation",
        "min": 0,
        "max": 1.5,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Tracking Jump",
        "param": "vhsFdTrackingJump",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.1
      },
      {
        "name": "Tape Condition",
        "param": "vhsFdMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 1,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Clean"
          },
          {
            "value": 1,
            "label": "Worn"
          },
          {
            "value": 2,
            "label": "Destroyed"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "clubLaserGrid",
    "label": "Club Laser Grid",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float clgIntensity;     // 0-2\n  uniform float clgGridDensity;   // 4-32\n  uniform float clgPerspective;   // 0-1 fake 3D depth\n  uniform float clgSpeed;         // 0-3\n  uniform float clgIntersectionGlow; // 0-1\n  uniform float clgLineWidth;     // 0.5-4\n  uniform float clgTintR;\n  uniform float clgTintG;\n  uniform float clgTintB;\n  uniform float uAudio;\n  uniform float clgAudioReact;    // 0-2\n  uniform float clgMode;          // 0=floor grid, 1=ceiling, 2=tunnel\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    int mode = int(clgMode + 0.5);\n\n    // Perspective transform\n    vec2 uv = vUv;\n    if (mode == 0) {\n      // Floor: bottom is closer, top is further\n      float persp = mix(1.0, 0.2, uv.y * clgPerspective);\n      uv.x = (uv.x - 0.5) / persp + 0.5;\n      uv.y = mix(uv.y, pow(uv.y, 2.0), clgPerspective);\n    } else if (mode == 1) {\n      // Ceiling: inverted floor\n      float persp = mix(1.0, 0.2, (1.0 - uv.y) * clgPerspective);\n      uv.x = (uv.x - 0.5) / persp + 0.5;\n      uv.y = mix(uv.y, 1.0 - pow(1.0 - uv.y, 2.0), clgPerspective);\n    } else {\n      // Tunnel: radial perspective\n      vec2 d = uv - 0.5;\n      float r = length(d);\n      uv = 0.5 + d / max(0.01, r * clgPerspective + (1.0 - clgPerspective));\n    }\n\n    // Animated grid lines\n    float t = uTime * clgSpeed;\n    float audioBoost = 1.0 + uAudio * clgAudioReact;\n    vec2 grid = abs(fract(uv * clgGridDensity * audioBoost - vec2(0.0, t * 0.3)) - 0.5);\n    float lineX = smoothstep(clgLineWidth * 0.02, 0.0, grid.x);\n    float lineY = smoothstep(clgLineWidth * 0.02, 0.0, grid.y);\n    float gridLine = max(lineX, lineY);\n\n    // Intersection brightness\n    float intersect = lineX * lineY * clgIntersectionGlow * (1.0 + audioBoost);\n\n    vec3 grid3 = vec3(clgTintR, clgTintG, clgTintB) * (gridLine + intersect * 2.0) * clgIntensity;\n    vec3 result = 1.0 - (1.0 - src) * (1.0 - grid3);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "clgIntensity": 1,
      "clgGridDensity": 12,
      "clgPerspective": 0.7,
      "clgSpeed": 1,
      "clgIntersectionGlow": 0.7,
      "clgLineWidth": 1.5,
      "clgTintR": 0.2,
      "clgTintG": 1,
      "clgTintB": 0.5,
      "clgAudioReact": 0.7,
      "clgMode": 0
    },
    "controls": [
      {
        "name": "Intensity",
        "param": "clgIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Grid Density",
        "param": "clgGridDensity",
        "min": 4,
        "max": 32,
        "step": 1,
        "default": 12
      },
      {
        "name": "Perspective",
        "param": "clgPerspective",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Speed",
        "param": "clgSpeed",
        "min": 0,
        "max": 3,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Intersection Glow",
        "param": "clgIntersectionGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Line Width",
        "param": "clgLineWidth",
        "min": 0.5,
        "max": 4,
        "step": 0.05,
        "default": 1.5
      },
      {
        "name": "Tint R",
        "param": "clgTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.2
      },
      {
        "name": "Tint G",
        "param": "clgTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint B",
        "param": "clgTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Audio React",
        "param": "clgAudioReact",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.7
      },
      {
        "name": "Perspective",
        "param": "clgMode",
        "min": 0,
        "max": 2,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Floor Grid"
          },
          {
            "value": 1,
            "label": "Ceiling"
          },
          {
            "value": 2,
            "label": "Tunnel"
          }
        ]
      }
    ],
    "integerParams": []
  },
  {
    "type": "thermalContour",
    "label": "Thermal Contour",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float tcPalette;       // 0=ironbow, 1=jet, 2=viridis, 3=inferno\n  uniform float tcContourCount;  // 1-12 isolines\n  uniform float tcContourWidth;  // 0.001-0.02\n  uniform float tcContourGlow;   // 0-1\n  uniform float tcIntensity;     // 0-2\n  uniform float tcTrackBlobs;    // 0-1 highlight bright clusters\n  uniform float tcMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  vec3 paletteCol(float t) {\n    int p = int(tcPalette + 0.5);\n    if (p == 0) {\n      // Ironbow\n      vec3 c = mix(vec3(0, 0, 0.3), vec3(0.5, 0, 0.5), smoothstep(0.0, 0.25, t));\n      c = mix(c, vec3(1, 0.3, 0), smoothstep(0.25, 0.55, t));\n      c = mix(c, vec3(1, 1, 0.2), smoothstep(0.55, 0.85, t));\n      c = mix(c, vec3(1, 1, 1), smoothstep(0.85, 1.0, t));\n      return c;\n    } else if (p == 1) {\n      // Jet\n      return vec3(\n        smoothstep(0.35, 0.65, t) - smoothstep(0.85, 1.0, t),\n        smoothstep(0.0, 0.35, t) - smoothstep(0.65, 1.0, t),\n        smoothstep(0.0, 0.15, t) - smoothstep(0.5, 0.7, t)\n      );\n    } else if (p == 2) {\n      // Viridis\n      return vec3(0.27 + 0.5 * t, 0.005 + 0.9 * t, 0.33 + 0.5 * (1.0 - t));\n    } else {\n      // Inferno\n      vec3 c = mix(vec3(0, 0, 0), vec3(0.4, 0, 0.4), smoothstep(0.0, 0.3, t));\n      c = mix(c, vec3(0.95, 0.4, 0.1), smoothstep(0.3, 0.65, t));\n      c = mix(c, vec3(1, 1, 0.6), smoothstep(0.65, 1.0, t));\n      return c;\n    }\n  }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    float l = luma(src);\n    vec3 thermal = paletteCol(l) * tcIntensity;\n\n    // Contour isolines\n    float cw = max(0.001, tcContourWidth);\n    float bands = max(1.0, tcContourCount);\n    float bandPos = fract(l * bands);\n    float contour = smoothstep(cw, 0.0, abs(bandPos - 0.5)) * tcContourGlow;\n    thermal += vec3(1.0) * contour;\n\n    // Track blobs: highlight luma clusters\n    if (tcTrackBlobs > 0.001) {\n      vec2 texel = 1.0 / uResolution;\n      float lN = luma(texture2D(uInput, vUv + texel * vec2(0, 4)).rgb);\n      float lS = luma(texture2D(uInput, vUv + texel * vec2(0, -4)).rgb);\n      float lE = luma(texture2D(uInput, vUv + texel * vec2(4, 0)).rgb);\n      float lW = luma(texture2D(uInput, vUv + texel * vec2(-4, 0)).rgb);\n      float gradMag = abs(l - lN) + abs(l - lS) + abs(l - lE) + abs(l - lW);\n      thermal += vec3(0.2, 1.0, 0.8) * smoothstep(0.6, 1.0, l) * tcTrackBlobs * (1.0 - gradMag);\n    }\n\n    vec3 result = mix(src, thermal, tcMix);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "tcPalette": 0,
      "tcContourCount": 8,
      "tcContourWidth": 0.005,
      "tcContourGlow": 0.5,
      "tcIntensity": 1,
      "tcTrackBlobs": 0.4,
      "tcMix": 0.85
    },
    "controls": [
      {
        "name": "Palette",
        "param": "tcPalette",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "Ironbow"
          },
          {
            "value": 1,
            "label": "Jet"
          },
          {
            "value": 2,
            "label": "Viridis"
          },
          {
            "value": 3,
            "label": "Inferno"
          }
        ]
      },
      {
        "name": "Contour Count",
        "param": "tcContourCount",
        "min": 1,
        "max": 12,
        "step": 1,
        "default": 8
      },
      {
        "name": "Contour Width",
        "param": "tcContourWidth",
        "min": 0.001,
        "max": 0.02,
        "step": 0.0005,
        "default": 0.005
      },
      {
        "name": "Contour Glow",
        "param": "tcContourGlow",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Intensity",
        "param": "tcIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Track Blobs",
        "param": "tcTrackBlobs",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Mix",
        "param": "tcMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      }
    ],
    "integerParams": []
  },
  {
    "type": "dreamDiffusion",
    "label": "Dream Diffusion Look",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float ddBloomAmount;   // 0-2\n  uniform float ddBloomRadius;   // 1-30\n  uniform float ddHalation;      // 0-1\n  uniform float ddChromaticBlur; // 0-1\n  uniform float ddPastelRolloff; // 0-1 desaturate highlights toward pastel\n  uniform float ddShadowLift;    // 0-0.5\n  uniform float ddSoftness;      // 0-1 overall softness\n  uniform float ddTintR;\n  uniform float ddTintG;\n  uniform float ddTintB;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec2 texel = 1.0 / uResolution;\n\n    // Chromatic blur per channel\n    vec3 cbCol = src;\n    if (ddChromaticBlur > 0.001) {\n      float cb = ddChromaticBlur * 6.0;\n      vec3 acc = vec3(0.0);\n      float wsum = 0.0;\n      for (int y = -2; y <= 2; y++) {\n        for (int x = -2; x <= 2; x++) {\n          vec2 off = vec2(float(x), float(y)) * texel * cb;\n          float w = exp(-(float(x*x + y*y)) / 4.0);\n          acc.r += texture2D(uInput, vUv + off * 1.05).r * w;\n          acc.g += texture2D(uInput, vUv + off).g * w;\n          acc.b += texture2D(uInput, vUv + off * 0.95).b * w;\n          wsum += w;\n        }\n      }\n      cbCol = acc / wsum;\n    }\n\n    // Bloom on highlights\n    vec3 bloom = vec3(0.0);\n    float wsum2 = 0.0;\n    for (int y = -3; y <= 3; y++) {\n      for (int x = -3; x <= 3; x++) {\n        if (abs(x) + abs(y) > 4) continue;\n        vec2 off = vec2(float(x), float(y)) * texel * ddBloomRadius * 0.4;\n        vec3 s = texture2D(uInput, vUv + off).rgb;\n        float gate = smoothstep(0.55, 0.85, luma(s));\n        float w = exp(-(float(x*x + y*y)) / 8.0);\n        bloom += s * gate * w;\n        wsum2 += w;\n      }\n    }\n    bloom = (wsum2 > 0.001) ? bloom / wsum2 : vec3(0.0);\n    bloom *= ddBloomAmount;\n\n    // Halation (warm bleed around highlights)\n    vec3 halo = bloom * vec3(1.0, 0.6, 0.4) * ddHalation;\n\n    // Pastel rolloff: desaturate highlights toward white\n    float l = luma(cbCol);\n    if (ddPastelRolloff > 0.001) {\n      vec3 pastel = mix(cbCol, vec3(1.0), smoothstep(0.7, 1.0, l) * ddPastelRolloff);\n      cbCol = pastel;\n    }\n\n    // Shadow lift\n    cbCol += vec3(ddShadowLift) * (1.0 - smoothstep(0.0, 0.4, l));\n\n    // Combine\n    vec3 result = cbCol + bloom + halo;\n    result *= vec3(ddTintR, ddTintG, ddTintB);\n    // Overall softness via slight blur mix\n    result = mix(result, mix(result, src, 0.5), ddSoftness * 0.3);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "ddBloomAmount": 1.2,
      "ddBloomRadius": 14,
      "ddHalation": 0.5,
      "ddChromaticBlur": 0.4,
      "ddPastelRolloff": 0.6,
      "ddShadowLift": 0.15,
      "ddSoftness": 0.4,
      "ddTintR": 1.05,
      "ddTintG": 1,
      "ddTintB": 0.95
    },
    "controls": [
      {
        "name": "Bloom",
        "param": "ddBloomAmount",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1.2
      },
      {
        "name": "Bloom Radius",
        "param": "ddBloomRadius",
        "min": 1,
        "max": 30,
        "step": 0.5,
        "default": 14
      },
      {
        "name": "Halation",
        "param": "ddHalation",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Chromatic Blur",
        "param": "ddChromaticBlur",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Pastel Rolloff",
        "param": "ddPastelRolloff",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.6
      },
      {
        "name": "Shadow Lift",
        "param": "ddShadowLift",
        "min": 0,
        "max": 0.5,
        "step": 0.01,
        "default": 0.15
      },
      {
        "name": "Softness",
        "param": "ddSoftness",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.4
      },
      {
        "name": "Tint R",
        "param": "ddTintR",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1.05
      },
      {
        "name": "Tint G",
        "param": "ddTintG",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint B",
        "param": "ddTintB",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 0.95
      }
    ],
    "integerParams": []
  },
  {
    "type": "topoWarp",
    "label": "Topographic Depth Warp",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float twContourCount;  // 4-32\n  uniform float twContourWidth;  // 0.001-0.05\n  uniform float twDisplacement;  // 0-1\n  uniform float twChromaticEdge; // 0-1\n  uniform float twColorR;        // contour line color\n  uniform float twColorG;\n  uniform float twColorB;\n  uniform float twShadowRidges;  // 0-1\n  uniform float twMix;           // 0-1\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    vec2 texel = 1.0 / uResolution;\n\n    // Estimate gradient of luma\n    float l = luma(src);\n    float lE = luma(texture2D(uInput, vUv + texel * vec2(1, 0)).rgb);\n    float lN = luma(texture2D(uInput, vUv + texel * vec2(0, 1)).rgb);\n    vec2 grad = vec2(lE - l, lN - l);\n\n    // Contour bands\n    float bands = max(1.0, twContourCount);\n    float bandPos = fract(l * bands);\n    float ridge = smoothstep(twContourWidth * 5.0, 0.0, abs(bandPos - 0.5));\n\n    // Displacement: shift sample along gradient by ridge\n    vec2 disp = grad * ridge * twDisplacement * 0.3;\n    vec3 col;\n    if (twChromaticEdge > 0.001) {\n      col.r = texture2D(uInput, vUv + disp * (1.0 + twChromaticEdge * 0.5)).r;\n      col.g = texture2D(uInput, vUv + disp).g;\n      col.b = texture2D(uInput, vUv + disp * (1.0 - twChromaticEdge * 0.5)).b;\n    } else {\n      col = texture2D(uInput, vUv + disp).rgb;\n    }\n\n    // Contour line overlay\n    vec3 contour = vec3(twColorR, twColorG, twColorB) * ridge;\n\n    // Shadow ridges (darker on one side of contour)\n    if (twShadowRidges > 0.001) {\n      float side = step(0.5, bandPos);\n      col *= 1.0 - side * ridge * twShadowRidges * 0.5;\n    }\n\n    vec3 result = mix(src, col + contour, twMix);\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "twContourCount": 12,
      "twContourWidth": 0.008,
      "twDisplacement": 0.5,
      "twChromaticEdge": 0.3,
      "twColorR": 0,
      "twColorG": 0.85,
      "twColorB": 1,
      "twShadowRidges": 0.5,
      "twMix": 0.85
    },
    "controls": [
      {
        "name": "Contour Count",
        "param": "twContourCount",
        "min": 4,
        "max": 32,
        "step": 1,
        "default": 12
      },
      {
        "name": "Contour Width",
        "param": "twContourWidth",
        "min": 0.001,
        "max": 0.05,
        "step": 0.001,
        "default": 0.008
      },
      {
        "name": "Displacement",
        "param": "twDisplacement",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Chromatic Edge",
        "param": "twChromaticEdge",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.3
      },
      {
        "name": "Line R",
        "param": "twColorR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0
      },
      {
        "name": "Line G",
        "param": "twColorG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      },
      {
        "name": "Line B",
        "param": "twColorB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Shadow Ridges",
        "param": "twShadowRidges",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.5
      },
      {
        "name": "Mix",
        "param": "twMix",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 0.85
      }
    ],
    "integerParams": []
  },
  {
    "type": "strobeSequencer",
    "label": "Strobe Sequencer",
    "category": "New Hero",
    "fragment": "precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n\n  uniform sampler2D uInput;\n  uniform float ssBPM;           // 30-240\n  uniform float ssSteps;         // 4-16 step count per bar\n  uniform float ssPattern;       // bit-encoded pattern (0..(2^16-1))\n  uniform float ssMode;          // 0=on/off, 1=invert, 2=tint, 3=zoom\n  uniform float ssIntensity;     // 0-2\n  uniform float ssTintR;\n  uniform float ssTintG;\n  uniform float ssTintB;\n  uniform float ssSwing;         // 0-0.5 (offbeat shift)\n  uniform float uTime;\n  uniform vec2 uResolution;\n  varying vec2 vUv;\n\n  void main() {\n    vec3 src = texture2D(uInput, vUv).rgb;\n    int steps = int(clamp(ssSteps, 1.0, 16.0));\n    float beatLen = 60.0 / max(1.0, ssBPM);\n    float stepLen = beatLen / float(steps) * 4.0; // 16 steps = 1 bar @4/4\n    float t = uTime;\n    float stepF = mod(t / stepLen, float(steps));\n    int stepIdx = int(stepF);\n    // Apply swing on odd steps\n    float frac = fract(stepF);\n    if (int(mod(float(stepIdx), 2.)) == 1) frac = clamp(frac - ssSwing, 0.0, 1.0);\n\n    // Decode pattern bit (ssPattern is treated as bitmask)\n    float patternF = ssPattern;\n    float bitVal = mod(floor(patternF / pow(2.0, float(stepIdx))), 2.0);\n    float gate = (bitVal > 0.5 && frac < 0.5) ? 1.0 : 0.0;\n\n    int mode = int(ssMode + 0.5);\n    vec3 tint = vec3(ssTintR, ssTintG, ssTintB);\n    vec3 result = src;\n    if (mode == 0) {\n      result = mix(src, src + tint * ssIntensity, gate);\n    } else if (mode == 1) {\n      result = mix(src, 1.0 - src, gate * ssIntensity);\n    } else if (mode == 2) {\n      result = mix(src, src * tint + tint * 0.4, gate * ssIntensity);\n    } else {\n      // Zoom-on-beat\n      vec2 d = vUv - 0.5;\n      float zoom = 1.0 + gate * ssIntensity * 0.1;\n      vec2 sUv = 0.5 + d / zoom;\n      sUv = clamp(sUv, vec2(0.0), vec2(1.0));\n      result = texture2D(uInput, sUv).rgb;\n    }\n    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);\n  }\n",
    "defaults": {
      "ssBPM": 120,
      "ssSteps": 16,
      "ssPattern": 21845,
      "ssMode": 0,
      "ssIntensity": 1,
      "ssTintR": 1,
      "ssTintG": 1,
      "ssTintB": 1,
      "ssSwing": 0
    },
    "controls": [
      {
        "name": "BPM",
        "param": "ssBPM",
        "min": 30,
        "max": 240,
        "step": 1,
        "default": 120
      },
      {
        "name": "Steps",
        "param": "ssSteps",
        "min": 4,
        "max": 16,
        "step": 1,
        "default": 16
      },
      {
        "name": "Pattern (bitmask)",
        "param": "ssPattern",
        "min": 0,
        "max": 65535,
        "step": 1,
        "default": 21845
      },
      {
        "name": "Mode",
        "param": "ssMode",
        "min": 0,
        "max": 3,
        "step": 1,
        "default": 0,
        "type": "select",
        "options": [
          {
            "value": 0,
            "label": "On/Off"
          },
          {
            "value": 1,
            "label": "Invert"
          },
          {
            "value": 2,
            "label": "Tint"
          },
          {
            "value": 3,
            "label": "Zoom"
          }
        ]
      },
      {
        "name": "Intensity",
        "param": "ssIntensity",
        "min": 0,
        "max": 2,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint R",
        "param": "ssTintR",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint G",
        "param": "ssTintG",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Tint B",
        "param": "ssTintB",
        "min": 0,
        "max": 1,
        "step": 0.01,
        "default": 1
      },
      {
        "name": "Swing",
        "param": "ssSwing",
        "min": 0,
        "max": 0.5,
        "step": 0.01,
        "default": 0
      }
    ],
    "integerParams": []
  }
];
