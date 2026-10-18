/*{
    "DESCRIPTION": "The walls breathing. A surface that will not hold still: its pattern flows through itself, folds, and comes back, while bands of colour run across it without ever settling. Fold it into a kaleidoscope, set how deep the flow goes, and add tracers, the echo a moving thing leaves behind it. Slow and low it is a living wallpaper; pushed up it is full peak. Bass makes it breathe, beats kick the colour, spectral centroid drives the flow.",
    "CREDIT": "Ghost Arcade psychedelic pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Blotter", "Orange Sunshine", "Windowpane", "Purple Microdot", "Day-Glo", "Peyote", "Monochrome"]},
        {"NAME": "symmetry",  "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [1, 2, 3, 4, 6, 8, 12], "LABELS": ["None", "Mirror", "3-fold", "4-fold", "6-fold", "8-fold", "12-fold"]},
        {"NAME": "scale",     "TYPE": "float", "DEFAULT": 3.20, "MIN": 0.60, "MAX": 8.00},
        {"NAME": "depth",     "TYPE": "long",  "DEFAULT": 5, "VALUES": [2, 3, 4, 5, 6, 7], "LABELS": ["2", "3", "4", "5", "6", "7"]},
        {"NAME": "fold",      "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "flow",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "bands",     "TYPE": "float", "DEFAULT": 2.50, "MIN": 0.50, "MAX": 10.0},
        {"NAME": "cycle",     "TYPE": "float", "DEFAULT": 0.25, "MIN": -2.00, "MAX": 2.00},
        {"NAME": "breathe",   "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "tracers",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "ink",       "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "relief",    "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "saturation","TYPE": "float", "DEFAULT": 1.10, "MIN": 0.00, "MAX": 1.60},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * The flow is a plane pushed through itself. Each round moves every point
 * sideways by an amount that depends on where it already is, then turns and
 * tightens the grid a little. After a few rounds straight lines have become
 * the paisley whorls of the pattern, and because every round is smooth the
 * whole thing can be slid along in time without tearing.
 *
 * Each round's push has an exact derivative, so how much the pattern has
 * been stretched at a pixel is known. That keeps the ink lines one weight
 * across the frame and gives the relief shading its surface slope.
 *
 * Tracers are the same pattern a moment earlier, laid under the present one.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float w = 0.5;
    for (int i = 0; i < 5; i++) {
        v += w * noise2(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 7.7);
        w *= 0.5;
    }
    return v;
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

vec3 saturate3(vec3 c, float amount) {
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(g), c, amount), 0.0);
}


mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Orange Sunshine */
        a = vec3(1.00, 0.42, 0.04); b = vec3(1.00, 0.84, 0.10); c = vec3(0.86, 0.08, 0.30);
    } else if (mode == 2) {     /* Windowpane - glass greens and blues */
        a = vec3(0.10, 0.86, 0.70); b = vec3(0.20, 0.40, 1.00); c = vec3(0.80, 1.00, 0.86);
    } else if (mode == 3) {     /* Purple Microdot */
        a = vec3(0.50, 0.12, 0.90); b = vec3(1.00, 0.36, 0.80); c = vec3(0.14, 0.10, 0.50);
    } else if (mode == 4) {     /* Day-Glo */
        a = vec3(1.00, 0.06, 0.56); b = vec3(0.60, 1.00, 0.04); c = vec3(0.04, 0.80, 1.00);
    } else if (mode == 5) {     /* Peyote - desert rose, turquoise, sand */
        a = vec3(0.90, 0.40, 0.36); b = vec3(0.16, 0.70, 0.66); c = vec3(0.96, 0.84, 0.60);
    } else if (mode == 6) {     /* Monochrome */
        a = vec3(0.96, 0.96, 0.94); b = vec3(0.10, 0.10, 0.12); c = vec3(0.56, 0.56, 0.58);
    } else {                    /* Blotter - the full wheel, taken in three */
        a = vec3(1.00, 0.10, 0.36); b = vec3(0.20, 0.90, 0.30); c = vec3(0.16, 0.30, 1.00);
    }
    return mat3(a, b, c);
}

/* Smooth walk round the three colours, with dark between them if asked. */
vec3 wheel3(mat3 pal, float x) {
    float k = fract(x) * 3.0;
    vec3 from = k < 1.0 ? pal[0] : k < 2.0 ? pal[1] : pal[2];
    vec3 to   = k < 1.0 ? pal[1] : k < 2.0 ? pal[2] : pal[0];
    float f = fract(k);
    return mix(from, to, f * f * (3.0 - 2.0 * f));
}

