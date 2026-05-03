/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Mega Blob Fusion - Advanced Metaball System with Multiple Modes",
  "INPUTS": [
    {
      "NAME": "blobMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 6.0
    },
    {
      "NAME": "blobCount",
      "TYPE": "float",
      "DEFAULT": 8.0,
      "MIN": 1.0,
      "MAX": 30.0
    },
    {
      "NAME": "blobSize",
      "TYPE": "float",
      "DEFAULT": 0.2,
      "MIN": 0.02,
      "MAX": 0.8
    },
    {
      "NAME": "blobStretchZ",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.2,
      "MAX": 5.0
    },
    {
      "NAME": "blobMerge",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.05,
      "MAX": 1.5
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
      "MAX": 3.0
    },
    {
      "NAME": "vortexStrength",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "boilIntensity",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "dripSpeed",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "explosionAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "turbulence",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "gridIntensity",
      "TYPE": "float",
      "DEFAULT": 0.3,
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
      "MIN": -90.0,
      "MAX": 90.0
    },
    {
      "NAME": "cameraDistance",
      "TYPE": "float",
      "DEFAULT": 3.5,
      "MIN": 1.0,
      "MAX": 10.0
    },
    {
      "NAME": "colorMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 6.0
    },
    {
      "NAME": "colorVariation",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "colorShift",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
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
      "MIN": 0.5,
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
      "NAME": "innerGlow",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
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
      "MAX": 2.5
    },
    {
      "NAME": "contrast",
      "TYPE": "float",
      "DEFAULT": 1.3,
      "MIN": 0.5,
      "MAX": 2.5
    }
  ]
}*/

// ============================================================================
// Mega Blob Fusion - Ultimate Metaball System
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359

// Hash functions
float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 hash3(float n) {
    return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453123, 22578.1459123, 19642.3490423));
}

vec3 hash33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
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

// Smooth minimum
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Ellipsoid (for stretched blobs)
float sdEllipsoid(vec3 p, vec3 center, vec3 radius) {
    vec3 d = (p - center) / radius;
    return (length(d) - 1.0) * min(min(radius.x, radius.y), radius.z);
}

// Color palette
vec3 getBaseColor(float t, int mode) {
    t = clamp(t, 0.0, 1.0);

    if (mode == 0) {
        // Tron cyan to blue
        return mix(vec3(0.0, 0.8, 1.0), vec3(0.0, 1.0, 1.0), t);
    } else if (mode == 1) {
        // Hot magenta to pink
        return mix(vec3(1.0, 0.0, 0.8), vec3(1.0, 0.3, 1.0), t);
    } else if (mode == 2) {
        // Lava (orange to yellow)
        return mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.9, 0.0), t);
    } else if (mode == 3) {
        // Toxic green
        return mix(vec3(0.0, 1.0, 0.2), vec3(0.3, 1.0, 0.0), t);
    } else if (mode == 4) {
        // Ice blue to white
        return mix(vec3(0.3, 0.8, 1.0), vec3(0.9, 1.0, 1.0), t);
    } else if (mode == 5) {
        // Purple plasma
        return mix(vec3(0.5, 0.0, 1.0), vec3(1.0, 0.0, 0.8), t);
    } else {
        // Rainbow
        float hue = t * 6.28318;
        return vec3(
            sin(hue) * 0.5 + 0.5,
            sin(hue + 2.094) * 0.5 + 0.5,
            sin(hue + 4.189) * 0.5 + 0.5
        );
    }
}

// Get individual blob color
vec3 getBlobColor(int blobIndex, float time) {
    float fi = float(blobIndex);
    float colorT = fi / max(blobCount, 1.0);

    // Shift colors over time if enabled
    if (colorShift > 0.0) {
        colorT = fract(colorT + time * colorShift * 0.1);
    }

    vec3 baseCol = getBaseColor(colorT, int(colorMode));

    // Add variation per blob
    if (colorVariation > 0.0) {
        vec3 variation = hash3(fi) - 0.5;
        baseCol = mix(baseCol, baseCol + variation * 0.5, colorVariation);
        baseCol = clamp(baseCol, 0.0, 1.0);
    }

    return baseCol;
}

