/*{
    "DESCRIPTION": "The Kakeya needle problem. A needle has to point in every direction across a spread of angles; how little area does that take? Start with a triangle, which holds every needle from its tip to its base. Cut it into thin slivers and slide them over one another: every sliver keeps its own directions, so no needle is lost, but the area they cover shrinks. Keep cutting and it shrinks toward nothing. This is the Perron tree behind Besicovitch's proof, and the three-dimensional form of the question was settled in 2025. Arms repeat the tree round a circle to cover every direction. Bass squeezes the tree, beats flash the overlap, spectral centroid sweeps the needle.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Filament", "X-ray", "Poison", "Rosewater", "Carbon", "Coral Reef", "Chalkboard"]},
        {"NAME": "cuts",      "TYPE": "long",  "DEFAULT": 5,
         "VALUES": [1, 2, 3, 4, 5, 6], "LABELS": ["2 slivers", "4", "8", "16", "32", "64"]},
        {"NAME": "squeeze",   "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "breathe",   "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "breatheSpeed","TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "arms",      "TYPE": "long",  "DEFAULT": 5,
         "VALUES": [1, 2, 3, 4, 5, 6], "LABELS": ["1", "2", "3", "4", "5", "6"]},
        {"NAME": "spin",      "TYPE": "float", "DEFAULT": 0.08, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "size",      "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.40, "MAX": 2.50},
        {"NAME": "opacity",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.05, "MAX": 1.00},
        {"NAME": "outline",   "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "needle",    "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "needleSpeed","TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * The Perron tree.
 *
 * Take a triangle with its tip at the top and cut it from the tip into N =
 * 2^k slivers of equal base. Sliding a sliver sideways does not change which
 * directions its needles point in, so any arrangement of the slivers still
 * holds a needle in every direction the triangle did.
 *
 * Now overlap them in pairs, then overlap the pairs, then the fours. At each
 * level the right half of a block slides over the left half. The amount each
 * sliver has moved is a sum over the binary digits of its number: digit l
 * says which half of its level-l block it sits in, and so which way that
 * level pushed it. That sum is all the construction is, and it is why 64
 * slivers cost one short loop each rather than a recursion.
 *
 * Light adds where slivers overlap, so the bright core is the area the tree
 * saves and the faint fringe at the top is the price paid for it.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int MAX_SLIVERS = 64;
const int MAX_ARMS = 6;
const int MAX_LEVELS = 6;

/* Palettes for this shader alone. Columns: [light, ground, needle]. */
mat3 paletteFor(int mode) {
    vec3 a, ground, b;
    if (mode == 1) {            /* X-ray */
        a      = vec3(0.56, 0.86, 1.00);
        ground = vec3(0.004, 0.012, 0.024);
        b      = vec3(1.00, 1.00, 1.00);
    } else if (mode == 2) {     /* Poison - acid green, violet needle */
        a      = vec3(0.50, 1.00, 0.16);
        ground = vec3(0.012, 0.022, 0.006);
        b      = vec3(0.86, 0.30, 1.00);
    } else if (mode == 3) {     /* Rosewater */
        a      = vec3(1.00, 0.56, 0.66);
        ground = vec3(0.034, 0.012, 0.022);
        b      = vec3(1.00, 0.94, 0.86);
    } else if (mode == 4) {     /* Carbon - graphite, one orange line */
        a      = vec3(0.60, 0.62, 0.66);
        ground = vec3(0.016, 0.016, 0.018);
        b      = vec3(1.00, 0.46, 0.06);
    } else if (mode == 5) {     /* Coral Reef */
        a      = vec3(1.00, 0.40, 0.30);
        ground = vec3(0.004, 0.030, 0.044);
        b      = vec3(0.30, 1.00, 0.90);
    } else if (mode == 6) {     /* Chalkboard */
        a      = vec3(0.90, 0.94, 0.88);
        ground = vec3(0.040, 0.075, 0.060);
        b      = vec3(1.00, 0.86, 0.36);
    } else {                    /* Filament - amber, white-hot needle */
        a      = vec3(1.00, 0.62, 0.16);
        ground = vec3(0.020, 0.010, 0.004);
        b      = vec3(1.00, 0.96, 0.86);
    }
    return mat3(a, ground, b);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

/*
 * How far sliver i has slid, as a fraction of the base.
 *
 * After j rounds a block of slivers has a solid "heart" at its foot whose
 * width is ratio^j of the block's original base. Round j + 1 slides two
 * neighbouring blocks together until their hearts merge into one heart of
 * the right width for the doubled block. Working that out for hearts that
 * start centred on their blocks gives the slide below.
 */
float slideOf(float i, float count, int levels, float ratio) {
    float s = 0.0;
    float block = 1.0;
    float shrunk = 1.0;                          /* ratio ^ (rounds so far) */
    for (int l = 0; l < MAX_LEVELS; l++) {
        if (l >= levels) break;
        float bit = mod(floor(i / block), 2.0);
        float delta = (block / count) * (0.5 + 0.5 * shrunk - shrunk * ratio);
        s += (1.0 - 2.0 * bit) * delta;
        block *= 2.0;
        shrunk *= ratio;
    }
    return s;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int levels = int(cuts);
    float count = pow(2.0, float(levels));
    int nArms = int(arms);

    /* ratio = 1 is the uncut triangle; smaller overlaps more at every round. */
    float sq = squeeze * (1.0 - breathe * (0.5 + 0.5 * cos(TIME * breatheSpeed))) * (0.85 + 0.3 * bass);
    float keep = 1.0 - 0.32 * clamp(sq, 0.0, 1.0);

    float zoomOut = 1.30 / size;
    float pixel = zoomOut / RENDERSIZE.y;
    float rot0 = TIME * spin * 0.3;

    /* Where the needle is in its sweep: which sliver, and how far along its base. */
    float sweep = fract(TIME * needleSpeed * 0.08 + centroid * 0.05) * count;
    float needleSliver = floor(sweep);
    float needleAlong = fract(sweep);

    float layers = 0.0;       /* how many slivers cover this pixel */
    float edges = 0.0;
    float needleLight = 0.0;

    for (int arm = 0; arm < MAX_ARMS; arm++) {
        if (arm >= nArms) break;
        float ang = rot0 + TAU * float(arm) / float(nArms);
        float ca = cos(ang), sa = sin(ang);
        /* Into the arm's own frame: tip at (0.5, 1), base along y = 0. With
           several arms the trees stand in a ring, feet together, tips out. */
        vec2 q = vec2(ca * uv.x + sa * uv.y, -sa * uv.x + ca * uv.y) * zoomOut;
        q = nArms > 1 ? vec2(q.x + 0.5, q.y - 0.06) : vec2(q.x + 0.5, q.y + 0.5);
        /* Nothing of this arm lies outside its slab. */
        if (q.y < -0.02 || q.y > 1.02) continue;

        for (int i = 0; i < MAX_SLIVERS; i++) {
            float fi = float(i);
            if (fi >= count) break;
            float slide = slideOf(fi, count, levels, keep);
            vec2 r = vec2(q.x - slide, q.y);
            /* Sliver i: tip (0.5, 1), base from i/count to (i+1)/count. At
               height y it spans between the two edges below. */
            float t = 1.0 - r.y;                               /* 0 at the tip, 1 at the base */
            float left = mix(0.5, fi / count, t);
            float right = mix(0.5, (fi + 1.0) / count, t);
            float inY = step(0.0, r.y) * step(r.y, 1.0);
            float dl = r.x - left;
            float dr = right - r.x;
            float inside = smoothstep(-pixel, pixel, dl) * smoothstep(-pixel, pixel, dr) * inY;
            layers += inside;
            float lw = pixel * 1.4;
            edges += (1.0 - smoothstep(0.0, lw, abs(dl))) * inY + (1.0 - smoothstep(0.0, lw, abs(dr))) * inY * 0.0;

            /* The needle: one line from the tip to a point on this sliver's base. */
            if (fi == needleSliver) {
                float bx = (fi + needleAlong) / count;
                vec2 tip = vec2(0.5, 1.0);
                vec2 foot = vec2(bx, 0.0);
                vec2 ab = foot - tip;
                float h = clamp(dot(r - tip, ab) / dot(ab, ab), 0.0, 1.0);
                float d = length(r - tip - ab * h);
                needleLight += 0.0016 / (d * d + 0.000004) * 0.004 + (1.0 - smoothstep(0.0, pixel * 2.2, d));
            }
        }
    }

    mat3 pal = paletteFor(int(colorMode));
    vec3 LIGHT = hueRotate(pal[0], hueShift);
    vec3 GROUND = pal[1];
    vec3 NEEDLE = hueRotate(pal[2], hueShift);

    /* Each sliver is a sheet of tinted glass; overlaps add up and saturate. */
    float glass = 1.0 - exp(-layers * opacity * (0.9 + 0.5 * level));
    vec3 col = GROUND + LIGHT * glass * 1.15;
    /* Where many overlap the light whitens, as a hot filament does. */
    col += mix(LIGHT, vec3(1.0), 0.6) * smoothstep(3.0, 14.0, layers) * 0.55 * (1.0 + beat * 0.8);
    col += LIGHT * min(edges, 3.0) * outline * 0.22;
    col += NEEDLE * min(needleLight, 3.0) * needle;

    col *= 1.0 + beat * 0.12;
    col *= exposure;
    col = col / (1.0 + 0.22 * col);
    col *= 1.22;

    gl_FragColor = vec4(col, 1.0);
}
