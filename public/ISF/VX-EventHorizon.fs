/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A black hole: a perfectly black shadow ringed by a razor-thin photon ring, its blazing accretion disk swirling round it with the far side bent up and over the top by gravity. The side spinning toward you burns brighter and bluer. The music sets how fast the gas swirls; louder sound feeds the disk hotter, and each hit sends a surge of light spiralling in through the disk, brightens the ring and blows twin jets out of the poles that fade as the surge dies. With a transparent background the hole and its disk are a solid cut-out.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "jets", "LABEL": "Jets", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "heat", "LABEL": "Heat", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "Tilt", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.25, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Near side", "TYPE": "color", "DEFAULT": [0.5, 0.75, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Far side", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.15, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;
// Disk inner and outer radius, in shadow radii.
const float R_IN = 1.55;
const float R_OUT = 5.2;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm3(vec2 x) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        v += amp * noise2(x);
        x = mat2(1.6, 1.2, -1.2, 1.6) * x + 1.7;
        amp *= 0.5;
    }
    return v;
}

float stars(vec2 p, float cells) {
    vec2 g = p * cells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id);
    vec2 o = vec2(hash21(id + 7.1), hash21(id + 3.7)) - 0.5;
    float d = length(f - o * 0.7);
    return step(0.85, h) * smoothstep(0.09, 0.0, d) * (0.3 + 0.7 * hash21(id + 1.3));
}

// Disk light at radius r (shadow radii) and a seam-free position xy on the disk.
// Returns emission strength (before colour).
float diskLight(float r, vec2 xy, float t) {
    float inside = smoothstep(R_IN - 0.08, R_IN + 0.25, r) * smoothstep(R_OUT, R_OUT - 1.6, r);
    if (inside <= 0.0) {
        return 0.0;
    }
    // Keplerian swirl (inner gas turns faster). The shear is cross-faded between
    // two staggered cycles so the gas swirls for ever without winding up into
    // ever finer (flickering) streaks.
    float kep = 1.0 / pow(r, 1.5);
    float tex = 0.0;
    for (int i = 0; i < 2; i++) {
        float ph = fract(t * 0.35 + 0.5 * float(i));
        float w = 1.0 - abs(2.0 * ph - 1.0);
        float om = t * 0.9 + (ph - 0.5) * 3.2 * kep + float(i) * 1.7;
        float c = cos(om);
        float s = sin(om);
        vec2 q = mat2(c, s, -s, c) * xy;
        float warp = fbm3(q * 1.1);
        float bands = 0.5 + 0.5 * sin(r * 6.0 + warp * 11.0);
        float grain = fbm3(q * 3.0 + 4.0);
        tex += w * (0.45 + 0.55 * bands) * (0.4 + 1.1 * grain);
    }
    float prof = pow(R_IN / r, 1.9);
    return inside * prof * tex;
}

