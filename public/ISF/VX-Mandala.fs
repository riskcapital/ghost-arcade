/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A mandala flower: three rings of glossy pointed petals around a seed-studded heart, each ring turning its own way, set against a poster sunburst. The music turns the rings faster as it rises; every hit pushes the petals wider, inner ring first, and lets them settle; every few hits the flower re-folds: the old petals draw back into the heart as new ones, in new numbers, grow out over them. Swelling sound opens it wider and lights it up.",
    "PASSES": [
        {
            "TARGET": "ease",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 2,
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
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// ease (2x1): left texel, the pulse eased once more (quick and slow) and the
// swell, and the hit count's glide eased (a), so the shapes they move glide rather than jump; right texel, the clock
// time of the last step (a redraw at the same time does not step).

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
        vec4 tk = IMG_NORM_PIXEL(ease, vec2(0.75, 0.5));
        float dt = clamp(TIME - tk.x, 0.0, 0.1);
        if (gl_FragCoord.x > 1.0) {
            gl_FragColor = vec4(TIME, dt, 0.0, 0.0);
            return;
        }
        vec4 e = IMG_NORM_PIXEL(ease, vec2(0.25, 0.5));
        e.x += (vxPulse - e.x) * (1.0 - exp(-dt / 0.15));
        e.y += (vxSwell - e.y) * (1.0 - exp(-dt / 0.2));
        e.z += (vxPulse - e.z) * (1.0 - exp(-dt / 0.3));
        // The hit count's glide, eased again (wrapping 64 -> 0 the short way), so a re-fold takes its time.
        float dm = vxMorph - e.w;
        dm -= 64.0 * floor(dm / 64.0 + 0.5);
        e.w = mod(e.w + dm * (1.0 - exp(-dt / 0.35)), 64.0);
        gl_FragColor = vec4(clamp(e.xyz, 0.0, 1.0), e.w);
        return;
    }
    vec4 ez = IMG_NORM_PIXEL(ease, vec2(0.25, 0.5));
    // Eased once more: push (pulse, quick), sw (swell), slow (pulse, lingering).
    float push = ez.x;
    float sw = ez.y;
    float slow = ez.z;
    // Re-folding rides the hit count's glide: as the count glides across a fold
    // boundary (every 1st, 2nd or 4th hit) the old petals draw back into the heart
    // while the new ones, in new numbers and at a new angle, grow out over them.
    float m = ez.w;
    float every = refold == 0 ? 1.0 : (refold == 1 ? 2.0 : 4.0);
    float folds = 64.0 / every;
    float bnd = every * floor((m - 0.5) / every + 0.5) + 0.5;
    float foldNew = mod(floor((bnd - 0.5) / every) + 1.0, folds);
    float foldOld = mod(foldNew - 1.0 + folds, folds);
    float wNew = refold == 3 ? 1.0 : smoothstep(-0.5, 0.5, m - bnd);
    if (refold == 3) foldNew = 0.0;
    float fold = wNew > 0.5 ? foldNew : foldOld;

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float sc = 0.8 + 0.45 * size;
    p /= sc;
    px /= sc;
    float t = vxFlow * (0.06 + 0.3 * turn);

    vec3 c0 = sat3(ink.rgb, 1.15);
    vec3 c1 = sat3(accent.rgb, 1.15);
    vec3 c2 = sat3(mix(ink.rgb, accent.rgb, 0.5), 1.4);
    vec3 deep = sat3(ink.rgb * accent.rgb + 0.04, 1.5);
    deep *= 0.5 / max(max(deep.r, deep.g), max(deep.b, 0.08));

    float wid = 0.6 + 0.8 * petalWidth;

    float pr0 = length(p);
    float pa0 = atan(p.y, p.x);
    // Draw from the outer ring inwards so inner petals sit on top.
    vec3 col = vec3(0.0);
    float cover = 0.0;
    float outerEdge = 0.0;
    // The bead ring keeps its own count and turns on its own, so re-folds never cut it.
    float n0 = 16.0;
    float rot0 = -t * 0.6;
    for (int k = 0; k < 3; k++) {
        float ring = float(k);
        // Hits push the petals wider: the inner ring at once, the outer ring lingering.
        float pk = mix(slow, push, ring * 0.5);
        float open = 1.0 + bloom * (0.2 * pk + 0.15 * vxPulse * (ring * 0.5)) + 0.1 * sw;
        // Each ring hands over a touch after the one inside it.
        float wk = refold == 3 ? 1.0 : smoothstep(-0.5, 0.5, m - bnd - (2.0 - ring) * 0.08);
        float r0 = ring < 0.5 ? 0.07 : (ring < 1.5 ? 0.06 : 0.05);
        float dir = mod(ring, 2.0) < 0.5 ? 1.0 : -1.0;
        vec3 tip = ring < 0.5 ? c0 : (ring < 1.5 ? c2 : c1);
        vec3 base = ring < 0.5 ? deep : (ring < 1.5 ? c0 * 0.55 : c2 * 0.6);
        for (int j = 0; j < 2; j++) {
            // j = 0: the outgoing petals, j = 1: the incoming ones (drawn on top).
            float wj = j == 0 ? 1.0 - wk : wk;
            if (wj < 0.002) continue;
            float fj = j == 0 ? foldOld : foldNew;
            // The new petals grow out first; only then do the old ones draw back,
            // so the flower never thins out mid-change.
            float grow = j == 0 ? 1.0 - smoothstep(0.4, 1.0, wk) : smoothstep(0.0, 0.6, wk);
            float oj = open * mix(0.12, 1.0, grow);
            float N = countFor(ring, fj);
            float L = (ring < 0.5 ? 0.36 : (ring < 1.5 ? 0.25 : 0.15)) * oj;
            float W = (ring < 0.5 ? 0.05 : (ring < 1.5 ? 0.042 : 0.032)) * wid * mix(0.55, 1.0, clamp(oj, 0.0, 1.0));
            float rotA = dir * t * (1.0 - 0.25 * ring) + ring * 0.4 + fj * 0.7;
            vec4 pe = petals(pr0, pa0, N, r0, L, W, rotA, tip, base, px);
            // A hit lights the petals from inside.
            pe.rgb += tip * 0.35 * vxPulse * bloom;
            col = mix(col, pe.rgb, pe.a);
            cover = max(cover, pe.a);
            if (k == 0) outerEdge = max(outerEdge, r0 + L);
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
        float bs = 0.011 * (1.0 + 0.6 * push + 0.3 * sw);
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
    float hr = 0.085 * (1.0 + 0.1 * sw + 0.12 * push);
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
    float glow = exp(-max(r - outerEdge * 0.7, 0.0) * 7.0) * (1.0 - cover) * (0.35 + 0.4 * sw + 0.4 * push);

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
