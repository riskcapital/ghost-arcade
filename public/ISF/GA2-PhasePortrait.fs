/*{
    "DESCRIPTION": "The phase portrait of a complex function. A handful of zeros and poles wander the plane; colour is the angle of the function's value and the dark rings are its size, doubling from one ring to the next. Colours pinwheel once around every zero and backwards around every pole, and the rings and rays cross at right angles everywhere, because the function is conformal. A symmetry control folds the plane first so the whole field repeats around the centre. Bass sends the rings travelling, beats kick the orbits, spectral centroid turns the fold.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Tropic", "Abyss", "Peach", "Chlorophyll", "Ink", "Magma", "Candy"]},
        {"NAME": "zeros",     "TYPE": "long",  "DEFAULT": 3,
         "VALUES": [1, 2, 3, 4, 5, 6], "LABELS": ["1", "2", "3", "4", "5", "6"]},
        {"NAME": "poles",     "TYPE": "long",  "DEFAULT": 2,
         "VALUES": [0, 1, 2, 3, 4, 5, 6], "LABELS": ["0", "1", "2", "3", "4", "5", "6"]},
        {"NAME": "symmetry",  "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [1, 2, 3, 4, 5, 6, 8], "LABELS": ["None", "2-fold", "3-fold", "4-fold", "5-fold", "6-fold", "8-fold"]},
        {"NAME": "orbit",     "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.05, "MAX": 1.50},
        {"NAME": "speed",     "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "zoom",      "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.30, "MAX": 3.00},
        {"NAME": "rings",     "TYPE": "float", "DEFAULT": 2.00, "MIN": 0.00, "MAX": 8.00},
        {"NAME": "rays",      "TYPE": "long",  "DEFAULT": 12,
         "VALUES": [0, 4, 6, 8, 12, 16, 24], "LABELS": ["Off", "4", "6", "8", "12", "16", "24"]},
        {"NAME": "lineWeight","TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "checker",   "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "depth",     "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "travel",    "TYPE": "float", "DEFAULT": 0.25, "MIN": -2.00, "MAX": 2.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * f(z) = product (z - a_i) / product (z - b_j)
 *
 * A rational function is fixed entirely by where it is zero and where it
 * blows up. Rather than multiply the factors out, keep the two things the
 * picture needs as running sums:
 *
 *     log|f|  = sum log|z - a_i|  - sum log|z - b_j|      (the rings)
 *     arg f   = sum arg(z - a_i)  - sum arg(z - b_j)      (the colour)
 *
 * Summing logs never overflows near a pole and never underflows near a zero,
 * which is where a direct product falls apart.
 *
 * The derivative of log f is just as cheap: sum 1/(z - a_i) - sum 1/(z - b_j).
 * Its size is how fast both the rings and the colour change per unit of
 * screen, and by the Cauchy-Riemann equations it is the same number for
 * both. That gives the true on-screen width of every ring and ray, so lines
 * stay one weight wherever they are and fade out cleanly next to a pole,
 * where infinitely many of them pile into a point.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int MAX_POINTS = 6;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cinv(vec2 a) { return vec2(a.x, -a.y) / max(dot(a, a), 1e-9); }

/* Where zero or pole number i sits. `kind` offsets poles from zeros. */
vec2 wander(float i, float kind, float t, float r) {
    float a = i * 2.39996 + kind * 1.3;
    float sp = 0.6 + 0.23 * i + kind * 0.17;
    return r * vec2(cos(a + t * sp) * (0.55 + 0.45 * sin(t * 0.37 + i * 1.9 + kind)),
                    sin(a * 1.3 + t * sp * 0.83 + kind * 2.0) * (0.50 + 0.40 * cos(t * 0.29 + i)));
}

/*
 * Palettes for this shader alone. Phase is a circle, so each palette is two
 * hues that meet at both ends, over a dark that the rings fall into.
 * Columns: [hue at angle 0, dark, hue at angle pi].
 */
