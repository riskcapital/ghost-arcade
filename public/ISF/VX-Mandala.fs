/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A mandala flower: three rings of glossy pointed petals around a seed-studded heart, each ring turning its own way, set against a poster sunburst. Every hit snaps the petals wide open from the middle outwards, and every few hits the flower re-folds: it closes and blooms again with a new number of petals in each ring. Swelling sound opens it wider.",
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
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "bloom", "LABEL": "Snap", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "refold", "LABEL": "Re-fold", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3], "LABELS": ["Every hit", "Every 2 hits", "Every 4 hits", "Never"] },
        { "NAME": "turn", "LABEL": "Turn", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "petalWidth", "LABEL": "Petal width", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "rays", "LABEL": "Sunburst", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Outer petals", "TYPE": "color", "DEFAULT": [1.0, 0.25, 0.5, 1.0] },
        { "NAME": "accent", "LABEL": "Inner petals", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.2, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxBar", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen (plus 1000), clock time of the last hit, its strength,
// hits so far. A second slot would be overkill: the fold time is derived
// from the same hit.

const float TAU = 6.2831853;
const float PI = 3.14159265;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

vec3 sat3(vec3 c, float s) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(l), c, s), 0.0);
}

// Petal counts for each ring, picked per fold.
float countFor(float ring, float fold) {
    float h = hash11(fold * 1.37 + ring * 9.1 + 0.5);
    if (ring < 0.5) return 8.0 + 2.0 * floor(h * 4.0);        // 8..14
    if (ring < 1.5) return 7.0 + floor(h * 5.0);              // 7..11
    return 5.0 + floor(h * 4.0);                               // 5..8
}

// A spring that runs from 0 to 1 with a lively overshoot.
float spring(float a) {
    if (a <= 0.0) return 0.0;
    return 1.0 - exp(-a * 7.0) * cos(a * 16.0);
}

// One ring of petals. Returns coverage in .a and colour in .rgb.
vec4 petals(float r, float a0, float N, float r0, float L, float W, float rotA, vec3 tipC, vec3 baseC, float px) {
    float a = a0 - rotA;
    float sec = TAU / N;
    float ap = mod(a + 0.5 * sec, sec) - 0.5 * sec;
    vec2 q = vec2(cos(ap), sin(ap)) * r;
    float t = (q.x - r0) / max(L, 1e-4);
    // Pointed-tip almond: widest a little below the middle.
    float tt = clamp(t, 0.0, 1.0);
    float hw = W * pow(sin(PI * pow(tt, 0.8)), 0.75);
    hw = min(hw, 0.92 * abs(q.x) * tan(0.5 * sec));
    float d = (abs(q.y) - hw);
    d = max(d, -t * L);
    d = max(d, (t - 1.0) * L);
    float cov = clamp(0.5 - d / px, 0.0, 1.0);
    // Shading: base to tip gradient, a dark midrib, side light, rim line.
    float side = q.y / max(hw, 1e-4);
    vec3 c = mix(baseC, tipC, smoothstep(0.0, 0.85, tt));
    c *= 0.75 + 0.35 * clamp(0.5 - 0.5 * side, 0.0, 1.0);
    float rib = exp(-pow(q.y / (px * 1.6 + 0.08 * hw), 2.0)) * smoothstep(0.0, 0.15, tt) * (1.0 - smoothstep(0.7, 0.95, tt));
    c *= 1.0 - 0.45 * rib;
    // Fine veins fanning from the rib.
    float vein = 0.5 + 0.5 * cos((abs(q.y) * 3.0 - q.x) / max(hw + 0.01, 0.02) * 9.0);
    c *= 1.0 - 0.12 * smoothstep(0.7, 1.0, vein) * smoothstep(0.2, 0.6, abs(side));
    // Gloss on one flank.
    c += vec3(1.0) * 0.28 * exp(-pow((side + 0.45) / 0.18, 2.0)) * smoothstep(0.1, 0.4, tt) * (1.0 - smoothstep(0.6, 0.9, tt));
    // Dark rim.
    float rim = clamp(1.0 + d / (px * 2.2), 0.0, 1.0);
    c = mix(c, baseC * 0.12, rim * 0.85);
    return vec4(c, cov);
}

