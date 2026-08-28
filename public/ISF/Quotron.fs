/*{
    "CREDIT": "Ghost Arcade — after the Quotron collection generator",
    "DESCRIPTION": "1970s stock-quote terminal. A character-cell screen with one glyph ROM, one phosphor and no sub-cell positioning: 11 live programs, six phosphors, seven glyph ROMs and seven screen aberrations, all rolled from a single seed. Press Generate for a new edition. The cell grid adapts to the composition resolution.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Generator" ],
    "INPUTS": [
        {
            "NAME": "generate",
            "LABEL": "Generate",
            "TYPE": "event"
        },
        {
            "NAME": "columns",
            "LABEL": "Columns",
            "TYPE": "float",
            "MIN": 16.0,
            "MAX": 220.0,
            "DEFAULT": 64.0
        },
        {
            "NAME": "cellAspect",
            "LABEL": "Cell Aspect",
            "TYPE": "float",
            "MIN": 1.0,
            "MAX": 2.4,
            "DEFAULT": 1.7
        },
        {
            "NAME": "refreshFps",
            "LABEL": "Refresh FPS",
            "TYPE": "float",
            "MIN": 1.0,
            "MAX": 60.0,
            "DEFAULT": 12.0
        },
        {
            "NAME": "programMode",
            "LABEL": "Program",
            "TYPE": "long",
            "VALUES": [0,1,2,3,4,5,6,7,8,9,10,11],
            "LABELS": ["Auto","Tape automaton","Moire plaid","Horizon","Figure","Reversion field","Glitch","Specimen","Brownian print","Depth ladder","Tape weave","Blackout"],
            "DEFAULT": 0
        },
        {
            "NAME": "phosphorMode",
            "LABEL": "Phosphor",
            "TYPE": "long",
            "VALUES": [0,1,2,3,4,5,6],
            "LABELS": ["Auto","P1 green","P3 amber","P4 white","P2 blue","Burn-in","Inverse"],
            "DEFAULT": 0
        },
        {
            "NAME": "romMode",
            "LABEL": "Glyph ROM",
            "TYPE": "long",
            "VALUES": [0,1,2,3,4,5,6,7],
            "LABELS": ["Auto","Standard","Ticker","Numeric","Fraction","Sparse","Dense","Binary"],
            "DEFAULT": 0
        },
        {
            "NAME": "aberrationMode",
            "LABEL": "Aberration",
            "TYPE": "long",
            "VALUES": [0,1,2,3,4,5,6,7],
            "LABELS": ["Auto","None","Line dropout","Shear","Dead column","Burn band","Bit rot","Misregister"],
            "DEFAULT": 0
        },
        {
            "NAME": "gain",
            "LABEL": "Gain",
            "TYPE": "float",
            "MIN": 0.4,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "glow",
            "LABEL": "Phosphor Glow",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.35
        },
        {
            "NAME": "scanline",
            "LABEL": "Scanline",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.2
        },
        {
            "NAME": "border",
            "LABEL": "Bezel",
            "TYPE": "bool",
            "DEFAULT": true
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/* ------------------------------------------------------------------
 * Quotron — a character-cell terminal, rendered entirely in one pass.
 *
 * The whole screen is a grid of character cells. Each program computes
 * one intensity per cell; a glyph ROM maps that intensity to a glyph;
 * the glyph is drawn from a 3x5 bitmap font. Nothing is positioned at
 * sub-cell resolution, which is the constraint the whole look rests on.
 *
 * The grid ADAPTS to the composition: `columns` sets the width in
 * cells and the row count falls out of the composition's aspect ratio,
 * so the screen fills any resolution instead of being locked to the
 * original's 64x36.
 *
 * Determinism: every trait is a pure function of a seed, and the seed
 * comes from the Generate button. This uses a fast float hash rather
 * than the original's keccak256, so a given edition number here does
 * not correspond to the same edition in the reference generator — the
 * trait system and the look are the same, the numbering is not.
 *
 * Four of the eleven programs (Tape automaton, Reversion field,
 * Brownian print, Depth ladder) accumulate state across frames in the
 * reference. A single-pass shader has no frame-to-frame memory, so
 * those are stateless evocations built from scrolling hash fields:
 * the same texture and motion, not the same exact automaton.
 * ------------------------------------------------------------------ */

/* ---------- hashing ---------- */

/* Hoskins-style integer-free hashes. The usual sin(dot(..))*43758 trick
 * collapses once an argument gets into the hundreds — measured here as
 * the Glitch program picking the same sub-program at almost every seed,
 * because its selector index was ~970. These stay well distributed for
 * the large cell / frame / stream-index values this shader feeds them. */
