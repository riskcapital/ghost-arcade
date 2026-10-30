/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A data readout in thin seven-segment figures. Each note of the sound it follows writes its real values into the grid (note name, MIDI number, velocity, note count), in the column of its pitch; the new figures flash and settle to dim, and a cursor marks the latest note. The sheet drifts slowly upward.",
    "PASSES": [
        { "TARGET": "pitchA", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "pitchB", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "velA", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "velB", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "ageA", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "ageB", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "lastNote", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "gridCols", "LABEL": "Grid columns", "TYPE": "float", "DEFAULT": 12, "MIN": 4, "MAX": 24 },
        { "NAME": "gridRows", "LABEL": "Rows", "TYPE": "float", "DEFAULT": 9, "MIN": 3, "MAX": 18 },
        { "NAME": "digitSize", "LABEL": "Digit size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "fill", "LABEL": "Fill", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "scroll", "LABEL": "Scroll", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "flashDecay", "LABEL": "Flash decay", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "cursor", "LABEL": "Cursor", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Brightness spread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Figures", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Cursor", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The last eight notes live in 1x1 targets, four notes per target (one per
// channel), in ring slots by note count: pitch (MIDI + 1, 0 = empty),
// velocity (0-127) and seconds since the note.

// Glyph codes: 0-9 digits, 10 blank, 11 minus, 12 C, 13 d, 14 E, 15 F, 16 G,
// 17 A, 18 b, 19 sharp, 20 colon, 21 dot.
const float BLANK = 10.0;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Seven-segment masks: a=1 b=2 c=4 d=8 e=16 f=32 g=64.
float segMask(float code) {
    if (code < 0.5) return 63.0;
    if (code < 1.5) return 6.0;
    if (code < 2.5) return 91.0;
    if (code < 3.5) return 79.0;
    if (code < 4.5) return 102.0;
    if (code < 5.5) return 109.0;
    if (code < 6.5) return 125.0;
    if (code < 7.5) return 7.0;
    if (code < 8.5) return 127.0;
    if (code < 9.5) return 111.0;
    if (code < 10.5) return 0.0;
    if (code < 11.5) return 64.0;
    if (code < 12.5) return 57.0;
    if (code < 13.5) return 94.0;
    if (code < 14.5) return 121.0;
    if (code < 15.5) return 113.0;
    if (code < 16.5) return 61.0;
    if (code < 17.5) return 119.0;
    if (code < 18.5) return 124.0;
    return 0.0;
}

float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * t);
}

float bit(float mask, float i) {
    return mod(floor(mask / pow(2.0, i)), 2.0);
}

// Distance in pixels from p (pixels, origin at the glyph's lower left) to glyph `code`
// drawn in a w x h box.
float glyphDist(vec2 p, float code, float w, float h) {
    float d = 1e5;
    if (code > 18.5) {
        if (code < 19.5) {
            // Sharp: a small lattice in the upper half.
            d = min(d, segDist(p, vec2(w * 0.32, h * 0.38), vec2(w * 0.42, h * 0.9)));
            d = min(d, segDist(p, vec2(w * 0.62, h * 0.38), vec2(w * 0.72, h * 0.9)));
            d = min(d, segDist(p, vec2(w * 0.12, h * 0.55), vec2(w * 0.9, h * 0.55)));
            d = min(d, segDist(p, vec2(w * 0.12, h * 0.74), vec2(w * 0.9, h * 0.74)));
        } else if (code < 20.5) {
            d = min(segDist(p, vec2(w * 0.5, h * 0.28), vec2(w * 0.5, h * 0.3)),
                    segDist(p, vec2(w * 0.5, h * 0.7), vec2(w * 0.5, h * 0.72)));
        } else {
            d = segDist(p, vec2(w * 0.5, h * 0.02), vec2(w * 0.5, h * 0.04));
        }
        return d;
    }
    float m = segMask(code);
    if (m < 0.5) return d;
    float g = h * 0.06;
    float hm = h * 0.5;
    if (bit(m, 0.0) > 0.5) d = min(d, segDist(p, vec2(g, h), vec2(w - g, h)));
    if (bit(m, 1.0) > 0.5) d = min(d, segDist(p, vec2(w, h - g), vec2(w, hm + g)));
    if (bit(m, 2.0) > 0.5) d = min(d, segDist(p, vec2(w, hm - g), vec2(w, g)));
    if (bit(m, 3.0) > 0.5) d = min(d, segDist(p, vec2(g, 0.0), vec2(w - g, 0.0)));
    if (bit(m, 4.0) > 0.5) d = min(d, segDist(p, vec2(0.0, g), vec2(0.0, hm - g)));
    if (bit(m, 5.0) > 0.5) d = min(d, segDist(p, vec2(0.0, hm + g), vec2(0.0, h - g)));
    if (bit(m, 6.0) > 0.5) d = min(d, segDist(p, vec2(g, hm), vec2(w - g, hm)));
    return d;
}

