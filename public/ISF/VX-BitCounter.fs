/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A binary readout as architecture. Every note of the sound it follows is written as columns of bits (its MIDI note, velocity, note count and bar), filled squares for ones and hairline squares for zeros, with small figures beneath. The columns fill the frame as a grid and the log steps one place left on each note. The most significant bit that changed is marked.",
    "PASSES": [
        { "TARGET": "noteLog", "PERSISTENT": true, "FLOAT": true, "WIDTH": 128, "HEIGHT": 128 },
        { "TARGET": "logMeta", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "columns", "LABEL": "Columns", "TYPE": "float", "DEFAULT": 48, "MIN": 16, "MAX": 96 },
        { "NAME": "cellSize", "LABEL": "Cell size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "gap", "LABEL": "Gap", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "history", "LABEL": "History", "TYPE": "float", "DEFAULT": 40, "MIN": 4, "MAX": 64 },
        { "NAME": "numerals", "LABEL": "Numerals", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Bits", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Changed bit", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// noteLog: 64 slots on an 8 x 8 grid of 16-texel cells, slot = note count:
// (MIDI note + 1, velocity 0-127, bar, 1 when written). logMeta: (last count + 1).
const float GRID = 8.0;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

vec2 slotUv(float m) {
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
    return 31215.0;
}

// Three digits with leading zeros; c = glyph pixel (x right, y down).
float figurePix(vec2 c, float v) {
    if (c.x < 0.0 || c.y < 0.0 || c.y > 4.0) return 0.0;
    float j = floor(c.x / 4.0);
    if (j > 2.0) return 0.0;
    float lx = c.x - j * 4.0;
    if (lx > 2.5) return 0.0;
    float place = 2.0 - j;
    float d = mod(floor(v / (place < 0.5 ? 1.0 : (place < 1.5 ? 10.0 : 100.0)) + 0.0001), 10.0);
    return mod(floor((glyphCode(d) + 0.5) / exp2(c.y * 3.0 + lx)), 2.0);
}

float bitOf(float v, float b) {
    return mod(floor((v + 0.5) / exp2(b)), 2.0);
}

// Quantity q of a log entry: 0 note, 1 velocity, 2 count, 3 bar.
float quantity(vec4 e, float q, float m) {
    if (q < 0.5) return max(e.x - 1.0, 0.0);
    if (q < 1.5) return e.y;
    if (q < 2.5) return m;
    return e.z;
}

void main() {
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec2 cell = floor(gl_FragCoord.xy / RENDERSIZE * GRID);
        float s = cell.y * GRID + cell.x;
        vec4 e = IMG_NORM_PIXEL(noteLog, (cell + 0.5) / GRID);
        vec4 meta = IMG_NORM_PIXEL(logMeta, vec2(0.5));
        bool ready = meta.x > 0.5 && FRAMEINDEX >= 2;
        if (!ready) e = vec4(0.0);
        float delta = ready ? mod(n - (meta.x - 1.0) + 64.0, 64.0) : 0.0;
        float back = mod(n - s + 64.0, 64.0);
        if (delta > 0.5 && back < delta && back < 3.5) {
            // The newest note is exact; notes that landed in the same frame
            // take the other sounding notes.
            float p = vxPitch;
            float v = vxVel;
            if (back > 0.5) {
                p = back < 1.5 ? vxNote1 : vxNote2;
                v = back < 1.5 ? vxNoteE1 : vxNoteE2;
            }
            e = vec4(floor(p * 127.0 + 0.5) + 1.0, floor(clamp(v, 0.0, 1.0) * 127.0 + 0.5), floor(vxBars + 0.5), 1.0);
        } else if (delta > 0.5 && back < delta) {
            e = vec4(0.0);
        }
        gl_FragColor = e;
        return;
    }
    if (PASSINDEX == 1) {
        gl_FragColor = vec4(n + 1.0, 0.0, 0.0, 1.0);
        return;
    }

    // Work in whole stored pixels. ax converts a length in stored rows to stored
    // columns, so the cells stay square on screen.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 res = floor(RENDERSIZE / fw + 0.5);
    vec2 P = floor(gl_FragCoord.xy / fw);
    float ax = fw.y / fw.x;
    float S = floor(clamp(seed, 0.0, 1.0) * 99.0 + 0.5);
    float fsY = max(1.0, floor(res.y / 500.0));
    float fsX = max(1.0, floor(fsY * ax + 0.5));

    // The seed's arrangement.
    float words = hash11(S * 1.73 + 0.4) < 0.5 ? 1.0 : 0.0;   // notes as words of four columns, or one track per value
    float bits = hash11(S * 2.91 + 1.3) < 0.6 ? 8.0 : 7.0;
    float msbTop = hash11(S * 3.37 + 2.1) < 0.7 ? 1.0 : 0.0;
    float mirror = hash11(S * 4.13 + 0.8) < 0.4 ? 1.0 : 0.0;
    float group = hash11(S * 5.9 + 3.3) < 0.5 ? 4.0 : 8.0;

    float pitchX = max(4.0, floor(res.x * 0.92 / clamp(columns, 16.0, 96.0)));
    float pitchY = max(4.0, floor(pitchX / ax + 0.5));
    // Tracks need four lines (one per value), words at least two: shrink the cells to fit.
    float needLines = words > 0.5 ? 2.0 : 4.0;
    float perLine = bits + 0.4 + mix(0.4, 2.2, gap) + 5.0 * fsY / pitchY;
    float fitY = floor(res.y * 0.9 / (needLines * perLine) + 0.5);
    if (fitY < pitchY) {
        pitchY = max(4.0, fitY);
        pitchX = max(4.0, floor(pitchY * ax + 0.5));
    }
    float sideY = max(3.0, floor(pitchY * mix(0.4, 0.86, cellSize) + 0.5));
    float sideX = max(3.0, floor(sideY * ax + 0.5));
    float numH = 5.0 * fsY + floor(pitchY * 0.4);
    float lineGap = floor(pitchY * mix(0.4, 2.2, gap));
    float lineH = bits * pitchY + numH + lineGap;
    float marginY = floor(res.y * 0.05);
    float G = max(1.0, floor((res.y - 2.0 * marginY + lineGap) / lineH));
    float gridH = G * lineH - lineGap;
    float y0 = floor((res.y - gridH) * 0.5);
    float wordGap = floor(pitchX * (words > 0.5 ? mix(0.6, 2.5, gap) : mix(0.3, 1.5, gap)));
    float availX = res.x - 2.0 * floor(res.x * 0.04);

    vec3 col = vec3(0.0);
    float yy = P.y - y0;
    float line = floor(yy / lineH);
    float inLine = yy - line * lineH;
    if (yy >= 0.0 && line < G && inLine < bits * pitchY + numH) {
        float lineTop = G - 1.0 - line;           // 0 = the top line
        float perUnit = words > 0.5 ? 4.0 : group;
        float unitW = perUnit * pitchX + wordGap;
        float units = max(1.0, floor((availX + wordGap) / unitW));
        float rowW = units * unitW - wordGap;
        float x0 = floor((res.x - rowW) * 0.5);
        float xx = P.x - x0;
        float ui = floor(xx / unitW);
        float inUnit = xx - ui * unitW;
        float ci = floor(inUnit / pitchX);
        if (xx >= 0.0 && ui < units && ci < perUnit) {
            float k;
            float qn;
            if (words > 0.5) {
                // Newest word at the bottom right; older ones step left, then up.
                k = line * units + (units - 1.0 - ui);
                qn = ci;
            } else {
                // One value per line, four lines per block of history.
                float cols = units * group;
                qn = mod(lineTop, 4.0);
                k = floor(lineTop / 4.0) * cols + (cols - 1.0 - (ui * group + ci));
            }
            float m = mod(n - k + 64.0, 64.0);
            vec4 e = IMG_NORM_PIXEL(noteLog, slotUv(m));
            bool shown = k < floor(history + 0.5) && e.w > 0.5;
            float v = quantity(e, qn, m);
            vec2 lp = vec2(inUnit - ci * pitchX, inLine - numH);
            float flip = (mirror > 0.5 && mod(lineTop, 2.0) > 0.5) ? 1.0 - msbTop : msbTop;
            if (lp.y >= 0.0) {
                float bi = floor(lp.y / pitchY);
                vec2 cl = vec2(lp.x, lp.y - bi * pitchY);
                // bi counts up from the bottom; with the MSB at the top, the bottom cell is bit 0.
                float b = flip > 0.5 ? bi : bits - 1.0 - bi;
                if (cl.x < sideX && cl.y < sideY) {
                    bool edge = cl.x < 1.0 || cl.x > sideX - 1.5 || cl.y < 1.0 || cl.y > sideY - 1.5;
                    bool mid = cl.x == floor(sideX * 0.5) && cl.y == floor(sideY * 0.5);
                    float on = 0.0;
                    if (shown) {
                        on = bitOf(v, b) > 0.5 ? 1.0 : (edge ? 1.0 : 0.0);
                        // The highest bit that changed since the note before.
                        if (k < 0.5) {
                            float mp = mod(m - 1.0 + 64.0, 64.0);
                            vec4 ep = IMG_NORM_PIXEL(noteLog, slotUv(mp));
                            float vp = quantity(ep, qn, mp);
                            float top = -1.0;
                            for (int j = 7; j >= 0; j--) {
                                if (top < 0.0 && float(j) < bits && bitOf(v, float(j)) != bitOf(vp, float(j))) top = float(j);
                            }
                            if (ep.w > 0.5 && top == b && on > 0.5) {
                                col = accent.rgb;
                                on = 0.0;
                            }
                        }
                    } else {
                        on = mid ? 1.0 : 0.0;
                    }
                    col += ink.rgb * on;
                }
            } else if (shown && k < floor(numerals * history + 0.5)) {
                // Figures under the column, if they fit.
                float figW = 11.0 * fsX;
                if (figW <= pitchX - 1.0) {
                    vec2 c = floor(vec2(lp.x - floor(max(0.0, sideX - figW) * 0.5), -lp.y - floor(pitchY * 0.25)) / vec2(fsX, fsY));
                    col += ink.rgb * figurePix(c, v);
                }
            }
        }
    }

    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