// Main scene with multiple blob modes
float scene(vec3 p, float time, out int closestBlob) {
    float d = 1000.0;
    closestBlob = 0;
    float closestDist = 1000.0;

    int count = int(blobCount);
    int mode = int(blobMode);

    for (int i = 0; i < 30; i++) {
        if (i >= count) break;

        float fi = float(i);
        vec3 seed = hash3(fi);

        vec3 pos = vec3(0.0);
        vec3 radius = vec3(1.0);
        float size = blobSize;

        // Blob behavior based on mode
        if (mode == 0) {
            // Classic floating lava lamp
            float t = time * flowSpeed;
            pos = vec3(
                sin(t * (0.7 + seed.x * 0.3) + fi * 2.0) * 1.2,
                cos(t * (0.5 + seed.y * 0.5) + fi * 3.0) * 0.8,
                sin(t * (0.6 + seed.z * 0.4) + fi * 1.5) * 1.2
            );

        } else if (mode == 1) {
            // Boiling water - lots of small bubbles rising
            float t = time * (flowSpeed + boilIntensity);
            float lifeTime = fract(seed.x + t * 0.3);
            pos = vec3(
                (seed.x - 0.5) * 2.0 + sin(t * 3.0 + fi) * 0.3,
                -1.5 + lifeTime * 3.0, // Rise up
                (seed.z - 0.5) * 2.0 + cos(t * 2.5 + fi) * 0.3
            );
            size = blobSize * (0.3 + seed.y * 0.4) * (1.0 - lifeTime * 0.5); // Shrink as they rise

        } else if (mode == 2) {
            // Dripping blobs
            float t = time * (flowSpeed + dripSpeed);
            float dripPhase = fract(seed.x * 10.0 + t * 0.5);
            float dripProgress = smoothstep(0.0, 0.8, dripPhase);
            pos = vec3(
                (seed.x - 0.5) * 2.5,
                1.5 - dripProgress * 3.5, // Drip down
                (seed.z - 0.5) * 2.5
            );
            // Stretch while dripping
            radius.y = 1.0 + dripProgress * 2.0 * blobStretchZ;
            size *= (1.0 + dripProgress * 0.3);

        } else if (mode == 3) {
            // Vortex spiral
            float t = time * flowSpeed;
            float angle = t * vortexStrength + fi * 0.5;
            float spiralRadius = 0.5 + (fi / float(count)) * 1.5;
            float height = sin(t + fi) * 0.8;
            pos = vec3(
                cos(angle) * spiralRadius,
                height + sin(angle * 3.0) * 0.3,
                sin(angle) * spiralRadius
            );

        } else if (mode == 4) {
            // Exploding/imploding
            float t = time * flowSpeed;
            float explodePhase = sin(t * explosionAmount) * 0.5 + 0.5;
            vec3 direction = normalize(seed - 0.5);
            pos = direction * explodePhase * 2.0;
            size *= (1.0 + explodePhase * 0.5);

        } else if (mode == 5) {
            // Orbiting clusters
            float t = time * flowSpeed;
            float orbitAngle = t + fi * 2.0;
            float orbitRadius = 0.8 + sin(fi) * 0.3;
            float orbitHeight = sin(t * 0.7 + fi * 1.5) * 0.5;
            pos = vec3(
                cos(orbitAngle) * orbitRadius,
                orbitHeight,
                sin(orbitAngle) * orbitRadius
            );

        } else {
            // Full screen fill - many small blobs everywhere
            float t = time * flowSpeed * 0.5;
            pos = (hash33(vec3(fi)) - 0.5) * 3.0;
            pos += sin(vec3(t, t * 1.3, t * 0.8) + fi) * 0.5;
            size *= 0.5;
        }

        // Add vortex influence
        if (vortexStrength > 0.0 && mode != 3) {
            float vortexAngle = time * vortexStrength + length(pos.xz) * 2.0;
            mat2 vortexRot = mat2(cos(vortexAngle), -sin(vortexAngle), sin(vortexAngle), cos(vortexAngle));
            pos.xz = vortexRot * pos.xz;
        }

        // Add boiling turbulence
        if (boilIntensity > 0.0 && mode != 1) {
            pos += (hash33(vec3(fi * 10.0)) - 0.5) * boilIntensity * 0.3;
            pos.y += sin(time * 5.0 + fi * 10.0) * boilIntensity * 0.2;
        }

        // Add general turbulence
        if (turbulence > 0.0) {
            vec3 turbPos = pos + time * 0.5;
            pos += vec3(
                noise(turbPos),
                noise(turbPos + vec3(100.0)),
                noise(turbPos + vec3(200.0))
            ) * turbulence * 0.2;
        }

        // Organic size pulsing
        size *= (0.85 + 0.3 * sin(time * morphSpeed + fi * PI));

        // Apply Z stretching
        radius *= vec3(1.0, blobStretchZ, 1.0);

        // Calculate distance
        vec3 noisePos = p * 4.0 + time * morphSpeed * 0.3;
        float distortion = noise(noisePos + fi * 10.0) * 0.08;

        float blobDist = sdEllipsoid(p, pos, radius * size) + distortion;

        // Track closest blob for coloring
        if (blobDist < closestDist) {
            closestDist = blobDist;
            closestBlob = i;
        }

        // Smooth merge
        d = smin(d, blobDist, blobMerge * 0.3);
    }

    return d;
}

