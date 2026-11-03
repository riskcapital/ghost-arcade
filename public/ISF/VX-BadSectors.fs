/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A disk surface being read. A spinning platter of concentric tracks, cut into sectors (more of them towards the rim), with a read head on a swinging arm that sweeps across the tracks and leaves a lit trail where it reads. Every hit of the sound it follows plants bad sectors and sends the head seeking; the bad sectors spread to their neighbours like an infection in the accent colour. As the head passes over a bad sector it tries to rewrite it: a remapped sector flashes bright and returns to normal. A readout shows the track and sector under the head and whether the read failed. Tracks sets how finely the platter is divided, Spread how fast the damage grows, Healing how often the head repairs what it passes, Spin how fast the platter turns and Tilt the viewing angle.",
    "PASSES": [
        { "TARGET": "clock", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "disk", "PERSISTENT": true, "FLOAT": true, "WIDTH": 128, "HEIGHT": 128 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "tracks", "LABEL": "Tracks", "TYPE": "float", "DEFAULT": 26, "MIN": 12, "MAX": 44 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "healing", "LABEL": "Healing", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "Tilt", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Surface", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Bad sectors", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): count seen, seconds since the last hit.
// disk (128x48, kept): one texel a sector, x the sector along its track,
// y the track (0 innermost). r how bad (0-1), g lit by a read, b just
// remapped, a the strength it spreads with.

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
const float R0 = 0.28;      // inner edge of the data area, as a share of the radius

float trackCount() {
    return floor(clamp(tracks, 12.0, 44.0) + 0.5);
}

// Sectors on track t: more towards the rim, as on a real disk.
float sectorsOn(float t, float T) {
    float r = R0 + (1.0 - R0) * (t + 0.5) / T;
    return floor(mix(18.0, 120.0, r) * clamp(T / 30.0, 0.6, 1.0) + 0.5);
}

float platterAngle() {
    return vxPhase * mix(0.15, 1.6, spin);
}

// Where the head is, in tracks (fractional), and its angle on the platter.
vec2 headPos(float n, float age, float T) {
    float sweep = T * (0.5 + 0.42 * sin(vxPhase * 0.31) * cos(vxPhase * 0.07 + 1.0));
    float target = floor(hash11(n * 3.77 + 0.4) * T);
    float seek = n > 0.5 ? smoothstep(0.0, 0.09, age) * exp(-max(age - 0.09, 0.0) * 0.9) : 0.0;
    float tr = mix(sweep, target, seek);
    // The arm swings on a pivot, so the head's angle drifts with the track.
    float a = -0.42 + 0.55 * (tr / T - 0.5);
    return vec2(clamp(tr, 0.0, T - 0.001), a);
}

float wrapPi(float a) {
    return a - TAU * floor((a + 3.14159265) / TAU);
}

void main() {
    float n = floor(vxCount + 0.5);
    float T = trackCount();

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 0.0);
        c.g = abs(n - c.r) > 0.5 ? 0.0 : min(c.g + dt, 30.0);
        gl_FragColor = vec4(n, c.g, 0.0, 0.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = clk.g;
    vec2 head = headPos(n, age, T);

    if (PASSINDEX == 1) {
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        vec2 cell = floor(gl_FragCoord.xy);
        float t = cell.y;
        float N = sectorsOn(t, T);
        if (t >= T || cell.x >= N) { gl_FragColor = vec4(0.0); return; }
        vec2 px = vec2(1.0 / 128.0, 1.0 / 128.0);
        vec4 s = IMG_NORM_PIXEL(disk, (cell + 0.5) * px);
        if (FRAMEINDEX < 2) s = vec4(0.0);

        // Neighbours: along the track (wrapping) and across, at the same angle.
        // Spread reads their strength (a), which drops a little each generation.
        float l = IMG_NORM_PIXEL(disk, (vec2(imod(cell.x - 1.0 + N, N), t) + 0.5) * px).a;
        float r = IMG_NORM_PIXEL(disk, (vec2(imod(cell.x + 1.0, N), t) + 0.5) * px).a;
        float frac = (cell.x + 0.5) / N;
        float dn = 0.0;
        float up = 0.0;
        if (t > 0.5) dn = IMG_NORM_PIXEL(disk, (vec2(floor(frac * sectorsOn(t - 1.0, T)), t - 1.0) + 0.5) * px).a;
        if (t < T - 1.5) up = IMG_NORM_PIXEL(disk, (vec2(floor(frac * sectorsOn(t + 1.0, T)), t + 1.0) + 0.5) * px).a;
        float infected = max(max(l, r), max(dn, up));
        float h = hash31(vec3(cell, floor(TIME * 60.0)));
        float rate = mix(0.3, 5.0, spread) * dt;
        float loss = mix(0.3, 0.07, spread) + 0.1 * hash11(h * 13.0);
        if (s.a < 0.01 && infected > 0.3 && h < rate) {
            s.a = infected - loss;
            s.r = 0.12;
        }
        // A bad sector darkens to its full strength, and slowly fades as the drive retries it.
        s.a = max(s.a - dt * mix(0.01, 0.14, healing), 0.0);
        s.r = min(s.r + dt * 1.6, s.a);

        // Hits plant new bad sectors, a small cluster each.
        if (FRAMEINDEX >= 2 && age == 0.0 && n > 0.5) {
            for (int i = 0; i < 3; i++) {
                float fi = float(i);
                if (fi > floor(vxVel * 1.9)) break;
                float st = floor(hash11(n * 5.31 + fi * 1.7) * T);
                float sa = hash11(n * 2.19 + fi * 3.1);
                float da = abs(fract(frac - sa + 0.5) - 0.5) * N;
                if (abs(t - st) < 0.5 + step(0.5, hash11(n * 1.3 + fi)) && da < 1.0 + hash11(n + fi) * 2.0) s = vec4(1.0, s.g, s.b, 1.0);
            }
        }

        // Under the head: read, and rewrite if it is bad.
        float ca = (cell.x + 0.5) / N * TAU + platterAngle();
        float under = abs(t - floor(head.x)) < 1.5 && abs(wrapPi(ca - head.y)) < TAU / N * 0.75 ? 1.0 : 0.0;
        if (under > 0.5) {
            s.g = 1.0;
            if (s.r > 0.05 && hash31(vec3(cell, n + floor(TIME * 7.0))) < mix(0.02, 0.6, healing)) {
                s.r = 0.0;
                s.a = 0.0;
                s.b = 1.0;
            }
        }
        s.g = max(s.g - dt * 0.55, 0.0);
        s.b = max(s.b - dt * 0.8, 0.0);
        gl_FragColor = clamp(s, 0.0, 1.0);
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float pxS = 1.0 / RENDERSIZE.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float yScale = mix(1.0, 0.4, tilt);
    float Rad = min(0.47 / yScale, aspect * 0.33);
    Rad = min(Rad, 0.62);
    vec2 cen = vec2(-aspect * 0.08, 0.02);
    vec2 q = (p - cen) / vec2(1.0, yScale);
    float rr = length(q) / Rad;
    float pxR = pxS / (Rad * yScale);   // one pixel in platter radius units (worst case)
    vec3 col = vec3(0.0);

    // Sheen: two soft bright wedges fixed to the view, as light on a platter.
    float va = atan(q.y, q.x);
    float sheen = pow(abs(cos(va - 0.7)), 6.0) * 0.8 + 0.2;

    if (rr < 1.03) {
        // The data area.
        if (rr > R0 && rr < 1.0) {
            float tf = (rr - R0) / (1.0 - R0) * T;
            float t = floor(tf);
            float N = sectorsOn(t, T);
            float a = fract((va - platterAngle()) / TAU);
            float sf = a * N;
            float sct = floor(sf);
            vec4 st = IMG_NORM_PIXEL(disk, (vec2(sct, t) + 0.5) / vec2(128.0, 128.0));
            // Distance to the cell's edges, in pixels.
            float trackW = (1.0 - R0) / T;
            float dR = min(tf - t, t + 1.0 - tf) * trackW / pxR;
            float dA = min(sf - sct, sct + 1.0 - sf) / N * TAU * rr / pxR;
            // Gaps between sectors stay a hairline at any size.
            float cellPx = min(trackW / pxR, TAU * rr / N / pxR);
            float gapW = clamp(cellPx * 0.12, 0.2, 0.9);
            float inCell = clamp(min(dR, dA) - gapW + 0.5, 0.0, 1.0);

            float base = 0.07 + 0.05 * hash21(vec2(sct, t));
            vec3 c = ink.rgb * base * (0.6 + 0.8 * sheen);
            // Read trail.
            c += ink.rgb * st.g * 0.5 * (0.7 + 0.3 * sheen);
            // Bad sectors, fresh ones brightest; they pulse.
            float bad = st.r;
            if (bad > 0.05) {
                float pulse = 0.8 + 0.2 * sin(TIME * 7.0 + hash21(vec2(sct, t)) * 6.0);
                c = mix(c, accent.rgb * (0.3 + 0.7 * bad) * pulse, smoothstep(0.05, 0.3, bad));
                // A bright core inset in the sector.
                float core = clamp(min(dR, dA) - 3.0, 0.0, 1.0);
                c += accent.rgb * 0.35 * core * bad;
            }
            // Remapped: a bright repaint that fades.
            c = mix(c, ink.rgb * 1.1, st.b * 0.85);
            col = c * inCell;
        }
        // Hub: rings and a clamp.
        float hr = rr / R0;
        if (hr < 1.0) {
            float ring = 0.0;
            ring = max(ring, clamp(1.0 - abs(hr - 0.92) * R0 / pxR, 0.0, 1.0) * 0.5);
            ring = max(ring, clamp(1.0 - abs(hr - 0.62) * R0 / pxR, 0.0, 1.0) * 0.6);
            ring = max(ring, clamp(1.0 - abs(hr - 0.3) * R0 / pxR, 0.0, 1.0) * 0.8);
            // Six screws turning with the platter.
            float sa = va - platterAngle();
            vec2 sp = vec2(cos(sa), sin(sa)) * hr;
            for (int i = 0; i < 6; i++) {
                float ang = float(i) * TAU / 6.0;
                vec2 sc = vec2(cos(ang), sin(ang)) * 0.47;
                float d = length(vec2(hr * cos(sa - ang), hr * sin(sa - ang)) - vec2(0.47, 0.0));
                ring = max(ring, clamp(1.0 - (abs(d - 0.06)) * R0 / pxR, 0.0, 1.0) * 0.7);
            }
            float face = (0.05 + 0.08 * sheen) * smoothstep(1.0, 0.95, hr);
            col = ink.rgb * max(face, ring * (0.5 + 0.5 * sheen));
        }
        // Rim.
        col = max(col, ink.rgb * 0.45 * clamp(1.0 - abs(rr - 1.015) / pxR, 0.0, 1.0));
    }

    // The arm: from a pivot off the platter to the head.
    float headR = R0 + (1.0 - R0) * (floor(head.x) + 0.5) / T;
    vec2 hq = vec2(cos(head.y), sin(head.y)) * headR * Rad;
    vec2 hs = cen + hq * vec2(1.0, yScale);
    vec2 pivot = cen + vec2(Rad * 1.28, -Rad * 0.62 * yScale - 0.08);
    vec2 ab = hs - pivot;
    float tseg = clamp(dot(p - pivot, ab) / dot(ab, ab), 0.0, 1.0);
    float dArm = length(p - pivot - ab * tseg);
    float armW = mix(0.012, 0.004, tseg);
    float arm = clamp(1.0 - (dArm - armW) / pxS, 0.0, 1.0);
    // Outline only, so the platter shows through.
    float armEdge = clamp(1.0 - abs(dArm - armW) / pxS, 0.0, 1.0);
    vec3 armCol = ink.rgb * 0.06 * arm + ink.rgb * 0.75 * armEdge;
    // A centre line.
    armCol = max(armCol, ink.rgb * 0.35 * clamp(1.0 - dArm / pxS, 0.0, 1.0) * step(0.08, tseg));
    col = mix(col, armCol, arm);
    // The pivot.
    float dp = length(p - pivot);
    col = max(col, ink.rgb * 0.7 * clamp(1.0 - abs(dp - 0.03) / pxS, 0.0, 1.0));
    col = max(col, ink.rgb * 0.5 * clamp(1.0 - abs(dp - 0.012) / pxS, 0.0, 1.0));
    // The head: a small slider, accent when the read under it failed.
    vec2 hcell = vec2(0.0);
    float hN = sectorsOn(floor(head.x), T);
    float hsec = floor(fract((head.y - platterAngle()) / TAU) * hN);
    vec4 hst = IMG_NORM_PIXEL(disk, (vec2(hsec, floor(head.x)) + 0.5) / vec2(128.0, 128.0));
    float err = step(0.2, hst.r);
    vec2 dir = normalize(ab);
    vec2 lp = vec2(dot(p - hs, dir), dot(p - hs, vec2(-dir.y, dir.x)));
    vec2 sd = abs(lp) - vec2(0.016, 0.009);
    float box = max(sd.x, sd.y);
    float slider = clamp(1.0 - box / pxS, 0.0, 1.0);
    vec3 sCol = mix(ink.rgb * 0.9, accent.rgb, err);
    col = mix(col, sCol * mix(0.25, 1.0, clamp(1.0 + box / (2.0 * pxS) * 0.0, 0.0, 1.0)), slider * 0.35);
    col = max(col, sCol * clamp(1.0 - abs(box) / pxS, 0.0, 1.0));
    // A short read beam onto the surface.
    col = max(col, sCol * 0.8 * clamp(1.0 - length(p - hs) / (pxS * 2.5), 0.0, 1.0));

    // Readout, lower left: TRK nn  SEC nnn  then READ OK or READ ERR.
    float bit = max(floor(RENDERSIZE.y / 300.0 + 0.5), 1.0);
    if (RENDERSIZE.y < 400.0) bit = RENDERSIZE.y / 300.0;
    float cw = bit * 6.0;
    vec2 tb = vec2(gl_FragCoord.x - RENDERSIZE.y * 0.06, (RENDERSIZE.y - gl_FragCoord.y) - (RENDERSIZE.y - RENDERSIZE.y * 0.06 - bit * 10.0 * 3.0));
    vec2 tc = tb / vec2(cw, bit * 10.0);
    if (tc.x >= 0.0 && tc.y >= 0.0 && tc.x < 24.0 && tc.y < 3.0) {
        float c = floor(tc.x);
        float row = floor(tc.y);
        vec2 qg = vec2((tc.x - c) * 6.0, (tc.y - row) * 10.0 - 1.0);
        float g = 60.0;
        float lit = 0.5;
        vec3 tint = ink.rgb;
        float tr = floor(head.x);
        if (row < 0.5) {
            // TRK nn  SEC nnn
            if (c < 3.0) g = c < 0.5 ? 48.0 : (c < 1.5 ? 46.0 : 39.0);
            else if (c >= 4.0 && c < 6.0) { g = imod(floor((tr + 0.5) / pow(10.0, 5.0 - c)), 10.0); lit = 0.95; }
            else if (c >= 8.0 && c < 11.0) g = c < 8.5 ? 47.0 : (c < 9.5 ? 14.0 : 12.0);
            else if (c >= 12.0 && c < 15.0) { g = imod(floor((hsec + 0.5) / pow(10.0, 14.0 - c)), 10.0); lit = 0.95; }
        } else if (row < 1.5) {
            // LBA in hex
            if (c < 3.0) g = c < 0.5 ? 40.0 : (c < 1.5 ? 11.0 : 10.0);
            else if (c >= 4.0 && c < 12.0) {
                float lba = tr * 131.0 + hsec + 4096.0 * 3.0;
                g = c < 6.0 ? 0.0 : imod(floor((lba + 0.5) / pow(16.0, 11.0 - c)), 16.0);
                lit = 0.8;
            }
        } else {
            // READ OK / READ ERR
            if (c < 4.0) g = c < 0.5 ? 46.0 : (c < 1.5 ? 14.0 : (c < 2.5 ? 10.0 : 13.0));
            else if (c >= 5.0 && c < 8.0) {
                if (err > 0.5) { g = c < 5.5 ? 14.0 : 46.0; tint = accent.rgb; lit = 1.0; }
                else { g = c < 5.5 ? 43.0 : (c < 6.5 ? 39.0 : 60.0); lit = 0.95; }
            }
        }
        if (g < 59.5) col = mix(col, tint * lit, glyphCover(glyphOf(g), qg, 1.0 / bit));
    }

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