void main() {
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        // The count is stored offset by 1000, so an all-zero texel (a voice
        // added mid-session) reads as fresh and starts with no hit pending.
        if (c.r < 500.0) c = vec4(vxCount + 1000.0, TIME - 30.0, 0.0, 0.0);
        if (abs(vxCount + 1000.0 - c.r) > 0.5) {
            c.g = TIME;
            c.b = mix(0.55, 1.0, clamp(vxVel, 0.0, 1.0));
            c.a = mod(c.a + 1.0, 960.0);
        }
        c.r = vxCount + 1000.0;
        gl_FragColor = c;
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = TIME - clk.g;
    if (age < 0.0) age = 30.0;
    float hits = clk.a;

    // Which fold we are on, and whether this hit started a new one.
    float every = refold == 0 ? 1.0 : (refold == 1 ? 2.0 : 4.0);
    float fold = refold == 3 ? 0.0 : floor(hits / every);
    bool newFold = refold != 3 && mod(hits, every) < 0.5 && hits > 0.5;

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float sc = 0.8 + 0.45 * size;
    p /= sc;
    px /= sc;
    float t = vxPhase * 0.015 * (0.3 + turn * 1.7) + TIME * 0.02 * (0.3 + turn);

    vec3 c0 = sat3(ink.rgb, 1.15);
    vec3 c1 = sat3(accent.rgb, 1.15);
    vec3 c2 = sat3(mix(ink.rgb, accent.rgb, 0.5), 1.4);
    vec3 deep = sat3(ink.rgb * accent.rgb + 0.04, 1.5);
    deep *= 0.5 / max(max(deep.r, deep.g), max(deep.b, 0.08));

    float hitK = clk.b * bloom;
    float wid = 0.6 + 0.8 * petalWidth;

    float pr0 = length(p);
    float pa0 = atan(p.y, p.x);
    // Draw from the outer ring inwards so inner petals sit on top.
    vec3 col = vec3(0.0);
    float cover = 0.0;
    float outerEdge = 0.0;
    float n0 = 8.0;
    float rot0 = 0.0;
    for (int k = 0; k < 3; k++) {
        float ring = float(k);
        // Each ring blooms a moment after the one inside it.
        float delay = (2.0 - ring) * 0.05;
        float ag = age - delay;
        float open;
        if (newFold) {
            // Re-fold: the new petals grow out of the heart and spring open.
            open = 0.15 + 0.85 * spring(ag * 1.1);
        } else {
            open = 1.0 + 0.22 * hitK * exp(-max(ag, 0.0) * 4.0) * sin(clamp(ag, 0.0, 10.0) * 14.0 + 1.2) * step(0.0, ag);
            open += 0.18 * hitK * exp(-max(ag, 0.0) * 5.0) * step(0.0, ag);
        }
        open *= 1.0 + 0.08 * vxEnv;
        float N = countFor(ring, fold);
        float r0 = ring < 0.5 ? 0.07 : (ring < 1.5 ? 0.06 : 0.05);
        float L = (ring < 0.5 ? 0.36 : (ring < 1.5 ? 0.25 : 0.15)) * open;
        float W = (ring < 0.5 ? 0.05 : (ring < 1.5 ? 0.042 : 0.032)) * wid * mix(0.7, 1.0, clamp(open, 0.0, 1.0));
        float dir = mod(ring, 2.0) < 0.5 ? 1.0 : -1.0;
        float rotA = dir * t * (1.0 - 0.25 * ring) + ring * 0.4 + fold * 0.7;
        vec3 tip = ring < 0.5 ? c0 : (ring < 1.5 ? c2 : c1);
        vec3 base = ring < 0.5 ? deep : (ring < 1.5 ? c0 * 0.55 : c2 * 0.6);
        vec4 pe = petals(pr0, pa0, N, r0, L, W, rotA, tip, base, px);
        // A hit lights the petals from inside.
        pe.rgb += tip * 0.35 * clk.b * exp(-max(ag, 0.0) * 8.0) * step(0.0, ag);
        col = mix(col, pe.rgb, pe.a);
        cover = max(cover, pe.a);
        if (k == 0) {
            outerEdge = r0 + L;
            n0 = N;
            rot0 = rotA;
        }
    }

    // Beads strung in the gaps between the outer petal tips; they swell on hits.
    {
        float rr0 = length(p);
        float sec = TAU / n0;
        float ba0 = atan(p.y, p.x) - rot0 - 0.5 * sec;
        float bp = mod(ba0 + 0.5 * sec, sec) - 0.5 * sec;
        float rb = outerEdge * 0.86;
        vec2 bq = vec2(cos(bp) * rr0 - rb, sin(bp) * rr0);
        float bs = 0.011 * (1.0 + 0.6 * clk.b * exp(-age * 5.0) + 0.3 * vxEnv);
        float bd = length(bq);
        float bead = clamp((bs - bd) / px + 0.5, 0.0, 1.0);
        vec3 bc = mix(c1, vec3(1.0), 0.35 * smoothstep(bs, 0.0, length(bq - vec2(-0.3, 0.35) * bs)));
        bc = mix(bc, deep * 0.15, clamp(1.0 - abs(bd - bs) / (px * 1.4), 0.0, 1.0));
        col = mix(col, bc, bead);
        cover = max(cover, bead);
        // A dotted ring between the middle and inner petals' bases.
        float rd = 0.115;
        float dn = floor(TAU * rd / 0.016);
        float dang = atan(p.y, p.x) - t * 0.8;
        float dc = (fract(dang / TAU * dn) - 0.5) * TAU * rd / dn;
        float dot1 = clamp((0.0042 - length(vec2(dc, rr0 - rd))) / px + 0.5, 0.0, 1.0);
        col = mix(col, mix(c1, vec3(1.0), 0.5), dot1 * cover);
    }

    // The heart: a disc of seeds in rings, with a bright eye.
    float r = length(p);
    float hr = 0.085 * (1.0 + 0.1 * vxEnv + 0.15 * clk.b * exp(-age * 6.0));
    float hin = clamp((hr - r) / px + 0.5, 0.0, 1.0);
    float ds = 0.014;
    float ringI = floor(r / ds);
    float rc = (ringI + 0.5) * ds;
    float nd = max(floor(TAU * rc / ds * 0.9), 1.0);
    float ang = atan(p.y, p.x) + t * 1.5 + ringI * 0.6;
    float cell = fract(ang / TAU * nd) - 0.5;
    vec2 dq = vec2(cell * TAU * rc / nd, r - rc);
    float seed = clamp((0.0052 - length(dq)) / px + 0.5, 0.0, 1.0);
    vec3 heart = mix(deep * 0.6, c1 * 0.9, smoothstep(hr, 0.0, r) * 0.5);
    heart = mix(heart, mix(c1, vec3(1.0), 0.4) * (1.0 - 0.5 * r / hr), seed);
    heart = mix(heart, mix(c1, vec3(1.0), 0.6), clamp((0.018 - r) / px + 0.5, 0.0, 1.0));
    float hrim = clamp(1.0 - abs(r - hr) / (px * 1.6), 0.0, 1.0);
    heart = mix(heart, deep * 0.15, hrim);
    col = mix(col, heart, hin);
    cover = max(cover, hin);

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float glow = exp(-max(r - outerEdge * 0.7, 0.0) * 7.0) * (1.0 - cover) * (0.35 + 0.4 * vxEnv + 0.4 * clk.b * exp(-age * 3.0));

    float pres = vxPresence;
    vec4 outc;
    if (vxClear) {
        float aG = glow * 0.45;
        float a = cover + aG * (1.0 - cover);
        vec3 rgb = col * cover + c0 * aG * 0.9;
        outc = vec4(min(rgb, vec3(a)), a) * pres;
    } else {
        // Poster sunburst behind the flower.
        float ba = atan(p.y, p.x) - t * 0.3;
        float nr = 24.0;
        float ray = clamp((abs(fract(ba / TAU * nr) - 0.5) - 0.25) / (fwidth(ba / TAU * nr) + 1e-4) + 0.5, 0.0, 1.0);
        vec3 bg = mix(deep * 0.35, deep * 0.6 + c0 * 0.06, ray * rays);
        bg *= 1.0 - smoothstep(0.2, 1.1, r * sc) * 0.7;
        bg += c0 * glow * 0.6;
        outc = vec4(mix(bg, col, cover) * pres, 1.0);
    }
    gl_FragColor = outc;
}
