/*{
    "DESCRIPTION": "The chrysanthemum. The first thing many people report on DMT, before anything else arrives: a flower of impossible detail opening from its centre, ring after ring of petals, each ring turning against the last, each petal jewelled and outlined, the whole thing brighter than colour should be. New rings are born at the heart and pass outward as it blooms without end. Set the petal count, how fast it opens, how the rings counter-turn and how fine the jewelling is. Bass opens the bloom, beats flash the outlines, spectral centroid turns the rings.",
    "CREDIT": "Ghost Arcade psychedelic pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Hyperspace", "Jewel Box", "Marigold", "Ultraviolet Lotus", "Emerald Temple", "Rose Window", "Bone and Gold"]},
        {"NAME": "petals",    "TYPE": "long",  "DEFAULT": 12,
         "VALUES": [5, 6, 8, 10, 12, 16, 20, 24], "LABELS": ["5", "6", "8", "10", "12", "16", "20", "24"]},
        {"NAME": "rings",     "TYPE": "long",  "DEFAULT": 9,
         "VALUES": [4, 6, 9, 12], "LABELS": ["4", "6", "9", "12"]},
        {"NAME": "bloom",     "TYPE": "float", "DEFAULT": 0.25, "MIN": -1.00, "MAX": 1.50},
        {"NAME": "counterTurn","TYPE": "float", "DEFAULT": 0.35, "MIN": -1.50, "MAX": 1.50},
        {"NAME": "petalLength","TYPE": "float", "DEFAULT": 0.55, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "petalPoint","TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "jewel",     "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "outline",   "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "shimmer",   "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "curl",      "TYPE": "float", "DEFAULT": 0.20, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "size",      "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.40, "MAX": 2.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * The flower is a stack of rings drawn from the outside in, so every inner
 * ring overlaps the one behind it. A ring is one petal repeated round the
 * centre: fold the angle into a single petal's slice and only that one petal
 * needs drawing.
 *
 * Rings are spaced evenly in the logarithm of their radius, which is the
 * spacing at which each ring looks like a scaled copy of its neighbour. That
 * makes the bloom endless: as time runs every ring grows toward the size of
 * the next one out, the outermost fades as it leaves, and a new one starts
 * at the heart, with no moment at which the picture jumps.
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
    if (mode == 1) {            /* Jewel Box - ruby, sapphire, emerald */
        a = vec3(0.90, 0.04, 0.20); b = vec3(0.06, 0.24, 0.96); c = vec3(0.04, 0.80, 0.42);
    } else if (mode == 2) {     /* Marigold */
        a = vec3(1.00, 0.50, 0.02); b = vec3(1.00, 0.86, 0.10); c = vec3(0.90, 0.16, 0.06);
    } else if (mode == 3) {     /* Ultraviolet Lotus */
        a = vec3(0.50, 0.10, 1.00); b = vec3(1.00, 0.26, 0.86); c = vec3(0.20, 0.80, 1.00);
    } else if (mode == 4) {     /* Emerald Temple */
        a = vec3(0.04, 0.70, 0.40); b = vec3(0.86, 0.80, 0.26); c = vec3(0.04, 0.36, 0.50);
    } else if (mode == 5) {     /* Rose Window */
        a = vec3(0.80, 0.06, 0.16); b = vec3(0.10, 0.20, 0.80); c = vec3(1.00, 0.76, 0.20);
    } else if (mode == 6) {     /* Bone and Gold */
        a = vec3(0.94, 0.90, 0.80); b = vec3(0.90, 0.66, 0.20); c = vec3(0.30, 0.24, 0.20);
    } else {                    /* Hyperspace - magenta, cyan, acid yellow */
        a = vec3(1.00, 0.06, 0.70); b = vec3(0.04, 0.90, 1.00); c = vec3(0.86, 1.00, 0.10);
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

    vec2 p = uv / size;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float pixel = 1.0 / (size * res.y);

    mat3 pal = paletteFor(int(colorMode));
    float n = float(petals);
    int nRings = int(rings);
    float ringsF = float(nRings);
    float seg = TAU / n;

    /* Bloom phase: how far each ring has grown toward the next. */
    float open = fract(TIME * bloom * 0.12 + 0.35 * (bass - 0.25));
    float ratio = 1.42;                              /* each ring is this much bigger than the one inside */
    float outer = 0.95;

    vec3 col = hueRotate(pal[2], hueShift) * 0.03;
    /* From the outermost ring inward, each painted over the last. */
    for (int i = 0; i < 12; i++) {
        if (i >= nRings) break;
        float k = float(i) - open;                   /* 0 = outermost, growing outward */
        float tipR = outer * pow(ratio, -k);
        float baseR = tipR / ratio * (1.0 - 0.55 * petalLength);
        /* Fade in at the heart and out at the rim. */
        float life = smoothstep(ringsF - 0.2, ringsF - 1.4, k) * smoothstep(-1.0, -0.25, k);
        float order = float(i) + floor(TIME * bloom * 0.12 + 0.35 * (bass - 0.25));   /* stays with the ring as it grows */

        float turn = (mod(order, 2.0) < 0.5 ? 1.0 : -1.0) * TIME * counterTurn * 0.12 * (0.7 + 0.6 * centroid)
                   + mod(order, 2.0) * seg * 0.5 + curl * 0.6 * log(max(r, 1e-3) / tipR);
        float a = mod(ang + turn + seg * 0.5, seg) - seg * 0.5;      /* -seg/2 .. seg/2 inside one petal */
        float across = a / (seg * 0.5);                               /* -1 .. 1 */
        /* The petal's edge: full length on its midline, falling to the base at its sides. */
        float profile = pow(max(1.0 - abs(across), 0.0), mix(0.35, 1.3, petalPoint));
        float edgeR = mix(baseR, tipR, profile);
        float d = r - edgeR;                                          /* < 0 inside the petal */
        float inside = 1.0 - smoothstep(-pixel, pixel, d);
        if (inside * life <= 0.001) continue;

        float along = clamp((r - baseR) / max(tipR - baseR, 1e-4), 0.0, 1.0);   /* 0 at base, 1 at tip */
        vec3 base = hueRotate(mod(order, 3.0) < 0.5 ? pal[0] : mod(order, 3.0) < 1.5 ? pal[1] : pal[2], hueShift);
        vec3 other = hueRotate(mod(order, 3.0) < 0.5 ? pal[1] : mod(order, 3.0) < 1.5 ? pal[2] : pal[0], hueShift);

        /* Body: lit along the midrib, deepening to the sides and the base. */
        vec3 petal = base * (0.30 + 0.85 * along) * (0.55 + 0.45 * (1.0 - across * across));
        petal = mix(petal, other, 0.35 * smoothstep(0.55, 1.0, along));

        /* Jewelling: fine veins and beads, at a scale tied to the ring's own
           size so every ring carries the same amount of detail. */
        float localPx = pixel / max(tipR - baseR, 1e-4);
        float veins = abs(fract(along * 7.0 - abs(across) * 3.0 + shimmer * TIME * 0.2) - 0.5);
        float vein = (1.0 - smoothstep(0.03, 0.03 + localPx * 9.0, veins)) * (1.0 - smoothstep(0.02, 0.10, localPx));
        float bead = exp(-pow((abs(across) - 0.55) * 7.0, 2.0)) * (0.5 + 0.5 * cos(along * 44.0));
        petal += other * vein * jewel * 0.7 + mix(base, vec3(1.0), 0.6) * max(bead, 0.0) * jewel * 0.45 * (1.0 - smoothstep(0.02, 0.08, localPx));
        /* Shimmer: a sheen that slides along each petal. */
        petal += vec3(1.0) * shimmer * 0.22 * pow(0.5 + 0.5 * sin(along * 9.0 - TIME * 1.3 + order), 6.0);

        /* Outline, and a shadow thrown on the ring behind. */
        float lineW = pixel * (1.2 + 2.5 * outline);
        float line = (1.0 - smoothstep(0.0, lineW, abs(d))) * outline;
        petal = mix(petal, mix(other, vec3(1.0), 0.75) * (1.0 + 0.8 * beat), line);
        float shade = (1.0 - smoothstep(0.0, 0.035 * tipR / 0.4, d)) * (1.0 - inside) * 0.45 * life;
        col *= 1.0 - shade;
        col = mix(col, petal * (0.85 + 0.4 * level), inside * life);
    }

    /* The heart: a point of light the rings are born from. */
    col += mix(hueRotate(pal[1], hueShift), vec3(1.0), 0.7) * 0.012 / (r * r + 0.004) * (0.6 + 0.7 * bass);

    col *= 1.0 + beat * 0.10;
    col *= exposure;
    col = col / (1.0 + 0.16 * col);
    col *= 1.16;

    gl_FragColor = vec4(col, 1.0);
}
