/*{
    "DESCRIPTION": "Coloured shadows. Red, green and blue lamps circle a floor of columns. Together they light the floor white; wherever a column blocks one lamp, the other two fill its shadow with their mix, so every column throws a fan of cyan, magenta and yellow shadows, and where two shadows cross only one lamp is left. The shadows are exact, not marched: each is the true silhouette of a round column from a round lamp, soft where the lamp is wide. Bass brightens the lamps, beats kick their orbit, spectral centroid widens it.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Primaries", "Sodium", "Gallery", "Neon Sign", "Dusk", "Infrared", "Moonlight"]},
        {"NAME": "arrangement",    "TYPE": "long",  "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3], "LABELS": ["Ring", "Two rings", "Spiral", "Grid"]},
        {"NAME": "columns",   "TYPE": "long",  "DEFAULT": 9,
         "VALUES": [1, 3, 5, 7, 9, 12, 16], "LABELS": ["1", "3", "5", "7", "9", "12", "16"]},
        {"NAME": "columnSize","TYPE": "float", "DEFAULT": 0.045, "MIN": 0.010, "MAX": 0.140},
        {"NAME": "spread",    "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.08, "MAX": 0.60},
        {"NAME": "turn",      "TYPE": "float", "DEFAULT": 0.10, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "lamps",     "TYPE": "long",  "DEFAULT": 3,
         "VALUES": [1, 2, 3, 4], "LABELS": ["1", "2", "3", "4"]},
        {"NAME": "lampOrbit", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.00, "MAX": 0.70},
        {"NAME": "lampSpeed", "TYPE": "float", "DEFAULT": 0.35, "MIN": -2.00, "MAX": 2.00},
        {"NAME": "lampSize",  "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "falloff",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "domes",     "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "floorTone", "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Additive light, subtractive shadow.
 *
 * Three lamps in the additive primaries sum to white on an open floor. A
 * column in front of the red lamp removes red from the floor behind it and
 * leaves green + blue = cyan. So each column casts one shadow per lamp, each
 * in the complement of the lamp it hides: cyan, magenta, yellow. Where two of
 * those overlap, two lamps are hidden and the floor shows the one primary
 * that is left. Nothing here is painted; the colours fall out of adding up
 * whichever lamps can see the pixel.
 *
 * Seen from above, a column is a disc, and the shadow of a disc from a point
 * is solved exactly with no marching. For a floor point p, lamp L and column
 * centre C: walk from p toward L, find the closest approach to C, and the
 * point is shadowed when that distance is less than the column's radius and
 * the approach lies between p and L. A lamp with real width gives a penumbra
 * whose size is the lamp radius scaled by (floor-to-column) / (column-to-lamp),
 * which is why shadows are razor sharp at the foot of a column and feather
 * out with distance, exactly as they do under a real lamp.
 *
 * Cost is lamps x columns cheap tests per pixel, at most 64.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int MAX_COLUMNS = 16;
const int MAX_LAMPS = 4;
const float GOLDEN = 2.39996323;

/*
 * Palettes for this shader alone: three lamp colours each. They are chosen
 * so the three still sum to something close to white, or deliberately do not.
 * Columns: [lamp 1, lamp 2, lamp 3].
 */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Sodium - street amber against cold LED */
        a = vec3(1.00, 0.55, 0.08);
        b = vec3(0.10, 0.42, 1.00);
        c = vec3(0.92, 0.94, 1.00) * 0.55;
    } else if (mode == 2) {     /* Gallery - warm, neutral and cool whites */
        a = vec3(1.00, 0.78, 0.56);
        b = vec3(0.62, 0.80, 1.00);
        c = vec3(0.96, 0.92, 0.98) * 0.6;
    } else if (mode == 3) {     /* Neon Sign - pink, cyan, violet */
        a = vec3(1.00, 0.10, 0.52);
        b = vec3(0.04, 0.92, 1.00);
        c = vec3(0.50, 0.16, 1.00);
    } else if (mode == 4) {     /* Dusk - ember, rose, deep blue */
        a = vec3(1.00, 0.40, 0.10);
        b = vec3(0.92, 0.20, 0.44);
        c = vec3(0.14, 0.26, 0.92);
    } else if (mode == 5) {     /* Infrared - red, orange, a breath of magenta */
        a = vec3(1.00, 0.06, 0.04);
        b = vec3(1.00, 0.46, 0.04);
        c = vec3(0.80, 0.06, 0.40);
    } else if (mode == 6) {     /* Moonlight - silver and two blues */
        a = vec3(0.80, 0.86, 1.00);
        b = vec3(0.22, 0.42, 0.90);
        c = vec3(0.34, 0.74, 0.86) * 0.7;
    } else {                    /* Primaries - red, green, blue */
        a = vec3(1.00, 0.06, 0.04);
        b = vec3(0.04, 1.00, 0.10);
        c = vec3(0.06, 0.12, 1.00);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

/* Where column i stands. */
vec2 columnAt(int i, int n, int mode, float spreadR, float rot) {
    float fi = float(i);
    float fn = float(n);
    vec2 p;
    if (mode == 1) {            /* two counter-turning rings */
        float inner = floor(fn * 0.4);
        if (fi < inner) {
            float a = TAU * fi / max(inner, 1.0) - rot * 1.6;
            p = 0.48 * spreadR * vec2(cos(a), sin(a));
        } else {
            float a = TAU * (fi - inner) / max(fn - inner, 1.0) + rot;
            p = spreadR * vec2(cos(a), sin(a));
        }
    } else if (mode == 2) {     /* sunflower spiral */
        float a = fi * GOLDEN + rot;
        p = spreadR * 1.15 * sqrt((fi + 0.5) / fn) * vec2(cos(a), sin(a));
    } else if (mode == 3) {     /* square grid, turned as a whole */
        float side = ceil(sqrt(fn));
        vec2 g = vec2(mod(fi, side), floor(fi / side)) - 0.5 * (side - 1.0);
        g *= 2.0 * spreadR / max(side - 1.0, 1.0);
        p = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * g;
    } else {                    /* single ring */
        float a = TAU * fi / fn + rot;
        p = spreadR * vec2(cos(a), sin(a));
    }
    return p;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;

    /* Idle fallbacks so the lamps still move with nothing bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.22));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.18));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int n = int(columns);
    int nl = int(lamps);
    int mode = int(arrangement);
    float rot = TIME * turn * 0.4;
    float cr = columnSize;
    float lampR = 0.004 + 0.05 * lampSize;

    mat3 pal = paletteFor(int(colorMode));

    /* Is this pixel on top of a column? Find the nearest one. */
    float nearest = 1e3;
    vec2 nearC = vec2(0.0);
    for (int i = 0; i < MAX_COLUMNS; i++) {
        if (i >= n) break;
        vec2 c = columnAt(i, n, mode, spread, rot);
        float d = length(uv - c);
        if (d < nearest) { nearest = d; nearC = c; }
    }
    float onColumn = 1.0 - smoothstep(cr - px, cr + px, nearest);

    vec3 floorLight = vec3(0.0);
    vec3 domeLight = vec3(0.0);
    vec3 lampGlow = vec3(0.0);
    vec2 rel = (uv - nearC) / cr;
    /* The cap is shaded as a shallow dome so it reads as a solid. */
    vec3 nrm = normalize(vec3(rel * domes, sqrt(max(1.0 - dot(rel, rel) * domes * domes, 0.02))));

    for (int j = 0; j < MAX_LAMPS; j++) {
        if (j >= nl) break;
        float fj = float(j);
        /* Lamps share one slow orbit about the centre, evenly spaced, each
           with its own small wobble so their shadows never lock together. */
        float la = TIME * lampSpeed * (0.5 + 0.13 * fj) + TAU * fj / float(nl) + beat * 0.35;
        float lr = lampOrbit * (0.75 + 0.5 * centroid) * (1.0 + 0.18 * sin(TIME * 0.31 + fj * 2.1));
        vec2 L = lr * vec2(cos(la), sin(la));
        vec3 lcol = j == 0 ? pal[0] : j == 1 ? pal[1] : j == 2 ? pal[2] : (pal[0] + pal[1] + pal[2]) * 0.34;
        lcol = hueRotate(lcol, hueShift);

        vec2 v = L - uv;
        float D = length(v);
        vec2 u = v / max(D, 1e-5);

        /* Shadow from every column, multiplied: any one of them blocks. */
        float lit = 1.0;
        for (int i = 0; i < MAX_COLUMNS; i++) {
            if (i >= n) break;
            vec2 c = columnAt(i, n, mode, spread, rot);
            vec2 w = c - uv;
            float along = dot(w, u);
            float perp = abs(w.x * u.y - w.y * u.x);
            /* Penumbra grows with distance behind the column. */
            float pen = lampR * max(along, 0.0) / max(D - along, 0.02) + px;
            float s = smoothstep(cr - pen, cr + pen, perp);
            /* Only columns between the pixel and the lamp count. */
            float between = smoothstep(0.0, cr * 0.5, along) * smoothstep(0.0, cr * 0.5, D - along);
            lit *= mix(1.0, s, between);
        }

        float atten = 1.0 / (1.0 + falloff * 9.0 * D * D);
        float power = 0.78 + 0.5 * bass;
        floorLight += lcol * lit * atten * power;

        /* Dome shading: lit from the lamp's side, plus a tight highlight. */
        vec3 toL = normalize(vec3(L - nearC, 0.22));
        float nl2 = max(dot(nrm, toL), 0.0);
        vec3 h = normalize(toL + vec3(0.0, 0.0, 1.0));
        domeLight += lcol * (nl2 * 0.9 + pow(max(dot(nrm, h), 0.0), 40.0) * 0.8) * power;

        /* The lamp itself. */
        lampGlow += lcol * (lampR * lampR * 0.5 / (D * D + lampR * lampR * 0.25)) + lcol * 0.004 / (D + 0.004);
    }

    /* A stone floor: fine grain so the light has something to land on. */
    float grain = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
    vec3 floorCol = vec3(floorTone) * (0.965 + 0.07 * grain);
    vec3 col = floorCol * floorLight;

    /* Contact shadow at the foot of each column grounds it on the floor. */
    float foot = smoothstep(cr * 1.9, cr, nearest);
    col *= 1.0 - 0.35 * foot * (1.0 - onColumn);

    vec3 cap = vec3(0.06) + vec3(floorTone) * domeLight * 0.75;
    col = mix(col, cap, onColumn);
    col += lampGlow * (1.0 - onColumn) * (0.8 + 0.6 * level);

    col *= 1.0 + beat * 0.12;
    col *= exposure;
    col = col / (1.0 + 0.28 * col);
    col *= 1.28;

    gl_FragColor = vec4(col, 1.0);
}
