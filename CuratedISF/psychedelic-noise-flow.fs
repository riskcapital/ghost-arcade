/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Psychedelic Noise Flow - Flowing Patterns with Edge/Dither/Outline Modes",
  "INPUTS": [
    {
      "NAME": "noiseMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 7.0
    },
    {
      "NAME": "scale",
      "TYPE": "float",
      "DEFAULT": 3.0,
      "MIN": 0.5,
      "MAX": 15.0
    },
    {
      "NAME": "flowSpeed",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "flowAmount",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "octaves",
      "TYPE": "float",
      "DEFAULT": 4.0,
      "MIN": 1.0,
      "MAX": 8.0
    },
    {
      "NAME": "turbulence",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "renderMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 6.0
    },
    {
      "NAME": "edgeThreshold",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "edgeThickness",
      "TYPE": "float",
      "DEFAULT": 0.005,
      "MIN": 0.001,
      "MAX": 0.02
    },
    {
      "NAME": "ditherLevels",
      "TYPE": "float",
      "DEFAULT": 4.0,
      "MIN": 2.0,
      "MAX": 16.0
    },
    {
      "NAME": "ditherScale",
      "TYPE": "float",
      "DEFAULT": 8.0,
      "MIN": 2.0,
      "MAX": 32.0
    },
    {
      "NAME": "contourLevels",
      "TYPE": "float",
      "DEFAULT": 8.0,
      "MIN": 2.0,
      "MAX": 20.0
    },
    {
      "NAME": "contourThickness",
      "TYPE": "float",
      "DEFAULT": 0.03,
      "MIN": 0.01,
      "MAX": 0.2
    },
    {
      "NAME": "colorMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 8.0
    },
    {
      "NAME": "colorShift",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "colorCycle",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "warpAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "posterize",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "posterizeLevels",
      "TYPE": "float",
      "DEFAULT": 5.0,
      "MIN": 2.0,
      "MAX": 16.0
    },
    {
      "NAME": "invert",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "contrast",
      "TYPE": "float",
      "DEFAULT": 1.5,
      "MIN": 0.5,
      "MAX": 3.0
    },
    {
      "NAME": "brightness",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.5,
      "MAX": 2.0
    }
  ]
}*/

// ============================================================================
// Psychedelic Noise Flow - Morphing Noise with Multiple Render Modes
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359

// Hash function
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 2D Noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(a, b, f.x) + (c - a) * f.y * (1.0 - f.x) + (d - b) * f.x * f.y;
}

// Fractal Brownian Motion
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// Turbulent noise
float turbulence_noise(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        value += amplitude * abs(noise(p * frequency) * 2.0 - 1.0);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// Domain warping
vec2 warp(vec2 p, float amount, float time) {
    float n1 = fbm(p + vec2(time * 0.2, 0.0), 3);
    float n2 = fbm(p + vec2(0.0, time * 0.2), 3);
    return p + vec2(n1, n2) * amount;
}

// Get noise value based on mode
float getNoiseValue(vec2 uv, float time, int mode, int octaveCount) {
    vec2 p = uv * scale;

    // Add flow
    p += vec2(
        sin(time * flowSpeed + uv.y * 2.0) * flowAmount,
        cos(time * flowSpeed + uv.x * 2.0) * flowAmount
    );

    // Add warping
    if (warpAmount > 0.0) {
        p = warp(p, warpAmount * 2.0, time);
    }

    float n = 0.0;

    if (mode == 0) {
        // Classic FBM
        n = fbm(p, octaveCount);

    } else if (mode == 1) {
        // Turbulence
        n = turbulence_noise(p, octaveCount);

    } else if (mode == 2) {
        // Ridged multifractal
        n = 1.0 - abs(fbm(p, octaveCount) * 2.0 - 1.0);

    } else if (mode == 3) {
        // Marble/wood grain
        n = sin(p.x + fbm(p, octaveCount) * turbulence * 5.0) * 0.5 + 0.5;

    } else if (mode == 4) {
        // Swirling vortex
        float angle = atan(p.y, p.x);
        float radius = length(p);
        n = fbm(vec2(angle + radius * 2.0 + time * 0.5, radius), octaveCount);

    } else if (mode == 5) {
        // Cellular/organic
        vec2 i = floor(p);
        vec2 f = fract(p);
        float minDist = 1.0;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 neighbor = vec2(float(x), float(y));
                vec2 point = hash(i + neighbor) * vec2(
                    sin(time * 0.5 + hash(i + neighbor) * 6.28),
                    cos(time * 0.5 + hash(i + neighbor + vec2(1.0)) * 6.28)
                ) * 0.5 + 0.5;
                vec2 diff = neighbor + point - f;
                minDist = min(minDist, length(diff));
            }
        }
        n = minDist;

    } else if (mode == 6) {
        // Liquid/flow field
        vec2 flow = vec2(
            fbm(p + time * 0.3, octaveCount),
            fbm(p + vec2(100.0) + time * 0.3, octaveCount)
        );
        n = fbm(p + flow * turbulence * 2.0, octaveCount);

    } else {
        // Psychedelic interference
        float n1 = sin(p.x * 2.0 + time) * cos(p.y * 2.0 + time);
        float n2 = fbm(p + vec2(time * 0.5), octaveCount);
        n = (n1 * 0.5 + 0.5) * n2;
    }

    return n;
}

