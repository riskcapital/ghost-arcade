/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Real pixel sorting, done live, on a sheet of data. The sheet is rows of bars, dashes, bits and gray ramps running sideways over a ground of black and gray panels. Wherever the sheet is brighter than the threshold, its pixels are sorted along their column, a step at a time: inside a gray panel the bright marks rise and pour into long clean gradients that stop dead at the panel's edge, while the rest stays crisp. The sound's level lowers the threshold, so more panels give way; each hit pours fresh data into some of the columns, and they sort again from the start.",
    "PASSES": [
        { "TARGET": "sortA", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "sortB", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "sortC", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "sortD", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/4" },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "threshold", "LABEL": "Threshold", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "repour", "LABEL": "Columns poured again on a hit", "TYPE": "float", "DEFAULT": 0.14, "MIN": 0, "MAX": 1 },
        { "NAME": "sideways", "LABEL": "Sort sideways", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "darks", "LABEL": "Sort the black panels instead", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "cloud", "LABEL": "Rows", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Data", "TYPE": "color", "DEFAULT": [0.9, 0.94, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Marked rows", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The sort runs in four small buffers, each a copy of the one before with one more step of sorting done,
// so the picture sorts four pixels' worth every frame. A pixel in the buffers holds its color (rgb) and,
// in alpha, the hit that last poured it there (plus one; zero means nothing poured yet).
//
// One step: every pixel is paired with the one above or below it (the pairing alternates step by step), and a
// pair that is out of order swaps. Only pairs where both places are bright enough on the sheet take part, so a
// run of bright pixels sorts within itself and stops dead at its ends.

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// The panel a place lies in: its gray level (0, 0.06, 0.14 or 0.26), or -1 in the black gutters between panels.
// The frame is three bands, each cut into blocks of its own widths; the layout holds for eight hits, then changes.
float panelLevel(vec2 uv) {
    float era = floor(floor(vxCount + 0.5) / 8.0);
    float bandY = uv.y * 3.0;
    float prow = floor(bandY);
    float cuts = 3.0 + floor(hash11(prow * 3.1 + era * 7.3 + 1.0) * 3.99);
    float bandX = uv.x * cuts + hash11(prow * 7.7 + era * 1.9);
    float pcol = floor(bandX);
    if (fract(bandY) < 0.035 || fract(bandX) < 0.02) return -1.0;
    float h = hash21(vec2(pcol + era * 13.0, prow + 5.0));
    return h < 0.3 ? 0.0 : (h < 0.55 ? 0.06 : (h < 0.8 ? 0.14 : 0.26));
}

// The sheet of data. Ground: panels of black and three grays, with black gutters between them; inside a gray
// panel every row is its own step of gray. Over it: rows of marks, each row its own kind, running sideways.
vec3 painted(vec2 uv, float asp) {
    float t = vxFlow * 0.04 + TIME * 0.003;
    float x = uv.x * asp;
    float level = panelLevel(uv);
    float gutter = step(0.0, level);

    // Rows of marks.
    float rows = floor(mix(34.0, 96.0, cloud));
    float iy = floor(uv.y * rows);
    float rung = hash11(iy * 5.3 + 11.0);
    float ground = max(level, 0.0) * (0.12 + 2.6 * rung * rung);
    float inRow = step(fract(uv.y * rows), 0.6);
    float kind = hash11(iy * 1.37 + 5.0);
    float dir = hash11(iy * 2.71 + 1.0) < 0.5 ? 1.0 : -1.0;
    float xs = x + dir * t * (0.3 + 1.2 * hash11(iy * 0.93 + 2.0));
    float v = 0.0;
    if (kind < 0.2) {
        v = 0.0;
    } else if (kind < 0.58) {
        // Dashes of a few lengths and brightnesses.
        float cw = mix(0.006, 0.04, hash11(iy * 3.3 + 4.0));
        float ix = floor(xs / cw);
        v = step(hash21(vec2(ix, iy)), 0.5) * (0.3 + 0.7 * hash21(vec2(ix + 7.0, iy)));
    } else if (kind < 0.74) {
        // A gray ramp, repeating: a sawtooth from dim to full.
        float seg = fract(xs * (1.5 + 3.0 * hash11(iy + 9.0)));
        v = 0.12 + 0.88 * seg;
    } else if (kind < 0.9) {
        // Bits: fine, even cells.
        float cw = 0.004;
        float ix = floor(xs / cw);
        v = step(hash21(vec2(ix, iy + 31.0)), 0.42) * 0.85;
    } else {
        // A long bar with breaks.
        float ix = floor(xs / 0.11);
        v = step(hash21(vec2(ix, iy + 77.0)), 0.7) * 0.62 * step(0.06, fract(xs / 0.11));
    }
    v *= inRow * gutter;
    // One row in fifteen is marked in the accent.
    vec3 tone = hash11(iy * 9.1 + 3.0) < 0.07 ? accent.rgb : ink.rgb;
    return max(ink.rgb * ground, tone * v);
}

float keyOf(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

// Whether a place on the sheet takes part in the sort: whole panels do, by their gray level, and the gutters
// never do. A place already sorting (`held`) stays in until the threshold has moved well past it, so a panel
// that has poured does not snap back when the level dips.
bool sorts(vec2 uv, float cut, float held) {
    float level = panelLevel(uv);
    if (level < 0.0) return false;
    float stay = held > 0.5 ? 0.1 : 0.0;
    return darks ? level < cut + stay : level > cut - stay;
}

vec4 sortStep(int index, vec2 uv, float asp) {
    vec4 prev;
    if (index == 0) prev = IMG_NORM_PIXEL(sortD, uv);
    else if (index == 1) prev = IMG_NORM_PIXEL(sortA, uv);
    else if (index == 2) prev = IMG_NORM_PIXEL(sortB, uv);
    else prev = IMG_NORM_PIXEL(sortC, uv);

    float n = floor(vxCount + 0.5);
    float sw = clamp(vxSwell, 0.0, 1.0);
    // Louder, and more of the picture gives way.
    float cut = darks ? mix(0.01, 0.1, threshold) + 0.12 * sw : mix(0.5, 0.02, threshold) - 0.2 * sw;
    vec3 src = painted(uv, asp);
    bool mine = sorts(uv, cut, prev.a);

    // Along the sort: one buffer pixel up (or across).
    vec2 along = sideways ? vec2(1.0 / RENDERSIZE.x, 0.0) : vec2(0.0, 1.0 / RENDERSIZE.y);
    vec2 cell = floor(gl_FragCoord.xy);
    float line = sideways ? cell.y : cell.x;
    float at = sideways ? cell.x : cell.y;

    // A place outside the sort always shows the sheet as it is now.
    if (!mine || FRAMEINDEX < 2) return vec4(src, 0.0);
    // Fresh picture is poured in when a place first joins the sort, and into some of the lines on a hit.
    bool again = hash11(line * 0.731 + n * 13.7) < repour && abs(prev.a - (n + 1.0)) > 0.5;
    if (prev.a < 0.5 || (index == 0 && again && n > 0.5)) return vec4(src, n + 1.0);

    // Which neighbor this pixel is paired with on this step.
    float parity = mod(at + float(index), 2.0);
    bool lower = parity < 0.5;
    vec2 other = uv + (lower ? along : -along);
    if (other.x < 0.0 || other.y < 0.0 || other.x > 1.0 || other.y > 1.0) return prev;
    vec4 mate;
    if (index == 0) mate = IMG_NORM_PIXEL(sortD, other);
    else if (index == 1) mate = IMG_NORM_PIXEL(sortA, other);
    else if (index == 2) mate = IMG_NORM_PIXEL(sortB, other);
    else mate = IMG_NORM_PIXEL(sortC, other);
    if (mate.a < 0.5 || !sorts(other, cut, mate.a)) return prev;
    // Brighter rises (or runs right): the lower of a pair gives up the brighter color.
    float mk = keyOf(prev.rgb);
    float ok = keyOf(mate.rgb);
    bool swap = lower ? mk > ok : ok > mk;
    return swap ? vec4(mate.rgb, prev.a) : prev;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    // The frame's own shape; the sort buffers are half as wide and a quarter as tall.
    float asp = PASSINDEX < 4 ? (RENDERSIZE.x * 2.0) / (RENDERSIZE.y * 4.0) : RENDERSIZE.x / RENDERSIZE.y;

    if (PASSINDEX < 4) {
        gl_FragColor = sortStep(PASSINDEX, uv, asp);
        return;
    }

    // The picture: sorted where it sorts, the sheet itself elsewhere. Read on the buffer's own pixel centers along the
    // sort so the streaks keep their hard ends.
    vec2 size = floor(vec2(RENDERSIZE.x / 2.0, RENDERSIZE.y / 4.0));
    vec2 snapped = (floor(uv * size) + 0.5) / size;
    vec2 look = sideways ? vec2(snapped.x, uv.y) : vec2(uv.x, snapped.y);
    vec4 s = IMG_NORM_PIXEL(sortD, look);
    vec3 col = s.a > 0.5 ? s.rgb : painted(uv, asp);
    // A hit glints along the columns it poured again.
    float n = floor(vxCount + 0.5);
    float line = sideways ? floor(uv.y * size.y) : floor(uv.x * size.x);
    float poured = step(hash11(line * 0.731 + n * 13.7), repour) * step(0.5, n) * step(0.5, s.a);
    col += col * poured * clamp(vxPulse, 0.0, 1.0) * 0.2;

    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.8));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the sorted streaks are solid.
        outa = step(0.5, s.a) * clamp(max(max(col.r, col.g), col.b) * 1.6, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
