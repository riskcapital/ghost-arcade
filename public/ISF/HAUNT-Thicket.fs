/*{
    "DESCRIPTION": "The wood at night. Bare trees in ranks, black against a low moon, mist standing between them so the far trunks are only paler shapes. The ranks slide past each other as if you were walking. Branches knit across the gaps. And between the middle ranks, never the front, something pale passes behind the trunks, is hidden by one, and is not there when it should come out the other side. Set the density, the mist, the moon and how often it is seen. Bass thickens the mist, beats shake the branches, spectral centroid sets the walking pace.",
    "CREDIT": "Ghost Arcade Halloween pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Cold Moon", "Harvest Moon", "Fen", "Blood Moon", "Ash Wednesday", "Violet Night", "Woodcut"]},
        {"NAME": "ranks",     "TYPE": "long",  "DEFAULT": 5, "VALUES": [2, 3, 4, 5, 6], "LABELS": ["2", "3", "4", "5", "6"]},
        {"NAME": "trunks",    "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "branches",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "tangle",    "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "walk",      "TYPE": "float", "DEFAULT": 0.25, "MIN": -2.00, "MAX": 2.00},
        {"NAME": "sway",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "mist",      "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "groundFog", "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "moonX",     "TYPE": "float", "DEFAULT": 0.64, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "moonY",     "TYPE": "float", "DEFAULT": 0.62, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "moonSize",  "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.00, "MAX": 0.40},
        {"NAME": "sighting",  "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "paleness",  "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Depth here is mist. Each rank of trees is the same black; what sets them
 * apart is how much lit air lies between it and the eye, so far ranks are
 * pale and near ones are dark, and the picture reads as deep without any
 * perspective drawing at all.
 *
 * A rank is trunks in slots along the ground, each one leaning, tapering
 * and kinked by its own noise, and a canopy of branches drawn as the thin
 * crests of a ridged noise field, which gives crooked forking lines. Nearer
 * ranks slide faster as the view moves, which is what makes it a wood and
 * not a backdrop.
 *
 * The pale thing is painted between two of the middle ranks, so the nearer
 * trunks cover it as it goes. It is deliberately very little: a tall soft
 * shape slightly lighter than the mist.
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


/* Columns: [sky near the moon, tree black, mist]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Harvest Moon */
        a = vec3(1.00, 0.72, 0.36); b = vec3(0.020, 0.010, 0.006); c = vec3(0.40, 0.24, 0.12);
    } else if (mode == 2) {     /* Fen */
        a = vec3(0.70, 0.90, 0.66); b = vec3(0.006, 0.014, 0.008); c = vec3(0.18, 0.30, 0.20);
    } else if (mode == 3) {     /* Blood Moon */
        a = vec3(1.00, 0.30, 0.20); b = vec3(0.016, 0.002, 0.004); c = vec3(0.34, 0.06, 0.06);
    } else if (mode == 4) {     /* Ash Wednesday */
        a = vec3(0.82, 0.82, 0.80); b = vec3(0.020, 0.020, 0.020); c = vec3(0.34, 0.34, 0.34);
    } else if (mode == 5) {     /* Violet Night */
        a = vec3(0.80, 0.66, 1.00); b = vec3(0.012, 0.004, 0.026); c = vec3(0.24, 0.14, 0.44);
    } else if (mode == 6) {     /* Woodcut - black on cream */
        a = vec3(0.94, 0.90, 0.80); b = vec3(0.030, 0.024, 0.020); c = vec3(0.80, 0.76, 0.66);
    } else {                    /* Cold Moon */
        a = vec3(0.74, 0.86, 1.00); b = vec3(0.004, 0.008, 0.016); c = vec3(0.16, 0.24, 0.38);
    }
    return mat3(a, b, c);
}

