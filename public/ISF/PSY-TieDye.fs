/*{
    "DESCRIPTION": "Tie-dye, as dyed and not as drawn. Cloth is pleated and bound, dye is poured on in bands, and where the binding was tight the dye could not reach, leaving the white veins. Five ways of tying: the spiral, the bullseye, the sunburst, the accordion stripe and the crumple. Bleed sets how far the colours ran into each other, resist how much white survived, and the weave of the cotton is there if you look. It turns and breathes slowly. Bass swells the cloth, beats pulse the dye, spectral centroid winds the spiral.",
    "CREDIT": "Ghost Arcade psychedelic pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Lot Shirt", "Indigo", "Sunset Strip", "Rasta", "Sherbet", "Forest Floor", "Bleach"]},
        {"NAME": "tying",     "TYPE": "long",  "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Spiral", "Bullseye", "Sunburst", "Stripes", "Crumple"]},
        {"NAME": "arms",      "TYPE": "long",  "DEFAULT": 3, "VALUES": [1, 2, 3, 4, 5, 6, 8], "LABELS": ["1", "2", "3", "4", "5", "6", "8"]},
        {"NAME": "winding",   "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "bandWidth", "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "crinkle",   "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "bleed",     "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "resist",    "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "mottle",    "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "weave",     "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "spin",      "TYPE": "float", "DEFAULT": 0.10, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "breathe",   "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "dyeRun",    "TYPE": "float", "DEFAULT": 0.15, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "centreX",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "centreY",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Every tie-dye is two coordinates. One runs along the pleats and is where
 * the dye was poured in bands; the other runs across the pleats and is
 * where the binding kept the dye out. For a spiral the first is the angle
 * plus a twist that grows with distance from the pinch, and the second is
 * the distance itself; the other ties are the same idea with the two
 * coordinates chosen differently.
 *
 * The white veins follow the fold lines, so they are drawn from a noise
 * that is stretched hard along the second coordinate: long streaks across
 * the bands, not blotches.
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
    for (int i = 0; i < 3; i++) {
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
    if (mode == 1) {            /* Indigo - shibori blues */
        a = vec3(0.06, 0.12, 0.46); b = vec3(0.16, 0.34, 0.80); c = vec3(0.50, 0.70, 0.96);
    } else if (mode == 2) {     /* Sunset Strip */
        a = vec3(1.00, 0.26, 0.10); b = vec3(1.00, 0.70, 0.06); c = vec3(0.86, 0.08, 0.50);
    } else if (mode == 3) {     /* Rasta */
        a = vec3(0.86, 0.10, 0.08); b = vec3(1.00, 0.84, 0.06); c = vec3(0.08, 0.60, 0.20);
    } else if (mode == 4) {     /* Sherbet */
        a = vec3(1.00, 0.56, 0.70); b = vec3(0.60, 0.90, 1.00); c = vec3(1.00, 0.92, 0.50);
    } else if (mode == 5) {     /* Forest Floor */
        a = vec3(0.26, 0.46, 0.14); b = vec3(0.60, 0.36, 0.10); c = vec3(0.80, 0.70, 0.26);
    } else if (mode == 6) {     /* Bleach - rust and bone out of black */
        a = vec3(0.07, 0.06, 0.07); b = vec3(0.70, 0.30, 0.12); c = vec3(0.94, 0.84, 0.66);
    } else {                    /* Lot Shirt - the full rainbow in three pours */
        a = vec3(0.92, 0.06, 0.36); b = vec3(0.98, 0.80, 0.04); c = vec3(0.06, 0.40, 0.92);
    }
    return mat3(a, b, c);
}

