/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Organic Dimension - Raymarched Biological Dreamscape",
  "INPUTS": [
    {
      "NAME": "travelMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 4.0
    },
    {
      "NAME": "travelSpeed",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": -2.0,
      "MAX": 2.0
    },
    {
      "NAME": "driftAmount",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "organicForm",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "blobDensity",
      "TYPE": "float",
      "DEFAULT": 4.0,
      "MIN": 2.0,
      "MAX": 12.0
    },
    {
      "NAME": "blobSize",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.3,
      "MAX": 3.0
    },
    {
      "NAME": "smoothness",
      "TYPE": "float",
      "DEFAULT": 0.8,
      "MIN": 0.1,
      "MAX": 2.0
    },
    {
      "NAME": "pulseSpeed",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "pulseAmount",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "morphSpeed",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "tendrils",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "veins",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "colorPalette",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 6.0
    },
    {
      "NAME": "bioluminescence",
      "TYPE": "float",
      "DEFAULT": 1.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "innerGlow",
      "TYPE": "float",
      "DEFAULT": 0.8,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "subsurface",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "fogDensity",
      "TYPE": "float",
      "DEFAULT": 0.08,
      "MIN": 0.0,
      "MAX": 0.5
    },
    {
      "NAME": "ambientOcclusion",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "fov",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.5,
      "MAX": 2.0
    },
    {
      "NAME": "distortion",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "contrast",
      "TYPE": "float",
      "DEFAULT": 1.2,
      "MIN": 0.5,
      "MAX": 2.5
    },
    {
      "NAME": "brightness",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.5,
      "MAX": 2.0
    },
    {
      "NAME": "wireframeMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "wireframeThickness",
      "TYPE": "float",
      "DEFAULT": 0.05,
      "MIN": 0.01,
      "MAX": 0.2
    },
    {
      "NAME": "ditherMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 4.0
    },
    {
      "NAME": "ditherStrength",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "ditherScale",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.5,
      "MAX": 5.0
    },
    {
      "NAME": "colorCycle",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    }
  ]
}*/

// ============================================================================
// Organic Dimension - Soft Biological Raymarched World
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359
#define MAX_STEPS 80
#define MAX_DIST 40.0
#define SURF_DIST 0.01

// Hash for organic randomness
float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
}

// Organic noise
float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n = i.x + i.y * 157.0 + 113.0 * i.z;
    return mix(
        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z);
}

// Fractal noise for complex organic patterns
float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// Bayer matrix dithering
float bayer2(vec2 p) {
    return fract(dot(p, vec2(0.5, 0.25)));
}

