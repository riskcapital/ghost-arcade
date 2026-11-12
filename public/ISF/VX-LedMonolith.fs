/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A tall freestanding LED wall standing on a dark glossy floor, seen a little from the side so its thickness shows. Its face is a grid of real diodes showing bands of data: barcodes, scrolling bits, level bars and blocks, and its light spills onto the floor and shows there as a soft reflection. Each hit re-rolls one band, marked in the accent color, and pushes a wave of brightness up the wall; the sound's level lifts the whole face. With no sound the wall glows dim and its data drifts slowly.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "diodes", "LABEL": "Diodes", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0, "MAX": 1 },
        { "NAME": "turn", "LABEL": "Turn", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "reroll", "LABEL": "Re-roll", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "gloss", "LABEL": "Floor gloss", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Diodes", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Re-rolled band", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The slab, in world units: width, height and thickness. It stands on the floor (y = 0).
const vec3 SLAB = vec3(1.5, 2.9, 0.34);
const vec3 SLAB_AT = vec3(0.35, 0.0, 0.0);
// Bands of data down the face, and how far back a band looks for the hit that last re-rolled it.
const int ZONES = 6;
const int LOOKBACK = 16;
// The bezel round the diode grid, in face units.
const float BEZEL = 0.035;
const float FOCAL = 1.4;

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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// Hit m re-rolls one band for sure, and each other band by chance.
bool rerolled(float m, float b) {
    if (floor(hash11(m * 1.731 + 0.37) * float(ZONES)) == b) return true;
    return hash11(m * 13.17 + b * 3.71 + 1.9) < reroll * 0.6;
}

float bandSeed(float b, float n) {
    for (int k = 0; k < LOOKBACK; k++) {
        float m = mod(n - float(k) + 64.0, 64.0);
        if (rerolled(m, b)) return m;
    }
    return mod(n - float(LOOKBACK) + 64.0, 64.0);
}

// Which band a diode row is in: (band, first row, row count, 1), or band -1 in the gaps between.
// Rows count from the bottom; bands are laid out from the top down, one dark row between.
vec4 zoneOf(float iy, float R) {
    float total = 0.0;
    for (int k = 0; k < ZONES; k++) total += 0.55 + hash11(float(k) * 7.31 + 2.0);
    float avail = R - float(ZONES - 1);
    float r = R - 1.0 - iy;
    float top = 0.0;
    float acc = 0.0;
    for (int k = 0; k < ZONES; k++) {
        acc += 0.55 + hash11(float(k) * 7.31 + 2.0);
        float bottom = (k == ZONES - 1) ? R : floor(avail * acc / total + 0.5) + float(k);
        if (r >= top && r < bottom) return vec4(float(k), R - bottom, bottom - top, 1.0);
        top = bottom + 1.0;
    }
    return vec4(-1.0, 0.0, 1.0, 0.0);
}

// One diode: (brightness 0-1 before the wall's level, 1 if it is in the accent band).
vec2 led(vec2 ic, float C, float R, float n, float flow) {
    if (ic.x < 0.0 || ic.y < 0.0 || ic.x >= C || ic.y >= R) return vec2(0.0);
    vec4 z = zoneOf(ic.y, R);
    if (z.x < 0.0) return vec2(0.0);
    float sd = bandSeed(z.x, n);
    float kind = hash11(sd * 0.917 + z.x * 5.3 + 2.0);
    float j = ic.y - z.y;
    float on = 0.0;
    if (kind < 0.26) {
        // Barcode: bars of one or two diodes, drifting sideways a diode at a time.
        float mw = 1.0 + floor(hash11(sd + 1.0) * 1.99);
        float shift = floor(flow * (0.6 + hash11(sd + 4.0)) * 3.0) * (hash11(sd + 5.0) < 0.5 ? 1.0 : -1.0);
        float m = floor((ic.x + shift) / mw);
        float grp = floor(m / 6.0);
        float solid = hash21(vec2(grp, sd + 3.0)) < 0.18 ? 1.0 : 0.0;
        on = max(step(hash21(vec2(m, sd * 1.3 + 7.0)), 0.45), solid);
    } else if (kind < 0.52) {
        // Scrolling data: each row a stream of bits running at its own rate.
        float rate = 1.5 + 5.0 * hash11(ic.y * 3.1 + sd);
        float dir = hash11(ic.y * 1.7 + sd * 2.0) < 0.5 ? 1.0 : -1.0;
        float x = floor(ic.x + dir * flow * rate * 3.0);
        float h = hash21(vec2(x, ic.y + sd * 13.0));
        on = h < 0.36 ? 0.55 + 0.45 * hash21(vec2(x + 3.0, ic.y)) : 0.0;
    } else if (kind < 0.74) {
        // Level bars: each column a bar rising from the band's floor, its top diode brightest.
        float lv = 0.2 + 0.75 * noise1(ic.x * 0.45 + flow * 1.6 + sd * 3.0);
        lv *= 0.6 + 0.4 * clamp(vxSwell, 0.0, 1.0);
        float hgt = floor(lv * z.z + 0.5);
        on = j < hgt ? (j > hgt - 1.5 ? 1.0 : 0.6) : 0.0;
    } else if (kind < 0.88) {
        // Blocks: big pixels three diodes square.
        vec2 b = floor(vec2(ic.x + floor(flow * 1.5), j) / 3.0);
        on = hash21(b + sd * 5.0) < 0.38 ? 0.85 : 0.0;
    } else {
        // A frequency sweep: bars tightening across the band.
        float x = ic.x / C;
        on = fract(x * (3.0 + 9.0 * x) * (1.0 + hash11(sd)) - flow * 0.35) < 0.42 ? 0.9 : 0.0;
    }
    on *= 0.82 + 0.18 * hash21(ic + 0.5);
    float primary = floor(hash11(n * 1.731 + 0.37) * float(ZONES));
    float acc = (n > 0.5 && z.x == primary) ? 1.0 : 0.0;
    return vec2(on, acc);
}

// The average light of the band at height v (0-1 on the face), for spill and reflection far off.
vec2 bandGlow(float v, float R, float n) {
    vec4 z = zoneOf(clamp(floor(v * R), 0.0, R - 1.0), R);
    if (z.x < 0.0) return vec2(0.05, 0.0);
    float sd = bandSeed(z.x, n);
    float kind = hash11(sd * 0.917 + z.x * 5.3 + 2.0);
    float d = kind < 0.26 ? 0.5 : kind < 0.52 ? 0.27 : kind < 0.74 ? 0.42 : kind < 0.88 ? 0.33 : 0.38;
    float primary = floor(hash11(n * 1.731 + 0.37) * float(ZONES));
    return vec2(d, (n > 0.5 && z.x == primary) ? 1.0 : 0.0);
}

// The wall's level at height v: a rest glow, lifted by the swell; a hit pushes a wave of light up the face.
float wallLevel(float v) {
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float front = (1.0 - pu) * 1.35 - 0.2;
    float wave = exp(-pow((v - front) / 0.28, 2.0));
    return 0.34 + 0.4 * sw + pu * (0.35 + 1.1 * wave);
}

// Ray against the slab, in the slab's own space: (t, face) with face 0 front, 1 side, 2 top, or t < 0 for a miss.
vec2 hitSlab(vec3 ro, vec3 rd) {
    vec3 hs = SLAB * 0.5;
    vec3 c = vec3(0.0, hs.y, 0.0);
    vec3 inv = 1.0 / rd;
    vec3 t0 = (c - hs - ro) * inv;
    vec3 t1 = (c + hs - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), tmin.z);
    float tf = min(min(tmax.x, tmax.y), tmax.z);
    if (tf < max(tn, 0.0) || tn < 0.0) return vec2(-1.0, 0.0);
    float face = tn == tmin.z ? 0.0 : (tn == tmin.x ? 1.0 : 2.0);
    return vec2(tn, face);
}

