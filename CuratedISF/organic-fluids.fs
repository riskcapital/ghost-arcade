/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Organic Fluids - Psychedelic Metaballs and Turbulent Fields",
  "INPUTS": [
    {
      "NAME": "flowSpeed",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "turbulence",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "blobCount",
      "TYPE": "float",
      "DEFAULT": 8.0,
      "MIN": 3.0,
      "MAX": 20.0
    },
    {
      "NAME": "blobSize",
      "TYPE": "float",
      "DEFAULT": 0.15,
      "MIN": 0.05,
      "MAX": 0.4
    },
    {
      "NAME": "threshold",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.1,
      "MAX": 1.5
    },
    {
      "NAME": "colorBleed",
      "TYPE": "float",
      "DEFAULT": 0.6,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "hueShift",
      "TYPE": "float",
      "DEFAULT": 0.1,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "saturation",
      "TYPE": "float",
      "DEFAULT": 0.8,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "noiseScale",
      "TYPE": "float",
      "DEFAULT": 3.0,
      "MIN": 1.0,
      "MAX": 10.0
    },
    {
      "NAME": "distortAmount",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "cellularMix",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "pulseSpeed",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "brightnessBoost",
      "TYPE": "float",
      "DEFAULT": 1.2,
      "MIN": 0.5,
      "MAX": 3.0
    },
    {
      "NAME": "chromaShift",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    }
  ]
}*/

// ============================================================================
// Organic Fluids - Experimental Psychedelic Shader
// By Justin Robie Wood
// ============================================================================

// Hash function for noise
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
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

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion - layered noise
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// Voronoi/Cellular pattern
vec2 voronoi(vec2 p) {
    vec2 i_p = floor(p);
    vec2 f_p = fract(p);

    float minDist = 1.0;
    vec2 minPoint;

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = hash(i_p + neighbor) * vec2(1.0) + neighbor;
            vec2 diff = point - f_p;
            float dist = length(diff);

            if (dist < minDist) {
                minDist = dist;
                minPoint = point;
            }
        }
    }

    return vec2(minDist, hash(i_p + floor(minPoint)));
}

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Smooth minimum for organic blending
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Metaball field
float metaballs(vec2 uv, float time) {
    float field = 0.0;
    int count = int(blobCount);

    for (int i = 0; i < 20; i++) {
        if (i >= count) break;

        float fi = float(i);
        float angle = time * flowSpeed * 0.3 + fi * 6.2831 / float(count);
        float radius = 0.3 + 0.2 * sin(time * pulseSpeed * 0.5 + fi * 2.1);

        // Orbit position with some variation
        vec2 pos = vec2(
            0.5 + cos(angle) * radius + sin(time * 0.4 + fi) * 0.1,
            0.5 + sin(angle) * radius + cos(time * 0.3 + fi) * 0.1
        );

        float dist = length(uv - pos);
        float size = blobSize * (1.0 + 0.3 * sin(time * pulseSpeed + fi * 1.7));

        // Metaball contribution
        field += size / (dist * dist + 0.001);
    }

    return field;
}

// Turbulent distortion field
vec2 distortField(vec2 uv, float time) {
    float angle = fbm(uv * noiseScale + time * flowSpeed * 0.5) * 6.2831 * 2.0;
    float strength = noise(uv * noiseScale * 0.5 - time * flowSpeed * 0.3);

    return vec2(
        cos(angle) * strength * distortAmount * 0.1,
        sin(angle) * strength * distortAmount * 0.1
    );
}

// Generate psychedelic color from field
vec3 getFluidColor(float field, vec2 uv, float time) {
    // Base hue from field strength and position
    float hue = field * 0.5 + time * hueShift * 0.1;

    // Add spatial variation
    hue += fbm(uv * 2.0 + time * 0.1) * 0.3;

    // Add temporal pulsing
    hue += sin(time * pulseSpeed * 0.5) * 0.1;

    // Wrap hue
    hue = fract(hue);

    // Dynamic saturation based on field strength
    float sat = saturation * (0.7 + 0.3 * sin(field * 10.0 + time));

    // Brightness varies with field
    float val = smoothstep(threshold * 0.5, threshold * 2.0, field);
    val = pow(val, 0.7) * brightnessBoost;

    // Color bleeding - blend nearby colors
    if (colorBleed > 0.0) {
        float bleedHue = fbm(uv * 5.0 - time * 0.2) * colorBleed * 0.5;
        hue += bleedHue;
    }

    return hsv2rgb(vec3(hue, sat, val));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float time = TIME;

    // Apply turbulent distortion
    vec2 distortion = distortField(uv, time);
    vec2 distortedUV = uv + distortion * turbulence;

    // Calculate metaball field
    float field = metaballs(distortedUV, time);

    // Add noise layer for texture
    float noiseLayer = fbm(distortedUV * noiseScale + time * flowSpeed * 0.2);
    field += noiseLayer * 0.3;

    // Mix in cellular/voronoi pattern
    if (cellularMix > 0.0) {
        vec2 voronoiResult = voronoi(distortedUV * 8.0 + time * flowSpeed * 0.3);
        float cellPattern = 1.0 - voronoiResult.x;
        field = mix(field, field * cellPattern * 2.0, cellularMix);
    }

    // Generate color
    vec3 color = getFluidColor(field, distortedUV, time);

    // Chromatic aberration effect
    if (chromaShift > 0.0) {
        vec2 offset = distortion * chromaShift * 0.02;

        // Sample field with slight offsets for each channel
        float fieldR = metaballs(distortedUV + offset, time);
        float fieldG = metaballs(distortedUV, time);
        float fieldB = metaballs(distortedUV - offset, time);

        fieldR += fbm(distortedUV * noiseScale + offset + time * flowSpeed * 0.2) * 0.3;
        fieldG += noiseLayer * 0.3;
        fieldB += fbm(distortedUV * noiseScale - offset + time * flowSpeed * 0.2) * 0.3;

        vec3 colorR = getFluidColor(fieldR, distortedUV + offset, time);
        vec3 colorG = getFluidColor(fieldG, distortedUV, time);
        vec3 colorB = getFluidColor(fieldB, distortedUV - offset, time);

        color = vec3(colorR.r, colorG.g, colorB.b);
    }

    // Edge glow enhancement
    float edge = abs(field - threshold);
    edge = exp(-edge * 20.0) * 0.5;
    color += vec3(edge);

    // Add subtle Film grain
    float grain = (hash(uv + time * 0.1) - 0.5) * 0.05;
    color += vec3(grain);

    // Vignette for focus
    float vignette = length(uv - 0.5);
    vignette = 1.0 - smoothstep(0.3, 0.9, vignette) * 0.3;
    color *= vignette;

    gl_FragColor = vec4(color, 1.0);
}
