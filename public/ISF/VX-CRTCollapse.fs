/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "An old picture tube showing a station ident: a slatted sun with a channel number inside turning rings of ticks and accent arcs, an orbiting satellite, a sunburst behind, meter columns either side, tone blocks along the top and the station name (your own text, cycling, or CHANNEL 7) and a running clock along the bottom. The glass and its bezel stay visible even when the picture is gone. The picture is drawn the way a tube draws it: fat glowing scan lines that swell on bright parts, a red, green and blue phosphor stripe, bloom, a curved glass face and a slow afterglow. Hits of the sound it follows knock the tube about: the big ones switch it off, the picture slamming down to a white-hot line, then a dot that hangs in the glass, before it springs back open with a wobble; others roll the vertical hold, squeeze the picture to a sliver or give it a jolt. Collapse picks which of these the hits do, Spring back how long the tube takes to come back, Afterglow how long the phosphor holds light, Scan lines how coarse the raster is, Curvature the bulge of the glass and Bloom the glow.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "sig",
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {
            "TARGET": "glass",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "collapse", "LABEL": "Collapse", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["A mix, switching off every fourth hit", "Switch off", "Vertical roll", "Squeeze"] },
        { "NAME": "springBack", "LABEL": "Spring back", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "afterglow", "LABEL": "Afterglow", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "lines", "LABEL": "Scan lines", "TYPE": "float", "DEFAULT": 220, "MIN": 120, "MAX": 480 },
        { "NAME": "curvature", "LABEL": "Curvature", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "bloom", "LABEL": "Bloom", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Accent", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxTxt0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 262144 },
        { "NAME": "vxTxt1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 262144 },
        { "NAME": "vxTxt2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 262144 },
        { "NAME": "vxTxt3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 262144 },
        { "NAME": "vxTxtLen", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 12 }
    ]
}*/

// clock (1x1): r last count seen, g the clock time the event began,
// b the event (0 switch off, 1 vertical roll, 2 squeeze, 3 jolt), a its strength.
// sig: the picture the set receives. glass: the phosphor, with its afterglow.

const float PI = 3.14159265;
const float TAU = 6.2831853;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
}

float duration() {
    return mix(0.4, 1.4, springBack);
}

// ---------------------------------------------------------------- the station ident

// Codes: 0 space, 1-26 A-Z, 27-36 0-9, then . ! ? - + ' : / &
vec2 glyphBits(float c) {
    if (c < 0.5) return vec2(0.0, 0.0); // space
    if (c < 1.5) return vec2(476735.0, 17969.0); // A
    if (c < 2.5) return vec2(1001022.0, 17982.0); // B
    if (c < 3.5) return vec2(476688.0, 16942.0); // C
    if (c < 4.5) return vec2(1001009.0, 17982.0); // D
    if (c < 5.5) return vec2(1032734.0, 16927.0); // E
    if (c < 6.5) return vec2(1032734.0, 16912.0); // F
    if (c < 7.5) return vec2(476695.0, 17967.0); // G
    if (c < 8.5) return vec2(575039.0, 17969.0); // H
    if (c < 9.5) return vec2(462980.0, 4238.0); // I
    if (c < 10.5) return vec2(231490.0, 2636.0); // J
    if (c < 11.5) return vec2(576152.0, 21073.0); // K
    if (c < 12.5) return vec2(541200.0, 16927.0); // L
    if (c < 13.5) return vec2(585397.0, 17969.0); // M
    if (c < 14.5) return vec2(575285.0, 20017.0); // N
    if (c < 15.5) return vec2(476721.0, 17966.0); // O
    if (c < 16.5) return vec2(1001022.0, 16912.0); // P
    if (c < 17.5) return vec2(476721.0, 22093.0); // Q
    if (c < 18.5) return vec2(1001022.0, 21073.0); // R
    if (c < 19.5) return vec2(508430.0, 1086.0); // S
    if (c < 20.5) return vec2(1020036.0, 4228.0); // T
    if (c < 21.5) return vec2(575025.0, 17966.0); // U
    if (c < 22.5) return vec2(575025.0, 17732.0); // V
    if (c < 23.5) return vec2(575029.0, 22186.0); // W
    if (c < 24.5) return vec2(574788.0, 10801.0); // X
    if (c < 25.5) return vec2(574788.0, 4228.0); // Y
    if (c < 26.5) return vec2(1016900.0, 8735.0); // Z
    if (c < 27.5) return vec2(476789.0, 26158.0); // 0
    if (c < 28.5) return vec2(143492.0, 4238.0); // 1
    if (c < 29.5) return vec2(476194.0, 4383.0); // 2
    if (c < 30.5) return vec2(1017986.0, 1582.0); // 3
    if (c < 31.5) return vec2(72018.0, 31810.0); // 4
    if (c < 32.5) return vec2(1033153.0, 1582.0); // 5
    if (c < 33.5) return vec2(205342.0, 17966.0); // 6
    if (c < 34.5) return vec2(1016900.0, 8456.0); // 7
    if (c < 35.5) return vec2(476718.0, 17966.0); // 8
    if (c < 36.5) return vec2(476719.0, 1100.0); // 9
    if (c < 37.5) return vec2(0.0, 396.0); // .
    if (c < 38.5) return vec2(135300.0, 4100.0); // !
    if (c < 39.5) return vec2(476194.0, 4100.0); // ?
    if (c < 40.5) return vec2(31.0, 0.0); // -
    if (c < 41.5) return vec2(4255.0, 4224.0); // +
    if (c < 42.5) return vec2(135424.0, 0.0); // '
    if (c < 43.5) return vec2(12672.0, 12672.0); // :
    if (c < 44.5) return vec2(33860.0, 8720.0); // /
    if (c < 45.5) return vec2(412296.0, 22093.0); // &
    return vec2(0.0);
}

// 1 where the glyph's pixel is set. g in glyph cells: x 0-5, y 0-7 from the top.
float glyph(float c, vec2 g) {
    if (c < 0.0 || g.x < 0.0 || g.x >= 5.0 || g.y < 0.0 || g.y >= 7.0) return 0.0;
    vec2 b = glyphBits(c);
    float r = floor(g.y);
    float cx = floor(g.x);
    float v = r < 3.5 ? b.x : b.y;
    float idx = r < 3.5 ? (3.0 - r) * 5.0 + (4.0 - cx) : (6.0 - r) * 5.0 + (4.0 - cx);
    // Whole numbers, so the bit test is exact.
    int iv = int(v + 0.5);
    int ip = int(exp2(idx) + 0.5);
    int q = iv / ip;
    return float(q - (q / 2) * 2);
}

// The i-th character of text packed three 6-bit codes to a float, first lowest.
float textChar(float i) {
    float k = floor(i / 3.0);
    float v = k < 0.5 ? vxTxt0 : (k < 1.5 ? vxTxt1 : (k < 2.5 ? vxTxt2 : vxTxt3));
    float j = i - k * 3.0;
    float div = j < 0.5 ? 1.0 : (j < 1.5 ? 64.0 : 4096.0);
    return i < vxTxtLen ? mod(floor(floor(v + 0.5) / div), 64.0) : 0.0;
}

// Up to 12 glyphs in a row; q from the text's top left, y down, in cells.
float text12(vec2 g, vec4 s0, vec4 s1, vec4 s2) {
    if (g.y < 0.0 || g.y >= 7.0 || g.x < 0.0 || g.x >= 72.0) return 0.0;
    float i = floor(g.x / 6.0);
    vec4 s = i < 3.5 ? s0 : (i < 7.5 ? s1 : s2);
    float j = mod(i, 4.0);
    float c = j < 0.5 ? s.x : (j < 1.5 ? s.y : (j < 2.5 ? s.z : s.w));
    return glyph(c, vec2(g.x - i * 6.0, g.y));
}

float band(float d, float w, float px) {
    return smoothstep(w + px, w - px, abs(d));
}

// The picture: a broadcast station ident. A sunburst fills the frame, a
// slatted sun sits in a rotating emblem of tick, arc and orbit rings, meter
// columns stand either side, a strip of tone blocks runs along the top and
// the station name and a clock along the bottom. p in frame-height units,
// origin in the middle, y up; px one picture pixel.
vec3 picture(vec2 p, float t, float px) {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 inkC = ink.rgb;
    vec3 acc = accent.rgb;
    vec3 mid = mix(inkC, acc, 0.5);
    vec3 col = vec3(0.0);
    vec2 c = vec2(0.0, 0.02);
    // The emblem is drawn a size smaller than the frame units.
    vec2 q = (p - c) * 1.3;
    px *= 1.3;
    float r = length(q);
    float a = atan(q.y, q.x);

    // Sunburst: alternating wedges turning slowly, fading out from the middle.
    float wedges = 28.0;
    float wa = fract((a + t * 0.06) / TAU * wedges);
    float wedge = smoothstep(0.02, 0.04, abs(wa - 0.5) - 0.22);
    col += mix(acc, inkC, smoothstep(0.3, 0.9, r)) * wedge * 0.055 * smoothstep(1.1, 0.42, r) * step(0.42, r);
    col += acc * 0.1 * exp(-r * 4.0);

    // The emblem's rings.
    // Ticks round the outside, every fifth long, turning.
    float tick = fract((a - t * 0.18) / TAU * 72.0);
    float longT = step(mod(floor((a - t * 0.18) / TAU * 72.0), 6.0), 0.5);
    float tickOn = smoothstep(0.18 + px * 40.0, 0.12, abs(tick - 0.5) * 2.0 - 0.0) ;
    tickOn = step(abs(tick - 0.5), 0.16);
    float tr0 = mix(0.375, 0.355, longT);
    col += inkC * 0.85 * tickOn * step(tr0, r) * step(r, 0.4);
    col += inkC * 0.7 * band(r - 0.415, 0.0025, px);
    // Three thick accent arcs turning the other way.
    float arc = fract((a + t * 0.32) / TAU * 3.0);
    float arcOn = smoothstep(0.0, 0.01, arc - 0.05) * smoothstep(0.0, 0.01, 0.72 - arc);
    col += acc * arcOn * band(r - 0.325, 0.014, px);
    col += inkC * 0.5 * band(r - 0.298, 0.002, px);
    // The slatted sun: accent at the bottom to ink at the top, slats widening downwards.
    if (r < 0.27) {
        float h = (q.y + 0.27) / 0.54;
        float slat = fract(q.y * 26.0 + t * 0.35);
        float gap = mix(0.55, 0.0, smoothstep(0.0, 0.62, h));
        float on = smoothstep(gap, gap + 0.06, slat) * smoothstep(0.27, 0.27 - px * 1.5, r);
        vec3 sunC = mix(acc, mix(inkC, vec3(1.0), 0.15), smoothstep(0.1, 0.9, h));
        col = mix(col, sunC * (0.35 + 0.4 * h), on);
    }
    // A big channel number cut through the sun.
    vec2 ng = (vec2(q.x + 0.155, 0.11 - q.y)) / 0.032;
    float num = glyph(27.0, ng) + glyph(34.0, ng - vec2(6.0, 0.0));
    if (num > 0.5 && r < 0.27) col = vec3(0.0) + inkC * 0.06;
    // The tilted orbit and its satellite.
    vec2 oq = q / vec2(0.62, 0.14);
    float od = (length(oq) - 1.0) * 0.14;
    float oa = atan(oq.y, oq.x);
    float front = step(oq.y, 0.0);
    float hidden = (1.0 - front) * step(r, 0.42);
    col += inkC * 0.55 * band(od, 0.0018, px) * (1.0 - hidden * 0.85);
    float sa = t * 0.9;
    vec2 sat = vec2(cos(sa) * 0.62, sin(sa) * 0.14);
    float satBehind = step(0.0, sin(sa)) * step(length(sat), 0.42);
    float sd = length(q - sat);
    col += mix(inkC, vec3(1.0), 0.3) * (0.00012 / (sd * sd + 0.00012)) * (1.0 - satBehind * 0.9);
    col += acc * exp(-sd * 40.0) * 0.4 * (1.0 - satBehind);

    px /= 1.3;
    // Meter columns either side.
    float side = sign(p.x);
    float mx = abs(p.x) - 0.5;
    if (mx > 0.0 && mx < 0.24 && abs(p.y) < 0.28) {
        float col6 = floor(mx / 0.04);
        float cx = mod(mx, 0.04);
        float lvl = 0.15 + 0.85 * pow(vnoise(col6 * 2.3 + side * 7.0 + t * 1.9), 1.5);
        lvl *= mix(1.0, 0.55, col6 / 6.0);
        float segs = 20.0;
        float sy = (p.y + 0.28) / 0.56 * segs;
        float si = floor(sy);
        float on = step(si + 0.5, lvl * segs) * step(0.25, fract(sy)) * step(0.006, cx) * step(cx, 0.034);
        float peak = step(abs(si - floor(lvl * segs)), 0.5) * step(0.25, fract(sy)) * step(0.006, cx) * step(cx, 0.034);
        float hot = step(segs * 0.75, si);
        col += mix(inkC, acc, hot) * on * 0.75 + acc * peak * 0.9;
        col += inkC * 0.05 * step(0.25, fract(sy)) * step(0.006, cx) * step(cx, 0.034) * (1.0 - on);
    }

    // Tone blocks along the top.
    float tw = aspect * 0.5 * 0.84;
    if (abs(p.x) < tw && p.y > 0.38 && p.y < 0.43) {
        float k = floor((p.x + tw) / (2.0 * tw) * 8.0);
        vec3 blk = k < 0.5 ? inkC : k < 1.5 ? mix(inkC, acc, 0.25) : k < 2.5 ? mix(inkC, acc, 0.5) : k < 3.5 ? mix(inkC, acc, 0.75) : k < 4.5 ? acc : k < 5.5 ? acc * 0.55 : k < 6.5 ? inkC * 0.4 : inkC * 0.15;
        float gapB = step(0.03, fract((p.x + tw) / (2.0 * tw) * 8.0));
        col = blk * 0.8 * gapB;
    }
    // Rules, the station name and the clock along the bottom.
    col += inkC * 0.35 * band(p.y + 0.34, 0.0015, px) * step(abs(p.x), tw);
    float run = fract(t * 0.07);
    col += acc * band(p.y + 0.34, 0.004, px) * step(abs(p.x + tw - run * 2.0 * tw), 0.04);
    float cell = 0.009;
    vec2 tg = vec2(p.x + tw, -0.37 - p.y) / cell;
    // The station name: the studio's text when it has some, else CHANNEL 7.
    vec4 n0 = vec4(3.0, 8.0, 1.0, 14.0);
    vec4 n1 = vec4(14.0, 5.0, 12.0, 0.0);
    vec4 n2 = vec4(34.0, 0.0, 0.0, 0.0);
    if (vxTxtLen > 0.5) {
        n0 = vec4(textChar(0.0), textChar(1.0), textChar(2.0), textChar(3.0));
        n1 = vec4(textChar(4.0), textChar(5.0), textChar(6.0), textChar(7.0));
        n2 = vec4(textChar(8.0), textChar(9.0), textChar(10.0), textChar(11.0));
    }
    col += inkC * 0.9 * text12(tg, n0, n1, n2);
    float secs = floor(t * 1.0) + 3723.0;
    vec2 cg = vec2(p.x - tw + 48.0 * cell, -0.37 - p.y) / cell;
    float hh = mod(floor(secs / 3600.0), 24.0);
    float mm = mod(floor(secs / 60.0), 60.0);
    float ss = mod(secs, 60.0);
    col += inkC * 0.9 * text12(cg, vec4(27.0 + floor(hh / 10.0), 27.0 + mod(hh, 10.0), 43.0, 27.0 + floor(mm / 10.0)), vec4(27.0 + mod(mm, 10.0), 43.0, 27.0 + floor(ss / 10.0), 27.0 + mod(ss, 10.0)), vec4(-1.0));
    // A live dot that blinks.
    col += acc * step(length(p - vec2(tw - 58.0 * cell, -0.402)), 0.009) * step(0.5, fract(t * 0.8));

    // Corner brackets.
    vec2 cb = abs(p) - vec2(aspect * 0.5 - 0.06, 0.44);
    float br = max(band(cb.x, 0.002, px) * step(-0.06, cb.y) * step(cb.y, 0.0), band(cb.y, 0.002, px) * step(-0.06, cb.x) * step(cb.x, 0.0));
    col += inkC * 0.6 * br;
    return col;
}

void main() {
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        // g holds the clock time the event began, so its age follows TIME exactly.
        if (FRAMEINDEX < 2) c = vec4(n, TIME - 30.0, 3.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float start = c.g;
        float age = TIME - start;
        if (age < 0.0) age = 30.0;
        float kind = c.b;
        float amt = c.a;
        if (newHit) {
            float T = duration();
            float want = 3.0;
            if (collapse == 0) {
                if (mod(n, 4.0) < 0.5) want = 0.0;
                else if (mod(n, 8.0) > 5.5) want = hash11(n * 1.7) < 0.5 ? 1.0 : 2.0;
            } else want = float(collapse - 1);
            // A big event in progress runs to the end; other hits only jolt it.
            bool busy = kind < 2.5 && age < T;
            if (!busy) {
                kind = want;
                start = TIME;
                amt = mix(0.6, 1.0, clamp(vxVel, 0.0, 1.0));
            }
        }
        gl_FragColor = vec4(n, start, kind, amt);
        return;
    }

    if (PASSINDEX == 1) {
        vec2 uv = isf_FragNormCoord;
        float aspect = RENDERSIZE.x / RENDERSIZE.y;
        vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
        gl_FragColor = vec4(picture(p, vxPhase, 1.0 / RENDERSIZE.y), 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = TIME - clk.g;
    if (age < 0.0) age = 30.0;
    float kind = clk.b;
    float amt = clk.a;
    float T = duration();
    float k = clamp(age / T, 0.0, 1.0);

    if (PASSINDEX == 2) {
        // Deflection: how wide and tall the raster is, and where it sits.
        float sxs = 1.0;
        float sys = 1.0;
        float roll = 0.0;
        float yoff = 0.0;
        float hot = 0.0;
        if (kind < 0.5) {
            // Switch off: down to a line, in to a dot, hold, spring back.
            if (k < 0.2) {
                float a = k / 0.2;
                sys = 1.0 - a * a;
                sxs = 1.0 + 0.04 * a;
            } else if (k < 0.4) {
                sys = 0.0;
                float a = (k - 0.2) / 0.2;
                sxs = 1.04 * (1.0 - a * a);
            } else if (k < 0.55) {
                sys = 0.0;
                sxs = 0.0;
            } else {
                float u = (k - 0.55) / 0.45;
                float ux = clamp(u * 1.5, 0.0, 1.0);
                sxs = 1.0 - exp(-5.0 * ux) * cos(9.0 * ux) * (1.0 - ux);
                sys = 1.0 - exp(-5.0 * u) * cos(11.0 * u) * (1.0 - u);
                sys = clamp(sys, 0.0, 1.3);
            }
            hot = 1.0;
        } else if (kind < 1.5) {
            // Vertical hold slips: the picture rolls through, then locks.
            float e = 1.0 - k;
            roll = e * e * e * (1.0 + floor(amt * 2.5));
            sxs = 1.0 + 0.02 * sin(k * 40.0) * e;
        } else if (kind < 2.5) {
            // Squeeze: to a sliver, and back with a wobble.
            if (k < 0.2) {
                float a = k / 0.2;
                sxs = 1.0 - a * a * 0.985 * amt;
            } else {
                float u = (k - 0.2) / 0.8;
                float s0 = 1.0 - 0.985 * amt;
                sxs = 1.0 - (1.0 - s0) * exp(-4.0 * u) * cos(10.0 * u) * (1.0 - u);
                sys = 1.0 + 0.03 * exp(-4.0 * u) * sin(10.0 * u);
            }
            hot = 1.0;
        } else {
            // Jolt: a small squash and bounce.
            float a = age;
            float e = exp(-a * 9.0) * amt;
            sys = 1.0 - 0.1 * e * cos(a * 30.0);
            yoff = 0.02 * e * sin(a * 24.0);
        }
        // The raster breathes with the sound (the supply sagging).
        float breathe = 1.0 + 0.012 * vxEnv;
        sxs *= breathe;
        sys *= breathe;

        vec2 uv = isf_FragNormCoord;
        vec2 g = uv - 0.5 - vec2(0.0, yoff);
        float minX = 2.2 / RENDERSIZE.x;
        float minY = 2.2 / RENDERSIZE.y;
        float ex = max(sxs, minX);
        float ey = max(sys, minY);
        vec2 s = g / vec2(ex, ey);
        vec3 col = vec3(0.0);
        if (abs(s.x) < 0.5 && abs(s.y) < 0.5) {
            float sy = s.y + 0.5;
            float blank = 0.0;
            if (roll > 0.0) {
                // A frame plus its blanking interval, rolling through.
                float vb = 0.09;
                float f = fract((sy + roll) / (1.0 + vb)) * (1.0 + vb);
                if (f > 1.0) blank = 1.0;
                sy = f;
            }
            float L = floor(lines + 0.5);
            float ly = sy * L - 0.5;
            float l0 = floor(ly);
            float fy = ly - l0;
            vec3 c0 = IMG_NORM_PIXEL(sig, vec2(s.x + 0.5, (l0 + 0.5) / L)).rgb;
            vec3 c1 = IMG_NORM_PIXEL(sig, vec2(s.x + 0.5, (l0 + 1.5) / L)).rgb;
            const vec3 YW = vec3(0.3, 0.59, 0.11);
            float w0 = mix(0.2, 0.42, clamp(dot(c0, YW), 0.0, 1.0));
            float w1 = mix(0.2, 0.42, clamp(dot(c1, YW), 0.0, 1.0));
            vec3 beam = c0 * exp(-pow(fy / w0, 2.0)) + c1 * exp(-pow((1.0 - fy) / w1, 2.0));
            beam *= 1.5;
            // When the lines crowd together they merge into a solid band.
            float spacing = ey * RENDERSIZE.y / L;
            float merge = smoothstep(1.4, 0.5, spacing);
            col = mix(beam, mix(c0, c1, fy) * 1.1, merge);
            if (blank > 0.5) col = vec3(0.0);
            // A collapsed raster runs hot: the same beam on a smaller patch.
            float squash = 1.0 - smoothstep(0.0, 0.08, min(sxs, sys));
            float gain = clamp(pow(1.0 / max(ex * ey, 1e-5), 0.3), 1.0, 4.0);
            vec3 coreC = mix(ink.rgb, vec3(1.0), 0.35) * 0.9;
            col = mix(col, coreC, squash * hot) * mix(1.0, gain, hot);
        }
        // A shut raster glows on the glass: a halo round the line, then the dot.
        if (hot > 0.5 && kind < 0.5) {
            float aspect = RENDERSIZE.x / RENDERSIZE.y;
            float lineOn = 1.0 - smoothstep(0.0, 0.04, sys);
            float within = smoothstep(0.5 * ex + 0.01, 0.5 * ex - 0.01, abs(g.x));
            float dy = abs(g.y);
            col += (ink.rgb * 0.9 * exp(-dy * 260.0) + accent.rgb * 0.35 * exp(-dy * 60.0)) * lineOn * within * amt;
            float dotted = 1.0 - smoothstep(0.0, 0.06, max(sxs, sys));
            float d = length(g * vec2(aspect, 1.0));
            col += (mix(ink.rgb, vec3(1.0), 0.4) * 2.0 * exp(-d * 180.0) + accent.rgb * 0.9 * exp(-d * 22.0) + ink.rgb * 0.25 * exp(-d * 6.0)) * dotted * amt;
        }

        // Phosphor afterglow.
        vec3 prev = IMG_NORM_PIXEL(glass, uv).rgb;
        float tau = mix(0.012, 0.6, afterglow * afterglow);
        // The picture's own trails stay short; an overdriven line or dot lingers.
        tau *= mix(0.3, 1.0, smoothstep(0.9, 2.0, dot(prev, vec3(0.33))));
        float decay = exp(-clamp(TIMEDELTA, 0.0, 0.1) / tau);
        if (FRAMEINDEX < 2) prev = vec3(0.0);
        // The trail cools towards the accent as it fades.
        vec3 trail = prev * decay;
        trail = mix(trail, accent.rgb * dot(trail, vec3(0.33)), 0.06);
        gl_FragColor = vec4(max(min(col, vec3(3.0)), trail), 1.0);
        return;
    }

    // The tube: curved glass, a phosphor stripe, bloom, a soft edge.
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 q = (uv - 0.5) * 2.0;
    vec2 qa = q * vec2(aspect, 1.0) / aspect;
    float bend = curvature * 0.11;
    float r2 = dot(q * vec2(1.0, 1.0 / aspect * 1.4), q * vec2(1.0, 1.0 / aspect * 1.4));
    vec2 tq = q * (1.0 + bend * r2);
    float margin = 0.94;
    vec2 t = tq / margin * 0.5 + 0.5;
    // Rounded tube outline.
    vec2 tb = abs(tq / margin) - vec2(1.0 - 0.09 / aspect, 0.91);
    float sd = length(max(tb, 0.0)) - 0.09;
    float edgePx = 2.5 / RENDERSIZE.y;
    float inside = smoothstep(edgePx, -edgePx, sd);
    vec3 col = vec3(0.0);
    if (inside > 0.0) {
        col = IMG_NORM_PIXEL(glass, t).rgb;
        // Bloom from a ring of wide taps.
        vec3 b = vec3(0.0);
        for (int i = 0; i < 8; i++) {
            float a = float(i) * 2.4 + 0.39;
            vec2 o = vec2(cos(a), sin(a)) * vec2(1.0 / aspect, 1.0);
            b += IMG_NORM_PIXEL(glass, t + o * mix(0.01, 0.04, float(i) / 7.0)).rgb;
        }
        b /= 8.0;
        // Aperture grille: one phosphor stripe per pixel column, in threes.
        float colx = mod(floor(gl_FragCoord.x), 3.0);
        vec3 grille = colx < 0.5 ? vec3(1.0, 0.7, 0.7) : (colx < 1.5 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0));
        float gm = clamp(RENDERSIZE.y / 1080.0, 0.0, 1.0) * 0.5;
        col = col * mix(vec3(1.0), grille * 1.2, gm);
        col += b * mix(0.0, 1.1, bloom) * mix(ink.rgb, vec3(1.0), 0.5);
        // Darker towards the edge of the glass.
        col *= 1.0 - 0.35 * dot(q, q) * 0.5;
        col *= inside;
    }
    // A faint reflection of the room on the glass and its rim.
    // The glass and its bezel stay visible when the picture is gone: a rim,
    // a dark moulded surround, a soft window reflection and a curved glint.
    float rim = smoothstep(edgePx * 3.0, 0.0, abs(sd)) * 0.09;
    float bezel = smoothstep(0.0, edgePx * 2.0, sd) * smoothstep(0.075, 0.03, sd);
    float bezelLight = 0.02 + 0.03 * clamp(0.5 + 0.5 * (q.y - q.x * 0.3), 0.0, 1.0);
    float outerLip = smoothstep(edgePx * 3.0, 0.0, abs(sd - 0.075)) * 0.05;
    float sheen = inside * smoothstep(0.75, 0.0, length((q - vec2(-0.5, 0.55)) * vec2(0.7, 1.2))) * 0.035;
    vec2 gq = q - vec2(-0.62, 0.5);
    float glint = inside * smoothstep(0.012, 0.0, abs(length(gq * vec2(0.8, 1.0)) - 0.32)) * smoothstep(0.0, 0.25, -gq.y + 0.2) * step(gq.x, 0.25) * step(-0.05, gq.x) * 0.06;
    col += ink.rgb * (rim + bezel * bezelLight + outerLip + sheen + glint);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