vec2 faceUV(vec3 q) {
    return vec2((q.x + SLAB.x * 0.5 - BEZEL) / (SLAB.x - 2.0 * BEZEL), (q.y - BEZEL) / (SLAB.y - 2.0 * BEZEL));
}

vec2 ledBlur(vec2 cell, float C, float R, float n, float flow) {
    vec2 cb = cell - 0.5;
    vec2 i0 = floor(cb);
    vec2 fb = fract(cb);
    fb = fb * fb * (3.0 - 2.0 * fb);
    vec2 b00 = led(i0, C, R, n, flow);
    vec2 b10 = led(i0 + vec2(1.0, 0.0), C, R, n, flow);
    vec2 b01 = led(i0 + vec2(0.0, 1.0), C, R, n, flow);
    vec2 b11 = led(i0 + vec2(1.0, 1.0), C, R, n, flow);
    return mix(mix(b00, b10, fb.x), mix(b01, b11, fb.x), fb.y);
}

// The slab where a ray meets it. fmax is the size of a diode cell per pixel.
vec3 shadeSlab(vec3 q, float face, float fmax, float C, float R, float n, float flow) {
    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec3 col;
    if (face < 0.5) {
        // The face: a bezel round a grid of round diodes in a dark mask.
        vec2 fu = faceUV(q);
        vec2 cell = fu * vec2(C, R);
        vec2 ic = floor(cell);
        vec2 f = fract(cell) - 0.5;
        float inGrid = step(0.0, fu.x) * step(fu.x, 1.0) * step(0.0, fu.y) * step(fu.y, 1.0);
        vec2 me = led(ic, C, R, n, flow);
        float lvl = wallLevel(fu.y);
        // Round emitter, anti-aliased; when diodes get smaller than a few pixels, their average.
        float rr = length(f);
        float rad = 0.33;
        float far = smoothstep(0.3, 0.6, fmax);
        float core = smoothstep(rad + 0.75 * fmax, rad - 0.75 * fmax, rr);
        core = mix(core, 3.14159 * rad * rad, far);
        float lens = mix(exp(-rr * rr / 0.09), 0.4, far);
        // Bloom from the neighbouring diodes, interpolated between their centres.
        vec2 bl = ledBlur(cell, C, R, n, flow);
        vec3 dc = mix(inkC, accC, me.y);
        vec3 bc = mix(inkC, accC, bl.y);
        vec3 e = dc * me.x * (core * 2.2 + lens * 0.55) * lvl;
        // A hot diode whitens at its centre.
        e += vec3(1.0) * me.x * core * lvl * lvl * 0.35;
        e += bc * bl.x * (0.3 + 0.25 * lvl) * lvl;
        // Unlit diodes: a faint lens of the color, so the grid reads even where dark.
        e += dc * (1.0 - me.x) * core * 0.025;
        // Black plastic mask with a faint sheen of a soft light high on the left, on the face's cover.
        float sheen = exp(-pow((fu.x * 0.6 + fu.y * 0.8 - 0.95) / 0.18, 2.0));
        vec3 mask = vec3(0.006, 0.007, 0.009) + vec3(0.012, 0.013, 0.016) * sheen;
        col = mask + e * inGrid;
        // Bezel: dark, catching the face's light at its inner edge.
        float inner = min(min(fu.x, 1.0 - fu.x), min(fu.y, 1.0 - fu.y));
        float bz = (1.0 - inGrid) * exp(inner * 40.0);
        col += bc * bl.x * lvl * bz * 0.12;
    } else if (face < 1.5) {
        // The left side: dark brushed metal, lit by the face's light where it wraps the front edge.
        float fromFront = q.z + SLAB.z * 0.5;
        float v = q.y / SLAB.y;
        vec2 g = bandGlow(v, R, n);
        vec3 gc = mix(inkC, accC, g.y) * g.x * wallLevel(v);
        float wrap = exp(-fromFront / 0.035);
        col = vec3(0.012, 0.013, 0.016) * (0.6 + 0.4 * v);
        col += gc * wrap * 0.35;
        col += gc * 0.05 * (1.0 - v);
        col += vec3(0.03, 0.033, 0.04) * exp(-pow((fromFront / SLAB.z - 0.55) / 0.25, 2.0)) * (0.3 + 0.7 * v);
        // Its back edge catches a little of the room.
        col += vec3(0.02, 0.022, 0.028) * exp(-(SLAB.z - fromFront) / 0.02);
    } else {
        col = vec3(0.01, 0.011, 0.013) + inkC * 0.02;
    }
    return col;
}