float digitOf(float v, float place) {
    return mod(floor(v / pow(10.0, place) + 0.0001), 10.0);
}

// Letter and sharp for a pitch class.
float noteLetter(float pc) {
    if (pc < 1.5) return 12.0;
    if (pc < 3.5) return 13.0;
    if (pc < 4.5) return 14.0;
    if (pc < 6.5) return 15.0;
    if (pc < 8.5) return 16.0;
    if (pc < 10.5) return 17.0;
    return 18.0;
}

float isSharp(float pc) {
    return (pc == 1.0 || pc == 3.0 || pc == 6.0 || pc == 8.0 || pc == 10.0) ? 1.0 : 0.0;
}

// Character j of a written cell. kind: 0 note name, 1 MIDI number, 2 velocity, 3 count.
float writtenChar(float kind, float j, float midi, float vel, float count) {
    if (kind < 0.5) {
        float pc = mod(midi, 12.0);
        float octave = clamp(floor(midi / 12.0) - 1.0, 0.0, 9.0);
        float sharp = isSharp(pc);
        if (j < 0.5) return noteLetter(pc);
        if (j < 1.5) return sharp > 0.5 ? 19.0 : octave;
        if (j < 2.5) return sharp > 0.5 ? octave : BLANK;
        return BLANK;
    }
    if (kind < 2.5) {
        float v = kind < 1.5 ? midi : vel;
        if (j < 2.5) return digitOf(v, 2.0 - j);
        return BLANK;
    }
    if (j < 0.5) return 19.0;
    if (j < 2.5) return digitOf(count, 2.0 - j);
    return BLANK;
}

// Character j of a dim static figure, from the cell's hash.
float staticChar(float h1, float h2, float j, float live, float bars) {
    if (h1 < 0.5) {
        // Three digits.
        if (j < 2.5) return digitOf(floor(h2 * 1000.0), 2.0 - j);
        return BLANK;
    }
    if (h1 < 0.66) {
        return j < 1.5 + floor(h2 * 2.0) ? 11.0 : BLANK;
    }
    if (h1 < 0.86) {
        // Two digits, a point, one digit.
        if (j < 1.5) return digitOf(floor(h2 * 100.0), 1.0 - j);
        if (j < 2.5) return 21.0;
        if (j < 3.5) return digitOf(floor(h2 * 7919.0), 0.0);
        return BLANK;
    }
    if (h1 < 0.94) {
        // The live note count.
        if (j < 0.5) return 19.0;
        if (j < 2.5) return digitOf(live, 2.0 - j);
        return BLANK;
    }
    // The live bar.
    if (j < 0.5) return 18.0;
    if (j < 2.5) return digitOf(bars, 2.0 - j);
    return BLANK;
}

vec4 pick4(float slot) {
    return 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
}