void main() {
    vec2 res = RENDERSIZE;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    p.y += 0.02;
    float rs = 0.2 * size;
    float t = vxFlow * 0.2 * (0.4 + 1.6 * spin);

    float rho = length(p) / rs;
    float th = atan(p.y, p.x);
    float k = mix(0.07, 0.42, tilt);

    float feed = clamp(vxSwell * 0.8 + vxEnergy * 0.2, 0.0, 1.0);
    float pls = clamp(vxPulse, 0.0, 1.0);
    float hitK = pls * pls * (3.0 - 2.0 * pls);
    float bright = (1.0 + 1.6 * heat) * (1.0 + feed * 0.8 + hitK * 0.9);

    vec3 hot = vec3(1.0, 0.93, 0.82);
    vec3 nearC = mix(hot, ink.rgb, 0.7);
    vec3 farC = mix(hot, accent.rgb, 0.85);

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // --- Disk seen directly (the plane through the hole) ---
    vec2 dd = vec2(p.x, p.y / k) / rs;
    float dr = length(dd);
    float dl = diskLight(dr, dd, t);
    // Bright waves of gas spiral inward toward the hole; the pulse lights them.
    float rip = 0.0;
    for (int k = 0; k < 2; k++) {
        float fk = fract(t * 0.45 + 0.5 * float(k));
        float rk = R_OUT - fk * (R_OUT - R_IN);
        rip += exp(-pow((dr - rk) / 0.35, 2.0)) * smoothstep(0.0, 0.2, fk) * smoothstep(1.0, 0.75, fk);
    }
    dl *= 1.0 + rip * (0.5 * feed + 2.2 * hitK);
    // Doppler: the left side swings toward us.
    float dop = clamp(-dd.x / max(dr, 0.001), -1.0, 1.0);
    vec3 dcol = mix(farC, nearC, 0.5 + 0.5 * dop) * (1.0 + 0.75 * dop);
    vec3 diskC = dcol * dl * bright;
    float diskA = clamp(dl * 3.2 * (1.0 + feed) * (0.8 + 0.4 * dop), 0.0, 1.0);
    bool front = p.y < 0.0;

    // --- Lensed image of the far side, bent up over the top and under the bottom ---
    float up = sin(th);
    float topW = mix(0.55, 1.15, tilt * 0.5 + 0.5) * (0.35 + 0.65 * abs(up));
    topW *= up > 0.0 ? 1.0 : 0.55;
    float u = (rho - 1.06) / topW;
    float halo = 0.0;
    vec2 hxy = vec2(0.0);
    if (u > 0.0 && u < 1.2) {
        float hr = R_IN + u * (R_OUT - R_IN) * 0.75;
        hxy = vec2(cos(th), sin(th)) * hr;
        halo = diskLight(hr, vec2(hxy.x, -abs(hxy.y)), t) * smoothstep(1.2, 0.6, u);
        halo *= up > 0.0 ? 1.0 : 0.7;
    }
    float hdop = clamp(-cos(th), -1.0, 1.0);
    vec3 haloC = mix(farC, nearC, 0.5 + 0.5 * hdop) * (1.0 + 0.6 * hdop) * halo * bright;
    float haloA = clamp(halo * 4.5, 0.0, 1.0);

    // Back half of the direct disk, then the lensed halo over it.
    if (!front) {
        col = diskC;
        alpha = diskA;
    }
    col = haloC + col * (1.0 - haloA);
    alpha = haloA + alpha * (1.0 - haloA);

    // --- Shadow: solid black. ---
    float shadow = smoothstep(1.0, 0.97, rho);
    col *= 1.0 - shadow;
    alpha = shadow + alpha * (1.0 - shadow);

    // --- Photon ring ---
    float ringW = 0.022 + 0.03 * hitK + 0.012 * feed;
    float ring = exp(-pow((rho - 1.02) / ringW, 2.0)) + 0.25 * exp(-pow((rho - 1.02) / (ringW * 5.0), 2.0));
    float rdop = 1.0 + 0.5 * hdop;
    vec3 ringC = mix(hot, nearC, 0.3) * ring * (0.9 + 2.4 * hitK + 0.8 * feed) * rdop;
    col += ringC;
    alpha = max(alpha, clamp(ring * 1.4, 0.0, 1.0));

    // --- Jets from the poles on hits ---
    float jy = abs(p.y) / rs;
    float jw = 0.07 + 0.05 * jy;
    float jcore = exp(-pow(p.x / rs / jw, 2.0));
    // The jets reach further the longer the sound swells.
    float jlen = smoothstep(0.9, 1.4, jy) * exp(-jy * (0.3 - 0.12 * feed - 0.12 * hitK));
    float jKnots = 0.6 + 0.4 * sin(jy * 3.0 - t * 30.0);
    float jet = jcore * jlen * jKnots * jets * (hitK * 2.6 + feed * 0.9);
    vec3 jetC = mix(nearC, vec3(1.0), 0.4) * jet;
    col += jetC * (1.0 - shadow);
    alpha = max(alpha, clamp(jet * 1.2, 0.0, 1.0) * (1.0 - shadow) + shadow);

    // --- Front half of the disk passes in front of the shadow. ---
    if (front) {
        col = diskC + col * (1.0 - diskA);
        alpha = diskA + alpha * (1.0 - diskA);
    }

    // Soft glow around the disk so it sits in space.
    float glow = exp(-dr * 0.55) * 0.08 * bright * smoothstep(0.95, 1.4, rho);
    col += farC * glow;
    alpha = max(alpha, clamp(glow * 2.0, 0.0, 1.0));

    // Tone map on luminance so bright gas keeps its colour.
    float lumc = max(max(col.r, col.g), col.b);
    col = col / max(lumc, 1e-4) * (1.0 - exp(-lumc * 1.4));
    col = mix(col, vec3(max(max(col.r, col.g), col.b)), smoothstep(0.85, 1.0, lumc * 0.5));

    vec3 outc;
    float outa;
    if (vxClear) {
        // Glowing gas is only as solid as it is bright; the shadow stays fully solid.
        float glowCap = clamp(max(max(col.r, col.g), col.b) * 2.6, 0.0, 1.0);
        outa = clamp(min(alpha, max(shadow, glowCap)), 0.0, 1.0);
        outc = min(col, vec3(outa));
    } else {
        // Stars behind, bent around the hole.
        vec2 lp = p - normalize(p) * rs * rs * 1.6 / max(length(p), 1e-3);
        vec3 bg = vec3(0.003, 0.004, 0.01);
        float st = stars(lp + 3.0, 55.0) + 0.6 * stars(lp * 1.6 + 9.0, 55.0);
        bg += vec3(0.85, 0.9, 1.0) * st * 0.7;
        outc = col + bg * (1.0 - clamp(alpha, 0.0, 1.0));
        outa = 1.0;
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
