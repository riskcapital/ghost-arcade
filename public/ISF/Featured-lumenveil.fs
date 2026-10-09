/*{
    "DESCRIPTION": "Lumen Veil — an endless breathing tunnel of nested rounded-rectangle outlines drifting through a vertical red/magenta/cyan/indigo gradient. Minimalist, futurist, ever-evolving: the rings flow, the frame breathes and drifts, the hue slowly rotates, so it never repeats. Pure 2D SDF (cheap, 60fps).",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Geometric", "Minimal"],
    "INPUTS": [
        { "NAME": "speed",         "TYPE": "float", "DEFAULT": 0.15,  "MIN": -1.0,  "MAX": 1.0,   "LABEL": "Flow Speed" },
        { "NAME": "ringDensity",   "TYPE": "float", "DEFAULT": 11.0,  "MIN": 2.0,   "MAX": 40.0,  "LABEL": "Ring Density" },
        { "NAME": "strokeWidth",   "TYPE": "float", "DEFAULT": 0.06,  "MIN": 0.005, "MAX": 0.30,  "LABEL": "Stroke Width" },
        { "NAME": "boxWidth",      "TYPE": "float", "DEFAULT": 0.52,  "MIN": 0.10,  "MAX": 1.20,  "LABEL": "Width" },
        { "NAME": "boxHeight",     "TYPE": "float", "DEFAULT": 0.72,  "MIN": 0.10,  "MAX": 1.20,  "LABEL": "Height" },
        { "NAME": "cornerRadius",  "TYPE": "float", "DEFAULT": 0.36,  "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Corner Radius" },
        { "NAME": "zoom",          "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.30,  "MAX": 3.0,   "LABEL": "Zoom" },
        { "NAME": "breatheAmount", "TYPE": "float", "DEFAULT": 0.06,  "MIN": 0.0,   "MAX": 0.40,  "LABEL": "Breathe Amount" },
        { "NAME": "breatheSpeed",  "TYPE": "float", "DEFAULT": 0.40,  "MIN": 0.0,   "MAX": 3.0,   "LABEL": "Breathe Speed" },
        { "NAME": "driftAmount",   "TYPE": "float", "DEFAULT": 0.04,  "MIN": 0.0,   "MAX": 0.40,  "LABEL": "Drift" },
        { "NAME": "warp",          "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Warp" },
        { "NAME": "glow",          "TYPE": "float", "DEFAULT": 0.35,  "MIN": 0.0,   "MAX": 1.5,   "LABEL": "Glow" },
        { "NAME": "glowFalloff",   "TYPE": "float", "DEFAULT": 6.0,   "MIN": 1.0,   "MAX": 30.0,  "LABEL": "Glow Falloff" },
        { "NAME": "hueShift",      "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.5,  "MAX": 0.5,   "LABEL": "Gradient Shift" },
        { "NAME": "hueDrift",      "TYPE": "float", "DEFAULT": 0.02,  "MIN": 0.0,   "MAX": 0.30,  "LABEL": "Hue Drift" },
        { "NAME": "saturation",    "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.0,   "MAX": 2.0,   "LABEL": "Saturation" },
        { "NAME": "background",    "TYPE": "float", "DEFAULT": 0.04,  "MIN": 0.0,   "MAX": 0.50,  "LABEL": "Background" },
        { "NAME": "vignette",      "TYPE": "float", "DEFAULT": 0.30,  "MIN": 0.0,   "MAX": 1.5,   "LABEL": "Vignette" },
        { "NAME": "contrast",      "TYPE": "float", "DEFAULT": 1.10,  "MIN": 0.5,   "MAX": 2.0,   "LABEL": "Contrast" },
        { "NAME": "grain",         "TYPE": "float", "DEFAULT": 0.04,  "MIN": 0.0,   "MAX": 0.30,  "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

// ── helpers ─────────────────────────────────────────────────────────
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Signed distance to a rounded box centred at the origin.
float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// Vertical gradient: bottom indigo -> blue -> cyan -> magenta -> red (top).
vec3 grad(float y) {
    vec3 cIndigo = vec3(0.06, 0.03, 0.18);
    vec3 cBlue   = vec3(0.10, 0.30, 0.95);
    vec3 cCyan   = vec3(0.15, 0.85, 1.00);
    vec3 cMag    = vec3(1.00, 0.20, 0.70);
    vec3 cRed    = vec3(1.00, 0.18, 0.22);
    vec3 c = mix(cIndigo, cBlue, smoothstep(0.0,  0.30, y));
    c = mix(c, cCyan, smoothstep(0.28, 0.52, y));
    c = mix(c, cMag,  smoothstep(0.52, 0.80, y));
    c = mix(c, cRed,  smoothstep(0.80, 1.00, y));
    return c;
}

void main() {
    vec2 R = RENDERSIZE;
    float m = min(R.x, R.y);

    // Aspect-correct, centred coordinates (y up).
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / m;
    uv /= max(zoom, 0.05);

    // Vertical position for the colour gradient (0 bottom, 1 top).
    float vy = clamp(gl_FragCoord.y / R.y, 0.0, 1.0);

    // Breathing — two incommensurate sines so the pulse never lines up
    // exactly with itself: the frame keeps "breathing" without a loop.
    float breath = 1.0
        + breatheAmount * sin(TIME * breatheSpeed)
        + breatheAmount * 0.4 * sin(TIME * breatheSpeed * 0.37 + 1.7);

    vec2 halfSize = vec2(boxWidth, boxHeight) * breath;
    float rad = clamp(cornerRadius * breath, 0.0, min(halfSize.x, halfSize.y) - 0.001);

    // Slow lissajous drift (irrational-ish freq ratio -> non-repeating).
    vec2 drift = driftAmount * vec2(sin(TIME * 0.13), cos(TIME * 0.11 + 0.5));
    vec2 p = uv - drift;

    // Optional organic domain warp.
    if (warp > 0.0) {
        p += warp * 0.08 * vec2(sin(p.y * 3.1 + TIME * 0.6),
                                sin(p.x * 2.7 - TIME * 0.5));
    }

    // Nested rounded-rect outlines = level sets of the SDF, flowing inward.
    float sd = sdRoundedBox(p, halfSize, rad);
    float rings = sd * ringDensity - TIME * speed;
    float f = fract(rings);
    float dline = min(f, 1.0 - f);                 // 0 at a ring, 0.5 between
    float core = 1.0 - smoothstep(0.0, max(strokeWidth, 0.001), dline);
    float glowv = exp(-dline * glowFalloff) * glow;
    float lum = core + glowv;

    // Colour from the vertical gradient, with a slow continuous hue drift.
    float gpos = clamp(vy + hueShift, 0.0, 1.0);
    vec3 base = grad(gpos);
    vec3 hsv = rgb2hsv(base);
    hsv.x = fract(hsv.x + TIME * hueDrift);
    hsv.y *= saturation;
    vec3 col = hsv2rgb(hsv);

    vec3 outc = col * lum + col * background;

    // Soft vignette.
    float vig = 1.0 - vignette * dot(uv, uv) * 0.5;
    outc *= clamp(vig, 0.0, 1.0);

    // Contrast + gentle filmic rolloff.
    outc = (outc - 0.5) * contrast + 0.5;
    outc = max(outc, 0.0);
    outc = 1.0 - exp(-outc * 1.6);

    // Film grain.
    float gr = hash21(gl_FragCoord.xy + fract(TIME) * 97.0);
    outc += (gr - 0.5) * grain;

    gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
