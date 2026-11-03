/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A lit, turning 3D form drawn entirely in text characters: every character cell picks a glyph by how bright the surface is there, and the outline is traced in slashes and bars. Every hit of the sound it follows starts rot in the text: wrong characters spread through the picture from a few points in the accent colour, the worst of it decays into flickering noise, and some columns slip out of line before stepping back. The rot heals from its edges inwards. Form picks the object (ring, linked rings, lattice sphere, cube or a landscape, or lets it change every eight bars), Text size sets how many rows of characters fill the frame, Rot how far the damage spreads, Column slip how far columns drop, Healing how long the rot lasts and Spin how fast the object turns.",
    "PASSES": [
        { "TARGET": "clock", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "form", "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "rot", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/4" },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "shape", "LABEL": "Form", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["Changes every eight bars", "Ring", "Linked rings", "Lattice sphere", "Cube", "Landscape"] },
        { "NAME": "rows", "LABEL": "Text size", "TYPE": "float", "DEFAULT": 40, "MIN": 30, "MAX": 90 },
        { "NAME": "rotAmount", "LABEL": "Rot", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "slip", "LABEL": "Column slip", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "healing", "LABEL": "Healing", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Text", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Rot", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): count seen, seconds since the last hit, the form shown,
// seconds since the form changed.
// form (half x quarter size, one texel per character cell): the lit object,
// r = brightness, g = coverage, b = depth.
// rot (same size, kept): how rotten each cell is, 0-1. Hits plant it, it
// spreads to neighbours and heals from the edges.

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


const float TAU = 6.2831853;

// The character grid, worked out the same way in every pass from the
// output size.
vec4 gridOf(vec2 outSize) {
    float bitRaw = outSize.y / (clamp(rows, 30.0, 90.0) * 10.0);
    float bit = bitRaw >= 2.0 ? floor(bitRaw + 0.5) : max(bitRaw, 0.8);
    float cw = bit * 6.0;
    float chH = bit * 10.0;
    return vec4(bit, floor(outSize.x / cw), floor(outSize.y / chH), 0.0);
}

float formIndex() {
    if (shape > 0) return float(shape - 1);
    return imod(floor((floor(vxBars + 0.5) + 0.5) / 8.0), 5.0);
}

mat2 rot2(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, s, -s, c);
}

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float sdBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float objectDist(vec3 p, float kind) {
    if (kind < 0.5) return sdTorus(p, vec2(1.0, 0.42));
    if (kind < 1.5) {
        float a = sdTorus(p - vec3(0.5, 0.0, 0.0), vec2(0.82, 0.24));
        vec3 q = p + vec3(0.5, 0.0, 0.0);
        q = vec3(q.x, -q.z, q.y);
        float b = sdTorus(q, vec2(0.82, 0.24));
        return min(a, b);
    }
    if (kind < 2.5) {
        float s = length(p) - 1.3;
        vec3 q = p * 2.3;
        float g = abs(dot(sin(q), cos(q.yzx))) / 2.3 - 0.09;
        return max(s, g * 0.75);
    }
    // A cube with softened edges: three faces, three clear tones.
    return sdBox(p, vec3(0.78), 0.06);
}

vec3 objectNormal(vec3 p, float kind) {
    vec2 e = vec2(0.003, -0.003);
    return normalize(e.xyy * objectDist(p + e.xyy, kind) + e.yyx * objectDist(p + e.yyx, kind)
                   + e.yxy * objectDist(p + e.yxy, kind) + e.xxx * objectDist(p + e.xxx, kind));
}

float terrain(vec2 x) {
    float h = 0.55 * sin(x.x * 0.55 + sin(x.y * 0.31) * 1.7) * cos(x.y * 0.42);
    h += 0.22 * sin(x.x * 1.6 + x.y * 1.1);
    h += 0.08 * sin(x.x * 3.9 - x.y * 2.7);
    return h - abs(x.x) * 0.0;
}

