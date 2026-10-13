/*{
    "DESCRIPTION": "Form constants. In the 1920s Heinrich Kluver noticed that whatever people saw at the onset of mescaline came in the same few forms: spirals, cobwebs, honeycombs, radiating rays. Half a century later the reason was worked out. The visual cortex is wired as a stretched map of the eye, so when plain stripes or hexagons ripple across the cortex they are seen as spirals and lattices that wrap round the centre of gaze. This runs that map: choose the pattern on the cortex and see the form the eye reports. Bass swells the pattern, beats shift its phase, spectral centroid turns the stripes.",
    "CREDIT": "Ghost Arcade psychedelic pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Phosphene", "Mescaline", "Cactus Flower", "Afterimage", "Neon Lattice", "Ochre", "Black and White"]},
        {"NAME": "form",      "TYPE": "long",  "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4],
         "LABELS": ["Spiral", "Honeycomb", "Cobweb", "Lattice", "Rays and rings"]},
        {"NAME": "arms",      "TYPE": "long",  "DEFAULT": 6,
         "VALUES": [1, 2, 3, 4, 5, 6, 8, 10, 12, 16], "LABELS": ["1", "2", "3", "4", "5", "6", "8", "10", "12", "16"]},
        {"NAME": "pitch",     "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "density",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "drift",     "TYPE": "float", "DEFAULT": 0.30, "MIN": -2.00, "MAX": 2.00},
        {"NAME": "rotate",    "TYPE": "float", "DEFAULT": 0.10, "MIN": -2.00, "MAX": 2.00},
        {"NAME": "sharpness", "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "second",    "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "wobble",    "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "fringe",    "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "centreGlow","TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * The map from the eye to the primary visual cortex is close to a complex
 * logarithm: a point at distance r and angle a from the centre of gaze lands
 * at (log r, a) on the cortical sheet. Equal steps across the cortex are
 * therefore equal ratios of distance in the visual field, which is why detail
 * is finest where you are looking.
 *
 * Run it backwards. A set of straight parallel stripes on the cortex, read
 * back through the map, is:
 *
 *   stripes along the "angle" axis     ->  concentric rings
 *   stripes along the "log r" axis     ->  rays from the centre
 *   stripes at any slant between       ->  logarithmic spirals
 *
 * and two or three sets of stripes together, the lattices that such tissue
 * tends to settle into, give cobwebs and honeycombs. Those are Kluver's form
 * constants, and that correspondence (Ermentrout and Cowan, 1979) is all this
 * shader computes. The one constraint is that the pattern must close up after
 * a full turn, so the number of stripes round the centre is a whole number:
 * the `arms`.
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
    vec3 a, dark, b;
    if (mode == 1) {            /* Mescaline - gold and violet */
        a = vec3(1.00, 0.78, 0.20); dark = vec3(0.050, 0.010, 0.080); b = vec3(0.56, 0.20, 1.00);
    } else if (mode == 2) {     /* Cactus Flower */
        a = vec3(1.00, 0.24, 0.50); dark = vec3(0.010, 0.050, 0.030); b = vec3(0.50, 0.90, 0.30);
    } else if (mode == 3) {     /* Afterimage - a colour and what the eye answers with */
        a = vec3(1.00, 0.36, 0.10); dark = vec3(0.020, 0.030, 0.050); b = vec3(0.10, 0.70, 1.00);
    } else if (mode == 4) {     /* Neon Lattice */
        a = vec3(0.10, 1.00, 0.70); dark = vec3(0.020, 0.004, 0.040); b = vec3(1.00, 0.10, 0.80);
    } else if (mode == 5) {     /* Ochre - cave pigment */
        a = vec3(0.86, 0.50, 0.20); dark = vec3(0.060, 0.030, 0.020); b = vec3(0.96, 0.88, 0.70);
    } else if (mode == 6) {     /* Black and White */
        a = vec3(1.00, 1.00, 1.00); dark = vec3(0.000, 0.000, 0.000); b = vec3(0.80, 0.80, 0.80);
    } else {                    /* Phosphene - the blue-white seen with the eyes shut */
        a = vec3(0.50, 0.70, 1.00); dark = vec3(0.004, 0.006, 0.030); b = vec3(0.90, 0.96, 1.00);
    }
    return mat3(a, dark, b);
}

