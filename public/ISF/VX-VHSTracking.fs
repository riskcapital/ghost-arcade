/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A night drive played back off a worn videotape. The picture is a road at night: lane lines rushing in, street lamps sweeping past, tail lights ahead and a lit skyline on the horizon, with soft tape luma, smeared color that runs to the right and edge ringing. Every hit of the sound it follows throws the tracking out: a rolling band of noise tears through the picture, lines skew sideways, the color drops out, dropouts streak across and the deck's TRACKING meter comes up; then it settles back. The deck's PLAY display stays rock steady over the top. Tracking error sets how hard hits throw it, Settle how long it takes to recover, Tape wear the noise and dropouts at rest, Color bleed the smear, Head switching the torn strip along the bottom, and Speed the drive.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "pic",
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "tracking", "LABEL": "Tracking error", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "settle", "LABEL": "Settle", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "wear", "LABEL": "Tape wear", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "bleed", "LABEL": "Color bleed", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "headSwitch", "LABEL": "Head switching", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "osd", "LABEL": "Deck display", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Lights", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): r last count seen, g seconds since the last hit,
// b tracking error (jumps on hits, settles back), a band position (rolls).

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

float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
}

// ---------------------------------------------------------------- the tape picture

float glow(float d, float r) {
    return r * r / (d * d + r * r);
}

