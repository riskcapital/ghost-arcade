/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A one-dimensional cellular automaton printing down the screen in crisp square cells. Every hit of the sound it follows computes one new row at the top and pushes the history down; with no hits it steps slowly on its own. On bar lines the rule changes (30, 90, 110, 150 or 45) and new seeds drop in at the pitch, so the frame fills with nested triangles, chaotic shells and travelling structures, each rule's stretch marked off by a hairline.",
    "PASSES": [
        {
            "TARGET": "cells",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "cellSize", "LABEL": "Cell size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ruleSet", "LABEL": "Rules", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["All five, by bar", "Fractal: 90 and 150", "Chaotic: 30 and 45", "Rule 110", "Rule 30", "Rule 90"] },
        { "NAME": "density", "LABEL": "Seed density", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "seedSpread", "LABEL": "Seed spread", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "rowFade", "LABEL": "Row fade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "idleSpeed", "LABEL": "Idle speed", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "gridGap", "LABEL": "Cell gap", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "seams", "LABEL": "Rule seams", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Cells", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Newest cells", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

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

// Rows on screen; cells are square.
float rowCount() {
    return floor(mix(110.0, 34.0, clamp(cellSize, 0.0, 1.0)) + 0.5);
}

// The rule for bar b: an index into 30, 90, 110, 150, 45.
float ruleIndex(float b) {
    float h = hash11(floor(b + 0.5) * 1.37 + 0.21);
    if (ruleSet == 1) return h < 0.5 ? 1.0 : 3.0;
    if (ruleSet == 2) return h < 0.5 ? 0.0 : 4.0;
    if (ruleSet == 3) return 2.0;
    if (ruleSet == 4) return 0.0;
    if (ruleSet == 5) return 1.0;
    return floor(h * 4.999);
}

// Rule number to run on a given generation. Rule 45 turns an empty row full and
// back each step; it runs as 210 and 180 in turn, which shows the same thing
// against a steady black background.
float ruleNumber(float idx, float parity) {
    if (idx < 0.5) return 30.0;
    if (idx < 1.5) return 90.0;
    if (idx < 2.5) return 110.0;
    if (idx < 3.5) return 150.0;
    return parity < 0.5 ? 210.0 : 180.0;
}

float applyRule(float rule, float l, float c, float r) {
    float k = l * 4.0 + c * 2.0 + r;
    return mod(floor(rule / exp2(k)), 2.0);
}

void main() {
    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float bars = floor(vxBars + 0.5);
    // clock: r last count, g seconds since the last step, b bar of the last step,
    // a 1 + steps taken (mod 64; 0 until the first step; its parity drives rule 45).
    bool start = FRAMEINDEX < 2;
    bool init = !start && clk.a < 0.5;
    bool hit = !start && abs(n - clk.r) > 0.5;
    float idlePeriod = mix(3.0, 0.25, idleSpeed);
    bool tick = !start && (clk.g + dt) >= idlePeriod;
    bool stepNow = init || hit || tick;
    bool newBar = init || bars != clk.b;
    float steps = max(clk.a - 1.0, 0.0);

    float rowsN = rowCount();
    float cs = RENDERSIZE.y / rowsN;
    float colsN = floor(RENDERSIZE.x / cs);
    float x0 = 0.5 * (RENDERSIZE.x - colsN * cs);

    if (PASSINDEX == 0) {
        // One texel block per cell; every texel of a cell keeps the same values:
        // r alive, g the rule index of its row, b 1 on the first row of a new rule.
        vec2 p = gl_FragCoord.xy;
        float ci = floor((p.x - x0) / cs);
        float rj = floor(p.y / cs);
        float j = rowsN - 1.0 - rj;            // 0 = newest row, at the top
        vec4 v = IMG_NORM_PIXEL(cells, gl_FragCoord.xy / RENDERSIZE);
        if (start) v = vec4(0.0);
        if (stepNow && ci >= 0.0 && ci < colsN) {
            if (j > 0.5) {
                // Push the history down one row: take the cell above, read at its centre.
                vec2 above = vec2(x0 + (ci + 0.5) * cs, (rj + 1.5) * cs) / RENDERSIZE;
                v = IMG_NORM_PIXEL(cells, above);
                v.r = step(0.5, v.r);
            } else {
                vec2 top = vec2(0.0, (rj + 0.5) * cs) / RENDERSIZE;
                float cl = mod(ci - 1.0 + colsN, colsN);
                float cr = mod(ci + 1.0, colsN);
                float l = step(0.5, IMG_NORM_PIXEL(cells, vec2((x0 + (cl + 0.5) * cs) / RENDERSIZE.x, top.y)).r);
                float c = step(0.5, IMG_NORM_PIXEL(cells, vec2((x0 + (ci + 0.5) * cs) / RENDERSIZE.x, top.y)).r);
                float r = step(0.5, IMG_NORM_PIXEL(cells, vec2((x0 + (cr + 0.5) * cs) / RENDERSIZE.x, top.y)).r);
                float idx = ruleIndex(bars);
                float alive = applyRule(ruleNumber(idx, mod(steps, 2.0)), l, c, r);
                float prevIdx = IMG_NORM_PIXEL(cells, vec2((x0 + (ci + 0.5) * cs) / RENDERSIZE.x, top.y)).g;
                // Seeds on bar lines (and every so often at rest): a few small clusters
                // around the pitch's column, xor-ed into the new row.
                bool seedNow = newBar || (tick && mod(steps, 24.0) == 0.0);
                if (seedNow) {
                    float sd = bars * 3.1 + steps * 0.73;
                    float centre = colsN * clamp(0.5 + (vxPitch - 0.47) * 1.6, 0.12, 0.88);
                    float count = 1.0 + floor(seedSpread * 3.99);
                    for (int s = 0; s < 4; s++) {
                        float fs = float(s);
                        if (fs < count) {
                            float off = fs == 0.0 ? 0.0 : (hash11(sd + fs * 5.7) - 0.5) * colsN * mix(0.2, 0.95, seedSpread);
                            float at = floor(centre + off);
                            float w = 1.0 + floor(density * density * 14.0 * hash11(sd + fs * 2.3 + 1.0));
                            float dx = ci - at;
                            if (dx >= 0.0 && dx < w) {
                                float on = (dx == 0.0 || hash21(vec2(ci, sd + fs)) < 0.55) ? 1.0 : 0.0;
                                alive = abs(alive - on);
                            }
                        }
                    }
                }
                float seam = init ? 0.0 : (abs(idx - prevIdx) > 0.5 ? 1.0 : 0.0);
                v = vec4(alive, idx, seam, 1.0);
            }
        }
        if (ci < 0.0 || ci >= colsN) v = vec4(0.0);
        gl_FragColor = v;
        return;
    }

    if (PASSINDEX == 1) {
        vec4 o = clk;
        if (start) o = vec4(n, 0.0, bars, 0.0);
        else {
            o.r = n;
            o.g = stepNow ? 0.0 : min(clk.g + dt, 30.0);
            if (stepNow) {
                o.b = bars;
                o.a = init ? 1.0 : mod(clk.a, 64.0) + 1.0;
            }
        }
        gl_FragColor = o;
        return;
    }

    // Draw: crisp square cells, the newest row brightest, older rows fading down.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 p = gl_FragCoord.xy;
    float ci = floor((p.x - x0) / cs);
    float rj = floor(p.y / cs);
    float j = rowsN - 1.0 - rj;
    vec3 col = vec3(0.0);
    if (ci >= 0.0 && ci < colsN && rj >= 0.0) {
        vec4 c = IMG_NORM_PIXEL(cells, vec2(x0 + (ci + 0.5) * cs, (rj + 0.5) * cs) / RENDERSIZE);
        float alive = step(0.5, c.r);
        vec2 local = vec2(p.x - x0 - ci * cs, p.y - rj * cs);
        // The gap between cells is never thinner than a stored pixel.
        vec2 g = max(vec2(cs * mix(0.0, 0.3, gridGap)), fw * step(0.02, gridGap));
        vec2 inCell = step(g * 0.5, local) * step(local, vec2(cs) - g * 0.5);
        float sq = inCell.x * inCell.y;
        float since = clk.g;
        float fade = exp(-j * mix(0.004, 0.1, rowFade * rowFade));
        float level = j < 0.5 ? 1.0 : (j < 1.5 ? 0.7 : 0.5 * fade);
        // The row a hit has just written flashes red, then settles to ink.
        float red = (j < 0.5 && since < 0.16) ? 1.0 : 0.0;
        col = mix(ink.rgb, accent.rgb, red) * alive * sq * level;
        // A hairline marks where a new rule took over (along the top of its first row).
        float seam = step(0.5, c.b);
        float lineY = cs - local.y;
        float hair = seam * step(lineY, max(fw.y, 1.0)) * seams * 0.4 * max(fade, 0.25);
        col = max(col, ink.rgb * hair);
        // A faint cursor line under the newest row.
        float under = (j > 0.5 && j < 1.5) ? step(cs - local.y, max(fw.y, 1.0)) * 0.12 : 0.0;
        col = max(col, ink.rgb * under);
    }
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
