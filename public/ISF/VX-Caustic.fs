/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A thick sheet of glass with a slowly undulating top hangs level over a dark floor, with a hard light shining down through it. The glass bends the light, and on the floor it gathers into a net of sharp bright filaments and cusps with fine spectral edges: the net is worked out from the glass itself, by finding every path the light can take through the ripples to each point of the floor and how tightly it is gathered there, once for each of three colors. The sheet shows its thick edge, the lamp glinting on its ripples, and the net bent through it. The sound's motion moves the ripples; its level deepens them, so the net tightens and brightens; each hit drops a ring ripple from a new point, seen spreading in the glass and in the light below. With no sound the glass is nearly still over a calm net.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "depth", "LABEL": "Ripple depth", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "scale", "LABEL": "Ripple scale", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "dispersion", "LABEL": "Dispersion", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sharp", "LABEL": "Sharpness", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Ring a hit drops", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The patch of glass searched for light reaching one floor point: NC cells on a side (NV = NC + 1 grid points).
const int NC = 8;
const int NV = 9;
const float FOCAL = 1.7;
// Glass: its index for the middle of the spectrum.
const float IOR = 1.52;
// The sheet: its underside's height over the floor, its thickness, its half-width in x, and its near and far edges in z.
const float SHEET_Y = 1.55;
const float SHEET_T = 0.2;
const float SHEET_X = 3.0;
const float SHEET_Z0 = -1.2;
const float SHEET_Z1 = 1.9;

// Set once per pixel in main().
// The four ripple trains: direction (xy), wave number (z), strength (w); and their phases.
vec4 gWave[4];
vec4 gPhase;
// The ring a hit drops: center (xy), radius (z), strength (w).
vec4 gRing;
// The size of a search cell, the bending of each of the three colors relative to the middle one, how sharp a
// filament may get, and how far the light is carried sideways on its way down.
float gCell;
vec3 gBend;
float gEps;
vec2 gShift;
float gLevel;
vec3 gInk;
vec3 gL;
vec3 gAcc;
float gRingLit;

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

// How much light a glass surface mirrors: ci is the cosine of the angle on the air side, n the index.
float fresnel(float ci, float n) {
    float st2 = (1.0 - ci * ci) / (n * n);
    float ct = sqrt(max(1.0 - st2, 0.0));
    float rs = (ci - n * ct) / (ci + n * ct);
    float rp = (ct - n * ci) / (ct + n * ci);
    return 0.5 * (rs * rs + rp * rp);
}

// How much of a soft window of half-width e round x lies between a and b: a hard-edged bar, anti-aliased.
float band(float x, float a, float b, float e) {
    return clamp((min(x + e, b) - max(x - e, a)) / (2.0 * e), 0.0, 1.0);
}

float cross2(vec2 a, vec2 b) {
    return a.x * b.y - a.y * b.x;
}

// The ring ripple's profile across its width, and that profile's slope.
vec2 ringShape(float rho) {
    float e = exp(-0.8 * rho * rho);
    float s = sin(2.4 * rho);
    float c = cos(2.4 * rho);
    return vec2(s * e, (2.4 * c - 1.6 * rho * s) * e);
}

// How far the light passing through the glass at u is carried sideways by the time it reaches the floor
// (for the middle of the spectrum). It is the slope of the rippled top that bends it: a thin wedge of glass
// turns a ray by its angle times (index - 1), so this is that slope, scaled by the drop to the floor.
vec2 dispAt(vec2 u) {
    vec2 d = vec2(0.0);
    for (int k = 0; k < 4; k++) {
        vec4 w = gWave[k];
        d += w.xy * (w.w / w.z * sin(dot(w.xy, u) * w.z + gPhase[k]));
    }
    vec2 rv = u - gRing.xy;
    float r = max(length(rv), 1e-4);
    d += rv / r * (gRing.w * ringShape((r - gRing.z) / 0.16).x);
    return d;
}

// How that sideways carry changes from place to place: the trace and the determinant of its rate of change.
// Where 1 + trace + determinant comes to nothing, neighboring rays cross: a filament.
vec2 gatherAt(vec2 u) {
    float hxx = 0.0;
    float hxy = 0.0;
    float hyy = 0.0;
    for (int k = 0; k < 4; k++) {
        vec4 w = gWave[k];
        float c = w.w * cos(dot(w.xy, u) * w.z + gPhase[k]);
        hxx += c * w.x * w.x;
        hxy += c * w.x * w.y;
        hyy += c * w.y * w.y;
    }
    vec2 rv = u - gRing.xy;
    float r = max(length(rv), 1e-3);
    vec2 rh = rv / r;
    vec2 sh = ringShape((r - gRing.z) / 0.16);
    float along = gRing.w * sh.y / 0.16;
    float across = gRing.w * sh.x / r;
    hxx += along * rh.x * rh.x + across * rh.y * rh.y;
    hxy += (along - across) * rh.x * rh.y;
    hyy += along * rh.y * rh.y + across * rh.x * rh.x;
    return vec2(hxx + hyy, hxx * hyy - hxy * hxy);
}

