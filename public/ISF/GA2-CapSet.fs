/*{
    "DESCRIPTION": "A cap set: a pattern of lit cells in which no three ever fall in a line, in any direction, even when the line wraps off one edge and back on the other. It is the mathematics inside the card game Set, and in 2023 an AI system (FunSearch) found larger cap sets in eight dimensions than anyone had before. This draws the classical construction: a four-cell cap, repeated inside itself up to five levels deep, which stays a cap at every level. Probes pick three cells in a line and show the gap that is always there. Each level reshuffles on its own clock. Bass swells the cells, beats trigger a reshuffle, spectral centroid moves the probes.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Terminal", "Card Table", "Ultramarine", "Punch Card", "Hazard", "Orchid", "Arctic"]},
        {"NAME": "levels",    "TYPE": "long",  "DEFAULT": 3,
         "VALUES": [1, 2, 3, 4, 5], "LABELS": ["3 x 3", "9 x 9", "27 x 27", "81 x 81", "243 x 243"]},
        {"NAME": "cellShape", "TYPE": "long",  "DEFAULT": 0,
         "VALUES": [0, 1, 2], "LABELS": ["Dots", "Squares", "Diamonds"]},
        {"NAME": "cellSize",  "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.20, "MAX": 1.00},
        {"NAME": "glow",      "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "shuffle",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 3.00},
        {"NAME": "shear",     "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "levelTint", "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "probes",    "TYPE": "long",  "DEFAULT": 2,
         "VALUES": [0, 1, 2, 3], "LABELS": ["Off", "1", "2", "3"]},
        {"NAME": "probeSpeed","TYPE": "float", "DEFAULT": 0.40, "MIN": 0.05, "MAX": 3.00},
        {"NAME": "gridLines", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "tileFrame", "TYPE": "bool",  "DEFAULT": 1},
        {"NAME": "zoom",      "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.50, "MAX": 4.00},
        {"NAME": "pan",       "TYPE": "float", "DEFAULT": 0.10, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Number the cells of a 3^k by 3^k grid in base three. Each cell then has k
 * pairs of digits, one pair per level: which third it is in, then which
 * third of that third, and so on. Addition is done digit by digit with no
 * carrying, so the grid wraps round at every level at once.
 *
 * A "line" is three cells p, p + d, p + 2d under that addition. On a 3 x 3
 * board the cells (0,0), (1,0), (0,1), (1,1) contain no line: that is a cap.
 * The product rule says: light a cell exactly when its digit pair is in the
 * cap at every level, and the result is a cap in the big grid too, with
 * 4^k cells lit. A line in the big grid is a line (or a repeated point) at
 * each level; if all three cells were lit, every level would hold three cap
 * cells in a line, and at the first level where they differ that is
 * impossible.
 *
 * Sliding or shearing the cap on the small board gives another cap, so each
 * level may use its own, and may change it. That is the animation.
 *
 * The record-setting sets are in eight dimensions (four levels here) and are
 * not products; they are not what is drawn.
 */

const float TAU = 6.28318530718;
const int MAX_LEVELS = 5;
const int MAX_PROBES = 3;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

