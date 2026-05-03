/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Wireframe Mesh 3D - Dynamic 3D Mesh Structures",
  "INPUTS": [
    {
      "NAME": "meshMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 7.0
    },
    {
      "NAME": "gridResolution",
      "TYPE": "float",
      "DEFAULT": 15.0,
      "MIN": 5.0,
      "MAX": 30.0
    },
    {
      "NAME": "deformAmount",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "deformFrequency",
      "TYPE": "float",
      "DEFAULT": 2.0,
      "MIN": 0.5,
      "MAX": 10.0
    },
    {
      "NAME": "rotationX",
      "TYPE": "float",
      "DEFAULT": 0.8,
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
      "DEFAULT": 4.0,
      "MIN": 1.0,
      "MAX": 10.0
    },
    {
      "NAME": "fov",
      "TYPE": "float",
      "DEFAULT": 0.6,
      "MIN": 0.3,
      "MAX": 2.0
    },
    {
      "NAME": "lineThickness",
      "TYPE": "float",
      "DEFAULT": 0.0015,
      "MIN": 0.0003,
      "MAX": 0.005
    },
    {
      "NAME": "vertexSize",
      "TYPE": "float",
      "DEFAULT": 0.008,
      "MIN": 0.0,
      "MAX": 0.02
    },
    {
      "NAME": "showVertices",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "animationSpeed",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "depthFade",
      "TYPE": "float",
      "DEFAULT": 0.7,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "lineGlow",
      "TYPE": "float",
      "DEFAULT": 0.2,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "vertexGlow",
      "TYPE": "float",
      "DEFAULT": 0.8,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "colorMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 5.0
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
    },
    {
      "NAME": "frontFacing",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    }
  ]
}*/

// ============================================================================
// Wireframe Mesh 3D - Clear Wireframe Visualization
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359

// Rotation matrices
mat3 rotateX(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        1.0, 0.0, 0.0,
        0.0, c, -s,
        0.0, s, c
    );
}

mat3 rotateY(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        c, 0.0, s,
        0.0, 1.0, 0.0,
        -s, 0.0, c
    );
}

mat3 rotateZ(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        c, -s, 0.0,
        s, c, 0.0,
        0.0, 0.0, 1.0
    );
}

// Get 3D position for a grid vertex
vec3 getVertexPosition(float gx, float gy, float gridSize, float time, int mode) {
    // Normalized to -1 to 1
    vec2 pos = vec2(gx, gy) / gridSize * 2.0 - 1.0;

    vec3 position;
    float t = time * animationSpeed;

    if (mode == 0) {
        // Sine wave plane
        float z = sin(pos.x * deformFrequency * PI + t) *
                  cos(pos.y * deformFrequency * PI + t * 0.8) *
                  deformAmount * 0.5;
        position = vec3(pos.x * 1.5, pos.y * 1.5, z);

    } else if (mode == 1) {
        // Sphere
        float theta = pos.x * PI;
        float phi = pos.y * PI;
        float radius = 1.0 + sin(t + theta * 3.0) * deformAmount * 0.15;
        position = vec3(
            sin(phi) * cos(theta) * radius,
            sin(phi) * sin(theta) * radius,
            cos(phi) * radius
        );

    } else if (mode == 2) {
        // Torus
        float u = pos.x * PI * 2.0;
        float v = pos.y * PI * 2.0;
        float R = 1.2;
        float r = 0.5 + sin(t + v * 2.0) * deformAmount * 0.15;
        position = vec3(
            (R + r * cos(v)) * cos(u),
            (R + r * cos(v)) * sin(u),
            r * sin(v)
        );

    } else if (mode == 3) {
        // Ripple
        float dist = length(pos);
        float z = sin(dist * deformFrequency * 5.0 - t * 2.0) *
                  deformAmount * 0.5 * exp(-dist);
        position = vec3(pos.x * 1.5, pos.y * 1.5, z);

    } else if (mode == 4) {
        // Twisted plane
        float twist = pos.y * deformAmount * 0.5;
        position = vec3(
            pos.x * cos(twist) * 1.5,
            pos.y * 1.5,
            pos.x * sin(twist) + sin(t + pos.y * 2.0) * 0.3
        );

    } else if (mode == 5) {
        // Cylinder
        float angle = pos.x * PI * 2.0;
        float radius = 1.0 + sin(pos.y * deformFrequency * 3.0 + t) * deformAmount * 0.2;
        position = vec3(
            cos(angle) * radius,
            pos.y * 2.0,
            sin(angle) * radius
        );

    } else if (mode == 6) {
        // Terrain
        float n1 = sin(pos.x * deformFrequency * 2.0 + t * 0.5) *
                   cos(pos.y * deformFrequency * 2.0);
        float n2 = sin(pos.x * deformFrequency * 5.0) *
                   cos(pos.y * deformFrequency * 5.0) * 0.3;
        float z = (n1 + n2) * deformAmount * 0.5;
        position = vec3(pos.x * 1.5, pos.y * 1.5, z);

    } else {
        // Möbius
        float u = pos.x * PI * 2.0;
        float v = pos.y * 0.5;
        position = vec3(
            (1.0 + v * cos(u * 0.5)) * cos(u),
            (1.0 + v * cos(u * 0.5)) * sin(u),
            v * sin(u * 0.5) + sin(t + u) * deformAmount * 0.1
        );
    }

    return position;
}

