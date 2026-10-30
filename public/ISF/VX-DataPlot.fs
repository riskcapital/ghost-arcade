/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Scientific plots of the music in one-bit hairlines. A main panel scatters every note by time and pitch, sized by velocity and joined in order; companion panels show a velocity histogram, an interval stem plot, a return map of each pitch against the last, or the gaps between notes. Hairline frames, crosshair ticks and fine figures; the newest point is marked.",
    "PASSES": [
        { "TARGET": "plotLog", "PERSISTENT": true, "FLOAT": true, "WIDTH": 128, "HEIGHT": 128 },
        { "TARGET": "plotHist", "FLOAT": true, "WIDTH": 128, "HEIGHT": 128 },
        { "TARGET": "plotMeta", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "panels", "LABEL": "Panels", "TYPE": "float", "DEFAULT": 3, "MIN": 2, "MAX": 4 },
        { "NAME": "window", "LABEL": "History length", "TYPE": "float", "DEFAULT": 4, "MIN": 1, "MAX": 12 },
        { "NAME": "pointSize", "LABEL": "Point size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWeight", "LABEL": "Line weight", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "labels", "LABEL": "Labels", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "grid", "LABEL": "Grid", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Plot", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Newest point", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// plotLog: 64 slots (slot = note count) on an 8 x 8 grid of 16-texel cells:
// (MIDI note + 1, velocity 0-127, whole seconds of age, fraction of a second).
// plotHist: cells 0-15 hold the velocity histogram of the notes in view, cell 16 its peak.
// plotMeta: (last count + 1).
const float GRID = 8.0;
const float P_LO = 24.0;
const float P_HI = 108.0;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

vec2 cellUv(float m) {
    return (vec2(mod(m, GRID), floor(m / GRID)) + 0.5) / GRID;
}

float glyphCode(float d) {
    if (d < 0.5) return 31599.0;
    if (d < 1.5) return 29850.0;
    if (d < 2.5) return 29671.0;
    if (d < 3.5) return 31143.0;
    if (d < 4.5) return 18925.0;
    if (d < 5.5) return 31183.0;
    if (d < 6.5) return 31695.0;
    if (d < 7.5) return 9383.0;
    if (d < 8.5) return 31727.0;
    if (d < 9.5) return 31215.0;
    return 448.0;   // minus
}

// Whole number v (sign shown) at glyph pixel c (x right, y down from the top-left).
float numberPix(vec2 c, float v) {
    float a = abs(floor(v + 0.5));
    float nd = a < 9.5 ? 1.0 : (a < 99.5 ? 2.0 : (a < 999.5 ? 3.0 : 4.0));
    float neg = v < -0.5 ? 1.0 : 0.0;
    if (c.x < 0.0 || c.y < 0.0 || c.y > 4.0) return 0.0;
    float j = floor(c.x / 4.0);
    if (j >= nd + neg) return 0.0;
    float lx = c.x - j * 4.0;
    if (lx > 2.5) return 0.0;
    float d;
    if (neg > 0.5 && j < 0.5) {
        d = 10.0;
    } else {
        float place = nd - 1.0 - (j - neg);
        d = mod(floor(a / (place < 0.5 ? 1.0 : (place < 1.5 ? 10.0 : (place < 2.5 ? 100.0 : 1000.0))) + 0.0001), 10.0);
    }
    return mod(floor((glyphCode(d) + 0.5) / exp2(c.y * 3.0 + lx)), 2.0);
}

float ageOf(vec4 e) {
    return e.z + e.w;
}

// Distance in stored rows from p to segment ab (points already in row units).
float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    return length(pa - ba * t);
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float win = clamp(window, 1.0, 12.0);

    if (PASSINDEX == 0) {
        vec2 cell = floor(gl_FragCoord.xy / RENDERSIZE * GRID);
        float s = cell.y * GRID + cell.x;
        vec4 e = IMG_NORM_PIXEL(plotLog, (cell + 0.5) / GRID);
        vec4 meta = IMG_NORM_PIXEL(plotMeta, vec2(0.5));
        bool ready = meta.x > 0.5 && FRAMEINDEX >= 2;
        if (!ready) e = vec4(0.0, 0.0, 999.0, 0.0);
        // Age in whole seconds plus a fraction, so it stays exact at hsz precision.
        e.w += dt;
        if (e.w >= 1.0) { e.w -= 1.0; e.z = min(e.z + 1.0, 999.0); }
        float delta = ready ? mod(n - (meta.x - 1.0) + 64.0, 64.0) : 0.0;
        float back = mod(n - s + 64.0, 64.0);
        if (delta > 0.5 && back < delta) {
            // The newest note is exact; others that landed in the same frame
            // (a chord) take the other sounding notes.
            float p = vxPitch;
            float v = vxVel;
            if (back > 0.5) {
                p = back < 1.5 ? vxNote1 : (back < 2.5 ? vxNote2 : 0.0);
                v = back < 1.5 ? vxNoteE1 : vxNoteE2;
                if (abs(p - vxPitch) < 0.002) p = vxNote0;
            }
            e = p > 0.0 ? vec4(floor(p * 127.0 + 0.5) + 1.0, floor(clamp(v, 0.0, 1.0) * 127.0 + 0.5), 0.0, 0.0)
                        : vec4(0.0, 0.0, 999.0, 0.0);
        }
        gl_FragColor = e;
        return;
    }
    if (PASSINDEX == 1) {
        vec2 cell = floor(gl_FragCoord.xy / RENDERSIZE * GRID);
        float c = cell.y * GRID + cell.x;
        float count = 0.0;
        float peak = 0.0;
        if (c < 16.5) {
            for (int k = 0; k < 64; k++) {
                vec4 e = IMG_NORM_PIXEL(plotLog, cellUv(float(k)));
                if (e.x > 0.5 && ageOf(e) < win) {
                    float bin = floor(e.y / 8.0);
                    count += bin == c ? 1.0 : 0.0;
                }
            }
        }
        gl_FragColor = vec4(count, 0.0, 0.0, 1.0);
        return;
    }
    if (PASSINDEX == 2) {
        gl_FragColor = vec4(n + 1.0, 0.0, 0.0, 1.0);
        return;
    }

    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 res = floor(RENDERSIZE / fw + 0.5);
    vec2 P = floor(gl_FragCoord.xy / fw);
    float ax = fw.y / fw.x;                      // stored columns per stored row on screen
    float S = floor(clamp(seed, 0.0, 1.0) * 99.0 + 0.5);
    float fs = max(1.0, floor(res.y / 500.0));
    vec2 gs = vec2(max(1.0, floor(fs * ax + 0.5)), fs);   // glyph pixel

    // Panels: count from the control, arrangement and mappings from the seed.
    float np = clamp(floor(panels + 0.5), 2.0, 4.0);
    float arr = hash11(S * 1.91 + 0.3) < 0.5 ? 0.0 : 1.0;
    float mx = floor(res.x * 0.05);
    float my = floor(res.y * 0.07);
    float g = floor(res.y * 0.045);
    vec2 lo = vec2(mx, my);
    vec2 hi = res - vec2(mx, my);
    vec2 sz = hi - lo;
    vec4 r0, r1, r2, r3;                          // (x0, y0, x1, y1)
    float split = floor(mix(0.55, 0.66, hash11(S * 2.3 + 0.9)) * 100.0) / 100.0;
    if (np < 2.5) {
        if (arr < 0.5) {
            float xs = lo.x + floor(sz.x * split);
            r0 = vec4(lo, xs, hi.y); r1 = vec4(xs + g, lo.y, hi);
        } else {
            float ys = hi.y - floor(sz.y * split);
            r0 = vec4(lo.x, ys, hi); r1 = vec4(lo, hi.x, ys - g);
        }
        r2 = vec4(-1.0); r3 = vec4(-1.0);
    } else if (np < 3.5) {
        if (arr < 0.5) {
            float ys = hi.y - floor(sz.y * split);
            float xm = lo.x + floor(sz.x * 0.5);
            r0 = vec4(lo.x, ys, hi); r1 = vec4(lo, xm - floor(g * 0.5), ys - g); r2 = vec4(xm + floor(g * 0.5), lo.y, hi.x, ys - g);
        } else {
            float xs = lo.x + floor(sz.x * split);
            float ym = lo.y + floor(sz.y * 0.5);
            r0 = vec4(lo, xs, hi.y); r1 = vec4(xs + g, ym + floor(g * 0.5), hi); r2 = vec4(xs + g, lo.y, hi.x, ym - floor(g * 0.5));
        }
        r3 = vec4(-1.0);
    } else {
        if (arr < 0.5) {
            float xm = lo.x + floor(sz.x * 0.5);
            float ym = lo.y + floor(sz.y * 0.5);
            float hg = floor(g * 0.5);
            r0 = vec4(lo.x, ym + hg, xm - hg, hi.y); r1 = vec4(xm + hg, ym + hg, hi);
            r2 = vec4(lo, xm - hg, ym - hg); r3 = vec4(xm + hg, lo.y, hi.x, ym - hg);
        } else {
            float ys = hi.y - floor(sz.y * split);
            float w3 = floor((sz.x - 2.0 * g) / 3.0);
            r0 = vec4(lo.x, ys, hi);
            r1 = vec4(lo.x, lo.y, lo.x + w3, ys - g);
            r2 = vec4(lo.x + w3 + g, lo.y, lo.x + 2.0 * w3 + g, ys - g);
            r3 = vec4(lo.x + 2.0 * w3 + 2.0 * g, lo.y, hi.x, ys - g);
        }
    }

    float pid = -1.0;
    vec4 R = vec4(0.0);
    if (P.x >= r0.x && P.x < r0.z && P.y >= r0.y && P.y < r0.w) { pid = 0.0; R = r0; }
    if (P.x >= r1.x && P.x < r1.z && P.y >= r1.y && P.y < r1.w) { pid = 1.0; R = r1; }
    if (r2.x >= 0.0 && P.x >= r2.x && P.x < r2.z && P.y >= r2.y && P.y < r2.w) { pid = 2.0; R = r2; }
    if (r3.x >= 0.0 && P.x >= r3.x && P.x < r3.z && P.y >= r3.y && P.y < r3.w) { pid = 3.0; R = r3; }

    float lit = 0.0;
    float red = 0.0;
    if (pid >= 0.0) {
        // Mapping: 0 pitch over time, 1 velocity histogram, 2 interval stems, 3 return map, 4 gaps.
        float rot = floor(hash11(S * 3.7 + 1.1) * 4.0);
        float kind = pid < 0.5 ? 0.0 : 1.0 + mod(pid - 1.0 + rot, 4.0);
        vec2 L = P - R.xy;                       // local, origin bottom-left
        vec2 W = R.zw - R.xy;
        float lw = max(1.0, floor(mix(1.0, 4.0, lineWeight) * fs * 0.5 + 0.5));

        // Hairline frame, crosshair ticks on a grid, and the figures.
        bool frame = L.x < 1.0 || L.y < 1.0 || L.x > W.x - 1.5 || L.y > W.y - 1.5;
        if (frame) lit = 1.0;
        float cells = 8.0;
        vec2 cs = W / cells;
        vec2 gc = floor(L / cs + 0.5) * cs;
        vec2 dg = abs(L - floor(gc));
        float arm = max(2.0, floor(3.0 * fs * mix(0.5, 1.5, grid)));
        if (grid > 0.02 && gc.x > 0.5 && gc.y > 0.5 && gc.x < W.x - 0.5 && gc.y < W.y - 0.5
            && ((dg.x < 0.5 && dg.y * 1.0 <= arm) || (dg.y < 0.5 && dg.x <= arm * ax))) lit = 1.0;
        // Frame ticks along the left and bottom edges.
        if ((L.x < 3.0 * gs.x && abs(L.y - floor(gc.y)) < 0.5) || (L.y < 3.0 * fs && abs(L.x - floor(gc.x)) < 0.5)) lit = 1.0;

        float lab = clamp(labels, 0.0, 1.0);

        if (kind < 0.5) {
            // Pitch over time: x = age (now at the right), y = pitch.
            vec2 pp = vec2(-1.0);
            bool hasPrev = false;
            for (int k = 0; k < 64; k++) {
                float m = mod(n - float(k) + 64.0, 64.0);
                vec4 e = IMG_NORM_PIXEL(plotLog, cellUv(m));
                float age = ageOf(e);
                bool ok = e.x > 0.5 && age < win;
                if (ok) {
                    vec2 pt = vec2(floor(W.x - 1.0 - age / win * (W.x - 2.0)), floor((e.x - 1.0 - P_LO) / (P_HI - P_LO) * (W.y - 2.0)) + 1.0);
                    float hsz = floor(mix(1.0, 7.0, pointSize) * fs * (0.35 + 0.65 * e.y / 127.0));
                    vec2 d = abs(L - pt);
                    bool inPt = d.x <= hsz * ax && d.y <= hsz;
                    if (inPt) {
                        lit = 1.0;
                        if (k == 0) red = 1.0;
                    }
                    if (hasPrev && lineWeight > 0.01) {
                        vec2 a = vec2(L.x / ax, L.y);
                        float dd = segDist(a, vec2(pt.x / ax, pt.y), vec2(pp.x / ax, pp.y));
                        if (dd < lw * 0.5 + 0.36) lit = 1.0;
                    }
                    // The newest point: crosshair across the panel and its pitch.
                    if (k == 0) {
                        bool cross = (abs(L.x - pt.x) < 0.5 || abs(L.y - pt.y) < 0.5) && mod(L.x + L.y, 4.0) < 1.5;
                        if (cross && grid > 0.02) lit = 1.0;
                        if (lab > 0.3) {
                            vec2 c = floor(vec2(L.x - pt.x - (hsz + 3.0) * ax, pt.y + hsz + 7.0 * fs - L.y) / gs);
                            if (numberPix(c, e.x - 1.0) > 0.5) lit = 1.0;
                        }
                    }
                    pp = pt;
                    hasPrev = true;
                } else {
                    hasPrev = false;
                }
            }
            // Seconds along the bottom.
            if (lab > 0.01) {
                for (int i = 1; i < 12; i++) {
                    float sv = float(i);
                    if (sv < win) {
                        float xv = floor(W.x - 1.0 - sv / win * (W.x - 2.0));
                        if (abs(L.x - xv) < 0.5 && L.y < 3.0 * fs) lit = 1.0;
                        vec2 c = floor(vec2(L.x - xv + 2.0 * gs.x, 10.0 * fs - L.y) / gs);
                        if (numberPix(c, -sv) > 0.5) lit = 1.0;
                    }
                }
            }
            // Pitch figures on the left.
            if (lab > 0.01) {
                for (int i = 1; i < 7; i++) {
                    float pv = P_LO + float(i) * 12.0;
                    float yv = floor((pv - P_LO) / (P_HI - P_LO) * (W.y - 2.0)) + 1.0;
                    vec2 c = floor(vec2(L.x - 5.0 * gs.x, yv + 2.0 * fs - L.y) / gs);
                    if (numberPix(c, pv) > 0.5) lit = 1.0;
                }
            }
        } else if (kind < 1.5) {
            // Velocity histogram: 16 bins.
            float bw = W.x / 16.0;
            float bi = floor(L.x / bw);
            float peak = 1.0;
            for (int i = 0; i < 16; i++) peak = max(peak, IMG_NORM_PIXEL(plotHist, cellUv(float(i))).r);
            float cnt = IMG_NORM_PIXEL(plotHist, cellUv(bi)).r;
            float h = floor(cnt / peak * (W.y - 4.0 * fs - 10.0 * fs));
            float inB = L.x - bi * bw;
            if (cnt > 0.5 && L.y >= 1.0 && L.y <= h && inB >= max(1.0, floor(bw * 0.18)) && inB < bw - max(1.0, floor(bw * 0.18))) lit = 1.0;
            if (lab > 0.01 && cnt > 0.5) {
                vec2 c = floor(vec2(L.x - bi * bw - floor(bw * 0.2), h + 7.0 * fs - L.y) / gs);
                if (numberPix(c, cnt) > 0.5) lit = 1.0;
            }
        } else if (kind < 2.5) {
            // Interval stems: the step from each note to the next, newest at the right.
            float N = 32.0;
            float cw = W.x / N;
            float ci = floor(L.x / cw);
            float k = N - 1.0 - ci;
            float m = mod(n - k + 64.0, 64.0);
            vec4 e = IMG_NORM_PIXEL(plotLog, cellUv(m));
            vec4 ep = IMG_NORM_PIXEL(plotLog, cellUv(mod(m - 1.0 + 64.0, 64.0)));
            float y0 = floor(W.y * 0.5);
            if (abs(L.y - y0) < 0.5 && mod(L.x, 3.0 * gs.x) < gs.x) lit = 1.0;
            if (e.x > 0.5 && ep.x > 0.5 && ageOf(e) < win) {
                float iv = clamp(e.x - ep.x, -24.0, 24.0);
                float yv = y0 + floor(iv / 24.0 * (W.y * 0.5 - 6.0 * fs));
                float xc = floor(ci * cw + cw * 0.5);
                bool stem = abs(L.x - xc) < 0.5 && L.y >= min(y0, yv) && L.y <= max(y0, yv);
                float hs = max(1.0, floor(fs * mix(1.0, 3.0, pointSize)));
                bool head = abs(L.x - xc) <= hs * ax && abs(L.y - yv) <= hs;
                if (stem || head) lit = 1.0;
                if (head && k < 0.5) red = 1.0;
            }
            if (lab > 0.01) {
                vec2 c1 = floor(vec2(L.x - W.x + 12.0 * gs.x, W.y - 3.0 * fs - L.y) / gs);
                vec2 c2 = floor(vec2(L.x - W.x + 12.0 * gs.x, 8.0 * fs - L.y) / gs);
                if (numberPix(c1, 24.0) > 0.5 || numberPix(c2, -24.0) > 0.5) lit = 1.0;
            }
        } else if (kind < 3.5) {
            // Return map: each pitch against the one before, with the diagonal.
            float span = P_HI - P_LO;
            vec2 sq = vec2(W.x - 2.0, W.y - 2.0);
            if (abs(L.x / sq.x - L.y / sq.y) * sq.y < 0.6 && mod(L.y, 4.0) < 1.5) lit = 1.0;
            vec4 e = IMG_NORM_PIXEL(plotLog, cellUv(n));
            for (int k = 0; k < 32; k++) {
                float m = mod(n - float(k) + 64.0, 64.0);
                vec4 ep = IMG_NORM_PIXEL(plotLog, cellUv(mod(m - 1.0 + 64.0, 64.0)));
                if (e.x > 0.5 && ep.x > 0.5 && ageOf(e) < win * 2.0) {
                    vec2 pt = floor(vec2((ep.x - 1.0 - P_LO) / span * sq.x, (e.x - 1.0 - P_LO) / span * sq.y)) + 1.0;
                    float hs = floor(mix(1.0, 5.0, pointSize) * fs * (0.4 + 0.6 * e.y / 127.0));
                    vec2 d = abs(L - pt);
                    if (d.x <= hs * ax && d.y <= hs) {
                        lit = 1.0;
                        if (k == 0) red = 1.0;
                    }
                }
                e = ep;
            }
        } else {
            // Gaps: seconds between notes on a log scale, as a line graph.
            float N = 32.0;
            float cw = (W.x - 2.0) / (N - 1.0);
            vec2 pp = vec2(-1.0);
            bool hasPrev = false;
            vec4 e = IMG_NORM_PIXEL(plotLog, cellUv(n));
            for (int k = 0; k < 32; k++) {
                float m = mod(n - float(k) + 64.0, 64.0);
                vec4 ep = IMG_NORM_PIXEL(plotLog, cellUv(mod(m - 1.0 + 64.0, 64.0)));
                bool ok = e.x > 0.5 && ep.x > 0.5 && ageOf(e) < win * 2.0;
                if (ok) {
                    float gap = max(ageOf(ep) - ageOf(e), 0.01);
                    float yv = clamp((log2(gap) + 5.0) / 7.0, 0.0, 1.0);
                    vec2 pt = vec2(floor(W.x - 1.0 - float(k) * cw), floor(yv * (W.y - 4.0)) + 2.0);
                    vec2 d = abs(L - pt);
                    float hs = max(1.0, floor(fs * mix(1.0, 3.0, pointSize)));
                    if (d.x <= hs * ax && d.y <= hs) {
                        lit = 1.0;
                        if (k == 0) red = 1.0;
                    }
                    if (hasPrev) {
                        float dd = segDist(vec2(L.x / ax, L.y), vec2(pt.x / ax, pt.y), vec2(pp.x / ax, pp.y));
                        if (dd < lw * 0.5 + 0.36) lit = 1.0;
                    }
                    pp = pt;
                    hasPrev = true;
                } else {
                    hasPrev = false;
                }
                e = ep;
            }
        }

        // The panel's number in the top-left corner.
        if (lab > 0.5) {
            vec2 c = floor(vec2(L.x - 3.0 * gs.x, W.y - 3.0 * fs - L.y) / gs);
            if (numberPix(c, pid + 1.0) > 0.5) lit = 1.0;
        }
    }

    vec3 col = ink.rgb * lit;
    if (red > 0.5) col = accent.rgb;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
