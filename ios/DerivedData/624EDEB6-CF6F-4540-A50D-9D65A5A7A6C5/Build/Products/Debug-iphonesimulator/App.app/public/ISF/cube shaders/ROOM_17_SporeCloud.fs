/*{
    "DESCRIPTION": "Window into a room filled with bioluminescent spores floating at different depths, blooming and fading",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "sporeDensity", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 16.0},
        {"NAME": "bloomSize", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    float beat = audioBeat;
    float high = audioHigh;

    vec3 col = vec3(0.0);

    // Faint ambient bio-glow
    col += vec3(0.0, 0.015, 0.02) * (1.0 - edgeDist * 0.3);

    for (int i = 0; i < 10; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 10.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.45;
        vec2 luv = fromCenter * parallax;
        luv.x *= aspect;

        // Grid for spore positions
        float gridScale = sporeDensity * (0.8 + fi * 0.25);
        vec2 gridUV = luv * gridScale;

        // Check 3x3 neighborhood for soft overlap
        for (int gx = -1; gx <= 1; gx++) {
            for (int gy = -1; gy <= 1; gy++) {
                vec2 cell = floor(gridUV) + vec2(float(gx), float(gy));
                vec2 cellFrac = fract(gridUV) - vec2(float(gx), float(gy));

                float h1 = hash(cell + fi * 13.7);
                float h2 = hash2(cell + fi * 27.3);
                float h3 = hash(cell * 0.7 + fi * 41.1 + 300.0);

                // Skip some cells for randomness
                if (h1 < 0.35) continue;

                // Spore position within cell with gentle drift
                vec2 sporePos = vec2(
                    0.5 + sin(t * 0.15 * (0.5 + h1) + h2 * 6.28) * 0.3,
                    0.5 + cos(t * 0.12 * (0.5 + h2) + h1 * 6.28) * 0.3
                );

                float d = length(cellFrac - sporePos);

                // Lifecycle: bloom, sustain, fade
                float lifecycle = fract(t * 0.2 * (0.3 + h3 * 0.7) + h1);
                float bloom = smoothstep(0.0, 0.2, lifecycle) * smoothstep(1.0, 0.6, lifecycle);

                // Pop flash at peak bloom
                float flash = smoothstep(0.18, 0.2, lifecycle) * smoothstep(0.25, 0.2, lifecycle);
                flash *= 3.0;

                // Spore size: near=large, far=small
                float size = (0.12 - z * 0.06) * bloomSize * (0.7 + h3 * 0.6);
                size *= bloom;

                // Soft glow circle
                float glow = exp(-d * d / (size * size + 0.001)) * bloom;

                // Depth brightness
                float brightness = (1.0 - z * 0.6) * intensity;
                brightness *= 1.0 + beat * 0.3 * flash;

                // Bio palette: green/teal/yellow
                float hue = colorShift + h1 * 2.0 + fi * 0.1;
                vec3 sporeCol = vec3(
                    0.15 + 0.3 * sin(hue + 2.0) + flash * 0.5,
                    0.7 + 0.2 * sin(hue + 0.5),
                    0.2 + 0.4 * sin(hue + 4.0)
                );
                sporeCol = max(sporeCol, 0.0);
                sporeCol *= 1.0 + high * 0.2;

                // Flash to bright white/yellow
                sporeCol = mix(sporeCol, vec3(1.0, 1.0, 0.7), flash * 0.4);

                col += sporeCol * glow * brightness * 0.15;
            }
        }
    }

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.35;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