// Normal calculation
vec3 calcNormal(vec3 p, float time) {
    int dummy;
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        scene(p + e.xyy, time, dummy) - scene(p - e.xyy, time, dummy),
        scene(p + e.yxy, time, dummy) - scene(p - e.yxy, time, dummy),
        scene(p + e.yyx, time, dummy) - scene(p - e.yyx, time, dummy)
    ));
}

// Grid pattern
vec3 drawGrid(vec3 p, float time) {
    vec2 grid = abs(fract(p.xz * gridScale) - 0.5);

    float lineWidth = 0.05;
    float lines = 0.0;
    lines += smoothstep(lineWidth, 0.0, grid.x);
    lines += smoothstep(lineWidth, 0.0, grid.y);

    float dist = length(p.xz);
    float pulse = sin(dist * 5.0 - time * 3.0) * 0.5 + 0.5;

    float fade = exp(-abs(p.y + 2.0) * 0.5);
    fade *= exp(-dist * 0.2);

    vec3 gridCol = getBaseColor(0.5, int(colorMode)) * lines * fade * gridIntensity;
    gridCol *= (1.0 + pulse * pulseAmount);

    return gridCol;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float time = TIME;

    // Camera setup
    float rotAngle = time * rotateSpeed;
    float tiltRad = tiltAngle * PI / 180.0;

    vec3 camPos = vec3(
        sin(rotAngle) * cameraDistance * cos(tiltRad),
        sin(tiltRad) * cameraDistance,
        cos(rotAngle) * cameraDistance * cos(tiltRad)
    );

    vec3 target = vec3(0.0, 0.0, 0.0);
    vec3 forward = normalize(target - camPos);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up = cross(forward, right);

    vec3 rayDir = normalize(forward + uv.x * right + uv.y * up);

    vec3 col = vec3(0.0);

    // Raymarch
    vec3 pos = camPos;
    float totalDist = 0.0;
    bool hit = false;
    int hitBlob = 0;

    for (int i = 0; i < 128; i++) {
        int closestBlob;
        float dist = scene(pos, time, closestBlob);

        if (dist < 0.001) {
            hit = true;
            hitBlob = closestBlob;
            break;
        }

        if (totalDist > 25.0) break;

        totalDist += dist * 0.7;
        pos = camPos + rayDir * totalDist;
    }

    // Render
    if (hit) {
        vec3 normal = calcNormal(pos, time);

        // Get blob-specific color
        vec3 blobCol = getBlobColor(hitBlob, time);

        // Lighting
        vec3 lightDir = normalize(vec3(1.0, 1.0, -0.5));
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;

        // Rim glow
        float rim = 1.0 - abs(dot(normal, -rayDir));
        rim = pow(rim, rimPower);

        // Pulse
        float pulse = sin(time * pulseSpeed + pos.y * 5.0 + float(hitBlob)) * 0.5 + 0.5;

        // Inner glow based on distance to surface
        float depth = totalDist / 15.0;
        vec3 innerCol = blobCol * innerGlow * (1.0 - depth);

        // Combine
        col = blobCol * diff;
        col += blobCol * rim * neonGlow * (1.0 + pulse * pulseAmount);
        col += innerCol;

        // Fog
        if (fogAmount > 0.0) {
            float fogFactor = 1.0 - exp(-totalDist * fogAmount);
            col = mix(col, vec3(0.0), fogFactor);
        }
    } else {
        // Background grid
        float t = (-2.0 - camPos.y) / rayDir.y;
        if (t > 0.0 && rayDir.y < 0.0) {
            vec3 gridPos = camPos + rayDir * t;
            col = drawGrid(gridPos, time);
        }
    }

    // Post processing
    col = pow(col, vec3(1.0 / contrast));
    col *= brightness;

    float vignette = 1.0 - length(uv) * 0.25;
    col *= vignette;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}