float h11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}
float h21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float h31(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

/* value noise over the cell lattice */
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = h21(i);
    float b = h21(i + vec2(1.0, 0.0));
    float c = h21(i + vec2(0.0, 1.0));
    float d = h21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.y), f.y);
}

/* one draw from a seeded stream: stream(seed, index) */
float rnd(float seed, float idx) {
    return h21(vec2(fract(seed) * 311.7 + 0.37, idx + 1.0));
}
/* integer-ish draw in [0, n) */
float rndN(float seed, float idx, float n) {
    return floor(rnd(seed, idx) * n);
}

/* ---------- 3x5 bitmap font ----------
 * 45 glyphs, each packed into a single float: five 3-bit rows,
 * value = sum(row_r * 8^r), bit 0 of a row is its leftmost column.
 * Generated and round-trip verified rather than hand-encoded.
 * Index order is GLYPH_ORDER below.
 *   0..8   space . : - + * # / @
 *   9..18  0-9
 *   19..44 A-Z
 */
float glyphPack(int g) {
    if (g <  1) return     0.0;   // ' '
    if (g <  2) return  8192.0;   // '.'
    if (g <  3) return  1040.0;   // ':'
    if (g <  4) return   448.0;   // '-'
    if (g <  5) return  1488.0;   // '+'
    if (g <  6) return  2728.0;   // '*'
    if (g <  7) return 24445.0;   // '#'
    if (g <  8) return  4772.0;   // '/'
    if (g <  9) return 25578.0;   // '@'
    if (g < 10) return 11114.0;   // '0'
    if (g < 11) return 29850.0;   // '1'
    if (g < 12) return 29347.0;   // '2'
    if (g < 13) return 14499.0;   // '3'
    if (g < 14) return 18925.0;   // '4'
    if (g < 15) return 14543.0;   // '5'
    if (g < 16) return 31694.0;   // '6'
    if (g < 17) return  9383.0;   // '7'
    if (g < 18) return 31727.0;   // '8'
    if (g < 19) return 14831.0;   // '9'
    if (g < 20) return 23530.0;   // 'A'
    if (g < 21) return 15083.0;   // 'B'
    if (g < 22) return 25166.0;   // 'C'
    if (g < 23) return 15211.0;   // 'D'
    if (g < 24) return 29391.0;   // 'E'
    if (g < 25) return  4815.0;   // 'F'
    if (g < 26) return 27470.0;   // 'G'
    if (g < 27) return 23533.0;   // 'H'
    if (g < 28) return 29847.0;   // 'I'
    if (g < 29) return 11044.0;   // 'J'
    if (g < 30) return 23277.0;   // 'K'
    if (g < 31) return 29257.0;   // 'L'
    if (g < 32) return 23549.0;   // 'M'
    if (g < 33) return 24029.0;   // 'N'
    if (g < 34) return 11114.0;   // 'O'
    if (g < 35) return  4843.0;   // 'P'
    if (g < 36) return 17770.0;   // 'Q'
    if (g < 37) return 23275.0;   // 'R'
    if (g < 38) return 14478.0;   // 'S'
    if (g < 39) return  9367.0;   // 'T'
    if (g < 40) return 11117.0;   // 'U'
    if (g < 41) return  9581.0;   // 'V'
    if (g < 42) return 24557.0;   // 'W'
    if (g < 43) return 23213.0;   // 'X'
    if (g < 44) return  9389.0;   // 'Y'
    return 29351.0;               // 'Z'
}

/* Is the glyph lit at cell-local uv? uv is 0..1 across the cell. */
float glyphMask(int g, vec2 uv) {
    if (g <= 0) return 0.0;
    // 3x5 cell inside a 5x7 box, so glyphs carry their own letterspacing.
    vec2 p = uv * vec2(5.0, 7.0) - vec2(1.0, 1.0);
    if (p.x < 0.0 || p.x >= 3.0 || p.y < 0.0 || p.y >= 5.0) return 0.0;
    float col = floor(p.x);
    float row = floor(p.y);
    // NB: `packed` is a reserved word in GLSL ES — do not rename this back.
    float bits = glyphPack(g);

    // Digit extraction MUST use exact binary constants, never pow().
    // pow(8.0, row) returns 8.0000005 on some drivers, so dividing a value
    // that is an exact multiple (e.g. '.' = 8192 = 2^13) lands a hair below
    // the integer and floor() drops it a whole step — every row of that
    // glyph then decodes as garbage. Multiplying by an exact negative power
    // of two is lossless, so this is stable everywhere.
    float rowBits;
    if (row < 0.5)      rowBits = mod(bits, 8.0);
    else if (row < 1.5) rowBits = mod(floor(bits * 0.125), 8.0);          // /8
    else if (row < 2.5) rowBits = mod(floor(bits * 0.015625), 8.0);       // /64
    else if (row < 3.5) rowBits = mod(floor(bits * 0.001953125), 8.0);    // /512
    else                rowBits = mod(floor(bits * 0.000244140625), 8.0); // /4096

    float bit;
    if (col < 0.5)      bit = mod(rowBits, 2.0);
    else if (col < 1.5) bit = mod(floor(rowBits * 0.5), 2.0);
    else                bit = mod(floor(rowBits * 0.25), 2.0);
    return bit;
}