// A night road seen from the driver's seat. p in frame-height units, origin
// in the middle, y up. World units are metres; the camera sits 1.2 m up.
// Returns light (already coloured).
vec3 drive(vec2 p, float t) {
    vec3 inkC = ink.rgb;
    vec3 acc = accent.rgb;
    vec3 warm = mix(acc, vec3(1.0, 0.22, 0.1) * max(length(acc), 0.8) * 0.8, 0.45);
    float hz = 0.1;                  // horizon height
    float camH = 1.2;
    float sway = sin(t * 0.21) * 0.05 + sin(t * 0.53) * 0.015;
    float zSpeed = t * mix(8.0, 34.0, speed);
    vec3 col = vec3(0.0);

    // Sky: dark, with a warm city haze at the horizon.
    float above = p.y - hz;
    float xs = p.x + sway;
    if (above > 0.0) {
        col += acc * 0.06 * exp(-above * 12.0) + inkC * 0.015 * exp(-above * 3.0);
        // The skyline: blocks of towers with lit windows.
        float bx = (xs + t * 0.003) * 24.0;
        float bi = floor(bx);
        float hgt = 0.012 + pow(hash11(bi * 1.37 + 3.0), 2.5) * 0.12 * smoothstep(1.3, 0.1, abs(xs + 0.2));
        if (above < hgt) {
            col *= 0.2;
            vec2 wg = vec2(fract(bx) * 5.0, above * 230.0);
            vec2 wi = floor(wg);
            float lit = step(0.6, hash21(wi + bi * 17.0)) * step(0.2, fract(wg.x)) * step(0.4, fract(wg.y)) * step(wi.x, 3.5) * step(0.5, wi.x);
            col += mix(inkC, acc, step(0.7, hash21(wi + bi))) * lit * 0.5;
        }
        // A radio mast with a blinking light.
        float mx = xs - 0.55;
        if (abs(mx) < 0.0025 && above < 0.22) col += inkC * 0.2 * (1.0 - above / 0.22);
        col += warm * glow(length(vec2(mx, above - 0.22)), 0.005) * (0.3 + 0.7 * step(0.5, fract(t * 0.35)));
        // A few stars.
        vec2 sg = floor(p * 80.0);
        if (hash21(sg) > 0.988) col += inkC * 0.3 * glow(length(fract(p * 80.0) - 0.5), 0.1) * smoothstep(0.08, 0.3, above);
    }

    // The road below the horizon.
    float below = hz - p.y;
    if (below > 0.0) {
        float z = camH / below;                  // depth of this row, metres
        float wx = xs * z;                       // world x, metres
        float fade = exp(-z * 0.02);
        float aa = max(z * 1.5 / RENDERSIZE.y, 0.02);  // one pixel, in metres at this depth
        col += inkC * 0.018 * fade;
        // Solid edge lines and the dashed lane lines.
        float edge = smoothstep(aa, 0.0, abs(abs(wx + 1.75) - 5.25) - 0.08);
        float dash = step(0.6, fract((z + zSpeed) / 9.0));
        float lane = smoothstep(aa, 0.0, abs(wx + 1.75) - 0.07) * dash;
        float lane2 = smoothstep(aa, 0.0, abs(wx - 1.75) - 0.06) * step(0.6, fract((z + zSpeed + 4.0) / 9.0));
        col += inkC * (edge * 0.75 + lane * 0.9 + lane2 * 0.9) * fade;
        // Cat's eyes down the middle catch the headlights.
        float eye = step(0.93, fract((z + zSpeed) / 4.5)) * smoothstep(aa * 2.0, 0.0, abs(wx + 1.75) - 0.04);
        col += acc * eye * fade * 0.8;
        // Wet road: long streaks under each line of lamps.
        float refl = exp(-pow((wx + 7.5) * 0.7, 2.0)) + exp(-pow((wx - 4.2) * 0.7, 2.0));
        col += acc * refl * fade * 0.07 * (0.6 + 0.4 * sin(z * 0.4 + zSpeed * 0.4));
    }

    // Street lamps on both sides, sweeping past.
    float spacing = 28.0;
    for (int k = 0; k < 6; k++) {
        float fk = float(k);
        float zk = spacing * (fk + 0.35) - mod(zSpeed, spacing);
        if (zk < 1.5) zk += spacing * 6.0;
        float dz = exp(-zk * 0.012);
        for (int s = 0; s < 2; s++) {
            float side = s == 0 ? -1.0 : 1.0;
            float poleX = s == 0 ? -8.0 : 5.0;
            float armX = poleX - side * 2.2;
            vec2 base = vec2(poleX / zk - sway, hz - camH / zk);
            vec2 top = vec2(poleX / zk - sway, hz + (8.0 - camH) / zk);
            vec2 head = vec2(armX / zk - sway, hz + (7.8 - camH) / zk);
            float pw = max(0.12 / zk, 0.0012);
            // Pole and arm.
            if (p.y > base.y && p.y < top.y) col += inkC * 0.28 * dz * smoothstep(pw + 0.0015, pw * 0.4, abs(p.x - top.x));
            float ax = (p.x - top.x) * -side;
            if (ax > 0.0 && ax < abs(head.x - top.x)) col += inkC * 0.25 * dz * smoothstep(pw + 0.0015, pw * 0.4, abs(p.y - mix(top.y, head.y, ax / abs(head.x - top.x))));
            // The sodium head and its halo.
            float d = length((p - head) * vec2(0.8, 1.6));
            col += acc * dz * (glow(d, 0.3 / zk) * 1.1 + glow(d, 1.6 / zk) * 0.18);
        }
    }

    // Two cars ahead: tail light pairs that wander a little.
    for (int c = 0; c < 2; c++) {
        float fc = float(c);
        float zc = c == 0 ? 16.0 + sin(t * 0.37) * 4.0 : 42.0 + sin(t * 0.23 + 2.0) * 8.0;
        float cx = (c == 0 ? 1.75 : -1.75) + (c == 0 ? -1.75 : 1.75) * 0.0 + sin(t * 0.29 + fc) * 0.3;
        vec2 cc = vec2(cx / zc - sway, hz - (camH - 0.9) / zc);
        float hw = 0.75 / zc;
        vec2 q = p - cc;
        // The car body: a dark shape that blocks what is behind it.
        if (abs(q.x) < hw * 1.25 && q.y < 0.55 / zc && q.y > -0.55 / zc) col *= 0.15;
        float brake = 0.85 + 0.15 * sin(t * 1.7 + fc * 3.0);
        for (int s = 0; s < 2; s++) {
            vec2 lp = cc + vec2((s == 0 ? -hw : hw), 0.0);
            float d = length((p - lp) * vec2(0.55, 1.6));
            col += warm * brake * (glow(d, 0.16 / zc) * 1.5 + glow(d, 1.0 / zc) * 0.22);
        }
        // Their reflection on the wet road.
        float rq = (p.y < cc.y) ? exp(-pow(q.x / (hw * 1.6), 2.0)) * exp(-(cc.y - p.y) * 8.0) : 0.0;
        col += warm * rq * 0.2;
    }

    // Oncoming headlights in the far lane, growing as they pass.
    for (int c = 0; c < 2; c++) {
        float fc = float(c);
        float period = 120.0;
        float zo = period * (1.0 - fract((zSpeed * 1.6 + fc * period * 0.5) / period)) + 3.0;
        vec2 oc = vec2(-5.4 / zo - sway, hz - (camH - 0.7) / zo);
        float hw = 0.7 / zo;
        float fadeIn = smoothstep(120.0, 70.0, zo);
        for (int s = 0; s < 2; s++) {
            vec2 lp = oc + vec2((s == 0 ? -hw : hw), 0.0);
            float d = length((p - lp) * vec2(0.5, 1.4));
            col += inkC * fadeIn * (glow(d, 0.14 / zo) * 1.6 + glow(d, 1.2 / zo) * 0.25);
        }
        float rq = (p.y < oc.y) ? exp(-pow((p.x - oc.x) / (hw * 2.2), 2.0)) * exp(-(oc.y - p.y) * 5.0) : 0.0;
        col += inkC * rq * 0.2 * fadeIn;
    }
    return col;
}

