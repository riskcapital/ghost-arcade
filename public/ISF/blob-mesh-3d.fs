/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Blob Mesh 3D - 3D Wireframe Network of Merging Blobs",
  "INPUTS": [
    {
      "NAME": "blobCount",
      "TYPE": "float",
      "DEFAULT": 20.0,
      "MIN": 5.0,
      "MAX": 40.0
    },
    {
      "NAME": "blobSize",
      "TYPE": "float",
      "DEFAULT": 0.15,
      "MIN": 0.05,
      "MAX": 0.5
    },
    {
      "NAME": "blobSmoothness",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "networkMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "motionAmount",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "motionSpeed",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "rotationX",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": -3.14,
      "MAX": 3.14
    },
    {
      "NAME": "rotationY",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": -3.14,
      "MAX": 3.14
    },
    {
      "NAME": "rotationZ",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": -3.14,
      "MAX": 3.14
    },
    {
      "NAME": "autoRotate",
      "TYPE": "float",
      "DEFAULT": 0.2,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "cameraDistance",
      "TYPE": "float",
      "DEFAULT": 5.0,
      "MIN": 2.0,
      "MAX": 15.0
    },
    {
      "NAME": "fov",
      "TYPE": "float",
      "DEFAULT": 0.6,
      "MIN": 0.3,
      "MAX": 2.0
    },
    {
      "NAME": "connectionDistance",
      "TYPE": "float",
      "DEFAULT": 2.5,
      "MIN": 1.0,
      "MAX": 5.0
    },
    {
      "NAME": "lineThickness",
      "TYPE": "float",
      "DEFAULT": 0.002,
      "MIN": 0.0005,
      "MAX": 0.01
    },
    {
      "NAME": "showBlobs",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "showConnections",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "blobGlow",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "connectionGlow",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "depthFade",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "colorMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 6.0
    },
    {
      "NAME": "colorCycle",
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
      "MAX": 2.5
    },
    {
      "NAME": "brightness",
      "TYPE": "float",
      "DEFAULT": 1.2,
      "MIN": 0.5,
      "MAX": 2.0
    }
  ]
}*/

// ============================================================================
// Blob Mesh 3D - Living 3D Network of Organic Blobs
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359

// Hash functions
float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec3 hash3(float n) {
    return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453123, 22578.1459123, 19642.3490423));
}

