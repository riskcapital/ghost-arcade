/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A multi-head tape echo drawn as a diagram. Every hit writes a short bright transient onto the top strip of tape. The marks ride right on real time; as each one passes a playback head a softer copy drops to the next strip down and rides on, wavering with wow and flutter, so the echo's own timing spreads out down the stack.",
    "PASSES": [
        {
            "TARGET": "hits",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 40,
            "HEIGHT": 40
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "heads", "LABEL": "Playback heads", "TYPE": "float", "DEFAULT": 2, "MIN": 1, "MAX": 4 },
        { "NAME": "echoTime", "LABEL": "Echo time", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4], "LABELS": ["1/4 beat", "3/8 beat", "1/2 beat", "3/4 beat", "1 beat"] },
        { "NAME": "feedback", "LABEL": "Feedback", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "wow", "LABEL": "Wow and flutter", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "strips", "LABEL": "Strips", "TYPE": "float", "DEFAULT": 5, "MIN": 2, "MAX": 8 },
        { "NAME": "markLength", "LABEL": "Mark length", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "tapeSpeed", "LABEL": "Tape speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "hiss", "LABEL": "Tape hiss", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Marks", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Heads", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// hits: a 5 x 5 grid of cells, each 8 x 8 texels and read at its centre so it
// survives the core resampling small targets. Cells 0..15 hold the newest hits as
// (whole seconds of age, fraction of a second, velocity, hit number + 1).
// Cell 16 holds (last count + 1, beat length in seconds, last beat, tape clock).
// The age is split in two so half-float storage keeps it exact.
const float CELLS = 5.0;
const float SLOTS = 16.0;
const float TAU = 6.2831853;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 cellAt(float i) {
    return IMG_NORM_PIXEL(hits, vec2((mod(i, CELLS) + 0.5) / CELLS, (floor(i / CELLS) + 0.5) / CELLS));
}

// Share of the copies at offset m (in echo steps) after s generations through h heads,
// normalised so the commonest offset is 1. A smooth stand-in for the exact counts.
float spreadWeight(float s, float m, float h) {
    if (h < 1.5 || s < 0.5) return m < 0.5 ? 1.0 : 0.0;
    float mu = s * (h - 1.0) * 0.5;
    float var = s * (h * h - 1.0) / 12.0;
    float d = m - mu;
    return exp(-d * d / (2.0 * var));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float ci = floor(uv.x * CELLS) + CELLS * floor(uv.y * CELLS);
        vec4 meta = cellAt(SLOTS);
        float n = floor(vxCount + 0.5);
        bool ready = meta.x > 0.5 && FRAMEINDEX >= 2;
        bool fresh = ready && abs(meta.x - (n + 1.0)) > 0.5;
        if (ci < SLOTS - 0.5) {
            vec4 s = cellAt(ci);
            if (!ready) {
                s = vec4(0.0);
            } else {
                s.y += dt;
                if (s.y >= 1.0) {
                    s.y -= 1.0;
                    s.x = min(s.x + 1.0, 60.0);
                }
            }
            if (fresh && abs(ci - mod(n, SLOTS)) < 0.5) s = vec4(0.0, 0.0, clamp(vxVel, 0.15, 1.0), n + 1.0);
            gl_FragColor = s;
        } else if (ci < SLOTS + 0.5) {
            // Beat length, measured from how fast the beat clock turns.
            float beatSec = meta.y > 0.05 ? meta.y : 0.5;
            float d = fract(vxBeat - meta.z + 1.0);
            if (ready && dt > 0.0001 && d > 0.0001 && d < 0.3) {
                beatSec = mix(beatSec, clamp(dt / d, 0.2, 2.0), 1.0 - exp(-dt * 3.0));
            }
            float clock = ready ? mod(meta.w + dt, 8.0) : 0.0;
            gl_FragColor = vec4(n + 1.0, beatSec, vxBeat, clock);
        } else {
            gl_FragColor = vec4(0.0);
        }
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    // One rendered pixel, across and down, in height units.
    vec2 fwp = fwidth(gl_FragCoord.xy);
    float pxX = max(1.0, fwp.x) / RENDERSIZE.y;
    float pxY = max(1.0, fwp.y) / RENDERSIZE.y;

    vec4 meta = cellAt(SLOTS);
    float beatSec = meta.y > 0.05 ? meta.y : 0.5;
    float et = float(echoTime);
    float echoBeats = et < 0.5 ? 0.25 : (et < 1.5 ? 0.375 : (et < 2.5 ? 0.5 : (et < 3.5 ? 0.75 : 1.0)));
    float E = echoBeats * beatSec;
    float S = floor(clamp(strips, 2.0, 8.0) + 0.5);
    float H = floor(clamp(heads, 1.0, 4.0) + 0.5);
    float fb = mix(0.3, 0.85, feedback);

    // The tape runs left to right. Each strip's record head sits under the first
    // playback head of the strip above, so the stack steps down and right.
    float X0 = -0.46 * aspect;
    float X1 = 0.47 * aspect;
    float stepX = (X1 - X0) / (S - 1.0 + H + 1.4) * mix(0.72, 1.2, tapeSpeed);
    float v = stepX / E;
    float top = 0.3;
    float sp = 0.6 / (S - 1.0);
    float tw = min(0.085, sp * 0.5);
    float s = clamp(floor((top - p.y) / sp + 0.5), 0.0, S - 1.0);
    float ys = top - s * sp;
    float dy = p.y - ys;
    float xRec = X0 + s * stepX;
    float soft = s / max(S - 1.0, 1.0);
    float n = floor(vxCount + 0.5);
    float wph = vxPhase;

    vec4 slots[16];
    for (int i = 0; i < 16; i++) slots[i] = cellAt(float(i));

    vec3 col = vec3(0.0);

    // Tape edges: faint before this strip's record head (blank tape), firmer after it.
    float ends = smoothstep(X0 - 0.06, X0 - 0.01, p.x) * (1.0 - smoothstep(X1 + 0.01, X1 + 0.07, p.x));
    float edgeD = abs(abs(dy) - tw * 0.5) / pxY;
    float edge = exp(-edgeD * edgeD / 0.55) * ends * mix(0.07, 0.2, smoothstep(xRec - pxX, xRec + pxX, p.x));
    col += ink.rgb * edge;

    // Hiss: sparse specks in the oxide, riding with the tape.
    float tapeX = p.x - X0 - v * meta.w;
    float cell = floor(tapeX / (2.5 * pxX));
    float hz = hash21(vec2(cell, s * 17.0 + 3.0));
    float speck = step(0.94, hz) * step(abs(dy), tw * 0.42 * hash11(cell * 1.7 + s));
    float sx = abs(fract(tapeX / (2.5 * pxX)) - 0.5) * 2.5;
    col += ink.rgb * speck * exp(-sx * sx / 0.5) * hiss * 0.12 * ends * step(xRec, p.x);

    // Marks on this strip. Copies at offset m echo steps behind the dry hit.
    float marks = 0.0;
    float flashRec = 0.0;
    float flashHead = 0.0;
    float mMax = s * (H - 1.0);
    float len = mix(0.18, 0.85, markLength) * stepX;
    float lam = max(mix(0.0055, 0.012, soft), 3.2 * pxX);
    for (int i = 0; i < 16; i++) {
        vec4 sl = slots[i];
        if (sl.w > 0.5) {
            float age = sl.x + sl.y;
            float idx = sl.w - 1.0;
            float rank = mod(n - idx + 64.0, 64.0);
            float keep = 1.0 - smoothstep(11.0, 15.0, rank);
            float base = sl.z * keep * pow(fb, s);
            float seed = hash11(idx * 7.13 + 1.7);
            // Which copy's leading edge is just ahead of this pixel.
            float kf = (age - (p.x - X0) / v) / E;
            float m = floor(kf);
            if (m >= 0.0 && m <= mMax && p.x >= xRec) {
                float a = base * spreadWeight(s, m, H);
                // Wow: each copy wanders a little; deeper copies wander more.
                float wk = wow * sqrt(s) * stepX;
                float js = hash11(seed * 13.0 + m * 3.1 + s * 5.7);
                float dx = wk * (0.05 * sin(wph * 1.6 + js * TAU) + 0.018 * sin(wph * 7.3 + js * 19.0));
                float dyw = wow * sqrt(s) * tw * 0.035 * sin(wph * 2.1 + js * 11.0);
                float b = v * E * (kf - m) + dx;
                float L = len * (1.0 + 0.3 * s);
                float env = exp(-max(b, 0.0) / (0.28 * L)) * (1.0 - smoothstep(0.6 * L, L, b));
                float attack = smoothstep(-1.2 * pxX * (1.0 + 2.0 * soft), 0.0, b);
                env *= attack;
                // The transient: a hard leading edge and fine flux stripes that decay behind it.
                float lead = b / (pxX * (1.0 + 2.5 * soft));
                float edgeLine = exp(-lead * lead / 1.3);
                float sd = abs(fract(b / lam + 0.5) - 0.5) * lam / pxX;
                float stripe = mix(exp(-sd * sd / 0.9) + 0.08, 0.36, soft * 0.85);
                // Each flux stripe gets its own height, like a printed waveform; copies lose the detail.
                float rough = hash11(floor(b / lam + 0.5) * 1.37 + seed * 41.0 + m * 3.0);
                float halfH = tw * 0.5 * (0.12 + 0.86 * env * mix(0.35 + 0.65 * rough, 0.8, soft));
                float yy = abs(dy - dyw);
                float yv = 1.0 - smoothstep(halfH - pxY, halfH + pxY, yy);
                float yLead = 1.0 - smoothstep(tw * 0.5 - pxY, tw * 0.5 + pxY, yy);
                // Nothing spills past the tape's edges.
                float onTape = 1.0 - smoothstep(tw * 0.5 - 1.5 * pxY, tw * 0.5 - 0.5 * pxY, abs(dy));
                yv *= onTape;
                yLead *= onTape;
                marks += a * (edgeLine * yLead * (1.0 - 0.5 * soft) + stripe * env * yv * 0.85);
            }
            // Head flashes: the record head as a copy lands, the playback heads as it leaves.
            float c0 = age - (s + clamp(floor(age / E - s), 0.0, mMax)) * E;
            float m0 = clamp(floor(age / E - s), 0.0, mMax);
            if (c0 >= 0.0) flashRec += base * spreadWeight(s, m0, H) * exp(-c0 / 0.09);
            for (int j = 1; j <= 4; j++) {
                float fj = float(j);
                if (fj <= H) {
                    float xh = X0 + (s + fj) * stepX;
                    if (abs(p.x - xh) < 6.0 * pxX) {
                        float mj = clamp(floor(age / E - s - fj), 0.0, mMax);
                        float cj = age - (s + fj + mj) * E;
                        if (cj >= 0.0) flashHead += base * spreadWeight(s, mj, H) * exp(-cj / 0.12) * (s < S - 1.5 ? 1.0 : 0.4);
                    }
                }
            }
        }
    }
    float lane = step(abs(dy), tw * 1.2);
    col += ink.rgb * (1.0 - exp(-marks * 2.6)) * lane * 1.25;

    // Heads: short upright ticks across the strip. The record head is a double tick.
    float tickY = 1.0 - smoothstep(tw * 0.85, tw * 0.85 + pxY, abs(dy));
    float rd = min(abs(p.x - xRec + 1.5 * pxX), abs(p.x - xRec - 1.5 * pxX)) / pxX;
    float recTick = exp(-rd * rd / 0.5) * tickY;
    col += ink.rgb * recTick * (0.32 + 0.9 * min(flashRec, 1.0));
    float hd = 99.0;
    for (int j = 1; j <= 4; j++) {
        float fj = float(j);
        if (fj <= H) hd = min(hd, abs(p.x - (xRec + fj * stepX)) / pxX);
    }
    float headTick = exp(-hd * hd / 0.5) * tickY;
    col += ink.rgb * headTick * 0.22;
    col += accent.rgb * headTick * min(flashHead, 1.0) * 1.1;

    // Drop lines between strips: from each playback head down to the record head
    // of the strip below. Faint dotted guides that light as a copy drops through.
    float g = floor((top - p.y) / sp);
    if (g >= 0.0 && g < S - 1.0) {
        float yA = top - g * sp - tw * 0.5;
        float yB = top - (g + 1.0) * sp + tw * 0.5;
        float xB = X0 + (g + 1.0) * stepX;
        float drop = 0.0;
        float lit = 0.0;
        for (int j = 1; j <= 4; j++) {
            float fj = float(j);
            if (fj <= H) {
                vec2 A = vec2(X0 + (g + fj) * stepX, yA);
                vec2 B = vec2(xB, yB);
                vec2 ab = B - A;
                vec2 ap = p - A;
                float h = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
                vec2 dd = ap - ab * h;
                float dl = length(dd / vec2(pxX, pxY));
                float line = exp(-dl * dl / 0.45);
                float dots = step(0.5, fract(h * length(ab) / (5.0 * pxY)));
                drop = max(drop, line * dots * 0.1);
                // A short pulse runs down the line as a copy drops.
                float mMaxG = g * (H - 1.0);
                for (int i = 0; i < 16; i++) {
                    vec4 sl = slots[i];
                    if (sl.w > 0.5) {
                        float age = sl.x + sl.y;
                        float mj = clamp(floor(age / E - g - fj), 0.0, mMaxG);
                        float cj = age - (g + fj + mj) * E;
                        if (cj >= 0.0 && cj < 0.25) {
                            float rank = mod(n - (sl.w - 1.0) + 64.0, 64.0);
                            float a = sl.z * pow(fb, g) * spreadWeight(g, mj, H) * (1.0 - smoothstep(11.0, 15.0, rank));
                            float front = cj / 0.07;
                            float pulse = exp(-(h - front) * (h - front) / 0.02) + 0.3 * step(h, front) * exp(-cj / 0.08);
                            lit = max(lit, line * a * pulse);
                        }
                    }
                }
            }
        }
        col += ink.rgb * drop;
        col += accent.rgb * min(lit, 1.0) * 0.8;
    }

    col = col / (1.0 + 0.25 * col);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