/* Round the three dyes, passing through the secondaries they make where they meet. */
vec3 pour(mat3 pal, float x, float run) {
    float k = fract(x) * 3.0;
    vec3 from = k < 1.0 ? pal[0] : k < 2.0 ? pal[1] : pal[2];
    vec3 to   = k < 1.0 ? pal[1] : k < 2.0 ? pal[2] : pal[0];
    float f = fract(k);
    float edge = mix(0.02, 0.5, run);
    /* Dyes multiply where they overlap, as wet dye does. */
    float m = smoothstep(0.5 - edge, 0.5 + edge, f);
    vec3 mixed = mix(from, to, m);
    vec3 overlap = sqrt(from * to);
    return mix(mixed, overlap, 4.0 * m * (1.0 - m) * 0.5);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    vec2 p = uv - vec2((centreX - 0.5) * aspect, centreY - 0.5);
    /* The cloth lifts and settles. */
    p *= 1.0 - breathe * 0.10 * (sin(TIME * 0.5) + 1.6 * (bass - 0.25));
    p += breathe * 0.012 * vec2(sin(p.y * 9.0 + TIME * 0.7), cos(p.x * 8.0 - TIME * 0.6));
    float rot = TIME * spin * 0.25;
    p = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * p;

    float r = length(p);
    float a = atan(p.y, p.x);
    int tie = int(tying);
    float nArms = float(arms);
    float wind = winding * (0.8 + 0.4 * centroid);

    /* `along`: which pour of dye. `across`: the direction the folds run. */
    float along;
    float across;
    vec2 streak;                 /* coordinates for the fold noise: (across folds, along folds) */
    if (tie == 1) {              /* Bullseye: rings round the pinch */
        along = r * (2.0 + 5.0 * (1.0 - bandWidth));
        across = a;
        streak = vec2(a * 14.0, r * 2.0);
    } else if (tie == 2) {       /* Sunburst: wedges out from the pinch */
        along = a / TAU * nArms * 2.0 + 0.15 * sin(r * 9.0);
        across = r;
        streak = vec2(r * 30.0, a * 3.0);
    } else if (tie == 3) {       /* Stripes: accordion pleats */
        along = (p.y + 0.06 * sin(p.x * 5.0 + 1.0)) * (2.0 + 6.0 * (1.0 - bandWidth));
        across = p.x;
        streak = vec2(p.x * 26.0, p.y * 2.4);
    } else if (tie == 4) {       /* Crumple: no order at all */
        along = fbm(p * 2.4 + 3.0) * (2.0 + 5.0 * (1.0 - bandWidth)) + fbm(p * 5.0 - 2.0) * 0.6;
        across = fbm(p * 3.0 + 9.0);
        streak = p * 9.0;
    } else {                     /* Spiral */
        along = a / TAU * nArms + log(r + 0.03) * wind * 2.2 * nArms / 3.0;
        across = r;
        streak = vec2(a * 12.0 + log(r + 0.03) * wind * 10.0, log(r + 0.03) * 3.0);
    }
    along += TIME * dyeRun * 0.05 + beat * 0.02;

    /* Pleats: the bands waver where the folds were uneven. */
    float pleat = fbm(streak * vec2(1.0, 0.35) + 4.0) - 0.5;
    along += pleat * crinkle * 0.34;
    /* Dye wicks along the fibres, feathering every band edge. */
    along += (noise2(streak * vec2(6.0, 0.6)) - 0.5) * 0.10 * bleed;

    mat3 pal = paletteFor(int(colorMode));
    vec3 dye = pour(pal, along, bleed);

    /* Mottling: dye took more in some places than others. */
    float take = fbm(p * 5.0 + along * 0.7 + 12.0);
    dye *= 1.0 - mottle * 0.42 * smoothstep(0.35, 0.75, take);
    dye = mix(dye, dye * dye * 1.25, mottle * 0.4 * smoothstep(0.55, 0.2, take));

    /* The veins the binding left: long streaks across the bands. */
    float vein = fbm(streak * vec2(1.6, 0.22) + vec2(0.0, 7.0));
    float fine = noise2(streak * vec2(7.0, 0.5) + 2.0);
    float white = smoothstep(0.62 - 0.30 * resist, 0.74 - 0.20 * resist, vein * 0.7 + fine * 0.3 + 0.10 * resist);
    bool bleach = int(colorMode) == 6;
    vec3 cloth = bleach ? vec3(0.05, 0.045, 0.05) : vec3(0.96, 0.94, 0.90);
    vec3 col = mix(dye, cloth, white * resist * (bleach ? 0.75 : 0.90));

    /* Cotton: a plain weave under everything. */
    vec2 thread = gl_FragCoord.xy * 0.55;
    float warp = 0.5 + 0.5 * sin(thread.x * PI);
    float weft = 0.5 + 0.5 * sin(thread.y * PI);
    col *= 1.0 - weave * 0.16 * (warp * weft) - weave * 0.05 * (hash21(floor(thread)) - 0.5);

    col = hueRotate(col, hueShift);
    col *= (0.92 + 0.14 * level) * (1.0 + beat * 0.08);
    col *= 1.0 - 0.20 * dot(uv, uv);
    col *= exposure;

    gl_FragColor = vec4(col, 1.0);
}
