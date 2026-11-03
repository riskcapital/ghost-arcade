/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A picture taken apart into its bits. The voice paints a soft glowing form of orbs and rings, stores it in eight bits and splits it into its eight bit planes, from the big bold shapes of the top bit down to the fine contour lines of the lowest. Every hit of the sound it follows pulls the planes apart into separate sheets, stacked in depth like cards, fanned out sideways, slid off register or laid out side by side, which flicker and drop out, then snap back one by one, coarse to fine, until the picture reads whole again. Between hits one plane at a time drifts loose. Pixel size sets the grid; Spread sets how far the planes fly; Dropout how many vanish on a hit; Settle how long they take to come back; Bits how many planes the picture keeps; Seed re-rolls the picture.",
    "PASSES": [
        {
            "TARGET": "pic",
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
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
        { "NAME": "pixelSize", "LABEL": "Pixel size", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "dropout", "LABEL": "Dropout", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "settle", "LABEL": "Settle", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "bits", "LABEL": "Bits", "TYPE": "float", "DEFAULT": 8, "MIN": 2, "MAX": 8 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.37, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Planes", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// pic: the source picture over the sheet, one value per texel.
// clock (1x1): r last count seen, g the clock (mod 32 s) at the last hit,
// b a rough count of seconds since it, so a long silence reads as long ago.

const float TAU = 6.2831853;

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

// The source picture, 0-1: a big soft orb, satellites on orbits, a tilted
// ring of light and a slow swell, all smooth so every bit plane draws
// clean contours.
float picture(vec2 p, float t, float rs) {
    float v = 0.0;
    vec2 c0 = vec2(sin(t * 0.21 + rs) * 0.06, cos(t * 0.17 + rs * 2.0) * 0.04);
    vec2 d0 = p - c0;
    float r0 = 0.16 + 0.04 * hash11(rs + 1.0);
    v += 0.62 * r0 * r0 / (dot(d0, d0) + r0 * r0);
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float dir = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
        float a = t * (0.16 + 0.12 * hash11(fi + rs * 3.0)) * dir + hash11(fi * 3.1 + rs) * TAU;
        float orbit = 0.26 + 0.2 * hash11(fi * 5.3 + rs);
        vec2 c = c0 + vec2(cos(a) * orbit * 1.35, sin(a) * orbit * 0.62);
        float r = 0.035 + 0.045 * hash11(fi * 7.7 + rs);
        vec2 d = p - c;
        v += 0.42 * r * r / (dot(d, d) + r * r);
    }
    // A tilted ring round the orb.
    float tilt = 0.35 + 0.25 * hash11(rs + 9.0);
    float ca = cos(tilt);
    float sa = sin(tilt);
    vec2 q = vec2(ca * d0.x + sa * d0.y, -sa * d0.x + ca * d0.y);
    float er = length(q * vec2(1.0, 2.8));
    v += 0.3 * exp(-pow((er - 0.42) / 0.035, 2.0));
    v += 0.1 * exp(-pow((er - 0.56) / 0.012, 2.0));
    // A slow swell over the whole field.
    v *= 1.0 + 0.12 * sin(length(d0) * 9.0 - t * 0.6);
    v = max(v - 0.045, 0.0) * 1.05;
    v *= smoothstep(0.98, 0.55, length(p * vec2(0.6, 0.98)));
    return clamp(1.0 - exp(-1.7 * v), 0.0, 0.999);
}

// Sheet half size, frame-height units.
const vec2 SHEET = vec2(0.7, 0.44);

void main() {
    float n = floor(vxCount + 0.5);
    float rs = floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);
    float t = vxPhase;

    if (PASSINDEX == 0) {
        vec2 lp = (isf_FragNormCoord * 2.0 - 1.0) * SHEET;
        gl_FragColor = vec4(picture(lp, t, rs), 0.0, 0.0, 1.0);
        return;
    }

    if (PASSINDEX == 1) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 0.0, 30.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float stamp = newHit ? mod(TIME, 32.0) : c.g;
        float since = newHit ? 0.0 : min(c.b + dt, 30.0);
        gl_FragColor = vec4(n, stamp, since, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = mod(mod(TIME, 32.0) - clk.g + 32.0, 32.0);
    if (clk.b > 8.0) age = 30.0;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    // The pixel grid, in sheet units.
    float rows = floor(mix(300.0, 60.0, pow(clamp(pixelSize, 0.0, 1.0), 0.8)));
    vec2 cells = vec2(floor(rows * SHEET.x / SHEET.y), rows);

    // The hit: a layout per hit; planes fly out fast and come home one by
    // one, the coarse planes first.
    float hs = n * 1.618 + rs * 0.37;
    float style = floor(hash11(hs + 0.3) * 4.0);
    float vel = mix(0.75, 1.0, clamp(vxVel, 0.0, 1.0));
    float amt = spread * vel;
    float settleT = mix(0.15, 1.2, settle);
    float side = hash11(hs + 4.7) < 0.5 ? 1.0 : -1.0;
    float nbits = clamp(floor(bits + 0.5), 2.0, 8.0);

    // Between hits one plane at a time works loose and slides back.
    float idleClock = t * 0.4;
    float idleK = 7.0 - mod(floor(idleClock) * 3.0, 8.0);
    float idleAmt = sin(fract(idleClock) * 3.14159);
    idleAmt = idleAmt * idleAmt * 0.22;

    vec3 col = vec3(0.0);
    float trans = 1.0;
    // Front to back: the top bit is nearest.
    for (int i = 0; i < 8; i++) {
        float k = 7.0 - float(i);
        if (k < 8.0 - nbits) continue;
        float back = settleT * (0.45 + 0.55 * (7.0 - k) / 7.0);
        float sep = n < 0.5 ? 0.0 : mix(0.65, 1.0, smoothstep(0.0, 0.1, age)) * (1.0 - smoothstep(back - 0.06, back, age));
        if (k == idleK) sep = max(sep, idleAmt);
        float z = (k - 3.5) / 3.5;
        float r1 = hash21(vec2(k + 1.7, hs));
        // Where the sheet goes: its two axes and its centre.
        vec2 A = vec2(SHEET.x, 0.0);
        vec2 B = vec2(0.0, SHEET.y);
        vec2 C = vec2(0.0);
        if (style < 0.5) {
            // A stack of cards seen from above, top bit highest.
            A = vec2(SHEET.x * 0.78, -0.06 * side);
            B = vec2(0.3 * side, SHEET.y * 0.32);
            C = vec2(-0.12 * side * z, z * 0.36);
        } else if (style < 1.5) {
            // A row of sheets fanned sideways, seen edge on.
            A = vec2(SHEET.x * 0.22, SHEET.y * 0.2 * side);
            B = vec2(0.0, SHEET.y * 0.82);
            C = vec2(z * aspect * 0.4, -0.04 * z * side);
        } else if (style < 2.5) {
            // Flat slides: each plane steps off on its own.
            C = vec2((r1 - 0.5) * 0.9, (hash21(vec2(k, hs + 3.0)) - 0.5) * 0.25);
        } else {
            // A contact sheet: all eight planes side by side, top bit first.
            float slot = 7.0 - k;
            float cx = mod(slot, 4.0);
            float cy = floor(slot / 4.0);
            A = vec2(SHEET.x * 0.27, 0.0);
            B = vec2(0.0, SHEET.y * 0.27);
            C = vec2((cx - 1.5) * min(0.43, aspect * 0.24), (0.5 - cy) * 0.3);
        }
        if (k == idleK && sep <= idleAmt + 0.001) {
            A = vec2(SHEET.x, 0.0);
            B = vec2(0.0, SHEET.y);
            C = vec2(side * 0.18, 0.0);
        }
        A = mix(vec2(SHEET.x, 0.0), A, sep);
        B = mix(vec2(0.0, SHEET.y), B, sep);
        C = mix(vec2(0.0), C * mix(0.45, 1.25, amt), sep);
        // Into the sheet: [-1, 1] across it.
        float det = A.x * B.y - A.y * B.x;
        vec2 d = p - C;
        vec2 l = vec2(d.x * B.y - d.y * B.x, A.x * d.y - A.y * d.x) / det;
        if (abs(l.x) > 1.0 || abs(l.y) > 1.0) continue;
        vec2 g = l * 0.5 + 0.5;
        vec2 cid = floor(g * cells);
        float v = IMG_NORM_PIXEL(pic, (cid + 0.5) / cells).r;
        float q = floor(v * 255.0);
        float bit = mod(floor(q / pow(2.0, k)), 2.0);
        float loose = clamp(sep * 1.6, 0.0, 1.0);
        // Dropped and flickering planes while apart.
        float drop = step(hash21(vec2(k * 3.3 + 0.5, hs + 11.0)), dropout * 0.8) * step(0.3, loose);
        float flick = step(0.3, loose) * step(hash21(vec2(k, floor(age * 24.0) + hs)), 0.25 * dropout);
        float on = bit * (1.0 - drop) * (1.0 - flick);
        // Pixels: squares with a hairline gap once the plane is loose.
        vec2 f = abs(fract(g * cells) - 0.5);
        float cellPx = 2.0 * min(length(A) / cells.x, length(B) / cells.y) / px;
        float sq = 1.0 - loose * 0.6 * smoothstep(5.0, 10.0, cellPx) * step(0.4, max(f.x, f.y));
        // Together a plane carries its true weight; apart it shows as a
        // binary sheet in its own tint, so the fine planes can be seen.
        float w = mix(pow(2.0, k) / 255.0, mix(0.22, 0.85, pow(k / 7.0, 1.5)), loose);
        vec3 tint = mix(ink.rgb, mix(accent.rgb, ink.rgb, smoothstep(3.0, 7.0, k)), loose);
        vec3 c = tint * on * w * sq;
        // The sheet's edge, drawn once it is loose.
        vec2 e = (1.0 - abs(l)) * vec2(length(A), length(B));
        float edge = (1.0 - smoothstep(0.0, px * 1.5, min(e.x, e.y))) * smoothstep(0.25, 0.6, loose);
        c += mix(accent.rgb, ink.rgb, 0.4) * edge * 0.5;
        col += trans * c;
        trans *= 1.0 - loose * (0.82 * on + 0.35);
    }
    // The bits it keeps are rescaled to full range.
    float keep = (pow(2.0, nbits) - 1.0) * pow(2.0, 8.0 - nbits) / 255.0;
    col /= max(keep, 0.1);
    col = col / (1.0 + max(col - 1.0, 0.0));

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