// Everything that is not the slab: the floor with its spill and reflection, and the halo in the air.
vec3 shadeRoom(vec3 ro, vec3 rd, mat3 toLocal, mat3 toWorld, float C, float R, float n, float flow) {
    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec3 col = vec3(0.0);
    vec3 faceN = toWorld * vec3(0.0, 0.0, -1.0);
    float tFloor = rd.y < 0.0 ? -ro.y / rd.y : 1e5;
    if (tFloor < 1e4) {
        vec3 P = ro + rd * tFloor;
        vec3 fc = vec3(0.004, 0.0045, 0.006);
        // Spill: the face treated as a few soft emitters down its middle and sides.
        vec3 spill = vec3(0.0);
        for (int k = 0; k < 5; k++) {
            float fk = float(k);
            float v = k < 3 ? 0.12 + 0.3 * fk : 0.25;
            float u = k < 3 ? 0.5 : (k == 3 ? 0.12 : 0.88);
            vec3 sW = toWorld * vec3((u - 0.5) * SLAB.x, v * SLAB.y, -SLAB.z * 0.5 - 0.01) + SLAB_AT;
            vec3 L = sW - P;
            float d2 = dot(L, L);
            vec3 Ln = L * inversesqrt(d2);
            float cosE = max(dot(faceN, -Ln), 0.0);
            float cosR = max(Ln.y, 0.0);
            vec2 g = bandGlow(v, R, n);
            spill += mix(inkC, accC, g.y) * g.x * wallLevel(v) * cosE * cosR / (0.25 + d2);
        }
        fc += spill * 0.9;
        // Reflection: the mirrored ray finds the slab; near the base it is sharp, farther off it softens.
        vec3 pl = toLocal * (P - SLAB_AT);
        vec3 rl = toLocal * vec3(rd.x, -rd.y, rd.z);
        vec2 rh = hitSlab(pl, rl);
        float fres = 0.04 + 0.5 * pow(1.0 - max(-rd.y, 0.0), 5.0);
        // Polished stone: its gloss varies in broad soft patches.
        float patchy = 0.7 + 0.6 * (noise1(P.x * 1.3 + 4.0) * noise1(P.z * 1.7 + 9.0));
        float refl = mix(0.15, 0.7, gloss) * (0.3 + fres) * patchy;
        if (rh.x > 0.0) {
            vec3 q = pl + rl * rh.x;
            if (rh.y < 0.5) {
                vec2 fu = faceUV(q);
                // Ripples in the polish break the reflection up a little.
                float wob = (noise1(P.x * 9.0 + P.z * 3.0) - 0.5) * 0.02;
                vec2 bl = ledBlur(vec2(fu.x + wob, fu.y) * vec2(C, R), C, R, n, flow);
                vec2 g = bandGlow(fu.y, R, n);
                float blur = clamp(rh.x * 0.8 * (1.2 - gloss), 0.0, 1.0);
                vec2 m = mix(bl, g, blur);
                vec3 rc = mix(inkC, accC, m.y) * m.x * wallLevel(fu.y);
                float inG = step(0.0, fu.x) * step(fu.x, 1.0) * step(0.0, fu.y) * step(fu.y, 1.0);
                fc += rc * inG * refl * 1.4 * exp(-rh.x * 0.35);
            } else {
                fc *= 0.6;
            }
        }
        // Contact shadow where the floor meets the slab.
        vec2 dxz = max(abs(pl.xz) - vec2(SLAB.x * 0.5, SLAB.z * 0.5), 0.0);
        fc *= smoothstep(0.0, 0.25, length(dxz)) * 0.6 + 0.4;
        // The room falls away into darkness.
        fc *= exp(-max(tFloor - 6.0, 0.0) * 0.25);
        col = fc;
    }
    // Bloom in the air round the face: light glowing off its edges and a broad soft halo.
    vec3 roL = toLocal * (ro - SLAB_AT);
    vec3 rdL = toLocal * rd;
    float tp = (-SLAB.z * 0.5 - roL.z) / rdL.z;
    if (tp > 0.0) {
        vec3 q = roL + rdL * tp;
        vec2 fu = vec2(q.x / SLAB.x + 0.5, q.y / SLAB.y);
        float d = length(max(abs(fu - 0.5) - 0.5, 0.0) * SLAB.xy);
        // The halo is soft: the face's light averaged over a span of its height.
        vec3 gc = vec3(0.0);
        for (int k = 0; k < 3; k++) {
            float v = clamp(fu.y + (float(k) - 1.0) * 0.12, 0.0, 1.0);
            vec2 g = bandGlow(v, R, n);
            gc += mix(inkC, accC, g.y) * g.x * wallLevel(v) / 3.0;
        }
        col += gc * (exp(-d / 0.06) * 0.14 + exp(-d / 0.5) * 0.07);
    }
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    // Camera: standing back and a little to the left, looking slightly up at the slab.
    vec3 ro = vec3(-1.0, 0.85, -6.4);
    vec3 ta = vec3(0.1, 1.3, 0.0);
    vec3 fwd = normalize(ta - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(p.x * rgt + p.y * upv + FOCAL * fwd);

    // The slab turns on its base so its left side shows.
    float ang = -mix(0.2, 0.95, turn);
    float ca = cos(ang);
    float sa = sin(ang);
    mat3 toLocal = mat3(ca, 0.0, sa, 0.0, 1.0, 0.0, -sa, 0.0, ca);
    mat3 toWorld = mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca);
    vec3 roL = toLocal * (ro - SLAB_AT);

    float R = floor(mix(40.0, 110.0, diodes));
    float C = floor(R * (SLAB.x - 2.0 * BEZEL) / (SLAB.y - 2.0 * BEZEL) + 0.5);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow;

    // Diode size on screen, from the face plane (computed for every pixel so derivatives are sound).
    vec3 rdL = toLocal * rd;
    float tpl = (-SLAB.z * 0.5 - roL.z) / rdL.z;
    vec2 cellP = faceUV(roL + rdL * tpl) * vec2(C, R);
    vec2 fwc = fwidth(cellP);
    float fmax = clamp(max(fwc.x, fwc.y), 1e-4, 4.0);

    // The slab's outline is anti-aliased with four sub-pixel rays.
    float cov = 0.0;
    vec2 hIn = vec2(-1.0, 0.0);
    vec3 rdIn = rd;
    vec3 rdOut = rd;
    for (int k = 0; k < 4; k++) {
        vec2 o = (vec2(mod(float(k), 2.0), floor(float(k) / 2.0)) - 0.5) * 0.5 * px;
        vec3 rk = normalize((p.x + o.x) * rgt + (p.y + o.y) * upv + FOCAL * fwd);
        vec2 hk = hitSlab(roL, toLocal * rk);
        if (hk.x > 0.0) {
            cov += 0.25;
            if (hIn.x < 0.0) {
                hIn = hk;
                rdIn = rk;
            }
        } else {
            rdOut = rk;
        }
    }
    vec2 hc = hitSlab(roL, rdL);
    if (hc.x > 0.0) {
        hIn = hc;
        rdIn = rd;
    }

    vec3 col = vec3(0.0);
    if (cov > 0.0) {
        vec3 q = roL + (toLocal * rdIn) * hIn.x;
        col += shadeSlab(q, hIn.y, fmax, C, R, n, flow) * cov;
    }
    if (cov < 1.0) {
        col += shadeRoom(ro, hc.x > 0.0 ? rdOut : rd, toLocal, toWorld, C, R, n, flow) * (1.0 - cov);
    }

    // Tone map on luminance so bright diodes keep their color, then a little dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The slab is solid; the floor's light and the halo are only as solid as they are bright.
        float lt = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        outa = cov + (1.0 - cov) * lt;
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
