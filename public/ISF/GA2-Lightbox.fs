/*{
    "DESCRIPTION": "A paper-cut lightbox. Sheets of cut paper stand one behind another in front of a lamp. Each sheet lets a little light through, so the picture is brightest where the paper is one sheet deep and falls to shadow where many overlap. That is the whole shading model, and it is why the layers read as real paper. Five cuts: mountains, dunes, waves, a skyline and a forest canopy. Each sheet drifts at its own speed, casts a soft shadow on the one behind and catches light on its cut edge. Bass swells the lamp, beats pulse it, spectral centroid lifts the sun.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Lantern", "Midnight", "Blossom", "Moss", "Glacier", "Furnace", "Vellum"]},
        {"NAME": "cut",       "TYPE": "long",  "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Mountains", "Dunes", "Waves", "Skyline", "Canopy"]},
        {"NAME": "sheets",    "TYPE": "long",  "DEFAULT": 7,
         "VALUES": [3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["3", "4", "5", "6", "7", "8", "9", "10"]},
        {"NAME": "relief",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.05, "MAX": 1.20},
        {"NAME": "detail",    "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "horizon",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "drift",     "TYPE": "float", "DEFAULT": 0.25, "MIN": -1.50, "MAX": 1.50},
        {"NAME": "translucency","TYPE": "float", "DEFAULT": 0.74, "MIN": 0.20, "MAX": 0.92},
        {"NAME": "sunX",      "TYPE": "float", "DEFAULT": 0.62, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "sunY",      "TYPE": "float", "DEFAULT": 0.62, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "sunSize",   "TYPE": "float", "DEFAULT": 0.11, "MIN": 0.00, "MAX": 0.40},
        {"NAME": "lampGlow",  "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "shadow",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "edgeLight", "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "paperGrain","TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * How a lightbox makes its picture.
 *
 * Paper is not opaque. A sheet passes a fixed fraction of the light behind
 * it and tints what it passes. Stack k sheets and the light is cut by that
 * fraction k times over. So the brightness at any point is
 *
 *     lamp(p) * transmission ^ (number of sheets covering p)
 *
 * and nothing else is needed for the picture to read as depth: far ridges are
 * one sheet deep and glow, near ridges have every sheet behind them and are
 * dark. The warm shift toward the front comes for free, because each sheet
 * absorbs a little more blue than red.
 *
 * Each sheet is a single height profile, so a pixel costs one profile lookup
 * per sheet, plus one more a short way across for the shadow that the sheet
 * throws on the one behind it.
 */

const float TAU = 6.28318530718;
const int MAX_SHEETS = 10;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
}

/* The cut edge of one sheet: height above its baseline at position x. */
float profile(float x, int style, float seed, float fine) {
    float h;
    if (style == 1) {           /* Dunes: long, smooth, leaning crests */
        h = 0.55 * noise1(x * 0.9 + seed) + 0.30 * (0.5 + 0.5 * sin(x * 1.7 + seed * 3.0 + sin(x * 0.6)))
          + 0.15 * fine * noise1(x * 3.1 + seed * 2.0);
    } else if (style == 2) {    /* Waves: cusped crests, rolling */
        float a = abs(sin(x * 1.3 + seed * 2.0));
        float b = abs(sin(x * 2.9 + seed * 5.0 + 1.0));
        h = 0.62 * (1.0 - a * a) + 0.26 * (1.0 - b) * (0.4 + 0.6 * fine) + 0.12 * noise1(x * 0.7 + seed);
    } else if (style == 3) {    /* Skyline: flat-topped blocks with setbacks */
        float wide = floor(x * 2.2 + seed * 7.0);
        float narrow = floor(x * 6.5 + seed * 13.0);
        float tall = hash11(wide + seed * 31.0);
        float step2 = hash11(narrow + seed * 17.0);
        h = 0.20 + 0.62 * tall * tall + 0.18 * fine * step(0.55, step2) * step2;
    } else if (style == 4) {    /* Canopy: crowns of trees, rounded and overlapping */
        float cellW = 0.62;
        float c0 = floor(x / cellW + seed * 3.0);
        float best = 0.0;
        for (int k = -1; k <= 1; k++) {
            float c = c0 + float(k);
            float cx = (c - seed * 3.0 + 0.5 + 0.5 * (hash11(c + seed * 5.0) - 0.5)) * cellW;
            float rad = cellW * (0.55 + 0.45 * hash11(c + seed * 11.0));
            float d = (x - cx) / rad;
            best = max(best, sqrt(max(1.0 - d * d, 0.0)) * (0.55 + 0.45 * hash11(c + seed * 23.0)));
        }
        h = best * 0.86 + 0.14 * fine * noise1(x * 9.0 + seed);
    } else {                    /* Mountains: ridged, sharp */
        float r1 = 1.0 - abs(2.0 * noise1(x * 0.85 + seed) - 1.0);
        float r2 = 1.0 - abs(2.0 * noise1(x * 2.3 + seed * 3.0) - 1.0);
        float r3 = 1.0 - abs(2.0 * noise1(x * 6.1 + seed * 7.0) - 1.0);
        h = 0.62 * r1 * r1 + 0.26 * r2 * (0.4 + 0.6 * fine) + 0.12 * r3 * fine;
    }
    return h;
}

