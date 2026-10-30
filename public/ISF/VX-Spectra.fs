/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A one-bit spectrum. Each sounding note stands as a cluster of bars at its pitch across the frame, with its harmonics as thinner bars at the true partial positions above it, so the harmony is drawn as a barcode. Bar height and weight follow each note's level; weak partials break into flickering scan lines. A frequency ruler runs along the base and the root is marked.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "harmonics", "LABEL": "Harmonics", "TYPE": "float", "DEFAULT": 8, "MIN": 1, "MAX": 12 },
        { "NAME": "barWidth", "LABEL": "Bar width", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "height", "LABEL": "Height", "TYPE": "float", "DEFAULT": 0.75, "MIN": 0, "MAX": 1 },
        { "NAME": "ruler", "LABEL": "Ruler", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "flicker", "LABEL": "Flicker", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "noiseFloor", "LABEL": "Noise floor", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "span", "LABEL": "Range", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Bars", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Root", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
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

// 3 x 5 pixel figures; bit (row * 3 + column), row 0 at the top.
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

float pow10i(float e) {
    return e < 0.5 ? 1.0 : (e < 1.5 ? 10.0 : (e < 2.5 ? 100.0 : (e < 3.5 ? 1000.0 : 10000.0)));
}

// Pixel q (x right, y down from the top-left of the figure) of the whole number v,
// drawn without leading zeros at scale s.
float numberPix(vec2 q, float v, float s) {
    float nd = v < 9.5 ? 1.0 : (v < 99.5 ? 2.0 : (v < 999.5 ? 3.0 : (v < 9999.5 ? 4.0 : 5.0)));
    vec2 c = floor(q / s);
    if (q.x < 0.0 || q.y < 0.0 || c.y > 4.0) return 0.0;
    float j = floor(c.x / 4.0);
    if (j >= nd) return 0.0;
    float lx = c.x - j * 4.0;
    if (lx > 2.5) return 0.0;
    float d = mod(floor(v / pow10i(nd - 1.0 - j) + 0.0001), 10.0);
    float i = c.y * 3.0 + lx;
    return mod(floor((glyphCode(d) + 0.5) / exp2(i)), 2.0);
}

void main() {
    // Work in the pixels the core really stores.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 res = floor(RENDERSIZE / fw + 0.5);
    vec2 P = floor(gl_FragCoord.xy / fw);
    float S = floor(clamp(seed, 0.0, 1.0) * 99.0 + 0.5);
    float fs = max(1.0, floor(res.y / 500.0));

    // The seed's recipe: form, harmonic colour, cluster shape.
    float form = floor(hash11(S * 1.37 + 0.11) * 4.0);       // 0 full, 1 centred, 2 mirrored, 3 stepped
    float roll = mix(0.45, 1.1, hash11(S * 2.13 + 0.5));
    float oddOnly = hash11(S * 3.9 + 1.7) < 0.3 ? 1.0 : 0.0;
    float sats = floor(hash11(S * 5.3 + 2.2) * 3.0);
    float satGap = 2.0 + floor(hash11(S * 6.1 + 0.9) * 3.0);
    float caps = hash11(S * 7.7 + 4.4) < 0.6 ? 1.0 : 0.0;

    // Frame: pitch runs left to right; the ruler sits under the baseline.
    float x0 = floor(res.x * 0.04);
    float x1 = res.x - x0;
    float y0 = floor(res.y * 0.15);
    float yT = res.y - floor(res.y * 0.07);
    float lo = mix(30.0, 18.0, span);
    float hi = mix(102.0, 126.0, span);
    float semi = (x1 - x0) / (hi - lo);
    float hMax = (yT - y0 - 2.0) * mix(0.25, 1.0, height);
    float x = P.x;
    float y = P.y;

    float notes[4];
    float energy[4];
    notes[0] = vxNote0 * 127.0; energy[0] = vxNote0 > 0.0 ? clamp(vxNoteE0, 0.0, 1.0) : 0.0;
    notes[1] = vxNote1 * 127.0; energy[1] = vxNote1 > 0.0 ? clamp(vxNoteE1, 0.0, 1.0) : 0.0;
    notes[2] = vxNote2 * 127.0; energy[2] = vxNote2 > 0.0 ? clamp(vxNoteE2, 0.0, 1.0) : 0.0;
    notes[3] = vxNote3 * 127.0; energy[3] = vxNote3 > 0.0 ? clamp(vxNoteE3, 0.0, 1.0) : 0.0;

    // The root: the lowest note still sounding.
    float rootNote = 999.0;
    for (int i = 0; i < 4; i++) {
        if (energy[i] > 0.06) rootNote = min(rootNote, floor(notes[i] + 0.5));
    }

    float H = clamp(floor(harmonics + 0.5), 1.0, 12.0);
    float tick = floor(vxPhase * 24.0);
    float lit = 0.0;
    float red = 0.0;

    if (y > y0 && y < yT) {
        for (int i = 0; i < 4; i++) {
            float e = energy[i];
            if (e > 0.004) {
                float p = notes[i];
                float wMain = max(1.0, floor(mix(1.0, semi * 0.8, barWidth) * (0.35 + 0.65 * e) + 0.5));
                for (int k = 1; k <= 12; k++) {
                    float fk = float(k);
                    if (fk <= H) {
                        float pk = p + 12.0 * log2(fk);
                        float xc = floor(x0 + (pk - lo) * semi);
                        float a = e * pow(fk, -roll);
                        if (oddOnly > 0.5 && mod(fk, 2.0) < 0.5) a *= 0.18;
                        float w = k == 1 ? wMain : max(1.0, floor(wMain * pow(fk, -0.7) + 0.5));
                        float dx = x - (xc - floor(w * 0.5));
                        bool inMain = dx >= 0.0 && dx < w;
                        bool inSat = false;
                        float satLen = 0.0;
                        if (k == 1 && sats > 0.5) {
                            // Thin satellites either side of the fundamental.
                            for (int j = 1; j <= 3; j++) {
                                float fj = float(j);
                                if (fj <= sats) {
                                    float off = floor(w * 0.5) + fj * satGap + (fj - 1.0);
                                    // Each side has its own lengths, so clusters never read as icons.
                                    if (x == xc + off) {
                                        inSat = true;
                                        satLen = mix(0.35, 0.95, hash11(S * 3.3 + fj * 1.7 + 0.2));
                                    }
                                    if (x == xc - off - 1.0 && hash11(S * 8.1 + fj * 2.9) < 0.6) {
                                        inSat = true;
                                        satLen = mix(0.3, 0.9, hash11(S * 4.1 + fj * 3.3 + 0.6));
                                    }
                                }
                            }
                        }
                        if ((inMain || inSat) && xc > x0 - w && xc < x1 + w) {
                            // Flicker: partials shake in length and break into scan lines.
                            float jit = hash21(vec2(fk * 7.1 + float(i) * 31.0, tick));
                            float amp = a * (inSat ? satLen : 1.0) * (1.0 - flicker * 0.4 * jit * step(1.5, fk));
                            float len = hMax * pow(clamp(amp, 0.0, 1.0), 0.7);
                            float lineOn = 1.0;
                            if (k > 1) {
                                float bright = clamp(a * 3.0, 0.12, 1.0);
                                float row = hash21(vec2(floor(y / fs) + fk * 13.0, tick * (0.2 + flicker) + float(i) * 5.0));
                                lineOn = row < mix(1.0, bright, flicker * 0.6 + 0.4) ? 1.0 : 0.0;
                            }
                            float yy = y - y0;
                            float inside = 0.0;
                            if (form < 0.5) {
                                // Full height: level shows only in weight and texture.
                                inside = yy <= hMax * (k == 1 ? 1.0 : mix(0.55, 1.0, clamp(a * 2.0, 0.0, 1.0))) ? 1.0 : 0.0;
                            } else if (form < 1.5) {
                                float yc = y0 + (yT - y0) * 0.5;
                                inside = abs(y - yc) <= len * 0.5 ? 1.0 : 0.0;
                            } else if (form < 2.5) {
                                inside = (yy <= len * 0.5 || (yT - y) <= len * 0.5) ? 1.0 : 0.0;
                            } else {
                                // Stepped: a segmented meter.
                                float seg = max(3.0, floor(hMax / 18.0));
                                float lvl = floor(len / seg + 0.5);
                                float si = floor((yy - 1.0) / seg);
                                inside = (si < lvl && mod(yy - 1.0, seg) < seg - max(1.0, floor(seg * 0.3))) ? 1.0 : 0.0;
                            }
                            float on = inside * lineOn;
                            lit = max(lit, on);
                            if (on > 0.5 && k == 1 && inMain && floor(p + 0.5) == rootNote) red = 1.0;
                        }
                        // A floating cap over each fundamental.
                        if (k == 1 && caps > 0.5 && form != 0.0) {
                            float len = hMax * pow(clamp(a, 0.0, 1.0), 0.7);
                            float capY = form < 1.5 ? y0 + (yT - y0) * 0.5 + floor(len * 0.5) + 3.0 * fs
                                       : (form < 2.5 ? y0 + floor(len * 0.5) + 3.0 * fs : y0 + len + 3.0 * fs);
                            if (abs(dx - w * 0.5 + 0.5) <= w * 0.5 + 2.0 * fs && y == floor(capY)) lit = 1.0;
                        }
                    }
                }
            }
        }
    }

    // Noise floor: a low grass of hairlines that never quite settles.
    float nf = clamp(noiseFloor, 0.0, 1.0);
    if (nf > 0.0 && y > y0 && x >= x0 && x <= x1 && mod(x - x0, 3.0 * fs) < fs) {
        float c = floor((x - x0) / (3.0 * fs));
        float h = hash21(vec2(c, floor(vxPhase * 3.0) + S));
        float tall = floor(pow(h, 9.0) * res.y * 0.025 * nf * (1.0 + vxEnergy)) + (h > 0.45 ? fs : 0.0);
        if (y - y0 <= tall) lit = 1.0;
    }

    // Ruler: baseline, semitone and octave ticks, and the frequency of each C in Hz.
    float rl = clamp(ruler, 0.0, 1.0);
    if (y == y0 && x >= x0 && x <= x1) lit = 1.0;
    if (rl > 0.01 && y < y0 && x >= x0 - 2.0 && x <= x1 + 2.0) {
        float pm = floor((x - x0) / semi + lo + 0.5);
        float xt = floor(x0 + (pm - lo) * semi);
        float below = y0 - y;
        float isC = mod(pm, 12.0) < 0.5 ? 1.0 : 0.0;
        float tl = floor(mix(2.0, 3.0, rl) * fs) + isC * floor(mix(3.0, 6.0, rl) * fs);
        if (x == xt && below <= tl && pm >= lo - 0.5 && pm <= hi + 0.5) lit = 1.0;
        if (rl > 0.25) {
            // The nearest C, labelled centred under its tick.
            float pcN = floor(((x - x0) / semi + lo) / 12.0 + 0.5) * 12.0;
            float hz = floor(440.0 * exp2((pcN - 69.0) / 12.0) + 0.5);
            float nd = hz < 9.5 ? 1.0 : (hz < 99.5 ? 2.0 : (hz < 999.5 ? 3.0 : 4.0));
            float xc = floor(x0 + (pcN - lo) * semi);
            vec2 q = vec2(x - (xc - floor((nd * 4.0 - 1.0) * fs * 0.5)), (y0 - floor(9.0 * fs)) - y);
            if (pcN >= lo && pcN <= hi) lit = max(lit, numberPix(q, hz, fs));
        }
        // The root's marker: a small block under the baseline.
        if (rootNote < 998.0) {
            float xr = floor(x0 + (rootNote - lo) * semi);
            if (abs(x - xr) <= 1.0 * fs && below > 0.0 && below <= floor(5.0 * fs) && below > floor(3.0 * fs)) red = 1.0;
        }
    }

    vec3 col = ink.rgb * lit;
    if (red > 0.5) col = accent.rgb;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
