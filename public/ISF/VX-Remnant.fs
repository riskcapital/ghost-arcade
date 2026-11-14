/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "The glowing shell left by an exploded star: a ragged ring of gas laced with fine filaments, hot fingers of debris reaching outward from inside it and a small pulsing star at the heart. Each hit swells the shell outward and sends a bright shock front racing off into space while the shell eases back; held sound makes the gas burn brighter and the whole cloud breathe larger, and the music sets how fast the filaments churn.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "blast", "LABEL": "Blast", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "filaments", "LABEL": "Filaments", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "debris", "LABEL": "Debris", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "shape", "LABEL": "Shape", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Ragged shell", "Twin lobes", "Ring"] },
        { "NAME": "stars", "LABEL": "Stars", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Shock front", "TYPE": "color", "DEFAULT": [0.35, 0.65, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Hot debris", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.3, 1.0] },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;

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

float fbm(vec2 p, int oct) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        if (i >= oct) break;
        s += a * vnoise(p);
        p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return s;
}

// Ridged noise: thin bright creases.
float ridge(vec2 p, int oct) {
    float s = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
        if (i >= oct) break;
        float v = 1.0 - abs(vnoise(p));
        s += a * v * v;
        p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.1 + vec2(4.1, 2.3);
        a *= 0.5;
    }
    return s;
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

// The pulse a seconds ago, softened over a fifth of a second so light and
// size build over several frames instead of snapping.
float histSoft(float a) {
    return 0.25 * (histAt(a) + histAt(a + 0.06) + histAt(a + 0.12) + histAt(a + 0.18));
}

// The remnant's light at q for a shell of radius R0: shock filaments
// (x), hot debris knots (y), inner haze (z) and the shell mask (w).
vec4 shellLight(vec2 q, float R0, float t, float seed, float n) {
    float r = length(q);
    vec2 dir = q / max(r, 1e-4);
    // The explosion was lopsided: the rim bulges and dents.
    float lop = fbm(dir * 1.6 + vec2(seed, 3.0), 3);
    float R = R0 * (1.0 + 0.14 * lop + 0.015 * sin(t * 0.3));
    float x = r / R;
    // Projected shell: brightest where the line of sight grazes it.
    float inner = 0.8;
    float chord = sqrt(max(1.0 - x * x, 0.0)) - sqrt(max(inner * inner - x * x, 0.0));
    chord /= sqrt(1.0 - inner * inner);
    float shell = clamp(chord, 0.0, 1.6) * smoothstep(1.03, 0.97, x);
    // A tangled web of filaments, densest in the shell.
    vec2 uq = q / R0;
    vec2 w = vec2(fbm(uq * 2.0 + vec2(seed, t * 0.02), 3), fbm(uq * 2.0 + vec2(7.0 + seed, -t * 0.02), 3));
    float web = ridge(uq * 5.5 + w * 1.6 + seed, 4);
    web = pow(web, 3.0);
    float band = smoothstep(0.5, 0.9, x) * smoothstep(1.06, 0.95, x);
    web = web * web;
    float shock = shell * 0.16 + web * band * 6.0 * filaments;
    // The outer front: a thin bright edge, torn in places.
    float tears = smoothstep(-0.15, 0.3, fbm(dir * 4.0 + vec2(seed, t * 0.03), 3));
    shock += exp(-abs(x - 1.0) * 70.0) * 0.8 * tears;
    // Hot debris: knotted clumps just inside the shell, reaching outward.
    float knots = ridge(uq * 7.0 + w * 2.5 + vec2(3.0 + seed, 1.0), 3);
    knots = pow(knots, 3.0) * (0.4 + 0.9 * max(fbm(uq * 3.0 + seed + 9.0, 3) + 0.3, 0.0));
    float hot = knots * smoothstep(0.3, 0.65, x) * smoothstep(1.0, 0.82, x) * (0.4 + 2.0 * debris);
    float fill = smoothstep(1.0, 0.1, x) * 0.1 * (0.6 + 0.4 * fbm(uq * 5.0 + 2.0, 3));
    return vec4(shock, hot, fill, shell);
}

