/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A one-bit test pattern in horizontal zones: bit fields, checkerboards, frequency sweeps, sync pulses, multiburst gratings and noise bits. Every hit of the sound it follows steps each zone through its own sequence, so the frame changes on the beat and holds between beats. The whole frame changes at most three times a second: when hits come faster, only half the zones step on each one. Every so many hits the frame cuts to a full test card until the next allowed change; when that would come too soon, only the middle of the frame cuts.",
    "PASSES": [
        { "TARGET": "cardState", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "fullState", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "zones", "LABEL": "Zones", "TYPE": "float", "DEFAULT": 5, "MIN": 2, "MAX": 8 },
        { "NAME": "frequency", "LABEL": "Frequency", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "stepPattern", "LABEL": "Step pattern", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "contrast", "LABEL": "Contrast", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "cardEvery", "LABEL": "Card every", "TYPE": "float", "DEFAULT": 16, "MIN": 0, "MAX": 32 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "gutter", "LABEL": "Gutter", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Pattern", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Marker", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// cardState: (last count + 1, seconds since the last hit, seconds between hits, recent activity).
// fullState: (count the slow zones show, seconds since the last full-frame change, card on, last count + 1).
// The whole frame may change at most three times a second.
const float FULL_GAP = 0.34;
const float PI2 = 6.2831853;

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

float zoneWeight(float z, float S) {
    return 0.4 + hash11(S * 2.31 + z * 5.17 + 0.3);
}

// One zone's pattern at pixel (x, y) inside a zone of height zh.
// t: kind; st: its step; d: duty; base: base period in pixels.
float zonePattern(float t, float st, float xs, float y, float zh, float W, float dIn, float base, float sd, float mode) {
    // Every step slides the pattern a quarter period; the mode adds a frequency
    // ladder, a duty ladder or a change of kind.
    float mult = mode < 0.5 ? exp2(mod(st, 4.0) - 1.0) : 1.0;
    float d = mode > 0.5 && mode < 1.5 ? dIn * (0.5 + 0.5 * mod(st, 4.0)) * 0.7 : dIn;
    float shift = st * 0.25;
    float kind = mode > 1.5 ? mod(t + st, 7.0) : t;
    float x = xs;
    float xu = mod(xs, W);
    float p = max(2.0, floor(base * mult + 0.5));
    if (kind < 0.5) {
        // Bit field: stripes, the lower halfRes in counter-phase.
        float off = floor(shift * p) + (y < zh * 0.5 ? floor(p * 0.5) : 0.0);
        return mod(x + off, p) < max(1.0, floor(p * d + 0.5)) ? 1.0 : 0.0;
    }
    if (kind < 1.5) {
        // Checkerboard.
        float c = max(2.0, floor(p * 0.75));
        float a = floor((x + floor(shift * 2.0 * c)) / c) + floor(y / c);
        float fx = mod(x + floor(shift * 2.0 * c), c);
        return mod(a, 2.0) < 0.5 && fx < max(1.0, floor(c * d * 2.0)) ? 1.0 : 0.0;
    }
    if (kind < 2.5) {
        // Sine sweep: a chirp thresholded to one bit.
        float u = xu / W;
        float f0 = W / (base * 6.0 * mult);
        float f1 = W / max(2.0, base * 0.4);
        if (hash11(sd + st * 0.37) < 0.5) u = 1.0 - u;
        float ph = PI2 * (f0 * u + 0.5 * (f1 - f0) * u * u) + shift * PI2;
        return sin(ph) > cos(d * 3.14159) ? 1.0 : 0.0;
    }
    if (kind < 3.5) {
        // Sync: a broad pulse then a train of narrow ones, each line stepping along.
        float T = floor(W / (3.0 + mod(st + floor(sd * 4.0), 4.0)));
        float lx = mod(x + floor(shift * T) + floor(st * T * 0.125), T);
        float wide = floor(T * 0.09);
        float nar = max(1.0, floor(T * 0.012));
        float on = lx < wide ? 1.0 : 0.0;
        float k = floor((lx - wide) / (T * 0.06));
        if (lx > wide + T * 0.04 && k < 6.0 && mod(lx - wide, T * 0.06) < nar) on = 1.0;
        return on * (y > zh * 0.18 && y < zh * 0.82 ? 1.0 : (lx < wide ? 1.0 : 0.0));
    }
    if (kind < 4.5) {
        // White noise bits, new on every step.
        float c = max(1.0, floor(p * 0.5));
        return hash21(vec2(floor(x / c) + st * 131.0, floor(y / c) + sd * 17.0)) < d * 0.75 ? 1.0 : 0.0;
    }
    if (kind < 5.5) {
        // Multiburst: packets of ever finer gratings.
        float seg = floor(xu / (W / 6.0));
        float q = max(2.0, floor(base * 2.0 * exp2(-seg) * mult + 0.5));
        float lx = mod(xu, W / 6.0);
        if (lx < W / 6.0 * 0.12) return 0.0;
        return mod(x + floor(shift * q), q) < max(1.0, floor(q * 0.5)) ? 1.0 : 0.0;
    }
    // Pulse-width ramp: a one-bit grey scale in eight steps.
    float stepI = floor(xu / (W / 8.0));
    float lvl = (stepI + 0.5) / 8.0;
    if (hash11(sd + 3.0) < 0.5) lvl = 1.0 - lvl;
    return mod(x + floor(shift * p), p) < floor(p * lvl * min(1.0, 2.0 * d) + 0.5) ? 1.0 : 0.0;
}

// The full test card, in pixels from the frame centre.
float testCard(vec2 c, vec2 res, float S, float n, float fs, float aspectPx) {
    float H = res.y;
    float on = 0.0;
    vec2 a = abs(c);
    vec2 halfRes = floor(res * 0.5);
    // Border with ticks.
    float bw = 2.0 * fs;
    if (a.x > halfRes.x - bw - 1.0 || a.y > halfRes.y - bw - 1.0) on = 1.0;
    float tickStep = floor(H / 24.0);
    if (a.y > halfRes.y - bw - 8.0 * fs && mod(c.x, tickStep) < fs) on = 1.0;
    if (a.x > halfRes.x - bw - 8.0 * fs && mod(c.y, tickStep) < fs) on = 1.0;
    // Crosshair.
    if ((a.x < fs || a.y < fs) && max(a.x * aspectPx, a.y) < H * 0.47) on = 1.0;
    // The circle and, inside it, a zone plate.
    float R = floor(H * 0.42);
    float Rx = R / aspectPx;
    float r = length(vec2(c.x * aspectPx, c.y));
    if (abs(r - R) < fs) on = 1.0;
    if (r < R * 0.62) {
        float k = 3.14159 / (R * 0.62) * (H / 30.0);
        if (sin(r * r * k / H * 4.0) > 0.0) on = 1.0 - on;
    }
    // Side columns: checkers and gratings.
    float side = halfRes.x - R - floor(H * 0.06);
    if (a.x > Rx + floor(H * 0.06) && a.x < halfRes.x - bw - floor(H * 0.04) && a.y < H * 0.36) {
        float cs = floor(H / (hash11(S + 1.0) < 0.5 ? 18.0 : 30.0));
        float ch = mod(floor(c.x / cs) + floor(c.y / cs), 2.0);
        float gr = mod(c.x, 4.0 * fs) < 2.0 * fs ? 1.0 : 0.0;
        on = c.y > 0.0 ? ch : gr;
    }
    // A bar of the hit count in binary along the bottom.
    float bx = H * 0.4 / aspectPx;
    if (c.y < -H * 0.4 && c.y > -H * 0.44 && a.x < bx) {
        float b = floor((c.x + bx) / (bx * 0.25));
        on = mod(floor((n + 0.5) / exp2(7.0 - b)), 2.0) > 0.5 ? 1.0 : (mod(c.x + bx, bx * 0.25) < fs ? 1.0 : 0.0);
    }
    return on;
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        vec4 s = IMG_NORM_PIXEL(cardState, vec2(0.5));
        bool ready = s.x > 0.5 && FRAMEINDEX >= 2;
        if (!ready) s = vec4(n + 1.0, 9.0, 0.5, 0.0);
        float fresh = abs(s.x - (n + 1.0)) > 0.5 ? 1.0 : 0.0;
        float age = s.y + dt;
        float interval = s.z;
        if (fresh > 0.5) {
            interval = mix(interval, clamp(age, 0.05, 4.0), interval > 3.9 ? 1.0 : 0.5);
            age = 0.0;
        }
        float act = max(s.w * pow(0.5, dt / 1.5), max(vxEnv, vxHit));
        gl_FragColor = vec4(n + 1.0, min(age, 9.0), interval, act);
        return;
    }

    float every = cardEvery < 0.5 ? 0.0 : max(2.0, floor(cardEvery + 0.5));

    if (PASSINDEX == 1) {
        vec4 c = IMG_NORM_PIXEL(cardState, vec2(0.5));
        vec4 f = IMG_NORM_PIXEL(fullState, vec2(0.5));
        bool ready = f.w > 0.5 && FRAMEINDEX >= 2;
        if (!ready) f = vec4(n, 9.0, 0.0, n + 1.0);
        bool fresh = abs(f.w - (n + 1.0)) > 0.5;
        float since = min(f.y + dt, 9.0);
        float nSlow = f.x;
        float cardOn = f.z;
        bool allowed = since >= FULL_GAP;
        if (fresh && allowed) {
            // A full change: the slow zones step and the card comes or goes.
            nSlow = n;
            since = 0.0;
            cardOn = every > 0.0 && n > 0.5 && mod(n, every) == 0.0 ? 1.0 : 0.0;
        } else if (cardOn > 0.5 && allowed && c.y > 1.0) {
            // The sound stopped: drop the card.
            cardOn = 0.0;
            since = 0.0;
        }
        gl_FragColor = vec4(nSlow, since, cardOn, n + 1.0);
        return;
    }

    vec4 full = IMG_NORM_PIXEL(fullState, vec2(0.5));
    float nSlow = floor(full.x + 0.5);
    bool fullCard = full.z > 0.5;
    vec4 st = IMG_NORM_PIXEL(cardState, vec2(0.5));
    float age = st.y;
    float interval = st.z;
    float act = smoothstep(0.0, 0.6, st.w);

    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 res = floor(RENDERSIZE / fw + 0.5);
    vec2 P = floor(gl_FragCoord.xy / fw);
    float yd = res.y - 1.0 - P.y;
    float S = floor(clamp(seed, 0.0, 1.0) * 99.0 + 0.5);
    float fs = max(1.0, floor(res.y / 500.0));

    float NZ = clamp(floor(zones + 0.5), 2.0, 8.0);
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
        if (float(i) < NZ) total += zoneWeight(float(i), S);
    }
    float gPx = floor(mix(0.0, 0.03, gutter) * res.y + 0.5);
    float avail = res.y - (NZ + 1.0) * gPx;
    float z = -1.0;
    float zTop = 0.0;
    float zH = 0.0;
    float acc = 0.0;
    float top = gPx;
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        if (fi < NZ) {
            acc += zoneWeight(fi, S);
            float bottom = gPx * (fi + 1.0) + floor(avail * acc / total + 0.5);
            if (yd >= top && yd < bottom) { z = fi; zTop = top; zH = bottom - top; }
            top = bottom + gPx;
        }
    }

    float lit = 0.0;
    float red = 0.0;
    float d = mix(0.1, 0.5, contrast) * mix(0.35, 1.0, act);
    float base = floor(mix(48.0, 6.0, frequency) * res.y / 1080.0 + 0.5);
    base = max(base, 3.0);
    float mode0 = floor(clamp(stepPattern, 0.0, 1.0) * 2.99);

    if (z >= 0.0) {
        float sd = S * 7.13 + z * 3.7;
        float t = floor(hash11(sd + 0.5) * 7.0);
        float L = hash11(sd + 1.9) < 0.5 ? 4.0 : 8.0;
        // Alternate zones step on every hit; the rest only on full changes.
        float zn = mod(z + S, 2.0) < 0.5 ? n : nSlow;
        float stp = mod(zn + floor(hash11(sd + 2.7) * L), L);
        float mode = mod(mode0 + (hash11(sd + 4.1) < 0.3 ? 1.0 : 0.0), 3.0);
        // A slow drift on some zones, in whole pixels.
        float dir = hash11(sd + 6.6) < 0.5 ? -1.0 : 1.0;
        float dx = hash11(sd + 5.3) < 0.5 ? floor(vxPhase * drift * dir * res.x * 0.02) : 0.0;
        float x = P.x + dx;
        float y = yd - zTop;
        // At rest only some zones keep running.
        float alive = hash11(sd + 8.8) < mix(0.5, 1.0, act) ? 1.0 : 0.0;
        lit = zonePattern(t, stp, x, y, zH, res.x, d, base, sd, mode) * alive;
    } else {
        // Gutters carry a step marker: the zone above's place in its sequence.
        float zb = -1.0;
        float tp = gPx;
        float acc2 = 0.0;
        for (int i = 0; i < 8; i++) {
            float fi = float(i);
            if (fi < NZ) {
                acc2 += zoneWeight(fi, S);
                float bottom = gPx * (fi + 1.0) + floor(avail * acc2 / total + 0.5);
                if (yd >= bottom && yd < bottom + gPx) zb = fi;
                tp = bottom + gPx;
            }
        }
        if (zb >= 0.0 && gPx >= 3.0) {
            float sd = S * 7.13 + zb * 3.7;
            float L = hash11(sd + 1.9) < 0.5 ? 4.0 : 8.0;
            float zn = mod(zb + S, 2.0) < 0.5 ? n : nSlow;
            float stp = mod(zn + floor(hash11(sd + 2.7) * L), L);
            float cw = floor(res.x / 64.0);
            float cell = floor(P.x / cw);
            float inner = mod(P.x, cw);
            float row = mod(yd, gPx);
            if (cell < L && inner < cw - 2.0 * fs && row >= 1.0 && row < gPx - 1.0) {
                if (cell == stp) red = act > 0.05 ? 1.0 : 0.0;
                else lit = (row == 1.0 || row == gPx - 2.0) ? 0.6 : 0.0;
            }
        }
    }

    // The card: full frame when a full change is allowed, held until the next one;
    // otherwise only the middle of the frame cuts, for at most a beat.
    float beatLen = clamp(interval, 0.1, 0.6);
    bool partCard = !fullCard && every > 0.0 && n > 0.5 && mod(n, every) == 0.0 && age < beatLen * 0.9;
    if (fullCard || partCard) {
        vec2 c = P - floor(res * 0.5);
        bool partial = !fullCard;
        vec2 box = partial ? floor(res * vec2(0.22, 0.3)) : floor(res * 0.5);
        if (abs(c.x) < box.x && abs(c.y) < box.y) {
            lit = testCard(partial ? c * (res.y * 0.5 / box.y) : c, res, S, n, fs, fw.x / fw.y);
            red = 0.0;
            if (length(c) < 3.0 * fs) red = 1.0;
        }
    }

    vec3 col = ink.rgb * (lit > 0.5 ? 1.0 : 0.0);
    if (red > 0.5) col = accent.rgb;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
