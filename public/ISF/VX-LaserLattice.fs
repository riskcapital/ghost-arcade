/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A dark room full of haze. Laser emitters along the top and the sides throw hairline beams, alone or in fans of three, across the room so they cross into a lattice; each beam ends in a dot on a dark glossy floor. The sound's motion sweeps the beams slowly; each hit snaps a few of them to new angles and lights those in the accent color; the sound's level brightens the haze. With no sound the lattice rests, dim and still.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "beams", "LABEL": "Beams", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "haze", "LABEL": "Haze", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sweep", "LABEL": "Sweep", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Beams", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Beams the hit moved", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Emitters in the room (at most), each throwing one beam or a fan of three.
const int MAX_EMIT = 10;
const float FOCAL = 1.5;
// How far a beam runs if it never meets the floor.
const float REACH = 16.0;

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

// One beam seen along a view ray: (hairline core, haze glow round it).
// The view ray stops at tMax (the floor); soft widens the core, for the reflection.
vec2 beamLight(vec3 ro, vec3 rd, vec3 E, vec3 D, float len, float tMax, float px, float soft, float drift, float fadeEnd) {
    vec3 w = ro - E;
    float b = dot(rd, D);
    float d1 = dot(rd, w);
    float e1 = dot(D, w);
    // Where the view ray and the beam pass closest.
    float s = clamp((e1 - b * d1) / max(1.0 - b * b, 1e-4), 0.0, len);
    float t = clamp(dot(E + D * s - ro, rd), 0.05, tMax);
    s = clamp(dot(ro + rd * t - E, D), 0.0, len);
    float d = length(ro + rd * t - (E + D * s));
    // The core is a hairline: about a pixel wide far off, a little wider close by.
    float ds = d / t * FOCAL;
    float wc = max(0.75 * px, 0.007 / t * FOCAL) * soft;
    float core = exp(-ds * ds / (wc * wc));
    // The haze the beam lights: a tight sheath and a wide faint bloom.
    float wg = mix(0.02, 0.1, haze);
    float glow = 0.6 * exp(-d / wg) + 0.4 * wg * wg / (d * d + wg * wg);
    // The beam thins with distance from its emitter, and the haze it crosses is uneven.
    float fall = exp(-s * 0.045) * (0.72 + 0.56 * noise1(s * 0.9 + drift));
    // A beam that leaves the room, not landing on the floor, is lost in the haze before it gets there.
    fall *= mix(1.0, smoothstep(len, len - 3.0, s), fadeEnd);
    return vec2(core, glow) * fall;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    // Camera: low, at the back of the room, looking a little up.
    vec3 ro = vec3(0.0, 1.3, -7.0);
    vec3 ta = vec3(0.0, 2.1, 0.0);
    vec3 fwd = normalize(ta - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(p.x * rgt + p.y * upv + FOCAL * fwd);

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    // Beams move with the sound; a trace of drift keeps the room from freezing.
    float flow = vxFlow + TIME * 0.02;

    float count = floor(mix(6.0, float(MAX_EMIT), beams) + 0.5);
    float nSide = count >= 8.0 ? 4.0 : 2.0;
    float nTop = count - nSide;
    float spreadK = mix(0.35, 1.0, spread);
    float sweepK = mix(0.15, 1.4, sweep);

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;

    // The floor under this pixel, and the same view mirrored in it.
    float tFloor = rd.y < -1e-4 ? -ro.y / rd.y : 1e5;
    bool onFloor = tFloor < 1e4;
    vec3 P = ro + rd * tFloor;
    vec3 roM = vec3(ro.x, -ro.y, ro.z);
    vec3 rdM = vec3(rd.x, -rd.y, rd.z);
    // How much floor one pixel covers, so far-off dots do not shimmer.
    float foot = tFloor * px / (FOCAL * max(-rd.y, 0.02));

    vec3 coreSum = vec3(0.0);
    vec3 hazeSum = vec3(0.0);
    vec3 hazeSq = vec3(0.0);
    float hazeAll = 0.0;
    vec3 reflSum = vec3(0.0);
    vec3 dotSum = vec3(0.0);
    vec3 flareSum = vec3(0.0);

    for (int i = 0; i < MAX_EMIT; i++) {
        float fi = float(i);
        if (fi >= count) break;

        // Where the emitter sits: the first few on the side posts, the rest along the top.
        vec3 E;
        float side = 0.0;
        if (fi < nSide) {
            side = mod(fi, 2.0) < 0.5 ? -1.0 : 1.0;
            E = vec3(side * 4.25, fi < 2.0 ? 1.35 : 2.85, fi < 2.0 ? 0.6 : 1.6);
        } else {
            float k = fi - nSide;
            E = vec3(mix(-3.6, 3.6, (k + 0.5) / nTop), 4.45, 1.6 + 0.5 * mod(k, 2.0));
        }

        // Each emitter is re-aimed on every fourth hit, the emitters taking turns, so a hit moves a few.
        float per = 4.0;
        float off = mod(fi * 3.0 + floor(fi / 4.0), per);
        float turnN = floor((n + off) / per);
        float seed = turnN * 7.13 + fi * 31.7;
        // The beams the latest hit moved keep the accent color until the next hit, and flash with it.
        float hot = (mod(n + off, per) < 0.5 && n > 0.5) ? 1.0 : 0.0;

        float h1 = hash11(seed + 0.3);
        float h2 = hash11(seed + 1.7);
        float h3 = hash11(seed + 2.9);
        float h4 = hash11(seed + 4.3);

        // Where it aims: top emitters at the floor across the room, side emitters across to the far side.
        vec3 T;
        if (side != 0.0) {
            T = vec3(-side * (0.6 + 3.6 * h1 * spreadK), 0.0, mix(-1.5, 4.5, h2));
            if (h3 > 0.62) T = vec3(-side * 4.6, 2.2 + 2.6 * h1, mix(0.0, 4.0, h2));
        } else {
            T = vec3(-E.x * 0.55 + (h1 - 0.5) * 7.5 * spreadK, 0.0, mix(-2.0, 5.0, h2));
        }
        // The slow sweep.
        float ph = fi * 2.4 + h3 * 6.283;
        T.x += sin(flow * (0.5 + 0.4 * h4) + ph) * 1.1 * sweepK;
        T.z += cos(flow * (0.35 + 0.3 * h1) + ph * 1.7) * 0.9 * sweepK;

        // Half the emitters throw a fan of three, opened along a line on the floor.
        float fan = h4 < 0.5 ? 1.0 : 0.0;
        // The fan opens across the view, never along it, so its three beams stay apart.
        float fa = (h3 - 0.5) * 1.1;
        vec3 fanDir = vec3(cos(fa), 0.0, sin(fa)) * mix(0.5, 1.5, spread);
        if (side != 0.0) fanDir = vec3(0.0, T.y > 0.5 ? 0.8 : 0.0, T.y > 0.5 ? 0.2 : 1.6) * mix(0.5, 1.5, spread);

        vec3 tint = mix(inkC, accC, hot);
        float lvl = 0.42 + 0.58 * sw + hot * pu * 0.9;

        for (int j = 0; j < 3; j++) {
            float fj = float(j);
            if (fan < 0.5 && j > 0) break;
            vec3 Tj = T + fanDir * (fj - 1.0) * fan;
            vec3 D = normalize(Tj - E);
            // The beam runs until it meets the floor, or leaves the room.
            float toFloor = D.y < -1e-3 ? E.y / -D.y : 1e5;
            float len = min(toFloor, REACH);
            if (abs(D.x) > 1e-3) len = min(len, ((D.x > 0.0 ? 6.5 : -6.5) - E.x) / D.x);
            if (D.y > 1e-3) len = min(len, (6.0 - E.y) / D.y);
            if (D.z < -1e-3) len = min(len, (-3.0 - E.z) / D.z);
            float drift = fi * 17.0 + fj * 5.0 - flow * 0.5;
            float fadeEnd = toFloor <= len + 1e-3 ? 0.0 : 1.0;

            vec2 bl = beamLight(ro, rd, E, D, len, tFloor, px, 1.0, drift, fadeEnd);
            coreSum += tint * bl.x * lvl + vec3(1.0) * bl.x * lvl * lvl * 0.45;
            vec3 hz = tint * bl.y * lvl;
            hazeSum += hz;
            hazeSq += hz * bl.y * lvl;
            hazeAll += bl.y * lvl;

            if (onFloor) {
                // The beam mirrored in the floor, softened.
                vec2 br = beamLight(roM, rdM, E, D, len, 1e5, px, 2.2, drift, fadeEnd);
                reflSum += tint * (br.x * 0.9 + br.y * 0.25) * lvl;
                // The dot where the beam lands, and the pool of light round it.
                if (toFloor <= len + 1e-3) {
                    vec2 dP = P.xz - (E + D * len).xz;
                    float r = max(0.055, 0.8 * foot);
                    float spot = exp(-dot(dP, dP) / (r * r)) * (0.055 * 0.055) / (r * r);
                    float pool = exp(-length(dP) / 0.45);
                    dotSum += (tint * 2.6 + vec3(1.4)) * spot * lvl + tint * pool * 0.16 * lvl;
                }
            }
        }

        // The emitter's lens: a pinpoint with a small halo.
        vec3 v = E - ro;
        float ez = dot(v, fwd);
        vec2 sp = vec2(dot(v, rgt), dot(v, upv)) / ez * FOCAL;
        float dE = length(p - sp);
        float rE = max(1.1 * px, 0.028 / ez * FOCAL);
        flareSum += (tint + vec3(0.5)) * lvl * (exp(-dE * dE / (rE * rE)) + 0.22 * rE / (dE + rE) * exp(-dE / (rE * 9.0)));
    }

    // Haze: each beam's glow, thicker where it overlaps another's.
    float hazeK = (0.1 + 0.5 * haze) * (0.6 + 0.7 * sw);
    vec3 hazeLight = (hazeSum + 1.6 * max(hazeSum * hazeAll - hazeSq, 0.0) / (1.0 + 0.6 * hazeAll)) * hazeK;
    // The room's own haze, catching a little of all the light in it.
    float air = (0.006 + 0.016 * haze) * (0.5 + sw) * (0.4 + 0.6 * smoothstep(-0.2, 0.5, p.y));

    vec3 col = inkC * air;
    if (onFloor) {
        // A dark glossy floor that falls away into the room's darkness.
        float fres = 0.05 + 0.6 * pow(1.0 - max(-rd.y, 0.0), 5.0);
        vec3 fc = vec3(0.004, 0.0045, 0.006);
        fc += reflSum * fres * 0.9;
        fc += dotSum;
        fc *= exp(-max(tFloor - 9.0, 0.0) * 0.12);
        col = fc + inkC * air * 0.5;
    }
    col += coreSum * 1.5 + hazeLight + flareSum * 0.9;

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the beams keep their color, then dither against banding.
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