// Rotation matrices
mat3 rotateX(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotateY(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotateZ(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

// Smooth minimum for blob merging
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Get blob position based on network mode
vec3 getBlobPosition(int index, float time, int mode) {
    float fi = float(index);
    vec3 seed = hash3(fi * 7.13);
    float t = time * motionSpeed;

    vec3 basePos;

    if (mode == 0) {
        // Random cloud
        basePos = (seed - 0.5) * 4.0;

    } else if (mode == 1) {
        // Sphere surface
        float theta = seed.x * PI * 2.0;
        float phi = seed.y * PI;
        float radius = 2.0;
        basePos = vec3(
            sin(phi) * cos(theta) * radius,
            sin(phi) * sin(theta) * radius,
            cos(phi) * radius
        );

    } else if (mode == 2) {
        // Helix/DNA
        float angle = fi * 0.5;
        float height = fi * 0.3 - float(int(blobCount)) * 0.15;
        float radius = 1.5;
        basePos = vec3(
            cos(angle + t * 0.5) * radius,
            height,
            sin(angle + t * 0.5) * radius
        );

    } else if (mode == 3) {
        // Grid cube
        float gridSize = ceil(pow(blobCount, 1.0/3.0));
        float x = mod(fi, gridSize);
        float y = mod(floor(fi / gridSize), gridSize);
        float z = floor(fi / (gridSize * gridSize));
        basePos = (vec3(x, y, z) / gridSize - 0.5) * 4.0;

    } else if (mode == 4) {
        // Ring/torus
        float angle = (fi / blobCount) * PI * 2.0;
        float R = 2.0;
        float r = 0.8;
        float v = seed.y * PI * 2.0;
        basePos = vec3(
            (R + r * cos(v)) * cos(angle),
            (R + r * cos(v)) * sin(angle),
            r * sin(v)
        );

    } else {
        // Expanding sphere
        float theta = seed.x * PI * 2.0;
        float phi = seed.y * PI;
        float radius = 1.5 + sin(t + fi * 0.5) * 0.5;
        basePos = vec3(
            sin(phi) * cos(theta) * radius,
            sin(phi) * sin(theta) * radius,
            cos(phi) * radius
        );
    }

    // Add motion
    if (motionAmount > 0.0) {
        basePos += vec3(
            sin(t + seed.x * 6.28),
            cos(t * 0.8 + seed.y * 6.28),
            sin(t * 1.2 + seed.z * 6.28)
        ) * motionAmount * 0.3;
    }

    return basePos;
}

// Distance from point to line segment
float distToLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// Get color
vec3 getColor(int index, float depth, int mode, float time) {
    float fade = 1.0 - depth * depthFade;
    float fi = float(index);
    float hue = (fi / blobCount) + colorCycle * time * 0.2;

    if (mode == 0) {
        // White
        return vec3(fade);

    } else if (mode == 1) {
        // Rainbow per blob
        return vec3(
            sin(hue * 6.28) * 0.5 + 0.5,
            sin(hue * 6.28 + 2.094) * 0.5 + 0.5,
            sin(hue * 6.28 + 4.189) * 0.5 + 0.5
        ) * fade;

    } else if (mode == 2) {
        // Electric blue/cyan
        return mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 1.0), fade);

    } else if (mode == 3) {
        // Fire/heat
        return vec3(fade, fade * fade * 0.7, max(0.0, fade - 0.5) * 2.0);

    } else if (mode == 4) {
        // Toxic green
        return mix(vec3(0.0, 0.5, 0.0), vec3(0.5, 1.0, 0.2), fade);

    } else if (mode == 5) {
        // Purple plasma
        return mix(vec3(0.5, 0.0, 1.0), vec3(1.0, 0.3, 0.8), fade);

    } else {
        // Depth gradient
        return mix(vec3(0.0, 0.3, 0.6), vec3(1.0), fade);
    }
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float time = TIME;

    vec3 col = vec3(0.0);

    int netMode = int(networkMode);
    int colMode = int(colorMode);
    int blobCnt = int(blobCount);

    // Camera setup
    float autoRot = time * autoRotate;
    vec3 camPos = vec3(0.0, 0.0, -cameraDistance);

    // Rotation
    mat3 rotation = rotateZ(rotationZ + autoRot * 0.3) *
                    rotateY(rotationY + autoRot) *
                    rotateX(rotationX + autoRot * 0.7);

    // Calculate metaball field for blobs
    float minDist = 1000.0;
    int closestBlob = 0;
    float closestDepth = 0.0;

    // Store blob screen positions
    vec2 blobScreenPos[40];
    float blobDepth[40];
    bool blobVisible[40];

    // First pass: calculate blob field and project to screen
    for (int i = 0; i < 40; i++) {
        if (i >= blobCnt) break;

        vec3 pos = rotation * getBlobPosition(i, time, netMode);
        float depth = pos.z + cameraDistance;

        if (depth > 0.1) {
            vec2 screen = pos.xy / (depth * fov);
            blobScreenPos[i] = screen;
            blobDepth[i] = depth;
            blobVisible[i] = true;

            // Metaball contribution
            float dist2D = length(uv - screen);
            float size = blobSize / (depth / cameraDistance);
            float blobDist = dist2D - size;

            // Smooth merge
            if (blobSmoothness > 0.0) {
                minDist = smin(minDist, blobDist, blobSmoothness * 0.1);
            } else {
                minDist = min(minDist, blobDist);
            }

            // Track closest for color
            if (dist2D < length(uv - blobScreenPos[closestBlob])) {
                closestBlob = i;
                closestDepth = depth / cameraDistance;
            }
        } else {
            blobVisible[i] = false;
        }
    }

    // Draw connections
    if (showConnections > 0.0) {
        float closestLineDist = 1000.0;
        vec3 closestLineColor = vec3(1.0);

        for (int i = 0; i < 40; i++) {
            if (i >= blobCnt || !blobVisible[i]) continue;

            vec3 posA = rotation * getBlobPosition(i, time, netMode);

            for (int j = i + 1; j < 40; j++) {
                if (j >= blobCnt || !blobVisible[j]) continue;

                vec3 posB = rotation * getBlobPosition(j, time, netMode);

                // Check 3D distance
                float dist3D = length(posB - posA);
                if (dist3D > connectionDistance) continue;

                // Draw line in screen space
                vec2 screenA = blobScreenPos[i];
                vec2 screenB = blobScreenPos[j];

                float lineDist = distToLine(uv, screenA, screenB);
                float avgDepth = (blobDepth[i] + blobDepth[j]) * 0.5;

                if (lineDist < closestLineDist) {
                    closestLineDist = lineDist;
                    vec3 colorA = getColor(i, blobDepth[i] / cameraDistance, colMode, time);
                    vec3 colorB = getColor(j, blobDepth[j] / cameraDistance, colMode, time);
                    closestLineColor = (colorA + colorB) * 0.5;
                }
            }
        }

        // Render closest connection
        if (closestLineDist < lineThickness * 10.0) {
            float intensity = 1.0 - smoothstep(0.0, lineThickness * 10.0, closestLineDist);
            col += closestLineColor * intensity * showConnections;

            if (connectionGlow > 0.0) {
                float glowIntensity = 1.0 - smoothstep(0.0, lineThickness * 30.0, closestLineDist);
                col += closestLineColor * glowIntensity * connectionGlow * showConnections * 0.3;
            }
        }
    }

    // Render blob surface
    if (showBlobs > 0.0 && minDist < 0.0) {
        vec3 blobColor = getColor(closestBlob, closestDepth, colMode, time);
        col = max(col, blobColor * showBlobs);

        // Blob glow from center
        if (blobGlow > 0.0) {
            float centerDist = length(uv - blobScreenPos[closestBlob]);
            float size = blobSize / (blobDepth[closestBlob] / cameraDistance);
            float glow = 1.0 - smoothstep(0.0, size * 2.0, centerDist);
            col += blobColor * glow * blobGlow * showBlobs * 0.3;
        }
    }

    // Post processing
    col = pow(col, vec3(1.0 / contrast));
    col *= brightness;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
