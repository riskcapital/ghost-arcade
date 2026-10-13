/*{
    "DESCRIPTION": "Apparitions. Tall shrouded figures that are never quite there: a pale column of cloth and smoke with the suggestion of a bowed head, standing in the dark, thinning to mist at the floor. They come slowly into being, hold, and go, drifting a little, never arriving. Shot like a Victorian spirit photograph, with grain, flicker and the scratches of an old plate if you want them. Nothing jumps. Bass thickens them, beats make the exposure flutter, spectral centroid sways the cloth.",
    "CREDIT": "Ghost Arcade Halloween pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Silver Plate", "Sepia", "Corpse Light", "Blood Moon", "Ultraviolet", "Lantern", "Negative"]},
        {"NAME": "figures",   "TYPE": "long",  "DEFAULT": 3, "VALUES": [1, 2, 3, 4, 5], "LABELS": ["1", "2", "3", "4", "5"]},
        {"NAME": "presence",  "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "comeAndGo", "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "height",    "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.30, "MAX": 1.20},
        {"NAME": "drift",     "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "dissolve",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "drapery",   "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hollows",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "floorMist", "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "grain",     "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "flicker",   "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "plateDamage","TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * What reads as a figure is very little: something taller than it is wide,
 * narrower at the top, with a smaller rounded mass above the shoulders. Give
 * the eye that much and it supplies the rest, which is exactly why less
 * detail is more frightening here than more.
 *
 * Each apparition is that outline, eaten away at its edges by smoke so that
 * it has no line round it, and filled with long vertical streaks that read
 * as hanging cloth. It is denser at the head and shoulders and thins to
 * nothing toward the floor. Where the eyes would be there are only two
 * places a little darker than the rest.
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


/* Tones. Columns: [light, shadow, mist]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Sepia */
        a = vec3(0.96, 0.86, 0.66); b = vec3(0.040, 0.026, 0.014); c = vec3(0.50, 0.40, 0.28);
    } else if (mode == 2) {     /* Corpse Light */
        a = vec3(0.70, 1.00, 0.80); b = vec3(0.004, 0.020, 0.016); c = vec3(0.16, 0.44, 0.34);
    } else if (mode == 3) {     /* Blood Moon */
        a = vec3(1.00, 0.70, 0.60); b = vec3(0.030, 0.004, 0.006); c = vec3(0.50, 0.08, 0.08);
    } else if (mode == 4) {     /* Ultraviolet */
        a = vec3(0.80, 0.70, 1.00); b = vec3(0.012, 0.004, 0.034); c = vec3(0.30, 0.14, 0.60);
    } else if (mode == 5) {     /* Lantern */
        a = vec3(1.00, 0.84, 0.56); b = vec3(0.024, 0.014, 0.006); c = vec3(0.50, 0.30, 0.12);
    } else if (mode == 6) {     /* Negative - dark figures on a pale plate */
        a = vec3(0.06, 0.06, 0.07); b = vec3(0.86, 0.85, 0.82); c = vec3(0.50, 0.50, 0.50);
    } else {                    /* Silver Plate */
        a = vec3(0.90, 0.93, 0.98); b = vec3(0.012, 0.014, 0.020); c = vec3(0.36, 0.40, 0.48);
    }
    return mat3(a, b, c);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int n = int(figures);
    mat3 pal = paletteFor(int(colorMode));
    vec3 LIGHT = hueRotate(pal[0], hueShift);
    vec3 SHADOW = pal[1];
    vec3 MIST = hueRotate(pal[2], hueShift);

    float veil = 0.0;          /* how much figure covers this pixel */
    float fold = 0.0;          /* drapery tone */
    for (int i = 0; i < 5; i++) {
        if (i >= n) break;
        float fi = float(i);
        float seed = fi * 13.7 + 2.0;
        /* Each one keeps its own slow time for coming and going. */
        float life = TIME * comeAndGo * (0.06 + 0.02 * hash21(vec2(seed, 1.0))) + hash21(vec2(seed, 5.0));
        float visit = floor(life);
        float phase = fract(life);
        float there = smoothstep(0.0, 0.30, phase) * (1.0 - smoothstep(0.62, 1.0, phase));
        there = mix(1.0, there, step(0.001, comeAndGo));
        /* Where it stands this visit, and how tall. */
        float spreadX = n > 1 ? (fi / float(n - 1) - 0.5) : 0.0;
        float x0 = spreadX * aspect * 0.72 + (hash21(vec2(seed, visit)) - 0.5) * 0.30;
        x0 += drift * 0.10 * sin(TIME * 0.11 + seed) * (1.0 + phase);
        float tall = height * (0.82 + 0.30 * hash21(vec2(seed + 3.0, visit)));
        float depthDim = 0.55 + 0.45 * hash21(vec2(seed + 7.0, visit));

        vec2 q = vec2(uv.x - x0, uv.y + 0.5);            /* feet at y = 0 */
        float sway = 0.014 * sin(TIME * 0.5 + seed + q.y * 3.0) * (0.5 + centroid);
        q.x += sway * q.y / max(tall, 0.1);
        float yn = q.y / tall;                            /* 0 floor .. 1 crown */

        /* Outline: head, shoulders, a body that widens slightly to the floor. */
        float headR = 0.062 * tall;
        float head = length(vec2(q.x, q.y - tall * 0.93) * vec2(1.0, 0.85)) - headR;
        float bodyW = mix(0.19, 0.105, smoothstep(0.0, 0.84, yn)) * tall;
        float shoulders = smoothstep(0.90, 0.80, yn);
        float body = abs(q.x) - bodyW * shoulders;
        body = max(body, q.y - tall * 0.86);
        float shape = min(head, body);

        /* Smoke eats the edge; more of it lower down, where it trails away. */
        vec2 sp = vec2(q.x * 7.0, q.y * 3.2 - TIME * 0.12) + seed;
        float smoke = fbm(sp + 0.8 * vec2(fbm(sp * 0.6 + 3.0), 0.0));
        float erode = (smoke - 0.5) * (0.05 + 0.20 * dissolve) * (1.0 + 2.2 * (1.0 - yn));
        float edge = 0.012 + 0.06 * dissolve;
        float cover = 1.0 - smoothstep(-edge, edge, shape + erode);
        /* Thins to nothing at the floor. */
        cover *= smoothstep(-0.02, 0.38, yn);
        cover *= there * depthDim * presence * (0.85 + 0.5 * bass);

        /* Drapery: long streaks that follow the fall of cloth. */
        float streaks = fbm(vec2(q.x * 46.0 / max(tall, 0.2) + seed, q.y * 2.4 + sway * 30.0));
        float cloth = 0.55 + 0.75 * (streaks - 0.5) * drapery;
        /* The places eyes would be: a little less light, no more. */
        vec2 eyeP = vec2(abs(q.x) - headR * 0.40, q.y - tall * 0.935);
        float hollow = exp(-dot(eyeP * vec2(1.0, 1.25), eyeP * vec2(1.0, 1.25)) / (headR * headR * 0.07));
        cloth *= 1.0 - hollows * 0.75 * hollow;

        fold = mix(fold, cloth, cover);
        veil = veil + cover * (1.0 - veil);
    }

    /* Mist along the floor. */
    vec2 mp = vec2(uv.x * 2.2 + TIME * 0.03, (uv.y + 0.5) * 5.0);
    float low = fbm(mp + vec2(fbm(mp * 0.5 - TIME * 0.02), 0.0));
    float mistBand = exp(-(uv.y + 0.5) * 6.0) * floorMist * (0.4 + 0.9 * low);

    vec3 col = SHADOW;
    col += MIST * mistBand * 0.55;
    col = mix(col, mix(MIST, LIGHT, clamp(fold, 0.0, 1.0)) * (0.45 + 0.75 * fold), veil);

    /* The plate: uneven exposure, grain, a flutter in the lamp, old damage. */
    float lampFlutter = 1.0 - flicker * 0.22 * (noise2(vec2(TIME * 9.0, 1.0)) - 0.4) - flicker * 0.3 * beat * noise2(vec2(TIME * 31.0, 4.0));
    col *= lampFlutter;
    col *= 1.0 - 0.55 * dot(uv * vec2(0.8, 1.0), uv * vec2(0.8, 1.0));
    float g = hash21(gl_FragCoord.xy + floor(TIME * 24.0) * 17.0) - 0.5;
    col += g * grain * 0.10 * (0.4 + dot(col, vec3(0.6)));
    float scratch = step(0.9965, noise2(vec2(gl_FragCoord.x * 0.9, floor(TIME * 12.0) * 3.0))) * step(0.6, noise2(vec2(gl_FragCoord.y * 0.01, floor(TIME * 12.0))));
    float blotch = smoothstep(0.80, 0.95, fbm(uv * 3.0 + floor(TIME * 6.0) * 0.37));
    col += LIGHT * (scratch * 0.35 + blotch * 0.06) * plateDamage;

    col *= exposure * 1.25;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
