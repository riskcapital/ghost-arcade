/*{
    "DESCRIPTION": "Window into deep space with twinkling stars at extreme depth and vivid nebula gas clouds at varying distances",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "starDensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "nebulaDetail", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.5;
    }
    return v;
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

    // Deep background: star field at maximum depth
    for (int s = 0; s < 3; s++) {
        float fs = float(s);
        float starZ = 0.8 + fs * 0.07;
        float starParallax = 1.0 - starZ * 0.5 * depth;
        vec2 starUV = fromCenter * starParallax;
        starUV.x *= aspect;

        float gridScale = (25.0 + fs * 15.0) * starDensity;
        vec2 gridUV = starUV * gridScale;
        vec2 cell = floor(gridUV);
        vec2 cellFrac = fract(gridUV);

        float h1 = hash(cell + fs * 19.1);
        float h2 = hash(cell + fs * 37.3 + 100.0);

        // Only some cells have stars
        if (h1 > 0.7) {
            vec2 starPos = vec2(0.3 + h1 * 0.4, 0.3 + h2 * 0.4);
            float d = length(cellFrac - starPos);

            // Twinkle
            float twinkle = sin(t * (2.0 + h2 * 4.0) + h1 * 6.28) * 0.4 + 0.6;
            twinkle += high * 0.2;

            float glow = exp(-d * d * 2000.0) * twinkle;

            // Star color: mostly white, some blue/gold tints
            vec3 starCol = vec3(0.9 + h2 * 0.1, 0.85 + h1 * 0.15, 0.8 + h2 * 0.2);
            if (h1 > 0.9) starCol = vec3(0.6, 0.7, 1.0); // blue stars
            if (h1 > 0.95) starCol = vec3(1.0, 0.85, 0.5); // gold stars

            col += starCol * glow * intensity * 0.6;
        }
    }

    // Nebula gas clouds at varying depths
    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 7.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.45;
        vec2 luv = fromCenter * parallax;
        luv.x *= aspect;

        // Flowing nebula noise
        vec2 nebulaUV = luv * (1.5 + fi * 0.5) * nebulaDetail;
        float drift = t * 0.05 * (1.0 + fi * 0.15);
        nebulaUV += vec2(
            sin(drift + fi * 1.3) * 0.3,
            cos(drift * 0.7 + fi * 0.9) * 0.2
        );

        float n = fbm(nebulaUV + fi * 3.0);
        float n2 = fbm(nebulaUV * 1.5 + vec2(fi * 7.0, t * 0.03));

        // Shape nebula into wispy clouds
        float nebula = n * 0.6 + n2 * 0.4;
        nebula = smoothstep(0.3 + z * 0.1, 0.75, nebula);

        // Depth brightness
        float brightness = (1.0 - z * 0.5) * intensity * 0.25;
        brightness *= 1.0 + beat * 0.15;

        // Space palette: deep blue, purple, pink, orange
        float hue = colorShift + fi * 0.9 + n * 1.5;
        vec3 nebulaCol = vec3(
            0.3 + 0.4 * sin(hue + 0.0),
            0.1 + 0.3 * sin(hue + 2.1),
            0.4 + 0.4 * sin(hue + 4.2)
        );
        nebulaCol = max(nebulaCol, 0.0);
        nebulaCol *= 1.0 + high * 0.15;

        // Bright emission ridges
        float ridge = smoothstep(0.45, 0.55, nebula) * smoothstep(0.65, 0.55, nebula);
        nebulaCol += vec3(0.3, 0.15, 0.4) * ridge * 2.0;

        col += nebulaCol * nebula * brightness;
    }

    // Faint deep-space ambient
    col += vec3(0.02, 0.01, 0.04) * (1.0 - edgeDist * 0.5);

    // Room frame vignette
    float vignette = 1.0 - edgeDist * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
