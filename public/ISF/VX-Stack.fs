/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Thick horizontal bars stacked from the bottom of the frame in two to four columns, like stacks of sheets or an equalizer built from solid slabs, in hard black and white. Every hit re-rolls one or more columns (how tall the stack stands, how thick its bars are, which ones drop out) and the picture holds still until the next hit, apart from a slow upward drift. The sound's level thickens the bars from hairlines into slabs, and a colored bar caps the column the latest hit re-rolled.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "columns", "LABEL": "Columns", "TYPE": "float", "DEFAULT": 3, "MIN": 1, "MAX": 4 },
        { "NAME": "grain", "LABEL": "Bar size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "reroll", "LABEL": "Re-roll", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Bars", "TYPE": "color", "DEFAULT": [0.95, 0.95, 0.96, 1.0] },
        { "NAME": "accent", "LABEL": "Hit marker", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// How far back a column looks for the hit that last re-rolled it.
const int LOOKBACK = 16;

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

float primaryOf(float m, float nc) {
    return floor(hash11(m * 1.731 + 0.37) * nc);
}

// Hit m re-rolls one column for sure, and each other column by chance.
bool rerolled(float m, float c, float nc) {
    if (primaryOf(m, nc) == c) return true;
    return hash11(m * 13.17 + c * 3.71 + 1.9) < reroll * 0.8;
}

float colSeed(float c, float n, float nc) {
    for (int k = 0; k < LOOKBACK; k++) {
        float m = mod(n - float(k) + 64.0, 64.0);
        if (rerolled(m, c, nc)) return m;
    }
    return mod(n - float(LOOKBACK) + 64.0, 64.0);
}

float colWeight(float c, float nc) {
    return 0.55 + hash11(c * 7.13 + nc * 3.71 + 0.5);
}

void main() {
    // Work in stored pixels so every edge lands on a pixel that is really there.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 res = RENDERSIZE / fw;
    vec2 px = floor(gl_FragCoord.xy / fw);
    float nc = clamp(floor(columns + 0.5), 1.0, 4.0);
    float n = floor(vxCount + 0.5);
    float lev = clamp(max(vxSwell, 0.85 * vxPulse), 0.0, 1.0);

    // Columns, in whole pixels, with gutters between them and round the edge.
    float g = floor(max(4.0, res.y * 0.024));
    float avail = res.x - (nc + 1.0) * g;
    float total = 0.0;
    for (int i = 0; i < 4; i++) {
        if (float(i) < nc) total += colWeight(float(i), nc);
    }
    float col = -1.0;
    float acc = 0.0;
    float left = g;
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        if (fi < nc) {
            acc += colWeight(fi, nc);
            float right = (fi == nc - 1.0) ? res.x - g : g * (fi + 1.0) + floor(avail * acc / total + 0.5);
            if (px.x >= left && px.x < right) col = fi;
            left = right + g;
        }
    }

    float cover = 0.0;
    vec3 c = vec3(0.0);
    if (col >= 0.0) {
        float sd = colSeed(col, n, nc);
        float h1 = hash21(vec2(sd + 0.5, col * 3.1 + 1.0));
        float h2 = hash21(vec2(sd + 1.5, col * 5.7 + 2.0));
        float h3 = hash21(vec2(sd + 2.5, col * 1.3 + 3.0));
        // The unit everything is measured in: a row, a few pixels tall.
        float rowPx = floor(max(2.0, res.y / mix(90.0, 26.0, clamp(grain, 0.0, 1.0))));
        // Each column's stack: how tall it stands, and the size of the blocks its bars sit in.
        float base = g;
        float topPx = base + floor(res.y * mix(0.42, 0.92, h1) / rowPx) * rowPx;
        float blk = rowPx * (2.0 + floor(h2 * 4.0));
        // A slow upward drift, in whole pixels.
        float rate = 0.6 + 0.8 * hash11(col * 4.3 + 0.9);
        float shift = floor(vxFlow * drift * rate * res.y * 0.02);
        float y = px.y - base - shift;
        float bi = floor(y / blk);
        float yIn = y - bi * blk;
        float hb = hash21(vec2(bi + 0.5, sd * 1.37 + col * 9.1 + h3));
        float hf = hash21(vec2(bi + 0.5, sd * 2.11 + col * 4.7 + 7.7));
        // Most blocks hold one bar; some are solid (they join the next into a slab), some drop out.
        float f = mix(0.22, 0.8, hf);
        if (hb < 0.12 + 0.1 * h3) f = 0.0;
        else if (hb > 0.8) f = 1.0;
        // The level thickens each bar from a hairline into its full slab.
        float k = mix(0.08, 1.0, pow(lev, 0.8));
        float barPx = f > 0.0 ? max(1.0, floor(f * k * blk + 0.5)) : 0.0;
        if (f >= 1.0) barPx = floor(mix(1.0, blk, k) + 0.5);
        bool on = yIn < barPx;
        // Some blocks hold a run of thin rules instead of one bar.
        if (hb > 0.6 && hb <= 0.8) {
            float sub = max(rowPx, floor(blk / 3.0));
            float ys = mod(yIn, sub);
            on = ys < max(1.0, floor(sub * 0.35 * k + 0.5)) && yIn < sub * 3.0;
        }
        if (px.y >= base && px.y < topPx && on) cover = 1.0;
        c = ink.rgb;

        // The marker: a colored bar capping the column the latest hit re-rolled.
        if (n > 0.5 && col == primaryOf(n, nc)) {
            float mk0 = topPx + rowPx;
            float mk1 = mk0 + max(2.0, floor(rowPx * mix(1.0, 2.5, lev) + 0.5));
            if (px.y >= mk0 && px.y < mk1) {
                cover = 1.0;
                c = accent.rgb;
            }
        }
    }

    vec3 outc = c * cover;
    float outa = vxClear ? cover : 1.0;
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
