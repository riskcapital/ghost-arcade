/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A bank of oscillator traces. One horizontal trace per sounding note, lowest at the bottom, each drawing its waveform at the note's true frequency relative to the others; under them, set apart, the sum: the chord's real combined wave. When the notes fall into simple ratios the sum locks into a steady repeating shape, when they clash it keeps changing. Everything scrolls slowly like a chart recorder; empty channels rest as flat lines.",
    "PASSES": [
        {
            "TARGET": "phosphor",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 10, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "waveShape", "LABEL": "Wave", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Sine", "Saw", "Square"] },
        { "NAME": "spacing", "LABEL": "Trace spacing", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "amplitude", "LABEL": "Amplitude", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "cycles", "LABEL": "Cycles shown", "TYPE": "float", "DEFAULT": 3, "MIN": 1, "MAX": 12 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "persistence", "LABEL": "Persistence", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "softness", "LABEL": "Softness", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "scroll", "LABEL": "Scroll", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Traces", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Sum", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// phosphor: r = the note traces' afterglow, g = the sum trace's.
const float TAU = 6.2831853;
const float PI = 3.1415927;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// The sounding notes, lowest first. Column i = (MIDI note, energy, weight, unused).
mat4 chordNotes() {
    float emax = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
    float gate = max(0.002, 0.3 * emax);
    vec2 a = vec2((vxNote0 > 0.0 && vxNoteE0 >= gate) ? floor(vxNote0 * 127.0 + 0.5) : 999.0, vxNoteE0);
    vec2 b = vec2((vxNote1 > 0.0 && vxNoteE1 >= gate) ? floor(vxNote1 * 127.0 + 0.5) : 999.0, vxNoteE1);
    vec2 c = vec2((vxNote2 > 0.0 && vxNoteE2 >= gate) ? floor(vxNote2 * 127.0 + 0.5) : 999.0, vxNoteE2);
    vec2 d = vec2((vxNote3 > 0.0 && vxNoteE3 >= gate) ? floor(vxNote3 * 127.0 + 0.5) : 999.0, vxNoteE3);
    vec2 t;
    if (b.x < a.x) { t = a; a = b; b = t; }
    if (d.x < c.x) { t = c; c = d; d = t; }
    if (c.x < a.x) { t = a; a = c; c = t; }
    if (d.x < b.x) { t = b; b = d; d = t; }
    if (c.x < b.x) { t = b; b = c; c = t; }
    float e = max(emax, 1e-4);
    float master = smoothstep(0.0, 0.12, emax);
    vec4 n0 = vec4(a.x, a.y, a.x < 998.0 ? smoothstep(0.3, 0.6, a.y / e) * master : 0.0, 0.0);
    vec4 n1 = vec4(b.x, b.y, b.x < 998.0 ? smoothstep(0.3, 0.6, b.y / e) * master : 0.0, 0.0);
    vec4 n2 = vec4(c.x, c.y, c.x < 998.0 ? smoothstep(0.3, 0.6, c.y / e) * master : 0.0, 0.0);
    vec4 n3 = vec4(d.x, d.y, d.x < 998.0 ? smoothstep(0.3, 0.6, d.y / e) * master : 0.0, 0.0);
    return mat4(n0, n1, n2, n3);
}

// How far a ratio misses the nearest simple one (denominator up to 6).
float mistune(float q) {
    float best = 0.0;
    float err = 1e3;
    for (int m = 1; m <= 6; m++) {
        float fm = float(m);
        float pn = floor(q * fm + 0.5);
        float e = abs(q - pn / fm) + fm * 0.0008;
        if (e < err) {
            err = e;
            best = q - pn / fm;
        }
    }
    return best;
}

// One cycle of the waveform at phase th (cycles), softly bandlimited: the
// harmonics roll off as r^n, which keeps every edge a smooth steep slope.
float wave(float th) {
    float x = TAU * th;
    float r = mix(0.97, 0.75, softness);
    if (waveShape == 1) {
        float v = atan(r * sin(x), 1.0 - r * cos(x));
        return v / atan(r, sqrt(1.0 - r * r));
    }
    if (waveShape == 2) {
        float k = 2.0 * r / (1.0 - r * r);
        return atan(k * sin(x)) / atan(k);
    }
    return sin(x);
}

// Squared distance from the origin to segment ab, and where along it.
float segment2(vec2 a, vec2 b) {
    vec2 ab = b - a;
    float h = clamp(dot(-a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec2 d = -a - ab * h;
    return dot(d, d);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    // Stored pixels per frame-height unit, per axis.
    vec2 S = RENDERSIZE.y / fw;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;

    // Layout: four note lanes above a sum lane, the stack centred.
    float gap = mix(0.1, 0.19, spacing);
    float sumGap = gap * 1.35;
    float stackH = sumGap + 3.0 * gap;
    float ySum = -0.5 * stackH;
    float xL = -0.4 * aspect;
    float xR = 0.4 * aspect;
    float halfAmp = 0.45 * gap * mix(0.4, 1.0, amplitude);

    mat4 ch = chordNotes();
    float root = ch[0].z > 0.0 ? ch[0].x : 60.0;
    float clock = vxPhase * mix(0.02, 0.3, scroll);
    // The root's own pitch sets how many cycles fit: higher notes pack tighter.
    float rootCycles = cycles * exp2((root - 60.0) / 24.0);
    float newest = floor(vxPitch * 127.0 + 0.5);

    if (PASSINDEX == 0) {
        float sigma = mix(0.45, 1.3, lineWidth);
        float reach = sigma * 3.5;
        // Which lane this pixel belongs to: -1 the sum, 0..3 the notes.
        float lane = p.y < ySum + 0.5 * sumGap ? -1.0 : clamp(floor((p.y - ySum - sumGap) / gap + 0.5), 0.0, 3.0);
        float yLane = lane < 0.0 ? ySum : ySum + sumGap + lane * gap;
        float u = (p.x - xL) / (xR - xL);
        // Half a sample step either side, in trace units: about a stored pixel and a half.
        float hstep = 1.5 / (S.x * (xR - xL));
        float beam = 0.0;
        float sumBeam = 0.0;
        if (u > -0.02 && u < 1.02 && abs(p.y - yLane) < halfAmp * 1.6 + reach / S.y) {
            vec3 ys = vec3(0.0);
            float level = 0.0;
            for (int i = 0; i < 4; i++) {
                float fi = float(i);
                vec4 n = ch[i];
                float use = lane < 0.0 ? 1.0 : (abs(fi - lane) < 0.5 ? 1.0 : 0.0);
                if (use > 0.5 && n.z > 0.001) {
                    float q = exp2((n.x - root) / 12.0);
                    // Phase-locked to the root and scrolling with it; equal-tempered
                    // intervals drift against pure ones, so only near-simple ratios hold still.
                    float ph = q * clock + mistune(q) * vxPhase * 0.5;
                    float c = rootCycles * q;
                    vec3 th = vec3(u - hstep, u, u + hstep) * c - ph;
                    vec3 v = vec3(wave(th.x), wave(th.y), wave(th.z));
                    float amp = n.z;
                    ys += v * amp;
                    level += amp;
                }
            }
            if (lane < 0.0) {
                // The sum, scaled so a full chord fills the lane without clipping.
                ys /= max(1.0, level * 0.75);
            }
            vec2 a = (vec2(xL + (u - hstep) * (xR - xL), yLane + ys.x * halfAmp) - p) * S;
            vec2 b = (vec2(xL + u * (xR - xL), yLane + ys.y * halfAmp) - p) * S;
            vec2 c = (vec2(xL + (u + hstep) * (xR - xL), yLane + ys.z * halfAmp) - p) * S;
            float d2 = min(segment2(a, b), segment2(b, c));
            float prof = exp(-0.5 * d2 / (sigma * sigma)) + 0.04 * exp(-sqrt(d2) / (sigma * 4.0));
            // The trace eases in and out at its ends.
            float ends = smoothstep(-0.01, 0.02, u) * smoothstep(1.01, 0.98, u);
            // A channel with nothing in it still shows as a dim flat line.
            float lit = mix(0.28, 1.0, clamp(level, 0.0, 1.0));
            float hitBoost = 1.0;
            if (lane >= 0.0) {
                float laneNote = lane < 0.5 ? ch[0].x : (lane < 1.5 ? ch[1].x : (lane < 2.5 ? ch[2].x : ch[3].x));
                if (abs(laneNote - newest) < 0.5) hitBoost += 0.6 * vxHit * vxHit;
                beam = prof * ends * lit * hitBoost * mix(0.6, 1.0, smoothstep(0.0, 0.5, vxEnv));
            } else {
                sumBeam = prof * ends * lit * (1.0 + 0.3 * vxHit * vxHit) * mix(0.6, 1.0, smoothstep(0.0, 0.5, vxEnv));
            }
        }
        vec4 prev = IMG_NORM_PIXEL(phosphor, uv);
        float f60 = clamp(TIMEDELTA, 0.0, 0.1) * 60.0;
        float keep = pow(mix(0.4, 0.92, persistence), f60);
        vec2 glow = max(prev.rg * keep - 0.002 * f60, vec2(beam, sumBeam));
        if (FRAMEINDEX < 2) glow = vec2(0.0);
        gl_FragColor = vec4(max(glow, 0.0), 0.0, 1.0);
        return;
    }

    vec4 ph = IMG_NORM_PIXEL(phosphor, uv);
    vec3 col = ink.rgb * (1.0 - exp(-ph.r * 1.7));
    col += accent.rgb * (1.0 - exp(-ph.g * 1.7));

    // Channel ticks at the left: a short dash before each trace, the sum's in the accent.
    for (int i = -1; i < 4; i++) {
        float fi = float(i);
        float y = i < 0 ? ySum : ySum + sumGap + fi * gap;
        vec2 a = (vec2(xL - 0.045, y) - p) * S;
        vec2 b = (vec2(xL - 0.022, y) - p) * S;
        float d2 = segment2(a, b);
        float tick = exp(-0.5 * d2 / 0.6);
        if (i < 0) {
            col += accent.rgb * tick * 0.7;
        } else {
            vec4 n = i == 0 ? ch[0] : (i == 1 ? ch[1] : (i == 2 ? ch[2] : ch[3]));
            col += ink.rgb * tick * mix(0.25, 0.75, n.z);
        }
    }

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
