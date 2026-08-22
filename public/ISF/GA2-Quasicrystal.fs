/*{
    "DESCRIPTION": "Aperiodic quasicrystal built from superposed plane waves. Five wave directions at equal angular spacing give ten-fold rotational symmetry, which no periodic crystal can have, so the pattern never repeats however far it runs. The sum of cosines has an exact analytic gradient, so the relief is lit and the contours are antialiased from real derivatives rather than finite differences. Bass drives relief depth, beats jump the phase, spectral centroid counter-rotates the second lattice.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Riso", "Blueprint", "GoldLeaf", "Cinnabar", "Phosphor", "Bauhaus", "Platinum"]},
        {"NAME": "waves",     "TYPE": "long",  "DEFAULT": 5,
         "VALUES": [3, 4, 5, 6, 7], "LABELS": ["6-fold", "8-fold", "10-fold", "12-fold", "14-fold"]},
        {"NAME": "scale",     "TYPE": "float", "DEFAULT": 22.0, "MIN": 4.00, "MAX": 40.0},
        {"NAME": "relief",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "secondary", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "contours",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "drift",     "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Quasicrystals by plane-wave superposition.
 *
 * Sum N cosine plane waves whose directions are spaced evenly over 180 degrees:
 *
 *     h(p) = sum_i cos( k_i . p + phase ),   k_i = (cos(pi i/N), sin(pi i/N))
 *
 * For N = 5 the result has ten-fold rotational symmetry. The crystallographic
 * restriction theorem says a periodic lattice can only have 2, 3, 4 or 6-fold
 * symmetry, so ten-fold forces the pattern to be APERIODIC: it is ordered and
 * self-similar everywhere yet never repeats, however far it is extended. That
 * is the whole point of the piece, and it is why N = 5 and N = 7 look
 * fundamentally different from N = 3 and N = 6, which are ordinary lattices.
 *
 * Two payoffs from the field being a sum of cosines rather than noise:
 *
 *   1. Exact gradient. d/dp sum cos(k.p + ph) = -sum k sin(k.p + ph), which
 *      costs the sin that the cos already needed. So the relief is lit from a
 *      true analytic normal, not a finite difference -- no extra field
 *      evaluations, and no stair-stepping where the slope is steep.
 *
 *   2. Exact antialiasing. Knowing |grad h| gives the on-screen rate of change
 *      of the field, so contour width can be specified in pixels directly.
 *      That is what fwidth() estimates by differencing neighbours; here the
 *      real number is already in hand, which matters because these contours
 *      get arbitrarily dense toward high scale and a guessed width aliases
 *      into moire long before the true one does.
 *
 * A second lattice at an incommensurate scale and counter-rotation is layered
 * over the first. Two quasiperiodic fields at an irrational ratio never come
 * back into phase, so the interference between them also never repeats.
 */

const float PI = 3.14159265359;
const float PI2 = 6.28318530718;
const int MAX_WAVES = 7;

/*
 * The quasicrystal field and its exact gradient in one pass.
 * `dir` rotates the whole basis; `phase` slides every wave together.
 */
float quasiField(vec2 p, int n, float phase, float dir, out vec2 grad) {
    float sum = 0.0;
    vec2 g = vec2(0.0);
    for (int i = 0; i < MAX_WAVES; i++) {
        if (i >= n) break;
        float a = PI * float(i) / float(n) + dir;
        vec2 k = vec2(cos(a), sin(a));
        float arg = dot(k, p) + phase;
        sum += cos(arg);
        g += -k * sin(arg);     /* d/dp cos(k.p) = -k sin(k.p) */
    }
    /* Normalise by wave count so changing N does not change contrast. */
    float inv = 1.0 / float(n);
    grad = g * inv;
    return sum * inv;
}

/*
 * Palettes for this shader alone -- the pack does not share a colour set.
 *
 * A flat field reads like print rather than like a lit object, so these are ink
 * pairings over a paper or lacquer ground. Crucially the two inks are returned
 * SEPARATELY and selected between, never averaged: mixing fluoro pink with blue
 * gives lavender, which is exactly the muddy result a real duotone avoids by
 * keeping the plates apart. The second lattice does the selecting, so the ink
 * boundary is itself quasiperiodic.
 *
 * Columns: [inkA, ground, inkB].
 */