void main() {
    float n = floor(vxCount + 0.5);

    if (PASSINDEX < 6) {
        float last = IMG_NORM_PIXEL(lastNote, vec2(0.5)).r;
        vec4 v;
        if (PASSINDEX == 0) v = IMG_NORM_PIXEL(pitchA, vec2(0.5));
        else if (PASSINDEX == 1) v = IMG_NORM_PIXEL(pitchB, vec2(0.5));
        else if (PASSINDEX == 2) v = IMG_NORM_PIXEL(velA, vec2(0.5));
        else if (PASSINDEX == 3) v = IMG_NORM_PIXEL(velB, vec2(0.5));
        else if (PASSINDEX == 4) v = IMG_NORM_PIXEL(ageA, vec2(0.5));
        else v = IMG_NORM_PIXEL(ageB, vec2(0.5));
        float base4 = mod(float(PASSINDEX), 2.0) * 4.0;
        float kindOf = floor(float(PASSINDEX) / 2.0);       // 0 pitch, 1 velocity, 2 age
        if (FRAMEINDEX < 2) v = kindOf > 1.5 ? vec4(60.0) : vec4(0.0);
        if (kindOf > 1.5) v = min(v + clamp(TIMEDELTA, 0.0, 0.1), vec4(60.0));
        float delta = mod(n - last + 64.0, 64.0);
        if (FRAMEINDEX >= 2 && delta > 0.5) {
            vec4 slots = vec4(0.0, 1.0, 2.0, 3.0) + base4;
            // Slots skipped by notes that came in the same frame are cleared.
            vec4 back = mod(n - slots + 64.0, 8.0);
            vec4 skipped = step(0.5, back) * (1.0 - step(delta - 0.5, back));
            if (kindOf < 0.5) v *= 1.0 - skipped;
            vec4 here = pick4(mod(n, 8.0) - base4);
            float value = kindOf < 0.5 ? floor(vxPitch * 127.0 + 0.5) + 1.0
                        : (kindOf < 1.5 ? floor(vxVel * 127.0 + 0.5) : 0.0);
            v = mix(v, vec4(value), here);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 6) {
        gl_FragColor = vec4(n, 0.0, 0.0, 1.0);
        return;
    }

    // The core may store this layer coarser than its render size; aa is one stored pixel.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float aa = max(fw.x, fw.y);

    vec4 pA = IMG_NORM_PIXEL(pitchA, vec2(0.5));
    vec4 pB = IMG_NORM_PIXEL(pitchB, vec2(0.5));
    vec4 vA = IMG_NORM_PIXEL(velA, vec2(0.5));
    vec4 vB = IMG_NORM_PIXEL(velB, vec2(0.5));
    vec4 aA = IMG_NORM_PIXEL(ageA, vec2(0.5));
    vec4 aB = IMG_NORM_PIXEL(ageB, vec2(0.5));

    float C = clamp(floor(gridCols + 0.5), 4.0, 24.0);
    float R = clamp(floor(gridRows + 0.5), 3.0, 18.0);
    vec2 cellPx = RENDERSIZE / vec2(C, R);
    float px = RENDERSIZE.y / 1080.0;

    // The sheet drifts upward and wraps: a loop of R + 1 rows, one more than
    // fit on screen, so the rows cut by the top and bottom edges are never the same.
    float RL = R + 1.0;
    float yTop = RENDERSIZE.y - gl_FragCoord.y;
    float yRows = yTop / cellPx.y + vxPhase * scroll * 0.8;
    float tr = mod(floor(yRows), RL);
    float ci = floor(gl_FragCoord.x / cellPx.x);
    vec2 local = vec2(gl_FragCoord.x - ci * cellPx.x, (1.0 - fract(yRows)) * cellPx.y);

    // Which recent note, if any, wrote this cell.
    float found = -1.0;
    float kind = 0.0;
    float midi = 0.0;
    float vel = 0.0;
    float age = 60.0;
    float cursorCol = -1.0;
    float cursorRow = -1.0;
    for (int k = 0; k < 8; k++) {
        float m = mod(n - float(k) + 64.0, 64.0);
        float slot = mod(m, 8.0);
        vec4 sa = pick4(slot);
        vec4 sb = pick4(slot - 4.0);
        float stored = dot(pA, sa) + dot(pB, sb);
        if (stored > 0.5 && found < 0.0) {
            float p = stored - 1.0;
            float cm = mod(p, C);
            float rm = mod(m * 5.0 + 2.0, RL);
            if (k == 0) { cursorCol = cm; cursorRow = rm; }
            // Most notes write down a column; every fourth writes along a row.
            float j = -1.0;
            if (mod(m, 4.0) == 0.0) {
                if (tr == rm && mod(ci - cm + C, C) < 3.5) j = mod(ci - cm + C, C);
            } else {
                if (ci == cm && mod(tr - rm + RL, RL) < 3.5) j = mod(tr - rm + RL, RL);
            }
            if (j >= 0.0) {
                found = float(k);
                kind = j;
                midi = p;
                vel = dot(vA, sa) + dot(vB, sb);
                age = dot(aA, sa) + dot(aB, sb);
            }
        }
    }

    // Glyph box: fits four characters across the cell.
    float gh = mix(0.28, 0.72, digitSize) * cellPx.y;
    gh = min(gh, cellPx.x * 0.8 / (4.0 * 0.78));
    gh = max(gh, 9.0 * fw.y);
    float gw = gh * 0.5;
    float adv = gh * 0.78;
    vec2 origin = vec2(cellPx.x * 0.1, (cellPx.y - gh) * 0.5);
    vec2 q = local - origin;
    float jc = floor(q.x / adv);
    // Each glyph sits centred in its slot, so no stroke is cut by the slot edge.
    vec2 inChar = vec2(q.x - jc * adv - (adv - gw) * 0.5, q.y);

    float level = 0.0;
    float bold = 0.0;
    float code = BLANK;
    if (found >= 0.0) {
        code = writtenChar(kind, jc, midi, vel, mod(n - found + 64.0, 64.0));
        // Snaps bright on the note, settles to dim, thins out as newer notes arrive.
        float flash = exp(-age / mix(0.06, 0.9, flashDecay * flashDecay));
        float settle = 0.34 * (1.0 - smoothstep(4.5, 7.5, found));
        level = mix(settle, 1.0, flash) * (0.7 + 0.3 * vel / 127.0);
        bold = flash;
    } else {
        float h0 = hash21(vec2(ci + 0.37, tr * 1.31 + RL * 7.0));
        if (h0 < fill * 0.75) {
            float h1 = hash21(vec2(ci * 3.1 + 5.0, tr + 11.0));
            float h2 = hash21(vec2(ci + 17.0, tr * 2.7 + 3.0));
            code = staticChar(h1, h2, jc, n, floor(vxBars + 0.5));
            level = 0.1 + spread * 0.32 * hash21(vec2(ci + 41.0, tr + 9.0));
        }
    }

    // Fresh figures land bold and thin out as they settle.
    float sw = max(1.3 * px, aa) * (1.0 + 0.9 * bold);
    float d = 1e5;
    if (jc >= 0.0 && jc < 4.0 && code != BLANK) {
        d = glyphDist(inChar, code, gw, gh);
    }
    float stroke = clamp((0.5 * sw - d) / aa + 0.5, 0.0, 1.0);
    float light = stroke * level;

    // Faint crosses at the grid corners.
    vec2 corner = vec2(local.x, cellPx.y - local.y);
    float arm = max(3.0 * aa, 5.0 * px);
    float tick = (corner.x < fw.x && corner.y < arm) || (corner.y < fw.y && corner.x < arm) ? 1.0 : 0.0;
    light = max(light, tick * 0.09);

    vec3 col = ink.rgb * light;

    // The cursor: brackets around the latest note's cell, the only accent.
    if (cursor > 0.0 && cursorCol >= 0.0 && ci == cursorCol && tr == cursorRow) {
        float inset = max(2.0, 3.0 * px);
        float lenB = min(cellPx.x, cellPx.y) * 0.2;
        vec2 lo = vec2(inset);
        vec2 hi = cellPx - vec2(inset);
        float db = 1e5;
        db = min(db, segDist(local, lo, lo + vec2(lenB, 0.0)));
        db = min(db, segDist(local, lo, lo + vec2(0.0, lenB)));
        db = min(db, segDist(local, vec2(hi.x, lo.y), vec2(hi.x - lenB, lo.y)));
        db = min(db, segDist(local, vec2(hi.x, lo.y), vec2(hi.x, lo.y + lenB)));
        db = min(db, segDist(local, vec2(lo.x, hi.y), vec2(lo.x + lenB, hi.y)));
        db = min(db, segDist(local, vec2(lo.x, hi.y), vec2(lo.x, hi.y - lenB)));
        db = min(db, segDist(local, hi, hi - vec2(lenB, 0.0)));
        db = min(db, segDist(local, hi, hi - vec2(0.0, lenB)));
        float bw = max(1.6 * px, aa);
        float bracket = clamp((0.5 * bw - db) / aa + 0.5, 0.0, 1.0);
        col = mix(col, accent.rgb * cursor, bracket);
    }

    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
