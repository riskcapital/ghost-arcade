/*{
    "DESCRIPTION": "EdgeEcho - Neo-geometric concentric frames pulse inward from the container edge with perimeter runners and corner flashes. Minimal, high-contrast, built to scream 'the edge is the subject'.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",         "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "frameCount",    "TYPE": "float", "DEFAULT": 9.0,  "MIN": 2.0,   "MAX": 24.0},
        {"NAME": "frameWidth",    "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.005, "MAX": 0.2},
        {"NAME": "frameFalloff",  "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "hairline",      "TYPE": "float", "DEFAULT": 1.5,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "hairlineWidth", "TYPE": "float", "DEFAULT": 0.006,"MIN": 0.001, "MAX": 0.03},
        {"NAME": "runnerCount",   "TYPE": "float", "DEFAULT": 3.0,  "MIN": 0.0,   "MAX": 8.0},
        {"NAME": "runnerSize",    "TYPE": "float", "DEFAULT": 0.022,"MIN": 0.004, "MAX": 0.08},
        {"NAME": "runnerSpeed",   "TYPE": "float", "DEFAULT": 0.22, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "cornerFlash",   "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "scanStrength",  "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "mainColor",     "TYPE": "color", "DEFAULT": [0.15, 1.0, 0.85, 1.0]},
        {"NAME": "accentColor",   "TYPE": "color", "DEFAULT": [1.0, 0.25, 0.6, 1.0]},
        {"NAME": "bgColor",       "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Distance to nearest edge (0 at edge, up to 0.5 at center in tight axis)
    float ex = min(uv.x, 1.0 - uv.x);
    float ey = min(uv.y, 1.0 - uv.y);
    float edgeDist = min(ex, ey);

    vec3 col = bgColor.rgb;

    // --- Concentric echo frames pulsing inward from the edge ---
    float phase = edgeDist * frameCount - t;
    float ring = fract(phase);
    float lineProx = min(ring, 1.0 - ring);                     // 0 at ring, 0.5 between
    float line = smoothstep(frameWidth * 0.5, 0.0, lineProx);
    float depthFade = mix(1.0, 1.0 - smoothstep(0.0, 0.5, edgeDist), frameFalloff);
    float alt = 0.55 + 0.45 * sin(phase * 3.14159 + t * 0.8);
    vec3 ringCol = mix(mainColor.rgb, accentColor.rgb,
                       0.5 + 0.5 * sin(phase * 0.7 + t * 0.25));
    col += ringCol * line * depthFade * alt * 1.4;

    // --- Hairline: crisp bright frame right at the container edge ---
    float hair = smoothstep(hairlineWidth, 0.0, edgeDist);
    col += mainColor.rgb * hair * hairline;

    // --- Perimeter runners: bright dots racing the border ---
    for (int i = 0; i < 8; i++) {
        if (float(i) >= runnerCount) break;
        float fi = float(i);
        float rPhase = fract(runnerSpeed * TIME + fi / max(runnerCount, 1.0));
        float p4 = rPhase * 4.0;
        vec2 rp;
        if (p4 < 1.0)      rp = vec2(p4,           0.0);
        else if (p4 < 2.0) rp = vec2(1.0,          p4 - 1.0);
        else if (p4 < 3.0) rp = vec2(3.0 - p4,     1.0);
        else               rp = vec2(0.0,          4.0 - p4);

        vec2 diff = uv - rp;
        diff.x *= aspect;
        float d = length(diff);
        float core = smoothstep(runnerSize, 0.0, d);
        float glow = runnerSize / (d + 0.002) * 0.025;
        vec3 rc = (mod(fi, 2.0) < 1.0) ? accentColor.rgb : mainColor.rgb;
        col += rc * (core * 2.5 + glow);
    }

    // --- Corner flash: emphatic glow at each corner ---
    vec2 cornerVec = vec2(ex, ey);
    float cornerDist = length(cornerVec);
    float cornerPulse = exp(-cornerDist * 14.0);
    float cornerBeat = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(t * 2.2), 3.0);
    col += mainColor.rgb * cornerPulse * cornerBeat * cornerFlash;

    // --- Edge scan lines: orthogonal ticks fading inward ---
    float scanX = smoothstep(0.96, 1.0, fract(uv.x * 32.0 - t * 0.6));
    float scanY = smoothstep(0.96, 1.0, fract(uv.y * 32.0 - t * 0.6));
    float edgeMask = smoothstep(0.25, 0.0, edgeDist);
    col += accentColor.rgb * (scanX + scanY) * edgeMask * scanStrength * 0.5;

    // Soft vignette darkening just inside the edge for extra contrast
    float vign = smoothstep(0.0, 0.5, edgeDist);
    col *= mix(1.0, 0.85 + 0.15 * vign, 0.3);

    gl_FragColor = vec4(col, 1.0);
}