// Brightness, coverage and depth of the scene through screen point p
// (frame-height units, centred).
vec3 scene(vec2 p, float kind, float t) {
    if (kind > 3.5) {
        // A landscape flown over, with a low sun.
        vec3 ro = vec3(0.0, 1.05, -t * 1.4);
        vec3 rd = normalize(vec3(p.x, p.y - 0.16, -1.3));
        float d = 0.1;
        float hit = 0.0;
        for (int i = 0; i < 56; i++) {
            vec3 q = ro + rd * d;
            float h = q.y - terrain(q.xz);
            if (h < 0.004 * d) { hit = 1.0; break; }
            d += h * 0.55;
            if (d > 28.0) break;
        }
        if (hit > 0.5) {
            vec3 q = ro + rd * d;
            vec2 e = vec2(0.02, 0.0);
            vec3 n = normalize(vec3(terrain(q.xz - e.xy) - terrain(q.xz + e.xy), 2.0 * e.x, terrain(q.xz - e.yx) - terrain(q.xz + e.yx)));
            vec3 l = normalize(vec3(0.0, 0.35, -1.0));
            float dif = max(dot(n, l), 0.0);
            float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
            float fog = exp(-d * 0.09);
            float lum = (0.1 + 0.85 * dif + 0.3 * rim) * fog;
            // Contour lines on the land.
            float ct = abs(fract(q.y * 6.0) - 0.5);
            lum *= mix(1.0, 1.35, step(ct, 0.06));
            return vec3(clamp(lum, 0.0, 1.0), fog * 0.9 + 0.1, d / 28.0);
        }
        // Sky: a sun cut by bands, and nothing else.
        vec2 sp = p - vec2(0.0, 0.08);
        float sr = length(sp);
        float sun = smoothstep(0.31, 0.3, sr);
        float band = step(0.5, fract(sp.y * 22.0 - t * 0.6)) + step(0.06, sp.y);
        sun *= clamp(band, 0.0, 1.0);
        float glow = exp(-max(sr - 0.3, 0.0) * 16.0) * 0.14;
        float lum = max(sun * mix(0.6, 1.0, clamp(sp.y * 3.0 + 0.6, 0.0, 1.0)), glow);
        return vec3(lum, sun, 1.0);
    }
    float sp = 0.5 + spin * 0.9;
    vec3 ro = vec3(0.0, 0.0, 4.6);
    vec3 rd = normalize(vec3(p, -1.45));
    // Spins round, held tilted towards the viewer so the shape always reads.
    mat2 ry = rot2(t * 0.45 * sp);
    mat2 rx = rot2((kind > 2.5 ? 0.62 : 0.95) + 0.3 * sin(t * 0.17 * sp));
    float d = 2.3;
    float hit = 0.0;
    vec3 q = ro;
    for (int i = 0; i < 64; i++) {
        q = ro + rd * d;
        q.yz = rx * q.yz;
        q.xz = ry * q.xz;
        float h = objectDist(q, kind);
        if (h < 0.002) { hit = 1.0; break; }
        d += h;
        if (d > 7.0) break;
    }
    if (hit < 0.5) return vec3(0.0, 0.0, 1.0);
    vec3 n = objectNormal(q, kind);
    // Light and view in object space.
    vec3 v = -rd;
    v.yz = rx * v.yz;
    v.xz = ry * v.xz;
    vec3 l = normalize(vec3(-0.55, 0.75, 0.65));
    l.yz = rx * l.yz;
    l.xz = ry * l.xz;
    float dif = max(dot(n, l), 0.0);
    float spec = pow(max(dot(reflect(-l, n), v), 0.0), 24.0);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
    // Hard key light with a dark shadow side, a sharp highlight and a rim.
    float lum = 0.015 + 0.2 * max(dot(n, v), 0.0) + 0.78 * pow(dif, 1.3) + 0.8 * spec + 0.3 * rim * smoothstep(-0.3, 0.2, dot(n, l));
    return vec3(clamp(lum, 0.0, 1.0), 1.0, rim);
}

