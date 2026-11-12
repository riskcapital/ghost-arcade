/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Twenty-four metal harp strings stretched between brass pins in front of a dark board, lit from the upper left so each string is a gleaming tube with a soft shadow behind it. Every note plucks the string for its pitch: the string swings, rings as a standing wave with its overtones, and settles, harder notes swinging it wider. A ringing string catches a side light in the second color. With no sound the strings hang still and only their highlights shimmer.",
    "PASSES": [
        {
            "TARGET": "strings",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 200,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 10, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "swing", "LABEL": "Swing", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "sustain", "LABEL": "Sustain", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "tension", "LABEL": "Tension", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "gauge", "LABEL": "Gauge", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Strings", "TYPE": "color", "DEFAULT": [1.0, 0.76, 0.42, 1.0] },
        { "NAME": "accent", "LABEL": "Ringing light", "TYPE": "color", "DEFAULT": [0.3, 0.72, 1.0, 1.0] },
        { "NAME": "palGround", "LABEL": "Board", "TYPE": "color", "DEFAULT": [0.3, 0.2, 0.42, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 63 },
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

const float PI = 3.14159265;
// Number of strings (two octaves from C3) and state slots (one more for the hit counter).
const float NS = 24.0;
const float SLOTS = 25.0;
// The strings span this much of the frame's height across.
const float X0 = -0.6;
const float X1 = 0.6;
// Gap between the strings and the board behind them, for the shadows.
const float GAP = 0.05;

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

// Which string a note (MIDI/127) plays: two octaves from C3, wrapping by octaves outside it.
float stringOf(float note) {
    float m = floor(note * 127.0 + 0.5) - 48.0;
    return m - NS * floor(m / NS);
}

float noteAt(float i) {
    if (i < 0.5) return vxNote0;
    if (i < 1.5) return vxNote1;
    if (i < 2.5) return vxNote2;
    return vxNote3;
}

float energyAt(float i) {
    if (i < 0.5) return vxNoteE0;
    if (i < 1.5) return vxNoteE1;
    if (i < 2.5) return vxNoteE2;
    return vxNoteE3;
}

// String geometry: x position, bottom and top. Long bass strings on the left, the top ends
// following a gentle harp neck curve.
float stringX(float j) {
    return X0 + (X1 - X0) * j / (NS - 1.0);
}

float stringBot(float j) {
    float k = j / (NS - 1.0);
    return -0.4 + 0.42 * k;
}

float stringTop(float j) {
    float k = j / (NS - 1.0);
    return 0.4 - 0.24 * k + 0.06 * sin(k * PI * 1.1);
}

float stringR(float j) {
    float k = j / (NS - 1.0);
    return mix(0.0058, 0.003, k) * (0.6 + 0.8 * clamp(gauge, 0.0, 1.0));
}

// Sideways displacement of string j and its slope along the string, at height fraction s and
// clock tt, from its last pluck (state st: pluck time, strength, -, pluck point).
// The string rings as a standing wave of three modes shaped by where it was plucked.
vec2 stringDisp(float j, float s, float tt, vec4 st) {
    float k = j / (NS - 1.0);
    // Faint shimmer at rest so the strings are never quite dead.
    float dx = 0.0006 * sin(TIME * (0.5 + 0.3 * hash11(j)) + j * 2.1) * sin(PI * s);
    float dd = 0.0006 * sin(TIME * (0.5 + 0.3 * hash11(j)) + j * 2.1) * PI * cos(PI * s);
    float age = tt - st.x;
    if (st.y > 0.001 && age > 0.0 && age < 12.0) {
        float f1 = (1.6 + 2.2 * k) * (0.6 + 0.9 * clamp(tension, 0.0, 1.0));
        float tau = (0.6 + 2.6 * clamp(sustain, 0.0, 1.0)) * (1.25 - 0.5 * k);
        float amp = st.y * (0.008 + 0.05 * clamp(swing, 0.0, 1.0)) * smoothstep(0.0, 0.05, age);
        float pos = st.w;
        float norm = 0.0;
        float ax = 0.0;
        float ad = 0.0;
        for (int m = 1; m <= 3; m++) {
            float fm = float(m);
            float am = sin(fm * PI * pos) / (fm * fm);
            norm += am * sin(fm * PI * pos);
            float osc = cos(2.0 * PI * f1 * fm * age) * exp(-age * fm / tau);
            ax += am * sin(fm * PI * s) * osc;
            ad += am * fm * PI * cos(fm * PI * s) * osc;
        }
        float g = amp / max(norm, 0.05);
        dx += ax * g;
        dd += ad * g;
    }
    return vec2(dx, dd);
}

// How much a string is ringing now (0-1), for its side light.
float ringing(vec4 st, float tt) {
    float age = tt - st.x;
    if (st.y < 0.001 || age < 0.0) return 0.0;
    float tau = (0.6 + 2.6 * clamp(sustain, 0.0, 1.0));
    return st.y * exp(-age / tau) * smoothstep(0.0, 0.05, age);
}

// Shade a lit tube at cross-section position u (-1 to 1), with screen direction a across it and
// tangent tg along it. The key light is a tall soft box, so the highlight is found in the plane
// across the tube; that keeps a crisp highlight line along any tube.
vec3 tubeShade(float u, vec2 a, vec2 tg, vec3 base, vec3 specC, float gloss, vec3 L, vec3 H, float keyI) {
    vec3 n = vec3(a * u, sqrt(max(1.0 - u * u, 0.0)));
    vec3 t3 = vec3(tg, 0.0);
    vec3 hp = normalize(H - t3 * dot(H, t3));
    vec3 lp = normalize(L - t3 * dot(L, t3));
    float dif = max(dot(n, lp), 0.0);
    float spec = pow(max(dot(n, hp), 0.0), gloss);
    return (base * (0.05 + 0.55 * dif) + specC * spec * 2.4) * keyI;
}

// The frame: neck along the string tops, soundboard along the bottoms, pillar at the left.
float neckY(float x) {
    float j = (x - X0) / ((X1 - X0) / (NS - 1.0));
    return stringTop(clamp(j, -1.6, NS + 0.6)) + 0.026;
}

float boardY(float x) {
    float j = (x - X0) / ((X1 - X0) / (NS - 1.0));
    return stringBot(clamp(j, -1.6, NS + 0.6)) - 0.012;
}

const float PILLAR_R = 0.024;
const float PILLAR_X = -0.69;
const float FRAME_X1 = 0.655;

// Neck and soundboard taper from the bass end to the treble end, as on a real harp.
float neckR(float x) {
    return mix(0.023, 0.013, clamp((x - PILLAR_X) / (FRAME_X1 - PILLAR_X), 0.0, 1.0));
}

float soundR(float x) {
    return mix(0.034, 0.015, clamp((x - PILLAR_X) / (FRAME_X1 - PILLAR_X), 0.0, 1.0));
}

void main() {
    if (PASSINDEX == 0) {
        // Slots of eight texels: 0-23 one per string (pluck time, strength, energy last frame,
        // pluck point), 24 the hit counter last frame.
        float i = clamp(floor(gl_FragCoord.x / 8.0), 0.0, SLOTS - 1.0);
        vec4 prev = IMG_NORM_PIXEL(strings, vec2((i + 0.5) / SLOTS, 0.5));
        vec4 cntPrev = IMG_NORM_PIXEL(strings, vec2((SLOTS - 0.5) / SLOTS, 0.5));
        float cnt = floor(vxCount + 0.5);
        bool cold = FRAMEINDEX < 2 || prev.a < 0.5;
        if (i > NS - 0.5) {
            gl_FragColor = vec4(cnt, 0.0, 0.0, 1.0);
            return;
        }
        // z packs last frame's energy (hundredths, whole part) and the pluck point (fraction).
        float prevE = floor(prev.z) / 100.0;
        float prevPos = fract(prev.z);
        // This string's share of the sounding notes.
        float eNow = 0.0;
        for (int n = 0; n < 4; n++) {
            float fq = float(n);
            float e = energyAt(fq);
            if (e > 0.02 && abs(stringOf(noteAt(fq)) - i) < 0.5) eNow = max(eNow, e);
        }
        // The latest note (or, for a sound without pitch, a string chosen by the hit count).
        float latest = vxPitch > 0.01 ? stringOf(vxPitch) : mod(cnt * 7.0, NS);
        bool newHit = abs(cnt - cntPrev.x) > 0.5 && abs(latest - i) < 0.5;
        bool onset = eNow > 0.05 && prevE < 0.05;
        float vel = clamp(max(vxVel, eNow), 0.15, 1.0);
        float pos = 0.18 + 0.2 * hash11(cnt * 1.7 + i);
        vec4 st = vec4(prev.x, prev.y, eNow, prevPos);
        if (newHit || onset) st = vec4(TIME, vel, eNow, pos);
        if (cold) {
            // Cold start: strings for the notes sounding now are caught mid-ring.
            st = vec4(-100.0, 0.0, eNow, 0.3);
            float age = 0.06 + 0.45 * (1.0 - clamp(vxPulse, 0.0, 1.0));
            if (eNow > 0.02) st = vec4(TIME - age - 0.07 * hash11(i), clamp(eNow, 0.15, 1.0), eNow, 0.22 + 0.15 * hash11(i));
            if ((vxHit > 0.3 || vxPulse > 0.05) && abs(latest - i) < 0.5) st = vec4(TIME - age, vel, eNow, 0.25);
        }
        gl_FragColor = vec4(st.x, st.y, floor(st.z * 100.0) + clamp(st.w, 0.0, 0.99), 1.0);
        return;
    }

    // The harp is framed a little inside the picture.
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y * 1.12 + vec2(0.0, 0.01);
    float px = 1.12 / RENDERSIZE.y;
    float sw = clamp(vxSwell, 0.0, 1.0);

    // Light from the upper left, in front; the viewer looks straight on.
    vec3 L = normalize(vec3(-0.5, 0.6, 0.65));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    vec3 L2 = normalize(vec3(0.85, -0.15, 0.35));
    vec2 shOff = vec2(-L.x, -L.y) / L.z * GAP;
    float keyI = 0.75 + 0.35 * sw;

    // The board: dark, lit in a broad soft pool, with the strings' shadows on it.
    vec2 pc = p - vec2(-0.12, 0.06);
    float pool = exp(-dot(pc, pc) / 0.32);
    vec3 board = palGround.rgb * (0.012 + 0.2 * pool) * keyI;

    float j0 = floor((p.x - X0) / ((X1 - X0) / (NS - 1.0)) + 0.5);
    vec3 strCol = vec3(0.0);
    float strCov = 0.0;
    float shade = 0.0;
    vec3 pinCol = vec3(0.0);
    float pinCov = 0.0;
    vec3 ink1 = ink.rgb / max(max(ink.r, ink.g), max(ink.b, 1e-3));
    for (int dj = -2; dj <= 2; dj++) {
        float j = j0 + float(dj);
        if (j < -0.5 || j > NS - 0.5) continue;
        vec4 raw = IMG_NORM_PIXEL(strings, vec2((j + 0.5) / SLOTS, 0.5));
        vec4 st = vec4(raw.x, raw.y, 0.0, fract(raw.z));
        float xj = stringX(j);
        float yb = stringBot(j);
        float yt = stringTop(j);
        float len = yt - yb;
        float r = stringR(j);
        float ring = ringing(st, TIME);

        // The string. Where it swings fast it is drawn wider and fainter by its travel during
        // one frame, so a quick swing blurs smoothly instead of jumping.
        {
            float s = (p.y - yb) / len;
            if (s >= 0.0 && s <= 1.0) {
                vec2 dsp = stringDisp(j, s, TIME, st);
                float travel = abs(stringDisp(j, s, TIME + 0.0083, st).x - stringDisp(j, s, TIME - 0.0083, st).x);
                float bl = 0.5 * travel;
                float slope = dsp.y / len;
                float dist = (p.x - xj - dsp.x) / sqrt(1.0 + slope * slope);
                float w = r + bl;
                float cov = smoothstep(w + px, w - px - 1.6 * bl, abs(dist)) * (r / max(r, bl * 0.8 + r * 0.2));
                if (cov > 0.0) {
                    float u = clamp(dist / w, -1.0, 1.0);
                    vec2 a = normalize(vec2(1.0, -slope));
                    vec2 tg = vec2(-a.y, a.x);
                    // The highlight drifts slowly along the string: a faint shimmer even at rest.
                    float shim = 0.7 + 0.3 * sin(s * 7.0 - TIME * 0.35 + j * 1.3);
                    vec3 c = tubeShade(u, a, tg, ink1, mix(vec3(1.0), ink1, 0.35) * shim, 40.0, L, H, keyI);
                    vec3 n = vec3(a * u, sqrt(max(1.0 - u * u, 0.0)));
                    float rim = pow(max(dot(n, L2), 0.0), 3.0);
                    c += accent.rgb * rim * (0.06 + 3.0 * ring);
                    strCol = strCol * (1.0 - cov) + c * cov;
                    strCov = max(strCov, cov);
                }
            }
        }

        // Its shadow on the board, softer than the string, moving with it.
        vec2 q = p - shOff;
        float s2 = (q.y - yb) / len;
        if (s2 > -0.02 && s2 < 1.02) {
            vec2 d2 = stringDisp(j, clamp(s2, 0.0, 1.0), TIME, st);
            float w = r * 1.6 + 0.006;
            float dd = q.x - xj - d2.x;
            float edge = smoothstep(-0.02, 0.01, s2) * smoothstep(1.02, 0.99, s2);
            shade = max(shade, exp(-dd * dd / (w * w)) * edge);
        }

        // Brass pins at both ends, and their shadows.
        {
            vec2 pinP = vec2(xj, yt);
            float pr = 0.0075;
            vec2 dv = p - pinP;
            float dl = length(dv);
            float pcov = smoothstep(pr + px, pr - px, dl);
            if (pcov > 0.0) {
                vec2 qd = dv / pr;
                vec3 n = vec3(qd, sqrt(max(1.0 - dot(qd, qd), 0.0)));
                float dif = max(dot(n, L), 0.0);
                float spec = pow(max(dot(n, H), 0.0), 40.0);
                vec3 c = ink1 * (0.04 + 0.45 * dif) * keyI + mix(vec3(1.0), ink1, 0.3) * spec * 2.0 * keyI;
                pinCol = mix(pinCol, c, pcov);
                pinCov = max(pinCov, pcov);
            }
            vec2 ds = p - shOff * 0.8 - pinP;
            shade = max(shade, exp(-dot(ds, ds) / (pr * pr * 2.2)));
        }
    }

    // The frame: three lacquered tubes, a dark shade of the board's color, with crisp highlights.
    vec3 lac = palGround.rgb / max(max(palGround.r, palGround.g), max(palGround.b, 1e-3)) * 0.16;
    vec3 lacSpec = mix(vec3(0.4), ink1 * 0.4, 0.3);
    vec3 frCol = vec3(0.0);
    float frCov = 0.0;
    float xin = clamp(p.x, PILLAR_X, FRAME_X1);
    float span = smoothstep(PILLAR_X - px, PILLAR_X + px, p.x) * smoothstep(FRAME_X1 + px, FRAME_X1 - px, p.x);
    vec2 qs = p - shOff * 1.4;
    float xs = clamp(qs.x, PILLAR_X, FRAME_X1);
    float spanS = step(PILLAR_X, qs.x) * step(qs.x, FRAME_X1);
    float fe = 0.004;
    // Neck.
    {
        float sl = (neckY(xin + fe) - neckY(xin - fe)) / (2.0 * fe);
        vec2 tg = normalize(vec2(1.0, sl));
        vec2 a = vec2(-tg.y, tg.x);
        float dist = (p.y - neckY(xin)) * tg.x;
        float rr = neckR(xin);
        float cov = smoothstep(rr + px, rr - px, abs(dist)) * span;
        vec3 c = tubeShade(clamp(dist / rr, -1.0, 1.0), a, tg, lac, lacSpec, 18.0, L, H, keyI);
        frCol = mix(frCol, c, cov);
        frCov = max(frCov, cov);
        float ds = (qs.y - neckY(xs)) * tg.x;
        shade = max(shade, exp(-ds * ds / (neckR(xs) * neckR(xs) * 2.0)) * spanS);
    }
    // Soundboard.
    {
        float sl = (boardY(xin + fe) - boardY(xin - fe)) / (2.0 * fe);
        vec2 tg = normalize(vec2(1.0, sl));
        vec2 a = vec2(-tg.y, tg.x);
        float dist = (p.y - boardY(xin)) * tg.x;
        float rr = soundR(xin);
        float cov = smoothstep(rr + px, rr - px, abs(dist)) * span;
        vec3 c = tubeShade(clamp(dist / rr, -1.0, 1.0), a, tg, lac, lacSpec, 18.0, L, H, keyI);
        frCol = mix(frCol, c, cov);
        frCov = max(frCov, cov);
        float ds = (qs.y - boardY(xs)) * tg.x;
        shade = max(shade, exp(-ds * ds / (soundR(xs) * soundR(xs) * 2.0)) * spanS);
    }
    // Pillar, standing between the two at the left.
    {
        float yLo = boardY(PILLAR_X);
        float yHi = neckY(PILLAR_X);
        float dist = p.x - PILLAR_X;
        float inY = smoothstep(yLo - px, yLo + px, p.y) * smoothstep(yHi + px, yHi - px, p.y);
        float cov = smoothstep(PILLAR_R + px, PILLAR_R - px, abs(dist)) * inY;
        vec3 c = tubeShade(clamp(dist / PILLAR_R, -1.0, 1.0), vec2(1.0, 0.0), vec2(0.0, 1.0), lac, lacSpec, 18.0, L, H, keyI);
        frCol = mix(frCol, c, cov);
        frCov = max(frCov, cov);
        float ds = qs.x - PILLAR_X;
        shade = max(shade, exp(-ds * ds / (PILLAR_R * PILLAR_R * 2.0)) * step(yLo, qs.y) * step(qs.y, yHi));
    }
    // The knee: a short upright where neck and soundboard meet at the right.
    {
        float yLo = boardY(FRAME_X1);
        float yHi = neckY(FRAME_X1);
        float dist = p.x - FRAME_X1;
        float inY = smoothstep(yLo - px, yLo + px, p.y) * smoothstep(yHi + px, yHi - px, p.y);
        float rk = neckR(FRAME_X1);
        float cov = smoothstep(rk + px, rk - px, abs(dist)) * inY;
        vec3 c = tubeShade(clamp(dist / rk, -1.0, 1.0), vec2(1.0, 0.0), vec2(0.0, 1.0), lac, lacSpec, 18.0, L, H, keyI);
        frCol = mix(frCol, c, cov);
        frCov = max(frCov, cov);
    }
    // Rounded ends on the pillar: its foot and its crown.
    for (int c4 = 0; c4 < 2; c4++) {
        float fc = float(c4);
        float cx = PILLAR_X;
        bool low = fc < 0.5;
        vec2 cp = vec2(cx, low ? boardY(cx) : neckY(cx));
        float cr = (low ? soundR(cx) : neckR(cx)) * 1.12;
        vec2 dv = p - cp;
        float cov = smoothstep(cr + px, cr - px, length(dv));
        if (cov > 0.0) {
            vec2 qd = dv / cr;
            vec3 n = vec3(qd, sqrt(max(1.0 - dot(qd, qd), 0.0)));
            vec3 c = (lac * (0.05 + 0.55 * max(dot(n, L), 0.0)) + lacSpec * pow(max(dot(n, H), 0.0), 18.0) * 2.4) * keyI;
            frCol = mix(frCol, c, cov);
            frCov = max(frCov, cov);
        }
    }

    vec3 col = board * (1.0 - 0.8 * min(shade, 1.0));
    col = col * (1.0 - strCov) + strCol;
    col = mix(col, pinCol, pinCov);
    col = mix(col, frCol, frCov);

    // Tone map on luminance so highlights keep their color, then dither.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.5));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Strings and pins are solid; the board and its shadows are left out.
        outa = clamp(max(max(strCov, pinCov), frCov), 0.0, 1.0);
        vec3 solid = strCol;
        solid = mix(solid, pinCol, pinCov);
        solid = mix(solid, frCol, frCov);
        float sl = max(max(solid.r, solid.g), solid.b);
        solid = solid / max(sl, 1e-4) * (1.0 - exp(-sl * 1.5));
        outc = min(solid, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
