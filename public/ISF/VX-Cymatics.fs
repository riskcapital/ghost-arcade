/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Chladni figures: a plate of fine sand that gathers on the still lines of a standing wave. Each note sets the plate's mode numbers, so every pitch draws its own figure and chords overlay theirs. A strike throws the sand off the old figure; it then drifts into the new one over about a second.",
    "PASSES": [
        {
            "TARGET": "plateState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH",
            "HEIGHT": 1
        },
        {
            "TARGET": "modeField",
            "FLOAT": true,
            "WIDTH": 512,
            "HEIGHT": 512
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 10, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "plate", "LABEL": "Plate: square to round", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "plateSize", "LABEL": "Plate size", "TYPE": "float", "DEFAULT": 0.84, "MIN": 0.4, "MAX": 1 },
        { "NAME": "grainSize", "LABEL": "Grain size", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "grainCount", "LABEL": "Grain count", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "settle", "LABEL": "Settle speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "scatter", "LABEL": "Scatter", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "modeRange", "LABEL": "Mode range", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "rotation", "LABEL": "Rotation", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Sand", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Sheen", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

// State slots, each a wide strip so the buffer survives any texture density:
// 0 = (settle of the new figure, settle of the old one, last note count,
// ready); 1-4 = the new figure's notes (midi, weight); 5-8 = the old
// figure's notes; 9 = (scatter kick, time since the strike).
const float PI = 3.14159265;
const float STATE_W = 10.0;
const float S_MAX = 0.9;
const float REST_MIDI = 57.0;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

vec4 stateAt(float i) {
    return IMG_NORM_PIXEL(plateState, vec2((i + 0.5) / STATE_W, 0.5));
}

vec2 liveNote(int i) {
    if (i == 0) return vec2(vxNote0, vxNoteE0);
    if (i == 1) return vec2(vxNote1, vxNoteE1);
    if (i == 2) return vec2(vxNote2, vxNoteE2);
    return vec2(vxNote3, vxNoteE3);
}

// Pitch to mode numbers. Notes are walked round the circle of fifths so
// neighbouring semitones draw clearly different figures; higher octaves and
// the Mode range control add finer lines. All the notes of one figure share
// the root's parity and symmetry, so a chord still reads as one figure.
float modeLift(float midi) {
    return max(floor(modeRange * 4.0 + 0.5) + clamp(floor(midi / 12.0) - 5.0, -1.0, 2.0), 0.0);
}

vec3 squareModes(float midi, float root) {
    float idx = mod(mod(midi, 12.0) * 7.0, 12.0);
    float m = 1.0 + mod(idx, 4.0) + modeLift(midi);
    float n = m + 2.0 * (1.0 + floor(idx / 4.0));
    float par = mod(floor(root / 2.0), 2.0);
    if (abs(mod(m, 2.0) - par) > 0.5) {
        m += 1.0;
        n += 1.0;
    }
    float sgn = mod(root, 2.0) < 0.5 ? -1.0 : 1.0;
    return vec3(m, n, sgn);
}

vec2 roundModes(float midi, float root) {
    float ang = mod(mod(mod(root, 12.0) * 7.0, 12.0), 6.0);
    float idx = mod(mod(midi, 12.0) * 7.0, 12.0);
    float rad = 1.0 + mod(idx, 4.0) + floor(modeLift(midi) * 0.5);
    return vec2(ang, rad);
}

float radialK(vec2 rd) {
    return (rd.y + 0.5 * rd.x + 0.25) * PI;
}

float modeK(float midi, float root) {
    vec3 sq = squareModes(midi, root);
    float ks = 0.5 * PI * sqrt(0.5 * (sq.x * sq.x + sq.y * sq.y));
    return mix(ks, radialK(roundModes(midi, root)) * 0.55, plate);
}

// A Bessel-like radial profile: still at the centre for angular modes,
// rings that thin out toward the rim.
float besselish(float x, float m) {
    float nearC = pow(clamp(x / (m + 0.9), 0.0, 1.0), m);
    return nearC * cos(x - (2.0 * m + 1.0) * PI * 0.25) * inversesqrt(max(x, m + 0.9)) * 1.6;
}

float modeShape(vec2 P, float midi, float root) {
    float fs = 0.0;
    float fr = 0.0;
    if (plate < 0.999) {
        vec3 sq = squareModes(midi, root);
        vec2 u = P * 0.5 + 0.5;
        fs = cos(sq.y * PI * u.x) * cos(sq.x * PI * u.y) + sq.z * cos(sq.x * PI * u.x) * cos(sq.y * PI * u.y);
    }
    if (plate > 0.001) {
        vec2 rd = roundModes(midi, root);
        fr = besselish(radialK(rd) * length(P), rd.x) * cos(rd.x * atan(P.y, P.x) + mod(root, 5.0) * 0.4);
    }
    return mix(fs, fr, plate);
}

float figureRoot(float base) {
    for (int i = 0; i < 4; i++) {
        vec4 nt = stateAt(base + float(i));
        if (nt.y > 0.001) return nt.x;
    }
    return REST_MIDI;
}

// Sum of a figure's modes at P, and its weighted wavenumber.
vec2 figure(vec2 P, float base, bool fallback) {
    float root = figureRoot(base);
    float f = 0.0;
    float wsum = 0.0;
    float ksum = 0.0;
    for (int i = 0; i < 4; i++) {
        vec4 nt = stateAt(base + float(i));
        if (nt.y > 0.001) {
            f += nt.y * modeShape(P, nt.x, root);
            wsum += nt.y;
            ksum += nt.y * modeK(nt.x, root);
        }
    }
    if (wsum < 0.001) {
        if (!fallback) return vec2(0.0);
        return vec2(modeShape(P, REST_MIDI, REST_MIDI), modeK(REST_MIDI, REST_MIDI));
    }
    return vec2(f / wsum, ksum / wsum);
}

float figureK(float base) {
    float root = figureRoot(base);
    float wsum = 0.0;
    float ksum = 0.0;
    for (int i = 0; i < 4; i++) {
        vec4 nt = stateAt(base + float(i));
        if (nt.y > 0.001) {
            wsum += nt.y;
            ksum += nt.y * modeK(nt.x, root);
        }
    }
    return wsum < 0.001 ? modeK(REST_MIDI, REST_MIDI) : ksum / wsum;
}

// The step that carries a grain at P onto the nearest still line.
// atan keeps it bounded by a quarter wave between lines.
vec2 toNode(vec2 P, float base, bool fallback) {
    float e = 0.004;
    vec2 a = figure(P, base, fallback);
    if (a.y <= 0.0) return vec2(0.0);
    float fx = figure(P + vec2(e, 0.0), base, fallback).x;
    float fy = figure(P + vec2(0.0, e), base, fallback).x;
    vec2 g = vec2(fx - a.x, fy - a.x) / e;
    float gl = length(g);
    float d = atan(a.y * a.x, gl) / a.y;
    return gl > 1e-6 ? -g / gl * d : vec2(0.0);
}

float plateShape(vec2 P) {
    float q = mix(14.0, 2.0, plate);
    return pow(pow(abs(P.x), q) + pow(abs(P.y), q), 1.0 / q);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float ix = floor(uv.x * STATE_W);
        vec4 s0 = stateAt(0.0);
        vec4 me = stateAt(ix);
        float count = floor(vxCount + 0.5);
        bool ready = s0.w > 0.5 && FRAMEINDEX >= 2;
        bool strike = ready && abs(count - s0.z) > 0.5;
        float maxE = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
        // Notes are still rising for a moment after the strike, so the figure
        // keeps listening briefly before it commits.
        float since = strike || !ready ? 0.0 : stateAt(9.0).y + dt;
        bool listening = (!ready || since < 0.2) && maxE > 0.01;
        vec4 outc = me;
        if (ix < 0.5) {
            float sN = ready ? s0.x : S_MAX;
            float sO = ready ? s0.y : 0.0;
            if (strike) {
                sO = sN;
                sN = 0.0;
            }
            // Low scatter lets sand slide straight from one figure to the next.
            sO *= exp(-dt / mix(1.0, 0.05, sqrt(scatter)));
            sN += (S_MAX - sN) * (1.0 - exp(-dt * mix(0.7, 6.0, settle)));
            outc = vec4(sN, sO, count, 1.0);
        } else if (ix < 4.5) {
            int slot = int(ix) - 1;
            vec2 ln = liveNote(slot);
            float midi = floor(ln.x * 127.0 + 0.5);
            if (!ready && maxE <= 0.01) {
                outc = slot == 0 ? vec4(REST_MIDI, 1.0, 0.0, 0.0) : vec4(0.0);
            } else if (listening) {
                outc = vec4(midi, (ln.x > 0.0 && ln.y > 0.01) ? ln.y / maxE : 0.0, 0.0, 0.0);
            } else if (maxE > 0.05 && me.y > 0.001) {
                // Follow the balance of the sounding notes; freeze in silence.
                float target = 0.0;
                for (int j = 0; j < 4; j++) {
                    vec2 lj = liveNote(j);
                    if (lj.x > 0.0 && abs(floor(lj.x * 127.0 + 0.5) - me.x) < 0.5) target = max(target, lj.y / maxE);
                }
                outc.y = max(mix(me.y, target, 1.0 - exp(-dt / 0.7)), 0.0015);
            }
        } else if (ix < 8.5) {
            if (!ready) outc = vec4(0.0);
            else if (strike) outc = stateAt(ix - 4.0);
        } else {
            float kick = ready ? me.x : 0.0;
            if (strike) kick = max(kick, scatter * (0.4 + 0.6 * vxVel));
            outc = vec4(kick * exp(-dt / 0.22), min(since, 100.0), 0.0, 0.0);
        }
        gl_FragColor = outc;
        return;
    }

    if (PASSINDEX == 1) {
        vec2 P = uv * 2.0 - 1.0;
        // The old figure only matters while its sand is still leaving it.
        vec2 oldD = stateAt(0.0).y > 0.002 ? toNode(P, 5.0, false) : vec2(0.0);
        gl_FragColor = vec4(toNode(P, 1.0, true), oldD);
        return;
    }

    vec2 fragPx = gl_FragCoord.xy;
    float Hs = 0.5 * plateSize * RENDERSIZE.y;
    // Whole turns per 1000 phase, so the slow turn carries on cleanly when the clock wraps.
    float ang = vxPhase * floor(rotation * 8.0 + 0.5) * 0.0062832;
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 rel = fragPx - 0.5 * RENDERSIZE;
    vec2 X = vec2(ca * rel.x + sa * rel.y, -sa * rel.x + ca * rel.y);
    vec2 P = X / Hs;
    float edge = plateShape(P);

    vec4 s0 = stateAt(0.0);
    float kick = stateAt(9.0).x;
    float sN = s0.x;
    float sO = s0.y;
    float capN = PI * 0.5 / figureK(1.0) * Hs;
    float capO = PI * 0.5 / figureK(5.0) * Hs;
    float sigma = mix(0.42, 0.95, grainSize);
    // A grain is never drawn smaller than one stored pixel; spread thinner,
    // it keeps its total light so density reads the same at any quality.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    vec2 sg = max(vec2(sigma), 0.55 * fw);
    float grainNorm = sigma * sigma / (sg.x * sg.y);
    float cell = max(2.4, RENDERSIZE.y / 360.0) * mix(1.0, 1.25, grainSize);
    float occupancy = mix(0.15, 0.8, grainCount);
    float lit = 0.4 + 0.6 * smoothstep(0.0, 0.7, vxEnv);

    float sum = 0.0;
    float halo = 0.0;
    if (edge < 1.04) {
        vec4 fx = IMG_NORM_PIXEL(modeField, P * 0.5 + 0.5);
        bool newLeads = sN >= sO;
        vec2 Dd = (newLeads ? fx.xy : fx.zw) * Hs;
        vec2 Dq = (newLeads ? fx.zw : fx.xy) * Hs;
        float sd = newLeads ? sN : sO;
        float sq = newLeads ? sO : sN;
        float cap = newLeads ? capN : capO;
        float dist0 = length(Dd);
        vec2 e = dist0 > 1e-4 ? -Dd / dist0 : vec2(1.0, 0.0);
        vec2 perp = vec2(-e.y, e.x);
        float jitterMax = 0.4 + 1.4 * kick;
        float R = 2.6 * max(sg.x, sg.y) + jitterMax;
        float sHi = sd;
        float sLo = sd * 0.6;
        float lo = min((sLo * dist0 - R) / (1.0 - sLo), (sHi * dist0 - R) / (1.0 - sHi));
        float hi = max((sLo * dist0 + R) / (1.0 - sLo), (sHi * dist0 + R) / (1.0 - sHi));
        // Soft light under the gathered lines.
        float bandW = max((1.0 - sd) * cap * 0.35, 1.5);
        halo = glow * pow(sd / S_MAX, 6.0) * exp(-dist0 * dist0 / (bandW * bandW)) * 0.2 * smoothstep(1.0, 0.96, edge);
        // Nothing can land here if every grain that could would have come from beyond the last line.
        if (dist0 + lo < cap * 1.05) {
            vec2 base = X - sq * Dq / (1.0 - sq);
            float span = hi - lo;
            float steps = clamp(ceil(span / (0.85 * cell)), 1.0, 24.0);
            float stepLen = span / steps;
            vec2 last1 = vec2(-1e5);
            vec2 last2 = vec2(-1e5);
            for (int k = 0; k < 24; k++) {
                if (float(k) >= steps) break;
                vec2 sp = base + e * (lo + (float(k) + 0.5) * stepLen);
                vec2 fc = sp / cell;
                vec2 idA = floor(fc);
                float side = dot(fract(fc) - 0.5, perp) >= 0.0 ? 1.0 : -1.0;
                vec2 idB = floor(fc + perp * side * 0.5);
                for (int c = 0; c < 2; c++) {
                    vec2 id = c == 0 ? idA : idB;
                    if (c == 1 && all(equal(idB, idA))) continue;
                    if (all(equal(id, last1)) || all(equal(id, last2))) continue;
                    last2 = last1;
                    last1 = id;
                    float h = hash21(id + 0.37);
                    if (h > occupancy) continue;
                    vec2 g = (id + 0.2 + 0.6 * hash22(id + 5.1)) * cell;
                    vec2 Pg = g / Hs;
                    if (plateShape(Pg) > 0.985) continue;
                    vec4 fg = IMG_NORM_PIXEL(modeField, Pg * 0.5 + 0.5);
                    float hs = fract(h * 97.31);
                    float lag = mix(0.6, 1.0, pow(hs, 0.25));
                    // Sand hops where the plate moves most and stays still on the lines.
                    float hop = 0.35 * vxEnv * clamp(length(fg.xy) * Hs / capN, 0.0, 1.0) + 1.4 * kick;
                    float w = vxPhase * 31.0 * (0.8 + 0.4 * hs);
                    vec2 jit = hop * vec2(sin(w + hs * 61.0), cos(w * 1.3 + hs * 23.0));
                    vec2 pos = g + (sN * lag * fg.xy + sO * lag * fg.zw) * Hs + jit;
                    vec2 dd = pos - X;
                    // Sand in flight is dim; it brightens as it comes to rest on a line.
                    float rest = smoothstep(0.15, 0.75, max(sN, sO) * lag / S_MAX);
                    float b = (0.55 + 0.45 * fract(h * 13.7)) * (0.3 + 0.7 * rest);
                    // Back to screen axes, where the stored pixels are measured.
                    vec2 ds = vec2(ca * dd.x - sa * dd.y, sa * dd.x + ca * dd.y) / sg;
                    sum += b * grainNorm * exp(-0.5 * dot(ds, ds));
                }
            }
        }
    }

    float sand = 1.0 - exp(-sum * 1.8);
    vec3 col = ink.rgb * sand * lit;
    float sheen = smoothstep(0.55, 1.5, sum) * 0.45;
    col = mix(col, accent.rgb * sand * lit, sheen);
    col += ink.rgb * halo * lit;
    // The plate's rim, a faint hairline.
    float rimPx = abs(edge - 1.0) * Hs / max(0.5 * (fw.x + fw.y), 1.0);
    col += ink.rgb * exp(-rimPx * rimPx / 0.8) * 0.07;

    col += (hash21(fragPx + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