/* ---------- glyph ROMs ----------
 * Each ROM is an intensity ramp: index into it with the (gamma'd)
 * cell intensity. Returns a glyph index for the font above.
 */
int romGlyph(int rom, float v) {
    v = clamp(v, 0.0, 0.9999);
    // Standard: " .:-+*X#"
    if (rom == 1) {
        int i = int(floor(v * 8.0));
        if (i < 1) return 0; if (i < 2) return 1; if (i < 3) return 2;
        if (i < 4) return 3; if (i < 5) return 4; if (i < 6) return 5;
        if (i < 7) return 42; return 6;
    }
    // Ticker: "  .ILTFKWM"
    if (rom == 2) {
        int i = int(floor(v * 10.0));
        if (i < 2) return 0; if (i < 3) return 1; if (i < 4) return 27;
        if (i < 5) return 30; if (i < 6) return 38; if (i < 7) return 24;
        if (i < 8) return 29; if (i < 9) return 41; return 31;
    }
    // Numeric: "  .1732568 0"
    if (rom == 3) {
        int i = int(floor(v * 11.0));
        if (i < 2) return 0;  if (i < 3) return 1;  if (i < 4) return 10;
        if (i < 5) return 16; if (i < 6) return 12; if (i < 7) return 11;
        if (i < 8) return 14; if (i < 9) return 15; if (i < 10) return 17;
        return 9;
    }
    // Fraction: " ./1248#"
    if (rom == 4) {
        int i = int(floor(v * 8.0));
        if (i < 1) return 0;  if (i < 2) return 1;  if (i < 3) return 7;
        if (i < 4) return 10; if (i < 5) return 11; if (i < 6) return 13;
        if (i < 7) return 17; return 6;
    }
    // Sparse: "   ..:+#"
    if (rom == 5) {
        int i = int(floor(v * 8.0));
        if (i < 3) return 0; if (i < 5) return 1; if (i < 6) return 2;
        if (i < 7) return 4; return 6;
    }
    // Dense: ".:+*X#@8"
    if (rom == 6) {
        int i = int(floor(v * 8.0));
        if (i < 1) return 1;  if (i < 2) return 2;  if (i < 3) return 4;
        if (i < 4) return 5;  if (i < 5) return 42; if (i < 6) return 6;
        if (i < 7) return 8;  return 17;
    }
    // Binary: " #"
    if (rom == 7) return v < 0.5 ? 0 : 6;
    return 0;
}

/* ---------- phosphors ---------- */
void phosphor(int p, out vec3 bg, out vec3 fg, out vec3 dim) {
    if (p == 2)      { bg = vec3(0.039,0.024,0.000); fg = vec3(1.000,0.706,0.235); dim = vec3(0.478,0.302,0.020); } // P3 amber
    else if (p == 3) { bg = vec3(0.027,0.027,0.027); fg = vec3(0.902,0.902,0.886); dim = vec3(0.373,0.373,0.361); } // P4 white
    else if (p == 4) { bg = vec3(0.012,0.027,0.039); fg = vec3(0.353,0.839,0.910); dim = vec3(0.082,0.369,0.420); } // P2 blue
    else if (p == 5) { bg = vec3(0.024,0.027,0.016); fg = vec3(0.788,0.941,0.416); dim = vec3(0.420,0.290,0.071); } // Burn-in
    else if (p == 6) { bg = vec3(0.216,0.851,0.416); fg = vec3(0.016,0.078,0.039); dim = vec3(0.051,0.247,0.118); } // Inverse
    else             { bg = vec3(0.020,0.031,0.020); fg = vec3(0.306,0.886,0.478); dim = vec3(0.110,0.420,0.224); } // P1 green
}

/* ---------- ticker strings ----------
 * The reference builds strings like "IBM 214 3/8 +". Rebuilding real
 * text needs a character stream, so this synthesises one directly:
 * position along the row picks a field (symbol / price / fraction /
 * sign) and each field resolves to a glyph. Deterministic per row.
 */
