/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Tron Organic Fusion - 3D Grid Meets Morphing Bio-Blobs",
  "INPUTS": [
    {
      "NAME": "gridIntensity",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "gridScale",
      "TYPE": "float",
      "DEFAULT": 10.0,
      "MIN": 3.0,
      "MAX": 30.0
    },
    {
      "NAME": "blobCount",
      "TYPE": "float",
      "DEFAULT": 4.0,
      "MIN": 1.0,
      "MAX": 8.0
    },
    {
      "NAME": "blobSize",
      "TYPE": "float",
      "DEFAULT": 0.2,
      "MIN": 0.05,
      "MAX": 0.5
    },
    {
      "NAME": "blobMerge",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.1,
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
      "NAME": "flowSpeed",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "rotateSpeed",
      "TYPE": "float",
      "DEFAULT": 0.1,
      "MIN": -1.0,
      "MAX": 1.0
    },
    {
      "NAME": "tiltAngle",
      "TYPE": "float",
      "DEFAULT": 30.0,
      "MIN": 0.0,
      "MAX": 90.0
    },
    {
      "NAME": "colorMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "neonGlow",
      "TYPE": "float",
      "DEFAULT": 2.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "rimPower",
      "TYPE": "float",
      "DEFAULT": 3.0,
      "MIN": 1.0,
      "MAX": 10.0
    },
    {
      "NAME": "pulseSpeed",
      "TYPE": "float",
      "DEFAULT": 2.0,
      "MIN": 0.0,
      "MAX": 10.0
    },
    {
      "NAME": "pulseAmount",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "fogAmount",
      "TYPE": "float",
      "DEFAULT": 0.1,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "brightness",
      "TYPE": "float",
      "DEFAULT": 1.2,
      "MIN": 0.5,
      "MAX": 2.0
    },
    {
      "NAME": "contrast",
      "TYPE": "float",
      "DEFAULT": 1.3,
      "MIN": 0.5,
      "MAX": 2.0
    }
  ]
}*/

// ============================================================================
// Tron Organic Fusion - Digital Grid Meets Biological Forms
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359

// Simple hash
float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 hash3(float n) {
    return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453123, 22578.1459123, 19642.3490423));
}

// Smooth noise
float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n = i.x + i.y * 157.0 + 113.0 * i.z;
    return mix(mix(mix(hash(n), hash(n + 1.0), f.x),
                   mix(hash(n + 157.0), hash(n + 158.0), f.x), f.y),
               mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                   mix(hash(n + 270.0), hash(n + 271.0), f.x), f.y), f.z);
}

// Smooth minimum for blob merging
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Distance to sphere
float sdSphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

// Main scene with metaballs
float scene(vec3 p, float time) {
    float d = 1000.0;

    int count = int(blobCount);

    for (int i = 0; i < 8; i++) {
        if (i >= count) break;

        float fi = float(i);
        vec3 seed = hash3(fi);

        // Lava lamp motion
        float t = time * flowSpeed;
        vec3 pos = vec3(
            sin(t * (0.7 + seed.x * 0.3) + fi * 2.0) * 0.8,
            cos(t * (0.5 + seed.y * 0.5) + fi * 3.0) * 0.5,
            sin(t * (0.6 + seed.z * 0.4) + fi * 1.5) * 0.8
        );

        // Organic size pulsing
        float size = blobSize * (0.8 + 0.4 * sin(time * morphSpeed + fi * PI));

        // Add noise distortion
        vec3 noisePos = p * 3.0 + time * morphSpeed * 0.5;
        float distortion = noise(noisePos) * 0.1;

        float sphere = sdSphere(p, pos, size + distortion);

        // Smooth merge
        d = smin(d, sphere, blobMerge * 0.3);
    }

    return d;
}

// Normal calculation
vec3 calcNormal(vec3 p, float time) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        scene(p + e.xyy, time) - scene(p - e.xyy, time),
        scene(p + e.yxy, time) - scene(p - e.yxy, time),
        scene(p + e.yyx, time) - scene(p - e.yyx, time)
    ));
}

