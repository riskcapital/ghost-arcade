/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A cluster of bismuth crystals on a dark floor: cubes grown hollow, each face a square spiral of terraces stepping down toward its middle, several crystals grown through one another at different angles. The metal wears a thin film that colors every terrace differently, gold, magenta, blue and green, shifting as the cluster turns under a studio light. The sound's motion turns the cluster; its level grows the terraces deeper, step after step; each hit shifts the film so the colors jump along the steps, and fires a rim light in the accent color. With no sound the crystals sit shallow and still.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "steps", "LABEL": "Steps", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "crystals", "LABEL": "Crystals", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0, "MAX": 1 },
        { "NAME": "film", "LABEL": "Film", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "turn", "LABEL": "Turn", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Key light", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Rim light", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const int MARCH = 80;
const float FOCAL = 2.15;
const float PI = 3.14159265;
// The flat rim round each face, as a part of the crystal's half size, and how tall a step is for its width.
const float RIM = 0.1;
const float RISE = 0.85;

// Seven crystals: where each stands (x, y, z) and its half size, and the three axes it is turned to.
// Some stand on a corner, so three of their stepped faces show at once.
const vec4 C0 = vec4(0.0, 0.7, 0.0, 0.62);
const vec4 C1 = vec4(0.88, 0.3, 0.12, 0.4);
const vec4 C2 = vec4(-0.82, 0.34, 0.2, 0.4);
const vec4 C3 = vec4(0.3, 0.17, -0.86, 0.26);
const vec4 C4 = vec4(-0.3, 0.42, 0.86, 0.44);
const vec4 C5 = vec4(-0.55, 0.12, -0.74, 0.19);
const vec4 C6 = vec4(0.95, 0.1, -0.62, 0.17);
const vec3 A0X = vec3(-0.64195, 0.69514, 0.32355);
const vec3 A0Y = vec3(0.76574, 0.60286, 0.22405);
const vec3 A0Z = vec3(-0.03931, 0.39158, -0.91930);
const vec3 A1X = vec3(0.87252, 0.14795, -0.46563);
const vec3 A1Y = vec3(0.05558, 0.91680, 0.39545);
const vec3 A1Z = vec3(0.48540, -0.37092, 0.79171);
const vec3 A2X = vec3(0.25189, 0.94686, -0.20000);
const vec3 A2Y = vec3(-0.95182, 0.20505, -0.22801);
const vec3 A2Z = vec3(-0.17488, 0.24780, 0.95290);
const vec3 A3X = vec3(0.70454, 0.42144, 0.57097);
const vec3 A3Y = vec3(-0.14323, 0.87245, -0.46723);
const vec3 A3Z = vec3(-0.69506, 0.24740, 0.67505);
const vec3 A4X = vec3(-0.51028, 0.74585, 0.42817);
const vec3 A4Y = vec3(0.56092, -0.08875, 0.82310);
const vec3 A4Z = vec3(0.65190, 0.66018, -0.37308);
const vec3 A5X = vec3(-0.36441, -0.28963, -0.88505);
const vec3 A5Y = vec3(0.08407, 0.93629, -0.34101);
const vec3 A5Z = vec3(0.92744, -0.19867, -0.31685);
const vec3 A6X = vec3(0.89384, 0.22277, -0.38914);
const vec3 A6Y = vec3(-0.36090, 0.87245, -0.32951);
const vec3 A6Z = vec3(0.26610, 0.43497, 0.86023);
// Everything stays inside this ball.
const vec4 BALL = vec4(0.0, 0.55, 0.0, 1.72);
// Growth lines: fine grooves ruled along every terrace, this many to a step.
const float LINES = 3.0;
// Where the key lamp stands, upper left and to the front, and the rim lamp, behind and to the right.
const vec3 KEY_FROM = vec3(-0.49152, 0.76677, -0.41288);
const vec3 RIM_FROM = vec3(0.72261, 0.30109, 0.62225);

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

// One side of a face's pit, seen in section: u runs out from the middle of the face, hgt up from the
// middle of the crystal. The terraces step down toward the middle; off shifts this side's steps by a
// part of a step, so that the four sides together make one square spiral. deep is how many steps are grown.
float stair(float u, float hgt, float R, float off, float deep, float most) {
    float rim = R * RIM;
    float sw = (R - rim) * 0.97 / most;
    float sh = sw * RISE;
    float v = (R - rim - u) / sw + off;
    float i = floor(v);
    float depth = clamp(i + 1.0 - off, 0.0, deep);
    float dTop = hgt - (R - depth * sh);
    // The riser up to the next terrace out.
    float depthOut = clamp(i - off, 0.0, deep);
    float ub = R - rim - (i - off) * sw;
    float dWall = depthOut < depth ? max(ub - u, hgt - (R - depthOut * sh)) : 1e3;
    // Anything farther off is at least a step's width away.
    return min(min(dTop, dWall), ub + sw - u);
}

// Distance to one crystal, in its own frame: a cube with a stepped spiral pit in every face.
float crystal(vec3 q, float R, float deep, float most) {
    vec3 a = abs(q);
    vec3 o = a - R;
    float box = length(max(o, 0.0)) + min(max(o.x, max(o.y, o.z)), 0.0);
    if (box > 0.07 * R) return box;
    // Which face the point is over, and where on that face.
    float hgt;
    vec2 st;
    if (a.x >= a.y && a.x >= a.z) {
        hgt = a.x;
        st = q.x > 0.0 ? q.yz : q.zy;
    } else if (a.y >= a.z) {
        hgt = a.y;
        st = q.y > 0.0 ? q.zx : q.xz;
    } else {
        hgt = a.z;
        st = q.z > 0.0 ? q.xy : q.yx;
    }
    vec2 as = abs(st);
    bool wide = as.x >= as.y;
    // The four sides of the pit take turns, each a quarter of a step on from the last.
    float offOwn = wide ? (st.x > 0.0 ? 0.0 : 0.5) : (st.y > 0.0 ? 0.25 : 0.75);
    float offNext = wide ? (st.y > 0.0 ? 0.25 : 0.75) : (st.x > 0.0 ? 0.0 : 0.5);
    float uOwn = max(as.x, as.y);
    float uNext = min(as.x, as.y);
    float dOwn = stair(uOwn, hgt, R, offOwn, deep, most);
    // The neighboring side starts at the diagonal.
    float dNext = max(stair(uNext, hgt, R, offNext, deep, most), (uOwn - uNext) * 0.7071);
    return min(dOwn, dNext);
}

// How many steps crystal k has grown: each a little ahead of or behind the others.
float grown(float k, float grow, float most) {
    return most * clamp(grow + (hash11(k * 3.7 + 1.1) - 0.5) * 0.24, 0.12, 1.0);
}

// The most steps a face of a crystal of half size R holds: small crystals have fewer, so that
// steps are about as wide on all of them.
float stepsFor(float R, float most) {
    return max(3.0, floor(most * R / 0.62 + 0.5));
}

float placed(vec3 w, vec4 c, vec3 ax, vec3 ay, vec3 az, float k, float grow, float most) {
    vec3 d = w - c.xyz;
    float far = length(d) - c.w * 1.7321;
    if (far > 0.2) return far;
    float own = stepsFor(c.w, most);
    return crystal(vec3(dot(d, ax), dot(d, ay), dot(d, az)), c.w, grown(k, grow, own), own);
}

// The cluster. K is (cosine and sine of its turn, how grown it is 0-1, the most steps a face holds).
float map(vec3 p, vec4 K, float count) {
    vec3 w = vec3(K.x * p.x - K.y * p.z, p.y, K.y * p.x + K.x * p.z);
    float d = placed(w, C0, A0X, A0Y, A0Z, 0.0, K.z, K.w);
    d = min(d, placed(w, C1, A1X, A1Y, A1Z, 1.0, K.z, K.w));
    if (count > 2.5) d = min(d, placed(w, C2, A2X, A2Y, A2Z, 2.0, K.z, K.w));
    if (count > 3.5) d = min(d, placed(w, C3, A3X, A3Y, A3Z, 3.0, K.z, K.w));
    if (count > 4.5) d = min(d, placed(w, C4, A4X, A4Y, A4Z, 4.0, K.z, K.w));
    if (count > 5.5) d = min(d, placed(w, C5, A5X, A5Y, A5Z, 5.0, K.z, K.w));
    if (count > 6.5) d = min(d, placed(w, C6, A6X, A6Y, A6Z, 6.0, K.z, K.w));
    return d;
}

// What the surface is at a point of one crystal, q, on a facet that faces along nl (both in the crystal's
// own frame): (which terrace, counted in steps down from the rim; 2 on a riser, plus how much of the
// pixel a growth line covers; how far the point is from the nearest sharp outward edge; a number for
// the face and side). foot is the size of a pixel there.
vec4 terrace(vec3 q, vec3 nl, float R, float deep, float most, float foot) {
    vec3 a = abs(q);
    float hgt;
    vec2 st;
    float face;
    float flat1;
    if (a.x >= a.y && a.x >= a.z) {
        hgt = a.x;
        st = q.x > 0.0 ? q.yz : q.zy;
        face = q.x > 0.0 ? 0.0 : 1.0;
        flat1 = abs(nl.x);
    } else if (a.y >= a.z) {
        hgt = a.y;
        st = q.y > 0.0 ? q.zx : q.xz;
        face = q.y > 0.0 ? 2.0 : 3.0;
        flat1 = abs(nl.y);
    } else {
        hgt = a.z;
        st = q.z > 0.0 ? q.xy : q.yx;
        face = q.z > 0.0 ? 4.0 : 5.0;
        flat1 = abs(nl.z);
    }
    // A facet that faces out of its face of the crystal is a terrace; any other is a riser.
    float riser = 1.0 - step(0.5, flat1);
    vec2 as = abs(st);
    float off = as.x >= as.y ? (st.x > 0.0 ? 0.0 : 0.5) : (st.y > 0.0 ? 0.25 : 0.75);
    float u = max(as.x, as.y);
    float rim = R * RIM;
    float sw = (R - rim) * 0.97 / most;
    float sh = sw * RISE;
    float v = (R - rim - u) / sw + off;
    float i = floor(v);
    float depth = clamp(i + 1.0 - off, 0.0, deep);
    // Outward edges: where this terrace drops to the next one in (which is also the top of the riser
    // below it), and the crystal's own edges. Measured in the section, so it is the same from either side.
    float eIn = depth + 0.001 < deep ? length(vec2((i + 1.0 - v) * sw, hgt - (R - depth * sh))) : 1.0;
    float edge = min(eIn, length(vec2(R - u, hgt - R)));
    // Where the steps are only a pixel or two wide the edge lines are left out: they would only shimmer.
    edge = mix(edge, 1.0, smoothstep(0.22, 0.5, foot / sw));
    // Growth lines along the terrace, drawn no thinner than a pixel and faded out where they would crowd.
    float gl = v * LINES;
    float dl = abs(gl - floor(gl + 0.5)) * sw / LINES;
    float wl = max(0.0011, 0.5 * foot);
    float groove = clamp((wl - dl) / max(foot, 1e-5) + 0.5, 0.0, 1.0) * (0.0011 / wl);
    groove *= (1.0 - riser) * step(0.0, v) * (1.0 - smoothstep(0.2, 0.42, foot * LINES / sw));
    return vec4(depth, riser * 2.0 + min(groove, 0.99), edge, face + off);
}

// The same for the whole cluster: finds the crystal the point is on. Every facet of a crystal faces along
// one of its three axes, so the rough normal given is set square to the nearest of them; that keeps each
// facet perfectly flat right up to its edges. Returns three columns: the facet's normal; the first three
// numbers terrace() gives; and its fourth (which here also names the crystal).
mat3 surface(vec3 p, vec3 rough, vec3 rd, vec4 K, float count, float foot) {
    vec3 w = vec3(K.x * p.x - K.y * p.z, p.y, K.y * p.x + K.x * p.z);
    float best = placed(w, C0, A0X, A0Y, A0Z, 0.0, K.z, K.w);
    float which = 0.0;
    float d1 = placed(w, C1, A1X, A1Y, A1Z, 1.0, K.z, K.w);
    if (d1 < best) { best = d1; which = 1.0; }
    if (count > 2.5) {
        float d2 = placed(w, C2, A2X, A2Y, A2Z, 2.0, K.z, K.w);
        if (d2 < best) { best = d2; which = 2.0; }
    }
    if (count > 3.5) {
        float d3 = placed(w, C3, A3X, A3Y, A3Z, 3.0, K.z, K.w);
        if (d3 < best) { best = d3; which = 3.0; }
    }
    if (count > 4.5) {
        float d4 = placed(w, C4, A4X, A4Y, A4Z, 4.0, K.z, K.w);
        if (d4 < best) { best = d4; which = 4.0; }
    }
    if (count > 5.5) {
        float d5 = placed(w, C5, A5X, A5Y, A5Z, 5.0, K.z, K.w);
        if (d5 < best) { best = d5; which = 5.0; }
    }
    if (count > 6.5) {
        float d6 = placed(w, C6, A6X, A6Y, A6Z, 6.0, K.z, K.w);
        if (d6 < best) { best = d6; which = 6.0; }
    }
    vec4 c = C0;
    vec3 ax = A0X;
    vec3 ay = A0Y;
    vec3 az = A0Z;
    if (which > 0.5) { c = C1; ax = A1X; ay = A1Y; az = A1Z; }
    if (which > 1.5) { c = C2; ax = A2X; ay = A2Y; az = A2Z; }
    if (which > 2.5) { c = C3; ax = A3X; ay = A3Y; az = A3Z; }
    if (which > 3.5) { c = C4; ax = A4X; ay = A4Y; az = A4Z; }
    if (which > 4.5) { c = C5; ax = A5X; ay = A5Y; az = A5Z; }
    if (which > 5.5) { c = C6; ax = A6X; ay = A6Y; az = A6Z; }
    vec3 d = w - c.xyz;
    vec3 q = vec3(dot(d, ax), dot(d, ay), dot(d, az));
    vec3 rw = vec3(K.x * rough.x - K.y * rough.z, rough.y, K.y * rough.x + K.x * rough.z);
    vec3 ne = vec3(dot(rw, ax), dot(rw, ay), dot(rw, az));
    vec3 an = abs(ne);
    vec3 nl;
    if (an.x >= an.y && an.x >= an.z) nl = vec3(ne.x > 0.0 ? 1.0 : -1.0, 0.0, 0.0);
    else if (an.y >= an.z) nl = vec3(0.0, ne.y > 0.0 ? 1.0 : -1.0, 0.0);
    else nl = vec3(0.0, 0.0, ne.z > 0.0 ? 1.0 : -1.0);
    vec3 nw = nl.x * ax + nl.y * ay + nl.z * az;
    vec3 nrm = vec3(K.x * nw.x + K.y * nw.z, nw.y, -K.y * nw.x + K.x * nw.z);
    float own = stepsFor(c.w, K.w);
    float seen = foot / max(abs(dot(nrm, rd)), 0.25);
    // The point is looked up a hair under the surface, so that it falls cleanly inside one terrace.
    vec4 t = terrace(q - nl * max(0.0006, 0.3 * foot), nl, c.w, grown(which, K.z, own), own, seen);
    return mat3(nrm, t.xyz, vec3(t.w + which * 6.0, 0.0, 0.0));
}

vec3 normalAt(vec3 p, float e, vec4 K, float count) {
    vec2 k = vec2(1.0, -1.0);
    return normalize(k.xyy * map(p + k.xyy * e, K, count) + k.yyx * map(p + k.yyx * e, K, count)
                   + k.yxy * map(p + k.yxy * e, K, count) + k.xxx * map(p + k.xxx * e, K, count));
}

// How much of the lamp reaches a point: the crystals throw real shadows, soft at their edges.
float shadow(vec3 p, vec3 l, vec4 K, float count) {
    float res = 1.0;
    float t = 0.012;
    for (int i = 0; i < 18; i++) {
        float d = map(p + l * t, K, count);
        res = min(res, 14.0 * d / t);
        t += clamp(d, 0.008, 0.22);
        if (res < 0.01 || t > 3.2) break;
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
}

// How open a point is to the room: the stepped recesses are darker the deeper they go.
float openness(vec3 p, vec3 nrm, vec4 K, float count) {
    float o = 0.0;
    float wgt = 1.0;
    for (int i = 1; i <= 4; i++) {
        float h = 0.014 * float(i) * float(i);
        o += (h - map(p + nrm * h, K, count)) * wgt;
        wgt *= 0.62;
    }
    return clamp(1.0 - 3.0 * o, 0.0, 1.0);
}

// The color a thin clear film gives the light it reflects: light bounced off the top of the film and
// light bounced off the metal under it reinforce or cancel, differently for each color, by how thick
// the film is (in nanometers) and how steeply the light crosses it.
vec3 filmColor(float thick, float cosIn) {
    vec3 phase = 4.0 * PI * 2.4 * thick * cosIn / vec3(612.0, 549.0, 465.0);
    vec3 c = 0.5 + 0.5 * cos(phase);
    // The bare metal shows through: it stays a metal, not paint.
    return mix(vec3(0.7, 0.68, 0.67), c, 0.8);
}

// The room the metal mirrors, seen from p along r: a dim studio with a bank of long lamps overhead, a
// strip light to one side and a dim fill behind the camera. The lamps are near enough that each terrace, at its own depth, mirrors a different part.
vec3 room(vec3 p, vec3 r, vec3 keyC) {
    vec3 e = vec3(0.05, 0.055, 0.064) * (0.12 + 0.88 * smoothstep(-0.1, 0.9, r.y));
    if (r.y > 0.04) {
        vec2 P = p.xz + r.xz * ((3.4 - p.y) / r.y);
        vec2 b = abs(P - vec2(-0.4, -0.9)) - vec2(3.0, 2.1);
        float bank = 1.0 - smoothstep(-0.12, 0.12, max(b.x, b.y));
        // Long lamps side by side, with dark between them.
        float lamp = smoothstep(0.17, 0.27, abs(fract((P.y + 1.0) / 0.7) - 0.5));
        e += keyC * bank * (0.14 + 1.2 * lamp);
        vec2 s = abs(P - vec2(3.9, 0.4)) - vec2(0.22, 2.8);
        e += keyC * (1.0 - smoothstep(-0.08, 0.08, max(s.x, s.y))) * 0.9;
    }
    // A broad dim fill from behind the camera.
    e += keyC * 0.11 * smoothstep(0.25, 0.95, -r.z) * smoothstep(-0.3, 0.3, r.y);
    e += vec3(0.02, 0.024, 0.032) * exp(-abs(r.y) * 7.0);
    return e;
}

// The metal at a point, lit. nrm is the way its facet faces, sf what terrace() says of it, foot the size
// of a pixel there, sh how much of the key lamp reaches it and ao how open it is to the room.
vec3 metal(vec3 p, vec3 rd, vec3 nrm, vec4 sf, float foot, vec3 keyC, vec3 rimC, float rimLevel, float shift, float sh, float ao) {
    vec3 V = -rd;
    float ndv = clamp(dot(nrm, V), 0.0, 1.0);
    float riser = step(1.5, sf.y);
    float groove = sf.y - 2.0 * riser;

    // The film is a little thicker on each terrace down, unevenly, and differs from face to face.
    float thick = sf.x * mix(1.0, 13.0, film) + hash11(floor(sf.w) * 1.37 + 2.0) * 146.0
                + (hash11(floor(sf.x + 0.01) * 7.31 + floor(sf.w) * 3.1) - 0.5) * 34.0 + riser * 10.0 + groove * 16.0 + shift;
    thick = 122.0 + mod(thick, 146.0);
    float cosIn = sqrt(1.0 - (1.0 - ndv * ndv) / 2.4);
    vec3 F0 = filmColor(thick, cosIn);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);

    // The room mirrored in the facet; a growth line is a groove, so it mirrors a little less.
    vec3 col = F * room(p, reflect(rd, nrm), keyC) * ao * (0.4 + 0.6 * sh) * (1.0 - 0.45 * groove);
    // The key light: a hard glint and the broader sheen of metal that is not quite a mirror.
    float ndl = max(dot(nrm, KEY_FROM), 0.0);
    float ndh = max(dot(nrm, normalize(KEY_FROM + V)), 0.0);
    col += F * keyC * (pow(ndh, 90.0) * 3.5 + pow(ndh, 14.0) * 0.5 + 0.16) * ndl * sh;
    // Every outward edge is a hairline of light.
    float we = max(0.0013, 0.8 * foot / max(ndv, 0.2));
    float glint = exp(-sf.z / we) * min(1.0, 0.0013 / we + 0.12);
    col += mix(F, vec3(1.0), 0.45) * keyC * glint * 0.7 * ao;
    // The rim light a hit fires, from behind and to the right.
    float ndr = max(dot(nrm, RIM_FROM), 0.0);
    float nhr = max(dot(nrm, normalize(RIM_FROM + V)), 0.0);
    col += mix(F, vec3(1.0), 0.55) * rimC * rimLevel * (pow(nhr, 28.0) * 2.4 + 0.7 * pow(1.0 - ndv, 3.0) + glint * 0.9) * ndr * ao;
    return col;
}

// One view ray: (color, how solid). 2 is added to the last number when the ray met a crystal or
// passed within a pixel or two of one: such pixels are worth a second ray.
vec4 view(vec3 ro, vec3 rd, float px, vec4 K, float count, vec3 keyC, vec3 rimC, float rimLevel, float shift) {
    // The ray's stretch inside the ball that holds the cluster.
    vec3 oc = ro - BALL.xyz;
    float b = dot(oc, rd);
    float disc = b * b - dot(oc, oc) + BALL.w * BALL.w;
    float tGround = rd.y < -1e-4 ? -ro.y / rd.y : 1e5;
    float tHit = -1.0;
    float nearest = 1.0;
    if (disc > 0.0) {
        float sq = sqrt(disc);
        float t = max(-b - sq, 0.0);
        float tEnd = min(-b + sq, tGround);
        float last = 1.0;
        for (int i = 0; i < MARCH; i++) {
            if (t > tEnd) break;
            float d = map(ro + rd * t, K, count);
            last = d;
            // The ray is followed right down onto the surface, so that neighboring pixels agree about where it is.
            if (d < 0.0002 * t) {
                tHit = t + d;
                break;
            }
            nearest = min(nearest, d / t);
            t += d;
        }
        // A ray that ran out of steps while skimming a surface has met it all the same.
        if (tHit < 0.0 && t <= tEnd && last < 0.004 * t) tHit = t;
    }
    bool onMetal = tHit > 0.0;
    float grazed = nearest < 2.5 * px / FOCAL ? 2.0 : 0.0;
    if (!onMetal && tGround > 1e4) {
        return vec4(vec3(0.004, 0.0045, 0.006), grazed);
    }

    // Where the ray lands: on a crystal, or on the floor.
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 P = ro + rd * (onMetal ? tHit : tGround);
    float near = length(P - vec3(BALL.x, 0.0, BALL.z));
    bool close = onMetal || near < 3.4;

    // The metal to be shaded: what the ray met, or what the floor mirrors there.
    vec3 Pm = P;
    vec3 dm = rd;
    float tm = tHit;
    bool anyMetal = onMetal;
    float mirrorAt = 0.0;
    if (!onMetal && close) {
        vec3 rr = vec3(rd.x, -rd.y, rd.z);
        vec3 oc2 = P - BALL.xyz;
        float b2 = dot(oc2, rr);
        float disc2 = b2 * b2 - dot(oc2, oc2) + BALL.w * BALL.w;
        if (disc2 > 0.0) {
            float sq2 = sqrt(disc2);
            float t = max(-b2 - sq2, 0.01);
            float tEnd = -b2 + sq2;
            for (int i = 0; i < 24; i++) {
                if (t > tEnd) break;
                float d = map(P + rr * t, K, count);
                if (d < 0.002 * (t + tGround)) {
                    Pm = P + rr * t;
                    dm = rr;
                    tm = t + tGround;
                    mirrorAt = t;
                    anyMetal = true;
                    break;
                }
                t += d;
            }
        }
    }
    float foot = tm * px / FOCAL;
    vec3 nrm = up;
    vec4 sf = vec4(0.0);
    if (anyMetal) {
        vec3 rough = normalAt(Pm, max(0.0005, 0.2 * foot), K, count);
        mat3 S = surface(Pm, rough, dm, K, count, foot);
        nrm = S[0];
        sf = vec4(S[1], S[2].x);
    }

    // The light that reaches the point the ray landed on: the crystals throw real shadows,
    // and the stepped recesses and the floor under the cluster are darker.
    vec3 facing = onMetal ? nrm : up;
    float sh = 1.0;
    float ao = 1.0;
    if (close) {
        sh = shadow(P + facing * 0.006, KEY_FROM, K, count);
        ao = openness(P, facing, K, count);
    }
    vec3 mc = vec3(0.0);
    if (anyMetal) {
        mc = metal(Pm, dm, nrm, sf, foot, keyC, rimC, rimLevel, shift, onMetal ? sh : 1.0, onMetal ? ao : 1.0);
    }
    if (onMetal) return vec4(mc, 3.0);

    // The floor: dark and a little glossy, with the cluster faintly mirrored in it.
    vec3 fc = (vec3(0.006, 0.007, 0.009) + keyC * 0.035 * KEY_FROM.y * sh) * ao * ao;
    if (anyMetal) {
        float fres = 0.05 + 0.5 * pow(1.0 - max(-rd.y, 0.0), 5.0);
        fc += mc * fres * exp(-mirrorAt * 0.9);
    }
    // It falls away into the dark of the room.
    fc *= exp(-max(near - 1.2, 0.0) * 0.55);
    float litUp = clamp(max(max(fc.r, fc.g), fc.b) * 6.0, 0.0, 1.0);
    return vec4(fc, litUp * 0.999 + grazed);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // The size of one stored pixel: the core may keep this layer coarser than its render size.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float px = max(fw.x, fw.y) / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    // The cluster turns with the sound; a trace of drift keeps it from freezing.
    float ang = 0.55 + (vxFlow + TIME * 0.03) * mix(0.02, 0.4, turn);

    float count = floor(2.0 + clamp(crystals, 0.0, 0.999) * 6.0);
    float most = floor(mix(4.0, 13.0, steps) + 0.5);
    // The sound's level grows the terraces: more steps appear, each pit deepening toward its middle.
    float grow = mix(0.32, 1.0, sw * sw * (3.0 - 2.0 * sw));
    vec4 K = vec4(cos(ang), sin(ang), grow, most);
    // Each hit moves the film on by a fixed thickness, snapping over as the hit dies away.
    float shift = (n - pu * pu * pu) * 41.0;

    vec3 keyC = ink.rgb * (0.7 + 0.5 * sw);
    vec3 rimC = accent.rgb;
    float rimLevel = 0.06 + 1.7 * pu;

    // Camera: a long lens, looking down on the cluster.
    vec3 ro = vec3(0.0, 2.75, -4.4);
    vec3 ta = vec3(0.0, 0.52, 0.0);
    vec3 fwd = normalize(ta - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);

    // Two rays to a pixel wherever there is a crystal, so the hard edges of the steps come out clean.
    vec4 acc = vec4(0.0);
    float rays = 0.0;
    for (int i = 0; i < 2; i++) {
        vec2 o = (float(i) - 0.5) * 0.5 * px * vec2(1.0, 1.0);
        vec3 rd = normalize((p.x + o.x) * rgt + (p.y + o.y) * upv + FOCAL * fwd);
        vec4 one = view(ro, rd, px, K, count, keyC, rimC, rimLevel, shift);
        float again = one.a >= 2.0 ? 1.0 : 0.0;
        one.a -= 2.0 * again;
        acc += one;
        rays += 1.0;
        if (again < 0.5) break;
    }
    acc /= rays;
    vec3 col = acc.rgb;

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the film keeps its color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The crystals are solid; the floor is only as solid as it is lit.
        outa = clamp(acc.a, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
