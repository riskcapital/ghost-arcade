/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A kaleidoscope behind a cracked pane. The voice draws flowing contour lines and folds them into mirror segments; every hit cracks the pane with long straight breaks, and each piece shows the kaleidoscope a little turned and shifted, so the symmetry no longer lines up. The segments slip out of register, one of them shows the wrong reflection, and the mirror edges glint, then it settles back, still faintly cracked. Segments sets how many mirrors, Slip how far they slide, Cracks how badly the pane breaks, Restless how often a hit changes the number of segments and Recovery how quickly it settles. Seed re-rolls the picture.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "segments", "LABEL": "Segments", "TYPE": "float", "DEFAULT": 6, "MIN": 3, "MAX": 12 },
        { "NAME": "slip", "LABEL": "Slip", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "cracks", "LABEL": "Cracks", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "restless", "LABEL": "Restless", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "recovery", "LABEL": "Recovery", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Wrong reflections", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, segment epoch
// (bumped by Restless on hits) plus 0.9 x the last hit's velocity, the clock
// last frame.

const float TAU = 6.2831853;
const int MAX_CRACKS = 6;

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

mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, s, -s, c);
}

// The picture inside one mirror segment: a few drifting bodies of light
// drawn as nested contour lines, beaded rings and the mirror's frame.
// q in frame-height units from the centre. Returns light and a highlight share.
const float RAD = 0.47;
vec2 content(vec2 q, float t, float ps, float w) {
    float r = length(q);
    float F = 0.0;
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float pr = mix(0.08, 0.42, hash11(ps + fi * 1.9));
        float pa = hash11(ps + fi * 2.7) * 1.2 + sin(t * (0.11 + fi * 0.03) + fi) * 0.35;
        vec2 c = vec2(cos(pa), sin(pa)) * (pr + sin(t * 0.13 + fi * 2.0) * 0.04);
        float sz = mix(0.05, 0.12, hash11(ps + fi * 4.3));
        vec2 d = q - c;
        F += exp(-dot(d, d) / (sz * sz));
    }
    float band = smoothstep(RAD, RAD - 0.03, r);
    float iso = F * 7.0;
    float fw = max(fwidth(iso), 1e-4);
    float c = abs(fract(iso) - 0.5);
    float lines = clamp(1.0 - (0.5 - c) / (fw * 0.9), 0.0, 1.0) * smoothstep(0.04, 0.2, F);
    float major = step(0.66, fract(floor(iso) / 3.0 + 0.1));
    float v = lines * mix(0.45, 1.0, major) * band;
    // The bodies glow softly inside their contours.
    v += smoothstep(0.3, 1.4, F) * 0.22 * band;
    // Beaded rings.
    float hi = 0.0;
    float a = atan(q.y, q.x);
    for (int i = 0; i < 2; i++) {
        float fi = float(i);
        float rr = mix(0.17, 0.4, fi) + (hash11(ps + fi * 3.1) - 0.5) * 0.03;
        float ring = clamp(1.0 - abs(r - rr) / (w * 1.1), 0.0, 1.0) * 0.4;
        float cnt = 24.0 + fi * 24.0;
        float ba = (fract(a / TAU * cnt + t * 0.015 * (fi - 0.5)) - 0.5) * TAU / cnt * rr;
        float bead = smoothstep(w * 3.0, w * 1.4, length(vec2(ba, r - rr)));
        v = max(v, ring);
        hi = max(hi, bead * 0.9);
    }
    // The mirror's frame: a fine double line.
    v = max(v, clamp(1.0 - abs(r - RAD) / (w * 1.4), 0.0, 1.0) * 0.9);
    v = max(v, clamp(1.0 - abs(r - RAD - 0.012) / (w * 1.1), 0.0, 1.0) * 0.4);
    v = max(v, hi);
    return vec2(v, hi);
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.72, TIME);
        float dtT = TIME - c.a;
        float dt = (dtT > 0.0 && dtT < 0.25) ? dtT : clamp(TIMEDELTA, 0.0, 0.1);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float ep = floor(c.b);
        float vel = fract(c.b) / 0.9;
        if (newHit && hash11(n * 3.71 + rs * 0.37 + 1.3) < restless) ep = mod(ep + 1.0, 256.0);
        if (newHit) vel = clamp(vxVel, 0.3, 1.0);
        gl_FragColor = vec4(n, age, ep + vel * 0.9, TIME);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = clk.g;
    float vel = clamp(fract(clk.b) / 0.9, 0.3, 1.0);
    float ps = rs * 2.414;
    float hs = rs * 1.37 + n * 7.13;   // this break

    vec2 fwp = max(fwidth(gl_FragCoord.xy), vec2(0.5));
    float w = max(fwp.x, fwp.y) / RENDERSIZE.y;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (gl_FragCoord.xy / RENDERSIZE - 0.5) * vec2(aspect, 1.0);
    float t = vxPhase;

    // How hard the last hit still shows: a snap, then an eased settle to a
    // faint remainder.
    float recT = mix(0.25, 1.8, recovery);
    float k = clamp(age / recT, 0.0, 1.0);
    float hold = (1.0 - exp(-age * 60.0)) * (1.0 - k * k * (3.0 - 2.0 * k));
    if (n < 0.5) hold = 0.0;
    float rest = n < 0.5 ? 0.0 : 0.18 * cracks;
    float amt = max(hold * vel, rest);

    // The cracks: long straight breaks across the pane. Each piece of the
    // pane shows the kaleidoscope a little turned and shifted.
    float nc = floor(cracks * 5.0 + 0.5) + (hold > 0.0 ? 1.0 : 0.0);
    float region = 0.0;
    float dmin = 8.0;
    float dSide = 0.0;
    float lineId = 0.0;
    for (int i = 0; i < MAX_CRACKS; i++) {
        float fi = float(i);
        if (fi >= nc) break;
        // Lines run through a point near the middle, so they cross the mirror.
        float a = hash11(hs + fi * 3.3) * 3.1416;
        vec2 nrm = vec2(cos(a), sin(a));
        vec2 o = (vec2(hash11(hs + fi * 5.1), hash11(hs + fi * 7.7)) - 0.5) * vec2(0.8, 0.5);
        float sd = dot(p - o, nrm);
        if (sd > 0.0) region += pow(2.0, fi);
        if (abs(sd) < dmin) {
            dmin = abs(sd);
            dSide = sd;
            lineId = fi;
        }
    }
    float hr1 = hash21(vec2(region, hs + 1.0)) - 0.5;
    float hr2 = hash21(vec2(region, hs + 2.0)) - 0.5;
    float hr3 = hash21(vec2(region, hs + 3.0)) - 0.5;
    vec2 q = rot(hr1 * 0.35 * amt) * (p - vec2(hr2, hr3) * 0.08 * amt) * (1.0 + hr3 * 0.12 * amt);

    // The kaleidoscope.
    float segN = clamp(floor(segments + 0.5), 3.0, 12.0);
    float ep = floor(clk.b);
    if (ep > 0.5) segN = clamp(segN + floor((hash11(ep * 1.7 + rs) - 0.5) * 6.0 + 0.5), 3.0, 12.0);
    float seg = TAU / segN;
    float a = atan(q.y, q.x) + t * 0.04;
    float r = length(q);
    float kk = floor(a / seg);
    float f = a - kk * seg;
    float kw = mod(kk + segN, segN);
    // Segments slip out of register on hits.
    float hk = hash21(vec2(kw, hs + 9.0));
    float slipA = (hk - 0.5) * seg * 0.9 * slip * amt * step(0.35, hk);
    float slipR = (hash21(vec2(kw, hs + 4.0)) - 0.5) * 0.12 * slip * amt;
    // One segment shows the wrong reflection while the hit holds.
    float wrongK = floor(hash11(hs + 11.0) * segN);
    bool wrong = hold > 0.15 && abs(kw - wrongK) < 0.5;
    bool odd = mod(kw, 2.0) > 0.5;
    if (odd != wrong) f = seg - f;
    f += slipA;
    vec2 lq = vec2(cos(f), sin(f)) * (r * (1.0 + slipR));
    vec2 pic = content(lq, t, ps, w);
    float v = pic.x;

    vec3 col = ink.rgb * v;
    col = mix(col, accent.rgb * v * 1.2, pic.y * 0.6);
    // A slipped segment leans to the accent; the wrong one goes all the way.
    float lean = clamp(abs(slipA) / (seg * 0.3), 0.0, 1.0) * 0.5;
    if (wrong) lean = 1.0;
    col = mix(col, accent.rgb * (v * 1.15 + 0.03 * smoothstep(RAD, RAD - 0.02, r)), lean);

    // The mirror edges between segments glint as they slip.
    float edgeA = min(a - kk * seg, seg - (a - kk * seg)) * r / w;
    float glint = exp(-edgeA / 1.2) * smoothstep(RAD, RAD - 0.03, r) * smoothstep(0.02, 0.06, r);
    col += mix(ink.rgb, accent.rgb, 0.5) * glint * (0.12 + 0.7 * hold * slip);

    // The cracks themselves: a dark gap and a bright edge on one side.
    if (nc > 0.5) {
        float dpx = dmin / w;
        float gap = 0.4 + amt * 1.6;
        col *= smoothstep(gap, gap + 1.2, dpx);
        float lit = dSide > 0.0 ? 1.0 : 0.35;
        // Light runs along each crack, brightest near the mirror.
        float alongR = exp(-length(p) * 2.4);
        float edgeL = exp(-max(dpx - gap, 0.0) / 1.0) * smoothstep(gap * 0.4, gap, dpx);
        col += mix(ink.rgb, vec3(1.0), 0.2) * edgeL * lit * (0.15 + 0.85 * alongR) * (0.3 + 0.7 * amt);
        // On the hit, a short flare travels along the newest crack.
        if (abs(lineId - (nc - 1.0)) < 0.5 && hold > 0.0) {
            float a2 = hash11(hs + lineId * 3.3) * 3.1416;
            vec2 tng = vec2(-sin(a2), cos(a2));
            float along = dot(p, tng);
            float flare = exp(-pow((along - (k * 2.0 - 1.0) * aspect * 0.6) / 0.12, 2.0));
            col += accent.rgb * flare * exp(-dpx / 3.0) * hold * 1.2;
        }
    }

    // The hit: a brief, small bloom at the centre of the mirror.
    col += mix(accent.rgb, vec3(1.0), 0.3) * vxHit * exp(-length(p) * 22.0) * 0.6;

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