void main() {
    if (PASSINDEX == 0) {
        gl_FragColor = histUpdate();
        return;
    }

    // The shell breathes larger with the music, and each hit swells it
    // outward before it eases back.
    float kickBack = (histSoft(0.05) + histSoft(0.3) + histSoft(0.55) + histSoft(0.8)) * 0.25;
    float grow = blast * (0.16 * slowSwell() + 0.08 * vxPulse + 0.18 * kickBack);

    vec2 res = RENDERSIZE;
    float px = 1.0 / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float t = vxFlow * 0.16;

    float R0 = (0.27 + 0.14 * size) * (1.0 + grow);
    vec2 q = p;
    vec4 L;
    float r;
    float R;
    if (shape == 1) {
        // Twin lobes blown out either side of a pinched waist.
        float ca = cos(0.5);
        float sa = sin(0.5);
        vec2 qa = mat2(ca, sa, -sa, ca) * q;
        vec2 off = vec2(0.0, R0 * 0.55);
        vec4 la = shellLight((qa - off) * vec2(1.25, 1.0), R0 * 0.62, t, 0.0, 0.0);
        vec4 lb = shellLight((qa + off) * vec2(1.25, 1.0), R0 * 0.62, t, 5.0, 0.0);
        L = max(la, lb);
        r = length(q);
        R = R0;
    } else {
        if (shape == 2) q.y /= 0.6;
        L = shellLight(q, R0, t, 0.0, 0.0);
        r = length(q);
        R = R0;
    }
    float shell = L.w;
    vec2 dir = q / max(length(q), 1e-4);
    float x = r / R;
    float shock = L.x;
    float hot = L.y;
    float fill = L.z;

    // Each hit's shock front races outward from the shell: what is at radius
    // r now left the shell (r / R - 1) / 1.6 seconds ago. The front is where
    // the pulse rose, so it is thin and bright, with a faint glow behind it.
    float ringAge = (x - 1.0) / 1.1;
    float front = max(histAt(ringAge) - histAt(ringAge + 0.06), 0.0) * 2.0 + 0.08 * histAt(ringAge);
    float ring = front * exp(-max(ringAge, 0.0) * 1.4) * smoothstep(-0.02, 0.03, ringAge) * blast;
    ring *= 0.6 + 0.4 * fbm(dir * 8.0, 2);
    float flash = (0.55 * vxPulse + 0.45 * kickBack) * blast;

    float pulse = 0.5 + 0.5 * cos(vxBeat * TAU);
    float burn = 0.6 + 0.6 * vxSwell + 0.3 * vxEnergy + 0.6 * flash;

    vec3 inkC = ink.rgb;
    vec3 acc = accent.rgb;
    vec3 gas = inkC * shock * burn
             + acc * hot * burn * 1.3
             + mix(inkC, acc, 0.5) * fill * burn
             + mix(inkC, vec3(1.0), 0.5) * ring * 1.6;
    // The central star.
    float cd = r / (px * 3.0);
    float core = exp(-cd * cd * 0.5) * (1.2 + 0.8 * pulse) + exp(-r / 0.02) * 0.25 * (0.6 + 0.6 * pulse + flash);
    gas += mix(acc, vec3(1.0), 0.7) * core;

    vec3 lit = 1.0 - exp(-gas * 1.5);

    // Space behind.
    vec2 sp = gl_FragCoord.xy / (5.0 * res.y / 1080.0);
    vec2 sid = floor(sp);
    float sh = hash21(sid);
    float starL = 0.0;
    if (sh < 0.06 * stars) {
        vec2 sc = sid + 0.25 + 0.5 * hash22(sid);
        float sdd = length(sp - sc) * 5.0 * res.y / 1080.0;
        starL = exp(-sdd * sdd * 0.6) * (0.25 + 1.0 * pow(hash21(sid + 3.1), 4.0));
    }
    vec3 space = inkC * 0.012 + vec3(0.002, 0.002, 0.006)
               + inkC * 0.03 * smoothstep(0.2, 0.9, fbm(p * 2.0 + 11.0, 3) + 0.4);

    float outA = 1.0;
    vec3 outC = space * (1.0 - min(max(lit.r, max(lit.g, lit.b)) * 1.5, 1.0)) + lit + vec3(starL) * (1.0 - shell * 0.5);
    if (vxClear) {
        // On its own the gas burns a little hotter so threads and knots read
        // solid; a thin veil of dark gas behind them keeps the bubble's shape.
        // Coverage follows the light's brightest channel (a little ahead of it),
        // so dim haze stays clear and bright threads go solid.
        vec3 hotLit = 1.0 - exp(-gas * 3.2);
        float l = max(hotLit.r, max(hotLit.g, hotLit.b));
        float la = clamp(l * 1.35, 0.0, 1.0);
        float disk = smoothstep(0.0, 0.3, shell) * 0.28;
        outA = la + disk * (1.0 - la);
        outC = hotLit + space * 2.0 * disk * (1.0 - la);
    }
    outC *= vxPresence;
    outA *= vxPresence;
    outC = min(clamp(outC, 0.0, 1.0), vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