// Bayer matrix for dithering
float bayer8x8(vec2 pos) {
    int x = int(mod(pos.x, 8.0));
    int y = int(mod(pos.y, 8.0));

    float pattern[64];
    pattern[0] = 0.0; pattern[1] = 32.0; pattern[2] = 8.0; pattern[3] = 40.0; pattern[4] = 2.0; pattern[5] = 34.0; pattern[6] = 10.0; pattern[7] = 42.0;
    pattern[8] = 48.0; pattern[9] = 16.0; pattern[10] = 56.0; pattern[11] = 24.0; pattern[12] = 50.0; pattern[13] = 18.0; pattern[14] = 58.0; pattern[15] = 26.0;
    pattern[16] = 12.0; pattern[17] = 44.0; pattern[18] = 4.0; pattern[19] = 36.0; pattern[20] = 14.0; pattern[21] = 46.0; pattern[22] = 6.0; pattern[23] = 38.0;
    pattern[24] = 60.0; pattern[25] = 28.0; pattern[26] = 52.0; pattern[27] = 20.0; pattern[28] = 62.0; pattern[29] = 30.0; pattern[30] = 54.0; pattern[31] = 22.0;
    pattern[32] = 3.0; pattern[33] = 35.0; pattern[34] = 11.0; pattern[35] = 43.0; pattern[36] = 1.0; pattern[37] = 33.0; pattern[38] = 9.0; pattern[39] = 41.0;
    pattern[40] = 51.0; pattern[41] = 19.0; pattern[42] = 59.0; pattern[43] = 27.0; pattern[44] = 49.0; pattern[45] = 17.0; pattern[46] = 57.0; pattern[47] = 25.0;
    pattern[48] = 15.0; pattern[49] = 47.0; pattern[50] = 7.0; pattern[51] = 39.0; pattern[52] = 13.0; pattern[53] = 45.0; pattern[54] = 5.0; pattern[55] = 37.0;
    pattern[56] = 63.0; pattern[57] = 31.0; pattern[58] = 55.0; pattern[59] = 23.0; pattern[60] = 61.0; pattern[61] = 29.0; pattern[62] = 53.0; pattern[63] = 21.0;

    return pattern[y * 8 + x] / 64.0;
}

