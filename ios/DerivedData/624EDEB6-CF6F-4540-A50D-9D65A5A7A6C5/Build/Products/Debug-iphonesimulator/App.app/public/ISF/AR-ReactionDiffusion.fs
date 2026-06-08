/*{
    "DESCRIPTION": "Gray-Scott reaction-diffusion inspired Turing patterns with audio-modulated feed/kill rates. Bass drives growth, highs drive decay. Animated domain warping creates organic morphing.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "feedRate", "TYPE": "float", "MIN": 0.02, "MAX": 0.08, "DEFAULT": 0.055},
        {"NAME": "killRate", "TYPE": "float", "MIN": 0.04, "MAX": 0.08, "DEFAULT": 0.062},
        {"NAME": "audioFeedMod", "TYPE": "float", "MIN": 0.0, "MAX": 0.05, "DEFAULT": 0.02},
        {"NAME": "audioKillMod", "TYPE": "float", "MIN": 0.0, "MAX": 0.04, "DEFAULT": 0.015},
        {"NAME": "patternScale", "TYPE": "float", "MIN": 2.0, "MAX": 15.0, "DEFAULT": 6.0},
        {"NAME": "colorIntensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Hash for pseudo-random
float hash(vec2 p) {
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
}

// 2D noise
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

// FBM with audio-driven octave weights
float fbm(vec2 p, float bassW, float highW) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 6; i++) {
        // Low octaves weighted by bass, high octaves by highs
        float w = mix(bassW, highW, float(i) / 5.0);
        val += amp * w * noise(p * freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    return val;
}

// Domain warping
vec2 warp(vec2 p, float t) {
    float n1 = noise(p + vec2(t * 0.3, t * 0.2));
    float n2 = noise(p + vec2(t * -0.2, t * 0.35) + vec2(5.2, 1.3));
    return vec2(n1, n2) * 2.0 - 1.0;
}

// Procedural Turing-like pattern
float turingPattern(vec2 p, float f, float k) {
    // Approximate reaction-diffusion look with layered sine waves
    float pattern = 0.0;
    // Scale f and k to visual range
    float fScale = f * 80.0;   // 1.6 - 6.4
    float kScale = k * 60.0;   // 2.4 - 4.8

    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float angle = fi * PI * 0.618;
        vec2 dir = vec2(cos(angle), sin(angle));
        float wave = sin(dot(p, dir) * fScale + fi * 1.7);
        // Sharpened by kill rate
        wave = smoothstep(-1.0 + kScale * 0.15, 1.0 - kScale * 0.15, wave);
        pattern += wave;
    }
    return pattern / 5.0;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

    // Audio-modulated feed/kill rates
    float bassFallback = 0.3 + 0.15 * sin(TIME * 0.8);
    float highFallback = 0.3 + 0.15 * sin(TIME * 1.2 + 1.0);
    float bassVal = max(audioBass, bassFallback);
    float highVal = max(audioHigh, highFallback);

    float f = feedRate + audioFeedMod * bassVal;
    float k = killRate + audioKillMod * highVal;

    // Scale and animate
    vec2 scaledP = p * patternScale;
    float t = TIME * 0.4;

    // Domain warping - multiple layers for organic motion
    vec2 w1 = warp(scaledP * 0.5, t);
    vec2 w2 = warp(scaledP * 0.5 + w1 * 0.8, t * 0.7);
    float warpStrength = 1.5 + 0.5 * bassVal;
    vec2 warpedP = scaledP + (w1 + w2 * 0.5) * warpStrength;

    // Generate Turing-like pattern
    float pattern = turingPattern(warpedP, f, k);

    // Second layer at different scale for depth
    float pattern2 = turingPattern(warpedP * 1.8 + vec2(3.7, 2.1), f * 0.9, k * 1.1);
    pattern = mix(pattern, pattern2, 0.3);

    // FBM detail overlay modulated by audio
    float detail = fbm(warpedP * 2.0 + t * 0.2, 0.8 + bassVal * 0.4, 0.6 + highVal * 0.4);
    pattern = pattern * 0.7 + detail * 0.3;

    // Normalize to 0-1 range
    float concentration = clamp(pattern * 0.5 + 0.5, 0.0, 1.0);

    // Color mapping - chemical concentration to color
    float hue = concentration * 0.4 + 0.55 + TIME * 0.02;
    hue += audioSpectralCentroid * 0.15;
    float sat = 0.6 + 0.4 * (1.0 - concentration);
    float val = concentration * colorIntensity;

    // Edge enhancement - where concentration changes rapidly
    float dx = turingPattern(warpedP + vec2(0.01, 0.0), f, k) - pattern;
    float dy = turingPattern(warpedP + vec2(0.0, 0.01), f, k) - pattern;
    float edge = length(vec2(dx, dy)) * 30.0;
    edge = clamp(edge, 0.0, 1.0);

    vec3 col = hsv2rgb(vec3(fract(hue), sat, val));

    // Edge glow with beat reactivity
    float beatFallback = 0.2 + 0.2 * sin(TIME * 2.5);
    float beatVal = max(audioBeat, beatFallback);
    vec3 edgeColor = hsv2rgb(vec3(fract(hue + 0.3), 0.9, 1.0));
    col += edgeColor * edge * (0.5 + beatVal * 0.8);

    // Beat flash
    col += vec3(0.1, 0.05, 0.15) * beatVal * 0.4;

    // Vignette
    float vig = 1.0 - dot(p, p) * 0.8;
    col *= clamp(vig, 0.0, 1.0);

    // Tone mapping
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