// The lamp's beam is masked to a rectangle just inside the sheet.
float lampMask(vec2 u) {
    return band(u.x, -SHEET_X + 0.3, SHEET_X - 0.3, 0.03) * band(u.y, SHEET_Z0 + 0.25, SHEET_Z1 - 0.25, 0.03);
}

float edgeIn(float x) {
    return clamp(x / 0.02 + 0.5, 0.0, 1.0) * clamp((1.0 - x) / 0.02 + 0.5, 0.0, 1.0);
}

// The light on the floor at p, for three colors. Light that crosses the glass at u lands at u + bend * dispAt(u),
// so the light reaching p comes from every u that lands there: there can be one such place, or three, or more,
// where the ripples fold the light over itself. They are found by laying a grid over the glass round p, seeing
// where each grid point lands, and solving in each grid cell for the spot that lands exactly on p. Each such
// spot adds light in proportion to how tightly its neighborhood is gathered on the way down.
// fp is the width of floor the pixel covers.
vec3 causticAt(vec2 p, float fp) {
    float g = gCell;
    vec2 cell0 = floor(p / g - 0.5 * float(NC) + 0.5);
    vec2 base = cell0 * g;
    vec2 dv[81];
    float reach = 0.5 * float(NC) * g - 0.55 * g;
    for (int j = 0; j < NV; j++) {
        for (int i = 0; i < NV; i++) {
            vec2 d = dispAt(base + g * vec2(float(i), float(j)));
            // Keep the search inside the patch.
            d *= min(1.0, reach / (max(length(d), 1e-5) * gBend.z));
            dv[j * NV + i] = d;
        }
    }
    float eps = gEps + 1.5 * fp / g;
    vec3 acc = vec3(0.0);
    for (int cj = 0; cj < NC; cj++) {
        for (int ci = 0; ci < NC; ci++) {
            vec2 corner = base + g * vec2(float(ci), float(cj));
            vec2 ua = corner - p;
            vec2 da = dv[cj * NV + ci];
            vec2 db = dv[cj * NV + ci + 1];
            vec2 dc = dv[(cj + 1) * NV + ci + 1];
            vec2 dd = dv[(cj + 1) * NV + ci];
            for (int l = 0; l < 3; l++) {
                float s = gBend[l];
                // Where the cell's four corners land, relative to p.
                vec2 a = ua + s * da;
                vec2 b = ua + vec2(g, 0.0) + s * db;
                vec2 c = ua + vec2(g, g) + s * dc;
                vec2 d = ua + vec2(0.0, g) + s * dd;
                vec2 lo = min(min(a, b), min(c, d));
                vec2 hi = max(max(a, b), max(c, d));
                float m = 0.03 * g;
                if (lo.x > m || lo.y > m || hi.x < -m || hi.y < -m) continue;
                // The spot inside the cell that lands on p: a quadratic, with up to two answers.
                vec2 e = b - a;
                vec2 f = d - a;
                vec2 gg = a - b + c - d;
                vec2 h = -a;
                float k2 = cross2(gg, f);
                float k1 = cross2(e, f) + cross2(h, gg);
                float k0 = cross2(h, e);
                float disc = k1 * k1 - 4.0 * k0 * k2;
                if (disc < 0.0) continue;
                float sq = sqrt(disc);
                float qq = -0.5 * (k1 + (k1 < 0.0 ? -sq : sq));
                for (int r = 0; r < 2; r++) {
                    float v = 0.0;
                    if (r == 0) {
                        if (abs(k2) < 1e-12) continue;
                        v = qq / k2;
                    } else {
                        if (abs(qq) < 1e-12) continue;
                        v = k0 / qq;
                    }
                    if (!(v > -0.05 && v < 1.05)) continue;
                    vec2 den = e + gg * v;
                    float u = abs(den.x) > abs(den.y) ? (h.x - f.x * v) / den.x : (h.y - f.y * v) / den.y;
                    if (!(u > -0.05 && u < 1.05)) continue;
                    float wgt = edgeIn(u) * edgeIn(v);
                    if (wgt <= 0.0) continue;
                    vec2 us = corner + g * vec2(u, v);
                    vec2 ga = gatherAt(us);
                    float det = 1.0 + s * ga.x + s * s * ga.y;
                    float lit = wgt * lampMask(us) / sqrt(det * det + eps * eps);
                    // Light that came through the ring a hit dropped is tinted with the accent color.
                    float rr = (length(us - gRing.xy) - gRing.z) / 0.3;
                    vec3 tint = mix(vec3(1.0), gAcc * 1.6, gRingLit * exp(-rr * rr));
                    acc += vec3(l == 0 ? lit : 0.0, l == 1 ? lit : 0.0, l == 2 ? lit : 0.0) * tint;
                }
            }
        }
    }
    return acc;
}