/* One set of stripes on the cortex: wave (kr, ka) with kr continuous and ka whole. */
float stripes(vec2 cortex, float kr, float ka, float phase) {
    return cos(cortex.x * kr + cortex.y * ka + phase);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    /* The eye is never still; the whole field trembles a little. */
    vec2 p = uv + wobble * 0.012 * vec2(sin(TIME * 1.3) + sin(TIME * 2.9), cos(TIME * 1.7) + sin(TIME * 2.3));
    float r = max(length(p), 1e-4);
    float ang = atan(p.y, p.x) + TIME * rotate * 0.12;
    vec2 cortex = vec2(log(r), ang);

    float n = float(arms);
    /* Slant of the stripes on the cortex: 0 = rays, 1 = rings; between, spirals. */
    float slant = pitch * (0.8 + 0.4 * centroid);
    float kr = n * tan(clamp(slant, 0.0, 0.98) * 1.4) * (0.6 + 1.6 * density);
    float flowPhase = TIME * drift * 1.6 + beat * 0.9;
    int kind = int(form);

    float v;
    if (kind == 1) {
        /* Honeycomb: three wave sets at sixty degrees on the cortex. Angular
           wave numbers n, -n and 0 keep every one of them periodic. */
        float k = n * 1.1547 * (0.6 + 0.8 * density);
        v = (stripes(cortex, k * 0.5, n, flowPhase)
           + stripes(cortex, k * 0.5, -n, flowPhase * 0.7)
           + stripes(cortex, k, 0.0, -flowPhase * 0.9)) / 3.0;
        v = v * 1.4 + 0.2;
    } else if (kind == 2) {
        /* Cobweb: rings and rays together, thin threads. */
        float rings = stripes(cortex, n * (0.8 + 1.8 * density), 0.0, flowPhase);
        float rays = stripes(cortex, 0.0, n, 0.0);
        v = max(rings, rays) * 2.0 - 1.0;
    } else if (kind == 3) {
        /* Lattice: two crossing spirals. */
        v = stripes(cortex, kr, n, flowPhase) * stripes(cortex, kr, -n, flowPhase * 0.8);
    } else if (kind == 4) {
        /* Rays and rings, multiplied: a chequered target. */
        v = stripes(cortex, n * (0.6 + 1.6 * density), 0.0, flowPhase) * stripes(cortex, 0.0, n, 0.0);
    } else {
        v = stripes(cortex, kr, n, flowPhase);
    }
    /* A second, finer set riding on the first. */
    float fine = stripes(cortex, kr * 2.0 + n, n * 2.0, -flowPhase * 1.3);
    v = mix(v, v * (0.55 + 0.45 * fine), second);
    v *= 0.85 + 0.4 * bass;

    /* The pattern is finer than a pixel close to the centre; fade it there. */
    float pixel = 1.0 / (res.y * r);                       /* pixel size on the cortex */
    float resolved = 1.0 - smoothstep(0.25, 0.9, pixel * (abs(kr) + n) * 0.5);

    /* Threshold: soft swells at one end, hard-edged forms at the other. */
    float w = mix(0.9, 0.04, sharpness) + pixel * (abs(kr) + n) * 0.5;
    float on = smoothstep(-w, w, v) * resolved + 0.5 * (1.0 - resolved);

    mat3 pal = paletteFor(int(colorMode));
    vec3 A = hueRotate(pal[0], hueShift);
    vec3 DARK = pal[1];
    vec3 B = hueRotate(pal[2], hueShift);

    vec3 col = mix(DARK, mix(A, B, smoothstep(0.2, 1.0, v)), on);
    /* Fringe: the complementary edge the eye adds to a bright form. */
    float rim = exp(-pow(v / max(w * 1.2, 0.06), 2.0)) * resolved;
    vec3 opp = vec3(1.0) - normalize(A + 1e-3) * 0.9;
    col += opp * rim * fringe * 0.35;

    /* Eccentricity: vision is brightest at the centre of gaze. */
    col *= 0.55 + 0.75 * exp(-r * 1.6);
    col += mix(A, vec3(1.0), 0.6) * centreGlow * 0.06 / (r + 0.06) * (0.6 + 0.8 * level);

    col *= 1.0 + beat * 0.14;
    col *= exposure;
    col = col / (1.0 + 0.14 * col);
    col *= 1.14;

    gl_FragColor = vec4(col, 1.0);
}