// Get psychedelic color
vec3 getColor(float value, int mode, float time) {
    float hueShift = colorShift + colorCycle * time * 0.2;

    if (mode == 0) {
        // Rainbow psychedelic
        float hue = value + hueShift;
        return vec3(
            sin(hue * 6.28) * 0.5 + 0.5,
            sin(hue * 6.28 + 2.094) * 0.5 + 0.5,
            sin(hue * 6.28 + 4.189) * 0.5 + 0.5
        );

    } else if (mode == 1) {
        // Fire/lava
        return vec3(
            value,
            value * value * 0.7,
            max(0.0, value - 0.7) * 3.0
        );

    } else if (mode == 2) {
        // Electric plasma
        return mix(
            vec3(0.0, 0.5, 1.0),
            vec3(1.0, 0.0, 0.8),
            value
        );

    } else if (mode == 3) {
        // Toxic acid
        float hue = value * 0.3 + hueShift;
        return vec3(
            sin(hue * 6.28) * 0.5 + 0.5,
            value * 1.5,
            sin(hue * 6.28 + 2.0) * 0.3 + 0.3
        );

    } else if (mode == 4) {
        // Vaporwave
        return mix(
            vec3(1.0, 0.2, 0.7),
            vec3(0.2, 0.8, 1.0),
            value
        );

    } else if (mode == 5) {
        // Monochrome
        return vec3(value);

    } else if (mode == 6) {
        // Dual tone
        return mix(
            vec3(0.1, 0.0, 0.3),
            vec3(1.0, 0.8, 0.2),
            value
        );

    } else if (mode == 7) {
        // Infrared
        return vec3(
            1.0 - value,
            value * (1.0 - value) * 4.0,
            value
        );

    } else {
        // Shifting spectrum
        float hue = value * 3.0 + hueShift + sin(value * 10.0 + time) * 0.2;
        return vec3(
            sin(hue * 6.28) * 0.5 + 0.5,
            sin(hue * 6.28 + 2.094) * 0.5 + 0.5,
            sin(hue * 6.28 + 4.189) * 0.5 + 0.5
        );
    }
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float time = TIME;

    int nMode = int(noiseMode);
    int rMode = int(renderMode);
    int cMode = int(colorMode);
    int octaveCount = int(octaves);

    // Get base noise value
    float noiseVal = getNoiseValue(uv, time, nMode, octaveCount);

    vec3 col = vec3(0.0);

    if (rMode == 0) {
        // Standard psychedelic
        col = getColor(noiseVal, cMode, time);

    } else if (rMode == 1) {
        // Edge detection
        vec2 offset = vec2(edgeThickness);
        float n0 = noiseVal;
        float nx = getNoiseValue(uv + vec2(offset.x, 0.0), time, nMode, octaveCount);
        float ny = getNoiseValue(uv + vec2(0.0, offset.y), time, nMode, octaveCount);

        float edge = length(vec2(nx - n0, ny - n0));

        if (edge > edgeThreshold) {
            col = getColor(noiseVal, cMode, time);
        } else {
            col = vec3(0.0);
        }

    } else if (rMode == 2) {
        // Heavy dither
        vec2 ditherPos = gl_FragCoord.xy / ditherScale;
        float threshold = bayer8x8(ditherPos);
        float quantized = floor(noiseVal * ditherLevels) / ditherLevels;

        if (fract(noiseVal * ditherLevels) > threshold) {
            quantized = ceil(noiseVal * ditherLevels) / ditherLevels;
        }

        col = getColor(quantized, cMode, time);

    } else if (rMode == 3) {
        // Contour lines
        float contour = fract(noiseVal * contourLevels);

        if (contour < contourThickness) {
            col = getColor(noiseVal, cMode, time);
        } else {
            col = vec3(0.0);
        }

    } else if (rMode == 4) {
        // Filled contours with outlines
        float level = floor(noiseVal * contourLevels) / contourLevels;
        float contour = fract(noiseVal * contourLevels);

        if (contour < contourThickness) {
            col = vec3(1.0); // White outline
        } else {
            col = getColor(level, cMode, time);
        }

    } else if (rMode == 5) {
        // High contrast line art
        vec2 offset = vec2(edgeThickness);
        float n0 = noiseVal;
        float nx = getNoiseValue(uv + vec2(offset.x, 0.0), time, nMode, octaveCount);
        float ny = getNoiseValue(uv + vec2(0.0, offset.y), time, nMode, octaveCount);

        float edge = length(vec2(nx - n0, ny - n0));

        // Dither on top
        vec2 ditherPos = gl_FragCoord.xy / ditherScale;
        float threshold = bayer8x8(ditherPos);
        float dithered = step(threshold, noiseVal);

        if (edge > edgeThreshold) {
            col = vec3(1.0);
        } else {
            col = vec3(dithered);
        }

    } else {
        // Posterized with outlines
        float posterized = floor(noiseVal * posterizeLevels) / posterizeLevels;

        // Edge detection on posterized
        vec2 offset = vec2(edgeThickness);
        float p0 = posterized;
        float px = floor(getNoiseValue(uv + vec2(offset.x, 0.0), time, nMode, octaveCount) * posterizeLevels) / posterizeLevels;
        float py = floor(getNoiseValue(uv + vec2(0.0, offset.y), time, nMode, octaveCount) * posterizeLevels) / posterizeLevels;

        if (abs(px - p0) > 0.01 || abs(py - p0) > 0.01) {
            col = vec3(0.0); // Black outline
        } else {
            col = getColor(posterized, cMode, time);
        }
    }

    // Posterize if enabled
    if (posterize > 0.0 && rMode == 0) {
        col = floor(col * posterizeLevels) / posterizeLevels;
    }

    // Invert
    if (invert > 0.5) {
        col = 1.0 - col;
    }

    // Post processing
    col = pow(col, vec3(1.0 / contrast));
    col *= brightness;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
