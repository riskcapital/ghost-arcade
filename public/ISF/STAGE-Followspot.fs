/*{
    "DESCRIPTION": "Followspots. Up to four hard-edged spots that track across the stage the way an operator would: holding centre on a singer, crossing in pairs, roaming, a slow ballyhoo, or parked where you put them. Each has an iris, an edge that runs from knife sharp to soft, a hot centre or a flat field, and a gel frame. The beam can be seen coming down through the haze from the spot's position in the house. Aimed across a band, a single white spot at low level does more than any pattern. Bass breathes the iris, beats change the gel if you ask, spectral centroid sets how restless the operator is.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Xenon", "Carbon Arc", "Cabaret", "Ice Rink", "Opera", "Circus", "Lavender"]},
        {"NAME": "colorPattern", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3],
         "LABELS": ["One gel", "A gel each", "Change on beat", "Slow gel roll"]},
        {"NAME": "spots",     "TYPE": "long",  "DEFAULT": 2,
         "VALUES": [1, 2, 3, 4], "LABELS": ["1", "2", "3", "4"]},
        {"NAME": "tracking",  "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [0, 1, 2, 3, 4],
         "LABELS": ["Parked", "Hold centre", "Cross", "Roam", "Ballyhoo"]},
        {"NAME": "posX",      "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "posY",      "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "speed",     "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 3.00},
        {"NAME": "range",     "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "spotSize",  "TYPE": "float", "DEFAULT": 0.22, "MIN": 0.03, "MAX": 0.80},
        {"NAME": "iris",      "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "edge",      "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hotCentre", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "stretch",   "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "beamHaze",  "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "houseSide", "TYPE": "long",  "DEFAULT": 2,
         "VALUES": [0, 1, 2], "LABELS": ["From the left", "From the right", "Both sides"]},
        {"NAME": "fringe",    "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "level",     "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * A followspot is a person. What reads as "followspot" rather than "moving
 * light" is the hand on it: it drifts a little when holding, overshoots a
 * turn, and never moves at one speed. The tracking here is built from slow
 * noise rather than sines for that reason, with a small faster tremor on
 * top that the `speed` and treble content scale.
 *
 * The pool on the stage is an ellipse, because the spot comes in at an
 * angle; `stretch` leans it along the line back to the operator. Old lenses
 * leave a faint blue rim on one side of the pool and red on the other, which
 * is what `fringe` adds.
 */

const float TAU = 6.28318530718;
const int MAX_SPOTS = 4;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

