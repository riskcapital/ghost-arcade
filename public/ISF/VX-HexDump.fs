/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A memory dump scrolling past: an address column, sixteen bytes a row in hex and the same bytes decoded as text, in a crisp terminal font. The memory has its own character (runs of zeros, pointer tables, fill patterns, packed data and readable strings). Every hit of the sound it follows corrupts it: a block of bytes is overwritten and spreads in the accent colour, scattered bits flip, a band of rows repeats the same address and now and then the read jumps ahead. Corrupted blocks scroll away with the data and heal after a while. Text size sets how many rows fill the frame, Scroll speed how fast it reads, Corruption how big the damage is, Jumps how often a hit skips ahead and Healing how long the damage lasts.",
    "PASSES": [
        { "TARGET": "clock", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "mem", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "rows", "LABEL": "Text size", "TYPE": "float", "DEFAULT": 34, "MIN": 18, "MAX": 60 },
        { "NAME": "speed", "LABEL": "Scroll speed", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "corruption", "LABEL": "Corruption", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "jumps", "LABEL": "Jumps", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "healing", "LABEL": "Healing", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.31, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Text", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Corruption", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): count seen, seconds since the last three hits.
// mem (1x1): rows skipped by jumps, and where the last three hits landed
// (the scroll position at the time, in memory rows).

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

// Text regions: four 6-bit chars (ASCII - 32) per float, sixteen chars a phrase.
vec4 phraseChars(float p) {
    if (p < 0.5) return vec4(13564455.0, 13242420.0, 9848931.0, 0.0); // GHOST ARCADE
    else if (p < 1.5) return vec4(10123635.0, 13815137.0, 0.0, 0.0); // SEGFAULT
    else if (p < 2.5) return vec4(9907171.0, 12015872.0, 149872.0, 0.0); // CORE DUMPED
    else if (p < 3.5) return vec4(149602.0, 13777267.0, 3247.0, 0.0); // BAD SECTOR
    else if (p < 4.5) return vec4(9574770.0, 13314368.0, 3247.0, 0.0); // READ ERROR
    else if (p < 5.5) return vec4(11717998.0, 10943488.0, 13262126.0, 0.0); // NULL POINTER
    else if (p < 6.5) return vec4(9313587.0, 12005419.0, 9866465.0, 36.0); // STACK SMASHED
    else if (p < 7.5) return vec4(14109042.0, 13634482.0, 9936943.0, 3058.0); // RETURN TO ZERO
    else if (p < 8.5) return vec4(12221043.0, 4459297.0, 17.0, 0.0); // SIGNAL 11
    else if (p < 9.5) return vec4(9178094.0, 10955937.0, 3237.0, 0.0); // NO CARRIER
    else if (p < 10.5) return vec4(9329187.0, 12016875.0, 10885504.0, 44.0); // CHECKSUM FAIL
    else if (p < 11.5) return vec4(12254391.0, 13840423.0, 9849458.0, 0.0); // WRONG STRIDE
    return vec4(0.0);
}

float phraseLen(float p) {
    if (p < 0.5) return 13.0;
    else if (p < 1.5) return 9.0;
    else if (p < 2.5) return 12.0;
    else if (p < 3.5) return 11.0;
    else if (p < 4.5) return 11.0;
    else if (p < 5.5) return 13.0;
    else if (p < 6.5) return 14.0;
    else if (p < 7.5) return 15.0;
    else if (p < 8.5) return 10.0;
    else if (p < 9.5) return 11.0;
    else if (p < 10.5) return 14.0;
    else if (p < 11.5) return 13.0;
    return 1.0;
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

// ASCII code to glyph index (uppercase only; unprintable bytes read as '.').
float asciiGlyph(float a) {
    if (a >= 97.0 && a <= 122.0) a -= 32.0;
    if (a >= 48.0 && a <= 57.0) return a - 48.0;
    if (a >= 65.0 && a <= 70.0) return a - 55.0;
    if (a >= 71.0 && a <= 90.0) return a - 36.0;
    if (a == 32.0) return 60.0;
    if (a == 58.0) return 17.0;
    if (a == 45.0) return 18.0;
    if (a == 61.0) return 19.0;
    if (a == 43.0) return 20.0;
    if (a == 42.0) return 21.0;
    if (a == 35.0) return 22.0;
    if (a == 37.0) return 23.0;
    if (a == 64.0) return 24.0;
    if (a == 47.0) return 25.0;
    if (a == 92.0) return 26.0;
    if (a == 124.0) return 27.0;
    if (a == 60.0) return 28.0;
    if (a == 62.0) return 29.0;
    if (a == 63.0) return 31.0;
    if (a == 33.0) return 32.0;
    if (a == 36.0) return 33.0;
    if (a == 38.0) return 34.0;
    if (a == 95.0) return 55.0;
    if (a == 126.0) return 56.0;
    if (a == 94.0) return 57.0;
    if (a == 91.0) return 58.0;
    if (a == 93.0) return 59.0;
    return 16.0;
}

// The byte at memory row m, column k. Memory comes in four-row chunks,
// each of one kind: packed data, zeros, text, pointers, fill or a table.
float byteAt(float m, float k, float rs) {
    float chunk = floor((m + 0.5) / 4.0);
    float h = hash21(vec2(chunk * 1.13 + rs, 7.7));
    float hb = hash31(vec3(m, k, rs + 3.0));
    if (h < 0.24) return floor(hb * 256.0);
    if (h < 0.36) return hb < 0.12 ? floor(hash11(hb * 91.0) * 256.0) : 0.0;
    if (h < 0.58) {
        float p = floor(hash11(chunk + rs * 5.0) * 12.0);
        float len = phraseLen(p);
        float i = imod((m - chunk * 4.0) * 16.0 + k + floor(hash11(chunk * 3.7) * 16.0), len);
        vec4 pc = phraseChars(p);
        float q = floor(i / 4.0);
        float f = q < 0.5 ? pc.x : (q < 1.5 ? pc.y : (q < 2.5 ? pc.z : pc.w));
        return imod(floor((f + 0.5) / pow(64.0, imod(i, 4.0))), 64.0) + 32.0;
    }
    if (h < 0.74) {
        // Little-endian 64-bit pointers into one region.
        float j = imod(k, 8.0);
        float ptr = m * 2.0 + floor((k + 0.5) / 8.0);
        if (j < 0.5) return imod(floor(hash11(ptr + rs) * 32.0) * 8.0, 256.0);
        if (j < 1.5) return floor(hash11(ptr * 1.7 + rs) * 256.0);
        if (j < 2.5) return imod(floor(chunk * 0.37) + 48.0, 256.0);
        if (j < 3.5) return 127.0;
        return 0.0;
    }
    if (h < 0.86) {
        float f = floor(hash11(chunk * 2.1 + rs) * 4.0);
        if (f < 0.5) {
            float j = imod(k, 4.0);
            return j < 0.5 ? 222.0 : (j < 1.5 ? 173.0 : (j < 2.5 ? 190.0 : 239.0));
        }
        if (f < 1.5) return 204.0;
        if (f < 2.5) return 255.0;
        return imod(k, 2.0) < 0.5 ? 85.0 : 170.0;
    }
    // A table of little 32-bit ints, counting up.
    float j = imod(k, 4.0);
    return j < 0.5 ? imod(m * 4.0 + floor((k + 0.5) / 4.0) + floor(hash11(chunk) * 64.0), 256.0) : 0.0;
}

float hexDigit(float v, float place) {
    return imod(floor((v + 0.5) / pow(16.0, place)), 16.0);
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = floor(clamp(seed, 0.0, 1.0) * 997.0 + 0.5);
    float rate = mix(0.0, 8.0, speed * speed);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 60.0, 60.0, 60.0);
        if (abs(n - c.r) > 0.5) {
            c = vec4(n, 0.0, c.g, c.b);
        } else {
            c.gba = min(c.gba + dt, 60.0);
        }
        gl_FragColor = c;
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));

    if (PASSINDEX == 1) {
        vec4 s = IMG_NORM_PIXEL(mem, vec2(0.5));
        if (FRAMEINDEX < 2) s = vec4(0.0, -1e4, -1e4, -1e4);
        if (FRAMEINDEX >= 2 && clk.g == 0.0) {
            if (hash11(n * 4.31 + rs) < jumps) s.r = imod(s.r + 6.0 + floor(hash11(n * 2.9 + rs) * 40.0), 4096.0);
            s = vec4(s.r, floor(vxPhase * rate + s.r), s.g, s.b);
        }
        gl_FragColor = s;
        return;
    }

    vec4 mst = IMG_NORM_PIXEL(mem, vec2(0.5));

    // Layout: character cells of 6x10 glyph pixels, whole screen pixels at 1080p.
    float bitRaw = RENDERSIZE.y / (clamp(rows, 18.0, 60.0) * 10.0);
    float bit = bitRaw >= 2.0 ? floor(bitRaw + 0.5) : bitRaw;
    float cw = bit * 6.0;
    float chH = bit * 10.0;
    float lines = floor(RENDERSIZE.y / chH);
    float cols = 77.0;
    vec2 org = vec2(floor(max((RENDERSIZE.x - cols * cw) * 0.5, cw * 3.0)), floor((RENDERSIZE.y - lines * chH) * 0.5));
    vec2 px = vec2(gl_FragCoord.x, RENDERSIZE.y - gl_FragCoord.y) - org;
    float w = 1.0 / bit;

    float c = floor(px.x / cw);
    float qx = (px.x - c * cw) / bit;
    float view = lines - 4.0;          // scrolling rows between header and footer
    float topY = chH * 2.0;
    float scroll = vxPhase * rate + mst.r;
    float lineF = (px.y - topY) / chH + fract(scroll);
    float line = floor(lineF);
    float qy = (lineF - line) * 10.0 - 1.5;
    float m = floor(scroll) + line;
    bool inBody = px.y >= topY && px.y < topY + view * chH;

    // The heal time: blocks live this long, then dissolve.
    float life = mix(0.8, 6.0, healing);
    float corr = clamp(corruption, 0.0, 1.0);

    // Rows repeated by the latest hit: a band of the screen holds one address.
    float dupAge = clk.g;
    bool dupRow = false;
    if (n > 0.5 && dupAge < life * 0.18 + 0.12 && hash11(n * 1.9 + rs) < 0.35 + 0.5 * corr) {
        float l0 = floor(hash11(n * 3.3 + rs) * (view - 6.0));
        float l1 = l0 + 2.0 + floor(hash11(n * 5.1 + rs) * mix(3.0, 9.0, corr));
        float lineS = floor((px.y - topY) / chH);
        if (lineS >= l0 && lineS < l1) {
            dupRow = true;
            m = floor(scroll) + l0;
            lineF = (px.y - topY) / chH;
            line = floor(lineF);
            qy = (lineF - line) * 10.0 - 1.5;
        }
    }

    // Which field this column is in, and which byte.
    float k = -1.0;
    float nib = 0.0;      // 0 high digit, 1 low digit, 2 the gap
    float field = 0.0;    // 1 address, 2 hex, 3 text
    if (c >= 0.0 && c < 8.0) field = 1.0;
    float cb = c - 10.0;
    if (cb >= 0.0 && cb < 24.0) { field = 2.0; k = floor((cb + 0.5) / 3.0); nib = imod(cb, 3.0); }
    if (cb >= 25.0 && cb < 49.0) { field = 2.0; k = 8.0 + floor((cb - 24.5) / 3.0); nib = imod(cb - 25.0, 3.0); }
    if (c >= 61.0 && c < 77.0) { field = 3.0; k = c - 61.0; }

    // Corruption around the last three hits, anchored in memory.
    float blockIn = 0.0;      // inside a block (filled)
    float blockEdge = 0.0;    // its ragged edge (accent text)
    float rowHit = 0.0;       // this row touches a block
    float garbage = 0.0;
    float healLine = 0.0;
    float anyLive = 0.0;
    float halo = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float age = i == 0 ? clk.g : (i == 1 ? clk.b : clk.a);
        float anc = i == 0 ? mst.g : (i == 1 ? mst.b : mst.a);
        float hn = n - fi;
        if (age > life || anc < -1000.0 || hn < 0.5) continue;
        anyLive = 1.0;
        float bm = anc + floor(view * mix(0.25, 0.8, hash11(hn * 7.3 + rs)));
        float bk = floor(hash11(hn * 2.7 + rs) * 16.0);
        float R = mix(1.2, 5.5, corr) * mix(0.6, 1.0, clamp(vxVel, 0.0, 1.0)) * mix(0.7, 1.3, hash11(hn * 9.1));
        float r = R * (1.0 - exp(-age * 9.0));
        float dm = m - bm;
        if (abs(dm) < r + 1.0) rowHit = 1.0;
        if (k >= 0.0) {
            float dk = (k - bk) * 0.5;
            float d = length(vec2(dk, dm)) + (hash31(vec3(m, k, hn)) - 0.5) * 1.6;
            // Healing: cells drop back to clean data in a random order over the second half of the life.
            float healT = clamp((age / life - 0.45) / 0.55, 0.0, 1.0);
            bool healed = hash31(vec3(k * 1.3, m, hn + 4.0)) < healT;
            if (!healed) {
                if (d < r - 0.6) {
                    blockIn = 1.0;
                    garbage = floor(hash31(vec3(m, k, hn + floor(min(age, 0.3) * 20.0))) * 256.0);
                } else if (d < r + 0.8 && blockIn < 0.5) {
                    blockEdge = 1.0;
                }
                halo = max(halo, clamp(1.0 - (d - r) / 3.0, 0.0, 1.0) * step(r - 0.6, d) * (1.0 - healT));
            }
            if (healT > 0.0 && healT < 1.0 && abs(dm) < r + 1.0) healLine = max(healLine, 0.0);
        }
    }

    vec3 col = vec3(0.0);
    float lum = 0.0;
    vec3 tint = ink.rgb;
    float g = 60.0;
    float bg = 0.0;
    vec3 bgCol = vec3(0.0);
    vec3 accentC = accent.rgb;

    // Cursor: one row read byte by byte.
    float curLine = floor(view * 0.62);
    float curByte = imod(floor(vxPhase * 10.0), 16.0);
    float lineS = floor((px.y - topY) / chH);

    if (inBody && field > 0.5) {
        float v = byteAt(m, max(k, 0.0), rs);
        // Scattered bit flips around a fresh hit.
        float flipped = 0.0;
        if (k >= 0.0 && n > 0.5 && clk.g < life * 0.5) {
            float hf = hash31(vec3(m * 0.71, k, n + 11.0));
            if (hf < 0.035 * corr * (1.0 - clk.g / (life * 0.5))) {
                v = imod(v + exp2(floor(hash11(hf * 77.0) * 8.0)), 256.0);
                flipped = 1.0;
            }
        }
        if (blockIn > 0.5) v = garbage;
        if (field < 1.5) {
            float addr = imod(m * 16.0 + floor(rs * 4099.0) * 16.0, 16777216.0);
            float hi2 = 127.0;
            g = c < 2.0 ? hexDigit(hi2, 1.0 - c) : hexDigit(addr, 7.0 - c);
            lum = 0.42;
            if (dupRow) { tint = accentC; lum = 0.95; }
        } else if (field < 2.5) {
            if (nib < 1.5) g = nib < 0.5 ? floor((v + 0.5) / 16.0) : imod(v, 16.0);
            lum = v < 0.5 ? 0.3 : 0.9;
        } else {
            g = asciiGlyph(v);
            lum = (v >= 32.0 && v < 127.0) ? 0.8 : 0.32;
            if (blockIn > 0.5) g = imod(garbage, 3.0) < 1.0 ? 31.0 : (imod(garbage, 3.0) < 2.0 ? 22.0 : 23.0);
        }
        if (flipped > 0.5 || blockEdge > 0.5) { tint = accentC; lum = 1.0; }
        if (halo > 0.0 && field > 1.5) { bg = 1.0; bgCol = accentC * 0.13 * halo; }
        if (blockIn > 0.5 && field > 1.5) {
            bg = 1.0;
            bgCol = accentC * 0.92;
            tint = vec3(0.0);
            lum = 1.0;
        }
        // The read cursor.
        if (lineS == curLine && !dupRow) {
            bg = max(bg, 0.0);
            if (bg < 0.5) { bgCol = ink.rgb * 0.07; bg = 1.0; }
            if (k == curByte && field > 1.5 && blockIn < 0.5) {
                bgCol = ink.rgb * 0.85;
                tint = vec3(0.0);
                lum = 1.0;
            }
        }
    }

    // Marks in the margin for damaged rows.
    if (inBody && c == -2.0 && rowHit > 0.5) { g = 32.0; tint = accentC; lum = 1.0; }

    // Header and footer.
    float hdrRow = floor(px.y / chH);
    if (hdrRow == 0.0) {
        qy = (px.y / chH - hdrRow) * 10.0 - 1.5;
        if (c >= 0.0 && c < 6.0) {
            g = c < 0.5 ? 43.0 : (c < 1.5 ? 15.0 : (c < 2.5 ? 15.0 : (c < 3.5 ? 47.0 : (c < 4.5 ? 14.0 : 48.0))));
        } else if (field == 2.0 && nib < 1.5) {
            g = nib < 0.5 ? 0.0 : k;
        } else if (field == 3.0 && k < 7.0) {
            // DECODED
            g = k < 0.5 ? 13.0 : (k < 1.5 ? 14.0 : (k < 2.5 ? 12.0 : (k < 3.5 ? 43.0 : (k < 4.5 ? 13.0 : (k < 5.5 ? 14.0 : 13.0)))));
        }
        lum = 0.38;
        tint = ink.rgb;
        bg = 0.0;
    }
    if (hdrRow == lines - 1.0) {
        qy = (px.y / chH - hdrRow) * 10.0 - 1.5;
        float rd = imod((floor(scroll) + curLine) * 16.0 + floor(rs * 4099.0) * 16.0 + curByte, 16777216.0);
        lum = 0.55;
        tint = ink.rgb;
        bg = 0.0;
        if (c >= 0.0 && c < 4.0) g = c < 0.5 ? 46.0 : (c < 1.5 ? 14.0 : (c < 2.5 ? 10.0 : 13.0));      // READ
        else if (c >= 5.0 && c < 13.0) { g = c < 7.0 ? hexDigit(127.0, 6.0 - c) : hexDigit(rd, 12.0 - c); lum = 0.9; }
        else if (c >= 15.0 && c < 21.0) g = c < 15.5 ? 15.0 : (c < 16.5 ? 10.0 : (c < 17.5 ? 49.0 : (c < 18.5 ? 40.0 : (c < 19.5 ? 48.0 : 60.0))));   // FAULT
        else if (c >= 21.0 && c < 23.0) { g = hexDigit(n, 22.0 - c); lum = 0.9; }
        else if (c >= 69.0 && c < 77.0) {
            if (anyLive > 0.5) {
                // CORRUPT
                float j = c - 70.0;
                g = j < -0.5 ? 60.0 : (j < 0.5 ? 12.0 : (j < 1.5 ? 43.0 : (j < 2.5 ? 46.0 : (j < 3.5 ? 46.0 : (j < 4.5 ? 49.0 : (j < 5.5 ? 44.0 : 48.0))))));
                tint = accentC;
                lum = 1.0;
            } else {
                g = c < 75.0 ? 60.0 : (c < 75.5 ? 43.0 : 39.0);    // OK
            }
        }
    }

    // Hairline rules: under the header, over the footer, and between fields.
    float rule = 0.0;
    float y0 = topY - chH * 0.5;
    float y1 = topY + view * chH + chH * 0.5;
    float xL = -0.5 * cw;
    float xR = cols * cw + 0.5 * cw;
    if (px.x > xL && px.x < xR) {
        rule = max(rule, clamp(1.0 - abs(px.y - y0) * 1.0, 0.0, 1.0));
        rule = max(rule, clamp(1.0 - abs(px.y - y1) * 1.0, 0.0, 1.0));
    }
    if (px.y > y0 && px.y < y1) {
        rule = max(rule, clamp(1.0 - abs(px.x - 9.0 * cw), 0.0, 1.0));
        rule = max(rule, clamp(1.0 - abs(px.x - 60.0 * cw), 0.0, 1.0));
    }

    float cov = 0.0;
    if (g < 59.5) cov = glyphCover(glyphOf(g), vec2(qx, qy), w);
    // Filled cells span the whole cell, glued across the gap within a byte.
    col = bgCol * bg;
    col = mix(col, tint * lum, cov);
    col = max(col, ink.rgb * 0.22 * rule);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