/* Palettes for this shader alone. Columns: [cell, ground, probe]. */
mat3 paletteFor(int mode) {
    vec3 a, ground, b;
    if (mode == 1) {            /* Card Table - baize, with a red marker */
        a      = vec3(0.92, 0.90, 0.80);
        ground = vec3(0.020, 0.090, 0.060);
        b      = vec3(1.00, 0.20, 0.16);
    } else if (mode == 2) {     /* Ultramarine */
        a      = vec3(0.30, 0.50, 1.00);
        ground = vec3(0.008, 0.016, 0.060);
        b      = vec3(1.00, 0.86, 0.30);
    } else if (mode == 3) {     /* Punch Card - manila */
        a      = vec3(0.12, 0.10, 0.08);
        ground = vec3(0.90, 0.84, 0.70);
        b      = vec3(0.80, 0.14, 0.10);
    } else if (mode == 4) {     /* Hazard */
        a      = vec3(1.00, 0.80, 0.04);
        ground = vec3(0.030, 0.028, 0.020);
        b      = vec3(1.00, 1.00, 1.00);
    } else if (mode == 5) {     /* Orchid */
        a      = vec3(0.90, 0.40, 0.96);
        ground = vec3(0.040, 0.010, 0.056);
        b      = vec3(0.40, 1.00, 0.86);
    } else if (mode == 6) {     /* Arctic */
        a      = vec3(0.80, 0.94, 1.00);
        ground = vec3(0.016, 0.040, 0.062);
        b      = vec3(1.00, 0.46, 0.30);
    } else {                    /* Terminal - phosphor green, amber probe */
        a      = vec3(0.20, 1.00, 0.46);
        ground = vec3(0.004, 0.022, 0.012);
        b      = vec3(1.00, 0.72, 0.16);
    }
    return mat3(a, ground, b);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

/* Which arrangement of the cap level `l` is using during time step `step`. */
vec3 capMove(float l, float stepIndex, float shearAmount) {
    float h = hash11(l * 7.3 + stepIndex * 3.17 + 1.0);
    float sx = floor(h * 3.0);
    float sy = floor(hash11(h * 91.0 + 2.0) * 3.0);
    float sh = step(1.0 - shearAmount, hash11(h * 57.0 + 5.0));
    return vec3(sx, sy, sh);
}

/* 1 if digit pair d is in the cap after that level's slide and shear. */
float inCap(vec2 d, vec3 move) {
    d.x = mod(d.x + move.z * d.y, 3.0);          /* shear */
    d = mod(d + move.xy, 3.0);                   /* slide */
    return step(d.x, 1.5) * step(d.y, 1.5);
}

/* Is this cell lit, given every level's arrangement at clock `clock`? Also
   returns, in `depth`, the deepest level at which the cell is still in. */
float lit(vec2 cell, int k, float clock, float shearAmount, out float depthIn) {
    float on = 1.0;
    float scale = 1.0;
    depthIn = 0.0;
    for (int l = 0; l < MAX_LEVELS; l++) {
        if (l >= k) break;
        float fl = float(l);
        vec2 d = mod(floor(cell / scale), 3.0);
        /* Coarser levels turn over more slowly. */
        float stepIndex = floor(clock / (1.0 + fl * 0.7) + fl * 0.37);
        float hit = inCap(d, capMove(fl, stepIndex, shearAmount));
        on *= hit;
        depthIn += on;
        scale *= 3.0;
    }
    return on;
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int k = int(levels);
    float n = pow(3.0, float(k));

    /* The board is a torus, so it can tile the frame without a seam. */
    vec2 board = uv / zoom + 0.5 + pan * 0.25 * vec2(sin(TIME * 0.07), cos(TIME * 0.05));
    float inBoard = 1.0;
    if (tileFrame) board = fract(board);
    else inBoard = step(0.0, board.x) * step(board.x, 1.0) * step(0.0, board.y) * step(board.y, 1.0);

    vec2 g = board * n;
    vec2 cell = clamp(floor(g), 0.0, n - 1.0);
    vec2 f = fract(g) - 0.5;
    float pixel = n / (zoom * res.y);

    /* Reshuffles cross-fade from one arrangement to the next. */
    float clock = TIME * shuffle + beat * 0.5;
    float depthA, depthB;
    float onA = lit(cell, k, clock, shear, depthA);
    float onB = lit(cell, k, clock + 0.5, shear, depthB);
    float fade = smoothstep(0.35, 0.65, abs(fract(clock * 2.0) - 0.5) * 2.0);
    float on = mix(onB, onA, fade);
    float depthIn = mix(depthB, depthA, fade);

    /* Cell face. */
    int shape = int(cellShape);
    float r = cellSize * 0.5 * (0.92 + 0.14 * bass);
    float d = shape == 1 ? max(abs(f.x), abs(f.y)) - r * 0.9
            : shape == 2 ? (abs(f.x) + abs(f.y)) - r * 1.25
            : length(f) - r;
    float face = 1.0 - smoothstep(-pixel, pixel, d);
    float halo = exp(-max(d, 0.0) * (7.0 - 3.0 * min(glow, 1.0))) * glow;
    /* When cells are smaller than a pixel, show their average instead. */
    float resolved = 1.0 - smoothstep(0.35, 0.9, pixel);
    float coverage = mix(0.45 * cellSize, face, resolved);

    mat3 pal = paletteFor(int(colorMode));
    vec3 CELL = hueRotate(pal[0], hueShift);
    vec3 GROUND = pal[1];
    vec3 PROBE = hueRotate(pal[2], hueShift);
    bool paper = dot(GROUND, vec3(0.333)) > 0.5;

    /* Cells that only just miss (in the cap at most levels) glow faintly, so
       the nesting of the levels can be read. */
    float near = depthIn / float(k);
    vec3 col = GROUND;
    vec3 ink = CELL * (1.15 + 0.6 * level);
    if (paper) {
        col = mix(col, GROUND * 0.90, levelTint * near * (1.0 - on) * 0.8);
        col = mix(col, ink, coverage * on);
    } else {
        col += CELL * levelTint * 0.10 * near * near * (1.0 - on);
        col += ink * on * (coverage + halo * 0.35 * resolved);
    }

    /* Lines of the board at the two coarsest levels. */
    vec2 coarse = abs(fract(board * 3.0 + 0.5) - 0.5) * n / 3.0;
    vec2 finer = abs(fract(board * 9.0 + 0.5) - 0.5) * n / 9.0;
    float lineA = 1.0 - smoothstep(0.0, pixel * 1.5, min(coarse.x, coarse.y));
    float lineB = k > 1 ? 1.0 - smoothstep(0.0, pixel * 1.2, min(finer.x, finer.y)) : 0.0;
    float lines = max(lineA, lineB * 0.5) * gridLines;
    col = paper ? mix(col, CELL, lines * 0.5) : col + CELL * lines * 0.22;

    /* Probes: three cells in a line. At most two can be lit. */
    int np = int(probes);
    for (int p = 0; p < MAX_PROBES; p++) {
        if (p >= np) break;
        float fp = float(p);
        float slot = floor(TIME * probeSpeed + fp * 0.37 + centroid * 0.3);
        float life = fract(TIME * probeSpeed + fp * 0.37 + centroid * 0.3);
        /* Build a base point and a direction, one digit pair per level. */
        vec2 base = vec2(0.0);
        vec2 dir = vec2(0.0);
        float scale = 1.0;
        for (int l = 0; l < MAX_LEVELS; l++) {
            if (l >= k) break;
            float h = hash11(slot * 5.1 + fp * 17.0 + float(l) * 3.3 + 1.0);
            base += floor(vec2(h, hash11(h * 31.0 + 4.0)) * 3.0) * scale;
            vec2 dd = floor(vec2(hash11(h * 13.0 + 7.0), hash11(h * 71.0 + 9.0)) * 3.0);
            /* Keep the two coarsest levels moving so the line is easy to see. */
            if (l >= k - 1 && dd.x + dd.y < 0.5) dd = vec2(1.0, 0.0);
            dir += dd * scale;
            scale *= 3.0;
        }
        for (int m = 0; m < 3; m++) {
            /* base + m * dir, digit by digit with no carry. */
            vec2 target = vec2(0.0);
            float sc = 1.0;
            for (int l = 0; l < MAX_LEVELS; l++) {
                if (l >= k) break;
                vec2 bd = mod(floor(base / sc), 3.0);
                vec2 dd = mod(floor(dir / sc), 3.0);
                target += mod(bd + float(m) * dd, 3.0) * sc;
                sc *= 3.0;
            }
            /* A ring round that cell, big enough to find at any grid size. */
            vec2 delta = (g - (target + 0.5));
            float ringR = max(0.72, 5.0 * pixel);
            float ring = abs(length(delta) - ringR);
            float mark = (1.0 - smoothstep(0.0, max(pixel * 1.6, 0.08), ring));
            float show = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.82, 1.0, life));
            col = mix(col, PROBE, mark * show * inBoard);
        }
    }

    col = mix(GROUND * 0.5, col, inBoard);
    col *= 1.0 + beat * 0.12;
    col *= exposure;
    if (!paper) {
        col = col / (1.0 + 0.22 * col);
        col *= 1.22;
    }

    gl_FragColor = vec4(col, 1.0);
}