/* How much of this pixel one rank of trees covers. */
float rank(vec2 p, float seed, float trunkAmt, float branchAmt, float tangleAmt, float swayAmt, float pixel) {
    float cover = 0.0;
    /* Trunks: one per slot, with its neighbours checked for overlap. */
    float slot = mix(0.55, 0.16, trunkAmt);
    float cell = floor(p.x / slot);
    for (int dc = -1; dc <= 1; dc++) {
        float c = cell + float(dc);
        float h = hash21(vec2(c, seed));
        if (h < 0.18) continue;                                    /* a gap in the rank */
        float cx = (c + 0.5 + (h - 0.5) * 0.7) * slot;
        float up = p.y + 0.5;
        float leanAmt = (hash21(vec2(c, seed + 3.0)) - 0.5) * 0.22;
        float kink = (noise2(vec2(up * 2.6 + c, seed)) - 0.5) * 0.10 * tangleAmt
                   + swayAmt * 0.012 * sin(TIME * 0.7 + c) * up * up;
        float girth = slot * (0.07 + 0.16 * hash21(vec2(c, seed + 7.0))) * (1.0 - 0.45 * clamp(up, 0.0, 1.2));
        float d = abs(p.x - cx - leanAmt * up - kink) - girth;
        cover = max(cover, 1.0 - smoothstep(-pixel, pixel, d));
    }
    /* Branches: the crests of a ridged field, thicker low down, finer above. */
    vec2 bp = p * vec2(3.2, 2.2) + vec2(seed * 3.1, 0.0);
    bp += tangleAmt * 0.45 * vec2(noise2(bp * 0.8 + seed), noise2(bp * 0.8 - seed));
    bp.x += swayAmt * 0.03 * sin(TIME * 0.9 + p.y * 4.0 + seed);
    float ridge = abs(noise2(bp) - 0.5) + 0.5 * abs(noise2(bp * 2.3 + 5.0) - 0.5);
    float twig = abs(noise2(bp * 5.1 + 9.0) - 0.5);
    float heightGate = smoothstep(-0.30, 0.15, p.y);               /* none near the ground */
    float wide = (0.020 + 0.050 * branchAmt) * (1.2 - 0.6 * smoothstep(-0.2, 0.5, p.y));
    float limbs = (1.0 - smoothstep(wide * 0.5, wide, ridge)) * heightGate * step(0.01, branchAmt);
    float twigs = (1.0 - smoothstep(0.004, 0.012, twig)) * smoothstep(0.0, 0.35, p.y) * branchAmt * smoothstep(0.10, 0.0, ridge - wide);
    return max(cover, max(limbs, twigs * 0.25));
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;
    float px = 1.0 / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    mat3 pal = paletteFor(int(colorMode));
    vec3 SKY = hueRotate(pal[0], hueShift);
    vec3 TREE = pal[1];
    vec3 MIST = hueRotate(pal[2], hueShift);
    bool woodcut = int(colorMode) == 6;

    /* Sky: dark, lifting toward the moon and toward the ground. */
    vec2 moon = vec2((moonX - 0.5) * aspect, moonY - 0.5);
    float md = length(uv - moon);
    float disc = 1.0 - smoothstep(moonSize - px, moonSize + px, md);
    float corona = exp(-md * md / (0.02 + moonSize * 0.9));
    vec3 col = woodcut ? SKY : MIST * (0.25 + 0.5 * exp(-(uv.y + 0.5) * 1.8)) + SKY * corona * 0.42;
    /* Maria: the moon is not a blank disc. */
    float maria = 0.82 + 0.18 * fbm((uv - moon) / max(moonSize, 0.01) * 1.6 + 3.0);
    col = mix(col, (woodcut ? TREE : SKY * 1.15) * maria, disc * step(0.001, moonSize));

    int n = int(ranks);
    float pace = TIME * walk * (0.5 + 0.8 * centroid) * 0.12;
    float thick = mist * (0.75 + 0.5 * bass);

    /* When the pale thing is abroad, and where. */
    float visit = TIME * sighting * 0.05;
    float visitId = floor(visit);
    float visitPhase = fract(visit);
    float way = hash21(vec2(visitId, 4.0)) < 0.5 ? 1.0 : -1.0;
    float paleX = way * (visitPhase * 2.4 - 1.2) * aspect * 0.5;
    float paleRank = floor(float(n) * 0.5);                       /* behind this many near ranks */
    /* It stops for a while part way, as if it had seen you. */
    float stalled = smoothstep(0.40, 0.46, visitPhase) * (1.0 - smoothstep(0.56, 0.62, visitPhase));
    paleX = mix(paleX, way * (0.43 * 2.4 - 1.2) * aspect * 0.5, stalled);

    /* Far ranks first. */
    for (int i = 0; i < 6; i++) {
        if (i >= n) break;
        float fi = float(i);
        float depth = 1.0 - fi / float(n - 1);                      /* 1 far .. 0 near */
        float sc = mix(1.0, 2.6, depth);                           /* far trees are drawn smaller */
        vec2 p = vec2((uv.x + pace * mix(1.0, 0.18, depth)) * sc, (uv.y + 0.5) * sc * mix(1.0, 0.78, depth) - 0.5 + 0.10 * depth);
        float cover = rank(p, fi * 19.0 + 5.0, trunks, branches, tangle, sway * (1.0 + 2.0 * beat), px * sc);

        /* The pale thing, painted just before the rank that hides it. */
        if (fi == float(n - 1) - paleRank && sighting > 0.001) {
            vec2 q = vec2(uv.x - paleX, uv.y + 0.5);
            float tallness = 0.46;
            float body = (1.0 - smoothstep(0.035, 0.085, abs(q.x) * (1.0 + 0.6 * smoothstep(0.3, 0.46, q.y))))
                       * smoothstep(-0.02, 0.10, q.y) * (1.0 - smoothstep(tallness * 0.86, tallness, q.y));
            float seen = smoothstep(0.02, 0.12, visitPhase) * (1.0 - smoothstep(0.88, 0.98, visitPhase));
            col = mix(col, mix(MIST, SKY, 0.75) * (woodcut ? 0.7 : 1.0), body * seen * paleness * 0.75);
        }

        /* Mist in front of this rank lightens it; nearer ranks get less. */
        float veil = thick * depth * 0.92;
        float lowFog = groundFog * exp(-(uv.y + 0.5) * (5.0 - 2.0 * depth)) * (0.4 + 0.6 * depth)
                     * (0.6 + 0.6 * fbm(vec2(uv.x * 2.0 + pace * 0.5 + fi, fi * 3.0 - TIME * 0.02)));
        vec3 treeTone = woodcut ? mix(TREE, MIST, veil * 0.9) : mix(TREE, MIST * (0.55 + 0.9 * corona), veil);
        /* The moon rims the trunks that stand in front of it. */
        treeTone += SKY * corona * 0.10 * (1.0 - depth) * (woodcut ? 0.0 : 1.0);
        col = mix(col, treeTone, cover);
        col = mix(col, woodcut ? MIST : MIST * (0.7 + 0.5 * corona), clamp(lowFog, 0.0, 0.9) * (woodcut ? 0.6 : 1.0));
    }

    /* The ground itself: black, uneven. */
    float groundLine = -0.5 + 0.035 + 0.02 * noise2(vec2(uv.x * 6.0 + pace * 8.0, 1.0));
    col = mix(col, TREE, 1.0 - smoothstep(groundLine - px, groundLine + px, uv.y));

    if (!woodcut) {
        col *= 1.0 - 0.30 * dot(uv * vec2(0.7, 1.0), uv * vec2(0.7, 1.0));
        col += (hash21(gl_FragCoord.xy + floor(TIME * 24.0) * 5.0) - 0.5) * 0.014;
    }
    col *= exposure * (woodcut ? 1.0 : 1.5) * (0.92 + 0.14 * level);
    if (!woodcut) {
        col = col / (1.0 + 0.20 * col);
        col *= 1.20;
    }

    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
