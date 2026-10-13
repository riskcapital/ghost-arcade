/*{
    "DESCRIPTION": "Ink blots. Ink dropped on paper, folded once and opened: a shape with a left and a right that the mind cannot stop reading as a face, a moth, a pelvis, something looking back. The blot here never dries. It spreads, draws in, grows new lobes and loses them, and because it stays symmetrical it stays almost recognisable the whole time. Ink feathers into the paper at its edges, spatters fall round it, and a second fold makes it four-way. In black on bone, or blood, or white on black. Bass spreads the ink, beats spatter it, spectral centroid changes its shape.",
    "CREDIT": "Ghost Arcade Halloween pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Ink on Bone", "Blood", "Ectoplasm", "Iron Gall", "Violet", "Tar", "Absinthe"]},
        {"NAME": "folds",     "TYPE": "long",  "DEFAULT": 0, "VALUES": [0, 1], "LABELS": ["Folded once", "Folded twice"]},
        {"NAME": "spread",    "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "detail",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "morph",     "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "limbs",     "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "feather",   "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "pooling",   "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "spatter",   "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "crease",    "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "paper",     "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "size",      "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.40, "MAX": 2.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Folding the paper is taking the absolute value of x: whatever is on the
 * right is on the left. That one line is why every frame looks like a face.
 *
 * The blot is a smooth field with a level drawn through it. The field is
 * highest near the fold and falls away outward, so the ink stays in one
 * mass, and it is pushed about by slower noise so the mass grows lobes and
 * limbs. Raising or lowering the level spreads the ink or draws it in.
 *
 * Real ink is not one tone. It pools darker along its edge as it dries,
 * leaves a paler middle, and wicks out into the fibres in fine feathers;
 * those come from the same field, read at its edge.
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


/* Columns: [ink, paper, pooled ink]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Blood */
        a = vec3(0.46, 0.02, 0.03); b = vec3(0.90, 0.86, 0.80); c = vec3(0.18, 0.00, 0.01);
    } else if (mode == 2) {     /* Ectoplasm - white on black */
        a = vec3(0.86, 0.92, 0.90); b = vec3(0.012, 0.014, 0.016); c = vec3(1.00, 1.00, 1.00);
    } else if (mode == 3) {     /* Iron Gall - brown-black on vellum */
        a = vec3(0.16, 0.10, 0.06); b = vec3(0.88, 0.80, 0.64); c = vec3(0.05, 0.03, 0.02);
    } else if (mode == 4) {     /* Violet */
        a = vec3(0.24, 0.06, 0.40); b = vec3(0.88, 0.86, 0.90); c = vec3(0.08, 0.00, 0.16);
    } else if (mode == 5) {     /* Tar - black on black, seen by its sheen */
        a = vec3(0.10, 0.10, 0.11); b = vec3(0.030, 0.030, 0.034); c = vec3(0.24, 0.24, 0.26);
    } else if (mode == 6) {     /* Absinthe */
        a = vec3(0.36, 0.60, 0.10); b = vec3(0.020, 0.030, 0.014); c = vec3(0.70, 1.00, 0.30);
    } else {                    /* Ink on Bone */
        a = vec3(0.06, 0.06, 0.07); b = vec3(0.90, 0.87, 0.80); c = vec3(0.00, 0.00, 0.00);
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
    /* The fold. */
    vec2 f = vec2(abs(p.x), p.y);
    if (int(folds) == 1) f.y = abs(f.y);

    float t = TIME * morph * 0.25 + centroid * 0.35;
    /* The field: slow, then pushed about by slower. */
    vec2 q = f * vec2(2.3, 2.0);
    vec2 push = vec2(fbm(q * 0.9 + vec2(t, 2.0)), fbm(q * 0.9 + vec2(7.0, -t * 0.8))) - 0.5;
    float body = fbm(q + push * (1.4 + 1.6 * limbs) + vec2(0.0, t * 0.3));
    float fine = fbm(q * 3.4 + push * 3.0 + 9.0);
    float field = body + (fine - 0.5) * 0.30 * detail;
    /* Ink stays near the fold and inside the page. */
    float reach = 1.0 - smoothstep(0.05, 0.62 + 0.25 * spread, f.x) * 0.75;
    reach *= 1.0 - smoothstep(0.26, 0.52, abs(p.y));
    field *= reach;

    float levelAt = mix(0.60, 0.30, spread) - 0.07 * (bass - 0.25) * 2.0;
    float d = field - levelAt;                         /* > 0 is ink */
    /* Feathering: the edge is frayed by a fine fibre noise. */
    float fibre = noise2(gl_FragCoord.xy * 0.22) * 0.6 + noise2(gl_FragCoord.xy * 0.55 + 3.0) * 0.4;
    float fray = (fibre - 0.5) * 0.06 * feather;
    float edgeW = 0.004 + 0.022 * feather;
    float ink = smoothstep(-edgeW, edgeW, d + fray);

    /* Pooling: darker at the rim, paler toward the middle. */
    float rim = exp(-pow(max(d, 0.0) / 0.035, 2.0));
    float middle = smoothstep(0.03, 0.22, d);

    /* Spatter: small drops thrown clear of the blot, mirrored with it. */
    vec2 g = f * 22.0;
    vec2 id = floor(g);
    vec2 gf = fract(g) - 0.5;
    float pick = hash21(id + floor(TIME * 0.2 + beat * 0.99) * 0.0);
    float drop = step(1.0 - spatter * 0.16, pick);
    float dropR = 0.07 + 0.22 * hash21(id + 5.0);
    vec2 dropO = (vec2(hash21(id + 1.0), hash21(id + 9.0)) - 0.5) * 0.6;
    float nearBlot = smoothstep(-0.20, -0.02, d) * (1.0 - smoothstep(-0.02, 0.02, d));
    float spot = drop * nearBlot * (1.0 - smoothstep(dropR - 0.06, dropR + 0.02, length(gf - dropO)));
    ink = max(ink, spot);

    mat3 pal = paletteFor(int(colorMode));
    vec3 INK = hueRotate(pal[0], hueShift);
    vec3 PAPER = pal[1];
    vec3 POOL = hueRotate(pal[2], hueShift);
    bool lightOnDark = dot(PAPER, vec3(0.333)) < 0.3;

    /* Paper: laid lines, fibres, a little foxing. */
    float laid = 0.5 + 0.5 * sin(gl_FragCoord.y * 0.9);
    vec3 sheet = PAPER * (1.0 - paper * (0.035 * laid + 0.06 * (fibre - 0.5)));
    sheet *= 1.0 - paper * 0.10 * smoothstep(0.55, 0.85, fbm(uv * 2.6 + 30.0));

    vec3 inkTone = mix(INK, POOL, pooling * rim);
    inkTone = mix(inkTone, mix(INK, PAPER, 0.16), pooling * 0.6 * middle * (0.6 + 0.8 * fine));
    if (lightOnDark) inkTone *= 0.80 + 0.5 * level;
    vec3 col = mix(sheet, inkTone, ink);
    /* A halo of thinned ink just outside the edge. */
    col = mix(col, mix(sheet, INK, 0.5), (1.0 - ink) * exp(-pow(min(d + fray, 0.0) / (0.012 + 0.03 * feather), 2.0)) * 0.35 * feather);

    /* The crease down the middle of the page. */
    float fold1 = exp(-abs(p.x) * res.y * size * 0.9);
    float fold2 = int(folds) == 1 ? exp(-abs(p.y) * res.y * size * 0.9) : 0.0;
    col *= 1.0 - crease * 0.22 * max(fold1, fold2);
    col += (lightOnDark ? vec3(0.05) : vec3(0.0)) * crease * max(fold1, fold2) * 0.3;

    col *= 1.0 - 0.30 * dot(uv, uv);
    col *= exposure;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