float bayer4(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = bayer2(i * 0.5);
    float b = bayer2(i * 0.5 + vec2(0.5, 0.0));
    float c = bayer2(i * 0.5 + vec2(0.0, 0.5));
    float d = bayer2(i * 0.5 + vec2(0.5, 0.5));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float bayer8(vec2 p) {
    float a = bayer4(p * 0.5);
    float b = bayer2(p);
    return (a + b) * 0.5;
}

// Random dithering
float randomDither(vec2 p, float time) {
    return hash(vec3(p, time));
}

// Blue noise approximation
float blueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(vec3(i, 0.0));
    float b = hash(vec3(i + vec2(1.0, 0.0), 0.0));
    float c = hash(vec3(i + vec2(0.0, 1.0), 0.0));
    float d = hash(vec3(i + vec2(1.0, 1.0), 0.0));
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Apply dithering to color
vec3 applyDither(vec3 color, vec2 screenPos, float time, int mode, float strength, float scale) {
    if (strength <= 0.0) return color;

    vec2 ditherUV = screenPos * scale;
    float dither = 0.0;

    if (mode == 0) {
        // No dither
        return color;
    } else if (mode == 1) {
        // Bayer ordered dither
        dither = bayer8(ditherUV);
    } else if (mode == 2) {
        // Blue noise
        dither = blueNoise(ditherUV);
    } else if (mode == 3) {
        // Random dither
        dither = randomDither(ditherUV, time);
    } else {
        // Animated dither
        dither = bayer8(ditherUV + time * 10.0);
    }

    // Posterize color
    float levels = 8.0;
    vec3 quantized = floor(color * levels + dither * strength) / levels;
    return mix(color, quantized, strength);
}

// Smooth min for blob merging
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Soft sphere
float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

// Organic blob (sphere with noise distortion)
float organicBlob(vec3 p, float size, float time) {
    float d = length(p) - size;

    // Add organic distortion
    float distortion = fbm(p * 2.0 + time * morphSpeed * 0.3) * 0.3;
    d += distortion * size * 0.4;

    return d;
}

// Capsule/tendril shape
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

// Main organic scene
float getScene(vec3 p, float time, out float blobIndex) {
    float d = MAX_DIST;
    blobIndex = 0.0;

    // Repeat space for blob field
    vec3 cellSize = vec3(blobDensity);
    vec3 cellId = floor(p / cellSize);
    vec3 cellP = mod(p, cellSize) - cellSize * 0.5;

    int formType = int(organicForm);

    // Create organic forms
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            for (int z = -1; z <= 1; z++) {
                vec3 offset = vec3(float(x), float(y), float(z));
                vec3 neighborCell = cellId + offset;
                vec3 neighborP = cellP - offset * cellSize;

                vec3 seed = hash3(neighborCell);

                // Organic movement
                vec3 movement = vec3(
                    sin(time * 0.5 + seed.x * 6.28),
                    cos(time * 0.7 + seed.y * 6.28),
                    sin(time * 0.6 + seed.z * 6.28)
                ) * driftAmount;

                neighborP -= movement;

                // Pulsing size
                float pulse = sin(time * pulseSpeed + dot(seed, vec3(1.0))) * pulseAmount;
                float size = blobSize * (1.0 + pulse);

                float blobDist;

                if (formType == 0) {
                    // Soft organic blobs
                    blobDist = organicBlob(neighborP, size, time);

                } else if (formType == 1) {
                    // Egg/ellipsoid shapes
                    vec3 stretch = vec3(1.0, 1.0 + seed.x * 0.5, 1.0);
                    blobDist = sdSphere(neighborP / stretch, size) * min(stretch.x, min(stretch.y, stretch.z));

                } else if (formType == 2) {
                    // Cell clusters
                    float core = organicBlob(neighborP, size, time);
                    for (int i = 0; i < 3; i++) {
                        vec3 subOffset = (hash3(neighborCell + vec3(i * 10.0)) - 0.5) * size;
                        float subBlob = organicBlob(neighborP - subOffset, size * 0.5, time);
                        core = smin(core, subBlob, smoothness * 0.5);
                    }
                    blobDist = core;

                } else if (formType == 3) {
                    // Amoeba-like
                    float core = organicBlob(neighborP, size, time);
                    vec3 distort = neighborP + fbm(neighborP * 3.0 + time) * 0.5;
                    float outer = organicBlob(distort, size * 1.2, time);
                    blobDist = smin(core, outer, smoothness);

                } else if (formType == 4) {
                    // Coral/branching
                    float stem = sdCapsule(neighborP, vec3(0), vec3(0, size * 2.0, 0), size * 0.3);
                    for (int i = 0; i < 4; i++) {
                        float fi = float(i);
                        float angle = fi * 1.57 + time * 0.5;
                        vec3 branchDir = vec3(cos(angle), 0.5, sin(angle));
                        float branch = sdCapsule(neighborP, vec3(0, size * 0.5, 0), branchDir * size, size * 0.2);
                        stem = smin(stem, branch, smoothness * 0.3);
                    }
                    blobDist = stem;

                } else {
                    // Spore clusters - many small spheres
                    blobDist = MAX_DIST;
                    for (int i = 0; i < 8; i++) {
                        vec3 sporePos = (hash3(neighborCell + vec3(i * 7.0)) - 0.5) * size;
                        float spore = sdSphere(neighborP - sporePos, size * 0.3);
                        blobDist = smin(blobDist, spore, smoothness * 0.2);
                    }
                }

                // Track closest blob for coloring
                if (blobDist < d) {
                    blobIndex = dot(neighborCell, vec3(1.0, 57.0, 113.0));
                }

                // Smooth union
                d = smin(d, blobDist, smoothness);
            }
        }
    }

    // Add tendril structures
    if (tendrils > 0.0) {
        for (int i = 0; i < 5; i++) {
            float fi = float(i);
            float angle = fi * 1.256 + time * 0.3;
            vec3 tendrilStart = vec3(cos(angle), 0.0, sin(angle)) * 8.0;
            vec3 tendrilEnd = tendrilStart + vec3(0, sin(time + fi) * 3.0, 0);
            float tendril = sdCapsule(p, tendrilStart, tendrilEnd, 0.1 + sin(time * 2.0 + fi) * 0.05);
            d = smin(d, tendril, smoothness * tendrils);
        }
    }

    // Add vein-like structures
    if (veins > 0.0) {
        float veinPattern = abs(sin(p.x * 5.0 + time) * sin(p.y * 5.0) * sin(p.z * 5.0));
        d -= veinPattern * 0.05 * veins;
    }

    return d;
}

// Calculate normal
vec3 getNormal(vec3 p, float time) {
    float dummy;
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        getScene(p + e.xyy, time, dummy) - getScene(p - e.xyy, time, dummy),
        getScene(p + e.yxy, time, dummy) - getScene(p - e.yxy, time, dummy),
        getScene(p + e.yyx, time, dummy) - getScene(p - e.yyx, time, dummy)
    ));
}

