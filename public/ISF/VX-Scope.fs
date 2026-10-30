/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Oscilloscope music. The sounding notes become oscillators at their true frequency ratios and drive an XY beam: one note draws an ellipse, a fifth a 3:2 figure, an octave a 2:1 figure, a chord a slowly turning knot in three dimensions. The beam burns into a phosphor that fades, and the figures drift exactly as equal-tempered intervals beat against pure ones.",
    "PASSES": [
        {
            "TARGET": "osc",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 64,
            "HEIGHT": 1
        },
        {
            "TARGET": "trace",
            "FLOAT": true,
            "WIDTH": 513,
            "HEIGHT": 1
        },
        {
            "TARGET": "spans",
            "FLOAT": true,
            "WIDTH": 512,
            "HEIGHT": 1
        },
        {
            "TARGET": "phosphor",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "traceLength", "LABEL": "Trace length", "TYPE": "float", "DEFAULT": 4, "MIN": 1, "MAX": 16 },
        { "NAME": "persistence", "LABEL": "Persistence", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "beamWidth", "LABEL": "Beam width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.1, "MAX": 1 },
        { "NAME": "rotation", "LABEL": "Rotation speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "3D tilt", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "graticule", "LABEL": "Graticule", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "focus", "LABEL": "Focus", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Beam", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Graticule", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
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

// osc: cell 0 = (last vxPhase, spin in turns, root phase, ready); cells 1..3 = phase
// of the 2nd..4th oscillator, all in cycles.
// trace: 513 beam positions along the figure (x, y, brightness, depth).
// spans: the bounding box of each run of 8 segments, so a pixel only looks at nearby beam.
// phosphor: the screen's afterglow.
// State cells are 8 pixels wide and read at their centres, so they survive the
// core resampling small targets to its output density.
const float SEGS = 512.0;
const float RUN = 8.0;
const float RUNS = 64.0;
const float TAU = 6.2831853;
const float CELL = 8.0;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// One line pixel in height units: never finer than the texel the core really renders,
// which can be coarser than RENDERSIZE suggests.
float pixelSize() {
    vec2 fw = fwidth(gl_FragCoord.xy);
    return max(1.0, max(fw.x, fw.y)) / RENDERSIZE.y;
}

// The sounding notes, lowest first. Column i = (MIDI note, energy, ratio to the root, weight).
// Notes much quieter than the loudest are let go so a released chord makes way for the next.
mat4 chord() {
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
    float root = a.x < 998.0 ? a.x : 60.0;
    float e = max(emax, 1e-4);
    vec4 n0 = vec4(a.x, a.y, 1.0, a.x < 998.0 ? 1.0 : 0.0);
    vec4 n1 = vec4(b.x, b.y, b.x < 998.0 ? exp2((b.x - root) / 12.0) : 1.0, b.x < 998.0 ? smoothstep(0.3, 0.6, b.y / e) : 0.0);
    vec4 n2 = vec4(c.x, c.y, c.x < 998.0 ? exp2((c.x - root) / 12.0) : 1.0, c.x < 998.0 ? smoothstep(0.3, 0.6, c.y / e) : 0.0);
    vec4 n3 = vec4(d.x, d.y, d.x < 998.0 ? exp2((d.x - root) / 12.0) : 1.0, d.x < 998.0 ? smoothstep(0.3, 0.6, d.y / e) : 0.0);
    return mat4(n0, n1, n2, n3);
}

// How far a ratio sits from the nearest simple one (denominator up to 6):
// this is what makes an equal-tempered interval slowly roll on a real scope.
float detune(float q) {
    float best = 0.0;
    float err = 1e3;
    for (int m = 1; m <= 6; m++) {
        float fm = float(m);
        float p = floor(q * fm + 0.5);
        float e = abs(q - p / fm) + fm * 0.0008;
        if (e < err) {
            err = e;
            best = q - p / fm;
        }
    }
    return best;
}

vec4 oscAt(float i) {
    return IMG_NORM_PIXEL(osc, vec2((i + 0.5) / 8.0, 0.5));
}

vec4 traceAt(float i) {
    return IMG_NORM_PIXEL(trace, vec2((i + 0.5) / (SEGS + 1.0), 0.5));
}

float radiusScale() {
    return size * 0.4;
}

// A real scope's graticule: 10 by 8 divisions, dotted lines, a ticked centre cross.
float graticuleAt(vec2 p, float div, float px) {
    vec2 g = p / div;
    vec2 edge = vec2(5.0, 4.0);
    if (abs(g.x) > edge.x + 0.02 || abs(g.y) > edge.y + 0.02) return 0.0;
    vec2 toLine = abs(fract(g + 0.5) - 0.5) * div / px;
    vec2 toDot = abs(fract(g * 5.0 + 0.5) - 0.5) * div / 5.0 / px;
    float lineX = 1.0 - smoothstep(0.35, 1.1, toLine.x);
    float lineY = 1.0 - smoothstep(0.35, 1.1, toLine.y);
    float dotX = 1.0 - smoothstep(0.5, 1.3, toDot.x);
    float dotY = 1.0 - smoothstep(0.5, 1.3, toDot.y);
    float dotted = max(lineX * dotY, lineY * dotX) * 0.55;
    vec2 ax = abs(p) / px;
    float axes = max(1.0 - smoothstep(0.35, 1.1, ax.x), 1.0 - smoothstep(0.35, 1.1, ax.y)) * 0.45;
    float tick = div * 0.12 / px;
    float ticks = max((1.0 - smoothstep(tick, tick + 1.0, ax.y)) * dotX, (1.0 - smoothstep(tick, tick + 1.0, ax.x)) * dotY) * 0.6;
    vec2 toEdge = abs(abs(g) - edge) * div / px;
    float frame = max((1.0 - smoothstep(0.35, 1.1, toEdge.x)) * step(abs(g.y), edge.y), (1.0 - smoothstep(0.35, 1.1, toEdge.y)) * step(abs(g.x), edge.x)) * 0.55;
    return max(max(dotted, axes), max(ticks, frame));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        // Phases are integrated here so they never jump, however long the set runs.
        float i = floor(gl_FragCoord.x / CELL);
        vec4 st = oscAt(0.0);
        bool ready = st.w > 0.5 && FRAMEINDEX >= 2;
        float dPh = vxPhase - st.x;
        if (dPh < 0.0) dPh += 1000.0;
        if (!ready || dPh > 5.0) dPh = 0.0;
        // The beam crawls slowly along its own path, so the trace's ends never sit still.
        float crawl = 0.12;
        if (i < 0.5) {
            float spin = fract(st.y + dPh * rotation * 0.06);
            float root = fract(st.z + dPh * crawl);
            gl_FragColor = vec4(vxPhase, ready ? spin : 0.0, ready ? root : 0.0, 1.0);
            return;
        }
        mat4 ch = chord();
        float q = i < 1.5 ? ch[1].z : (i < 2.5 ? ch[2].z : ch[3].z);
        float rate = q * crawl + detune(q) * mix(1.0, 14.0, drift) + 0.004 * drift * i;
        float ph = ready ? oscAt(i).x : 0.0;
        gl_FragColor = vec4(fract(ph + rate * dPh), 0.0, 0.0, 1.0);
        return;
    }

    if (PASSINDEX == 1) {
        // One point of the trace, at this texel's own place along it, so reads between
        // texels land on the curve whatever the target's real resolution.
        float j = clamp(gl_FragCoord.x - 0.5, 0.0, SEGS);
        mat4 ch = chord();
        float L = traceLength;
        float u = L * j / SEGS;
        float emax = max(max(ch[0].y, ch[1].y), max(ch[2].y, ch[3].y));
        float master = ch[0].w * smoothstep(0.0, 0.18, emax);
        float a1 = ch[1].w;
        float a2 = ch[2].w;
        float a3 = ch[3].w;
        float t0 = TAU * (u + oscAt(0.0).z);
        float t1 = TAU * (ch[1].z * u + oscAt(1.0).x);
        float t2 = TAU * (ch[2].z * u + oscAt(2.0).x);
        float t3 = TAU * (ch[3].z * u + oscAt(3.0).x);
        // x: the root. y: the second note, or the root a quarter turn on.
        // z: the third (and fourth), or the root in quadrature, so a spin reads as phase.
        vec3 P = vec3(sin(t0), mix(cos(t0), sin(t1), a1), 0.0);
        float zc = (sin(t2) + 0.6 * a3 * sin(t3)) / (1.0 + 0.6 * a3);
        P.z = mix(cos(t0), zc, a2);
        vec3 V = vec3(cos(t0), mix(-sin(t0), ch[1].z * cos(t1), a1), 0.0);
        float vzc = (ch[2].z * cos(t2) + 0.6 * a3 * ch[3].z * cos(t3)) / (1.0 + 0.6 * a3);
        V.z = mix(-sin(t0), vzc, a2);

        float R = radiusScale() * master;
        float spin = TAU * oscAt(0.0).y;
        float cs = cos(spin);
        float sn = sin(spin);
        float tl = tilt * 0.9;
        float ct = cos(tl);
        float st = sin(tl);
        vec3 Q = vec3(P.x * cs + P.z * sn, P.y, -P.x * sn + P.z * cs);
        vec3 S = vec3(Q.x, Q.y * ct - Q.z * st, Q.y * st + Q.z * ct);
        vec3 Vq = vec3(V.x * cs + V.z * sn, V.y, -V.x * sn + V.z * cs);
        vec2 Vs = vec2(Vq.x, Vq.y * ct - Vq.z * st);

        // A resting beam is never perfectly still.
        float wob = vxPhase * 1.3;
        vec2 rest = 0.0025 * vec2(sin(wob * 1.7) + 0.5 * sin(wob * 4.1), cos(wob * 1.3) + 0.5 * cos(wob * 3.7));

        // The beam is brighter where it moves slowly, as on a real tube.
        float qMean = (1.0 + ch[1].z * a1 + ch[2].z * a2) / (1.0 + a1 + a2);
        float speed = length(Vs);
        float slow = pow(clamp(qMean * 0.75 / (speed + 1e-3), 0.4, 3.0), 0.55);
        slow = mix(1.0, slow, smoothstep(0.0, 0.3, master));
        // The oldest part of the trace fades out like a phosphor tail.
        float ends = smoothstep(0.0, L * 0.35, u) * smoothstep(L, L - 0.03, u);
        float depth = 0.72 + 0.28 * (-S.z);
        gl_FragColor = vec4(S.xy * R + rest, slow * ends * depth, S.z);
        return;
    }

    if (PASSINDEX == 2) {
        // Bounding box of one run of segments.
        float c = floor(gl_FragCoord.x / CELL);
        vec2 lo = vec2(1e3);
        vec2 hi = vec2(-1e3);
        for (int k = 0; k <= 8; k++) {
            vec2 q = traceAt(c * RUN + float(k)).xy;
            lo = min(lo, q);
            hi = max(hi, q);
        }
        gl_FragColor = vec4(lo, hi);
        return;
    }

    if (PASSINDEX == 3) {
        vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
        float px = pixelSize();
        float hit2 = vxHit * vxHit;
        // With nothing held the beam rests in the middle as a soft spot.
        float resting = 1.0 - smoothstep(0.0, 0.18, max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3)));
        float sigma = mix(0.5, 1.5, beamWidth) * (1.0 + 0.6 * hit2 + 0.8 * resting) * px;
        float haloR = mix(9.0, 2.5, focus) * px;
        float haloA = mix(0.2, 0.035, focus);
        float reach = max(sigma * 3.5, haloR * 4.0);
        float beam = 0.0;
        for (int c = 0; c < 64; c++) {
            vec4 bx = IMG_NORM_PIXEL(spans, vec2((float(c) + 0.5) / RUNS, 0.5));
            if (p.x < bx.x - reach || p.x > bx.z + reach || p.y < bx.y - reach || p.y > bx.w + reach) continue;
            float base = float(c) * RUN;
            vec4 a = traceAt(base);
            for (int k = 1; k <= 8; k++) {
                vec4 b = traceAt(base + float(k));
                vec2 ab = b.xy - a.xy;
                vec2 ap = p - a.xy;
                float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
                vec2 dd = ap - ab * h;
                float d2 = dot(dd, dd);
                if (d2 < reach * reach) {
                    float prof = exp(-0.5 * d2 / (sigma * sigma)) + haloA * exp(-sqrt(d2) / haloR);
                    beam = max(beam, prof * mix(a.z, b.z, h));
                }
                a = b;
            }
        }
        float level = mix(0.3, 1.0, smoothstep(0.0, 0.5, vxEnv)) * (1.0 + 0.9 * hit2) + 0.45 * resting;
        float prev = IMG_NORM_PIXEL(phosphor, uv).r;
        float f60 = dt * 60.0;
        float keep = pow(mix(0.6, 0.965, persistence), f60);
        float glow = max(prev * keep - 0.002 * f60, beam * level);
        if (FRAMEINDEX < 2) glow = 0.0;
        gl_FragColor = vec4(glow, beam, 0.0, 1.0);
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float px = pixelSize();
    float glow = IMG_NORM_PIXEL(phosphor, uv).r;
    vec3 col = ink.rgb * (1.0 - exp(-glow * 1.5)) * 1.05;
    // The hottest part of the trace runs a touch whiter, like a burning phosphor.
    col += vec3(0.9, 0.85, 0.8) * max(glow - 1.1, 0.0) * 0.12;
    col += accent.rgb * graticuleAt(p, radiusScale() / 3.0, px) * graticule * 0.4;
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
