/*{
    "DESCRIPTION": "Window into a vast cathedral-like space filled with atmospheric fog and light shafts",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "fogDensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "shaftWidth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5}
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

float fbm(vec2 p, float t) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p + t * 0.05 * float(i + 1));
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

    // Light shafts from above: vertical columns of illumination
    // Fixed shaft positions across the width, coming from the top
    float shaftLight = 0.0;
    for (int s = 0; s < 5; s++) {
        float fs = float(s);
        float shaftX = -0.7 + fs * 0.35 + sin(t * 0.08 + fs * 1.5) * 0.05;
        float sx = fromCenter.x * aspect - shaftX;
        float sw = 0.08 * shaftWidth + 0.02 * sin(t * 0.3 + fs * 2.0);
        float shaft = exp(-sx * sx / (sw * sw));
        // Shafts come from top, fade toward bottom
        float vertFade = smoothstep(-1.0, 0.8, fromCenter.y);
        shaft *= vertFade;
        // Slight sway
        shaft *= 0.8 + 0.2 * sin(t * 0.2 + fs);
        shaftLight += shaft;
    }
    shaftLight = min(shaftLight, 1.5);

    // Fog layers at different depths
    for (int i = 0; i < 10; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 10.0 * depth;

        // Parallax: deeper layers = more shrink, creating vast depth
        float parallax = 1.0 - z * 0.5;
        vec2 luv = fromCenter * parallax;
        luv.x *= aspect;

        // Fog noise: slowly drifting layers
        vec2 fogUV = luv * (1.5 + fi * 0.3) * fogDensity;
        float fogScroll = t * (0.05 + fi * 0.02);
        float fog = fbm(fogUV + vec2(fogScroll, fi * 3.0), t);

        // Shape fog into horizontal bands for cathedral feel
        float yBand = sin(luv.y * 2.0 + fi * 1.2 + t * 0.1) * 0.5 + 0.5;
        fog = fog * 0.6 + yBand * 0.4;
        fog = smoothstep(0.3, 0.7, fog);

        // Depth brightness: far layers dimmer but still visible (vast space)
        float brightness = (1.0 - z * 0.55) * intensity;

        // Shaft illumination at this depth layer
        float shaftAtDepth = shaftLight * (1.0 - z * 0.3);

        // Cold fog base color (blue/grey)
        float hue = colorShift + fi * 0.2;
        vec3 fogCol = vec3(
            0.15 + 0.05 * sin(hue + 3.0),
            0.18 + 0.05 * sin(hue + 1.5),
            0.25 + 0.08 * sin(hue + 0.0)
        );
        // Warm where light shafts hit fog
        vec3 warmCol = vec3(
            0.9 + 0.1 * sin(hue),
            0.75 + 0.1 * sin(hue + 0.5),
            0.45 + 0.1 * sin(hue + 1.0)
        );
        vec3 litFog = mix(fogCol, warmCol, shaftAtDepth * 0.6);
        litFog *= 1.0 + high * 0.2;

        col += litFog * fog * brightness * 0.18;

        // Dust motes in the light shafts (sparse)
        if (fi < 6.0) {
            vec2 dustUV = luv * (20.0 + fi * 5.0);
            dustUV += vec2(t * 0.03, -t * 0.01 + fi * 2.0);
            vec2 dustCell = floor(dustUV);
            vec2 dustFrac = fract(dustUV);
            float dh = hash(dustCell + fi * 19.3);
            if (dh > 0.85) { // sparse
                vec2 dp = vec2(0.5 + sin(t * 0.4 + dh * 6.28) * 0.15,
                               0.5 + cos(t * 0.3 + dh * 4.0) * 0.15);
                float dd = length(dustFrac - dp);
                float mote = smoothstep(0.04, 0.01, dd);
                float moteInLight = mote * shaftAtDepth * brightness * 0.5;
                moteInLight *= 1.0 + beat * 0.3;
                col += warmCol * moteInLight;
            }
        }
    }

    // Shaft glow overlay
    vec3 shaftCol = vec3(0.95, 0.85, 0.55);
    col += shaftCol * shaftLight * 0.08 * intensity * (1.0 + beat * 0.2);

    // Cathedral darkness at edges
    float vignette = 1.0 - edgeDist * 0.4;
    col *= vignette;

    // Very faint ambient so deep areas are never fully black
    col += vec3(0.02, 0.025, 0.04) * (1.0 - edgeDist * 0.3);

    gl_FragColor = vec4(col, 1.0);
}