// Distance from point to line segment
float distToLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// Get color
vec3 getColor(float depth, int mode) {
    float fade = 1.0 - depth * depthFade;

    if (mode == 0) {
        return vec3(fade);
    } else if (mode == 1) {
        return mix(vec3(0.0, 0.5, 1.0), vec3(1.0), fade);
    } else if (mode == 2) {
        return mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 1.0, 0.3), fade);
    } else if (mode == 3) {
        return mix(vec3(0.0, 0.3, 0.6), vec3(0.3, 1.0, 1.0), fade);
    } else if (mode == 4) {
        return vec3(fade, fade * fade * 0.7, 1.0 - fade * 0.5);
    } else {
        return vec3(0.0, fade * 1.5, fade * 0.4);
    }
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float time = TIME;

    vec3 col = vec3(0.0);

    int mMode = int(meshMode);
    int colMode = int(colorMode);

    // Camera
    float ff = clamp(frontFacing, 0.0, 1.0);
    float autoRot = time * autoRotate * (1.0 - ff);
    vec3 camPos = vec3(0.0, 0.0, -cameraDistance);

    // Rotation (frontFacing blends toward head-on view)
    float rx = mix(rotationX + autoRot * 0.7, 0.0, ff);
    float ry = mix(rotationY + autoRot, 0.0, ff);
    float rz = mix(rotationZ + autoRot * 0.3, 0.0, ff);
    mat3 rotation = rotateZ(rz) * rotateY(ry) * rotateX(rx);

    int gridRes = int(gridResolution);
    float gridSize = float(gridRes);

    // Track closest line/vertex for clean rendering
    float closestLineDist = 1000.0;
    float closestVertexDist = 1000.0;
    vec3 closestLineColor = vec3(1.0);
    vec3 closestVertexColor = vec3(1.0);
    float closestLineDepth = 0.0;
    float closestVertexDepth = 0.0;

    // Scan all grid cells
    for (int gy = 0; gy < 30; gy++) {
        if (gy >= gridRes) break;

        for (int gx = 0; gx < 30; gx++) {
            if (gx >= gridRes) break;

            float fx = float(gx);
            float fy = float(gy);

            // Get vertex position
            vec3 pos = getVertexPosition(fx, fy, gridSize, time, mMode);
            pos = rotation * pos;

            // Perspective projection
            float depth = pos.z + cameraDistance;
            if (depth <= 0.1) continue;

            vec2 screen = pos.xy / (depth * fov);

            // Draw horizontal line to next vertex
            if (gx < gridRes - 1) {
                vec3 posR = rotation * getVertexPosition(fx + 1.0, fy, gridSize, time, mMode);
                float depthR = posR.z + cameraDistance;

                if (depthR > 0.1) {
                    vec2 screenR = posR.xy / (depthR * fov);

                    float lineDist = distToLine(uv, screen, screenR);
                    float avgDepth = (depth + depthR) * 0.5;

                    if (lineDist < closestLineDist) {
                        closestLineDist = lineDist;
                        closestLineDepth = avgDepth / cameraDistance;
                        closestLineColor = getColor(closestLineDepth, colMode);
                    }
                }
            }

            // Draw vertical line to next vertex
            if (gy < gridRes - 1) {
                vec3 posB = rotation * getVertexPosition(fx, fy + 1.0, gridSize, time, mMode);
                float depthB = posB.z + cameraDistance;

                if (depthB > 0.1) {
                    vec2 screenB = posB.xy / (depthB * fov);

                    float lineDist = distToLine(uv, screen, screenB);
                    float avgDepth = (depth + depthB) * 0.5;

                    if (lineDist < closestLineDist) {
                        closestLineDist = lineDist;
                        closestLineDepth = avgDepth / cameraDistance;
                        closestLineColor = getColor(closestLineDepth, colMode);
                    }
                }
            }

            // Track vertex
            float vertDist = length(uv - screen);
            if (vertDist < closestVertexDist) {
                closestVertexDist = vertDist;
                closestVertexDepth = depth / cameraDistance;
                closestVertexColor = getColor(closestVertexDepth, colMode);
            }
        }
    }

    // Render closest line
    if (closestLineDist < lineThickness * 10.0) {
        float intensity = 1.0 - smoothstep(0.0, lineThickness * 10.0, closestLineDist);
        col = closestLineColor * intensity;

        // Glow
        if (lineGlow > 0.0) {
            float glowIntensity = 1.0 - smoothstep(0.0, lineThickness * 30.0, closestLineDist);
            col += closestLineColor * glowIntensity * lineGlow * 0.3;
        }
    }

    // Render closest vertex on top
    if (showVertices > 0.0 && closestVertexDist < vertexSize * 5.0) {
        float core = 1.0 - smoothstep(0.0, vertexSize, closestVertexDist);
        float glow = 1.0 - smoothstep(0.0, vertexSize * 5.0, closestVertexDist);

        col = max(col, closestVertexColor * core * showVertices);
        col += closestVertexColor * glow * vertexGlow * showVertices * 0.2;
    }

    // Post processing
    col = pow(col, vec3(1.0 / contrast));
    col *= brightness;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
