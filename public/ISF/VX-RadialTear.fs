/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A great dial of light, its centre off to one side so its rings sweep across the frame. Each ring carries its own markings (hairlines, dashed tracks, a radial bar graph, a scale, a glowing arc) and turns at its own speed. Every hit tears the rings into sectors: some jump round out of step, some show the ring next door, some smear outwards into streaks, with an accent copy split off along the tear, and they settle back as the hit fades. Rings sets how many, Tear how many sectors break, Smear how many streak outwards, Spin how fast the rings turn, Recovery how long the tear lasts. Seed re-rolls the dial.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "rings", "LABEL": "Rings", "TYPE": "float", "DEFAULT": 9, "MIN": 4, "MAX": 14 },
        { "NAME": "tear", "LABEL": "Tear", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "smear", "LABEL": "Smear", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "recovery", "LABEL": "Recovery", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Dial", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Tear", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, velocity of that
// hit, the clock last frame (so time is measured even if frames are skipped).

const float TAU = 6.2831853;
const int MAX_RINGS = 14;

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

// Which ring a radius falls in: x = index, y = inner radius, z = outer radius.
vec3 ringOf(float r, float nr, float ds) {
    float r0 = 0.07;
    vec3 res = vec3(-1.0, 0.0, r0);
    for (int i = 0; i < MAX_RINGS; i++) {
        float fi = float(i);
        if (fi >= nr) break;
        float wd = mix(0.05, 0.17, pow(hash11(fi * 1.37 + ds), 1.5)) * (1.0 + fi * 0.06);
        float r1 = r0 + wd;
        if (r >= r0 && r < r1) res = vec3(fi, r0, r1);
        r0 = r1;
    }
    return res;
}

// One ring's markings. u: 0-1 across the ring, A: angle in turns, r: radius,
// w: one pixel in frame units. Returns light and accent share.
vec2 markings(vec3 rg, float r, float A, float t, float ds, float w) {
    if (rg.x < 0.0) return vec2(0.0);
    float hb = hash11(rg.x * 7.31 + ds);
    float kind = floor(hash11(rg.x * 3.17 + ds + 0.5) * 5.0);
    float u = (r - rg.y) / (rg.z - rg.y);
    float pxA = 1.0 / max(TAU * r / w, 1.0);   // one pixel, in turns
    float v = 0.0;
    float acc = 0.0;
    // Inset from the ring's edges.
    float inset = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
    if (kind < 0.5) {
        // Hairlines.
        float pitch = mix(0.0045, 0.009, hb);
        float f = abs(fract((r - rg.y) / pitch) - 0.5) * pitch;
        float k = floor((r - rg.y) / pitch);
        v = clamp(1.0 - f / (w * 0.9), 0.0, 1.0) * mix(0.25, 0.9, hash11(k * 1.7 + rg.x + ds));
    } else if (kind < 1.5) {
        // Dashed tracks, like data.
        float tracks = 3.0 + floor(hb * 4.0);
        float k = floor(u * tracks);
        float fu = fract(u * tracks);
        float cnt = floor(mix(40.0, 160.0, hash11(k + rg.x * 5.0 + ds)) * clamp(rg.y / 0.4, 0.3, 1.0));
        float cell = floor(A * cnt);
        float on = step(0.45, hash21(vec2(cell, k + rg.x * 13.0 + ds)));
        float fa = fract(A * cnt);
        float edgeA = min(fa, 1.0 - fa) / cnt / pxA;
        float hw = mix(0.05, 0.22, pow(hash11(k * 2.1 + ds), 2.0));
        v = on * smoothstep(0.5 - hw - 0.04, 0.5 - hw, fu) * smoothstep(0.5 + hw + 0.04, 0.5 + hw, fu) * clamp(edgeA, 0.0, 1.0) * mix(0.3, 0.8, hash11(k + ds));
        acc = step(0.93, hash21(vec2(cell, k + 7.0 + ds))) * on;
    } else if (kind < 2.5) {
        // A radial bar graph that breathes.
        float cnt = floor(mix(90.0, 220.0, hb) * clamp(rg.y / 0.4, 0.3, 1.0));
        float cell = floor(A * cnt);
        float h = 0.25 + 0.7 * (0.5 + 0.5 * sin(cell * 0.21 + t * 0.9 + rg.x)) * (0.4 + 0.6 * hash11(cell + rg.x * 31.0 + ds));
        float fa = fract(A * cnt);
        float edgeA = (min(fa, 1.0 - fa) / cnt / pxA) - 0.6;
        float bar = clamp(edgeA, 0.0, 1.0) * step(u, h);
        v = bar * mix(0.35, 0.8, u / max(h, 0.01));
        // A bright cap on each bar.
        float cap = bar * smoothstep(h - 0.06, h, u);
        v = max(v, cap);
        acc = cap * step(0.8, hash11(cell + ds * 3.0));
    } else if (kind < 3.5) {
        // A scale: ticks round a fine circle.
        float cnt = 120.0;
        float fa = fract(A * cnt);
        float d = min(fa, 1.0 - fa) / cnt / pxA;
        float major = step(0.5, fract(floor(A * cnt + 0.5) / 10.0 + 0.95));
        float len = major > 0.5 ? 0.75 : 0.35;
        v = clamp(1.0 - d / 1.1, 0.0, 1.0) * step(0.2, u) * step(u, 0.2 + len * 0.7) * mix(0.55, 1.0, major);
        v = max(v, clamp(1.0 - abs(u - 0.2) * (rg.z - rg.y) / (w * 1.1), 0.0, 1.0) * 0.6);
    } else {
        // A glowing arc, part of the way round, fading along its length.
        float a0 = hash11(rg.x + ds * 1.9);
        float len = mix(0.18, 0.5, hb);
        float s = fract(A - a0);
        float along = s / len;
        float inArc = step(s, len);
        float soft = smoothstep(0.0, 0.03, s) * smoothstep(len, len - 0.01, s);
        v = inArc * soft * mix(0.12, 0.85, along) * (0.6 + 0.4 * sin(u * 3.1416));
        // Its bright leading edge.
        v = max(v, clamp(1.0 - (len - s) / (pxA * 1.6), 0.0, 1.0) * inArc);
        acc = along * inArc * step(0.5, hash11(rg.x + ds + 8.0)) * 0.8;
    }
    return vec2(v * inset, acc);
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.8, TIME);
        float dtT = TIME - c.a;
        float dt = (dtT > 0.0 && dtT < 0.25) ? dtT : clamp(TIMEDELTA, 0.0, 0.1);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float vel = newHit ? clamp(vxVel, 0.3, 1.0) : c.b;
        gl_FragColor = vec4(n, age, vel, TIME);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = clk.g;
    float vel = clamp(clk.b, 0.3, 1.0);
    float ds = rs * 2.414;
    float hs = rs * 1.37 + n * 7.13;   // this tear

    vec2 fwp = max(fwidth(gl_FragCoord.xy), vec2(0.5));
    float w = max(fwp.x, fwp.y) / RENDERSIZE.y;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (gl_FragCoord.xy / RENDERSIZE - 0.5) * vec2(aspect, 1.0);
    float t = vxPhase;

    float recT = mix(0.2, 1.6, recovery);
    float k = clamp(age / recT, 0.0, 1.0);
    float hold = (1.0 - exp(-age * 70.0)) * pow(1.0 - k, 2.0);
    if (n < 0.5) hold = 0.0;

    // The dial's centre sits off to one side, so its rings arc across the frame.
    float side = hash11(ds + 0.7) < 0.5 ? -1.0 : 1.0;
    vec2 c = vec2(side * aspect * mix(0.28, 0.42, hash11(ds + 1.1)), (hash11(ds + 1.3) - 0.5) * 0.4);
    vec2 rel = p - c;
    float r = length(rel);
    float A = atan(rel.y, rel.x) / TAU + 0.5;
    float nr = clamp(floor(rings + 0.5), 4.0, 14.0);
    vec3 rg = ringOf(r, nr, ds);

    // Each ring turns at its own speed.
    float sp = (hash11(rg.x * 4.7 + ds) - 0.5) * 2.0;
    float turnA = t * sp * mix(0.0, 0.05, spin) + hash11(rg.x * 9.1 + ds);

    // Tear: the ring is cut into sectors; on a hit some jump round, some show
    // the next ring, some smear outwards.
    float nS = 3.0 + floor(hash11(rg.x * 2.3 + hs) * 6.0);
    float At = fract(A + turnA);
    float sec = floor(At * nS);
    float hsec = hash21(vec2(sec + rg.x * 17.0, hs));
    float torn = (hold > 0.0 && rg.x >= 0.0 && hsec < tear * 0.8) ? 1.0 : 0.0;
    float hk = hash21(vec2(sec + rg.x * 5.0, hs + 3.0));
    float jump = torn * (hk - 0.5) * 0.4 * hold * vel;
    float mode = hash21(vec2(sec + rg.x * 3.0, hs + 6.0));
    float rS = r;
    float smearOn = 0.0;
    if (torn > 0.5) {
        if (mode < smear) {
            // Smear: the ring's inner edge is dragged outwards into streaks.
            smearOn = 1.0;
            rS = mix(r, rg.y + (rg.z - rg.y) * 0.25, hold);
        } else if (mode < smear + (1.0 - smear) * 0.4) {
            // Ring shift: show the ring next door.
            rS = r + (hk < 0.5 ? -1.0 : 1.0) * (rg.z - rg.y) * hold;
        }
    }
    vec3 rgS = ringOf(rS, nr, ds);
    float spS = (hash11(rgS.x * 4.7 + ds) - 0.5) * 2.0;
    float AS = fract(A + t * spS * mix(0.0, 0.05, spin) + hash11(rgS.x * 9.1 + ds) + jump);
    vec2 mk = markings(rgS, rS, AS, t, ds, w);
    if (smearOn > 0.5) {
        // Streaks fade outwards across the ring.
        float u = (r - rg.y) / (rg.z - rg.y);
        mk.x *= mix(1.0, 0.35 + 0.65 * (1.0 - u), hold);
    }
    float v = mk.x;
    vec3 col = mix(ink.rgb, accent.rgb, mk.y) * v;

    // The accent copy, split along the tear.
    if (torn > 0.5) {
        float off = (hk - 0.5 < 0.0 ? -1.0 : 1.0) * 0.006 * hold;
        float va = markings(rgS, rS, fract(AS + off), t, ds, w).x;
        col = max(col, accent.rgb * max(va - v * 0.5, 0.0) * 1.1);
    }

    // A sweep arm turns across the whole dial, torn with everything else.
    float sw = fract(A + jump - t * 0.035 - 0.25);
    float trail = exp(-sw * 30.0) * 0.08 + exp(-sw * 400.0 / max(r, 0.05)) * 0.3;
    col += mix(ink.rgb, accent.rgb, 0.6) * trail * smoothstep(0.07, 0.2, r) * step(0.0, rg.x);

    // Dark gaps between the rings and at the torn sector edges, with a fine
    // accent line where a sector has broken away.
    if (rg.x >= 0.0) {
        float dr = min(r - rg.y, rg.z - r) / w;
        col *= smoothstep(0.5, 1.8, dr);
        float fs = fract(At * nS);
        float dA = min(fs, 1.0 - fs) / nS * TAU * r / w;
        if (torn > 0.5) {
            col *= smoothstep(0.5, 2.0, dA);
            col += accent.rgb * exp(-max(dA - 2.0, 0.0) / 1.2) * step(1.4, dA) * hold * 0.9;
        }
    }
    // The hub.
    col += ink.rgb * clamp(1.0 - abs(r - 0.045) / (w * 1.2), 0.0, 1.0) * 0.7;
    col += mix(accent.rgb, vec3(1.0), 0.3) * vxHit * exp(-r * 30.0) * 0.6;

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