// Ambient occlusion
float calcAO(vec3 p, vec3 n, float time) {
    float occ = 0.0;
    float sca = 1.0;
    float dummy;
    for (int i = 0; i < 5; i++) {
        float h = 0.01 + 0.12 * float(i) / 4.0;
        float d = getScene(p + h * n, time, dummy);
        occ += (h - d) * sca;
        sca *= 0.95;
    }
    return clamp(1.0 - 1.5 * occ, 0.0, 1.0);
}

// Get organic color palette
vec3 getOrganicColor(float seed, int palette, float depth, float cycleAmount, float time) {
    seed = fract(seed);

    // Apply color cycling
    float hueShift = time * cycleAmount * 0.2;

    if (palette == 0) {
        // Bioluminescent blue/green
        vec3 col = mix(vec3(0.0, 0.3, 0.6), vec3(0.0, 0.8, 0.5), seed);
        if (cycleAmount > 0.0) {
            float hue = atan(col.y, col.x) / (2.0 * PI) + hueShift;
            float sat = length(col.xy);
            col = vec3(cos(hue * 2.0 * PI) * sat, sin(hue * 2.0 * PI) * sat, col.z);
        }
        return col;

    } else if (palette == 1) {
        // Deep sea purple/pink
        vec3 col = mix(vec3(0.3, 0.0, 0.5), vec3(0.8, 0.2, 0.6), seed);
        if (cycleAmount > 0.0) {
            float hue = atan(col.y, col.x) / (2.0 * PI) + hueShift;
            float sat = length(col.xy);
            col = vec3(cos(hue * 2.0 * PI) * sat, sin(hue * 2.0 * PI) * sat, col.z);
        }
        return col;

    } else if (palette == 2) {
        // Coral reef orange/red
        vec3 col = mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 0.6, 0.8), seed);
        if (cycleAmount > 0.0) {
            float hue = atan(col.y, col.x) / (2.0 * PI) + hueShift;
            float sat = length(col.xy);
            col = vec3(cos(hue * 2.0 * PI) * sat, sin(hue * 2.0 * PI) * sat, col.z);
        }
        return col;

    } else if (palette == 3) {
        // Alien green/yellow
        vec3 col = mix(vec3(0.2, 0.8, 0.0), vec3(0.8, 1.0, 0.2), seed);
        if (cycleAmount > 0.0) {
            float hue = atan(col.y, col.x) / (2.0 * PI) + hueShift;
            float sat = length(col.xy);
            col = vec3(cos(hue * 2.0 * PI) * sat, sin(hue * 2.0 * PI) * sat, col.z);
        }
        return col;

    } else if (palette == 4) {
        // Ice/crystal white/blue
        vec3 col = mix(vec3(0.6, 0.8, 1.0), vec3(0.9, 0.95, 1.0), seed);
        if (cycleAmount > 0.0) {
            float hue = atan(col.y, col.x) / (2.0 * PI) + hueShift;
            float sat = length(col.xy);
            col = vec3(cos(hue * 2.0 * PI) * sat, sin(hue * 2.0 * PI) * sat, col.z);
        }
        return col;

    } else if (palette == 5) {
        // Lava/magma
        vec3 col = mix(vec3(0.8, 0.1, 0.0), vec3(1.0, 0.5, 0.0), seed);
        if (cycleAmount > 0.0) {
            float hue = atan(col.y, col.x) / (2.0 * PI) + hueShift;
            float sat = length(col.xy);
            col = vec3(cos(hue * 2.0 * PI) * sat, sin(hue * 2.0 * PI) * sat, col.z);
        }
        return col;

    } else {
        // Rainbow organic
        float hue = seed + hueShift;
        return vec3(
            sin(hue * 6.28) * 0.5 + 0.5,
            sin(hue * 6.28 + 2.094) * 0.5 + 0.5,
            sin(hue * 6.28 + 4.189) * 0.5 + 0.5
        );
    }
}

