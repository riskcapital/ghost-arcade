/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A murmuration: thousands of fine, separate starlings streaming along smooth curving paths as one flock that sweeps in great loops across a dusk sky. Calm, it draws out into a long thin ribbon; as the music swells it opens out into a wide, airy cloud, and every hit makes it bloom outward and gather back in while a ripple runs down it from head to tail. The music also sets how fast it flies and how far its shape pours and bends. Look picks dark birds against a sunset, birds lit gold by the low sun, or glowing birds at night.",
    "PASSES": [
        {
            "TARGET": "hist",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 128,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "sweep", "LABEL": "Sweep", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "twist", "LABEL": "Swirl", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "agitation", "LABEL": "Bloom", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "flockSize", "LABEL": "Flock size", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "birdSize", "LABEL": "Bird size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "look", "LABEL": "Look", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2], "LABELS": ["Dusk silhouette", "Golden light", "Night glow"] },
        { "NAME": "ink", "LABEL": "Birds", "TYPE": "color", "DEFAULT": [0.55, 0.62, 0.95, 1.0] },
        { "NAME": "accent", "LABEL": "Sunset", "TYPE": "color", "DEFAULT": [1.0, 0.55, 0.25, 1.0] },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
// Spacing of the birds in the flock's own space (screen heights).
const float CELL = 0.0072;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hash32(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// hist (128x1): the last ~2.5 s of the music, newest at the left, one texel
// per HSTEP seconds: the pulse in red, the swell in green. A hit becomes a
// smooth wave that can travel outward (what is at distance d now is the pulse
// from d / speed seconds ago), and the swell can be eased over a second.
const float HSTEP = 0.02;
const float HN = 128.0;

// A texel never written (a fresh buffer: the voice was just added, or the
// renderer rebuilt its buffers) reads as a best guess from the signals now,
// so nothing dips; the record heals itself as it scrolls.
vec4 histTexel(float i) {
    i = clamp(i, 0.0, HN - 1.0);
    vec4 h = IMG_NORM_PIXEL(hist, vec2((i + 0.5) / HN, 0.5));
    if (h.a < 0.5) h = vec4(vxPulse * exp(-i * HSTEP / 0.1), vxSwell, 0.0, 0.0);
    return h;
}

// The pulse as it was a seconds ago (zero beyond the record).
float histAt(float a) {
    float x = a / HSTEP;
    if (x >= HN - 1.0) return 0.0;
    x = max(x, 0.0);
    float i = floor(x);
    return mix(histTexel(i).r, histTexel(i + 1.0).r, x - i);
}

// The swell averaged over the last second: a slow, rounded breath.
float slowSwell() {
    float s = 0.0;
    for (int k = 0; k < 6; k++) {
        s += histTexel(float(k) * 10.0).g;
    }
    return s / 6.0;
}

// Pass 0: slide the record along by this frame's time and put the newest
// values at the front.
vec4 histUpdate() {
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float i = floor(gl_FragCoord.x);
    float sh = dt / HSTEP;
    float src = i - sh;
    vec2 v;
    if (src < 0.0) {
        v = mix(histTexel(0.0).rg, vec2(vxPulse, vxSwell), clamp(-src / max(sh, 1e-4), 0.0, 1.0));
    } else {
        float j = floor(src);
        v = mix(histTexel(j).rg, histTexel(j + 1.0).rg, src - j);
    }
    return vec4(v, 0.0, 1.0);
}

// The pulse a seconds ago, softened over a fifth of a second.
float histSoft(float a) {
    return 0.25 * (histAt(a) + histAt(a + 0.06) + histAt(a + 0.12) + histAt(a + 0.18));
}

// ---- The flock. Every bird is a fixed point of a lattice in the flock's
// own space; the flock's space is laid onto the sky by one smooth, slowly
// changing map (a swirl field, a travelling bend, a stretch and a flight
// path), and the birds also stream slowly along the body. Because the map
// is smooth, every bird glides; nothing is redrawn at random.

// The swirl field: gentle eddies that bend the flock and pour it from one
// shape into another. Kept gentle enough that the map never folds over.
vec2 swirlField(vec2 q, float f, float A, float m) {
    float c = cos(m);
    float s = sin(m);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    vec2 d = vec2(sin(r.y * 3.1 + f * 0.37), sin(r.x * 2.3 - f * 0.29 + 1.7)) * 0.62
           + vec2(sin(r.y * 5.3 - f * 0.47 + 2.1), sin(r.x * 4.6 + f * 0.43)) * 0.22;
    return A * vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
}

struct Shape {
    vec2 centre;
    vec2 head;
    vec2 scale;
    float A;
    float bend;
    float f;
    float m;
};

// Flock space to the sky.
vec2 toSky(vec2 q, Shape sh) {
    vec2 w = q + swirlField(q, sh.f, sh.A, sh.m);
    // A slow travelling S-bend along the body.
    w.y += sh.bend * sin(q.x * 2.2 - sh.f * 0.8);
    w *= sh.scale;
    return sh.centre + sh.head * w.x + vec2(-sh.head.y, sh.head.x) * w.y;
}

// The sky to flock space: undo the stretch and path, then settle the
// swirl and bend in a few steps.
vec2 fromSky(vec2 p, Shape sh) {
    vec2 d = p - sh.centre;
    vec2 w = vec2(dot(d, sh.head), dot(d, vec2(-sh.head.y, sh.head.x))) / sh.scale;
    vec2 q = w;
    for (int k = 0; k < 5; k++) {
        vec2 sw = swirlField(q, sh.f, sh.A, sh.m);
        q = vec2(w.x - sw.x, w.y - sw.y - sh.bend * sin(q.x * 2.2 - sh.f * 0.8));
    }
    return q;
}

// The flight path: a looping figure-eight across most of the frame.
vec2 pathAt(float s, vec2 amp2) {
    return vec2(amp2.x * sin(s), amp2.y * sin(2.0 * s + 0.7) + 0.09);
}

vec2 pathVel(float s, vec2 amp2) {
    return vec2(amp2.x * cos(s), 2.0 * amp2.y * cos(2.0 * s + 0.7));
}

Shape shapeAt(float f, float tm, vec2 amp2, float pathK, vec2 scale, float A, float bend, float m) {
    Shape sh;
    float a = (f * 0.55 + tm * 0.16) * pathK + 0.85 * m;
    sh.centre = pathAt(a, amp2);
    // The flock banks with its climb but never spins round at the turns.
    vec2 v = pathVel(a, amp2);
    sh.head = normalize(vec2(sqrt(v.x * v.x + 0.04 * amp2.x * amp2.x) + 0.25 * amp2.x, v.y * 0.35));
    sh.scale = scale;
    sh.A = A;
    sh.bend = bend;
    sh.f = f;
    sh.m = m;
    return sh;
}

// How much of the flock is at q: a long body thinning to its tips, with a
// soft, ragged edge that drifts.
float bodyMask(vec2 q, float f) {
    float rag = 0.18 * vnoise(q * 3.0 + vec2(f * 0.05, 4.0)) + 0.08 * vnoise(q * 7.0 - vec2(0.0, f * 0.07));
    float tip = 1.0 - 0.5 * smoothstep(0.08, 0.32, abs(q.x));
    float e = length(vec2(q.x / 0.32, q.y / (0.1 * tip + 0.02))) + rag;
    return smoothstep(1.05, 0.55, e);
}

// One layer of birds. Returns premultiplied colour (rgb) and cover (a).
vec4 birdLayer(vec2 p, Shape s0, Shape s1, vec2 adv01, float cell, float seed,
               float lenPx, float halfW, vec3 dark, vec3 lit, float lookMode, float bank) {
    vec2 res = RENDERSIZE;
    vec2 q0 = fromSky(p, s0);
    if (abs(q0.x) > 0.55 || abs(q0.y) > 0.38) return vec4(0.0);
    vec2 q1 = fromSky(p, s1);
    // The birds that crossed this pixel during the frame lie between where
    // it was in the lattice then and now.
    vec2 L0 = (q0 - vec2(adv01.x, 0.0)) / cell + seed * 17.3;
    vec2 L1 = (q1 - vec2(adv01.y, 0.0)) / cell + seed * 17.3;
    float stepsF = clamp(ceil(max(abs(L1.x - L0.x), abs(L1.y - L0.y))), 0.0, 3.0);
    int steps = int(stepsF);
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    float keep = 1.0;
    vec2 lastId = vec2(-1e5);
    for (int k = 0; k <= 3; k++) {
        if (k > steps) break;
        vec2 L = mix(L0, L1, stepsF > 0.0 ? float(k) / stepsF : 0.0);
        vec2 id0 = floor(L);
        if (k > 0 && id0 == lastId) continue;
        lastId = id0;
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 id = id0 + vec2(float(i), float(j));
                vec3 h = hash32(id + seed * 57.0);
                if (h.z > 0.78) continue;
                vec2 b = (id + 0.15 + 0.7 * h.xy - seed * 17.3) * cell;
                vec2 qb0 = b + vec2(adv01.x, 0.0);
                float m = bodyMask(qb0, s0.f);
                if (m < 0.02) continue;
                vec2 P0 = toSky(qb0, s0);
                vec2 P1 = toSky(b + vec2(adv01.y, 0.0), s1);
                vec2 mv = (P0 - P1) * res.y;
                float mvl = length(mv);
                vec2 dir = mvl > 1e-3 ? mv / mvl : s0.head;
                // A fine dash along the bird's flight, smeared over its
                // travel in the frame.
                vec2 A = P0 * res.y + dir * lenPx * (0.6 + 0.4 * h.y);
                vec2 B = P1 * res.y - dir * lenPx * (0.6 + 0.4 * h.y);
                vec2 ab = B - A;
                vec2 pp = p * res.y;
                float tt = clamp(dot(pp - A, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
                float sd = length(pp - A - ab * tt) - halfW;
                float spread = (2.0 * lenPx + 1.0) / (length(ab) + 1.0);
                float cv = clamp(0.5 - sd / 1.5, 0.0, 1.0) * min(spread, 1.0) * m;
                if (cv <= 0.0) continue;
                // Each bird's own shade: some catch the light as the flock
                // banks, gradually, never flipping.
                float who = fract(h.x * 7.31 + h.y * 3.17);
                float share = 0.1 + 0.7 * bank * smoothstep(-0.4, 0.6, sin(qb0.x * 4.0 + qb0.y * 6.0 - s0.f * 0.25));
                vec3 col = mix(dark, lit, smoothstep(who - 0.3, who + 0.3, share));
                acc.rgb += col * cv;
                wsum += cv;
                keep *= 1.0 - cv;
            }
        }
    }
    float cover = 1.0 - keep;
    vec3 col = wsum > 1e-4 ? acc.rgb / wsum : dark;
    return vec4(col * cover, cover);
}

void main() {
    if (PASSINDEX == 0) {
        gl_FragColor = histUpdate();
        return;
    }

    vec2 res = RENDERSIZE;
    float s1080 = res.y / 1080.0;
    float aspect = res.x / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float f = vxFlow;
    float flowRate = 0.25 + 1.4 * vxSwell + 0.9 * vxPulse;
    float breath = slowSwell();
    // A hit: the flock blooms outward and gathers back in.
    float bloom = agitation * 0.5 * (histSoft(0.05) + histSoft(0.3));
    float dt = 1.2 * clamp(TIMEDELTA, 0.0, 0.05);
    float bloom1 = agitation * 0.5 * (histSoft(0.05 + dt) + histSoft(0.3 + dt));

    // The flight: a figure-eight over most of the frame, flown at the
    // speed of the flow clock (with a slow drift in silence).
    float pathK = 0.5 * (0.45 + sweep);
    vec2 amp2 = vec2((0.12 + 0.22 * sweep) * aspect, 0.1 + 0.14 * sweep);
    float size = 0.85 + 0.45 * flockSize;
    // Calm: a long thin ribbon. Swelling: a wide open cloud.
    vec2 scale0 = size * vec2(1.3 - 0.15 * breath + 0.15 * bloom, 0.6 + 0.8 * breath + 0.2 * vxSwell + 0.7 * bloom);
    vec2 scale1 = size * vec2(1.3 - 0.15 * breath + 0.15 * bloom1, 0.6 + 0.8 * breath + 0.2 * vxSwell + 0.7 * bloom1);
    float A = (0.08 + 0.12 * twist) * (1.0 + 0.3 * breath);
    float bend = 0.08 + 0.1 * twist * (0.7 + 0.5 * breath);
    // Over many hits the swirl's lean slowly swings (periodic in the count,
    // so its wrap is seamless).
    float m = 0.35 * sin(vxMorph * TAU / 64.0);
    float f1 = f - flowRate * dt;
    Shape s0 = shapeAt(f, TIME, amp2, pathK, scale0, A, bend, m);
    Shape s1 = shapeAt(f1, TIME - dt, amp2, pathK, scale1, A, bend, m);
    // Birds stream slowly forward through the flock.
    vec2 adv01 = vec2(f, f1) * 0.03;
    // ...and a ripple runs down the body after each hit, from head to tail.
    float ripU = clamp(fromSky(p, s0).x, -0.5, 0.5);
    float ra = (0.5 - ripU) * 0.6;
    float rip = agitation * 0.05 * (histSoft(ra) - histSoft(ra + 0.2));
    vec2 nrm = vec2(-s0.head.y, s0.head.x);
    vec2 pr = p - nrm * rip;

    float lenPx = (1.6 + 1.6 * birdSize) * s1080;
    float halfW = max((0.55 + 0.45 * birdSize) * s1080, 0.65);

    // Colours.
    vec3 inkC = ink.rgb;
    vec3 acc = accent.rgb;
    vec3 dark;
    vec3 lit;
    float bank;
    if (look == 0) {
        dark = inkC * 0.05 + vec3(0.012);
        lit = inkC * 0.12 + vec3(0.02);
        bank = 0.5;
    } else if (look == 1) {
        dark = inkC * 0.1 + vec3(0.015);
        lit = acc * 1.15 + vec3(0.12);
        bank = 0.7 + 0.25 * breath;
    } else {
        dark = inkC * 1.0;
        lit = acc * 1.2 + 0.15;
        bank = 0.5 + 0.3 * breath;
    }

    vec4 nearB = birdLayer(pr, s0, s1, adv01, CELL, 0.0, lenPx, halfW, dark, lit, float(look), bank);
    // A farther layer: smaller, a touch behind and moving a little differently.
    Shape t0 = s0;
    Shape t1 = s1;
    t0.f += 3.0;
    t1.f += 3.0;
    t0.scale *= 0.94;
    t1.scale *= 0.94;
    vec4 farB = birdLayer(pr, t0, t1, adv01 * 0.8, CELL * 0.85, 1.0, lenPx * 0.75, halfW * 0.85, dark, mix(dark, lit, 0.7), float(look), bank);
    vec4 birds = nearB + farB * (1.0 - nearB.a);

    // Sky.
    vec2 uv = gl_FragCoord.xy / res;
    vec2 sunP = vec2(0.5 + 0.18 * sin(f * 0.01), -0.08);
    float sunD = length((uv - sunP) * vec2(aspect, 1.0));
    vec3 sky;
    float hgt = uv.y;
    if (look == 0) {
        sky = mix(acc * 1.05, mix(acc, inkC, 0.5) * 0.55, smoothstep(0.0, 0.55, hgt));
        sky = mix(sky, inkC * 0.18 + vec3(0.02, 0.02, 0.05), smoothstep(0.45, 1.0, hgt));
        sky += acc * 0.6 * exp(-sunD * 4.0) + vec3(1.0, 0.95, 0.85) * 0.35 * exp(-sunD * 18.0);
    } else if (look == 1) {
        sky = mix(acc * 0.55, inkC * 0.32, smoothstep(0.0, 0.6, hgt));
        sky = mix(sky, inkC * 0.08 + vec3(0.01, 0.01, 0.03), smoothstep(0.5, 1.0, hgt));
        sky += acc * 0.35 * exp(-sunD * 3.5);
    } else {
        sky = mix(inkC * 0.07, vec3(0.005, 0.006, 0.015), smoothstep(0.0, 0.8, hgt));
        sky += acc * 0.08 * exp(-sunD * 2.5);
    }

    float outA = 1.0;
    vec3 outC = sky * (1.0 - birds.a) + birds.rgb;
    if (vxClear) {
        outA = birds.a;
        outC = birds.rgb;
    }
    outC *= vxPresence;
    outA *= vxPresence;
    outC = clamp(outC, 0.0, 1.0);
    outC = min(outC, vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
