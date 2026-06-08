/*{
    "DESCRIPTION": "Window into a room of cascading digital glitch blocks and matrix rain at varying depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "glitchRate", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 4.0},
        {"NAME": "corruption", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
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

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 8.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.45;
        vec2 luv = fromCenter * parallax;
        luv.x *= aspect;

        // Block grid: near layers = large blocks, far = tiny
        float blockSize = max(2.0, 6.0 + fi * 4.0);
        vec2 blockUV = luv * blockSize;
        vec2 cell = floor(blockUV);
        vec2 cellFrac = fract(blockUV);

        float h1 = hash(cell + fi * 17.3);
        float h2 = hash2(cell + fi * 31.7);

        // Temporal glitch: blocks flicker on/off at random intervals
        float flickerT = floor(t * glitchRate * (2.0 + h1 * 6.0));
        float flicker = hash(cell + flickerT * 0.37 + fi * 5.0);

        // Only show some blocks (sparse data stream)
        float show = step(0.55 + z * 0.15, flicker);

        // Matrix rain: vertical falling columns
        float rainCol = hash(vec2(cell.x, fi * 7.0));
        float rainSpeed = 0.5 + rainCol * 2.0;
        float rainPhase = fract(t * rainSpeed * 0.3 + h2);
        float rainY = fract(cell.y * 0.1 - rainPhase);
        float rain = smoothstep(0.0, 0.3, rainY) * smoothstep(1.0, 0.5, rainY);
        rain *= step(0.4, rainCol); // only some columns have rain

        // Scanlines at this depth
        float scanFreq = 30.0 + fi * 15.0;
        float scan = sin(luv.y * scanFreq + t * 3.0 + fi * 2.0) * 0.5 + 0.5;
        scan = smoothstep(0.3, 0.7, scan) * 0.3;

        // Block brightness with glitch pulse
        float blockBright = show * (0.5 + flicker * 0.5);
        blockBright += rain * 0.6;
        blockBright += scan;

        // Inset blocks slightly (border effect)
        float border = step(0.08, cellFrac.x) * step(0.08, cellFrac.y)
                      * step(cellFrac.x, 0.92) * step(cellFrac.y, 0.92);
        blockBright *= border;

        // Depth brightness
        float brightness = (1.0 - z * 0.6) * intensity;
        brightness *= 1.0 + beat * 0.4 * show;

        // Green/cyan digital palette
        float hue = colorShift + fi * 0.12;
        vec3 digitCol = vec3(
            0.05 + 0.15 * sin(hue + 2.5),
            0.7 + 0.2 * sin(hue + 0.8),
            0.3 + 0.4 * sin(hue + 4.5)
        );
        digitCol *= 1.0 + high * 0.3;

        // Corruption flashes: hot pink/white
        float corruptChance = hash(cell + floor(t * glitchRate * 3.0) * 0.17 + fi * 9.0);
        float corrupt = step(1.0 - corruption * 0.15, corruptChance) * show;
        vec3 corruptCol = mix(vec3(1.0, 0.1, 0.6), vec3(1.0, 1.0, 1.0), hash(cell + fi));
        digitCol = mix(digitCol, corruptCol, corrupt * (1.0 + beat));

        col += digitCol * blockBright * brightness * 0.18;
    }

    // Global scanline overlay (near layer)
    float globalScan = sin(uv.y * RENDERSIZE.y * 0.5) * 0.5 + 0.5;
    col *= 0.9 + globalScan * 0.1;

    // Subtle CRT vignette
    float crtVig = 1.0 - edgeDist * edgeDist * 0.3;
    col *= crtVig;

    // Faint ambient glow
    col += vec3(0.0, 0.02, 0.01) * (1.0 - edgeDist * 0.5);

    gl_FragColor = vec4(col, 1.0);
}