// The lights of the room, for the glass to mirror: the lamp overhead, a ladder of bars on the far wall, a strip on the ceiling.
vec3 env(vec3 d, float e) {
    vec3 c = gInk * 0.006;
    float kr = 0.03;
    float ang = sqrt(max(2.0 - 2.0 * dot(d, gL), 0.0));
    c += gInk * (60.0 * gLevel) * smoothstep(kr + e + 0.004, kr - e - 0.004, ang);
    if (d.z > 0.05) {
        vec2 q = d.xy / d.z;
        float w = 0.004 + e * (1.0 + dot(q, q));
        // A ladder of thin bars up the far wall.
        float by = (q.y - 0.12) / 0.12;
        float rung = band(fract(by), 0.4, 0.56, w / 0.12) * step(0.0, by) * step(by, 6.0);
        c += gInk * (4.5 * gLevel) * rung * band(q.x, -2.4, 2.4, w);
    }
    if (d.y > 0.05) {
        vec2 q = d.xz / d.y;
        float w = 0.008 + e * (1.0 + dot(q, q));
        c += gInk * (4.0 * gLevel) * band(q.x, -0.8, -0.76, w) * band(q.y, -0.6, 1.8, w);
    }
    return c;
}

// The floor's surface under a given light: matte dark stone.
vec3 floorLit(vec3 p, vec3 caus) {
    float far = exp(-dot(p.xz, p.xz) * 0.012);
    return (vec3(0.002, 0.0022, 0.0026) + gInk * caus * (0.1 * gLevel)) * far;
}

