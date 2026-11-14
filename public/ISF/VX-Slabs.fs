/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A hard-edge construction of interlocking flat slabs and bars in saturated color, held together by black structure lines and casting soft shadows onto the ground, seen slightly from above so each slab shows its thickness. Each new chord slides some of the slabs to a new arrangement over about a beat, and the whole construction shifts to stay balanced. The sound's swell brings up the light and lifts the slabs off the ground, each sounding note lifts one of the smaller pieces, and with no sound it rests dim and still.",
    "PASSES": [
        {
            "TARGET": "plan",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 168,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "pieces", "LABEL": "Pieces", "TYPE": "float", "DEFAULT": 7, "MIN": 4, "MAX": 7 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "depth", "LABEL": "Depth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "lines", "LABEL": "Lines", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "First slab", "TYPE": "color", "DEFAULT": [0.86, 0.16, 0.1, 1.0] },
        { "NAME": "accent", "LABEL": "Second slab", "TYPE": "color", "DEFAULT": [0.1, 0.26, 0.82, 1.0] },
        { "NAME": "palGround", "LABEL": "Ground", "TYPE": "color", "DEFAULT": [0.07, 0.075, 0.09, 1.0] },
        { "NAME": "palBody", "LABEL": "Main plate", "TYPE": "color", "DEFAULT": [0.95, 0.7, 0.12, 1.0] },
        { "NAME": "palAccent", "LABEL": "Third slab", "TYPE": "color", "DEFAULT": [0.08, 0.52, 0.42, 1.0] },
        { "NAME": "palLight", "LABEL": "Pale slab", "TYPE": "color", "DEFAULT": [0.93, 0.9, 0.84, 1.0] },
        { "NAME": "palShadow", "LABEL": "Structure lines", "TYPE": "color", "DEFAULT": [0.015, 0.015, 0.02, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The plan table, eight texels per slot: slots 0-6 hold each slab's rectangle
// (center x, center y, half width, half height), slots 7-13 its height above the
// ground, slots 14-20 its color. Slab 0 is the lowest, slab 6 the highest.
const float SLOTS = 21.0;

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

// Does slab i slide at step m? One slab always does; the others by chance, the big plate rarely.
bool moves(float i, float m) {
    if (floor(hash11(m * 1.731 + 0.37) * 6.0) + 1.0 == i) return true;
    return hash21(vec2(m * 1.37 + 0.5, i * 3.1 + 2.0)) < (i < 0.5 ? 0.18 : 0.38);
}

// The step at which slab i last slid, at or before step m.
float seedOf(float i, float m) {
    for (int k = 0; k < 16; k++) {
        float mm = m - float(k);
        if (moves(i, mm)) return mm;
    }
    return m - 16.0;
}

vec4 plateAt(float m) {
    float sd = seedOf(0.0, m);
    float a = hash21(vec2(sd, 1.3));
    float b = hash21(vec2(sd, 2.7));
    float c = hash21(vec2(sd, 4.1));
    float d = hash21(vec2(sd, 5.9));
    return vec4((a - 0.5) * 0.3, (b - 0.5) * 0.14, mix(0.34, 0.5, c), mix(0.2, 0.29, d));
}

// Slab i's rectangle at step m, before balancing. Each piece has a role and is
// placed against the main plate: bars cross it, blocks straddle its corners.
vec4 slabAt(float i, float m) {
    vec4 pl = plateAt(m);
    if (i < 0.5) return pl;
    float sd = seedOf(i, m);
    float a = hash21(vec2(sd + i * 17.0, 1.1));
    float b = hash21(vec2(sd + i * 17.0, 2.3));
    float c = hash21(vec2(sd + i * 17.0, 3.7));
    float d = hash21(vec2(sd + i * 17.0, 4.9));
    float sx = a < 0.5 ? -1.0 : 1.0;
    float sy = b < 0.5 ? -1.0 : 1.0;
    if (i < 1.5) {
        // A medium block over one corner of the plate.
        return vec4(pl.x + sx * pl.z * mix(0.55, 1.0, c), pl.y + sy * pl.w * mix(0.55, 1.0, d), mix(0.12, 0.22, c), mix(0.08, 0.14, d));
    }
    if (i < 2.5) {
        // A square block inside the plate.
        float s = mix(0.07, 0.12, c);
        return vec4(pl.x + (a - 0.5) * pl.z * 1.3, pl.y + (b - 0.5) * pl.w * 1.3, s * mix(0.9, 1.3, d), s);
    }
    if (i < 3.5) {
        // A long horizontal bar across the plate.
        return vec4(pl.x + (a - 0.5) * 0.35, pl.y + sy * pl.w * mix(0.15, 0.95, c), mix(0.4, 0.6, d), mix(0.022, 0.04, c));
    }
    if (i < 4.5) {
        // A tall vertical bar standing across it.
        return vec4(pl.x + sx * pl.z * mix(0.25, 0.95, c), pl.y + (b - 0.5) * 0.14, mix(0.026, 0.045, d), mix(0.28, 0.4, c));
    }
    if (i < 5.5) {
        // A small square.
        float s = mix(0.03, 0.05, c);
        return vec4(pl.x + (a - 0.5) * pl.z * 1.8, pl.y + (b - 0.5) * pl.w * 1.8, s, s);
    }
    // A thin vertical bar off the plate's edge.
    return vec4(pl.x + sx * pl.z * mix(0.6, 1.1, c), pl.y + (b - 0.5) * 0.18, mix(0.008, 0.014, d), mix(0.12, 0.25, c));
}

// Palette index of slab i at step m; no piece ever shares the main plate's color.
float colorIndex(float i, float m) {
    float pl = hash11(seedOf(0.0, m) * 3.3 + 0.7) < 0.7 ? 0.0 : 1.0;
    if (i < 0.5) return pl;
    float sd = seedOf(i, m);
    return mod(pl + 1.0 + mod(floor(hash11(sd * 2.9 + i * 5.1) * 4.0) + i, 4.0), 5.0);
}

vec3 paletteAt(float k) {
    if (k < 0.5) return palBody.rgb;
    if (k < 1.5) return ink.rgb;
    if (k < 2.5) return accent.rgb;
    if (k < 3.5) return palAccent.rgb;
    return palLight.rgb;
}

// Slab i at step m with the whole construction shifted so it balances on the center
// and stays inside the frame.
vec4 balancedAt(float i, float m, float np, float sc, float asp) {
    vec3 acc = vec3(0.0);
    vec4 lo = vec4(1e5);
    for (int k = 0; k < 7; k++) {
        float fk = float(k);
        if (fk < np) {
            vec4 r = slabAt(fk, m) * sc;
            float w = r.z * r.w + 0.002;
            acc += vec3(r.xy * w, w);
            lo = min(lo, vec4(r.x - r.z, r.y - r.w, -(r.x + r.z), -(r.y + r.w)));
        }
    }
    vec2 shift = -acc.xy / acc.z * 0.9;
    // Keep the bounding box inside the frame with a margin.
    vec2 lim = vec2(0.5 * asp - 0.06, 0.44);
    vec2 bmin = vec2(lo.x, lo.y) + shift;
    vec2 bmax = vec2(-lo.z, -lo.w) + shift;
    shift += max(-lim - bmin, vec2(0.0)) - max(bmax - lim, vec2(0.0));
    vec4 r = slabAt(i, m) * sc;
    return vec4(r.xy + shift, r.zw);
}

float noteE(float k) {
    if (k < 0.5) return vxNoteE0;
    if (k < 1.5) return vxNoteE1;
    if (k < 2.5) return vxNoteE2;
    return vxNoteE3;
}

float sdBox(vec2 q, vec2 h) {
    vec2 d = abs(q) - h;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    float np = clamp(floor(pieces + 0.5), 4.0, 7.0);
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);

    if (PASSINDEX == 0) {
        // Rebuilt every frame from the morph, so a cold start lands on the right picture.
        float slot = floor(gl_FragCoord.x / 8.0);
        float i = mod(slot, 7.0);
        float kind = floor(slot / 7.0);
        float m = max(vxMorph, 0.0);
        float m0 = floor(m);
        float t = smoothstep(0.0, 1.0, m - m0);
        float sc = mix(0.8, 1.35, clamp(size, 0.0, 1.0)) * min(1.0, asp / 1.5);
        vec4 o;
        if (kind < 0.5) {
            o = mix(balancedAt(i, m0, np, sc, asp), balancedAt(i, m0 + 1.0, np, sc, asp), t);
        } else if (kind < 1.5) {
            // Height: stacked by order, lifted by the swell and the hit, the small
            // pieces each lifted by one sounding note.
            float z = (0.012 + 0.011 * i) * (0.7 + 0.6 * sw) + 0.01 * pu * i / 6.0;
            float note = i < 0.5 ? -1.0 : (i < 1.5 ? 0.0 : (i < 2.5 ? 1.0 : (i < 4.5 ? -1.0 : (i < 5.5 ? 2.0 : 3.0))));
            if (note > -0.5) z += 0.035 * clamp(noteE(note), 0.0, 1.0);
            o = vec4(z, 0.0, 0.0, 1.0);
        } else {
            // Colors change over the middle of the slide, so they pass quickly through the mix.
            vec3 c = mix(paletteAt(colorIndex(i, m0)), paletteAt(colorIndex(i, m0 + 1.0)), smoothstep(0.3, 0.7, t));
            o = vec4(c, 1.0);
        }
        gl_FragColor = o;
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;
    float dep = clamp(depth, 0.0, 1.0);
    // The sides of each slab fall away down and to the right; the light comes from the upper left.
    vec2 ext = vec2(0.62, -0.78) * mix(0.006, 0.03, dep);
    vec2 sdir = normalize(vec2(0.62, -0.78)) * mix(0.5, 1.6, dep);
    vec2 n1 = normalize(vec2(-ext.y, ext.x));
    float lw = lines * 0.0034;
    float light = mix(0.22, 1.0, sw);

    // The ground: the room's color under a broad pool of light from the upper left.
    vec2 gq = (p - vec2(-0.35 * asp, 0.3)) / vec2(1.3 * asp, 1.1);
    vec3 ground = palGround.rgb * (0.4 + 0.6 * exp(-dot(gq, gq) * 2.0)) * mix(0.55, 1.0, sw);

    // Soft shadows on the ground from every slab.
    float gshade = 0.0;
    for (int j = 0; j < 7; j++) {
        float fj = float(j);
        if (fj < np) {
            vec4 r = IMG_NORM_PIXEL(plan, vec2((fj + 0.5) / SLOTS, 0.5));
            float z = IMG_NORM_PIXEL(plan, vec2((fj + 7.5) / SLOTS, 0.5)).x;
            float soft = 0.004 + z * 0.5;
            float d = sdBox(p - r.xy - sdir * z - ext * 0.5, r.zw + abs(ext) * 0.5);
            gshade = max(gshade, (1.0 - smoothstep(-soft, soft, d)) * 0.75);
        }
    }
    vec3 col = mix(ground, palShadow.rgb, gshade * 0.85);
    float alpha = gshade * 0.6;
    vec3 solidCol = vec3(0.0);
    float solidA = 0.0;

    // The slabs, lowest first, each shaded, shadowed by the ones above, and outlined.
    for (int k = 0; k < 7; k++) {
        float fi = float(k);
        if (fi < np) {
            vec4 r = IMG_NORM_PIXEL(plan, vec2((fi + 0.5) / SLOTS, 0.5));
            float z = IMG_NORM_PIXEL(plan, vec2((fi + 7.5) / SLOTS, 0.5)).x;
            vec3 base = IMG_NORM_PIXEL(plan, vec2((fi + 14.5) / SLOTS, 0.5)).rgb;
            float x0 = r.x - r.z;
            float x1 = r.x + r.z;
            float y0 = r.y - r.w;
            float y1 = r.y + r.w;
            // The slab's outline from above: its top face swept along its thickness.
            float dh = max(max(x0 - p.x, p.y - y1), max(p.x - (x1 + ext.x), (y0 + ext.y) - p.y));
            dh = max(dh, max(dot(p - vec2(x1, y1), n1), dot(p - vec2(x0, y0), -n1)));
            float cov = 1.0 - smoothstep(-px, px, dh - lw);
            if (cov > 0.0) {
                float dTop = sdBox(p - r.xy, r.zw);
                float onTop = 1.0 - smoothstep(-px, px, dTop);
                // Right side or front side of the thickness, split along the corner.
                float sideS = ext.x * (p.y - y0) - ext.y * (p.x - x1);
                float onRight = smoothstep(-px, px, sideS / length(ext));
                // Top face: flat color with the faintest falloff of the light across it.
                vec2 fq = (p - vec2(x0, y1)) / max(vec2(2.0 * r.z, 2.0 * r.w), vec2(0.01));
                float fall = 1.04 - 0.08 * clamp(fq.x - fq.y, 0.0, 1.0) * 0.5;
                vec3 top = base * fall;
                vec3 side = mix(base * 0.55, base * 0.3, onRight);
                vec3 c = mix(side, top, onTop) * light;
                // Shadows of the higher slabs falling on this one.
                float sh = 0.0;
                for (int j = 1; j < 7; j++) {
                    float fj = float(j);
                    if (fj > fi && fj < np) {
                        vec4 rj = IMG_NORM_PIXEL(plan, vec2((fj + 0.5) / SLOTS, 0.5));
                        float zj = IMG_NORM_PIXEL(plan, vec2((fj + 7.5) / SLOTS, 0.5)).x;
                        float dz = max(zj - z, 0.004);
                        float soft = 0.003 + dz * 0.45;
                        float d = sdBox(p - rj.xy - sdir * dz - ext * 0.5, rj.zw + abs(ext) * 0.5);
                        sh = max(sh, 1.0 - smoothstep(-soft, soft, d));
                    }
                }
                c *= 1.0 - 0.62 * sh;
                // Black structure lines on every edge: the outline, the top face's rim and the corner.
                vec2 cq = p - vec2(x1, y0);
                float tq = clamp(dot(cq, ext) / dot(ext, ext), 0.0, 1.0);
                float dLine = min(min(abs(dh), abs(dTop)), length(cq - ext * tq));
                float ln = (1.0 - smoothstep(lw - px, lw + px, dLine)) * step(0.0005, lw);
                c = mix(c, palShadow.rgb, ln);
                col = mix(col, c, cov);
                solidCol = mix(solidCol, c, cov);
                solidA = mix(solidA, 1.0, cov);
                alpha = mix(alpha, 1.0, cov);
            }
        }
    }

    // Tone map on luminance so saturated color keeps its hue, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 2.2)) / (1.0 - exp(-2.2));
    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Slabs are solid; the ground is gone and their shadows darken what lies under them.
        vec3 sc2 = solidCol / max(solidA, 1e-4);
        float sl = max(max(sc2.r, sc2.g), sc2.b);
        sc2 = sc2 / max(sl, 1e-4) * (1.0 - exp(-sl * 2.2)) / (1.0 - exp(-2.2));
        outa = alpha;
        outc = sc2 * solidA;
    }
    outc += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0 * outa;
    outc = clamp(outc, vec3(0.0), vec3(outa));
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