/* Gel frames in the boomerang. Columns: three frames. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Carbon Arc - the warm white of an old arc lamp */
        a = vec3(1.00, 0.92, 0.76);
        b = vec3(1.00, 0.74, 0.44);
        c = vec3(0.86, 0.90, 1.00);
    } else if (mode == 2) {     /* Cabaret */
        a = vec3(1.00, 0.36, 0.56);
        b = vec3(1.00, 0.80, 0.40);
        c = vec3(0.60, 0.40, 1.00);
    } else if (mode == 3) {     /* Ice Rink */
        a = vec3(0.70, 0.90, 1.00);
        b = vec3(0.36, 0.60, 1.00);
        c = vec3(1.00, 1.00, 1.00);
    } else if (mode == 4) {     /* Opera */
        a = vec3(1.00, 0.86, 0.62);
        b = vec3(0.86, 0.20, 0.20);
        c = vec3(0.30, 0.36, 0.86);
    } else if (mode == 5) {     /* Circus */
        a = vec3(1.00, 0.16, 0.12);
        b = vec3(1.00, 0.86, 0.10);
        c = vec3(0.10, 0.50, 1.00);
    } else if (mode == 6) {     /* Lavender */
        a = vec3(0.80, 0.70, 1.00);
        b = vec3(1.00, 0.80, 0.90);
        c = vec3(0.60, 0.80, 1.00);
    } else {                    /* Xenon - cold white, then two tints of it */
        a = vec3(0.94, 0.97, 1.00);
        b = vec3(1.00, 0.90, 0.78);
        c = vec3(0.74, 0.86, 1.00);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

vec3 frameOf(mat3 pal, float index) {
    float k = mod(index, 3.0);
    return k < 0.5 ? pal[0] : k < 1.5 ? pal[1] : pal[2];
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;
    float px = 1.0 / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int n = int(spots);
    int mode = int(tracking);
    int pattern = int(colorPattern);
    int side = int(houseSide);
    mat3 pal = paletteFor(int(colorMode));
    float t = TIME * speed;
    vec2 home = vec2((posX - 0.5) * aspect, posY - 0.5);
    float radius = spotSize * (1.0 - 0.8 * iris) * (0.94 + 0.12 * bass);
    float soft = mix(0.55, 0.012, edge);

    /* Haze the beams pass through. */
    vec2 hp = uv * vec2(2.0, 2.8) + vec2(TIME * 0.03, -TIME * 0.02);
    float wisps = noise2(hp) * 0.6 + noise2(hp * 2.4 + 5.0) * 0.4;

    vec3 col = vec3(0.0);
    for (int i = 0; i < MAX_SPOTS; i++) {
        if (i >= n) break;
        float fi = float(i);
        float seed = fi * 17.3 + 3.0;

        /* Where this operator is pointing. */
        vec2 c = home;
        float reach = range * 0.5;
        if (mode == 1) {
            c += vec2(noise1(t * 0.5 + seed) - 0.5, noise1(t * 0.4 + seed * 2.0) - 0.5) * vec2(reach * 0.5 * aspect, reach * 0.3);
            c.x += (fi - 0.5 * float(n - 1)) * 0.02;
        } else if (mode == 2) {
            float dirSign = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
            c.x += dirSign * sin(t * 0.9 + fi * 0.4) * reach * aspect * 0.8;
            c.y += sin(t * 0.6 + fi * 1.3) * reach * 0.25;
        } else if (mode == 3) {
            c = vec2((noise1(t * 0.35 + seed) - 0.5) * aspect * (0.2 + 0.9 * range),
                     (noise1(t * 0.30 + seed * 3.0) - 0.5) * (0.2 + 0.7 * range));
        } else if (mode == 4) {
            c += vec2(sin(t * 1.7 + fi * 2.1), sin(t * 2.3 + fi * 1.2)) * vec2(reach * aspect * 0.8, reach * 0.6);
        } else {
            c.x += (fi - 0.5 * float(n - 1)) * spotSize * 1.6;
        }
        /* The hand is never perfectly still. */
        c += (vec2(noise1(TIME * 2.3 + seed * 5.0), noise1(TIME * 2.9 + seed * 7.0)) - 0.5) * 0.006 * (0.4 + speed) * (0.5 + centroid);

        /* Where the operator sits: high in the house, to one side. */
        float houseSign = side == 0 ? -1.0 : side == 1 ? 1.0 : (mod(fi, 2.0) < 0.5 ? -1.0 : 1.0);
        vec2 house = vec2(houseSign * aspect * 0.62, 0.62);

        /* Pool: an ellipse leaning along the line back to the lamp. */
        vec2 toHouse = normalize(house - c);
        vec2 rel = uv - c;
        float alongH = dot(rel, toHouse);
        float acrossH = rel.x * toHouse.y - rel.y * toHouse.x;
        float e = length(vec2(alongH / (1.0 + 0.9 * stretch), acrossH)) / radius;
        float pool = 1.0 - smoothstep(1.0 - soft, 1.0 + soft * 0.6, e);
        float field = mix(1.0, 0.55 + 0.75 * exp(-e * e * 2.2), hotCentre);

        /* Gel. */
        float frame = fi;
        if (pattern == 0) frame = 0.0;
        else if (pattern == 2) frame = fi + floor(TIME * 0.5 + beat * 0.99);
        vec3 gel = frameOf(pal, frame);
        if (pattern == 3) gel = mix(frameOf(pal, floor(TIME * 0.12 + fi)), frameOf(pal, floor(TIME * 0.12 + fi) + 1.0), smoothstep(0.7, 1.0, fract(TIME * 0.12 + fi)));
        gel = hueRotate(gel, hueShift);

        /* Chromatic fringe at the rim, opposite colours on opposite sides. */
        float rimBand = exp(-pow((e - 1.0) / max(soft * 0.8, 0.03), 2.0));
        vec3 rimTint = mix(vec3(0.3, 0.5, 1.0), vec3(1.0, 0.45, 0.2), smoothstep(-1.0, 1.0, alongH / radius));
        vec3 light = gel * pool * field + rimTint * rimBand * fringe * 0.22 * pool;

        /* The beam in the air: a cone from the house to the pool. */
        vec2 axis = c - house;
        float len = length(axis);
        vec2 dirB = axis / len;
        vec2 hb = uv - house;
        float al = dot(hb, dirB);
        float ac = abs(hb.x * dirB.y - hb.y * dirB.x);
        float wide = radius * clamp(al / len, 0.0, 1.0) + 0.004;
        float cone = (1.0 - smoothstep(wide * 0.75, wide, ac)) * step(0.0, al) * (1.0 - smoothstep(len * 0.92, len, al));
        light += gel * cone * beamHaze * 0.16 * (0.4 + 1.2 * wisps);
        /* The lamp house itself, if it is in frame. */
        float ld = length(uv - house);
        light += mix(gel, vec3(1.0), 0.6) * 0.00025 / (ld * ld + 0.00010) * step(0.01, beamHaze);

        col += light * level;
    }

    col *= 1.0 + beat * 0.10;
    col *= exposure;
    col = col / (1.0 + 0.18 * col);
    col *= 1.18;

    gl_FragColor = vec4(col, 1.0);
}
