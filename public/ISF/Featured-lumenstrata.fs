/*{
    "DESCRIPTION": "Lumen Strata — a centred stack of overlapping translucent rounded-rectangle layers, each sliding up/down on its own phase and morphing its shape over time. Not a repeating concentric loop: the layers desync, breathe, and the palette drifts, so the overlaps evolve forever and never resolve to the same frame. Vertical red/magenta/cyan/indigo gradient. Pure 2D SDF.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Geometric", "Minimal"],
    "INPUTS": [
        { "NAME": "layerCount",    "TYPE": "float", "DEFAULT": 20.0,  "MIN": 2.0,   "MAX": 28.0,  "LABEL": "Layers" },
        { "NAME": "speed",         "TYPE": "float", "DEFAULT": 0.25,  "MIN": -1.0,  "MAX": 1.0,   "LABEL": "Evolve Speed" },
        { "NAME": "spread",        "TYPE": "float", "DEFAULT": 0.50,  "MIN": 0.0,   "MAX": 1.5,   "LABEL": "Stack Spread" },
        { "NAME": "stackDepth",    "TYPE": "float", "DEFAULT": 0.50,  "MIN": 0.0,   "MAX": 2.0,   "LABEL": "Extrusion" },
        { "NAME": "shapeWidth",    "TYPE": "float", "DEFAULT": 0.34,  "MIN": 0.05,  "MAX": 1.0,   "LABEL": "Width" },
        { "NAME": "shapeHeight",   "TYPE": "float", "DEFAULT": 0.46,  "MIN": 0.05,  "MAX": 1.0,   "LABEL": "Height" },
        { "NAME": "cornerRadius",  "TYPE": "float", "DEFAULT": 0.28,  "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Corner Radius" },
        { "NAME": "slideAmount",   "TYPE": "float", "DEFAULT": 0.06,  "MIN": 0.0,   "MAX": 0.60,  "LABEL": "Slide" },
        { "NAME": "slideSpeed",    "TYPE": "float", "DEFAULT": 0.60,  "MIN": 0.0,   "MAX": 3.0,   "LABEL": "Slide Speed" },
        { "NAME": "phaseSpread",   "TYPE": "float", "DEFAULT": 0.50,  "MIN": 0.0,   "MAX": 3.0,   "LABEL": "Layer Desync" },
        { "NAME": "morphAmount",   "TYPE": "float", "DEFAULT": 0.18,  "MIN": 0.0,   "MAX": 0.80,  "LABEL": "Shape Morph" },
        { "NAME": "morphSpeed",    "TYPE": "float", "DEFAULT": 0.40,  "MIN": 0.0,   "MAX": 3.0,   "LABEL": "Morph Speed" },
        { "NAME": "strokeWidth",   "TYPE": "float", "DEFAULT": 0.018, "MIN": 0.002, "MAX": 0.10,  "LABEL": "Stroke Width" },
        { "NAME": "layerAlpha",    "TYPE": "float", "DEFAULT": 0.50,  "MIN": 0.05,  "MAX": 1.0,   "LABEL": "Layer Opacity" },
        { "NAME": "glow",          "TYPE": "float", "DEFAULT": 0.30,  "MIN": 0.0,   "MAX": 1.5,   "LABEL": "Glow" },
        { "NAME": "glowFalloff",   "TYPE": "float", "DEFAULT": 7.0,   "MIN": 1.0,   "MAX": 30.0,  "LABEL": "Glow Falloff" },
        { "NAME": "zoom",          "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.30,  "MAX": 3.0,   "LABEL": "Zoom" },
        { "NAME": "hueShift",      "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.5,  "MAX": 0.5,   "LABEL": "Gradient Shift" },
        { "NAME": "hueDrift",      "TYPE": "float", "DEFAULT": 0.015, "MIN": 0.0,   "MAX": 0.30,  "LABEL": "Hue Drift" },
        { "NAME": "saturation",    "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.0,   "MAX": 2.0,   "LABEL": "Saturation" },
        { "NAME": "background",    "TYPE": "float", "DEFAULT": 0.05,  "MIN": 0.0,   "MAX": 0.50,  "LABEL": "Background" },
        { "NAME": "vignette",      "TYPE": "float", "DEFAULT": 0.35,  "MIN": 0.0,   "MAX": 1.5,   "LABEL": "Vignette" },
        { "NAME": "contrast",      "TYPE": "float", "DEFAULT": 1.10,  "MIN": 0.5,   "MAX": 2.0,   "LABEL": "Contrast" },
        { "NAME": "grain",         "TYPE": "float", "DEFAULT": 0.04,  "MIN": 0.0,   "MAX": 0.30,  "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define MAX_LAYERS 28

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
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / m;
    uv /= max(zoom, 0.05);

    float vy = clamp(gl_FragCoord.y / R.y, 0.0, 1.0);
    float t = TIME * speed;

    // Accumulate only the line intensity in the loop; the colour is a
    // single screen-vertical gradient (same for every layer), so heavy
    // overlaps just build brightness — the translucent stacked-sheet look.
    float inten = 0.0;
    float denom = max(layerCount - 1.0, 1.0);

    for (int i = 0; i < MAX_LAYERS; i++) {
        float fi = float(i);
        if (fi >= layerCount) break;

        float n = fi / denom;            // 0..1 position through the stack
        float ph = fi * phaseSpread;     // per-layer phase -> desynced motion

        // Vertical stack offset + independent slide.
        float baseY = (n - 0.5) * spread;
        float slide = slideAmount * sin(t * slideSpeed + ph);
        vec2 center = vec2(0.0, baseY + slide);

        // Extrusion (outer layers larger) + per-layer shape morph.
        float scale = 1.0 + n * stackDepth;
        vec2 hs = vec2(shapeWidth, shapeHeight) * scale;
        hs.x *= 1.0 + morphAmount * 0.4 * sin(t * morphSpeed * 0.9 + ph);
        hs.y *= 1.0 + morphAmount * 0.4 * cos(t * morphSpeed * 0.7 + ph * 1.1);

        float rad = cornerRadius * scale * (1.0 + morphAmount * 0.6 * sin(t * morphSpeed * 0.5 + ph));
        rad = clamp(rad, 0.0, min(hs.x, hs.y) - 0.001);

        float sd = sdRoundedBox(uv - center, hs, rad);
        float dl = abs(sd);                                   // outline (both sides)
        float core = 1.0 - smoothstep(0.0, max(strokeWidth, 0.001), dl);
        float glowv = exp(-dl * glowFalloff) * glow;
        inten += (core + glowv) * layerAlpha;
    }

    // Colour: screen-vertical gradient with slow hue drift + saturation.
    float gpos = clamp(vy + hueShift, 0.0, 1.0);
    vec3 hsv = rgb2hsv(grad(gpos));
    hsv.x = fract(hsv.x + TIME * hueDrift);
    hsv.y *= saturation;
    vec3 col = hsv2rgb(hsv);

    vec3 outc = col * inten + col * background;

    // Vignette.
    float vig = 1.0 - vignette * dot(uv, uv) * 0.5;
    outc *= clamp(vig, 0.0, 1.0);

    // Contrast + soft saturating rolloff (keeps overlaps translucent, not blown).
    outc = (outc - 0.5) * contrast + 0.5;
    outc = max(outc, 0.0);
    outc = 1.0 - exp(-outc * 1.4);

    // Film grain.
    float gr = hash21(gl_FragCoord.xy + fract(TIME) * 97.0);
    outc += (gr - 0.5) * grain;

    gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