// Raymarch
float rayMarch(vec3 ro, vec3 rd, float time, out float blobId) {
    float d = 0.0;
    blobId = 0.0;

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * d;
        float dist = getScene(p, time, blobId);
        d += dist * 0.7;

        if (d > MAX_DIST || abs(dist) < SURF_DIST) break;
    }

    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float time = TIME;

    // Apply organic distortion to view
    if (distortion > 0.0) {
        float warp = fbm(vec3(uv * 3.0, time * 0.5)) * distortion * 0.1;
        uv += vec2(warp);
    }

    vec3 col = vec3(0.0);

    // Camera movement based on travel mode
    vec3 ro;
    int mode = int(travelMode);

    if (mode == 0) {
        // Forward flight
        ro = vec3(0.0, 0.0, time * travelSpeed * 3.0);

    } else if (mode == 1) {
        // Circular orbit
        float angle = time * travelSpeed * 0.5;
        ro = vec3(cos(angle) * 5.0, sin(time * 0.7) * 2.0, sin(angle) * 5.0);

    } else if (mode == 2) {
        // Spiral descent
        float angle = time * travelSpeed;
        ro = vec3(cos(angle) * 5.0, -time * travelSpeed, sin(angle) * 5.0);

    } else if (mode == 3) {
        // Floating drift
        ro = vec3(
            sin(time * travelSpeed * 0.3) * 3.0,
            cos(time * travelSpeed * 0.4) * 2.0,
            time * travelSpeed * 2.0
        );

    } else {
        // Chaotic tumble
        ro = vec3(
            sin(time * travelSpeed) * 4.0,
            cos(time * travelSpeed * 1.3) * 4.0,
            sin(time * travelSpeed * 0.7) * 4.0
        );
    }

    vec3 target = ro + vec3(0, 0, 1);
    vec3 forward = normalize(target - ro);
    vec3 right = normalize(cross(vec3(0, 1, 0), forward));
    vec3 up = cross(forward, right);

    vec3 rd = normalize(forward + uv.x * right * fov + uv.y * up * fov);

    // Raymarch
    float blobId;
    float d = rayMarch(ro, rd, time, blobId);

    if (d < MAX_DIST) {
        vec3 p = ro + rd * d;
        vec3 n = getNormal(p, time);

        // Get organic color with cycling
        vec3 baseColor = getOrganicColor(blobId, int(colorPalette), d, colorCycle, time);

        // Wireframe rendering
        int wireMode = int(wireframeMode);
        float wireframe = 0.0;

        if (wireMode > 0) {
            // Calculate wireframe edges
            float edge = 0.0;

            if (wireMode == 1) {
                // Grid-based wireframe on surface
                vec3 gridP = fract(p * 4.0);
                vec3 gridEdge = smoothstep(wireframeThickness, 0.0, gridP);
                gridEdge += smoothstep(1.0 - wireframeThickness, 1.0, gridP);
                edge = max(max(gridEdge.x, gridEdge.y), gridEdge.z);

            } else if (wireMode == 2) {
                // Circular/organic wireframe
                float rings = sin(length(p) * 20.0 + time);
                edge = smoothstep(wireframeThickness, 0.0, abs(rings));

            } else {
                // Blob-based wireframe (highlights each blob)
                float blobEdge = abs(getScene(p, time, blobId) - SURF_DIST * 2.0);
                edge = smoothstep(wireframeThickness * 0.1, 0.0, blobEdge);
            }

            wireframe = edge;
        }

        // Soft lighting
        vec3 lightPos = ro + vec3(3, 3, -5);
        vec3 lightDir = normalize(lightPos - p);
        float diff = max(dot(n, lightDir), 0.0) * 0.5 + 0.5;

        // Subsurface scattering simulation
        float backLight = max(dot(-n, lightDir), 0.0);
        vec3 scatter = baseColor * backLight * subsurface;

        // Ambient occlusion
        float ao = calcAO(p, n, time);
        ao = mix(1.0, ao, ambientOcclusion);

        // Rim glow (bioluminescence)
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
        vec3 glow = baseColor * rim * bioluminescence;

        // Inner glow based on depth
        float depthGlow = exp(-d * 0.1) * innerGlow;

        // Combine lighting
        col = baseColor * diff * ao;
        col += scatter;
        col += glow;
        col += baseColor * depthGlow;

        // Apply wireframe overlay
        if (wireframe > 0.5) {
            col = mix(col, vec3(1.0), 0.8);
        }

    }

    // Atmospheric fog
    float fog = 1.0 - exp(-d * fogDensity);
    vec3 fogColor = getOrganicColor(time * 0.1, int(colorPalette), 1.0, colorCycle, time) * 0.1;
    col = mix(col, fogColor, fog);

    // Ambient glow in empty space
    if (d >= MAX_DIST) {
        float ambientGlow = 0.01 / (0.01 + length(uv) * 0.5);
        col += ambientGlow * getOrganicColor(time * 0.05, int(colorPalette), 1.0, colorCycle, time) * bioluminescence * 0.5;
    }

    // Apply dithering
    if (ditherStrength > 0.0) {
        col = applyDither(col, gl_FragCoord.xy, time, int(ditherMode), ditherStrength, ditherScale);
    }

    // Post processing
    col = pow(col, vec3(1.0 / contrast));
    col *= brightness;

    // Vignette
    float vignette = 1.0 - length(uv) * 0.25;
    col *= vignette;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}