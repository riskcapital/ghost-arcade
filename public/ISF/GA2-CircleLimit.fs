/*{
    "DESCRIPTION": "A hyperbolic plane tiled with regular polygons and drawn in the Poincare disc, the construction behind Escher's Circle Limit prints. Every tile is the same size in hyperbolic space, so they crowd toward the rim without ever reaching it. The view glides by hyperbolic translation, which pours tiles in from one side of the rim and out the other. Rings of light travel outward from the centre of every tile at once. Bass swells the rings, beats jump their phase, spectral centroid steers the glide.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Lapis", "Verdigris", "Oxblood", "Opal", "Noir", "Solar", "Ultraviolet"]},
        {"NAME": "sides",     "TYPE": "long",  "DEFAULT": 5,
         "VALUES": [3, 4, 5, 6, 7, 8], "LABELS": ["Triangles", "Squares", "Pentagons", "Hexagons", "Heptagons", "Octagons"]},
        {"NAME": "meeting",   "TYPE": "long",  "DEFAULT": 4,
         "VALUES": [3, 4, 5, 6, 7, 8], "LABELS": ["3 at a corner", "4 at a corner", "5 at a corner", "6 at a corner", "7 at a corner", "8 at a corner"]},
        {"NAME": "glide",     "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "spin",      "TYPE": "float", "DEFAULT": 0.10, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "edge",      "TYPE": "float", "DEFAULT": 0.22, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "spokes",    "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "pinwheel",  "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "rings",     "TYPE": "float", "DEFAULT": 3.00, "MIN": 0.00, "MAX": 9.00},
        {"NAME": "ringSpeed", "TYPE": "float", "DEFAULT": 0.60, "MIN": -2.00, "MAX": 2.00},
        {"NAME": "checker",   "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "glow",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "discSize",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.40, "MAX": 2.50},
        {"NAME": "fillFrame", "TYPE": "bool",  "DEFAULT": 0},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Regular tilings of the hyperbolic plane, {p, q}: p-sided polygons, q of them
 * meeting at every corner. On a flat plane only {3,6}, {4,4} and {6,3} close
 * up. Whenever (p - 2)(q - 2) > 4 the corners have angle to spare, the surface
 * has to be negatively curved to take them, and there are infinitely many such
 * tilings. The Poincare disc shows that whole infinite plane inside a circle:
 * straight lines become arcs that meet the rim at right angles, and equal
 * lengths look shorter the closer they sit to the rim.
 *
 * No marching and no noise. A pixel is carried into the one central tile by
 * repeated reflection:
 *
 *   1. fold the angle about the centre into a wedge of pi / p
 *   2. if the point lies beyond the tile's edge, invert it in the edge circle
 *
 * Both moves are reflections of the hyperbolic plane, so they preserve every
 * hyperbolic distance. Whatever is drawn in the central tile is therefore
 * repeated exactly, at true hyperbolic size, in every other tile. A dozen
 * rounds reach as near the rim as a pixel can resolve.
 *
 * The same fact gives exact antialiasing. A hyperbolic isometry scales lengths
 * by the ratio of (1 - |z|^2) before and after, so the size of a screen pixel
 * in folded coordinates is known in closed form. Line widths are set from it,
 * which is why the pattern dissolves cleanly into the rim instead of sparkling.
 */

const float PI = 3.14159265359;
const int FOLDS = 26;

/* Hyperbolic translation of the disc: z -> (z + a) / (1 + conj(a) z). */
vec2 glideBy(vec2 z, vec2 a) {
    vec2 num = z + a;
    vec2 den = vec2(1.0 + a.x * z.x + a.y * z.y, a.x * z.y - a.y * z.x);
    return vec2(num.x * den.x + num.y * den.y, num.y * den.x - num.x * den.y) / dot(den, den);
}

/*
 * Palettes for this shader alone. A tiling reads as inlay: two materials set
 * into a ground, with a bright metal for the lines. Columns: [tileA, ground, tileB].
 */
