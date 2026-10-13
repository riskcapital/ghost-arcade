/*{
    "DESCRIPTION": "A colour wash. Soft pools of light from a row of wash fixtures overlap across the stage and blend where they meet, the way a bank of PARs or LED washes does. Choose how many zones, how soft the joins are, where the light falls from, and how the colours move: hold, chase, ping-pong, crossfade or a random shuffle. This is the one to leave on behind everything else: it lights the whole band evenly and never goes dark unless you ask it to. Bass lifts the level, beats bump it, spectral centroid slides the colours.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Club", "Theatre", "Deep Sea", "Fire", "Pastel", "Acid", "Tungsten"]},
        {"NAME": "colorPattern", "TYPE": "long", "DEFAULT": 2,
         "VALUES": [0, 1, 2, 3, 4, 5],
         "LABELS": ["One colour", "Alternate", "Three-way", "Spread across stage", "Rainbow", "Split left and right"]},
        {"NAME": "motion",    "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [0, 1, 2, 3, 4],
         "LABELS": ["Hold", "Chase", "Ping-pong", "Crossfade all", "Shuffle"]},
        {"NAME": "zones",     "TYPE": "long",  "DEFAULT": 6,
         "VALUES": [1, 2, 3, 4, 5, 6, 8, 10, 12], "LABELS": ["1", "2", "3", "4", "5", "6", "8", "10", "12"]},
        {"NAME": "speed",     "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 3.00},
        {"NAME": "softness",  "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.05, "MAX": 1.50},
        {"NAME": "source",    "TYPE": "long",  "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3], "LABELS": ["From above", "From below", "Both", "Flat"]},
        {"NAME": "falloff",   "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "poolShape", "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "sway",      "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "dimmerWave","TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "saturation","TYPE": "float", "DEFAULT": 1.00, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "haze",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hazeDrift", "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "level",     "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * A wash is many wide lights whose pools overlap. Each zone here is one
 * light: a soft lobe across the stage, summed with its neighbours and then
 * normalised, so the stage stays evenly lit however soft or hard the joins
 * are set. Colour is mixed in light, not paint: the lobes add.
 */

const float TAU = 6.28318530718;
const int MAX_ZONES = 12;

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