int tickerGlyph(float seed, float row, float col) {
    // 16-cell repeating record, jittered per row so rows do not align.
    float rec = floor(col / 16.0);
    float pos = mod(col, 16.0);
    float rs = seed + row * 7.13 + rec * 3.77;

    if (pos < 3.0) {                      // 3-letter symbol
        return 19 + int(rndN(rs, pos, 26.0));
    }
    if (pos < 4.0) return 0;              // space
    if (pos < 7.0) {                      // 3-digit price
        return 9 + int(rndN(rs, 10.0 + pos, 10.0));
    }
    if (pos < 8.0) return 0;
    if (pos < 9.0) {                      // eighths numerator
        return 9 + int(1.0 + rndN(rs, 20.0, 7.0));
    }
    if (pos < 10.0) return 7;             // '/'
    if (pos < 11.0) return 17;            // '8'
    if (pos < 12.0) return 0;
    if (pos < 13.0) {                     // sign
        float s = rnd(rs, 30.0);
        return s < 0.4 ? 4 : (s < 0.8 ? 3 : 0);
    }
    return 0;
}

/* ==================================================================
 * PROGRAMS — each returns intensity for cell (cx, cy) at frame f.
 * `g` is a glyph override: >= 0 forces a literal glyph (used by the
 * text programs), < 0 means "map my intensity through the ROM".
 * ================================================================== */

float progMoire(vec2 c, float f, float seed, vec2 grid) {
    float ax = 1.0 + rndN(seed, 1.0, 13.0);
    float ay = 1.0 + rndN(seed, 2.0, 13.0);
    float m  = 5.0 + rndN(seed, 3.0, 25.0);
    float vx = (rndN(seed, 4.0, 5.0) - 2.0) * 0.5;
    float vy = (rndN(seed, 5.0, 5.0) - 2.0) * 0.5;
    if (vx == 0.0 && vy == 0.0) vx = 0.5;
    float X = c.x + floor(rndN(seed, 6.0, grid.x) + vx * f);
    float Y = c.y + floor(rndN(seed, 7.0, grid.y) + vy * f);
    // The reference uses integer shifts; float equivalents keep the beat.
    float v = mod(X * ax + Y * ay + floor(X * Y / 4.0) + floor(X * X / 8.0), m);
    return v / max(1.0, m - 1.0);
}

float progHorizon(vec2 c, float f, float seed, vec2 grid) {
    float hy = floor(grid.y * (0.34 + rnd(seed, 1.0) * 0.34));
    float grain = 0.20 + rnd(seed, 2.0) * 0.28;
    float sea = step(0.5, rnd(seed, 3.0));
    float amp = 2.0 + rndN(seed, 4.0, max(3.0, floor(grid.y * 0.26)));

    // ridge: smooth 1D field, stable in x, so it reads as terrain
    float ridge = (vnoise(vec2(c.x * 0.11 + seed * 3.0, 0.5)) * 0.7
                 + vnoise(vec2(c.x * 0.31 + seed * 5.0, 1.5)) * 0.3) * amp;

    if (c.y < hy) {
        // sky, with a drifting disc
        float t = c.y / max(1.0, hy - 1.0);
        float base = 0.02 + 0.40 * t;
        float v = max(0.0, base + (h31(vec3(c, floor(seed * 97.0))) - 0.5) * grain);
        float rad = 2.0 + rndN(seed, 5.0, max(3.0, floor(hy * 0.42)));
        float sx = rndN(seed, 6.0, grid.x) + (rnd(seed, 7.0) - 0.5) * 0.045 * f;
        float sy = rndN(seed, 8.0, max(1.0, hy - 3.0)) + (rnd(seed, 9.0) - 0.5) * 0.02 * f;
        float dx = (c.x - sx) * 0.58;
        float dy = c.y - sy;
        float d = sqrt(dx * dx + dy * dy);
        if (rnd(seed, 10.0) > 0.25 && d <= rad) {
            v = (rnd(seed, 11.0) < 0.33) ? (d > rad - 1.1 ? 1.0 : 0.06) : 1.0;
        }
        return v;
    }
    if (sea > 0.5) {
        // water: horizontal chop that scrolls, fading with distance
        float band = c.y - hy;
        float fade = max(0.10, 0.55 - band * 0.011);
        float chop = h21(vec2(floor(c.x / (1.0 + floor(band * 0.35))),
                              floor(c.y * 131.0 + f * (1.0 + band * 0.08))));
        return chop < 0.5 ? 0.03 : fade + h31(vec3(c.x, c.y + f, seed)) * 0.22;
    }
    // land: solid mass under a lit ridge line
    float top = max(0.0, hy - ridge);
    if (c.y < top) return 0.0;
    if (c.y < top + 1.0) return 1.0;
    return h31(vec3(c, seed + 11.0)) < 0.06 ? 0.70 : 1.0;
}