mat3 paletteFor(int mode) {
    vec3 a, ground, b;
    if (mode == 1) {            /* Verdigris - weathered copper and sea green */
        a      = vec3(0.16, 0.74, 0.62);
        ground = vec3(0.016, 0.050, 0.048);
        b      = vec3(0.92, 0.52, 0.24);
    } else if (mode == 2) {     /* Oxblood - deep red and parchment */
        a      = vec3(0.72, 0.07, 0.10);
        ground = vec3(0.050, 0.012, 0.016);
        b      = vec3(0.96, 0.84, 0.66);
    } else if (mode == 3) {     /* Opal - milk, rose and sky */
        a      = vec3(0.98, 0.56, 0.74);
        ground = vec3(0.070, 0.075, 0.110);
        b      = vec3(0.46, 0.86, 0.98);
    } else if (mode == 4) {     /* Noir - silver on black */
        a      = vec3(0.82, 0.85, 0.90);
        ground = vec3(0.012, 0.012, 0.016);
        b      = vec3(0.26, 0.28, 0.33);
    } else if (mode == 5) {     /* Solar - gold and ember */
        a      = vec3(1.00, 0.72, 0.16);
        ground = vec3(0.060, 0.020, 0.006);
        b      = vec3(0.96, 0.26, 0.06);
    } else if (mode == 6) {     /* Ultraviolet - violet and acid lime */
        a      = vec3(0.56, 0.22, 1.00);
        ground = vec3(0.028, 0.010, 0.070);
        b      = vec3(0.72, 1.00, 0.20);
    } else {                    /* Lapis - ultramarine and gold leaf */
        a      = vec3(0.10, 0.26, 0.92);
        ground = vec3(0.010, 0.020, 0.075);
        b      = vec3(1.00, 0.76, 0.26);
    }
    return mat3(a, ground, b);
}

