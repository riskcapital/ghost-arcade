/*{
    "DESCRIPTION": "Window into a room with aurora borealis light curtains at layered depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "swayAmount", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "curtainWidth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5}
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

    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    float beat = audioBeat;
    float high = audioHigh;

    vec3 col = vec3(0.0);

    // 8 curtain layers at different depths
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 8.0 * depth;

        // Parallax compression
        float parallax = 1.0 - z * 0.45;
        vec2 luv = (uv - 0.5) * parallax + 0.5;

        // Curtain X position: spread across room width
        float curtainX = hash(fi * 7.3 + 1.0) * 0.8 + 0.1;

        // Multi-frequency sway
        float sway = sin(luv.y * 3.0 + t * 0.7 + fi * 2.1) * 0.08
                    + sin(luv.y * 7.0 + t * 1.3 + fi * 4.7) * 0.03
                    + sin(luv.y * 1.5 + t * 0.4 + fi * 1.3) * 0.12;
        sway *= swayAmount;

        float cx = luv.x - curtainX + sway;

        // Curtain shape: gaussian cross-section
        float w = (0.06 + hash(fi * 13.1) * 0.04) * curtainWidth;
        float curtain = exp(-cx * cx / (w * w));

        // Vertical shimmer: rippling brightness
        float shimmer = 0.6 + 0.4 * sin(luv.y * 12.0 + t * 2.0 + fi * 3.0);
        shimmer *= 0.7 + 0.3 * sin(luv.y * 5.0 - t * 0.8 + fi * 1.7);

        // Fade at top and bottom (curtains hang from above)
        float vertFade = smoothstep(0.0, 0.15, luv.y) * smoothstep(1.0, 0.7, luv.y);
        // Near-top brightness peak
        float topBright = 1.0 + exp(-(luv.y - 0.85) * (luv.y - 0.85) * 20.0) * 0.5;

        curtain *= shimmer * vertFade * topBright;

        // Depth: near=opaque, far=ethereal
        float opacity = (1.0 - z * 0.65) * intensity;
        opacity *= 1.0 + beat * 0.4 * (1.0 - z);

        // Aurora palette: green/blue/purple per layer
        float hue = fi * 0.8 + colorShift + luv.y * 1.5;
        vec3 auroraCol = vec3(
            0.1 + 0.4 * sin(hue + 4.0),
            0.5 + 0.4 * sin(hue + 1.0),
            0.3 + 0.5 * sin(hue + 2.5)
        );
        // Brighten with high frequencies
        auroraCol *= 1.0 + high * 0.3;

        // Additive glow with ethereal falloff
        vec3 glow = auroraCol * curtain * opacity;

        // Soft secondary halo
        float halo = exp(-cx * cx / (w * w * 6.0)) * 0.15 * opacity;
        glow += auroraCol * halo * shimmer * vertFade;

        col += glow;
    }

    // Ambient sky glow at top of room
    float skyGlow = smoothstep(0.5, 1.0, uv.y) * 0.1 * intensity;
    col += vec3(0.1, 0.3, 0.2) * skyGlow;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