mat3 paletteFor(int mode) {
    vec3 a, ground, b;
    if (mode == 1) {            /* Blueprint - cyanotype, two exposures */
        a      = vec3(0.24, 0.62, 1.00);
        ground = vec3(0.020, 0.055, 0.130);
        b      = vec3(0.78, 0.94, 1.00);
    } else if (mode == 2) {     /* GoldLeaf - gilt and copper on near-black */
        a      = vec3(1.00, 0.78, 0.24);
        ground = vec3(0.030, 0.026, 0.020);
        b      = vec3(0.85, 0.38, 0.12);
    } else if (mode == 3) {     /* Cinnabar - vermilion and bone on lacquer */
        a      = vec3(0.94, 0.16, 0.10);
        ground = vec3(0.055, 0.018, 0.016);
        b      = vec3(0.98, 0.86, 0.70);
    } else if (mode == 4) {     /* Phosphor - CRT green and amber */
        a      = vec3(0.14, 1.00, 0.38);
        ground = vec3(0.010, 0.030, 0.016);
        b      = vec3(1.00, 0.78, 0.20);
    } else if (mode == 5) {     /* Bauhaus - primaries on paper */
        a      = vec3(0.90, 0.14, 0.12);
        ground = vec3(0.93, 0.89, 0.81);
        b      = vec3(0.13, 0.30, 0.86);
    } else if (mode == 6) {     /* Platinum - cool greys, high key */
        a      = vec3(0.46, 0.51, 0.58);
        ground = vec3(0.085, 0.090, 0.105);
        b      = vec3(0.92, 0.95, 1.00);
    } else {                    /* Riso - fluoro pink and blue, kept apart */
        a      = vec3(1.00, 0.18, 0.52);
        ground = vec3(0.045, 0.030, 0.075);
        b      = vec3(0.24, 0.44, 1.00);
    }
    return mat3(a, ground, b);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    /* Idle fallbacks so the field still moves with nothing bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int n = int(waves);
    float t = TIME * drift;

    /* Slow zoom breathing keeps the eye from locking onto one cell. */
    float sc = scale * (1.0 + 0.06 * sin(TIME * 0.09));
    vec2 p = uv * sc;

    /* Primary lattice. Beats jump the phase, which visibly re-tiles the plane
       because every wave shifts together. */
    vec2 g1;
    float h1 = quasiField(p, n, t * 0.9 + beat * 0.8, t * 0.05, g1);

    /* Second lattice at an irrational scale ratio and counter-rotation. Two
       quasiperiodic fields at 1:phi never return to phase with each other. */
    const float PHI = 1.61803398875;
    vec2 g2;
    float h2 = quasiField(p * PHI, n, -t * 0.7, -t * 0.08 - centroid * 0.5, g2);

    float h = mix(h1, h1 + h2 * 0.85, secondary);
    vec2 grad = mix(g1, g1 + g2 * 0.85 * PHI, secondary);

    /* Relief lighting from the exact gradient. The field is a height map, so
       the surface normal is (-dh/dx, -dh/dy, 1) normalised -- no sampling. */
    float depth = relief * (0.7 + 0.7 * bass);
    vec3 nrm = normalize(vec3(-grad * depth * 6.0, 1.0));
    vec3 lightDir = normalize(vec3(0.55, 0.62, 0.56));
    float diff = clamp(dot(nrm, lightDir), 0.0, 1.0);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfV = normalize(lightDir + viewDir);
    float spec = pow(clamp(dot(nrm, halfV), 0.0, 1.0), 48.0);

    mat3 pal = paletteFor(int(colorMode));
    vec3 INK_A = pal[0];
    vec3 GROUND = pal[1];
    vec3 INK_B = pal[2];
    vec3 HI = mix(INK_B, vec3(1.0), 0.75);

    /* Which plate prints here. Driven by the second lattice and nudged by
       hueShift/centroid, so the boundary between the two inks is itself
       quasiperiodic rather than a smooth ramp across the frame. */
    /* Centred on h2 so the default shows BOTH plates in balance. Biasing by
       (hueShift - 0.5) put the default at -0.6 and printed almost everything in
       ink A, which is a duotone in name only. hueShift now pushes the balance
       from neutral rather than starting off it. */
    float sel = smoothstep(-0.45, 0.45, h2 + hueShift * 1.3 + (centroid - 0.5) * 0.4);
    vec3 INK = mix(INK_A, INK_B, sel);

    /* Ink coverage: the field thresholded hard around zero, which is where a
       quasicrystal's characteristic rosettes and worms live. A soft threshold
       renders them as topography; a tight one prints them. */
    float cover = smoothstep(-0.06, 0.14, h);

    /*
     * Contours, antialiased from the true gradient.
     *
     * `world` is world units per pixel, so |grad| * bands * world is exactly
     * how much the banded value changes across one pixel. Feeding that as the
     * smoothstep width holds the lines at constant apparent thickness no matter
     * how dense they get -- which is what stops the high-scale end of the range
     * collapsing into moire.
     */
    float bands = 9.0;
    float world = sc * 2.0 / RENDERSIZE.y;
    float aa = max(length(grad) * bands * world, 1e-4);
    float ring = abs(fract(h * bands) - 0.5);
    float line = 1.0 - smoothstep(0.0, aa * 1.6, ring);
    line *= contours;

    vec3 col = mix(GROUND, INK, cover);
    col *= 0.35 + 0.85 * diff;                     /* relief shading */
    col += HI * spec * (0.35 + 0.75 * level);      /* sheen along the ridges */
    col = mix(col, HI, line * 0.55);               /* contour lines */
    col *= 1.0 + beat * 0.22;

    /* Gentle vignette so a projected field does not fight the edge of the frame. */
    col *= 1.0 - 0.28 * dot(uv, uv) * 0.5;

    col *= exposure;
    col = col / (1.0 + col);
    col = pow(max(col, 0.0), vec3(0.4545));

    gl_FragColor = vec4(col, 1.0);
}