/* Rotate hue about the grey axis; keeps the palette's own lightness. */
vec3 hueRotate(vec3 c, float turns) {
    float a = turns * 6.28318530718;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    /* Idle fallbacks so the piece still moves with nothing bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.23));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.19));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.11));
    float beat = audioBeat;

    float p = float(sides);
    float q = float(meeting);
    /* Keep the pair hyperbolic: (p - 2)(q - 2) must exceed 4. */
    q = max(q, floor(4.0 / (p - 2.0)) + 3.0);

    float radius = 0.47 * discSize;
    float pixel = 1.0 / (radius * RENDERSIZE.y);
    vec2 z = uv / radius;
    float r2 = dot(z, z);
    float rimDist = sqrt(r2) - 1.0;

    /* Outside the disc: either leave it dark, or mirror the plane across the
       rim so the tiling fills the frame. Inversion in the unit circle is
       itself a hyperbolic reflection, so the outside is a true copy. */
    float outside = step(1.0, r2);
    float mirrored = outside * (fillFrame ? 1.0 : 0.0);
    if (mirrored > 0.5) {
        z /= r2;
        pixel /= r2;
    }
    float conf0 = max(1.0 - dot(z, z), 1e-5);

    /* The glide: a slow loop of hyperbolic translation, steered by treble. */
    float gt = TIME * glide * 0.35;
    vec2 a = 0.62 * vec2(sin(gt), sin(gt * 0.73 + 1.3 + centroid * 0.6)) * min(1.0, glide * 4.0);
    float st = TIME * spin * 0.25;
    z = mat2(cos(st), -sin(st), sin(st), cos(st)) * z;
    z = glideBy(z, a);

    /* Edge circle of the central tile, orthogonal to the rim. */
    float sp = sin(PI / p);
    float cq = cos(PI / q);
    float den = cq * cq - sp * sp;
    float centre = sqrt(cq * cq / den);
    float rad = sqrt(sp * sp / den);
    vec2 c = vec2(centre, 0.0);

    float seg = PI / p;
    float parity = 0.0;      /* reflections across tile edges: which tile */
    float wedge = 0.0;       /* reflections about the centre: which half-wedge */
    for (int i = 0; i < FOLDS; i++) {
        float ang = mod(atan(z.y, z.x), 2.0 * seg);
        wedge = 0.0;
        if (ang > seg) { ang = 2.0 * seg - ang; wedge = 1.0; }
        z = length(z) * vec2(cos(ang), sin(ang));
        vec2 d = z - c;
        float d2 = dot(d, d);
        if (d2 >= rad * rad) break;
        z = c + d * (rad * rad / d2);
        parity += 1.0;
    }

    /* Size of one screen pixel in the folded tile. */
    float conf = max(1.0 - dot(z, z), 0.0);
    float px = pixel * conf / conf0;
    /* 1 where the tile is resolved, 0 where it is finer than a pixel. */
    float resolved = 1.0 - smoothstep(0.02, 0.09, px);

    float len = length(z);
    float de = length(z - c) - rad;                                   /* to the tile edge */
    float dm = min(z.y, sin(seg) * z.x - cos(seg) * z.y);             /* to the mirror lines */
    float hyp = log((1.0 + len) / max(1.0 - len, 1e-4));              /* hyperbolic distance from the tile centre */

    mat3 pal = paletteFor(int(colorMode));
    float turn = hueShift + (centroid - 0.5) * 0.04;
    vec3 TILE_A = hueRotate(pal[0], turn);
    vec3 GROUND = pal[1];
    vec3 TILE_B = hueRotate(pal[2], turn);
    vec3 METAL = mix(TILE_B, vec3(1.0), 0.6);

    /* Alternate tiles, as in a Circle Limit print. */
    float odd = mod(parity, 2.0);
    vec3 tile = mix(mix(TILE_A, TILE_B, 0.5), mix(TILE_A, TILE_B, odd), checker);
    vec3 other = mix(TILE_B, TILE_A, odd);

    /* Rings travelling out from the centre of every tile. Their spacing is in
       hyperbolic units, so they keep their shape in tiles of any apparent size. */
    float phase = hyp * rings * 2.2 - TIME * ringSpeed * 2.0 - beat * 2.4;
    float wave = 0.5 + 0.5 * cos(phase);
    float ringAA = 1.0 - smoothstep(0.15, 0.6, px * rings * 2.2 / max(conf, 0.05));
    float ringOn = ringAA * step(0.01, rings);
    wave = mix(0.5, wave, ringOn);
    float crest = pow(wave, 6.0) * ringOn;
    float swell = 0.55 + 0.9 * bass;

    /* Tile body: a dished face that falls away toward the edge it is set
       into, with every second half-wedge held back to cut the pinwheel. */
    float dish = smoothstep(0.0, 0.30, de);
    float facet = 1.0 - pinwheel * 0.62 * wedge;
    vec3 col = GROUND + tile * (0.10 + 0.62 * dish * (0.40 + 0.60 * wave)) * facet;
    col += mix(tile, other, 0.45) * crest * swell * 1.35 * dish;

    /* Lines. Width is in folded units, so they thin toward the rim the way
       the geometry says they should; `px` keeps their edges one pixel soft. */
    float ew = 0.003 + 0.045 * edge;
    float edgeLine = (1.0 - smoothstep(ew - px, ew + px, de)) * step(0.001, edge);
    float sw = 0.0025 + 0.010 * spokes;
    float spokeLine = (1.0 - smoothstep(sw - px, sw + px, dm)) * step(0.001, spokes);
    float halo = exp(-max(de - ew, 0.0) * (26.0 - 12.0 * min(glow, 1.0))) * glow * (0.45 + 0.8 * level);

    col += METAL * halo * 0.42;
    col = mix(col, METAL * 0.7, spokeLine * (0.25 + 0.6 * spokes));
    /* The line itself is rounded: bright along its spine, darker at the lip. */
    float spine = 1.0 - smoothstep(0.0, ew, de);
    col = mix(col, METAL * (0.55 + 0.75 * spine), edgeLine);

    /* Dissolve into the average where tiles are finer than a pixel. */
    vec3 mean = GROUND + mix(TILE_A, TILE_B, 0.5) * 0.30 + METAL * 0.12 * edge;
    col = mix(mean, col, resolved);

    /* The rim: a bright ring where the infinite plane piles up. */
    float rim = exp(-abs(rimDist) * 90.0 / discSize);
    col += METAL * rim * (0.55 + 0.6 * bass);
    if (outside > 0.5 && mirrored < 0.5) {
        float fall = exp(-rimDist * 7.0);
        col = GROUND * 0.6 + mix(TILE_A, TILE_B, 0.5) * fall * (0.16 + 0.30 * glow) + METAL * rim * (0.55 + 0.6 * bass);
    }

    col *= 1.0 + beat * 0.18;
    col *= exposure;
    /* Soft shoulder so highlights roll off instead of clipping. */
    col = col / (1.0 + 0.22 * col);
    col *= 1.22;

    gl_FragColor = vec4(col, 1.0);
}