// Get color
vec3 getColor(float t, int mode) {
    t = clamp(t, 0.0, 1.0);

    if (mode == 0) {
        // Classic Tron cyan/blue
        return mix(vec3(0.0, 0.8, 1.0), vec3(0.0, 1.0, 1.0), t);
    } else if (mode == 1) {
        // Magenta/pink
        return mix(vec3(1.0, 0.0, 0.5), vec3(1.0, 0.0, 1.0), t);
    } else if (mode == 2) {
        // Green matrix
        return vec3(0.0, t * 1.5, t * 0.3);
    } else if (mode == 3) {
        // Fire orange
        return mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 0.8, 0.0), t);
    } else if (mode == 4) {
        // Rainbow hue shift
        float hue = t * 3.14159;
        return vec3(
            sin(hue) * 0.5 + 0.5,
            sin(hue + 2.094) * 0.5 + 0.5,
            sin(hue + 4.189) * 0.5 + 0.5
        );
    } else {
        // Cyan to magenta gradient
        return mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), t);
    }
}

// Grid pattern
vec3 drawGrid(vec3 p, float time) {
    vec2 grid = abs(fract(p.xz * gridScale) - 0.5);

    float lineWidth = 0.05;
    float lines = 0.0;
    lines += smoothstep(lineWidth, 0.0, grid.x);
    lines += smoothstep(lineWidth, 0.0, grid.y);

    // Animated pulse
    float dist = length(p.xz);
    float pulse = sin(dist * 5.0 - time * 3.0) * 0.5 + 0.5;

    // Perspective fade
    float fade = exp(-abs(p.y + 2.0) * 0.5);
    fade *= exp(-dist * 0.2);

    vec3 gridCol = getColor(0.5, int(colorMode)) * lines * fade * gridIntensity;
    gridCol *= (1.0 + pulse * pulseAmount);

    return gridCol;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float time = TIME;

    // Camera setup
    float camDist = 3.5;
    float rotAngle = time * rotateSpeed;
    float tiltRad = tiltAngle * PI / 180.0;

    vec3 camPos = vec3(
        sin(rotAngle) * camDist * cos(tiltRad),
        sin(tiltRad) * camDist,
        cos(rotAngle) * camDist * cos(tiltRad)
    );

    vec3 target = vec3(0.0, 0.0, 0.0);
    vec3 forward = normalize(target - camPos);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up = cross(forward, right);

    vec3 rayDir = normalize(forward + uv.x * right + uv.y * up);

    // Initialize color with grid
    vec3 col = vec3(0.0);

    // Raymarch
    vec3 pos = camPos;
    float totalDist = 0.0;
    bool hit = false;

    for (int i = 0; i < 100; i++) {
        float dist = scene(pos, time);

        if (dist < 0.001) {
            hit = true;
            break;
        }

        if (totalDist > 20.0) break;

        totalDist += dist;
        pos = camPos + rayDir * totalDist;
    }

    // Render hit surface
    if (hit) {
        vec3 normal = calcNormal(pos, time);

        // Base color
        float depth = totalDist / 10.0;
        vec3 baseCol = getColor(1.0 - depth, int(colorMode));

        // Lighting
        vec3 lightDir = normalize(vec3(1.0, 1.0, -0.5));
        float diff = max(dot(normal, lightDir), 0.0) * 0.5 + 0.5;

        // Rim lighting (Tron glow)
        float rim = 1.0 - abs(dot(normal, -rayDir));
        rim = pow(rim, rimPower);

        // Pulse
        float pulse = sin(time * pulseSpeed + pos.y * 5.0) * 0.5 + 0.5;

        // Combine
        col = baseCol * diff;
        col += baseCol * rim * neonGlow * (1.0 + pulse * pulseAmount);

        // Fog
        if (fogAmount > 0.0) {
            float fogFactor = 1.0 - exp(-totalDist * fogAmount);
            col = mix(col, vec3(0.0), fogFactor);
        }
    } else {
        // Background grid
        // Ray-plane intersection for y = -2
        float t = (-2.0 - camPos.y) / rayDir.y;
        if (t > 0.0 && rayDir.y < 0.0) {
            vec3 gridPos = camPos + rayDir * t;
            col = drawGrid(gridPos, time);
        }
    }

    // Post processing
    col = pow(col, vec3(1.0 / contrast));
    col *= brightness;

    // Vignette
    float vignette = 1.0 - length(uv) * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}