/* Gel sets for a wash. Columns: three colours that sit well side by side. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Theatre - lavender, straw, steel */
        a = vec3(0.62, 0.50, 1.00);
        b = vec3(1.00, 0.84, 0.50);
        c = vec3(0.44, 0.68, 0.92);
    } else if (mode == 2) {     /* Deep Sea */
        a = vec3(0.04, 0.24, 1.00);
        b = vec3(0.04, 0.80, 0.80);
        c = vec3(0.26, 0.10, 0.86);
    } else if (mode == 3) {     /* Fire */
        a = vec3(1.00, 0.10, 0.04);
        b = vec3(1.00, 0.50, 0.04);
        c = vec3(1.00, 0.82, 0.24);
    } else if (mode == 4) {     /* Pastel */
        a = vec3(1.00, 0.70, 0.80);
        b = vec3(0.70, 0.90, 1.00);
        c = vec3(0.86, 1.00, 0.78);
    } else if (mode == 5) {     /* Acid */
        a = vec3(0.60, 1.00, 0.04);
        b = vec3(1.00, 0.06, 0.80);
        c = vec3(0.04, 1.00, 0.86);
    } else if (mode == 6) {     /* Tungsten - dim, warm, hot */
        a = vec3(1.00, 0.62, 0.30);
        b = vec3(1.00, 0.80, 0.56);
        c = vec3(1.00, 0.46, 0.16);
    } else {                    /* Club - red, blue, magenta */
        a = vec3(1.00, 0.06, 0.10);
        b = vec3(0.08, 0.20, 1.00);
        c = vec3(0.90, 0.08, 0.90);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

vec3 cycle3(mat3 pal, float x) {
    float k = mod(x, 3.0);
    float f = smoothstep(0.30, 0.70, fract(k));
    vec3 from = k < 1.0 ? pal[0] : k < 2.0 ? pal[1] : pal[2];
    vec3 to   = k < 1.0 ? pal[1] : k < 2.0 ? pal[2] : pal[0];
    return mix(from, to, f);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;
    float xn = uv.x / aspect + 0.5;            /* 0 .. 1 across the stage */

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.20));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.11));
    float beat = audioBeat;

    int n = int(zones);
    float count = float(n);
    int pattern = int(colorPattern);
    int move = int(motion);
    float t = TIME * speed;
    mat3 pal = paletteFor(int(colorMode));

    /* How far the colours have travelled along the row. */
    float shift = 0.0;
    if (move == 1) shift = t * 1.2;
    else if (move == 2) shift = (count * 0.5) * sin(t * 0.9);
    shift += (centroid - 0.5) * 0.8;

    vec3 sum = vec3(0.0);
    float weight = 0.0;
    float width = (0.35 + 1.6 * softness) / count;
    for (int i = 0; i < MAX_ZONES; i++) {
        if (i >= n) break;
        float fi = float(i);
        float cx = (fi + 0.5) / count + sway * 0.25 / count * sin(TIME * 0.6 + fi * 1.7);
        float d = (xn - cx) / width;
        float lobe = exp(-d * d);

        /* Which gel this zone is showing right now. */
        float k = fi + shift;
        vec3 gel;
        if (pattern == 0)      gel = pal[0];
        else if (pattern == 1) gel = mix(pal[0], pal[1], smoothstep(0.35, 0.65, abs(mod(k, 2.0) - 1.0)));
        else if (pattern == 2) gel = cycle3(pal, k);
        else if (pattern == 3) gel = cycle3(pal, (fi / max(count - 1.0, 1.0)) * 1.999 + shift * 0.35);
        else if (pattern == 4) gel = hueRotate(vec3(1.0, 0.10, 0.08), fi / count + shift * 0.12);
        else                   gel = mix(pal[0], pal[1], smoothstep(0.42, 0.58, fract(cx + shift * 0.05)));
        if (move == 3) gel = mix(gel, cycle3(pal, k + 1.0 + floor(t)), smoothstep(0.2, 0.8, fract(t)));
        if (move == 4) {
            float slot = floor(t * 0.8 + hash11(fi) * 3.0);
            float f = smoothstep(0.55, 1.0, fract(t * 0.8 + hash11(fi) * 3.0));
            gel = mix(cycle3(pal, floor(hash11(fi * 7.0 + slot) * 3.0)), cycle3(pal, floor(hash11(fi * 7.0 + slot + 1.0) * 3.0)), f);
        }

        /* Each light breathes on its own a little. */
        float dim = 1.0 - dimmerWave * (0.5 + 0.5 * sin(TIME * (0.7 + 0.3 * hash11(fi + 4.0)) + fi * 2.4));
        sum += gel * lobe * dim;
        weight += lobe;
    }
    /* Even coverage however the joins are set; hard joins keep their dips. */
    vec3 col = sum / max(mix(weight, 1.0, 0.25), 0.2);

    /* Saturation, in light: pull toward or away from the grey of equal power. */
    float grey = dot(col, vec3(0.3333));
    col = max(mix(vec3(grey), col, saturation), 0.0);
    col = hueRotate(col, hueShift);

    /* Where the light falls from. */
    float yn = uv.y + 0.5;                      /* 0 bottom .. 1 top */
    int src = int(source);
    float fromTop = exp(-(1.0 - yn) * falloff * 2.6);
    float fromBottom = exp(-yn * falloff * 2.6);
    float vertical = src == 0 ? fromTop : src == 1 ? fromBottom : src == 2 ? max(fromTop, fromBottom) : 1.0;
    /* Scalloped pools at the far end of the throw. */
    float scallop = 0.5 + 0.5 * cos((xn * count - 0.5) * TAU);
    float far = src == 1 ? yn : 1.0 - yn;
    vertical *= mix(1.0, 0.55 + 0.45 * scallop, poolShape * smoothstep(0.45, 1.0, far) * step(float(src), 2.5));

    /* Haze: slow uneven air in front of the lights. */
    vec2 hp = uv * vec2(1.6, 2.4) + vec2(TIME * hazeDrift * 0.07, TIME * hazeDrift * 0.03);
    float wisps = noise2(hp) * 0.6 + noise2(hp * 2.3 + 7.0) * 0.4;
    float air = mix(1.0, 0.55 + 0.9 * wisps, haze);

    col *= vertical * air * level * (0.80 + 0.45 * bass) * (1.0 + beat * 0.22);
    col *= exposure;
    col = col / (1.0 + 0.20 * col);
    col *= 1.20;

    gl_FragColor = vec4(col, 1.0);
}
