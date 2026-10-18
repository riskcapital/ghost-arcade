/*{
    "DESCRIPTION": "Gobo spots. Up to six profile spots land on the stage as discs of patterned light: open white, a foliage breakup, bars, a ring of dots, a star, a swirl or a shattered-glass pattern, each turning in its gate. Pull focus from razor sharp to a soft glow, split each spot with a rotating prism, and choose how they travel: parked, circling, a figure of eight, a sweep or a slow roam. Shone across a band it puts moving texture on people and instruments the way a real profile does. Bass opens the iris, beats kick the rotation, spectral centroid drives the roam.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Follow Spot", "Jewel", "Forest", "Volcano", "Lagoon", "Lilac", "Monochrome"]},
        {"NAME": "colorPattern", "TYPE": "long", "DEFAULT": 2,
         "VALUES": [0, 1, 2, 3, 4],
         "LABELS": ["One colour", "Alternate", "Three-way", "Colour wheel", "Split gel"]},
        {"NAME": "spots",     "TYPE": "long",  "DEFAULT": 3,
         "VALUES": [1, 2, 3, 4, 5, 6], "LABELS": ["1", "2", "3", "4", "5", "6"]},
        {"NAME": "gobo",      "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Open", "Breakup", "Bars", "Dots", "Star", "Swirl", "Glass"]},
        {"NAME": "spotSize",  "TYPE": "float", "DEFAULT": 0.26, "MIN": 0.05, "MAX": 0.70},
        {"NAME": "focus",     "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "goboScale", "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "goboSpin",  "TYPE": "float", "DEFAULT": 0.30, "MIN": -3.00, "MAX": 3.00},
        {"NAME": "prism",     "TYPE": "long",  "DEFAULT": 0,
         "VALUES": [0, 3, 5], "LABELS": ["Off", "3 facet", "5 facet"]},
        {"NAME": "prismSpread","TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "prismSpin", "TYPE": "float", "DEFAULT": 0.40, "MIN": -3.00, "MAX": 3.00},
        {"NAME": "travel",    "TYPE": "long",  "DEFAULT": 4,
         "VALUES": [0, 1, 2, 3, 4],
         "LABELS": ["Parked", "Circle", "Figure of eight", "Sweep", "Roam"]},
        {"NAME": "speed",     "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 3.00},
        {"NAME": "range",     "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "iris",      "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "halation",  "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "floorSpill","TYPE": "float", "DEFAULT": 0.10, "MIN": 0.00, "MAX": 0.60},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * A profile spot throws an image of whatever sits in its gate: a metal disc
 * with a pattern cut out of it, the gobo. In focus the cut edges are crisp;
 * racked out they blur until only the disc of light is left. Both are the
 * same function here, a pattern whose edges are drawn with a width that
 * `focus` controls, so focus pulls smoothly rather than cross-fading.
 *
 * A prism in front of the lens repeats the image around a ring. That is one
 * more evaluation of the same pattern per facet, offset from the centre.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int MAX_SPOTS = 6;
const int MAX_FACETS = 5;

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

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

/* Gel sets for profiles. Columns: three colours in the wheel. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Jewel */
        a = vec3(0.86, 0.06, 0.26);
        b = vec3(0.06, 0.36, 1.00);
        c = vec3(0.06, 0.86, 0.50);
    } else if (mode == 2) {     /* Forest */
        a = vec3(0.50, 1.00, 0.30);
        b = vec3(1.00, 0.92, 0.50);
        c = vec3(0.10, 0.72, 0.42);
    } else if (mode == 3) {     /* Volcano */
        a = vec3(1.00, 0.20, 0.04);
        b = vec3(1.00, 0.60, 0.08);
        c = vec3(0.72, 0.04, 0.12);
    } else if (mode == 4) {     /* Lagoon */
        a = vec3(0.06, 0.86, 0.92);
        b = vec3(0.20, 0.42, 1.00);
        c = vec3(0.60, 1.00, 0.86);
    } else if (mode == 5) {     /* Lilac */
        a = vec3(0.74, 0.56, 1.00);
        b = vec3(1.00, 0.66, 0.86);
        c = vec3(0.50, 0.70, 1.00);
    } else if (mode == 6) {     /* Monochrome */
        a = vec3(1.00, 1.00, 1.00);
        b = vec3(0.70, 0.74, 0.80);
        c = vec3(0.92, 0.90, 0.86);
    } else {                    /* Follow Spot - white, warm, cool */
        a = vec3(1.00, 0.98, 0.94);
        b = vec3(1.00, 0.84, 0.60);
        c = vec3(0.78, 0.90, 1.00);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

/*
 * The gobo: light passed at point q of the gate (|q| <= 1). `blur` is the
 * edge width that focus asks for, in gate units.
 */
float gate(vec2 q, int kind, float spin, float scale, float blur, float seed) {
    float r = length(q);
    float disc = 1.0 - smoothstep(1.0 - blur, 1.0 + blur, r);
    if (kind == 0 || disc <= 0.0) return disc;
    float ca = cos(spin), sa = sin(spin);
    vec2 p = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
    float a = atan(p.y, p.x);
    float k = 1.0 + 3.0 * scale;
    float m;
    if (kind == 1) {            /* Breakup: leaves and gaps */
        float v = noise2(p * 2.2 * k + seed * 9.0) * 0.6 + noise2(p * 5.0 * k - seed * 4.0) * 0.4;
        m = smoothstep(0.50 - blur * 1.2, 0.50 + blur * 1.2, v);
    } else if (kind == 2) {     /* Bars */
        float s = abs(fract(p.x * 1.6 * k) - 0.5);
        m = smoothstep(0.22 - blur * 0.8 * k, 0.22 + blur * 0.8 * k, s);
    } else if (kind == 3) {     /* A ring of dots, and one in the middle */
        float count = floor(5.0 + 6.0 * scale);
        float seg = TAU / count;
        float aa = mod(a + seg * 0.5, seg) - seg * 0.5;
        vec2 dp = r * vec2(cos(aa), sin(aa)) - vec2(0.62, 0.0);
        float dotR = 0.75 * sin(seg * 0.5) * 0.62;
        float ring = 1.0 - smoothstep(dotR - blur, dotR + blur, length(dp));
        float mid = 1.0 - smoothstep(0.20 - blur, 0.20 + blur, r);
        m = max(ring, mid);
    } else if (kind == 4) {     /* Star */
        float points = floor(5.0 + 5.0 * scale);
        float edge = 0.42 + 0.50 * pow(0.5 + 0.5 * cos(a * points), 2.0);
        m = 1.0 - smoothstep(edge - blur * 1.5, edge + blur * 1.5, r);
    } else if (kind == 5) {     /* Swirl */
        float arms = floor(3.0 + 5.0 * scale);
        float s = sin(a * arms + r * 7.0);
        m = smoothstep(-blur * 4.0, blur * 4.0, s) * smoothstep(0.08, 0.20, r);
    } else {                    /* Glass: shards with bright seams */
        vec2 g = p * 2.4 * k + seed;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float tone = 0.35 + 0.65 * hash21(id + seed * 3.0);
        float seam = smoothstep(0.50 - blur * 2.0 * k, 0.40 - blur * 2.0 * k, max(abs(f.x), abs(f.y)));
        m = tone * (0.35 + 0.65 * seam);
    }
    return disc * m;
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int n = int(spots);
    float count = float(n);
    int kind = int(gobo);
    int move = int(travel);
    int facets = int(prism);
    int pattern = int(colorPattern);
    mat3 pal = paletteFor(int(colorMode));
    float t = TIME * speed;

    float radius = spotSize * (1.0 - 0.75 * iris) * (0.92 + 0.16 * bass);
    float blur = mix(0.42, 0.012, focus);
    float spin = TIME * goboSpin + beat * 0.5;

    vec3 col = vec3(0.0);
    for (int i = 0; i < MAX_SPOTS; i++) {
        if (i >= n) break;
        float fi = float(i);
        float u = n > 1 ? fi / (count - 1.0) - 0.5 : 0.0;
        vec2 home = vec2(u * aspect * 0.78, 0.0);
        vec2 c = home;
        float rx = range * 0.42 * aspect / max(count, 1.5);
        float ry = range * 0.30;
        float ph = fi * 1.9;
        if (move == 1)      c += vec2(cos(t * 1.4 + ph), sin(t * 1.4 + ph)) * vec2(rx, ry);
        else if (move == 2) c += vec2(sin(t * 1.2 + ph), sin(t * 2.4 + ph * 2.0) * 0.7) * vec2(rx * 1.3, ry);
        else if (move == 3) c = vec2(sin(t * 0.9 + fi * 0.5) * range * 0.45 * aspect, (hash11(fi + 3.0) - 0.5) * 0.5 * range);
        else if (move == 4) {
            float w = 0.6 + 0.5 * centroid;
            c = vec2((noise2(vec2(t * 0.35 * w + fi * 7.0, 1.0)) - 0.5) * aspect * (0.3 + 0.9 * range),
                     (noise2(vec2(t * 0.31 * w + fi * 13.0, 5.0)) - 0.5) * (0.3 + 0.7 * range));
        }

        vec3 gel = pal[0];
        if (pattern == 1) gel = mod(fi, 2.0) < 0.5 ? pal[0] : pal[1];
        else if (pattern == 2) gel = mod(fi, 3.0) < 0.5 ? pal[0] : mod(fi, 3.0) < 1.5 ? pal[1] : pal[2];
        else if (pattern == 3) {
            float k = mod(floor(TIME * 0.25 * (0.5 + speed) + fi), 3.0);
            float f = smoothstep(0.85, 1.0, fract(TIME * 0.25 * (0.5 + speed)));
            vec3 from = k < 0.5 ? pal[0] : k < 1.5 ? pal[1] : pal[2];
            vec3 to = k < 0.5 ? pal[1] : k < 1.5 ? pal[2] : pal[0];
            gel = mix(from, to, f);
        }
        gel = hueRotate(gel, hueShift);

        vec2 q = (uv - c) / radius;
        float seed = fi * 3.7 + 1.0;
        float light;
        if (facets < 2) {
            light = gate(q, kind, spin * (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0), goboScale, blur, seed);
        } else {
            /* Prism: the image repeated on a turning ring, each a little dimmer. */
            light = 0.0;
            float off = 0.35 + 0.9 * prismSpread;
            for (int f = 0; f < MAX_FACETS; f++) {
                if (f >= facets) break;
                float fa = TAU * float(f) / float(facets) + TIME * prismSpin;
                vec2 qo = q * 1.25 - vec2(cos(fa), sin(fa)) * off;
                light += gate(qo, kind, spin, goboScale, blur, seed) * 0.85;
            }
        }

        /* Split gel: two colours meeting across the middle of the gate. */
        vec3 tint = gel;
        if (pattern == 4) tint = mix(hueRotate(pal[0], hueShift), hueRotate(pal[1], hueShift), smoothstep(-blur * 2.0, blur * 2.0, q.x));

        /* Halation: the soft glow a hot lens puts round a bright image. */
        float d = length(uv - c);
        float bloom = halation * 0.20 * exp(-d * d / (radius * radius * 3.5));
        col += tint * (light * (0.85 + 0.45 * level) + bloom);
    }

    /* Spill: the faint light that gets everywhere when a rig is on. */
    col += dot(col, vec3(0.3333)) * 0.0 + (pal[0] + pal[1]) * 0.5 * floorSpill * 0.06;

    col *= 1.0 + beat * 0.18;
    col *= exposure;
    col = col / (1.0 + 0.20 * col);
    col *= 1.20;

    gl_FragColor = vec4(col, 1.0);
}