mat3 paletteFor(int mode) {
    vec3 a, dark, b;
    if (mode == 1) {            /* Abyss - electric blue and sea-glass */
        a    = vec3(0.10, 0.36, 1.00);
        dark = vec3(0.004, 0.012, 0.045);
        b    = vec3(0.30, 1.00, 0.82);
    } else if (mode == 2) {     /* Peach - apricot and dusty violet */
        a    = vec3(1.00, 0.62, 0.40);
        dark = vec3(0.060, 0.022, 0.050);
        b    = vec3(0.62, 0.46, 0.92);
    } else if (mode == 3) {     /* Chlorophyll - leaf and lemon */
        a    = vec3(0.10, 0.78, 0.30);
        dark = vec3(0.006, 0.030, 0.014);
        b    = vec3(0.96, 0.98, 0.26);
    } else if (mode == 4) {     /* Ink - black line on warm paper */
        a    = vec3(0.95, 0.92, 0.85);
        dark = vec3(0.060, 0.055, 0.060);
        b    = vec3(0.74, 0.70, 0.66);
    } else if (mode == 5) {     /* Magma - crimson and yellow heat */
        a    = vec3(0.92, 0.10, 0.06);
        dark = vec3(0.030, 0.004, 0.004);
        b    = vec3(1.00, 0.80, 0.16);
    } else if (mode == 6) {     /* Candy - bubblegum and mint */
        a    = vec3(1.00, 0.36, 0.72);
        dark = vec3(0.050, 0.016, 0.060);
        b    = vec3(0.40, 1.00, 0.80);
    } else {                    /* Tropic - hot magenta and turquoise */
        a    = vec3(1.00, 0.14, 0.50);
        dark = vec3(0.020, 0.010, 0.050);
        b    = vec3(0.06, 0.86, 0.92);
    }
    return mat3(a, dark, b);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    /* Idle fallbacks so the field still moves with nothing bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    float scale = 2.4 / zoom;
    vec2 z = uv * scale;
    float pixel = scale / RENDERSIZE.y;        /* plane units per pixel */

    /* Fold: z -> z^n, turned slowly. The chain rule carries the pixel size
       through: |d(z^n)/dz| = n |z|^(n-1). */
    float n = float(symmetry);
    if (n > 1.5) {
        float r = length(z);
        float a = atan(z.y, z.x) + TIME * 0.05 + (centroid - 0.5) * 0.6;
        pixel *= n * pow(max(r, 1e-4), n - 1.0);
        z = pow(r, n) * vec2(cos(a * n), sin(a * n));
    }

    float t = TIME * speed + beat * 0.25;
    int nz = int(zeros);
    int np = int(poles);

    /* Keep f itself as a unit direction and a size, multiplied factor by
       factor, so the whole product costs one atan and one log at the end
       rather than one of each per point. Six factors stay well inside range. */
    vec2 dir = vec2(1.0, 0.0);
    float mag = 1.0;
    vec2 dlog = vec2(0.0);          /* f'/f */
    float nearZero = 1e3;
    float nearPole = 1e3;
    for (int i = 0; i < MAX_POINTS; i++) {
        float fi = float(i);
        if (i < nz) {
            vec2 d = z - wander(fi, 0.0, t, orbit);
            float l = max(length(d), 1e-4);
            dir = cmul(dir, d / l);
            mag *= l;
            dlog += cinv(d);
            nearZero = min(nearZero, l);
        }
        if (i < np) {
            vec2 d = z - wander(fi, 1.0, t, orbit * 1.15);
            float l = max(length(d), 1e-4);
            dir = cmul(dir, vec2(d.x, -d.y) / l);
            mag /= l;
            dlog -= cinv(d);
            nearPole = min(nearPole, l);
        }
    }
    float logMag = log(max(mag, 1e-30));
    float phase = atan(dir.y, dir.x);

    /* How much log f changes across one pixel. */
    float rate = length(dlog) * pixel;

    mat3 pal = paletteFor(int(colorMode));
    vec3 HUE_A = hueRotate(pal[0], hueShift);
    vec3 DARK = pal[1];
    vec3 HUE_B = hueRotate(pal[2], hueShift);
    bool ink = int(colorMode) == 4;

    /* Colour from angle: once round the circle, A to B and back. */
    float w = 0.5 + 0.5 * cos(phase);
    vec3 hue = mix(HUE_B, HUE_A, w * w * (3.0 - 2.0 * w));

    /* Rings: log2|f| sawtooth, each ring a step up a staircase. */
    float lm = logMag / 0.693147 * rings * 0.5 - TIME * travel * (0.4 + 1.2 * bass);
    float ringRate = rate / 0.693147 * rings * 0.5;
    float saw = fract(lm);
    float ringFade = 1.0 - smoothstep(0.25, 0.9, ringRate);
    /* Shade each step from dark at its foot to bright at its lip. */
    float stair = mix(0.5, saw, ringFade * step(0.01, rings));
    float shade = mix(1.0, 0.42 + 0.72 * stair, depth);

    /* Lines where the staircase steps, and along the rays of equal angle. */
    float lw = 0.6 + 2.2 * lineWeight;
    float ringLine = (1.0 - smoothstep(0.0, ringRate * lw, min(saw, 1.0 - saw))) * ringFade * step(0.01, rings);
    float nr = float(rays);
    float rayPhase = phase / TAU * nr;
    float rayRate = rate / TAU * nr;
    float rsaw = fract(rayPhase);
    float rayFade = (1.0 - smoothstep(0.25, 0.9, rayRate)) * step(0.5, nr);
    float rayLine = (1.0 - smoothstep(0.0, rayRate * lw, min(rsaw, 1.0 - rsaw))) * rayFade;
    float lines = max(ringLine, rayLine * 0.8) * step(0.001, lineWeight);

    /* Conformal checkerboard: alternate the cells the rings and rays cut. */
    float cellParity = mod(floor(lm) + floor(rayPhase), 2.0);
    float check = mix(1.0, 0.45 + 0.55 * cellParity, checker * ringFade * rayFade);

    vec3 col;
    if (ink) {
        /* Ink: paper, tone from the staircase, black line work. */
        col = mix(HUE_B, HUE_A, 0.35 + 0.65 * stair) * check;
        col = mix(col, DARK, lines * 0.92);
    } else {
        col = DARK + hue * shade * check * (0.78 + 0.35 * level);
        col = mix(col, mix(hue, vec3(1.0), 0.55) * 1.15, lines * (0.35 + 0.5 * lineWeight));
    }

    /* Zeros sink to the dark; poles burn through to white. */
    float sink = exp(-nearZero * nearZero / (0.0030 * scale * scale));
    float burn = exp(-nearPole * nearPole / (0.0016 * scale * scale));
    if (ink) {
        col = mix(col, DARK, sink * 0.85);
        col = mix(col, HUE_A, burn);
    } else {
        col = mix(col, DARK, sink * 0.9);
        col += mix(hue, vec3(1.0), 0.75) * burn * (0.9 + 0.9 * bass);
    }

    col *= 1.0 + beat * 0.16;
    col *= exposure;
    if (!ink) {
        col = col / (1.0 + 0.25 * col);
        col *= 1.25;
    }

    gl_FragColor = vec4(col, 1.0);
}
