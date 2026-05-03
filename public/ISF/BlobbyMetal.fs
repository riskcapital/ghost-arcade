/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Blobby metallic surface with merging metaballs",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "blobCount", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 6.0},
        {"NAME": "blobSize", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.4},
        {"NAME": "metalness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.9},
        {"NAME": "colorTint", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Smooth metaball function
float metaball(vec2 p, vec2 center, float radius) {
    float d = length(p - center);
    return radius * radius / (d * d + 0.001);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Create metaball field
    float field = 0.0;

    for (float i = 0.0; i < 12.0; i++) {
        if (i >= blobCount) break;

        // Organic movement patterns
        float angle = i * PI * 2.0 / blobCount + t * (0.3 + hash(i) * 0.2);
        float dist = 0.2 + sin(t * 0.5 + i * 1.5) * 0.15;

        vec2 center;
        center.x = cos(angle) * dist + sin(t * 0.3 + i * 2.1) * 0.1;
        center.y = sin(angle) * dist + cos(t * 0.4 + i * 1.7) * 0.1;

        // Add some blobs that merge and separate
        float phase = sin(t * 0.7 + i) * 0.5 + 0.5;
        float size = blobSize * (0.3 + hash(i + 10.0) * 0.7) * (0.8 + phase * 0.4);

        field += metaball(uv, center, size * 0.15);
    }

    // Add a central blob
    field += metaball(uv, vec2(sin(t * 0.2) * 0.05, cos(t * 0.3) * 0.05), blobSize * 0.2);

    // Threshold for surface
    float threshold = 1.0;
    float surface = smoothstep(threshold - 0.3, threshold + 0.1, field);

    // Lighting (fakeNormal below is derived from field value, not gradient)
    vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);

    float fieldNorm = clamp(field / 2.0, 0.0, 1.0);
    vec3 fakeNormal = normalize(vec3(
        sin(fieldNorm * PI * 2.0 + uv.x * 10.0),
        cos(fieldNorm * PI * 2.0 + uv.y * 10.0),
        1.0
    ));

    float diffuse = max(dot(fakeNormal, lightDir), 0.0);
    float specular = pow(max(dot(reflect(-lightDir, fakeNormal), viewDir), 0.0), 32.0);

    // Metal color
    vec3 metalColor;
    if (colorTint < 0.01) {
        // Silver/chrome
        metalColor = vec3(0.9, 0.9, 0.95);
    } else {
        // Tinted metal
        metalColor = hsv2rgb(vec3(colorTint, 0.4, 0.9));
    }

    // Compose color
    vec3 col = metalColor * (0.2 + diffuse * 0.5) * metalness;
    col += metalColor * (1.0 - metalness) * 0.5;
    col += vec3(1.0) * specular * metalness;

    // Environment reflection based on field
    float envReflect = sin(field * 3.0 + t) * 0.5 + 0.5;
    col += metalColor * envReflect * 0.2 * metalness;

    // Apply surface mask
    col *= surface;

    // Dark background with subtle glow
    vec3 bg = vec3(0.02, 0.02, 0.05);
    bg += metalColor * 0.05 * (1.0 - surface) * smoothstep(0.3, 1.0, field);

    col = mix(bg, col, surface);

    // Fresnel edge glow
    float edgeDist = abs(field - threshold);
    float edgeGlow = exp(-edgeDist * 20.0) * surface;
    col += metalColor * edgeGlow * 0.3;

    gl_FragColor = vec4(col, 1.0);
}
