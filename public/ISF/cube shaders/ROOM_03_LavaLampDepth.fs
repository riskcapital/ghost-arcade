/*{
    "DESCRIPTION": "Window into a room of molten lava lamp metaballs at layered depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "blobSize", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5},
        {"NAME": "blobCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 3.0, "MAX": 8.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Room coordinates
    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    // Audio
    float beatBulge = 1.0 + audioBeat * 0.8;
    float highShimmer = 1.0 + audioHigh * 0.3;

    vec3 col = vec3(0.0);

    for (int layer = 0; layer < 7; layer++) {
        float fl = float(layer);
        float layerDepth = (fl + 1.0) / 7.0 * depth;

        // Parallax: deeper layers shrink toward center
        float parallax = 1.0 - layerDepth * 0.45;
        vec2 luv = (uv - 0.5) * parallax + 0.5;
        luv.x *= aspect;

        // Metaball field: accumulate inverse distances
        float field = 0.0;
        float dominantBlob = 0.0;
        float dominantHue = 0.0;

        int count = int(blobCount);
        for (int b = 0; b < 8; b++) {
            if (b >= count) break;
            float fb = float(b);
            float seed = fl * 13.7 + fb * 7.3;

            // Orbital motion: lissajous-like paths
            float ox = hash(seed) * 6.28;
            float oy = hash(seed + 50.0) * 6.28;
            float sx = 0.3 + hash(seed + 100.0) * 0.4;
            float sy = 0.3 + hash(seed + 150.0) * 0.4;

            vec2 blobPos = vec2(
                0.5 + sin(t * (0.3 + hash(seed + 200.0) * 0.4) + ox) * sx,
                0.5 + cos(t * (0.2 + hash(seed + 250.0) * 0.3) + oy) * sy
            );

            // Blob radius: near layers = big, far = small
            float radius = (0.15 + hash(seed + 300.0) * 0.1) * blobSize * (1.0 - layerDepth * 0.5) * beatBulge;

            float d = length(luv - blobPos);
            float contribution = (radius * radius) / (d * d + 0.001);
            field += contribution;

            // Track dominant blob for coloring
            if (contribution > dominantBlob) {
                dominantBlob = contribution;
                dominantHue = hash(seed + 400.0);
            }
        }

        // Threshold for metaball surface
        float blob = smoothstep(3.5, 5.0, field);

        // Interior glow gradient
        float innerGlow = smoothstep(5.0, 12.0, field) * 0.5;

        // Molten color palette: orange / red / gold with per-blob hue
        float hue = dominantHue * 2.0 + colorShift;
        vec3 blobCol = vec3(
            0.9 + 0.1 * sin(hue),
            0.3 + 0.3 * sin(hue + 1.0),
            0.05 + 0.15 * sin(hue + 2.5)
        );

        // Hot core is brighter / whiter
        blobCol = mix(blobCol, vec3(1.0, 0.95, 0.8), innerGlow);

        // Brightness: near=vivid, far=dim
        float brightness = (1.0 - layerDepth * 0.65) * intensity * highShimmer;

        col += blobCol * (blob + innerGlow * 0.3) * brightness;
    }

    // Warm ambient glow from below (heat source)
    float heatGlow = exp(-uv.y * 3.0) * 0.12 * intensity * beatBulge;
    col += vec3(1.0, 0.25, 0.02) * heatGlow;

    // Room wall darkening
    float vignette = 1.0 - edgeDist * 0.35;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
