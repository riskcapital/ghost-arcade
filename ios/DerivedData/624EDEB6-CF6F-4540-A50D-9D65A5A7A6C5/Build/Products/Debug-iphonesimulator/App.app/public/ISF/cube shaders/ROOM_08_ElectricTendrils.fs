/*{
    "DESCRIPTION": "Window into a room of branching electric arcs at layered depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "branchCount", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 6.0},
        {"NAME": "jitterAmount", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Cheap 2D noise for arc paths
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

// Fractal noise for jagged bolt paths
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

    for (int layer = 0; layer < 7; layer++) {
        float fl = float(layer);
        float z = (fl + 1.0) / 7.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.45;
        vec2 luv = fromCenter * parallax;
        luv.x *= aspect;

        // Multiple arc branches per layer
        int branches = int(branchCount);
        for (int b = 0; b < 6; b++) {
            if (b >= branches) break;
            float fb = float(b);

            // Arc direction: connect between walls
            float angle = hash(vec2(fl, fb * 17.3)) * 3.14159 + t * 0.2;
            vec2 dir = vec2(cos(angle), sin(angle));
            vec2 perp = vec2(-dir.y, dir.x);

            // Project point onto arc path
            float along = dot(luv, dir);
            float across = dot(luv, perp);

            // Bolt jitter via domain warping
            float timeSlice = floor(t * 3.0 + fb * 2.0 + fl);
            float jitter = (fbm(vec2(along * 4.0 + timeSlice * 7.1, fl * 3.0 + fb * 11.0)) - 0.5)
                          * 0.3 * jitterAmount;

            float dist = abs(across - jitter);

            // Width: near=thick, far=thin
            float w = (0.025 - z * 0.012) * (1.0 + beat * 0.5);

            // Bolt core (sharp) + glow (soft)
            float core = exp(-dist * dist / (w * w * 0.3));
            float glow = exp(-dist * dist / (w * w * 4.0));

            // Temporal flicker: bolts flash and reform
            float flicker = step(0.4, hash(vec2(timeSlice + fb, fl)));
            float fadeIn = smoothstep(0.0, 0.15, fract(t * 3.0 + fb * 2.0 + fl));

            float arc = (core + glow * 0.4) * flicker * fadeIn;

            // Fade at endpoints
            float endFade = smoothstep(1.2, 0.5, abs(along));
            arc *= endFade;

            // Depth brightness
            float brightness = (1.0 - z * 0.65) * intensity;
            brightness *= 1.0 + beat * 1.2 * (1.0 - z);

            // Electric color: white/blue core, purple/cyan glow
            float hue = fl * 0.5 + fb * 1.2 + colorShift;
            vec3 coreCol = vec3(0.8, 0.85, 1.0);
            vec3 glowCol = vec3(
                0.3 + 0.3 * sin(hue + 4.0),
                0.2 + 0.2 * sin(hue + 2.0),
                0.8 + 0.2 * sin(hue + 0.5)
            );
            glowCol *= 1.0 + high * 0.4;

            vec3 arcCol = mix(glowCol, coreCol, core);
            col += arcCol * arc * brightness * 0.35;
        }
    }

    // Ambient electrical haze
    float haze = exp(-length(fromCenter) * 2.0) * 0.08 * intensity;
    col += vec3(0.2, 0.15, 0.4) * haze * (1.0 + beat * 0.5);

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.35;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
