/*{
    "DESCRIPTION": "FFT-driven aurora curtains — the live spectrum becomes northern lights. Each curtain's height and shimmer follows a band of the analyzer.",
    "CREDIT": "Ghost Arcade LIVE pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Audio Reactive", "Generator"],
    "INPUTS": [
        {"NAME": "heightAmt", "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.2, "MAX": 1.5},
        {"NAME": "glowAmt",   "TYPE": "float", "DEFAULT": 0.8,  "MIN": 0.2, "MAX": 1.5},
        {"NAME": "hueBase",   "TYPE": "float", "DEFAULT": 0.38, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "flow",      "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0, "MAX": 1.5},
        {"NAME": "shimmer",   "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 auroraColor(float h) {
    // The physical aurora ladder: oxygen green at the base, teal mid,
    // violet-red fringe at altitude. Saturated on purpose — projection
    // washes color out, so the source runs hot.
    vec3 green  = vec3(0.1, 1.0, 0.45);
    vec3 teal   = vec3(0.1, 0.75, 0.8);
    vec3 violet = vec3(0.6, 0.2, 0.95);
    float k = fract(h);
    if (k < 0.5) return mix(green, teal, k * 2.0);
    return mix(teal, violet, (k - 0.5) * 2.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    float level = max(audioLevel, 0.25);
    float beat = audioBeat;
    float t = TIME * flow;

    vec3 col = vec3(0.0);

    // Night-sky backdrop with a soft horizon glow.
    vec3 sky = mix(vec3(0.006, 0.008, 0.02), vec3(0.02, 0.015, 0.05), uv.y);
    col += sky;

    // Sparse stars.
    vec2 sp = uv * vec2(aspect, 1.0) * 60.0;
    vec2 cell = floor(sp);
    float star = hash21(cell);
    if (star > 0.965) {
        float d = length(fract(sp) - vec2(hash21(cell + 1.3), hash21(cell + 4.7)));
        float tw = 0.5 + 0.5 * sin(TIME * (1.5 + star * 4.0) + star * 30.0);
        col += vec3(0.8, 0.85, 1.0) * smoothstep(0.1, 0.0, d) * tw * 0.5;
    }

    // Five aurora curtains, each reading its own slice of the FFT.
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float layerT = t * (0.5 + fi * 0.17);

        // Sample the analyzer along x, staggered per curtain. sampleFFT is
        // the injected helper reading the live FFT texture.
        float bandX = fract(uv.x * 0.85 + fi * 0.045 + sin(layerT * 0.3) * 0.05);
        float fft = sampleFFT(bandX * 0.62 + fi * 0.05);
        fft = pow(fft, 1.4);

        // Curtain spine: a long undulating ridge — big slow waves with a
        // second harmonic so the curtain folds back on itself.
        float ridge = 0.2 + fi * 0.09;
        ridge += vnoise(vec2(uv.x * 1.3 + fi * 7.0, layerT * 0.5)) * 0.24;
        ridge += sin(uv.x * 4.5 + layerT * 1.1 + fi * 2.0) * 0.05;
        float ht = (0.14 + fft * 0.6 * heightAmt) * (0.8 + level * 0.5);

        // Vertical falloff: bright base line, tall soft plume above it.
        float above = uv.y - ridge;
        float plume = smoothstep(0.0, 0.015, above) * exp(-above / max(ht, 0.02));
        float baseLine = smoothstep(0.02, 0.0, abs(above)) * 1.6;

        // Curtain folds: noise-warped striations, wide bright pleats rather
        // than a fine comb. The warp makes each pleat lean and drift.
        float foldX = uv.x * 46.0 + vnoise(vec2(uv.x * 5.0, layerT * 0.8)) * 9.0 + layerT * 2.0;
        float stria = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(foldX), 2.0);
        stria = mix(1.0, stria, shimmer);

        // Altitude gradient: green at the ridge line climbing to violet at
        // the plume tips — the vertical color ladder makes it read as aurora.
        vec3 cBase = auroraColor(hueBase + fi * 0.04);
        vec3 cTip  = auroraColor(hueBase + 0.42 + fft * 0.15);
        vec3 c = mix(cBase, cTip, clamp(above / max(ht * 1.4, 0.05), 0.0, 1.0));
        float fade = 1.0 - fi * 0.13;
        col += c * (plume * 1.5 + baseLine * 0.6) * stria * glowAmt * fade * 0.6;
    }

    // Beat: the whole sky inhales slightly.
    col *= 1.0 + beat * 0.18;

    // Ground silhouette — anchors the composition on stage screens.
    float ground = smoothstep(0.16, 0.0, uv.y + vnoise(vec2(uv.x * 3.0, 2.7)) * 0.05 - 0.04);
    col = mix(col, vec3(0.0), ground);

    col = col / (col + 0.8);
    col = pow(col, vec3(0.85));
    col += (hash21(gl_FragCoord.xy + fract(TIME)) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
}