// Where a ray meets the sheet (as a flat-sided block): the distance (or -1) and the face's normal.
float sheetEnter(vec3 ro, vec3 rd, out vec3 nrm) {
    vec3 lo = vec3(-SHEET_X, SHEET_Y, SHEET_Z0);
    vec3 hi = vec3(SHEET_X, SHEET_Y + SHEET_T, SHEET_Z1);
    vec3 inv = 1.0 / vec3(abs(rd.x) > 1e-6 ? rd.x : 1e-6, abs(rd.y) > 1e-6 ? rd.y : 1e-6, abs(rd.z) > 1e-6 ? rd.z : 1e-6);
    vec3 t0 = (lo - ro) * inv;
    vec3 t1 = (hi - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), tmin.z);
    float tf = min(min(tmax.x, tmax.y), tmax.z);
    nrm = vec3(0.0, 1.0, 0.0);
    if (tf < tn || tn < 0.0) return -1.0;
    if (tn == tmin.x) nrm = vec3(rd.x > 0.0 ? -1.0 : 1.0, 0.0, 0.0);
    else if (tn == tmin.z) nrm = vec3(0.0, 0.0, rd.z > 0.0 ? -1.0 : 1.0);
    else nrm = vec3(0.0, rd.y > 0.0 ? -1.0 : 1.0, 0.0);
    return tn;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 pc = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float nHit = floor(vxCount + 0.5);
    // The ripples move with the sound; a trace of drift keeps a silent room from freezing.
    float flow = vxFlow + TIME * 0.02;

    gInk = ink.rgb;
    gAcc = accent.rgb;
    gRingLit = nHit > 0.5 ? smoothstep(0.0, 0.25, pu) : 0.0;
    gLevel = 0.55 + 0.7 * sw;
    // The lamp hangs above and behind the sheet, so its light lands a little toward the camera.
    gL = normalize(vec3(-0.08, 1.0, 0.72));
    float drop = SHEET_Y + SHEET_T / IOR;
    gShift = -gL.xz / gL.y * drop;

    // Four trains of ripples cross the glass at different angles and never quite repeat, the longest slow and weak. Their strength
    // is how hard they gather the light on the floor: past 1 in all, the light folds over into filaments.
    float lam = mix(0.5, 1.15, scale);
    float deep = mix(0.6, 1.15, depth) * (0.95 + 0.2 * sw);
    gWave[0] = vec4(cos(0.25), sin(0.25), 6.2832 / lam, 1.0 * deep);
    gWave[1] = vec4(cos(1.33), sin(1.33), 6.2832 / (lam * 1.23), 0.95 * deep);
    gWave[2] = vec4(cos(2.36), sin(2.36), 6.2832 / (lam * 1.51), 0.85 * deep);
    gWave[3] = vec4(cos(0.8), sin(0.8), 6.2832 / (lam * 2.4), 0.15 * deep);
    gPhase = vec4(flow * 0.9, -flow * 0.74 + 1.3, flow * 0.55 + 2.9, -flow * 0.41 + 4.4);
    gCell = lam / 6.5;

    // Each hit drops a ring from a new point; it spreads and fades as the hit dies away.
    vec2 ringAt = vec2((hash11(nHit * 3.3 + 0.7) - 0.5) * 3.4, mix(SHEET_Z0 + 0.5, SHEET_Z1 - 0.5, hash11(nHit * 7.1 + 2.9)));
    gRing = vec4(ringAt, 0.1 + 1.5 * (1.0 - pu), nHit > 0.5 ? 0.16 * sqrt(pu) : 0.0);

    float spread = mix(0.0, 0.1, dispersion);
    gBend = vec3(1.0 - spread, 1.0, 1.0 + spread);
    gEps = mix(0.2, 0.012, sharp);

    // Camera: in front of the sheet and above it, looking down at the floor under it.
    vec3 ro = vec3(0.0, 4.6, -5.6);
    vec3 ta = vec3(0.0, 0.5, -1.0);
    vec3 fwd = normalize(ta - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(pc.x * rgt + pc.y * upv + FOCAL * fwd);
    float foot = px / FOCAL;

    // The sheet's outline is anti-aliased with four sub-pixel rays.
    float cov = 0.0;
    float tS = -1.0;
    vec3 nS = vec3(0.0, 1.0, 0.0);
    vec3 rdS = rd;
    for (int s = 0; s < 4; s++) {
        float fs = float(s);
        vec2 o = (vec2(mod(fs, 2.0), floor(fs / 2.0)) - 0.5) * 0.5;
        vec3 rk = normalize((pc.x + o.x * px) * rgt + (pc.y + o.y * px) * upv + FOCAL * fwd);
        vec3 nk;
        float tk = sheetEnter(ro, rk, nk);
        if (tk > 0.0) {
            cov += 0.25;
            if (tS < 0.0) {
                tS = tk;
                nS = nk;
                rdS = rk;
            }
        }
    }
    vec3 nc;
    float tc = sheetEnter(ro, rd, nc);
    if (tc > 0.0) {
        tS = tc;
        nS = nc;
        rdS = rd;
    }

    // What the glass adds of its own, how much of the floor shows through it, and where on the floor.
    vec3 glassCol = vec3(0.0);
    vec3 through = vec3(0.0);
    vec3 floorVia = vec3(0.0);
    float viaOk = 0.0;
    if (cov > 0.0) {
        vec3 p = ro + rdS * tS;
        if (nS.y > 0.5) {
            // The rippled top: it mirrors the room, and the view bends down through the glass to the floor.
            vec2 slope = dispAt(p.xz) / ((IOR - 1.0) * drop);
            vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
            float ci = clamp(-dot(rdS, n), 0.0, 1.0);
            float f = fresnel(ci, IOR);
            vec3 rr = reflect(rdS, n);
            glassCol += f * env(rr, foot * 1.5);
            float kin = 1.0 - (1.0 - ci * ci) / (IOR * IOR);
            vec3 d1 = rdS / IOR + (ci / IOR - sqrt(max(kin, 0.0))) * n;
            float tb = SHEET_T / max(-d1.y, 0.05);
            vec3 pb = p + d1 * tb;
            vec2 oh = d1.xz * IOR;
            float oy2 = 1.0 - dot(oh, oh);
            if (oy2 > 0.0) {
                vec3 d2 = vec3(oh.x, -sqrt(oy2), oh.y);
                float f2 = fresnel(-d2.y, IOR);
                floorVia = pb + d2 * (pb.y / -d2.y);
                viaOk = 1.0;
                // Thick glass is faintly green.
                through = (1.0 - f) * (1.0 - f2) * exp(-vec3(0.5, 0.12, 0.3) * tb);
            }
        } else {
            // The edge: the view goes in through the side and is carried along between the top and the
            // underside, which mirror it perfectly, until it meets another side.
            float ci = clamp(-dot(rdS, nS), 0.0, 1.0);
            float f = fresnel(ci, IOR);
            vec3 rr = reflect(rdS, nS);
            glassCol += f * (rr.y > 0.0 ? env(rr, foot) : vec3(0.004));
            float kin = 1.0 - (1.0 - ci * ci) / (IOR * IOR);
            vec3 d = rdS / IOR + (ci / IOR - sqrt(kin)) * nS;
            vec3 q = p;
            float len = 0.0;
            float rise = p.y - SHEET_Y;
            vec3 seen = vec3(0.0);
            for (int b = 0; b < 2; b++) {
                // The next side wall along the way.
                float tx = d.x > 1e-5 ? (SHEET_X - q.x) / d.x : (d.x < -1e-5 ? (-SHEET_X - q.x) / d.x : 1e9);
                float tz = d.z > 1e-5 ? (SHEET_Z1 - q.z) / d.z : (d.z < -1e-5 ? (SHEET_Z0 - q.z) / d.z : 1e9);
                float t = min(tx, tz);
                vec3 nw = tx < tz ? vec3(d.x > 0.0 ? 1.0 : -1.0, 0.0, 0.0) : vec3(0.0, 0.0, d.z > 0.0 ? 1.0 : -1.0);
                q += vec3(d.x, 0.0, d.z) * t;
                len += t;
                // Whether it is heading up or down when it gets there, after all its bounces.
                float trav = abs(d.y) * len + (d.y < 0.0 ? SHEET_T - rise : rise);
                float flips = mod(floor(trav / SHEET_T), 2.0);
                float dy = flips > 0.5 ? -d.y : d.y;
                float co = dot(d, nw);
                float k2 = 1.0 - IOR * IOR * (1.0 - co * co);
                if (k2 > 0.0) {
                    float c4 = sqrt(k2);
                    vec3 o = IOR * vec3(d.x, dy, d.z) + (c4 - IOR * co) * nw;
                    seen = (1.0 - fresnel(c4, IOR)) * (o.y > 0.0 ? env(normalize(o), 0.02) : vec3(0.004));
                    break;
                }
                d = reflect(d, nw);
            }
            // A long way through glass turns the light green; and the edge glows with the lamp's light caught inside.
            vec3 green = exp(-vec3(0.5, 0.12, 0.3) * len);
            glassCol += (1.0 - f) * (seen * green + gInk * vec3(0.25, 0.9, 0.6) * (0.085 * gLevel) * (1.0 - green.r));
        }
        // The sheet's edges catch the light as hairlines.
        vec3 lo = vec3(-SHEET_X, SHEET_Y, SHEET_Z0);
        vec3 hi = vec3(SHEET_X, SHEET_Y + SHEET_T, SHEET_Z1);
        vec3 dEdge = min(p - lo, hi - p);
        float e1 = nS.y > 0.5 ? min(dEdge.x, dEdge.z) : (abs(nS.x) > 0.5 ? min(dEdge.y, dEdge.z) : min(dEdge.x, dEdge.y));
        glassCol += gInk * (0.3 * gLevel) * smoothstep(1.6, 0.3, e1 / max(foot * tS, 1e-5));
    }

    // One look at the floor's net of light for this pixel: straight at the floor, or through the glass.
    vec3 direct = vec3(0.0);
    float tf = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;
    vec3 pf = ro + rd * min(tf, 1e3);
    bool useVia = cov >= 0.5 && viaOk > 0.5;
    vec3 look = useVia ? floorVia : pf;
    float fp = foot * length(look - ro) / max(-rd.y, 0.1);
    // Only the floor the lamp's light can reach needs the search.
    vec2 lu = look.xz - gShift;
    float margin = 0.5 * float(NC) * gCell;
    vec3 caus = vec3(0.0);
    if (abs(lu.x) < SHEET_X + margin && lu.y > SHEET_Z0 - margin && lu.y < SHEET_Z1 + margin) caus = causticAt(lu, fp);
    vec3 col = vec3(0.0);
    if (cov < 1.0 && tf < 1e3) col += floorLit(pf, caus) * (1.0 - cov);
    if (cov > 0.0) col += (glassCol + through * floorLit(floorVia, caus) * viaOk) * cov;

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the colored edges keep their hue, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark room lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
