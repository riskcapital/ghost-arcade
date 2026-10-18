/*{
    "DESCRIPTION": "A liquid light show. Coloured oils and dyed water pressed between clock glasses on an overhead projector, the way the ballroom light shows of the sixties were made: blobs that swell and split when the plates are squeezed, dyes that stack like stained glass where they overlap, a dark line and a bright one round every edge where the liquid bends the lamp. Up to three dishes are stacked, each with its own dye, and the whole stack turns like a colour wheel. Bass squeezes the plates, beats pump them, spectral centroid stirs the oil.",
    "CREDIT": "Ghost Arcade psychedelic pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Fillmore", "Avalon", "Purple Haze", "Sunshine", "Blue Cheer", "Strawberry", "Black Light"]},
        {"NAME": "dishes",    "TYPE": "long",  "DEFAULT": 3, "VALUES": [1, 2, 3], "LABELS": ["1", "2", "3"]},
        {"NAME": "blobSize",  "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.05, "MAX": 1.00},
        {"NAME": "coverage",  "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.10, "MAX": 0.90},
        {"NAME": "flow",      "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "stir",      "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "squeeze",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "wheel",     "TYPE": "float", "DEFAULT": 0.15, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "dyeStrength","TYPE": "float", "DEFAULT": 0.85, "MIN": 0.20, "MAX": 1.00},
        {"NAME": "edgeLine",  "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "caustic",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "bubbles",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "aperture",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "lampWarmth","TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Dye is subtractive. A dish of magenta oil does not add magenta light; it
 * takes green out of the lamp. Stack a yellow dish on it and blue goes too,
 * leaving red. So each dish is a filter, the picture is the lamp multiplied
 * through whichever dishes cover a point, and the colours where blobs overlap
 * are the ones a real show gives rather than a wash toward white.
 *
 * A blob is wherever a slow noise field is above a level. Squeezing the
 * plates is lowering that level: every blob grows at once, neighbours merge,
 * and when the pressure comes off they neck and split again. The edge of a
 * blob is a curved meniscus, a small lens, so it throws a dark line just
 * outside itself and a bright one just inside.
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
    for (int i = 0; i < 4; i++) {
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


/* Dye sets. Columns: the dye in each dish, as the colour it lets through. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Avalon - amber, turquoise, rose */
        a = vec3(1.00, 0.62, 0.10); b = vec3(0.10, 0.80, 0.78); c = vec3(1.00, 0.30, 0.50);
    } else if (mode == 2) {     /* Purple Haze */
        a = vec3(0.62, 0.20, 1.00); b = vec3(1.00, 0.30, 0.76); c = vec3(0.26, 0.40, 1.00);
    } else if (mode == 3) {     /* Sunshine - orange, yellow, hot pink */
        a = vec3(1.00, 0.44, 0.06); b = vec3(1.00, 0.90, 0.16); c = vec3(1.00, 0.20, 0.56);
    } else if (mode == 4) {     /* Blue Cheer */
        a = vec3(0.10, 0.36, 1.00); b = vec3(0.20, 0.90, 1.00); c = vec3(0.50, 0.26, 1.00);
    } else if (mode == 5) {     /* Strawberry */
        a = vec3(1.00, 0.14, 0.24); b = vec3(0.40, 0.86, 0.26); c = vec3(1.00, 0.70, 0.76);
    } else if (mode == 6) {     /* Black Light - dyes that glow on a dark lamp */
        a = vec3(0.30, 1.00, 0.20); b = vec3(1.00, 0.10, 0.86); c = vec3(0.16, 0.50, 1.00);
    } else {                    /* Fillmore - magenta, cyan, yellow: the printer's three */
        a = vec3(1.00, 0.12, 0.62); b = vec3(0.06, 0.74, 1.00); c = vec3(1.00, 0.88, 0.10);
    }
    return mat3(a, b, c);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int n = int(dishes);
    mat3 pal = paletteFor(int(colorMode));
    bool blackLight = int(colorMode) == 6;
    float t = TIME * flow;
    float press = squeeze * (0.35 * sin(TIME * 0.45) + 0.9 * (bass - 0.25) + 0.5 * beat);

    /* The lamp: warm in the middle, falling off, as an overhead projector is. */
    vec3 lamp = mix(vec3(1.0), vec3(1.0, 0.90, 0.74), lampWarmth) * (1.08 - 0.42 * dot(uv, uv));
    vec3 light = blackLight ? vec3(0.030, 0.012, 0.070) : lamp;
    vec3 glowAdd = vec3(0.0);
    float lens = 0.0;

    for (int i = 0; i < 3; i++) {
        if (i >= n) break;
        float fi = float(i);
        /* Each dish turns at its own rate; that is the colour wheel. */
        float ang = TIME * wheel * (0.35 + 0.22 * fi) * (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0) + fi * 2.1;
        vec2 p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * uv;
        /* Squeezing pushes liquid outward from the centre of the plate. */
        p *= 1.0 - 0.10 * press;
        float k = mix(7.0, 1.3, blobSize) * (1.0 + 0.18 * fi);
        vec2 q = p * k + vec2(fi * 17.0, -fi * 9.0);
        /* Stirring: the field is carried along by a slower one. */
        vec2 carry = vec2(fbm(q * 0.5 + vec2(t * 0.30, fi)), fbm(q * 0.5 + vec2(-fi, t * 0.26 + 4.0))) - 0.5;
        float field = fbm(q + carry * (1.2 + 2.6 * stir * (0.7 + 0.6 * centroid)) + vec2(0.0, t * 0.12));
        float edge = (1.0 - coverage) * 0.62 + 0.17 - 0.16 * press;
        float w = 0.010 + 0.004 * k;
        float d = field - edge;                         /* > 0 inside a blob */
        float inside = smoothstep(-w, w, d);

        vec3 dye = hueRotate(i == 0 ? pal[0] : i == 1 ? pal[1] : pal[2], hueShift);
        /* Thicker toward the middle of a blob, so the colour deepens there. */
        float thick = smoothstep(0.0, 0.16, d);
        vec3 pass = mix(vec3(1.0), dye, dyeStrength * (0.55 + 0.45 * thick));
        if (blackLight) glowAdd += dye * inside * (0.35 + 0.65 * thick) * (0.7 + 0.5 * level);
        else light *= mix(vec3(1.0), pass, inside);

        /* Meniscus: dark outside the edge, bright inside it. */
        float rimOut = exp(-pow((d + w * 1.6) / (w * 1.5), 2.0));
        float rimIn = exp(-pow((d - w * 2.6) / (w * 2.0), 2.0));
        light *= 1.0 - 0.55 * edgeLine * rimOut;
        lens += rimIn * caustic * 0.45;

        /* Air bubbles trapped in the oil. */
        vec2 bg = q * (2.4 + fi) + carry * 2.0;
        vec2 bid = floor(bg);
        vec2 bf = fract(bg) - 0.5;
        float bh = hash21(bid + fi * 31.0);
        vec2 bo = (vec2(hash21(bid + 3.0), hash21(bid + 9.0)) - 0.5) * 0.6;
        float br = 0.05 + 0.13 * hash21(bid + 5.0);
        float bd = length(bf - bo) - br;
        float bubble = step(1.0 - bubbles * 0.35, bh) * inside;
        light *= 1.0 - bubble * 0.5 * exp(-pow(bd / 0.02, 2.0));
        lens += bubble * 0.6 * exp(-pow((bd + 0.05) / 0.03, 2.0)) * step(bd, 0.0);
    }

    vec3 col = light * (1.0 + lens) + glowAdd;

    /* The projector's round gate, if wanted. */
    float gateEdge = mix(1.4, 0.46, aperture);
    col *= 1.0 - smoothstep(gateEdge - 0.03, gateEdge + 0.01, length(uv));

    col *= 1.0 + beat * 0.10;
    col *= exposure;
    col = col / (1.0 + 0.16 * col);
    col *= 1.16;

    gl_FragColor = vec4(col, 1.0);
}
