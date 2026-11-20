/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A whole wall of LED diodes, edge to edge, showing bands of data: barcodes, scrolling bits, level bars, blocks and sweeps. Each hit re-rolls one band, marked in the accent color, and pushes a wave of brightness up the wall; the sound's level lifts the whole face. With no sound the wall glows dim and its data drifts slowly.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "diodes", "LABEL": "Diodes", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "bands", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "reroll", "LABEL": "Re-roll", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Diodes", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Re-rolled band", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Bands of data down the wall (at most), and how far back a band looks for the hit that last re-rolled it.
const int MAX_ZONES = 10;
const int LOOKBACK = 16;

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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// Hit m re-rolls one band for sure, and each other band by chance.
bool rerolled(float m, float b, float zones) {
    if (floor(hash11(m * 1.731 + 0.37) * zones) == b) return true;
    return hash11(m * 13.17 + b * 3.71 + 1.9) < reroll * 0.6;
}

float bandSeed(float b, float n, float zones) {
    for (int k = 0; k < LOOKBACK; k++) {
        float m = mod(n - float(k) + 64.0, 64.0);
        if (rerolled(m, b, zones)) return m;
    }
    return mod(n - float(LOOKBACK) + 64.0, 64.0);
}

// Which band a diode row is in: (band, first row, row count), or band -1 in the dark rows between.
// Rows count from the bottom; bands are laid out from the top down, of uneven heights.
vec3 zoneOf(float iy, float R, float zones) {
    float total = 0.0;
    for (int k = 0; k < MAX_ZONES; k++) {
        if (float(k) >= zones) break;
        total += 0.55 + hash11(float(k) * 7.31 + 2.0);
    }
    float avail = R - (zones - 1.0);
    float r = R - 1.0 - iy;
    float top = 0.0;
    float acc = 0.0;
    for (int k = 0; k < MAX_ZONES; k++) {
        if (float(k) >= zones) break;
        acc += 0.55 + hash11(float(k) * 7.31 + 2.0);
        float bottom = (float(k) >= zones - 1.0) ? R : floor(avail * acc / total + 0.5) + float(k);
        if (r >= top && r < bottom) return vec3(float(k), R - bottom, bottom - top);
        top = bottom + 1.0;
    }
    return vec3(-1.0, 0.0, 1.0);
}

// One diode: (brightness 0-1 before the wall's level, 1 if it is in the accent band).
vec2 led(vec2 ic, float C, float R, float n, float flow, float zones) {
    if (ic.x < 0.0 || ic.y < 0.0 || ic.x >= C || ic.y >= R) return vec2(0.0);
    vec3 z = zoneOf(ic.y, R, zones);
    if (z.x < 0.0) return vec2(0.0);
    float sd = bandSeed(z.x, n, zones);
    float kind = hash11(sd * 0.917 + z.x * 5.3 + 2.0);
    float j = ic.y - z.y;
    float on = 0.0;
    if (kind < 0.26) {
        // Barcode: bars of one to three diodes, drifting sideways a diode at a time.
        float mw = 1.0 + floor(hash11(sd + 1.0) * 2.99);
        float shift = floor(flow * (0.6 + hash11(sd + 4.0)) * 3.0) * (hash11(sd + 5.0) < 0.5 ? 1.0 : -1.0);
        float m = floor((ic.x + shift) / mw);
        float grp = floor(m / 6.0);
        float solid = hash21(vec2(grp, sd + 3.0)) < 0.18 ? 1.0 : 0.0;
        on = max(step(hash21(vec2(m, sd * 1.3 + 7.0)), 0.45), solid);
    } else if (kind < 0.5) {
        // Scrolling data: each row a stream of bits running at its own rate.
        float rate = 1.5 + 5.0 * hash11(ic.y * 3.1 + sd);
        float dir = hash11(ic.y * 1.7 + sd * 2.0) < 0.5 ? 1.0 : -1.0;
        float x = floor(ic.x + dir * flow * rate * 3.0);
        float h = hash21(vec2(x, ic.y + sd * 13.0));
        on = h < 0.36 ? 0.55 + 0.45 * hash21(vec2(x + 3.0, ic.y)) : 0.0;
    } else if (kind < 0.72) {
        // Level bars: each column a bar rising from the band's floor, its top diode brightest.
        float lv = 0.2 + 0.75 * noise1(ic.x * 0.3 + flow * 1.6 + sd * 3.0);
        lv *= 0.6 + 0.4 * clamp(vxSwell, 0.0, 1.0);
        float hgt = floor(lv * z.z + 0.5);
        on = j < hgt ? (j > hgt - 1.5 ? 1.0 : 0.55) : 0.0;
    } else if (kind < 0.86) {
        // Blocks: big pixels three diodes square.
        vec2 b = floor(vec2(ic.x + floor(flow * 1.5), j) / 3.0);
        on = hash21(b + sd * 5.0) < 0.38 ? 0.85 : 0.0;
    } else {
        // A frequency sweep: bars tightening across the band.
        float x = ic.x / C;
        on = fract(x * (4.0 + 14.0 * x) * (1.0 + hash11(sd)) - flow * 0.35) < 0.42 ? 0.9 : 0.0;
    }
    on *= 0.82 + 0.18 * hash21(ic + 0.5);
    float primary = floor(hash11(n * 1.731 + 0.37) * zones);
    float acc = (n > 0.5 && z.x == primary) ? 1.0 : 0.0;
    return vec2(on, acc);
}

