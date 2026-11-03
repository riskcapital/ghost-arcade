/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A raw picture read back with the wrong row stride. The voice draws a bold pixel picture (a giant banded planet with its ring, over the bright limb of a cratered moon, against a glowing sky), stores it as raw bytes, three channels a pixel, and reads it back. Every hit of the sound it follows gets the read wrong: the picture shears into diagonals, splits into copies side by side or stacked, or slips by a byte so the channels trade colours and stripe. Each new stride is read down the frame like a decoder at work, then the decoder tries a near miss, then gets the colours right, then the whole picture. A readout shows the stride and offset in use. Picture size sets how many pixels the picture has, Stride error how far wrong the reads go, Colour slip how often a byte slip swaps the channels, Repeated rows how often a band of rows smears, Recovery how long the decoder takes and Pixel grid how visible the pixels are.",
    "PASSES": [
        { "TARGET": "clock", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "picSize", "LABEL": "Picture size", "TYPE": "float", "DEFAULT": 192, "MIN": 128, "MAX": 384 },
        { "NAME": "strideError", "LABEL": "Stride error", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "colourSlip", "LABEL": "Colour slip", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "repeatRows", "LABEL": "Repeated rows", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "recovery", "LABEL": "Recovery", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "grid", "LABEL": "Pixel grid", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Ring", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): count seen, the clock time of the last hit, and the stride
// error and byte offset in use when it came (the decoder reads from those
// to the new ones).

// Glyph table (index: char): 0:0 1:1 2:2 3:3 4:4 5:5 6:6 7:7 8:8 9:9 10:A 11:B 12:C 13:D 14:E 15:F 16:. 17:: 18:- 19:= 20:+ 21:* 22:# 23:% 24:@ 25:/ 26:\ 27:| 28:< 29:> 30:x 31:? 32:! 33:$ 34:& 35:G 36:H 37:I 38:J 39:K 40:L 41:M 42:N 43:O 44:P 45:Q 46:R 47:S 48:T 49:U 50:V 51:W 52:X 53:Y 54:Z 55:_ 56:~ 57:^ 58:[ 59:] 60: 
// Each glyph is 5x7; channel j holds rows 2j and 2j+1, five bits a row, leftmost pixel in the high bit.
vec4 glyphCode(float g) {
    if (g < 0.5) return vec4(558.0, 691.0, 569.0, 14.0);
    else if (g < 1.5) return vec4(388.0, 132.0, 132.0, 14.0);
    else if (g < 2.5) return vec4(558.0, 65.0, 260.0, 31.0);
    else if (g < 3.5) return vec4(95.0, 68.0, 545.0, 14.0);
    else if (g < 4.5) return vec4(194.0, 586.0, 95.0, 2.0);
    else if (g < 5.5) return vec4(543.0, 62.0, 545.0, 14.0);
    else if (g < 6.5) return vec4(262.0, 976.0, 561.0, 14.0);
    else if (g < 7.5) return vec4(63.0, 130.0, 264.0, 8.0);
    else if (g < 8.5) return vec4(558.0, 465.0, 561.0, 14.0);
    else if (g < 9.5) return vec4(558.0, 497.0, 65.0, 12.0);
    else if (g < 10.5) return vec4(558.0, 1009.0, 561.0, 17.0);
    else if (g < 11.5) return vec4(574.0, 977.0, 561.0, 30.0);
    else if (g < 12.5) return vec4(558.0, 528.0, 560.0, 14.0);
    else if (g < 13.5) return vec4(604.0, 561.0, 593.0, 28.0);
    else if (g < 14.5) return vec4(543.0, 976.0, 528.0, 31.0);
    else if (g < 15.5) return vec4(543.0, 976.0, 528.0, 16.0);
    else if (g < 16.5) return vec4(0.0, 0.0, 384.0, 12.0);
    else if (g < 17.5) return vec4(384.0, 12.0, 396.0, 0.0);
    else if (g < 18.5) return vec4(0.0, 992.0, 0.0, 0.0);
    else if (g < 19.5) return vec4(0.0, 31.0, 31.0, 0.0);
    else if (g < 20.5) return vec4(128.0, 996.0, 132.0, 0.0);
    else if (g < 21.5) return vec4(128.0, 469.0, 149.0, 0.0);
    else if (g < 22.5) return vec4(330.0, 351.0, 351.0, 10.0);
    else if (g < 23.5) return vec4(824.0, 130.0, 616.0, 3.0);
    else if (g < 24.5) return vec4(558.0, 695.0, 535.0, 15.0);
    else if (g < 25.5) return vec4(32.0, 130.0, 520.0, 0.0);
    else if (g < 26.5) return vec4(512.0, 136.0, 34.0, 0.0);
    else if (g < 27.5) return vec4(132.0, 132.0, 132.0, 4.0);
    else if (g < 28.5) return vec4(130.0, 520.0, 136.0, 2.0);
    else if (g < 29.5) return vec4(136.0, 34.0, 130.0, 8.0);
    else if (g < 30.5) return vec4(0.0, 337.0, 324.0, 17.0);
    else if (g < 31.5) return vec4(558.0, 65.0, 4.0, 4.0);
    else if (g < 32.5) return vec4(132.0, 132.0, 4.0, 4.0);
    else if (g < 33.5) return vec4(484.0, 468.0, 965.0, 4.0);
    else if (g < 34.5) return vec4(588.0, 276.0, 597.0, 13.0);
    else if (g < 35.5) return vec4(558.0, 752.0, 561.0, 15.0);
    else if (g < 36.5) return vec4(561.0, 1009.0, 561.0, 17.0);
    else if (g < 37.5) return vec4(142.0, 132.0, 132.0, 14.0);
    else if (g < 38.5) return vec4(71.0, 66.0, 578.0, 12.0);
    else if (g < 39.5) return vec4(593.0, 788.0, 596.0, 17.0);
    else if (g < 40.5) return vec4(528.0, 528.0, 528.0, 31.0);
    else if (g < 41.5) return vec4(881.0, 693.0, 561.0, 17.0);
    else if (g < 42.5) return vec4(561.0, 697.0, 563.0, 17.0);
    else if (g < 43.5) return vec4(558.0, 561.0, 561.0, 14.0);
    else if (g < 44.5) return vec4(574.0, 977.0, 528.0, 16.0);
    else if (g < 45.5) return vec4(558.0, 561.0, 597.0, 13.0);
    else if (g < 46.5) return vec4(574.0, 977.0, 596.0, 17.0);
    else if (g < 47.5) return vec4(527.0, 464.0, 33.0, 30.0);
    else if (g < 48.5) return vec4(159.0, 132.0, 132.0, 4.0);
    else if (g < 49.5) return vec4(561.0, 561.0, 561.0, 14.0);
    else if (g < 50.5) return vec4(561.0, 561.0, 337.0, 4.0);
    else if (g < 51.5) return vec4(561.0, 689.0, 693.0, 10.0);
    else if (g < 52.5) return vec4(561.0, 138.0, 554.0, 17.0);
    else if (g < 53.5) return vec4(561.0, 138.0, 132.0, 4.0);
    else if (g < 54.5) return vec4(63.0, 130.0, 520.0, 31.0);
    else if (g < 55.5) return vec4(0.0, 0.0, 0.0, 31.0);
    else if (g < 56.5) return vec4(0.0, 680.0, 2.0, 0.0);
    else if (g < 57.5) return vec4(324.0, 17.0, 0.0, 0.0);
    else if (g < 58.5) return vec4(270.0, 264.0, 264.0, 14.0);
    else if (g < 59.5) return vec4(78.0, 66.0, 66.0, 14.0);
    else if (g < 60.5) return vec4(0.0, 0.0, 0.0, 0.0);
    return vec4(0.0);
}

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

float hash31(vec3 q) {
    vec3 p3 = fract(q * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

// Integer helpers that stay exact on GPUs with loose division.
float imod(float a, float b) {
    return a - b * floor((a + 0.5) / b);
}

float bitOf(float v, float i) {
    return step(0.25, fract(floor((v + 0.5) * exp2(-i)) * 0.5));
}

vec4 glyphOf(float g) {
    return glyphCode(g);
}

float glyphBit(vec4 code, vec2 c) {
    if (c.x < 0.0 || c.x > 4.5 || c.y < 0.0 || c.y > 6.5) return 0.0;
    float pair = floor(c.y * 0.5);
    float v = pair < 0.5 ? code.x : (pair < 1.5 ? code.y : (pair < 2.5 ? code.z : code.w));
    return bitOf(v, imod(c.y, 2.0) * 5.0 + (4.0 - c.x));
}

// Exact box-filtered coverage of a 5x7 glyph. q in glyph pixels (x right,
// y down from the top row), w is one screen pixel in glyph pixels.
float glyphCover(vec4 code, vec2 q, float w) {
    float h = 0.5 * min(w, 1.0);
    vec2 lo = q - h;
    vec2 hi = q + h;
    vec2 i0 = floor(lo);
    vec2 o0 = min(i0 + 1.0, hi) - lo;
    vec2 o1 = max(hi - (i0 + 1.0), 0.0);
    float c = glyphBit(code, i0) * o0.x * o0.y
            + glyphBit(code, i0 + vec2(1.0, 0.0)) * o1.x * o0.y
            + glyphBit(code, i0 + vec2(0.0, 1.0)) * o0.x * o1.y
            + glyphBit(code, i0 + vec2(1.0, 1.0)) * o1.x * o1.y;
    return clamp(c / (4.0 * h * h), 0.0, 1.0);
}


// The picture's size in pixels.
vec2 picDims() {
    float w = floor(clamp(picSize, 128.0, 384.0) / 8.0 + 0.5) * 8.0;
    return vec2(w, floor(w * 9.0 / 16.0 + 0.5));
}

// The error a hit makes, in bytes: x is the stride error, y the start offset.
// Every kind keeps the picture readable: a diagonal shear, colour stripes,
// copies side by side, or copies stacked.
vec2 hitError(float hn, float S, float W) {
    float h = hash11(hn * 7.13 + 0.5);
    float amt = clamp(strideError, 0.0, 1.0);
    float sgn = hash11(hn * 3.7) < 0.5 ? -1.0 : 1.0;
    float px = 3.0 * (1.0 + floor(hash11(hn * 1.9) * mix(1.0, 6.0, amt)));
    float d = 0.0;
    if (h < 0.34) d = sgn * px;                                                  // a shear
    else if (h < 0.52) d = sgn * (1.0 + floor(hash11(hn * 5.1) * 2.0)) + sgn * 3.0 * floor(amt * 2.0 * hash11(hn * 8.1));   // stripes
    else if (h < 0.72) d = -floor(S * 0.5 / 3.0) * 3.0 + sgn * 3.0 * floor(hash11(hn * 2.3) * 3.0 * amt);                   // side by side
    else if (h < 0.9) d = S + sgn * 3.0 * floor(hash11(hn * 2.9) * 3.0 * amt);   // two stacked
    else d = 2.0 * S;                                                            // three stacked
    d *= step(0.02, amt);
    float o = 0.0;
    if (hash11(hn * 9.7 + 0.3) < colourSlip) o = (hash11(hn * 4.4) < 0.5 ? 1.0 : 2.0) + 3.0 * floor(hash11(hn * 6.1) * W * 0.25);
    return vec2(d, o);
}

// The decoder's tries after a hit: the bad stride, then a near miss (a
// slight shear), then the colours still off by a byte, then right.
float recoveryStep(float age) {
    float stepT = mix(0.06, 0.4, recovery);
    return floor(age / stepT);
}

vec2 errorAt(float hn, float age, float S) {
    vec2 e = hitError(hn, S, S / 3.0);
    float k = recoveryStep(age);
    float slip = imod(e.y, 3.0);
    if (k < 0.5) return e;
    if (k < 1.5) return vec2(abs(e.x) > 3.5 ? sign(e.x) * 3.0 : e.x, slip);
    if (k < 2.5) return vec2(0.0, slip);
    return vec2(0.0);
}

// The picture: r the planet and the moonscape, g the ring, b the sky, its
// glow and the stars. uv in 0-1, y down. Big shapes and big areas of each
// channel, so a misread throws large slabs of colour about.
vec3 picture(vec2 uv, float t, vec2 dims) {
    vec2 p = (uv - 0.5) * vec2(16.0 / 9.0, -1.0);
    vec2 pc = vec2(-0.12, 0.06);
    float R = 0.34;
    vec3 l = normalize(vec3(0.8, 0.45, 0.5));
    vec2 d = p - pc;
    float r = length(d);
    float A = 0.0;
    float B = 0.0;

    // Sky: a deep gradient that brightens towards the horizon, a glow round
    // the planet, and stars.
    float C = mix(0.02, 0.24, smoothstep(0.5, -0.45, p.y) * smoothstep(0.5, -0.45, p.y));
    C += 0.28 * exp(-max(r - R, 0.0) * 7.0) * smoothstep(-0.4, 0.6, dot(normalize(vec3(d, 0.2)), l));
    vec2 sp = floor(uv * dims);
    float hs = hash21(sp + 17.0);
    if (hs > 0.988) C = max(C, mix(0.5, 1.0, hash11(hs * 91.0)));

    // The ring: an ellipse round the planet, its front half over it.
    float ca = cos(0.2);
    float sa = sin(0.2);
    vec2 rr = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
    vec2 rd = vec2(rr.x, rr.y / 0.24);
    float rl = length(rd) / R;
    float ring = 0.0;
    if (rl > 1.25 && rl < 2.45) {
        float x = (rl - 1.25) / 1.2;
        ring = 0.62 + 0.38 * sin(x * 30.0) * sin(x * 5.0 + 1.0);
        ring *= smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.9, x);
        ring *= 1.0 - 0.9 * smoothstep(0.03, 0.0, abs(x - 0.55));
        // The planet's shadow on the ring behind it.
        if (rr.y > 0.0 && abs(rr.x + 0.12) < R * 0.9) ring *= 0.25;
    }
    bool front = rr.y < 0.0;

    if (r < R) {
        vec3 n = vec3(d / R, sqrt(max(1.0 - dot(d, d) / (R * R), 0.0)));
        float dif = max(dot(n, l), 0.0);
        float lat = n.y * 0.95 + n.x * 0.2;
        float lon = atan(n.x, n.z) + t * 0.18;
        float band = 0.5 + 0.5 * sin(lat * 9.0 + sin(lon * 2.0 + lat * 4.0) * 0.9);
        band = smoothstep(0.25, 0.75, band);
        float storm = smoothstep(0.16, 0.0, length(vec2((lon - t * 0.05 - 0.9) * 0.55, lat + 0.35)));
        A = (0.1 + 0.9 * dif) * mix(0.35, 1.0, band) + storm * dif * 0.6;
        // The ring's shadow across the planet.
        A *= 1.0 - 0.8 * smoothstep(0.05, 0.0, abs((rr.y + 0.06) / R + 0.1 * rr.x));
        C = pow(1.0 - n.z, 4.0) * 0.8;
        if (front) B = ring;
    } else {
        B = ring;
    }

    // A moonscape across the bottom: a huge bright limb with craters.
    vec2 mc = vec2(0.35, -1.62);
    float mr = 1.25;
    vec2 md = p - mc;
    float ml = length(md);
    if (ml < mr) {
        vec3 n = vec3(md / mr, sqrt(max(1.0 - ml * ml / (mr * mr), 0.0)));
        vec2 cp = md * 9.0 + vec2(t * 0.3, 0.0);
        vec2 ci = floor(cp);
        float crater = 0.0;
        for (int i = 0; i < 4; i++) {
            vec2 o = vec2(mod(float(i), 2.0), floor(float(i) * 0.5));
            vec2 c = ci + o;
            vec2 cc = c + vec2(hash21(c), hash21(c + 7.1)) * 0.8 + 0.1;
            float cr = 0.12 + 0.28 * hash21(c + 3.3);
            float dd = length(cp - cc);
            crater = max(crater, smoothstep(cr, cr * 0.7, dd) * 0.6 - smoothstep(cr * 1.15, cr, dd) * 0.0);
        }
        float lit = max(dot(n, normalize(vec3(-0.4, 0.8, 0.45))), 0.0);
        A = (0.12 + 0.88 * lit) * (1.0 - crater * 0.55);
        B = 0.0;
        C = 0.0;
    }
    return clamp(vec3(A, B, C), 0.0, 1.0);
}

float hexDigit(float v, float place) {
    return imod(floor((v + 0.5) / pow(16.0, place)), 16.0);
}

float decDigit(float v, float place) {
    return imod(floor((v + 0.5) / pow(10.0, place)), 10.0);
}

void main() {
    float n = floor(vxCount + 0.5);
    vec2 dims = picDims();
    float S = dims.x * 3.0;

    if (PASSINDEX == 0) {
        // Stores the clock time of the hit, so the steps keep time however
        // many frames are drawn.
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        if (FRAMEINDEX < 2) c = vec4(n, TIME - 30.0, 0.0, 0.0);
        if (abs(n - c.r) > 0.5) {
            // What the decoder was using when this hit came.
            float was0 = TIME - c.g;
            vec2 was = (c.r > 0.5 && was0 >= 0.0) ? errorAt(c.r, was0, S) : vec2(0.0);
            c = vec4(n, TIME, was);
        }
        gl_FragColor = c;
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = TIME - clk.g;
    if (age < 0.0) age = 30.0;

    // Layout: whole screen pixels per picture pixel, a readout above.
    float ps = max(floor(RENDERSIZE.y * 0.9 / dims.y), 1.0);
    if (RENDERSIZE.y * 0.9 / dims.y < 1.0) ps = RENDERSIZE.y * 0.9 / dims.y;
    vec2 size = dims * ps;
    vec2 org = floor(vec2((RENDERSIZE.x - size.x) * 0.5, (RENDERSIZE.y - size.y) * 0.5 + RENDERSIZE.y * 0.02));
    vec2 sc = vec2(gl_FragCoord.x, RENDERSIZE.y - gl_FragCoord.y) - org;
    vec2 pix = floor(sc / ps);
    vec3 col = vec3(0.0);

    // The stride and offset in use, the old ones still below the decoder's line.
    vec2 errNow = n > 0.5 ? errorAt(n, age, S) : vec2(0.0);
    float k = recoveryStep(age);
    float stepT = mix(0.06, 0.4, recovery);
    vec2 errPrev = k < 0.5 ? clk.ba : errorAt(n, (k - 1.0) * stepT, S);
    float scanY = clamp((age - k * stepT) / max(stepT * 0.7, 0.05), 0.0, 1.0) * dims.y;
    if (n < 0.5) { errNow = vec2(0.0); errPrev = vec2(0.0); }

    if (pix.x >= 0.0 && pix.y >= 0.0 && pix.x < dims.x && pix.y < dims.y) {
        vec2 err = pix.y < scanY ? errNow : errPrev;
        float y = pix.y;
        // Repeated rows: a band holds one row while the hit is fresh.
        if (n > 0.5 && hash11(n * 2.17 + 0.9) < repeatRows && age < stepT * 1.5) {
            float y0 = floor(hash11(n * 8.3) * dims.y * 0.8);
            float y1 = y0 + floor(mix(4.0, dims.y * 0.35, hash11(n * 1.3)));
            if (y > y0 && y < y1) y = y0;
        }
        float strideB = S + err.x;
        vec3 v = vec3(0.0);
        // Three bytes span at most two stored pixels, so the picture is drawn at most twice.
        float lastP = -1.0;
        vec3 texel = vec3(0.0);
        for (int ch = 0; ch < 3; ch++) {
            float fc = float(ch);
            float j = err.y + y * strideB + pix.x * 3.0 + fc;
            float total = S * dims.y;
            j = j - total * floor(j / total);
            float p = floor((j + 0.5) / 3.0);
            float cs = j - p * 3.0;
            float sy = floor((p + 0.5) / dims.x);
            float sx = p - sy * dims.x;
            if (p != lastP) {
                texel = picture((vec2(sx, sy) + 0.5) / dims, vxPhase, dims);
                lastP = p;
            }
            float val = cs < 0.5 ? texel.r : (cs < 1.5 ? texel.g : texel.b);
            if (ch == 0) v.x = val;
            else if (ch == 1) v.y = val;
            else v.z = val;
        }
        col = ink.rgb * v.x + accent.rgb * v.y + mix(ink.rgb, accent.rgb, 0.3) * v.z * 0.85;
        // The pixel grid.
        vec2 f = sc - pix * ps;
        float edge = (f.x < 1.0 || f.y < 1.0) ? 1.0 : 0.0;
        if (ps >= 4.0) col *= 1.0 - edge * 0.55 * grid;
        // The decoder's line.
        if (n > 0.5 && scanY < dims.y && abs(pix.y - floor(scanY)) < 0.5 && age < stepT * 4.0) col = max(col, mix(ink.rgb, accent.rgb, 0.5) * 0.5);
    }

    // The frame round the picture.
    vec2 fo = abs(sc - size * 0.5) - size * 0.5 - 6.0;
    float frameD = max(fo.x, fo.y);
    if (abs(frameD) < 0.5 && ps >= 2.0) col = max(col, ink.rgb * 0.25);

    // Readout: RAW WxH RGB8   STRIDE nnnn   OFFSET nn, above the picture.
    float bit = max(floor(ps * 0.34 + 0.5), 1.0);
    if (RENDERSIZE.y < 400.0) bit = RENDERSIZE.y / 360.0;
    float cw = bit * 6.0;
    vec2 tp = vec2(sc.x, sc.y + bit * 14.0) / vec2(cw, bit * 10.0);
    if (tp.y >= 0.0 && tp.y < 1.0 && tp.x >= 0.0 && tp.x < 64.0) {
        float c = floor(tp.x);
        vec2 q = vec2((tp.x - c) * 6.0, tp.y * 10.0 - 1.0);
        float g = 60.0;
        float lit = 0.45;
        vec3 tint = ink.rgb;
        float stride = S + errNow.x;
        float wrongS = abs(errNow.x) > 0.5 ? 1.0 : 0.0;
        float wrongO = abs(errNow.y) > 0.5 ? 1.0 : 0.0;
        // RAW
        if (c < 0.5) g = 46.0; else if (c < 1.5) g = 10.0; else if (c < 2.5) g = 51.0;
        // width x height
        else if (c >= 4.0 && c < 7.0) g = decDigit(dims.x, 6.0 - c);
        else if (c >= 7.0 && c < 8.0) g = 30.0;
        else if (c >= 8.0 && c < 11.0) g = decDigit(dims.y, 10.0 - c);
        // RGB8
        else if (c >= 12.0 && c < 16.0) g = c < 12.5 ? 46.0 : (c < 13.5 ? 35.0 : (c < 14.5 ? 11.0 : 8.0));
        // STRIDE
        else if (c >= 19.0 && c < 25.0) g = c < 19.5 ? 47.0 : (c < 20.5 ? 48.0 : (c < 21.5 ? 46.0 : (c < 22.5 ? 37.0 : (c < 23.5 ? 13.0 : 14.0))));
        else if (c >= 26.0 && c < 30.0) { g = decDigit(max(stride, 0.0), 29.0 - c); lit = 0.95; if (wrongS > 0.5) tint = accent.rgb; }
        // OFFSET
        else if (c >= 33.0 && c < 39.0) g = c < 33.5 ? 43.0 : (c < 34.5 ? 15.0 : (c < 35.5 ? 15.0 : (c < 36.5 ? 47.0 : (c < 37.5 ? 14.0 : 48.0))));
        else if (c >= 40.0 && c < 42.0) { g = decDigit(errNow.y, 41.0 - c); lit = 0.95; if (wrongO > 0.5) tint = accent.rgb; }
        if (g < 59.5) {
            float cov = glyphCover(glyphOf(g), q, 1.0 / bit);
            col = mix(col, tint * lit, cov);
        }
    }

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
