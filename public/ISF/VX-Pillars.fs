/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Pillars of creation: towering columns of dark dust rise through glowing gas, lit from behind by unseen stars so every ragged edge burns bright, with wisps boiling off their tips. Each hit sends a flare of light rolling down the columns and kindles a newborn star at one of the tips; held sound brightens the gas and lengthens the streaming wisps, and the music sets how fast the gas drifts.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "flare", "LABEL": "Flare", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "wisps", "LABEL": "Wisps", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "erosion", "LABEL": "Erosion", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "stars", "LABEL": "Stars", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Gas", "TYPE": "color", "DEFAULT": [0.3, 0.75, 0.8, 1.0] },
        { "NAME": "accent", "LABEL": "Burning edges", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.35, 1.0] },
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
    for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        s += a * vnoise(p);
        p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2);
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

// The pulse a seconds ago, softened over a fifth of a second so light
// builds over several frames instead of snapping.
float histSoft(float a) {
    return 0.25 * (histAt(a) + histAt(a + 0.06) + histAt(a + 0.12) + histAt(a + 0.18));
}

// A leaning column from base a to tip b, thinning from ra to rb.
float column(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// The three pillars, before erosion. Tips are returned for the wisps.
float pillarsRaw(vec2 p) {
    float d = column(p, vec2(-0.5, -0.8), vec2(-0.36, 0.2), 0.17, 0.085);
    d = smin(d, column(p, vec2(0.04, -0.8), vec2(0.12, -0.02), 0.12, 0.065), 0.04);
    d = smin(d, column(p, vec2(0.53, -0.8), vec2(0.43, -0.22), 0.1, 0.055), 0.04);
    return d;
}

// Erosion: a broad lumpy warp, knobbly globules along the sides and a
// fine ragged edge.
vec2 pillars(vec2 p, float t) {
    float e = 0.4 + 0.9 * erosion;
    vec2 w1 = vec2(fbm(p * 1.6 + vec2(0.0, t * 0.035), 3), fbm(p * 1.6 + vec2(5.2, 1.3 - t * 0.035), 3));
    vec2 q = p + w1 * 0.07 * e;
    vec2 w2 = vec2(fbm(q * 4.0 + vec2(2.0, 7.0), 3), fbm(q * 4.0 + vec2(8.0, 3.0), 3));
    q += w2 * 0.035 * e;
    float d = pillarsRaw(q);
    float coarse = d;
    // Knobs: ridged noise pushes out globules and pulls in hollows.
    float knob = 1.0 - abs(vnoise(q * 9.0 + w2 * 1.5));
    d -= 0.038 * e * (knob * knob - 0.45);
    d += 0.018 * e * fbm(q * 22.0 + w2 * 3.0, 3);
    return vec2(d, coarse);
}

void main() {
    if (PASSINDEX == 0) {
        gl_FragColor = histUpdate();
        return;
    }

    // Held sound: the swell, partly eased over a second so the gas breathes.
    float env = 0.5 * vxSwell + 0.5 * slowSwell();

    vec2 res = RENDERSIZE;
    vec2 p0 = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float t = vxFlow * (0.2 + 0.8 * drift);
    // A slow drift of the view, the pillars sliding against the far gas.
    vec2 cam = vec2(0.045 * sin(t * 0.09), 0.02 * sin(t * 0.13));
    vec2 p = p0 + cam;
    float px = 1.0 / res.y;

    vec2 dd = pillars(p, t);
    float d = dd.x;
    // Facing the light (from above, a little right), from the slope of the
    // smooth outline so the rim stays steady.
    vec2 L = normalize(vec2(0.25, 1.0));
    // Divided by the slope of p itself, so a flipped screen axis can't flip the light.
    vec2 grad = vec2(dFdx(dd.y) / dFdx(p0.x), dFdy(dd.y) / dFdy(p0.y));
    float facing = clamp(dot(grad / max(length(grad), 1e-6), L) * 1.15, -1.0, 1.0);

    // The hit: a flare that rolls down from the top of the frame.
    // The flare: each hit rolls down from the top of the frame as a band of
    // light; what is at height y now left the top (0.55 - y) / 0.9 s ago.
    float flareAge = (0.55 - p0.y) / 0.9;
    float fa = max(flareAge, 0.0);
    // A bright leading edge where the pulse rose, and a softer glow behind it.
    float sweepEdge = max(histAt(fa) - histAt(fa + 0.1), 0.0) * 1.8 + 0.45 * histSoft(fa);
    float sweep = sweepEdge * exp(-fa * 0.8) * smoothstep(-0.2, 0.05, flareAge) * flare * 1.4;
    // A fast flare of light on the hit, easing away.
    float flash = (0.3 * vxPulse + 0.7 * histSoft(0.1)) * flare * 0.9;
    float gain = 0.7 + 0.8 * glow + 0.45 * env + 2.2 * sweep + 1.4 * flash;

    // Inside: dark dust, thinner (lit through) near the edges.
    float inside = smoothstep(px * 1.5, -px * 1.5, d);
    float depthIn = max(-d, 0.0);
    float dust = 0.5 + 0.5 * fbm(p * 7.0 + vec2(3.0, t * 0.01), 4);
    float trans = exp(-depthIn * 70.0) * smoothstep(-0.2, 0.8, facing);
    vec3 dustC = mix(accent.rgb, ink.rgb, 0.3) * (0.02 + 0.16 * dust * dust * dust) * (0.6 + 0.4 * gain) + accent.rgb * trans * 0.35 * gain;
    // The burning rim on the lit side, thin and hot, with a glow outside it.
    float rimW = 0.004 + 0.004 * glow;
    float rim = exp(-abs(d) / rimW) * smoothstep(-0.2, 0.7, facing);
    float rimGlow = exp(-max(d, 0.0) / (0.008 + 0.012 * glow)) * smoothstep(0.0, 0.9, facing) * step(0.0, d);
    vec3 rimC = mix(accent.rgb, vec3(1.0, 0.97, 0.9), 0.45) * rim * gain * 1.2
              + accent.rgb * rimGlow * 0.35 * gain;

    // Wisps boiling off the tips, streaming toward the light.
    float wisp = 0.0;
    vec2 tips[3];
    tips[0] = vec2(-0.36, 0.29);
    tips[1] = vec2(0.12, 0.05);
    tips[2] = vec2(0.43, -0.16);
    for (int k = 0; k < 3; k++) {
        vec2 q = p - tips[k];
        float up = q.y;
        float wid = 0.03 + 0.06 * max(up, 0.0);
        float lean = q.x - up * 0.25;
        if (up < -0.04 || abs(lean) > wid * 3.2) continue;
        float plume = exp(-lean * lean / (wid * wid)) * smoothstep(-0.03, 0.02, up)
                    * exp(-max(up, 0.0) / (0.08 + 0.22 * wisps + 0.12 * env));
        float streaks = 0.5 + 0.5 * fbm(vec2(lean * 30.0, up * 5.0 - t * 0.6 + float(k) * 7.0), 3);
        wisp += plume * streaks * streaks;
    }
    wisp *= (0.6 + 0.9 * wisps) * smoothstep(-0.01, 0.01, d);
    vec3 wispC = mix(ink.rgb, accent.rgb, 0.5) * wisp * gain * 0.8;

    // Newborn stars: each hit kindles one, moving on to the next tip as the
    // hits go by (a smooth handover, never a cut).
    float turnT = vxMorph * (21.0 / 64.0);
    vec3 tw = vec3(0.5 + 0.5 * cos(TAU * (turnT - vec3(0.0, 1.0, 2.0) / 3.0)));
    tw = tw * tw * tw * tw;
    tw /= max(tw.x + tw.y + tw.z, 1e-4);
    float born = (0.55 * histSoft(0.0) + 0.45 * histSoft(0.45) + 0.35 * histSoft(0.95)) * flare;
    float newStar = 0.0;
    for (int k = 0; k < 3; k++) {
        vec2 tip = k == 0 ? vec2(-0.37, 0.26) : (k == 1 ? vec2(0.11, 0.03) : vec2(0.44, -0.19));
        float wk = k == 0 ? tw.x : (k == 1 ? tw.y : tw.z);
        float sd = length(p - tip);
        float starCore = exp(-sd * sd / (px * px * 9.0)) + 0.35 * exp(-sd / 0.03);
        float spikes = exp(-abs(p.x - tip.x) / (px * 1.5)) * exp(-abs(p.y - tip.y) / 0.06)
                     + exp(-abs(p.y - tip.y) / (px * 1.5)) * exp(-abs(p.x - tip.x) / 0.06);
        newStar += wk * born * (starCore + 0.5 * spikes);
    }

    // Background gas: brighter toward the light, layered and drifting.
    vec2 gq = p0 * 0.97 + cam * 0.3;
    float g1 = fbm(gq * 2.2 + vec2(t * 0.05, 0.0), 4);
    float g2 = fbm(gq * 4.5 + vec2(-t * 0.07, 4.0) + g1, 3);
    float lightUp = smoothstep(-0.6, 0.6, p0.y + 0.15 * g1);
    float gas = (0.35 + 0.65 * lightUp) * (0.45 + 0.55 * smoothstep(-0.4, 0.5, g1 + 0.4 * g2));
    vec3 gasC = mix(ink.rgb * 0.5, mix(ink.rgb, accent.rgb, 0.35), smoothstep(0.0, 0.6, g2 + 0.2)) * gas;
    gasC *= (0.35 + 0.4 * glow + 0.3 * env + 1.3 * sweep + 0.45 * flash);
    // The flare as a sheet of light rolling down through the gas.
    gasC += mix(accent.rgb, vec3(1.0), 0.3) * sweep * 0.22 * (0.5 + 0.5 * gas);
    gasC += ink.rgb * 0.02;
    // A light halo behind the pillars' outline.
    gasC += accent.rgb * 0.25 * exp(-max(d, 0.0) * 14.0) * smoothstep(-0.3, 0.8, facing) * gain;

    // Stars in the gas.
    vec2 sp = gl_FragCoord.xy / (5.0 * res.y / 1080.0);
    vec2 sid = floor(sp);
    float sh = hash21(sid);
    float starL = 0.0;
    if (sh < 0.05 * stars) {
        vec2 sc = sid + 0.25 + 0.5 * hash22(sid);
        float sdd = length(sp - sc) * 5.0 * res.y / 1080.0;
        starL = exp(-sdd * sdd * 0.6) * (0.3 + 1.2 * pow(hash21(sid + 3.1), 4.0));
    }

    vec3 subject = dustC * inside + rimC + wispC + accent.rgb * newStar + vec3(newStar * 0.6);
    // Coverage of the subject: solid dust, plus the light around it.
    float lum = max(max(rimC.r, rimC.g), rimC.b) + max(max(wispC.r, wispC.g), wispC.b) + newStar;
    float cover = clamp(inside + (1.0 - inside) * clamp(lum, 0.0, 1.0), 0.0, 1.0);

    vec3 bg = gasC + vec3(starL);
    vec3 col = bg * (1.0 - inside) + subject;
    col = 1.0 - exp(-col * 1.3);

    float outA = 1.0;
    vec3 outC = col;
    if (vxClear) {
        vec3 sc = 1.0 - exp(-subject * 1.3);
        outA = max(cover, max(sc.r, max(sc.g, sc.b)));
        outC = sc;
    }
    outC *= vxPresence;
    outA *= vxPresence;
    outC = min(clamp(outC, 0.0, 1.0), vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