// Brightness ramp, dark to light.
float rampGlyph(float i) {
    if (i < 0.5) return 60.0;   // space
    if (i < 1.5) return 16.0;   // .
    if (i < 2.5) return 17.0;   // :
    if (i < 3.5) return 18.0;   // -
    if (i < 4.5) return 19.0;   // =
    if (i < 5.5) return 20.0;   // +
    if (i < 6.5) return 21.0;   // *
    if (i < 7.5) return 22.0;   // #
    if (i < 8.5) return 23.0;   // %
    return 24.0;                // @
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float f = formIndex();
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, f, 30.0);
        c.g = abs(n - c.r) > 0.5 ? 0.0 : min(c.g + dt, 30.0);
        c.a = abs(f - c.b) > 0.5 ? 0.0 : min(c.a + dt, 30.0);
        gl_FragColor = vec4(n, c.g, f, c.a);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));

    if (PASSINDEX == 1) {
        // One texel per character cell.
        vec2 outSize = RENDERSIZE * vec2(2.0, 4.0);
        vec4 gr = gridOf(outSize);
        vec2 cell = floor(gl_FragCoord.xy);
        if (cell.x >= gr.y || cell.y >= gr.z) { gl_FragColor = vec4(0.0); return; }
        float cw = gr.x * 6.0;
        float chH = gr.x * 10.0;
        // Cell centre in frame-height units; cell rows count down from the top.
        vec2 pc = vec2((cell.x + 0.5 - gr.y * 0.5) * cw, (gr.z * 0.5 - cell.y - 0.5) * chH) / outSize.y;
        gl_FragColor = vec4(scene(pc, clk.b, vxPhase), 1.0);
        return;
    }

    if (PASSINDEX == 2) {
        vec2 outSize = RENDERSIZE * vec2(2.0, 4.0);
        vec4 gr = gridOf(outSize);
        vec2 cell = floor(gl_FragCoord.xy);
        if (cell.x >= gr.y || cell.y >= gr.z) { gl_FragColor = vec4(0.0); return; }
        vec2 px = 1.0 / RENDERSIZE;
        vec2 uv = (cell + 0.5) * px;
        float r = IMG_NORM_PIXEL(rot, uv).r;
        if (FRAMEINDEX < 2) r = 0.0;
        // Spread: take the strongest neighbour, less a ragged loss.
        // Cells are taller than wide, so it spreads further sideways.
        float nbx = max(IMG_NORM_PIXEL(rot, uv + vec2(px.x, 0.0)).r, IMG_NORM_PIXEL(rot, uv - vec2(px.x, 0.0)).r);
        float nby = max(IMG_NORM_PIXEL(rot, uv + vec2(0.0, px.y)).r, IMG_NORM_PIXEL(rot, uv - vec2(0.0, px.y)).r);
        float reach = mix(3.0, 26.0, rotAmount) * clamp(gr.z / 54.0, 0.3, 1.5);
        float loss = (1.0 / reach) * mix(0.4, 2.2, hash31(vec3(cell, floor(TIME * 30.0))));
        // Rot also drips: in some columns it runs down from the cell above.
        float above = IMG_NORM_PIXEL(rot, uv - vec2(0.0, px.y)).r;
        float drip = hash11(cell.x * 1.37 + 0.2) < 0.35 ? 0.3 : 1.0;
        r = max(r, max(max(nbx - loss * 0.6, nby - loss), above - loss * drip * 0.5));
        // Heal.
        r -= dt / mix(0.5, 5.0, healing);
        // Plant new rot on a hit, a few seeds near the middle.
        if (FRAMEINDEX >= 2 && clk.g == 0.0 && n > 0.5) {
            for (int i = 0; i < 4; i++) {
                float fi = float(i);
                if (fi > 1.0 + floor(vxVel * 2.5)) break;
                // Try a few spots and keep the first that lands on the form.
                vec2 sc = vec2(0.0);
                for (int j = 0; j < 4; j++) {
                    float fj = float(j);
                    vec2 cand = floor(vec2(gr.y * mix(0.15, 0.85, hash11(n * 3.1 + fi * 7.7 + fj * 0.61)), gr.z * mix(0.1, 0.9, hash11(n * 5.3 + fi * 2.9 + fj * 1.37))));
                    if (j == 0 || IMG_NORM_PIXEL(form, (cand + 0.5) * px).g > 0.5) sc = cand;
                    if (IMG_NORM_PIXEL(form, (cand + 0.5) * px).g > 0.5) break;
                }
                float rad = mix(1.0, 3.5, rotAmount) * mix(0.6, 1.4, hash11(n + fi * 11.0)) * clamp(gr.z / 54.0, 0.4, 1.5);
                vec2 dd = (cell - sc) * vec2(0.6, 1.0);
                if (length(dd) < rad) r = 1.0;
            }
        }
        gl_FragColor = vec4(clamp(r, 0.0, 1.0), 0.0, 0.0, 1.0);
        return;
    }

    vec4 gr = gridOf(RENDERSIZE);
    float bit = gr.x;
    float cw = bit * 6.0;
    float chH = bit * 10.0;
    vec2 org = floor((RENDERSIZE - gr.yz * vec2(cw, chH)) * 0.5);
    vec2 px = vec2(gl_FragCoord.x, RENDERSIZE.y - gl_FragCoord.y) - org;
    vec2 cell = floor(px / vec2(cw, chH));
    vec2 q = (px - cell * vec2(cw, chH)) / bit - vec2(0.5, 1.5);
    if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= gr.y || cell.y >= gr.z) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Column slip: a hit drops runs of columns, which step back into line.
    float age = clk.g;
    float hold = 1.0 - floor(clamp(age / mix(0.15, 0.7, slip), 0.0, 1.0) * 4.0) / 4.0;
    float shift = 0.0;
    if (n > 0.5 && slip > 0.0) {
        for (int i = 0; i < 2; i++) {
            float fi = float(i);
            float c0 = floor(hash11(n * 1.7 + fi * 3.3) * gr.y);
            float cwid = 1.0 + floor(hash11(n * 2.3 + fi * 5.1) * mix(2.0, 16.0, slip));
            if (cell.x >= c0 && cell.x < c0 + cwid) {
                float s = (hash11(n * 4.1 + fi) < 0.5 ? -1.0 : 1.0) * (1.0 + floor(hash11(n * 6.7 + fi * 1.3 + floor(cell.x / 3.0) * 0.1) * mix(2.0, 14.0, slip)));
                shift = s * hold;
            }
        }
        shift = floor(shift + 0.5);
    }
    vec2 tex = 1.0 / (RENDERSIZE * vec2(0.5, 0.25));
    vec2 sc = vec2(cell.x, imod(cell.y + shift + gr.z, gr.z));
    vec2 suv = (sc + 0.5) * tex;
    vec4 f0 = IMG_NORM_PIXEL(form, suv);

    // The outline: where coverage changes, draw the edge's direction.
    float g = rampGlyph(floor(clamp(f0.r, 0.0, 1.0) * 9.99));
    float lum = f0.r;
    float fx = IMG_NORM_PIXEL(form, suv + vec2(tex.x, 0.0)).g - IMG_NORM_PIXEL(form, suv - vec2(tex.x, 0.0)).g;
    float fy = IMG_NORM_PIXEL(form, suv + vec2(0.0, tex.y)).g - IMG_NORM_PIXEL(form, suv - vec2(0.0, tex.y)).g;
    float edge = length(vec2(fx, fy));
    // Creases: a sharp step in brightness inside the form (a cube's edges).
    if (edge <= 0.45 && f0.g > 0.5) {
        float lx = IMG_NORM_PIXEL(form, suv + vec2(tex.x, 0.0)).r - IMG_NORM_PIXEL(form, suv - vec2(tex.x, 0.0)).r;
        float ly = IMG_NORM_PIXEL(form, suv + vec2(0.0, tex.y)).r - IMG_NORM_PIXEL(form, suv - vec2(0.0, tex.y)).r;
        if (length(vec2(lx, ly)) > 0.5) {
            fx = lx;
            fy = ly;
            edge = 1.0;
        }
    }
    if (edge > 0.45 && f0.g > 0.5) {
        // Rows run downwards, so flip y to get the on-screen slope.
        float a = atan(-fy, fx * 0.6);
        float k = imod(floor((a / 3.14159265) * 4.0 + 4.5), 4.0);
        g = k < 0.5 ? 27.0 : (k < 1.5 ? 25.0 : (k < 2.5 ? 18.0 : 26.0));
        lum = max(lum, 0.75);
    }

    vec3 tint = ink.rgb * (0.07 + 0.93 * pow(lum, 1.1));
    // A glow under the bright cells, so the form reads as a shaded image; the
    // highlights fill their cells solid with the glyph cut out.
    float bg = 1.0;
    float hi = smoothstep(0.8, 0.98, lum) * f0.g;
    vec3 bgCol = ink.rgb * (0.16 * lum * lum * f0.g + 0.75 * hi);
    if (hi > 0.5) tint = ink.rgb * 0.08;

    // Rot.
    float rr = IMG_NORM_PIXEL(rot, (cell + 0.5) * tex).r;
    float hc = hash21(cell + 0.37);
    float live = f0.g;
    if (rr > 0.02) {
        float lvl = rr + (hc - 0.5) * 0.25;
        float hf = hash31(vec3(cell, floor(TIME * 14.0)));
        if (lvl > 0.72) {
            // The core: solid accent cells with flickering glyphs cut out.
            g = floor(hf * 59.0);
            bgCol = accent.rgb * mix(0.55, 0.95, hash11(hf * 37.0));
            tint = accent.rgb * 0.12;
            if (hf < 0.15) { bgCol = accent.rgb * 0.25; tint = accent.rgb; }
        } else if (lvl > 0.42) {
            // Wrong characters, bright accent, changing now and then.
            if (live > 0.05 || lvl > 0.55) {
                g = floor(hash21(cell + floor(TIME * 3.0 + hc) * 1.13) * 59.0);
                tint = accent.rgb * (0.75 + 0.25 * hc);
                bgCol = accent.rgb * 0.14;
            }
        } else if (lvl > 0.24) {
            // The glowing edge: the right glyph, burning in the accent colour.
            if (live > 0.05 || g < 59.5) {
                tint = mix(tint, accent.rgb * (0.6 + 0.6 * lum), 0.8);
                bgCol = max(bgCol * 0.5, accent.rgb * 0.06);
            }
        }
    }
    // A few cells always slightly wrong, so it never looks clean.
    if (live > 0.05 && hash31(vec3(cell, floor(vxPhase * 2.0))) < 0.006) {
        g = floor(hash21(cell * 1.7 + floor(vxPhase * 2.0)) * 59.0);
        tint = mix(ink.rgb, accent.rgb, 0.6) * 0.8;
    }

    float cov = 0.0;
    if (g < 59.5) cov = glyphCover(glyphOf(g), q, 1.0 / bit);
    vec3 col = mix(bgCol * bg, tint, cov);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
