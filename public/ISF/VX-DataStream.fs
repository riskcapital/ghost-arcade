/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Rows of one-bit data streaming across the frame: bits, dashes, blocks and binary counters, each row at its own speed and direction, some racing and some nearly still. Every hit of the sound it follows turns a set of rows round or changes their speed and fires a dense packet of data along them. The seed sets the row heights and the mix of patterns.",
    "PASSES": [
        { "TARGET": "rowState", "PERSISTENT": true, "FLOAT": true, "WIDTH": 128, "HEIGHT": 128 },
        { "TARGET": "hitAgeA", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "hitAgeB", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "streamMeta", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "rows", "LABEL": "Rows", "TYPE": "float", "DEFAULT": 72, "MIN": 16, "MAX": 128 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "density", "LABEL": "Density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "burst", "LABEL": "Burst", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "flips", "LABEL": "Rows per hit", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "bitSize", "LABEL": "Bit size", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "gap", "LABEL": "Gap", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Data", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Packet head", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// rowState: one cell per row on a 16 x 16 grid of 8-texel cells, read at cell centres:
// (scroll in 1/1024 frame widths, mod 2048; its fraction; velocity; seed + 1).
// hitAgeA/B: seconds since each of the last eight hits, slot = count mod 8.
// streamMeta: (last count + 1, fraction of the phase, recent activity, unused).
const float GRID = 16.0;
const float MAX_ROWS = 128.0;
const float WRAP = 2048.0;
const float UNITS = 1024.0;

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

float seedIndex() {
    return floor(clamp(seed, 0.0, 1.0) * 99.0 + 0.5);
}

float rowCount() {
    return clamp(floor(rows + 0.5), 16.0, MAX_ROWS);
}

vec2 cellUv(float r) {
    return (vec2(mod(r, GRID), floor(r / GRID)) + 0.5) / GRID;
}

// Which rows hit m takes hold of: always its anchor row, then scattered rows,
// a run of neighbours, or every k-th row.
bool selected(float m, float r, float R, float S) {
    float anchor = floor(hash11(m * 7.31 + S * 0.71 + 3.0) * R);
    if (r == anchor) return true;
    float share = clamp(flips, 0.0, 1.0);
    float mode = hash11(m * 3.77 + S * 1.31 + 1.0);
    if (mode < 0.4) return hash21(vec2(m * 1.13 + S * 0.37, r + 0.5)) < share * 0.8;
    if (mode < 0.75) return r > anchor && r < anchor + floor(R * share * 0.7);
    float k = 2.0 + floor(hash11(m * 5.1 + S + 0.3) * 3.0);
    return mod(r, k) == mod(anchor, k) && hash21(vec2(r + 0.5, m * 2.7 + S)) < share * 1.6;
}

// Direction a hit sends a row (and its packet), and the row's new speed.
float hitDir(float m, float r, float S) {
    return hash21(vec2(m * 0.91 + S * 1.7, r * 1.37 + 5.0)) < 0.5 ? -1.0 : 1.0;
}

float rowSpeed(float h) {
    // Most rows crawl, a few race.
    return 0.008 + 0.992 * h * h * h;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float n = floor(vxCount + 0.5);
    float S = seedIndex();
    float R = rowCount();
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    vec4 meta = IMG_NORM_PIXEL(streamMeta, vec2(0.5));
    bool ready = meta.x > 0.5 && FRAMEINDEX >= 2;
    float last = meta.x - 1.0;
    float delta = ready ? mod(n - last + 64.0, 64.0) : 0.0;

    if (PASSINDEX == 0) {
        vec2 cell = floor(uv * GRID);
        float r = cell.y * GRID + cell.x;
        vec4 st = IMG_NORM_PIXEL(rowState, (cell + 0.5) / GRID);
        if (!ready || abs(st.a - (S + 1.0)) > 0.25) {
            float h = hash21(vec2(r + 0.5, S * 3.1 + 1.0));
            float dir = hash21(vec2(r * 1.7 + 2.0, S + 9.0)) < 0.5 ? -1.0 : 1.0;
            st = vec4(floor(hash21(vec2(r, S + 4.0)) * WRAP), 0.0, dir * rowSpeed(h), S + 1.0);
        }
        // Hits that landed this frame, oldest first.
        for (int k = 3; k >= 0; k--) {
            if (float(k) < delta) {
                float m = mod(n - float(k) + 64.0, 64.0);
                if (selected(m, r, R, S)) {
                    float h = hash21(vec2(m * 2.3 + S, r * 0.71 + 3.0));
                    st.b = hitDir(m, r, S) * rowSpeed(h);
                }
            }
        }
        float dph = ready ? fract(fract(vxPhase) - meta.y + 1.0) : 0.0;
        float act = clamp(meta.z, 0.0, 1.0);
        float vScale = mix(0.04, 1.4, speed * speed) * mix(0.35, 1.0, act);
        float f = st.g + st.b * vScale * dph * UNITS;
        float whole = mod(st.r + floor(f), WRAP);
        gl_FragColor = vec4(whole, fract(f), st.b, st.a);
        return;
    }

    if (PASSINDEX == 1 || PASSINDEX == 2) {
        vec4 v = PASSINDEX == 1 ? IMG_NORM_PIXEL(hitAgeA, vec2(0.5)) : IMG_NORM_PIXEL(hitAgeB, vec2(0.5));
        v = min(v + dt, vec4(30.0));
        if (!ready) v = vec4(30.0);
        vec4 slots = vec4(0.0, 1.0, 2.0, 3.0) + (PASSINDEX == 1 ? 0.0 : 4.0);
        vec4 back = mod(n - slots + 64.0, 8.0);
        v = mix(v, vec4(0.0), (1.0 - step(delta - 0.5, back)) * step(0.5, delta));
        gl_FragColor = v;
        return;
    }

    if (PASSINDEX == 3) {
        float prev = ready ? clamp(meta.z, 0.0, 1.0) : 0.0;
        float a = max(prev * pow(0.5, dt / 1.2), max(vxEnv, vxHit));
        gl_FragColor = vec4(n + 1.0, fract(vxPhase), a, 1.0);
        return;
    }

    // Work in the pixels the core really stores, so every edge is hard.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 res = floor(RENDERSIZE / fw + 0.5);
    vec2 P = floor(gl_FragCoord.xy / fw);
    float yd = res.y - 1.0 - P.y;
    float x = P.x;
    float act = smoothstep(0.0, 0.7, clamp(meta.z, 0.0, 1.0));
    float bitPx = max(1.0, floor(mix(1.0, 4.0, bitSize) * res.y / 1080.0 + 0.5));

    // Layout: three to seven blocks of rows; each block has its own row height.
    float NB = 3.0 + floor(hash11(S * 1.37 + 0.2) * 5.0);
    float sumW = 0.0;
    float sumWT = 0.0;
    for (int b = 0; b < 7; b++) {
        float fb = float(b);
        if (fb < NB) {
            float w = 0.35 + hash11(S * 2.71 + fb * 4.13 + 0.7);
            float ht = hash11(S * 1.93 + fb * 7.7 + 2.1);
            float t = ht < 0.4 ? 1.0 : (ht < 0.7 ? 1.7 : (ht < 0.9 ? 2.8 : 4.5));
            sumW += w;
            sumWT += w / t;
        }
    }
    float margin = floor(res.y * 0.035);
    float blockGap = max(2.0, floor(res.y * 0.014));
    float avail = res.y - 2.0 * margin - (NB - 1.0) * blockGap;
    float top = margin;
    float rowBase = 0.0;
    float r = -1.0;
    float blk = -1.0;
    float rowTop = 0.0;
    float rowBot = 0.0;
    float accW = 0.0;
    for (int b = 0; b < 7; b++) {
        float fb = float(b);
        if (fb < NB && r < 0.0) {
            float w = 0.35 + hash11(S * 2.71 + fb * 4.13 + 0.7);
            float ht = hash11(S * 1.93 + fb * 7.7 + 2.1);
            float t = ht < 0.4 ? 1.0 : (ht < 0.7 ? 1.7 : (ht < 0.9 ? 2.8 : 4.5));
            float k = max(1.0, floor(R * (w / t) / sumWT + 0.5));
            accW += w;
            float bottom = margin + fb * blockGap + floor(avail * accW / sumW + 0.5);
            if (yd >= top && yd < bottom) {
                float pitch = (bottom - top) / k;
                float j = floor((yd - top) / pitch);
                rowTop = top + floor(j * pitch + 0.5);
                rowBot = top + floor((j + 1.0) * pitch + 0.5);
                if (yd < rowTop) { j -= 1.0; rowBot = rowTop; rowTop = top + floor(j * pitch + 0.5); }
                if (yd >= rowBot) { j += 1.0; rowTop = rowBot; rowBot = top + floor((j + 1.0) * pitch + 0.5); }
                r = rowBase + j;
                blk = fb;
            }
            rowBase += k;
            top = bottom + blockGap;
        }
    }

    vec3 col = vec3(0.0);
    if (r >= 0.0 && r < MAX_ROWS) {
        float pitchPx = rowBot - rowTop;
        float gapPx = floor(pitchPx * gap * 0.75 + 0.5);
        if (gap > 0.01) gapPx = max(gapPx, 1.0);
        gapPx = min(gapPx, pitchPx - 1.0);
        float inRow = yd - rowTop;
        if (inRow < pitchPx - gapPx) {
            vec4 st = IMG_NORM_PIXEL(rowState, cellUv(r));
            float shift = floor((st.r + st.g) / UNITS * res.x);
            float u = mod(x + shift, 2.0 * res.x);

            // The row's recipe: its block's pattern, with a few rows going their own way.
            float bt = hash11(S * 3.3 + blk * 11.1 + 0.4);
            float own = hash21(vec2(r + 0.5, S * 1.9 + 7.0));
            float kind = own < 0.22 ? hash21(vec2(r * 3.1, S + 2.0)) : bt;
            // Combs only suit the finest rows; taller rows carry bits instead.
            if (kind >= 0.84 && pitchPx - gapPx > 4.0 * bitPx) kind = 0.1;
            float hv = hash21(vec2(r + 0.5, S * 0.7 + 13.0));
            float dens = clamp(density, 0.0, 1.0);
            // At rest the rows thin to a sparse few.
            float live = hash21(vec2(r * 0.77 + 1.0, S + 31.0)) < mix(0.4, 1.0, act) ? 1.0 : 0.0;
            // Some rows stay silent, some whisper, a few are crowded.
            float hr = hash21(vec2(r * 1.61 + 4.0, S * 2.3 + 17.0));
            float rowVar = hr < 0.16 ? 0.0 : mix(0.2, 1.5, (hr - 0.16) / 0.84);
            float p = mix(0.06, 0.55, dens) * mix(0.55, 1.0, act) * live * rowVar
                    * mix(0.5, 1.2, hash11(S * 4.7 + blk * 2.9 + 6.0));
            float on = 0.0;
            if (kind < 0.3) {
                // Bits.
                float cw = bitPx * (1.0 + floor(hv * 3.0));
                float i = floor(u / cw);
                on = hash21(vec2(i + 0.5, r * 1.31 + S)) < p ? 1.0 : 0.0;
            } else if (kind < 0.5) {
                // Dashes: one run in each group of cells.
                float G = 6.0 + floor(hv * 14.0);
                float i = floor(u / bitPx);
                float g = floor(i / G);
                float j = i - g * G;
                float a = floor(hash21(vec2(g, r + S * 0.3)) * G * 0.6);
                float l = 1.0 + floor(hash21(vec2(g + 0.5, r * 2.1 + S)) * (G - a - 1.0));
                float gOn = hash21(vec2(g * 1.3, r * 0.9 + S + 5.0)) < p * 1.25 ? 1.0 : 0.0;
                on = (j >= a && j < a + l) ? gOn : 0.0;
            } else if (kind < 0.66) {
                // Blocks.
                float cw = bitPx * (4.0 + floor(hv * 10.0));
                float i = floor(u / cw);
                on = hash21(vec2(i + 0.5, r * 0.61 + S + 2.0)) < p * 0.7 ? 1.0 : 0.0;
            } else if (kind < 0.84) {
                // A binary counter: words of eight bits counting up along the row.
                float cw = bitPx * (1.0 + floor(hv * 2.0));
                float i = floor(u / cw);
                float wd = floor(i / 9.0);
                float bi = i - wd * 9.0;
                float value = mod(wd * (1.0 + floor(hv * 5.0)) + floor(hash21(vec2(r, S)) * 256.0), 256.0);
                on = bi < 7.5 ? mod(floor((value + 0.5) / exp2(7.0 - bi)), 2.0) : 0.0;
                on *= hash21(vec2(floor(wd / 4.0), r + S * 0.5)) < p * 1.6 ? 1.0 : 0.0;
            } else {
                // A comb of hairline ticks with dropouts.
                float cw = bitPx * (3.0 + floor(hv * 4.0));
                float i = floor(u / cw);
                float fx = u - i * cw;
                on = (fx < bitPx && hash21(vec2(i + 0.5, r * 1.9 + S + 8.0)) < p * 1.4) ? 1.0 : 0.0;
            }

            // Packets fired by recent hits run across the row.
            float isHead = 0.0;
            vec4 ageA = IMG_NORM_PIXEL(hitAgeA, vec2(0.5));
            vec4 ageB = IMG_NORM_PIXEL(hitAgeB, vec2(0.5));
            float bAmt = clamp(burst, 0.0, 1.0);
            for (int k = 0; k < 8; k++) {
                float m = mod(n - float(k) + 64.0, 64.0);
                float slot = mod(m, 8.0);
                vec4 sel = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
                vec4 selB = 1.0 - step(0.5, abs(vec4(4.0, 5.0, 6.0, 7.0) - slot));
                float age = dot(ageA, sel) + dot(ageB, selB);
                if (bAmt > 0.01 && age < 2.5 && selected(m, r, R, S)) {
                    float anchor = floor(hash11(m * 7.31 + S * 0.71 + 3.0) * R);
                    bool fire = r == anchor || hash21(vec2(m * 1.7 + S, r * 3.1 + 1.0)) < bAmt;
                    if (fire) {
                        float dir = hitDir(m, r, S);
                        float s = dir > 0.0 ? x : res.x - 1.0 - x;
                        float vb = mix(1.1, 2.4, hash21(vec2(m + 3.0, r + S)));
                        float len = floor(res.x * mix(0.06, 0.32, bAmt) * mix(0.6, 1.4, hash21(vec2(m, r * 0.3 + 7.0))));
                        float head = floor(vb * age * res.x);
                        float local = head - s;
                        if (local >= 0.0 && local < len) {
                            float headW = 3.0 * bitPx;
                            float c = floor(local / bitPx);
                            float pb = 0.8 * sqrt(1.0 - local / len);
                            float bits = (mod(c, 9.0) < 7.5 && hash21(vec2(c + 0.5, m * 3.3 + r)) < pb) ? 1.0 : 0.0;
                            on = local < headW ? 1.0 : bits;
                            if (local < headW && r == anchor) isHead = 1.0;
                        }
                    }
                }
            }
            col = ink.rgb * on;
            if (isHead > 0.5) col = accent.rgb;
        }
    }

    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