/* The pattern's value at p and time t; `stretch` returns how much the plane
   has been pulled about by the time it gets there. */
float pattern(vec2 p, float t, int rounds, float amount, out float stretch) {
    stretch = 1.0;
    float freq = 1.0;
    for (int i = 0; i < 7; i++) {
        if (i >= rounds) break;
        float fi = float(i);
        vec2 push = amount * vec2(sin(p.y * freq + t * (0.7 + 0.13 * fi) + fi * 1.7),
                                  cos(p.x * freq - t * (0.6 + 0.11 * fi) + fi * 2.3)) / freq;
        p += push;
        stretch *= 1.0 + amount * 0.55;
        p = mat2(0.80, 0.60, -0.60, 0.80) * p;
        freq *= 1.45;
    }
    return 0.5 + 0.25 * (sin(p.x) + sin(p.y));
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    /* Breathing: the whole surface swells and settles, more at the middle. */
    float swell = breathe * (0.5 * sin(TIME * 0.6) + 0.9 * (bass - 0.25));
    vec2 p = uv * (1.0 - 0.16 * swell * exp(-dot(uv, uv) * 1.5));

    /* Kaleidoscope fold. */
    float folds = float(symmetry);
    if (folds > 1.5) {
        float r = length(p);
        float a = atan(p.y, p.x) + TIME * 0.02;
        float seg = TAU / folds;
        a = abs(mod(a + seg * 0.5, seg) - seg * 0.5);
        p = r * vec2(cos(a), sin(a));
    }
    p *= scale;

    int rounds = int(depth);
    float amount = fold * (0.8 + 0.4 * centroid);
    float t = TIME * flow;
    float stretch;
    float v = pattern(p, t, rounds, amount, stretch);

    mat3 pal = paletteFor(int(colorMode));
    float turn = TIME * cycle * 0.2 + beat * 0.12;
    vec3 col = wheel3(pal, v * bands + turn);

    /* Tracers: the pattern as it was, a moment and two moments ago. */
    if (tracers > 0.01) {
        float s2;
        float lag = 0.10 + 0.5 * tracers;
        float v1 = pattern(p, t - lag, rounds, amount, s2);
        float v2 = pattern(p, t - lag * 2.0, rounds, amount, s2);
        vec3 ghost1 = wheel3(pal, v1 * bands + turn - 0.05);
        vec3 ghost2 = wheel3(pal, v2 * bands + turn - 0.10);
        col = max(col, ghost1 * 0.62 * tracers + col * (1.0 - 0.62 * tracers));
        col = mix(col, max(col, ghost2), 0.35 * tracers);
    }

    /* Ink lines along the band edges, held to one weight. */
    float pixel = scale / res.y * stretch;
    float lineRate = bands * 3.0 * 0.5 * pixel * 2.2;
    float edge = abs(fract(v * bands * 3.0 + turn * 3.0) - 0.5);
    float line = (1.0 - smoothstep(0.0, max(lineRate, 0.02) * (1.0 + 2.0 * ink), edge)) * (1.0 - smoothstep(0.25, 0.8, lineRate));
    col = mix(col, vec3(0.02, 0.01, 0.04), line * ink);

    /* Relief: light the pattern as if its value were height. */
    float hx = pattern(p + vec2(0.02, 0.0), t, rounds, amount, stretch) - v;
    float hy = pattern(p + vec2(0.0, 0.02), t, rounds, amount, stretch) - v;
    vec3 nrm = normalize(vec3(-hx, -hy, 0.02 / (0.25 + 2.5 * relief)));
    float lit = clamp(dot(nrm, normalize(vec3(-0.5, 0.6, 0.62))), 0.0, 1.0);
    col *= mix(1.0, 0.55 + 0.80 * lit, relief);
    col += vec3(1.0) * pow(lit, 24.0) * relief * 0.25 * (0.6 + 0.8 * level);

    col = saturate3(hueRotate(col, hueShift), saturation);
    col *= 1.0 + beat * 0.14;
    col *= exposure;
    col = col / (1.0 + 0.14 * col);
    col *= 1.14;

    gl_FragColor = vec4(col, 1.0);
}
