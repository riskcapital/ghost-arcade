/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A scrolling oscillogram. The waveform of the playing note, a sine with its harmonics at the note's pitch, is drawn as one bright trace at the right edge; a copy is kept every moment and the copies scroll away to the left and fade, so the frame becomes a stacked record of the line. Nearer traces hide the ones behind them; tilt the stack and it recedes in perspective like a ridge-line chart.",
    "PASSES": [
        {
            "TARGET": "scrollClock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "history",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "harmonics", "LABEL": "Harmonics", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "amplitude", "LABEL": "Amplitude", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "scroll", "LABEL": "Scroll speed", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "fade", "LABEL": "Fade", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "Tilt", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "spacing", "LABEL": "Trace spacing", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "window", "LABEL": "Window", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Traces", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Newest trace", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
// The history: 64 traces in an 8x8 grid of cells, each many stored pixels wide.
const float CELLS = 8.0;
const float TRACES = 64.0;
// Trace extent (screen height units, centred) and the newest trace's position.
const float HALF_H = 0.4;
const int MAX_CAND = 18;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float traceSpacing() {
    return mix(0.008, 0.034, spacing);
}

// Cycles along the trace for a note: more for higher notes.
float cyclesFor(float pitch) {
    return 3.5 * exp2((pitch * 127.0 - 36.0) / 12.0 * 0.75);
}

vec2 cellUV(float k) {
    return (vec2(mod(k, CELLS), floor(k / CELLS)) + 0.5) / CELLS;
}

// Deflection along a trace at s (0 top, 1 bottom) and its slope d/ds.
// The waveform is a sine plus harmonics, windowed so the ends lie flat.
vec2 deflect(float s, float amp, float cyc, float ph) {
    float th = TAU * (cyc * s + ph);
    float c1 = cos(th);
    float s1 = sin(th);
    float cn = c1;
    float sn = s1;
    float sum = 0.0;
    float dsum = 0.0;
    float norm = 0.0;
    float a = 1.0;
    for (int i = 1; i <= 8; i++) {
        float fi = float(i);
        sum += a * sn;
        dsum += a * fi * cn;
        norm += a;
        float cnext = cn * c1 - sn * s1;
        sn = sn * c1 + cn * s1;
        cn = cnext;
        a *= harmonics * (fi / (fi + 1.0)) * 0.95;
    }
    float wave = sum / norm;
    float dwave = dsum / norm * TAU * cyc;
    // Window: wide to narrow.
    float pw = mix(1.0, 6.0, window);
    float sw = sin(3.14159265 * s);
    float w = pow(max(sw, 0.0), pw);
    float dw = pw * pow(max(sw, 1e-4), pw - 1.0) * cos(3.14159265 * s) * 3.14159265;
    // Mostly one-sided, like a pulse chart: peaks reach left, troughs barely.
    float shaped = 0.3 + 0.7 * wave;
    float D = amp * w * shaped;
    float dD = amp * (dw * shaped + w * 0.7 * dwave);
    return vec2(D, dD);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float sp = traceSpacing();
    float env = clamp(vxEnv, 0.0, 1.0);
    float phNow = fract(vxPhase * 0.05);

    // scrollClock: r = how far toward the next copy (0-1), g = 1 on a frame
    // that takes a copy.
    if (PASSINDEX == 0) {
        vec4 prev = IMG_NORM_PIXEL(scrollClock, vec2(0.5));
        if (FRAMEINDEX < 2) prev = vec4(0.0);
        float speed = mix(0.04, 0.5, scroll);
        float acc = prev.r + dt * speed / sp;
        float push = 0.0;
        if (acc >= 1.0) {
            push = 1.0;
            acc = min(acc - 1.0, 0.99);
        }
        gl_FragColor = vec4(acc, push, 0.0, 1.0);
        return;
    }
    // history: each cell is one trace (r level, g note, b phase, a 1 once
    // written). A copy shifts every trace one cell on and writes the live one first.
    if (PASSINDEX == 1) {
        vec2 cell = floor(uv * CELLS);
        float k = cell.x + CELLS * cell.y;
        float push = IMG_NORM_PIXEL(scrollClock, vec2(0.5)).g;
        vec4 v = IMG_NORM_PIXEL(history, cellUV(k));
        if (push > 0.5) {
            if (k < 0.5) v = vec4(env, vxGlide, phNow, 1.0);
            else v = IMG_NORM_PIXEL(history, cellUV(k - 1.0));
        }
        if (FRAMEINDEX < 2) v = vec4(0.0);
        gl_FragColor = v;
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float aa = fw.x;
    float pxs = 1.0 / RENDERSIZE.y;
    float lw = max(mix(0.9, 2.6, lineWidth) * RENDERSIZE.y / 1080.0, 1.0);
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float xR = 0.5 * aspect - 0.12;
    float frac = IMG_NORM_PIXEL(scrollClock, vec2(0.5)).r;

    // Tilt sends the older traces back into depth toward a vanishing point on the
    // left, rising a little as they go, like a ridge-line chart seen from above.
    float stretch = 1.0 + 1.6 * tilt;
    float kz = 0.9 * tilt;
    float lift = 0.2 * tilt;
    float maxAmp = mix(0.04, 0.2, amplitude);
    float fadeK = mix(0.15, 2.4, fade);

    // History distance u for a screen x: the inverse of x = xR - U / (1 + U kz).
    float dxPix = xR - p.x;
    float zx = 1.0 + kz * max(dxPix, 0.0) / max(1.0 - kz * max(dxPix, 0.0), 0.05);
    float dxHi = xR - (p.x + maxAmp / zx + 0.01);
    float dxLo = xR - (p.x - 0.4 * maxAmp / zx - 0.01);
    float uLo = dxHi <= 0.0 ? 0.0 : dxHi / max(1.0 - dxHi * kz, 1e-4) / stretch;
    float uHi = (1.0 - dxLo * kz) <= 1e-4 ? 1e3 : dxLo / (1.0 - dxLo * kz) / stretch;
    float j0 = max(floor(uLo / sp - frac), 0.0);

    float frontier = 1e3;
    float white = 0.0;
    float newest = 0.0;
    // The live trace first (it is nearest), then the copies, newest to oldest.
    for (int i = -1; i < MAX_CAND; i++) {
        float j = i < 0 ? -1.0 : j0 + float(i);
        float u = i < 0 ? 0.0 : (j + frac) * sp;
        bool inRange = i < 0 ? (uLo <= 0.001) : (u <= uHi + sp && j < TRACES);
        vec4 tr = vec4(env, vxGlide, phNow, 1.0);
        if (i >= 0) tr = IMG_NORM_PIXEL(history, cellUV(j));
        if (inRange && tr.a > 0.5) {
            float U = u * stretch;
            float z = 1.0 + U * kz;
            float xk = xR - U / z;
            float yl = (p.y - lift * (1.0 - 1.0 / z)) * z;
            if (abs(yl) < HALF_H) {
                float s = (HALF_H - yl) / (2.0 * HALF_H);
                float level = clamp(tr.r, 0.0, 1.0);
                float amp = maxAmp * (0.05 + 0.95 * level);
                vec2 dd = deflect(s, amp, cyclesFor(tr.g), tr.b);
                float X = xk - dd.x / z;
                float slope = dd.y / (2.0 * HALF_H);
                float dist = abs(p.x - X) / pxs / sqrt(1.0 + slope * slope);
                float vis = clamp((frontier - p.x) / (aa * pxs) + 0.5, 0.0, 1.0);
                float wpx = lw / sqrt(z);
                float cov = clamp((0.5 * max(wpx, aa) - dist) / aa + 0.5, 0.0, 1.0) * min(wpx / aa, 1.0);
                float b = exp(-u * fadeK) * (0.35 + 0.65 * sqrt(level));
                if (i < 0) newest = cov * vis * (0.45 + 0.55 * sqrt(level));
                else white = max(white, cov * vis * b * 0.85);
                frontier = min(frontier, X);
            }
        }
    }

    float acc = clamp(newest, 0.0, 1.0);
    vec3 col = ink.rgb * clamp(white, 0.0, 1.0) * (1.0 - acc) + accent.rgb * acc;
    float lit = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lit);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