float progFigure(vec2 c, float f, float seed, vec2 grid) {
    float A = 0.58;
    float cx = grid.x * 0.5 + (rndN(seed, 1.0, 5.0) - 2.0);
    float hh = grid.y * (0.24 + rnd(seed, 2.0) * 0.11);
    float cy = grid.y * (0.38 + rnd(seed, 3.0) * 0.08);
    float hw = hh * (0.70 + rnd(seed, 4.0) * 0.18) / A;
    float n  = 2.0 + rnd(seed, 5.0) * 1.6;

    // light orbits the head
    float phase = rnd(seed, 6.0) * 6.283;
    float speed = (0.010 + rnd(seed, 7.0) * 0.022) * (rnd(seed, 8.0) < 0.5 ? -1.0 : 1.0);
    vec3 L = normalize(vec3(cos(phase + speed * f), -(0.25 + rnd(seed, 9.0) * 0.6), 0.75));

    float u = (c.x - cx) / hw;
    float v = (c.y - cy) / hh;
    float taper = 1.0 - 0.26 * max(0.0, v);
    float ue = u / taper;
    float d = pow(abs(ue), n) + pow(abs(v), n);

    float out_i = 0.0;

    // hair mass above the hairline
    float hairline = -0.22 - rnd(seed, 10.0) * 0.42;
    if (rnd(seed, 11.0) > 0.17 && v < hairline) {
        float hr = 1.0 + rnd(seed, 12.0) * 0.34 * (0.55 + 0.45 * sin(u * 5.5)) * 0.30;
        if (pow(abs(u), n) + pow(abs(v), n) <= hr * hr) out_i = 1.0;
    }

    if (d <= 1.0) {
        float z = sqrt(max(0.0, 1.0 - u * u - v * v));
        float lam = u * L.x + v * L.y + z * L.z;
        float i = 0.24 + 0.50 * clamp(lam, 0.0, 1.0);
        if (d > 0.86) i = max(i, 0.72);
        // eyes, brows, nose, mouth — all on the cell grid
        float blink = step(mod(f + rndN(seed, 13.0, 60.0), 38.0 + rndN(seed, 14.0, 82.0)), 1.0);
        float eu = abs(u) - 0.40, ev = v + 0.11;
        if (blink < 0.5 && (eu / 0.15) * (eu / 0.15) + (ev / 0.085) * (ev / 0.085) <= 1.0) i = 1.0;
        if (abs(abs(u) - 0.40) < 0.20 && abs(v + 0.24) < 0.05) i = 0.88;
        if (abs(u) < 0.055 && v > -0.02 && v < 0.24) i = max(0.06, i - 0.16);
        if (abs(u) < 0.10 && v > 0.20 && v < 0.27) i = 0.80;
        if (abs(u) < 0.22 && v > 0.36 && v < 0.42) i = 0.97;
        out_i = max(out_i, i);
    }

    // neck and shoulders
    float neckTop = cy + hh * 0.80;
    float shTop = cy + hh * 1.15;
    if (c.y >= neckTop) {
        float dxn = abs(c.x - cx);
        if (c.y < shTop) {
            if (dxn < hw * 0.34) out_i = max(out_i, 0.22 + 0.26 * (1.0 - dxn / (hw * 0.34)));
        } else {
            float spread = hw * (0.34 + (c.y - shTop) * 0.38);
            if (dxn < spread) out_i = max(out_i, 0.30 + 0.30 * (1.0 - dxn / spread));
        }
    }
    return out_i;
}

float progSpecimen(vec2 c, float f, float seed, vec2 grid) {
    float cx = (grid.x - 1.0) * 0.5;
    float k = ((grid.x * 0.5) * 10.0) / (grid.y * 17.0);
    float u = abs(c.x - cx) / (grid.x * 0.5);
    float v = c.y / max(1.0, grid.y - 1.0);
    float fv = 0.0;
    // symmetric metaball colony, breathing on its own clock
    for (int b = 0; b < 12; b++) {
        float fb = float(b);
        float bx = rnd(seed, 20.0 + fb) * 0.55;
        float by = 0.10 + rnd(seed, 40.0 + fb) * 0.78;
        float br = 0.05 + rnd(seed, 60.0 + fb) * 0.13;
        float bw = 0.02 + rnd(seed, 80.0 + fb) * 0.05;
        float bp = rnd(seed, 100.0 + fb) * 6.283;
        float ba = 0.10 + rnd(seed, 120.0 + fb) * 0.18;
        float r = br * (1.0 + ba * sin(bp + bw * f));
        float dx = (u - bx) * k;
        float dy = v - by;
        float q = (dx * dx + dy * dy) / max(1e-5, r * r);
        if (q < 1.0) { float w = 1.0 - q; fv += w * w; }
    }
    return fv > 0.30 ? min(1.0, 0.26 + (fv - 0.30) * 1.15) : 0.0;
}