// The wall's level at height v: a rest glow, lifted by the swell; a hit pushes a wave of light up the face.
float wallLevel(float v) {
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float front = (1.0 - pu) * 1.35 - 0.2;
    float wave = exp(-pow((v - front) / 0.28, 2.0));
    return 0.34 + 0.4 * sw + pu * (0.3 + 1.0 * wave);
}

// The light of the diodes round a point, interpolated between their centres: the bloom.
vec2 ledBlur(vec2 cell, float C, float R, float n, float flow, float zones) {
    vec2 cb = cell - 0.5;
    vec2 i0 = floor(cb);
    vec2 fb = fract(cb);
    fb = fb * fb * (3.0 - 2.0 * fb);
    vec2 b00 = led(i0, C, R, n, flow, zones);
    vec2 b10 = led(i0 + vec2(1.0, 0.0), C, R, n, flow, zones);
    vec2 b01 = led(i0 + vec2(0.0, 1.0), C, R, n, flow, zones);
    vec2 b11 = led(i0 + vec2(1.0, 1.0), C, R, n, flow, zones);
    return mix(mix(b00, b10, fb.x), mix(b01, b11, fb.x), fb.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;

    float R = floor(mix(28.0, 108.0, diodes));
    float C = floor(R * asp + 0.5);
    float zones = floor(mix(3.0, float(MAX_ZONES), bands) + 0.5);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow;

    vec2 cell = uv * vec2(C, R);
    vec2 ic = floor(cell);
    vec2 f = fract(cell) - 0.5;
    // A diode's size in pixels decides how it is drawn: round when large, its average when small.
    float fmax = clamp(R / RENDERSIZE.y, 1e-4, 4.0);

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec2 me = led(ic, C, R, n, flow, zones);
    vec2 bl = ledBlur(cell, C, R, n, flow, zones);
    float lvl = wallLevel(uv.y);

    float rr = length(f);
    float rad = 0.33;
    float far = smoothstep(0.3, 0.6, fmax);
    float core = smoothstep(rad + 0.75 * fmax, rad - 0.75 * fmax, rr);
    core = mix(core, 3.14159 * rad * rad, far);
    float lens = mix(exp(-rr * rr / 0.09), 0.4, far);

    vec3 dc = mix(inkC, accC, me.y);
    vec3 bc = mix(inkC, accC, bl.y);
    vec3 e = dc * me.x * (core * 2.2 + lens * 0.55) * lvl;
    // A hot diode whitens at its centre.
    e += vec3(1.0) * me.x * core * lvl * lvl * 0.35;
    // Bloom from the neighbours.
    e += bc * bl.x * (0.15 + 0.6 * glow) * (0.4 + 0.6 * lvl) * lvl;
    // Unlit diodes: a faint lens of the color, so the grid reads even where dark.
    e += dc * (1.0 - me.x) * core * 0.022;

    // The black mask the diodes sit in, with a faint sheen from a soft light high on the left.
    float sheen = exp(-pow((uv.x * 0.6 + uv.y * 0.8 - 0.95) / 0.22, 2.0));
    vec3 col = vec3(0.005, 0.006, 0.008) + vec3(0.008, 0.009, 0.011) * sheen + e;
    // The wall falls off a little toward its corners, as a lens sees it.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.35 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so lit diodes keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark mask lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