// ---------------------------------------------------------------- the deck's display

vec2 glyphBits(float c) {
    if (c < 0.5) return vec2(476789.0, 26158.0); // 0
    if (c < 1.5) return vec2(143492.0, 4238.0); // 1
    if (c < 2.5) return vec2(476194.0, 4383.0); // 2
    if (c < 3.5) return vec2(1017986.0, 1582.0); // 3
    if (c < 4.5) return vec2(72018.0, 31810.0); // 4
    if (c < 5.5) return vec2(1033153.0, 1582.0); // 5
    if (c < 6.5) return vec2(205342.0, 17966.0); // 6
    if (c < 7.5) return vec2(1016900.0, 8456.0); // 7
    if (c < 8.5) return vec2(476718.0, 17966.0); // 8
    if (c < 9.5) return vec2(476719.0, 1100.0); // 9
    if (c < 10.5) return vec2(12672.0, 12672.0); // :
    if (c < 11.5) return vec2(1001022.0, 16912.0); // P
    if (c < 12.5) return vec2(541200.0, 16927.0); // L
    if (c < 13.5) return vec2(476735.0, 17969.0); // A
    if (c < 14.5) return vec2(574788.0, 4228.0); // Y
    if (c < 15.5) return vec2(508430.0, 1086.0); // S
    if (c < 16.5) return vec2(1020036.0, 4228.0); // T
    if (c < 17.5) return vec2(1001022.0, 21073.0); // R
    if (c < 18.5) return vec2(476688.0, 16942.0); // C
    if (c < 19.5) return vec2(576152.0, 21073.0); // K
    if (c < 20.5) return vec2(462980.0, 4238.0); // I
    if (c < 21.5) return vec2(583347.0, 17969.0); // N
    if (c < 22.5) return vec2(476695.0, 17967.0); // G
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

// Draw a string of up to 8 glyphs. s holds glyph codes (-1 for space).
float text8(vec2 q, float cell, vec4 s0, vec4 s1) {
    vec2 g = q / cell;
    if (g.y < 0.0 || g.y >= 7.0 || g.x < 0.0 || g.x >= 48.0) return 0.0;
    float i = floor(g.x / 6.0);
    float c = i < 0.5 ? s0.x : i < 1.5 ? s0.y : i < 2.5 ? s0.z : i < 3.5 ? s0.w : i < 4.5 ? s1.x : i < 5.5 ? s1.y : i < 6.5 ? s1.z : s1.w;
    return glyph(c, vec2(g.x - i * 6.0, g.y));
}

void main() {
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 0.8);
        bool newHit = abs(n - c.r) > 0.5;
        float err = c.b;
        float age = min(c.g + dt, 30.0);
        if (newHit) {
            err = min(err + mix(0.35, 0.8, clamp(vxVel, 0.0, 1.0)) * tracking * 1.4, 1.5);
            age = 0.0;
        }
        float tau = mix(0.12, 1.4, settle);
        err *= exp(-dt / tau);
        // The band rolls upward, fast while the tracking is out.
        float pos = fract(c.a - dt * (0.05 + err * 0.9));
        gl_FragColor = vec4(n, age, err, pos);
        return;
    }

    if (PASSINDEX == 1) {
        vec2 uv = isf_FragNormCoord;
        float aspect = RENDERSIZE.x / RENDERSIZE.y;
        vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
        gl_FragColor = vec4(drive(p, vxPhase), 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float err = clamp(clk.b, 0.0, 1.5);
    float e1 = clamp(err, 0.0, 1.0);
    float bandPos = clk.a;
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float top = 1.0 - uv.y;
    float lines = 486.0;
    float line = floor(top * lines);
    float tf = floor(TIME * 29.97);         // tape frame
    float px = 1.0 / RENDERSIZE.x;

    // Time-base wobble: every line wavers a touch, the top flags sideways.
    float off = (vnoise(line * 0.08 + TIME * 3.0) - 0.5) * 0.0025 * (0.4 + wear);
    off += (hash21(vec2(line, tf)) - 0.5) * 0.0012 * wear;
    off += pow(max(0.0, 1.0 - top / 0.07), 2.0) * 0.018 * (0.3 + e1) * sin(TIME * 1.3);
    // The whole picture shudders sideways while the tracking is out.
    off += (vnoise(TIME * 7.0) - 0.5) * 0.02 * e1 * e1;

    // The tracking band, and a second one when it is badly out.
    float noiseAmt = 0.0;
    float bandAmt = 0.0;
    for (int b = 0; b < 2; b++) {
        float fb = float(b);
        float bp = fract(bandPos + fb * 0.43 + fb * sin(TIME * 0.7) * 0.05);
        float hgt = mix(0.018, 0.1, e1) * (b == 0 ? 1.0 : smoothstep(0.6, 1.1, err));
        hgt += wear * 0.02 * (b == 0 ? 1.0 : 0.0);
        float d = abs(fract(top - bp + 0.5) - 0.5);
        float inside = smoothstep(hgt, hgt * 0.35, d);
        // At rest the band is faint; it only fully tears when hit.
        float strength = mix(0.15 + wear * 0.4, 1.0, e1) * (b == 0 ? 1.0 : e1);
        bandAmt = max(bandAmt, inside * strength);
        // The leading edge carries the densest noise.
        float edgeD = (top - bp) - hgt * 0.6;
        noiseAmt = max(noiseAmt, inside * strength * (0.4 + 0.6 * smoothstep(0.03, 0.0, abs(fract(edgeD + 0.5) - 0.5))));
    }
    // Lines inside the band skew and jump sideways.
    float skew = (hash21(vec2(line * 0.37, floor(TIME * 15.0))) - 0.5) * 0.08 + (vnoise(line * 0.3 + TIME * 20.0) - 0.5) * 0.05;
    off += skew * bandAmt * (0.25 + 0.75 * e1);

    // Head switching: the bottom few lines tear right.
    float hsH = 0.022 * (0.4 + headSwitch);
    float hs = smoothstep(1.0 - hsH, 1.0, top);
    off += hs * (0.035 + 0.03 * hash21(vec2(line, tf))) * headSwitch * 1.5;
    off += hs * (vnoise(line * 0.5 + TIME * 30.0) - 0.5) * 0.02;

    // A hit drops the picture a few lines, then it climbs back.
    float vjump = e1 * e1 * 0.03 * sin(TIME * 23.0 + floor(TIME * 6.0));
    float sy = uv.y + vjump;
    float sx = uv.x - off;

    // Luma: soft, with the deck's edge ringing.
    float hp = 1.0 / (RENDERSIZE.x * 0.5);
    vec3 c0 = IMG_NORM_PIXEL(pic, vec2(sx, sy)).rgb;
    vec3 cl = IMG_NORM_PIXEL(pic, vec2(sx - hp, sy)).rgb;
    vec3 cr = IMG_NORM_PIXEL(pic, vec2(sx + hp, sy)).rgb;
    vec3 cw1 = IMG_NORM_PIXEL(pic, vec2(sx - hp * 3.5, sy)).rgb;
    vec3 cw2 = IMG_NORM_PIXEL(pic, vec2(sx + hp * 3.5, sy)).rgb;
    const vec3 YW = vec3(0.299, 0.587, 0.114);
    float y0 = dot(c0 * 0.5 + (cl + cr) * 0.25, YW);
    float yw = dot((cw1 + cw2) * 0.5, YW);
    float Y = y0 + (y0 - yw) * 0.55;

    // Chroma: low bandwidth, delayed to the right, smeared further by Bleed.
    float spread = hp * mix(2.0, 9.0, bleed);
    float delay = hp * mix(1.0, 6.0, bleed);
    vec3 chroma = vec3(0.0);
    float wsum = 0.0;
    for (int k = 0; k < 5; k++) {
        float fk = float(k) - 2.0;
        float w = 1.0 - abs(fk) * 0.18;
        chroma += IMG_NORM_PIXEL(pic, vec2(sx - delay - fk * spread, sy)).rgb * w;
        wsum += w;
    }
    chroma /= wsum;
    float cy = dot(chroma, YW);
    vec3 cvec = (chroma - cy) * mix(1.1, 1.45, bleed);
    // The colour drops out in the band (the deck's colour killer).
    float kill = clamp(bandAmt * (0.3 + 0.9 * e1), 0.0, 1.0);
    if (hash21(vec2(floor(line / 6.0), tf)) < e1 * 0.6) kill = max(kill, 0.6);
    vec3 col = max(vec3(Y) + cvec * (1.0 - kill), 0.0);

    // Band noise: thin streaks of snow of every length, patchy across the line.
    float lf = mix(40.0, 260.0, hash11(line * 0.73 + tf));
    float streak = vnoise(uv.x * lf + hash11(line + tf * 1.3) * 500.0);
    float patch = 0.6 + 0.6 * vnoise(uv.x * 5.0 + line * 0.04 + TIME * 4.0);
    float snow = smoothstep(0.6, 0.95, streak * patch) * noiseAmt;
    snow *= mix(0.4, 1.0, hash11(line * 2.1 + tf));
    col = col * (1.0 - noiseAmt * 0.5) + mix(ink.rgb, vec3(dot(ink.rgb, YW)), 0.4) * snow * 0.85;

    // Dropouts: short bright streaks where the oxide is gone.
    float dropRate = 0.001 + wear * 0.006 + e1 * 0.03;
    float dl = hash21(vec2(line * 1.7, tf));
    if (dl < dropRate) {
        float x0 = hash21(vec2(line, tf + 3.0));
        float len = mix(0.02, 0.18, hash21(vec2(line + 5.0, tf)));
        float dx = uv.x - x0;
        if (dx > 0.0 && dx < len) col = mix(col, ink.rgb * 0.85, (1.0 - dx / len) * 0.9);
    }

    // Head switching noise.
    col += ink.rgb * hs * smoothstep(0.6, 1.0, hash21(vec2(line, floor(uv.x * 90.0) + tf))) * headSwitch * 0.6;

    // Faint tape grain on the picture only, so black stays black.
    col *= 1.0 + (hash21(gl_FragCoord.xy + tf) - 0.5) * 0.18;

    // The deck's display sits on top, steady.
    if (osd) {
        float cell = max(floor(RENDERSIZE.y / 150.0 + 0.5), 1.0);
        vec2 q = vec2(gl_FragCoord.x, RENDERSIZE.y - gl_FragCoord.y);
        float o = 0.0;
        // PLAY and its triangle, top left.
        vec2 tl = q - vec2(RENDERSIZE.x * 0.06, RENDERSIZE.y * 0.07);
        o = max(o, text8(tl, cell, vec4(11.0, 12.0, 13.0, 14.0), vec4(-1.0)));
        vec2 tri = (tl - vec2(cell * 26.0, 0.0)) / cell;
        if (tri.x > 0.0 && tri.x < 6.0 && abs(tri.y - 3.5) < 3.5 - tri.x * 0.58) o = 1.0;
        // SP and the tape counter, top right.
        float secs = floor(vxPhase * 1.0 + 754.0);
        float h0 = mod(floor(secs / 3600.0), 10.0);
        float m1 = floor(mod(floor(secs / 60.0), 60.0) / 10.0);
        float m0 = mod(floor(secs / 60.0), 10.0);
        float s1 = floor(mod(secs, 60.0) / 10.0);
        float s0 = mod(secs, 10.0);
        vec2 tr = q - vec2(RENDERSIZE.x * 0.94 - cell * 59.0, RENDERSIZE.y * 0.07);
        o = max(o, text8(tr, cell, vec4(15.0, 11.0, -1.0, h0), vec4(10.0, m1, m0, 10.0)));
        o = max(o, text8(tr - vec2(cell * 48.0, 0.0), cell, vec4(s1, s0, -1.0, -1.0), vec4(-1.0)));
        // The tracking meter comes up while the tracking is out.
        float show = smoothstep(0.12, 0.3, err);
        if (show > 0.0) {
            vec2 bm = q - vec2(RENDERSIZE.x * 0.5 - cell * 24.0, RENDERSIZE.y * 0.78);
            float tt = text8(bm, cell, vec4(16.0, 17.0, 13.0, 18.0), vec4(19.0, 20.0, 21.0, 22.0));
            // A row of boxes with the cursor drifting home.
            vec2 bq = (bm - vec2(-cell * 6.0, cell * 11.0)) / cell;
            float slot = floor(bq.x / 4.0);
            float cur = floor(6.0 + (vnoise(TIME * 2.0) - 0.5) * 12.0 * e1);
            if (bq.y > 0.0 && bq.y < 4.0 && slot >= 0.0 && slot < 15.0 && mod(bq.x, 4.0) < 3.0) {
                float box = (slot == cur) ? 1.0 : ((bq.y < 0.6 || bq.y > 3.4 || mod(bq.x, 4.0) < 0.6 || mod(bq.x, 4.0) > 2.4) ? 0.7 : 0.0);
                tt = max(tt, box);
            }
            o = max(o, tt * show * (0.75 + 0.25 * step(0.5, fract(TIME * 2.0))));
        }
        col = mix(col, ink.rgb * 0.95, o);
    }

    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