/* Stateless evocation of a scrolling 1D automaton: a sharp, sparse
 * field that streams downward. Not a true rule automaton — see the
 * header note. */
float progTape(vec2 c, float f, float seed, vec2 grid) {
    float gen = c.y + f;                       // row age = generation
    float a = h31(vec3(c.x, gen, floor(seed * 31.0)));
    float b = h31(vec3(c.x + 1.0, gen - 1.0, floor(seed * 31.0)));
    float d = h31(vec3(c.x - 1.0, gen - 1.0, floor(seed * 31.0)));
    // XOR-ish neighbourhood rule gives the familiar triangular texture
    float live = step(0.5, fract((a + b + d) * 1.7 + rnd(seed, 2.0)));
    float age = fract(gen * 0.11 + h21(vec2(c.x, floor(gen / 5.0))));
    return live * (0.25 + 0.75 * age);
}

float progReversion(vec2 c, float f, float seed, vec2 grid) {
    float gen = c.y + f;
    float s1 = floor(seed * 31.0);
    float s2 = floor(seed * 71.0) + 5.0;
    float a = step(0.5, h31(vec3(c.x, gen, s1)));
    float b = step(0.5, h31(vec3(c.x, gen, s2)));
    float diff = abs(a - b);
    float age = fract(gen * 0.07 + h21(vec2(c.x, floor(gen / 4.0))));
    return diff * min(1.0, 0.25 + age * 0.9);
}

float progBrownian(vec2 c, float f, float seed, vec2 grid) {
    // Trails approximated as drifting filaments: a low-frequency flow
    // field thresholded thin, decaying away from its ridge.
    vec2 p = c / grid * vec2(6.0, 6.0);
    float t = f * 0.05;
    float n1 = vnoise(p + vec2(t, seed * 13.0));
    float n2 = vnoise(p * 1.7 - vec2(t * 0.7, seed * 7.0));
    float ridge = abs(n1 - n2);
    float line = 1.0 - smoothstep(0.0, 0.06, ridge);
    float spark = step(0.985, h31(vec3(c, floor(f))));
    return max(line * (0.30 + 0.60 * vnoise(p * 3.0)), spark * 0.5);
}

float progDepth(vec2 c, float f, float seed, vec2 grid) {
    // Order book scrolling right-to-left. The bid/ask profile is a
    // smooth 1D field of (x + f), which reproduces the reference's
    // random-walk ladder closely without needing history.
    float mid = floor(grid.y * (0.35 + rnd(seed, 1.0) * 0.30));
    float sx = c.x + f;
    float bid = vnoise(vec2(sx * 0.18 + seed * 17.0, 0.5)) * (mid - 1.0);
    float ask = vnoise(vec2(sx * 0.18 + seed * 29.0, 9.5)) * (grid.y - mid - 2.0);
    if (abs(c.y - mid) < 0.5) return 0.5;
    if (c.y < mid) {
        float d = mid - 1.0 - c.y;
        if (d < bid) return 0.28 + 0.72 * (d / max(1.0, bid - 1.0));
        return 0.0;
    }
    float e = c.y - mid - 1.0;
    if (e < ask) return 0.28 + 0.72 * (e / max(1.0, ask - 1.0));
    return 0.0;
}

/* ---------- text programs (return a glyph directly) ---------- */

int progWeave(vec2 c, float f, float seed, vec2 grid) {
    float speed = (rndN(seed, 100.0 + c.y, 7.0) - 3.0);
    if (abs(speed) < 0.5) speed = 1.0;
    float off = floor(c.x + speed * f);
    // one row in four is a blank gutter, as in the reference
    if (rnd(seed, 200.0 + c.y) < 0.18) return 0;
    return tickerGlyph(seed, c.y, off);
}