/*
 * Palettes for this shader alone. Columns: [lamp, paper tint, sky edge].
 * `lamp` is the light at the centre of the box, `sky edge` what it falls to
 * at the corners, and `paper tint` the colour a single sheet passes.
 */
mat3 paletteFor(int mode) {
    vec3 lamp, paper, sky;
    if (mode == 1) {            /* Midnight - moonlit blue paper */
        lamp  = vec3(0.86, 0.94, 1.00);
        paper = vec3(0.34, 0.50, 0.86);
        sky   = vec3(0.10, 0.20, 0.52);
    } else if (mode == 2) {     /* Blossom - rose and plum */
        lamp  = vec3(1.00, 0.92, 0.88);
        paper = vec3(0.92, 0.42, 0.60);
        sky   = vec3(0.84, 0.36, 0.52);
    } else if (mode == 3) {     /* Moss - spring green through leaf */
        lamp  = vec3(0.98, 1.00, 0.80);
        paper = vec3(0.46, 0.72, 0.34);
        sky   = vec3(0.50, 0.74, 0.40);
    } else if (mode == 4) {     /* Glacier - ice and slate */
        lamp  = vec3(0.96, 1.00, 1.00);
        paper = vec3(0.56, 0.74, 0.84);
        sky   = vec3(0.50, 0.70, 0.84);
    } else if (mode == 5) {     /* Furnace - white heat into deep red */
        lamp  = vec3(1.00, 0.94, 0.70);
        paper = vec3(0.92, 0.26, 0.10);
        sky   = vec3(0.96, 0.40, 0.08);
    } else if (mode == 6) {     /* Vellum - undyed paper, grey shadows */
        lamp  = vec3(1.00, 0.98, 0.94);
        paper = vec3(0.70, 0.68, 0.64);
        sky   = vec3(0.80, 0.78, 0.74);
    } else {                    /* Lantern - candle amber */
        lamp  = vec3(1.00, 0.90, 0.62);
        paper = vec3(0.90, 0.52, 0.22);
        sky   = vec3(0.94, 0.58, 0.20);
    }
    return mat3(lamp, paper, sky);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;     /* y: -0.5 bottom .. 0.5 top */
    float px = 1.0 / res.y;
    float aspect = res.x / res.y;

    /* Idle fallbacks so the lamp still breathes with nothing bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.20));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.16));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.10));
    float beat = audioBeat;

    int n = int(sheets);
    int style = int(cut);

    mat3 pal = paletteFor(int(colorMode));
    vec3 LAMP = hueRotate(pal[0], hueShift);
    vec3 PAPER = hueRotate(pal[1], hueShift);
    vec3 SKY = hueRotate(pal[2], hueShift);

    /* The lamp: a disc with a wide halo, in a box that dims to its corners. */
    vec2 sun = vec2((sunX - 0.5) * aspect, (sunY - 0.5) + (centroid - 0.5) * 0.06);
    float sd = length(uv - sun);
    float disc = 1.0 - smoothstep(sunSize - px, sunSize + px, sd);
    float halo = exp(-sd * sd / (0.05 + 0.22 * lampGlow));
    float pulse = 0.82 + 0.45 * bass + 0.22 * beat;
    vec3 back = SKY * (0.30 + 0.34 * (uv.y + 0.5)) + mix(SKY, LAMP, 0.7) * halo * (0.60 + 0.80 * lampGlow) * pulse;
    back += LAMP * disc * 1.15 * pulse * step(0.001, sunSize);

    /* Light is thrown down-right of the lamp, so shadows fall up-left of an
       edge when the lamp is behind and above. */
    vec2 throwDir = normalize(uv - sun + vec2(0.0001));
    vec2 so = throwDir * (0.006 + 0.022 * shadow);

    float covered = 0.0;      /* how many sheets lie over this pixel */
    float castShadow = 0.0;   /* shadow from a nearer sheet on the top one here */
    float rim = 0.0;          /* light caught on the top sheet's cut edge */
    float topIndex = -1.0;

    for (int i = 0; i < MAX_SHEETS; i++) {
        if (i >= n) break;
        float fi = float(i);
        float t = fi / float(n - 1);                    /* 0 = far, 1 = near */
        /* Far sheets are smaller, slower and sit higher. */
        float scale = mix(2.6, 1.0, t);
        float seed = fi * 7.31 + 1.7;
        float scroll = TIME * drift * mix(0.03, 0.22, t * t);
        float base = mix(0.16, -0.46, t) + (horizon - 0.5) * 0.5;
        float amp = relief * mix(0.20, 0.36, t);

        float x = uv.x * scale + scroll;
        float edgeY = base + amp * profile(x, style, seed, detail);
        float d = edgeY - uv.y;                          /* > 0: under this sheet */
        float cover = smoothstep(-px, px, d);

        /* The same edge, seen from where its shadow lands. */
        float xs = (uv.x - so.x) * scale + scroll;
        float shadowY = base + amp * profile(xs, style, seed, detail) + so.y;
        float inShadow = smoothstep(-0.012, 0.004, shadowY - uv.y) * (1.0 - cover);

        /* A nearer sheet resets what the eye sees here; otherwise it can
           only add its shadow to whatever is already on top. */
        castShadow = mix(max(castShadow, inShadow), 0.0, cover);
        rim = mix(rim, exp(-max(d, 0.0) * (220.0 - 150.0 * edgeLight)), cover);
        topIndex = mix(topIndex, fi, cover);
        covered += cover;
    }

    /* Transmission: each sheet passes `translucency` of the light, tinted. */
    vec3 pass = mix(vec3(1.0), PAPER, 0.62) * translucency;
    vec3 col = back * pow(pass, vec3(covered));

    /* A little front light so the nearest sheets are paper and not a hole. */
    float onPaper = step(0.5, covered);
    float grain = fract(sin(dot(floor(gl_FragCoord.xy * 0.75) + topIndex * 19.0, vec2(12.9898, 78.233))) * 43758.5453);
    float fibre = 1.0 + (grain - 0.5) * 0.34 * paperGrain * onPaper;
    col += mix(PAPER, LAMP, 0.25) * (0.035 + 0.012 * covered) * onPaper;
    col *= fibre;

    /* Shadow of the sheet in front, and light on the cut edge. */
    col *= 1.0 - 0.55 * shadow * castShadow;
    col += mix(LAMP, PAPER, 0.35) * rim * edgeLight * 0.55 * (0.6 + 0.6 * level) * onPaper * halo;
    col += LAMP * rim * edgeLight * 0.22 * onPaper;

    /* The box itself: darker toward the frame. */
    col *= 1.0 - 0.34 * dot(uv, uv);

    col *= exposure;
    col = col / (1.0 + 0.25 * col);
    col *= 1.25;

    gl_FragColor = vec4(col, 1.0);
}
