/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Electric lightning storm with branching bolts",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Electric"],
    "INPUTS": [
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5, "LABEL": "Intensity"},
        {"NAME": "boltCount", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0, "LABEL": "Bolt Count"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Speed"},
        {"NAME": "branches", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Branches"},
        {"NAME": "thickness", "TYPE": "float", "MIN": 0.01, "MAX": 0.1, "DEFAULT": 0.03, "LABEL": "Thickness"},
        {"NAME": "boltColor", "TYPE": "color", "DEFAULT": [0.5, 0.7, 1.0, 1.0], "LABEL": "Bolt Color"},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.2, 0.3, 0.8, 1.0], "LABEL": "Glow Color"},
        {"NAME": "horizontal", "TYPE": "bool", "DEFAULT": false, "LABEL": "Horizontal"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f));
}

float bolt(vec2 uv, float seed, float t) {
    float coord = horizontal ? uv.x : uv.y;
    float perp = horizontal ? uv.y : uv.x;

    // Main bolt path with noise displacement
    float path = 0.5;
    float amp = 0.15;
    for (float i = 0.0; i < 5.0; i++) {
        path += (noise(coord * (3.0 + i * 2.0) + seed * 100.0 + t * speed * (1.0 + i * 0.3)) - 0.5) * amp;
        amp *= 0.6;
    }

    float dist = abs(perp - path);
    float bolt = smoothstep(thickness, 0.0, dist);

    // Add branches
    if (branches > 0.0) {
        for (float b = 0.0; b < 3.0; b++) {
            float branchStart = hash(seed + b * 7.3) * 0.8 + 0.1;
            if (coord > branchStart && coord < branchStart + 0.3) {
                float branchPath = path + (coord - branchStart) * (hash(seed + b * 3.1) - 0.5) * 2.0;
                branchPath += noise(coord * 8.0 + seed * 50.0 + b * 20.0 + t * speed) * 0.1;
                float branchDist = abs(perp - branchPath);
                bolt += smoothstep(thickness * 0.5, 0.0, branchDist) * branches * (1.0 - (coord - branchStart) / 0.3);
            }
        }
    }

    return bolt;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME;

    vec3 col = vec3(0.0);

    for (float i = 0.0; i < 8.0; i++) {
        if (i >= boltCount) break;

        float seed = i * 1.234;
        float flashPhase = fract(t * 0.5 + hash(i * 5.67));
        float flash = smoothstep(0.0, 0.1, flashPhase) * smoothstep(0.3, 0.1, flashPhase);

        if (flash > 0.01) {
            float b = bolt(uv, seed + floor(t * 0.5 + hash(i * 5.67)), t);

            // Core
            col += boltColor.rgb * b * flash * intensity;

            // Glow
            col += glowColor.rgb * b * flash * 0.5 * intensity;
        }
    }

    // Ambient flicker
    col += glowColor.rgb * 0.02 * (0.5 + 0.5 * sin(t * 20.0));

    gl_FragColor = vec4(col, 1.0);
}