int progBlackout(vec2 c, float f, float seed, vec2 grid, out float dotI) {
    dotI = 0.0;
    float bw = min(grid.x - 2.0, 14.0 + rndN(seed, 1.0, 20.0));
    float bh = 3.0 + rndN(seed, 2.0, 6.0);
    float bx = rndN(seed, 3.0, max(1.0, grid.x - bw));
    float by = rndN(seed, 4.0, max(1.0, grid.y - bh));
    if (c.x >= bx && c.x < bx + bw && c.y >= by && c.y < by + bh) {
        float speed = (rndN(seed, 10.0 + c.y, 5.0) - 2.0);
        if (abs(speed) < 0.5) speed = 1.0;
        return tickerGlyph(seed, c.y, floor(c.x - bx + speed * f));
    }
    // sparse live dots everywhere else
    if (h31(vec3(c, floor(f * 0.25))) > 0.988) dotI = 0.3 + h21(c) * 0.4;
    return -1;
}

/* ================================================================== */

void main() {
    vec2 res = RENDERSIZE;
    float cols = max(8.0, floor(columns));
    // Rows fall out of the composition aspect so the screen always
    // fills the frame — this is what makes it resolution-adaptive.
    float cellW = res.x / cols;
    float cellH = cellW * max(1.0, cellAspect);
    float rows = max(6.0, floor(res.y / cellH));
    vec2 grid = vec2(cols, rows);

    vec2 px = gl_FragCoord.xy;
    // ISF is y-up; the terminal reads top-down.
    vec2 cell = vec2(floor(px.x / cellW), floor((res.y - px.y) / cellH));
    vec2 inCell = vec2(fract(px.x / cellW), fract((res.y - px.y) / cellH));

    /* ---- seed and traits ---- */
    // The Generate button hands us a fresh value; hash it into an edition.
    float seed = fract(h11(generate * 7919.0 + 0.137) + generate * 0.61803);

    int prog = int(programMode) - 1;
    if (prog < 0) {
        // weighted-ish pick across the 11 programs
        prog = int(rndN(seed, 900.0, 11.0));
    }
    int phos = int(phosphorMode) - 1;
    if (phos < 0) {
        float r = rnd(seed, 901.0);
        phos = r < 0.42 ? 0 : (r < 0.64 ? 1 : (r < 0.78 ? 2 : (r < 0.88 ? 3 : (r < 0.96 ? 4 : 5))));
    }
    int rom = int(romMode);
    if (rom < 1) {
        float r = rnd(seed, 902.0);
        rom = r < 0.30 ? 1 : (r < 0.48 ? 2 : (r < 0.66 ? 3 : (r < 0.78 ? 4 : (r < 0.88 ? 5 : (r < 0.96 ? 6 : 7)))));
    }
    int ab = int(aberrationMode) - 1;
    if (ab < 0) {
        float r = rnd(seed, 903.0);
        ab = r < 0.55 ? 0 : (r < 0.67 ? 1 : (r < 0.77 ? 2 : (r < 0.85 ? 3 : (r < 0.92 ? 4 : (r < 0.97 ? 5 : 6)))));
    }

    float f = floor(TIME * max(1.0, refreshFps));

    /* ---- persistent aberrations that move the cell we sample ---- */
    vec2 sc = cell;                 // sampled cell
    float killed = 0.0;             // 1 = force blank
    float burn = 0.0;               // additive burn band

    if (ab == 2) {                  // shear: a slab slides sideways
        float start = rndN(seed, 910.0, rows);
        float depth = 3.0 + rndN(seed, 911.0, max(4.0, floor(rows * 0.5)));
        if (sc.y >= start && sc.y < start + depth) {
            sc.x = mod(sc.x + 1.0 + rndN(seed, 912.0, 9.0), cols);
        }
    } else if (ab == 6) {           // misregister: per-row 1-cell jitter
        float o = rndN(seed, 920.0 + sc.y, 3.0) - 1.0;
        if (rnd(seed, 930.0 + sc.y) > 0.5) sc.x = mod(sc.x + o + cols, cols);
    }

    if (ab == 1) {                  // line dropout
        for (int i = 0; i < 7; i++) {
            if (abs(sc.y - rndN(seed, 940.0 + float(i), rows)) < 0.5) killed = 1.0;
        }
    } else if (ab == 3) {           // dead column
        for (int i = 0; i < 4; i++) {
            if (abs(sc.x - rndN(seed, 950.0 + float(i), cols)) < 0.5) killed = 1.0;
        }
    } else if (ab == 4) {           // burn band
        float by = rndN(seed, 960.0, max(1.0, rows - 4.0));
        float bh = 2.0 + rndN(seed, 961.0, 5.0);
        if (sc.y >= by && sc.y < by + bh) burn = 1.0;
    }

    /* ---- run the program ---- */
    float inten = 0.0;
    int forced = -1;                // >= 0 forces a literal glyph

    if (prog == 0)      inten = progTape(sc, f, seed, grid);
    else if (prog == 1) inten = progMoire(sc, f, seed, grid);
    else if (prog == 2) inten = progHorizon(sc, f, seed, grid);
    else if (prog == 3) inten = progFigure(sc, f, seed, grid);
    else if (prog == 4) inten = progReversion(sc, f, seed, grid);
    else if (prog == 5) {           // Glitch: another program, coming apart
        float sub = rndN(seed, 970.0, 5.0);
        vec2 gc = sc;
        // slice offsets + stuck rows, re-rolled each frame
        float sliceY = floor(gc.y / (1.0 + rndN(seed, 971.0, 4.0)));
        if (h21(vec2(sliceY, floor(f))) > 0.72) {
            gc.x = mod(gc.x + floor(h21(vec2(sliceY, f + 3.0)) * cols), cols);
        }
        if (sub < 1.0)      inten = progMoire(gc, f, seed, grid);
        else if (sub < 2.0) inten = progHorizon(gc, f, seed, grid);
        else if (sub < 3.0) inten = progFigure(gc, f, seed, grid);
        else if (sub < 4.0) inten = progBrownian(gc, f, seed, grid);
        else                inten = progSpecimen(gc, f, seed, grid);
        // occasional inverted band
        if (h21(vec2(floor(gc.y / 3.0), floor(f * 0.5))) > 0.94) inten = 1.0 - inten;
    }
    else if (prog == 6) inten = progSpecimen(sc, f, seed, grid);
    else if (prog == 7) inten = progBrownian(sc, f, seed, grid);
    else if (prog == 8) inten = progDepth(sc, f, seed, grid);
    else if (prog == 9) { forced = progWeave(sc, f, seed, grid); inten = forced > 0 ? 0.75 : 0.0; }
    else {
        float dotI;
        forced = progBlackout(sc, f, seed, grid, dotI);
        inten = forced > 0 ? 1.0 : dotI;
        if (forced < 0) forced = -1;
    }

    /* ---- transient aberrations on the value ---- */
    if (ab == 5) {                  // bit rot: cells re-roll every frame
        if (h31(vec3(sc, f)) > 0.975) { inten = h31(vec3(sc.y, sc.x, f)); forced = -1; }
    }
    if (burn > 0.5) { inten = min(1.0, inten * 0.35 + 0.45); }
    if (killed > 0.5) { inten = 0.0; forced = 0; }

    /* ---- glyph ---- */
    float gamma = clamp(gain, 0.05, 4.0);
    float v = pow(clamp(inten, 0.0, 1.0), gamma);
    int g = forced >= 0 ? forced : romGlyph(rom, v);
    float lit = glyphMask(g, inCell);

    /* ---- phosphor ---- */
    vec3 bg, fg, dimc;
    phosphor(phos, bg, fg, dimc);
    // Burn-in dims a fixed pattern of rows, as if they had been on for years.
    vec3 ink = fg;
    if (phos == 5 && (mod(sc.y, 5.0) < 0.5 || mod(sc.y, 7.0) - 3.0 < 0.5 && mod(sc.y, 7.0) - 3.0 > -0.5)) ink = dimc;

    vec3 col = bg;
    col = mix(col, ink, lit);

    // Glow: neighbouring-cell bleed, cheap approximation of phosphor spread.
    if (glow > 0.001 && lit < 0.5) {
        float halo = glyphMask(g, clamp(inCell + vec2(0.16, 0.0), 0.0, 1.0))
                   + glyphMask(g, clamp(inCell - vec2(0.16, 0.0), 0.0, 1.0))
                   + glyphMask(g, clamp(inCell + vec2(0.0, 0.16), 0.0, 1.0))
                   + glyphMask(g, clamp(inCell - vec2(0.0, 0.16), 0.0, 1.0));
        col = mix(col, ink, clamp(halo * 0.22 * glow, 0.0, 1.0));
    }

    // Scanline on the physical pixel grid, not the cell grid.
    if (scanline > 0.001) {
        float s = 0.5 + 0.5 * cos(px.y * 3.14159);
        col *= 1.0 - scanline * 0.35 * s;
    }

    // Bezel: a thin rule inset from the frame edge.
    if (border) {
        vec2 m = min(px, res - px);
        float inset = min(res.x, res.y) * 0.012;
        float edge = min(m.x, m.y);
        if (edge < inset && edge > inset - max(1.0, min(res.x, res.y) * 0.0015)) {
            col = mix(col, dimc, 0.9);
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
