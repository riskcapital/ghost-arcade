/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A clean monochrome test picture on a video raster that loses sync on every hit. The picture rolls, the blanking bar with its test lines passes through, the lines below a tear slide sideways and the horizontal hold wobbles; then it pulls back into lock in about half a beat. Harder hits roll further, and every few hits roll a whole frame.",
    "PASSES": [
        {
            "TARGET": "rollState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "tempo",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "image", "LABEL": "Image", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2], "LABELS": ["Bars", "Grid", "Ramp"] },
        { "NAME": "rollAmount", "LABEL": "Roll amount", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "fullRoll", "LABEL": "Full roll every", "TYPE": "long", "DEFAULT": 4, "VALUES": [0, 2, 4, 8], "LABELS": ["Never", "2nd hit", "4th hit", "8th hit"] },
        { "NAME": "tear", "LABEL": "Tear", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "wobble", "LABEL": "Hold wobble", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "relock", "LABEL": "Re-lock time", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.2, "MAX": 1.5 },
        { "NAME": "lineStructure", "LABEL": "Line structure", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "level", "LABEL": "Picture level", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Test lines", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
// Vertical and horizontal blanking, as a share of the picture.
const float VBI = 0.1;
const float HBI = 0.09;
// Raster lines across the picture height.
const float RASTER = 200.0;

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

// Vertical offset of the picture, in frames, u = seconds since the hit / re-lock time.
// A full roll (R = 1) runs one frame and lands locked; a partial roll slips by R
// and hunts back into lock. carry eases out whatever roll was still running.
float rollOffset(float u, float R, float carry) {
    float uc = clamp(u, 0.0, 1.0);
    float off = carry * (1.0 - smoothstep(0.0, 1.0, uc));
    if (R > 0.99) off += 1.0 - pow(1.0 - uc, 3.0);
    else off += R * (1.0 - exp(-uc * 16.0)) * exp(-uc * 3.5) * cos(uc * 5.2) * (1.0 - smoothstep(0.85, 1.0, uc));
    return off;
}

// Coverage of a line w pixels wide at distance d pixels; aa is one stored pixel.
float lineCov(float d, float w, float aa) {
    float ww = max(w, aa);
    return clamp((0.5 * ww - d) / aa + 0.5, 0.0, 1.0) * min(w / aa, 1.0);
}

// The test picture at (x, v): x 0-1 left to right, v 0-1 top to bottom.
float testImage(float x, float v, float aspect, vec2 px, float lw) {
    float img = floor(image + 0.5);
    float ph = vxPhase;
    float lum = 0.0;
    vec2 q = vec2((x - 0.5) * aspect, v - 0.5);
    if (img < 0.5) {
        // Bars: a falling staircase of eight bars from the H ramp, a reversed
        // strip under it, and a smooth ramp at the foot.
        float bar = floor(x * 8.0);
        float inBar = abs(fract(x * 8.0) - 0.5) * 2.0;
        float gap = 1.0 - smoothstep(1.0 - 2.0 * 8.0 * px.x, 1.0, inBar);
        if (v > 0.1 && v < 0.6) lum = (0.62 - bar * 0.08) * gap;
        if (v > 0.64 && v < 0.7) lum = (0.06 + bar * 0.08) * gap;
        float ramp = fract(x + ph * 0.01);
        if (v > 0.76 && v < 0.86) lum = 0.75 * ramp * smoothstep(0.0, 0.02, 1.0 - ramp);
        if (v > 0.89 && v < 0.9 + 1.5 * px.y) lum = 0.6;
    } else if (img < 1.5) {
        // Grid: a crosshatch, a centre cross and a ring that breathes slowly.
        vec2 g = vec2(x * 16.0, v * 9.0);
        vec2 dg = abs(fract(g + 0.5) - 0.5) / vec2(16.0, 9.0) / px;
        float grid = max(lineCov(dg.x, lw, 1.0), lineCov(dg.y, lw, 1.0));
        lum = 0.32 * grid;
        vec2 dc = abs(vec2(x - 0.5, v - 0.5)) / px;
        float cross = max(lineCov(dc.x, lw * 1.6, 1.0), lineCov(dc.y, lw * 1.6, 1.0)) * step(abs(q.x), 0.12) * step(abs(q.y), 0.12);
        lum = max(lum, 0.75 * cross);
        float rad = 0.4 + 0.012 * sin(ph * 0.21);
        float dr = abs(length(q) - rad) / px.y;
        lum = max(lum, 0.85 * lineCov(dr, lw * 1.4, 1.0));
        // A thin step wedge across the middle row.
        if (abs(v - 0.5 - 1.0 / 9.0) < 1.0 / 60.0 && abs(x - 0.5) < 0.1875) lum = max(lum, (floor((x - 0.3125) * 16.0) + 1.0) / 6.0 * 0.55 * step(0.12, fract((x - 0.3125) * 16.0)));
    } else {
        // Ramp: a diamond made from |H| + |V| ramps, cut into contour bands.
        float r = abs(q.x) + abs(q.y) * 1.2 - ph * 0.02;
        float bands = r * 12.0;
        float fb = fract(bands);
        float edge = min(fb, 1.0 - fb) / max(fwidth(bands), 1e-4);
        float fill = mod(floor(bands), 2.0) < 0.5 ? 0.14 : 0.03;
        float fadeOut = 1.0 - smoothstep(0.55, 0.85, abs(q.x) + abs(q.y) * 1.2);
        lum = (fill + 0.7 * (1.0 - smoothstep(0.5, 1.4, edge))) * fadeOut;
    }
    return lum;
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    vec4 tp = IMG_NORM_PIXEL(tempo, vec2(0.5));
    float spb = clamp(tp.g > 0.1 ? tp.g : 0.5, 0.25, 1.4);
    float relockSec = relock * spb;

    // rollState: r the count, g seconds since the hit, b the roll (1 = full
    // frame), a the roll carried over from the hit before.
    if (PASSINDEX == 0) {
        vec4 prev = IMG_NORM_PIXEL(rollState, vec2(0.5));
        if (FRAMEINDEX < 2) prev = vec4(n, 30.0, 0.0, 0.0);
        vec4 v = vec4(prev.r, min(prev.g + dt, 30.0), prev.b, prev.a);
        if (abs(n - prev.r) > 0.5) {
            float now = rollOffset(prev.g / relockSec, prev.b, prev.a);
            float every = floor(fullRoll + 0.5);
            bool full = every > 0.5 && mod(n, every) < 0.5;
            float R = full ? 1.0 : rollAmount * (0.1 + 0.25 * clamp(vxVel, 0.0, 1.0));
            v = vec4(n, 0.0, R, fract(now + 0.5) - 0.5);
        }
        gl_FragColor = v;
        return;
    }
    // tempo: the beat clock's last position and the measured seconds per beat.
    if (PASSINDEX == 1) {
        float s = (FRAMEINDEX < 2 || tp.g < 0.1) ? 0.5 : tp.g;
        float step01 = mod(vxBeat - tp.r + 1.0, 1.0);
        if (FRAMEINDEX >= 2 && dt > 0.0 && step01 > 0.0005 && step01 < 0.3) {
            s = mix(s, clamp(dt / step01, 0.25, 1.4), 1.0 - exp(-dt / 0.6));
        }
        gl_FragColor = vec4(vxBeat, s, 0.0, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 px = fw / RENDERSIZE;
    float lw = max(1.3 * RENDERSIZE.y / 1080.0, 1.0) / fw.y;

    vec4 st = IMG_NORM_PIXEL(rollState, vec2(0.5));
    float age = st.g;
    float u = age / relockSec;
    float off = rollOffset(u, st.b, st.a);
    // How hard the picture is out of lock right now; full rolls shake harder.
    float unlock = exp(-u * 4.0) * (1.0 - smoothstep(0.9, 1.2, u)) * (st.b > 0.99 ? 1.0 : 0.45 + 2.0 * st.b);
    unlock = clamp(unlock, 0.0, 1.0);

    // Scan position, top of the frame first.
    float yTop = 1.0 - uv.y;
    float period = 1.0 + VBI;
    float vq = mod(yTop + off * period, period);

    // Horizontal hold: the lines below the tear slide sideways, the lines just
    // after the blanking bend back into place, and the hold wobbles.
    float seed = hash11(st.r * 7.13 + 2.0);
    float tearY = 0.3 + 0.45 * seed;
    float side = seed > 0.5 ? 1.0 : -1.0;
    float hx = 0.0;
    if (yTop > tearY) hx += side * tear * 0.14 * unlock * (0.45 + 0.55 * exp(-(yTop - tearY) / 0.07));
    hx += -side * tear * 0.07 * unlock * exp(-vq / 0.05);
    hx += wobble * 0.03 * unlock * sin(yTop * TAU * 2.5 - age * 22.0);
    float xq = mod(uv.x - hx, 1.0 + HBI);

    float lum = 0.0;
    float acc = 0.0;
    if (vq <= 1.0 && xq <= 1.0) {
        lum = testImage(xq, vq, aspect, px, lw) * level;
    } else if (vq > 1.0) {
        // Inside the vertical blanking: black, with a row of equalising pulses
        // and one test line, a five-step staircase, in the accent.
        float vb = (vq - 1.0) / VBI;
        float lineH = 1.6 * px.y / VBI;
        if (abs(vb - 0.3) < lineH && xq <= 1.0) {
            float stair = floor(xq * 5.0 + 1.0) / 5.0;
            acc = stair * 0.9;
        }
        if (abs(vb - 0.62) < lineH * 0.8 && xq <= 1.0) {
            lum = 0.22 * step(0.5, fract(xq * 24.0));
        }
    }

    // Raster lines: a beam profile per line, faded out when lines get too fine to draw.
    float pitchPx = RENDERSIZE.y / RASTER / fw.y;
    float ls = lineStructure * smoothstep(2.2, 4.0, pitchPx);
    float beam = 0.5 + 0.5 * cos(TAU * fract(yTop * RASTER));
    float rasterGain = mix(1.0, 0.25 + 1.25 * beam * beam, ls);
    lum *= rasterGain;
    acc *= mix(1.0, 0.4 + 0.9 * beam, ls);

    vec3 col = ink.rgb * clamp(lum, 0.0, 1.0);
    col = mix(col, accent.rgb, clamp(acc, 0.0, 1.0));
    float lit = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lit);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
