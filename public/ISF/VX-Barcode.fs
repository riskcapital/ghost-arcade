/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A one-bit test pattern: stacked bands of hard vertical stripes, each band its own code of bars, hairlines, blocks or a frequency sweep. Every hit of the sound it follows re-rolls one or more bands, so the picture changes exactly on the hits and holds still between them; the sound's level thickens the stripes. Thin rulers mark the band edges.",
    "PASSES": [
        {
            "TARGET": "activity",
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
        { "NAME": "columns", "LABEL": "Columns", "TYPE": "float", "DEFAULT": 320, "MIN": 120, "MAX": 720 },
        { "NAME": "bands", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 4, "MIN": 2, "MAX": 6 },
        { "NAME": "density", "LABEL": "Density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "scroll", "LABEL": "Scroll", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "reroll", "LABEL": "Re-roll", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "invertEvery", "LABEL": "Invert every", "TYPE": "float", "DEFAULT": 8, "MIN": 0, "MAX": 32 },
        { "NAME": "ruler", "LABEL": "Ruler", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "jitter", "LABEL": "Jitter", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Stripes", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Marker", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// How far back a band looks for the hit that last re-rolled it.
const int LOOKBACK = 24;

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

float bandWeight(float i, float nb) {
    return 0.45 + hash11(i * 7.13 + nb * 3.71 + 0.5);
}

// Hit m re-rolls one band for sure, and each other band by chance.
bool rerolled(float m, float b, float nb) {
    if (floor(hash11(m * 1.731 + 0.37) * nb) == b) return true;
    return hash11(m * 13.17 + b * 3.71 + 1.9) < reroll * 0.85;
}

// The hit that last re-rolled band b: its pattern seed.
float bandSeed(float b, float n, float nb) {
    for (int k = 0; k < LOOKBACK; k++) {
        float m = mod(n - float(k) + 64.0, 64.0);
        if (rerolled(m, b, nb)) return m;
    }
    return mod(n - float(LOOKBACK) + 64.0, 64.0);
}

// One cell of a coded band: (offset, width) of its stripe, in cell units.
// kp = (cells per group, solid group chance, empty group chance, stripe chance)
// kw = (narrowest, widest, random placement, pixels left dark between cells)
// A stripe is never narrower than one pixel, so it always lands on a pixel.
vec2 cellStripe(float i, float sd, vec4 kp, vec4 kw, float px) {
    float gi = floor(i / kp.x);
    float hg = hash21(vec2(gi + 0.5, sd * 1.37 + 3.1));
    if (hg < kp.y) {
        // A solid run of varying length inside its group.
        float j = i - gi * kp.x;
        float a = floor(hash11(gi * 1.9 + sd) * kp.x * 0.6);
        float b = a + 1.0 + floor(hash11(gi * 3.7 + sd + 0.5) * (kp.x - a));
        return (j >= a && j < b) ? vec2(0.0, 1.0) : vec2(0.0, 0.0);
    }
    if (hg > 1.0 - kp.z) return vec2(0.0, 0.0);
    float hd = hash21(vec2(i + 0.5, sd * 2.11 + 7.7));
    if (hd >= kp.w) return vec2(0.0, 0.0);
    float hw = hash21(vec2(i + 0.5, sd * 0.73 + 11.3));
    float w = clamp(mix(kw.x, kw.y, hw * hw) - kw.w * px, px, 1.0);
    float o = kw.z * hash21(vec2(i + 0.5, sd + 23.9)) * (1.0 - w);
    return vec2(o, w);
}

// Integral of a square wave with duty d, for exact box-filtered sweeps.
float squareSum(float ph, float d) {
    return floor(ph) * d + clamp(fract(ph), 0.0, d);
}

void main() {
    if (PASSINDEX == 0) {
        // Recent activity: jumps with each hit, eases off over a second or two.
        float prev = clamp(IMG_NORM_PIXEL(activity, vec2(0.5)).r, 0.0, 1.0);
        if (FRAMEINDEX < 2) prev = 0.0;
        float a = max(prev * pow(0.5, clamp(TIMEDELTA, 0.0, 0.1) / 1.2), max(vxEnv, vxHit));
        gl_FragColor = vec4(a, 0.0, 0.0, 1.0);
        return;
    }

    // Work in stored pixels: the core may store this layer coarser than its
    // render size, so stripes snap to the pixels that are really there.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 res = RENDERSIZE / fw;
    vec2 px = gl_FragCoord.xy / fw;
    float rowPx = res.y - px.y;                   // pixel rows from the top
    float nb = clamp(floor(bands + 0.5), 2.0, 6.0);
    float n = floor(vxCount + 0.5);
    float epoch = floor((vxBars + 0.5) / 8.0);
    float env = clamp(vxEnv, 0.0, 1.0);

    // Layout, in whole pixels so every band edge is hard.
    float gPx = floor(max(5.0, res.y * 0.015));
    float availPx = res.y - (nb + 1.0) * gPx;
    float total = 0.0;
    for (int i = 0; i < 6; i++) {
        if (float(i) < nb) total += bandWeight(float(i), nb);
    }
    float band = -1.0;
    float strip = -1.0;
    float stripRow = 0.0;
    float acc = 0.0;
    float top = 0.0;
    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        if (fi > nb) break;
        // Ruler strip i sits above band i.
        if (rowPx >= top && rowPx < top + gPx) { strip = fi; stripRow = rowPx - top; }
        top += gPx;
        if (fi < nb) {
            acc += bandWeight(fi, nb);
            float bottom = (fi == nb - 1.0) ? res.y - gPx : gPx * (fi + 1.0) + floor(availPx * acc / total + 0.5);
            if (rowPx >= top && rowPx < bottom) band = fi;
            top = bottom;
        }
    }

    vec3 col = vec3(0.0);

    if (band >= 0.0) {
        float sd = bandSeed(band, n, nb) + epoch * 64.0;
        float kind = hash11(sd * 0.917 + band * 5.3 + 2.0);
        float hk = hash11(sd * 3.33 + band * 1.7 + 9.0);
        // Each band slides at its own steady rate, in whole pixels; each hit nudges it.
        float rate = hash11(band * 9.13 + 4.0) * 2.0 - 1.0;
        rate = sign(rate) * (0.3 + 0.7 * abs(rate));
        float shiftPx = floor(vxPhase * scroll * rate * 0.12 * res.x
                    + (hash11(n * 3.1 + band * 7.7 + 0.3) - 0.5) * jitter * 0.06 * res.x);
        float sx = floor(px.x) + shiftPx + 0.5;          // pixel centre, shifted
        float cols = min(columns, res.x * 0.6);
        float dens = clamp(density, 0.0, 1.0);
        float thick = mix(0.45, 1.0, env);
        // At rest the code thins to a sparse skeleton of hairlines.
        float act = smoothstep(0.0, 0.6, IMG_NORM_PIXEL(activity, vec2(0.5)).r);
        float live = dens * (0.55 + 0.45 * env) * mix(0.3, 1.0, act);
        float cover = 0.0;

        if (kind < 0.16) {
            // A frequency sweep: stripes tighten across the band and flow through it.
            float x = px.x / res.x;
            if (hk < 0.5) x = 1.0 - x;
            float dxu = 1.0 / res.x;
            float f0 = cols * 0.02;
            float f1 = cols * mix(0.06, 0.15, hash11(sd + 5.0));
            float duty = mix(0.14, 0.42, env) * (0.6 + 0.8 * dens) * mix(0.4, 1.0, act);
            float flow = shiftPx / res.x * cols * 0.05;
            float x0 = x - 0.5 * dxu;
            float x1 = x + 0.5 * dxu;
            float p0 = f0 * x0 + f1 * x0 * x0 + flow;
            float p1 = f0 * x1 + f1 * x1 * x1 + flow;
            cover = abs(squareSum(p1, duty) - squareSum(p0, duty)) / max(abs(p1 - p0), 1e-5);
        } else {
            vec4 kp;
            vec4 kw;
            float kb;
            if (kind < 0.5) {
                // Barcode: data stripes between solid runs and empty runs.
                kb = 1.0 + floor(hk * 1.99);
                kp = vec4(4.0 + floor(hash11(sd + 1.0) * 12.0), (0.06 + 0.1 * dens) * act, 0.34 - 0.22 * dens, live);
                kw = vec4(0.25 * thick, thick, 0.0, 0.0);
            } else if (kind < 0.7) {
                // Bits: an even row of cells, each one on or off.
                kb = 2.0 + floor(hk * 3.99);
                kp = vec4(1.0, 0.0, 0.0, live * 0.9);
                kw = vec4(mix(0.5, 1.0, env), mix(0.5, 1.0, env), 0.0, 1.0);
            } else if (kind < 0.88) {
                // Hairlines scattered through wide gaps.
                kb = 2.0 + floor(hk * 2.99);
                kp = vec4(3.0 + floor(hash11(sd + 2.0) * 6.0), 0.0, 0.45 - 0.3 * dens, live);
                kw = vec4(0.0, 0.12 * thick, 1.0, 0.0);
            } else {
                // Blocks: wide bits that part as the sound falls away.
                kb = 5.0 + floor(hk * 7.99);
                kp = vec4(1.0, 0.0, 0.0, (0.15 + 0.3 * dens) * mix(0.15, 1.0, act));
                kw = vec4(mix(0.62, 1.0, env), mix(0.62, 1.0, env), 0.0, 0.0);
            }
            float cellPx = res.x / cols * kb;
            float xc = sx / cellPx;
            float ic = floor(xc);
            float fc = xc - ic;
            vec2 c = cellStripe(ic, sd, kp, kw, 1.0 / cellPx);
            cover = (fc >= c.x && fc < c.x + c.y) ? 1.0 : 0.0;
        }
        cover = clamp(cover, 0.0, 1.0);

        // Every so many hits one band turns negative until the next hit.
        float every = invertEvery < 0.5 ? 0.0 : max(4.0, floor(invertEvery + 0.5));
        if (every > 0.0 && n > 0.5 && mod(n, every) == every - 1.0
            && band == floor(hash11(n * 2.71 + 5.0) * nb)) {
            cover = 1.0 - cover;
        }
        col = ink.rgb * cover;
    } else if (strip >= 0.0) {
        // Ruler: minor and major ticks standing on the band edge.
        float xi = floor(px.x);
        float k = floor(xi * 96.0 / res.x + 0.5);
        float onTick = (floor(k * res.x / 96.0 + 0.5) == xi) ? 1.0 : 0.0;
        float major = (mod(k, 8.0) == 0.0) ? 1.0 : 0.0;
        float tall = floor(gPx * mix(0.34, 0.72, major));
        // Ticks rise from the band below, and from above in the last strip.
        float fromEdge = (strip == nb) ? stripRow : gPx - 1.0 - stripRow;
        float tick = onTick * ((fromEdge < tall) ? 1.0 : 0.0);
        col = ink.rgb * tick * ruler * mix(0.5, 0.95, major);

        // One red marker: on the band this hit re-rolled, stepping with the count.
        float primary = floor(hash11(n * 1.731 + 0.37) * nb);
        float mx0 = floor(n * res.x / 64.0);
        float mx1 = floor((n + 1.0) * res.x / 64.0) - 1.0;
        if (n > 0.5 && strip == primary && xi >= mx0 && xi < mx1 && stripRow >= 1.0 && stripRow < gPx - 1.0) {
            col = accent.rgb * max(ruler, 0.35);
        }
    }

    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
